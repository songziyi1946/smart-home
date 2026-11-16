import type {DeviceSnapshot} from './types';
export type Metric = 'temperature' | 'humidity' | 'pm25' | 'co2';
export function sourceLabel(device: DeviceSnapshot) {
  return device.state.source === 'simulator' || device.state.source === 'mock' ? '模拟数据' : 'Home Assistant';
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
