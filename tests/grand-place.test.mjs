import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
  assert.ok(source.includes('Grand-Place entrance sett strips (passerelles)'));
  assert.ok(source.includes('Grand-Place blue-stone sett border'));
  assert.ok(source.includes('new THREE.BoxGeometry(0.9, 0.08, 0.9), materials.pavingEdge, 420)'));
  assert.ok(source.includes('border.count = bd'));
  assert.ok(source.includes('Grand-Place entrance bollards'));
  assert.equal((source.match(/\[-55, -30, 1, 0\]|\[17, 36, 0, -1\]|\[55, 30, -1, 0\]|\[17, -36, 0, 1\]/g) || []).length, 4, 'entrance strips at the street mouths');
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

test('the Town Hall ogival portal has a double archivolt, five-statuette tympanum, jamb knights and corbels', () => {
  assert.ok(square.includes('Portal tympanum panel'));
  assert.ok(square.includes('Portal tympanum saint statues'));
  assert.ok(square.includes('new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 1.15, 0.14), materials.gold, 5)'));
  assert.ok(square.includes('tympanumSaints.count = saintIndex'));
  assert.ok(square.includes('Portal historiated corbels'));
  assert.ok(square.includes('Portal outer archivolt rib'));
  assert.ok(square.includes('Portal jamb knight niche'));
  assert.ok(square.includes('Portal jamb knight statue'));
});

test('the Town Hall upper-storey lancets carry twin-light tracery, oculi and keystones', () => {
  assert.ok(square.includes('Lancet mullion (twin-light tracery)'));
  assert.ok(square.includes('Lancet pair oculus (quatrefoil tracery)'));
  assert.ok(square.includes('Lancet keystone'));
  assert.ok(square.includes('new THREE.CylinderGeometry(0.34, 0.34, 0.16, 12).rotateX(Math.PI / 2)'));
  assert.ok(square.includes('lancetMullions.count = lancetOculi.count = lancetKeystones.count = traceryIndex'));
});

test('the tower lantern is openwork, with corner turrets and flying buttresses', () => {
  assert.ok(square.includes('Openwork octagonal lantern base'));
  assert.ok(square.includes('Open belfry slender pier'));
  assert.ok(square.includes('Belfry pointed arch rib'));
  assert.ok(square.includes('Tower gallery above the roofline'));
  assert.ok(square.includes('Lantern corner turret'));
  assert.ok(square.includes('Flying buttress'));
});

test('the spire apex carries a gilded orb and St Michael his raised sword', () => {
  assert.ok(square.includes("'Spire gilded orb finial'"));
  assert.ok(square.includes('new THREE.SphereGeometry(0.5, 12, 10), materials.gold, 0, 96.15, 0'));
  assert.ok(square.includes("'Saint Michael raised sword'"));
  assert.ok(square.includes("'Saint Michael dragon'"));
});

test('the Town Hall buttresses are pinnacled with spires and gilded finials', () => {
  assert.ok(square.includes("'Facade pinnacle spire'"));
  assert.ok(square.includes("'Facade pinnacle gilded finial'"));
  assert.ok(square.includes('new THREE.ConeGeometry(0.34, 1.9, 8), trim, bays / 2 + 1)'));
  assert.ok(square.includes('pinnacleSpires.count = pinnacleFinials.count = pin'));
});

test('the Town Hall facade carries the real statue niches and wing-terminating corner turrets', () => {
  assert.ok(square.includes('Town Hall facade statue niches'));
  assert.ok(square.includes('Town Hall gilded facade statues'));
  assert.ok(square.includes('Facade corner turret'));
  assert.ok(square.includes('Gothic facade buttress'));
});

test('the King’s House galleries carry arch keystones and oculi', () => {
  assert.ok(square.includes('gallery arch keystones'));
  assert.ok(square.includes('gallery oculi'));
  assert.ok(square.includes('new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12).rotateX(Math.PI / 2), trim, bays)'));
  assert.ok(square.includes('khKeystones.count = khK'));
  assert.ok(square.includes('khOculi.count = bays'));
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
  assert.ok(square.includes('King’s House Charles V statue'));
  assert.ok(square.includes('King’s House Virgin Mary statue'));
  assert.ok(square.includes('King’s House saint statue'));
});

test('guild-house cornices stand on a row of stone corbels (modillions)', () => {
  assert.ok(square.includes(" corbelled cornice modillions'"));
  assert.ok(square.includes('const modillionCount = Math.max(4, Math.round(width / 1.2))'));
  assert.ok(square.includes('modillions.count = modillionCount'));
  assert.ok(square.includes("box(root, width + 0.8, 0.65, depth + 0.4, 0, height - 0.35, -depth / 2, materials.gold, name + ' cornice')"));
});

test('guild-house corners are chained with rusticated quoins', () => {
  assert.ok(square.includes(" corner quoins'"));
  assert.ok(square.includes('const quoinRows = Math.max(3, Math.floor((height - 2.2) / 0.85))'));
  assert.ok(square.includes('quoins.count = q'));
  assert.ok(square.includes('new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.78, 0.3), materials.warmStone, quoinRows * 2)'));
});

test('guild-house gables are flanked by pots à feu (stone vase + flame)', () => {
  assert.ok(square.includes(" gable fire pot vase'"));
  assert.ok(square.includes(" gable fire pot flame'"));
  assert.ok(square.includes('new THREE.ConeGeometry(0.17, 0.5, 8), materials.gold, 2)'));
  assert.ok(square.includes('potVases.count = potFlames.count = 2'));
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

test('Le Paon wears the characteristic 18th-century neck gable (halsgevel)', () => {
  assert.ok(square.includes("style === 'neck'"));
  assert.ok(square.includes('shape.quadraticCurveTo(-w2, 3.2, -w2 + 1.8, 3.2)'));
  assert.ok(square.includes("Le Paon', x: -38, width: 12, height: 22, floors: 3, style: 'neck', stone: materials.paleStone }"));
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

test('terrace houses set out tables, chairs and parasols on the square', () => {
  for (const part of [' terrace table top', ' terrace table leg', ' terrace chair', ' terrace parasol pole', ' terrace parasol canopy']) {
    assert.ok(square.includes(part + "'"), `missing${part}`);
  }
  assert.ok(square.includes('chairs.count = t * 2'));
  assert.ok(square.includes('new THREE.ConeGeometry(0.95, 0.55, 8), materials.canvas, bays)'));
  assert.ok(square.includes('arcDummy.position.set(wx, 0.775, 2.4)'));
});

test('café awnings over the ground-floor arcades of the brasserie houses', () => {
  assert.ok(source.includes('canvas: new THREE.MeshStandardMaterial'));
  assert.ok(square.includes("café awnings"));
  assert.ok(square.includes('terrace = false'));
  assert.equal((square.match(/terrace: true\s*[,}]/g) || []).length, 6, 'six houses carry terraces');
});

test('the east frontage is the Maison des Ducs de Brabant: duke busts + Abundance', () => {
  assert.equal((square.match(/dukeBusts: true/g) || []).length, 3, 'all three east houses carry duke busts');
  assert.ok(square.includes(" Dukes of Brabant busts'"));
  assert.ok(square.includes(" duke bust discs'"));
  assert.ok(square.includes('bustDiscs.count = bustHeads.count = 6'));
  assert.ok(square.includes('abundance: true }'));
  assert.ok(square.includes(" Abundance allegory'"));
});

test('L’Arbre d’Or roof carries the gilded equestrian statue of Charles of Lorraine', () => {
  assert.ok(square.includes("L’Arbre d’Or', x: -18, width: 15, height: 22, style: 'stepped', stone: materials.ochre, terrace: true, equestrian: true }"));
  assert.ok(square.includes(" equestrian horse body'"));
  assert.ok(square.includes(" Charles of Lorraine rider'"));
  assert.ok(square.includes(" Charles of Lorraine rider head'"));
});

test('Le Cornet carries the gilded horn and anchor of the boatmen', () => {
  assert.ok(square.includes("emblem: 'horse', cornet: true }"));
  assert.ok(square.includes(" gilded horn'"));
  assert.ok(square.includes(" anchor shank'"));
  assert.ok(square.includes(" anchor stock'"));
  assert.ok(square.includes(" anchor arms'"));
  assert.ok(square.includes('new THREE.ConeGeometry(0.22, 0.8, 8), materials.gold'));
});

test('La Louve carries the Romulus-and-Remus she-wolf relief and the Apollo pediment', () => {
  assert.ok(square.includes('emblem: true, terrace: true, louve: true }'));
  assert.ok(square.includes(" Romulus and Remus relief panel'"));
  assert.ok(square.includes(" Romulus relief figure'"));
  assert.ok(square.includes(" Remus relief figure'"));
  assert.ok(square.includes(" she-wolf relief body'"));
  assert.ok(square.includes(" Apollo pediment'"));
  assert.ok(square.includes('materials.bronze'));
});

test('La Brouette carries St Giles in the gable niche, the wheelbarrow and Anno 1697 cartouches', () => {
  assert.ok(square.includes("La Brouette', x: 13.5, width: 8.5, height: 20, style: 'stepped', stone: materials.plaster, brouette: true }"));
  assert.ok(square.includes(" St Giles arched niche'"));
  assert.ok(square.includes(" St Giles statue'"));
  assert.ok(square.includes(" gilded wheelbarrow'"));
  assert.equal((square.match(/ Anno 1697 cartouche'/g) || []).length, 2, 'two Anno 1697 cartouches');
});

test('Le Sac carries the carpenter tool cartouches and the globe-compass finial', () => {
  assert.ok(square.includes("Le Sac', x: 4, width: 8.5, height: 22, style: 'gable', stone: materials.warmStone, guildTools: true }"));
  assert.ok(square.includes(" globe finial'"));
  assert.ok(square.includes(" compass needle N-S'"));
  assert.ok(square.includes(" carpenter tool cartouches'"));
  assert.ok(square.includes('toolCartouches.count = 3'));
});

test('Le Renard carries Justice with the four continents, St Nicholas and the fox sign', () => {
  assert.ok(square.includes("Le Renard', x: -24.5, width: 8.5, height: 20, style: 'gable', stone: materials.warmStone, continents: true }"));
  assert.ok(square.includes(" Justice and four continents statues'"));
  assert.ok(square.includes('continentStatues.count = 5'));
  assert.ok(square.includes(" St Nicholas gable statue body'"));
  assert.ok(square.includes(" fox sign body'"));
});

test('Le Roy d’Espagne carries Roman emperor medallions and the St Aubert bust', () => {
  assert.ok(square.includes('emblem: \'vane\', balustradeStatues: true, terrace: true, medallions: true }'));
  assert.ok(square.includes(" Roman emperor medallions'"));
  assert.ok(square.includes('new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20).rotateX(Math.PI / 2), materials.gold, 4)'));
  assert.ok(square.includes(" St Aubert bust'"));
  assert.ok(square.includes('medallions.count = 4'));
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

test('each street mouth carries a traditional blue enamel Brussels street sign', () => {
  assert.ok(source.includes('enamelBlue: new THREE.MeshStandardMaterial({ color: 0x1d4f91'));
  assert.ok(square.includes("'Brussels enamel street signs'"));
  assert.ok(square.includes("'Street sign posts'"));
  assert.ok(square.includes('new THREE.BoxGeometry(1.5, 0.42, 0.06), materials.enamelBlue, plaques.length)'));
  assert.ok(square.includes('signRims.count = signBoards.count = signPosts.count = sg'));
  assert.ok(square.includes('applyMatrix4(front.matrixWorld)'));
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

test('windows and arcades glow warm at night (floodlit square)', () => {
  assert.ok(source.includes('nightGlowMats'));
  assert.ok(source.includes('glowGlass'));
  assert.ok(source.includes('m.emissiveIntensity = level * 0.85'));
  assert.ok(source.includes('update(dt, night) { if (typeof night === \'number\') setNight(night); }'));
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.ok(main.includes('landmarks.update(dt, VEHICLE_UNIFORMS.night.value)'));
});

test('the snapshot camera frames the full Town Hall tower from the open square', () => {
  const snapshot = readFileSync(new URL('../snapshot-grand-place.html', import.meta.url), 'utf8');
  assert.match(snapshot, /centre\.y\+Math\.max\(52,size\.y\*\.55\)/);
  assert.match(snapshot, /centre\.z\+Math\.max\(150,size\.z\*2\.4\)/);
});

test('a wide full-square snapshot page frames plaza, facades, ground contact and tower', () => {
  const wide = readFileSync(new URL('../snapshot-grand-place-wide.html', import.meta.url), 'utf8');
  assert.ok(wide.includes('<title>Brussels — Grand-Place full-square wide snapshot</title>'));
  assert.ok(wide.includes('CircleGeometry(700,48)'), 'surrounding pavement ground plane for terrain context');
  assert.ok(wide.includes('new THREE.PerspectiveCamera(62'));
  assert.ok(wide.includes('camera.position.set(centre.x-12,centre.y+32,centre.z+180);'));
  assert.ok(wide.includes('camera.lookAt(centre.x+3,centre.y+24,centre.z-6);'));
  assert.ok(wide.includes('window.__snapshotFraming={x0,y0,x1,y1};'));
  assert.ok(wide.includes("getObjectByName('South frontage')"), 'tower-top framing point from the real south frontage');
  assert.ok(wide.includes('for (const x of [-55,55]) for (const z of [-36,36]) keys.push(new THREE.Vector3(x,0,z));'), 'plaza corners in the framing contract');
  assert.ok(wide.includes('for (const x of [-66,66]) for (const z of [52,-50]) keys.push(new THREE.Vector3(x,0,z));'), 'frontage footprint ground corners in the framing contract');
});

test('every snapshot page publishes readiness and a framing contract for the capture job', () => {
  for (const page of ['snapshot-grand-place.html', 'snapshot-grand-place-wide.html', 'snapshot-royal-palace.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.ok(html.includes('window.__snapshotReady=true'), `${page} signals readiness`);
    assert.ok(html.includes('window.__snapshotFraming'), `${page} exposes __snapshotFraming`);
  }
});

test('the capture job asserts a non-empty render and target framing, not just a green page', () => {
  const shot = readFileSync(new URL('../tools/shot.py', import.meta.url), 'utf8');
  assert.ok(shot.includes('from PIL import Image'));
  assert.ok(shot.includes('luminance stdev'), 'asserts the PNG is not a blank or flat frame');
  assert.ok(shot.includes('too few distinct colours'));
  assert.ok(shot.includes('min_coverage'), 'asserts the target landmark covers enough of the frame');
  assert.ok(shot.includes('require_full'), 'the wide snapshot asserts the whole square is in frame');
  assert.ok(shot.includes('__snapshotReady'), 'asserts the page finished building the scene');
  const wf = readFileSync(new URL('../.github/workflows/brussels-landmark-snapshots.yml', import.meta.url), 'utf8');
  assert.ok(wf.includes('"snapshot-grand-place-wide.html"'), 'workflow path trigger includes the wide page');
  assert.ok(wf.includes('pip install playwright pillow'), 'Pillow is installed for the render assertions');
  assert.ok(wf.includes('snapshot-grand-place.html artifacts/brussels-grand-place-town-hall.png 12 0.2'));
  assert.ok(wf.includes('snapshot-grand-place-wide.html artifacts/brussels-grand-place-wide.png 12 0.2 full'));
  assert.ok(wf.includes('snapshot-royal-palace.html artifacts/brussels-royal-palace.png 12 0.15'));
  assert.ok(wf.includes('artifacts/brussels-grand-place-wide.png'), 'the wide PNG is uploaded as an artifact');
});

test('the Royal Palace snapshot shows forecourt ground instead of blank sky', () => {
  const palace = readFileSync(new URL('../snapshot-royal-palace.html', import.meta.url), 'utf8');
  assert.ok(palace.includes('CircleGeometry(700,48)'), 'forecourt ground plane');
  assert.match(palace, /new THREE\.PerspectiveCamera\(36/);
  assert.match(palace, /centre\.z-Math\.max\(205,size\.z\*2\.6\)/);
  assert.match(palace, /centre\.z\+18\)/);
});

test('every workflow that runs tools/shot.py installs Pillow for its render assertions', () => {
  const workflows = readdirSync(new URL('../.github/workflows', import.meta.url)).filter(f => f.endsWith('.yml'));
  const runners = workflows.filter(f => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8').includes('tools/shot.py http'));
  assert.ok(runners.length >= 2, `expected the deploy and snapshots workflows to run shot.py, got ${runners}`);
  for (const f of runners) {
    const yml = readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8');
    assert.match(yml, /pip install[^\n]*pillow/, `${f} runs tools/shot.py but does not install pillow`);
  }
});
