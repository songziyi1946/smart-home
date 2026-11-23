import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCapability, isClimate, isRunning, roomPowerCommand } from './devices.ts';

const device = (capabilities, values) => ({ capabilities, state: { online: true, values } });
test('existing UI classifications and running counts depend on capabilities and current state', () => {
  const light = device(['power', 'brightness'], { power: true, brightness: 50 });
  const ac = device(['power', 'targetTemperature'], { power: false });
  const curtain = device(['position'], { position: 'open' });
  const robot = device(['cleaning', 'battery'], { cleaning: true, battery: 92 });
  assert.equal(hasCapability(light, 'brightness'), true);
  assert.equal(isClimate(light), false);
  assert.equal(isClimate(ac), true);
  assert.equal(isClimate(device(['power'], {power:true})), false);
  assert.deepEqual([light, ac, curtain, robot].filter(isRunning), [light, robot]);
});
test('VR room power preserves curtain controls and only pauses robots on all-off', () => {
  const light = device(['power', 'brightness'], {});
  const ac = device(['power'], {});
  const curtain = device(['position'], {});
  const percentageCurtain = device(['positionPercent'], {});
  const robot = device(['cleaning', 'battery'], {});
  for (const enabled of [true, false]) {
    for (const item of [light, ac]) assert.deepEqual(roomPowerCommand(item, enabled), { capability: 'power', value: enabled });
    assert.deepEqual(roomPowerCommand(curtain, enabled), { capability: 'position', value: enabled ? 'open' : 'closed' });
    assert.deepEqual(roomPowerCommand(percentageCurtain, enabled), { capability: 'positionPercent', value: enabled ? 100 : 0 });
  }
  assert.equal(roomPowerCommand(robot, true), undefined);
  assert.deepEqual(roomPowerCommand(robot, false), { capability: 'cleaning', value: false });
  assert.equal(roomPowerCommand(device(['battery'], {}), false), undefined);
});
