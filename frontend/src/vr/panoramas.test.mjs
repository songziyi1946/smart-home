import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CubeTexture, SRGBColorSpace } from 'three';
import { panoramaFaces, panoramaForModelRoom, panoramaForRoom, panoramaRooms, panoramaScenes, panoramaThumbnail, legacyPanoramaScenes, allPanoramaScenes } from './panoramas.ts';
import { currentBuiltinVersion, initialBuiltinLibrary, builtinDesignForVersion } from './builtin-presets.ts';
import { modelRoomAt } from './room-state.ts';
import { validateModelGlb } from './model-library.ts';
import { createPanoramaTextures } from './panorama-viewer.ts';

function jpegSize(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'asset must be a JPEG, not an HTML error response');
  let offset = 2;
  while (offset + 9 < bytes.length) {
    const marker = bytes.readUInt16BE(offset);
    if ([0xffc0, 0xffc1, 0xffc2].includes(marker)) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error('Missing JPEG dimensions');
}

test('current and historical panoramas ship complete local faces without replacing old IDs', () => {
  assert.equal(panoramaScenes.length, 10);
  assert.equal(panoramaRooms.length, 10);
  assert.equal(new Set(allPanoramaScenes.map(scene => scene.id)).size, 20);
  for (const scene of allPanoramaScenes) {
    const dimensions = panoramaFaces(scene).map(path => {
      assert.match(path, /^\/panoramas\/(buyin-xianfu|kujiale-3fo3an8k4gd1)\/[A-Za-z0-9]+\/[rludfb]\.jpg$/);
      const size = jpegSize(readFileSync(new URL('../../public' + path, import.meta.url)));
      assert.equal(size[0], size[1], scene.label + ' must use square cube faces');
      assert.ok(size[0] >= 1250);
      return size;
    });
    assert.ok(dimensions.every(size => size[0] === dimensions[0][0]));
    const thumbnail = readFileSync(new URL('../../public' + panoramaThumbnail(scene), import.meta.url));
    assert.ok(jpegSize(thumbnail)[0] > 0);
  }
});

test('historical viewpoint IDs and new per-version room associations remain isolated', () => {
  const living = legacyPanoramaScenes.filter(scene => scene.roomId === 'living');
  assert.equal(living.length, 3);
  assert.equal(panoramaForRoom('客厅', living[2].id), living[2]);
  const kitchen = legacyPanoramaScenes.find(scene => scene.roomId === 'kitchen');
  assert.equal(panoramaForRoom('餐厨', kitchen.id), kitchen);
  assert.equal(panoramaForRoom('厨房', kitchen.id), kitchen);
  assert.equal(panoramaForRoom('不存在', living[0].id), undefined);
  const library = initialBuiltinLibrary(), versions = library.models[0].versions;
  assert.equal(versions.length, 2);
  for (const version of versions) {
    for (const room of version.rooms.filter(value => value.panoramaSceneId)) {
      const scene = panoramaForModelRoom(version, room.id);
      assert.ok(scene, room.id);
      assert.match(panoramaFaces(scene)[0], version.builtinGeometryId ? /kujiale-3fo3an8k4gd1/ : /buyin-xianfu/);
    }
  }
  assert.equal(modelRoomAt(8.5, 2, versions[0])?.id, 'second-bedroom');
  assert.equal(modelRoomAt(8.5, 2, currentBuiltinVersion)?.id, 'kitchen');
  assert.equal(builtinDesignForVersion(currentBuiltinVersion).rooms.length, 11);
  for (const room of currentBuiltinVersion.rooms) {
    const [x0, z0, x1, z1] = room.bounds;
    assert.equal(modelRoomAt((x0 + x1) / 2, (z0 + z1) / 2, currentBuiltinVersion)?.id, room.id);
  }
  assert.deepEqual(currentBuiltinVersion.rooms.find(room => room.id === 'washroom').deviceRoomIds, []);
  assert.deepEqual(currentBuiltinVersion.rooms.find(room => room.id === 'dressing').deviceRoomIds, []);
  assert.equal(panoramaForModelRoom(currentBuiltinVersion, 'dining').id, panoramaForModelRoom(currentBuiltinVersion, 'kitchen').id);
});

test('new bundled model embeds its resources and reconstruction provenance within the mobile geometry budget', () => {
  const bytes = readFileSync(new URL('./models/kujiale-home.glb', import.meta.url));
  const gltf = validateModelGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.ok(bytes.length < 20 * 1024 * 1024);
  assert.ok(gltf.meshes.length < 100, 'opaque components should be grouped for mobile rendering');
  assert.equal(gltf.scenes[0].extras.estimated, true);
  assert.match(gltf.scenes[0].extras.sourceUrl, /3FO3AN8K4GD1/);
  for (const image of gltf.images) assert.ok(Number.isInteger(image.bufferView));
  for (const type of ['wall', 'floor', 'furniture', 'ceiling']) {
    assert.ok(gltf.nodes.some(node => node.extras?.presentation === type), type);
  }
});

test('P-07 layout keeps furniture orientation, the single bedroom entry and room picking aligned', () => {
  const design = builtinDesignForVersion(currentBuiltinVersion);
  const furniture = id => {
    const item = design.furniture.find(value => value.id === id);
    assert.ok(item, id);
    return item;
  };
  for (const room of currentBuiltinVersion.rooms) {
    assert.deepEqual(room.bounds, design.rooms.find(value => value.id === room.id).bounds);
  }
  const desk = furniture('study_desk');
  assert.ok(Math.abs(desk.maxX - desk.minX - 2.62) < .001);
  assert.ok(Math.abs(desk.maxZ - desk.minZ - .60) < .001);
  assert.ok(desk.minZ >= 3.50 && desk.maxZ <= 4.12, 'double desk belongs against the south wall');
  const island = furniture('dining_island');
  assert.ok(Math.abs(island.maxX - island.minX - 1.60) < .001);
  assert.ok(Math.abs(island.maxZ - island.minZ - .60) < .001);
  assert.ok(Math.abs(island.minZ - 2.565) < .001);
  const laundry = furniture('balcony_laundry');
  assert.ok(laundry.maxX < 1.70 && laundry.minZ >= 6.64, 'laundry is in the southwest corner');
  const bed = furniture('bedroom_bed');
  assert.ok(Math.abs((bed.minX + bed.maxX) / 2 - 2.32) < .001);
  assert.ok(bed.maxZ - bed.minZ > bed.maxX - bed.minX, 'bed head faces north');
  const sofa = furniture('living_sofa');
  assert.ok(sofa.outline.length > 20 && sofa.minZ > 5.50 && sofa.maxZ < 7.30);
  const tv = furniture('living_tv');
  assert.ok(tv.outline[1][0] > tv.outline[0][0] && tv.outline[1][1] < tv.outline[0][1], 'TV runs diagonally toward the northeast');
  const obstacles = [...design.walls, ...design.furniture];
  assert.ok(!obstacles.some(item => item.minX < 3.44 && item.maxX > 3.44 && item.minZ < 3.62 && item.maxZ > 3.62), '920 mm bedroom doorway stays clear');
});

function harness() {
  const requests = [], applied = [], statuses = [];
  const controller = createPanoramaTextures(texture => applied.push(texture), status => statuses.push(status), {
    load(urls, success, _progress, failure) {
      const texture = new CubeTexture();
      const request = { urls, texture, success, failure, disposed: false };
      texture.addEventListener('dispose', () => { request.disposed = true; });
      requests.push(request);
      return texture;
    },
  });
  return { controller, requests, applied, statuses };
}

test('late loads cannot overwrite a newer room and old textures are released', () => {
  const { controller, requests, applied, statuses } = harness();
  controller.load(panoramaScenes[0]);
  controller.load(panoramaScenes[1]);
  requests[1].success(requests[1].texture);
  requests[0].success(requests[0].texture);
  assert.equal(applied.at(-1), requests[1].texture);
  assert.equal(requests[0].disposed, true);
  assert.equal(requests[1].texture.colorSpace, SRGBColorSpace);
  assert.deepEqual(statuses, ['loading', 'loading', 'ready']);
  controller.load(panoramaScenes[2]);
  assert.equal(applied.at(-1), null, 'old room must not remain visible under the new label');
  assert.equal(requests[1].disposed, true);
  controller.dispose();
  requests[2].success(requests[2].texture);
  assert.equal(applied.at(-1), null);
  assert.equal(requests[2].disposed, true);
  assert.equal(statuses.at(-1), 'loading', 'unmounted viewers must not publish late state');
});

test('a failed face shows an error, stale failures are ignored, and retry can succeed', () => {
  const { controller, requests, statuses, applied } = harness();
  controller.load(panoramaScenes[0]);
  requests[0].failure(new Error('missing face'));
  assert.equal(statuses.at(-1), 'error');
  assert.equal(requests[0].disposed, true);
  assert.equal(applied.at(-1), null);
  controller.load(panoramaScenes[0]);
  requests[0].failure(new Error('another late face'));
  requests[1].success(requests[1].texture);
  assert.deepEqual(statuses, ['loading', 'error', 'loading', 'ready']);
  controller.dispose();
  assert.equal(requests[1].disposed, true);
  controller.load(panoramaScenes[1]);
  assert.equal(requests.length, 2);
});
