// js/brussels-base-world.js — fast world queries over the decoded Brussels geodata (js/bxl-geodata.js GEO).
//
//   import { GEO } from './bxl-geodata.js';
//   import { createWorldQueries } from './brussels-base-world.js';
//   const world = createWorldQueries(GEO);   // ~100-200 ms (spatial hashes + 4 m water raster). js/brussels-base-config.js
//                                            // already makes one: `import { WORLD } from './brussels-base-config.js'`.
//
// Headings follow the NY convention: heading 0 faces +z (south), PI/2 faces +x (east), PI faces north;
// the unit direction of heading h is (sin h, cos h) in (x, z).

export const WATER_LEVEL = -1.2;
export const VEHICLE_KINDS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
export const MAJOR_KINDS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
export const WALK_KINDS = ['pedestrian', 'footway', 'cycleway', 'steps', 'living_street', 'residential', 'service', 'unclassified'];
const PRESETS = { drive: VEHICLE_KINDS, major: MAJOR_KINDS, walk: WALK_KINDS };

/** raised-cosine bridge deck profile along `bridge.axis` (0 at both ends, bridge.deckY mid-span); 0 off the span */
export function bridgeDeckAt(bridge, x, z) {
  const a = bridge.axis;
  if (!a || !(bridge.deckY > 0)) return 0;
  const dx = a[2] - a[0], dz = a[3] - a[1], L = Math.hypot(dx, dz);
  const t = ((x - a[0]) * dx + (z - a[1]) * dz) / L;
  if (t <= 0 || t >= L) return 0;
  return bridge.deckY * 0.5 * (1 - Math.cos((2 * Math.PI * t) / L));
}

function pointInFlat(x, z, p) {
  let inside = false;
  for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** CSR spatial hash of items given by bbox */
function makeHash(b, cell, n, bboxOf) {
  const W = Math.ceil((b.maxX - b.minX) / cell) + 1, H = Math.ceil((b.maxZ - b.minZ) / cell) + 1;
  const counts = new Uint32Array(W * H + 1);
  const range = (i, out) => {
    bboxOf(i, out);
    out[0] = Math.max(0, Math.floor((out[0] - b.minX) / cell)); out[2] = Math.min(W - 1, Math.floor((out[2] - b.minX) / cell));
    out[1] = Math.max(0, Math.floor((out[1] - b.minZ) / cell)); out[3] = Math.min(H - 1, Math.floor((out[3] - b.minZ) / cell));
  };
  const r = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) { range(i, r); for (let cz = r[1]; cz <= r[3]; cz++) for (let cx = r[0]; cx <= r[2]; cx++) counts[cz * W + cx + 1]++; }
  for (let i = 1; i <= W * H; i++) counts[i] += counts[i - 1];
  const items = new Uint32Array(counts[W * H]);
  const fillp = counts.slice(0, W * H);
  for (let i = 0; i < n; i++) { range(i, r); for (let cz = r[1]; cz <= r[3]; cz++) for (let cx = r[0]; cx <= r[2]; cx++) items[fillp[cz * W + cx]++] = i; }
  return {
    W, H, cell, start: counts, items,
    cellOf(x, z) {
      const cx = Math.floor((x - b.minX) / cell), cz = Math.floor((z - b.minZ) / cell);
      return cx < 0 || cz < 0 || cx >= W || cz >= H ? -1 : cz * W + cx;
    }
  };
}

export function createWorldQueries(GEO, { terrain = null, terrainSurface = null } = {}) {
  const B0 = GEO.bounds;
  const B = { minX: B0.minX - 150, maxX: B0.maxX + 150, minZ: B0.minZ - 150, maxZ: B0.maxZ + 150 };
  const roads = GEO.roads;

  // ---- road segments ------------------------------------------------------------------------------------------
  let nSeg = 0;
  for (const r of roads) nSeg += r.pts.length / 2 - 1;
  const segRoad = new Uint32Array(nSeg), segI = new Uint32Array(nSeg), segLen = new Float32Array(nSeg);
  {
    let s = 0;
    roads.forEach((r, ri) => {
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2, s++) { segRoad[s] = ri; segI[s] = i; segLen[s] = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); }
    });
  }
  const segBox = (s, o) => {
    const p = roads[segRoad[s]].pts, i = segI[s];
    o[0] = Math.min(p[i], p[i + 2]); o[2] = Math.max(p[i], p[i + 2]); o[1] = Math.min(p[i + 1], p[i + 3]); o[3] = Math.max(p[i + 1], p[i + 3]);
  };
  const roadHash = makeHash(B, 32, nSeg, segBox);
  const kindMask = (kinds) => {
    if (!kinds) return null;
    const list = typeof kinds === 'string' ? PRESETS[kinds] || [kinds] : kinds;
    return new Set(list);
  };

  /**
   * nearest road centreline point. opts: {kinds: [..] | 'drive' | 'major' | 'walk', maxDist = 250, named = false,
   * tunnels = false, filter: (road) => bool}. Returns {road, x, z, dist, heading, t} (heading along the road's point order) or null.
   */
  function nearestRoad(x, z, opts = {}) {
    const ks = kindMask(opts.kinds), maxDist = opts.maxDist ?? 250, named = !!opts.named, tunnels = !!opts.tunnels, filter = opts.filter;
    const c0 = roadHash.cellOf(x, z);
    if (c0 < 0) return null;
    const cx0 = c0 % roadHash.W, cz0 = (c0 - cx0) / roadHash.W;
    let best = null, bd2 = maxDist * maxDist;
    const maxRing = Math.ceil(maxDist / roadHash.cell) + 1;
    for (let ring = 0; ring <= maxRing; ring++) {
      const ringMin = Math.max(0, (ring - 1) * roadHash.cell);
      if (best && ringMin * ringMin > bd2) break;
      for (let cz = cz0 - ring; cz <= cz0 + ring; cz++) {
        if (cz < 0 || cz >= roadHash.H) continue;
        const edge = cz === cz0 - ring || cz === cz0 + ring;
        for (let cx = cx0 - ring; cx <= cx0 + ring; cx += edge ? 1 : 2 * ring || 1) {
          if (cx < 0 || cx >= roadHash.W) continue;
          const c = cz * roadHash.W + cx;
          for (let k = roadHash.start[c], e = roadHash.start[c + 1]; k < e; k++) {
            const s = roadHash.items[k];
            const r = roads[segRoad[s]];
            if (ks && !ks.has(r.kind)) continue;
            if (named && !r.name) continue;
            if (!tunnels && r.tunnel) continue;
            if (filter && !filter(r)) continue;
            const p = r.pts, i = segI[s];
            const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az;
            const L2 = dx * dx + dz * dz;
            let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = ax + dx * t, qz = az + dz * t, d2 = (qx - x) ** 2 + (qz - z) ** 2;
            if (d2 < bd2) { bd2 = d2; best = { road: r, x: qx, z: qz, dist: 0, heading: Math.atan2(dx, dz), t, seg: s }; }
          }
        }
      }
    }
    if (best) best.dist = Math.sqrt(bd2);
    return best;
  }

  function streetName(x, z) {
    const r = nearestRoad(x, z, { kinds: 'drive', named: true, maxDist: 45 }) || nearestRoad(x, z, { named: true, maxDist: 35 });
    return r ? r.road.name : '';
  }

  // ---- districts ------------------------------------------------------------------------------------------------
  const districts = GEO.districts;
  const RANKW = [Infinity, 1, 0.85, 0.7, 0.55];
  function districtAt(x, z) {
    let best = '', bd = Infinity;
    for (const d of districts) {
      if (!d.rank) continue; // localities (park gates, rocks…) are labels, not districts
      const s = Math.hypot(d.x - x, d.z - z) * (RANKW[d.rank] || 1);
      if (s < bd) { bd = s; best = d.name; }
    }
    return best;
  }

  // ---- water raster (4 m) ---------------------------------------------------------------------------------------
  const WC = 4, WW = Math.ceil((B.maxX - B.minX) / WC), WH = Math.ceil((B.maxZ - B.minZ) / WC);
  const waterGrid = new Uint8Array(WW * WH);
  {
    for (const w of GEO.water) {
      if (w.kind === 'fountain') continue;
      const rings = [w.pts, ...w.holes];
      let zmin = Infinity, zmax = -Infinity;
      for (const r of rings) for (let i = 1; i < r.length; i += 2) { if (r[i] < zmin) zmin = r[i]; if (r[i] > zmax) zmax = r[i]; }
      const r0 = Math.max(0, Math.floor((zmin - B.minZ) / WC)), r1 = Math.min(WH - 1, Math.ceil((zmax - B.minZ) / WC));
      if (r1 < r0) continue;
      const rows = Array.from({ length: r1 - r0 + 1 }, () => []);
      for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i += 2) {
          const j = (i + 2) % n, x0 = r[i], z0 = r[i + 1], x1 = r[j], z1 = r[j + 1];
          if (z0 === z1) continue;
          const za = Math.min(z0, z1), zb = Math.max(z0, z1);
          for (let row = Math.max(r0, Math.ceil((za - B.minZ) / WC - 0.5)); row <= Math.min(r1, Math.floor((zb - B.minZ) / WC - 0.5)); row++) {
            const zc = B.minZ + (row + 0.5) * WC;
            if (zc >= za && zc < zb) rows[row - r0].push(x0 + ((zc - z0) / (z1 - z0)) * (x1 - x0));
          }
        }
      }
      for (let k = 0; k < rows.length; k++) {
        const xs = rows[k].sort((a, b) => a - b), base = (r0 + k) * WW;
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const c0 = Math.max(0, Math.ceil((xs[i] - B.minX) / WC - 0.5)), c1 = Math.min(WW - 1, Math.floor((xs[i + 1] - B.minX) / WC - 0.5));
          for (let c = c0; c <= c1; c++) waterGrid[base + c] = 1;
        }
      }
    }
  }
  function isWater(x, z) {
    const c = Math.floor((x - B.minX) / WC), r = Math.floor((z - B.minZ) / WC);
    return c >= 0 && r >= 0 && c < WW && r < WH && waterGrid[r * WW + c] === 1;
  }

  // ---- bridge decks ---------------------------------------------------------------------------------------------
  // deck strips: every segment of a road/rail with per-vertex deck heights, half-width incl. pavements
  const ds = [];
  for (const r of roads) {
    if (!r.deck) continue;
    const hw = r.w / 2 + (VEHICLE_KINDS.includes(r.kind) ? 2.5 : 0.6);
    for (let i = 0; i + 3 < r.pts.length; i += 2) ds.push([r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3], r.deck[i / 2], r.deck[i / 2 + 1], hw]);
  }
  for (const r of GEO.rail) {
    if (!r.deck) continue;
    for (let i = 0; i + 3 < r.pts.length; i += 2) ds.push([r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3], r.deck[i / 2], r.deck[i / 2 + 1], 2.4]);
  }
  const deckSeg = Float32Array.from(ds.flat());
  const deckHash = makeHash(B, 16, ds.length, (s, o) => {
    const k = s * 7, hw = deckSeg[k + 6];
    o[0] = Math.min(deckSeg[k], deckSeg[k + 2]) - hw; o[2] = Math.max(deckSeg[k], deckSeg[k + 2]) + hw;
    o[1] = Math.min(deckSeg[k + 1], deckSeg[k + 3]) - hw; o[3] = Math.max(deckSeg[k + 1], deckSeg[k + 3]) + hw;
  });
  const raised = GEO.bridges.filter((b) => b.deckY > 0 && b.axis && !b.synthetic); // synthetic outlines: drawing only
  const bridgeBox = raised.map((b) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < b.pts.length; i += 2) { x0 = Math.min(x0, b.pts[i]); x1 = Math.max(x1, b.pts[i]); z0 = Math.min(z0, b.pts[i + 1]); z1 = Math.max(z1, b.pts[i + 1]); }
    return [x0, z0, x1, z1];
  });
  const bridgeHash = makeHash(B, 64, raised.length, (i, o) => { const bb = bridgeBox[i]; o[0] = bb[0]; o[1] = bb[1]; o[2] = bb[2]; o[3] = bb[3]; });

  /** deck height of any raised bridge at (x, z) (0 if none): the nearest deck strip (the road/track you're on), else
   * the man_made=bridge outline under you */
  function deckHeight(x, z) {
    let h = 0, bd = Infinity;
    let c = deckHash.cellOf(x, z);
    if (c >= 0) {
      for (let k = deckHash.start[c], e = deckHash.start[c + 1]; k < e; k++) {
        const o = deckHash.items[k] * 7;
        const ax = deckSeg[o], az = deckSeg[o + 1], dx = deckSeg[o + 2] - ax, dz = deckSeg[o + 3] - az, hw = deckSeg[o + 6];
        const L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x, ez = az + dz * t - z;
        const d2 = ex * ex + ez * ez;
        if (d2 <= hw * hw && d2 < bd - 1e-6) { bd = d2; h = deckSeg[o + 4] + (deckSeg[o + 5] - deckSeg[o + 4]) * t; }
      }
      if (bd < Infinity) return h;
    }
    c = bridgeHash.cellOf(x, z);
    if (c >= 0) {
      for (let k = bridgeHash.start[c], e = bridgeHash.start[c + 1]; k < e; k++) {
        const i = bridgeHash.items[k], bb = bridgeBox[i];
        if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
        if (!pointInFlat(x, z, raised[i].pts)) continue;
        const y = bridgeDeckAt(raised[i], x, z);
        if (y > h) h = y;
      }
    }
    return h;
  }

  /**
   * ground height: bridge deck on raised bridges, 0 elsewhere. mode 'boat': WATER_LEVEL on water (boats pass under
   * bridges), 0 on land.
   */
  /** Numeric bare-earth elevation from the optional DTM grid (null outside coverage or before the grid is installed). */
  function terrainHeight(x, z) {
    return terrain ? terrain.sample(x, z) : null;
  }

  // Scene-relative ground elevation (Grand-Place datum), with a smooth flat-world edge fallback.
  function terrainSurfaceHeight(x, z) {
    return terrainSurface ? terrainSurface.sample(x, z) : 0;
  }

  function groundHeight(x, z, mode) {
    if (mode === 'boat') return isWater(x, z) ? WATER_LEVEL : 0;
    const deck = deckHeight(x, z);
    return deck > 0 ? deck : terrainSurfaceHeight(x, z);
  }

  // ---- random spawn points ------------------------------------------------------------------------------------
  const cdfCache = new Map();
  function randomRoadPoint(rng = Math.random, opts = {}) {
    const key = JSON.stringify(opts.kinds || 'all') + (opts.tunnels ? 't' : '') + (opts.bridges === false ? 'nb' : '');
    let cdf = cdfCache.get(key);
    if (!cdf) {
      const ks = kindMask(opts.kinds);
      const segs = [], acc = [];
      let tot = 0;
      for (let s = 0; s < nSeg; s++) {
        const r = roads[segRoad[s]];
        if (ks && !ks.has(r.kind)) continue;
        if (!opts.tunnels && r.tunnel) continue;
        if (opts.bridges === false && r.bridge) continue;
        tot += segLen[s]; segs.push(s); acc.push(tot);
      }
      cdf = { segs: Uint32Array.from(segs), acc: Float64Array.from(acc), tot };
      cdfCache.set(key, cdf);
    }
    if (!cdf.segs.length) return null;
    const u = rng() * cdf.tot;
    let lo = 0, hi = cdf.acc.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf.acc[m] < u) lo = m + 1; else hi = m; }
    const s = cdf.segs[lo], r = roads[segRoad[s]], p = r.pts, i = segI[s];
    const t = rng();
    const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
    return { road: r, x: p[i] + dx * t, z: p[i + 1] + dz * t, heading: Math.atan2(dx, dz), t, seg: s, dist: 0 };
  }

  /** on (or right beside) a bridge road's deck? The river is mapped right up to the bridge ends, where the deck
   *  has ramped down to ~0, so a "water" cell there is still bridge, not river. */
  const deckFilter = (r) => !!r.deck || !!r.bridge; // raised decks, and bridges left at grade (e.g. the Westway over the Grand Union Canal)
  function onBridge(x, z, pad = 1.5) {
    // carriageways and footways separately: a narrow cycle track beside the carriageway mustn't hide it
    for (const kinds of ['drive', 'walk']) {
      const n = nearestRoad(x, z, { kinds, maxDist: 14, filter: deckFilter });
      if (n && n.dist <= n.road.w / 2 + pad) return true;
    }
    return false;
  }

  return { groundHeight, terrainHeight, terrainSurfaceHeight, terrainSurface, terrain, deckHeight, isWater, onBridge, nearestRoad, streetName, districtAt, randomRoadPoint, bridgeDeckAt, WATER_LEVEL };
}
