const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
// Exercise the production player snapshot & collision push without creating the WebGPU scene.
const snapshotSrc = source.match(/  function playerSnapshot\(entity, mode\) \{[\s\S]*?\n  \}/)?.[0];
const collideSrc = source.match(/  function collidePlayer\(v, entity\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(snapshotSrc, 'playerSnapshot is present');
assert.ok(collideSrc, 'collidePlayer is present');

function harness() {
  const killed = [];
  const player = { x: 0, z: 0, heading: Math.PI / 2, vx: 10, vz: 0, halfW: 0.95, halfL: 2.35, mode: 'car' };
  const context = {
    player,
    world: { groundHeight: () => 0 },
    sim: { kill: (v) => killed.push(v) },
    opts: {}
  };
  const { playerSnapshot, collidePlayer } = vm.runInNewContext(`
  ${snapshotSrc}
  ${collideSrc}
  ({ playerSnapshot, collidePlayer });
`, context);
  return { playerSnapshot, collidePlayer, player, killed, context };
}

function playerEntity(x, y, z, mode = 'car') {
  return { position: { x, y, z }, heading: Math.PI / 2, speed: 10, halfExtents: { hx: 0.95, hz: 2.35 } };
}

test('player snapshot: only grounded non-flying modes are seen by traffic', () => {
  const { playerSnapshot } = harness();
  assert.equal(playerSnapshot(null, 'car'), null);
  assert.equal(playerSnapshot(playerEntity(0, 0, 0), 'helicopter'), null);
  assert.equal(playerSnapshot(playerEntity(0, 0, 0), 'boat'), null);
  assert.equal(playerSnapshot(playerEntity(50, 7.6, 0), 'car'), null, 'too high above the ground');
  const pl = playerSnapshot(playerEntity(50, 0.22, 0), 'car');
  assert.ok(pl, 'sidewalk height still counts as on the ground');
  assert.equal(pl.x, 50);
  assert.equal(pl.halfW, 0.95);
  assert.equal(pl.halfL, 2.35);
  assert.ok(Math.abs(pl.vx - 10) < 1e-9 && Math.abs(pl.vz) < 1e-9, 'heading π/2 → +x');
});

test('traffic pushes a player out of its way, and recycles a vehicle spawned deep inside the player', () => {
  const h = harness();
  const entity = playerEntity(0, 0, 0, 'car');
  entity.mass = 1200;
  entity.speed = 0;
  const v = { x: 3.0, z: 0, yaw: 0, speed: 0, half: 2.4, halfW: 0.9, bus: false };
  h.collidePlayer(v, entity);
  const moved = Math.hypot(entity.position.x, entity.position.z);
  assert.ok(moved > 0.01 && moved <= 0.12 + 1e-9, `pushed a bounded ${moved.toFixed(3)} m`);
  assert.equal(h.killed.length, 0);

  const h2 = harness();
  const entity2 = playerEntity(0, 0, 0, 'car');
  entity2.mass = 1200;
  const deep = { x: 0, z: 0, yaw: 0, speed: 5, half: 2.4, halfW: 0.9, bus: false };
  h2.collidePlayer(deep, entity2);
  assert.equal(h2.killed.length, 1, 'deep overlap recycles the vehicle');
  assert.equal(entity2.position.x, 0, 'the player is not dragged along');
});
