import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { canWalk, CEILING_HEIGHT, designModel, FOOTPRINT_AREA, footprint, HOME_DEPTH, HOME_WIDTH, insideHome, obstacles, viewpointForRoom, viewpoints } from './plan.ts';
import { legacyPanoramaScenes as panoramaScenes } from './panoramas.ts';

test('panorama reconstruction labels estimated dimensions and covers every source room', () => {
  assert.equal(designModel.estimated, true);
  assert.match(designModel.estimationNote, /估|推/);
  assert.ok(HOME_WIDTH > 0 && HOME_DEPTH > 0 && CEILING_HEIGHT > 2);
  assert.equal(new Set(viewpoints.map(point => point.id)).size, viewpoints.length);
  for (const scene of panoramaScenes) {
    assert.ok(designModel.rooms.some(room => room.sourceSceneIds.includes(scene.id)), scene.label);
  }
  assert.equal(viewpointForRoom('次卧')?.name, '次卧');
  assert.equal(viewpointForRoom('厨房')?.name, '厨房');
  assert.equal(viewpointForRoom('餐厅')?.name, '餐厅');
  assert.equal(viewpointForRoom('餐厨')?.controlRoom, '餐厨');
  assert.equal(viewpointForRoom('不存在'), undefined);
});

test('model envelope, collision footprints and navigation use the same estimated plan', () => {
  assert.equal(insideHome(-.1, 2), false);
  assert.equal(insideHome(HOME_WIDTH + .1, 2), false);
  assert.equal(insideHome(2, HOME_DEPTH + .1), false);
  assert.equal(new Set(obstacles.map(item => item.id)).size, obstacles.length);
  for (const box of obstacles) {
    assert.ok(box.maxX > box.minX && box.maxZ > box.minZ, box.id);
    assert.ok(box.minX >= 0 && box.minZ >= 0 && box.maxX <= HOME_WIDTH && box.maxZ <= HOME_DEPTH, box.id);
    for (const x of [box.minX + .001, box.maxX - .001]) for (const z of [box.minZ + .001, box.maxZ - .001]) {
      assert.ok(insideHome(x, z, 0), box.id + ' footprint must not occupy an exterior recess');
    }
    assert.equal(canWalk((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2), false, box.id);
  }
  for (const room of designModel.rooms) {
    const [x, y, z] = room.position;
    assert.equal(y, 1.62, room.id);
    assert.ok(canWalk(x, z), room.id + ' viewpoint must not be inside walls or furniture');
    assert.ok(x >= room.bounds[0] && x <= room.bounds[2] && z >= room.bounds[1] && z <= room.bounds[3], room.id);
  }
});

test('P-07 dimensions and exterior recesses are preserved instead of filling a bounding rectangle', () => {
  assert.equal(HOME_WIDTH, 12.91);
  assert.equal(HOME_DEPTH, 7.53);
  assert.ok(footprint.length > 4);
  assert.ok(Math.abs(FOOTPRINT_AREA - 81.0135) < .01);
  assert.equal(insideHome(2, 7), true);
  assert.equal(insideHome(11, 5.6), true);
  assert.equal(insideHome(9, .4), false, 'north recess');
  assert.equal(insideHome(10, 7), false, 'south-east recess');
  assert.equal(insideHome(7, 7), false, 'south central recess');
  assert.equal(insideHome(9, 6), false, 'entry recess');
  assert.equal(insideHome(7, 6.1), true, 'cabinet wing inside the footprint');
  assert.equal(insideHome(5.65, 7), false, 'camera radius must not cross a concave exterior edge');
});

test('all room viewpoints can be reached from the entrance without walking through walls', () => {
  const step = .1, width = Math.ceil(HOME_WIDTH / step) + 1, depth = Math.ceil(HOME_DEPTH / step) + 1;
  const visited = new Uint8Array(width * depth);
  const walkable = new Uint8Array(width * depth);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) walkable[z * width + x] = Number(canWalk(x * step, z * step));
  const entry = viewpoints.find(point => point.id === 'entry');
  assert.ok(entry);
  const start = Math.round(entry.position[2] / step) * width + Math.round(entry.position[0] / step);
  assert.ok(walkable[start]);
  const queue = [start]; visited[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head], x = id % width, z = Math.floor(id / width);
    for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
      if (nx < 0 || nx >= width || nz < 0 || nz >= depth) continue;
      const next = nz * width + nx;
      if (walkable[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
    }
  }
  for (const room of viewpoints) {
    const id = Math.round(room.position[2] / step) * width + Math.round(room.position[0] / step);
    assert.ok(visited[id], room.name + ' must have a traversable doorway/route');
  }
});

test('camera radius blocks clipping through furniture edges', () => {
  const walls = [{ minX: 4, maxX: 4.12, minZ: 1, maxZ: 3 }];
  assert.equal(canWalk(4.05, 2, walls), false);
  assert.equal(canWalk(3.9, 2, walls), false);
  assert.equal(canWalk(3.7, 2, walls), true);
  assert.equal(canWalk(4.05, 3.4, walls), true);
});

test('the generated GLB contains tagged geometry for cutaway, ceiling and furniture rendering', () => {
  const bytes = readFileSync(new URL('./models/panorama-home.glb', import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const meshes = gltf.nodes.filter(node => node.mesh !== undefined);
  const kinds = new Set(meshes.map(node => node.extras?.presentation));
  assert.deepEqual([...kinds].sort(), ['ceiling', 'floor', 'furniture', 'overhead', 'wall']);
  assert.ok(gltf.materials.some(material => material.name.startsWith('Glow_')));
  assert.ok(gltf.buffers.every(buffer => !buffer.uri), 'geometry must be embedded');
  assert.ok((gltf.images ?? []).every(image => !image.uri), 'textures must be embedded');
});

test('exported floor geometry does not fill the exterior recesses', () => {
  const bytes = readFileSync(new URL('./models/panorama-home.glb', import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binary = 20 + jsonLength + 8;
  function read(accessorId, index, component = 0) {
    const accessor = gltf.accessors[accessorId], view = gltf.bufferViews[accessor.bufferView];
    const sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
    const size = sizes[accessor.componentType];
    assert.ok(size);
    const stride = view.byteStride ?? size * (accessor.type === 'VEC3' ? 3 : 1);
    const offset = binary + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + index * stride + component * size;
    return accessor.componentType === 5126 ? bytes.readFloatLE(offset) : bytes.readUIntLE(offset, size);
  }
  let checked = 0;
  function visit(index, parent) {
    const node = gltf.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined && node.extras?.presentation === 'floor') {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = primitive.attributes.POSITION;
        const count = gltf.accessors[primitive.indices ?? accessor].count;
        for (let start = 0; start < count; start += 3) {
          const triangle = [0, 1, 2].map(corner => {
            const vertex = primitive.indices === undefined ? start + corner : read(primitive.indices, start + corner);
            return new Vector3(read(accessor, vertex, 0), read(accessor, vertex, 1), read(accessor, vertex, 2)).applyMatrix4(world);
          });
          const center = triangle.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / 3);
          const samples = [...triangle, center, ...triangle.map((point, i) => point.clone().add(triangle[(i + 1) % 3]).multiplyScalar(.5))];
          for (const point of samples) assert.ok(insideHome(point.x, point.z, 0), `${node.name}: floor outside drawing at ${point.x}, ${point.z}`);
          checked++;
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  }
  for (const node of gltf.scenes[gltf.scene ?? 0].nodes) visit(node, new Matrix4());
  assert.ok(checked > 0);
});
