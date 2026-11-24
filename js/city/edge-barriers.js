// js/city/edge-barriers.js — "ROAD CLOSED" barriers where drivable roads leave the play area.
// The roads (and the low filler city) carry on past the edge, so without these the edge looked like an invisible
// wall in the middle of an open road. One barrier across each road at the edge, plus cones and amber lamps.
// buildEdgeBarriers(scene, { geo, world, bounds, inset }) → { group, count, update(t, night) }
import * as THREE from 'three/webgpu';

const DRIVE = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary',
  'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service']);

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#d4202b';
  for (let x = -32; x < 256 + 32; x += 32) {
    g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#d4202b'; g.lineWidth = 12; g.strokeRect(6, 6, 244, 116);
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 42px Inter, Arial, sans-serif'; g.fillText('ROAD', 128, 46);
  g.fillText('CLOSED', 128, 88);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** where segment a→b crosses the rectangle edge (with its outward normal), or null */
function crossEdge(ax, az, bx, bz, r) {
  const inA = ax > r.minX && ax < r.maxX && az > r.minZ && az < r.maxZ;
  const inB = bx > r.minX && bx < r.maxX && bz > r.minZ && bz < r.maxZ;
  if (inA === inB) return null;
  const [ix, iz, ox, oz] = inA ? [ax, az, bx, bz] : [bx, bz, ax, az];
  let best = null;
  const tryT = (t, nx, nz) => {
    if (t < 0 || t > 1) return;
    const x = ix + (ox - ix) * t, z = iz + (oz - iz) * t;
    if (x < r.minX - 1e-3 || x > r.maxX + 1e-3 || z < r.minZ - 1e-3 || z > r.maxZ + 1e-3) return;
    if (!best || t < best.t) best = { t, x, z, nx, nz };
  };
  const dx = ox - ix, dz = oz - iz;
  if (dx < 0) tryT((r.minX - ix) / dx, -1, 0);
  if (dx > 0) tryT((r.maxX - ix) / dx, 1, 0);
  if (dz < 0) tryT((r.minZ - iz) / dz, 0, -1);
  if (dz > 0) tryT((r.maxZ - iz) / dz, 0, 1);
  if (!best) return null;
  const L = Math.hypot(dx, dz) || 1;
  return { ...best, ux: dx / L, uz: dz / L };
}

export function buildEdgeBarriers(scene, { geo, world, bounds, inset = 2 } = {}) {
  const group = new THREE.Group();
  group.name = 'BrusselsEdgeBarriers';
  scene.add(group);
  const r = { minX: bounds.minX + inset, maxX: bounds.maxX - inset, minZ: bounds.minZ + inset, maxZ: bounds.maxZ - inset };

  // one barrier per road crossing (dedupe crossings that are very close: dual carriageways get one wide barrier each)
  const spots = [];
  for (const road of geo.roads) {
    if (!DRIVE.has(road.kind) || road.tunnel) continue;
    const p = road.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const c = crossEdge(p[i], p[i + 1], p[i + 2], p[i + 3], r);
      if (!c) continue;
      const w = Math.max(4, road.w || 6) + 1.6;
      if (spots.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < (s.w + w) / 2)) continue;
      const y = world && world.groundHeight ? world.groundHeight(c.x, c.z, 'car') : 0;
      // barrier sits 1.5 m inside the edge, across the road (perpendicular to its direction)
      const x = c.x - c.nx * 1.5, z = c.z - c.nz * 1.5;
      spots.push({ x, z, y, w, yaw: Math.atan2(c.ux, c.uz), nx: c.nx, nz: c.nz });
    }
  }

  const n = spots.length;
  const boardMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.6, emissive: new THREE.Color(0x221111) });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7 });
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.5, emissive: new THREE.Color(0x202020) });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xf26a1b, roughness: 0.55 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: new THREE.Color(0xffa000), emissiveIntensity: 0.6, roughness: 0.3 });

  const board = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.45, 0.06), boardMat, n * 2);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.15, 0.08), legMat, n * 4);
  const sign = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 0.7), signMat, n);
  const signPost = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), legMat, n);
  const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.7, 10), coneMat, n * 4);
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), lampMat, n * 2);
  for (const m of [board, legs, sign, signPost, cones, lamps]) { m.castShadow = true; m.frustumCulled = false; group.add(m); }
  lamps.castShadow = false;

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const local = (s, lx, ly, lz) => {
    // local x across the road, z along it (towards the edge = +z)
    const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    return P.set(s.x + lx * cs + lz * sn, s.y + ly, s.z - lx * sn + lz * cs);
  };
  let bi = 0, li = 0, ci = 0, la = 0;
  spots.forEach((s, i) => {
    Q.setFromAxisAngle(up, s.yaw);
    // two boards (lower + upper rail) spanning the road
    for (const h of [0.55, 1.05]) {
      M.compose(local(s, 0, h, 0), Q, S.set(s.w, 1, 1)); board.setMatrixAt(bi++, M);
    }
    for (const fx of [-0.5, -0.17, 0.17, 0.5]) {
      M.compose(local(s, fx * (s.w - 0.3), 0.575, 0), Q, S.set(1, 1, 1)); legs.setMatrixAt(li++, M);
    }
    // the sign faces the oncoming driver (back towards the play area)
    const signQ = new THREE.Quaternion().setFromAxisAngle(up, s.yaw + Math.PI);
    M.compose(local(s, 0, 1.85, -0.05), signQ, S.set(1, 1, 1)); sign.setMatrixAt(i, M);
    M.compose(local(s, 0, 1.1, 0.02), Q, S.set(1, 1, 1)); signPost.setMatrixAt(i, M);
    for (const fx of [-0.42, -0.14, 0.14, 0.42]) {
      M.compose(local(s, fx * s.w, 0.35, -1.6), Q, S.set(1, 1, 1)); cones.setMatrixAt(ci++, M);
    }
    for (const fx of [-0.5, 0.5]) {
      M.compose(local(s, fx * (s.w - 0.3), 1.32, 0), Q, S.set(1, 1, 1)); lamps.setMatrixAt(la++, M);
    }
  });
  for (const m of [board, legs, sign, signPost, cones, lamps]) m.instanceMatrix.needsUpdate = true;

  return {
    group, count: n, spots,
    update(t = 0, night = 0) {
      // amber lamps blink, brighter at night
      const on = Math.floor(t * 1.6) % 2 === 0;
      lampMat.emissiveIntensity = on ? 0.6 + night * 2.4 : 0.05;
    }
  };
}
