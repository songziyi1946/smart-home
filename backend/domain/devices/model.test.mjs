import {initializeScenes,createRun,executeRun} from '../scenes/service.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Device, DeviceCommand, applyCommand, parseDeviceCommand, validateDeviceState } from './model.mjs';
import { initializeDevices, deviceSnapshot, executeDeviceCommand } from './service.mjs';

const fixture = () => initializeDevices({ accounts: [], events: [] });

test('legacy devices migrate without losing state, IDs, rooms or other household data', () => {
  const original = { devices: [{ id: 'lamp', name: '灯', kind: 'light', room: '客厅', on: false, level: 37 }], events: [{ id: 'event' }] };
  const store = initializeDevices(original);
  assert.deepEqual(store.devices[0], { id: 'lamp', name: '灯', room: '客厅', roomId: 'living', providerId: 'mock', providerDeviceId: 'lamp', capabilities: ['power', 'brightness'] });
  assert.deepEqual(store.deviceStates.lamp.values, { power: false, brightness: 37 });
  assert.deepEqual(store.events, original.events);
  assert.equal(original.devices[0].kind, 'light');
  assert.deepEqual(initializeDevices(JSON.parse(JSON.stringify(store))), store);
  assert.equal(initializeDevices({ devices: [] }).devices.length, 0);
});

test('device schema rejects duplicate capabilities, identities and invalid persisted values', () => {
  const store = fixture();
  assert.throws(() => Device.parse({ ...store.devices[0], capabilities: ['power', 'power'] }));
  assert.throws(() => initializeDevices({ ...store, devices: [store.devices[0], store.devices[0]] }));
  assert.throws(() => initializeDevices({ devices: [{ id: 'x', kind: 'unknown' }] }));
  const device = store.devices[0];
  const state = store.deviceStates[device.id];
  assert.throws(() => validateDeviceState(device, { ...state, deviceId: 'other' }));
  assert.throws(() => validateDeviceState(device, { ...state, values: { cleaning: true } }));
  assert.throws(() => validateDeviceState(device, { ...state, values: { brightness: 101 } }));
});

test('commands validate capability/value combinations and reject unsupported and offline execution', () => {
  const store = fixture();
  const device = store.devices[0];
  const current = store.deviceStates[device.id];
  for (const command of [
    { capability: 'power', value: 'true' }, { capability: 'brightness', value: 0 },
    { capability: 'brightness', value: 101 }, { capability: 'brightness', value: 1.5 },
    { capability: 'position', value: 'half' }, { capability: 'battery', value: 50 },
    { capability: 'cleaning', value: 1 }, { capability: 'unknown', value: true },
    { capability: 'power', value: true, providerId: 'other' },
  ]) assert.throws(() => DeviceCommand.parse(command));
  assert.throws(() => applyCommand(device, current, { capability: 'cleaning', value: true }), { status: 400 });
  assert.throws(() => applyCommand(device, { ...current, online: false }, { capability: 'power', value: true }), { status: 409 });
  const next = applyCommand(device, current, { capability: 'brightness', value: 1 });
  assert.equal(next.values.brightness, 1);
  assert.equal(current.values.brightness, 80);
  assert.equal(next.values.power, current.values.power);
});

test('legacy API actions translate only at the boundary', () => {
  for (const [action, capability, value] of [['power', 'power', false], ['level', 'brightness', 100], ['position', 'position', 'stop'], ['clean', 'cleaning', true]]) {
    assert.deepEqual(parseDeviceCommand({ action, value }), { capability, value });
    assert.deepEqual(parseDeviceCommand({ capability, value }), { capability, value });
  }
  assert.throws(() => parseDeviceCommand({ action: 'level', value: 0 }));
  assert.throws(() => parseDeviceCommand({ action: 'power', capability: 'cleaning', value: true }));
});

test('service resolves household IDs independently from provider IDs', () => {
  const store = fixture();
  store.devices[0].providerDeviceId = 'provider-lamp';
  executeDeviceCommand(store, 'ceiling', { capability: 'power', value: false });
  assert.equal(deviceSnapshot(store)[0].state.values.power, false);
  assert.throws(() => executeDeviceCommand(store, 'provider-lamp', { capability: 'power', value: true }), { status: 404 });
});

test('home, away and sleep scenes retain existing light/AC/curtain/robot behavior', async () => {
  for (const scene of ['home', 'away', 'sleep']) {
    const store = fixture();
    store.deviceStates.ac.values.power = true;
    store.deviceStates.robot.values.cleaning = true;
    initializeScenes(store);
    await executeRun(createRun(store.scenes.find(s=>s.id===scene),'test'),{execute:(id,command)=>executeDeviceCommand(store,id,command),authorized:()=>true,save:()=>{}});
    for (const device of store.devices.filter(d => d.capabilities.includes('brightness'))) {
      assert.equal(store.deviceStates[device.id].values.power, scene === 'home' ? device.roomId === 'living' : scene === 'sleep' && device.id === 'bed');
    }
    assert.equal(store.deviceStates.curtain.values.position, scene === 'home' ? 'open' : 'closed');
    assert.equal(store.deviceStates.ac.values.power, scene !== 'away');
    assert.equal(store.deviceStates.robot.values.cleaning, true);
    assert.equal(store.deviceStates.ceiling.values.brightness, 80);
  }
});
