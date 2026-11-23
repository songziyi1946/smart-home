import test from 'node:test';
import assert from 'node:assert/strict';
import { MijiaService } from './service.mjs';

const homes = [{ id: '1', name: '自己家', rooms: [{ id: 'r1', name: '客厅' }] }, { id: '2', name: '另一处家庭', rooms: [] }];
const credentials = { region: 'cn', sid: 'xiaomiio', userId: 'fixture-user', deviceId: 'fixture-device', serviceToken: 'fixture-service-token', passToken: 'fixture-refresh-token', ssecurity: Buffer.alloc(32, 3).toString('base64') };
class FakeCloud {
  constructor(options) { this.authenticated = !!options.credentials; this.region = options.region; }
  exportCredentials() { return this.authenticated ? { ...credentials, region: this.region } : null; }
  publicChallenge() { return this.currentChallenge; }
  async login(input) {
    if (input.username === 'captcha') this.currentChallenge = { type: 'captcha', image: 'data:image/png;base64,fixture' };
    else if (input.username === 'verification') this.currentChallenge = { type: 'verification', methods: [{ id: 'phone', label: '手机短信' }], sent: false };
    else { this.authenticated = true; this.currentChallenge = null; }
  }
  async sendVerification() { this.currentChallenge.sent = true; }
  async verify() { this.authenticated = true; this.currentChallenge = null; }
  async listHomes() { return structuredClone(homes); }
  clearLogin() { this.currentChallenge = null; }
  close() { this.closed = true; }
}
class FakeProvider {
  constructor(options) { this.options = options; this.listeners = new Set(); this.connected = false; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async start() { this.connected = true; }
  async refresh() { this.connected = true; }
  snapshot() { const room = this.options.roomBindings.r1 ?? { id: 'mijia-room:1:r1', name: '客厅' }; return [{ id: 'mi:lamp', name: '实际灯具', roomId: room.id, room: room.name, providerId: 'mijia', providerDeviceId: 'lamp', capabilities: ['power', 'brightness'], state: { deviceId: 'mi:lamp', source: 'mijia', online: this.connected, values: { power: false, brightness: 60 } } }]; }
  status() { return { connected: this.connected, deviceCount: 1, unsupportedCount: 0, rooms: [{ id: 'r1', name: '客厅', deviceCount: 1 }], lastSyncAt: new Date(0).toISOString() }; }
  async executeCommand(id, command) { this.lastCommand = { id, command }; }
  close() { this.closed = true; this.connected = false; }
}
function fixture(t, overrides = {}) {
  let stored = overrides.stored ?? null, clock = 100000, authorized = true;
  const clouds = [], providers = [], saves = [];
  const vault = { load: () => structuredClone(stored), save: value => { if (vault.fail) throw Error('fixture disk failure'); stored = structuredClone(value); saves.push(stored); } };
  const service = new MijiaService({ vault, now: () => clock,
    cloudFactory: options => { const cloud = new FakeCloud(options); clouds.push(cloud); return cloud; },
    providerFactory: options => { const provider = new FakeProvider(options); providers.push(provider); return provider; }, ...overrides });
  const actor = { id: 'admin', authorized: () => authorized };
  t.after(() => service.close());
  return { service, actor, vault, clouds, providers, saves, stored: () => stored, advance: ms => { clock += ms; }, revoke: () => { authorized = false; } };
}
test('credentials are committed only after explicit accessible home selection; public status never leaks them', async t => {
  const f = fixture(t);
  const status = await f.service.login({ username: 'user', password: 'fixture-password', region: 'cn' }, f.actor);
  assert.equal(status.state, 'choose_home'); assert.equal(f.stored(), null); assert.equal(f.service.snapshot().length, 0);
  await assert.rejects(f.service.selectHome('not-yours', f.actor), { status: 400 });
  assert.equal(f.providers.length, 0);
  const connected = await f.service.selectHome('1', f.actor);
  assert.equal(connected.state, 'connected'); assert.equal(f.stored().homeId, '1');
  const publicText = JSON.stringify(connected);
  for (const secret of ['serviceToken', 'passToken', 'ssecurity', 'fixture-service-token', 'fixture-password']) assert.ok(!publicText.includes(secret));
  const mapped = await f.service.setRooms([{ providerRoomId: 'r1', roomId: 'living', roomName: '客厅' }], f.actor);
  assert.equal(mapped.rooms[0].mappedRoomId, 'living'); assert.equal(f.service.snapshot()[0].roomId, 'living');
  assert.equal(f.providers[0].closed, true);
});
test('challenge ownership, explicit SMS sending, throttling, expiry and logout are enforced', async t => {
  const f = fixture(t);
  let status = await f.service.login({ username: 'verification', password: 'fixture-password', region: 'cn' }, f.actor);
  const id = status.challenge.id; assert.equal(status.challenge.sent, false);
  assert.equal(f.service.status('other-admin').challenge, undefined);
  await assert.rejects(f.service.challenge({ id, action: 'send', method: 'phone' }, { id: 'other-admin', authorized: () => true }), { status: 409 });
  status = await f.service.challenge({ id, action: 'send', method: 'phone' }, f.actor); assert.equal(status.challenge.sent, true);
  await assert.rejects(f.service.challenge({ id, action: 'send', method: 'phone' }, f.actor), { status: 429 });
  f.revoke(); f.service.revokeInvalidLogin(); assert.equal(f.clouds[0].closed, true);
  assert.equal(f.service.status('admin').state, 'unbound'); assert.equal(f.stored(), null);
});
test('expired captcha cannot finish authorization or persist credentials', async t => {
  const f = fixture(t); const status = await f.service.login({ username: 'captcha', password: 'fixture-password', region: 'cn' }, f.actor);
  f.advance(300001);
  await assert.rejects(f.service.challenge({ id: status.challenge.id, action: 'captcha', captcha: 'answer' }, f.actor), { status: 409 });
  assert.equal(f.clouds[0].closed, true); assert.equal(f.stored(), null);
});
test('failed credential commit leaves previous provider and persisted configuration unchanged', async t => {
  const f = fixture(t);
  await f.service.login({ username: 'user', password: 'fixture-password', region: 'cn' }, f.actor);
  await f.service.selectHome('1', f.actor); const previous = structuredClone(f.stored()), provider = f.providers[0];
  f.vault.fail = true;
  await assert.rejects(f.service.setRooms([{ providerRoomId: 'r1', roomId: 'living', roomName: '客厅' }], f.actor), { status: 502 });
  assert.deepEqual(f.stored(), previous); assert.equal(provider.closed, undefined); assert.equal(f.providers[1].closed, true);
  await assert.rejects(async () => f.service.unlink(f.actor)); assert.equal(f.service.status('admin').state, 'connected');
});
test('unlink fences a late home discovery and late connection install', async t => {
  const f = fixture(t); await f.service.login({ username: 'user', password: 'fixture-password', region: 'cn' }, f.actor);
  let release; const ready = new Promise(resolve => { release = resolve; });
  f.service.providerFactory = options => { const provider = new FakeProvider(options); provider.start = async () => { await ready; provider.connected = true; }; f.providers.push(provider); return provider; };
  const selecting = f.service.selectHome('1', f.actor); f.service.unlink(f.actor); release();
  await assert.rejects(selecting, { status: 409 });
  assert.equal(f.stored(), null); assert.deepEqual(f.service.snapshot(), []); assert.equal(f.providers[0].closed, true);
});
test('persisted connection starts its recovery loop even when home catalogue is initially unavailable', async t => {
  let online = false, discoveries = 0;
  const cloud = new FakeCloud({ region: 'cn', credentials });
  cloud.listHomes = async () => { if (!online) throw Error('fixture network'); return structuredClone(homes); };
  cloud.listDevices = async () => { discoveries++; if (!online) throw Error('fixture network'); return [{ id: 'lamp', name: '灯', model: 'fixture.light', online: true, roomId: 'r1', roomName: '客厅' }]; };
  cloud.getSpec = async () => ({ services: [{ iid: 2, type: 'urn:miot-spec-v2:service:light:test', properties: [{ iid: 1, type: 'urn:miot-spec-v2:property:on:test', format: 'bool', access: ['read', 'write'] }] }] });
  cloud.getProperties = async params => params.map(value => ({ ...value, code: 0, value: true }));
  const { MijiaProvider } = await import('./index.mjs');
  const f = fixture(t, { stored: { credentials, homeId: '1', roomBindings: {} }, cloudFactory: () => cloud, providerFactory: options => new MijiaProvider(options), pollIntervalMs: 60000 });
  await f.service.start(); assert.ok(discoveries > 0); assert.equal(f.service.status('admin').state, 'offline');
  online = true; await f.service.refresh(f.actor);
  assert.equal(f.service.status('admin').state, 'connected'); assert.equal(f.service.snapshot()[0].state.values.power, true);
});
test('a send-code image challenge can be answered immediately without consuming the SMS resend interval', async t => {
  const f = fixture(t); const status = await f.service.login({ username: 'verification', password: 'fixture-password', region: 'cn' }, f.actor);
  const cloud = f.clouds[0]; let attempts = 0;
  cloud.sendVerification = async () => { cloud.currentChallenge = ++attempts === 1 ? { type: 'verification', methods: [{ id: 'phone', label: '手机' }], sent: false, captchaImage: 'data:image/png;base64,fixture' } : { type: 'verification', methods: [{ id: 'phone', label: '手机' }], sent: true }; };
  const challenged = await f.service.challenge({ id: status.challenge.id, action: 'send', method: 'phone' }, f.actor); assert.equal(challenged.challenge.sent, false);
  const sent = await f.service.challenge({ id: status.challenge.id, action: 'send', method: 'phone', captcha: 'answer' }, f.actor);
  assert.equal(sent.challenge.sentMethod, 'phone'); assert.equal(sent.challenge.sent, true); assert.equal(attempts, 2);
});
