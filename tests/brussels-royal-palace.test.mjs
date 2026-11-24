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

testCase('the front garden holds the real three sunken parterres (central on the portico axis, two lateral)', () => {
  assert.match(palace, /three sunken\s+parterres/);
  assert.equal((palace.match(/'Sunken parterre retaining edge'/g) || []).length, 3);
  assert.equal((palace.match(/'Sunken parterre lawn'/g) || []).length, 3);
  assert.equal((palace.match(/'Parterre flower band'/g) || []).length, 3);
  assert.match(palace, /\{ x: 0, w: 22, z: 12\.4, d: 2\.6 \}/);
  assert.match(palace, /\{ x: -38, w: 34, z: 12\.4, d: 2\.6 \}/);
  assert.match(palace, /\{ x: 38, w: 34, z: 12\.4, d: 2\.6 \}/);
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
