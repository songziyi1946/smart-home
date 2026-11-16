/** Provider-independent household device contract. */
export type Capability = 'power' | 'brightness' | 'position' | 'cleaning' | 'battery' | 'temperature' | 'humidity' | 'binary' | 'targetTemperature' | 'hvacMode' | 'colorTemperature' | 'positionPercent' | 'pm25' | 'co2' | 'occupancy' | 'contact';
export type Device = {
  id: string;
  name: string;
  roomId: string;
  room: string;
  providerId: string;
  providerDeviceId: string;
  capabilities: Capability[];
};
export type DeviceState = {
  deviceId: string;
  source: 'mock' | 'home-assistant' | 'simulator';
  lastSeenAt?: string;
  updatedAt?: string;
  online: boolean;
  values: {
    colorTemperature?: number; positionPercent?: number; pm25?: number; co2?: number; occupancy?: boolean; contact?: 'open' | 'closed';
    temperature?: number;
    humidity?: number;
    binary?: boolean;
    targetTemperature?: number;
    hvacMode?: 'off' | 'heat' | 'cool' | 'heat_cool' | 'auto' | 'dry' | 'fan_only';
    power?: boolean;
    brightness?: number;
    position?: 'open' | 'stop' | 'closed';
    cleaning?: boolean;
    battery?: number;
  };
};
export type DeviceCommand =
  | { capability: 'colorTemperature' | 'positionPercent'; value: number }
  | { capability: 'targetTemperature'; value: number }
  | { capability: 'hvacMode'; value: 'off' | 'heat' | 'cool' | 'heat_cool' | 'auto' | 'dry' | 'fan_only' }
  | { capability: 'power'; value: boolean }
  | { capability: 'brightness'; value: number }
  | { capability: 'position'; value: 'open' | 'stop' | 'closed' }
  | { capability: 'cleaning'; value: boolean };
export type DeviceSnapshot = Device & { state: DeviceState };
/** Mock is synchronous; real I/O providers can implement the same operations asynchronously. */
export type DeviceEvent = { device: Device; state: DeviceState } | { removedDeviceId: string };
export interface DeviceProvider {
  subscribe?(handler: (event: DeviceEvent) => void): (() => void) | Promise<() => void>;
  discoverOrListDevices(): Device[] | Promise<Device[]>;
  getDeviceState(providerDeviceId: string): DeviceState | Promise<DeviceState>;
  executeCommand(providerDeviceId: string, command: DeviceCommand): DeviceState | Promise<DeviceState>;
}
