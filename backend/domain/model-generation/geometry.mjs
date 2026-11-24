import { deflateSync } from 'node:zlib';

const EPS = 1e-8;
const KINDS = new Set(['sofa', 'bed', 'table', 'chair', 'cabinet', 'desk', 'toilet', 'basin', 'shower', 'plant']);
const MATERIALS = new Set(['wood', 'fabric', 'stone', 'metal', 'ceramic', 'glass']);
const fail = message => { throw new Error(`Invalid generated geometry: ${message}`); };
const finite = (value, label) => { if (!Number.isFinite(value)) fail(label); return value; };
const positive = (value, label) => { finite(value, label); if (value < .0001 || value > 1000) fail(label); return value; };
const color = value => { if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) fail('color'); return value.toLowerCase(); };
const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS;

function onSegment(a, b, p) {
  return Math.abs(cross2(a, b, p)) < EPS && p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

function intersects(a, b, c, d) {
  const abC = cross2(a, b, c), abD = cross2(a, b, d), cdA = cross2(c, d, a), cdB = cross2(c, d, b);
  return (abC * abD < -EPS && cdA * cdB < -EPS) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function inside(point, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(a, b, point)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

/** Ear clipping only accepts a simple polygon; never substitute its bounding box. */
function triangulate(input, width, depth) {
  if (!Array.isArray(input) || input.length < 3 || input.length > 256) fail('footprint vertex count');
  const points = input.map(point => {
    if (!Array.isArray(point) || point.length !== 2) fail('footprint coordinate');
    const [x, z] = point.map(value => finite(value, 'footprint coordinate'));
    if (x < 0 || z < 0 || x > width || z > depth) fail('footprint outside dimensions');
    return [x, z];
  });
  if (samePoint(points[0], points.at(-1))) points.pop();
  if (points.length < 3) fail('footprint vertex count');
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) if (samePoint(points[i], points[j])) fail('duplicate footprint vertex');
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length])) fail('self-intersecting footprint');
    }
  }
  // Straight redundant points are harmless, but a reversing edge is not.
  for (let i = points.length - 1; i >= 0 && points.length > 3; i--) {
    const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
    if (Math.abs(cross2(a, b, c)) < EPS) {
      if (!onSegment(a, c, b)) fail('backtracking footprint edge');
      points.splice(i, 1);
    }
  }
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  if (Math.abs(area) < .0001) fail('zero-area footprint');
  const remaining = points.map((_, i) => i);
  if (area < 0) remaining.reverse();
  const triangles = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length], b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (cross2(points[a], points[b], points[c]) <= EPS) continue;
      if (remaining.some(p => p !== a && p !== b && p !== c && cross2(points[a], points[b], points[p]) >= -EPS
        && cross2(points[b], points[c], points[p]) >= -EPS && cross2(points[c], points[a], points[p]) >= -EPS)) continue;
      triangles.push([a, b, c]); remaining.splice(i, 1); clipped = true; break;
    }
    if (!clipped) fail('footprint cannot be triangulated');
  }
  triangles.push([...remaining]);
  const triangleArea = triangles.reduce((sum, [a, b, c]) => sum + cross2(points[a], points[b], points[c]) / 2, 0);
  if (Math.abs(triangleArea - Math.abs(area)) > Math.max(EPS, Math.abs(area) * 1e-8)) fail('footprint triangulation area');
  return { points, triangles, area: Math.abs(area) };
}

function validate(plan) {
  if (!plan || plan.schemaVersion !== 1) fail('schema version');
  positive(plan.width, 'width'); positive(plan.depth, 'depth'); positive(plan.height, 'height');
  if (!Array.isArray(plan.rooms) || plan.rooms.length > 128 || !Array.isArray(plan.walls) || plan.walls.length > 256
    || !Array.isArray(plan.furniture) || plan.furniture.length > 200) fail('object count');
  if (!plan.finishes || !['wood', 'tile'].includes(plan.finishes.floorMaterial)) fail('floor finish');
  color(plan.finishes.floorColor); color(plan.finishes.wallColor);
  if (!Array.isArray(plan.notes) || plan.notes.length > 32 || plan.notes.some(note => typeof note !== 'string' || note.length > 2000)) fail('source notes');
  const ids = new Set();
  for (const room of plan.rooms) {
    if (typeof room.id !== 'string' || !room.id || room.id.length > 128 || ids.has(room.id)) fail('room id');
    ids.add(room.id);
    if (room.bounds && (!Array.isArray(room.bounds) || room.bounds.length !== 4 || room.bounds.some(value => !Number.isFinite(value))
      || room.bounds[0] >= room.bounds[2] || room.bounds[1] >= room.bounds[3])) fail('room bounds');
  }
  let openings = 0;
  for (const wall of plan.walls) {
    if (typeof wall.id !== 'string' || !wall.id || wall.id.length > 128) fail('wall id');
    for (const point of [wall.from, wall.to]) if (!Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value))
      || point[0] < 0 || point[1] < 0 || point[0] > plan.width || point[1] > plan.depth) fail('wall coordinate');
    const length = positive(Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]), 'wall length');
    positive(wall.thickness, 'wall thickness');
    if (!Array.isArray(wall.openings) || wall.openings.length > 32) fail('wall openings');
    openings += wall.openings.length;
    let end = 0;
    for (const opening of [...wall.openings].sort((a, b) => a.offset - b.offset)) {
      if (!['door', 'window'].includes(opening.kind)) fail('opening kind');
      finite(opening.offset, 'opening offset'); finite(opening.bottom, 'opening bottom');
      positive(opening.width, 'opening width'); positive(opening.height, 'opening height');
      if (opening.offset < end - EPS || opening.offset < 0 || opening.offset + opening.width > length + EPS
        || opening.bottom < 0 || opening.bottom + opening.height > plan.height + EPS) fail('overlapping or out-of-range opening');
      end = opening.offset + opening.width;
    }
  }
  if (openings > 512) fail('opening count');
  const furnitureIds = new Set();
  for (const item of plan.furniture) {
    if (typeof item.id !== 'string' || !item.id || item.id.length > 128 || furnitureIds.has(item.id)) fail('furniture id');
    furnitureIds.add(item.id);
    if (!ids.has(item.roomId) || !KINDS.has(item.kind) || !MATERIALS.has(item.material) || !['straight', 'rounded'].includes(item.style)) fail('furniture type or room');
    for (const key of ['width', 'depth', 'height']) positive(item[key], `furniture ${key}`);
    for (const key of ['x', 'z', 'rotation']) finite(item[key], `furniture ${key}`);
    if (item.x < 0 || item.x > plan.width || item.z < 0 || item.z > plan.depth) fail('furniture position');
    color(item.color);
  }
  return triangulate(plan.footprint, plan.width, plan.depth);
}

const subtract = (a, b) => a.map((value, i) => value - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = value => { const length = Math.hypot(...value); return length < EPS ? [0, 1, 0] : value.map(n => n / length); };

class Geometry {
  positions = []; normals = []; uv = []; indices = [];
  triangle(a, b, c, normals, uv) {
    const normal = normalize(cross(subtract(b, a), subtract(c, a)));
    if (Math.hypot(...cross(subtract(b, a), subtract(c, a))) < 1e-12) return;
    const start = this.positions.length / 3;
    for (const [i, point] of [a, b, c].entries()) {
      if (point.some(value => !Number.isFinite(value))) fail('non-finite mesh vertex');
      this.positions.push(...point); this.normals.push(...(normals?.[i] ?? normal)); this.uv.push(...(uv?.[i] ?? [point[0], point[2]]));
    }
    this.indices.push(start, start + 1, start + 2);
  }
  quad(a, b, c, d, normals, uv) {
    this.triangle(a, b, c, normals && [normals[0], normals[1], normals[2]], uv && [uv[0], uv[1], uv[2]]);
    this.triangle(a, c, d, normals && [normals[0], normals[2], normals[3]], uv && [uv[0], uv[2], uv[3]]);
  }
}

function box(geometry, center, size, rounded = false, transform = value => value) {
  if (size.some(value => !Number.isFinite(value) || value <= 0)) fail('box dimensions');
  const half = size.map(value => value / 2);
  const radius = rounded ? Math.min(...size) * .23 : 0;
  // Face bases are right handed, so all generated faces wind outwards.
  const faces = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]];
  for (const [axis, sign, uAxis, vAxis] of faces) {
    const us = radius ? [-half[uAxis], -half[uAxis] + radius, half[uAxis] - radius, half[uAxis]] : [-half[uAxis], half[uAxis]];
    const vs = radius ? [-half[vAxis], -half[vAxis] + radius, half[vAxis] - radius, half[vAxis]] : [-half[vAxis], half[vAxis]];
    function vertex(u, v) {
      const point = [0, 0, 0]; point[axis] = sign * half[axis]; point[uAxis] = u; point[vAxis] = v;
      let normal = [0, 0, 0]; normal[axis] = sign;
      if (radius) {
        const inner = point.map((value, i) => Math.max(-half[i] + radius, Math.min(half[i] - radius, value)));
        normal = normalize(subtract(point, inner));
        for (let i = 0; i < 3; i++) point[i] = inner[i] + normal[i] * radius;
      }
      const position = transform(point.map((value, i) => value + center[i]));
      // Transform normals using the same linear part (only rigid wall transforms are used).
      const transformedNormal = normalize(subtract(transform(normal), transform([0, 0, 0])));
      const uv = axis === 1 ? [point[0], point[2]] : [axis === 0 ? point[2] : point[0], point[1]];
      return { position, normal: transformedNormal, uv };
    }
    for (let u = 0; u < us.length - 1; u++) for (let v = 0; v < vs.length - 1; v++) {
      const points = [vertex(us[u], vs[v]), vertex(us[u + 1], vs[v]), vertex(us[u + 1], vs[v + 1]), vertex(us[u], vs[v + 1])];
      geometry.quad(...points.map(point => point.position), points.map(point => point.normal), points.map(point => point.uv));
    }
  }
}

function ellipsoid(geometry, center, size) {
  const segments = 12, rings = 6;
  function vertex(ring, segment) {
    const theta = Math.PI * ring / rings, phi = Math.PI * 2 * segment / segments;
    const sphere = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
    return { position: sphere.map((value, i) => center[i] + value * size[i] / 2), normal: normalize(sphere.map((value, i) => value / size[i])), uv: [segment / segments, ring / rings] };
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
    const points = [vertex(r, s), vertex(r, s + 1), vertex(r + 1, s + 1), vertex(r + 1, s)];
    geometry.quad(...points.map(point => point.position), points.map(point => point.normal), points.map(point => point.uv));
  }
}

function cylinder(geometry, center, rx, rz, height, inner = 0) {
  const segments = 16;
  const point = (angle, y, scale = 1) => [center[0] + Math.cos(angle) * rx * scale, center[1] + y, center[2] + Math.sin(angle) * rz * scale];
  for (let i = 0; i < segments; i++) {
    const a = i * Math.PI * 2 / segments, b = (i + 1) * Math.PI * 2 / segments;
    const a0 = point(a, -height / 2), a1 = point(a, height / 2), b0 = point(b, -height / 2), b1 = point(b, height / 2);
    const na = normalize([Math.cos(a) / rx, 0, Math.sin(a) / rz]), nb = normalize([Math.cos(b) / rx, 0, Math.sin(b) / rz]);
    geometry.quad(a0, a1, b1, b0, [na, na, nb, nb]);
    if (inner) {
      const ai0 = point(a, -height / 2, inner), ai1 = point(a, height / 2, inner), bi0 = point(b, -height / 2, inner), bi1 = point(b, height / 2, inner);
      geometry.quad(a1, ai1, bi1, b1); geometry.quad(a0, b0, bi0, ai0); geometry.quad(ai0, bi0, bi1, ai1);
    } else {
      geometry.triangle([center[0], center[1] + height / 2, center[2]], b1, a1);
      geometry.triangle([center[0], center[1] - height / 2, center[2]], a0, b0);
    }
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function patternPng(kind) {
  const width = 128, data = Buffer.alloc((width * 3 + 1) * width);
  let seed = 1946;
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = ((seed >>> 24) / 255 - .5) * 6;
    let value = 245 + noise;
    if (kind === 'wood' || kind === 'wood-floor') value = 226 + 15 * Math.sin(x * .48 + Math.sin(y * .04) * 1.8) + noise;
    if (kind === 'wood-floor' && (x % 32 < 1 || (y + (Math.floor(x / 32) % 2) * 64) % 128 < 1)) value = 164;
    if (kind === 'tile' && (x < 2 || y < 2)) value = 190;
    if (kind === 'fabric') value = 236 + (x % 2 ? 5 : -5) + (y % 2 ? 4 : -4) + noise;
    if (kind === 'stone') value = 241 + Math.sin(x * .10 + y * .03) * 5 + noise;
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    data.fill(Math.max(0, Math.min(255, Math.round(value))), offset, offset + 3);
  }
  function chunk(name, bytes) {
    const type = Buffer.from(name), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
    header.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
    return Buffer.concat([header, type, bytes, checksum]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(width, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}

function createWriter(plan, outline) {
  const json = { asset: { version: '2.0', generator: 'Home OS deterministic plan geometry', extras: { schemaVersion: 1, source: 'validated structured plan', units: 'metre', notes: [...plan.notes] } },
    scene: 0, scenes: [{ nodes: [], extras: { footprint: outline.points, footprintArea: outline.area, width: plan.width, depth: plan.depth, height: plan.height } }],
    nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] };
  const chunks = [], materialCache = new Map(), textureCache = new Map();
  let byteLength = 0, vertices = 0, triangles = 0;
  function view(bytes, target) {
    const padded = Buffer.alloc((bytes.byteLength + 3) & ~3); Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).copy(padded);
    const index = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(padded); byteLength += padded.length;
    if (byteLength > 16 * 1024 * 1024) fail('mesh buffer budget exceeded');
    return index;
  }
  function texture(kind) {
    if (textureCache.has(kind)) return textureCache.get(kind);
    const index = json.textures.length;
    json.images.push({ name: `Procedural ${kind}`, bufferView: view(patternPng(kind)), mimeType: 'image/png' });
    json.textures.push({ sampler: 0, source: json.images.length - 1 }); textureCache.set(kind, index);
    return index;
  }
  function material(type, hex, pattern) {
    color(hex);
    const key = `${type}:${hex}:${pattern ?? ''}`;
    if (materialCache.has(key)) return materialCache.get(key);
    const linear = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    const rgb = [1, 3, 5].map(i => linear(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
    const pbr = { baseColorFactor: [...rgb, type === 'glass' ? .22 : 1], metallicFactor: type === 'metal' ? .85 : 0,
      roughnessFactor: ({ fabric: .98, wood: .68, stone: .45, metal: .26, ceramic: .25, glass: .08 })[type] ?? .85 };
    const surface = pattern ?? (['wood', 'fabric', 'stone'].includes(type) ? type : undefined);
    if (surface) pbr.baseColorTexture = { index: texture(surface) };
    const index = json.materials.length;
    json.materials.push({ name: `${type} ${hex}${pattern ? ` ${pattern}` : ''}`, pbrMetallicRoughness: pbr,
      ...(type === 'glass' ? { alphaMode: 'BLEND', doubleSided: true } : {}) });
    materialCache.set(key, index); return index;
  }
  function accessor(values, size, position = false, index = false) {
    const typed = index ? new Uint32Array(values) : new Float32Array(values);
    const result = { bufferView: view(new Uint8Array(typed.buffer), index ? 34963 : 34962), componentType: index ? 5125 : 5126,
      count: values.length / size, type: ({ 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3' })[size] };
    if (position) {
      result.min = [Infinity, Infinity, Infinity]; result.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < typed.length; i++) { result.min[i % 3] = Math.min(result.min[i % 3], typed[i]); result.max[i % 3] = Math.max(result.max[i % 3], typed[i]); }
    }
    json.accessors.push(result); return json.accessors.length - 1;
  }
  function mesh(name, geometry, mat, extras, parent) {
    if (!geometry.indices.length) return;
    vertices += geometry.positions.length / 3; triangles += geometry.indices.length / 3;
    if (vertices > 350000 || triangles > 120000 || json.nodes.length > 2048) fail('geometry complexity budget exceeded');
    const primitive = { attributes: { POSITION: accessor(geometry.positions, 3, true), NORMAL: accessor(geometry.normals, 3), TEXCOORD_0: accessor(geometry.uv, 2) }, indices: accessor(geometry.indices, 1, false, true), material: mat };
    const node = { name, mesh: json.meshes.length, extras };
    json.meshes.push({ name, primitives: [primitive] });
    const id = json.nodes.push(node) - 1;
    if (parent !== undefined) json.nodes[parent].children.push(id); else json.scenes[0].nodes.push(id);
  }
  function group(name, translation, rotation, extras) {
    const id = json.nodes.push({ name, translation, rotation, children: [], extras }) - 1;
    json.scenes[0].nodes.push(id); return id;
  }
  function finish() {
    json.buffers[0].byteLength = byteLength;
    json.asset.extras.geometry = { vertices, triangles };
    const content = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.alloc((content.length + 3) & ~3, 0x20); content.copy(jsonChunk);
    const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + byteLength, 8);
    jh.writeUInt32LE(jsonChunk.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(byteLength, 0); bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jh, jsonChunk, bh, ...chunks]);
  }
  return { material, mesh, group, finish };
}

function buildFurniture(writer, item) {
  const w = item.width, d = item.depth, h = item.height, rounded = item.style === 'rounded';
  const materials = { primary: writer.material(item.material, item.color), wood: writer.material('wood', '#86654d'), metal: writer.material('metal', '#393b3a'),
    white: writer.material('ceramic', '#eeeae3'), linen: writer.material('fabric', '#e5ddd0'), inset: writer.material('ceramic', '#6f7a78'), glass: writer.material('glass', item.material === 'glass' ? item.color : '#c6d4ce') };
  const parts = new Map();
  function geometry(material) { const id = materials[material]; if (!parts.has(id)) parts.set(id, new Geometry()); return parts.get(id); }
  function cube(name, x, y, z, width, height, depth, material = 'primary', soft = rounded) { box(geometry(material), [x, y, z], [width, height, depth], soft); }
  function oval(x, y, z, width, height, depth, material = 'primary') { ellipsoid(geometry(material), [x, y, z], [width, height, depth]); }
  function cyl(x, y, z, rx, rz, height, material = 'primary', inner = 0) { cylinder(geometry(material), [x, y, z], rx, rz, height, inner); }
  const leg = Math.min(w, d) * .07;
  if (item.kind === 'sofa') {
    cube('base', 0, h * .23, 0, w, h * .30, d * .92);
    cube('back', 0, h * .67, d * .38, w, h * .66, d * .24);
    for (const x of [-w * .45, w * .45]) cube('arm', x, h * .48, 0, w * .10, h * .62, d);
    const seats = w > 1.8 ? 3 : 2;
    for (let i = 0; i < seats; i++) cube('cushion', -w * .39 + (i + .5) * w * .78 / seats, h * .47, -d * .06, w * .74 / seats, h * .17, d * .67);
    for (const x of [-w * .24, w * .24]) oval(x, h * .72, d * .17, w * .22, h * .31, d * .14, 'linen');
    for (const x of [-w * .38, w * .38]) for (const z of [-d * .34, d * .34]) cube('foot', x, h * .075, z, leg, h * .15, leg, 'wood', false);
  } else if (item.kind === 'bed') {
    cube('frame', 0, h * .15, 0, w, h * .25, d, 'wood');
    cube('mattress', 0, h * .36, d * .015, w * .97, h * .25, d * .92, 'linen');
    cube('duvet', 0, h * .52, d * .13, w * .99, h * .12, d * .65);
    cube('headboard', 0, h * .50, -d * .46, w, h, d * .08, item.material === 'wood' ? 'primary' : 'wood');
    for (const x of [-w * .23, w * .23]) oval(x, h * .59, -d * .29, w * .41, h * .17, d * .23, 'linen');
  } else if (item.kind === 'table' || item.kind === 'desk') {
    cube('top', 0, h * .94, 0, w, h * .12, d);
    for (const x of [-w * .40, w * .40]) for (const z of [-d * .37, d * .37]) cube('leg', x, h * .44, z, leg, h * .88, leg, 'wood');
    if (item.kind === 'desk') cube('drawer', 0, h * .78, d * .20, w * .85, h * .18, d * .45, 'wood');
  } else if (item.kind === 'chair') {
    cube('seat', 0, h * .46, 0, w * .93, h * .10, d * .87);
    cube('back', 0, h * .75, d * .42, w * .93, h * .50, d * .16);
    for (const x of [-w * .36, w * .36]) for (const z of [-d * .33, d * .33]) cube('leg', x, h * .22, z, leg, h * .44, leg, 'metal', false);
  } else if (item.kind === 'cabinet') {
    cube('carcass', 0, h * .5, d * .015, w, h, d * .97, 'wood');
    const doors = Math.min(6, Math.max(1, Math.ceil(w / .55)));
    for (let i = 0; i < doors; i++) {
      const x = -w / 2 + (i + .5) * w / doors;
      cube('door', x, h * .5, -d * .485, w / doors * .97, h * .97, d * .03);
      cube('handle', x + w / doors * .30, h * .50, -d * .495, w / doors * .025, h * .09, d * .01, 'metal', false);
    }
  } else if (item.kind === 'toilet') {
    oval(0, h * .22, 0, w * .65, h * .44, d * .65, 'white');
    oval(0, h * .47, -d * .06, w * .96, h * .31, d * .86, 'white');
    cyl(0, h * .63, -d * .08, w * .43, d * .35, h * .055, 'white', .73);
    oval(0, h * .616, -d * .08, w * .60, h * .025, d * .48, 'inset');
    cube('tank', 0, h * .75, d * .38, w * .86, h * .50, d * .24, 'primary');
    cube('flush', w * .15, h * .995, d * .38, w * .18, h * .01, d * .09, 'metal');
  } else if (item.kind === 'basin') {
    cube('vanity', 0, h * .38, 0, w, h * .50, d);
    cube('counter', 0, h * .68, 0, w, h * .08, d, 'white');
    cyl(0, h * .74, -d * .04, w * .34, d * .32, h * .06, 'white', .8);
    oval(0, h * .724, -d * .04, w * .53, h * .025, d * .49, 'inset');
    cube('tap', 0, h * .85, d * .33, w * .035, h * .30, d * .035, 'metal', false);
    cube('spout', 0, h * .97, d * .22, w * .035, h * .035, d * .24, 'metal', false);
  } else if (item.kind === 'shower') {
    cube('tray', 0, h * .025, 0, w, h * .05, d, item.material === 'glass' ? 'white' : 'primary');
    cube('rear glass', 0, h * .50, d * .49, w, h * .98, d * .02, 'glass', false);
    cube('side glass', w * .49, h * .50, 0, w * .02, h * .98, d, 'glass', false);
    cube('pipe', 0, h * .53, d * .43, w * .025, h * .73, d * .025, 'metal', false);
    cube('arm', 0, h * .89, d * .28, w * .025, h * .018, d * .31, 'metal', false);
    cyl(0, h * .88, d * .12, w * .15, d * .15, h * .015, 'metal');
  } else if (item.kind === 'plant') {
    cyl(0, h * .16, 0, w * .28, d * .28, h * .32, 'primary');
    cyl(0, h * .48, 0, w * .018, d * .018, h * .65, 'wood');
    materials.leaf = writer.material('fabric', '#687c4f');
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      oval(Math.cos(a) * w * .24, h * (.46 + i * .065), Math.sin(a) * d * .24, w * .42, h * .17, d * .35, 'leaf');
    }
  }
  const angle = (item.rotation % 360) * Math.PI / 180;
  const extras = { presentation: 'furniture', roomId: item.roomId, furnitureId: item.id, kind: item.kind, style: item.style };
  const parent = writer.group(`${item.kind} ${item.id}`, [item.x, 0, item.z], [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)], extras);
  for (const [mat, geometry] of parts) writer.mesh(`${item.kind} ${item.id} surface ${mat}`, geometry, mat, extras, parent);
}

/** Pure, deterministic geometry from a validated plan; no executable model output. */
export async function buildGeneratedGlb(plan) {
  const outline = validate(plan), writer = createWriter(plan, outline);
  const floor = writer.material(plan.finishes.floorMaterial === 'wood' ? 'wood' : 'stone', plan.finishes.floorColor, plan.finishes.floorMaterial === 'wood' ? 'wood-floor' : 'tile');
  const wallMaterial = writer.material('plaster', plan.finishes.wallColor);
  function slab(name, bottom, top, mat, presentation) {
    const geometry = new Geometry();
    for (const [a, b, c] of outline.triangles) {
      const at = (i, y) => [outline.points[i][0], y, outline.points[i][1]];
      geometry.triangle(at(a, top), at(c, top), at(b, top));
      geometry.triangle(at(a, bottom), at(b, bottom), at(c, bottom));
    }
    const signed = outline.points.reduce((sum, p, i) => { const q = outline.points[(i + 1) % outline.points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    for (let i = 0; i < outline.points.length; i++) {
      const p = outline.points[i], q = outline.points[(i + 1) % outline.points.length];
      const points = [[p[0], bottom, p[1]], [q[0], bottom, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]];
      if (signed > 0) points.reverse();
      geometry.quad(...points);
    }
    writer.mesh(name, geometry, mat, { presentation, roomId: 'home' });
  }
  slab('Floor footprint', -.12, 0, floor, 'floor');
  slab('Ceiling footprint', plan.height, plan.height + .08, wallMaterial, 'ceiling');
  for (const wall of plan.walls) {
    const dx = wall.to[0] - wall.from[0], dz = wall.to[1] - wall.from[1], length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length, nx = -uz, nz = ux;
    const middle = [(wall.from[0] + wall.to[0]) / 2, (wall.from[1] + wall.to[1]) / 2];
    const positiveSide = inside([middle[0] + nx * .001, middle[1] + nz * .001], outline.points), negativeSide = inside([middle[0] - nx * .001, middle[1] - nz * .001], outline.points);
    // A line on the exterior outline describes its outer edge; keep its thickness inward.
    const shift = positiveSide !== negativeSide ? (positiveSide ? 1 : -1) * wall.thickness / 2 : 0;
    const transform = ([s, y, across]) => [wall.from[0] + ux * s + nx * (across + shift), y, wall.from[1] + uz * s + nz * (across + shift)];
    const geometry = new Geometry(), glazing = new Geometry();
    const roomId = plan.rooms.find(room => room.bounds && middle[0] >= room.bounds[0] - EPS && middle[0] <= room.bounds[2] + EPS && middle[1] >= room.bounds[1] - EPS && middle[1] <= room.bounds[3] + EPS)?.id ?? 'home';
    const extras = { presentation: 'wall', roomId, wallId: wall.id };
    function piece(start, end, bottom, top) {
      if (end - start > EPS && top - bottom > EPS) box(geometry, [(start + end) / 2, (bottom + top) / 2, 0], [end - start, top - bottom, wall.thickness], false, transform);
    }
    let cursor = 0;
    for (const opening of [...wall.openings].sort((a, b) => a.offset - b.offset)) {
      piece(cursor, opening.offset, 0, plan.height);
      piece(opening.offset, opening.offset + opening.width, 0, opening.bottom);
      piece(opening.offset, opening.offset + opening.width, opening.bottom + opening.height, plan.height);
      if (opening.kind === 'window') box(glazing, [opening.offset + opening.width / 2, opening.bottom + opening.height / 2, 0], [opening.width, opening.height, Math.min(.018, wall.thickness * .2)], false, transform);
      cursor = opening.offset + opening.width;
    }
    piece(cursor, length, 0, plan.height);
    writer.mesh(`Wall ${wall.id}`, geometry, wallMaterial, extras);
    if (glazing.indices.length) writer.mesh(`Window ${wall.id}`, glazing, writer.material('glass', '#c6d4ce'), extras);
  }
  for (const item of plan.furniture) buildFurniture(writer, item);
  return writer.finish();
}
