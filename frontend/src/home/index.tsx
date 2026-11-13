import { useState } from 'react';
import { Leaf, Thermometer, Droplets, Wind, Zap, ShieldCheck, LockKeyhole, PersonStanding, House, Lightbulb, ScanLine, AirVent, SlidersHorizontal, LayoutGrid } from 'lucide-react';
import { rooms } from '../constants';
import type { State, Mutate } from '../types';
import Scenes from '../scenes';
import DeviceRow from './DeviceRow';

export default function Home({ state, busy, mutate }: { state: State; busy: boolean; mutate: Mutate }) {
  const [room, setRoom] = useState('客厅');
  const [deviceScope, setDeviceScope] = useState<'room' | 'all'>('room');
  const devices = state.devices.filter((device) => device.room === room);
  const visibleDevices = deviceScope === 'all' ? state.devices : devices;
  const running = state.devices.filter(d => ('on' in d && d.on) || (d.kind === 'robot' && d.cleaning)).length;
  const lights = devices.filter((device) => device.kind === 'light');
  const curtain = devices.find(d => d.kind === 'curtain');
  const ac = devices.find(d => d.kind === 'ac');
  const power = state.devices.reduce((sum, d) => sum + (d.kind === 'light' && d.on ? d.level * 0.001 : d.kind === 'ac' && d.on ? 0.8 : 0), 0) + 0.31;
  return <div className="home-grid">
    <div className="stack overview-stack">
      <section className="panel environment-panel"><div className="section-heading"><h2><Leaf />环境总览</h2><span className="quality-badge">舒适</span></div><div className="metrics">
        <div><Thermometer /><span><strong>24.5°C</strong><small>温度</small></span></div>
        <div><Droplets /><span><strong>35%</strong><small>湿度</small></span></div>
        <div><Leaf className="green" /><span><small>PM2.5</small><strong>25<em> μg/m³</em></strong></span></div>
        <div><Wind /><span><small>户外 AQI</small><strong>30</strong></span></div>
      </div><div className="panel-footnote">室内环境 · 示例数据</div></section>
      <section className="panel energy-panel"><div className="section-heading"><h2><Zap />能源总览</h2><small>实时估算</small></div><div className="energy-gauge"><svg viewBox="0 0 200 200"><circle className="gauge-track" cx="100" cy="100" r="82" /><circle className="gauge-value" cx="100" cy="100" r="82" strokeDasharray={`${Math.min(power / 3, 1) * 515} 515`} /></svg><div><strong>{power.toFixed(2)} <small>kW</small></strong><span>当前功率</span></div></div><div className="energy-details"><span>运行设备 <b>{running} 台</b></span><span>开启灯光 <b>{state.devices.filter(d => d.kind === 'light' && d.on).length} 盏</b></span></div></section>
      <section className="panel security-panel"><div className="section-heading"><h2><ShieldCheck />安防状态</h2><span className="quality-badge">已布防</span></div><div className="security-row"><LockKeyhole /><span>门锁</span><b>已上锁</b></div><div className="security-row"><PersonStanding /><span>{state.events[0]?.message ?? '暂无新的事件'}</span><time>{state.events[0] ? new Date(state.events[0].time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'}</time></div></section>
    </div>
    <div className="stack center-stack">
      <section className="panel room-panel"><div className="section-heading"><h2><House />家里实景</h2><small>静态预览 · 随房间切换</small></div><div className="rooms" aria-label="房间">
        {rooms.map((name) => <button key={name} aria-pressed={room === name} onClick={() => setRoom(name)}>{name}</button>)}
      </div>
      {room === '客厅' ? <div className="room-preview" role="img" aria-label="客厅实景示意图"><img src="/room.png" alt="" /><div className="room-image-label"><strong>{room}</strong><span>{devices.length} 台设备 · 一切尽在掌控</span></div></div> :
        <div className="room-placeholder"><House size={40} /><strong>{room}</strong><span>实景待添加</span></div>}
      <div className="room-status"><span><Lightbulb className="warm" /><span>灯光 <b>{lights.filter((light) => light.on).length}/{lights.length}</b> 已开</span></span><span><ScanLine /><span>窗帘{curtain?.kind === 'curtain' ? ({open:'已打开',closed:'已关闭',stop:'已停止'}[curtain.position]) : '未连接'}</span></span><span><AirVent /><span>空调{ac?.kind === 'ac' ? (ac.on ? '已开启' : '已关闭') : '未连接'}</span></span></div>
      </section>
      <Scenes busy={busy} mutate={mutate} />
    </div>
    <section className="panel devices-panel"><div className="section-heading"><h2><SlidersHorizontal />快捷控制</h2><small>{visibleDevices.length} 台设备</small></div><div className="device-filters"><button aria-pressed={deviceScope === 'room'} onClick={() => setDeviceScope('room')}>{room}</button><button aria-pressed={deviceScope === 'all'} onClick={() => setDeviceScope('all')}>全部设备</button><span>轻触开关，即刻响应</span></div><div className="device-grid">{visibleDevices.length ? visibleDevices.map((device) =>
      <DeviceRow key={device.id} device={device} busy={busy} mutate={mutate} />) : <div className="empty"><LayoutGrid size={32} /><p>这个房间还没有设备</p></div>}</div><div className="device-panel-footer"><LockKeyhole size={15} />门锁已上锁<span>安心在家，轻松掌控</span></div></section>
  </div>;
}
