// tests/geodata-brussels-base.test.mjs — sanity checks of the baked Brussels geodata (data/bxl-geo.json + data/bxl-buildings.bin).
// run: node --test tests/geodata-brussels-base.test.mjs   (rebuild first with: node --max-old-space-size=12000 tools/build-brussels-base-geodata.mjs)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GEO, BUILDING_KINDS } from '../js/bxl-geodata.js';
import { createWorldQueries } from '../js/brussels-world.js';
import { LANDMARK_ANCHORS, WORLD_BOUNDS, toWorld } from '../js/geo-frame.js';
import { TELEPORT_LOCATIONS, getLocationLabel, BRUSSELS_LANDMARKS } from '../js/brussels-config.js';
import { BuildingIndex, classifyEnds, insideRuns, drawnCar } from '../tools/geo-brussels-base-roadtopo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const world = createWorldQueries(GEO);
const B = GEO.buildings;

function inFlat(x, z, p) {
  let ins = false;
  for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function distToFlat(x, z, p) {
  if (inFlat(x, z, p)) return 0;
  let d = Infinity;
  for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], dx = p[i] - ax, dz = p[i + 1] - az, L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return d;
}
const inRange = (v, lo, hi, what) => assert.ok(v >= lo && v <= hi, `${what} = ${v}, expected ${lo}..${hi}`);

test('baked files exist and are compact', () => {
  const j = fs.statSync(root + 'data/bxl-geo.json').size, b = fs.statSync(root + 'data/bxl-buildings.bin').size;
  assert.ok(j < 6e6, `bxl-geo.json ${j} bytes`);
  assert.ok(b < 12e6, `bxl-buildings.bin ${b} bytes`);
});

test('counts are in sane ranges', () => {
  inRange(B.count, 50000, 160000, 'buildings');
  inRange(GEO.roads.length, 30000, 160000, 'roads');
  inRange(GEO.roads.filter((r) => ['primary', 'trunk'].includes(r.kind)).length, 2000, 20000, 'primary+trunk roads');
  inRange(GEO.water.length, 20, 2000, 'water');
  inRange(GEO.parks.length, 500, 20000, 'parks');
  inRange(GEO.stations.length, 50, 300, 'stations');
  inRange(GEO.signals.length / 2, 1000, 20000, 'signals');
  inRange(GEO.busStops.length / 2, 500, 10000, 'bus stops');
  inRange(GEO.trees.length / 2, 10000, 200000, 'trees');
  inRange(GEO.districts.length, 30, 1000, 'districts');
  inRange(GEO.bridges.filter((b) => b.deckY > 0).length, 15, 1000, 'raised bridges');
  assert.ok(GEO.landmarkZones.length >= 10);
  for (const n of ['Hyde Park', "The Regent's Park", "St. James's Park"]) assert.ok(GEO.parks.some((p) => p.name === n), n);
  for (const n of ['The Serpentine', "St. James's Park Lake"]) assert.ok(GEO.water.some((w) => w.name === n), n);
});

test('no NaNs, everything inside the play area', () => {
  const bx = { minX: WORLD_BOUNDS.minX - 300, maxX: WORLD_BOUNDS.maxX + 300, minZ: WORLD_BOUNDS.minZ - 300, maxZ: WORLD_BOUNDS.maxZ + 300 };
  const chk = (p, what) => {
    for (let i = 0; i < p.length; i += 2) {
      assert.ok(Number.isFinite(p[i]) && Number.isFinite(p[i + 1]), what + ' NaN');
      assert.ok(p[i] >= bx.minX && p[i] <= bx.maxX && p[i + 1] >= bx.minZ && p[i + 1] <= bx.maxZ, `${what} out of bounds ${p[i]},${p[i + 1]}`);
    }
  };
  for (const r of GEO.roads) { chk(r.pts, 'road'); assert.ok(r.w > 0 && r.pts.length >= 4); if (r.deck) assert.equal(r.deck.length * 2, r.pts.length); }
  for (const w of GEO.water) chk(w.pts, 'water');
  for (const p of GEO.parks) chk(p.pts, 'park');
  for (const r of GEO.rail) chk(r.pts, 'rail');
  chk(B.xz, 'building');
  chk(GEO.trees, 'tree');
  for (let i = 0; i < B.count; i++) assert.ok(Number.isFinite(B.height[i]) && Number.isFinite(B.minHeight[i]));
});

test('buildings: heights 2-320 m, CCW, not closed, the Shard ~310 m', () => {
  let maxH = 0, shard = 0;
  for (let i = 0; i < B.count; i++) {
    const h = B.height[i];
    inRange(h, 2, 320, 'height');
    assert.ok(B.minHeight[i] >= 0 && B.minHeight[i] < h);
    assert.ok(B.kind[i] < BUILDING_KINDS.length);
    const s = B.ringStart[i], e = B.ringStart[i + 1];
    assert.ok(e - s >= 3);
    let a = 0;
    for (let p = s; p < e; p++) {
      const q = p + 1 < e ? p + 1 : s;
      a += B.xz[p * 2] * B.xz[q * 2 + 1] - B.xz[q * 2] * B.xz[p * 2 + 1];
    }
    assert.ok(a < 0, `building ${i} not CCW from above`);
    assert.ok(!(B.xz[s * 2] === B.xz[(e - 1) * 2] && B.xz[s * 2 + 1] === B.xz[(e - 1) * 2 + 1]), 'closing point not deduped');
    maxH = Math.max(maxH, h);
    if (GEO.names[B.nameIdx[i]] === 'The Shard') { shard = Math.max(shard, h); assert.equal(B.landmark[i], 1); }
  }
  inRange(shard, 295, 320, 'Shard height');
  assert.equal(maxH, shard);
});

test('the Thames is one continuous water body from the south-west to the east edge', () => {
  const C = 8, W = Math.ceil((WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / C), H = Math.ceil((WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / C);
  const wet = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) wet[r * W + c] = world.isWater(WORLD_BOUNDS.minX + (c + 0.5) * C, WORLD_BOUNDS.minZ + (r + 0.5) * C) ? 1 : 0;
  const seen = new Uint8Array(W * H), st = [];
  for (let r = 0; r < H; r++) if (wet[r * W + W - 1]) { seen[r * W + W - 1] = 1; st.push(r * W + W - 1); }
  assert.ok(st.length > 20, 'river at the east edge');
  let minX = Infinity, touchesSouth = false;
  while (st.length) {
    const i = st.pop(), c = i % W, r = (i - c) / W;
    minX = Math.min(minX, c);
    if (r === H - 1) touchesSouth = true;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= W * H || (Math.abs((j % W) - c) > 1) || seen[j] || !wet[j]) continue;
      seen[j] = 1; st.push(j);
    }
  }
  const westX = WORLD_BOUNDS.minX + minX * C;
  assert.ok(westX < -3500, `river reaches only x=${westX}`);
  assert.ok(touchesSouth, 'river leaves through the south edge (Chelsea Reach)');
  // spot checks along the river: Westminster, Waterloo, Blackfriars, Brussels Bridge, Upper Pool, Tower Bridge, Chelsea
  for (const [lat, lon, n] of [[51.50085, -0.1225, 'Westminster'], [51.5078, -0.1165, 'Waterloo'], [51.5094, -0.1040, 'Blackfriars'],
    [51.5079, -0.0877, 'Brussels Bridge'], [51.5068, -0.0830, 'Upper Pool'], [51.5050, -0.0760, 'Tower Bridge'], [51.4832, -0.1640, 'Chelsea']]) {
    const w = toWorld(lat, lon);
    const c = Math.floor((w.x - WORLD_BOUNDS.minX) / C), r = Math.floor((w.z - WORLD_BOUNDS.minZ) / C);
    assert.ok(seen[r * W + c], `${n} not on the connected river`);
  }
});

test('every landmark anchor is inside or near its zone; landmark buildings are flagged', () => {
  const ids = [...new Set(GEO.landmarkZones.map((z) => z.id))];
  for (const k of ['bigBen', 'parliament', 'brusselsEye', 'towerBridge', 'shard', 'stPauls', 'gherkin', 'buckinghamPalace', 'nelsonsColumn', 'batterseaPowerStation']) assert.ok(ids.includes(k), k);
  for (const id of ids) {
    const a = LANDMARK_ANCHORS[id];
    const w = toWorld(a.lat, a.lon);
    const d = Math.min(...GEO.landmarkZones.filter((z) => z.id === id).map((z) => distToFlat(w.x, w.z, z.pts)));
    assert.ok(d < 30, `${id}: anchor ${d.toFixed(1)} m from zone`);
  }
  // Trafalgar Square zone covers only the column + fountains: the National Gallery stays a normal building
  let ng = 0;
  for (let i = 0; i < B.count; i++) if (/National Gallery/.test(GEO.names[B.nameIdx[i]] || '')) { ng++; assert.equal(B.landmark[i], 0); }
  let flagged = 0;
  for (let i = 0; i < B.count; i++) flagged += B.landmark[i];
  inRange(flagged, 20, 3000, 'landmark buildings');
});

test('bridges: Westminster Bridge deck is raised mid-span and ramps to 0 at the ends', () => {
  const wb = GEO.bridges.find((b) => b.name === 'Westminster Bridge' && b.axis);
  assert.ok(wb, 'Westminster Bridge outline');
  const a = wb.axis, mx = (a[0] + a[2]) / 2, mz = (a[1] + a[3]) / 2;
  inRange(world.groundHeight(mx, mz), 5, 10, 'deck mid-span');
  assert.ok(world.isWater(mx, mz));
  assert.equal(world.groundHeight(mx, mz, 'boat'), -1.2);
  assert.ok(world.groundHeight(a[0], a[1]) < 0.5 && world.groundHeight(a[2], a[3]) < 0.5, 'ends at grade');
  const road = GEO.roads.find((r) => r.name === 'Westminster Bridge' && r.deck && r.kind !== 'footway');
  assert.ok(road, 'road on Westminster Bridge has a deck profile');
  const k = Math.floor(road.pts.length / 4) * 2;
  assert.ok(Math.abs(world.groundHeight(road.pts[k], road.pts[k + 1]) - road.deck[k / 2]) < 0.6, 'groundHeight follows the road deck');
  assert.equal(world.groundHeight(0, -500), 0); // Charing Cross Road area: on the ground
});

test('roads: shared junction vertices survive simplification (graph can be built by hashing x,z)', () => {
  const vtx = new Map();
  const key = (x, z) => Math.round(x * 10) + ',' + Math.round(z * 10);
  GEO.roads.forEach((r, ri) => { for (let i = 0; i < r.pts.length; i += 2) { const k = key(r.pts[i], r.pts[i + 1]); vtx.set(k, (vtx.get(k) || 0) + 1); } });
  let ends = 0, joined = 0;
  const inner = { minX: WORLD_BOUNDS.minX + 60, maxX: WORLD_BOUNDS.maxX - 60, minZ: WORLD_BOUNDS.minZ + 60, maxZ: WORLD_BOUNDS.maxZ - 60 };
  for (const r of GEO.roads) {
    if (!['primary', 'secondary', 'tertiary', 'residential', 'trunk', 'unclassified'].includes(r.kind)) continue;
    for (const i of [0, r.pts.length - 2]) {
      const x = r.pts[i], z = r.pts[i + 1];
      if (x < inner.minX || x > inner.maxX || z < inner.minZ || z > inner.maxZ) continue;
      ends++;
      if (vtx.get(key(x, z)) > 1) joined++;
    }
  }
  assert.ok(joined / ends > 0.9, `only ${(100 * joined / ends).toFixed(1)}% of road ends join another road`);
  const oneways = GEO.roads.filter((r) => r.junction === 'roundabout');
  assert.ok(oneways.length > 20 && oneways.every((r) => r.oneway !== 0));
});

test('world queries: nearestRoad / streetName / districtAt / randomRoadPoint', () => {
  const ox = toWorld(51.5152, -0.1419);
  assert.match(world.streetName(ox.x, ox.z), /Oxford Street|Regent Street/);
  const soho = toWorld(51.5136, -0.1340);
  assert.equal(world.districtAt(soho.x, soho.z), 'Soho');
  let s = 7;
  const rng = () => ((s = (Math.imul(s, 48271) >>> 0) % 2147483647) / 2147483647);
  const p1 = world.randomRoadPoint(rng, { kinds: 'drive' });
  s = 7;
  const p2 = world.randomRoadPoint(rng, { kinds: 'drive' });
  assert.deepEqual([p1.x, p1.z], [p2.x, p2.z]);
  const n = world.nearestRoad(p1.x + 0.3, p1.z, { kinds: 'drive' });
  assert.ok(n && n.dist < 1);
});

test('teleports: on a road, inside the play area, not inside a building', () => {
  const ids = Object.keys(TELEPORT_LOCATIONS);
  assert.ok(ids.length >= 15);
  for (const t of Object.values(TELEPORT_LOCATIONS)) {
    assert.ok(t.x > WORLD_BOUNDS.minX && t.x < WORLD_BOUNDS.maxX && t.z > WORLD_BOUNDS.minZ && t.z < WORLD_BOUNDS.maxZ, t.id);
    const n = world.nearestRoad(t.x, t.z, { kinds: 'drive' });
    assert.ok(n && n.dist <= n.road.w / 2 + 0.5, `${t.id} ${n && n.dist} m off the road`);
    for (let i = 0; i < B.count; i++) {
      const s = B.ringStart[i] * 2, e = B.ringStart[i + 1] * 2;
      if (Math.abs(B.xz[s] - t.x) > 400 || Math.abs(B.xz[s + 1] - t.z) > 400) continue;
      if (B.minHeight[i] > 3) continue; // overhangs / walkways
      assert.ok(!inFlat(t.x, t.z, B.xz.subarray(s, e)), `${t.id} inside building ${GEO.names[B.nameIdx[i]] || i}`);
    }
    const l = getLocationLabel(t.x, t.z);
    assert.ok(l.primary && typeof l.text === 'string', t.id);
  }
  assert.ok(BRUSSELS_LANDMARKS.length >= 12);
});

test('roads lead somewhere: no dangling tunnel approaches, dead ends capped, passages through buildings exported', () => {
  const bidx = new BuildingIndex(B);
  const ends = classifyEnds(GEO.roads, { bidx, bounds: GEO.bounds, isWater: (x, z) => world.isWater(x, z) && !world.onBridge(x, z) });
  const cat = {};
  for (const e of ends) cat[e.cat] = (cat[e.cat] || 0) + 1;
  assert.ok((cat.tunnel_mouth || 0) <= 6, `tunnel approaches ending at nothing: ${cat.tunnel_mouth}`);
  assert.ok((cat.into_building || 0) <= 60, `dead ends inside buildings: ${cat.into_building}`);
  assert.ok((cat.gap || 0) <= 250, `unjoined gaps: ${cat.gap}`);
  const CAPS = ['', 'kerb', 'bollards', 'portal', 'gate'];
  const passRoads = new Set(GEO.passages.map((p) => p.road));
  let bare = 0;
  for (const e of ends) {
    if (['ok_junction', 'edge', 'touch'].includes(e.cat)) continue;
    const r = GEO.roads[e.ri], c = e.end ? r.capB : r.capA;
    assert.ok(CAPS.includes(c), 'cap ' + c);
    if (!c && !(e.cat === 'into_building' && passRoads.has(e.ri))) bare++;
  }
  assert.ok(bare <= 40, `${bare} dead ends with no treatment`);
  // gates sit on capped ends; passages have portals on real walls with an outward unit normal
  assert.ok(GEO.gates.length > 50 && GEO.passages.length > 100);
  for (const g of GEO.gates) assert.equal(g.end ? GEO.roads[g.road].capB : GEO.roads[g.road].capA, 'gate');
  for (const p of GEO.passages) {
    assert.ok(drawnCar(GEO.roads[p.road]) || GEO.roads[p.road].kind === 'pedestrian');
    assert.ok(p.portals.length >= 1 && p.minY >= 2.5 && p.minY <= 8 && p.pts.length >= 4);
    for (const q of p.portals) assert.ok(Math.abs(Math.hypot(q.nx, q.nz) - 1) < 0.03);
  }
  // carriageways inside ground-level buildings are (almost) all exported as passages
  let through = 0;
  for (const r of GEO.roads) if (drawnCar(r) && !passRoads.has(r.id) && insideRuns(r.pts, bidx).inside >= 3) through++;
  assert.ok(through <= 60, `${through} carriageways through buildings without a passage`);
});
