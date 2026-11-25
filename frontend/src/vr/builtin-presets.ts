import legacyDesign from './design-model.json' with { type: 'json' };
import currentDesign from './kujiale-design-model.json' with { type: 'json' };
import legacyLibrary from '../../../packages/contracts/builtin-space-model.json' with { type: 'json' };
import currentVersion from '../../../packages/contracts/kujiale-space-model.json' with { type: 'json' };
import type { ModelLibrary, ModelVersion } from '../../../packages/contracts/space-models';

export const KUJIALE_GEOMETRY_ID = 'kujiale-3fo3an8k4gd1';
export type BuiltinDesign = {
  width: number; depth: number; height: number; footprint: number[][];
  rooms: { id: string; name: string; controlRoom: string; bounds: number[] }[];
  walls: { id: string; minX: number; maxX: number; minZ: number; maxZ: number }[];
  furniture: { id: string; minX: number; maxX: number; minZ: number; maxZ: number; outline?: number[][] }[];
};

/** A missing geometry ID always means the original P-07 version. */
export function builtinDesignForVersion(version?: Pick<ModelVersion, 'source' | 'builtinGeometryId'>): BuiltinDesign {
  if (version?.source !== 'builtin' || version.builtinGeometryId === undefined) return legacyDesign;
  if (version.builtinGeometryId === KUJIALE_GEOMETRY_ID) return currentDesign;
  throw new Error('不支持此内置模型版本');
}

export const currentBuiltinVersion = currentVersion as ModelVersion;
export function initialBuiltinLibrary(): ModelLibrary {
  const library = structuredClone(legacyLibrary) as ModelLibrary;
  const model = library.models.find(value => value.id === 'builtin')!;
  model.versions.push(structuredClone(currentBuiltinVersion));
  model.currentVersionId = currentBuiltinVersion.id;
  return library;
}
