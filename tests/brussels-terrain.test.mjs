import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerrainSampler } from '../js/brussels-terrain.js';

const metadata = { width: 3, height: 3, cellSize: 10, minX: 100, minZ: 200, noData: -9999 };

test('terrain sampler returns exact cell-centre elevations', () => {
  const grid = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const terrain = createTerrainSampler(metadata, grid);
  assert.equal(terrain.sample(105, 205), 1);
  assert.equal(terrain.sample(115, 215), 5);
  assert.equal(terrain.sample(125, 225), 9);
});

test('terrain sampler bilinearly interpolates between four cells', () => {
  const grid = Float32Array.from([0, 10, 20, 10, 20, 30, 20, 30, 40]);
  const terrain = createTerrainSampler(metadata, grid);
  assert.equal(terrain.sample(110, 210), 10);
  assert.equal(terrain.sample(110, 215), 15);
});

test('terrain sampler handles nodata neighbours without poisoning valid samples', () => {
  const grid = Float32Array.from([0, -9999, -9999, -9999, 20, -9999, -9999, -9999, -9999]);
  const terrain = createTerrainSampler(metadata, grid);
  assert.equal(terrain.sample(105, 205), 0);
  assert.equal(terrain.sample(115, 215), 20);
  assert.equal(terrain.sample(125, 225), null);
});

test('terrain sampler rejects out-of-coverage coordinates and invalid grids', () => {
  const terrain = createTerrainSampler(metadata, new Float32Array(9).fill(12));
  assert.equal(terrain.sample(99, 205), null);
  assert.equal(terrain.sample(105, 231), null);
  assert.throws(() => createTerrainSampler(metadata, new Float32Array(8)), /size/);
  assert.throws(() => createTerrainSampler({ ...metadata, cellSize: 0 }, new Float32Array(9)), /metadata/);
});
