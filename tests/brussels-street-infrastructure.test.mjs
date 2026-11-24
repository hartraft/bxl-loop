import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [street, brusselsCity, roads] = await Promise.all([
  readFile(new URL('../js/street-details.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/brussels-city.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/city/roads.js', import.meta.url), 'utf8')
]);

test('street details are Brussels-only: no city switch parameter and no London default', () => {
  assert.match(brusselsCity, /buildStreetDetails\(scene, \{ geo, world, ctx, inRegion, roads: rd, ground: gnd, details, trees, parent: root \}\)/);
  assert.doesNotMatch(street, /city = 'london'/);
  assert.doesNotMatch(street, /isBrussels/);
  assert.doesNotMatch(street, /process\.env\.CITY/);
});

test('Brussels signals use compact vehicle heads and pedestrian signal heads on the left kerb', () => {
  assert.match(street, /BrusselsTrafficSignals/);
  assert.match(street, /BrusselsPedestrianSignals/);
  assert.match(street, /function pedestrianSignalGeometry\(\)/);
  assert.match(street, /const kerbSide = -1;/);
});

test('Brussels has bpost mailboxes and no London K6 kiosks or Belisha beacons anywhere', () => {
  assert.match(street, /function bpostMailboxGeometry\(\)/);
  assert.match(street, /BpostMailboxes/);
  assert.doesNotMatch(street, /k6Geometry/i);
  assert.doesNotMatch(street, /belisha/i);
});

test('Brussels road markings omit UK red routes, double-yellow lines and zebra zig-zags', () => {
  assert.doesNotMatch(roads, /const red = r\.kind === 'trunk'/);
  assert.doesNotMatch(roads, /markLine\(b, d\.p, d\.y, side \* \(hw - 0\.42\)/);
  assert.doesNotMatch(roads, /const offs = r\.oneway \? \[hw - 0\.35/);
  assert.match(roads, /single broken yellow edge line/);
});
