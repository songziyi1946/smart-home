import { hasCapability, isClimate, roomPowerCommand } from '../devices';
import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Modal, Switch } from '@arco-design/web-react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Expand, Footprints, RotateCcw, Settings2, Map, Upload } from 'lucide-react';
import { createViewer, type Viewer, type ViewerStatus } from './viewer';
import { viewpointForRoom, viewpoints } from './plan';
import { belongsToRoom } from '../constants';
import SpaceMap from './SpaceMap';
import DeviceRow from '../home/DeviceRow';
import Panorama from './Panorama';
import { panoramaForRoom, panoramaRooms, panoramaScenes, panoramaThumbnail, type PanoramaScene } from './panoramas';
import type { Mutate, State } from '../types';
import './style.css';

type ControlTab = 'all' | 'light' | 'climate' | 'curtain';
export default function VR({ state, busy, mutate, selectedRoom, onRoomChange, nightMode }: { state: State; busy: boolean; mutate: Mutate; selectedRoom: string; onRoomChange: (room: string) => void; nightMode: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewer = useRef<Viewer>();
  const [displayMode, setDisplayMode] = useState<'panorama' | 'model'>('panorama');
  const [panoramaId, setPanoramaId] = useState(panoramaScenes[0].id);
  const panoramaScene = panoramaForRoom(selectedRoom, panoramaId);
  const panoramaViews = panoramaScenes.filter(scene => scene.roomId === panoramaScene?.roomId);
  const [status, setStatus] = useState<ViewerStatus>({ mode: 'orbit', position: [viewpoints[0].position[0], viewpoints[0].position[2]], heading: 0, modelState: 'loading' });
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
    if (displayMode === 'model' && !viewer.current) {
      try { viewer.current = createViewer(host.current!, setStatus); viewer.current.setNight(nightMode); setReady(true); }
      catch { setError('无法显示三维模型，请重试或更换浏览器。'); }
    }
    viewer.current?.setActive(displayMode === 'model');
  }, [displayMode, nightMode]);
  useEffect(() => {
    return () => { viewer.current?.dispose(); viewer.current = undefined; };
  }, []);
  function switchDisplayMode(mode: 'panorama' | 'model') {
    setDisplayMode(mode); setError(''); setMapOpen(false); setSettingsOpen(false);
  }
  function selectPanorama(scene: PanoramaScene) {
    setPanoramaId(scene.id);
    // Keep dining/kitchen distinct for camera navigation; device filtering normalizes both.
    onRoomChange(scene.controlRoom === '餐厨' ? scene.room : scene.controlRoom);
  }
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
  const selectedViewpoint = viewpointForRoom(selectedRoom);
  const controlsBusy = busy || batchBusy;
  function enterRoom(point = selectedViewpoint) {
    if (!point || !ready || modelName) return;
    viewer.current?.view(point.id);
    setPanelOpen(false);
  }
  function selectRoom(room: string) {
    const point = viewpointForRoom(room);
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
    {displayMode === 'panorama' ? <>
      <div className="vr-section-title"><strong>全景房间</strong><span>{panoramaScenes.length} 个视点</span></div>
      <div className="vr-room-buttons" aria-label="全景房间导航">{panoramaRooms.map(scene => <button key={scene.roomId} aria-pressed={panoramaScene?.roomId === scene.roomId} onClick={() => selectPanorama(scene)}>{scene.room}</button>)}</div>
      {panoramaViews.length > 1 && <div className="vr-panorama-views" aria-label="房间视点">{panoramaViews.map(scene => <button key={scene.id} aria-pressed={panoramaScene?.id === scene.id} onClick={() => selectPanorama(scene)}><img src={panoramaThumbnail(scene)} alt="" loading="lazy" /><span>{scene.label}</span></button>)}</div>}
    </> : <>
    <div className="vr-section-title"><strong>空间导航</strong><Button size="small" onClick={() => { setPanelOpen(false); setMapOpen(true); }} disabled={!!modelName}>放大导航</Button></div>
    {!modelName && <SpaceMap room={selectedRoom} onSelect={selectRoom} status={status} />}
    <div className="vr-room-buttons" aria-label="选择房间">{viewpoints.map(point => <button key={point.id} disabled={!ready || !!modelName} aria-pressed={selectedViewpoint?.id === point.id} onClick={() => selectRoom(point.name)}>{point.name}</button>)}</div>
    </>}
        <div className="vr-room-control" aria-live="polite">
          <div className="vr-room-control-head"><div><strong>{selectedRoom}</strong><small>{roomDevices.length} 台设备</small></div><div className="button-row"><Button size="small" disabled={controlsBusy || !roomDevices.length} onClick={() => void setRoomPower(true)}>全开</Button><Button size="small" disabled={controlsBusy || !roomDevices.length} onClick={() => void setRoomPower(false)}>全关</Button></div></div>
          {displayMode === 'model' && <><Button className="vr-enter-room" long type="primary" disabled={!ready || !selectedViewpoint || !!modelName} icon={<Footprints size={16} />} onClick={() => enterRoom()}>进入{selectedRoom}</Button>
          {(!selectedViewpoint || modelName) && <p className="vr-note">暂无房间定位</p>}
          </>}
          <div className="vr-control-tabs">{([['all', '全部'], ['light', '灯光'], ['climate', '温控'], ['curtain', '窗帘']] as const).map(([id, label]) => <button key={id} aria-pressed={controlTab === id} onClick={() => setControlTab(id)}>{label}</button>)}</div>
          <div className="vr-room-devices">{visibleDevices.length ? visibleDevices.map(device => <DeviceRow key={device.id} device={device} busy={controlsBusy} mutate={mutate} />) : <div className="empty">{roomDevices.length ? '当前分类暂无设备' : '这个房间暂无可控设备'}</div>}</div>
        </div>
        <div className="vr-quick-scenes"><span>全屋场景</span>{state.scenes.map(scene=><Button key={scene.id} size="small" disabled={controlsBusy} onClick={()=>void triggerScene(scene.id)}>{scene.name}</Button>)}</div>
  </>;
  return <section ref={page} className="vr-page" aria-label="全景与三维空间">
    <div className="vr-toolbar">
      <div className="vr-mode-switch" role="group" aria-label="空间展示模式">
        <button aria-pressed={displayMode === 'panorama'} onClick={() => switchDisplayMode('panorama')}>设计全景</button>
        <button aria-pressed={displayMode === 'model'} onClick={() => switchDisplayMode('model')}>三维模型</button>
      </div>
      <div className="button-row">
        {displayMode === 'panorama' ? <>
          <select className="vr-panorama-select" aria-label="全景房间" value={panoramaScene?.roomId ?? ''} onChange={event => { const scene = panoramaRooms.find(item => item.roomId === event.target.value); if (scene) selectPanorama(scene); }}>
            <option value="" disabled>选择全景房间</option>{panoramaRooms.map(scene => <option key={scene.roomId} value={scene.roomId}>{scene.room}</option>)}
          </select>
          {panoramaViews.length > 1 && <select className="vr-panorama-select" aria-label="全景视点" value={panoramaScene?.id} onChange={event => { const scene = panoramaViews.find(item => item.id === event.target.value); if (scene) selectPanorama(scene); }}>{panoramaViews.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select>}
        </> : <>
        <Button icon={<Settings2 size={16} />} onClick={() => setSettingsOpen(true)}>场景设置</Button>
        <Button disabled={!ready} type={status.mode === 'walk' ? 'primary' : 'secondary'} icon={<Footprints size={16} />} onClick={() => viewer.current?.setMode('walk')}>进入漫游</Button>
        <Button disabled={!ready} type={status.mode === 'orbit' ? 'primary' : 'secondary'} icon={<Box size={16} />} onClick={() => viewer.current?.setMode('orbit')}>户型总览</Button>
        </>}
        <Button disabled={displayMode === 'model' && !ready} aria-label="全屏查看" icon={<Expand size={17} />} onClick={() => void fullscreen()} />
      </div>
    </div>
    <div ref={workspace} className={"vr-workspace" + (compact ? " vr-workspace-compact" : "")}>
      <div className={'vr-stage' + (displayMode === 'panorama' ? ' vr-stage-panorama' : night ? ' vr-stage-night' : '')}>
        <div ref={host} className="vr-canvas" hidden={displayMode !== 'model'} />
        {displayMode === 'panorama' ? <Panorama scene={panoramaScene} /> : <>
        <div className="vr-view-label">{status.mode === 'walk' ? '室内漫游' : '模型总览'}</div>
        {!ready && !error && <div className="vr-message" role="status">正在构建三维场景…</div>}
        {ready && !modelName && status.modelState === 'loading' && <div className="vr-message" role="status">正在加载模型…</div>}
        {ready && !modelName && status.modelState === 'error' && <div className="vr-message vr-error" role="alert">模型加载失败。<button className="vr-panorama-retry" onClick={() => viewer.current?.reloadModel()}>重试</button></div>}
        {error && <div className="vr-message vr-error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
        {status.mode === 'walk' && ready && <div className="vr-movement" aria-label="漫游方向控制">
          {([{ key: 'KeyW', label: '向前移动', Icon: ArrowUp }, { key: 'KeyA', label: '向左移动', Icon: ArrowLeft }, { key: 'KeyS', label: '向后移动', Icon: ArrowDown }, { key: 'KeyD', label: '向右移动', Icon: ArrowRight }]).map(({ key, label, Icon }) =>
            <button key={key} className={'vr-key-' + key} aria-label={label} onClick={() => viewer.current?.step(key, .15)} onPointerDown={event => hold(event, key)} onPointerUp={() => viewer.current?.hold(key, false)} onPointerCancel={() => viewer.current?.hold(key, false)} onLostPointerCapture={() => viewer.current?.hold(key, false)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) viewer.current?.hold(key, true); }} onKeyUp={() => viewer.current?.hold(key, false)} onBlur={() => viewer.current?.hold(key, false)}><Icon size={19} /></button>)}
        </div>}
        </>}
        {displayMode === 'panorama' && error && <div className="vr-message vr-error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      </div>
      {!compact && <aside className="vr-inspector">{roomPanel}</aside>}

    </div>
    {compact && <button className="vr-panel-trigger" onClick={() => setPanelOpen(true)} aria-expanded={panelOpen}><Map size={20} /><span><strong>{selectedRoom}</strong> · {roomDevices.length} 台设备</span><span>空间导航与控制 ↑</span></button>}
    <Drawer title="空间导航与控制" visible={compact && panelOpen} onCancel={() => setPanelOpen(false)} footer={null} placement={mobile ? 'bottom' : 'right'} width={380} height="75dvh" className="vr-panel-drawer" getPopupContainer={() => document.fullscreenElement ?? document.body} unmountOnExit>{roomPanel}</Drawer>
    <Drawer title="场景设置" visible={settingsOpen} onCancel={() => setSettingsOpen(false)} footer={null} width="min(400px, 100vw)" getPopupContainer={() => document.fullscreenElement ?? document.body}>
        <label className="vr-setting">模型照明<Switch checked={lights} disabled={!ready || !!modelName} onChange={value => { setLights(value); viewer.current?.setLights(value); }} /></label>
        <label className="vr-setting">室内显示顶面<Switch checked={roof} disabled={!ready || !!modelName || status.mode !== 'walk'} onChange={value => { setRoof(value); viewer.current?.setRoof(value); }} /></label>
        <div className="vr-section-title">导入模型</div>
        <input ref={fileInput} type="file" accept=".glb" hidden onChange={event => void importModel(event.target.files?.[0])} />
        <Button long loading={loading} disabled={!ready || loading} icon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>导入 GLB 模型</Button>
        {modelName && <><p className="vr-model-name">{modelName}</p><Button long icon={<RotateCcw size={15} />} disabled={loading} onClick={() => { viewer.current?.resetModel(); setModelName(''); }}>恢复默认模型</Button></>}

    </Drawer>
    <Modal title="空间导航" visible={mapOpen} footer={null} onCancel={() => setMapOpen(false)} style={{ width: 'min(880px, calc(100vw - 32px))' }} getPopupContainer={() => document.fullscreenElement ?? document.body} unmountOnExit>
      <SpaceMap room={selectedRoom} onSelect={selectRoom} status={status} />
      <div className="vr-map-footer"><span>当前选择：{selectedRoom}</span><Button type="primary" onClick={() => { setMapOpen(false); enterRoom(); }} disabled={!ready || !selectedViewpoint || !!modelName}>进入房间</Button></div>
    </Modal>
  </section>;
}
