import { Device, deviceError, validateDeviceState } from './model.mjs';
import { MockProvider } from '../../providers/mock/index.mjs';
import { legacySeedDevices } from '../../providers/mock/seed.mjs';

const legacyCapabilities = { light: ['power', 'brightness'], ac: ['power'], curtain: ['position'], robot: ['cleaning', 'battery'] };
const roomIds = { '客厅': 'living', '餐厅': 'dining', '主卧': 'master-bedroom', '主卫': 'master-bathroom', '卫生间': 'master-bathroom' };

export function initializeDevices(input) {
  const store = structuredClone(input);
  store.devices ??= structuredClone(legacySeedDevices);
  store.deviceStates ??= {};
  store.devices = store.devices.map(item => {
    if (!Object.hasOwn(item, 'kind')) {
      const device = Device.parse(item);
      validateDeviceState(device, store.deviceStates[device.id]);
      return device;
    }
    const capabilities = legacyCapabilities[item.kind];
    if (!capabilities) throw deviceError(400, '未知旧设备类型');
    const device = Device.parse({ id: item.id, name: item.name, room: item.room,
      roomId: roomIds[item.room] ?? `room-${encodeURIComponent(item.room)}`,
      providerId: 'mock', providerDeviceId: item.id, capabilities });
    const values = {};
    for (const [oldKey, key] of Object.entries({ on: 'power', level: 'brightness', position: 'position', cleaning: 'cleaning', battery: 'battery' })) {
      if (Object.hasOwn(item, oldKey)) values[key] = item[oldKey];
    }
    store.deviceStates[device.id] = validateDeviceState(device, { deviceId: device.id, source: 'mock', online: true, values });
    return device;
  });
  if (new Set(store.devices.map(d => d.id)).size !== store.devices.length ||
      new Set(store.devices.map(d => JSON.stringify([d.providerId, d.providerDeviceId]))).size !== store.devices.length) {
    throw deviceError(400, '设备标识重复');
  }
  return store;
}

export function deviceSnapshot(store) {
  const provider = new MockProvider(store);
  return provider.discoverOrListDevices().map(device => ({ ...device, state: provider.getDeviceState(device.providerDeviceId) }));
}
export function executeDeviceCommand(store, id, command) {
  const device = store.devices.find(item => item.id === id);
  if (!device) throw deviceError(404, '设备不存在');
  if (device.providerId !== 'mock') throw deviceError(400, '设备 Provider 不可用');
  return new MockProvider(store).executeCommand(device.providerDeviceId, command);
}
