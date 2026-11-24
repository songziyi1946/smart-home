import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { buildGeneratedGlb } from './geometry.mjs';

const footprint = [[0, 0], [5.94, 0], [5.94, .89], [12.91, .89], [12.91, 6.14], [9.68, 6.14], [9.68, 5.8], [8.26, 5.8], [8.26, 6.32], [5.74, 6.32], [5.74, 7.53], [0, 7.53]];
const kinds = ['sofa', 'bed', 'table', 'chair', 'cabinet', 'desk', 'toilet', 'basin', 'shower', 'plant'];
function plan() {
  return { schemaVersion: 1, width: 12.91, depth: 7.53, height: 2.7, footprint: structuredClone(footprint),
    rooms: [{ id: 'living', name: '客厅', bounds: [0, 0, 5.94, 7.53], deviceRoomIds: [] }],
    walls: [{ id: 'opening-test', from: [1, 1], to: [5, 1], thickness: .18, openings: [
      { kind: 'door', offset: 1, width: 1, bottom: 0, height: 2.1 },
      { kind: 'window', offset: 3, width: .7, bottom: .8, height: 1.1 },
    ] }],
    furniture: kinds.map((kind, i) => ({ id: kind, kind, roomId: 'living', x: 1 + (i % 4), z: 2 + Math.floor(i / 4), width: .8, depth: .7, height: 1,
      rotation: 0, color: '#a58b71', material: 'wood', style: 'rounded' })),
    finishes: { floorColor: '#d9d3c8', wallColor: '#eee8df', floorMaterial: 'tile' }, notes: ['P-07 外轮廓；家具样式参考全景，尺寸为估算。'] };
}

function readGlb(buffer) {
  assert.equal(buffer.readUInt32LE(0), 0x46546c67);
  assert.equal(buffer.readUInt32LE(4), 2);
  assert.equal(buffer.readUInt32LE(8), buffer.length);
  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString());
  const binHeader = 20 + jsonLength;
  assert.equal(buffer.readUInt32LE(binHeader + 4), 0x004e4942);
  const bin = buffer.subarray(binHeader + 8);
  assert.equal(json.buffers[0].byteLength, bin.length);
  function accessor(index) {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type], out = [];
    assert.ok(components);
    for (let i = 0; i < a.count * components; i++) {
      const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * 4;
      out.push(a.componentType === 5126 ? bin.readFloatLE(offset) : bin.readUInt32LE(offset));
    }
    return out;
  }
  function triangles(node) {
    const primitive = json.meshes[node.mesh].primitives[0], positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
    const result = [];
    for (let i = 0; i < indices.length; i += 3) result.push(indices.slice(i, i + 3).map(index => positions.slice(index * 3, index * 3 + 3)));
    return result;
  }
  function image(index) {
    const v = json.bufferViews[json.images[index].bufferView];
    return bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
  }
  return { json, bin, accessor, triangles, image };
}

const subtract = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
function rayHits(triangle, origin) {
  const direction = [0, 0, 1], [a, b, c] = triangle, e1 = subtract(b, a), e2 = subtract(c, a), h = cross(direction, e2), det = dot(e1, h);
  if (Math.abs(det) < 1e-8) return false;
  const s = subtract(origin, a), u = dot(s, h) / det;
  if (u < 0 || u > 1) return false;
  const q = cross(s, e1), v = dot(direction, q) / det;
  return v >= 0 && u + v <= 1 && dot(e2, q) / det >= 0;
}

test('concave P-07 footprint triangulates to its true area in both winding directions', async () => {
  for (const reverse of [false, true]) {
    const source = plan(); source.furniture = []; if (reverse) source.footprint.reverse();
    const glb = readGlb(await buildGeneratedGlb(source));
    const floor = glb.json.nodes.find(node => node.name === 'Floor footprint');
    const triangles = glb.triangles(floor).filter(points => points.every(p => Math.abs(p[1]) < 1e-7));
    let area = 0;
    for (const [a, b, c] of triangles) {
      const normal = cross(subtract(b, a), subtract(c, a));
      assert.ok(normal[1] > 0, 'floor top winding points upward');
      area += Math.hypot(...normal) / 2;
    }
    assert.ok(Math.abs(area - 81.0135) < .0001, String(area));
    assert.ok(area < source.width * source.depth - 10, 'exterior notches must not become a rectangle');
    assert.equal(glb.json.asset.extras.schemaVersion, 1);
    assert.deepEqual(glb.json.asset.extras.notes, source.notes);
  }
});

test('door and window openings remain empty in opaque wall geometry', async () => {
  const source = plan(); source.furniture = [];
  const glb = readGlb(await buildGeneratedGlb(source));
  const wall = glb.json.nodes.find(node => node.name === 'Wall opening-test');
  const glass = glb.json.nodes.find(node => node.name === 'Window opening-test');
  for (const y of [.1, 1.0, 2.0]) assert.ok(!glb.triangles(wall).some(t => rayHits(t, [2.5, y, 0])), 'door is open');
  assert.ok(glb.triangles(wall).some(t => rayHits(t, [2.5, 2.4, 0])), 'door lintel exists');
  assert.ok(glb.triangles(wall).some(t => rayHits(t, [1.5, 1.2, 0])), 'solid wall exists');
  assert.ok(!glb.triangles(wall).some(t => rayHits(t, [4.3, 1.2, 0])), 'window hole is open');
  assert.ok(glb.triangles(glass).some(t => rayHits(t, [4.3, 1.2, 0])), 'window has a glass pane');
  assert.ok(glb.triangles(wall).some(t => rayHits(t, [4.3, .4, 0])), 'window sill exists');
});

test('furniture kinds have distinct composed shapes, outward normals and degree-based transforms', async () => {
  const source = plan(); source.furniture[0].rotation = 90;
  const glb = readGlb(await buildGeneratedGlb(source));
  const counts = [];
  for (const item of source.furniture) {
    const group = glb.json.nodes.find(node => node.name === `${item.kind} ${item.id}`);
    assert.ok(group.children.length >= 2, item.kind + ' should compose different surfaces');
    assert.deepEqual(group.translation, [item.x, 0, item.z]);
    let count = 0;
    for (const child of group.children) {
      const node = glb.json.nodes[child], primitive = glb.json.meshes[node.mesh].primitives[0];
      assert.equal(node.extras.presentation, 'furniture'); assert.equal(node.extras.roomId, item.roomId); assert.equal(node.extras.kind, item.kind);
      const normals = glb.accessor(primitive.attributes.NORMAL), positions = glb.accessor(primitive.attributes.POSITION);
      assert.ok(positions.every(Number.isFinite)); assert.ok(normals.every(Number.isFinite));
      assert.ok(positions.filter((_, i) => i % 3 === 1).every(y => y >= -1e-6 && y <= item.height + 1e-6), item.kind + ' height must fit its declared size');
      for (let i = 0; i < positions.length; i += 9) {
        const normal = cross(subtract(positions.slice(i + 3, i + 6), positions.slice(i, i + 3)), subtract(positions.slice(i + 6, i + 9), positions.slice(i, i + 3)));
        assert.ok(dot(normal, normals.slice(i, i + 3)) > -1e-8, item.kind + ' surface winding agrees with normals');
      }
      count += glb.accessor(primitive.indices).length;
    }
    assert.ok(count > 36, item.kind + ' cannot be one box'); counts.push(count);
  }
  assert.ok(new Set(counts).size >= 8, 'furniture geometry must not be the same box under different names');
  const sofa = glb.json.nodes.find(node => node.name === 'sofa sofa');
  assert.ok(Math.abs(sofa.rotation[1] - Math.SQRT1_2) < 1e-10);
  const straight = plan(); straight.furniture[0].style = 'straight';
  const roundGeometry = glb.json.asset.extras.geometry.triangles;
  assert.ok(readGlb(await buildGeneratedGlb(straight)).json.asset.extras.geometry.triangles < roundGeometry);
});

function inspectPng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), idat = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset), type = png.subarray(offset + 4, offset + 8).toString();
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  assert.equal(inflateSync(Buffer.concat(idat)).length, height * (width * 3 + 1));
  return { width, height };
}

test('materials, floor finishes and valid PNG textures are fully embedded and deterministic', async () => {
  const source = plan();
  for (const [i, material] of ['wood', 'fabric', 'stone', 'metal', 'ceramic', 'glass'].entries()) source.furniture[i].material = material;
  const first = await buildGeneratedGlb(source), glb = readGlb(first);
  assert.deepEqual(await buildGeneratedGlb(source), first);
  assert.ok(glb.json.images.length >= 3);
  for (let i = 0; i < glb.json.images.length; i++) {
    assert.equal(glb.json.images[i].uri, undefined); inspectPng(glb.image(i));
  }
  assert.equal(glb.json.buffers[0].uri, undefined);
  assert.ok(glb.json.materials.some(mat => mat.alphaMode === 'BLEND'));
  assert.ok(glb.json.materials.some(mat => mat.pbrMetallicRoughness.metallicFactor === .85));
  assert.ok(glb.json.materials.some(mat => mat.name.includes('tile')));
  source.finishes.floorMaterial = 'wood';
  assert.ok(readGlb(await buildGeneratedGlb(source)).json.materials.some(mat => mat.name.includes('wood-floor')));
  for (const accessor of glb.json.accessors) assert.ok(accessor.count > 0 && Number.isInteger(accessor.count));
  assert.ok(first.length < 2 * 1024 * 1024);
});

test('invalid polygons, openings and non-finite or non-positive dimensions fail explicitly', async () => {
  const invalid = [
    p => { p.footprint = [[0, 0], [3, 3], [0, 3], [3, 0]]; },
    p => { p.footprint = [[0, 0], [1, 0], [2, 0]]; },
    p => { p.footprint = [[0, 0], [2, 0], [2, 2], [0, 0], [0, 2]]; },
    p => { p.width = NaN; }, p => { p.height = 0; }, p => { p.furniture[0].width = -1; },
    p => { p.furniture[0].x = Infinity; }, p => { p.furniture[0].color = 'red'; },
    p => { p.walls[0].to = [1, 1]; }, p => { p.walls[0].thickness = 0; },
    p => { p.walls[0].openings[1].offset = 1.5; }, p => { p.walls[0].openings[0].height = 3; },
    p => { p.furniture[0].roomId = 'missing'; },
  ];
  for (const mutate of invalid) { const source = plan(); mutate(source); await assert.rejects(buildGeneratedGlb(source), /Invalid generated geometry/); }
});

test('the frontend GLTFLoader parses the actual generated GLB including embedded textures', async t => {
  const loaderUrl = new URL('../../../frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js', import.meta.url);
  if (!existsSync(loaderUrl)) { t.skip('Frontend dependencies are not installed; run after npm ci --prefix frontend'); return; }
  const original = { self: globalThis.self, createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async blob => ({ ...inspectPng(Buffer.from(await blob.arrayBuffer())), close() {} });
  globalThis.ProgressEvent = class extends Event { constructor(type, init) { super(type); Object.assign(this, init); } };
  try {
    const { GLTFLoader } = await import(loaderUrl.href);
    const bytes = await buildGeneratedGlb(plan());
    const loaded = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    let meshes = 0, textures = 0;
    loaded.scene.traverse(object => {
      if (!object.isMesh) return;
      meshes++; assert.ok(object.geometry.attributes.position.count > 0);
      assert.ok(['wall', 'floor', 'ceiling', 'furniture'].includes(object.userData.presentation));
      if (object.material.map) { textures++; assert.equal(object.material.map.image.width, 128); object.material.map.dispose(); }
      object.geometry.dispose(); object.material.dispose();
    });
    assert.ok(meshes > kinds.length); assert.ok(textures > 0);
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
