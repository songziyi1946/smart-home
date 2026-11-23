import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceMapping, readDeviceState, commandToProperty } from './mapping.mjs';

const type = (category, name) => `urn:miot-spec-v2:${category}:${name}:test`;
const property = (iid, name, format, access, range, unit) => ({ iid, type: type('property', name), format, access, ...(range ? { 'value-range': range } : {}), ...(unit ? { unit } : {}) });
const service = (name, properties, iid = 2) => ({ iid, type: type('service', name), properties });
const raw = (extra = {}) => ({ id: '123', name: '客厅灯', online: true, roomId: 'room-1', roomName: '来源房间', ...extra });
const mapped = (...services) => createDeviceMapping(raw(), { services }, { homeId: 'home-1', roomBindings: { 'room-1': { id: 'living', name: '客厅' } } });
const results = entries => entries.map(([siid, piid, value, code = 0]) => ({ did: '123', siid, piid, value, code }));
const lightSpec = () => service('light', [property(1, 'on', 'bool', ['read', 'write']), property(2, 'brightness', 'uint8', ['read', 'write'], [0, 255, 1], 'percentage'), property(3, 'color-temperature', 'uint16', ['read', 'write'], [153, 500, 1], 'mired')]);

test('normalizes capability-backed light readings and explicit household room mapping without raw data', () => {
  const mapping = mapped(lightSpec());
  assert.deepEqual(mapping.device.capabilities, ['power', 'brightness', 'colorTemperature']);
  assert.equal(mapping.device.id, 'mi:123'); assert.equal(mapping.device.roomId, 'living'); assert.equal(mapping.device.room, '客厅');
  assert.equal(mapping.device.model, undefined); assert.equal(mapping.device.token, undefined);
  const state = readDeviceState(mapping, results([[2, 1, false], [2, 2, 128], [2, 3, 250]]), { online: true, now: '2026-11-23T00:00:00.000Z' });
  assert.deepEqual(state.values, { power: false, brightness: 50, colorTemperature: 4000 });
  assert.equal(state.source, 'mijia'); assert.equal(state.online, true);
  assert.deepEqual(commandToProperty(mapping, state, { capability: 'brightness', value: 50 }), { did: '123', siid: 2, piid: 2, value: 128 });
  assert.deepEqual(commandToProperty(mapping, state, { capability: 'colorTemperature', value: 4000 }), { did: '123', siid: 2, piid: 3, value: 250 });
  const unmapped = createDeviceMapping(raw(), { services: [lightSpec()] }, { homeId: 'home-1' });
  assert.equal(unmapped.device.roomId, 'mijia-room:home-1:room-1');
  assert.equal(unmapped.device.room, '来源房间');
  assert.equal(createDeviceMapping(raw({ roomId: '', roomName: '' }), { services: [lightSpec()] }, { homeId: 'home-1' }).device.roomId, 'unassigned');
});

test('temperature units, decimal steps and explicit mode enums are validated at the command boundary', () => {
  const mode = { ...property(3, 'mode', 'uint8', ['read', 'write']), 'value-list': [{ value: 0, description: 'Off' }, { value: 2, description: 'Cool' }, { value: 4, description: 'Heat' }] };
  const mapping = mapped(service('air-conditioner', [property(1, 'temperature', 'float', ['read'], [32, 122, 0.5], 'fahrenheit'), property(2, 'target-temperature', 'float', ['read', 'write'], [60, 86, 0.5], 'fahrenheit'), mode]));
  const state = readDeviceState(mapping, results([[2, 1, 68], [2, 2, 77], [2, 3, 2]]), { online: true });
  assert.deepEqual(state.values, { temperature: 20, targetTemperature: 25, hvacMode: 'cool' });
  assert.equal(commandToProperty(mapping, state, { capability: 'targetTemperature', value: 25 }).value, 77);
  assert.equal(commandToProperty(mapping, state, { capability: 'hvacMode', value: 'heat' }).value, 4);
  assert.throws(() => commandToProperty(mapping, state, { capability: 'targetTemperature', value: 40 }), { status: 400 });
  assert.throws(() => commandToProperty(mapping, state, { capability: 'targetTemperature', value: 25.1 }), { status: 400 });
  assert.throws(() => commandToProperty(mapping, state, { capability: 'hvacMode', value: 'auto' }), { status: 400 });
  assert.throws(() => commandToProperty(mapping, state, { capability: 'temperature', value: 25 }));
  assert.equal(mapped(service('air-conditioner', [property(1, 'temperature', 'float', ['read'], [-100, 100, 0.1], 'unknown')])), null);
});

test('curtains report actual current position while commands write a separate target', () => {
  const mapping = mapped(service('curtain', [property(1, 'current-position', 'uint8', ['read'], [0, 100, 1], 'percentage'), property(2, 'target-position', 'uint8', ['read', 'write'], [0, 100, 1], 'percentage')]));
  const state = readDeviceState(mapping, results([[2, 1, 20], [2, 2, 80]]), { online: true });
  assert.deepEqual(state.values, { positionPercent: 20 });
  assert.deepEqual(commandToProperty(mapping, state, { capability: 'positionPercent', value: 80 }), { did: '123', siid: 2, piid: 2, value: 80 });
  assert.equal(mapped(service('curtain', [property(2, 'target-position', 'uint8', ['read', 'write'], [0, 100, 1], 'percentage')])), null);
});

test('read-only and unknown capabilities do not become writable switches or fabricated telemetry', () => {
  const readonly = mapped(service('outlet', [property(1, 'on', 'bool', ['read'])]));
  assert.deepEqual(readonly.device.capabilities, ['binary']);
  assert.throws(() => commandToProperty(readonly, { online: true }, { capability: 'power', value: true }), { status: 400 });
  assert.equal(mapped(service('lock', [property(1, 'on', 'bool', ['read', 'write'])])), null);
  const sensors = mapped(service('environment', [property(1, 'relative-humidity', 'uint8', ['read'], [0, 100, 1], 'percentage'), property(2, 'co2-density', 'uint16', ['read'], [0, 10000, 1], 'ppm'), property(3, 'occupancy', 'bool', ['read'])]));
  assert.deepEqual(readDeviceState(sensors, results([[2, 1, 0], [2, 2, 0], [2, 3, false]]), { online: true }).values, { humidity: 0, co2: 0, occupancy: false });
  assert.deepEqual(readDeviceState(sensors, results([[2, 1, 50, -1], [2, 2, '400'], [2, 3, 'true']]), { online: true }).values, {});
  const empty = readDeviceState(sensors, [], { online: true }); assert.equal(empty.online, false); assert.deepEqual(empty.values, {});
});

test('failed or offline readings preserve last confirmed cache and do not advance lastSeenAt', () => {
  const mapping = mapped(lightSpec());
  const previous = readDeviceState(mapping, results([[2, 1, true], [2, 2, 128]]), { online: true, now: '2026-11-23T00:00:00.000Z' });
  const state = readDeviceState(mapping, results([[2, 1, false]]), { online: false, previous, now: '2026-11-23T01:00:00.000Z' });
  assert.equal(state.online, false); assert.equal(state.values.power, true); assert.equal(state.lastSeenAt, previous.lastSeenAt);
  assert.throws(() => commandToProperty(mapping, state, { capability: 'power', value: false }), { status: 409 });
  const fresh = readDeviceState(mapping, results([[2, 1, false], [2, 2, 256]]), { online: true, previous });
  assert.deepEqual(fresh.values, { power: false });
});

test('secondary light channels cannot be combined with the primary light switch and duplicate spec addresses are rejected', () => {
  const primary = service('light', [property(1, 'on', 'bool', ['read', 'write'])], 2);
  const secondary = service('light', [property(1, 'on', 'bool', ['read', 'write']), property(2, 'brightness', 'uint8', ['read', 'write'], [1, 100, 1], 'percentage')], 3);
  const mapping = mapped(primary, secondary);
  assert.deepEqual(mapping.device.capabilities, ['power']);
  assert.throws(() => commandToProperty(mapping, { online: true }, { capability: 'brightness', value: 40 }), { status: 400 });
  assert.equal(mapped(primary, service('light', [property(1, 'brightness', 'uint8', ['read', 'write'], [1, 100, 1], 'percentage')], 2)), null);
});
