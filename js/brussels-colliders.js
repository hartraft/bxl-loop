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

// Palais de la Bourse (Beurspaleis), Greek-cross plan on a high blue-stone socle.
// Local +Z = main facade toward the Place de la Bourse (bearing ~306 deg); the monumental
// stair corridor stays open on the front edge (z = 41) for x in [-13, 13].
const bourse = [
  // High socle retaining edges; the front edge is split around the central stair.
  { name: 'west socle edge', x: -53, z: 0, hx: 0.9, hz: 41, maxY: 5 },
  { name: 'east socle edge', x: 53, z: 0, hx: 0.9, hz: 41, maxY: 5 },
  { name: 'rear socle edge', x: 0, z: -41, hx: 53, hz: 0.9, maxY: 5 },
  { name: 'front socle edge west wing', x: -33, z: 41, hx: 20, hz: 0.9, maxY: 5 },
  { name: 'front socle edge east wing', x: 33, z: 41, hx: 20, hz: 0.9, maxY: 5 },
  // Peristyle cella wall behind the eight Corinthian columns.
  { name: 'cella wall', x: 0, z: 28, hx: 50, hz: 2, maxY: 24 },
  // The eight peristyle columns.
  ...[-18, -12.86, -7.71, -2.57, 2.57, 7.71, 12.86, 18].map((x, i) => ({ name: 'peristyle column ' + (i + 1), x, z: 36, hx: 1.0, hz: 1.0, maxY: 21 })),
  // Greek-cross arms and the four corner pavilions (plan ~106 x 82 m).
  { name: 'front arm', x: 0, z: 31, hx: 17, hz: 10, maxY: 26 },
  { name: 'rear arm', x: 0, z: -31, hx: 17, hz: 10, maxY: 26 },
  { name: 'west arm', x: -42, z: 0, hx: 11, hz: 17, maxY: 26 },
  { name: 'east arm', x: 42, z: 0, hx: 11, hz: 17, maxY: 26 },
  { name: 'NW corner pavilion', x: -42, z: 31, hx: 11, hz: 10, maxY: 26 },
  { name: 'NE corner pavilion', x: 42, z: 31, hx: 11, hz: 10, maxY: 26 },
  { name: 'SW corner pavilion', x: -42, z: -31, hx: 11, hz: 10, maxY: 26 },
  { name: 'SE corner pavilion', x: 42, z: -31, hx: 11, hz: 10, maxY: 26 },
  // Dome drum and glazed cupola on the four piers.
  { name: 'dome drum', x: 0, z: 0, hx: 13, hz: 13, maxY: 57 },
  // The two stair-flanking lions on their pedestals on the square.
  { name: 'bull lion pedestal', x: -14, z: 44, hx: 1.8, hz: 1.8, maxY: 3.2 },
  { name: 'bear lion pedestal', x: 14, z: 44, hx: 1.8, hz: 1.8, maxY: 3.2 }
];

// Place de la Bourse surroundings: the 1949 corner tower (E. De Heu, replacing the Grands
// Magasins de la Bourse burned in 1948) and the two 1884-85 eclectic apartment blocks opposite
// the palace; the square and Boulevard Anspach stay open.
const bourseSurroundings = [
  { name: '1949 corner tower (rue Paul Devaux corner)', x: -62, z: 96, hx: 12, hz: 12, maxY: 42 },
  { name: '1884-85 apartment block west', x: -30, z: 108, hx: 26, hz: 9, maxY: 24 },
  { name: '1884-85 apartment block east', x: 30, z: 108, hx: 26, hz: 9, maxY: 24 },
  { name: 'Orts fountain', x: -52, z: 78, hx: 1.2, hz: 1.2, maxY: 2.4 },
  { name: 'Auguste Orts monument', x: -48, z: 72, hx: 1.5, hz: 1.5, maxY: 5 },
  // Round 220: the three Bourse/Beurs premetro surface accesses (6, 7, 8).
  { name: 'premetro access 7 kiosk', x: -52, z: 103, hx: 2.0, hz: 2.0, maxY: 3.2 },
  { name: 'premetro access 8 kiosk', x: -40, z: 103, hx: 2.0, hz: 2.0, maxY: 3.2 },
  { name: 'premetro access 6 kiosk', x: 18, z: 100, hx: 2.0, hz: 2.0, maxY: 3.2 },
  // Round 260: the Ancienne Belgique concert hall and the Cafe de la Bourse blocks.
  { name: 'Ancienne Belgique block', x: -34, z: 142, hx: 13, hz: 8, maxY: 27 },
  { name: 'Cafe de la Bourse no. 78', x: 34, z: 130, hx: 15, hz: 8, maxY: 25 }
];

export const BRUSSELS_LANDMARK_COLLIDER_LAYOUT = Object.freeze({
  palaisDeJustice: Object.freeze(palaisDeJustice.map(Object.freeze)),
  montDesArts: Object.freeze(montDesArts.map(Object.freeze)),
  bourse: Object.freeze(bourse.map(Object.freeze)),
  bourseSurroundings: Object.freeze(bourseSurroundings.map(Object.freeze))
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
