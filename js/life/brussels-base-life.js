// js/life/brussels-base-life.js — Workstream L: the living city beyond the roads — boats on the Thames, airliners and the
// odd helicopter overhead, pigeons on the squares.
//
//   import { createBrusselsLife } from './life/brussels-base-life.js';
//   const life = createBrusselsLife(scene, { world: WORLD, surfaceHeight: city.surfaceHeight });
//   life.update(dt, { camera, entity: controllerManager.getActiveEntity(), mode: controllerManager.activeMode,
//                     peds: trafficSystem.peds, night: VEHICLE_UNIFORMS.night.value });
//   // audio reads life.boats / life.aircraft / life.helicopters / life.events / life.nearestFlock()
import * as THREE from 'three/webgpu';
import { createRiverTraffic } from './river-traffic.js';
import { createSky } from './sky.js';
import { createPigeons } from './pigeons.js';

export function createBrusselsLife(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'BrusselsLife';
  scene.add(group);
  const ground = opts.surfaceHeight ? (x, z) => opts.surfaceHeight(x, z) + 0.005 : opts.world && opts.world.groundHeight ? (x, z) => opts.world.groundHeight(x, z, 'walk') + 0.02 : null;
  const river = opts.river === false ? null : createRiverTraffic(scene, { world: opts.world, group: addSub(group, 'ThamesTraffic') });
  const sky = opts.sky === false ? null : createSky(scene, { group: addSub(group, 'BrusselsSky'), interval: opts.planeInterval ?? 90 });
  const pigeons = opts.pigeons === false ? null : createPigeons(scene, { group: addSub(group, 'Pigeons'), ground });
  const events = [];
  const stats = { ms: 0, boatsDrawn: 0, pigeonsDrawn: 0, aircraft: 0 };

  function update(dt, ctx = {}) {
    const t0 = performance.now();
    dt = Math.min(Math.max(dt, 0), 0.1);
    const cam = ctx.camera ? ctx.camera.position : { x: 0, y: 0, z: 0 };
    const c = { ...ctx, cx: cam.x, cz: cam.z };
    if (river) stats.boatsDrawn = river.update(dt, c);
    if (sky) { sky.update(dt, c); stats.aircraft = sky.planes.length; }
    if (pigeons) stats.pigeonsDrawn = pigeons.update(dt, c);
    for (const src of [river && river.events, pigeons && pigeons.events]) if (src && src.length) { events.push(...src); src.length = 0; }
    if (events.length > 64) events.splice(0, events.length - 64);
    stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
  }

  return {
    group, river, sky, pigeons, events, stats, update,
    get boats() { return river ? river.boats : []; },
    get aircraft() { return sky ? sky.planes : []; },
    get helicopters() { return sky ? sky.helicopters : []; },
    nearestFlock: (x, z) => (pigeons ? pigeons.nearestFlock(x, z) : null),
    /** boats as SPEC colliders (for controllers, if the lead prefers that over the built-in push) */
    getDynamicColliders: (x, z, r) => (river ? river.getDynamicColliders(x, z, r) : []),
    set onBoatHit(fn) { if (river) river.onHit = fn; }
  };
}
function addSub(group, name) { const g = new THREE.Group(); g.name = name; group.add(g); return g; }
