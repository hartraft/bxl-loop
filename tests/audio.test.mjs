// tests/audio.test.mjs — the audio graph & mixing logic with a fake AudioContext (nothing is heard).
//   node --test tests/audio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext } from './helpers/fake-audio.mjs';
import { chimeSchedule, dueChime, brusselsTime } from '../js/audio/chimes.js';
import { createBrusselsAudio } from '../js/audio/brussels-audio.js';

const camAt = (x, y, z) => ({ matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] } }); // looks -z, right = +x

function rig(mode = 'car') {
  const ent = { position: { x: 0, y: 0, z: 0 }, heading: Math.PI, speed: 0, vx: 0, vz: 0 };
  const listeners = [];
  const controllers = { activeMode: mode, keys: {}, getActiveEntity: () => ent, addCollisionListener: (fn) => listeners.push(fn) };
  const traffic = { cars: [], peds: [] };
  const life = { boats: [], aircraft: [], helicopters: [], events: [] };
  let ctx = null;
  const audio = createBrusselsAudio({ controllers, traffic, life, world: { isWater: () => false, groundHeight: () => 0, districtAt: () => 'Dansaert' }, ctxFactory: () => (ctx = new FakeAudioContext()), autoUnlock: false, keys: false, button: false });
  audio.setMuted(false);
  audio.unlock();
  audio.rand = (() => { let a = 5; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  const step = (n = 1, cam = camAt(0, 3, 10)) => { for (let i = 0; i < n; i++) { ctx.advance(1 / 30); audio.update(1 / 30, cam); } };
  return { audio, ent, controllers, traffic, life, ctx: () => ctx, step, collide: (e) => listeners.forEach((f) => f(e)) };
}

test('carillon quarters: the right number of strokes per quarter, then the hour', () => {
  assert.equal(chimeSchedule(1).length, 4);
  assert.equal(chimeSchedule(2).length, 8);
  assert.equal(chimeSchedule(3).length, 12);
  const h = chimeSchedule(4, 3);
  assert.equal(h.filter((s) => s.bell !== 'BELL').length, 16);
  assert.equal(h.filter((s) => s.bell === 'BELL').length, 3);
  assert.equal(chimeSchedule(4, 12).filter((s) => s.bell === 'BELL').length, 12);
  // change 1 is G# F# E B; strokes in time order
  assert.deepEqual(chimeSchedule(1).map((s) => s.bell), ['G#', 'F#', 'E', 'B']);
  for (const q of [1, 2, 3, 4]) { const s = chimeSchedule(q, 7); for (let i = 1; i < s.length; i++) assert.ok(s[i].t > s[i - 1].t); }
  assert.equal(dueChime({ h: 12, m: 15, s: 1 }).quarter, 1);
  assert.equal(dueChime({ h: 12, m: 14, s: 50 }), null);
  assert.deepEqual([dueChime({ h: 15, m: 0, s: 0.5 }).quarter, dueChime({ h: 15, m: 0, s: 0.5 }).hour], [4, 3]);
  assert.equal(dueChime({ h: 0, m: 0, s: 0 }).hour, 12);
  // CEST: 11:00 UTC on 1 July is 13:00 in Brussels; CET in January
  assert.equal(brusselsTime(new Date('2026-07-01T11:00:00Z')).h, 13);
  assert.equal(brusselsTime(new Date('2026-01-15T11:00:00Z')).h, 12);
});

test('master chain, mute and volume', () => {
  const r = rig();
  const a = r.audio;
  assert.ok(a.ready);
  const master = a.core.out.master;
  a.setVolume(0.5);
  assert.equal(master.gain.target, 0.5);
  a.setMuted(true);
  assert.equal(master.gain.target, 0);
  a.setMuted(false);
  assert.equal(master.gain.target, 0.5);
  a.core.setHidden(true);
  assert.equal(master.gain.target, 0);
  a.core.setHidden(false);
  a.setVolume(0.8);
});

test('taxi engine: idles, revs with speed & throttle, changes gear; squeals when sliding', () => {
  const r = rig('car');
  r.step(10);
  const idle = r.audio.levels.engine, idleRpm = r.audio.levels.rpm;
  assert.ok(idle > 0.05 && idle < 0.4, `idle level ${idle}`);
  r.controllers.keys.forward = true;
  const rpms = [];
  for (let v = 0; v < 20; v += 0.5) { r.ent.speed = v; r.step(3); rpms.push(r.audio.levels.rpm); }
  const loud = r.audio.levels.engine;
  assert.ok(loud > idle * 1.3, `engine louder under load (${idle.toFixed(3)} → ${loud.toFixed(3)})`);
  assert.ok(Math.max(...rpms) > idleRpm * 2.5, 'revs rise');
  let drops = 0;
  for (let i = 1; i < rpms.length; i++) if (rpms[i] < rpms[i - 1] - 150) drops++;
  assert.ok(drops >= 2, `upshifts heard (${drops})`);
  // a sideways slide
  r.ent.vx = 5; r.ent.speed = 12;
  r.step(5);
  assert.ok(r.audio.levels.squeal > 0.5, `squeal ${r.audio.levels.squeal}`);
  const sq = r.audio.v.squeal.gain.gain.target;
  assert.ok(sq > 0.1, `squeal gain ${sq}`);
  r.ent.vx = 0; r.step(5);
  assert.ok(r.audio.v.squeal.gain.gain.target < 0.02, 'squeal stops');
});

test('every player mode builds and updates its voices without errors', () => {
  const r = rig('car');
  for (const m of ['person', 'car', 'ride', 'bus', 'cyclist', 'helicopter', 'boat', 'person']) {
    r.controllers.activeMode = m;
    r.ent.speed = 0; r.step(4);
    r.controllers.keys.forward = true; r.ent.speed = m === 'helicopter' ? 30 : 6; r.step(30);
    r.controllers.keys.forward = false; r.step(30);
    r.audio.horn(true); r.step(2); r.audio.horn(false);
  }
  // footsteps and freewheel clicks are one-shots
  assert.ok(r.audio.stats.oneShots > 10, `one-shots ${r.audio.stats.oneShots}`);
});

test('traffic pass-bys follow the nearest vehicles: panned to their side, louder when close', () => {
  const r = rig('person');
  const car = { id: 1, type: 'saloon', x: 30, y: 0, z: 10, yaw: -Math.PI / 2, speed: 10, acc: 0 }; // to the right, driving west
  r.traffic.cars.push(car, { id: 2, type: 'bus', bus: true, x: -60, y: 0, z: 10, yaw: 0, speed: 0, acc: 0 });
  r.step(3);
  const pb = r.audio.passby.find((p) => p.id === 1);
  assert.ok(pb, 'a voice follows the car');
  const far = pb.v.gain.gain.target;
  assert.ok(pb.v.pan.pan.target > 0.3, `panned right (${pb.v.pan.pan.target})`);
  car.x = 6; r.step(3);
  const near = pb.v.gain.gain.target;
  assert.ok(near > far * 3, `louder when close (${far.toFixed(4)} → ${near.toFixed(4)})`);
  car.x = 400; r.step(3);
  assert.equal(pb.id, -1, 'voice released when the car has gone');
  assert.ok(r.audio.levels.hum > 0.04, 'city hum');
});

test('collisions thump, crowds murmur, the carillon rings, sirens come and go, life events play', () => {
  const r = rig('car');
  r.step(2);
  const before = r.ctx().count('osc');
  r.collide({ impulse: 9, mode: 'car', x: 0, z: 0 });
  assert.ok(r.ctx().count('osc') > before, 'thud built oscillators');
  assert.equal(r.audio.levels.lastHit, 9);
  for (let i = 0; i < 30; i++) r.traffic.peds.push({ alive: true, x: (i % 6) * 3, z: Math.floor(i / 6) * 3 });
  r.step(10);
  assert.ok(r.audio.levels.crowd > 0.08, `crowd ${r.audio.levels.crowd}`);
  const o0 = r.ctx().count('osc');
  r.audio.chime(4, 3);
  assert.ok(r.ctx().count('osc') - o0 > 19 * 9, 'bells: partials for 19 strokes');
  assert.ok(r.audio.levels.chime.delay > 1, 'the great bell heard after the speed of sound delay');
  r.audio.timers.siren = 0; r.step(2);
  assert.equal(r.audio.levels.sirens, 1);
  r.audio.sirens[0].age = 999; r.step(1);
  assert.equal(r.audio.levels.sirens, 0, 'siren gone');
  r.life.events.push({ type: 'scatter', x: 3, z: 0, n: 20 }, { type: 'horn', x: 50, z: 0 });
  r.life.aircraft.push({ x: 0, y: 900, z: 0 });
  r.step(2);
  assert.equal(r.life.events.length, 0, 'events drained');
  assert.ok(r.audio.levels.jet > 0.05, `jet ${r.audio.levels.jet}`);
  for (const id of ['busBell', 'busDoorsOpen', 'busDoorsClose', 'notify', 'coin']) assert.ok(r.audio.play(id), id);
  assert.equal(r.audio.play('nope'), false);
});

test('cost: an update (30 Hz tick) stays cheap', () => {
  const r = rig('car');
  for (let i = 0; i < 200; i++) r.traffic.cars.push({ id: i, type: i % 9 ? 'hatch' : 'bus', x: (i % 20) * 12 - 120, y: 0, z: Math.floor(i / 20) * 15 - 70, yaw: i, speed: i % 7, acc: 0.5 });
  for (let i = 0; i < 260; i++) r.traffic.peds.push({ alive: true, x: (i % 26) * 4 - 50, z: Math.floor(i / 26) * 6 - 30 });
  r.controllers.keys.forward = true; r.ent.speed = 8;
  r.step(30);
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) r.step(1);
  const ms = (performance.now() - t0) / 300;
  console.log(`audio update ${ms.toFixed(3)} ms (fake context), live nodes ${r.ctx().live}`);
  assert.ok(ms < 3, `update ${ms} ms`); // ~0.2 ms on an idle machine; generous for a loaded CI box
});
