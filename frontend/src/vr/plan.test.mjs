import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedroomDoorFront, bedroomDoorLeft, bedroomDoorRight, canWalk, furnishingFootprints, insideHome, millworkFootprints, viewpoints } from './plan.ts';

test('L-shaped footprint excludes the two exterior recesses', () => {
  assert.equal(insideHome(2, 7), true);
  assert.equal(insideHome(8, 5.7), true);
  assert.equal(insideHome(8, 7), false);
  assert.equal(insideHome(10, .4), false);
  assert.equal(insideHome(-.1, 2), false);
});

test('furniture allows access to both bathrooms and the living-room circulation', () => {
  const obstacles = [...millworkFootprints, ...furnishingFootprints];
  for (const { id, position: [x, , z] } of viewpoints) assert.ok(canWalk(x, z, obstacles), id);
  for (let x = 3.6; x < 8; x += .1) assert.ok(canWalk(x, 4.92, obstacles));
  for (let z = 2.7; z > 1.4; z -= .1) assert.ok(canWalk(4.48, z, obstacles));
  for (let x = 9.7; x < 11.65; x += .1) assert.ok(canWalk(x, 4.96, obstacles));
  assert.equal(canWalk(2.65, 6.3, obstacles), false);
  assert.equal(canWalk(5.45, 1.6, obstacles), false);
  assert.equal(canWalk(11.08, 5.52, obstacles), false);
});

test('room viewpoints stay inside the plan and at adult eye height', () => {
  for (const view of viewpoints) {
    assert.ok(insideHome(view.position[0], view.position[2]), view.id);
    assert.equal(view.position[1], 1.62);
  }
});

test('camera radius blocks clipping through walls and furniture edges', () => {
  const walls = [{ minX: 4, maxX: 4.12, minZ: 1, maxZ: 3 }];
  assert.equal(canWalk(4.05, 2, walls), false);
  assert.equal(canWalk(3.9, 2, walls), false);
  assert.equal(canWalk(3.7, 2, walls), true);
  assert.equal(canWalk(4.05, 3.4, walls), true);
});

test('DWG cabinet footprints keep the living-to-dining route and bedroom door clear', () => {
  for (let x = 4.2; x <= 8; x += .1) assert.ok(canWalk(x, 4.92, millworkFootprints));
  const doorCenter = (bedroomDoorLeft + bedroomDoorRight) / 2;
  assert.ok(canWalk(doorCenter, bedroomDoorFront, millworkFootprints));
  assert.equal(canWalk(4.8, 3.8, millworkFootprints), false);
  assert.equal(canWalk(6.25, 3.6, millworkFootprints), false);
  assert.equal(canWalk(8.8, 4.2, millworkFootprints), false);
  for (const { id, position: [x, , z] } of viewpoints) assert.ok(canWalk(x, z, millworkFootprints), id);
});
