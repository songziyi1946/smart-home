import type { Capability, DeviceSnapshot, DeviceCommand } from './types';

export function hasCapability(device: DeviceSnapshot, capability: Capability) {
  return device.capabilities.includes(capability);
}
export function isClimate(device: DeviceSnapshot) {
  return hasCapability(device, 'targetTemperature') || hasCapability(device, 'hvacMode');
}
export function isRunning(device: DeviceSnapshot) {
  return device.state.online && (device.state.values.power === true || device.state.values.cleaning === true);
}

export function roomPowerCommand(device: DeviceSnapshot, enabled: boolean): DeviceCommand | undefined {
  if (hasCapability(device, 'power')) return { capability: 'power', value: enabled };
  if (hasCapability(device, 'position')) return { capability: 'position', value: enabled ? 'open' : 'closed' };
  if (hasCapability(device, 'positionPercent')) return { capability: 'positionPercent', value: enabled ? 100 : 0 };
  if (!enabled && hasCapability(device, 'cleaning')) return { capability: 'cleaning', value: false };
}
