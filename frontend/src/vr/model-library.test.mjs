import test from 'node:test';
import assert from 'node:assert/strict';
import { currentModelVersion, draftFromVersion, MAX_MODEL_BYTES, modelBytesBase64, validateModelDraft, validateModelGlb } from './model-library.ts';

function glb(content, binary = new Uint8Array(0)) {
  const json = new TextEncoder().encode(JSON.stringify(content));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + jsonLength + binary.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20, jsonLength).fill(32); new Uint8Array(buffer, 20, json.length).set(json);
  return buffer;
}
const source = { source: 'upload', width: 10, depth: 8, height: 3, rooms: [{ id: 'r1', name: '客厅', bounds: [0, 0, 5, 5], deviceRoomIds: ['living'], panoramaSceneId: '25152958' }] };

test('upload validation rejects remote dependencies and damaged GLB headers before loader requests', () => {
  const valid = glb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }], images: [{ bufferView: 0, mimeType: 'image/png' }] });
  assert.equal(validateModelGlb(valid).asset.version, '2.0');
  assert.doesNotThrow(() => validateModelGlb(glb({ asset: { version: '2.0' }, images: [{ uri: 'data:image/png;base64,AAAA' }] }))); 
  for (const uri of ['https://example.com/private.png', '../secret.png', 'file:///private/key']) {
    assert.throws(() => validateModelGlb(glb({ asset: { version: '2.0' }, images: [{ uri }] })), /内嵌/);
  }
  assert.throws(() => validateModelGlb(new ArrayBuffer(4)), /完整/);
  const wrongLength = valid.slice(0); new DataView(wrongLength).setUint32(8, 20, true);
  assert.throws(() => validateModelGlb(wrongLength), /长度/);
  const wrongVersion = valid.slice(0); new DataView(wrongVersion).setUint32(4, 1, true);
  assert.throws(() => validateModelGlb(wrongVersion), /格式/);
  assert.throws(() => validateModelGlb(new ArrayBuffer(MAX_MODEL_BYTES + 1)), /30 MB/);
  assert.throws(() => validateModelGlb(glb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] })), /Draco/);
});

test('new drafts start unbound and editing saved rooms cannot mutate an existing version', () => {
  const saved = { ...structuredClone(source), id: 'v1', createdAt: '2026-11-24T00:00:00Z', assetId: 'a1' };
  const draft = draftFromVersion(saved);
  draft.rooms[0].name = '新名称'; draft.rooms[0].deviceRoomIds.length = 0;
  assert.equal(saved.rooms[0].name, '客厅'); assert.deepEqual(saved.rooms[0].deviceRoomIds, ['living']);
  assert.equal('id' in draft, false); assert.equal('createdAt' in draft, false);
  assert.deepEqual(draftFromVersion().rooms, []); assert.equal(draftFromVersion().assetId, undefined);
  assert.equal(currentModelVersion({ currentVersionId: 'v1', versions: [saved] }), saved);
});

test('model dimensions and room ranges cannot accept nonfinite, duplicate or out-of-footprint data', () => {
  assert.equal(validateModelDraft('新模型', source), undefined);
  assert.match(validateModelDraft('   ', source), /名称/);
  for (const width of [NaN, Infinity, 0, -1, 201]) assert.match(validateModelDraft('模型', { ...source, width }), /尺寸/);
  for (const bounds of [[0, 0, 11, 3], [0, 0, 4, 9], [-1, 0, 2, 2], [2, 1, 1, 4], [0, 0, NaN, 2]]) {
    assert.match(validateModelDraft('模型', { ...source, rooms: [{ ...source.rooms[0], bounds }] }), /位置范围/);
  }
  assert.match(validateModelDraft('模型', { ...source, rooms: [source.rooms[0], source.rooms[0]] }), /重复/);
  assert.equal(validateModelDraft('模型', { ...source, rooms: [{ ...source.rooms[0], bounds: undefined, deviceRoomIds: [] }] }), undefined);
});

test('chunked upload encoding preserves the entire byte buffer', () => {
  const buffer = new Uint8Array(100_000).map((_, index) => index % 251);
  assert.deepEqual(Buffer.from(modelBytesBase64(buffer.buffer), 'base64'), Buffer.from(buffer));
});
