// js/city/buildings.js — London buildings from GEO.buildings: extruded footprints (minHeight -> height) with gabled /
// hipped / mansard roofs fitted to the footprint's street-aligned box, flat roofs with parapets and rooftop plant,
// chimney stacks, party walls dropped, street-facing shop fronts; merged into TILE x TILE m tiles (one masonry +
// roofs geometry and one glass curtain-wall geometry per tile) and one OBB collider per building (split for big
// concave footprints). Pure geometry: materials are attached by js/london-city.js.
import { BUILDING_KINDS, MATERIALS, ROOFS } from '../brx-geodata.js';
import { SURF, STYLE } from './materials-shared.js';
import {
  GeoBuilder, TileBuckets, EdgeHash, hash01, ringArea, ringBox, pointInRing, minAreaRect, obbCollider, clipHalfPlane, triangulate
} from './util.js';

const K = Object.fromEntries(BUILDING_KINDS.map((k, i) => [k, i]));
const M = Object.fromEntries(MATERIALS.map((k, i) => [k, i]));
const RF = Object.fromEntries(ROOFS.map((k, i) => [k, i]));

const PALETTE = {
  [M.london_stock_brick]: [0xb09f7c, 0xa49371, 0x988a6c, 0xbaa985, 0x8f8268, 0xa8946c],
  [M.red_brick]: [0x8e4a38, 0x7f4032, 0x965a44, 0x74402f, 0x8a5240, 0x9b6248],
  [M.portland_stone]: [0xd6d0c0, 0xcdc6b4, 0xdfd9ca, 0xc8c0ac],
  [M.stucco_white]: [0xf1efe9, 0xf4f1ea, 0xeeebe2, 0xf2eee4, 0xe9e8e3, 0xf0ece0],
  [M.glass]: [0x8f9a9e, 0x7f8a8e, 0x9aa3a6],
  [M.concrete]: [0x9a9890, 0xa8a59c, 0x8e8c86, 0xb1aca0],
  [M.sandstone]: [0xc8aa80, 0xbb9d74, 0xcfb38c]
};
const GLASS_TINTS = [0x5b7a8c, 0x6d8a8a, 0x4f6478, 0x7f8c8f, 0x5a6a5e, 0x6a7f99, 0x8a9296];
const SHOP_POIS = new Set(['pub', 'bar', 'cafe', 'restaurant', 'fast_food', 'department_store', 'mall', 'cinema', 'nightclub']);

const ATTRS = { bfu: [2, 'f32'], binfo: [4, 'u8n'], bcol: [4, 'u8n'] };

function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t];
}

/**
 * @param geo GEO, ctx { driveIndex, majorIndex } (RoadIndex of drive / major roads), inRegion (x,z,pad)=>bool
 * @returns { tiles: Map(key -> {masonry: GeoBuilder, glass: GeoBuilder}), colliders, stats }
 */
/**
 * Colliders for one building that follow its footprint and never cover a carriageway.
 * A near-rectangular footprint clear of roads keeps its single min-area OBB. Anything else (L / U shapes, courtyards,
 * OSM outlines drawn over a road or a passage under the building) is rasterised in the OBB's frame and the occupied
 * cells, minus cells on a drivable carriageway, are merged greedily into rectangles (one OBB each).
 * Before this, one OBB per concave building hung over the street and stopped cars on ~2.7 % of road length.
 */
const ROAD_CLEAR = 0.3; // keep building colliders this far beyond the carriageway edge (m)
function pushBuildingColliders(out, ring, o, area, H, minY, roads) {
  const onRoad = roads ? (x, z) => roads.onCarriageway(x, z, null, ROAD_CLEAR) !== null : () => false;
  const toWorld = (lx, lz) => [o.cx + lx * o.cs - lz * o.sn, o.cz + lx * o.sn + lz * o.cs];
  const fill = area / Math.max(1, 4 * o.hx * o.hz);
  if (fill >= 0.9) {
    // probe the box (shrunk 0.5 m) for road on a grid no coarser than 3 m, so a lane crossing it can't slip between
    let hit = false;
    const ex = Math.max(0, o.hx - 0.5), ez = Math.max(0, o.hz - 0.5);
    const na = Math.max(2, Math.ceil((2 * ex) / 3)), nb = Math.max(2, Math.ceil((2 * ez) / 3));
    for (let a = 0; a <= na && !hit; a++) for (let b = 0; b <= nb && !hit; b++) {
      const [x, z] = toWorld(-ex + (2 * ex * a) / na, -ez + (2 * ez * b) / nb);
      if (onRoad(x, z)) hit = true;
    }
    if (!hit) { out.push(obbCollider(o, H, minY)); return; }
  }
  // raster in the OBB frame
  const s = Math.min(4, Math.max(1.25, Math.sqrt(4 * o.hx * o.hz) / 12));
  const nx = Math.max(1, Math.ceil((2 * o.hx) / s)), nz = Math.max(1, Math.ceil((2 * o.hz) / s));
  const sx = (2 * o.hx) / nx, sz = (2 * o.hz) / nz;
  const occ = new Uint8Array(nx * nz);
  let any = 0;
  for (let j = 0; j < nz; j++) {
    const lz = -o.hz + (j + 0.5) * sz;
    for (let i = 0; i < nx; i++) {
      const lx = -o.hx + (i + 0.5) * sx;
      const [x, z] = toWorld(lx, lz);
      if (!pointInRing(x, z, ring) || onRoad(x, z)) continue;
      // the cell's corners too, so a big cell beside a narrow lane doesn't poke into it
      let clear = true;
      for (let c = 0; c < 4 && clear; c++) {
        const [qx, qz] = toWorld(lx + (c & 1 ? 0.5 : -0.5) * sx, lz + (c & 2 ? 0.5 : -0.5) * sz);
        if (onRoad(qx, qz)) clear = false;
      }
      if (clear) { occ[j * nx + i] = 1; any++; }
    }
  }
  if (!any) return; // all of it is over a road (a canopy / passage): drive through
  // greedy rectangles: widest run, then grow down while the rows below are full over that run
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (occ[j * nx + i] !== 1) continue;
      let i1 = i;
      while (i1 + 1 < nx && occ[j * nx + i1 + 1] === 1) i1++;
      let j1 = j;
      grow: while (j1 + 1 < nz) {
        for (let k = i; k <= i1; k++) if (occ[(j1 + 1) * nx + k] !== 1) break grow;
        j1++;
      }
      for (let jj = j; jj <= j1; jj++) for (let k = i; k <= i1; k++) occ[jj * nx + k] = 2;
      const hx = ((i1 - i + 1) * sx) / 2, hz = ((j1 - j + 1) * sz) / 2;
      const [cx, cz] = toWorld(-o.hx + i * sx + hx, -o.hz + j * sz + hz);
      out.push(obbCollider({ cx, cz, hx, hz, cs: o.cs, sn: o.sn }, H, minY));
    }
  }
}

export function buildBuildingGeometry(geo, ctx, inRegion) {
  const { driveIndex, majorIndex, extraZones } = ctx;
  // extra landmark zones (Workstream B's buildLondonLandmarks().zones) on top of GEO's landmark flags
  const zl = (extraZones || []).map((z) => ({ pts: z.pts, box: ringBox(z.pts) }));
  const inZone = zl.length ? (x, z) => zl.some((q) => x >= q.box[0] && x <= q.box[2] && z >= q.box[1] && z <= q.box[3] && pointInRing(x, z, q.pts)) : null;
  const B = geo.buildings;
  const tiles = new TileBuckets(() => ({ masonry: new GeoBuilder(ATTRS), glass: new GeoBuilder(ATTRS) }));
  const colliders = [];
  const stats = { buildings: 0, pitched: 0, chimneys: 0, plant: 0, partyWalls: 0, frontQueries: 0 };

  // ---- pass 1: rings (cleaned, CCW from above), centroids, party-wall edge set -------------------------------------
  const N = B.count;
  const rings = new Array(N);
  const cen = new Float64Array(N * 2);
  const edgeTop = new EdgeHash(B.xz.length / 2 + 16); // directed edge -> the building that owns it
  const keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (B.landmark[i]) continue;
    const s = B.ringStart[i] * 2, e = B.ringStart[i + 1] * 2;
    if (e - s < 6) continue;
    // centroid / region test first (cheap)
    let cx = 0, cz = 0;
    for (let p = s; p < e; p += 2) { cx += B.xz[p]; cz += B.xz[p + 1]; }
    const n = (e - s) / 2;
    cx /= n; cz /= n;
    if (!inRegion(cx, cz)) continue;
    if (inZone && inZone(cx, cz)) continue;
    if (B.height[i] - B.minHeight[i] < 0.4) continue;
    const r = [];
    for (let p = s; p < e; p += 2) {
      const x = B.xz[p], z = B.xz[p + 1];
      const L = r.length;
      if (L >= 2 && Math.abs(r[L - 2] - x) < 0.05 && Math.abs(r[L - 1] - z) < 0.05) continue;
      r.push(x, z);
    }
    if (r.length >= 4 && Math.abs(r[0] - r[r.length - 2]) < 0.05 && Math.abs(r[1] - r[r.length - 1]) < 0.05) r.length -= 2;
    if (r.length < 6) continue;
    let ring = Float64Array.from(r);
    const a = ringArea(ring);
    if (Math.abs(a) < 3) continue;
    if (a > 0) { // make it CCW from above (negative shoelace)
      const rr = new Float64Array(ring.length);
      for (let k = 0, m = ring.length / 2; k < m; k++) { rr[k * 2] = ring[(m - 1 - k) * 2]; rr[k * 2 + 1] = ring[(m - 1 - k) * 2 + 1]; }
      ring = rr;
    }
    rings[i] = ring;
    cen[i * 2] = cx; cen[i * 2 + 1] = cz;
    keep[i] = 1;
    for (let k = 0, m = ring.length; k < m; k += 2) {
      const j = (k + 2) % m;
      edgeTop.set(ring[k], ring[k + 1], ring[j], ring[j + 1], i);
    }
  }

  // POIs that make the building around them a shop / pub
  const poiCells = new Map();
  for (const p of geo.pois) {
    if (!SHOP_POIS.has(p.kind)) continue;
    const k = Math.floor(p.x / 50) + ',' + Math.floor(p.z / 50);
    let l = poiCells.get(k); if (!l) poiCells.set(k, (l = [])); l.push(p);
  }
  const hasShopPoi = (ring, box) => {
    for (let cx = Math.floor(box[0] / 50); cx <= Math.floor(box[2] / 50); cx++) {
      for (let cz = Math.floor(box[1] / 50); cz <= Math.floor(box[3] / 50); cz++) {
        const l = poiCells.get(cx + ',' + cz);
        if (!l) continue;
        for (const p of l) if (p.x >= box[0] && p.x <= box[2] && p.z >= box[1] && p.z <= box[3] && pointInRing(p.x, p.z, ring)) return true;
      }
    }
    return false;
  };

  // GEO.passages (roads through ground-level building footprints, baked by Workstream R): one oriented box per
  // centreline segment, `hw` either side, `h` high. Walls crossing a box get an opening below `h`, and the part of the
  // passage inside the footprint is lined (side walls + soffit), so the road visibly runs under the building.
  const passSegs = [];
  for (const ps of geo.passages || []) {
    const r = geo.roads[ps.road];
    const w = r && r.kind === 'pedestrian' ? Math.min(Math.max(ps.w, 3), 6) : Math.min(ps.w + 0.4, 12);
    const p = ps.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      if (!inRegion((ax + bx) / 2, (az + bz) / 2, L)) continue;
      passSegs.push({ ax, az, bx, bz, L, ux: (bx - ax) / L, uz: (bz - az) / L, hw: w / 2 + 0.3, h: ps.minY,
        box: [Math.min(ax, bx) - w, Math.min(az, bz) - w, Math.max(ax, bx) + w, Math.max(az, bz) + w] });
    }
  }
  const passCells = new Map();
  passSegs.forEach((sg, n) => {
    for (let gx = Math.floor(sg.box[0] / 50); gx <= Math.floor(sg.box[2] / 50); gx++) {
      for (let gz = Math.floor(sg.box[1] / 50); gz <= Math.floor(sg.box[3] / 50); gz++) {
        const k = gx + ',' + gz; let l = passCells.get(k); if (!l) passCells.set(k, (l = [])); l.push(n);
      }
    }
  });
  const passagesFor = (box) => {
    if (!passSegs.length) return null;
    const seen = new Set();
    for (let gx = Math.floor(box[0] / 50); gx <= Math.floor(box[2] / 50); gx++) {
      for (let gz = Math.floor(box[1] / 50); gz <= Math.floor(box[3] / 50); gz++) {
        for (const n of passCells.get(gx + ',' + gz) || []) {
          const b = passSegs[n].box;
          if (b[2] >= box[0] && b[0] <= box[2] && b[3] >= box[1] && b[1] <= box[3]) seen.add(n);
        }
      }
    }
    return seen.size ? [...seen].map((n) => passSegs[n]) : null;
  };
  // parameter range [t0, t1] of the edge (x0,z0)->(x1,z1) inside a passage box (Liang-Barsky), or null
  const clipToPass = (sg, x0, z0, x1, z1) => {
    const s0 = (x0 - sg.ax) * sg.ux + (z0 - sg.az) * sg.uz, s1 = (x1 - sg.ax) * sg.ux + (z1 - sg.az) * sg.uz;
    const q0 = -(x0 - sg.ax) * sg.uz + (z0 - sg.az) * sg.ux, q1 = -(x1 - sg.ax) * sg.uz + (z1 - sg.az) * sg.ux;
    let t0 = 0, t1 = 1;
    for (const [p0, p1, lo, hi] of [[s0, s1, -0.05, sg.L + 0.05], [q0, q1, -sg.hw, sg.hw]]) {
      const d = p1 - p0;
      if (Math.abs(d) < 1e-9) { if (p0 < lo || p0 > hi) return null; continue; }
      let a = (lo - p0) / d, b = (hi - p0) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 >= t1) return null;
    }
    return [t0, t1];
  };
  stats.passages = 0;

  // ---- pass 2: geometry ----------------------------------------------------------------------------------------------
  for (let i = 0; i < N; i++) {
    if (!keep[i]) continue;
    const ring = rings[i];
    const H = B.height[i], base = B.minHeight[i];
    const kind = B.kind[i];
    let mat = B.material[i];
    // Belgravia, Pimlico & Hans Town are white stucco terraces almost street by street; OSM rarely tags the material,
    // so the bake's district default (stock brick) is overridden there for untagged houses / terraces / flats
    // (embassies & offices round the squares are converted houses: stucco too)
    if ((mat === M.london_stock_brick || mat === M.concrete) && !B.colour[i] && B.height[i] < 30 &&
      (kind === K.house || kind === K.terrace || kind === K.flats || kind === K.office || kind === K.other) &&
      stuccoDistrict(cen[i * 2], cen[i * 2 + 1]) && hash01(i * 13 + 5) < 0.85) mat = M.stucco_white;
    const roof = B.roof[i];
    const seed = hash01(i * 7919 + 13);
    const cx = cen[i * 2], cz = cen[i * 2 + 1];
    const area = -ringArea(ring);
    const box = ringBox(ring);
    const obb = minAreaRect(ring);
    stats.buildings++;

    const isGlass = (kind === K.glass_tower || (mat === M.glass && H >= 28)) && !(mat === M.portland_stone && kind !== K.glass_tower);
    // style & bay width
    let style = STYLE.sash, bayW = 2.2 + seed * 0.5;
    if (kind === K.house || kind === K.terrace) {
      style = mat === M.stucco_white && H > 10 ? STYLE.georgian : STYLE.sash;
      bayW = style === STYLE.georgian ? 2.5 + seed * 0.4 : 2.1 + seed * 0.5;
    } else if (kind === K.flats) {
      if (mat === M.concrete || mat === M.glass) { style = STYLE.ribbon; bayW = 3.0; }
      else if (H > 24 && mat !== M.stucco_white) { style = STYLE.office; bayW = 2.8; }
    } else if (kind === K.office || kind === K.civic || kind === K.retail || kind === K.other) {
      style = mat === M.concrete || mat === M.glass ? STYLE.ribbon : STYLE.office;
      bayW = style === STYLE.ribbon ? 3.0 + seed * 0.6 : 2.6 + seed * 0.5;
      if (kind === K.other && H < 7) { style = STYLE.industrial; bayW = 4.2; }
      else if (mat === M.stucco_white && H < 30) { style = H > 10 ? STYLE.georgian : STYLE.sash; bayW = 2.5 + seed * 0.4; }
    } else if (kind === K.church) { style = STYLE.church; bayW = 3.6; }
    else if (kind === K.station || kind === K.industrial) { style = STYLE.industrial; bayW = 4.5; }
    if (base > 2.5 && H - base < 3) style = STYLE.blank; // canopies, bridges between blocks

    // colour
    const pal = PALETTE[mat] || PALETTE[M.london_stock_brick];
    let rgb = mixHex(pal[Math.floor(seed * pal.length) % pal.length], pal[Math.floor(seed * 97) % pal.length], 0.5);
    if (B.colour[i]) {
      const c = B.colour[i];
      const t = 0.55;
      rgb = [rgb[0] + (((c >> 16) & 255) - rgb[0]) * t, rgb[1] + (((c >> 8) & 255) - rgb[1]) * t, rgb[2] + ((c & 255) - rgb[2]) * t];
    }
    // stucco is repainted every few years (Belgravia's leases require it): it stays white, the rest weathers
    const soot = mat === M.stucco_white ? 0.96 + hash01(i * 31 + 7) * 0.06 : 0.86 + hash01(i * 31 + 7) * 0.2;
    rgb = rgb.map((v) => Math.max(0, Math.min(255, v * soot)));
    // roof variant: 0..0.45 felt, ..0.92 gravel, rest green (flat); pitched: < 0.72 slate, else clay tiles
    // roof variant: flat 0..0.45 felt, ..0.975 gravel, rest green; pitched < 0.72 slate, else clay tiles (~15%:
    // mostly red-brick houses — Victorian London is slate)
    const rv = (pitchedClay(kind, mat, i) && area < 400 ? 0.75 + seed * 0.25 : seed * 0.71) * 255; // big blocks: slate

    // shop fronts
    let shop = kind === K.retail;
    if (!shop && !isGlass && H < 60 && (kind === K.terrace || kind === K.flats || kind === K.other || kind === K.office || kind === K.house)) {
      if (hasShopPoi(ring, box)) shop = true;
      else if (kind !== K.house && hash01(i * 3 + 1) < 0.7) {
        if (majorIndex.nearest(cx, cz, Math.sqrt(area) * 0.5 + 10)) shop = true;
      }
    }
    const mansardBand = roof === RF.mansard;

    // ---- roof shape -------------------------------------------------------------------------------------------------
    let pieces = null; // linear roof functions [c0, cs, ct] in the local frame
    let frame = null;
    let eave = H;
    const pitchedTag = roof === RF.gabled || roof === RF.hipped || roof === RF.mansard;
    if (pitchedTag && !isGlass && area < 1800 && H - base > 3.5 && ring.length <= 64) {
      const o = obb;
      // ridge axis: the box axis closest to the street for houses & terraces, else the long axis
      let ax = o.cs, az = o.sn;
      let along = o.hx >= o.hz;
      if (kind === K.house || kind === K.terrace) {
        const r = driveIndex.nearest(cx, cz, 45);
        if (r) {
          const hx = r.dx, hz = r.dz;
          const d1 = Math.abs(hx * o.cs + hz * o.sn), d2 = Math.abs(-hx * o.sn + hz * o.cs);
          if (Math.max(d1, d2) > 0.85) along = d1 >= d2;
        }
      }
      if (!along) { ax = -o.sn; az = o.cs; }
      // local extents in that frame
      let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
      for (let k = 0; k < ring.length; k += 2) {
        const dx = ring[k] - o.cx, dz = ring[k + 1] - o.cz;
        const s = dx * ax + dz * az, t = -dx * az + dz * ax;
        if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
      }
      const hl = (s1 - s0) / 2, hw = (t1 - t0) / 2;
      const fill = area / (4 * hl * hw);
      const fcx = o.cx + ax * (s0 + s1) / 2 - az * (t0 + t1) / 2, fcz = o.cz + az * (s0 + s1) / 2 + ax * (t0 + t1) / 2;
      if (fill > 0.62 && hw > 1.2 && hl > 1.2) {
        frame = { cx: fcx, cz: fcz, ax, az, hl, hw };
        if (roof === RF.mansard) {
          const k = 2.4, mh = Math.min(3.2, (H - base) * 0.35, hw * k * 0.8);
          eave = H - mh;
          pieces = [[eave + k * hw, 0, -k], [eave + k * hw, 0, k], [eave + k * hl, -k, 0], [eave + k * hl, k, 0], [H, 0, 0]];
        } else {
          const roofH = Math.min(hw * 0.7, 5.5, (H - base) * 0.45);
          const k = roofH / hw;
          eave = H - roofH;
          pieces = [[eave + k * hw, 0, -k], [eave + k * hw, 0, k]];
          if (roof === RF.hipped) pieces.push([eave + k * hl, -k, 0], [eave + k * hl, k, 0]);
        }
        stats.pitched++;
      }
    }
    const toLocal = frame ? (x, z) => {
      const dx = x - frame.cx, dz = z - frame.cz;
      return [dx * frame.ax + dz * frame.az, -dx * frame.az + dz * frame.ax];
    } : null;
    const roofAt = pieces ? (x, z) => {
      const [s, t] = toLocal(x, z);
      let h = Infinity;
      for (const p of pieces) { const v = p[0] + p[1] * s + p[2] * t; if (v < h) h = v; }
      return Math.max(eave, Math.min(H, h));
    } : null;

    const flatParapet = !pieces && !isGlass && H - base > 7 && area > 60 && style !== STYLE.blank;
    const roofY = flatParapet ? H - 0.6 : H;

    // ---- walls ------------------------------------------------------------------------------------------------------
    const tile = tiles.get(cx, cz);
    const wb = isGlass ? tile.glass : tile.masonry;
    const mb = tile.masonry;
    const flagsBase = style + (shop ? 8 : 0) + (mansardBand && !pieces ? 32 : 0);
    const matCode = isGlass ? mat : mat;
    const nRing = ring.length / 2;
    const panelW = isGlass ? 1.5 : bayW;
    const windowTop = pieces ? eave : flatParapet ? H - 0.6 : H;
    wb.set('bcol', rgb[0], rgb[1], rgb[2], isGlass ? Math.floor(hash01(i) * 255) : rv);
    // passages through this building (only ground-level buildings tall enough to keep a storey over the opening)
    let pass = base < 0.5 && H > 4.5 ? passagesFor(box) : null;
    if (pass) pass = pass.map((sg) => ({ sg, h: Math.min(sg.h, H - 1.2, pieces ? eave - 0.6 : H - 1.2) })).filter((p) => p.h > 2.4);
    if (pass && !pass.length) pass = null;
    for (let k = 0; k < nRing; k++) {
      const j = (k + 1) % nRing;
      const x0 = ring[k * 2], z0 = ring[k * 2 + 1], x1 = ring[j * 2], z1 = ring[j * 2 + 1];
      const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      const nx = -dz / L, nz = dx / L; // outward for CCW-from-above rings
      // party wall: the neighbour owns the reverse edge
      let blank = L < 1.0;
      let hideBelow = base; // the part of the wall below this height is hidden by the neighbour
      const nb = edgeTop.get(x1, z1, x0, z0);
      if (nb >= 0 && nb !== i) {
        const hn = B.height[nb], bn = B.minHeight[nb];
        if (bn <= base + 0.3) {
          hideBelow = Math.max(base, hn);
          blank = true;
          stats.partyWalls++;
        }
      }
      // street front? (shops / doors) — the nearest drive road is on the outward side within ~20 m
      let front = 0;
      if (!isGlass && !blank && L > 3.2 && H < 45 && H > 4 && (shop || kind === K.house || kind === K.terrace || mat === M.stucco_white)) {
        stats.frontQueries++;
        const mx = (x0 + x1) / 2 + nx * 1.5, mz = (z0 + z1) / 2 + nz * 1.5;
        const r = driveIndex.nearest(mx, mz, 18);
        if (r && (r.x - mx) * nx + (r.z - mz) * nz > -1.0) front = 16;
      }
      // pieces of the edge between roof breakpoints (linear top height on each)
      const ts = [0];
      if (pieces) {
        const [ps, pt] = toLocal(x0, z0), [qs, qt] = toLocal(x1, z1);
        const ev = (p, s, t) => p[0] + p[1] * s + p[2] * t;
        let tau = 0, act = 0, best = Infinity;
        pieces.forEach((p, q) => { const v = ev(p, ps, pt); if (v < best - 1e-9) { best = v; act = q; } });
        for (let guard = 0; guard < 8; guard++) {
          let tn = 1, nk = -1;
          const pa = pieces[act];
          for (let q = 0; q < pieces.length; q++) {
            if (q === act) continue;
            const pq = pieces[q];
            const d0 = ev(pq, ps, pt) - ev(pa, ps, pt);
            const d1 = ev(pq, qs, qt) - ev(pa, qs, qt);
            const dd = d1 - d0;
            if (dd >= -1e-9) continue;
            const tc = -d0 / dd;
            if (tc > tau + 1e-4 && tc < tn - 1e-4) { tn = tc; nk = q; }
          }
          if (nk < 0) break;
          ts.push(tn); tau = tn; act = nk;
        }
      }
      ts.push(1);
      // openings where the wall crosses a passage
      let cuts = null;
      if (pass) {
        for (const p of pass) {
          const c = clipToPass(p.sg, x0, z0, x1, z1);
          if (!c || (c[1] - c[0]) * L < 1.2) continue;
          (cuts || (cuts = [])).push([c[0], c[1], p.h]);
          ts.push(c[0], c[1]);
        }
        if (cuts) { ts.sort((a, b) => a - b); stats.passages++; }
      }
      const nbays = Math.max(1, Math.round(L / panelW));
      const uScale = L >= panelW * 0.75 ? nbays : L / panelW;
      wb.set('binfo', seed * 255, blank ? SURF.blank : SURF.wall, matCode, flagsBase + front);
      for (let q = 0; q + 1 < ts.length; q++) {
        const ta = ts[q], tb = ts[q + 1];
        const ax0 = x0 + dx * ta, az0 = z0 + dz * ta, bx0 = x0 + dx * tb, bz0 = z0 + dz * tb;
        const ha = pieces ? roofAt(ax0, az0) : roofY + (flatParapet ? 0.6 : 0);
        const hb = pieces ? roofAt(bx0, bz0) : roofY + (flatParapet ? 0.6 : 0);
        if (tb - ta < 1e-6) continue;
        let lo = Math.min(hideBelow, Math.min(ha, hb));
        if (cuts) {
          const tm = (ta + tb) / 2;
          for (const c of cuts) if (tm > c[0] && tm < c[1]) lo = Math.max(lo, Math.min(c[2], Math.min(ha, hb) - 0.3));
        }
        if (Math.max(ha, hb) - lo < 0.05) continue;
        wb.set('bfu', 0, windowTop);
        const v0 = wb.v(ax0, lo, az0, nx, 0, nz); wb.attr(v0, 'bfu', ta * uScale, windowTop);
        const v1 = wb.v(bx0, lo, bz0, nx, 0, nz); wb.attr(v1, 'bfu', tb * uScale, windowTop);
        const v2 = wb.v(bx0, Math.max(hb, lo), bz0, nx, 0, nz); wb.attr(v2, 'bfu', tb * uScale, windowTop);
        const v3 = wb.v(ax0, Math.max(ha, lo), az0, nx, 0, nz); wb.attr(v3, 'bfu', ta * uScale, windowTop);
        wb.quad(v0, v1, v2, v3);
      }
      // inner face of the parapet
      if (flatParapet && !blank) {
        mb.set('binfo', seed * 255, SURF.parapet, mat, flagsBase);
        mb.set('bcol', rgb[0], rgb[1], rgb[2], rv);
        mb.set('bfu', 0, H + 5);
        const a = mb.v(x0, H - 0.6, z0, -nx, 0, -nz), b = mb.v(x1, H - 0.6, z1, -nx, 0, -nz);
        const c = mb.v(x1, H, z1, -nx, 0, -nz), d = mb.v(x0, H, z0, -nx, 0, -nz);
        mb.quad(b, a, d, c);
      }
    }

    // ---- passage linings: side walls and a soffit along the part of each passage inside the footprint --------------
    if (pass) {
      for (const { sg, h } of pass) {
        // parameters along the centreline where it crosses the footprint, then the inside intervals
        const tsL = [0, 1];
        for (let k = 0; k < nRing; k++) {
          const j = (k + 1) % nRing;
          const ex = ring[j * 2] - ring[k * 2], ez = ring[j * 2 + 1] - ring[k * 2 + 1];
          const den = (sg.bx - sg.ax) * ez - (sg.bz - sg.az) * ex;
          if (Math.abs(den) < 1e-9) continue;
          const wx = ring[k * 2] - sg.ax, wz = ring[k * 2 + 1] - sg.az;
          const t = (wx * ez - wz * ex) / den, uu = (wx * (sg.bz - sg.az) - wz * (sg.bx - sg.ax)) / den;
          if (t > 0 && t < 1 && uu >= 0 && uu <= 1) tsL.push(t);
        }
        tsL.sort((a, b) => a - b);
        for (let q = 0; q + 1 < tsL.length; q++) {
          const ta = tsL[q], tb = tsL[q + 1];
          if ((tb - ta) * sg.L < 0.3) continue;
          const tm = (ta + tb) / 2;
          if (!pointInRing(sg.ax + (sg.bx - sg.ax) * tm, sg.az + (sg.bz - sg.az) * tm, ring)) continue;
          const ax = sg.ax + (sg.bx - sg.ax) * ta, az = sg.az + (sg.bz - sg.az) * ta;
          const bx = sg.ax + (sg.bx - sg.ax) * tb, bz = sg.az + (sg.bz - sg.az) * tb;
          const lx = -sg.uz * sg.hw, lz = sg.ux * sg.hw; // to the left side
          mb.set('binfo', seed * 255, SURF.blank, mat, flagsBase);
          mb.set('bcol', rgb[0], rgb[1], rgb[2], rv);
          mb.set('bfu', 0, H + 5);
          // left wall faces right (-l), right wall faces left (+l)
          const nlx = -lx / sg.hw, nlz = -lz / sg.hw;
          let v0 = mb.v(bx + lx, 0, bz + lz, nlx, 0, nlz), v1 = mb.v(ax + lx, 0, az + lz, nlx, 0, nlz);
          let v2 = mb.v(ax + lx, h, az + lz, nlx, 0, nlz), v3 = mb.v(bx + lx, h, bz + lz, nlx, 0, nlz);
          mb.quad(v0, v1, v2, v3);
          v0 = mb.v(ax - lx, 0, az - lz, -nlx, 0, -nlz); v1 = mb.v(bx - lx, 0, bz - lz, -nlx, 0, -nlz);
          v2 = mb.v(bx - lx, h, bz - lz, -nlx, 0, -nlz); v3 = mb.v(ax - lx, h, az - lz, -nlx, 0, -nlz);
          mb.quad(v0, v1, v2, v3);
          // soffit (facing down)
          mb.set('binfo', seed * 255, SURF.plant, mat, flagsBase);
          const c0 = mb.v(ax + lx, h, az + lz, 0, -1, 0), c1 = mb.v(bx + lx, h, bz + lz, 0, -1, 0);
          const c2 = mb.v(bx - lx, h, bz - lz, 0, -1, 0), c3 = mb.v(ax - lx, h, az - lz, 0, -1, 0);
          addUpTri(mb, c0, c1, c2, true); addUpTri(mb, c0, c2, c3, true);
        }
      }
    }

    // ---- roof surfaces ----------------------------------------------------------------------------------------------
    mb.set('bcol', rgb[0], rgb[1], rgb[2], rv);
    if (!pieces) {
      const tris = triangulate(ring);
      mb.set('binfo', seed * 255, SURF.flatRoof, mat, flagsBase);
      mb.set('bfu', 0, H + 5);
      const o = mb.n;
      for (let k = 0; k < nRing; k++) mb.v(ring[k * 2], roofY, ring[k * 2 + 1], 0, 1, 0);
      for (const t of tris) addUpTri(mb, o + t[0], o + t[1], o + t[2]);
      // underside of raised parts (canopies, bridges between blocks)
      if (base > 2.5) {
        const o2 = mb.n;
        mb.set('binfo', seed * 255, SURF.plant, mat, flagsBase);
        for (let k = 0; k < nRing; k++) mb.v(ring[k * 2], base, ring[k * 2 + 1], 0, -1, 0);
        for (const t of tris) addUpTri(mb, o2 + t[0], o2 + t[1], o2 + t[2], true);
      }
      // rooftop plant on big flat roofs
      if (area > 450 && H > 14 && style !== STYLE.blank) {
        const o = obb;
        const n = Math.min(4, 1 + Math.floor(area / 1400));
        for (let p = 0; p < n; p++) {
          const r1 = hash01(i * 17 + p * 3), r2 = hash01(i * 23 + p * 5), r3 = hash01(i * 29 + p * 7);
          const sx = o.hx * (0.12 + r1 * 0.22), sz = o.hz * (0.12 + r2 * 0.22);
          const px = (r2 - 0.5) * 1.2 * (o.hx - sx), pz = (r3 - 0.5) * 1.2 * (o.hz - sz);
          const wx = o.cx + px * o.cs - pz * o.sn, wz = o.cz + px * o.sn + pz * o.cs;
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [wx + a * sx * o.cs - b * sz * o.sn, wz + a * sx * o.sn + b * sz * o.cs]);
          if (!corners.every(([x, z]) => pointInRing(x, z, ring))) continue;
          mb.set('binfo', seed * 255, SURF.plant, mat, flagsBase);
          addBox(mb, corners, roofY, roofY + 2 + r1 * 2.5);
          stats.plant++;
        }
      }
      // smaller roofs: a stair / lift housing, a water tank or an AC condenser or two (from the air a bare flat roof
      // reads as an unfinished box)
      if (area > 90 && H > 8 && style !== STYLE.blank && hash01(i * 53 + 11) < 0.72) {
        const o = obb;
        const n = area > 450 ? 2 : 1 + (hash01(i * 59) < 0.4 ? 1 : 0);
        for (let p = 0; p < n; p++) {
          const r1 = hash01(i * 61 + p * 7), r2 = hash01(i * 67 + p * 11), r3 = hash01(i * 71 + p * 13);
          const sx = Math.min(o.hx * 0.4, 0.6 + r1 * 1.4), sz = Math.min(o.hz * 0.4, 0.6 + r2 * 1.2);
          const px = (r2 - 0.5) * 1.4 * (o.hx - sx - 0.8), pz = (r3 - 0.5) * 1.4 * (o.hz - sz - 0.8);
          const wx = o.cx + px * o.cs - pz * o.sn, wz = o.cz + px * o.sn + pz * o.cs;
          const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [wx + a * sx * o.cs - b * sz * o.sn, wz + a * sx * o.sn + b * sz * o.cs]);
          if (!corners.every(([x, z]) => pointInRing(x, z, ring))) continue;
          mb.set('binfo', seed * 255, SURF.plant, mat, flagsBase);
          addBox(mb, corners, roofY, roofY + 0.9 + r1 * (p === 0 ? 2.0 : 0.6));
          stats.plant++;
        }
      }
    } else {
      mb.set('binfo', seed * 255, SURF.pitched, mat, flagsBase);
      for (let q = 0; q < pieces.length; q++) {
        const pq = pieces[q];
        // region where piece q is the lowest: pq <= pj for all j  <=>  (pj - pq) >= 0
        let loc = new Array(ring.length);
        for (let k = 0; k < ring.length; k += 2) { const [s, t] = toLocal(ring[k], ring[k + 1]); loc[k] = s; loc[k + 1] = t; }
        for (let j = 0; j < pieces.length && loc.length >= 6; j++) {
          if (j === q) continue;
          const pj = pieces[j];
          loc = clipHalfPlane(loc, pj[1] - pq[1], pj[2] - pq[2], pj[0] - pq[0]);
        }
        if (loc.length < 6) continue;
        const tris = triangulate(loc);
        if (!tris.length) continue;
        // plane normal: y = c0 + cs*s + ct*t ; d/dx = cs*ax - ct*az ; d/dz = cs*az + ct*ax
        const gx = pq[1] * frame.ax - pq[2] * frame.az, gz = pq[1] * frame.az + pq[2] * frame.ax;
        const nl = Math.hypot(gx, 1, gz);
        const o = mb.n;
        for (let k = 0; k < loc.length; k += 2) {
          const s = loc[k], t = loc[k + 1];
          const x = frame.cx + s * frame.ax - t * frame.az, z = frame.cz + s * frame.az + t * frame.ax;
          const y = Math.max(eave, Math.min(H, pq[0] + pq[1] * s + pq[2] * t));
          const v = mb.v(x, y, z, -gx / nl, 1 / nl, -gz / nl);
          mb.attr(v, 'bfu', s, eave);
        }
        for (const t of tris) addUpTri(mb, o + t[0], o + t[1], o + t[2]);
      }
      // chimney stacks on terraced houses (on the ridge, near one end)
      if ((kind === K.terrace || kind === K.house) && roof !== RF.mansard && hash01(i * 41 + 3) < 0.75 && frame.hl > 2.5) {
        const end = hash01(i * 43) < 0.5 ? -1 : 1;
        const s = end * (frame.hl - 0.6), cw = 0.45, cd = Math.min(0.9, frame.hw * 0.35);
        const corners = [[s - cw, -cd], [s + cw, -cd], [s + cw, cd], [s - cw, cd]].map(([a, b]) => [frame.cx + a * frame.ax - b * frame.az, frame.cz + a * frame.az + b * frame.ax]);
        if (corners.every(([x, z]) => pointInRing(x, z, ring))) {
          const lo = Math.min(...corners.map(([x, z]) => roofAt(x, z))) - 0.2;
          mb.set('binfo', seed * 255, SURF.chimney, M.london_stock_brick, flagsBase);
          mb.set('bfu', 0, H + 1.0);
          addBox(mb, corners, lo, H + 1.2);
          stats.chimneys++;
        }
      }
    }

    // ---- colliders --------------------------------------------------------------------------------------------------
    const minY = base > 2.5 ? base : 0;
    pushBuildingColliders(colliders, ring, obb, area, H, minY, ctx.carriageIndex);
  }
  return { tiles: tiles.map, colliders, stats };
}

// the stucco quarters (rough ellipses round their centres, world metres): Belgravia, Pimlico, Hans Town / Knightsbridge
const STUCCO_AREAS = [[-1770, 1060, 620, 480], [-760, 2050, 620, 430], [-2290, 1110, 300, 260], [-3300, 1250, 420, 300]];
function stuccoDistrict(x, z) {
  for (const [cx, cz, rx, rz] of STUCCO_AREAS) { const dx = (x - cx) / rx, dz = (z - cz) / rz; if (dx * dx + dz * dz < 1) return true; }
  return false;
}

function pitchedClay(kind, mat, i) {
  const h = hash01(i * 101 + 9);
  return (mat === M.red_brick && h < 0.4) || ((kind === K.house) && h < 0.12);
}

/** add a triangle with an upward (or downward) facing winding */
function addUpTri(b, i0, i1, i2, down = false) {
  const p = b.pos;
  const ax = p[i0 * 3], az = p[i0 * 3 + 2];
  const ny = (p[i1 * 3 + 2] - az) * (p[i2 * 3] - ax) - (p[i1 * 3] - ax) * (p[i2 * 3 + 2] - az);
  if ((ny >= 0) !== down) b.tri(i0, i1, i2);
  else b.tri(i0, i2, i1);
}

/** closed box (no bottom) over 4 ground corners (CCW or CW) from y0 to y1 */
export function addBox(b, corners, y0, y1) {
  // order corners CCW from above (negative shoelace)
  let a = 0;
  for (let k = 0; k < 4; k++) { const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4]; a += x0 * z1 - x1 * z0; }
  const c = a > 0 ? [...corners].reverse() : corners;
  for (let k = 0; k < 4; k++) {
    const [x0, z0] = c[k], [x1, z1] = c[(k + 1) % 4];
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L;
    const v0 = b.v(x0, y0, z0, nx, 0, nz), v1 = b.v(x1, y0, z1, nx, 0, nz), v2 = b.v(x1, y1, z1, nx, 0, nz), v3 = b.v(x0, y1, z0, nx, 0, nz);
    b.attr(v0, 'bfu', 0, y1); b.attr(v1, 'bfu', L, y1); b.attr(v2, 'bfu', L, y1); b.attr(v3, 'bfu', 0, y1);
    b.quad(v0, v1, v2, v3);
  }
  const t = c.map(([x, z]) => b.v(x, y1, z, 0, 1, 0));
  addUpTri(b, t[0], t[1], t[2]);
  addUpTri(b, t[0], t[2], t[3]);
}

/**
 * "The rest of London" beyond the play area: plain blocks (brick / stucco / stone, flat roofs) on a jittered 80 m grid in
 * a `band` m wide ring outside the bounds, skipping the Thames where it flows out (sdf: buildWaterSDF result, which
 * clamps at the bounds). Drawn with the masonry material into `tiles` (same TileBuckets map as the city).
 */
export function buildFillerGeometry(bounds, sdf, inRegion, tilesMap, band = 1500) {
  const tiles = new TileBuckets(() => ({ masonry: new GeoBuilder(ATTRS), glass: new GeoBuilder(ATTRS) }));
  tiles.map = tilesMap;
  tiles.key = (x, z) => 'far' + Math.floor(x / 2000) + ',' + Math.floor(z / 2000); // far away: big chunks
  const C = 80;
  const water = (x, z) => {
    const cx = Math.min(sdf.W - 1, Math.max(0, Math.floor((x - sdf.minX) / (sdf.sizeX / sdf.W))));
    const cz = Math.min(sdf.H - 1, Math.max(0, Math.floor((z - sdf.minZ) / (sdf.sizeZ / sdf.H))));
    return sdf.data[cz * sdf.W + cx] < 150; // within ~3 m of water or wet
  };
  let n = 0;
  const mats = [M.london_stock_brick, M.london_stock_brick, M.red_brick, M.stucco_white, M.portland_stone, M.concrete];
  for (let x = bounds.minX - band; x < bounds.maxX + band; x += C) {
    for (let z = bounds.minZ - band; z < bounds.maxZ + band; z += C) {
      if (x > bounds.minX - C && x < bounds.maxX && z > bounds.minZ - C && z < bounds.maxZ) continue;
      if (!inRegion(x + C / 2, z + C / 2, C)) continue;
      const i = Math.round(x) * 7919 + Math.round(z) * 104729;
      const out = Math.max(bounds.minX - x, x - bounds.maxX, bounds.minZ - z, z - bounds.maxZ, 0);
      const k = 1 + Math.floor(hash01(i) * 3);
      for (let q = 0; q < k; q++) {
        const r1 = hash01(i + q * 11 + 1), r2 = hash01(i + q * 11 + 2), r3 = hash01(i + q * 11 + 3), r4 = hash01(i + q * 11 + 4);
        const w = 14 + r1 * 30, d = 10 + r2 * 16, cx = x + 8 + r3 * (C - 16), cz = z + 8 + r4 * (C - 16);
        if (water(cx, cz) || water(cx - w / 2, cz - d / 2) || water(cx + w / 2, cz + d / 2)) continue;
        const h = 7 + hash01(i + q * 13) * (out < 400 ? 16 : 10) + (hash01(i + q * 17) < 0.04 ? 30 : 0);
        const mat = mats[Math.floor(hash01(i + q * 19) * mats.length)];
        const pal = PALETTE[mat];
        const rgb = mixHex(pal[q % pal.length], pal[(q + 1) % pal.length], r1);
        const b = tiles.get(cx, cz).masonry;
        const seed = hash01(i + q) * 255;
        const corners = [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
        b.set('bcol', rgb[0], rgb[1], rgb[2], r2 * 160);
        b.set('binfo', seed, SURF.wall, mat, mat === M.concrete ? STYLE.ribbon : STYLE.sash);
        // walls with whole bays (u in bays), flat roof
        let a = 0;
        for (let e = 0; e < 4; e++) { const [x0, z0] = corners[e], [x1, z1] = corners[(e + 1) % 4]; a += x0 * z1 - x1 * z0; }
        const c = a > 0 ? corners.slice().reverse() : corners;
        for (let e = 0; e < 4; e++) {
          const [x0, z0] = c[e], [x1, z1] = c[(e + 1) % 4];
          const L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L, nz = (x1 - x0) / L, nb = Math.max(1, Math.round(L / 2.6));
          const v0 = b.v(x0, 0, z0, nx, 0, nz), v1 = b.v(x1, 0, z1, nx, 0, nz), v2 = b.v(x1, h, z1, nx, 0, nz), v3 = b.v(x0, h, z0, nx, 0, nz);
          b.attr(v0, 'bfu', 0, h); b.attr(v1, 'bfu', nb, h); b.attr(v2, 'bfu', nb, h); b.attr(v3, 'bfu', 0, h);
          b.quad(v0, v1, v2, v3);
        }
        b.set('binfo', seed, SURF.flatRoof, mat, 0);
        b.set('bfu', 0, h + 5);
        const t = c.map(([px, pz]) => b.v(px, h, pz, 0, 1, 0));
        addUpTri(b, t[0], t[1], t[2]); addUpTri(b, t[0], t[2], t[3]);
        n++;
      }
    }
  }
  return n;
}
