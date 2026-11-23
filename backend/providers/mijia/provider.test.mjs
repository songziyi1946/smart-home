import test from 'node:test';
import assert from 'node:assert/strict';
import { MijiaProvider } from './index.mjs';

const spec = { services: [{ iid: 2, type: 'urn:miot-spec-v2:service:light:test', properties: [
  { iid: 1, type: 'urn:miot-spec-v2:property:on:test', format: 'bool', access: ['read', 'write'] },
  { iid: 2, type: 'urn:miot-spec-v2:property:brightness:test', format: 'uint8', access: ['read', 'write'], 'value-range': [1, 100, 1], unit: 'percentage' },
] }] };
function fixture(t, options = {}) {
  let power = false, online = true, failed, acknowledgeOnly = false, sets = 0, reads = 0;
  let devices = [{ id: 'lamp', name: '真实灯', model: 'light.test', online, roomId: 'r1', roomName: '云端客厅' }];
  const cloud = {
    authenticated: true,
    async listDevices() { if (failed) throw Object.assign(Error('must-not-leak-upstream-secret'), { code: failed }); return devices.map(device => ({ ...device, online })); },
    async getSpec() { return spec; },
    async getProperties(params) { reads++; return params.map(property => ({ ...property, code: 0, value: property.piid === 1 ? power : 50 })); },
    async setProperties(params) { sets++; if (!acknowledgeOnly) power = params[0].value; return params.map(property => ({ did: property.did, siid: property.siid, piid: property.piid, code: 0 })); },
  };
  const statuses = [], provider = new MijiaProvider({ cloud, homeId: 'h1', roomBindings: { r1: { id: 'living', name: '客厅' } }, onStatus: status => statuses.push(status), ...options });
  t.after(() => provider.close());
  return { provider, cloud, statuses, sets: () => sets, reads: () => reads, setPower(value) { power = value; }, fail(code) { failed = code; }, setOnline(value) { online = value; }, setDevices(value) { devices = value; }, acknowledgeOnly() { acknowledgeOnly = true; } };
}
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Timed out'); }

test('discovers normalized devices, publishes external changes and removes deleted devices', async t => {
  const f = fixture(t), events = []; f.provider.subscribe(event => events.push(event));
  await f.provider.start();
  assert.equal(f.provider.connected, true); assert.equal(f.provider.snapshot()[0].roomId, 'living');
  assert.equal(f.provider.snapshot()[0].state.source, 'mijia'); assert.equal(f.provider.snapshot()[0].state.values.power, false);
  const copy = f.provider.snapshot(); copy[0].state.values.power = true; assert.equal(f.provider.snapshot()[0].state.values.power, false);
  f.setPower(true); await f.provider.refresh(); assert.equal(events.at(-1).state.values.power, true);
  f.setDevices([]); await f.provider.refresh(); assert.deepEqual(f.provider.snapshot(), []);
  assert.deepEqual(events.at(-1), { removedDeviceId: 'mi:lamp' });
});

test('writes once, reads back actual feedback and never substitutes the requested target', async t => {
  const f = fixture(t); await f.provider.start();
  f.acknowledgeOnly();
  const state = await f.provider.executeCommand('lamp', { capability: 'power', value: true });
  assert.equal(f.sets(), 1); assert.equal(state.values.power, false);
  assert.ok(f.reads() >= 3);
  await assert.rejects(f.provider.executeCommand('lamp', { capability: 'cleaning', value: true }), { status: 400 });
  assert.equal(f.sets(), 1);
  f.setOnline(false); await f.provider.refresh();
  await assert.rejects(f.provider.executeCommand('lamp', { capability: 'power', value: true }), { status: 409 });
  assert.equal(f.sets(), 1);
});

test('network failures preserve offline cache, suppress secret details and establish a fresh reconnect baseline', async t => {
  const f = fixture(t), events = []; f.provider.subscribe(event => events.push(event));
  f.setPower(true); await f.provider.start(); const lastSeen = f.provider.snapshot()[0].state.lastSeenAt;
  f.fail('upstream_failure'); await assert.rejects(f.provider.refresh(), error => error.status === 502 && !error.message.includes('secret'));
  const stale = f.provider.snapshot()[0].state; assert.equal(stale.online, false); assert.equal(stale.values.power, true); assert.equal(stale.lastSeenAt, lastSeen);
  assert.equal(events.at(-1).state.online, false); assert.equal(JSON.stringify(f.provider.status()).includes('secret'), false);
  f.fail(undefined); f.setPower(false); await f.provider.refresh(); assert.equal(events.at(-1).state.online, true); assert.equal(events.at(-1).state.values.power, false);
});

test('expired authorization stops recurring requests and exposes only a reauthentication status', async t => {
  const f = fixture(t, { pollIntervalMs: 20 }); await f.provider.start();
  f.fail('auth_expired'); await assert.rejects(f.provider.refresh(), { code: 'auth_expired', status: 409 });
  assert.equal(f.provider.status().authExpired, true); const count = f.reads(); await new Promise(resolve => setTimeout(resolve, 70)); assert.equal(f.reads(), count);
});

test('polling observes external state and a closed provider discards an in-flight late response', async t => {
  const f = fixture(t, { pollIntervalMs: 20 }), events = []; f.provider.subscribe(event => events.push(event));
  await f.provider.start(); f.setPower(true); await until(() => f.provider.snapshot()[0]?.state.values.power === true);
  let complete; f.cloud.listDevices = () => new Promise(resolve => { complete = resolve; });
  const pending = f.provider.refresh(); const count = events.length; f.provider.close(); complete([{ id: 'late', online: true }]); await pending;
  assert.equal(events.length, count); assert.equal(f.provider.connected, false); assert.equal(f.provider.snapshot()[0].providerDeviceId, 'lamp');
});

test('concurrent refreshes share one request and unsupported specifications do not create fake devices', async t => {
  const f = fixture(t); await f.provider.start();
  let complete, calls = 0; f.cloud.listDevices = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
  const one = f.provider.refresh(), two = f.provider.refresh(); assert.equal(one, two); complete([]); await Promise.all([one, two]); assert.equal(calls, 1);
  f.cloud.listDevices = async () => [{ id: 'unsupported', online: true, model: 'unknown', roomId: 'r2', roomName: '书房' }];
  f.cloud.getSpec = async () => ({ services: [] }); await f.provider.refresh();
  assert.equal(f.provider.status().unsupportedCount, 1); assert.equal(f.provider.status().rooms[0].deviceCount, 1); assert.deepEqual(f.provider.snapshot(), []);
  f.cloud.listDevices = async () => [{ id: 'no-spec-identity', online: true }];
  f.cloud.getSpec = async () => { throw Error('An unidentified model must not be queried'); };
  await f.provider.refresh(); assert.equal(f.provider.status().unsupportedCount, 1); assert.deepEqual(f.provider.snapshot(), []);
});

test('property reads are batched and spec discovery has bounded concurrency', async t => {
  const f = fixture(t), batches = []; let active = 0, maximum = 0;
  f.cloud.listDevices = async () => Array.from({ length: 120 }, (_, index) => ({ id: String(index), model: 'light.' + index, name: '灯 ' + index, online: true, roomId: 'r1', roomName: '客厅' }));
  f.cloud.getSpec = async () => { active++; maximum = Math.max(active, maximum); await new Promise(resolve => setImmediate(resolve)); active--; return spec; };
  f.cloud.getProperties = async params => { batches.push(params.length); return params.map(property => ({ ...property, code: 0, value: property.piid === 1 ? false : 50 })); };
  await f.provider.start(); assert.equal(f.provider.snapshot().length, 120);
  assert.ok(maximum <= 4); assert.equal(Math.max(...batches), 50); assert.equal(batches.reduce((sum, value) => sum + value, 0), 240);
});

test('write transport failure is sanitized, never retried and marks the cached device offline', async t => {
  const f = fixture(t); await f.provider.start(); let attempts = 0;
  f.cloud.setProperties = async () => { attempts++; throw Object.assign(Error('secret-upstream-url'), { status: 502 }); };
  await assert.rejects(f.provider.executeCommand('lamp', { capability: 'power', value: true }), error => error.status === 502 && !error.message.includes('secret'));
  assert.equal(attempts, 1); assert.equal(f.provider.connected, false); assert.equal(f.provider.snapshot()[0].state.online, false);
  assert.equal(f.provider.snapshot()[0].state.values.power, false);
});

test('closing a connection during command preparation prevents a late physical write', async t => {
  const f = fixture(t); await f.provider.start(); let complete;
  f.cloud.listDevices = () => new Promise(resolve => { complete = resolve; });
  const pending = f.provider.executeCommand('lamp', { capability: 'power', value: true });
  f.provider.close(); complete([]); await assert.rejects(pending, { status: 409 }); assert.equal(f.sets(), 0);
});
