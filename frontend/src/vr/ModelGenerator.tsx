import { useEffect, useRef, useState } from 'react';
import { Button } from '@arco-design/web-react';
import type { ModelLibrary, ModelRoom } from '../../../packages/contracts/space-models';
import type { PlanFurniture, PlanWall } from '../../../packages/contracts/model-generation';
import type { DeviceSnapshot } from '../types';
import type { AIConnection } from '../profile/ai-connections-model';
import { ApiError, request } from '../api';
import { currentModelVersion, loadModelLibrary } from './model-library';
import { DraftPreview } from './ModelManager';
import { canRestoreGenerationPlan, cancelGenerationJob, createGenerationJob, createGenerationSource, generationAssetUrl, generationEndpoint, generationError, generationPreview, generationJobCanReplace, jobRunning, jobStatus, listGenerationJobs, listGenerationSources, loadGenerationJob, prepareGenerationImage, publishGenerationJob, removeGeneratedRoom, reviseGenerationRooms, saveGenerationPlan, scaleGeneratedPlan, type GeneratedPlan, type GenerationJob, type GenerationSource, type PreparedImage } from './model-generation';
import './model-generation.css';

type Props = { library: ModelLibrary; selectedModelId: string; devices: DeviceSnapshot[]; disabled: boolean; canManage: boolean; onSaved: (library: ModelLibrary, modelId: string) => void };
const furnitureNames: Record<PlanFurniture['kind'], string> = { sofa: '沙发', bed: '床', table: '餐桌 / 茶几', chair: '椅子', cabinet: '柜体', desk: '书桌', toilet: '马桶', basin: '台盆', shower: '淋浴', plant: '绿植' };
const materialNames: Record<PlanFurniture['material'], string> = { wood: '木质', fabric: '布艺', stone: '石材', metal: '金属', ceramic: '陶瓷', glass: '玻璃' };
const shortNumber = (value: number) => Number.isFinite(value) ? Number(value.toFixed(3)) : '';
const uid = () => crypto.randomUUID();

function NumberField({ label, value, onChange, min = 0, step = .01, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; step?: number; max?: number }) {
  return <label>{label}<input type="number" min={min} max={max} step={step} value={shortNumber(value)} onChange={event => onChange(event.target.valueAsNumber)} /></label>;
}
function PlanCanvas({ plan, selectedRoomId, onSelect }: { plan: GeneratedPlan; selectedRoomId: string; onSelect: (id: string) => void }) {
  const line = Math.max(plan.width, plan.depth) / 300;
  return <svg className="generation-plan" viewBox={`-.3 -.3 ${plan.width + .6} ${plan.depth + .6}`} aria-label="可选择房间的户型平面图" role="group">
    <polygon points={plan.footprint.map(point => point.join(',')).join(' ')} fill={plan.finishes.floorColor} stroke="var(--muted)" strokeWidth={line} />
    {plan.rooms.filter(room => room.bounds?.every(Number.isFinite)).map(room => {
      const [x0, z0, x1, z1] = room.bounds!;
      return <g key={room.id} role="button" tabIndex={0} aria-label={`选择${room.name}`} aria-pressed={selectedRoomId === room.id} onClick={() => onSelect(room.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(room.id); } }}>
        <rect x={x0} y={z0} width={Math.max(0, x1 - x0)} height={Math.max(0, z1 - z0)} fill={selectedRoomId === room.id ? 'var(--accent-soft)' : 'transparent'} stroke={selectedRoomId === room.id ? 'var(--accent)' : 'var(--line)'} strokeWidth={line * 2} />
        <text x={(x0 + x1) / 2} y={(z0 + z1) / 2} textAnchor="middle" dominantBaseline="middle" fill="var(--color-text)" fontSize={Math.max(plan.width, plan.depth) / 34} pointerEvents="none">{room.name}</text>
      </g>;
    })}
    {plan.walls.map(wall => <line key={wall.id} x1={wall.from[0]} y1={wall.from[1]} x2={wall.to[0]} y2={wall.to[1]} stroke={plan.finishes.wallColor} strokeWidth={wall.thickness} pointerEvents="none" />)}
    {plan.walls.flatMap(wall => {
      const dx = wall.to[0] - wall.from[0], dz = wall.to[1] - wall.from[1], length = Math.hypot(dx, dz);
      if (!length) return [];
      return wall.openings.map((opening, index) => <line key={wall.id + '-' + index} x1={wall.from[0] + dx * opening.offset / length} y1={wall.from[1] + dz * opening.offset / length} x2={wall.from[0] + dx * (opening.offset + opening.width) / length} y2={wall.from[1] + dz * (opening.offset + opening.width) / length} stroke={opening.kind === 'door' ? '#c19666' : '#7baec8'} strokeWidth={Math.max(wall.thickness, line * 4)} pointerEvents="none" />);
    })}
    {plan.furniture.map(item => <rect key={item.id} x={item.x - item.width / 2} y={item.z - item.depth / 2} width={Math.max(0, item.width)} height={Math.max(0, item.depth)} rx={item.style === 'rounded' ? Math.min(item.width, item.depth) / 5 : 0} transform={`rotate(${-item.rotation} ${item.x} ${item.z})`} fill={item.color} stroke="#777" strokeWidth={line} pointerEvents="none" />)}
  </svg>;
}

export default function ModelGenerator({ library, selectedModelId, devices, disabled, canManage, onSaved }: Props) {
  const selectedModel = library.models.find(model => model.id === selectedModelId);
  const selectedVersion = selectedModel && currentModelVersion(selectedModel);
  const [connections, setConnections] = useState<AIConnection[]>([]), [connectionId, setConnectionId] = useState('');
  const [sources, setSources] = useState<GenerationSource[]>([]), [sourceId, setSourceId] = useState('');
  const [sourceUrl, setSourceUrl] = useState(''), [floorplan, setFloorplan] = useState<PreparedImage>();
  const [knownWidth, setKnownWidth] = useState(''), [knownDepth, setKnownDepth] = useState(''), [height, setHeight] = useState('2.8');
  const [jobs, setJobs] = useState<GenerationJob[]>([]), [historyId, setHistoryId] = useState(''), [job, setJob] = useState<GenerationJob>();
  const [plan, setPlan] = useState<GeneratedPlan>(), [dirty, setDirty] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState(''), [editor, setEditor] = useState<'rooms' | 'outline' | 'walls' | 'furniture'>('rooms');
  const [preview, setPreview] = useState<ArrayBuffer>(), [previewError, setPreviewError] = useState(''), [previewReady, setPreviewReady] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [previewAttempt, setPreviewAttempt] = useState(0), [processing, setProcessing] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revisionConflict, setRevisionConflict] = useState(false), [showSetup, setShowSetup] = useState(true);
  const [revisionRooms, setRevisionRooms] = useState<string[]>([]), [instruction, setInstruction] = useState('');
  const [catalogRevision, setCatalogRevision] = useState(library.revision);
  const [publishMode, setPublishMode] = useState<'new' | 'update'>('new'), [modelName, setModelName] = useState('');
  const currentJob = useRef<GenerationJob>();
  const mounted = useRef(false), operation = useRef(0), locked = useRef(false), activeId = useRef('');
  const busy = processing || initializing || disabled;
  const running = jobRunning(job);
  const selectedConnection = connections.find(value => value.id === connectionId);
  const activeSource = sources.find(value => value.id === job?.sourceId);
  const room = plan?.rooms.find(value => value.id === selectedRoomId);
  const bindingOptions = [...new Map(devices.map(device => [device.roomId, device.room])).entries()];
  const selectedReference = activeSource?.scenes.find(scene => scene.id === room?.panoramaSceneId);

  function acceptJob(next: GenerationJob, activate = true) {
    if (!generationJobCanReplace(currentJob.current, next)) return;
    currentJob.current = next;
    activeId.current = next.id; setJob(next); setHistoryId(next.id); setJobs(items => [next, ...items.filter(item => item.id !== next.id)]);
    setPlan(next.plan ? structuredClone(next.plan) : undefined); setDirty(false); setRevisionConflict(false);
    setSelectedRoomId(previous => next.plan?.rooms.some(room => room.id === previous) ? previous : next.plan?.rooms[0]?.id ?? '');
    setRevisionRooms([]); if (activate) setShowSetup(false);
    setError(next.error ?? '');
  }
  async function run(action: () => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true; const epoch = ++operation.current; setProcessing(true); setError(''); setNotice('');
    try { await action(); }
    catch (reason) { if (mounted.current && epoch === operation.current) { setError(generationError(reason)); setRevisionConflict(reason instanceof ApiError && reason.status === 409); } }
    finally { if (mounted.current && epoch === operation.current) { locked.current = false; setProcessing(false); } }
  }
  useEffect(() => {
    mounted.current = true;
    void Promise.allSettled([request<{ connections: AIConnection[] }>('/ai/connections'), listGenerationSources(), listGenerationJobs()]).then(results => {
        if (!mounted.current) return;
        setInitializing(false);
        const [connectionsResult, sourcesResult, jobsResult] = results;
        if (connectionsResult.status === 'fulfilled') { setConnections(connectionsResult.value.connections); setConnectionId(connectionsResult.value.connections[0]?.id ?? ''); }
        if (sourcesResult.status === 'fulfilled') setSources(sourcesResult.value.sources);
        if (jobsResult.status === 'fulfilled') setJobs(jobsResult.value.jobs);
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') setError(generationError(failure.reason));
      });
    return () => { mounted.current = false; operation.current++; activeId.current = ''; };
  }, []);
  useEffect(() => {
    if (!job || !jobRunning(job)) return;
    let disposed = false, timer: number;
    const poll = async () => {
      try { const next = await loadGenerationJob(job.id); if (!disposed && mounted.current && activeId.current === job.id) acceptJob(next, false); }
      catch (reason) { if (!disposed && mounted.current) { setError(generationError(reason)); if (!(reason instanceof ApiError && [401, 403, 404].includes(reason.status))) timer = window.setTimeout(() => void poll(), 4000); } }
    };
    timer = window.setTimeout(() => void poll(), 2000);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [job]);
  useEffect(() => {
    setPreview(undefined); setPreviewReady(false); setPreviewError('');
    if (!job?.plan || job.status !== 'ready') return;
    const controller = new AbortController();
    void generationPreview(job, controller.signal).then(bytes => { if (!controller.signal.aborted) setPreview(bytes); }).catch(reason => { if (!controller.signal.aborted) setPreviewError(generationError(reason)); });
    return () => controller.abort();
  }, [job?.id, job?.revision, job?.status, previewAttempt]);

  function edit(change: (value: GeneratedPlan) => GeneratedPlan) { setPlan(value => value ? change(value) : value); setDirty(true); }
  function editRoom(id: string, change: Partial<ModelRoom>) { edit(value => ({ ...value, rooms: value.rooms.map(room => room.id === id ? { ...room, ...change } : room) })); }
  function editWall(id: string, change: Partial<PlanWall>) { edit(value => ({ ...value, walls: value.walls.map(wall => wall.id === id ? { ...wall, ...change } : wall) })); }
  function editFurniture(id: string, change: Partial<PlanFurniture>) { edit(value => ({ ...value, furniture: value.furniture.map(item => item.id === id ? { ...item, ...change } : item) })); }
  async function refreshHistory() {
    const [catalog, references, services] = await Promise.all([listGenerationJobs(), listGenerationSources(), request<{ connections: AIConnection[] }>('/ai/connections')]);
    if (mounted.current) { setJobs(catalog.jobs); setSources(references.sources); setConnections(services.connections); setConnectionId(current => services.connections.some(item => item.id === current) ? current : services.connections[0]?.id ?? ''); }
  }
  async function importSource() {
    if (!sourceUrl.trim()) throw new Error('请粘贴全景分享链接');
    const source = await createGenerationSource({ url: sourceUrl.trim() });
    if (mounted.current) { setSources(items => [source, ...items.filter(item => item.id !== source.id)]); setSourceId(source.id); setNotice(`已导入 ${source.scenes.length} 个房间参考`); }
  }
  async function uploadReferences(files: File[]) {
    if (!files.length || files.length > 12) throw new Error('每次请选择 1–12 张房间参考图');
    const images: PreparedImage[] = [];
    for (const file of files) images.push(await prepareGenerationImage(file, 'reference'));
    if (!mounted.current) return;
    const source = await createGenerationSource({ images });
    if (mounted.current) { setSources(items => [source, ...items]); setSourceId(source.id); setNotice(`已导入 ${source.scenes.length} 张房间参考图`); }
  }
  async function start() {
    if (!connectionId || !floorplan) throw new Error('请选择个人 AI 服务并上传户型图');
    const parseSize = (value: string, label: string) => { if (!value.trim()) return undefined; const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}须大于 0`); return number; };
    const next = await createGenerationJob({ connectionId, floorplan, ...(sourceId ? { sourceId } : {}), knownWidth: parseSize(knownWidth, '宽度'), knownDepth: parseSize(knownDepth, '进深'), height: parseSize(height, '层高') });
    if (mounted.current) acceptJob(next);
  }
  async function restorePlan() {
    if (!job?.plan || !canRestoreGenerationPlan(job)) return;
    const next = await saveGenerationPlan(job, job.plan);
    if (mounted.current) { acceptJob(next); setNotice('已恢复上次方案，未调用 AI 服务'); }
  }
  async function savePlan() {
    if (!job || !plan) return;
    const next = await saveGenerationPlan(job, plan); if (mounted.current) { acceptJob(next); setNotice('校正已保存，正在更新三维预览'); }
  }
  async function publish() {
    if (!canManage) throw new Error('保存到家庭模型库需要管理员权限');
    if (!job || !plan || dirty || job.status !== 'ready' || !previewReady) throw new Error('请先保存校正并完成三维预览');
    if (!modelName.trim()) throw new Error('请填写模型名称');
    const result = await publishGenerationJob(job, catalogRevision, modelName.trim(), publishMode === 'update' ? selectedModelId : undefined);
    // Persistence completion still reaches the parent if the user closes this dialog.
    onSaved(result.library, result.modelId);
    if (mounted.current) setNotice('模型已保存');
  }
  async function revise() {
    if (!job || dirty) throw new Error('请先保存当前校正');
    if (!connectionId || !revisionRooms.length || !instruction.trim()) throw new Error('请选择 AI 服务、房间，并填写修改要求');
    const next = await reviseGenerationRooms(job, connectionId, revisionRooms, instruction.trim());
    if (mounted.current) acceptJob(next);
  }
  async function reloadConflict() {
    if (!job) return;
    const [next, catalog] = await Promise.all([loadGenerationJob(job.id), loadModelLibrary()]);
    if (mounted.current) { setCatalogRevision(catalog.revision); acceptJob(next); }
  }
  async function editExisting() {
    if (!selectedVersion) return;
    const next = await request<GenerationJob>(generationEndpoint + '/jobs/from-model', 'POST', { modelId: selectedModelId, versionId: selectedVersion.id });
    if (mounted.current) { acceptJob(next); setPublishMode('update'); setModelName(selectedModel?.name ?? ''); }
  }
  return <div className="model-generator">
    {error && <p className="generation-error" role="alert">{error}</p>}{notice && <p className="generation-notice" role="status">{notice}</p>}
    <div className="generation-topbar"><Button disabled={busy} onClick={() => setShowSetup(value => !value)}>{showSetup ? '收起素材输入' : '新建生成任务'}</Button>{selectedVersion?.source === 'generated' && <Button disabled={busy} onClick={() => void run(editExisting)}>编辑当前已保存方案</Button>}<Button disabled={busy} onClick={() => void run(refreshHistory)}>刷新任务与服务</Button></div>
    <div className="generation-history"><label>我的生成任务<select value={historyId} disabled={busy} onChange={event => setHistoryId(event.target.value)}><option value="">选择任务</option>{jobs.map(value => <option key={value.id} value={value.id}>{new Date(value.createdAt).toLocaleString('zh-CN')} · {jobStatus[value.status]}</option>)}</select></label><Button disabled={busy || !historyId} onClick={() => void run(async () => { const next = await loadGenerationJob(historyId); if (mounted.current) acceptJob(next); })}>{dirty ? '放弃编辑并载入任务' : '载入任务'}</Button></div>
    {showSetup && <section className="generation-setup"><fieldset disabled={busy || running}>
      <label>个人 AI 服务<select value={connectionId} onChange={event => setConnectionId(event.target.value)}><option value="">请选择</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.model}</option>)}</select></label>
      {!connections.length && <p>请先在“家庭设置 → 我的 AI”添加个人服务。</p>}
      <label>户型图<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { const image = await prepareGenerationImage(file, 'floorplan'); if (mounted.current) setFloorplan(image); }); }} /></label>
      {floorplan && <img className="generation-upload" src={`data:${floorplan.mime};base64,${floorplan.dataBase64}`} alt="待识别户型图" />}
      <div className="generation-grid-3"><label>已知总宽（米）<input type="number" min="0" step="0.01" value={knownWidth} max="100" placeholder="可选" onChange={event => setKnownWidth(event.target.value)} /></label><label>已知进深（米）<input type="number" min="0" step="0.01" value={knownDepth} max="100" placeholder="可选" onChange={event => setKnownDepth(event.target.value)} /></label><label>层高（米）<input type="number" min="1.8" max="8" step="0.01" value={height} onChange={event => setHeight(event.target.value)} /></label></div>
      <label>全景分享链接<input type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="炫云网页分享链接" /></label><Button disabled={!sourceUrl.trim()} onClick={() => void run(importSource)}>读取全景素材</Button>
      <label>或上传房间参考图<input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void run(() => uploadReferences(files)); }} /></label>
      <label>本次装修参考<select value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">仅依据户型图生成基础模型</option>{sources.map(source => <option key={source.id} value={source.id}>{source.title} · {source.scenes.length} 张参考</option>)}</select></label>
      {selectedConnection && <p className="generation-hint">点击后，将把压缩后的户型图与所选参考图发送至 {selectedConnection.name}（{selectedConnection.baseUrl}），使用 {selectedConnection.model}，费用按该服务计费。</p>}
      <Button type="primary" disabled={busy || running || !floorplan || !connectionId} onClick={() => void run(start)}>识别并生成预览</Button>
    </fieldset></section>}
    {job && <section className="generation-task"><div><strong>{jobStatus[job.status]}</strong>{job.stage && <span> · {job.stage}</span>}</div>{job.usage && <small>输入 {job.usage.inputTokens} · 输出 {job.usage.outputTokens} tokens</small>}{running && <Button disabled={busy} onClick={() => void run(async () => { const next = await cancelGenerationJob(job.id); if (mounted.current) acceptJob(next); })}>取消任务</Button>}{canRestoreGenerationPlan(job) ? <Button disabled={busy} onClick={() => void run(restorePlan)}>恢复上次方案（不调用 AI）</Button> : ['failed', 'cancelled', 'interrupted'].includes(job.status) && <p>可重新提交素材生成，已保存的模型不受影响。</p>}{revisionConflict && <Button disabled={busy} onClick={() => void run(reloadConflict)}>放弃编辑并重新载入任务与模型版本</Button>}</section>}
    {plan && job && <>
      <div className="generation-workspace"><div className="generation-visuals">
        {job.floorplanAssetId && <details><summary>查看本任务户型图</summary><img className="generation-upload" src={generationAssetUrl(job.floorplanAssetId)} alt="本任务的户型参考图" /></details>}
        <PlanCanvas plan={plan} selectedRoomId={selectedRoomId} onSelect={id => { setSelectedRoomId(id); setEditor('rooms'); }} />
        <p className="generation-hint">平面图左上为原点，横向 X，纵向 Z；数字位置单位为米。</p>
        {selectedReference && <figure><img src={generationAssetUrl(selectedReference.imageAssetId)} alt={`${room?.name}的装修参考`} /><figcaption>{selectedReference.name}</figcaption></figure>}
        <div><strong>三维预览</strong>{dirty && <p className="generation-hint">当前预览为上次保存结果，保存校正后更新。</p>}{previewError ? <p className="generation-error" role="alert">{previewError}<Button size="small" onClick={() => setPreviewAttempt(value => value + 1)}>重试预览</Button></p> : preview ? <DraftPreview bytes={preview} onReady={() => setPreviewReady(true)} onError={message => { setPreviewReady(false); setPreviewError(message); }} /> : <p role="status">{running ? '生成完成后显示预览' : job.status === 'ready' ? '正在加载三维预览…' : '任务未完成，暂无三维预览'}</p>}</div>
      </div><div className="generation-editor"><nav aria-label="方案编辑分类">{([['rooms', '房间'], ['outline', '轮廓与尺寸'], ['walls', '墙与门窗'], ['furniture', '家具与饰面']] as const).map(([id, label]) => <button key={id} aria-pressed={editor === id} onClick={() => setEditor(id)}>{label}</button>)}</nav><fieldset disabled={busy || running || job.status !== 'ready'}>
        {editor === 'rooms' && <>
          <label>选择房间<select value={selectedRoomId} onChange={event => setSelectedRoomId(event.target.value)}><option value="">请选择</option>{plan.rooms.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
          <Button disabled={plan.rooms.length >= 30} onClick={() => { const id = uid(); edit(value => ({ ...value, rooms: [...value.rooms, { id, name: '新房间', bounds: [0, 0, Math.min(3, value.width), Math.min(3, value.depth)], deviceRoomIds: [] }] })); setSelectedRoomId(id); }}>添加房间</Button>
          {room && <><label>房间名称<input value={room.name} maxLength={80} onChange={event => editRoom(room.id, { name: event.target.value })} /></label><div className="generation-grid-2">{['左边界 X', '上边界 Z', '右边界 X', '下边界 Z'].map((label, index) => <NumberField key={label} label={label} value={room.bounds?.[index] ?? 0} onChange={number => { const bounds: [number, number, number, number] = [...(room.bounds ?? [0, 0, plan.width, plan.depth])]; bounds[index] = number; editRoom(room.id, { bounds }); }} />)}</div>
            <label>装修参考<select value={room.panoramaSceneId ?? ''} onChange={event => editRoom(room.id, { panoramaSceneId: event.target.value || undefined })}><option value="">不关联</option>{activeSource?.scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</select></label>
            <div className="generation-bindings"><strong>关联家庭房间</strong>{bindingOptions.length ? bindingOptions.map(([id, name]) => <label key={id} className="generation-check"><input type="checkbox" checked={room.deviceRoomIds.includes(id)} onChange={event => editRoom(room.id, { deviceRoomIds: event.target.checked ? [...room.deviceRoomIds, id] : room.deviceRoomIds.filter(value => value !== id) })} />{name}</label>) : <p className="generation-hint">暂无设备房间可关联</p>}</div><Button status="danger" disabled={plan.rooms.length <= 1} onClick={() => { edit(value => removeGeneratedRoom(value, room.id)); setSelectedRoomId(''); }}>移除此房间及家具</Button></>}
        </>}
        {editor === 'outline' && <><NumberField label="等比校准总宽（米）" value={plan.width} min={.01} max={100} onChange={width => { if (Number.isFinite(width) && width > 0) edit(value => scaleGeneratedPlan(value, width)); }} /><p>进深 {shortNumber(plan.depth)} 米</p><NumberField label="层高（米）" value={plan.height} min={1.8} max={8} onChange={height => edit(value => ({ ...value, height }))} /><strong>外轮廓顶点</strong>{plan.footprint.map((point, index) => <div className="generation-point" key={index}><span>{index + 1}</span><NumberField label="X" value={point[0]} onChange={x => edit(value => ({ ...value, footprint: value.footprint.map((p, i) => i === index ? [x, p[1]] : p) }))} /><NumberField label="Z" value={point[1]} onChange={z => edit(value => ({ ...value, footprint: value.footprint.map((p, i) => i === index ? [p[0], z] : p) }))} /><Button size="small" disabled={plan.footprint.length <= 3} onClick={() => edit(value => ({ ...value, footprint: value.footprint.filter((_, i) => i !== index) }))}>移除</Button></div>)}<Button disabled={plan.footprint.length >= 64} onClick={() => edit(value => { const a = value.footprint.at(-1)!, b = value.footprint[0]; return { ...value, footprint: [...value.footprint, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]] }; })}>添加轮廓顶点</Button></>}
        {editor === 'walls' && <><Button disabled={plan.walls.length >= 150} onClick={() => edit(value => ({ ...value, walls: [...value.walls, { id: uid(), from: [0, 0], to: [Math.min(3, value.width), 0], thickness: .12, openings: [] }] }))}>添加墙体</Button>{plan.walls.map((wall, index) => <details key={wall.id}><summary>墙体 {index + 1} · {wall.openings.length} 个门窗</summary><div className="generation-detail"><div className="generation-grid-2">{(['from', 'to'] as const).flatMap((edge, edgeIndex) => [0, 1].map(coordinate => <NumberField key={edge + coordinate} label={`${edgeIndex ? '终点' : '起点'} ${coordinate ? 'Z' : 'X'}`} value={wall[edge][coordinate]} onChange={number => { const point = [...wall[edge]] as [number, number]; point[coordinate] = number; editWall(wall.id, { [edge]: point }); }} />))}</div><NumberField label="墙厚" value={wall.thickness} min={.04} max={1} onChange={thickness => editWall(wall.id, { thickness })} />{wall.openings.map((opening, openingIndex) => <div key={openingIndex} className="generation-opening"><label>门窗类型<select value={opening.kind} onChange={event => editWall(wall.id, { openings: wall.openings.map((item, i) => i === openingIndex ? { ...item, kind: event.target.value as 'door' | 'window', bottom: event.target.value === 'door' ? 0 : item.bottom } : item) })}><option value="door">门</option><option value="window">窗</option></select></label><div className="generation-grid-2">{(['offset', 'width', 'bottom', 'height'] as const).map((field, i) => <NumberField key={field} label={['距墙起点', '宽度', '距地高度', '洞口高度'][i]} value={opening[field]} onChange={number => editWall(wall.id, { openings: wall.openings.map((item, index) => index === openingIndex ? { ...item, [field]: number } : item) })} />)}</div><Button size="small" onClick={() => editWall(wall.id, { openings: wall.openings.filter((_, i) => i !== openingIndex) })}>移除此门窗</Button></div>)}<Button disabled={wall.openings.length >= 10} onClick={() => editWall(wall.id, { openings: [...wall.openings, { kind: 'door', offset: 0, width: Math.min(.9, Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]) / 2), bottom: 0, height: Math.min(2.1, plan.height) }] })}>添加门窗</Button><Button status="danger" onClick={() => edit(value => ({ ...value, walls: value.walls.filter(item => item.id !== wall.id) }))}>移除此墙体</Button></div></details>)}</>}
        {editor === 'furniture' && <><div className="generation-grid-2"><label>地面颜色<input type="color" value={plan.finishes.floorColor} onChange={event => edit(value => ({ ...value, finishes: { ...value.finishes, floorColor: event.target.value } }))} /></label><label>墙面颜色<input type="color" value={plan.finishes.wallColor} onChange={event => edit(value => ({ ...value, finishes: { ...value.finishes, wallColor: event.target.value } }))} /></label></div><label>地面材质<select value={plan.finishes.floorMaterial} onChange={event => edit(value => ({ ...value, finishes: { ...value.finishes, floorMaterial: event.target.value as 'wood' | 'tile' } }))}><option value="wood">木地板</option><option value="tile">瓷砖</option></select></label><label>家具所在房间<select value={selectedRoomId} onChange={event => setSelectedRoomId(event.target.value)}><option value="">请选择</option>{plan.rooms.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><Button disabled={!room || plan.furniture.length >= 150} onClick={() => { if (!room) return; const bounds = room.bounds ?? [0, 0, plan.width, plan.depth]; edit(value => ({ ...value, furniture: [...value.furniture, { id: uid(), roomId: room.id, kind: 'cabinet', x: (bounds[0] + bounds[2]) / 2, z: (bounds[1] + bounds[3]) / 2, width: Math.max(.05, Math.min(1, (bounds[2] - bounds[0]) * .8)), depth: Math.max(.05, Math.min(.5, (bounds[3] - bounds[1]) * .8)), height: .8, rotation: 0, color: '#b89b78', material: 'wood', style: 'straight' }] })); }}>添加家具</Button>{plan.furniture.filter(item => item.roomId === selectedRoomId).map((item, index) => <details key={item.id}><summary>{furnitureNames[item.kind]} {index + 1}</summary><div className="generation-detail"><div className="generation-grid-2"><label>家具类型<select value={item.kind} onChange={event => editFurniture(item.id, { kind: event.target.value as PlanFurniture['kind'] })}>{Object.entries(furnitureNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>造型<select value={item.style} onChange={event => editFurniture(item.id, { style: event.target.value as PlanFurniture['style'] })}><option value="straight">直线</option><option value="rounded">圆角</option></select></label><label>材质<select value={item.material} onChange={event => editFurniture(item.id, { material: event.target.value as PlanFurniture['material'] })}>{Object.entries(materialNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>颜色<input type="color" value={item.color} onChange={event => editFurniture(item.id, { color: event.target.value })} /></label>{(['x', 'z', 'width', 'depth', 'height', 'rotation'] as const).map((field, index) => <NumberField key={field} label={['中心 X', '中心 Z', '宽度', '进深', '高度', '旋转（度）'][index]} min={field === 'rotation' ? -360 : 0} step={field === 'rotation' ? 1 : .01} value={item[field]} onChange={number => editFurniture(item.id, { [field]: number })} />)}</div><Button status="danger" onClick={() => edit(value => ({ ...value, furniture: value.furniture.filter(value => value.id !== item.id) }))}>移除此家具</Button></div></details>)}</>}
        <Button type="primary" disabled={!dirty || busy || running || job.status !== 'ready'} onClick={() => void run(savePlan)}>保存校正并更新预览</Button><p className="generation-hint">手动校正不会调用 AI 服务。</p>
      </fieldset></div></div>
      <details className="generation-revise"><summary>局部重新识别装修与家具</summary><fieldset disabled={busy || running || dirty || job.status !== 'ready'}><label>使用个人 AI 服务<select value={connectionId} onChange={event => setConnectionId(event.target.value)}><option value="">请选择</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name} · {connection.model}</option>)}</select></label><div className="generation-room-checks">{plan.rooms.map(value => <label className="generation-check" key={value.id}><input type="checkbox" checked={revisionRooms.includes(value.id)} onChange={event => setRevisionRooms(ids => event.target.checked ? [...ids, value.id] : ids.filter(id => id !== value.id))} />{value.name}</label>)}</div><label>修改要求<textarea rows={3} maxLength={1000} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：客厅使用浅色布艺沙发，保留其他房间" /></label><p className="generation-hint">仅调整所选房间家具与材质，保留户型。会向所选 AI 服务发送参考图和修改要求，并产生该服务的调用费用。</p><Button disabled={busy || running || dirty || !connectionId || !revisionRooms.length || !instruction.trim()} onClick={() => void run(revise)}>调用 AI 更新所选房间</Button></fieldset></details>
      <section className="generation-publish">{!canManage && <p className="generation-hint">草稿已保存在当前账号；保存到家庭模型库需要管理员权限。</p>}<fieldset disabled={!canManage || busy || running || dirty || job.status !== 'ready'}><div className="generation-room-checks"><label className="generation-check"><input type="radio" name="generation-publish" checked={publishMode === 'new'} onChange={() => setPublishMode('new')} />保存为新模型</label><label className="generation-check"><input type="radio" name="generation-publish" checked={publishMode === 'update'} onChange={() => { setPublishMode('update'); setModelName(selectedModel?.name ?? ''); }} />更新“{selectedModel?.name}”</label></div><label>模型名称<input value={modelName} maxLength={80} onChange={event => setModelName(event.target.value)} /></label><p className="generation-hint">{publishMode === 'update' ? '新增一个版本，保留此前版本与模型。' : '保留已有模型，保存后可切换展示。'}</p><Button type="primary" disabled={!canManage || busy || running || dirty || !previewReady || !modelName.trim()} onClick={() => void run(publish)}>保存到模型库</Button></fieldset></section>
    </>}
  </div>;
}
