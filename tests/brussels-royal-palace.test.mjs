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
