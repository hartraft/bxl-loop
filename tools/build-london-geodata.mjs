// tools/build-london-geodata.mjs — OSM (tools/data/osm_central.json) -> data/ldn-geo.json + data/ldn-buildings.bin
// usage: node --max-old-space-size=12000 tools/build-london-geodata.mjs [in.json] [outDir]
// Dependency-free. Decoder: js/ldn-geodata.js (format documented there). ~1 min.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME, WORLD_BOUNDS } from '../js/geo-frame.js';
import { log, Grid, expandBounds, pointInRing, centroid, bboxOf } from './geo-london-util.mjs';
import { buildBuildings, BUILDING_KINDS, MATERIALS, ROOFS } from './geo-london-buildings.mjs';
import { buildWater, buildParks, buildPlazas, buildBridgeOutlines, buildLandmarkZones, WATER_KINDS, PARK_KINDS } from './geo-london-areas.mjs';
import { buildRoads, buildRail, buildBridgeDecks, buildPoints, ROAD_KINDS, RAIL_KINDS, STATION_KINDS } from './geo-london-lines.mjs';
import { cleanRoads, ROAD_CAPS } from './geo-london-roadfix.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const IN = process.argv[2] || path.join(ROOT, 'tools/data/osm_central.json');
const OUT = process.argv[3] || path.join(ROOT, 'data');
const T0 = Date.now();
const lap = (s) => log(`${s} (${((Date.now() - T0) / 1000).toFixed(1)} s)`);

// ---- load ---------------------------------------------------------------------------------------------------------
const osm = JSON.parse(fs.readFileSync(IN, 'utf8'));
const nodes = [], ways = new Map(), relations = [];
for (const e of osm.elements) {
  if (e.type === 'node') nodes.push(e);
  else if (e.type === 'way') ways.set(e.id, e);
  else if (e.type === 'relation') relations.push(e);
}
osm.elements = null;
const byName = (re) => [...ways.values(), ...relations].filter((e) => e.tags && re.test(e.tags.name || ''));
const ctx = { nodes, ways, relations, byName };
lap(`loaded ${nodes.length} nodes, ${ways.size} ways, ${relations.length} relations`);

// ---- layers -------------------------------------------------------------------------------------------------------
const water = buildWater(ctx);
const WB = expandBounds(WORLD_BOUNDS, 100);
const waterGrid = new Grid(WB, 4);
for (const w of water) if (w.kind !== 'fountain' && w.kind !== 'river') waterGrid.fill([w.outer, ...w.holes], 1);
for (const w of water) if (w.kind === 'river') waterGrid.fill([w.outer, ...w.holes], 2); // 2 = the Thames
const parks = buildParks(ctx);
const plazas = buildPlazas(ctx);
const outlines = buildBridgeOutlines(ctx);
const zones = buildLandmarkZones(ctx);
lap('areas done');
const rawRoads = buildRoads(ctx);
const rail = buildRail(ctx);
const buildings = buildBuildings(ctx);
// landmark flags
const zoneBB = zones.map((z) => bboxOf(z.pts));
let nLm = 0;
const lmCount = {};
for (const b of buildings) {
  const c = centroid(b.ring);
  b.landmark = 0;
  for (let k = 0; k < zones.length; k++) {
    const bb = zoneBB[k];
    if (c[0] < bb.x0 || c[0] > bb.x1 || c[1] < bb.z0 || c[1] > bb.z1) continue;
    if (pointInRing(c[0], c[1], zones[k].pts)) { b.landmark = 1; nLm++; lmCount[zones[k].id] = (lmCount[zones[k].id] || 0) + 1; break; }
  }
}
log(`landmark buildings: ${nLm}`, JSON.stringify(lmCount));
// fountains that a landmark module draws (Trafalgar Square) are left to it
const waterOut = water.filter((w) => !(w.kind === 'fountain' && zones.some((z) => pointInRing(...centroid(w.outer), z.pts))));
lap('buildings done');
// roads that lead nowhere: short tunnels at grade, stubs dropped, gaps closed, dead-end caps, building passages
const fixed = cleanRoads(rawRoads, buildings, { rail, bounds: WORLD_BOUNDS, isWater: (x, z) => waterGrid.at(x, z) > 0, log });
const roads = fixed.roads, passages = fixed.passages, gates = fixed.gates;
log(`road clean-up: ${rawRoads.length} -> ${roads.length} roads`, JSON.stringify(fixed.stats));
const { bridges } = buildBridgeDecks(roads, rail, outlines, waterGrid);
const points = buildPoints(ctx);
lap('lines done');

// ---- encode -------------------------------------------------------------------------------------------------------
const names = [''];
const nameIdx = new Map([['', 0]]);
const N = (s) => { s = s || ''; let i = nameIdx.get(s); if (i === undefined) { i = names.length; names.push(s); nameIdx.set(s, i); } return i; };
const dm = (v) => Math.round(v * 10);
/** [x0,z0,dx1,dz1,...] decimetre ints */
const enc = (pts) => { const o = []; let px = 0, pz = 0; for (const [x, z] of pts) { const X = dm(x), Z = dm(z); o.push(X - px, Z - pz); px = X; pz = Z; } return o; };
const encFlat = (flat) => { // points layer: sort into 250 m cells row-major for small deltas
  const P = []; for (let i = 0; i < flat.length; i += 2) P.push([flat[i], flat[i + 1]]);
  const C = 250;
  P.sort((a, b) => Math.floor(a[1] / C) - Math.floor(b[1] / C) || a[0] - b[0]);
  return enc(P);
};
const idx = (arr) => (k) => { const i = arr.indexOf(k); if (i < 0) throw new Error('enum ' + k); return i; };
const ROAD_SUBS = [''];
const SUB = (s) => { let i = ROAD_SUBS.indexOf(s); if (i < 0) { if (ROAD_SUBS.length > 200) return 0; i = ROAD_SUBS.length; ROAD_SUBS.push(s); } return i; };
const POI_KINDS = [...new Set(points.pois.map((p) => p.kind))].sort();
const CROSSING_KINDS = ['zebra', 'signals'];

const json = {
  v: 1,
  source: process.env.CITY === 'brussels' ? 'OpenStreetMap contributors (ODbL), source file ' + path.basename(IN) + ', Brussels bbox 50.815,4.305,50.875,4.405' : 'OpenStreetMap contributors (ODbL), Geofabrik Greater London extract 2026-10-20',
  frame: FRAME, bounds: WORLD_BOUNDS,
  enums: { roadKinds: ROAD_KINDS, roadSubs: ROAD_SUBS, roadCaps: ROAD_CAPS, waterKinds: WATER_KINDS, parkKinds: PARK_KINDS, railKinds: RAIL_KINDS,
    stationKinds: STATION_KINDS, poiKinds: POI_KINDS, crossingKinds: CROSSING_KINDS, buildingKinds: BUILDING_KINDS, materials: MATERIALS, roofs: ROOFS },
  names,
  // [name, ref, w dm, lanes, maxspeed mph, flags, pts(, deck cm)] flags = kind | oneway+1 << 4 | bridge << 6 | tunnel << 7 |
  // roundabout << 8 | (layer + 8) << 9 | sub << 13; caps = capA index * 8 + capB index (enums.roadCaps), deck 0 = none
  roads: roads.map((r) => {
    const flags = idx(ROAD_KINDS)(r.kind) | ((r.oneway + 1) << 4) | (r.bridge << 6) | (r.tunnel << 7) | ((r.junction ? 1 : 0) << 8) |
      ((Math.max(-8, Math.min(7, r.layer)) + 8) << 9) | (SUB(r.sub) << 13);
    const o = [N(r.name), N(r.ref), dm(r.w), r.lanes, r.maxspeed, flags, enc(r.pts)];
    const caps = ROAD_CAPS.indexOf(r.capA || '') * 8 + ROAD_CAPS.indexOf(r.capB || '');
    if (r.deck || caps) o.push(r.deck ? r.deck.map((v) => Math.round(v * 100)) : 0);
    if (caps) o.push(caps);
    return o;
  }),
  // [road index, pts, w dm, minY dm, [x dm, z dm, nx %, nz %, …] portals, tag]
  passages: passages.map((p) => [p.road, enc(p.pts.reduce((a, v, i) => (i % 2 ? a[a.length - 1].push(v) : a.push([v]), a), [])), dm(p.w), dm(p.minY),
    p.portals.flatMap((q) => [dm(q.x), dm(q.z), Math.round(q.nx * 100), Math.round(q.nz * 100)]), p.tag]),
  // gateways where a dead end meets a wall: [road index, end (0 first / 1 last point), x dm, z dm, nx %, nz %, w dm, h dm]
  gates: gates.map((g) => [g.road, g.end, dm(g.x), dm(g.z), Math.round(g.nx * 100), Math.round(g.nz * 100), dm(g.w), dm(g.h)]),
  water: waterOut.map((w) => [idx(WATER_KINDS)(w.kind), N(w.name), enc(w.outer), w.holes.map(enc)]),
  parks: parks.map((p) => [idx(PARK_KINDS)(p.kind), N(p.name), enc(p.outer), p.holes.map(enc)]),
  plazas: plazas.map((p) => [N(p.name), enc(p.outer)]),
  rail: rail.map((r) => [idx(RAIL_KINDS)(r.kind), r.bridge, r.layer, enc(r.pts), r.deck ? r.deck.map((v) => Math.round(v * 100)) : 0]),
  bridges: bridges.map((b) => [N(b.name), enc(b.pts), Math.round(b.deckY * 100), b.axis ? b.axis.map(dm) : 0, b.synthetic ? 1 : 0]),
  stations: points.stations.map((s) => [N(s.name), idx(STATION_KINDS)(s.kind), dm(s.x), dm(s.z)]),
  pois: points.pois.map((p) => [idx(POI_KINDS)(p.kind), N(p.name), dm(p.x), dm(p.z)]),
  signals: encFlat(points.signals),
  busStops: encFlat(points.busStops),
  crossings: (() => { const c = points.crossings.slice().sort((a, b) => Math.floor(a.z / 250) - Math.floor(b.z / 250) || a.x - b.x);
    return { k: c.map((p) => CROSSING_KINDS.indexOf(p.kind)), p: enc(c.map((p) => [p.x, p.z])) }; })(),
  trees: encFlat(points.trees),
  districts: points.districts.map((d) => [N(d.name), dm(d.x), dm(d.z), d.rank]),
  landmarkZones: zones.map((z) => [z.id, enc(z.pts)])
};
// buildings: struct-of-arrays binary
const count = buildings.length;
let nPts = 0;
for (const b of buildings) nPts += b.ring.length;
const SECTIONS = [ // [name, bytesPerElement, elements]
  ['ringStart', 4, count + 1], ['origin', 4, count * 2], ['colour', 4, count], ['nameIdx', 4, count],
  ['delta', 2, nPts * 2], ['height', 2, count], ['minHeight', 2, count],
  ['kind', 1, count], ['material', 1, count], ['roof', 1, count], ['landmark', 1, count]
];
const HEADER = 20 + SECTIONS.length * 4;
const offs = {};
let off = HEADER;
for (const [n, bpe, len] of SECTIONS) { offs[n] = off; off += bpe * len; off = (off + 3) & ~3; }
const buf = Buffer.alloc(off);
buf.write('LDNB', 0, 'ascii');
buf.writeUInt32LE(1, 4); buf.writeUInt32LE(count, 8); buf.writeUInt32LE(nPts, 12); buf.writeUInt32LE(SECTIONS.length, 16);
SECTIONS.forEach(([n], i) => buf.writeUInt32LE(offs[n], 20 + i * 4));
let pi = 0;
buildings.forEach((b, i) => {
  buf.writeUInt32LE(pi, offs.ringStart + i * 4);
  const X0 = dm(b.ring[0][0]), Z0 = dm(b.ring[0][1]);
  buf.writeInt32LE(X0, offs.origin + i * 8); buf.writeInt32LE(Z0, offs.origin + i * 8 + 4);
  let px = X0, pz = Z0;
  for (const [x, z] of b.ring) {
    const X = dm(x), Z = dm(z);
    const dx = X - px, dz = Z - pz;
    if (Math.abs(dx) > 32767 || Math.abs(dz) > 32767) throw new Error('building delta overflow ' + b.id);
    buf.writeInt16LE(dx, offs.delta + pi * 4); buf.writeInt16LE(dz, offs.delta + pi * 4 + 2);
    px = X; pz = Z; pi++;
  }
  buf.writeUInt32LE(b.colour >>> 0, offs.colour + i * 4);
  buf.writeInt32LE(b.name ? N(b.name) : -1, offs.nameIdx + i * 4);
  buf.writeUInt16LE(Math.min(65535, Math.round(b.height * 10)), offs.height + i * 2);
  buf.writeUInt16LE(Math.min(65535, Math.round(b.minHeight * 10)), offs.minHeight + i * 2);
  buf.writeUInt8(b.kind, offs.kind + i); buf.writeUInt8(b.material, offs.material + i);
  buf.writeUInt8(b.roof, offs.roof + i); buf.writeUInt8(b.landmark, offs.landmark + i);
});
buf.writeUInt32LE(pi, offs.ringStart + count * 4);

fs.mkdirSync(OUT, { recursive: true });
const jsonStr = JSON.stringify(json);
const geoName = process.env.CITY === 'brussels' ? 'brx-geo.json' : 'ldn-geo.json';
const buildingName = process.env.CITY === 'brussels' ? 'brx-buildings.bin' : 'ldn-buildings.bin';
fs.writeFileSync(path.join(OUT, geoName), jsonStr);
fs.writeFileSync(path.join(OUT, buildingName), buf);
log(`wrote ${geoName} ${(jsonStr.length / 1e6).toFixed(2)} MB (` +
  Object.entries(json).filter(([, v]) => typeof v === 'object').map(([k, v]) => `${k} ${(JSON.stringify(v).length / 1e6).toFixed(2)}`).join(', ') + ')');
log(`wrote ${buildingName} ${(buf.length / 1e6).toFixed(2)} MB (${count} buildings, ${nPts} points)`);

// ---- city-specific water sanity check ---------------------------------------------------------------------------
if (process.env.CITY === 'brussels') {
  const canals = waterOut.filter((w) => w.kind === 'canal');
  const namedCanal = canals.filter((w) => /Canal Charleroi|Kanaal Brussel-Charleroi/i.test(w.name));
  log(`Brussels canal check: ${canals.length} canal polygons (${namedCanal.length} named Charleroi–Brussels canal sections)`);
} else {
  const g = new Grid(WORLD_BOUNDS, 8);
  for (const w of waterOut) if (w.kind === 'river') g.fill([w.outer, ...w.holes]);
  const seen = new Uint8Array(g.w * g.h), st = [];
  for (let r = 0; r < g.h; r++) { const i = r * g.w + g.w - 1; if (g.d[i]) { seen[i] = 1; st.push(i); } }
  let minC = Infinity;
  while (st.length) {
    const i = st.pop(), col = i % g.w, row = (i - col) / g.w;
    if (col < minC) minC = col;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = col + dc, rr = row + dr;
      if (cc < 0 || rr < 0 || cc >= g.w || rr >= g.h) continue;
      const j = rr * g.w + cc;
      if (g.d[j] && !seen[j]) { seen[j] = 1; st.push(j); }
    }
  }
  if (minC === Infinity) log('Thames check: no connected river polygon reached the east edge');
  else log(`Thames check: connected from east edge to x = ${(WORLD_BOUNDS.minX + minC * 8).toFixed(0)} (west edge ${WORLD_BOUNDS.minX.toFixed(0)})`);
}
lap('done');
