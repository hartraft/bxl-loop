// js/life/river-path.js — the Brussels canal fairway for river traffic (no three.js; Node-testable).
//
//   const river = buildRiverPath(world);   // world = createWorldQueries(GEO) (needs isWater)
//   river.at(s, lat, out)       -> out {x, z, dx, dz, half, clearL, clearR}  (s = metres from the south end)
//   river.nearest(x, z)         -> {s, lat, dist}
//   river.piers                 -> [{name, s, side, x, z}]  (side the quay is on, its berth point)
//
// Midstream waypoints (lat/lon along the canal) are densified to 12 m and each sample is pulled to
// the middle of the water cross-section (scanning across with world.isWater, bridging bridge piers), then smoothed.
// `half` = half the bank-to-bank width; `clearL/clearR` = open water either side of the centreline *without*
// crossing a quay (so boats squeeze into the navigation arch under bridges). Lanes keep to starboard (keep
// to the right of the fairway), offset = a share of the width, narrowed through the arches.
import { toWorld } from '../geo-frame.js';

const WAYPOINTS = [
  [50.82390, 4.31470], [50.82983, 4.31293], [50.83127, 4.31428], [50.83271, 4.31598], [50.83415, 4.31761],
  [50.83792, 4.31804], [50.83954, 4.31932], [50.84152, 4.32102], [50.84295, 4.32287], [50.84421, 4.32450],
  [50.84547, 4.32663], [50.84673, 4.32876], [50.84781, 4.33067], [50.84889, 4.33266], [50.84979, 4.33529],
  [50.85069, 4.33813], [50.85194, 4.33990]
];

// Canal quays (approximate berths) — boats moor here for a while
const PIERS = [
  ['Quai de Biestebroeck', 50.83347, 4.31683], ['Quai des Péniches', 50.84066, 4.32031], ['Quai Fernand Demets', 50.82403, 4.31321],
  ['Quai de Mariemont', 50.84875, 4.33238], ['Quai de Willebroeck', 50.85887, 4.32130]
];

const STEP = 12;

export function buildRiverPath(world, opts = {}) {
  const isWater = world && world.isWater ? (x, z) => world.isWater(x, z) : () => false;
  // 1. densify the waypoints
  const raw = [];
  const wp = WAYPOINTS.map(([la, lo]) => toWorld(la, lo));
  for (let i = 0; i + 1 < wp.length; i++) {
    const a = wp[i], b = wp[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.round(L / STEP));
    for (let k = 0; k < n; k++) raw.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  raw.push({ ...wp[wp.length - 1] });

  // 2. centre each sample in the cross-section (twice: the tangent improves once the line is centred)
  let pts = raw;
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q0 = pts[Math.max(0, i - 3)], q1 = pts[Math.min(pts.length - 1, i + 3)];
      let tx = q1.x - q0.x, tz = q1.z - q0.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = tz, nz = -tx; // left of travel (south → north)
      const sec = section(isWater, p.x, p.z, nx, nz);
      if (sec) out.push({ x: p.x + nx * sec.mid, z: p.z + nz * sec.mid, ok: true });
      else out.push({ x: p.x, z: p.z, ok: false });
    }
    // smooth (moving average, 7 samples) a few times
    pts = out;
    for (let it = 0; it < 4; it++) pts = pts.map((p, i) => {
      let x = 0, z = 0, n = 0;
      for (let k = -3; k <= 3; k++) { const q = pts[Math.min(pts.length - 1, Math.max(0, i + k))]; x += q.x; z += q.z; n++; }
      return { x: x / n, z: z / n, ok: p.ok };
    });
  }
  // keep only the stretch on water (clip the dry ends outside the play area)
  let i0 = 0, i1 = pts.length - 1;
  while (i0 < i1 && !isWater(pts[i0].x, pts[i0].z)) i0++;
  while (i1 > i0 && !isWater(pts[i1].x, pts[i1].z)) i1--;
  pts = pts.slice(i0, i1 + 1);
  if (pts.length < 4) pts = raw.slice(0, 4); // no water data (tests without a world): straight-ish line

  // 3. arrays: position, tangent, arc length, widths
  const n = pts.length;
  const X = new Float32Array(n), Z = new Float32Array(n), S = new Float32Array(n), DX = new Float32Array(n), DZ = new Float32Array(n);
  const HALF = new Float32Array(n), CL = new Float32Array(n), CR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    X[i] = pts[i].x; Z[i] = pts[i].z;
    if (i) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    let tx = X[b] - X[a], tz = Z[b] - Z[a];
    const tl = Math.hypot(tx, tz) || 1; DX[i] = tx / tl; DZ[i] = tz / tl;
    const nx = DZ[i], nz = -DX[i];
    const sec = section(isWater, X[i], Z[i], nx, nz);
    HALF[i] = sec ? sec.half : 40;
    // open water either side without crossing a quay / the bank
    CL[i] = clearRun(isWater, X[i], Z[i], nx, nz);
    CR[i] = clearRun(isWater, X[i], Z[i], -nx, -nz);
  }
  const length = S[n - 1];
  // 4. lanes (starboard: northbound right of the line = negative offset, southbound positive): a third of the width out,
  //    relaxed into the navigation arch under each bridge (smooth, then clamp to the open-water interval, repeated)
  const laneFor = (dir) => {
    const lo = new Float32Array(n), hi = new Float32Array(n), o = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const nx = DZ[i], nz = -DX[i];
      const want = dir * -Math.min(HALF[i] * 0.3, 55);
      const wet = (d) => isWater(X[i] + nx * d, Z[i] + nz * d);
      let c = want;
      if (!wet(c)) { // on a quay: nearest open water on our side
        let found = null;
        for (let k = 2; k <= 40 && found === null; k += 2) { if (wet(want + k)) found = want + k; else if (wet(want - k)) found = want - k; }
        c = found ?? want;
      }
      let a = c, b = c;
      while (a > c - 90 && wet(a - 2)) a -= 2;
      while (b < c + 90 && wet(b + 2)) b += 2;
      // keep to our half of the fairway, 6 m (half a beam + room) off piers and banks
      if (dir > 0) b = Math.min(b, -1); else a = Math.max(a, 1);
      a += 6; b -= 6;
      if (a > b) a = b = (a + b) / 2;
      lo[i] = a; hi[i] = b; o[i] = Math.max(a, Math.min(b, want));
    }
    const tmp = new Float32Array(n);
    for (let it = 0; it < 60; it++) {
      for (let i = 0; i < n; i++) { let s2 = 0, c2 = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) { s2 += o[j]; c2++; } } tmp[i] = s2 / c2; }
      for (let i = 0; i < n; i++) o[i] = Math.max(lo[i], Math.min(hi[i], tmp[i]));
    }
    return o;
  };
  const LANE_E = laneFor(1), LANE_W = laneFor(-1);

  function idx(s) {
    s = Math.max(0, Math.min(length, s));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const t = S[hi] > S[lo] ? (s - S[lo]) / (S[hi] - S[lo]) : 0;
    return [lo, hi, t];
  }
  const lerp = (A, lo, hi, t) => A[lo] + (A[hi] - A[lo]) * t;

  /** lane offset (m, + = left of the south→north direction) for travel direction dir (+1 north, -1 south) at arc length s */
  function laneOffset(s, dir) {
    const [lo, hi, t] = idx(s);
    return lerp(dir > 0 ? LANE_E : LANE_W, lo, hi, t);
  }

  /** world position on the fairway: s along, lat metres to the left of the south→north line */
  function at(s, lat, out = {}) {
    const [lo, hi, t] = idx(s);
    const dx = lerp(DX, lo, hi, t), dz = lerp(DZ, lo, hi, t), dl = Math.hypot(dx, dz) || 1;
    out.dx = dx / dl; out.dz = dz / dl;
    out.x = lerp(X, lo, hi, t) + out.dz * lat;
    out.z = lerp(Z, lo, hi, t) - out.dx * lat;
    out.half = lerp(HALF, lo, hi, t);
    out.clearL = lerp(CL, lo, hi, t); out.clearR = lerp(CR, lo, hi, t);
    return out;
  }

  function nearest(x, z) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < n; i += 2) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < best) { best = d; bi = i; } }
    let b2 = best, bj = bi;
    for (let i = Math.max(0, bi - 2); i <= Math.min(n - 1, bi + 2); i++) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < b2) { b2 = d; bj = i; } }
    const lat = (x - X[bj]) * DZ[bj] - (z - Z[bj]) * DX[bj];
    return { s: S[bj] + (x - X[bj]) * DX[bj] + (z - Z[bj]) * DZ[bj], lat, dist: Math.sqrt(b2) };
  }

  // quays: berth point on the quay's side, a little off the bank
  const piers = [];
  for (const [name, la, lo] of PIERS) {
    const p = toWorld(la, lo);
    const nr = nearest(p.x, p.z);
    if (nr.s < 30 || nr.s > length - 30 || nr.dist > 400) continue;
    const side = nr.lat >= 0 ? 1 : -1;
    const [i0b, i1b, tb] = idx(nr.s);
    const room = side > 0 ? lerp(CL, i0b, i1b, tb) : lerp(CR, i0b, i1b, tb);
    const lat = side * Math.max(8, Math.min(room - 8, Math.abs(nr.lat)));
    const q = at(nr.s, lat);
    piers.push({ name, s: nr.s, side, lat, x: q.x, z: q.z });
  }

  return { length, n, X, Z, S, DX, DZ, HALF, clearL: CL, clearR: CR, at, laneOffset, nearest, piers };
}

/** cross-section of the canal through (x, z) along the normal (nx, nz): runs of water, gaps ≤ 30 m (bridge piers,
 *  moored boats) bridged; the run containing / nearest the point → {mid (offset of its middle), half} */
function section(isWater, x, z, nx, nz) {
  const R = 420, st = 3;
  let runs = [], cur = null, gap = 0;
  for (let o = -R; o <= R; o += st) {
    const w = isWater(x + nx * o, z + nz * o);
    if (w) {
      if (cur && gap > 0 && gap <= 30) { cur.b = o; gap = 0; }
      else if (!cur || gap > 30) { if (cur) runs.push(cur); cur = { a: o, b: o }; gap = 0; }
      else cur.b = o;
    } else if (cur) gap += st;
  }
  if (cur) runs.push(cur);
  runs = runs.filter((r) => r.b - r.a > 40);
  if (!runs.length) return null;
  let best = null, bd = Infinity;
  for (const r of runs) {
    const d = r.a <= 0 && r.b >= 0 ? -1 : Math.min(Math.abs(r.a), Math.abs(r.b));
    const score = d - (r.b - r.a) * 0.05;
    if (score < bd) { bd = score; best = r; }
  }
  return { mid: (best.a + best.b) / 2, half: (best.b - best.a) / 2 };
}

/** metres of open water from (x, z) along (nx, nz) before the first dry cell (≤ 200) */
function clearRun(isWater, x, z, nx, nz) {
  if (!isWater(x, z)) return 0;
  for (let o = 2; o <= 200; o += 2) if (!isWater(x + nx * o, z + nz * o)) return o - 2;
  return 200;
}
