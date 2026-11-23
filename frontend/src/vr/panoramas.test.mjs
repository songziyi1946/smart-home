import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CubeTexture, SRGBColorSpace } from 'three';
import { panoramaFaces, panoramaForRoom, panoramaRooms, panoramaScenes, panoramaThumbnail } from './panoramas.ts';
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

test('all ten panoramas ship six complete local cube faces and a thumbnail', () => {
  assert.equal(panoramaScenes.length, 10);
  assert.equal(panoramaRooms.length, 8);
  assert.equal(new Set(panoramaScenes.map(scene => scene.id)).size, 10);
  for (const scene of panoramaScenes) {
    const dimensions = panoramaFaces(scene).map(path => {
      assert.match(path, /^\/panoramas\/buyin-xianfu\/\d+\/[rludfb]\.jpg$/);
      const size = jpegSize(readFileSync(new URL('../../public' + path, import.meta.url)));
      assert.equal(size[0], size[1], scene.label + ' must use square cube faces');
      assert.ok(size[0] >= 1500);
      return size;
    });
    assert.ok(dimensions.every(size => size[0] === dimensions[0][0]));
    const thumbnail = readFileSync(new URL('../../public' + panoramaThumbnail(scene), import.meta.url));
    assert.ok(jpegSize(thumbnail)[0] > 0);
  }
});

test('room selection preserves viewpoints, maps household aliases, and never fabricates a missing room', () => {
  const living = panoramaScenes.filter(scene => scene.roomId === 'living');
  assert.equal(living.length, 3);
  assert.equal(panoramaForRoom('客厅', living[2].id), living[2]);
  assert.equal(panoramaForRoom('主卧', living[2].id)?.roomId, 'primary-bedroom');
  const kitchen = panoramaScenes.find(scene => scene.roomId === 'kitchen');
  assert.equal(panoramaForRoom('餐厨', kitchen.id), kitchen);
  assert.equal(panoramaForRoom('厨房', kitchen.id), kitchen);
  assert.equal(panoramaForRoom('厨房', living[0].id), kitchen);
  assert.equal(panoramaForRoom('餐厅', kitchen.id)?.roomId, 'dining');
  assert.equal(panoramaForRoom('客卫', '')?.roomId, 'bathroom');
  assert.equal(panoramaForRoom('入户', living[0].id), undefined);
  assert.equal(panoramaForRoom('不存在', living[0].id), undefined);
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
