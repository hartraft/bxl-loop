// tests/traffic-sim.test.mjs — headless traffic simulation test (no rendering, no three.js).
//   node --test tests/traffic-sim.test.mjs        (≈1-3 min: 5 sim-minutes around the Grand-Place + 2 at Place Poelaert)
// Env: SIM_SECONDS (default 300), SIM_VEHICLES (default 200).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GEO } from '../js/brx-geodata.js';
import { buildRoadNetwork, ASPECT } from '../js/road-network.js';
import { createTrafficSim } from '../js/traffic-sim.js';

const SIM_SECONDS = +(process.env.SIM_SECONDS || 300);
const NV = +(process.env.SIM_VEHICLES || 200);
const DT = 1 / 30;
const now = () => performance.now();

const t0 = now();
const network = buildRoadNetwork(GEO, null);
const buildMs = now() - t0;

/** separating-axis overlap depth of two vehicles' footprints (m, <= 0: apart) */
function overlap(a, b) {
  const boxes = [a, b].map((v) => {
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    return { x: v.x, z: v.z, ax: [[fx, fz], [fz, -fx]], ext: [v.half, v.halfW] };
  });
  let minPen = Infinity;
  for (const B of boxes) {
    for (const [ux, uz] of B.ax) {
      const proj = (o) => Math.abs(o.ax[0][0] * ux + o.ax[0][1] * uz) * o.ext[0] + Math.abs(o.ax[1][0] * ux + o.ax[1][1] * uz) * o.ext[1];
      const d = Math.abs((boxes[1].x - boxes[0].x) * ux + (boxes[1].z - boxes[0].z) * uz);
      const pen = proj(boxes[0]) + proj(boxes[1]) - d;
      if (pen < minPen) minPen = pen;
    }
  }
  return minPen;
}

/** signed lateral offset of (x, z) from a polyline: + = left of its direction (left of (dx,dz) is (dz,-dx)); at a
 *  vertex (sharp corners) the side is taken across the bisector of the two segments */
function lateral(pts, x, z) {
  let best = Infinity, side = 0;
  const n = pts.length / 2;
  const dir = (i) => { const dx = pts[2 * i + 2] - pts[2 * i], dz = pts[2 * i + 3] - pts[2 * i + 1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  for (let i = 0; i + 1 < n; i++) {
    const ax = pts[2 * i], az = pts[2 * i + 1], dx = pts[2 * i + 2] - ax, dz = pts[2 * i + 3] - az, L2 = dx * dx + dz * dz;
    if (L2 < 1e-6) continue;
    let t = ((x - ax) * dx + (z - az) * dz) / L2;
    let ux = dx / Math.sqrt(L2), uz = dz / Math.sqrt(L2);
    if (t <= 0 && i > 0) { const [px, pz] = dir(i - 1); ux += px; uz += pz; }
    if (t >= 1 && i + 2 < n) { const [nx, nz] = dir(i + 1); ux += nx; uz += nz; }
    t = Math.max(0, Math.min(1, t));
    const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
    if (d < best - 1e-6) { best = d; const ul = Math.hypot(ux, uz) || 1; side = ((x - qx) * uz - (z - qz) * ux) / ul; }
  }
  return side;
}

const desc = (v) => `${v.id}:${v.type} ${v.seg.type}${v.seg.id}${v.seg.type === 'conn' ? '@n' + v.seg.node.id : ' ' + v.seg.link.name} s${v.s.toFixed(1)}/${v.seg.len.toFixed(1)} v${v.speed.toFixed(1)}${v.committed ? ' com' : ''}`;

/** is v first in line at a red light, or queued behind one? */
function queuedAtRed(sim, v) {
  for (let hop = 0, u = v; hop < 40 && u; hop++) {
    if (u.why === 'red' || u.why === 'red2' || u.why === 'amber') return true;
    const L = sim._leader(u);
    if (L.who < 0 || L.gap > 8) return false;
    u = sim.vehicles[L.who];
  }
  return false;
}

function runScenario({ cx, cz, seconds, vehicles = NV, peds = 180, seed = 7 }) {
  const sim = createTrafficSim(network, { vehicles, peds, radius: 420, seed });
  sim.events = [];
  const visible = (x, z) => Math.hypot(x - cx, z - cz) < 150; // a camera looking at the centre: no recycling there
  const ctx = { focusX: cx, focusZ: cz, visible };
  const r = {
    sim, steps: 0, ms: [], overlaps: [], maxPen: 0, keepLeftChecks: 0, keepLeftBad: [], redRuns: [], roundaboutChecks: 0,
    roundaboutBad: 0, stuckWhy: {}, speedSum: 0, speedN: 0, lives: new Set(), stuckLives: new Set(), zebraBlocked: 0, crossings: 0
  };
  // roundabout ring centres: connected groups of roundabout links
  const ringOf = new Map();
  for (const l of network.links) {
    if (!l.roundabout || ringOf.has(l)) continue;
    const ring = [], stack = [l];
    ringOf.set(l, ring);
    while (stack.length) {
      const q = stack.pop();
      ring.push(q);
      for (const n of [q.from, q.to]) for (const m of [...n.inLinks, ...n.outLinks]) if (m.roundabout && !ringOf.has(m)) { ringOf.set(m, ring); stack.push(m); }
    }
    let x = 0, z = 0, k = 0;
    for (const q of ring) for (let i = 0; i < q.pts.length; i += 2) { x += q.pts[i]; z += q.pts[i + 1]; k++; }
    ring.cx = x / k; ring.cz = z / k;
  }
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const a = now();
    sim.step(DT, ctx);
    r.ms.push(now() - a);
    r.steps++;
    for (const e of sim.events) {
      r.crossings++;
      if (e.aspect === ASPECT.RED || e.aspect === ASPECT.RED_AMBER) r.redRuns.push(e);
    }
    sim.events.length = 0;
    const alive = sim.vehicles.filter((v) => v.alive);
    for (const v of alive) {
      const key = v.id * 100000 + v.life;
      r.lives.add(key);
      // stuck = not moving for 60 s, unless waiting at (or queued behind) a red light: big 3-phase junctions with a
      // pedestrian stage keep a red for ~60 s, and a long queue takes two cycles
      if (v.wait > 60 && !r.stuckLives.has(key) && !queuedAtRed(sim, v)) { r.stuckLives.add(key); r.stuckWhy[v.why || (v.seg.type === 'conn' ? 'in-junction' : v.sensed >= 0 ? 'sensor' : 'queue')] = (r.stuckWhy[v.why || (v.seg.type === 'conn' ? 'in-junction' : v.sensed >= 0 ? 'sensor' : 'queue')] || 0) + 1; }
    }
    if (i % 15 !== 0 || i * DT < 10) continue; // checks every 0.5 s after a 10 s warm-up
    for (const v of alive) { r.speedSum += v.speed; r.speedN++; }
    // overlaps (spatial hash)
    const grid = new Map();
    for (const v of alive) {
      const k = Math.floor(v.x / 16) * 4096 + Math.floor(v.z / 16);
      (grid.get(k) || grid.set(k, []).get(k)).push(v);
    }
    for (const v of alive) {
      const gx = Math.floor(v.x / 16), gz = Math.floor(v.z / 16);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const u of grid.get((gx + dx) * 4096 + gz + dz) || []) {
          if (u.id <= v.id) continue;
          if (Math.abs((u.y || 0) - (v.y || 0)) > 3) continue; // under / over a bridge
          if (Math.hypot(u.x - v.x, u.z - v.z) > u.half + v.half + 1) continue;
          const pen = overlap(u, v);
          if (pen > 0.1) { r.overlaps.push({ t: +sim.time.toFixed(2), a: desc(v), b: desc(u), pen: +pen.toFixed(2), at: [+v.x.toFixed(1), +v.z.toFixed(1)] }); r.maxPen = Math.max(r.maxPen, pen); }
        }
      }
    }
    // keep right (Belgium drives on the right: side < 0 is the right of the link's direction)
    for (const v of alive) {
      if (v.seg.type !== 'lane' || v.seg.link.oneway || v.s < 1 || v.s > v.seg.len - 1) continue;
      r.keepLeftChecks++;
      const side = lateral(v.seg.link.pts, v.x, v.z);
      if (side >= -0.2) r.keepLeftBad.push({ v: desc(v), side: +side.toFixed(2), link: v.seg.link.id, laneOff: v.seg.offset, w: v.seg.link.road.w, t: +sim.time.toFixed(1) });
    }
    // roundabouts anticlockwise (right-hand traffic; seen from above, x east / z south: anticlockwise <=> (r x v) <= 0)
    for (const v of alive) {
      if (v.seg.type !== 'lane' || !v.seg.link.roundabout || v.speed < 1) continue;
      const ring = ringOf.get(v.seg.link);
      const vx = v.x - v.prevX, vz = v.z - v.prevZ, rx = v.x - ring.cx, rz = v.z - ring.cz;
      if (Math.hypot(rx, rz) < 3) continue;
      r.roundaboutChecks++;
      if (rx * vz - rz * vx > 0) r.roundaboutBad++;
    }
  }
  r.meanSpeed = r.speedSum / Math.max(1, r.speedN);
  const sorted = r.ms.slice().sort((p, q) => p - q);
  r.avgMs = r.ms.reduce((p, q) => p + q, 0) / r.ms.length;
  r.p95Ms = sorted[Math.floor(sorted.length * 0.95)];
  r.stuckShare = r.stuckLives.size / Math.max(1, r.lives.size);
  return r;
}

const fmt = (r, name) => `${name}: ${r.steps} steps, avg ${r.avgMs.toFixed(2)} ms/step (p95 ${r.p95Ms.toFixed(2)}), mean speed ${r.meanSpeed.toFixed(2)} m/s, ` +
  `stuck>60s ${(r.stuckShare * 100).toFixed(1)}% of ${r.lives.size} vehicle-lives, overlaps ${r.overlaps.length} (max ${r.maxPen.toFixed(2)} m), ` +
  `keep-right ${r.keepLeftBad.length}/${r.keepLeftChecks}, stop-line crossings ${r.crossings} (red ${r.redRuns.length}), roundabout ${r.roundaboutBad}/${r.roundaboutChecks}, ` +
  `stuck causes ${JSON.stringify(r.stuckWhy)}, peds alive ${r.sim.peds.filter((p) => p.alive).length}, recycled ${r.sim.stats.recycled} (stuck ${r.sim.stats.stuckRecycled})`;

test(`network builds (${buildMs.toFixed(0)} ms) with signals, crossings, bus stops`, () => {
  const st = network.stats;
  console.log('network', JSON.stringify(st));
  assert.ok(st.links > 20000 && st.controllers > 300 && st.crossings > 2000 && st.busStops > 100);
  // every link either leads somewhere or is a clipped oneway end
  const dead = network.links.filter((l) => !l.succ.length).length;
  assert.ok(dead / st.links < 0.01, `dead-end links ${dead}`);
  // route: Grand-Place -> Koekelberg Basilica (car-legal, sensible)
  const r = network.route({ x: 0, z: 0 }, { x: -2538, z: -2223 });
  assert.ok(r && r.length > 1000 && r.length < 8000, `route length ${r && r.length}`);
  for (let i = 0; i + 1 < r.links.length; i++) assert.ok(r.links[i].succ.includes(r.links[i + 1]), 'route follows legal turns');
});

test('signal sequence: red -> red+amber -> green -> amber -> red', () => {
  for (const ctl of network.controllers.slice(0, 200)) {
    for (let ph = 0; ph < ctl.phases; ph++) {
      const seq = [];
      for (let t = 0; t < ctl.cycle * 2; t += 0.25) {
        const a = network.aspect(ctl, ph, t);
        if (seq[seq.length - 1] !== a) seq.push(a);
      }
      const s = seq.join('');
      const { RED: R, RED_AMBER: RA, GREEN: G, AMBER: A } = ASPECT;
      for (let i = 0; i + 1 < seq.length; i++) {
        const next = { [R]: RA, [RA]: G, [G]: A, [A]: R }[seq[i]];
        assert.equal(seq[i + 1], next, `controller ${ctl.id} phase ${ph}: ${s}`);
      }
    }
  }
});

test(`${SIM_SECONDS} s around the Grand-Place: no overlaps, keep right, no red-light running, flowing`, () => {
  const r = runScenario({ cx: 0, cz: 0, seconds: SIM_SECONDS });
  console.log(fmt(r, 'Grand-Place'));
  assert.equal(r.overlaps.length, 0, `overlaps: ${JSON.stringify(r.overlaps.slice(0, 5))}`);
  assert.ok(r.keepLeftChecks > 1000);
  assert.equal(r.redRuns.length, 0, `red light running: ${JSON.stringify(r.redRuns.slice(0, 3))}`);
  assert.ok(r.crossings > 50, 'vehicles go through signals');

  assert.equal(r.keepLeftBad.length, 0, `keep-right violations: ${JSON.stringify(r.keepLeftBad.slice(0, 5))}`);
  assert.ok(r.meanSpeed > 1.5, `mean speed ${r.meanSpeed.toFixed(2)} m/s (the Pentagon is congested by design)`);
  assert.ok(r.stuckShare < 0.05, `stuck share ${(r.stuckShare * 100).toFixed(1)}%`);
  assert.ok(r.avgMs < 6, `sim step ${r.avgMs.toFixed(2)} ms`);
});

test('Place Poelaert: roundabout traffic goes anticlockwise, no overlaps', () => {
  const r = runScenario({ cx: 20, cz: 1055, seconds: Math.min(120, SIM_SECONDS), seed: 11 });
  console.log(fmt(r, 'Place Poelaert'));
  assert.ok(r.roundaboutChecks > 100, `roundabout samples ${r.roundaboutChecks}`);
  assert.ok(r.roundaboutBad / r.roundaboutChecks < 0.01, `clockwise ${r.roundaboutBad}/${r.roundaboutChecks}`);
  assert.equal(r.overlaps.length, 0, `overlaps: ${JSON.stringify(r.overlaps.slice(0, 5))}`);
  assert.equal(r.redRuns.length, 0);
});
