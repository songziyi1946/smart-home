import { Device, DeviceCommand, validateDeviceState, deviceError } from '../../domain/devices/model.mjs';

const modes = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const toC = (value, unit) => unit === '°F' ? (Number(value) - 32) * 5 / 9 : Number(value);
const fromC = (value, unit) => unit === '°F' ? value * 9 / 5 + 32 : value;
export const deviceId = entityId => `ha:${entityId}`;

/** One HA entity becomes one domain device. HA attributes never enter UI metadata. */
export function mapEntity(entity, rooms = {}) {
  if (!entity || !/^[a-z_]+\.[a-z0-9_]+$/.test(entity.entity_id ?? '')) return null;
  const domain = entity.entity_id.split('.')[0];
  const a = entity.attributes ?? {};
  const features = Number(a.supported_features ?? 0);
  const capabilities = [];
  const values = {};
  const online = !['unavailable', 'unknown'].includes(entity.state);
  const add = (key, value) => { capabilities.push(key); if (online && value !== undefined) values[key] = value; };
  if (domain === 'light') {
    add('power', entity.state === 'on');
    if(a.supported_color_modes?.includes('color_temp'))add('colorTemperature',finite(a.color_temp_kelvin)?Number(a.color_temp_kelvin):undefined);
    if ((a.supported_color_modes ?? []).some(mode => !['onoff', 'unknown'].includes(mode)) || (features & 1)) {
      add('brightness', finite(a.brightness) ? Math.max(1, Math.round(Number(a.brightness) * 100 / 255)) : undefined);
    }
  } else if (domain === 'climate') {
    const hvacModes = (a.hvac_modes ?? []).filter(mode => modes.includes(mode));
    if (hvacModes.includes('off') && hvacModes.some(mode => mode !== 'off')) add('power', entity.state !== 'off');
    if (hvacModes.length) add('hvacMode', modes.includes(entity.state) ? entity.state : undefined);
    if (features & 1) add('targetTemperature', finite(a.temperature) ? toC(a.temperature, a.temperature_unit) : undefined);
    add('temperature', finite(a.current_temperature) ? toC(a.current_temperature, a.temperature_unit) : undefined);
    if (finite(a.current_humidity)) add('humidity', Number(a.current_humidity));
  } else if (domain === 'cover') {
    if ((features & 11) === 11) add('position', ['open', 'closed'].includes(entity.state) ? entity.state : undefined);
    if(features & 4)add('positionPercent',finite(a.current_position)?Number(a.current_position):undefined);
  } else if (domain === 'vacuum') {
    if ((features & 8196) === 8196) add('cleaning', entity.state === 'cleaning');
    if ((features & 64) || finite(a.battery_level)) add('battery', finite(a.battery_level) ? Number(a.battery_level) : undefined);
  } else if (domain === 'sensor') {
    if (a.device_class === 'temperature' && ['°C', '°F'].includes(a.unit_of_measurement)) {
      add('temperature', finite(entity.state) ? toC(entity.state, a.unit_of_measurement) : undefined);
    } else if (a.device_class === 'humidity' && a.unit_of_measurement === '%') {
      add('humidity', finite(entity.state) ? Number(entity.state) : undefined);
    }
    if(['pm25','carbon_dioxide'].includes(a.device_class))add(a.device_class==='pm25'?'pm25':'co2',finite(entity.state)?Number(entity.state):undefined);
  } else if (domain === 'binary_sensor') {
    add('binary', ['on', 'off'].includes(entity.state) ? entity.state === 'on' : undefined);
    if(a.device_class==='motion'||a.device_class==='occupancy')add('occupancy',entity.state==='on');
    if(a.device_class==='door')add('contact',entity.state==='on'?'open':'closed');
  }
  if (!capabilities.length) return null;
  const room = rooms[entity.entity_id] ?? { id: 'unassigned', name: '未分配' };
  const device = Device.parse({ id: deviceId(entity.entity_id), name: a.friendly_name || entity.entity_id,
    roomId: room.id, room: room.name, providerId: 'home-assistant', providerDeviceId: entity.entity_id, capabilities });
  const timestamp = Date.parse(entity.last_updated);
  const state = validateDeviceState(device, { deviceId: device.id, source: a.source === 'simulator' ? 'simulator' : 'home-assistant', online, values,
    ...(Number.isFinite(Date.parse(a.last_seen)) ? {lastSeenAt:new Date(a.last_seen).toISOString()} : {}),
    ...(Number.isFinite(timestamp) ? { updatedAt: new Date(timestamp).toISOString() } : {}) });
  return { device, state };
}

export function commandToService(entity, input) {
  const command = DeviceCommand.parse(input);
  const mapped = mapEntity(entity);
  if (!mapped?.device.capabilities.includes(command.capability)) throw deviceError(400, '设备不支持此操作');
  if (!mapped.state.online) throw deviceError(409, '设备已离线');
  const domain = entity.entity_id.split('.')[0];
  const a = entity.attributes ?? {};
  const data = { entity_id: entity.entity_id };
  let service;
  if (command.capability === 'power') {
    if (domain === 'light') service = command.value ? 'turn_on' : 'turn_off';
    if (domain === 'climate') {
      service = 'set_hvac_mode';
      data.hvac_mode = command.value ? (a.hvac_modes.includes(entity.state) && entity.state !== 'off' ? entity.state : a.hvac_modes.find(mode => modes.includes(mode) && mode !== 'off')) : 'off';
    }
  } else if (command.capability === 'brightness') { service = 'turn_on'; data.brightness_pct = command.value; }
  else if (command.capability === 'colorTemperature') {service='turn_on';data.color_temp_kelvin=command.value;}
  else if (command.capability === 'positionPercent') {service='set_cover_position';data.position=command.value;}
  else if (command.capability === 'position') service = { open: 'open_cover', closed: 'close_cover', stop: 'stop_cover' }[command.value];
  else if (command.capability === 'cleaning') service = command.value ? 'start' : 'pause';
  else if (command.capability === 'hvacMode') {
    if (!a.hvac_modes?.includes(command.value)) throw deviceError(400, '设备不支持此空调模式');
    service = 'set_hvac_mode'; data.hvac_mode = command.value;
  } else if (command.capability === 'targetTemperature') {
    const value = fromC(command.value, a.temperature_unit);
    if ((finite(a.min_temp) && value < Number(a.min_temp)) || (finite(a.max_temp) && value > Number(a.max_temp))) throw deviceError(400, '目标温度超出设备范围');
    service = 'set_temperature'; data.temperature = value;
  }
  if (!service) throw deviceError(400, '设备不支持此操作');
  return { domain, service, data };
}
