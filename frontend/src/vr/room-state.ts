import type { DeviceSnapshot } from '../types';
import { isRunning } from '../devices';
import { metricReading, occupancyReading, sourceLabel } from '../homeTelemetry';
import { designModel, insideHome } from './plan';

const legacyRoomId = (name: string) => `room-${encodeURIComponent(name)}`;

// Model IDs stay independent of the existing household room IDs.
const roomBindings: Record<string, string[]> = {
  living: ['living'], dining: ['dining', legacyRoomId('餐厨')], kitchen: ['kitchen', legacyRoomId('厨房'), legacyRoomId('餐厨')],
  bedroom: ['master-bedroom', 'bedroom'], ensuite: ['master-bathroom', 'ensuite'],
  'second-bedroom': ['second-bedroom', legacyRoomId('次卧')],
  study: ['study', legacyRoomId('书房')], bath: ['bath', legacyRoomId('次卫'), legacyRoomId('客卫')],
  entry: ['entry', legacyRoomId('入户')], balcony: ['balcony', legacyRoomId('阳台')],
};

export function devicesForModelRoom(devices: DeviceSnapshot[], roomId: string) {
  return devices.filter(device => (roomBindings[roomId] ?? [roomId]).includes(device.roomId));
}

export function roomSummary(devices: DeviceSnapshot[], roomId: string) {
  const roomDevices = devicesForModelRoom(devices, roomId);
  const lights = roomDevices.filter(device => device.capabilities.includes('brightness'));
  const knownLights = lights.filter(device => device.state.online && typeof device.state.values.power === 'boolean');
  const onLights = knownLights.filter(device => device.state.values.power);
  const offline = roomDevices.filter(device => !device.state.online).length;
  const sources = [...new Set(roomDevices.map(sourceLabel))];
  const shared = roomDevices.some(device => device.roomId === legacyRoomId('餐厨'));
  return {
    id: roomId, devices: roomDevices, total: roomDevices.length, offline,
    running: roomDevices.filter(isRunning).length,
    source: sources.join(' / ') || '暂无设备',
    simulated: roomDevices.some(device => device.state.source !== 'home-assistant'),
    shared,
    lightsOn: onLights.length,
    lighting: shared ? undefined : onLights.length ? Math.max(...onLights.map(device =>
      typeof device.state.values.brightness === 'number' ? device.state.values.brightness / 100 : 1))
      : lights.length && knownLights.length === lights.length ? 0 : undefined,
    temperature: metricReading(roomDevices, 'temperature'),
    humidity: metricReading(roomDevices, 'humidity'),
    occupancy: occupancyReading(roomDevices),
  };
}
export type RoomSummary = ReturnType<typeof roomSummary>;

export function modelRoomAt(x: number, z: number) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !insideHome(x, z, 0)) return;
  return designModel.rooms.find(room => x >= room.bounds[0] && x < room.bounds[2] && z >= room.bounds[1] && z < room.bounds[3]);
}

export function isRoomClick(start: { x: number; y: number; moved: boolean }, end: { x: number; y: number }) {
  return !start.moved && Math.hypot(end.x - start.x, end.y - start.y) <= 6;
}
