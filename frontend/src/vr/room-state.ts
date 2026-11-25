import type { DeviceSnapshot } from '../types';
import type { ModelVersion } from '../../../packages/contracts/space-models';
import { isRunning } from '../devices';
import { isSimulatedDevice, metricReading, occupancyReading, sourceLabel } from '../homeTelemetry';
import { builtinDesignForVersion } from './builtin-presets';

const legacyRoomId = (name: string) => `room-${encodeURIComponent(name)}`;

// Model IDs stay independent of the existing household room IDs.
const roomBindings: Record<string, string[]> = {
  living: ['living'], dining: ['dining', legacyRoomId('餐厨')], kitchen: ['kitchen', legacyRoomId('厨房'), legacyRoomId('餐厨')],
  bedroom: ['master-bedroom', 'bedroom'], ensuite: ['master-bathroom', 'ensuite'],
  'second-bedroom': ['second-bedroom', legacyRoomId('次卧')],
  study: ['study', legacyRoomId('书房')], bath: ['bath', legacyRoomId('次卫'), legacyRoomId('客卫')],
  entry: ['entry', legacyRoomId('入户')], balcony: ['balcony', legacyRoomId('阳台')],
};

export function devicesForModelRoom(devices: DeviceSnapshot[], roomId: string, bindings?: string[]) {
  return devices.filter(device => (bindings ?? roomBindings[roomId] ?? [roomId]).includes(device.roomId));
}

export function roomSummary(devices: DeviceSnapshot[], roomId: string, bindings?: string[]) {
  const matched = devicesForModelRoom(devices, roomId, bindings);
  const actual = matched.filter(device => !isSimulatedDevice(device));
  const roomDevices = actual.length ? actual : matched;
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
    simulated: roomDevices.some(isSimulatedDevice),
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

export function modelRoomAt(x: number, z: number, version?: ModelVersion) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  const designModel = builtinDesignForVersion(version);
  const polygon = version?.plan?.footprint ?? ((!version || version.source === 'builtin') ? designModel.footprint : undefined);
  if (polygon) {
    let inside = false, boundary = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, az] = polygon[j], [bx, bz] = polygon[i];
      if (Math.abs((bx - ax) * (z - az) - (bz - az) * (x - ax)) < 1e-6 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && z >= Math.min(az, bz) && z <= Math.max(az, bz)) boundary = true;
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    }
    if (!inside && !boundary) return;
  }
  return (version?.rooms ?? designModel.rooms).find(room => {
    const b = room.bounds;
    return b && x >= b[0] && x < b[2] && z >= b[1] && z < b[3];
  });
}

export function isRoomClick(start: { x: number; y: number; moved: boolean }, end: { x: number; y: number }) {
  return !start.moved && Math.hypot(end.x - start.x, end.y - start.y) <= 6;
}
