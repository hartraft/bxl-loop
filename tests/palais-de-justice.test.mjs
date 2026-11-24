import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  assert.ok(source.includes("if (id === 'palaisDeJustice') root.rotation.y = Math.PI;"));
  assert.ok(source.includes('monumental entrance faces Place Poelaert to the north'));
  assert.ok(palace.includes('Palais de Justice (Joseph Poelaert, 1866'));
  assert.ok(palace.includes('BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lat'));
});

test('the plan keeps the real eight inner courtyards open between the ranges', () => {
  assert.ok(palace.includes('for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++)'));
  assert.ok(palace.includes("'Interior courthouse court paving'"));
  assert.ok(palace.includes("'Court inner arcade'"));
});

test('the terrace rests on the visible retaining massif toward Wynants and Minimes', () => {
  assert.ok(palace.includes("'South massif retaining tier (rue de Wynants)'"));
  assert.ok(palace.includes("'South massif lower tier (rue de Wynants)'"));
  assert.ok(palace.includes("'West massif retaining tier (rue des Minimes)'"));
  assert.ok(palace.includes("'West massif lower tier (rue des Minimes)'"));
});

test('the soubassement is the real dark Belgian bluestone (pierre bleue)', () => {
  assert.ok(palace.includes('const bluestone = new THREE.MeshStandardMaterial({ color: 0x3d444c, roughness: 0.92 })'));
  assert.ok(palace.includes("'Palais de Justice bluestone soubassement band'"));
  assert.ok((palace.match(/'Range bluestone plinth'/g) || []).length === 2);
});

test('the massing matches the real hors tout 186 x 177 m podium on the 160 x 150 m plan', () => {
  assert.ok(palace.includes("box(g, 186, 4.2, 177, 0, -1.0, 0, weathered, 'Palais de Justice monumental podium')"));
  assert.ok(palace.includes('terrainFoundationSkirt(g, g, brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lat, BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lon), 186, 177, -3.1'));
  assert.ok(palace.includes("box(g, 160, wingH, wingD, 0, wingY, 66.5, stone, 'North range facing Place Poelaert')"));
  assert.ok(palace.includes("box(g, 160, wingH, wingD, 0, wingY, -66.5, stone, 'South range above Rue de Wynants')"));
  assert.ok(palace.includes("box(g, wingD, wingH, 116, 71.5, wingY, 0, stone, 'West range Rue des Minimes')"));
  assert.ok(palace.includes("box(g, wingD, wingH, 116, -71.5, wingY, 0, stone, 'East range Rue aux Laines')"));
  assert.ok(palace.includes('for (const x of [-66, 66]) for (const z of [-61.5, 61.5])'));
});

test('the monumental dome stack exists: square drum, circular drum, copper dome, lantern', () => {
  assert.ok(palace.includes("'Salle des Pas Perdus central mass'"));
  assert.ok(palace.includes("'Square dome drum'"));
  assert.ok(palace.includes("'Copper courthouse dome'"));
  assert.ok(palace.includes("'Courthouse lantern cap'"));
});

test('the Place Poelaert front carries the monumental stair and the double-colonnade peristyle', () => {
  assert.ok(palace.includes("'Monumental entrance stair (full-width emmarchement)'"));
  assert.ok(palace.includes('for (let step = 0; step < 14; step++)'), 'the emmarchement runs the full width of the portico');
  assert.ok(palace.includes("'Principal portico entablature'"));
  assert.ok(palace.includes("'Portico architrave'"));
  assert.ok(palace.includes("'Doric abacus'"), 'Doric order: echinus + square abacus');
  assert.ok(palace.includes('for (const z of [70, 78])'), 'double colonnade of Doric columns');
  assert.ok(palace.includes("'Triangular principal pediment'"));
});
