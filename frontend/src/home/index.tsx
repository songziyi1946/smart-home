import { metricReading, occupancyReading, onlineSummary } from '../homeTelemetry';
import { hasCapability, isRunning, isClimate } from '../devices';
import { lazy, Suspense, useState } from 'react';
import { Leaf, Thermometer, Droplets, Wind, Zap, ShieldCheck, LockKeyhole, PersonStanding, House, Lightbulb, ScanLine, AirVent, SlidersHorizontal, LayoutGrid } from 'lucide-react';
import { belongsToRoom, rooms } from '../constants';
import type { State, Mutate } from '../types';
import Scenes from '../scenes';
import DeviceRow from './DeviceRow';

const ModelPreview = lazy(() => import('./ModelPreview'));

export default function Home({ canManageScenes, state, busy, mutate, room, onRoomChange }: { canManageScenes: boolean; state: State; busy: boolean; mutate: Mutate; room: string; onRoomChange: (room: string) => void }) {
  const [deviceScope, setDeviceScope] = useState<'room' | 'all'>('room');
  const devices = state.devices.filter((device) => belongsToRoom(device.room, room));
  const visibleDevices = deviceScope === 'all' ? state.devices : devices;
  const running = state.devices.filter(d => isRunning(d)).length;
  const lights = devices.filter((device) => hasCapability(device, 'brightness'));
  const curtain = devices.find(d => hasCapability(d, 'position'));
  const ac = devices.find(d => isClimate(d));
  const metrics = [
    {key: 'temperature', label: '温度', unit: '°C', Icon: Thermometer},
    {key: 'humidity', label: '湿度', unit: '%', Icon: Droplets},
    {key: 'pm25', label: 'PM2.5', unit: 'μg/m³', Icon: Leaf},
    {key: 'co2', label: 'CO₂', unit: 'ppm', Icon: Wind},
  ] as const;
  const readings = metrics.map(metric => ({...metric, reading: metricReading(state.devices, metric.key)}));
  const occupancy = occupancyReading(state.devices);
  const online = onlineSummary(state.devices);
  const environmentSources = [...new Set(readings.flatMap(item => item.reading ? [item.reading.source] : []))].join(' / ') || '暂无数据';
  return <div className="home-grid">
    <div className="stack overview-stack">
      <section className="panel environment-panel"><div className="section-heading"><h2><Leaf />环境总览</h2><span className="quality-badge">{environmentSources}</span></div><div className="metrics">
        {readings.map(({key, label, unit, Icon, reading}) => <div key={key}><Icon /><span title={reading ? `${reading.device.name} · ${reading.device.room} · ${reading.source}${reading.device.state.updatedAt ? ' · ' + new Date(reading.device.state.updatedAt).toLocaleString('zh-CN') : ''}` : '未接入或设备离线'}>
          <strong className={!reading ? 'metric-unavailable' : undefined}>{reading ? <>{Number(reading.value.toFixed(1))}<em> {unit}</em></> : '暂无数据'}</strong><small>{label}{reading ? ' · ' + (reading.source === '模拟数据' ? '模拟' : 'HA') : ''}</small>
        </span></div>)}
      </div></section>
      <section className="panel energy-panel"><div className="section-heading"><h2><Zap />能源总览</h2></div><div className="energy-gauge"><svg viewBox="0 0 200 200"><circle className="gauge-track" cx="100" cy="100" r="82" /><circle className="gauge-value" cx="100" cy="100" r="82" strokeDasharray="0 515" /></svg><div><strong>— <small>kW</small></strong><span>暂无数据</span></div></div><div className="energy-details"><span>运行设备 <b>{running} 台</b></span><span>开启灯光 <b>{state.devices.filter(d => d.state.online && hasCapability(d, 'brightness') && d.state.values.power).length} 盏</b></span></div></section>
      <section className="panel security-panel"><div className="section-heading"><h2><ShieldCheck />安防状态</h2><span className="quality-badge">暂无数据</span></div><div className="security-row"><LockKeyhole /><span>门锁</span><b>暂无数据</b></div><div className="security-row" title={occupancy.partial ? '部分人体传感器离线或状态未知' : undefined}><PersonStanding /><span>{occupancy.text}</span><small>{occupancy.source}</small></div></section>
    </div>
    <div className="stack center-stack">
      <section className="panel room-panel"><div className="section-heading"><h2><House />家里实景</h2><a className="enter-vr" href="#vr">进入 VR →</a></div>
      <div className="rooms" aria-label="房间">
        {rooms.map((name) => <button key={name} aria-pressed={room === name} onClick={() => onRoomChange(name)}>{name}</button>)}
      </div>
      {room === '客厅' ? <div className="room-preview" role="img" aria-label="客厅实景示意图"><img src="/room.png" alt="" /><div className="room-image-label"><strong>{room}</strong><span>实景示意 · {devices.length} 台设备</span></div></div> :
        <Suspense fallback={<div className="room-placeholder">正在加载模型预览…</div>}><ModelPreview room={room} overview /></Suspense>}
      <div className="room-status"><span><Lightbulb className="warm" /><span>灯光 <b>{lights.filter((light) => light.state.online && light.state.values.power).length}/{lights.length}</b> 已开</span></span><span><ScanLine /><span>窗帘{curtain?.state.online && curtain.state.values.position !== undefined ? ({open:'已打开',closed:'已关闭',stop:'已停止'}[curtain.state.values.position]) : '暂无数据'}</span></span><span><AirVent /><span>空调{ac?.state.online && ac.state.values.power !== undefined ? (ac.state.values.power ? '已开启' : '已关闭') : '暂无数据'}</span></span></div>
      </section>
      <Scenes state={state} canManage={canManageScenes} busy={busy} mutate={mutate} />
    </div>
    <section className="panel devices-panel"><div className="section-heading"><h2><SlidersHorizontal />快捷控制</h2></div><div className="device-filters"><button aria-pressed={deviceScope === 'room'} onClick={() => setDeviceScope('room')}>{room}</button><button aria-pressed={deviceScope === 'all'} onClick={() => setDeviceScope('all')}>全部设备</button></div><div className="device-grid">{visibleDevices.length ? visibleDevices.map((device) =>
      <DeviceRow key={device.id} device={device} busy={busy} mutate={mutate} />) : <div className="empty"><LayoutGrid size={32} /><p>这个房间还没有设备</p></div>}</div><div className="device-panel-footer"><SlidersHorizontal size={15} />在线 {online.online}/{online.total} · 离线 {online.offline}{online.simulated > 0 ? ` · 含 ${online.simulated} 台模拟设备` : ''}</div></section>
  </div>;
}
