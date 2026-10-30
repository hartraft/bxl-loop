import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const controller = read('../js/controllers.js');
const traffic = read('../js/traffic.js');
const bus = read('../js/brussels-bus.js');
const driver = read('../js/bus-driver.js');

test('Brussels player bus selects the STIB model while London keeps its double-decker', () => {
  assert.match(controller, /const makeBusModel = \(opts = \{\}\) => IS_BRUSSELS \? brusselsBus\(opts\) : doubleDecker\(opts\)/);
  assert.match(controller, /makeBusModel\(\{ route: IS_BRUSSELS \? '71' : '24'/);
  assert.match(bus, /STIB \/ MIVB/);
  assert.match(bus, /length: 12\.0, width: 2\.55, height: 3\.25/);
});

test('Brussels ambient traffic uses the STIB bus and does not overwrite its destination blind', () => {
  assert.match(traffic, /IS_BRUSSELS\s*\?\s*brusselsBus/);
  assert.match(traffic, /if \(bm && !IS_BRUSSELS\)/);
});

test('London bus route picker is not exposed in Brussels mode', () => {
  assert.match(driver, /if \(IS_BRUSSELS\)\s*\{[\s\S]*?STIB\/MIVB bus driving[\s\S]*?return;/);
});
