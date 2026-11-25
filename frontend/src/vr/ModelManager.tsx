import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@arco-design/web-react';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeObject } from './scene';
import { allPanoramaScenes, legacyPanoramaScenes, panoramaScenes } from './panoramas';
import type { DeviceSnapshot } from '../types';
import { ApiError } from '../api';
import { currentModelVersion, draftFromVersion, loadModelLibrary, MAX_MODEL_BYTES, modelBytesBase64, restoreModelVersion, saveSpaceModel, setDefaultModel, validateModelDraft, validateModelGlb, type ModelLibrary, type ModelRoom, type SaveModelInput } from './model-library';
import './model-manager.css';

const ModelGenerator = lazy(() => import('./ModelGenerator'));

type Props = {
  library: ModelLibrary;
  selectedModelId: string;
  onSaved: (library: ModelLibrary, modelId: string) => void;
  devices: DeviceSnapshot[];
  disabled: boolean;
  canManage: boolean;
};
type DraftVersion = SaveModelInput['version'];
type Size = { width: number; depth: number; height: number };

/** Separate renderer: inspecting an upload never changes the currently displayed model. */
export function DraftPreview({ bytes, onReady, onError }: { bytes: ArrayBuffer; onReady: (size: Size) => void; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError }); callbacks.current = { onReady, onError };
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let renderer: T.WebGLRenderer | undefined, controls: OrbitControls | undefined, observer: ResizeObserver | undefined;
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, .01, 10000);
    let framing: T.Box3 | undefined;
    const resize = () => {
      const width = host.current?.clientWidth ?? 0, height = host.current?.clientHeight ?? 0;
      if (!width || !height) return;
      renderer?.setSize(width, height); camera.updateMatrixWorld();
      const size = framing?.clone().applyMatrix4(camera.matrixWorldInverse).getSize(new T.Vector3());
      const halfHeight = size ? Math.max(size.y, size.x / (width / height)) * .58 : 1;
      camera.top = halfHeight; camera.bottom = -halfHeight; camera.right = halfHeight * width / height; camera.left = -camera.right;
      camera.updateProjectionMatrix(); render();
    };
    const render = () => { if (!disposed) renderer?.render(scene, camera); };
    const fail = () => { if (!disposed) callbacks.current.onError('无法预览这个模型，请检查文件与浏览器硬件加速'); };
    setReady(false);
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.localClippingEnabled = true; renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.domElement.setAttribute('aria-label', '待保存模型预览');
      renderer.domElement.tabIndex = 0;
      host.current!.append(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false; controls.addEventListener('change', render);
      scene.add(new T.HemisphereLight(0xffffff, 0x888888, 2));
      const light = new T.DirectionalLight(0xffffff, 2); light.position.set(5, 10, 5); scene.add(light);
      observer = new ResizeObserver(resize);
      observer.observe(host.current!);
      const manager = new T.LoadingManager();
      manager.setURLModifier(url => { if (url.startsWith('blob:') || url.startsWith('data:')) return url; throw new Error('模型包含外部资源'); });
      void new GLTFLoader(manager).parseAsync(bytes, '').then(gltf => {
        if (disposed) { disposeObject(gltf.scene); return; }
        const box = new T.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new T.Vector3());
        if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite) || size.x <= 0 || size.z <= 0 || size.y <= 0) {
          disposeObject(gltf.scene); fail(); return;
        }
        const centre = box.getCenter(new T.Vector3());
        gltf.scene.position.sub(centre); scene.add(gltf.scene);
        const cutPlane = new T.Plane(new T.Vector3(0, -1, 0), 1.22 - centre.y);
        const replaced = new Set<T.Material>();
        gltf.scene.traverse(object => {
          if (['ceiling', 'overhead'].includes(object.userData.presentation)) object.visible = false;
          if (object instanceof T.Mesh && object.userData.presentation === 'wall') {
            const clip = (material: T.Material) => { replaced.add(material); const copy = material.clone(); copy.clippingPlanes = [cutPlane]; return copy; };
            object.material = Array.isArray(object.material) ? object.material.map(clip) : clip(object.material);
          }
        });
        gltf.scene.traverse(object => { if (object instanceof T.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) replaced.delete(material); });
        replaced.forEach(material => material.dispose());
        framing = new T.Box3(size.clone().multiplyScalar(-.5), size.clone().multiplyScalar(.5));
        const distance = Math.max(size.x, size.y, size.z) * 2;
        camera.position.set(distance * .65, distance * .7, distance);
        camera.near = Math.max(.001, distance / 1000); camera.far = distance * 20; camera.updateProjectionMatrix();
        controls!.target.set(0, 0, 0); controls!.update(); resize();
        callbacks.current.onReady({ width: size.x, depth: size.z, height: size.y }); setReady(true); render();
      }).catch(fail);
    } catch { fail(); }
    return () => { disposed = true; observer?.disconnect(); controls?.dispose(); disposeObject(scene); renderer?.dispose(); renderer?.domElement.remove(); };
  }, [bytes]);
  return <div className="model-draft-preview"><div ref={host} />{!ready && <p role="status">正在检查并预览模型…</p>}</div>;
}

function RoomFootprints({ version }: { version: DraftVersion }) {
  if (!(version.width > 0 && version.depth > 0)) return null;
  return <svg className="model-room-plan" viewBox={`0 0 ${version.width} ${version.depth}`} role="img" aria-label="待保存模型房间范围">
    <rect width={version.width} height={version.depth} fill="var(--control)" />
    {version.rooms.filter(room => room.bounds?.every(Number.isFinite)).map(room => {
      const [x0, z0, x1, z1] = room.bounds!;
      if (x1 <= x0 || z1 <= z0) return null;
      return <g key={room.id}><rect x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={Math.max(version.width, version.depth) / 250} /><text x={(x0 + x1) / 2} y={(z0 + z1) / 2} textAnchor="middle" dominantBaseline="middle" fill="var(--color-text)" fontSize={Math.max(version.width, version.depth) / 32}>{room.name}</text></g>;
    })}
  </svg>;
}

export default function ModelManager({ library, selectedModelId, onSaved, devices, disabled, canManage }: Props) {
  const selected = library.models.find(model => model.id === selectedModelId);
  const current = selected && currentModelVersion(selected);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [mode, setMode] = useState<'update' | 'new'>('update');
  const [name, setName] = useState(selected?.name ?? '');
  const [version, setVersion] = useState<DraftVersion>(() => draftFromVersion(current));
  const [revision, setRevision] = useState(library.revision);
  const [widthText, setWidthText] = useState(String(current?.width ?? 10));
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [fileName, setFileName] = useState('');
  const [previewReady, setPreviewReady] = useState(false);
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [restoreId, setRestoreId] = useState(current?.id ?? '');
  const uploadAttempt = useRef(0), fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; uploadAttempt.current++; }; }, []);
  function reset(nextMode: 'update' | 'new', nextLibrary = library, nextId = selectedModelId) {
    uploadAttempt.current++;
    const model = nextLibrary.models.find(value => value.id === nextId), source = model && currentModelVersion(model);
    setMode(nextMode); setName(nextMode === 'update' ? model?.name ?? '' : '');
    const draft = draftFromVersion(nextMode === 'update' ? source : undefined);
    setVersion(draft); setWidthText(String(Number(draft.width.toFixed(4))));
    setRevision(nextLibrary.revision); setBytes(undefined); setFileName(''); setPreviewReady(false); setReading(false);
    setError(''); setNotice(''); setConflict(false); setRestoreId(source?.id ?? '');
    if (fileInput.current) fileInput.current.value = '';
  }
  useEffect(() => { reset('update'); }, [selectedModelId]);
  const pending = disabled || busy || reading;
  const fixedGeometry = version.source === 'builtin' || version.source === 'generated';
  const panoramaOptions = version.source === 'generated' ? (version.panoramas ?? []).map(scene => ({ id: scene.id, label: scene.name }))
    : (version.source === 'builtin' ? (version.builtinGeometryId ? panoramaScenes : legacyPanoramaScenes) : allPanoramaScenes)
      .map(scene => ({ id: scene.id, label: scene.assetDirectory ? scene.label : `原方案 · ${scene.label}` }));
  const availableRooms = new Map(devices.map(device => [device.roomId, device.room]));
  const bindingNames = new Map(library.models.flatMap(model => model.versions.flatMap(item => item.rooms.flatMap(room => room.deviceRoomIds.map(id => [id, room.name] as const)))));
  const allBindings = [...availableRooms].map(([id, label]) => ({ id, label }));
  const roomBindingOptions = (room: ModelRoom) => allBindings.concat(room.deviceRoomIds.filter(id => !availableRooms.has(id)).map(id => ({ id, label: `${bindingNames.get(id) ?? '原房间'}（暂无设备，保留关联）` })));
  function updateRoom(id: string, update: Partial<ModelRoom>) {
    setVersion(value => ({ ...value, rooms: value.rooms.map(room => room.id === id ? { ...room, ...update } : room) }));
  }
  async function readUpload(file?: File) {
    if (!file) return;
    const attempt = ++uploadAttempt.current;
    setReading(true); setError(''); setNotice(''); setBytes(undefined); setPreviewReady(false); setFileName('');
    try {
      if (file.size > MAX_MODEL_BYTES) throw new Error('模型超过 30 MB，请先简化模型');
      const buffer = await file.arrayBuffer(); validateModelGlb(buffer);
      if (!mounted.current || attempt !== uploadAttempt.current) return;
      setBytes(buffer); setFileName(file.name);
      setVersion(previous => {
        const { plan: _plan, sourceId: _sourceId, panoramas: _panoramas, builtinGeometryId: _builtinGeometryId, ...value } = previous;
        return { ...value, source: 'upload', assetId: undefined, rooms: value.rooms.map(({ bounds: _bounds, ...room }) => ({ ...room, panoramaSceneId: previous.source === 'generated' ? undefined : room.panoramaSceneId })) };
      });
      if (!name.trim()) setName(file.name.replace(/\.glb$/i, '').slice(0, 80));
    } catch (reason) { if (mounted.current && attempt === uploadAttempt.current) setError(reason instanceof Error ? reason.message : '模型读取失败'); }
    finally { if (mounted.current && attempt === uploadAttempt.current) setReading(false); }
  }
  function calibrateWidth(text: string) {
    setWidthText(text);
    const width = Number(text);
    if (!Number.isFinite(width) || width <= 0) return;
    setVersion(value => {
      const ratio = width / value.width;
      return { ...value, width, depth: value.depth * ratio, height: value.height * ratio,
        rooms: value.rooms.map(room => ({ ...room, bounds: room.bounds?.map(number => number * ratio) as ModelRoom['bounds'] })) };
    });
  }
  async function save() {
    if (!widthText.trim() || !Number.isFinite(Number(widthText)) || Number(widthText) <= 0) { setError('请填写有效的模型宽度'); return; }
    const invalid = validateModelDraft(name, version);
    if (invalid) { setError(invalid); return; }
    if (bytes && !previewReady) { setError('请先完成模型预览'); return; }
    if (version.source !== 'builtin' && !version.assetId && !bytes) { setError('请先选择并预览 GLB 模型'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const previousIds = new Set(library.models.map(model => model.id));
      const result = await saveSpaceModel({ revision, name: name.trim(), version, ...(bytes ? { assetBase64: modelBytesBase64(bytes) } : {}) }, mode === 'update' ? selectedModelId : undefined);
      const id = mode === 'update' ? selectedModelId : result.models.find(model => !previousIds.has(model.id))?.id;
      if (!id) throw new Error('模型已保存，请重新打开模型设置查看');
      if (mounted.current) { reset('update', result, id); setNotice('模型已保存'); }
      // A committed version must reach the parent catalog even if the drawer was closed.
      onSaved(result, id);
    } catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : '模型保存失败'); setConflict(reason instanceof ApiError && reason.status === 409); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function changeLibrary(action: 'restore' | 'default') {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = action === 'restore' ? await restoreModelVersion(selectedModelId, restoreId, library.revision) : await setDefaultModel(selectedModelId, library.revision);
      if (mounted.current) {
        if (action === 'restore') reset('update', result);
        setNotice(action === 'restore' ? '已恢复所选版本' : '已设为默认展示模型');
      }
      onSaved(result, selectedModelId);
    } catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : '操作失败'); setConflict(reason instanceof ApiError && reason.status === 409); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function reloadLibrary() {
    setBusy(true); setError('');
    try {
      const result = await loadModelLibrary();
      if (!mounted.current) return;
      const id = result.models.some(model => model.id === selectedModelId) ? selectedModelId : result.defaultModelId;
      reset('update', result, id); onSaved(result, id);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '载入失败，请重试'); }
    finally { if (mounted.current) setBusy(false); }
  }
  const generationEntry = <>
    <Button type="primary" disabled={pending} onClick={() => setGeneratorOpen(true)}>从户型图与全景生成</Button>
    <Modal title="生成三维模型" className="model-generator-modal" visible={generatorOpen} onCancel={() => setGeneratorOpen(false)} footer={null} style={{ width: 'min(1160px, calc(100vw - 24px))' }} getPopupContainer={() => document.fullscreenElement ?? document.body} unmountOnExit><Suspense fallback={<p role="status">正在打开生成工具…</p>}><ModelGenerator library={library} selectedModelId={selectedModelId} devices={devices} disabled={disabled} canManage={canManage} onSaved={onSaved} /></Suspense></Modal>
  </>;
  if (!selected) return <p role="status">请选择模型</p>;
  if (!canManage) return <div className="model-manager"><strong>{selected.name}</strong><p>共 {selected.versions.length} 个版本</p><p>可生成自己的草稿，保存到家庭模型库由管理员操作。</p>{generationEntry}</div>;
  return <div className="model-manager">
    {generationEntry}
    {error && <p className="model-error" role="alert">{error}</p>}
    {conflict && <Button disabled={pending} onClick={() => void reloadLibrary()}>放弃草稿并重新载入最新版本</Button>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={pending}>
      <div className="model-save-mode" role="group" aria-label="模型保存方式">
        <label><input type="radio" name="model-save-mode" checked={mode === 'update'} onChange={() => reset('update')} />更新当前模型</label>
        <label><input type="radio" name="model-save-mode" checked={mode === 'new'} onChange={() => reset('new')} />保存为新模型</label>
      </div>
      <label>模型名称<input maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{mode === 'update' ? '替换模型文件（可选）' : '选择 GLB 模型'}<input ref={fileInput} type="file" accept=".glb,model/gltf-binary" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readUpload(file); }} /></label>
      {reading && <p role="status">正在读取模型…</p>}
      {bytes && <><p>{fileName}</p><DraftPreview bytes={bytes} onReady={size => { setPreviewReady(true); setWidthText(String(Number(size.width.toFixed(4)))); setVersion(value => ({ ...value, ...size })); }} onError={message => { setPreviewReady(false); setError(message); }} /></>}
      <div className="model-dimensions">
        <label>宽度（米）<input type="number" min="0.01" max="200" step="0.01" disabled={fixedGeometry || (!!bytes && !previewReady)} value={widthText} onChange={event => calibrateWidth(event.target.value)} /></label>
        <label>进深（米）<input readOnly value={Number.isFinite(version.depth) ? Number(version.depth.toFixed(4)) : ''} /></label>
        <label>高度（米）<input readOnly value={Number.isFinite(version.height) ? Number(version.height.toFixed(4)) : ''} /></label>
      </div>
      {!fixedGeometry && <p className="model-hint">宽度按模型左右方向计量；校准宽度后，其他尺寸与房间范围按相同比例调整。</p>}
      <div className="model-room-heading"><strong>房间与设备关联</strong><Button size="small" disabled={fixedGeometry || version.rooms.length >= 100} onClick={() => setVersion(value => ({ ...value, rooms: [...value.rooms, { id: crypto.randomUUID(), name: '', deviceRoomIds: [] }] }))}>添加房间</Button></div>
      <RoomFootprints version={version} />
      {version.rooms.map((room, index) => <section className="model-room-editor" key={room.id} aria-label={`房间 ${index + 1}`}>
        <div className="model-room-heading"><strong>房间 {index + 1}</strong>{!fixedGeometry && <Button size="small" status="danger" onClick={() => setVersion(value => ({ ...value, rooms: value.rooms.filter(item => item.id !== room.id) }))}>移除</Button>}</div>
        <label>房间名称<input maxLength={80} value={room.name} onChange={event => updateRoom(room.id, { name: event.target.value })} /></label>
        <label className="model-check"><input type="checkbox" disabled={fixedGeometry} checked={!!room.bounds} onChange={event => updateRoom(room.id, { bounds: event.target.checked ? [0, 0, version.width, version.depth] : undefined })} />在模型中定位房间</label>
        {room.bounds && <div className="model-bounds">{['左边距 X', '上边距 Z', '右边界 X', '下边界 Z'].map((label, position) => <label key={label}>{label}（米）<input type="number" step="0.01" min="0" disabled={fixedGeometry} value={Number.isFinite(room.bounds![position]) ? room.bounds![position] : ''} onChange={event => { const bounds = [...room.bounds!] as [number, number, number, number]; bounds[position] = event.target.valueAsNumber; updateRoom(room.id, { bounds }); }} /></label>)}</div>}
        <p>关联家庭房间</p>
        <div className="model-room-bindings">{roomBindingOptions(room).length ? roomBindingOptions(room).map(option => <label className="model-check" key={option.id}><input type="checkbox" checked={room.deviceRoomIds.includes(option.id)} onChange={event => updateRoom(room.id, { deviceRoomIds: event.target.checked ? [...room.deviceRoomIds, option.id] : room.deviceRoomIds.filter(id => id !== option.id) })} />{option.label}</label>) : <p className="model-hint">暂无可关联的设备房间</p>}</div>
        <label>关联全景<select value={room.panoramaSceneId ?? ''} onChange={event => updateRoom(room.id, { panoramaSceneId: event.target.value || undefined })}><option value="">不关联</option>{panoramaOptions.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>
      </section>)}
      {!version.rooms.length && <p className="model-hint">尚未添加房间，保存后可查看模型，添加关联后才能按房间查看设备。</p>}
      <div className="model-save-summary"><strong>{mode === 'update' ? `更新“${selected.name}”` : '新建独立模型'}</strong><p>{version.rooms.length} 个房间 · {version.rooms.filter(room => room.deviceRoomIds.length).length} 个房间已关联设备</p><p className="model-hint">{mode === 'update' ? '保存为新版本，之前的版本仍可恢复。' : '原模型保留，新模型使用以上房间与设备关联。'}</p><Button type="primary" long loading={busy} disabled={pending || (!!bytes && !previewReady)} onClick={() => void save()}>{mode === 'update' ? '保存新版本' : '保存新模型'}</Button></div>
    </fieldset>
    <div className="model-history"><strong>已保存版本</strong><label>历史版本<select disabled={pending} value={restoreId} onChange={event => setRestoreId(event.target.value)}>{selected.versions.map((item, index) => <option key={item.id} value={item.id}>版本 {index + 1} · {new Date(item.createdAt).toLocaleString('zh-CN')}{item.id === selected.currentVersionId ? '（当前）' : ''}</option>)}</select></label><div className="button-row"><Button disabled={pending || !restoreId || restoreId === selected.currentVersionId} onClick={() => void changeLibrary('restore')}>恢复此版本</Button><Button disabled={pending || selectedModelId === library.defaultModelId} onClick={() => void changeLibrary('default')}>{selectedModelId === library.defaultModelId ? '当前默认模型' : '设为默认模型'}</Button></div></div>
  </div>;
}
