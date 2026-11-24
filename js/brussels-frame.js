// js/brussels-frame.js — Brussels Loop world frame.
// 1 world unit = 1 metre. Origin = Grand-Place / Grote Markt. +x east, +z south, +y up.
// This module is intentionally separate from geo-frame.js until the Brussels geodata is baked;
// this frame is fixed: the world is built around it and the baked data is aligned to it.

export const BRUSSELS_FRAME = {
  lat0: 50.84673,
  lon0: 4.35247,
  // Initial central play area: canal/Heysel edge to Cinquantenaire and the southern Pentagon.
  // Tight enough for a first playable build; expand after performance profiling.
  bbox: { south: 50.815, west: 4.305, north: 50.875, east: 4.405 }
};

const RAD = Math.PI / 180;
const phi = BRUSSELS_FRAME.lat0 * RAD;
// Local +Z is the upper-city end of the Mont des Arts axis (southeast); the garden descends toward -Z (northwest).
export const MONT_DES_ARTS_ROTATION = Math.PI / 4;

// The Palais de Justice block is rotated in the real city: its Place Poelaert front edge runs at
// bearing ~131.7 deg, so the facade normal (local +Z of the landmark model) points at ~41.7 deg
// (0.727 rad) from north, and rotation.y = PI - 0.727 maps local +Z onto that bearing.
export const PALAIS_DE_JUSTICE_ROTATION = Math.PI - 0.727;

// The Bourse Palace (OSM way 13494623) sits on the south-east side of the Place de la Bourse
// (OSM way 787954099): from the building centroid (50.84795, 4.35043) to the square centroid
// (50.84832, 4.34963) is bearing ~306 deg, so the main facade normal (local +Z) points at
// ~306 deg from north and rotation.y = PI - 5.34 maps local +Z onto that bearing. The facade
// terminates the perspective of the rue Auguste Orts across the square.
export const BOURSE_ROTATION = Math.PI - 5.34;

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
  palaceSurroundings: { lat: 50.84194, lon: 4.36302, name: 'Royal Palace surroundings (Place des Palais, Brussels Park)' },
  cathedral: { lat: 50.84667, lon: 4.36000, name: 'Cathedral of St Michael and St Gudula' },
  palaisDeJustice: { lat: 50.83662, lon: 4.35173, name: 'Palace of Justice' },
  cinquantenaire: { lat: 50.84105, lon: 4.39248, name: 'Parc du Cinquantenaire' },
  europeanParliament: { lat: 50.83890, lon: 4.37560, name: 'European Parliament' },
  atomium: { lat: 50.89492, lon: 4.34155, name: 'Atomium' },
  koekelbergBasilica: { lat: 50.86684, lon: 4.31640, name: 'National Basilica of the Sacred Heart' },
  bourse: { lat: 50.84795, lon: 4.35043, name: 'Palais de la Bourse / Beurspaleis (Bruxelles Bourse)' },
  bourseSurroundings: { lat: 50.84795, lon: 4.35043, name: 'Bourse surroundings (Place de la Bourse / Beursplein, Boulevard Anspach)' }
};
