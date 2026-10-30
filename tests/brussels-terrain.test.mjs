import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerrainSampler, createTerrainSurface, subdivideTerrainTriangle, foundationWallBase } from '../js/brussels-terrain.js';
import { terrainLineHeights, pointAt } from '../js/road-network.js';

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

test('terrain surface is normalized to the Grand-Place local vertical datum', () => {
  const terrain = {
    minX: -100, maxX: 100, minZ: -100, maxZ: 100, source: 'test DTM',
    sample: (x, z) => 21.81 + x * 0.1 + z * 0.2
  };
  const surface = createTerrainSurface(terrain, { referenceX: 0, referenceZ: 0, edgeBlend: 0 });
  assert.equal(surface.referenceElevation, 21.81);
  assert.equal(surface.sample(0, 0), 0);
  assert.ok(Math.abs(surface.sample(10, 10) - 3) < 1e-9);
  assert.equal(surface.source, 'test DTM');
});

test('terrain surface fades smoothly to the flat fallback at DTM coverage edges', () => {
  const terrain = {
    minX: 0, maxX: 100, minZ: 0, maxZ: 100,
    sample: (x) => 100 + x
  };
  const surface = createTerrainSurface(terrain, { referenceX: 50, referenceZ: 50, edgeBlend: 20 });
  assert.equal(surface.sample(0, 50), 0);
  assert.equal(surface.sample(10, 50), -20);
  assert.equal(surface.sample(50, 50), 0);
  assert.equal(surface.sample(-1, 50), 0);
});

test('terrain surface rejects invalid vertical reference and blend settings', () => {
  assert.equal(createTerrainSurface(null), null);
  const terrain = { minX: 0, maxX: 10, minZ: 0, maxZ: 10, sample: () => null };
  assert.throws(() => createTerrainSurface(terrain), /vertical reference/);
  assert.throws(() => createTerrainSurface({ ...terrain, sample: () => 1 }, { edgeBlend: -1 }), /options/);
});

test('terrain triangle subdivision creates a shared, conforming sample lattice', () => {
  const mesh = subdivideTerrainTriangle([0, 0], [100, 0], [100, 100], 25, 4);
  assert.equal(mesh.steps, 4);
  assert.equal(mesh.vertices.length, 15);
  assert.equal(mesh.triangles.length, 16);
  for (const [x, z] of mesh.vertices) assert.ok(x >= -1e-9 && z >= -1e-9 && x <= 100 + 1e-9 && z <= x + 1e-9);
  for (const triangle of mesh.triangles) assert.equal(triangle.length, 3);
});

test('terrain triangle subdivision preserves winding and rejects invalid input', () => {
  const clockwise = subdivideTerrainTriangle([0, 0], [0, 100], [100, 100], 100);
  assert.equal(clockwise.triangles.length, 4);
  assert.throws(() => subdivideTerrainTriangle([0, 0], [1, 1], [2, 2], 0), /Invalid terrain triangle/);
});

test('building foundation wall bases follow local terrain while respecting wall limits', () => {
  assert.equal(foundationWallBase(4, 2, 0, 12), 2.04);
  assert.equal(foundationWallBase(-3, 2, 0, 12), 0);
  assert.equal(foundationWallBase(30, 2, 0, 12), 11.95);
  assert.equal(foundationWallBase(8, 2, 5, 12), 6.04);
  assert.equal(foundationWallBase(8, 2, 5, 5.02), 5);
  assert.throws(() => foundationWallBase(NaN, 0, 0, 10), /Invalid foundation/);
});

test('road and pavement height samples inherit the shared terrain surface', () => {
  const pts = Float32Array.from([0, 0, 10, 5, 20, 10]);
  const world = { terrainSurfaceHeight: (x, z) => 3 + x * 0.1 + z * 0.2 };
  const ys = terrainLineHeights(pts, world);
  assert.deepEqual(Array.from(ys), [3, 5, 7]);
  const p = { cum: Float32Array.from([0, Math.hypot(10, 5), 2 * Math.hypot(10, 5)]), pts, ys };
  const out = {};
  pointAt(p, Math.hypot(10, 5) * 1.5, out);
  assert.ok(Math.abs(out.y - 6) < 1e-6);
  assert.equal(terrainLineHeights(pts, null), null);
});
