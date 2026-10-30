import * as THREE from 'three/webgpu';
import { createVehicleMaterial, createVehicleUniforms, VEHICLE_UNIFORMS } from './brussels-base-vehicles.js';

// Original, lightweight STIB/MIVB-inspired 12 m low-floor single-decker.
// Geometry is deliberately procedural; no editorial photo or third-party model is bundled.
const matSurf = (color, rough = 0.5, metal = 0, emit = 0) => ({ color, rough, metal, emit });

function box(geos, w, h, d, x, y, z, surf) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  geos.push({ geometry: g, surf });
}
function cylinder(geos, radius, length, x, y, z, surf) {
  const g = new THREE.CylinderGeometry(radius, radius, length, 16, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  geos.push({ geometry: g, surf });
}
function merged(geos) {
  const parts = geos.map(({ geometry, surf }) => {
    const g = geometry.toNonIndexed();
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const aSurf = new Float32Array(n * 4);
    const c = new THREE.Color(surf.color);
    for (let i = 0; i < n; i++) {
      colors.set([c.r, c.g, c.b], i * 3);
      aSurf.set([surf.rough, surf.metal, surf.emit, 0], i * 4);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(aSurf, 4));
    return g;
  });
  const out = THREE.BufferGeometryUtils?.mergeGeometries?.(parts) || parts[0];
  if (!out.boundingSphere) out.computeBoundingSphere();
  return out;
}

export function brusselsBus({ route = '71', destination = 'De Brouckère', uniforms = createVehicleUniforms() } = {}) {
  const group = new THREE.Group();
  group.name = `STIBBus_${route}`;
  const pieces = [];
  const silver = matSurf(0xc5c9cc, 0.34, 0.42);
  const orange = matSurf(0xf47721, 0.36, 0.12);
  const dark = matSurf(0x111a20, 0.16, 0.35);
  const glass = matSurf(0x172832, 0.08, 0.38, 3);
  const rubber = matSurf(0x101112, 0.88);
  const trim = matSurf(0x343a3e, 0.42, 0.55);
  const lamp = matSurf(0xf2eee0, 0.16, 0.1, 1);
  const tail = matSurf(0xd51d2a, 0.2, 0.1, 2);

  // Main low-floor body: front is +Z, 12.0 × 2.55 × 3.25 metres.
  box(pieces, 2.48, 2.45, 11.35, 0, 1.78, -0.02, silver);
  box(pieces, 2.50, 0.43, 11.55, 0, 0.68, -0.02, orange);
  box(pieces, 2.42, 0.16, 11.4, 0, 0.39, -0.02, dark);
  box(pieces, 2.42, 0.12, 11.4, 0, 3.02, -0.02, trim);
  // Broad, continuous dark side glazing with narrow structural pillars.
  for (const side of [-1, 1]) {
    box(pieces, 0.035, 1.15, 8.7, side * 1.253, 2.23, -0.15, glass);
    for (const z of [-4.25, -2.55, -0.75, 1.05, 2.85, 4.2]) {
      box(pieces, 0.055, 1.22, 0.075, side * 1.27, 2.23, z, dark);
    }
    // Two-piece front entrance and centre exit, with glazed door leaves.
    for (const [z, width] of [[3.75, 1.05], [-0.65, 1.05]]) {
      box(pieces, 0.045, 2.08, width, side * 1.265, 1.55, z, dark);
      box(pieces, 0.025, 1.55, width * 0.82, side * 1.294, 1.82, z, glass);
      box(pieces, 0.04, 0.06, width * 0.82, side * 1.3, 0.92, z, trim);
    }
    // Orange lower skirt continues around the sides.
    box(pieces, 0.045, 0.4, 11.15, side * 1.27, 0.7, -0.02, orange);
    // Mirrors and mirror arms.
    box(pieces, 0.08, 0.08, 0.55, side * 1.53, 2.5, 5.0, dark);
    box(pieces, 0.12, 0.34, 0.12, side * 1.5, 2.35, 4.85, trim);
  }
  // Front: large dark windscreen, destination display, bumper and paired lamps.
  box(pieces, 2.18, 1.45, 0.055, 0, 2.12, 5.68, glass);
  box(pieces, 1.35, 0.28, 0.07, 0, 2.94, 5.69, dark);
  box(pieces, 2.34, 0.24, 0.16, 0, 0.57, 5.68, dark);
  for (const side of [-1, 1]) {
    box(pieces, 0.34, 0.2, 0.07, side * 0.88, 0.88, 5.69, lamp);
    box(pieces, 0.16, 0.18, 0.07, side * 1.12, 0.86, 5.69, tail);
  }
  // Rear window, lamp clusters and bumpers.
  box(pieces, 2.05, 1.05, 0.055, 0, 2.15, -5.72, glass);
  box(pieces, 2.34, 0.22, 0.16, 0, 0.57, -5.72, dark);
  for (const side of [-1, 1]) {
    box(pieces, 0.22, 0.56, 0.06, side * 1.05, 0.98, -5.73, tail);
    box(pieces, 0.12, 0.18, 0.06, side * 1.05, 0.62, -5.73, lamp);
  }
  // Wheels: 6-wheel layout, black tyres and silver hubs; fixed geometry is also used by traffic instances.
  for (const z of [3.55, -2.95]) for (const side of [-1, 1]) {
    cylinder(pieces, 0.43, 0.28, side * 1.05, 0.44, z, rubber);
    cylinder(pieces, 0.22, 0.295, side * 1.05, 0.44, z, matSurf(0x9da4a8, 0.28, 0.78));
  }
  // STIB orange fleet livery and a restrained operator mark, rendered as original geometry.
  box(pieces, 0.035, 0.22, 1.0, 1.292, 1.12, -2.05, orange);
  box(pieces, 0.035, 0.22, 1.0, -1.292, 1.12, -2.05, orange);

  const bodyGeos = pieces.map(({ geometry, surf }) => {
    const g = geometry.toNonIndexed();
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const aSurf = new Float32Array(n * 4);
    const c = new THREE.Color(surf.color);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      aSurf[i * 4] = surf.rough; aSurf[i * 4 + 1] = surf.metal; aSurf[i * 4 + 2] = surf.emit; aSurf[i * 4 + 3] = 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(aSurf, 4));
    return g;
  });
  const bodyGeo = THREE.BufferGeometryUtils?.mergeGeometries?.(bodyGeos);
  // BufferGeometryUtils is not exposed on THREE in every build; concatenate compatible box buffers as a fallback.
  let geometry = bodyGeo;
  if (!geometry) {
    const positions = [], normals = [], colors = [], surfaces = [];
    for (const g of bodyGeos) {
      positions.push(g.attributes.position.array); normals.push(g.attributes.normal.array);
      colors.push(g.attributes.color.array); surfaces.push(g.attributes.aSurf.array);
    }
    const join = (arrays, size) => { const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0)); let at = 0; for (const a of arrays) { out.set(a, at); at += a.length; } return out; };
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(join(positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(join(normals), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(join(colors), 3));
    geometry.setAttribute('aSurf', new THREE.BufferAttribute(join(surfaces), 4));
    geometry.computeBoundingSphere();
  }
  const body = new THREE.Mesh(geometry, createVehicleMaterial({ uniforms }));
  body.name = 'body';
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  const spec = {
    kind: 'brusselsBus', route, destination, length: 12.0, width: 2.55, height: 3.25,
    wheelbase: 6.5, wheelRadius: 0.43, halfExtents: { hx: 1.28, hz: 6.0 },
    headlight: [0.88, 0.88], zFront: 5.72, tail: [1.05, 0.98], zRear: -5.72,
    doors: { front: { z0: 3.2, z1: 4.25, side: 1 }, middle: { z0: -1.15, z1: -0.1, side: 1 } },
    driverSeat: { x: -0.68, y: 1.35, z: 4.7 }, povOffset: { x: -0.68, y: 2.0, z: 4.7 }
  };
  group.userData.spec = spec;
  group.userData.kind = spec.kind;
  group.userData.uniforms = uniforms;
  group.userData.animated = [];
  group.userData.wheels = [];
  group.userData.wheelGeo = null;
  return group;
}
