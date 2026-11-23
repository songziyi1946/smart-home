import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Modal } from '@arco-design/web-react';
import { Box, ChevronRight, Expand, Map, RotateCcw, Settings2, Upload } from 'lucide-react';
import { createViewer, type Viewer, type ViewerStatus } from './viewer';
import { designModel, viewpointForRoom } from './plan';
import { roomSummary } from './room-state';
import { devicePanelNavigation } from './device-history';
import { controlStyle, deviceSummary, sendDeviceCommand } from '../deviceControls/model';
import { sourceLabel } from '../homeTelemetry';
import { roomPowerCommand } from '../devices';
import DevicePanel from '../deviceControls/Panel';
import SpaceMap from './SpaceMap';
import Panorama from './Panorama';
import { panoramaForRoom, panoramaRooms, panoramaScenes, type PanoramaScene } from './panoramas';
import type { Mutate, State } from '../types';
import './style.css';

type ControlTab = 'all' | 'light' | 'climate' | 'cover';
export default function VR({ state, busy, mutate, selectedRoom, onRoomChange, nightMode, live = true }: { state: State; busy: boolean; mutate: Mutate; selectedRoom: string; onRoomChange: (room: string) => void; nightMode: boolean; live?: boolean }) {
  const host = useRef<HTMLDivElement>(null), page = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), viewer = useRef<Viewer>();
  const [displayMode, setDisplayMode] = useState<'panorama' | 'model'>('model');
  const [panoramaId, setPanoramaId] = useState(panoramaScenes[0].id);
  const [status, setStatus] = useState<ViewerStatus>({ modelState: 'loading' });
  const [focusedRoom, setFocusedRoom] = useState<string>();
  const [selectedDevice, setSelectedDevice] = useState<string>();
  const deviceHistory = useRef<{ id?: string; url?: string }>({});
  const [error, setError] = useState(''), [modelName, setModelName] = useState('');
  const [loading, setLoading] = useState(false), [rendererReady, setRendererReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [mapOpen, setMapOpen] = useState(false), [panelOpen, setPanelOpen] = useState(false);
  const [compact, setCompact] = useState(false), [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [batchBusy, setBatchBusy] = useState(false), [controlTab, setControlTab] = useState<ControlTab>('all');
  const selection = useRef<(id: string) => void>(() => {});
  const panoramaScene = panoramaForRoom(selectedRoom, panoramaId);
  const room = designModel.rooms.find(value => value.id === focusedRoom);
  const panoramaRoom = displayMode === 'panorama' ? viewpointForRoom(selectedRoom) : undefined;
  const activeRoom = displayMode === 'panorama' ? panoramaRoom : room;
  const summaries = designModel.rooms.map(value => roomSummary(state.devices, value.id));
  const summary = summaries.find(value => value.id === activeRoom?.id);
  const roomDevices = summary?.devices ?? [];
  const visibleDevices = roomDevices.filter(device => controlTab === 'all' || controlStyle(device) === controlTab);
  const mappedDevices = new Set(summaries.flatMap(value => value.devices.map(device => device.id)));
  const unmapped = state.devices.filter(device => !mappedDevices.has(device.id)).length;
  const controlsBusy = busy || batchBusy;
  const modelReady = !!modelName || status.modelState === 'ready';
  const popupContainer = () => document.fullscreenElement ?? document.body;
  function selectRoom(id: string) {
    if (modelName && id) return;
    const next = designModel.rooms.find(value => value.id === id);
    setFocusedRoom(next?.id); setControlTab('all');
    if (next) { onRoomChange(next.name); viewer.current?.view(next.id); setPanelOpen(true); }
    else { viewer.current?.overview(); setPanelOpen(false); }
    setMapOpen(false);
  }
  selection.current = selectRoom;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 900));
    observer.observe(workspace.current!);
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => { observer.disconnect(); query.removeEventListener('change', update); };
  }, []);
  useEffect(() => {
    if (displayMode === 'model' && !viewer.current) {
      try { viewer.current = createViewer(host.current!, setStatus, id => selection.current(id)); setRendererReady(true); }
      catch { setError('无法显示三维模型，请重试或更换浏览器。'); }
    }
    viewer.current?.setActive(displayMode === 'model');
    viewer.current?.setNight(nightMode);
  }, [displayMode, nightMode]);
  useEffect(() => { viewer.current?.setRoomStates(summaries, live); }, [state.devices, displayMode, live]);
  useEffect(() => () => { viewer.current?.dispose(); viewer.current = undefined; }, []);
  useEffect(() => {
    const back = () => {
      const next = devicePanelNavigation(deviceHistory.current.id, history.state?.vrDevicePanel, location.href === deviceHistory.current.url);
      if (!next) return;
      deviceHistory.current.id = next.deviceId;
      setSelectedDevice(next.deviceId); setPanelOpen(next.panelOpen);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  function openDevice(id: string) {
    deviceHistory.current = { id, url: location.href };
    history.pushState({ vrDevicePanel: id }, '', location.href); setSelectedDevice(id); setPanelOpen(false);
  }
  function closeDevice() {
    const current = deviceHistory.current;
    deviceHistory.current = { url: current.url };
    setSelectedDevice(undefined); setPanelOpen(true);
    if (current.id && location.href === current.url && history.state?.vrDevicePanel === current.id) history.back();
  }
  function switchMode(mode: 'panorama' | 'model') {
    setDisplayMode(mode); setError(''); setMapOpen(false); setSettingsOpen(false); setPanelOpen(false); setSelectedDevice(undefined);
  }
  function selectPanorama(scene: PanoramaScene) {
    setPanoramaId(scene.id); onRoomChange(scene.controlRoom === '餐厨' ? scene.room : scene.controlRoom); setControlTab('all');
  }
  async function importModel(file?: File) {
    if (!file || !viewer.current) return;
    setLoading(true); setError('');
    try { await viewer.current.importModel(file); setModelName(file.name); setFocusedRoom(undefined); setPanelOpen(false); }
    catch (error) { setError(error instanceof Error ? error.message : '模型导入失败，请检查是否为未压缩、贴图内嵌的 GLB。'); }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await page.current?.requestFullscreen(); }
    catch { setError('当前浏览器不支持全屏，请使用浏览器窗口查看。'); }
  }
  async function setRoomPower(enabled: boolean) {
    if (controlsBusy) return;
    setBatchBusy(true);
    try {
      for (const device of roomDevices.filter(value => value.state.online)) {
        const command = roomPowerCommand(device, enabled);
        if (command && !await sendDeviceCommand(mutate, device, command)) break;
      }
    } finally { setBatchBusy(false); }
  }
  const navigation = displayMode === 'model' ? <>
    <div className="vr-section-title"><strong>房间</strong><Button size="small" onClick={() => { setPanelOpen(false); setMapOpen(true); }} disabled={!!modelName}>平面导航</Button></div>
    <div className="vr-room-buttons" aria-label="选择模型房间">{designModel.rooms.map(value => <button key={value.id} disabled={!modelReady || !!modelName} aria-pressed={focusedRoom === value.id} onClick={() => selectRoom(value.id)}>{value.name}</button>)}</div>
  </> : <>
    <div className="vr-section-title"><strong>全景房间</strong></div>
    <div className="vr-room-buttons" aria-label="全景房间导航">{panoramaRooms.map(scene => <button key={scene.roomId} aria-pressed={panoramaScene?.roomId === scene.roomId} onClick={() => selectPanorama(scene)}>{scene.room}</button>)}</div>
  </>;
  const roomPanel = <>
    {navigation}
    {modelName && displayMode === 'model' ? <p className="empty">导入模型尚未绑定房间与设备。</p> : activeRoom && summary ? <div className="vr-room-control">
      <div className="vr-room-control-head"><div><strong>{activeRoom.name}</strong><small>{summary.total} 台设备 · {summary.offline} 台离线</small></div></div>
      <p className="vr-source">{summary.source}{!live ? ' · 缓存状态' : ''}</p>
      {summary.shared && <p className="vr-note">此处显示餐厨分组设备，尚未分别分配到餐厅与厨房。</p>}
      <dl className="vr-environment"><div><dt>温度</dt><dd>{summary.temperature ? `${summary.temperature.value}°C` : '暂无数据'}</dd></div><div><dt>湿度</dt><dd>{summary.humidity ? `${summary.humidity.value}%` : '暂无数据'}</dd></div></dl>
      <p className="vr-note">{summary.occupancy.text}</p>
      <div className="button-row"><Button size="small" disabled={controlsBusy || !roomDevices.some(device => device.state.online && roomPowerCommand(device, true))} onClick={() => void setRoomPower(true)}>房间全开</Button><Button size="small" disabled={controlsBusy || !roomDevices.some(device => device.state.online && roomPowerCommand(device, false))} onClick={() => void setRoomPower(false)}>房间全关</Button></div>
      <div className="vr-control-tabs">{([['all', '全部'], ['light', '灯光'], ['climate', '温控'], ['cover', '窗帘']] as const).map(([id, label]) => <button key={id} aria-pressed={controlTab === id} onClick={() => setControlTab(id)}>{label}</button>)}</div>
      <div className="vr-room-devices">{visibleDevices.length ? visibleDevices.map(device => <button key={device.id} className={'vr-device-entry' + (!device.state.online ? ' is-offline' : '')} onClick={() => openDevice(device.id)}><span><strong>{device.name}</strong><small>{deviceSummary(device)}</small><small>{sourceLabel(device)}</small></span><ChevronRight size={17} /></button>) : <div className="empty">{roomDevices.length ? '当前分类暂无设备' : '这个房间暂无设备'}</div>}</div>
    </div> : <div className="vr-overview-status"><strong>全屋设备</strong><p>{state.devices.length} 台设备 · {state.devices.filter(device => !device.state.online).length} 台离线</p><p className="muted">选择房间查看设备与环境状态。</p>{unmapped > 0 && <p className="vr-note">{unmapped} 台设备尚未关联模型房间，<a href="#devices">查看全部设备</a>。</p>}</div>}
    <div className="vr-quick-scenes"><span>全屋场景</span>{state.scenes.map(scene => <Button key={scene.id} size="small" disabled={controlsBusy} onClick={() => void mutate('/scenes/' + scene.id, 'POST', {})}>{scene.name}</Button>)}</div>
  </>;
  return <section ref={page} className="vr-page" aria-label="家庭空间">
    <div className="vr-toolbar">
      <div className="vr-mode-switch" role="group" aria-label="空间展示模式"><button aria-pressed={displayMode === 'model'} onClick={() => switchMode('model')}>三维空间</button><button aria-pressed={displayMode === 'panorama'} onClick={() => switchMode('panorama')}>设计全景</button></div>
      <div className="button-row">
        {displayMode === 'model' ? <><Button icon={<Box size={16} />} disabled={!rendererReady} onClick={() => selectRoom('')}>全屋总览</Button><Button icon={<Settings2 size={16} />} onClick={() => setSettingsOpen(true)}>模型设置</Button></> : <select className="vr-panorama-select" aria-label="全景房间" value={panoramaScene?.roomId ?? ''} onChange={event => { const scene = panoramaRooms.find(item => item.roomId === event.target.value); if (scene) selectPanorama(scene); }}><option value="" disabled>选择全景房间</option>{panoramaRooms.map(scene => <option key={scene.roomId} value={scene.roomId}>{scene.room}</option>)}</select>}
        <Button aria-label="全屏查看" icon={<Expand size={17} />} onClick={() => void fullscreen()} />
      </div>
    </div>
    <div ref={workspace} className={'vr-workspace' + (compact ? ' vr-workspace-compact' : '')}>
      <div className={'vr-stage' + (displayMode === 'panorama' ? ' vr-stage-panorama' : nightMode ? ' vr-stage-night' : '')}>
        <div ref={host} className="vr-canvas" hidden={displayMode !== 'model'} />
        {displayMode === 'panorama' ? <Panorama scene={panoramaScene} /> : <>
          <div className="vr-view-label">{modelName || room?.name || '全屋总览'}{!live && ' · 缓存状态'}</div>
          {!error && !modelReady && status.modelState !== 'error' && <div className="vr-message" role="status">正在加载模型…</div>}
          {!modelName && status.modelState === 'error' && <div className="vr-message vr-error" role="alert">模型加载失败。<button className="vr-panorama-retry" onClick={() => viewer.current?.reloadModel()}>重试</button></div>}
        </>}
        {error && <div className="vr-message vr-error" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      </div>
      {!compact && <aside className="vr-inspector">{roomPanel}</aside>}
    </div>
    {compact && <button className="vr-panel-trigger" onClick={() => setPanelOpen(true)} aria-expanded={panelOpen}><Map size={20} /><span>{activeRoom?.name || '全屋'} · {activeRoom ? roomDevices.length : state.devices.length} 台设备</span><span>查看设备与房间</span></button>}
    <Drawer title={<div className="vr-drawer-title"><span>{activeRoom?.name || '房间与设备'}</span><Button type="text" size="small" aria-label="关闭房间面板" onClick={() => setPanelOpen(false)}>关闭</Button></div>} closable={false} visible={compact && panelOpen} onCancel={() => setPanelOpen(false)} footer={null} mask={false} placement={mobile ? 'bottom' : 'right'} width={380} height={mobile ? '50dvh' : '75dvh'} className="vr-panel-drawer" getPopupContainer={popupContainer} unmountOnExit>{roomPanel}</Drawer>
    <DevicePanel device={state.devices.find(device => device.id === selectedDevice)} visible={!!selectedDevice} mobile={mobile} busy={controlsBusy} mutate={mutate} onClose={closeDevice} />
    <Drawer title="模型设置" visible={settingsOpen} onCancel={() => setSettingsOpen(false)} footer={null} width="min(400px, 100vw)" getPopupContainer={popupContainer}>
      <input ref={fileInput} type="file" accept=".glb" hidden onChange={event => void importModel(event.target.files?.[0])} />
      <Button long loading={loading} disabled={!rendererReady || loading} icon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>导入 GLB 模型</Button>
      {modelName && <><p className="vr-model-name">{modelName}</p><Button long icon={<RotateCcw size={15} />} disabled={loading} onClick={() => { viewer.current?.resetModel(); setModelName(''); setFocusedRoom(undefined); }}>恢复默认模型</Button></>}
    </Drawer>
    <Modal title="房间导航" visible={mapOpen} footer={null} onCancel={() => setMapOpen(false)} style={{ width: 'min(880px, calc(100vw - 32px))' }} getPopupContainer={popupContainer} unmountOnExit><SpaceMap room={room?.name || ''} onSelect={name => { const value = viewpointForRoom(name); if (value) selectRoom(value.id); }} /></Modal>
  </section>;
}
