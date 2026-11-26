// Performance policy for the monumental landmark hotspots (Grand-Place, Royal Palace,
// Palais de Justice). These locations render hundreds of detailed meshes at once; the
// per-frame effects that cost the most there (planar road reflections, SSR on stone
// plazas) are skipped inside a radius around each landmark, and only the large
// architectural masses keep shadow-map work.
import { BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld } from './brussels-frame.js';

export const LANDMARK_PERF_MERGE_IDS = ['grandPlace', 'royalPalace', 'palaisDeJustice'];

// Radius around each landmark anchor where the expensive per-frame effects are relaxed.
const ZONE_RADII = { grandPlace: 82, royalPalace: 95, palaisDeJustice: 140 };

export const LANDMARK_PERFORMANCE_ZONES = Object.fromEntries(
  LANDMARK_PERF_MERGE_IDS.map((id) => {
    const anchor = BRUSSELS_LANDMARK_ANCHORS[id];
    const p = brusselsToWorld(anchor.lat, anchor.lon);
    const radius = ZONE_RADII[id];
    return [id, { id, x: p.x, z: p.z, radius, r2: radius * radius }];
  })
);

// Squared-distance zone test (no square root per frame); true inside any hotspot zone.
export function isWithinLandmarkPerformanceZone(x, z) {
  for (const id in LANDMARK_PERFORMANCE_ZONES) {
    const zone = LANDMARK_PERFORMANCE_ZONES[id];
    const dx = x - zone.x;
    const dz = z - zone.z;
    if (dx * dx + dz * dz <= zone.r2) return true;
  }
  return false;
}

// Which hotspot zone (if any) contains the point; used for diagnostics and tests.
export function landmarkPerformanceZoneAt(x, z) {
  for (const id in LANDMARK_PERFORMANCE_ZONES) {
    const zone = LANDMARK_PERFORMANCE_ZONES[id];
    const dx = x - zone.x;
    const dz = z - zone.z;
    if (dx * dx + dz * dz <= zone.r2) return id;
  }
  return null;
}

export function isWithinGrandPlacePerformanceZone(x, z, centerX, centerZ, radius = 82) {
  const dx = x - centerX;
  const dz = z - centerZ;
  return dx * dx + dz * dz <= radius * radius;
}

// The monumental masses still cast shadows, while the hundreds of tiny ornaments do not
// each become extra shadow-map casters. Small details also do not need to sample shadow maps.
export function landmarkShadowFlags(isInstanced, maxExtent) {
  return {
    castShadow: !isInstanced && maxExtent >= 8,
    receiveShadow: maxExtent >= 2.5
  };
}

export function grandPlaceShadowFlags(isInstanced, maxExtent) {
  return landmarkShadowFlags(isInstanced, maxExtent);
}
