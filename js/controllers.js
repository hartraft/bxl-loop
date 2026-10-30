import * as THREE from 'three/webgpu';
import { WORLD_BOUNDS, toWorld } from './geo-frame.js';
import { cityUniforms, createContactShadowMaterial } from './tsl-materials.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';
import { HEADLIGHTS, SEARCHLIGHT, beamScaleForGlow, createVehicleHeadlight, placeVehicleHeadlight, createSearchlight } from './vehicle-lights.js';
import { blackCab, rideCar, doubleDecker, hireBike, policeHeli, riverBoat, createVehicleUniforms, setVehicleNightFromGlow } from './london-vehicles.js';
import { brusselsBus } from './brussels-bus.js';
const IS_BRUSSELS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels';
const makeBusModel = (opts = {}) => IS_BRUSSELS ? brusselsBus(opts) : doubleDecker(opts);

// js/controllers.js — London Loop player controllers (Workstream C)
// Modes: 'person' (walk), 'car' (black cab), 'ride' (RideLDN car, same physics), 'cyclist' (hire bike),
// 'helicopter' (police heli), 'boat' (Thames river bus), 'bus' (drivable red double-decker, for the bus-driver job).
// Physics runs in fixed-size substeps (<= 1/120 s) whatever the frame rate, so handling is the same at 30-144 fps.
// Ground & water come from an injected world: { groundHeight(x, z, mode, y?), isWater(x, z) } (london-world.js);
// without one a flat fallback world (water band + one bridge) is used — see createFallbackWorld().

export const PLAYER_MODES = ['person', 'car', 'ride', 'cyclist', 'helicopter', 'boat', 'bus'];

/** physics substep (s): update(dt) runs ceil(dt / PHYS_STEP) equal substeps */
export const PHYS_STEP = 1 / 120;

/** HUD/UI info per mode: label, boosted top speed (mph) for the speed meter, keyboard hints */
export const MODE_INFO = {
  person: { label: 'Pedestrian', topSpeedMph: 18, hints: [[['W', 'S'], 'Walk'], [['A', 'D'], 'Turn'], [['Shift'], 'Run'], [['Space'], 'Jump']] },
  car: { label: 'Black Cab', topSpeedMph: 65, hints: [[['W', 'S'], 'Drive / Brake'], [['A', 'D'], 'Steer'], [['Space'], 'Handbrake'], [['Shift'], 'Boost'], [['H'], 'For-hire light']] },
  ride: { label: 'RideLDN', topSpeedMph: 70, hints: [[['W', 'S'], 'Drive / Brake'], [['A', 'D'], 'Steer'], [['Space'], 'Handbrake'], [['Shift'], 'Boost']] },
  cyclist: { label: 'Hire Bike', topSpeedMph: 24, hints: [[['W', 'S'], 'Pedal / Brake'], [['A', 'D'], 'Steer'], [['Shift'], 'Sprint']] },
  helicopter: { label: 'Police Helicopter', topSpeedMph: 145, hints: [[['W', 'S'], 'Pitch'], [['A', 'D'], 'Yaw'], [['Space', 'E'], 'Climb'], [['Q', 'C'], 'Descend'], [['L'], 'Searchlight']] },
  boat: { label: 'River Bus', topSpeedMph: 34, hints: [[['W', 'S'], 'Throttle / Astern'], [['A', 'D'], 'Helm'], [['Shift'], 'Boost']] },
  bus: { label: typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels' ? 'STIB/MIVB Bus' : 'London Bus', topSpeedMph: 34, hints: [[['W', 'S'], 'Drive / Brake'], [['A', 'D'], 'Steer'], [['Space'], 'Parking brake'], [['Shift'], 'Put your foot down']] }
};

/**
 * Handling per vehicle (m, m/s, m/s², s). top/topBoost: cruise/boost top speed; engine: launch acceleration;
 * aLat: lateral grip the steering is limited to (keyboard full lock at speed corners at about this); yawTau: how
 * quickly the body takes up a yaw rate (weight); steerRateLow/High: wheel-lock slew (lock/s) at 0 and 25 m/s;
 * steerReturn: self-centring (lock/s, + 0.12 per m/s); grip / hbGrip: lateral slip decay (1/s) normal / handbrake;
 * pitchGain/rollGain: body pitch (rad per m/s² longitudinal) and roll (rad per m/s² lateral); springW/Zeta: body
 * spring natural frequency (rad/s) and damping ratio; pedalRise/Fall: throttle/brake pedal travel (1/s).
 */
export const HANDLING = {
  car: { top: 20, topBoost: 29, engine: 6.4, boostGain: 1.35, brakeDecel: 9.5, reverseAccel: 4.2, reverseMax: 7, rolling: 0.9, drag: 0.0042,
    aLat: 9.0, yawTau: 0.11, maxSteer: 0.64, steerRateLow: 5.5, steerRateHigh: 3.2, steerReturn: 6, grip: 8.5, hbGrip: 1.3,
    pitchGain: 0.0038, rollGain: 0.0052, springW: 9.5, springZeta: 0.72, pedalRise: 5.5, pedalFall: 9, mass: 1900 },
  ride: { top: 21, topBoost: 31, engine: 6.9, boostGain: 1.35, brakeDecel: 10, reverseAccel: 4.4, reverseMax: 7.5, rolling: 0.9, drag: 0.004,
    aLat: 9.4, yawTau: 0.1, maxSteer: 0.56, steerRateLow: 5.8, steerRateHigh: 3.4, steerReturn: 6.2, grip: 9, hbGrip: 1.3,
    pitchGain: 0.0034, rollGain: 0.0048, springW: 10.5, springZeta: 0.74, pedalRise: 6, pedalFall: 9, mass: 1600 },
  bus: { top: 12.5, topBoost: 14.5, engine: 1.9, boostGain: 1.15, brakeDecel: 5.2, reverseAccel: 1.4, reverseMax: 3.2, rolling: 0.55, drag: 0.004,
    aLat: 3.8, yawTau: 0.26, maxSteer: 0.52, steerRateLow: 2.0, steerRateHigh: 1.05, steerReturn: 2.6, grip: 6, hbGrip: 6,
    pitchGain: 0.0065, rollGain: 0.011, springW: 5.2, springZeta: 0.55, pedalRise: 2.6, pedalFall: 5, mass: 12500 }
};

const slew = (v, target, up, down) => (target > v ? Math.min(target, v + up) : Math.max(target, v - down));

/** Westminster Pier (Thames) — default boat spawn */
const BOAT_SPAWN_LATLON = [51.50165, -0.12325];

function isTypingInField(e) {
  const t = e && e.target;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
}

/**
 * A flat test world: ground 0, a river band waterZ0 < z < waterZ1 (water level -1.2), and one bridge
 * (|x| < bridgeHalf) whose deck ramps up to deckY over `ramp` metres on each bank.
 */
export function createFallbackWorld({ waterZ0 = 60, waterZ1 = 160, bridgeHalf = 7, deckY = 8, ramp = 40, waterLevel = -1.2 } = {}) {
  const isWater = (x, z) => z > waterZ0 && z < waterZ1;
  const deck = (x, z) => {
    if (Math.abs(x) > bridgeHalf || z < waterZ0 - ramp || z > waterZ1 + ramp) return 0;
    if (z < waterZ0) return deckY * (z - (waterZ0 - ramp)) / ramp;
    if (z > waterZ1) return deckY * ((waterZ1 + ramp) - z) / ramp;
    return deckY;
  };
  return {
    fallback: true,
    waterLevel,
    bridge: { bridgeHalf, deckY, ramp, waterZ0, waterZ1 },
    isWater,
    groundHeight(x, z, mode = 'person', y = undefined) {
      if (mode === 'boat') return isWater(x, z) ? waterLevel : 0;
      const d = deck(x, z);
      // under the deck (y well below it) the ground is the river bank/water, not the deck
      if (d > 0 && !(y !== undefined && y < d - 2.5)) return d;
      return isWater(x, z) ? waterLevel : 0;
    }
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v) => (v === true ? 1 : +v || 0);

// (the fallback keeps the class loadable by unit tests that stub three.js with an empty namespace)
class ThirdPersonControllerManager extends (THREE.EventDispatcher || Object) {
  /**
   * @param scene THREE.Scene
   * @param colliders [{minX,maxX,minZ,maxZ,maxY,minY?,obb?}]
   * @param options { world, bounds = WORLD_BOUNDS, mode = 'car', spawn: {x,z,heading} (ground spawn for car/ride/
   *   cyclist/person), spawns: { [mode]: {x, z, heading, y?} } per-mode overrides }
   */
  constructor(scene, colliders = [], options = {}) {
    super();
    this.scene = scene;
    this._collisionListeners = new Set();
    this.colliders = colliders;
    this.world = options.world || createFallbackWorld();
    this.bounds = options.bounds || WORLD_BOUNDS;
    this._colliderCells = null;
    this.activeMode = PLAYER_MODES.includes(options.mode) ? options.mode : 'car';
    this.taxiForHire = true;
    this.searchlightOn = null; // null = automatic (on at night)
    this.surfaceHeight = options.surfaceHeight || null; // optional (x, z) => pavement/kerb top (city.surfaceHeight)
    this._pendingHits = new Map();
    this._stepping = false;

    this.keys = { forward: false, backward: false, left: false, right: false, up: false, down: false, boost: false };

    this.entities = {
      person: this.createPersonEntity(),
      car: this.createCarEntity('car', blackCab({ uniforms: createVehicleUniforms() }), MODE_INFO.car.label, HANDLING.car),
      ride: this.createCarEntity('ride', rideCar({ uniforms: createVehicleUniforms() }), MODE_INFO.ride.label, HANDLING.ride),
      cyclist: this.createCyclistEntity(),
      helicopter: this.createHelicopterEntity(),
      boat: this.createBoatEntity(),
      bus: this.createBusEntity()
    };
    this.entities.ride.uniforms.sign.value = 0;

    for (const ent of Object.values(this.entities)) {
      ent.mesh.traverse((child) => {
        if (child.isMesh && !child.material?.isMeshBasicNodeMaterial && !child.material?.transparent) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }

    this.bindKeyboard();
    this.placeSpawns(options.spawn, options.spawns || {});
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------------------------
  bindKeyboard() {
    const bindings = {
      forward: ['KeyW', 'ArrowUp'],
      backward: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      up: ['Space', 'KeyE'],
      down: ['KeyQ', 'KeyC'],
      boost: ['ShiftLeft', 'ShiftRight']
    };
    const actionsByCode = new Map(Object.entries(bindings).flatMap(([action, codes]) => codes.map((code) => [code, action])));
    this._pressedCodes = new Set();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};

    const onKey = (e, isDown) => {
      if (isDown && !e.repeat && !isTypingInField(e)) {
        if (e.code === 'KeyH' && this.activeMode === 'car') this.setTaxiForHire(!this.taxiForHire);
        if (e.code === 'KeyL' && this.activeMode === 'helicopter') this.toggleSearchlight();
      }
      const action = actionsByCode.get(e.code);
      if (!action || (isDown && isTypingInField(e))) return;
      if (isDown) this._pressedCodes.add(e.code);
      else this._pressedCodes.delete(e.code);
      // Releasing one binding must not cancel another key held for the same action.
      this._keyboardKeys[action] = bindings[action].some((code) => this._pressedCodes.has(code));
      this._blendInput(action);
    };

    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
  }

  _blendInput(action) {
    const keyboard = this._keyboardKeys[action] || false;
    const touch = this._touchKeys[action] || false;
    const gamepad = this._gamepadKeys[action] || false;
    const strength = Math.max(keyboard, touch, gamepad);
    // Preserve digital button values while allowing either analog source to be strongest.
    this.keys[action] = keyboard === true || touch === true || gamepad === true ? true : strength || false;
  }

  _setAnalogInput(source, action, value) {
    if (!Object.hasOwn(this.keys, action)) return;
    const strength = Number(value);
    source[action] = typeof value === 'boolean' ? value : Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
    this._blendInput(action);
  }

  setTouchInput(action, value) {
    this._setAnalogInput(this._touchKeys, action, value);
  }

  setGamepadInput(action, value) {
    this._setAnalogInput(this._gamepadKeys, action, value);
  }

  clearTouchInput() {
    this._touchKeys = {};
    for (const action of Object.keys(this.keys)) this._blendInput(action);
  }

  clearGamepadInput() {
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys)) this._blendInput(action);
  }

  resetInput() {
    this._pressedCodes?.clear();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys)) this.keys[action] = false;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Modes, world, teleports
  // -------------------------------------------------------------------------------------------------------------
  /** Switch mode. opts.placeNear: move the new mode's entity next to where the current one is (e.g. hop in a car) */
  setMode(mode, opts = {}) {
    if (!this.entities[mode]) return;
    const prev = this.getActiveEntity();
    this.activeMode = mode;
    if (opts.placeNear && prev && prev !== this.entities[mode]) {
      const ent = this.entities[mode];
      const side = mode === 'helicopter' ? 0 : mode === 'bus' || prev.mode === 'bus' ? 4.6 : 3.5;
      const x = prev.position.x + Math.cos(prev.heading) * side;
      const z = prev.position.z - Math.sin(prev.heading) * side;
      this.teleportActiveTo(x, z, prev.heading);
      if (mode === 'helicopter') ent.position.y = Math.max(ent.position.y, prev.position.y + 40);
    }
  }

  getActiveEntity() {
    return this.entities[this.activeMode];
  }

  setWorld(world) {
    this.world = world || createFallbackWorld();
  }

  setColliders(colliders) {
    this.colliders = colliders || [];
    this._colliderCells = null;
  }

  /** Optional walking/kerb surface (x, z) => height or null — pass city.surfaceHeight. Pedestrians and the bike step
   *  up onto pavements; cars' wheels ride up the 12 cm kerb visually (the body stays sprung, no jolt). */
  setSurfaceHeight(fn) {
    this.surfaceHeight = typeof fn === 'function' ? fn : null;
  }

  /** Called by the camera system: true while the POV (first-person) camera is active, so the bus can show its cab */
  setPovView(on) {
    on = !!on;
    if (on === this._povView) return;
    this._povView = on;
    this._applyBusPov();
  }

  setTaxiForHire(on) {
    this.taxiForHire = !!on;
    this.entities.car.uniforms.sign.value = this.taxiForHire ? 1 : 0;
  }

  toggleSearchlight() {
    const cur = this.searchlightOn === null ? VEHICLE_NIGHT() > 0.3 : this.searchlightOn;
    this.searchlightOn = !cur;
  }

  /** World-space cockpit eye position of the active entity (driver on the right in cars), for a POV camera */
  getPovPosition(target = new THREE.Vector3()) {
    const e = this.getActiveEntity();
    const o = e.povOffset;
    const s = Math.sin(e.heading), c = Math.cos(e.heading);
    return target.set(e.position.x + o.x * c + o.z * s, e.position.y + o.y, e.position.z - o.x * s + o.z * c);
  }

  getGroundHeight(x, z, mode = 'person', y = undefined) {
    let h = this.world.groundHeight(x, z, mode, y);
    if (!Number.isFinite(h)) h = 0;
    if (this.surfaceHeight && (mode === 'person' || mode === 'cyclist')) h = Math.max(h, this._kerbTop(x, z, h));
    return h;
  }

  /** pavement top at (x, z) if it is a small step (kerb) above `base`, else base */
  _kerbTop(x, z, base) {
    const s = this.surfaceHeight ? this.surfaceHeight(x, z) : null;
    return Number.isFinite(s) && s > base && s - base < 0.4 ? s : base;
  }

  isWater(x, z) {
    return !!this.world.isWater(x, z);
  }

  placeSpawns(spawn, spawns) {
    let base = spawn || { x: 0, z: 40, heading: 0 };
    let heading = base.heading ?? 0;
    // snap the default spawn onto the nearest road, aligned with it, when the world can tell us
    if (!spawn && this.world.nearestRoad) {
      const r = this.world.nearestRoad(base.x, base.z, { kinds: ['primary', 'secondary', 'trunk', 'tertiary'] });
      if (r && Number.isFinite(r.x)) {
        base = { x: r.x, z: r.z };
        if (Number.isFinite(r.heading)) heading = r.heading;
      }
    }
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const rx = Math.cos(heading), rz = -Math.sin(heading); // +x side (nearside/left)
    const defaults = {
      car: { x: base.x + rx * 1.8, z: base.z + rz * 1.8, heading },
      ride: { x: base.x + rx * 1.8 - fx * 9, z: base.z + rz * 1.8 - fz * 9, heading },
      cyclist: { x: base.x + rx * 3.2 + fx * 9, z: base.z + rz * 3.2 + fz * 9, heading },
      person: { x: base.x + rx * 7, z: base.z + rz * 7, heading },
      helicopter: { x: base.x, z: base.z - 60, heading, y: 110 },
      boat: { ...toWorld(...BOAT_SPAWN_LATLON), heading: Math.PI * 0.5 },
      bus: { x: base.x + rx * 1.8 - fx * 24, z: base.z + rz * 1.8 - fz * 24, heading }
    };
    const prevMode = this.activeMode;
    // park everything far away first so entities not yet placed don't block the others' spawn points
    for (const ent of Object.values(this.entities)) ent.position.set(1e7, ent.position.y, 1e7);
    for (const mode of PLAYER_MODES) {
      const s = { ...defaults[mode], ...(spawns[mode] || {}) };
      const ent = this.entities[mode];
      this.activeMode = mode;
      if (mode === 'helicopter') ent.position.y = s.y ?? 110;
      let p = this.findClearPosition(mode, s.x, s.z, s.heading, ent.position.y);
      if (!p && mode === 'boat') p = this.findWaterNear(s.x, s.z, s.heading, 700);
      if (!p) p = { x: s.x, z: s.z };
      ent.position.x = p.x;
      ent.position.z = p.z;
      ent.heading = s.heading;
      if (mode !== 'helicopter') ent.position.y = s.y ?? this.getGroundHeight(p.x, p.z, mode);
      this.resetEntityState(ent);
    }
    this.activeMode = prevMode;
  }

  teleportActiveTo(x, z, heading = Math.PI) {
    const ent = this.getActiveEntity();
    this.resetInput();
    if (!Number.isFinite(heading)) heading = ent.heading;
    const heli = this.activeMode === 'helicopter';
    const altitude = heli ? Math.max(92, Math.min(380, ent.position.y)) : 0;
    let destination = this.findClearPosition(this.activeMode, x, z, heading, altitude);
    if (!destination && this.activeMode === 'boat') destination = this.findWaterNear(x, z, heading, 900);
    if (destination) {
      ent.position.x = destination.x;
      ent.position.z = destination.z;
      ent.heading = heading;
      ent.position.y = heli ? altitude : this.getGroundHeight(destination.x, destination.z, this.activeMode);
    }
    this.resetEntityState(ent);
    return { x: ent.position.x, z: ent.position.z };
  }

  resetEntityState(ent) {
    ent.speed = 0;
    ent.vx = ent.vz = 0;
    ent.vy = 0;
    if (ent.type === 'person') {
      ent.verticalVel = 0;
      ent.rig.reset(ent.position.x, ent.position.z, ent.heading, personGround, this);
      ent.crowd.begin();
      ent.crowd.add(ent.rig, 0);
      ent.crowd.end();
    } else if (ent.type === 'car') {
      ent.angularVel = ent.steerAngle = ent.steerCmd = ent.yawRate = 0;
      ent.pitchVel = ent.rollVel = ent.heaveY = ent.heaveVel = 0;
      ent.pedalF = ent.pedalB = ent.longAcc = 0;
      ent.vmaxNow = ent.top;
      ent.gripNow = ent.grip;
      ent.slopePitch = 0;
      ent.chassisPivot.rotation.x = ent.chassisPivot.rotation.z = 0;
      ent.chassisPivot.position.y = 0;
      ent.lastCollisionSpark = null;
      ent.kerb.fill(0);
      for (const wheel of ent.wheels) {
        if (wheel.front) wheel.group.rotation.y = 0;
        wheel.group.position.y = wheel.baseY;
      }
      if (ent.uniforms) ent.uniforms.brake.value = 1;
    } else if (ent.type === 'cyclist') {
      ent.leanAngle = ent.leanPivot.rotation.z = 0;
    } else if (ent.type === 'helicopter') {
      ent.verticalSpeed = ent.pitchAngle = ent.rollAngle = 0;
      ent.tiltPivot.rotation.x = ent.tiltPivot.rotation.z = 0;
      ent.tiltPivot.position.y = 0;
    } else if (ent.type === 'boat') {
      ent.angularVel = 0;
      ent.pitch = ent.roll = 0;
    }
    ent.mesh.position.copy(ent.position);
    ent.mesh.rotation.y = ent.heading;
  }

  /** Make the smoothed driver inputs agree with a speed set from outside (tests, scripted placement) */
  _resetSmoothing(ent, speed = ent.speed) {
    if (ent.type !== 'car') return;
    ent.pedalF = speed > 0.5 ? 1 : 0;
    ent.vmaxNow = Math.max(ent.top, speed);
  }

  /** Footprint sample points (world) of an entity of `mode` at x,z,heading — centre, corners, mid-sides */
  footprint(mode, x, z, heading, shrink = 0.9) {
    const ent = this.entities[mode];
    const { hx, hz } = ent.halfExtents;
    const s = Math.sin(heading), c = Math.cos(heading);
    const pts = [[0, 0], [hx, hz], [-hx, hz], [hx, -hz], [-hx, -hz], [0, hz], [0, -hz]];
    if (mode === 'boat') pts.push([hx, 0], [-hx, 0]);
    return pts.map(([lx, lz]) => [x + (lx * c + lz * s) * shrink, z + (-lx * s + lz * c) * shrink]);
  }

  /** True if this placement is illegal w.r.t. water: boats need water everywhere, the rest dry land or a deck */
  waterBlocked(mode, x, z, heading, y = undefined) {
    return this.waterBlockedCount(mode, x, z, heading, y, true) > 0;
  }

  /** How many footprint sample points are illegal (wet for land modes, dry for the boat); `any`: stop at the first */
  waterBlockedCount(mode, x, z, heading, y = undefined, any = false) {
    if (mode === 'helicopter') return 0;
    const pts = this.footprint(mode, x, z, heading);
    let n = 0;
    for (const [px, pz] of pts) {
      const bad = mode === 'boat' ? !this.isWater(px, pz)
        : this.isWater(px, pz) && !(this.getGroundHeight(px, pz, mode, y) > this.waterDeckThreshold()) &&
          !(this.world.onBridge && this.world.onBridge(px, pz));
      if (bad && (++n, any)) return n;
    }
    return n;
  }

  waterDeckThreshold() {
    const wl = this.world.waterLevel ?? -1.2;
    return Math.max(0.3, wl + 1.0);
  }

  /**
   * The edge of the play area (roads keep going visually into the filler city): instead of a hard invisible wall,
   * brake the part of the velocity heading out of the map so the vehicle rolls to a stop ~3 m before the edge, and
   * tell the UI once per approach (EventDispatcher 'edge' with {x, z}). Velocity along the edge is untouched.
   */
  _edgeBrake(c, s2, c2) {
    const b = this.bounds;
    if (!b || !Number.isFinite(b.minX)) return;
    const inset = 2, stopGap = 3, decel = 7;
    let Vx = s2 * c.speed + c.vx, Vz = c2 * c.speed + c.vz;
    const p = c.position;
    const edges = [
      [-1, 0, p.x - (b.minX + inset)], [1, 0, (b.maxX - inset) - p.x],
      [0, -1, p.z - (b.minZ + inset)], [0, 1, (b.maxZ - inset) - p.z]
    ];
    let limited = false;
    for (const [nx, nz, dist] of edges) {
      if (dist > 60) continue;
      const vn = Vx * nx + Vz * nz; // outward speed
      if (vn <= 0) continue;
      const vAllowed = Math.sqrt(2 * decel * Math.max(0, dist - stopGap));
      if (vn > vAllowed) {
        const cut = vn - vAllowed;
        Vx -= nx * cut; Vz -= nz * cut;
        limited = true;
      }
    }
    if (!limited) return;
    c.speed = Vx * s2 + Vz * c2;
    const lat = Vx * c2 - Vz * s2;
    c.vx = lat * c2;
    c.vz = -lat * s2;
    const now = performance.now();
    if (!this._edgeToldAt || now - this._edgeToldAt > 4000) {
      this._edgeToldAt = now;
      this.dispatchEvent({ type: 'edge', x: p.x, z: p.z });
    }
  }

  _clampBounds(pos, mode) {
    const b = this.bounds;
    const m = mode === 'helicopter' ? 2000 : 0;
    const inset = mode === 'helicopter' ? 0 : 2;
    pos.x = clamp(pos.x, b.minX - m + inset, b.maxX + m - inset);
    pos.z = clamp(pos.z, b.minZ - m + inset, b.maxZ + m - inset);
  }

  findWaterNear(x, z, heading, maxR = 600) {
    for (let r = 0; r <= maxR; r += 10) {
      const n = r === 0 ? 1 : Math.max(8, Math.round((Math.PI * 2 * r) / 20));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!this.isWater(px, pz)) continue;
        const p = this.findClearPosition('boat', px, pz, heading, 0, 2);
        if (p) return p;
      }
    }
    return null;
  }

  // Find a fully clear arrival before moving the player. Sequential collision pushes can leave a player trapped
  // between overlapping buildings, so test whole candidate footprints instead; null if none fits.
  findClearPosition(mode, x, z, heading, altitude, maxRing = 64) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const heli = mode === 'helicopter';
    const entity = this.entities[mode];
    const { hx, hz } = entity.halfExtents;
    const sinH = Math.sin(heading), cosH = Math.cos(heading);
    const extX = Math.abs(cosH) * hx + Math.abs(sinH) * hz + 0.1;
    const extZ = Math.abs(sinH) * hx + Math.abs(cosH) * hz + 0.1;
    const reach = Math.max(extX, extZ);
    const others = Object.values(this.entities).filter((e) => e !== entity).map((e) => ({
      x: e.position.x, z: e.position.z, radius: Math.hypot(e.halfExtents.hx, e.halfExtents.hz) * 0.8,
      bottom: e.position.y - (e.type === 'helicopter' ? 0.7 : e.type === 'boat' ? 1.2 : 0), top: e.position.y + e.bodyHeight
    }));
    const myRadius = Math.max(Math.min(hx, hz), 0.5);
    const cameraBack = Math.cos(0.09) * entity.chaseDistance;
    const cameraUp = entity.chaseHeight + Math.sin(0.09) * entity.chaseDistance * 0.85;
    const clampPoint = (px, pz) => {
      const p = { x: px, z: pz };
      this._clampBounds(p, mode);
      return p;
    };
    const clear = (p) => {
      if (!p) return false;
      if (this.waterBlocked(mode, p.x, p.z, heading, heli ? altitude : undefined)) return false;
      const baseY = heli ? altitude : this.getGroundHeight(p.x, p.z, mode);
      const y = heli ? altitude : baseY + 1;
      const viewTop = baseY + Math.max(entity.bodyHeight, cameraUp);
      for (const other of others) {
        if (other.bottom > viewTop + 0.3 || other.top < baseY - 1) continue;
        const dx = other.x - p.x, dz = other.z - p.z;
        const back = Math.max(0, Math.min(cameraBack, -dx * sinH - dz * cosH));
        if (Math.hypot(dx + sinH * back, dz + cosH * back) < other.radius + myRadius + 0.1) return false;
      }
      for (const c of this.nearColliders(p.x, p.z, reach)) {
        if (y > c.maxY + 1.5) continue;
        if (c.minY !== undefined && y + entity.bodyHeight < c.minY) continue;
        if (p.x + extX <= c.minX || p.x - extX >= c.maxX || p.z + extZ <= c.minZ || p.z - extZ >= c.maxZ) continue;
        if (c.obb) {
          const o = c.obb, dx = p.x - o.cx, dz = p.z - o.cz;
          const ls = sinH * o.cs - cosH * o.sn, lc = sinH * o.sn + cosH * o.cs;
          const ex = Math.abs(lc) * hx + Math.abs(ls) * hz + 0.1;
          const ez = Math.abs(ls) * hx + Math.abs(lc) * hz + 0.1;
          if (Math.abs(dx * o.cs - dz * o.sn) >= o.hx + ex || Math.abs(dx * o.sn + dz * o.cs) >= o.hz + ez) continue;
        }
        return false;
      }
      return true;
    };
    const origin = clampPoint(x, z);
    if (clear(origin)) return origin;
    // Four-metre rings cover nearby streets and courtyards, with bounded work even for a click inside a large block.
    for (let ring = 1; ring <= maxRing; ring++) {
      const distance = ring * 4;
      for (let i = 0; i < 32; i++) {
        const angle = (i * Math.PI) / 16;
        const p = clampPoint(origin.x + Math.cos(angle) * distance, origin.z + Math.sin(angle) * distance);
        if (clear(p)) return p;
      }
    }
    return null;
  }

  // Back-compat with the NY name (uses the active mode)
  findTeleportPosition(x, z, heading, altitude) {
    return this.findClearPosition(this.activeMode, x, z, heading, altitude);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Entities
  // -------------------------------------------------------------------------------------------------------------
  _contactShadow(root, w, l, y = 0.02) {
    const g = new THREE.PlaneGeometry(w, l);
    g.rotateX(-Math.PI * 0.5);
    const m = new THREE.Mesh(g, createContactShadowMaterial());
    m.position.y = y;
    m.renderOrder = 998;
    root.add(m);
    return m;
  }

  createPersonEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerPerson';
    const crowd = new PersonCrowd(1, { farDistance: Infinity });
    crowd.meshes.forEach((m) => this.scene.add(m));
    const rig = new PersonRig({ seed: 4.2, scale: 1.0, girth: 1.02, hair: 0.18, armSwing: 1.0 });
    this._contactShadow(root, 0.95, 0.95);
    this.scene.add(root);
    return {
      type: 'person', mode: 'person', label: MODE_INFO.person.label,
      mesh: root, crowd, rig,
      position: new THREE.Vector3(0, 0, 0), heading: 0, speed: 0, vx: 0, vz: 0, verticalVel: 0,
      halfExtents: { hx: 0.4, hz: 0.4 }, bodyHeight: 1.9, collisionRadius: 0.42,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0), chaseDistance: 4.3, chaseHeight: 1.95,
      povOffset: new THREE.Vector3(0, 1.66, 0.12)
    };
  }

  /** Black cab / RideLDN car: the model's body rides on a sprung chassis pivot, its wheels on the root */
  createCarEntity(mode, model, label, tune = {}) {
    const root = new THREE.Group();
    root.name = mode === 'car' ? 'PlayerBlackCab' : 'PlayerRideCar';
    root.rotation.order = 'YXZ';
    const chassisPivot = new THREE.Group();
    root.add(chassisPivot);
    const spec = model.userData.spec;
    const wheels = model.userData.wheels;
    for (const w of wheels) root.add(w.group); // the wheels stay planted while the body pitches & rolls
    chassisPivot.add(model);
    this._contactShadow(root, spec.width + 0.3, spec.length + 0.25);
    const headLights = [];
    for (const side of [-1, 1]) {
      const spot = createVehicleHeadlight();
      placeVehicleHeadlight(spot, spec, side);
      chassisPivot.add(spot, spot.target);
      headLights.push(spot);
    }
    this.scene.add(root);
    for (const w of wheels) w.baseY = w.group.position.y;
    const track = wheels.length ? Math.max(...wheels.map((w) => Math.abs(w.x))) * 2 : spec.width;
    return {
      type: 'car', mode, label, mesh: root, model, chassisPivot, spec, wheels, headLights,
      uniforms: model.userData.uniforms,
      position: new THREE.Vector3(), heading: 0, speed: 0, vx: 0, vz: 0, vy: 0,
      angularVel: 0, yawRate: 0, pitchVel: 0, rollVel: 0, heaveY: 0, heaveVel: 0, slopePitch: 0,
      lastCollisionSpark: null, steerAngle: 0, steerCmd: 0, wheelSpin: 0,
      pedalF: 0, pedalB: 0, longAcc: 0, vmaxNow: tune.top ?? 20, gripNow: tune.grip ?? 8.5,
      kerb: new Float32Array(4), track,
      halfExtents: { ...spec.halfExtents }, bodyHeight: spec.height, wheelbase: spec.wheelbase,
      ...HANDLING.car, maxSteer: spec.maxSteer ?? 0.58, ...tune,
      cameraTargetOffset: new THREE.Vector3(0, 0.96, 0), chaseDistance: 7.2, chaseHeight: 2.3,
      povOffset: new THREE.Vector3(spec.povOffset.x, spec.povOffset.y, spec.povOffset.z)
    };
  }

  /** Drivable red double-decker (bus-driver job): car physics with bus handling, nearside doors, cab POV */
  createBusEntity() {
    const model = makeBusModel({ route: IS_BRUSSELS ? '71' : '24', destination: IS_BRUSSELS ? 'De Brouckère' : 'Pimlico', uniforms: createVehicleUniforms() });
    const ent = this.createCarEntity('bus', model, MODE_INFO.bus.label, HANDLING.bus);
    ent.mesh.name = 'PlayerBus';
    ent.isBus = true;
    ent.route = IS_BRUSSELS ? '71' : '24';
    ent.destination = IS_BRUSSELS ? 'De Brouckère' : 'Pimlico';
    ent.doorsOpen = false;
    ent.doorInterlock = true; // won't pull away with the doors open
    ent.doorOpen = 0; // 0..1 door animation
    ent.kneel = 0; // 0..1 nearside kneel (doors open at a stop)
    ent.cameraTargetOffset.set(0, 2.4, 0);
    ent.chaseDistance = 14.5;
    ent.chaseHeight = 5.2;
    ent.povOffset.set(ent.spec.povOffset.x, 1.9, ent.spec.povOffset.z - 0.15); // seated eye in the offside cab
    for (const s of ent.headLights) { s.distance = 60; }
    // door apertures (open = dark doorway with the leaves folded back), on the nearside (+x)
    const doorMat = new THREE.MeshStandardNodeMaterial({ color: 0x0b0b0c, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a3138, roughness: 0.15, metalness: 0.5 });
    ent.doors = [];
    for (const key of ['front', 'middle']) {
      const d = ent.spec.doors && ent.spec.doors[key];
      if (!d) continue;
      const len = d.z1 - d.z0;
      const g = new THREE.Group();
      g.position.set(ent.spec.width / 2 + 0.012, 1.32, (d.z0 + d.z1) / 2);
      const hole = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.0, len - 0.06), doorMat);
      g.add(hole);
      const leaves = [];
      for (const side of [-1, 1]) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.86, len / 2 - 0.05), leafMat);
        leaf.position.set(0.06, 0.02, side * (len / 4));
        g.add(leaf);
        leaves.push({ mesh: leaf, side, len });
      }
      g.visible = false;
      ent.chassisPivot.add(g);
      ent.doors.push({ group: g, leaves });
    }
    ent.cab = this._buildBusCab(ent.spec);
    ent.cab.visible = false;
    ent.chassisPivot.add(ent.cab);
    return ent;
  }

  /** A simple driver's cab (dash, wheel, pillars, partition) shown instead of the bus shell in the POV camera */
  _buildBusCab(spec) {
    const cab = new THREE.Group();
    cab.name = 'BusCab';
    const m = (color, rough = 0.7, metal = 0) => new THREE.MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal });
    const dark = m(0x1d1f22, 0.8), trim = m(0x3a3d42, 0.6), red = m(0xb3102a, 0.45, 0.1), yellow = m(0xe8b400, 0.5);
    const box = (w, h, d, x, y, z, mat, rx = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(x, y, z);
      b.rotation.x = rx;
      cab.add(b);
      return b;
    };
    const zf = (spec.zFront ?? 5.6) - 0.06, hw = spec.width / 2 - 0.05;
    // dashboard across the front, deeper on the driver's (offside, -x) side
    box(spec.width - 0.12, 0.34, 0.5, 0, 0.98, zf - 0.28, dark);
    box(0.9, 0.22, 0.5, -0.62, 1.2, zf - 0.55, trim, -0.35);
    // windscreen frame: sill, header, centre & corner pillars; upper-deck floor band
    box(spec.width - 0.1, 0.1, 0.08, 0, 0.93, zf, red);
    box(spec.width - 0.1, 0.28, 0.12, 0, 2.48, zf - 0.02, red);
    box(0.05, 1.5, 0.05, 0, 1.68, zf, dark);
    for (const s of [-1, 1]) {
      box(0.07, 1.6, 0.1, s * hw, 1.68, zf - 0.05, red);
      box(0.08, 0.1, 2.2, s * hw, 1.0, zf - 1.15, red); // side window sills & top rails
      box(0.08, 0.3, 2.2, s * hw, 2.45, zf - 1.15, red);
      box(0.06, 1.5, 0.08, s * hw, 1.7, zf - 2.2, dark); // B-pillar
    }
    box(spec.width - 0.1, 0.06, 2.0, 0, 2.62, zf - 1.0, trim); // ceiling
    // cab partition behind the driver, ticket machine, grab pole
    box(0.05, 1.4, 1.2, -0.12, 1.65, zf - 1.55, trim);
    box(0.28, 0.32, 0.22, 0.05, 1.32, zf - 1.1, dark);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 8), yellow);
    pole.position.set(0.55, 1.85, zf - 1.3);
    cab.add(pole);
    // steering wheel (turns with the steering)
    const pov = spec.povOffset || { x: -0.7, y: 2.2, z: 4.9 };
    const wheelPivot = new THREE.Group();
    wheelPivot.position.set(pov.x, 1.34, pov.z + 0.4);
    wheelPivot.rotation.x = -1.0;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 8, 28), dark);
    wheelPivot.add(rim);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.035, 0.02), dark);
    wheelPivot.add(spoke);
    cab.add(wheelPivot);
    cab.userData.wheel = wheelPivot;
    cab.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    return cab;
  }

  _applyBusPov() {
    const bus = this.entities && this.entities.bus;
    if (!bus) return;
    const inCab = !!this._povView && this.activeMode === 'bus';
    bus.cab.visible = inCab;
    for (const ch of bus.model.children) if (ch.isMesh) ch.visible = !inCab; // shell, decals & blinds (wheels stay)
  }

  /** Bus-driver job API: change the destination blind (route number + destination) of the drivable bus */
  setBusLivery({ route, destination } = {}) {
    const bus = this.entities.bus;
    route = route == null ? bus.route : String(route);
    destination = destination == null ? bus.destination : String(destination);
    if (route === bus.route && destination === bus.destination) return;
    const tmp = makeBusModel({ route, destination, uniforms: bus.uniforms });
    const fresh = tmp.getObjectByName('blinds');
    const old = bus.model.getObjectByName('blinds');
    if (fresh && old) {
      old.geometry.dispose();
      old.geometry = fresh.geometry;
      old.material = fresh.material; // shared per blind texture (london-vehicles caches materials)
    }
    tmp.traverse((o) => { if (o.isMesh && o !== fresh && o.name !== 'spin') o.geometry.dispose(); });
    bus.route = route;
    bus.destination = destination;
    bus.model.name = `Bus_${route}`;
  }

  /** Bus-driver job API: open/close the nearside doors (animated; the bus kneels at rest and won't drive off open) */
  setBusDoors(open) {
    this.entities.bus.doorsOpen = !!open;
  }

  _animateBus(dt) {
    const b = this.entities.bus;
    const target = b.doorsOpen ? 1 : 0;
    b.doorOpen = slew(b.doorOpen, target, dt / 0.9, dt / 0.9);
    const atRest = Math.abs(b.speed) < 0.5;
    b.kneel = slew(b.kneel, b.doorsOpen && atRest ? 1 : 0, dt / 1.2, dt / 0.8);
    const o = b.doorOpen;
    for (const d of b.doors) {
      d.group.visible = o > 0.01 && !(this._povView && this.activeMode === 'bus');
      const ease = o * o * (3 - 2 * o);
      for (const l of d.leaves) {
        // plug doors: swing out a little, then slide apart towards the ends of the aperture
        l.mesh.position.x = 0.06 + Math.min(1, ease * 2) * 0.1;
        l.mesh.position.z = l.side * (l.len / 4 + ease * (l.len / 2 - 0.08));
        l.mesh.scale.z = 1 - ease * 0.55;
      }
    }
    if (b.cab.userData.wheel) b.cab.userData.wheel.rotation.z = -b.steerCmd * 2.2;
  }

  createCyclistEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerHireBike';
    const leanPivot = new THREE.Group();
    root.add(leanPivot);
    const model = hireBike();
    leanPivot.add(model);
    const spec = model.userData.spec;
    const bf = spec.bikeFrame;
    const bikeFrame = {
      seat: new THREE.Vector3(bf.seat.x, bf.seat.y, bf.seat.z),
      bars: new THREE.Vector3(bf.bars.x, bf.bars.y, bf.bars.z),
      gripHalf: bf.gripHalf,
      bracket: new THREE.Vector3(bf.bracket.x, bf.bracket.y, bf.bracket.z),
      crankLength: bf.crankLength
    };
    const riderCrowd = new PersonCrowd(1, { farDistance: Infinity });
    riderCrowd.meshes.forEach((m) => this.scene.add(m));
    const riderRig = new PersonRig({ seed: 12.8, scale: 1.0, girth: 0.97, hair: 0.3 });
    this._contactShadow(root, 0.85, 2.25);
    const headLight = new THREE.SpotLight(0xf2f7ff, 0, 22, 0.36, 0.76, 1.6);
    headLight.position.set(0, spec.headlight[1], spec.zFront);
    headLight.target.position.set(0, 0, 8);
    leanPivot.add(headLight, headLight.target);
    this.scene.add(root);
    const wheels = model.userData.wheels;
    return {
      type: 'cyclist', mode: 'cyclist', label: MODE_INFO.cyclist.label,
      mesh: root, model, leanPivot, wheels, frontWheel: wheels[0].spin, rearWheel: wheels[1].spin,
      crankPivot: model.userData.cranks, bikeFrame, riderCrowd, riderRig, headLight, spec,
      position: new THREE.Vector3(), heading: 0, speed: 0, vx: 0, vz: 0, vy: 0, leanAngle: 0, pedalPhase: 0, steer: 0,
      halfExtents: { hx: 0.35, hz: 0.9 }, bodyHeight: 1.9,
      cameraTargetOffset: new THREE.Vector3(0, 1.35, 0), chaseDistance: 4.8, chaseHeight: 2.05,
      povOffset: new THREE.Vector3(0, 1.62, -0.12)
    };
  }

  createHelicopterEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerPoliceHeli';
    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);
    const model = policeHeli({ uniforms: createVehicleUniforms() });
    tiltPivot.add(model);
    const ud = model.userData;
    // Nightsun searchlight: a narrow spot + a faint additive beam cone, aimed ahead & down from the nose gimbal
    const searchSpot = createSearchlight();
    searchSpot.position.set(0, -0.05, 0.22);
    searchSpot.target.position.set(0, -0.05, 20);
    ud.searchlight.add(searchSpot, searchSpot.target);
    const beamLen = 90;
    const beamGeo = new THREE.ConeGeometry(Math.tan(SEARCHLIGHT.angle) * beamLen, beamLen, 24, 1, true);
    beamGeo.translate(0, -beamLen / 2, 0);
    beamGeo.rotateX(-Math.PI / 2);
    const beamMat = new THREE.MeshBasicNodeMaterial({
      color: 0xfff4dc, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, -0.05, 0.2);
    beam.castShadow = false;
    beam.visible = false;
    ud.searchlight.add(beam);
    this.scene.add(root);
    return {
      type: 'helicopter', mode: 'helicopter', label: MODE_INFO.helicopter.label,
      mesh: root, model, tiltPivot, mainRotorPivot: ud.mainRotor, tailRotorPivot: ud.tailRotor,
      rotorDisc: ud.mainRotor.getObjectByName('rotorDisc'), searchlight: ud.searchlight, searchSpot, beam,
      uniforms: ud.uniforms, rotorRpm: 1,
      position: new THREE.Vector3(0, 110, 0), heading: 0, speed: 0, vx: 0, vz: 0, verticalSpeed: 0, pitchAngle: 0, rollAngle: 0,
      halfExtents: { hx: 2.6, hz: 5.6 }, bodyHeight: 3.4, collisionRadius: 5.2,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0), chaseDistance: 15.5, chaseHeight: 4.2,
      povOffset: new THREE.Vector3(ud.spec.povOffset.x, ud.spec.povOffset.y, ud.spec.povOffset.z)
    };
  }

  createBoatEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerRiverBoat';
    const bobPivot = new THREE.Group();
    bobPivot.rotation.order = 'YXZ';
    root.add(bobPivot);
    const model = riverBoat({ uniforms: createVehicleUniforms() });
    bobPivot.add(model);
    const spec = model.userData.spec;
    const headLights = [];
    for (const side of [-1, 1]) {
      const spot = createVehicleHeadlight();
      spot.distance = 70;
      spot.angle = 0.22;
      placeVehicleHeadlight(spot, spec, side);
      bobPivot.add(spot, spot.target);
      headLights.push(spot);
    }
    this.scene.add(root);
    const spray = new WakeSpray(this.scene);
    return {
      type: 'boat', mode: 'boat', label: MODE_INFO.boat.label,
      mesh: root, model, bobPivot, spec, spray, headLights,
      position: new THREE.Vector3(), heading: 0, speed: 0, vx: 0, vz: 0, angularVel: 0, pitch: 0, roll: 0, rudder: 0,
      halfExtents: { ...spec.halfExtents }, bodyHeight: 6.5,
      top: 12.5, topBoost: 15.5, engine: 2.6,
      cameraTargetOffset: new THREE.Vector3(0, 3.2, 0), chaseDistance: 30, chaseHeight: 9.5,
      povOffset: new THREE.Vector3(spec.povOffset.x, spec.povOffset.y, spec.povOffset.z)
    };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Collisions
  // -------------------------------------------------------------------------------------------------------------
  /** fn({ type:'collision', impulse (m/s lost), mode, x, z, kind }) for hits > 1 m/s; returns an unsubscribe function */
  addCollisionListener(fn) {
    this._collisionListeners.add(fn);
    return () => this._collisionListeners.delete(fn);
  }

  _emitCollision(ent, impulse, kind) {
    if (!(impulse > 1)) return;
    if (this._stepping) { // inside the physics substeps: report the hardest hit of each kind once per frame
      const prev = this._pendingHits.get(kind);
      if (!prev || impulse > prev.impulse) this._pendingHits.set(kind, { ent, impulse });
      return;
    }
    const ev = { type: 'collision', impulse, mode: ent.mode, x: ent.position.x, z: ent.position.z, kind };
    for (const fn of this._collisionListeners) {
      try { fn(ev); } catch (err) { console.error(err); }
    }
    this.dispatchEvent(ev);
  }

  // The colliders whose bounds come within `r` of (x, z), in their original order. They never move, so they are
  // bucketed once into 48 m cells.
  nearColliders(x, z, r) {
    const CELL = 48;
    const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
    if (!this._colliderCells) {
      this._colliderCells = new Map();
      this.colliders.forEach((c, i) => {
        c._order = i;
        for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
          for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
            const k = key(ix, iz);
            let list = this._colliderCells.get(k);
            if (!list) this._colliderCells.set(k, (list = []));
            list.push(c);
          }
        }
      });
      this._nearList = [];
      this._nearStamp = 0;
    }
    const out = this._nearList;
    out.length = 0;
    const stamp = ++this._nearStamp;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this._colliderCells.get(key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c._seen === stamp) continue;
          c._seen = stamp;
          out.push(c);
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => a._order - b._order);
    return out;
  }

  /**
   * Push `pos` out of the colliders. Without `boxEntity` the body is a square of half-size `radius`; with one, its
   * oriented halfExtents (hx, hz) at its heading, and its speed/slip velocity get NY's collision response.
   * yHeight = the height being tested (skip colliders lower than yHeight - 1.5; skip colliders with minY above
   * yHeight + bodyHeight, e.g. bridge decks over a boat).
   */
  resolveHorizontalCollision(pos, radius, yHeight = 1.0, boxEntity = null) {
    this._clampBounds(pos, this.activeMode);
    const carEntity = boxEntity;
    const hx = carEntity ? carEntity.halfExtents.hx : radius;
    const hz = carEntity ? carEntity.halfExtents.hz : radius;
    const topY = yHeight + (carEntity ? carEntity.bodyHeight : 1.8);
    const sinH = carEntity ? Math.sin(carEntity.heading) : 0;
    const cosH = carEntity ? Math.cos(carEntity.heading) : 1;
    const extX = carEntity ? Math.abs(cosH) * hx + Math.abs(sinH) * hz : radius;
    const extZ = carEntity ? Math.abs(sinH) * hx + Math.abs(cosH) * hz : radius;

    const reach = Math.max(extX, extZ) + 6;
    let gx = pos.x;
    let gz = pos.z;
    let near = this.nearColliders(gx, gz, reach);
    let hit = false;
    let hitImpulse = 0;
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (yHeight > c.maxY + 1.5) continue;
      if (c.minY !== undefined && topY < c.minY) continue;

      if (pos.x + extX > c.minX && pos.x - extX < c.maxX && pos.z + extZ > c.minZ && pos.z - extZ < c.maxZ) {
        let nx = 0;
        let nz = 0;
        // Vehicles are oriented boxes: treat plain AABB colliders (pillar boxes, phone boxes, bollards) as boxes too,
        // and also separate on the vehicle's own axes (full SAT). Testing only the vehicle's axis-aligned bounds made
        // kerbside furniture "hit" a car on a diagonal street from over a metre away.
        const cobb = c.obb || (carEntity ? {
          cx: (c.minX + c.maxX) / 2, cz: (c.minZ + c.maxZ) / 2, hx: (c.maxX - c.minX) / 2, hz: (c.maxZ - c.minZ) / 2, cs: 1, sn: 0
        } : null);
        if (carEntity) {
          const o = cobb;
          const ddx = o.cx - pos.x, ddz = o.cz - pos.z;
          // box axes in world: x = (cs, -sn), z = (sn, cs); vehicle forward f = (sinH, cosH), right r = (cosH, -sinH)
          const pf = o.hx * Math.abs(o.cs * sinH - o.sn * cosH) + o.hz * Math.abs(o.sn * sinH + o.cs * cosH);
          const pr = o.hx * Math.abs(o.cs * cosH + o.sn * sinH) + o.hz * Math.abs(o.sn * cosH - o.cs * sinH);
          if (Math.abs(ddx * sinH + ddz * cosH) >= hz + pf || Math.abs(ddx * cosH - ddz * sinH) >= hx + pr) continue;
        }
        if (cobb) {
          const o = cobb;
          const dx = pos.x - o.cx;
          const dz = pos.z - o.cz;
          const lx = dx * o.cs - dz * o.sn;
          const lz = dx * o.sn + dz * o.cs;
          const ls = sinH * o.cs - cosH * o.sn; // heading in the box's frame
          const lc = sinH * o.sn + cosH * o.cs;
          const ex = carEntity ? Math.abs(lc) * hx + Math.abs(ls) * hz : radius;
          const ez = carEntity ? Math.abs(ls) * hx + Math.abs(lc) * hz : radius;
          if (lx + ex <= -o.hx || lx - ex >= o.hx || lz + ez <= -o.hz || lz - ez >= o.hz) continue;
          const oL = lx + ex + o.hx;
          const oR = o.hx - (lx - ex);
          const oT = lz + ez + o.hz;
          const oB = o.hz - (lz - ez);
          const m = Math.min(oL, oR, oT, oB);
          let qx = lx;
          let qz = lz;
          let mx = 0;
          let mz = 0;
          if (m === oL) { qx = -o.hx - ex; mx = -1; }
          else if (m === oR) { qx = o.hx + ex; mx = 1; }
          else if (m === oT) { qz = -o.hz - ez; mz = -1; }
          else { qz = o.hz + ez; mz = 1; }
          pos.x = o.cx + qx * o.cs + qz * o.sn;
          pos.z = o.cz - qx * o.sn + qz * o.cs;
          nx = mx * o.cs + mz * o.sn;
          nz = -mx * o.sn + mz * o.cs;
        } else {
          const overlapLeft = pos.x + extX - c.minX;
          const overlapRight = c.maxX - (pos.x - extX);
          const overlapTop = pos.z + extZ - c.minZ;
          const overlapBottom = c.maxZ - (pos.z - extZ);
          const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
          if (minOverlap === overlapLeft) { pos.x = c.minX - extX; nx = -1; }
          else if (minOverlap === overlapRight) { pos.x = c.maxX + extX; nx = 1; }
          else if (minOverlap === overlapTop) { pos.z = c.minZ - extZ; nz = -1; }
          else { pos.z = c.maxZ + extZ; nz = 1; }
        }
        hit = true;

        if (carEntity) {
          const vn = this._wallContact(carEntity, nx, nz);
          if (vn > 0.5 && vn > hitImpulse) hitImpulse = vn;
          if (vn > 2.2) {
            carEntity.lastCollisionSpark = { x: pos.x - nx * extX * 0.92, y: (carEntity.position?.y || 0) + 0.56, z: pos.z - nz * extZ * 0.92, nx, nz, speed: vn };
          }
        }

        // A push that carried it far from where the candidates were gathered: gather them again, same order
        if (Math.abs(pos.x - gx) > 5 || Math.abs(pos.z - gz) > 5) {
          gx = pos.x;
          gz = pos.z;
          const order = c._order;
          near = this.nearColliders(gx, gz, reach);
          i = -1;
          while (i + 1 < near.length && near[i + 1]._order <= order) i++;
        }
      }
    }
    if (carEntity && hitImpulse) this._emitCollision(carEntity, hitImpulse, 'collider');
    return hit;
  }

  /**
   * Velocity response of a box entity touching a wall with outward normal (nx, nz): the part of the velocity going
   * into the wall is removed (a hard hit keeps a small rebound, < 1.2 m/s), the part along it scrapes with friction, and
   * a glancing hit turns the body to run along the wall (small knocks don't spin it). Returns the impact speed (m/s).
   */
  _wallContact(e, nx, nz, align = true) {
    const s = Math.sin(e.heading), c = Math.cos(e.heading);
    let Vx = s * e.speed + (e.vx || 0), Vz = c * e.speed + (e.vz || 0);
    const vn = Vx * nx + Vz * nz;
    if (vn >= -0.02) return 0;
    const imp = -vn;
    Vx -= nx * vn;
    Vz -= nz * vn;
    const vt = Math.hypot(Vx, Vz);
    if (vt > 1e-6) {
      const keep = Math.max(0, vt - 0.15 * imp) / vt; // Coulomb-ish scrape
      Vx *= keep;
      Vz *= keep;
    }
    const rebound = imp > 4 ? Math.min(1.2, 0.3 + (imp - 4) * 0.1) : 0;
    Vx += nx * rebound;
    Vz += nz * rebound;
    // turn towards the wall's direction of travel: an impulse for real impacts, a steady pull while scraping along
    const fwdN = s * nx + c * nz; // -1: nose square into the wall
    const back = e.speed < 0 ? -1 : 1;
    if (align && Math.abs(fwdN) < 0.9 && vt > 0.5) {
      let tx = -nz, tz = nx;
      if ((tx * s + tz * c) * back < 0) { tx = -tx; tz = -tz; }
      const ang = Math.acos(clamp((tx * s + tz * c) * back, -1, 1)); // 0..~64°
      const dir = Math.sign(c * tx - s * tz) * back; // which way the heading turns to line up
      if (imp > 1.5) e.angularVel = (e.angularVel || 0) + dir * Math.min(1.0, 0.1 * (imp - 1.5)) * Math.min(1, ang / 0.3);
      const h = this._h || 1 / 60;
      const pull = Math.min(1, vt / 12);
      e.heading += dir * ang * (1 - Math.exp(-h * 5)) * pull * pull;
    }
    const s2 = Math.sin(e.heading), c2 = Math.cos(e.heading);
    e.speed = Vx * s2 + Vz * c2;
    if (e.vx !== undefined) {
      const lat = Vx * c2 - Vz * s2;
      e.vx = lat * c2;
      e.vz = -lat * s2;
    }
    if (e.yawRate !== undefined && imp > 3) e.yawRate *= 0.5;
    if (e.pitchVel !== undefined && imp > 1) {
      const k = Math.min(10, imp);
      e.pitchVel += Math.max(0, -fwdN) * back * k * 0.05; // nose dips into a frontal hit
      e.rollVel += (c * nx - s * nz) * k * 0.03;
      e.heaveVel += Math.min(0.5, imp * 0.04);
    }
    return imp;
  }

  /** Undo a move into forbidden water (or, for the boat, onto land). Returns true when it bounced. */
  _keepToMedium(ent, prevX, prevZ) {
    const mode = ent.mode;
    const cur = this.waterBlockedCount(mode, ent.position.x, ent.position.z, ent.heading, ent.position.y);
    if (!cur) return false;
    // already partly over the edge (spawned/teleported/turned there): let it move, but never further in
    const before = this.waterBlockedCount(mode, prevX, prevZ, ent.heading, ent.position.y);
    if (before && cur <= before) return false;
    // try sliding along the edge (keep one axis of the move) before stopping dead; the reverted axis is the normal
    const nx = ent.position.x, nz = ent.position.z;
    const mx = nx - prevX, mz = nz - prevZ;
    let wx, wz;
    if (!this.waterBlocked(mode, nx, prevZ, ent.heading, ent.position.y)) { ent.position.z = prevZ; wx = 0; wz = -Math.sign(mz) || 1; }
    else if (!this.waterBlocked(mode, prevX, nz, ent.heading, ent.position.y)) { ent.position.x = prevX; wx = -Math.sign(mx) || 1; wz = 0; }
    else {
      ent.position.x = prevX;
      ent.position.z = prevZ;
      const L = Math.hypot(mx, mz) || 1;
      wx = -mx / L; wz = -mz / L;
    }
    if (ent.type === 'person') {
      ent.speed = 0;
      return true;
    }
    // the same wall response as buildings (no bounce back, scrape along) but without turning: that could swing a
    // corner out over the water
    const imp = this._wallContact(ent, wx, wz, false);
    this._emitCollision(ent, imp, mode === 'boat' ? 'bank' : 'embankment');
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------------------------------------------
  poseCharacters(dt) {
    const p = this.entities.person;
    const air = p.position.y - this.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
    p.rig.update(dt, p.position.x, p.position.z, p.heading, personGround, this, air > 0.02 ? air : 0);
    p.crowd.begin();
    p.crowd.add(p.rig, 0);
    p.crowd.end();

    const b = this.entities.cyclist;
    b.mesh.updateMatrixWorld(true);
    b.riderRig.ride(b.leanPivot, b.pedalPhase, b.bikeFrame);
    b.riderCrowd.begin();
    b.riderCrowd.add(b.riderRig, 0);
    b.riderCrowd.end();
  }

  update(dt, elapsed = 0) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const night = setVehicleNightFromGlow(glow);
    const beamScale = beamScaleForGlow(glow);

    const mode = this.activeMode;
    // fixed-size substeps: the same handling, collisions & body motion at 30, 60, 120 or 144 fps
    const n = Math.max(1, Math.ceil(dt / PHYS_STEP - 1e-6));
    const h = dt / n;
    this._h = h;
    this._stepping = true;
    try {
      for (let i = 0; i < n; i++) {
        const t = elapsed - dt + (i + 1) * h;
        if (mode === 'person') this.updatePerson(h);
        else if (mode === 'car' || mode === 'ride' || mode === 'bus') this.updateCar(this.entities[mode], h);
        else if (mode === 'cyclist') this.updateCyclist(h);
        else if (mode === 'helicopter') this.updateHelicopter(h, t);
        else if (mode === 'boat') this.updateBoat(h, t);
      }
    } finally {
      this._stepping = false;
      for (const [kind, { ent, impulse }] of this._pendingHits) this._emitCollision(ent, impulse, kind);
      this._pendingHits.clear();
    }
    if (mode !== 'boat') this.idleBoat(dt, elapsed);
    this.updateRotors(dt, mode === 'helicopter');
    const active = this.entities[mode];
    if (active.type === 'car') this._carKerbs(active, dt);
    this._animateBus(dt);
    this._applyBusPov();

    for (const e of Object.values(this.entities)) {
      e.mesh.position.copy(e.position);
      e.mesh.rotation.y = e.heading;
      if (e.type === 'car') e.mesh.rotation.x = e.slopePitch || 0;
    }

    // Only the driven vehicle carries live lamps (spotlights are expensive); parked ones keep their emissive lamps
    for (const m of ['car', 'ride', 'bus']) {
      const c = this.entities[m];
      for (const spot of c.headLights) spot.intensity = m === mode ? HEADLIGHTS.intensity * beamScale : 0;
    }
    const boat = this.entities.boat;
    for (const spot of boat.headLights) spot.intensity = mode === 'boat' ? HEADLIGHTS.intensity * 2.2 * beamScale : 0;
    const bike = this.entities.cyclist;
    bike.headLight.intensity = mode === 'cyclist' ? 115 * beamScale : 0;
    const heli = this.entities.helicopter;
    const sOn = mode === 'helicopter' && (this.searchlightOn === null ? night > 0.3 : this.searchlightOn);
    heli.searchSpot.intensity = sOn ? SEARCHLIGHT.intensity * Math.max(0.35, night) : 0;
    heli.beam.visible = sOn;
    heli.beam.material.opacity = sOn ? 0.03 + 0.07 * night : 0;
    // police beacon flashes while flying at night (or when the searchlight is on)
    const flashing = mode === 'helicopter' && (night > 0.3 || sOn);
    heli.uniforms.beacon.value = flashing && (elapsed * 2.2) % 1 < 0.18 ? 1 : 0;

    this.poseCharacters(dt);
  }

  updatePerson(dt) {
    const p = this.entities.person;
    const maxWalk = this.keys.boost ? 7.4 : 4.2;
    const turnRate = 2.6;
    let targetSpeed = 0;
    if (this.keys.forward) targetSpeed = maxWalk * num(this.keys.forward);
    else if (this.keys.backward) targetSpeed = -maxWalk * 0.65 * num(this.keys.backward);
    if (this.keys.left) p.heading += turnRate * dt * num(this.keys.left);
    if (this.keys.right) p.heading -= turnRate * dt * num(this.keys.right);
    p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 10);
    const prevX = p.position.x, prevZ = p.position.z;
    p.position.x += Math.sin(p.heading) * p.speed * dt;
    p.position.z += Math.cos(p.heading) * p.speed * dt;
    this.resolveHorizontalCollision(p.position, 0.48, p.position.y + 1.0);
    if (this._keepToMedium(p, prevX, prevZ)) p.speed = 0;

    const groundY = this.getGroundHeight(p.position.x, p.position.z, 'person', p.position.y);
    if (this.keys.up && p.position.y <= groundY + 0.02) p.verticalVel = 5.2;
    p.verticalVel -= 14.5 * dt;
    p.position.y += p.verticalVel * dt;
    if (p.position.y < groundY) {
      p.position.y = groundY;
      p.verticalVel = 0;
    }
  }

  /**
   * Arcade car, one physics substep. Keyboard keys are on/off, so the driver's inputs are eased: pedals travel in
   * ~0.2 s, the wheel slews towards lock (slower at speed) and self-centres when released. The lock is limited so a
   * full turn corners at about `aLat` (speed-sensitive steering), the body takes up the bicycle-model yaw rate with a
   * small lag (`yawTau`, weight), the sideways velocity is tyre slip bled off by grip (handbrake: slides), and the
   * body rides on pitch/roll/heave springs driven by the drive forces and cornering.
   */
  updateCar(c, dt) {
    if (typeof c === 'number') [c, dt] = [this.entities[this.activeMode === 'ride' || this.activeMode === 'bus' ? this.activeMode : 'car'], c]; // NY signature updateCar(dt)
    const k = this.keys;
    const fwdIn = num(k.forward), backIn = num(k.backward);
    const bus = !!c.isBus;
    const interlock = bus && c.doorsOpen && c.doorInterlock !== false;
    const handIn = !!k.up;
    const handbrake = handIn && !bus; // the bus's Space is a parking brake: it stops, it doesn't slide
    c.pedalF = slew(c.pedalF, interlock ? 0 : fwdIn, c.pedalRise * dt, c.pedalFall * dt);
    c.pedalB = slew(c.pedalB, backIn, c.pedalRise * 1.4 * dt, c.pedalFall * dt);
    const pf = c.pedalF, pb = c.pedalB;
    const boosting = !!k.boost && !interlock;
    c.vmaxNow = slew(c.vmaxNow ?? c.top, boosting ? c.topBoost : c.top, 6 * dt, 2.5 * dt);
    const vf = c.speed;
    let accel = 0, braking = false, driving = false;
    if (pf > 0.001 && pf >= pb) {
      if (vf < -0.3) { accel = c.brakeDecel * pf; braking = true; }
      else {
        driving = true;
        const r = Math.max(0, vf) / c.vmaxNow;
        accel = c.engine * pf * Math.max(0, 1 - r * r * r) * (boosting ? c.boostGain : 1);
      }
    } else if (pb > 0.001) {
      if (vf > 0.3) { accel = -c.brakeDecel * pb; braking = true; }
      else {
        driving = true;
        accel = -c.reverseAccel * pb * Math.max(0, 1 - Math.max(0, -vf) / c.reverseMax);
      }
    }
    if (vf > c.vmaxNow) accel -= Math.min(2.5, (vf - c.vmaxNow) * 0.8); // easing off after a boost, no lurch
    let nv = vf + accel * dt;
    if (braking && vf !== 0 && Math.sign(nv) !== Math.sign(vf)) nv = 0;
    // coasting: rolling resistance + aero drag (under power the engine curve above already tops out at vmax)
    const resist = driving ? 0 : c.rolling + c.drag * nv * nv;
    nv = Math.abs(nv) <= resist * dt ? (driving ? nv : 0) : nv - Math.sign(nv) * resist * dt;
    if (handIn || interlock) {
      const d = (bus ? 5 : 4.5) * dt;
      nv = Math.abs(nv) <= d ? 0 : nv - Math.sign(nv) * d;
      braking = true;
    }
    c.longAcc = (nv - vf) / dt;

    // steering: slew the wheel (lock fraction), speed-limited lock, lagged yaw
    const steerIn = clamp(num(k.left) - num(k.right), -1, 1);
    const v = Math.abs(nv);
    const u = Math.min(1, v / 25);
    const centring = Math.abs(steerIn) < Math.abs(c.steerCmd) || steerIn * c.steerCmd < 0;
    const rate = centring ? c.steerReturn + v * 0.12 : c.steerRateLow + (c.steerRateHigh - c.steerRateLow) * u;
    c.steerCmd = slew(c.steerCmd, steerIn, rate * dt, rate * dt);
    const lock = Math.min(c.maxSteer, Math.atan((c.wheelbase * c.aLat) / Math.max(1, nv * nv)));
    const target = c.steerCmd * lock * (handbrake && v > 3 ? 1.6 : 1);
    c.steerAngle += (target - c.steerAngle) * (1 - Math.exp(-dt / 0.045));
    let yawT = (nv * Math.tan(c.steerAngle)) / c.wheelbase;
    // grip limit, soft: linear well below it, rounding off near it (no hard clamp to bump into)
    const yawMax = ((handbrake ? 2.4 : 1.25) * c.aLat) / Math.max(2.5, v);
    const q = yawT / yawMax;
    yawT /= Math.sqrt(Math.sqrt(1 + q * q * q * q));
    c.yawRate += (yawT - c.yawRate) * (1 - Math.exp(-dt / (c.yawTau * (handbrake ? 0.7 : 1))));
    const sinH = Math.sin(c.heading), cosH = Math.cos(c.heading);
    c.heading += (c.yawRate + c.angularVel) * dt;
    c.angularVel *= Math.exp(-dt * 5.5);

    // carry the world velocity into the new heading: the sideways part is the tyre slip, bled off by grip
    const gTarget = handbrake ? c.hbGrip : c.grip;
    c.gripNow = gTarget < c.gripNow ? gTarget : c.gripNow + (gTarget - c.gripNow) * (1 - Math.exp(-dt * 2.5));
    const Vx = sinH * nv + c.vx, Vz = cosH * nv + c.vz;
    const s2 = Math.sin(c.heading), c2 = Math.cos(c.heading);
    let lat = Vx * c2 - Vz * s2;
    lat *= Math.exp(-c.gripNow * dt);
    c.speed = Vx * s2 + Vz * c2;
    c.vx = lat * c2;
    c.vz = -lat * s2;

    this._edgeBrake(c, s2, c2);

    const prevX = c.position.x, prevZ = c.position.z;
    c.position.x += (s2 * c.speed + c.vx) * dt;
    c.position.z += (c2 * c.speed + c.vz) * dt;
    this.resolveHorizontalCollision(c.position, 1.35, c.position.y + 1.0, c);
    this._keepToMedium(c, prevX, prevZ);

    // vertical: follow the road/bridge deck, fall off edges, pitch with the slope
    const g = this.getGroundHeight(c.position.x, c.position.z, c.mode, c.position.y);
    if (g >= c.position.y - 0.02) {
      if (g - c.position.y > 0.06) c.heaveVel -= Math.min(1.2, (g - c.position.y) * 6);
      c.position.y = g;
      c.vy = 0;
    } else {
      c.vy -= 9.81 * dt;
      c.position.y += c.vy * dt;
      if (c.position.y <= g) {
        if (c.vy < -2) c.heaveVel += Math.max(-2, c.vy * 0.18);
        c.position.y = g;
        c.vy = 0;
      }
    }
    const sh = Math.sin(c.heading), ch = Math.cos(c.heading);
    const half = c.wheelbase / 2;
    const hf = this.getGroundHeight(c.position.x + sh * half, c.position.z + ch * half, c.mode, c.position.y);
    const hr = this.getGroundHeight(c.position.x - sh * half, c.position.z - ch * half, c.mode, c.position.y);
    const onGround = c.position.y - g < 0.05;
    const targetSlope = onGround && Math.abs(hf - hr) < 3 ? -Math.atan2(hf - hr, c.wheelbase) : c.slopePitch;
    c.slopePitch += (targetSlope - c.slopePitch) * (1 - Math.exp(-dt * 10));

    // sprung body: nose up under power / down under braking, rolls to the outside of the turn, kerbs & kneeling
    const K = c.kerb;
    const kerbPitch = Math.atan2((K[0] + K[1]) - (K[2] + K[3]), 2 * c.wheelbase);
    const kerbRoll = Math.atan2((K[0] + K[2]) - (K[1] + K[3]), 2 * c.track);
    const aLat = c.speed * c.yawRate;
    const targetPitch = clamp(-c.longAcc * c.pitchGain, -0.045, 0.04) + kerbPitch * 0.5;
    const targetRoll = clamp(aLat * c.rollGain, -0.07, 0.07) + kerbRoll * 0.5 - (c.kneel || 0) * 0.022;
    const targetHeave = (K[0] + K[1] + K[2] + K[3]) / 4 - (c.kneel || 0) * 0.05;
    const w = c.springW, w2 = w * w, z2 = 2 * c.springZeta * w;
    const rot = c.chassisPivot.rotation;
    c.pitchVel += ((targetPitch - rot.x) * w2 - c.pitchVel * z2) * dt;
    c.rollVel += ((targetRoll - rot.z) * w2 - c.rollVel * z2) * dt;
    rot.x = clamp(rot.x + c.pitchVel * dt, -0.15, 0.15);
    rot.z = clamp(rot.z + c.rollVel * dt, -0.18, 0.18);
    c.heaveVel += ((targetHeave - c.heaveY) * w2 * 1.6 - c.heaveVel * z2 * 1.2) * dt;
    c.heaveY = clamp(c.heaveY + c.heaveVel * dt, -0.08, 0.3);
    c.chassisPivot.position.y = c.heaveY;

    if (c.uniforms) c.uniforms.brake.value = braking || (pf <= 0.05 && Math.abs(c.speed) < 0.6) ? 1 : 0;

    const forwardDist = (c.position.x - prevX) * s2 + (c.position.z - prevZ) * c2;
    // the road wheels show the driver's input (a little more than the speed-limited lock, so it reads at speed)
    const shown = c.steerCmd * c.maxSteer * (1 - 0.55 * u) * (bus ? 1 : 0.9);
    for (const wh of c.wheels) {
      wh.spin.rotation.x += forwardDist / wh.radius;
      if (wh.front) wh.group.rotation.y = shown;
    }
  }

  /** Wheels ride up kerbs (city.surfaceHeight): per-wheel offsets, eased, that the body springs follow */
  _carKerbs(c, dt) {
    const K = c.kerb;
    if (!this.surfaceHeight) {
      if (K[0] || K[1] || K[2] || K[3]) K.fill(0);
    } else {
      const s = Math.sin(c.heading), co = Math.cos(c.heading);
      const base = c.position.y;
      const k = 1 - Math.exp(-dt / 0.035);
      // order: front-left(+x), front-right, rear-left, rear-right
      let i = 0;
      for (const front of [true, false]) {
        for (const side of [1, -1]) {
          const wl = c.wheels.find((w) => !!w.front === front && Math.sign(w.x) === side);
          const lx = wl ? wl.x : side * c.track / 2, lz = wl ? wl.z : (front ? 1 : -1) * c.wheelbase / 2;
          const wx = c.position.x + lx * co + lz * s, wz = c.position.z - lx * s + lz * co;
          const top = this._kerbTop(wx, wz, base) - base;
          const prev = K[i];
          K[i] += (top - K[i]) * k;
          if (top - prev > 0.05) c.heaveVel += Math.min(0.25, Math.abs(c.speed) * 0.02); // a felt bump mounting it
          if (wl) wl.group.position.y = wl.baseY + K[i];
          i++;
        }
      }
    }
  }

  updateCyclist(dt) {
    const b = this.entities.cyclist;
    const maxSpeed = this.keys.boost ? 10.5 : 7.2; // heavy 3-speed hire bike: ~16 mph, ~24 mph sprinting
    const accel = this.keys.boost ? 4.2 : 2.8;
    let throttle = 0;
    if (this.keys.forward) throttle = num(this.keys.forward);
    else if (this.keys.backward) throttle = -num(this.keys.backward);
    if (throttle > 0) {
      b.speed += throttle * accel * dt * Math.max(0, 1 - b.speed / maxSpeed);
    } else if (throttle < 0) {
      if (b.speed > 0.2) b.speed = Math.max(0, b.speed - 6.5 * -throttle * dt);
      else b.speed = Math.max(-1.6, b.speed + throttle * 1.5 * dt);
    } else {
      b.speed *= Math.max(0, 1 - dt * 0.45);
      if (Math.abs(b.speed) < 0.05) b.speed = 0;
    }
    if (b.speed > maxSpeed) b.speed += (maxSpeed - b.speed) * Math.min(1, dt * 1.5);

    const turnInput = num(this.keys.left) - num(this.keys.right);
    b.steer += (turnInput - b.steer) * Math.min(1, dt * 6);
    if (Math.abs(b.speed) > 0.15) {
      const dirSign = b.speed >= 0 ? 1 : -1;
      b.heading += b.steer * (2.2 / (1 + Math.abs(b.speed) * 0.08)) * dirSign * dt;
    }
    const prevX = b.position.x, prevZ = b.position.z;
    b.position.x += Math.sin(b.heading) * b.speed * dt;
    b.position.z += Math.cos(b.heading) * b.speed * dt;
    if (this.resolveHorizontalCollision(b.position, 0.6, b.position.y + 1.0)) {
      const moved = Math.hypot(b.position.x - prevX, b.position.z - prevZ) / Math.max(dt, 1e-4);
      const lost = Math.max(0, Math.abs(b.speed) - moved);
      b.speed = Math.sign(b.speed) * Math.min(Math.abs(b.speed) * 0.85, moved + 0.5);
      this._emitCollision(b, lost, 'collider');
    }
    this._keepToMedium(b, prevX, prevZ);
    const g = this.getGroundHeight(b.position.x, b.position.z, 'cyclist', b.position.y);
    if (g >= b.position.y - 0.02) {
      // hop up a kerb over a few frames rather than in one
      b.position.y = g - b.position.y > 0.03 && g - b.position.y < 0.3 ? b.position.y + (g - b.position.y) * (1 - Math.exp(-dt * 30)) : g;
      b.vy = 0;
    } else {
      b.vy -= 9.81 * dt;
      b.position.y = Math.max(g, b.position.y + b.vy * dt);
      if (b.position.y === g) b.vy = 0;
    }

    const targetLean = -b.steer * Math.min(1.0, Math.abs(b.speed) / 6.0) * 0.3;
    b.leanAngle += (targetLean - b.leanAngle) * Math.min(1, dt * 7);
    b.leanPivot.rotation.z = b.leanAngle;
    const wheelDelta = (b.speed / b.wheels[0].radius) * dt;
    for (const w of b.wheels) w.spin.rotation.x += wheelDelta;
    b.wheels[0].group.rotation.y = b.steer * 0.35 * Math.max(0.25, 1 - Math.abs(b.speed) / 12);
    // the cranks turn with the rear wheel through the hub gears while pedalling, freewheel otherwise
    if (throttle > 0 && wheelDelta > 0) b.pedalPhase += wheelDelta / 2.4;
    b.crankPivot.rotation.x = b.pedalPhase;
  }

  /** The highest collider roof under (x, z) that the helicopter is at or above (rooftop landing) */
  _roofUnder(x, z, y) {
    let top = -Infinity;
    for (const c of this.nearColliders(x, z, 1)) {
      if (y < c.maxY - 0.8) continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.obb) {
        const o = c.obb, dx = x - o.cx, dz = z - o.cz;
        if (Math.abs(dx * o.cs - dz * o.sn) > o.hx || Math.abs(dx * o.sn + dz * o.cs) > o.hz) continue;
      }
      top = Math.max(top, c.maxY);
    }
    return top;
  }

  updateHelicopter(dt, elapsed) {
    const h = this.entities.helicopter;
    const maxHorizSpeed = this.keys.boost ? 65.0 : 40.0;
    const maxVertSpeed = 14.0;
    const fwdInput = this.keys.forward ? num(this.keys.forward) : this.keys.backward ? -num(this.keys.backward) : 0;
    const yawInput = this.keys.left ? num(this.keys.left) : this.keys.right ? -num(this.keys.right) : 0;
    const vertInput = this.keys.up ? num(this.keys.up) : this.keys.down ? -num(this.keys.down) : 0;
    const floor = Math.max(this.getGroundHeight(h.position.x, h.position.z, 'helicopter', h.position.y), this._roofUnder(h.position.x, h.position.z, h.position.y));
    const landed = h.position.y <= floor + 0.05;
    if (fwdInput !== 0 && !(landed && vertInput <= 0)) {
      h.speed += fwdInput * 18.0 * dt;
      h.speed = clamp(h.speed, -maxHorizSpeed * 0.4, maxHorizSpeed);
    } else {
      h.speed *= Math.max(0, 1 - dt * (landed ? 6 : 1.2));
    }
    if (h.speed > maxHorizSpeed) h.speed += (maxHorizSpeed - h.speed) * Math.min(1, dt);
    if (vertInput !== 0) {
      h.verticalSpeed += vertInput * 20.0 * dt;
      h.verticalSpeed = clamp(h.verticalSpeed, -maxVertSpeed, maxVertSpeed);
    } else {
      h.verticalSpeed *= Math.max(0, 1 - dt * 3.5);
    }
    if (!(landed && Math.abs(h.speed) < 1 && vertInput <= 0)) h.heading += yawInput * 1.35 * dt;

    h.position.x += Math.sin(h.heading) * h.speed * dt;
    h.position.z += Math.cos(h.heading) * h.speed * dt;
    h.position.y += h.verticalSpeed * dt;
    h.position.y = Math.min(600, h.position.y);
    this.resolveHorizontalCollision(h.position, 4.5, h.position.y);
    const floor2 = Math.max(this.getGroundHeight(h.position.x, h.position.z, 'helicopter', h.position.y), this._roofUnder(h.position.x, h.position.z, h.position.y));
    if (h.position.y < floor2) {
      h.position.y = floor2;
      if (h.verticalSpeed < 0) h.verticalSpeed = 0;
    }
    const onGround = h.position.y <= floor2 + 0.05;
    h.rotorTarget = onGround && vertInput <= 0 && Math.abs(h.speed) < 1 ? 0.55 : 1;

    const targetPitch = onGround ? 0 : (h.speed / maxHorizSpeed) * 0.22;
    const targetRoll = onGround ? 0 : -yawInput * 0.26 * Math.min(1, 0.3 + Math.abs(h.speed) / 20);
    h.pitchAngle += (targetPitch - h.pitchAngle) * Math.min(1, dt * 4);
    h.rollAngle += (targetRoll - h.rollAngle) * Math.min(1, dt * 4);
    h.tiltPivot.rotation.x = h.pitchAngle;
    h.tiltPivot.rotation.z = h.rollAngle;
    h.tiltPivot.position.y = onGround ? 0 : Math.sin(elapsed * 2.6) * 0.15;
    // searchlight looks at the ground ~50 m ahead
    const alt = Math.max(5, h.position.y - floor2);
    h.searchlight.rotation.x = clamp(Math.atan2(alt, 50) - h.pitchAngle, 0.15, 1.4);
  }

  updateRotors(dt, active) {
    const h = this.entities.helicopter;
    const target = active ? (h.rotorTarget ?? 1) : 0.5;
    h.rotorRpm += (target - h.rotorRpm) * Math.min(1, dt * 0.8);
    h.mainRotorPivot.rotation.y += dt * 27 * h.rotorRpm;
    h.tailRotorPivot.rotation.x += dt * 140 * h.rotorRpm;
    if (h.rotorDisc) h.rotorDisc.material.opacity = 0.12 * clamp((h.rotorRpm - 0.4) / 0.6, 0, 1);
  }

  /** Waterjet catamaran: sluggish rudder that needs way on, sideways drift, bobbing & wake spray */
  updateBoat(dt, elapsed) {
    const b = this.entities.boat;
    const k = this.keys;
    const vmax = k.boost ? b.topBoost : b.top;
    const thr = num(k.forward) - num(k.backward);
    const s = Math.sin(b.heading), c = Math.cos(b.heading);
    let vf = b.speed;
    if (thr > 0) vf += thr * b.engine * (k.boost ? 1.3 : 1) * Math.max(0, 1 - Math.max(0, vf) / vmax) * dt;
    else if (thr < 0) vf += thr * (vf > 0 ? 3.2 : 1.6) * Math.max(0, 1 - Math.max(0, -vf) / 4.5) * dt;
    vf -= vf * (0.06 + Math.abs(vf) * 0.012) * dt;
    if (vf > vmax) vf += (vmax - vf) * Math.min(1, dt * 0.8);

    const helm = num(k.left) - num(k.right);
    b.rudder += (helm - b.rudder) * Math.min(1, dt * 2.5);
    const authority = 0.06 + 0.3 * Math.min(1, Math.abs(vf) / 5);
    const targetYaw = b.rudder * authority * (vf >= -0.2 ? 1 : -0.6);
    b.angularVel += (targetYaw - b.angularVel) * Math.min(1, dt * 1.4);
    b.heading += b.angularVel * dt;

    const Vx = s * vf + b.vx, Vz = c * vf + b.vz;
    const s2 = Math.sin(b.heading), c2 = Math.cos(b.heading);
    let lat = Vx * c2 - Vz * s2;
    lat *= Math.exp(-1.1 * dt);
    b.speed = Vx * s2 + Vz * c2;
    b.vx = lat * c2;
    b.vz = -lat * s2;

    const prevX = b.position.x, prevZ = b.position.z;
    b.position.x += (s2 * b.speed + b.vx) * dt;
    b.position.z += (c2 * b.speed + b.vz) * dt;
    const wl = this.getGroundHeight(b.position.x, b.position.z, 'boat');
    if (this.resolveHorizontalCollision(b.position, 4, wl + 0.5, b)) b.speed *= 0.9;
    if (this._keepToMedium(b, prevX, prevZ)) {
      b.angularVel *= 0.5;
      b.pitch -= 0.02;
    }
    this._boatMotion(b, dt, elapsed, helm, true);
  }

  idleBoat(dt, elapsed) {
    const b = this.entities.boat;
    if (Math.abs(b.speed) > 0.01) {
      b.speed *= Math.max(0, 1 - dt * 0.5);
      b.position.x += Math.sin(b.heading) * b.speed * dt;
      b.position.z += Math.cos(b.heading) * b.speed * dt;
      if (this.waterBlocked('boat', b.position.x, b.position.z, b.heading)) {
        b.position.x -= Math.sin(b.heading) * b.speed * dt;
        b.position.z -= Math.cos(b.heading) * b.speed * dt;
        b.speed = 0;
      }
    }
    this._boatMotion(b, dt, elapsed, 0, false);
  }

  _boatMotion(b, dt, elapsed, helm, active) {
    const wl = this.getGroundHeight(b.position.x, b.position.z, 'boat');
    const v = Math.abs(b.speed);
    // bobbing on the swell + a planing bow-up trim at speed, banking into turns
    b.position.y = wl + Math.sin(elapsed * 1.3 + b.position.x * 0.05) * 0.07 + Math.sin(elapsed * 2.1) * 0.03 + Math.min(1, v / 12) * 0.15;
    const trim = -Math.min(1, v / 10) * 0.035;
    const wavesP = Math.sin(elapsed * 0.9 + 1.3) * 0.012;
    const wavesR = Math.sin(elapsed * 1.15) * 0.018;
    b.pitch += (trim + wavesP - b.pitch) * Math.min(1, dt * 2);
    b.roll += (-b.angularVel * Math.min(1, v / 8) * 0.25 + wavesR - b.roll) * Math.min(1, dt * 2);
    b.bobPivot.rotation.x = b.pitch;
    b.bobPivot.rotation.z = b.roll;
    // wake spray from the transoms and bow wave
    const s = Math.sin(b.heading), c = Math.cos(b.heading);
    if (v > 1.5) {
      const rate = Math.min(1, v / 10);
      for (const p of b.spec.sprayPoints) {
        const n = p.bow ? (Math.random() < rate * 0.5 ? 1 : 0) : (Math.random() < rate ? 2 : 1);
        for (let i = 0; i < n; i++) {
          const wx = b.position.x + p.x * c + p.z * s;
          const wz = b.position.z - p.x * s + p.z * c;
          const out = (Math.random() - 0.5) * 2 + (p.bow ? Math.sign(p.x) * 1.5 : 0);
          const back = p.bow ? -v * 0.3 : -v * 0.45;
          b.spray.emit(wx + (Math.random() - 0.5) * 0.8, wl + 0.15, wz + (Math.random() - 0.5) * 0.8,
            s * back + c * out, (p.bow ? 1.2 : 1.8) + Math.random() * 1.6 * rate, c * back - s * out,
            p.bow ? 0.22 : 0.3);
        }
      }
      if (Math.random() < rate * 0.7) {
        for (const side of [-1, 1]) {
          const wx = b.position.x - s * 14 + c * side * 2.9, wz = b.position.z - c * 14 - s * side * 2.9;
          b.spray.emit(wx + (Math.random() - 0.5) * 1.5, wl + 0.02, wz + (Math.random() - 0.5) * 1.5, 0, 0, 0, 0.8, true);
        }
      }
    }
    b.spray.update(dt, wl);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Wake spray: one instanced mesh of white droplets (gravity) and flat foam patches (spread & fade on the water)
// ---------------------------------------------------------------------------------------------------------------
class WakeSpray {
  constructor(scene, count = 320) {
    const geo = new THREE.IcosahedronGeometry(0.5, 1);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0xeef4f6, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.name = 'BoatWakeSpray';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.n = count;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.foam = new Uint8Array(count);
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._s = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
  }

  emit(x, y, z, vx, vy, vz, size = 0.5, foam = false) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.life[i] = this.max[i] = foam ? 2.6 : 0.6 + Math.random() * 0.5;
    this.size[i] = size * (0.6 + Math.random() * 0.6);
    this.foam[i] = foam ? 1 : 0;
  }

  update(dt, waterY) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const j = i * 3;
      let sc;
      if (this.foam[i]) {
        this.p[j + 1] = waterY + 0.03;
        sc = this.size[i] * (1 + t * 2.5) * (1 - t * t);
        this._s.set(sc, 0.03, sc);
      } else {
        this.v[j + 1] -= 9.81 * dt;
        this.p[j] += this.v[j] * dt;
        this.p[j + 1] += this.v[j + 1] * dt;
        this.p[j + 2] += this.v[j + 2] * dt;
        if (this.p[j + 1] < waterY) this.life[i] = 0;
        sc = this.size[i] * (1 + t) * (1 - t * 0.7);
        this._s.set(sc, sc, sc);
      }
      if (this.life[i] <= 0) this._s.set(0, 0, 0);
      this._pos.set(this.p[j], this.p[j + 1], this.p[j + 2]);
      this.mesh.setMatrixAt(i, this._m.compose(this._pos, this._q, this._s));
    }
    if (any || this._wasAny) this.mesh.instanceMatrix.needsUpdate = true;
    this._wasAny = any;
  }
}

// Walking surface for the player's pedestrian (its rig samples it around its feet)
function personGround(controllers, x, z) {
  return controllers.getGroundHeight(x, z, 'person');
}

function VEHICLE_NIGHT() {
  const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
  return Math.max(0, Math.min(1, (glow - 0.6) / 0.65));
}

export { ThirdPersonControllerManager };
