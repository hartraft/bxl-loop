import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/brussels-landmarks.js', import.meta.url), 'utf8');

test('Grand-Place is modelled as a full pedestrian square, not a small generic pad', () => {
  assert.match(source, /box\(plaza, 108, 0\.45, 66/);
  assert.match(source, /Grand-Place pedestrian square/);
  assert.match(source, /Grand-Place cobblestone courses/);\n  assert.match(source, /box\\(plaza, 108, 0\\.45, 66, 0, -0\\.225, 0/);\n  assert.match(source, /dummy\\.position\\.set\\(x, -0\\.06, z\\)/);
});

test('the Town Hall and its tower are distinct from the opposite Kings House', () => {
  assert.match(source, /Brussels Town Hall \(Hôtel de Ville\)/);
  assert.match(source, /Town Hall tower and openwork spire/);
  assert.match(source, /Open belfry pier/);
  assert.match(source, /Town Hall octagonal spire/);
  assert.match(source, /King’s House \(Maison du Roi \/ Broodhuis\)/);
  assert.match(source, /Gothic lancet window/);
});

test('guild-house rooflines and facade details are varied and instanced', () => {
  assert.match(source, /style === 'stepped'/);
  assert.match(source, /style === 'bell'/);
  assert.match(source, /style = 'gable'/);\n  assert.match(source, /else \\{\\s*shape\\.moveTo\\(-width \\/ 2, 0\\)/);
  assert.match(source, /new THREE.InstancedMesh/);
  assert.match(source, /gilded window surrounds/);
});

test('the four frontages face the plaza and keep buildings outside the pedestrian footprint', () => {
  assert.match(source, /south\.rotation\.y = Math\.PI/);
  assert.match(source, /north\.position\.set\(0, 0, -36\)/);
  assert.match(source, /west\.rotation\.y = Math\.PI \/ 2/);
  assert.match(source, /east\.rotation\.y = -Math\.PI \/ 2/);
});
