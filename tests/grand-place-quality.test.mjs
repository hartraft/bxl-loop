import test from 'node:test';
import assert from 'node:assert/strict';
import { grandPlaceShadowFlags, isWithinGrandPlacePerformanceZone } from '../js/grand-place-quality.mjs';

test('Grand-Place performance zone covers the square and its immediate approaches', () => {
  assert.equal(isWithinGrandPlacePerformanceZone(0, 0, 0, 0), true);
  assert.equal(isWithinGrandPlacePerformanceZone(80, 0, 0, 0), true);
  assert.equal(isWithinGrandPlacePerformanceZone(83, 0, 0, 0), false);
  assert.equal(isWithinGrandPlacePerformanceZone(0, 83, 0, 0), false);
});

test('Grand-Place large architectural masses retain shadows', () => {
  assert.deepEqual(grandPlaceShadowFlags(false, 24), { castShadow: true, receiveShadow: true });
});

test('Grand-Place instanced ornaments stop casting redundant shadows', () => {
  assert.deepEqual(grandPlaceShadowFlags(true, 4), { castShadow: false, receiveShadow: true });
});

test('sub-2.5 m details neither cast nor sample shadows', () => {
  assert.deepEqual(grandPlaceShadowFlags(false, 1.4), { castShadow: false, receiveShadow: false });
});
