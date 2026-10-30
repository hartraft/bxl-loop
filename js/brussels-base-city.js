// js/brussels-base-city.js — Workstream F: the static city of Brussels Loop built from the baked OSM geodata.
//
//   import { buildBrusselsCity } from './brussels-base-city.js';
//   const city = buildBrusselsCity(scene, { geo: GEO, world: WORLD });   // see INTEGRATION.md "Workstream F"
//   city.colliders / city.sidewalks / city.footprints / city.groups / city.update(dt, camera)
//
// Layers (each its own named root group so main.js can hand them to setupSceneCulling):
//   BrusselsCityTiles      buildings: 500 m tiles x (masonry+roofs, glass curtain walls)            js/city/buildings.js
//   BrusselsGround         ground plane, parks, plazas                                              js/city/ground.js
//   BrusselsWater          Thames / lakes / canals + embankment walls & parapets                    js/city/ground.js
//   BrusselsRoads          carriageways, junctions, pavements + kerbs, footways, markings, rail     js/city/roads.js
//   BrusselsBridges        decks, fascias, parapets, piers                                          js/city/roads.js
//   BrusselsStreetDetails  street furniture (instanced)                                             js/street-details.js
//   BrusselsTrees          street & park trees (Brussels planes…)                                     js/trees.js
import * as THREE from 'three/webgpu';
import { buildBuildingGeometry, buildFillerGeometry } from './city/buildings.js';
import { buildGroundGeometry, buildWaterSDF, buildStreetMask } from './city/ground.js';
import { buildRoadGeometry, KERB_H } from './city/roads.js';
import { RoadIndex } from './city/road-index.js';
import { regionTest, makeHash, ringBox, pointInRing } from './city/util.js';
import {
  createBrusselsBuildingMaterial, createBrusselsGlassMaterial, createAsphaltMaterial, createPavingMaterial, createMarkingMaterial,
  createGroundMaterial, createGrassMaterial, createStoneMaterial, createBrusselsWaterMaterial, createBallastMaterial, plainMaterial, waterSDF, streetMask
} from './city/materials.js';
import { buildStreetDetails } from './street-details.js';

export const DRIVE_KINDS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

function meshFrom(geometry, material, name, { cast = false, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/**
 * Build the city into `scene`.
 * @param opts { geo, world, region: {cx, cz, r} | null (build only a square around a point), details = true,
 *   trees = true, onProgress(label), landmarkZones: buildBrusselsLandmarks(...).zones (optional, skip buildings inside) }
 */
export function buildBrusselsCity(scene, opts = {}) {
  const { geo, world, region = null, details = true, trees = true, onProgress = null, landmarkZones = null } = opts;
  if (!geo || !world) throw new Error('buildBrusselsCity: pass { geo, world }');
  const t0 = performance.now();
  const timings = {};
  let tMark = t0;
  const mark = (label) => { const n = performance.now(); timings[label] = Math.round(n - tMark); tMark = n; if (onProgress) onProgress(label); };
  const inRegion = regionTest(region);

  const root = new THREE.Group();
  root.name = 'BrusselsCity';
  scene.add(root);
  const group = (name) => { const g = new THREE.Group(); g.name = name; root.add(g); return g; };
  const groups = {
    tiles: group('BrusselsCityTiles'), ground: group('BrusselsGround'), water: group('BrusselsWater'), roads: group('BrusselsRoads'),
    bridges: group('BrusselsBridges'), details: null, trees: null
  };

  // ---- shared road indices -----------------------------------------------------------------------------------------
  const driveRoads = geo.roads.filter((r) => !r.tunnel && (DRIVE_KINDS.includes(r.kind) || r.kind === 'pedestrian'));
  const ctx = {
    driveIndex: new RoadIndex(driveRoads.filter((r) => r.kind !== 'service')),
    majorIndex: new RoadIndex(geo.roads.filter((r) => !r.tunnel && MAJOR.has(r.kind))),
    carriageIndex: new RoadIndex(driveRoads.filter((r) => r.kind !== 'pedestrian')),
    pathIndex: new RoadIndex(geo.roads.filter((r) => !r.tunnel && (r.kind === 'footway' || r.kind === 'cycleway' || r.kind === 'steps') && r.sub !== 'sidewalk')),
    world,
    extraZones: landmarkZones || [],
    inPark: null
  };
  // point-in-park test (park paths in gravel, benches, tree scatter)
  {
    const PK = new Set(['park', 'garden', 'wood', 'cemetery', 'square', 'grass']);
    const parks = geo.parks.filter((p) => PK.has(p.kind));
    const boxes = parks.map((p) => ringBox(p.pts));
    const B = geo.bounds;
    const h = makeHash(B.minX - 200, B.minZ - 200, B.maxX + 200, B.maxZ + 200, 64, parks.length, (i, o) => { const b = boxes[i]; o[0] = b[0]; o[1] = b[1]; o[2] = b[2]; o[3] = b[3]; });
    ctx.inPark = (x, z) => {
      const c = h.cellOf(x, z);
      if (c < 0) return false;
      for (let k = h.start[c], e = h.start[c + 1]; k < e; k++) {
        const i = h.items[k], b = boxes[i];
        if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
        if (pointInRing(x, z, parks[i].pts) && !parks[i].holes.some((hh) => pointInRing(x, z, hh))) return true;
      }
      return false;
    };
  }
  mark('indices');

  // ---- water mask texture --------------------------------------------------------------------------------------------
  const sdf = buildWaterSDF(geo, world, geo.bounds);
  const tex = new THREE.DataTexture(sdf.data, sdf.W, sdf.H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  Object.assign(waterSDF, { tex, minX: sdf.minX, minZ: sdf.minZ, sizeX: sdf.sizeX, sizeZ: sdf.sizeZ, range: sdf.range });
  // street-frontage mask: the ground along the streets is paved (forecourts, areas), yards & gardens inside the blocks
  {
    const sm = buildStreetMask(geo, geo.bounds);
    const t = new THREE.DataTexture(sm.data, sm.W, sm.H, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true;
    Object.assign(streetMask, { tex: t, minX: sm.minX, minZ: sm.minZ, sizeX: sm.sizeX, sizeZ: sm.sizeZ });
  }
  mark('waterSDF');

  let triangles = 0, draws = 0;
  const add = (parent, geom, mat, name, o) => {
    if (!geom) return null;
    const m = meshFrom(geom, mat, name, o);
    parent.add(m);
    triangles += geom.index.count / 3;
    draws++;
    return m;
  };

  // ---- buildings -----------------------------------------------------------------------------------------------------
  const bld = buildBuildingGeometry(geo, ctx, inRegion);
  // buildings cut real openings over GEO.passages: roads.js then skips its dark arch decals on those facades
  if (geo.passages && geo.passages.length) ctx.passageArches = true;
  const fillerBlocks = opts.filler === false ? 0 : buildFillerGeometry(geo.bounds, sdf, inRegion, bld.tiles);
  mark('buildings.geometry');
  const mBuilding = createBrusselsBuildingMaterial();
  const mGlass = createBrusselsGlassMaterial();
  for (const [key, t] of bld.tiles) {
    add(groups.tiles, t.masonry.build(), mBuilding, 'Buildings_' + key, { cast: true });
    add(groups.tiles, t.glass.build(), mGlass, 'Glass_' + key, { cast: true });
  }
  mark('buildings.meshes');

  // ---- ground, parks, water ------------------------------------------------------------------------------------------
  const gnd = buildGroundGeometry(geo, inRegion, geo.bounds, world.terrainSurface || null);
  add(groups.ground, gnd.ground.build(), createGroundMaterial(), 'Ground');
  for (const [k, b] of gnd.grass) add(groups.ground, b.build(), createGrassMaterial(), 'Parks_' + k);
  for (const [k, b] of gnd.plaza) add(groups.ground, b.build(), createPavingMaterial(), 'Plazas_' + k);
  for (const [k, b] of gnd.water) add(groups.water, b.build(), createBrusselsWaterMaterial(), 'Water_' + k);
  for (const [k, b] of gnd.walls) add(groups.water, b.build(), createStoneMaterial(), 'Embankment_' + k, { cast: true });
  mark('ground');

  // ---- roads, pavements, markings, bridges, rail ---------------------------------------------------------------------
  const rd = buildRoadGeometry(geo, ctx, inRegion);
  const layers = [
    ['asphalt', createAsphaltMaterial(), groups.roads, {}],
    ['paving', createPavingMaterial(), groups.roads, {}],
    ['kerb', createPavingMaterial(), groups.roads, {}],
    ['markings', createMarkingMaterial(), groups.roads, {}],
    ['ballast', createBallastMaterial(), groups.roads, {}],
    ['rails', plainMaterial(0x8a8d90, 0.35, 0.8), groups.roads, {}],
    ['deck', createStoneMaterial(), groups.bridges, { cast: true }],
    ['steel', plainMaterial(0x3c4a3e, 0.5, 0.4), groups.bridges, { cast: true }]
  ];
  for (const [name, mat, parent, o] of layers) {
    const m = rd.layers[name];
    if (!m) continue;
    for (const [k, b] of m) add(parent, b.build(), mat, 'Road_' + name + '_' + k, o);
  }
  mark('roads');

  // ---- street furniture & trees ----------------------------------------------------------------------------------
  let det = { footprints: [], colliders: [], update() {}, stats: {} };
  if (details || trees) {
    det = buildStreetDetails(scene, { geo, world, ctx, inRegion, roads: rd, ground: gnd, details, trees, parent: root, city: 'brussels' });
    groups.details = det.group || null;
    groups.trees = det.treeGroup || null;
  }
  mark('details');

  // stats
  root.traverse((o) => { if (o.isInstancedMesh) { triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * o.count; draws++; } });
  const stats = {
    buildings: bld.stats.buildings, fillerBlocks, tiles: bld.tiles.size, triangles: Math.round(triangles), drawCalls: draws,
    buildMs: Math.round(performance.now() - t0), timings, buildingStats: bld.stats, groundStats: gnd.stats, roadStats: rd.stats, detailStats: det.stats
  };

  const colliders = [...bld.colliders, ...(det.colliders || []), ...(rd.colliders || [])];
  const sidewalks = rd.sidewalks;
  const surfaceHeight = (x, z) => {
    const d = world.groundHeight(x, z);
    const p = sidewalks.pavementAt(x, z);
    return p === null ? d : Math.max(d, p);
  };

  return {
    root,
    groups: Object.fromEntries(Object.entries(groups).filter(([, g]) => g)),
    colliders,
    sidewalks,
    footprints: det.footprints || [],
    signalHeads: det.signalHeads || [],
    setSignalPhase: det.setSignalPhase || (() => {}),
    surfaceHeight,
    kerbHeight: KERB_H,
    stats,
    update(dt, camera) { det.update(dt, camera); }
  };
}
