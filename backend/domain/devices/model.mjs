import { z } from 'zod';

export const Capability = z.enum(['power', 'brightness', 'position', 'cleaning', 'battery', 'temperature', 'humidity', 'binary', 'targetTemperature', 'hvacMode', 'colorTemperature', 'positionPercent', 'pm25', 'co2', 'occupancy', 'contact']);
const valueSchemas = {
  colorTemperature: z.number().int().min(2000).max(6500),
  positionPercent: z.number().min(0).max(100),
  pm25: z.number().min(0).max(1000), co2: z.number().min(0).max(10000),
  occupancy: z.boolean(), contact: z.enum(['open','closed']),
  temperature: z.number().finite().min(-100).max(200),
  humidity: z.number().finite().min(0).max(100),
  binary: z.boolean(),
  targetTemperature: z.number().finite().min(-100).max(200),
  hvacMode: z.enum(['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only']),
  power: z.boolean(),
  brightness: z.number().int().min(1).max(100),
  position: z.enum(['open', 'stop', 'closed']),
  cleaning: z.boolean(),
  battery: z.number().int().min(0).max(100),
};
export const Device = z.object({
  id: z.string().min(1), name: z.string().min(1), roomId: z.string().min(1), room: z.string().min(1),
  providerId: z.string().min(1), providerDeviceId: z.string().min(1),
  capabilities: z.array(Capability).min(1).refine(items => new Set(items).size === items.length),
}).strict();
export const DeviceState = z.object({
  deviceId: z.string().min(1), source: z.enum(['mock', 'home-assistant', 'mijia', 'simulator']), online: z.boolean(),
  lastSeenAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  values: z.object(Object.fromEntries(Object.entries(valueSchemas).map(([key, schema]) => [key, schema.optional()]))).strict(),
}).strict();
export const DeviceCommand = z.discriminatedUnion('capability',
  Object.entries(valueSchemas).filter(([key]) => !['battery', 'temperature', 'humidity', 'binary', 'pm25', 'co2', 'occupancy', 'contact'].includes(key)).map(([key, value]) =>
    z.object({ capability: z.literal(key), value }).strict()));

export function deviceError(status, message) {
  return Object.assign(new Error(message), { status });
}
export function validateDeviceState(device, state) {
  Device.parse(device);
  const parsed = DeviceState.parse(state);
  if (parsed.deviceId !== device.id || Object.keys(parsed.values).some(key => !device.capabilities.includes(key))) {
    throw deviceError(400, '设备状态与能力不匹配');
  }
  return parsed;
}
export function applyCommand(device, state, input) {
  const command = DeviceCommand.parse(input);
  const current = validateDeviceState(device, state);
  if (!device.capabilities.includes(command.capability)) throw deviceError(400, '设备不支持此操作');
  if (!current.online) throw deviceError(409, '设备已离线');
  return { ...current, values: { ...current.values, [command.capability]: command.value } };
}

// Existing PATCH clients remain supported at the API boundary only.
export function parseDeviceCommand(input) {
  if (input && Object.hasOwn(input, 'action')) {
    const legacy = z.discriminatedUnion('action', [
      z.object({ action: z.literal('power'), value: valueSchemas.power }).strict(),
      z.object({ action: z.literal('level'), value: valueSchemas.brightness }).strict(),
      z.object({ action: z.literal('position'), value: valueSchemas.position }).strict(),
      z.object({ action: z.literal('clean'), value: valueSchemas.cleaning }).strict(),
    ]).parse(input);
    return { capability: { power: 'power', level: 'brightness', position: 'position', clean: 'cleaning' }[legacy.action], value: legacy.value };
  }
  return DeviceCommand.parse(input);
}
