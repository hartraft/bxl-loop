import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import testCase from 'node:test';

const source = readFileSync(new URL('../js/brussels-landmarks.js', import.meta.url), 'utf8');
const start = source.indexOf("addLandmark('royalPalace'");
const end = source.indexOf("addLandmark('cathedral'", start);
assert.ok(start >= 0 && end > start, 'Royal Palace landmark builder must exist');
const palace = source.slice(start, end);

testCase('Royal Palace north façade follows the documented five-arch, six-pair column composition', () => {
  assert.match(palace, /Five open, full-height entrance arches/);
  assert.match(palace, /Six pairs of colossal Corinthian columns/);
  assert.match(palace, /for \(let i = 0; i < 6; i\+\+\)/);
  assert.match(palace, /Central open entrance arch/);
  assert.match(palace, /Corinthian capital volute/);
  assert.match(palace, /for \(const z of \[centralFace \+ 1\.55, centralFace \+ 4\.1\]\)/);
  assert.match(palace, /Central piano nobile French door/);
});

testCase('Royal Palace wings retain nine bays and three horizontal registers', () => {
  assert.match(palace, /for \(let i = 0; i < 9; i\+\+\)/);
  assert.match(palace, /Wing ground-floor arched opening/);
  assert.match(palace, /Wing French window/);
  assert.match(palace, /Wing first string course/);
  assert.match(palace, /Wing second string course/);
  assert.match(palace, /Wing sloping slate mansard/);
});

testCase('Royal Palace centre has a sculpted pediment, domed drum and Belgian flag', () => {
  assert.match(palace, /Palace sculpted triangular pediment/);
  assert.match(palace, /Dome drum oculus/);
  assert.match(palace, /Royal Palace flattened dome/);
  assert.match(palace, /Dome clock face/);
  assert.match(palace, /Belgian flag stripe/);
});

testCase('"Les Fleurs du Palais Royal" — eleven province pots line the central garden walk', () => {
  assert.match(palace, /Les Fleurs du Palais Royal/);
  assert.match(palace, /'Les Fleurs du Palais Royal pots'/);
  assert.match(palace, /'Les Fleurs du Palais Royal plantings'/);
  assert.match(palace, /pots\.count = plants\.count = pi/);
  assert.match(palace, /for \(let k = 0; k < 11; k\+\+\)/);
  assert.match(palace, /const px = -30 \+ k \* 6;/);
});

testCase('the front garden is enclosed by gilded railings with three gates on the parterre axes', () => {
  assert.match(palace, /grilles, portails et balustrades dor/);
  assert.match(palace, /'Garden enclosure stone plinth'/);
  assert.match(palace, /'Gilded garden railing top rail'/);
  assert.match(palace, /'Gilded garden railing mid rail'/);
  assert.match(palace, /for \(const gx of \[0, -38, 38\]\)/);
  assert.match(palace, /'Gilded gate stone pier'/);
  assert.match(palace, /'Gate pier gilded urn'/);
  assert.match(palace, /'Gilded garden gate leaf'/);
  assert.match(palace, /'Gilded gate baluster'/);
});

testCase('the front garden holds the real three sunken parterres (central on the portico axis, two lateral)', () => {
  assert.match(palace, /trois parterres/);
  assert.match(palace, /'Sunken parterre retaining edge'/);
  assert.match(palace, /'Sunken parterre lawn'/);
  assert.match(palace, /'Parterre flower band'/);
  assert.equal((palace.match(/\{ x: -?\d+(?:\.\d+)?, w: \d+, z: 12\.4, d: 2\.6 \}/g) || []).length, 4, 'parterre beds: central pair flanking the perron + two lateral');
  assert.match(palace, /\{ x: -13\.5, w: 9, z: 12\.4, d: 2\.6 \}/);
  assert.match(palace, /\{ x: 13\.5, w: 9, z: 12\.4, d: 2\.6 \}/);
  assert.match(palace, /\{ x: -38, w: 34, z: 12\.4, d: 2\.6 \}/);
  assert.match(palace, /\{ x: 38, w: 34, z: 12\.4, d: 2\.6 \}/);
});

testCase('stone cross-mullions (croisillons) divide every wing French window into panes', () => {
  assert.match(palace, /cross-mullions \(croisillons/);
  assert.match(palace, /'Palace window cross-mullions vertical'/);
  assert.match(palace, /'Palace window cross-mullions horizontal'/);
  assert.match(palace, /mullV\.count = mullH\.count = mi/);
  assert.match(palace, /facadeZ \+ 0\.26/);
});

testCase('the central attic carries the oval garlanded medallion struck with Leopold II monogram', () => {
  assert.match(palace, /struck with Leopold/);
  assert.match(palace, /'Leopold II monogram medallion'/);
  assert.match(palace, /'Leopold II monogram disc'/);
  assert.match(palace, /'Leopold II monogram L stem'/);
  assert.match(palace, /'Leopold II monogram L foot'/);
  assert.match(palace, /'Attic garland swag'/);
  assert.match(palace, /medallion\.scale\.set\(1\.3, 1, 1\)/);
});

testCase('the palace is floodlit at night: stone wash + glowing windows via the shared night systems', () => {
  assert.match(palace, /floodlit after dark/);
  assert.match(palace, /facadeWashMats\.push\(stone, ashlar, moulding\)/);
  assert.match(palace, /nightGlowMats\.push\(glass\)/);
});

testCase('each wing mansard carries the real nine oeil-de-boeuf dormer windows', () => {
  assert.match(palace, /nine oeil-de-boeuf/);
  assert.match(palace, /const bx = x - 24 \+ i \* 6;/);
  assert.match(palace, /'Wing oval oeil-de-boeuf surround'/);
  assert.match(palace, /'Wing oval roof window'/);
});

testCase("the north façade is white Euville limestone over a dark slate roof, as in the real building", () => {
  assert.match(palace, /white Euville limestone/);
  assert.match(palace, /color: 0xece4d3/);
  assert.match(palace, /color: 0xf2ead9/);
  assert.match(palace, /color: 0x4b555e/);
  assert.match(palace, /color: 0x2c3338/);
});

testCase("the palace wraps a southern quadrangle: rear wings and rear range close the Cour d'honneur", () => {
  assert.match(palace, /Cour d'honneur/);
  assert.match(palace, /'Palace rear wing \(Cour d’honneur\)'/);
  assert.match(palace, /'Rear wing cornice'/);
  assert.match(palace, /'Rear wing piano nobile window'/);
  assert.match(palace, /'Rear wing ground window'/);
  assert.match(palace, /'Palace rear range closing the Cour d’honneur'/);
  assert.match(palace, /'Rear range cornice'/);
  assert.match(palace, /box\(g, 102, 26, 12, 0, 5, -54, stone/);
});

testCase('a monumental perron (emmarchement) leads up to the central portico', () => {
  assert.match(palace, /emmarchement/);
  assert.match(palace, /'Portico perron step'/);
  assert.match(palace, /for \(let s = 0; s < 3; s\+\+\)/);
  assert.match(palace, /centralFace \+ 0\.3 \+ s \* 0\.62/);
});

testCase('the ground storey is a rusticated soubassement with bossage blocks on every arcade pier', () => {
  assert.match(palace, /rusticated soubassement/);
  assert.match(palace, /'Ground-floor rusticated bossage blocks'/);
  assert.match(palace, /bossage\.count = bgi/);
  assert.match(palace, /new THREE\.InstancedMesh\(new THREE\.BoxGeometry\(0\.52, 0\.62, 0\.16\), ashlar, 160\)/);
});

testCase("Suys' wrought-iron balcony parapet runs around the entire first floor", () => {
  assert.match(palace, /wrought-iron balcony parapet surrounds the ENTIRE first floor/);
  assert.match(palace, /'First-floor wrought-iron balcony rail'/);
  assert.match(palace, /'First-floor wrought-iron balusters'/);
  assert.match(palace, /ironRail\.count = ii/);
  assert.match(palace, /ironBalusters\.count = ib/);
  assert.match(palace, /Math\.abs\(x \+ 1\.2\) < 18 \? centralFace : facadeZ/);
});

testCase("the pediment tympanum carries Vinçotte's relief: Belgium flanked by Industry and Agriculture", () => {
  assert.match(palace, /Vin\u00e7otte's tympanum relief/);
  assert.match(palace, /'Industry relief hammer head'/);
  assert.match(palace, /'Industry relief gear'/);
  assert.match(palace, /'Agriculture relief sheaf binding'/);
  assert.match(palace, /'Agriculture relief sickle'/);
});

testCase('the colossal portico carries a full classical entablature (architrave, triglyph frieze, dentils, cornice)', () => {
  assert.match(palace, /'Portico architrave beam'/);
  assert.match(palace, /'Portico frieze triglyphs'/);
  assert.match(palace, /triglyphs\.count = ti/);
  assert.match(palace, /'Portico dentil course'/);
  assert.match(palace, /dentils\.count = di/);
  assert.match(palace, /'Portico cornice'/);
});

testCase('Royal Palace frontage spans the real ~160 m along the Place des Palais', () => {
  assert.match(palace, /The real frontage runs about 160 m along the Place des Palais/);
  assert.match(palace, /const wingW = 52, wingH = 20\.5, wingD = 19;/);
  assert.match(palace, /const wingXs = \[-44, 44\];/);
  assert.match(palace, /const bx = x - 22 \+ i \* 5\.5;/);
  assert.match(palace, /for \(const x of \[-76, 76\]\)/);
  assert.match(palace, /for \(let x = -74; x <= 74; x \+= 2\.4\)/);
});

testCase("Royal Palace snapshot camera faces the north façade (world -Z after the palace rotation)", () => {
  const snapshot = readFileSync(new URL('../snapshot-royal-palace.html', import.meta.url), 'utf8');
  assert.match(snapshot, /camera\.position\.set\(centre\.x\+[^,]+,.*centre\.z-Math\.max/);
});
