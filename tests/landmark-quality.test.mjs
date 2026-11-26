import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDMARK_PERF_MERGE_IDS,
  LANDMARK_PERFORMANCE_ZONES,
  isWithinLandmarkPerformanceZone,
  landmarkPerformanceZoneAt,
  landmarkShadowFlags,
  isWithinGrandPlacePerformanceZone,
  grandPlaceShadowFlags
} from '../js/landmark-quality.mjs';
import { grandPlaceShadowFlags as legacyShadowFlags, isWithinGrandPlacePerformanceZone as legacyZone } from '../js/grand-place-quality.mjs';
import { BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld } from '../js/brussels-frame.js';

test('the performance zones cover exactly the three monumental hotspots', () => {
  assert.deepEqual([...LANDMARK_PERF_MERGE_IDS].sort(), ['grandPlace', 'palaisDeJustice', 'royalPalace']);
  assert.deepEqual(Object.keys(LANDMARK_PERFORMANCE_ZONES).sort(), [...LANDMARK_PERF_MERGE_IDS].sort());
});

test('each zone is centred on its landmark anchor in world metres', () => {
  for (const id of LANDMARK_PERF_MERGE_IDS) {
    const anchor = BRUSSELS_LANDMARK_ANCHORS[id];
    const p = brusselsToWorld(anchor.lat, anchor.lon);
    const zone = LANDMARK_PERFORMANCE_ZONES[id];
    assert.ok(Math.abs(zone.x - p.x) < 1e-6 && Math.abs(zone.z - p.z) < 1e-6, `${id} zone centred on the anchor`);
    assert.ok(zone.radius > 0 && zone.r2 === zone.radius * zone.radius);
  }
});

test('standing on each hotspot is inside its zone; the far canal is outside all of them', () => {
  for (const id of LANDMARK_PERF_MERGE_IDS) {
    const zone = LANDMARK_PERFORMANCE_ZONES[id];
    assert.equal(isWithinLandmarkPerformanceZone(zone.x, zone.z), true, `${id} centre inside`);
    assert.equal(landmarkPerformanceZoneAt(zone.x, zone.z), id);
    assert.equal(isWithinLandmarkPerformanceZone(zone.x + zone.radius, zone.z), true, `${id} edge inside`);
    assert.equal(isWithinLandmarkPerformanceZone(zone.x + zone.radius + 1, zone.z), false, `${id} just outside`);
  }
  assert.equal(isWithinLandmarkPerformanceZone(3000, -3000), false);
  assert.equal(landmarkPerformanceZoneAt(3000, -3000), null);
});

test('the zone test never takes a square root and stays cheap per frame', () => {
  // squared-distance form: no Math.sqrt anywhere in the hot path
  const src = landmarkShadowFlags.toString() + isWithinLandmarkPerformanceZone.toString();
  assert.ok(!src.includes('sqrt'));
});

test('shadow policy: large masses cast, instanced ornaments and sub-2.5 m details do not', () => {
  assert.deepEqual(landmarkShadowFlags(false, 24), { castShadow: true, receiveShadow: true });
  assert.deepEqual(landmarkShadowFlags(true, 24), { castShadow: false, receiveShadow: true });
  assert.deepEqual(landmarkShadowFlags(true, 4), { castShadow: false, receiveShadow: true });
  assert.deepEqual(landmarkShadowFlags(false, 1.4), { castShadow: false, receiveShadow: false });
});

test('the Grand-Place re-exports keep their exact previous behaviour', () => {
  assert.equal(isWithinGrandPlacePerformanceZone(0, 0, 0, 0), true);
  assert.equal(isWithinGrandPlacePerformanceZone(80, 0, 0, 0), true);
  assert.equal(isWithinGrandPlacePerformanceZone(83, 0, 0, 0), false);
  assert.equal(isWithinGrandPlacePerformanceZone(0, 83, 0, 0), false);
  assert.deepEqual(grandPlaceShadowFlags(false, 24), { castShadow: true, receiveShadow: true });
  assert.deepEqual(grandPlaceShadowFlags(true, 4), { castShadow: false, receiveShadow: true });
  assert.deepEqual(grandPlaceShadowFlags(false, 1.4), { castShadow: false, receiveShadow: false });
  // the legacy module re-exports the same functions
  assert.equal(legacyZone, isWithinGrandPlacePerformanceZone);
  assert.equal(legacyShadowFlags, grandPlaceShadowFlags);
});
