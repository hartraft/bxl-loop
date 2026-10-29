// tools/geo-brussels-base-districts.mjs — coarse character zones of central Brussels used for building defaults
// (height / material / roof when OSM doesn't say). Hand-drawn approximations in lat/lon, converted to world metres.
import { toWorld } from '../js/geo-frame.js';
import { pointInRing } from './geo-brussels-base-util.mjs';

const poly = (pts) => pts.map(([lat, lon]) => { const w = toWorld(lat, lon); return [w.x, w.z]; });
const circ = (lat, lon, r) => { const w = toWorld(lat, lon); return { x: w.x, z: w.z, r }; };

const CITY = poly([[51.5113, -0.1132], [51.5162, -0.1112], [51.5206, -0.1062], [51.5232, -0.0900], [51.5228, -0.0778],
  [51.5155, -0.0716], [51.5098, -0.0738], [51.5080, -0.0800], [51.5090, -0.0985], [51.5104, -0.1082]]);
const CITY_CLUSTER = [circ(51.5140, -0.0830, 420), circ(51.5185, -0.0820, 260)]; // Bishopsgate/Leadenhall towers
const WEST_END = poly([[51.5230, -0.1620], [51.5240, -0.1320], [51.5195, -0.1190], [51.5130, -0.1150], [51.5085, -0.1200],
  [51.5055, -0.1290], [51.5030, -0.1400], [51.5040, -0.1520], [51.5100, -0.1600]]);
const WHITEHALL = poly([[51.5072, -0.1310], [51.5070, -0.1240], [51.5020, -0.1238], [51.4960, -0.1255], [51.4955, -0.1330],
  [51.5015, -0.1345]]);
const STUCCO = [circ(51.4975, -0.1545, 650), circ(51.4895, -0.1405, 650), circ(51.4945, -0.1765, 700), circ(51.4995, -0.1650, 380),
  circ(51.5115, -0.1850, 750), circ(51.5135, -0.2010, 550), circ(51.4900, -0.1600, 450)];
const REGENTS_TERRACES = circ(51.5272, -0.1532, 850);
const SOUTH_BANK = poly([[51.5085, -0.1200], [51.5090, -0.0840], [51.5025, -0.0800], [51.4990, -0.1000], [51.5005, -0.1180]]);
const NINE_ELMS = [circ(51.4825, -0.1320, 700), circ(51.4860, -0.1240, 400)];
const KINGS_CROSS = circ(51.5340, -0.1250, 500);

const inC = (x, z, c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r;
const inAny = (x, z, cs) => cs.some((c) => inC(x, z, c));

/** character flags at a world point */
export function districtFlags(x, z) {
  return {
    city: pointInRing(x, z, CITY),
    cityCluster: inAny(x, z, CITY_CLUSTER),
    westEnd: pointInRing(x, z, WEST_END),
    whitehall: pointInRing(x, z, WHITEHALL),
    stucco: inAny(x, z, STUCCO),
    regents: inC(x, z, REGENTS_TERRACES),
    southBank: pointInRing(x, z, SOUTH_BANK),
    nineElms: inAny(x, z, NINE_ELMS),
    kingsCross: inC(x, z, KINGS_CROSS)
  };
}
