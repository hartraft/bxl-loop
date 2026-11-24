import * as THREE from 'three/webgpu';
import { pointAt, laneOffset } from './road-network.js';
import { createRoadPaintMaterial } from './tsl-materials.js';

// js/road-paint.js — the markings that come from the traffic network (white, continental style):
// - stop lines across signal-controlled junction approaches, where the traffic actually waits,
// - give-way lines (double broken white) at roundabout entries,
// - lane dividers (dashed white) between same-direction lanes of multi-lane roads,
// - lane arrows on multi-lane approaches to junctions, from each lane's real turn connectors.
// The city renderer (brussels-city.js) draws centre lines, lane arrows, zebras, signal-crossing stop lines and minor-road
// give-ways — not repeated here.
//
//   const paint = buildRoadPaint(scene, network);   // NY signature; tiles (250 m) are built around the camera
//   paint.update(x, z)                              // traffic.update() calls this for you (network._paint)

const WHITE = new THREE.Color(0xe9e6dc);
const TILE = 250;
const BUILD_R = 420;
const DROP_R = 800;
const LIFT = 0.025;

function buildRoadPaint(scene, network) {
  const group = new THREE.Group();
  group.name = 'RoadMarkingsG';
  scene.add(group);
  const material = createRoadPaintMaterial();
  material.side = THREE.DoubleSide; // flat decals: winding never matters
  const tiles = new Map();
  // nodes by tile
  const nodeTiles = new Map();
  for (const n of network.nodes) {
    if (n.degree < 2 && !n.controller) continue;
    const k = `${Math.floor(n.x / TILE)},${Math.floor(n.z / TILE)}`;
    (nodeTiles.get(k) || nodeTiles.set(k, []).get(k)).push(n);
  }
  const P = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };

  function buildTile(key) {
    const nodes = nodeTiles.get(key);
    if (!nodes) return null;
    const position = [], side = [], paint = [], colors = [], index = [];
    const strip = (ax, az, bx, bz, y, w, period = 1, duty = 1) => {
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) return;
      const sx = ((az - bz) / len) * w * 0.5, sz = ((bx - ax) / len) * w * 0.5;
      const i = position.length / 3;
      for (const [x, z, s, u] of [[ax, az, -1, 0], [ax, az, 1, 0], [bx, bz, 1, len], [bx, bz, -1, len]]) {
        position.push(x + sx * s, y, z + sz * s);
        side.push(sx * s, sz * s);
        paint.push(u, period, duty);
        colors.push(WHITE.r, WHITE.g, WHITE.b);
      }
      index.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    const tri = (pts, y) => {
      // wind it to face up (+y): counter-clockwise seen from above in (x, -z)
      const cr = (pts[2] - pts[0]) * (pts[5] - pts[1]) - (pts[3] - pts[1]) * (pts[4] - pts[0]);
      if (cr > 0) pts = [pts[0], pts[1], pts[4], pts[5], pts[2], pts[3]];
      const i = position.length / 3;
      for (let k = 0; k < 3; k++) {
        position.push(pts[2 * k], y, pts[2 * k + 1]);
        side.push(0, 0);
        paint.push(0, 1, 1);
        colors.push(WHITE.r, WHITE.g, WHITE.b);
      }
      index.push(i, i + 1, i + 2);
    };
    // an arrow in a lane frame: origin (ox, oz), forward (fx, fz), left (lx, lz); kinds: subset of 'L','S','R'
    const arrow = (ox, oz, fx, fz, y, kinds) => {
      const lx = fz, lz = -fx;
      const at = (u, v) => [ox + fx * u + lx * v, oz + fz * u + lz * v];
      const [s0x, s0z] = at(0, 0), [s1x, s1z] = at(2.6, 0);
      strip(s0x, s0z, s1x, s1z, y, 0.16);
      if (kinds.has('S')) {
        const [ax, az] = at(2.4, 0);
        strip(ax, az, ...at(3.6, 0), y, 0.16);
        tri([...at(3.6, -0.35), ...at(4.6, 0), ...at(3.6, 0.35)], y);
      }
      for (const [k, sg] of [['L', 1], ['R', -1]]) {
        if (!kinds.has(k)) continue;
        const [bx, bz] = at(2.6, 0), [cx, cz] = at(3.3, sg * 0.75);
        strip(bx, bz, cx, cz, y, 0.16);
        tri([...at(2.95, sg * 1.0), ...at(3.75, sg * 1.3), ...at(3.6, sg * 0.45)], y);
      }
    };
    for (const n of nodes) {
      network.ensureNode(n);
      for (const il of n.inLinks) {
        const lanes = il.lanes;
        if (!lanes || !lanes.length) continue;
        const l0 = lanes[0];
        // the line across the approach at the hold position of the kerb lane
        const hold = 0.9 + (l0.holdBack || 0);
        pointAt(l0, Math.max(0, l0.len - hold + 0.2), P);
        const fx = P.dx, fz = P.dz, lx = fz, lz = -fx;
        const y = P.y + LIFT;
        const o0 = laneOffset(il, 0), on = laneOffset(il, il.nLanes - 1);
        const left = il.laneW / 2, right = -(o0 - on) - il.laneW / 2; // lateral range from lane 0's centre
        const ax = P.x + lx * left, az = P.z + lz * left, bx = P.x + lx * right, bz = P.z + lz * right;
        // (F draws the stop lines of signal-controlled pedestrian crossings and give-ways on minor roads)
        if (il.control && !n.sigCross) strip(ax, az, bx, bz, y, 0.3);
        else if (n.degree >= 3 && n.roundabout && !il.roundabout) {
          // give way: double broken line (0.6 m dashes)
          strip(ax, az, bx, bz, y, 0.15, 0.9, 0.6);
          strip(ax - fx * 0.45, az - fz * 0.45, bx - fx * 0.45, bz - fz * 0.45, y, 0.15, 0.9, 0.6);
        }
        // lane dividers (dashed white) between lanes of the same direction — drawn once, from the link's to-node
        if (il.nLanes >= 2) {
          for (let k = 0; k + 1 < lanes.length; k++) {
            const A = lanes[k], B = lanes[k + 1];
            const n2 = Math.min(A.pts.length, B.pts.length) / 2;
            if (A.pts.length !== B.pts.length) continue;
            for (let i = 0; i + 1 < n2; i++) {
              const mx0 = (A.pts[2 * i] + B.pts[2 * i]) / 2, mz0 = (A.pts[2 * i + 1] + B.pts[2 * i + 1]) / 2;
              const mx1 = (A.pts[2 * i + 2] + B.pts[2 * i + 2]) / 2, mz1 = (A.pts[2 * i + 3] + B.pts[2 * i + 3]) / 2;
              const yy = (A.ys ? (A.ys[i] + A.ys[i + 1]) / 2 : 0) + LIFT;
              strip(mx0, mz0, mx1, mz1, yy, 0.12, 9, 0.33);
            }
          }
        }
        // lane arrows on multi-lane approaches to real junctions
        if (il.nLanes >= 2 && n.degree >= 3) {
          for (const lane of lanes) {
            if (lane.len < 14) continue;
            const kinds = new Set(lane.outs.map((c) => (c.turn === 'U' ? 'R' : c.turn)));
            if (!kinds.size) continue;
            pointAt(lane, lane.len - hold - 9, P);
            arrow(P.x, P.z, P.dx, P.dz, P.y + LIFT, kinds);
          }
        }
      }
    }
    if (!index.length) return null;
    const normal = new Float32Array(position.length);
    for (let i = 1; i < normal.length; i += 3) normal[i] = 1;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('side', new THREE.Float32BufferAttribute(side, 2));
    geometry.setAttribute('paint', new THREE.Float32BufferAttribute(paint, 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `RoadMarkingsG_${key}`;
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;
    return mesh;
  }

  let lastX = Infinity, lastZ = Infinity, budget = 0;
  function update(x, z) {
    budget = 2; // tiles built per call (spreads the work over frames)
    if (Math.hypot(x - lastX, z - lastZ) < 30 && !pending.length) return;
    lastX = x; lastZ = z;
    for (const [k, t] of tiles) {
      const [tx, tz] = k.split(',').map(Number);
      if (Math.hypot((tx + 0.5) * TILE - x, (tz + 0.5) * TILE - z) > DROP_R) {
        if (t) { group.remove(t); t.geometry.dispose(); }
        tiles.delete(k);
      }
    }
    pending.length = 0;
    for (let tz = Math.floor((z - BUILD_R) / TILE); tz <= Math.floor((z + BUILD_R) / TILE); tz++) {
      for (let tx = Math.floor((x - BUILD_R) / TILE); tx <= Math.floor((x + BUILD_R) / TILE); tx++) {
        const k = `${tx},${tz}`;
        if (!tiles.has(k)) pending.push([k, Math.hypot((tx + 0.5) * TILE - x, (tz + 0.5) * TILE - z)]);
      }
    }
    pending.sort((a, b) => a[1] - b[1]);
    while (pending.length && budget-- > 0) {
      const [k] = pending.shift();
      const m = buildTile(k);
      tiles.set(k, m);
      if (m) group.add(m);
    }
  }
  const pending = [];
  const api = { group, update, tiles };
  network._paint = api;
  return api;
}

export { buildRoadPaint };
