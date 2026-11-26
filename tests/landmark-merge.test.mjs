// Node tests for js/landmark-merge.mjs: the real module is loaded through the vm harness
// with the vendored three.js as its 'three/webgpu' import, so the production code runs
// unchanged against real BufferGeometry/InstancedMesh/mergeGeometries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE = await import(pathToFileURL(path.join(ROOT, 'vendor/three/build/three.webgpu.js')).href);
const { loadModule } = require(path.join(ROOT, 'tests/helpers/module.cjs'));
const BufferGeometryUtils = loadModule(
  readFileSync(path.join(ROOT, 'vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), 'utf8'),
  { imports: { three: THREE } }
);
const landmarkQuality = await import(pathToFileURL(path.join(ROOT, 'js/landmark-quality.mjs')).href);
const { mergeStaticGeometry } = loadModule(readFileSync(path.join(ROOT, 'js/landmark-merge.mjs'), 'utf8'), {
  imports: {
    'three/webgpu': THREE,
    'three/addons/utils/BufferGeometryUtils.js': BufferGeometryUtils,
    './landmark-quality.mjs': landmarkQuality
  }
});

const triCount = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

function meshOf(parent, material, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

test('static meshes sharing a material merge into one draw call, transforms baked in root space', () => {
  const root = new THREE.Group();
  root.position.set(100, 2, -50);
  root.rotation.y = 0.7;
  const matA = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const matB = new THREE.MeshStandardMaterial({ color: 0x112233 });
  meshOf(root, matA, 10, 20, 5, -30, 10, 0);
  meshOf(root, matA, 4, 4, 4, 25, 2, 10);
  meshOf(root, matB, 8, 8, 8, 0, 4, -20);

  const stats = mergeStaticGeometry(root, { shadowFlags: (e) => landmarkQuality.landmarkShadowFlags(false, e) });
  assert.equal(stats.meshesBefore, 3);
  assert.equal(stats.meshesAfter, 2, 'one merged mesh for matA, matB stays alone');
  assert.equal(stats.mergedMeshes, 1);
  assert.equal(stats.trianglesBefore, stats.trianglesAfter, 'merging preserves triangles exactly');

  const merged = root.children.filter((c) => c.isMesh);
  assert.equal(merged.length, 2);
  const mergedA = merged.find((m) => m.material === matA);
  assert.ok(mergedA, 'merged mesh keeps the shared material instance (night glow still reaches it)');
  assert.equal(triCount(mergedA.geometry), 24, 'two boxes of 12 tris each');
  // baked in root space: the merged geometry's bounds must map back through the root transform
  mergedA.geometry.computeBoundingBox();
  const local = mergedA.geometry.boundingBox;
  const worldMin = new THREE.Vector3(local.min.x, local.min.y, local.min.z).applyMatrix4(root.matrixWorld);
  const worldMax = new THREE.Vector3(local.max.x, local.max.y, local.max.z).applyMatrix4(root.matrixWorld);
  assert.ok(Math.min(worldMin.x, worldMax.x) < 100 - 25 && Math.max(worldMin.x, worldMax.x) > 100 + 20,
    'the two boxes land on opposite sides of the root in world space');
  // shadow policy applied to the merged mass (20 m tall -> casts), matB's 8 m box also casts
  assert.equal(mergedA.castShadow, true);
  assert.equal(mergedA.receiveShadow, true);
});

test('small merged details stop casting; instanced ornaments are baked; big instanced meshes are kept', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 6; i++) meshOf(root, mat, 0.3, 0.3, 0.3, i * 0.2, 0, 0); // tiny balusters, ~1 m spread
  const ornaments = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat, 40);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 40; i++) { dummy.position.set(i * 0.03, 1, 0); dummy.updateMatrix(); ornaments.setMatrixAt(i, dummy.matrix); }
  ornaments.castShadow = true;
  root.add(ornaments);
  const bigInstanced = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, 1000); // above the bake threshold
  for (let i = 0; i < 1000; i++) { dummy.position.set(i, 0, 5); dummy.updateMatrix(); bigInstanced.setMatrixAt(i, dummy.matrix); }
  bigInstanced.castShadow = true;
  root.add(bigInstanced);

  const stats = mergeStaticGeometry(root, { shadowFlags: (e) => landmarkQuality.landmarkShadowFlags(false, e) });
  assert.equal(stats.meshesBefore, 8);
  // 6 small meshes + 40 baked instances merge into one; the 1000-instance mesh is kept
  assert.equal(stats.meshesAfter, 2);
  assert.equal(stats.mergedMeshes, 1);
  assert.equal(stats.trianglesBefore, stats.trianglesAfter, 'baked instances keep every triangle');
  const merged = root.children.find((c) => c.isMesh && c.name.includes('merged'));
  assert.ok(merged);
  assert.equal(triCount(merged.geometry), (6 + 40) * 12);
  assert.equal(merged.castShadow, false, 'a merged ornament-only mesh is under 8 m and does not cast');
  assert.equal(merged.receiveShadow, false, 'under 2.5 m it does not sample shadows either');
  assert.ok(root.children.includes(bigInstanced), 'the large InstancedMesh stays one draw call, untouched');
  assert.equal(bigInstanced.count, 1000);
});

test('meshes with array materials, invisible meshes and single-mesh groups are left alone', () => {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const solo = meshOf(root, mat, 2, 2, 2, 0, 0, 0); // only mesh with this material
  const arrayMat = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [mat, new THREE.MeshStandardMaterial()]);
  root.add(arrayMat);
  const hidden = meshOf(root, new THREE.MeshStandardMaterial(), 1, 1, 1, 5, 0, 0);
  hidden.visible = false;
  const stats = mergeStaticGeometry(root);
  assert.equal(stats.meshesBefore, 2, 'only visible meshes are counted (the hidden one is left alone)');
  assert.equal(stats.meshesAfter, 2);
  assert.equal(stats.mergedMeshes, 0);
  assert.equal(root.children.length, 3, 'solo + array-material + hidden all stay in place');
  assert.ok(root.children.includes(solo) && root.children.includes(arrayMat) && root.children.includes(hidden));
  // without a shadowFlags policy the merged flags are the OR of the sources
  const root2 = new THREE.Group();
  const m2 = new THREE.MeshStandardMaterial();
  const a = meshOf(root2, m2, 1, 1, 1, 0, 0, 0); a.castShadow = false;
  const b = meshOf(root2, m2, 1, 1, 1, 3, 0, 0); b.castShadow = true;
  const s2 = mergeStaticGeometry(root2);
  const merged = root2.children.find((c) => c.isMesh);
  assert.equal(s2.mergedMeshes, 1);
  assert.equal(merged.castShadow, true, 'any source casting keeps the merged mesh casting');
});
