// js/bus-driver.js — the London bus-driver job for London Loop (Workstream B, round 2).
//
//   const busDriver = new BusDriver({ scene, camera, controllers, world: WORLD, geo: GEO, backend, ui: { setMode, … } });
//   busDriver.update(dt);          // every frame, after controllers.update()
//   busDriver.openPicker();        // route picker (also key J)
//
// Real London bus routes (data/ldn-bus-routes.json, baked by tools/build-bus-routes.mjs from OSM): pick a route and
// direction, start at its first stop in the play area in the drivable double-decker (player mode 'bus' from
// controllers.js; falls back to the black cab until it exists), follow the red GPS line, stop in each stop's bay,
// open the doors (F), let people off and on, close the doors and pull away. Timetable (early / late), stop requests
// (bell), comfort (harsh braking, crashes, speeding, red lights, doors) and a shift summary saved through backend.js
// (slop_bus_finish_shift — the server computes the pay). Builds its own DOM (.bd- classes, injected <style>) and its
// own 3D bits (route ribbon, stop bay marking + glow, stop flag, passengers). No brand marks: generic stop flags,
// red buses with route numbers and destination blinds.

import * as THREE from 'three/webgpu';
import { computeBusPay, injectStyle, safeStorage } from './backend.js';
const IS_BRUSSELS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('city') === 'brussels';

// ------------------------------------------------------------------------------------------------------------------
// Tunables
// ------------------------------------------------------------------------------------------------------------------
const MPH = 2.237;
const STOP_SPEED = 2 / MPH;            // must be below 2 mph to open the doors in the bay
const SPEED_LIMIT = 30 / MPH;          // 30 mph
const BAY_BACK = 3;                    // bus centre target = stop.s - BAY_BACK (front door next to the flag)
const BAY_TOL = 9;                     // ± metres along the road
const BAY_LAT = 5;                     // metres across
const MISS_AHEAD = 22;                 // passing the bay by this much = stop skipped
const SCHED_SPEED = 5.2;               // m/s timetable running speed (≈ 11.6 mph, London bus average incl. traffic)
const SCHED_DWELL = 18;                // s per stop in the timetable
const FIRST_DEPART = 45;               // s after the shift starts
const EARLY_OK = 60, LATE_OK = 180;    // on time = no more than 1 min early, 3 min late
const CAPACITY = 87;
const RIBBON_M = 520;
const WALK = 1.35;                     // m/s passenger walking speed
const C_RED = 0xe3283e;
const C_RED_CSS = '#e3283e';
const DOOR_FRONT_Z = 4.8, DOOR_MID_Z = 0.35, BUS_HALF_W = 1.26;

const FIRST_NAMES = ['Amira', 'Tom', 'Priya', 'Kwame', 'Siobhan', 'Olu', 'Jess', 'Mehmet', 'Ffion', 'Raj', 'Chloe', 'Dev', 'Hannah',
  'Kofi', 'Maeve', 'Wei', 'Grace', 'Ade', 'Zara', 'Callum', 'Nia', 'Joe', 'Leila', 'Sam', 'Ivy', 'Bayo', 'Rosa', 'Finn'];
const SAY = {
  brake: ['Easy on the brakes, driver!', 'Whoa — nearly lost my coffee.', 'Some of us are standing back here!', 'Steady on!'],
  crash: ['What was THAT?!', 'Oi! Watch it!', "I'm writing to the council about this.", 'My shopping is everywhere now.'],
  speed: ["It's a bus, not a getaway car.", 'Slow down, this is a 30!', 'Bit quick for a double-decker, mate.'],
  skipped: ['Oi! That was my stop!', 'You went straight past my stop!', 'I pressed the bell!'],
  left: ['Wait! Hold the bus!', "Oh come ON, I'm right here!", 'Typical. Next one in ten minutes.'],
  doors: ['Doors open while moving?! Are you mad?', 'Close the doors, driver!'],
  redlight: ['That was red, driver!', 'You just ran a red!'],
  thanks: ['Cheers, driver!', 'Thanks, drive!', 'Ta very much.', 'Lovely, thank you!', 'Have a good one!', 'Cheers mate.']
};

// ------------------------------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a, rng = Math.random) => a[Math.floor(rng() * a.length)];
const fmtMoney = (v) => `£${(Math.round((v || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDist = (m) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`);
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtMins = (s) => `${Math.max(1, Math.round(s / 60))} min`;
const fmtClock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
/** timing deviation (s, + = late) → { text, cls } */
function timing(dev) {
  if (dev == null || !Number.isFinite(dev)) return { text: '—', cls: '' };
  if (dev < -EARLY_OK + 1e-6) return { text: `${Math.round(-dev / 60) || 1} min early`, cls: 'early' };
  if (dev > LATE_OK) return { text: `${Math.round(dev / 60)} min late`, cls: 'late' };
  if (dev > 60) return { text: `${Math.round(dev / 60)} min late`, cls: 'ok' };
  return { text: 'On time', cls: 'ok' };
}

let ROUTES_PROMISE = null;
/** fetch data/ldn-bus-routes.json once (relative to this module) */
export function loadBusRoutes(url) {
  if (!ROUTES_PROMISE || url) {
    const u = url || new URL('../data/ldn-bus-routes.json', import.meta.url).href;
    ROUTES_PROMISE = fetch(u).then((r) => {
      if (!r.ok) throw new Error(`bus routes: HTTP ${r.status}`);
      return r.json();
    });
  }
  return ROUTES_PROMISE;
}

// ------------------------------------------------------------------------------------------------------------------
// The route polyline: projection with a moving window, arc-length lookups
// ------------------------------------------------------------------------------------------------------------------
export class PathTrack {
  constructor(flat) {
    this.p = Float32Array.from(flat);
    this.n = this.p.length / 2;
    this.cum = new Float64Array(this.n);
    for (let i = 1; i < this.n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(this.p[2 * i] - this.p[2 * i - 2], this.p[2 * i + 1] - this.p[2 * i - 1]);
    this.length = this.cum[this.n - 1] || 0;
  }
  /** nearest point on segments [i0, i1) → { s, d, i, lat (+ = left of travel) } */
  project(x, z, i0 = 0, i1 = this.n - 1) {
    const p = this.p;
    let best = null;
    i0 = clamp(i0, 0, this.n - 2); i1 = clamp(i1, i0 + 1, this.n - 1);
    for (let i = i0; i < i1; i++) {
      const ax = p[2 * i], az = p[2 * i + 1], dx = p[2 * i + 2] - ax, dz = p[2 * i + 3] - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
      if (!best || d < best.d - 1e-3) {
        const L = Math.sqrt(L2);
        best = { s: this.cum[i] + t * L, d, i, lat: ((x - qx) * dz - (z - qz) * dx) / L };
      }
    }
    return best;
  }
  indexAt(s) {
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  pointAt(s, out = {}) {
    s = clamp(s, 0, this.length);
    const i = Math.min(this.indexAt(s), this.n - 2);
    const L = this.cum[i + 1] - this.cum[i] || 1e-9, t = (s - this.cum[i]) / L;
    const ax = this.p[2 * i], az = this.p[2 * i + 1], dx = this.p[2 * i + 2] - ax, dz = this.p[2 * i + 3] - az;
    out.x = ax + dx * t; out.z = az + dz * t; out.h = Math.atan2(dx, dz);
    return out;
  }
  /** [{x, z}] from s0 to s1 (inclusive ends) */
  points(s0, s1) {
    s0 = clamp(s0, 0, this.length); s1 = clamp(s1, s0, this.length);
    const out = [this.pointAt(s0, {})];
    for (let i = this.indexAt(s0) + 1; i < this.n && this.cum[i] < s1; i++) out.push({ x: this.p[2 * i], z: this.p[2 * i + 1] });
    out.push(this.pointAt(s1, {}));
    return out;
  }
}

// ------------------------------------------------------------------------------------------------------------------
// 3D bits
// ------------------------------------------------------------------------------------------------------------------
function canvasTexture(w, hh, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  draw(c.getContext('2d'), w, hh);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function roundRect(g, x, y, w, hh, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r);
  g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** glowing chevron ribbon on the road along the route ahead */
class RouteRibbon {
  constructor(scene, maxPts = 240) {
    this.maxPts = maxPts;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxPts * 6);
    this.uv = new Float32Array(maxPts * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array((maxPts - 1) * 6);
    for (let i = 0; i < maxPts - 1; i++) { const a = i * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.tex = canvasTexture(64, 128, (g, w, H) => {
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.2, 'rgba(255,255,255,.5)');
      grad.addColorStop(0.5, 'rgba(255,255,255,.62)'); grad.addColorStop(0.8, 'rgba(255,255,255,.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, 0, w, H);
      g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(14, 78); g.lineTo(32, 50); g.lineTo(50, 78); g.stroke();
    }, { repeat: true });
    this.mat = new THREE.MeshBasicMaterial({ color: C_RED, map: this.tex, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'BusRouteRibbon';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.width = 1.6;
  }
  set(pts, ground, color = C_RED) {
    this.mat.color.setHex(color);
    const out = [];
    let L = 0;
    for (let i = 0; i < pts.length - 1 && out.length < this.maxPts; i++) {
      const a = pts[i], b = pts[i + 1], seg = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(seg / 4));
      for (let k = 0; k < n && out.length < this.maxPts; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n, L: L + seg * k / n });
      L += seg;
    }
    if (pts.length && out.length < this.maxPts) { const q = pts[pts.length - 1]; out.push({ x: q.x, z: q.z, L }); }
    const n = out.length;
    if (n < 2) { this.mesh.visible = false; return; }
    const hw = this.width / 2;
    for (let i = 0; i < n; i++) {
      const p = out[i], a = out[Math.max(0, i - 1)], b = out[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const y = ground(p.x, p.z) + 0.14;
      // fade the last 40 m out
      this.pos.set([p.x - dz * hw, y, p.z + dx * hw, p.x + dz * hw, y, p.z - dx * hw], i * 6);
      this.uv.set([0, p.L / 3.4, 1, p.L / 3.4], i * 4);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.setDrawRange(0, (n - 1) * 6);
    this.mesh.visible = true;
  }
  hide() { this.mesh.visible = false; }
  update(dt) { if (this.mesh.visible) { this.tex.offset.y -= dt * 0.9; this.tex.updateMatrix(); } }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.tex.dispose(); this.mat.dispose(); }
}

/** the stop bay: yellow "BUS STOP" box marking + a glow that turns green when the bus is in position + a soft beam */
class BayMarker {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'BusStopBay';
    this.group.visible = false;
    const L = 2 * BAY_TOL + 4, W = 3.0;
    this.len = L;
    const tex = canvasTexture(128, 640, (g, w, H) => {
      g.clearRect(0, 0, w, H);
      g.strokeStyle = '#f2c230'; g.lineWidth = 7; g.setLineDash([26, 16]);
      g.strokeRect(6, 6, w - 12, H - 12);
      g.setLineDash([]);
      g.fillStyle = '#f2c230';
      g.font = '900 58px Inter, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [txt, y] of [['BUS', 0.36], ['STOP', 0.6]]) {
        g.save(); g.translate(w / 2, H * y); g.rotate(-Math.PI / 2); g.scale(1, 1.5); g.fillText(txt, 0, 0); g.restore();
      }
    });
    this.markMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mg = new THREE.PlaneGeometry(W, L); mg.rotateX(-Math.PI / 2);
    this.mark = new THREE.Mesh(mg, this.markMat);
    // glow: soft-edged rectangle, additive
    const glowTex = canvasTexture(64, 256, (g, w, H) => {
      const gr = g.createRadialGradient(w / 2, H / 2, 4, w / 2, H / 2, H * 0.55);
      gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, H);
    });
    this.glowMat = new THREE.MeshBasicMaterial({ color: C_RED, map: glowTex, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const gg = new THREE.PlaneGeometry(W + 2.2, L + 4); gg.rotateX(-Math.PI / 2);
    this.glow = new THREE.Mesh(gg, this.glowMat);
    // beam over the bay (visible from far away, fades as you get close)
    const beamTex = canvasTexture(4, 256, (g, w, H) => {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr; g.fillRect(0, 0, w, H);
    });
    const bg = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); bg.translate(0, 0.5, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: C_RED, map: beamTex, transparent: true, opacity: 0.4, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.beam = new THREE.Mesh(bg, this.beamMat);
    this.group.add(this.mark, this.glow, this.beam);
    this.group.traverse((o) => { o.frustumCulled = false; o.castShadow = o.receiveShadow = false; });
    this.mark.renderOrder = 3; this.glow.renderOrder = 4; this.beam.renderOrder = 5;
    scene.add(this.group);
    this.t = 0;
    this.state = 'approach';
  }
  /** centre of the box (on the path at stop.s - BAY_BACK), heading */
  show(x, y, z, heading) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = heading;
    this.group.visible = true;
  }
  hide() { this.group.visible = false; }
  setState(state) { this.state = state; }
  update(dt, camPos) {
    if (!this.group.visible) return;
    this.t += dt;
    const ready = this.state === 'ready', dwell = this.state === 'dwell';
    this.glowMat.color.setHex(ready || dwell ? 0x3ee68a : this.state === 'inbay' ? 0xffc23a : C_RED);
    this.glowMat.opacity = dwell ? 0.35 : 0.38 + 0.22 * Math.sin(this.t * (ready ? 7 : 3));
    const d = camPos ? Math.hypot(camPos.x - this.group.position.x, camPos.z - this.group.position.z) : 100;
    const s = clamp(d / 120, 0.6, 10);
    this.beam.scale.set(1.1 * s, 40 + 30 * s, 1.1 * s);
    this.beamMat.opacity = (this.state === 'approach' ? clamp((d - 45) / 110, 0, 1) : 0) * (0.32 + 0.08 * Math.sin(this.t * 2.2));
    this.beam.visible = this.beamMat.opacity > 0.01;
    this.beamMat.color.copy(this.glowMat.color);
  }
  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }
}

/** a generic London-style stop flag on a pole (no roundel): red "BUS STOP" header, stop letter, route numbers, name */
class StopFlag {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'BusStopFlag';
    this.group.visible = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256; this.canvas.height = 384;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 3.1, 10), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.5 }));
    pole.position.y = 1.55;
    const plateMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.45, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.18 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.5 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.96, 0.64), [edgeMat, edgeMat, edgeMat, edgeMat, edgeMat, edgeMat]);
    // two faces carry the artwork (the flag sticks out from the pole, readable from both directions along the road)
    const face = new THREE.PlaneGeometry(0.64, 0.96);
    const fa = new THREE.Mesh(face, plateMat); fa.position.x = 0.026; fa.rotation.y = Math.PI / 2;
    const fb = new THREE.Mesh(face, plateMat); fb.position.x = -0.026; fb.rotation.y = -Math.PI / 2;
    const flag = new THREE.Group();
    flag.add(plate, fa, fb);
    flag.position.set(0, 2.62, 0.36);
    this.flag = flag;
    this.group.add(pole, flag);
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.mats = [pole.material, plateMat, edgeMat];
    scene.add(this.group);
    this.key = '';
  }
  set(stop, refs, x, y, z, yaw) {
    const key = `${stop.name}|${stop.code}|${refs.join(',')}`;
    if (key !== this.key) { this.key = key; this._draw(stop, refs); }
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.group.visible = true;
  }
  _draw(stop, refs) {
    const g = this.canvas.getContext('2d'), W = 256, H = 384;
    g.fillStyle = '#f7f5f0'; g.fillRect(0, 0, W, H);
    g.fillStyle = C_RED_CSS; g.fillRect(0, 0, W, 72);
    g.fillStyle = '#fff'; g.font = '800 38px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('BUS STOP', W / 2, 38);
    if (stop.code) {
      g.fillStyle = '#16171a'; roundRect(g, W / 2 - 40, 86, 80, 80, 16); g.fill();
      g.fillStyle = '#fff'; g.font = '900 58px Inter, Arial, sans-serif'; g.fillText(stop.code.slice(0, 2), W / 2, 129);
    }
    // route tiles
    const tiles = refs.slice(0, 8);
    const cols = Math.min(4, tiles.length), tw = 54, th = 40, gap = 6;
    const x0 = (W - (cols * tw + (cols - 1) * gap)) / 2;
    tiles.forEach((r, i) => {
      const cx = x0 + (i % cols) * (tw + gap), cy = 182 + Math.floor(i / cols) * (th + gap);
      g.fillStyle = '#fff'; g.strokeStyle = '#16171a'; g.lineWidth = 3; roundRect(g, cx, cy, tw, th, 6); g.fill(); g.stroke();
      g.fillStyle = '#16171a'; g.font = `800 ${r.length > 3 ? 20 : 26}px Inter, Arial, sans-serif`; g.fillText(r, cx + tw / 2, cy + th / 2 + 1);
    });
    // name strip
    g.fillStyle = '#16171a'; g.fillRect(0, H - 76, W, 76);
    g.fillStyle = '#fff'; g.font = '700 22px Inter, Arial, sans-serif';
    const words = stop.name.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (g.measureText(t).width > W - 20 && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    lines.slice(0, 2).forEach((l, i, a) => g.fillText(l, W / 2, H - 38 + (i - (a.length - 1) / 2) * 25));
    this.tex.needsUpdate = true;
  }
  hide() { this.group.visible = false; }
  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}

/**
 * Passengers: simple stylised people, one InstancedMesh per body part (7 draw calls for the whole lot), walking legs
 * & arms. Used on the WebGL2 fallback and as the default; `PersonCrowd`/`PersonRig` (js/pedestrians.js) take over on
 * WebGPU when available (see PaxRenderer).
 */
class SimpleFigures {
  constructor(scene, max = 40) {
    this.max = max;
    const mat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 });
    const torso = new THREE.CapsuleGeometry(0.2, 0.44, 4, 12); torso.scale(1, 1, 0.7); torso.translate(0, 1.16, 0);
    const head = new THREE.SphereGeometry(0.115, 14, 10); head.translate(0, 1.62, 0);
    const hair = new THREE.SphereGeometry(0.124, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52); hair.rotateX(-0.25); hair.translate(0, 1.64, 0);
    const leg = new THREE.CapsuleGeometry(0.083, 0.7, 4, 8); leg.translate(0, -0.43, 0);
    const arm = new THREE.CapsuleGeometry(0.058, 0.5, 4, 8); arm.translate(0, -0.3, 0);
    const coat = new THREE.CylinderGeometry(0.2, 0.27, 0.5, 12, 1, true); coat.scale(1, 1, 0.75); coat.translate(0, 0.72, 0);
    const parts = { torso, head, hair, legL: leg, legR: leg, armL: arm, armR: arm, coat };
    this.parts = {};
    for (const [k, g] of Object.entries(parts)) {
      const m = new THREE.InstancedMesh(g, mat(), max);
      m.name = `BusPax_${k}`;
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(m);
      this.parts[k] = m;
    }
    this._m = new THREE.Matrix4(); this._b = new THREE.Matrix4(); this._r = new THREE.Matrix4(); this._t = new THREE.Matrix4();
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
    this.count = 0;
  }
  begin() { this.count = 0; }
  add(p, dt) {
    if (this.count >= this.max) return;
    const i = this.count++;
    p.anim = (p.anim || 0) + dt * (p.moving ? 7.5 : 0);
    const sw = p.moving ? Math.sin(p.anim) * 0.55 : 0;
    const look = p.look || 0;
    const sc = p.scale || 1;
    this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
    this._b.compose(this._v.set(p.x, p.y, p.z), this._q, this._s.set(sc, sc * (p.shrink ?? 1), sc));
    const set = (k, local, col) => {
      const m = this.parts[k];
      this._m.multiplyMatrices(this._b, local);
      m.setMatrixAt(i, this._m);
      m.setColorAt(i, this._c.setHex(col));
    };
    const I = this._t.identity();
    set('torso', I, p.coat);
    set('coat', p.skirt ? I : this._r.makeScale(0, 0, 0), p.coat);
    set('head', this._r.makeRotationY(look), p.skin);
    set('hair', this._r.makeRotationY(look), p.hair);
    const leg = (k, x, a) => set(k, this._r.makeTranslation(x, 0.86, 0).multiply(new THREE.Matrix4().makeRotationX(a)), p.legs);
    leg('legL', 0.1, sw); leg('legR', -0.1, -sw);
    const wave = p.wave ? -(2.6 + 0.35 * Math.sin(p.anim * 1.4 + performance.now() / 120)) : 0;
    const arm = (k, x, a, z) => set(k, this._r.makeTranslation(x, 1.42, 0).multiply(new THREE.Matrix4().makeRotationX(a)).multiply(new THREE.Matrix4().makeRotationZ(z)), p.coat);
    arm('armL', 0.26, -sw * 0.8, 0.1);
    arm('armR', -0.26, sw * 0.8, p.wave ? wave : -0.1);
  }
  end() {
    for (const m of Object.values(this.parts)) {
      m.count = this.count;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
  dispose() { for (const m of Object.values(this.parts)) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); m.dispose?.(); } }
}

/** passenger drawing: PersonRig/PersonCrowd from js/pedestrians.js when allowed (WebGPU), else SimpleFigures */
class PaxRenderer {
  constructor(scene, { useRigs = false, max = 40, ground } = {}) {
    this.scene = scene;
    this.ground = ground;
    this.simple = new SimpleFigures(scene, max);
    this.rigs = null;
    if (useRigs) {
      import('./pedestrians.js').then((m) => {
        if (!m.PersonCrowd || !m.PersonRig) return;
        this.mod = m;
        this.crowd = new m.PersonCrowd(max, { farDistance: 30, castShadow: true });
        for (const mesh of this.crowd.meshes) scene.add(mesh);
        this.rigs = new Map();
      }).catch((e) => console.warn('[bus-driver] pedestrians.js rigs unavailable, simple figures', e));
    }
  }
  draw(people, dt, camPos) {
    if (this.rigs) {
      this.crowd.begin();
      const seen = new Set();
      for (const p of people) {
        let r = this.rigs.get(p.id);
        if (!r) {
          r = new this.mod.PersonRig({ seed: p.seed, scale: p.scale || 1, female: p.female, girth: 0.9 + (p.seed % 7) * 0.04, hair: (p.seed % 5) / 5 });
          this.rigs.set(p.id, r);
        }
        seen.add(p.id);
        if (p.wave) r.gesture = 'wave';
        r.gestureW = (r.gestureW || 0) + ((p.wave ? 1 : 0) - (r.gestureW || 0)) * Math.min(1, dt * 5);
        const y = p.y;
        r.update(dt, p.x, p.z, p.yaw, () => y, null, 0);
        this.crowd.add(r, camPos ? Math.hypot(camPos.x - p.x, camPos.z - p.z) : 0);
      }
      for (const id of this.rigs.keys()) if (!seen.has(id)) this.rigs.delete(id);
      this.crowd.end();
      this.simple.begin(); this.simple.end();
      return;
    }
    this.simple.begin();
    for (const p of people) this.simple.add(p, dt);
    this.simple.end();
  }
  dispose() {
    this.simple.dispose();
    if (this.crowd) for (const m of this.crowd.meshes) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Little sounds (bell "ding", door chime) — WebAudio, created on the first key/click
// ------------------------------------------------------------------------------------------------------------------
class Sfx {
  constructor() { this.ctx = null; this.enabled = true; }
  _ensure() {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) this.ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.enabled = false; return null; }
    return this.ctx;
  }
  tone(freq, t0, dur, gain = 0.12, type = 'sine') {
    const c = this._ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + t0);
    g.gain.linearRampToValueAtTime(gain, c.currentTime + t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
  }
  bell() { this.tone(1568, 0, 0.6, 0.09); this.tone(1568, 0.28, 0.7, 0.08); }
  doors(open) { this.tone(open ? 660 : 880, 0, 0.18, 0.06, 'triangle'); this.tone(open ? 880 : 660, 0.16, 0.22, 0.06, 'triangle'); }
  ok() { this.tone(988, 0, 0.15, 0.05); this.tone(1319, 0.1, 0.25, 0.05); }
}

// ------------------------------------------------------------------------------------------------------------------
// Styles (scoped .bd-)
// ------------------------------------------------------------------------------------------------------------------
const CSS = `
.bd-root{--bd-red:#e3283e;--bd-red-ink:#fff;--bd-glass:rgba(16,17,20,.80);--bd-border:rgba(255,255,255,.09);--bd-text:#f6f5f2;
  --bd-text2:rgba(246,245,242,.66);--bd-text3:rgba(246,245,242,.42);--bd-ok:#3ee68a;--bd-warn:#ffc23a;--bd-bad:#ff6b5e;
  font-family:var(--font-sans,Inter,-apple-system,system-ui,sans-serif);color:var(--bd-text);font-size:13px;-webkit-font-smoothing:antialiased}
.bd-root *{box-sizing:border-box}
.bd-root button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.bd-glass{background:var(--grain,none),var(--bd-glass);border:1px solid var(--bd-border);backdrop-filter:blur(22px) saturate(170%);-webkit-backdrop-filter:blur(22px) saturate(170%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 40px -18px rgba(0,0,0,.7),0 2px 8px rgba(0,0,0,.2)}
.bd-badge{display:inline-grid;place-items:center;min-width:34px;height:28px;padding:0 7px;border-radius:8px;background:var(--bd-red);color:#fff;
  font-weight:850;font-size:15px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;box-shadow:inset 0 -2px 0 rgba(0,0,0,.18)}
.bd-badge.lg{min-width:56px;height:46px;font-size:26px;border-radius:12px}
.bd-badge.sm{min-width:26px;height:21px;font-size:12px;border-radius:6px;padding:0 5px}
.bd-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:5px;font-size:10px;font-weight:650;line-height:1;
  color:var(--bd-text2);background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),inset 0 -1px 0 rgba(0,0,0,.3)}
.bd-btn{display:flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 14px;border-radius:11px;font-weight:700!important;font-size:13px!important;
  background:rgba(255,255,255,.08);transition:filter .15s,transform .15s,background .15s}
.bd-btn:hover{background:rgba(255,255,255,.12)}.bd-btn:active{transform:scale(.98)}
.bd-btn.primary{background:var(--bd-red);color:#fff!important;box-shadow:0 10px 24px -12px rgba(227,40,62,.9)}.bd-btn.primary:hover{filter:brightness(1.08)}
.bd-btn.primary .bd-kbd{background:rgba(0,0,0,.18);color:#fff;box-shadow:none}
.bd-btn.go{background:var(--bd-ok);color:#062014!important}.bd-btn.go .bd-kbd{background:rgba(0,0,0,.14);color:#062014;box-shadow:none}
.bd-btn[disabled]{opacity:.4;cursor:default;filter:none}
.bd-x{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;color:var(--bd-text2)}.bd-x:hover{background:rgba(255,255,255,.08);color:var(--bd-text)}
/* picker */
.bd-scrim{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(6,7,9,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:bd-fade .25s ease both}
.bd-picker{width:min(860px,calc(100vw - 32px));height:min(560px,calc(100vh - 48px));display:grid;grid-template-columns:300px 1fr;grid-template-rows:auto 1fr;
  border-radius:22px;overflow:hidden;animation:bd-rise .4s cubic-bezier(.22,1,.36,1) both}
.bd-phead{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:14px 14px 12px 18px;border-bottom:1px solid rgba(255,255,255,.07)}
.bd-phead h2{margin:0;font-size:16px;font-weight:780;letter-spacing:-.01em}
.bd-phead .bd-sub{font-size:12px;color:var(--bd-text2);margin-left:2px}
.bd-phead .bd-x{margin-left:auto}
.bd-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--bd-red);color:#fff}
.bd-list{overflow-y:auto;padding:8px;border-right:1px solid rgba(255,255,255,.07);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.15) transparent}
.bd-item{display:flex;align-items:center;gap:10px;width:100%;padding:8px 9px;border-radius:12px;text-align:left}
.bd-item:hover{background:rgba(255,255,255,.05)}
.bd-item.sel{background:rgba(227,40,62,.14);box-shadow:inset 0 0 0 1px rgba(227,40,62,.45)}
.bd-item .bd-it{flex:1;min-width:0}
.bd-item .bd-it b{display:block;font-size:12.8px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd-item .bd-it small{display:block;font-size:11px;color:var(--bd-text3);margin-top:1px;font-variant-numeric:tabular-nums}
.bd-detail{display:flex;flex-direction:column;min-height:0;padding:16px 18px 16px}
.bd-dtop{display:flex;align-items:center;gap:12px}
.bd-blind{flex:1;min-width:0;display:flex;align-items:center;gap:12px;height:46px;padding:0 14px;border-radius:10px;background:#0b0b0c;
  box-shadow:inset 0 0 0 2px #1d1e21,inset 0 8px 16px rgba(0,0,0,.6);font-weight:800;letter-spacing:.01em;color:#f3eedf;overflow:hidden}
.bd-blind .n{font-size:24px;font-variant-numeric:tabular-nums}
.bd-blind .d{font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase;letter-spacing:.04em}
.bd-dirs{display:flex;gap:4px;margin:12px 0 10px;padding:3px;border-radius:12px;background:rgba(255,255,255,.05)}
.bd-dir{flex:1;min-width:0;height:34px;padding:0 10px;border-radius:9px;font-size:12.5px;font-weight:680;color:var(--bd-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd-dir.sel{background:rgba(255,255,255,.11);color:var(--bd-text)}
.bd-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.bd-stat{padding:8px 10px;border-radius:11px;background:rgba(255,255,255,.05)}
.bd-stat>span{display:block;font-size:9.8px;font-weight:680;text-transform:uppercase;letter-spacing:.07em;color:var(--bd-text3)}
.bd-stat b{display:block;margin-top:2px;font-size:16px;font-weight:780;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.bd-mapwrap{position:relative;flex:1;min-height:120px;margin:10px 0 10px;border-radius:14px;overflow:hidden;background:#15171b;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.bd-mapwrap canvas{position:absolute;inset:0;width:100%;height:100%}
.bd-ends{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--bd-text2)}
.bd-ends .bd-leg{flex:1;min-width:0;display:flex;align-items:center;gap:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd-ends .bd-leg b{color:var(--bd-text);font-weight:680;overflow:hidden;text-overflow:ellipsis}
.bd-dot{flex:none;width:9px;height:9px;border-radius:50%;background:#fff;box-shadow:0 0 0 2.5px var(--bd-red)}
.bd-dot.end{border-radius:2px;background:var(--bd-red);box-shadow:0 0 0 2.5px rgba(227,40,62,.3)}
.bd-pfoot{display:flex;align-items:center;gap:10px;margin-top:12px}
.bd-pfoot .bd-note{flex:1;font-size:11.5px;color:var(--bd-text3);line-height:1.35}
/* shift panel (left) */
.bd-panel{position:fixed;z-index:12;left:max(20px,env(safe-area-inset-left));top:112px;width:272px;max-height:calc(100vh - 112px - 300px);min-height:200px;display:flex;flex-direction:column;
  border-radius:20px;overflow:hidden;transition:opacity .25s,transform .35s cubic-bezier(.22,1,.36,1)}
.bd-panel.hide{opacity:0;transform:translateX(-12px);pointer-events:none}
.bd-pnhead{display:flex;align-items:center;gap:9px;padding:11px 10px 9px 11px}
.bd-pnhead .bd-pt{flex:1;min-width:0}
.bd-pnhead .bd-pt b{display:block;font-size:13.5px;font-weight:780;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd-pnhead .bd-pt small{display:block;font-size:11px;color:var(--bd-text3)}
.bd-prog{height:4px;margin:0 11px 9px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}
.bd-prog i{display:block;height:100%;background:var(--bd-red);border-radius:3px;transform-origin:left;transition:transform .4s}
.bd-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:0 10px 9px}
.bd-stats .bd-stat{padding:6px 7px;border-radius:9px}.bd-stats .bd-stat b{font-size:13.5px}.bd-stats .bd-stat>span{font-size:9px}
.bd-stops{flex:1;overflow-y:auto;padding:2px 10px 6px 10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.15) transparent}
.bd-st{position:relative;display:flex;align-items:center;gap:8px;min-height:34px;padding:4px 6px 4px 24px;border-radius:9px;font-size:12px}
.bd-st::before{content:'';position:absolute;left:10px;top:0;bottom:0;width:3px;background:var(--bd-red);opacity:.55}
.bd-st:first-child::before{top:50%}.bd-st:last-child::before{bottom:50%}
.bd-st::after{content:'';position:absolute;left:6px;top:50%;width:11px;height:11px;margin-top:-5.5px;border-radius:50%;background:#16171a;box-shadow:inset 0 0 0 3px var(--bd-red)}
.bd-st.done{color:var(--bd-text3)}.bd-st.done::after{background:var(--bd-red);box-shadow:none;width:7px;height:7px;margin-top:-3.5px;left:8px}
.bd-st.next{background:rgba(227,40,62,.12)}.bd-st.next::after{background:#fff;box-shadow:0 0 0 3px var(--bd-red),0 0 10px rgba(227,40,62,.7)}
.bd-st .bd-sn{flex:1;min-width:0;font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bd-st .bd-sn small{display:block;font-size:10.5px;font-weight:500;color:var(--bd-text3);font-variant-numeric:tabular-nums}
.bd-st .bd-code{flex:none;display:grid;place-items:center;width:18px;height:18px;border-radius:5px;background:rgba(255,255,255,.1);font-size:10.5px;font-weight:800}
.bd-st .bd-wait{flex:none;display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;color:var(--bd-text2);font-variant-numeric:tabular-nums}
.bd-st .bd-bell{flex:none;color:var(--bd-warn)}
.bd-pnfoot{display:flex;gap:6px;padding:8px 10px 10px;border-top:1px solid rgba(255,255,255,.07)}
.bd-pnfoot .bd-btn{flex:1;height:34px;padding:0 8px;font-size:12.5px!important;white-space:nowrap}.bd-pnfoot .bd-btn.doors{flex:1.25}
.bd-pnfoot .bd-btn.doors.open{background:var(--bd-ok);color:#062014!important}
/* launcher card when in the bus without a shift */
.bd-idle{position:fixed;z-index:12;left:max(20px,env(safe-area-inset-left));top:112px;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 8px;border-radius:16px;
  transition:opacity .25s,transform .35s cubic-bezier(.22,1,.36,1)}
.bd-idle.hide{opacity:0;transform:translateX(-12px);pointer-events:none}
.bd-idle b{display:block;font-size:13px;font-weight:760}.bd-idle small{display:block;font-size:11px;color:var(--bd-text2)}
/* top chip */
.bd-chip{position:fixed;z-index:11;left:50%;top:max(20px,env(safe-area-inset-top));transform:translate(-50%,-8px);display:flex;align-items:center;gap:11px;padding:7px 12px 7px 7px;
  border-radius:15px;opacity:0;pointer-events:none;transition:opacity .25s,transform .35s cubic-bezier(.22,1,.36,1);white-space:nowrap;max-width:calc(100vw - 40px)}
.bd-chip.show{opacity:1;transform:translate(-50%,0)}
.bd-chip .bd-ct{display:flex;flex-direction:column;min-width:0}
.bd-chip .bd-ct small{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--bd-text3)}
.bd-chip .bd-ct b{font-size:14px;font-weight:780;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.bd-chip .bd-cd{font-size:18px;font-weight:820;letter-spacing:-.02em;font-variant-numeric:tabular-nums;padding-left:4px}
.bd-pill{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;font-size:11.5px;font-weight:720;background:rgba(255,255,255,.07);color:var(--bd-text2);font-variant-numeric:tabular-nums}
.bd-pill.ok{color:var(--bd-ok);background:rgba(62,230,138,.12)}.bd-pill.early{color:var(--bd-warn);background:rgba(255,194,58,.13)}.bd-pill.late{color:var(--bd-bad);background:rgba(255,107,94,.13)}
.bd-pill.bell{color:#1d1300;background:var(--bd-warn);animation:bd-ring 1.2s ease-in-out infinite}
.bd-pill.off{display:none}
/* prompt */
.bd-prompt{position:fixed;z-index:11;left:50%;bottom:150px;transform:translate(-50%,8px);display:flex;align-items:center;gap:10px;padding:9px 10px 9px 14px;border-radius:15px;
  opacity:0;pointer-events:none;transition:opacity .2s,transform .3s cubic-bezier(.22,1,.36,1);white-space:nowrap}
.bd-prompt.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.bd-prompt .bd-pmsg{font-size:13px;font-weight:650}.bd-prompt .bd-pmsg small{display:block;font-size:11px;font-weight:500;color:var(--bd-text2)}
.bd-prompt .bd-bar{width:90px;height:4px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}.bd-prompt .bd-bar i{display:block;height:100%;background:var(--bd-ok);transform-origin:left}
/* floating stop label */
.bd-label{position:fixed;z-index:9;left:0;top:0;display:none;align-items:center;gap:6px;padding:4px 8px 4px 4px;border-radius:9px;font-size:11.5px;font-weight:720;white-space:nowrap;pointer-events:none;
  background:rgba(16,17,20,.8);border:1px solid rgba(227,40,62,.5);will-change:transform;font-variant-numeric:tabular-nums}
.bd-label .bd-code{display:grid;place-items:center;width:18px;height:18px;border-radius:5px;background:var(--bd-red);font-size:10.5px;font-weight:850}
.bd-label small{color:var(--bd-text2);font-weight:600}
/* toasts */
.bd-toasts{position:fixed;z-index:13;left:50%;top:84px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;width:min(440px,calc(100vw - 40px))}
.bd-toast{display:flex;align-items:flex-start;gap:8px;max-width:100%;padding:8px 12px;border-radius:12px;font-size:12.5px;line-height:1.35;animation:bd-drop .3s cubic-bezier(.22,1,.36,1) both}
.bd-toast.out{animation:bd-out .3s ease forwards}
.bd-toast.chat{border-radius:14px 14px 14px 4px}.bd-toast .bd-who{font-weight:760;color:#ff8a96;margin-right:2px}
.bd-toast.bad{border-color:rgba(255,107,94,.4)}
.bd-toast.bad::before{content:'!';display:grid;place-items:center;flex:none;width:16px;height:16px;border-radius:50%;background:var(--bd-bad);color:#2a0b07;font-weight:900;font-size:11px}
.bd-toast.good::before{content:'✓';display:grid;place-items:center;flex:none;width:16px;height:16px;border-radius:50%;background:var(--bd-ok);color:#062014;font-weight:900;font-size:10px}
.bd-toast.pen{display:flex;align-items:center}.bd-toast .bd-pts{margin-left:auto;padding-left:10px;font-weight:800;color:var(--bd-bad);font-variant-numeric:tabular-nums}
/* summary */
.bd-sum{width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow-y:auto;padding:20px 20px 16px;border-radius:22px;animation:bd-rise .45s cubic-bezier(.22,1,.36,1) both}
.bd-sumtop{display:flex;align-items:center;gap:12px}
.bd-sumtop h2{margin:0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--bd-text2)}
.bd-sumtop .bd-route{font-size:15px;font-weight:760;margin-top:2px;line-height:1.25}
.bd-pay{display:flex;align-items:flex-end;gap:12px;margin:14px 0 12px;padding:14px 16px;border-radius:16px;background:linear-gradient(135deg,rgba(227,40,62,.22),rgba(227,40,62,.06));
  box-shadow:inset 0 0 0 1px rgba(227,40,62,.3)}
.bd-pay .bd-amt{font-size:40px;font-weight:860;letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.bd-pay .bd-pl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--bd-text2);margin-bottom:6px}
.bd-pay .bd-rank{margin-left:auto;text-align:right;font-size:11.5px;color:var(--bd-text2);line-height:1.4}.bd-pay .bd-rank b{display:block;font-size:20px;color:var(--bd-text);font-weight:800}
.bd-sum .bd-grid{grid-template-columns:repeat(3,1fr)}
.bd-meter{height:5px;margin-top:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}.bd-meter i{display:block;height:100%;border-radius:3px}
.bd-sec{margin:14px 0 6px;font-size:10.5px;font-weight:720;text-transform:uppercase;letter-spacing:.08em;color:var(--bd-text3)}
.bd-evs{display:flex;flex-wrap:wrap;gap:5px}
.bd-ev{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;font-size:11.5px;font-weight:650;background:rgba(255,107,94,.12);color:#ffb0a6}
.bd-ev.clean{background:rgba(62,230,138,.12);color:var(--bd-ok)}
.bd-lb{display:flex;flex-direction:column;gap:2px}
.bd-li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:9px;font-variant-numeric:tabular-nums;font-size:12.5px}
.bd-li:nth-child(odd){background:rgba(255,255,255,.035)}.bd-li.me{background:rgba(227,40,62,.14);box-shadow:inset 0 0 0 1px rgba(227,40,62,.35)}
.bd-li .r{width:18px;text-align:center;font-weight:800;color:var(--bd-text3)}.bd-li:nth-child(1) .r{color:#ffd166}
.bd-li .n{flex:1;min-width:0;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bd-li .n small{color:var(--bd-text3);font-weight:500;margin-left:4px}
.bd-li .a{font-weight:760}
.bd-sumfoot{display:flex;gap:8px;margin-top:14px}.bd-sumfoot .bd-btn{flex:1;white-space:nowrap;min-width:0}
.bd-sumfoot .bd-btn.ret{flex:1.7;overflow:hidden;text-overflow:ellipsis;display:block;line-height:36px;text-align:center}
.bd-err{margin:8px 0 0;font-size:12px;color:#ffb0a6}
body.hud-minimized .bd-panel,body.hud-minimized .bd-idle,body.hud-minimized .bd-chip{opacity:0!important;pointer-events:none!important}
body.bd-on-shift .rl-phone,body.bd-on-shift .rl-handle{opacity:0!important;pointer-events:none!important}

body:has(.rl-offline-pill) .bd-toasts{top:118px}
@keyframes bd-fade{from{opacity:0}to{opacity:1}}
@keyframes bd-rise{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
@keyframes bd-drop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes bd-out{to{opacity:0;transform:translateY(-6px)}}
@keyframes bd-ring{0%,100%{transform:none}10%{transform:rotate(-6deg)}20%{transform:rotate(6deg)}30%{transform:rotate(-4deg)}40%{transform:rotate(0)}}
@media (max-width:760px){.bd-picker{grid-template-columns:1fr;grid-template-rows:auto 160px 1fr}.bd-list{border-right:0;border-bottom:1px solid rgba(255,255,255,.07)}
  .bd-panel{width:230px;top:96px}.bd-grid{grid-template-columns:repeat(2,1fr)}}
`;

const ICONS = {
  bus: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="2.8" width="15" height="16.4" rx="2.4"/><path d="M4.5 11h15M4.5 6.6h15M7.6 15.2h.01M16.4 15.2h.01M7 19.2v2M17 19.2v2"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  bell: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.6 2H4.4zM10 20.5a2 2 0 0 0 4 0"/></svg>',
  person: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="3.4"/><path d="M5.5 21c.4-4.6 2.9-7.6 6.5-7.6s6.1 3 6.5 7.6z"/></svg>',
  doors: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3" width="17" height="18" rx="1.6"/><path d="M12 3v18M8.5 12H10M14 12h1.5"/></svg>'
};
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name]; // constant markup only
  return t.content.firstChild;
}

// ------------------------------------------------------------------------------------------------------------------
// BusDriver
// ------------------------------------------------------------------------------------------------------------------
export class BusDriver {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Camera|() => THREE.Camera} o.camera
   * @param {object} o.controllers  ThirdPersonControllerManager: activeMode, getActiveEntity(), setMode, teleportActiveTo,
   *                                setBusLivery?, setBusDoors?, addCollisionListener?, entities
   * @param {object} o.world        createWorldQueries(GEO) (groundHeight)
   * @param {object} o.geo          GEO (optional: water + roads for the picker's mini map)
   * @param {import('./backend.js').Backend} o.backend
   * @param {object} [o.ui]         { setMode(mode), teleport(x, z, heading), onRouteChange(route, target), onPinsChange(pins),
   *                                  onShiftEnd(result), traffic (signalStateAt), network (road-network route()), renderer,
   *                                  routes (preloaded JSON), routesUrl, busMode ('bus'), container }
   */
  constructor({ scene, camera, controllers, world, geo, backend, ui = {} }) {
    this.scene = scene;
    this._camera = camera;
    this.controllers = controllers;
    this.world = world || {};
    this.geo = geo || {};
    this.backend = backend;
    this.ui = ui;
    this.sfx = new Sfx();
    this.data = ui.routes || null;
    this.shift = null;
    this.phase = 'idle'; // idle | driving | dwell | finishing | done
    this.pickerOpen = false;
    this.sel = { ref: null, dir: 0 };
    this._lastPos = null;
    this._lastSpeed = 0;
    this._uiT = 0;
    this._emitT = 0;
    this._disposed = false;
    this._hookSeen = false;

    this.ribbon = new RouteRibbon(scene);
    this.bay = new BayMarker(scene);
    this.flag = new StopFlag(scene);
    const isWebGL = !!(ui.renderer && ui.renderer.backend && ui.renderer.backend.isWebGLBackend);
    const useRigs = ui.people === 'rig' || (ui.people !== 'simple' && ui.renderer && !isWebGL);
    this.pax = new PaxRenderer(scene, { useRigs, max: 40, ground: (x, z) => this._ground(x, z, 'person') });
    this.people = []; // drawn people (waiting / boarding / alighting / leaving)
    this._pid = 1;

    injectStyle('bd-style', CSS);
    this._buildDom();
    this._bindKeys();
    this._bindCollisions();
    if (!this.data && ui.autoLoad !== false) this._load();
  }

  get camera() { return typeof this._camera === 'function' ? this._camera() : this._camera; }
  /** the player mode for the bus: 'bus' once controllers.js has it, else the black cab (TODO: drop the fallback) */
  get busMode() {
    const c = this.controllers;
    if (this.ui.busMode) return this.ui.busMode;
    if (c && c.entities && c.entities.bus) return 'bus';
    return 'car'; // TODO(C): remove when PLAYER_MODES has 'bus'
  }
  get inBus() { return !!this.controllers && this.controllers.activeMode === this.busMode; }
  get routes() { return this.data ? this.data.routes : []; }

  // ---------------------------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------------------------
  async ready() { if (!this.data) await this._load(); return this.data; }

  openPicker() {
    if (IS_BRUSSELS) {
      this.toast('STIB/MIVB bus driving is available, but Brussels route timetables are not integrated yet.', 'bad');
      return;
    }
    if (this.pickerOpen) return;
    this.pickerOpen = true;
    this._ensurePicker();
    this.pickerEl.style.display = '';
    if (!this.sel.ref && this.routes.length) this.sel.ref = this.routes[0].ref;
    this._renderPicker();
  }
  closePicker() {
    if (!this.pickerOpen) return;
    this.pickerOpen = false;
    if (this.pickerEl) this.pickerEl.style.display = 'none';
  }
  togglePicker() { if (this.pickerOpen) this.closePicker(); else this.openPicker(); }

  /** start a shift on route `ref`, direction 0|1. opts.maxStops truncates the route (tests). Returns true on success. */
  startShift(ref, dir = 0, { maxStops = 0, teleport = true } = {}) {
    const route = this.routes.find((r) => r.ref === String(ref));
    if (!route) { this.toast(`Route ${ref} isn't available`, 'bad'); return false; }
    const v = route.variants[dir] || route.variants[0];
    if (this.shift) this._clearShift();
    this.closePicker();
    this._closeSummary(true);
    let stops = v.stops;
    let track = new PathTrack(v.path);
    if (maxStops && maxStops >= 2 && maxStops < stops.length) {
      stops = stops.slice(0, maxStops);
      const end = Math.min(track.length, stops[stops.length - 1].s + 30);
      const pts = track.points(0, end);
      track = new PathTrack(pts.flatMap((p) => [p.x, p.z]));
    }
    const rng = mulberry32(hashStr(v.id) ^ (Date.now() & 0xffff));
    // timetable: scheduled departure (s after start) from each stop
    const sched = [];
    for (let k = 0; k < stops.length; k++) sched.push(k === 0 ? FIRST_DEPART : sched[k - 1] + (stops[k].s - stops[k - 1].s) / SCHED_SPEED + SCHED_DWELL);
    const headway = 6 + (hashStr(route.ref) % 5); // "every N minutes"
    // passengers waiting at each stop with their destinations
    const waiting = stops.map((st, k) => {
      if (k === stops.length - 1) return [];
      const busy = /station|circus|square|cross|bridge|market|street station|hospital|museum|theatre/i.test(st.name);
      let n = Math.floor(rng() * (busy ? 6 : 4.2)) + (busy ? 1 : 0);
      if (k === 0) n = Math.max(n, 3);
      const list = [];
      for (let i = 0; i < n; i++) {
        const span = stops.length - 1 - k;
        const hop = Math.min(span, 1 + Math.floor(Math.pow(rng(), 1.4) * Math.min(span, 9)));
        list.push(this._makePerson(rng, k + hop));
      }
      return list;
    });
    this.shift = {
      ref: route.ref, variant: v, dir: v.dir ?? dir, stops, track, sched, headway, waiting, rng,
      k: 0, served: new Array(stops.length).fill(false), dev: new Array(stops.length).fill(null),
      aboard: [], carried: 0, alighted: 0, leftBehind: 0, t: 0, dist: 0, s: 0, idx: 0, sMax: 0,
      offT: 0, outT: 0, events: [], comfortLoss: 0, cd: { brake: 0, speed: 0, crash: 0, doors: 0, red: 0 }, brakeT: 0, overT: 0,
      requested: false, doorsOpen: false, dwell: null, startClock: new Date(), lastBellK: -1, signals: new Map(), lastTp: 0
    };
    this.phase = 'driving';
    document.body.classList.add('bd-on-shift');
    // into the bus at the first stop
    if (this.ui.setMode) this.ui.setMode(this.busMode);
    else if (this.controllers && this.controllers.setMode) this.controllers.setMode(this.busMode);
    const c = this.controllers;
    if (c && c.setBusLivery) { try { c.setBusLivery({ route: route.ref, destination: v.destination }); } catch (e) { console.warn('[bus-driver] setBusLivery', e); } }
    this._setDoors(false, true);
    if (teleport) {
      const st = stops[0];
      const p = track.pointAt(this._bayCentre(0), {});
      if (this.ui.teleport) this.ui.teleport(p.x, p.z, p.h);
      else if (c && c.teleportActiveTo) c.teleportActiveTo(p.x, p.z, p.h);
      this._lastPos = null;
    }
    this._showStop(0);
    this._renderPanel(true);
    this._emitRoute(true);
    this.toast(`Route ${route.ref} to ${v.destination} — stop in the bay, press F to open the doors`, 'good', null, 5200);
    return true;
  }

  /** end the current shift early (still saved if at least 2 stops were served) */
  endShift() {
    if (!this.shift || this.phase === 'finishing' || this.phase === 'done') return;
    const served = this.shift.served.filter(Boolean).length;
    if (served >= 2) this._finish(true);
    else { this.toast('Shift cancelled', 'bad'); this._clearShift(); }
  }

  /** open / close the bus doors (key F) */
  toggleDoors() {
    const sh = this.shift;
    if (!sh || this.phase === 'finishing' || this.phase === 'done') { this.toast('Start a shift first — pick a route [J]'); return; }
    if (!this.inBus) return;
    this._setDoors(!sh.doorsOpen);
  }

  /** Remaining GPS route [{x, z}] along the bus route from the bus ([] when off duty) */
  getRoute() {
    const sh = this.shift;
    if (!sh || this.phase === 'done' || this.phase === 'finishing') return [];
    return sh.track.points(sh.s, sh.track.length);
  }
  /** the next stop as a map target { x, z, kind: 'busstop', name, color } or null */
  getTarget() {
    const sh = this.shift;
    if (!sh || sh.k >= sh.stops.length || this.phase === 'done' || this.phase === 'finishing') return null;
    const st = sh.stops[sh.k];
    return { x: st.bx, z: st.bz, kind: 'busstop', name: st.name, color: C_RED_CSS };
  }
  /** all remaining stops as map pins */
  getPins() {
    const sh = this.shift;
    if (!sh) return [];
    return sh.stops.slice(sh.k).map((st) => ({ x: st.bx, z: st.bz, kind: 'busstop', label: st.name }));
  }
  /** for controllers without a collision hook */
  reportCollision(impulse = 6) { this._hookSeen = true; this._onCollision(impulse); }
  /** state snapshot (tests / HUD) */
  getState() {
    const sh = this.shift;
    if (!sh) return { phase: this.phase };
    return { phase: this.phase, ref: sh.ref, k: sh.k, stops: sh.stops.length, aboard: sh.aboard.length, carried: sh.carried,
      alighted: sh.alighted, doorsOpen: sh.doorsOpen, s: sh.s, served: sh.served.filter(Boolean).length,
      waiting: sh.waiting[sh.k] ? sh.waiting[sh.k].length : 0, requested: sh.requested, comfort: this._comfort(), events: sh.events.map((e) => e.kind),
      inBay: !!this._bayInfo?.inBay, dwell: sh.dwell ? { boarding: sh.dwell.board.length, alighting: sh.dwell.alight.length } : null };
  }

  toast(text, kind = '', who = null, ms = 3600, pts = 0) {
    if (!this.toasts) return;
    const t = h('div', `bd-toast bd-glass ${kind}`);
    if (who) {
      t.classList.add('chat');
      const w = h('span');
      w.append(h('span', 'bd-who', `${who}:`), document.createTextNode(` ${text}`));
      t.appendChild(w);
    } else t.appendChild(h('span', '', text));
    if (pts) t.appendChild(h('span', 'bd-pts', `−${pts}`));
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------------------------------------------
  update(dt) {
    if (this._disposed) return;
    dt = clamp(dt || 0, 0, 0.25);
    const ent = this._entity();
    const cam = this.camera;
    this._updateIdleCard();
    if (!ent) return;
    const px = ent.position.x, pz = ent.position.z;
    let step = 0, teleported = false;
    if (this._lastPos) {
      step = Math.hypot(px - this._lastPos.x, pz - this._lastPos.z);
      if (step > 70 * dt + 5) { teleported = true; step = 0; }
    }
    this._lastPos = { x: px, z: pz };
    const speed = Number.isFinite(ent.speed) ? Math.abs(ent.speed) : dt > 0 ? step / dt : 0;
    const sh = this.shift;
    if (sh && (this.phase === 'driving' || this.phase === 'dwell')) {
      sh.t += dt;
      for (const k in sh.cd) sh.cd[k] = Math.max(0, sh.cd[k] - dt);
      if (this.inBus) {
        sh.outT = 0;
        sh.dist += step;
        this._track(px, pz, teleported);
        this._checkDriving(dt, ent, speed, teleported);
        this._checkStops(dt, ent, speed);
      } else {
        sh.outT += dt;
        if (sh.outT > 90) { this.toast('You left the bus — shift abandoned', 'bad'); this._clearShift(); }
      }
    }
    this._lastSpeed = speed;
    if (this.shift) this._updatePeople(dt, ent);
    else if (this.people.length) this.people.length = 0;
    // 3D
    this.ribbon.update(dt);
    this.bay.update(dt, cam ? cam.position : null);
    this.pax.draw(this.people.filter((p) => p.state !== 'alight' || p.out), dt, cam ? cam.position : null);
    // ribbon + map
    if (this.shift && (this.phase === 'driving' || this.phase === 'dwell')) {
      this._ribbonT = (this._ribbonT || 0) - dt;
      if (this._ribbonT <= 0 || teleported) { this._ribbonT = 0.2; this._redrawRibbon(ent); }
      this._emitT -= dt;
      if (this._emitT <= 0) { this._emitT = 1; this._emitRoute(); }
    }
    // HUD
    this._updateLabel();
    this._uiT -= dt;
    if (this._uiT <= 0) { this._uiT = 0.15; this._updateLive(speed); }
  }

  dispose() {
    this._disposed = true;
    this._clearShift();
    this.ribbon.dispose(); this.bay.dispose(); this.flag.dispose(); this.pax.dispose();
    window.removeEventListener('keydown', this._onKey, true);
    if (this._unsubCollision) this._unsubCollision();
    for (const e of [this.root, this.pickerEl, this.sumEl]) if (e) e.remove();
    document.body.classList.remove('bd-on-shift');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Internals: data & world
  // ---------------------------------------------------------------------------------------------------------------
  async _load() {
    try {
      this.data = await loadBusRoutes(this.ui.routesUrl);
      // which routes serve each stop (for the flags): 30 m grid
      this._stopRefs = new Map();
      for (const r of this.data.routes) for (const v of r.variants) for (const st of v.stops) {
        const key = `${Math.round(st.x / 30)},${Math.round(st.z / 30)}`;
        if (!this._stopRefs.has(key)) this._stopRefs.set(key, new Set());
        this._stopRefs.get(key).add(r.ref);
      }
      if (this.pickerOpen) { if (!this.sel.ref) this.sel.ref = this.routes[0]?.ref; this._renderPicker(); }
    } catch (e) {
      console.warn('[bus-driver] could not load bus routes', e);
    }
    return this.data;
  }
  _refsAt(st, own) {
    const out = new Set([own]);
    if (this._stopRefs) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const s = this._stopRefs.get(`${Math.round(st.x / 30) + dx},${Math.round(st.z / 30) + dz}`);
      if (s) for (const r of s) out.add(r);
    }
    return [...out].sort((a, b) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b, 'en', { numeric: true })));
  }
  _entity() {
    const c = this.controllers;
    if (!c) return null;
    return c.getActiveEntity ? c.getActiveEntity() : c.entity || null;
  }
  _ground(x, z, mode = 'car') {
    try { const y = this.world.groundHeight ? this.world.groundHeight(x, z, mode) : 0; return Number.isFinite(y) ? y : 0; } catch { return 0; }
  }
  _makePerson(rng, dest) {
    const coats = [0x1d2433, 0x2b2b2e, 0x3d3a34, 0x24364d, 0x5b4630, 0x6b2430, 0x2f4a3a, 0x8a7a5c, 0x4a4f57, 0x1a1a1c];
    const bright = [0xd8452b, 0xe3b23c, 0x2f7fc1, 0x3aa17e, 0xb04a8f];
    const skins = [0xf1c9a5, 0xe0ac7e, 0xc68c5a, 0x9a6440, 0x6e4a2f, 0x4a3122];
    const hairs = [0x1a1410, 0x3b2a1e, 0x6b4a2b, 0xc9a26a, 0x2a2a2a, 0x8a3b20, 0xb8b2a8];
    const seed = Math.floor(rng() * 1e6);
    return {
      id: this._pid++, seed, dest, name: pick(FIRST_NAMES, rng),
      coat: rng() < 0.28 ? pick(bright, rng) : pick(coats, rng), legs: pick([0x1b1d22, 0x2c2c2c, 0x30394a, 0x4a4036, 0x22262e], rng),
      skin: pick(skins, rng), hair: pick(hairs, rng), skirt: rng() < 0.4, female: rng() < 0.5, scale: 0.9 + rng() * 0.16,
      x: 0, y: 0, z: 0, yaw: 0, moving: false, state: 'waiting', look: 0
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Internals: progress along the route
  // ---------------------------------------------------------------------------------------------------------------
  _track(px, pz, teleported) {
    const sh = this.shift, tr = sh.track;
    let q = tr.project(px, pz, sh.idx - 4, sh.idx + 60);
    if (!q || q.d > 30 || teleported) {
      // re-acquire: anywhere from a bit behind the current position onwards
      const q2 = tr.project(px, pz, tr.indexAt(Math.max(0, sh.s - 60)), tr.n - 1);
      if (q2 && (!q || q2.d < q.d)) q = q2;
    }
    if (!q) return;
    sh.idx = q.i; sh.s = q.s; sh.lat = q.lat; sh.offD = q.d;
    sh.sMax = Math.max(sh.sMax, q.s);
  }

  _checkDriving(dt, ent, speed, teleported) {
    const sh = this.shift;
    // off route
    if (sh.offD > 45) {
      sh.offT += dt;
      if (sh.offT > 3 && !sh.offNoted) { sh.offNoted = true; this.toast('Off route — follow the red line back to the route', 'bad'); }
    } else { sh.offT = 0; sh.offNoted = false; }
    if (teleported) {
      sh.lastTp = sh.t;
      if (!sh.tpNoted && this.phase === 'driving' && sh.t > 2) { sh.tpNoted = true; this.toast('Teleporting on duty… the passengers noticed.', 'bad'); }
      return;
    }
    if (this.phase === 'dwell') return;
    const decel = dt > 0 ? (this._lastSpeed - speed) / dt : 0;
    // collisions without a controller hook: impossible speed drops
    if (!this._hookSeen && this._lastSpeed - speed > 3.5 && decel > 40) this._onCollision(this._lastSpeed - speed);
    // harsh braking with passengers aboard (someone is always standing on a London bus)
    if (sh.aboard.length > 0 && decel > 5.2 && decel < 40 && this._lastSpeed > 3) sh.brakeT += dt;
    else sh.brakeT = Math.max(0, sh.brakeT - dt * 2);
    if (sh.brakeT > 0.3 && sh.cd.brake <= 0) {
      sh.cd.brake = 4; sh.brakeT = 0;
      this._penalty('brake', 'Harsh braking', 4, pick(SAY.brake, sh.rng), pick(sh.aboard, sh.rng).name);
    }
    // speeding
    if (speed > SPEED_LIMIT + 0.4) sh.overT += dt; else sh.overT = Math.max(0, sh.overT - dt);
    if (sh.overT > 3 && sh.cd.speed <= 0) {
      sh.cd.speed = 12; sh.overT = 0;
      this._penalty('speeding', 'Speeding over 30 mph', 3, sh.aboard.length ? pick(SAY.speed, sh.rng) : null, sh.aboard.length ? pick(sh.aboard, sh.rng).name : null);
    }
    // doors open while moving
    if (sh.doorsOpen && speed > 1.5) {
      this._setDoors(false, true);
      if (sh.cd.doors <= 0) { sh.cd.doors = 5; this._penalty('doors', 'Drove off with the doors open', 6, pick(SAY.doors, sh.rng)); }
    }
    // red lights (traffic.signalStateAt → nearest head within 30 m)
    const tf = this.ui.traffic;
    if (tf && tf.signalStateAt && speed > 0.5) {
      let st = null;
      try { st = tf.signalStateAt(ent.position.x, ent.position.z); } catch { st = null; }
      const head = st && st.head;
      if (head && Number.isFinite(head.stopX)) {
        // drivers facing the head travel towards it: dir = -(sin h, cos h)
        const dx = -Math.sin(head.heading), dz = -Math.cos(head.heading);
        const fx = Math.sin(ent.heading), fz = Math.cos(ent.heading);
        if (dx * fx + dz * fz > 0.7) {
          const front = (this._spec()?.zFront ?? 5.6);
          const bx = ent.position.x + fx * front, bz = ent.position.z + fz * front;
          const sd = (bx - head.stopX) * dx + (bz - head.stopZ) * dz; // < 0 before the line
          const prev = sh.signals.get(head.id ?? head);
          sh.signals.set(head.id ?? head, sd);
          if (prev != null && prev < 0 && sd >= 0 && st.aspect === 0 && sh.cd.red <= 0) {
            sh.cd.red = 6;
            this._penalty('redlight', 'Ran a red light', 8, sh.aboard.length ? pick(SAY.redlight, sh.rng) : null);
          }
        }
      }
      if (sh.signals.size > 64) sh.signals.clear();
    }
  }

  _onCollision(impulse) {
    const sh = this.shift;
    if (!sh || this.phase !== 'driving' || impulse < 1.5 || sh.cd.crash > 0) return;
    sh.cd.crash = 2;
    const pts = impulse > 7 ? 15 : impulse > 4 ? 10 : 6;
    this._penalty('crash', 'Collision', pts, sh.aboard.length ? pick(SAY.crash, sh.rng) : null, sh.aboard.length ? pick(sh.aboard, sh.rng).name : null);
  }

  _penalty(kind, label, comfortPts, say = null, who = null) {
    const sh = this.shift;
    if (!sh) return;
    sh.events.push({ kind, label, pts: comfortPts, t: sh.t });
    sh.comfortLoss += comfortPts;
    this.toast(label, 'bad pen', null, 3000, comfortPts);
    if (say) setTimeout(() => this.toast(say, '', who || pick(FIRST_NAMES), 3800), 450);
  }
  _comfort() { return this.shift ? clamp(Math.round(100 - this.shift.comfortLoss), 0, 100) : 100; }

  _bayCentre(k) {
    const sh = this.shift, st = sh.stops[k];
    return clamp(st.s - BAY_BACK, Math.min(6, sh.track.length), sh.track.length);
  }

  _checkStops(dt, ent, speed) {
    const sh = this.shift;
    const k = sh.k;
    if (k >= sh.stops.length) return;
    const st = sh.stops[k];
    const { inBay, along } = this._bayNow();
    this._bayInfo = { inBay, along, stopped: speed < STOP_SPEED, k };
    // stop request (bell) for the next stop
    const req = sh.aboard.some((p) => p.dest === k);
    if (req && !sh.requested && this.phase === 'driving' && sh.lastBellK !== k) {
      sh.lastBellK = k;
      setTimeout(() => {
        if (!this.shift || this.shift.k !== k) return;
        this.shift.requested = true;
        this.sfx.bell();
        this.toast(`Ding ding — stop requested: ${st.name}`, '', null, 3000);
        this._renderPanel();
      }, 1200 + sh.rng() * 2500);
    }
    if (this.phase === 'dwell') {
      this.bay.setState(sh.doorsOpen ? 'dwell' : 'ready');
      this._dwell(dt);
      return;
    }
    this.bay.setState(inBay ? (speed < STOP_SPEED ? 'ready' : 'inbay') : 'approach');
    // passed the stop without serving it
    if (along > MISS_AHEAD + BAY_TOL) this._skipStop(k);
  }

  /** is the bus in the next stop's bay right now? */
  _bayNow() {
    const sh = this.shift;
    if (!sh || sh.k >= sh.stops.length) return { inBay: false, along: 0 };
    const along = sh.s - this._bayCentre(sh.k);
    return { inBay: Math.abs(along) < BAY_TOL && Math.abs(sh.lat ?? 99) < BAY_LAT && (sh.offD ?? 99) < BAY_LAT + 1, along };
  }

  _skipStop(k) {
    const sh = this.shift, st = sh.stops[k];
    const waiting = sh.waiting[k].length;
    const off = sh.aboard.filter((p) => p.dest === k);
    if (waiting > 0 || off.length > 0) {
      const who = off.length ? off[0].name : sh.waiting[k][0]?.name;
      this._penalty('skipped', `Skipped ${st.name}${waiting ? ` (${waiting} waiting)` : ''}`, 6 + Math.min(6, waiting + off.length),
        pick(off.length ? SAY.skipped : SAY.left, sh.rng), who);
      // people who wanted to get off ride on to the next stop (grumbling); the waiting ones are left behind
      for (const p of off) p.dest = Math.min(sh.stops.length - 1, k + 1);
      sh.leftBehind += waiting;
      sh.waiting[k] = [];
    } else if (k > 0) {
      this.toast(`Passed ${st.name} — nobody waiting`, '', null, 2200);
    }
    sh.dev[k] = null;
    this._advance();
  }

  _advance() {
    const sh = this.shift;
    sh.k++;
    sh.requested = false;
    this._bayInfo = null;
    // keep only people still walking away
    this.people = this.people.filter((p) => p.state === 'leaving');
    if (sh.k >= sh.stops.length) { this._finish(false); return; }
    this._showStop(sh.k);
    this._renderPanel(true);
    this._emitRoute(true);
  }

  _showStop(k) {
    const sh = this.shift, st = sh.stops[k];
    const c = sh.track.pointAt(this._bayCentre(k), {});
    // the box sits on the kerb lane at the bay; heading of the road there
    this.bay.show(c.x, this._ground(c.x, c.z) + 0.03, c.z, c.h);
    this.bay.setState('approach');
    // flag at the pavement point, plate sticking out towards the road
    const ax = st.x - st.bx, az = st.z - st.bz, d = Math.hypot(ax, az);
    let fx = st.x, fz = st.z;
    const lx = Math.cos(st.h), lz = -Math.sin(st.h);           // left of travel
    const side = st.side === 'R' ? -1 : 1;
    if (d < 2.5 || d > 14) { fx = st.bx + lx * side * 3.6; fz = st.bz + lz * side * 3.6; }
    // the flag stands a little ahead of the bay along the kerb
    fx += Math.sin(st.h) * 1.5; fz += Math.cos(st.h) * 1.5;
    const yaw = Math.atan2(-lx * side, -lz * side); // local +z towards the road
    this.flag.set(st, this._refsAt(st, sh.ref), fx, this._ground(fx, fz, 'person') + 0.12, fz, yaw);
    sh.flagPos = { x: fx, z: fz, rx: -lx * side, rz: -lz * side, ux: Math.sin(st.h), uz: Math.cos(st.h) };
    // waiting people queue along the kerb behind the flag
    const q = sh.waiting[k];
    q.forEach((p, i) => {
      const back = 1.2 + i * 0.85, out = -0.9 - (i % 2) * 0.7 - (i > 5 ? 0.8 : 0);
      p.x = fx - sh.flagPos.ux * back + sh.flagPos.rx * out;
      p.z = fz - sh.flagPos.uz * back + sh.flagPos.rz * out;
      p.y = this._ground(p.x, p.z, 'person') + 0.12;
      p.yaw = Math.atan2(sh.flagPos.rx, sh.flagPos.rz) + (sh.rng() - 0.5) * 0.8;
      p.state = 'waiting'; p.moving = false; p.wave = false;
    });
    this.people = this.people.filter((p) => p.state === 'leaving').concat(q);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Doors, boarding & alighting
  // ---------------------------------------------------------------------------------------------------------------
  _spec() {
    const e = this._entity();
    return (e && e.model && e.model.userData && e.model.userData.spec) || null;
  }
  _doorPoint(which, out = 0) {
    const e = this._entity(), spec = this._spec();
    const d = spec && spec.doors ? spec.doors[which] : null;
    const z = d ? (d.z0 + d.z1) / 2 : which === 'front' ? DOOR_FRONT_Z : DOOR_MID_Z;
    const hw = spec && spec.halfExtents ? spec.halfExtents.hx : BUS_HALF_W;
    const fx = Math.sin(e.heading), fz = Math.cos(e.heading), lx = Math.cos(e.heading), lz = -Math.sin(e.heading);
    const side = this.shift && this.shift.stops[this.shift.k]?.side === 'R' ? -1 : 1;
    const o = (hw + out) * side;
    return { x: e.position.x + fx * z + lx * o, z: e.position.z + fz * z + lz * o, yaw: Math.atan2(-lx * side, -lz * side) };
  }

  _setDoors(open, silent = false) {
    const sh = this.shift;
    if (!sh) return;
    if (open === sh.doorsOpen) return;
    const ent = this._entity();
    const speed = ent ? Math.abs(ent.speed || 0) : 0;
    if (open && speed > STOP_SPEED + 0.6) { if (!silent) this.toast('Stop the bus before opening the doors'); return; }
    sh.doorsOpen = open;
    const c = this.controllers;
    if (c && c.setBusDoors) { try { c.setBusDoors(open); } catch (e) { console.warn('[bus-driver] setBusDoors', e); } }
    if (!silent) this.sfx.doors(open);
    if (open) {
      const ent2 = this._entity();
      if (ent2) this._track(ent2.position.x, ent2.position.z, false);
      if (this.phase === 'driving' && this._bayNow().inBay) this._startDwell();
      else if (this.phase === 'driving' && !silent) this._penalty('doors', 'Opened the doors away from a stop', 5);
    } else if (this.phase === 'dwell') {
      this._endDwell();
    }
    this._renderPanel();
  }

  _startDwell() {
    const sh = this.shift, k = sh.k;
    this.phase = 'dwell';
    sh.served[k] = true;
    sh.requested = false;
    const alight = sh.aboard.filter((p) => p.dest <= k || k === sh.stops.length - 1);
    sh.aboard = sh.aboard.filter((p) => !alight.includes(p));
    const space = CAPACITY - sh.aboard.length;
    const board = sh.waiting[k].slice(0, Math.max(0, space));
    if (board.length < sh.waiting[k].length) this.toast('Bus full — some passengers have to wait for the next one', 'bad');
    // alighting: out of the middle door one by one; boarding: front door queue
    alight.forEach((p, i) => {
      p.state = 'alight'; p.delay = 0.7 + i * 1.1; p.moving = false; p.t = 0; p.wave = false;
    });
    board.forEach((p, i) => { p.state = 'board'; p.delay = 0.9 + i * 1.25; p.t = 0; p.wave = false; });
    sh.dwell = { t: 0, alight, board, boardedN: 0, alightedN: 0 };
    this.people = this.people.filter((p) => p.state === 'leaving' || board.includes(p) || sh.waiting[k].includes(p)).concat(alight);
    if (!alight.length && !board.length && k < sh.stops.length - 1) this.toast('Nobody getting on or off — close the doors [F]');
    this._renderPanel(true);
  }

  _dwell(dt) {
    const sh = this.shift, dw = sh.dwell;
    if (!dw) return;
    dw.t += dt;
  }

  _endDwell() {
    const sh = this.shift, k = sh.k, dw = sh.dwell;
    // anyone still waiting to board is left behind
    const missed = dw ? dw.board.filter((p) => p.state === 'board' && !p.inDoor) : [];
    if (missed.length) {
      sh.leftBehind += missed.length;
      this._penalty('leftbehind', `Closed the doors on ${missed.length} passenger${missed.length > 1 ? 's' : ''}`, 3 * missed.length, pick(SAY.left, sh.rng), missed[0].name);
    }
    // people still stepping off finish getting off
    for (const p of dw ? dw.alight : []) if (p.state === 'alight') { p.state = 'leaving'; sh.alighted++; }
    for (const p of dw ? dw.board : []) if (p.state === 'board' && p.inDoor) this._boarded(p);
    sh.waiting[k] = [];
    // timetable: departure vs schedule
    const dev = sh.t - sh.sched[k];
    sh.dev[k] = dev;
    const tm = timing(dev);
    if (k < sh.stops.length - 1) {
      if (tm.cls === 'early') this.toast(`Departed ${tm.text} — hold at the stop when you're early`, 'bad');
      else if (tm.cls === 'late') this.toast(`Running ${tm.text}`, '');
      else this.sfx.ok();
    }
    sh.dwell = null;
    this.phase = 'driving';
    this._advance();
  }

  _boarded(p) {
    const sh = this.shift;
    if (p.state === 'aboard') return;
    p.state = 'aboard';
    sh.aboard.push(p);
    sh.carried++;
    if (sh.dwell) sh.dwell.boardedN++;
  }

  _updatePeople(dt, ent) {
    const sh = this.shift;
    const dw = sh.dwell;
    const keep = [];
    for (const p of this.people) {
      if (p.state === 'waiting') {
        // look up the road for the bus; wave when it's close
        const d = Math.hypot(ent.position.x - p.x, ent.position.z - p.z);
        p.wave = d < 70 && d > 12 && this.phase === 'driving' && (p.id % 3 === 0);
        p.look = 0;
        keep.push(p);
      } else if (p.state === 'board') {
        if (!dw || !sh.doorsOpen) { keep.push(p); continue; }
        p.delay -= dt;
        if (p.delay > 0) { keep.push(p); continue; }
        const door = this._doorPoint('front', 0.55);
        const inside = this._doorPoint('front', -0.6);
        const tx = p.inDoor ? inside.x : door.x, tz = p.inDoor ? inside.z : door.z;
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        if (d < 0.12) {
          if (p.inDoor) { this._boarded(p); continue; }
          p.inDoor = true; p.y += 0.25; // step up
        } else {
          const st = Math.min(d, WALK * dt * (p.inDoor ? 0.7 : 1));
          p.x += dx / d * st; p.z += dz / d * st; p.yaw = Math.atan2(dx, dz); p.moving = true;
        }
        keep.push(p);
      } else if (p.state === 'alight') {
        if (!dw || !sh.doorsOpen) { keep.push(p); continue; }
        p.delay -= dt;
        if (p.delay > 0) { keep.push(p); continue; } // still inside, not drawn
        if (!p.out) {
          const s0 = this._doorPoint('middle', -0.5);
          p.x = s0.x; p.z = s0.z; p.y = this._ground(p.x, p.z, 'person') + 0.3; p.out = this._doorPoint('middle', 2.4);
          p.yaw = s0.yaw; p.moving = true;
        }
        const dx = p.out.x - p.x, dz = p.out.z - p.z, d = Math.hypot(dx, dz);
        if (d < 0.15) {
          p.state = 'leaving'; sh.alighted++; dw.alightedN++;
          if (sh.rng() < 0.45) this.toast(pick(SAY.thanks, sh.rng), '', p.name, 2400);
          const dir = sh.rng() < 0.5 ? 1 : -1;
          p.away = { ux: Math.sin(ent.heading) * dir, uz: Math.cos(ent.heading) * dir, t: 0 };
        } else {
          const st = Math.min(d, WALK * dt);
          p.x += dx / d * st; p.z += dz / d * st; p.yaw = Math.atan2(dx, dz);
          p.y = Math.max(this._ground(p.x, p.z, 'person') + 0.12, p.y - dt * 0.8);
        }
        keep.push(p);
      } else if (p.state === 'leaving') {
        if (!p.away) { p.away = { ux: 1, uz: 0, t: 0 }; }
        p.away.t += dt;
        p.x += p.away.ux * WALK * dt; p.z += p.away.uz * WALK * dt;
        p.yaw = Math.atan2(p.away.ux, p.away.uz); p.moving = true;
        p.y = this._ground(p.x, p.z, 'person') + 0.12;
        p.shrink = p.away.t > 9 ? Math.max(0, 1 - (p.away.t - 9) * 2) : 1;
        if (p.away.t < 9.5) keep.push(p);
      }
    }
    this.people = keep;
    // dwell finished? (everyone off and on)
    if (dw && sh.doorsOpen && !dw.doneNoted) {
      const left = dw.board.some((p) => p.state === 'board') || dw.alight.some((p) => p.state === 'alight');
      if (!left && dw.t > 1.2) {
        dw.doneNoted = true;
        if (sh.k === sh.stops.length - 1) {
          this.toast('Everyone off — end of the route!', 'good');
          setTimeout(() => { if (this.shift && this.phase === 'dwell') this._setDoors(false); }, 1200);
        } else this.toast(`${dw.boardedN} on · ${dw.alightedN} off — close the doors [F] and pull away`, 'good', null, 3000);
        this._renderPanel();
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // End of shift
  // ---------------------------------------------------------------------------------------------------------------
  _summary(early) {
    const sh = this.shift, v = sh.variant;
    const servedIdx = sh.served.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    const firstK = servedIdx[0] ?? 0, lastK = servedIdx[servedIdx.length - 1] ?? 0;
    const devs = sh.dev.filter((d, i) => d != null && i < sh.stops.length - 1);
    const onTime = devs.length ? devs.filter((d) => d >= -EARLY_OK && d <= LATE_OK).length / devs.length : 1;
    const routeDist = Math.max(0, sh.stops[lastK].s - sh.stops[firstK].s);
    return {
      route: sh.ref, variant: v.id, destination: v.destination, from: sh.stops[firstK].name, to: sh.stops[lastK].name,
      stops_total: sh.stops.length, stops_served: servedIdx.length, passengers: sh.carried, alighted: sh.alighted, left_behind: sh.leftBehind,
      distance_m: Math.round(Math.max(routeDist, Math.min(sh.dist, routeDist * 1.6 + 200))), odometer_m: Math.round(sh.dist),
      duration_s: Math.round(sh.t), on_time_pct: Math.round(onTime * 100), comfort: this._comfort(), penalties: sh.events.length,
      events: sh.events.map((e) => ({ kind: e.kind, label: e.label, pts: e.pts })), early: !!early, dir: sh.dir
    };
  }

  async _finish(early) {
    const sh = this.shift;
    if (!sh || this.phase === 'finishing' || this.phase === 'done') return;
    this.phase = 'finishing';
    this._setDoors(false, true);
    this.ribbon.hide(); this.bay.hide(); this.flag.hide();
    if (this.ui.onRouteChange) try { this.ui.onRouteChange([], null); } catch { /* ignore */ }
    if (this.ui.onPinsChange) try { this.ui.onPinsChange([]); } catch { /* ignore */ }
    const res = this._summary(early);
    res.estPay = computeBusPay(res);
    this._showSummary(res, null, true);
    let saved = null, err = null;
    try {
      if (this.backend && this.backend.finishBusShift) {
        if (res.stops_served < 2 || res.distance_m < 300) throw new Error('Too short to log — serve at least two stops');
        saved = await this.backend.finishBusShift(res);
      }
    } catch (e) { err = e; console.warn('[bus-driver] save failed', e); }
    let board = null;
    try { if (this.backend && this.backend.busLeaderboard) board = await this.backend.busLeaderboard(6); } catch { /* ignore */ }
    this.lastResult = { ...res, saved, error: err ? err.message : null, leaderboard: board };
    this.phase = 'done';
    this._showSummary(res, this.lastResult, false);
    this._saveToday(res, saved);
    if (this.ui.onShiftEnd) try { this.ui.onShiftEnd(this.lastResult); } catch (e) { console.warn(e); }
  }

  _clearShift() {
    if (this.shift && this.shift.doorsOpen) this._setDoors(false, true);
    this.shift = null;
    this.phase = 'idle';
    this.people = [];
    this.ribbon.hide(); this.bay.hide(); this.flag.hide();
    document.body.classList.remove('bd-on-shift');
    if (this.ui.onRouteChange) try { this.ui.onRouteChange([], null); } catch { /* ignore */ }
    if (this.ui.onPinsChange) try { this.ui.onPinsChange([]); } catch { /* ignore */ }
    this._renderPanel(true);
  }

  _saveToday(res, saved) {
    try {
      const k = 'londonloop_bus_today', day = new Date().toISOString().slice(0, 10);
      let t = safeStorage.get(k);
      if (!t || t.day !== day) t = { day, shifts: 0, passengers: 0, pay: 0 };
      t.shifts++; t.passengers += res.passengers; t.pay = Math.round((t.pay + (saved ? saved.pay : 0)) * 100) / 100;
      safeStorage.set(k, t);
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Route ribbon & map
  // ---------------------------------------------------------------------------------------------------------------
  _redrawRibbon(ent) {
    const sh = this.shift;
    if (!sh || this.phase === 'dwell' && sh.doorsOpen) { this.ribbon.hide(); return; }
    const pts = [];
    if (sh.offD > 12) pts.push({ x: ent.position.x, z: ent.position.z });
    for (const p of sh.track.points(sh.s + (sh.offD > 12 ? 0 : 4), sh.s + RIBBON_M)) pts.push(p);
    this.ribbon.set(pts, (x, z) => this._ground(x, z));
  }

  _emitRoute(pins = false) {
    if (this.ui.onRouteChange) {
      try { this.ui.onRouteChange(this.getRoute(), this.getTarget()); } catch (e) { console.warn('[bus-driver] onRouteChange', e); }
    }
    if (pins && this.ui.onPinsChange) {
      try { this.ui.onPinsChange(this.getPins()); } catch (e) { console.warn('[bus-driver] onPinsChange', e); }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------------------------------------------
  _bindKeys() {
    this._onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (this.sumEl && this.sumEl.style.display !== 'none') {
        if (e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this._closeSummary(); }
        return;
      }
      if (this.pickerOpen) {
        const list = this.routes;
        const i = list.findIndex((r) => r.ref === this.sel.ref);
        let used = true;
        if (e.code === 'Escape' || e.code === 'KeyJ') this.closePicker();
        else if (e.code === 'ArrowDown') this.sel.ref = list[Math.min(list.length - 1, i + 1)]?.ref;
        else if (e.code === 'ArrowUp') this.sel.ref = list[Math.max(0, i - 1)]?.ref;
        else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Tab') this.sel.dir = 1 - this.sel.dir;
        else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.startShift(this.sel.ref, this.sel.dir);
        else used = false;
        if (used) { e.preventDefault(); e.stopImmediatePropagation(); if (this.pickerOpen) this._renderPicker(true); }
        return;
      }
      if (e.code === 'KeyJ' && !e.repeat) this.openPicker();
      else if (e.code === 'KeyF' && !e.repeat && this.shift && this.inBus) { e.preventDefault(); this.toggleDoors(); }
    };
    window.addEventListener('keydown', this._onKey, true);
  }

  _bindCollisions() {
    const c = this.controllers;
    const fn = (e) => {
      this._hookSeen = true;
      const impulse = e && (e.impulse ?? e.speed ?? (e.detail && e.detail.impulse));
      if (e && e.mode && e.mode !== this.busMode) return;
      this._onCollision(Number.isFinite(impulse) ? Math.abs(impulse) : 6);
    };
    if (c && typeof c.addCollisionListener === 'function') {
      const un = c.addCollisionListener(fn);
      this._unsubCollision = typeof un === 'function' ? un : () => c.removeCollisionListener && c.removeCollisionListener(fn);
    } else if (c && typeof c.addEventListener === 'function') {
      c.addEventListener('collision', fn);
      this._unsubCollision = () => c.removeEventListener('collision', fn);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------------------------------------------
  _btn(label, cls, onClick, kbd, ico) {
    const b = h('button', `bd-btn ${cls || ''}`);
    b.type = 'button';
    if (ico) b.appendChild(icon(ico));
    b.appendChild(document.createTextNode(label));
    if (kbd) b.appendChild(h('span', 'bd-kbd', kbd));
    b.addEventListener('click', (e) => { onClick(e); if (e.detail > 0) b.blur(); });
    return b;
  }

  _buildDom() {
    const host = this.ui.container || document.body;
    const root = (this.root = h('div', 'bd-root'));
    // idle launcher card (in the bus, no shift)
    this.idleEl = h('button', 'bd-idle bd-glass hide');
    this.idleEl.type = 'button';
    const ib = h('span', 'bd-mark'); ib.appendChild(icon('bus'));
    const it = h('span'); it.append(h('b', '', 'Bus driver'), h('small', '', 'Pick a route & start a shift'));
    this.idleEl.append(ib, it, h('span', 'bd-kbd', 'J'));
    this.idleEl.addEventListener('click', () => this.openPicker());
    // shift panel
    this.panel = h('section', 'bd-panel bd-glass hide');
    this.panel.setAttribute('aria-label', 'Bus route and stops');
    // chip
    this.chip = h('div', 'bd-chip bd-glass');
    this.chip.setAttribute('aria-live', 'polite');
    this.chipBadge = h('span', 'bd-badge', '');
    const ct = h('div', 'bd-ct');
    this.chipKicker = h('small', '', 'Next stop');
    this.chipName = h('b', '', '');
    ct.append(this.chipKicker, this.chipName);
    this.chipDist = h('span', 'bd-cd', '');
    this.chipWait = h('span', 'bd-pill', '');
    this.chipBell = h('span', 'bd-pill bell off');
    this.chipBell.append(icon('bell'), document.createTextNode('Stop requested'));
    this.chipTime = h('span', 'bd-pill', '');
    this.chip.append(this.chipBadge, ct, this.chipDist, this.chipWait, this.chipBell, this.chipTime);
    // prompt
    this.prompt = h('div', 'bd-prompt bd-glass');
    this.promptMsg = h('div', 'bd-pmsg');
    this.promptBar = h('div', 'bd-bar'); this.promptBarI = h('i'); this.promptBar.appendChild(this.promptBarI);
    this.promptBtn = this._btn('Open doors', 'go', () => this.toggleDoors(), 'F', 'doors');
    this.prompt.append(this.promptMsg, this.promptBar, this.promptBtn);
    // label over the stop
    this.label = h('div', 'bd-label');
    this.labelCode = h('span', 'bd-code', '');
    this.labelText = h('span', '', '');
    this.labelSub = h('small', '', '');
    this.label.append(this.labelCode, this.labelText, this.labelSub);
    this.toasts = h('div', 'bd-toasts');
    root.append(this.idleEl, this.panel, this.chip, this.prompt, this.label, this.toasts);
    host.appendChild(root);
  }

  _updateIdleCard() {
    const show = !this.shift && this.inBus && !this.pickerOpen && !(this.sumEl && this.sumEl.style.display !== 'none');
    if (show !== this._idleShown) { this._idleShown = show; this.idleEl.classList.toggle('hide', !show); }
  }

  // ---- picker ----------------------------------------------------------------------------------------------------
  _ensurePicker() {
    if (this.pickerEl) return;
    const scrim = (this.pickerEl = h('div', 'bd-scrim bd-root'));
    scrim.addEventListener('click', (e) => { if (e.target === scrim) this.closePicker(); });
    const box = h('section', 'bd-picker bd-glass');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Choose a bus route');
    const head = h('div', 'bd-phead');
    const mk = h('span', 'bd-mark'); mk.appendChild(icon('bus'));
    const ht = h('div');
    ht.append(h('h2', '', 'Bus driver'), h('div', 'bd-sub', 'Choose a real London route and direction'));
    const x = h('button', 'bd-x'); x.type = 'button'; x.title = 'Close [Esc]'; x.setAttribute('aria-label', 'Close'); x.appendChild(icon('x'));
    x.addEventListener('click', () => this.closePicker());
    head.append(mk, ht, x);
    this.pList = h('div', 'bd-list');
    this.pList.setAttribute('role', 'listbox');
    this.pDetail = h('div', 'bd-detail');
    box.append(head, this.pList, this.pDetail);
    scrim.appendChild(box);
    (this.ui.container || document.body).appendChild(scrim);
  }

  _renderPicker(keepScroll = false) {
    if (!this.pickerEl) return;
    const routes = this.routes;
    this.pList.textContent = '';
    if (!routes.length) {
      this.pList.appendChild(h('div', 'bd-empty', 'Loading routes…'));
      this.pDetail.textContent = '';
      return;
    }
    if (!routes.some((r) => r.ref === this.sel.ref)) this.sel.ref = routes[0].ref;
    let selEl = null;
    for (const r of routes) {
      const a = r.variants[0], b = r.variants[1] || a;
      const it = h('button', `bd-item${r.ref === this.sel.ref ? ' sel' : ''}`);
      it.type = 'button';
      it.setAttribute('role', 'option');
      const t = h('span', 'bd-it');
      t.append(h('b', '', `${b.destination} ⇄ ${a.destination}`), h('small', '', `${Math.max(a.stops.length, b.stops.length)} stops · ${(Math.max(a.length, b.length) / 1000).toFixed(1)} km`));
      it.append(h('span', 'bd-badge', r.ref), t);
      it.addEventListener('click', () => { this.sel.ref = r.ref; this._renderPicker(true); });
      it.addEventListener('dblclick', () => this.startShift(r.ref, this.sel.dir));
      if (r.ref === this.sel.ref) selEl = it;
      this.pList.appendChild(it);
    }
    if (selEl && keepScroll) selEl.scrollIntoView({ block: 'nearest' });
    const r = routes.find((q) => q.ref === this.sel.ref);
    const v = r.variants[this.sel.dir] || r.variants[0];
    const D = this.pDetail;
    D.textContent = '';
    const top = h('div', 'bd-dtop');
    const blind = h('div', 'bd-blind');
    blind.append(h('span', 'n', r.ref), h('span', 'd', v.destination));
    top.append(h('span', 'bd-badge lg', r.ref), blind);
    const dirs = h('div', 'bd-dirs');
    r.variants.forEach((vv, i) => {
      const b = h('button', `bd-dir${i === this.sel.dir ? ' sel' : ''}`, `→ ${vv.destination}`);
      b.type = 'button';
      b.title = `${vv.from} → ${vv.to}`;
      b.addEventListener('click', () => { this.sel.dir = i; this._renderPicker(true); });
      dirs.appendChild(b);
    });
    const est = v.length / SCHED_SPEED + v.stops.length * SCHED_DWELL;
    const grid = h('div', 'bd-grid');
    for (const [k, val] of [['Stops', String(v.stops.length)], ['Length', `${(v.length / 1000).toFixed(1)} km`], ['Est. time', `${Math.round(est / 60)} min`],
      ['Every', `${6 + (hashStr(r.ref) % 5)} min`]]) {
      const s = h('div', 'bd-stat'); s.append(h('span', '', k), h('b', '', val)); grid.appendChild(s);
    }
    const mapWrap = h('div', 'bd-mapwrap');
    const cv = h('canvas');
    mapWrap.appendChild(cv);
    const ends = h('div', 'bd-ends');
    const l1 = h('span', 'bd-leg'); l1.append(h('i', 'bd-dot'), h('b', '', v.firstStop));
    const l2 = h('span', 'bd-leg'); l2.append(h('i', 'bd-dot end'), h('b', '', v.lastStop));
    ends.append(l1, h('span', '', '→'), l2);
    const foot = h('div', 'bd-pfoot');
    const note = h('div', 'bd-note', `${v.from} → ${v.to}. You drive the part inside Zone 1. Stop in the bay under 2 mph, F opens the doors.`);
    const go = this._btn('Start shift', 'primary', () => this.startShift(r.ref, this.sel.dir), 'Enter', 'bus');
    foot.append(note, go);
    D.append(top, dirs, grid, mapWrap, ends, foot);
    requestAnimationFrame(() => this._drawMiniMap(cv, r, v));
  }

  _drawMiniMap(cv, r, v) {
    const W = cv.clientWidth || 480, H = cv.clientHeight || 220, dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#15171b'; g.fillRect(0, 0, W, H);
    const p = v.path;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 2) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]); }
    const pad = 22, sc = Math.min((W - 2 * pad) / Math.max(200, maxX - minX), (H - 2 * pad) / Math.max(200, maxZ - minZ));
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const X = (x) => W / 2 + (x - cx) * sc, Y = (z) => H / 2 + (z - cz) * sc;
    const vx0 = cx - W / 2 / sc, vx1 = cx + W / 2 / sc, vz0 = cz - H / 2 / sc, vz1 = cz + H / 2 / sc;
    const vis = (pts) => { for (let i = 0; i < pts.length; i += 2) if (pts[i] > vx0 && pts[i] < vx1 && pts[i + 1] > vz0 && pts[i + 1] < vz1) return true; return false; };
    const poly = (pts, close) => { g.beginPath(); for (let i = 0; i < pts.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(pts[i]), Y(pts[i + 1])); if (close) g.closePath(); };
    // parks, Thames
    for (const pk of this.geo.parks || []) if (pk.pts && pk.pts.length > 5 && vis(pk.pts) && (pk.kind === 'park' || pk.kind === 'garden')) { poly(pk.pts, true); g.fillStyle = '#1b2a21'; g.fill(); }
    for (const w of this.geo.water || []) if (w.pts && vis(w.pts)) { poly(w.pts, true); g.fillStyle = '#1b3046'; g.fill(); }
    // roads
    const major = { motorway: 2.2, trunk: 2.2, primary: 1.8, secondary: 1.4, tertiary: 1.0 };
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const rd of this.geo.roads || []) {
      const lw = major[rd.kind];
      if (!lw || !vis(rd.pts)) continue;
      poly(rd.pts); g.strokeStyle = 'rgba(255,255,255,.13)'; g.lineWidth = lw; g.stroke();
    }
    // other routes faintly
    for (const o of this.routes) if (o !== r) { const ov = o.variants[0]; if (vis(ov.path)) { poly(ov.path); g.strokeStyle = 'rgba(227,40,62,.16)'; g.lineWidth = 1.6; g.stroke(); } }
    // this route
    poly(p); g.strokeStyle = 'rgba(227,40,62,.35)'; g.lineWidth = 9; g.stroke();
    poly(p); g.strokeStyle = C_RED_CSS; g.lineWidth = 3.6; g.stroke();
    v.stops.forEach((st, i) => {
      const end = i === 0 || i === v.stops.length - 1;
      g.beginPath(); g.arc(X(st.bx), Y(st.bz), end ? 5 : 2.8, 0, Math.PI * 2);
      g.fillStyle = '#fff'; g.fill(); g.lineWidth = end ? 3 : 1.6; g.strokeStyle = C_RED_CSS; g.stroke();
    });
    const lab = (st, align) => {
      const x = X(st.bx), y = Y(st.bz);
      g.font = '700 11px Inter, system-ui, sans-serif';
      const t = st.name.length > 26 ? st.name.slice(0, 25) + '…' : st.name;
      const w = g.measureText(t).width + 12;
      let lx = x + 9, ly = y - 9;
      if (lx + w > W - 4) lx = x - 9 - w;
      ly = clamp(ly, 4, H - 22);
      g.fillStyle = 'rgba(16,17,20,.85)'; roundRect(g, lx, ly, w, 18, 6); g.fill();
      g.fillStyle = '#f6f5f2'; g.textBaseline = 'middle'; g.fillText(t, lx + 6, ly + 9.5);
      void align;
    };
    lab(v.stops[0]); lab(v.stops[v.stops.length - 1]);
    // scale bar
    const m = 1000 * sc > W * 0.4 ? 500 : 1000;
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(12, H - 12); g.lineTo(12 + m * sc, H - 12); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '600 10px Inter, system-ui, sans-serif'; g.textBaseline = 'bottom'; g.fillText(m === 1000 ? '1 km' : '500 m', 12, H - 15);
  }

  // ---- shift panel ------------------------------------------------------------------------------------------------
  _renderPanel(full = false) {
    const sh = this.shift;
    const show = !!sh && this.phase !== 'done' && this.phase !== 'finishing';
    this.panel.classList.toggle('hide', !show);
    this.chip.classList.toggle('show', show);
    if (!show) { this.prompt.classList.remove('show'); this.label.style.display = 'none'; return; }
    const v = sh.variant;
    if (full || !this._panelBuilt) {
      this._panelBuilt = true;
      const P = this.panel;
      P.textContent = '';
      const head = h('div', 'bd-pnhead');
      const pt = h('div', 'bd-pt');
      pt.append(h('b', '', `to ${v.destination}`), h('small', '', `Every ${sh.headway} min · ${sh.stops.length} stops`));
      const x = h('button', 'bd-x'); x.type = 'button'; x.title = 'End shift'; x.setAttribute('aria-label', 'End shift'); x.appendChild(icon('x'));
      x.addEventListener('click', () => this.endShift());
      head.append(h('span', 'bd-badge', sh.ref), pt, x);
      this.progI = h('i');
      const prog = h('div', 'bd-prog'); prog.appendChild(this.progI);
      const stats = h('div', 'bd-stats');
      this.stEls = {};
      for (const [k, l] of [['aboard', 'Aboard'], ['carried', 'Carried'], ['comfort', 'Comfort'], ['time', 'Timing']]) {
        const s = h('div', 'bd-stat'), b = h('b', '', '—'); s.append(h('span', '', l), b); stats.appendChild(s); this.stEls[k] = b;
      }
      this.stopsEl = h('div', 'bd-stops');
      const foot = h('div', 'bd-pnfoot');
      this.doorBtn = this._btn('Doors', 'doors', () => this.toggleDoors(), 'F', 'doors');
      foot.append(this.doorBtn, this._btn('End shift', '', () => this.endShift()));
      P.append(head, prog, stats, this.stopsEl, foot);
    }
    // stops list: last served + next 6
    const L = this.stopsEl;
    L.textContent = '';
    const from = Math.max(0, sh.k - 1), to = Math.min(sh.stops.length, sh.k + 7);
    const t0 = sh.startClock.getTime();
    for (let i = from; i < to; i++) {
      const st = sh.stops[i];
      const row = h('div', `bd-st${i < sh.k ? ' done' : i === sh.k ? ' next' : ''}`);
      const nm = h('div', 'bd-sn');
      nm.appendChild(document.createTextNode(st.name));
      const due = new Date(t0 + sh.sched[i] * 1000);
      nm.appendChild(h('small', '', i < sh.k ? (sh.dev[i] != null ? `Departed · ${timing(sh.dev[i]).text}` : 'Not served') : `Due ${fmtClock(due)}`));
      row.appendChild(h('span', 'bd-code', st.code || '·'));
      row.appendChild(nm);
      if (i >= sh.k) {
        const req = sh.aboard.some((p) => p.dest === i);
        if (req && (i > sh.k || sh.requested)) { const b = h('span', 'bd-bell'); b.title = 'Stop requested'; b.appendChild(icon('bell')); row.appendChild(b); }
        const n = sh.waiting[i].length;
        if (n) { const w = h('span', 'bd-wait'); w.title = `${n} waiting`; w.append(icon('person'), document.createTextNode(String(n))); row.appendChild(w); }
      }
      L.appendChild(row);
      if (i === sh.k && full) requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }));
    }
    this.doorBtn.classList.toggle('open', sh.doorsOpen);
    this.doorBtn.childNodes[1].textContent = sh.doorsOpen ? 'Close doors' : 'Open doors';
    this._updateLive(this._lastSpeed || 0);
  }

  _updateLive(speed) {
    const sh = this.shift;
    if (!sh || this.phase === 'done' || this.phase === 'finishing') {
      this.prompt.classList.remove('show');
      return;
    }
    const st = sh.stops[sh.k];
    if (!st) return;
    // chip
    this.chipBadge.textContent = sh.ref;
    this.chipKicker.textContent = this.phase === 'dwell' ? (sh.k === sh.stops.length - 1 ? 'Terminating here' : 'At the stop')
      : sh.k === sh.stops.length - 1 ? 'Last stop' : sh.k === 0 && !sh.served[0] ? 'First stop' : 'Next stop';
    this.chipName.textContent = `${st.code ? st.code + ' · ' : ''}${st.name}`;
    const dist = Math.max(0, this._bayCentre(sh.k) - sh.s);
    this.chipDist.textContent = this.phase === 'dwell' || dist < 8 ? '' : fmtDist(dist);
    const n = sh.waiting[sh.k].length;
    this.chipWait.textContent = '';
    this.chipWait.append(icon('person'), document.createTextNode(n ? `${n} waiting` : 'Nobody waiting'));
    this.chipBell.classList.toggle('off', !sh.requested);
    // timing now (vs where we should be)
    const due = this._schedAt(sh.s);
    const tm = this.phase === 'dwell' ? timing(sh.t - sh.sched[sh.k]) : timing(sh.t - due);
    this.chipTime.className = `bd-pill ${tm.cls}`;
    this.chipTime.textContent = tm.text;
    // panel stats
    if (this.stEls) {
      this.stEls.aboard.textContent = String(sh.aboard.length);
      this.stEls.carried.textContent = String(sh.carried);
      const cf = this._comfort();
      this.stEls.comfort.textContent = `${cf}%`;
      this.stEls.comfort.style.color = cf >= 85 ? '' : cf >= 60 ? 'var(--bd-warn)' : 'var(--bd-bad)';
      const lateS = this.phase === 'dwell' ? sh.t - sh.sched[sh.k] : sh.t - due;
      this.stEls.time.textContent = Math.abs(lateS) < 60 ? '0' : `${lateS > 0 ? '+' : '−'}${Math.round(Math.abs(lateS) / 60)}m`;
      this.stEls.time.style.color = tm.cls === 'late' ? 'var(--bd-bad)' : tm.cls === 'early' ? 'var(--bd-warn)' : '';
      this.progI.style.transform = `scaleX(${clamp(sh.s / Math.max(1, sh.track.length), 0, 1)})`;
    }
    // prompt
    const info = this._bayInfo || {};
    let msg = null, sub = '', bar = null, btn = null;
    if (!this.inBus) { msg = 'Get back in the bus'; sub = `Your passengers are waiting (${sh.aboard.length} aboard)`; }
    else if (this.phase === 'dwell') {
      const dw = sh.dwell;
      if (sh.doorsOpen && dw) {
        const tot = dw.board.length + dw.alight.length;
        const done = dw.boardedN + dw.alightedN;
        const early = sh.t - sh.sched[sh.k];
        if (done < tot) { msg = `Boarding · ${dw.boardedN}/${dw.board.length} on · ${dw.alightedN}/${dw.alight.length} off`; bar = tot ? done / tot : 1; btn = 'Close doors'; }
        else if (early < -EARLY_OK && sh.k < sh.stops.length - 1) { msg = `Running early — wait ${fmtDur(-early - EARLY_OK + 1)}`; sub = 'Hold at the stop to keep to the timetable'; btn = 'Close doors'; }
        else { msg = sh.k === sh.stops.length - 1 ? 'End of the route' : 'All aboard'; sub = sh.k === sh.stops.length - 1 ? '' : 'Close the doors and pull away'; btn = 'Close doors'; }
      }
    } else if (info.inBay && speed < STOP_SPEED) { msg = `At ${st.name}`; sub = n ? `${n} waiting${sh.requested ? ' · stop requested' : ''}` : sh.requested ? 'Stop requested' : 'Open the doors to serve the stop'; btn = 'Open doors'; }
    else if (info.inBay) { msg = 'In the bay — come to a stop'; sub = 'Below 2 mph to open the doors'; }
    else if (dist < 60 && (n || sh.requested || sh.k === sh.stops.length - 1)) { msg = 'Pull into the bay'; sub = `${st.name} · ${fmtDist(dist)}`; }
    if (msg) {
      this.promptMsg.textContent = msg;
      if (sub) this.promptMsg.appendChild(h('small', '', sub));
      this.promptBar.style.display = bar == null ? 'none' : '';
      if (bar != null) this.promptBarI.style.transform = `scaleX(${clamp(bar, 0, 1)})`;
      this.promptBtn.style.display = btn ? '' : 'none';
      if (btn) this.promptBtn.childNodes[1].textContent = btn;
      this.prompt.classList.add('show');
    } else this.prompt.classList.remove('show');
    if (this.doorBtn) {
      this.doorBtn.classList.toggle('open', sh.doorsOpen);
      this.doorBtn.childNodes[1].textContent = sh.doorsOpen ? 'Close doors' : 'Open doors';
    }
  }

  /** the timetable's time (s after start) for being at arc length s */
  _schedAt(s) {
    const sh = this.shift;
    const k = sh.k;
    if (k === 0) return sh.sched[0];
    const a = sh.stops[k - 1], b = sh.stops[k];
    const t = clamp((s - a.s) / Math.max(1, b.s - a.s), 0, 1);
    return sh.sched[k - 1] + t * (sh.sched[k] - SCHED_DWELL - sh.sched[k - 1]);
  }

  _updateLabel() {
    const sh = this.shift, cam = this.camera;
    if (!sh || !cam || !sh.flagPos || this.phase === 'done' || this.phase === 'finishing') { this.label.style.display = 'none'; return; }
    const st = sh.stops[sh.k];
    const v = (this._v3 ||= new THREE.Vector3()).set(sh.flagPos.x, this._ground(sh.flagPos.x, sh.flagPos.z) + 3.8, sh.flagPos.z);
    const d = cam.position.distanceTo(v);
    v.project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05 || d > 600 || d < 6) { this.label.style.display = 'none'; return; }
    const X = (v.x * 0.5 + 0.5) * innerWidth, Y = (-v.y * 0.5 + 0.5) * innerHeight;
    this.label.style.display = 'flex';
    this.label.style.transform = `translate(${Math.round(X)}px, ${Math.round(Y)}px) translate(-50%, -100%)`;
    this.labelCode.textContent = st.code || '•';
    this.labelText.textContent = st.name;
    const n = sh.waiting[sh.k].length;
    this.labelSub.textContent = n ? `· ${n} waiting` : '';
  }

  // ---- summary ----------------------------------------------------------------------------------------------------
  _showSummary(res, final, pending) {
    if (!this.sumEl) {
      this.sumEl = h('div', 'bd-scrim bd-root');
      (this.ui.container || document.body).appendChild(this.sumEl);
    }
    const S = this.sumEl;
    S.style.display = '';
    S.textContent = '';
    const box = h('section', 'bd-sum bd-glass');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Shift summary');
    const top = h('div', 'bd-sumtop');
    const tt = h('div');
    tt.append(h('h2', '', res.early ? 'Shift ended early' : 'Shift complete'), h('div', 'bd-route', `${res.from} → ${res.to}`));
    top.append(h('span', 'bd-badge lg', res.route), tt);
    const pay = h('div', 'bd-pay');
    const pv = h('div');
    const amt = final && final.saved ? final.saved.pay : res.estPay;
    pv.append(h('div', 'bd-pl', pending ? 'Calculating pay…' : final && final.saved ? 'Shift pay' : 'Estimated pay (not saved)'), h('div', 'bd-amt', fmtMoney(amt)));
    pay.appendChild(pv);
    if (final && final.saved) {
      const rk = h('div', 'bd-rank');
      rk.append(h('b', '', final.saved.rank ? `#${final.saved.rank}` : '—'), document.createTextNode(`on the bus board · ${fmtMoney(final.saved.earnings)} total`));
      pay.appendChild(rk);
    }
    const grid = h('div', 'bd-grid');
    const stat = (k, v, meter, col) => {
      const s = h('div', 'bd-stat'); s.append(h('span', '', k), h('b', '', v));
      if (meter != null) { const m = h('div', 'bd-meter'), i = h('i'); i.style.width = `${clamp(meter, 0, 100)}%`; i.style.background = col; m.appendChild(i); s.appendChild(m); }
      grid.appendChild(s);
    };
    const col = (v) => (v >= 85 ? 'var(--bd-ok)' : v >= 60 ? 'var(--bd-warn)' : 'var(--bd-bad)');
    stat('Passengers', String(res.passengers));
    stat('Stops served', `${res.stops_served}/${res.stops_total}`);
    stat('Distance', fmtDist(res.distance_m));
    stat('On time', `${res.on_time_pct}%`, res.on_time_pct, col(res.on_time_pct));
    stat('Comfort', `${res.comfort}%`, res.comfort, col(res.comfort));
    stat('Shift time', fmtDur(res.duration_s));
    box.append(top, pay, grid);
    box.appendChild(h('div', 'bd-sec', 'Driving record'));
    const evs = h('div', 'bd-evs');
    if (!res.events.length) evs.appendChild(h('span', 'bd-ev clean', 'Clean shift — no penalties'));
    const counts = new Map();
    for (const e of res.events) counts.set(e.label.replace(/ \(.*\)$/, '').replace(/^Skipped .*/, 'Skipped a stop'), (counts.get(e.label.replace(/ \(.*\)$/, '').replace(/^Skipped .*/, 'Skipped a stop')) || 0) + 1);
    for (const [l, n] of counts) evs.appendChild(h('span', 'bd-ev', n > 1 ? `${l} ×${n}` : l));
    if (res.left_behind) evs.appendChild(h('span', 'bd-ev', `${res.left_behind} left at stops`));
    box.appendChild(evs);
    if (final && final.error) box.appendChild(h('div', 'bd-err', `Not saved: ${final.error}`));
    if (final && final.leaderboard && final.leaderboard.length) {
      box.appendChild(h('div', 'bd-sec', 'Bus drivers leaderboard'));
      const lb = h('div', 'bd-lb');
      const me = this.backend && this.backend.name;
      final.leaderboard.forEach((r, i) => {
        const li = h('div', `bd-li${r.name === me ? ' me' : ''}`);
        const nm = h('span', 'n', r.name); nm.appendChild(h('small', '', `${r.shifts} shift${r.shifts === 1 ? '' : 's'} · ${r.passengers} pax · ${r.on_time ?? '—'}% on time`));
        li.append(h('span', 'r', String(i + 1)), nm, h('span', 'a', fmtMoney(r.earnings)));
        lb.appendChild(li);
      });
      box.appendChild(lb);
    }
    const foot = h('div', 'bd-sumfoot');
    const route = this.routes.find((r) => r.ref === res.route);
    if (route && route.variants.length > 1 && !pending) {
      const other = 1 - (res.dir ?? 0);
      const back = this._btn(`Back to ${route.variants[other].destination}`, 'primary ret', () => { this._closeSummary(); this.startShift(res.route, other); });
      back.title = `Drive route ${res.route} back to ${route.variants[other].destination}`;
      foot.appendChild(back);
    }
    foot.appendChild(this._btn('Choose route', '', () => { this._closeSummary(); this.openPicker(); }));
    foot.appendChild(this._btn('Done', '', () => this._closeSummary(), 'Enter'));
    box.appendChild(foot);
    S.appendChild(box);
  }

  _closeSummary(instant = false) {
    if (!this.sumEl || this.sumEl.style.display === 'none') return;
    this.sumEl.style.display = 'none';
    if (this.phase === 'done') { this.shift = null; this.phase = 'idle'; document.body.classList.remove('bd-on-shift'); this._renderPanel(true); }
    void instant;
  }
}
