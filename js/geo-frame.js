// js/geo-frame.js — shared world frame. Brussels Loop is Brussels-only: the frame is the
// Brussels frame from js/brussels-frame.js, unconditionally.
import { BRUSSELS_FRAME, BRUSSELS_WORLD_BOUNDS, BRUSSELS_LANDMARK_ANCHORS, BRUSSELS_M_PER_DEG_LAT, BRUSSELS_M_PER_DEG_LON } from './brussels-frame.js';

export const FRAME = BRUSSELS_FRAME;

export const M_PER_DEG_LAT = BRUSSELS_M_PER_DEG_LAT;
export const M_PER_DEG_LON = BRUSSELS_M_PER_DEG_LON;

/** lat/lon (degrees) -> world {x, z} in metres */
export function toWorld(lat, lon) {
  return { x: (lon - FRAME.lon0) * M_PER_DEG_LON, z: -(lat - FRAME.lat0) * M_PER_DEG_LAT };
}
/** world x/z (metres) -> {lat, lon} */
export function toLatLon(x, z) {
  return { lat: FRAME.lat0 - z / M_PER_DEG_LAT, lon: FRAME.lon0 + x / M_PER_DEG_LON };
}

/** world bounds of the play area in metres */
export const WORLD_BOUNDS = BRUSSELS_WORLD_BOUNDS;

/** Landmark anchor points used by the geodata builder. */
export const LANDMARK_ANCHORS = BRUSSELS_LANDMARK_ANCHORS;
