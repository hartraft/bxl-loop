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
  assert.ok(square.includes('tower.position.set(towerX, 0, -depth / 2 + 4.5)'));
  assert.ok(square.includes('Town Hall 96 m tower square shaft'));
  assert.ok(square.includes('Town Hall main portal recess'));
  assert.ok(square.includes('Openwork spire stone rib'), 'the spire is openwork ribs, not a solid cone');
  assert.ok(!square.includes('ConeGeometry(3.8, 15.2, 8)'), 'no solid spire cone');
  assert.ok(square.includes('Spire gilded ring armature'));
  assert.ok(square.includes('Gilded Saint Michael figure'));
  assert.ok(square.includes('Saint Michael dragon'));
});

test('the Town Hall carries gargoyles on the buttresses and eight per turret level', () => {
  assert.ok(square.includes('Town Hall facade gargoyles'));
  assert.ok(square.includes('Tower turret gargoyles'));
  assert.ok(square.includes('for (let i = 0; i < 8; i++)'));
});

test('the Town Hall is two genuinely asymmetrical wings with prophets above the portal', () => {
  assert.ok(square.includes('Town Hall east wing (1401-1421)'));
  assert.ok(square.includes('Town Hall west wing (1444+)'));
  assert.ok(square.includes('const towerX = -8.5'));
  assert.ok(square.includes('Portal prophet niche'));
  assert.ok(square.includes('Portal prophet gilded figure'));
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

test("the King's House matches Jamaer's measured Broodhuis: 30.78 m facade, 20.21 m high, 38.49 m tower", () => {
  assert.ok(square.includes('King’s House (Maison du Roi / Broodhuis)'));
  assert.ok(square.includes('const width = 31, height = 20.5, depth = 13'));
  assert.ok(square.includes('King’s House ground gallery arch'));
  assert.ok(square.includes('First gallery balustrade'));
  assert.ok(square.includes('King’s House central stepped gable'));
  assert.ok(square.includes('King’s House central tower square shaft'));
  assert.ok(square.includes('King’s House central tower octagonal top'));
  assert.ok(square.includes('King’s House tower domed slate spire'));
  assert.ok(square.includes('King’s House standard-bearer statue'));
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
  // gable oculus and window pediments
  assert.ok(square.includes(' gable oculus'));
  assert.ok(square.includes(' window pediments'));
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

test('signature house emblems: Le Cornet horse, Le Roy d’Espagne cupola-vane and six statues', () => {
  assert.ok(square.includes("emblem: 'horse'"));
  assert.ok(square.includes("emblem: 'vane'"));
  assert.ok(square.includes('balustradeStatues: true'));
  assert.ok(square.includes(' gilded horse body'));
  assert.ok(square.includes(' gilded weather vane'));
  assert.ok(square.includes(' balustrade statue'));
  assert.ok(square.includes("? 'phoenix' : emblem"));
});

test('houses wear their real facade colours: ochre and plaster alongside the stone tones', () => {
  assert.ok(source.includes('ochre: new THREE.MeshStandardMaterial'));
  assert.ok(source.includes('plaster: new THREE.MeshStandardMaterial'));
  assert.ok(square.includes("Le Cornet', x: -15, width: 8.5, height: 21, style: 'scroll', stone: materials.ochre"));
  assert.ok(square.includes("La Louve', x: -5.5, width: 8.5, height: 23, floors: 3, style: 'scroll', stone: materials.ochre"));
  assert.ok(square.includes("La Chaloupe d’Or', x: 46.5, width: 11, height: 24, style: 'bell', stone: materials.ochre"));
  assert.ok(square.includes("L’Arbre d’Or', x: -18, width: 15, height: 22, style: 'stepped', stone: materials.ochre"));
  assert.ok(square.includes("Le Roy d’Espagne', x: 23, width: 8.5, height: 24, floors: 4, style: 'bell', stone: materials.plaster"));
  assert.ok(square.includes("Le Cygne', x: -44, width: 12, height: 23, floors: 4, style: 'bell', stone: materials.plaster"));
});

test('the seven real street mouths stay open, each with its bronze UNESCO plaque', () => {
  assert.ok(square.includes('UNESCO entrance plaque – ${street}'));
  for (const street of ['Rue au Beurre', 'Rue de la Tête d’or', 'Rue des Chapeliers', 'Rue Charles Buls', 'Rue de la Colline', 'Rue d’Arenberg', 'Rue Chair et Pain']) {
    assert.ok(square.includes(`'${street}'`), `missing plaque street ${street}`);
  }
  assert.equal((square.match(/\[west,|\[south,|\[east,|\[north,/g) || []).length, 7, 'exactly seven entrance plaques');
  assert.ok(square.includes('materials.bronze'));
  // west frontage leaves gaps at both ends for Rue au Beurre (north) and Rue de la Tête d'or (south)
  assert.ok(square.includes("x: 23, width: 8.5"));
  assert.ok(square.includes("x: -24.5, width: 8.5"));
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
