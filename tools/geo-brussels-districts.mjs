// tools/geo-brussels-districts.mjs — coarse character zones of central Brussels used for building defaults
// (height / material / roof when OSM doesn't say). Hand-drawn approximations in lat/lon, converted to world metres.
import { toWorld } from '../js/geo-frame.js';
import { pointInRing } from './geo-brussels-util.mjs';

const poly = (pts) => pts.map(([lat, lon]) => { const w = toWorld(lat, lon); return [w.x, w.z]; });
const circ = (lat, lon, r) => { const w = toWorld(lat, lon); return { x: w.x, z: w.z, r }; };

// Pentagon: the historic centre around the Grand-Place — low brick houses and terraces
const PENTAGON = poly([[50.8525, 4.3425], [50.8525, 4.3610], [50.8455, 4.3660], [50.8380, 4.3640],
  [50.8335, 4.3520], [50.8370, 4.3420], [50.8450, 4.3390]]);
// European Quarter: the Schuman / Luxembourg / Léopold axis — offices and glass towers
const EU_QUARTER = poly([[50.8465, 4.3620], [50.8465, 4.3920], [50.8360, 4.3920], [50.8330, 4.3760],
  [50.8360, 4.3620]]);
const EU_TOWERS = [circ(50.8415, 4.3780, 450), circ(50.8375, 4.3710, 350)]; // Schuman / Berlaymont area
// Quartier des Squares & Louise: grand 19th-century stucco façades with mansard roofs
const SQUARES = poly([[50.8550, 4.3560], [50.8560, 4.3740], [50.8470, 4.3760], [50.8450, 4.3580]]);
// Canal zone: warehouses and industry along the Brussels canal
const CANAL = poly([[50.8600, 4.3120], [50.8600, 4.3420], [50.8230, 4.3420], [50.8230, 4.3060]]);

const inC = (x, z, c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r;
const inAny = (x, z, cs) => cs.some((c) => inC(x, z, c));

/** character flags at a world point */
export function districtFlags(x, z) {
  return {
    pentagon: pointInRing(x, z, PENTAGON),
    euQuarter: pointInRing(x, z, EU_QUARTER),
    euTowers: inAny(x, z, EU_TOWERS),
    squares: pointInRing(x, z, SQUARES),
    canal: pointInRing(x, z, CANAL)
  };
}
