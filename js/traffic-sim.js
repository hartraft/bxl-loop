// js/traffic-sim.js — the Brussels traffic & pedestrian simulation, without any rendering.
//
//   import { createTrafficSim } from './traffic-sim.js';
//   const sim = createTrafficSim(network, { vehicles: 240, peds: 260 });
//   sim.step(dt, { focusX, focusZ, visible(x, z, r) -> bool, player: {x, z, vx, vz, heading, halfW, halfL} | null });
//
// js/traffic.js draws it (instanced vehicles + people); tests run it headless.
//
// Vehicles drive the lane graph of road-network.js: kerb lane = lane 0 on the LEFT. Car following is the
// Intelligent Driver Model against the nearest of: the vehicle ahead along the planned path (bodies are registered in
// every lane / connector they overlap, so a car turning off still blocks the one behind), the stop line, a bus stop
// (buses dwell), the player. A vehicle only enters a junction connector once it has *committed*: the light is green (or
// amber and it can't stop), no one is on the zebra, no conflicting connector is occupied or reserved, no
// higher-priority vehicle is about to arrive (roundabout traffic, straight-on oncoming traffic when turning right, the
// major road at a T-junction), and there is room for it on the far side. Until then it is held at the stop line
// (hard clamp, so nobody ever creeps over a red line). Vehicles live within `radius` of the focus: far / unseen ones
// are recycled into free spots near it (ahead of the camera preferred), never in view.
import { pointAt, ASPECT } from './road-network.js';

export const VEHICLE_TYPES = {
  hatch: { len: 4.05, width: 1.78, driver: 'car' },
  saloon: { len: 4.75, width: 1.82, driver: 'car' },
  suv: { len: 4.7, width: 1.95, driver: 'car' },
  van: { len: 5.4, width: 2.05, driver: 'van' },
  cab: { len: 4.58, width: 1.88, driver: 'car' },
  bus: { len: 11.2, width: 2.52, driver: 'bus', bus: true }
};
const DRIVERS = {
  car: { a: 2.6, b: 3.2, T: 1.0, s0: 1.6 },
  van: { a: 2.0, b: 3.0, T: 1.15, s0: 1.8 },
  bus: { a: 1.3, b: 2.6, T: 1.3, s0: 2.2 }
};
const LOOKAHEAD = 70;
const CELL = 16; // vehicle proximity hash
const MAX_DECEL = 9;
const PASS_DIST = 120;
const JERK = 3.5; // m/s³, how fast throttle builds up
const HOLD_GAP = 0.9; // front of a held vehicle stops this short of the lane end
const BUS_ROUTES = ['24', '9', '38', '15', '453', '139', '11', '88'];

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createTrafficSim(network, opts = {}) {
  const {
    vehicles: NV = 240, peds: NP = 260, radius = 420, seed = 7, busShare = 0.08,
    cabShareAt = () => 0.12, densityAt = () => 1, touristAt = () => 0, types = VEHICLE_TYPES, busRoutes = BUS_ROUTES
  } = opts;
  const rand = mulberry(seed);
  const net = network;
  const sim = { time: 0, vehicles: [], peds: [], radius, stats: { spawned: 0, recycled: 0, stuckRecycled: 0, redRuns: 0, guarded: 0, stepMs: 0 }, events: null };
  const P = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
  const vgrid = new Map();

  // ---- vehicles ------------------------------------------------------------------------------------------------
  for (let i = 0; i < NV; i++) sim.vehicles.push(makeVehicle(i));
  function makeVehicle(id) {
    return {
      id, type: 'hatch', variant: 0, len: 4, half: 2, halfW: 0.9, driver: DRIVERS.car, v0f: 1, alive: false,
      seg: null, s: 0, speed: 0, acc: 0, next: null, hist: [], committed: false, holding: [],
      passed: new Map(), plan: [], chain: [], _chain: [], why: '', wait: 0, maxWait: 0, dwell: 0, stopDone: -1, route: '', paint: 0,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, prevX: 0, prevZ: 0, braking: false, indicator: 0, dist: 0, bumped: 0, seed: rand(), life: 0
    };
  }
  function setType(v, type) {
    const T = types[type] || VEHICLE_TYPES[type];
    v.type = type;
    v.len = T.len; v.half = T.len / 2; v.halfW = T.width / 2;
    v.driver = DRIVERS[T.driver] || DRIVERS.car;
    v.v0f = 0.95 + rand() * 0.17; // 20 mph zones: most drive at or a bit over the limit
    v.bus = !!T.bus;
    v.paint = Math.floor(rand() * 1e6);
    v.route = v.bus ? busRoutes[Math.floor(rand() * busRoutes.length)] : '';
  }

  // ---- occupancy ---------------------------------------------------------------------------------------------
  // entries {v, s}: s = v's centre in that seg's arc length (may be < 0 or > len for bodies hanging into it)
  const entryPool = [];
  let entryUsed = 0;
  const filled = [];
  function occupy(seg, v, s) {
    let e = entryPool[entryUsed++];
    if (!e) entryPool.push((e = { v: null, s: 0 }));
    e.v = v; e.s = s;
    if (seg.occ.length === 0) filled.push(seg);
    seg.occ.push(e);
  }
  let stepNo = 0;
  function register(v) {
    const seg = v.seg;
    occupy(seg, v, v.s);
    // forward: the body poking into the next seg(s)
    let off = v.s - seg.len;
    let nx = seg.type === 'lane' ? v.next : seg.to;
    while (nx && off + v.half > 0) {
      occupy(nx, v, off);
      if (nx.type === 'conn') v._touch.push(nx);
      off -= nx.len;
      nx = nx.type === 'conn' ? nx.to : null;
    }
    // backward
    let back = v.s;
    for (let i = 0; i < v.hist.length; i++) {
      const h = v.hist[i];
      back += h.len;
      if (back - v.half >= h.len) break;
      occupy(h, v, back);
      if (h.type === 'conn') v._touch.push(h);
    }
  }
  function buildOccupancy() {
    for (const seg of filled) seg.occ.length = 0;
    filled.length = 0;
    entryUsed = 0;
    stepNo++;
    for (const v of sim.vehicles) {
      if (!v.alive) continue;
      v._touch = v._touch || [];
      v._touch.length = 0;
      if (v.seg.type === 'conn') v._touch.push(v.seg);
      register(v);
    }
    // release reservations a vehicle no longer needs (its body has left the connector)
    for (const v of sim.vehicles) {
      if (!v.alive || !v.holding.length) continue;
      for (let i = v.holding.length - 1; i >= 0; i--) {
        const c = v.holding[i];
        if (v.committed && v.next === c) continue;
        if (v.chain.includes(c)) continue;
        if (v._touch.includes(c)) continue;
        release(c, v);
        v.holding.splice(i, 1);
      }
    }
  }
  // reservations: vehicles committed to a connector they haven't fully cleared yet
  function reserve(c, v) {
    if (!c.res) c.res = [];
    if (!c.res.includes(v)) c.res.push(v);
    if (!v.holding.includes(c)) v.holding.push(c);
  }
  function release(c, v) {
    if (!c.res) return;
    const i = c.res.indexOf(v);
    if (i >= 0) c.res.splice(i, 1);
  }
  function busy(c, v) {
    if (c.res) for (const u of c.res) if (u !== v) return true;
    for (const e of c.occ) if (e.v !== v) return true;
    return false;
  }
  // c is busy only with vehicles ahead of v going the same way (v may follow them through)
  function followable(c, v) {
    // reservations of c itself never block v: their holders are ahead of v on c's lane (v follows them) or upstream
    // of v on the same path (they come after v); only bodies right at c's start do
    for (const e of c.occ) if (e.v !== v && e.s < e.v.half + 1) return false;
    return true;
  }

  // ---- path helpers --------------------------------------------------------------------------------------------
  // the seg after `seg` on v's path (lane -> planned connector -> its lane), null if not planned yet
  const after = (v, seg) => (seg.type === 'conn' ? seg.to : seg === v.seg ? v.next : null);

  /** position at distance d ahead (+) / behind (-) of v's centre along its path */
  function sampleAt(v, d, out) {
    let seg = v.seg, s = v.s + d;
    if (s > seg.len) {
      let nx = after(v, seg);
      while (nx && s > seg.len) { s -= seg.len; seg = nx; nx = after(v, seg); }
    } else if (s < 0) {
      for (let i = 0; i < v.hist.length && s < 0; i++) { seg = v.hist[i]; s += seg.len; }
    }
    return pointAt(seg, s, out);
  }

  // ---- planning ------------------------------------------------------------------------------------------------
  let focusX = 0, focusZ = 0, camFX = 0, camFZ = 0;
  function chooseNext(v, lane, replanned = false) {
    const outs = lane.outs.length ? lane.outs : (net.ensureNode(lane.link.to), lane.outs);
    if (!outs.length) return null;
    // buses on a real route (traffic.js assignBus): the connector onto the next link of the plan
    if (v.linkPlan) {
      const i = v.linkPlan.indexOf(lane.link);
      const want = i >= 0 ? v.linkPlan[i + 1] : null;
      if (want) for (const c of outs) if (c.to.link === want) return c;
      // off the plan (no turn from this lane / end of the plan): re-plan from here, or carry on at random
      v.linkPlan = null;
      if (!replanned && opts.replanBus && opts.replanBus(v, lane)) return chooseNext(v, lane, true);
    }
    let total = 0;
    const w = chooseW;
    w.length = 0;
    for (const c of outs) {
      const tl = c.to.link;
      let x = c.turn === 'S' ? 1 : c.turn === 'L' ? 0.42 : c.turn === 'R' ? 0.36 : 0.03;
      x *= 1 + Math.max(0, tl.rank) * 0.22;
      if (tl.kind === 'service') x *= 0.25;
      if (v.bus && !tl.bus) x *= 0.04;
      if (tl.succ && tl.succ.length === 0) x *= 0.05;
      else if (tl.moves && tl.moves.length && tl.moves.every((m) => m.turn === 'U')) x *= 0.15;
      const ex = tl.to.x - focusX, ez = tl.to.z - focusZ;
      if (ex * ex + ez * ez > radius * radius * 0.7) {
        const fx = lane.link.to.x - focusX, fz = lane.link.to.z - focusZ;
        if (ex * ex + ez * ez > fx * fx + fz * fz) x *= 0.3;
      }
      w.push(x);
      total += x;
    }
    let r = rand() * total;
    for (let i = 0; i < outs.length; i++) { r -= w[i]; if (r <= 0) return outs[i]; }
    return outs[outs.length - 1];
  }
  const chooseW = [];

  // ---- decisions at the stop line ------------------------------------------------------------------------------
  function aspectFor(link) {
    const c = link.control;
    return c ? net.aspect(c.controller, c.phase, sim.time) : -1;
  }
  // controllers whose stop lines v went through recently: one junction, one decision (no stopping inside it)
  // (remembered for PASS_DIST metres of travel: long enough to cross the biggest gyratory, short enough that a car
  // coming round again obeys the lights afresh at a stop line)
  function pass(v, id) {
    v.passed.set(id, v.dist);
    if (v.passed.size > 6) for (const [k, d] of v.passed) if (v.dist - d > PASS_DIST) v.passed.delete(k);
  }
  function ignoresControl(v, link, ahead = 0) {
    if (!link.control) return false;
    const d = v.passed.get(link.control.controller.id);
    return d !== undefined && v.dist + ahead - d < PASS_DIST;
  }

  // the connector after lane `lane` on v's planned path (planning ahead on demand)
  function planAfter(v, lane) {
    if (lane === v.seg) return v.next;
    for (const c of v.plan) if (c.from === lane) return c;
    const last = v.plan.length ? v.plan[v.plan.length - 1].to : v.next ? v.next.to : null;
    if (last !== lane || v.plan.length >= 10) return null;
    const c = chooseNext(v, lane);
    if (c) v.plan.push(c);
    return c;
  }
  // is there room for v's whole body past connector c, along its planned path (so nobody stops in the box)?
  function roomBeyond(v, c) {
    let need = v.len + 1.5;
    for (const e of c.occ) if (e.v !== v) need += e.v.len + 1.2;
    if (c.res) for (const u of c.res) if (u !== v && u.seg.type === 'lane' && u.next === c && !c.occ.some((e) => e.v === u)) need += u.len + 1.2;
    let free = 0, seg = c.to;
    for (let hop = 0; hop < 7 && seg; hop++) {
      let first = Infinity, sp = 0;
      for (const e of seg.occ) if (e.v !== v && e.s - e.v.half < first) { first = e.s - e.v.half; sp = e.v.speed; }
      if (first < Infinity) return free + Math.max(0, first) + sp * 1.2 >= need;
      free += seg.len;
      if (free >= need) return true;
      seg = seg.type === 'conn' ? seg.to : planAfter(v, seg);
    }
    return free >= need || !seg;
  }

  /** may v (on its lane, about to take connector c) enter the junction now? (distToStop: front to the hold line) */
  const no = (v, why) => { v.why = why; return false; };
  const chainCtls = [];
  function canGo(v, c, distToStop) {
    const lane = v.seg, link = lane.link;
    if (link.control && !ignoresControl(v, link)) {
      const a = aspectFor(link);
      if (a === ASPECT.RED || a === ASPECT.RED_AMBER) return no(v, 'red');
      if (a === ASPECT.AMBER && distToStop > (v.speed * v.speed) / (2 * 4.0) + 0.3) return no(v, 'amber');
    }
    const cr = link.zebra;
    if (cr && (cr.peds > 0 || cr.stepping > 0)) { if (!(cr.carWait >= v.wait)) cr.carWait = v.wait; return no(v, 'zebra'); }
    const jam = v.wait > 25; // gridlock: only what is physically in the way counts
    if (!connOk(v, c, jam)) return false;
    // room on the far side (through short exit lanes: up to the next one, so nobody stops in the box)
    if (!jam && !roomBeyond(v, c)) return no(v, 'room');
    // exit lanes shorter than the car: it will be in the next junction at once, so that one must be clear too
    const chain = v._chain;
    chain.length = 0;
    let l2 = c.to;
    const passed = chainCtls;
    passed.length = 0;
    if (link.control) passed.push(link.control.controller);
    let dist2 = c.len; // path length from v's hold line to the start of l2
    let slowest = c.vmax; // the slowest bend on the way
    let room = 0; // where v could wait without being in a junction box: lanes + plain way-continuation connectors
    for (let hop = 0; hop < 8; hop++) {
      room += l2.len;
      if (room >= v.len + 2) break;
      const c2 = planAfter(v, l2);
      if (!c2) break;
      const k2 = l2.link.control;
      if (k2 && !passed.includes(k2.controller) && !ignoresControl(v, l2.link, Math.max(0, distToStop) + dist2 + l2.len)) {
        // green now, and still green (or amber) when we get there
        // green now and still green when we get there (slowly: 2 m/s, +1.5 s), so we never meet its red in the box
        const eta = sim.time + (Math.max(0, distToStop) + dist2 + l2.len) / Math.max(Math.min(v.speed, slowest, 6), 2) + 3;
        if (aspectFor(l2.link) !== ASPECT.GREEN || net.aspect(k2.controller, k2.phase, eta) !== ASPECT.GREEN) return no(v, 'red2');
        passed.push(k2.controller);
      }
      if (l2.link.zebra && (l2.link.zebra.peds > 0 || l2.link.zebra.stepping > 0)) return no(v, 'zebra2');
      if (!connOk(v, c2, jam)) return false;
      chain.push(c2);
      room = c2.node.degree <= 2 && !c2.conflicts.length ? room + c2.len : 0;
      dist2 += l2.len + c2.len;
      slowest = Math.min(slowest, c2.vmax);
      l2 = c2.to;
    }
    v.why = '';
    return true;
  }
  // conflicts, following and giving way for connector c
  function connOk(v, c, jam) {
    for (const k of c.conflicts) if (jam ? k.occ.some((e) => e.v !== v) || (k.res && k.res.some((u) => u !== v && u.speed > 0.5)) : busy(k, v)) return no(v, 'conflict');
    if (busy(c, v) && !followable(c, v)) return no(v, 'follow'); // same connector: only behind the one ahead
    if (v.wait < 14 && !jam) {
      for (const k of c.conflicts) {
        if (k.priority <= c.priority) continue;
        const fl = k.from;
        for (const e of fl.occ) {
          const u = e.v;
          if (u === v || u.seg !== fl || u.next !== k || u.committed) continue;
          const d = fl.len - e.s - u.half;
          if (d > 45 || d < -1) continue;
          if (u.speed < 0.5 && u.wait > 2) continue; // it is held up itself
          if (fl.link.control && !ignoresControl(u, fl.link)) {
            const a = aspectFor(fl.link);
            if (a === ASPECT.RED || a === ASPECT.RED_AMBER) continue;
          }
          if (d / Math.max(u.speed, 1.5) < 4.5) return no(v, 'yield');
        }
      }
    }
    return true;
  }

  // ---- IDM ------------------------------------------------------------------------------------------------------
  function idm(v, v0, gap, leadSpeed) {
    const { a, b, T, s0 } = v.driver;
    const vv = v.speed;
    const free = 1 - Math.pow(vv / Math.max(v0, 0.1), 4);
    if (gap === Infinity) return a * free;
    const sStar = s0 + Math.max(0, vv * T + (vv * (vv - leadSpeed)) / (2 * Math.sqrt(a * b)));
    return a * (free - (sStar / Math.max(gap, 0.05)) ** 2);
  }
  function stopAcc(v, dist) {
    // IDM approach to a standing obstacle `dist` m ahead (a line: small standstill gap, half the time headway)
    const { a, b, T } = v.driver;
    const vv = v.speed;
    const v0 = Math.max(v.seg && v.seg.link ? v.seg.link.speed : 8, 1);
    const sStar = 0.3 + vv * T * 0.5 + (vv * vv) / (2 * Math.sqrt(a * b));
    return a * (1 - Math.pow(vv / v0, 4) - (sStar / Math.max(dist, 0.05)) ** 2);
  }
  // leader along the path: returns gap (front bumper to rear bumper), sets leader speed + the hard limit for v.s
  const L = { gap: Infinity, speed: 0, limit: Infinity };
  function findLeader(v) {
    L.gap = Infinity; L.speed = 0; L.limit = Infinity; L.who = -1;
    let seg = v.seg, base = 0; // offset of seg's s=0 from v's seg s=0
    for (let hop = 0; hop < 4 && seg; hop++) {
      for (const e of seg.occ) {
        const u = e.v;
        if (u === v) continue;
        const pos = base + e.s; // u's centre in v.seg coordinates
        if (pos <= v.s + 0.01 && !(pos > v.s - 0.01 && u.id > v.id)) continue;
        const g = pos - u.half - (v.s + v.half);
        if (g < L.gap) { L.gap = g; L.speed = u.speed; L.limit = pos - u.half - v.half - 0.3; L.who = u.id; }
      }
      if (L.gap < Infinity && L.gap < base - v.s) break;
      base += seg.len;
      if (base - v.s > LOOKAHEAD) break;
      seg = after(v, seg);
    }
    return L.gap;
  }

  /** is v at a red light, or queued (bumper to bumper) behind one that is? */
  function queuedAtRed(v) {
    for (let hop = 0, u = v; hop < 20 && u; hop++) {
      if (u.why === 'red' || u.why === 'red2' || u.why === 'amber') return true;
      findLeader(u);
      if (L.who < 0 || L.gap > 8) return false;
      u = sim.vehicles[L.who];
    }
    return false;
  }

  // ---- vehicle step ---------------------------------------------------------------------------------------------
  function drive(v, dt, player) {
    let seg = v.seg;
    const link = seg.type === 'lane' ? seg.link : seg.to.link;
    let v0 = (seg.type === 'conn' ? Math.min(seg.vmax, seg.to.link.speed) : link.speed) * v.v0f;
    if (v.bumped > 0) { v.bumped -= dt; v0 = Math.min(v0, 2); }
    let acc = idm(v, v0, findLeader(v), L.speed);
    let limit = L.limit;
    v.indicator = 0;
    if (v.wait > 3 && v.chain.length) {
      // stalled: give up the junctions reserved further ahead (re-checked when we get there)
      for (const c2 of v.chain) if (!v._touch.includes(c2)) release(c2, v);
      v.chain.length = 0;
    }
    v.prevSensed = v.sensed;
    v.sensed = -1;

    if (seg.type === 'lane') {
      if (!v.next) v.next = chooseNext(v, seg);
      const c = v.next;
      const toEnd = seg.len - v.s - v.half; // front bumper to lane end
      if (c) {
        if (toEnd < 35) v.indicator = c.turn === 'L' ? -1 : c.turn === 'R' || c.turn === 'U' ? 1 : 0;
        // slow for the connector's bend
        if (v.speed > c.vmax && toEnd < 60) acc = Math.min(acc, (c.vmax * c.vmax - v.speed * v.speed) / (2 * Math.max(toEnd + 1, 1)));
        const hold = HOLD_GAP + (seg.holdBack || 0);
        const distToStop = toEnd - hold;
        if (v.committed && seg.link.control && toEnd > 0 && !ignoresControl(v, seg.link)) {
          const a = aspectFor(seg.link);
          if (a === ASPECT.RED || a === ASPECT.RED_AMBER) uncommit(v);
        }
        if (v.committed && seg.link.zebra && seg.link.zebra.peds > 0 && toEnd > 0) uncommit(v);
        if (v.committed && v.wait > 3 && toEnd > 0) uncommit(v); // committed but going nowhere: let others through
        if (v.committed && v.chain.length && toEnd > 0) {
          // a light further along the committed chain changed: stop here rather than meet its red in the box
          for (const c2 of v.chain) {
            const L2 = c2.from.link;
            if (L2.control && !ignoresControl(v, L2) && aspectFor(L2) !== ASPECT.GREEN) { uncommit(v); break; }
          }
        }
        if (v.committed && toEnd > 0 && toEnd < 4) {
          // last look before the front goes in: somebody physically on a conflicting path?
          for (const k of c.conflicts) if (k.occ.some((e) => e.v !== v)) { uncommit(v); break; }
        }
        if (!v.committed && distToStop < 60) {
          const go = canGo(v, c, distToStop);
          if (go && distToStop < Math.max(3, v.speed * 1.3 + 2)) {
            v.committed = true;
            reserve(c, v);
            v.chain.length = 0;
            for (const c2 of v._chain) { reserve(c2, v); v.chain.push(c2); }
          } else if (!go) {
            acc = Math.min(acc, stopAcc(v, Math.max(distToStop, 0)));
            limit = Math.min(limit, Math.max(v.s, seg.len - v.half - hold));
          }
        }
      } else {
        // dead end without a way on: stop at the end (recycled when unseen)
        acc = Math.min(acc, stopAcc(v, Math.max(toEnd - 0.5, 0)));
        limit = Math.min(limit, seg.len - v.half - 0.5);
      }
      // bus stops
      if (v.bus && seg.busStops) {
        for (const sb of seg.busStops) {
          if (sb <= v.stopDone + 0.01 || sb < v.s - 0.5) continue;
          const d = sb - v.s;
          if (d > 60) break;
          if (d < 0.8 && v.speed < 0.4) {
            if (v.dwell <= 0) v.dwell = 7 + rand() * 7;
            v.dwell -= dt;
            if (v.dwell <= 0) { v.stopDone = sb; v.dwell = 0; } else { acc = Math.min(acc, -v.driver.b); limit = Math.min(limit, v.s); v.indicator = -1; }
          } else acc = Math.min(acc, stopAcc(v, Math.max(d, 0)));
          break;
        }
      }
    } else if (seg.turn === 'L') v.indicator = -1;
    else if (seg.turn === 'R' || seg.turn === 'U') v.indicator = 1;

    // safety net: any body right ahead of us that the lane graph doesn't know about (overlapping parallel ways,
    // neighbouring junction nodes): brake for it like for a leader
    {
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const cx = Math.floor(v.x / CELL), cz = Math.floor(v.z / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const list = vgrid.get(gx * 65536 + gz);
        if (!list) continue;
        for (const u of list) {
          if (u === v) continue;
          const dx = u.x - v.x, dz = u.z - v.z;
          const ahead = dx * fx + dz * fz;
          if (ahead > 16 + u.half) continue;
          const ux = Math.sin(u.yaw), uz = Math.cos(u.yaw);
          const cs = ux * fx + uz * fz;
          if (cs < -0.5) continue; // oncoming: its own lane
          const sn = Math.abs(ux * fz - uz * fx), ca = Math.abs(cs);
          const ext = ca * u.half + sn * u.halfW; // u's extent along our heading
          if (ahead + ext < -v.half + 0.3) continue; // wholly behind our front half
          const lat = Math.abs(dx * fz - dz * fx);
          // lanes of one link are parallel by construction; other links may converge onto ours
          const sameLink = v.seg.type === 'lane' && u.seg.type === 'lane' && v.seg.link === u.seg.link;
          if (lat > v.halfW + sn * u.half + ca * u.halfW + (sameLink || ca < 0.94 ? 0.15 : 0.8)) continue;
          if (u.prevSensed === v.id && v.id < u.id) continue; // we block each other: the lower id goes first
          const g = ahead - ext - v.half;
          if (g > 12) continue;
          if (g < 0) {
            // alongside: whoever is further ahead carries on, the other holds
            const uFront = ahead + ext;
            if (uFront < v.half - 0.3 || (Math.abs(uFront - v.half) <= 0.3 && u.id > v.id)) continue;
            acc = Math.min(acc, -MAX_DECEL);
            limit = Math.min(limit, v.s);
            v.sensed = u.id;
            continue;
          }
          const sa = idm(v, v0, Math.max(g, 0.05), Math.max(0, u.speed * cs));
          if (sa < acc) { acc = sa; v.sensed = u.id; }
          if (g < 0.4) limit = Math.min(limit, v.s + Math.max(0, g - 0.2));
        }
      }
    }

    // a raised drawbridge (if the sim was given one): hold at its stop lines (local s = (p - centre) . axis)
    const tb = sim.drawbridge;
    if (tb && !tb.isPassable()) {
      const dx = v.x - tb.centre.x, dz = v.z - tb.centre.z;
      if (dx * dx + dz * dz < 220 * 220) {
        const ax = tb.axis.x, az = tb.axis.z;
        const along = Math.sin(v.yaw) * ax + Math.cos(v.yaw) * az; // travel direction along the bridge axis
        if (Math.abs(along) > 0.5) {
          const sFront = dx * ax + dz * az + Math.sign(along) * v.half;
          const line = along > 0 ? Math.min(...tb.stopLines) : Math.max(...tb.stopLines);
          const d = (along > 0 ? line - sFront : sFront - line) / Math.abs(along);
          if (d > -0.5 && d < 80) {
            acc = Math.min(acc, stopAcc(v, Math.max(d - 0.5, 0)));
            if (d < 1.5) limit = Math.min(limit, v.s + Math.max(0, d - 0.5));
          }
        }
      }
    }

    // the player anywhere in front of us (any lane / angle): the player's box projected on our axes, so a car
    // crossing in front or parked at an angle is seen at its real size. Touching → hold still (no shoving).
    if (player) {
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
      const dx = player.x - v.x, dz = player.z - v.z;
      const ahead = dx * fx + dz * fz;
      const rel = player.heading - v.yaw;
      const cr = Math.abs(Math.cos(rel)), sr = Math.abs(Math.sin(rel));
      const pLat = cr * player.halfW + sr * player.halfL; // player's half-size across our path
      const pLong = sr * player.halfW + cr * player.halfL; // ... along our path
      if (ahead > -pLong && ahead < 50) {
        const lat = Math.abs(dz * fx - dx * fz);
        if (lat < v.halfW + pLat + 0.6) {
          const g = ahead - v.half - pLong;
          const ps = Math.max(0, player.vx * fx + player.vz * fz);
          const pa = idm(v, v0, g, ps);
          if (pa < acc) { acc = pa; if (g < 6) v.why = 'player'; }
          if (g < 1.0) acc = Math.min(acc, -MAX_DECEL);
          if (g < 0.3) limit = Math.min(limit, v.s); // in contact: don't creep into the player
        }
      }
    }

    acc = Math.max(-MAX_DECEL, Math.min(acc, v.driver.a));
    // smooth acceleration: throttle comes in at a limited jerk (pulling away from a stand starts from ~0), braking
    // stays immediate — so queues roll off like real traffic instead of snapping to full acceleration
    if (acc > 0) {
      const prev = v.speed < 0.3 ? Math.min(Math.max(v.acc, 0), 0.4) : Math.max(v.acc, 0);
      acc = Math.min(acc, prev + JERK * dt);
    }
    v.acc = acc;
    let speed = Math.max(0, v.speed + acc * dt);
    let ds = speed * dt;
    if (v.s + ds > limit) { ds = Math.max(0, limit - v.s); speed = Math.min(speed, L.speed, ds / dt); }
    v.speed = speed;
    v.braking = acc < -1.0 || speed < 0.3;
    // the front bumper crossing a signal's stop line (= the lane end)
    if (seg.type === 'lane' && seg.link.control && v.s + v.half <= seg.len && v.s + ds + v.half > seg.len && !ignoresControl(v, seg.link)) {
      const a = aspectFor(seg.link);
      if (sim.events) sim.events.push({ t: sim.time, v: v.id, type: 'stopline', aspect: a, link: seg.link.id, committed: v.committed });
      if (a === ASPECT.RED || a === ASPECT.RED_AMBER) sim.stats.redRuns++;
      pass(v, seg.link.control.controller.id);
    }
    v.s += ds;
    v.dist += ds;
    if (speed < 0.3) { v.wait += dt; if (v.wait > v.maxWait) v.maxWait = v.wait; } else v.wait = 0;

    // move on to the next seg(s)
    let guard = 0;
    while (v.s > v.seg.len && guard++ < 6) {
      seg = v.seg;
      if (seg.type === 'lane') {
        const c = v.next;
        if (!c || !v.committed) { v.s = seg.len; break; }
        v.s -= seg.len;
        enter(v, c);
        v.committed = false;
        v.stopDone = -1;
      } else {
        v.s -= seg.len;
        enter(v, seg.to);
        const pl = v.plan.length && v.plan[0].from === seg.to ? v.plan.shift() : null;
        if (!pl) v.plan.length = 0;
        v.next = pl || chooseNext(v, seg.to);
        if (v.chain.length && v.chain[0] === v.next) {
          v.chain.shift();
          v.committed = true; // committed through this short lane already
          const L2 = seg.to;
          if (L2.link.control && v.s + v.half > L2.len && !ignoresControl(v, L2.link)) {
            const a = aspectFor(L2.link);
            if (sim.events) sim.events.push({ t: sim.time, v: v.id, type: 'stopline', aspect: a, link: L2.link.id, committed: true });
            if (a === ASPECT.RED || a === ASPECT.RED_AMBER) sim.stats.redRuns++;
            pass(v, L2.link.control.controller.id);
          }
        } else if (v.chain.length || v.s + v.half > seg.to.len) {
          for (const c2 of v.chain) release(c2, v);
          v.chain.length = 0;
        }
      }
    }
  }
  function enter(v, seg) {
    v.hist.unshift(v.seg);
    if (v.hist.length > 4) v.hist.length = 4;
    v.seg = seg;
  }
  function uncommit(v) {
    v.committed = false;
    for (const c2 of v.chain) release(c2, v);
    v.chain.length = 0;
    const c = v.next;
    if (c && !v._touch.includes(c)) { release(c, v); const i = v.holding.indexOf(c); if (i >= 0) v.holding.splice(i, 1); }
  }

  function pose(v) {
    const q = v.bus ? v.half * 0.78 : Math.min(v.half * 0.62, 2.6);
    sampleAt(v, q, P);
    const fx = P.x, fz = P.z, fy = P.y;
    sampleAt(v, -q, P);
    v.prevX = v.x; v.prevZ = v.z;
    // centre on the path itself (the chord's midpoint would cut inside bends, over the centre line); yaw from the chord
    const rx = P.x, rz = P.z, ry = P.y;
    sampleAt(v, 0, P);
    v.x = P.x; v.z = P.z; v.y = (fy + ry) / 2;
    P.x = rx; P.z = rz; P.y = ry;
    v.yaw = Math.atan2(fx - P.x, fz - P.z);
    v.pitch = Math.atan2(fy - P.y, 2 * q);
  }

  // ---- spawning --------------------------------------------------------------------------------------------------
  let spawnLanes = [], spawnW = [], spawnTotal = 0, spawnX = Infinity, spawnZ = Infinity;
  const tmpLanes = [];
  function refreshSpawnLanes() {
    spawnX = focusX; spawnZ = focusZ;
    net.lanesNear(focusX, focusZ, radius, tmpLanes);
    spawnLanes = []; spawnW = []; spawnTotal = 0;
    for (const l of tmpLanes) {
      if (l.len < 14) continue;
      const k = l.link.kind;
      const w = l.len * (k === 'service' ? 0.15 : 1 + Math.max(0, l.link.rank) * 0.35);
      spawnLanes.push(l); spawnW.push(w); spawnTotal += w;
    }
  }
  function pickLane() {
    let r = rand() * spawnTotal;
    for (let i = 0; i < spawnLanes.length; i++) { r -= spawnW[i]; if (r <= 0) return spawnLanes[i]; }
    return spawnLanes[spawnLanes.length - 1];
  }
  function chooseType(lane, x, z) {
    const busOk = lane.link.bus && lane.link.laneW >= 2.9 && lane.index === 0;
    if (busOk && rand() < busShare * 2.2) return 'bus';
    const r = rand();
    if (r < cabShareAt(x, z)) return 'cab';
    const q = rand();
    return q < 0.11 ? 'van' : q < 0.3 ? 'suv' : q < 0.62 ? 'saloon' : 'hatch';
  }
  function laneFree(lane, s, half) {
    for (const e of lane.occ) if (Math.abs(e.s - s) < e.v.half + half + 7) return false;
    // vehicles about to come in through a connector, or still hanging out of one
    return true;
  }
  function spawn(v, rMin, rMax, hidden, ctx) {
    if (!spawnLanes.length) return false;
    for (let attempt = 0; attempt < 14; attempt++) {
      const lane = pickLane();
      const type = chooseType(lane, lane.pts[0], lane.pts[1]);
      const T = types[type] || VEHICLE_TYPES[type];
      const half = T.len / 2;
      if (lane.len < T.len + 10) continue;
      const s = half + 4 + rand() * (lane.len - T.len - 8);
      pointAt(lane, s, P);
      const d = Math.hypot(P.x - focusX, P.z - focusZ);
      if (d < rMin || d > rMax) continue;
      // prefer spots ahead of the camera when recycling
      if (hidden && (camFX || camFZ) && ((P.x - focusX) * camFX + (P.z - focusZ) * camFZ) < 0 && rand() < 0.6) continue;
      if (hidden && ctx.visible && ctx.visible(P.x, P.z, half + 2)) continue;
      if (ctx.player && Math.hypot(P.x - ctx.player.x, P.z - ctx.player.z) < 25) continue;
      if (!laneFree(lane, s, half)) continue;
      if (lane.link.control && lane.len - s < 30 && rand() < 0.5) continue;
      // free of vehicles in other lanes / connectors right here
      let clash = false;
      for (const u of sim.vehicles) {
        if (!u.alive) continue;
        const dx = u.x - P.x, dz = u.z - P.z;
        if (dx * dx + dz * dz < (u.half + half + 1.5) ** 2) { clash = true; break; }
      }
      if (clash) continue;
      setType(v, type);
      v.alive = true; v.seg = lane; v.s = s; v.speed = Math.min(lane.link.speed * 0.6, 6); v.acc = 0;
      v.hist.length = 0; v.committed = false; v.plan.length = 0; v.chain.length = 0; v.wait = 0; v.dwell = 0; v.stopDone = -1; v.passed.clear(); v.bumped = 0;
      for (const c of v.holding) release(c, v);
      v.holding.length = 0;
      net.ensureNode(lane.link.to);
      v.linkPlan = null; v.planIdx = 0; v.destination = '';
      if (v.bus && opts.assignBus) opts.assignBus(v, lane, s);
      v.next = chooseNext(v, lane);
      pose(v); v.prevX = v.x; v.prevZ = v.z;
      occupy(lane, v, s);
      v._touch = v._touch || [];
      v._touch.length = 0;
      v.life++;
      sim.stats.spawned++;
      return true;
    }
    return false;
  }
  function kill(v) {
    for (const c of v.holding) release(c, v);
    v.holding.length = 0;
    v.alive = false;
    v.seg = null;
  }

  // ---- pedestrians ---------------------------------------------------------------------------------------------
  for (let i = 0; i < NP; i++) {
    const r = mulberry(i * 7919 + seed);
    sim.peds.push({
      id: i, alive: false, x: 0, y: 0, z: 0, heading: 0, speed: 0, pref: 1.2 + r() * 0.35, mode: 'walk', pv: null, s: 0, dir: 1,
      cr: null, from: 0, tx: 0, tz: 0, t: 0, pause: 0, tourist: false, umbrella: false, umbrellaRoll: r(), female: r() < 0.5,
      seed: r(), crosses: r() < 0.32, wait: 0,
      // life: bus-stop queues, walking in twos & threes, photo stops (tourists), phone calls, street-show crowds
      queues: r() < 0.09, caller: r() < 0.08, leader: -1, gLat: 0, gBack: 0, gesture: null, look: null, photoT: 3 + r() * 20, air: 0, show: null
    });
  }
  const groundAt = opts.groundAt || ((x, z, y0 = 0) => y0);
  // bus stops near the focus: {x, z, fx, fz (facing the road), n (people waiting)}
  const stopPts = opts.busStops || null;
  let nearStops = [];
  const stopCache = new Map();
  function stopInfo(i) {
    let st = stopCache.get(i);
    if (st) return st;
    const x = stopPts[2 * i], z = stopPts[2 * i + 1];
    const nl = net.nearestLane(x, z, { maxDist: 14 });
    if (!nl) { stopCache.set(i, (st = { bad: true })); return st; }
    let fx = nl.x - x, fz = nl.z - z;
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    st = { x: x - fx * 0.6, z: z - fz * 0.6, fx, fz, n: 0, y: groundAt(x - fx * 0.6, z - fz * 0.6, 0.12), lane: nl.lane };
    stopCache.set(i, st);
    return st;
  }
  // street shows (Grand-Place, Place Sainte-Catherine, Place Flagey): a performer and a ring of onlookers
  const shows = (opts.shows || []).map((sh) => ({ ...sh, active: false, members: [], t: 0, jump: 0 }));
  let paveList = [], paveW = [], paveTotal = 0, paveX = Infinity, paveZ = Infinity;
  const tmpPave = [], tmpCross = [];
  let nearCrossings = [];
  const PED_RADIUS = Math.min(radius, 300);
  function refreshPavements() {
    paveX = focusX; paveZ = focusZ;
    net.pavementsNear(focusX, focusZ, PED_RADIUS, tmpPave);
    paveList = []; paveW = []; paveTotal = 0;
    for (const pv of tmpPave) {
      if (pv.len < 6) continue;
      const mx = pv.pts[0], mz = pv.pts[1];
      const w = pv.len * densityAt(mx, mz) * (pv.kind === 'pedestrian' ? 2 : pv.kind === 'footway' ? 0.6 : 1);
      paveList.push(pv); paveW.push(w); paveTotal += w;
    }
    nearCrossings = net.crossings.filter((c) => Math.abs(c.x - focusX) < PED_RADIUS && Math.abs(c.z - focusZ) < PED_RADIUS);
    nearStops = [];
    if (stopPts) for (let i = 0; i < stopPts.length; i += 2) {
      if (Math.abs(stopPts[i] - focusX) > PED_RADIUS * 0.8 || Math.abs(stopPts[i + 1] - focusZ) > PED_RADIUS * 0.8) continue;
      const st = stopInfo(i / 2);
      if (!st.bad) nearStops.push(st);
    }
  }
  function resetLife(p) {
    p.leader = -1; p.gesture = null; p.look = null; p.air = 0; p.pause = 0; p.show = null; p.stop = null;
  }
  function spawnPed(p, rMin, rMax, hidden, ctx) {
    if (!paveList.length) return false;
    resetLife(p);
    if (p.queues && nearStops.length) {
      // waiting at a bus stop, facing the road
      for (let attempt = 0; attempt < 4; attempt++) {
        const st = nearStops[Math.floor(rand() * nearStops.length)];
        if (st.n >= 5) continue;
        const d = Math.hypot(st.x - focusX, st.z - focusZ);
        if (d < rMin || d > rMax) continue;
        if (hidden && ctx.visible && ctx.visible(st.x, st.z, 4)) continue;
        const k = st.n++;
        const along = (k - 2) * 0.85 + (rand() - 0.5) * 0.3, back = 0.2 + rand() * 0.8;
        p.alive = true; p.mode = 'queue'; p.stop = st; p.pv = null; p.cr = null;
        p.x = st.x + st.fz * along - st.fx * back; p.z = st.z - st.fx * along - st.fz * back; p.y = st.y;
        p.heading = Math.atan2(st.fx, st.fz) + (rand() - 0.5) * 0.9; p.speed = 0; p.wait = 0;
        p.tourist = rand() < touristAt(p.x, p.z) * 0.5;
        p.gesture = rand() < 0.3 ? 'phone' : null;
        return true;
      }
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      if (p.crosses && nearCrossings.length && rand() < 0.8) {
        const cr = nearCrossings[Math.floor(rand() * nearCrossings.length)];
        const d = Math.hypot(cr.x - focusX, cr.z - focusZ);
        if (d < rMin || d > rMax) continue;
        if (hidden && ctx.visible && ctx.visible(cr.x, cr.z, cr.half + 3)) continue;
        p.alive = true; p.mode = 'approach'; p.cr = cr; p.from = rand() < 0.5 ? 1 : -1; p.pv = null;
        const along = 6 + rand() * 18, sideSign = rand() < 0.5 ? 1 : -1;
        const kx = cr.x + cr.ax * (cr.half + 0.9) * p.from, kz = cr.z + cr.az * (cr.half + 0.9) * p.from;
        p.x = kx + cr.az * along * sideSign * -1; p.z = kz - cr.ax * along * sideSign * -1;
        p.y = cr.y; p.tx = kx; p.tz = kz; p.speed = 0; p.wait = 0;
        p.tourist = rand() < touristAt(p.x, p.z);
        return true;
      }
      let r = rand() * paveTotal, pv = paveList[paveList.length - 1];
      for (let i = 0; i < paveList.length; i++) { r -= paveW[i]; if (r <= 0) { pv = paveList[i]; break; } }
      const s = rand() * pv.len;
      pointAt(pv, s, P);
      const d = Math.hypot(P.x - focusX, P.z - focusZ);
      if (d < rMin || d > rMax) continue;
      if (hidden && ctx.visible && ctx.visible(P.x, P.z, 2)) continue;
      p.alive = true; p.mode = 'walk'; p.pv = pv; p.s = s; p.dir = rand() < 0.5 ? 1 : -1; p.cr = null;
      p.x = P.x; p.z = P.z; p.y = P.y; p.speed = p.pref * 0.8; p.heading = Math.atan2(P.dx * p.dir, P.dz * p.dir);
      // a small sideways spread across the pavement
      p.lat = (rand() - 0.5) * 1.6;
      p.tourist = rand() < touristAt(p.x, p.z);
      p.gesture = !p.tourist && p.caller ? 'phone' : null;
      // walking in twos & threes: the next one or two people in the pool join, side by side / just behind
      if (p.id % 5 === 0 && pv.len > 12) {
        const n = p.tourist ? 2 : p.id % 10 === 0 ? 2 : 1;
        for (let k = 1; k <= n; k++) {
          const q = sim.peds[p.id + k];
          if (!q || q.show || q.mode === 'cross' || q.mode === 'board') continue;
          if (q.alive && ctx.visible && ctx.visible(q.x, q.z, 2)) continue;
          resetLife(q);
          q.alive = true; q.mode = 'walk'; q.pv = pv; q.dir = p.dir; q.cr = null;
          q.leader = p.id; q.gLat = k === 1 ? (p.lat > 0 ? -0.72 : 0.72) : 0; q.gBack = k === 1 ? 0.15 : 1.1;
          q.lat = p.lat + q.gLat; q.s = Math.max(0, Math.min(pv.len, p.s - p.dir * q.gBack));
          q.x = p.x; q.z = p.z; q.y = p.y; q.heading = p.heading; q.speed = p.speed; q.tourist = p.tourist;
          q.pref = p.pref;
        }
      }
      return true;
    }
    return false;
  }
  function vehicleNear(cr) {
    // vehicles that couldn't comfortably stop before this zebra, or already crossing it
    for (const l of cr.links) {
      if (!l.lanes) continue;
      for (const lane of l.lanes) {
        for (const e of lane.occ) {
          const u = e.v;
          if (u.seg !== lane) { if (e.s > 0) return true; continue; }
          const d = lane.len - e.s - u.half;
          if (u.committed && d < 25) return true;
          if (d < Math.max(5, (u.speed * u.speed) / 5 + u.speed * 0.8) && u.speed > 0.8) return true;
        }
        for (const c of lane.outs) if (c.occ.length || (c.res && c.res.length)) return true;
      }
    }
    return false;
  }
  function stepPed(p, dt, ctx) {
    const rain = sim.rain;
    if (p.mode === 'walk' && p.leader >= 0) {
      // in a group: keep pace beside / behind the leader while they're on the same pavement
      const L0 = sim.peds[p.leader];
      if (L0 && L0.alive && L0.mode === 'walk' && L0.pv === p.pv && L0.leader < 0) {
        p.dir = L0.dir; p.speed = L0.speed; p.pause = L0.pause;
        p.s = Math.max(0, Math.min(p.pv.len, L0.s - L0.dir * p.gBack));
        p.lat = Math.max(-1.1, Math.min(1.1, L0.lat + p.gLat));
        pointAt(p.pv, p.s, P);
        p.x = P.x + P.dz * p.lat; p.z = P.z - P.dx * p.lat; p.y = P.y;
        p.heading = L0.pause > 0 && L0.look !== null ? L0.look : Math.atan2(P.dx * p.dir, P.dz * p.dir);
        if (L0.gesture === 'photo') p.gesture = p.id % 2 ? 'photo' : 'point'; // one snaps, the other points
        else if (p.gesture === 'photo' || p.gesture === 'point') p.gesture = null;
        return;
      }
      p.leader = -1;
      if (p.gesture === 'photo' || p.gesture === 'point') p.gesture = null;
    }
    if (p.mode === 'walk') {
      const pv = p.pv;
      // tourists stop now and then to take a photo of the landmark they're at
      if (p.tourist && opts.lookAt && p.pause <= 0) {
        p.photoT -= dt;
        if (p.photoT <= 0) {
          p.photoT = 12 + rand() * 30;
          const lm = opts.lookAt(p.x, p.z);
          if (lm) { p.pause = 3.5 + rand() * 5; p.look = Math.atan2(lm.x - p.x, lm.z - p.z); p.gesture = 'photo'; }
        }
      }
      if (p.pause <= 0 && p.gesture === 'photo') { p.gesture = null; p.look = null; }
      p.speed += (p.pref * (rain ? 1.12 : 1) - p.speed) * Math.min(1, dt * 2);
      p.s += p.dir * p.speed * dt;
      if (p.s < 0 || p.s > pv.len) {
        p.s = Math.max(0, Math.min(pv.len, p.s));
        // continue onto a pavement whose end is close, else turn round
        pointAt(pv, p.s, P);
        const ex = P.x, ez = P.z;
        net.pavementsNear(ex, ez, 6, tmpPave);
        let best = null, bd = 4.5, bestS = 0;
        for (const q of tmpPave) {
          if (q === pv || q.len < 4) continue;
          const d0 = Math.hypot(q.pts[0] - ex, q.pts[1] - ez), d1 = Math.hypot(q.pts[q.pts.length - 2] - ex, q.pts[q.pts.length - 1] - ez);
          const d = Math.min(d0, d1) + rand() * 1.5;
          if (d < bd) { bd = d; best = q; bestS = d0 < d1 ? 0 : 1; }
        }
        if (best && rand() < 0.85) { p.pv = best; p.s = bestS ? best.len : 0; p.dir = bestS ? -1 : 1; } else { p.dir = -p.dir; p.pause = 0.5 + rand() * 1.5; }
      }
      if (p.pause > 0) { p.pause -= dt; p.speed = 0; }
      pointAt(p.pv, p.s, P);
      const lx = P.dz, lz = -P.dx;
      p.x = P.x + lx * p.lat; p.z = P.z + lz * p.lat; p.y = P.y;
      p.heading = p.pause > 0 && p.look !== null ? p.look : Math.atan2(P.dx * p.dir, P.dz * p.dir);
      return;
    }
    if (p.mode === 'queue') {
      // waiting for the bus: board one that's dwelling at this stop
      p.wait += dt;
      const st = p.stop;
      if (st) for (const v of sim.vehicles) {
        if (!v.alive || !v.bus || !(v.dwell > 0) || Math.abs(v.x - st.x) > 18 || Math.abs(v.z - st.z) > 18) continue;
        const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
        p.mode = 'board'; p.bus = v;
        p.tx = v.x + fx * (v.half - 1.7) + fz * (v.halfW + 0.35); p.tz = v.z + fz * (v.half - 1.7) - fx * (v.halfW + 0.35);
        p.pause = rand() * 1.2; p.gesture = null;
        break;
      }
      return;
    }
    if (p.mode === 'board') {
      if (p.pause > 0) { p.pause -= dt; return; }
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.35 || !p.bus || !p.bus.alive || !(p.bus.dwell > 0)) {
        if (d < 1.5) { p.alive = false; p.boarded = true; if (p.stop) p.stop.n = Math.max(0, p.stop.n - 1); } // on board
        else { p.mode = 'queue'; }
        return;
      }
      p.speed += (p.pref - p.speed) * Math.min(1, dt * 3);
      const st = Math.min(d, p.speed * dt);
      p.x += (dx / d) * st; p.z += (dz / d) * st;
      p.heading = Math.atan2(dx, dz);
      return;
    }
    if (p.mode === 'watch' || p.mode === 'perform') { stepShowPed(p, dt); return; }
    const cr = p.cr;
    if (p.mode === 'approach' || p.mode === 'depart') {
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
      p.speed += (p.pref - p.speed) * Math.min(1, dt * 2);
      if (d < 0.25) {
        if (p.mode === 'approach') { p.mode = 'wait'; p.wait = 0; p.speed = 0; } else {
          // turn round and come back to the crossing
          p.mode = 'approach';
          p.tx = cr.x + cr.ax * (cr.half + 0.9) * p.from; p.tz = cr.z + cr.az * (cr.half + 0.9) * p.from;
          p.pause = 1 + rand() * 4;
        }
        return;
      }
      if (p.pause > 0) { p.pause -= dt; p.speed = 0; return; }
      const st = Math.min(d, p.speed * dt);
      p.x += (dx / d) * st; p.z += (dz / d) * st;
      p.heading = Math.atan2(dx, dz);
      return;
    }
    if (p.mode === 'wait') {
      p.speed = 0;
      p.wait += dt;
      p.heading = Math.atan2(-cr.ax * p.from, -cr.az * p.from);
      const need = (2 * cr.half + 1.8) / p.pref;
      let go;
      // courtesy: once a driver has been held at the zebra for a while, the next people let them through
      if (cr.kind === 'zebra') go = p.wait > 0.6 && !vehicleNear(cr) && !(cr.carWait > 7 && p.wait < 9);
      else go = cr.controller ? net.pedWalk(cr.controller, sim.time) > Math.min(need, 5) : !vehicleNear(cr);
      if (go) { p.mode = 'cross'; p.t = 0; cr.stepping++; }
      return;
    }
    if (p.mode === 'cross') {
      const total = 2 * cr.half + 1.8;
      p.speed += (p.pref * 1.1 - p.speed) * Math.min(1, dt * 3);
      p.t += p.speed * dt;
      const u = Math.min(1, p.t / total);
      const k = (cr.half + 0.9) * p.from * (1 - 2 * u);
      p.x = cr.x + cr.ax * k + cr.az * 0.4 * p.from; p.z = cr.z + cr.az * k - cr.ax * 0.4 * p.from; p.y = cr.y;
      p.heading = Math.atan2(-cr.ax * p.from, -cr.az * p.from);
      if (u >= 1) {
        p.from = -p.from;
        p.mode = 'depart';
        const along = 5 + rand() * 20, sg = rand() < 0.5 ? 1 : -1;
        p.tx = p.x + cr.az * along * sg; p.tz = p.z - cr.ax * along * sg;
      }
    }
  }

  // ---- street shows ------------------------------------------------------------------------------------------------
  function updateShows(ctx) {
    for (const sh of shows) {
      const d = Math.hypot(sh.x - focusX, sh.z - focusZ);
      if (sh.active && d > PED_RADIUS * 1.1) {
        for (const p of sh.members) { p.show = null; p.alive = false; } // respawn as ordinary walkers
        sh.members.length = 0; sh.active = false;
        continue;
      }
      if (sh.active || d > PED_RADIUS * 0.85) continue;
      if (ctx.visible && ctx.visible(sh.x, sh.z, 8) && d > 20 && sim.time > 1) continue; // set up out of sight
      // cast: walkers far from the camera and out of view
      const cast = [];
      const want = sh.crowd || 12;
      for (const p of sim.peds) {
        if (cast.length > want) break;
        if (p.show || p.leader >= 0 || p.mode === 'cross' || p.mode === 'board' || p.mode === 'queue') continue;
        if (p.alive && ((ctx.visible && ctx.visible(p.x, p.z, 2)) || Math.hypot(p.x - focusX, p.z - focusZ) < 50)) continue;
        cast.push(p);
      }
      if (cast.length < 6) continue;
      sh.active = true; sh.members = cast; sh.t = 0;
      const y = groundAt(sh.x, sh.z, 0);
      cast.forEach((p, i) => {
        resetLife(p);
        p.alive = true; p.show = sh; p.pv = null; p.cr = null; p.y = y; p.speed = 0;
        if (i === 0) { p.mode = 'perform'; p.x = sh.x; p.z = sh.z; p.heading = 0; p.tourist = false; return; }
        p.mode = 'watch';
        const a = (i / (cast.length - 1)) * Math.PI * 1.6 + (sh.open || 0) + (rand() - 0.5) * 0.3, r = 3.6 + rand() * 1.8;
        p.x = sh.x + Math.cos(a) * r; p.z = sh.z + Math.sin(a) * r;
        p.heading = Math.atan2(sh.x - p.x, sh.z - p.z);
        p.tourist = rand() < 0.5;
        p.gesture = rand() < 0.25 ? 'photo' : null;
      });
    }
  }
  function stepShowPed(p, dt) {
    const sh = p.show;
    if (!sh) { p.mode = 'walk'; p.alive = false; return; }
    if (p.mode === 'perform') {
      // an acrobat: struts round a small circle, spins, jumps; hands up for applause
      sh.t += dt;
      const t = sh.t;
      const a = t * 0.6;
      p.x = sh.x + Math.cos(a) * 1.1; p.z = sh.z + Math.sin(a) * 1.1;
      p.heading = a + Math.PI / 2 + (Math.sin(t * 0.7) > 0.6 ? t * 6 : 0);
      const ph = t % 7;
      p.air = ph > 5.2 && ph < 5.75 ? Math.sin(((ph - 5.2) / 0.55) * Math.PI) * 0.55 : 0;
      p.gesture = ph > 5.8 || ph < 1.2 ? 'cheer' : ph < 2.5 ? 'wave' : null;
      sh.applause = ph > 5.8 || ph < 1.6;
      return;
    }
    // onlookers: face the act, clap when it lands a trick, the odd photo
    p.heading = Math.atan2(sh.x - p.x, sh.z - p.z) + Math.sin(sim.time * 0.4 + p.seed * 9) * 0.15;
    if (sh.applause) { if (p.gesture !== 'photo' || p.seed < 0.5) p.gesture = p.seed < 0.85 ? 'clap' : 'cheer'; }
    else if (p.gesture === 'clap' || p.gesture === 'cheer') p.gesture = p.seed > 0.75 ? 'photo' : null;
  }

  // deepest footprint overlap (separating axes) of v at pose (x, z, yaw) with the vehicles around it
  function bodyPen(v, x, z, yaw) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let worst = 0;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const list = vgrid.get(gx * 65536 + gz);
      if (!list) continue;
      for (const u of list) {
        if (u === v || !u.alive) continue;
        const dx = u.x - x, dz = u.z - z;
        if (dx * dx + dz * dz > (u.half + v.half + 0.5) ** 2) continue;
        if (Math.abs((u.y || 0) - (v.y || 0)) > 3) continue;
        const ux = Math.sin(u.yaw), uz = Math.cos(u.yaw);
        let pen = Infinity;
        for (const [ax, az] of [[fx, fz], [fz, -fx], [ux, uz], [uz, -ux]]) {
          const rv = Math.abs(fx * ax + fz * az) * v.half + Math.abs(fz * ax - fx * az) * v.halfW;
          const ru = Math.abs(ux * ax + uz * az) * u.half + Math.abs(uz * ax - ux * az) * u.halfW;
          const p = rv + ru - Math.abs(dx * ax + dz * az);
          if (p < pen) pen = p;
          if (pen <= 0) break;
        }
        if (pen > worst) worst = pen;
      }
    }
    return worst;
  }

  // ---- main step -------------------------------------------------------------------------------------------------
  let lastFX = Infinity, lastFZ = Infinity;
  sim.rain = false;
  sim.setRain = (on) => {
    sim.rain = !!on;
    for (const p of sim.peds) p.umbrella = sim.rain && p.umbrellaRoll < 0.62;
  };

  sim.step = function step(dt, ctx = {}) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    dt = Math.min(Math.max(dt, 0), 0.1);
    sim.time += dt;
    focusX = ctx.focusX ?? 0; focusZ = ctx.focusZ ?? 0;
    camFX = ctx.camFX || 0; camFZ = ctx.camFZ || 0;
    const jump = Math.hypot(focusX - lastFX, focusZ - lastFZ) > 150;
    lastFX = focusX; lastFZ = focusZ;
    if (jump || Math.hypot(focusX - spawnX, focusZ - spawnZ) > 60) refreshSpawnLanes();
    if (jump || Math.hypot(focusX - paveX, focusZ - paveZ) > 50) refreshPavements();
    const player = ctx.player || null;

    // pedestrians first: crossings' occupancy for the drivers
    for (const cr of nearCrossings) { cr.peds = 0; cr.stepping = 0; cr.carWait = 0; }
    let pedBudget = jump ? Infinity : 6;
    if (jump) for (const sh of shows) { for (const p of sh.members) { p.show = null; p.alive = false; } sh.active = false; sh.members.length = 0; }
    updateShows(ctx);
    for (const p of sim.peds) {
      const d = p.alive ? Math.hypot(p.x - focusX, p.z - focusZ) : Infinity;
      if (p.show) { if (!p.alive) p.show = null; else continue; }
      if (!p.alive && p.boarded) { if (pedBudget > 0 && spawnPed(p, 40, PED_RADIUS, true, ctx)) { p.boarded = false; pedBudget--; } continue; }
      if (p.alive && p.mode === 'queue' && p.stop && d > PED_RADIUS) p.stop.n = Math.max(0, p.stop.n - 1);
      if (!p.alive || (jump && d > PED_RADIUS)) { p.alive = false; spawnPed(p, 0, PED_RADIUS, false, ctx); }
      else if (pedBudget > 0 && d > PED_RADIUS && !(ctx.visible && ctx.visible(p.x, p.z, 2))) {
        if (p.mode === 'queue' && p.stop) p.stop.n = Math.max(0, p.stop.n - 1);
        if (spawnPed(p, 40, PED_RADIUS, true, ctx)) pedBudget--;
      }
      if (!p.alive) continue;
      if (p.mode === 'cross' && p.cr) p.cr.peds++;
    }

    buildOccupancy();
    let budget = jump ? Infinity : 5;
    // how long has the player been standing still with traffic in front?
    const pl0 = ctx.player;
    if (pl0 && Math.hypot(pl0.vx, pl0.vz) < 0.6) sim.playerWait = (sim.playerWait || 0) + dt; else sim.playerWait = 0;
    for (const v of sim.vehicles) {
      const d = v.alive ? Math.hypot(v.x - focusX, v.z - focusZ) : Infinity;
      if (!v.alive || (jump && d > radius)) { if (v.alive) kill(v); spawn(v, 0, radius, false, ctx); }
      else if (budget > 0) {
        const unseen = !(ctx.visible && ctx.visible(v.x, v.z, v.half + 2));
        // gridlock (waiting > 40 s, not for a red light) further than 45 m from the camera: recycled even in view
        // ... and close to the camera too once it's clearly a deadlock (90 s), so the player is never walled in
        // forever. A vehicle in a stand-off with a stationary player (each waiting for the other) goes after 25 s.
        const atSignal = v.why === 'red' || v.why === 'red2' || v.why === 'amber';
        const pl = ctx.player;
        const standOff = v.why === 'player' && v.wait > 25 && pl && Math.hypot(pl.vx, pl.vz) < 0.5;
        // ... and when the player has been held behind traffic for 35 s, whatever is stuck (not at a red) in the 40 m
        // ahead of the player clears off: a game shouldn't park you behind a deadlock
        let blocking = false;
        if (pl && sim.playerWait > 35 && v.wait > 25 && !atSignal) {
          const fx = Math.sin(pl.heading), fz = Math.cos(pl.heading), ddx = v.x - pl.x, ddz = v.z - pl.z;
          const ahead = ddx * fx + ddz * fz;
          blocking = ahead > 0 && ahead < 40 && Math.abs(ddx * fz - ddz * fx) < 4.5 && !queuedAtRed(v);
        }
        const gridlocked = (v.wait > 40 && v.why !== 'red' && v.why !== 'amber' && d > 45) || (v.wait > 90 && !atSignal) || standOff || blocking;
        if ((d > radius * 1.15 && unseen) || d > radius * 2.5 || (v.wait > 50 && unseen && !v.bus) || (v.wait > 90 && unseen) || gridlocked) {
          if (v.wait > 50) sim.stats.stuckRecycled++;
          kill(v);
          if (spawn(v, radius * 0.35, radius, true, ctx)) sim.stats.recycled++;
          budget--;
        }
      }
    }
    vgrid.clear();
    for (const v of sim.vehicles) {
      if (!v.alive) continue;
      const k = Math.floor(v.x / CELL) * 65536 + Math.floor(v.z / CELL);
      let a = vgrid.get(k);
      if (!a) vgrid.set(k, (a = []));
      a.push(v);
    }
    for (const v of sim.vehicles) {
      if (!v.alive) continue;
      const seg0 = v.seg, s0 = v.s, x0 = v.x, z0 = v.z, yaw0 = v.yaw, d0 = v.dist, next0 = v.next, com0 = v.committed;
      const hist0 = v.hist.slice(), plan0 = v.plan.slice(), chain0 = v.chain.slice(), stop0 = v.stopDone;
      drive(v, dt, player);
      pose(v);
      // last-resort guard: a move that would push this body into another one is undone
      if (v.seg !== seg0 || v.s > s0) {
        const pen = bodyPen(v, v.x, v.z, v.yaw);
        if (pen > 0.02 && pen > bodyPen(v, x0, z0, yaw0) - 1e-4) {
          v.seg = seg0; v.s = s0; v.dist = d0; v.next = next0; v.committed = com0; v.stopDone = stop0;
          v.hist.length = 0; v.hist.push(...hist0);
          v.plan.length = 0; v.plan.push(...plan0);
          v.chain.length = 0; v.chain.push(...chain0);
          v.speed = 0; v.acc = -MAX_DECEL; v.braking = true;
          pose(v);
          v.prevX = x0; v.prevZ = z0;
          sim.stats.guarded++;
        }
      }
    }
    for (const p of sim.peds) if (p.alive) stepPed(p, dt, ctx);
    sim.stats.stepMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  };

  /** aspect (0 red, 1 red+amber, 2 green, 3 amber) of a signal head (network.signalHeads[i]) now */
  sim.headAspect = (i) => {
    const h = net.signalHeads[i];
    return h ? net.aspect(net.controllers[h.controller], h.phase, sim.time) : -1;
  };
  /** drawbridge API (if a landmark provides one): isPassable(), stopLines, centre, axis */
  // (no Brussels landmark has a working bascule; the hook stays for tests)
  sim.drawbridge = opts.drawbridge || null;
  sim.setDrawbridge = (tb) => { sim.drawbridge = tb || null; };
  sim.kill = kill;
  sim._leader = (v) => { findLeader(v); return { ...L }; };
  return sim;
}
