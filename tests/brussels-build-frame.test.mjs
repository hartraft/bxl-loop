import assert from 'node:assert/strict';
import testCase from 'node:test';
import { spawnSync } from 'node:child_process';

function frameFor(city) {
  const code = "import { FRAME, WORLD_BOUNDS, LANDMARK_ANCHORS, toWorld } from './js/geo-frame.js'; console.log(JSON.stringify({FRAME,WORLD_BOUNDS,LANDMARK_ANCHORS,origin:toWorld(FRAME.lat0,FRAME.lon0)}));";
  const env = { ...process.env };
  if (city) env.CITY = city;
  else delete env.CITY;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function assertBrusselsFrame(result) {
  assert.equal(result.FRAME.lat0, 50.84673);
  assert.equal(result.FRAME.lon0, 4.35247);
  assert.ok(Math.abs(result.origin.x) < 1e-8);
  assert.ok(Math.abs(result.origin.z) < 1e-8);
  assert.ok(result.LANDMARK_ANCHORS.grandPlace);
  assert.ok(!result.LANDMARK_ANCHORS.bigBen);
  assert.ok(result.WORLD_BOUNDS.minX < 0 && result.WORLD_BOUNDS.maxX > 0);
}

testCase('browser/server imports unconditionally select the Brussels frame and landmark anchors', () => {
  assertBrusselsFrame(frameFor(null));
});

testCase('the CITY environment cannot switch the frame away from Brussels', () => {
  for (const city of ['brussels', 'london', 'anything-else']) assertBrusselsFrame(frameFor(city));
});
