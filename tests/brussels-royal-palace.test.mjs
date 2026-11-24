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

testCase('the central corps carries a dormered slate mansard roof (toiture à lucarne)', () => {
  assert.match(palace, /dormered roof/);
  assert.match(palace, /'Central corps mansard roof'/);
  assert.match(palace, /'Central mansard dormer'/);
  assert.match(palace, /'Central mansard dormer window'/);
  assert.match(palace, /'Central dormer pediment'/);
  assert.match(palace, /for \(let i = 0; i < 3; i\+\+\)/);
});

testCase('second-floor wing windows carry a keystone and garland swag', () => {
  assert.match(palace, /keystone and garland/);
  assert.match(palace, /if \(floorY === 16\.0\)/);
  assert.match(palace, /'Second-floor window keystone'/);
  assert.match(palace, /'Second-floor garland swag'/);
  assert.match(palace, /gsw\.rotation\.z = Math\.PI/);
});

testCase('chimney stacks with stone caps rise from the wing slate roofs', () => {
  assert.match(palace, /Chimney stacks/);
  assert.match(palace, /'Palace roof chimney stacks'/);
  assert.match(palace, /'Chimney stack caps'/);
  assert.match(palace, /chimneys\.count = caps\.count = ci/);
});

testCase("Vinçotte's full tympanum programme: flag + Leopold II medallion centre, Scheldt and Meuse in the corners", () => {
  assert.match(palace, /tympanum programme/);
  assert.match(palace, /'Pediment national flag staff finial'/);
  assert.match(palace, /'Pediment Belgian flag stripe'/);
  assert.match(palace, /'Leopold II pediment medallion'/);
  assert.match(palace, /'Escaut river relief'/);
  assert.match(palace, /'Meuse river relief'/);
});

testCase('the central wing projects to the south too — rear avant-corps with pediment (Throne Room side)', () => {
  assert.match(palace, /au Nord et au Sud/);
  assert.match(palace, /'Palace south rear avant-corps \(Throne Room\)'/);
  assert.match(palace, /'South avant-corps pediment'/);
  assert.match(palace, /sp\.rotation\.y = Math\.PI/);
  assert.match(palace, /'South avant-corps window'/);
  assert.match(palace, /'South avant-corps ground window'/);
});

testCase('every piano nobile wing opening has its iron balconette inside the continuous balcony', () => {
  assert.ok(!palace.includes('i % 2 === 0'), 'no more scattered every-other-bay balconettes');
  assert.match(palace, /'Wing balcony rail'/);
  assert.match(palace, /'Wing balcony baluster'/);
  assert.match(palace, /continuous first-floor balcony parapet/);
});

testCase('rusticated corner quoins chain the central corps and terminal pavilions', () => {
  assert.match(palace, /corner quoins/);
  assert.match(palace, /'Palace corner quoins'/);
  assert.match(palace, /quoins\.count = qi/);
  assert.match(palace, /new THREE\.InstancedMesh\(new THREE\.BoxGeometry\(0\.5, 0\.8, 0\.34\), ashlar, 200\)/);
});

testCase('wing ends and pavilion outer faces carry windows (no blank gable ends)', () => {
  assert.match(palace, /'Wing end window \(piano nobile\)'/);
  assert.match(palace, /'Wing end window \(ground\)'/);
  assert.match(palace, /'Pavilion outer-face window'/);
  assert.match(palace, /side \* 70\.1/);
  assert.match(palace, /side \* 80\.1/);
});

testCase('the Place des Palais frontage is paved with blue-stone setts beyond the garden railing', () => {
  assert.match(palace, /entirely paved/);
  assert.match(palace, /pierre bleue/);
  assert.match(palace, /'Place des Palais paved apron'/);
  assert.match(palace, /'Place des Palais sett paving'/);
  assert.match(palace, /setts\.count = psi/);
  assert.match(palace, /box\(g, 170, 0\.3, 44, 0, -0\.15, 36, materials\.pavingEdge/);
});

testCase('the main cornice stands on a row of corbelled modillions (wings + central corps)', () => {
  assert.match(palace, /pourvue de modillons/);
  assert.match(palace, /'Main cornice modillions'/);
  assert.match(palace, /modillions\.count = mdi/);
  assert.match(palace, /mdd\.position\.set\(mx, 22\.1, centralFace \+ 0\.6\)/);
});

testCase('a monumental pilaster order divides every bay of the wings', () => {
  assert.match(palace, /ordre monumental de pilastres/);
  assert.match(palace, /for \(let i = 0; i <= 9; i\+\+\)/);
  assert.match(palace, /const px = x - 24\.75 \+ i \* 5\.5;/);
  assert.match(palace, /'Wing bay pilaster'/);
});

testCase('the dome drum is pierced on all four faces by two rows of oculi, lower row garland-rimmed', () => {
  assert.match(palace, /pierced on EACH FACE/);
  assert.match(palace, /'Dome drum oculus garland'/);
  assert.match(palace, /surround\.rotation\.y = oculus\.rotation\.y = Math\.PI \/ 2/);
  assert.match(palace, /const x = side \* 8\.9;/);
  assert.match(palace, /if \(y === 26\.4\)/);
});

testCase('a continuous stone balustrade runs along the whole roofline (central corps + pavilions)', () => {
  assert.match(palace, /balustrade terminale/);
  assert.match(palace, /'Palace roofline balusters'/);
  assert.match(palace, /roofBalusters\.count = ri/);
  assert.match(palace, /'Central roofline balustrade rail'/);
  assert.match(palace, /'Pavilion roofline balustrade rail'/);
});

testCase('every ground-floor arcade — wings, central corps and pavilions — is crowned with a keystone', () => {
  assert.match(palace, /somm/); // heritage: "arcades cintrées, sommées d'une clé"
  assert.match(palace, /'Wing arcade keystone'/);
  assert.match(palace, /'Central arcade keystone'/);
  assert.match(palace, /'Pavilion ground-floor arched opening'/);
  assert.match(palace, /'Pavilion arcade keystone'/);
  assert.match(palace, /box\(g, 0\.34, 0\.55, 0\.26, x, 7\.32, centralFace \+ 0\.3/);
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

testCase('two symmetrical curved galleries join the end pavilions along the square', () => {
  assert.match(palace, /symmetrical curved galleries/);
  assert.match(palace, /'Curved gallery column'/);
  assert.match(palace, /'Curved gallery capital'/);
  assert.match(palace, /'Curved gallery entablature'/);
  assert.match(palace, /'Curved gallery roof segment'/);
  assert.match(palace, /for \(let cgK = 0; cgK < 7; cgK\+\+\)/);
});

testCase('real-world fidelity lock: every documented feature of the real palace is present', () => {
  const markers = [
    /color: 0xece4d3/,
    /'Central entablature'/,
    /'Leopold II pediment medallion disc'/,
    /'Belgian flag stripe'/,
    /'Industry relief hammer head'/,
    /'Agriculture relief sickle'/,
    /'Escaut river relief'/,
    /'Meuse river relief'/,
    /'First-floor wrought-iron balcony rail'/,
    /'Ground-floor rusticated bossage blocks'/,
    /'Sunken parterre lawn'/,
    /'Gilded garden gate leaf'/,
    /'Gate pier gilded urn'/,
    /'Les Fleurs du Palais Royal pots'/,
    /'Portico perron step'/,
    /'Palace corner quoins'/,
    /'Wing oval roof window'/,
    /'Central corps mansard roof'/,
    /'Palace roof chimney stacks'/,
    /Palace rear wing/,
    /'Palace south rear avant-corps \(Throne Room\)'/,
    /'Place des Palais sett paving'/,
    /facadeWashMats\.push/,
    /nightGlowMats\.push/,
    /'Second-floor window keystone'/,
    /'Second-floor garland swag'/,
    /'Dome drum oculus'/,
    /'Leopold II monogram medallion'/,
    /'Main cornice modillions'/,
    /'Curved gallery column'/,
    /for \(let i = 0; i < 6; i\+\+\)/,
  ];
  for (const marker of markers) assert.match(palace, marker);
});

testCase('portico column shafts are fluted (fût cannelé)', () => {
  assert.match(palace, /fluted shafts/);
  assert.match(palace, /'Portico column fluting'/);
  assert.match(palace, /flutes\.count = fi/);
  assert.match(palace, /for \(let fk = 0; fk < 16; fk\+\+\)/);
});

testCase('piano nobile wing windows carry a small triangular pediment (inférieure à fronton)', () => {
  assert.match(palace, /inférieure à fronton/);
  assert.match(palace, /if \(floorY === 9\.9\)/);
  assert.match(palace, /'Piano nobile window pediment'/);
});

testCase('pavilion dormers (lucarne en pavillon) pierce the terminal pavilion roofs', () => {
  assert.match(palace, /lucarne en pavillon/);
  assert.match(palace, /'Pavilion dormer'/);
  assert.match(palace, /'Pavilion dormer window'/);
  assert.match(palace, /'Pavilion dormer pavilion roof'/);
  assert.match(palace, /for \(const dx of \[-3\.2, 0, 3\.2\]\)/);
});

testCase('double smooth colonnettes with socles flank each central attic window', () => {
  assert.match(palace, /Double smooth-shafted colonnettes/);
  assert.match(palace, /'Attic colonnette socle'/);
  assert.match(palace, /'Attic colonnette capital'/);
  assert.match(palace, /for \(const dx of \[-1\.95, 1\.95\]\)/);
});

testCase('a second row of attic oculi lights the central attic (deux rangs d’oeil-de-boeuf)', () => {
  assert.match(palace, /deux rangs d'œil-de-boeuf/);
  assert.match(palace, /'Central attic oculus'/);
  assert.match(palace, /'Central attic oculus surround'/);
  assert.match(palace, /for \(let i = 0; i < 4; i\+\+\)/);
});

testCase('the central corps roof is a flat terrasson bordered by a stone balustrade', () => {
  assert.match(palace, /flat terrasson bordered by a stone balustrade/);
  assert.match(palace, /'Central corps roof terrasson'/);
  assert.match(palace, /'Terrasson balustrade posts'/);
  assert.match(palace, /'Terrasson balustrade front rail'/);
  assert.match(palace, /trPost\.count = tri/);
});

testCase('the side façades keep the pilaster order of the front (aile de sept travées)', () => {
  assert.match(palace, /aile de sept travées/);
  assert.match(palace, /'Wing end pilaster'/);
  assert.match(palace, /box\(g, 0\.34, 20, 0\.3, side \* 70\.1, 10, -3\.5 - i \* 5/);
});

testCase('a palace-surroundings landmark carries the rectangular 13.1 ha Brussels Park lawn', () => {
  assert.match(palace, /rectangular 13\.1 ha neoclassical park/);
  assert.match(palace, /addLandmark\('palaceSurroundings'/);
  assert.match(palace, /'Brussels Park lawn'/);
});

testCase('a central avenue leads from the palace axis to the park main pond', () => {
  assert.match(palace, /central avenue leads to the main pond/);
  assert.match(palace, /'Park central avenue to the main pond'/);
});

testCase('the main park pond with its 1855 fountain stands at the end of the central avenue', () => {
  assert.match(palace, /constructed in 1855/);
  assert.match(palace, /'Park main pond rim'/);
  assert.match(palace, /'Park main pond water'/);
  assert.match(palace, /'Park main fountain jet'/);
});

testCase('the octagonal basin (1780) with eight Hermes busts rings the north end of the axis', () => {
  assert.match(palace, /octagonal basin \(1780\)/);
  assert.match(palace, /'Park octagonal basin rim'/);
  assert.match(palace, /'Park Hermes bust'/);
  assert.match(palace, /for \(let hk = 0; hk < 8; hk\+\+\)/);
});

testCase('two bandstands: Cluysenaar 1841 twelve-sided kiosk and the 1913 Vauxhall bandstand', () => {
  assert.match(palace, /twelve-sided cast-iron kiosk by Cluysenaar \(1841\)/);
  assert.match(palace, /'Park main bandstand kiosk'/);
  assert.match(palace, /'Park Vauxhall bandstand kiosk'/);
  assert.match(palace, /'Park Vauxhall bandstand dome'/);
});

testCase('monumental railings (erected 1849 to Suys designs) enclose the park with axis gates', () => {
  assert.match(palace, /erected in 1849/);
  assert.match(palace, /'Park perimeter railing posts'/);
  assert.match(palace, /'Park main gate pier'/);
  assert.match(palace, /parkRail\.count = pri/);
});

testCase('around sixty Greco-Roman statues on pedestals stand in Brussels Park', () => {
  assert.match(palace, /Greco-Roman mythology/);
  assert.match(palace, /'Park statue pedestals'/);
  assert.match(palace, /'Park statue figures'/);
  assert.match(palace, /for \(let i = 0; i < 60; i\+\+\)/);
});

testCase('three avenues radiate from the main pond toward the long views', () => {
  assert.match(palace, /three other avenues radiate/);
  assert.match(palace, /'Park radiating avenue'/);
  assert.match(palace, /av\.rotation\.y = Math\.PI \/ 2 - ra/);
});

testCase('rows of trees line the central avenue of Brussels Park', () => {
  assert.match(palace, /Tree-lined avenues/);
  assert.match(palace, /'Park avenue tree trunks'/);
  assert.match(palace, /'Park avenue tree canopies'/);
  assert.match(palace, /trunks\.count = tri2/);
});

testCase('the two shallows (bas-fonds) on the palace side of the park remain', () => {
  assert.match(palace, /Two shallows \(bas-fonds\)/);
  assert.match(palace, /'Park west shallow \(bas-fond\)'/);
  assert.match(palace, /'Park east shallow \(bas-fond\)'/);
});

testCase('the Academy Palace closes the east end of the Place des Palais (1823-28, Prince of Orange)', () => {
  assert.match(palace, /Prince of Orange by Vander Straeten and Suys/);
  assert.match(palace, /'Academy Palace main block'/);
  assert.match(palace, /'Academy Palace portico column'/);
  assert.match(palace, /'Academy Palace portico pediment'/);
  assert.match(palace, /'Academy Palace Ionic pilaster'/);
  assert.match(palace, /'Academy Palace attic'/);
});

testCase('the Academy Palace garden holds its six named statues', () => {
  assert.match(palace, /Stas monument/);
  assert.match(palace, /'Academy garden pedestal'/);
  assert.match(palace, /'Quetelet statue'/);
  assert.match(palace, /'Discobole statue'/);
  assert.match(palace, /'La Surprise statue'/);
});

testCase('the Hôtel Belle-Vue (BELvue museum) closes the west end of the Place des Palais', () => {
  assert.match(palace, /built 1776-77 by Philippe de Proft/);
  assert.match(palace, /'BELvue Hôtel Belle-Vue block'/);
  assert.match(palace, /'BELvue pavilion roof'/);
  assert.match(palace, /'BELvue piano nobile window'/);
});

testCase('the Place des Palais sett paving spans the full 350 m width of the square', () => {
  assert.match(palace, /70 x 350 m and entirely paved/);
  assert.match(palace, /'Place des Palais west sett field'/);
  assert.match(palace, /'Place des Palais full-width sett paving'/);
  assert.match(palace, /setts2\.count = si2/);
});

testCase('the Palace of the Nation faces the Royal Palace across the park on the axis', () => {
  assert.match(palace, /Guimard's 1778-83 neoclassical palace facing the Royal Palace/);
  assert.match(palace, /'Palace of the Nation central block'/);
  assert.match(palace, /'Palace of the Nation peristyle column'/);
  assert.match(palace, /'Palace of the Nation pediment'/);
  assert.match(palace, /for \(let i = 0; i < 8; i\+\+\)/);
});

testCase('Godecharle Justice relief figures and an attic balustrade crown the Palace of the Nation', () => {
  assert.match(palace, /Justice punishing Vices and rewarding/);
  assert.match(palace, /'Palace of the Nation pediment relief figure'/);
  assert.match(palace, /'Palace of the Nation attic balustrade'/);
  assert.match(palace, /pnBal\.count = pni/);
});

testCase('the Royal Stables stand south-east of the palace by the Rue Ducale', () => {
  assert.match(palace, /Royal Stables \(Écuries royales\)/);
  assert.match(palace, /'Royal Stables main range'/);
  assert.match(palace, /'Royal Stables hipped roof'/);
  assert.match(palace, /'Royal Stables arched window'/);
});

testCase('the equestrian statue of Leopold II stands on the Place du Trône south-east of the palace', () => {
  assert.match(palace, /Place du Trône, south-east of the palace/);
  assert.match(palace, /'Leopold II statue pedestal'/);
  assert.match(palace, /'Leopold II equestrian horse'/);
  assert.match(palace, /'Leopold II pedestal dedication plaque'/);
});

testCase('the Place du Trône carries three parterres from Balat 1868-69 design', () => {
  assert.match(palace, /three parterres and a monumental fence/);
  assert.match(palace, /'Place du Trône parterre bed'/);
  assert.match(palace, /'Place du Trône paving'/);
});

testCase('the four thoroughfares frame Brussels Park (Rue de la Loi, Royale, Ducale)', () => {
  assert.match(palace, /four thoroughfares/);
  assert.match(palace, /'Rue de la Loi street strip'/);
  assert.match(palace, /'Rue Royale street strip'/);
  assert.match(palace, /'Rue Ducale street strip'/);
});

testCase('the Royal Park Theatre (1782) stands on the park edge facing the Palace of the Nation', () => {
  assert.match(palace, /built 1782 on the Vaux-Hall site/);
  assert.match(palace, /'Royal Park Theatre block'/);
  assert.match(palace, /'Royal Park Theatre facade window'/);
  assert.match(palace, /'Royal Park Theatre entrance door'/);
});

testCase('the Poelaert south gatehouse (1857) crowns the park central path entrance', () => {
  assert.match(palace, /designed by Joseph Poelaert in/);
  assert.match(palace, /'Poelaert south gate entablature'/);
  assert.match(palace, /'Poelaert south gate pediment'/);
});

testCase('Art Deco lampposts (1930s) line the park avenues', () => {
  assert.match(palace, /Art Deco lampposts/);
  assert.match(palace, /'Park Art Deco lamppost poles'/);
  assert.match(palace, /'Park Art Deco lamp heads'/);
  assert.match(palace, /lampPole\.count = lpi/);
});

testCase('a double row of lime trees surrounds the park perimeter (19th century)', () => {
  assert.match(palace, /double row of lime trees/);
  assert.match(palace, /'Park perimeter lime trunks'/);
  assert.match(palace, /'Park perimeter lime canopies'/);
  assert.match(palace, /limeTrunk\.count = lti/);
});

testCase('the 1960s Parc/Park metro entrance pavilion stands in the park NW corner', () => {
  assert.match(palace, /north-western corner/);
  assert.match(palace, /'Parc metro entrance pavilion base'/);
  assert.match(palace, /'Parc metro entrance canopy'/);
});

testCase('the Hôtel de la Liste Civile attaches to the east end of the palace frontage', () => {
  assert.match(palace, /Hôtel de la Liste Civile stands at the EAST end/);
  assert.match(palace, /'Hôtel de la Liste Civile block'/);
  assert.match(palace, /'Liste Civile hipped roof'/);
  assert.match(palace, /'Liste Civile piano nobile window'/);
});

testCase('the palace rear gardens are English style with lawn and scattered trees', () => {
  assert.match(palace, /English style at the rear/);
  assert.match(palace, /'Rear English-style garden lawn'/);
  assert.match(palace, /'Rear garden tree canopies'/);
});

testCase('the portico carries a coffered soffit ceiling under the entablature', () => {
  assert.match(palace, /coffered soffit ceiling/);
  assert.match(palace, /'Portico soffit ceiling'/);
  assert.match(palace, /'Portico soffit coffers'/);
  assert.match(palace, /coffers\.count = cfi/);
});

testCase('the central avant-corps carries windows on its side faces too', () => {
  assert.match(palace, /oblique views from the square never see a blank side wall/);
  assert.match(palace, /'Central corps side window \(piano nobile\)'/);
  assert.match(palace, /'Central corps side window \(ground\)'/);
});

testCase('the dome lantern is crowned by a gilded finial ball and spike', () => {
  assert.match(palace, /gilded finial ball and spike/);
  assert.match(palace, /'Dome lantern gilded finial'/);
  assert.match(palace, /'Dome lantern finial spike'/);
});

testCase('a gravel central walk runs from the garden gate to the perron on the axis', () => {
  assert.match(palace, /gravel central walk runs from the garden gate/);
  assert.match(palace, /'Garden central walk'/);
});

testCase('each sunken parterre is edged with a clipped boxwood border', () => {
  assert.match(palace, /clipped boxwood border/);
  assert.match(palace, /'Parterre boxwood border'/);
});

testCase('bronze floodlight fixtures along the garden wall light the palace at night', () => {
  assert.match(palace, /floodlight fixtures stand along the garden/);
  assert.match(palace, /'Facade floodlight fixture'/);
  assert.match(palace, /'Facade floodlight head'/);
});

testCase('the Academy Palace avant-corps carry double pilasters, pediments and 1879 reliefs', () => {
  assert.match(palace, /1879 bas-reliefs of Arts, Letters, Sciences, Medicine/);
  assert.match(palace, /'Academy Palace avant-corps'/);
  assert.match(palace, /'Academy avant-corps double pilaster'/);
  assert.match(palace, /'Academy 1879 bas-relief panel'/);
});

testCase('the Academy Palace garden is closed along Rue Ducale by a balustraded wall', () => {
  assert.match(palace, /white-stone wall/);
  assert.match(palace, /'Academy Rue Ducale boundary wall'/);
  assert.match(palace, /'Academy boundary balustrade'/);
  assert.match(palace, /awBal\.count = awi/);
});

testCase('the BELvue pavilion carries corner quoins and hipped-roof dormers', () => {
  assert.match(palace, /chaînage d'angle/);
  assert.match(palace, /'BELvue corner quoin'/);
  assert.match(palace, /'BELvue dormer'/);
  assert.match(palace, /'BELvue dormer roof'/);
});

testCase('the Royal Stables open with a carriage arch onto the courtyard road', () => {
  assert.match(palace, /carriage arch on their courtyard front/);
  assert.match(palace, /'Royal Stables carriage arch'/);
  assert.match(palace, /'Royal Stables arch impost'/);
});

testCase('the Boulevard du Régent runs south-east from the Place du Trône (Small Ring)', () => {
  assert.match(palace, /Boulevard du Régent \(Small Ring\)/);
  assert.match(palace, /'Boulevard du Régent street strip'/);
  assert.match(palace, /bdR\.rotation\.y = Math\.PI \/ 4/);
});

testCase('the Rue Ducale extends south from the park to the Place du Trône', () => {
  assert.match(palace, /Rue Ducale runs south from the park/);
  assert.match(palace, /'Rue Ducale south extension to Place du Trône'/);
});

testCase('a carriage gate arch pierces the south avant-corps on the palace axis', () => {
  assert.match(palace, /accessible by road from the south/);
  assert.match(palace, /Cour d’honneur south carriage gate/);
  assert.match(palace, /'South carriage gate impost'/);
});

testCase('the Chamber and Senate hemicycles stand behind the Palace of the Nation', () => {
  assert.match(palace, /two hemicycles/);
  assert.match(palace, /'Chamber of Representatives hemicycle'/);
  assert.match(palace, /'Senate hemicycle'/);
  assert.match(palace, /'Senate hemicycle cornice'/);
});

testCase('16 rue de la Loi beside the Palace of the Nation is the Prime Minister seat', () => {
  assert.match(palace, /Law Street 16/);
  assert.match(palace, /'16 rue de la Loi Prime Minister seat'/);
  assert.match(palace, /'Law Street 16 window'/);
});

testCase('the 1769 statue of Prince Charles Alexander of Lorraine stands in the park', () => {
  assert.match(palace, /statue of Prince Charles Alexander of Lorraine/);
  assert.match(palace, /'Charles of Lorraine statue pedestal'/);
  assert.match(palace, /'Charles of Lorraine statue figure'/);
});

testCase('the Godecharle monument stands in Brussels Park', () => {
  assert.match(palace, /monument to Godecharle/);
  assert.match(palace, /'Godecharle monument pedestal'/);
  assert.match(palace, /'Godecharle monument figure'/);
});

testCase('string courses divide the central corps storeys on the front', () => {
  assert.match(palace, /String courses divide the central corps/);
  assert.match(palace, /'Central first string course'/);
  assert.match(palace, /'Central second string course'/);
});

testCase('every wing window has a projecting moulded surround (encadrement mouluré)', () => {
  assert.match(palace, /encadrement mouluré/);
  assert.match(palace, /'Wing window moulded surround'/);
});

testCase('the Academy Palace corner bays are coach-door entrances (portes cochères)', () => {
  assert.match(palace, /coach doors \(portes/);
  assert.match(palace, /'Academy Palace corner coach door'/);
  assert.match(palace, /'Academy coach door lintel'/);
});

testCase('the Palace of the Nation wings carry window grids and hipped roofs', () => {
  assert.match(palace, /window grids and slate roofs/);
  assert.match(palace, /'Palace of the Nation wing roof'/);
  assert.match(palace, /'Palace of the Nation wing window'/);
});

testCase('benches line the central avenue of Brussels Park', () => {
  assert.match(palace, /Benches line the park's central avenue/);
  assert.match(palace, /'Park avenue bench seat'/);
  assert.match(palace, /'Park avenue bench back'/);
});

testCase('the perron is flanked by stone balustrade ramps', () => {
  assert.match(palace, /flanked by stone balustrade ramps/);
  assert.match(palace, /'Perron side balustrade'/);
  assert.match(palace, /'Perron side rail'/);
});

testCase('the terminal pavilion roofs are crowned by gilded finial balls', () => {
  assert.match(palace, /gilded finial ball, like the dome lantern/);
  assert.match(palace, /'Pavilion roof gilded finial'/);
  assert.match(palace, /for \(const x of \[-76, 76\]\)/);
});

testCase('ground-floor wing openings carry wrought-iron grilles', () => {
  assert.match(palace, /wrought-iron grilles/);
  assert.match(palace, /'Wing ground-floor window grille'/);
  assert.match(palace, /'Wing grille bar'/);
});

testCase('the central entrance carries a gilded radial fanlight in the arch head', () => {
  assert.match(palace, /gilded fanlight/);
  assert.match(palace, /'Central entrance gilded fanlight'/);
  assert.match(palace, /'Central fanlight radial bar'/);
});

testCase('the rear range and south avant-corps are roofed in slate', () => {
  assert.match(palace, /roofed with slate/);
  assert.match(palace, /'Rear range slate roof'/);
  assert.match(palace, /'South avant-corps slate roof'/);
});

testCase('the Cour d’honneur is a gravelled court between the rear wings', () => {
  assert.match(palace, /gravelled court/);
  assert.match(palace, /'Cour d’honneur gravel court'/);
});

testCase('eight stone ribs stiffen the flattened dome from drum to lantern', () => {
  assert.match(palace, /eight stone ribs/);
  assert.match(palace, /'Dome rib'/);
  assert.match(palace, /for \(let ri = 0; ri < 8; ri\+\+\)/);
});

testCase('the Academy Palace has seven bays on its north and south faces', () => {
  assert.match(palace, /seven bays on its north and south faces/);
  assert.match(palace, /'Academy Palace side window'/);
  assert.match(palace, /for \(let i = 0; i < 7; i\+\+\)/);
});

testCase('the BELvue north face carries windows and an entrance door toward the park', () => {
  assert.match(palace, /BELvue north face/);
  assert.match(palace, /'BELvue north window'/);
  assert.match(palace, /'BELvue north entrance door'/);
});

testCase('the Palace of the Nation closes its U around the Place de la Nation courtyard', () => {
  assert.match(palace, /U-shaped around the Place de la Nation courtyard/);
  assert.match(palace, /'Palace of the Nation rear range'/);
  assert.match(palace, /'Place de la Nation courtyard paving'/);
});

testCase('a transverse walk crosses Brussels Park east-west at mid-depth', () => {
  assert.match(palace, /transverse walk crosses the park east-west/);
  assert.match(palace, /'Park transverse walk'/);
});

testCase('flower beds ring the main pond of Brussels Park', () => {
  assert.match(palace, /flower beds ring the main pond/);
  assert.match(palace, /'Park pond flower bed'/);
  assert.match(palace, /'Park pond flower planting'/);
});

testCase('a lighter paved vista carpet runs from the portico to the park north gate', () => {
  assert.match(palace, /central axis vista/);
  assert.match(palace, /'Place des Palais central axis vista'/);
});

testCase('a moulded base cornice runs at the foot of each wing mansard', () => {
  assert.match(palace, /mansard's base cornice/);
  assert.match(palace, /'Wing mansard base cornice'/);
});

testCase('the terminal pavilion cornices carry modillions', () => {
  assert.match(palace, /pavilion cornices carry modillions/);
  assert.match(palace, /'Terminal pavilion modillion'/);
  assert.match(palace, /for \(let mi2 = 0; mi2 < 7; mi2\+\+\)/);
});

testCase('the Academy Palace is roofed with a slate mansard and dormers', () => {
  assert.match(palace, /slate mansard carrying dormers/);
  assert.match(palace, /'Academy Palace mansard roof'/);
  assert.match(palace, /'Academy Palace roof dormer'/);
});

testCase('the Royal Stables wrap a paved courtyard with side and rear ranges', () => {
  assert.match(palace, /wrap a courtyard with a side range/);
  assert.match(palace, /'Royal Stables west range'/);
  assert.match(palace, /'Royal Stables rear range'/);
  assert.match(palace, /'Royal Stables courtyard paving'/);
});

testCase('the octagonal basin carries its own central fountain', () => {
  assert.match(palace, /own central fountain jet/);
  assert.match(palace, /'Octagonal basin fountain jet'/);
  assert.match(palace, /'Octagonal basin fountain spray'/);
});

testCase('the portico colonnade stands on a raised paved stylobate', () => {
  assert.match(palace, /raised paved stylobate floor/);
  assert.match(palace, /'Portico stylobate floor'/);
  assert.match(palace, /'Portico stylobate edge'/);
});

testCase('the main pediment is crowned with corner and apex acroteria', () => {
  assert.match(palace, /acroteria/);
  assert.match(palace, /'Pediment acroterion figure'/);
  assert.match(palace, /'Pediment acroterion head'/);
});

testCase('the Rue Royale extends south from the park toward the Place Royale', () => {
  assert.match(palace, /Rue Royale runs south from the park/);
  assert.match(palace, /'Rue Royale south extension to Place Royale'/);
});

testCase('the Academy boulevard side is scanned by blue-stone pilasters', () => {
  assert.match(palace, /blue-stone pilasters/);
  assert.match(palace, /'Academy boulevard-side blue-stone pilaster'/);
});

testCase('the wing end faces are capped by an end cornice and blocking course', () => {
  assert.match(palace, /end cornice/);
  assert.match(palace, /'Wing end cornice'/);
  assert.match(palace, /'Wing end blocking course'/);
});

testCase('the Palace of the Nation peristyle has an entablature and portico steps', () => {
  assert.match(palace, /full entablature over its columns/);
  assert.match(palace, /'Palace of the Nation peristyle entablature'/);
  assert.match(palace, /'Palace of the Nation portico step'/);
  assert.match(palace, /for \(let s = 0; s < 4; s\+\+\)/);
});

testCase('the central portico bay has a bronze double door with panels and gilded transom', () => {
  assert.match(palace, /bronze double entrance door/);
  assert.match(palace, /'Central bronze entrance door'/);
  assert.match(palace, /'Central door recessed panel'/);
  assert.match(palace, /'Central door gilded transom'/);
});

testCase('four clipped lawn panels fill Brussels Park between the walks', () => {
  assert.match(palace, /clipped lawn panels/);
  assert.match(palace, /'Park lawn panel'/);
  assert.match(palace, /'Park lawn panel edging'/);
});

testCase('a grille closes the Academy Palace garden to the north (wall to the west)', () => {
  assert.match(palace, /grille to the north and east/);
  assert.match(palace, /'Academy garden north grille'/);
  assert.match(palace, /agGrille\.count = agi/);
});

testCase('the pavilion outer faces are capped by an end cornice', () => {
  assert.match(palace, /pavilion outer faces are capped/);
  assert.match(palace, /'Pavilion outer cornice'/);
});

testCase('the BELvue roof carries a small balustraded terrace', () => {
  assert.match(palace, /balustraded terrace around its apex/);
  assert.match(palace, /'BELvue roof terrace balustrade'/);
  assert.match(palace, /bvBal\.count = bvi/);
});

testCase('the central garden gate is crowned by a pediment and gilded urn', () => {
  assert.match(palace, /crowned by a small pediment and gilded urn/);
  assert.match(palace, /'Garden central gate pediment'/);
  assert.match(palace, /'Garden central gate gilded urn'/);
});

testCase('busts of Roman emperors ring the main pond of the park', () => {
  assert.match(palace, /Busts of Roman emperors ring the main pond/);
  assert.match(palace, /'Park Roman emperor bust'/);
  assert.match(palace, /for \(let bk = 0; bk < 8; bk\+\+\)/);
});

testCase('a grille closes the Academy Palace garden to the east toward the palace', () => {
  assert.match(palace, /grilled to the east/);
  assert.match(palace, /'Academy garden east grille'/);
  assert.match(palace, /aeGrille\.count = aei/);
});

testCase('the rear Cour d’honneur wings are roofed in slate', () => {
  assert.match(palace, /rear Cour d'honneur wings are roofed in slate/);
  assert.match(palace, /'Rear wing slate roof'/);
});

testCase('the south avant-corps is capped by an end cornice over its pediment', () => {
  assert.match(palace, /capped by an end cornice over its pediment/);
  assert.match(palace, /'South avant-corps end cornice'/);
});

testCase('gilded finials mark the ends of each wing mansard ridge', () => {
  assert.match(palace, /ridge finials mark the ends/);
  assert.match(palace, /'Wing mansard ridge finial'/);
});

testCase('the Palace of the Nation colonnade stands on a stylobate platform', () => {
  assert.match(palace, /raised stylobate platform/);
  assert.match(palace, /'Palace of the Nation peristyle stylobate'/);
  assert.match(palace, /'Palace of the Nation stylobate edge'/);
});

testCase('the main bandstand kiosk has a raised orchestra platform', () => {
  assert.match(palace, /raised circular platform/);
  assert.match(palace, /'Bandstand orchestra platform'/);
});

testCase('the Rue de la Loi continues north past Parliament toward the EU quarter', () => {
  assert.match(palace, /north extension to the EU quarter/);
  assert.match(palace, /'Rue de la Loi north extension to the EU quarter'/);
});

testCase('each terminal pavilion carries a capped chimney stack', () => {
  assert.match(palace, /chimney stack with a stone cap/);
  assert.match(palace, /'Pavilion chimney stack'/);
  assert.match(palace, /'Pavilion chimney cap'/);
});

testCase('a moulded base course runs under the central attic', () => {
  assert.match(palace, /base course runs under the central attic/);
  assert.match(palace, /'Central attic base course'/);
});

testCase('the Academy Palace portico pediment carries an acroterion', () => {
  assert.match(palace, /pediment is crowned by a small sculptural acroterion/);
  assert.match(palace, /'Academy portico pediment acroterion'/);
});

testCase('surroundings fidelity lock: park, square, end buildings and Parliament all present', () => {
  const markers = [
    /'Brussels Park lawn'/,
    /'Park central avenue to the main pond'/,
    /'Park main pond rim'/,
    /'Park octagonal basin rim'/,
    /'Park Hermes bust'/,
    /'Park main bandstand kiosk'/,
    /'Park Vauxhall bandstand kiosk'/,
    /'Park perimeter railing posts'/,
    /'Poelaert south gate pediment'/,
    /'Park Art Deco lamppost poles'/,
    /'Park perimeter lime trunks'/,
    /'Park statue pedestals'/,
    /'Park Roman emperor bust'/,
    /'Place des Palais full-width sett paving'/,
    /'Academy Palace main block'/,
    /'Academy Palace portico pediment'/,
    /'Academy garden north grille'/,
    /'BELvue Hôtel Belle-Vue block'/,
    /'Hôtel de la Liste Civile block'/,
    /'Palace of the Nation central block'/,
    /'Palace of the Nation peristyle column'/,
    /'Chamber of Representatives hemicycle'/,
    /'Senate hemicycle'/,
    /'Royal Stables main range'/,
    /'Leopold II equestrian horse'/,
    /'Royal Park Theatre block'/,
    /'Parc metro entrance canopy'/,
    /'16 rue de la Loi Prime Minister seat'/,
  ];
  for (const marker of markers) assert.match(palace, marker);
});

testCase('the lateral garden gates carry pediments and gilded urns like the central gate', () => {
  assert.match(palace, /like the central gate/);
  assert.match(palace, /'Garden lateral gate pediment'/);
  assert.match(palace, /'Garden lateral gate gilded urn'/);
  assert.match(palace, /for \(const gx of \[-38, 38\]\)/);
});

testCase('final lock: palace and surroundings both fully present in the landmarks source', () => {
  const palaceMarkers = [
    /'Portico column fluting'/,
    /'Piano nobile window pediment'/,
    /'Pavilion dormer pavilion roof'/,
    /'Central attic oculus'/,
    /'Central corps roof terrasson'/,
    /'Wing end pilaster'/,
    /'Curved gallery column'/,
    /'Portico soffit coffers'/,
    /'Central corps side window \(piano nobile\)'/,
    /'Dome lantern gilded finial'/,
    /'Garden central walk'/,
    /'Facade floodlight fixture'/,
    /'Cour d’honneur south carriage gate'/,
    /'Portico stylobate floor'/,
    /'Pediment acroterion figure'/,
    /'Central bronze entrance door'/,
    /'Wing mansard base cornice'/,
    /'Terminal pavilion modillion'/,
    /'Rear wing slate roof'/,
    /'Wing mansard ridge finial'/,
    /'Pavilion chimney cap'/,
    /'Central attic base course'/,
    /'Garden lateral gate pediment'/,
  ];
  const surroundingsMarkers = [
    /addLandmark\('palaceSurroundings'/,
    /'Brussels Park lawn'/,
    /'Palace of the Nation central block'/,
    /'Academy Palace main block'/,
    /'BELvue Hôtel Belle-Vue block'/,
    /'Place des Palais full-width sett paving'/,
    /'Leopold II equestrian horse'/,
  ];
  for (const marker of [...palaceMarkers, ...surroundingsMarkers]) assert.match(palace, marker);
  assert.match(palace, /monument\.heritage\.brussels inventories 30402/);
});

testCase('the rear English-style garden lives in the surroundings landmark, not the palace bounds', () => {
  assert.match(palace, /'Rear English-style garden lawn'/);
  const surStart = palace.indexOf("addLandmark('palaceSurroundings'");
  const lawnIdx = palace.indexOf("'Rear English-style garden lawn'");
  assert.ok(surStart !== -1 && lawnIdx > surStart, 'rear garden must be inside the palaceSurroundings slice');
});

testCase('wing bay pilasters carry bases and capitals', () => {
  assert.match(palace, /'Wing bay pilaster base'/);
  assert.match(palace, /'Wing bay pilaster capital'/);
  assert.match(palace, /for \(let i = 0; i <= 9; i\+\+\)/);
});

testCase('every wing window sill rests on a projecting stone apron', () => {
  assert.match(palace, /projecting stone apron/);
  assert.match(palace, /'Wing window apron'/);
});

testCase('the central corps carries tall second-floor windows above the portico', () => {
  assert.match(palace, /tall windows on its second floor/);
  assert.match(palace, /'Central second-floor window'/);
  assert.match(palace, /'Central second-floor lintel'/);
});

testCase('each central ground-floor arch is ringed by an archivolt', () => {
  assert.match(palace, /archivolt of voussoirs/);
  assert.match(palace, /'Central arcade archivolt'/);
});

testCase('the wing ground-floor arches carry archivolt rings too', () => {
  assert.match(palace, /same archivolt rings/);
  assert.match(palace, /'Wing arcade archivolt'/);
});

testCase('a projecting plinth cap crowns the rusticated base of each wing', () => {
  assert.match(palace, /plinth cap crowns the rusticated base/);
  assert.match(palace, /'Wing plinth cap'/);
});

testCase('the palace grounds are enclosed by balustraded walls (south, east, west)', () => {
  assert.match(palace, /entirely enclosed by balustraded walls/);
  assert.match(palace, /'Palace grounds boundary wall'/);
  assert.match(palace, /'Palace grounds wall balustrade'/);
  assert.match(palace, /gwBal\.count = gwi/);
});

testCase('portico column shafts show drum joint bands', () => {
  assert.match(palace, /horizontal joint bands/);
  assert.match(palace, /'Portico column drum joints'/);
  assert.match(palace, /joints\.count = ji/);
});

testCase('the portico entablature has a cymatium and projecting corona', () => {
  assert.match(palace, /cymatium and a projecting corona/);
  assert.match(palace, /'Portico entablature cymatium'/);
  assert.match(palace, /'Portico entablature corona'/);
});

testCase('the pediment tympanum is an inset panel within its moulded frame', () => {
  assert.match(palace, /inset sculpted panel/);
  assert.match(palace, /'Pediment tympanum panel'/);
  assert.match(palace, /'Pediment tympanum frame base'/);
});

testCase('dormers pierce the front slope of each wing mansard', () => {
  assert.match(palace, /pierce the front slope/);
  assert.match(palace, /'Wing mansard dormer'/);
  assert.match(palace, /'Wing dormer pediment'/);
});

testCase('basement windows (soupiraux) pierce the south avant-corps base', () => {
  assert.match(palace, /'South avant-corps basement window'/);
});

testCase('tree rows line the three radiating avenues from the main pond', () => {
  assert.match(palace, /'Radiating avenue tree trunks'/);
  assert.match(palace, /'Radiating avenue tree canopies'/);
  assert.match(palace, /radTrunk\.count = rdi/);
});

testCase('stone edging kerbs flank the park central avenue', () => {
  assert.match(palace, /'Central avenue west edging kerb'/);
  assert.match(palace, /'Central avenue east edging kerb'/);
});

testCase('stone access steps lead down to the main pond rim on the axis', () => {
  assert.match(palace, /'Main pond access step'/);
});

testCase('the 1868-69 monumental fence encloses Place du Trône with a palace-park gate', () => {
  assert.match(palace, /'Place du Trône monumental fence'/);
  assert.match(palace, /'Palace park entrance gate pier'/);
  assert.match(palace, /trFence\.count = tri3/);
});

testCase('bronze lamp standards with gilded globes flank the perron', () => {
  assert.match(palace, /'Perron lamp standard'/);
  assert.match(palace, /'Perron lamp gilded globe'/);
});

testCase('the Academy Palace stables block (1823-28) stands behind the palace', () => {
  assert.match(palace, /'Academy Palace stables block'/);
  assert.match(palace, /'Academy Palace stables roof'/);
  assert.match(palace, /'Academy stables arched window'/);
});

testCase('the BELvue museum has an entrance door with stone steps on the square facade', () => {
  assert.match(palace, /'BELvue entrance door'/);
  assert.match(palace, /'BELvue entrance lintel'/);
  assert.match(palace, /'BELvue entrance step'/);
});

testCase('the Palace of the Nation has attic windows and a main door under the pediment', () => {
  assert.match(palace, /'Palace of the Nation attic window'/);
  assert.match(palace, /'Palace of the Nation main door'/);
  assert.match(palace, /'Palace of the Nation entrance step'/);
});

testCase('the Academy Palace portico pediment holds a framed tympanum panel', () => {
  assert.match(palace, /'Academy Palace tympanum frame'/);
  assert.match(palace, /'Academy Palace tympanum panel'/);
});

testCase('stone lintels crown the BELvue piano nobile windows', () => {
  assert.match(palace, /'BELvue piano nobile lintel'/);
});

testCase('the Palace of the Nation flies EU and Belgian flags from cornice flagpoles', () => {
  assert.match(palace, /'Palace of the Nation flagpole'/);
  assert.match(palace, /'Palace of the Nation EU flag'/);
  assert.match(palace, /'Palace of the Nation Belgian flag'/);
});

testCase('the Royal Stables have a projecting gatehouse with pediment and gate door', () => {
  assert.match(palace, /'Royal Stables gatehouse'/);
  assert.match(palace, /'Royal Stables gatehouse pediment'/);
  assert.match(palace, /'Royal Stables gate door'/);
});

testCase('contrasting sett accent rows cross the Place des Palais on the palace axis', () => {
  assert.match(palace, /'Place des Palais sett accent row'/);
});

testCase('each perron step carries a dressed stone nosing strip', () => {
  assert.match(palace, /'Perron step nosing'/);
});

testCase('coping stones cap the rim of the park main pond', () => {
  assert.match(palace, /'Main pond rim coping'/);
  assert.match(palace, /pondCop\.count = pci/);
});

testCase('stone surrounds frame the wing end windows on both gable ends', () => {
  assert.match(palace, /'Wing end window surround'/);
  assert.match(palace, /'Wing end ground window surround'/);
});

testCase('the central portico balcony parapet is filled with iron balusters and a mid rail', () => {
  assert.match(palace, /'Central balcony baluster'/);
  assert.match(palace, /'Central balcony mid rail'/);
});

testCase('cast-iron street lamps with globes line the palace-square axis', () => {
  assert.match(palace, /'Square axis street lamp'/);
  assert.match(palace, /'Square axis street lamp globe'/);
});

testCase('a balustrade parapet crowns the Academy Palace attic', () => {
  assert.match(palace, /'Academy Palace attic baluster'/);
  assert.match(palace, /'Academy Palace attic balustrade rail'/);
});

testCase('console brackets carry the central portico balcony from the facade', () => {
  assert.match(palace, /'Central balcony console'/);
});

testCase('console brackets carry the wing first-floor balconies', () => {
  assert.match(palace, /'Wing balcony console'/);
});

testCase('the BELvue ground floor is bossaged with rusticated blocks', () => {
  assert.match(palace, /'BELvue ground floor bossage'/);
  assert.match(palace, /bossMesh.count = bossIdx/);
});

testCase('both Palace of the Nation wings carry rows of facade windows', () => {
  assert.match(palace, /'Palace of the Nation wing window'/);
});

testCase('corner quoins strengthen the BELvue square-facing corners', () => {
  assert.match(palace, /'BELvue corner quoin'/);
});

testCase('the gilded garden railing stands on a stone plinth', () => {
  assert.match(palace, /'Gilded garden railing plinth'/);
});

testCase('projecting end pavilions close both ends of the Academy Palace facade', () => {
  assert.match(palace, /'Academy Palace end pavilion'/);
  assert.match(palace, /'Academy Palace end pavilion cornice'/);
});

testCase('modillions line the underside of the Palace of the Nation cornice', () => {
  assert.match(palace, /'Palace of the Nation cornice modillion'/);
  assert.match(palace, /pnMod\.count = pmi/);
});

testCase('lanterns crown the piers of the park south gate on the palace axis', () => {
  assert.match(palace, /'Park south gate lantern'/);
  assert.match(palace, /'Park south gate lantern glass'/);
});

testCase('attic bases and capitals ring all twelve portico column shafts', () => {
  assert.match(palace, /'Portico column base'/);
  assert.match(palace, /'Portico column capital'/);
});

testCase('glazing muntins divide the central piano nobile French doors into panes', () => {
  assert.match(palace, /'Central French door muntin vertical'/);
  assert.match(palace, /'Central French door muntin horizontal'/);
});

testCase('dressed stone cheek walls flank both sides of the perron', () => {
  assert.match(palace, /'Perron cheek wall'/);
});

testCase('hayloft windows pierce the Royal Stables range under the eaves', () => {
  assert.match(palace, /'Royal Stables hayloft window'/);
});

testCase('a low stone wall encloses the Academy Palace garden toward the square', () => {
  assert.match(palace, /'Academy garden front wall'/);
});

testCase('a straight garden walk leads from the perron to the gilded railing', () => {
  assert.match(palace, /'Central garden walk'/);
});

testCase('broad stone steps lead up to the Palace of the Nation peristyle', () => {
  assert.match(palace, /'Palace of the Nation peristyle step'/);
});

testCase('stone planters with plantings flank the foot of the perron', () => {
  assert.match(palace, /'Perron planter'/);
  assert.match(palace, /'Perron planter planting'/);
});

testCase('a low wall encloses the Royal Stables courtyard', () => {
  assert.match(palace, /'Royal Stables courtyard wall'/);
});

testCase('stone edging kerbs flank the north radiating avenue from the pond', () => {
  assert.match(palace, /'Radiating avenue edging kerb'/);
});

testCase('triangular pediments cap the center of each Palace of the Nation wing', () => {
  assert.match(palace, /'Palace of the Nation wing pediment'/);
});

testCase('steps climb from the garden walk up to the portico stylobate', () => {
  assert.match(palace, /'Portico stylobate step'/);
});

testCase('low walls close the east and west sides of the Academy garden', () => {
  assert.match(palace, /'Academy garden side wall'/);
});

testCase('abacus blocks sit atop each portico column capital', () => {
  assert.match(palace, /'Portico column abacus'/);
});

testCase('lanterns crown the piers of the park north gate', () => {
  assert.match(palace, /'Park north gate lantern'/);
  assert.match(palace, /'Park north gate lantern glass'/);
});

testCase('a top rail closes the BELvue roof terrace balustrade', () => {
  assert.match(palace, /'BELvue roof terrace rail'/);
});

testCase('each of the eleven great flower pots stands on a stone pedestal', () => {
  assert.match(palace, /'Flower pot pedestal'/);
});

testCase('a circular sett ring surrounds the equestrian statue on the Place du Trone', () => {
  assert.match(palace, /'Place du Trone statue sett ring'/);
  assert.match(palace, /trRing\.count = tri4/);
});

testCase('a dentil course runs under the BELvue cornice', () => {
  assert.match(palace, /'BELvue cornice dentil'/);
  assert.match(palace, /bvDen\.count = bdi2/);
});

testCase('the Academy Palace portico shelters a central door with step and lintel', () => {
  assert.match(palace, /'Academy Palace portico door'/);
  assert.match(palace, /'Academy Palace portico door lintel'/);
  assert.match(palace, /'Academy Palace portico step'/);
});

testCase('a bottom rail completes the gilded garden railing', () => {
  assert.match(palace, /'Gilded garden railing bottom rail'/);
});

testCase('a low railing rings the park bandstand', () => {
  assert.match(palace, /'Park bandstand railing'/);
  assert.match(palace, /bsRail\.count = bsi/);
});

testCase('an architrave beam spans the Palace of the Nation peristyle', () => {
  assert.match(palace, /'Palace of the Nation architrave'/);
});

testCase('stone edging strips border the central garden walk', () => {
  assert.match(palace, /'Central garden walk edging'/);
});

testCase('coping stones cap the rim of the octagonal basin', () => {
  assert.match(palace, /'Octagonal basin rim coping'/);
  assert.match(palace, /obCop\.count = obi/);
});

testCase('bases and capitals finish the Academy Palace pilaster order', () => {
  assert.match(palace, /'Academy Palace pilaster base'/);
  assert.match(palace, /'Academy Palace pilaster capital'/);
});

testCase('flower boxes with plantings hang under the central balcony', () => {
  assert.match(palace, /'Central balcony flower box'/);
  assert.match(palace, /'Central balcony flower box planting'/);
});

testCase('corner quoins strengthen the Palace of the Nation facade corners', () => {
  assert.match(palace, /'Palace of the Nation corner quoin'/);
});

testCase('the great ground-floor door stands behind the portico colonnade', () => {
  assert.match(palace, /'Portico main door'/);
});

testCase('each Academy garden statue pedestal carries a bronze name plaque', () => {
  assert.match(palace, /'Academy statue plaque'/);
});

testCase('a low railing rings the Vauxhall bandstand', () => {
  assert.match(palace, /'Vauxhall bandstand railing'/);
  assert.match(palace, /vhRail\.count = vhi/);
});

testCase('capitals finish the pilasters on both wing end faces', () => {
  assert.match(palace, /'Wing end pilaster capital'/);
});

testCase('stone surrounds frame the BELvue piano nobile windows', () => {
  assert.match(palace, /'BELvue piano nobile surround'/);
});

testCase('a glazed fanlight crowns the portico main door', () => {
  assert.match(palace, /'Portico door fanlight'/);
});

testCase('a dovecote crowns the Royal Stables hipped roof', () => {
  assert.match(palace, /'Royal Stables dovecote'/);
  assert.match(palace, /'Royal Stables dovecote roof'/);
});

testCase('a stone plinth carries the park perimeter railing on all four sides', () => {
  assert.match(palace, /'Park south railing plinth'/);
  assert.match(palace, /'Park north railing plinth'/);
  assert.match(palace, /'Park west railing plinth'/);
  assert.match(palace, /'Park east railing plinth'/);
});

testCase('lamp standards with gilded globes flank the garden gates', () => {
  assert.match(palace, /'Garden gate lamp'/);
  assert.match(palace, /'Garden gate lamp globe'/);
});

testCase('an inset tympanum panel fills the Palace of the Nation pediment', () => {
  assert.match(palace, /'Palace of the Nation tympanum panel'/);
});

testCase('a moulded surround frames the portico main door', () => {
  assert.match(palace, /'Portico door jamb'/);
  assert.match(palace, /'Portico door lintel'/);
});

testCase('stone sills sit under each BELvue ground-floor window', () => {
  assert.match(palace, /'BELvue ground window sill'/);
});

testCase('the Academy Palace ground floor is bossaged', () => {
  assert.match(palace, /'Academy Palace ground bossage'/);
  assert.match(palace, /apBoss\.count = apBi/);
});

testCase('flower boxes with plantings line the wing balconies', () => {
  assert.match(palace, /'Wing balcony flower box'/);
  assert.match(palace, /'Wing balcony flower box planting'/);
});

testCase('stone sills sit under each Palace of the Nation facade window', () => {
  assert.match(palace, /'Palace of the Nation window sill'/);
});

testCase('a moulded cap crowns the central balcony rail', () => {
  assert.match(palace, /'Central balcony top cap'/);
});

testCase('stone lintels crown the Royal Stables arched windows', () => {
  assert.match(palace, /'Royal Stables window lintel'/);
});

testCase('a sill band runs under the Academy Palace ground-floor windows', () => {
  assert.match(palace, /'Academy Palace sill band'/);
});

testCase('transverse joint bands mark the central garden walk paving', () => {
  assert.match(palace, /'Central garden walk joint'/);
});

testCase('stone sills sit under each BELvue attic window', () => {
  assert.match(palace, /'BELvue attic window sill'/);
});

testCase('small caps crown the posts of the gilded garden railing', () => {
  assert.match(palace, /'Garden railing post cap'/);
});

testCase('stone lintels crown the Palace of the Nation wing windows', () => {
  assert.match(palace, /'Palace of the Nation wing window lintel'/);
});

testCase('a lower step completes the Academy Palace portico entrance flight', () => {
  assert.match(palace, /'Academy Palace portico lower step'/);
});

testCase('bronze escutcheon plates mark each central French door', () => {
  assert.match(palace, /'French door escutcheon'/);
});

testCase('urns stand along the Palace of the Nation attic balustrade', () => {
  assert.match(palace, /'Palace of the Nation balustrade urn'/);
  assert.match(palace, /pnUr\.count = pnui/);
});

testCase('a landing slab tops the perron at the foot of the portico', () => {
  assert.match(palace, /'Perron top landing'/);
});

testCase('a dentil course runs under the Academy Palace cornice', () => {
  assert.match(palace, /'Academy Palace cornice dentil'/);
  assert.match(palace, /apDn\.count = apDi/);
});

testCase('a bronze finial with gilded ball crowns the BELvue pavilion roof', () => {
  assert.match(palace, /'BELvue roof finial'/);
  assert.match(palace, /'BELvue roof finial ball'/);
});

testCase('a projecting plinth course bases the palace facade', () => {
  assert.match(palace, /'Facade plinth course'/);
});

testCase('each Hermes bust around the octagonal basin stands on a pedestal', () => {
  assert.match(palace, /'Hermes bust pedestal'/);
});

testCase('the central balcony rail sits on a projecting stone slab', () => {
  assert.match(palace, /'Central balcony slab'/);
});

testCase('attic bases ring each Palace of the Nation peristyle column', () => {
  assert.match(palace, /'Palace of the Nation column base'/);
});

testCase('a tall window pierces the Royal Stables gatehouse above the gate', () => {
  assert.match(palace, /'Royal Stables gatehouse window'/);
  assert.match(palace, /'Royal Stables gatehouse window lintel'/);
});

testCase('a stone threshold spans the gilded garden gate', () => {
  assert.match(palace, /'Garden gate threshold'/);
});

testCase('capitals crown each Palace of the Nation peristyle column', () => {
  assert.match(palace, /'Palace of the Nation column capital'/);
});

testCase('each wing balcony rests on a projecting stone slab', () => {
  assert.match(palace, /'Wing balcony slab'/);
});

testCase('an architrave spans the Academy Palace portico under the pediment', () => {
  assert.match(palace, /'Academy Palace portico architrave'/);
});

testCase('bollards mark the four corners of the Place des Palais', () => {
  assert.match(palace, /'Square corner bollard'/);
});

testCase('a muntin cross divides the portico door fanlight into panes', () => {
  assert.match(palace, /'Fanlight muntin vertical'/);
  assert.match(palace, /'Fanlight muntin horizontal'/);
});

testCase('keystones crown the Academy Palace ground-floor arched windows', () => {
  assert.match(palace, /'Academy Palace window keystone'/);
});

testCase('acroteria stand on the Palace of the Nation pediment', () => {
  assert.match(palace, /'Palace of the Nation pediment acroterion'/);
});

testCase('gate piers with caps flank the Royal Stables gate door', () => {
  assert.match(palace, /'Royal Stables gate pier'/);
  assert.match(palace, /'Royal Stables gate pier cap'/);
});

testCase('stone corbels carry the central balcony slab', () => {
  assert.match(palace, /'Central balcony corbel'/);
});

testCase('benches face the main pond from its south rim', () => {
  assert.match(palace, /'Park pond bench seat'/);
  assert.match(palace, /'Park pond bench back'/);
});

testCase('stone lintels crown the BELvue ground-floor windows', () => {
  assert.match(palace, /'BELvue ground window lintel'/);
});

testCase('newel posts finish both ends of each wing balcony rail', () => {
  assert.match(palace, /'Wing balcony end newel'/);
});

testCase('a glazed fanlight crowns the Palace of the Nation main door', () => {
  assert.match(palace, /'Palace of the Nation door fanlight'/);
});

testCase('a ridge strip crowns the Academy Palace roofline', () => {
  assert.match(palace, /'Academy Palace roof ridge'/);
});

testCase('flanged bases anchor the perron lamp standards', () => {
  assert.match(palace, /'Perron lamp base flange'/);
});

testCase('stone sills sit under each BELvue piano nobile window', () => {
  assert.match(palace, /'BELvue piano nobile sill'/);
});

testCase('newel posts finish both ends of the central balcony rail', () => {
  assert.match(palace, /'Central balcony end newel'/);
});

testCase('keystones crown the Palace of the Nation facade windows', () => {
  assert.match(palace, /'Palace of the Nation window keystone'/);
});

testCase('the Academy stables block has a great door with lintel', () => {
  assert.match(palace, /'Academy stables door'/);
  assert.match(palace, /'Academy stables door lintel'/);
});

testCase('a cap strip crowns each perron side rail', () => {
  assert.match(palace, /'Perron side rail cap'/);
});

testCase('stone sills sit under each Palace of the Nation wing window', () => {
  assert.match(palace, /'Palace of the Nation wing window sill'/);
});

testCase('bronze threshold plates span each central French door', () => {
  assert.match(palace, /'French door threshold'/);
});

testCase('windows pierce the Academy Palace attic storey', () => {
  assert.match(palace, /'Academy Palace attic window'/);
});

testCase('modillions line the underside of the BELvue cornice', () => {
  assert.match(palace, /'BELvue cornice modillion'/);
  assert.match(palace, /bvMd\.count = bvMi/);
});

testCase('cap slabs finish both perron cheek walls', () => {
  assert.match(palace, /'Perron cheek wall cap'/);
});

testCase('quoins strengthen the facade corners of both Palace of the Nation wings', () => {
  assert.match(palace, /'Palace of the Nation wing quoin'/);
});

testCase('stone lintels crown the wing end windows on both gable ends', () => {
  assert.match(palace, /'Wing end window lintel'/);
  assert.match(palace, /'Wing end ground window lintel'/);
});

testCase('attic bases ring each Academy Palace portico column', () => {
  assert.match(palace, /'Academy portico column base'/);
});

testCase('stone lintels crown the Royal Stables hayloft windows', () => {
  assert.match(palace, /'Royal Stables hayloft lintel'/);
});

testCase('corner posts with gilded finials close the garden railing run', () => {
  assert.match(palace, /'Garden railing corner post'/);
  assert.match(palace, /'Garden railing corner post finial'/);
});

testCase('capitals crown each Academy Palace portico column', () => {
  assert.match(palace, /'Academy portico column capital'/);
});

testCase('corner quoins strengthen the palace facade corners', () => {
  assert.match(palace, /'Facade corner quoin'/);
});

testCase('urns stand at the four corners of the BELvue roof terrace', () => {
  assert.match(palace, /'BELvue roof terrace urn'/);
});

testCase('lanterns flank the main door of the Palace of the Nation', () => {
  assert.match(palace, /'Palace of the Nation entrance lantern'/);
  assert.match(palace, /'Palace of the Nation entrance lantern glass'/);
});

testCase('rim stones finish the two perron planters', () => {
  assert.match(palace, /'Perron planter rim'/);
});

testCase('keystones crown the BELvue piano nobile windows', () => {
  assert.match(palace, /'BELvue window keystone'/);
});

testCase('arms carry the gilded globes from the perron lamp standards', () => {
  assert.match(palace, /'Perron lamp arm'/);
});

testCase('a sett-paved yard lies behind the Academy stables block', () => {
  assert.match(palace, /'Academy stables yard paving'/);
});

testCase('collar rings anchor the emperor bust pedestals around the pond', () => {
  assert.match(palace, /'Pond emperor bust collar'/);
});

testCase('a moulded cap finishes the front edge of the portico stylobate', () => {
  assert.match(palace, /'Stylobate edge cap'/);
});

testCase('collars anchor the statue pedestals in the Academy garden', () => {
  assert.match(palace, /'Academy statue base collar'/);
});

testCase('caps finish the posts of the perron side rails', () => {
  assert.match(palace, /'Perron rail post cap'/);
});

testCase('a centre mullion divides each Palace of the Nation facade window', () => {
  assert.match(palace, /'Palace of the Nation window mullion'/);
});

testCase('stone lintels crown the BELvue attic windows', () => {
  assert.match(palace, /'BELvue attic window lintel'/);
});

testCase('rim rings finish the eleven great flower pots', () => {
  assert.match(palace, /'Flower pot rim'/);
});

testCase('centre mullions divide the Palace of the Nation wing windows', () => {
  assert.match(palace, /'Palace of the Nation wing window mullion'/);
});

testCase('mullions divide the wing end windows on both gable ends', () => {
  assert.match(palace, /'Wing end window mullion'/);
  assert.match(palace, /'Wing end ground window mullion'/);
});

testCase('mullions divide the Academy Palace first-floor windows', () => {
  assert.match(palace, /'Academy Palace first-floor mullion'/);
});

testCase('mullions divide the BELvue ground-floor windows', () => {
  assert.match(palace, /'BELvue ground window mullion'/);
});

testCase('a transom bar crosses each central French door near its head', () => {
  assert.match(palace, /'Central French door transom bar'/);
});

testCase('keystones crown the Royal Stables arched windows', () => {
  assert.match(palace, /'Royal Stables window keystone'/);
});

testCase('stone sills sit under the wing end windows on both gable ends', () => {
  assert.match(palace, /'Wing end window sill'/);
  assert.match(palace, /'Wing end ground window sill'/);
});

testCase('a moulded surround frames the Palace of the Nation main door', () => {
  assert.match(palace, /'Palace of the Nation door jamb'/);
  assert.match(palace, /'Palace of the Nation door lintel'/);
});

testCase('jambs frame the BELvue entrance door', () => {
  assert.match(palace, /'BELvue door jamb'/);
});

testCase('moulded edges finish the sides of each perron step', () => {
  assert.match(palace, /'Perron step edge'/);
});

testCase('mullions divide the BELvue piano nobile windows', () => {
  assert.match(palace, /'BELvue piano nobile mullion'/);
});

testCase('glazed side lights flank the central portico door', () => {
  assert.match(palace, /'Portico door side light'/);
});

testCase('mullions divide the Academy Palace ground-floor arched windows', () => {
  assert.match(palace, /'Academy Palace ground mullion'/);
});

testCase('a frieze band runs above the Palace of the Nation architrave', () => {
  assert.match(palace, /'Palace of the Nation frieze band'/);
});

testCase('dark soil fills the two perron planters', () => {
  assert.match(palace, /'Perron planter soil'/);
});

testCase('raking cornices follow both slopes of the Academy pediment', () => {
  assert.match(palace, /'Academy pediment raking cornice'/);
});

testCase('collar rings decorate the perron lamp standards', () => {
  assert.match(palace, /'Perron lamp collar'/);
});

testCase('cheek stones flank the Palace of the Nation entrance steps', () => {
  assert.match(palace, /'Palace of the Nation step cheek'/);
});

testCase('cheek stones flank the BELvue entrance steps', () => {
  assert.match(palace, /'BELvue step cheek'/);
});

testCase('stone sills sit under the portico door side lights', () => {
  assert.match(palace, /'Portico side light sill'/);
});

testCase('mullions divide the Royal Stables arched windows', () => {
  assert.match(palace, /'Royal Stables window mullion'/);
});

testCase('mullions divide the portico door side lights', () => {
  assert.match(palace, /'Portico side light mullion'/);
});

testCase('a bed moulding crowns the Palace of the Nation cornice', () => {
  assert.match(palace, /'Palace of the Nation cornice bed moulding'/);
});

testCase('a gravel path crosses the Academy Palace garden', () => {
  assert.match(palace, /'Academy garden path'/);
});

testCase('cap strips crown the wing balcony rails', () => {
  assert.match(palace, /'Wing balcony rail cap'/);
});

testCase('cornices crown both Palace of the Nation wings', () => {
  assert.match(palace, /'Palace of the Nation wing cornice'/);
});

testCase('bases finish the pilasters on both wing end faces', () => {
  assert.match(palace, /'Wing end pilaster base'/);
});

testCase('a dentil course runs under the Academy stables cornice', () => {
  assert.match(palace, /'Academy stables cornice dentil'/);
  assert.match(palace, /asDn\.count = asDi/);
});

testCase('a balustrade crowns the BELvue attic storey', () => {
  assert.match(palace, /'BELvue attic baluster'/);
  assert.match(palace, /'BELvue attic balustrade rail'/);
});

testCase('flower bands border the central garden walk', () => {
  assert.match(palace, /'Garden walk flower band'/);
});

testCase('a door with lintel pierces the west wing of the Palace of the Nation', () => {
  assert.match(palace, /'Palace of the Nation wing door'/);
  assert.match(palace, /'Palace of the Nation wing door lintel'/);
});

testCase('return caps close the ends of the stylobate edge cap', () => {
  assert.match(palace, /'Stylobate edge cap return'/);
});

testCase('a gate with piers and lintel opens into the Academy garden', () => {
  assert.match(palace, /'Academy garden gate pier'/);
  assert.match(palace, /'Academy garden gate lintel'/);
});

testCase('a sett medallion marks the centre of the Place des Palais', () => {
  assert.match(palace, /'Square axis medallion'/);
});

testCase('a kerb closes the garden walk at the gilded railing', () => {
  assert.match(palace, /'Garden walk end kerb'/);
});

testCase('a glazed fanlight crowns the BELvue entrance door', () => {
  assert.match(palace, /'BELvue door fanlight'/);
});

testCase('a leaf split divides the portico main door into two leaves', () => {
  assert.match(palace, /'Portico door leaf split'/);
});

testCase('volutes finish the Academy Palace pilaster capitals', () => {
  assert.match(palace, /'Academy pilaster volute'/);
});

testCase('a projecting plinth bases the Palace of the Nation facade', () => {
  assert.match(palace, /'Palace of the Nation base plinth'/);
});

testCase('a moulded edge finishes the front of each wing balcony slab', () => {
  assert.match(palace, /'Wing balcony slab edge'/);
});

testCase('side gates open in the east and west park railings', () => {
  assert.match(palace, /'Park side gate pier'/);
  assert.match(palace, /'Park side gate lintel'/);
});

testCase('low walls border the central garden walk', () => {
  assert.match(palace, /'Garden walk low wall'/);
});

testCase('stone surrounds frame the Royal Stables arched windows', () => {
  assert.match(palace, /'Royal Stables window surround'/);
});

testCase('pilasters strengthen the BELvue square-facing corners', () => {
  assert.match(palace, /'BELvue corner pilaster'/);
});

testCase('a base rail joins the feet of the central balcony balusters', () => {
  assert.match(palace, /'Central balcony base rail'/);
});

testCase('stone surrounds frame the Academy ground-floor arched windows', () => {
  assert.match(palace, /'Academy ground window surround'/);
});

testCase('hinge straps secure the portico main door leaves', () => {
  assert.match(palace, /'Portico door hinge'/);
});

testCase('jambs frame the Palace of the Nation wing door', () => {
  assert.match(palace, /'Palace of the Nation wing door jamb'/);
});

testCase('a stone rim rings the fountain jet of the main pond', () => {
  assert.match(palace, /'Park fountain rim'/);
});

testCase('a cap finishes the plinth of the gilded garden railing', () => {
  assert.match(palace, /'Garden railing plinth cap'/);
});

testCase('a projecting cornice tops the Palace of the Nation peristyle entablature', () => {
  assert.match(palace, /'Palace of the Nation peristyle cornice'/);
});

testCase('corbels carry each wing balcony slab from the facade', () => {
  assert.match(palace, /'Wing balcony corbel'/);
});

testCase('a stylobate platform carries the Academy portico columns', () => {
  assert.match(palace, /'Academy portico stylobate'/);
});

testCase('a recessed panel surrounds the BELvue entrance door', () => {
  assert.match(palace, /'BELvue entrance recess panel'/);
});

testCase('a moulded edge finishes the front of the central balcony slab', () => {
  assert.match(palace, /'Central balcony slab edge'/);
});

testCase('a door with lintel pierces the east wing of the Palace of the Nation', () => {
  assert.match(palace, /'Palace of the Nation east wing door'/);
  assert.match(palace, /'Palace of the Nation east wing door lintel'/);
});

testCase('a moulding closes the underside of the central balcony slab', () => {
  assert.match(palace, /'Central balcony underside moulding'/);
});

testCase('stone sills sit under the Academy first-floor windows', () => {
  assert.match(palace, /'Academy first-floor window sill'/);
});

testCase('a bed moulding crowns the front edge of the BELvue cornice', () => {
  assert.match(palace, /'BELvue cornice bed moulding'/);
});

testCase('shoes anchor the perron side rail posts', () => {
  assert.match(palace, /'Perron rail post shoe'/);
});

testCase('jambs frame the Palace of the Nation east wing door', () => {
  assert.match(palace, /'Palace of the Nation east wing door jamb'/);
});

testCase('brackets carry the wing balcony flower boxes', () => {
  assert.match(palace, /'Wing flower box bracket'/);
});

testCase('stone sills sit under the Royal Stables arched windows', () => {
  assert.match(palace, /'Royal Stables window sill'/);
});

testCase('keystones crown the BELvue ground-floor windows', () => {
  assert.match(palace, /'BELvue ground window keystone'/);
});

testCase('brackets carry the central balcony flower box', () => {
  assert.match(palace, /'Central flower box bracket'/);
});

testCase('stone lintels crown the Academy ground-floor arched windows', () => {
  assert.match(palace, /'Academy ground window lintel'/);
});

testCase('a bed moulding sits between the portico architrave and cornice', () => {
  assert.match(palace, /'Portico architrave bed moulding'/);
});

testCase('keystones crown the Palace of the Nation wing windows', () => {
  assert.match(palace, /'Palace of the Nation wing window keystone'/);
});

testCase('mullions divide the BELvue attic windows', () => {
  assert.match(palace, /'BELvue attic window mullion'/);
});

testCase('mid rails run between the wing balcony balusters', () => {
  assert.match(palace, /'Wing balcony mid rail'/);
});

testCase('jambs frame the Academy Palace portico door', () => {
  assert.match(palace, /'Academy portico door jamb'/);
});

testCase('lintels crown the portico door side lights', () => {
  assert.match(palace, /'Portico side light lintel'/);
});

testCase('a tympanum panel fills the Royal Stables gatehouse pediment', () => {
  assert.match(palace, /'Royal Stables pediment tympanum'/);
});

testCase('windows pierce the Academy Palace end pavilions', () => {
  assert.match(palace, /'Academy end pavilion window'/);
});

testCase('dark soil fills the wing balcony flower boxes', () => {
  assert.match(palace, /'Wing flower box soil'/);
});

testCase('hayloft windows pierce the Academy stables block under the eaves', () => {
  assert.match(palace, /'Academy stables hayloft window'/);
});

testCase('dark soil fills the central balcony flower box', () => {
  assert.match(palace, /'Central flower box soil'/);
});

testCase('a projecting eave band rings the BELvue pavilion roof base', () => {
  assert.match(palace, /'BELvue pavilion eave'/);
});

testCase('a stone rim rings the fountain jet of the octagonal basin', () => {
  assert.match(palace, /'Octagonal basin fountain rim'/);
});

testCase('bottom rails join the feet of the wing balcony balusters', () => {
  assert.match(palace, /'Wing balcony bottom rail'/);
});

testCase('tympanum panels fill the Palace of the Nation wing pediments', () => {
  assert.match(palace, /'Palace of the Nation wing tympanum'/);
});

testCase('a bronze kick plate protects the foot of the portico main door', () => {
  assert.match(palace, /'Portico door kick plate'/);
});

testCase('jambs frame the great door of the Academy stables block', () => {
  assert.match(palace, /'Academy stables door jamb'/);
});

testCase('a projecting plinth bases the BELvue pavilion block', () => {
  assert.match(palace, /'BELvue base plinth'/);
});

testCase('gilded balls crown the perron side rail posts', () => {
  assert.match(palace, /'Perron rail post ball'/);
});

testCase('small pediments cap the Academy Palace end pavilions', () => {
  assert.match(palace, /'Academy end pavilion pediment'/);
});

testCase('cap strips finish the wing balcony corbels', () => {
  assert.match(palace, /'Wing balcony corbel cap'/);
});

testCase('kerbs edge both sides of the BELvue entrance steps', () => {
  assert.match(palace, /'BELvue step kerb'/);
});

testCase('a dentil course runs under the Royal Stables gatehouse cornice', () => {
  assert.match(palace, /'Royal Stables gatehouse dentil'/);
  assert.match(palace, /rsDn\.count = rsDi/);
});

testCase('a rim finishes the central balcony flower box', () => {
  assert.match(palace, /'Central flower box rim'/);
});

testCase('kerbs edge both sides of the Academy portico steps', () => {
  assert.match(palace, /'Academy portico step kerb'/);
});

testCase('rims finish the wing balcony flower boxes', () => {
  assert.match(palace, /'Wing flower box rim'/);
});

testCase('raking cornices follow both slopes of the Palace of the Nation pediment', () => {
  assert.match(palace, /'Palace of the Nation raking cornice'/);
});

testCase('kerbs flank the west radiating avenue from the main pond', () => {
  assert.match(palace, /'Radiating avenue west kerb'/);
});

testCase('a nosing strip edges the front stylobate step', () => {
  assert.match(palace, /'Stylobate step nosing'/);
});

testCase('kerbs flank the east radiating avenue from the main pond', () => {
  assert.match(palace, /'Radiating avenue east kerb'/);
});

testCase('a sill bar closes the foot of the portico door fanlight', () => {
  assert.match(palace, /'Fanlight sill bar'/);
});

testCase('a gate opens in the Royal Stables courtyard wall', () => {
  assert.match(palace, /'Royal Stables yard gate pier'/);
  assert.match(palace, /'Royal Stables yard gate lintel'/);
});

testCase('keystones crown the BELvue attic windows', () => {
  assert.match(palace, /'BELvue attic window keystone'/);
});

testCase('a contrasting sett line runs down the centre of the garden walk', () => {
  assert.match(palace, /'Garden walk centre sett line'/);
});
