import * as THREE from 'three/webgpu';
import { Fn, float, color, attribute, time, mod, step, mix, smoothstep, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cityUniforms } from './tsl-materials.js';
import { createTreeField } from './trees.js';
import { vertexColorMaterial, glowMaterial, lampPoolMaterial } from './city/materials.js';
import { hash01, ringBox, pointInRing, obbCollider } from './city/util.js';
import { RoadIndex } from './city/road-index.js';

// js/street-details.js — London street furniture (Workstream F), all InstancedMesh (scene-culling.js chunks and
// distance-culls them) built from small vertex-coloured merged geometries:
//  - Victorian cast-iron lamp posts along the pavements (lanterns glow at night), "dolphin" lamps on the Embankment
//  - UK 3-aspect traffic signals at GEO.signals on the left kerb of each approach (lenses cycle in a TSL shader, or
//    follow traffic.js through setSignalPhase), Belisha beacons (flashing amber globes) at zebra crossings
//  - bus shelters at GEO.busStops, red K6 telephone kiosks, red pillar boxes, bollards at pedestrian street ends,
//    park benches along park paths
//  - trees (js/trees.js): GEO.trees (mostly London planes) + seeded scatter in parks & woods
// buildStreetDetails(scene, opts) is called by js/london-city.js (see there for opts).

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// ---- prop geometry helpers ------------------------------------------------------------------------------------------
function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}
const box = (w, h, d, x, y, z, hex) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const cyl = (rt, rb, h, x, y, z, hex, seg = 6, open = true) => colored(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y, z), hex);
const merge = (parts) => { const g = mergeGeometries(parts, false); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };

const IRON = 0x15181a, IRON_GREEN = 0x1d2b22, K6_RED = 0xb3121b, PILLAR_RED = 0xb8121a, GREY = 0x55595c;

function lampGeometry() {
  return merge([
    cyl(0.12, 0.2, 0.6, 0, 0.3, 0, IRON, 6),          // base
    cyl(0.06, 0.1, 3.4, 0, 2.3, 0, IRON, 5),          // column
    box(0.5, 0.05, 0.06, 0, 3.6, 0, IRON),            // ladder bar
    cyl(0.3, 0.1, 0.14, 0, 4.06, 0, IRON, 4).rotateY(Math.PI / 4), // lantern seat
    cyl(0.03, 0.34, 0.3, 0, 4.82, 0, IRON, 4, false).rotateY(Math.PI / 4) // lantern roof + finial
  ]);
}
function lanternGeometry() { return cyl(0.27, 0.17, 0.55, 0, 4.4, 0, 0xffffff, 4, false).rotateY(Math.PI / 4); }

function signalGeometry(isBrussels = false) {
  // Brussels uses a compact Belgian-style dark signal head; London retains its original UK backing board.
  if (isBrussels) return merge([
    cyl(0.07, 0.08, 3.3, 0, 1.65, 0, 0x303638),
    box(0.38, 1.02, 0.22, 0, 2.95, 0.08, 0x171b1d),
    box(0.44, 0.08, 0.26, 0, 3.47, 0.08, 0x171b1d),
    box(0.44, 0.08, 0.26, 0, 2.43, 0.08, 0x171b1d),
    box(0.14, 0.22, 0.18, 0, 1.15, 0.08, 0x303638)
  ]);
  // pole + 3-aspect head (facing +z) with backing board
  return merge([
    cyl(0.07, 0.08, 3.3, 0, 1.65, 0, 0x2a2c2e),
    box(0.34, 0.95, 0.24, 0, 2.95, 0.12, 0x0d0e0f),
    box(0.56, 1.15, 0.03, 0, 2.95, 0.0, 0x111213),
    box(0.6, 0.04, 0.035, 0, 3.52, 0.0, 0xe8e8e8), box(0.6, 0.04, 0.035, 0, 2.38, 0.0, 0xe8e8e8),
    box(0.04, 1.15, 0.035, 0.29, 2.95, 0.0, 0xe8e8e8), box(0.04, 1.15, 0.035, -0.29, 2.95, 0.0, 0xe8e8e8),
    box(0.24, 0.05, 0.12, 0, 3.27, 0.3, 0x0d0e0f), box(0.24, 0.05, 0.12, 0, 2.97, 0.3, 0x0d0e0f), box(0.24, 0.05, 0.12, 0, 2.67, 0.3, 0x0d0e0f),
    box(0.16, 0.3, 0.16, 0, 1.15, 0.1, 0x202224) // push-button / wait box
  ]);
}
const LENS_Y = [3.22, 2.92, 2.62]; // red, amber, green

function belishaPole() {
  const parts = [];
  for (let i = 0; i < 9; i++) parts.push(cyl(0.055, 0.055, 0.28, 0, 0.14 + i * 0.28, 0, i % 2 ? 0xf0f0f0 : 0x111111));
  parts.push(cyl(0.14, 0.16, 0.12, 0, 0.06, 0, 0x111111, 6, false));
  return merge(parts);
}
function belishaGlobe() { return colored(new THREE.SphereGeometry(0.2, 8, 5).translate(0, 2.75, 0), 0xffffff); }
function pedestrianSignalGeometry() {
  return merge([
    box(0.34, 0.62, 0.18, 0, 1.95, 0.12, 0x171b1d),
    colored(new THREE.CircleGeometry(0.075, 10).translate(0, 2.12, 0.22), 0xf12b2b),
    colored(new THREE.CircleGeometry(0.075, 10).translate(0, 1.78, 0.22), 0x35c66b)
  ]);
}

function shelterGlassGeometry() {
  // the clear panes of shelterGeometry (drawn apart with a see-through material: opaque panes read as grey boxes)
  const glass = 0xffffff;
  return merge([
    box(4.0, 2.0, 0.03, 0, 1.35, -0.6, glass),
    box(0.03, 2.0, 1.1, -2.0, 1.35, -0.1, glass), box(0.03, 2.0, 1.1, 2.0, 1.35, -0.1, glass)
  ]);
}
let _shelterGlass = null;
function shelterGlassMaterial() {
  if (!_shelterGlass) {
    _shelterGlass = new THREE.MeshStandardNodeMaterial({ color: 0xa9bfc4, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.22, depthWrite: false });
    _shelterGlass.name = 'ShelterGlass';
  }
  return _shelterGlass;
}
function shelterGeometry() {
  // 4 m x 1.4 m shelter, open toward the road (+z), back glazing (shelterGlassGeometry), roof, end panels; bus-stop
  // flag pole at one end
  const frame = 0x2d3133;
  return merge([
    box(4.2, 0.12, 1.6, 0, 2.55, 0.1, frame),
    box(4.0, 0.06, 0.06, 0, 0.32, -0.6, frame), box(4.0, 0.06, 0.06, 0, 2.38, -0.6, frame),
    box(0.08, 2.5, 0.08, -2.05, 1.25, -0.62, frame), box(0.08, 2.5, 0.08, 2.05, 1.25, -0.62, frame),
    box(0.08, 2.5, 0.08, -2.05, 1.25, 0.5, frame), box(0.08, 2.5, 0.08, 2.05, 1.25, 0.5, frame),
    box(2.0, 0.08, 0.35, 0.6, 0.48, -0.4, 0x3d4245), // bench
    box(1.1, 1.8, 0.06, -1.3, 1.3, -0.55, 0xd6dcd8),  // ad panel (lit)
    cyl(0.04, 0.04, 2.9, 2.6, 1.45, 0.55, 0x9aa0a4, 6),
    box(0.5, 0.5, 0.04, 2.6, 2.75, 0.55, 0xc0121a), box(0.36, 0.12, 0.05, 2.6, 2.75, 0.55, 0xf2f2f2)
  ]);
}
function k6Geometry() {
  const R = K6_RED, gl = 0x1b2326;
  const parts = [box(1.0, 0.12, 1.0, 0, 0.06, 0, 0x8f8f8a), box(0.92, 2.3, 0.92, 0, 1.27, 0, R), box(1.0, 0.18, 1.0, 0, 2.5, 0, R)];
  parts.push(cyl(0.02, 0.55, 0.22, 0, 2.7, 0, R, 4, false).rotateY(Math.PI / 4));
  // glazed door / side panels (dark) framed by red glazing bars, white crown sign strip
  for (const [nx, nz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
    const ox = nx * 0.465, oz = nz * 0.465;
    parts.push(box(nx ? 0.02 : 0.72, 1.62, nz ? 0.02 : 0.72, ox, 1.36, oz, gl));
    for (const c of [-0.12, 0.12]) parts.push(box(nx ? 0.03 : 0.03, 1.62, nz ? 0.03 : 0.03, ox * 1.02 + (nz ? c : 0), 1.36, oz * 1.02 + (nx ? c : 0), R));
    for (const y of [0.9, 1.3, 1.7]) parts.push(box(nx ? 0.03 : 0.72, 0.03, nz ? 0.03 : 0.72, ox * 1.02, y, oz * 1.02, R));
    parts.push(box(nx ? 0.02 : 0.6, 0.12, nz ? 0.02 : 0.6, ox * 1.01, 2.3, oz * 1.01, 0xf0efe6));
  }
  return merge(parts);
}
function bpostMailboxGeometry() {
  // Freestanding Belgian bpost-style mailbox: compact red cabinet, sloped cap, mail slot and pale service label.
  const red = 0xe32636;
  return merge([
    box(0.58, 1.02, 0.38, 0, 1.02, 0, red),
    box(0.62, 0.12, 0.42, 0, 1.59, 0, red),
    box(0.46, 0.16, 0.025, 0, 1.31, 0.205, 0xf4eee7),
    box(0.3, 0.045, 0.025, 0, 1.03, 0.205, 0x202326),
    box(0.42, 0.035, 0.025, 0, 0.78, 0.205, 0xf4eee7),
    box(0.1, 0.72, 0.1, 0, 0.36, 0, 0x44484a),
    box(0.38, 0.035, 0.025, 0, 1.38, 0.205, 0xffd54a)
  ]);
}
function pillarGeometry() {
  return merge([
    cyl(0.29, 0.29, 1.25, 0, 0.62, 0, PILLAR_RED, 10), cyl(0.31, 0.27, 0.18, 0, 1.33, 0, PILLAR_RED, 10, false),
    colored(new THREE.SphereGeometry(0.29, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.42, 0), PILLAR_RED),
    cyl(0.31, 0.33, 0.12, 0, 0.06, 0, 0x111111, 10), box(0.3, 0.05, 0.04, 0, 1.12, 0.28, 0x111111)
  ]);
}
function bollardGeometry() { return merge([cyl(0.09, 0.11, 0.95, 0, 0.47, 0, IRON, 8), cyl(0.12, 0.12, 0.06, 0, 0.98, 0, 0xb59a3a, 8, false)]); }
function benchGeometry() {
  const wood = 0x6b4a2c;
  return merge([
    box(1.8, 0.05, 0.42, 0, 0.45, 0, wood), box(1.8, 0.32, 0.04, 0, 0.72, -0.22, wood),
    box(0.06, 0.45, 0.45, -0.8, 0.22, 0, IRON), box(0.06, 0.45, 0.45, 0.8, 0.22, 0, IRON)
  ]);
}

/** InstancedMesh from instance list [{x, y, z, yaw, s}] */
function instanced(geo, mat, list, name, { cast = true } = {}) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((t, i) => {
    _q.setFromAxisAngle(_up, t.yaw || 0);
    _p.set(t.x, t.y || 0, t.z);
    _s.setScalar(t.s || 1);
    _m.compose(_p, _q, _s);
    m.setMatrixAt(i, _m);
  });
  m.instanceMatrix.needsUpdate = true;
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}
/** yaw so that local +z faces direction (dx, dz) */
const yawTo = (dx, dz) => Math.atan2(dx, dz);

// ---- signal lens material: per-instance cycle offset; or CPU-driven state (setSignalPhase) ---------------------------
const SIG = { uMode: uniform(0), cycle: 60, fn: null };
function lensMaterial(kind) {
  // kind 0 red, 1 amber, 2 green. Cycle (s): green 0..24, amber 24..27, red 27..57, red+amber 57..60
  const m = new THREE.MeshBasicNodeMaterial();
  const off = attribute('sigOff', 'float');
  const st = attribute('sigState', 'float'); // CPU mode: 0 red 1 amber 2 green 3 red+amber
  const t = mod(time.add(off), SIG.cycle);
  const g = step(t, 24.0), a = step(24.0, t).mul(step(t, 27.0)), r = step(27.0, t), ra = step(57.0, t);
  const onAuto = kind === 0 ? r : kind === 1 ? a.add(ra) : g;
  const onCpu = kind === 0 ? step(st, 0.5).add(step(2.5, st)) : kind === 1 ? step(0.5, st).mul(step(st, 1.5)).add(step(2.5, st)) : step(1.5, st).mul(step(st, 2.5));
  const on = mix(onAuto, onCpu, SIG.uMode).min(1.0);
  const c = color([0xff2a1a, 0xffa31a, 0x2aff8a][kind]);
  m.colorNode = Fn(() => c.mul(on.mul(mix(float(2.2), float(3.2), smoothstep(0.3, 1.2, cityUniforms.uInteriorGlow))).add(0.04)))();
  m.name = 'SignalLens' + kind;
  return m;
}

function buildStreetDetails(scene, opts) {
  const { geo, world, ctx, inRegion, roads: rd, ground: gnd, details = true, trees = true, parent = scene, city = 'london' } = opts;
  const isBrussels = city === 'brussels';
  const group = new THREE.Group();
  group.name = isBrussels ? 'BrusselsStreetDetails' : 'LondonStreetDetails';
  parent.add(group);
  const footprints = [], colliders = [];
  const stats = {};
  const signalHeads = [];
  const fp = (x, z, r, kind) => footprints.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, kind });
  const vc = vertexColorMaterial();

  if (details) {
    // ---- lamp posts along pavements --------------------------------------------------------------------------------
    const lamps = [];
    for (const st of rd.sidewalks.strips) {
      const p = st.pts, n = p.length / 2;
      if (n < 2) continue;
      const spacing = st.kind === 'trunk' || st.kind === 'primary' ? 34 : 40;
      let acc = (hash01(st.road * 7 + (st.side > 0 ? 1 : 0)) * spacing) + (st.side > 0 ? 0 : spacing / 2);
      for (let k = 0; k < n - 1; k++) {
        const ax = p[k * 2], az = p[k * 2 + 1], dx = p[k * 2 + 2] - ax, dz = p[k * 2 + 3] - az, L = Math.hypot(dx, dz);
        if (L < 0.01) continue;
        const ux = dx / L, uz = dz / L;
        // toward the road: -side * left normal, left normal = (uz, -ux)
        const tx = -st.side * uz, tz = st.side * ux;
        let s = acc;
        while (s < L) {
          const off = st.w / 2 - 0.45;
          const x = ax + ux * s + tx * off, z = az + uz * s + tz * off;
          const y = st.y[k] + (st.y[k + 1] - st.y[k]) * (s / L);
          lamps.push({ x, y, z, yaw: yawTo(tx, tz) });
          fp(x, z, 0.25, 'lamp');
          s += spacing;
        }
        acc = s - L;
      }
    }
    const lampsEmb = (gnd.lampSites || []).map((l) => ({ x: l.x, y: l.y, z: l.z, yaw: yawTo(l.nx, l.nz), s: 0.92 }));
    const add = (m) => { if (m) group.add(m); return m; };
    const lampGeo = lampGeometry(), lanternGeo = lanternGeometry();
    add(instanced(lampGeo, vc, lamps, 'Lamps'));
    add(instanced(lanternGeo, glowMaterial(0xffcf8a, { day: 0.35 }), lamps, 'LampLanterns', { cast: false }));
    {
      // pools of light on the pavement / road under each lamp (night only), 13 m across, lifted 4 cm
      const pool = new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2).translate(0, 0.04, 0);
      const pl = lamps.concat(lampsEmb).map((l) => ({ x: l.x, y: (l.y || 0) - (l.s ? 0.9 : 0), z: l.z, yaw: l.yaw }));
      const m = add(instanced(pool, lampPoolMaterial(), pl, 'LampPools', { cast: false }));
      if (m) { m.receiveShadow = false; m.renderOrder = 2; }
    }
    add(instanced(lampGeo, vc, lampsEmb, 'EmbankmentLamps'));
    add(instanced(lanternGeo, glowMaterial(0xffd9a0, { day: 0.35 }), lampsEmb, 'EmbankmentLanterns', { cast: false }));
    stats.lamps = lamps.length + lampsEmb.length;

    // ---- traffic signals -------------------------------------------------------------------------------------------
    const sig = [], sigOff = [];
    const S = geo.signals;
    const clusterOff = new Map();
    for (let i = 0; i < S.length; i += 2) {
      const x = S[i], z = S[i + 1];
      if (!inRegion(x, z)) continue;
      const hit = ctx.carriageIndex.nearest(x, z, 8);
      if (!hit || hit.road.kind === 'service' || hit.road.name === 'Tower Bridge') continue;
      const r = hit.road, ux = hit.dx, uz = hit.dz, lx = uz, lz = -ux; // left of +u
      const hw = r.w / 2;
      const ck = Math.round(x / 40) + ',' + Math.round(z / 40);
      let base = clusterOff.get(ck);
      if (base === undefined) clusterOff.set(ck, (base = hash01(Math.round(x) * 31 + Math.round(z)) * SIG.cycle));
      const axisOff = Math.abs(ux) > Math.abs(uz) ? SIG.cycle / 2 : 0;
      const y = r.deck ? world.groundHeight(hit.x, hit.z) : 0;
      const dirs = r.oneway ? [r.oneway] : [1, -1];
      for (const dir of dirs) {
        // UK signals sit on the left; Belgian signals sit on the right for right-hand traffic.
        const kerbSide = isBrussels ? -1 : 1;
        const px = hit.x + lx * dir * kerbSide * (hw + 0.7), pz = hit.z + lz * dir * kerbSide * (hw + 0.7);
        if (world.isWater(px, pz) && !r.deck) continue;
        const yy = (rd.sidewalks.pavementAt(px, pz) ?? y);
        sig.push({ x: px, y: yy, z: pz, yaw: yawTo(-ux * dir, -uz * dir) });
        sigOff.push(base + axisOff);
        signalHeads.push({ x: px, z: pz, heading: Math.atan2(ux * dir, uz * dir), road: r.id });
        fp(px, pz, 0.3, 'signal');
      }
    }
    const sigMesh = add(instanced(signalGeometry(isBrussels), vc, sig, isBrussels ? 'BrusselsTrafficSignals' : 'TrafficSignals'));
    if (isBrussels) add(instanced(pedestrianSignalGeometry(), vc, sig, 'BrusselsPedestrianSignals'));
    const stateAttrs = [];
    // lenses: one instanced disc mesh per aspect
    const lensMeshes = [];
    if (sig.length) {
      const offA = new Float32Array(sigOff);
      for (let k = 0; k < 3; k++) {
        const g = new THREE.CircleGeometry(0.1, 10).translate(0, LENS_Y[k], 0.245);
        g.deleteAttribute('uv');
        g.setAttribute('sigOff', new THREE.InstancedBufferAttribute(offA, 1));
        const stA = new THREE.InstancedBufferAttribute(new Float32Array(sig.length), 1);
        g.setAttribute('sigState', stA);
        stateAttrs.push(stA);
        const m = add(instanced(g, lensMaterial(k), sig, 'SignalLens' + k, { cast: false }));
        lensMeshes.push(m);
      }
    }
    stats.signals = sig.length;

    // ---- zebra crossings: Belisha beacons -------------------------------------------------------------------------
    const bel = [];
    if (!isBrussels) for (const zc of rd.sites.zebras) {
      const lx = zc.uz, lz = -zc.ux;
      for (const sd of [1, -1]) {
        for (const along of [-1.9, 1.9]) {
          if (along > 0 && sd > 0) continue; // one beacon each side, diagonally
          if (along < 0 && sd < 0) continue;
          const x = zc.x + lx * sd * (zc.hw + 0.45) + zc.ux * along, z = zc.z + lz * sd * (zc.hw + 0.45) + zc.uz * along;
          const y = rd.sidewalks.pavementAt(x, z) ?? zc.y;
          bel.push({ x, y, z, yaw: 0 });
          fp(x, z, 0.2, 'beacon');
        }
      }
    }
    if (!isBrussels) {
      add(instanced(belishaPole(), vc, bel, 'BelishaPoles'));
      add(instanced(belishaGlobe(), glowMaterial(0xffa21c, { blink: 0.75, day: 0.9 }), bel, 'BelishaGlobes', { cast: false }));
    }
    stats.beacons = bel.length;

    // ---- bus shelters, phone boxes, pillar boxes -------------------------------------------------------------------
    // never on a carriageway: a pavement strip of one road can lie across another road at junctions, and furniture
    // there was a solid obstacle in the traffic lane (small and dark at speed = "crashed into nothing")
    const onRoad = (x, z, pad = 0.5) => !!(ctx.carriageIndex && ctx.carriageIndex.onCarriageway(x, z, null, pad));
    const shelters = [], k6 = [], pillars = [];
    const BS = geo.busStops;
    for (let i = 0; i < BS.length; i += 2) {
      const x = BS[i], z = BS[i + 1];
      if (!inRegion(x, z)) continue;
      const hit = ctx.carriageIndex.nearest(x, z, 18);
      if (!hit || hit.road.kind === 'service') continue;
      const r = hit.road, ux = hit.dx, uz = hit.dz, lx = uz, lz = -ux;
      // which side: the stop node's side of the centreline (left if on it)
      const sd = (x - hit.x) * lx + (z - hit.z) * lz >= -0.1 ? 1 : -1;
      const pw = 3.0;
      const off = r.w / 2 + pw * 0.62;
      const px = hit.x + lx * sd * off, pz = hit.z + lz * sd * off;
      const y = rd.sidewalks.pavementAt(px, pz);
      if (y === null) continue; // no pavement there
      if (onRoad(px, pz, 0.6) || onRoad(px + ux * 2.1, pz + uz * 2.1, 0.6) || onRoad(px - ux * 2.1, pz - uz * 2.1, 0.6)) continue;
      // shelter faces the road: local +z toward the road = -sd * left
      const fx = -lx * sd, fz = -lz * sd;
      const big = r.kind === 'trunk' || r.kind === 'primary' || r.kind === 'secondary';
      const h = hash01(i * 13 + 1);
      if (big || h < 0.6) {
        shelters.push({ x: px, y, z: pz, yaw: yawTo(fx, fz) });
        colliders.push(obbCollider({ cx: px, cz: pz, hx: 2.1, hz: 0.8, cs: Math.cos(-yawTo(fx, fz)), sn: Math.sin(-yawTo(fx, fz)) }, y + 2.6));
        footprints.push({ minX: px - 2.2, maxX: px + 2.2, minZ: pz - 2.2, maxZ: pz + 2.2, kind: 'shelter' });
      }
      if (!isBrussels && h > 0.82) {
        const qx = px + ux * 4.2, qz = pz + uz * 4.2;
        const qy = rd.sidewalks.pavementAt(qx, qz);
        if (qy !== null && !onRoad(qx, qz, 0.7)) {
          k6.push({ x: qx, y: qy, z: qz, yaw: yawTo(fx, fz) });
          colliders.push({ minX: qx - 0.55, maxX: qx + 0.55, minZ: qz - 0.55, maxZ: qz + 0.55, maxY: qy + 2.8 });
          fp(qx, qz, 0.6, 'phonebox');
        }
      }
    }
    // London K6 kiosks are deliberately absent in Brussels; do not replace them with a recoloured UK kiosk.
    if (!isBrussels) for (const stn of geo.stations) {
      if (!inRegion(stn.x, stn.z) || hash01(Math.round(stn.x * 3 + stn.z)) > 0.55) continue;
      const hit = ctx.carriageIndex.nearest(stn.x, stn.z, 60);
      if (!hit) continue;
      const lx = hit.dz, lz = -hit.dx;
      const sd = (stn.x - hit.x) * lx + (stn.z - hit.z) * lz >= 0 ? 1 : -1;
      for (const a of [0, 1.15]) {
        const x = hit.x + lx * sd * (hit.road.w / 2 + 2.2) + hit.dx * a, z = hit.z + lz * sd * (hit.road.w / 2 + 2.2) + hit.dz * a;
        const y = rd.sidewalks.pavementAt(x, z);
        if (y === null || onRoad(x, z, 0.7)) break;
        k6.push({ x, y, z, yaw: yawTo(-lx * sd, -lz * sd) });
        colliders.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55, maxY: y + 2.8 });
        fp(x, z, 0.6, 'phonebox');
      }
    }
    // pillar boxes near some junctions (on a kerb a few metres from the corner)
    for (const nd of rd.nodes.values()) {
      if (nd.n < 3 || !inRegion(nd.x, nd.z) || hash01(Math.round(nd.x * 10) * 7 + Math.round(nd.z * 10)) > 0.1) continue;
      const r = nd.roads[0];
      const hit = ctx.carriageIndex.nearest(nd.x, nd.z, 2);
      if (!hit) continue;
      const lx = hit.dz, lz = -hit.dx;
      const x = nd.x + hit.dx * (nd.hw + 5) + lx * (r.w / 2 + 0.6), z = nd.z + hit.dz * (nd.hw + 5) + lz * (r.w / 2 + 0.6);
      const y = rd.sidewalks.pavementAt(x, z);
      if (y === null || onRoad(x, z, 0.5)) continue;
      pillars.push({ x, y, z, yaw: yawTo(-lx, -lz) });
      colliders.push({ minX: x - 0.33, maxX: x + 0.33, minZ: z - 0.33, maxZ: z + 0.33, maxY: y + 1.5 });
      fp(x, z, 0.35, 'pillarbox');
    }
    add(instanced(shelterGeometry(), vc, shelters, 'BusShelters'));
    { const g = instanced(shelterGlassGeometry(), shelterGlassMaterial(), shelters, 'BusShelterGlass', { cast: false }); if (g) g.renderOrder = 2; add(g); }
    if (!isBrussels) add(instanced(k6Geometry(), vc, k6, 'PhoneBoxes'));
    if (isBrussels) add(instanced(bpostMailboxGeometry(), vc, pillars, 'BpostMailboxes'));
    else add(instanced(pillarGeometry(), vc, pillars, 'PillarBoxes'));
    stats.shelters = shelters.length; stats.phoneBoxes = isBrussels ? 0 : k6.length; stats.pillarBoxes = isBrussels ? 0 : pillars.length; stats.bpostMailboxes = isBrussels ? pillars.length : 0;

    // ---- bollards at pedestrian street ends, benches along park paths ---------------------------------------------
    const bollards = [], benches = [];
    for (const r of geo.roads) {
      if (r.tunnel) continue;
      const p = r.pts, n = p.length;
      if (r.kind === 'pedestrian') {
        for (const k of [0, n - 2]) {
          const x = p[k], z = p[k + 1];
          if (!inRegion(x, z)) continue;
          const hit = ctx.carriageIndex.nearest(x, z, 14);
          if (!hit || hit.road === r) continue;
          const kb = k === 0 ? 2 : n - 4;
          let ux = p[kb] - x, uz = p[kb + 1] - z; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
          const lx = uz, lz = -ux, hw = Math.max(2.5, r.w / 2);
          const back = hit.dist + 0.5 + (hit.road.w / 2 > hit.dist ? hit.road.w / 2 - hit.dist + 3.5 : 3.5);
          for (let q = -hw + 0.6; q <= hw - 0.6; q += 1.6) {
            const bx = x + ux * Math.min(back, ul) + lx * q, bz = z + uz * Math.min(back, ul) + lz * q;
            bollards.push({ x: bx, y: 0, z: bz, yaw: 0 });
            fp(bx, bz, 0.15, 'bollard');
          }
        }
      } else if ((r.kind === 'footway' || r.kind === 'path') && r.sub !== 'sidewalk' && ctx.inPark) {
        if (!inRegion(p[0], p[1], 50)) continue;
        let acc = 25 + hash01(r.id) * 40;
        for (let k = 0; k + 3 < n; k += 2) {
          const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az, L = Math.hypot(dx, dz);
          if (L < 0.1) continue;
          let s = acc;
          while (s < L) {
            const ux = dx / L, uz = dz / L, sd = hash01(r.id + k) < 0.5 ? 1 : -1, lx = uz * sd, lz = -ux * sd;
            const off = Math.max(1, r.w / 2) + 0.6;
            const x = ax + ux * s + lx * off, z = az + uz * s + lz * off;
            if (ctx.inPark(x, z) && !world.isWater(x, z)) { benches.push({ x, y: 0, z, yaw: yawTo(-lx, -lz) }); fp(x, z, 0.9, 'bench'); }
            s += 75;
          }
          acc = s - L;
        }
      }
    }
    add(instanced(bollardGeometry(), vc, bollards, 'Bollards'));
    add(instanced(benchGeometry(), vc, benches, 'Benches'));
    stats.bollards = bollards.length; stats.benches = benches.length;

    // signal phase API (traffic.js may drive the lenses; default: the shader's own cycle)
    var setSignalPhase = (fn) => {
      if (!lensMeshes.length) return;
      SIG.uMode.value = fn ? 1 : 0;
      SIG.fn = fn;
    };
    var updateSignals = (t) => {
      if (!SIG.fn || !stateAttrs.length) return;
      const st = stateAttrs[0].array;
      for (let i = 0; i < st.length; i++) st[i] = SIG.fn(i, t);
      for (const a of stateAttrs) { if (a !== stateAttrs[0]) a.array.set(st); a.needsUpdate = true; }
    };
    void sigMesh;
  }

  // ---- trees ---------------------------------------------------------------------------------------------------------
  let treeField = null, treeGroup = null;
  if (trees) {
    const sites = [];
    const T = geo.trees;
    for (let i = 0; i < T.length; i += 2) {
      const x = T[i], z = T[i + 1];
      if (!inRegion(x, z) || world.isWater(x, z)) continue;
      const h = hash01(i * 5 + 3);
      const onStreet = ctx.carriageIndex.nearest(x, z, 9) !== null;
      sites.push({ x, z, species: h < 0.72 ? 0 : h < 0.86 ? 2 : 1, scale: onStreet ? 0.78 + h * 0.35 : 0.85 + h * 0.5, tier: onStreet ? 1 : 0 });
    }
    // scatter in parks & woods, thinner where trees are already mapped
    const mapped = new Map();
    for (let i = 0; i < T.length; i += 2) { const k = Math.floor(T[i] / 50) + ',' + Math.floor(T[i + 1] / 50); mapped.set(k, (mapped.get(k) || 0) + 1); }
    const DENS = { park: 1 / 650, wood: 1 / 110, garden: 1 / 420, square: 1 / 300, cemetery: 1 / 260 };
    const pathIdx = ctx.pathIndex;
    let scattered = 0;
    for (let pi = 0; pi < geo.parks.length && scattered < 45000; pi++) {
      const pk = geo.parks[pi];
      const dens = DENS[pk.kind];
      if (!dens) continue;
      const [x0, z0, x1, z1] = ringBox(pk.pts);
      if (!inRegion((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2)) continue;
      let area = 0;
      for (let i = 0, p = pk.pts, n = p.length, j = n - 2; i < n; j = i, i += 2) area += p[j] * p[i + 1] - p[i] * p[j + 1];
      area = Math.abs(area / 2);
      const want = Math.min(6000, Math.round(area * dens));
      let tries = want * 3, made = 0, seed = pi * 7919;
      while (made < want && tries-- > 0) {
        const x = x0 + hash01(seed++) * (x1 - x0), z = z0 + hash01(seed++) * (z1 - z0);
        if (!inRegion(x, z)) continue;
        const k = Math.floor(x / 50) + ',' + Math.floor(z / 50);
        if ((mapped.get(k) || 0) > 4 && hash01(seed++) < 0.8) continue;
        if (!pointInRing(x, z, pk.pts) || pk.holes.some((h) => pointInRing(x, z, h)) || world.isWater(x, z)) continue;
        if (ctx.carriageIndex.nearest(x, z, 6)) continue;
        if (pathIdx && pathIdx.nearest(x, z, 3.2)) continue;
        // clumps: open lawns keep fewer, woods are dense
        if (pk.kind === 'park' && noiseClump(x, z) < 0.42) continue;
        const h = hash01(seed++);
        sites.push({ x, z, species: h < 0.6 ? 0 : h < 0.85 ? 2 : 1, scale: 0.8 + h * 0.6, tier: 0 });
        made++;
      }
      scattered += made;
    }
    // (the leaf atlas needs a canvas: in Node — the full-city build check — only the sites are counted)
    if (sites.length && typeof document !== 'undefined') {
      treeField = createTreeField(scene, sites);
      treeGroup = treeField.group;
      treeGroup.name = 'LondonTrees';
      parent.add(treeGroup);
    }
    stats.trees = sites.length;
    stats.treesScattered = scattered;
  }

  return {
    group, treeGroup, footprints, colliders, signalHeads, stats,
    setSignalPhase: typeof setSignalPhase === 'function' ? setSignalPhase : () => {},
    update(dt, camera) {
      if (typeof updateSignals === 'function') updateSignals(performance.now() / 1000);
      void dt; void camera;
    }
  };
}

// coarse clumping noise for park scatter (cheap value noise on a 60 m lattice)
function noiseClump(x, z) {
  const gx = x / 60, gz = z / 60, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  const h = (a, b) => hash01(a * 73856093 ^ b * 19349663);
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return (h(ix, iz) * (1 - sx) + h(ix + 1, iz) * sx) * (1 - sz) + (h(ix, iz + 1) * (1 - sx) + h(ix + 1, iz + 1) * sx) * sz;
}

export { buildStreetDetails, RoadIndex as StreetRoadIndex };
