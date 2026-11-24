const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
let TELEPORT_LOCATIONS, BRUSSELS_LANDMARKS, WORLD;
test.before(async () => {
  ({ TELEPORT_LOCATIONS, BRUSSELS_LANDMARKS, WORLD } = await import('../js/brussels-config.js'));
});

test('every teleport button has a destination on a real Brussels roadway', () => {
  const buttons = [...read('index.html').matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(Object.keys(TELEPORT_LOCATIONS).sort(), buttons.sort());
  for (const [name, point] of Object.entries(TELEPORT_LOCATIONS)) {
    assert.ok(Number.isFinite(point.heading), `${name} has a heading`);
    assert.ok(!WORLD.isWater(point.x, point.z), `${name} is not in the canal`);
    const hit = WORLD.nearestRoad(point.x, point.z, { kinds: 'drive', maxDist: 80 });
    assert.ok(hit, `${name} is near a road`);
    assert.ok(hit.dist < hit.road.w / 2 + 2, `${name} lands within a street's width`);
  }
});

test('the Palace of Justice teleport arrives on Place Poelaert facing the landmark', () => {
  const point = TELEPORT_LOCATIONS.palaisDeJustice;
  const landmark = BRUSSELS_LANDMARKS.find((l) => l.id === 'palaisDeJustice');
  assert.ok(point && landmark);
  const hit = WORLD.nearestRoad(point.x, point.z, { named: true, maxDist: 40 });
  assert.ok(hit, 'arrives next to a named street by Place Poelaert');
  const distance = Math.hypot(landmark.x - point.x, landmark.z - point.z);
  assert.ok(distance > 60 && distance < 400, 'leave space for the landmark view');
  const alignment = ((landmark.x - point.x) * Math.sin(point.heading) + (landmark.z - point.z) * Math.cos(point.heading)) / distance;
  assert.ok(alignment > 0.9, 'face the Palace of Justice');
});

test('preset and map teleports share arrival resets and mark the resolved landing point', () => {
  const main = read('js/main.js');
  const start = main.indexOf('  function teleportTo(');
  const end = main.indexOf('\n  }\n', start) + 4;
  assert.ok(start >= 0 && end > start, 'teleportTo is present in main.js');
  const calls = [];
  const landed = { x: 12.5, z: -340.2 };
  const mapSystem = { waypoint: null };
  const environment = {
    controllerManager: { teleportActiveTo: (...args) => { calls.push(['teleport', ...args]); return landed; } },
    touchControls: { reset: () => calls.push(['touch']) },
    gamepadControls: { reset: () => calls.push(['gamepad']) },
    cameraSystem: { resetForTeleport: () => calls.push(['camera']) },
    selectCamera: (...args) => calls.push(['selectCamera', ...args]),
    getLocationLabel: (x, z) => ({ text: `${x}, ${z}` }),
    mapSystem
  };
  const teleportTo = vm.runInNewContext(`${main.slice(start, end)}\nteleportTo;`, environment);
  const point = TELEPORT_LOCATIONS.grandPlace;
  const result = teleportTo(point.x, point.z, point.heading);
  assert.deepEqual(calls, [
    ['teleport', point.x, point.z, point.heading], ['touch'], ['gamepad'], ['camera'], ['selectCamera', 'chase', true]
  ]);
  assert.equal(result, landed);
  assert.equal(mapSystem.waypoint.x, landed.x);
  assert.equal(mapSystem.waypoint.z, landed.z);
  assert.equal(mapSystem.waypoint.name, `${landed.x}, ${landed.z}`);
});
