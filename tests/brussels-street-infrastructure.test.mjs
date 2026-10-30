import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [street, brusselsCity, roads] = await Promise.all([
  readFile(new URL('../js/street-details.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/brussels-base-city.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/city/roads.js', import.meta.url), 'utf8')
]);

test('Brussels city explicitly selects Belgian street furniture while London keeps the default profile', () => {
  assert.match(brusselsCity, /buildStreetDetails\(scene, \{[^}]*city: 'brussels'/s);
  assert.match(street, /city = 'london'/);
  assert.match(street, /const isBrussels = city === 'brussels'/);
  assert.match(street, /function signalGeometry\(isBrussels = false\)/);
});

test('Brussels signals use compact vehicle heads and pedestrian signal heads', () => {
  assert.match(street, /BrusselsTrafficSignals/);
  assert.match(street, /BrusselsPedestrianSignals/);
  assert.match(street, /function pedestrianSignalGeometry\(\)/);
  assert.match(street, /const kerbSide = isBrussels \? -1 : 1/);
});

test('Brussels has bpost mailboxes and no London K6 kiosks or Belisha beacons', () => {
  assert.match(street, /function bpostMailboxGeometry\(\)/);
  assert.match(street, /BpostMailboxes/);
  assert.match(street, /if \(!isBrussels\) add\(instanced\(k6Geometry\(\)/);
  assert.match(street, /if \(!isBrussels\) \{\s*add\(instanced\(belishaPole\(\)/);
  assert.match(street, /if \(!isBrussels\) for \(const stn of geo\.stations\)/);
});

test('Brussels road markings omit UK red routes, double-yellow lines and zebra zig-zags', () => {
  assert.doesNotMatch(roads, /const red = r\.kind === 'trunk'/);
  assert.doesNotMatch(roads, /markLine\(b, d\.p, d\.y, side \* \(hw - 0\.42\)/);
  assert.doesNotMatch(roads, /const offs = r\.oneway \? \[hw - 0\.35/);
  assert.match(roads, /single broken yellow edge line/);
});
