// tools/geo-brussels-base-roadtopo.mjs — road topology helpers shared by the bake (tools/build-brussels-base-geodata.mjs, clean-up
// pass) and the checker (tools/geo-brussels-base-roadcheck.mjs): building footprint index, junction/vertex hashing, dead-end
// classification. Roads here are {pts: flat [x0,z0,x1,z1,…], kind, sub, tunnel, …}; buildings are the struct-of-arrays
// form of GEO.buildings ({count, ringStart, xz, minHeight}).

export const CAR_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
export const PATH_KINDS = new Set(['footway', 'cycleway', 'steps']);
/** ground-level building: anything whose underside is below this is a wall at street level (canopies are higher) */
export const GROUND_MINH = 2.5;
export const nodeKey = (x, z) => (Math.round(x * 10) + 80000) * 200000 + (Math.round(z * 10) + 80000);

/** is this road drawn by js/city/roads.js as asphalt (carriageway) / stone (pedestrian) / path? */
export const drawnCar = (r) => !r.tunnel && CAR_KINDS.has(r.kind);
export const drawnPed = (r) => !r.tunnel && r.kind === 'pedestrian';
export const drawnPath = (r) => !r.tunnel && PATH_KINDS.has(r.kind) && r.sub !== 'sidewalk' && r.sub !== 'crossing';

export class BuildingIndex {
  /** @param b {count, ringStart, xz, minHeight, landmark?}; only non-landmark footprints with minHeight < maxMinH are indexed */
  constructor(b, maxMinH = GROUND_MINH, cell = 32) {
    this.b = b; this.cell = cell;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const box = new Float32Array(b.count * 4);
    for (let i = 0; i < b.count; i++) {
      let a = Infinity, c = Infinity, d = -Infinity, e = -Infinity;
      for (let p = b.ringStart[i]; p < b.ringStart[i + 1]; p++) {
        const x = b.xz[p * 2], z = b.xz[p * 2 + 1];
        if (x < a) a = x; if (x > d) d = x; if (z < c) c = z; if (z > e) e = z;
      }
      box[i * 4] = a; box[i * 4 + 1] = c; box[i * 4 + 2] = d; box[i * 4 + 3] = e;
      if (a < x0) x0 = a; if (c < z0) z0 = c; if (d > x1) x1 = d; if (e > z1) z1 = e;
    }
    this.box = box;
    this.minX = x0 - cell; this.minZ = z0 - cell;
    this.W = Math.ceil((x1 - x0) / cell) + 3; this.H = Math.ceil((z1 - z0) / cell) + 3;
    const cells = new Map();
    for (let i = 0; i < b.count; i++) {
      if (b.minHeight[i] >= maxMinH || (b.landmark && b.landmark[i])) continue; // landmarks: drawn by their own modules
      const ca = Math.floor((box[i * 4] - this.minX) / cell), cb = Math.floor((box[i * 4 + 2] - this.minX) / cell);
      const ra = Math.floor((box[i * 4 + 1] - this.minZ) / cell), rb = Math.floor((box[i * 4 + 3] - this.minZ) / cell);
      for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) {
        const k = r * this.W + c;
        let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(i);
      }
    }
    this.cells = cells;
  }
  _cell(x, z) { return Math.floor((z - this.minZ) / this.cell) * this.W + Math.floor((x - this.minX) / this.cell); }
  /** index of a ground-level building containing (x, z), or -1 */
  inside(x, z) {
    const l = this.cells.get(this._cell(x, z));
    if (!l) return -1;
    const { box } = this, { ringStart, xz } = this.b;
    for (const i of l) {
      if (x < box[i * 4] || x > box[i * 4 + 2] || z < box[i * 4 + 1] || z > box[i * 4 + 3]) continue;
      let ins = false;
      for (let p = ringStart[i], e = ringStart[i + 1], q = e - 1; p < e; q = p++) {
        const xi = xz[p * 2], zi = xz[p * 2 + 1], xj = xz[q * 2], zj = xz[q * 2 + 1];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
      }
      if (ins) return i;
    }
    return -1;
  }
  /** distance to the nearest ground-level building wall within maxD (Infinity if none); 0 when inside */
  wallDist(x, z, maxD = 5) {
    if (this.inside(x, z) >= 0) return 0;
    let best = Infinity;
    const { box } = this, { ringStart, xz } = this.b;
    const seen = new Set();
    const c0 = Math.floor((x - maxD - this.minX) / this.cell), c1 = Math.floor((x + maxD - this.minX) / this.cell);
    const r0 = Math.floor((z - maxD - this.minZ) / this.cell), r1 = Math.floor((z + maxD - this.minZ) / this.cell);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const l = this.cells.get(r * this.W + c);
      if (!l) continue;
      for (const i of l) {
        if (seen.has(i)) continue; seen.add(i);
        if (x < box[i * 4] - maxD || x > box[i * 4 + 2] + maxD || z < box[i * 4 + 1] - maxD || z > box[i * 4 + 3] + maxD) continue;
        for (let p = ringStart[i], e = ringStart[i + 1], q = e - 1; p < e; q = p++) {
          const ax = xz[q * 2], az = xz[q * 2 + 1], dx = xz[p * 2] - ax, dz = xz[p * 2 + 1] - az, L2 = dx * dx + dz * dz;
          const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
          const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
          if (d < best) best = d;
        }
      }
    }
    return best <= maxD ? best : Infinity;
  }
  /** buildings whose bbox (grown by pad) touches the box x0..x1, z0..z1 */
  near(x0, z0, x1, z1, pad = 0) {
    const out = new Set(), { box } = this;
    const c0 = Math.floor((x0 - pad - this.minX) / this.cell), c1 = Math.floor((x1 + pad - this.minX) / this.cell);
    const r0 = Math.floor((z0 - pad - this.minZ) / this.cell), r1 = Math.floor((z1 + pad - this.minZ) / this.cell);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const l = this.cells.get(r * this.W + c);
      if (!l) continue;
      for (const i of l) if (!(x1 < box[i * 4] - pad || x0 > box[i * 4 + 2] + pad || z1 < box[i * 4 + 1] - pad || z0 > box[i * 4 + 3] + pad)) out.add(i);
    }
    return out;
  }
  /** nearest wall hit along the ray (x, z) + t·(dx, dz), t ≤ maxD (unit d): {t (m), x, z, nx, nz, bi} or null */
  rayWall(x, z, dx, dz, maxD) {
    const bx = x + dx * maxD, bz = z + dz * maxD;
    let best = null;
    for (const i of this.near(Math.min(x, bx), Math.min(z, bz), Math.max(x, bx), Math.max(z, bz), 0.5)) {
      const h = this.segWall(i, x, z, bx, bz);
      if (h && (!best || h.t * maxD < best.t)) best = { ...h, t: h.t * maxD, bi: i };
    }
    return best;
  }
  /** first crossing of segment a→b with a wall of building i: {t, x, z, nx, nz} (n = outward wall normal) or null */
  segWall(i, ax, az, bx, bz) {
    const { ringStart, xz } = this.b;
    let best = null;
    for (let p = ringStart[i], e = ringStart[i + 1], q = e - 1; p < e; q = p++) {
      const cx = xz[q * 2], cz = xz[q * 2 + 1], ex = xz[p * 2] - cx, ez = xz[p * 2 + 1] - cz;
      const dx = bx - ax, dz = bz - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((cx - ax) * ez - (cz - az) * ex) / den, u = ((cx - ax) * dz - (cz - az) * dx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      if (!best || t < best.t) {
        const el = Math.hypot(ex, ez) || 1;
        // rings are CCW seen from above in (x, z) with negative shoelace → outward normal = (ez, -ex)/el … check by side
        let nx = ez / el, nz = -ex / el;
        const mx = cx + ex * u, mz = cz + ez * u;
        if (this.inside(mx + nx * 0.2, mz + nz * 0.2) === i) { nx = -nx; nz = -nz; }
        best = { t, x: mx, z: mz, nx, nz, wx: ex / el, wz: ez / el };
      }
    }
    return best;
  }
}

/** vertex hash over roads: key -> [roadIndex, vertexIndex, …] (interior vertices included) */
export function vertexMap(roads, filter) {
  const m = new Map();
  roads.forEach((r, ri) => {
    if (filter && !filter(r)) return;
    const p = r.pts;
    for (let i = 0; i < p.length; i += 2) {
      const k = nodeKey(p[i], p[i + 1]);
      let l = m.get(k); if (!l) m.set(k, (l = [])); l.push(ri, i >> 1);
    }
  });
  return m;
}

/** other roads (indices) sharing the vertex at (x, z) with road ri */
export function neighbours(vmap, ri, x, z) {
  const l = vmap.get(nodeKey(x, z));
  const out = [];
  if (!l) return out;
  for (let k = 0; k < l.length; k += 2) if (l[k] !== ri && !out.includes(l[k])) out.push(l[k]);
  return out;
}

/** simple uniform segment hash for "nearest other road centreline" queries */
export class SegIndex {
  constructor(roads, filter, cell = 24) {
    this.roads = roads; this.cell = cell; this.m = new Map();
    roads.forEach((r, ri) => {
      if (filter && !filter(r)) return;
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const pad = (r.w || 0) / 2 + 1;
        const c0 = Math.floor((Math.min(p[i], p[i + 2]) - pad) / cell), c1 = Math.floor((Math.max(p[i], p[i + 2]) + pad) / cell);
        const r0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - pad) / cell), r1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + pad) / cell);
        for (let a = r0; a <= r1; a++) for (let b = c0; b <= c1; b++) {
          const k = a * 100000 + b;
          let l = this.m.get(k); if (!l) this.m.set(k, (l = [])); l.push(ri, i);
        }
      }
    });
  }
  /** nearest segment within maxD of (x, z) whose road passes skip(ri) === false: {ri, i, d, t, x, z, edge} (edge = d − w/2) */
  nearest(x, z, maxD, skip) {
    let best = null;
    const c0 = Math.floor((x - maxD) / this.cell), c1 = Math.floor((x + maxD) / this.cell);
    const r0 = Math.floor((z - maxD) / this.cell), r1 = Math.floor((z + maxD) / this.cell);
    for (let a = r0; a <= r1; a++) for (let b = c0; b <= c1; b++) {
      const l = this.m.get(a * 100000 + b);
      if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const ri = l[k], i = l[k + 1];
        if (skip && skip(ri)) continue;
        const p = this.roads[ri].pts;
        const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L2 = dx * dx + dz * dz;
        const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
        const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(qx - x, qz - z);
        if (d <= maxD && (!best || d < best.d)) best = { ri, i, d, t, x: qx, z: qz, edge: d - (this.roads[ri].w || 0) / 2 };
      }
    }
    return best;
  }
}

/** length of polyline p (flat) inside ground-level buildings, sampled every `step` m → {inside, total, runs:[{a,b}] (arc-length)} */
export function insideRuns(p, bidx, step = 1.5) {
  let s = 0, inside = 0, runStart = -1;
  const runs = [];
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const ins = bidx.inside(ax + dx * t, az + dz * t) >= 0;
      const sm = s + L * t;
      if (ins) { inside += L / n; if (runStart < 0) runStart = sm - L / n / 2; }
      else if (runStart >= 0) { runs.push({ a: runStart, b: sm - L / n / 2 }); runStart = -1; }
    }
    s += L;
  }
  if (runStart >= 0) runs.push({ a: runStart, b: s });
  return { inside, total: s, runs };
}

/** polyline length (flat) */
export function flatLength(p) { let s = 0; for (let i = 0; i + 3 < p.length; i += 2) s += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return s; }

/** sub-polyline of flat p between arc lengths a..b (a < b) */
export function slicePolyline(p, a, b) {
  const out = [];
  let s = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = Math.hypot(dx, dz);
    const s1 = s + L;
    if (s1 >= a && s <= b && L > 0) {
      const t0 = Math.max(0, (a - s) / L), t1 = Math.min(1, (b - s) / L);
      if (!out.length) out.push(ax + dx * t0, az + dz * t0);
      out.push(ax + dx * t1, az + dz * t1);
    }
    s = s1;
  }
  return out;
}

/**
 * Classify every drawn carriageway end. Returns findings [{cat, ri, end (0|1), x, z, len, kind, sub, note}].
 * Categories:
 *   ok_junction       — shares its end vertex with another drawn carriageway (or pedestrian street)
 *   edge              — at the play-area clip edge
 *   tunnel_mouth      — joins only a tunnel (not drawn): the approach stops at nothing
 *   into_building     — dead end inside a ground-level building footprint
 *   at_wall           — dead end within 3 m of a ground-level building wall
 *   in_water          — dead end in water
 *   touch             — dead end whose tip lies on another carriageway (unjoined T: ribbons overlap, looks fine)
 *   gap               — dead end whose tip is 0.3–4 m from another carriageway's edge (visible gap)
 *   to_path           — dead end that continues only as a footway / cycleway / steps
 *   open              — any other dead end (cul-de-sac, yard, car park entrance)
 */
export function classifyEnds(roads, ctx) {
  const { bidx, bounds, isWater } = ctx;
  const vAll = vertexMap(roads);
  const isDrawnRoad = (r) => drawnCar(r) || drawnPed(r);
  const segCar = new SegIndex(roads, drawnCar);
  const out = [];
  roads.forEach((r, ri) => {
    if (!drawnCar(r)) return;
    const p = r.pts, n = p.length;
    const len = flatLength(p);
    for (const end of [0, 1]) {
      const x = end ? p[n - 2] : p[0], z = end ? p[n - 1] : p[1];
      const nb = neighbours(vAll, ri, x, z);
      const f = { ri, end, x, z, len, kind: r.kind, sub: r.sub || '', cat: '' };
      if (nb.some((j) => isDrawnRoad(roads[j]))) f.cat = 'ok_junction';
      else if (x < bounds.minX - 25 || x > bounds.maxX + 25 || z < bounds.minZ - 25 || z > bounds.maxZ + 25) f.cat = 'edge';
      else if (nb.some((j) => roads[j].tunnel && CAR_KINDS.has(roads[j].kind))) f.cat = 'tunnel_mouth';
      else if (bidx.inside(x, z) >= 0) f.cat = 'into_building';
      else if (bidx.wallDist(x, z, 3) <= 3) f.cat = 'at_wall';
      else if (isWater && isWater(x, z)) f.cat = 'in_water';
      else {
        const h = segCar.nearest(x, z, 12, (j) => j === ri);
        if (h && h.edge <= 0.3) { f.cat = 'touch'; f.note = 'on road ' + h.ri; }
        else if (h && h.edge < 4) { f.cat = 'gap'; f.note = 'to road ' + h.ri + ' edge ' + h.edge.toFixed(1); }
        else if (nb.some((j) => drawnPath(roads[j]))) f.cat = 'to_path';
        else f.cat = 'open';
      }
      out.push(f);
    }
  });
  return out;
}
