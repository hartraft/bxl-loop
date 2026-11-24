// Squared-distance sphere test shared by scene culling and its Node regression test.
// Avoid a square root for every spatial chunk on every animation frame.
function sphereWithinDistance(x, y, z, radius, maxDistance, cameraX, cameraY, cameraZ) {
  const dx = x - cameraX;
  const dy = y - cameraY;
  const dz = z - cameraZ;
  const limit = maxDistance + radius;
  return dx * dx + dy * dy + dz * dz < limit * limit;
}

export { sphereWithinDistance };
