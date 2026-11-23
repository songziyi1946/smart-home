import { Device, DeviceCommand, DeviceState, validateDeviceState, deviceError } from '../../domain/devices/model.mjs';

const nameOf = type => typeof type === 'string' ? type.split(':')[3] : '';
const numbers = new Set(['float', 'uint8', 'uint16', 'uint32', 'uint64', 'int8', 'int16', 'int32', 'int64']);
const powerServices = new Set(['light', 'outlet', 'switch', 'air-conditioner', 'air-condition-outlet', 'thermostat', 'heater', 'fan', 'air-purifier', 'humidifier', 'dehumidifier', 'water-heater']);
const climateServices = new Set(['air-conditioner', 'air-condition-outlet', 'thermostat', 'heater']);
const coverServices = new Set(['curtain', 'window-opener', 'window-covering']);
const percentageUnits = new Set(['percentage', '%']);
const temperatureUnits = new Map([['celsius', 'C'], ['°C', 'C'], ['fahrenheit', 'F'], ['°F', 'F']]);
const modeNames = new Map([
  ['off', 'off'], ['关闭', 'off'], ['auto', 'auto'], ['自动', 'auto'],
  ['cool', 'cool'], ['制冷', 'cool'], ['heat', 'heat'], ['制热', 'heat'],
  ['dry', 'dry'], ['除湿', 'dry'], ['fan', 'fan_only'], ['fan-only', 'fan_only'], ['送风', 'fan_only'],
  ['heat-cool', 'heat_cool'], ['冷暖', 'heat_cool'],
]);
const occupancyNames = new Map([
  ['occupied', true], ['motion', true], ['motion-detected', true], ['有人', true],
  ['unoccupied', false], ['nomotion', false], ['no-motion', false], ['无人', false],
]);
const contactNames = new Map([['open', 'open'], ['opened', 'open'], ['打开', 'open'], ['closed', 'closed'], ['close', 'closed'], ['关闭', 'closed']]);
const labelKey = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/[ _]+/g, '-') : '';
const readable = property => Array.isArray(property.access) && property.access.includes('read');
const writable = property => Array.isArray(property.access) && property.access.includes('write');
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const deviceId = id => `mi:${id}`;

function range(property) {
  const value = property['value-range'];
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite) || value[0] >= value[1] || value[2] <= 0) return;
  return value;
}
function numeric(property) {
  if (!numbers.has(property.format)) return;
  const limits = range(property);
  if (!limits) return;
  if (property.format !== 'float' && !limits.every(Number.isInteger)) return;
  return {
    decode(value) {
      if (!finite(value) || value < limits[0] || value > limits[1] || (property.format !== 'float' && !Number.isInteger(value))) return;
      return value;
    },
    encode(value, quantize = false) {
      if (!finite(value) || value < limits[0] - 1e-7 || value > limits[1] + 1e-7) throw deviceError(400, '目标值超出设备支持范围');
      const steps = (value - limits[0]) / limits[2];
      if (!quantize && Math.abs(steps - Math.round(steps)) > 1e-5) throw deviceError(400, '目标值不符合设备步长');
      const encoded = Number((limits[0] + Math.round(steps) * limits[2]).toFixed(8));
      if (encoded < limits[0] || encoded > limits[1]) throw deviceError(400, '目标值超出设备支持范围');
      return encoded;
    },
    limits,
  };
}
function enumeration(property, names) {
  if (!Array.isArray(property['value-list'])) return;
  const forward = new Map(), reverse = new Map(), ambiguous = new Set();
  for (const entry of property['value-list']) {
    const normalized = names.get(labelKey(entry.description));
    if (normalized === undefined || (!finite(entry.value) && typeof entry.value !== 'boolean')) continue;
    if (forward.has(entry.value) || reverse.has(normalized)) { ambiguous.add(normalized); if (forward.has(entry.value)) ambiguous.add(forward.get(entry.value)); continue; }
    forward.set(entry.value, normalized); reverse.set(normalized, entry.value);
  }
  for (const value of ambiguous) { reverse.delete(value); for (const [key, mapped] of forward) if (mapped === value) forward.delete(key); }
  if (!forward.size) return;
  return { decode: value => forward.get(value), encode(value) { if (!reverse.has(value)) throw deviceError(400, '设备不支持此模式'); return reverse.get(value); } };
}
function boolean(property) {
  if (property.format !== 'bool') return;
  return { decode: value => typeof value === 'boolean' ? value : undefined, encode: value => value };
}
const keyOf = property => `${property.siid}:${property.piid}`;

/** Spec properties are internal descriptors; only the normalized device enters snapshots. */
export function createDeviceMapping(raw, spec, { homeId, roomBindings = {} } = {}) {
  if (!raw || typeof raw.id !== 'string' || !raw.id || !Array.isArray(spec?.services)) return null;
  const properties = new Map();
  const controlService = spec.services.find(service => powerServices.has(nameOf(service.type)) || coverServices.has(nameOf(service.type)))?.iid;
  const addresses = new Set();
  const add = (capability, property, conversion, commandProperty = property, commandConversion = conversion) => {
    if (!conversion || !readable(property) || properties.has(capability)) return;
    properties.set(capability, {
      read: { did: raw.id, siid: property.siid, piid: property.piid }, decode: conversion.decode,
      ...(writable(commandProperty) && commandConversion ? { write: { did: raw.id, siid: commandProperty.siid, piid: commandProperty.piid }, encode: commandConversion.encode } : {}),
    });
  };
  for (const service of spec.services.slice(0, 100)) {
    if (!Number.isInteger(service.iid) || service.iid <= 0 || !Array.isArray(service.properties)) continue;
    const serviceName = nameOf(service.type);
    const list = service.properties.slice(0, 1000).filter(property => Number.isInteger(property.iid) && property.iid > 0)
      .map(property => ({ ...property, siid: service.iid, piid: property.iid }));
    for (const property of list) { const address = keyOf(property); if (addresses.has(address)) return null; addresses.add(address); }
    for (const property of list) {
      const name = nameOf(property.type), number = numeric(property), unit = property.unit;
      const readWrite = readable(property) && writable(property);
      if (name === 'on' && powerServices.has(serviceName) && service.iid === controlService) {
        const bool = boolean(property);
        if (readWrite) add('power', property, bool);
        else if (readable(property)) add('binary', property, bool);
      } else if (name === 'brightness' && serviceName === 'light' && service.iid === controlService && readWrite && number && number.limits[0] >= 0 && number.limits[1] > 0) {
        const maximum = number.limits[1];
        add('brightness', property, {
          decode(value) { const rawValue = number.decode(value); return rawValue === undefined ? undefined : Math.round(rawValue / maximum * 100) || undefined; },
          encode: value => number.encode(value / 100 * maximum, true),
        });
      } else if (name === 'color-temperature' && serviceName === 'light' && service.iid === controlService && readWrite && number && ['kelvin', 'mired'].includes(unit)) {
        const normalizedRange = unit === 'mired' ? [1_000_000 / number.limits[1], 1_000_000 / number.limits[0]] : number.limits;
        if (number.limits[0] <= 0 || normalizedRange[0] > 6500 || normalizedRange[1] < 2000) continue;
        add('colorTemperature', property, {
          decode(value) { const rawValue = number.decode(value); return rawValue === undefined || rawValue <= 0 ? undefined : Math.round(unit === 'mired' ? 1_000_000 / rawValue : rawValue); },
          encode: value => number.encode(unit === 'mired' ? 1_000_000 / value : value, true),
        });
      } else if ((name === 'temperature' || name === 'target-temperature') && number && temperatureUnits.has(unit)) {
        const fahrenheit = temperatureUnits.get(unit) === 'F';
        const conversion = {
          decode(value) { const rawValue = number.decode(value); return rawValue === undefined ? undefined : fahrenheit ? (rawValue - 32) * 5 / 9 : rawValue; },
          encode: value => number.encode(fahrenheit ? value * 9 / 5 + 32 : value),
        };
        if (name === 'temperature') add('temperature', property, conversion);
        else if (climateServices.has(serviceName) && service.iid === controlService && readWrite) add('targetTemperature', property, conversion);
      } else if (name === 'mode' && climateServices.has(serviceName) && service.iid === controlService && readWrite) add('hvacMode', property, enumeration(property, modeNames));
      else if (name === 'relative-humidity' && number && percentageUnits.has(unit)) add('humidity', property, number);
      else if (name === 'battery-level' && number && percentageUnits.has(unit)) add('battery', property, number);
      else if (name === 'pm2.5-density' && number && ['μg/m3', 'ug/m3', 'microgram-per-cubic-meter'].includes(unit)) add('pm25', property, number);
      else if (name === 'co2-density' && number && unit === 'ppm') add('co2', property, number);
      else if (['occupancy', 'occupancy-status', 'motion-detection-status'].includes(name)) add('occupancy', property, boolean(property) ?? enumeration(property, occupancyNames));
      else if (['contact-state', 'door-state', 'door-status', 'contact'].includes(name)) add('contact', property, enumeration(property, contactNames));
    }
    if (coverServices.has(serviceName) && service.iid === controlService) {
      const current = list.find(property => nameOf(property.type) === 'current-position' && readable(property));
      const target = list.find(property => nameOf(property.type) === 'target-position' && writable(property));
      const read = current && numeric(current), write = target && numeric(target);
      if (read && write && percentageUnits.has(current.unit) && percentageUnits.has(target.unit) && read.limits[0] === 0 && read.limits[1] === 100 && write.limits[0] === 0 && write.limits[1] === 100) add('positionPercent', current, read, target, write);
    }
  }
  if (!properties.size) return null;
  const rawRoomId = typeof raw.roomId === 'string' ? raw.roomId : '';
  const binding = Object.hasOwn(roomBindings, rawRoomId) ? roomBindings[rawRoomId] : undefined;
  const device = Device.parse({
    id: deviceId(raw.id), name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '米家设备',
    roomId: binding?.id || (rawRoomId ? `mijia-room:${homeId}:${rawRoomId}` : 'unassigned'),
    room: binding?.name || (rawRoomId && typeof raw.roomName === 'string' && raw.roomName.trim() ? raw.roomName.trim() : '未分配'),
    providerId: 'mijia', providerDeviceId: raw.id, capabilities: [...properties.keys()],
  });
  const reads = [...new Map([...properties.values()].map(property => [keyOf(property.read), property.read])).values()];
  return { device, properties, reads };
}

export function readDeviceState(mapping, results, { online, previous, now = new Date().toISOString() } = {}) {
  const values = {}, readings = new Map();
  for (const result of results) if (result?.did === mapping.device.providerDeviceId) readings.set(keyOf(result), result);
  for (const [capability, property] of mapping.properties) {
    const result = readings.get(keyOf(property.read));
    if (!online || result?.code !== 0 || !Object.hasOwn(result, 'value')) continue;
    const value = property.decode(result.value);
    const parsed = DeviceState.shape.values.shape[capability].safeParse(value);
    if (value !== undefined && parsed.success) values[capability] = parsed.data;
  }
  const confirmed = online && Object.keys(values).length > 0;
  return validateDeviceState(mapping.device, { deviceId: mapping.device.id, source: 'mijia', online: !!confirmed,
    values: confirmed ? values : Object.fromEntries(Object.entries(previous?.values ?? {}).filter(([key]) => mapping.properties.has(key))),
    ...(confirmed ? { updatedAt: now, lastSeenAt: now } : {
      ...(previous?.updatedAt ? { updatedAt: previous.updatedAt } : {}), ...(previous?.lastSeenAt ? { lastSeenAt: previous.lastSeenAt } : {}),
    }),
  });
}

export function commandToProperty(mapping, state, input) {
  const command = DeviceCommand.parse(input);
  const property = mapping.properties.get(command.capability);
  if (!property?.write || !property.encode) throw deviceError(400, '设备不支持此操作');
  if (!state?.online) throw deviceError(409, '设备已离线');
  return { ...property.write, value: property.encode(command.value) };
}
