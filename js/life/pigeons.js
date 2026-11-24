// js/life/pigeons.js — Brussels pigeons. Flocks peck about the Grand-Place, Place Sainte-Catherine, Mont des Arts,
// Place du Luxembourg and the other squares; they hop out of the way of passers-by and the whole flock bursts up
// when you come close (on foot, on a bike, or drive / fly at them), wheels round over the square and settles again.
// Two instanced draws for every bird in town (bodies + wings), only flocks near the camera are simulated.
import * as THREE from 'three/webgpu';
import { pigeonBodyGeometry, pigeonWingGeometry } from './models.js';
import { createVehicleMaterial } from '../brussels-vehicles.js';
import { parkInstances, makeShow } from './geo-kit.js';
import { toWorld } from '../geo-frame.js';

export const PIGEON_SPOTS = [
  { name: 'Grand-Place', lat: 50.84673, lon: 4.35247, r: 24, n: 46 },
  { name: 'Place Sainte-Catherine', lat: 50.85878, lon: 4.34972, r: 16, n: 22 },
  { name: 'Mont des Arts', lat: 50.84365, lon: 4.35600, r: 15, n: 24 },
  { name: 'Place du Luxembourg', lat: 50.83850, lon: 4.37350, r: 14, n: 22 },
  { name: 'Place Jourdan', lat: 50.81497, lon: 4.41283, r: 18, n: 18 },
  { name: 'Place Flagey', lat: 50.82670, lon: 4.37139, r: 9, n: 14 },
  { name: 'Petit Sablon', lat: 50.84595, lon: 4.36135, r: 8, n: 10 }
];
const SIM_DIST = 170;

export function createPigeons(scene, { group = null, ground = null, seed = 9, spots = PIGEON_SPOTS } = {}) {
  const root = group || new THREE.Group();
  root.name = 'Pigeons';
  if (!group) scene.add(root);
  let rs = seed;
  const rand = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const groundAt = ground || (() => 0.02);

  const flocks = spots.map((sp) => {
    const c = toWorld(sp.lat, sp.lon);
    const f = { name: sp.name, x: c.x, z: c.z, r: sp.r, birds: [], state: 'ground', timer: 0, spin: rand() < 0.5 ? 1 : -1, theta: 0, alt: 12, active: false };
    for (let i = 0; i < sp.n; i++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * sp.r;
      f.birds.push({ x: c.x + Math.cos(a) * rr, y: 0, z: c.z + Math.sin(a) * rr, vx: 0, vy: 0, vz: 0, h: rand() * 6.28, mode: 0, t: rand() * 10,
        walk: 0, peck: rand() * 3, flap: 0, off: rand() * Math.PI * 2, rad: 0.6 + rand() * 0.6, lift: rand(), tx: 0, tz: 0, hop: 0, gy: 0 });
    }
    return f;
  });
  const total = flocks.reduce((s, f) => s + f.birds.length, 0);
  const mat = createVehicleMaterial();
  const bodies = new THREE.InstancedMesh(pigeonBodyGeometry(), mat, total);
  bodies.name = 'Pigeon_bodies';
  const wings = new THREE.InstancedMesh(pigeonWingGeometry(), mat, total * 2);
  wings.name = 'Pigeon_wings';
  for (const m of [bodies, wings]) { m.frustumCulled = false; m.count = 0; m.castShadow = false; m.receiveShadow = true; parkInstances(m); root.add(m); }
  const show = makeShow();

  const events = [];
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _s2 = new THREE.Vector3();

  function scatter(f, tx, tz, strength = 1) {
    let n = 0;
    for (const b of f.birds) {
      const dx = b.x - tx, dz = b.z - tz, d = Math.hypot(dx, dz) || 1;
      if (b.mode !== 0 && b.mode !== 3) continue;
      if (strength < 1 && d > 3.2) continue; // a passer-by only moves the birds right in their way
      if (strength < 1) { b.mode = 3; b.hop = 0.7 + rand() * 0.5; b.vx = (dx / d) * 2.2; b.vz = (dz / d) * 2.2; b.vy = 2.2; n++; continue; }
      b.mode = 1;
      b.vx = (dx / d) * (3 + rand() * 2); b.vz = (dz / d) * (3 + rand() * 2); b.vy = 3.5 + rand() * 2.5;
      b.t = 0;
      n++;
    }
    if (strength >= 1) { f.state = 'air'; f.timer = 9 + rand() * 9; f.theta = Math.atan2(tz - f.z, tx - f.x) + Math.PI; f.alt = 9 + rand() * 7; }
    if (n > 3) events.push({ type: 'scatter', x: f.x, y: 1, z: f.z, n, small: strength < 1 });
  }

  function step(dt, ctx) {
    const cam = ctx.camera ? ctx.camera.position : { x: ctx.cx || 0, y: 0, z: ctx.cz || 0 };
    const threats = [];
    const e = ctx.entity;
    if (e && e.position) {
      const sp = Math.abs(e.speed || 0);
      const big = ctx.mode !== 'person' && ctx.mode !== 'cyclist';
      threats.push({ x: e.position.x, y: e.position.y, z: e.position.z, r: big ? 9 + sp * 0.6 : 4.5 + sp * 0.8, moving: sp > 0.4 || big });
    }
    for (const f of flocks) {
      f.active = Math.hypot(f.x - cam.x, f.z - cam.z) < SIM_DIST;
      if (!f.active) continue;
      // threats: the player; passers-by only nudge
      if (f.state === 'ground') {
        for (const t of threats) {
          if (Math.abs(t.y - groundAt(f.x, f.z)) > 25) continue;
          let near = false;
          for (const b of f.birds) if (b.mode === 0 && Math.hypot(b.x - t.x, b.z - t.z) < t.r && (t.moving || Math.hypot(b.x - t.x, b.z - t.z) < 2)) { near = true; break; }
          if (near) { scatter(f, t.x, t.z, 1); break; }
        }
        if (f.state === 'ground' && ctx.peds) {
          for (const p of ctx.peds) {
            if (!p.alive || Math.abs(p.x - f.x) > f.r + 4 || Math.abs(p.z - f.z) > f.r + 4) continue;
            if (p.speed > 0.3) for (const b of f.birds) if (b.mode === 0 && Math.abs(b.x - p.x) < 1.6 && Math.abs(b.z - p.z) < 1.6) { scatter(f, p.x, p.z, 0.4); break; }
          }
        }
      } else {
        f.timer -= dt;
        f.theta += f.spin * dt * 0.55;
        if (f.timer <= 0) {
          // land: everybody picks a spot on the square
          f.state = 'ground';
          for (const b of f.birds) if (b.mode === 1) { const a = rand() * 6.28, rr = Math.sqrt(rand()) * f.r; b.mode = 2; b.tx = f.x + Math.cos(a) * rr; b.tz = f.z + Math.sin(a) * rr; }
        }
      }
      for (const b of f.birds) birdStep(b, f, dt);
    }
  }

  function birdStep(b, f, dt) {
    b.t += dt;
    if (b.mode === 0) {
      // pecking about: short waddles, turn, peck
      b.walk -= dt;
      if (b.walk <= 0) { b.walk = 0.6 + rand() * 2.2; b.h += (rand() - 0.5) * 2.4; b.spd = rand() < 0.45 ? 0 : 0.18 + rand() * 0.25; }
      // stay on the square
      const dx = b.x - f.x, dz = b.z - f.z;
      if (dx * dx + dz * dz > f.r * f.r) b.h = Math.atan2(-dx, -dz) + (rand() - 0.5) * 0.6;
      b.x += Math.sin(b.h) * (b.spd || 0) * dt; b.z += Math.cos(b.h) * (b.spd || 0) * dt;
      b.gy = groundAt(b.x, b.z);
      b.y = b.gy;
      b.flap = 0;
      return;
    }
    if (b.mode === 3) {
      // a hop-and-flutter out of a pedestrian's way
      b.hop -= dt;
      b.vy -= 9.8 * dt * 0.6;
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
      b.flap += dt * 60;
      b.h = Math.atan2(b.vx, b.vz);
      const g = groundAt(b.x, b.z);
      if (b.y <= g && b.vy < 0) { b.y = g; b.mode = 0; b.walk = 0.5; }
      return;
    }
    let tx, ty, tz;
    if (b.mode === 1) {
      // wheel round above the square, each bird on its own slot of the flock's ring
      const a = f.theta + b.off * 0.35;
      tx = f.x + Math.cos(a) * f.r * b.rad * 1.2; tz = f.z + Math.sin(a) * f.r * b.rad * 1.2; ty = groundAt(f.x, f.z) + f.alt + b.lift * 4;
      if (b.t < 0.8) ty = b.y + 4; // climb out first
    } else { tx = b.tx; tz = b.tz; ty = groundAt(tx, tz); }
    const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z, d = Math.hypot(dx, dy, dz) || 1;
    const vmax = b.mode === 2 ? Math.min(7, 1.2 + d * 0.6) : 9;
    const k = b.mode === 2 ? 2.2 : 1.5;
    b.vx += ((dx / d) * vmax - b.vx) * Math.min(1, dt * k);
    b.vy += ((dy / d) * vmax - b.vy) * Math.min(1, dt * k);
    b.vz += ((dz / d) * vmax - b.vz) * Math.min(1, dt * k);
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    const hs = Math.hypot(b.vx, b.vz);
    if (hs > 0.3) b.h = Math.atan2(b.vx, b.vz);
    // flapping: hard on take-off & climbing, gliding on the turns, a flurry to brake when landing
    const climbing = b.vy > 0.5;
    b.flapRate = b.mode === 2 ? (d < 3 ? 14 : 3) : climbing || b.t < 1.5 ? 13 : (Math.sin(b.t * 0.7 + b.off) > 0.3 ? 9 : 0.5);
    b.flap += dt * b.flapRate;
    if (b.mode === 2 && d < 0.35) { b.mode = 0; b.y = ty; b.vx = b.vy = b.vz = 0; b.walk = 0.3 + rand(); }
  }

  function draw(camera) {
    let nb = 0, nw = 0;
    for (const f of flocks) {
      if (!f.active) continue;
      for (const b of f.birds) {
        let pitch = 0;
        if (b.mode === 0) { b.peck -= 0.016; if (b.peck < 0) { b.peck = 1.5 + rand() * 3; } pitch = b.peck < 0.25 ? 0.6 * Math.sin((b.peck / 0.25) * Math.PI) : 0; }
        else pitch = -Math.atan2(b.vy, Math.max(0.5, Math.hypot(b.vx, b.vz))) * 0.6;
        _e.set(pitch, b.h, 0, 'YXZ');
        _q.setFromEuler(_e);
        _p.set(b.x, b.y, b.z);
        _m.compose(_p, _q, _s);
        bodies.setMatrixAt(nb++, _m);
        if (b.mode !== 0) {
          const ang = Math.sin(b.flap * Math.PI * 2) * (b.flapRate > 2 ? 1.0 : 0.12) + 0.15;
          for (const side of [1, -1]) {
            _e.set(0, 0, side * ang);
            _q.setFromEuler(_e);
            _p.set(side * 0.05, 0.2, 0.02);
            _s2.set(side, 1, 1);
            _m2.compose(_p, _q, _s2).premultiply(_m);
            wings.setMatrixAt(nw++, _m2);
          }
        }
      }
    }
    bodies.count = nb; wings.count = nw;
    show(bodies, nb > 0); show(wings, nw > 0); show.tick();
    if (nb) bodies.instanceMatrix.needsUpdate = true;
    if (nw) wings.instanceMatrix.needsUpdate = true;
    return nb;
  }

  return {
    group: root, flocks, events,
    update(dt, ctx) { step(dt, ctx); return draw(ctx.camera); },
    scatter: (i = 0) => scatter(flocks[i], flocks[i].x + 3, flocks[i].z + 3, 1),
    /** nearest flock on the ground → {x, z, d} or null */
    nearestFlock(x, z) {
      let best = null, bd = Infinity;
      for (const f of flocks) { if (f.state !== 'ground') continue; const d = Math.hypot(f.x - x, f.z - z); if (d < bd) { bd = d; best = f; } }
      return best ? { x: best.x, z: best.z, d: bd } : null;
    }
  };
}
