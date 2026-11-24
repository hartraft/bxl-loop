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
  assert.match(bourse, /new THREE\.InstancedMesh\(new THREE\.BoxGeometry\(3\.4, 9, 0\.5\), materials\.dark, 48\)/, 'arcades allocation must cover all 48 instances (smoke-found bug)');
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

testCase('rounds 11-12: front avant-corps pavilions with pediments + wing windows with surrounds', () => {
  assert.match(bourse, /'Bourse front avant-corps pavilion ' \+ \(sx < 0 \? 'west' : 'east'\)/);
  assert.match(bourse, /'Bourse avant-corps pavilion pediment'/);
  assert.match(bourse, /box\(g, 16, 21, 15, sx \* 44, 15\.5, 33\.5, materials\.paleStone/);
  assert.match(bourse, /'Bourse facade windows \(rez-de-chaussee \+ etage\)'/);
  assert.match(bourse, /wins\.count = n/);
  assert.match(bourse, /'Bourse facade window stone surrounds'/);
});

testCase('rounds 13-14: quoin chains + string courses', () => {
  assert.match(bourse, /'Bourse facade corner quoin chains \(chaines d\\'angle\)'/);
  assert.match(bourse, /quoins\.count = q/);
  assert.match(bourse, /'Bourse facade first string course \(bandeau\)'/);
  assert.match(bourse, /'Bourse facade second string course \(bandeau\)'/);
});

testCase('rounds 15-17: cornice dentils, lion-mouth dripstones, frieze palmettes', () => {
  assert.match(bourse, /'Bourse main cornice dentils'/);
  assert.match(bourse, /dentils\.count = 100/);
  assert.match(bourse, /'Bourse cornice lion-mouth dripstones \(mufles de lion\)'/);
  assert.match(bourse, /mufles\.count = 26/);
  assert.match(bourse, /'Bourse frieze palmettes \(palmettes\)'/);
  assert.match(bourse, /palmettes\.count = 20/);
});

testCase('rounds 18-20: pediment raking cornice + acroteria, column fluting, base torus rings', () => {
  assert.match(bourse, /'Bourse pediment raking cornice'/);
  assert.match(bourse, /'Bourse pediment acroteria \(acroteres\)'/);
  assert.match(bourse, /acro\.count = 3/);
  assert.match(bourse, /'Bourse peristyle column fluting \(futs canneles, 12 per column\)'/);
  assert.match(bourse, /flutes\.count = f/);
  assert.match(bourse, /'Bourse peristyle column base torus rings'/);
  assert.match(bourse, /tori\.count = 8/);
});

testCase('rounds 21-23: lion pedestals, bull/bear lions (Jaquet brothers), torch geniuses', () => {
  assert.match(bourse, /'Bourse lion pedestal'/);
  assert.match(bourse, /'Bourse lion pedestal moulded cap'/);
  assert.match(bourse, /'Bourse stair lion BULL \(head raised, Jean-Joseph Jaquet\)'/);
  assert.match(bourse, /'Bourse stair lion BEAR \(head bowed, Jacques Jaquet\)'/);
  assert.match(bourse, /'bull lion head raised'/);
  assert.match(bourse, /'bear lion head bowed'/);
  assert.match(bourse, /'Bourse torch genius leading the '/);
  assert.match(bourse, /'torch flame'/);
});

testCase('rounds 24-25: De Groot allegories (Art/Agriculture/Industrie/Science) + Carrier-Belleuse putti frieze', () => {
  assert.match(bourse, /const names = \['Art', 'Agriculture', 'Industrie', 'Science'\];/);
  assert.match(bourse, /fig\.name = 'Bourse allegory ' \+ names\[i\] \+ ' \(Guillaume De Groot\)'/);
  assert.match(bourse, /'Bourse Carrier-Belleuse putti frieze heads \(Rodin contribution\)'/);
  assert.match(bourse, /putti\.count = 8/);
  assert.match(bourse, /'Bourse Carrier-Belleuse putti frieze bodies'/);
});

testCase('rounds 26-30: clock ring/boss, Brussels arms cross, tympanum panel, door leaves+studs, cella arched windows', () => {
  assert.match(bourse, /'Bourse clock minute ring'/);
  assert.match(bourse, /'Bourse clock centre boss'/);
  assert.match(bourse, /'Bourse shield cross vertical \(armes de Bruxelles\)'/);
  assert.match(bourse, /'Bourse tympanum relief panel'/);
  assert.match(bourse, /'Bourse central door double leaves \(bois, panneaux\)'/);
  assert.match(bourse, /leaves\.count = 2/);
  assert.match(bourse, /'Bourse lateral door iron studs \(clous\)'/);
  assert.match(bourse, /studs\.count = s/);
  assert.match(bourse, /'Bourse cella arched window'/);
  assert.match(bourse, /'Bourse cella window transom bar'/);
});

testCase('rounds 31-34: slate gable roofs on the arms, dormers, chimney stacks, hipped pavilion roofs', () => {
  assert.match(bourse, /'Bourse front arm slate gable roof'/);
  assert.match(bourse, /'Bourse rear arm slate gable roof \(rue du Midi\)'/);
  assert.match(bourse, /'Bourse west arm slate gable roof \(rue Henri Maus\)'/);
  assert.match(bourse, /westRoof\.rotation\.y = Math\.PI \/ 2/);
  assert.match(bourse, /'Bourse arm roof dormers \(lucarnes\)'/);
  assert.match(bourse, /dormers\.count = d2/);
  assert.match(bourse, /'Bourse chimney stacks'/);
  assert.match(bourse, /stacks\.count = 6/);
  assert.match(bourse, /'Bourse corner pavilion hipped slate roof'/);
  assert.match(bourse, /'Bourse pavilion roof finial'/);
});

testCase('rounds 35-37: rear curved pediment Asie/Afrique groups, four Rodin/Van Rasbourgh caryatids, globe + putti', () => {
  assert.match(bourse, /grp\.name = 'Bourse rear pediment group ' \+ \(sx < 0 \? 'L\\'Asie' : 'L\\'Afrique'\) \+ ' \(Van Rasbourg\/Rodin 1871\)'/);
  assert.match(bourse, /const names = \['Protection', 'Commerce', 'Art', 'Victoire'\];/);
  assert.match(bourse, /c\.name = 'Bourse caryatid ' \+ names\[i\] \+ ' \(Rodin design, Van Rasbourgh\)'/);
  assert.match(bourse, /'Bourse globe above the caryatids'/);
  assert.match(bourse, /'Bourse putti carrying the globe '/);
});

testCase('rounds 38-40: side ajouree great arches, roof terrace balustrade, brass panorama canopy', () => {
  assert.match(bourse, /'Bourse side facade central ajouree great arches \(Brunfaut 1890-93 \/ 1930-50\)'/);
  assert.match(bourse, /great\.count = n/);
  assert.match(bourse, /'Bourse toiture-terrasse slab \(roof terrace, 2023\)'/);
  assert.match(bourse, /'Bourse roof terrace balustrade posts'/);
  assert.match(bourse, /posts\.count = p/);
  assert.match(bourse, /'Bourse brass canopy over the panorama bar \(luifel, 2023\)'/);
  assert.match(bourse, /'Bourse brass canopy rib'/);
});

testCase('rounds 41-42: 2023 entrance cut into the blue-stone socle, black granito + gilded brass', () => {
  assert.match(bourse, /'Bourse 2023 entrance recess in the blue-stone socle \(granito noir\)'/);
  assert.match(bourse, /'Bourse 2023 entrance gilded brass lintel'/);
  assert.match(bourse, /'Bourse 2023 entrance brass jamb west'/);
  assert.match(bourse, /'Bourse 2023 entrance granito floor'/);
  assert.match(bourse, /'Bourse 2023 entrance brass threshold'/);
});

testCase('rounds 43-45: socle utility doors with straight lintels, iron grilles, water-table moulding', () => {
  assert.match(bourse, /'Bourse socle utility doors \(portes a linteau droit\)'/);
  assert.match(bourse, /doors\.count = 8/);
  assert.match(bourse, /'Bourse socle basement window iron grilles \(grilles en fer forge\)'/);
  assert.match(bourse, /grilles\.count = 8/);
  assert.match(bourse, /'Bourse socle water-table moulding \(bandeau\)'/);
});

testCase('rounds 46-50: night floodlights, downpipes, hood moulds, sill brackets, pediment oculi', () => {
  assert.match(bourse, /nightGlowMats\.push\(floodGlow\)/);
  assert.match(bourse, /'Bourse facade floodlight heads \(night floodlighting, bracket-mounted\)'/);
  assert.match(bourse, /heads\.count = 10/);
  assert.match(bourse, /'Bourse facade lead downpipes \(descentes en plomb\)'/);
  assert.match(bourse, /'Bourse downpipe hopper heads'/);
  assert.match(bourse, /'Bourse facade window hood moulds \(larmiers\)'/);
  assert.match(bourse, /'Bourse hood label stops'/);
  assert.match(bourse, /'Bourse facade window sill brackets/);
  assert.match(bourse, /sills\.count = n/);
  assert.match(bourse, /'Bourse pavilion pediment oculus \(oeil-de-boeuf\)'/);
  assert.match(bourse, /'Bourse oculus stone surround'/);
});

testCase('rounds 51-52: 1949 De Heu corner building with dome-topped tower + shopfronts (ex Grands Magasins de la Bourse)', () => {
  assert.match(surroundings, /'1949 De Heu building \(ex Grands Magasins de la Bourse\)'/);
  assert.match(surroundings, /'1949 corner tower dome'/);
  assert.match(surroundings, /'1949 dome finial'/);
  assert.match(surroundings, /'1949 De Heu building window rows'/);
  assert.match(surroundings, /wins\.count = n/);
  assert.match(surroundings, /'1949 building shopfront glazing'/);
});

testCase('rounds 53-54: two 1884-85 eclectic apartment blocks opposite the square + Cafe de la Bourse no. 78 (1874, Janlet)', () => {
  assert.match(surroundings, /'1884-85 eclectic apartment block ' \+ \(sx < 0 \? 'west' : 'east'\)/);
  assert.match(surroundings, /'1884-85 block mansard roof crown'/);
  assert.match(surroundings, /'1884-85 apartment block windows'/);
  assert.match(surroundings, /'Cafe de la Bourse no\. 78 \(1874, neo-Baroque, Janlet\)'/);
  assert.match(surroundings, /'Cafe de la Bourse pediment'/);
});

testCase('rounds 55-58: premetro accesses 6/7/8, Fontaine Orts 1888, Orts monument, rue Orts water mirror', () => {
  assert.match(surroundings, /k\.name = 'Bourse premetro station ' \+ names\[i\]/);
  assert.match(surroundings, /'premetro access 7 \(rue Auguste Orts, escalator\)'/);
  assert.match(surroundings, /'premetro access 6 \(south of the square, elevator\)'/);
  assert.match(surroundings, /'kiosk glass canopy'/);
  assert.match(surroundings, /'Fontaine Orts \(1888, Beyaert \+ Houtstont, bust Vinootte\)'/);
  assert.match(surroundings, /'Fontaine Orts bust of Auguste Orts \(Vinootte\)'/);
  assert.match(surroundings, /'Fontaine Orts water disc \(eau potable, haut debit\)'/);
  assert.match(surroundings, /'Monument to Auguste Orts \(no\. 3 place de la Bourse\)'/);
  assert.match(surroundings, /'Water mirror on the rue Auguste Orts axis \(miroir d..eau, pietonnier\)'/);
  assert.match(surroundings, /'Water mirror jets/);
});

testCase('rounds 59-60: enamel street sign PLACE DE LA BOURSE / BEURSPLEIN + street-mouth bollards', () => {
  assert.match(surroundings, /'Enamel street sign PLACE DE LA BOURSE \/ BEURSPLEIN'/);
  assert.match(surroundings, /'enamel plate PLACE DE LA BOURSE \/ BEURSPLEIN'/);
  assert.match(surroundings, /materials\.enamelBlue/);
  assert.match(surroundings, /'Place de la Bourse street-mouth bollards'/);
  assert.match(surroundings, /bollards\.count = 16/);
});

testCase('rounds 61-63: bilingual enamel street signs at every street mouth', () => {
  for (const label of ['BOULEVARD ANSPACH / ANSPACHLAAN', 'RUE AUGUSTE ORTS / AUGUSTE ORTSSTRAAT', 'RUE DE LA BOURSE / BEURSSTRAAT', 'RUE HENRI MAUS / HENRI MAUSSTRAAT', 'RUE PAUL DEVAUX / PAUL DEVAUXSTRAAT', 'RUE JULES VAN PRAET / JULES VAN PRAETSTRAAT', 'RUE DU MARCHE AUX POULETS / KIEKEMARKT']) {
    assert.ok(surroundings.includes("'" + label + "'"), 'sign ' + label);
  }
  assert.match(surroundings, /'Enamel street sign ' \+ label/);
  assert.match(surroundings, /'sign post finial ball'/);
});

testCase('round 64: zebra crossings + Belisha beacons at the boulevard crossings', () => {
  assert.match(surroundings, /'Zebra crossing stripes at the boulevard crossings of the square'/);
  assert.match(surroundings, /stripes\.count = s/);
  assert.match(surroundings, /'Belisha beacon poles \(poteaux belisha\)'/);
  assert.match(surroundings, /'Belisha beacon globes'/);
});

testCase('rounds 65-70: benches, bins, bike arches, lighting columns, fountains, pedestrian-zone signs', () => {
  assert.match(surroundings, /'Square and boulevard benches \(bancs, pietonnier\)'/);
  assert.match(surroundings, /seats\.count = n/);
  assert.match(surroundings, /'Boulevard public bins \(poubelles publiques\)'/);
  assert.match(surroundings, /bins\.count = 6/);
  assert.match(surroundings, /'Bicycle arches \(arceaux velo\) at the square edge'/);
  assert.match(surroundings, /arches\.count = 8/);
  assert.match(surroundings, /'Pietonnier lighting columns \(nouvel eclairage\)'/);
  assert.match(surroundings, /poles\.count = 8/);
  assert.match(surroundings, /'Boulevard Anspach pietonnier fountain basins \(fontaines\)'/);
  assert.match(surroundings, /'Fountain jets'/);
  assert.match(surroundings, /'Pedestrian-zone entry sign \(zone pietonne, 29 June 2015\)'/);
  assert.match(surroundings, /'pedestrian zone sign disc \(disque bleu zone pietonne\)'/);
});

testCase('rounds 71-75: sett fans, kerb end stones, tactile bumps, drainage gullies, manhole covers', () => {
  assert.match(surroundings, /'Place de la Bourse street-mouth sett fans \(pavage en eventail\)'/);
  assert.match(surroundings, /fans\.count = n/);
  assert.match(surroundings, /'Square kerb end stones \(pierres de bout\)'/);
  assert.match(surroundings, /ends\.count = 12/);
  assert.match(surroundings, /'Tactile paving bumps at the crossings \(bandes podotactiles\)'/);
  assert.match(surroundings, /bumps\.count = n/);
  assert.match(surroundings, /'Square kerb drainage gullies'/);
  assert.match(surroundings, /gullies\.count = 24/);
  assert.match(surroundings, /'Square manhole covers/);
  assert.match(surroundings, /covers\.count = 8/);
});

testCase('rounds 76-80: premetro ventilation grilles, Bruxella 1238 plaque, terrace, stop sign, rue Orts facades', () => {
  assert.match(surroundings, /'Premetro tunnel ventilation grilles on the boulevard \(tunnel 1976, ancien lit de la Senne\)'/);
  assert.match(surroundings, /grilles\.count = 6/);
  assert.match(surroundings, /'Plaque Marche au Beurre \/ Recollets convent \/ Bruxella 1238'/);
  assert.match(surroundings, /'Brasserie terrace parasols on the square'/);
  assert.match(surroundings, /parasols\.count = 4/);
  assert.match(surroundings, /'Stop sign Bourse - Beurs \(bus 46\/48\/86\/95\) \+ shelter'/);
  assert.match(surroundings, /'Rue Auguste Orts monumental eclectic facades \(vers 1885\)'/);
  assert.match(surroundings, /facades\.count = 5/);
});

testCase('rounds 81-82: Corinthian acanthus leaves + corner volutes, necking rings', () => {
  assert.match(bourse, /'Bourse Corinthian capital acanthus leaves \(2 rows, 8 columns\)'/);
  assert.match(bourse, /leaves\.count = n/);
  assert.match(bourse, /'Bourse Corinthian capital corner volutes/);
  assert.match(bourse, /volutes\.count = v/);
  assert.match(bourse, /'Bourse capital necking rings \(annelets\)'/);
  assert.match(bourse, /rings\.count = 8/);
});

testCase('rounds 83-86: cyma mouldings, corona slab, frieze medallions, garland swags', () => {
  assert.match(bourse, /'Bourse cornice cyma recta/);
  assert.match(bourse, /'Bourse architrave cyma reversa/);
  assert.match(bourse, /'Bourse cornice corona/);
  assert.match(bourse, /'Bourse cornice bed moulding'/);
  assert.match(bourse, /'Bourse frieze medallions \(medaillons\) between the garlands'/);
  assert.match(bourse, /medallions\.count = 20/);
  assert.match(bourse, /'Bourse frieze garland swags \(guirlandes en feston\)'/);
  assert.match(bourse, /swags\.count = 20/);
});

testCase('rounds 87-90: archivolt voussoirs + keystone, tympanum plinth + attendants, raking dentils', () => {
  assert.match(bourse, /'Bourse central archivolt voussoirs \(voussoirs\)'/);
  assert.match(bourse, /voussoirs\.count = 9/);
  assert.match(bourse, /'Bourse archivolt keystone/);
  assert.match(bourse, /'Bourse tympanum relief plinth slab'/);
  assert.match(bourse, /'Bourse tympanum attendant figure '/);
  assert.match(bourse, /'Bourse pediment raking cornice dentils'/);
  assert.match(bourse, /dentils\.count = 36/);
});

testCase('rounds 91-94: stair parapets + coping, newel posts + urns, tread nosings, landing moulding', () => {
  assert.match(bourse, /'Bourse stair balustrade parapet '/);
  assert.match(bourse, /'Bourse stair parapet coping \(chaperon\)'/);
  assert.match(bourse, /'Bourse stair newel posts \(poteaux de depart\)'/);
  assert.match(bourse, /posts\.count = 4/);
  assert.match(bourse, /'Bourse newel urn finials \(vases\)'/);
  assert.match(bourse, /'Bourse stair tread nosings \(bandes de rive\)'/);
  assert.match(bourse, /nosings\.count = 20/);
  assert.match(bourse, /'Bourse portico landing edge moulding \(bandeau de rive\)'/);
});

testCase('rounds 95-100: bull/bear lion anatomy, pedestal mouldings, torch bowls, collar+lead, cheek caps', () => {
  assert.match(bourse, /out_ref_bull = bull/);
  assert.match(bourse, /out_ref_bear = bear/);
  assert.match(bourse, /'bull lion open jaw'/);
  assert.match(bourse, /'bull lion raised foreleg'/);
  assert.match(bourse, /'bull lion tail tuft'/);
  assert.match(bourse, /'bear lion lowered jaw'/);
  assert.match(bourse, /'bear lion planted foreleg'/);
  assert.match(bourse, /'Bourse lion pedestal plinth base'/);
  assert.match(bourse, /'Bourse lion pedestal cap moulding'/);
  assert.match(bourse, /torchGeniuses\.push\(genius\)/);
  assert.match(bourse, /'torch bowl \(coupe\)'/);
  assert.match(bourse, /'torch flame \(flamme\)'/);
  assert.match(bourse, /'lion collar \(collier\)'/);
  assert.match(bourse, /'Bourse stair cheek wall cap \(chaperon\)'/);
});

testCase('rounds 101-104: drum oculi, drum dentils, dome girders, paired meridian ribs', () => {
  assert.match(bourse, /'Bourse dome drum oculi \(oeils-de-boeuf du tambour\)'/);
  assert.match(bourse, /oculi\.count = 8/);
  assert.match(bourse, /'Bourse drum entablature dentils \(denticules du tambour\)'/);
  assert.match(bourse, /dentils\.count = 24/);
  assert.match(bourse, /'Bourse dome glazing girder \(cerce\)'/);
  assert.match(bourse, /'Bourse dome paired meridian ribs \(second set of arcs\)'/);
  assert.match(bourse, /ribs2\.count = 8/);
});

testCase('rounds 105-108: lantern columns + orb/cross, lantern mouldings, pendentives, barrel vaults', () => {
  assert.match(bourse, /'Bourse lantern ring of eight columns \(colonnettes du lanterneau\)'/);
  assert.match(bourse, /cols\.count = 8/);
  assert.match(bourse, /'Bourse lantern orb \(boule\)'/);
  assert.match(bourse, /'Bourse lantern cross vertical'/);
  assert.match(bourse, /'Bourse lantern cornice \(corniche du lanterneau\)'/);
  assert.match(bourse, /'Bourse dome pendentive \(pendentif\)'/);
  assert.match(bourse, /'Bourse barrel vault over cross arm \(tongewelf\)'/);
});

testCase('rounds 109-110: slate tile courses + gilded ridge cresting on the arm roofs', () => {
  assert.match(bourse, /'Bourse arm roof slate tile courses \(ardoises en ranges\)'/);
  assert.match(bourse, /courses\.count = n/);
  assert.match(bourse, /'Bourse arm roof ridge cresting \(cretes dorees\)'/);
  assert.match(bourse, /crests\.count = n/);
});

testCase('rounds 111-114: side arcade pediments, balcony balustrades, rear windows + cornice, rear arched bays', () => {
  assert.match(bourse, /'Bourse side facade arcade pediments \(frontons sur baies\)'/);
  assert.match(bourse, /peds\.count = n/);
  assert.match(bourse, /'Bourse side facade balcony balusters \(balustres\)'/);
  assert.match(bourse, /balusters\.count = b/);
  assert.match(bourse, /'Bourse side facade balcony top rails'/);
  assert.match(bourse, /'Bourse rear facade windows \(rue du Midi\)'/);
  assert.match(bourse, /'Bourse rear facade cornice'/);
  assert.match(bourse, /'Bourse rear upper arched bay'/);
  assert.match(bourse, /'Bourse rear upper bay arch'/);
});

testCase('rounds 115-120: side modillions, arch mullions, arcade grilles, colossal pilasters, string courses, rear entrance', () => {
  assert.match(bourse, /'Bourse side facade cornice modillions'/);
  assert.match(bourse, /mods\.count = n/);
  assert.match(bourse, /'Bourse great arch mullions \(meneaux\)'/);
  assert.match(bourse, /mull\.count = n/);
  assert.match(bourse, /'Bourse ground-floor arcade iron grilles \(grilles des bureaux\)'/);
  assert.match(bourse, /grilles\.count = n/);
  assert.match(bourse, /'Bourse side facade colossal pilasters \(pilastres colossaux\)'/);
  assert.match(bourse, /pil\.count = n/);
  assert.match(bourse, /'Bourse side facade first string course'/);
  assert.match(bourse, /'Bourse rear lateral entrance door \(entree laterale, élargie 2023\)'/);
  assert.match(bourse, /'Bourse rear entrance arch'/);
  assert.match(bourse, /'Bourse rear entrance landing'/);
});

testCase('rounds 121-122: 1949 tower dome ribs + shaft windows, reused balconies from the Grands Magasins', () => {
  assert.match(surroundings, /'1949 tower dome meridian ribs \(nervures de la coupole\)'/);
  assert.match(surroundings, /ribs\.count = 8/);
  assert.match(surroundings, /'1949 tower shaft windows'/);
  assert.match(surroundings, /'1949 building reused balconies \(balcons recuperes des Grands Magasins\)'/);
  assert.match(surroundings, /balconies\.count = 8/);
  assert.match(surroundings, /'1949 balcony iron rails'/);
});

testCase('rounds 123-126: 1884-85 surrounds + balcony rails + modillions + dormers; Cafe de la Bourse cartouche + oriel + awning', () => {
  assert.match(surroundings, /'1884-85 block window stone surrounds'/);
  assert.match(surroundings, /surr\.count = n/);
  assert.match(surroundings, /'1884-85 block etage balcony rails'/);
  assert.match(surroundings, /'1884-85 block cornice modillions'/);
  assert.match(surroundings, /'1884-85 block mansard dormers \(lucarnes\)'/);
  assert.match(surroundings, /'Cafe de la Bourse cartouche \(cartouche sculpte\)'/);
  assert.match(surroundings, /'Cafe de la Bourse oriel \(oriel vitre\)'/);
  assert.match(surroundings, /'Cafe de la Bourse canvas awning \(store\)'/);
});

testCase('rounds 127-130: kiosk frames + handrails, access-6 elevator shaft, Fontaine Orts fluting + spout, Orts monument base + plaque frame', () => {
  assert.match(surroundings, /'kiosk frame post west'/);
  assert.match(surroundings, /'kiosk handrail \(garde-corps\)'/);
  assert.match(surroundings, /'premetro access 6 glazed elevator shaft \(ascenseur\)'/);
  assert.match(surroundings, /'Fontaine Orts fluted shaft \(fut cannele\)'/);
  assert.match(surroundings, /'Fontaine Orts basin rim moulding'/);
  assert.match(surroundings, /'Fontaine Orts drinking spout \(bec verseur\)'/);
  assert.match(surroundings, /'Orts monument stepped base'/);
  assert.match(surroundings, /'Orts monument cap moulding'/);
  assert.match(surroundings, /'Orts monument plaque frame \(cadre bronze dore\)'/);
});

testCase('rounds 131-134: front balconies, window keystones, genius attributes, apex palmette', () => {
  assert.match(bourse, /'Bourse front etage balcony top rails'/);
  assert.match(bourse, /rails\.count = r/);
  assert.match(bourse, /'Bourse front etage balcony balusters'/);
  assert.match(bourse, /'Bourse front window keystones \(clefs de fenetre\)'/);
  assert.match(bourse, /keys\.count = n/);
  assert.match(bourse, /'Commerce purse \(bourse\)'/);
  assert.match(bourse, /'Industrie gear'/);
  assert.match(bourse, /'Industrie hammer handle'/);
  assert.match(bourse, /'la Belgique laurel crown'/);
  assert.match(bourse, /'Bourse apex palmette \(palmette sommitale\)'/);
});

testCase('rounds 135-140: door steps + thresholds, escutcheons + knockers, mutules, shield boss/rim, night window glow', () => {
  assert.match(bourse, /'Bourse central door lower step'/);
  assert.match(bourse, /'Bourse central door upper step'/);
  assert.match(bourse, /'Bourse west door threshold'/);
  assert.match(bourse, /'Bourse east door threshold'/);
  assert.match(bourse, /'Bourse door escutcheons \(entrees de serrure\)'/);
  assert.match(bourse, /'Bourse door knockers \(heurtoirs\)'/);
  assert.match(bourse, /'Bourse cornice mutules over the peristyle columns'/);
  assert.match(bourse, /mutules\.count = 8/);
  assert.match(bourse, /'Bourse shield boss \(umbo\)'/);
  assert.match(bourse, /'Bourse shield rim \(bordure\)'/);
  assert.match(bourse, /nightGlowMats\.push\(bourseWindowGlow\)/);
  assert.match(bourse, /winMesh\.material = bourseWindowGlow/);
});

testCase('rounds 141-144: caryatid drapery folds, entablature beam, Asie elephant / Afrique attendant, rear curved cyma', () => {
  assert.match(bourse, /'Bourse caryatid drapery folds \(plis du drapé\)'/);
  assert.match(bourse, /folds.count = 5/);
  assert.match(bourse, /'Bourse caryatid entablature beam/);
  assert.match(bourse, /'L\\'Asie elephant body'/);
  assert.match(bourse, /'L\\'Asie elephant head'/);
  assert.match(bourse, /'L\\'Afrique attendant'/);
  assert.match(bourse, /'Bourse rear curved pediment cyma \(fronton courbe\)'/);
});

testCase('rounds 145-150: putti wings, globe meridians, rear quoins, rear pilasters, recess band, stylobate moulding', () => {
  assert.match(bourse, /'putto wing'/);
  assert.match(bourse, /'Bourse globe meridian'/);
  assert.match(bourse, /'Bourse rear facade corner quoins'/);
  assert.match(bourse, /q\.count = n/);
  assert.match(bourse, /'Bourse rear bay pilaster'/);
  assert.match(bourse, /'Bourse peristyle recess shadow band'/);
  assert.match(bourse, /'Bourse stylobate edge moulding'/);
});

testCase('rounds 151-154: calepinage courses, wear lines, sett patches + borders, corner accent cobbles', () => {
  assert.match(surroundings, /'Place de la Bourse alternating calepinage courses'/);
  assert.match(surroundings, /alt\.count = n/);
  assert.match(surroundings, /'Place de la Bourse wear lines/);
  assert.match(surroundings, /wear\.count = 2/);
  assert.match(surroundings, /'Place de la Bourse sett repair patches'/);
  assert.match(surroundings, /'Sett patch borders/);
  assert.match(surroundings, /'Square corner accent cobbles/);
  assert.match(surroundings, /accent\.count = n/);
});

testCase('rounds 155-160: boulevard spine, side-street stubs, planter soil + shrubs, tree trunks + guards, stair tactile strip, kerb ramps', () => {
  assert.match(surroundings, /'Boulevard Anspach central spine \(bande centrale\)'/);
  assert.match(surroundings, /'Rue Paul Devaux paving stub'/);
  assert.match(surroundings, /'Rue Jules Van Praet paving stub'/);
  assert.match(surroundings, /'Planter soil \(terreau des bacs encastres\)'/);
  assert.match(surroundings, /soil\.count = 12/);
  assert.match(surroundings, /'Planter shrubs \(arbustes des bacs\)'/);
  assert.match(surroundings, /'Boulevard tree trunks \(fûts\)'/);
  assert.match(surroundings, /'Tree guard grilles \(grilles de protection\)'/);
  assert.match(surroundings, /'Tactile strip at the monumental stair foot \(bande podotactile\)'/);
  assert.match(surroundings, /'Kerb ramps at the crossings \(abaissés de trottoir\)'/);
  assert.match(surroundings, /ramps\.count = 4/);
});

testCase('rounds 161-166: peristyle soffit, aedicule pediment, imposts, pavilion windows/dentils/doors', () => {
  assert.match(bourse, /'Bourse peristyle soffit \(plafond\)'/);
  assert.match(bourse, /'Bourse aedicule pediment over the central door'/);
  assert.match(bourse, /'Bourse central arch impost block'/);
  assert.match(bourse, /'Bourse avant-corps pavilion windows'/);
  assert.match(bourse, /wins\.count = n/);
  assert.match(bourse, /'Bourse pavilion cornice dentils'/);
  assert.match(bourse, /'Bourse pavilion door ' \+ \(sx < 0 \? 'west' : 'east'\)/);
  assert.match(bourse, /'Bourse pavilion door lintel'/);
});

testCase('rounds 167-170: allegory pedestals, tympanum radiant halo, entablature end blocks, cella plinth', () => {
  assert.match(bourse, /'Bourse allegory pedestal'/);
  assert.match(bourse, /'Bourse tympanum radiant halo disc'/);
  assert.match(bourse, /'Bourse entablature end block'/);
  assert.match(bourse, /'Bourse cella base plinth \(plinthe\)'/);
});

testCase('rounds 171-173: rue de la Bourse + rue Henri Maus flanking streets, Marche aux Poulets connection', () => {
  assert.match(surroundings, /'Rue de la Bourse paving \(east flank of the palace\)'/);
  assert.match(surroundings, /'Rue de la Bourse facade row'/);
  assert.match(surroundings, /'Rue Henri Maus paving \(west flank of the palace\)'/);
  assert.match(surroundings, /'Rue Henri Maus facade row'/);
  assert.match(surroundings, /'Rue du Marche aux Poulets connection to the square'/);
});

testCase('rounds 174-179: boulevard south/north facade rows, Ancienne Belgique frontage, Bogards mouth + sign, square edge rows', () => {
  assert.match(surroundings, /'Boulevard Anspach south facade row/);
  assert.match(surroundings, /'Ancienne Belgique concert hall frontage \(Boulevard Anspach\)'/);
  assert.match(surroundings, /'Ancienne Belgique windows'/);
  assert.match(surroundings, /'Boulevard Anspach north facade row/);
  assert.match(surroundings, /'Rue des Bogards mouth paving'/);
  assert.match(surroundings, /'Enamel street sign RUE DES BOGARDS \/ BOGARDSTRAAT'/);
  assert.match(surroundings, /'Rue Henri Maus south continuation toward Boulevard du Midi'/);
  assert.match(surroundings, /'Square edge facade rows/);
});

testCase('round 180: pietonnier lamp heads + Belisha globes registered for the night glow pass', () => {
  assert.match(surroundings, /nightGlowMats\.push\(lampGlow\)/);
  assert.match(surroundings, /heads\.material = lampGlow/);
  assert.match(surroundings, /beacons\.material = lampGlow/);
});

testCase('rounds 181-185: dome pilaster bases/capitals, pier plinths, socle refends around, eave gutter, pediment antefixes', () => {
  assert.match(bourse, /'Bourse dome pilaster bases'/);
  assert.match(bourse, /'Bourse dome pilaster capitals \(chapiteaux des pilastres\)'/);
  assert.match(bourse, /caps\.count = n/);
  assert.match(bourse, /'Bourse dome pier plinth \(plinthe du pilier\)'/);
  assert.match(bourse, /'Bourse socle refend grooves side \+ rear faces'/);
  assert.match(bourse, /side\.count = n/);
  assert.match(bourse, /materials\.dark, 60\)/, 'socle refend side allocation must cover 60 instances (smoke-found bug)');
  assert.match(bourse, /'Bourse front eave gutter \(gouttiere\)'/);
  assert.match(bourse, /'Bourse pediment eaves palmette antefix'/);
});

testCase('rounds 186-190: clock minute ticks, second wings, frieze dentil band, double archivolt, column plinths', () => {
  assert.match(bourse, /'Bourse clock minute ticks'/);
  assert.match(bourse, /ticks\.count = 12/);
  assert.match(bourse, /'winged figure second wing'/);
  assert.match(bourse, /'Bourse frieze lower dentil band'/);
  assert.match(bourse, /d\.count = 60/);
  assert.match(bourse, /'Bourse central door outer archivolt \(double archivolte\)'/);
  assert.match(bourse, /'Bourse peristyle column plinths \(plinthes\)'/);
  assert.match(bourse, /plinths\.count = 8/);
});

testCase('rounds 191-195: sign collars + sett rings, plate frames, bollard caps, bench backs/arms, mirror frame', () => {
  assert.match(surroundings, /'Street sign post base collars \(colliers\)'/);
  assert.match(surroundings, /'Sign post sett rings \(anneaux de pavé\)'/);
  assert.match(surroundings, /'Enamel plate white border frames \(bordures blanches\)'/);
  assert.match(surroundings, /frames\.count = plates\.length/);
  assert.match(surroundings, /'Bollard rounded cap heads/);
  assert.match(surroundings, /caps\.count = 16/);
  assert.match(surroundings, /'Bench back slats \(dossiers des bancs\)'/);
  assert.match(surroundings, /'Bench armrests \(accoudoirs\)'/);
  assert.match(surroundings, /'Water mirror north frame moulding'/);
});

testCase('rounds 196-200: kiosk door + glass band, terrace chairs, fountain rims + nozzles, bin pedals, double bike arches', () => {
  assert.match(surroundings, /'kiosk door panel \(porte\)'/);
  assert.match(surroundings, /'kiosk tinted glass band/);
  assert.match(surroundings, /'Terrace chairs \(chaises de terrasse\)'/);
  assert.match(surroundings, /chairs\.count = n/);
  assert.match(surroundings, /'Fountain basin rim mouldings'/);
  assert.match(surroundings, /'Fountain centre nozzles \(gicleurs\)'/);
  assert.match(surroundings, /'Bin foot pedals \(pedales\)'/);
  assert.match(surroundings, /'Bicycle arch inner rails \(second rail des arceaux\)'/);
});

testCase('rounds 201-205: pavilion side windows, terrace urns, canopy columns, 2023 entrance canopy, socle corner quoins', () => {
  assert.match(bourse, /'Bourse corner pavilion side windows'/);
  assert.match(bourse, /wins\.count = n/);
  assert.match(bourse, /'Bourse roof terrace urn finial'/);
  assert.match(bourse, /'Bourse brass canopy support columns \(colonnes du luifel\)'/);
  assert.match(bourse, /cols\.count = 4/);
  assert.match(bourse, /'Bourse 2023 entrance canopy \(auvent laiton\)'/);
  assert.match(bourse, /'Bourse socle corner quoin blocks/);
  assert.match(bourse, /q\.count = n/);
});

testCase('rounds 206-210: attic parapet + balusters, dormer glazing, chimney pots, valley flashings', () => {
  assert.match(bourse, /'Bourse wing attic parapet band/);
  assert.match(bourse, /'Bourse wing parapet balusters'/);
  assert.match(bourse, /bal\.count = n/);
  assert.match(bourse, /'Bourse wing parapet top rails'/);
  assert.match(bourse, /'Bourse dormer glazing \(vitres des lucarnes\)'/);
  assert.match(bourse, /glass\.count = 12/);
  assert.match(bourse, /'Bourse chimney pots \(pots de cheminee\)'/);
  assert.match(bourse, /pots\.count = 6/);
  assert.match(bourse, /'Bourse roof valley lead flashing \(noue en plomb\)'/);
});

testCase('rounds 211-215: 1949 mansard + dormers, 1884-85 avant-corps pediments, Cafe oriel + mansard, kiosk roundels + steps', () => {
  assert.match(surroundings, /'1949 building mansard roof'/);
  assert.match(surroundings, /'1949 building mansard dormers'/);
  assert.match(surroundings, /'1884-85 block central avant-corps'/);
  assert.match(surroundings, /'1884-85 avant-corps pediment \(fronton\)'/);
  assert.match(surroundings, /'Cafe de la Bourse corner oriel'/);
  assert.match(surroundings, /'Cafe de la Bourse mansard roof'/);
  assert.match(surroundings, /'premetro access sign disc \(roundel generique, sans marque\)'/);
  assert.match(surroundings, /'kiosk lower step'/);
  assert.match(surroundings, /'kiosk upper step'/);
});

testCase('rounds 216-220: Fontaine side spouts, mirror corner stones, planter rims, lamp collars, kiosk colliders', () => {
  assert.match(surroundings, /'Fontaine Orts side spout \(bec lateral\)'/);
  assert.match(surroundings, /'Water mirror corner stones/);
  assert.match(surroundings, /'Planter rim mouldings \(bords des bacs\)'/);
  assert.match(surroundings, /rims\.count = 12/);
  assert.match(surroundings, /'Lighting column base collars'/);
  const layout = readFileSync(new URL('../js/brussels-colliders.js', import.meta.url), 'utf8');
  assert.match(layout, /premetro access 7 kiosk/);
  assert.match(layout, /premetro access 8 kiosk/);
  assert.match(layout, /premetro access 6 kiosk/);
  const sur2 = createBrusselsLandmarkColliders('bourseSurroundings', brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.bourseSurroundings.lat, BRUSSELS_LANDMARK_ANCHORS.bourseSurroundings.lon), BOURSE_ROTATION, 0);
  assert.ok(sur2.length >= 7, 'kiosks registered as colliders');
});

testCase('rounds 221-225: ground floodlights, entasis rings, cella coursing, stair landings, clock second hand', () => {
  assert.match(bourse, /'Bourse ground floodlight troughs on the square \(projecteurs au sol\)'/);
  assert.match(bourse, /troughs\.count = 6/);
  assert.match(bourse, /'Bourse peristyle shaft entasis rings \(entasis\)'/);
  assert.match(bourse, /rings\.count = 8/);
  assert.match(bourse, /'Bourse cella coursing grooves/);
  assert.match(bourse, /courses\.count = 6/);
  assert.match(bourse, /'Bourse stair mid landing platform'/);
  assert.match(bourse, /'Bourse clock second hand'/);
});

testCase('rounds 226-230: tympanum inner frame, ogee cyma, front pilasters, downpipe collars, cellar grates', () => {
  assert.match(bourse, /'Bourse tympanum inner frame moulding/);
  assert.match(bourse, /'tympanum inner frame raking'/);
  assert.match(bourse, /'Bourse cornice ogee cyma band \(cyma en doucine\)'/);
  assert.match(bourse, /cyma\.count = 1/);
  assert.match(bourse, /'Bourse front corner pilaster'/);
  assert.match(bourse, /'Bourse front pilaster capital'/);
  assert.match(bourse, /'Bourse downpipe bracket collars \(colliers de fixation\)'/);
  assert.match(bourse, /collars\.count = n/);
  assert.match(bourse, /'Bourse cellar areaway grates beside the stair \(soupiraux de cave\)'/);
  assert.match(bourse, /grates\.count = 4/);
  assert.ok(!bourse.includes("'placeholder'"), 'no placeholder meshes left');
});

testCase('rounds 231-234: 1949 tower quoins, 1884-85 shopfronts, Cafe glazing, AB canopy + marquee', () => {
  assert.match(surroundings, /'1949 tower corner quoins/);
  assert.match(surroundings, /q\.count = n/);
  assert.match(surroundings, /'1884-85 blocks ground-floor shopfronts'/);
  assert.match(surroundings, /shops\.count = 2/);
  assert.match(surroundings, /'Cafe de la Bourse ground-floor glazing'/);
  assert.match(surroundings, /'Ancienne Belgique entrance canopy \(marquise\)'/);
  assert.match(surroundings, /'Ancienne Belgique marquee band'/);
});

testCase('rounds 235-240: boulevard cornices, rue Orts cornices, square shopfronts, planter flowers, mirror benches, shelter bench + timetable', () => {
  assert.match(surroundings, /'Boulevard facade row cornices'/);
  assert.match(surroundings, /cornices\.count = 8/);
  assert.match(surroundings, /'Rue Orts facade cornices \(corniches\)'/);
  assert.match(surroundings, /'Square edge shopfronts \(vitrines rez-de-chaussee\)'/);
  assert.match(surroundings, /'Planter flowers \(fleurs des bacs\)'/);
  assert.match(surroundings, /flowers\.count = n/);
  assert.match(surroundings, /'Benches facing the Bourse by the water mirror/);
  assert.match(surroundings, /seats\.count = 4/);
  assert.match(surroundings, /'shelter bench/);
  assert.match(surroundings, /'timetable case \(fiche horaire\)'/);
});

testCase('rounds 241-245: cella etage windows, cornice returns, corner pilasters, attic oculi, drum string course', () => {
  assert.match(bourse, /'Bourse cella etage windows'/);
  assert.match(bourse, /'Bourse cella etage window surrounds'/);
  assert.match(bourse, /'Bourse cornice return at facade end'/);
  assert.match(bourse, /'Bourse corner turn pilaster'/);
  assert.match(bourse, /'Bourse attic band oculus'/);
  assert.match(bourse, /'Bourse attic oculus surround'/);
  assert.match(bourse, /'Bourse dome drum base string course \(bandeau du tambour\)'/);
});

testCase('rounds 246-250: extra dome glazing bars, lantern panes, terrace bulkhead, canopy valance, flagpoles', () => {
  assert.match(bourse, /'Bourse dome glazing bar \(barreau de vitrage\)'/);
  assert.match(bourse, /'Bourse lantern glazed openings \(baies vitrees du lanterneau\)'/);
  assert.match(bourse, /panes\.count = 8/);
  assert.match(bourse, /'Bourse roof terrace access bulkhead/);
  assert.match(bourse, /'Bourse terrace access door'/);
  assert.match(bourse, /'Bourse brass canopy scalloped valance \(feston du luifel\)'/);
  assert.match(bourse, /valance\.count = n/);
  assert.match(bourse, /'Bourse roof terrace flagpoles \(mat de drapeau\)'/);
  assert.match(bourse, /poles\.count = 4/);
});

testCase('rounds 251-256: junction chamfers, boulevard north + south continuations, Paul Devaux + Van Praet rows, AB side elevation', () => {
  assert.match(surroundings, /'Square-boulevard junction chamfer stones \(pierres biaises\)'/);
  assert.match(surroundings, /chamfers\.count = 4/);
  assert.match(surroundings, /'Boulevard Anspach north continuation \(vers De Brouckere\)'/);
  assert.match(surroundings, /'Boulevard Anspach south continuation \(vers Fontainas \/ Lemonnier\)'/);
  assert.match(surroundings, /'Rue Paul Devaux facade row \(north side\)'/);
  assert.match(surroundings, /'Rue Jules Van Praet facade row'/);
  assert.match(surroundings, /'Ancienne Belgique side elevation \(pignon lateral\)'/);
  assert.match(surroundings, /'Ancienne Belgique side windows'/);
});

testCase('rounds 257-260: 1949 rear windows, Cafe terrace paving, spine drainage channel, AB + Cafe colliders', () => {
  assert.match(surroundings, /'1949 building rear windows \(face nord\)'/);
  assert.match(surroundings, /'Cafe de la Bourse terrace paving \(terrasse\)'/);
  assert.match(surroundings, /'Boulevard spine drainage channel \(caniveau central\)'/);
  const layout = readFileSync(new URL('../js/brussels-colliders.js', import.meta.url), 'utf8');
  assert.match(layout, /Ancienne Belgique block/);
  assert.match(layout, /Cafe de la Bourse no\. 78/);
  const sur2 = createBrusselsLandmarkColliders('bourseSurroundings', brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.bourseSurroundings.lat, BRUSSELS_LANDMARK_ANCHORS.bourseSurroundings.lon), BOURSE_ROTATION, 0);
  assert.ok(sur2.length >= 9, 'AB + Cafe + kiosks + buildings registered');
});

testCase('rounds 261-262: door fanlights + frames, stair foot sett fan', () => {
  assert.match(bourse, /'Bourse door fanlight \(imposte vitree\)'/);
  assert.match(bourse, /'Bourse fanlight frame'/);
  assert.match(bourse, /'Bourse stair foot sett fan \(passerelle d..entree en eventail\)'/);
  assert.match(bourse, /fan\.count = 14/);
});

testCase('rounds 263-270: 1949 entrance, mirror rim, kiosk roof mouldings, Fontaine finial, monument steps, bin flaps, lamp flanges, axis band', () => {
  assert.match(surroundings, /'1949 building entrance door'/);
  assert.match(surroundings, /'1949 entrance lintel'/);
  assert.match(surroundings, /'Water mirror inner rim/);
  assert.match(surroundings, /'kiosk roof edge moulding'/);
  assert.match(surroundings, /'Fontaine Orts finial \(boule sommitale\)'/);
  assert.match(surroundings, /'Orts monument step 3'/);
  assert.match(surroundings, /'Bin recycling flaps \(trappe de recyclage\)'/);
  assert.match(surroundings, /'Lighting pole base flanges \(socles de mat\)'/);
  assert.match(surroundings, /'Rue Orts view axis band toward the Bourse \(bande d..axe\)'/);
});

testCase('rounds 271-275: aedicule cartouche, wing office doors, shutter hinges, apex leaves, gutter brackets', () => {
  assert.match(bourse, /'Bourse aedicule cartouche \(cartouche dore\)'/);
  assert.match(bourse, /'Bourse wing ground-floor office door'/);
  assert.match(bourse, /'Bourse wing door lintel'/);
  assert.match(bourse, /'Bourse window shutter hinge straps \(pentures\)'/);
  assert.match(bourse, /hinges\.count = n/);
  assert.match(bourse, /'Bourse apex acanthus side leaf'/);
  assert.match(bourse, /'Bourse eave gutter brackets \(crochets de gouttiere\)'/);
  assert.match(bourse, /brackets\.count = 12/);
});

testCase('rounds 276-280: socle drainage outlets, rear downpipes, 2023 lateral entrances with brass, dome apex ball, socle night wash', () => {
  assert.match(bourse, /'Bourse socle corner drainage outlets/);
  assert.match(bourse, /outlets\.count = 4/);
  assert.match(bourse, /'Bourse rear downpipes \(descentes arriere\)'/);
  assert.match(bourse, /'Bourse 2023 lateral entrance \(facade '/);
  assert.match(bourse, /'Bourse lateral entrance brass lintel'/);
  assert.match(bourse, /'Bourse dome apex gilded ball \(boule sommitale de la coupole\)'/);
  assert.match(bourse, /facadeWashMats\.push\(socleWash\)/);
  assert.match(bourse, /socle\.material = socleWash/);
});

testCase('rounds 281-285: peristyle base plinths and tori, lateral archivolts, tympanum relief, clock minute hand, peristyle dentils', () => {
  assert.match(bourse, /'Bourse peristyle base plinths \(plinthes des bases attiques\)'/);
  assert.match(bourse, /plinths\.count = 8/);
  assert.match(bourse, /'Bourse peristyle base torus mouldings'/);
  assert.match(bourse, /rings\.count = 8/);
  assert.match(bourse, /'Bourse lateral door outer archivolt'/);
  assert.match(bourse, /'Bourse lateral door inner archivolt'/);
  assert.match(bourse, /'Bourse tympanum seated Belgique relief \(la Belgique enthronee\)'/);
  assert.match(bourse, /'Bourse tympanum Commerce genius relief'/);
  assert.match(bourse, /'Bourse tympanum Industry genius relief'/);
  assert.match(bourse, /'Bourse clock minute hand'/);
  assert.match(bourse, /'Bourse peristyle entablature dentils \(denticules\)'/);
  assert.match(bourse, /dentils\.count = n/);
});

testCase('rounds 286-290: etage keystones, door imposts, bollard chains, manhole rings, monument plaque', () => {
  assert.match(bourse, /'Bourse cella etage window keystones \(clefs\)'/);
  assert.match(bourse, /keys\.count = n/);
  assert.match(bourse, /'Bourse lateral door impost block \(sommier\)'/);
  assert.match(surroundings, /'Place de la Bourse bollard chains across street mouths \(chaines\)'/);
  assert.match(surroundings, /links\.count = n/);
  assert.match(surroundings, /'Boulevard Anspach manhole rings \(plaques d..egout\)'/);
  assert.match(surroundings, /rings\.count = 6/);
  assert.match(surroundings, /'Bourse classified-monument plaque \(plaque monument classe A001\/31241\)'/);
});

// __MORE_BOURSE_TESTS__
