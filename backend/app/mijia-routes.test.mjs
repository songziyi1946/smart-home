import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createAuth, authorizeHousehold, validateOrigin } from '../auth.mjs';
import { createMijiaRouter } from './mijia-routes.mjs';
import { createStateStream } from './state-stream.mjs';
import { MijiaService } from '../providers/mijia/service.mjs';
import { parseDeviceCommand } from '../domain/devices/model.mjs';

const property = (iid, name, format, access, extra = {}) => ({ iid, type: `urn:miot-spec-v2:property:${name}:00000000:test:1`, format, access, ...extra });
const spec = { services: [{ iid: 2, type: 'urn:miot-spec-v2:service:light:00000000:test:1', properties: [property(1, 'on', 'bool', ['read', 'write']), property(2, 'brightness', 'uint8', ['read', 'write'], { 'value-range': [1, 100, 1], unit: 'percentage' })] }] };
const account = { username: 'mijia_admin', password: 'fixture-platform-password', displayName: '测试管理员', homeName: '测试家庭' };
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'home-mijia-http-')); let stored = null, power = false, writes = 0;
  const clouds = [];
  const cloudFactory = options => {
    const cloud = {
      authenticated: !!options.credentials,
      exportCredentials: () => ({ region: 'cn', sid: 'xiaomiio', userId: 'fixture-user', serviceToken: 'fixture-cloud-secret', ssecurity: Buffer.alloc(32, 3).toString('base64'), deviceId: 'fixture-device' }),
      async login() { cloud.authenticated = true; }, publicChallenge: () => null, clearLogin() {}, close() {},
      async listHomes() { return [{ id: '1', name: '实际家庭', rooms: [{ id: 'r1', name: '起居室' }] }]; },
      async listDevices() { return [{ id: 'lamp', name: '实际灯具', model: 'fixture.light', online: true, roomId: 'r1', roomName: '起居室' }]; },
      async getSpec() { return spec; },
      async getProperties(params) { return params.map(value => ({ ...value, code: 0, value: value.piid === 1 ? power : 65 })); },
      async setProperties(params) { writes++; return params.map(value => ({ ...value, code: 0 })); },
    }; clouds.push(cloud); return cloud;
  };
  const auth = createAuth({ file: join(root, 'auth.json') }), app = express();
  let stream;
  const service = new MijiaService({ vault: { load: () => stored, save: value => { stored = structuredClone(value); } }, cloudFactory, pollIntervalMs: 60000, onDevicesChanged: () => stream?.publish() });
  const snapshot = () => ({ devices: service.snapshot() });
  stream = createStateStream({ snapshot, sessionFor: auth.sessionFor, subscribeAuth: auth.subscribeSessions });
  app.use(express.json({ limit: '32kb' })); app.use('/api', validateOrigin); app.use('/api/auth', auth.router); app.use('/api', auth.requireAuth); app.use('/api', authorizeHousehold);
  const routes = createMijiaRouter({ service, sessionFor: auth.sessionFor, subscribeAuth: auth.subscribeSessions });
  app.use('/api/integrations/mijia', routes.router); app.get('/api/events', stream.route); app.get('/api/state', (_req, res) => res.json(snapshot()));
  app.patch('/api/devices/:id', async (req, res) => { await service.executeCommand(req.params.id.slice(3), parseDeviceCommand(req.body)); res.json(snapshot()); });
  app.use((error, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : error.status || 500).json({ message: error instanceof z.ZodError ? '输入格式有误' : error.message }));
  const server = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(server)); });
  t.after(() => { routes.close(); service.close(); stream.close(); server.closeAllConnections(); server.close(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, cookie, origin } = {}) {
    const response = await fetch(base + '/api' + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], cache: response.headers.get('cache-control') };
  }
  const admin = await request('/auth/setup', { method: 'POST', body: account });
  async function invite(role) {
    const invite = await request('/auth/invitations', { method: 'POST', cookie: admin.cookie, body: { role, expiresInHours: 24, ...(role === 'guest' ? { accessHours: 1 } : {}) } });
    const joined = await request('/auth/join', { method: 'POST', body: { username: role + '_mijia', password: 'fixture-member-password', displayName: role, code: invite.body.code } });
    assert.equal(joined.status, 200); return joined.cookie;
  }
  return { base, service, clouds, request, admin: admin.cookie, invite, setPower: value => { power = value; }, writes: () => writes, stored: () => stored };
}

test('Mijia management requires authenticated admin; CSRF and strict schemas precede cloud login', async t => {
  const f = await fixture(t), prefix = '/integrations/mijia';
  assert.equal((await f.request(prefix)).status, 401);
  for (const cookie of [await f.invite('member'), await f.invite('guest')]) {
    for (const [path, method, body] of [[prefix, 'GET'], [prefix + '/login', 'POST', {}], [prefix + '/challenge', 'POST', {}], [prefix + '/home', 'POST', {}], [prefix + '/rooms', 'PUT', { bindings: [] }], [prefix + '/refresh', 'POST', {}], [prefix, 'DELETE', {}]]) assert.equal((await f.request(path, { method, body, cookie })).status, 403);
  }
  assert.equal((await f.request(prefix + '/login', { method: 'POST', cookie: f.admin, origin: 'https://other.example', body: { username: 'cloud-user', password: 'cloud-password', region: 'cn' } })).status, 403);
  assert.equal((await f.request(prefix + '/login', { method: 'POST', cookie: f.admin, body: { username: 'cloud-user', password: 'cloud-password', region: 'evil-host', url: 'http://127.0.0.1' } })).status, 400);
  assert.equal(f.clouds.length, 0);
  const status = await f.request(prefix, { cookie: f.admin }); assert.equal(status.cache, 'no-store'); assert.equal(status.body.state, 'unbound');
});

test('home selection, room binding, readback and external reports reach SSE without leaking cloud credentials', async t => {
  const f = await fixture(t), cookie = f.admin, prefix = '/integrations/mijia';
  const logged = await f.request(prefix + '/login', { method: 'POST', cookie, body: { username: 'cloud-user', password: 'cloud-password', region: 'cn' } });
  assert.equal(logged.status, 200); assert.equal(logged.body.state, 'choose_home'); assert.equal(f.stored(), null);
  assert.equal((await f.request(prefix + '/home', { method: 'POST', cookie, body: { homeId: '1' } })).status, 200);
  assert.equal((await f.request(prefix + '/rooms', { method: 'PUT', cookie, body: { bindings: [{ providerRoomId: 'r1', roomId: 'living', roomName: '客厅' }] } })).status, 200);
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(f.base + '/api/events', { headers: { Cookie: cookie }, signal: controller.signal }), reader = response.body.getReader();
  let pending = '';
  async function nextSnapshot() {
    for (;;) {
      const end = pending.indexOf('\n\n');
      if (end >= 0) { const frame = pending.slice(0, end); pending = pending.slice(end + 2); const data = frame.split('\n').find(line => line.startsWith('data: ')); if (data) return JSON.parse(data.slice(6)); continue; }
      const result = await reader.read(); if (result.done) throw Error('stream closed'); pending += new TextDecoder().decode(result.value);
    }
  }
  const first = await nextSnapshot(); assert.equal(first.devices[0].roomId, 'living'); assert.equal(first.devices[0].state.source, 'mijia'); assert.equal(first.devices[0].state.values.power, false);
  const accepted = await f.request('/devices/mi:lamp', { method: 'PATCH', cookie, body: { capability: 'power', value: true } });
  assert.equal(accepted.status, 200); assert.equal(f.writes(), 1); assert.equal(accepted.body.devices[0].state.values.power, false);
  // Simulate a later report, independently of the accepted command target.
  f.setPower(true); await f.service.provider.refresh();
  let updated; do { updated = await nextSnapshot(); } while (!updated.devices[0].state.values.power);
  const encoded = JSON.stringify(updated); assert.ok(!encoded.includes('serviceToken')); assert.ok(!encoded.includes('fixture-cloud-secret')); assert.ok(!encoded.includes('cloud-password'));
  assert.equal(updated.devices[0].state.values.power, true);
  const removed = await f.request(prefix, { method: 'DELETE', cookie, body: {} }); assert.equal(removed.body.state, 'unbound'); assert.equal(f.stored(), null);
  let empty; do { empty = await nextSnapshot(); } while (empty.devices.length); assert.deepEqual(empty.devices, []);
});
