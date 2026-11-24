// js/life/bus-routes.js — bus route planning for the traffic buses. No three.js: traffic-sim calls these hooks.
//
//   const planner = createBusPlanner(network);
//   createTrafficSim(network, { assignBus: planner.assign, replanBus: planner.replan, ... })
//
// A bus spawned on a lane that one of the routes runs along (within 7 m, same direction) takes that route's number and
// destination blind and follows the route: its links are planned with network.route() ~900 m at a time along the
// route's path (re-planned as it goes). Elsewhere it shows a route that passes nearby and wanders the bus lanes.
// planner.variants[i] = {ref, destination, slot}: slot = index into the blind atlas (traffic.js).
import { pointAt } from '../road-network.js';

export const FALLBACK_BUSES = [['71', 'De Brouckère'], ['5', 'Hermann-Debroux'], ['95', 'Wiener'], ['38', 'Héros']];
const CELL = 40;
const PLAN_AHEAD = 900;

export function createBusPlanner(network, data = null, rand = Math.random) {
  const P = { x: 0, y: 0, z: 0, dx: 0, dz: 1 };
  const planner = {
    variants: FALLBACK_BUSES.map(([ref, destination], i) => ({ ref, destination, slot: i, path: null, cum: null })),
    grid: new Map(),
    stats: { assigned: 0, onRoute: 0, planned: 0, planMs: 0, replans: 0 },
    onChange: null,
    setData,
    assign,
    replan
  };
  if (data) setData(data);

  function setData(d) {
    if (!d || !d.routes) return;
    const vs = [];
    for (const r of d.routes) for (const v of r.variants || []) {
      if (!v.path || v.path.length < 4) continue;
      const path = Float32Array.from(v.path);
      const cum = new Float32Array(path.length / 2);
      for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(path[2 * i] - path[2 * i - 2], path[2 * i + 1] - path[2 * i - 1]);
      vs.push({ ref: String(r.ref), destination: v.destination || v.to || '', slot: vs.length, path, cum, id: v.id });
    }
    if (!vs.length) return;
    planner.variants = vs;
    planner.grid.clear();
    vs.forEach((v, vi) => {
      for (let i = 0; i + 3 < v.path.length; i += 2) {
        const ax = v.path[i], az = v.path[i + 1], bx = v.path[i + 2], bz = v.path[i + 3];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 2)));
        const seen = new Set();
        for (let k = 0; k <= n; k++) {
          const key = Math.floor((ax + ((bx - ax) * k) / n) / CELL) * 65536 + Math.floor((az + ((bz - az) * k) / n) / CELL);
          if (seen.has(key)) continue;
          seen.add(key);
          let a = planner.grid.get(key);
          if (!a) planner.grid.set(key, (a = []));
          a.push(vi, i / 2);
        }
      }
    });
    if (planner.onChange) planner.onChange(planner.variants);
  }

  /** route segments within `r` of (x, z) heading along (dx, dz) → [{vi, s, d}] */
  function near(x, z, dx, dz, r = 7, minDot = 0.85) {
    const out = [];
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const a = planner.grid.get(gx * 65536 + gz);
      if (!a) continue;
      for (let k = 0; k < a.length; k += 2) {
        const v = planner.variants[a[k]], i = a[k + 1];
        const ax = v.path[2 * i], az = v.path[2 * i + 1], bx = v.path[2 * i + 2], bz = v.path[2 * i + 3];
        const sx = bx - ax, sz = bz - az, L2 = sx * sx + sz * sz;
        if (L2 < 1e-6) continue;
        const L = Math.sqrt(L2);
        if ((sx * dx + sz * dz) / L < minDot) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / L2));
        const d = Math.hypot(ax + sx * t - x, az + sz * t - z);
        if (d < r) out.push({ vi: a[k], s: v.cum[i] + t * L, d });
      }
    }
    return out;
  }

  function pathPoint(v, s) {
    s = Math.max(0, Math.min(v.cum[v.cum.length - 1], s));
    let lo = 0, hi = v.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (v.cum[m] <= s) lo = m; else hi = m; }
    const t = v.cum[hi] > v.cum[lo] ? (s - v.cum[lo]) / (v.cum[hi] - v.cum[lo]) : 0;
    return { x: v.path[2 * lo] + (v.path[2 * hi] - v.path[2 * lo]) * t, z: v.path[2 * lo + 1] + (v.path[2 * hi + 1] - v.path[2 * lo + 1]) * t };
  }

  function plan(bus, lane, s) {
    const v = planner.variants[bus.busVariant];
    if (!v || !v.path || !network.route) return false;
    const end = v.cum[v.cum.length - 1];
    if (bus.pathS > end - 40) return false; // end of the route (outside the play area): wander on
    pointAt(lane, s, P);
    const tgt = pathPoint(v, Math.min(end, bus.pathS + PLAN_AHEAD));
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const r = network.route({ x: P.x, z: P.z }, tgt, { heading: Math.atan2(P.dx, P.dz) });
    if (t0) planner.stats.planMs = planner.stats.planMs * 0.8 + (performance.now() - t0) * 0.2;
    if (!r || !r.links || r.links.length < 2) return false;
    const i = r.links.indexOf(lane.link);
    if (i < 0) return false;
    bus.linkPlan = r.links;
    bus.planIdx = i;
    bus.planEndS = Math.min(end, bus.pathS + PLAN_AHEAD);
    planner.stats.planned++;
    return true;
  }

  /** traffic-sim hook: a bus has just been spawned on `lane` at arc length s */
  function assign(bus, lane, s) {
    planner.stats.assigned++;
    pointAt(lane, s, P);
    const cands = planner.variants[0] && planner.variants[0].path ? near(P.x, P.z, P.dx, P.dz) : [];
    bus.replans = 0;
    if (cands.length) {
      const c = cands[Math.floor(rand() * cands.length)];
      const v = planner.variants[c.vi];
      bus.route = v.ref; bus.destination = v.destination; bus.blind = v.slot; bus.busVariant = c.vi; bus.pathS = c.s;
      if (plan(bus, lane, s)) planner.stats.onRoute++;
      return;
    }
    // not on a route: the blind of one that passes nearby (any direction), else any
    const wide = planner.variants[0] && planner.variants[0].path ? near(P.x, P.z, P.dx, P.dz, 160, -1) : [];
    const v = wide.length ? planner.variants[wide[Math.floor(rand() * wide.length)].vi] : planner.variants[Math.floor(rand() * planner.variants.length)];
    bus.route = v.ref; bus.destination = v.destination; bus.blind = v.slot; bus.busVariant = -1;
  }

  /** traffic-sim hook: the bus left its plan (or reached its end) on `lane` → plan on along its route */
  function replan(bus, lane) {
    if (bus.busVariant < 0 || bus.busVariant === undefined || bus.replans > 40) return false;
    bus.replans++;
    planner.stats.replans++;
    const v = planner.variants[bus.busVariant];
    pointAt(lane, lane.len * 0.5, P);
    const c = near(P.x, P.z, P.dx, P.dz, 9).filter((q) => q.vi === bus.busVariant).sort((a, b) => Math.abs(a.s - bus.pathS) - Math.abs(b.s - bus.pathS))[0];
    if (!c || !v) { bus.busVariant = -1; return false; }
    bus.pathS = c.s;
    return plan(bus, lane, lane.len * 0.5);
  }

  return planner;
}
