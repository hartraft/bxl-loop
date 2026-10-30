import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/brussels-landmarks.js', import.meta.url), 'utf8');

test('Grand-Place is modelled as a full pedestrian square, not a small generic pad', () => {
  assert.ok(source.includes('box(plaza, 108, 0.45, 66'));
  assert.ok(source.includes('Grand-Place pedestrian square'));
  assert.ok(source.includes('Grand-Place cobblestone courses'));
  assert.ok(source.includes('box(plaza, 108, 0.45, 66, 0, -0.225, 0'));
  assert.ok(source.includes('dummy.position.set(x, -0.06, z)'));
});

test('the Town Hall and its tower are distinct from the opposite Kings House', () => {
  assert.ok(source.includes('Brussels Town Hall (Hôtel de Ville)'));
  assert.ok(source.includes('Town Hall tower and openwork spire'));
  assert.ok(source.includes('Open belfry pier'));
  assert.ok(source.includes('Town Hall octagonal spire'));
  assert.ok(source.includes('King’s House (Maison du Roi / Broodhuis)'));
  assert.ok(source.includes('Gothic lancet window'));
});

test('guild-house rooflines and facade details are varied and instanced', () => {
  assert.ok(source.includes("style === 'stepped'"));
  assert.ok(source.includes("style === 'bell'"));
  assert.ok(source.includes("style = 'gable'"));
  assert.ok(source.includes("else {\n      shape.moveTo(-width / 2, 0)"));
  assert.ok(source.includes('new THREE.InstancedMesh'));
  assert.ok(source.includes('gilded window surrounds'));
});

test('the four frontages face the plaza', () => {
  assert.ok(source.includes('south.rotation.y = Math.PI'));
  assert.ok(source.includes('north.position.set(0, 0, -36)'));
  assert.ok(source.includes('west.rotation.y = Math.PI / 2'));
  assert.ok(source.includes('east.rotation.y = -Math.PI / 2'));
});
