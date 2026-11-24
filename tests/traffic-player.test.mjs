// tests/traffic-player.test.mjs — traffic must stop for the player's car instead of driving into (and shoving) it.
//   node --test tests/traffic-player.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { GEO } from '../js/brx-geodata.js';
import { buildRoadNetwork } from '../js/road-network.js';
import { createTrafficSim } from '../js/traffic-sim.js';

const network = buildRoadNetwork(GEO, null);
const DT = 1 / 30;

function pen(v, p) {
  const A = { x: v.x, z: v.z, f: [Math.sin(v.yaw), Math.cos(v.yaw)], e: [v.half, v.halfW] };
  const B = { x: p.x, z: p.z, f: [Math.sin(p.heading), Math.cos(p.heading)], e: [p.halfL, p.halfW] };
  let m = Infinity;
  for (const o of [A, B]) for (const [ux, uz] of [o.f, [o.f[1], -o.f[0]]]) {
    const pr = (q) => Math.abs(q.f[0] * ux + q.f[1] * uz) * q.e[0] + Math.abs(q.f[1] * ux - q.f[0] * uz) * q.e[1];
    m = Math.min(m, pr(A) + pr(B) - Math.abs((B.x - A.x) * ux + (B.z - A.z) * uz));
  }
  return m;
}

function run(name, road, turn) {
  // the middle of the longest network link on that road
  const link = network.links.filter((l) => l.name === road && l.len > 60).sort((a, b) => b.len - a.len)[0];
  assert.ok(link, 'link on ' + road);
  const mid = Math.floor(link.pts.length / 4) * 2;
  const ln = network.nearestLane(link.pts[mid], link.pts[mid + 1], { maxDist: 40 });
  assert.ok(ln, 'lane near ' + name);
  const l = ln.lane, pts = l.pts || l.link.pts;
  // lane direction at the snap point
  let hx = 0, hz = 1;
  if (pts && pts.length >= 4) { let best = 1e9; for (let i = 0; i + 3 < pts.length; i += 2) { const mx = (pts[i] + pts[i + 2]) / 2, mz = (pts[i + 1] + pts[i + 3]) / 2, d = Math.hypot(mx - ln.x, mz - ln.z); if (d < best) { best = d; hx = pts[i + 2] - pts[i]; hz = pts[i + 3] - pts[i + 1]; } } }
  const heading = Math.atan2(hx, hz) + turn;
  const player = { x: ln.x, z: ln.z, vx: 0, vz: 0, heading, halfW: 0.95, halfL: 2.43, mode: 'car' };
  const sim = createTrafficSim(network, { vehicles: 200, peds: 0, radius: 420, seed: 3 });
  const ctx = { focusX: player.x, focusZ: player.z, visible: (vx, vz) => Math.hypot(vx - player.x, vz - player.z) < 150, player };
  let maxPen = 0, touching = 0, near = 0;
  for (let i = 0; i < 120 / DT; i++) {
    sim.step(DT, ctx);
    for (const v of sim.vehicles) {
      if (!v.alive) continue;
      const p = pen(v, player);
      if (p > -3) near++;
      if (p > 0.05) { touching++; maxPen = Math.max(maxPen, p); }
    }
  }
  console.log(`${name}: near-miss vehicle-frames ${near}, overlapping vehicle-frames ${touching}, max penetration ${maxPen.toFixed(2)} m`);
  return { maxPen, touching, near };
}

test('traffic stops for a player parked in the lane (Rue de la Loi)', () => {
  const r = run('Rue de la Loi, in lane', 'Rue de la Loi - Wetstraat', 0);
  assert.ok(r.near > 0, 'traffic reached the player');
  assert.ok(r.maxPen < 0.4, 'no car drives into the player');
});
test('traffic stops for a player parked across the road (Boulevard du Régent)', () => {
  const r = run('Boulevard du Régent, across', 'Boulevard du Régent - Regentlaan', Math.PI / 2);
  assert.ok(r.near > 0, 'traffic reached the player');
  assert.ok(r.maxPen < 0.4, 'no car drives into the player');
});
