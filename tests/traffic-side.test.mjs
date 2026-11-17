import assert from 'node:assert/strict';
import testCase from 'node:test';
import { spawnSync } from 'node:child_process';

function offsets(city) {
  const code = "import { laneOffset, TRAFFIC_SIDE } from './js/road-network.js'; import { CITY_NAME, IS_BRUSSELS } from './js/city-identity.js'; const link={oneway:false,nLanes:2,laneW:3,road:{w:6}}; const oneWay={oneway:true,road:{w:6},laneW:3}; console.log(JSON.stringify({city:CITY_NAME,isBrussels:IS_BRUSSELS,side:TRAFFIC_SIDE,offsets:[laneOffset(link,0),laneOffset(link,1)],oneWayOffset:laneOffset(oneWay,0)}));";
  const env = { ...process.env };
  if (city) env.CITY = city;
  else delete env.CITY;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function assertBrusselsRightHandTraffic(r) {
  assert.equal(r.city, 'Brussels');
  assert.equal(r.isBrussels, true);
  assert.equal(r.side, 'right');
  assert.ok(r.offsets[0] < 0 && r.offsets[1] < 0);
  assert.ok(Math.abs(r.offsets[0]) > Math.abs(r.offsets[1]));
  assert.equal(r.oneWayOffset, -1.5);
}

testCase('Brussels is the default runtime without a city query or environment setting', () => {
  assertBrusselsRightHandTraffic(offsets(null));
});

testCase('legacy CITY environment overrides cannot switch the Brussels runtime', () => {
  for (const city of ['brussels', 'london']) assertBrusselsRightHandTraffic(offsets(city));
});
