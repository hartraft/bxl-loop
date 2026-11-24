import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/brussels-landmarks.js', import.meta.url), 'utf8');
const start = source.indexOf('function guildHouse');
const end = source.indexOf("addLandmark('grandPlace'", start);
assert.ok(start >= 0 && end > start, 'Grand-Place builders must exist');
const square = source.slice(start, end);

test('the square is the real entirely paved, completely open Grand-Place', () => {
  assert.ok(source.includes('box(plaza, 110, 0.45, 72, 0, -0.225, 0'));
  assert.ok(source.includes('Grand-Place pedestrian square'));
  assert.ok(source.includes('Grand-Place cobblestone courses'));
  assert.ok(source.includes('dummy.position.set(x, -0.06, z)'));
  assert.ok(source.includes('110 x 68 metres and is paved edge-to-edge'));
  assert.ok(source.includes('for (let row = 0; row < 15; row++)'));
  assert.ok(source.includes('for (let col = 0; col < 16; col++)'));
  assert.ok(!source.includes('Historic square lantern'), 'the real square carries no corner lanterns');
  assert.ok(!source.includes('0.32, 0.42, 0.9'), 'the real square carries no bollards');
});

test('the Town Hall tower rises from the ground-level portal to the real 96 m', () => {
  assert.ok(square.includes('Brussels Town Hall (Hôtel de Ville)'));
  assert.ok(square.includes('Town Hall 96 m asymmetrical Gothic tower'));
  assert.ok(square.includes('tower.position.set(-8.5, 0, -depth / 2 + 4.5)'));
  assert.ok(square.includes('Town Hall 96 m tower square shaft'));
  assert.ok(square.includes('Town Hall main portal recess'));
  assert.ok(square.includes('Town Hall openwork pyramidal spire'));
  assert.ok(square.includes('Gilded openwork spire rib'));
  assert.ok(square.includes('Gilded Saint Michael figure'));
});

test('the tower lantern is openwork, with corner turrets and flying buttresses', () => {
  assert.ok(square.includes('Openwork octagonal lantern base'));
  assert.ok(square.includes('Open belfry slender pier'));
  assert.ok(square.includes('Belfry pointed arch rib'));
  assert.ok(square.includes('Tower gallery above the roofline'));
  assert.ok(square.includes('Lantern corner turret'));
  assert.ok(square.includes('Flying buttress'));
});

test('the Town Hall facade carries the real statue niches and wing-terminating corner turrets', () => {
  assert.ok(square.includes('Town Hall facade statue niches'));
  assert.ok(square.includes('Town Hall gilded facade statues'));
  assert.ok(square.includes('Facade corner turret'));
  assert.ok(square.includes('Gothic facade buttress'));
});

test("the King's House has Jamaer's two arcaded galleries and central tower", () => {
  assert.ok(square.includes('King’s House (Maison du Roi / Broodhuis)'));
  assert.ok(square.includes('King’s House ground gallery arch'));
  assert.ok(square.includes('First gallery balustrade'));
  assert.ok(square.includes('King’s House central tower'));
  assert.ok(square.includes('King’s House central stepped gable'));
});

test('guild houses carry the real names on the real sides, with Baroque detailing', () => {
  for (const name of ['Le Roy d’Espagne', 'La Brouette', 'Le Sac', 'La Louve', 'Le Cornet', 'Le Renard',
    'Le Heaume', 'Le Paon', 'Sainte-Barbe', 'Le Cerf', 'L’Ange', 'La Chaloupe d’Or',
    'L’Étoile', 'Le Cygne', 'L’Arbre d’Or', 'La Rose', 'Le Mont Thabor']) {
    assert.ok(square.includes(`Guild House – ${name}`), `missing guild house ${name}`);
  }
  assert.ok(square.includes(' pilasters'));
  assert.ok(square.includes(' balustrade parapet'));
  assert.ok(square.includes(' statue niches'));
  assert.ok(square.includes(' gilded statues'));
});

test('guild houses have the real arcaded ground floors and gilded gable emblems', () => {
  assert.ok(square.includes(' ground-floor arcade'));
  assert.ok(square.includes(' arcade lintel'));
  assert.ok(square.includes(' arcade string course'));
  assert.ok(square.includes("style === 'scroll'"));
  assert.ok(square.includes('shape.bezierCurveTo(-width / 2, 3.2'));
  assert.ok(square.includes(' gilded gable emblem'));
  assert.ok(square.includes('emblem: true'), 'La Louve, Le Cornet, Le Roy d’Espagne and others carry emblems');
  // window storeys start above the arcade
  assert.ok(square.includes('for (let floor = 1; floor <= floors; floor++)'));
  assert.ok(square.includes('const wy = 4.4 + (floor - 1)'));
});

test('guild-house rooflines stay varied and instanced', () => {
  assert.ok(source.includes("style === 'stepped'"));
  assert.ok(source.includes("style === 'bell'"));
  assert.ok(source.includes("style === 'scroll'"));
  assert.ok(source.includes("style = 'gable'"));
  assert.ok(source.includes('else {\n      shape.moveTo(-width / 2, 0)'));
  assert.ok(source.includes('new THREE.InstancedMesh'));
  assert.ok(source.includes('gilded window surrounds'));
});

test('the four frontages still face the plaza', () => {
  assert.ok(source.includes('south.rotation.y = Math.PI'));
  assert.ok(source.includes('north.position.set(0, 0, -36)'));
  assert.ok(source.includes('west.rotation.y = Math.PI / 2'));
  assert.ok(source.includes('east.rotation.y = -Math.PI / 2'));
});

test('the snapshot camera frames the full Town Hall tower from the open square', () => {
  const snapshot = readFileSync(new URL('../snapshot-grand-place.html', import.meta.url), 'utf8');
  assert.match(snapshot, /centre\.y\+Math\.max\(52,size\.y\*\.55\)/);
  assert.match(snapshot, /centre\.z\+Math\.max\(150,size\.z\*2\.4\)/);
});
