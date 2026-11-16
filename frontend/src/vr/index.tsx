import { hasCapability, isClimate, roomPowerCommand } from '../devices';
import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Modal, Switch } from '@arco-design/web-react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Expand, Footprints, House, RotateCcw, Settings2, Map, Upload } from 'lucide-react';
import { createViewer, type Viewer, type ViewerStatus } from './viewer';
import { viewpoints } from './plan';
import { belongsToRoom } from '../constants';
import SpaceMap from './SpaceMap';
import DeviceRow from '../home/DeviceRow';
import type { Mutate, State } from '../types';
import './style.css';

type ControlTab = 'all' | 'light' | 'climate' | 'curtain';
export default function VR({ state, busy, mutate, selectedRoom, onRoomChange, nightMode }: { state: State; busy: boolean; mutate: Mutate; selectedRoom: string; onRoomChange: (room: string) => void; nightMode: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewer = useRef<Viewer>();
  const [status, setStatus] = useState<ViewerStatus>({ mode: 'orbit', position: [8.65, 5.65], heading: 0 });
  const [error, setError] = useState('');
  const night = nightMode;
  const [lights, setLights] = useState(true);
  const [roof, setRoof] = useState(true);
  const [modelName, setModelName] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth <= 760);
  const [batchBusy, setBatchBusy] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 1040));
    observer.observe(workspace.current!);
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => { observer.disconnect(); query.removeEventListener('change', update); };
  }, []);
  const [controlTab, setControlTab] = useState<ControlTab>('all');
  useEffect(() => {
    try { viewer.current = createViewer(host.current!, setStatus); setReady(true); }
    catch { setError('无法启动三维渲染，请启用浏览器硬件加速，并使用支持 WebGL2 的浏览器重试。'); }
    return () => { viewer.current?.dispose(); viewer.current = undefined; };
  }, []);
  async function importModel(file?: File) {
    if (!file || !viewer.current) return;
    setLoading(true); setError('');
    try { await viewer.current.importModel(file); setModelName(file.name); }
    catch (error) { setError(error instanceof Error ? error.message : '模型导入失败，请检查是否为未压缩、贴图内嵌的 GLB。'); }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await page.current?.requestFullscreen(); }
    catch { setError('当前浏览器不支持全屏，请使用浏览器窗口查看。'); }
  }
  function hold(event: React.PointerEvent<HTMLButtonElement>, key: string) {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); viewer.current?.hold(key, true);
  }
  const roomDevices = state.devices.filter(device => belongsToRoom(device.room, selectedRoom));
  const visibleDevices = roomDevices.filter(device => controlTab === 'all' ||
    (controlTab === 'light' && hasCapability(device, 'brightness')) ||
    (controlTab === 'climate' && isClimate(device)) ||
    (controlTab === 'curtain' && hasCapability(device, 'position')));
  const selectedViewpoint = viewpoints.find(point => point.name === selectedRoom);
  const controlsBusy = busy || batchBusy;
  function enterRoom(point = selectedViewpoint) {
    if (!point || !ready || modelName) return;
    viewer.current?.view(point.id);
    setPanelOpen(false);
  }
  function selectRoom(room: string) {
    const point = viewpoints.find(item => item.name === room);
    onRoomChange(room);
    if (point) {
      enterRoom(point);
      setMapOpen(false);
    }
  }
  useEffect(() => { viewer.current?.setNight(nightMode); }, [nightMode]);
  async function setRoomPower(enabled: boolean) {
    if (controlsBusy) return;
    setBatchBusy(true);
    try {
      for (const device of roomDevices) {
        const action = roomPowerCommand(device, enabled);
        if (action && !await mutate('/devices/' + device.id, 'PATCH', action)) break;
      }
    } finally { setBatchBusy(false); }
  }
  async function triggerScene(id: string) { await mutate('/scenes/' + id, 'POST', {}); }
  const roomPanel = <>
    <div className="vr-section-title"><strong>空间导航</strong><Button size="small" onClick={() => { setPanelOpen(false); setMapOpen(true); }} disabled={!!modelName}>放大导航</Button></div>
    {modelName ? <p className="vr-note">当前为导入模型，参考户型导航已隐藏。</p> : <SpaceMap room={selectedRoom} onSelect={selectRoom} status={status} />}
    <div className="vr-room-buttons" aria-label="选择房间">{viewpoints.map(point => <button key={point.id} disabled={!ready || !!modelName} aria-pressed={selectedRoom === point.name} onClick={() => selectRoom(point.name)}>{point.name}</button>)}</div>
        <div className="vr-room-control" aria-live="polite">
          <div className="vr-room-control-head"><div><strong>{selectedRoom}</strong><small>{roomDevices.length} 台设备</small></div><div className="button-row"><Button size="small" disabled={controlsBusy || !roomDevices.length} onClick={() => void setRoomPower(true)}>全开</Button><Button size="small" disabled={controlsBusy || !roomDevices.length} onClick={() => void setRoomPower(false)}>全关</Button></div></div>
          <Button className="vr-enter-room" long type="primary" disabled={!ready || !selectedViewpoint || !!modelName} icon={<Footprints size={16} />} onClick={() => enterRoom()}>进入{selectedRoom}</Button>
          {(!selectedViewpoint || modelName) && <p className="vr-note">{modelName ? '导入模型尚未配置房间定位' : '该房间暂无模型定位'}</p>}
          <div className="vr-control-tabs">{([['all', '全部'], ['light', '灯光'], ['climate', '温控'], ['curtain', '窗帘']] as const).map(([id, label]) => <button key={id} aria-pressed={controlTab === id} onClick={() => setControlTab(id)}>{label}</button>)}</div>
          <div className="vr-room-devices">{visibleDevices.length ? visibleDevices.map(device => <DeviceRow key={device.id} device={device} busy={controlsBusy} mutate={mutate} />) : <div className="empty">{roomDevices.length ? '当前分类暂无设备' : '这个房间暂无可控设备'}</div>}</div>
        </div>
        <div className="vr-quick-scenes"><span>全屋场景</span>{state.scenes.map(scene=><Button key={scene.id} size="small" disabled={controlsBusy} onClick={()=>void triggerScene(scene.id)}>{scene.name}</Button>)}</div>
  </>;
  return <section ref={page} className="vr-page" aria-label="三维实景漫游">
    <div className="vr-toolbar">
      <div><h2><House />家的每一处，都在眼前</h2><p>选择房间查看设备，进入房间开始漫游</p></div>
      <div className="button-row">
        <Button icon={<Settings2 size={16} />} onClick={() => setSettingsOpen(true)}>场景设置</Button>
        <Button disabled={!ready} type={status.mode === 'walk' ? 'primary' : 'secondary'} icon={<Footprints size={16} />} onClick={() => viewer.current?.setMode('walk')}>进入漫游</Button>
        <Button disabled={!ready} type={status.mode === 'orbit' ? 'primary' : 'secondary'} icon={<Box size={16} />} onClick={() => viewer.current?.setMode('orbit')}>户型总览</Button>
        <Button disabled={!ready} aria-label="全屏查看" icon={<Expand size={17} />} onClick={() => void fullscreen()} />
      </div>
    </div>
    <div ref={workspace} className={"vr-workspace" + (compact ? " vr-workspace-compact" : "")}>
      <div className={'vr-stage' + (night ? ' vr-stage-night' : '')}>
        <div ref={host} className="vr-canvas" />
        <div className="vr-view-label"><span className="online-dot" />{status.mode === 'walk' ? '第一人称漫游' : modelName ? '模型总览' : '户型剖切总览'}</div>
        {!ready && !error && <div className="vr-message" role="status">正在构建三维场景…</div>}
        {error && <div className="vr-message vr-error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
        {status.mode === 'walk' && ready && <div className="vr-movement" aria-label="漫游方向控制">
          {([{ key: 'KeyW', label: '向前移动', Icon: ArrowUp }, { key: 'KeyA', label: '向左移动', Icon: ArrowLeft }, { key: 'KeyS', label: '向后移动', Icon: ArrowDown }, { key: 'KeyD', label: '向右移动', Icon: ArrowRight }]).map(({ key, label, Icon }) =>
            <button key={key} className={'vr-key-' + key} aria-label={label} onClick={() => viewer.current?.step(key, .15)} onPointerDown={event => hold(event, key)} onPointerUp={() => viewer.current?.hold(key, false)} onPointerCancel={() => viewer.current?.hold(key, false)} onLostPointerCapture={() => viewer.current?.hold(key, false)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) viewer.current?.hold(key, true); }} onKeyUp={() => viewer.current?.hold(key, false)} onBlur={() => viewer.current?.hold(key, false)}><Icon size={19} /></button>)}
        </div>}
        <div className="vr-help">{status.mode === 'walk' ? '拖动环顾 · 点击画面后 WASD / 方向键移动 · Shift 加速 · 滚轮调视角' : '拖动旋转 · 右键平移 · 滚轮缩放'}</div>
      </div>
      {!compact && <aside className="vr-inspector">{roomPanel}</aside>}

    </div>
    {compact && <button className="vr-panel-trigger" onClick={() => setPanelOpen(true)} aria-expanded={panelOpen}><Map size={20} /><span><strong>{selectedRoom}</strong> · {roomDevices.length} 台设备</span><span>空间导航与控制 ↑</span></button>}
    <Drawer title="空间导航与控制" visible={compact && panelOpen} onCancel={() => setPanelOpen(false)} footer={null} placement={mobile ? 'bottom' : 'right'} width={380} height="75dvh" className="vr-panel-drawer" getPopupContainer={() => document.fullscreenElement ?? document.body} unmountOnExit>{roomPanel}</Drawer>
    <Drawer title="场景设置 / 模型管理" visible={settingsOpen} onCancel={() => setSettingsOpen(false)} footer={null} width="min(400px, 100vw)" getPopupContainer={() => document.fullscreenElement ?? document.body}>
        <div className="vr-section-title">场景设置</div>
        <label className="vr-setting">参考模型照明<Switch checked={lights} disabled={!ready || !!modelName} onChange={value => { setLights(value); viewer.current?.setLights(value); }} /></label>
        <label className="vr-setting">室内显示顶面<Switch checked={roof} disabled={!ready || !!modelName || status.mode !== 'walk'} onChange={value => { setRoof(value); viewer.current?.setRoof(value); }} /></label>
        <div className="vr-section-title">设计师模型</div>
        <input ref={fileInput} type="file" accept=".glb" hidden onChange={event => void importModel(event.target.files?.[0])} />
        <Button long loading={loading} disabled={!ready || loading} icon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>导入 GLB 模型</Button>
        {modelName && <><p className="vr-model-name">{modelName}</p><Button long icon={<RotateCcw size={15} />} disabled={loading} onClick={() => { viewer.current?.resetModel(); setModelName(''); }}>恢复参考场景</Button></>}
        <div className="vr-dimension"><b>12.91 × 7.53 m</b></div>

    </Drawer>
    <Modal title="空间导航" visible={mapOpen} footer={null} onCancel={() => setMapOpen(false)} style={{ width: 'min(880px, calc(100vw - 32px))' }} getPopupContainer={() => document.fullscreenElement ?? document.body} unmountOnExit>
      <SpaceMap room={selectedRoom} onSelect={selectRoom} status={status} />
      <div className="vr-map-footer"><span>当前选择：{selectedRoom}</span><Button type="primary" onClick={() => { setMapOpen(false); enterRoom(); }} disabled={!ready || !selectedViewpoint || !!modelName}>进入房间</Button></div>
    </Modal>
  </section>;
}
