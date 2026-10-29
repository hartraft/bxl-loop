// tools/geo-brussels-base-util.mjs — dependency-free geometry helpers for the Brussels geodata build.
// World frame = js/geo-frame.js (x east, z south, metres). Rings are arrays of [x, z]; flat arrays are [x0,z0,x1,z1,...].
import { toWorld, WORLD_BOUNDS } from '../js/geo-frame.js';

export const log = (...a) => console.log('[bxl-geo]', ...a);
export const q1 = (v) => Math.round(v * 10) / 10; // 0.1 m quantisation

/** deterministic hash of an integer id (+ salt) -> [0, 1) */
export function hash01(id, salt = 0) {
  let h = (Number(id) % 2147483647) ^ (salt * 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const ll = (p) => { const w = toWorld(p.lat, p.lon); return [w.x, w.z]; };

/** OSM way geometry -> list of world polylines (split where nodes are missing = null) */
export function wayParts(way) {
  const out = [];
  let cur = [];
  for (const p of way.geometry || []) {
    if (!p) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    cur.push(ll(p));
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** signed shoelace area over (x, z). NEGATIVE = counter-clockwise seen from above (+y), see SPEC */
export function shoelace(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
export const ringArea = (r) => Math.abs(shoelace(r));
/** make ring CCW from above (negative shoelace in x,z) */
export function ccw(r) { return shoelace(r) > 0 ? r.slice().reverse() : r; }
export function cw(r) { return shoelace(r) < 0 ? r.slice().reverse() : r; }

export function centroid(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of r) { sx += p[0]; sz += p[1]; }
    return [sx / r.length, sz / r.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function bboxOf(pts) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
  }
  return { x0, z0, x1, z1 };
}

export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

function segDist2(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = a[0] + t * dx - p[0], ez = a[1] + t * dz - p[1];
  return ex * ex + ez * ez;
}

/** Ramer-Douglas-Peucker; `keep(i)` → vertex must survive (e.g. shared junction nodes) */
export function rdp(pts, eps, keep = null) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const mark = new Uint8Array(n);
  mark[0] = mark[n - 1] = 1;
  if (keep) for (let i = 1; i < n - 1; i++) if (keep(i)) mark[i] = 1;
  const e2 = eps * eps;
  const stack = [];
  // run between consecutive kept vertices
  let prev = 0;
  for (let i = 1; i < n; i++) if (mark[i]) { stack.push([prev, i]); prev = i; }
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    let best = -1, bd = e2;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i], pts[a], pts[b]);
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { mark[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (mark[i]) out.push(pts[i]);
  return out;
}

/** RDP on a closed ring (not closed in the array) */
export function rdpRing(r, eps) {
  if (r.length < 5) return r.slice();
  // split at vertex 0 and the vertex farthest from it
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) {
    const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = rdp(r.slice(0, far + 1), eps);
  const b = rdp(r.slice(far).concat([r[0]]), eps);
  const out = a.concat(b.slice(1, -1));
  return out.length >= 3 ? out : r.slice();
}

/** quantise a ring/polyline to 0.1 m and drop consecutive duplicates (and the closing point for rings) */
export function quantise(pts, ring = false) {
  const out = [];
  for (const p of pts) {
    const x = q1(p[0]), z = q1(p[1]);
    const l = out[out.length - 1];
    if (l && l[0] === x && l[1] === z) continue;
    out.push([x, z]);
  }
  if (ring) while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

// ---- clipping ---------------------------------------------------------------------------------------------------
export function expandBounds(b, m) { return { minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m }; }
export const inBounds = (x, z, b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

/** clip a polyline to a rectangle -> list of polylines (Liang-Barsky per segment) */
export function clipPolyline(pts, b) {
  const out = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], c = pts[i];
    const seg = clipSeg(a[0], a[1], c[0], c[1], b);
    if (!seg) { if (cur) { out.push(cur); cur = null; } continue; }
    const [x0, z0, x1, z1, t0, t1] = seg;
    if (!cur) cur = [t0 === 0 ? a : [x0, z0]];
    else if (t0 > 0) { out.push(cur); cur = [[x0, z0]]; }
    cur.push(t1 === 1 ? c : [x1, z1]);
    if (t1 < 1) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((p) => p.length > 1);
}
function clipSeg(x0, z0, x1, z1, b) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const P = [-dx, dx, -dz, dz];
  const Q = [x0 - b.minX, b.maxX - x0, z0 - b.minZ, b.maxZ - z0];
  for (let k = 0; k < 4; k++) {
    if (P[k] === 0) { if (Q[k] < 0) return null; continue; }
    const r = Q[k] / P[k];
    if (P[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x0 + t0 * dx, z0 + t0 * dz, x0 + t1 * dx, z0 + t1 * dz, t0, t1];
}

/** Sutherland-Hodgman clip of a closed ring to a rectangle (may leave zero-width bridges on concave input) */
export function clipRing(r, b) {
  const bb = bboxOf(r);
  if (bb.x0 >= b.minX && bb.x1 <= b.maxX && bb.z0 >= b.minZ && bb.z1 <= b.maxZ) return r;
  if (bb.x1 < b.minX || bb.x0 > b.maxX || bb.z1 < b.minZ || bb.z0 > b.maxZ) return null;
  let poly = r;
  const edges = [
    [(p) => p[0] >= b.minX, (p, q) => inter(p, q, 0, b.minX)],
    [(p) => p[0] <= b.maxX, (p, q) => inter(p, q, 0, b.maxX)],
    [(p) => p[1] >= b.minZ, (p, q) => inter(p, q, 1, b.minZ)],
    [(p) => p[1] <= b.maxZ, (p, q) => inter(p, q, 1, b.maxZ)]
  ];
  for (const [ins, ix] of edges) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const pi = ins(p), qi = ins(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(ix(p, q));
    }
    poly = out;
    if (poly.length < 3) return null;
  }
  return poly;
}
function inter(p, q, axis, v) {
  const t = (v - p[axis]) / (q[axis] - p[axis]);
  return axis === 0 ? [v, p[1] + t * (q[1] - p[1])] : [p[0] + t * (q[0] - p[0]), v];
}

// ---- ring assembly (multipolygon members split into many ways) ------------------------------------------------
/**
 * Join polylines by identical endpoints into rings. Open chains whose both ends lie outside `outside` (a rectangle,
 * the clip box) are closed with a straight segment (OSM data cut at the extract edge); others are closed if the gap
 * is < closeTol, else returned in `open`.
 */
export function assembleRings(segs, outside = null, closeTol = 3) {
  const key = (p) => p[0].toFixed(3) + ',' + p[1].toFixed(3);
  const ends = new Map();
  const used = new Uint8Array(segs.length);
  segs.forEach((s, i) => {
    for (const k of [key(s[0]), key(s[s.length - 1])]) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const rings = [], open = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = segs[i].slice();
    // extend tail, then head
    for (let pass = 0; pass < 2; pass++) {
      for (;;) {
        const tk = key(chain[chain.length - 1]);
        if (tk === key(chain[0]) && chain.length > 2) break;
        const cand = (ends.get(tk) || []).find((j) => !used[j]);
        if (cand === undefined) break;
        used[cand] = 1;
        let s = segs[cand];
        if (key(s[0]) !== tk) s = s.slice().reverse();
        chain = chain.concat(s.slice(1));
      }
      chain.reverse();
    }
    const a = chain[0], z = chain[chain.length - 1];
    const closed = key(a) === key(z);
    if (closed) { chain.pop(); if (chain.length >= 3) rings.push(chain); continue; }
    const gap = Math.hypot(a[0] - z[0], a[1] - z[1]);
    if (gap < closeTol || (outside && !inBounds(a[0], a[1], outside) && !inBounds(z[0], z[1], outside) && !segHitsBox(a, z, outside))) {
      if (chain.length >= 3) rings.push(chain);
    } else open.push(chain);
  }
  return { rings, open };
}
function segHitsBox(a, b, box) { return !!clipSeg(a[0], a[1], b[0], b[1], box); }

// ---- offsets & hulls ----------------------------------------------------------------------------------------------
/** outward miter offset of a ring by d metres (fine for small d on footprints) */
export function bufferRing(r, d) {
  const off = (sgn) => {
    const n = r.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = r[(i + n - 1) % n], c = r[i], nx = r[(i + 1) % n];
      const e1 = norm(c[0] - p[0], c[1] - p[1]), e2 = norm(nx[0] - c[0], nx[1] - c[1]);
      let mx = -e1[1] - e2[1], mz = e1[0] + e2[0];
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) { mx = -e1[1]; mz = e1[0]; } else { mx /= ml; mz /= ml; }
      const cos = Math.max(0.35, mx * -e1[1] + mz * e1[0]);
      out.push([c[0] + sgn * mx * d / cos, c[1] + sgn * mz * d / cos]);
    }
    return out;
  };
  const a = off(1);
  return ringArea(a) >= ringArea(r) ? a : off(-1);
}
const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

export function convexHull(points) {
  const p = points.map((a) => [a[0], a[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const a of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], a) <= 0) lo.pop(); lo.push(a); }
  for (let i = p.length - 1; i >= 0; i--) { const a = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], a) <= 0) up.pop(); up.push(a); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

export function circleRing(cx, cz, r, n = 24) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
}

// ---- raster ----------------------------------------------------------------------------------------------------
/** even-odd scanline fill of polygons (each = [outer, ...holes]) into a Uint8 grid; value v */
export class Grid {
  constructor(b, cell) {
    this.b = b; this.cell = cell;
    this.w = Math.ceil((b.maxX - b.minX) / cell);
    this.h = Math.ceil((b.maxZ - b.minZ) / cell);
    this.d = new Uint8Array(this.w * this.h);
  }
  fill(rings, v = 1) {
    const { b, cell, w, h, d } = this;
    let zmin = Infinity, zmax = -Infinity;
    for (const r of rings) for (const p of r) { if (p[1] < zmin) zmin = p[1]; if (p[1] > zmax) zmax = p[1]; }
    const r0 = Math.max(0, Math.floor((zmin - b.minZ) / cell)), r1 = Math.min(h - 1, Math.ceil((zmax - b.minZ) / cell));
    if (r1 < r0) return;
    const rows = Array.from({ length: r1 - r0 + 1 }, () => []);
    for (const r of rings) {
      for (let i = 0, n = r.length; i < n; i++) {
        const p = r[i], q = r[(i + 1) % n];
        if (p[1] === q[1]) continue;
        const za = Math.min(p[1], q[1]), zb = Math.max(p[1], q[1]);
        const ra = Math.max(r0, Math.ceil((za - b.minZ) / cell - 0.5)), rb = Math.min(r1, Math.floor((zb - b.minZ) / cell - 0.5));
        for (let row = ra; row <= rb; row++) {
          const zc = b.minZ + (row + 0.5) * cell;
          if (zc < za || zc >= zb) continue;
          rows[row - r0].push(p[0] + ((zc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
        }
      }
    }
    for (let k = 0; k < rows.length; k++) {
      const xs = rows[k].sort((a, c) => a - c);
      const row = r0 + k;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(0, Math.ceil((xs[i] - b.minX) / cell - 0.5)), c1 = Math.min(w - 1, Math.floor((xs[i + 1] - b.minX) / cell - 0.5));
        for (let c = c0; c <= c1; c++) d[row * w + c] = v;
      }
    }
  }
  at(x, z) {
    const c = Math.floor((x - this.b.minX) / this.cell), r = Math.floor((z - this.b.minZ) / this.cell);
    if (c < 0 || r < 0 || c >= this.w || r >= this.h) return 0;
    return this.d[r * this.w + c];
  }
}

export { WORLD_BOUNDS, toWorld };
