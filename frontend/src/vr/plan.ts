// Metres. Origin = upper-left corner of the supplied furniture plan.
// Plan dimensions: 12.910 m overall width; left depth 7.530 m; right depth 6.140 m.
// Ceiling height is provisional until the ceiling drawing is supplied.
export const CEILING_HEIGHT = 2.7;
export type Viewpoint = { id: string; name: string; position: [number, number, number]; target: [number, number, number] };
export const viewpoints: Viewpoint[] = [
  { id: 'entry', name: '入户', position: [8.65, 1.62, 5.65], target: [6.6, 1.3, 2.5] },
  { id: 'living', name: '客厅', position: [5.1, 1.62, 6.1], target: [2.2, 1.1, 5.5] },
  { id: 'kitchen', name: '餐厨', position: [8.8, 1.62, 4.0], target: [7.7, 1.2, 1.4] },
  { id: 'study', name: '书房', position: [11.3, 1.62, 3.6], target: [11.5, 1.2, 1.4] },
  { id: 'bedroom', name: '主卧', position: [3.55, 1.62, 2.8], target: [2.0, 1.0, .85] },
  { id: 'bath', name: '客卫', position: [10.7, 1.62, 4.6], target: [12.0, 1.1, 5.2] },
];
export type Obstacle = { minX: number; maxX: number; minZ: number; maxZ: number };
export function insideHome(x: number, z: number, radius = .18) {
  return x >= radius && x <= 12.91 - radius && z >= radius &&
    z <= (x < 5.7 ? 7.53 : 6.14) - radius && (x <= 5.94 || z >= .89 + radius);
}
export function canWalk(x: number, z: number, obstacles: Obstacle[], radius = .18) {
  return insideHome(x, z, radius) && !obstacles.some(box =>
    x > box.minX - radius && x < box.maxX + radius && z > box.minZ - radius && z < box.maxZ + radius);
}
