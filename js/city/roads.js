// js/city/roads.js — London streets from GEO.roads / GEO.crossings / GEO.rail:
//  - carriageways: asphalt ribbons (real widths, miter joins) at y = 0 (bridge deck heights from road.deck), junction
//    discs at shared nodes; overlapping ribbons shade identically (world-space shader) so they never visibly z-fight
//  - pavements: raised KERB_H slabs either side of vehicle roads (granite kerb face, York-stone flags), cut wherever
//    they would cross another carriageway (junction mouths, dual carriageways) or the river
//  - footways / cycleways / steps (park paths in gravel), pedestrian streets in light stone
//  - UK markings: dashed white centre lines, double yellow lines (red on trunk "red routes"), give-way lines at minor
//    road ends, zebra crossings (stripes + zig-zags) and signal crossings (studs + stop lines)
//  - bridges: deck slabs, fascias, parapets and river piers under every road / footway / rail with a `deck`
//  - rail: ballast + sleepers + rails on surface & bridge track
// Outputs the pavement data (sidewalks) traffic & pedestrians use, and the sites street-details.js furnishes.
import { GeoBuilder, TileBuckets, offsetPolyline, makeHash, pointInRing, ringBox, hash01 } from './util.js';
import { FlatBuckets, LAYER, WATER_Y } from './ground.js';

export const KERB_H = 0.12;
const CAR_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_KINDS = new Set(['footway', 'cycleway', 'steps']);
const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 0 };
const PAVE_W = { motorway: 0, trunk: 3.2, primary: 3.2, secondary: 3.0, tertiary: 2.8, unclassified: 2.4, residential: 2.3, living_street: 0, service: 0 };
const ASPHALT = [47, 47, 49];
const WHITE = [232, 232, 226], YELLOW = [236, 190, 40], RED = [176, 34, 30];
const Y_MARK = 0.012;

const nodeKey = (x, z) => (Math.round(x * 10) + 80000) * 200000 + (Math.round(z * 10) + 80000);

/**
 * Rail heights per vertex: decks over water keep road.deck; OSM bridge=viaduct track without a deck (the brick viaducts
 * into London Bridge, Cannon Street, Charing Cross, Blackfriars, Waterloo…) is raised to VIADUCT_H, and the at-grade
 * track next to it ramps down along the rail graph at 1:35. Returns an array of Float32Array (one per GEO.rail way).
 */
export const VIADUCT_H = 7.2;
export function railHeights(rails) {
  const slope = 1 / 35;
  const hs = [], fixed = [];
  const nodes = new Map();
  rails.forEach((r, w) => {
    const n = r.pts.length / 2;
    const h = new Float32Array(n), f = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (r.deck) { h[i] = r.deck[i]; f[i] = r.deck[i] > 0.05 ? 1 : 0; }
      else if (r.bridge) { h[i] = VIADUCT_H; f[i] = 1; }
      const k = nodeKey(r.pts[i * 2], r.pts[i * 2 + 1]);
      let l = nodes.get(k); if (!l) nodes.set(k, (l = [])); l.push(w, i);
    }
    hs.push(h); fixed.push(f);
  });
  // decks over water that start at 0 on the banks but join viaducts: lift their ends to meet the viaduct
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    rails.forEach((r, w) => {
      const h = hs[w], f = fixed[w], p = r.pts, n = h.length;
      for (const dir of [1, -1]) {
        for (let i = dir > 0 ? 1 : n - 2; i >= 0 && i < n; i += dir) {
          if (f[i]) continue;
          const j = i - dir, d = Math.hypot(p[i * 2] - p[j * 2], p[i * 2 + 1] - p[j * 2 + 1]);
          const c = h[j] - d * slope;
          if (c > h[i] + 1e-3) { h[i] = c; changed = true; }
        }
      }
    });
    for (const l of nodes.values()) {
      if (l.length < 4) continue;
      let m = 0;
      for (let k = 0; k < l.length; k += 2) m = Math.max(m, hs[l[k]][l[k + 1]]);
      for (let k = 0; k < l.length; k += 2) if (!fixed[l[k]][l[k + 1]] && hs[l[k]][l[k + 1]] < m - 1e-3) { hs[l[k]][l[k + 1]] = m; changed = true; }
    }
    if (!changed) break;
  }
  return hs;
}

/** dense copy of a polyline (+ per-point deck heights) with points every <= step m */
function densify(pts, deck, step) {
  const xs = [], ys = [], orig = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1], y = deck ? deck[i] : 0;
    if (i > 0) {
      const px = pts[i * 2 - 2], pz = pts[i * 2 - 1], py = deck ? deck[i - 1] : 0;
      const L = Math.hypot(x - px, z - pz), k = Math.floor(L / step);
      for (let j = 1; j <= k; j++) {
        const t = j / (k + 1);
        xs.push(px + (x - px) * t, pz + (z - pz) * t); ys.push(py + (y - py) * t); orig.push(0);
      }
    }
    xs.push(x, z); ys.push(y); orig.push(1);
  }
  return { p: Float64Array.from(xs), y: Float64Array.from(ys), orig };
}

/** horizontal ribbon between two offset polylines (indices a..b of the dense line), up-facing */
function ribbon(b, L, R, ys, yOff, i0, i1, uvFn = null) {
  let pa = -1, pb = -1;
  for (let i = i0; i <= i1; i++) {
    const y = ys[i] + yOff;
    const va = b.v(L[i * 2], y, L[i * 2 + 1]);
    const vb = b.v(R[i * 2], y, R[i * 2 + 1]);
    if (uvFn) { uvFn(va, i, 0); uvFn(vb, i, 1); }
    if (pa >= 0) upQuad(b, pa, pb, vb, va);
    pa = va; pb = vb;
  }
}
/** quad a-b-c-d with the winding that faces up */
function upQuad(b, a, c1, c2, d) {
  const P = b.pos;
  const ax = P[a * 3], az = P[a * 3 + 2];
  const ny = (P[c1 * 3 + 2] - az) * (P[c2 * 3] - ax) - (P[c1 * 3] - ax) * (P[c2 * 3 + 2] - az);
  if (ny >= 0) b.quad(a, c1, c2, d); else b.quad(a, d, c2, c1);
}
/** vertical quad between ground points (x0,z0)-(x1,z1), from y0s to y1s (per end), facing (nx, nz) */
function wallQuad(b, x0, z0, x1, z1, y0a, y0b, y1a, y1b, nx, nz) {
  const dx = x1 - x0, dz = z1 - z0;
  const faceAB = -dz * nx + dx * nz > 0;
  if (!faceAB) { [x0, z0, x1, z1] = [x1, z1, x0, z0]; [y0a, y0b] = [y0b, y0a]; [y1a, y1b] = [y1b, y1a]; }
  const v0 = b.v(x0, y0a, z0, nx, 0, nz), v1 = b.v(x1, y0b, z1, nx, 0, nz), v2 = b.v(x1, y1b, z1, nx, 0, nz), v3 = b.v(x0, y1a, z0, nx, 0, nz);
  b.quad(v0, v1, v2, v3);
  return [v0, v1, v2, v3];
}
/** flat rectangle centred at (cx, cz), axis (ux, uz) half-lengths hu (along u) & hv (across), at y */
function rect(b, cx, cz, ux, uz, hu, hv, y) {
  const vx = -uz, vz = ux;
  const a = b.v(cx - ux * hu - vx * hv, y, cz - uz * hu - vz * hv), c = b.v(cx + ux * hu - vx * hv, y, cz + uz * hu - vz * hv);
  const d = b.v(cx + ux * hu + vx * hv, y, cz + uz * hu + vz * hv), e = b.v(cx - ux * hu + vx * hv, y, cz - uz * hu + vz * hv);
  upQuad(b, a, c, d, e);
}

export function buildRoadGeometry(geo, ctx, inRegion) {
  const { carriageIndex, world } = ctx;
  const SC = { scol: [4, 'u8n'] };
  const SCUV = { scol: [4, 'u8n'], uv: [2, 'f32'] };
  const L = {
    asphalt: new FlatBuckets(() => new GeoBuilder(SC)),
    paving: new FlatBuckets(() => new GeoBuilder(SCUV)),
    markings: new FlatBuckets(() => new GeoBuilder(SC)),
    ballast: new FlatBuckets(() => new GeoBuilder({ uv: [2, 'f32'] })),
    rails: new FlatBuckets(() => new GeoBuilder({})),
    deck: new FlatBuckets(() => new GeoBuilder(SC)),
    steel: new TileBuckets(() => new GeoBuilder({}))
  };
  const stats = { carriage: 0, pavementM: 0, footways: 0, zebras: 0, signalX: 0, junctions: 0, bridges: 0, piers: 0, railM: 0 };
  const strips = [];
  const sites = { zebras: [], signalCrossings: [], giveWays: [], lampRuns: [], busStops: [], pedEnds: [] };
  const roads = geo.roads;
  // Tower Bridge: the landmark module (Workstream B) draws its whole deck, footways, parapets, piers & bascules
  const landmarkRoad = (r) => r.name === 'Tower Bridge';
  const inR = (r) => {
    if (landmarkRoad(r)) return false;
    const p = r.pts, n = p.length;
    return inRegion(p[0], p[1], 40) || inRegion(p[n - 2], p[n - 1], 40) || inRegion(p[(n >> 2) * 2], p[(n >> 2) * 2 + 1], 40);
  };

  // ---- junction nodes: shared vertices of carriageways ---------------------------------------------------------------
  const nodes = new Map(); // key -> {x, z, y, n, hw, maxRank, roads: []}
  for (const r of roads) {
    if (r.tunnel || !CAR_KINDS.has(r.kind) || !inR(r)) continue;
    const p = r.pts;
    for (let i = 0; i < p.length; i += 2) {
      const k = nodeKey(p[i], p[i + 1]);
      let nd = nodes.get(k);
      if (!nd) nodes.set(k, (nd = { x: p[i], z: p[i + 1], y: r.deck ? r.deck[i / 2] : 0, n: 0, hw: 0, rank: -1, roads: [] }));
      if (nd.roads[nd.roads.length - 1] !== r) { nd.roads.push(r); nd.n++; }
      nd.hw = Math.max(nd.hw, r.w / 2);
      nd.rank = Math.max(nd.rank, RANK[r.kind] ?? 0);
    }
  }

  // ---- carriageways --------------------------------------------------------------------------------------------------
  const deckSegs = []; // bridge spans for the structure pass
  for (const r of roads) {
    if (r.tunnel || !inR(r)) continue;
    const isCar = CAR_KINDS.has(r.kind);
    const isPed = r.kind === 'pedestrian';
    const isPath = PATH_KINDS.has(r.kind);
    if (!isCar && !isPed && !isPath) continue;
    if (isPath && (r.sub === 'sidewalk' || r.sub === 'crossing')) continue;
    const step = 1e9; // ribbons only need the road's own vertices (deck heights are per vertex)
    const d = densify(r.pts, r.deck, step);
    const n = d.p.length / 2;
    if (n < 2) continue;
    const mx = d.p[(n >> 1) * 2], mz = d.p[(n >> 1) * 2 + 1];
    const hw = isCar ? r.w / 2 : isPed ? Math.max(r.w, 5) / 2 : Math.max(r.w || 0, r.kind === 'steps' ? 2.5 : 1.8) / 2;
    const Lp = offsetPolyline(d.p, hw), Rp = offsetPolyline(d.p, -hw);
    if (isCar) {
      const b = L.asphalt.get(mx, mz);
      b.set('scol', ...ASPHALT, 0);
      ribbon(b, Lp, Rp, d.y, 0, 0, n - 1);
      stats.carriage++;
    } else if (isPed) {
      const b = L.paving.get(mx, mz);
      b.set('scol', 182, 176, 162, 0.55 * 255);
      b.set('uv', 0, 5);
      ribbon(b, Lp, Rp, d.y, LAYER.plaza + 0.004 + (r.deck ? 0.02 : 0), 0, n - 1);
    } else {
      // park paths: gravel; town footways: flags; cycleways: dark tarmac
      const inPark = ctx.inPark ? ctx.inPark(mx, mz) : false;
      if (r.kind === 'cycleway' && !inPark) {
        const b = L.asphalt.get(mx, mz);
        b.set('scol', 58, 56, 56, 0);
        ribbon(b, Lp, Rp, d.y, LAYER.footway + (r.deck ? 0.04 : 0), 0, n - 1);
      } else {
        const b = L.paving.get(mx, mz);
        if (inPark) b.set('scol', 168, 150, 118, 0.9 * 255); else b.set('scol', 170, 166, 156, 0.55 * 255);
        b.set('uv', 0, 5);
        ribbon(b, Lp, Rp, d.y, LAYER.footway + (r.deck ? 0.04 : 0), 0, n - 1);
      }
      stats.footways++;
    }
    if (r.deck) deckSegs.push({ r, d, hw: isCar ? hw + (PAVE_W[r.kind] ? 2.5 : 0.3) : hw + 0.15, car: isCar, rail: false });
  }
  // junction discs
  for (const nd of nodes.values()) {
    if (nd.n < 2) continue;
    const b = L.asphalt.get(nd.x, nd.z);
    b.set('scol', ...ASPHALT, 0);
    const seg = 14, c = b.v(nd.x, nd.y, nd.z);
    const first = b.n;
    for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; b.v(nd.x + Math.cos(a) * nd.hw, nd.y, nd.z + Math.sin(a) * nd.hw); }
    for (let k = 0; k < seg; k++) {
      const i1 = first + k, i2 = first + ((k + 1) % seg);
      // up-facing: angle increases from +x toward +z, which is clockwise seen from above
      b.tri(c, i2, i1);
    }
    stats.junctions++;
  }

  // ---- pavements -----------------------------------------------------------------------------------------------------
  const isBank = (x, z) => world.isWater(x, z);
  for (const r of roads) {
    if (r.tunnel || !CAR_KINDS.has(r.kind) || !inR(r)) continue;
    const pw0 = PAVE_W[r.kind] || 0;
    if (!pw0 || r.junction === 'roundabout' || r.sub === 'link') continue;
    const d = densify(r.pts, r.deck, 2.5);
    const n = d.p.length / 2;
    if (n < 2) continue;
    const pw = r.deck ? 2.5 : pw0;
    const hw = r.w / 2;
    for (const side of [1, -1]) {
      const inner = offsetPolyline(d.p, side * hw);
      const outer = offsetPolyline(d.p, side * (hw + pw));
      const mid = new Float64Array(inner.length);
      for (let k = 0; k < mid.length; k++) mid[k] = (inner[k] + outer[k]) * 0.5;
      // keep[i] for dense segment i..i+1
      const keep = new Uint8Array(n - 1);
      for (let i = 0; i < n - 1; i++) {
        const x = (mid[i * 2] + mid[i * 2 + 2]) / 2, z = (mid[i * 2 + 1] + mid[i * 2 + 3]) / 2;
        const xi = (inner[i * 2] + inner[i * 2 + 2]) / 2 * 0.8 + x * 0.2, zi = (inner[i * 2 + 1] + inner[i * 2 + 3]) / 2 * 0.8 + z * 0.2;
        const xo = (outer[i * 2] + outer[i * 2 + 2]) / 2, zo = (outer[i * 2 + 1] + outer[i * 2 + 3]) / 2;
        const deckHere = r.deck && (d.y[i] > 0.05 || d.y[i + 1] > 0.05);
        let ok = !carriageIndex.onCarriageway(x, z, r, 0.1) && !carriageIndex.onCarriageway(xi, zi, r, 0.1) && !carriageIndex.onCarriageway(xo, zo, r, -0.2);
        if (ok && !deckHere && isBank(x, z)) ok = false;
        keep[i] = ok ? 1 : 0;
      }
      // runs of kept segments
      let i = 0;
      while (i < n - 1) {
        if (!keep[i]) { i++; continue; }
        let j = i;
        while (j + 1 < n - 1 && keep[j + 1]) j++;
        // points i..j+1
        const a = i, e = j + 1;
        const len = (e - a) * 2.5;
        if (len >= 2.0) {
          // geometry only at the run ends and the road's own vertices (the 2.5 m samples were for the cut tests)
          const ids = [a];
          for (let k = a + 1; k < e; k++) if (d.orig[k]) ids.push(k);
          ids.push(e);
          const m = ids.length;
          const ci = new Float64Array(m * 2), co = new Float64Array(m * 2), cm = new Float32Array(m * 2), cyv = new Float64Array(m), cy = new Float32Array(m);
          ids.forEach((k, q) => {
            ci[q * 2] = inner[k * 2]; ci[q * 2 + 1] = inner[k * 2 + 1]; co[q * 2] = outer[k * 2]; co[q * 2 + 1] = outer[k * 2 + 1];
            cm[q * 2] = mid[k * 2]; cm[q * 2 + 1] = mid[k * 2 + 1]; cyv[q] = d.y[k]; cy[q] = d.y[k] + KERB_H;
          });
          const cx = cm[(m >> 1) * 2], cz = cm[(m >> 1) * 2 + 1];
          const b = L.paving.get(cx, cz);
          b.set('scol', 178, 174, 164, 0);
          // along-kerb metres for the flags
          let s = 0;
          const sArr = new Float64Array(m);
          for (let k = 1; k < m; k++) { s += Math.hypot(ci[k * 2] - ci[k * 2 - 2], ci[k * 2 + 1] - ci[k * 2 - 1]); sArr[k] = s; }
          ribbon(b, side > 0 ? ci : co, side > 0 ? co : ci, cyv, KERB_H, 0, m - 1, (v, k, w) => {
            const fromKerb = side > 0 ? (w === 0 ? 0 : pw) : (w === 0 ? pw : 0);
            b.attr(v, 'uv', sArr[k], fromKerb);
          });
          // kerb face (toward the road) and back face, end caps
          b.set('uv', 0, 0);
          for (let k = 0; k < m - 1; k++) {
            const x0 = ci[k * 2], z0 = ci[k * 2 + 1], x1 = ci[k * 2 + 2], z1 = ci[k * 2 + 3];
            const dx = x1 - x0, dz = z1 - z0, Ls = Math.hypot(dx, dz) || 1;
            const nx = (-side * dz) / Ls, nz = (side * dx) / Ls; // toward the road centre (= -side * left normal)
            const y0 = cyv[k], y1 = cyv[k + 1];
            const q = wallQuad(b, x0, z0, x1, z1, y0 - 0.02, y1 - 0.02, y0 + KERB_H, y1 + KERB_H, nx, nz);
            b.attr(q[0], 'uv', sArr[k], 0.05); b.attr(q[1], 'uv', sArr[k + 1], 0.05); b.attr(q[2], 'uv', sArr[k + 1], 0.1); b.attr(q[3], 'uv', sArr[k], 0.1);
            b.set('uv', 0, 1);
            wallQuad(b, co[k * 2], co[k * 2 + 1], co[k * 2 + 2], co[k * 2 + 3], y0 - 0.06, y1 - 0.06, y0 + KERB_H, y1 + KERB_H, -nx, -nz);
            b.set('uv', 0, 0);
          }
          for (const [k, sg] of [[0, -1], [m - 1, 1]]) {
            const kk = Math.min(m - 1, Math.max(0, k + sg)), kb = Math.min(m - 1, Math.max(0, k - sg));
            let tx = cm[kk * 2] - cm[kb * 2], tz = cm[kk * 2 + 1] - cm[kb * 2 + 1];
            const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
            const y = cyv[k];
            wallQuad(b, ci[k * 2], ci[k * 2 + 1], co[k * 2], co[k * 2 + 1], y - 0.02, y - 0.02, y + KERB_H, y + KERB_H, tx * sg, tz * sg);
          }
          stats.pavementM += len;
          strips.push({ road: r.id, side, pts: cm, y: cy, offset: hw + pw / 2, w: pw, kind: r.kind });
        }
        i = j + 1;
      }
    }
  }

  // ---- markings ------------------------------------------------------------------------------------------------------
  // Brussels uses continental/right-hand conventions; never draw London's red routes or double-yellow kerb lines.
  const markLine = (b, p, ys, off, halfW, dash, gap, col, road, margin, phase = 0) => {
    // dashed (dash > 0) or solid line offset `off` from the centreline, cut wherever it enters another carriageway
    const o = offsetPolyline(p, off);
    const n = o.length / 2;
    let s = phase;
    b.set('scol', ...col, 255);
    const emit = (x0, z0, ux, uz, t0, t1, ya, yb, Ls) => {
      const len = t1 - t0, tm = (t0 + t1) / 2;
      const y = ya + (yb - ya) * (tm / Ls) + Y_MARK;
      rect(b, x0 + ux * tm, z0 + uz * tm, ux, uz, len / 2 + 0.005, halfW, y);
    };
    for (let i = 0; i < n - 1; i++) {
      const x0 = o[i * 2], z0 = o[i * 2 + 1], x1 = o[i * 2 + 2], z1 = o[i * 2 + 3];
      const dx = x1 - x0, dz = z1 - z0, Ls = Math.hypot(dx, dz);
      if (Ls < 0.01) continue;
      const ux = dx / Ls, uz = dz / Ls, ya = ys ? ys[i] : 0, yb = ys ? ys[i + 1] : 0;
      if (dash <= 0) {
        // solid: kept stretches between 2 m test samples, one rect per stretch
        const k = Math.max(1, Math.round(Ls / 2));
        let run = -1;
        for (let q = 0; q <= k; q++) {
          const ok = q < k && !carriageIndex.onCarriageway(x0 + ux * (Ls * (q + 0.5) / k), z0 + uz * (Ls * (q + 0.5) / k), road, margin);
          if (ok && run < 0) run = q;
          if (!ok && run >= 0) { emit(x0, z0, ux, uz, (Ls * run) / k, (Ls * q) / k, ya, yb, Ls); run = -1; }
        }
        continue;
      }
      let t = 0;
      while (t < Ls - 1e-3) {
        const period = dash + gap;
        const ph = s % period;
        const inDash = ph < dash;
        const len = Math.min(inDash ? dash - ph : period - ph, Ls - t);
        if (inDash && len > 0.05 && !carriageIndex.onCarriageway(x0 + ux * (t + len / 2), z0 + uz * (t + len / 2), road, margin)) emit(x0, z0, ux, uz, t, t + len, ya, yb, Ls);
        t += len; s += len;
      }
    }
  };
  for (const r of roads) {
    if (r.tunnel || !CAR_KINDS.has(r.kind) || !inR(r) || r.kind === 'service' || r.kind === 'living_street') continue;
    const d = { p: r.pts, y: r.deck };
    const n = d.p.length / 2;
    const b = L.markings.get(d.p[(n >> 1) * 2], d.p[(n >> 1) * 2 + 1]);
    const hw = r.w / 2;
    const h = hash01(r.id * 31 + 5);
    if (!r.oneway && r.w >= 5.5 && r.junction !== 'roundabout') markLine(b, d.p, d.y, 0, 0.05, 4, 5, WHITE, r, 1.0, h * 9);
    // Belgian urban parking restrictions use a single broken yellow edge line, not UK double yellows/red routes.
    if (r.kind !== 'residential' || h < 0.45) {
      for (const side of [1, -1]) {
        if (r.junction === 'roundabout') continue;
        markLine(b, d.p, d.y, side * (hw - 0.3), 0.045, 1.0, 1.0, YELLOW, r, 0.4, h * 2);
      }
    }
    // give-way lines where a minor road ends on a bigger one
    for (const end of [0, 1]) {
      const p = r.pts, k = end ? p.length - 2 : 0;
      const nd = nodes.get(nodeKey(p[k], p[k + 1]));
      if (!nd || nd.n < 2 || nd.rank <= (RANK[r.kind] ?? 0)) continue;
      const kb = end ? p.length - 4 : 2;
      let ux = p[k] - p[kb], uz = p[k + 1] - p[kb + 1];
      const ul = Math.hypot(ux, uz);
      if (ul < 1) continue;
      ux /= ul; uz /= ul; // toward the junction
      const back = Math.min(ul - 0.5, nd.hw + 1.2);
      const gx = p[k] - ux * back, gz = p[k + 1] - uz * back;
      // the inbound half is the LEFT of the travel direction toward the junction: left of (ux,uz) is (uz,-ux)
      const lx = uz, lz = -ux;
      const half = r.oneway ? hw : hw / 2;
      const c0 = r.oneway ? 0 : hw / 2;
      b.set('scol', ...WHITE, 255);
      for (const off of [0, 0.45]) {
        for (let q = -half + 0.3; q < half - 0.2; q += 0.9) {
          const cx = gx + lx * (c0 + q + 0.3) - ux * off, cz = gz + lz * (c0 + q + 0.3) - uz * off;
          rect(b, cx, cz, lx, lz, 0.3, 0.1, nd.y + Y_MARK);
        }
      }
      sites.giveWays.push({ x: gx, z: gz });
    }
  }

  // ---- crossings -----------------------------------------------------------------------------------------------------
  for (const c of geo.crossings) {
    if (!inRegion(c.x, c.z)) continue;
    const hit = carriageIndex.nearest(c.x, c.z, 6);
    if (!hit || hit.road.kind === 'service') continue;
    const r = hit.road, ux = hit.dx, uz = hit.dz, vx = -uz, vz = ux;
    const hw = r.w / 2;
    const y = r.deck ? world.groundHeight(c.x, c.z) : 0;
    const b = L.markings.get(c.x, c.z);
    const cx = hit.x, cz = hit.z;
    if (c.kind === 'zebra') {
      b.set('scol', ...WHITE, 255);
      const nS = Math.max(2, Math.round(r.w / 1.0));
      const span = r.w / nS;
      for (let k = 0; k < nS; k++) {
        const o = -hw + span * (k + 0.5);
        rect(b, cx + vx * o, cz + vz * o, ux, uz, 1.5, span * 0.25, y + Y_MARK + 0.002);
      }
      // Belgian zebra crossings use the transverse white bars without the British zig-zag approach markings.
      sites.zebras.push({ x: cx, z: cz, ux, uz, hw, y, road: r });
      stats.zebras++;
    } else {
      // signal-controlled crossing: two lines of studs across, stop lines 2 m back on each approach (left half)
      b.set('scol', ...WHITE, 255);
      for (const o of [-1.25, 1.25]) {
        for (let q = -hw + 0.2; q < hw; q += 0.6) rect(b, cx + ux * o + vx * q, cz + uz * o + vz * q, ux, uz, 0.06, 0.18, y + Y_MARK);
      }
      for (const dir of [-1, 1]) {
        // traffic approaching along a = -dir*u stops on the line 3.2 m out on the +dir side, in the lane left of a
        if (r.oneway && dir !== -r.oneway) continue;
        const Lx = -dir * uz, Lz = dir * ux;
        const half = r.oneway ? hw : hw / 2, c0 = r.oneway ? 0 : hw / 2;
        rect(b, cx + ux * dir * 3.2 + Lx * c0, cz + uz * dir * 3.2 + Lz * c0, Lx, Lz, half - 0.1, 0.15, y + Y_MARK);
      }
      sites.signalCrossings.push({ x: cx, z: cz, ux, uz, hw, y, road: r });
      stats.signalX++;
    }
  }

  // ---- dead ends, gateways, building passages, tunnel portals ---------------------------------------------------------
  // (baked by tools/geo-london-roadfix.mjs: road.capA / capB, GEO.gates, GEO.passages) so no ribbon just stops
  const colliders = [];
  const ends = buildRoadEnds(geo, ctx, L, inR, inRegion, colliders, stats);
  sites.deadEnds = ends;

  // ---- bridges: deck slab, fascias, parapets, piers ------------------------------------------------------------------
  const rh = railHeights(geo.rail);
  geo.rail.forEach((r, w) => {
    if (r.tunnel || !inR(r)) return;
    const h = rh[w];
    if (!h.some((v) => v > 0.25)) return;
    deckSegs.push({ r, d: densify(r.pts, h, 1e9), hw: 2.4, car: false, rail: true, viaduct: !r.deck });
  });
  for (const { r, d, hw, car, rail, viaduct } of deckSegs) {
    const n = d.p.length / 2;
    const Lp = offsetPolyline(d.p, hw), Rp = offsetPolyline(d.p, -hw);
    const mx = d.p[(n >> 1) * 2], mz = d.p[(n >> 1) * 2 + 1];
    const b = L.deck.get(mx, mz);
    const stone = viaduct ? [112, 72, 56] : rail ? [96, 88, 82] : r.kind === 'footway' || r.kind === 'cycleway' ? [170, 172, 170] : [146, 142, 132];
    b.set('scol', ...stone, 0);
    const thick = rail ? 1.6 : car ? 1.3 : 0.7;
    const parH = rail ? 1.3 : car ? 1.05 : 1.15;
    let pierS = 20 + hash01(r.id) * 10, s = 0;
    for (let i = 0; i < n - 1; i++) {
      const ya = d.y[i], yb = d.y[i + 1];
      const segL = Math.hypot(d.p[i * 2 + 2] - d.p[i * 2], d.p[i * 2 + 3] - d.p[i * 2 + 1]);
      if (ya < 0.25 && yb < 0.25) { s += segL; continue; }
      const dx = d.p[i * 2 + 2] - d.p[i * 2], dz = d.p[i * 2 + 3] - d.p[i * 2 + 1];
      const ux = dx / (segL || 1), uz = dz / (segL || 1), lx = uz, lz = -ux; // left normal
      // underside (facing down)
      const u0 = b.v(Lp[i * 2], ya - thick, Lp[i * 2 + 1], 0, -1, 0), u1 = b.v(Rp[i * 2], ya - thick, Rp[i * 2 + 1], 0, -1, 0);
      const u2 = b.v(Rp[i * 2 + 2], yb - thick, Rp[i * 2 + 3], 0, -1, 0), u3 = b.v(Lp[i * 2 + 2], yb - thick, Lp[i * 2 + 3], 0, -1, 0);
      { const P = b.pos; const ny = (P[u1 * 3 + 2] - P[u0 * 3 + 2]) * (P[u2 * 3] - P[u0 * 3]) - (P[u1 * 3] - P[u0 * 3]) * (P[u2 * 3 + 2] - P[u0 * 3 + 2]); if (ny < 0) b.quad(u0, u1, u2, u3); else b.quad(u0, u3, u2, u1); }
      // brick viaducts stand on the ground (arched walls) except where they span a street
      const pmx = (d.p[i * 2] + d.p[i * 2 + 2]) / 2, pmz = (d.p[i * 2 + 1] + d.p[i * 2 + 3]) / 2;
      const solid = viaduct && ya > 2 && yb > 2 && !carriageIndex.onCarriageway(pmx, pmz, null, 1.5) && !world.isWater(pmx, pmz);
      // fascias + parapets on both sides (outer face from deck-thick, or the ground, to deck+parH, inner face, coping)
      for (const [E, sg] of [[Lp, 1], [Rp, -1]]) {
        const x0 = E[i * 2], z0 = E[i * 2 + 1], x1 = E[i * 2 + 2], z1 = E[i * 2 + 3];
        const nx = lx * sg, nz = lz * sg;
        if (solid) {
          b.set('scol', 118, 74, 56, 255);
          wallQuad(b, x0, z0, x1, z1, -0.05, -0.05, ya - 0.4, yb - 0.4, nx, nz);
          b.set('scol', ...stone, 0);
          wallQuad(b, x0, z0, x1, z1, ya - 0.4, yb - 0.4, ya + parH, yb + parH, nx, nz);
        } else wallQuad(b, x0, z0, x1, z1, ya - thick, yb - thick, ya + parH, yb + parH, nx, nz);
        const ix = -nx * 0.3, iz = -nz * 0.3;
        wallQuad(b, x0 + ix, z0 + iz, x1 + ix, z1 + iz, ya, yb, ya + parH, yb + parH, -nx, -nz);
        const c0 = b.v(x0, ya + parH, z0), c1 = b.v(x1, yb + parH, z1), c2 = b.v(x1 + ix, yb + parH, z1 + iz), c3 = b.v(x0 + ix, ya + parH, z0 + iz);
        upQuad(b, c0, c1, c2, c3);
      }
      // piers in the water every ~40 m
      s += segL;
      if (s >= pierS) {
        pierS += 38 + hash01(r.id + i) * 8;
        const px = (d.p[i * 2] + d.p[i * 2 + 2]) / 2, pz = (d.p[i * 2 + 1] + d.p[i * 2 + 3]) / 2;
        if (world.isWater(px, pz) && (ya + yb) / 2 > 2) {
          const top = Math.min(ya, yb) - thick, bot = WATER_Y - 3;
          const hu = 2.2, hv = hw * 0.85;
          const corners = [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([a, c]) => [px + ux * a + lx * c, pz + uz * a + lz * c]);
          for (let k = 0; k < 4; k++) {
            const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
            const ex = bx - ax, ez = bz - az, el = Math.hypot(ex, ez) || 1;
            // outward normal of the corner loop (its winding is CW or CCW: test against the centre)
            let nx = -ez / el, nz = ex / el;
            if ((ax + bx) / 2 - px > 0 !== nx > 0 && Math.abs(nx) > 0.3) { nx = -nx; nz = -nz; }
            else if (Math.abs(nx) <= 0.3 && ((az + bz) / 2 - pz > 0) !== nz > 0) { nx = -nx; nz = -nz; }
            wallQuad(b, ax, az, bx, bz, bot, bot, top, top, nx, nz);
          }
          stats.piers++;
        }
      }
    }
    stats.bridges++;
  }

  // ---- rail: ballast + sleepers, rails ---------------------------------------------------------------------------
  for (const r of geo.rail) {
    if (r.tunnel || !inR(r)) continue;
    const hgt = rh[geo.rail.indexOf(r)];
    const d = densify(r.pts, hgt, 1e9);
    const n = d.p.length / 2;
    if (n < 2) continue;
    const mx = d.p[(n >> 1) * 2], mz = d.p[(n >> 1) * 2 + 1];
    const yOff = hgt.some((v) => v > 0.25) ? 0.25 : -0.008;
    const bl = L.ballast.get(mx, mz);
    const Lb = offsetPolyline(d.p, 1.7), Rb = offsetPolyline(d.p, -1.7);
    let s = 0;
    const sA = new Float64Array(n);
    for (let k = 1; k < n; k++) sA[k] = (s += Math.hypot(d.p[k * 2] - d.p[k * 2 - 2], d.p[k * 2 + 1] - d.p[k * 2 - 1]));
    ribbon(bl, Lb, Rb, d.y, yOff, 0, n - 1, (v, k, w) => bl.attr(v, 'uv', sA[k], w ? -1.7 : 1.7));
    stats.railM += s;
    const rb = L.rails.get(mx, mz);
    for (const g of [0.7175, -0.7175]) {
      const a = offsetPolyline(d.p, g + 0.035), c = offsetPolyline(d.p, g - 0.035);
      ribbon(rb, a, c, d.y, yOff + 0.16, 0, n - 1);
      for (let k = 0; k < n - 1; k++) {
        const ex = a[k * 2 + 2] - a[k * 2], ez = a[k * 2 + 3] - a[k * 2 + 1], el = Math.hypot(ex, ez) || 1;
        const nx = ez / el, nz = -ex / el;
        wallQuad(rb, a[k * 2], a[k * 2 + 1], a[k * 2 + 2], a[k * 2 + 3], d.y[k] + yOff, d.y[k + 1] + yOff, d.y[k] + yOff + 0.16, d.y[k + 1] + yOff + 0.16, nx, nz);
        wallQuad(rb, c[k * 2], c[k * 2 + 1], c[k * 2 + 2], c[k * 2 + 3], d.y[k] + yOff, d.y[k + 1] + yOff, d.y[k] + yOff + 0.16, d.y[k + 1] + yOff + 0.16, -nx, -nz);
      }
    }
  }

  // ---- pavement lookup -----------------------------------------------------------------------------------------------
  const segs = [];
  strips.forEach((st, si) => { for (let k = 0; k + 3 < st.pts.length; k += 2) segs.push(si, k); });
  const nSeg = segs.length / 2;
  const B = geo.bounds;
  const hash = makeHash(B.minX - 100, B.minZ - 100, B.maxX + 100, B.maxZ + 100, 16, nSeg, (i, o) => {
    const st = strips[segs[i * 2]], k = segs[i * 2 + 1], p = st.pts, pad = st.w / 2;
    o[0] = Math.min(p[k], p[k + 2]) - pad; o[2] = Math.max(p[k], p[k + 2]) + pad; o[1] = Math.min(p[k + 1], p[k + 3]) - pad; o[3] = Math.max(p[k + 1], p[k + 3]) + pad;
  });
  function pavementAt(x, z) {
    const c = hash.cellOf(x, z);
    if (c < 0) return null;
    for (let q = hash.start[c], e = hash.start[c + 1]; q < e; q++) {
      const i = hash.items[q], st = strips[segs[i * 2]], k = segs[i * 2 + 1], p = st.pts;
      const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + dx * t - x, ez = az + dz * t - z;
      if (ex * ex + ez * ez <= (st.w / 2) * (st.w / 2)) return st.y[k / 2] + (st.y[k / 2 + 1] - st.y[k / 2]) * t;
    }
    return null;
  }

  return {
    layers: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.map])),
    sidewalks: { kerbHeight: KERB_H, strips, pavementAt },
    nodes, sites, stats,
    // bollards, tunnel-portal walls (SPEC collider format) — london-city.js should add these to city.colliders
    colliders
  };
}

// ---- road ends ---------------------------------------------------------------------------------------------------------
const DARK = [10, 10, 12], SHUTTER = [74, 76, 80], FRAME = [196, 190, 176], CONCRETE = [152, 149, 141], BOLLARD = [26, 26, 28], BAND = [214, 200, 150];

/** vertical n-gon prism (bollard) centred at (x, z), radius rad, from y0 to y1, up-facing top */
function post(b, x, z, rad, y0, y1, sides = 6) {
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
    wallQuad(b, x + Math.cos(a0) * rad, z + Math.sin(a0) * rad, x + Math.cos(a1) * rad, z + Math.sin(a1) * rad, y0, y0, y1, y1, Math.cos(am), Math.sin(am));
  }
  const c = b.v(x, y1, z), first = b.n;
  for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2; b.v(x + Math.cos(a) * rad, y1, z + Math.sin(a) * rad); }
  for (let k = 0; k < sides; k++) b.tri(c, first + ((k + 1) % sides), first + k);
}
/** wall slab along (x0,z0)-(x1,z1), thickness t to the (nx, nz) side's opposite, y0..y1, with a top */
function slab(b, x0, z0, x1, z1, nx, nz, t, y0, y1) {
  const bx = -nx * t, bz = -nz * t;
  wallQuad(b, x0, z0, x1, z1, y0, y0, y1, y1, nx, nz);
  wallQuad(b, x0 + bx, z0 + bz, x1 + bx, z1 + bz, y0, y0, y1, y1, -nx, -nz);
  const dx = x1 - x0, dz = z1 - z0, dl = Math.hypot(dx, dz) || 1;
  wallQuad(b, x0, z0, x0 + bx, z0 + bz, y0, y0, y1, y1, -dx / dl, -dz / dl);
  wallQuad(b, x1, z1, x1 + bx, z1 + bz, y0, y0, y1, y1, dx / dl, dz / dl);
  upQuad(b, b.v(x0, y1, z0), b.v(x1, y1, z1), b.v(x1 + bx, y1, z1 + bz), b.v(x0 + bx, y1, z0 + bz));
}
/** OBB collider (SPEC: three.js rotation.y = θ, local x = (cos θ, −sin θ)) for a box with half-size hu along (ux, uz) */
function obb(cx, cz, ux, uz, hu, hv, maxY) {
  // local x axis = (cs, −sn) = (ux, uz) → cs = ux, sn = −uz
  const cs = ux, sn = -uz;
  const ex = Math.abs(hu * cs) + Math.abs(hv * sn), ez = Math.abs(hu * sn) + Math.abs(hv * cs);
  return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY, obb: { cx, cz, hx: hu, hz: hv, cs, sn } };
}

/**
 * One opening in a facade: centre (x, z) on the wall line, outward normal (nx, nz), road direction (ux, uz) into the
 * wall, carriageway width w, height h. kind 'arch' (through-passage: dark mouth with a segmental arch + stone
 * surround) or 'gate' (dead end: dark roller shutter / yard gate in a frame).
 */
function facadeOpening(b, x, z, y, nx, nz, ux, uz, w, h, kind) {
  const tx = -nz, tz = nx; // along the wall
  const c = Math.max(0.55, Math.abs(ux * nx + uz * nz));
  const half = Math.min(w / 2 / c + 0.25, 7);
  const rise = kind === 'arch' ? Math.min(half * 0.45, 1.3) : 0;
  const ring = (off, ext, top, col) => {
    // a vertical panel 'off' m in front of the wall: rectangle to (top − rise) + a segmental arch to top
    b.set('scol', ...col, 0);
    const px = x + nx * off, pz = z + nz * off;
    const hh = half + ext, springY = y + top - rise;
    const N = rise > 0 ? 8 : 1;
    const base = [];
    for (let k = 0; k <= N; k++) {
      const s = -hh + (2 * hh * k) / N;
      const yt = rise > 0 ? springY + rise * Math.sqrt(Math.max(0, 1 - (s / hh) * (s / hh))) : y + top;
      base.push([px + tx * s, pz + tz * s, yt]);
    }
    for (let k = 0; k < N; k++) {
      const [ax, az, ay] = base[k], [cx, cz, cy] = base[k + 1];
      const v0 = b.v(ax, y - 0.02, az, nx, 0, nz), v1 = b.v(cx, y - 0.02, cz, nx, 0, nz), v2 = b.v(cx, cy, cz, nx, 0, nz), v3 = b.v(ax, ay, az, nx, 0, nz);
      // facing +n: (v1 − v0) × (v3 − v0) must point along n
      const ex = cx - ax, ez = cz - az; // along t; t × up = (tz·1 − 0, …) → check sign
      if (-ez * nx + ex * nz > 0) b.quad(v0, v1, v2, v3); else b.quad(v0, v3, v2, v1);
    }
  };
  if (kind === 'arch') {
    ring(0.03, 0.35, h + 0.3, FRAME);
    ring(0.05, 0, h, DARK);
  } else {
    ring(0.03, 0.18, h + 0.18, FRAME);
    // roller shutter: slats in two greys
    const px = x + nx * 0.05, pz = z + nz * 0.05;
    for (let k = 0, s = 0.25; s < h; k++, s += 0.25) {
      const g = k % 2 ? SHUTTER : SHUTTER.map((v) => v * 0.86);
      b.set('scol', ...g, 0);
      const ya = y + s - 0.25, yb = y + Math.min(h, s);
      const a = [px - tx * half, pz - tz * half], e = [px + tx * half, pz + tz * half];
      const v0 = b.v(a[0], ya, a[1], nx, 0, nz), v1 = b.v(e[0], ya, e[1], nx, 0, nz), v2 = b.v(e[0], yb, e[1], nx, 0, nz), v3 = b.v(a[0], yb, a[1], nx, 0, nz);
      if (-(e[1] - a[1]) * nx + (e[0] - a[0]) * nz > 0) b.quad(v0, v1, v2, v3); else b.quad(v0, v3, v2, v1);
    }
  }
}

export function buildRoadEnds(geo, ctx, L, inR, inRegion, colliders, stats) {
  const { carriageIndex } = ctx;
  const roads = geo.roads;
  const out = [];
  const endOf = (r, end) => {
    const p = r.pts, n = p.length, k = end ? n - 2 : 0, kb = end ? n - 4 : 2;
    let ux = p[k] - p[kb], uz = p[k + 1] - p[kb + 1];
    const segL = Math.hypot(ux, uz) || 1; ux /= segL; uz /= segL;
    return { x: p[k], z: p[k + 1], y: r.deck ? r.deck[k / 2] : 0, ux, uz, lx: uz, lz: -ux, segL };
  };
  const onOther = (x, z, r, m = 0) => carriageIndex.onCarriageway(x, z, r, m);
  const st = { kerb: 0, bollards: 0, gate: 0, portal: 0, arch: 0 };

  // kerbed end: a raised pavement slab across the end joining the two pavements (or a kerb strip on service roads)
  const kerbCap = (r, e) => {
    const hw = r.w / 2, pw = (r.junction !== 'roundabout' && r.sub !== 'link' && PAVE_W[r.kind]) || 0;
    const half = hw + (pw || 0.35);
    let D = pw ? Math.max(2, pw) : 1.4;
    for (const s of [0.4, D / 2, D]) for (const o of [-half, -hw * 0.5, 0, hw * 0.5, half]) {
      if (onOther(e.x + e.ux * s + e.lx * o, e.z + e.uz * s + e.lz * o, r)) D = Math.min(D, s - 0.35);
    }
    if (D < 0.6) return false;
    const b = L.paving.get(e.x, e.z);
    b.set('scol', 178, 174, 164, 0);
    const y0 = e.y, y1 = e.y + KERB_H;
    const P = (s, o) => [e.x + e.ux * s + e.lx * o, e.z + e.uz * s + e.lz * o];
    const A = P(0, -half), Bq = P(0, half), C = P(D, half), Dq = P(D, -half);
    const va = b.v(A[0], y1, A[1]), vb = b.v(Bq[0], y1, Bq[1]), vc = b.v(C[0], y1, C[1]), vd = b.v(Dq[0], y1, Dq[1]);
    b.attr(va, 'uv', 0, 0); b.attr(vb, 'uv', 2 * half, 0); b.attr(vc, 'uv', 2 * half, D); b.attr(vd, 'uv', 0, D);
    upQuad(b, va, vb, vc, vd);
    b.set('uv', 0, 0);
    wallQuad(b, A[0], A[1], Bq[0], Bq[1], y0 - 0.02, y0 - 0.02, y1, y1, -e.ux, -e.uz); // kerb face toward the road
    wallQuad(b, Dq[0], Dq[1], C[0], C[1], y0 - 0.06, y0 - 0.06, y1, y1, e.ux, e.uz);
    wallQuad(b, A[0], A[1], Dq[0], Dq[1], y0 - 0.06, y0 - 0.06, y1, y1, -e.lx, -e.lz);
    wallQuad(b, Bq[0], Bq[1], C[0], C[1], y0 - 0.06, y0 - 0.06, y1, y1, e.lx, e.lz);
    st.kerb++;
    return true;
  };
  // bollards across the carriageway where it stops being a road (modal filter / continues as a footpath)
  const bollards = (r, e) => {
    const hw = r.w / 2;
    // the tip may reach onto the next carriageway (closed gap): stand the row where this road is on its own
    let s = 0.6;
    const lim = Math.min(8, e.segL - 0.3);
    while (s < lim && onOther(e.x - e.ux * s, e.z - e.uz * s, r, 0.4)) s += 0.5;
    if (s >= lim) s = Math.min(0.6, e.segL / 2);
    const cx = e.x - e.ux * s, cz = e.z - e.uz * s;
    const b = L.deck.get(cx, cz);
    const span = Math.max(0, 2 * hw - 0.9), n = Math.max(2, Math.round(span / 1.4) + 1);
    for (let k = 0; k < n; k++) {
      const o = -span / 2 + (span * k) / (n - 1);
      const x = cx + e.lx * o, z = cz + e.lz * o;
      if (onOther(x, z, r, 0.5)) continue; // never stand a bollard in another road's traffic lane
      b.set('scol', ...BOLLARD, 0); post(b, x, z, 0.1, e.y - 0.02, e.y + 0.74);
      b.set('scol', ...BAND, 0); post(b, x, z, 0.102, e.y + 0.74, e.y + 0.8);
      b.set('scol', ...BOLLARD, 0); post(b, x, z, 0.1, e.y + 0.8, e.y + 0.95);
      colliders.push({ minX: x - 0.14, maxX: x + 0.14, minZ: z - 0.14, maxZ: z + 0.14, maxY: e.y + 0.95 });
    }
    st.bollards++;
    return { x: cx, z: cz };
  };
  // tunnel mouth on a flat world: the approach runs between concrete retaining walls into a dark mouth (a black pit
  // patch read as the road dropping away) that ends at a headwall; walls + headwall collide
  const portal = (r, e) => {
    const hw = r.w / 2 + 0.3;
    let D = 7; // dark mouth length beyond the tip
    for (let s = 1; s <= D; s += 1) for (const o of [-hw, 0, hw]) if (onOther(e.x + e.ux * s + e.lx * o, e.z + e.uz * s + e.lz * o, r, 0.2)) { D = Math.min(D, s - 1); }
    D = Math.max(2, D);
    const back = Math.min(24, e.segL * 0.8);
    const b = L.deck.get(e.x, e.z);
    // the mouth: black patch, slightly above the asphalt
    b.set('scol', ...DARK, 0);
    rect(b, e.x + e.ux * (D / 2 - 0.5), e.z + e.uz * (D / 2 - 0.5), e.ux, e.uz, D / 2 + 0.5, hw, e.y + 0.02);
    b.set('scol', ...CONCRETE, 0);
    for (const sg of [1, -1]) {
      // wing walls, rising from 0.3 m (back) to 1.1 m at the tip, then 1.1 m along the mouth
      const ox = e.lx * sg * (hw + 0.25), oz = e.lz * sg * (hw + 0.25);
      const x0 = e.x - e.ux * back + ox, z0 = e.z - e.uz * back + oz, x1 = e.x + ox, z1 = e.z + oz, x2 = e.x + e.ux * D + ox, z2 = e.z + e.uz * D + oz;
      wallQuad(b, x0, z0, x1, z1, e.y - 0.05, e.y - 0.05, e.y + 0.3, e.y + 1.1, -e.lx * sg, -e.lz * sg);
      wallQuad(b, x0 + e.lx * sg * 0.3, z0 + e.lz * sg * 0.3, x1 + e.lx * sg * 0.3, z1 + e.lz * sg * 0.3, e.y - 0.05, e.y - 0.05, e.y + 0.3, e.y + 1.1, e.lx * sg, e.lz * sg);
      slab(b, x1 + e.lx * sg * 0.3, z1 + e.lz * sg * 0.3, x2 + e.lx * sg * 0.3, z2 + e.lz * sg * 0.3, e.lx * sg, e.lz * sg, 0.3, e.y - 0.05, e.y + 1.1);
      const mx = (x0 + x2) / 2 + e.lx * sg * 0.15, mz = (z0 + z2) / 2 + e.lz * sg * 0.15;
      colliders.push(obb(mx, mz, e.ux, e.uz, (back + D) / 2, 0.2, e.y + 1.1));
    }
    // headwall across the far end of the mouth
    const hx = e.x + e.ux * D, hz = e.z + e.uz * D;
    slab(b, hx - e.lx * (hw + 0.55), hz - e.lz * (hw + 0.55), hx + e.lx * (hw + 0.55), hz + e.lz * (hw + 0.55), -e.ux, -e.uz, 0.4, e.y - 0.05, e.y + 1.25);
    colliders.push(obb(hx + e.ux * 0.2, hz + e.uz * 0.2, e.lx, e.lz, hw + 0.55, 0.25, e.y + 1.25));
    st.portal++;
  };

  for (const r of roads) {
    if (r.tunnel || !(r.capA || r.capB) || !inR(r)) continue;
    for (const end of [0, 1]) {
      const cap = end ? r.capB : r.capA;
      if (!cap || cap === 'gate') continue;
      const e = endOf(r, end);
      if (!inRegion(e.x, e.z)) continue;
      if (cap === 'kerb') { if (kerbCap(r, e)) out.push({ x: e.x, z: e.z, kind: 'kerb', road: r.id }); }
      else if (cap === 'bollards') { const q = bollards(r, e); out.push({ x: q.x, z: q.z, kind: 'bollards', road: r.id }); }
      else if (cap === 'portal') { portal(r, e); out.push({ x: e.x, z: e.z, kind: 'portal', road: r.id }); }
    }
  }
  // gateways: a shutter / yard gate in the wall at the end of the road
  for (const g of geo.gates || []) {
    const r = roads[g.road];
    if (!r || !inRegion(g.x, g.z) || !inR(r)) continue;
    const e = endOf(r, g.end);
    facadeOpening(L.deck.get(g.x, g.z), g.x, g.z, e.y, g.nx, g.nz, -g.nx, -g.nz, Math.min(g.w, 6), g.h, 'gate');
    out.push({ x: g.x, z: g.z, kind: 'gate', road: g.road });
    st.gate++;
  }
  // through-passages: a dark arch where the carriageway enters the building (ctx.passageArches: buildings cut real ones)
  if (!ctx.passageArches) {
    for (const ps of geo.passages || []) {
      const r = roads[ps.road];
      if (!r || !inR(r)) continue;
      for (const q of ps.portals) {
        if (!inRegion(q.x, q.z)) continue;
        // road direction at the portal: nearest segment of the passage polyline
        const p = ps.pts;
        let bd = Infinity, ux = -q.nx, uz = -q.nz;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], L2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((q.x - p[i]) * dx + (q.z - p[i + 1]) * dz) / L2));
          const d = Math.hypot(p[i] + dx * t - q.x, p[i + 1] + dz * t - q.z);
          if (d < bd) { bd = d; const l = Math.sqrt(L2); ux = dx / l; uz = dz / l; }
        }
        const w = r.kind === 'pedestrian' ? Math.min(Math.max(r.w, 3), 6) : Math.min(r.w + 0.4, 12);
        facadeOpening(L.deck.get(q.x, q.z), q.x, q.z, 0, q.nx, q.nz, ux, uz, w, ps.minY, 'arch');
        out.push({ x: q.x, z: q.z, kind: 'arch', road: ps.road });
        st.arch++;
      }
    }
  }
  stats.ends = st;
  return out;
}
