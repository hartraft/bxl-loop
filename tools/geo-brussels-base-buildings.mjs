// tools/geo-brussels-base-buildings.mjs — OSM buildings (+ building:part) -> footprint records with height/kind/material/roof.
import {
  wayParts, assembleRings, quantise, rdpRing, ringArea, centroid, ccw, bboxOf, pointInRing, hash01, inBounds,
  expandBounds, WORLD_BOUNDS, log
} from './geo-brussels-base-util.mjs';
import { districtFlags } from './geo-brussels-base-districts.mjs';

export const BUILDING_KINDS = ['house', 'terrace', 'flats', 'office', 'retail', 'civic', 'church', 'station', 'industrial', 'glass_tower', 'other'];
export const MATERIALS = ['brussels_stock_brick', 'red_brick', 'portland_stone', 'stucco_white', 'glass', 'concrete', 'sandstone'];
export const ROOFS = ['flat', 'gabled', 'hipped', 'mansard', 'dome', 'spire'];
const K = Object.fromEntries(BUILDING_KINDS.map((k, i) => [k, i]));
const M = Object.fromEntries(MATERIALS.map((k, i) => [k, i]));
const R = Object.fromEntries(ROOFS.map((k, i) => [k, i]));

const SKIP = new Set(['no', 'demolished', 'razed', 'proposed', 'abandoned', 'disused', 'collapsed', 'destroyed', 'construction_site']);

/** "12", "12 m", "12.5m", "40'", "40 ft", "15'9\"" -> metres (NaN if unparseable) */
export function parseLength(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(',', '.').split(';')[0];
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''))?$/);
  if (m) return Number(m[1]) * 0.3048 + (m[2] ? Number(m[2]) * 0.0254 : 0);
  m = s.match(/^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet)?$/i);
  if (!m) return NaN;
  const v = Number(m[1]);
  return m[2] && /^f/i.test(m[2]) ? v * 0.3048 : v;
}
const num = (s) => { const v = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };

const NAMED_COLOURS = {
  white: 0xf2f0ea, cream: 0xefe6cc, beige: 0xd9cba6, ivory: 0xf4efdc, yellow: 0xd8c27a, 'yellow-brown': 0xb89a5c,
  brown: 0x8a6a4a, light_brown: 0xb08d65, lightbrown: 0xb08d65, tan: 0xc2a77f, red: 0x9e3b2c, maroon: 0x6e2a22, darkred: 0x7a2a20,
  gray: 0x8f8f8c, grey: 0x8f8f8c, lightgrey: 0xbdbcb8, lightgray: 0xbdbcb8, darkgrey: 0x55554f, darkgray: 0x55554f, silver: 0xb8bcc0,
  black: 0x2a2a2a, blue: 0x5a7690, green: 0x58704f, orange: 0xc07840, pink: 0xd8a0a0, sandstone: 0xc9b38a
};
export function parseColour(s) {
  if (!s) return 0;
  s = String(s).trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{6})$/);
  if (m) return parseInt(m[1], 16) || 0x010101;
  m = s.match(/^#?([0-9a-f]{3})$/);
  if (m) return parseInt(m[1].split('').map((c) => c + c).join(''), 16) || 0x010101;
  return NAMED_COLOURS[s] || NAMED_COLOURS[s.replace(/[\s_-]/g, '')] || 0;
}
const reddish = (c) => { const r = c >> 16, g = (c >> 8) & 255, b = c & 255; return r > g + 35 && r > b + 35; };

function baseKind(t, area, levels) {
  const b = t.building || t['building:part'] || 'yes';
  switch (b) {
    case 'house': case 'detached': case 'semidetached_house': case 'bungalow': case 'farm': return 'house';
    case 'terrace': return 'terrace';
    case 'apartments': case 'flats': case 'dormitory': case 'hotel': case 'residences': return 'flats';
    case 'office': case 'commercial': case 'bank': return 'office';
    case 'retail': case 'supermarket': case 'kiosk': case 'pub': case 'shop': case 'restaurant': return 'retail';
    case 'civic': case 'government': case 'public': case 'hospital': case 'school': case 'college': case 'university':
    case 'museum': case 'library': case 'courthouse': case 'townhall': case 'palace': case 'castle': case 'fire_station':
    case 'police': case 'kindergarten': case 'theatre': return 'civic';
    case 'church': case 'cathedral': case 'chapel': case 'mosque': case 'synagogue': case 'temple': case 'religious': case 'monastery': return 'church';
    case 'train_station': case 'transportation': return 'station';
    case 'industrial': case 'warehouse': case 'garage': case 'garages': case 'service': case 'shed': case 'hut': case 'greenhouse':
    case 'depot': case 'viaduct': case 'storage_tank': case 'hangar': case 'parking': case 'carport': return 'industrial';
    default: break;
  }
  if (t.amenity === 'place_of_worship') return 'church';
  if (t.shop || ['pub', 'bar', 'restaurant', 'cafe', 'fast_food'].includes(t.amenity)) return 'retail';
  if (t.office) return 'office';
  if (t.tourism === 'hotel') return 'flats';
  if (['school', 'university', 'college', 'hospital', 'townhall', 'courthouse', 'library', 'theatre'].includes(t.amenity) || t.tourism === 'museum') return 'civic';
  if (b === 'residential') return area < 200 && (!levels || levels <= 4) ? 'terrace' : 'flats';
  return null; // decided by district later
}

function defaultHeight(kind, f, area, r, b) {
  const j = (c, s) => c + (r * 2 - 1) * s;
  if (['garage', 'garages', 'shed', 'hut', 'kiosk', 'carport', 'service', 'greenhouse'].includes(b)) return j(3.2, 0.6);
  if (b === 'houseboat') return 2.6;
  if (b === 'roof') return 5;
  switch (kind) {
    case 'house': return j(8.5, 1.5);
    case 'terrace': return f.stucco ? j(15, 2) : f.regents ? j(16, 2) : f.westEnd ? j(14, 2) : j(11, 1.5);
    case 'flats': return (f.city ? j(24, 5) : f.westEnd ? j(21, 4) : f.stucco ? j(18, 3) : j(15, 4)) + (area > 1200 ? 6 : 0);
    case 'office':
      if (f.city) return area < 300 ? j(22, 4) : 30 + r * 30;
      if (f.westEnd) return j(21.5, 3.5);
      if (f.southBank) return j(25, 7);
      return j(16, 5) + (area > 1500 ? 6 : 0);
    case 'retail': return f.westEnd ? j(20, 3) : f.city ? j(22, 4) : area > 2000 ? j(10, 2) : j(8, 3);
    case 'civic': return j(18, 4);
    case 'church': return j(16, 4);
    case 'station': return j(15, 3);
    case 'industrial': return j(7, 2);
    default: return f.city ? j(25, 5) : f.westEnd ? j(20, 3) : j(10, 3);
  }
}

function pick(r, table) { // table: [[name, weight], ...]
  let s = 0; for (const [, w] of table) s += w;
  let x = r * s;
  for (const [n, w] of table) { if ((x -= w) < 0) return n; }
  return table[table.length - 1][0];
}

function materialFor(t, kind, f, h, area, colour, r, name) {
  const bm = String(t['building:material'] || t['building:facade:material'] || '').toLowerCase();
  if (bm) {
    if (/brick/.test(bm)) return colour && reddish(colour) ? 'red_brick' : 'brussels_stock_brick';
    if (/plaster|stucco|render/.test(bm)) return 'stucco_white';
    if (/sandstone/.test(bm)) return 'sandstone';
    if (/stone|limestone|marble|granite/.test(bm)) return 'portland_stone';
    if (/glass|metal|steel|alumin/.test(bm)) return 'glass';
    if (/concrete|cement/.test(bm)) return 'concrete';
  }
  if (colour) {
    if (reddish(colour)) return 'red_brick';
    const lum = ((colour >> 16) + ((colour >> 8) & 255) + (colour & 255)) / 3;
    if (lum > 215 && h < 35) return 'stucco_white';
  }
  if (/St\.? Pancras|Prudential|Natural History/i.test(name || '')) return 'red_brick';
  if (kind === 'glass_tower') return 'glass';
  if (f.whitehall && ['civic', 'office', 'other', 'church', 'flats'].includes(kind)) return 'portland_stone';
  if (kind === 'church') return pick(r, [['portland_stone', 5], ['brussels_stock_brick', 3], ['red_brick', 1], ['sandstone', 1]]);
  if (kind === 'civic') return pick(r, [['portland_stone', 6], ['brussels_stock_brick', 2], ['red_brick', 2]]);
  if (kind === 'station') return pick(r, [['brussels_stock_brick', 6], ['concrete', 2], ['red_brick', 1], ['glass', 1]]);
  if (kind === 'industrial') return pick(r, [['brussels_stock_brick', 6], ['concrete', 4]]);
  if ((f.stucco || f.regents) && h < 30 && ['house', 'terrace', 'flats', 'other', 'civic'].includes(kind)) {
    return pick(r, f.stucco ? [['stucco_white', 8], ['brussels_stock_brick', 1], ['red_brick', 1]] : [['stucco_white', 6], ['brussels_stock_brick', 4]]);
  }
  if (f.city && ['office', 'other', 'retail', 'flats'].includes(kind)) {
    return h > 45 ? pick(r, [['glass', 6], ['portland_stone', 2], ['concrete', 2]]) : pick(r, [['portland_stone', 9], ['concrete', 5], ['brussels_stock_brick', 4], ['glass', 2]]);
  }
  if (f.westEnd && ['office', 'retail', 'flats', 'other'].includes(kind)) return pick(r, [['portland_stone', 7], ['brussels_stock_brick', 6], ['red_brick', 5], ['stucco_white', 2]]);
  if ((f.southBank || f.nineElms || f.kingsCross) && ['office', 'flats', 'other'].includes(kind) && h > 25) return pick(r, [['glass', 4], ['concrete', 3], ['brussels_stock_brick', 3]]);
  if (kind === 'office') return pick(r, [['concrete', 3], ['portland_stone', 3], ['brussels_stock_brick', 3], ['glass', 1]]);
  if (kind === 'retail') return pick(r, [['brussels_stock_brick', 6], ['red_brick', 2], ['stucco_white', 1], ['concrete', 1]]);
  return pick(r, [['brussels_stock_brick', 75], ['red_brick', 25]]);
}

function roofFor(t, kind, f, h, r, name, area) {
  const rs = String(t['roof:shape'] || '').toLowerCase();
  if (rs) {
    if (/^(flat|skillion|lean_to|round|many|saw ?tooth)$/.test(rs)) return 'flat';
    if (/gabled|saltbox|gambrel|crosspitched|side_hipped/.test(rs) && !/quadruple/.test(rs)) return 'gabled';
    if (/hipped|pyramid|quadruple/.test(rs)) return 'hipped';
    if (/mansard/.test(rs)) return 'mansard';
    if (/dome|onion/.test(rs)) return 'dome';
    if (/spire|cone|conical/.test(rs)) return 'spire';
  }
  if (/\bdome\b/i.test(name || '')) return 'dome';
  if ((kind === 'church' || t['tower:type'] === 'bell_tower' || t.building === 'tower') && area < 90 && h > 22) return 'spire';
  switch (kind) {
    case 'house': return r < 0.25 || f.stucco ? 'hipped' : 'gabled';
    case 'terrace': return f.stucco || f.regents ? (r < 0.5 ? 'flat' : 'mansard') : r < 0.85 ? 'gabled' : 'flat';
    case 'flats': return h < 13 ? 'gabled' : (f.westEnd || f.stucco) && h < 30 && r < 0.4 ? 'mansard' : 'flat';
    case 'church': return 'gabled';
    case 'civic': return r < 0.5 ? 'flat' : r < 0.8 ? 'mansard' : 'hipped';
    case 'station': return r < 0.3 ? 'gabled' : 'flat';
    case 'office': case 'retail': return f.westEnd && h < 30 && r < 0.3 ? 'mansard' : 'flat';
    default: return h < 9 && r < 0.5 ? 'gabled' : 'flat';
  }
}

/**
 * @param ctx {ways: Map, relations: []}
 * @returns array of {ring, height, minHeight, kind, material, roof, colour, name, id}
 */
export function buildBuildings(ctx) {
  const { ways, relations } = ctx;
  const keep = expandBounds(WORLD_BOUNDS, 30);
  const raw = []; // {ring, tags, id, part}
  const relOuterWays = new Set();
  for (const r of relations) {
    const t = r.tags || {};
    const isB = t.building && !SKIP.has(t.building), isP = t['building:part'] && t['building:part'] !== 'no';
    if (t.type !== 'multipolygon' || (!isB && !isP)) continue;
    const segs = [];
    for (const m of r.members) {
      if (m.type !== 'way' || m.role === 'inner') continue;
      const w = ways.get(m.ref);
      if (!w) continue;
      relOuterWays.add(m.ref);
      segs.push(...wayParts(w));
    }
    const { rings } = assembleRings(segs, null, 1);
    for (const ring of rings) raw.push({ ring, tags: t, id: r.id * 2 + 1, part: !isB && isP });
  }
  for (const w of ways.values()) {
    const t = w.tags;
    if (!t) continue;
    const isB = t.building && !SKIP.has(t.building), isP = t['building:part'] && t['building:part'] !== 'no';
    if (!isB && !isP) continue;
    if (relOuterWays.has(w.id) && isB) continue; // the relation stands for it
    if (t.location === 'underground' || num(t.layer) < 0 && !t.height && !t['building:levels']) continue;
    const parts = wayParts(w);
    if (parts.length !== 1) continue;
    let ring = parts[0];
    const a = ring[0], b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) ring = ring.slice(0, -1);
    else continue; // not closed (cut by the extract)
    raw.push({ ring, tags: t, id: w.id * 2, part: !isB && isP });
  }
  // geometry clean-up
  const recs = [];
  for (const o of raw) {
    let ring = quantise(rdpRing(o.ring, 0.15), true);
    if (ring.length < 3) continue;
    const area = ringArea(ring);
    if (area < 8) continue;
    const c = centroid(ring);
    if (!inBounds(c[0], c[1], keep)) continue;
    recs.push({ ...o, ring: ccw(ring), area, c, bb: bboxOf(ring) });
  }
  // parts -> parents
  const CELL = 64, grid = new Map();
  const cellKey = (i, j) => i * 100003 + j;
  const parents = recs.filter((o) => !o.part);
  parents.forEach((o, idx) => {
    for (let i = Math.floor(o.bb.x0 / CELL); i <= Math.floor(o.bb.x1 / CELL); i++)
      for (let j = Math.floor(o.bb.z0 / CELL); j <= Math.floor(o.bb.z1 / CELL); j++) {
        const k = cellKey(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
  });
  const partsOf = new Map();
  let orphanParts = 0;
  for (const p of recs) {
    if (!p.part) continue;
    const cand = grid.get(cellKey(Math.floor(p.c[0] / CELL), Math.floor(p.c[1] / CELL))) || [];
    let best = -1, ba = Infinity;
    for (const idx of cand) {
      const o = parents[idx];
      if (o.area < ba && o.area >= p.area * 0.5 && pointInRing(p.c[0], p.c[1], o.ring)) { best = idx; ba = o.area; }
    }
    if (best < 0) { orphanParts++; p.parent = null; continue; }
    p.parent = parents[best];
    if (!partsOf.has(best)) partsOf.set(best, []);
    partsOf.get(best).push(p);
  }
  // attributes
  const out = [];
  const attrs = (o, inherit) => {
    const t = o.tags;
    const name = t.name || '';
    const f = districtFlags(o.c[0], o.c[1]);
    const r = hash01(o.id, 1), r2 = hash01(o.id, 2), r3 = hash01(o.id, 3);
    const levels = num(t['building:levels']);
    let h = parseLength(t.height);
    if (!(h > 0) && levels >= 0) h = levels * 3.2 + (num(t['roof:levels']) > 0 ? num(t['roof:levels']) * 2.5 : 0) + (levels === 0 ? 2.5 : 0);
    let minH = parseLength(t.min_height);
    if (!(minH >= 0)) minH = num(t['building:min_level']) > 0 ? num(t['building:min_level']) * 3.2 : 0;
    let kind = baseKind(t, o.area, levels);
    if (!kind && inherit) kind = inherit.kindName;
    if (!kind) kind = f.city ? 'office' : f.westEnd ? (o.area > 700 ? 'office' : r2 < 0.5 ? 'flats' : 'retail') : o.area < 180 ? 'terrace' : o.area < 700 ? 'flats' : 'other';
    const b = t.building || t['building:part'];
    if (!(h > 0)) h = inherit && inherit.height > 0 && o.part ? inherit.height : defaultHeight(kind, f, o.area, r, b);
    if (b === 'roof' && !t.min_height) minH = Math.max(0, h - 1.2);
    h = Math.min(320, Math.max(2, h));
    if (minH > h - 1) minH = Math.max(0, h - 1);
    if (!['church', 'civic', 'station'].includes(kind) && !(f.stucco && h < 40) &&
      (h >= 60 || (h >= 40 && o.area >= 800 && (f.city || f.southBank || f.nineElms || f.kingsCross)))) kind = 'glass_tower';
    const colour = parseColour(t['building:colour'] || t.colour);
    const material = materialFor(t, kind, f, h, o.area, colour, r3, name);
    const roof = roofFor(t, kind, f, h, r2, name, o.area);
    return { kindName: kind, height: h, minHeight: minH, kind: K[kind], material: M[material], roof: R[roof], colour, name };
  };
  let replaced = 0;
  parents.forEach((o, idx) => {
    const a = attrs(o, null);
    const ps = partsOf.get(idx) || [];
    const cover = ps.reduce((s, p) => s + (p.tags['building:part'] !== 'roof' ? p.area : 0), 0);
    if (ps.length && cover >= 0.5 * o.area) {
      replaced++;
      for (const p of ps) out.push({ ring: p.ring, id: p.id, ...attrs(p, a), name: p.tags.name || a.name });
    } else {
      out.push({ ring: o.ring, id: o.id, ...a });
      for (const p of ps) { const pa = attrs(p, a); if (pa.height > a.height + 1 || pa.minHeight > 0.5) out.push({ ring: p.ring, id: p.id, ...pa }); }
    }
  });
  for (const p of recs) if (p.part && !p.parent) out.push({ ring: p.ring, id: p.id, ...attrs(p, null) });
  log(`buildings: ${raw.length} raw, ${recs.length} kept, ${replaced} outlines replaced by parts, ${orphanParts} orphan parts -> ${out.length}`);
  return out;
}
