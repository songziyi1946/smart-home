import { applyCommand, deviceError, validateDeviceState } from '../../domain/devices/model.mjs';

// This provider owns the supplied transaction draft, never the live persisted state.
/** @implements {import('../../../packages/contracts/devices.ts').DeviceProvider} */
export class MockProvider {
  constructor(store) { this.store = store; }
  discoverOrListDevices() {
    return structuredClone(this.store.devices.filter(device => device.providerId === 'mock'));
  }
  find(id) {
    const device = this.store.devices.find(item => item.providerId === 'mock' && item.providerDeviceId === id);
    if (!device) throw deviceError(404, '设备不存在');
    return device;
  }
  getDeviceState(id) {
    const device = this.find(id);
    return validateDeviceState(device, this.store.deviceStates[device.id]);
  }
  executeCommand(id, command) {
    const device = this.find(id);
    const next = applyCommand(device, this.getDeviceState(id), command);
    this.store.deviceStates[device.id] = next;
    return structuredClone(next);
  }
}
