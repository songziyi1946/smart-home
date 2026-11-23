import test from 'node:test';
import assert from 'node:assert/strict';
import { devicesForModelRoom, isRoomClick, modelRoomAt, roomSummary } from './room-state.ts';
import { initializeDevices, deviceSnapshot } from '../../../backend/domain/devices/service.mjs';
import { devicePanelNavigation } from './device-history.ts';

const device = (id, roomId, capabilities, values, options = {}) => ({
  id, name: id, roomId, room: options.room ?? '显示名称可以修改', providerId: 'mock', providerDeviceId: id, capabilities,
  state: { deviceId: id, online: options.online ?? true, source: options.source ?? 'mock', values },
});

test('returning from a VR device restores its room drawer while unrelated browser history is ignored', () => {
  assert.deepEqual(devicePanelNavigation('light', undefined, true), { deviceId: undefined, panelOpen: true });
  assert.deepEqual(devicePanelNavigation(undefined, 'light', true), { deviceId: 'light', panelOpen: false });
  assert.deepEqual(devicePanelNavigation('light', 'curtain', true), { deviceId: 'curtain', panelOpen: false });
  assert.equal(devicePanelNavigation(undefined, undefined, true), undefined);
  assert.equal(devicePanelNavigation('light', undefined, false), undefined);
  assert.equal(devicePanelNavigation(undefined, 'other-device', false), undefined);
});

test('real legacy migration keeps kitchen and guest-bathroom aliases associated with model rooms', () => {
  const migrated = deviceSnapshot(initializeDevices({ devices: [
    { id: 'kitchen-old', name: '厨房灯', room: '厨房', kind: 'light', on: false, level: 70 },
    { id: 'bath-old', name: '客卫灯', room: '客卫', kind: 'light', on: true, level: 30 },
    { id: 'shared-old', name: '餐厨灯', room: '餐厨', kind: 'light', on: false, level: 50 },
    { id: 'dining-old', name: '餐厅灯', room: '餐厅', kind: 'light', on: false, level: 50 },
  ] }));
  assert.deepEqual(devicesForModelRoom(migrated, 'kitchen').map(value => value.id), ['kitchen-old', 'shared-old']);
  assert.deepEqual(devicesForModelRoom(migrated, 'bath').map(value => value.id), ['bath-old']);
  assert.deepEqual(devicesForModelRoom(migrated, 'dining').map(value => value.id), ['shared-old', 'dining-old']);
});

test('model selection resolves interior rooms and excludes drawing recesses and invalid coordinates', () => {
  assert.equal(modelRoomAt(1.5, 4.5)?.id, 'living');
  assert.equal(modelRoomAt(6.9, 2)?.id, 'kitchen');
  assert.equal(modelRoomAt(6.9, 5)?.id, 'dining');
  assert.equal(modelRoomAt(9, .4), undefined);
  assert.equal(modelRoomAt(9, 6), undefined);
  assert.equal(modelRoomAt(-1, 2), undefined);
  assert.equal(modelRoomAt(NaN, 2), undefined);
});

test('dragging and multi-touch gestures cannot become a room click even after returning to the origin', () => {
  assert.equal(isRoomClick({ x: 20, y: 30, moved: false }, { x: 23, y: 32 }), true);
  assert.equal(isRoomClick({ x: 20, y: 30, moved: false }, { x: 27, y: 30 }), false);
  assert.equal(isRoomClick({ x: 20, y: 30, moved: true }, { x: 20, y: 30 }), false);
});

test('stable room IDs survive renamed labels and distinct kitchen/dining devices stay distinct', () => {
  const living = device('living-light', 'living', ['power', 'brightness'], { power: true, brightness: 40 });
  const impostor = device('different-room', 'other', ['power'], { power: true }, { room: '客厅' });
  const dining = device('dining-light', 'dining', ['power', 'brightness'], { power: false });
  const kitchen = device('kitchen-light', 'kitchen', ['power', 'brightness'], { power: true });
  const shared = device('shared', `room-${encodeURIComponent('餐厨')}`, ['power'], { power: false });
  const devices = [living, impostor, dining, kitchen, shared];
  assert.deepEqual(devicesForModelRoom(devices, 'living'), [living]);
  assert.deepEqual(devicesForModelRoom(devices, 'dining'), [dining, shared]);
  assert.deepEqual(devicesForModelRoom(devices, 'kitchen'), [kitchen, shared]);
  assert.equal(roomSummary([dining], 'dining').shared, false);
  assert.equal(roomSummary([shared], 'kitchen').shared, true);
  assert.equal(roomSummary([shared], 'kitchen').lighting, undefined);
});

test('room telemetry never invents readings or all-off lighting for an offline or unknown light', () => {
  const empty = roomSummary([], 'living');
  assert.equal(empty.temperature, undefined);
  assert.equal(empty.humidity, undefined);
  assert.equal(empty.lighting, undefined);
  assert.equal(empty.source, '暂无设备');
  const offline = device('offline', 'living', ['power', 'brightness'], { power: true, brightness: 90 }, { online: false });
  const off = device('off', 'living', ['power', 'brightness'], { power: false });
  const sensor = device('sensor', 'living', ['temperature', 'humidity'], { temperature: 0, humidity: 0 });
  const room = roomSummary([offline, off, sensor], 'living');
  assert.equal(room.lighting, undefined);
  assert.equal(room.offline, 1);
  assert.equal(room.running, 0);
  assert.equal(room.temperature.value, 0);
  assert.equal(room.humidity.value, 0);
  assert.equal(room.simulated, true);
  assert.match(room.source, /模拟数据/);
  assert.equal(roomSummary([off], 'living').lighting, 0);
  assert.equal(roomSummary([device('unknown', 'living', ['power', 'brightness'], {})], 'living').lighting, undefined);
});

test('real room devices exclude demonstration devices even when the real light is offline', () => {
  const demo = device('demo-on', 'living', ['power', 'brightness'], {power:true,brightness:100});
  const real = device('mi:lamp', 'living', ['power', 'brightness'], {power:false,brightness:30}, {source:'mijia'});
  const room = roomSummary([demo,real], 'living');
  assert.deepEqual(room.devices,[real]); assert.equal(room.total,1); assert.equal(room.running,0);
  assert.equal(room.lighting,0); assert.equal(room.simulated,false); assert.equal(room.source,'米家');
  const stale = {...real,state:{...real.state,online:false,values:{power:true,brightness:40}}};
  const unavailable = roomSummary([demo,stale], 'living');
  assert.deepEqual(unavailable.devices,[stale]); assert.equal(unavailable.lighting,undefined); assert.equal(unavailable.offline,1);
  const sensor = device('actual-sensor','living',['temperature'],{temperature:25},{source:'home-assistant'});
  assert.deepEqual(roomSummary([demo,sensor],'living').devices,[sensor]);
  assert.equal(roomSummary([demo,sensor],'living').lighting,undefined);
});

test('lighting feedback uses only online capability-backed light values and never AC power', () => {
  const on = device('on', 'living', ['power', 'brightness'], { power: true, brightness: 30 });
  const ac = device('ac', 'living', ['power', 'targetTemperature'], { power: true });
  assert.equal(roomSummary([ac], 'living').lighting, undefined);
  assert.equal(roomSummary([on, ac], 'living').lighting, .3);
  assert.equal(roomSummary([on, ac], 'living').lightsOn, 1);
  assert.equal(on.state.values.brightness, 30);
});
