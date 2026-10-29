// js/brx-geodata.js — loads the generated Brussels geodata (data/brussels-build/brx-geo.json + brx-buildings.bin).
// The binary/data schema intentionally matches the existing city engine; only the coordinate frame and source data differ.
//
//   import { GEO } from './bxl-geodata.js';      // top-level await: the module resolves once the data is decoded
//
// Works in the browser (fetch relative to this module) and in Node (reads the files with node:fs) so tests can import it.
// Coordinates: world metres in the js/geo-frame.js frame (x east, z south, origin Grand-Place), 0.1 m precision.
//
// File format (v1) — brx-geo.json: { v, frame, bounds, enums:{…kind tables}, names:[…], roads:[[…]], water, parks, … }
// with every point list delta-encoded in decimetre ints: [x0, z0, dx1, dz1, …]. brx-buildings.bin (little-endian):
// 'BXLB', u32 version, u32 count, u32 nPts, u32 nSections, u32 offset[nSections] then the sections ringStart u32[count+1],
// origin i32[2count] (first point, dm), colour u32[count], nameIdx i32[count], delta i16[2nPts] (dm, first = 0),
// height u16[count] (dm), minHeight u16[count] (dm), kind u8, material u8, roof u8, landmark u8.
import { BRUSSELS_FRAME as FRAME, BRUSSELS_WORLD_BOUNDS as WORLD_BOUNDS } from './brussels-frame.js';

export const BUILDING_KINDS = ['house', 'terrace', 'flats', 'office', 'retail', 'civic', 'church', 'station', 'industrial', 'glass_tower', 'other'];
export const MATERIALS = ['brussels_stock_brick', 'red_brick', 'portland_stone', 'stucco_white', 'glass', 'concrete', 'sandstone'];
export const ROOFS = ['flat', 'gabled', 'hipped', 'mansard', 'dome', 'spire'];

/** delta-encoded decimetre ints -> Float32Array of metres */
function dec(a) {
  const out = new Float32Array(a.length);
  let x = 0, z = 0;
  for (let i = 0; i < a.length; i += 2) {
    x += a[i]; z += a[i + 1];
    out[i] = x / 10; out[i + 1] = z / 10;
  }
  return out;
}
const cm = (a) => (a ? Float32Array.from(a, (v) => v / 100) : null);

function decodeBuildings(ab) {
  const dv = new DataView(ab);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'BXLB') throw new Error('brx-buildings.bin: bad magic');
  const count = dv.getUint32(8, true), nPts = dv.getUint32(12, true), nSec = dv.getUint32(16, true);
  const o = [];
  for (let i = 0; i < nSec; i++) o.push(dv.getUint32(20 + i * 4, true));
  const [oRing, oOrigin, oColour, oName, oDelta, oH, oMinH, oKind, oMat, oRoof, oLm] = o;
  // typed array views assume a little-endian host (every browser / Node platform we target)
  const ringStart = new Uint32Array(ab.slice(oRing, oRing + 4 * (count + 1)));
  const origin = new Int32Array(ab, oOrigin, count * 2);
  const delta = new Int16Array(ab, oDelta, nPts * 2);
  const xz = new Float32Array(nPts * 2);
  for (let b = 0; b < count; b++) {
    let x = origin[b * 2], z = origin[b * 2 + 1];
    for (let p = ringStart[b], e = ringStart[b + 1]; p < e; p++) {
      x += delta[p * 2]; z += delta[p * 2 + 1];
      xz[p * 2] = x / 10; xz[p * 2 + 1] = z / 10;
    }
  }
  const h16 = new Uint16Array(ab, oH, count), m16 = new Uint16Array(ab, oMinH, count);
  return {
    count, ringStart, xz,
    height: Float32Array.from(h16, (v) => v / 10),
    minHeight: Float32Array.from(m16, (v) => v / 10),
    kind: new Uint8Array(ab.slice(oKind, oKind + count)),
    material: new Uint8Array(ab.slice(oMat, oMat + count)),
    roof: new Uint8Array(ab.slice(oRoof, oRoof + count)),
    colour: new Uint32Array(ab.slice(oColour, oColour + 4 * count)),
    nameIdx: new Int32Array(ab.slice(oName, oName + 4 * count)),
    landmark: new Uint8Array(ab.slice(oLm, oLm + count))
  };
}

/** decode the parsed bxl-geo.json object + the bxl-buildings.bin ArrayBuffer into GEO */
export function decodeGeo(j, buildingsBuffer) {
  const E = j.enums, names = j.names;
  for (const [a, b] of [[E.buildingKinds, BUILDING_KINDS], [E.materials, MATERIALS], [E.roofs, ROOFS]]) {
    if (a.join() !== b.join()) throw new Error('brx-geodata: enum mismatch, rebuild Brussels data');
  }
  const S = (i) => names[i] || '';
  const crossPts = dec(j.crossings.p);
  return {
    frame: FRAME, bounds: WORLD_BOUNDS, version: j.v, source: j.source,
    roads: j.roads.map((r, id) => {
      const f = r[5];
      return {
        id, name: S(r[0]), ref: S(r[1]), kind: E.roadKinds[f & 15], w: r[2] / 10, lanes: r[3], oneway: ((f >> 4) & 3) - 1, maxspeed: r[4],
        bridge: (f >> 6) & 1, tunnel: (f >> 7) & 1, layer: ((f >> 9) & 15) - 8, junction: (f >> 8) & 1 ? 'roundabout' : '',
        sub: E.roadSubs[f >> 13] || '', pts: dec(r[6]), deck: cm(r[7]),
        // dead-end treatment drawn by js/city/roads.js at the first / last point: '' | 'kerb' | 'bollards' | 'portal' | 'gate'
        capA: E.roadCaps ? E.roadCaps[(r[8] || 0) >> 3] || '' : '', capB: E.roadCaps ? E.roadCaps[(r[8] || 0) & 7] || '' : ''
      };
    }),
    // runs of drawn roads through ground-level building footprints: {road, pts, w, minY, portals:[{x, z, nx, nz}], tag}
    passages: (j.passages || []).map((p) => {
      const q = [];
      for (let i = 0; i < p[4].length; i += 4) q.push({ x: p[4][i] / 10, z: p[4][i + 1] / 10, nx: p[4][i + 2] / 100, nz: p[4][i + 3] / 100 });
      return { road: p[0], pts: dec(p[1]), w: p[2] / 10, minY: p[3] / 10, portals: q, tag: p[5] || '' };
    }),
    // gateways (garage doors / yard gates) where a dead-end carriageway (cap 'gate') meets a building wall
    gates: (j.gates || []).map((g) => ({ road: g[0], end: g[1], x: g[2] / 10, z: g[3] / 10, nx: g[4] / 100, nz: g[5] / 100, w: g[6] / 10, h: g[7] / 10 })),
    buildings: decodeBuildings(buildingsBuffer),
    water: j.water.map((w) => ({ kind: E.waterKinds[w[0]], name: S(w[1]), pts: dec(w[2]), holes: w[3].map(dec) })),
    parks: j.parks.map((p) => ({ kind: E.parkKinds[p[0]], name: S(p[1]), pts: dec(p[2]), holes: p[3].map(dec) })),
    plazas: j.plazas.map((p) => ({ name: S(p[0]), pts: dec(p[1]) })),
    rail: j.rail.map((r) => ({ kind: E.railKinds[r[0]], bridge: r[1], tunnel: 0, layer: r[2], pts: dec(r[3]), deck: cm(r[4]) })),
    bridges: j.bridges.map((b) => ({ name: S(b[0]), pts: dec(b[1]), deckY: b[2] / 100, axis: b[3] ? Float32Array.from(b[3], (v) => v / 10) : null, synthetic: !!b[4] })),
    stations: j.stations.map((s) => ({ name: S(s[0]), kind: E.stationKinds[s[1]], x: s[2] / 10, z: s[3] / 10 })),
    pois: j.pois.map((p) => ({ kind: E.poiKinds[p[0]], name: S(p[1]), x: p[2] / 10, z: p[3] / 10 })),
    signals: dec(j.signals),
    busStops: dec(j.busStops),
    crossings: j.crossings.k.map((k, i) => ({ x: crossPts[i * 2], z: crossPts[i * 2 + 1], kind: E.crossingKinds[k] })),
    trees: dec(j.trees),
    districts: j.districts.map((d) => ({ name: S(d[0]), x: d[1] / 10, z: d[2] / 10, rank: d[3] })),
    names,
    landmarkZones: j.landmarkZones.map((z) => ({ id: z[0], pts: dec(z[1]) }))
  };
}

/** fetch (browser) or read (Node) the baked files and decode them */
export async function loadBrusselsGeo(base = new URL('../data/brussels-build/', import.meta.url)) {
  const jsonUrl = new URL('brx-geo.json', base), binUrl = new URL('brx-buildings.bin', base);
  if (base.protocol === 'file:') {
    const fs = await import('node:fs');
    const b = fs.readFileSync(binUrl);
    return decodeGeo(JSON.parse(fs.readFileSync(jsonUrl, 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  const [j, bin] = await Promise.all([
    fetch(jsonUrl).then((r) => { if (!r.ok) throw new Error('brx-geo.json ' + r.status); return r.json(); }),
    fetch(binUrl).then((r) => { if (!r.ok) throw new Error('brx-buildings.bin ' + r.status); return r.arrayBuffer(); })
  ]);
  return decodeGeo(j, bin);
}

export const GEO = await loadBrusselsGeo();
