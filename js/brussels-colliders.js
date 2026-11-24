// Pure world-frame collider definitions for the Brussels landmark models.
// Coordinates and dimensions are metres in each landmark's local frame.

/** Return the two side wings of a retaining wall with a clear central passage. */
export function splitMontDesArtsWall(width, opening = 18) {
  if (!Number.isFinite(width) || !Number.isFinite(opening) || width <= opening || opening <= 0) {
    throw new RangeError('Wall width must exceed a positive central opening');
  }
  const halfWidth = (width - opening) / 4;
  const centre = (width + opening) / 4;
  return [-1, 1].map(side => ({ x: side * centre, halfWidth }));
}

const palaisDeJustice = [
  // The four occupied courthouse ranges and the central hall; the courtyards remain open.
  // Plan 160 x 150 m on a 186 x 177 m podium (local +Z = north toward Place Poelaert,
  // local +X = west toward rue des Minimes).
  { name: 'rear range', x: 0, z: -66.5, hx: 80, hz: 8.5, maxY: 33 },
  // Split the entrance-facing range around the broad principal stair and portico.
  { name: 'entrance range west wing', x: -57, z: 66.5, hx: 23, hz: 8.5, maxY: 33 },
  { name: 'entrance range east wing', x: 57, z: 66.5, hx: 23, hz: 8.5, maxY: 33 },
  { name: 'west range', x: 71.5, z: 0, hx: 8.5, hz: 58, maxY: 33 },
  { name: 'east range', x: -71.5, z: 0, hx: 8.5, hz: 58, maxY: 33 },
  { name: 'central hall', x: 0, z: 0, hx: 28, hz: 11, maxY: 48 },
  { name: 'dome drum', x: 0, z: 0, hx: 20, hz: 20, maxY: 122 },
  // The four corner pavilions with their hipped roofs (top ~47.3 m).
  { name: 'corner pavilion', x: -66, z: 64, hx: 14, hz: 15, maxY: 48 },
  { name: 'corner pavilion', x: 66, z: 64, hx: 14, hz: 15, maxY: 48 },
  { name: 'corner pavilion', x: -66, z: -61.5, hx: 14, hz: 13.5, maxY: 48 },
  { name: 'corner pavilion', x: 66, z: -61.5, hx: 14, hz: 13.5, maxY: 48 },
  // Podium retaining edges. The north edge is split around the principal stair corridor.
  { name: 'west podium edge', x: 93, z: 0, hx: 0.9, hz: 88.5, maxY: 1.2 },
  { name: 'east podium edge', x: -93, z: 0, hx: 0.9, hz: 88.5, maxY: 1.2 },
  { name: 'south podium edge', x: 0, z: -88.5, hx: 93, hz: 0.9, maxY: 1.2 },
  // North retaining wall wings: aligned with the rendered wall (x 38..93 / -93..-38, z 88.5..91.5),
  // leaving the 76 m-wide central stair corridor open.
  { name: 'north wall west wing', x: -65.5, z: 90, hx: 27.5, hz: 1.5, maxY: 2.5 },
  { name: 'north wall east wing', x: 65.5, z: 90, hx: 27.5, hz: 1.5, maxY: 2.5 }
];

const montDesArts = [
  // Underground garage perimeter only; do not fill the garden deck with one solid collider.
  { name: 'garage west wall', x: -56.5, z: 0, hx: 0.75, hz: 66, maxY: 0.1 },
  { name: 'garage east wall', x: 56.5, z: 0, hx: 0.75, hz: 66, maxY: 0.1 },
  { name: 'garage upper wall', x: 0, z: 66.5, hx: 56, hz: 0.75, maxY: 0.1 },
  { name: 'garage lower wall', x: 0, z: -66.5, hx: 56, hz: 0.75, maxY: 0.1 },
  // Each terrace retaining wall and coping is represented by a matching wing pair,
  // leaving an 18 m central stair corridor. Bounds include the wider, taller coping.
  ...Array.from({ length: 8 }, (_, i) => {
    const width = 78 - Math.max(0, i - 5) * 2.5;
    const copingWidth = width + 2.5;
    const y = 1.1 + (7 - i) * 1.65;
    const z = 43 - i * 12.2 - 12.5 / 2;
    return splitMontDesArtsWall(copingWidth).map(({ x, halfWidth }, wing) => ({
      name: `terrace ${i + 1} retaining wall and coping ${wing === 0 ? 'west' : 'east'}`,
      x, z, hx: halfWidth, hz: 0.7, maxY: y + 0.48
    }));
  }).flat(),
  // Opaque cultural-building masses. The carillon passage itself stays open between its piers.
  { name: 'KBR Albertina', x: 66, z: 10, hx: 18, hz: 11.5, maxY: 26 },
  { name: 'BOZAR wing', x: -65, z: 8, hx: 15.5, hz: 11, maxY: 21 },
  { name: 'SQUARE congress volume', x: -70, z: -49, hx: 14.5, hz: 12.5, maxY: 16.5 },
  { name: 'carillon west pier', x: -17, z: -67, hx: 2, hz: 4, maxY: 13 },
  { name: 'carillon east pier', x: 17, z: -67, hx: 2, hz: 4, maxY: 13 }
];

export const BRUSSELS_LANDMARK_COLLIDER_LAYOUT = Object.freeze({
  palaisDeJustice: Object.freeze(palaisDeJustice.map(Object.freeze)),
  montDesArts: Object.freeze(montDesArts.map(Object.freeze))
});

/** Convert local OBB descriptors into the shared world-space AABB + OBB collider format. */
export function createBrusselsLandmarkColliders(id, anchor, yaw = 0, baseY = 0) {
  const layout = BRUSSELS_LANDMARK_COLLIDER_LAYOUT[id];
  if (!layout) return [];
  if (![anchor?.x, anchor?.z, yaw, baseY].every(Number.isFinite)) {
    throw new TypeError('Invalid Brussels landmark collider frame');
  }
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  return layout.map(({ x, z, hx, hz, maxY }) => {
    const cx = anchor.x + x * cos + z * sin;
    const cz = anchor.z - x * sin + z * cos;
    const ex = Math.abs(cos) * hx + Math.abs(sin) * hz;
    const ez = Math.abs(sin) * hx + Math.abs(cos) * hz;
    return {
      minX: cx - ex, maxX: cx + ex,
      minZ: cz - ez, maxZ: cz + ez,
      maxY: baseY + maxY,
      obb: { cx, cz, hx, hz, cs: cos, sn: sin }
    };
  });
}
