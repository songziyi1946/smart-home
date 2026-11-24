import catalog from './panoramas.json';
import { canonicalRoom } from '../constants';
import type { ModelVersion } from '../../../packages/contracts/space-models';

export const panoramaCatalog = catalog;
export const panoramaScenes = catalog.scenes;
export type PanoramaScene = { id: string; roomId: string; room: string; controlRoom: string; label: string; sourceBase?: string; faceUrls?: string[]; imageUrl?: string };
export function panoramaForModelRoom(version: ModelVersion, roomId?: string): PanoramaScene | undefined {
  const room = version.rooms.find(value => value.id === roomId);
  if (!room?.panoramaSceneId) return;
  if (!version.sourceId) return panoramaScenes.find(scene => scene.id === room.panoramaSceneId);
  const scene = version.panoramas?.find(value => value.id === room.panoramaSceneId);
  if (!scene) return;
  const assetUrl = (id: string) => `/api/model-generation/assets/${encodeURIComponent(id)}`;
  return {id:scene.id,roomId:room.id,room:room.name,controlRoom:room.name,label:room.name,imageUrl:assetUrl(scene.imageAssetId),faceUrls:scene.faceAssetIds?.map(assetUrl)};
}
export const panoramaRooms = panoramaScenes.filter((scene, index, scenes) =>
  scenes.findIndex(item => item.roomId === scene.roomId) === index);

export function panoramaForRoom(room: string, preferredId: string) {
  const exact = panoramaScenes.filter(scene => scene.room === room);
  const matching = exact.length ? exact : panoramaScenes.filter(scene => scene.controlRoom === canonicalRoom(room));
  return matching.find(scene => scene.id === preferredId) ?? matching[0];
}

export function panoramaThumbnail(scene: PanoramaScene) {
  return scene.imageUrl ?? `${import.meta.env?.BASE_URL ?? '/'}panoramas/buyin-xianfu/${scene.id}/thumb.jpg`;
}

export function panoramaFaces(scene: PanoramaScene) {
  if (scene.faceUrls) return scene.faceUrls;
  // Three.js cube order is +X, -X, +Y, -Y, +Z, -Z; the camera starts toward +Z.
  return ['r', 'l', 'u', 'd', 'f', 'b'].map(face =>
    `${import.meta.env?.BASE_URL ?? '/'}panoramas/buyin-xianfu/${scene.id}/${face}.jpg`);
}
