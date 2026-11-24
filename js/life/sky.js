// js/life/sky.js — life overhead. Airliners crossing the city on approach, ~1 km up, one every ~90 s,
// with nav lights, strobes and the red beacon blinking; and now and then a helicopter crossing the city
// a few hundred metres up.
import * as THREE from 'three/webgpu';
import { airlinerGeometry } from './models.js';
import { VEHICLE_FACTORIES, createVehicleMaterial, createVehicleUniforms } from '../brussels-vehicles.js';
import { parkInstances, makeShow } from './geo-kit.js';

const MAX_PLANES = 4;
const PLANE_SPEED = 82; // m/s (~160 kt on approach)
const LIGHTS_PER_PLANE = 5;

export function createSky(scene, { group = null, seed = 5, interval = 90, heliEvery = [150, 320] } = {}) {
  const root = group || new THREE.Group();
  root.name = 'BrusselsSky';
  if (!group) scene.add(root);
  let rs = seed;
  const rand = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);

  const planeMesh = new THREE.InstancedMesh(airlinerGeometry(), createVehicleMaterial(), MAX_PLANES);
  planeMesh.name = 'Sky_airliners';
  planeMesh.frustumCulled = false;
  planeMesh.castShadow = false;
  planeMesh.count = 0;
  parkInstances(planeMesh);
  root.add(planeMesh);
  const show = makeShow();
  // point lights as camera-scaled glow dots (nav, strobes, beacon, landing lights)
  const dotMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  dotMat.toneMapped = false;
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), dotMat, MAX_PLANES * LIGHTS_PER_PLANE + 8);
  dots.name = 'Sky_lights';
  dots.frustumCulled = false;
  dots.count = 0;
  dots.setColorAt(0, new THREE.Color(0, 0, 0));
  parkInstances(dots);
  root.add(dots);

  const planes = [];
  let timer = 8 + rand() * 10;
  function spawnPlane() {
    // the approach lines are a few km wide: random lateral offset across the city
    const z = -1800 + rand() * 3400;
    planes.push({ x: 11000, y: 0, z, vx: -PLANE_SPEED, vy: 0, vz: (rand() - 0.5) * 3, age: 0, phase: rand() });
  }

  // helicopter (one at a time): a policeHeli model with its own lamps
  const heliU = createVehicleUniforms();
  const heliModel = VEHICLE_FACTORIES.policeHeli({ uniforms: heliU });
  heliModel.position.set(0, -20000, 0); // parked out of sight until a flight (stays in the scene so it compiles up front)
  heliModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  root.add(heliModel);
  const rotor = heliModel.userData.mainRotor, tail = heliModel.userData.tailRotor;
  const helicopters = [];
  let heliTimer = heliEvery[0] * 0.3 + rand() * 60;
  function spawnHeli(cx, cz) {
    const a = rand() * Math.PI * 2, r = 2600;
    const x0 = cx + Math.cos(a) * r, z0 = cz + Math.sin(a) * r;
    // a line passing within ~0–600 m of the camera
    const off = (rand() - 0.5) * 1200;
    const tx = cx - x0 + Math.cos(a + Math.PI / 2) * off, tz = cz - z0 + Math.sin(a + Math.PI / 2) * off;
    const l = Math.hypot(tx, tz);
    const sp = 45 + rand() * 15;
    helicopters.push({ x: x0, y: 230 + rand() * 200, z: z0, vx: (tx / l) * sp, vy: 0, vz: (tz / l) * sp, age: 0, life: (2 * r) / sp });
  }

  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  const RED = new THREE.Color(4, 0.25, 0.2), GREEN = new THREE.Color(0.25, 4, 0.5), WHITE = new THREE.Color(5, 5, 5), WARM = new THREE.Color(5, 4.4, 3.4);
  let t = 0;

  function update(dt, { camera, cx = 0, cz = 0, night = 0 } = {}) {
    t += dt;
    timer -= dt;
    if (timer <= 0) { timer = interval * (night > 0.7 ? 2.4 : 1) * (0.7 + rand() * 0.6); if (planes.length < MAX_PLANES) spawnPlane(); }
    const cam = camera ? camera.position : { x: cx, y: 0, z: cz };
    let n = 0, nd = 0;
    for (let i = planes.length - 1; i >= 0; i--) {
      const p = planes[i];
      p.age += dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.y = 1060 + p.x * 0.0524; // 3° glide slope towards the airport (~20 km east)
      p.vy = p.vx * 0.0524;
      if (p.x < -13000) { planes.splice(i, 1); continue; }
      const yaw = Math.atan2(p.vx, p.vz);
      _e.set(-Math.atan2(p.vy, PLANE_SPEED) + 0.035, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(p.x, p.y, p.z); _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      planeMesh.setMatrixAt(n++, _m);
      // lights: wingtip nav (red left/port, green right), tail white, beacon (red, 1 Hz), strobes (white double flash)
      const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      const sz = Math.max(0.35, d * 0.0016);
      const vis = 0.35 + night * 0.65;
      const ph = (t + p.phase) % 1.2;
      const strobe = ph < 0.06 || (ph > 0.14 && ph < 0.2);
      const beacon = (t + p.phase * 3) % 1 < 0.12;
      const L = (lx, ly, lz, col, k) => {
        if (k <= 0) return;
        _p.set(lx, ly, lz).applyMatrix4(_m);
        _s.setScalar(sz * k);
        _m2.compose(_p, _q, _s);
        dots.setMatrixAt(nd, _m2);
        dots.setColorAt(nd++, _c.copy(col).multiplyScalar(vis));
      };
      L(-16.6, -0.9, -5.5, RED, 1);
      L(16.6, -0.9, -5.5, GREEN, 1);
      if (strobe) { L(-16.8, -0.9, -5.6, WHITE, 1.4); L(16.8, -0.9, -5.6, WHITE, 1.4); }
      if (beacon) L(0, 2.2, -2, RED, 1.2);
      if (night > 0.2 && p.x < 9000) L(0, -1.6, 12, WARM, 2.2 * night); // landing lights on
    }
    planeMesh.count = n;
    show(planeMesh, n > 0);
    if (n) planeMesh.instanceMatrix.needsUpdate = true;

    // helicopter
    heliTimer -= dt;
    if (heliTimer <= 0 && !helicopters.length) { heliTimer = heliEvery[0] + rand() * (heliEvery[1] - heliEvery[0]); spawnHeli(cx, cz); }
    for (let i = helicopters.length - 1; i >= 0; i--) {
      const h = helicopters[i];
      h.age += dt;
      h.x += h.vx * dt; h.z += h.vz * dt;
      if (h.age > h.life) { helicopters.splice(i, 1); continue; }
    }
    const h = helicopters[0];
    show(heliModel, !!h);
    if (!h) heliModel.position.set(0, -20000, 0);
    if (h) {
      heliModel.position.set(h.x, h.y, h.z);
      heliModel.rotation.set(0.12, Math.atan2(h.vx, h.vz), 0, 'YXZ');
      if (rotor) rotor.rotation.y += dt * 38;
      if (tail) tail.rotation.x += dt * 160;
      heliU.beacon.value = (t % 1) < 0.15 ? 1 : 0;
      if (night > 0.2 && h.y) {
        const d = Math.hypot(h.x - cam.x, h.y - cam.y, h.z - cam.z);
        _p.set(h.x, h.y - 1.2, h.z); _s.setScalar(Math.max(0.3, d * 0.0018)); _q.identity();
        _m.compose(_p, _q, _s);
        if ((t % 1) < 0.15) { dots.setMatrixAt(nd, _m); dots.setColorAt(nd++, _c.copy(RED)); }
      }
    }
    dots.count = nd;
    show(dots, nd > 0);
    show.tick();
    if (nd) { dots.instanceMatrix.needsUpdate = true; dots.instanceColor.needsUpdate = true; }
  }

  return {
    group: root, planes, helicopters, update,
    /** start a flight now (testing) */
    spawnPlane, spawnHeli: (x, z) => spawnHeli(x, z),
    get aircraft() { return planes; }
  };
}
