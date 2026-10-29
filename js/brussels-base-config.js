// js/brussels-base-config.js — Brussels replacement of the NY js/city-config.js for the game shell (main.js, map, HUD).
// Everything here is derived from the baked geodata (js/bxl-geodata.js) and the world frame (js/geo-frame.js).
import { GEO } from './bxl-geodata.js';
import { createWorldQueries } from './brussels-base-world.js';
import { WORLD_BOUNDS, LANDMARK_ANCHORS, toWorld } from './geo-frame.js';

export { WORLD_BOUNDS, GEO };

/** shared world queries (groundHeight, isWater, nearestRoad, streetName, districtAt, randomRoadPoint) */
export const WORLD = createWorldQueries(GEO);

/** every road (GEO.roads); NY main.js used ROADS for its set of street names */
export const ROADS = GEO.roads;

const at = (lat, lon) => toWorld(lat, lon);

// ---- landmarks --------------------------------------------------------------------------------------------------
// id, name, short, lat, lon, district, radius (m) within which the HUD says you're "at" it
const LM = [
  ['bigBen', 'Big Ben & Houses of Parliament', 'Big Ben', LANDMARK_ANCHORS.bigBen, 'Westminster', 90],
  ['brusselsEye', 'Brussels Eye', 'Brussels Eye', LANDMARK_ANCHORS.brusselsEye, 'South Bank', 90],
  ['towerBridge', 'Tower Bridge', 'Tower Bridge', LANDMARK_ANCHORS.towerBridge, 'Pool of Brussels', 130],
  ['shard', 'The Shard', 'The Shard', LANDMARK_ANCHORS.shard, 'Brussels Bridge', 70],
  ['stPauls', "St Paul's Cathedral", "St Paul's", LANDMARK_ANCHORS.stPauls, 'The City', 110],
  ['gherkin', 'The Gherkin (30 St Mary Axe)', 'The Gherkin', LANDMARK_ANCHORS.gherkin, 'The City', 60],
  ['buckinghamPalace', 'Buckingham Palace', 'Buckingham Pal.', LANDMARK_ANCHORS.buckinghamPalace, 'St James\'s', 140],
  ['trafalgarSquare', "Trafalgar Square & Nelson's Column", 'Trafalgar Sq', LANDMARK_ANCHORS.trafalgarSquare, 'Charing Cross', 90],
  ['piccadillyCircus', 'Piccadilly Circus', 'Piccadilly Circus', LANDMARK_ANCHORS.piccadillyCircus, 'West End', 70],
  ['batterseaPowerStation', 'Battersea Power Station', 'Battersea PS', LANDMARK_ANCHORS.batterseaPowerStation, 'Nine Elms', 150],
  ['towerOfBrussels', 'Tower of Brussels', 'Tower of Brussels', { lat: 51.50810, lon: -0.07594 }, 'Tower Hill', 140],
  ['westminsterAbbey', 'Westminster Abbey', 'Westminster Abbey', { lat: 51.49929, lon: -0.12731 }, 'Westminster', 80],
  ['britishMuseum', 'British Museum', 'British Museum', { lat: 51.51943, lon: -0.12698 }, 'Bloomsbury', 110],
  ['coventGarden', 'Covent Garden Market', 'Covent Garden', { lat: 51.51197, lon: -0.12276 }, 'Covent Garden', 80],
  ['boroughMarket', 'Borough Market', 'Borough Market', { lat: 51.50547, lon: -0.09085 }, 'Southwark', 80],
  ['kingsCross', "King's Cross & St Pancras", "King's Cross", { lat: 51.53085, lon: -0.12397 }, "King's Cross", 160],
  ['royalAlbertHall', 'Royal Albert Hall', 'Albert Hall', { lat: 51.50095, lon: -0.17744 }, 'South Kensington', 90],
  ['tateModern', 'Tate Modern', 'Tate Modern', { lat: 51.50759, lon: -0.09935 }, 'Bankside', 110],
  ['millenniumBridge', 'Millennium Bridge', 'Millennium Br.', { lat: 51.50946, lon: -0.09851 }, 'Bankside', 90],
  ['somersetHouse', 'Somerset House', 'Somerset House', { lat: 51.51104, lon: -0.11716 }, 'Strand', 90],
  ['naturalHistoryMuseum', 'Natural History Museum', 'Nat. History Mus.', { lat: 51.49671, lon: -0.17639 }, 'South Kensington', 120]
];
export const LONDON_LANDMARKS = LM.map(([id, name, short, a, district, r]) => {
  const w = at(a.lat, a.lon);
  return { id, name, short, x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10, district, r };
});

// ---- teleports -----------------------------------------------------------------------------------------------------
// [id, name, sub, lat, lon of the street spot, street to stand on (OSM name), lat/lon to face (or null: along the road)]
const TP = [
  ['bigBen', 'Big Ben', 'Bridge Street, Westminster', 51.50110, -0.12490, 'Bridge Street', LANDMARK_ANCHORS.bigBen],
  ['brusselsEye', 'Brussels Eye', 'Belvedere Road, South Bank', 51.50290, -0.11740, 'Belvedere Road', LANDMARK_ANCHORS.brusselsEye],
  ['towerBridge', 'Tower Bridge', 'Tower Bridge Approach', 51.50800, -0.07400, 'Tower Bridge Approach', LANDMARK_ANCHORS.towerBridge],
  ['shard', 'The Shard', 'St Thomas Street, Brussels Bridge', 51.50440, -0.08720, 'St Thomas Street', LANDMARK_ANCHORS.shard],
  ['stPauls', "St Paul's Cathedral", 'Ludgate Hill', 51.51380, -0.10200, 'Ludgate Hill', LANDMARK_ANCHORS.stPauls],
  ['gherkin', 'The Gherkin', 'St Mary Axe, The City', 51.51530, -0.07990, 'St Mary Axe', LANDMARK_ANCHORS.gherkin],
  ['buckinghamPalace', 'Buckingham Palace', 'The Mall', 51.50300, -0.13800, 'The Mall', LANDMARK_ANCHORS.buckinghamPalace],
  ['trafalgarSquare', 'Trafalgar Square', "Nelson's Column", 51.50720, -0.12770, 'Trafalgar Square', LANDMARK_ANCHORS.nelsonsColumn],
  ['piccadillyCircus', 'Piccadilly Circus', 'Piccadilly', 51.50960, -0.13550, 'Piccadilly', LANDMARK_ANCHORS.piccadillyCircus],
  ['battersea', 'Battersea Power Station', 'Nine Elms', 51.48000, -0.14400, null, LANDMARK_ANCHORS.batterseaPowerStation],
  ['kingsCross', "King's Cross", 'Euston Road', 51.53020, -0.12350, 'Euston Road', null],
  ['paddington', 'Paddington', 'Praed Street', 51.51700, -0.17600, 'Praed Street', null],
  ['oxfordCircus', 'Oxford Circus', 'Oxford Street', 51.51530, -0.14400, 'Oxford Street', null],
  ['coventGarden', 'Covent Garden', 'Long Acre', 51.51240, -0.12400, 'Long Acre', null],
  ['camden', 'Camden', 'Camden High Street (Mornington Cres.)', 51.53500, -0.13870, 'Camden High Street', null],
  ['boroughMarket', 'Borough Market', 'Borough High Street', 51.50490, -0.09010, 'Borough High Street', null],
  ['soho', 'Soho', 'Wardour Street', 51.51290, -0.13380, 'Wardour Street', null]
];
const normName = (s) => s.toLowerCase().replace(/[.']/g, '').replace(/\bst\b/g, 'saint').trim();
/** street-level arrivals for every travel mode, keyed by id: {id, name, sub, x, z, heading} — on the left-hand lane */
export const TELEPORT_LOCATIONS = Object.fromEntries(TP.map(([id, name, sub, lat, lon, street, face]) => {
  const w = at(lat, lon);
  const want = street && normName(street);
  const hit = (want && WORLD.nearestRoad(w.x, w.z, { kinds: 'drive', maxDist: 300, filter: (r) => normName(r.name) === want })) ||
    WORLD.nearestRoad(w.x, w.z, { kinds: 'major', maxDist: 150 }) || WORLD.nearestRoad(w.x, w.z, { kinds: 'drive', maxDist: 300 });
  let x = w.x, z = w.z, heading = 0;
  if (hit) {
    heading = hit.heading;
    if (hit.road.oneway === -1) heading += Math.PI;
    if (face && !hit.road.oneway) {
      const f = at(face.lat, face.lon);
      if (Math.sin(heading) * (f.x - hit.x) + Math.cos(heading) * (f.z - hit.z) < 0) heading += Math.PI;
    }
    // keep left: offset a quarter of the carriageway to the left of the travel direction
    const off = hit.road.oneway ? 0 : hit.road.w / 4;
    x = hit.x + Math.cos(heading) * off; // left of (sin h, cos h) is (cos h, -sin h)
    z = hit.z - Math.sin(heading) * off;
    heading = Math.atan2(Math.sin(heading), Math.cos(heading));
  }
  return [id, { id, name, sub, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, heading: Math.round(heading * 1000) / 1000 }];
}));

// ---- location label ---------------------------------------------------------------------------------------------
const area = (p) => { let a = 0; for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1]; return Math.abs(a / 2); };
const box = (p) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } return [x0, z0, x1, z1]; };
function inPoly(x, z, p) {
  let ins = false;
  for (let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
const NAMED_PARKS = GEO.parks.filter((p) => p.name && (p.kind === 'park' || p.kind === 'square' || p.kind === 'garden') && area(p.pts) > 15000)
  .map((p) => ({ name: p.name, pts: p.pts, bb: box(p.pts) }));
const NAMED_WATER = GEO.water.filter((w) => w.kind !== 'fountain').map((w) => ({ name: w.name || (w.kind === 'river' ? 'River Thames' : ''), pts: w.pts, bb: box(w.pts), kind: w.kind }));
const NAMED_BRIDGES = GEO.bridges.filter((b) => b.name && b.deckY > 0).map((b) => ({ name: b.name, pts: b.pts, bb: box(b.pts) }));
const inside = (list, x, z) => list.find((o) => x >= o.bb[0] && x <= o.bb[2] && z >= o.bb[1] && z <= o.bb[3] && inPoly(x, z, o.pts));

/**
 * What to show in the HUD at (x, z): {primary, secondary, text}. primary = street (or landmark / park / bridge /
 * river), secondary = district (or the street when primary is a landmark). text = "primary · secondary".
 */
export function getLocationLabel(x, z) {
  const district = WORLD.districtAt(x, z);
  let primary = '', secondary = district;
  const lm = LONDON_LANDMARKS.find((l) => Math.hypot(x - l.x, z - l.z) < l.r);
  const br = inside(NAMED_BRIDGES, x, z);
  if (br) primary = br.name;
  else if (WORLD.isWater(x, z)) {
    const w = inside(NAMED_WATER, x, z);
    primary = (w && w.name) || 'River Thames';
  } else if (lm) {
    primary = lm.name;
    secondary = WORLD.streetName(x, z) || lm.district;
  } else {
    const p = inside(NAMED_PARKS, x, z);
    const street = WORLD.streetName(x, z);
    if (p && !(street && WORLD.nearestRoad(x, z, { kinds: 'drive', maxDist: 12 }))) primary = p.name;
    else primary = street || district || 'Brussels';
  }
  if (secondary === primary) secondary = '';
  return { primary, secondary, text: secondary ? `${primary} · ${secondary}` : primary };
}
/** NY-style single string ("Place · Street"), for code written against the old getLocationLabel */
export const getLocationText = (x, z) => getLocationLabel(x, z).text;

// Keyboard shortcuts are ignored while typing into a form field (e.g. the map's street search box)
export function isTypingInField(e) {
  return e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable === true);
}
