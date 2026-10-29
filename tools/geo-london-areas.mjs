// tools/geo-london-areas.mjs — polygons: water (Thames!), parks, plazas, man_made=bridge outlines, landmark zones.
import {
  wayParts, assembleRings, clipRing, quantise, rdpRing, ringArea, centroid, ccw, cw, pointInRing, expandBounds,
  convexHull, bufferRing, circleRing, WORLD_BOUNDS, toWorld, log, inBounds
} from './geo-london-util.mjs';
import { LANDMARK_ANCHORS } from '../js/geo-frame.js';

export const WATER_KINDS = ['river', 'lake', 'dock', 'canal', 'fountain'];
export const PARK_KINDS = ['park', 'garden', 'grass', 'pitch', 'wood', 'cemetery', 'square', 'playground'];

const CLIP = expandBounds(WORLD_BOUNDS, 100);

/** generic multipolygon/way -> [{outer, holes}] in world coords, clipped */
function polysOf(e, ways, { outside = CLIP, eps = 1, minArea = 10, keepHoles = true } = {}) {
  let outers = [], inners = [];
  if (e.type === 'way') {
    const parts = wayParts(e);
    if (parts.length !== 1) {
      // cut by the extract edge: try closing across the outside
      const { rings } = assembleRings(parts, outside, 1);
      outers = rings;
    } else {
      const r = parts[0];
      const a = r[0], b = r[r.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) outers = [r.slice(0, -1)];
      else outers = assembleRings([r], outside, 1).rings;
    }
  } else {
    const os = [], is = [];
    for (const m of e.members) {
      if (m.type !== 'way') continue;
      const w = ways.get(m.ref);
      if (!w) continue;
      (m.role === 'inner' ? is : os).push(...wayParts(w));
    }
    const A = assembleRings(os, outside, 3);
    outers = A.rings;
    if (A.open.length) log(`  ${e.type} ${e.id} (${(e.tags && e.tags.name) || ''}): ${A.open.length} open outer chains dropped`);
    if (keepHoles) inners = assembleRings(is, null, 1).rings;
  }
  const res = [];
  for (let o of outers) {
    o = clipRing(o, CLIP);
    if (!o) continue;
    o = quantise(rdpRing(o, eps), true);
    if (o.length < 3 || ringArea(o) < minArea) continue;
    res.push({ outer: ccw(o), holes: [] });
  }
  for (let h of inners) {
    h = quantise(rdpRing(h, eps), true);
    if (h.length < 3 || ringArea(h) < 4) continue;
    const c = h[0];
    if (!inBounds(c[0], c[1], CLIP)) continue;
    const host = res.find((p) => pointInRing(c[0], c[1], p.outer));
    if (host) host.holes.push(cw(h));
  }
  return res;
}

function waterKind(t) {
  if (t.amenity === 'fountain' || t.water === 'fountain' || t.fountain) return 'fountain';
  if (t.water === 'river' || t.waterway === 'riverbank' || t.water === 'tidal' || (t.tidal === 'yes' && t.natural === 'water' && !t.dock)) return 'river';
  if (t.waterway === 'dock' || t.water === 'dock' || t.dock || t.water === 'lock') return 'dock';
  if (t.water === 'canal' || t.waterway === 'canal' || /\b(Basin|Canal)\b/.test(t.name || '')) return 'canal';
  return 'lake';
}
const isWaterArea = (t) => t && (t.natural === 'water' || t.waterway === 'riverbank' || (t.waterway === 'dock' && (t.area === 'yes' || true)) ||
  t.landuse === 'basin' || t.landuse === 'reservoir');

export function buildWater(ctx) {
  const { ways, relations } = ctx;
  const water = [];
  const relMember = new Set();
  for (const r of relations) {
    const t = r.tags || {};
    if (t.type !== 'multipolygon' || !isWaterArea(t)) continue;
    for (const m of r.members) relMember.add(m.ref);
    const kind = waterKind(t);
    for (const p of polysOf(r, ways, { eps: kind === 'river' ? 1 : 0.6 })) {
      water.push({ kind, name: t.name || '', ...p, osm: r.id });
    }
  }
  for (const w of ways.values()) {
    const t = w.tags;
    if (!isWaterArea(t) || relMember.has(w.id)) continue;
    if (t.waterway === 'dock' && !(w.geometry.length > 3)) continue;
    const kind = waterKind(t);
    for (const p of polysOf(w, ways, { eps: 0.6, minArea: kind === 'fountain' ? 3 : 10 })) water.push({ kind, name: t.name || '', ...p, osm: w.id });
  }
  log(`water: ${water.length} polygons (${water.filter((w) => w.kind === 'river').length} river)`);
  return water;
}

function parkKind(t) {
  const n = t.name || '';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'golf_course' || t.leisure === 'sports_centre' && !t.building) return 'pitch';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub') return 'wood';
  if ((t.leisure === 'garden' || t.leisure === 'park') && /\bSquare\b/.test(n)) return 'square';
  if (t.leisure === 'garden' || t.landuse === 'allotments' || t.landuse === 'flowerbed') return 'garden';
  if (t.leisure === 'park' || t.leisure === 'common' || t.leisure === 'nature_reserve' || t.leisure === 'dog_park' ||
    t.landuse === 'recreation_ground' || t.landuse === 'village_green') return 'park';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.natural === 'grassland' || t.natural === 'heath') return 'grass';
  return null;
}

export function buildParks(ctx) {
  const { ways, relations } = ctx;
  const parks = [];
  const relMember = new Set();
  for (const r of relations) {
    const t = r.tags || {};
    if (t.type !== 'multipolygon') continue;
    const kind = parkKind(t);
    if (!kind) continue;
    for (const m of r.members) if (m.role !== 'inner') relMember.add(m.ref);
    for (const p of polysOf(r, ways, { eps: 1, minArea: 30 })) parks.push({ kind, name: t.name || '', ...p });
  }
  for (const w of ways.values()) {
    const t = w.tags;
    if (!t || relMember.has(w.id)) continue;
    const kind = parkKind(t);
    if (!kind || t.building) continue;
    for (const p of polysOf(w, ways, { eps: 1, minArea: 30 })) parks.push({ kind, name: t.name || '', ...p });
  }
  // big first so renderers can layer small (pitches, gardens) on top
  parks.sort((a, b) => ringArea(b.outer) - ringArea(a.outer));
  log(`parks: ${parks.length}`);
  return parks;
}

export function buildPlazas(ctx) {
  const { ways, relations } = ctx;
  const out = [];
  const isPlaza = (t) => t && ((t.highway === 'pedestrian' && (t.area === 'yes' || t.type === 'multipolygon')) || t.place === 'square' ||
    t['area:highway'] === 'pedestrian');
  const relMember = new Set();
  for (const r of relations) {
    const t = r.tags || {};
    if (t.type !== 'multipolygon' || !isPlaza(t)) continue;
    for (const m of r.members) relMember.add(m.ref);
    for (const p of polysOf(r, ways, { eps: 0.5, minArea: 20 })) out.push({ name: t.name || '', ...p });
  }
  for (const w of ways.values()) {
    if (!isPlaza(w.tags) || relMember.has(w.id)) continue;
    if (w.tags.highway === 'pedestrian' && w.tags.area !== 'yes') continue;
    for (const p of polysOf(w, ways, { eps: 0.5, minArea: 20 })) out.push({ name: w.tags.name || '', ...p });
  }
  log(`plazas: ${out.length}`);
  return out;
}

/** man_made=bridge outlines (decks are computed later from the roads crossing them) */
export function buildBridgeOutlines(ctx) {
  const { ways, relations } = ctx;
  const out = [];
  const nameOf = new Map(); // outline way id -> bridge relation name
  for (const r of relations) {
    const t = r.tags || {};
    if (t.type === 'bridge') for (const m of r.members) if (m.role === 'outline') nameOf.set(m.ref, t.name || '');
  }
  const relMember = new Set();
  for (const r of relations) {
    const t = r.tags || {};
    if (t.type !== 'multipolygon' || t.man_made !== 'bridge') continue;
    for (const m of r.members) relMember.add(m.ref);
    for (const p of polysOf(r, ways, { eps: 0.5, minArea: 20, keepHoles: false })) out.push({ name: t.name || '', outer: p.outer, osm: r.id });
  }
  for (const w of ways.values()) {
    const t = w.tags;
    if (!t || t.man_made !== 'bridge' || relMember.has(w.id)) continue;
    for (const p of polysOf(w, ways, { eps: 0.5, minArea: 20, keepHoles: false })) out.push({ name: t.name || nameOf.get(w.id) || '', outer: p.outer, osm: w.id });
  }
  log(`bridge outlines: ${out.length}`);
  return out;
}

// ---- landmark zones ---------------------------------------------------------------------------------------------
// [zone id, anchor key, [[type, osm id, buffer m], ...], 'hull'?] — ids found in the 2026-10-20 extract; name fallback
const LONDON_ZONES = [
  ['bigBen', 'bigBen', [['way', 123557148, 2]], null, /^Elizabeth Tower$/],
  ['parliament', 'parliament', [['relation', 1567699, 1.5], ['way', 367642704, 1.5], ['way', 367642689, 1.5]], null, /^Palace of Westminster$/],
  ['londonEye', 'londonEye', [['way', 204068874, 4]], null, /London Eye$/],
  ['towerBridge', 'towerBridge', [['way', 367652787, 2], ['way', 367652791, 2]], 'hull', /^Tower Bridge (North|South) Tower$/],
  ['shard', 'shard', [['way', 31110737, 1.5]], null, /^The Shard$/],
  ['stPauls', 'stPauls', [['way', 369161987, 1.5]], null, /^St\.? Paul's Cathedral$/],
  ['gherkin', 'gherkin', [['way', 4959489, 1.5]], null, /^30 St Mary Axe$/],
  ['buckinghamPalace', 'buckinghamPalace', [['relation', 5208404, 1.5]], null, /^Buckingham Palace$/],
  ['nelsonsColumn', 'nelsonsColumn', [['way', 150920358, 1]], null, /^Nelson's Column$/],
  ['trafalgarSquare', 'trafalgarSquare', [['way', 150920358, 1], ['way', 153342445, 1], ['way', 969826222, 1]], 'hull', null],
  ['batterseaPowerStation', 'batterseaPowerStation', [['way', 4965216, 2]], null, /^Battersea Power Station$/]
];

const BRUSSELS_ZONES = [
  ['grandPlace', 'grandPlace', [], null, /Grand[- ]Place|Grote Markt/i],
  ['mannekenPis', 'mannekenPis', [], null, /Manneken Pis/i],
  ['montDesArts', 'montDesArts', [], null, /Mont des Arts|Kunstberg/i],
  ['royalPalace', 'royalPalace', [], null, /Royal Palace|Koninklijk Paleis|Palais Royal/i],
  ['cathedral', 'cathedral', [], null, /Cathedral of St Michael|Sint-Michiels|Saint-Michel/i],
  ['palaisDeJustice', 'palaisDeJustice', [], null, /Palace of Justice|Justitiepaleis|Palais de Justice/i],
  ['cinquantenaire', 'cinquantenaire', [], null, /Cinquantenaire|Jubelpark/i],
  ['europeanParliament', 'europeanParliament', [], null, /European Parliament|Europees Parlement|Parlement européen/i],
  ['koekelbergBasilica', 'koekelbergBasilica', [], null, /Basilica of the Sacred Heart|Koekelberg/i]
];
const ZONES = process.env.CITY === 'brussels' ? BRUSSELS_ZONES : LONDON_ZONES;

export function buildLandmarkZones(ctx) {
  const { ways, relations, byName } = ctx;
  const relById = new Map(relations.map((r) => [r.id, r]));
  const zones = [];
  for (const [id, anchorKey, refs, mode, nameRe] of ZONES) {
    const a = LANDMARK_ANCHORS[anchorKey];
    const aw = toWorld(a.lat, a.lon);
    let rings = [];
    for (const [type, oid, buf] of refs) {
      const e = type === 'way' ? ways.get(oid) : relById.get(oid);
      if (!e) continue;
      for (const p of polysOf(e, ways, { eps: 0.3, minArea: 1, keepHoles: false })) rings.push(bufferRing(p.outer, buf));
    }
    if (!rings.length && nameRe) {
      for (const e of byName(nameRe)) {
        for (const p of polysOf(e, ways, { eps: 0.3, minArea: 1, keepHoles: false })) {
          const c = centroid(p.outer);
          if (Math.hypot(c[0] - aw.x, c[1] - aw.z) < 400) rings.push(bufferRing(p.outer, 1.5));
        }
      }
      if (rings.length) log(`  zone ${id}: found by name`);
    }
    if (!rings.length) { rings = [circleRing(aw.x, aw.z, 30)]; log(`  zone ${id}: fallback circle`); }
    if (mode === 'hull') rings = [convexHull(rings.flat())];
    for (const r of rings) zones.push({ id, pts: ccw(quantise(r, true)) });
  }
  log(`landmark zones: ${zones.length} polygons for ${ZONES.length} landmarks`);
  return zones;
}
