import * as THREE from 'three/webgpu';
import { texture, uv, attribute, float, uniform } from 'three/tsl';
import { GEO, WORLD, BRUSSELS_LANDMARKS } from './city-config.js';
import { buildLondonRoadNetwork, ASPECT_NAMES } from './road-network.js';
import { createTrafficSim, VEHICLE_TYPES } from './traffic-sim.js';
import { VEHICLE_FACTORIES, VEHICLE_UNIFORMS, CAR_COLOURS, getInstanceParts, createVehicleUniforms } from './brussels-base-vehicles.js';
import { brusselsBus } from './brussels-bus.js';
import { createBusPlanner, loadBusRoutes } from './life/bus-routes.js';
const IS_BRUSSELS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels';
import { toWorld } from './geo-frame.js';
import { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } from './vehicle-lights.js';
import { createContactShadowMaterial } from './tsl-materials.js';
import { LondonCrowd } from './pedestrians.js';

// js/traffic.js — Workstream G: London traffic & pedestrians, drawn.
//
//   const traffic = createTrafficSystem(scene, { network, geo, world, towerBridge });   // network optional (built here)
//   traffic.update(dt, elapsed, cameraPos, playerEntity, activeMode, camera);         // NY signature, or
//   traffic.update(dt, camera, playerEntity, activeMode);
//
// The simulation (left-hand lanes, IDM car following, signals, zebras, roundabouts, buses at stops, pedestrians) is
// js/traffic-sim.js — pure JS, tested headless (tests/traffic-sim.test.mjs). This file renders it:
// - Workstream C's London models (black cab, hatch / saloon / SUV / van, red double-deckers per route), one
//   InstancedMesh per model part (body with per-instance paint + decals), instanced wheels near the camera, contact
//   shadows, brake lights & blinking indicators (one instanced lamp mesh), a pool of headlight spots at night.
// - LondonCrowd (pedestrians.js) for the people, with umbrellas in the rain (setRain).
// It also pushes the player out of traffic (like NY did) and offers getDynamicColliders() in the SPEC format.

const NUM_VEHICLES = 200;
const NUM_PEDS = 260;
const RADIUS = 420;
const DRAW_DIST = 480;
const WHEEL_DIST = 90;
const HEADLIGHT_POOL = 10;

// districts where black cabs are thick on the ground, and where the pavements are busiest
const CAB_DISTRICTS = new Set(['Soho', 'Mayfair', 'Covent Garden', 'Seven Dials', 'St Giles', "St. James's", 'Westminster', 'The City', 'Bank',
  'Monument', 'Holborn', 'Fitzrovia', 'Marylebone', 'Temple', 'St Clement Danes', 'Blackfriars', 'Aldgate', 'Bishopsgate', 'Moorgate',
  "St Paul's", 'Leadenhall Market', 'Knightsbridge', 'Belgravia', 'Victoria']);
const BUSY_DISTRICTS = new Set(['Soho', 'Covent Garden', 'Seven Dials', 'St Giles', 'The City', 'Bank', 'Monument', 'South Bank', 'Waterloo',
  'Bankside', 'Westminster', "St. James's", 'Mayfair', 'Leadenhall Market', "St Paul's", 'Holborn', 'Fitzrovia', 'Borough Market',
  'Spitalfields', 'Aldgate', 'Bishopsgate', 'Blackfriars', 'Temple']);

const BLIND_COLS = 2, BLIND_ROWS = 20, BLIND_W = 512, BLIND_H = 128; // destination-blind atlas: 40 slots (route × direction)
// street performers draw a ring of onlookers (traffic-sim "shows")
const SHOWS = [
  { name: 'Covent Garden Piazza', lat: 51.51163, lon: -0.12362, crowd: 14, open: 0.6 },
  { name: 'South Bank, Queen\'s Walk', lat: 51.50585, lon: -0.11775, crowd: 11, open: 2.2 },
  { name: 'Leicester Square', lat: 51.51043, lon: -0.13005, crowd: 9, open: 4.0 }
].map((s) => ({ ...s, ...toWorld(s.lat, s.lon) }));
const CAB_PAINTS = [0x0b0c0e, 0x0b0c0e, 0x0b0c0e, 0x0b0c0e, 0x0b0c0e, 0x0b0c0e, 0x2a2d33, 0x5a1d24, 0x1c2a44, 0xc9ccd0];
const VAN_PAINTS = [0xf1f2f0, 0xf1f2f0, 0xf1f2f0, 0xb8bcc0, 0x1f2f55, 0x2a2b2e];

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _dir = new THREE.Vector3();

function createTrafficSystem(scene, opts = {}) {
  // NY call shape createTrafficSystem(scene, sidewalks, footprints) still works (those are ignored in London)
  if (Array.isArray(opts)) opts = {};
  const geo = opts.geo || GEO;
  const world = opts.world || WORLD;
  const network = opts.network || buildLondonRoadNetwork(geo, world);
  // people walk Workstream F's drawn pavements when we have them (else the network's derived ones)
  if (opts.sidewalks && opts.sidewalks.strips && opts.sidewalks.strips.length) network.usePavements(opts.sidewalks.strips);
  const numVehicles = opts.vehicles ?? NUM_VEHICLES;
  const numPeds = opts.peds ?? NUM_PEDS;

  const group = new THREE.Group();
  group.name = 'LondonTraffic';
  scene.add(group);

  // ---- models ------------------------------------------------------------------------------------------------
  const variants = [];
  const byType = {};
  function addVariant(type, model, paints, cap, route = '') {
    const parts = getInstanceParts(model, { instancePaint: true });
    const spec = parts.spec || model.userData.spec || {};
    const meshes = parts.parts.map((pt) => {
      const g = pt.geometry;
      if (pt.name === 'body') g.setAttribute('aPaint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
      const m = new THREE.InstancedMesh(g, pt.material, cap);
      m.name = `Traffic_${type}${route}_${pt.name}`;
      m.castShadow = pt.name === 'body';
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      group.add(m);
      return m;
    });
    let wheels = null;
    if (parts.wheels) {
      const pl = parts.wheels.placements;
      const mk = (geom, side) => {
        const n = pl.filter((w) => (side > 0 ? w.x >= 0 : w.x < 0)).length;
        const m = new THREE.InstancedMesh(geom, parts.wheels.material, Math.max(1, cap * n));
        m.name = `Traffic_${type}${route}_wheels${side > 0 ? 'L' : 'R'}`;
        m.castShadow = true;
        m.frustumCulled = false;
        m.count = 0;
        group.add(m);
        return { mesh: m, places: pl.filter((w) => (side > 0 ? w.x >= 0 : w.x < 0)) };
      };
      wheels = [mk(parts.wheels.left, 1), mk(parts.wheels.right, -1)];
    }
    const body = meshes.find((m) => m.geometry.attributes.aPaint);
    const V = { type, route, meshes, body, wheels, spec, paints: paints.map((h) => new THREE.Color(h)), cap, count: 0, wheelCount: [0, 0] };
    variants.push(V);
    (byType[type] || (byType[type] = [])).push(V);
    return V;
  }
  const F = VEHICLE_FACTORIES;
  addVariant('cab', F.blackCab(), CAB_PAINTS, 90); // TAXI sign lit: for hire
  const hiredU = createVehicleUniforms();
  hiredU.sign.value = 0;
  addVariant('cab', F.blackCab({ uniforms: hiredU }), CAB_PAINTS, 70, 'hired'); // sign off: carrying a fare
  addVariant('hatch', F.hatch({ seed: 3 }), CAR_COLOURS, 110);
  addVariant('saloon', F.saloon({ seed: 5 }), CAR_COLOURS, 110);
  addVariant('suv', F.suv({ seed: 7 }), CAR_COLOURS, 80);
  addVariant('van', F.van({ seed: 9 }), VAN_PAINTS, 60);
  // buses: one model; route number & destination per instance from a blind atlas (real routes, data/ldn-bus-routes.json)
  const BUS_CAP = 48;
  const busModel = IS_BRUSSELS
    ? brusselsBus({ route: '71', destination: 'De Brouckère' })
    : F.doubleDecker({ route: '0', destination: ' ' });
  const busV = addVariant('bus', busModel, IS_BRUSSELS ? [0xf47721] : [0xc8102e], BUS_CAP);
  const planner = createBusPlanner(network);
  const blindCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const blindTex = blindCanvas ? new THREE.CanvasTexture(blindCanvas) : new THREE.Texture();
  blindTex.colorSpace = THREE.SRGBColorSpace;
  blindTex.anisotropy = 4;
  const blindRows = BLIND_ROWS; // fixed size: the texture is never re-allocated when the real routes arrive
  const blindAttr = new THREE.InstancedBufferAttribute(new Float32Array(BUS_CAP * 2), 2);
  function drawBlinds(variants) {
    variants = variants.slice(0, BLIND_COLS * BLIND_ROWS);
    if (!blindCanvas || !blindCanvas.getContext) return;
    blindCanvas.width = BLIND_W * BLIND_COLS; blindCanvas.height = BLIND_H * blindRows;
    const ctx = blindCanvas.getContext('2d');
    if (!ctx || !ctx.fillRect) return;
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, blindCanvas.width, blindCanvas.height);
    ctx.fillStyle = '#ffcf3a';
    const fit = (text, x, y, w, h, weight) => {
      let size = h;
      ctx.font = `${weight} ${size}px Arial, Helvetica, "DejaVu Sans", sans-serif`;
      const m = ctx.measureText(text).width;
      if (m > w) size = Math.floor(size * (w / m));
      ctx.font = `${weight} ${size}px Arial, Helvetica, "DejaVu Sans", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + h / 2 + size * 0.04);
    };
    variants.forEach((v, i) => {
      const x = (i % BLIND_COLS) * BLIND_W, y = Math.floor(i / BLIND_COLS) * BLIND_H;
      // same layout as london-vehicles.js getBlindTexture at half size: route + destination on top, route below
      fit(String(v.ref), x + 6, y + 4, 110, 56, '900');
      fit(v.destination, x + 120, y + 11, 385, 42, '700');
      fit(String(v.ref), x + 6, y + 68, 116, 56, '900');
    });
    blindTex.needsUpdate = true;
  }
  drawBlinds(planner.variants);
  {
    const bm = busV.meshes.find((m) => m.name.endsWith('_blinds'));
    if (bm && !IS_BRUSSELS) {
      bm.geometry.setAttribute('aBlind', blindAttr);
      const mat = new THREE.MeshStandardNodeMaterial();
      const t = texture(blindTex, uv().add(attribute('aBlind', 'vec2')).mul(uniform(new THREE.Vector2(1 / BLIND_COLS, 1 / BLIND_ROWS))));
      mat.colorNode = t.rgb;
      mat.opacityNode = t.a;
      mat.alphaTest = 0.5;
      mat.roughnessNode = float(0.3);
      mat.metalnessNode = float(0);
      mat.emissiveNode = t.rgb.mul(VEHICLE_UNIFORMS.night.mul(1.6).add(0.55)); // LED blind, as london-vehicles' class 7
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      mat.name = 'BusBlindAtlas';
      bm.material = mat;
    }
  }
  if (!IS_BRUSSELS) loadBusRoutes().then((d) => { if (d) { planner.setData(d); drawBlinds(planner.variants); } });

  // vehicle dimensions for the sim from the models themselves
  const types = {};
  for (const [t, T] of Object.entries(VEHICLE_TYPES)) {
    const sp = byType[t] && byType[t][0].spec;
    types[t] = { ...T, len: sp && sp.length ? sp.length : T.len, width: sp && sp.width ? sp.width : T.width };
  }

  // ---- simulation --------------------------------------------------------------------------------------------
  const lmNear = (x, z, k) => BRUSSELS_LANDMARKS.some((l) => Math.hypot(x - l.x, z - l.z) < l.r * k);
  const sim = createTrafficSim(network, {
    vehicles: numVehicles, peds: numPeds, radius: opts.radius ?? RADIUS, types, towerBridge: opts.towerBridge || null,
    assignBus: (v, lane, s) => planner.assign(v, lane, s),
    replanBus: (v, lane) => planner.replan(v, lane),
    cabShareAt: (x, z) => (CAB_DISTRICTS.has(world.districtAt(x, z)) ? 0.22 : 0.08),
    densityAt: (x, z) => (BUSY_DISTRICTS.has(world.districtAt(x, z)) ? 3 : 1) * (lmNear(x, z, 2.5) ? 2 : 1),
    touristAt: opts.touristAt || ((x, z) => (lmNear(x, z, 2.5) ? 0.45 : 0.06)),
    busStops: geo.busStops || null,
    groundAt: (x, z, y0 = 0) => {
      const pa = opts.sidewalks && opts.sidewalks.pavementAt ? opts.sidewalks.pavementAt(x, z) : null;
      return pa ?? (world.groundHeight ? world.groundHeight(x, z, 'walk') : y0);
    },
    // tourists stop to photograph the landmark they're at
    lookAt: (x, z) => {
      let best = null, bd = Infinity;
      for (const l of BRUSSELS_LANDMARKS) { const d = Math.hypot(x - l.x, z - l.z); if (d < l.r * 2.5 && d < bd) { bd = d; best = l; } }
      return best;
    },
    shows: opts.shows === false ? [] : SHOWS
  });

  // ---- shadows, lamps, headlights -----------------------------------------------------------------------------
  const unitPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowInst = new THREE.InstancedMesh(unitPlane, createContactShadowMaterial(), numVehicles);
  shadowInst.name = 'TrafficContactShadows';
  shadowInst.renderOrder = 998;
  shadowInst.frustumCulled = false;
  shadowInst.count = 0;
  group.add(shadowInst);

  const lampGeo = new THREE.BoxGeometry(0.24, 0.12, 0.04);
  const lampMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
  lampMat.toneMapped = false;
  const lampInst = new THREE.InstancedMesh(lampGeo, lampMat, numVehicles * 4);
  lampInst.name = 'TrafficLamps';
  lampInst.frustumCulled = false;
  lampInst.count = 0;
  lampInst.setColorAt(0, _c.set(0, 0, 0));
  group.add(lampInst);
  const BRAKE = new THREE.Color(3.2, 0.18, 0.12);
  const AMBER = new THREE.Color(3.0, 1.3, 0.1);

  const lightsGroup = new THREE.Group();
  lightsGroup.name = 'TrafficHeadlights';
  group.add(lightsGroup);
  const spots = [];
  for (let i = 0; i < HEADLIGHT_POOL; i++) {
    const s = createVehicleHeadlight();
    s.position.set(0, -1000, 0);
    s.target.position.set(0, -1001, 0);
    lightsGroup.add(s, s.target);
    spots.push(s);
  }

  // ---- people ---------------------------------------------------------------------------------------------------
  const crowd = new LondonCrowd(numPeds);
  group.add(...crowd.meshes);

  // ---- player ---------------------------------------------------------------------------------------------------
  const player = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, halfW: 0.9, halfL: 2.3 };
  let pushPlayer = opts.pushPlayer !== false;

  function playerSnapshot(entity, mode) {
    if (!entity || !entity.position || mode === 'helicopter' || mode === 'boat') return null;
    const y = entity.position.y - (world.groundHeight ? world.groundHeight(entity.position.x, entity.position.z, 'drive') : 0);
    if (y > 2.6) return null;
    const h = entity.heading || 0, sp = entity.speed || 0;
    player.x = entity.position.x; player.z = entity.position.z; player.heading = h;
    player.vx = Math.sin(h) * sp + (entity.vx || 0); player.vz = Math.cos(h) * sp + (entity.vz || 0);
    const he = entity.halfExtents;
    player.halfW = he ? he.hx : mode === 'cyclist' ? 0.35 : mode === 'person' ? 0.32 : 0.95;
    player.halfL = he ? he.hz : mode === 'cyclist' ? 0.9 : mode === 'person' ? 0.32 : 2.35;
    player.mode = mode;
    return player;
  }

  // SAT overlap of a vehicle and the player box: pushes the player out (cars give a little, buses don't)
  function collidePlayer(v, entity) {
    const dx = entity.position.x - v.x, dz = entity.position.z - v.z;
    if (Math.abs(dx) > v.half + 3 || Math.abs(dz) > v.half + 3) return;
    const axes = [[Math.sin(v.yaw), Math.cos(v.yaw)], [Math.cos(v.yaw), -Math.sin(v.yaw)],
      [Math.sin(player.heading), Math.cos(player.heading)], [Math.cos(player.heading), -Math.sin(player.heading)]];
    const ext = (ux, uz, f, half, halfW) => Math.abs(f[0] * ux + f[1] * uz) * half + Math.abs(f[1] * ux - f[0] * uz) * halfW;
    let best = Infinity, nx = 0, nz = 0;
    for (const [ux, uz] of axes) {
      const r = ext(ux, uz, axes[0], v.half, v.halfW) + ext(ux, uz, axes[2], player.halfL, player.halfW);
      const d = dx * ux + dz * uz;
      const pen = r - Math.abs(d);
      if (pen <= 0) return;
      if (pen < best) { best = pen; nx = d >= 0 ? ux : -ux; nz = d >= 0 ? uz : -uz; }
    }
    // A deep overlap means the vehicle was spawned / routed onto the player (e.g. a traffic bus dwelling at the stop
    // where a bus shift starts): it would carry the player along its lane every frame. Recycle it instead.
    if (best > 0.5) { sim.kill(v); return; }
    const share = v.bus ? 1 : entity.mass > 5000 ? 0.15 : 0.85; // the player's 12.5 t bus barely gives
    const push = Math.min(best * share, 0.12); // never drag the player more than 12 cm a frame
    entity.position.x += nx * push;
    entity.position.z += nz * push;
    if (entity.mesh) entity.mesh.position.copy(entity.position);
    // closing speed (player towards the vehicle). Only a real knock (> 1 m/s) costs speed on either side: resting
    // bumper-to-bumper contact (holding W behind a queue) used to cut the other car's speed every frame, so it could
    // never pull away and the player sat stuck behind it.
    const rel = (player.vx - Math.sin(v.yaw) * v.speed) * -nx + (player.vz - Math.cos(v.yaw) * v.speed) * -nz;
    if (rel > 1.0 && typeof entity.speed === 'number') {
      const head = Math.abs(Math.sin(player.heading) * nx + Math.cos(player.heading) * nz);
      entity.speed *= 1 - (v.bus ? 0.7 : 0.5) * head;
      if (entity.type === 'car') { entity.vx = (entity.vx || 0) + nx * rel * 0.4; entity.vz = (entity.vz || 0) + nz * rel * 0.4; }
      v.speed *= 0.5;
      v.bumped = 1.5;
      if (opts.onPlayerHit) opts.onPlayerHit({ impulse: rel, x: entity.position.x, z: entity.position.z, vehicle: v });
    } else if (rel > 0 && typeof entity.speed === 'number') {
      // pressing gently against it: just don't let the player gain speed into it
      const into = Math.sin(player.heading) * -nx + Math.cos(player.heading) * -nz;
      if (into > 0.3 && entity.speed > 0) entity.speed = Math.min(entity.speed, Math.max(0, v.speed * into));
    }
  }

  // ---- signals for props / paint ------------------------------------------------------------------------------
  const signalAspects = new Uint8Array(network.signalHeads.length);
  let signalClock = -1;
  const headGrid = new Map();
  for (const h of network.signalHeads) {
    const k = Math.floor(h.x / 40) * 65536 + Math.floor(h.z / 40);
    (headGrid.get(k) || headGrid.set(k, []).get(k)).push(h);
  }
  function refreshSignals() {
    for (let i = 0; i < signalAspects.length; i++) signalAspects[i] = sim.headAspect(i);
  }

  // ---- update ---------------------------------------------------------------------------------------------------
  const cars = [];
  let lastNight = -1;
  function update(dt, a, b, c, d, e) {
    let camera, focus, entity, mode;
    if (typeof a === 'number') { focus = b; entity = c; mode = d || 'car'; camera = e; } else { camera = a; entity = b; mode = c || 'car'; focus = camera && camera.position; }
    const fx = focus ? focus.x : 0, fz = focus ? focus.z : 0;
    if (camera) {
      camera.updateMatrixWorld();
      _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pv);
      camera.getWorldDirection(_dir);
    }
    const cam = camera ? camera.position : null;
    const visible = camera ? (x, z, r) => {
      const ddx = x - cam.x, ddz = z - cam.z;
      if (ddx * ddx + ddz * ddz > DRAW_DIST * DRAW_DIST) return false;
      _sphere.center.set(x, 2, z);
      _sphere.radius = r + 2;
      return _frustum.intersectsSphere(_sphere);
    } : null;
    const pl = playerSnapshot(entity, mode);
    const dl = Math.hypot(_dir.x, _dir.z) || 1;
    sim.step(dt, { focusX: fx, focusZ: fz, visible, player: pl, camFX: camera ? _dir.x / dl : 0, camFZ: camera ? _dir.z / dl : 0 });

    // draw
    for (const V of variants) { V.count = 0; V.wheelCount[0] = V.wheelCount[1] = 0; }
    let ns = 0, nl = 0;
    const night = VEHICLE_UNIFORMS.night.value;
    const blink = Math.floor(sim.time * 1.6) % 2 === 0;
    const lit = [];
    cars.length = 0;
    for (const v of sim.vehicles) {
      if (!v.alive) continue;
      cars.push(v);
      if (pl && pushPlayer) collidePlayer(v, entity);
      if (visible && !visible(v.x, v.z, v.half + 1)) continue;
      const list = byType[v.type];
      if (!list) continue;
      const V = v.type === 'cab' ? list[v.paint % 100 < 55 ? 1 : 0] || list[0] : list[0]; // ~55 % of cabs carry a fare
      if (V.count >= V.cap) continue;
      const i = V.count++;
      const dip = Math.max(-0.02, Math.min(0.03, -v.acc * 0.006));
      _e.set(-v.pitch + dip, v.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(v.x, v.y, v.z);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      for (const m of V.meshes) m.setMatrixAt(i, _m);
      if (v.bus) {
        const slot = Math.min(v.blind ?? 0, BLIND_COLS * BLIND_ROWS - 1);
        blindAttr.array[i * 2] = slot % BLIND_COLS;
        blindAttr.array[i * 2 + 1] = blindRows - 1 - Math.floor(slot / BLIND_COLS);
      }
      if (V.body) {
        const col = V.paints[v.paint % V.paints.length];
        const arr = V.body.geometry.attributes.aPaint.array;
        arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b;
      }
      const dist = cam ? Math.hypot(v.x - cam.x, v.z - cam.z) : 0;
      if (V.wheels && dist < WHEEL_DIST) {
        const yawRate = v._lastYaw === undefined ? 0 : Math.atan2(Math.sin(v.yaw - v._lastYaw), Math.cos(v.yaw - v._lastYaw)) / Math.max(dt, 1e-3);
        const steer = Math.max(-0.5, Math.min(0.5, (yawRate * (V.spec.wheelbase || 2.7)) / Math.max(v.speed, 1)));
        for (let side = 0; side < 2; side++) {
          const W = V.wheels[side];
          for (const w of W.places) {
            const k = V.wheelCount[side]++;
            if (k >= W.mesh.instanceMatrix.count) continue;
            _e.set(v.dist / (w.radius || 0.33), w.front ? steer : 0, 0, 'YXZ');
            _q.setFromEuler(_e);
            _p.set(w.x, w.y, w.z);
            _m2.compose(_p, _q, _s);
            _m2.premultiply(_m);
            W.mesh.setMatrixAt(k, _m2);
          }
        }
      }
      v._lastYaw = v.yaw;
      // contact shadow
      if (dist < 160) {
        _p.set(v.x, v.y + 0.03, v.z);
        _e.set(0, v.yaw, 0);
        _q.setFromEuler(_e);
        _s.set(v.halfW * 2 + 0.45, 1, v.len + 0.5);
        _m2.compose(_p, _q, _s);
        shadowInst.setMatrixAt(ns++, _m2);
        _s.set(1, 1, 1);
      }
      // brake lights, indicators
      const sp = V.spec;
      if (dist < 220 && sp.tail) {
        const lamp = (lx, ly, lz, col) => {
          if (nl >= lampInst.instanceMatrix.count) return;
          _p.set(lx, ly, lz);
          _m2.makeTranslation(_p.x, _p.y, _p.z).premultiply(_m);
          lampInst.setMatrixAt(nl, _m2);
          lampInst.setColorAt(nl++, col);
        };
        const zr = (sp.zRear ?? -v.half) - 0.025;
        if (v.braking) { lamp(sp.tail[0], sp.tail[1], zr, BRAKE); lamp(-sp.tail[0], sp.tail[1], zr, BRAKE); }
        if (v.indicator && blink) {
          const sx = v.indicator < 0 ? 1 : -1; // left = +x (facing +z)
          lamp(sx * (sp.tail[0] + 0.05), sp.tail[1] + 0.08, zr, AMBER);
          if (sp.headlight) lamp(sx * (sp.headlight[0] + 0.05), sp.headlight[1], (sp.zFront ?? v.half) + 0.025, AMBER);
        }
      }
      if (night > 0.05 && dist < 80 && sp.headlight) lit.push({ v, dist, sp, m: _m.clone() });
    }
    for (const V of variants) {
      for (const m of V.meshes) {
        m.count = V.count;
        if (V.count) m.instanceMatrix.needsUpdate = true;
      }
      if (V.body && V.count) V.body.geometry.attributes.aPaint.needsUpdate = true;
      if (V === busV && V.count) blindAttr.needsUpdate = true;
      if (V.wheels) for (let side = 0; side < 2; side++) {
        const W = V.wheels[side];
        W.mesh.count = Math.min(V.wheelCount[side], W.mesh.instanceMatrix.count);
        if (W.mesh.count) W.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    shadowInst.count = ns;
    if (ns) shadowInst.instanceMatrix.needsUpdate = true;
    lampInst.count = nl;
    if (nl) { lampInst.instanceMatrix.needsUpdate = true; lampInst.instanceColor.needsUpdate = true; }

    // headlight spots on the nearest vehicles at night
    if (night > 0.05 || lastNight > 0.05) {
      lit.sort((p, q) => p.dist - q.dist);
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i], L = lit[i];
        if (!L || night <= 0.05) { s.intensity = 0; s.position.y = -1000; s.target.position.y = -1001; continue; }
        placeVehicleHeadlight(s, L.sp, 0, L.m);
        s.intensity = (L.v.bus ? HEADLIGHTS.busIntensity : HEADLIGHTS.intensity) * 1.6 * Math.min(1, night);
        s.target.updateMatrixWorld();
      }
    }
    lastNight = night;

    // people
    crowd.update(dt, sim.peds, camera);

    if (sim.time - signalClock > 0.2) { signalClock = sim.time; refreshSignals(); }
    if (network._paint && network._paint.update) network._paint.update(fx, fz);
  }

  function signalStateAt(x, z, maxDist = 30) {
    let best = null, bd = maxDist;
    const cx = Math.floor(x / 40), cz = Math.floor(z / 40);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      for (const h of headGrid.get(gx * 65536 + gz) || []) {
        const d = Math.hypot(h.x - x, h.z - z);
        if (d < bd) { bd = d; best = h; }
      }
    }
    return best ? { head: best, aspect: ASPECT_NAMES[sim.headAspect(best.id)] } : null;
  }

  return {
    group, update, network, sim,
    get vehicles() { return cars.length; },
    cars, // alive vehicles {x, z, yaw, speed, type, route, …} (minimap blips)
    buses: { get length() { return cars.filter((v) => v.bus).length; } },
    peds: sim.peds,
    signalHeads: network.signalHeads,
    signalAspects, // Uint8Array per signal head: 0 red, 1 red+amber, 2 green, 3 amber (refreshed 5×/s)
    /** aspect name ('red' | 'redamber' | 'green' | 'amber') of network.signalHeads[id] */
    signalState: (id) => ASPECT_NAMES[sim.headAspect(id)] || null,
    signalStateAt,
    /**
     * Drive Workstream F's traffic-light lenses from the simulation: city.setSignalPhase(traffic.cityPhaseFn(city.signalHeads)).
     * Each of F's heads ({x, z, heading = travel direction}) is matched to the nearest network head of the same
     * approach; F's codes: 0 red, 1 amber, 2 green, 3 red+amber.
     */
    cityPhaseFn(cityHeads) {
      const TO_F = [0, 3, 2, 1];
      const map = new Int32Array(cityHeads.length).fill(-1);
      cityHeads.forEach((ch, i) => {
        let best = -1, bd = Infinity;
        const cx = Math.floor(ch.x / 40), cz = Math.floor(ch.z / 40);
        for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
          for (const h of headGrid.get(gx * 65536 + gz) || []) {
            // our heading faces the drivers; F's is their travel direction
            const dh = Math.abs(Math.atan2(Math.sin(h.heading + Math.PI - ch.heading), Math.cos(h.heading + Math.PI - ch.heading)));
            const d = Math.hypot(h.x - ch.x, h.z - ch.z) + dh * 12;
            if (d < bd) { bd = d; best = h.id; }
          }
        }
        if (bd < 45) map[i] = best;
      });
      return (i) => {
        const id = map[i];
        return id < 0 ? 0 : TO_F[signalAspects[id]] ?? 0;
      };
    },
    setRain: (on) => sim.setRain(on),
    setTowerBridge: (tb) => sim.setTowerBridge(tb),
    setPlayerPush: (on) => { pushPlayer = !!on; },
    route: (from, to, o) => network.route(from, to, o),
    /** traffic as SPEC colliders within r of (x, z): [{minX,maxX,minZ,maxZ,minY,maxY,obb:{cx,cz,hx,hz,cs,sn}, vehicle}] */
    getDynamicColliders(x = 0, z = 0, r = 60) {
      const out = [];
      for (const v of cars) {
        if (Math.abs(v.x - x) > r || Math.abs(v.z - z) > r) continue;
        const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
        const ex = Math.abs(sn) * v.half + Math.abs(cs) * v.halfW, ez = Math.abs(cs) * v.half + Math.abs(sn) * v.halfW;
        const h = v.bus ? 4.4 : v.type === 'van' ? 2.3 : v.type === 'cab' ? 1.9 : 1.6;
        out.push({ minX: v.x - ex, maxX: v.x + ex, minZ: v.z - ez, maxZ: v.z + ez, minY: v.y, maxY: v.y + h,
          obb: { cx: v.x, cz: v.z, hx: v.halfW, hz: v.half, cs, sn }, vehicle: v });
      }
      return out;
    },
    busPlanner: planner,
    stats: () => ({ vehicles: cars.length, buses: planner.stats, peds: sim.peds.filter((p) => p.alive).length, drawnPeds: crowd.drawn, stepMs: sim.stats.stepMs, ...sim.stats })
  };
}

// London has no NY shore highways: kept as a no-op so main.js's call still works
function createHighwayTraffic() {
  const group = new THREE.Group();
  return { group, update() {}, cars: [], lanes: [] };
}

export { createTrafficSystem, createHighwayTraffic };
