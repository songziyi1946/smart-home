import test from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider } from './index.mjs';
import { initializeDevices } from '../../domain/devices/service.mjs';

function fixture() {
  const store = initializeDevices({});
  return { store, provider: new MockProvider(store) };
}
test('provider lists metadata separately from state and returns isolated snapshots', () => {
  const { provider } = fixture();
  const devices = provider.discoverOrListDevices();
  assert.equal(devices.length, 9);
  assert.equal(devices[0].on, undefined);
  assert.equal(devices[0].state, undefined);
  devices[0].capabilities.length = 0;
  assert.deepEqual(provider.discoverOrListDevices()[0].capabilities, ['power', 'brightness']);
  const state = provider.getDeviceState('ceiling');
  state.values.power = false;
  assert.equal(provider.getDeviceState('ceiling').values.power, true);
  assert.equal(state.source, 'mock');
});
test('provider executes all existing controls and persists into the transaction store', () => {
  const { store, provider } = fixture();
  for (const [id, capability, values] of [
    ['ceiling', 'power', [false, true]], ['ac', 'power', [true, false]],
    ['ceiling', 'brightness', [1, 100]], ['curtain', 'position', ['closed', 'stop', 'open']],
    ['robot', 'cleaning', [true, false]],
  ]) for (const value of values) {
    const result = provider.executeCommand(id, { capability, value });
    assert.equal(result.values[capability], value);
    assert.equal(provider.getDeviceState(id).values[capability], value);
    result.values[capability] = 'mutated outside';
    assert.equal(provider.getDeviceState(id).values[capability], value);
  }
  const restarted = new MockProvider(initializeDevices(JSON.parse(JSON.stringify(store))));
  assert.deepEqual(restarted.getDeviceState('ceiling'), provider.getDeviceState('ceiling'));
  assert.equal(restarted.getDeviceState('robot').values.battery, 92);
});
test('failed commands leave state unchanged; missing devices fail explicitly', () => {
  const { store, provider } = fixture();
  const before = structuredClone(store);
  assert.throws(() => provider.executeCommand('robot', { capability: 'power', value: true }), { status: 400 });
  assert.throws(() => provider.executeCommand('ceiling', { capability: 'brightness', value: -1 }));
  assert.throws(() => provider.getDeviceState('missing'), { status: 404 });
  assert.throws(() => provider.executeCommand('missing', { capability: 'power', value: true }), { status: 404 });
  assert.deepEqual(store, before);
  store.deviceStates.ceiling.online = false;
  assert.throws(() => provider.executeCommand('ceiling', { capability: 'power', value: false }), { status: 409 });
  assert.equal(store.deviceStates.ceiling.values.power, true);
});
