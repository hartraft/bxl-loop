import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRUSSELS_LANDMARK_COLLIDER_LAYOUT, createBrusselsLandmarkColliders } from '../js/brussels-colliders.js';
import { BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld } from '../js/brussels-frame.js';

// Real-world references for the Palais de Justice de Bruxelles (Joseph Poelaert, 1866-1883):
// - UNESCO tentative list 5357 (whc.unesco.org/en/tentativelists/5357/): hors tout 186 x 177 x 116 m,
//   plan 150 x 160 m, 26 000 m2 including eight inner courtyards, copper dome, square drum on a
//   stepped base with colonnades, circular drum with four bronze statues under triangular pediments.
// - Brussels heritage inventory, building 30442 (monument.heritage.brussels/fr/buildings/30442):
//   plan 150 x 160 m, eight cours interieures, bluestone (pierre bleue) soubassement, hipped
//   pavilion roofs on the corner pavilions, facades in pale stone with ochre/sable tones.
// - Regie des Batiments (regiedesbatiments.be): longitudinal axis 160 m, transverse axis 150 m,
//   245 rooms, main facade peristyle = double colonnade of Doric columns, full-width emmarchement,
//   two corner pavilions in strong projection housing the Courts of Cassation and Appeal.
// - fr.wikipedia.org/wiki/Palais_de_justice_de_Bruxelles: 105 m dome (24 000 t), raised 2.5 m in 1948,
//   gilded copper (275 m2 gold leaf), four 5.55 m bronze statues (Loi, Justice, Force, Clemence)
//   at the drum angles, eight gilded-copper griffins under the dome, bronze door by Houtstont
//   after Van Mansfeld (1896), bust of Poelaert by Cuypers (1887) left of the entrance,
//   winged lions by A.F. Boure on the porch's Corinthian columns, four marble statues of
//   Demosthenes, Lycurgus, Cicero and Ulpian at the foot of the grand stairs.
// - fr.wikipedia.org/wiki/Place_Poelaert: esplanade overlooking the lower city by 63 m, Monument
//   national a l'Infanterie Belge (bluestone obelisk, gilded crown, 1935), Monument aux soldats
//   britanniques (~3 m), bronze orientation table by A. Bouffiaux (1928), Poelaert elevators.

const source = readFileSync(new URL('../js/brussels-landmarks.js', import.meta.url), 'utf8');
const start = source.indexOf("addLandmark('palaisDeJustice'");
const end = source.indexOf("addLandmark('cinquantenaire'", start);
assert.ok(start >= 0 && end > start, 'the Palais de Justice builder must exist');
const palace = source.slice(start, end);

test('the landmark is anchored and rotated so the principal facade faces Place Poelaert to the north', () => {
  assert.ok(source.includes("if (id === 'palaisDeJustice') root.rotation.y = PALAIS_DE_JUSTICE_ROTATION;"));
  assert.ok(source.includes('monumental entrance faces Place Poelaert'));
  assert.ok(palace.includes('Palais de Justice (Joseph Poelaert, 1866'));
  assert.ok(palace.includes('BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lat'));
});

test('the plan keeps the real eight inner courtyards open between the ranges', () => {
  assert.ok(palace.includes('for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++)'));
  assert.ok(palace.includes("'Interior courthouse court paving'"));
  assert.ok(palace.includes("box(g, 24, 5.5, 0.45, x, 8.0, z + edge * 11, light, 'Court inner arcade')"));
  assert.ok(palace.includes("box(g, 0.45, 5.5, 22, x + edge * 12, 8.0, z, light, 'Court inner arcade')"), 'arcades on all four sides');
  assert.ok(palace.includes("'Court arcade opening'"));
});

test('the terrace rests on the visible retaining massif toward Wynants and Minimes', () => {
  assert.ok(palace.includes("'South massif retaining tier (rue de Wynants)'"));
  assert.ok(palace.includes("'South massif lower tier (rue de Wynants)'"));
  assert.ok(palace.includes("'West massif retaining tier (rue des Minimes)'"));
  assert.ok(palace.includes("'West massif lower tier (rue des Minimes)'"));
});

test('the whole researched silhouette is present after 30 rounds', () => {
  for (const name of [
    'Palais de Justice monumental podium', 'bluestone soubassement band',
    'South massif retaining tier (rue de Wynants)', 'West massif retaining tier (rue des Minimes)',
    'Monumental entrance stair (full-width emmarchement)', 'Doric abacus', 'Principal portico entablature',
    'Triangular principal pediment', 'Bronze entrance door (Houtstont after Van Mansfeld)',
    'Winged lion body (A.F. Boure)', 'Bust of architect Joseph Poelaert',
    'Jurist statue plinth', "Escalier d'honneur flight", 'Corner pavilion hipped roof (toit en pavillon)',
    'South portal pediment rue de Wynants', 'Interior courthouse court paving', 'Court inner arcade',
    'Salle des Pas Perdus central mass (48 x 22 m hall)', 'Stylobate cross arm north-south',
    'Square drum base a gradins lower tier', 'Drum angle statue plinth', 'Griffin body under dome',
    'Gilded copper courthouse dome', 'Courthouse lantern cap',
    'Place Poelaert esplanade paving', 'Infantry monument bluestone obelisk',
    'British monument plinth', 'Bronze orientation table (Bouffiaux 1928)'
  ]) {
    assert.ok(palace.includes(name), 'missing: ' + name);
  }
});

test('colliders match the final 160 x 150 m plan and cover the 116 m dome', () => {
  const layout = BRUSSELS_LANDMARK_COLLIDER_LAYOUT.palaisDeJustice;
  const rear = layout.find(c => c.name === 'rear range');
  assert.deepEqual([rear.x, rear.z, rear.hx, rear.hz], [0, -66.5, 80, 8.5]);
  const west = layout.find(c => c.name === 'west range');
  assert.deepEqual([west.x, west.z, west.hx, west.hz], [71.5, 0, 8.5, 58]);
  const drum = layout.find(c => c.name === 'dome drum');
  assert.ok(drum.maxY >= 116, 'dome collider covers the 116 m hors tout silhouette');
  assert.equal(layout.filter(c => c.name === 'corner pavilion').length, 4);
  // The principal stair corridor onto Place Poelaert stays open.
  const anchor = brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lat, BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lon);
  const colliders = createBrusselsLandmarkColliders('palaisDeJustice', anchor, Math.PI);
  const approach = { x: 0, z: 85, hx: 38, hz: 7 };
  const cos = Math.cos(Math.PI), sin = Math.sin(Math.PI);
  for (const c of colliders) {
    const dx = c.obb.cx - anchor.x, dz = c.obb.cz - anchor.z;
    const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    const overlap = Math.abs(lx - approach.x) < c.obb.hx + approach.hx - 1e-6 &&
      Math.abs(lz - approach.z) < c.obb.hz + approach.hz - 1e-6;
    assert.equal(overlap, false, 'stair corridor must stay open');
  }
});

test('the palace facades take the warm floodlight wash and the windows glow at night', () => {
  assert.ok(palace.includes('for (const m of [stone, light, weathered, ochre])'));
  assert.ok(palace.includes('facadeWashMats.push(m);'), 'floodlit facades after dark');
  assert.ok(palace.includes('nightGlowMats.push(recess);'), 'lit windows after dark');
});

test('the British soldiers monument and the Bouffiaux orientation table stand on the esplanade', () => {
  assert.ok(palace.includes("'British monument plinth'"));
  assert.ok(palace.includes("'British/Belgian soldier figure'"));
  assert.ok(palace.includes("'Bronze orientation table (Bouffiaux 1928)'"));
});

test('the Monument national a l\'Infanterie Belge stands on the esplanade', () => {
  assert.ok(palace.includes("'Infantry monument bluestone obelisk'"));
  assert.ok(palace.includes("'Gilded royal crown on obelisk'"));
  assert.ok(palace.includes("'Obelisk summit soldier'"));
  assert.ok(palace.includes("'Winged Victory body (Infantry monument)'"));
  assert.ok(palace.includes("'Infantry monument raised platform'"));
});

test('the esplanade retaining wall is split around the central stair corridor', () => {
  assert.ok(!palace.includes("box(g, 178, 1.8, 3, 0, 1.6, 90"), 'no full-width wall across the stair');
  assert.ok(palace.includes('box(g, 55, 1.8, 3, side * 65.5, 1.6, 90'), 'wall wings span x 38..93, matching the collider corridor');
  assert.ok(palace.includes("'Place Poelaert retaining wall ' + (side < 0 ? 'west' : 'east')"));
  const wings = BRUSSELS_LANDMARK_COLLIDER_LAYOUT.palaisDeJustice.filter(c => c.name.startsWith('north wall'));
  assert.equal(wings.length, 2);
  for (const w of wings) {
    assert.deepEqual([w.z, w.hz, w.maxY], [90, 1.5, 2.5], 'collider matches the rendered wall z-extent and height');
    assert.ok(Math.abs(Math.abs(w.x) - w.hx - 38) < 1e-9, 'collider inner edge at |x|=38, aligned with the wall opening');
  }
});

test('Place Poelaert is a vast paved esplanade with sett borders', () => {
  assert.ok(palace.includes("'Place Poelaert esplanade paving'"));
  assert.ok(palace.includes('box(g, 150, 0.3, 70, 0, 0.15, 126, materials.pavingA'));
  assert.ok((palace.match(/'Place Poelaert \w+ sett border'/g) || []).length === 3, 'south, north and side sett borders');
});

test('facades mix pale sandstone with ochre/sable avant-corps, not a uniform white', () => {
  assert.ok(palace.includes('const ochre = new THREE.MeshStandardMaterial({ color: 0xd3b98a, roughness: 0.88 })'));
  assert.ok(palace.includes("x, 20, z, ochre, 'Projecting courthouse corner pavilion'"));
  assert.ok(palace.includes("'South avant-corps rue de Wynants'"));
  assert.ok(palace.includes('const stone = new THREE.MeshStandardMaterial({ color: 0xc9bda8, roughness: 0.9 })'));
});

test('the soubassement is the real dark Belgian bluestone (pierre bleue)', () => {
  assert.ok(palace.includes('const bluestone = new THREE.MeshStandardMaterial({ color: 0x3d444c, roughness: 0.92 })'));
  assert.ok(palace.includes("'Palais de Justice bluestone soubassement band'"));
  assert.ok(palace.includes("'Range bluestone plinth'"));
  assert.ok((palace.match(/'North range bluestone plinth wing'/g) || []).length === 1, 'north plinth split around the porch');
});

test('the massing matches the real hors tout 186 x 177 m podium on the 160 x 150 m plan', () => {
  assert.ok(palace.includes("box(g, 186, 4.2, 177, 0, -1.0, 0, weathered, 'Palais de Justice monumental podium')"));
  assert.ok(palace.includes('terrainFoundationSkirt(g, g, brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lat, BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lon), 186, 177, -3.1'));
  assert.ok(palace.includes("box(g, 46, wingH, wingD, -57, wingY, 66.5, stone, 'North range west wing facing Place Poelaert')"));
  assert.ok(palace.includes("box(g, 46, wingH, wingD, 57, wingY, 66.5, stone, 'North range east wing facing Place Poelaert')"), 'porch opening |x|<34 cut through the north range');
  assert.ok(palace.includes("box(g, 160, wingH, wingD, 0, wingY, -66.5, stone, 'South range above Rue de Wynants')"));
  assert.ok(palace.includes("box(g, wingD, wingH, 116, 71.5, wingY, 0, stone, 'West range Rue des Minimes')"));
  assert.ok(palace.includes("box(g, wingD, wingH, 116, -71.5, wingY, 0, stone, 'East range Rue aux Laines')"));
  assert.ok(palace.includes('for (const x of [-66, 66]) for (const z of [-61.5, 64])'));
});

test('the west/east ranges carry the window rhythm and the south facade a pedimented portal', () => {
  assert.ok(palace.includes("'Side range lower window'"));
  assert.ok(palace.includes("'Side range paired pilaster'"));
  assert.ok(palace.includes("'South avant-corps rue de Wynants'"));
  assert.ok(palace.includes("'South portal pediment rue de Wynants'"));
  assert.ok(palace.includes("'South portal door rue de Wynants'"));
});

test('the side facades carry axial portals with peristyles and stairs on Minimes and aux Laines', () => {
  assert.ok(palace.includes("'Side entrance landing ' + street"));
  assert.ok(palace.includes("'Side axial portal ' + street"));
  assert.ok(palace.includes("'Side portal entablature ' + street"));
  assert.ok(palace.includes("const street = x > 0 ? 'rue des Minimes' : 'rue aux Laines';"));
  assert.ok(palace.includes('side * (84 + (6 - i) * 1.3)'), 'side stairs sit beside the side portals (~82 m), not double-offset');
  assert.ok(!palace.includes('x + side * (84'), 'no stair treads floating ~90 m beyond the facade');
});

test('the north and south ranges carry colossal paired pilasters, lintels and alternating pediments', () => {
  assert.ok(palace.includes("'Courthouse paired pilaster west'"));
  assert.ok(palace.includes("'Courthouse paired pilaster east'"));
  assert.ok(palace.includes("'Upper window lintel'"));
  assert.ok(palace.includes("'Alternating window pediment'"));
  assert.ok(palace.includes('if (side > 0 && Math.abs(x) < 30) continue;'), 'porch zone stays clear of windows');
});

test('twin escaliers d\'honneur flank the porch up to the corner pavilions', () => {
  assert.ok(palace.includes("\"Escalier d'honneur flight\""));
  assert.ok(palace.includes('for (let step = 0; step < 16; step++)'));
  assert.ok(palace.includes('100 - step * 1.6'), 'flight reaches down to the forecourt, not floating');
  assert.ok(palace.includes('0.53 + step * 1.15'), 'lowest tread seated on the esplanade paving (y=0.30)');
  assert.ok(palace.includes("'Honour stair landing at corner pavilion'"));
});

test('the porch holds the bronze door, Boure winged lions and the Poelaert bust', () => {
  assert.ok(palace.includes("'Bronze entrance door (Houtstont after Van Mansfeld)'"));
  assert.ok(palace.includes("'Winged lion body (A.F. Boure)'"));
  assert.ok(palace.includes("'Winged lion wing'"));
  assert.ok(palace.includes("'Corinthian capital'"));
  assert.ok(palace.includes("'Bust of architect Joseph Poelaert'"));
  assert.ok(palace.includes("'Poelaert bust pedestal (Cuypers 1887)'"));
});

test('four monumental marble jurist statues stand at the foot of the grand stairs', () => {
  assert.ok(palace.includes("'Jurist statue plinth'"));
  assert.ok(palace.includes('const marble = new THREE.MeshStandardMaterial({ color: 0xe6deca, roughness: 0.7 })'));
  for (const figure of ['Demosthenes', 'Lycurgus', 'Cicero', 'Ulpian']) {
    assert.ok(palace.includes(`'${figure}', `), figure + ' named on the west/east stair sides');
  }
  assert.ok(palace.includes("figure + ' statue head'"));
  assert.ok(palace.includes("figure + ' statue arm'"));
});

test('the four corner pavilions carry hipped pavilion roofs and the north pair projects past the facade', () => {
  assert.ok(palace.includes("'Corner pavilion hipped roof (toit en pavillon)'"));
  assert.ok(palace.includes('new THREE.ConeGeometry(21, 6.5, 4), slate'));
  assert.ok(palace.includes('const zinc = new THREE.MeshStandardMaterial({ color: 0x6d7276, roughness: 0.6, metalness: 0.35 })'));
  assert.ok((palace.match(/'Range zinc roof'/g) || []).length === 2, 'zinc roofs on all four ranges');
  assert.ok(palace.includes("'Transverse gallery zinc roof'"));
  assert.ok(palace.includes('const north = z > 0;'), 'north pavilions flank the porch in forte saillie');
  assert.ok(!palace.includes("'Corner pavilion roof'"), 'no flat roof boxes remain');
});

test('the monumental dome stack exists: square drum, circular drum, copper dome, lantern', () => {
  assert.ok(palace.includes("box(g, 56, 42, 22, 0, 27, 0, light, 'Salle des Pas Perdus central mass (48 x 22 m hall)')"), 'hall footprint (z ±11) stays clear of the court arcades (z ±13)');
  assert.ok(palace.includes('const z = -24 + row * 48;'), 'court rows at z ±24, clear of the hall');
  assert.ok(palace.includes("'Courthouse transverse gallery wing'"), 'z=0 gallery split around the hall');
  assert.ok(palace.includes('for (const z of [-39, 39])'), 'gallery runs at z=±39 stay clear of the court outer arcades at z=±35');
  assert.ok(palace.includes("'Square drum base a gradins lower tier'"), 'first drum on a stepped base');
  assert.ok(palace.includes("'Square drum base a gradins upper tier'"));
  assert.ok(palace.includes("'Square dome drum corner pier'"));
  assert.ok(palace.includes("'Square dome drum top ring'"));
  assert.ok(palace.includes("const drumStatues = ['Loi', 'Justice', 'Force', 'Clemence'];"), 'four bronze allegories at the drum angles');
  assert.ok(palace.includes("'Drum angle statue plinth'"));
  assert.ok(palace.includes('const gilded = new THREE.MeshStandardMaterial({ color: 0xc9973f, metalness: 0.62, roughness: 0.38 })'), 'gilded copper');
  assert.ok(palace.includes("'Griffin body under dome'"), 'eight griffins under the dome');
  assert.ok(palace.includes("'Griffin wing under dome'"));
  assert.ok(palace.includes('Math.cos(a) * 20.3'), 'griffins stand outside the drum wall (r=19.5) on the cornice ledge');
  assert.ok(palace.includes('cylinder(g, 21, 21.5, 1.5, 0, 69, 0, weathered, 32)'), 'circular cornice ledge');
  assert.ok(palace.includes("drumStatues[k] + ' drum statue pediment'"), 'each under a triangular pediment');
  assert.ok(palace.includes('cylinder(g, 0.6, 0.85, 5.55, x, 90.0, z, bronze, 10)'), '5.55 m statues');
  assert.ok(palace.includes("'Stylobate cross arm north-south'"), 'Greek-cross stylobate');
  assert.ok(palace.includes("'Stylobate paired pilaster'"));
  assert.ok(palace.includes("'Gilded copper courthouse dome'"), '275 m2 of gold leaf over the copper dome');
  assert.ok(palace.includes('domeGeom.scale(1, 1.06, 1)'), 'bombe profile of the 1948 raising');
  assert.ok(palace.includes("'Gilded dome rib'"));
  assert.ok(palace.includes("'Courthouse lantern cap'"));
  assert.ok(palace.includes('cylinder(g, 0.18, 0.3, 0.8, 0, 115.8, 0, gilded, 8)'), 'silhouette tops at 116 m hors tout');
  assert.ok(!palace.includes('0.22, 0.35, 5.5'), 'no Eurovision antenna (removed 2002)');
});

test('the Place Poelaert front carries the monumental stair and the double-colonnade peristyle', () => {
  assert.ok(palace.includes("'Monumental entrance stair (full-width emmarchement)'"));
  assert.ok(palace.includes('for (let step = 0; step < 12; step++)'), 'the emmarchement runs the full width of the portico');
  assert.ok(palace.includes('95 - step * 0.6'), 'the flight stops at the terrace north edge (z=88), not inside it');
  assert.ok(palace.includes("box(g, 60, 1.2, 8.5, 0, 0.9, 99.75, weathered, 'Place Poelaert forecourt landing')"), 'landing stays clear of the first treads');
  assert.ok(!palace.includes('box(g, 60, 1.2, 16, 0, 0.9, 96'), 'no landing overlapping the stair flight');
  assert.ok(palace.includes("'Principal portico entablature'"));
  assert.ok(palace.includes("'Portico architrave'"));
  assert.ok(palace.includes("'Doric abacus'"), 'Doric order: echinus + square abacus');
  assert.ok(palace.includes('for (const z of [70, 78])'), 'double colonnade of Doric columns');
  assert.ok(palace.includes("'Triangular principal pediment'"));
  assert.ok(palace.includes("'Pediment crest figure head'"), 'sculptural crest on the pediment apex');
  assert.ok(palace.includes("'Portico attic'"));
  assert.ok(palace.includes("box(g, 160, 1.3, 3.0, 0, 34, 75.2, light, 'North façade entablature')"));
  assert.ok(palace.includes("'North façade balustrade'"));
});
