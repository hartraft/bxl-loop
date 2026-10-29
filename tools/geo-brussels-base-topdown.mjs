// tools/geo-brussels-base-topdown.mjs — dependency-free top-down PNG of the baked geodata (visual sanity check).
// usage: node tools/geo-brussels-base-topdown.mjs [out.png] [metresPerPixel=4] [centreX centreZ widthM heightM]
// env MARKS=file.json: [[x, z, 0xRRGGBB, radiusM], …] rings drawn on top (tools/geo-brussels-base-roadcheck.mjs uses it);
// tunnels are drawn as dashed dark lines, GEO.passages (if any) in orange.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { GEO } from '../js/bxl-geodata.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const [outArg, mppArg, cx, cz, wm, hm] = process.argv.slice(2);
const OUT = outArg || path.join(ROOT, 'tools/out/bxl-topdown.png');
const MPP = Number(mppArg) || 4;
const B = GEO.bounds;
const view = cx !== undefined
  ? { minX: +cx - +wm / 2, maxX: +cx + +wm / 2, minZ: +cz - +hm / 2, maxZ: +cz + +hm / 2 }
  : { minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ };
const W = Math.ceil((view.maxX - view.minX) / MPP), H = Math.ceil((view.maxZ - view.minZ) / MPP);
const img = new Uint8Array(W * H * 3);
const px = (x) => (x - view.minX) / MPP, pz = (z) => (z - view.minZ) / MPP;

function fill(rings, rgb, alpha = 1) {
  let zmin = Infinity, zmax = -Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i += 2) { const y = pz(r[i]); if (y < zmin) zmin = y; if (y > zmax) zmax = y; }
  const r0 = Math.max(0, Math.floor(zmin)), r1 = Math.min(H - 1, Math.ceil(zmax));
  if (r1 < r0) return;
  const rows = Array.from({ length: r1 - r0 + 1 }, () => []);
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = px(r[i * 2]), y0 = pz(r[i * 2 + 1]), x1 = px(r[j * 2]), y1 = pz(r[j * 2 + 1]);
      if (y0 === y1) continue;
      const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
      for (let row = Math.max(r0, Math.ceil(ya - 0.5)); row <= Math.min(r1, Math.floor(yb - 0.5)); row++) {
        const yc = row + 0.5;
        if (yc < ya || yc >= yb) continue;
        rows[row - r0].push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
  }
  for (let k = 0; k < rows.length; k++) {
    const xs = rows[k].sort((a, b) => a - b), row = r0 + k;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let c = Math.max(0, Math.ceil(xs[i] - 0.5)); c <= Math.min(W - 1, Math.floor(xs[i + 1] - 0.5)); c++) {
        const o = (row * W + c) * 3;
        img[o] = img[o] * (1 - alpha) + rgb[0] * alpha; img[o + 1] = img[o + 1] * (1 - alpha) + rgb[1] * alpha; img[o + 2] = img[o + 2] * (1 - alpha) + rgb[2] * alpha;
      }
    }
  }
}
function line(pts, width, rgb) {
  const hw = Math.max(width, MPP * 0.8) / 2;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i], z0 = pts[i + 1], x1 = pts[i + 2], z1 = pts[i + 3];
    const L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = (-(z1 - z0) / L) * hw, nz = ((x1 - x0) / L) * hw;
    const ex = ((x1 - x0) / L) * hw * 0.5, ez = ((z1 - z0) / L) * hw * 0.5;
    fill([[x0 + nx - ex, z0 + nz - ez, x1 + nx + ex, z1 + nz + ez, x1 - nx + ex, z1 - nz + ez, x0 - nx - ex, z0 - nz - ez]], rgb);
  }
}
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

img.fill(226);
for (let i = 0; i < img.length; i += 3) { img[i] = 230; img[i + 1] = 226; img[i + 2] = 216; }
const PARK = { park: 0xa8cf8e, garden: 0xb5d69c, grass: 0xbddca5, pitch: 0x9fcf9a, wood: 0x86b878, cemetery: 0xaac79e, square: 0x9ccc86, playground: 0xc9dca0 };
for (const p of GEO.parks) fill([p.pts, ...p.holes], hex(PARK[p.kind] || 0xa8cf8e));
for (const p of GEO.plazas) fill([p.pts], hex(0xeadfca));
for (const w of GEO.water) fill([w.pts, ...w.holes], hex(w.kind === 'river' ? 0x6f9fd0 : w.kind === 'fountain' ? 0x9fd0f0 : 0x7fb0dd));
for (const r of GEO.rail) line(r.pts, 3, hex(r.bridge ? 0x604040 : 0x707070));
const ORDER = ['footway', 'steps', 'cycleway', 'pedestrian', 'service', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
const RC = { footway: 0xf6f3ee, steps: 0xf0e0d0, cycleway: 0xe8f0f8, pedestrian: 0xf8f4ea, trunk: 0xffe6a0, primary: 0xfff0c0, motorway: 0xffd090 };
for (const k of ORDER) for (const r of GEO.roads) if (r.kind === k && !r.tunnel) line(r.pts, r.w, hex(r.bridge && r.deck ? 0xffd0d0 : RC[k] || 0xffffff));
const b = GEO.buildings;
for (let i = 0; i < b.count; i++) {
  const ring = b.xz.subarray(b.ringStart[i] * 2, b.ringStart[i + 1] * 2);
  const h = b.height[i];
  const g = Math.max(70, 175 - h * 1.2);
  fill([ring], b.landmark[i] ? [220, 40, 160] : b.kind[i] === 9 ? [90, 120, 150] : [g, g, g * 0.98]);
}
for (const br of GEO.bridges) if (br.deckY > 0) fill([br.pts], [255, 200, 60], 0.35);
// tunnels (not drawn in the game): dashed dark lines; building passages: orange
for (const r of GEO.roads) if (r.tunnel && !['footway', 'cycleway', 'steps'].includes(r.kind)) {
  const p = r.pts;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]), n = Math.max(1, Math.floor(L / 6));
    for (let k = 0; k < n; k += 2) { const a = k / n, c = Math.min(1, (k + 1) / n); line([p[i] + (p[i + 2] - p[i]) * a, p[i + 1] + (p[i + 3] - p[i + 1]) * a, p[i] + (p[i + 2] - p[i]) * c, p[i + 1] + (p[i + 3] - p[i + 1]) * c], 1.5, [40, 40, 90]); }
  }
}
for (const ps of GEO.passages || []) line(ps.pts, Math.max(1.5, ps.w * 0.5), [255, 140, 0]);
if (process.env.MARKS) {
  for (const [x, z, col, rad] of JSON.parse(fs.readFileSync(process.env.MARKS, 'utf8'))) {
    const R = rad || 4, N = 24, c = hex(col);
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      line([x + Math.cos(a0) * R, z + Math.sin(a0) * R, x + Math.cos(a1) * R, z + Math.sin(a1) * R], Math.max(0.6, MPP * 1.2), c);
    }
  }
}
for (const z of GEO.landmarkZones) for (let i = 0; i < z.pts.length; i += 2) { // zone outlines
  const n = z.pts.length, j = (i + 2) % n;
  line([z.pts[i], z.pts[i + 1], z.pts[j], z.pts[j + 1]], MPP * 1.5, [255, 0, 255]);
}

// ---- PNG ------------------------------------------------------------------------------------------------------------
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const v of buf) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} ${W}x${H} (${(png.length / 1e6).toFixed(1)} MB)`);
