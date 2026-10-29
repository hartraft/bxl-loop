import * as THREE from 'three/webgpu';
import { attribute, uniform, float, vec3, clamp, abs, mix, texture } from 'three/tsl';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// js/brussels-base-vehicles.js — procedural Brussels vehicle models (Workstream C).
//
// Every factory returns a THREE.Group in real metres: front = +z, up = +y, ground at y = 0, origin midway between the
// axles (boat: origin at the waterline, midships). Right-hand drive: the driver sits on the right, i.e. at -x
// (facing +z, the right-hand side is -x).
//
// Draw calls: each model is ONE merged vertex-coloured "body" mesh + ONE "decals" mesh (shared canvas atlas) + its
// wheels (one mesh each, spun about x) + a few named animated parts (rotors, cranks, searchlight).
// Surface properties live in a per-vertex attribute aSurf = (roughness, metalness, emissiveClass, paintMask), so one
// material covers paint, glass, chrome, rubber and every lamp. Emissive classes:
//   1 headlamp  2 tail/brake lamp  3 lit window (warm glow at night)  4 taxi "for hire" sign
//   5 police beacon  6 amber marker  7 destination display (LED blind)
// Lamps follow VEHICLE_UNIFORMS.night (0 day … 1 night); brake/sign/beacon are per-uniform-set (see createVehicleUniforms).
//
// group.userData.spec = { kind, length, width, height, wheelbase, wheelRadius, halfExtents:{hx,hz},
//   headlight:[x,y], zFront, tail:[x,y], zRear,   <- compatible with vehicle-lights.js placeVehicleHeadlight(spot, spec, side)
//   driverSeat:{x,y,z}, povOffset:{x,y,z}, ... }
// group.userData.wheels = [{ group, spin, front, side, x, y, z, radius }]  (group = steer pivot, spin = mesh, rotate .x)
// group.userData.animated = [Object3D]  (rotors, cranks, searchlight — excluded from getInstanceParts)

// ---------------------------------------------------------------------------------------------------------------
// Uniforms & materials
// ---------------------------------------------------------------------------------------------------------------

/** Shared lamp uniforms (traffic uses these). night: 0..1; brake: 0..1; sign: taxi roof sign; beacon: police lights */
export const VEHICLE_UNIFORMS = { night: uniform(0), brake: uniform(0), sign: uniform(1), beacon: uniform(0) };

/** A private uniform set (own brake lights / sign / beacon) that still follows the shared night level */
export function createVehicleUniforms() {
  return { night: VEHICLE_UNIFORMS.night, brake: uniform(0), sign: uniform(1), beacon: uniform(0) };
}

/** Map the city's uInteriorGlow (lighting.js: ~0.24 day … 1.55 night) to the vehicle night level and apply it */
export function setVehicleNightFromGlow(glow) {
  const n = Math.max(0, Math.min(1, (glow - 0.6) / 0.65));
  VEHICLE_UNIFORMS.night.value = n;
  return n;
}

const WARM_WINDOW = vec3(1.0, 0.66, 0.34);

function emissiveFor(base, surf, U) {
  const cls = surf.z;
  const w = (k) => clamp(float(1).sub(abs(cls.sub(k)).mul(2)), 0, 1);
  const n = U.night;
  const k = w(1).mul(n.mul(3).add(0.35))
    .add(w(2).mul(n.mul(1.1).add(0.18).add(U.brake.mul(2.6))))
    .add(w(4).mul(U.sign.mul(n.mul(2).add(0.9))))
    .add(w(5).mul(U.beacon.mul(5)))
    .add(w(6).mul(n.mul(0.6).add(0.12)))
    .add(w(7).mul(n.mul(1.6).add(0.55)));
  return base.mul(k).add(WARM_WINDOW.mul(w(3).mul(n.mul(0.42))));
}

const _matCache = new WeakMap();

/**
 * The vehicle material. opts.uniforms: a uniform set (default VEHICLE_UNIFORMS); opts.instancePaint: paint-masked
 * vertices take their colour from an instanced vec3 attribute `aPaint` (for InstancedMesh colour variety);
 * opts.map: a decal atlas texture (alpha-tested).
 */
export function createVehicleMaterial({ uniforms = VEHICLE_UNIFORMS, instancePaint = false, map = null } = {}) {
  let cache = _matCache.get(uniforms);
  if (!cache) _matCache.set(uniforms, (cache = new Map()));
  const key = `${instancePaint ? 1 : 0}|${map ? map.uuid : ''}`;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardNodeMaterial();
  const surf = attribute('aSurf', 'vec4');
  let base;
  if (map) {
    const t = texture(map);
    base = t.rgb;
    m.opacityNode = t.a;
    m.alphaTest = 0.5;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  } else {
    base = attribute('color', 'vec3');
    if (instancePaint) base = mix(base, attribute('aPaint', 'vec3'), surf.w);
  }
  m.colorNode = base;
  m.roughnessNode = surf.x;
  m.metalnessNode = surf.y;
  m.emissiveNode = emissiveFor(base, surf, uniforms);
  m.name = map ? 'VehicleDecal' : 'VehicleBody';
  cache.set(key, m);
  return m;
}

// Surface presets: color, rough, metal, emit (class), paint (mask)
const S = {
  paint: (color) => ({ color, rough: 0.28, metal: 0.18, paint: 1 }),
  glass: { color: 0x1e2a35, rough: 0.05, metal: 0.6 },
  litGlass: { color: 0x26333e, rough: 0.06, metal: 0.55, emit: 3 },
  chrome: { color: 0xdfe3e8, rough: 0.16, metal: 0.85 },
  black: { color: 0x121314, rough: 0.55, metal: 0.05 },
  plastic: { color: 0x262829, rough: 0.7, metal: 0.0 },
  rubber: { color: 0x151515, rough: 0.9 },
  rim: { color: 0xb9bec5, rough: 0.28, metal: 0.8 },
  darkRim: { color: 0x3a3d42, rough: 0.35, metal: 0.6 },
  interior: { color: 0x2b2a29, rough: 0.85 },
  head: { color: 0xe9ecef, rough: 0.08, metal: 0.2, emit: 1 },
  tail: { color: 0xc4101c, rough: 0.2, emit: 2 },
  amber: { color: 0xff8a14, rough: 0.2, emit: 6 },
  white: { color: 0xf2f3f1, rough: 0.35 },
  plate: { color: 0xf4f4f0, rough: 0.4 }
};
const surfOf = (o) => (typeof o === 'number' ? S.paint(o) : o);

// ---------------------------------------------------------------------------------------------------------------
// Geometry builder: accumulates parts (non-indexed, position/normal/uv/color/aSurf) and merges them into one mesh
// ---------------------------------------------------------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

class Parts {
  constructor() {
    this.geos = [];
  }

  /** o: { surf, pos:[x,y,z], rot:[x,y,z], order, scale:n|[x,y,z], matrix } ; surf.color may be a fn(x,y,z) per face */
  add(geo, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (o.matrix) g.applyMatrix4(o.matrix);
    if (o.pos || o.rot || o.scale !== undefined) {
      _e.set(...(o.rot || [0, 0, 0]), o.order || 'XYZ');
      _q.setFromEuler(_e);
      const sc = o.scale === undefined ? 1 : o.scale;
      _s.set(...(Array.isArray(sc) ? sc : [sc, sc, sc]));
      _v.set(...(o.pos || [0, 0, 0]));
      g.applyMatrix4(_m4.compose(_v, _q, _s));
    }
    const s = surfOf(o.surf || S.plastic);
    const pos = g.attributes.position;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const surf = new Float32Array(n * 4);
    const fn = typeof s.color === 'function' ? s.color : null;
    if (!fn) _col.setHex(s.color ?? 0x808080);
    for (let i = 0; i < n; i += 3) {
      let ss = s;
      if (fn) {
        // o.quads: triangles come in pairs (quads) — colour both by the quad centre so edges stair-step cleanly
        const i0 = o.quads ? i - (i % 6) : i, k = o.quads && i0 + 6 <= n ? 6 : 3;
        let cx = 0, cy = 0, cz = 0;
        for (let j = i0; j < i0 + k; j++) { cx += pos.getX(j); cy += pos.getY(j); cz += pos.getZ(j); }
        cx /= k; cy /= k; cz /= k;
        const r = fn(cx, cy, cz);
        ss = typeof r === 'number' ? { ...s, color: r } : surfOf(r);
        _col.setHex(ss.color);
      }
      for (let k = i; k < i + 3 && k < n; k++) {
        col[k * 3] = _col.r;
        col[k * 3 + 1] = _col.g;
        col[k * 3 + 2] = _col.b;
        surf[k * 4] = ss.rough ?? 0.5;
        surf[k * 4 + 1] = ss.metal ?? 0;
        surf[k * 4 + 2] = ss.emit ?? 0;
        surf[k * 4 + 3] = ss.paint ?? 0;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4));
    this.geos.push(g);
    return g;
  }

  box(w, h, d, pos, surf, rot) {
    return this.add(new THREE.BoxGeometry(w, h, d), { pos, surf, rot });
  }

  /** Rounded box (extruded rounded rectangle in xy, depth along z) */
  rbox(w, h, d, r, pos, surf, rot) {
    return this.add(roundedBoxGeo(w, h, d, r), { pos, surf, rot });
  }

  /** Cylinder whose axis is x / y / z */
  cyl(r, len, axis, pos, surf, seg = 16, r2 = r) {
    const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
    const rot = axis === 'x' ? [0, 0, -Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.add(g, { pos, surf, rot });
  }

  /** Cylinder between two points */
  tube(a, b, r, surf, seg = 8) {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _v.length();
    _q.setFromUnitVectors(Y_AXIS, _v.normalize());
    _v2.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const m = new THREE.Matrix4().compose(_v2, _q, _s.set(1, 1, 1));
    return this.add(new THREE.CylinderGeometry(r, r, len, seg, 1), { matrix: m, surf });
  }

  /** Smooth tube along a Catmull-Rom path */
  curve(points, r, surf, seg = 24, radial = 8) {
    const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    return this.add(new THREE.TubeGeometry(c, seg, r, radial, false), { surf });
  }

  sphere(r, pos, surf, scale, ws = 12, hs = 8) {
    return this.add(new THREE.SphereGeometry(r, ws, hs), { pos, surf, scale });
  }

  mesh(material, name) {
    if (!this.geos.length) return null;
    const geo = mergeGeometries(this.geos, false);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function roundedBoxGeo(w, h, d, r) {
  const bev = Math.min(r * 0.5, d * 0.25);
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth: Math.max(0.001, d - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev,
    bevelSegments: 2, curveSegments: 3
  });
  g.translate(0, 0, -(d - 2 * bev) / 2);
  return g;
}

/**
 * Extrude a side profile [[z, y], ...] across the width (x). Optional deformations (before normals):
 *  tumble: {y0, y1, k} — narrows the top (tumblehome); plan: {zf, zr, f:[len,k], r:[len,k]} — rounds the corners in plan.
 */
function sideExtrude(pts, width, { bevel = 0.04, tumble = null, plan = null, crease = 0.45 } = {}) {
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? shape.lineTo(-z, y) : shape.moveTo(-z, y)));
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 2
  });
  g.rotateY(Math.PI / 2);
  g.translate(-depth / 2, 0, 0);
  deformBody(g, tumble, plan);
  g.deleteAttribute('normal');
  return toCreasedNormals(g, crease);
}

function deformBody(g, tumble, plan) {
  if (!tumble && !plan) return;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let s = 1;
    if (tumble) {
      const t = Math.max(0, Math.min(1, (y - tumble.y0) / (tumble.y1 - tumble.y0)));
      s *= 1 - tumble.k * Math.pow(t, 1.4);
    }
    if (plan) {
      if (plan.f) {
        const t = Math.max(0, Math.min(1, (z - (plan.zf - plan.f[0])) / plan.f[0]));
        s *= 1 - plan.f[1] * t * t;
      }
      if (plan.r) {
        const t = Math.max(0, Math.min(1, ((plan.zr + plan.r[0]) - z) / plan.r[0]));
        s *= 1 - plan.r[1] * t * t;
      }
    }
    p.setX(i, x * s);
  }
}

/** The body half-width after the same deformation (for placing pillars, mirrors, decals on the deformed sides) */
function deformedHalf(hw, y, z, tumble, plan) {
  let s = 1;
  if (tumble) s *= 1 - tumble.k * Math.pow(Math.max(0, Math.min(1, (y - tumble.y0) / (tumble.y1 - tumble.y0))), 1.4);
  if (plan?.f) { const t = Math.max(0, Math.min(1, (z - (plan.zf - plan.f[0])) / plan.f[0])); s *= 1 - plan.f[1] * t * t; }
  if (plan?.r) { const t = Math.max(0, Math.min(1, ((plan.zr + plan.r[0]) - z) / plan.r[0])); s *= 1 - plan.r[1] * t * t; }
  return hw * s;
}

/** Extrude a plan outline [[x, z], ...] vertically from y0 to y1 */
function planExtrude(pts, y0, y1, bevel = 0.03) {
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  const depth = Math.max(0.01, y1 - y0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, curveSegments: 2
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  g.deleteAttribute('normal');
  return toCreasedNormals(g, 0.5);
}

/** Bottom edge (front → rear) of a side profile, with semicircular wheel arches cut into it */
function bottomWithArches(zFront, zRear, y, arches, steps = 9) {
  const pts = [[zFront, y]];
  for (const a of [...arches].sort((p, q) => q.z - p.z)) {
    const dy = y - a.cy;
    const half = Math.sqrt(Math.max(0, a.r * a.r - dy * dy));
    const a0 = Math.atan2(dy, half);
    for (let i = 0; i <= steps; i++) {
      const t = a0 + (Math.PI - 2 * a0) * (i / steps);
      pts.push([a.z + a.r * Math.cos(t), a.cy + a.r * Math.sin(t)]);
    }
  }
  pts.push([zRear, y]);
  return pts;
}

/**
 * Loft through superelliptic cross-sections. sections: [{z, cx?, cy, hw, ht, hb}] (ascending z);
 * eTop/eBot: superellipse exponents of the upper/lower halves. Smooth normals; flat end caps.
 */
function loft(sections, segs = 32, { eTop = 2.5, eBot = 2.5, capStart = true, capEnd = true } = {}) {
  const pos = [];
  const idx = [];
  const ringPt = (sec, j) => {
    const a = (j / segs) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const e = s >= 0 ? eTop : eBot;
    const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
    const py = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
    return [(sec.cx || 0) + sec.hw * px, sec.cy + (s >= 0 ? sec.ht : sec.hb) * py, sec.z];
  };
  sections.forEach((sec) => {
    for (let j = 0; j < segs; j++) pos.push(...ringPt(sec, j));
  });
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = (i + 1) * segs + j, d = (i + 1) * segs + ((j + 1) % segs);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const parts = [g.toNonIndexed()];
  const cap = (sec, flip) => {
    const cp = [];
    const ctr = [(sec.cx || 0), sec.cy, sec.z];
    for (let j = 0; j < segs; j++) {
      const p0 = ringPt(sec, j), p1 = ringPt(sec, (j + 1) % segs);
      if (flip) cp.push(...ctr, ...p1, ...p0);
      else cp.push(...ctr, ...p0, ...p1);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.computeVertexNormals();
    return cg;
  };
  if (capStart) parts.push(cap(sections[0], true));
  if (capEnd) parts.push(cap(sections[sections.length - 1], false));
  for (const p of parts) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------------------------------------------
// Decal atlas (one shared canvas texture: number plates, TAXI, RideBXL sticker, POLICE, Battenburg, RIVER BUS)
// ---------------------------------------------------------------------------------------------------------------
const ATLAS_W = 2048, ATLAS_H = 1024;
const ATLAS = {
  plateFront: (i) => [i * 256, 0, 256, 56],
  plateRear: (i) => [i * 256, 64, 256, 56],
  taxi: [0, 128, 256, 64],
  ride: [256, 128, 256, 128],
  policeNavy: [512, 128, 1024, 128],
  policeWhite: [0, 256, 1024, 128],
  battenburg: [1024, 256, 1024, 64],
  riverBus: [0, 384, 1024, 128],
  heliReg: [1024, 384, 512, 64],
  rideDoor: [1536, 384, 512, 128],
  cabPlate: [1536, 128, 256, 128],
  vents: [1792, 128, 256, 128]
};
const PLATES = ['LX71 TXC', 'LB19 KRN', 'LG68 WDE', 'LT23 BUS', 'LR70 YHA', 'LK21 PNO', 'LA17 FJX', 'LN72 OVR'];
let _atlasTex = null;

function drawFit(ctx, text, x, y, w, h, font, weight = '900') {
  let size = h;
  ctx.font = `${weight} ${size}px Arial, Helvetica, "DejaVu Sans", sans-serif`;
  const m = ctx.measureText(text).width;
  if (m > w) size = Math.floor(size * (w / m));
  ctx.font = `${weight} ${size}px ${font || 'Arial, Helvetica, "DejaVu Sans", sans-serif'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + size * 0.04);
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function getAtlasTexture() {
  if (_atlasTex) return _atlasTex;
  const c = document.createElement('canvas');
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  // UK plates: white front, yellow rear, black charcoal characters (generic font, no real registrations intended)
  PLATES.forEach((reg, i) => {
    for (const [rect, bg] of [[ATLAS.plateFront(i), '#f4f4ee'], [ATLAS.plateRear(i), '#f7c600']]) {
      const [x, y, w, h] = rect;
      ctx.fillStyle = bg;
      rrect(ctx, x + 2, y + 2, w - 4, h - 4, 6);
      ctx.fill();
      ctx.fillStyle = '#16181a';
      drawFit(ctx, reg, x + 10, y + 4, w - 20, h - 8, null, '700');
    }
  });
  // Taxi roof sign letters (black on the lit amber box)
  {
    const [x, y, w, h] = ATLAS.taxi;
    ctx.fillStyle = '#111';
    drawFit(ctx, 'TAXI', x + 8, y + 4, w - 16, h - 8);
  }
  // RideBXL windscreen sticker (our fictional app)
  {
    const [x, y, w, h] = ATLAS.ride;
    ctx.fillStyle = '#0d0f12';
    rrect(ctx, x + 6, y + 14, w - 12, h - 28, 22);
    ctx.fill();
    ctx.fillStyle = '#21d07a';
    ctx.beginPath();
    ctx.arc(x + 42, y + h / 2, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d0f12';
    ctx.beginPath();
    ctx.arc(x + 42, y + h / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    drawFit(ctx, 'RideBXL', x + 70, y + 30, w - 84, h - 60);
  }
  {
    const [x, y, w, h] = ATLAS.rideDoor;
    ctx.fillStyle = '#e9eef2';
    drawFit(ctx, 'RideBXL · private hire', x + 8, y + 30, w - 16, h - 60, null, '700');
  }
  {
    const [x, y, w, h] = ATLAS.policeNavy;
    ctx.fillStyle = '#15255a';
    drawFit(ctx, 'POLICE', x + 20, y + 6, w - 40, h - 12);
  }
  {
    const [x, y, w, h] = ATLAS.policeWhite;
    ctx.fillStyle = '#ffffff';
    drawFit(ctx, 'POLICE', x + 20, y + 6, w - 40, h - 12);
  }
  {
    const [x, y, w, h] = ATLAS.battenburg;
    const n = 32;
    for (let i = 0; i < n; i++) {
      for (let r = 0; r < 2; r++) {
        ctx.fillStyle = (i + r) % 2 ? '#1f3fb0' : '#f6d81a';
        ctx.fillRect(x + (i * w) / n, y + (r * h) / 2, w / n + 0.5, h / 2 + 0.5);
      }
    }
  }
  {
    const [x, y, w, h] = ATLAS.riverBus;
    ctx.fillStyle = '#ffffff';
    drawFit(ctx, 'RIVER BUS', x + 20, y + 8, w - 40, h * 0.62);
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(x + 40, y + h - 24, w - 80, 8);
  }
  {
    const [x, y, w, h] = ATLAS.heliReg;
    ctx.fillStyle = '#15255a';
    drawFit(ctx, 'G-BXLP', x + 10, y + 4, w - 20, h - 8);
  }
  {
    const [x, y, w, h] = ATLAS.cabPlate;
    ctx.fillStyle = '#f4f4ee';
    rrect(ctx, x + 4, y + 4, w - 8, h - 8, 10);
    ctx.fill();
    ctx.fillStyle = '#16181a';
    drawFit(ctx, 'LICENSED', x + 14, y + 12, w - 28, 40, null, '700');
    drawFit(ctx, 'HACKNEY CARRIAGE', x + 14, y + 52, w - 28, 26, null, '700');
    drawFit(ctx, 'No. 04721', x + 14, y + 82, w - 28, 30, null, '700');
  }
  {
    const [x, y, w, h] = ATLAS.vents;
    ctx.fillStyle = '#0c0d0e';
    for (let i = 0; i < 10; i++) ctx.fillRect(x + 6, y + 8 + i * 12, w - 12, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  _atlasTex = tex;
  return tex;
}

const _blindCache = new Map();
/** Destination blind texture: top half = route + destination, bottom-left = route number only */
function getBlindTexture(route, destination) {
  const key = `${route}|${destination}`;
  if (_blindCache.has(key)) return _blindCache.get(key);
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#060606';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#ffcf3a';
  drawFit(ctx, String(route), 12, 8, 220, 112, null, '900');
  drawFit(ctx, destination, 240, 22, 770, 84, null, '700');
  drawFit(ctx, String(route), 12, 136, 232, 112, null, '900');
  ctx.font = '600 34px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  drawFit(ctx, `via ${destination === 'Trafalgar Square' ? 'Whitehall' : 'Trafalgar Square'}`, 280, 150, 700, 70, null, '600');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _blindCache.set(key, tex);
  return tex;
}

/** A decal quad (facing +z before `rot`) showing atlas region `rect` = [px, py, pw, ph] of a texW×texH canvas */
function decal(P, rect, w, h, pos, rot, surf = { rough: 0.4 }, texW = ATLAS_W, texH = ATLAS_H) {
  const g = new THREE.PlaneGeometry(w, h);
  const [px, py, pw, ph] = rect;
  const u0 = px / texW, u1 = (px + pw) / texW, v1 = 1 - py / texH, v0 = 1 - (py + ph) / texH;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return P.add(g, { pos, rot, surf: { color: 0xffffff, ...surf } });
}
const FACE = { front: [0, 0, 0], rear: [0, Math.PI, 0], left: [0, Math.PI / 2, 0], right: [0, -Math.PI / 2, 0], down: [Math.PI / 2, 0, 0], up: [-Math.PI / 2, 0, 0] };
// NB: "left" = the +x side (nearside in the UK), "right" = the -x side (offside, the driver's side)

// ---------------------------------------------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------------------------------------------
const _wheelCache = new Map();

/** Wheel geometry centred on its axle (axis = x), hub face towards +x; returns {left, right} (left = +x side) */
function wheelGeometries(r, w, { rimSurf = S.rim, spokes = 5, rimRatio = 0.62, twin = false, open = false } = {}) {
  const key = `${r}|${w}|${rimSurf.color}|${spokes}|${rimRatio}|${twin}|${open}`;
  if (_wheelCache.has(key)) return _wheelCache.get(key);
  const P = new Parts();
  const rr = r * rimRatio, hw = w / 2;
  const prof = [[rr, -hw * 0.92], [r * 0.9, -hw], [r * 0.985, -hw * 0.82], [r, -hw * 0.45], [r, hw * 0.45], [r * 0.985, hw * 0.82], [r * 0.9, hw], [rr, hw * 0.92]]
    .map(([a, b]) => new THREE.Vector2(a, b));
  const tyre = new THREE.LatheGeometry(prof, 22);
  tyre.rotateZ(-Math.PI / 2);
  P.add(tyre, { surf: S.rubber });
  if (open) {
    // bicycle: a rim hoop + hub only (spokes are added by the caller)
    P.add(new THREE.TorusGeometry(rr * 0.99, w * 0.28, 6, 28), { rot: [0, Math.PI / 2, 0], surf: rimSurf, scale: [1, 1, 1] });
    const left = mergeGeometries(P.geos);
    const out = { left, right: left.clone().rotateY(Math.PI) };
    _wheelCache.set(key, out);
    return out;
  }
  P.cyl(rr * 0.98, w * 0.86, 'x', [0, 0, 0], S.darkRim, 18);
  P.cyl(rr * 0.97, 0.02, 'x', [hw * 0.82, 0, 0], rimSurf, 18);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    P.box(0.025, rr * 0.86, rr * 0.2, [hw * 0.86, Math.cos(a) * rr * 0.5, Math.sin(a) * rr * 0.5], rimSurf, [a, 0, 0]);
  }
  P.cyl(rr * 0.24, 0.05, 'x', [hw * 0.88, 0, 0], twin ? S.darkRim : rimSurf, 10);
  P.cyl(rr * 0.95, 0.01, 'x', [-hw * 0.8, 0, 0], S.black, 14);
  const left = mergeGeometries(P.geos);
  const right = left.clone().rotateY(Math.PI);
  left.computeBoundingSphere();
  right.computeBoundingSphere();
  const out = { left, right };
  _wheelCache.set(key, out);
  return out;
}

function addWheels(group, list, r, w, opts = {}, material) {
  const geos = wheelGeometries(r, w, opts);
  group.userData.wheels = [];
  group.userData.wheelGeo = geos;
  for (const wl of list) {
    const pivot = new THREE.Group();
    pivot.name = wl.name;
    pivot.position.set(wl.x, r, wl.z);
    const spin = new THREE.Mesh(wl.x < 0 ? geos.right : geos.left, material);
    spin.name = 'spin';
    spin.castShadow = true;
    pivot.add(spin);
    group.add(pivot);
    group.userData.wheels.push({ group: pivot, spin, front: !!wl.front, side: Math.sign(wl.x), x: wl.x, y: r, z: wl.z, radius: r });
  }
}

const fourWheels = (track, zf, zr) => [
  { name: 'wheel_FL', x: track, z: zf, front: true },
  { name: 'wheel_FR', x: -track, z: zf, front: true },
  { name: 'wheel_RL', x: track, z: zr },
  { name: 'wheel_RR', x: -track, z: zr }
];

function finish(group, P, D, spec, uniforms, extraDecalTex = null, X = null) {
  const bodyMat = createVehicleMaterial({ uniforms });
  const body = P.mesh(bodyMat, 'body');
  group.add(body);
  const dm = D && D.mesh(createVehicleMaterial({ uniforms, map: getAtlasTexture() }), 'decals');
  if (dm) {
    dm.castShadow = false;
    group.add(dm);
  }
  if (X && extraDecalTex) {
    const xm = X.mesh(createVehicleMaterial({ uniforms, map: extraDecalTex }), 'blinds');
    if (xm) {
      xm.castShadow = false;
      group.add(xm);
    }
  }
  group.userData.spec = spec;
  group.userData.kind = spec.kind;
  group.userData.uniforms = uniforms;
  group.userData.animated = group.userData.animated || [];
  return group;
}

// ---------------------------------------------------------------------------------------------------------------
// Car shells (shared by the cab, the RideBXL car and the generic traffic cars)
// ---------------------------------------------------------------------------------------------------------------
/**
 * cfg: { L, W, lowerTop:[[z,y]] (rear bottom → tail → belt/bonnet → nose → front bottom), sill, arches:[{z,r,cy}],
 *  glass:[[z,y]] (closed), roof:[[z,y]] (closed), glassInset, tumble, plan, paint, bevel }
 */
function carShell(P, cfg) {
  const lower = [...cfg.lowerTop];
  const zFrontBottom = lower[lower.length - 1][0];
  const zRearBottom = lower[0][0];
  const bottom = bottomWithArches(zFrontBottom - 0.02, zRearBottom + 0.02, cfg.sill, cfg.arches);
  const prof = lower.concat(bottom.slice(1, -1));
  const opts = { bevel: cfg.bevel ?? 0.05, tumble: cfg.tumble, plan: cfg.plan };
  // the arch walls (the faces spanning the width along each wheel arch) are dark, like wheel-arch liners
  const base = cfg.lowerSurf || S.paint(cfg.paint);
  const lim = cfg.W / 2 - (cfg.bevel ?? 0.05) - 0.03;
  const lowerColour = (x, y, z) => {
    for (const a of cfg.arches) {
      if (Math.abs(x) < lim && Math.abs(Math.hypot(z - a.z, y - a.cy) - a.r) < 0.04 && y > cfg.sill - 0.01) return S.black;
    }
    return typeof base.color === 'function' ? { ...base, color: base.color(x, y, z) } : base;
  };
  P.add(sideExtrude(prof, cfg.W, opts), { surf: { ...base, color: lowerColour } });
  const gw = cfg.W - 2 * (cfg.glassInset ?? 0.035);
  if (cfg.glass) P.add(sideExtrude(cfg.glass, gw, { ...opts, bevel: 0.03 }), { surf: cfg.glassSurf || S.glass });
  if (cfg.roof) P.add(sideExtrude(cfg.roof, gw + 0.016, { ...opts, bevel: 0.035 }), { surf: cfg.roofSurf || S.paint(cfg.paint) });
}

/** A slanted pillar strip on the glasshouse side between two (z,y) points */
function pillar(P, cfg, side, z0, y0, z1, y1, wid = 0.07, surf) {
  const gw = (cfg.W - 2 * (cfg.glassInset ?? 0.035)) / 2;
  const x0 = deformedHalf(gw, y0, z0, cfg.tumble, cfg.plan) + 0.004;
  const x1 = deformedHalf(gw, y1, z1, cfg.tumble, cfg.plan) + 0.004;
  const a = [side * x0, y0, z0], b = [side * x1, y1, z1];
  _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _v.length();
  _q.setFromUnitVectors(Y_AXIS, _v.normalize());
  const m = new THREE.Matrix4().compose(_v2.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
  P.add(new THREE.BoxGeometry(0.02, len, wid), { matrix: m, surf: surf || S.paint(cfg.paint) });
}

function sideHalf(cfg, y, z) {
  return deformedHalf(cfg.W / 2, y, z, cfg.tumble, cfg.plan);
}

/** Door seams, handles, mirrors, plates, lamps, bumpers: the common car details */
function carDetails(P, D, cfg, d) {
  const hw = cfg.W / 2;
  // door shut lines (thin dark strips proud of the lower body)
  for (const z of d.seams || []) {
    for (const side of [-1, 1]) {
      const x = side * (sideHalf(cfg, (cfg.sill + d.belt) / 2, z) + 0.002);
      P.box(0.006, d.belt - cfg.sill - 0.12, 0.012, [x, (cfg.sill + d.belt) / 2 + 0.04, z], S.black);
    }
  }
  for (const z of d.handles || []) {
    for (const side of [-1, 1]) {
      const y = d.belt - 0.09;
      P.box(0.025, 0.03, 0.15, [side * (sideHalf(cfg, y, z) + 0.01), y, z], d.handleSurf || S.chrome);
    }
  }
  // door mirrors
  if (d.mirror) {
    const [mz, my] = d.mirror;
    for (const side of [-1, 1]) {
      const x = side * (sideHalf(cfg, my, mz) + 0.1);
      P.rbox(0.2, 0.13, 0.1, 0.04, [x, my + 0.04, mz], d.mirrorSurf || S.paint(cfg.paint));
      P.box(0.12, 0.04, 0.05, [side * (sideHalf(cfg, my, mz) + 0.03), my, mz + 0.02], S.black);
      P.box(0.17, 0.1, 0.01, [x, my + 0.04, mz - 0.052], S.chrome);
    }
  }
  // bumpers
  if (d.frontBumper) {
    const [y0, y1, z, wid] = d.frontBumper;
    P.rbox(wid ?? cfg.W - 0.12, y1 - y0, 0.16, 0.06, [0, (y0 + y1) / 2, z], d.bumperSurf || S.plastic);
  }
  if (d.rearBumper) {
    const [y0, y1, z, wid] = d.rearBumper;
    P.rbox(wid ?? cfg.W - 0.12, y1 - y0, 0.16, 0.06, [0, (y0 + y1) / 2, z], d.bumperSurf || S.plastic);
  }
  // number plates (UK: white front, yellow rear)
  const pi = d.plateIndex ?? 0;
  if (d.frontPlate) decal(D, ATLAS.plateFront(pi), 0.52, 0.114, d.frontPlate, FACE.front, { rough: 0.35 });
  if (d.rearPlate) decal(D, ATLAS.plateRear(pi), 0.52, 0.114, d.rearPlate, FACE.rear, { rough: 0.35 });
  if (d.frontPlate) P.box(0.54, 0.13, 0.01, [d.frontPlate[0], d.frontPlate[1], d.frontPlate[2] - 0.008], S.black);
  if (d.rearPlate) P.box(0.54, 0.13, 0.01, [d.rearPlate[0], d.rearPlate[1], d.rearPlate[2] + 0.008], S.black);
}

/** Simple interior: dash, steering wheel on the RIGHT (-x), seats — seen in the cockpit view */
function carInterior(P, cfg, { dashZ, dashY, seatZ, seatY = 0.42, rearSeatZ = null, wheelZ = null, track = 0.38 }) {
  const iw = cfg.W - 0.22;
  P.box(iw, 0.12, 0.42, [0, dashY, dashZ], S.interior);
  P.box(iw - 0.1, 0.32, 0.14, [0, dashY - 0.2, dashZ + 0.1], S.interior);
  // steering wheel (right-hand drive)
  const swZ = wheelZ ?? dashZ - 0.28;
  const sw = new THREE.TorusGeometry(0.185, 0.022, 8, 24);
  P.add(sw, { pos: [-track, dashY + 0.06, swZ], rot: [-0.35, 0, 0], surf: S.black });
  P.box(0.03, 0.03, 0.34, [-track, dashY + 0.0, swZ + 0.14], S.black, [-0.35, 0, 0]);
  P.box(0.18, 0.05, 0.05, [-track, dashY + 0.07, swZ], S.black, [-0.35, 0, 0]);
  // instrument binnacle
  P.box(0.34, 0.08, 0.14, [-track, dashY + 0.1, dashZ - 0.12], S.black);
  // front seats
  for (const side of [-1, 1]) {
    P.rbox(0.48, 0.12, 0.5, 0.04, [side * track, seatY, seatZ], S.interior);
    P.rbox(0.46, 0.62, 0.11, 0.05, [side * track, seatY + 0.36, seatZ - 0.28], S.interior, [-0.18, 0, 0]);
    P.rbox(0.24, 0.16, 0.08, 0.04, [side * track, seatY + 0.76, seatZ - 0.36], S.interior);
  }
  if (rearSeatZ !== null) {
    P.rbox(iw - 0.1, 0.12, 0.5, 0.04, [0, seatY, rearSeatZ], S.interior);
    P.rbox(iw - 0.1, 0.6, 0.12, 0.05, [0, seatY + 0.34, rearSeatZ - 0.3], S.interior, [-0.15, 0, 0]);
  }
}

function lampPair(P, x, y, z, w, h, surf, face = 'front', depth = 0.06) {
  for (const side of [-1, 1]) {
    P.rbox(w, h, depth, Math.min(w, h) * 0.35, [side * x, y, z], surf, face === 'front' ? [0, 0, 0] : [0, Math.PI, 0]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Black cab (LEVC TX-flavoured: tall rounded body, round headlamps, oval grille, amber TAXI sign)
// ---------------------------------------------------------------------------------------------------------------
export function blackCab({ colour = 0x0b0c0e, uniforms = VEHICLE_UNIFORMS, plateIndex = 0 } = {}) {
  const group = new THREE.Group();
  group.name = 'BlackCab';
  const P = new Parts(), D = new Parts();
  const L = 4.86, W = 1.94, zf = 2.43, zr = -2.43, R = 0.355;
  const axF = 1.55, axR = -1.44;
  const cfg = {
    L, W, paint: colour, sill: 0.3,
    arches: [{ z: axF, r: 0.46, cy: R + 0.02 }, { z: axR, r: 0.46, cy: R + 0.02 }],
    lowerTop: [[-2.38, 0.33], [-2.43, 0.46], [-2.44, 0.78], [-2.41, 1.03], [-1.6, 1.04], [0.95, 1.05], [1.45, 1.01], [1.9, 0.95],
      [2.2, 0.88], [2.36, 0.8], [2.43, 0.67], [2.45, 0.5], [2.42, 0.37], [2.35, 0.31]],
    glass: [[-2.38, 1.0], [-2.33, 1.4], [-2.16, 1.76], [0.43, 1.76], [1.0, 1.0]],
    roof: [[-2.17, 1.74], [-2.08, 1.82], [-1.9, 1.87], [-0.5, 1.885], [0.22, 1.87], [0.38, 1.82], [0.46, 1.74]],
    tumble: { y0: 1.04, y1: 1.89, k: 0.12 },
    plan: { zf, zr, f: [0.55, 0.16], r: [0.6, 0.13] },
    bevel: 0.06
  };
  carShell(P, cfg);
  // pillars (A along the windscreen, B, C) — black on a black cab, but they give the glasshouse its shape
  for (const side of [-1, 1]) {
    pillar(P, cfg, side, 0.98, 1.05, 0.44, 1.76, 0.09);
    pillar(P, cfg, side, 0.12, 1.05, 0.12, 1.76, 0.1);
    pillar(P, cfg, side, -1.25, 1.05, -1.25, 1.76, 0.12);
    pillar(P, cfg, side, -2.3, 1.05, -2.12, 1.75, 0.1);
  }
  // chrome waistline strip
  for (const side of [-1, 1]) P.box(0.012, 0.018, 3.4, [side * (sideHalf(cfg, 1.03, 0) + 0.002), 1.035, -0.62], S.chrome);
  // oval chrome grille + round headlamps (the cab's face)
  P.add(new THREE.CylinderGeometry(1, 1, 0.06, 28), { pos: [0, 0.6, 2.42], rot: [Math.PI / 2, 0, 0], scale: [0.36, 1, 0.17], surf: S.chrome });
  P.add(new THREE.CylinderGeometry(1, 1, 0.06, 28), { pos: [0, 0.6, 2.437], rot: [Math.PI / 2, 0, 0], scale: [0.32, 1, 0.14], surf: S.black });
  for (let i = -3; i <= 3; i++) P.box(0.012, 0.22, 0.02, [i * 0.08, 0.6, 2.47], S.chrome);
  for (const side of [-1, 1]) {
    P.cyl(0.115, 0.07, 'z', [side * 0.68, 0.76, 2.36], S.chrome, 20);
    P.cyl(0.095, 0.03, 'z', [side * 0.68, 0.76, 2.395], S.head, 20);
    P.cyl(0.04, 0.03, 'z', [side * 0.47, 0.75, 2.4], S.amber, 12);
  }
  // bonnet badge-free crease + wipers
  for (const side of [-1, 1]) P.box(0.5, 0.012, 0.02, [side * 0.32, 1.06, 0.98], S.black, [0, side * 0.18, 0]);
  // rear lamps (tall vertical clusters at the corners), rear "LICENSED" plate
  for (const side of [-1, 1]) {
    P.rbox(0.16, 0.42, 0.05, 0.04, [side * 0.8, 0.82, -2.425], S.tail, [0, Math.PI, 0]);
    P.rbox(0.13, 0.1, 0.05, 0.03, [side * 0.8, 0.54, -2.42], S.amber, [0, Math.PI, 0]);
  }
  P.box(0.5, 0.03, 0.03, [0, 1.73, -2.16], S.tail);
  decal(D, ATLAS.cabPlate, 0.3, 0.15, [0.55, 1.12, -2.39], FACE.rear, { rough: 0.4 });
  // roof "TAXI" sign: lit amber when for hire (uniforms.sign)
  P.rbox(0.48, 0.15, 0.17, 0.035, [0, 1.965, 0.12], { color: 0xffa31a, rough: 0.3, emit: 4 });
  P.box(0.36, 0.03, 0.1, [0, 1.885, 0.12], S.black);
  decal(D, ATLAS.taxi, 0.4, 0.1, [0, 1.965, 0.207], FACE.front, { rough: 0.3 });
  decal(D, ATLAS.taxi, 0.4, 0.1, [0, 1.965, 0.033], FACE.rear, { rough: 0.3 });
  carDetails(P, D, cfg, {
    belt: 1.04, seams: [1.0, 0.14, -1.28], handles: [0.24, -1.15], mirror: [0.86, 1.12],
    frontBumper: [0.3, 0.5, 2.39, 1.82], rearBumper: [0.32, 0.52, -2.41, 1.84],
    frontPlate: [0, 0.4, 2.48], rearPlate: [0, 0.62, -2.465], plateIndex, mirrorSurf: S.paint(colour)
  });
  carInterior(P, cfg, { dashZ: 0.82, dashY: 1.0, seatZ: 0.2, seatY: 0.62, rearSeatZ: -1.6, track: 0.42 });
  // passenger partition
  P.box(cfg.W - 0.3, 0.7, 0.02, [0, 1.25, -0.25], { color: 0x2a3a44, rough: 0.1, metal: 0.4 });
  addWheels(group, fourWheels(0.8, axF, axR), R, 0.24, { spokes: 6 }, createVehicleMaterial({ uniforms }));
  return finish(group, P, D, {
    kind: 'blackCab', length: L, width: W, height: 2.04, wheelbase: axF - axR, wheelRadius: R, halfExtents: { hx: 0.97, hz: 2.43 },
    headlight: [0.68, 0.76], zFront: 2.43, tail: [0.8, 0.82], zRear: -2.44,
    driverSeat: { x: -0.42, y: 0.62, z: 0.2 }, povOffset: { x: -0.42, y: 1.5, z: 0.1 }, maxSteer: 0.62
  }, uniforms);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. RideBXL car (generic hybrid liftback, Prius-ish wedge with a Kamm tail; "RideBXL" sticker in the windscreen)
// ---------------------------------------------------------------------------------------------------------------
export function rideCar({ colour = 0x1d1f23, uniforms = VEHICLE_UNIFORMS, plateIndex = 5 } = {}) {
  const group = new THREE.Group();
  group.name = 'RideBXLCar';
  const P = new Parts(), D = new Parts();
  const L = 4.54, W = 1.78, zf = 2.27, zr = -2.27, R = 0.31, axF = 1.42, axR = -1.28;
  const cfg = {
    L, W, paint: colour, sill: 0.28,
    arches: [{ z: axF, r: 0.4, cy: R + 0.02 }, { z: axR, r: 0.4, cy: R + 0.02 }],
    lowerTop: [[-2.2, 0.3], [-2.26, 0.48], [-2.28, 0.8], [-2.25, 0.99], [-1.9, 1.01], [0.85, 0.9], [1.4, 0.81], [1.95, 0.7],
      [2.2, 0.6], [2.27, 0.48], [2.25, 0.36], [2.18, 0.29]],
    glass: [[-2.23, 0.96], [-2.14, 1.12], [-1.25, 1.37], [-0.15, 1.4], [0.88, 0.88]],
    roof: [[-1.32, 1.34], [-1.15, 1.42], [-0.6, 1.47], [-0.25, 1.47], [-0.12, 1.43], [-0.05, 1.34]],
    tumble: { y0: 0.95, y1: 1.47, k: 0.12 },
    plan: { zf, zr, f: [0.6, 0.2], r: [0.4, 0.08] },
    bevel: 0.05
  };
  carShell(P, cfg);
  for (const side of [-1, 1]) {
    pillar(P, cfg, side, 0.86, 0.9, -0.12, 1.39, 0.07);
    pillar(P, cfg, side, -0.25, 0.95, -0.25, 1.4, 0.09, S.black);
    pillar(P, cfg, side, -1.2, 0.97, -1.25, 1.36, 0.14);
    pillar(P, cfg, side, -2.16, 0.98, -2.16, 1.1, 0.06);
  }
  // Kamm-tail spoiler bar + split rear glass + full-width rear light bar
  P.rbox(W - 0.22, 0.05, 0.16, 0.02, [0, 1.12, -2.12], S.paint(colour));
  P.rbox(W - 0.3, 0.06, 0.04, 0.02, [0, 0.93, -2.27], S.tail, [0, Math.PI, 0]);
  for (const side of [-1, 1]) P.rbox(0.28, 0.11, 0.06, 0.03, [side * 0.68, 0.9, -2.25], S.tail, [0, Math.PI, 0]);
  // slim swept-back headlamps + lower grille
  for (const side of [-1, 1]) {
    P.add(new THREE.BoxGeometry(0.4, 0.055, 0.12), { pos: [side * 0.58, 0.625, 2.15], rot: [0.25, side * 0.42, 0], surf: S.head });
    P.add(new THREE.BoxGeometry(0.44, 0.075, 0.14), { pos: [side * 0.58, 0.615, 2.14], rot: [0.25, side * 0.42, 0], surf: S.black });
    P.box(0.22, 0.02, 0.05, [side * 0.55, 0.42, 2.25], S.head);
  }
  P.rbox(1.0, 0.18, 0.06, 0.06, [0, 0.4, 2.24], S.black);
  P.box(0.95, 0.035, 0.05, [0, 0.62, 2.2], S.black);
  carDetails(P, D, cfg, {
    belt: 0.92, seams: [0.85, -0.2, -1.22], handles: [0.15, -1.0], mirror: [0.75, 0.97],
    frontBumper: null, rearBumper: [0.3, 0.45, -2.24, 1.6], frontPlate: [0, 0.52, 2.27], rearPlate: [0, 0.66, -2.25], plateIndex
  });
  // RideBXL sticker on the windscreen, lower nearside corner (+x), and a small one on the rear glass
  const wsN = [0.5, 1.0];
  const nl = Math.hypot(...wsN);
  const ny = wsN[1] / nl, nz = wsN[0] / nl;
  decal(D, ATLAS.ride, 0.22, 0.11, [0.48, 0.99 + ny * 0.012, 0.66 + nz * 0.012], [-Math.atan2(ny, nz), 0, 0], { rough: 0.3 });
  decal(D, ATLAS.ride, 0.16, 0.08, [0.45, 1.06, -2.205], [0.0, Math.PI, 0], { rough: 0.3 });
  for (const side of [-1, 1]) {
    const x = side * (sideHalf(cfg, 0.62, 0.2) + 0.006);
    decal(D, ATLAS.rideDoor, 0.7, 0.17, [x, 0.6, -0.35], side > 0 ? FACE.left : FACE.right, { rough: 0.4 });
  }
  carInterior(P, cfg, { dashZ: 0.52, dashY: 0.82, seatZ: -0.18, seatY: 0.4, rearSeatZ: -1.1, track: 0.38 });
  addWheels(group, fourWheels(0.76, axF, axR), R, 0.21, { spokes: 10, rimRatio: 0.6 }, createVehicleMaterial({ uniforms }));
  return finish(group, P, D, {
    kind: 'rideCar', length: L, width: W, height: 1.47, wheelbase: axF - axR, wheelRadius: R, halfExtents: { hx: 0.89, hz: 2.27 },
    headlight: [0.6, 0.7], zFront: 2.2, tail: [0.68, 0.9], zRear: -2.27,
    driverSeat: { x: -0.38, y: 0.4, z: -0.18 }, povOffset: { x: -0.38, y: 1.18, z: -0.1 }, maxSteer: 0.56
  }, uniforms);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Generic traffic cars: hatch / saloon / suv / van (white Transit-style)
// ---------------------------------------------------------------------------------------------------------------
export const CAR_COLOURS = [0xb8bcc0, 0x6c7176, 0x1b1c1f, 0xf0f0ee, 0x1f2f55, 0x8c1c22, 0x2f5f8f, 0x3d4a3f, 0x9a9184, 0x4a4f57];

export function genericCar({ colour = null, type = 'hatch', uniforms = VEHICLE_UNIFORMS, plateIndex = null, seed = 1 } = {}) {
  const rnd = mulberry(seed * 7919 + type.length);
  if (colour === null) colour = type === 'van' ? 0xf1f2f0 : CAR_COLOURS[Math.floor(rnd() * CAR_COLOURS.length)];
  if (plateIndex === null) plateIndex = Math.floor(rnd() * PLATES.length);
  const group = new THREE.Group();
  group.name = `Car_${type}`;
  const P = new Parts(), D = new Parts();
  let cfg, d, spec, R, axF, axR, track, interior;
  if (type === 'saloon') {
    R = 0.32; axF = 1.5; axR = -1.35; track = 0.78;
    cfg = {
      L: 4.75, W: 1.82, paint: colour, sill: 0.28,
      arches: [{ z: axF, r: 0.41, cy: R + 0.02 }, { z: axR, r: 0.41, cy: R + 0.02 }],
      lowerTop: [[-2.32, 0.31], [-2.37, 0.55], [-2.36, 0.92], [-2.27, 1.02], [-1.5, 1.02], [0.9, 0.95], [1.4, 0.88], [1.95, 0.8],
        [2.25, 0.7], [2.36, 0.55], [2.34, 0.38], [2.27, 0.29]],
      glass: [[-1.58, 0.98], [-0.98, 1.36], [0.16, 1.36], [0.92, 0.93]],
      roof: [[-1.03, 1.33], [-0.88, 1.42], [-0.5, 1.45], [0.0, 1.45], [0.16, 1.4], [0.22, 1.33]],
      tumble: { y0: 0.98, y1: 1.45, k: 0.12 }, plan: { zf: 2.37, zr: -2.37, f: [0.55, 0.17], r: [0.45, 0.1] }
    };
    d = { belt: 0.98, seams: [0.9, -0.12, -1.0], handles: [0.2, -0.9], mirror: [0.8, 1.02], frontBumper: [0.29, 0.48, 2.3, 1.7],
      rearBumper: [0.3, 0.5, -2.33, 1.7], frontPlate: [0, 0.42, 2.38], rearPlate: [0, 0.75, -2.37] };
    interior = { dashZ: 0.6, dashY: 0.85, seatZ: -0.1, seatY: 0.42, rearSeatZ: -1.0, track: 0.39 };
    spec = { height: 1.46, headlight: [0.66, 0.74], zFront: 2.3, tail: [0.7, 0.88], zRear: -2.37 };
    lampPair(P, 0.62, 0.74, 2.2, 0.36, 0.11, S.head, 'front', 0.2);
    lampPair(P, 0.68, 0.88, -2.33, 0.34, 0.12, S.tail, 'rear', 0.08);
    P.rbox(0.8, 0.16, 0.05, 0.04, [0, 0.6, 2.33], S.black);
  } else if (type === 'suv') {
    R = 0.37; axF = 1.42; axR = -1.38; track = 0.82;
    cfg = {
      L: 4.6, W: 1.9, paint: colour, sill: 0.38,
      arches: [{ z: axF, r: 0.47, cy: R + 0.02 }, { z: axR, r: 0.47, cy: R + 0.02 }],
      lowerTop: [[-2.25, 0.42], [-2.3, 0.65], [-2.31, 1.05], [-2.26, 1.12], [0.7, 1.1], [1.3, 1.05], [1.9, 0.99], [2.2, 0.9],
        [2.3, 0.72], [2.29, 0.5], [2.22, 0.41]],
      glass: [[-2.25, 1.08], [-2.19, 1.58], [0.05, 1.6], [0.78, 1.08]],
      roof: [[-2.21, 1.56], [-2.14, 1.68], [-1.9, 1.72], [-0.1, 1.72], [0.06, 1.66], [0.11, 1.56]],
      tumble: { y0: 1.1, y1: 1.72, k: 0.08 }, plan: { zf: 2.3, zr: -2.31, f: [0.5, 0.12], r: [0.35, 0.06] }, bevel: 0.06,
      lowerSurf: { color: (x, y) => (y < 0.62 ? 0x2a2c2e : colour), rough: 0.3, metal: 0.18, paint: 1 }
    };
    d = { belt: 1.1, seams: [0.78, -0.25, -1.3], handles: [0.15, -1.0], mirror: [0.7, 1.16], frontBumper: [0.4, 0.66, 2.25, 1.8],
      rearBumper: [0.42, 0.66, -2.27, 1.8], frontPlate: [0, 0.55, 2.33], rearPlate: [0, 0.82, -2.31] };
    interior = { dashZ: 0.45, dashY: 1.0, seatZ: -0.25, seatY: 0.58, rearSeatZ: -1.1, track: 0.42 };
    spec = { height: 1.75, headlight: [0.68, 0.85], zFront: 2.28, tail: [0.78, 1.25], zRear: -2.31 };
    lampPair(P, 0.66, 0.86, 2.22, 0.34, 0.12, S.head, 'front', 0.14);
    lampPair(P, 0.8, 1.28, -2.29, 0.18, 0.34, S.tail, 'rear', 0.06);
    P.rbox(0.9, 0.25, 0.06, 0.05, [0, 0.82, 2.28], S.black);
    for (const side of [-1, 1]) P.box(0.04, 0.04, 2.1, [side * 0.7, 1.75, -1.0], S.black);
    for (const side of [-1, 1]) for (const z of [axF, axR]) P.box(0.04, 0.1, 0.9, [side * 0.955, R + 0.32, z], S.black);
  } else if (type === 'van') {
    R = 0.36; axF = 1.92; axR = -1.66; track = 0.86;
    const vpaint = colour;
    cfg = {
      L: 5.5, W: 2.05, paint: vpaint, sill: 0.34,
      arches: [{ z: axF, r: 0.46, cy: R + 0.02 }, { z: axR, r: 0.46, cy: R + 0.02 }],
      lowerTop: [[-2.7, 0.36], [-2.75, 0.5], [-2.75, 2.2], [-2.66, 2.32], [0.85, 2.33], [1.15, 2.2], [1.78, 1.2], [2.3, 1.02],
        [2.62, 0.86], [2.73, 0.62], [2.72, 0.42], [2.65, 0.34]],
      glass: null, roof: null,
      tumble: { y0: 1.2, y1: 2.33, k: 0.05 }, plan: { zf: 2.75, zr: -2.75, f: [0.5, 0.12], r: [0.15, 0.03] }, bevel: 0.07,
      lowerSurf: { color: (x, y) => (y < 0.62 ? 0x2b2d2f : vpaint), rough: 0.35, metal: 0.1, paint: 1 }
    };
    d = { belt: 1.2, seams: [1.0, 0.25, -2.7], handles: [0.85, 0.05], mirror: [1.62, 1.35], frontBumper: [0.34, 0.6, 2.68, 1.94],
      rearBumper: [0.34, 0.55, -2.74, 1.96], frontPlate: [0, 0.48, 2.77], rearPlate: [0, 0.68, -2.77], mirrorSurf: S.black };
    interior = { dashZ: 1.5, dashY: 1.1, seatZ: 0.75, seatY: 0.75, track: 0.5, wheelZ: 1.25 };
    spec = { height: 2.33, headlight: [0.72, 0.92], zFront: 2.68, tail: [0.95, 1.0], zRear: -2.76 };
    // windscreen, cab side windows, rear door windows, sliding door rail
    {
      const a = [1.15, 2.2], b = [1.78, 1.2];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ang = Math.atan2(a[0] - b[0], a[1] - b[1]);
      P.box(1.76, len - 0.08, 0.03, [0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2 + 0.03], S.glass, [ang, 0, 0]);
    }
    for (const side of [-1, 1]) {
      const x = side * (sideHalf(cfg, 1.6, 1.1) + 0.005);
      P.add(new THREE.ShapeGeometry(sidePoly([[0.4, 1.3], [1.62, 1.3], [1.24, 1.95], [0.4, 1.95]], side)), { pos: [x, 0, 0], rot: [0, side * Math.PI / 2, 0], surf: S.glass });
      P.box(0.02, 0.025, 2.4, [side * (sideHalf(cfg, 2.0, -0.9) + 0.01), 2.0, -0.9], S.black);
    }
    for (const side of [-1, 1]) P.box(0.78, 0.55, 0.02, [side * 0.46, 1.78, -2.765], S.glass);
    P.box(0.02, 1.8, 0.02, [0, 1.3, -2.77], S.black);
    lampPair(P, 0.72, 0.92, 2.55, 0.34, 0.16, S.head, 'front', 0.16);
    P.rbox(1.0, 0.3, 0.06, 0.05, [0, 0.78, 2.7], S.black);
    for (const side of [-1, 1]) P.rbox(0.14, 0.42, 0.06, 0.04, [side * 0.95, 1.0, -2.76], S.tail, [0, Math.PI, 0]);
    P.box(0.5, 0.04, 0.04, [0, 2.3, -2.74], S.tail);
    for (const side of [-1, 1]) P.box(0.04, 0.12, 1.2, [side * 1.03, 0.6, 0.2], S.black);
  } else {
    // hatch
    R = 0.31; axF = 1.32; axR = -1.23; track = 0.76;
    cfg = {
      L: 4.05, W: 1.76, paint: colour, sill: 0.28,
      arches: [{ z: axF, r: 0.4, cy: R + 0.02 }, { z: axR, r: 0.4, cy: R + 0.02 }],
      lowerTop: [[-1.98, 0.3], [-2.02, 0.5], [-2.03, 0.82], [-1.99, 0.97], [-1.0, 0.96], [0.75, 0.92], [1.3, 0.85], [1.75, 0.76],
        [1.95, 0.66], [2.02, 0.52], [2.0, 0.36], [1.93, 0.28]],
      glass: [[-1.98, 0.93], [-1.86, 1.36], [0.08, 1.36], [0.82, 0.93]],
      roof: [[-1.87, 1.33], [-1.8, 1.42], [-1.6, 1.46], [-0.2, 1.47], [0.0, 1.42], [0.11, 1.33]],
      tumble: { y0: 0.95, y1: 1.47, k: 0.12 }, plan: { zf: 2.02, zr: -2.03, f: [0.5, 0.16], r: [0.35, 0.08] }
    };
    d = { belt: 0.95, seams: [0.82, -0.3], handles: [0.05], mirror: [0.72, 1.0], frontBumper: [0.28, 0.48, 1.97, 1.64],
      rearBumper: [0.3, 0.5, -1.99, 1.66], frontPlate: [0, 0.4, 2.04], rearPlate: [0, 0.7, -2.04] };
    interior = { dashZ: 0.5, dashY: 0.84, seatZ: -0.2, seatY: 0.42, rearSeatZ: -1.05, track: 0.38 };
    spec = { height: 1.47, headlight: [0.6, 0.74], zFront: 1.95, tail: [0.66, 0.98], zRear: -2.03 };
    lampPair(P, 0.6, 0.74, 1.86, 0.32, 0.12, S.head, 'front', 0.2);
    lampPair(P, 0.7, 1.02, -1.97, 0.18, 0.24, S.tail, 'rear', 0.07);
    P.rbox(0.7, 0.14, 0.05, 0.04, [0, 0.55, 2.0], S.black);
  }
  carShell(P, cfg);
  if (cfg.glass) {
    const g = cfg.glass;
    for (const side of [-1, 1]) {
      // A-pillars along the windscreen, B-pillar, rear pillar
      pillar(P, cfg, side, g[g.length - 1][0] - 0.02, g[g.length - 1][1] + 0.02, g[g.length - 2][0] + 0.02, g[g.length - 2][1] - 0.01, 0.07);
      const bz = (g[g.length - 2][0] + g[1][0]) / 2 + (type === 'suv' ? 0.2 : 0.1);
      pillar(P, cfg, side, bz, g[0][1] + 0.02, bz, g[1][1] - 0.01, 0.09, S.black);
      pillar(P, cfg, side, g[0][0] + 0.06, g[0][1] + 0.02, g[1][0] + 0.06, g[1][1] - 0.01, type === 'suv' ? 0.16 : 0.12);
    }
  }
  carDetails(P, D, cfg, { ...d, plateIndex });
  carInterior(P, cfg, interior);
  const wheelOpts = type === 'van' ? { spokes: 6, rimSurf: { color: 0x8e9399, rough: 0.4, metal: 0.6 } } : { spokes: 5 };
  addWheels(group, fourWheels(track, axF, axR), R, type === 'suv' ? 0.25 : 0.21, wheelOpts, createVehicleMaterial({ uniforms }));
  return finish(group, P, D, {
    kind: `car_${type}`, type, length: cfg.L, width: cfg.W, wheelbase: axF - axR, wheelRadius: R,
    halfExtents: { hx: cfg.W / 2, hz: cfg.L / 2 }, colour, ...spec,
    driverSeat: { x: -interior.track, y: interior.seatY, z: interior.seatZ },
    povOffset: { x: -interior.track, y: interior.seatY + 0.78, z: interior.seatZ + 0.08 }, maxSteer: 0.58
  }, uniforms);
}

/** A (z, y) outline as a Shape for a plane that is then turned to face +x (side 1) or -x (side -1) */
function sidePoly(pts, side) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(-side * z, y) : s.moveTo(-side * z, y)));
  s.closePath();
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Red double-decker bus (generic modern two-door, 11.2 m × 2.52 m × 4.4 m)
// ---------------------------------------------------------------------------------------------------------------
export function doubleDecker({ route = '24', destination = 'Pimlico', uniforms = VEHICLE_UNIFORMS, colour = 0xc8102e, plateIndex = 3 } = {}) {
  const group = new THREE.Group();
  group.name = `Bus_${route}`;
  const P = new Parts(), D = new Parts(), X = new Parts();
  const L = 11.2, W = 2.52, H = 4.4, hw = W / 2, zf = 5.6, zr = -5.6, R = 0.5, axF = 3.05, axR = -2.85;
  const cfg = {
    L, W, paint: colour, sill: 0.3,
    arches: [{ z: axF, r: 0.6, cy: R + 0.02 }, { z: axR, r: 0.6, cy: R + 0.02 }],
    lowerTop: [[-5.56, 0.32], [-5.62, 0.5], [-5.62, 4.12], [-5.5, 4.36], [-4.8, 4.4], [5.0, 4.4], [5.45, 4.33], [5.58, 4.1],
      [5.6, 2.45], [5.64, 0.55], [5.58, 0.32]],
    glass: null, roof: null, tumble: { y0: 2.5, y1: 4.4, k: 0.025 }, plan: { zf, zr, f: [0.35, 0.06], r: [0.3, 0.05] }, bevel: 0.12,
    lowerSurf: { color: (x, y) => (y < 0.46 ? 0x1c1c1e : colour), rough: 0.32, metal: 0.12, paint: 1 }
  };
  carShell(P, cfg);
  const sx = (y, z) => deformedHalf(hw, y, z, cfg.tumble, cfg.plan);
  // side glazing bands with dark pillars; glass glows warm at night (class 3)
  const band = (side, z0, z1, y0, y1, pitch = 1.12) => {
    const x = side * (sx((y0 + y1) / 2, (z0 + z1) / 2) + 0.006);
    P.box(0.03, y1 - y0, z1 - z0, [x, (y0 + y1) / 2, (z0 + z1) / 2], S.litGlass);
    const n = Math.max(1, Math.round((z1 - z0) / pitch));
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n;
      P.box(0.04, y1 - y0 + 0.02, 0.07, [x + side * 0.006, (y0 + y1) / 2, z], S.black);
    }
    P.box(0.04, 0.04, z1 - z0 + 0.05, [x + side * 0.004, y1 + 0.02, (z0 + z1) / 2], S.black);
  };
  // nearside (+x, doors) and offside (-x)
  band(1, -5.0, -0.42, 1.15, 2.25);
  band(1, 1.12, 2.4, 1.15, 2.25);
  band(1, 3.62, 4.12, 1.15, 2.25, 0.6);
  band(-1, -5.0, 5.0, 1.15, 2.25);
  band(1, -5.15, 5.2, 2.72, 3.9);
  band(-1, -5.15, 5.2, 2.72, 3.9);
  // doors on the nearside: front (ahead of the front axle) and middle (between the axles)
  const door = (z0, z1) => {
    const x = sx(1.3, (z0 + z1) / 2) + 0.008;
    P.box(0.03, 2.05, z1 - z0, [x, 1.32, (z0 + z1) / 2], S.black);
    const lw = (z1 - z0) / 2 - 0.06;
    for (const k of [0, 1]) {
      const zc = z0 + 0.04 + lw / 2 + k * (lw + 0.04);
      P.box(0.03, 1.8, lw, [x + 0.012, 1.34, zc], S.litGlass);
      P.box(0.035, 0.05, lw, [x + 0.016, 0.95, zc], S.chrome);
    }
    P.box(0.04, 2.05, 0.02, [x + 0.02, 1.32, (z0 + z1) / 2], { color: 0xf5c400, rough: 0.4 });
  };
  door(4.25, 5.32);
  door(-0.35, 1.05);
  // front: lower windscreen, upper-deck windows, destination blind, lamps, bumper, mirrors
  P.box(2.3, 1.42, 0.04, [0, 1.66, 5.615], S.litGlass);
  P.box(2.34, 0.05, 0.05, [0, 2.39, 5.62], S.black);
  for (const side of [-1, 1]) P.box(1.08, 1.12, 0.04, [side * 0.58, 3.38, 5.6], S.litGlass);
  P.box(0.1, 1.16, 0.06, [0, 3.38, 5.61], S.black);
  P.box(2.1, 0.32, 0.05, [0, 2.6, 5.61], S.black);
  decal(X, [0, 0, 1024, 128], 2.0, 0.25, [0, 2.6, 5.64], FACE.front, { rough: 0.3, emit: 7 }, 1024, 256);
  decal(X, [0, 128, 256, 128], 0.42, 0.21, [sx(2.5, 3.9) + 0.03, 2.5, 3.9], FACE.left, { rough: 0.3, emit: 7 }, 1024, 256);
  decal(X, [0, 128, 256, 128], 0.5, 0.25, [0, 3.98, -5.65], FACE.rear, { rough: 0.3, emit: 7 }, 1024, 256);
  P.box(0.56, 0.3, 0.04, [0, 3.98, -5.635], S.black);
  for (const side of [-1, 1]) {
    P.rbox(0.34, 0.16, 0.06, 0.05, [side * 0.9, 0.62, 5.63], S.head);
    P.rbox(0.12, 0.08, 0.05, 0.03, [side * 1.12, 0.62, 5.63], S.amber);
    // mirrors on arms
    P.curve([[side * 1.1, 2.3, 5.4], [side * 1.45, 2.36, 5.62], [side * 1.48, 2.2, 5.9]], 0.025, S.black, 10, 6);
    P.rbox(0.08, 0.42, 0.2, 0.03, [side * 1.48, 1.98, 5.9], S.black);
  }
  P.rbox(2.42, 0.28, 0.12, 0.06, [0, 0.42, 5.6], S.black);
  // wipers
  for (const side of [-1, 1]) P.box(0.02, 0.9, 0.02, [side * 0.5, 1.4, 5.645], S.black, [0, 0, side * 0.3]);
  // rear: engine louvres, lamps, upper rear window, bumper
  P.box(1.9, 0.86, 0.04, [0, 3.38, -5.62], S.litGlass);
  P.box(1.6, 0.7, 0.03, [0, 1.0, -5.635], S.black);
  for (let i = 0; i < 8; i++) P.box(1.5, 0.03, 0.04, [0, 0.72 + i * 0.08, -5.65], { color: 0x3a3a3c, rough: 0.5 });
  for (const side of [-1, 1]) {
    P.rbox(0.18, 0.5, 0.05, 0.04, [side * 1.08, 0.95, -5.635], S.tail, [0, Math.PI, 0]);
    P.rbox(0.18, 0.12, 0.05, 0.03, [side * 1.08, 0.6, -5.635], S.amber, [0, Math.PI, 0]);
    P.rbox(0.12, 0.12, 0.05, 0.03, [side * 1.1, 4.15, -5.6], S.tail, [0, Math.PI, 0]);
  }
  P.rbox(2.42, 0.26, 0.12, 0.06, [0, 0.42, -5.6], S.black);
  // roof: slight darker band + air-con pod
  P.rbox(1.6, 0.06, 2.4, 0.03, [0, 4.42, -3.6], { color: 0x8a0c20, rough: 0.5 });
  decal(D, ATLAS.plateFront(plateIndex), 0.52, 0.114, [0, 0.42, 5.665], FACE.front);
  decal(D, ATLAS.plateRear(plateIndex), 0.52, 0.114, [0, 0.42, -5.665], FACE.rear);
  addWheels(group, [
    { name: 'wheel_FL', x: 1.03, z: axF, front: true },
    { name: 'wheel_FR', x: -1.03, z: axF, front: true },
    { name: 'wheel_RL', x: 0.98, z: axR },
    { name: 'wheel_RR', x: -0.98, z: axR }
  ], R, 0.36, { spokes: 8, rimRatio: 0.58, rimSurf: { color: 0x9aa0a6, rough: 0.4, metal: 0.6 } }, createVehicleMaterial({ uniforms }));
  return finish(group, P, D, {
    kind: 'doubleDecker', route, destination, length: L, width: W, height: H, wheelbase: axF - axR, wheelRadius: R,
    halfExtents: { hx: hw, hz: L / 2 }, headlight: [0.9, 0.62], zFront: 5.64, tail: [1.08, 0.95], zRear: -5.64,
    doors: { front: { z0: 4.25, z1: 5.32, side: 1 }, middle: { z0: -0.35, z1: 1.05, side: 1 } },
    driverSeat: { x: -0.7, y: 1.0, z: 4.9 }, povOffset: { x: -0.7, y: 2.2, z: 4.9 }
  }, uniforms, getBlindTexture(route, destination), X);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Public hire bike (sturdy step-through, red & grey, front carrier with bungee, enclosed chain, dynamo lamps)
// ---------------------------------------------------------------------------------------------------------------
export function hireBike({ uniforms = VEHICLE_UNIFORMS, frame = 0x9aa0a6, accent = 0xc8102e } = {}) {
  const group = new THREE.Group();
  group.name = 'HireBike';
  const P = new Parts();
  const R = 0.335, wb = 1.12, zF = 0.56, zR = -0.56;
  const F = { color: frame, rough: 0.35, metal: 0.3 };
  const A = { color: accent, rough: 0.32, metal: 0.15, paint: 1 };
  const BB = [0, 0.3, -0.1];
  const headTop = [0, 0.98, 0.37], headBot = [0, 0.8, 0.42];
  // big curved step-through down tube (twin tubes) + head tube + seat tube + stays
  for (const dx of [-0.035, 0.035]) P.curve([[dx, ...headBot.slice(1)], [dx, 0.5, 0.3], [dx, 0.33, 0.08], [dx, BB[1] + 0.02, BB[2] + 0.04]], 0.026, F, 18, 8);
  P.tube(headBot, headTop, 0.034, F, 10);
  P.tube([0, 0.3, -0.1], [0, 0.86, -0.28], 0.03, F, 10);
  P.tube([0, 0.84, -0.27], [0, 0.98, -0.31], 0.017, S.black, 8);
  for (const s of [-1, 1]) {
    P.tube([s * 0.04, BB[1], BB[2]], [s * 0.06, R, zR], 0.016, F, 6);
    P.tube([s * 0.03, 0.78, -0.25], [s * 0.06, R, zR], 0.015, F, 6);
    // fork legs
    P.tube([s * 0.04, headBot[1], headBot[2]], [s * 0.05, R, zF], 0.02, F, 8);
  }
  // stem + swept-back handlebar with grips, bell, brake levers
  P.tube(headTop, [0, 1.08, 0.33], 0.022, S.black, 8);
  P.curve([[-0.29, 1.1, 0.2], [-0.2, 1.09, 0.3], [0, 1.08, 0.34], [0.2, 1.09, 0.3], [0.29, 1.1, 0.2]], 0.014, S.chrome, 16, 6);
  for (const s of [-1, 1]) {
    P.tube([s * 0.22, 1.1, 0.235], [s * 0.31, 1.1, 0.19], 0.02, S.rubber, 8);
    P.box(0.1, 0.015, 0.02, [s * 0.22, 1.1, 0.27], S.black, [0, s * 0.4, 0]);
  }
  // front carrier (frame-mounted, does not steer) with a black bungee
  P.box(0.34, 0.025, 0.3, [0, 0.98, 0.62], A);
  for (const s of [-1, 1]) {
    P.box(0.02, 0.06, 0.3, [s * 0.17, 1.01, 0.62], A);
    P.tube([s * 0.15, 0.97, 0.5], [s * 0.04, 0.9, 0.4], 0.012, A, 6);
  }
  P.box(0.34, 0.06, 0.02, [0, 1.01, 0.77], A);
  P.curve([[-0.15, 1.0, 0.75], [0, 1.02, 0.6], [0.15, 1.0, 0.5]], 0.008, S.black, 8, 5);
  P.rbox(0.1, 0.07, 0.06, 0.02, [0, 0.92, 0.79], S.black);
  P.cyl(0.03, 0.02, 'z', [0, 0.92, 0.825], S.head, 12);
  // mudguards (red), enclosed chain guard (grey), skirt guard
  const guard = (z, a0, a1) => {
    const t = new THREE.TorusGeometry(R + 0.04, 0.035, 4, 16, a1 - a0);
    t.rotateZ(a0);
    t.rotateY(Math.PI / 2);
    t.scale(1.6, 1, 1);
    P.add(t, { pos: [0, R, z], surf: A });
  };
  guard(zF, 0.35, 2.4);
  guard(zR, -0.25, 2.0);
  P.rbox(0.05, 0.13, 0.6, 0.05, [0.075, 0.32, -0.33], { color: 0x6c7177, rough: 0.5 }, [0.04, 0, 0]);
  P.cyl(0.11, 0.04, 'x', [0.075, BB[1], BB[2]], { color: 0x6c7177, rough: 0.5 }, 16);
  P.rbox(0.05, 0.06, 0.04, 0.02, [0, 0.62, -0.92], S.tail);
  // saddle, kickstand, dock pin under the carrier
  P.add(new THREE.CapsuleGeometry(0.075, 0.14, 4, 10), { pos: [0, 1.0, -0.3], rot: [Math.PI / 2, 0, 0], scale: [1.25, 1, 0.45], surf: S.black });
  P.tube([0.05, 0.28, -0.2], [0.14, 0.02, -0.28], 0.012, S.black, 6);
  P.box(0.06, 0.08, 0.06, [0, 0.82, 0.58], S.black);
  const material = createVehicleMaterial({ uniforms });
  // cranks + pedals: a separate rotating part (bottom bracket pivot)
  const cranks = new THREE.Group();
  cranks.name = 'cranks';
  cranks.position.set(...BB);
  const C = new Parts();
  const crankLength = 0.17;
  for (const s of [1, -1]) {
    const dir = s > 0 ? -1 : 1;
    C.box(0.018, crankLength, 0.03, [s * 0.1, dir * crankLength * 0.5, 0], S.black);
    C.box(0.1, 0.02, 0.075, [s * 0.14, dir * crankLength, 0], S.rubber);
  }
  C.cyl(0.09, 0.012, 'x', [0.105, 0, 0], S.chrome, 18);
  cranks.add(C.mesh(material, 'crankMesh'));
  group.add(cranks);
  addWheels(group, [{ name: 'wheel_F', x: 0, z: zF, front: true }, { name: 'wheel_R', x: 0, z: zR }], R, 0.05,
    { open: true, rimRatio: 0.86, rimSurf: { color: 0x9aa0a6, rough: 0.35, metal: 0.6 } }, material);
  // real bikes have no big hub: add a few thin spokes to each wheel mesh
  const spokeGeo = (() => {
    const S2 = new Parts();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      S2.box(0.004, R * 0.84, 0.004, [0, Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42], S.chrome, [a, 0, 0]);
    }
    S2.cyl(0.03, 0.09, 'x', [0, 0, 0], { color: 0x9aa0a6, rough: 0.35, metal: 0.6 }, 10);
    return S2.mesh(material, 'spokes');
  })();
  for (const w of group.userData.wheels) w.spin.add(spokeGeo.clone());
  // the handlebar steers with the front wheel: bars live in the body (the carrier is frame-mounted), good enough
  group.userData.animated = [cranks];
  group.userData.cranks = cranks;
  return finish(group, P, null, {
    kind: 'hireBike', length: 1.85, width: 0.62, height: 1.12, wheelbase: wb, wheelRadius: R, halfExtents: { hx: 0.32, hz: 0.92 },
    headlight: [0, 0.92], zFront: 0.83, tail: [0, 0.62], zRear: -0.94,
    bikeFrame: { seat: { x: 0, y: 1.02, z: -0.3 }, bars: { x: 0, y: 1.1, z: 0.24 }, gripHalf: 0.27, bracket: { x: BB[0], y: BB[1], z: BB[2] }, crankLength },
    povOffset: { x: 0, y: 1.62, z: -0.12 }
  }, uniforms);
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Police helicopter (EC145-ish twin: bubble nose, clamshell rear, T-tail with end plates, skids, Nightsun)
// ---------------------------------------------------------------------------------------------------------------
export function policeHeli({ uniforms = VEHICLE_UNIFORMS } = {}) {
  const group = new THREE.Group();
  group.name = 'PoliceHeli';
  const P = new Parts(), D = new Parts();
  const NAVY = 0x16244f, YEL = 0xf3d21b;
  const livery = (x, y, z) => {
    if (z > 2.62 && y > 0.98) return S.glass;
    if (z > 0.45 && z < 2.42 && y > 1.28 && y < 2.0 && Math.abs(x) > 0.55) return S.glass;
    if (z > -0.95 && z < -0.15 && y > 1.32 && y < 1.92 && Math.abs(x) > 0.5) return S.glass;
    return y < 1.16 ? { color: NAVY, rough: 0.3, metal: 0.2, paint: 1 } : { color: YEL, rough: 0.3, metal: 0.1, paint: 1 };
  };
  const secs = [
    { z: -2.05, cy: 1.8, hw: 0.22, ht: 0.24, hb: 0.22 },
    { z: -1.75, cy: 1.75, hw: 0.32, ht: 0.35, hb: 0.3 },
    { z: -1.35, cy: 1.6, hw: 0.55, ht: 0.55, hb: 0.52 },
    { z: -0.9, cy: 1.45, hw: 0.78, ht: 0.72, hb: 0.74 },
    { z: -0.4, cy: 1.38, hw: 0.88, ht: 0.84, hb: 0.84 }
  ];
  for (let z = 0; z <= 2.6; z += 0.325) secs.push({ z, cy: 1.37, hw: 0.9, ht: 0.86, hb: 0.86 });
  secs.push(
    { z: 2.95, cy: 1.37, hw: 0.89, ht: 0.85, hb: 0.85 },
    { z: 3.3, cy: 1.36, hw: 0.85, ht: 0.82, hb: 0.83 },
    { z: 3.6, cy: 1.35, hw: 0.79, ht: 0.75, hb: 0.79 },
    { z: 3.85, cy: 1.33, hw: 0.7, ht: 0.67, hb: 0.73 },
    { z: 4.07, cy: 1.3, hw: 0.58, ht: 0.56, hb: 0.64 },
    { z: 4.25, cy: 1.26, hw: 0.43, ht: 0.42, hb: 0.52 },
    { z: 4.38, cy: 1.22, hw: 0.26, ht: 0.26, hb: 0.36 },
    { z: 4.46, cy: 1.2, hw: 0.06, ht: 0.06, hb: 0.08 }
  );
  P.add(loft(secs, 48, { eTop: 2.4, eBot: 2.8 }), { surf: { color: livery }, quads: true });
  // tail boom
  const boom = [];
  for (let i = 6; i >= 0; i--) {
    const t = i / 6;
    boom.push({ z: -1.9 - t * 4.3, cy: 1.8 + t * 0.2, hw: 0.23 - t * 0.1, ht: 0.25 - t * 0.11, hb: 0.23 - t * 0.1 });
  }
  P.add(loft(boom, 16, { eTop: 2.2, eBot: 2.2 }), { surf: { color: YEL, rough: 0.3, paint: 1 } });
  // engine cowling + mast
  const cowl = [];
  for (const [z, s] of [[-1.5, 0.3], [-1.2, 0.85], [-0.6, 1], [0.6, 1], [1.2, 0.85], [1.55, 0.35]]) cowl.push({ z, cy: 2.28, hw: 0.56 * s, ht: 0.32 * s, hb: 0.25 });
  P.add(loft(cowl, 24, { eTop: 3, eBot: 3 }), { surf: { color: YEL, rough: 0.35, paint: 1 } });
  for (const s of [-1, 1]) {
    P.box(0.02, 0.2, 0.6, [s * 0.5, 2.3, -0.7], S.black);
    P.cyl(0.1, 0.2, 'z', [s * 0.25, 2.3, -1.55], S.black, 10);
  }
  P.cyl(0.11, 0.42, 'y', [0, 2.75, 0.2], S.darkRim, 12);
  // horizontal stabiliser with end plates, swept fin, tail rotor guard
  P.rbox(2.05, 0.06, 0.42, 0.03, [0, 1.98, -4.75], { color: YEL, rough: 0.35, paint: 1 });
  for (const s of [-1, 1]) P.rbox(0.05, 0.55, 0.42, 0.03, [s * 1.03, 2.02, -4.78], { color: NAVY, rough: 0.35, paint: 1 });
  {
    const fin = new THREE.Shape();
    [[-5.55, 1.9], [-6.25, 1.95], [-6.55, 3.05], [-6.25, 3.1], [-5.85, 2.25]].forEach(([z, y], i) => (i ? fin.lineTo(-z, y) : fin.moveTo(-z, y)));
    const g = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: -0.02, bevelSegments: 1 });
    g.rotateY(Math.PI / 2);
    g.translate(-0.04, 0, 0);
    P.add(g, { surf: { color: NAVY, rough: 0.35, paint: 1 } });
  }
  // skids
  for (const s of [-1, 1]) {
    P.curve([[s * 1.0, 0.06, -1.35], [s * 1.0, 0.05, 1.0], [s * 1.0, 0.06, 2.2], [s * 1.0, 0.16, 2.55], [s * 0.98, 0.3, 2.68]], 0.04, S.black, 18, 8);
    for (const z of [1.55, -0.65]) P.curve([[s * 1.0, 0.06, z], [s * 0.92, 0.32, z], [s * 0.6, 0.58, z]], 0.035, S.black, 8, 6);
  }
  // nav lights: red port (+x), green starboard (-x), white tail; blue beacons top & belly (class 5)
  P.sphere(0.05, [1.06, 2.1, -4.78], { color: 0xff2020, emit: 6 });
  P.sphere(0.05, [-1.06, 2.1, -4.78], { color: 0x20ff50, emit: 6 });
  P.sphere(0.05, [0, 3.1, -6.3], { color: 0xffffff, emit: 1 });
  P.rbox(0.36, 0.08, 0.14, 0.03, [0, 2.62, -1.15], { color: 0x2550ff, rough: 0.2, emit: 5 });
  P.rbox(0.3, 0.07, 0.12, 0.03, [0, 0.5, -0.6], { color: 0x2550ff, rough: 0.2, emit: 5 });
  // FLIR camera ball under the nose
  P.cyl(0.05, 0.2, 'y', [0.35, 0.55, 3.55], S.black, 8);
  P.sphere(0.2, [0.35, 0.38, 3.55], { color: 0xdedede, rough: 0.4 });
  P.cyl(0.08, 0.05, 'z', [0.35, 0.38, 3.74], S.glass, 12);
  // livery decals: Battenburg band, POLICE on the sides and the belly, registration on the boom
  for (const side of [-1, 1]) {
    decal(D, ATLAS.battenburg, 2.75, 0.24, [side * 0.9, 1.13, 1.0], [0, side * Math.PI / 2, 0], { rough: 0.35 }, ATLAS_W, ATLAS_H);
    const po = decal(D, ATLAS.policeWhite, 2.1, 0.26, [0, 0, 0], [0, 0, 0], { rough: 0.35 });
    po.applyMatrix4(new THREE.Matrix4().makeRotationX(0.6));
    po.applyMatrix4(new THREE.Matrix4().makeRotationY(side * Math.PI / 2));
    po.translate(side * 0.8, 0.84, 1.05);
    decal(D, ATLAS.heliReg, 1.0, 0.13, [side * 0.165, 1.9, -3.8], [0, side * Math.PI / 2, 0]);
    decal(D, ATLAS.policeNavy, 1.3, 0.17, [side * 0.575, 2.3, -0.05], [0, side * Math.PI / 2, 0]);
  }
  decal(D, ATLAS.policeWhite, 2.4, 0.5, [0, 0.505, 1.2], [Math.PI / 2, 0, Math.PI / 2]);
  // searchlight (Nightsun) on a gimbal under the right side of the nose
  const material = createVehicleMaterial({ uniforms });
  const searchlight = new THREE.Group();
  searchlight.name = 'searchlight';
  searchlight.position.set(-0.62, 0.42, 3.0);
  {
    const SL = new Parts();
    SL.box(0.05, 0.2, 0.05, [0, 0.1, 0], S.black);
    SL.cyl(0.13, 0.32, 'z', [0, -0.05, 0.02], S.darkRim, 14);
    SL.cyl(0.11, 0.02, 'z', [0, -0.05, 0.185], S.head, 14);
    searchlight.add(SL.mesh(material, 'searchlightMesh'));
  }
  searchlight.rotation.x = 0.5;
  group.add(searchlight);
  // main rotor (4 blades) and tail rotor (2 blades)
  const mainRotor = new THREE.Group();
  mainRotor.name = 'mainRotor';
  mainRotor.position.set(0, 3.05, 0.2);
  {
    const MR = new Parts();
    MR.cyl(0.24, 0.16, 'y', [0, 0, 0], S.darkRim, 14);
    MR.sphere(0.14, [0, 0.12, 0], S.darkRim, [1, 0.7, 1]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const blade = new THREE.BoxGeometry(5.3, 0.045, 0.3);
      blade.translate(2.85, 0, 0);
      const tip = new THREE.BoxGeometry(0.3, 0.05, 0.31);
      tip.translate(5.35, 0, 0);
      MR.add(blade, { rot: [0.05, a, 0], order: 'YXZ', surf: { color: 0x26292d, rough: 0.5 } });
      MR.add(tip, { rot: [0.05, a, 0], order: 'YXZ', surf: { color: YEL, rough: 0.4 } });
    }
    mainRotor.add(MR.mesh(material, 'mainRotorMesh'));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.5, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicNodeMaterial({ color: 0x2a2e33, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
    disc.name = 'rotorDisc';
    disc.userData.noInstance = true;
    mainRotor.add(disc);
  }
  group.add(mainRotor);
  const tailRotor = new THREE.Group();
  tailRotor.name = 'tailRotor';
  tailRotor.position.set(0.14, 2.45, -6.2);
  {
    const TR = new Parts();
    TR.cyl(0.08, 0.14, 'x', [0, 0, 0], S.darkRim, 10);
    for (const a of [0, Math.PI]) {
      const b = new THREE.BoxGeometry(0.02, 0.95, 0.14);
      b.translate(0, 0.5, 0);
      TR.add(b, { rot: [a, 0, 0], surf: { color: 0x26292d, rough: 0.5 } });
    }
    tailRotor.add(TR.mesh(material, 'tailRotorMesh'));
  }
  group.add(tailRotor);
  group.userData.animated = [mainRotor, tailRotor, searchlight];
  group.userData.mainRotor = mainRotor;
  group.userData.tailRotor = tailRotor;
  group.userData.searchlight = searchlight;
  group.userData.wheels = [];
  return finish(group, P, D, {
    kind: 'policeHeli', length: 13.0, width: 2.1, height: 3.5, rotorRadius: 5.5, halfExtents: { hx: 1.1, hz: 5.2 },
    headlight: [0.62, 0.37], zFront: 3.2, tail: [0, 3.1], zRear: -6.3,
    searchlight: { x: -0.62, y: 0.37, z: 3.2 }, povOffset: { x: -0.4, y: 1.75, z: 3.0 }
  }, uniforms);
}

// ---------------------------------------------------------------------------------------------------------------
// 7. River boat (Thames commuter catamaran, ~27 m × 8 m; origin = waterline, midships)
// ---------------------------------------------------------------------------------------------------------------
export function riverBoat({ uniforms = VEHICLE_UNIFORMS, hull = 0x1c2f55, cabin = 0xeef0f0 } = {}) {
  const group = new THREE.Group();
  group.name = 'RiverBoat';
  const P = new Parts(), D = new Parts();
  const hullSurf = (x, y) => (y < -0.06 ? { color: 0x17181b, rough: 0.6 } : y < 0.12 ? { color: 0xf0f0f0, rough: 0.4 } : { color: hull, rough: 0.3, metal: 0.15, paint: 1 });
  const hs = [
    [-13.4, 0.95, 0.9, 1.0], [-12.6, 1.0, 1.1, 1.0], [-8, 1.0, 1.24, 1.0], [0, 1.0, 1.28, 1.0], [5, 0.98, 1.25, 1.0], [8.5, 0.92, 1.16, 1.0],
    [10.5, 0.76, 1.0, 1.02], [11.8, 0.56, 0.75, 1.04], [12.7, 0.34, 0.45, 1.06], [13.3, 0.14, 0.18, 1.08], [13.55, 0.04, 0.05, 1.08]
  ];
  for (const s of [-1, 1]) {
    const secs = hs.map(([z, hw, hb, ht]) => ({ z, cx: s * 2.9, cy: 0.2, hw, ht, hb }));
    P.add(loft(secs, 28, { eTop: 4, eBot: 1.7 }), { surf: { color: hullSurf }, quads: true });
    // rubbing strake / fender
    P.box(0.12, 0.14, 22.5, [s * 3.92, 1.05, -1.5], S.black);
  }
  // bridge deck between the hulls
  P.add(planExtrude([[-3.95, -13.35], [3.95, -13.35], [3.95, 10.5], [3.5, 12.9], [2.3, 12.9], [1.3, 11.4], [-1.3, 11.4], [-2.3, 12.9],
    [-3.5, 12.9], [-3.95, 10.5]], 0.95, 1.5, 0.04), { surf: { color: hull, rough: 0.35, paint: 1 } });
  P.add(planExtrude([[-3.9, -13.3], [3.9, -13.3], [3.9, 10.45], [3.45, 12.8], [2.35, 12.8], [1.3, 11.35], [-1.3, 11.35], [-2.35, 12.8],
    [-3.45, 12.8], [-3.9, 10.45]], 1.5, 1.54, 0.0), { surf: { color: 0x7d8288, rough: 0.8 } });
  // main cabin: white lower panels, lit wrap-around glazing, white roof
  const cabinPlan = (inset) => {
    const pts = [[-3.7 + inset, -8.8 + inset], [3.7 - inset, -8.8 + inset], [3.7 - inset, 5.8]];
    for (let i = 1; i < 12; i++) {
      const a = (i / 12) * Math.PI;
      pts.push([(3.7 - inset) * Math.cos(a), 5.8 + (3.3 - inset) * Math.sin(a)]);
    }
    pts.push([-3.7 + inset, 5.8]);
    return pts;
  };
  P.add(planExtrude(cabinPlan(0), 1.54, 2.3, 0.03), { surf: { color: cabin, rough: 0.35 } });
  P.add(planExtrude(cabinPlan(0.06), 2.3, 3.45, 0.0), { surf: S.litGlass });
  P.add(planExtrude(cabinPlan(-0.08), 3.45, 3.75, 0.05), { surf: { color: cabin, rough: 0.35 } });
  // window mullions around the cabin sides
  for (let z = -8.4; z <= 5.6; z += 1.4) for (const s of [-1, 1]) P.box(0.06, 1.15, 0.08, [s * 3.65, 2.88, z], { color: hull, rough: 0.4 });
  // wheelhouse on the roof (forward)
  const whPlan = (inset) => {
    const pts = [[-1.9 + inset, 4.2 + inset], [1.9 - inset, 4.2 + inset], [1.9 - inset, 6.8]];
    for (let i = 1; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      pts.push([(1.9 - inset) * Math.cos(a), 6.8 + (1.4 - inset) * Math.sin(a)]);
    }
    pts.push([-1.9 + inset, 6.8]);
    return pts;
  };
  P.add(planExtrude(whPlan(0), 3.75, 4.2, 0.03), { surf: { color: hull, rough: 0.35, paint: 1 } });
  P.add(planExtrude(whPlan(0.05), 4.2, 4.95, 0.0), { surf: S.glass });
  P.add(planExtrude(whPlan(-0.12), 4.95, 5.15, 0.04), { surf: { color: cabin, rough: 0.35 } });
  // mast with nav lights + radar, roof rails, aft deck railings, lifebuoys, bollards
  P.tube([0, 5.15, 5.4], [0, 6.6, 5.2], 0.05, { color: 0xd8d8d8, rough: 0.4 }, 8);
  P.box(1.4, 0.06, 0.18, [0, 6.2, 5.25], { color: 0x2c2c2c, rough: 0.5 });
  P.sphere(0.07, [0, 6.65, 5.2], { color: 0xffffff, emit: 1 });
  P.sphere(0.06, [1.92, 4.7, 6.6], { color: 0xff2020, emit: 6 });
  P.sphere(0.06, [-1.92, 4.7, 6.6], { color: 0x20ff40, emit: 6 });
  P.sphere(0.06, [0, 3.85, -8.7], { color: 0xffffff, emit: 1 });
  for (const s of [-1, 1]) {
    P.box(0.04, 0.04, 12.5, [s * 3.5, 4.4, -1.8], { color: 0xd0d0d0, rough: 0.3, metal: 0.6 });
    for (let z = -8; z <= 4.3; z += 2.05) P.box(0.03, 0.65, 0.03, [s * 3.5, 4.08, z], { color: 0xd0d0d0, rough: 0.3, metal: 0.6 });
    // aft open deck rails
    P.box(0.04, 0.04, 4.4, [s * 3.85, 2.55, -11.1], { color: 0xd0d0d0, rough: 0.3, metal: 0.6 });
    for (let z = -13.2; z <= -8.9; z += 1.08) P.box(0.03, 1.0, 0.03, [s * 3.85, 2.05, z], { color: 0xd0d0d0, rough: 0.3, metal: 0.6 });
    const ring = new THREE.TorusGeometry(0.3, 0.07, 6, 16);
    P.add(ring, { pos: [s * 3.75, 2.6, -2.0], rot: [0, Math.PI / 2, 0], surf: { color: 0xff6a10, rough: 0.5 } });
    P.cyl(0.09, 0.3, 'y', [s * 3.6, 1.7, -12.6], S.black, 8);
    P.cyl(0.09, 0.3, 'y', [s * 3.2, 1.7, 11.0], S.black, 8);
    decal(D, ATLAS.riverBus, 6.4, 0.8, [s * 3.92, 0.68, -1.0], [0, s * Math.PI / 2, 0]);
  }
  P.box(7.7, 0.04, 0.04, [0, 2.55, -13.25], { color: 0xd0d0d0, rough: 0.3, metal: 0.6 });
  // seating visible through the aft door
  for (let z = -7.8; z <= 4.5; z += 1.0) for (const x of [-2.6, -1.6, 1.6, 2.6]) P.box(0.85, 0.5, 0.45, [x, 1.85, z], { color: 0x2a3b6b, rough: 0.8 });
  // waterjet ducts at the transoms
  for (const s of [-1, 1]) P.cyl(0.32, 0.4, 'z', [s * 2.9, -0.35, -13.55], S.black, 12);
  group.userData.wheels = [];
  return finish(group, P, D, {
    kind: 'riverBoat', length: 27.1, width: 7.9, height: 6.7, draft: 1.1, halfExtents: { hx: 3.95, hz: 13.5 },
    headlight: [1.5, 3.8], zFront: 9.0, tail: [0, 3.85], zRear: -8.8,
    sprayPoints: [{ x: 2.9, z: -13.5 }, { x: -2.9, z: -13.5 }, { x: 2.9, z: 12.6, bow: true }, { x: -2.9, z: 12.6, bow: true }],
    povOffset: { x: -0.6, y: 4.75, z: 6.4 }
  }, uniforms);
}

// ---------------------------------------------------------------------------------------------------------------
// Registry + instancing helpers
// ---------------------------------------------------------------------------------------------------------------
export const VEHICLE_FACTORIES = {
  blackCab,
  rideCar,
  doubleDecker,
  hireBike,
  policeHeli,
  riverBoat,
  genericCar,
  hatch: (o = {}) => genericCar({ ...o, type: 'hatch' }),
  saloon: (o = {}) => genericCar({ ...o, type: 'saloon' }),
  suv: (o = {}) => genericCar({ ...o, type: 'suv' }),
  van: (o = {}) => genericCar({ ...o, type: 'van' })
};

/**
 * Flatten a model for InstancedMesh use. Returns
 * { parts: [{ name, geometry, material }],               // static body + decals, model-local, merged per material
 *   wheels: { left, right, material, placements:[{x,y,z,side,front,radius}] } | null, // wheel geometry per side
 *   animated: [Object3D], spec }
 * `instancePaint: true` swaps the body material for one reading a per-instance vec3 `aPaint` attribute on
 * paint-masked vertices (add it with geometry.setAttribute('aPaint', new THREE.InstancedBufferAttribute(rgb, 3))).
 */
export function getInstanceParts(model, { instancePaint = false } = {}) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const skip = new Set([...(model.userData.animated || []), ...(model.userData.wheels || []).map((w) => w.group)]);
  const byMat = new Map();
  model.traverse((o) => {
    if (!o.isMesh || o.userData.noInstance) return;
    for (let p = o; p && p !== model; p = p.parent) if (skip.has(p)) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, { name: o.name, geos: [] });
    byMat.get(o.material).geos.push(g);
  });
  const uniforms = model.userData.uniforms || VEHICLE_UNIFORMS;
  const parts = [...byMat].map(([material, { name, geos }]) => {
    const geometry = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    geometry.computeBoundingSphere();
    const mat = instancePaint && name === 'body' ? createVehicleMaterial({ uniforms, instancePaint: true }) : material;
    return { name, geometry, material: mat };
  });
  const ws = model.userData.wheels || [];
  const wheels = ws.length
    ? { ...model.userData.wheelGeo, material: ws[0].spin.material, placements: ws.map((w) => ({ x: w.x, y: w.y, z: w.z, side: w.side, front: w.front, radius: w.radius })) }
    : null;
  return { parts, wheels, animated: model.userData.animated || [], spec: model.userData.spec };
}

/** Spin a model's wheels by `distance` metres travelled and steer the front ones */
export function spinWheels(model, distance, steer = 0) {
  for (const w of model.userData.wheels || []) {
    w.spin.rotation.x += distance / w.radius;
    if (w.front) w.group.rotation.y = steer;
  }
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
