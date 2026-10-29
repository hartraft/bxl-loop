// tools/geo-london-lines.mjs — roads, rail, bridge decks and the point layers (stations, POIs, signals, …).
import {
  ll, rdp, quantise, clipPolyline, polyLength, expandBounds, inBounds, centroid, pointInRing, bboxOf, convexHull,
  bufferRing, ccw, WORLD_BOUNDS, log
} from './geo-london-util.mjs';
import { parseLength } from './geo-london-buildings.mjs';

export const ROAD_KINDS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'service', 'pedestrian', 'footway', 'cycleway', 'steps'];
export const RAIL_KINDS = ['rail', 'light_rail', 'subway'];
export const STATION_KINDS = ['tube', 'rail', 'dlr'];

const CLIP = expandBounds(WORLD_BOUNDS, 30);
const VEHICLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);

function roadKind(t) {
  const h = t.highway;
  if (!h) return null;
  const base = h.replace(/_link$/, '');
  if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
    'pedestrian', 'footway', 'cycleway', 'steps'].includes(base)) return base;
  if (h === 'path' || h === 'bridleway') return 'footway';
  if (h === 'track') return 'service';
  if (h === 'busway' || h === 'bus_guideway') return 'primary';
  if (h === 'road') return 'unclassified';
  return null; // corridor, platform, elevator, construction, proposed, …
}
const DEF_W = { motorway: 14, trunk: 12, primary: 11, secondary: 9, tertiary: 8, unclassified: 7, residential: 7, living_street: 5.5,
  service: 4.5, pedestrian: 6, footway: 2.5, cycleway: 2.5, steps: 2.5 };
const num = (s) => { const v = parseFloat(String(s ?? '')); return Number.isFinite(v) ? v : NaN; };

function onewayOf(t, kind) {
  const o = String(t.oneway || '').toLowerCase();
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no' || o === 'reversible' || o === 'alternating') return 0;
  if (t.junction === 'roundabout' || t.junction === 'circular') return 1;
  if (kind === 'motorway' || /_link$/.test(t.highway || '') && t.highway.startsWith('motorway')) return 1;
  return 0;
}

/** shared vertex counts across all ways passing `filter` (junction locking for simplification) */
function vertexUse(ways, filter) {
  const use = new Map();
  for (const w of ways.values()) {
    if (!w.tags || !filter(w.tags)) continue;
    const g = w.geometry;
    for (let i = 0; i < g.length; i++) {
      const p = g[i];
      if (!p) continue;
      const k = p.lat + ',' + p.lon;
      use.set(k, (use.get(k) || 0) + (i === 0 || i === g.length - 1 ? 2 : 1));
    }
  }
  return use;
}

/** split way geometry at nulls, project, return [{pts, locked:Set(index)}] */
function lockedParts(w, use) {
  const out = [];
  let cur = [], lk = [];
  const flush = () => { if (cur.length > 1) out.push({ pts: cur, lock: lk }); cur = []; lk = []; };
  for (const p of w.geometry) {
    if (!p) { flush(); continue; }
    lk.push((use.get(p.lat + ',' + p.lon) || 0) > 1);
    cur.push(ll(p));
  }
  flush();
  return out;
}

export function buildRoads(ctx) {
  const { ways } = ctx;
  const isRoadTags = (t) => { const k = roadKind(t); return k && t.area !== 'yes' && t.indoor !== 'yes'; };
  const use = vertexUse(ways, isRoadTags);
  const roads = [];
  let droppedShort = 0;
  for (const w of ways.values()) {
    const t = w.tags;
    if (!t || !isRoadTags(t)) continue;
    const kind = roadKind(t);
    if (t.level && num(t.level) < 0 && t.tunnel !== 'yes') continue; // indoor/underground walkways
    if (t.highway === 'steps' && t.indoor) continue;
    const oneway = onewayOf(t, kind);
    let w0 = parseLength(t.width);
    if (!(w0 > 0) || w0 > 40) w0 = NaN;
    if (w0 < 1.5) w0 = 1.5;
    const lanesTag = num(t.lanes);
    let width = w0;
    if (!(width > 0)) {
      if (lanesTag > 0 && VEHICLE.has(kind)) width = lanesTag * 3.2 + (kind === 'primary' || kind === 'trunk' ? 0.6 : 0);
      else { width = DEF_W[kind]; if (oneway && VEHICLE.has(kind) && t.junction !== 'roundabout' && kind !== 'service') width = Math.max(3.6, width * 0.62); }
    }
    const lanes = VEHICLE.has(kind) ? (lanesTag > 0 ? Math.round(lanesTag) : Math.max(1, Math.round(width / (oneway ? 3.3 : 3.5)))) : 0;
    let maxspeed = num(t.maxspeed);
    if (/km\\/?h/i.test(t.maxspeed || '') || (process.env.CITY === 'brussels' && t.maxspeed && !/mph|mi\\/?h/i.test(t.maxspeed))) maxspeed = Math.round(maxspeed / 1.609);
    if (!(maxspeed > 0)) maxspeed = VEHICLE.has(kind) ? (kind === 'motorway' ? 50 : kind === 'trunk' ? 30 : kind === 'service' ? 10 : 20) : 0;
    const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0;
    const tunnel = t.tunnel === 'yes' || t.tunnel === 'culvert' ? 1 : 0;
    const layer = Math.round(num(t.layer)) || 0;
    const junction = t.junction === 'roundabout' || t.junction === 'circular' ? 'roundabout' : '';
    const sub = /_link$/.test(t.highway) ? 'link' : t.footway === 'sidewalk' ? 'sidewalk' : t.footway === 'crossing' || t.cycleway === 'crossing' ? 'crossing'
      : t.service || '';
    // building passages / covered ways (drawn at grade; tools/geo-london-roadfix.mjs exports them as GEO.passages)
    const cover = t.tunnel === 'building_passage' ? 'passage' : t.covered === 'yes' || t.covered === 'arcade' ? 'covered' : '';
    const maxheight = parseLength(t.maxheight);
    for (const part of lockedParts(w, use)) {
      const simp = rdp(part.pts, 0.5, (i) => part.lock[i]);
      for (const piece of clipPolyline(simp, CLIP)) {
        const pts = quantise(piece);
        if (pts.length < 2) continue;
        const L = polyLength(pts);
        if (kind === 'service' && L < 25) { droppedShort++; continue; }
        if (L < 0.5) continue;
        roads.push({ osm: w.id, name: t.name || '', ref: t.ref || '', kind, w: Math.round(width * 10) / 10, lanes, oneway, maxspeed,
          bridge, tunnel, layer, junction, sub, pts, len: L, cover, maxheight });
      }
    }
  }
  log(`roads: ${roads.length} (dropped ${droppedShort} short service)`);
  return roads;
}

export function buildRail(ctx) {
  const { ways } = ctx;
  const out = [];
  for (const w of ways.values()) {
    const t = w.tags;
    if (!t || !t.railway) continue;
    let kind = t.railway === 'tram' ? 'light_rail' : t.railway;
    if (!RAIL_KINDS.includes(kind)) continue;
    if (t.tunnel && t.tunnel !== 'no') continue; // only surface + bridge track is drawn
    if (t.location === 'underground' || num(t.layer) < 0 && !t.bridge) continue;
    const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0;
    for (const part of lockedParts(w, new Map())) {
      for (const piece of clipPolyline(rdp(part.pts, 0.5), CLIP)) {
        const pts = quantise(piece);
        if (pts.length < 2 || polyLength(pts) < 2) continue;
        out.push({ osm: w.id, kind, bridge, tunnel: 0, layer: Math.round(num(t.layer)) || 0, service: t.service || '', pts });
      }
    }
  }
  log(`rail: ${out.length} surface/bridge pieces`);
  return out;
}

// ---- bridge decks -----------------------------------------------------------------------------------------------
/** raised-cosine deck profile (0 at both ends, H mid-span) along an axis */
export function deckAt(b, x, z) {
  const [x0, z0, x1, z1] = b.axis;
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  const t = ((x - x0) * dx + (z - z0) * dz) / L;
  if (t <= 0 || t >= L) return 0;
  return b.deckY * 0.5 * (1 - Math.cos((2 * Math.PI * t) / L));
}

function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 1; k < n; k++) out.push([Math.round((a[0] + ((b[0] - a[0]) * k) / n) * 10) / 10, Math.round((a[1] + ((b[1] - a[1]) * k) / n) * 10) / 10]);
    out.push(b);
  }
  return out;
}

/**
 * Bridges over water get a deck profile: groups of connected bridge ways (roads + rail) that cross water, sharing an
 * axis (principal direction of all their points), H = clamp(0.03 * span, 0.3, 8) m. Every road/rail of the group gets
 * per-vertex `deck` heights (densified to ≤ 8 m) and each man_made=bridge outline over the group gets {deckY, axis}.
 */
export function buildBridgeDecks(roads, rail, outlines, waterGrid) {
  const items = [];
  for (const r of roads) if (r.bridge && !r.tunnel) items.push(r);
  for (const r of rail) if (r.bridge) items.push(r);
  const wet = (pts) => {
    let n = 0, h = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      for (let j = 0; j < k; j++) { n++; if (waterGrid.at(a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k)) h++; }
    }
    return n ? h / n : 0;
  };
  const wetItems = items.filter((r) => (r.wetFrac = wet(r.pts)) > 0.05);
  // union-find over wet bridge items: shared endpoints or same outline
  const parent = wetItems.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const endKey = new Map();
  wetItems.forEach((r, i) => {
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) {
      const k = p[0] + ',' + p[1];
      if (endKey.has(k)) union(i, endKey.get(k)); else endKey.set(k, i);
    }
  });
  const olBB = outlines.map((o) => bboxOf(o.outer));
  const outlineOf = wetItems.map((r) => {
    const m = r.pts[Math.floor(r.pts.length / 2)];
    const mid = r.pts.length === 2 ? [(r.pts[0][0] + r.pts[1][0]) / 2, (r.pts[0][1] + r.pts[1][1]) / 2] : m;
    for (let k = 0; k < outlines.length; k++) {
      const b = olBB[k];
      if (mid[0] < b.x0 || mid[0] > b.x1 || mid[1] < b.z0 || mid[1] > b.z1) continue;
      if (pointInRing(mid[0], mid[1], outlines[k].outer)) return k;
    }
    return -1;
  });
  // items within ~15 m of each other belong to the same crossing (both carriageways, pavements, cycle tracks, a
  // footbridge hugging a rail bridge): one shared axis, so their decks agree wherever they overlap
  {
    const C = 15, cells = new Map();
    wetItems.forEach((r, i) => {
      const pts = densify(r.pts, 6);
      for (const p of pts) {
        const cx = Math.floor(p[0] / C), cz = Math.floor(p[1] / C);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const o = cells.get((cx + a) + ',' + (cz + b));
          if (o !== undefined && o !== i) union(i, o);
        }
        cells.set(cx + ',' + cz, i);
      }
    });
  }
  const byOutline = new Map();
  wetItems.forEach((r, i) => { const k = outlineOf[i]; if (k < 0) return; if (byOutline.has(k)) union(i, byOutline.get(k)); else byOutline.set(k, i); });
  // road and rail bridges over the same river crossing sit side by side — separate groups unless they share an outline
  const groups = new Map();
  wetItems.forEach((r, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });
  const decks = [];
  for (const idx of groups.values()) {
    const its = idx.map((i) => wetItems[i]);
    const P = its.flatMap((r) => r.pts);
    let mx = 0, mz = 0;
    for (const p of P) { mx += p[0]; mz += p[1]; }
    mx /= P.length; mz /= P.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const p of P) { const dx = p[0] - mx, dz = p[1] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const ux = Math.cos(ang), uz = Math.sin(ang);
    let t0 = Infinity, t1 = -Infinity;
    for (const p of P) { const t = (p[0] - mx) * ux + (p[1] - mz) * uz; if (t < t0) t0 = t; if (t > t1) t1 = t; }
    const L = t1 - t0;
    if (L < 4) continue;
    // over the Thames: ~3% of the span (8 m cap, ≈9 m above the water); over canals/docks/lakes: a hump of 10% of
    // the water crossed along the axis (2.5 m cap)
    let wetN = 0, riverN = 0;
    for (let t = t0; t <= t1; t += 2) { const v = waterGrid.at(mx + ux * t, mz + uz * t); if (v) wetN++; if (v === 2) riverN++; }
    const river = riverN > wetN / 2 && riverN * 2 > 20;
    const H = Math.round((river ? Math.min(8, Math.max(0.3, 0.03 * L)) : Math.min(2.5, Math.max(0.3, 0.1 * wetN * 2))) * 100) / 100;
    const deck = { deckY: H, axis: [mx + ux * t0, mz + uz * t0, mx + ux * t1, mz + uz * t1].map((v) => Math.round(v * 10) / 10), span: L };
    const names = new Map();
    for (const r of its) {
      r.pts = densify(r.pts, 8);
      r.deck = r.pts.map((p) => Math.round(deckAt(deck, p[0], p[1]) * 100) / 100);
      if (r.name && r.kind && !['footway', 'cycleway', 'steps'].includes(r.kind)) names.set(r.name, (names.get(r.name) || 0) + (r.len || 1));
    }
    deck.name = [...names.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || '';
    deck.outlines = [...new Set(idx.map((i) => outlineOf[i]).filter((k) => k >= 0))];
    deck.items = its;
    decks.push(deck);
  }
  // outlines: take the deck of their group; groups without an outline get a synthetic one (hull of the ways, buffered)
  const bridges = outlines.map((o) => ({ name: o.name, pts: o.outer, deckY: 0, axis: null }));
  for (const d of decks) {
    if (d.outlines.length) {
      for (const k of d.outlines) { bridges[k].deckY = d.deckY; bridges[k].axis = d.axis; if (!bridges[k].name) bridges[k].name = d.name; }
    } else {
      const hw = Math.max(...d.items.map((r) => (r.w || 6) / 2));
      const hull = bufferRing(convexHull(d.items.flatMap((r) => r.pts)), hw);
      // only for compact (straight, parallel) crossings — a hull of a curving group would cover the banks
      const ribbon = d.items.reduce((s, r) => s + polyLength(r.pts) * (r.w || 6), 0);
      if (hull.length >= 3 && ringAreaOf(hull) < 1.8 * ribbon) bridges.push({ name: d.name, pts: ccw(hull.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])), deckY: d.deckY, axis: d.axis, synthetic: true });
    }
  }
  log(`bridge decks: ${decks.length} water crossings; ${bridges.filter((b) => b.deckY > 0).length}/${bridges.length} bridge outlines raised`);
  for (const d of decks.filter((d) => d.span > 150)) log(`  ${d.name || '(unnamed)'}: span ${d.span.toFixed(0)} m, deck ${d.deckY} m, ${d.items.length} ways`);
  return { bridges, decks };
}

const ringAreaOf = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };

// ---- points -----------------------------------------------------------------------------------------------------
const POI_AMENITY = new Set(['pub', 'bar', 'cafe', 'restaurant', 'fast_food', 'theatre', 'cinema', 'nightclub', 'arts_centre', 'library',
  'hospital', 'police', 'townhall', 'university', 'marketplace', 'place_of_worship', 'college', 'events_venue', 'concert_hall']);
const POI_TOURISM = new Set(['museum', 'attraction', 'gallery', 'hotel', 'viewpoint', 'zoo', 'theme_park']);
function poiKind(t) {
  if (t.amenity && POI_AMENITY.has(t.amenity)) return t.amenity;
  if (t.tourism && POI_TOURISM.has(t.tourism)) return t.tourism;
  if (t.historic === 'monument') return 'monument';
  if (t.shop === 'department_store' || t.shop === 'mall') return t.shop;
  if (t.leisure === 'stadium') return 'stadium';
  return null;
}

export function buildPoints(ctx) {
  const { nodes, ways, relations } = ctx;
  const B = expandBounds(WORLD_BOUNDS, 10);
  const signals = [], busStops = [], crossings = [], trees = [], districts = [], pois = [], stationsRaw = [];
  const stationOf = (t) => {
    if (!t.name) return null;
    if (!(t.railway === 'station' || t.railway === 'halt' || (t.public_transport === 'station' && (t.train === 'yes' || t.subway === 'yes' || t.light_rail === 'yes')))) return null;
    const net = (t.network || '') + ';' + (t.operator || '');
    if (/DLR|Docklands/i.test(net) || t.station === 'light_rail') return 'dlr';
    if (t.station === 'subway' || t.subway === 'yes' || /Underground/i.test(net) && !/National Rail/i.test(net)) return 'tube';
    return 'rail';
  };
  for (const n of nodes) {
    const t = n.tags;
    if (!t) continue;
    const [x, z] = ll(n);
    if (!inBounds(x, z, B)) continue;
    const X = Math.round(x * 10) / 10, Z = Math.round(z * 10) / 10;
    if (t.highway === 'traffic_signals') signals.push(X, Z);
    if (t.highway === 'bus_stop') busStops.push(X, Z);
    if (t.highway === 'crossing' || t.railway === 'crossing') {
      const c = t.crossing || '', ref = t.crossing_ref || '';
      if (c === 'traffic_signals' || /pelican|puffin|toucan|pegasus/.test(ref)) crossings.push({ x: X, z: Z, kind: 'signals' });
      else if (c === 'zebra' || c === 'marked' || c === 'uncontrolled' || ref === 'zebra') crossings.push({ x: X, z: Z, kind: 'zebra' });
    }
    if (t.natural === 'tree') trees.push(X, Z);
    if (t.place && t.name && ['suburb', 'quarter', 'neighbourhood', 'locality', 'city'].includes(t.place) && t.name !== 'London' &&
      (t.place !== 'city' || t.name === 'City of London') && !(t.place === 'locality' && /\b(Gate|Corner|Steps)$/.test(t.name))) {
      const rank = { city: 4, suburb: 3, quarter: 2, neighbourhood: 1, locality: 0 }[t.place];
      districts.push({ name: t.name === 'City of London' ? 'The City' : t.name, x: X, z: Z, rank });
    }
    const sk = stationOf(t);
    if (sk) stationsRaw.push({ name: t.name, x: X, z: Z, kind: sk });
    const pk = t.name && poiKind(t);
    if (pk) pois.push({ kind: pk, name: t.name, x: X, z: Z });
  }
  // way/relation POIs & stations (centroids)
  const ringOf = (w) => w.geometry && w.geometry.filter(Boolean).map(ll);
  for (const w of ways.values()) {
    const t = w.tags;
    if (!t) continue;
    if (t.natural === 'tree_row') {
      const pts = ringOf(w);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.round(L / 9));
        for (let j = 0; j < k; j++) {
          const x = a[0] + ((b[0] - a[0]) * j) / k, z = a[1] + ((b[1] - a[1]) * j) / k;
          if (inBounds(x, z, B)) trees.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
        }
      }
      continue;
    }
    const pk = t.name && poiKind(t), sk = stationOf(t);
    if (!pk && !sk) continue;
    const r = ringOf(w);
    if (!r || r.length < 2) continue;
    const c = r.length > 2 ? centroid(r) : r[0];
    if (!inBounds(c[0], c[1], B)) continue;
    const X = Math.round(c[0] * 10) / 10, Z = Math.round(c[1] * 10) / 10;
    if (pk) pois.push({ kind: pk, name: t.name, x: X, z: Z });
    if (sk) stationsRaw.push({ name: t.name, x: X, z: Z, kind: sk });
  }
  // dedupe
  const dedupe = (arr, R) => {
    const out = [];
    const grid = new Map();
    for (const p of arr) {
      const gx = Math.floor(p.x / R), gz = Math.floor(p.z / R);
      let dup = false;
      for (let i = -1; i <= 1 && !dup; i++) for (let j = -1; j <= 1 && !dup; j++) {
        for (const q of grid.get((gx + i) + ',' + (gz + j)) || []) if (q.name === p.name && q.kind === p.kind && Math.hypot(q.x - p.x, q.z - p.z) < R) { dup = true; break; }
      }
      if (dup) continue;
      const k = gx + ',' + gz;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
      out.push(p);
    }
    return out;
  };
  const stations = dedupe(stationsRaw, 300);
  const poisD = dedupe(pois, 60);
  log(`points: ${signals.length / 2} signals, ${busStops.length / 2} bus stops, ${crossings.length} crossings, ${trees.length / 2} trees, ` +
    `${districts.length} districts, ${poisD.length} POIs, ${stations.length} stations`);
  return { signals, busStops, crossings, trees, districts, pois: poisD, stations };
}
