// tools/geo-brussels-base-roadcheck.mjs — finds drawn roads that "lead nowhere" in the baked geodata and categorises them.
// usage: node tools/geo-brussels-base-roadcheck.mjs [--crops N] [--tag before|after] [--json out.json]
//   prints counts per category; --crops N renders N zoomed top-down crops of the worst examples per category to
//   tools/out/roadcheck/<tag>-<cat>-<k>.png (red ring = the suspicious end; tunnels dashed blue, passages orange).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GEO } from '../js/bxl-geodata.js';
import { createWorldQueries } from '../js/brussels-world.js';
import { BuildingIndex, classifyEnds, drawnCar, drawnPed, drawnPath, insideRuns, vertexMap, neighbours, flatLength } from './geo-brussels-base-roadtopo.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CROPS = +opt('--crops', 0);
const TAG = opt('--tag', 'now');
const OUTDIR = path.join(ROOT, 'tools/out/roadcheck');

const t0 = Date.now();
const world = createWorldQueries(GEO);
const bidx = new BuildingIndex(GEO.buildings);
const roads = GEO.roads;
const ends = classifyEnds(roads, { bidx, bounds: GEO.bounds, isWater: (x, z) => world.isWater(x, z) && !world.onBridge?.(x, z) });

// ---- per-road findings --------------------------------------------------------------------------------------------
const findings = [];
for (const e of ends) if (e.cat !== 'ok_junction' && e.cat !== 'edge' && e.cat !== 'touch') findings.push(e);
// carriageways drawn through ground-level building footprints (passages / covered / mis-mapped): ≥ 3 m inside
const through = [];
roads.forEach((r, ri) => {
  if (!drawnCar(r) && !drawnPed(r)) return;
  const { inside, total, runs } = insideRuns(r.pts, bidx);
  if (inside >= 3) through.push({ cat: r.passage ? 'passage_marked' : drawnPed(r) ? 'ped_through_building' : 'through_building', ri, inside, total, runs,
    x: 0, z: 0, kind: r.kind, sub: r.sub, len: total });
});
for (const f of through) {
  const r = roads[f.ri], run = f.runs.sort((a, b) => b.b - b.a - (a.b - a.a))[0];
  // point in the middle of the longest inside run
  let s = 0; const p = r.pts, m = (run.a + run.b) / 2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (s + L >= m) { const t = (m - s) / (L || 1); f.x = p[i] + (p[i + 2] - p[i]) * t; f.z = p[i + 1] + (p[i + 3] - p[i + 1]) * t; break; }
    s += L;
  }
  findings.push(f);
}
// footway / path ends inside buildings (entrance paths — drawn as flags, less visible)
const vAll = vertexMap(roads);
let pathIntoBuilding = 0;
roads.forEach((r, ri) => {
  if (!drawnPath(r)) return;
  const p = r.pts, n = p.length;
  for (const end of [0, 1]) {
    const x = end ? p[n - 2] : p[0], z = end ? p[n - 1] : p[1];
    if (neighbours(vAll, ri, x, z).length) continue;
    if (bidx.inside(x, z) >= 0) pathIntoBuilding++;
  }
});

// ---- report -------------------------------------------------------------------------------------------------------
const byCat = {};
for (const e of ends) byCat[e.cat] = (byCat[e.cat] || 0) + 1;
for (const f of through) byCat[f.cat] = (byCat[f.cat] || 0) + 1;
byCat.path_end_in_building = pathIntoBuilding;
const subOf = (cat) => {
  const m = {};
  for (const f of findings) if (f.cat === cat) { const k = f.kind + (f.sub ? ':' + f.sub : ''); m[k] = (m[k] || 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
};
const nCar = roads.filter(drawnCar).length;
console.log(`[roadcheck] ${nCar} drawn carriageways (${roads.length} roads), ${(Date.now() - t0) / 1000} s`);
const ORDER = ['ok_junction', 'edge', 'touch', 'to_path', 'open', 'gap', 'at_wall', 'into_building', 'tunnel_mouth', 'in_water', 'through_building', 'ped_through_building', 'passage_marked', 'path_end_in_building'];
for (const c of ORDER) console.log(`  ${c.padEnd(22)} ${String(byCat[c] || 0).padStart(6)}   ${['ok_junction', 'edge', 'touch', 'path_end_in_building'].includes(c) ? '' : subOf(c)}`);
const NOWHERE = ['gap', 'at_wall', 'into_building', 'tunnel_mouth', 'in_water', 'through_building'];
console.log(`  "nowhere" total (${NOWHERE.join(' + ')}): ${NOWHERE.reduce((s, c) => s + (byCat[c] || 0), 0)}`);
// treatments baked by tools/geo-brussels-base-roadfix.mjs (capA/capB, GEO.passages) — "untreated" = still a bare ribbon end
const passRoads = new Set((GEO.passages || []).map((p) => p.road));
const capOf = (e) => (e.end ? roads[e.ri].capB : roads[e.ri].capA) || '';
const caps = {}, untreated = {};
for (const e of ends) {
  if (e.cat === 'ok_junction' || e.cat === 'edge' || e.cat === 'touch') continue;
  const c = capOf(e);
  caps[c || '(none)'] = (caps[c || '(none)'] || 0) + 1;
  const ok = c || (e.cat === 'into_building' && passRoads.has(e.ri));
  if (!ok) untreated[e.cat] = (untreated[e.cat] || 0) + 1;
}
const thr = through.filter((f) => !passRoads.has(f.ri)).length;
if (thr) untreated.through_building = thr;
console.log(`  dead-end caps: ${JSON.stringify(caps)}; passages ${(GEO.passages || []).length} (${(GEO.passages || []).reduce((s, p) => s + p.portals.length, 0)} portals)`);
console.log(`  untreated "nowhere": ${JSON.stringify(untreated)}`);
byCat.untreated = untreated;
// dead ends that look intentional (turning head / bollards drawn by js/city/roads.js) are the rest
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ byCat, findings: findings.map(({ runs, ...f }) => f) }));

// ---- crops --------------------------------------------------------------------------------------------------------
if (CROPS > 0) {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const score = (f) => f.cat === 'through_building' ? f.inside : RANK[f.kind] * 10 + Math.min(f.len, 200) / 20;
  const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, living_street: 1, service: 0, pedestrian: 1 };
  const cats = opt('--cats', NOWHERE.concat(['open', 'to_path']).join(',')).split(',');
  const at = opt('--at'); // explicit "x,z;x,z" crops
  const jobs = [];
  if (at) at.split(';').forEach((s, k) => { const [x, z] = s.split(',').map(Number); jobs.push({ cat: 'at', k, x, z }); });
  else for (const c of cats) {
    const fs_ = findings.filter((f) => f.cat === c).sort((a, b) => score(b) - score(a));
    // spread: skip examples within 150 m of one already picked
    const picked = [];
    for (const f of fs_) { if (picked.length >= CROPS) break; if (picked.some((g) => Math.hypot(g.x - f.x, g.z - f.z) < 150)) continue; picked.push(f); }
    picked.forEach((f, k) => jobs.push({ ...f, k }));
  }
  const marks = path.join(OUTDIR, '.marks.json');
  for (const j of jobs) {
    const near = findings.filter((f) => Math.abs(f.x - j.x) < 80 && Math.abs(f.z - j.z) < 80).map((f) => [f.x, f.z, f.cat === 'through_building' ? 0x0060ff : 0xff0000, 3]);
    fs.writeFileSync(marks, JSON.stringify(near));
    const out = path.join(OUTDIR, `${TAG}-${j.cat}-${j.k}.png`);
    execFileSync(process.execPath, [path.join(ROOT, 'tools/geo-brussels-base-topdown.mjs'), out, '0.4', String(j.x), String(j.z), '160', '160'], { env: { ...process.env, MARKS: marks }, stdio: 'ignore' });
    console.log(`  crop ${out}  ${j.cat} ${j.kind || ''}${j.sub ? ':' + j.sub : ''} at ${j.x.toFixed(1)},${j.z.toFixed(1)} road ${j.ri ?? ''} ${roads[j.ri]?.name || ''} ${j.note || ''}`);
  }
}
