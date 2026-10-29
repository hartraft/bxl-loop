// js/road-network.js — Workstream G: the drivable London road graph, built from the baked OSM geodata.
//
//   import { buildLondonRoadNetwork } from './road-network.js';
//   const network = buildLondonRoadNetwork(GEO, WORLD);        // ~150-300 ms for all of Zone 1, no three.js
//
// Pure data (no three.js, no DOM): Node tests and the RideLDN GPS import it directly.
//
// GEO.roads are whole OSM ways; junctions are bit-exact shared vertices (hashed at 0.1 m), including mid-way ones.
// Every way is cut at its junctions, signals, crossings and ends into "pieces"; each piece gives one directed *link*
// per legal direction (oneway respected), each link has lanes ordered from the kerb inward for the selected traffic side.
// Lane polylines are offset and trimmed back from the junction centre; *connectors* (cubic curves) join lane ends:
//   - no U-turns except at dead ends (or when nothing else leaves a lane),
//   - turns prefer the kerb-side lane (left in left-hand traffic, right in right-hand traffic), straight on from any,
//   - each connector knows which others it geometrically conflicts with (paths closer than CONFLICT_GAP),
//     and a priority (road rank, roundabout circulation > entry, straight > left > right) for giving way.
// Roundabouts are oneway ways in OSM order, which is clockwise for UK roundabouts.
// Traffic signals (GEO.signals + signal-controlled crossings) are clustered into junction *controllers*; each
// controlled approach (a link ending at a signal node, heading into the cluster) belongs to a *phase* by its axis,
// and every controller cycles phase by phase with the UK sequence red → red+amber → green → amber → red, plus a
// pedestrian (all-red) stage where it has signal crossings. Zebra crossings are nodes too (vehicles give way to
// people on them). Bus stops sit on kerb lanes. Speeds come from `maxspeed` (mph). y follows bridge `deck` arrays.
//
// See INTEGRATION.md "Workstream G" for the API (route(), nearestLane(), aspect(), …).

const MPH = 0.44704;
const CONFLICT_GAP = 2.25; // connector centre paths closer than this (m) conflict (cars 1.8 m, buses 2.5 m only on >= 2.9 m lanes)
const SIGNAL_SNAP = 3.0; // GEO.signals within this of a drive road are put on it
const CROSS_SNAP = 2.0;
const CLUSTER_DIST = 32; // signal nodes this close belong to one junction controller

const DRIVE_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const SERVICE_OK = new Set(['', 'alley', 'bus', 'link']);
const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 0 };
const DEFAULT_MPH = { motorway: 50, trunk: 30, primary: 20, secondary: 20, tertiary: 20, unclassified: 20, residential: 20, living_street: 10, service: 10 };
const RIGHT_HAND_TRAFFIC = (typeof process !== 'undefined' && process.env?.CITY === 'brussels') ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels');
export const TRAFFIC_SIDE = RIGHT_HAND_TRAFFIC ? 'right' : 'left';

const TURN_RANK = RIGHT_HAND_TRAFFIC ? { S: 3, R: 2, L: 1, U: 0 } : { S: 3, L: 2, R: 1, U: 0 };

export const LANE_MIN_W = 2.45; // narrowest lane spacing on two-way streets (cars are 1.8 m wide)
export const ASPECT = { RED: 0, RED_AMBER: 1, GREEN: 2, AMBER: 3 };
export const ASPECT_NAMES = ['red', 'redamber', 'green', 'amber'];

const keyOf = (x, z) => (Math.round(x * 10) + 60000) * 131072 + (Math.round(z * 10) + 60000);

// ---- small geometry helpers ------------------------------------------------------------------------------------
function cumulative(pts) {
  const n = pts.length / 2, cum = new Array(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  return cum;
}

/** index i with cum[i] <= s < cum[i+1] (clamped) */
export function segIndex(cum, s) {
  let lo = 0, hi = cum.length - 1;
  if (s <= 0) return 0;
  if (s >= cum[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= s) lo = m; else hi = m;
  }
  return lo;
}

/** point on a polyline seg ({pts, cum, ys}) at arc length s → out {x, y, z, dx, dz} (s may run past the ends: extrapolates) */
export function pointAt(seg, s, out) {
  const { pts, cum } = seg;
  const i = segIndex(cum, s);
  const ax = pts[2 * i], az = pts[2 * i + 1], bx = pts[2 * i + 2], bz = pts[2 * i + 3];
  const L = cum[i + 1] - cum[i];
  const t = L > 1e-6 ? (s - cum[i]) / L : 0;
  let dx = bx - ax, dz = bz - az;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  const ys = seg.ys;
  if (ys) {
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    out.y = ys[i] + (ys[i + 1] - ys[i]) * tc;
  } else out.y = 0;
  out.dx = dx;
  out.dz = dz;
  return out;
}

/** offset a centreline (x,z pairs) by `off` metres to the LEFT of its direction (left of (dx,dz) is (dz,-dx)) */
function offsetLine(pts, off) {
  const n = pts.length / 2, out = new Array(pts.length);
  if (off === 0) { for (let i = 0; i < pts.length; i++) out[i] = pts[i]; return out; }
  for (let i = 0; i < n; i++) {
    let nx = 0, nz = 0;
    if (i > 0) {
      const dx = pts[2 * i] - pts[2 * i - 2], dz = pts[2 * i + 1] - pts[2 * i - 1], l = Math.hypot(dx, dz) || 1;
      nx += dz / l; nz += -dx / l;
    }
    if (i < n - 1) {
      const dx = pts[2 * i + 2] - pts[2 * i], dz = pts[2 * i + 3] - pts[2 * i + 1], l = Math.hypot(dx, dz) || 1;
      const ux = dz / l, uz = -dx / l;
      if (i > 0) {
        // miter: average of both normals scaled by 1/cos(half angle), capped
        const ax = nx + ux, az = nz + uz, al = Math.hypot(ax, az);
        if (al > 0.3) {
          const mx = ax / al, mz = az / al, c = Math.max(0.5, mx * ux + mz * uz);
          nx = mx / c; nz = mz / c;
        } else { nx = ux; nz = uz; }
      } else { nx = ux; nz = uz; }
    } else {
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
    }
    out[2 * i] = pts[2 * i] + nx * off;
    out[2 * i + 1] = pts[2 * i + 1] + nz * off;
  }
  return out;
}

/** cut a polyline (+ys) to arc range [a, b] */
function cutLine(pts, ys, a, b) {
  const cum = cumulative(pts);
  const n = cum.length, L = cum[n - 1];
  a = Math.max(0, Math.min(a, L)); b = Math.max(a, Math.min(b, L));
  const xs = [], yo = [];
  const push = (s) => {
    const i = segIndex(cum, s), l = cum[i + 1] - cum[i], t = l > 1e-6 ? (s - cum[i]) / l : 0;
    xs.push(pts[2 * i] + (pts[2 * i + 2] - pts[2 * i]) * t, pts[2 * i + 1] + (pts[2 * i + 3] - pts[2 * i + 1]) * t);
    if (ys) yo.push(ys[i] + (ys[i + 1] - ys[i]) * t);
  };
  push(a);
  for (let i = 1; i < n - 1; i++) if (cum[i] > a + 0.05 && cum[i] < b - 0.05) {
    xs.push(pts[2 * i], pts[2 * i + 1]);
    if (ys) yo.push(ys[i]);
  }
  push(b);
  if (xs.length === 2) { // degenerate: keep two points
    xs.push(xs[0], xs[1]);
    if (ys) yo.push(yo[0]);
  }
  return { pts: xs, ys: ys ? yo : null };
}

/** grid hash of items by bounding box (for lanes & pavements) */
function makeGrid(cell) {
  const map = new Map();
  const k = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
  return {
    cell,
    clear() { map.clear(); },
    add(item, x0, z0, x1, z1) {
      for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
        for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
          const key = k(cx, cz);
          let a = map.get(key);
          if (!a) map.set(key, (a = []));
          a.push(item);
        }
      }
    },
    query(x, z, r, out, stamp) {
      for (let cz = Math.floor((z - r) / cell); cz <= Math.floor((z + r) / cell); cz++) {
        for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++) {
          const a = map.get(k(cx, cz));
          if (!a) continue;
          for (const it of a) if (it._q !== stamp) { it._q = stamp; out.push(it); }
        }
      }
      return out;
    }
  };
}

function bbox(pts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < z0) z0 = pts[i + 1]; if (pts[i + 1] > z1) z1 = pts[i + 1];
  }
  return [x0, z0, x1, z1];
}

let _t = 0; // projection parameter of the last distSeg() call
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _t = t;
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return Math.sqrt(ex * ex + ez * ez);
}
function distPointSeg(px, pz, ax, az, bx, bz) {
  const d = distSeg(px, pz, ax, az, bx, bz);
  return { d, t: _t };
}
/** min distance between two polylines (flat x,z arrays), early out below `limit` */
function polyDist(A, B, limit) {
  let best = Infinity;
  for (let i = 0; i + 3 < A.length; i += 2) {
    const ax = A[i], az = A[i + 1], bx = A[i + 2], bz = A[i + 3];
    for (let j = 0; j + 3 < B.length; j += 2) {
      const d = Math.min(
        distSeg(ax, az, B[j], B[j + 1], B[j + 2], B[j + 3]), distSeg(bx, bz, B[j], B[j + 1], B[j + 2], B[j + 3]),
        distSeg(B[j], B[j + 1], ax, az, bx, bz), distSeg(B[j + 2], B[j + 3], ax, az, bx, bz));
      if (d < best) { best = d; if (best < limit) return best; }
    }
  }
  return best;
}

/** offset lane i from the road centreline; lane 0 is always the kerb-side lane */
export function laneOffset(link, i) {
  if (link.edgeR !== undefined) return RIGHT_HAND_TRAFFIC
    ? link.edgeR + (i + 0.5) * ((link.edgeL - link.edgeR) / link.nLanes)
    : link.edgeL - (i + 0.5) * ((link.edgeL - link.edgeR) / link.nLanes);
  if (link.oneway) return RIGHT_HAND_TRAFFIC
    ? -link.road.w / 2 + (i + 0.5) * link.laneW
    : link.road.w / 2 - (i + 0.5) * link.laneW;
  return (RIGHT_HAND_TRAFFIC ? -1 : 1) * (link.nLanes - i - 0.5) * link.laneW;
}

/** packs many small coordinate arrays into a few big Float32Arrays (subarray views: far less GC than 1e5 arrays) */
function makePool() {
  let cur = new Float32Array(1 << 18), off = 0;
  return (arr) => {
    if (!arr) return null;
    const n = arr.length;
    if (off + n > cur.length) { cur = new Float32Array(Math.max(1 << 18, n)); off = 0; }
    const v = cur.subarray(off, off + n);
    for (let i = 0; i < n; i++) v[i] = arr[i];
    off += n;
    return v;
  };
}

// =================================================================================================================
export function buildLondonRoadNetwork(geo, world = null, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const pool = makePool();
  const inArea = opts.area ? (x, z) => Math.hypot(x - opts.area.cx, z - opts.area.cz) < opts.area.r : null;

  // ---- 1. car roads ------------------------------------------------------------------------------------------
  const roads = [];
  for (const r of geo.roads) {
    if (!DRIVE_KINDS.has(r.kind) || r.tunnel) continue;
    if (r.kind === 'service' && !SERVICE_OK.has(r.sub)) continue;
    if (r.pts.length < 4) continue;
    if (inArea) {
      let any = false;
      for (let i = 0; i < r.pts.length && !any; i += 2) any = inArea(r.pts[i], r.pts[i + 1]);
      if (!any) continue;
    }
    roads.push({ src: r, pts: Array.from(r.pts), ys: r.deck ? Array.from(r.deck) : null, feat: [] });
  }

  // ---- 2. snap signals / crossings onto the roads (insert vertices where needed) -------------------------------
  const segGrid = makeGrid(40);
  roads.forEach((R, ri) => {
    const p = R.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      segGrid.add({ ri, i }, Math.min(p[i], p[i + 2]), Math.min(p[i + 1], p[i + 3]), Math.max(p[i], p[i + 2]), Math.max(p[i + 1], p[i + 3]));
    }
  });
  const featureAt = new Map(); // vertex key -> {signal, zebra, sigCross}
  const inserts = new Map(); // ri -> [{i, t, x, z}]
  let stamp = 1;
  const tmp = [];
  function snapFeature(x, z, maxD, feat) {
    tmp.length = 0;
    segGrid.query(x, z, maxD, tmp, ++stamp);
    let best = null, bd = maxD;
    for (const s of tmp) {
      const p = roads[s.ri].pts;
      const h = distPointSeg(x, z, p[s.i], p[s.i + 1], p[s.i + 2], p[s.i + 3]);
      if (h.d < bd) { bd = h.d; best = { ri: s.ri, i: s.i, t: h.t }; }
    }
    if (!best) return false;
    const p = roads[best.ri].pts;
    const ax = p[best.i], az = p[best.i + 1], bx = p[best.i + 2], bz = p[best.i + 3];
    const L = Math.hypot(bx - ax, bz - az);
    let qx = ax + (bx - ax) * best.t, qz = az + (bz - az) * best.t;
    if (best.t * L < 1.2) { qx = ax; qz = az; } else if ((1 - best.t) * L < 1.2) { qx = bx; qz = bz; } else {
      qx = Math.round(qx * 10) / 10; qz = Math.round(qz * 10) / 10;
      let a = inserts.get(best.ri);
      if (!a) inserts.set(best.ri, (a = []));
      a.push({ i: best.i, t: best.t, x: qx, z: qz });
    }
    const k = keyOf(qx, qz);
    let f = featureAt.get(k);
    if (!f) featureAt.set(k, (f = { signal: false, zebra: false, sigCross: false, x: qx, z: qz }));
    f[feat] = true;
    return true;
  }
  const S = geo.signals;
  for (let i = 0; i < S.length; i += 2) snapFeature(S[i], S[i + 1], SIGNAL_SNAP, 'signal');
  for (const c of geo.crossings) snapFeature(c.x, c.z, CROSS_SNAP, c.kind === 'zebra' ? 'zebra' : 'sigCross');
  for (const [ri, list] of inserts) {
    const R = roads[ri];
    list.sort((a, b) => a.i - b.i || a.t - b.t);
    const np = [], ny = R.ys ? [] : null;
    let li = 0;
    for (let i = 0; i < R.pts.length; i += 2) {
      np.push(R.pts[i], R.pts[i + 1]);
      if (ny) ny.push(R.ys[i / 2]);
      while (li < list.length && list[li].i === i) {
        const q = list[li++];
        const lx = np[np.length - 2], lz = np[np.length - 1];
        if (Math.abs(lx - q.x) + Math.abs(lz - q.z) < 0.05) continue;
        np.push(q.x, q.z);
        if (ny) ny.push(R.ys[i / 2] + (R.ys[i / 2 + 1] - R.ys[i / 2]) * q.t);
      }
    }
    R.pts = np; R.ys = ny;
  }

  // ---- 3. nodes: vertex keys used by 2+ road vertices, way ends, features --------------------------------------
  const useCount = new Map();
  for (const R of roads) {
    const p = R.pts;
    for (let i = 0; i < p.length; i += 2) {
      const k = keyOf(p[i], p[i + 1]);
      useCount.set(k, (useCount.get(k) || 0) + 1);
    }
  }
  const nodes = [];
  const nodeByKey = new Map();
  const getNode = (x, z) => {
    const k = keyOf(x, z);
    let n = nodeByKey.get(k);
    if (!n) {
      const f = featureAt.get(k);
      n = { id: nodes.length, x, z, key: k, ends: [], degree: 0, signal: !!(f && f.signal), zebra: !!(f && f.zebra), sigCross: !!(f && f.sigCross),
        controller: null, roundabout: false, crossing: null };
      nodes.push(n);
      nodeByKey.set(k, n);
    }
    return n;
  };

  // ---- 4. pieces -------------------------------------------------------------------------------------------------
  const pieces = [];
  for (const R of roads) {
    const p = R.pts, n = p.length / 2;
    let start = 0;
    for (let i = 1; i < n; i++) {
      const k = keyOf(p[2 * i], p[2 * i + 1]);
      const isNode = i === n - 1 || useCount.get(k) > 1 || featureAt.has(k);
      if (!isNode) continue;
      const xs = [], ys = R.ys ? [] : null;
      for (let j = start; j <= i; j++) {
        if (xs.length && Math.abs(xs[xs.length - 2] - p[2 * j]) + Math.abs(xs[xs.length - 1] - p[2 * j + 1]) < 0.01) continue;
        xs.push(p[2 * j], p[2 * j + 1]);
        if (ys) ys.push(R.ys[j]);
      }
      if (xs.length >= 4) {
        const pts = xs;
        const cum = cumulative(pts);
        const len = cum[cum.length - 1];
        if (len > 0.3) {
          const a = getNode(p[2 * start], p[2 * start + 1]), b = getNode(p[2 * i], p[2 * i + 1]);
          const piece = { id: pieces.length, road: R.src, pts, ys: ys || null, len, a, b, links: [] };
          pieces.push(piece);
          a.ends.push({ piece, end: 0 });
          b.ends.push({ piece, end: 1 });
        }
      }
      start = i;
    }
  }
  for (const n of nodes) {
    n.degree = n.ends.length;
    n.roundabout = n.ends.some((e) => e.piece.road.junction === 'roundabout');
  }

  // ---- 5. trims (how far lanes stop short of a node) -------------------------------------------------------------
  function trimAt(node, piece) {
    if (node.degree >= 3) {
      let other = 0;
      for (const e of node.ends) if (e.piece !== piece) other = Math.max(other, e.piece.road.w / 2);
      return Math.min(15, Math.max(3.5, other + 2.0));
    }
    if (node.zebra || node.sigCross || node.signal) return 2.2;
    return node.degree === 1 ? 0.3 : 0.8;
  }
  for (const pc of pieces) {
    let ta = trimAt(pc.a, pc), tb = trimAt(pc.b, pc);
    const room = pc.len - 0.6;
    if (ta + tb > room) {
      const k = Math.max(0, room) / (ta + tb);
      ta *= k; tb *= k;
      if (room <= 0) { ta = pc.len * 0.3; tb = pc.len * 0.3; }
    }
    pc.trimA = ta; pc.trimB = tb;
  }

  // ---- 6. links (eager; their lanes are built on first use, see ensureLink) ------------------------------------
  const links = [], lanes = [];
  const linkGrid = makeGrid(50);
  const TP = { x: 0, z: 0, y: 0, dx: 0, dz: 0 };
  for (const pc of pieces) {
    const r = pc.road;
    const ow = r.oneway;
    const totalLanes = Math.max(1, r.lanes || Math.round(r.w / 3.2) || 1);
    let perDir = Math.min(4, ow ? totalLanes : Math.max(1, Math.floor(totalLanes / 2)));
    if (ow) perDir = Math.max(1, Math.min(perDir, Math.floor(r.w / LANE_MIN_W))); // no lanes narrower than a car + margin
    let laneW = ow ? r.w / perDir : r.w / (2 * perDir);
    if (!ow) laneW = Math.max(laneW, LANE_MIN_W);
    const mph = r.maxspeed > 0 ? r.maxspeed : DEFAULT_MPH[r.kind] || 20;
    const dirs = [];
    if (ow !== -1) dirs.push(1);
    if (ow !== 1) dirs.push(-1);
    const bb = bbox(pc.pts), m = r.w / 2 + 1;
    bb[0] -= m; bb[1] -= m; bb[2] += m; bb[3] += m;
    for (const dir of dirs) {
      let pts = pc.pts, ys = pc.ys;
      if (dir < 0) {
        const n = pts.length / 2, q = new Array(pts.length);
        for (let i = 0; i < n; i++) { q[2 * i] = pts[2 * (n - 1 - i)]; q[2 * i + 1] = pts[2 * (n - 1 - i) + 1]; }
        pts = q;
        if (ys) ys = ys.slice().reverse();
      }
      const from = dir > 0 ? pc.a : pc.b, to = dir > 0 ? pc.b : pc.a;
      const link = {
        id: links.length, piece: pc, road: r, name: r.name, kind: r.kind, dir, from, to, pts, ys, cum: cumulative(pts), len: pc.len,
        trimS: dir > 0 ? pc.trimA : pc.trimB, trimE: dir > 0 ? pc.trimB : pc.trimA,
        nLanes: perDir, laneW, oneway: !!ow, speed: mph * MPH, mph, rank: r.junction === 'roundabout' ? 9 : RANK[r.kind] ?? 1,
        roundabout: r.junction === 'roundabout', lanes: null, control: null, zebra: null, succ: null, moves: null, reverse: null,
        busStops: null, bb, _q: 0, sdx: 0, sdz: 1, edx: 0, edz: 1,
        bus: (r.kind === 'primary' || r.kind === 'secondary' || r.kind === 'trunk' || r.kind === 'tertiary' || r.sub === 'bus') && r.w >= 5.6
      };
      // heading at both ends (over the first / last ~8 m, stable against tiny end segments)
      const L = link.len;
      pointAt(link, Math.min(L, 8), TP);
      let hx = TP.x - pts[0], hz = TP.z - pts[1], hl = Math.hypot(hx, hz) || 1;
      link.sdx = hx / hl; link.sdz = hz / hl;
      pointAt(link, Math.max(0, L - 8), TP);
      hx = pts[pts.length - 2] - TP.x; hz = pts[pts.length - 1] - TP.z; hl = Math.hypot(hx, hz) || 1;
      link.edx = hx / hl; link.edz = hz / hl;
      pc.links.push(link);
      links.push(link);
      linkGrid.add(link, bb[0], bb[1], bb[2], bb[3]);
    }
    if (pc.links.length === 2) { pc.links[0].reverse = pc.links[1]; pc.links[1].reverse = pc.links[0]; }
  }
  for (const n of nodes) { n.inLinks = []; n.outLinks = []; n.connectors = null; n.conflictsReady = false; }
  for (const l of links) { l.to.inLinks.push(l); l.from.outLinks.push(l); }

  /** build a link's lanes (offset, trimmed polylines; lane 0 = kerb-side lane) */
  // OSM often maps dual carriageways closer together than their (estimated) widths: keep a oneway link's offside
  // lanes on our side of the midline to the nearest oncoming carriageway
  const nearTmp = [];
  function fitCarriageway(link) {
    if (!link.oneway || link.nLanes < 1) return;
    const half = link.road.w / 2;
    let limit = half;
    for (const f of [0.15, 0.5, 0.85]) {
      pointAt(link, link.len * f, TP);
      const rx = RIGHT_HAND_TRAFFIC ? TP.dz : -TP.dz, rz = RIGHT_HAND_TRAFFIC ? -TP.dx : TP.dx; // oncoming carriageway side
      nearTmp.length = 0;
      linkGrid.query(TP.x, TP.z, half + 12, nearTmp, ++stamp);
      for (const o of nearTmp) {
        if (o === link || !o.oneway || o.piece === link.piece) continue;
        const p = o.pts;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const d = distSeg(TP.x, TP.z, p[k], p[k + 1], p[k + 2], p[k + 3]);
          if (d > half + o.road.w / 2 + 1 || d > 30) continue;
          const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1], dl = Math.hypot(dx, dz) || 1;
          if ((dx * TP.dx + dz * TP.dz) / dl > -0.8) continue; // not oncoming
          const qx = p[k] + dx * _t - TP.x, qz = p[k + 1] + dz * _t - TP.z;
          if (qx * rx + qz * rz <= 0) continue; // not on the side where oncoming traffic should be
          limit = Math.min(limit, d / 2 - 0.35);
        }
      }
    }
    if (limit < half) {
      const minW = link.nLanes * 2.4;
      link.edgeL = half;
      link.edgeR = -Math.max(limit, minW - half);
      link.laneW = (link.edgeL - link.edgeR) / link.nLanes;
    }
  }

  function ensureLink(link) {
    if (link.lanes) return link.lanes;
    link.lanes = [];
    fitCarriageway(link);
    const L = link.len;
    for (let i = 0; i < link.nLanes; i++) {
      const off = laneOffset(link, i);
      const offPts = offsetLine(link.pts, off);
      const offCum = cumulative(offPts);
      const OL = offCum[offCum.length - 1];
      const k = OL / Math.max(L, 1e-3);
      const cut = cutLine(offPts, link.ys, link.trimS * k, OL - link.trimE * k);
      const lc = cumulative(cut.pts);
      const lane = {
        type: 'lane', id: lanes.length, link, index: i, offset: off, pts: cut.pts, ys: cut.ys, cum: lc, len: lc[lc.length - 1],
        outs: [], ins: [], busStops: null, occ: [], bb: bbox(cut.pts), res: null, holdBack: 0
      };
      if (i === 0 && link.busStops) {
        const st = link.busStops.map((s) => (s - link.trimS) * k).filter((s) => s > 12 && s < lane.len - 6);
        if (st.length) lane.busStops = st;
      }
      lanes.push(lane);
      link.lanes.push(lane);
    }
    return link.lanes;
  }

  // ---- 7. turns (eager, link level: routing) and connectors (lazy, lane level: ensureNode) ----------------------
  const TURN_CODES = ['S', 'L', 'R', 'U'];
  function movesOf(il) {
    const n = il.to, cands = [];
    for (const ol of n.outLinks) {
      const uturn = ol.piece === il.piece;
      const cross = il.edx * ol.sdz - il.edz * ol.sdx, dot = il.edx * ol.sdx + il.edz * ol.sdz;
      const angle = -Math.atan2(cross, dot); // + = left turn (left of (dx,dz) is (dz,-dx))
      let turn = Math.abs(angle) < 0.6 ? 'S' : angle > 0 ? 'L' : 'R';
      if (uturn || Math.abs(angle) > 2.7) turn = 'U';
      cands.push({ ol, turn, angle });
    }
    const use = cands.filter((c) => c.turn !== 'U');
    return use.length ? use : cands; // dead end: U-turn allowed
  }
  for (const n of nodes) {
    for (const il of n.inLinks) {
      // succ: out-links reachable (no U-turns unless nothing else); `moves` (with turn kinds) is built by ensureNode
      const succ = [];
      let anyNonU = false;
      for (const ol of n.outLinks) {
        if (ol.piece === il.piece) continue;
        const cross = il.edx * ol.sdz - il.edz * ol.sdx, dot = il.edx * ol.sdx + il.edz * ol.sdz;
        if (Math.abs(Math.atan2(cross, dot)) > 2.7) continue;
        succ.push(ol); anyNonU = true;
      }
      il.succ = anyNonU ? succ : n.outLinks.slice();
    }
  }
  void TURN_CODES;

  const connectors = [];
  const P = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
  function makeConnector(node, from, to, turn, angle) {
    const ax = from.pts[from.pts.length - 2], az = from.pts[from.pts.length - 1];
    const bx = to.pts[0], bz = to.pts[1];
    const fl = from.link, tl = to.link;
    pointAt(from, from.len - 0.01, P); const t0x = P.dx, t0z = P.dz;
    pointAt(to, 0.01, P); const t1x = P.dx, t1z = P.dz;
    const d = Math.hypot(bx - ax, bz - az);
    let h = d * 0.42;
    if (turn === 'U') h = Math.max(h, fl.laneW * 1.6 + 2);
    const c1x = ax + t0x * h, c1z = az + t0z * h, c2x = bx - t1x * h, c2z = bz - t1z * h;
    const nSeg = Math.max(3, Math.min(10, Math.ceil(d / 2.2)));
    const pts = new Array((nSeg + 1) * 2);
    for (let i = 0; i <= nSeg; i++) {
      const t = i / nSeg, u = 1 - t;
      const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      pts[2 * i] = w0 * ax + w1 * c1x + w2 * c2x + w3 * bx;
      pts[2 * i + 1] = w0 * az + w1 * c1z + w2 * c2z + w3 * bz;
    }
    const y0 = from.ys ? from.ys[from.ys.length - 1] : 0, y1 = to.ys ? to.ys[0] : 0;
    let ys = null;
    if (y0 || y1) { ys = new Array(nSeg + 1); for (let i = 0; i <= nSeg; i++) ys[i] = y0 + (y1 - y0) * (i / nSeg); }
    const cum = cumulative(pts);
    const len = cum[nSeg];
    let minR = Infinity;
    for (let i = 1; i < nSeg; i++) {
      const ux = pts[2 * i] - pts[2 * i - 2], uz = pts[2 * i + 1] - pts[2 * i - 1];
      const vx = pts[2 * i + 2] - pts[2 * i], vz = pts[2 * i + 3] - pts[2 * i + 1];
      const lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (lu < 1e-4 || lv < 1e-4) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv))));
      if (ang > 1e-3) minR = Math.min(minR, ((lu + lv) / 2) / ang);
    }
    const c = {
      type: 'conn', id: connectors.length, node, from, to, turn, angle, pts, ys, cum, len, occ: [],
      vmax: Math.min(tl.speed, fl.speed, Math.sqrt(3.2 * Math.min(minR, 400))),
      priority: Math.max(fl.rank, 0) * 4 + TURN_RANK[turn], conflicts: [], bb: bbox(pts), res: null, _q: 0
    };
    connectors.push(c);
    from.outs.push(c);
    to.ins.push(c);
    return c;
  }

  /** build the junction connectors of node n (and the lanes of every link touching it), with their conflicts */
  function ensureNode(n) {
    if (n.connectors) return n.connectors;
    n.connectors = [];
    for (const l of n.inLinks) ensureLink(l);
    for (const l of n.outLinks) ensureLink(l);
    for (const il of n.inLinks) {
      const use = il.moves || (il.moves = movesOf(il));
      if (!use.length) continue;
      const nIn = il.nLanes;
      const all = il.lanes.map((_, i) => i);
      for (const c of use) {
        const ol = c.ol, nOut = ol.nLanes;
        let allowed;
        if (use.length === 1 || nIn === 1) allowed = all;
        else if ((RIGHT_HAND_TRAFFIC ? c.turn === 'R' : c.turn === 'L')) allowed = all.slice(0, Math.ceil(nIn / 2));
        else if ((RIGHT_HAND_TRAFFIC ? c.turn === 'L' : c.turn === 'R') || c.turn === 'U') allowed = all.slice(Math.floor(nIn / 2));
        else allowed = all;
        for (let k = 0; k < allowed.length; k++) {
          const i = allowed[k];
          let j;
          if (nOut === 1) j = 0;
          else if (RIGHT_HAND_TRAFFIC ? c.turn === 'R' : c.turn === 'L') j = Math.min(k, nOut - 1);
          else if ((RIGHT_HAND_TRAFFIC ? c.turn === 'L' : c.turn === 'R') || c.turn === 'U') j = Math.max(0, nOut - allowed.length + k);
          else j = allowed.length === 1 ? Math.min(i, nOut - 1) : Math.round((k * (nOut - 1)) / (allowed.length - 1));
          n.connectors.push(makeConnector(n, il.lanes[i], ol.lanes[j], c.turn, c.angle));
        }
      }
      for (const lane of il.lanes) {
        if (lane.outs.length) continue;
        let best = null;
        for (const c of use) if (!best || Math.abs(c.angle) < Math.abs(best.angle)) best = c;
        n.connectors.push(makeConnector(n, lane, best.ol.lanes[Math.min(lane.index, best.ol.nLanes - 1)], best.turn, best.angle));
      }
    }
    ensureConflicts(n);
    // hold lines: how far back from its end a lane's traffic must wait so a waiting car's nose (+ corners, 1 m wide
    // each side) stays >= 0.45 m clear of every other path through the box
    for (const il of n.inLinks) {
      for (const lane of il.lanes) {
        const ex = lane.pts[lane.pts.length - 2], ez = lane.pts[lane.pts.length - 1];
        pointAt(lane, lane.len - 0.01, P);
        const dx = P.dx, dz = P.dz, lx = dz, lz = -dx;
        let back = 0;
        for (; back < 6; back += 0.5) {
          const fx = ex - dx * back, fz = ez - dz * back;
          let clear = true;
          for (const c of n.connectors) {
            if (c.from === lane || c.from.link === il) continue;
            for (const [px, pz] of [[fx, fz], [fx + lx, fz + lz], [fx - lx, fz - lz]]) {
              const p = c.pts;
              for (let k = 0; k + 3 < p.length && clear; k += 2) if (distSeg(px, pz, p[k], p[k + 1], p[k + 2], p[k + 3]) < 1.45) clear = false;
            }
            if (!clear) break;
          }
          if (clear) break;
        }
        lane.holdBack = Math.min(back, Math.max(0, lane.len - 1));
      }
    }
    return n.connectors;
  }

  // ---- 7b. bus stops: along the kerb side of bus-route links ------------------------------------------------------
  {
    const B = geo.busStops, near = [];
    for (let i = 0; i < B.length; i += 2) {
      const x = B[i], z = B[i + 1];
      near.length = 0;
      linkGrid.query(x, z, 16, near, ++stamp);
      let best = null, bd = Infinity;
      for (const link of near) {
        if (!link.bus) continue;
        const p = link.pts;
        const lim = laneOffset(link, 0) + 9;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const d = distSeg(x, z, p[k], p[k + 1], p[k + 2], p[k + 3]);
          if (d >= lim || d >= bd) continue;
          const t = _t;
          const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1];
          const kerbSide = (x - p[k]) * dz - (z - p[k + 1]) * dx;
          if (RIGHT_HAND_TRAFFIC ? kerbSide > -0.5 : kerbSide < 0.5) continue; // stop must be on the kerb side
          bd = d; best = { link, s: link.cum[k / 2] + t * Math.hypot(dx, dz) };
        }
      }
      if (best) (best.link.busStops || (best.link.busStops = [])).push(best.s);
    }
    for (const l of links) if (l.busStops) l.busStops.sort((a, b) => a - b);
  }

  // ---- 8. signal controllers ---------------------------------------------------------------------------------
  const sigNodes = nodes.filter((n) => n.signal || n.sigCross);
  // seeded clustering (no chaining along a gyratory): junction nodes first, each takes the unassigned signal nodes
  // within CLUSTER_DIST of itself
  const groups = new Map();
  {
    const g = makeGrid(CLUSTER_DIST);
    for (const n of sigNodes) g.add(n, n.x, n.z, n.x, n.z);
    const order = sigNodes.slice().sort((a, b) => b.degree - a.degree || a.id - b.id);
    const near = [];
    for (const n of order) {
      if (n._grp !== undefined) continue;
      const members = [n];
      n._grp = groups.size;
      near.length = 0;
      g.query(n.x, n.z, CLUSTER_DIST, near, ++stamp);
      for (const m of near) {
        if (m._grp !== undefined || Math.hypot(m.x - n.x, m.z - n.z) > (m.degree >= 3 ? CLUSTER_DIST * 0.55 : CLUSTER_DIST)) continue;
        m._grp = n._grp;
        members.push(m);
      }
      groups.set(n._grp, members);
    }
    // stop lines a short hop apart (staggered junctions, gyratories) must share one cycle: merge their groups
    const par = new Map();
    const root = (g) => { while (par.has(g) && par.get(g) !== g) g = par.get(g); return g; };
    const unite = (ga, gb) => {
      const ra = root(ga), rb = root(gb);
      if (ra !== rb) par.set(Math.max(ra, rb), Math.min(ra, rb));
    };
    for (const n of sigNodes) {
      // walk short pieces (< 25 m each, 40 m in all) from this signal node to the other signal nodes they reach
      const seen = new Map([[n, 0]]), stack = [n];
      while (stack.length) {
        const q = stack.pop(), d = seen.get(q);
        for (const e of q.ends) {
          const pc = e.piece;
          if (pc.len > 25) continue;
          const o = pc.a === q ? pc.b : pc.a, dd = d + pc.len;
          if (dd > 40 || (seen.has(o) && seen.get(o) <= dd)) continue;
          seen.set(o, dd);
          if (o._grp !== undefined) unite(n._grp, o._grp);
          stack.push(o);
        }
      }
    }
    for (const [g, members] of [...groups]) {
      const r = root(g);
      if (r === g) continue;
      groups.get(r).push(...members);
      groups.delete(g);
    }
  }
  const controllers = [];
  const signalHeads = [];
  let rngState = 12345;
  const rng = () => ((rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (const members of groups.values()) {
    let cx = 0, cz = 0;
    for (const n of members) { cx += n.x; cz += n.z; }
    cx /= members.length; cz /= members.length;
    const ctl = { id: controllers.length, x: cx, z: cz, nodes: members, approaches: [], phases: 0, stages: [], cycle: 0, offset: 0, ped: false, crossings: [] };
    for (const n of members) {
      n.controller = ctl;
      for (const il of n.inLinks) {
        const vx = cx - n.x, vz = cz - n.z, vd = Math.hypot(vx, vz);
        if (members.length > 1 && vd > 8 && il.edx * vx + il.edz * vz < 0) continue; // leaving the junction
        if (il.control) continue;
        ctl.approaches.push({ link: il, node: n, phase: 0, axis: Math.atan2(il.edx, il.edz) });
      }
      if (n.sigCross) ctl.ped = true;
    }
    if (!ctl.approaches.length) { for (const n of members) n.controller = null; continue; }
    // phases by axis (mod pi)
    const axes = [];
    for (const ap of ctl.approaches) {
      let a = ap.axis % Math.PI; if (a < 0) a += Math.PI;
      let best = -1, bd = 0.6;
      for (let k = 0; k < axes.length; k++) {
        let d = Math.abs(a - axes[k]); d = Math.min(d, Math.PI - d);
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0) {
        if (axes.length < 3) { axes.push(a); best = axes.length - 1; } else {
          best = 0; let md = Infinity;
          for (let k = 0; k < axes.length; k++) { let d = Math.abs(a - axes[k]); d = Math.min(d, Math.PI - d); if (d < md) { md = d; best = k; } }
        }
      }
      ap.phase = best;
      ap.link.control = { controller: ctl, phase: best, approach: ap };
    }
    ctl.phases = axes.length;
    if (ctl.phases === 1 && !ctl.ped) ctl.ped = true; // lone signal on one axis: a signal-controlled pedestrian crossing
    // stages: [green k][amber k][all-red] ... [+ pedestrians][all-red]
    let t = 0;
    // greens kept short-ish so nobody (the player included) sits at a red for more than ~45 s: 2-axis junctions
    // ≈ 50 s cycles, 3-axis gyratories ≈ 60 s (real London runs 90–120 s; that is no fun in a game)
    const G = ctl.phases === 1 ? 20 : ctl.phases === 2 ? 17 : 12;
    for (let k = 0; k < ctl.phases; k++) {
      ctl.stages.push({ type: 'g', phase: k, start: t, end: (t += G + Math.round(rng() * (ctl.phases === 3 ? 3 : 4))) });
      ctl.stages.push({ type: 'a', phase: k, start: t, end: (t += 3) });
      ctl.stages.push({ type: 'r', phase: -1, start: t, end: (t += 2), next: k + 1 < ctl.phases ? k + 1 : ctl.ped ? -2 : 0 });
    }
    if (ctl.ped) {
      ctl.stages.push({ type: 'p', phase: -1, start: t, end: (t += 6.5) });
      ctl.stages.push({ type: 'r', phase: -1, start: t, end: (t += 2), next: 0 });
    }
    ctl.cycle = t;
    ctl.offset = rng() * t;
    controllers.push(ctl);
    for (const ap of ctl.approaches) {
      const l = ap.link;
      pointAt(l, l.len - l.trimE, TP);
      const sideSign = RIGHT_HAND_TRAFFIC ? -1 : 1;
      const lx = TP.dz * sideSign, lz = -TP.dx * sideSign, o0 = laneOffset(l, 0);
      const ex = TP.x + lx * o0, ez = TP.z + lz * o0;
      // signal head on the kerb verge at the stop line, facing the arriving drivers
      const off = l.laneW * 0.5 + 1.2;
      ap.head = signalHeads.length;
      signalHeads.push({ id: signalHeads.length, controller: ctl.id, phase: ap.phase, node: ap.node.id, link: l.id,
        x: ex + lx * off, z: ez + lz * off, y: TP.y, heading: Math.atan2(-TP.dx, -TP.dz), stopX: ex, stopZ: ez,
        // stop line across the approach: from the centre line (or the far kerb of a oneway) to the kerb
        lineX0: TP.x + lx * (l.oneway ? -l.road.w / 2 : 0), lineZ0: TP.z + lz * (l.oneway ? -l.road.w / 2 : 0),
        lineX1: TP.x + lx * (l.oneway ? l.road.w / 2 : l.laneW * l.nLanes), lineZ1: TP.z + lz * (l.oneway ? l.road.w / 2 : l.laneW * l.nLanes) });
    }
  }

  /** aspect (ASPECT.*) of phase `phase` of controller `ctl` at time t (s) */
  function aspect(ctl, phase, t) {
    let tau = (t + ctl.offset) % ctl.cycle;
    if (tau < 0) tau += ctl.cycle;
    const st = ctl.stages;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (tau >= s.end) continue;
      if (s.type === 'g') return s.phase === phase ? ASPECT.GREEN : ASPECT.RED;
      if (s.type === 'a') return s.phase === phase ? ASPECT.AMBER : ASPECT.RED;
      if (s.type === 'r') return s.next === phase ? ASPECT.RED_AMBER : ASPECT.RED;
      return ASPECT.RED; // pedestrian stage
    }
    return ASPECT.RED;
  }
  /** seconds of green man left at controller ctl (0 when pedestrians must wait) */
  function pedWalk(ctl, t) {
    if (!ctl.ped) return 0;
    let tau = (t + ctl.offset) % ctl.cycle;
    if (tau < 0) tau += ctl.cycle;
    for (const s of ctl.stages) if (s.type === 'p' && tau >= s.start && tau < s.end) return s.end - tau;
    return 0;
  }

  // ---- 9. pedestrian crossings (zebras and signal crossings that sit on a drive road node) ----------------------
  const crossings = [];
  for (const n of nodes) {
    if (!(n.zebra || n.sigCross) || n.degree > 2 || !n.ends.length) continue;
    const pc = n.ends[0].piece;
    // road direction at the node
    const p = pc.pts, end = n.ends[0].end;
    const i0 = end === 0 ? 0 : p.length - 4;
    let dx = p[i0 + 2] - p[i0], dz = p[i0 + 3] - p[i0 + 1];
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    let half = pc.road.w / 2 + 0.3;
    if (!pc.road.oneway) half = Math.max(half, pc.links[0] ? pc.links[0].laneW * pc.links[0].nLanes + 0.3 : half);
    const cr = { id: crossings.length, node: n, kind: n.zebra ? 'zebra' : 'signals', x: n.x, z: n.z, y: pc.ys ? (end === 0 ? pc.ys[0] : pc.ys[pc.ys.length - 1]) : 0,
      ax: dz, az: -dx, half, controller: n.controller, peds: 0, stepping: 0, waiting: 0, links: n.inLinks.slice() };
    n.crossing = cr;
    crossings.push(cr);
    if (n.controller) n.controller.crossings.push(cr);
    if (n.zebra) for (const il of n.inLinks) il.zebra = cr;
  }

  // ---- 11. pavements (until Workstream F publishes its sidewalks): both sides of each piece at w/2 + 1.6, plus
  // separately mapped sidewalks and pedestrian streets. Geometry is built on first use (pavementsNear()).
  const pavements = [];
  const paveGrid = makeGrid(50);
  const addPave = (pv, bb) => { pavements.push(pv); paveGrid.add(pv, bb[0], bb[1], bb[2], bb[3]); };
  for (const pc of pieces) {
    const r = pc.road;
    if (r.kind === 'service' || r.kind === 'motorway' || pc.len < 6) continue;
    const bb = bbox(pc.pts), m = r.w / 2 + 2;
    bb[0] -= m; bb[1] -= m; bb[2] += m; bb[3] += m;
    for (const side of [1, -1]) addPave({ id: pavements.length, pts: null, ys: null, cum: null, len: 0, piece: pc, side, kind: r.kind, road: null, bb, _q: 0 }, bb);
  }
  for (const r of geo.roads) {
    if (!(r.kind === 'pedestrian' || (r.kind === 'footway' && r.sub === 'sidewalk'))) continue;
    if (r.tunnel || r.pts.length < 4) continue;
    if (inArea && !inArea(r.pts[0], r.pts[1])) continue;
    const bb = bbox(r.pts);
    if (Math.abs(bb[2] - bb[0]) + Math.abs(bb[3] - bb[1]) < 8) continue;
    addPave({ id: pavements.length, pts: null, ys: null, cum: null, len: 0, piece: null, side: 0, kind: r.kind, road: r, bb, _q: 0 }, bb);
  }
  function pavementGeom(pv) {
    if (pv.cum) return pv;
    if (pv.strip) { pv.pts = pv.strip.pts; pv.ys = pv.strip.y || null; } else if (pv.piece) {
      const pc = pv.piece, r = pc.road;
      const line = offsetLine(pc.pts, pv.side * (r.w / 2 + 1.6));
      const lc = cumulative(line);
      const cut = cutLine(line, pc.ys, Math.min(pc.trimA * 0.6, pc.len * 0.3), lc[lc.length - 1] - Math.min(pc.trimB * 0.6, pc.len * 0.3));
      pv.pts = cut.pts; pv.ys = cut.ys;
    } else { pv.pts = pv.road.pts; pv.ys = pv.road.deck; }
    pv.cum = cumulative(pv.pts);
    pv.len = pv.cum[pv.cum.length - 1];
    return pv;
  }
  /** replace the derived pavements with Workstream F's drawn ones (london-city.js sidewalks.strips:
   *  {pts: Float32Array [x,z,…] centreline, y: Float32Array pavement top per point, w, kind}) */
  function usePavements(strips) {
    pavements.length = 0;
    paveGrid.clear();
    for (const st of strips) {
      if (!st.pts || st.pts.length < 4) continue;
      const bb = bbox(st.pts);
      addPave({ id: pavements.length, pts: null, ys: null, cum: null, len: 0, piece: null, side: 0, kind: st.kind || 'residential', road: null,
        strip: st, w: st.w || 2.5, bb, _q: 0 }, bb);
    }
    return pavements.length;
  }

  /** connector conflict lists of a node, computed on first use (cheap per node, ~2 s for all of Zone 1 at once) */
  function ensureConflicts(n) {
    if (n.conflictsReady) return;
    n.conflictsReady = true;
    const cs = n.connectors;
    // where a street just continues (no junction), oncoming cars on narrow streets squeeze past each other
    const gap = n.degree <= 2 ? 1.95 : CONFLICT_GAP;
    for (let a = 0; a < cs.length; a++) {
      const A = cs[a];
      for (let b = a + 1; b < cs.length; b++) {
        const B = cs[b];
        let conflict = A.from === B.from || A.to === B.to;
        if (!conflict) {
          if (A.bb[0] - gap > B.bb[2] || B.bb[0] - gap > A.bb[2] || A.bb[1] - gap > B.bb[3] || B.bb[1] - gap > A.bb[3]) continue;
          conflict = polyDist(A.pts, B.pts, gap) < gap;
        }
        if (conflict) { A.conflicts.push(B); B.conflicts.push(A); }
      }
    }
  }

  // ---- queries ---------------------------------------------------------------------------------------------------
  const tmpLinks = [];
  /** lanes of the links within ~r of (x, z) (builds them on first use) */
  function lanesNear(x, z, r, out = []) {
    out.length = 0;
    tmpLinks.length = 0;
    linkGrid.query(x, z, r, tmpLinks, ++stamp);
    for (const l of tmpLinks) for (const lane of ensureLink(l)) out.push(lane);
    return out;
  }
  function linksNear(x, z, r, out = []) {
    out.length = 0;
    linkGrid.query(x, z, r, out, ++stamp);
    return out;
  }
  function pavementsNear(x, z, r, out = []) {
    out.length = 0;
    paveGrid.query(x, z, r, out, ++stamp);
    for (const pv of out) pavementGeom(pv);
    return out;
  }
  const tmpLanes = [];
  /** nearest lane point: {lane, s, x, z, dist}; opts.heading (rad, NY convention) prefers lanes going that way */
  function nearestLane(x, z, { heading = null, maxDist = 60, filter = null } = {}) {
    let best = null, bs = Infinity;
    for (const r of [15, maxDist]) {
      lanesNear(x, z, r, tmpLanes);
      for (const lane of tmpLanes) {
        if (filter && !filter(lane)) continue;
        const p = lane.pts;
        for (let k = 0; k + 3 < p.length; k += 2) {
          const h = distPointSeg(x, z, p[k], p[k + 1], p[k + 2], p[k + 3]);
          if (h.d > maxDist) continue;
          let score = h.d;
          if (heading !== null) {
            const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1], l = Math.hypot(dx, dz) || 1;
            const dot = (dx * Math.sin(heading) + dz * Math.cos(heading)) / l;
            score += (1 - dot) * 6;
          }
          if (score < bs) {
            bs = score;
            const sl = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]);
            best = { lane, s: lane.cum[k / 2] + h.t * sl, x: p[k] + (p[k + 2] - p[k]) * h.t, z: p[k + 1] + (p[k + 3] - p[k + 1]) * h.t, dist: h.d };
          }
        }
      }
      if (best) break;
    }
    return best;
  }

  let maxSpeed = 1;
  for (const l of links) maxSpeed = Math.max(maxSpeed, l.speed);

  /**
   * Car-legal shortest-time route (A*) between two world points, respecting oneways and the turn connectors.
   * Returns null or { points: Float32Array [x,z,...] along the kerb lanes, length (m), duration (s at the limits),
   *   links: [link], steps: [{ name, turn: 'L'|'R'|'S'|'U'|'start'|'arrive', x, z, dist }] }.
   */
  function route(from, to, { heading = null, targetHeading = null } = {}) {
    const a = nearestLane(from.x, from.z, { heading, maxDist: 150 });
    const b = nearestLane(to.x, to.z, { heading: targetHeading, maxDist: 150 });
    if (!a || !b) return null;
    const startL = a.lane.link, goalL = b.lane.link;
    const hx = (l) => Math.hypot(l.to.x - to.x, l.to.z - to.z) / maxSpeed;
    const g = new Map(), prev = new Map(), closed = new Set();
    // binary heap of [f, link]
    const heap = [];
    const push = (f, l) => {
      heap.push([f, l]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    let chain = null;
    if (startL === goalL && b.s >= a.s - 0.5) chain = [startL];
    else {
      const GOAL = { goal: true };
      const startCost = (a.lane.len - a.s) / startL.speed;
      g.set(startL, startCost);
      push(startCost + hx(startL), startL);
      let iter = 0;
      while (heap.length && iter++ < 300000) {
        const [, l] = pop();
        if (l === GOAL) break;
        if (closed.has(l)) continue;
        closed.add(l);
        const gl = g.get(l);
        for (const n of l.succ) {
          const turnPen = n.piece === l.piece ? 30 : 1.5;
          if (n === goalL) {
            const c = gl + b.s / n.speed + turnPen;
            if (c < (g.get(GOAL) ?? Infinity)) { g.set(GOAL, c); prev.set(GOAL, l); push(c, GOAL); }
          }
          if (closed.has(n)) continue;
          const c = gl + n.len / n.speed + turnPen + (n.control ? 4 : 0);
          if (c < (g.get(n) ?? Infinity)) { g.set(n, c); prev.set(n, l); push(c + hx(n), n); }
        }
      }
      if (!prev.has(GOAL)) return null;
      chain = [goalL];
      let l = prev.get(GOAL);
      for (let guard = 0; guard < 100000; guard++) {
        chain.push(l);
        if (l === startL) break;
        l = prev.get(l);
        if (!l) return null;
      }
      chain.reverse();
    }
    const out = [];
    const steps = [{ name: startL.name, turn: 'start', x: a.x, z: a.z, dist: 0 }];
    let length = 0, duration = 0;
    const addLane = (lane, s0, s1) => {
      const P2 = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
      pointAt(lane, s0, P2); out.push(P2.x, P2.z);
      for (let i = 0; i < lane.cum.length; i++) if (lane.cum[i] > s0 && lane.cum[i] < s1) out.push(lane.pts[2 * i], lane.pts[2 * i + 1]);
      pointAt(lane, s1, P2); out.push(P2.x, P2.z);
      length += Math.max(0, s1 - s0);
      duration += Math.max(0, s1 - s0) / lane.link.speed;
    };
    for (let k = 0; k < chain.length; k++) {
      const l = chain[k];
      ensureNode(l.to);
      const lane = l.lanes[0];
      const s0 = k === 0 ? Math.min(a.s, a.lane.len) : 0;
      const s1 = k === chain.length - 1 ? b.s : lane.len;
      addLane(lane, s0, s1);
      if (k + 1 < chain.length) {
        const nl = chain[k + 1];
        let c = null;
        for (const ln of l.lanes) for (const cc of ln.outs) if (cc.to.link === nl && (!c || ln.index < c.from.index)) c = cc;
        if (c) {
          for (let i = 0; i < c.pts.length; i += 2) out.push(c.pts[i], c.pts[i + 1]);
          length += c.len; duration += c.len / Math.max(3, c.vmax);
          if (c.turn !== 'S' || (nl.name && nl.name !== l.name)) steps.push({ name: nl.name, turn: c.turn, x: c.pts[0], z: c.pts[1], dist: length });
        }
      }
    }
    steps.push({ name: goalL.name, turn: 'arrive', x: b.x, z: b.z, dist: length });
    return { points: Float32Array.from(out), length, duration, links: chain, steps };
  }

  // let the build temporaries go (closures below keep this scope alive)
  roads.length = 0; useCount.clear(); featureAt.clear(); inserts.clear(); nodeByKey.clear(); segGrid.clear();
  for (const n of nodes) n.ends = n.ends.map((e) => e.piece);
  const t1 = (typeof performance !== 'undefined' ? performance : Date).now();
  const network = {
    nodes, pieces, links, lanes, connectors, controllers, signalHeads, crossings, pavements,
    lanesNear, linksNear, pavementsNear, pavementGeom, usePavements, nearestLane, route, ensureConflicts, ensureLink, ensureNode, aspect, pedWalk, pointAt, ASPECT, ASPECT_NAMES,
    stats: { roads: roads.length, nodes: nodes.length, links: links.length,
      controllers: controllers.length, signalHeads: signalHeads.length, crossings: crossings.length, pavements: pavements.length,
      busStops: links.reduce((a, l) => a + (l.busStops ? l.busStops.length : 0), 0), buildMs: Math.round(t1 - t0) },
    world
  };
  return network;
}

/** NY name kept for code that still imports it (main.js): builds the London network from the shared geodata */
export function buildRoadNetwork(geo, world) {
  return buildLondonRoadNetwork(geo, world);
}
