// js/audio/synth.js — Workstream L: synthesised voices (continuous) and one-shots for Brussels Loop.
// All built from oscillators, filters and the core's generated noise loops. Each continuous voice has
// update(params) (smoothed with setTargetAtTime) and stop(). One-shots schedule themselves and free their nodes.
import { clamp, ramp, driveCurve } from './audio-core.js';

let _curve = null;
const curve = () => _curve || (_curve = driveCurve(2.4));

function panNode(c, out) {
  if (c.createStereoPanner) { const p = c.createStereoPanner(); p.connect(out); return p; }
  const g = c.createGain(); g.connect(out); g.pan = { value: 0, setTargetAtTime() {} }; return g;
}
/** setTimeout that never keeps Node alive (tests) */
export function later(fn, ms) { const h = setTimeout(fn, ms); if (h && h.unref) h.unref(); return h; }
function stopAll(nodes, t, now = 0) {
  for (const n of nodes) { try { if (n.stop) n.stop(t); } catch { /* already stopped */ } }
  later(() => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } }, Math.max(0, t - now) * 1000 + 200);
}
const osc = (c, type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; return o; };
const filt = (c, type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const gainN = (c, v = 0) => { const g = c.createGain(); g.gain.value = v; return g; };

// ------------------------------------------------------------------------------------------------------------------
// Engine (player vehicles, traffic pass-bys, boats): two detuned oscillators through a soft clipper + low-pass, an
// amplitude-modulated noise "clatter" (diesel knock at the firing frequency), an optional whine (hybrid motor /
// turbo / turbine) and a "wash" noise (tyres on tarmac, water, wind) — all into one panned gain.
// ------------------------------------------------------------------------------------------------------------------
export class EngineVoice {
  constructor(core, out, profile = {}) {
    const c = core.ctx;
    this.core = core;
    this.p = { wave: 'sawtooth', sub: 'square', cut: 900, q: 1.2, clatterHz: 1800, clatterQ: 1.4, whine: false, wash: 'pink', washCut: 900, ...profile };
    const P = this.p;
    this.pan = panNode(c, out);
    this.gain = gainN(c, 0);
    this.gain.connect(this.pan);
    // tone
    this.o1 = osc(c, P.wave, 40); this.o2 = osc(c, P.sub, 20);
    this.o2.detune.value = 7;
    const g1 = gainN(c, 0.5), g2 = gainN(c, 0.32);
    this.shaper = c.createWaveShaper(); this.shaper.curve = curve();
    this.lp = filt(c, 'lowpass', P.cut, P.q);
    this.tone = gainN(c, 0.5);
    this.o1.connect(g1); this.o2.connect(g2); g1.connect(this.shaper); g2.connect(this.shaper);
    this.shaper.connect(this.lp); this.lp.connect(this.tone); this.tone.connect(this.gain);
    // clatter: noise band, AM'd by an oscillator at the firing frequency
    this.cn = core.noiseSource('white');
    this.cbp = filt(c, 'bandpass', P.clatterHz, P.clatterQ);
    this.cam = gainN(c, 0.0);
    this.lfo = osc(c, 'square', 20);
    this.lfoDepth = gainN(c, 0);
    this.lfo.connect(this.lfoDepth); this.lfoDepth.connect(this.cam.gain);
    this.cn.connect(this.cbp); this.cbp.connect(this.cam); this.cam.connect(this.gain);
    // whine
    this.wo = osc(c, 'sine', 400);
    this.wg = gainN(c, 0);
    this.wo.connect(this.wg); this.wg.connect(this.gain);
    // wash (tyres / water / wind)
    this.wn = core.noiseSource(P.wash);
    this.wlp = filt(c, 'lowpass', P.washCut, 0.6);
    this.wsg = gainN(c, 0);
    this.wn.connect(this.wlp); this.wlp.connect(this.wsg); this.wsg.connect(this.pan);
    const t = core.now;
    for (const o of [this.o1, this.o2, this.lfo, this.wo]) o.start(t);
    this.nodes = [this.o1, this.o2, this.lfo, this.wo, this.cn, this.wn, g1, g2, this.shaper, this.lp, this.tone, this.cbp, this.cam, this.lfoDepth, this.wg, this.wlp, this.wsg, this.gain, this.pan];
    this.level = 0;
  }
  /** {hz (firing), level, load (0..1), clatter (0..1), cut, whineHz, whine (0..1), wash (0..1), washCut, pan, tau} */
  update(q) {
    const t = this.core.now, tau = q.tau ?? 0.05;
    const hz = clamp(q.hz || 30, 8, 600);
    ramp(this.o1.frequency, hz, t, tau);
    ramp(this.o2.frequency, hz * 0.5, t, tau);
    ramp(this.lfo.frequency, hz, t, tau);
    const load = clamp(q.load ?? 0.5, 0, 1);
    ramp(this.lp.frequency, (q.cut ?? this.p.cut) * (0.55 + load * 0.9), t, tau);
    ramp(this.tone.gain, 0.25 + load * 0.45, t, tau);
    const cl = clamp(q.clatter ?? 0.4, 0, 1);
    ramp(this.cam.gain, cl * 0.35, t, tau);
    ramp(this.lfoDepth.gain, cl * 0.35, t, tau);
    if (q.whineHz) ramp(this.wo.frequency, q.whineHz, t, tau);
    ramp(this.wg.gain, clamp(q.whine ?? 0, 0, 1) * 0.12, t, tau);
    ramp(this.wsg.gain, clamp(q.wash ?? 0, 0, 1.5) * 0.5, t, tau * 2);
    if (q.washCut) ramp(this.wlp.frequency, q.washCut, t, tau);
    this.level = clamp(q.level ?? 0, 0, 2);
    ramp(this.gain.gain, this.level, t, q.levelTau ?? tau * 1.5);
    if (q.pan !== undefined && this.pan.pan) ramp(this.pan.pan, clamp(q.pan, -1, 1), t, 0.05);
  }
  /** wash level is independent of the engine level (tyres still roll when you lift off) */
  setWash(v, cut) {
    const t = this.core.now;
    ramp(this.wsg.gain, clamp(v, 0, 1.5) * 0.5, t, 0.08);
    if (cut) ramp(this.wlp.frequency, cut, t, 0.08);
  }
  silence(tau = 0.15) {
    const t = this.core.now;
    ramp(this.gain.gain, 0, t, tau); ramp(this.wsg.gain, 0, t, tau);
    this.level = 0;
  }
  stop() {
    this.silence(0.05);
    stopAll(this.nodes, this.core.now + 0.3, this.core.now);
  }
}

// Rotor: low noise AM'd by a pulse train at the blade-passing rate (the "whop"), a turbine whine and some hiss
export class RotorVoice {
  constructor(core, out) {
    const c = core.ctx;
    this.core = core;
    this.pan = panNode(c, out);
    this.gain = gainN(c, 0); this.gain.connect(this.pan);
    this.n = core.noiseSource('brown');
    this.lp = filt(c, 'lowpass', 420, 0.9);
    this.am = gainN(c, 0.1);
    const real = new Float32Array(16), imag = new Float32Array(16);
    for (let k = 1; k < 16; k++) imag[k] = 1 / Math.pow(k, 0.55);
    this.pulse = osc(c, 'sine', 13);
    if (c.createPeriodicWave) this.pulse.setPeriodicWave(c.createPeriodicWave(real, imag));
    this.depth = gainN(c, 0.9);
    this.pulse.connect(this.depth); this.depth.connect(this.am.gain);
    this.n.connect(this.lp); this.lp.connect(this.am); this.am.connect(this.gain);
    this.thump = osc(c, 'sine', 52);
    this.thg = gainN(c, 0.0);
    this.thAm = gainN(c, 0);
    this.depth.connect(this.thAm.gain);
    this.thump.connect(this.thAm); this.thAm.connect(this.thg); this.thg.connect(this.gain);
    this.tw = osc(c, 'sine', 3600); this.twg = gainN(c, 0); this.tw.connect(this.twg); this.twg.connect(this.gain);
    this.hn = core.noiseSource('pink'); this.hp = filt(c, 'highpass', 2600, 0.6); this.hg = gainN(c, 0);
    this.hn.connect(this.hp); this.hp.connect(this.hg); this.hg.connect(this.gain);
    const t = core.now;
    for (const o of [this.pulse, this.thump, this.tw]) o.start(t);
    this.nodes = [this.pulse, this.thump, this.tw, this.n, this.hn, this.lp, this.am, this.depth, this.thg, this.thAm, this.twg, this.hp, this.hg, this.gain, this.pan];
  }
  /** {rate (blade passes/s), level, slap (0..1), whine (0..1), pan, cut} */
  update(q) {
    const t = this.core.now;
    ramp(this.pulse.frequency, q.rate ?? 13, t, 0.1);
    ramp(this.depth.gain, 0.6 + (q.slap ?? 0.3) * 0.6, t, 0.1);
    ramp(this.lp.frequency, q.cut ?? 420, t, 0.1);
    ramp(this.thg.gain, 0.25 + (q.slap ?? 0.3) * 0.5, t, 0.1);
    ramp(this.twg.gain, (q.whine ?? 0.5) * 0.05, t, 0.1);
    ramp(this.hg.gain, (q.whine ?? 0.5) * 0.08, t, 0.1);
    ramp(this.gain.gain, q.level ?? 0, t, 0.12);
    if (q.pan !== undefined && this.pan.pan) ramp(this.pan.pan, clamp(q.pan, -1, 1), t, 0.05);
  }
  silence() { ramp(this.gain.gain, 0, this.core.now, 0.2); }
  stop() { this.silence(); stopAll(this.nodes, this.core.now + 0.6, this.core.now); }
}

// A filtered noise bed (traffic hum, river, rain, wind, crowd layers): noise → filter(s) → gain (→ pan)
export class NoiseBed {
  constructor(core, out, { kind = 'pink', type = 'lowpass', freq = 800, q = 0.7, type2 = null, freq2 = 0, q2 = 0.7, rate = 1, pan = false } = {}) {
    const c = core.ctx;
    this.core = core;
    this.src = core.noiseSource(kind, rate);
    this.f = filt(c, type, freq, q);
    this.src.connect(this.f);
    let last = this.f;
    if (type2) { this.f2 = filt(c, type2, freq2, q2); last.connect(this.f2); last = this.f2; }
    this.gain = gainN(c, 0);
    last.connect(this.gain);
    if (pan) { this.pan = panNode(c, out); this.gain.connect(this.pan); } else this.gain.connect(out);
    this.nodes = [this.src, this.f, this.f2, this.gain, this.pan].filter(Boolean);
    this.level = 0;
  }
  set(level, tau = 0.25, freq = null, pan = null) {
    const t = this.core.now;
    this.level = level;
    ramp(this.gain.gain, Math.max(0, level), t, tau);
    if (freq) ramp(this.f.frequency, freq, t, tau);
    if (pan !== null && this.pan && this.pan.pan) ramp(this.pan.pan, clamp(pan, -1, 1), t, 0.05);
  }
  stop() { this.set(0, 0.05); stopAll(this.nodes, this.core.now + 0.3, this.core.now); }
}

// Siren: a sawtooth through a band-pass, pitch either alternating (UK two-tone) or swept (wail / yelp)
export class SirenVoice {
  constructor(core, out, kind = 'twotone') {
    const c = core.ctx;
    this.core = core; this.kind = kind; this.phase = Math.random() * 10;
    this.o = osc(c, 'sawtooth', 700);
    this.o2 = osc(c, 'square', 700); this.o2.detune.value = 12;
    const g2 = gainN(c, 0.25);
    this.bp = filt(c, 'bandpass', 1400, 1.2);
    this.lp = filt(c, 'lowpass', 3000, 0.7);
    this.gain = gainN(c, 0);
    this.pan = panNode(c, out);
    this.o.connect(this.bp); this.o2.connect(g2); g2.connect(this.bp); this.bp.connect(this.lp); this.lp.connect(this.gain); this.gain.connect(this.pan);
    const t = core.now;
    this.o.start(t); this.o2.start(t);
    this.nodes = [this.o, this.o2, g2, this.bp, this.lp, this.gain, this.pan];
  }
  /** dt, {level, pan, doppler (pitch factor), cut (distance low-pass)} */
  update(dt, q) {
    this.phase += dt;
    const t = this.core.now;
    let f;
    if (this.kind === 'twotone') f = (Math.floor(this.phase / 0.62) % 2 ? 610 : 805);
    else if (this.kind === 'yelp') f = 650 + 650 * (0.5 - 0.5 * Math.cos((this.phase * 2 * Math.PI) / 0.32));
    else f = 600 + 700 * (0.5 - 0.5 * Math.cos((this.phase * 2 * Math.PI) / 4.2));
    f *= q.doppler || 1;
    const tau = this.kind === 'twotone' ? 0.01 : 0.03;
    ramp(this.o.frequency, f, t, tau); ramp(this.o2.frequency, f, t, tau);
    ramp(this.lp.frequency, q.cut ?? 3000, t, 0.2);
    ramp(this.gain.gain, q.level ?? 0, t, 0.2);
    if (this.pan.pan) ramp(this.pan.pan, clamp(q.pan ?? 0, -1, 1), t, 0.08);
  }
  stop() { ramp(this.gain.gain, 0, this.core.now, 0.3); stopAll(this.nodes, this.core.now + 1.5, this.core.now); }
}

// Babble: a few band-passed noise "voices" whose formants and levels jump at syllable rate
export class CrowdVoice {
  constructor(core, out, n = 4, rand = Math.random) {
    const c = core.ctx;
    this.core = core; this.rand = rand;
    this.gain = gainN(c, 0); this.gain.connect(out);
    this.src = core.noiseSource('pink');
    this.bands = [];
    for (let i = 0; i < n; i++) {
      const bp = filt(c, 'bandpass', 500 + i * 300, 5);
      const g = gainN(c, 0);
      this.src.connect(bp); bp.connect(g); g.connect(this.gain);
      this.bands.push({ bp, g, next: 0 });
    }
    this.low = filt(c, 'bandpass', 260, 1.2); this.lowG = gainN(c, 0.5);
    this.src.connect(this.low); this.low.connect(this.lowG); this.lowG.connect(this.gain);
    this.nodes = [this.src, this.low, this.lowG, this.gain, ...this.bands.flatMap((b) => [b.bp, b.g])];
    this.clock = 0;
  }
  update(dt, level) {
    this.clock += dt;
    const t = this.core.now, r = this.rand;
    for (const b of this.bands) {
      if (this.clock < b.next) continue;
      b.next = this.clock + 0.09 + r() * 0.22;
      const f = 320 + r() * (r() < 0.4 ? 2400 : 1100);
      ramp(b.bp.frequency, f, t, 0.03);
      ramp(b.g.gain, r() < 0.25 ? 0 : (0.4 + r() * 0.9), t, 0.035);
    }
    ramp(this.gain.gain, level, t, 0.4);
  }
  stop() { ramp(this.gain.gain, 0, this.core.now, 0.05); stopAll(this.nodes, this.core.now + 0.3, this.core.now); }
}

// Held horn (two square-ish tones through a horn-like band-pass)
export class HornVoice {
  constructor(core, out, { f1 = 370, f2 = 466, bp = 1100, level = 0.35 } = {}) {
    const c = core.ctx;
    this.core = core; this.levelOn = level;
    this.o1 = osc(c, 'square', f1); this.o2 = osc(c, 'sawtooth', f2);
    this.f = filt(c, 'bandpass', bp, 1.1);
    this.sh = c.createWaveShaper(); this.sh.curve = curve();
    this.gain = gainN(c, 0);
    const a = gainN(c, 0.5), b = gainN(c, 0.4);
    this.o1.connect(a); this.o2.connect(b); a.connect(this.sh); b.connect(this.sh); this.sh.connect(this.f); this.f.connect(this.gain); this.gain.connect(out);
    this.o1.start(core.now); this.o2.start(core.now);
    this.nodes = [this.o1, this.o2, a, b, this.sh, this.f, this.gain];
    this.on = false;
  }
  set(on) {
    if (on === this.on) return;
    this.on = on;
    const t = this.core.now;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(on ? this.levelOn : 0, t, on ? 0.012 : 0.03);
  }
  stop() { this.set(false); stopAll(this.nodes, this.core.now + 0.3, this.core.now); }
}

// ------------------------------------------------------------------------------------------------------------------
// One-shots
// ------------------------------------------------------------------------------------------------------------------
function shot(core, out, pan = 0) {
  const c = core.ctx;
  const g = gainN(c, 0);
  const p = panNode(c, out);
  if (p.pan) p.pan.value = clamp(pan, -1, 1);
  g.connect(p);
  return { c, g, p, t: core.now };
}
function noiseBurst(core, dest, t, dur, { kind = 'white', type = 'lowpass', freq = 800, q = 0.8, gain = 1, attack = 0.002, rate = 1 } = {}) {
  const c = core.ctx;
  const s = c.createBufferSource();
  s.buffer = core.noise[kind];
  s.playbackRate.value = rate;
  const f = filt(c, type, freq, q);
  const g = gainN(c, 0);
  s.connect(f); f.connect(g); g.connect(dest);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setTargetAtTime(0, t + attack, dur / 3);
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur * 2 + 0.05);
  s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch { /* */ } };
  return { s, f, g };
}
function tone(core, dest, t, { type = 'sine', f = 440, f1 = null, glide = 0.05, dur = 0.3, gain = 0.5, attack = 0.003, detune = 0 }) {
  const c = core.ctx;
  const o = osc(c, type, f);
  o.detune.value = detune;
  if (f1) { o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + glide); }
  const g = gainN(c, 0);
  o.connect(g); g.connect(dest);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setTargetAtTime(0, t + attack, dur / 3);
  o.start(t);
  o.stop(t + dur * 2 + 0.05);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* */ } };
  return o;
}
function freeLater(core, nodes, t) { later(() => { for (const n of nodes) { try { n.disconnect(); } catch { /* */ } } }, (t - core.now) * 1000 + 300); }

/** church-bell stroke: hum, prime, tierce, quint, nominal + upper partials, a strike transient. Far bells are
 *  low-passed. {hz, gain, pan, decay (s), t, cut, cracked} */
export function bell(core, out, { hz = 330, gain = 0.5, pan = 0, decay = 6, t = null, cut = 9000, cracked = false } = {}) {
  const S = shot(core, out, pan);
  const t0 = t ?? S.t;
  const lp = filt(S.c, 'lowpass', cut, 0.5);
  lp.connect(S.g);
  S.g.gain.value = gain;
  const partials = [[0.5, 0.55, 1.0], [1.0, 0.5, 0.75], [1.2, 0.4, 0.55], [1.5, 0.22, 0.4], [2.0, 0.45, 0.5], [2.5, 0.12, 0.25], [2.66, 0.1, 0.2], [3.01, 0.09, 0.18], [4.08, 0.05, 0.1]];
  for (const [r, a, d] of partials) {
    const f = hz * r * (cracked && r > 1.9 ? 1.0 + 0.004 : 1);
    tone(core, lp, t0, { type: 'sine', f, dur: decay * d * 3, gain: a, attack: 0.004 });
    if (r === 0.5 || (cracked && r === 2.0)) tone(core, lp, t0, { type: 'sine', f: f + (cracked ? 2.7 : 0.6), dur: decay * d * 3, gain: a * 0.6, attack: 0.004 });
  }
  noiseBurst(core, lp, t0, 0.06, { type: 'bandpass', freq: hz * 6, q: 2, gain: 0.5 });
  freeLater(core, [lp, S.g, S.p], t0 + decay * 3 + 0.5);
}

/** collision: {impulse (m/s), kind ('car'|'bike'|'person'|'boat'), pan} */
export function thud(core, out, { impulse = 3, kind = 'car', pan = 0 } = {}) {
  const S = shot(core, out, pan);
  const k = clamp(impulse / 10, 0.08, 1.2);
  S.g.gain.value = 0.35 + k * 0.6;
  const t = S.t;
  const body = kind === 'person' ? 0.35 : kind === 'bike' ? 0.5 : 1;
  noiseBurst(core, S.g, t, 0.18 + k * 0.25, { kind: 'brown', freq: 160 + k * 500, q: 0.9, gain: 1.4 * body });
  tone(core, S.g, t, { f: kind === 'boat' ? 55 : 85, f1: 38, glide: 0.18, dur: 0.35 + k * 0.3, gain: 0.8 * body });
  if (kind !== 'person' && impulse > 4.5) {
    // crunch + panel ring
    noiseBurst(core, S.g, t + 0.005, 0.12 + k * 0.1, { kind: 'white', type: 'bandpass', freq: 2200 + Math.random() * 1200, q: 1.4, gain: 0.5 * k });
    tone(core, S.g, t, { type: 'triangle', f: 640 + Math.random() * 300, dur: 0.25, gain: 0.08 * k, detune: 30 });
    tone(core, S.g, t, { type: 'triangle', f: 1730 + Math.random() * 400, dur: 0.18, gain: 0.05 * k });
  }
  if (kind === 'bike') tone(core, S.g, t, { type: 'triangle', f: 2900, dur: 0.4, gain: 0.06 });
  freeLater(core, [S.g, S.p], t + 2);
}

/** a footstep: short low thump + scuff; wet adds a splash */
export function footstep(core, out, { gain = 0.2, wet = false, pan = 0, run = false } = {}) {
  const S = shot(core, out, pan);
  S.g.gain.value = gain;
  const t = S.t;
  noiseBurst(core, S.g, t, run ? 0.07 : 0.05, { kind: 'pink', type: 'bandpass', freq: 700 + Math.random() * 500, q: 1.1, gain: 0.9 });
  tone(core, S.g, t, { f: 120, f1: 70, glide: 0.04, dur: 0.06, gain: 0.5 });
  if (wet) noiseBurst(core, S.g, t + 0.01, 0.09, { kind: 'white', type: 'highpass', freq: 2500, q: 0.7, gain: 0.35 });
  freeLater(core, [S.g, S.p], t + 0.6);
}

/** a freewheel / ratchet click */
export function tick(core, out, { gain = 0.08, f = 4200, pan = 0 } = {}) {
  const S = shot(core, out, pan);
  S.g.gain.value = gain;
  noiseBurst(core, S.g, S.t, 0.012, { kind: 'white', type: 'bandpass', freq: f, q: 3, gain: 1 });
  freeLater(core, [S.g, S.p], S.t + 0.3);
}

/** tyre squeal (continuous): a resonant noise band + a jittering triangle */
export class SquealVoice {
  constructor(core, out) {
    const c = core.ctx;
    this.core = core;
    this.n = core.noiseSource('white');
    this.bp = filt(c, 'bandpass', 1150, 9);
    this.o = osc(c, 'triangle', 880);
    this.og = gainN(c, 0.15);
    this.gain = gainN(c, 0);
    this.n.connect(this.bp); this.bp.connect(this.gain); this.o.connect(this.og); this.og.connect(this.gain); this.gain.connect(out);
    this.o.start(core.now);
    this.nodes = [this.n, this.o, this.bp, this.og, this.gain];
    this.j = 0;
  }
  update(level, wet = false) {
    const t = this.core.now;
    this.j += 1;
    const f = 830 + Math.sin(this.j * 0.37) * 60 + Math.random() * 50;
    ramp(this.o.frequency, f, t, 0.03);
    ramp(this.bp.frequency, wet ? 1900 : 1150 + Math.random() * 120, t, 0.05);
    ramp(this.gain.gain, clamp(level, 0, 1) * (wet ? 0.18 : 0.42), t, level > 0.02 ? 0.03 : 0.12);
  }
  stop() { ramp(this.gain.gain, 0, this.core.now, 0.05); stopAll(this.nodes, this.core.now + 0.3, this.core.now); }
}

/** birdsong phrases: 'tit' (two-note see-saw), 'robin' (warble), 'blackbird' (fluting), 'gull' (kyow), 'coo' (pigeon) */
export function bird(core, out, { kind = 'tit', gain = 0.12, pan = 0, cut = 12000 } = {}) {
  const S = shot(core, out, pan);
  const lp = filt(S.c, 'lowpass', cut, 0.5); lp.connect(S.g);
  S.g.gain.value = gain;
  let t = S.t + 0.01;
  const r = Math.random;
  if (kind === 'tit') {
    const n = 3 + Math.floor(r() * 4), hi = 4800 + r() * 900, lo = hi * 0.72;
    for (let i = 0; i < n; i++) { tone(core, lp, t, { f: hi, f1: hi * 0.96, glide: 0.07, dur: 0.07, gain: 0.5 }); tone(core, lp, t + 0.12, { f: lo, f1: lo * 0.98, glide: 0.08, dur: 0.08, gain: 0.45 }); t += 0.27; }
  } else if (kind === 'robin') {
    const n = 6 + Math.floor(r() * 7);
    for (let i = 0; i < n; i++) { const f = 2600 + r() * 4200; tone(core, lp, t, { f, f1: f * (0.7 + r() * 0.6), glide: 0.05 + r() * 0.06, dur: 0.06 + r() * 0.07, gain: 0.3 + r() * 0.3 }); t += 0.07 + r() * 0.1; }
  } else if (kind === 'blackbird') {
    const n = 4 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) { const f = 1500 + r() * 1400; tone(core, lp, t, { f, f1: f * (1.1 + r() * 0.35), glide: 0.12, dur: 0.16 + r() * 0.12, gain: 0.45 }); t += 0.19 + r() * 0.12; }
    tone(core, lp, t, { f: 3400, f1: 6200, glide: 0.08, dur: 0.1, gain: 0.2 });
  } else if (kind === 'gull') {
    const n = 2 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const f = 1250 + r() * 250;
      for (const [m, a] of [[1, 0.5], [2, 0.28], [3, 0.12]]) tone(core, lp, t, { type: 'triangle', f: f * m, f1: f * m * 0.55, glide: 0.32, dur: 0.32, gain: a, attack: 0.02 });
      t += 0.38 + r() * 0.12;
    }
  } else if (kind === 'coo') {
    for (const [d, f] of [[0, 420], [0.32, 470], [0.62, 400]]) tone(core, lp, t + d, { f, f1: f * 0.88, glide: 0.25, dur: 0.26, gain: 0.5, attack: 0.03 });
  }
  freeLater(core, [lp, S.g, S.p], t + 1.5);
}

/** pigeons taking off: a flurry of wing claps */
export function flutter(core, out, { gain = 0.3, pan = 0, n = 14 } = {}) {
  const S = shot(core, out, pan);
  S.g.gain.value = gain;
  for (let i = 0; i < n; i++) {
    const t = S.t + Math.random() * 0.9 + (i < 4 ? 0 : 0.1);
    noiseBurst(core, S.g, t, 0.05 + Math.random() * 0.04, { kind: 'pink', type: 'bandpass', freq: 700 + Math.random() * 900, q: 0.9, gain: 0.25 + Math.random() * 0.5 });
  }
  freeLater(core, [S.g, S.p], S.t + 2.5);
}

/** a water slap against a hull / embankment */
export function slap(core, out, { gain = 0.15, pan = 0 } = {}) {
  const S = shot(core, out, pan);
  S.g.gain.value = gain;
  noiseBurst(core, S.g, S.t, 0.14 + Math.random() * 0.12, { kind: 'pink', type: 'lowpass', freq: 500 + Math.random() * 700, q: 2.5, gain: 1, attack: 0.012 });
  freeLater(core, [S.g, S.p], S.t + 1);
}

/** a ship's / boat's horn blast */
export function shipHorn(core, out, { gain = 0.3, pan = 0, dur = 1.4, f = 155, cut = 2400 } = {}) {
  const S = shot(core, out, pan);
  const lp = filt(S.c, 'lowpass', cut, 0.7); lp.connect(S.g);
  S.g.gain.value = gain;
  const t = S.t;
  for (const [m, a] of [[1, 0.5], [1.5, 0.3], [2, 0.25]]) {
    const o = osc(S.c, 'sawtooth', f * m);
    const g = gainN(S.c, 0);
    o.connect(g); g.connect(lp);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.12); g.gain.setValueAtTime(a, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.35);
    o.start(t); o.stop(t + dur + 0.5);
  }
  freeLater(core, [lp, S.g, S.p], t + dur + 1);
}

/** UI / bus sounds by name — see BrusselsAudio.play() */
export function cue(core, out, name, { pan = 0, gain = 1 } = {}) {
  const S = shot(core, out, pan);
  S.g.gain.value = gain;
  const t = S.t;
  switch (name) {
    case 'busBell': // the "stop requested" ding
      tone(core, S.g, t, { f: 1319, dur: 0.9, gain: 0.35 });
      tone(core, S.g, t, { f: 2637, dur: 0.5, gain: 0.12 });
      tone(core, S.g, t, { f: 3956, dur: 0.25, gain: 0.05 });
      break;
    case 'busDoorsOpen':
    case 'busDoorsClose': {
      const open = name === 'busDoorsOpen';
      noiseBurst(core, S.g, t, open ? 0.55 : 0.35, { kind: 'white', type: 'highpass', freq: 2600, q: 0.6, gain: 0.35, attack: 0.02 });
      noiseBurst(core, S.g, t + (open ? 0.05 : 0.02), 0.4, { kind: 'pink', type: 'bandpass', freq: 900, q: 0.8, gain: 0.18 });
      tone(core, S.g, t + (open ? 0.75 : 0.6), { f: 110, f1: 60, glide: 0.06, dur: 0.12, gain: 0.5 });
      noiseBurst(core, S.g, t + (open ? 0.75 : 0.6), 0.06, { kind: 'brown', freq: 400, gain: 0.8 });
      if (!open) { tone(core, S.g, t, { f: 880, dur: 0.12, gain: 0.08 }); tone(core, S.g, t + 0.18, { f: 880, dur: 0.12, gain: 0.08 }); }
      break;
    }
    case 'kneel':
    case 'airBrake':
      noiseBurst(core, S.g, t, name === 'kneel' ? 1.1 : 0.7, { kind: 'white', type: 'highpass', freq: 3200, q: 0.5, gain: 0.3, attack: 0.01 });
      break;
    case 'notify': // phone notification (RideBXL job offer)
      tone(core, S.g, t, { f: 1046.5, dur: 0.18, gain: 0.25 });
      tone(core, S.g, t + 0.12, { f: 1568, dur: 0.35, gain: 0.25 });
      break;
    case 'coin': // fare paid
      tone(core, S.g, t, { type: 'square', f: 1976, dur: 0.08, gain: 0.08 });
      tone(core, S.g, t + 0.08, { type: 'square', f: 2637, dur: 0.3, gain: 0.08 });
      break;
    case 'cancel':
      tone(core, S.g, t, { f: 520, f1: 340, glide: 0.2, dur: 0.25, gain: 0.2 });
      break;
    case 'bikeBell':
      for (const d of [0, 0.22]) { tone(core, S.g, t + d, { f: 2350, dur: 0.6, gain: 0.25 }); tone(core, S.g, t + d, { f: 3480, dur: 0.4, gain: 0.12 }); tone(core, S.g, t + d, { f: 5120, dur: 0.25, gain: 0.05 }); }
      break;
    case 'whistle': // taxi-hailing whistle
      tone(core, S.g, t, { f: 2400, f1: 2900, glide: 0.12, dur: 0.25, gain: 0.25, attack: 0.02 });
      tone(core, S.g, t + 0.3, { f: 2900, f1: 2300, glide: 0.4, dur: 0.5, gain: 0.25, attack: 0.02 });
      break;
    case 'click':
      noiseBurst(core, S.g, t, 0.015, { kind: 'white', type: 'bandpass', freq: 3500, q: 2, gain: 0.4 });
      break;
    default:
      break;
  }
  freeLater(core, [S.g, S.p], t + 3);
}
export const CUES = ['busBell', 'busDoorsOpen', 'busDoorsClose', 'kneel', 'airBrake', 'notify', 'coin', 'cancel', 'bikeBell', 'whistle', 'click'];
