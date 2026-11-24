import { ApiError, request } from '../api';
import type { ModelLibrary, ModelRoom, ModelVersion, SaveModelInput, SpaceModel } from '../../../packages/contracts/space-models';

export type { ModelLibrary, ModelRoom, ModelVersion, SaveModelInput, SpaceModel };
export const MAX_MODEL_BYTES = 30 * 1024 * 1024;
export const currentModelVersion = (model: SpaceModel) => model.versions.find(version => version.id === model.currentVersionId);
export const loadModelLibrary = () => request<ModelLibrary>('/models');
export const saveSpaceModel = (input: SaveModelInput, modelId?: string) => request<ModelLibrary>(modelId ? `/models/${encodeURIComponent(modelId)}/versions` : '/models', 'POST', input);
export const restoreModelVersion = (modelId: string, versionId: string, revision: number) => request<ModelLibrary>(`/models/${encodeURIComponent(modelId)}/restore`, 'POST', { versionId, revision });
export const setDefaultModel = (modelId: string, revision: number) => request<ModelLibrary>('/models/default', 'PUT', { modelId, revision });

export async function loadModelAsset(assetId: string, signal?: AbortSignal): Promise<File> {
  const response = await fetch(`/api/models/assets/${encodeURIComponent(assetId)}`, { credentials: 'same-origin', signal });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.message || '模型加载失败，请重试', response.status);
  }
  const blob = await response.blob();
  if (blob.size > MAX_MODEL_BYTES) throw new Error('模型超过 30 MB');
  return new File([blob], assetId + '.glb', { type: 'model/gltf-binary' });
}

/** Reject remote dependencies before GLTFLoader can fetch any asset. Server revalidates on save. */
export function validateModelGlb(buffer: ArrayBuffer) {
  if (buffer.byteLength > MAX_MODEL_BYTES) throw new Error('模型超过 30 MB，请先简化模型');
  if (buffer.byteLength < 20) throw new Error('请选择完整的 GLB 模型文件');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('GLB 文件格式或长度不正确');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length % 4 !== 0 || length > buffer.byteLength - 20) throw new Error('GLB 内容不完整');
  let content;
  try { content = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)).trim()); }
  catch { throw new Error('GLB 场景信息损坏'); }
  if (!content || content.asset?.version !== '2.0') throw new Error('仅支持 glTF 2.0 模型');
  const resources = [...(content.buffers ?? []), ...(content.images ?? [])];
  if (resources.some(value => value.uri !== undefined && (typeof value.uri !== 'string' || !/^data:[^,]*;base64,/i.test(value.uri)))) throw new Error('请导出资源内嵌的 GLB，不能包含外部图片或缓冲区');
  if ((content.extensionsRequired ?? []).some((name: string) => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name))) throw new Error('请导出未使用 Draco、Meshopt 或 KTX2 压缩的 GLB');
  return content;
}

export function modelBytesBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

export function validateModelDraft(name: string, version: SaveModelInput['version']) {
  if (!name.trim() || name.trim().length > 80) return '请输入 1–80 个字的模型名称';
  if (![version.width, version.depth, version.height].every(value => Number.isFinite(value) && value > 0) || version.width > 200 || version.depth > 200 || version.height > 20) return '模型尺寸须大于 0；宽度、进深最多 200 米，高度最多 20 米';
  if (version.rooms.length > 100) return '每个模型最多支持 100 个房间';
  const ids = new Set<string>();
  for (const room of version.rooms) {
    if (!room.id || ids.has(room.id)) return '房间标识重复，请删除重复房间后重试';
    ids.add(room.id);
    if (!room.name.trim() || room.name.trim().length > 80) return '请填写每个房间的名称（最多 80 字）';
    if (new Set(room.deviceRoomIds).size !== room.deviceRoomIds.length) return '房间关联重复';
    if (room.bounds) {
      const [x0, z0, x1, z1] = room.bounds;
      if (!room.bounds.every(Number.isFinite) || x0 < 0 || z0 < 0 || x1 <= x0 || z1 <= z0 || x1 > version.width || z1 > version.depth) return `请检查“${room.name}”的位置范围，范围应在模型尺寸内`;
    }
  }
  return undefined;
}

export function draftFromVersion(version?: ModelVersion): SaveModelInput['version'] {
  if (!version) return { source: 'upload', width: 10, depth: 10, height: 2.8, rooms: [] };
  const { id: _id, createdAt: _createdAt, ...draft } = version;
  return structuredClone(draft);
}
