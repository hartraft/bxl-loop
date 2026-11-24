import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const controller = read('../js/controllers.js');
const traffic = read('../js/traffic.js');
const bus = read('../js/brussels-bus.js');

test('the player bus is the STIB/MIVB model with a Brussels route', () => {
  assert.match(controller, /brusselsBus\(\{ route: '71', destination: 'De Brouckère'/);
  assert.match(controller, /brusselsBus\(\{ route, destination, uniforms: bus\.uniforms \}\)/);
  assert.match(bus, /STIB \/ MIVB/);
  assert.match(bus, /length: 12\.0, width: 2\.55, height: 3\.25/);
});

test('ambient traffic uses the STIB bus with a per-instance destination blind', () => {
  assert.match(traffic, /brusselsBus\(\{ route: '71', destination: 'De Brouckère' \}\)/);
  assert.match(traffic, /blind atlas/);
});

test('the retired London bus-driver module is gone', () => {
  assert.ok(!existsSync(new URL('../js/bus-driver.js', import.meta.url)));
  assert.doesNotMatch(controller, /doubleDecker/);
  assert.doesNotMatch(traffic, /doubleDecker/);
});
