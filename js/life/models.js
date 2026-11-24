// js/life/models.js — Workstream L: low-poly models for the living city (no brand marks): a fast catamaran river
// bus, a tug pushing a lighter barge, a RIB with passengers, a twin-jet airliner, a pigeon (body + one wing).
// All return merged geometries in the brussels-vehicles.js attribute layout (see geo-kit.js); +z = forward, y = 0 at
// the waterline / ground.
import * as THREE from 'three/webgpu';
import { Kit, SURF } from './geo-kit.js';

/** fast catamaran canal passenger boat, ~38 × 8.6 m */
export function catamaranGeometry({ hull = 0x2b3442, band = 0x9ab7c9 } = {}) {
  const k = new Kit();
  const H = { color: hull, rough: 0.3, metal: 0.2, paint: 1 };
  for (const s of [-1, 1]) {
    k.add(hullGeo([[-19, 1.25, 1.7, -0.9], [-12, 1.35, 1.7, -1.0], [6, 1.3, 1.7, -1.0], [13, 1.0, 1.75, -0.8], [17, 0.6, 1.8, -0.3], [19.2, 0.12, 1.85, 0.6]]), H, [s * 3.2, 0, 0]);
    k.box(0.1, 0.25, 30, [s * 4.35, 1.2, -2], { color: band, rough: 0.4 });
  }
  k.box(8.6, 0.55, 33, [0, 1.75, -1.5], H); // bridging deck
  // passenger cabin: long glazing, white roof, raked front
  k.box(8.0, 0.5, 24, [0, 2.3, -3], SURF.white);
  k.box(7.9, 1.5, 24, [0, 3.3, -3], SURF.litGlass);
  k.box(8.2, 0.35, 25, [0, 4.2, -3.2], { color: 0xdfe2e4, rough: 0.4 });
  k.add(new THREE.CylinderGeometry(4.0, 4.0, 2.0, 8, 1, false, -Math.PI / 2, Math.PI), SURF.litGlass, [0, 3.05, 9], [0, 0, 0], [0.99, 1, 0.55]);
  k.add(new THREE.CylinderGeometry(4.1, 4.1, 0.35, 8, 1, false, -Math.PI / 2, Math.PI), { color: 0xdfe2e4, rough: 0.4 }, [0, 4.2, 8.8], [0, 0, 0], [1, 1, 0.6]);
  // wheelhouse + mast
  k.box(3.4, 1.2, 3.2, [0, 4.95, 5.5], H);
  k.box(3.3, 0.6, 3.1, [0, 5.25, 5.6], SURF.glass);
  k.cyl(0.06, 0.06, 2.2, [0, 6.5, 5.0], SURF.metal);
  k.sphere(0.12, [0, 7.6, 5.0], SURF.lamp, 6);
  k.sphere(0.1, [1.75, 5.2, 7.0], SURF.navGreen, 6);
  k.sphere(0.1, [-1.75, 5.2, 7.0], SURF.navRed, 6);
  // open aft deck rails
  for (const s of [-1, 1]) k.box(0.05, 0.05, 6, [s * 4.1, 2.9, -17], SURF.metal);
  k.box(8.2, 0.05, 0.05, [0, 2.9, -19.9], SURF.metal);
  return k.build();
}

/** tug pushing a lighter barge (one model, ~46 m) */
export function tugBargeGeometry({ barge = 0x5a3b28, tug = 0x1b1d20 } = {}) {
  const k = new Kit();
  // the lighter (open hold), bow at +z
  k.box(9.2, 2.4, 30, [0, 0.0, 6], { color: barge, rough: 0.8, metal: 0.2 });
  k.box(9.4, 0.25, 30.2, [0, 1.25, 6], { color: 0x2e2420, rough: 0.8 });
  k.box(8.2, 0.5, 28, [0, 1.15, 6], { color: 0x3d3a34, rough: 0.95 }); // cargo (aggregate / containers)
  k.box(2.4, 1.4, 6, [-2.4, 1.9, 2], { color: 0x30579a, rough: 0.6 });
  k.box(2.4, 1.4, 6, [2.4, 1.9, 9], { color: 0xb33a2a, rough: 0.6 });
  // the tug astern pushing
  k.add(hullGeo([[-18, 2.2, 1.4, -1.6], [-14, 2.8, 1.5, -1.9], [-11, 2.6, 1.5, -1.8], [-9.2, 1.9, 1.5, -1.2]]), { color: tug, rough: 0.5 });
  k.box(5.6, 0.3, 8.5, [0, 1.5, -13.5], { color: 0x7a1b1b, rough: 0.6 });
  k.box(3.8, 2.2, 3.8, [0, 2.7, -13.8], { color: 0xf0efe8, rough: 0.5 });
  k.box(3.9, 0.9, 3.9, [0, 3.6, -13.8], SURF.litGlass);
  k.box(4.1, 0.25, 4.1, [0, 4.15, -13.8], { color: 0xf0efe8, rough: 0.5 });
  k.cyl(0.45, 0.5, 2.2, [0, 4.6, -16.0], { color: 0x111111, rough: 0.6 }); // funnel
  k.cyl(0.47, 0.47, 0.5, [0, 5.2, -16.0], { color: 0xc8102e, rough: 0.5 });
  k.sphere(0.1, [0, 5.0, -13.8], SURF.lamp, 6);
  for (const s of [-1, 1]) k.cyl(0.45, 0.45, 0.5, [s * 2.7, 0.9, -11.8], SURF.rubber, [0, 0, Math.PI / 2], 8); // tyre fenders
  return k.build();
}

/** rigid inflatable boat (thrill rides), ~9.5 m, with a few passengers */
export function ribGeometry({ tube = 0xff6a10 } = {}) {
  const k = new Kit();
  for (const s of [-1, 1]) k.add(new THREE.CapsuleGeometry(0.42, 8.2, 3, 8), { color: tube, rough: 0.6 }, [s * 1.2, 0.55, 0], [Math.PI / 2, 0, 0]);
  k.add(hullGeo([[-4.6, 1.15, 0.45, -0.3], [2.5, 1.1, 0.45, -0.45], [4.4, 0.4, 0.5, 0.1]]), { color: 0x2e3238, rough: 0.5 });
  k.box(1.1, 0.9, 1.0, [0, 0.9, 1.0], { color: 0x222428, rough: 0.5 });
  k.box(1.0, 0.45, 0.06, [0, 1.55, 1.45], SURF.glass, [-0.5, 0, 0]);
  // passengers in red jackets: torso + head blobs in rows
  for (let r = 0; r < 4; r++) for (const s of [-0.5, 0.5]) {
    const z = -0.6 - r * 0.85;
    k.box(0.45, 0.55, 0.35, [s, 1.05, z], { color: r % 2 ? 0xc8102e : 0xe85c20, rough: 0.7 });
    k.sphere(0.13, [s, 1.48, z], { color: 0xd9b59a, rough: 0.7 }, 6);
  }
  k.box(0.6, 0.6, 0.5, [0, 0.85, -4.3], { color: 0x101010, rough: 0.4 }); // outboards
  return k.build();
}

/** twin-jet airliner, ~38 m long, 34 m span (invented livery: white, grey belly, blue tail) */
export function airlinerGeometry({ tail = 0x2a4f8f } = {}) {
  const k = new Kit();
  const W = { color: 0xf3f4f5, rough: 0.35, metal: 0.2 };
  k.add(new THREE.CylinderGeometry(2.0, 2.0, 30, 12, 1), W, [0, 0, 0], [Math.PI / 2, 0, 0]);
  k.add(new THREE.SphereGeometry(2.0, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), W, [0, 0, 15], [Math.PI / 2, 0, 0], [1, 2.2, 0.95]);
  k.add(new THREE.ConeGeometry(2.0, 7, 12), W, [0, 0.4, -18.5], [-Math.PI / 2, 0, 0], [1, 1, 0.8]);
  k.box(3.2, 0.5, 26, [0, -1.6, -1], { color: 0xb7bcc2, rough: 0.5, metal: 0.3 }); // belly
  // wings (swept), engines
  for (const s of [-1, 1]) {
    const wing = new THREE.BoxGeometry(16, 0.35, 4.2);
    wing.translate(s * 8, 0, 0);
    const p = wing.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = Math.abs(p.getX(i)); p.setZ(i, p.getZ(i) * (1 - x / 26) - x * 0.42); }
    k.add(wing, { color: 0xd9dde1, rough: 0.4, metal: 0.3 }, [0, -1.0, 1.5]);
    k.cyl(0.95, 0.85, 4.2, [s * 5.6, -1.9, 2.5], { color: 0xe6e8ea, rough: 0.3, metal: 0.4 }, [Math.PI / 2, 0, 0], 10);
    k.sphere(0.18, [s * 16.6, -0.9, -5.5], s > 0 ? SURF.navGreen : SURF.navRed, 6);
    const st = new THREE.BoxGeometry(6, 0.25, 2.2);
    st.translate(s * 3, 0, 0);
    const q = st.attributes.position;
    for (let i = 0; i < q.count; i++) { const x = Math.abs(q.getX(i)); q.setZ(i, q.getZ(i) * (1 - x / 10) - x * 0.5); }
    k.add(st, { color: 0xd9dde1, rough: 0.4 }, [0, 0.6, -17.5]);
  }
  const fin = new THREE.BoxGeometry(0.35, 7, 4.5);
  const f = fin.attributes.position;
  for (let i = 0; i < f.count; i++) { const y = f.getY(i) + 3.5; f.setZ(i, f.getZ(i) * (1 - y / 11) - y * 0.55); }
  k.add(fin, { color: tail, rough: 0.35 }, [0, 4.6, -16.5]);
  k.sphere(0.2, [0, 0.3, -21.6], SURF.lamp, 6);
  // cabin windows (lit at night) as a thin dark strip
  for (const s of [-1, 1]) k.box(0.05, 0.35, 24, [s * 2.0, 0.55, 0], { color: 0x25303a, rough: 0.2, emit: 3 });
  return k.build();
}

/** pigeon body (0.32 m, standing, faces +z), its pivot at the feet */
export function pigeonBodyGeometry() {
  const k = new Kit();
  const grey = { color: 0x8d939c, rough: 0.8 };
  k.sphere(0.085, [0, 0.14, 0], grey, 8, [1, 0.9, 1.6]);
  k.sphere(0.05, [0, 0.24, 0.1], { color: 0x6e7f86, rough: 0.6, metal: 0.25 }, 7); // iridescent neck
  k.sphere(0.04, [0, 0.29, 0.13], { color: 0x7d848d, rough: 0.8 }, 7);
  k.add(new THREE.ConeGeometry(0.012, 0.035, 4), { color: 0x2a2a2a }, [0, 0.285, 0.175], [Math.PI / 2, 0, 0]);
  k.box(0.09, 0.02, 0.13, [0, 0.16, -0.17], { color: 0x4d525a, rough: 0.8 }, [0.35, 0, 0]); // tail
  for (const s of [-1, 1]) k.box(0.012, 0.07, 0.012, [s * 0.03, 0.035, 0.01], { color: 0xc0505a });
  return k.build();
}
/** one wing (left: +x), hinged at x = 0; mirror with scale.x = -1 */
export function pigeonWingGeometry() {
  const k = new Kit();
  const g = new THREE.BufferGeometry();
  const P = [0, 0, 0.06, 0.26, 0, 0.0, 0.0, 0, -0.08, 0.26, 0, 0.0, 0.3, 0, -0.08, 0.0, 0, -0.08];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  k.add(g, { color: 0x9aa1aa, rough: 0.85 });
  const g2 = g.clone(); // underside
  const p2 = g2.attributes.position;
  for (let i = 0; i < p2.count; i += 3) { const ax = p2.getX(i + 1), ay = p2.getY(i + 1), az = p2.getZ(i + 1); p2.setXYZ(i + 1, p2.getX(i + 2), p2.getY(i + 2), p2.getZ(i + 2)); p2.setXYZ(i + 2, ax, ay, az); }
  g2.computeVertexNormals();
  k.add(g2, { color: 0x7f8690, rough: 0.85 });
  return k.build();
}

/** a canoe-ish hull from sections [[z, halfWidth, top, bottom]] (aft → bow) */
function hullGeo(sections, seg = 8) {
  const pos = [];
  const ring = ([z, hw, top, bot]) => {
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI;
      pts.push([Math.cos(a) * hw, top - (top - bot) * Math.sin(a), z]);
    }
    return pts;
  };
  const R = sections.map(ring);
  for (let r = 0; r + 1 < R.length; r++) {
    const A = R[r], B = R[r + 1];
    for (let i = 0; i < seg; i++) pos.push(...A[i], ...B[i], ...A[i + 1], ...B[i], ...B[i + 1], ...A[i + 1]);
    pos.push(...A[0], ...A[seg], ...B[0], ...A[seg], ...B[seg], ...B[0]); // deck, facing up
  }
  const T = R[0], E = R[R.length - 1];
  for (let i = 1; i < seg; i++) { pos.push(...T[0], ...T[i], ...T[i + 1]); pos.push(...E[0], ...E[i + 1], ...E[i]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
