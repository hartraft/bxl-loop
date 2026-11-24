// js/life/geo-kit.js — Workstream L: a tiny low-poly modelling kit for the life props (boats, aircraft, pigeons).
// Builds one merged BufferGeometry with `position`, `normal`, `color` and `aSurf` (rough, metal, emissive class,
// paint mask) — the attribute layout of brussels-vehicles.js, so `createVehicleMaterial()` shades it (lit windows at
// night = class 3, nav / head lamps = 1, tail = 2, beacons = 5).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export class Kit {
  constructor() { this.geos = []; }
  /** add a geometry with a surface {color, rough, metal, emit, paint}; pos [x,y,z], rot [x,y,z], scale [x,y,z] */
  add(geo, surf = {}, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(...pos), _q, new THREE.Vector3(...scale));
    g.applyMatrix4(_m);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), su = new Float32Array(n * 4);
    _c.set(surf.color ?? 0xffffff); // sRGB hex → linear working space (ColorManagement)
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      su[i * 4] = surf.rough ?? 0.6; su[i * 4 + 1] = surf.metal ?? 0; su[i * 4 + 2] = surf.emit ?? 0; su[i * 4 + 3] = surf.paint ?? 0;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(su, 4));
    this.geos.push(g);
    return this;
  }
  box(w, h, d, pos, surf, rot) { return this.add(new THREE.BoxGeometry(w, h, d), surf, pos, rot); }
  cyl(r0, r1, h, pos, surf, rot, seg = 10) { return this.add(new THREE.CylinderGeometry(r0, r1, h, seg), surf, pos, rot); }
  sphere(r, pos, surf, seg = 8, scale = [1, 1, 1]) { return this.add(new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)), surf, pos, [0, 0, 0], scale); }
  /** a hull: lofted half-ellipse sections [[z, halfWidth, top, bottom]] (bow at +z), closed */
  hull(sections, surf, seg = 10) {
    const pos = [];
    const ring = (s) => {
      const [z, hw, top, bot] = s;
      const pts = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI; // 0 = port top, π = starboard top, through the keel
        const x = Math.cos(a) * hw, y = bot + (top - bot) * (1 - Math.sin(a));
        pts.push([x, Math.min(top, y), z]);
      }
      return pts;
    };
    const rings = sections.map(ring);
    for (let r = 0; r + 1 < rings.length; r++) {
      const A = rings[r], B = rings[r + 1];
      for (let i = 0; i < seg; i++) pos.push(...A[i], ...B[i], ...A[i + 1], ...A[i + 1], ...B[i], ...B[i + 1]);
    }
    // deck cap (top) of each segment
    for (let r = 0; r + 1 < rings.length; r++) {
      const A = rings[r], B = rings[r + 1];
      pos.push(...A[0], ...A[seg], ...B[0], ...B[0], ...A[seg], ...B[seg]);
    }
    // transom
    const T = rings[0];
    for (let i = 1; i < seg; i++) pos.push(...T[0], ...T[i + 1], ...T[i]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return this.add(g, surf);
  }
  build() {
    const g = mergeGeometries(this.geos, false);
    g.computeBoundingSphere();
    return g;
  }
}

/** park every instance of an InstancedMesh far below the city (a backend may still draw one "stale" instance of an
 *  empty mesh), and keep the meshes visible for the first `warm` frames so the warm-up frame compiles their shadow
 *  pipelines too (an object that's hidden then would compile — and hitch — the first time it appears) */
const _park = new THREE.Matrix4().makeTranslation(0, -20000, 0);
export function parkInstances(mesh) {
  for (let i = 0; i < mesh.instanceMatrix.count; i++) mesh.setMatrixAt(i, _park);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
export function makeShow(warm = 4) {
  let n = warm;
  const show = (obj, on) => { obj.visible = on || n > 0; };
  show.tick = () => { if (n > 0) n--; };
  return show;
}

export const SURF = {
  white: { color: 0xf1f2f0, rough: 0.4 },
  black: { color: 0x141516, rough: 0.6 },
  glass: { color: 0x1d2a33, rough: 0.08, metal: 0.5 },
  litGlass: { color: 0x26333e, rough: 0.08, metal: 0.45, emit: 3 },
  metal: { color: 0xb8bdc2, rough: 0.3, metal: 0.8 },
  red: { color: 0xc8102e, rough: 0.35 },
  navRed: { color: 0xff2020, emit: 1 },
  navGreen: { color: 0x20ff40, emit: 1 },
  lamp: { color: 0xffffff, emit: 1 },
  rubber: { color: 0x1a1a1a, rough: 0.9 }
};
