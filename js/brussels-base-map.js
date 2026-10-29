// js/brussels-base-map.js — Workstream E: the live radar minimap + the full-screen "Brussels Street Atlas" (A–Z style).
//
//   import { BrusselsMapSystem } from './brussels-base-map.js';
//   const mapSystem = new BrusselsMapSystem({ controllerManager, cameraSystem, trafficSystem, onTeleport, onToggle });
//   mapSystem.update();                       // every frame (renders the radar, or the full map while it is open)
//   mapSystem.toggleFullMap(true | false);    mapSystem.isFullMapOpen
//   mapSystem.waypoint = { x, z, name };      // (or setWaypoint(x, z, name)) GPS target: a road-following route is drawn
//   mapSystem.setRoute([{x, z}, …] | Float32Array | null, { color })   // external route (RideBXL) — overrides the GPS
//   mapSystem.setPins([{ x, z, kind: 'pickup' | 'dropoff' | 'waypoint' | string, label }])
//
// Same public surface as NYCMapSystem (js/nyc-map.js) so main.js swaps one for the other. Everything is drawn from the
// baked OpenStreetMap geodata (GEO): Thames, docks & lakes, parks, plazas, 78k building footprints, roads by class in a
// Brussels A–Z-ish palette (primary routes red, A roads pink, B roads orange, minor roads white), rail, bridges, street
// names along their course, road-number shields, district / park / river names, landmark pictograms and stations
// (generic square glyph — deliberately no TfL roundel).
//
// Speed: the ground layers are rasterised into 256 px tiles at half-octave zoom levels (LRU cache, rendered a few per
// frame, nearest first, with a whole-city overview canvas as a stand-in until they arrive). The radar blits from a
// cached composite around the player and only rotates it; the full map re-composites tiles + labels when the view moves.

import { GEO } from './bxl-geodata.js';
import { WORLD, BRUSSELS_LANDMARKS, getLocationLabel, isTypingInField, WORLD_BOUNDS } from './city-config.js';
import { toWorld } from './geo-frame.js';

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const IS_BRUSSELS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels';
const MIN_ZOOM = 0.06; // full map, CSS px per metre (all of Zone 1)
const MAX_ZOOM = 6.0;
const RADAR_SCALE = 0.62; // radar CSS px per metre at street level (~460 m across)
const TILE = 256; // device px
const LEVEL_MIN = -12; // half-octave levels: device px per metre = 2^(k/2)
const LEVEL_MAX = 6;
const TILE_CACHE_MAX = 260;
const OVERVIEW_PPM = 0.16; // device px per metre of the whole-city stand-in canvas

// ---------------------------------------------------------------------------------------------------------------------
// Palette — a printed street atlas: warm paper, cream buildings, A-road colours, soft park greens & river blue
// ---------------------------------------------------------------------------------------------------------------------
export const MAP_PALETTE = {
  paper: '#f4f0e5',
  outside: '#e3ddcf',
  water: '#a9cce6',
  waterEdge: '#86b3d6',
  waterText: '#3d73a3',
  parks: {
    park: '#c9e2ab', garden: '#cfe6b2', grass: '#d6eabf', pitch: '#bddc9e', wood: '#aed293',
    cemetery: '#cddbb9', square: '#d3e7bb', playground: '#d9ecc5'
  },
  parkEdge: '#a6cb88',
  parkText: '#4c7a32',
  plaza: '#ebe6da',
  plazaEdge: '#d9d1c1',
  bridgeDeck: '#efeadf',
  bridgeEdge: '#8d8577',
  buildings: ['#dad1be', '#d2c3a4', '#e6c595'], // ordinary, civic/church/station, landmark
  buildingEdge: ['#c6bca8', '#b9a782', '#b98d52'],
  rail: '#7b766d',
  railDash: '#ffffff',
  road: {
    trunk: { m: 13, px: 3.4, cas: 0.9, fill: '#e04e62', edge: '#9e2c3c', minS: 0 },
    primary: { m: 11.5, px: 2.8, cas: 0.85, fill: '#f2939f', edge: '#bf5a67', minS: 0 },
    secondary: { m: 10, px: 2.3, cas: 0.8, fill: '#f8b55e', edge: '#bb7b2c', minS: 0.03 },
    tertiary: { m: 9, px: 1.8, cas: 0.75, fill: '#fbe28c', edge: '#b39b4f', minS: 0.07 },
    minor: { m: 6.5, px: 1.1, cas: 0.65, fill: '#ffffff', edge: '#b3aa99', minS: 0.11, lowFill: '#cdc4b2' },
    ped: { m: 6, px: 1.0, cas: 0.55, fill: '#f2ede3', edge: '#c9bfad', minS: 0.38 },
    service: { m: 4, px: 0.75, cas: 0.5, fill: '#fdfcf8', edge: '#c7bfaf', minS: 0.75 },
    foot: { m: 1.4, px: 0.8, cas: 0, fill: '#a7967b', edge: '', minS: 1.15, dash: true }
  },
  text: '#2f2a22',
  textMinor: '#5b5346',
  halo: 'rgba(255, 255, 255, 0.92)',
  district: 'rgba(92, 78, 60, 0.78)',
  landmark: '#a3243b',
  landmarkText: '#7c1a2c',
  station: { tube: '#1e3f8c', rail: '#3b3b3e', dlr: '#00838c' },
  stationText: '#1e3f8c',
  route: '#1f6fe5',
  routeCasing: '#ffffff',
  search: '#7b3ff2',
  player: '#17181c',
  pins: { pickup: '#14b88f', dropoff: '#f0438f', waypoint: '#1f6fe5' }
};
const P = MAP_PALETTE;

const ROAD_CLASS = {
  motorway: 'trunk', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary',
  unclassified: 'minor', residential: 'minor', living_street: 'minor', service: 'service', pedestrian: 'ped',
  footway: 'foot', cycleway: 'foot', steps: 'foot'
};
const ROAD_ORDER = ['foot', 'service', 'ped', 'minor', 'tertiary', 'secondary', 'primary', 'trunk'];
const MAJOR = new Set(['trunk', 'primary', 'secondary']);
const NOTABLE_KINDS = new Set([5, 6, 7]); // BUILDING_KINDS civic, church, station

// ---------------------------------------------------------------------------------------------------------------------
// Geometry helpers (flat [x0, z0, x1, z1, …] point lists in world metres)
// ---------------------------------------------------------------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function bboxOf(p, b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }) {
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], z = p[i + 1];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

function signedArea(p) {
  let a = 0;
  for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1];
  return a / 2;
}

// Rings are appended with one consistent winding (outer) or the opposite (holes), so nonzero fills union / cut
function addRing(path, p, hole = false) {
  const n = p.length >> 1;
  if (n < 3) return;
  const ccw = signedArea(p) < 0;
  if (ccw !== hole) {
    path.moveTo(p[0], p[1]);
    for (let i = 1; i < n; i++) path.lineTo(p[2 * i], p[2 * i + 1]);
  } else {
    path.moveTo(p[2 * n - 2], p[2 * n - 1]);
    for (let i = n - 2; i >= 0; i--) path.lineTo(p[2 * i], p[2 * i + 1]);
  }
  path.closePath();
}

function addLine(path, p) {
  if (p.length < 4) return;
  path.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
}

const toFlat = (pts) => {
  if (!pts) return null;
  if (typeof pts[0] === 'number') return pts;
  const out = new Float32Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    out[2 * i] = pts[i].x;
    out[2 * i + 1] = pts[i].z;
  }
  return out;
};

const overlaps = (boxes, b) => {
  for (let i = 0; i < boxes.length; i++) {
    const o = boxes[i];
    if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return true;
  }
  return false;
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------
// Vector layers, binned in 400 m cells (each item goes to the bin holding its bbox centre; the bin's bbox grows)
// ---------------------------------------------------------------------------------------------------------------------
let BINS = null;
function vectorBins() {
  if (BINS) return BINS;
  const t0 = performance.now();
  const SIZE = 400;
  const map = new Map();
  const binFor = (b) => {
    const ix = Math.floor((b.minX + b.maxX) * 0.5 / SIZE);
    const iz = Math.floor((b.minZ + b.maxZ) * 0.5 / SIZE);
    const key = ix * 4096 + iz;
    let bin = map.get(key);
    if (!bin) {
      bin = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, layers: {} };
      map.set(key, bin);
    } else {
      bin.minX = Math.min(bin.minX, b.minX);
      bin.maxX = Math.max(bin.maxX, b.maxX);
      bin.minZ = Math.min(bin.minZ, b.minZ);
      bin.maxZ = Math.max(bin.maxZ, b.maxZ);
    }
    return bin;
  };
  const pathOf = (bin, key) => bin.layers[key] || (bin.layers[key] = new Path2D());
  const area = (key, pts, holes) => {
    if (!pts || pts.length < 6) return;
    const b = bboxOf(pts);
    const path = pathOf(binFor(b), key);
    addRing(path, pts, false);
    if (holes) for (const h of holes) addRing(path, h, true);
  };
  const line = (key, pts) => {
    if (!pts || pts.length < 4) return;
    addLine(pathOf(binFor(bboxOf(pts)), key), pts);
  };

  for (const p of GEO.parks) area('park:' + (P.parks[p.kind] ? p.kind : 'park'), p.pts, p.holes);
  for (const w of GEO.water) area('water', w.pts, w.holes);
  for (const p of GEO.plazas) area('plaza', p.pts);
  for (const b of GEO.bridges) if (b.deckY > 0) area('bridgeDeck', b.pts);

  // buildings (struct of arrays)
  const B = GEO.buildings;
  const tmpB = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  for (let i = 0; i < B.count; i++) {
    const s = B.ringStart[i], e = B.ringStart[i + 1];
    if (e - s < 3) continue;
    if (B.minHeight[i] > 0 && B.height[i] - B.minHeight[i] < 2) continue; // canopies / thin roof parts
    const ring = B.xz.subarray(s * 2, e * 2);
    tmpB.minX = Infinity; tmpB.maxX = -Infinity; tmpB.minZ = Infinity; tmpB.maxZ = -Infinity;
    bboxOf(ring, tmpB);
    const tone = B.landmark[i] ? 2 : NOTABLE_KINDS.has(B.kind[i]) ? 1 : 0;
    addRing(pathOf(binFor(tmpB), 'bld' + tone), ring);
  }

  for (const r of GEO.rail) line('rail', r.pts);
  for (const r of GEO.roads) {
    const cls = ROAD_CLASS[r.kind];
    if (!cls || r.tunnel) continue;
    if (r.sub === 'sidewalk' || r.sub === 'crossing') continue;
    if (cls === 'service' && (r.sub === 'parking_aisle' || r.sub === 'driveway')) continue;
    line(r.deck && cls !== 'foot' ? cls + 'B' : cls, r.pts);
  }
  BINS = { list: [...map.values()], ms: performance.now() - t0 };
  return BINS;
}

/** Draws the ground (no text) for the world rect in view, through the current world transform; s = CSS px per metre */
function drawGround(ctx, rect, s) {
  const bins = vectorBins().list;
  const pad = 30;
  const vis = [];
  for (const b of bins) {
    if (b.maxX < rect.minX - pad || b.minX > rect.maxX + pad || b.maxZ < rect.minZ - pad || b.minZ > rect.maxZ + pad) continue;
    vis.push(b);
  }
  const px = (n) => n / s; // CSS px -> metres
  const each = (key, fn) => { for (const b of vis) { const p = b.layers[key]; if (p) fn(p); } };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // parks (largest first: GEO order), water, plazas
  for (const kind of Object.keys(P.parks)) {
    ctx.fillStyle = P.parks[kind];
    each('park:' + kind, (p) => ctx.fill(p));
  }
  if (s >= 0.35) {
    ctx.strokeStyle = P.parkEdge;
    ctx.lineWidth = px(0.7);
    each('park:park', (p) => ctx.stroke(p));
  }
  ctx.fillStyle = P.water;
  each('water', (p) => ctx.fill(p));
  if (s >= 0.2) {
    ctx.strokeStyle = P.waterEdge;
    ctx.lineWidth = px(s >= 0.8 ? 1.2 : 0.8);
    each('water', (p) => ctx.stroke(p));
  }
  if (s >= 0.18) {
    ctx.fillStyle = P.plaza;
    each('plaza', (p) => ctx.fill(p));
    if (s >= 0.9) {
      ctx.strokeStyle = P.plazaEdge;
      ctx.lineWidth = px(0.6);
      each('plaza', (p) => ctx.stroke(p));
    }
  }

  // buildings
  ctx.globalAlpha = s < 0.09 ? 0.75 : 1;
  for (let t = 0; t < 3; t++) {
    ctx.fillStyle = P.buildings[t];
    each('bld' + t, (p) => ctx.fill(p));
  }
  ctx.globalAlpha = 1;
  if (s >= 0.55) {
    ctx.lineWidth = px(s >= 1.5 ? 0.8 : 0.6);
    for (let t = 0; t < 3; t++) {
      ctx.strokeStyle = P.buildingEdge[t];
      each('bld' + t, (p) => ctx.stroke(p));
    }
  }

  // bridge decks over the water
  ctx.fillStyle = P.bridgeDeck;
  each('bridgeDeck', (p) => ctx.fill(p));
  if (s >= 0.12) {
    ctx.strokeStyle = P.bridgeEdge;
    ctx.lineWidth = px(0.9);
    each('bridgeDeck', (p) => ctx.stroke(p));
  }

  // rail: grey line, white dashes at street zoom (atlas style)
  if (s >= 0.05) {
    ctx.strokeStyle = P.rail;
    ctx.lineWidth = px(s >= 0.4 ? 2.6 : 1.4);
    ctx.lineCap = 'butt';
    each('rail', (p) => ctx.stroke(p));
    if (s >= 0.4) {
      ctx.strokeStyle = P.railDash;
      ctx.lineWidth = px(1.1);
      ctx.setLineDash([px(5), px(5)]);
      each('rail', (p) => ctx.stroke(p));
      ctx.setLineDash([]);
    }
    ctx.lineCap = 'round';
  }

  // roads: every casing first, then the fills from minor to major (junctions merge cleanly)
  const width = (st) => Math.max(px(st.px), st.m);
  const drawRoads = (suffix) => {
    for (const cls of ROAD_ORDER) {
      const st = P.road[cls];
      if (s < st.minS || !st.cas) continue;
      if (cls === 'minor' && s < 0.22) continue;
      if (MAJOR.has(cls) || cls === 'tertiary' ? s < 0.1 : false) continue;
      ctx.strokeStyle = suffix ? '#5d564b' : st.edge;
      ctx.lineWidth = width(st) + px(st.cas * 2 + (suffix ? 0.8 : 0));
      if (suffix) ctx.lineCap = 'butt';
      each(cls + suffix, (p) => ctx.stroke(p));
      ctx.lineCap = 'round';
    }
    for (const cls of ROAD_ORDER) {
      const st = P.road[cls];
      if (s < st.minS) continue;
      const low = cls === 'minor' && s < 0.22;
      ctx.strokeStyle = low ? st.lowFill : st.fill;
      ctx.lineWidth = low ? px(0.75) : width(st);
      if (st.dash) ctx.setLineDash([px(2.5), px(2)]);
      each(cls + suffix, (p) => ctx.stroke(p));
      if (st.dash) ctx.setLineDash([]);
    }
  };
  drawRoads('');
  drawRoads('B');
}

// ---------------------------------------------------------------------------------------------------------------------
// Labels: street names (anchored along straight runs), road-number shields, districts, parks, the river, stations
// ---------------------------------------------------------------------------------------------------------------------
const ROAD_LABELS = [];
const REF_LABELS = [];
/** label anchors along the straight-ish runs of a polyline: [{x, z, ang, len}] (angle never upside down) */
function runAnchors(p, spacing = 220) {
  const anchors = [];
  for (let i = 0; i + 3 < p.length;) {
    const ax = p[i], az = p[i + 1];
    const dir = Math.atan2(p[i + 3] - az, p[i + 2] - ax);
    let j = i + 2;
    while (j + 3 < p.length) {
      const d = Math.atan2(p[j + 3] - p[j + 1], p[j + 2] - p[j]);
      let turn = Math.abs(d - dir);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 0.22) break;
      j += 2;
    }
    const cx = p[j], cz = p[j + 1];
    i = j;
    const len = Math.hypot(cx - ax, cz - az);
    if (len < 18) continue;
    let ang = Math.atan2(cz - az, cx - ax);
    if (ang > Math.PI / 2) ang -= Math.PI;
    else if (ang <= -Math.PI / 2) ang += Math.PI;
    const k = Math.max(1, Math.round(len / spacing));
    for (let m = 0; m < k; m++) {
      const t = (m + 0.5) / k;
      anchors.push({ x: ax + (cx - ax) * t, z: az + (cz - az) * t, ang, len: len / k });
    }
  }
  return anchors;
}

/** joins polylines that share end points (OSM splits a street into many short ways) into longer chains */
function chainLines(lines) {
  const key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const ends = new Map();
  lines.forEach((p, i) => {
    for (const [x, z] of [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]]) {
      const k = key(x, z);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Uint8Array(lines.length);
  const chains = [];
  const reverse = (p) => { const o = new Float32Array(p.length); for (let i = 0; i < p.length; i += 2) { o[i] = p[p.length - 2 - i]; o[i + 1] = p[p.length - 1 - i]; } return o; };
  for (let s = 0; s < lines.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    let chain = Array.from(lines[s]);
    for (let dirPass = 0; dirPass < 2; dirPass++) {
      for (let grow = true; grow;) {
        grow = false;
        const tx = chain[chain.length - 2], tz = chain[chain.length - 1];
        const cand = ends.get(key(tx, tz)) || [];
        for (const c of cand) {
          if (used[c]) continue;
          let q = lines[c];
          if (Math.hypot(q[0] - tx, q[1] - tz) > 1) q = reverse(q);
          if (Math.hypot(q[0] - tx, q[1] - tz) > 1) continue;
          used[c] = 1;
          for (let i = 2; i < q.length; i++) chain.push(q[i]);
          grow = true;
          break;
        }
      }
      chain = Array.from(reverse(chain)); // second pass grows the other end
    }
    chains.push(Float32Array.from(chain));
  }
  return chains;
}

(function buildRoadLabels() {
  const refRuns = new Map();
  const groups = new Map(); // name -> { rank, cls, lines }
  for (const r of GEO.roads) {
    const cls = ROAD_CLASS[r.kind];
    if (!cls || r.tunnel || r.sub === 'sidewalk' || r.sub === 'crossing') continue;
    if (cls === 'foot' || (cls === 'service' && !r.name)) continue;
    if (r.pts.length < 4) continue;
    if (r.name) {
      let g = groups.get(r.name);
      if (!g) groups.set(r.name, (g = { rank: -1, cls, lines: [] }));
      const rank = ROAD_ORDER.indexOf(cls);
      if (rank > g.rank) { g.rank = rank; g.cls = cls; }
      g.lines.push(r.pts);
    }
    if (r.ref && /^[AB]\d/.test(r.ref) && (cls === 'trunk' || cls === 'primary' || cls === 'secondary')) {
      const ref = r.ref.split(';')[0].trim();
      let e = refRuns.get(ref);
      if (!e) refRuns.set(ref, (e = { ref, trunk: cls === 'trunk', b: ref[0] === 'B', lines: [], anchors: [] }));
      if (cls === 'trunk') e.trunk = true;
      e.lines.push(r.pts);
    }
  }
  for (const [name, g] of groups) {
    for (const chain of chainLines(g.lines)) {
      const anchors = runAnchors(chain);
      if (!anchors.length) continue;
      ROAD_LABELS.push({ text: name, lower: name.toLowerCase(), pts: chain, cls: g.cls, rank: g.rank, anchors, ...bboxOf(chain) });
    }
  }
  for (const e of refRuns.values()) {
    for (const chain of chainLines(e.lines)) for (const a of runAnchors(chain, 400)) if (a.len > 60) e.anchors.push(a);
    delete e.lines;
    if (e.anchors.length) REF_LABELS.push(e);
  }
})();
const STREET_COUNT = new Set(ROAD_LABELS.map((l) => l.text)).size;

const polyCentroid = (p) => {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) {
    const f = p[j] * p[i + 1] - p[i] * p[j + 1];
    a += f;
    cx += (p[j] + p[i]) * f;
    cz += (p[j + 1] + p[i + 1]) * f;
  }
  return a ? { x: cx / (3 * a), z: cz / (3 * a), area: Math.abs(a / 2) } : { x: p[0], z: p[1], area: 0 };
};
const PARK_LABELS = (() => {
  const seen = new Map();
  for (const p of GEO.parks) {
    if (!p.name || !(p.kind === 'park' || p.kind === 'garden' || p.kind === 'square' || p.kind === 'cemetery' || p.kind === 'wood')) continue;
    const c = polyCentroid(p.pts);
    if (c.area < 6000) continue;
    const prev = seen.get(p.name);
    if (!prev || prev.area < c.area) seen.set(p.name, { text: p.name, x: c.x, z: c.z, area: c.area });
  }
  return [...seen.values()].sort((a, b) => b.area - a.area);
})();

// "RIVER THAMES" along its reaches (anchors at the real reaches; angle from the neighbours)
const RIVER_LABELS = (() => {
  const reaches = [[51.4826, -0.1705], [51.4852, -0.1395], [51.4925, -0.1238], [51.5023, -0.1211], [51.5081, -0.1117],
    [51.5086, -0.0965], [51.5066, -0.0815]].map(([lat, lon]) => toWorld(lat, lon));
  const out = [];
  for (let i = 0; i < reaches.length; i++) {
    let { x, z } = reaches[i];
    if (!WORLD.isWater(x, z)) {
      let found = false;
      for (let r = 20; r <= 220 && !found; r += 20) {
        for (let a = 0; a < 16 && !found; a++) {
          const tx = x + Math.cos(a * Math.PI / 8) * r, tz = z + Math.sin(a * Math.PI / 8) * r;
          if (WORLD.isWater(tx, tz)) { x = tx; z = tz; found = true; }
        }
      }
      if (!found) continue;
    }
    const a = reaches[Math.max(0, i - 1)], b = reaches[Math.min(reaches.length - 1, i + 1)];
    let ang = Math.atan2(b.z - a.z, b.x - a.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    else if (ang <= -Math.PI / 2) ang += Math.PI;
    out.push({ x, z, ang });
  }
  return out;
})();

const DISTRICTS = GEO.districts.filter((d) => d.rank >= 1 && !/Estate$/.test(d.name)).sort((a, b) => b.rank - a.rank);

// Landmark pictogram by id
const LANDMARK_GLYPH = {
  bigBen: 'clock', brusselsEye: 'wheel', towerBridge: 'bridge', shard: 'shard', stPauls: 'dome', gherkin: 'gherkin',
  buckinghamPalace: 'palace', trafalgarSquare: 'column', piccadillyCircus: 'star', batterseaPowerStation: 'chimneys',
  towerOfBrussels: 'castle', westminsterAbbey: 'church', britishMuseum: 'museum', coventGarden: 'market', boroughMarket: 'market',
  kingsCross: 'train', royalAlbertHall: 'dome', tateModern: 'museum', millenniumBridge: 'bridge', somersetHouse: 'museum',
  naturalHistoryMuseum: 'museum'
};

// ---------------------------------------------------------------------------------------------------------------------
// Map viewport
// ---------------------------------------------------------------------------------------------------------------------
class MapView {
  constructor(cx, cz, s, w, h, dpr = 1) {
    this.cx = cx; this.cz = cz; this.s = s; this.w = w; this.h = h; this.dpr = dpr;
    this.minX = cx - w / (2 * s); this.maxX = cx + w / (2 * s);
    this.minZ = cz - h / (2 * s); this.maxZ = cz + h / (2 * s);
  }
  screen(ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * this.w * 0.5, this.dpr * this.h * 0.5); }
  toX(x) { return (x - this.cx) * this.s; }
  toY(z) { return (z - this.cz) * this.s; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Small drawing helpers (screen space, CSS px)
// ---------------------------------------------------------------------------------------------------------------------
function haloText(ctx, text, x, y, fill, halo = P.halo, lw = 3) {
  ctx.lineWidth = lw;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** white pictogram of a landmark on a deep red disc, radius r */
function drawLandmarkGlyph(ctx, kind, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r + 1.6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = P.landmark;
  ctx.fill();
  const u = r / 7; // glyphs drawn on a 14-unit square
  ctx.scale(u, u);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const rect = (a, b, w, h) => ctx.fillRect(a, b, w, h);
  ctx.beginPath();
  switch (kind) {
    case 'clock': rect(-1.6, -2.2, 3.2, 6.6); ctx.moveTo(-1.9, -2.2); ctx.lineTo(0, -5.4); ctx.lineTo(1.9, -2.2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -0.6, 1.0, 0, Math.PI * 2); ctx.fillStyle = P.landmark; ctx.fill(); break;
    case 'wheel': ctx.arc(0, -0.6, 3.6, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 4; ctx.moveTo(Math.cos(a) * 3.6, -0.6 + Math.sin(a) * 3.6); ctx.lineTo(-Math.cos(a) * 3.6, -0.6 - Math.sin(a) * 3.6); }
      ctx.lineWidth = 0.7; ctx.stroke(); ctx.beginPath(); ctx.lineWidth = 1.1; ctx.moveTo(-2, 4.4); ctx.lineTo(0, -0.6); ctx.lineTo(2, 4.4); ctx.stroke(); break;
    case 'bridge': rect(-4.4, -3.6, 1.8, 7.4); rect(2.6, -3.6, 1.8, 7.4); rect(-5.4, 0.8, 10.8, 1.2); rect(-2.6, -2.6, 5.2, 0.9); break;
    case 'shard': ctx.moveTo(0, -5.6); ctx.lineTo(3.0, 4.4); ctx.lineTo(-3.0, 4.4); ctx.closePath(); ctx.fill(); break;
    case 'dome': ctx.arc(0, 0.6, 3.4, Math.PI, 0); ctx.fill(); rect(-4.2, 0.6, 8.4, 3.6); rect(-0.5, -4.6, 1.0, 2.4); break;
    case 'gherkin': ctx.moveTo(0, -5.4); ctx.bezierCurveTo(4.2, -3, 3.6, 3, 2.0, 4.4); ctx.lineTo(-2.0, 4.4); ctx.bezierCurveTo(-3.6, 3, -4.2, -3, 0, -5.4); ctx.fill(); break;
    case 'palace': rect(-5, -0.6, 10, 4.6); rect(-1.6, -2.4, 3.2, 1.9); ctx.moveTo(0, -2.4); ctx.lineTo(0, -5.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -5.6); ctx.lineTo(2.4, -4.9); ctx.lineTo(0, -4.2); ctx.fill(); break;
    case 'column': rect(-0.75, -3.6, 1.5, 7); rect(-2.2, 3.2, 4.4, 1.2); ctx.arc(0, -4.4, 1.1, 0, Math.PI * 2); ctx.fill(); break;
    case 'chimneys': rect(-4.6, -0.4, 9.2, 4.8); for (const cx of [-4.2, -2.4, 1.6, 3.4]) rect(cx, -5, 0.9, 4.6); break;
    case 'castle': rect(-4.4, -1.4, 8.8, 5.8); for (const cx of [-4.4, -1.8, 0.8, 3.4]) rect(cx, -3.0, 1.0, 1.8);
      ctx.fillStyle = P.landmark; rect(-1, 1.6, 2, 2.8); break;
    case 'church': rect(-4, -1.6, 2.6, 6); rect(1.4, -1.6, 2.6, 6); rect(-1.4, 0.6, 2.8, 3.8);
      ctx.moveTo(-4, -1.6); ctx.lineTo(-2.7, -5); ctx.lineTo(-1.4, -1.6); ctx.moveTo(1.4, -1.6); ctx.lineTo(2.7, -5); ctx.lineTo(4, -1.6); ctx.fill(); break;
    case 'museum': ctx.moveTo(-5, -1.4); ctx.lineTo(0, -4.8); ctx.lineTo(5, -1.4); ctx.fill(); for (const cx of [-4, -1.8, 0.6, 2.8]) rect(cx, -0.6, 1.2, 4); rect(-5, 3.4, 10, 1.1); break;
    case 'market': ctx.moveTo(-5, -0.4); ctx.arc(0, -0.4, 5, Math.PI, 0); ctx.fill(); rect(-4.4, -0.4, 1.1, 4.8); rect(3.3, -0.4, 1.1, 4.8); rect(-0.55, -0.4, 1.1, 4.8); break;
    case 'train': roundRect(ctx, -3.4, -4.6, 6.8, 8.2, 1.6); ctx.fill(); ctx.fillStyle = P.landmark; rect(-2.4, -3.4, 4.8, 2.6);
      ctx.beginPath(); ctx.arc(-1.6, 1.6, 0.7, 0, Math.PI * 2); ctx.arc(1.6, 1.6, 0.7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(-3, 5.4); ctx.lineTo(-1.6, 3.6); ctx.moveTo(3, 5.4); ctx.lineTo(1.6, 3.6); ctx.stroke(); break;
    default: // star
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rr = i % 2 ? 2.1 : 4.8; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** generic station glyph: a rounded square with a little white train front (no roundel) */
function drawStationGlyph(ctx, kind, x, y, size) {
  const h = size / 2;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x - h - 1.2, y - h - 1.2, size + 2.4, size + 2.4, 3.2);
  ctx.fill();
  ctx.fillStyle = P.station[kind] || P.station.rail;
  roundRect(ctx, x - h, y - h, size, size, 2.4);
  ctx.fill();
  if (size >= 9) {
    const u = size / 12;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x - 3.2 * u, y - 4 * u, 6.4 * u, 7 * u, 1.4 * u);
    ctx.fill();
    ctx.fillStyle = P.station[kind] || P.station.rail;
    ctx.fillRect(x - 2.2 * u, y - 3 * u, 4.4 * u, 2.4 * u);
    ctx.fillRect(x - 0.6 * u, y + 3 * u, 1.2 * u, 1.6 * u);
  }
}

function drawPin(ctx, x, y, color, glyph = '') {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-3, -6, -9, -10, -9, -17);
  ctx.arc(0, -17, 9, Math.PI, 0);
  ctx.bezierCurveTo(9, -10, 3, -6, 0, 0);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -17, 4.6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (glyph) {
    ctx.fillStyle = color;
    ctx.font = `800 7px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 0, -16.6);
  }
  ctx.restore();
}

function drawPlayerArrow(ctx, tipY, halfWidth, tailY) {
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(halfWidth, tailY);
  ctx.lineTo(0, tailY * 0.45);
  ctx.lineTo(-halfWidth, tailY);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.2;
  ctx.stroke();
  ctx.fillStyle = P.player;
  ctx.fill();
}

/** polyline through screen points [[x, y], …]: white casing + coloured core */
function strokeRoute(ctx, pts, color, width) {
  if (pts.length < 2) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = P.routeCasing;
  ctx.lineWidth = width + 3.5;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

let STYLE_DONE = false;
function injectMapStyle() {
  if (STYLE_DONE || typeof document === 'undefined') return;
  STYLE_DONE = true;
  const el = document.createElement('style');
  el.id = 'bxl-map-style';
  el.textContent = `
#minimap-card.panel.radar{background:${P.paper}}
.radar.bxl-rot .radar-north{transition:none}
.bxl-legend-road{width:18px;height:6px;border-radius:3px;display:inline-block;flex:none}
.bxl-legend-station{width:11px;height:11px;border-radius:3px;background:${P.station.tube};box-shadow:0 0 0 1.5px #fff;display:inline-block;flex:none}
.bxl-legend-landmark{width:11px;height:11px;border-radius:50%;background:${P.landmark};box-shadow:0 0 0 1.5px #fff;display:inline-block;flex:none}
.bxl-legend-gps{width:18px;height:4px;border-radius:2px;background:${P.route};display:inline-block;flex:none;box-shadow:0 0 0 1.5px #fff}
.bxl-legend-park{width:12px;height:10px;border-radius:2px;background:${P.parks.park};display:inline-block;flex:none}
.fullmap-modal .fullmap-canvas-wrap{background:${P.paper}}
`;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------------------------------------------------
// The map system
// ---------------------------------------------------------------------------------------------------------------------
class BrusselsMapSystem {
  /**
   * @param {object} o
   * @param {object} o.controllerManager   needs getActiveEntity() -> { position: {x, y, z}, heading, speed }
   * @param {object} [o.cameraSystem]      { currentPos, currentLookAt } (radar rotation & view cone)
   * @param {object} [o.trafficSystem]     { cars: [{x, z}] } radar blips
   * @param {(x, z, heading?) => void} [o.onTeleport]  full-map click
   * @param {(open: boolean) => void} [o.onToggle]
   * @param {(wp: {x, z, name} | null) => void} [o.onWaypointChange]
   * @param {boolean} [o.rotateMinimap=true]  radar turns with the camera (north marker orbits the rim)
   * @param {object} [o.roadGraph]  a RoadGraph (js/ridebxl.js) to share; otherwise one is built on the first GPS route
   */
  constructor({ controllerManager, cameraSystem = null, trafficSystem = null, onTeleport = null, onToggle = null,
    onWaypointChange = null, rotateMinimap = true, roadGraph = null } = {}) {
    this.controllerManager = controllerManager;
    this.cameraSystem = cameraSystem;
    this.trafficSystem = trafficSystem;
    this.onTeleport = onTeleport;
    this.onToggle = onToggle;
    this.onWaypointChange = onWaypointChange;
    this.rotateMinimap = rotateMinimap;
    this.roadGraph = roadGraph;
    injectMapStyle();

    this.tiles = new Map(); // key -> canvas (LRU by insertion order)
    this.tileQueue = new Map(); // key -> {k, ix, iz, dpr, d}
    this.tilesVersion = 0;
    this.overview = null;
    this.textWidths = new Map();

    this.miniCanvas = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCanvas ? this.miniCanvas.getContext('2d') : null;
    this.miniCard = document.getElementById('minimap-card');
    this.elMiniNorth = this.miniCard ? this.miniCard.querySelector('.radar-north') : null;
    this.elMiniStreet = document.getElementById('minimap-street-label');
    this.miniStreetText = '';
    this.miniScale = RADAR_SCALE;
    this.miniCache = null;
    this.miniLabels = null;
    if (this.miniCard && rotateMinimap) this.miniCard.classList.add('bxl-rot');

    this.modal = document.getElementById('fullmap-modal');
    this.fullCanvas = document.getElementById('fullmap-canvas');
    this.fullCanvasWrap = document.getElementById('fullmap-canvas-wrap');
    this.fullCtx = this.fullCanvas ? this.fullCanvas.getContext('2d') : null;
    this.fullDpr = 1;
    this.fullBase = null;
    this.fullBaseKey = '';
    this.fullLabels = null;
    this.fullLabelsKey = '';
    this.elHoverInfo = document.getElementById('fullmap-hover-info');
    this.elPlayerInfo = document.getElementById('fullmap-player-info');
    this.elSearchInput = document.getElementById('fullmap-search');
    this.applyDomText();

    this.isFullMapOpen = false;
    this.viewCenterX = 0;
    this.viewCenterZ = 0;
    this.viewZoom = 0.5;
    this.pointers = new Map();
    this.panPointerId = null;
    this.panStart = { x: 0, y: 0, cx: 0, cz: 0 };
    this.pinch = null;
    this.dragMoved = false;
    this.longPressTimer = 0;

    this.searchHighlight = '';
    this.searchPath = null;

    this._waypoint = null;
    this.gpsRoute = null; // Float32Array world pts (road-following, from the GPS)
    this.gpsCheckT = 0;
    this.gpsLastRoute = 0;
    this.extRoute = null; // { pts: Float32Array, color }
    this.routePin = null;
    this.pins = [];
    this.lastFrame = performance.now();

    if (document.fonts) {
      document.fonts.ready.then(() => {
        this.textWidths.clear();
        this.miniCache = null;
        this.fullLabelsKey = '';
      });
    }
    this.initEvents();
  }

  /** builds the vector layers & the whole-city overview now (≈0.3–1 s) — call behind the loading screen */
  prewarm() {
    vectorBins();
    this.getOverview();
  }

  // -------------------------------------------------------------------------------------------------------- DOM text
  applyDomText() {
    const counts = document.getElementById('fullmap-counts');
    if (counts) counts.textContent = `${STREET_COUNT.toLocaleString('en-GB')} streets · ${GEO.buildings.count.toLocaleString('en-GB')} buildings`;
    if (this.elSearchInput) this.elSearchInput.placeholder = 'Search streets, stations & landmarks — Strand, Baker St, Big Ben…';
    const needle = document.getElementById('map-compass-needle');
    if (needle) needle.setAttribute('transform', 'rotate(0 22 22)');
    const compass = document.querySelector('.map-compass');
    if (compass) compass.title = 'North is up';
    const fit = document.getElementById('map-view-all');
    if (fit) {
      fit.title = IS_BRUSSELS ? 'All of central Brussels' : 'All of Zone 1 (Paddington to Tower Bridge)';
      fit.setAttribute('aria-label', IS_BRUSSELS ? 'Fit all of central Brussels' : 'Fit all of central Brussels');
    }
    const legend = document.querySelector('.fullmap-legend');
    if (legend) {
      const item = (cls, label, style) => {
        const el = document.createElement('span');
        el.className = 'legend-item';
        const sw = document.createElement('span');
        sw.className = cls;
        if (style) sw.style.background = style;
        el.append(sw, document.createTextNode(label));
        return el;
      };
      const you = item('legend-swatch player-swatch', 'You');
      you.firstChild.style.background = P.player;
      const nodes = [you, item('bxl-legend-gps', 'GPS route'), item('bxl-legend-road', 'Primary route', P.road.trunk.fill),
        item('bxl-legend-road', 'A road', P.road.primary.fill), item('bxl-legend-road', 'B road', P.road.secondary.fill),
        item('bxl-legend-station', 'Station'), item('bxl-legend-landmark', 'Landmark')];
      if (counts) nodes.push(counts);
      legend.replaceChildren(...nodes);
    }
  }

  // ---------------------------------------------------------------------------------------------------------- events
  initEvents() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    if (this.miniCard) this.miniCard.addEventListener('click', () => this.toggleFullMap(true));
    on('close-fullmap-btn', () => this.toggleFullMap(false));
    on('map-zoom-in', () => this.zoomAt(1.5));
    on('map-zoom-out', () => this.zoomAt(1 / 1.5));
    on('map-center-player', () => {
      const ent = this.controllerManager.getActiveEntity();
      this.viewCenterX = ent.position.x;
      this.viewCenterZ = ent.position.z;
      this.viewZoom = 1.6;
      this.renderFullMap();
    });
    on('map-view-all', () => this.fitWorld());
    if (this.elSearchInput) this.elSearchInput.addEventListener('input', () => this.search(this.elSearchInput.value));

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isFullMapOpen) this.toggleFullMap(false);
      else if (e.code === 'KeyM' && !isTypingInField(e)) this.toggleFullMap(!this.isFullMapOpen);
    });

    const cv = this.fullCanvas;
    if (!cv) return;
    cv.style.touchAction = 'none';
    const local = (e) => { const r = cv.getBoundingClientRect(); return { mx: e.clientX - r.left, my: e.clientY - r.top, w: r.width, h: r.height }; };
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { mx, my, w, h } = local(e);
      this.pickAt(mx, my, w, h, false);
    });
    cv.addEventListener('pointerdown', (e) => {
      if (!this.isFullMapOpen || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.panPointerId = e.pointerId;
        this.dragMoved = false;
        this.panStart = { x: e.clientX, y: e.clientY, cx: this.viewCenterX, cz: this.viewCenterZ };
        if (this.fullCanvasWrap) this.fullCanvasWrap.classList.add('is-panning');
        clearTimeout(this.longPressTimer);
        if (e.pointerType !== 'mouse') {
          this.longPressTimer = setTimeout(() => {
            if (!this.dragMoved && this.pointers.size === 1) {
              this.dragMoved = true; // consumed
              const { mx, my, w, h } = local(e);
              this.pickAt(mx, my, w, h, false);
            }
          }, 550);
        }
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const r = cv.getBoundingClientRect();
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.viewZoom, world: this.screenToWorld(mid.x, mid.y, r.width, r.height) };
        this.dragMoved = true;
        clearTimeout(this.longPressTimer);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.isFullMapOpen) return;
      const p = this.pointers.get(e.pointerId);
      const { mx, my, w, h } = local(e);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
        if (this.pinch && this.pointers.size >= 2) {
          const [a, b] = [...this.pointers.values()];
          const r = cv.getBoundingClientRect();
          const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
          this.viewZoom = clamp(this.pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d), MIN_ZOOM, MAX_ZOOM);
          this.viewCenterX = this.pinch.world.x - (mid.x - r.width / 2) / this.viewZoom;
          this.viewCenterZ = this.pinch.world.z - (mid.y - r.height / 2) / this.viewZoom;
          this.renderFullMap();
          return;
        }
        if (e.pointerId === this.panPointerId) {
          const dx = e.clientX - this.panStart.x, dy = e.clientY - this.panStart.y;
          if (Math.hypot(dx, dy) > 5) { this.dragMoved = true; clearTimeout(this.longPressTimer); }
          this.viewCenterX = this.panStart.cx - dx / this.viewZoom;
          this.viewCenterZ = this.panStart.cz - dy / this.viewZoom;
          this.renderFullMap();
          return;
        }
      }
      if (e.pointerType === 'mouse' && this.elHoverInfo && mx >= 0 && my >= 0 && mx <= w && my <= h) {
        const wp = this.screenToWorld(mx, my, w, h);
        this.elHoverInfo.textContent = `${getLocationLabel(wp.x, wp.z).text} · Click to teleport · Right-click to set GPS`;
      }
    });
    const end = (e, cancelled) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      clearTimeout(this.longPressTimer);
      if (this.pointers.size < 2) this.pinch = null;
      if (e.pointerId === this.panPointerId) {
        const clicked = !cancelled && !this.dragMoved && Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) <= 5;
        this.panPointerId = this.pointers.size ? [...this.pointers.keys()][0] : null;
        if (this.panPointerId !== null) {
          const q = this.pointers.get(this.panPointerId);
          this.panStart = { x: q.x, y: q.y, cx: this.viewCenterX, cz: this.viewCenterZ };
        }
        if (this.fullCanvasWrap && !this.pointers.size) this.fullCanvasWrap.classList.remove('is-panning');
        if (clicked && this.isFullMapOpen) {
          const { mx, my, w, h } = local(e);
          if (mx >= 0 && my >= 0 && mx <= w && my <= h) this.pickAt(mx, my, w, h, !e.shiftKey);
        }
      }
    };
    cv.addEventListener('pointerup', (e) => end(e, false));
    cv.addEventListener('pointercancel', (e) => end(e, true));
    window.addEventListener('blur', () => this.cancelPan());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { mx, my } = local(e);
      const f = Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.01 : 0.0022));
      this.zoomAt(f, mx, my);
    }, { passive: false });
  }

  cancelPan() {
    this.pointers.clear();
    this.panPointerId = null;
    this.pinch = null;
    clearTimeout(this.longPressTimer);
    if (this.fullCanvasWrap) this.fullCanvasWrap.classList.remove('is-panning');
  }

  zoomAt(factor, mx, my) {
    const { w, h } = this.fullSize();
    if (mx === undefined) { mx = w / 2; my = h / 2; }
    const before = this.screenToWorld(mx, my, w, h);
    this.viewZoom = clamp(this.viewZoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.viewCenterX = before.x - (mx - w / 2) / this.viewZoom;
    this.viewCenterZ = before.z - (my - h / 2) / this.viewZoom;
    this.renderFullMap();
  }

  fitWorld() {
    const b = WORLD_BOUNDS;
    const { w, h } = this.fullSize();
    this.viewCenterX = (b.minX + b.maxX) / 2;
    this.viewCenterZ = (b.minZ + b.maxZ) / 2;
    this.viewZoom = clamp(Math.min(w / ((b.maxX - b.minX) * 1.04), h / ((b.maxZ - b.minZ) * 1.04)), MIN_ZOOM, MAX_ZOOM);
    this.renderFullMap();
  }

  /** a click on the full map: teleport there (and make it the waypoint), or only set the GPS waypoint */
  pickAt(mx, my, w, h, teleport) {
    let p = this.screenToWorld(mx, my, w, h);
    const b = WORLD_BOUNDS;
    p = { x: clamp(p.x, b.minX + 30, b.maxX - 30), z: clamp(p.z, b.minZ + 30, b.maxZ - 30) };
    if (WORLD.isWater(p.x, p.z)) {
      const r = WORLD.nearestRoad(p.x, p.z, { kinds: 'drive', maxDist: 500 });
      if (r) p = { x: r.x, z: r.z };
    }
    const name = getLocationLabel(p.x, p.z).text;
    if (teleport && this.onTeleport) {
      const r = WORLD.nearestRoad(p.x, p.z, { kinds: 'drive', maxDist: 25 });
      this.onTeleport(p.x, p.z, r ? r.heading : undefined);
      this.waypoint = { x: p.x, z: p.z, name };
    } else {
      this.waypoint = { x: p.x, z: p.z, name };
      if (this.elHoverInfo) this.elHoverInfo.textContent = `GPS set: ${name}`;
    }
    this.renderFullMap();
  }

  // ----------------------------------------------------------------------------------------------- waypoint & routes
  get waypoint() { return this._waypoint; }
  set waypoint(wp) {
    this._waypoint = wp && Number.isFinite(wp.x) && Number.isFinite(wp.z) ? { x: wp.x, z: wp.z, name: wp.name || '' } : null;
    this.gpsRoute = null;
    this.gpsLastRoute = 0;
    if (this._waypoint) this.computeGpsRoute();
    if (this.onWaypointChange) this.onWaypointChange(this._waypoint);
  }
  setWaypoint(x, z, name = getLocationLabel(x, z).text) { this.waypoint = { x, z, name }; }
  clearWaypoint() { this.waypoint = null; }

  /**
   * External route (e.g. RideBXL's remaining GPS route) [{x, z}] or flat; null / [] clears. The 2nd argument is either
   * { color } or a RideBXL target { x, z, kind: 'pickup' | 'dropoff', name } (route coloured by kind + a pin there).
   */
  setRoute(points, opts = {}) {
    const pts = toFlat(points);
    const o = opts || {};
    let color = o.color || P.pins[o.kind] || P.route;
    if (typeof color === 'number') color = '#' + color.toString(16).padStart(6, '0');
    this.extRoute = pts && pts.length >= 4 ? { pts, color } : null;
    this.routePin = this.extRoute && o.kind && Number.isFinite(o.x) ? { x: o.x, z: o.z, kind: o.kind, label: o.name || '' } : null;
  }

  allPins() {
    return this.routePin ? [...this.pins, this.routePin] : this.pins;
  }

  /** pickup / drop-off markers [{x, z, kind, label}] */
  setPins(pins) {
    this.pins = (pins || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z));
  }

  /** the road-following GPS route [{x, z}] from the player to the waypoint ([] when none) */
  getGpsRoute() {
    const r = this.gpsRoute;
    const out = [];
    if (r) for (let i = 0; i < r.length; i += 2) out.push({ x: r[i], z: r[i + 1] });
    return out;
  }

  async ensureRoadGraph() {
    if (this.roadGraph) return this.roadGraph;
    if (!this._graphPromise) {
      this._graphPromise = import('./ridebxl.js')
        .then((m) => (this.roadGraph = new m.RoadGraph(GEO.roads)))
        .catch((e) => { console.warn('[brussels-map] no road graph, straight GPS line', e); return null; });
    }
    return this._graphPromise;
  }

  async computeGpsRoute() {
    const wp = this._waypoint;
    if (!wp) return;
    this.gpsLastRoute = performance.now();
    const g = await this.ensureRoadGraph();
    if (wp !== this._waypoint) return;
    const ent = this.controllerManager.getActiveEntity();
    const a = ent.position;
    let pts = [{ x: a.x, z: a.z }, { x: wp.x, z: wp.z }];
    if (g) {
      try { pts = g.route(a.x, a.z, wp.x, wp.z).pts; } catch (e) { console.warn('[brussels-map] route', e); }
    }
    this.gpsRoute = toFlat(pts);
  }

  /** keeps the GPS route alive: arrival clears it, straying > 40 m from it re-routes (≤ every 2 s) */
  updateGps() {
    const wp = this._waypoint;
    if (!wp) return;
    const now = performance.now();
    if (now - this.gpsCheckT < 400) return;
    this.gpsCheckT = now;
    const p = this.controllerManager.getActiveEntity().position;
    if (Math.hypot(p.x - wp.x, p.z - wp.z) < 25) {
      this.waypoint = null;
      return;
    }
    const r = this.gpsRoute;
    if (!r) return;
    const near = nearestOnPolyline(r, p.x, p.z);
    if (near.d > 40 && now - this.gpsLastRoute > 2000) this.computeGpsRoute();
  }

  /** the route to draw: [ {pts, color} ] trimmed to start at the player */
  activeRoute() {
    const route = this.extRoute || (this.gpsRoute ? { pts: this.gpsRoute, color: P.route } : null);
    if (!route) return null;
    const p = this.controllerManager.getActiveEntity().position;
    const near = nearestOnPolyline(route.pts, p.x, p.z);
    const out = [p.x, p.z, near.x, near.z];
    for (let i = (near.seg + 1) * 2; i < route.pts.length; i += 2) out.push(route.pts[i], route.pts[i + 1]);
    return { pts: out, color: route.color };
  }

  // ---------------------------------------------------------------------------------------------------------- search
  search(text) {
    const q = String(text || '').trim().toLowerCase();
    this.searchHighlight = q;
    this.searchPath = null;
    if (q.length > 1) {
      const lm = BRUSSELS_LANDMARKS.find((l) => l.name.toLowerCase().includes(q) || l.short.toLowerCase().includes(q));
      const st = GEO.stations.find((s) => s.name.toLowerCase().includes(q));
      const roads = ROAD_LABELS.filter((l) => l.lower.includes(q));
      const exact = roads.filter((l) => l.lower === q || l.lower.startsWith(q + ' '));
      const use = exact.length ? exact : roads;
      if (use.length) {
        this.searchPath = new Path2D();
        const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const l of use) {
          addLine(this.searchPath, l.pts);
          b.minX = Math.min(b.minX, l.minX); b.maxX = Math.max(b.maxX, l.maxX);
          b.minZ = Math.min(b.minZ, l.minZ); b.maxZ = Math.max(b.maxZ, l.maxZ);
        }
        this.searchBounds = b;
      }
      const { w, h } = this.fullSize();
      if (lm || (st && !use.length)) {
        const t = lm || st;
        this.viewCenterX = t.x;
        this.viewCenterZ = t.z;
        this.viewZoom = Math.max(this.viewZoom, 1.4);
      } else if (use.length) {
        const b = this.searchBounds;
        this.viewCenterX = (b.minX + b.maxX) / 2;
        this.viewCenterZ = (b.minZ + b.maxZ) / 2;
        this.viewZoom = clamp(Math.min(w / ((b.maxX - b.minX) * 1.3 + 1), h / ((b.maxZ - b.minZ) * 1.3 + 1)), 0.12, 2.0);
      }
    }
    this.fullLabelsKey = '';
    this.renderFullMap();
  }

  // ----------------------------------------------------------------------------------------------------- full map UI
  toggleFullMap(open) {
    this.isFullMapOpen = Boolean(open);
    if (!this.isFullMapOpen) this.cancelPan();
    if (this.onToggle) this.onToggle(this.isFullMapOpen);
    if (!this.modal) return;
    this.modal.classList.toggle('hidden', !this.isFullMapOpen);
    if (this.isFullMapOpen) {
      for (const pop of document.querySelectorAll('.popover[popover]')) {
        if (typeof pop.hidePopover === 'function' && pop.matches(':popover-open')) pop.hidePopover();
      }
      const ent = this.controllerManager.getActiveEntity();
      this.viewCenterX = ent.position.x;
      this.viewCenterZ = ent.position.z;
      this.resizeFullCanvas();
      this.renderFullMap();
    }
  }

  resizeFullCanvas() {
    if (!this.fullCanvas) return;
    const w = this.fullCanvas.clientWidth || window.innerWidth;
    const h = this.fullCanvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / Math.max(1, w * h)));
    this.fullDpr = dpr;
    this.fullCanvas.width = Math.max(1, Math.floor(w * dpr));
    this.fullCanvas.height = Math.max(1, Math.floor(h * dpr));
    this.fullBaseKey = this.fullLabelsKey = '';
  }

  fullSize() {
    const dpr = this.fullDpr || 1;
    if (!this.fullCanvas) return { w: 1200, h: 800 };
    return { w: this.fullCanvas.width / dpr, h: this.fullCanvas.height / dpr };
  }

  screenToWorld(sx, sy, width, height) {
    return { x: this.viewCenterX + (sx - width * 0.5) / this.viewZoom, z: this.viewCenterZ + (sy - height * 0.5) / this.viewZoom };
  }

  textWidth(ctx, text) {
    const key = ctx.font + '|' + text;
    let w = this.textWidths.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      if (this.textWidths.size > 20000) this.textWidths.clear();
      this.textWidths.set(key, w);
    }
    return w;
  }

  // ------------------------------------------------------------------------------------------------------ tile cache
  getOverview() {
    if (this.overview) return this.overview;
    const b = WORLD_BOUNDS;
    const m = 200;
    const L = OVERVIEW_PPM;
    const c = makeCanvas((b.maxX - b.minX + 2 * m) * L, (b.maxZ - b.minZ + 2 * m) * L);
    const ctx = c.getContext('2d');
    ctx.fillStyle = P.paper;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(L, 0, 0, L, -(b.minX - m) * L, -(b.minZ - m) * L);
    drawGround(ctx, { minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m }, L);
    this.overview = { canvas: c, x0: b.minX - m, z0: b.minZ - m, L };
    return this.overview;
  }

  renderTile(k, ix, iz, dpr) {
    const L = Math.pow(2, k / 2);
    const T = TILE / L;
    const c = makeCanvas(TILE, TILE);
    const ctx = c.getContext('2d');
    const rect = { minX: ix * T, maxX: (ix + 1) * T, minZ: iz * T, maxZ: (iz + 1) * T };
    ctx.fillStyle = P.paper;
    ctx.fillRect(0, 0, TILE, TILE);
    ctx.setTransform(L, 0, 0, L, -rect.minX * L, -rect.minZ * L);
    // a little world-outside shading past the play area
    const b = WORLD_BOUNDS;
    if (rect.minX < b.minX || rect.maxX > b.maxX || rect.minZ < b.minZ || rect.maxZ > b.maxZ) {
      ctx.fillStyle = P.outside;
      ctx.beginPath();
      ctx.rect(rect.minX - 1, rect.minZ - 1, T + 2, T + 2);
      ctx.rect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ); // even-odd cuts the play area out
      ctx.fill('evenodd');
    }
    drawGround(ctx, rect, L / dpr);
    return c;
  }

  /** renders queued tiles nearest-first until the time budget (ms) is spent */
  pumpTiles(budget) {
    if (!this.tileQueue.size) return 0;
    const t0 = performance.now();
    this.pumpCount = (this.pumpCount || 0) + 1;
    for (const [key, t] of this.tileQueue) if (this.pumpCount - t.f > 120) this.tileQueue.delete(key); // nobody asked lately
    const list = [...this.tileQueue.entries()].sort((a, b) => a[1].d - b[1].d);
    let n = 0;
    for (const [key, t] of list) {
      if (n > 0 && performance.now() - t0 > budget) break;
      this.tileQueue.delete(key);
      if (this.tiles.has(key)) continue;
      this.tiles.set(key, this.renderTile(t.k, t.ix, t.iz, t.dpr));
      n++;
    }
    while (this.tiles.size > TILE_CACHE_MAX) this.tiles.delete(this.tiles.keys().next().value);
    if (n) this.tilesVersion++;
    return n;
  }

  /**
   * Composites the ground for view v into ctx (device px, identity transform): cached tiles at the nearest level,
   * the overview stand-in under missing ones (which get queued). Returns the number of missing tiles.
   */
  drawTiles(ctx, v, { prefetch = 0, sync = 0 } = {}) {
    const dev = v.s * v.dpr;
    const k = clamp(Math.round(2 * Math.log2(dev)), LEVEL_MIN, LEVEL_MAX);
    const L = Math.pow(2, k / 2);
    const T = TILE / L;
    const k2 = v.s * v.dpr; // device px per metre of the view
    const ox = v.dpr * v.w * 0.5 - v.cx * k2;
    const oz = v.dpr * v.h * 0.5 - v.cz * k2;
    const ix0 = Math.floor(v.minX / T), ix1 = Math.floor(v.maxX / T);
    const iz0 = Math.floor(v.minZ / T), iz1 = Math.floor(v.maxZ / T);
    const dpr = v.dpr;
    const missing = [];
    const t0 = performance.now();
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const key = `${dpr}|${k}|${ix}|${iz}`;
        let c = this.tiles.get(key);
        if (!c && sync && performance.now() - t0 < sync) {
          c = this.renderTile(k, ix, iz, dpr);
          this.tiles.set(key, c);
        }
        if (c) {
          this.tiles.delete(key);
          this.tiles.set(key, c); // LRU touch
        } else {
          missing.push([ix, iz, key]);
        }
      }
    }
    ctx.imageSmoothingEnabled = true;
    if (missing.length) {
      const o = this.getOverview();
      const sc = k2 / o.L;
      for (const [ix, iz] of missing) {
        // the overview's piece under this tile
        const sx = (ix * T - o.x0) * o.L, sz = (iz * T - o.z0) * o.L, sw = T * o.L;
        const dx = ix * T * k2 + ox, dz = iz * T * k2 + oz;
        ctx.drawImage(o.canvas, sx, sz, sw, sw, Math.floor(dx), Math.floor(dz), Math.ceil(sw * sc) + 1, Math.ceil(sw * sc) + 1);
      }
      const cx = (ix0 + ix1) / 2, cz = (iz0 + iz1) / 2;
      for (const [ix, iz, key] of missing) {
        this.tileQueue.set(key, { k, ix, iz, dpr, d: Math.hypot(ix - cx, iz - cz), f: this.pumpCount || 0 });
      }
    }
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const c = this.tiles.get(`${dpr}|${k}|${ix}|${iz}`);
        if (!c) continue;
        const dx = ix * T * k2 + ox, dz = iz * T * k2 + oz;
        const x0 = Math.floor(dx), z0 = Math.floor(dz);
        const x1 = Math.ceil(dx + T * k2), z1 = Math.ceil(dz + T * k2);
        ctx.drawImage(c, x0, z0, x1 - x0 + 0.5, z1 - z0 + 0.5);
      }
    }
    if (prefetch) {
      const cx = (ix0 + ix1) / 2, cz = (iz0 + iz1) / 2;
      for (let iz = iz0 - prefetch; iz <= iz1 + prefetch; iz++) {
        for (let ix = ix0 - prefetch; ix <= ix1 + prefetch; ix++) {
          if (ix >= ix0 && ix <= ix1 && iz >= iz0 && iz <= iz1) continue;
          const key = `${dpr}|${k}|${ix}|${iz}`;
          if (!this.tiles.has(key)) this.tileQueue.set(key, { k, ix, iz, dpr, d: 100 + Math.hypot(ix - cx, iz - cz), f: this.pumpCount || 0 });
        }
      }
    }
    return missing.length;
  }

  // --------------------------------------------------------------------------------------------------------- labels
  /** places labels for view v; returns draw ops [{type, …}] in screen px relative to the view centre */
  layoutLabels(ctx, v, { full = true, maxRoad = 420, rot = 0 } = {}) {
    const s = v.s;
    const ops = [];
    const placed = [];
    const q = this.searchHighlight;
    const vis = (x, z, m = 0) => x >= v.minX - m && x <= v.maxX + m && z >= v.minZ - m && z <= v.maxZ + m;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const sx = (x, z) => { const a = v.toX(x), b = v.toY(z); return [a * cr - b * sr, a * sr + b * cr]; };
    const halfW = v.w / 2, halfH = v.h / 2;
    const inScreen = (X, Y, m = 0) => Math.abs(X) < halfW - m && Math.abs(Y) < halfH - m;
    if (full === 'mini') placed.push([-26, -26, 26, 26]); // keep the player arrow clear
    else placed.push([-halfW, halfH - 48, -halfW + 190, halfH]); // the scale bar

    // landmarks & stations first (their boxes keep other names clear)
    if (full === true) {
      ctx.font = `700 11.5px ${FONT}`;
      const r = s >= 0.5 ? 8 : 6.5;
      for (const lm of BRUSSELS_LANDMARKS) {
        const [X, Y] = sx(lm.x, lm.z);
        if (!inScreen(X, Y, 4)) continue;
        const box = [X - r - 2, Y - r - 2, X + r + 2, Y + r + 2];
        if (overlaps(placed, box)) continue;
        placed.push(box);
        const op = { type: 'landmark', X, Y, r, glyph: LANDMARK_GLYPH[lm.id] || 'star', text: s >= 0.13 ? lm.short : '' };
        if (op.text) {
          const tw = this.textWidth(ctx, op.text);
          const lb = [X + r + 3, Y - 7, X + r + 7 + tw, Y + 7];
          if (!overlaps(placed, lb)) placed.push(lb);
          else op.text = '';
        }
        ops.push(op);
      }
    }
    if (s >= 0.28) {
      ctx.font = `italic 650 10.5px ${FONT}`;
      const size = s >= 0.8 ? 12 : 9;
      for (const st of GEO.stations) {
        const [X, Y] = sx(st.x, st.z);
        if (!inScreen(X, Y, 4)) continue;
        const box = [X - size / 2 - 2, Y - size / 2 - 2, X + size / 2 + 2, Y + size / 2 + 2];
        if (overlaps(placed, box)) continue;
        placed.push(box);
        const op = { type: 'station', X, Y, size, kind: st.kind, text: '' };
        if (s >= 0.5 && full !== 'mini') {
          const text = st.name.replace(/^St\. /, 'St ');
          const tw = this.textWidth(ctx, text);
          const lb = [X - tw / 2 - 2, Y + size / 2 + 2, X + tw / 2 + 2, Y + size / 2 + 15];
          if (!overlaps(placed, lb)) { placed.push(lb); op.text = text; }
        }
        ops.push(op);
      }
    }

    // districts, river, parks
    if (full === true) {
      for (const d of DISTRICTS) {
        const big = d.rank >= 3;
        if (big ? s > 1.1 : d.rank === 2 ? s < 0.2 || s > 2.5 : s < 0.75) continue;
        const [X, Y] = sx(d.x, d.z);
        if (!inScreen(X, Y, 20)) continue;
        const fpx = big ? (s < 0.15 ? 11 : 12.5) : d.rank === 2 ? 10.5 : 9.5;
        ctx.font = `${big ? 750 : 650} ${fpx}px ${FONT}`;
        const text = d.name.toUpperCase();
        const tw = this.textWidth(ctx, text) + text.length * (big ? 2 : 1.4);
        const box = [X - tw / 2 - 3, Y - fpx / 2 - 3, X + tw / 2 + 3, Y + fpx / 2 + 3];
        if (overlaps(placed, box)) continue;
        placed.push(box);
        ops.push({ type: 'district', X, Y, text, font: ctx.font, tracking: big ? 2 : 1.4 });
      }
      if (s < 2.2) {
        ctx.font = `italic 650 ${s < 0.2 ? 11 : 13}px ${FONT}`;
        const text = 'RIVER THAMES';
        const tw = this.textWidth(ctx, text) + text.length * 2.4;
        for (const r of RIVER_LABELS) {
          const [X, Y] = sx(r.x, r.z);
          if (!inScreen(X, Y, 30)) continue;
          const ca = Math.abs(Math.cos(r.ang)), sa = Math.abs(Math.sin(r.ang));
          const bx = (tw / 2) * ca + 8 * sa, by = (tw / 2) * sa + 8 * ca;
          const box = [X - bx, Y - by, X + bx, Y + by];
          if (overlaps(placed, box)) continue;
          placed.push(box);
          ops.push({ type: 'river', X, Y, ang: r.ang + rot, text, font: ctx.font });
        }
      }
      for (const p of PARK_LABELS) {
        const pxArea = p.area * s * s;
        if (pxArea < 2600) continue;
        const [X, Y] = sx(p.x, p.z);
        if (!inScreen(X, Y, 10)) continue;
        const fpx = pxArea > 60000 ? 12.5 : 10.5;
        ctx.font = `italic 650 ${fpx}px ${FONT}`;
        const tw = this.textWidth(ctx, p.text);
        if (tw * fpx > pxArea * 0.8) continue;
        const box = [X - tw / 2 - 2, Y - fpx / 2 - 2, X + tw / 2 + 2, Y + fpx / 2 + 2];
        if (overlaps(placed, box)) continue;
        placed.push(box);
        ops.push({ type: 'park', X, Y, text: p.text, font: ctx.font });
      }
    }

    // road-number shields
    if (s >= 0.05 && s < 0.55) {
      ctx.font = `750 9.5px ${FONT}`;
      const byRef = [];
      for (const e of REF_LABELS) {
        if ((e.b && s < 0.16) || (!e.trunk && s < 0.09)) continue;
        const tw = this.textWidth(ctx, e.ref);
        let shown = [];
        for (const a of e.anchors) {
          if (!vis(a.x, a.z)) continue;
          const [X, Y] = sx(a.x, a.z);
          if (!inScreen(X, Y, 14)) continue;
          if (shown.some(([x, y]) => Math.hypot(x - X, y - Y) < 420) || byRef.length > 46) continue;
          const box = [X - tw / 2 - 5, Y - 8, X + tw / 2 + 5, Y + 8];
          if (overlaps(placed, box)) continue;
          placed.push(box);
          shown.push([X, Y]);
          byRef.push({ type: 'shield', X, Y, text: e.ref, tw, trunk: e.trunk });
        }
      }
      ops.push(...byRef);
    }

    // street names
    const minRank = s < 0.18 ? 99 : s < 0.32 ? ROAD_ORDER.indexOf('secondary') : s < 0.6 ? ROAD_ORDER.indexOf('tertiary') : s < 1.0 ? ROAD_ORDER.indexOf('minor') : 0;
    const cands = [];
    const m = 10 / s;
    for (const l of ROAD_LABELS) {
      if (l.maxX < v.minX - m || l.minX > v.maxX + m || l.maxZ < v.minZ - m || l.minZ > v.maxZ + m) continue;
      const hit = q.length > 1 && l.lower.includes(q);
      if (l.rank < minRank && !hit) continue;
      if (l.cls === 'service' && s < 1.6) continue;
      const major = l.rank >= 5;
      const fpx = major ? (s >= 1.2 ? 11.5 : 10.5) : s >= 1.6 ? 10.5 : 9.5;
      const font = `${major ? 700 : 600} ${fpx}px ${FONT}`;
      ctx.font = font;
      const tw = this.textWidth(ctx, l.text);
      const need = (tw + 8) / s;
      for (const a of l.anchors) {
        if (a.len < need || !vis(a.x, a.z, -12 / s)) continue;
        cands.push({ l, a, tw, fpx, font, hit, score: (hit ? 1e6 : 0) + l.rank * 1000 + Math.min(a.len * s, 400) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const byName = new Map();
    let n = 0;
    for (const c of cands) {
      if (n >= maxRoad) break;
      const [X, Y] = sx(c.a.x, c.a.z);
      if (!inScreen(X, Y, 8)) continue;
      const same = byName.get(c.l.text);
      if (same && same.some(([x, y]) => Math.hypot(x - X, y - Y) < 300)) continue;
      let ang = c.a.ang + rot;
      ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      if (ang > Math.PI / 2) ang -= Math.PI;
      else if (ang <= -Math.PI / 2) ang += Math.PI;
      const hw = c.tw / 2 + 3, hh = c.fpx / 2 + 2;
      const ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
      const bx = hw * ca + hh * sa, by = hw * sa + hh * ca;
      const box = [X - bx, Y - by, X + bx, Y + by];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      if (same) same.push([X, Y]);
      else byName.set(c.l.text, [[X, Y]]);
      ops.push({ type: 'road', X, Y, ang, text: c.l.text, font: c.font, hit: c.hit, major: c.l.rank >= 5 });
      n++;
    }
    return ops;
  }

  drawLabelOps(ctx, ops) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const tracking = 'letterSpacing' in ctx;
    for (const o of ops) {
      switch (o.type) {
        case 'road':
          ctx.save();
          ctx.translate(o.X, o.Y);
          ctx.rotate(o.ang);
          ctx.font = o.font;
          haloText(ctx, o.text, 0, 0.5, o.hit ? P.search : o.major ? P.text : P.textMinor, P.halo, 3);
          ctx.restore();
          break;
        case 'district':
          ctx.font = o.font;
          if (tracking) ctx.letterSpacing = `${o.tracking}px`;
          haloText(ctx, o.text, o.X, o.Y, P.district, 'rgba(255,255,255,0.75)', 3);
          if (tracking) ctx.letterSpacing = '0px';
          break;
        case 'river':
          ctx.save();
          ctx.translate(o.X, o.Y);
          ctx.rotate(o.ang);
          ctx.font = o.font;
          if (tracking) ctx.letterSpacing = '2.4px';
          ctx.fillStyle = P.waterText;
          ctx.fillText(o.text, 0, 0);
          if (tracking) ctx.letterSpacing = '0px';
          ctx.restore();
          break;
        case 'park':
          ctx.font = o.font;
          haloText(ctx, o.text, o.X, o.Y, P.parkText, 'rgba(240,248,230,0.85)', 2.5);
          break;
        case 'shield': {
          const w = o.tw + 8, h = 13;
          roundRect(ctx, o.X - w / 2, o.Y - h / 2, w, h, 2.5);
          ctx.fillStyle = o.trunk ? '#00703c' : '#ffffff';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = o.trunk ? '#ffffff' : '#222';
          ctx.stroke();
          ctx.font = `750 9.5px ${FONT}`;
          ctx.fillStyle = o.trunk ? '#ffd200' : '#111';
          ctx.fillText(o.text, o.X, o.Y + 0.5);
          break;
        }
        case 'station':
          drawStationGlyph(ctx, o.kind, o.X, o.Y, o.size);
          if (o.text) {
            ctx.font = `italic 650 10.5px ${FONT}`;
            ctx.textBaseline = 'top';
            haloText(ctx, o.text, o.X, o.Y + o.size / 2 + 3, P.stationText, P.halo, 3);
            ctx.textBaseline = 'middle';
          }
          break;
        case 'landmark':
          drawLandmarkGlyph(ctx, o.glyph, o.X, o.Y, o.r);
          if (o.text) {
            ctx.font = `700 11.5px ${FONT}`;
            ctx.textAlign = 'left';
            haloText(ctx, o.text, o.X + o.r + 5, o.Y + 0.5, P.landmarkText, P.halo, 3.2);
            ctx.textAlign = 'center';
          }
          break;
      }
    }
    ctx.textBaseline = 'alphabetic';
  }

  // --------------------------------------------------------------------------------------------------------- update
  update() {
    const now = performance.now();
    this.lastFrame = now;
    this.updateGps();
    if (this.isFullMapOpen) {
      this.pumpTiles(this.tileQueue.size > 6 ? 22 : 12);
      this.renderFullMap();
    } else {
      this.pumpTiles(4);
      this.renderMinimap();
    }
  }

  // =========================================================================================== 1. RADAR MINIMAP
  cameraAngle() {
    const cs = this.cameraSystem;
    if (cs && cs.currentLookAt && cs.currentPos) {
      const dx = cs.currentLookAt.x - cs.currentPos.x, dz = cs.currentLookAt.z - cs.currentPos.z;
      if (dx * dx + dz * dz > 1e-6) return Math.atan2(dx, dz);
    }
    return this.controllerManager.getActiveEntity().heading || 0;
  }

  renderMinimap() {
    if (!this.miniCtx || !this.miniCanvas) return;
    if (!this.miniCanvas.offsetParent || document.body.classList.contains('hud-minimized')) return;
    const ctx = this.miniCtx;
    const w = this.miniCanvas.clientWidth, h = this.miniCanvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (this.miniCanvas.width !== bw || this.miniCanvas.height !== bh) {
      this.miniCanvas.width = bw;
      this.miniCanvas.height = bh;
      this.miniCache = null;
    }
    const ent = this.controllerManager.getActiveEntity();
    const px = ent.position.x, pz = ent.position.z;
    const speed = Math.abs(ent.speed || 0);
    const target = Math.max(0.06, RADAR_SCALE / (1 + Math.max(0, (ent.position.y || 0) - 25) / 160) / (1 + Math.max(0, speed - 10) / 45));
    this.miniScale += (target - this.miniScale) * 0.06;
    const scale = this.miniScale;
    const camA = this.cameraAngle();
    const rot = this.rotateMinimap ? camA - Math.PI : 0;

    if (this.elMiniStreet) {
      const label = getLocationLabel(px, pz).text;
      if (label !== this.miniStreetText) { this.miniStreetText = label; this.elMiniStreet.textContent = label; }
    }

    // cached ground around the player, big enough to rotate inside
    const R = Math.hypot(w, h) / 2 + 4;
    const M = Math.max(90, Math.min(w, h) * 0.7);
    const S = Math.ceil(2 * (R + M));
    const now = performance.now();
    let c = this.miniCache;
    const stale = !c || c.S !== S || c.dpr !== dpr || Math.abs(scale / c.s - 1) > 0.1 || Math.hypot(px - c.cx, pz - c.cz) * scale > M ||
      (c.missing && c.version !== this.tilesVersion && now - c.t > 250);
    if (stale) {
      if (!c || c.S !== S || c.dpr !== dpr) {
        c = this.miniCache = { canvas: makeCanvas(S * dpr, S * dpr), S, dpr };
        c.ctx = c.canvas.getContext('2d');
      }
      const moved = !c.t || Math.hypot(px - c.cx, pz - c.cz) * scale > M || Math.abs(scale / c.s - 1) > 0.1;
      if (moved) { c.cx = px; c.cz = pz; c.s = scale; }
      c.t = now;
      c.version = this.tilesVersion;
      const cv = new MapView(c.cx, c.cz, c.s, S, S, dpr);
      c.ctx.setTransform(1, 0, 0, 1, 0, 0);
      c.ctx.fillStyle = P.paper;
      c.ctx.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.missing = this.drawTiles(c.ctx, cv, { prefetch: 1, sync: c.version === 0 ? 40 : 0 });
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.paper;
    ctx.fillRect(0, 0, bw, bh);
    ctx.setTransform(dpr, 0, 0, dpr, dpr * w / 2, dpr * h / 2);
    ctx.rotate(rot);
    const k = scale / c.s;
    ctx.drawImage(c.canvas, (c.cx - px) * scale - (S / 2) * k, (c.cz - pz) * scale - (S / 2) * k, S * k, S * k);

    // world -> screen (rotated frame is current): plain offsets * scale
    const toX = (x) => (x - px) * scale, toY = (z) => (z - pz) * scale;

    // traffic blips
    if (this.trafficSystem && this.trafficSystem.cars) {
      ctx.fillStyle = 'rgba(40, 38, 34, 0.45)';
      const cars = this.trafficSystem.cars;
      const lim = R + 4;
      for (let i = 0; i < cars.length; i += 2) {
        const car = cars[i];
        const X = toX(car.x), Y = toY(car.z);
        if (Math.abs(X) < lim && Math.abs(Y) < lim) ctx.fillRect(X - 1.2, Y - 1.2, 2.4, 2.4);
      }
    }

    // route
    const route = this.activeRoute();
    if (route) {
      const sp = [];
      const lim = 3 * R;
      for (let i = 0; i < route.pts.length; i += 2) {
        const X = toX(route.pts[i]), Y = toY(route.pts[i + 1]);
        sp.push([X, Y]);
        if (Math.abs(X) > lim || Math.abs(Y) > lim) break;
      }
      strokeRoute(ctx, sp, route.color, 3.6);
    }
    ctx.restore();

    // upright overlays: labels, landmarks, stations, pins, waypoint (screen frame, rotated positions)
    ctx.save();
    const v = new MapView(px, pz, scale, w, h, dpr);
    v.screen(ctx);
    if (!this.miniLabels || now - this.miniLabels.t > 220) {
      this.miniLabels = { t: now, px, pz, scale, rot, ops: this.layoutLabels(ctx, v, { full: 'mini', maxRoad: 16, rot }) };
    }
    // shift the cached layout by how far the map moved since
    const L = this.miniLabels;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const dX0 = (L.px - px) * scale, dY0 = (L.pz - pz) * scale;
    const dX = dX0 * cr - dY0 * sr, dY = dX0 * sr + dY0 * cr;
    const dRot = rot - L.rot;
    ctx.save();
    ctx.translate(dX, dY);
    if (Math.abs(dRot) > 1e-4) ctx.rotate(dRot);
    this.drawLabelOps(ctx, L.ops.filter((o) => o.type === 'road' || o.type === 'station'));
    ctx.restore();

    const rs = (x, z) => { const a = toX(x), b = toY(z); return [a * cr - b * sr, a * sr + b * cr]; };
    const inside = ([X, Y], m = 0) => Math.abs(X) < w / 2 - m && Math.abs(Y) < h / 2 - m;
    for (const lm of BRUSSELS_LANDMARKS) {
      const q = rs(lm.x, lm.z);
      if (inside(q, 6)) drawLandmarkGlyph(ctx, LANDMARK_GLYPH[lm.id] || 'star', q[0], q[1], 6.5);
    }
    const edge = ([X, Y], m) => {
      // clamp a far marker onto the radar rim
      const sx = (w / 2 - m) / Math.max(1e-6, Math.abs(X)), sy = (h / 2 - m) / Math.max(1e-6, Math.abs(Y));
      const f = Math.min(1, sx, sy);
      return [X * f, Y * f, f < 1];
    };
    const marks = this.allPins().map((p) => ({ x: p.x, z: p.z, color: P.pins[p.kind] || P.pins.waypoint, glyph: p.kind === 'pickup' ? 'A' : p.kind === 'dropoff' ? 'B' : '' }));
    if (this._waypoint && !this.extRoute) marks.push({ x: this._waypoint.x, z: this._waypoint.z, color: P.pins.waypoint, glyph: '' });
    for (const mk of marks) {
      const [X, Y, clamped] = edge(rs(mk.x, mk.z), 12);
      if (clamped) {
        ctx.beginPath();
        ctx.arc(X, Y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = mk.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      } else drawPin(ctx, X, Y, mk.color, mk.glyph);
    }

    // view cone & player arrow
    ctx.save();
    ctx.rotate(rot + Math.PI - camA);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 62);
    grad.addColorStop(0, 'rgba(31, 111, 229, 0.30)');
    grad.addColorStop(1, 'rgba(31, 111, 229, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 62, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.rotate(rot + Math.PI - (ent.heading || 0));
    drawPlayerArrow(ctx, -9.5, 6.8, 7.2);
    ctx.restore();
    ctx.restore();

    // north marker orbits the rim
    if (this.elMiniNorth) {
      const nx = Math.sin(rot), ny = -Math.cos(rot);
      const f = Math.min((w / 2 - 12) / Math.max(1e-6, Math.abs(nx)), (h / 2 - 12) / Math.max(1e-6, Math.abs(ny)));
      const st = this.elMiniNorth.style;
      st.left = `${w / 2 + nx * f}px`;
      st.top = `${h / 2 + ny * f}px`;
      st.transform = 'translate(-50%, -50%)';
    }
  }

  // ============================================================================================ 2. FULL MAP
  renderFullMap() {
    if (!this.fullCtx || !this.fullCanvas || !this.isFullMapOpen) return;
    const ctx = this.fullCtx;
    const dpr = this.fullDpr || 1;
    const { w, h } = this.fullSize();
    const v = new MapView(this.viewCenterX, this.viewCenterZ, this.viewZoom, w, h, dpr);
    const ent = this.controllerManager.getActiveEntity();
    if (this.elPlayerInfo) {
      const text = `You are on ${getLocationLabel(ent.position.x, ent.position.z).text}`;
      if (text !== this.playerInfoText) { this.playerInfoText = text; this.elPlayerInfo.textContent = text; }
    }
    const W = this.fullCanvas.width, H = this.fullCanvas.height;
    const viewKey = `${v.cx}|${v.cz}|${v.s}|${W}|${H}`;
    if (!this.fullBase) { this.fullBase = makeCanvas(W, H); this.fullLabels = makeCanvas(W, H); }
    if (this.fullBase.width !== W || this.fullBase.height !== H) {
      this.fullBase.width = this.fullLabels.width = W;
      this.fullBase.height = this.fullLabels.height = H;
      this.fullBaseKey = this.fullLabelsKey = '';
    }
    const baseKey = viewKey + '|' + this.tilesVersion;
    if (baseKey !== this.fullBaseKey && (viewKey !== this.fullViewKey || this.fullMissing)) {
      this.fullBaseKey = baseKey;
      this.fullViewKey = viewKey;
      this.fullBaseVersion = this.tilesVersion;
      const bctx = this.fullBase.getContext('2d');
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.fillStyle = P.outside;
      bctx.fillRect(0, 0, W, H);
      this.fullMissing = this.drawTiles(bctx, v, { prefetch: 1 });
      if (this.searchPath) {
        bctx.setTransform(v.s * dpr, 0, 0, v.s * dpr, dpr * (w / 2 - v.cx * v.s), dpr * (h / 2 - v.cz * v.s));
        bctx.lineJoin = bctx.lineCap = 'round';
        bctx.globalAlpha = 0.85;
        bctx.strokeStyle = P.search;
        bctx.lineWidth = Math.max(5 / v.s, 10);
        bctx.stroke(this.searchPath);
        bctx.globalAlpha = 1;
      }
    }
    const labelsKey = viewKey + '|' + this.searchHighlight;
    if (labelsKey !== this.fullLabelsKey) {
      this.fullLabelsKey = labelsKey;
      const lctx = this.fullLabels.getContext('2d');
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, W, H);
      v.screen(lctx);
      this.drawLabelOps(lctx, this.layoutLabels(lctx, v, { full: true }));
      this.drawScaleBar(lctx, v);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fullBase, 0, 0);
    ctx.drawImage(this.fullLabels, 0, 0);
    v.screen(ctx);
    const toX = (x) => v.toX(x), toY = (z) => v.toY(z);

    const route = this.activeRoute();
    if (route) {
      const sp = [];
      for (let i = 0; i < route.pts.length; i += 2) sp.push([toX(route.pts[i]), toY(route.pts[i + 1])]);
      strokeRoute(ctx, sp, route.color, Math.max(4, Math.min(9, 7 * v.s)));
    }
    for (const p of this.allPins()) {
      const X = toX(p.x), Y = toY(p.z);
      drawPin(ctx, X, Y, P.pins[p.kind] || P.pins.waypoint, p.kind === 'pickup' ? 'A' : p.kind === 'dropoff' ? 'B' : '');
      if (p.label) {
        ctx.font = `700 11.5px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        haloText(ctx, p.label, X, Y + 4, P.text, P.halo, 3.2);
        ctx.textBaseline = 'alphabetic';
      }
    }
    if (this._waypoint && !this.extRoute) drawPin(ctx, toX(this._waypoint.x), toY(this._waypoint.z), P.pins.waypoint);

    const px = toX(ent.position.x), py = toY(ent.position.z);
    ctx.save();
    ctx.translate(px, py);
    const pulse = (performance.now() % 1800) / 1800;
    ctx.fillStyle = `rgba(31, 111, 229, ${0.28 * (1 - pulse)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + pulse * 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(Math.PI - (ent.heading || 0));
    drawPlayerArrow(ctx, -12, 8, 8.5);
    ctx.restore();
    ctx.restore();
  }

  drawScaleBar(ctx, v) {
    const target = 120 / v.s;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= target).pop() || pow;
    const len = step * v.s;
    const x0 = -v.w * 0.5 + 24, y0 = v.h * 0.5 - 26;
    const label = step >= 1000 ? `${step / 1000} km` : `${step} m`;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 6);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.lineTo(x0 + len, y0 - 6);
    ctx.strokeStyle = P.halo;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = P.text;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `650 11px ${FONT}`;
    ctx.textAlign = 'left';
    haloText(ctx, label, x0 + len + 8, y0 + 3, P.text);
    // miles too — it's Britain
    const miles = step / 1609.344;
    ctx.font = `500 10px ${FONT}`;
    haloText(ctx, `${miles < 0.1 ? (step * 1.0936).toFixed(0) + ' yd' : miles.toFixed(miles < 1 ? 2 : 1) + ' mi'}`, x0 + len + 8, y0 - 9, P.textMinor);
  }
}

/** nearest point on a flat polyline: { x, z, d, seg } */
function nearestOnPolyline(p, x, z) {
  let best = { x: p[0], z: p[1], d: Infinity, seg: 0 };
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1) : 0;
    const qx = ax + dx * t, qz = az + dz * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < best.d) best = { x: qx, z: qz, d, seg: i / 2 };
  }
  return best;
}

export { BrusselsMapSystem, STREET_COUNT, drawLandmarkGlyph, drawStationGlyph };
