// Validate generated Brussels geodata before it is used by the browser runtime.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'data/brussels-build');
const geoPath = path.join(dir, 'brx-geo.json');
const buildingsPath = path.join(dir, 'brx-buildings.bin');
for (const p of [geoPath, buildingsPath]) {
  if (!fs.existsSync(p)) throw new Error(`Missing generated asset: ${p}`);
}
const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
const bin = fs.readFileSync(buildingsPath);
const fail = (message) => { throw new Error(`Brussels geodata validation failed: ${message}`); };

if (geo.v !== 1) fail(`unsupported geo version ${geo.v}`);
if (!geo.source?.includes('OpenStreetMap contributors (ODbL)')) fail('missing OpenStreetMap attribution / ODbL source');
if (geo.frame?.lat0 !== 50.84673 || geo.frame?.lon0 !== 4.35247) fail('wrong coordinate origin; expected Grand-Place');
if (geo.frame?.bbox?.south !== 50.815 || geo.frame?.bbox?.west !== 4.305 || geo.frame?.bbox?.north !== 50.875 || geo.frame?.bbox?.east !== 4.405) fail('wrong central Brussels extraction bounds');
if (!geo.bounds || !(geo.bounds.minX < 0 && geo.bounds.maxX > 0 && geo.bounds.minZ < 0 && geo.bounds.maxZ > 0)) fail('invalid play-area bounds');
for (const key of ['roads', 'water', 'parks', 'rail', 'stations', 'pois', 'landmarkZones']) {
  if (!Array.isArray(geo[key])) fail(`missing layer ${key}`);
}
if (geo.roads.length < 100) fail(`suspiciously few roads: ${geo.roads.length}`);
if (geo.parks.length < 1) fail('no parks were baked');
const canalFeatures = geo.water.filter((w) => geo.enums.waterKinds[w[0]] === 'canal');
const namedCanals = canalFeatures.filter((w) => /Canal Charleroi|Kanaal Brussel-Charleroi/i.test(geo.names[w[1]] || ''));
if (canalFeatures.length < 20) fail(`too few canal polygons: ${canalFeatures.length}`);
if (namedCanals.length < 1) fail('the Charleroi–Brussels canal was not found in the water layer');
const zoneIds = new Set(geo.landmarkZones.map((z) => z[0]));
for (const id of ['grandPlace', 'mannekenPis', 'montDesArts', 'royalPalace', 'cathedral', 'palaisDeJustice', 'cinquantenaire', 'europeanParliament', 'koekelbergBasilica']) {
  if (!zoneIds.has(id)) fail(`missing landmark zone ${id}`);
}
if (bin.toString('ascii', 0, 4) !== 'LDNB') fail('building binary has unexpected magic');
const count = bin.readUInt32LE(8), nPts = bin.readUInt32LE(12), nSections = bin.readUInt32LE(16);
if (count < 100 || nPts < count * 3) fail(`suspicious building counts: ${count} buildings / ${nPts} points`);
if (nSections !== 11) fail(`unexpected binary section count ${nSections}`);
const header = 20 + nSections * 4;
if (bin.length < header) fail('truncated building binary header');
const offsets = Array.from({ length: nSections }, (_, i) => bin.readUInt32LE(20 + i * 4));
if (offsets.some((offset) => offset < header || offset >= bin.length)) fail('binary section offset out of bounds');
console.log(JSON.stringify({
  status: 'ok',
  source: geo.source,
  roads: geo.roads.length,
  buildings: count,
  buildingPoints: nPts,
  parks: geo.parks.length,
  waterFeatures: geo.water.length,
  railFeatures: geo.rail.length,
  landmarkZones: geo.landmarkZones.length,
  geoBytes: fs.statSync(geoPath).size,
  buildingBytes: bin.length
}, null, 2));
