import catalog from './panoramas.json';
import { canonicalRoom } from '../constants';

export const panoramaCatalog = catalog;
export const panoramaScenes = catalog.scenes;
export type PanoramaScene = typeof panoramaScenes[number];
export const panoramaRooms = panoramaScenes.filter((scene, index, scenes) =>
  scenes.findIndex(item => item.roomId === scene.roomId) === index);

export function panoramaForRoom(room: string, preferredId: string) {
  const exact = panoramaScenes.filter(scene => scene.room === room);
  const matching = exact.length ? exact : panoramaScenes.filter(scene => scene.controlRoom === canonicalRoom(room));
  return matching.find(scene => scene.id === preferredId) ?? matching[0];
}

export function panoramaThumbnail(scene: PanoramaScene) {
  return `${import.meta.env?.BASE_URL ?? '/'}panoramas/buyin-xianfu/${scene.id}/thumb.jpg`;
}

export function panoramaFaces(scene: PanoramaScene) {
  // Three.js cube order is +X, -X, +Y, -Y, +Z, -Z; the camera starts toward +Z.
  return ['r', 'l', 'u', 'd', 'f', 'b'].map(face =>
    `${import.meta.env?.BASE_URL ?? '/'}panoramas/buyin-xianfu/${scene.id}/${face}.jpg`);
}
