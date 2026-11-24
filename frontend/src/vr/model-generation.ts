import { ApiError, request } from '../api';
import { modelBytesBase64 } from './model-library';
import type { GeneratedPlan, GenerationJob, GenerationSource } from '../../../packages/contracts/model-generation';
import type { ModelLibrary } from '../../../packages/contracts/space-models';
export type { GeneratedPlan, GenerationJob, GenerationSource };
export type PreparedImage = { name: string; mime: 'image/jpeg'; dataBase64: string };
export const generationEndpoint = '/model-generation';
export const generationJobCanReplace = (current: GenerationJob | undefined, next: GenerationJob) => !current || current.id !== next.id || next.revision >= current.revision;
export const canRestoreGenerationPlan = (job?: GenerationJob) => !!job?.plan && ['failed', 'cancelled', 'interrupted'].includes(job.status);
export const jobRunning = (job?: GenerationJob) => job?.status === 'queued' || job?.status === 'reading';
export const jobStatus: Record<GenerationJob['status'], string> = { queued: '等待处理', reading: '正在生成', ready: '可预览与校正', failed: '生成失败', cancelled: '已取消', interrupted: '任务已中断' };
export const listGenerationJobs = () => request<{ jobs: GenerationJob[] }>(generationEndpoint + '/jobs');
export const loadGenerationJob = (id: string) => request<GenerationJob>(`${generationEndpoint}/jobs/${encodeURIComponent(id)}`);
export const listGenerationSources = () => request<{ sources: GenerationSource[] }>(generationEndpoint + '/sources');
export const createGenerationSource = (input: { url?: string; images?: PreparedImage[] }) => request<GenerationSource>(generationEndpoint + '/sources', 'POST', input);
export const createGenerationJob = (input: { connectionId: string; sourceId?: string; floorplan: PreparedImage; knownWidth?: number; knownDepth?: number; height?: number }) => request<GenerationJob>(generationEndpoint + '/jobs', 'POST', input);
export const cancelGenerationJob = (id: string) => request<GenerationJob>(`${generationEndpoint}/jobs/${encodeURIComponent(id)}/cancel`, 'POST', {});
export const saveGenerationPlan = (job: GenerationJob, plan: GeneratedPlan) => request<GenerationJob>(`${generationEndpoint}/jobs/${encodeURIComponent(job.id)}/plan`, 'PUT', { revision: job.revision, plan });
export const reviseGenerationRooms = (job: GenerationJob, connectionId: string, roomIds: string[], instruction: string) => request<GenerationJob>(`${generationEndpoint}/jobs/${encodeURIComponent(job.id)}/revise`, 'POST', { revision: job.revision, connectionId, roomIds, instruction });
export const publishGenerationJob = (job: GenerationJob, catalogRevision: number, name: string, modelId?: string) => request<{ library: ModelLibrary; modelId: string }>(`${generationEndpoint}/jobs/${encodeURIComponent(job.id)}/publish`, 'POST', { revision: job.revision, catalogRevision, name, ...(modelId ? { modelId } : {}) });
export const generationAssetUrl = (id: string) => `/api${generationEndpoint}/assets/${encodeURIComponent(id)}`;
export async function generationPreview(job: GenerationJob, signal?: AbortSignal) {
  const result = await fetch(`/api${generationEndpoint}/jobs/${encodeURIComponent(job.id)}/preview.glb?revision=${job.revision}`, { credentials: 'same-origin', signal });
  if (!result.ok) { const value = await result.json().catch(() => ({})); throw new ApiError(value.message || '三维预览加载失败', result.status); }
  return result.arrayBuffer();
}

export function generationError(reason: unknown) {
  if (reason instanceof ApiError && reason.status === 404) return '生成服务或所选任务不可用，请刷新任务列表后重试。';
  if (reason instanceof ApiError && reason.status === 409) return '任务或模型版本已更新。当前编辑已保留，请重新载入后核对。';
  if (reason instanceof ApiError && reason.status === 401) return '登录已失效，请重新登录。';
  return reason instanceof Error ? reason.message : '操作失败，请重试';
}

export function imageTargetSize(width: number, height: number, longSide: number) {
  if (![width, height, longSide].every(value => Number.isFinite(value) && value > 0) || width * height > 50_000_000) throw new Error('图片尺寸过大或无效，请缩小后上传');
  const ratio = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** Upload preprocessing stays in the browser; originals are never sent to the AI service. */
export async function prepareGenerationImage(file: File, kind: 'floorplan' | 'reference'): Promise<PreparedImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (!file.size || file.size > 30 * 1024 * 1024) throw new Error('单张原图须小于 30 MB');
  const bitmap = await createImageBitmap(file);
  try {
    let size = imageTargetSize(bitmap.width, bitmap.height, kind === 'floorplan' ? 2048 : 1024);
    const maximum = kind === 'floorplan' ? 1024 * 1024 : 256 * 1024;
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法处理图片，请更换浏览器');
      context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height); context.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片压缩失败')), 'image/jpeg', .86 - Math.min(attempt, 3) * .1));
      if (blob.size <= maximum) return { name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || '房间参考', mime: 'image/jpeg', dataBase64: modelBytesBase64(await blob.arrayBuffer()) };
      size = { width: Math.max(1, Math.round(size.width * .8)), height: Math.max(1, Math.round(size.height * .8)) };
    }
    throw new Error('图片仍然过大，请裁去图纸空白后重试');
  } finally { bitmap.close(); }
}

export function scaleGeneratedPlan(plan: GeneratedPlan, width: number): GeneratedPlan {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(plan.width) || plan.width <= 0) throw new Error('请输入有效宽度');
  const ratio = width / plan.width;
  const point = ([x, z]: [number, number]): [number, number] => [x * ratio, z * ratio];
  return { ...plan, width, depth: plan.depth * ratio, height: plan.height * ratio,
    footprint: plan.footprint.map(point),
    rooms: plan.rooms.map(room => ({ ...room, deviceRoomIds: [...room.deviceRoomIds], bounds: room.bounds?.map(value => value * ratio) as typeof room.bounds })),
    walls: plan.walls.map(wall => ({ ...wall, from: point(wall.from), to: point(wall.to), thickness: wall.thickness * ratio, openings: wall.openings.map(opening => ({ ...opening, offset: opening.offset * ratio, width: opening.width * ratio, bottom: opening.bottom * ratio, height: opening.height * ratio })) })),
    furniture: plan.furniture.map(item => ({ ...item, x: item.x * ratio, z: item.z * ratio, width: item.width * ratio, depth: item.depth * ratio, height: item.height * ratio })),
    finishes: { ...plan.finishes }, notes: [...plan.notes],
  };
}
export function removeGeneratedRoom(plan: GeneratedPlan, roomId: string): GeneratedPlan {
  return { ...plan, rooms: plan.rooms.filter(room => room.id !== roomId), furniture: plan.furniture.filter(item => item.roomId !== roomId) };
}
