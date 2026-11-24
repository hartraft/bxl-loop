const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

const source = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function keyboardHarness(nyc = {}) {
  const window = eventTarget();
  const document = { ...eventTarget(), hidden: false };
  const config = {
    streetZ: () => 0,
    isTypingInField: (event) => ['INPUT', 'SELECT'].includes(event.target?.tagName),
    ...nyc
  };
  const mod = loadModule(source, {
    globals: { window, document },
    imports: {
      'three/webgpu': {},
      './city-config.js': config,
      './geo-frame.js': { WORLD_BOUNDS: { minX: -3400, maxX: 3700, minZ: -3200, maxZ: 3600 }, toWorld: () => ({ x: 0, z: 0 }) },
      './tsl-materials.js': { cityUniforms: {}, createContactShadowMaterial: () => ({}) },
      './pedestrians.js': { PersonCrowd: class {}, PersonRig: class {} },
      './vehicle-lights.js': { HEADLIGHTS: {}, SEARCHLIGHT: {}, beamScaleForGlow: () => 1, createVehicleHeadlight: () => ({}), placeVehicleHeadlight: () => {}, createSearchlight: () => ({}) },
      './brussels-vehicles.js': { taxi: () => ({}), rideCar: () => ({}), hireBike: () => ({}), policeHeli: () => ({}), riverBoat: () => ({}), createVehicleUniforms: () => ({}), setVehicleNightFromGlow: () => {} },
      './brussels-bus.js': { brusselsBus: () => ({}) }
    }
  });
  // Exercise the production event handlers without constructing the scene's 3D models.
  const { ThirdPersonControllerManager, HANDLING } = mod;
  const controller = Object.create(ThirdPersonControllerManager.prototype);
  controller.keys = Object.fromEntries(['forward', 'backward', 'left', 'right', 'up', 'down', 'boost'].map((action) => [action, false]));
  controller._pressedCodes = new Set();
  controller.bounds = { minX: -3400, maxX: 3700, minZ: -3200, maxZ: 3600 };
  controller.world = { isWater: () => false, groundHeight: () => 0, onBridge: null };
  controller.entities = {};
  controller.colliders = [];
  controller._colliderCells = null;
  controller.bindKeyboard();
  return {
    controller,
    window,
    document,
    HANDLING,
    key(type, code, tagName = 'BODY') {
      window.dispatch(type, { code, target: { tagName } });
    }
  };
}

test('releasing a movement key after focusing search stops movement', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW', 'INPUT');
  assert.equal(controller.keys.forward, false);

  key('keydown', 'KeyW', 'INPUT');
  assert.equal(controller.keys.forward, false, 'typing in search does not move the player');
});

test('releasing one movement binding preserves another held binding', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  key('keydown', 'ArrowUp');
  key('keyup', 'ArrowUp');
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, false);
});

test('either Shift key keeps boost active until both are released', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'ShiftLeft');
  key('keydown', 'ShiftRight');
  key('keyup', 'ShiftLeft');
  assert.equal(controller.keys.boost, true);
  key('keyup', 'ShiftRight');
  assert.equal(controller.keys.boost, false);
});

test('keyboard and touch input remain active independently', () => {
  const { controller, key } = keyboardHarness();
  controller.setTouchInput('forward', 0.35);
  assert.equal(controller.keys.forward, 0.35);
  key('keydown', 'KeyW');
  assert.equal(controller.keys.forward, true);
  controller.setTouchInput('forward', 0.6);
  assert.equal(controller.keys.forward, true);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, 0.6);
  controller.setTouchInput('forward', 0);
  assert.equal(controller.keys.forward, false);
});

test('clearing touch input preserves held keyboard controls', () => {
  const { controller, key } = keyboardHarness();
  key('keydown', 'KeyW');
  controller.setTouchInput('forward', 0.4);
  controller.setTouchInput('left', 0.7);
  controller.setTouchInput('boost', true);
  controller.clearTouchInput();
  assert.equal(controller.keys.forward, true);
  assert.equal(controller.keys.left, false);
  assert.equal(controller.keys.boost, false);
  key('keyup', 'KeyW');
  assert.equal(controller.keys.forward, false);
});

test('touch strengths are clamped and unknown actions are ignored', () => {
  const { controller } = keyboardHarness();
  controller.setTouchInput('forward', 2);
  controller.setTouchInput('left', -0.5);
  controller.setTouchInput('up', true);
  controller.setTouchInput('unknown', 1);
  assert.equal(controller.keys.forward, 1);
  assert.equal(controller.keys.left, false);
  assert.equal(controller.keys.up, true);
  assert.equal(Object.hasOwn(controller.keys, 'unknown'), false);
});

for (const interruption of ['blur', 'hidden', 'reset']) {
  test(`${interruption} clears held controls and their physical key state`, () => {
    const { controller, window, document, key } = keyboardHarness();
    key('keydown', 'KeyW');
    key('keydown', 'KeyA');
    key('keydown', 'Space');
    key('keydown', 'ShiftLeft');
    controller.setTouchInput('forward', 0.4);
    controller.setTouchInput('backward', 0.8);
    controller.setTouchInput('down', true);
    if (interruption === 'blur') {
      window.dispatch('blur');
    } else if (interruption === 'hidden') {
      document.hidden = true;
      document.dispatch('visibilitychange');
    } else {
      controller.resetInput();
    }
    assert.equal(Object.values(controller.keys).some(Boolean), false);

    // A fresh use of the alias must not revive the old key whose keyup was lost.
    key('keydown', 'ArrowUp');
    key('keyup', 'ArrowUp');
    assert.equal(controller.keys.forward, false);
  });
}

function advanceWithTouch(mode, strength, reverse) {
  const { controller, HANDLING } = keyboardHarness();
  const entity = { mode: mode.toLowerCase(), position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, halfExtents: { hx: 1, hz: 2 }, bodyHeight: 2 };
  if (mode === 'Person') Object.assign(entity, { verticalVel: 0, type: 'person' });
  if (mode === 'Car') Object.assign(entity, {
    type: 'car', top: 30, grip: 6, vx: 0, vz: 0, angularVel: 0, steerAngle: 0, steerCmd: 0, yawRate: 0,
    pitchVel: 0, rollVel: 0, heaveVel: 0, heaveY: 0, wheelSpin: 0, pedalF: 0, pedalB: 0, longAcc: 0,
    kerb: [0, 0], uniforms: { brake: { value: 0 } },
    chassisPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } }, wheels: []
  });
  if (mode === 'Car') Object.assign(entity, HANDLING.car);
  if (mode === 'Cyclist') Object.assign(entity, {
    type: 'cyclist', steer: 0, leanAngle: 0, leanPivot: { rotation: { z: 0 } },
    frontWheel: { rotation: { x: 0 } }, rearWheel: { rotation: { x: 0 } },
    pedalPhase: 0, crankPivot: { rotation: { x: 0 } }, pedals: [],
    wheels: [{ radius: 0.34, spin: { rotation: { x: 0 } }, group: { rotation: { y: 0 } } }]
  });
  if (mode === 'Helicopter') Object.assign(entity, {
    type: 'helicopter', verticalSpeed: 0, pitchAngle: 0, rollAngle: 0,
    tiltPivot: { rotation: { x: 0, z: 0 }, position: { y: 0 } }
  });
  controller.activeMode = mode.toLowerCase();
  controller.entities = { [mode.toLowerCase()]: entity };
  controller.getGroundHeight = () => 0;
  controller.resolveHorizontalCollision = () => {};
  controller.setTouchInput(reverse ? 'backward' : 'forward', strength);
  controller.setTouchInput(reverse ? 'right' : 'left', strength);
  if (mode === 'Helicopter') controller.setTouchInput(reverse ? 'down' : 'up', strength);
  controller[`update${mode}`](0.1, 0);
  return entity;
}

for (const mode of ['Person']) {
  test(`analog ${mode.toLowerCase()} input proportionally scales movement and turning`, () => {
    for (const reverse of [false, true]) {
      const full = advanceWithTouch(mode, 1, reverse);
      const partial = advanceWithTouch(mode, 0.4, reverse);
      assert.ok(Math.abs(partial.speed - full.speed * 0.4) < 1e-10, 'movement should scale with joystick strength');
      const turn = mode === 'Car' ? 'steerAngle' : 'heading';
      assert.ok(Math.abs(partial[turn] - full[turn] * 0.4) < 1e-10, 'turning should scale with joystick strength');
      if (mode === 'Helicopter') {
        assert.ok(Math.abs(partial.verticalSpeed - full.verticalSpeed * 0.4) < 1e-10);
      }
    }
  });
}

function teleportHarness(mode, colliders = []) {
  const harness = keyboardHarness();
  const { controller } = harness;
  const position = (x = 0, y = 0, z = 0) => ({ x, y, z, copy(p) { this.x = p.x; this.y = p.y; this.z = p.z; } });
  const pivot = () => ({ position: position(), rotation: { x: 0.1, y: 0, z: -0.2 } });
  const chase = { person: [4.3, 1.95], car: [6.9, 2.12], cyclist: [4.8, 2.05], helicopter: [11.4, 3.3] };
  const ent = {
    type: mode, mode, chaseDistance: chase[mode][0], chaseHeight: chase[mode][1],
    halfExtents: { hx: mode === 'person' ? 0.4 : 1, hz: mode === 'person' ? 0.4 : 2 }, bodyHeight: 2,
    position: position(400, mode === 'helicopter' ? 120 : 0, 400), heading: 1, speed: 20,
    mesh: pivot(), top: 30, grip: 6, kerb: [0, 0], uniforms: { brake: { value: 0 } },
    verticalVel: 5, vx: 3, vz: -4, angularVel: 2, steerAngle: 0.4, steerCmd: 0.4, yawRate: 0,
    pitchVel: 3, rollVel: 4, heaveY: 0.1, heaveVel: 2, chassisPivot: pivot(), pedalF: 1, pedalB: 0, longAcc: 0,
    lastCollisionSpark: { speed: 5 }, carState: { value: { x: 0 } }, wheelSpin: 1,
    wheels: [{ front: true, baseY: 0.3, group: { rotation: { y: 0.4 }, position: { y: 0.3 } }, steerPivot: { rotation: { y: 0.4 } }, tire: { rotation: { x: 0 } } }],
    leanAngle: 0.3, leanPivot: pivot(), pedalPhase: 0.7,
    frontWheel: { rotation: { x: 0 } }, rearWheel: { rotation: { x: 0 } },
    crankPivot: { rotation: { x: 0 } }, pedals: [],
    verticalSpeed: -8, pitchAngle: 0.2, rollAngle: -0.2, tiltPivot: pivot(),
    rig: { reset(...args) { this.resetArgs = args; } },
    crowd: { begin() {}, add() {}, end() {} }
  };
  controller.activeMode = mode;
  controller.entities = { [mode]: ent };
  controller.colliders = colliders;
  controller._colliderCells = null;
  controller.getGroundHeight = (x, z, mode) => mode === 'person' ? (x < 0 ? 1.24 : 0.22) : 0;
  return { ...harness, ent };
}

for (const mode of ['person']) {
  test(`${mode} teleport stops carried motion and updates its arrival pose immediately`, () => {
    const { controller, ent, key } = teleportHarness(mode);
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    controller.setTouchInput('left', 0.8);
    const result = controller.teleportActiveTo(30, 20, 0.7);
    assert.deepEqual({ ...result }, { x: 30, z: 20 }, 'an open destination is kept exactly');
    assert.equal(ent.heading, 0.7);
    assert.equal(ent.speed, 0);
    assert.equal(Object.values(controller.keys).some(Boolean), false);
    assert.equal(controller._pressedCodes.size, 0);
    assert.deepEqual([ent.mesh.position.x, ent.mesh.position.y, ent.mesh.position.z], [ent.position.x, ent.position.y, ent.position.z]);
    assert.equal(ent.mesh.rotation.y, 0.7);
    if (mode === 'person') {
      assert.equal(ent.verticalVel, 0);
      assert.equal(ent.position.y, 0.22);
      assert.deepEqual(ent.rig.resetArgs.slice(0, 3), [30, 20, 0.7]);
      assert.equal(ent.rig.resetArgs[3](ent.rig.resetArgs[4], 30, 20), 0.22);
    } else if (mode === 'car') {
      for (const field of ['vx', 'vz', 'angularVel', 'steerAngle', 'pitchVel', 'rollVel', 'heaveY', 'heaveVel']) assert.equal(ent[field], 0, field);
      assert.equal(ent.chassisPivot.rotation.x, 0);
      assert.equal(ent.chassisPivot.rotation.z, 0);
      assert.equal(ent.chassisPivot.position.y, 0);
      assert.equal(ent.wheels[0].group.rotation.y, 0);
      assert.equal(ent.lastCollisionSpark, null);
    } else if (mode === 'cyclist') {
      assert.equal(ent.leanAngle, 0);
      assert.equal(ent.leanPivot.rotation.z, 0);
    } else {
      for (const field of ['verticalSpeed', 'pitchAngle', 'rollAngle']) assert.equal(ent[field], 0, field);
      assert.equal(ent.tiltPivot.rotation.x, 0);
      assert.equal(ent.tiltPivot.rotation.z, 0);
      assert.equal(ent.tiltPivot.position.y, 0);
      assert.equal(ent.position.y, 120, 'keep the helicopter altitude when already above the minimum');
    }
    const before = [ent.position.x, ent.position.y, ent.position.z, ent.heading];
    controller[`update${mode[0].toUpperCase()}${mode.slice(1)}`](0.1, 0);
    assert.deepEqual([ent.position.x, ent.position.y, ent.position.z, ent.heading], before, 'the first neutral frame stays at the arrival');
  });
}



test('ground arrivals clamp to the world bounds while helicopters may remain above lower buildings', () => {
  const { controller, ent } = teleportHarness('person');
  const result = controller.teleportActiveTo(99999, 99999);
  assert.deepEqual({ ...result }, { x: 3698, z: 3598 }, 'clamped to the world bounds with a 2 m inset');
  controller.resolveHorizontalCollision(ent.position, 0.48, ent.position.y + 1);
  assert.deepEqual([ent.position.x, ent.position.z], [result.x, result.z]);

  const heli = teleportHarness('helicopter', [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30, maxY: 50 }]);
  heli.ent.position.y = 10;
  assert.deepEqual({ ...heli.controller.teleportActiveTo(0, 0) }, { x: 0, z: 0 });
  assert.equal(heli.ent.position.y, 92);
});

test('a displaced pedestrian samples ground and resets its feet at the resolved destination', () => {
  const { controller, ent } = teleportHarness('person', [{ minX: -4, maxX: 0, minZ: -10, maxZ: 10, maxY: 30 }]);
  assert.deepEqual({ ...controller.teleportActiveTo(-1, 0) }, { x: 3, z: 0 });
  assert.equal(ent.position.y, 0.22, 'the requested point was on the higher ground, but the clear arrival is lower');
  assert.deepEqual(ent.rig.resetArgs.slice(0, 2), [3, 0]);
});

test('failed or invalid teleports keep the current position and stop the player with bounded search', () => {
  const { controller, ent } = teleportHarness('car', [{ minX: -300, maxX: 300, minZ: -300, maxZ: 300, maxY: 500 }]);
  let checks = 0;
  const near = controller.nearColliders;
  controller.nearColliders = function (...args) { checks++; return near.apply(this, args); };
  assert.deepEqual({ ...controller.teleportActiveTo(0, 0) }, { x: 400, z: 400 });
  assert.ok(checks <= 2049, 'the search must be bounded even inside an enormous obstacle');
  assert.equal(ent.speed, 0);
  assert.equal(ent.vx, 0);
  assert.equal(ent.angularVel, 0);
  assert.deepEqual({ ...controller.teleportActiveTo(NaN, Infinity) }, { x: 400, z: 400 });
});


test('player clearance respects altitude and permits a ground arrival under an airborne helicopter', () => {
  const { controller, ent } = teleportHarness('person');
  const helicopter = teleportHarness('helicopter').ent;
  helicopter.position.x = helicopter.position.z = 0;
  helicopter.position.y = 120;
  controller.entities.helicopter = helicopter;
  assert.deepEqual({ ...controller.teleportActiveTo(0, 0) }, { x: 0, z: 0 });
  assert.equal(ent.position.y, 0.22);
  helicopter.position.y = 1;
  assert.notDeepEqual({ ...controller.teleportActiveTo(0, 0) }, { x: 0, z: 0 }, 'a helicopter parked at street level must be avoided');
});
