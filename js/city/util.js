// js/city/util.js — geometry helpers shared by the Brussels city renderer (js/brussels-city.js, js/city/*.js).
// Plain JS + three core only (no TSL): everything here also runs in Node for the full-city build check.
import * as THREE from 'three/webgpu';

export const TILE = 500; // m: static layers are cut into TILE x TILE tiles (scene-culling / frustum culling)

/** mulberry32 seeded PRNG */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** integer hash -> [0, 1) */
export function hash01(i) {
  let h = (i | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** position hash -> [0, 1) */
export function hashXZ(x, z, s = 0) {
  return hash01((Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663) ^ (s * 83492791));
}

/** signed shoelace area over (x, z) of a flat ring [x0,z0,x1,z1,…] (CCW from above = negative) */
export function ringArea(p, start = 0, end = p.length) {
  let a = 0;
  for (let i = start, j = end - 2; i < end; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1];
  return a / 2;
}
export function ringBox(p, start = 0, end = p.length) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = start; i < end; i += 2) {
    const x = p[i], z = p[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
}
export function pointInRing(x, z, p) {
  let ins = false;
  for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}

/** convex hull (monotone chain) of flat points -> flat array */
export function convexHull(p) {
  const n = p.length / 2;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => p[a * 2] - p[b * 2] || p[a * 2 + 1] - p[b * 2 + 1]);
  const cross = (o, a, b) => (p[a * 2] - p[o * 2]) * (p[b * 2 + 1] - p[o * 2 + 1]) - (p[a * 2 + 1] - p[o * 2 + 1]) * (p[b * 2] - p[o * 2]);
  const lo = [], hi = [];
  for (const i of idx) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
  for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
  lo.pop(); hi.pop();
  const h = lo.concat(hi), out = new Float64Array(h.length * 2);
  h.forEach((i, k) => { out[k * 2] = p[i * 2]; out[k * 2 + 1] = p[i * 2 + 1]; });
  return out;
}

/**
 * minimum-area enclosing rectangle (rotating calipers over the hull edges) of flat points.
 * -> { cx, cz, hx, hz, cs, sn, area } with the local x axis = (cs, sn); hx >= hz is NOT enforced
 */
export function minAreaRect(p) {
  const h = p.length >= 6 ? convexHull(p) : p;
  const n = h.length / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let dx = h[j * 2] - h[i * 2], dz = h[j * 2 + 1] - h[i * 2 + 1];
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    dx /= L; dz /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = h[k * 2], z = h[k * 2 + 1];
      const a = x * dx + z * dz, b = -x * dz + z * dx;
      if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      best = { cx: ca * dx - cb * dz, cz: ca * dz + cb * dx, hx: (a1 - a0) / 2, hz: (b1 - b0) / 2, cs: dx, sn: dz, area };
    }
  }
  if (!best) {
    const [x0, z0, x1, z1] = ringBox(p);
    best = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: Math.max(0.1, (x1 - x0) / 2), hz: Math.max(0.1, (z1 - z0) / 2), cs: 1, sn: 0, area: (x1 - x0) * (z1 - z0) };
  }
  return best;
}

/** SPEC collider from an OBB */
export function obbCollider(o, maxY, minY = 0) {
  const ex = Math.abs(o.hx * o.cs) + Math.abs(o.hz * o.sn), ez = Math.abs(o.hx * o.sn) + Math.abs(o.hz * o.cs);
  // City OBBs (minAreaRect) have their local x axis along (cs, sn). The SPEC / controllers.js / landmarks / traffic
  // convention is three.js rotation.y = θ: local x = (cos θ, −sin θ), local z = (sin θ, cos θ), stored as cs = cos θ,
  // sn = sin θ. So flip sn here. (Without this every rotated building's collision box was mirrored and stuck out
  // across the street.)
  const c = { minX: o.cx - ex, maxX: o.cx + ex, minZ: o.cz - ez, maxZ: o.cz + ez, maxY, obb: { cx: o.cx, cz: o.cz, hx: o.hx, hz: o.hz, cs: o.cs, sn: -o.sn } };
  if (minY > 0) c.minY = minY;
  return c;
}

/** Sutherland–Hodgman: clip flat ring by the half-plane a*x + b*z + c >= 0 */
export function clipHalfPlane(p, a, b, c) {
  const out = [];
  const n = p.length;
  if (!n) return out;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const x0 = p[i], z0 = p[i + 1], x1 = p[j], z1 = p[j + 1];
    const d0 = a * x0 + b * z0 + c, d1 = a * x1 + b * z1 + c;
    if (d0 >= 0) out.push(x0, z0);
    if ((d0 >= 0) !== (d1 >= 0)) {
      const t = d0 / (d0 - d1);
      out.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
    }
  }
  return out;
}
/** clip a flat ring to the axis box */
export function clipRect(p, x0, z0, x1, z1) {
  let r = clipHalfPlane(p, 1, 0, -x0);
  r = clipHalfPlane(r, -1, 0, x1);
  r = clipHalfPlane(r, 0, 1, -z0);
  return clipHalfPlane(r, 0, -1, z1);
}

const _v2pool = [];
const v2 = (i, x, y) => { let v = _v2pool[i]; if (!v) v = _v2pool[i] = new THREE.Vector2(); return v.set(x, y); };
/**
 * triangulate a flat (x, z) ring (+ holes) with three's earcut -> array of vertex index triples into the concatenated
 * point list (outer then holes). Winding of the result follows ShapeUtils (CCW in the (x, z) plane = clockwise from above).
 */
export function triangulate(outer, holes = []) {
  const contour = [];
  let k = 0;
  for (let i = 0; i < outer.length; i += 2) contour.push(v2(k++, outer[i], outer[i + 1]));
  const hs = holes.map((h) => { const a = []; for (let i = 0; i < h.length; i += 2) a.push(v2(k++, h[i], h[i + 1])); return a; });
  // ShapeUtils copies the coordinates into a flat array: the pooled vectors are free again afterwards
  return THREE.ShapeUtils.triangulateShape(contour, hs);
}

/**
 * Growable geometry builder: position (+normal) and arbitrary named float/uint8 attributes, uint32 index.
 * attrs: { name: [itemSize, 'f32' | 'u8n'] }
 */
export class GeoBuilder {
  constructor(attrs = {}, withNormal = true) {
    this.withNormal = withNormal;
    this.n = 0;
    this.cap = 256;
    this.pos = new Float32Array(this.cap * 3);
    this.nrm = withNormal ? new Float32Array(this.cap * 3) : null;
    this.attrs = Object.entries(attrs).map(([name, [size, type]]) => ({ name, size, type, arr: type === 'u8n' ? new Uint8Array(this.cap * size) : new Float32Array(this.cap * size) }));
    this.ai = Object.fromEntries(this.attrs.map((a, i) => [a.name, i]));
    this.idx = new Uint32Array(1024);
    this.ni = 0;
    this.cur = this.attrs.map((a) => new Array(a.size).fill(0)); // current values stamped on every new vertex
  }
  set(name, a = 0, b = 0, c = 0, d = 0) {
    const cur = this.cur[this.ai[name]];
    cur[0] = a; if (cur.length > 1) { cur[1] = b; if (cur.length > 2) { cur[2] = c; if (cur.length > 3) cur[3] = d; } }
    return this;
  }
  _grow(n) {
    if (this.n + n <= this.cap) return;
    let cap = this.cap;
    while (this.n + n > cap) cap *= 2;
    const g = (a, s) => { const b = new a.constructor(cap * s); b.set(a); return b; };
    this.pos = g(this.pos, 3);
    if (this.nrm) this.nrm = g(this.nrm, 3);
    for (const a of this.attrs) a.arr = g(a.arr, a.size);
    this.cap = cap;
  }
  /** add vertex; returns its index */
  v(x, y, z, nx = 0, ny = 1, nz = 0) {
    this._grow(1);
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    if (this.nrm) { this.nrm[i * 3] = nx; this.nrm[i * 3 + 1] = ny; this.nrm[i * 3 + 2] = nz; }
    for (let k = 0; k < this.attrs.length; k++) {
      const a = this.attrs[k], c = this.cur[k], o = i * a.size;
      for (let j = 0; j < a.size; j++) a.arr[o + j] = c[j];
    }
    return i;
  }
  /** override one attribute of an existing vertex */
  attr(i, name, x = 0, y = 0, z = 0, w = 0) {
    const a = this.attrs[this.ai[name]], o = i * a.size, r = a.arr;
    r[o] = x; if (a.size > 1) { r[o + 1] = y; if (a.size > 2) { r[o + 2] = z; if (a.size > 3) r[o + 3] = w; } }
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.idx.length) { const b2 = new Uint32Array(this.idx.length * 2); b2.set(this.idx); this.idx = b2; }
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get triangles() { return this.ni / 3; }
  /** -> THREE.BufferGeometry (or null when empty) */
  build() {
    if (!this.ni) return null;
    const g = new THREE.BufferGeometry();
    // views on the builder's arrays when they're mostly full (no copy, no garbage), else a tight copy
    const cut = (arr, len) => (len * 1.5 >= arr.length ? arr.subarray(0, len) : arr.slice(0, len));
    g.setAttribute('position', new THREE.BufferAttribute(cut(this.pos, this.n * 3), 3));
    if (this.nrm) g.setAttribute('normal', new THREE.BufferAttribute(cut(this.nrm, this.n * 3), 3));
    for (const a of this.attrs) g.setAttribute(a.name, new THREE.BufferAttribute(cut(a.arr, this.n * a.size), a.size, a.type === 'u8n'));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? cut(this.idx, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni)), 1));
    this.pos = this.nrm = this.idx = null; // the builder is spent
    for (const a of this.attrs) a.arr = null;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** tile bucket map: key -> builder, created on demand by `make()` */
export class TileBuckets {
  constructor(make) { this.make = make; this.map = new Map(); }
  key(x, z) { return Math.floor(x / TILE) + ',' + Math.floor(z / TILE); }
  get(x, z, sub = '') {
    const k = this.key(x, z) + sub;
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = this.make(sub)));
    return b;
  }
}

/**
 * offset polyline (flat [x,z,…]) to the left (+d) / right (−d) of its direction with miter joins (clamped).
 * Left of direction (dx, dz) is (dz, −dx)·… in this frame (x east, z south, seen from above): we use n = (−dz, dx)
 * which points to the LEFT when looking along the road from above with north up. Returns Float64Array.
 */
export function offsetPolyline(p, d, closed = false, miterMax = 2.5) {
  const n = p.length / 2, out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const ip = closed ? (i - 1 + n) % n : Math.max(0, i - 1), inx = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    let n1x = 0, n1z = 0, n2x = 0, n2z = 0;
    if (ip !== i) { const dx = p[i * 2] - p[ip * 2], dz = p[i * 2 + 1] - p[ip * 2 + 1], L = Math.hypot(dx, dz) || 1; n1x = dz / L; n1z = -dx / L; }
    if (inx !== i) { const dx = p[inx * 2] - p[i * 2], dz = p[inx * 2 + 1] - p[i * 2 + 1], L = Math.hypot(dx, dz) || 1; n2x = dz / L; n2z = -dx / L; }
    if (ip === i) { n1x = n2x; n1z = n2z; }
    if (inx === i) { n2x = n1x; n2z = n1z; }
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = n2x; mz = n2z; } else { mx /= ml; mz /= ml; }
    let s = 1 / Math.max(1 / miterMax, mx * n2x + mz * n2z);
    out[i * 2] = p[i * 2] + mx * d * s;
    out[i * 2 + 1] = p[i * 2 + 1] + mz * d * s;
  }
  return out;
}

/** cumulative arc length of a flat polyline */
export function arcLengths(p) {
  const n = p.length / 2, s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
  return s;
}

/** CSR spatial hash over items with bboxes (like brussels-world.js) */
export function makeHash(minX, minZ, maxX, maxZ, cell, n, bboxOf) {
  const W = Math.ceil((maxX - minX) / cell) + 1, H = Math.ceil((maxZ - minZ) / cell) + 1;
  const counts = new Uint32Array(W * H + 1);
  const r = [0, 0, 0, 0];
  const range = (i) => {
    bboxOf(i, r);
    r[0] = Math.max(0, Math.floor((r[0] - minX) / cell)); r[2] = Math.min(W - 1, Math.floor((r[2] - minX) / cell));
    r[1] = Math.max(0, Math.floor((r[1] - minZ) / cell)); r[3] = Math.min(H - 1, Math.floor((r[3] - minZ) / cell));
  };
  for (let i = 0; i < n; i++) { range(i); for (let cz = r[1]; cz <= r[3]; cz++) for (let cx = r[0]; cx <= r[2]; cx++) counts[cz * W + cx + 1]++; }
  for (let i = 1; i <= W * H; i++) counts[i] += counts[i - 1];
  const items = new Uint32Array(counts[W * H]);
  const fill = counts.slice(0, W * H);
  for (let i = 0; i < n; i++) { range(i); for (let cz = r[1]; cz <= r[3]; cz++) for (let cx = r[0]; cx <= r[2]; cx++) items[fill[cz * W + cx]++] = i; }
  return {
    W, H, cell, start: counts, items,
    cellOf(x, z) {
      const cx = Math.floor((x - minX) / cell), cz = Math.floor((z - minZ) / cell);
      return cx < 0 || cz < 0 || cx >= W || cz >= H ? -1 : cz * W + cx;
    },
    /** call fn(item) for every item in the cell of (x, z) (items may repeat across calls) */
    each(x, z, fn) {
      const c = this.cellOf(x, z);
      if (c < 0) return;
      for (let k = counts[c], e = counts[c + 1]; k < e; k++) fn(items[k]);
    }
  };
}

/** a region filter {cx, cz, r} -> (x, z, pad) => inside */
export function regionTest(region) {
  if (!region) return () => true;
  const { cx, cz, r } = region;
  return (x, z, pad = 0) => Math.abs(x - cx) <= r + pad && Math.abs(z - cz) <= r + pad;
}

/** open-addressing hash of directed edges (decimetre-rounded endpoints) -> int value; allocation-free */
export class EdgeHash {
  constructor(capacity) {
    let size = 1024;
    while (size < capacity * 2) size *= 2;
    this.mask = size - 1;
    this.keys = new Int32Array(size * 4);
    this.vals = new Int32Array(size).fill(-1);
  }
  _slot(a, b, c, d, insert) {
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d) ^ Math.imul(d, 0x27d4eb2f);
    h = (h ^ (h >>> 15)) & this.mask;
    const K = this.keys, V = this.vals;
    for (;;) {
      if (V[h] === -1) return insert ? h : -1;
      const o = h * 4;
      if (K[o] === a && K[o + 1] === b && K[o + 2] === c && K[o + 3] === d) return h;
      h = (h + 1) & this.mask;
    }
  }
  set(x0, z0, x1, z1, v) {
    const a = Math.round(x0 * 10), b = Math.round(z0 * 10), c = Math.round(x1 * 10), d = Math.round(z1 * 10);
    const h = this._slot(a, b, c, d, true), o = h * 4;
    this.keys[o] = a; this.keys[o + 1] = b; this.keys[o + 2] = c; this.keys[o + 3] = d; this.vals[h] = v;
  }
  get(x0, z0, x1, z1) {
    const h = this._slot(Math.round(x0 * 10), Math.round(z0 * 10), Math.round(x1 * 10), Math.round(z1 * 10), false);
    return h < 0 ? -1 : this.vals[h];
  }
}
