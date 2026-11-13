import millwork from './millwork.json' with { type: 'json' };
import furnishings from './furnishings.json' with { type: 'json' };

// Metres. Origin = upper-left corner of the approval drawing's furnished plan.
// Plan dimensions: 12.910 m overall width; left depth 7.530 m; right depth 6.140 m.
// Ceiling height is provisional until the ceiling drawing is supplied.
export const CEILING_HEIGHT = 2.7;
export type Viewpoint = { id: string; name: string; position: [number, number, number]; target: [number, number, number] };
export const viewpoints: Viewpoint[] = [
  { id: 'entry', name: '入户', position: [8.65, 1.62, 5.65], target: [6.6, 1.3, 2.5] },
  { id: 'living', name: '客厅', position: [4.8, 1.62, 5.65], target: [2.65, 1.0, 6.25] },
  { id: 'kitchen', name: '餐厨', position: [7.55, 1.62, 4.42], target: [7.7, 1.2, 1.4] },
  { id: 'study', name: '书房', position: [11.3, 1.62, 2.65], target: [11.5, 1.2, 3.85] },
  { id: 'bedroom', name: '主卧', position: [3.55, 1.62, 2.8], target: [2.0, 1.0, .85] },
  { id: 'ensuite', name: '主卫', position: [4.48, 1.62, 1.65], target: [5.25, .95, .90] },
  { id: 'bath', name: '次卫', position: [10.3, 1.62, 5.25], target: [11.9, 1.0, 5.1] },
];
export type Obstacle = { minX: number; maxX: number; minZ: number; maxZ: number };
export const millworkFootprints: Obstacle[] = [...millwork.cabinets.map(({ bounds }) => bounds), millwork.island]
  .map(([minX, minZ, maxX, maxZ]) => ({ minX, minZ, maxX, maxZ }));
export const [bedroomDoorLeft, bedroomDoorRight, bedroomDoorFront] = millwork.bedroomDoor;
function furnitureBounds(x: number, z: number, width: number, depth: number): Obstacle {
  return { minX: x - width / 2, minZ: z - depth / 2, maxX: x + width / 2, maxZ: z + depth / 2 };
}
export const furnishingFootprints: Obstacle[] = [
  ...[furnishings.sofa, furnishings.coffeeTable, furnishings.television]
    .map(({ x, z, width, depth }) => furnitureBounds(x, z, width, depth)),
  ...furnishings.bathrooms.flatMap(({ vanity, toilet, screen, sideScreen }) => [
    furnitureBounds(vanity.x, vanity.z,
      vanity.rotation === 0 ? vanity.width : vanity.depth,
      vanity.rotation === 0 ? vanity.depth : vanity.width),
    furnitureBounds(toilet.x, toilet.z, .42, .72),
    { minX: screen[0], minZ: screen[1], maxX: screen[2], maxZ: screen[3] },
    ...(sideScreen ? [{ minX: sideScreen[0], minZ: sideScreen[1], maxX: sideScreen[2], maxZ: sideScreen[3] }] : []),
  ]),
];
export function insideHome(x: number, z: number, radius = .18) {
  return x >= radius && x <= 12.91 - radius && z >= radius &&
    z <= (x < 5.7 ? 7.53 : 6.14) - radius && (x <= 5.94 || z >= .89 + radius);
}
export function canWalk(x: number, z: number, obstacles: Obstacle[], radius = .18) {
  return insideHome(x, z, radius) && !obstacles.some(box =>
    x > box.minX - radius && x < box.maxX + radius && z > box.minZ - radius && z < box.maxZ + radius);
}
