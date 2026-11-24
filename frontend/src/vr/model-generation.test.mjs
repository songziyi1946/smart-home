import test from 'node:test';
import assert from 'node:assert/strict';
import { canRestoreGenerationPlan, generationJobCanReplace, imageTargetSize, jobRunning, removeGeneratedRoom, scaleGeneratedPlan } from './model-generation.ts';
const plan = {
  schemaVersion: 1, width: 10, depth: 8, height: 2.8,
  footprint: [[0, 0], [10, 0], [10, 8], [0, 8]],
  rooms: [
    { id: 'living', name: '客厅', bounds: [0, 0, 5, 8], deviceRoomIds: ['living'], panoramaSceneId: 'scene1' },
    { id: 'bed', name: '主卧', bounds: [5, 0, 10, 8], deviceRoomIds: ['bedroom'] },
  ],
  walls: [{ id: 'wall', from: [5, 0], to: [5, 8], thickness: .12, openings: [{ kind: 'door', offset: 1, width: .9, bottom: 0, height: 2.1 }] }],
  furniture: [
    { id: 'sofa', roomId: 'living', x: 2, z: 3, width: 2, depth: 1, height: .8, rotation: 90, material: 'fabric', color: '#aabbcc', style: 'rounded', kind: 'sofa' },
    { id: 'bed1', roomId: 'bed', x: 7, z: 4, width: 1.8, depth: 2, height: .6, rotation: 0, material: 'fabric', color: '#ddeeff', style: 'straight', kind: 'bed' },
  ], finishes: { floorColor: '#abcdef', wallColor: '#ffffff', floorMaterial: 'wood' }, notes: ['家具尺寸待校正'],
};

test('calibration scales every spatial coordinate together while retaining room bindings and furniture style', () => {
  const original = structuredClone(plan), scaled = scaleGeneratedPlan(plan, 15);
  assert.equal(scaled.width, 15); assert.equal(scaled.depth, 12); assert.ok(Math.abs(scaled.height - 4.2) < 1e-9);
  assert.deepEqual(scaled.footprint[2], [15, 12]);
  assert.deepEqual(scaled.rooms[0].bounds, [0, 0, 7.5, 12]);
  assert.deepEqual(scaled.rooms[0].deviceRoomIds, ['living']); assert.equal(scaled.rooms[0].panoramaSceneId, 'scene1');
  assert.deepEqual(scaled.walls[0].from, [7.5, 0]); assert.equal(scaled.walls[0].openings[0].width, 1.35);
  assert.equal(scaled.furniture[0].x, 3); assert.equal(scaled.furniture[0].width, 3); assert.equal(scaled.furniture[0].rotation, 90);
  assert.equal(scaled.furniture[0].color, '#aabbcc'); assert.deepEqual(plan, original);
  assert.throws(() => scaleGeneratedPlan(plan, 0), /宽度/); assert.throws(() => scaleGeneratedPlan(plan, NaN), /宽度/);
});

test('deleting a room removes only its own furniture, keeping remaining device mappings intact', () => {
  const result = removeGeneratedRoom(plan, 'living');
  assert.deepEqual(result.rooms.map(room => room.id), ['bed']);
  assert.deepEqual(result.furniture.map(item => item.id), ['bed1']);
  assert.deepEqual(result.rooms[0].deviceRoomIds, ['bedroom']); assert.equal(plan.rooms.length, 2);
});

test('image preprocessing caps long side without changing aspect ratio or enlarging small images', () => {
  assert.deepEqual(imageTargetSize(4000, 2000, 2048), { width: 2048, height: 1024 });
  assert.deepEqual(imageTargetSize(1200, 2400, 1024), { width: 512, height: 1024 });
  assert.deepEqual(imageTargetSize(300, 200, 2048), { width: 300, height: 200 });
  for (const pair of [[0, 10], [10, Infinity], [10000, 10000]]) assert.throws(() => imageTargetSize(...pair, 2048), /尺寸/);
});

test('late polling cannot overwrite cancellation or a newer edited plan', () => {
  const cancelled = { id: 'job', revision: 4, status: 'cancelled' };
  assert.equal(generationJobCanReplace(cancelled, { id: 'job', revision: 3, status: 'reading' }), false);
  assert.equal(generationJobCanReplace(cancelled, { id: 'job', revision: 5, status: 'ready' }), true);
  assert.equal(generationJobCanReplace(cancelled, { id: 'other', revision: 0, status: 'queued' }), true);
  assert.equal(jobRunning(cancelled), false); assert.equal(jobRunning({ status: 'queued' }), true); assert.equal(jobRunning({ status: 'reading' }), true); assert.equal(jobRunning({ status: 'ready' }), false);
});

test('published generated panoramas use their own assets and never fall back to builtin scene IDs', async () => {
  const { panoramaForModelRoom, panoramaFaces } = await import('./panoramas.ts');
  const version = {sourceId:'own-source',rooms:[{id:'living',name:'新客厅',panoramaSceneId:'25152958'}],panoramas:[{id:'25152958',name:'参考',imageAssetId:'own-image',faceAssetIds:['r','l','u','d','f','b']}]};
  assert.deepEqual(panoramaFaces(panoramaForModelRoom(version,'living')),['r','l','u','d','f','b'].map(id=>'/api/model-generation/assets/'+id));
  assert.equal(panoramaForModelRoom({...version,panoramas:[]},'living'),undefined);
  assert.equal(panoramaForModelRoom({...version,panoramas:[{id:'25152958',name:'参考',imageAssetId:'single'}]},'living').faceUrls,undefined);
});


test('failed, cancelled and interrupted revisions can restore an existing plan without an AI call', () => {
  for (const status of ['failed', 'cancelled', 'interrupted']) {
    assert.equal(canRestoreGenerationPlan({ status, plan }), true);
    assert.equal(canRestoreGenerationPlan({ status }), false);
  }
  for (const status of ['queued', 'reading', 'ready']) assert.equal(canRestoreGenerationPlan({ status, plan }), false);
  assert.equal(canRestoreGenerationPlan(undefined), false);
});
