import assert from 'node:assert/strict';
import testCase from 'node:test';
import {
  BRUSSELS_FRAME,
  BRUSSELS_WORLD_BOUNDS,
  BRUSSELS_LANDMARK_ANCHORS,
  brusselsToWorld,
  brusselsToLatLon
} from '../js/brussels-frame.js';

testCase('Brussels origin is Grand-Place and maps to world origin', () => {
  const p = brusselsToWorld(BRUSSELS_FRAME.lat0, BRUSSELS_FRAME.lon0);
  assert.ok(Math.abs(p.x) < 1e-9);
  assert.ok(Math.abs(p.z) < 1e-9);
});

testCase('Brussels coordinate conversion round-trips', () => {
  const original = { lat: 50.84194, lon: 4.36302 };
  const p = brusselsToWorld(original.lat, original.lon);
  const actual = brusselsToLatLon(p.x, p.z);
  assert.ok(Math.abs(actual.lat - original.lat) < 1e-8);
  assert.ok(Math.abs(actual.lon - original.lon) < 1e-8);
});

testCase('initial play-area bounds are ordered and central anchors are inside', () => {
  assert.ok(BRUSSELS_WORLD_BOUNDS.minX < 0 && BRUSSELS_WORLD_BOUNDS.maxX > 0);
  assert.ok(BRUSSELS_WORLD_BOUNDS.minZ < 0 && BRUSSELS_WORLD_BOUNDS.maxZ > 0);
  for (const [id, a] of Object.entries(BRUSSELS_LANDMARK_ANCHORS)) {
    const p = brusselsToWorld(a.lat, a.lon);
    if (id === 'atomium') continue;
    assert.ok(p.x >= BRUSSELS_WORLD_BOUNDS.minX && p.x <= BRUSSELS_WORLD_BOUNDS.maxX, id + ' longitude');
    assert.ok(p.z >= BRUSSELS_WORLD_BOUNDS.minZ && p.z <= BRUSSELS_WORLD_BOUNDS.maxZ, id + ' latitude');
  }
});


testCase('Koekelberg Basilica is inside the initial play area while the Atomium is outside', () => {
  const basilica = brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.koekelbergBasilica.lat, BRUSSELS_LANDMARK_ANCHORS.koekelbergBasilica.lon);
  const atomium = brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.atomium.lat, BRUSSELS_LANDMARK_ANCHORS.atomium.lon);
  assert.ok(basilica.x >= BRUSSELS_WORLD_BOUNDS.minX && basilica.x <= BRUSSELS_WORLD_BOUNDS.maxX);
  assert.ok(basilica.z >= BRUSSELS_WORLD_BOUNDS.minZ && basilica.z <= BRUSSELS_WORLD_BOUNDS.maxZ);
  assert.ok(atomium.x < BRUSSELS_WORLD_BOUNDS.minX || atomium.x > BRUSSELS_WORLD_BOUNDS.maxX ||
    atomium.z < BRUSSELS_WORLD_BOUNDS.minZ || atomium.z > BRUSSELS_WORLD_BOUNDS.maxZ);
});
