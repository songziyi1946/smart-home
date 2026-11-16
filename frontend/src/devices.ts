import type { Capability, DeviceSnapshot, DeviceCommand } from './types';

export function hasCapability(device: DeviceSnapshot, capability: Capability) {
  return device.capabilities.includes(capability);
}
// shortcut: current power-only devices are ACs; add presentation metadata before introducing plugs or other power-only devices.
export function isClimate(device: DeviceSnapshot) {
  return hasCapability(device, 'power') && !hasCapability(device, 'brightness');
}
export function isRunning(device: DeviceSnapshot) {
  return device.state.online && (device.state.values.power === true || device.state.values.cleaning === true);
}

export function roomPowerCommand(device: DeviceSnapshot, enabled: boolean): DeviceCommand | undefined {
  if (hasCapability(device, 'power')) return { capability: 'power', value: enabled };
  if (hasCapability(device, 'position')) return { capability: 'position', value: enabled ? 'open' : 'closed' };
  if (!enabled && hasCapability(device, 'cleaning')) return { capability: 'cleaning', value: false };
}
