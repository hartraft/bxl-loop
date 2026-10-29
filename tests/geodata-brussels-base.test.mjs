// Sanity checks for the generated Brussels geodata consumed by the live runtime.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GEO } from '../js/brx-geodata.js';
import { WORLD, TELEPORT_LOCATIONS, BRUSSELS_LANDMARKS } from '../js/brussels-config.js';
import { BRUSSELS_FRAME, BRUSSELS_WORLD_BOUNDS } from '../js/brussels-frame.js';
import { createWorldQueries } from '../js/brussels-base-world.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('generated Brussels assets exist and are loaded from the current build output', () => {
  assert.ok(fs.statSync(root + 'data/brussels-build/brx-geo.json').size > 1000);
  assert.ok(fs.statSync(root + 'data/brussels-build/brx-buildings.bin').size > 1000);
  assert.ok(GEO.roads.length > 1000, 'Brussels road data loaded');
  assert.ok(GEO.buildings.count > 1000, 'Brussels building data loaded');
});

test('runtime world and landmarks use the Brussels coordinate frame', () => {
  assert.equal(BRUSSELS_FRAME.lat0, 50.84673);
  assert.ok(BRUSSELS_WORLD_BOUNDS.minX < BRUSSELS_WORLD_BOUNDS.maxX);
  assert.ok(BRUSSELS_WORLD_BOUNDS.minZ < BRUSSELS_WORLD_BOUNDS.maxZ);
  assert.equal(WORLD, createWorldQueries(GEO) && WORLD);
  assert.ok(TELEPORT_LOCATIONS.grandPlace);
  assert.ok(TELEPORT_LOCATIONS.cinquantenaire);
  assert.ok(BRUSSELS_LANDMARKS.some((landmark) => /Grand-Place/i.test(landmark.name)));
});
