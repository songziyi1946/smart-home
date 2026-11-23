import type {DeviceSnapshot, State} from './types';
export type Metric = 'temperature' | 'humidity' | 'pm25' | 'co2';
export function isSimulatedDevice(device: DeviceSnapshot) {
  return device.state.source === 'simulator' || device.state.source === 'mock';
}
export function sourceLabel(device: DeviceSnapshot) {
  return isSimulatedDevice(device) ? '模拟数据' : device.state.source === 'mijia' ? '米家' : 'Home Assistant';
}
export function metricReading(devices: DeviceSnapshot[], metric: Metric) {
  const candidates = devices.filter(d => d.state.online && !d.capabilities.includes('power') && d.capabilities.includes(metric) && typeof d.state.values[metric] === 'number' && Number.isFinite(d.state.values[metric]));
  // Only environmental sensors; an AC internal reading must not hide a missing sensor.
  candidates.sort((a,b) => Number(a.capabilities.includes('power')) - Number(b.capabilities.includes('power')) ||
    (Date.parse(b.state.updatedAt ?? '') || 0) - (Date.parse(a.state.updatedAt ?? '') || 0) || a.id.localeCompare(b.id));
  const device = candidates[0];
  return device ? {value: device.state.values[metric]!, device, source: sourceLabel(device)} : undefined;
}
export function occupancyReading(devices: DeviceSnapshot[]) {
  const sensors = devices.filter(d => d.capabilities.includes('occupancy'));
  const available = sensors.filter(d => d.state.online && typeof d.state.values.occupancy === 'boolean');
  const active = available.filter(d => d.state.values.occupancy);
  const relevant = active.length ? active : available;
  const sources = [...new Set(relevant.map(sourceLabel))].join(' / ');
  const locations = [...new Set(active.map(d => d.roomId === 'unassigned' ? d.name : d.room))].join('、');
  return {text: !available.length ? '人体感应：暂无数据' : active.length ? `${locations}检测到活动` : available.length < sensors.length ? '在线传感器未检测到活动' : '未检测到活动', source: sources || '暂无数据', partial: available.length < sensors.length};
}
export function onlineSummary(devices: DeviceSnapshot[]) {
  const online = devices.filter(d => d.state.online).length;
  return {online, total: devices.length, offline: devices.length - online,
    simulated: devices.filter(d => sourceLabel(d) === '模拟数据').length};
}

export function latestFailures<T extends {status:string}>(runs:T[],key:(run:T)=>string){const seen=new Set<string>();return runs.filter(run=>{const id=key(run);if(seen.has(id))return false;seen.add(id);return run.status==='failed';});}

export function attention(state: State) {
  return {
    offline: state.devices.filter(device => !device.state.online),
    lowBattery: state.devices.filter(device => device.state.online && typeof device.state.values.battery === 'number' && device.state.values.battery < 20),
    scenes: latestFailures(state.sceneRuns, run => run.sceneId).filter(run => state.scenes.some(scene => scene.id === run.sceneId)),
    automations: latestFailures(state.automationRuns, run => run.ruleId).filter(run => state.automations.some(rule => rule.id === run.ruleId)),
  };
}
