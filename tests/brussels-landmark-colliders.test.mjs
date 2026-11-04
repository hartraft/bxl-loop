import assert from 'node:assert/strict';
import test from 'node:test';
import { BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld, MONT_DES_ARTS_ROTATION } from '../js/brussels-frame.js';
import { BRUSSELS_LANDMARK_COLLIDER_LAYOUT, createBrusselsLandmarkColliders } from '../js/brussels-colliders.js';

function localCollider(collider, anchor, yaw) {
  const dx = collider.obb.cx - anchor.x;
  const dz = collider.obb.cz - anchor.z;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos, hx: collider.obb.hx, hz: collider.obb.hz };
}
function overlapsRect(c, rect) {
  return Math.abs(c.x - rect.x) < c.hx + rect.hx && Math.abs(c.z - rect.z) < c.hz + rect.hz;
}

test('Palais de Justice and Mont des Arts each register world-space colliders near their anchors', () => {
  for (const [id, yaw] of [['palaisDeJustice', Math.PI], ['montDesArts', MONT_DES_ARTS_ROTATION]]) {
    const anchor = brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS[id].lat, BRUSSELS_LANDMARK_ANCHORS[id].lon);
    const colliders = createBrusselsLandmarkColliders(id, anchor, yaw, 2.5);
    assert.ok(colliders.length >= 10, id + ' should register principal solid masses and retaining walls');
    for (const c of colliders) {
      assert.ok(c.minX <= c.maxX && c.minZ <= c.maxZ && Number.isFinite(c.maxY));
      assert.ok(c.obb.hx > 0 && c.obb.hz > 0);
      assert.ok(c.minX <= c.obb.cx && c.maxX >= c.obb.cx);
      assert.ok(c.minZ <= c.obb.cz && c.maxZ >= c.obb.cz);
      assert.ok(Math.hypot(c.obb.cx - anchor.x, c.obb.cz - anchor.z) < 200, id + ' collider should remain near its landmark');
    }
  }
});

test('Palais de Justice collider layout leaves the principal Place Poelaert stair approach open', () => {
  const anchor = brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lat, BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lon);
  const colliders = createBrusselsLandmarkColliders('palaisDeJustice', anchor, Math.PI);
  const approach = { x: 0, z: 85, hx: 31, hz: 7 };
  for (const collider of colliders) {
    assert.equal(overlapsRect(localCollider(collider, anchor, Math.PI), approach), false,
      'no solid collider may cover the central monumental stair/landing corridor');
  }
});

test('Mont des Arts terrace retaining walls preserve the central 16 m stair corridor', () => {
  const anchor = brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.montDesArts.lat, BRUSSELS_LANDMARK_ANCHORS.montDesArts.lon);
  const colliders = createBrusselsLandmarkColliders('montDesArts', anchor, MONT_DES_ARTS_ROTATION);
  const corridor = { x: 0, z: 0, hx: 8, hz: 54 };
  for (const collider of colliders) {
    assert.equal(overlapsRect(localCollider(collider, anchor, MONT_DES_ARTS_ROTATION), corridor), false,
      'no solid collider may cross the central upper-to-lower garden route');
  }
  const terraceWalls = BRUSSELS_LANDMARK_COLLIDER_LAYOUT.montDesArts.filter(c => c.name.startsWith('terrace'));
  assert.equal(terraceWalls.length, 16, 'eight retaining walls should be split into west/east wings');
});

test('collider frame transform preserves the shared AABB/OBB convention', () => {
  const anchor = { x: 100, z: -50 };
  const [c] = createBrusselsLandmarkColliders('palaisDeJustice', anchor, Math.PI / 2, 3);
  assert.ok(c && c.obb);
  assert.ok(c.maxY > 3);
  assert.ok(c.minX <= c.maxX && c.minZ <= c.maxZ);
  assert.deepEqual(Object.keys(c.obb).sort(), ['cs', 'cx', 'cz', 'hx', 'hz', 'sn']);
});
