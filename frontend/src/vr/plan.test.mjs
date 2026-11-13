import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWalk, insideHome, viewpoints } from './plan.ts';

test('L-shaped footprint excludes the two exterior recesses', () => {
  assert.equal(insideHome(2, 7), true);
  assert.equal(insideHome(8, 5.7), true);
  assert.equal(insideHome(8, 7), false);
  assert.equal(insideHome(10, .4), false);
  assert.equal(insideHome(-.1, 2), false);
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
