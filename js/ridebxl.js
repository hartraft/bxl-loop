// js/ridebxl.js — RideBXL: an Uber-style ride-hail game for Brussels Loop (fictional brand, Workstream D).
//
//   const ridebxl = new RideBXL({ scene, camera, controllers, world, geo: GEO, backend, ui: { setMode } });
//   ridebxl.update(dt);         // every frame, after controllers.update()
//   ridebxl.getRoute();         // [{x, z}, …] remaining GPS route (car -> current pin), [] when there is none
//   ridebxl.getTarget();        // { x, z, kind: 'pickup' | 'dropoff', name } | null
//
// Only plays in the 'ride' mode (the RideBXL car). Builds its own DOM (phone panel, HUD chip, toasts, pin label,
// edge arrow) with scoped .rl- styles, and its own 3D markers (pin beam, waiting passenger, route ribbon).

import * as THREE from 'three/webgpu';
import { LANDMARK_ANCHORS, toWorld } from './geo-frame.js';
import { computeFare, injectStyle, safeStorage } from './backend.js';

// ------------------------------------------------------------------------------------------------------------------
// Tunables
// ------------------------------------------------------------------------------------------------------------------
const RIDE_MODES = ['ride'];
const NON_DRIVABLE = new Set(['pedestrian', 'footway', 'cycleway', 'steps', 'path', 'track', 'bridleway', 'corridor', 'platform',
  'construction', 'proposed', 'bus_guideway', 'raceway', 'elevator']);
const PIN_KINDS = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'];
const SKIP_POI_KINDS = new Set(['fast_food', 'police']);
const POI_WEIGHT = { attraction: 2, theatre: 2, museum: 2, hotel: 2, pub: 1.5, monument: 2, hospital: 1.5, university: 1.5 };
const OFFER_MIN_S = 10;
const OFFER_MAX_S = 25;
const OFFER_TIMEOUT_S = 15;
const STOP_RADIUS = 8; // m
const STOP_SPEED = 3 / 2.237; // 3 mph in m/s
const STOP_HOLD_S = 1.5;
const SPEED_LIMIT = 35 / 2.237; // 35 mph
const ROUTE_DRAW_M = 600;
const PICKUP_GIVE_UP_S = 300;
const AVG_SPEED = 7.5; // m/s, for ETAs (Brussels traffic ~17 mph)
const C_PICKUP = 0x3ee6b4;
const C_DROPOFF = 0xff5fa2;
const MPH = 2.237;

const PASSENGERS = ['Amira', 'Tom', 'Priya', 'Kwame', 'Siobhan', 'Olu', 'Jess', 'Mehmet', 'Ffion', 'Raj', 'Chloe', 'Dev', 'Hannah',
  'Tunde', 'Zara', 'Alfie', 'Ngozi', 'Callum', 'Yasmin', 'Freddie', 'Aisha', 'Billy', 'Marta', 'Kofi', 'Imogen', 'Jamal', 'Rosie',
  'Hamza', 'Poppy', 'Wei', 'Declan', 'Leila', 'Gus', 'Esme', 'Nikhil', 'Bea', 'Ruairi', 'Sade', 'Archie', 'Mei'];

const CHAT = {
  board: ['Alright? Cheers for coming.', 'Evening! Sorry, I was by the wrong door.', 'Hiya — mind if I charge my phone?',
    "Lovely, thanks. Don't go via the Embankment, it's rammed.", 'Cheers mate. Long day.', 'Hello! Is this the RideBXL? Brilliant.'],
  cruise: ['Is it me or is it always drizzling?', "I've lived here ten years and still can't find a decent bagel south of the river.",
    "My mate says it's quicker on the Tube. My mate is wrong.", 'Ooh, is that the Shard? Never gets old.', 'Can you believe what they charge for a pint round here?',
    "Sorry, I'm just on a call — yeah, I'm in the car, ten minutes.", 'You do the Knowledge or just the app?', 'This is the bit where the satnav always panics.',
    "I'd have walked but, you know. Brussels.", 'Do you get many tourists asking for Platform 9¾?', 'Love this song. Can you turn it up a bit?',
    'Mad how many cranes there are now.'],
  speeding: ['Er… are we late for something?', "Bit quick, isn't it?", 'I would like to arrive alive, please.', "Steady on, Lewis Hamilton!"],
  brake: ['Woah! My coffee!', 'Easy on the brakes, mate.', 'Whiplash. Lovely.'],
  crash: ['OI! What was that?!', "That's coming out of your rating.", 'Are you actually allowed to drive?', 'Mate! My neck!'],
  teleport: ['Hang on… how did we get here so fast?', 'Did we just… skip a bit?'],
  slow: ['Are we going the scenic route?', 'I could have walked this by now.', 'Is the meter running on this detour?'],
  late: ['Finally.', 'That took a while, eh?'],
  happy: ['Cheers, that was smooth!', "Brilliant, five stars from me.", 'Ta very much — have a good one!', 'Perfect, thanks driver!'],
  meh: ['Thanks… I think.', 'Right. Cheers.', "Well, I'm here."],
  waiting: ["Where are you? I'm by the kerb.", "I'm the one waving.", 'Just round the corner, yeah?']
};

const NO_ROUTE_SERVICE = /driveway|parking_aisle|drive-through|emergency_access|private/;
function defaultDrivable(r) {
  if (NON_DRIVABLE.has(r.kind) || r.sub === 'sidewalk' || r.sub === 'crossing') return false;
  return !(r.kind === 'service' && NO_ROUTE_SERVICE.test(r.sub || ''));
}

// ------------------------------------------------------------------------------------------------------------------
// Road graph + A* (over GEO.roads polylines; shared vertices snapped together)
// ------------------------------------------------------------------------------------------------------------------
export class RoadGraph {
  constructor(roads, { isDrivable = defaultDrivable } = {}) {
    const keyToId = new Map();
    const xs = [];
    const zs = [];
    const eFrom = [];
    const eTo = [];
    const eLen = [];
    const eWrong = [];
    const nodeId = (x, z) => {
      const k = (Math.round(x * 2) + 1048576) * 2097152 + (Math.round(z * 2) + 1048576);
      let id = keyToId.get(k);
      if (id === undefined) {
        id = xs.length;
        keyToId.set(k, id);
        xs.push(x);
        zs.push(z);
      }
      return id;
    };
    for (const r of roads || []) {
      if (!r || !r.pts || r.pts.length < 4 || !isDrivable(r)) continue;
      const p = r.pts;
      const ow = r.oneway || 0;
      let prev = nodeId(p[0], p[1]);
      for (let i = 2; i + 1 < p.length; i += 2) {
        const cur = nodeId(p[i], p[i + 1]);
        if (cur === prev) continue;
        const len = Math.hypot(xs[cur] - xs[prev], zs[cur] - zs[prev]);
        eFrom.push(prev, cur);
        eTo.push(cur, prev);
        eLen.push(len, len);
        eWrong.push(ow === -1 ? 1 : 0, ow === 1 ? 1 : 0);
        prev = cur;
      }
    }
    const n = xs.length;
    this.n = n;
    this.x = Float64Array.from(xs);
    this.z = Float64Array.from(zs);
    const start = new Int32Array(n + 1);
    for (const f of eFrom) start[f + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const fill = start.slice(0, n);
    const m = eFrom.length;
    this.start = start;
    this.to = new Int32Array(m);
    this.len = new Float32Array(m);
    this.wrong = new Uint8Array(m);
    for (let e = 0; e < m; e++) {
      const slot = fill[eFrom[e]]++;
      this.to[slot] = eTo[e];
      this.len[slot] = eLen[e];
      this.wrong[slot] = eWrong[e];
    }
    // spatial hash for nearest-node queries
    this.cell = 60;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const k = this._cellKey(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(i);
    }
    this._g = new Float64Array(n);
    this._from = new Int32Array(n);
    this._stamp = new Uint32Array(n);
    this._closed = new Uint32Array(n);
    this._gen = 0;
  }

  _cellKey(cx, cz) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  nearestNode(x, z, maxR = 400, needOut = true) {
    const c = this.cell;
    const cx = Math.floor(x / c);
    const cz = Math.floor(z / c);
    let best = -1;
    let bestD = maxR * maxR;
    const rings = Math.ceil(maxR / c);
    for (let r = 0; r <= rings; r++) {
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const a = this.grid.get(this._cellKey(cx + i, cz + j));
          if (!a) continue;
          for (const id of a) {
            if (needOut && this.start[id + 1] === this.start[id]) continue;
            const d = (this.x[id] - x) ** 2 + (this.z[id] - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = id;
            }
          }
        }
      }
      if (best >= 0 && (r * c) ** 2 > bestD) break;
    }
    return best;
  }

  /** A* node path s -> t; strict = obey one-way streets (otherwise wrong-way edges cost 6×) */
  astar(s, t, strict = true, maxIter = 600000) {
    if (s < 0 || t < 0) return null;
    if (s === t) return [s];
    const gen = ++this._gen;
    const { x, z, start, to, len, wrong, _g: g, _from: from, _stamp: stamp, _closed: closed } = this;
    const tx = x[t];
    const tz = z[t];
    const heapId = [];
    const heapF = [];
    const push = (id, f) => {
      let i = heapId.length;
      heapId.push(id);
      heapF.push(f);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heapId[i] = heapId[p];
        heapF[i] = heapF[p];
        i = p;
      }
      heapId[i] = id;
      heapF[i] = f;
    };
    const pop = () => {
      const top = heapId[0];
      const lastId = heapId.pop();
      const lastF = heapF.pop();
      const n = heapId.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= n) break;
          const r = l + 1;
          const c = r < n && heapF[r] < heapF[l] ? r : l;
          if (heapF[c] >= lastF) break;
          heapId[i] = heapId[c];
          heapF[i] = heapF[c];
          i = c;
        }
        heapId[i] = lastId;
        heapF[i] = lastF;
      }
      return top;
    };
    stamp[s] = gen;
    g[s] = 0;
    from[s] = -1;
    push(s, Math.hypot(x[s] - tx, z[s] - tz));
    let iter = 0;
    while (heapId.length && iter++ < maxIter) {
      const u = pop();
      if (closed[u] === gen) continue;
      closed[u] = gen;
      if (u === t) {
        const path = [];
        for (let v = t; v !== -1; v = from[v]) path.push(v);
        return path.reverse();
      }
      const gu = g[u];
      for (let e = start[u]; e < start[u + 1]; e++) {
        if (wrong[e] && strict) continue;
        const v = to[e];
        if (closed[v] === gen) continue;
        const ng = gu + len[e] * (wrong[e] ? 6 : 1);
        if (stamp[v] !== gen || ng < g[v]) {
          stamp[v] = gen;
          g[v] = ng;
          from[v] = u;
          push(v, ng + Math.hypot(x[v] - tx, z[v] - tz));
        }
      }
    }
    return null;
  }

  /** -> { pts: [{x, z}], length } from (ax, az) to (bx, bz); straight line when there is no road path */
  route(ax, az, bx, bz) {
    const s = this.nearestNode(ax, az, 300, true);
    const t = this.nearestNode(bx, bz, 300, false);
    let path = this.astar(s, t, true);
    if (!path) path = this.astar(s, t, false);
    if (path && path.length >= 2) {
      // the nearest node can lie behind the start (or past the end): skip it when the point sits on the first (last) edge
      const onSeg = (px, pz, a, b) => {
        const dx = this.x[b] - this.x[a];
        const dz = this.z[b] - this.z[a];
        const L2 = dx * dx + dz * dz || 1;
        const t = ((px - this.x[a]) * dx + (pz - this.z[a]) * dz) / L2;
        if (t <= 0 || t >= 1) return false;
        return Math.hypot(this.x[a] + dx * t - px, this.z[a] + dz * t - pz) < 25;
      };
      const near = (px, pz, id) => Math.hypot(this.x[id] - px, this.z[id] - pz) < 15;
      if (onSeg(ax, az, path[0], path[1]) || near(ax, az, path[0])) path.shift();
      const n = path.length;
      if (n >= 2 && (onSeg(bx, bz, path[n - 2], path[n - 1]) || near(bx, bz, path[n - 1]))) path.pop();
    }
    const pts = [{ x: ax, z: az }];
    if (path) for (const id of path) pts.push({ x: this.x[id], z: this.z[id] });
    pts.push({ x: bx, z: bz });
    // drop near-duplicates
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const q = out[out.length - 1];
      if (Math.hypot(p.x - q.x, p.z - q.z) > 0.5 || i === pts.length - 1) out.push(p);
    }
    let length = 0;
    for (let i = 1; i < out.length; i++) length += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
    return { pts: out, length, ok: !!path };
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (a, rng = Math.random) => a[Math.floor(rng() * a.length)];
const fmtMoney = (v) => `£${(Math.round((v || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDist = (m) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`);
const fmtMin = (s) => (s < 60 ? '<1 min' : `${Math.round(s / 60)} min`);
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const todayKey = () => new Date().toISOString().slice(0, 10);

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function stars(n, cls = 'rl-stars') {
  const s = h('span', cls);
  const full = Math.round(n * 2) / 2;
  s.setAttribute('aria-label', `${n.toFixed(1)} stars`);
  for (let i = 1; i <= 5; i++) {
    const st = h('i', i <= full ? 'on' : i - 0.5 === full ? 'half' : '', '★');
    s.appendChild(st);
  }
  return s;
}

function polylineLength(pts, from = 0) {
  let L = 0;
  for (let i = from + 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return L;
}

// ------------------------------------------------------------------------------------------------------------------
// 3D bits
// ------------------------------------------------------------------------------------------------------------------
function makeCanvasTexture(w, hgt, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  draw(c.getContext('2d'), w, hgt);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beamTexture() {
  return makeCanvasTexture(4, 256, (g, w, H) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.92, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, H);
  });
}

function chevronTexture() {
  const t = makeCanvasTexture(64, 128, (g, w, H) => {
    g.clearRect(0, 0, w, H);
    // soft band
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    grad.addColorStop(0.82, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, H);
    // chevron pointing to +v (canvas top = v 1)
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(14, 78);
    g.lineTo(32, 50);
    g.lineTo(50, 78);
    g.stroke();
  });
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

class PinMarker {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'RideBXLPin';
    this.group.visible = false;
    this.color = new THREE.Color(C_PICKUP);
    const beamTex = beamTexture();
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: C_PICKUP, map: beamTex, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.coreMat = this.beamMat.clone();
    this.coreMat.opacity = 0.9;
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.core = new THREE.Mesh(beamGeo, this.coreMat);
    this.beam.renderOrder = this.core.renderOrder = 5;
    // the map-pin head (cone + ball) hovering over the kerb
    this.headMat = new THREE.MeshBasicMaterial({ color: C_PICKUP, fog: false, toneMapped: false });
    this.head = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 16), this.headMat);
    ball.position.y = 1.9;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.7, 24), this.headMat);
    cone.rotation.x = Math.PI;
    cone.position.y = 0.95;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false }));
    dot.position.set(0, 1.9, 0);
    dot.scale.z = 1.6;
    this.head.add(ball, cone, dot);
    // pulsing ground rings
    this.ringMat = new THREE.MeshBasicMaterial({ color: C_PICKUP, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring2Mat = this.ringMat.clone();
    this.ring2 = new THREE.Mesh(ringGeo, this.ring2Mat);
    this.discMat = this.ringMat.clone();
    this.discMat.opacity = 0.18;
    const discGeo = new THREE.CircleGeometry(1, 48);
    discGeo.rotateX(-Math.PI / 2);
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.group.add(this.beam, this.core, this.head, this.ring, this.ring2, this.disc);
    this.group.traverse((o) => { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; });
    scene.add(this.group);
    this.t = 0;
  }

  show(x, y, z, color) {
    this.group.position.set(x, y, z);
    this.group.visible = true;
    for (const m of [this.beamMat, this.coreMat, this.headMat, this.ringMat, this.ring2Mat, this.discMat]) m.color.setHex(color);
  }

  hide() {
    this.group.visible = false;
  }

  update(dt, camPos) {
    if (!this.group.visible) return;
    this.t += dt;
    const d = camPos ? camPos.distanceTo(this.group.position) : 50;
    const s = clamp(d / 110, 1, 14); // stays readable from across town
    const height = 70 + 40 * s;
    this.beam.scale.set(1.25 * s, height, 1.25 * s);
    this.core.scale.set(0.35 * s, height, 0.35 * s);
    this.beamMat.opacity = 0.32 + 0.1 * Math.sin(this.t * 2.2);
    const hs = clamp(d / 60, 1, 8);
    this.head.scale.setScalar(hs);
    this.head.position.y = 4.2 + 0.35 * Math.sin(this.t * 2.6) * hs;
    this.head.rotation.y += dt * 1.4;
    const ph = (this.t * 0.7) % 1;
    const ph2 = (this.t * 0.7 + 0.5) % 1;
    this.ring.scale.setScalar(STOP_RADIUS * (0.3 + 0.7 * ph));
    this.ringMat.opacity = 0.85 * (1 - ph);
    this.ring2.scale.setScalar(STOP_RADIUS * (0.3 + 0.7 * ph2));
    this.ring2Mat.opacity = 0.85 * (1 - ph2);
    this.disc.scale.setScalar(STOP_RADIUS);
    this.ring.position.y = this.ring2.position.y = this.disc.position.y = 0.08;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

/** A simple stylised person (capsule body, waving arm). Faces +z at yaw 0. */
class PassengerFigure {
  constructor(scene, seed = 1) {
    const rng = mulberry32(seed);
    const shirt = new THREE.Color().setHSL(rng(), 0.45 + rng() * 0.35, 0.38 + rng() * 0.2);
    const skinTones = [0xf1c9a5, 0xe0ac7e, 0xc68c5a, 0x9a6440, 0x6e4a2f, 0x4a3122];
    const skin = skinTones[Math.floor(rng() * skinTones.length)];
    const trousers = pick([0x1d2433, 0x2b2b2b, 0x3d3a34, 0x2d3d52, 0x5a4b3a], rng);
    const hair = pick([0x1a1410, 0x3b2a1e, 0x6b4a2b, 0xc9a26a, 0x2a2a2a, 0x8a3b20], rng);
    this.mats = [
      new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: trousers, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: hair, roughness: 0.9 })
    ];
    const [mShirt, mSkin, mLegs, mHair] = this.mats;
    const g = new THREE.Group();
    g.name = 'RideBXLPassenger';
    const legGeo = new THREE.CapsuleGeometry(0.085, 0.72, 4, 8);
    const legL = new THREE.Mesh(legGeo, mLegs);
    legL.position.set(0.1, 0.45, 0);
    const legR = legL.clone();
    legR.position.x = -0.1;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 12), mShirt);
    torso.position.y = 1.16;
    torso.scale.z = 0.72;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mSkin);
    head.position.y = 1.62;
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mHair);
    hairM.position.y = 1.635;
    hairM.rotation.x = -0.25;
    const armGeo = new THREE.CapsuleGeometry(0.06, 0.5, 4, 8);
    armGeo.translate(0, -0.3, 0); // pivot at the shoulder
    const armL = new THREE.Mesh(armGeo, mShirt);
    armL.position.set(0.26, 1.42, 0);
    armL.rotation.z = 0.12;
    this.armR = new THREE.Mesh(armGeo, mShirt);
    this.armR.position.set(-0.26, 1.42, 0);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mSkin);
    hand.position.y = -0.62;
    this.armR.add(hand);
    // a phone in the other hand
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.012), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.4 }));
    this.mats.push(phone.material);
    phone.position.set(0, -0.6, 0.06);
    armL.add(phone);
    g.add(legL, legR, torso, head, hairM, armL, this.armR);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    const s = 0.92 + rng() * 0.16;
    g.scale.setScalar(s);
    this.baseScale = s;
    this.group = g;
    this.legL = legL;
    this.legR = legR;
    scene.add(g);
    this.t = rng() * 10;
    this.wave = 1;
    this.walk = 0;
    this.opacity = 1;
  }

  place(x, y, z, yaw) {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  }

  setOpacity(a) {
    if (a === this.opacity) return;
    this.opacity = a;
    for (const m of this.mats) {
      m.transparent = a < 0.999;
      m.opacity = a;
      m.depthWrite = a > 0.5;
    }
    this.group.visible = a > 0.01;
  }

  update(dt) {
    this.t += dt;
    const w = this.wave;
    // waving arm up high, swinging side to side
    this.armR.rotation.z = -(0.15 + w * (2.55 + 0.45 * Math.sin(this.t * 9)));
    this.armR.rotation.x = 0;
    const sw = Math.sin(this.t * 7.5) * 0.5 * this.walk;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.legL.position.y = this.legR.position.y = 0.45;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
  }
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Glowing chevron ribbon laid on the road along the next ~600 m of the route */
class RouteRibbon {
  constructor(scene, maxPts = 260) {
    this.maxPts = maxPts;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxPts * 2 * 3);
    this.uv = new Float32Array(maxPts * 2 * 2);
    this.alpha = new Float32Array(maxPts * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array((maxPts - 1) * 6);
    for (let i = 0; i < maxPts - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.tex = chevronTexture();
    this.mat = new THREE.MeshBasicMaterial({ color: C_PICKUP, map: this.tex, transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'RideBXLRoute';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.width = 1.5;
  }

  /** pts: [{x, z}] (already trimmed to start near the car); ground(x, z) -> y */
  set(pts, ground, color) {
    this.mat.color.setHex(color);
    // densify to ≤ 5 m steps (follows bridge decks), stop at ROUTE_DRAW_M
    const out = [];
    let L = 0;
    for (let i = 0; i < pts.length - 1 && out.length < this.maxPts; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(seg / 5));
      for (let k = 0; k < n && out.length < this.maxPts; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, L: L + seg * t });
      }
      L += seg;
      if (L > ROUTE_DRAW_M) break;
    }
    if (pts.length && out.length < this.maxPts) {
      const last = pts[pts.length - 1];
      if (L <= ROUTE_DRAW_M) out.push({ x: last.x, z: last.z, L });
    }
    const n = out.length;
    if (n < 2) {
      this.mesh.visible = false;
      return;
    }
    const hw = this.width / 2;
    for (let i = 0; i < n; i++) {
      const p = out[i];
      const a = out[Math.max(0, i - 1)];
      const b = out[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const nx = -dz;
      const nz = dx;
      const y = ground(p.x, p.z) + 0.15;
      this.pos.set([p.x + nx * hw, y, p.z + nz * hw, p.x - nx * hw, y, p.z - nz * hw], i * 6);
      const v = p.L / 3.2;
      this.uv.set([0, v, 1, v], i * 4);
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  update(dt) {
    if (!this.mesh.visible) return;
    this.tex.offset.y -= dt * 0.9;
    this.tex.updateMatrix();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.tex.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Styles (scoped .rl-)
// ------------------------------------------------------------------------------------------------------------------
const CSS = `
.rl-root{--rl-accent:#3ee6b4;--rl-accent-ink:#06221a;--rl-drop:#ff5fa2;--rl-glass:rgba(16,17,20,.80);--rl-border:rgba(255,255,255,.09);
  --rl-text:#f6f5f2;--rl-text2:rgba(246,245,242,.66);--rl-text3:rgba(246,245,242,.42);--rl-div:rgba(255,255,255,.08);
  font-family:var(--font-sans,Inter,-apple-system,system-ui,sans-serif);color:var(--rl-text);font-size:13px;-webkit-font-smoothing:antialiased}
.rl-root *{box-sizing:border-box}
.rl-root button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.rl-phone{position:fixed;z-index:12;right:max(20px,env(safe-area-inset-right));top:86px;width:284px;max-height:calc(100vh - 86px - 176px);min-height:150px;
  display:flex;flex-direction:column;border-radius:20px;background:var(--grain,none),var(--rl-glass);border:1px solid var(--rl-border);
  backdrop-filter:blur(22px) saturate(170%);-webkit-backdrop-filter:blur(22px) saturate(170%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 18px 40px -18px rgba(0,0,0,.7),0 2px 8px rgba(0,0,0,.2);overflow:hidden;
  transition:transform .35s cubic-bezier(.22,1,.36,1),opacity .25s ease;transform-origin:top right}
.rl-root.rl-collapsed .rl-phone{transform:translateX(16px) scale(.96);opacity:0;pointer-events:none}
.rl-handle{position:fixed;z-index:12;right:max(20px,env(safe-area-inset-right));top:86px;display:flex;align-items:center;gap:8px;height:36px;padding:0 10px 0 6px;
  border-radius:12px;background:var(--rl-glass);border:1px solid var(--rl-border);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  box-shadow:0 10px 30px -14px rgba(0,0,0,.7);opacity:0;pointer-events:none;transform:translateX(8px);transition:opacity .25s ease,transform .3s cubic-bezier(.22,1,.36,1)}
.rl-root.rl-collapsed .rl-handle{opacity:1;pointer-events:auto;transform:none}
.rl-handle .rl-hsub{font-size:11.5px;color:var(--rl-text2);font-variant-numeric:tabular-nums}
.rl-root .rl-logo{display:inline-flex;align-items:center;gap:7px;font-weight:800;font-size:14px;letter-spacing:-.01em;white-space:nowrap}
.rl-root .rl-logo b{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--rl-accent);color:var(--rl-accent-ink);font-size:12px;font-weight:900}
.rl-root .rl-logo em{font-style:normal;color:var(--rl-accent)}
.rl-head{display:flex;align-items:center;gap:8px;padding:12px 10px 10px 12px}
.rl-status{display:inline-flex;align-items:center;gap:5px;margin-left:auto;font-size:11px;font-weight:650;color:var(--rl-text2);padding:4px 8px;border-radius:999px;background:rgba(255,255,255,.06)}
.rl-status i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.35)}
.rl-status.on{color:var(--rl-accent);background:rgba(62,230,180,.12)}.rl-status.on i{background:var(--rl-accent);box-shadow:0 0 0 3px rgba(62,230,180,.2);animation:rl-pulse 1.6s ease-in-out infinite}
.rl-iconbtn{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;color:var(--rl-text2)}.rl-iconbtn:hover{background:rgba(255,255,255,.08);color:var(--rl-text)}
.rl-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:5px;font-size:10px;font-weight:650;line-height:1;
  color:var(--rl-text2);background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),inset 0 -1px 0 rgba(0,0,0,.3)}
.rl-tabs{display:flex;gap:2px;margin:0 10px;padding:3px;border-radius:10px;background:rgba(255,255,255,.05)}
.rl-tab{flex:1;height:26px;border-radius:7px;font-size:12px;font-weight:650;color:var(--rl-text2)}
.rl-tab.active{background:rgba(255,255,255,.1);color:var(--rl-text)}
.rl-body{flex:1;overflow-y:auto;padding:10px 10px 12px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.15) transparent}
.rl-stats{display:grid;grid-template-columns:1.25fr 1fr 1fr;gap:6px;margin-bottom:10px}
.rl-stat{padding:7px 8px;border-radius:10px;background:rgba(255,255,255,.05)}
.rl-stat>span{display:block;font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--rl-text3)}
.rl-stat b{display:block;margin-top:2px;font-size:15px;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.rl-stat b .rl-star{color:#ffd166;font-size:12px;margin-right:2px}
.rl-go{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:40px;border-radius:12px;font-weight:750!important;font-size:14px!important;
  background:var(--rl-accent)!important;color:var(--rl-accent-ink)!important;box-shadow:0 8px 22px -10px rgba(62,230,180,.7);transition:filter .15s,transform .15s}
.rl-go:hover{filter:brightness(1.06)}.rl-go:active{transform:scale(.98)}
.rl-go.off{background:rgba(255,255,255,.08)!important;color:var(--rl-text)!important;box-shadow:none}
.rl-go[disabled]{opacity:.45;cursor:default}
.rl-card{margin-top:10px;padding:11px 12px;border-radius:14px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.06);animation:rl-rise .35s cubic-bezier(.22,1,.36,1) both}
.rl-card.offer{border-color:rgba(62,230,180,.35);background:linear-gradient(180deg,rgba(62,230,180,.1),rgba(255,255,255,.04))}
.rl-card h3{margin:0;font-size:13.5px;font-weight:750;letter-spacing:-.01em;display:flex;align-items:center;gap:6px}
.rl-card .rl-sub{font-size:11.5px;color:var(--rl-text2);margin-top:2px}
.rl-pax{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.rl-avatar{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:50%;font-weight:800;font-size:13px;color:#10131a}
.rl-fare{margin-left:auto;text-align:right}.rl-fare b{display:block;font-size:18px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.rl-fare span{font-size:10.5px;color:var(--rl-text3)}
.rl-legs{position:relative;display:flex;flex-direction:column;gap:7px;padding-left:16px;margin:2px 0 8px}
.rl-legs::before{content:'';position:absolute;left:4px;top:7px;bottom:7px;width:2px;border-radius:2px;background:linear-gradient(var(--rl-accent),var(--rl-drop));opacity:.55}
.rl-leg{position:relative;font-size:12.5px;font-weight:600;line-height:1.25}
.rl-leg::before{content:'';position:absolute;left:-16px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--rl-accent);box-shadow:0 0 0 3px rgba(62,230,180,.18)}
.rl-leg.drop::before{border-radius:3px;background:var(--rl-drop);box-shadow:0 0 0 3px rgba(255,95,162,.18)}
.rl-leg small{display:block;font-size:11px;font-weight:500;color:var(--rl-text3);margin-top:1px}
.rl-meta{display:flex;gap:10px;font-size:11.5px;color:var(--rl-text2);font-variant-numeric:tabular-nums}
.rl-meta b{color:var(--rl-text);font-weight:700}
.rl-timer{height:3px;margin:10px 0 9px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden}
.rl-timer i{display:block;height:100%;background:var(--rl-accent);transform-origin:left;transition:transform .2s linear}
.rl-row{display:flex;gap:6px}
.rl-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;height:34px;border-radius:10px;font-weight:700!important;font-size:12.5px!important;background:rgba(255,255,255,.08)}
.rl-btn:hover{background:rgba(255,255,255,.12)}
.rl-btn.primary{flex:1.6;background:var(--rl-accent);color:var(--rl-accent-ink)!important}.rl-btn.primary:hover{filter:brightness(1.06)}
.rl-btn.primary .rl-kbd{background:rgba(6,34,26,.14);color:var(--rl-accent-ink);box-shadow:none}
.rl-btn.small{flex:0 0 auto;height:28px;padding:0 10px;font-size:11.5px!important}
.rl-searching{display:flex;align-items:center;gap:10px}
.rl-radar{position:relative;flex:none;width:30px;height:30px;border-radius:50%;background:rgba(62,230,180,.12)}
.rl-radar::before,.rl-radar::after{content:'';position:absolute;inset:0;border-radius:50%;border:2px solid var(--rl-accent);animation:rl-ping 1.8s ease-out infinite}
.rl-radar::after{animation-delay:.9s}
.rl-radar i{position:absolute;inset:10px;border-radius:50%;background:var(--rl-accent)}
.rl-mood{display:flex;align-items:center;gap:8px;margin:8px 0 2px;font-size:11.5px;color:var(--rl-text2)}
.rl-stars{display:inline-flex;gap:1px;font-size:12px;letter-spacing:0;line-height:1}
.rl-stars i{font-style:normal;color:rgba(255,255,255,.18)}.rl-stars i.on{color:#ffd166}
.rl-stars i.half{background:linear-gradient(90deg,#ffd166 50%,rgba(255,255,255,.18) 50%);-webkit-background-clip:text;background-clip:text;color:transparent}
.rl-warn{display:flex;gap:9px;align-items:flex-start}
.rl-warn svg{flex:none;margin-top:1px;color:var(--rl-accent)}
.rl-list{display:flex;flex-direction:column;gap:2px}
.rl-li{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:9px;font-variant-numeric:tabular-nums}
.rl-li:nth-child(odd){background:rgba(255,255,255,.035)}
.rl-li.me{background:rgba(62,230,180,.12);box-shadow:inset 0 0 0 1px rgba(62,230,180,.3)}
.rl-rank{width:18px;text-align:center;font-weight:800;font-size:12px;color:var(--rl-text3)}
.rl-li:nth-child(1) .rl-rank{color:#ffd166}.rl-li:nth-child(2) .rl-rank{color:#d7dde5}.rl-li:nth-child(3) .rl-rank{color:#e0a46b}
.rl-li .rl-nm{flex:1;min-width:0;font-weight:650;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rl-li .rl-nm small{display:block;font-size:10.5px;font-weight:500;color:var(--rl-text3);overflow:hidden;text-overflow:ellipsis}
.rl-li .rl-amt{font-weight:750;font-size:12.5px;text-align:right}
.rl-li .rl-amt small{display:block;font-size:10.5px;font-weight:550;color:var(--rl-text3)}
.rl-empty{padding:18px 8px;text-align:center;color:var(--rl-text3);font-size:12px}
.rl-foot{display:flex;align-items:center;gap:6px;padding:8px 12px 10px;border-top:1px solid var(--rl-div);font-size:11px;color:var(--rl-text3)}
.rl-foot b{color:var(--rl-text2);font-weight:650}
.rl-foot .rl-sp{margin-left:auto}
/* HUD chip, pin label, edge arrow, toasts, result card */
.rl-chip{position:fixed;z-index:11;left:50%;top:max(20px,env(safe-area-inset-top));transform:translate(-50%,-8px);display:flex;align-items:center;gap:10px;padding:7px 12px 7px 8px;
  border-radius:14px;background:var(--rl-glass);border:1px solid var(--rl-border);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  box-shadow:0 12px 30px -14px rgba(0,0,0,.75);opacity:0;pointer-events:none;transition:opacity .25s ease,transform .35s cubic-bezier(.22,1,.36,1);white-space:nowrap;max-width:calc(100vw - 40px)}
.rl-chip.show{opacity:1;transform:translate(-50%,0)}
.rl-chip .rl-dot{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:9px;background:var(--rl-accent);color:var(--rl-accent-ink)}
.rl-chip.drop .rl-dot{background:var(--rl-drop);color:#2a0716}
.rl-chip .rl-ct{display:flex;flex-direction:column;min-width:0}
.rl-chip .rl-ct b{font-size:13px;font-weight:750;overflow:hidden;text-overflow:ellipsis}
.rl-chip .rl-ct span{font-size:11.5px;color:var(--rl-text2);font-variant-numeric:tabular-nums}
.rl-chip .rl-big{margin-left:6px;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.rl-chip .rl-hold{position:absolute;left:10px;right:10px;bottom:3px;height:2px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;opacity:0;transition:opacity .2s}
.rl-chip .rl-hold.on{opacity:1}.rl-chip .rl-hold i{display:block;height:100%;background:var(--rl-accent);transform-origin:left}
.rl-chip.drop .rl-hold i{background:var(--rl-drop)}
.rl-pinlabel{position:fixed;z-index:9;left:0;top:0;padding:4px 8px;border-radius:8px;font-size:11.5px;font-weight:750;white-space:nowrap;pointer-events:none;
  background:rgba(16,17,20,.78);border:1px solid rgba(62,230,180,.45);color:var(--rl-text);font-variant-numeric:tabular-nums;display:none;will-change:transform}
.rl-pinlabel.drop{border-color:rgba(255,95,162,.5)}
.rl-pinlabel::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--rl-accent);margin-right:6px;vertical-align:1px}
.rl-pinlabel.drop::before{background:var(--rl-drop);border-radius:2px}
.rl-arrow{position:fixed;z-index:9;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;display:none;pointer-events:none;will-change:transform}
.rl-arrow .rl-arr{position:absolute;inset:0;display:grid;place-items:center;border-radius:50%;background:rgba(16,17,20,.78);border:1px solid rgba(62,230,180,.5);
  box-shadow:0 0 18px rgba(62,230,180,.35);color:var(--rl-accent)}
.rl-arrow.drop .rl-arr{border-color:rgba(255,95,162,.55);box-shadow:0 0 18px rgba(255,95,162,.35);color:var(--rl-drop)}
.rl-arrow small{position:absolute;left:50%;top:48px;transform:translateX(-50%);font-size:10.5px;font-weight:750;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.8);font-variant-numeric:tabular-nums}
.rl-toasts{position:fixed;z-index:13;left:50%;top:78px;transition:top .3s;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;width:min(420px,calc(100vw - 40px))}
.rl-toast{display:flex;align-items:flex-start;gap:8px;max-width:100%;padding:8px 12px;border-radius:12px;background:var(--rl-glass);border:1px solid var(--rl-border);
  backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 10px 26px -14px rgba(0,0,0,.8);font-size:12.5px;line-height:1.35;animation:rl-rise .3s cubic-bezier(.22,1,.36,1) both}
.rl-toast.out{animation:rl-out .3s ease forwards}
.rl-toast.chat{border-radius:14px 14px 14px 4px}
.rl-toast.chat .rl-who{font-weight:750;color:var(--rl-accent);margin-right:2px}
.rl-toast.bad{border-color:rgba(255,122,107,.4)}.rl-toast.bad::before{content:'!';display:grid;place-items:center;flex:none;width:16px;height:16px;border-radius:50%;background:#ff7a6b;color:#2a0b07;font-weight:900;font-size:11px}
.rl-toast.good::before{content:'✓';display:grid;place-items:center;flex:none;width:16px;height:16px;border-radius:50%;background:var(--rl-accent);color:var(--rl-accent-ink);font-weight:900;font-size:10px}
.rl-result{position:fixed;z-index:14;left:50%;top:50%;width:min(300px,calc(100vw - 40px));transform:translate(-50%,-50%);padding:18px 18px 14px;border-radius:20px;text-align:center;
  background:rgba(16,17,20,.92);border:1px solid var(--rl-border);box-shadow:0 30px 60px -20px rgba(0,0,0,.85);animation:rl-pop .45s cubic-bezier(.22,1,.36,1) both}
.rl-result.out{animation:rl-out .3s ease forwards}
.rl-result .rl-ok{display:grid;place-items:center;width:40px;height:40px;margin:0 auto 8px;border-radius:50%;background:var(--rl-accent);color:var(--rl-accent-ink)}
.rl-result.err .rl-ok{background:#ff7a6b;color:#2a0b07}
.rl-result h4{margin:0;font-size:12px;font-weight:650;color:var(--rl-text2);text-transform:uppercase;letter-spacing:.08em}
.rl-result .rl-amount{font-size:38px;font-weight:850;letter-spacing:-.03em;margin:2px 0 4px;font-variant-numeric:tabular-nums}
.rl-result .rl-stars{font-size:18px;gap:3px;margin-bottom:10px}
.rl-result .rl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:4px 0 12px}
.rl-result .rl-grid div{padding:7px 4px;border-radius:10px;background:rgba(255,255,255,.05)}
.rl-result .rl-grid span{display:block;font-size:9.5px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--rl-text3)}
.rl-result .rl-grid b{font-size:13px;font-weight:750;font-variant-numeric:tabular-nums}
.rl-result .rl-route{font-size:11.5px;color:var(--rl-text2);margin-bottom:12px;line-height:1.4}
.rl-result .rl-why{font-size:12.5px;color:#ffb3a8;margin:4px 0 12px}
body.hud-minimized .rl-phone,body.hud-minimized .rl-handle{opacity:0!important;pointer-events:none!important}
body:has(.rl-offline-pill) .rl-chip{top:calc(max(20px,env(safe-area-inset-top)) + 34px)}
body:has(.rl-offline-pill) .rl-toasts{top:112px}
@keyframes rl-rise{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes rl-out{to{opacity:0;transform:translateY(-6px)}}
@keyframes rl-pop{from{opacity:0;transform:translate(-50%,-46%) scale(.94)}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes rl-pulse{50%{box-shadow:0 0 0 6px rgba(62,230,180,0)}}
@keyframes rl-ping{from{transform:scale(.4);opacity:.9}to{transform:scale(1.35);opacity:0}}
@media (max-width:720px){.rl-phone{width:248px;top:76px}.rl-handle{top:76px}}
`;

const ICON = {
  car: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.2 10.5 1.4-4.1A2.2 2.2 0 0 1 8.7 4.8h6.6a2.2 2.2 0 0 1 2.1 1.6l1.4 4.1"/><rect x="3" y="10.5" width="18" height="6.5" rx="2"/><path d="M6 17v2.6M18 17v2.6"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.2s-6.6-5.7-6.6-11.2a6.6 6.6 0 0 1 13.2 0c0 5.5-6.6 11.2-6.6 11.2z"/><circle cx="12" cy="10" r="2.4"/></svg>',
  flag: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  min: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  arrow: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>'
};
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICON[name]; // constant markup only
  return t.content.firstChild;
}

// ------------------------------------------------------------------------------------------------------------------
// RideBXL
// ------------------------------------------------------------------------------------------------------------------
export class RideBXL {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Camera|() => THREE.Camera} o.camera
   * @param {object} o.controllers  { activeMode, getActiveEntity() -> { position, heading, speed } ; optional addCollisionListener(fn) or addEventListener('collision', fn) }
   * @param {object} o.world        createWorldQueries(GEO): groundHeight, nearestRoad, randomRoadPoint, streetName, districtAt
   * @param {object} o.geo          GEO (roads, pois, stations, districts)
   * @param {import('./backend.js').Backend} o.backend
   * @param {object} [o.ui]         { setMode(mode), onRouteChange(route, target), container, rideMode = 'ride' }
   */
  constructor({ scene, camera, controllers, world, geo, backend, ui = {} }) {
    this.scene = scene;
    this._camera = camera;
    this.controllers = controllers;
    this.world = world || {};
    this.geo = geo || {};
    this.backend = backend;
    this.ui = ui;
    this.rideMode = ui.rideMode || RIDE_MODES[0];
    this.rng = Math.random;

    this.online = false;
    this.phase = 'idle'; // idle | offer | pickup | boarding | ride | alighting | finishing
    this.job = null;
    this.offerIn = this._nextOfferDelay();
    this.offerLeft = 0;
    this.holdT = 0;
    this.route = [];
    this.routeIdx = 0;
    this.routeColor = C_PICKUP;
    this._rerouteCd = 0;
    this._lastPos = null;
    this._lastSpeed = 0;
    this._brakeT = 0;
    this._hookSeen = false;
    this._uiT = 0;
    this._outOfCarT = 0;
    this._graph = null;
    this._places = null;
    this.today = this._loadToday();
    this.lastResult = null;
    this.tab = 'drive';
    this._disposed = false;

    this.pin = new PinMarker(scene);
    this.ribbon = new RouteRibbon(scene);
    this.passenger = null;
    this._paxAnim = null;

    this._buildDom();
    this._bindKeys();
    this._bindCollisions();
    if (backend && backend.onChange) this._unsubBackend = backend.onChange(() => this._renderStats());
    this._render();
  }

  get camera() {
    return typeof this._camera === 'function' ? this._camera() : this._camera;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------------------------
  get inRideMode() {
    return this.controllers && this.controllers.activeMode === this.rideMode;
  }

  /** Remaining GPS route [{x, z}] from the car to the current pin ([] when none) */
  getRoute() {
    if (!this.route.length || !this.job || !(this.phase === 'pickup' || this.phase === 'ride')) return [];
    const ent = this._entity();
    const out = ent ? [{ x: ent.position.x, z: ent.position.z }] : [];
    for (let i = this.routeIdx + 1; i < this.route.length; i++) out.push({ x: this.route[i].x, z: this.route[i].z });
    return out;
  }

  /** The current pin: { x, z, kind: 'pickup' | 'dropoff', name } or null */
  getTarget() {
    if (!this.job) return null;
    if (this.phase === 'pickup' || this.phase === 'boarding') return { x: this.job.pickup.x, z: this.job.pickup.z, kind: 'pickup', name: this.job.pickup.name };
    if (this.phase === 'ride' || this.phase === 'alighting') return { x: this.job.dropoff.x, z: this.job.dropoff.z, kind: 'dropoff', name: this.job.dropoff.name };
    return null;
  }

  setOnline(on) {
    on = !!on;
    if (on && !this.inRideMode) {
      this.toast('Switch to the RideBXL car to take jobs', 'bad');
      this._render();
      return;
    }
    if (on === this.online) return;
    this.online = on;
    if (on) {
      this._ensureGraph();
      this.offerIn = Math.min(this._nextOfferDelay(), 6 + this.rng() * 6);
      this.toast("You're online — jobs will start coming in", 'good');
    } else {
      if (this.job && this.phase !== 'offer') this.toast('Trip cancelled — you went offline', 'bad');
      this._endJob();
    }
    this._render();
  }

  /** Offer a job right now (debug / tests) */
  requestJob() {
    if (!this.online) this.setOnline(true);
    if (this.phase === 'offer') return true;
    if (!this.online || this.phase !== 'idle') return false;
    return this._makeOffer();
  }

  acceptOffer() {
    if (this.phase !== 'offer' || !this.job) return;
    this.phase = 'pickup';
    this.job.acceptedAt = performance.now();
    this.job.pickupT = 0;
    this._wasCollapsedBeforeOffer = null;
    this._spawnPassenger();
    const p = this.job.pickup;
    this.pin.show(p.x, this._ground(p.x, p.z), p.z, C_PICKUP);
    this._reroute(true);
    this.toast(`Picking up ${this.job.pax.name} at ${p.name}`, 'good');
    this._render();
  }

  declineOffer(auto = false) {
    if (this.phase !== 'offer') return;
    this.toast(auto ? 'Offer expired' : 'Offer declined');
    this._endJob();
    if (this._wasCollapsedBeforeOffer) this.togglePanel(false);
    this._wasCollapsedBeforeOffer = null;
    this._render();
  }

  cancelTrip() {
    if (!this.job || this.phase === 'offer' || this.phase === 'idle') return;
    this.toast(this.phase === 'ride' ? `${this.job.pax.name} got out. Trip cancelled.` : 'Trip cancelled', 'bad');
    this._endJob();
    this._render();
  }

  togglePanel(open) {
    const collapsed = this.root.classList.contains('rl-collapsed');
    const next = open === undefined ? !collapsed : !open;
    this.root.classList.toggle('rl-collapsed', next);
    try { safeStorage.set('brusselsloop_rl_collapsed', next); } catch { /* ignore */ }
    if (!next) this._render();
  }

  /** For controllers without a hook: report a hit (impulse = speed lost in m/s) */
  reportCollision(impulse = 6) {
    this._hookSeen = true;
    this._onCollision(impulse);
  }

  toast(text, kind = '', who = null, ms = 3600) {
    const t = h('div', `rl-toast ${kind}`);
    if (who) {
      t.classList.add('chat');
      const w = h('span', 'rl-who', `${who}:`);
      const wrap = h('span');
      wrap.append(w, document.createTextNode(` ${text}`));
      t.appendChild(wrap);
    } else {
      t.appendChild(h('span', '', text));
    }
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, ms);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------------------------------------------
  update(dt) {
    if (this._disposed) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.25);
    const ent = this._entity();
    if (!ent) return;
    const px = ent.position.x;
    const pz = ent.position.z;
    let step = 0;
    let teleported = false;
    if (this._lastPos) {
      step = Math.hypot(px - this._lastPos.x, pz - this._lastPos.z);
      if (step > 70 * dt + 5) {
        teleported = true;
        step = 0;
      }
    }
    this._lastPos = { x: px, z: pz };
    if (step > 0 && this.backend && this.backend.addDistance) this.backend.addDistance(step);
    const speed = Number.isFinite(ent.speed) ? Math.abs(ent.speed) : dt > 0 ? step / dt : 0;
    const inCar = this.inRideMode;

    // ride quality (only with a passenger aboard)
    if (this.phase === 'ride' && inCar) this._rideQuality(dt, speed, step, teleported);
    this._lastSpeed = speed;

    // job flow
    if (this.online && !inCar && this.phase !== 'idle' && this.phase !== 'offer') {
      this._outOfCarT += dt;
      if (this._outOfCarT > 30) {
        this.toast(`${this.job.pax.name} gave up waiting for you to get back in the car`, 'bad');
        this._endJob();
        this._render();
      }
    } else {
      this._outOfCarT = 0;
    }
    if (this.online && !inCar && this.phase === 'idle') {
      // keep online state but don't offer jobs out of the car
    } else if (this.online && this.phase === 'idle') {
      this.offerIn -= dt;
      if (this.offerIn <= 0) {
        if (!this._makeOffer()) this.offerIn = 4;
      }
    } else if (this.phase === 'offer') {
      this.offerLeft -= dt;
      if (this.offerLeft <= 0) this.declineOffer(true);
    } else if (this.phase === 'pickup' && inCar) {
      this.job.pickupT += dt;
      if (this.job.pickupT > PICKUP_GIVE_UP_S) {
        this.toast(`${this.job.pax.name} cancelled — waited too long`, 'bad');
        this._endJob();
        this._render();
      } else {
        if (!this.job.nagged && this.job.pickupT > 90) {
          this.job.nagged = true;
          this.toast(pick(CHAT.waiting), '', this.job.pax.name);
        }
        this._checkStop(dt, px, pz, speed, this.job.pickup, () => this._startBoarding());
      }
    } else if (this.phase === 'ride' && inCar) {
      this._checkStop(dt, px, pz, speed, this.job.dropoff, () => this._startAlighting());
    }

    // route following
    if ((this.phase === 'pickup' || this.phase === 'ride') && inCar) this._followRoute(dt, px, pz, teleported);

    // 3D
    const cam = this.camera;
    this.pin.update(dt, cam ? cam.position : null);
    this.ribbon.update(dt);
    this._updatePassenger(dt, ent);

    // HUD
    this._updateScreenMarkers();
    this._uiT -= dt;
    if (this._uiT <= 0) {
      this._uiT = 0.15;
      this._updateLive(ent, speed);
    }
    if (this._lastInCar !== inCar) {
      this._lastInCar = inCar;
      this._render();
    }
  }

  dispose() {
    this._disposed = true;
    this._endJob();
    this.pin.dispose();
    this.ribbon.dispose();
    if (this.passenger) this.passenger.dispose();
    window.removeEventListener('keydown', this._onKey);
    if (this._unsubCollision) this._unsubCollision();
    if (this._unsubBackend) this._unsubBackend();
    for (const e of [this.root, this.chip, this.pinLabel, this.arrow, this.toasts, this.resultEl]) if (e) e.remove();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Internals: world
  // ---------------------------------------------------------------------------------------------------------------
  _entity() {
    const c = this.controllers;
    if (!c) return null;
    return c.getActiveEntity ? c.getActiveEntity() : c.entity || null;
  }

  _ground(x, z) {
    try {
      const y = this.world.groundHeight ? this.world.groundHeight(x, z, 'car') : 0;
      return Number.isFinite(y) ? y : 0;
    } catch {
      return 0;
    }
  }

  _ensureGraph() {
    if (!this._graph) {
      const t0 = performance.now();
      this._graph = new RoadGraph(this.geo.roads || []);
      console.log(`[ridebxl] road graph: ${this._graph.n} nodes, ${this._graph.to.length} edges, ${Math.round(performance.now() - t0)} ms`);
    }
    return this._graph;
  }

  _placesList() {
    if (this._places) return this._places;
    const seen = new Set();
    const out = [];
    const add = (name, x, z, weight = 1) => {
      if (!name || !Number.isFinite(x) || !Number.isFinite(z)) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, x, z, weight });
    };
    for (const s of this.geo.stations || []) {
      const n = /station/i.test(s.name) ? s.name : `${s.name} Station`;
      add(n, s.x, s.z, 2);
    }
    // named places only, no chains (a name seen 3+ times is a brand: keeps real brand names out of the app)
    const pois = (this.geo.pois || []).filter((p) => p && p.name && !SKIP_POI_KINDS.has(p.kind));
    const freq = new Map();
    for (const p of pois) freq.set(p.name.toLowerCase(), (freq.get(p.name.toLowerCase()) || 0) + 1);
    for (const p of pois) if (freq.get(p.name.toLowerCase()) < 3) add(p.name, p.x, p.z, POI_WEIGHT[p.kind] || 1);
    for (const d of this.geo.districts || []) add(d.name, d.x, d.z, 1);
    for (const k of Object.keys(LANDMARK_ANCHORS)) {
      const a = LANDMARK_ANCHORS[k];
      if (k === 'nelsonsColumn' || k === 'parliament') continue;
      const w = toWorld(a.lat, a.lon);
      add(a.name, w.x, w.z, 3);
    }
    this._places = out;
    return out;
  }

  /** Snap a point to the kerb of the nearest drivable road. -> { x, z, px, pz, yaw, street } (px/pz: passenger on the pavement) */
  _kerb(x, z) {
    let road = null;
    let cx = x;
    let cz = z;
    let heading = 0;
    let dist = 0;
    try {
      const r = this.world.nearestRoad ? this.world.nearestRoad(x, z, { kinds: PIN_KINDS }) : null;
      if (r && Number.isFinite(r.x)) {
        road = r.road;
        cx = r.x;
        cz = r.z;
        heading = r.heading || 0;
        dist = r.dist ?? Math.hypot(r.x - x, r.z - z);
      }
    } catch (e) {
      console.warn('[ridebxl] nearestRoad', e);
    }
    if (!road) {
      const g = this._ensureGraph();
      const id = g.nearestNode(x, z, 600, true);
      if (id < 0) return null;
      cx = g.x[id];
      cz = g.z[id];
      const e = g.start[id];
      heading = Math.atan2(g.x[g.to[e]] - cx, g.z[g.to[e]] - cz);
      dist = Math.hypot(cx - x, cz - z);
    }
    if (dist > 300) return null;
    if (road && road.oneway === -1) heading += Math.PI;
    const w = (road && road.w) || 7;
    const lx = Math.cos(heading); // left of travel (drive on the left)
    const lz = -Math.sin(heading);
    const pinOff = Math.max(0.8, w / 2 - 1.4);
    const paxOff = w / 2 + 1.1;
    let street = '';
    try { street = this.world.streetName ? this.world.streetName(cx, cz) || '' : (road && road.name) || ''; } catch { street = ''; }
    return { x: cx + lx * pinOff, z: cz + lz * pinOff, px: cx + lx * paxOff, pz: cz + lz * paxOff, yaw: Math.atan2(-lx, -lz), street, heading };
  }

  _pickPlace(fromX, fromZ, minD, maxD, exclude) {
    const places = this._placesList();
    let best = null;
    // stations, landmarks & attractions ~45 % of the time, otherwise any named pub / café / venue
    if (!this._major) this._major = places.filter((p) => p.weight >= 2);
    for (let tries = 0; tries < 80 && places.length; tries++) {
      const pool = this._major.length && tries < 40 && this.rng() < 0.45 ? this._major : places;
      const p = pool[Math.floor(this.rng() * pool.length)];
      if (exclude && p.name === exclude) continue;
      const d = Math.hypot(p.x - fromX, p.z - fromZ);
      if (d >= minD && d <= maxD) {
        best = p;
        break;
      }
    }
    if (!best && places.length) {
      // the closest place beyond minD
      let bd = Infinity;
      for (const p of places) {
        if (exclude && p.name === exclude) continue;
        const d = Math.hypot(p.x - fromX, p.z - fromZ);
        const score = Math.abs(d - (minD + maxD) / 2);
        if (d >= minD * 0.5 && score < bd) {
          bd = score;
          best = p;
        }
      }
    }
    if (!best && this.world.randomRoadPoint) {
      try {
        const r = this.world.randomRoadPoint(this.rng, { kinds: PIN_KINDS });
        if (r) best = { name: (this.world.streetName && this.world.streetName(r.x, r.z)) || 'Street corner', x: r.x, z: r.z };
      } catch { /* ignore */ }
    }
    return best;
  }

  _makeOffer() {
    if (!this._ensureGraph().n) {
      this.toast('No roads loaded — RideBXL needs the road map', 'bad');
      return false;
    }
    for (let attempt = 0; attempt < 8; attempt++) if (this._tryOffer()) return true;
    return false;
  }

  _tryOffer() {
    const ent = this._entity();
    if (!ent) return false;
    const g = this._ensureGraph();
    const ex = ent.position.x;
    const ez = ent.position.z;
    const pu = this._pickPlace(ex, ez, 150, 1300);
    if (!pu) return false;
    const puK = this._kerb(pu.x, pu.z);
    if (!puK) return false;
    const df = this._pickPlace(puK.x, puK.z, 700, 4200, pu.name);
    if (!df) return false;
    const dfK = this._kerb(df.x, df.z);
    if (!dfK) return false;
    const trip = g.route(puK.x, puK.z, dfK.x, dfK.z);
    if (trip.length < 300) return false;
    const approach = Math.hypot(puK.x - ex, puK.z - ez) * 1.3;
    const estDuration = trip.length / AVG_SPEED + 25;
    const name = pick(PASSENGERS, this.rng);
    const seed = Math.floor(this.rng() * 1e9);
    const hue = Math.floor(this.rng() * 360);
    this.job = {
      id: seed,
      pax: { name, rating: Math.round((4.3 + this.rng() * 0.7) * 100) / 100, seed, hue },
      pickup: { name: pu.name, ...puK },
      dropoff: { name: df.name, ...dfK },
      estDistance: trip.length,
      estDuration,
      estFare: computeFare(trip.length, estDuration, 5),
      approach,
      tripRoute: trip.pts
    };
    this.phase = 'offer';
    this.offerLeft = OFFER_TIMEOUT_S;
    if (this.root.classList.contains('rl-collapsed')) {
      this._wasCollapsedBeforeOffer = true;
      this.togglePanel(true);
    }
    this.tab = 'drive';
    this._render();
    return true;
  }

  _nextOfferDelay() {
    return OFFER_MIN_S + Math.random() * (OFFER_MAX_S - OFFER_MIN_S);
  }

  _endJob() {
    this.job = null;
    this.phase = 'idle';
    this.holdT = 0;
    this.route = [];
    this.routeIdx = 0;
    this.offerIn = this._nextOfferDelay();
    this.pin.hide();
    this.ribbon.hide();
    if (this.passenger && !this._paxAnim) {
      this.passenger.dispose();
      this.passenger = null;
    }
    this._emitRoute();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Pickup / dropoff
  // ---------------------------------------------------------------------------------------------------------------
  _checkStop(dt, px, pz, speed, target, done) {
    const d = Math.hypot(px - target.x, pz - target.z);
    if (d < STOP_RADIUS && speed < STOP_SPEED) {
      this.holdT += dt;
      if (this.holdT >= STOP_HOLD_S) {
        this.holdT = 0;
        done();
      }
    } else {
      this.holdT = Math.max(0, this.holdT - dt * 2);
    }
  }

  _spawnPassenger() {
    if (this.passenger) this.passenger.dispose();
    const p = this.job.pickup;
    this.passenger = new PassengerFigure(this.scene, this.job.pax.seed);
    this.passenger.place(p.px, this._ground(p.px, p.pz), p.pz, p.yaw);
    this.passenger.wave = 1;
    this.passenger.setOpacity(1);
    this._paxAnim = null;
  }

  _startBoarding() {
    this.phase = 'boarding';
    const ent = this._entity();
    this._paxAnim = { kind: 'in', t: 0, from: this.passenger ? this.passenger.group.position.clone() : null, ent };
    this.pin.hide();
    this.ribbon.hide();
    this.route = [];
    this._emitRoute();
    this._render();
  }

  _boarded() {
    const j = this.job;
    this.phase = 'ride';
    this.ride = { dist: 0, time: 0, penalty: 0, overT: 0, chatIn: 14 + this.rng() * 12, cd: { crash: 0, brake: 0, speed: 0 }, events: [] };
    this.pin.show(j.dropoff.x, this._ground(j.dropoff.x, j.dropoff.z), j.dropoff.z, C_DROPOFF);
    this._reroute(true);
    this.toast(pick(CHAT.board), '', j.pax.name);
    this._render();
  }

  _startAlighting() {
    this.phase = 'alighting';
    const ent = this._entity();
    const j = this.job;
    // the passenger steps out on the kerb side and walks off
    if (!this.passenger) this.passenger = new PassengerFigure(this.scene, j.pax.seed);
    const sx = ent.position.x;
    const sz = ent.position.z;
    this.passenger.place(sx, this._ground(sx, sz), sz, j.dropoff.yaw + Math.PI);
    this.passenger.wave = 0;
    this.passenger.setOpacity(0);
    this._paxAnim = { kind: 'out', t: 0, from: new THREE.Vector3(sx, this._ground(sx, sz), sz), to: new THREE.Vector3(j.dropoff.px, this._ground(j.dropoff.px, j.dropoff.pz), j.dropoff.pz) };
    this.pin.hide();
    this.ribbon.hide();
    this.route = [];
    this._emitRoute();
    this._finishRide();
  }

  _updatePassenger(dt, ent) {
    const p = this.passenger;
    if (!p) return;
    const a = this._paxAnim;
    if (!a) {
      p.walk = 0;
      // turn to face the car once it's close
      if (this.phase === 'pickup' && ent) {
        const d = Math.hypot(ent.position.x - p.group.position.x, ent.position.z - p.group.position.z);
        if (d < 40) p.group.rotation.y += (Math.atan2(ent.position.x - p.group.position.x, ent.position.z - p.group.position.z) - p.group.rotation.y) * Math.min(1, dt * 3);
        p.wave = d < 120 ? 1 : 0.35;
      }
      p.update(dt);
      return;
    }
    a.t += dt;
    if (a.kind === 'in') {
      const T = 1.3;
      const k = Math.min(1, a.t / T);
      const tx = ent.position.x;
      const tz = ent.position.z;
      if (a.from) {
        const x = a.from.x + (tx - a.from.x) * k;
        const z = a.from.z + (tz - a.from.z) * k;
        p.place(x, this._ground(x, z), z, Math.atan2(tx - a.from.x, tz - a.from.z));
      }
      p.wave = Math.max(0, 1 - k * 3);
      p.walk = 1;
      p.setOpacity(k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45);
      p.group.scale.setScalar(p.baseScale * (1 - 0.25 * Math.max(0, k - 0.6) / 0.4));
      p.update(dt);
      if (k >= 1) {
        p.dispose();
        this.passenger = null;
        this._paxAnim = null;
        if (this.phase === 'boarding') this._boarded();
      }
    } else {
      const T = 3.2;
      const k = Math.min(1, a.t / T);
      const kk = Math.min(1, a.t / 1.4);
      const x = a.from.x + (a.to.x - a.from.x) * kk;
      const z = a.from.z + (a.to.z - a.from.z) * kk;
      p.place(x, this._ground(x, z), z, Math.atan2(a.to.x - a.from.x, a.to.z - a.from.z) || 0);
      p.walk = kk < 1 ? 1 : 0;
      p.wave = kk >= 1 ? 1 : 0;
      p.setOpacity(k < 0.12 ? k / 0.12 : k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1);
      p.group.scale.setScalar(p.baseScale);
      p.update(dt);
      if (k >= 1) {
        p.dispose();
        this.passenger = null;
        this._paxAnim = null;
      }
    }
  }

  async _finishRide() {
    const j = this.job;
    const r = this.ride;
    // lateness vs. the estimate
    let late = 0;
    if (r.time > j.estDuration * 2.2) late = 1.5;
    else if (r.time > j.estDuration * 1.6) late = 0.75;
    if (late) this._event('late', late);
    const rating = clamp(Math.round(5 - r.penalty), 1, 5);
    this.phase = 'finishing';
    this._render();
    const payload = { pickup: j.pickup.name, dropoff: j.dropoff.name, distance_m: r.dist, duration_s: r.time, rating };
    this.toast(pick(rating >= 4 ? CHAT.happy : CHAT.meh), '', j.pax.name);
    let res = null;
    let err = null;
    try {
      if (!this.backend) throw new Error('No backend');
      res = await this.backend.finishRide(payload);
    } catch (e) {
      err = e;
      console.warn('[ridebxl] finish_ride rejected:', e && e.message);
    }
    if (this._disposed) return;
    const result = { ...payload, fare: res ? res.fare : 0, estFare: computeFare(r.dist, r.time, rating), error: err ? err.message || String(err) : null,
      events: r.events.slice(), profile: res, pax: j.pax.name };
    this.lastResult = result;
    if (res) {
      this.today.earnings = Math.round((this.today.earnings + res.fare) * 100) / 100;
      this.today.rides += 1;
      this._saveToday();
    } else {
      this.toast(`Ride not recorded: ${result.error}`, 'bad', null, 5200);
    }
    this._showResult(result);
    this._endJob();
    this._recentCache = null;
    this._leaderCache = null;
    this._render();
    if (this.ui.onRideFinished) {
      try { this.ui.onRideFinished(result); } catch { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Ride quality
  // ---------------------------------------------------------------------------------------------------------------
  _bindCollisions() {
    const c = this.controllers;
    const fn = (e) => {
      this._hookSeen = true;
      const impulse = e && (e.impulse ?? e.speed ?? (e.detail && e.detail.impulse));
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

  _onCollision(impulse) {
    if (this.phase !== 'ride' || !this.ride || impulse < 1.5) return;
    if (this.ride.cd.crash > 0) return;
    this.ride.cd.crash = 1.5;
    this._event('crash', impulse > 7 ? 1.0 : 0.5);
    this.toast(pick(CHAT.crash), 'bad', this.job.pax.name);
  }

  _event(kind, penalty) {
    if (!this.ride) return;
    this.ride.penalty += penalty;
    this.ride.events.push(kind);
  }

  _rideQuality(dt, speed, step, teleported) {
    const r = this.ride;
    if (!r) return;
    r.time += dt;
    r.dist += step;
    for (const k in r.cd) r.cd[k] = Math.max(0, r.cd[k] - dt);
    if (teleported && !r.tpNoted) {
      r.tpNoted = true;
      this.toast(pick(CHAT.teleport), '', this.job.pax.name);
    }
    const decel = dt > 0 ? (this._lastSpeed - speed) / dt : 0;
    // collisions: a speed drop far sharper than the brakes can do (when the controllers don't report hits)
    if (!this._hookSeen && !teleported && this._lastSpeed - speed > 3.5 && decel > 40) this._onCollision(this._lastSpeed - speed);
    // harsh braking: hard deceleration held at speed
    if (decel > 10.5 && this._lastSpeed > 6 && decel < 40) this._brakeT += dt;
    else this._brakeT = Math.max(0, this._brakeT - dt * 2);
    if (this._brakeT > 0.35 && r.cd.brake <= 0) {
      r.cd.brake = 4;
      this._brakeT = 0;
      this._event('brake', 0.3);
      this.toast(pick(CHAT.brake), '', this.job.pax.name);
    }
    // speeding over 35 mph for long
    if (speed > SPEED_LIMIT) r.overT += dt;
    else r.overT = Math.max(0, r.overT - dt * 0.5);
    if (r.overT > 6 && r.cd.speed <= 0) {
      r.cd.speed = 10;
      r.overT = 0;
      this._event('speeding', 0.4);
      this.toast(pick(CHAT.speeding), '', this.job.pax.name);
    }
    // taking far longer than the estimate
    if (!r.slowNoted && r.time > this.job.estDuration * 1.6) {
      r.slowNoted = true;
      this.toast(pick(CHAT.slow), '', this.job.pax.name);
    }
    if (r.time > 3300) {
      this.toast(`${this.job.pax.name} got out and walked`, 'bad');
      this._endJob();
      this._render();
      return;
    }
    // idle chatter
    r.chatIn -= dt;
    if (r.chatIn <= 0) {
      r.chatIn = 22 + this.rng() * 22;
      this.toast(pick(CHAT.cruise), '', this.job.pax.name, 4200);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Route
  // ---------------------------------------------------------------------------------------------------------------
  _reroute(force = false) {
    const ent = this._entity();
    const target = this.getTarget();
    if (!ent || !target) return;
    if (!force && this._rerouteCd > 0) return;
    this._rerouteCd = 2.5;
    const g = this._ensureGraph();
    const r = g.route(ent.position.x, ent.position.z, target.x, target.z);
    this.route = r.pts;
    this.routeIdx = 0;
    this.routeColor = target.kind === 'pickup' ? C_PICKUP : C_DROPOFF;
    this._redrawRibbon();
    this._emitRoute();
  }

  _emitRoute() {
    if (this.ui.onRouteChange) {
      try { this.ui.onRouteChange(this.getRoute(), this.getTarget()); } catch (e) { console.warn('[ridebxl] onRouteChange', e); }
    }
  }

  _redrawRibbon() {
    if (!this.route.length) {
      this.ribbon.hide();
      return;
    }
    const ent = this._entity();
    const pts = [];
    if (ent) pts.push({ x: ent.position.x, z: ent.position.z });
    for (let i = this.routeIdx + 1; i < this.route.length; i++) pts.push(this.route[i]);
    this.ribbon.set(pts, (x, z) => this._ground(x, z), this.routeColor);
  }

  _followRoute(dt, px, pz, teleported) {
    this._rerouteCd -= dt;
    if (!this.route.length || teleported) {
      this._reroute(true);
      return;
    }
    // nearest segment from the current index onwards
    let best = this.routeIdx;
    let bestD = Infinity;
    const end = Math.min(this.route.length - 1, this.routeIdx + 60);
    for (let i = Math.max(0, this.routeIdx - 2); i < end; i++) {
      const a = this.route[i];
      const b = this.route[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const L2 = dx * dx + dz * dz || 1;
      const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / L2, 0, 1);
      const d = Math.hypot(a.x + dx * t - px, a.z + dz * t - pz);
      if (d < bestD - 0.01) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > 40) {
      this._reroute(false);
      return;
    }
    this.routeIdx = best;
    this._ribbonT = (this._ribbonT || 0) - dt;
    if (this._ribbonT <= 0) {
      this._ribbonT = 0.25;
      this._redrawRibbon();
      this._routeEmitT = (this._routeEmitT || 0) - 1;
      if (this._routeEmitT <= 0) {
        this._routeEmitT = 4; // ~1 s
        this._emitRoute();
      }
    }
  }

  _remaining(px, pz) {
    const t = this.getTarget();
    if (!t) return 0;
    if (!this.route.length) return Math.hypot(t.x - px, t.z - pz);
    const nxt = this.route[Math.min(this.route.length - 1, this.routeIdx + 1)];
    return Math.hypot(nxt.x - px, nxt.z - pz) + polylineLength(this.route, this.routeIdx + 1);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------------------------------------------
  _buildDom() {
    injectStyle('rl-style', CSS);
    const host = this.ui.container || document.body;
    const root = (this.root = h('div', 'rl-root'));
    let collapsed = false;
    try { collapsed = !!safeStorage.get('brusselsloop_rl_collapsed'); } catch { /* ignore */ }
    root.classList.toggle('rl-collapsed', collapsed);

    // collapsed handle
    const handle = (this.handle = h('button', 'rl-handle'));
    handle.type = 'button';
    handle.title = 'Open RideBXL [R]';
    const hl = h('span', 'rl-logo');
    hl.append(h('b', '', 'R'), document.createTextNode('Ride'), h('em', '', 'BXL'));
    this.handleSub = h('span', 'rl-hsub', '');
    handle.append(hl, this.handleSub, h('span', 'rl-kbd', 'R'));
    handle.addEventListener('click', () => this.togglePanel(true));

    // phone
    const phone = (this.phone = h('section', 'rl-phone'));
    phone.setAttribute('aria-label', 'RideBXL driver app');
    const head = h('div', 'rl-head');
    const logo = h('span', 'rl-logo');
    logo.append(h('b', '', 'R'), document.createTextNode('Ride'), h('em', '', 'BXL'));
    this.statusEl = h('span', 'rl-status');
    const min = h('button', 'rl-iconbtn');
    min.type = 'button';
    min.title = 'Minimise [R]';
    min.setAttribute('aria-label', 'Minimise RideBXL');
    min.appendChild(icon('min'));
    min.addEventListener('click', () => this.togglePanel(false));
    head.append(logo, this.statusEl, min);

    const tabs = h('div', 'rl-tabs');
    this.tabBtns = {};
    for (const [id, label] of [['drive', 'Drive'], ['leaders', 'Leaderboard'], ['rides', 'My rides']]) {
      const b = h('button', 'rl-tab', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.tab = id;
        this._render();
      });
      this.tabBtns[id] = b;
      tabs.appendChild(b);
    }
    this.body = h('div', 'rl-body');
    this.foot = h('div', 'rl-foot');
    phone.append(head, tabs, this.body, this.foot);
    phone.addEventListener('click', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('button') : null;
      if (btn && e.detail > 0) btn.blur();
    });
    root.append(handle, phone);
    host.appendChild(root);

    // HUD chip
    const chip = (this.chip = h('div', 'rl-chip'));
    chip.setAttribute('aria-live', 'polite');
    this.chipDot = h('span', 'rl-dot');
    const ct = h('div', 'rl-ct');
    this.chipTitle = h('b', '', '');
    this.chipSub = h('span', '', '');
    ct.append(this.chipTitle, this.chipSub);
    this.chipBig = h('span', 'rl-big', '');
    this.chipHold = h('div', 'rl-hold');
    this.chipHoldBar = h('i');
    this.chipHold.appendChild(this.chipHoldBar);
    chip.append(this.chipDot, ct, this.chipBig, this.chipHold);
    root.appendChild(chip);

    this.pinLabel = h('div', 'rl-pinlabel', '');
    this.arrow = h('div', 'rl-arrow');
    const arr = h('div', 'rl-arr');
    arr.appendChild(icon('arrow'));
    this.arrowInner = arr;
    this.arrowDist = h('small', '', '');
    this.arrow.append(arr, this.arrowDist);
    this.toasts = h('div', 'rl-toasts');
    root.append(this.pinLabel, this.arrow, this.toasts);
  }

  _bindKeys() {
    this._onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyR' && !e.repeat) {
        this.togglePanel();
      } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && this.phase === 'offer') {
        e.preventDefault();
        this.acceptOffer();
      } else if (e.code === 'KeyX' && this.phase === 'offer') {
        this.declineOffer(false);
      } else if (e.code === 'Enter' && this.resultEl) {
        this._closeResult();
      }
    };
    window.addEventListener('keydown', this._onKey);
  }

  _btn(label, cls, onClick, kbd) {
    const b = h('button', `rl-btn ${cls || ''}`);
    b.type = 'button';
    b.appendChild(document.createTextNode(label));
    if (kbd) b.appendChild(h('span', 'rl-kbd', kbd));
    b.addEventListener('click', onClick);
    return b;
  }

  _render() {
    if (this._disposed) return;
    for (const id in this.tabBtns) this.tabBtns[id].classList.toggle('active', this.tab === id);
    // status pill
    this.statusEl.replaceChildren(h('i'), document.createTextNode(this.online ? 'Online' : 'Offline'));
    this.statusEl.classList.toggle('on', this.online);
    // footer
    const name = (this.backend && this.backend.name) || 'Driver';
    this.foot.replaceChildren(document.createTextNode('Driver '), h('b', '', name), h('span', 'rl-sp'), h('span', 'rl-kbd', 'R'), document.createTextNode(' hide'));
    this._renderHandle();
    if (this.root.classList.contains('rl-collapsed')) return;
    if (this.tab === 'drive') this._renderDrive();
    else if (this.tab === 'leaders') this._renderLeaders();
    else this._renderRides();
  }

  _renderHandle() {
    let sub = this.online ? 'Online' : 'Offline';
    if (this.phase === 'offer' && this.job) sub = `New job · ${fmtMoney(this.job.estFare)}`;
    else if (this.phase === 'pickup') sub = 'To pickup';
    else if (this.phase === 'ride') sub = 'On trip';
    this.handleSub.textContent = sub;
  }

  _statsRow() {
    const prof = (this.backend && this.backend.profile) || {};
    const row = h('div', 'rl-stats');
    const s1 = h('div', 'rl-stat');
    s1.append(h('span', '', 'Today'), h('b', '', fmtMoney(this.today.earnings)));
    const s2 = h('div', 'rl-stat');
    s2.append(h('span', '', 'Rides'), h('b', '', String(this.today.rides)));
    const s3 = h('div', 'rl-stat');
    const rb = h('b');
    rb.append(h('span', 'rl-star', '★'), document.createTextNode(prof.rating != null ? Number(prof.rating).toFixed(2) : '—'));
    s3.append(h('span', '', 'Rating'), rb);
    row.append(s1, s2, s3);
    this._statEls = { s1, s2, s3 };
    return row;
  }

  _renderStats() {
    if (this.tab === 'drive' && !this.root.classList.contains('rl-collapsed') && this.phase !== 'offer') this._render();
  }

  _renderDrive() {
    const nodes = [this._statsRow()];
    this._live = {};
    const inCar = this.inRideMode;
    if (!inCar) {
      const card = h('div', 'rl-card');
      const w = h('div', 'rl-warn');
      w.appendChild(icon('car'));
      const tx = h('div');
      tx.append(h('h3', '', this.job ? 'Get back in the car!' : 'RideBXL car needed'),
        h('div', 'rl-sub', this.job ? `${this.job.pax.name} is waiting. Jump back in your RideBXL car.` : 'Jobs only come through in the RideBXL car.'));
      w.appendChild(tx);
      card.appendChild(w);
      if (this.ui.setMode) {
        const b = this._btn('Switch to RideBXL car', 'primary', () => {
          this.ui.setMode(this.rideMode);
          setTimeout(() => this._render(), 0);
        });
        b.style.marginTop = '10px';
        b.style.width = '100%';
        card.appendChild(b);
      }
      nodes.push(card);
    }
    if (!this.job || this.phase === 'idle') {
      const go = h('button', `rl-go ${this.online ? 'off' : ''}`, this.online ? 'Go offline' : 'Go online');
      go.type = 'button';
      if (!inCar && !this.online) go.disabled = true;
      go.addEventListener('click', () => this.setOnline(!this.online));
      nodes.splice(1, 0, go);
      if (this.online && inCar) {
        const c = h('div', 'rl-card');
        const s = h('div', 'rl-searching');
        const rad = h('span', 'rl-radar');
        rad.appendChild(h('i'));
        const tx = h('div');
        tx.append(h('h3', '', 'Finding riders near you…'), h('div', 'rl-sub', 'Keep driving — offers pop up here.'));
        s.append(rad, tx);
        c.appendChild(s);
        nodes.push(c);
      } else if (!this.online && inCar) {
        const c = h('div', 'rl-card');
        c.append(h('h3', '', 'Ready when you are'),
          h('div', 'rl-sub', 'Go online to get trip requests. Pick up at the glowing pin, drive smooth, earn more.'));
        nodes.push(c);
      }
    } else if (this.phase === 'offer') {
      nodes.push(this._offerCard());
    } else {
      nodes.push(this._tripCard());
    }
    this.body.replaceChildren(...nodes);
  }

  _paxHeader(sub) {
    const j = this.job;
    const row = h('div', 'rl-pax');
    const av = h('span', 'rl-avatar', j.pax.name[0]);
    av.style.background = `hsl(${j.pax.hue} 70% 72%)`;
    const tx = h('div');
    const nm = h('h3', '', j.pax.name);
    const st = h('span', 'rl-sub');
    st.style.margin = '0';
    st.textContent = `★ ${j.pax.rating.toFixed(2)}`;
    nm.appendChild(st);
    tx.append(nm, h('div', 'rl-sub', sub));
    row.append(av, tx);
    return row;
  }

  _legs(withDist) {
    const j = this.job;
    const legs = h('div', 'rl-legs');
    const a = h('div', 'rl-leg', j.pickup.name);
    if (j.pickup.street && j.pickup.street !== j.pickup.name) a.appendChild(h('small', '', withDist ? `${j.pickup.street} · ${fmtDist(j.approach)} away` : j.pickup.street));
    else if (withDist) a.appendChild(h('small', '', `${fmtDist(j.approach)} away`));
    const b = h('div', 'rl-leg drop', j.dropoff.name);
    if (j.dropoff.street && j.dropoff.street !== j.dropoff.name) b.appendChild(h('small', '', j.dropoff.street));
    legs.append(a, b);
    return legs;
  }

  _offerCard() {
    const j = this.job;
    const c = h('div', 'rl-card offer');
    const head = this._paxHeader('New trip request');
    const fare = h('div', 'rl-fare');
    fare.append(h('b', '', fmtMoney(j.estFare)), h('span', '', 'est. fare'));
    head.appendChild(fare);
    const meta = h('div', 'rl-meta');
    const m1 = h('span');
    m1.append(h('b', '', fmtDist(j.estDistance)), document.createTextNode(' trip'));
    const m2 = h('span');
    m2.append(h('b', '', `~${fmtMin(j.estDuration)}`));
    meta.append(m1, m2);
    const timer = h('div', 'rl-timer');
    this._live.offerBar = h('i');
    timer.appendChild(this._live.offerBar);
    const row = h('div', 'rl-row');
    row.append(this._btn('Decline', '', () => this.declineOffer(false), 'X'), this._btn('Accept', 'primary', () => this.acceptOffer(), 'Enter'));
    c.append(head, this._legs(true), meta, timer, row);
    return c;
  }

  _tripCard() {
    const j = this.job;
    const c = h('div', 'rl-card');
    const sub = this.phase === 'pickup' ? `Picking up at ${j.pickup.name}` : this.phase === 'boarding' ? 'Getting in…'
      : this.phase === 'ride' ? `Heading to ${j.dropoff.name}` : 'Arrived';
    c.appendChild(this._paxHeader(sub));
    c.appendChild(this._legs(false));
    const meta = h('div', 'rl-meta');
    this._live.remain = h('b', '', '—');
    this._live.eta = h('b', '', '—');
    const m1 = h('span');
    m1.append(this._live.remain, document.createTextNode(' to go'));
    const m2 = h('span');
    m2.append(document.createTextNode('ETA '), this._live.eta);
    meta.append(m1, m2);
    if (this.phase === 'ride' || this.phase === 'finishing') {
      this._live.meter = h('b', '', '£0.00');
      const m3 = h('span');
      m3.append(document.createTextNode('Meter '), this._live.meter);
      meta.appendChild(m3);
    }
    c.appendChild(meta);
    if (this.phase === 'ride') {
      const mood = h('div', 'rl-mood');
      this._live.mood = h('span');
      this._live.mood.appendChild(stars(5));
      mood.append(document.createTextNode('Ride rating'), this._live.mood);
      c.appendChild(mood);
    }
    if (this.phase === 'pickup' || this.phase === 'ride') {
      const row = h('div', 'rl-row');
      row.style.marginTop = '10px';
      row.appendChild(this._btn('Cancel trip', 'small', () => this.cancelTrip()));
      c.appendChild(row);
    }
    return c;
  }

  async _renderLeaders() {
    const wrap = h('div', 'rl-list');
    if (!this._leaderCache || performance.now() - this._leaderCache.t > 60000) {
      this.body.replaceChildren(h('div', 'rl-empty', 'Loading leaderboard…'));
      try {
        this._leaderCache = { t: performance.now(), rows: await this.backend.leaderboard(15) };
      } catch (e) {
        this.body.replaceChildren(h('div', 'rl-empty', `Coubxl't load: ${e.message}`));
        return;
      }
      if (this.tab !== 'leaders') return;
    }
    const me = this.backend && this.backend.name;
    const rows = this._leaderCache.rows;
    if (!rows.length) {
      this.body.replaceChildren(h('div', 'rl-empty', 'No rides yet. Be the first on the board!'));
      return;
    }
    rows.forEach((r, i) => {
      const li = h('div', `rl-li ${r.name === me ? 'me' : ''}`);
      const nm = h('div', 'rl-nm', r.name);
      nm.appendChild(h('small', '', `${r.rides} ride${r.rides === 1 ? '' : 's'} · ★ ${r.rating != null ? r.rating.toFixed(2) : '—'}`));
      const amt = h('div', 'rl-amt', fmtMoney(r.earnings));
      li.append(h('span', 'rl-rank', String(i + 1)), nm, amt);
      wrap.appendChild(li);
    });
    this.body.replaceChildren(wrap);
  }

  async _renderRides() {
    const wrap = h('div', 'rl-list');
    if (!this._recentCache) {
      this.body.replaceChildren(h('div', 'rl-empty', 'Loading your rides…'));
      try {
        this._recentCache = { rows: await this.backend.recentRides() };
      } catch (e) {
        this.body.replaceChildren(h('div', 'rl-empty', `Coubxl't load: ${e.message}`));
        return;
      }
      if (this.tab !== 'rides') return;
    }
    const rows = this._recentCache.rows;
    if (!rows.length) {
      this.body.replaceChildren(h('div', 'rl-empty', 'No rides yet. Go online to get your first job.'));
      return;
    }
    for (const r of rows) {
      const li = h('div', 'rl-li');
      const nm = h('div', 'rl-nm', `${r.pickup} → ${r.dropoff}`);
      const when = r.created_at ? new Date(r.created_at) : null;
      const ts = when && !isNaN(when) ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
      nm.appendChild(h('small', '', `${ts ? ts + ' · ' : ''}${fmtDist(r.distance_m)} · ${fmtDur(r.duration_s)} · ${'★'.repeat(r.rating)}`));
      li.append(nm, h('div', 'rl-amt', fmtMoney(r.fare)));
      wrap.appendChild(li);
    }
    this.body.replaceChildren(wrap);
  }

  _showResult(res) {
    this._closeResult(true);
    const el = (this.resultEl = h('div', `rl-result ${res.error ? 'err' : ''}`));
    const ok = h('div', 'rl-ok');
    ok.appendChild(icon(res.error ? 'x' : 'check'));
    el.appendChild(ok);
    el.appendChild(h('h4', '', res.error ? 'Ride not recorded' : `Trip complete · ${res.pax}`));
    el.appendChild(h('div', 'rl-amount', fmtMoney(res.error ? 0 : res.fare)));
    el.appendChild(stars(res.rating));
    if (res.error) el.appendChild(h('div', 'rl-why', res.error));
    const grid = h('div', 'rl-grid');
    for (const [k, v] of [['Distance', fmtDist(res.distance_m)], ['Time', fmtDur(res.duration_s)], ['Rating', `${res.rating}★`]]) {
      const d = h('div');
      d.append(h('span', '', k), h('b', '', v));
      grid.appendChild(d);
    }
    el.appendChild(grid);
    const notes = [];
    const ev = res.events;
    const count = (k) => ev.filter((e) => e === k).length;
    if (count('crash')) notes.push(`${count('crash')} bump${count('crash') > 1 ? 's' : ''}`);
    if (count('brake')) notes.push('harsh braking');
    if (count('speeding')) notes.push('speeding');
    if (count('late')) notes.push('slow trip');
    el.appendChild(h('div', 'rl-route', `${res.pickup} → ${res.dropoff}${notes.length ? ` · ${notes.join(', ')}` : ' · smooth ride'}`));
    const b = this._btn('Continue', 'primary', () => this._closeResult(), 'Enter');
    b.style.width = '100%';
    el.appendChild(b);
    this.root.appendChild(el);
    this._resultTimer = setTimeout(() => this._closeResult(), 7000);
  }

  _closeResult(instant = false) {
    clearTimeout(this._resultTimer);
    const el = this.resultEl;
    if (!el) return;
    this.resultEl = null;
    if (instant) el.remove();
    else {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }
  }

  _updateLive(ent, speed) {
    const j = this.job;
    const t = this.getTarget();
    const px = ent.position.x;
    const pz = ent.position.z;
    // offer countdown
    if (this.phase === 'offer' && this._live && this._live.offerBar) this._live.offerBar.style.transform = `scaleX(${clamp(this.offerLeft / OFFER_TIMEOUT_S, 0, 1)})`;
    this._renderHandle();
    // trip live numbers
    let remain = 0;
    let eta = 0;
    if (t) {
      remain = this._remaining(px, pz);
      eta = remain / Math.max(AVG_SPEED, Math.min(speed, 13)) + 5;
    }
    if (this._live) {
      if (this._live.remain) this._live.remain.textContent = t ? fmtDist(remain) : '—';
      if (this._live.eta) this._live.eta.textContent = t ? fmtMin(eta) : '—';
      if (this._live.meter && this.ride) this._live.meter.textContent = fmtMoney(computeFare(this.ride.dist, this.ride.time, clamp(Math.round(5 - this.ride.penalty), 1, 5)));
      if (this._live.mood && this.ride) {
        const m = clamp(5 - this.ride.penalty, 1, 5);
        if (m !== this._live.moodVal) {
          this._live.moodVal = m;
          this._live.mood.replaceChildren(stars(m));
        }
      }
    }
    // HUD chip
    const showChip = !!t && (this.phase === 'pickup' || this.phase === 'ride' || this.phase === 'boarding');
    this.chip.classList.toggle('show', showChip);
    if (showChip) {
      const drop = t.kind === 'dropoff';
      this.chip.classList.toggle('drop', drop);
      if (this._chipIcon !== t.kind) {
        this._chipIcon = t.kind;
        this.chipDot.replaceChildren(icon(drop ? 'flag' : 'pin'));
      }
      const near = Math.hypot(px - t.x, pz - t.z) < 45;
      this.chipTitle.textContent = this.phase === 'boarding' ? `${j.pax.name} is getting in…` : drop ? `Drop off at ${t.name}` : `Pick up ${j.pax.name} · ${t.name}`;
      this.chipSub.textContent = this.phase === 'boarding' ? 'Hold on a sec' : near ? (speed >= STOP_SPEED ? 'Pull over at the pin and stop' : 'Hold still…') : `${this.inRideMode ? '' : 'Get back in your RideBXL car · '}ETA ${fmtMin(eta)}`;
      this.chipBig.textContent = fmtDist(remain);
      this.chipHold.classList.toggle('on', this.holdT > 0.01);
      this.chipHoldBar.style.transform = `scaleX(${clamp(this.holdT / STOP_HOLD_S, 0, 1)})`;
    }
    this._targetRemain = remain;
  }

  _updateScreenMarkers() {
    const t = this.getTarget();
    const cam = this.camera;
    const show = t && cam && (this.phase === 'pickup' || this.phase === 'ride');
    if (!show) {
      this.pinLabel.style.display = 'none';
      this.arrow.style.display = 'none';
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const v = (this._v ||= new THREE.Vector3());
    const ent = this._entity();
    const d = ent ? Math.hypot(ent.position.x - t.x, ent.position.z - t.z) : 0;
    const cd = cam.position.distanceTo(this.pin.group.position);
    v.set(t.x, this._ground(t.x, t.z) + 4.2 + clamp(cd / 60, 1, 8) * 3.4, t.z); // just above the hovering pin head
    cam.updateMatrixWorld();
    v.project(cam);
    const behind = v.z > 1 || v.z < -1;
    let sx = (v.x * 0.5 + 0.5) * W;
    let sy = (-v.y * 0.5 + 0.5) * H;
    const margin = 56;
    const onScreen = !behind && sx > margin && sx < W - margin && sy > margin && sy < H - margin;
    const drop = t.kind === 'dropoff';
    const label = fmtDist(this._targetRemain || d);
    if (onScreen) {
      this.arrow.style.display = 'none';
      this.pinLabel.style.display = 'block';
      this.pinLabel.classList.toggle('drop', drop);
      const text = `${drop ? 'Drop-off' : 'Pickup'} · ${label}`;
      if (this.pinLabel.textContent !== text) this.pinLabel.textContent = text;
      this.pinLabel.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -130%)`;
    } else {
      this.pinLabel.style.display = 'none';
      this.arrow.style.display = 'block';
      this.arrow.classList.toggle('drop', drop);
      // direction from screen centre; flip when behind the camera
      let dx = v.x;
      let dy = -v.y;
      if (behind) {
        dx = -dx;
        dy = -dy;
        if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
      }
      const ang = Math.atan2(dy * H, dx * W);
      const cx = W / 2;
      const cy = H / 2;
      const ex = cx - 70;
      const ey = cy - 70;
      const k = Math.min(Math.abs(ex / (Math.cos(ang) || 1e-6)), Math.abs(ey / (Math.sin(ang) || 1e-6)));
      sx = cx + Math.cos(ang) * k;
      sy = cy + Math.sin(ang) * k;
      this.arrow.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
      this.arrowInner.style.transform = `rotate(${ang + Math.PI / 2}rad)`;
      this.arrowDist.textContent = label;
    }
  }

  _loadToday() {
    const t = safeStorage.get('brusselsloop_rl_today');
    if (t && t.date === todayKey()) return t;
    return { date: todayKey(), earnings: 0, rides: 0 };
  }

  _saveToday() {
    this.today.date = todayKey();
    safeStorage.set('brusselsloop_rl_today', this.today);
  }
}
