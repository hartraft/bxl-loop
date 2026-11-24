// Local Grand-Place quality policy: skip expensive effects that add little value on its stone square.
export function isWithinGrandPlacePerformanceZone(x, z, centerX, centerZ, radius = 82) {
  const dx = x - centerX;
  const dz = z - centerZ;
  return dx * dx + dz * dz <= radius * radius;
}

// The guild-house silhouettes still cast shadows, while the hundreds of tiny ornaments do not
// each become extra shadow-map casters. Small details also do not need to sample shadow maps.
export function grandPlaceShadowFlags(isInstanced, maxExtent) {
  return {
    castShadow: !isInstanced && maxExtent >= 8,
    receiveShadow: maxExtent >= 2.5
  };
}
