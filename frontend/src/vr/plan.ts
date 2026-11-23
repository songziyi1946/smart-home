import design from './design-model.json' with { type: 'json' };
import { canonicalRoom } from '../constants';

// Outer dimensions follow P-07; unlabelled recess depths and the panorama interior remain estimated.
export const designModel = design;
export const HOME_WIDTH = design.width;
export const HOME_DEPTH = design.depth;
export const CEILING_HEIGHT = design.height;
export const footprint = design.footprint;
export const FOOTPRINT_AREA = Math.abs(footprint.reduce((sum, [x, z], index) => {
  const [nextX, nextZ] = footprint[(index + 1) % footprint.length];
  return sum + x * nextZ - nextX * z;
}, 0)) / 2;
export type Viewpoint = { id: string; name: string; controlRoom: string; position: [number, number, number]; target: [number, number, number] };
export const viewpoints: Viewpoint[] = design.rooms.map(room => ({
  id: room.id, name: room.name, controlRoom: room.controlRoom,
  position: room.position as [number, number, number], target: room.target as [number, number, number],
}));
export function viewpointForRoom(room: string) {
  return viewpoints.find(point => point.name === room) ??
    viewpoints.find(point => point.controlRoom === canonicalRoom(room));
}
export type Obstacle = { minX: number; maxX: number; minZ: number; maxZ: number };
export const wallFootprints = design.walls;
export const furnishingFootprints = design.furniture;
export const obstacles: Obstacle[] = [...wallFootprints, ...furnishingFootprints];
export function insideHome(x: number, z: number, radius = .18) {
  const tolerance = radius === 0 ? 1e-5 : 0;
  if (x < radius - tolerance || x > HOME_WIDTH - radius + tolerance || z < radius - tolerance || z > HOME_DEPTH - radius + tolerance) return false;
  let inside = false;
  for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
    const [ax, az] = footprint[j], [bx, bz] = footprint[i];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    // Keep the camera radius inside concave corners as well as the bounding rectangle.
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const distanceSquared = (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
    if (radius === 0 && distanceSquared < 1e-8) return true;
    if (distanceSquared < radius * radius - 1e-10) return false;
  }
  return inside;
}
export function canWalk(x: number, z: number, objects: Obstacle[] = obstacles, radius = .18) {
  return insideHome(x, z, radius) && !objects.some(box =>
    x > box.minX - radius && x < box.maxX + radius && z > box.minZ - radius && z < box.maxZ + radius);
}
