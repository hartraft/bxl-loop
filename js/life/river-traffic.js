// js/life/river-traffic.js — boats on the Brussels canal. River boats, sightseeing boats, a tug with
// a lighter barge and RIBs run up and down the fairway both ways (keeping to starboard, through the navigation arches
// of the bridges), call at the quays, sound their horns when they leave, leave foamy wakes, keep clear of the
// player's boat (slow, stop, swerve) and push it out of their way if it rams them.
import * as THREE from 'three/webgpu';
import { buildRiverPath } from './river-path.js';
import { catamaranGeometry, tugBargeGeometry, ribGeometry } from './models.js';
import { VEHICLE_FACTORIES, createVehicleMaterial, getInstanceParts } from '../brussels-vehicles.js';
import { parkInstances, makeShow } from './geo-kit.js';

const WATER = -1.2;
const TYPES = {
  clipper: { len: 38.4, halfW: 4.3, vmax: 10.5, acc: 0.6, stop: 0.9, dwell: [25, 45], wake: 1.2, count: 5 },
  tourist: { len: 27.1, halfW: 3.95, vmax: 4.6, acc: 0.35, stop: 0.5, dwell: [40, 80], wake: 0.8, count: 5 },
  barge: { len: 48, halfW: 4.7, vmax: 3.2, acc: 0.15, stop: 0, dwell: [0, 0], wake: 1.0, count: 2 },
  rib: { len: 9.6, halfW: 1.7, vmax: 13, acc: 1.6, stop: 0, dwell: [0, 0], wake: 0.6, count: 3 }
};
const TOURIST_HULLS = [0x1c2f55, 0x7a1d24, 0x1f5a3c, 0x23262b, 0xece9e2];
const WAKE_POOL = 520;
const DRAW_DIST = 2200;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _sphere = new THREE.Sphere();

function foamTexture() {
  if (typeof document === 'undefined') return null;
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1, d = Math.hypot(dx, dy);
    // a soft blob of broken foam (brighter towards a ragged rim)
    const ring = 0.55 * Math.exp(-Math.pow((d - 0.55) / 0.28, 2)) + 0.5 * Math.exp(-Math.pow(d / 0.5, 2));
    const grain = r() < 0.55 ? 0.25 + r() * 0.5 : 0.9 + r() * 0.3;
    const v = Math.max(0, Math.min(1, ring * grain)) * Math.max(0, Math.min(1, (1 - d) * 4));
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRiverTraffic(scene, { world, group = null, seed = 3 } = {}) {
  const river = buildRiverPath(world);
  const root = group || new THREE.Group();
  root.name = 'CanalTraffic';
  if (!group) scene.add(root);
  let rs = seed;
  const rand = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);

  // ---- meshes ------------------------------------------------------------------------------------------------
  const kinds = {};
  const show = makeShow();
  const mk = (name, geometry, material, cap, shadow = true) => {
    const m = new THREE.InstancedMesh(geometry, material, cap);
    m.name = 'Canal_' + name;
    m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
    parkInstances(m);
    root.add(m);
    return m;
  };
  const bodyMat = createVehicleMaterial();
  const paintMat = createVehicleMaterial({ instancePaint: true });
  const addPaint = (g, cap) => { g.setAttribute('aPaint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)); return g; };
  kinds.clipper = { meshes: [mk('clipper', addPaint(catamaranGeometry(), TYPES.clipper.count), paintMat, TYPES.clipper.count)], paints: [0x2b3442, 0x1d2430, 0x3a4250] };
  const tb = getInstanceParts(VEHICLE_FACTORIES.riverBoat(), { instancePaint: true });
  kinds.tourist = { meshes: tb.parts.map((pt) => mk('tourist_' + pt.name, pt.name === 'body' ? addPaint(pt.geometry, TYPES.tourist.count) : pt.geometry, pt.material, TYPES.tourist.count, pt.name === 'body')), paints: TOURIST_HULLS };
  kinds.barge = { meshes: [mk('barge', tugBargeGeometry(), bodyMat, TYPES.barge.count)], paints: null };
  kinds.rib = { meshes: [mk('rib', ribGeometry(), bodyMat, TYPES.rib.count, false)], paints: null };
  for (const K of Object.values(kinds)) { K.body = K.meshes.find((m) => m.geometry.attributes.aPaint); K.n = 0; }

  // wakes: additive foam rings on the water, fading as they spread
  const wakeMat = new THREE.MeshBasicNodeMaterial({ map: foamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  wakeMat.toneMapped = true;
  const wakeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const wakes = mk('wakes', wakeGeo, wakeMat, WAKE_POOL, false);
  wakes.receiveShadow = false;
  wakes.renderOrder = 2;
  wakes.setColorAt(0, _c.setRGB(0, 0, 0));
  const foam = []; // {x, z, vx, vz, age, life, r0, r1, a}
  let foamHead = 0;
  for (let i = 0; i < WAKE_POOL; i++) foam.push({ age: 1, life: 0 });

  // ---- boats --------------------------------------------------------------------------------------------------
  const boats = [];
  let id = 0;
  for (const [type, T] of Object.entries(TYPES)) {
    for (let i = 0; i < T.count; i++) {
      const dir = i % 2 ? -1 : 1;
      const b = { id: id++, type, T, dir, s: 0, lat: 0, latV: 0, speed: T.vmax * 0.8, x: 0, z: 0, y: WATER, yaw: 0, roll: 0, pitch: 0,
        state: 'cruise', dwell: 0, pier: null, paint: Math.floor(rand() * 1000), phase: rand() * 10, wakeT: 0, halfW: T.halfW, half: T.len / 2, horn: 0 };
      b.s = 80 + rand() * (river.length - 160);
      b.lat = river.laneOffset(b.s, dir);
      boats.push(b);
    }
  }
  // spread them out: no two boats of the same direction within 120 m
  for (const b of boats) for (let k = 0; k < 20; k++) {
    if (!boats.some((o) => o !== b && o.dir === b.dir && Math.abs(o.s - b.s) < 120)) break;
    b.s = 80 + rand() * (river.length - 160); b.lat = river.laneOffset(b.s, b.dir);
  }
  const events = [];
  const pt = {};
  const player = { on: false, x: 0, z: 0, s: 0, lat: 0, hx: 4, hz: 13.5, heading: 0 };

  function nextPier(b) {
    if (!b.T.stop) return null;
    let best = null;
    for (const p of river.piers) {
      const ahead = (p.s - b.s) * b.dir;
      if (ahead < 60) continue;
      // piers on the boat's own (starboard) side of the river
      if ((b.dir > 0 && p.side > 0) || (b.dir < 0 && p.side < 0)) continue;
      if (!best || ahead < (best.s - b.s) * b.dir) best = p;
    }
    return best && rand() < b.T.stop ? best : null;
  }

  function step(dt, ctx) {
    // the player's boat (mode 'boat') in fairway coordinates
    player.on = !!(ctx.entity && ctx.mode === 'boat');
    if (player.on) {
      const e = ctx.entity;
      player.x = e.position.x; player.z = e.position.z; player.heading = e.heading || 0;
      const he = e.halfExtents || { hx: 3.95, hz: 13.5 };
      player.hx = he.hx; player.hz = he.hz;
      const nr = river.nearest(player.x, player.z);
      player.s = nr.s; player.lat = nr.lat;
    }
    for (const b of boats) {
      const T = b.T;
      // target speed: cruise, slow for the quay, follow the boat ahead, give way to the player
      let vt = T.vmax;
      if (b.state === 'cruise' && !b.pier) b.pier = nextPier(b) || false;
      if (b.pier) {
        const d = (b.pier.s - b.s) * b.dir;
        vt = Math.min(vt, Math.max(0.6, Math.sqrt(Math.max(0, d - 4) * 2 * T.acc * 0.8)));
        if (d < 5 && b.state === 'cruise') { b.state = 'moored'; b.dwell = T.dwell[0] + rand() * (T.dwell[1] - T.dwell[0]); }
      }
      if (b.state === 'moored') {
        vt = 0;
        b.dwell -= dt;
        if (b.dwell <= 0) { b.state = 'depart'; b.horn = 1; events.push({ type: 'horn', x: b.x, y: 0, z: b.z, dur: b.type === 'clipper' ? 0.8 : 1.4, f: b.type === 'clipper' ? 210 : 150 }); }
      }
      if (b.state === 'depart' && Math.abs(b.lat - river.laneOffset(b.s, b.dir)) < 3) { b.state = 'cruise'; b.pier = null; }
      for (const o of boats) {
        if (o === b || o.dir !== b.dir) continue;
        const gap = (o.s - b.s) * b.dir - o.half - b.half;
        if (gap < 0 || gap > 120) continue;
        if (Math.abs(o.lat - b.lat) > o.halfW + b.halfW + 6) continue;
        vt = Math.min(vt, Math.max(0, (gap - 15) / 8) * Math.max(o.speed, 1.5) + (gap > 40 ? 2 : 0));
      }
      let dodge = 0;
      if (player.on) {
        const ahead = (player.s - b.s) * b.dir;
        const clearLat = player.hx + b.halfW + 7;
        const dl = player.lat - b.lat;
        if (ahead > -b.half - player.hz && ahead < 110 && Math.abs(dl) < clearLat + 8) {
          // swerve away from the player (towards whichever side has room), stop if still in the way
          dodge = dl > 0 ? -1 : 1;
          const gap = ahead - b.half - player.hz;
          if (Math.abs(dl) < clearLat) vt = Math.min(vt, Math.max(0, (gap - 6) / 6));
        }
      }
      // speed
      const a = vt > b.speed ? T.acc : -Math.max(T.acc * 1.6, 0.5);
      b.speed += Math.max(-Math.abs(b.speed - vt), Math.min(Math.abs(b.speed - vt), a * dt)) * (vt > b.speed ? 1 : 1);
      b.speed = Math.max(0, b.speed);
      b.s += b.speed * dt * b.dir;
      // lateral: lane / pier berth / dodge, as a damped spring
      let latT = river.laneOffset(b.s, b.dir);
      if (b.state === 'moored' || (b.pier && (b.pier.s - b.s) * b.dir < 160)) latT = b.pier ? b.pier.lat - Math.sign(b.pier.lat) * (b.halfW + 1.5) : latT;
      if (dodge) {
        river.at(b.s, 0, pt);
        const room = dodge > 0 ? pt.clearL : pt.clearR;
        latT += dodge * Math.min(18, Math.max(0, room - Math.abs(latT) - b.halfW - 4));
      }
      const k = 0.25, c = 0.9;
      b.latV += ((latT - b.lat) * k - b.latV * c) * dt;
      b.latV = Math.max(-1.6, Math.min(1.6, b.latV));
      b.lat += b.latV * dt;
      // wrap round at the ends of the river (out of sight, far away)
      if (b.s > river.length - 20 || b.s < 20) {
        const far = (s) => { river.at(s, 0, pt); return Math.hypot(pt.x - ctx.cx, pt.z - ctx.cz) > 700; };
        if (far(b.s)) {
          b.s = b.dir > 0 ? 30 + rand() * 30 : river.length - 30 - rand() * 30;
          if (!far(b.s)) b.s = b.dir > 0 ? river.length - 25 : 25; // both ends in view: just park it
          b.lat = river.laneOffset(b.s, b.dir); b.latV = 0; b.state = 'cruise'; b.pier = null;
        } else { b.speed = 0; b.s = Math.max(20, Math.min(river.length - 20, b.s)); }
      }
      // pose
      river.at(b.s, b.lat, pt);
      const px = b.x, pz = b.z;
      b.x = pt.x; b.z = pt.z;
      const fx = pt.dx * b.dir + pt.dz * b.latV * 0.08 * b.dir, fz = pt.dz * b.dir - pt.dx * b.latV * 0.08 * b.dir;
      b.yaw = Math.atan2(fx, fz);
      b.vx = b.dt ? (b.x - px) / dt : 0; b.vz = b.dt ? (b.z - pz) / dt : 0; b.dt = dt;
      b.phase += dt;
      const sp01 = b.speed / T.vmax;
      if (b.type === 'rib') { b.pitch = -0.08 * sp01 + Math.sin(b.phase * 5.3) * 0.03 * sp01; b.roll = Math.sin(b.phase * 3.1) * 0.04; b.y = WATER + 0.05 + Math.abs(Math.sin(b.phase * 4.1)) * 0.12 * sp01; }
      else { b.pitch = -0.012 * sp01 + Math.sin(b.phase * 0.9) * 0.006; b.roll = Math.sin(b.phase * 0.7 + b.id) * 0.012 - b.latV * 0.02; b.y = WATER + Math.sin(b.phase * 1.1) * 0.05; }
    }
    // the player's boat: pushed out of any boat it overlaps (SAT on the two footprints)
    if (player.on) for (const b of boats) pushPlayer(b, ctx.entity);
  }

  function pushPlayer(b, e) {
    const dx = e.position.x - b.x, dz = e.position.z - b.z;
    if (Math.abs(dx) > b.half + player.hz + 2 || Math.abs(dz) > b.half + player.hz + 2) return;
    const A = [[Math.sin(b.yaw), Math.cos(b.yaw)], [Math.cos(b.yaw), -Math.sin(b.yaw)]];
    const Bx = [[Math.sin(player.heading), Math.cos(player.heading)], [Math.cos(player.heading), -Math.sin(player.heading)]];
    const ext = (u, F, hz, hx) => Math.abs(F[0][0] * u[0] + F[0][1] * u[1]) * hz + Math.abs(F[1][0] * u[0] + F[1][1] * u[1]) * hx;
    let best = Infinity, nx = 0, nz = 0;
    for (const u of [...A, ...Bx]) {
      const pen = ext(u, A, b.half, b.halfW) + ext(u, Bx, player.hz, player.hx) - Math.abs(dx * u[0] + dz * u[1]);
      if (pen <= 0) return;
      if (pen < best) { best = pen; const sg = dx * u[0] + dz * u[1] >= 0 ? 1 : -1; nx = u[0] * sg; nz = u[1] * sg; }
    }
    e.position.x += nx * best; e.position.z += nz * best;
    if (e.mesh) e.mesh.position.copy(e.position);
    const into = Math.sin(player.heading) * -nx + Math.cos(player.heading) * -nz;
    if (into > 0.2 && typeof e.speed === 'number' && e.speed > 0.5) {
      const imp = e.speed * into;
      e.speed *= 1 - 0.6 * into;
      if (imp > 1 && ctxRef.onHit) ctxRef.onHit({ impulse: imp, x: e.position.x, z: e.position.z, boat: b });
    }
  }
  const ctxRef = { onHit: null };

  // ---- draw ---------------------------------------------------------------------------------------------------
  function spawnFoam(x, z, vx, vz, r0, r1, life, a) {
    const f = foam[foamHead];
    foamHead = (foamHead + 1) % WAKE_POOL;
    f.x = x; f.z = z; f.vx = vx; f.vz = vz; f.r0 = r0; f.r1 = r1; f.life = life; f.age = 0; f.a = a; f.rot = rand() * 6.28;
  }
  function draw(dt, camera) {
    const cam = camera ? camera.position : { x: 0, y: 0, z: 0 };
    if (camera) { camera.updateMatrixWorld(); _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pv); }
    for (const K of Object.values(kinds)) K.n = 0;
    let drawn = 0;
    for (const b of boats) {
      const d = Math.hypot(b.x - cam.x, b.z - cam.z);
      // wakes near the camera
      if (d < 700 && b.speed > 0.8) {
        b.wakeT -= dt;
        if (b.wakeT <= 0) {
          b.wakeT = 0.09;
          const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rx = fz, rz = -fx;
          const w = b.T.wake * Math.min(1, b.speed / 5);
          for (const s of [-1, 1]) {
            const sx = b.x - fx * b.half * 0.95 + rx * s * b.halfW * 0.7, sz = b.z - fz * b.half * 0.95 + rz * s * b.halfW * 0.7;
            spawnFoam(sx, sz, rx * s * b.speed * 0.2, rz * s * b.speed * 0.2, b.halfW * 0.45, b.halfW * 0.9 + b.speed * 0.45, 5 + b.speed * 0.3, 0.16 * w);
          }
          spawnFoam(b.x - fx * b.half, b.z - fz * b.half, 0, 0, b.halfW * 0.5, b.halfW * 1.1, 3.5, 0.2 * w); // prop wash
          spawnFoam(b.x + fx * b.half * 0.9, b.z + fz * b.half * 0.9, 0, 0, b.halfW * 0.35, b.halfW * 0.9, 1.2, 0.12 * w); // bow wave
        }
      }
      if (d > DRAW_DIST) continue;
      if (camera) { _sphere.center.set(b.x, 2, b.z); _sphere.radius = b.half + 4; if (!_frustum.intersectsSphere(_sphere)) continue; }
      const K = kinds[b.type];
      const i = K.n++;
      _e.set(b.pitch, b.yaw, b.roll, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(b.x, b.y, b.z);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      for (const m of K.meshes) m.setMatrixAt(i, _m);
      if (K.body && K.paints) {
        _c.set(K.paints[b.paint % K.paints.length]);
        const arr = K.body.geometry.attributes.aPaint.array;
        arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b;
      }
      drawn++;
    }
    for (const K of Object.values(kinds)) {
      for (const m of K.meshes) { m.count = K.n; show(m, K.n > 0); if (K.n) m.instanceMatrix.needsUpdate = true; }
      if (K.body && K.n) K.body.geometry.attributes.aPaint.needsUpdate = true;
    }
    // foam
    let nf = 0;
    for (const f of foam) {
      if (f.age >= f.life) continue;
      f.age += dt;
      if (f.age >= f.life) continue;
      f.x += f.vx * dt; f.z += f.vz * dt; f.vx *= 1 - dt * 0.35; f.vz *= 1 - dt * 0.35;
      if (Math.abs(f.x - cam.x) > 900 || Math.abs(f.z - cam.z) > 900) continue;
      const u = f.age / f.life;
      const r = f.r0 + (f.r1 - f.r0) * Math.sqrt(u);
      _q.setFromAxisAngle(_p.set(0, 1, 0), f.rot);
      _p.set(f.x, WATER + 0.06, f.z);
      _s.set(r * 2, 1, r * 2);
      _m.compose(_p, _q, _s);
      wakes.setMatrixAt(nf, _m);
      const a = f.a * Math.min(1, f.age * 4) * (1 - u) * (1 - u);
      wakes.setColorAt(nf, _c.setRGB(a, a, a));
      nf++;
    }
    wakes.count = nf;
    show(wakes, nf > 0);
    show.tick();
    if (nf) { wakes.instanceMatrix.needsUpdate = true; wakes.instanceColor.needsUpdate = true; }
    return drawn;
  }

  return {
    group: root, river, boats, events,
    update(dt, ctx) { step(dt, ctx); return draw(dt, ctx.camera); },
    set onHit(fn) { ctxRef.onHit = fn; },
    /** SPEC colliders of the boats within r of (x, z) */
    getDynamicColliders(x, z, r = 80) {
      const out = [];
      for (const b of boats) {
        if (Math.abs(b.x - x) > r + b.half || Math.abs(b.z - z) > r + b.half) continue;
        const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);
        const ex = Math.abs(sn) * b.half + Math.abs(cs) * b.halfW, ez = Math.abs(cs) * b.half + Math.abs(sn) * b.halfW;
        out.push({ minX: b.x - ex, maxX: b.x + ex, minZ: b.z - ez, maxZ: b.z + ez, minY: WATER - 1, maxY: WATER + 5, obb: { cx: b.x, cz: b.z, hx: b.halfW, hz: b.half, cs, sn }, boat: b });
      }
      return out;
    }
  };
}
