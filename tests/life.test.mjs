// tests/life.test.mjs — canal traffic, pigeons, aircraft, bus blinds on traffic buses, pedestrian
// life (queues, groups, photo stops, street shows) and rig gestures — headless (three.js loaded from vendor/, no GPU).
//   node --test tests/life.test.mjs
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = pathToFileURL(path.join(root, 'vendor/three')).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three' || spec === 'three/webgpu') return { url: '${vendor}/build/three.webgpu.js', shortCircuit: true };
  if (spec === 'three/tsl') return { url: '${vendor}/build/three.tsl.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: '${vendor}/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`));
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
globalThis.document = globalThis.document || { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx2d }), addEventListener() {} };

const THREE = await import('three/webgpu');
const { GEO } = await import('../js/brx-geodata.js');
const { WORLD } = await import('../js/brussels-config.js');
const { buildRiverPath } = await import('../js/life/river-path.js');
const { createBrusselsLife } = await import('../js/life/brussels-life.js');
const { createBusPlanner, FALLBACK_BUSES } = await import('../js/life/bus-routes.js');
const { buildRoadNetwork } = await import('../js/road-network.js');
const { createTrafficSim } = await import('../js/traffic-sim.js');
const { PersonRig } = await import('../js/pedestrians.js');
const { toWorld } = await import('../js/geo-frame.js');

const cam = (x, y, z, tx, ty, tz) => { const c = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 60000); c.position.set(x, y, z); c.lookAt(tx, ty, tz); c.updateMatrixWorld(); return c; };

test('canal fairway: on the water, both lanes apart, through the arches, quays found', () => {
  const r = buildRiverPath(WORLD);
  assert.ok(r.length > 1500 && r.length < 8000, `canal ${r.length} m`);
  let dry = 0, n = 0, minSep = Infinity;
  const a = {}, b = {};
  for (let s = 30; s < r.length - 30; s += 6) {
    r.at(s, r.laneOffset(s, 1), a); r.at(s, r.laneOffset(s, -1), b);
    for (const p of [a, b]) { n++; if (!WORLD.isWater(p.x, p.z)) dry++; }
    minSep = Math.min(minSep, Math.hypot(a.x - b.x, a.z - b.z));
  }
  console.log(`fairway ${r.length.toFixed(0)} m, lane samples on dry land ${dry}/${n}, min lane separation ${minSep.toFixed(1)} m, quays ${r.piers.length}`);
  assert.ok(dry / n < 0.01, `lanes on land ${dry}/${n}`);
  assert.ok(minSep > 7, `lanes ${minSep.toFixed(1)} m apart`);
  assert.ok(r.piers.length >= 3);
});

test('canal boats, aircraft, pigeons: move, stay on the water, keep apart, give way to the player, scatter', () => {
  const scene = new THREE.Scene();
  const life = createBrusselsLife(scene, { world: WORLD, planeInterval: 20 });
  // the canal runs north-south around x ≈ -1800
  const camera = cam(-1750, 30, 400, -1800, 0, 500);
  const player = { position: new THREE.Vector3(0, -1.2, 0), heading: 0, speed: 0, halfExtents: { hx: 3.95, hz: 13.5 } };
  // park the player's boat in the northbound lane, 300 m ahead of the first northbound boat
  const R = life.river.river, b0 = life.boats.find((b) => b.dir > 0 && b.s > 400 && b.s < R.length - 800);
  const ps = b0.s + 300, pt = R.at(ps, R.laneOffset(ps, 1));
  player.position.set(pt.x, -1.2, pt.z); player.heading = Math.atan2(pt.dx, pt.dz);
  let dry = 0, samples = 0, minGap = Infinity, scattered = 0, minPlayer = Infinity;
  const startS = life.boats.map((b) => b.s);
  for (let i = 0; i < 60 * 30; i++) {
    life.update(1 / 30, { camera, entity: player, mode: 'boat', night: 0 });
    if (i % 15) continue;
    for (const b of life.boats) {
      samples++;
      if (!WORLD.isWater(b.x, b.z) && !WORLD.onBridge?.(b.x, b.z)) dry++;
      for (const o of life.boats) if (o !== b && o.dir === b.dir) minGap = Math.min(minGap, Math.abs(o.s - b.s) - o.half - b.half + (Math.abs(o.lat - b.lat) > o.halfW + b.halfW + 2 ? 1e9 : 0));
      minPlayer = Math.min(minPlayer, Math.hypot(b.x - player.position.x, b.z - player.position.z));
    }
    scattered += life.events.filter((e) => e.type === 'scatter').length;
    life.events.length = 0;
  }
  const moved = life.boats.filter((b, i) => Math.abs(b.s - startS[i]) > 50).length;
  console.log(`boats ${life.boats.length}: moved ${moved}, off-water samples ${dry}/${samples}, closest same-lane gap ${minGap.toFixed(1)} m, closest to the player ${minPlayer.toFixed(1)} m, aircraft ${life.aircraft.length}, life ${life.stats.ms.toFixed(2)} ms`);
  assert.ok(moved >= life.boats.length - 3, 'boats move');
  assert.ok(dry / samples < 0.02, `boats off the water ${dry}/${samples}`);
  assert.ok(minGap > 2, `boats keep apart (${minGap.toFixed(1)})`);
  assert.ok(minPlayer > 13, `boats give way to the player's boat (closest ${minPlayer.toFixed(1)} m)`);
  assert.ok(life.aircraft.length >= 1, 'airliners on approach');
  for (const a of life.aircraft) assert.ok(a.y > 300 && a.y < 1700, `plane altitude ${a.y}`);
  // pigeons: walk a person into the Grand-Place flock
  const f = life.pigeons.flocks[0];
  const walker = { position: new THREE.Vector3(f.x + 20, 0, f.z), heading: -Math.PI / 2, speed: 1.4 };
  const cam2 = cam(f.x + 30, 5, f.z, f.x, 0, f.z);
  let flew = 0;
  for (let i = 0; i < 30 * 20; i++) {
    walker.position.x -= 1.4 / 30;
    life.update(1 / 30, { camera: cam2, entity: walker, mode: 'person' });
    flew = Math.max(flew, f.birds.filter((b) => b.y > 3).length);
    scattered += life.events.filter((e) => e.type === 'scatter' && !e.small).length;
    life.events.length = 0;
  }
  console.log(`pigeons: ${f.birds.length} in the flock at ${f.name}, up to ${flew} in the air, scatter events ${scattered}`);
  assert.ok(scattered >= 1 && flew > f.birds.length * 0.6, 'flock takes off');
  for (const b of f.birds) assert.ok(Number.isFinite(b.x + b.y + b.z), 'finite');
});

test('traffic buses take STIB route numbers & destinations from the fallback blind atlas', () => {
  const network = buildRoadNetwork(GEO, WORLD);
  const planner = createBusPlanner(network);
  const sim = createTrafficSim(network, { vehicles: 200, peds: 0, radius: 420, seed: 5, assignBus: planner.assign, replanBus: planner.replan });
  const cx = 0, cz = 0; // Grand-Place
  const ctx = { focusX: cx, focusZ: cz, visible: (x, z) => Math.hypot(x - cx, z - cz) < 150 };
  const refs = new Set(FALLBACK_BUSES.map(([ref]) => ref));
  let buses = 0, real = 0;
  for (let i = 0; i < 90 * 30; i++) {
    sim.step(1 / 30, ctx);
    if (i % 60) continue;
    for (const v of sim.vehicles) {
      if (!v.alive || !v.bus) continue;
      buses++;
      if (refs.has(v.route) && v.destination) real++;
    }
  }
  console.log(`bus samples ${buses}: STIB blinds ${real}, planner ${JSON.stringify(planner.stats)}`);
  assert.ok(buses > 20 && real / buses > 0.95, 'buses show STIB route numbers & destinations');
});

test('pedestrian life: bus-stop queues board buses, groups, tourists photograph landmarks, a street show', () => {
  const network = buildRoadNetwork(GEO, null);
  const gp = toWorld(50.84673, 4.35247);
  const LM = [{ x: gp.x, z: gp.z, r: 80 }];
  // focus on the bus stop closest to the Grand-Place (Rue du Lombard)
  let stop = null;
  for (let i = 0; i < GEO.busStops.length; i += 2) {
    const x = GEO.busStops[i], z = GEO.busStops[i + 1], d = Math.hypot(x - gp.x, z - gp.z);
    if (!stop || d < stop.d) stop = { x, z, d };
  }
  const sim = createTrafficSim(network, { vehicles: 120, peds: 260, radius: 420, seed: 7, busStops: GEO.busStops, touristAt: () => 0.4,
    lookAt: (x, z) => LM.find((l) => Math.hypot(x - l.x, z - l.z) < l.r * 2.5) || null, shows: [{ name: 'Lombard', x: stop.x + 25, z: stop.z + 15, crowd: 12 }] });
  const cx = stop.x, cz = stop.z;
  const ctx = { focusX: cx, focusZ: cz, visible: (x, z) => Math.hypot(x - cx, z - cz) < 90 };
  const seen = {};
  let boarded = 0;
  for (let i = 0; i < 180 * 30; i++) {
    sim.step(1 / 30, ctx);
    for (const p of sim.peds) {
      if (!p.alive) { if (p.boarded && !p._b) { boarded++; p._b = true; } continue; }
      p._b = false;
      seen[p.mode] = (seen[p.mode] || 0) + 1;
      if (p.leader >= 0) seen.group = (seen.group || 0) + 1;
      if (p.gesture) seen[p.gesture] = (seen[p.gesture] || 0) + 1;
      assert.ok(Number.isFinite(p.x + p.z + p.heading), 'finite ped');
    }
  }
  console.log('ped life:', JSON.stringify(seen), 'boarded', boarded, 'red runs', sim.stats.redRuns);
  for (const k of ['queue', 'group', 'photo', 'watch', 'perform', 'phone', 'cross']) assert.ok(seen[k] > 0, `seen ${k}`);
  assert.ok(boarded > 0, 'people board buses');
  assert.equal(sim.stats.redRuns, 0);
});

test('person rig gestures: arms go where they should, pose stays finite', () => {
  const rig = new PersonRig({ seed: 3 });
  const g = () => 0;
  rig.update(1 / 30, 0, 0, 0, g);
  const arm = () => [3, 5].map((bn) => Array.from(rig.pose.slice(bn * 8, bn * 8 + 4))); // upper-arm quaternions (L, R)
  for (let i = 0; i < 30; i++) rig.update(1 / 30, 0, 0, 0, g);
  const rest = arm();
  rig.gesture = 'cheer'; rig.gestureW = 1;
  for (let i = 0; i < 10; i++) rig.update(1 / 30, 0, 0, 0, g);
  const up = arm();
  const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
  assert.ok(ang(rest[0], up[0]) > 1.5 && ang(rest[1], up[1]) > 1.5, `arms raised when cheering (${ang(rest[0], up[0]).toFixed(2)} rad)`);
  for (const ges of ['photo', 'phone', 'clap', 'wave', 'point']) {
    rig.gesture = ges;
    for (let i = 0; i < 10; i++) rig.update(1 / 30, 0, 0, 0, g);
    for (const v of rig.pose) assert.ok(Number.isFinite(v), ges);
  }
});
