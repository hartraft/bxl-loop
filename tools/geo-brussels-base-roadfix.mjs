// tools/geo-brussels-base-roadfix.mjs — bake-time clean-up so every drawn road "goes somewhere" (Round 2, Agent R).
// Runs on the builder's road objects (pts = [[x, z], …]) after buildRoads and before the bridge decks:
//  1. short tunnels that only duck under a building, a railway or a road junction are drawn at grade
//     (tunnel = 0): the flat world has no underground, so the road would otherwise stop at both portals
//  2. iteratively drops dead-end stubs that lead nowhere: service roads (driveways, parking aisles, alleys, …) whose
//     dead end is in / against a building, in the water or at a dropped tunnel; isolated fragments; underpass approach
//     ramps that run beside a surface road (the surface road stays)
//  3. small gaps: a dead end 0.3–4 m short of another carriageway is extended onto it (cap 'bollards': a modal filter)
//  4. dead ends facing a wall within 4 m are extended to the wall (cap 'gate': js/city/roads.js draws a gateway)
//  5. every remaining dead end gets an intentional cap: 'kerb' (kerbed end), 'bollards' (continues as a path),
//     'portal' (tunnel mouth: retaining walls + dark mouth + headwall), 'gate' (a building entrance)
//  6. passages: runs of drawn carriageways / pedestrian streets through ground-level building footprints →
//     {road, pts, w, minY, portals:[{x, z, nx, nz}]} (portals = wall crossings, n = outward wall normal)
import { BuildingIndex, SegIndex, classifyEnds, vertexMap, neighbours, insideRuns, slicePolyline, flatLength, drawnCar, drawnPed, CAR_KINDS } from './geo-brussels-base-roadtopo.mjs';

export const ROAD_CAPS = ['', 'kerb', 'bollards', 'portal', 'gate'];
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const flat = (pts) => { const o = new Array(pts.length * 2); pts.forEach((p, i) => { o[i * 2] = p[0]; o[i * 2 + 1] = p[1]; }); return o; };
const q1 = (v) => Math.round(v * 10) / 10;

/** buildings [{ring, height, minHeight}] → struct-of-arrays for BuildingIndex */
export function buildingsSoA(buildings) {
  let n = 0;
  for (const b of buildings) n += b.ring.length;
  const ringStart = new Uint32Array(buildings.length + 1), xz = new Float64Array(n * 2);
  const minHeight = new Float32Array(buildings.length), height = new Float32Array(buildings.length), landmark = new Uint8Array(buildings.length);
  let p = 0;
  buildings.forEach((b, i) => {
    ringStart[i] = p;
    for (const q of b.ring) { xz[p * 2] = q[0]; xz[p * 2 + 1] = q[1]; p++; }
    minHeight[i] = b.minHeight; height[i] = b.height; landmark[i] = b.landmark ? 1 : 0;
  });
  ringStart[buildings.length] = p;
  return { count: buildings.length, ringStart, xz, minHeight, height, landmark };
}

/**
 * @param roads builder roads (mutated: tunnel, pts, capA/capB; dropped ones removed) → returns {roads, passages, stats}
 * @param buildings builder buildings
 * @param o {rail (builder rail), isWater(x, z), bounds}
 */
export function cleanRoads(roads, buildings, o) {
  const log = o.log || (() => {});
  const B = buildingsSoA(buildings);
  const bidx = new BuildingIndex(B);
  const stats = { untunnel: { building: 0, rail: 0, road: 0 }, dropped: {}, extendedGap: 0, extendedWall: 0, trimmedWall: 0, caps: {}, passages: 0, portals: 0 };
  const drop = (why) => { stats.dropped[why] = (stats.dropped[why] || 0) + 1; };
  const views = () => roads.map((r) => ({ src: r, pts: flat(r.pts), kind: r.kind, sub: r.sub, tunnel: r.tunnel, w: r.w, passage: 0 }));

  // ---- 1. short tunnels drawn at grade ----------------------------------------------------------------------------
  {
    const V = views();
    const surf = new SegIndex(V, drawnCar);
    const railSeg = new SegIndex((o.rail || []).map((r) => ({ pts: flat(r.pts), w: 5 })));
    for (const v of V) {
      const r = v.src;
      if (!r.tunnel || !CAR_KINDS.has(r.kind)) continue;
      const L = flatLength(v.pts);
      const ins = insideRuns(v.pts, bidx).inside;
      let n = 0, wet = 0, road = 0, rail = 0;
      const p = v.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dl = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]), k = Math.max(1, Math.ceil(dl / 2));
        for (let j = 0; j < k; j++) {
          const x = p[i] + ((p[i + 2] - p[i]) * (j + 0.5)) / k, z = p[i + 1] + ((p[i + 3] - p[i + 1]) * (j + 0.5)) / k;
          n++;
          if (o.isWater && o.isWater(x, z)) wet++;
          const h = surf.nearest(x, z, 30); if (h && h.edge < 0) road++;
          const q = railSeg.nearest(x, z, 10); if (q && q.edge < 0) rail++;
        }
      }
      if (wet) continue;
      let why = '';
      if (ins >= 0.7 * L) why = 'building';
      else if (rail && L <= 120 && (rail * 2 + ins) >= 0.3 * L) why = 'rail';
      else if ((road || rail) && L <= 60) why = road ? 'road' : 'rail';
      if (!why) continue;
      r.tunnel = 0; r.untunnelled = why;
      stats.untunnel[why]++;
    }
  }

  // ---- 2. iterative stub removal ----------------------------------------------------------------------------------
  const NOWHERE = new Set(['into_building', 'at_wall', 'tunnel_mouth', 'in_water']);
  for (let round = 0; round < 6; round++) {
    const V = views();
    const ends = classifyEnds(V, { bidx, bounds: o.bounds, isWater: o.isWater });
    const per = new Map();
    for (const e of ends) { let a = per.get(e.ri); if (!a) per.set(e.ri, (a = [null, null])); a[e.end] = e; }
    const surf = new SegIndex(V, drawnCar);
    const kill = new Set();
    for (const [ri, [a, b]] of per) {
      const v = V[ri], r = v.src, L = a.len;
      const cats = [a.cat, b.cat];
      const dead = cats.map((c) => c !== 'ok_junction' && c !== 'edge');
      const nowhere = cats.some((c) => NOWHERE.has(c));
      if (r.kind === 'service' && nowhere && L < 80) { kill.add(ri); drop('service stub into building / tunnel / water'); continue; }
      if (dead[0] && dead[1] && !cats.includes('gap') && !cats.includes('touch') && (r.kind === 'service' || !cats.includes('to_path')) &&
        L < (r.kind === 'service' ? 200 : 120)) { kill.add(ri); drop('isolated fragment'); continue; }
      if (cats.includes('tunnel_mouth')) {
        // underpass approach beside a surface road: drop it, the surface road carries on above
        const p = v.pts;
        let n = 0, beside = 0;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const dl = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]), k = Math.max(1, Math.ceil(dl / 4));
          for (let j = 0; j < k; j++) {
            const x = p[i] + ((p[i + 2] - p[i]) * (j + 0.5)) / k, z = p[i + 1] + ((p[i + 3] - p[i + 1]) * (j + 0.5)) / k;
            n++;
            const h = surf.nearest(x, z, v.w / 2 + 30, (j2) => j2 === ri || per.get(j2)?.some((e) => e.cat === 'tunnel_mouth'));
            if (h && h.edge - v.w / 2 < 16) beside++;
          }
        }
        if (beside >= 0.8 * n && L < 400) { kill.add(ri); drop('underpass ramp beside a surface road'); continue; }
      }
    }
    if (!kill.size) break;
    roads = roads.filter((_, i) => !kill.has(i));
    log(`  road clean-up round ${round + 1}: dropped ${kill.size}`);
  }

  // ---- 3–5. extend small gaps / walls, caps -------------------------------------------------------------------------
  const gates = [];
  const gateH = (bi, r) => q1(Math.max(2.4, Math.min(r.kind === 'service' ? 3.4 : 4.0, B.height[bi] - 1.2)));
  {
    const V = views();
    const ends = classifyEnds(V, { bidx, bounds: o.bounds, isWater: o.isWater });
    const segCar = new SegIndex(V, drawnCar);
    for (const r of roads) { r.capA = ''; r.capB = ''; }
    const setCap = (r, end, c) => { if (end) r.capB = c; else r.capA = c; stats.caps[c] = (stats.caps[c] || 0) + 1; };
    for (const e of ends) {
      const r = V[e.ri].src, P = r.pts, n = P.length;
      if (e.cat === 'ok_junction' || e.cat === 'edge' || e.cat === 'touch') continue;
      // unit direction out of the road at this end
      const tip = e.end ? P[n - 1] : P[0], prev = e.end ? P[n - 2] : P[1];
      let dx = tip[0] - prev[0], dz = tip[1] - prev[1];
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const extend = (x, z) => { const q = [q1(x), q1(z)]; if (e.end) P.push(q); else P.unshift(q); };
      if (e.cat === 'gap') {
        // reach along the road's own direction until 0.4 m onto the other carriageway (≤ 5 m); major roads simply
        // merge, minor ones get a modal filter (bollards)
        let reach = 0;
        for (let t = 0.25; t <= 5; t += 0.25) {
          const h = segCar.nearest(tip[0] + dx * t, tip[1] + dz * t, 12, (j) => j === e.ri);
          if (h && h.edge < -0.4) { reach = t; break; }
        }
        if (reach) {
          extend(tip[0] + dx * reach, tip[1] + dz * reach);
          stats.extendedGap++;
          setCap(r, e.end, MAJOR.has(r.kind) ? '' : 'bollards');
        } else setCap(r, e.end, 'kerb');
        continue;
      }
      if (e.cat === 'at_wall' || e.cat === 'into_building') {
        if (e.cat === 'into_building') {
          // only just inside (< 1.5 m): pull the tip back to the wall; deeper runs become passages (portal at entry)
          const h = bidx.rayWall(tip[0], tip[1], -dx, -dz, 1.5);
          if (h) {
            const t = Math.max(0, h.t - 0.15);
            const q = [q1(tip[0] - dx * t), q1(tip[1] - dz * t)];
            if (e.end) P[n - 1] = q; else P[0] = q;
            stats.trimmedWall++;
            setCap(r, e.end, 'gate');
            gates.push({ ri: e.ri, end: e.end, x: q1(tip[0] - dx * h.t), z: q1(tip[1] - dz * h.t), nx: h.nx, nz: h.nz, w: r.w, h: gateH(h.bi, r) });
          }
          continue; // deeper: passage portal drawn at the wall crossing; tip hidden inside the building
        }
        const h = bidx.rayWall(tip[0], tip[1], dx, dz, 4);
        if (h && Math.abs(dx * h.nx + dz * h.nz) > 0.55) {
          if (h.t > 0.2) { extend(tip[0] + dx * (h.t - 0.1), tip[1] + dz * (h.t - 0.1)); stats.extendedWall++; }
          setCap(r, e.end, 'gate');
          gates.push({ ri: e.ri, end: e.end, x: q1(h.x), z: q1(h.z), nx: h.nx, nz: h.nz, w: r.w, h: gateH(h.bi, r) });
        } else setCap(r, e.end, 'kerb');
        continue;
      }
      if (e.cat === 'tunnel_mouth') { setCap(r, e.end, 'portal'); continue; }
      if (e.cat === 'to_path') { setCap(r, e.end, 'bollards'); continue; }
      setCap(r, e.end, 'kerb'); // open, in_water
    }
  }

  // ---- 6. passages ------------------------------------------------------------------------------------------------
  const passages = [];
  const VF = views();
  const vmap = vertexMap(VF, (v) => drawnCar(v) || drawnPed(v));
  roads.forEach((r, ri) => {
    const v = VF[ri];
    if (!drawnCar(v) && !drawnPed(v)) return;
    const { runs, total } = insideRuns(v.pts, bidx, 1);
    const fp = v.pts, nf = fp.length;
    for (const run of runs) {
      if (run.b - run.a < 1.5) continue;
      const a = Math.max(0, run.a - 0.5), b = Math.min(total, run.b + 0.5);
      const pts = slicePolyline(v.pts, a, b);
      if (pts.length < 4) continue;
      const portals = [];
      let bh = Infinity;
      for (const [s, sgn] of [[run.a, 1], [run.b, -1]]) {
        let ox, oz, ix, iz;
        if (s <= 0.6 || s >= total - 0.6) {
          // the run reaches the road's end: a portal only if the road continues there (a passage way split at the
          // wall); probe from 1.5 m beyond the end (extrapolated) to 1.2 m inside
          const atStart = s <= 0.6;
          const ex = atStart ? fp[0] : fp[nf - 2], ez = atStart ? fp[1] : fp[nf - 1];
          if (!neighbours(vmap, ri, ex, ez).length) continue;
          const o2 = atStart ? slicePolyline(fp, 0, Math.min(total, 1.2 + Math.max(0, s))) : slicePolyline(fp, Math.max(0, Math.min(s, total) - 1.2), total);
          if (o2.length < 4) continue;
          ix = atStart ? o2[o2.length - 2] : o2[0]; iz = atStart ? o2[o2.length - 1] : o2[1];
          let dx = ex - ix, dz = ez - iz;
          const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
          ox = ex + dx * 1.5; oz = ez + dz * 1.5;
        } else {
          const o2 = slicePolyline(v.pts, Math.max(0, s - 1.2), Math.min(total, s + 1.2));
          if (o2.length < 4) continue;
          ox = sgn > 0 ? o2[0] : o2[o2.length - 2]; oz = sgn > 0 ? o2[1] : o2[o2.length - 1];
          ix = sgn > 0 ? o2[o2.length - 2] : o2[0]; iz = sgn > 0 ? o2[o2.length - 1] : o2[1];
        }
        const bi = bidx.inside(ix, iz);
        if (bi < 0) continue;
        const hit = bidx.segWall(bi, ox, oz, ix, iz);
        if (!hit) continue;
        const ux = ix - ox, uz = iz - oz, ul = Math.hypot(ux, uz) || 1;
        if (Math.abs((ux * hit.nx + uz * hit.nz) / ul) < 0.5) continue; // grazing a wall: not an entrance
        bh = Math.min(bh, B.height[bi]);
        portals.push({ x: q1(hit.x), z: q1(hit.z), nx: Math.round(hit.nx * 100) / 100, nz: Math.round(hit.nz * 100) / 100 });
      }
      if (!portals.length) continue;
      const mh = r.maxheight > 0 ? r.maxheight + 0.3 : r.kind === 'pedestrian' ? 3.6 : r.kind === 'service' ? 4.0 : 4.8;
      const minY = q1(Math.max(2.6, Math.min(mh, Number.isFinite(bh) ? bh - 1.5 : mh)));
      passages.push({ road: ri, pts: pts.map(q1), w: r.w, minY, portals, tag: r.cover || '' });
      stats.portals += portals.length;
    }
  });
  stats.passages = passages.length;
  stats.gates = gates.length;
  return { roads, passages, gates: gates.map((g) => ({ ...g, road: g.ri })), stats };
}
