import assert from 'node:assert/strict';
import testCase from 'node:test';
import { spawnSync } from 'node:child_process';

function offsets(city) {
  const code = "import { laneOffset, TRAFFIC_SIDE } from './js/road-network.js'; const link={oneway:false,nLanes:2,laneW:3,road:{w:6}}; console.log(JSON.stringify({side:TRAFFIC_SIDE,offsets:[laneOffset(link,0),laneOffset(link,1)]}));";
  const env = { ...process.env };
  if (city) env.CITY = city;
  else delete env.CITY;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

testCase('London default keeps kerb lanes on the left of travel', () => {
  const r = offsets(null);
  assert.equal(r.side, 'left');
  assert.ok(r.offsets[0] > 0 && r.offsets[1] > 0);
  assert.ok(r.offsets[0] > r.offsets[1]);
});

testCase('Brussels build uses right-hand kerb-side lane offsets', () => {
  const r = offsets('brussels');
  assert.equal(r.side, 'right');
  assert.ok(r.offsets[0] < 0 && r.offsets[1] < 0);
  assert.ok(Math.abs(r.offsets[0]) > Math.abs(r.offsets[1]));
});
