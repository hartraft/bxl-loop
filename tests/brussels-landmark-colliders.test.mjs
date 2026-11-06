import assert from 'node:assert/strict';
import test from 'node:test';
import { BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld, MONT_DES_ARTS_ROTATION } from '../js/brussels-frame.js';
import { BRUSSELS_LANDMARK_COLLIDER_LAYOUT, createBrusselsLandmarkColliders, splitMontDesArtsWall } from '../js/brussels-colliders.js';

function localCollider(collider, anchor, yaw) {
  const dx = collider.obb.cx - anchor.x;
  const dz = collider.obb.cz - anchor.z;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos, hx: collider.obb.hx, hz: collider.obb.hz };
}
function overlapsRect(c, rect) {
  // Treat exact edge contact as non-overlap; leave a small tolerance for rotated
  // world/local transforms and floating-point rounding at the 18 m corridor edge.
  const epsilon = 1e-6;
  return Math.abs(c.x - rect.x) < c.hx + rect.hx - epsilon &&
    Math.abs(c.z - rect.z) < c.hz + rect.hz - epsilon;
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
  const approach = { x: 0, z: 85, hx: 38, hz: 7 };
  for (const collider of colliders) {
    assert.equal(overlapsRect(localCollider(collider, anchor, Math.PI), approach), false,
      'no solid collider may cover the central monumental stair/landing corridor');
  }
});

test('Mont des Arts terrace retaining walls preserve the central 18 m stair corridor', () => {
  const anchor = brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.montDesArts.lat, BRUSSELS_LANDMARK_ANCHORS.montDesArts.lon);
  const colliders = createBrusselsLandmarkColliders('montDesArts', anchor, MONT_DES_ARTS_ROTATION);
  const corridor = { x: 0, z: 0, hx: 9, hz: 54 };
  for (const collider of colliders) {
    assert.equal(overlapsRect(localCollider(collider, anchor, MONT_DES_ARTS_ROTATION), corridor), false,
      'no solid collider may cross the central upper-to-lower garden route');
  }
  const terraceWalls = BRUSSELS_LANDMARK_COLLIDER_LAYOUT.montDesArts.filter(c => c.name.startsWith('terrace'));
  assert.equal(terraceWalls.length, 16, 'eight retaining walls should be split into west/east wings');
  for (const wing of terraceWalls) {
    assert.equal(wing.hz, 0.7, 'collider depth must include the 1.4 m coping');
    assert.ok(Math.abs(Math.abs(wing.x) - wing.hx - 9) < 1e-9, 'collider edge must preserve the 18 m opening');
  }
});

test('collider frame transform preserves the shared AABB/OBB convention', () => {
  const anchor = { x: 100, z: -50 };
  const [c] = createBrusselsLandmarkColliders('palaisDeJustice', anchor, Math.PI / 2, 3);
  assert.ok(c && c.obb);
  assert.ok(c.maxY > 3);
  assert.ok(c.minX <= c.maxX && c.minZ <= c.maxZ);
  assert.deepEqual(Object.keys(c.obb).sort(), ['cs', 'cx', 'cz', 'hx', 'hz', 'sn']);
});

test('Mont des Arts rendered retaining walls and copings share the open central passage geometry', () => {
  for (const width of [80, 80.5, 77.5]) {
    const wings = splitMontDesArtsWall(width);
    assert.equal(wings.length, 2);
    const leftInner = wings[0].x + wings[0].halfWidth;
    const rightInner = wings[1].x - wings[1].halfWidth;
    assert.ok(Math.abs(leftInner + 9) < 1e-9);
    assert.ok(Math.abs(rightInner - 9) < 1e-9);
    assert.ok(rightInner - leftInner >= 18);
  }
  assert.throws(() => splitMontDesArtsWall(12, 18), RangeError);
});
