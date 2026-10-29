// Brussels-specific world queries, landmarks and street-level teleports.
// Kept separate until the Brussels dataset and browser entry point are switched together.
import { GEO } from './brx-geodata.js';
import { createWorldQueries } from './brussels-base-world.js';
import { BRUSSELS_FRAME, BRUSSELS_WORLD_BOUNDS, BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld } from './brussels-frame.js';

export { GEO };
export const WORLD_BOUNDS = BRUSSELS_WORLD_BOUNDS;
export const WORLD = createWorldQueries(GEO);
export const ROADS = GEO.roads;

const landmarkMeta = [
  ['grandPlace', 'Grand-Place / Grote Markt', 'Grand-Place', 'Pentagon', 95],
  ['mannekenPis', 'Manneken Pis', 'Manneken Pis', 'Pentagon', 35],
  ['montDesArts', 'Mont des Arts / Kunstberg', 'Mont des Arts', 'Pentagon', 70],
  ['royalPalace', 'Royal Palace of Brussels', 'Royal Palace', 'Royal Quarter', 100],
  ['cathedral', 'St Michael and St Gudula Cathedral', 'Cathedral', 'Pentagon', 70],
  ['palaisDeJustice', 'Palace of Justice / Palais de Justice', 'Palace of Justice', 'Marolles', 110],
  ['cinquantenaire', 'Parc du Cinquantenaire / Jubelpark', 'Cinquantenaire', 'European Quarter', 150],
  ['europeanParliament', 'European Parliament', 'European Parliament', 'European Quarter', 100],
  ['koekelbergBasilica', 'National Basilica of the Sacred Heart', 'Koekelberg Basilica', 'Koekelberg', 130]
];

export const BRUSSELS_LANDMARKS = landmarkMeta.map(([id, name, short, district, r]) => {
  const a = BRUSSELS_LANDMARK_ANCHORS[id];
  const p = brusselsToWorld(a.lat, a.lon);
  return { id, name, short, district, r, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 };
});
// Compatibility export for city systems that currently consume the London config's landmark array.
export const LONDON_LANDMARKS = BRUSSELS_LANDMARKS;

const teleports = [
  ['grandPlace', 'Grand-Place', 'Grote Markt', 50.84725, 4.35315],
  ['mannekenPis', 'Manneken Pis', 'Rue de l’Étuve', 50.84478, 4.34985],
  ['montDesArts', 'Mont des Arts', 'Kunstberg', 50.84280, 4.35765],
  ['royalPalace', 'Royal Palace', 'Place des Palais', 50.84175, 4.36315],
  ['cathedral', 'St Michael and St Gudula Cathedral', 'Parvis Sainte-Gudule', 50.84645, 4.36025],
  ['palaisDeJustice', 'Palace of Justice', 'Place Poelaert', 50.83665, 4.35175],
  ['cinquantenaire', 'Cinquantenaire Park', 'Avenue de la Joyeuse Entrée', 50.84130, 4.39180],
  ['europeanParliament', 'European Parliament', 'Place du Luxembourg', 50.83870, 4.37480],
  ['koekelbergBasilica', 'Koekelberg Basilica', 'Parvis de la Basilique', 50.86670, 4.31635]
];

export const TELEPORT_LOCATIONS = Object.fromEntries(teleports.map(([id, name, sub, lat, lon]) => {
  const target = brusselsToWorld(lat, lon);
  const anchor = BRUSSELS_LANDMARK_ANCHORS[id];
  const hit = WORLD.nearestRoad(target.x, target.z, {
    kinds: ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'],
    maxDist: 300
  }) || WORLD.nearestRoad(target.x, target.z, {
    kinds: 'drive', maxDist: 400,
    filter: (road) => !['service', 'motorway', 'trunk'].includes(road.kind) && !road.tunnel
  }) || WORLD.nearestRoad(target.x, target.z, { kinds: 'walk', maxDist: 300 });
  let x = target.x, z = target.z, heading = 0;
  if (hit) {
    heading = hit.heading;
    if (hit.road.oneway === -1) heading += Math.PI;
    if (anchor && !hit.road.oneway) {
      const face = brusselsToWorld(anchor.lat, anchor.lon);
      if (Math.sin(heading) * (face.x - hit.x) + Math.cos(heading) * (face.z - hit.z) < 0) heading += Math.PI;
    }
    // Belgium drives on the right: offset to the right side of the road's travel direction.
    const off = Math.max(1, hit.road.w * 0.22);
    x = hit.x - Math.cos(heading) * off;
    z = hit.z + Math.sin(heading) * off;
  }
  return [id, { id, name, sub, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, heading: Math.round(heading * 1000) / 1000 }];
}));

export function getLocationLabel(x, z) {
  const landmark = BRUSSELS_LANDMARKS.find((l) => Math.hypot(x - l.x, z - l.z) < l.r);
  const street = WORLD.streetName(x, z);
  const district = WORLD.districtAt(x, z);
  let primary = landmark?.name || (WORLD.isWater(x, z) ? 'Brussels canal' : street || district || 'Brussels');
  let secondary = landmark ? street || landmark.district : district;
  if (secondary === primary) secondary = '';
  return { primary, secondary, text: secondary ? `${primary} · ${secondary}` : primary };
}
export const getLocationText = (x, z) => getLocationLabel(x, z).text;

export function isTypingInField(e) {
  return !!(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ||
    e.target.tagName === 'TEXTAREA' || e.target.isContentEditable === true));
}
