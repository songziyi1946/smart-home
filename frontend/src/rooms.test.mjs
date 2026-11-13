import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRoom, belongsToRoom } from './constants.ts';

test('home and VR share aliases without mixing adjacent rooms', () => {
  assert.equal(canonicalRoom('餐厅'), '餐厨');
  assert.equal(canonicalRoom('厨房'), '餐厨');
  assert.equal(canonicalRoom('客卫'), '次卫');
  assert.equal(belongsToRoom('厨房', '餐厨'), true);
  assert.equal(belongsToRoom('餐厅', '餐厨'), true);
  assert.equal(belongsToRoom('客卫', '次卫'), true);
  assert.equal(belongsToRoom('主卫', '次卫'), false);
  assert.equal(belongsToRoom('次卧', '主卧'), false);
  assert.equal(canonicalRoom('未命名房间'), '未命名房间');
});
