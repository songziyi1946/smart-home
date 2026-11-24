import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer, Modal } from '@arco-design/web-react';
import { Box, ChevronRight, Expand, Map, Settings2 } from 'lucide-react';
import { createViewer, type Viewer, type ViewerStatus } from './viewer';
import ModelManager from './ModelManager';
import { currentModelVersion, loadModelAsset, loadModelLibrary, type ModelLibrary, type ModelVersion } from './model-library';
import builtinLibrary from '../../../packages/contracts/builtin-space-model.json';
import { roomSummary } from './room-state';
import { devicePanelNavigation } from './device-history';
import { controlStyle, deviceSummary, sendDeviceCommand } from '../deviceControls/model';
import { sourceLabel } from '../homeTelemetry';
import { roomPowerCommand } from '../devices';
import DevicePanel from '../deviceControls/Panel';
import SpaceMap from './SpaceMap';
import Panorama from './Panorama';
import { panoramaForModelRoom } from './panoramas';
import type { Mutate, State } from '../types';
import './style.css';

type ControlTab = 'all' | 'light' | 'climate' | 'cover';
type VRProps = { state: State; busy: boolean; mutate: Mutate; selectedRoom: string; onRoomChange: (room: string) => void; nightMode: boolean; live?: boolean; role: 'admin' | 'member' | 'guest' };
export default function VR(props: VRProps) {
  const [library, setLibrary] = useState<ModelLibrary>();
  const [selectedId, setSelectedId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    if (props.role === 'guest') { setLibrary(builtinLibrary as ModelLibrary); setSelectedId('builtin'); return; }
    loadModelLibrary().then(value => {
      if (cancelled) return;
      setLibrary(value); setSelectedId(id => value.models.some(model => model.id === id) ? id : value.defaultModelId);
    }).catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : '模型列表加载失败'); });
    return () => { cancelled = true; };
  }, [props.role, attempt]);
  const selected = library?.models.find(value => value.id === selectedId);
  const version = selected && currentModelVersion(selected);
  if (!library || !selected || !version) return <div className="panel" role={loadError ? 'alert' : 'status'}>{loadError || '正在加载模型列表…'}{loadError && <Button onClick={() => setAttempt(value => value + 1)}>重试</Button>}</div>;
  return <SpaceView key={selected.id + ':' + version.id + ':' + library.revision} {...props} library={library} modelId={selected.id} modelName={selected.name} version={version}
    onSelectModel={setSelectedId} onSaved={(next, id) => {
      setLibrary(previous => !previous || next.revision >= previous.revision ? next : previous);
      setSelectedId(current => current === selected.id ? id : current);
    }} />;
}
function SpaceView({ state, busy, mutate, selectedRoom, onRoomChange, nightMode, live = true, role, library, modelId, modelName, version, onSelectModel, onSaved }: VRProps & {
  library: ModelLibrary; modelId: string; modelName: string; version: ModelVersion;
  onSelectModel: (id: string) => void; onSaved: (library: ModelLibrary, id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null), page = useRef<HTMLElement>(null), workspace = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer>();
  const [displayMode, setDisplayMode] = useState<'panorama' | 'model'>('model');
  const [panoramaRoomId, setPanoramaRoomId] = useState(() => version.rooms.find(value => value.name === selectedRoom && value.panoramaSceneId)?.id ?? version.rooms.find(value => value.panoramaSceneId)?.id);
  const [status, setStatus] = useState<ViewerStatus>({ modelState: 'loading' });
  const [focusedRoom, setFocusedRoom] = useState<string>();
  const [selectedDevice, setSelectedDevice] = useState<string>();
  const deviceHistory = useRef<{ id?: string; url?: string }>({});
  const [error, setError] = useState('');
  const [modelError, setModelError] = useState('');
  const [rendererReady, setRendererReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false), [mapOpen, setMapOpen] = useState(false), [panelOpen, setPanelOpen] = useState(false);
  const [compact, setCompact] = useState(false), [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [batchBusy, setBatchBusy] = useState(false), [controlTab, setControlTab] = useState<ControlTab>('all');
  const selection = useRef<(id: string) => void>(() => {});
  const panoramaRoom = version.rooms.find(value => value.id === panoramaRoomId);
  const panoramaScene = useMemo(() => panoramaForModelRoom(version, panoramaRoomId), [version, panoramaRoomId]);
  const room = version.rooms.find(value => value.id === focusedRoom);
  const activeRoom = displayMode === 'panorama' ? panoramaRoom : room;
  const summaries = version.rooms.map(value => roomSummary(state.devices, value.id, value.deviceRoomIds));
  const summary = summaries.find(value => value.id === activeRoom?.id);
  const roomDevices = summary?.devices ?? [];
  const visibleDevices = roomDevices.filter(device => controlTab === 'all' || controlStyle(device) === controlTab);
  const mappedDevices = new Set(summaries.flatMap(value => value.devices.map(device => device.id)));
  const associatedDevices = state.devices.filter(device => mappedDevices.has(device.id));
  const unmapped = state.devices.filter(device => !mappedDevices.has(device.id)).length;
  const controlsBusy = busy || batchBusy || !live;
  const modelReady = status.modelState === 'ready' && !modelError;
  const popupContainer = () => document.fullscreenElement ?? document.body;
  function selectRoom(id: string) {
    const next = version.rooms.find(value => value.id === id);
    setFocusedRoom(next?.id); setControlTab('all');
    if (next) { onRoomChange(next.name); if (next.bounds) viewer.current?.view(next.id); else viewer.current?.overview(); setPanelOpen(true); }
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
    const abort = new AbortController();
    let instance: Viewer | undefined;
    setModelError(''); setRendererReady(false); setStatus({ modelState: 'loading' });
    try {
      instance = createViewer(host.current!, setStatus, id => selection.current(id), version);
      viewer.current = instance;
      setRendererReady(true);
      if (version.source !== 'builtin') {
        if (!version.assetId) throw new Error('模型文件不存在');
        void loadModelAsset(version.assetId, abort.signal).then(file => {
          if (!abort.signal.aborted) return instance!.importModel(file);
        }).catch(error => { if (!abort.signal.aborted) { setModelError(error instanceof Error ? error.message : '模型加载失败'); setStatus({ modelState: 'error' }); } });
      }
    } catch (error) { setModelError(error instanceof Error ? error.message : '无法显示三维模型，请重试'); setStatus({ modelState: 'error' }); }
    return () => { abort.abort(); instance?.dispose(); viewer.current = undefined; };
  }, [version, loadAttempt]);
  useEffect(() => { viewer.current?.setActive(displayMode === 'model'); viewer.current?.setNight(nightMode); }, [displayMode, nightMode, loadAttempt]);
  useEffect(() => { viewer.current?.setRoomStates(summaries, live); }, [state.devices, displayMode, live, version, loadAttempt]);
  useEffect(() => () => {
    if (deviceHistory.current.id && history.state?.vrDevicePanel === deviceHistory.current.id) {
      const { vrDevicePanel: _panel, ...rest } = history.state;
      history.replaceState(rest, '', location.href);
    }
  }, []);
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
  function selectPanorama(id: string) {
    const next = version.rooms.find(value => value.id === id);
    if (!next) return;
    setPanoramaRoomId(id); onRoomChange(next.name); setControlTab('all'); setSelectedDevice(undefined);
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
    <div className="vr-section-title"><strong>房间</strong><Button size="small" onClick={() => { setPanelOpen(false); setMapOpen(true); }} disabled={!version.rooms.some(value => value.bounds)}>平面导航</Button></div>
    <div className="vr-room-buttons" aria-label="选择模型房间">{version.rooms.map(value => <button key={value.id} disabled={!modelReady} aria-pressed={focusedRoom === value.id} onClick={() => selectRoom(value.id)}>{value.name}</button>)}</div>
  </> : <>
    <div className="vr-section-title"><strong>全景房间</strong></div>
    <div className="vr-room-buttons" aria-label="全景房间导航">{version.rooms.filter(value => value.panoramaSceneId).map(value => <button key={value.id} aria-pressed={panoramaRoomId === value.id} onClick={() => selectPanorama(value.id)}>{value.name}</button>)}</div>
  </>;
  const roomPanel = <>
    {navigation}
    {activeRoom && summary ? <div className="vr-room-control">
      <div className="vr-room-control-head"><div><strong>{activeRoom.name}</strong><small>{summary.total} 台设备 · {summary.offline} 台离线</small></div></div>
      <p className="vr-source">{summary.source}{!live ? ' · 缓存状态' : ''}</p>
      {summary.shared && <p className="vr-note">此处显示餐厨分组设备，尚未分别分配到餐厅与厨房。</p>}
      <dl className="vr-environment"><div><dt>温度</dt><dd>{summary.temperature ? `${summary.temperature.value}°C` : '暂无数据'}</dd></div><div><dt>湿度</dt><dd>{summary.humidity ? `${summary.humidity.value}%` : '暂无数据'}</dd></div></dl>
      <p className="vr-note">{summary.occupancy.text}</p>
      <div className="button-row"><Button size="small" disabled={controlsBusy || !roomDevices.some(device => device.state.online && roomPowerCommand(device, true))} onClick={() => void setRoomPower(true)}>房间全开</Button><Button size="small" disabled={controlsBusy || !roomDevices.some(device => device.state.online && roomPowerCommand(device, false))} onClick={() => void setRoomPower(false)}>房间全关</Button></div>
      <div className="vr-control-tabs">{([['all', '全部'], ['light', '灯光'], ['climate', '温控'], ['cover', '窗帘']] as const).map(([id, label]) => <button key={id} aria-pressed={controlTab === id} onClick={() => setControlTab(id)}>{label}</button>)}</div>
      <div className="vr-room-devices">{visibleDevices.length ? visibleDevices.map(device => <button key={device.id} className={'vr-device-entry' + (!device.state.online ? ' is-offline' : '')} onClick={() => openDevice(device.id)}><span><strong>{device.name}</strong><small>{deviceSummary(device)}</small><small>{sourceLabel(device)}</small></span><ChevronRight size={17} /></button>) : <div className="empty">{roomDevices.length ? '当前分类暂无设备' : '这个房间暂无设备'}</div>}</div>
    </div> : <div className="vr-overview-status"><strong>模型关联设备</strong><p>{associatedDevices.length} 台设备 · {associatedDevices.filter(device => !device.state.online).length} 台离线</p><p className="muted">选择房间查看设备与环境状态。</p>{unmapped > 0 && <p className="vr-note">{unmapped} 台设备尚未关联模型房间，<a href="#devices">查看全部设备</a>。</p>}</div>}
    <div className="vr-quick-scenes"><span>全屋场景</span>{state.scenes.map(scene => <Button key={scene.id} size="small" disabled={controlsBusy} onClick={() => void mutate('/scenes/' + scene.id, 'POST', {})}>{scene.name}</Button>)}</div>
  </>;
  return <section ref={page} className="vr-page" aria-label="家庭空间">
    <div className="vr-toolbar">
      <div className="vr-mode-switch" role="group" aria-label="空间展示模式"><button aria-pressed={displayMode === 'model'} onClick={() => switchMode('model')}>三维空间</button><button aria-pressed={displayMode === 'panorama'} onClick={() => switchMode('panorama')}>设计全景</button></div>
      <div className="button-row">
        {role !== 'guest' && <select aria-label="展示模型" value={modelId} onChange={event => onSelectModel(event.target.value)}>{library.models.map(value => <option key={value.id} value={value.id}>{value.name}{library.defaultModelId === value.id ? ' · 默认' : ''}</option>)}</select>}
        {displayMode === 'model' ? <><Button icon={<Box size={16} />} disabled={!rendererReady} onClick={() => selectRoom('')}>全屋总览</Button>{role !== 'guest' && <Button icon={<Settings2 size={16} />} onClick={() => setSettingsOpen(true)}>模型设置</Button>}</> : <select className="vr-panorama-select" aria-label="全景房间" value={panoramaRoomId ?? ''} onChange={event => selectPanorama(event.target.value)}><option value="" disabled>选择全景房间</option>{version.rooms.filter(value => value.panoramaSceneId).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select>}
        <Button aria-label="全屏查看" icon={<Expand size={17} />} onClick={() => void fullscreen()} />
      </div>
    </div>
    <div ref={workspace} className={'vr-workspace' + (compact ? ' vr-workspace-compact' : '')}>
      <div className={'vr-stage' + (displayMode === 'panorama' ? ' vr-stage-panorama' : nightMode ? ' vr-stage-night' : '')}>
        <div ref={host} className="vr-canvas" hidden={displayMode !== 'model'} />
        {displayMode === 'panorama' ? <Panorama scene={panoramaScene} /> : <>
          <div className="vr-view-label">{room?.name || modelName}{!live && ' · 缓存状态'}</div>
          {!modelError && !modelReady && status.modelState !== 'error' && <div className="vr-message" role="status">正在加载模型…</div>}
          {(modelError || status.modelState === 'error') && <div className="vr-message vr-error" role="alert">{modelError || '模型加载失败'}<button className="vr-panorama-retry" onClick={() => setLoadAttempt(value => value + 1)}>重试</button></div>}
        </>}
        {error && <div className="vr-message vr-error" role="alert">{error}<Button size="small" onClick={() => setLoadAttempt(value => value + 1)}>重试</Button><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      </div>
      {!compact && <aside className="vr-inspector">{roomPanel}</aside>}
    </div>
    {compact && <button className="vr-panel-trigger" onClick={() => setPanelOpen(true)} aria-expanded={panelOpen}><Map size={20} /><span>{activeRoom?.name || '全屋'} · {activeRoom ? roomDevices.length : associatedDevices.length} 台设备</span><span>查看设备与房间</span></button>}
    <Drawer title={<div className="vr-drawer-title"><span>{activeRoom?.name || '房间与设备'}</span><Button type="text" size="small" aria-label="关闭房间面板" onClick={() => setPanelOpen(false)}>关闭</Button></div>} closable={false} visible={compact && panelOpen} onCancel={() => setPanelOpen(false)} footer={null} mask={false} placement={mobile ? 'bottom' : 'right'} width={380} height={mobile ? '50dvh' : '75dvh'} className="vr-panel-drawer" getPopupContainer={popupContainer} unmountOnExit>{roomPanel}</Drawer>
    <DevicePanel device={state.devices.find(device => device.id === selectedDevice)} visible={!!selectedDevice} mobile={mobile} busy={controlsBusy} mutate={mutate} onClose={closeDevice} />
    <Drawer title="模型设置" visible={settingsOpen} onCancel={() => setSettingsOpen(false)} footer={null} width="min(560px, 100vw)" getPopupContainer={popupContainer} unmountOnExit>
      <ModelManager library={library} selectedModelId={modelId} onSaved={onSaved} devices={state.devices} disabled={!live || busy} canManage={role === 'admin'} />
    </Drawer>
    <Modal title="房间导航" visible={mapOpen} footer={null} onCancel={() => setMapOpen(false)} style={{ width: 'min(880px, calc(100vw - 32px))' }} getPopupContainer={popupContainer} unmountOnExit><SpaceMap room={focusedRoom ?? ''} version={version} onSelect={selectRoom} /></Modal>
  </section>;
}
