import type { GeneratedPlan, GenerationScene } from './model-generation';
/** Saved presentation versions bind to existing household room IDs, never own device state. */
export type ModelRoom = {
  id: string;
  name: string;
  bounds?: [number, number, number, number];
  deviceRoomIds: string[];
  panoramaSceneId?: string;
};
export type ModelVersion = {
  id: string;
  createdAt: string;
  source: 'builtin' | 'upload' | 'generated';
  assetId?: string;
  width: number;
  depth: number;
  height: number;
  rooms: ModelRoom[];
  sourceId?: string;
  plan?: GeneratedPlan;
  panoramas?: GenerationScene[];
};
export type SpaceModel = {
  id: string;
  name: string;
  currentVersionId: string;
  versions: ModelVersion[];
};
export type ModelLibrary = { revision: number; defaultModelId: string; models: SpaceModel[] };
export type SaveModelInput = {
  revision: number;
  name: string;
  version: Omit<ModelVersion, 'id' | 'createdAt'>;
  assetBase64?: string;
};
