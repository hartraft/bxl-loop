// tools/perf-loops.mjs — frame-loop benchmark for the performance-critical landmark
// hotspots (Grand-Place, Royal Palace, Palais de Justice).
//
// The container has no GPU, so this drives the real per-frame code paths that decide the
// frame cost in those locations — js/scene-culling.js (chunk distance culling),
// js/landmark-quality.mjs (hotspot effect zones) and js/landmark-merge.mjs (static
// landmark merge) — on a deterministic scene shaped like the real build (vendored
// three.js, loaded straight from vendor/three), and runs LOOPS camera loops per
// location, the way the animation loop in js/main.js does every frame.
//
//   node tools/perf-loops.mjs                 # 500 loops per location, human report
//   node tools/perf-loops.mjs --loops 60 --json
//   node tools/perf-loops.mjs --no-merge        # baseline without the landmark merge
//
// Exit code 0 = stable 60 FPS budget met at every location (per-frame CPU cost of the
// culling/zone systems and the main-pass draw calls stay inside the frame budget),
// exit 1 otherwise. The last line on stdout is a PERF-LOOPS-JSON summary when --json.
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flagValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const LOOPS = Math.max(1, parseInt(flagValue('--loops', '500'), 10) || 500);
const JSON_OUT = args.includes('--json');
const NO_MERGE = args.includes('--no-merge');
const SEED = parseInt(flagValue('--seed', '20261126'), 10) >>> 0;

// Frame budget for a stable 60 FPS: 16.67 ms per frame. The measured per-frame systems
// (scene culling + zone test) must stay well inside it, and the main-pass draw calls the
// renderer would submit at the hotspot must stay bounded.
const FRAME_BUDGET_MS = 1000 / 60;
const SIM_P99_BUDGET_MS = 8; // culling + zone systems: p99 of the per-frame CPU cost
const DRAWS_P95_BUDGET = 220; // main-pass draw calls at the hotspot, p95
const SHADOW_DRAWS_P95_BUDGET = 120; // shadow-cascade draw calls at the hotspot, p95

// Deterministic RNG so benchmark runs are comparable.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const THREE = await import(pathToFileURL(path.join(ROOT, 'vendor/three/build/three.webgpu.js')).href);
const { loadModule } = require(path.join(ROOT, 'tests/helpers/module.cjs'));
const BufferGeometryUtils = loadModule(
  readFileSync(path.join(ROOT, 'vendor/three/examples/jsm/utils/BufferGeometryUtils.js'), 'utf8'),
  { imports: { three: THREE } }
);
const cullingMath = await import(pathToFileURL(path.join(ROOT, 'js/culling-math.mjs')).href);
const landmarkQuality = await import(pathToFileURL(path.join(ROOT, 'js/landmark-quality.mjs')).href);
const sceneCulling = loadModule(readFileSync(path.join(ROOT, 'js/scene-culling.js'), 'utf8'), {
  imports: { 'three/webgpu': THREE, './culling-math.mjs': cullingMath }
});
const landmarkMerge = loadModule(readFileSync(path.join(ROOT, 'js/landmark-merge.mjs'), 'utf8'), {
  imports: {
    'three/webgpu': THREE,
    'three/addons/utils/BufferGeometryUtils.js': BufferGeometryUtils,
    './landmark-quality.mjs': landmarkQuality
  }
});
const { setupSceneCulling, updateSceneCulling } = sceneCulling;
const { LANDMARK_PERF_MERGE_IDS, LANDMARK_PERFORMANCE_ZONES, isWithinLandmarkPerformanceZone, landmarkShadowFlags } = landmarkQuality;
const { mergeStaticGeometry } = landmarkMerge;
const { BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld, PALAIS_DE_JUSTICE_ROTATION } = await import(pathToFileURL(path.join(ROOT, 'js/brussels-frame.js')).href);

// ---------------------------------------------------------------------------
// A deterministic scene shaped like the real build: per hotspot a landmark root with
// hundreds of small meshes + repeated instanced ornaments (the guild-house pattern),
// plus city-wide instanced prop layers spanning the whole map (what scene-culling chunks).
const MESH_COUNT = { grandPlace: 240, royalPalace: 300, palaisDeJustice: 150 };
const INSTANCED_COUNT = { grandPlace: 10, royalPalace: 14, palaisDeJustice: 16 };
const INSTANCE_SIZES = [2, 8, 40, 120, 315, 420, 700, 1500];

function buildScene() {
  const rng = mulberry32(SEED);
  const scene = new THREE.Scene();
  const materials = [];
  const palette = [0xbca98c, 0xd8c9ad, 0x9f8060, 0x343d3b, 0x59615c, 0x354b50, 0xc69a42, 0x7a6238, 0xc9a05e, 0xe9e0cb, 0x55606e, 0x94402f];
  for (const color of palette) materials.push(new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  // night-glow clones: their own material instances, like the real builder's clones
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshStandardMaterial({ color: palette[i], emissive: new THREE.Color(0x000000) });
    materials.push(m);
  }
  const pickMaterial = () => materials[Math.floor(rng() * materials.length)];
  const pickGeometry = (s) => {
    const kind = Math.floor(rng() * 3);
    if (kind === 0) return new THREE.BoxGeometry(s, s * (0.2 + rng()), s * (0.2 + rng()));
    if (kind === 1) return new THREE.CylinderGeometry(s * 0.4, s * 0.5, s * (0.5 + rng()), 10);
    return new THREE.SphereGeometry(s * 0.5, 10, 8);
  };

  const landmarksGroup = new THREE.Group();
  landmarksGroup.name = 'BrusselsLandmarks';
  scene.add(landmarksGroup);
  const roots = [landmarksGroup];

  for (const id of LANDMARK_PERF_MERGE_IDS) {
    const anchor = BRUSSELS_LANDMARK_ANCHORS[id];
    const p = brusselsToWorld(anchor.lat, anchor.lon);
    const root = new THREE.Group();
    root.name = id;
    root.position.set(p.x, 0, p.z);
    if (id === 'royalPalace') root.rotation.y = Math.PI;
    if (id === 'palaisDeJustice') root.rotation.y = PALAIS_DE_JUSTICE_ROTATION;
    landmarksGroup.add(root);
    const n = MESH_COUNT[id];
    for (let i = 0; i < n; i++) {
      const s = 0.2 + rng() * 28;
      const m = new THREE.Mesh(pickGeometry(s), pickMaterial());
      m.position.set((rng() - 0.5) * 220, rng() * 45, (rng() - 0.5) * 200);
      m.rotation.y = rng() * Math.PI;
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
    }
    const nInst = INSTANCED_COUNT[id];
    for (let i = 0; i < nInst; i++) {
      const count = INSTANCE_SIZES[Math.floor(rng() * INSTANCE_SIZES.length)];
      const im = new THREE.InstancedMesh(pickGeometry(0.3 + rng() * 1.2), pickMaterial(), count);
      const dummy = new THREE.Object3D();
      for (let k = 0; k < count; k++) {
        dummy.position.set((rng() - 0.5) * 200, rng() * 40, (rng() - 0.5) * 180);
        dummy.rotation.y = rng() * Math.PI;
        dummy.updateMatrix();
        im.setMatrixAt(k, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.name = id + ' ornament ' + i;
      root.add(im);
    }
  }
  // a few non-hotspot landmarks, unmerged, like the real builder leaves them
  for (const id of ['mannekenPis', 'montDesArts', 'cathedral']) {
    const anchor = BRUSSELS_LANDMARK_ANCHORS[id];
    const p = brusselsToWorld(anchor.lat, anchor.lon);
    const root = new THREE.Group();
    root.position.set(p.x, 0, p.z);
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(pickGeometry(0.3 + rng() * 6), pickMaterial());
      m.position.set((rng() - 0.5) * 60, rng() * 20, (rng() - 0.5) * 60);
      m.castShadow = true;
      root.add(m);
    }
    landmarksGroup.add(root);
  }

  // city-wide instanced prop layers over the whole map (lamps, signals, trees, facade boxes)
  const propsGroup = new THREE.Group();
  propsGroup.name = 'CityProps';
  scene.add(propsGroup);
  roots.push(propsGroup);
  for (let layer = 0; layer < 4; layer++) {
    const count = 20000;
    const geo = layer % 2 === 0 ? new THREE.BoxGeometry(0.4, 6, 0.4) : new THREE.CylinderGeometry(0.2, 0.3, 8, 6);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: palette[layer] }), count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set((rng() - 0.5) * 6000, rng() * 30, (rng() - 0.5) * 7000);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    propsGroup.add(im);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: 0x3a3f3a }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  return { scene, roots };
}

// ---------------------------------------------------------------------------
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function run() {
  const { scene, roots } = buildScene();

  // the same post-build steps addLandmark() applies to the hotspot landmarks
  const mergeStats = {};
  for (const id of LANDMARK_PERF_MERGE_IDS) {
    const root = scene.getObjectByName(id);
    const detailSize = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      o.geometry.boundingBox.getSize(detailSize);
      const maxExtent = Math.max(
        detailSize.x * Math.abs(o.scale.x),
        detailSize.y * Math.abs(o.scale.y),
        detailSize.z * Math.abs(o.scale.z)
      );
      const flags = landmarkShadowFlags(o.isInstancedMesh, maxExtent);
      o.castShadow = flags.castShadow;
      o.receiveShadow = flags.receiveShadow;
    });
    if (!NO_MERGE) {
      mergeStats[id] = mergeStaticGeometry(root, { shadowFlags: (maxExtent) => landmarkShadowFlags(false, maxExtent) });
    }
  }

  setupSceneCulling(scene, roots, null);
  scene.updateMatrixWorld(true);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const _wp = new THREE.Vector3();
  const triCount = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

  const locations = LANDMARK_PERF_MERGE_IDS.map((id) => {
    const anchor = BRUSSELS_LANDMARK_ANCHORS[id];
    const p = brusselsToWorld(anchor.lat, anchor.lon);
    return { id, x: p.x, z: p.z };
  });

  const results = [];
  for (const loc of locations) {
    const simMs = [];
    const draws = [];
    const shadowDraws = [];
    const tris = [];
    let zoneHits = 0;
    for (let i = 0; i < LOOPS; i++) {
      const t = (i / LOOPS) * Math.PI * 2;
      const r = 70 + 60 * Math.abs(Math.sin(t * 1.7));
      const h = 16 + 14 * Math.sin(t * 2.3);
      camera.position.set(loc.x + r * Math.cos(t), h, loc.z + r * Math.sin(t));
      camera.lookAt(loc.x, 6, loc.z);

      const t0 = performance.now();
      updateSceneCulling(camera.position);
      const inZone = isWithinLandmarkPerformanceZone(camera.position.x, camera.position.z);
      const t1 = performance.now();
      if (inZone) zoneHits++;

      // accounting: what the renderer would submit this frame (frustum-culled). The shadow
      // cascades only cover ~400 m around the camera (see js/scene-culling.js), so shadow
      // draws are counted against a box around the camera, not the whole view frustum.
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      const CASCADE_HALF = 220;
      let d = 0, sd = 0, tr = 0;
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        if (!frustum.intersectsObject(o)) return;
        d++;
        tr += triCount(o.geometry) * (o.isInstancedMesh ? o.count : 1);
        if (o.castShadow) {
          const bs = o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere;
          if (bs) {
            _wp.copy(bs.center).applyMatrix4(o.matrixWorld);
            if (Math.abs(_wp.x - camera.position.x) <= CASCADE_HALF && Math.abs(_wp.z - camera.position.z) <= CASCADE_HALF) sd++;
          }
        }
      });
      const t2 = performance.now();

      simMs.push(t1 - t0);
      draws.push(d);
      shadowDraws.push(sd);
      tris.push(tr);
      if (t2 - t1 > FRAME_BUDGET_MS) { /* accounting only; reported, never budgeted */ }
    }
    const s = (a) => [...a].sort((p, q) => p - q);
    const sim = s(simMs), dr = s(draws), sd = s(shadowDraws), tr = s(tris);
    results.push({
      location: loc.id,
      loops: LOOPS,
      simMs: { mean: sim.reduce((a, b) => a + b, 0) / sim.length, p50: percentile(sim, 50), p95: percentile(sim, 95), p99: percentile(sim, 99), max: sim[sim.length - 1] },
      draws: { p50: percentile(dr, 50), p95: percentile(dr, 95), max: dr[dr.length - 1] },
      shadowDraws: { p95: percentile(sd, 95), max: sd[sd.length - 1] },
      trianglesP95: percentile(tr, 95),
      zoneHitRate: zoneHits / LOOPS
    });
  }

  let pass = true;
  const failures = [];
  for (const r of results) {
    const okSim = r.simMs.p99 <= SIM_P99_BUDGET_MS && r.simMs.max <= FRAME_BUDGET_MS;
    const okDraws = r.draws.p95 <= DRAWS_P95_BUDGET;
    const okShadow = r.shadowDraws.p95 <= SHADOW_DRAWS_P95_BUDGET;
    if (!(okSim && okDraws && okShadow)) {
      pass = false;
      if (!okSim) failures.push(`${r.location}: per-frame sim p99 ${r.simMs.p99.toFixed(3)}ms max ${r.simMs.max.toFixed(3)}ms`);
      if (!okDraws) failures.push(`${r.location}: main-pass draws p95 ${r.draws.p95} > ${DRAWS_P95_BUDGET}`);
      if (!okShadow) failures.push(`${r.location}: shadow draws p95 ${r.shadowDraws.p95} > ${SHADOW_DRAWS_P95_BUDGET}`);
    }
  }

  const summary = {
    loops: LOOPS,
    merged: !NO_MERGE,
    frameBudgetMs: FRAME_BUDGET_MS,
    budgets: { simP99Ms: SIM_P99_BUDGET_MS, drawsP95: DRAWS_P95_BUDGET, shadowDrawsP95: SHADOW_DRAWS_P95_BUDGET },
    mergeStats,
    results,
    pass,
    failures
  };

  if (!JSON_OUT) {
    console.log(`perf-loops: ${LOOPS} loops per location, merge=${!NO_MERGE ? 'on' : 'OFF (baseline)'}, frame budget ${FRAME_BUDGET_MS.toFixed(2)} ms (60 FPS)`);
    for (const id in mergeStats) {
      const m = mergeStats[id];
      console.log(`  merge ${id}: meshes ${m.meshesBefore} -> ${m.meshesAfter} (${m.mergedMeshes} merged), tris ${Math.round(m.trianglesBefore)} -> ${Math.round(m.trianglesAfter)}`);
    }
    for (const r of results) {
      console.log(`  ${r.location}: sim ms mean ${r.simMs.mean.toFixed(3)} p99 ${r.simMs.p99.toFixed(3)} max ${r.simMs.max.toFixed(3)} | draws p95 ${r.draws.p95} max ${r.draws.max} | shadow draws p95 ${r.shadowDraws.p95} | tris p95 ${Math.round(r.trianglesP95)} | zone hits ${(r.zoneHitRate * 100).toFixed(0)}%`);
    }
    console.log(pass ? '  PASS: stable 60 FPS budget at every hotspot' : `  FAIL: ${failures.join('; ')}`);
  }
  console.log('PERF-LOOPS-JSON ' + JSON.stringify(summary));
  process.exit(pass ? 0 : 1);
}

run();
