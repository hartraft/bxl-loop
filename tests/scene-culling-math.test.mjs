import test from 'node:test';
import assert from 'node:assert/strict';
import { sphereWithinDistance } from '../js/culling-math.mjs';

test('scene culling keeps a chunk whose bounding sphere reaches the distance limit', () => {
  assert.equal(sphereWithinDistance(110, 0, 0, 10, 100, 0, 0, 0), false);
  assert.equal(sphereWithinDistance(109.99, 0, 0, 10, 100, 0, 0, 0), true);
});

test('scene culling uses full 3D distance, including camera height', () => {
  assert.equal(sphereWithinDistance(0, 110, 0, 10, 100, 0, 0, 0), false);
  assert.equal(sphereWithinDistance(0, 0, 0, 10, 100, 0, 0, 0), true);
});

test('scene culling handles a camera translated on all axes', () => {
  assert.equal(sphereWithinDistance(15, 25, 35, 2, 10, 5, 5, 5), true);
  assert.equal(sphereWithinDistance(16, 25, 35, 2, 10, 5, 5, 5), false);
});
