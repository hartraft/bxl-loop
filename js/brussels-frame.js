// js/brussels-frame.js — Brussels Loop world frame.
// 1 world unit = 1 metre. Origin = Grand-Place / Grote Markt. +x east, +z south, +y up.
// This module is intentionally separate from geo-frame.js until the Brussels geodata is baked;
// swapping the active frame before replacing the London data would misalign the whole world.

export const BRUSSELS_FRAME = {
  lat0: 50.84673,
  lon0: 4.35247,
  // Initial central play area: canal/Heysel edge to Cinquantenaire and the southern Pentagon.
  // Tight enough for a first playable build; expand after performance profiling.
  bbox: { south: 50.815, west: 4.305, north: 50.875, east: 4.405 }
};

const RAD = Math.PI / 180;
const phi = BRUSSELS_FRAME.lat0 * RAD;
export const BRUSSELS_M_PER_DEG_LAT =
  111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const BRUSSELS_M_PER_DEG_LON =
  111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

/** Convert latitude/longitude to local world coordinates in metres. */
export function brusselsToWorld(lat, lon) {
  return {
    x: (lon - BRUSSELS_FRAME.lon0) * BRUSSELS_M_PER_DEG_LON,
    z: -(lat - BRUSSELS_FRAME.lat0) * BRUSSELS_M_PER_DEG_LAT
  };
}

/** Convert local world coordinates in metres to latitude/longitude. */
export function brusselsToLatLon(x, z) {
  return {
    lat: BRUSSELS_FRAME.lat0 - z / BRUSSELS_M_PER_DEG_LAT,
    lon: BRUSSELS_FRAME.lon0 + x / BRUSSELS_M_PER_DEG_LON
  };
}

const sw = brusselsToWorld(BRUSSELS_FRAME.bbox.south, BRUSSELS_FRAME.bbox.west);
const ne = brusselsToWorld(BRUSSELS_FRAME.bbox.north, BRUSSELS_FRAME.bbox.east);
export const BRUSSELS_WORLD_BOUNDS = {
  minX: sw.x, maxX: ne.x, minZ: ne.z, maxZ: sw.z
};

/** Coordinates for the first landmark/teleport pass. */
export const BRUSSELS_LANDMARK_ANCHORS = {
  grandPlace: { lat: 50.84673, lon: 4.35247, name: 'Grand-Place / Grote Markt' },
  mannekenPis: { lat: 50.84499, lon: 4.34998, name: 'Manneken Pis' },
  montDesArts: { lat: 50.84291, lon: 4.35785, name: 'Mont des Arts' },
  royalPalace: { lat: 50.84194, lon: 4.36302, name: 'Royal Palace of Brussels' },
  cathedral: { lat: 50.84667, lon: 4.36000, name: 'Cathedral of St Michael and St Gudula' },
  palaisDeJustice: { lat: 50.83662, lon: 4.35173, name: 'Palace of Justice' },
  cinquantenaire: { lat: 50.84105, lon: 4.39248, name: 'Parc du Cinquantenaire' },
  europeanParliament: { lat: 50.83890, lon: 4.37560, name: 'European Parliament' },
  atomium: { lat: 50.89492, lon: 4.34155, name: 'Atomium' },
  koekelbergBasilica: { lat: 50.86684, lon: 4.31640, name: 'National Basilica of the Sacred Heart' }
};
