// js/audio/brussels-base-audio.js — Workstream L: the sound of Brussels Loop. Everything synthesised in WebAudio.
//
//   import { createBrusselsAudio } from './audio/brussels-base-audio.js';
//   const audio = createBrusselsAudio({ controllers, traffic, life, lighting, world, geo, landmarks, cameraSystem, night });
//   audio.update(dt, camera);                 // every frame (cheap: parameter updates at ≤ 30 Hz)
//   audio.play('busBell');                    // cues: busBell busDoorsOpen busDoorsClose kneel airBrake notify coin cancel bikeBell whistle click
//   audio.horn(true/false) (key G); audio.toggleMute() (key K); audio.setVolume(0..1); audio.chime(quarter?)  (test the bells)
//
// - Starts on the first user gesture (pointer / key / touch); suspends while the tab is hidden or muted.
// - Player: per-mode engines (black cab diesel clatter + autobox, RideBXL hybrid whine, bus diesel + air brakes, hire
//   bike freewheel + tyre/wind, helicopter rotor thump + turbine, river boat diesel + wash + slaps, footsteps on foot),
//   tyre squeal from the cab's sideways slip / handbrake, horn (G), collision thuds (controllers' collision listener).
// - World: traffic hum + pass-bys of the nearest traffic (panned, Doppler), crowd babble that follows the pavement
//   crowd and landmarks, birds in parks (by day), gulls and lapping water near the Thames, rain in drizzle, wind aloft,
//   distant sirens now and then, river boats and their horns, aircraft overhead, the odd helicopter, pigeons taking
//   off, and Big Ben: the Westminster Quarters on the quarter hours and the hour strike in real Brussels time (delayed
//   by the speed of sound and muffled by distance).
import { AudioCore, clamp, spatial } from './audio-core.js';
import { later, EngineVoice, RotorVoice, NoiseBed, SirenVoice, CrowdVoice, HornVoice, SquealVoice, bell, thud, footstep, tick, bird, flutter, slap, shipHorn, cue, CUES } from './synth.js';
import { chimeSchedule, brusselsTime, dueChime } from './chimes.js';
import { toWorld, LANDMARK_ANCHORS } from '../geo-frame.js';

const SOUND = 343;
const PASSBY_VOICES = 4;
const TICK = 1 / 30;

// gearing in m/s per 1000 rpm, idle / redline rpm, cylinders
const PROFILES = {
  car: { kind: 'diesel', idle: 780, red: 4300, cyl: 4, gears: [2.2, 3.9, 5.9, 8.0, 10.5], up: 2700, cut: 820, clatter: 0.75, clatterHz: 2100, level: 0.24 },
  ride: { kind: 'hybrid', idle: 900, red: 5600, cyl: 4, gears: [2.6, 4.6, 6.8, 9.2, 11.8], up: 3000, cut: 1300, clatter: 0.12, clatterHz: 2600, level: 0.17, wave: 'triangle' },
  bus: { kind: 'bus', idle: 620, red: 2400, cyl: 6, gears: [1.5, 2.7, 4.2, 6.1], up: 1900, cut: 620, clatter: 0.55, clatterHz: 1500, level: 0.3 },
  boat: { kind: 'boat', idle: 640, red: 2200, cyl: 6, gears: [6.5], up: 9999, cut: 480, clatter: 0.35, clatterHz: 1200, level: 0.28 }
};

export function createBrusselsAudio(opts = {}) {
  return new BrusselsAudio(opts);
}

export class BrusselsAudio {
  constructor(opts = {}) {
    this.o = opts;
    this.core = new AudioCore({ ctxFactory: opts.ctxFactory, volume: readPref('vol', 0.8), muted: readPref('muted', false) });
    this.rand = Math.random;
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0, fx: 0, fz: -1, vx: 0, vz: 0, groundY: 0 };
    this.acc = 0;
    this.t = 0;
    this.mode = null;
    this.v = null; // player voices
    this.passby = [];
    this.timers = { bird: 2, gull: 6, slap: 1, drip: 0.5, coo: 4, siren: 40 + Math.random() * 60, probe: 0, step: 0, tick: 0 };
    this.sirens = [];
    this.lastChime = null;
    this.hornOn = false;
    this.levels = {}; // last computed levels (debug / tests): audio.levels
    this.stats = { updates: 0, ms: 0, oneShots: 0 };
    this.probe = { water: 0, park: false, landmark: 0, alt: 0, lastX: Infinity, lastZ: Infinity };
    this._prevSpeed = 0;
    this._lastHit = -1;
    this.parks = prepParks(opts.geo);
    this.landmarks = (opts.landmarks || []).map((l) => ({ x: l.x, z: l.z, r: l.r || 80, id: l.id }));
    this.bigBen = opts.bigBen || toWorld(LANDMARK_ANCHORS.bigBen.lat, LANDMARK_ANCHORS.bigBen.lon); // Elizabeth Tower
    this.weather = 'clear';
    if (opts.lighting) {
      this.weather = opts.lighting.weather || 'clear';
      if (opts.lighting.onWeatherChange) opts.lighting.onWeatherChange((id) => { this.weather = id; });
    }
    if (opts.controllers && opts.controllers.addCollisionListener) opts.controllers.addCollisionListener((e) => this.onCollision(e));
    if (opts.autoUnlock !== false && typeof window !== 'undefined') this._bindGesture();
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => this.core.setHidden(document.hidden));
    }
    if (opts.keys !== false && typeof window !== 'undefined') this._bindKeys(opts.keys || {});
    if (opts.button !== false && typeof document !== 'undefined') this._mountButton(opts.buttonParent);
    this.core.onReady(() => this._buildBeds());
  }

  // ---------------------------------------------------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------------------------------------------------
  get ready() { return this.core.ready; }
  get muted() { return this.core.muted; }
  unlock() { return this.core.unlock(); }
  setMuted(m) { this.core.setMuted(m); writePref('muted', !!m); this._syncButton(); }
  toggleMute() { this.setMuted(!this.core.muted); return this.core.muted; }
  setVolume(v) { this.core.setVolume(v); writePref('vol', this.core.volume); }
  /** one-shot cue by name (see CUES). opts: {x, z} to place it in the world (else it plays at the listener) */
  play(name, o = {}) {
    if (!this.core.ready) return false;
    const out = this.core.out[o.bus || (name === 'notify' || name === 'coin' || name === 'cancel' || name === 'click' ? 'ui' : 'sfx')];
    let pan = 0, gain = o.gain ?? 1;
    if (o.x !== undefined) { const s = spatial(this.listener, o.x, o.y ?? this.listener.y, o.z, 14); pan = s.pan; gain *= s.gain; }
    if (name === 'horn') { this.horn(true); later(() => this.horn(false), (o.duration || 0.5) * 1000); return true; }
    if (name === 'shipHorn') { shipHorn(this.core, out, { gain: 0.35 * gain, pan }); return true; }
    if (!CUES.includes(name)) return false;
    cue(this.core, out, name, { pan, gain });
    this.stats.oneShots++;
    return true;
  }
  /** hold / release the horn of whatever the player is driving */
  horn(on) {
    this.hornOn = !!on;
    if (!this.core.ready) return;
    const m = this.mode;
    if (on) {
      if (m === 'cyclist') return this.play('bikeBell');
      if (m === 'boat') return this.play('shipHorn');
      if (m === 'person') return this.play('whistle');
      if (m === 'helicopter') return;
    }
    if (this.v && this.v.horn) this.v.horn.set(!!on);
  }
  /** ring the bells now (quarter 1–4; default the latest quarter) — for testing */
  chime(quarter = null, hour = null) {
    const t = brusselsTime();
    this._ringChime(quarter || (Math.floor(t.m / 15) || 4), hour || (t.h % 12 || 12), true);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // frame
  // ---------------------------------------------------------------------------------------------------------------
  update(dt, camera) {
    if (!this.core.ready || this.core.muted || this.core.hidden) return;
    this.acc += dt;
    if (this.acc < TICK) return;
    const step = Math.min(this.acc, 0.25);
    this.acc = 0;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.t += step;
    this._listen(camera, step);
    this._player(step);
    this._world(step);
    this.stats.updates++;
    if (t0) this.stats.ms = this.stats.ms * 0.95 + (performance.now() - t0) * 0.05;
  }

  _listen(camera, dt) {
    const L = this.listener;
    if (camera && camera.matrixWorld) {
      const e = camera.matrixWorld.elements;
      const nx = e[12], nz = e[14];
      L.vx = (nx - L.x) / Math.max(dt, 1e-3); L.vz = (nz - L.z) / Math.max(dt, 1e-3);
      if (Math.hypot(L.vx, L.vz) > 300) L.vx = L.vz = 0; // teleport
      L.x = nx; L.y = e[13]; L.z = nz;
      const rl = Math.hypot(e[0], e[2]) || 1;
      L.rx = e[0] / rl; L.rz = e[2] / rl;
      L.fx = -e[8]; L.fz = -e[10];
    }
    const w = this.o.world;
    L.groundY = w && w.groundHeight ? w.groundHeight(L.x, L.z, 'drive') : 0;
    // what's around: water, parks, landmarks (re-probed every 0.5 s or after 25 m)
    this.timers.probe -= dt;
    if (this.timers.probe <= 0 || Math.hypot(L.x - this.probe.lastX, L.z - this.probe.lastZ) > 25) {
      this.timers.probe = 0.5;
      this.probe.lastX = L.x; this.probe.lastZ = L.z;
      this.probe.water = waterFraction(w, L.x, L.z);
      this.probe.park = inPark(this.parks, L.x, L.z);
      let lm = 0;
      for (const l of this.landmarks) { const d = Math.hypot(l.x - L.x, l.z - L.z); lm = Math.max(lm, clamp(1 - d / (l.r * 2.2), 0, 1)); }
      this.probe.landmark = lm;
      this.probe.district = w && w.districtAt ? w.districtAt(L.x, L.z) : '';
    }
    this.probe.alt = Math.max(0, L.y - L.groundY);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the player's vehicle
  // ---------------------------------------------------------------------------------------------------------------
  _player(dt) {
    const C = this.o.controllers;
    if (!C) return;
    const mode = C.activeMode;
    const ent = C.getActiveEntity ? C.getActiveEntity() : null;
    if (!ent) return;
    if (mode !== this.mode) this._switchMode(mode);
    const V = this.v;
    const k = C.keys || {};
    const num = (x) => (x === true ? 1 : +x || 0);
    const fwd = num(k.forward), back = num(k.backward);
    const sp = Math.abs(ent.speed || 0);
    const L = this.listener;
    // the player's position relative to the listener (chase camera ~8–30 m behind)
    const s = spatial(L, ent.position.x, ent.position.y + 1, ent.position.z, 22, 0.6);
    const near = clamp(s.gain * 1.15, 0.25, 1);
    const pan = s.pan * 0.5;
    const wet = this._wet();
    const P = PROFILES[mode === 'ride' ? 'ride' : mode === 'bus' ? 'bus' : mode === 'boat' ? 'boat' : 'car'];
    if (mode === 'car' || mode === 'ride' || mode === 'bus' || mode === 'boat') {
      const throttle = sp < 0.5 && back > 0 ? back : fwd > 0 ? fwd : back > 0 && (ent.speed || 0) < 0.3 ? back : 0;
      const rpm = this._rpm(P, sp, throttle, dt, k.boost);
      const load = clamp(throttle * 0.8 + (k.boost ? 0.2 : 0), 0, 1);
      const r01 = (rpm - P.idle) / (P.red - P.idle);
      const hz = (rpm / 60) * (P.cyl / 2);
      let level = P.level * (0.55 + 0.25 * load + 0.35 * r01) * near;
      let whine = 0, whineHz = 0;
      if (P.kind === 'hybrid') {
        // electric below ~25 mph unless pressing on: the petrol engine fades in
        const ice = clamp((sp - 9) / 4, 0, 1) * 0.8 + load * 0.6 * clamp(sp / 6, 0, 1);
        level *= clamp(ice, 0.08, 1);
        whine = clamp(0.25 + sp / 18, 0, 1) * (0.5 + load * 0.6);
        whineHz = 240 + sp * 62;
      } else if (P.kind === 'bus') { whine = clamp(r01 * load, 0, 1) * 0.6; whineHz = 2600 + r01 * 2500; }
      else if (P.kind === 'diesel') { whine = clamp(r01 * load, 0, 1) * 0.35; whineHz = 3100 + r01 * 3500; }
      const washBase = P.kind === 'boat' ? clamp(sp / 9, 0, 1.2) * 1.1 : clamp(sp / 22, 0, 1) * (wet ? 1.2 : 0.75);
      V.engine.update({
        hz, level, load, clatter: P.clatter * (0.6 + 0.4 * (1 - r01)), cut: P.cut, whine, whineHz,
        wash: washBase * near, washCut: P.kind === 'boat' ? 700 + sp * 60 : (wet ? 2600 : 520) + sp * 45, pan
      });
      // tyre squeal: sideways slip / handbrake / locking up
      if (V.squeal) {
        const slip = Math.hypot(ent.vx || 0, ent.vz || 0);
        const hb = k.up && sp > 4 ? 0.35 : 0;
        const lock = back > 0 && (ent.speed || 0) > 9 ? 0.18 : 0;
        const lvl = clamp((slip - 1.4) / 4.5, 0, 1) + hb + lock;
        V.squeal.update(clamp(lvl, 0, 1) * near * (sp > 2 ? 1 : 0), wet);
        this.levels.squeal = lvl;
      }
      // bus air brakes when it comes to a stand
      if (P.kind === 'bus' && this._prevSpeed > 2.2 && sp < 0.4) this.play('airBrake', { gain: 0.8 * near });
      // the drivable bus's doors (controllers.setBusDoors) and kneeling, heard without any extra hook
      if (P.kind === 'bus') {
        const doors = !!ent.doorsOpen;
        if (this._doors !== undefined && doors !== this._doors) this.play(doors ? 'busDoorsOpen' : 'busDoorsClose', { gain: near });
        this._doors = doors;
        const kneel = (ent.kneel || 0) > 0.05;
        if (kneel && !this._kneel) this.play('kneel', { gain: 0.6 * near });
        this._kneel = kneel;
      }
      if (P.kind === 'boat') {
        this.timers.slap -= dt * (1 + sp * 0.25);
        if (this.timers.slap <= 0) { this.timers.slap = 0.35 + this.rand() * 1.1; slap(this.core, this.core.out.engine, { gain: (0.1 + sp * 0.02) * near, pan: (this.rand() - 0.5) * 1.2 }); }
      }
      this.levels.engine = level; this.levels.rpm = rpm;
    } else if (mode === 'cyclist') {
      // tyre hum + wind; freewheel ticking when coasting, chain whirr when pedalling
      V.wash.set(clamp(sp / 9, 0, 1) * 0.16 * near, 0.08, 500 + sp * 80);
      V.wind.set(clamp((sp - 3) / 8, 0, 1) * 0.08, 0.12);
      const coasting = fwd === 0 && sp > 1;
      if (coasting) {
        this.timers.tick -= dt;
        const rate = 6 + sp * 3.2; // audible pawl clicks / s (the real ratchet is faster; this reads better)
        while (this.timers.tick <= 0) { this.timers.tick += 1 / rate; tick(this.core, this.core.out.engine, { gain: 0.05 * near, f: 3800 + this.rand() * 900, pan }); }
      }
      V.chain.set(fwd > 0 && sp > 0.5 ? clamp(sp / 8, 0, 1) * 0.05 * near : 0, 0.1, 1800 + sp * 120);
      this.levels.engine = sp;
    } else if (mode === 'helicopter') {
      const vy = ent.verticalSpeed ?? ent.verticalVel ?? 0;
      const climb = clamp(vy / 8, -1, 1);
      // "Doppler-ish": blade slap deepens and the pitch shifts slightly with the helicopter's speed toward the camera
      const dx = ent.position.x - L.x, dz = ent.position.z - L.z, d = Math.hypot(dx, dz) || 1;
      const hv = { x: Math.sin(ent.heading || 0) * (ent.speed || 0), z: Math.cos(ent.heading || 0) * (ent.speed || 0) };
      const vr = -(hv.x * dx + hv.z * dz) / d + (L.vx * dx + L.vz * dz) / d;
      const dop = clamp(SOUND / (SOUND - vr), 0.85, 1.18);
      const rate = (12.5 + clamp(sp / 40, 0, 1) * 1.2 + Math.max(0, climb) * 0.8) * dop;
      V.rotor.update({ rate, level: 0.34 * near, slap: clamp(0.3 + sp / 50 + Math.abs(climb) * 0.3, 0, 1), whine: 0.6, pan, cut: 360 + sp * 4 });
      V.wind.set(clamp(sp / 45, 0, 1) * 0.06, 0.2);
      this.levels.engine = rate;
    } else if (mode === 'person') {
      // footsteps at the walking / running cadence
      const grounded = !ent.verticalVel || Math.abs(ent.verticalVel) < 0.5;
      if (sp > 0.4 && grounded) {
        const cadence = sp > 5 ? 2.9 : 1.5 + sp * 0.28;
        this.timers.step -= dt * cadence;
        if (this.timers.step <= 0) { this.timers.step += 1; footstep(this.core, this.core.out.engine, { gain: (0.1 + sp * 0.025) * near, wet, run: sp > 5, pan: pan + (this.rand() - 0.5) * 0.1 }); this.stats.oneShots++; }
      } else this.timers.step = 0.3;
      this.levels.engine = sp;
    }
    this._prevSpeed = sp;
    // the cab's cabin muffles the city in POV
    const cs = this.o.cameraSystem;
    const pov = cs && cs.activePresetId === 'pov' && (mode === 'car' || mode === 'ride' || mode === 'bus');
    this.core.out.cabin.frequency.setTargetAtTime(pov ? 2400 : 18000, this.core.now, 0.15);
  }

  _rpm(P, sp, throttle, dt, boost) {
    const st = this._eng || (this._eng = { gear: 0, rpm: P.idle });
    const g = P.gears;
    const up = P.up + throttle * (P.red - P.up) * 0.55 + (boost ? 400 : 0);
    const rpmAt = (gi) => (sp / g[gi]) * 1000;
    while (st.gear < g.length - 1 && rpmAt(st.gear) > up) st.gear++;
    while (st.gear > 0 && rpmAt(st.gear) < P.idle * 1.35) st.gear--;
    let target = Math.max(P.idle, rpmAt(st.gear));
    if (sp < 1.5) target = P.idle + throttle * (P.red - P.idle) * 0.35; // pulling away: clutch / torque converter slip
    target = Math.min(target, P.red);
    st.rpm += (target - st.rpm) * Math.min(1, dt * (target > st.rpm ? 6 : 4));
    return st.rpm;
  }

  _switchMode(mode) {
    if (this.v) for (const v of Object.values(this.v)) v && v.stop && v.stop();
    this.v = null;
    this._eng = null;
    this.mode = mode;
    const core = this.core, out = core.out.engine;
    const V = {};
    if (mode === 'car' || mode === 'ride' || mode === 'bus' || mode === 'boat') {
      const P = PROFILES[mode === 'ride' ? 'ride' : mode];
      V.engine = new EngineVoice(core, out, { wave: P.wave || 'sawtooth', cut: P.cut, clatterHz: P.clatterHz, wash: mode === 'boat' ? 'brown' : 'pink', washCut: 700 });
      if (mode !== 'boat') V.squeal = new SquealVoice(core, core.out.sfx);
      V.horn = mode === 'bus' ? new HornVoice(core, core.out.sfx, { f1: 277, f2: 349, bp: 800, level: 0.4 })
        : mode === 'ride' ? new HornVoice(core, core.out.sfx, { f1: 415, f2: 523, bp: 1400, level: 0.3 })
          : mode === 'car' ? new HornVoice(core, core.out.sfx, { f1: 370, f2: 466, bp: 1100, level: 0.34 }) : null;
    } else if (mode === 'cyclist') {
      V.wash = new NoiseBed(core, out, { kind: 'pink', type: 'lowpass', freq: 600 });
      V.wind = new NoiseBed(core, out, { kind: 'pink', type: 'bandpass', freq: 380, q: 0.6 });
      V.chain = new NoiseBed(core, out, { kind: 'white', type: 'bandpass', freq: 2000, q: 3 });
    } else if (mode === 'helicopter') {
      V.rotor = new RotorVoice(core, out);
      V.wind = new NoiseBed(core, out, { kind: 'pink', type: 'bandpass', freq: 420, q: 0.6 });
    }
    this.v = V;
    if (this.hornOn && V.horn) V.horn.set(true);
  }

  onCollision(e) {
    if (!this.core.ready || this.core.muted) return;
    const now = this.t;
    const imp = e.impulse || 0;
    if (now - this._lastHit < 0.12 && imp < (this._lastImp || 0) * 1.5) return;
    this._lastHit = now; this._lastImp = imp;
    const m = e.mode || this.mode;
    const kind = m === 'person' ? 'person' : m === 'cyclist' ? 'bike' : m === 'boat' ? 'boat' : 'car';
    let pan = 0;
    if (e.x !== undefined) pan = spatial(this.listener, e.x, this.listener.y, e.z, 20).pan * 0.6;
    thud(this.core, this.core.out.sfx, { impulse: imp, kind, pan });
    this.stats.oneShots++;
    this.levels.lastHit = imp;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the city around
  // ---------------------------------------------------------------------------------------------------------------
  _buildBeds() {
    const core = this.core, A = core.out.amb, W = core.out.world;
    this.beds = {
      hum: new NoiseBed(core, A, { kind: 'brown', type: 'lowpass', freq: 240, q: 0.6 }),
      hiss: new NoiseBed(core, A, { kind: 'pink', type: 'bandpass', freq: 900, q: 0.5 }),
      river: new NoiseBed(core, A, { kind: 'brown', type: 'lowpass', freq: 620, q: 0.9, rate: 0.9 }),
      rain: new NoiseBed(core, A, { kind: 'pink', type: 'highpass', freq: 900, q: 0.5, type2: 'lowpass', freq2: 7000 }),
      wind: new NoiseBed(core, A, { kind: 'pink', type: 'bandpass', freq: 340, q: 0.5 }),
      jet: new NoiseBed(core, W, { kind: 'brown', type: 'lowpass', freq: 300, q: 0.7, pan: true }),
      jetWhine: new NoiseBed(core, W, { kind: 'pink', type: 'bandpass', freq: 1700, q: 1.5, pan: true })
    };
    this.crowd = new CrowdVoice(core, A, 4, this.rand);
    for (let i = 0; i < PASSBY_VOICES; i++) {
      this.passby.push({ id: -1, v: new EngineVoice(core, W, { cut: 700, clatterHz: 1900, wash: 'pink', washCut: 900 }), age: 0 });
    }
    this.boatVoice = new EngineVoice(core, W, { cut: 420, clatterHz: 1100, wash: 'brown', washCut: 600 });
    this.heliVoice = null;
  }

  _wet() {
    const L = this.o.lighting;
    return (L && L.weather ? L.weather : this.weather) === 'drizzle';
  }
  _night() { try { return clamp(this.o.night ? this.o.night() : 0, 0, 1); } catch { return 0; } }

  _world(dt) {
    if (!this.beds) return;
    const L = this.listener, core = this.core, B = this.beds;
    const night = this._night();
    const alt = this.probe.alt;
    const altK = 1 / (1 + Math.max(0, alt - 15) / 70);
    const rain = this._wet();
    // ---- traffic hum + pass-bys
    const T = this.o.traffic;
    const cars = (T && T.cars) || [];
    let w = 0;
    const cand = [];
    for (const v of cars) {
      const dx = v.x - L.x, dz = v.z - L.z;
      if (Math.abs(dx) > 160 || Math.abs(dz) > 160) continue;
      const d = Math.hypot(dx, dz, (v.y || 0) - L.y);
      w += (0.4 + Math.min(1, v.speed / 8)) / (1 + d / 35);
      if (d < 75) cand.push({ v, d });
    }
    const humLevel = (0.045 + clamp(w / 10, 0, 1) * 0.2) * altK * (1 - night * 0.35);
    B.hum.set(humLevel, 0.5);
    B.hiss.set(humLevel * (rain ? 0.9 : 0.35), 0.5, rain ? 1500 : 900);
    this.levels.hum = humLevel;
    cand.sort((a, b) => a.d - b.d);
    const top = cand.slice(0, PASSBY_VOICES);
    // keep voices on the vehicles they already follow; give free voices to new ones
    for (const pb of this.passby) if (pb.id >= 0 && !top.some((c) => c.v.id === pb.id && c.v.type === pb.type)) { pb.id = -1; pb.v.silence(0.25); }
    for (const c of top) {
      let pb = this.passby.find((p) => p.id === c.v.id && p.type === c.v.type);
      if (!pb) { pb = this.passby.find((p) => p.id < 0); if (!pb) continue; pb.id = c.v.id; pb.type = c.v.type; }
      const v = c.v;
      const s = spatial(L, v.x, (v.y || 0) + 1, v.z, 9, 1);
      const vx = Math.sin(v.yaw) * v.speed, vz = Math.cos(v.yaw) * v.speed;
      const dx = v.x - L.x, dz = v.z - L.z, d = Math.max(1, s.d);
      const vr = -(vx * dx + vz * dz) / d + (L.vx * dx + L.vz * dz) / d; // + = closing
      const dop = clamp(SOUND / (SOUND - vr), 0.8, 1.25);
      const bus = v.type === 'bus' || v.bus, van = v.type === 'van', cab = v.type === 'cab';
      const sp = v.speed;
      // pseudo gearbox: firing frequency saws up and drops with each change
      const gearSpan = bus ? 3.2 : 4.2;
      const inGear = (sp % gearSpan) / gearSpan;
      const baseHz = bus ? 30 : van ? 34 : cab ? 30 : 38;
      const hz = (baseHz + inGear * (bus ? 30 : 55) + Math.min(sp, 15) * 2) * dop;
      const accel = clamp((v.acc || 0) / 2.5, 0, 1);
      const level = s.gain * (bus ? 0.5 : van ? 0.36 : 0.3) * (0.3 + accel * 0.4 + clamp(sp / 12, 0, 1) * 0.4) * (1 - clamp((alt - 30) / 80, 0, 0.9));
      pb.v.update({
        hz, level, load: 0.3 + accel * 0.7, clatter: bus || cab || van ? 0.7 : 0.2, cut: (bus ? 520 : 760) * (0.6 + 0.4 / (1 + d / 40)),
        wash: clamp(sp / 14, 0, 1) * s.gain * (rain ? 1.6 : 1) * 0.8, washCut: (rain ? 2400 : 700) + sp * 40, pan: s.pan, tau: 0.06
      });
    }
    // ---- crowd
    const peds = (T && T.peds) || [];
    let pn = 0;
    for (const p of peds) {
      if (!p.alive) continue;
      const dx = p.x - L.x, dz = p.z - L.z;
      if (Math.abs(dx) > 45 || Math.abs(dz) > 45) continue;
      pn += 1 / (1 + Math.hypot(dx, dz) / 12);
    }
    const crowdLevel = (clamp(pn / 9, 0, 1) * 0.16 + this.probe.landmark * 0.05) * altK * (1 - night * 0.4);
    this.crowd.update(dt, crowdLevel);
    this.levels.crowd = crowdLevel;
    // ---- river, gulls
    const water = this.probe.water * (1 / (1 + Math.max(0, alt - 10) / 40));
    const lap = water * (0.1 + 0.05 * Math.sin(this.t * 0.8) + 0.04 * Math.sin(this.t * 2.3 + 1));
    B.river.set(lap, 0.3);
    this.levels.river = lap;
    if (water > 0.15) {
      this.timers.slapW = (this.timers.slapW ?? 1) - dt;
      if (this.timers.slapW <= 0) { this.timers.slapW = 0.6 + this.rand() * 2; slap(core, core.out.amb, { gain: 0.06 * water, pan: (this.rand() - 0.5) * 1.6 }); }
      this.timers.gull -= dt;
      if (this.timers.gull <= 0) { this.timers.gull = 7 + this.rand() * 20; if (night < 0.6) { bird(core, core.out.amb, { kind: 'gull', gain: 0.07 + this.rand() * 0.05, pan: (this.rand() - 0.5) * 1.6 }); this.stats.oneShots++; } }
    }
    // ---- birds in parks (by day), the odd distant one elsewhere
    this.timers.bird -= dt;
    if (this.timers.bird <= 0) {
      const inPk = this.probe.park;
      this.timers.bird = inPk ? 0.7 + this.rand() * 2.6 : 14 + this.rand() * 25;
      if (night < 0.55 && alt < 60) {
        const kinds = ['tit', 'robin', 'blackbird', 'tit', 'robin'];
        bird(core, core.out.amb, { kind: kinds[Math.floor(this.rand() * kinds.length)], gain: (inPk ? 0.07 + this.rand() * 0.07 : 0.03) * (1 - night), pan: (this.rand() - 0.5) * 1.7, cut: inPk ? 12000 : 5000 });
        this.stats.oneShots++;
      } else if (inPk && night > 0.7 && this.rand() < 0.15) bird(core, core.out.amb, { kind: 'robin', gain: 0.04, pan: (this.rand() - 0.5) * 1.6 }); // robins sing under streetlights
      this.levels.park = inPk ? 1 : 0;
    }
    // ---- rain, wind
    const rainLevel = rain ? 0.2 * (1 / (1 + Math.max(0, alt - 30) / 90)) : 0;
    B.rain.set(rainLevel, 1.2);
    this.levels.rain = rainLevel;
    if (rain) {
      this.timers.drip -= dt;
      if (this.timers.drip <= 0) { this.timers.drip = 0.05 + this.rand() * 0.25; tick(core, core.out.amb, { gain: 0.02 + this.rand() * 0.03, f: 2500 + this.rand() * 4000, pan: (this.rand() - 0.5) * 1.8 }); }
    }
    const windLevel = clamp((alt - 20) / 160, 0, 1) * 0.12 + (rain ? 0.02 : 0) + water * 0.015;
    B.wind.set(windLevel, 0.8, 280 + 120 * Math.sin(this.t * 0.31));
    this.levels.wind = windLevel;
    // ---- sirens
    this._sirens(dt, night);
    // ---- Big Ben
    this.timers.chime = (this.timers.chime ?? 0) - dt;
    if (this.timers.chime <= 0) {
      this.timers.chime = 0.5;
      const due = dueChime(brusselsTime());
      if (due && due.key !== this.lastChime) { this.lastChime = due.key; this._ringChime(due.quarter, due.hour, false, due.age); }
    }
    // ---- life: boats, aircraft, helicopters, pigeons
    this._life(dt, night);
  }

  _ringChime(quarter, hour, force = false, age = 0) {
    const L = this.listener, bb = this.bigBen;
    const tower = { x: bb.x, y: 80, z: bb.z };
    const s = spatial(L, tower.x, tower.y, tower.z, 1);
    const d = s.d;
    const gain = 0.85 / (1 + d / 320);
    if (gain < 0.015 && !force) return;
    const delay = Math.min(d / SOUND, 9) - age * 0;
    const cut = 1400 + 9000 / (1 + d / 450);
    const t0 = this.core.now + Math.max(0, delay);
    for (const st of chimeSchedule(quarter, hour)) {
      const ben = st.bell === 'BEN';
      bell(this.core, this.core.out.world, { hz: st.hz, gain: gain * st.gain * (ben ? 0.75 : 0.45), pan: s.pan * 0.8, decay: ben ? 9 : 5, t: t0 + st.t, cut, cracked: ben });
    }
    this.levels.chime = { quarter, hour, gain, delay };
  }

  _sirens(dt, night) {
    const L = this.listener, core = this.core;
    this.timers.siren -= dt * (1 + night * 0.5);
    if (this.timers.siren <= 0 && this.sirens.length < 2) {
      this.timers.siren = 55 + this.rand() * 130;
      const kinds = ['twotone', 'twotone', 'wail', 'yelp'];
      const ang = this.rand() * Math.PI * 2, close = this.rand() < 0.18;
      const r = close ? 520 : 300 + this.rand() * 500;
      const sx = L.x + Math.cos(ang) * r, sz = L.z + Math.sin(ang) * r;
      // drive past: towards the listener (offset 40–80 m) when close, else tangentially
      const off = close ? 40 + this.rand() * 40 : 0;
      let tx = close ? L.x - sx + Math.cos(ang + Math.PI / 2) * off : -Math.sin(ang), tz = close ? L.z - sz + Math.sin(ang + Math.PI / 2) * off : Math.cos(ang);
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      this.sirens.push({ x: sx, z: sz, vx: tx * 14, vz: tz * 14, age: 0, life: close ? 80 : 24 + this.rand() * 14, voice: new SirenVoice(core, core.out.world, kinds[Math.floor(this.rand() * kinds.length)]) });
    }
    for (let i = this.sirens.length - 1; i >= 0; i--) {
      const s = this.sirens[i];
      s.age += dt; s.x += s.vx * dt; s.z += s.vz * dt;
      const sp = spatial(L, s.x, 2, s.z, 1);
      const d = sp.d;
      const fade = clamp(s.age / 3, 0, 1) * clamp((s.life - s.age) / 4, 0, 1);
      const vr = -(s.vx * (s.x - L.x) + s.vz * (s.z - L.z)) / Math.max(1, d);
      s.voice.update(dt, { level: (0.3 / (1 + d / 90)) * fade, pan: sp.pan * 0.8, doppler: clamp(SOUND / (SOUND - vr), 0.9, 1.1), cut: 500 + 7000 / (1 + d / 120) });
      if (s.age > s.life || d > 1600) { s.voice.stop(); this.sirens.splice(i, 1); }
    }
    this.levels.sirens = this.sirens.length;
  }

  _life(dt, night) {
    const life = this.o.life, L = this.listener, core = this.core;
    if (!life) return;
    // nearest moving river boat: diesel + wash
    let nb = null, nd = 260;
    for (const b of life.boats || []) { const d = Math.hypot(b.x - L.x, b.z - L.z); if (d < nd) { nd = d; nb = b; } }
    if (nb) {
      const s = spatial(L, nb.x, -1, nb.z, 25, 0.8);
      const sp = Math.abs(nb.speed || 0);
      const big = nb.type === 'clipper' || nb.type === 'tourist';
      this.boatVoice.update({ hz: (big ? 22 : nb.type === 'rib' ? 60 : 18) + sp * (nb.type === 'rib' ? 14 : 3), level: s.gain * (nb.type === 'rib' ? 0.25 : 0.35) * (0.4 + clamp(sp / 8, 0, 1) * 0.6), load: 0.5, clatter: 0.3, cut: nb.type === 'rib' ? 900 : 380, wash: s.gain * clamp(sp / 7, 0, 1.2), washCut: 500 + sp * 60, pan: s.pan, tau: 0.1 });
    } else this.boatVoice.silence(0.4);
    // aircraft: jet rumble + a little whine
    let jl = 0, jp = 0;
    for (const a of life.aircraft || []) {
      const s = spatial(L, a.x, a.y, a.z, 1);
      const g = 0.32 / (1 + Math.pow(s.d / 650, 2));
      if (g > jl) { jl = g; jp = s.pan; }
    }
    this.beds.jet.set(jl, 0.6, 240 + jl * 600, jp * 0.7);
    this.beds.jetWhine.set(jl * 0.25, 0.6, null, jp * 0.7);
    this.levels.jet = jl;
    // helicopters
    let nh = null, hd = 1500;
    for (const h of life.helicopters || []) { const d = Math.hypot(h.x - L.x, h.y - L.y, h.z - L.z); if (d < hd) { hd = d; nh = h; } }
    if (nh) {
      if (!this.heliVoice) this.heliVoice = new RotorVoice(core, core.out.world);
      const s = spatial(L, nh.x, nh.y, nh.z, 1);
      const vr = -((nh.vx || 0) * (nh.x - L.x) + (nh.vz || 0) * (nh.z - L.z)) / Math.max(1, s.d);
      this.heliVoice.update({ rate: 12.8 * clamp(SOUND / (SOUND - vr), 0.85, 1.18), level: 0.5 / (1 + Math.pow(s.d / 180, 1.6)), slap: 0.6, whine: 0.3 / (1 + s.d / 200), pan: s.pan, cut: 260 + 2000 / (1 + s.d / 150) });
    } else if (this.heliVoice) { this.heliVoice.stop(); this.heliVoice = null; }
    // events: boat horns, pigeons taking off …
    const ev = life.events;
    if (ev && ev.length) {
      for (const e of ev) {
        const s = spatial(L, e.x, e.y ?? 0, e.z, e.type === 'horn' ? 60 : 12, 0.8);
        if (s.gain < 0.01) continue;
        if (e.type === 'horn') shipHorn(core, core.out.world, { gain: 0.35 * s.gain, pan: s.pan, dur: e.dur || 1.2, f: e.f || 155, cut: 600 + 3000 * s.gain });
        else if (e.type === 'scatter') flutter(core, core.out.world, { gain: 0.35 * s.gain * clamp(e.n / 20, 0.3, 1.5), pan: s.pan, n: Math.min(30, 6 + (e.n || 10)) });
        this.stats.oneShots++;
      }
      ev.length = 0;
    }
    // pigeons cooing near a flock on the ground
    this.timers.coo -= dt;
    if (this.timers.coo <= 0) {
      this.timers.coo = 2 + this.rand() * 5;
      const f = life.nearestFlock ? life.nearestFlock(L.x, L.z) : null;
      if (f && f.d < 40 && night < 0.6) bird(core, core.out.world, { kind: 'coo', gain: 0.1 / (1 + f.d / 10), pan: spatial(L, f.x, 0, f.z, 10).pan });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // input & UI
  // ---------------------------------------------------------------------------------------------------------------
  _bindGesture() {
    const go = () => {
      if (this.core.unlock()) {
        for (const t of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(t, go, true);
      }
    };
    for (const t of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(t, go, true);
  }
  _bindKeys({ horn = 'KeyG', mute = 'KeyK' } = {}) {
    const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
    window.addEventListener('keydown', (e) => {
      if (typing(e) || e.repeat) return;
      if (horn && e.code === horn) this.horn(true);
      if (mute && e.code === mute) this.toggleMute();
    });
    window.addEventListener('keyup', (e) => { if (horn && e.code === horn) this.horn(false); });
    window.addEventListener('blur', () => this.horn(false));
  }
  _mountButton(parent) {
    const make = () => {
      const host = parent || document.getElementById('hud-toolbar');
      const btn = document.createElement('button');
      btn.id = 'btn-sound';
      btn.type = 'button';
      btn.className = host ? 'tool-btn icon-only' : 'bxl-sound-btn';
      btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path class="snd-on" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/><path class="snd-off" d="m16 9 6 6M22 9l-6 6"/></svg>';
      btn.addEventListener('click', () => { this.core.unlock(); this.toggleMute(); });
      if (!document.getElementById('bxl-sound-style')) {
        const st = document.createElement('style');
        st.id = 'bxl-sound-style';
        st.textContent = `#btn-sound .snd-off{display:none}#btn-sound.is-muted .snd-off{display:inline}#btn-sound.is-muted .snd-on{display:none}
.bxl-sound-btn{position:fixed;left:12px;bottom:12px;z-index:20;width:36px;height:36px;border-radius:10px;border:0;background:rgba(20,22,26,.72);color:#fff;display:grid;place-items:center;cursor:pointer}
body.hud-minimized .bxl-sound-btn{display:none}`;
        document.head.appendChild(st);
      }
      const before = host && document.getElementById('btn-toggle-hud');
      if (host && before && before.parentNode === host) {
        const prev = before.previousElementSibling;
        host.insertBefore(btn, prev && prev.classList.contains('toolbar-divider') ? prev : before);
      } else (host || document.body).appendChild(btn);
      this.button = btn;
      this._syncButton();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', make); else make();
  }
  _syncButton() {
    const b = this.button;
    if (!b) return;
    b.classList.toggle('is-muted', this.core.muted);
    b.title = this.core.muted ? 'Sound off — click to turn on [K]' : 'Sound on — click to mute [K]';
    b.setAttribute('aria-label', this.core.muted ? 'Unmute sound' : 'Mute sound');
    b.setAttribute('aria-pressed', String(this.core.muted));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------
function readPref(k, d) {
  try { const v = globalThis.localStorage && localStorage.getItem('brusselsloop_audio_' + k); return v === null || v === undefined ? d : JSON.parse(v); } catch { return d; }
}
function writePref(k, v) { try { if (globalThis.localStorage) localStorage.setItem('brusselsloop_audio_' + k, JSON.stringify(v)); } catch { /* private mode */ } }

/** share of water around (x, z): 8 points at 35 m + 12 at 80 m */
function waterFraction(world, x, z) {
  if (!world || !world.isWater) return 0;
  let n = 0, w = 0;
  for (const [r, k, wt] of [[0, 1, 1.5], [35, 8, 1], [80, 12, 0.6]]) {
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      if (world.isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) w += wt;
      n += wt;
    }
  }
  return w / n;
}
function prepParks(geo) {
  if (!geo || !geo.parks) return [];
  const out = [];
  for (const p of geo.parks) {
    if (!['park', 'garden', 'wood', 'cemetery', 'square', 'grass'].includes(p.kind)) continue;
    const pts = p.pts;
    if (!pts || pts.length < 6) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1]); }
    if ((maxX - minX) * (maxZ - minZ) < 1500) continue;
    out.push({ pts, minX, maxX, minZ, maxZ });
  }
  return out;
}
function inPark(parks, x, z) {
  for (const p of parks) {
    if (x < p.minX - 20 || x > p.maxX + 20 || z < p.minZ - 20 || z > p.maxZ + 20) continue;
    if (pip(p.pts, x, z)) return true;
  }
  return false;
}
function pip(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export { waterFraction, inPark, prepParks };
