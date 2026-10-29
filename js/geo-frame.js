// js/geo-frame.js — shared world frame for the currently selected build city.
// Browser builds stay London by default. Set CITY=brussels only for the geodata build pipeline.
import { BRUSSELS_FRAME, BRUSSELS_WORLD_BOUNDS, BRUSSELS_LANDMARK_ANCHORS } from './brussels-frame.js';

const BUILD_CITY = typeof process !== 'undefined' && process.env?.CITY === 'brussels';
const LONDON_FRAME = {
  lat0: 51.50773,
  lon0: -0.12803,
  // Paddington to Tower Bridge, King's Cross to Vauxhall + Battersea
  bbox: { south: 51.476, west: -0.2, north: 51.538, east: -0.065 }
};

export const FRAME = BUILD_CITY ? BRUSSELS_FRAME : LONDON_FRAME;

const RAD = Math.PI / 180;
const phi = FRAME.lat0 * RAD;
export const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const M_PER_DEG_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

/** lat/lon (degrees) -> world {x, z} in metres */
export function toWorld(lat, lon) {
  return { x: (lon - FRAME.lon0) * M_PER_DEG_LON, z: -(lat - FRAME.lat0) * M_PER_DEG_LAT };
}
/** world x/z (metres) -> {lat, lon} */
export function toLatLon(x, z) {
  return { lat: FRAME.lat0 - z / M_PER_DEG_LAT, lon: FRAME.lon0 + x / M_PER_DEG_LON };
}

const sw = toWorld(FRAME.bbox.south, FRAME.bbox.west);
const ne = toWorld(FRAME.bbox.north, FRAME.bbox.east);
/** world bounds of the play area in metres */
export const WORLD_BOUNDS = BUILD_CITY ? BRUSSELS_WORLD_BOUNDS : { minX: sw.x, maxX: ne.x, minZ: ne.z, maxZ: sw.z };

/** Landmark anchor points used by the geodata builder. */
export const LANDMARK_ANCHORS = BUILD_CITY ? BRUSSELS_LANDMARK_ANCHORS : {
  bigBen: { lat: 51.50073, lon: -0.12463, name: 'Big Ben & Houses of Parliament' },
  parliament: { lat: 51.49929, lon: -0.12476, name: 'Palace of Westminster' },
  londonEye: { lat: 51.5033, lon: -0.11953, name: 'London Eye' },
  towerBridge: { lat: 51.50546, lon: -0.0754, name: 'Tower Bridge' },
  shard: { lat: 51.5045, lon: -0.08649, name: 'The Shard' },
  stPauls: { lat: 51.51381, lon: -0.0984, name: "St Paul's Cathedral" },
  gherkin: { lat: 51.51449, lon: -0.08036, name: 'The Gherkin' },
  buckinghamPalace: { lat: 51.50136, lon: -0.14189, name: 'Buckingham Palace' },
  trafalgarSquare: { lat: 51.50803, lon: -0.12804, name: 'Trafalgar Square' },
  nelsonsColumn: { lat: 51.50773, lon: -0.12803, name: "Nelson's Column" },
  piccadillyCircus: { lat: 51.50991, lon: -0.13434, name: 'Piccadilly Circus' },
  batterseaPowerStation: { lat: 51.48183, lon: -0.14454, name: 'Battersea Power Station' }
};
