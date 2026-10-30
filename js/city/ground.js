// js/city/ground.js — the ground of London: base ground plane (to well beyond the play area), the Thames / lakes /
// canals / docks at y = WATER_LEVEL with stone embankment walls and the Thames parapet, parks & gardens, plazas, and
// the water signed-distance texture the ground & grass shaders use to cut themselves away over water.
// Flat layers are merged into FLAT_TILE chunks (they don't cast shadows, so few big meshes are cheapest).
import { GeoBuilder, TileBuckets, ringArea, ringBox, triangulate, clipRect } from './util.js';
import { subdivideTerrainTriangle } from '../brussels-terrain.js';

export const FLAT_TILE = 2000;
export const WATER_Y = -1.2;
function terrainNormal(surface, x, z) {
  if (!surface) return [0, 1, 0];
  const step = 5;
  const left = surface.sample(x - step, z) ?? 0, right = surface.sample(x + step, z) ?? 0;
  const back = surface.sample(x, z - step) ?? 0, front = surface.sample(x, z + step) ?? 0;
  const dx = (right - left) / (2 * step), dz = (front - back) / (2 * step);
  const length = Math.hypot(dx, 1, dz);
  return [-dx / length, 1 / length, -dz / length];
}

// y layers of the flat surfaces (carriageways sit at 0; see roads.js)
export const LAYER = { ground: -0.06, park: -0.035, parkSmall: -0.03, pitch: -0.026, plaza: -0.02, footway: -0.012 };

const WATER_COL = { river: [74, 78, 62], lake: [48, 70, 58], canal: [52, 62, 48], dock: [58, 70, 74], fountain: [80, 110, 120] };
const PARK_COL = {
  park: [[86, 118, 52], 0], garden: [[80, 112, 50], 0], grass: [[92, 122, 56], 0], pitch: [[74, 120, 50], 0.3],
  wood: [[60, 84, 40], 0.6], cemetery: [[78, 98, 52], 0], square: [[84, 114, 54], 0], playground: [[120, 70, 50], 0.9]
};

export class FlatBuckets extends TileBuckets {
  key(x, z) { return Math.floor(x / FLAT_TILE) + ',' + Math.floor(z / FLAT_TILE); }
}

/** add a flat polygon (outer + holes) at height y to a builder, triangles facing up */
export function addFlatPolygon(b, outer, holes, y, terrainSurface = null, maxStep = 50) {
  const tris = triangulate(outer, holes);
  if (!tris.length) return 0;
  const all = [outer, ...holes];
  if (terrainSurface) {
    // Subdivide every source triangle on a shared, polygon-wide lattice so adjacent triangles
    // have identical edge samples and parks/plazas follow the same terrain as the base mesh.
    const flat = [];
    for (const ring of all) for (let i = 0; i < ring.length; i += 2) flat.push(ring[i], ring[i + 1]);
    const [x0, z0, x1, z1] = ringBox(outer);
    const steps = Math.max(1, Math.ceil(Math.max(x1 - x0, z1 - z0) / maxStep));
    let count = 0;
    for (const tri of tris) {
      const p0 = [flat[tri[0] * 2], flat[tri[0] * 2 + 1]];
      const p1 = [flat[tri[1] * 2], flat[tri[1] * 2 + 1]];
      const p2 = [flat[tri[2] * 2], flat[tri[2] * 2 + 1]];
      const mesh = subdivideTerrainTriangle(p0, p1, p2, maxStep, steps);
      const offset = b.n;
      for (const [x, z] of mesh.vertices) b.v(x, y + (terrainSurface.sample(x, z) ?? 0), z, ...terrainNormal(terrainSurface, x, z));
      for (const t of mesh.triangles) b.tri(offset + t[0], offset + t[1], offset + t[2]);
      count += mesh.triangles.length;
    }
    return count;
  }
  const o = b.n;
  for (const r of all) for (let i = 0; i < r.length; i += 2) b.v(r[i], y, r[i + 1], 0, 1, 0);
  const P = b.pos;
  for (const t of tris) {
    const i0 = o + t[0], i1 = o + t[1], i2 = o + t[2];
    const ax = P[i0 * 3], az = P[i0 * 3 + 2];
    const ny = (P[i1 * 3 + 2] - az) * (P[i2 * 3] - ax) - (P[i1 * 3] - ax) * (P[i2 * 3 + 2] - az);
    if (ny >= 0) b.tri(i0, i1, i2); else b.tri(i0, i2, i1);
  }
  return tris.length;
}

/** add a flat polygon split into FLAT_TILE chunks (big parks / the Thames) */
function addTiledPolygon(buckets, outer, holes, y, setup, terrainSurface = null) {
  const [x0, z0, x1, z1] = ringBox(outer);
  const T = FLAT_TILE;
  for (let tx = Math.floor(x0 / T); tx <= Math.floor(x1 / T); tx++) {
    for (let tz = Math.floor(z0 / T); tz <= Math.floor(z1 / T); tz++) {
      const rx0 = tx * T, rz0 = tz * T, rx1 = rx0 + T, rz1 = rz0 + T;
      const inside = x0 >= rx0 && x1 <= rx1 && z0 >= rz0 && z1 <= rz1;
      const o = inside ? outer : clipRect(outer, rx0, rz0, rx1, rz1);
      if (o.length < 6) continue;
      // holes: keep the ones whose box overlaps the tile, clipped too (a hole cut by the tile edge becomes a notch
      // of the clipped outer only approximately: fine for piers / islands)
      const hs = [];
      for (const h of holes) {
        const [a, b, c, d] = ringBox(h);
        if (c < rx0 || a > rx1 || d < rz0 || b > rz1) continue;
        if (a >= rx0 && c <= rx1 && b >= rz0 && d <= rz1) hs.push(h);
      }
      const b = buckets.get(rx0 + 1, rz0 + 1);
      setup(b);
      addFlatPolygon(b, o, hs, y, terrainSurface);
    }
  }
}

/**
 * Water signed-distance texture data (metres to the nearest water edge, > 0 on land), sampled every `res` m over
 * [minX, minX + W*res] x [minZ, …]: Uint8 0..255 = −range..+range.
 */
export function buildWaterSDF(geo, world, bounds, res = 4, range = 16) {
  // no margin: beyond the bounds the texture clamps, so the river keeps flowing straight out of the play area
  const margin = 0;
  const minX = bounds.minX - margin, minZ = bounds.minZ - margin;
  const W = Math.ceil((bounds.maxX - bounds.minX + 2 * margin) / res), H = Math.ceil((bounds.maxZ - bounds.minZ + 2 * margin) / res);
  const dist = new Float32Array(W * H).fill(range);
  const R = Math.ceil(range / res) + 1;
  for (const w of geo.water) {
    if (w.kind === 'fountain') continue;
    for (const r of [w.pts, ...w.holes]) {
      for (let i = 0, n = r.length; i < n; i += 2) {
        const j = (i + 2) % n;
        const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - minX) / res) - R), c1 = Math.min(W - 1, Math.floor((Math.max(ax, bx) - minX) / res) + R);
        const r0 = Math.max(0, Math.floor((Math.min(az, bz) - minZ) / res) - R), r1 = Math.min(H - 1, Math.floor((Math.max(az, bz) - minZ) / res) + R);
        for (let rr = r0; rr <= r1; rr++) {
          const z = minZ + (rr + 0.5) * res;
          for (let cc = c0; cc <= c1; cc++) {
            const x = minX + (cc + 0.5) * res;
            let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = ax + dx * t - x, ez = az + dz * t - z;
            const d = Math.sqrt(ex * ex + ez * ez);
            const k = rr * W + cc;
            if (d < dist[k]) dist[k] = d;
          }
        }
      }
    }
  }
  // sign: scanline even-odd fill of every water polygon (outer + holes) at the texel centres, OR-ed together
  const wet = new Uint8Array(W * H);
  for (const w of geo.water) {
    if (w.kind === 'fountain') continue;
    const rings = [w.pts, ...w.holes];
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 1; i < w.pts.length; i += 2) { if (w.pts[i] < zmin) zmin = w.pts[i]; if (w.pts[i] > zmax) zmax = w.pts[i]; }
    const r0 = Math.max(0, Math.ceil((zmin - minZ) / res - 0.5)), r1 = Math.min(H - 1, Math.floor((zmax - minZ) / res - 0.5));
    if (r1 < r0) continue;
    const rows = Array.from({ length: r1 - r0 + 1 }, () => []);
    for (const r of rings) {
      for (let i = 0, n = r.length; i < n; i += 2) {
        const j = (i + 2) % n, x0 = r[i], z0 = r[i + 1], x1 = r[j], z1 = r[j + 1];
        if (z0 === z1) continue;
        const za = Math.min(z0, z1), zb = Math.max(z0, z1);
        for (let row = Math.max(r0, Math.ceil((za - minZ) / res - 0.5)); row <= Math.min(r1, Math.floor((zb - minZ) / res - 0.5)); row++) {
          const zc = minZ + (row + 0.5) * res;
          if (zc >= za && zc < zb) rows[row - r0].push(x0 + ((zc - z0) / (z1 - z0)) * (x1 - x0));
        }
      }
    }
    for (let k = 0; k < rows.length; k++) {
      const xs = rows[k].sort((p, q) => p - q), base = (r0 + k) * W;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(0, Math.ceil((xs[i] - minX) / res - 0.5)), c1 = Math.min(W - 1, Math.floor((xs[i + 1] - minX) / res - 0.5));
        for (let c = c0; c <= c1; c++) wet[base + c] = 1;
      }
    }
  }
  const data = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const s = wet[k] ? -dist[k] : dist[k];
    data[k] = Math.max(0, Math.min(255, Math.round(127.5 + (s / range) * 127.5)));
  }
  return { data, W, H, minX, minZ, sizeX: W * res, sizeZ: H * res, range };
}
/**
 * Street-frontage mask over the world bounds (same grid layout as buildWaterSDF): 255 within `near` m of a street's
 * carriageway edge, fading to 0 at `far` m. The ground shader paves those strips (forecourts, building lines, areas
 * between the pavement and the facades) instead of showing the yards / gardens mix that belongs inside the blocks.
 */
const FRONT_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian', 'service']);
export function buildStreetMask(geo, bounds, res = 4, near = 9, far = 15) {
  const minX = bounds.minX, minZ = bounds.minZ;
  const W = Math.ceil((bounds.maxX - bounds.minX) / res), H = Math.ceil((bounds.maxZ - bounds.minZ) / res);
  const data = new Uint8Array(W * H);
  for (const r of geo.roads) {
    if (r.tunnel || !FRONT_KINDS.has(r.kind)) continue;
    const pts = r.pts, hw = (r.w || 6) / 2 + (r.kind === 'service' ? -4 : 0);
    const n0 = hw + near, n1 = hw + far;
    if (n1 <= 0) continue;
    const R = Math.ceil(n1 / res) + 1;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - minX) / res) - R), c1 = Math.min(W - 1, Math.floor((Math.max(ax, bx) - minX) / res) + R);
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - minZ) / res) - R), r1 = Math.min(H - 1, Math.floor((Math.max(az, bz) - minZ) / res) + R);
      for (let rr = r0; rr <= r1; rr++) {
        const z = minZ + (rr + 0.5) * res;
        for (let cc = c0; cc <= c1; cc++) {
          const x = minX + (cc + 0.5) * res;
          let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + dx * t - x, ez = az + dz * t - z;
          const d = Math.sqrt(ex * ex + ez * ez);
          if (d >= n1) continue;
          const v = d <= n0 ? 255 : Math.round(255 * (n1 - d) / (n1 - n0));
          const k = rr * W + cc;
          if (v > data[k]) data[k] = v;
        }
      }
    }
  }
  return { data, W, H, minX, minZ, sizeX: W * res, sizeZ: H * res };
}

/**
 * @returns { water: Map, walls: Map(500 m tiles), grass: Map, plaza: Map, ground: GeoBuilder, lampSites: [{x,z,nx,nz}] }
 */
export function buildGroundGeometry(geo, inRegion, bounds, terrainSurface = null) {
  const SC = { scol: [4, 'u8n'] };
  const water = new FlatBuckets(() => new GeoBuilder(SC));
  const walls = new FlatBuckets(() => new GeoBuilder(SC));
  const grass = new FlatBuckets(() => new GeoBuilder(SC));
  const plaza = new FlatBuckets(() => new GeoBuilder({ scol: [4, 'u8n'], uv: [2, 'f32'] }));
  const lampSites = [];
  const stats = { water: 0, parks: 0, plazas: 0, wallM: 0, terrainVertices: 0, terrainCells: 0 };

  // ---- water + embankments -------------------------------------------------------------------------------------------
  for (const w of geo.water) {
    if (w.kind === 'fountain') continue;
    const [x0, z0, x1, z1] = ringBox(w.pts);
    if (!inRegion((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2)) continue;
    stats.water++;
    const col = WATER_COL[w.kind] || WATER_COL.lake;
    addTiledPolygon(water, w.pts, w.holes, WATER_Y, (b) => b.set('scol', ...col, 0));
    const river = w.kind === 'river' || w.kind === 'dock';
    const stone = river ? [150, 146, 134] : [118, 116, 100];
    const rings = [[w.pts, false], ...w.holes.map((h) => [h, true])];
    for (const [r, isHole] of rings) {
      const a = ringArea(r);
      // water side normal: (dz,-dx) for a CCW outer / CW hole, flipped otherwise
      const flip = isHole ? a < 0 : a > 0;
      for (let i = 0, n = r.length; i < n; i += 2) {
        const j = (i + 2) % n;
        const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
        if (!inRegion((ax + bx) / 2, (az + bz) / 2)) continue;
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        let nx = dz / L, nz = -dx / L;
        if (flip) { nx = -nx; nz = -nz; }
        // skip edges that run along the bounds clip (straight cuts of the polygon at the play-area edge)
        if (Math.abs(ax - bx) < 0.01 && (Math.abs(ax - bounds.minX - 0) < 40 || Math.abs(ax - bounds.maxX) < 40)) continue;
        if (Math.abs(az - bz) < 0.01 && (Math.abs(az - bounds.minZ) < 40 || Math.abs(az - bounds.maxZ) < 40)) continue;
        const b = walls.get((ax + bx) / 2, (az + bz) / 2);
        b.set('scol', ...stone, 0);
        const top = 0.0, bot = WATER_Y - 2.5;
        // face toward the water: quad order (a,b) faces (-dz,dx)/L; we want (nx,nz)
        const faceAB = (-dz / L) * nx + (dx / L) * nz > 0;
        const [px, pz, qx, qz] = faceAB ? [ax, az, bx, bz] : [bx, bz, ax, az];
        const v0 = b.v(px, bot, pz, nx, 0, nz), v1 = b.v(qx, bot, qz, nx, 0, nz), v2 = b.v(qx, top, qz, nx, 0, nz), v3 = b.v(px, top, pz, nx, 0, nz);
        b.quad(v0, v1, v2, v3);
        stats.wallM += L;
        if (w.kind === 'river' && !isHole) {
          // granite parapet (0.9 m) on the Thames embankments, 0.45 m thick, set back from the edge
          const ph = 0.9, th = 0.45;
          const ix = -nx * th, iz = -nz * th; // toward the land
          b.set('scol', 170, 165, 150, 0);
          const t0 = b.v(px, top, pz, nx, 0, nz), t1 = b.v(qx, top, qz, nx, 0, nz), t2 = b.v(qx, top + ph, qz, nx, 0, nz), t3 = b.v(px, top + ph, pz, nx, 0, nz);
          b.quad(t0, t1, t2, t3);
          const u0 = b.v(px, top + ph, pz, 0, 1, 0), u1 = b.v(qx, top + ph, qz, 0, 1, 0), u2 = b.v(qx + ix, top + ph, qz + iz, 0, 1, 0), u3 = b.v(px + ix, top + ph, pz + iz, 0, 1, 0);
          b.quad(u0, u1, u2, u3);
          const l0 = b.v(qx + ix, top, qz + iz, -nx, 0, -nz), l1 = b.v(px + ix, top, pz + iz, -nx, 0, -nz), l2 = b.v(px + ix, top + ph, pz + iz, -nx, 0, -nz), l3 = b.v(qx + ix, top + ph, qz + iz, -nx, 0, -nz);
          b.quad(l0, l1, l2, l3);
          // embankment lamps every ~28 m along the parapet
          const nl = Math.floor(L / 28);
          for (let k = 0; k < nl; k++) {
            const t = (k + 0.5) / nl;
            lampSites.push({ x: ax + dx * t - nx * 0.25, z: az + dz * t - nz * 0.25, nx, nz, y: top + ph });
          }
        }
      }
    }
  }

  // ---- parks ---------------------------------------------------------------------------------------------------------
  for (const p of geo.parks) {
    const [x0, z0, x1, z1] = ringBox(p.pts);
    if (!inRegion((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2)) continue;
    const [col, a] = PARK_COL[p.kind] || PARK_COL.grass;
    const big = p.kind === 'park' || p.kind === 'wood' || p.kind === 'cemetery';
    const y = p.kind === 'pitch' || p.kind === 'playground' ? LAYER.pitch : big ? LAYER.park : LAYER.parkSmall;
    const j = ((x0 * 7 + z1 * 13) % 17) / 17 * 0.12 + 0.94;
    addTiledPolygon(grass, p.pts, p.holes, y, (b) => b.set('scol', col[0] * j, col[1] * j, col[2] * j, a * 255), terrainSurface);
    stats.parks++;
  }
  // ---- plazas (pedestrian areas, squares) ----------------------------------------------------------------------------
  for (const p of geo.plazas) {
    const [x0, z0, x1, z1] = ringBox(p.pts);
    if (!inRegion((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2)) continue;
    addTiledPolygon(plaza, p.pts, [], LAYER.plaza, (b) => { b.set('scol', 176, 170, 158, 0.55 * 255); b.set('uv', 0, 0); }, terrainSurface);
    stats.plazas++;
  }

  // ---- base ground: a grid of 500 m quads over the play area + 3 km beyond -------------------------------------------
  const ground = new GeoBuilder({});
  // A 50 m terrain grid follows the regional DTM without exploding the draw cost; London keeps 500 m quads.
  const G = terrainSurface ? 50 : 500, pad = 3000;
  const groundY = (x, z) => terrainSurface ? (terrainSurface.sample(x, z) ?? 0) + LAYER.ground : LAYER.ground;
  const groundVertex = (x, z) => ground.v(x, groundY(x, z), z, ...terrainNormal(terrainSurface, x, z));
  const gx0 = Math.floor((bounds.minX - pad) / G) * G, gx1 = Math.ceil((bounds.maxX + pad) / G) * G;
  const gz0 = Math.floor((bounds.minZ - pad) / G) * G, gz1 = Math.ceil((bounds.maxZ + pad) / G) * G;
  for (let x = gx0; x < gx1; x += G) {
    for (let z = gz0; z < gz1; z += G) {
      if (!inRegion(x + G / 2, z + G / 2, G)) continue;
      const a = groundVertex(x, z), b = groundVertex(x, z + G), c = groundVertex(x + G, z + G), d = groundVertex(x + G, z);
      ground.quad(a, b, c, d); // CCW from above
      if (terrainSurface) stats.terrainCells++;
    }
  }
  // water beyond the play area (the ground there is masked by the clamped edge of the water SDF)
  {
    const pad2 = 3000, y = WATER_Y;
    const b = water.get(bounds.minX - 1, bounds.minZ - 1);
    b.set('scol', ...WATER_COL.river, 0);
    const R = [[bounds.minX - pad2, bounds.minZ - pad2, bounds.maxX + pad2, bounds.minZ], [bounds.minX - pad2, bounds.maxZ, bounds.maxX + pad2, bounds.maxZ + pad2],
      [bounds.minX - pad2, bounds.minZ, bounds.minX, bounds.maxZ], [bounds.maxX, bounds.minZ, bounds.maxX + pad2, bounds.maxZ]];
    for (const [x0, z0, x1, z1] of R) {
      if (!inRegion((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2)) continue;
      const a = b.v(x0, y, z0), c = b.v(x0, y, z1), d = b.v(x1, y, z1), e = b.v(x1, y, z0);
      b.quad(a, c, d, e);
    }
  }
  stats.terrainVertices = terrainSurface ? ground.n : 0;
  return { water: water.map, walls: walls.map, grass: grass.map, plaza: plaza.map, ground, lampSites, stats };
}
