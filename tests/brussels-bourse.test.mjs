import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import testCase from 'node:test';
import { BRUSSELS_LANDMARK_ANCHORS, BOURSE_ROTATION, brusselsToWorld } from '../js/brussels-frame.js';
import { BRUSSELS_LANDMARK_COLLIDER_LAYOUT, createBrusselsLandmarkColliders } from '../js/brussels-colliders.js';

const source = readFileSync(new URL('../js/brussels-landmarks.js', import.meta.url), 'utf8');
const start = source.indexOf("addLandmark('bourse'");
const end = source.indexOf("addLandmark('bourseSurroundings'", start);
const after = source.indexOf('scene?.add(group)', end);
assert.ok(start >= 0 && end > start && after > end, 'Bourse landmark builders must exist');
const bourse = source.slice(start, end);
const surroundings = source.slice(end, after);

testCase('the Bourse anchor is the OSM building centroid and the facade bearing is ~306 deg', () => {
  const a = BRUSSELS_LANDMARK_ANCHORS.bourse;
  assert.ok(Math.abs(a.lat - 50.84795) < 1e-6 && Math.abs(a.lon - 4.35043) < 1e-6, 'anchor = OSM way 13494623 centroid');
  assert.ok(BRUSSELS_LANDMARK_ANCHORS.bourseSurroundings.lat === a.lat && BRUSSELS_LANDMARK_ANCHORS.bourseSurroundings.lon === a.lon,
    'surroundings share the palace anchor like palaceSurroundings shares royalPalace');
  const bearing = Math.atan2(Math.sin(BOURSE_ROTATION), -Math.cos(BOURSE_ROTATION)); // rad from north of local +Z
  const deg = ((bearing * 180 / Math.PI) % 360 + 360) % 360;
  assert.ok(Math.abs(deg - 306) < 2, `facade normal bearing ${deg.toFixed(1)} deg should be ~306 deg (NW, facing Place de la Bourse)`);
  const p = brusselsToWorld(a.lat, a.lon);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
  assert.ok(Math.abs(p.x - -143) < 3 && Math.abs(p.z - -136) < 3, `anchor world pos ~(-143,-136), got (${p.x.toFixed(1)},${p.z.toFixed(1)})`);
  assert.match(source, /if \(id === 'bourse' \|\| id === 'bourseSurroundings'\) root\.rotation\.y = BOURSE_ROTATION/);
});

testCase('round 2: the socle is blue stone (petit granit) coursed in refends', () => {
  assert.match(bourse, /'Bourse blue-stone socle \(soubassement en pierre bleue\)'/);
  assert.match(bourse, /box\(g, 106, 5, 82, 0, 2\.5, 0, materials\.blueStone/);
  assert.match(bourse, /'Bourse socle refend joint grooves \(calcaire appareille en refends\)'/);
  assert.match(bourse, /refends\.count = 27/);
  assert.match(bourse, /'Bourse socle horizontal course groove'/);
});

testCase('round 3: the monumental stair climbs from the square to the peristyle', () => {
  assert.match(bourse, /'Bourse monumental stair treads \(escalier monumental\)'/);
  assert.match(bourse, /treads\.count = 20/);
  assert.match(bourse, /dummy\.position\.set\(0, i \* 0\.25 \+ 0\.125, 47\.6 - i \* 0\.7\)/);
  assert.match(bourse, /'Bourse stair west cheek wall'/);
  assert.match(bourse, /'Bourse stair east cheek wall'/);
  assert.match(bourse, /'Bourse stair top landing \(portico floor\)'/);
});

testCase('round 4: the peristyle is eight Corinthian columns on a stylobate', () => {
  assert.match(bourse, /'Bourse peristyle stylobate'/);
  assert.match(bourse, /const peristyleX = \[-18, -12\.86, -7\.71, -2\.57, 2\.57, 7\.71, 12\.86, 18\];/);
  assert.match(bourse, /for \(let i = 0; i < 8; i\+\+\) corinthColumn\(g, peristyleX\[i\], 5\.4, 36, 14, 0\.8/);
  assert.match(source, /function corinthColumn\(parent, x, y, z, h = 14, r = 0\.8, name = 'Corinthian column'\)/);
});

testCase('round 5: the cella wall has three doors, the central one arched in an aedicule', () => {
  assert.match(bourse, /'Bourse cella wall \(pierre blanche, neo-Renaissance\)'/);
  assert.match(bourse, /box\(g, 100, 15, 4, 0, 12\.5, 28, materials\.paleStone/);
  assert.match(bourse, /'Bourse central arched door'/);
  assert.match(bourse, /'Bourse central door arch'/);
  assert.match(bourse, /'Bourse central door keystone'/);
  assert.match(bourse, /'Bourse aedicule column west'/);
  assert.match(bourse, /'Bourse aedicule column east'/);
  assert.match(bourse, /'Bourse aedicule entablature over central door'/);
  assert.match(bourse, /'Bourse lateral door west'/);
  assert.match(bourse, /'Bourse lateral door east'/);
});

testCase('round 6: the entablature frieze carries a garland of flowers and fruits (Abundance)', () => {
  assert.match(bourse, /'Bourse entablature'/);
  assert.match(bourse, /'Bourse architrave band'/);
  assert.match(bourse, /'Bourse frieze garland of abundance - fruits \(guirlande de fruits\)'/);
  assert.match(bourse, /'Bourse frieze garland of abundance - flowers and leaves \(fleurs et feuilles\)'/);
  assert.match(bourse, /fruits\.count = 41/);
  assert.match(bourse, /leaves\.count = 41/);
  assert.match(bourse, /'Bourse cornice modillions \(consoles\)'/);
  assert.match(bourse, /modillions\.count = 52/);
});

testCase('round 7: triangular pediment dated 1873 with la Belgique + Commerce/Industrie geniuses, archivolt arms, clock, Bien/Mal', () => {
  assert.match(bourse, /pedimentPrism\(g, 38, 8\.5, 9, 0, 23\.5, 32\.5, materials\.paleStone, 'Bourse triangular pediment dated 1873'\)/);
  assert.match(bourse, /'Bourse tympanum la Belgique \(Joseph Jacquet\)'/);
  assert.match(bourse, /'Bourse tympanum genius ' \+ \(sx < 0 \? 'Commerce' : 'Industrie'\)/);
  assert.match(bourse, /'genius body'/);
  assert.match(bourse, /'genius wing'/);
  assert.match(bourse, /'Bourse archivolt arms of Brussels \(armes de Bruxelles\)'/);
  assert.match(bourse, /'Bourse central archivolt encircling the clock'/);
  assert.match(bourse, /'Bourse facade clock above the middle door'/);
  assert.match(bourse, /'Bourse Bien\/Mal winged figure \(De Haen\) ' \+ \(sx < 0 \? 'Bien' : 'Mal'\)/);
  assert.match(bourse, /'winged figure body'/);
  assert.match(bourse, /'winged figure wing'/);
  assert.match(bourse, /'Bourse pediment date plaque 1873'/);
});

testCase('round 8: Greek-cross arms, four corner pavilions, ajouree lateral arcades (Brunfaut)', () => {
  assert.match(bourse, /'Bourse front arm'/);
  assert.match(bourse, /'Bourse rear arm \(rue du Midi side\)'/);
  assert.match(bourse, /'Bourse west arm \(rue Henri Maus\)'/);
  assert.match(bourse, /'Bourse east arm \(rue de la Bourse\)'/);
  assert.match(bourse, /'Bourse central block'/);
  assert.match(bourse, /'Bourse corner pavilion'/);
  assert.match(bourse, /'Bourse corner pavilion pediment'/);
  assert.match(bourse, /'Bourse rear arm end pediment \(curved pediment with Asie\/Afrique groups by Van Rasbourg\/Rodin\)'/);
  assert.match(bourse, /'Bourse lateral facade round-arched arcades \(facades ajourees, Brunfaut 1892-1898\)'/);
  assert.match(bourse, /arcades\.count = n/);
});

testCase('round 9: dome on four piers with paired Corinthian pilasters, glazed since 1893, lantern + finial', () => {
  assert.match(bourse, /'Bourse dome pier'/);
  assert.match(bourse, /'Bourse dome drum on high socle'/);
  assert.match(bourse, /'Bourse dome richly ornamented entablature'/);
  assert.match(bourse, /mesh\(g, new THREE\.SphereGeometry\(14, 24, 12, 0, Math\.PI \* 2, 0, Math\.PI \/ 2\), materials\.glass, 0, 39\.6, 0, 'Bourse glazed dome \(verriere, curved glazing since 1893\)'\)/);
  assert.match(bourse, /'Bourse dome transversal arch ribs \(arcs transversaux\)'/);
  assert.match(bourse, /ribs\.count = 8/);
  assert.match(bourse, /cylinder\(g, 3\.8, 4\.6, 7, 0, 53, 0, materials\.paleStone, 16, 'Bourse circular lantern crowning the dome'\)/);
  assert.match(bourse, /'Bourse lantern top ornament \(finial\)'/);
});

testCase('round 10: Place de la Bourse paved square + pedestrian Boulevard Anspach with planters', () => {
  assert.match(surroundings, /'Place de la Bourse paved square \(repaved 2015\)'/);
  assert.match(surroundings, /box\(g, 130, 0\.35, 92, 0, -0\.175, 88, materials\.pavingA/);
  assert.match(surroundings, /'Place de la Bourse sett paving courses \(pavage\)'/);
  assert.match(surroundings, /setts\.count = n/);
  assert.match(surroundings, /'Place de la Bourse kerb at the stair foot'/);
  assert.match(surroundings, /'Place de la Bourse kerb at the boulevard'/);
  assert.match(surroundings, /'Boulevard Anspach pedestrian strip \(car-free since 29 June 2015\)'/);
  assert.match(surroundings, /'Boulevard Anspach embedded tree planters \(bacs encastres\)'/);
  assert.match(surroundings, /planters\.count = 12/);
  assert.match(surroundings, /'Boulevard Anspach planter trees \(verdure 200 m2 -> 3000 m2\)'/);
});

testCase('the Bourse registers world-space colliders and leaves the stair corridor open', () => {
  const anchor = brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.bourse.lat, BRUSSELS_LANDMARK_ANCHORS.bourse.lon);
  const colliders = createBrusselsLandmarkColliders('bourse', anchor, BOURSE_ROTATION, 0);
  assert.ok(colliders.length >= 20, 'socle edges, cella, 8 columns, arms, pavilions, drum, lions');
  for (const c of colliders) {
    assert.ok(c.minX <= c.maxX && c.minZ <= c.maxZ && Number.isFinite(c.maxY));
    assert.ok(Math.hypot(c.obb.cx - anchor.x, c.obb.cz - anchor.z) < 200, 'collider stays near the landmark');
  }
  const cos = Math.cos(BOURSE_ROTATION), sin = Math.sin(BOURSE_ROTATION);
  const corridor = { x: 0, z: 48, hx: 12, hz: 6 }; // the monumental stair approach on the square (outside the socle edge z=41)
  for (const c of colliders) {
    const dx = c.obb.cx - anchor.x, dz = c.obb.cz - anchor.z;
    const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    const overlap = Math.abs(lx - corridor.x) < c.obb.hx + corridor.hx - 1e-6 &&
      Math.abs(lz - corridor.z) < c.obb.hz + corridor.hz - 1e-6;
    assert.equal(overlap, false, 'no solid collider may cover the monumental stair corridor');
  }
  const sur = createBrusselsLandmarkColliders('bourseSurroundings', anchor, BOURSE_ROTATION, 0);
  assert.ok(sur.length >= 4, '1949 corner tower, 1884-85 blocks, Orts fountain + monument');
  assert.ok(BRUSSELS_LANDMARK_COLLIDER_LAYOUT.bourse && BRUSSELS_LANDMARK_COLLIDER_LAYOUT.bourseSurroundings);
});
