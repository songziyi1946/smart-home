import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { planSchema, validatePlan } from '../model-generation/schema.mjs';
import builtinLibrary from '../../../packages/contracts/builtin-space-model.json' with { type: 'json' };
import panoramaSceneIds from './panorama-scene-ids.json' with { type: 'json' };

export const MAX_MODEL_BYTES = 30 * 1024 * 1024;
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const id = z.string().min(1).max(160);
const name = z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/);
const revision = z.number().int().nonnegative();
const dimension = z.number().finite().positive().max(200);
const roomSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name,
  bounds: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  deviceRoomIds: z.array(id).max(100), panoramaSceneId: id.optional(),
}).strict();
const versionSchema = z.object({
  source: z.enum(['builtin', 'upload', 'generated']), assetId: z.string().uuid().optional(),
  width: dimension, depth: dimension, height: z.number().finite().positive().max(20),
  rooms: z.array(roomSchema).max(100),
  sourceId: z.string().uuid().optional(), plan: planSchema.optional(),
  panoramas: z.array(z.object({id, name, imageAssetId:z.string().uuid(),faceAssetIds:z.array(z.string().uuid()).length(6).optional()}).strict()).max(12).optional(),
}).strict();
const saveSchema = z.object({ revision, name, version: versionSchema, assetBase64: z.string().max(Math.ceil(MAX_MODEL_BYTES / 3) * 4).optional() }).strict();
const defaultSchema = z.object({ revision, modelId: id }).strict();
const restoreSchema = z.object({ revision, versionId: id }).strict();
const builtin = builtinLibrary.models[0].versions[0];
const legacyBindings = new Set(builtin.rooms.flatMap(room => room.deviceRoomIds));

/** Accept only bounded, self-contained GLB v2; no server or browser external fetches. */
export function validateModelBytes(bytes) {
  try { return inspectModelBytes(bytes); }
  catch (error) { if (error.status === 400) throw error; fail(400, 'GLB 场景结构无效'); }
}
function inspectModelBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_MODEL_BYTES) fail(400, '请选择不超过 30 MB 的 GLB 模型');
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) fail(400, 'GLB 文件头或长度无效');
  let offset = 12, json, binaryLength = 0, chunks = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail(400, 'GLB 数据不完整');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4); offset += 8;
    if (length % 4 || offset + length > bytes.length || chunks > 1) fail(400, 'GLB 数据块无效');
    if (chunks === 0 && type === 0x4e4f534a) {
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length))); }
      catch { fail(400, 'GLB 场景数据无效'); }
    } else if (chunks === 1 && type === 0x004e4942) binaryLength = length;
    else fail(400, 'GLB 数据块不受支持');
    chunks++; offset += length;
  }
  if (!json || json.asset?.version !== '2.0' || !Array.isArray(json.meshes) || !json.meshes.some(mesh => mesh.primitives?.some(primitive => Number.isInteger(primitive.attributes?.POSITION)))) fail(400, '模型没有可显示的三维几何');
  const stack = [json]; let count = 0;
  while (stack.length) {
    const value = stack.pop();
    if (++count > 500000) fail(400, '模型场景过于复杂');
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri' && (typeof child !== 'string' || !/^data:[^,]*;base64,/i.test(child))) fail(400, '模型含外部资源，请使用贴图内嵌的 GLB');
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  if ((json.extensionsRequired ?? []).some(value => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(value))) fail(400, '请导出未压缩、贴图内嵌的 GLB');
  if (!Array.isArray(json.buffers) || !json.buffers.length || json.buffers.some((buffer, index) => !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength <= 0 || (!buffer.uri && (index !== 0 || buffer.byteLength > binaryLength)))) fail(400, '模型缓冲区无效');
  if (!Array.isArray(json.bufferViews) || json.bufferViews.some(view => {
    const buffer = json.buffers[view.buffer], start = view.byteOffset ?? 0;
    return !buffer || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(view.byteLength) || view.byteLength <= 0 || start + view.byteLength > buffer.byteLength;
  })) fail(400, '模型几何缓冲区越界');
  if (!Array.isArray(json.accessors) || json.meshes.some(mesh => !Array.isArray(mesh.primitives) || mesh.primitives.some(primitive => {
    const position = json.accessors[primitive.attributes?.POSITION];
    return !position || position.type !== 'VEC3' || !Number.isSafeInteger(position.count) || position.count <= 0 || (!json.bufferViews[position.bufferView] && !position.sparse);
  }))) fail(400, '模型顶点数据无效');
  if (!Array.isArray(json.nodes) || !Array.isArray(json.scenes) || !json.scenes[json.scene ?? 0]?.nodes?.length || json.scenes.some(scene => !Array.isArray(scene.nodes) || scene.nodes.some(index => !Number.isInteger(index) || !json.nodes[index]))) fail(400, '模型场景节点无效');
  return bytes;
}

export class ModelLibraryService {
  constructor(store, { devices = () => [] } = {}) { this.store = store; this.devices = devices; }
  list() { return this.store.loadModelLibrary() ?? structuredClone(builtinLibrary); }
  asset(id) {
    if (!z.string().uuid().safeParse(id).success) fail(404, '模型资源不存在');
    const bytes = this.store.loadModelAsset(id); if (!bytes) fail(404, '模型资源不存在'); return bytes;
  }
  save(body, modelId, generatedPublication = false) {
    const input = saveSchema.parse(body), library = this.list();
    if (library.revision !== input.revision) fail(409, '模型已被修改，请刷新后重试');
    const current = modelId ? library.models.find(model => model.id === modelId) : undefined;
    if (modelId && !current) fail(404, '模型不存在');
    if (!current && library.models.length >= 20) fail(400, '最多保存 20 个模型');
    if (current && current.versions.length >= 20) fail(400, '此模型已达到 20 个版本上限');
    const version = input.version;
    const original = current?.versions.find(value => value.assetId && value.assetId === version.assetId);
    if (!generatedPublication && (version.source === 'generated' || version.plan || version.sourceId || version.panoramas)) {
      if (!original || original.source !== 'generated' || input.assetBase64 !== undefined || version.source !== 'generated'
        || !isDeepStrictEqual(version.plan, original.plan) || version.sourceId !== original.sourceId || !isDeepStrictEqual(version.panoramas, original.panoramas)
        || version.width !== original.width || version.depth !== original.depth || version.height !== original.height
        || version.rooms.length !== original.rooms.length || version.rooms.some(room => !isDeepStrictEqual(room.bounds, original.rooms.find(value => value.id === room.id)?.bounds))) {
        fail(400, '生成模型请通过方案编辑器校正和发布');
      }
      version.plan = { ...version.plan, rooms: structuredClone(version.rooms) };
    }
    const allowedScenes = new Set(version.source === 'generated' ? (version.panoramas ?? []).map(scene => scene.id) : panoramaSceneIds);
    const knownRoomIds = new Set([...legacyBindings, ...this.devices().map(device => device.roomId)]);
    // Preserve previously valid bindings if a provider has since disconnected.
    for (const room of current?.versions.flatMap(value => value.rooms) ?? []) for (const value of room.deviceRoomIds) knownRoomIds.add(value);
    if (new Set(version.rooms.map(room => room.id)).size !== version.rooms.length) fail(400, '模型房间标识重复');
    for (const room of version.rooms) {
      if (new Set(room.deviceRoomIds).size !== room.deviceRoomIds.length || room.deviceRoomIds.some(value => !knownRoomIds.has(value))) fail(400, '请选择已有家庭房间进行绑定');
      if (room.panoramaSceneId && !allowedScenes.has(room.panoramaSceneId)) fail(400, '全景房间不存在');
      if (room.bounds) {
        const [x0,z0,x1,z1] = room.bounds;
        if (x0 < 0 || z0 < 0 || x1 <= x0 || z1 <= z0 || x1 > version.width || z1 > version.depth) fail(400, '房间范围必须位于模型尺寸内');
      }
    }
    const model = current ?? { id: randomUUID(), name: input.name, currentVersionId: '', versions: [] };
    let asset;
    if (version.source === 'builtin') {
      if (input.assetBase64 !== undefined || version.assetId) fail(400, '内置模型不能替换资源');
      if (version.width !== builtin.width || version.depth !== builtin.depth || version.height !== builtin.height || version.rooms.length !== builtin.rooms.length || version.rooms.some(room => {
        const original = builtin.rooms.find(value => value.id === room.id);
        return !original || !isDeepStrictEqual(room.bounds, original.bounds);
      })) fail(400, '内置模型只支持修改房间名称和数据关联');
    } else if (input.assetBase64 !== undefined) {
      const decoded = Buffer.from(input.assetBase64, 'base64');
      if (version.assetId || decoded.toString('base64') !== input.assetBase64) fail(400, '模型文件编码无效');
      const bytes = validateModelBytes(decoded);
      asset = { id: randomUUID(), modelId: model.id, bytes }; version.assetId = asset.id;
    } else {
      const info = version.assetId && this.store.modelAssetInfo(version.assetId);
      if (!info || info.modelId !== model.id) fail(400, '请上传此模型的 GLB 文件');
    }
    const saved = { ...version, id: randomUUID(), createdAt: new Date().toISOString() };
    model.name = input.name; model.versions.push(saved); model.currentVersionId = saved.id;
    if (!current) library.models.push(model);
    library.revision++;
    this.store.saveModelLibrary(library, input.revision, asset);
    return library;
  }
  publishGenerated(job, input, bytes, source) {
    const plan = validatePlan(job.plan, { sceneIds:source?.scenes.map(scene => scene.id) ?? [], deviceRoomIds:this.devices().map(device => device.roomId) });
    const previousIds = new Set(this.list().models.map(model => model.id));
    const library = this.save({ revision:input.catalogRevision, name:input.name, assetBase64:validateModelBytes(bytes).toString('base64'),
      version:{source:'generated',width:plan.width,depth:plan.depth,height:plan.height,rooms:plan.rooms,plan,
        ...(source ? {sourceId:source.id,panoramas:source.scenes} : {})} }, input.modelId, true);
    return {library,modelId:input.modelId ?? library.models.find(model => !previousIds.has(model.id)).id};
  }
  restore(modelId, body) {
    const input = restoreSchema.parse(body), library = this.list();
    if (library.revision !== input.revision) fail(409, '模型已被修改，请刷新后重试');
    const model = library.models.find(value => value.id === modelId);
    if (!model || !model.versions.some(value => value.id === input.versionId)) fail(404, '模型版本不存在');
    model.currentVersionId = input.versionId; library.revision++;
    this.store.saveModelLibrary(library, input.revision); return library;
  }
  setDefault(body) {
    const input = defaultSchema.parse(body), library = this.list();
    if (library.revision !== input.revision) fail(409, '模型已被修改，请刷新后重试');
    if (!library.models.some(value => value.id === input.modelId)) fail(404, '模型不存在');
    library.defaultModelId = input.modelId; library.revision++;
    this.store.saveModelLibrary(library, input.revision); return library;
  }
}
