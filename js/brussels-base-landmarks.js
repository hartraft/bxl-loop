// js/brussels-base-landmarks.js — Brussels Loop landmark models (Workstream B)
//
//   import { buildBrusselsLandmarks } from './brussels-base-landmarks.js';
//   const lm = buildBrusselsLandmarks(scene, { world, uniforms: cityUniforms });
//   // each frame: lm.update(dt, timeOfDayHours)
//
// Returns { group, colliders, update(dt, timeOfDay), zones, landmarks, towerBridge, setNight(v) }.
// Every landmark is one child group of `group` (name 'BrusselsLandmarks'), placed at its real position & orientation
// in the geo-frame (1 unit = 1 m, +x east, +z south). Static parts are merged per material (a handful of draw calls
// per landmark); animated parts (Eye wheel + capsules, bascules, fountains, flags, LED screens) are separate meshes.
import { LM, linkCityUniforms, hasCityUniforms, brusselsTime } from './landmarks/common.js';
import { buildWestminster } from './landmarks/westminster.js';
import { buildBrusselsEye } from './landmarks/brussels-eye.js';
import { buildTowerBridge } from './landmarks/tower-bridge.js';
import { buildShard } from './landmarks/shard.js';
import { buildStPauls } from './landmarks/st-pauls.js';
import { buildGherkin } from './landmarks/gherkin.js';
import { buildBuckinghamPalace } from './landmarks/buckingham.js';
import { buildTrafalgarSquare } from './landmarks/trafalgar.js';
import { buildPiccadillyCircus } from './landmarks/piccadilly.js';
import { buildBattersea } from './landmarks/battersea.js';
import * as THREE from 'three/webgpu';
import { buildBrusselsLandmarks } from './brussels-landmarks.js';

export const LANDMARK_BUILDERS = {
  westminster: buildWestminster, // Elizabeth Tower (Big Ben) + Palace of Westminster
  brusselsEye: buildBrusselsEye,
  towerBridge: buildTowerBridge,
  shard: buildShard,
  stPauls: buildStPauls,
  gherkin: buildGherkin,
  buckinghamPalace: buildBuckinghamPalace, // + Victoria Memorial, forecourt railings & gates
  trafalgarSquare: buildTrafalgarSquare, // Nelson's Column, lions, fountains, plinths
  piccadillyCircus: buildPiccadillyCircus, // curved LED screens + Shaftesbury Memorial Fountain (Eros)
  battersea: buildBattersea
};
/** aliases accepted by `only` / the sandbox */
export const LANDMARK_ALIASES = { bigBen: 'westminster', parliament: 'westminster', eye: 'brusselsEye', stPaul: 'stPauls', buckingham: 'buckinghamPalace', trafalgar: 'trafalgarSquare', nelson: 'trafalgarSquare', piccadilly: 'piccadillyCircus', eros: 'piccadillyCircus', batterseaPowerStation: 'battersea' };

/**
 * @param {THREE.Scene} scene
 * @param {{ world?: object, uniforms?: object, only?: string[], towerBridgeDeckY?: number }} opts
 *   world    — createWorldQueries(GEO) (optional; Tower Bridge samples world.groundHeight for its deck profile)
 *   uniforms — the city's shared TSL uniforms (tsl-materials.js cityUniforms); when given, night lighting & glass
 *              reflections follow the lighting presets automatically
 *   only     — subset of landmark ids to build (sandbox)
 */
export function buildBrusselsLandmarks(scene, opts = {}) {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels') {
    return buildBrusselsLandmarks(scene, opts);
  }
  const { world = null, uniforms = null, only = null } = opts;
  linkCityUniforms(uniforms);
  const group = new THREE.Group();
  group.name = 'BrusselsLandmarks';
  const colliders = [];
  const zones = [];
  const landmarks = {};
  const updaters = [];
  const ids = only ? [...new Set(only.map((k) => LANDMARK_ALIASES[k] || k))] : Object.keys(LANDMARK_BUILDERS);
  for (const id of ids) {
    const build = LANDMARK_BUILDERS[id];
    if (!build) { console.warn('[landmarks] unknown landmark', id); continue; }
    const lm = build({ world, opts });
    group.add(lm.group);
    colliders.push(...lm.colliders);
    zones.push(...lm.zones);
    landmarks[id] = lm;
    if (lm.update) updaters.push(lm.update);
  }
  if (scene) scene.add(group);

  let clockTimer = 1e9;
  const update = (dt = 0.016, timeOfDay) => {
    if (!hasCityUniforms() && typeof timeOfDay === 'number') {
      // hours 0–24 → night factor (dark 20:30 – 05:30, ramps over an hour)
      const h = ((timeOfDay % 24) + 24) % 24;
      const s = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
      LM.uNight.value = Math.max(s(19.5, 20.7, h), 1 - s(5.0, 6.3, h));
    }
    clockTimer += dt;
    if (clockTimer > 1) {
      clockTimer = 0;
      const { h, m, s } = brusselsTime();
      LM.uClockM.value = ((m + s / 60) / 60) * Math.PI * 2;
      LM.uClockH.value = (((h % 12) + m / 60) / 12) * Math.PI * 2;
    }
    for (const u of updaters) u(dt, timeOfDay);
  };
  update(0);

  const tb = landmarks.towerBridge;
  return {
    group,
    colliders,
    zones,
    update,
    landmarks,
    towerBridge: tb ? tb.api : null,
    /** manual night override (0 day … 1 night) when no city uniforms are linked */
    setNight: (v) => { LM.uNight.value = v; }
  };
}

export { LM as LANDMARK_UNIFORMS };
