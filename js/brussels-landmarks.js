// Brussels-specific, procedural landmark geometry. Kept behind the Brussels city selector.
import * as THREE from 'three/webgpu';
import { GEO } from './brx-geodata.js';
import { BRUSSELS_LANDMARK_ANCHORS, MONT_DES_ARTS_ROTATION, PALAIS_DE_JUSTICE_ROTATION, BOURSE_ROTATION, brusselsToWorld } from './brussels-frame.js';
import { foundationSkirtBottom } from './brussels-terrain.js';
import { createBrusselsLandmarkColliders, splitMontDesArtsWall } from './brussels-colliders.js';
import { grandPlaceShadowFlags } from './grand-place-quality.mjs';

export function buildBrusselsLandmarks(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'BrusselsLandmarks';
  const materials = {
    limestone: new THREE.MeshStandardMaterial({ color: 0xbca98c, roughness: 0.88 }),
    paleStone: new THREE.MeshStandardMaterial({ color: 0xd8c9ad, roughness: 0.82 }),
    warmStone: new THREE.MeshStandardMaterial({ color: 0x9f8060, roughness: 0.86 }),
    green: new THREE.MeshStandardMaterial({ color: 0x70936a, roughness: 0.92 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x343d3b, roughness: 0.9 }),
    slate: new THREE.MeshStandardMaterial({ color: 0x59615c, roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x354b50, roughness: 0.35, metalness: 0.12 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc69a42, roughness: 0.48, metalness: 0.42 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x7a6238, roughness: 0.5, metalness: 0.55 }),
    ochre: new THREE.MeshStandardMaterial({ color: 0xc9a05e, roughness: 0.85 }),
    plaster: new THREE.MeshStandardMaterial({ color: 0xe9e0cb, roughness: 0.9 }),
    // The two real building stones of the UNESCO facades: Gobertange calcareous
    // sandstone and Euville oolitic limestone, plus blue stone (petit granit).
    gobertange: new THREE.MeshStandardMaterial({ color: 0xcbbd9c, roughness: 0.86 }),
    euville: new THREE.MeshStandardMaterial({ color: 0xd9cfb6, roughness: 0.8 }),
    blueStone: new THREE.MeshStandardMaterial({ color: 0x55606e, roughness: 0.72 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x94402f, roughness: 0.95 }),
    enamelBlue: new THREE.MeshStandardMaterial({ color: 0x1d4f91, roughness: 0.45, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x4a4035, roughness: 0.92 }),
    pavingA: new THREE.MeshStandardMaterial({ color: 0x77756d, roughness: 0.96 }),
    pavingB: new THREE.MeshStandardMaterial({ color: 0x89857a, roughness: 0.96 }),
    pavingEdge: new THREE.MeshStandardMaterial({ color: 0x55534d, roughness: 0.96 })
  };
  const landmarks = {};
  const colliders = [];
  // Window materials registered for night glow (the real square's windows and arcades
  // glow warm after dark while the facades are floodlit).
  const nightGlowMats = [];
  const glowGlass = materials.glass.clone();
  glowGlass.emissive = new THREE.Color(0x000000);
  nightGlowMats.push(glowGlass);
  // The traditional enamel street signs are lit after dark — register a glowing clone.
  const signGlow = materials.enamelBlue.clone();
  signGlow.emissive = new THREE.Color(0x000000);
  nightGlowMats.push(signGlow);
  // The brasserie awnings glow warm from the café lights beneath them after dark.
  const awningGlow = materials.canvas.clone();
  awningGlow.emissive = new THREE.Color(0x000000);
  nightGlowMats.push(awningGlow);
  // Fountain water glows faintly at night — a dedicated clone for the Manneken Pis jet.
  const glowWater = materials.glass.clone();
  glowWater.emissive = new THREE.Color(0x000000);
  nightGlowMats.push(glowWater);
  // Facade stone materials get a faint warm floodlight wash at night (the real square is
  // floodlit after dark) — clone them so daytime rendering is untouched.
  const facadeWashMats = [];
  for (const key of ['limestone', 'paleStone', 'warmStone', 'ochre', 'plaster', 'gobertange', 'euville', 'gold', 'bronze', 'pavingA', 'pavingB', 'blueStone']) {
    const m = materials[key].clone();
    m.emissive = new THREE.Color(0x000000);
    facadeWashMats.push(m);
    materials[key] = m;
  }

  function mesh(parent, geometry, material, x = 0, y = 0, z = 0, name = '') {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    if (name) object.name = name;
    parent.add(object);
    return object;
  }
  function box(parent, w, h, d, x, y, z, material, name = '') {
    return mesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z, name);
  }
  function cylinder(parent, top, bottom, height, x, y, z, material, sides = 12) {
    return mesh(parent, new THREE.CylinderGeometry(top, bottom, height, sides), material, x, y, z);
  }

  // Close the gap between a level podium underside and lower terrain on steep edges.
  // The main deck remains level; this creates a sampled retaining skirt rather than tilting the landmark.
  function terrainFoundationSkirt(parent, root, anchor, width, depth, topY, material, name) {
    const surfaceHeight = opts.world?.terrainSurfaceHeight;
    if (typeof surfaceHeight !== 'function') return null;
    const cos = Math.cos(root.rotation.y), sin = Math.sin(root.rotation.y);
    const edges = [
      { count: Math.ceil(width / 6), point: t => [-width / 2 + width * t, -depth / 2 - 0.06] },
      { count: Math.ceil(width / 6), point: t => [width / 2 - width * t, depth / 2 + 0.06] },
      { count: Math.ceil(depth / 6), point: t => [-width / 2 - 0.06, depth / 2 - depth * t] },
      { count: Math.ceil(depth / 6), point: t => [width / 2 + 0.06, -depth / 2 + depth * t] }
    ];
    const positions = [], indices = [];
    for (const edge of edges) {
      const samples = [];
      for (let i = 0; i <= edge.count; i++) {
        const [x, z] = edge.point(i / edge.count);
        const worldX = anchor.x + x * cos + z * sin;
        const worldZ = anchor.z - x * sin + z * cos;
        const terrainY = surfaceHeight(worldX, worldZ) - root.position.y;
        samples.push({ x, z, bottom: foundationSkirtBottom(terrainY, topY) });
      }
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i], b = samples[i + 1];
        if (a.bottom >= topY - 0.049 && b.bottom >= topY - 0.049) continue;
        const base = positions.length / 3;
        positions.push(a.x, topY, a.z, a.x, a.bottom, a.z, b.x, topY, b.z, b.x, b.bottom, b.z);
        indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
    }
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const skirtMaterial = material.clone();
    skirtMaterial.side = THREE.DoubleSide;
    return mesh(parent, geometry, skirtMaterial, 0, 0, 0, name);
  }
  function addLandmark(id, build) {
    const anchor = BRUSSELS_LANDMARK_ANCHORS[id];
    if (!anchor) return;
    const p = brusselsToWorld(anchor.lat, anchor.lon);
    const root = new THREE.Group();
    root.name = id;
    root.position.set(p.x, opts.world?.groundHeight?.(p.x, p.z) || 0, p.z);
    // Align each landmark's local architectural frontage with the real city axis.
    if (id === 'royalPalace') root.rotation.y = Math.PI; // north-facing façade toward Parc de Bruxelles
    if (id === 'palaceSurroundings') root.rotation.y = Math.PI; // same frame as the palace: local +Z = north toward the park
    if (id === 'palaisDeJustice') root.rotation.y = PALAIS_DE_JUSTICE_ROTATION; // monumental entrance faces Place Poelaert (facade normal bearing ~42 deg)
    if (id === 'montDesArts') root.rotation.y = MONT_DES_ARTS_ROTATION; // local +Z points southeast; the garden descends northwest
    if (id === 'cinquantenaire') root.rotation.y = Math.PI / 2; // triumphal axis east-west; pavilions north/south
    if (id === 'bourse' || id === 'bourseSurroundings') root.rotation.y = BOURSE_ROTATION; // main facade faces Place de la Bourse (bearing ~306 deg)
    build(root);
    if (id === 'grandPlace') {
      // The square's detailed guild-house facades contain hundreds of repeated ornaments.
      // Keep shadowing on the large architectural masses, but don't submit every tiny
      // baluster, window trim, cobble and sign fitting to both sun-shadow cascades.
      const detailSize = new THREE.Vector3();
      root.traverse((object) => {
        if (!object.isMesh || !object.geometry) return;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        object.geometry.boundingBox.getSize(detailSize);
        const maxExtent = Math.max(
          detailSize.x * Math.abs(object.scale.x),
          detailSize.y * Math.abs(object.scale.y),
          detailSize.z * Math.abs(object.scale.z)
        );
        const shadowFlags = grandPlaceShadowFlags(object.isInstancedMesh, maxExtent);
        object.castShadow = shadowFlags.castShadow;
        object.receiveShadow = shadowFlags.receiveShadow;
      });
    }
    colliders.push(...createBrusselsLandmarkColliders(id, p, root.rotation.y, root.position.y));
    group.add(root);
    landmarks[id] = { group: root, anchor };
  }

  // A facade is modelled in local coordinates: its front is +Z and the building extends behind it.
  // Instanced windows keep the repeated historic detail to two draw calls per facade.
  function guildHouse(parent, spec) {
    const { name, x, width, height, depth = 11, floors = 3, stone = materials.limestone,
      roof = materials.roof, style = 'gable', rotation = 0, y = 0, emblem = false, balustradeStatues = false,
      terrace = false } = spec;
    const root = new THREE.Group();
    root.name = name;
    root.position.set(x, y, 0);
    root.rotation.y = rotation;
    parent.add(root);

    box(root, width, height, depth, 0, height / 2, -depth / 2, stone, name + ' masonry');
    box(root, width + 0.8, 0.65, depth + 0.4, 0, height - 0.35, -depth / 2, materials.gold, name + ' cornice');
    // A thin gilded fillet runs along the top edge of the cornice, as on the real cornices.
    box(root, width + 0.9, 0.06, 0.12, 0, height + 0.02, -depth / 2, materials.gold, name + ' cornice top fillet');
    // The real Baroque cornices stand on a row of stone corbels (modillions) — instanced.
    const modillionCount = Math.max(4, Math.round(width / 1.2));
    const modillions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.34, 0.34), materials.warmStone, modillionCount);
    const modDummy = new THREE.Object3D();
    for (let i = 0; i < modillionCount; i++) {
      modDummy.position.set(-width / 2 + 0.5 + i * (width - 1.0) / (modillionCount - 1), height - 0.85, 0.16);
      modDummy.updateMatrix();
      modillions.setMatrixAt(i, modDummy.matrix);
    }
    modillions.count = modillionCount;
    modillions.name = name + ' corbelled cornice modillions';
    modillions.castShadow = true;
    root.add(modillions);
    // Rusticated quoins: oversized alternating stone blocks chaining each front corner of the
    // strongly structured Baroque facades — instanced up both corners.
    const quoinRows = Math.max(3, Math.floor((height - 2.2) / 0.85));
    const quoins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.78, 0.3), materials.warmStone, quoinRows * 2);
    let q = 0;
    for (let r = 0; r < quoinRows; r++) {
      for (const side of [-1, 1]) {
        modDummy.position.set(side * (width / 2 - 0.17), 1.3 + r * 0.85, 0.1);
        modDummy.updateMatrix();
        quoins.setMatrixAt(q++, modDummy.matrix);
      }
    }
    quoins.count = q;
    quoins.name = name + ' corner quoins';
    quoins.castShadow = true;
    root.add(quoins);
    // Gilded caps crown the top quoin of each house corner, as on the real quoins.
    const quoinCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), materials.gold, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * (width / 2 - 0.17), 1.3 + (quoinRows - 1) * 0.85 + 0.45, 0.1);
      modDummy.updateMatrix();
      quoinCaps.setMatrixAt(i, modDummy.matrix);
    }
    quoinCaps.count = 2;
    quoinCaps.name = name + ' corner quoin gold caps';
    root.add(quoinCaps);
    // Full-height gilded strips dress the outermost corner quoins of every house, as on the
    // real facades.
    const quoinStrips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, height - 2.0, 0.08), materials.gold, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * (width / 2 - 0.17), 1.2 + (height - 2.0) / 2, 0.14);
      modDummy.updateMatrix();
      quoinStrips.setMatrixAt(i, modDummy.matrix);
    }
    quoinStrips.count = 2;
    quoinStrips.name = name + ' corner quoin gold strips';
    root.add(quoinStrips);
    // Lead rainwater downpipes at the front corners, as on the real houses.
    const downpipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, height - 0.8, 6), materials.dark, 2);
    const dpd = new THREE.Object3D();
    for (let i = 0; i < 2; i++) {
      dpd.position.set((i === 0 ? -1 : 1) * (width / 2 - 0.25), (height - 0.8) / 2 + 0.4, 0.28);
      dpd.updateMatrix();
      downpipes.setMatrixAt(i, dpd.matrix);
    }
    downpipes.count = 2;
    downpipes.name = name + ' rainwater downpipes';
    root.add(downpipes);
    // Funnel hopper heads catch the rainwater at the top of each downpipe, as on the real
    // houses.
    const hoppers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.07, 0.22, 8), materials.dark, 2);
    for (let i = 0; i < 2; i++) {
      dpd.position.set((i === 0 ? -1 : 1) * (width / 2 - 0.25), height - 0.35, 0.28);
      dpd.updateMatrix();
      hoppers.setMatrixAt(i, dpd.matrix);
    }
    hoppers.count = 2;
    hoppers.name = name + ' downpipe hopper heads';
    root.add(hoppers);
    // Wall brackets strap each downpipe to the facade at intervals, as on the real houses.
    const pipeBrackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), materials.dark, 6);
    for (let i = 0; i < 2; i++) {
      for (let r = 0; r < 3; r++) {
        dpd.position.set((i === 0 ? -1 : 1) * (width / 2 - 0.25), 3 + r * 6, 0.28);
        dpd.updateMatrix();
        pipeBrackets.setMatrixAt(i * 3 + r, dpd.matrix);
      }
    }
    pipeBrackets.count = 6;
    pipeBrackets.name = name + ' downpipe wall brackets';
    root.add(pipeBrackets);

    // Dentil teeth under the gilded cornice and rustication grooves in the plinth — standard
    // dressing of the real Baroque facades.
    const dentilCount = Math.floor(width / 0.5);
    const dentils = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.22, 0.2), materials.warmStone, dentilCount);
    for (let i = 0; i < dentilCount; i++) {
      modDummy.position.set(-width / 2 + 0.3 + i * 0.5, height - 0.78, 0.18);
      modDummy.updateMatrix();
      dentils.setMatrixAt(i, modDummy.matrix);
    }
    dentils.count = dentilCount;
    dentils.name = name + ' cornice dentils';
    root.add(dentils);
    // Blind-arcade frieze panels under the cornice — the real cornices carry a recessed
    // arcade frieze.
    const friezeCount = Math.max(4, Math.round(width / 1.2));
    const frieze = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.3, 0.1), materials.dark, friezeCount);
    for (let i = 0; i < friezeCount; i++) {
      modDummy.position.set(-width / 2 + 0.6 + i * (width - 1.2) / (friezeCount - 1), height - 1.12, 0.2);
      modDummy.updateMatrix();
      frieze.setMatrixAt(i, modDummy.matrix);
    }
    frieze.count = friezeCount;
    frieze.name = name + ' blind-arcade cornice frieze';
    root.add(frieze);
    // A gilded egg-and-dart row runs under the cornice above the frieze, as on the real
    // Baroque cornices.
    const eggDart = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 5), materials.gold, modillionCount);
    for (let i = 0; i < modillionCount; i++) {
      modDummy.position.set(-width / 2 + 0.5 + i * (width - 1.0) / (modillionCount - 1), height - 0.62, 0.18);
      modDummy.updateMatrix();
      eggDart.setMatrixAt(i, modDummy.matrix);
    }
    eggDart.count = modillionCount;
    eggDart.name = name + ' cornice gilded egg-and-dart row';
    root.add(eggDart);
    // A lead gutter runs along the front eave under each house cornice, as on the real roofs.
    box(root, width + 0.9, 0.1, 0.16, 0, height - 0.05, 0.42, materials.dark, name + ' front eave gutter');
    const rustication = new THREE.InstancedMesh(new THREE.BoxGeometry(width + 0.3, 0.05, 0.06), materials.dark, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set(0, 0.8 + i * 0.55, 0.31);
      modDummy.updateMatrix();
      rustication.setMatrixAt(i, modDummy.matrix);
    }
    rustication.count = 2;
    rustication.name = name + ' plinth rustication grooves';
    root.add(rustication);
    box(root, width + 0.45, 0.45, 0.35, 0, 1.15, 0.12, materials.warmStone, name + ' plinth');
    // Sloped water table caps the plinth, and end blocks terminate each string course —
    // standard weathering details of the real facades.
    const waterTable = box(root, width + 0.55, 0.07, 0.5, 0, 1.4, 0.12, materials.dark, name + ' plinth water table');
    waterTable.rotation.x = 0.12;
    const scEnds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), materials.warmStone, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * (width / 2 - 0.2), 3.6, 0.38);
      modDummy.updateMatrix();
      scEnds.setMatrixAt(i, modDummy.matrix);
    }
    scEnds.count = 2;
    scEnds.name = name + ' string course end blocks';
    root.add(scEnds);
    // Horizontal string-course bands between the window storeys, as on the real facades.
    const stringCourses = new THREE.InstancedMesh(new THREE.BoxGeometry(width - 0.4, 0.14, 0.12), materials.warmStone, floors);
    const scd = new THREE.Object3D();
    let sc = 0;
    for (let floor = 2; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      scd.position.set(0, wy - 1.32, 0.12);
      scd.updateMatrix();
      stringCourses.setMatrixAt(sc++, scd.matrix);
    }
    stringCourses.count = sc;
    stringCourses.name = name + ' inter-floor string courses';
    root.add(stringCourses);
    // Gilded trim lines ride on each inter-floor string course, as on the real facades.
    const scTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(width - 0.4, 0.05, 0.06), materials.gold, floors);
    for (let floor = 2; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      scd.position.set(0, wy - 1.24, 0.15);
      scd.updateMatrix();
      scTrim.setMatrixAt(floor - 2, scd.matrix);
    }
    scTrim.count = sc;
    scTrim.name = name + ' string course gilded trim';
    root.add(scTrim);
    // A gilded medallion centres each string course, as on the real facades.
    const scMedallions = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14).rotateX(Math.PI / 2), materials.gold, floors);
    for (let floor = 2; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      scd.position.set(0, wy - 1.24, 0.2);
      scd.updateMatrix();
      scMedallions.setMatrixAt(floor - 2, scd.matrix);
    }
    scMedallions.count = sc;
    scMedallions.name = name + ' string course center medallions';
    root.add(scMedallions);

    const bays = Math.max(3, Math.round(width / 2.8));
    const windowGeo = new THREE.BoxGeometry(1.05, 1.45, 0.16);
    const frameGeo = new THREE.BoxGeometry(1.28, 1.7, 0.12);
    const windows = new THREE.InstancedMesh(windowGeo, spec.windowMat || glowGlass, bays * floors);
    const frames = new THREE.InstancedMesh(frameGeo, materials.gold, bays * floors);
    // Stone cross-mullions (croisées de pierre) dividing each window into four lights — the real
    // houses' upper windows are crossed like this (blue-stone croisillons on e.g. Le Mont Thabor).
    const croisillonMat = spec.blueStone ? materials.blueStone : stone;
    const mullionV = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1.45, 0.06), croisillonMat, bays * floors);
    const mullionH = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 0.09, 0.06), croisillonMat, bays * floors);
    // Wooden shutters folded back beside every window, as on the real houses.
    const shutters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 1.5, 0.06), materials.dark, bays * floors * 2);
    const dummy = new THREE.Object3D();
    let index = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx, wy, 0.13);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        windows.setMatrixAt(index, dummy.matrix);
        dummy.position.set(wx, wy, 0.04);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        frames.setMatrixAt(index, dummy.matrix);
        dummy.position.set(wx, wy, 0.2);
        dummy.updateMatrix();
        mullionV.setMatrixAt(index, dummy.matrix);
        mullionH.setMatrixAt(index, dummy.matrix);
        dummy.position.set(wx - 0.78, wy, 0.1);
        dummy.updateMatrix();
        shutters.setMatrixAt(index * 2, dummy.matrix);
        dummy.position.set(wx + 0.78, wy, 0.1);
        dummy.updateMatrix();
        shutters.setMatrixAt(index * 2 + 1, dummy.matrix);
        index++;
      }
    }
    shutters.count = index * 2;
    shutters.name = name + ' window shutters';
    root.add(shutters);
    // Gilded hinge straps fasten each folded-back shutter to the window frame.
    const hinges = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.3, 0.1), materials.gold, bays * floors);
    let hg = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx - 0.62, wy + 0.3, 0.12);
        dummy.updateMatrix();
        hinges.setMatrixAt(hg++, dummy.matrix);
      }
    }
    hinges.count = hg;
    hinges.name = name + ' shutter hinge straps';
    root.add(hinges);
    // Gilded tie-back straps hold each folded shutter open against the facade.
    const tieBacks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.05, 0.08), materials.gold, bays * floors);
    let tbs = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx - 0.78, wy - 0.4, 0.12);
        dummy.updateMatrix();
        tieBacks.setMatrixAt(tbs++, dummy.matrix);
      }
    }
    tieBacks.count = tbs;
    tieBacks.name = name + ' shutter tie-back straps';
    root.add(tieBacks);
    // Inner shutter leaves fold inside each window reveal, as on the real houses.
    const innerShutters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1.45, 0.05), materials.dark, bays * floors * 2);
    let ish = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        for (const side of [-1, 1]) {
          dummy.position.set(wx + side * 0.62, wy, 0.1);
          dummy.rotation.y = side * 0.12;
          dummy.updateMatrix();
          innerShutters.setMatrixAt(ish++, dummy.matrix);
          dummy.rotation.y = 0;
        }
      }
    }
    innerShutters.count = ish;
    innerShutters.name = name + ' inner shutter leaves';
    root.add(innerShutters);
    windows.name = name + ' windows';
    frames.name = name + ' gilded window surrounds';
    mullionV.name = mullionH.name = name + ' window stone cross-mullions';
    windows.castShadow = frames.castShadow = true;
    root.add(windows, frames, mullionV, mullionH);
    // Flat pilaster strips rise the full facade height at the window joints, structuring
    // the real Baroque elevations.
    const pilasterStripCount = bays + 1;
    const pilasterStrips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, height - 2.6, 0.14), stone, pilasterStripCount);
    const spacing = (width - 2.8) / Math.max(1, bays - 1);
    for (let i = 0; i <= bays; i++) {
      const px = i === 0 ? -width / 2 + 0.7 : i === bays ? width / 2 - 0.7 : -width / 2 + 1.4 + spacing * (i - 0.5);
      dummy.position.set(px, 1.15 + (height - 2.6) / 2, 0.1);
      dummy.updateMatrix();
      pilasterStrips.setMatrixAt(i, dummy.matrix);
    }
    pilasterStrips.count = pilasterStripCount;
    pilasterStrips.name = name + ' facade pilaster strips';
    root.add(pilasterStrips);
    // Keystones crown every window frame, as on the real facades.
    const winKeystones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.34, 0.18), materials.warmStone, bays * floors);
    let wk = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx, wy + 0.95, 0.16);
        dummy.updateMatrix();
        winKeystones.setMatrixAt(wk++, dummy.matrix);
      }
    }
    winKeystones.count = wk;
    winKeystones.name = name + ' window keystones';
    root.add(winKeystones);
    // Gilded vertical strips dress the pilaster positions, as on the real facades.
    const goldStrips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, height - 2.6, 0.06), materials.gold, pilasterStripCount);
    const spacing2 = (width - 2.8) / Math.max(1, bays - 1);
    for (let i = 0; i <= bays; i++) {
      const px = i === 0 ? -width / 2 + 0.7 : i === bays ? width / 2 - 0.7 : -width / 2 + 1.4 + spacing2 * (i - 0.5);
      dummy.position.set(px, 1.15 + (height - 2.6) / 2, 0.14);
      dummy.updateMatrix();
      goldStrips.setMatrixAt(i, dummy.matrix);
    }
    goldStrips.count = pilasterStripCount;
    goldStrips.name = name + ' pilaster gold dress strips';
    root.add(goldStrips);
    // Dark inner reveals recess every window into the facade, as on the real houses.
    const reveals = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1.55, 0.08), materials.dark, bays * floors);
    let rv = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx, wy, 0.08);
        dummy.updateMatrix();
        reveals.setMatrixAt(rv++, dummy.matrix);
      }
    }
    reveals.count = rv;
    reveals.name = name + ' window inner reveals';
    root.add(reveals);
    // Gilded trim frames every window reveal, as on the real facades.
    const revealTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(1.26, 1.61, 0.05), materials.gold, bays * floors);
    let rt = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx, wy, 0.16);
        dummy.scale.set(1, 1, 0.4);
        dummy.updateMatrix();
        revealTrim.setMatrixAt(rt++, dummy.matrix);
        dummy.scale.set(1, 1, 1);
      }
    }
    revealTrim.count = rt;
    revealTrim.name = name + ' window reveal gold trim';
    root.add(revealTrim);
    // Segmental arch lintels crown every window, as on the real facades.
    const lintelShape = new THREE.Shape();
    lintelShape.moveTo(-0.7, 0); lintelShape.quadraticCurveTo(0, 0.5, 0.7, 0); lintelShape.lineTo(0.7, -0.08); lintelShape.lineTo(-0.7, -0.08); lintelShape.closePath();
    const lintelArches = new THREE.InstancedMesh(new THREE.ShapeGeometry(lintelShape), stone, bays * floors);
    let la = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx, wy + 0.88, 0.18);
        dummy.updateMatrix();
        lintelArches.setMatrixAt(la++, dummy.matrix);
      }
    }
    lintelArches.count = la;
    lintelArches.name = name + ' window segmental lintels';
    root.add(lintelArches);
    // Dripstones hang under every window sill of the real facades.
    const sillDrips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.24, 6), materials.warmStone, bays * floors);
    let sd2 = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx, wy - 0.88, 0.2);
        dummy.updateMatrix();
        sillDrips.setMatrixAt(sd2++, dummy.matrix);
      }
    }
    sillDrips.count = sd2;
    sillDrips.name = name + ' window sill dripstones';
    root.add(sillDrips);
    // Gilded trim lines run along every window sill of the real facades.
    const sillTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.05, 0.1), materials.gold, bays * floors);
    let st3 = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        dummy.position.set(wx, wy - 0.78, 0.18);
        dummy.updateMatrix();
        sillTrim.setMatrixAt(st3++, dummy.matrix);
      }
    }
    sillTrim.count = st3;
    sillTrim.name = name + ' window sill gold trim';
    root.add(sillTrim);
    // Stone corbels under every window sill, carrying the sills of the real facades.
    const sillCorbels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.18, 0.24), materials.warmStone, bays * floors * 2);
    let scc = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        for (const side of [-1, 1]) {
          dummy.position.set(wx + side * 0.5, wy - 0.85, 0.16);
          dummy.updateMatrix();
          sillCorbels.setMatrixAt(scc++, dummy.matrix);
        }
      }
    }
    sillCorbels.count = scc;
    sillCorbels.name = name + ' window sill corbels';
    root.add(sillCorbels);

    // Ground floor: a recessed arcade opening per bay — on the real square the cafés and
    // shops sit under these arcades, so the ground floor is taller and darker than the
    // window storeys above. Instanced like the rest of the repeated detail.
    const arcade = new THREE.InstancedMesh(new THREE.BoxGeometry(1.55, 2.7, 0.2), spec.windowMat || glowGlass, bays);
    const lintels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.22, 0.3), materials.warmStone, bays);
    const arcDummy = new THREE.Object3D();
    let ac = 0;
    for (let bay = 0; bay < bays; bay++) {
      const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
      arcDummy.position.set(wx, 1.75, 0.4);
      arcDummy.updateMatrix();
      arcade.setMatrixAt(ac, arcDummy.matrix);
      arcDummy.position.set(wx, 3.25, 0.42);
      arcDummy.updateMatrix();
      lintels.setMatrixAt(ac, arcDummy.matrix);
      ac++;
    }
    arcade.count = lintels.count = ac;
    arcade.name = name + ' ground-floor arcade';
    lintels.name = name + ' arcade lintel';
    arcade.castShadow = lintels.castShadow = true;
    root.add(arcade, lintels);
    box(root, width - 0.4, 0.2, 0.3, 0, 3.6, 0.36, materials.warmStone, name + ' arcade string course');
    // Keystone at the apex of every ground-floor arcade opening, as on the real arcades.
    const keystones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.4, 0.3), materials.warmStone, bays);
    for (let bay = 0; bay < bays; bay++) {
      arcDummy.position.set((bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1), 3.42, 0.44);
      arcDummy.updateMatrix();
      keystones.setMatrixAt(bay, arcDummy.matrix);
    }
    keystones.count = bays;
    keystones.name = name + ' arcade keystones';
    root.add(keystones);
    // Dark soffit panels behind the arcade openings, and glazing bars dividing the
    // shopfront glass of the real ground-floor arcades.
    const soffits = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.1, 0.12), materials.dark, bays);
    const glazingBars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 2.6, 0.06), materials.dark, bays * 3);
    let sf = 0, gb = 0;
    for (let bay = 0; bay < bays; bay++) {
      const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
      arcDummy.position.set(wx, 3.12, 0.48);
      arcDummy.updateMatrix();
      soffits.setMatrixAt(sf++, arcDummy.matrix);
      for (let g = 0; g < 3; g++) {
        arcDummy.position.set(wx - 0.45 + g * 0.45, 1.8, 0.46);
        arcDummy.updateMatrix();
        glazingBars.setMatrixAt(gb++, arcDummy.matrix);
      }
    }
    soffits.count = sf;
    glazingBars.count = gb;
    soffits.name = name + ' arcade soffit panels';
    glazingBars.name = name + ' shopfront glazing bars';
    root.add(soffits, glazingBars);
    // Capitals widen the tops of the ground-arcade piers, as on the real arcades.
    const arcadeCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.22, 0.5), materials.warmStone, bays * 2);
    let acap = 0;
    for (let bay = 0; bay < bays; bay++) {
      const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
      for (const side of [-1, 1]) {
        arcDummy.position.set(wx + side * ((width - 2.8) / bays / 2 - 0.1), 3.3, 0.42);
        arcDummy.updateMatrix();
        arcadeCaps.setMatrixAt(acap++, arcDummy.matrix);
      }
    }
    arcadeCaps.count = acap;
    arcadeCaps.name = name + ' arcade pier capitals';
    root.add(arcadeCaps);
    // Gilded trim runs along every arcade lintel, as on the real shopfronts.
    const lintelTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.05, 0.06), materials.gold, bays);
    for (let bay = 0; bay < bays; bay++) {
      arcDummy.position.set((bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1), 3.38, 0.46);
      arcDummy.updateMatrix();
      lintelTrim.setMatrixAt(bay, arcDummy.matrix);
    }
    lintelTrim.count = bays;
    lintelTrim.name = name + ' arcade lintel gilded trim';
    root.add(lintelTrim);
    // Pendant lamps hang inside each arcade bay, glowing at night — the real brasseries are
    // lit from within the arcades.
    const arcadeLamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), glowGlass, bays);
    for (let bay = 0; bay < bays; bay++) {
      arcDummy.position.set((bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1), 2.9, 0.45);
      arcDummy.updateMatrix();
      arcadeLamps.setMatrixAt(bay, arcDummy.matrix);
    }
    arcadeLamps.count = bays;
    arcadeLamps.name = name + ' arcade pendant lamps';
    root.add(arcadeLamps);
    // Arched door leaf with a gilded fanlight in the centre arcade bay of every house.
    box(root, 0.95, 2.5, 0.12, 0, 1.55, 0.42, materials.dark, name + ' arched door leaf');
    const fanlight = cylinder(root, 0.4, 0.4, 0.08, 0, 3.02, 0.44, materials.gold, 16);
    fanlight.name = name + ' door fanlight';
    fanlight.rotation.x = Math.PI / 2;
    // Gilded fanlight ray spokes radiating over the door leaf, as on the real fanlights.
    const fanRays = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.34, 0.04), materials.gold, 5);
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.15 + 0.7 * (i / 4));
      arcDummy.position.set(Math.cos(a) * 0.36, 3.02 + Math.sin(a) * 0.36, 0.46);
      arcDummy.rotation.z = a - Math.PI / 2;
      arcDummy.updateMatrix();
      fanRays.setMatrixAt(i, arcDummy.matrix);
      arcDummy.rotation.z = 0;
    }
    fanRays.count = 5;
    fanRays.name = name + ' door fanlight rays';
    root.add(fanRays);
    // Slender colonettes frame every doorway, as on the real entrances.
    for (const side of [-1, 1]) {
      box(root, 0.14, 2.6, 0.16, side * 0.62, 1.7, 0.44, stone, name + ' door surround colonette');
    }
    // A gilded ring frames every door fanlight, as on the real doorways.
    cylinder(root, 0.44, 0.44, 0.05, 0, 3.02, 0.48, materials.gold, 16).name = name + ' door fanlight gold ring';
    // Rebuild-date cartouche beside the door — the real houses carry "Anno 1697" etc. after the
    // 1695 bombardment — and a small pediment crowns the doorway.
    box(root, 0.8, 0.3, 0.1, width / 2 - 1.3, 3.9, 0.34, materials.dark, name + ' rebuild date cartouche');
    box(root, 0.6, 0.18, 0.04, width / 2 - 1.3, 3.9, 0.4, materials.gold, name + ' rebuild date cartouche rim');
    // Gilded house-number plaque beside the doorway, as on the real facades.
    box(root, 0.4, 0.5, 0.06, width / 2 - 1.3, 3.15, 0.36, materials.gold, name + ' house number plaque');
    const doorPed = new THREE.Shape();
    doorPed.moveTo(-0.35, 0); doorPed.lineTo(0, 0.32); doorPed.lineTo(0.35, 0); doorPed.closePath();
    mesh(root, new THREE.ShapeGeometry(doorPed), stone, 0, 3.32, 0.42, name + ' door surround pediment');
    // Stone threshold and a single step at every doorway, worn by centuries of use.
    box(root, 1.2, 0.12, 0.4, 0, 0.06, 0.55, materials.warmStone, name + ' door threshold stone');
    box(root, 1.6, 0.14, 0.5, 0, 0.07, 0.85, materials.warmStone, name + ' door step');
    // Gilded keyhole escutcheon and door knocker on every door leaf.
    box(root, 0.1, 0.22, 0.05, 0.3, 1.6, 0.5, materials.gold, name + ' door keyhole escutcheon');
    mesh(root, new THREE.SphereGeometry(0.07, 8, 6), materials.gold, -0.3, 1.65, 0.52, name + ' door knocker');
    // A gilded kick plate at the foot of every door leaf, as on the real doors.
    box(root, 0.8, 0.28, 0.06, 0, 0.34, 0.48, materials.gold, name + ' door kick plate');
    // A lit door lamp glows above every house entrance at night, as on the real arcades.
    box(root, 0.22, 0.3, 0.1, 0, 3.75, 0.5, glowGlass, name + ' door lamp');
    // A bronze hanging shop sign on a bracket projects over each arcade, as on the real
    // brasseries.
    box(root, 0.08, 0.08, 0.7, 0, 3.6, 0.75, materials.bronze, name + ' hanging sign bracket');
    box(root, 0.5, 0.4, 0.06, 0, 3.35, 1.05, materials.bronze, name + ' hanging shop sign');
    // Small attic windows in the gable base, flanking the oculus.
    const atticWindows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.7, 0.1), spec.windowMat || glowGlass, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * width / 4, height + 0.75, 0.14);
      modDummy.updateMatrix();
      atticWindows.setMatrixAt(i, modDummy.matrix);
    }
    atticWindows.count = 2;
    atticWindows.name = name + ' gable attic windows';
    // Tiny shutters flank each gable attic window, as on the real houses.
    const atticShutters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.72, 0.05), materials.dark, 4);
    for (let i = 0; i < 2; i++) {
      for (const side of [-1, 1]) {
        modDummy.position.set((i === 0 ? -1 : 1) * 0.55 + side * 0.38, height + 1.25, 0.14);
        modDummy.updateMatrix();
        atticShutters.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), modDummy.matrix);
      }
    }
    atticShutters.count = 4;
    atticShutters.name = name + ' attic window shutters';
    root.add(atticShutters);
    // Recessed dark panel inside the gable base pediment, framing the attic windows and
    // oculus of the real gable fronts.
    box(root, width - 3.4, 2.0, 0.06, 0, height + 0.85, 0.16, materials.dark, name + ' gable base recess panel');
    // Hood moulds shelter both gable attic windows, as on the real gable fronts.
    for (let i = 0; i < 2; i++) {
      box(root, 0.62, 0.12, 0.14, (i === 0 ? -1 : 1) * 0.55, height + 1.68, 0.16, stone, name + ' attic window hood mould');
      box(root, 0.6, 0.1, 0.16, (i === 0 ? -1 : 1) * 0.55, height + 0.86, 0.16, materials.warmStone, name + ' attic window sill');
    }
    root.add(atticWindows);
    if (terrace) {
      // Café awning sloping over each ground-floor arcade bay — the real square's
      // brasseries and cafés sit under canvas awnings on the Grand-Place.
      const awnings = new THREE.InstancedMesh(new THREE.BoxGeometry((width - 2.8) / bays - 0.3, 0.05, 1.3), awningGlow, bays);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        arcDummy.position.set(wx, 3.2, 0.85);
        arcDummy.rotation.set(-0.5, 0, 0);
        arcDummy.updateMatrix();
        awnings.setMatrixAt(bay, arcDummy.matrix);
      }
      awnings.count = bays;
      awnings.name = name + ' café awnings';
      awnings.castShadow = true;
      root.add(awnings);
      arcDummy.rotation.set(0, 0, 0);
      // Scalloped canvas valance hanging from the front edge of each awning.
      const valances = new THREE.InstancedMesh(new THREE.BoxGeometry((width - 2.8) / bays - 0.3, 0.24, 0.04), materials.canvas, bays);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        arcDummy.position.set(wx, 2.85, 1.45);
        arcDummy.updateMatrix();
        valances.setMatrixAt(bay, arcDummy.matrix);
      }
      valances.count = bays;
      valances.name = name + ' awning valance';
      root.add(valances);
      // Gilded trim runs along the scalloped valance edge of each awning.
      const valanceTrim = new THREE.InstancedMesh(new THREE.BoxGeometry((width - 2.8) / bays - 0.3, 0.05, 0.04), materials.gold, bays);
      for (let bay = 0; bay < bays; bay++) {
        arcDummy.position.set((bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1), 3.62, 1.62);
        arcDummy.rotation.y = 0;
        arcDummy.updateMatrix();
        valanceTrim.setMatrixAt(bay, arcDummy.matrix);
      }
      valanceTrim.count = bays;
      valanceTrim.name = name + ' awning valance gilded trim';
      root.add(valanceTrim);
      // White canvas stripes stripe each café awning, as on the real brasserie awnings.
      const stripes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.06, 1.32), materials.plaster, bays * 2);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        for (let s2 = 0; s2 < 2; s2++) {
          arcDummy.position.set(wx - 0.55 + s2 * 1.1 + ((width - 2.8) / bays) / 2 - 0.15, 3.72, 1.05);
          arcDummy.rotation.x = 0.42;
          arcDummy.updateMatrix();
          stripes.setMatrixAt(bay * 2 + s2, arcDummy.matrix);
          arcDummy.rotation.x = 0;
        }
      }
      stripes.count = bays * 2;
      stripes.name = name + ' awning canvas stripes';
      root.add(stripes);
      // Tie ropes run from each awning's front edge down to its poles, as on the real rigging.
      const tieRopes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.8, 0.03), materials.dark, bays * 2);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        for (const side of [-1, 1]) {
          arcDummy.position.set(wx + side * ((width - 2.8) / bays / 2 - 0.15), 3.1, 1.35);
          arcDummy.rotation.x = 0.35;
          arcDummy.updateMatrix();
          tieRopes.setMatrixAt(bay * 2 + (side > 0 ? 1 : 0), arcDummy.matrix);
          arcDummy.rotation.x = 0;
        }
      }
      tieRopes.count = bays * 2;
      tieRopes.name = name + ' awning tie ropes';
      root.add(tieRopes);
      // Canvas side flaps close the awning ends.
      const sideFlaps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.55, 1.05), materials.canvas, 2);
      for (let i = 0; i < 2; i++) {
        arcDummy.position.set((i === 0 ? -1 : 1) * (width - 2.8) / 2, 3.0, 0.95);
        arcDummy.updateMatrix();
        sideFlaps.setMatrixAt(i, arcDummy.matrix);
      }
      sideFlaps.count = 2;
      sideFlaps.name = name + ' awning side flaps';
      root.add(sideFlaps);
      // Angled support arms brace each awning from the facade, and slim front poles carry
      // the valance — the real canvas awnings are propped thus.
      const awnArms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.15, 0.06), materials.dark, bays * 2);
      const awnPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1.55, 6), materials.dark, bays * 2);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        for (const side of [-1, 1]) {
          arcDummy.position.set(wx + side * ((width - 2.8) / bays / 2 - 0.15), 3.3, 0.9);
          arcDummy.rotation.x = 0.5;
          arcDummy.updateMatrix();
          awnArms.setMatrixAt(bay * 2 + (side > 0 ? 1 : 0), arcDummy.matrix);
          arcDummy.rotation.x = 0;
          arcDummy.position.set(wx + side * ((width - 2.8) / bays / 2 - 0.15), 2.9, 1.6);
          arcDummy.updateMatrix();
          awnPoles.setMatrixAt(bay * 2 + (side > 0 ? 1 : 0), arcDummy.matrix);
        }
      }
      awnArms.count = bays * 2;
      awnPoles.count = bays * 2;
      awnArms.name = name + ' awning support arms';
      awnPoles.name = name + ' awning front poles';
      root.add(awnArms, awnPoles);
      // Canvas scallop balls hang along each awning valance edge, as on the real valances.
      const valanceBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 5), materials.canvas, bays * 3);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        for (let s3 = 0; s3 < 3; s3++) {
          arcDummy.position.set(wx - ((width - 2.8) / bays) / 2 + 0.25 + s3 * (((width - 2.8) / bays) - 0.5) / 2, 3.58, 1.62);
          arcDummy.updateMatrix();
          valanceBalls.setMatrixAt(bay * 3 + s3, arcDummy.matrix);
        }
      }
      valanceBalls.count = bays * 3;
      valanceBalls.name = name + ' awning valance scallop balls';
      root.add(valanceBalls);
      // Terrace furniture set out on the square in front of the awnings — the real brasseries
      // (Le Roy d'Espagne's parasols in the house colours, etc.) line the plaza with tables,
      // chairs and parasols. All instanced per house.
      const tableTops = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 10), materials.dark, bays);
      const tableLegs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), materials.dark, bays);
      const chairs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.5, 0.38), materials.dark, bays * 2);
      const parasolPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), materials.dark, bays);
      const parasols = new THREE.InstancedMesh(new THREE.ConeGeometry(0.95, 0.55, 8), materials.canvas, bays);
      let t = 0;
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        arcDummy.position.set(wx, 0.775, 2.4);
        arcDummy.updateMatrix();
        tableTops.setMatrixAt(t, arcDummy.matrix);
        arcDummy.position.set(wx, 0.375, 2.4);
        arcDummy.updateMatrix();
        tableLegs.setMatrixAt(t, arcDummy.matrix);
        arcDummy.position.set(wx, 1.4, 2.4);
        arcDummy.updateMatrix();
        parasolPoles.setMatrixAt(t, arcDummy.matrix);
        arcDummy.position.set(wx, 2.05, 2.4);
        arcDummy.updateMatrix();
        parasols.setMatrixAt(t, arcDummy.matrix);
        for (const side of [-1, 1]) {
          arcDummy.position.set(wx + side * 0.75, 0.25, 2.55);
          arcDummy.updateMatrix();
          chairs.setMatrixAt(t * 2 + (side > 0 ? 1 : 0), arcDummy.matrix);
        }
        t++;
      }
      tableTops.count = tableLegs.count = parasolPoles.count = parasols.count = t;
      chairs.count = t * 2;
      tableTops.name = name + ' terrace table top';
      tableLegs.name = name + ' terrace table leg';
      chairs.name = name + ' terrace chair';
      parasolPoles.name = name + ' terrace parasol pole';
      parasols.name = name + ' terrace parasol canopy';
      root.add(tableTops, tableLegs, chairs, parasolPoles, parasols);
      // Rib tips crown each terrace parasol, as on the real brasserie parasols.
      const parasolRibs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), materials.dark, bays);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        arcDummy.position.set(wx, 2.36, 2.4);
        arcDummy.updateMatrix();
        parasolRibs.setMatrixAt(bay, arcDummy.matrix);
      }
      parasolRibs.count = bays;
      parasolRibs.name = name + ' parasol rib tips';
      root.add(parasolRibs);
      // Chair backs and A-frame menu boards complete each brasserie terrace, as on the real
      // square's café terraces.
      const chairBacks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.35, 0.05), materials.dark, bays * 2);
      const menuBoards = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.55, 0.04), materials.dark, bays);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        for (const side of [-1, 1]) {
          arcDummy.position.set(wx + side * 0.75, 0.45, 2.55);
          arcDummy.updateMatrix();
          chairBacks.setMatrixAt(bay * 2 + (side > 0 ? 1 : 0), arcDummy.matrix);
        }
        arcDummy.position.set(wx + 0.9, 0.3, 2.2);
        arcDummy.rotation.y = 0.3;
        arcDummy.updateMatrix();
        menuBoards.setMatrixAt(bay, arcDummy.matrix);
        arcDummy.rotation.y = 0;
      }
      chairBacks.count = bays * 2;
      menuBoards.count = bays;
      chairBacks.name = name + ' terrace chair backs';
      menuBoards.name = name + ' terrace menu boards';
      root.add(chairBacks, menuBoards);
      // Gilded finial balls crown each terrace parasol, as on the real brasserie parasols.
      const parasolTips = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 5), materials.gold, bays);
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        arcDummy.position.set(wx, 2.42, 2.4);
        arcDummy.updateMatrix();
        parasolTips.setMatrixAt(bay, arcDummy.matrix);
      }
      parasolTips.count = bays;
      parasolTips.name = name + ' parasol finial tips';
      root.add(parasolTips);
      // Rope barriers on posts keep the terrace walkway clear, as on the real terraces.
      const ropePosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 6), materials.dark, bays + 1);
      const rope = new THREE.InstancedMesh(new THREE.BoxGeometry((width - 2.0) / bays, 0.03, 0.03), materials.warmStone, bays);
      for (let bay = 0; bay <= bays; bay++) {
        arcDummy.position.set(-(width - 2.0) / 2 + bay * ((width - 2.0) / bays), 0.45, 3.1);
        arcDummy.updateMatrix();
        ropePosts.setMatrixAt(bay, arcDummy.matrix);
      }
      for (let bay = 0; bay < bays; bay++) {
        arcDummy.position.set(-(width - 2.0) / 2 + (bay + 0.5) * ((width - 2.0) / bays), 0.82, 3.1);
        arcDummy.updateMatrix();
        rope.setMatrixAt(bay, arcDummy.matrix);
      }
      ropePosts.count = bays + 1;
      rope.count = bays;
      ropePosts.name = name + ' terrace rope barrier posts';
      rope.name = name + ' terrace rope barrier';
      root.add(ropePosts, rope);
    }

    // Baroque guild-house dressing, as on the real frontages: pilasters between the
    // bays, a balustrade parapet along the cornice, and gilded statues standing in
    // niches between the windows. All repeated detail stays instanced.
    const pilasterGeo = new THREE.BoxGeometry(0.26, height - 1.6, 0.2);
    const pilasters = new THREE.InstancedMesh(pilasterGeo, materials.warmStone, bays + 1);
    const balusterCount = Math.max(6, Math.round(width / 1.1));
    const balusters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.6, 0.15), stone, balusterCount);
    const niches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.66, 2.0, 0.2), materials.dark, bays * floors);
    const statues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 1.05, 0.12), materials.gold, bays * floors);
    const ornDummy = new THREE.Object3D();
    const bayStep = (width - 2.8) / bays;
    let p = 0, bl = 0, n = 0;
    for (let i = 0; i <= bays; i++) {
      ornDummy.position.set(-(width - 2.8) / 2 + i * bayStep, height / 2 + 0.4, 0.1);
      ornDummy.updateMatrix();
      pilasters.setMatrixAt(p++, ornDummy.matrix);
    }
    for (let i = 0; i < balusterCount; i++) {
      ornDummy.position.set(-width / 2 + 0.6 + i * (width - 1.2) / (balusterCount - 1), height + 0.55, 0.14);
      ornDummy.updateMatrix();
      balusters.setMatrixAt(bl++, ornDummy.matrix);
    }
    for (let floor = 2; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1) + bayStep / 2;
        ornDummy.position.set(wx, wy, 0.16);
        ornDummy.updateMatrix();
        niches.setMatrixAt(n, ornDummy.matrix);
        ornDummy.position.set(wx, wy, 0.3);
        ornDummy.updateMatrix();
        statues.setMatrixAt(n, ornDummy.matrix);
        n++;
      }
    }
    pilasters.count = p; balusters.count = bl; niches.count = statues.count = n;
    pilasters.name = name + ' pilasters';
    balusters.name = name + ' balustrade parapet';
    niches.name = name + ' statue niches';
    statues.name = name + ' gilded statues';
    pilasters.castShadow = balusters.castShadow = niches.castShadow = statues.castShadow = true;
    root.add(pilasters, balusters, niches, statues);
    box(root, width + 0.7, 0.16, 0.24, 0, height + 0.9, 0.14, stone, name + ' parapet rail');
    // Gilded brackets support the parapet rail at both ends and mid-span, as on the real
    // cornices' parapets.
    const railBrackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.3, 0.2), materials.gold, 4);
    for (let i = 0; i < 4; i++) {
      modDummy.position.set(-width / 2 + 0.4 + i * (width - 0.8) / 3, height + 0.72, 0.14);
      modDummy.updateMatrix();
      railBrackets.setMatrixAt(i, modDummy.matrix);
    }
    railBrackets.count = 4;
    railBrackets.name = name + ' parapet rail brackets';
    root.add(railBrackets);
    // Openwork gaps pierce the house parapet between its rail brackets, as on the real
    // openwork parapets.
    const parapetGaps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.5, 0.28), materials.dark, modillionCount - 1);
    for (let i = 0; i < modillionCount - 1; i++) {
      modDummy.position.set(-width / 2 + 0.95 + i * (width - 1.9) / (modillionCount - 2), height + 0.88, 0.14);
      modDummy.updateMatrix();
      parapetGaps.setMatrixAt(i, modDummy.matrix);
    }
    parapetGaps.count = modillionCount - 1;
    parapetGaps.name = name + ' openwork parapet gaps';
    root.add(parapetGaps);
    // Gilded caps finish both ends of every house parapet rail, as on the real parapets.
    const parapetCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), materials.gold, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * (width / 2 + 0.35), height + 1.0, 0.14);
      modDummy.updateMatrix();
      parapetCaps.setMatrixAt(i, modDummy.matrix);
    }
    parapetCaps.count = 2;
    parapetCaps.name = name + ' parapet rail end caps';
    root.add(parapetCaps);
    // Gilded finial balls terminate the parapet rail at both ends of every house.
    const parapetFinials = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), materials.gold, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * (width / 2 + 0.2), height + 1.0, 0.14);
      modDummy.updateMatrix();
      parapetFinials.setMatrixAt(i, modDummy.matrix);
    }
    parapetFinials.count = 2;
    parapetFinials.name = name + ' parapet rail end finials';
    root.add(parapetFinials);

    // Each house gets a distinct roofline instead of the repeated identical cones of the old model.
    const gableHeight = style === 'stepped' ? 4.8 : style === 'bell' ? 3.6 : 4.6;
    const shape = new THREE.Shape();
    if (style === 'stepped') {
      shape.moveTo(-width / 2, 0); shape.lineTo(-width / 2, 1.2);
      shape.lineTo(-width / 2 + 1.4, 1.2); shape.lineTo(-width / 2 + 1.4, 2.4);
      shape.lineTo(-width / 2 + 2.8, 2.4); shape.lineTo(-width / 2 + 2.8, 3.6);
      shape.lineTo(0, gableHeight); shape.lineTo(width / 2 - 2.8, 3.6);
      shape.lineTo(width / 2 - 2.8, 2.4); shape.lineTo(width / 2 - 1.4, 2.4);
      shape.lineTo(width / 2 - 1.4, 1.2); shape.lineTo(width / 2, 1.2);
      shape.lineTo(width / 2, 0);
    } else if (style === 'bell') {
      shape.moveTo(-width / 2, 0); shape.quadraticCurveTo(-width / 2, 2.4, -width / 2 + 1.8, 2.4);
      shape.quadraticCurveTo(0, gableHeight + 1, width / 2 - 1.8, 2.4);
      shape.quadraticCurveTo(width / 2, 2.4, width / 2, 0);
    } else if (style === 'scroll') {
      // Ogee / volute gable, as on several of the real houses.
      shape.moveTo(-width / 2, 0);
      shape.bezierCurveTo(-width / 2, 3.2, -width / 2 + 2.4, 3.2, -width / 2 + 2.4, 2.0);
      shape.quadraticCurveTo(-width / 2 + 2.4, 1.2, 0, gableHeight);
      shape.quadraticCurveTo(width / 2 - 2.4, 1.2, width / 2 - 2.4, 2.0);
      shape.bezierCurveTo(width / 2 - 2.4, 3.2, width / 2, 3.2, width / 2, 0);
    } else if (style === 'neck') {
      // Neck gable (halsgevel): a raised neck with volute shoulders and a small pediment — the
      // characteristic gable of the 18th-century Grand-Place houses, e.g. Le Paon.
      const w2 = width / 2;
      shape.moveTo(-w2, 0); shape.lineTo(-w2, 1.4);
      shape.quadraticCurveTo(-w2, 3.2, -w2 + 1.8, 3.2);
      shape.lineTo(-1.4, 3.2); shape.lineTo(-1.4, gableHeight - 0.8);
      shape.lineTo(0, gableHeight); shape.lineTo(1.4, gableHeight - 0.8);
      shape.lineTo(1.4, 3.2); shape.lineTo(w2 - 1.8, 3.2);
      shape.quadraticCurveTo(w2, 3.2, w2, 1.4); shape.lineTo(w2, 0);
    } else {
      shape.moveTo(-width / 2, 0); shape.lineTo(0, gableHeight); shape.lineTo(width / 2, 0);
    }
    shape.closePath();
    mesh(root, new THREE.ShapeGeometry(shape), stone, 0, height, 0.08, name + ' gable');
    if (style === 'stepped') {
      // Dressed step-edge stones cap each step of a stepped (trapgevel) gable, as on the
      // real L'Étoile, Sainte-Barbe, La Brouette and L'Arbre d'Or.
      const stepEdges = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 0.2), materials.warmStone, 6);
      for (let i = 0; i < 3; i++) {
        for (const side of [-1, 1]) {
          modDummy.position.set(side * (width / 2 - 1.2 - i * 1.15), height + 1.1 + i * 1.1, 0.14);
          modDummy.updateMatrix();
          stepEdges.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), modDummy.matrix);
        }
      }
      stepEdges.count = 6;
      stepEdges.name = name + ' stepped gable edge stones';
      root.add(stepEdges);
    }
    box(root, width + 0.7, 0.35, depth + 0.5, 0, height + 0.2, -depth / 2, roof, name + ' roof cap');
    if (style !== 'stepped' && style !== 'gable') {
      // Bell (klokgevel), neck (halsgevel) and scroll (volute) gables end in paired scroll
      // volutes, as on the real Le Cygne, Le Paon, La Louve and Le Cornet.
      const gableScrolls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), materials.gold, 2);
      for (let i = 0; i < 2; i++) {
        modDummy.position.set((i === 0 ? -1 : 1) * (width / 2 - 2.0), height + 1.9, 0.12);
        modDummy.updateMatrix();
        gableScrolls.setMatrixAt(i, modDummy.matrix);
      }
      gableScrolls.count = 2;
      gableScrolls.name = name + ' gable top scroll volutes';
      root.add(gableScrolls);
    }
    // Tile rows run across the roof cap, as on the real slate-tiled house roofs.
    const tileRowCount = Math.ceil((width + 0.7) / 0.6);
    const tileRows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.05, depth + 0.4), materials.dark, tileRowCount);
    for (let i = 0; i < tileRowCount; i++) {
      modDummy.position.set(-width / 2 - 0.35 + 0.3 + i * 0.6, height + 0.42, -depth / 2);
      modDummy.updateMatrix();
      tileRows.setMatrixAt(i, modDummy.matrix);
    }
    tileRows.count = tileRowCount;
    tileRows.name = name + ' roof tile rows';
    root.add(tileRows);
    // Gilded crest finials march along the house roof ridge, as on the real rooflines.
    const ridgeCrests = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.5, 6), materials.gold, 3);
    for (let i = 0; i < 3; i++) {
      modDummy.position.set((i - 1) * (width / 4), height + 0.55, -depth / 2);
      modDummy.updateMatrix();
      ridgeCrests.setMatrixAt(i, modDummy.matrix);
    }
    ridgeCrests.count = 3;
    ridgeCrests.name = name + ' roof ridge crest finials';
    root.add(ridgeCrests);
    // Stone caps close the roof ridge at both gable ends, as on the real roofs.
    for (let i = 0; i < 2; i++) {
      box(root, 0.5, 0.3, 0.5, (i === 0 ? -1 : 1) * (width / 2 + 0.2), height + 0.5, -depth / 2, materials.warmStone, name + ' roof ridge end cap');
    }
    // Gilded volute scrolls at the gable shoulders — the baroque gables end in scrolls.
    const volutes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 8, 6), materials.gold, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * (width / 2 - 1.0), height + 0.9, 0.12);
      modDummy.updateMatrix();
      volutes.setMatrixAt(i, modDummy.matrix);
    }
    volutes.count = 2;
    volutes.name = name + ' gable shoulder volute scrolls';
    root.add(volutes);
    // A gilded center scroll crowns the gable between the shoulder volutes.
    mesh(root, new THREE.SphereGeometry(0.24, 10, 8), materials.gold, 0, height + 1.6, 0.12, name + ' gable center scroll');
    // A gilded finial crowns the gable pediment apex, as on the real gables.
    mesh(root, new THREE.SphereGeometry(0.16, 10, 8), materials.gold, 0, height + gableHeight + 0.25, 0.1, name + ' gable apex finial');
    // Gilded flashing runs down both edges of every gable, as on the real gable fronts.
    const flashL = box(root, 0.06, gableHeight + 0.6, 0.06, -width / 4, height + (gableHeight + 0.6) / 2, 0.12, materials.gold, name + ' gable edge gold flashing');
    flashL.rotation.z = 0.42;
    const flashR = box(root, 0.06, gableHeight + 0.6, 0.06, width / 4, height + (gableHeight + 0.6) / 2, 0.12, materials.gold, name + ' gable edge gold flashing');
    flashR.rotation.z = -0.42;
    // Chimneys with terracotta pots rise from the roof, as on the real houses.
    const chimneys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 1.6, 0.55), materials.warmStone, 2);
    const chimneyPots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8), materials.dark, 4);
    let ch = 0;
    for (const side of [-1, 1]) {
      modDummy.position.set(side * (width / 2 - 1.6), height + 1.05, -depth / 2 + 1.6);
      modDummy.updateMatrix();
      chimneys.setMatrixAt(ch, modDummy.matrix);
      for (let p = 0; p < 2; p++) {
        modDummy.position.set(side * (width / 2 - 1.6) + (p - 0.5) * 0.24, height + 2.05, -depth / 2 + 1.6);
        modDummy.updateMatrix();
        chimneyPots.setMatrixAt(ch * 2 + p, modDummy.matrix);
      }
      ch++;
    }
    chimneys.count = ch;
    chimneyPots.count = ch * 2;
    chimneys.name = name + ' roof chimneys';
    chimneyPots.name = name + ' chimney pots';
    root.add(chimneys, chimneyPots);
    // Stone cap slabs crown each chimney stack, shedding rain off the pots.
    const chimneyCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.1, 0.75), materials.warmStone, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * (width / 2 - 1.6), height + 1.9, -depth / 2 + 1.6);
      modDummy.updateMatrix();
      chimneyCaps.setMatrixAt(i, modDummy.matrix);
    }
    chimneyCaps.count = 2;
    chimneyCaps.name = name + ' chimney cap slabs';
    root.add(chimneyCaps);
    // Rim rings dress the top of each terracotta chimney pot, as on the real pots.
    const potRims = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 8), materials.dark, 4);
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? -1 : 1;
      modDummy.position.set(side * (width / 2 - 1.6) + (i % 2 ? 0.12 : -0.12), height + 2.32, -depth / 2 + 1.6);
      modDummy.updateMatrix();
      potRims.setMatrixAt(i, modDummy.matrix);
    }
    potRims.count = 4;
    potRims.name = name + ' chimney pot rim rings';
    root.add(potRims);
    box(root, 0.35, height - 1.8, 0.25, -width / 2 + 0.45, height / 2 + 0.5, 0.16, materials.gold);
    box(root, 0.35, height - 1.8, 0.25, width / 2 - 0.45, height / 2 + 0.5, 0.16, materials.gold);
    cylinder(root, 0.12, 0.12, 1.3, 0, height + gableHeight + 0.55, 0.08, materials.gold, 8);
    mesh(root, new THREE.SphereGeometry(0.16, 10, 8), materials.gold, 0, height + gableHeight + 1.3, 0.08, name + ' gable finial gilded ball');
    // Pots à feu: stone vases with flames flanking the gable pediments — a documented ornament of
    // the 1697-1699 Grand-Place baroque houses (e.g. Le Renard's volute wings, La Brouette's gable).
    const potVases = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 0.55, 8), stone, 2);
    const potFlames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.17, 0.5, 8), materials.gold, 2);
    for (let i = 0; i < 2; i++) {
      const px = (i === 0 ? -1 : 1) * (width / 2 - 1.4);
      modDummy.position.set(px, height + gableHeight * 0.55, 0.12);
      modDummy.updateMatrix();
      potVases.setMatrixAt(i, modDummy.matrix);
      modDummy.position.set(px, height + gableHeight * 0.55 + 0.5, 0.12);
      modDummy.updateMatrix();
      potFlames.setMatrixAt(i, modDummy.matrix);
    }
    potVases.count = potFlames.count = 2;
    potVases.name = name + ' gable fire pot vase';
    potFlames.name = name + ' gable fire pot flame';
    root.add(potVases, potFlames);
    if (spec.stoneVase) {
      // Le Mont Thabor ("Maison aux Trois Couleurs"): a stone vase crowns the volute gable.
      cylinder(root, 0.22, 0.3, 0.7, 0, height + gableHeight + 0.9, 0.1, stone, 10).name = name + ' gable stone vase';
      box(root, 0.5, 0.08, 0.08, 0, height + gableHeight + 1.3, 0.1, stone, name + ' stone vase rim');
    }
    if (emblem) {
      const kind = emblem === true ? 'phoenix' : emblem;
      if (kind === 'vane') {
        // Le Roy d'Espagne: a small cupola surmounted by a gilded weather vane.
        cylinder(root, 0.55, 0.7, 1.1, 0, height + gableHeight + 0.6, 0.08, stone).name = name + ' cupola';
        mesh(root, new THREE.ConeGeometry(0.65, 0.9, 8), roof, 0, height + gableHeight + 1.6, 0.08, name + ' cupola cap');
        const cupolaLouvers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.08, 0.1), materials.dark, 4);
      const vane = box(root, 1.1, 0.1, 0.06, 0, height + gableHeight + 2.3, 0.08, materials.gold, name + ' gilded weather vane');
        vane.rotation.y = 0.6;
        // Louver slats in the cupola drum below the vane, as on the real Le Roy d'Espagne.
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 4 + Math.PI / 8;
          modDummy.position.set(Math.cos(a) * 0.6, height + gableHeight + 0.6, Math.sin(a) * 0.6);
          modDummy.rotation.y = -a;
          modDummy.updateMatrix();
          cupolaLouvers.setMatrixAt(i, modDummy.matrix);
          modDummy.rotation.y = 0;
        }
        cupolaLouvers.count = 4;
        cupolaLouvers.name = name + ' cupola louver slats';
        root.add(cupolaLouvers);
      } else if (kind === 'horse') {
        // Le Cornet: the ship-stern gable is manned by a gilded horse.
        box(root, 0.9, 0.5, 0.25, 0, height + gableHeight + 1.2, 0.1, materials.gold, name + ' gilded horse body');
        mesh(root, new THREE.SphereGeometry(0.22, 8, 6), materials.gold, 0.5, height + gableHeight + 1.55, 0.1, name + ' gilded horse head');
      } else if (kind === 'helmet') {
        // Le Heaume: gilded helmet.
        mesh(root, new THREE.SphereGeometry(0.4, 10, 8), materials.gold, 0, height + gableHeight + 1.5, 0.1, name + ' gilded helmet emblem');
        box(root, 0.72, 0.12, 0.12, 0, height + gableHeight + 1.12, 0.1, materials.gold, name + ' helmet brim');
      } else if (kind === 'peacock') {
        // Le Paon: gilded peacock with a fanned tail.
        mesh(root, new THREE.SphereGeometry(0.22, 8, 6), materials.gold, 0, height + gableHeight + 1.4, 0.1, name + ' gilded peacock body');
        const fan = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.85, 0.06), materials.gold, 5);
        for (let i = 0; i < 5; i++) {
          modDummy.position.set(0, height + gableHeight + 1.75, 0.1);
          modDummy.rotation.z = (i - 2) * 0.4;
          modDummy.updateMatrix();
          fan.setMatrixAt(i, modDummy.matrix);
        }
        modDummy.rotation.set(0, 0, 0);
        fan.count = 5;
        fan.name = name + ' peacock tail fan';
        root.add(fan);
        // Peacock crest: three gilded eye-balls on the head, as on the real Le Paon emblem.
        const crest = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 5), materials.gold, 3);
        for (let i = 0; i < 3; i++) {
          modDummy.position.set((i - 1) * 0.09, height + gableHeight + 2.32, 0.1);
          modDummy.updateMatrix();
          crest.setMatrixAt(i, modDummy.matrix);
        }
        crest.count = 3;
        crest.name = name + ' peacock crest eyes';
        root.add(crest);
      } else if (kind === 'stag') {
        // Le Cerf: gilded stag head with antlers.
        mesh(root, new THREE.SphereGeometry(0.2, 8, 6), materials.gold, 0, height + gableHeight + 1.5, 0.1, name + ' gilded stag head');
        for (const side of [-1, 1]) {
          const antler = box(root, 0.07, 0.7, 0.07, side * 0.22, height + gableHeight + 1.95, 0.1, materials.gold, name + ' stag antler');
          antler.rotation.z = side * 0.5;
        }
      } else if (kind === 'angel') {
        // L'Ange: gilded angel figure.
        box(root, 0.3, 1.0, 0.14, 0, height + gableHeight + 1.5, 0.1, materials.gold, name + ' gilded angel body');
        mesh(root, new THREE.SphereGeometry(0.16, 8, 6), materials.gold, 0, height + gableHeight + 2.15, 0.1, name + ' angel head');
        for (const side of [-1, 1]) {
          const wing = box(root, 0.5, 0.3, 0.06, side * 0.4, height + gableHeight + 1.8, 0.12, materials.gold, name + ' angel wing');
          wing.rotation.z = side * 0.6;
        }
      } else if (kind === 'boat') {
        // La Chaloupe d'Or: gilded chaloupe (skiff).
        box(root, 0.9, 0.3, 0.3, 0, height + gableHeight + 1.4, 0.1, materials.gold, name + ' gilded chaloupe hull');
        const mast = box(root, 0.06, 0.8, 0.06, 0, height + gableHeight + 1.9, 0.1, materials.gold, name + ' chaloupe mast');
      } else if (kind === 'star') {
        // L'Étoile: gilded star (the house demolished 1852 for the tramway kept its name).
        mesh(root, new THREE.ConeGeometry(0.42, 0.9, 5), materials.gold, 0, height + gableHeight + 1.6, 0.1, name + ' gilded star emblem');
      } else if (kind === 'rose') {
        // La Rose: gilded rose.
        mesh(root, new THREE.SphereGeometry(0.3, 10, 8), materials.gold, 0, height + gableHeight + 1.6, 0.1, name + ' gilded rose emblem');
        mesh(root, new THREE.TorusGeometry(0.34, 0.07, 6, 12), materials.gold, 0, height + gableHeight + 1.6, 0.16, name + ' rose petal ring');
      } else if (kind === 'flags') {
        // Le Mont Thabor (Maison aux Trois Couleurs): cartouche with gilded flags.
        box(root, 0.6, 0.45, 0.12, 0, height + gableHeight + 1.3, 0.14, materials.dark, name + ' flags cartouche');
        for (let i = 0; i < 3; i++) {
          const flag = box(root, 0.14, 0.2, 0.04, -0.2 + i * 0.2, height + gableHeight + 1.55, 0.2, materials.gold, name + ' gilded flag');
          flag.rotation.z = (i - 1) * 0.25;
        }
      } else if (kind === 'barley') {
        // L'Arbre d'Or (brewers): gilded barley sheaf.
        const sheaf = new THREE.InstancedMesh(new THREE.ConeGeometry(0.1, 0.9, 6), materials.gold, 5);
        for (let i = 0; i < 5; i++) {
          modDummy.position.set((i - 2) * 0.12, height + gableHeight + 1.7, 0.1);
          modDummy.rotation.z = (i - 2) * 0.22;
          modDummy.updateMatrix();
          sheaf.setMatrixAt(i, modDummy.matrix);
        }
        modDummy.rotation.set(0, 0, 0);
        sheaf.count = 5;
        sheaf.name = name + ' gilded barley sheaf';
        root.add(sheaf);
      } else {
        // Gilded guild emblem crowning the gable — La Louve's golden phoenix and the like.
        const em = mesh(root, new THREE.SphereGeometry(0.34, 10, 8), materials.gold, 0, height + gableHeight + 1.7, 0.1, name + ' gilded gable emblem');
        em.scale.set(0.7, 1.4, 0.5);
        const wing = box(root, 1.0, 0.14, 0.1, 0, height + gableHeight + 1.95, 0.12, materials.gold, name + ' gilded gable emblem wing');
        wing.rotation.z = 0.35;
      }
    }
    // Gilded ray ring behind every gable emblem — the real emblems are set in radiant discs.
    if (emblem) {
      const rayRing = cylinder(root, 0.62, 0.62, 0.06, 0, height + gableHeight + 1.7, 0.06, materials.gold, 16);
      rayRing.name = name + ' gilded emblem ray ring';
      rayRing.rotation.x = Math.PI / 2;
    }
    if (balustradeStatues) {
      // Le Roy d'Espagne: six statues on the balustrade, the six ingredients of bread.
      for (let i = 0; i < 6; i++) {
        box(root, 0.22, 0.85, 0.12, -width / 2 + 1.2 + i * (width - 2.4) / 5, height + 1.35, 0.14, materials.gold, name + ' balustrade statue');
      }
    }
    // Round oculus set into the gable, and a small triangular pediment over every window.
    const oculus = cylinder(root, 0.42, 0.42, 0.1, 0, height + 1.6, 0.12, materials.glass, 16);
    oculus.name = name + ' gable oculus';
    oculus.rotation.x = Math.PI / 2;
    // Gilded ring tracery around the gable oculus.
    cylinder(root, 0.5, 0.5, 0.08, 0, height + 1.6, 0.14, materials.gold, 16).name = name + ' gable oculus gilded ring';
    // Cross tracery bars divide each gable oculus, as in the real traceried oeil-de-boeuf.
    box(root, 0.06, 0.78, 0.04, 0, height + 1.6, 0.16, stone, name + ' gable oculus tracery vertical');
    box(root, 0.78, 0.06, 0.04, 0, height + 1.6, 0.16, stone, name + ' gable oculus tracery horizontal');
    const pedShape = new THREE.Shape();
    pedShape.moveTo(-0.42, 0); pedShape.lineTo(0, 0.4); pedShape.lineTo(0.42, 0); pedShape.closePath();
    const pediments = new THREE.InstancedMesh(new THREE.ShapeGeometry(pedShape), stone, bays * floors);
    const pedDummy = new THREE.Object3D();
    let pd = 0;
    for (let floor = 1; floor <= floors; floor++) {
      const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
      for (let bay = 0; bay < bays; bay++) {
        const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
        pedDummy.position.set(wx, wy + 1.15, 0.16);
        pedDummy.updateMatrix();
        pediments.setMatrixAt(pd++, pedDummy.matrix);
      }
    }
    pediments.count = pd;
    pediments.name = name + ' window pediments';
    pediments.castShadow = true;
    root.add(pediments);
    if (spec.medallions) {
      // Le Roy d'Espagne (bakers' house): gilded round medallions of the Roman emperors Marcus
      // Aurelius, Nerva, Decius and Trajan at the pilaster joints, and a bust of St Aubert,
      // patron saint of bakers, on the first floor above the arcade.
      const wy2 = 4.4 + (height - 6.6) / Math.max(1, floors - 1);
      const medallions = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20).rotateX(Math.PI / 2), materials.gold, 4);
      for (let i = 0; i < 4; i++) {
        pedDummy.position.set(-(width - 2.8) / 2 + i * bayStep, (4.4 + wy2) / 2, 0.26);
        pedDummy.updateMatrix();
        medallions.setMatrixAt(i, pedDummy.matrix);
      }
      medallions.count = 4;
      medallions.name = name + ' Roman emperor medallions';
      root.add(medallions);
      box(root, 0.5, 0.18, 0.15, 0, 5.45, 0.4, materials.warmStone, name + ' St Aubert bust plinth');
      mesh(root, new THREE.SphereGeometry(0.22, 10, 8), materials.gold, 0, 5.78, 0.44, name + ' St Aubert bust');
    }
    if (spec.continents) {
      // Le Renard (haberdashers' house): on the first-floor balcony the allegory of Justice
      // (blindfolded, with scales and sword) flanked by the four continents — Africa, Europa,
      // Asia and America; St Nicholas, patron of haberdashers, crowns the gable, and a gilded
      // fox sign hangs above the entrance.
      const wy2 = 4.4 + (height - 6.6) / Math.max(1, floors - 1);
      const continentStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1.25, 0.16), materials.gold, 5);
      for (let i = 0; i < 5; i++) {
        pedDummy.position.set((i - 2) * (width - 2.6) / 4, wy2 + 2.0, 0.3);
        pedDummy.updateMatrix();
        continentStatues.setMatrixAt(i, pedDummy.matrix);
      }
      continentStatues.count = 5;
      continentStatues.name = name + ' Justice and four continents statues';
      root.add(continentStatues);
      box(root, 0.3, 0.9, 0.14, 0, height + gableHeight + 1.7, 0.1, materials.gold, name + ' St Nicholas gable statue body');
      mesh(root, new THREE.SphereGeometry(0.24, 8, 6), materials.gold, 0, height + gableHeight + 2.25, 0.1, name + ' St Nicholas gable statue head');
      box(root, 0.8, 0.3, 0.2, 0, 3.95, 0.55, materials.bronze, name + ' fox sign body');
      mesh(root, new THREE.SphereGeometry(0.18, 8, 6), materials.bronze, 0.45, 4.05, 0.55, name + ' fox sign head');
      // The hanging fox sign's bushy tail, as on the real Le Renard enseigne.
      const foxTail = box(root, 0.22, 0.4, 0.08, -0.35, 3.95, 0.55, materials.bronze, name + ' fox sign tail');
      foxTail.rotation.z = 0.6;
      // Four haberdashery bas-relief panels (needles, scissors, thread, buttons) above the
      // ground-floor arcade — the real Le Renard facade tells the guild's trade in relief.
      const reliefs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.5, 0.1), materials.bronze, 4);
      for (let i = 0; i < 4; i++) {
        pedDummy.position.set(-1.5 * bayStep + i * bayStep, 3.95, 0.3);
        pedDummy.updateMatrix();
        reliefs.setMatrixAt(i, pedDummy.matrix);
      }
      reliefs.count = 4;
      reliefs.name = name + ' haberdashery bas-relief panels';
      root.add(reliefs);
    }
    if (spec.caryatids) {
      // Le Renard: caryatids — female figure supports — at the second-floor pilaster
      // joints, as on the real 1699 haberdashers' facade.
      const wy3 = 4.4 + 2 * ((height - 6.6) / Math.max(1, floors - 1));
      const caryatids = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1.6, 0.16), stone, 3);
      const caryatidHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), stone, 3);
      for (let i = 0; i < 3; i++) {
        pedDummy.position.set((i - 1) * bayStep, wy3, 0.26);
        pedDummy.updateMatrix();
        caryatids.setMatrixAt(i, pedDummy.matrix);
        pedDummy.position.set((i - 1) * bayStep, wy3 + 0.95, 0.28);
        pedDummy.updateMatrix();
        caryatidHeads.setMatrixAt(i, pedDummy.matrix);
      }
      caryatids.count = caryatidHeads.count = 3;
      caryatids.name = name + ' second-floor caryatids';
      caryatidHeads.name = name + ' caryatid heads';
      root.add(caryatids, caryatidHeads);
    }
    if (spec.guildTools) {
      // Le Sac (carpenters' and coopers' house, no. 4): the guild tools decorate the facade —
      // a globe crowned by a compass on the gable and gilded tool cartouches above the arcade.
      mesh(root, new THREE.SphereGeometry(0.42, 12, 10), stone, 0, height + gableHeight + 1.5, 0.1, name + ' globe finial');
      box(root, 0.7, 0.08, 0.06, 0, height + gableHeight + 2.05, 0.1, materials.gold, name + ' compass needle N-S');
      const compassDiag = box(root, 0.08, 0.7, 0.06, 0, height + gableHeight + 2.05, 0.1, materials.gold, name + ' compass needle diagonal');
      compassDiag.rotation.z = Math.PI / 4;
      const toolCartouches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.4, 0.12), materials.gold, 3);
      for (let i = 0; i < 3; i++) {
        pedDummy.position.set((i - 1) * bayStep, 3.95, 0.32);
        pedDummy.updateMatrix();
        toolCartouches.setMatrixAt(i, pedDummy.matrix);
      }
      toolCartouches.count = 3;
      toolCartouches.name = name + ' carpenter tool cartouches';
      root.add(toolCartouches);
    }
    if (spec.garlands) {
      // Le Sac: stone garlands of flowers and fruits swag beneath every window — the real
      // carpenters'/coopers' facade is festooned with them.
      const garlandCount = bays * floors;
      const ribbons = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.1, 0.08), stone, garlandCount);
      const fruits = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5), materials.green, garlandCount * 3);
      let rg = 0, fr = 0;
      for (let floor = 1; floor <= floors; floor++) {
        const wy = 4.4 + (floor - 1) * ((height - 6.6) / Math.max(1, floors - 1));
        for (let bay = 0; bay < bays; bay++) {
          const wx = (bay - (bays - 1) / 2) * (width - 2.8) / Math.max(1, bays - 1);
          pedDummy.position.set(wx, wy - 0.95, 0.18);
          pedDummy.updateMatrix();
          ribbons.setMatrixAt(rg++, pedDummy.matrix);
          for (let f = 0; f < 3; f++) {
            pedDummy.position.set(wx - 0.3 + f * 0.3, wy - 1.0 - Math.sin((f + 1) * Math.PI / 4) * 0.12, 0.2);
            pedDummy.updateMatrix();
            fruits.setMatrixAt(fr++, pedDummy.matrix);
          }
        }
      }
      ribbons.count = rg;
      fruits.count = fr;
      ribbons.name = name + ' flower garland ribbons';
      fruits.name = name + ' garland fruit and flower dots';
      root.add(ribbons, fruits);
    }
    if (spec.brouette) {
      // La Brouette (greasers' house, nos. 2-3): the gable's pediment holds an arched niche with
      // St Giles, patron of greasers (with his deer and a scallop); the centre cartouche carries
      // a gilded wheelbarrow on blue and the side cartouches the rebuild date Anno 1697.
      const wyB = 4.4 + (height - 6.6) / Math.max(1, floors - 1);
      box(root, 0.7, 1.5, 0.24, 0, height + gableHeight + 0.3, 0.34, materials.dark, name + ' St Giles arched niche');
      box(root, 0.28, 1.0, 0.14, 0, height + gableHeight + 0.35, 0.48, materials.gold, name + ' St Giles statue');
      mesh(root, new THREE.SphereGeometry(0.15, 8, 6), materials.gold, 0, height + gableHeight + 1.05, 0.48, name + ' St Giles statue head');
      // St Giles' deer (his attribute) and a pilgrim scallop beside the niche, as on the real
      // La Brouette pediment.
      box(root, 0.3, 0.22, 0.1, 0.55, height + gableHeight + 0.1, 0.48, materials.gold, name + ' St Giles deer');
      mesh(root, new THREE.SphereGeometry(0.09, 8, 6), materials.gold, -0.55, height + gableHeight + 0.2, 0.48, name + ' pilgrim scallop shell');
      box(root, 0.6, 0.45, 0.14, 0, (4.4 + wyB) / 2, 0.3, materials.dark, name + ' wheelbarrow cartouche ground');
      box(root, 0.45, 0.2, 0.06, 0, (4.4 + wyB) / 2, 0.4, materials.gold, name + ' gilded wheelbarrow');
      box(root, 0.55, 0.3, 0.12, -bayStep, wyB - 1.35, 0.28, materials.warmStone, name + ' Anno 1697 cartouche');
      box(root, 0.55, 0.3, 0.12, bayStep, wyB - 1.35, 0.28, materials.warmStone, name + ' Anno 1697 cartouche');
    }
    if (spec.pilasters) {
      // La Brouette: colossal pilasters rise the full facade height between the bays,
      // carrying the four classical orders of the real 1697 greasers' facade.
      const ph = height - 1.9;
      const px = [-width / 2 + 0.25, -(width - 2.8) / 4, (width - 2.8) / 4, width / 2 - 0.25];
      const pilasters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, ph, 0.2), materials.warmStone, 4);
      for (let i = 0; i < 4; i++) {
        pedDummy.position.set(px[i], 1.15 + ph / 2, 0.12);
        pedDummy.updateMatrix();
        pilasters.setMatrixAt(i, pedDummy.matrix);
      }
      pilasters.count = 4;
      pilasters.name = name + ' colossal pilaster bands';
      root.add(pilasters);
    }
    if (spec.louve) {
      // La Louve (archers' oath, no. 5): a bronze bas-relief of Romulus and Remus suckled by the
      // she-wolf sits in the gable base, and the pediment above carries Apollo (restored 1890-92).
      box(root, 1.0, 0.62, 0.12, 0, height + 0.9, 0.2, materials.bronze, name + ' Romulus and Remus relief panel');
      mesh(root, new THREE.SphereGeometry(0.09, 8, 6), materials.bronze, -0.18, height + 1.05, 0.3, name + ' Romulus relief figure');
      mesh(root, new THREE.SphereGeometry(0.09, 8, 6), materials.bronze, 0.18, height + 1.05, 0.3, name + ' Remus relief figure');
      box(root, 0.5, 0.3, 0.12, 0, height + 0.75, 0.3, materials.bronze, name + ' she-wolf relief body');
      const apollo = new THREE.Shape();
      apollo.moveTo(-0.6, 0); apollo.lineTo(0, 0.5); apollo.lineTo(0.6, 0); apollo.closePath();
      mesh(root, new THREE.ShapeGeometry(apollo), stone, 0, height + 2.6, 0.14, name + ' Apollo pediment');
      // The she-wolf's tail and hind legs complete the Romulus-and-Remus relief.
      const wtail = box(root, 0.5, 0.08, 0.08, 0, height + 0.72, 0.3, materials.bronze, name + ' she-wolf tail');
      wtail.rotation.z = -0.4;
      box(root, 0.08, 0.2, 0.08, -0.15, height + 0.62, 0.3, materials.bronze, name + ' she-wolf hind leg');
    }
    if (spec.cornet) {
      // Le Cornet (boatmen's house, no. 6): the gable is drawn as a galleon's stern manned by a
      // gilded horse (the horse emblem); the facade is covered in nautical symbols — the gilded
      // horn (cornet) beside the horse and an anchor cartouche on the storey band.
      mesh(root, new THREE.ConeGeometry(0.22, 0.8, 8), materials.gold, 1.1, height + gableHeight + 1.2, 0.1, name + ' gilded horn');
      box(root, 0.1, 0.7, 0.08, -0.9, 8.2, 0.3, materials.gold, name + ' anchor shank');
      box(root, 0.5, 0.08, 0.08, -0.9, 7.92, 0.3, materials.gold, name + ' anchor stock');
      const anchorArms = box(root, 0.5, 0.08, 0.08, -0.9, 7.58, 0.3, materials.gold, name + ' anchor arms');
      anchorArms.rotation.z = 0.5;
      // Stern windows of the galleon's castle manned by the horse, on the Le Cornet gable.
      for (const side of [-1, 1]) {
        box(root, 0.3, 0.4, 0.1, side * 0.8, height + gableHeight + 0.4, 0.12, glowGlass, name + ' galleon stern window');
      }
    }
    if (spec.equestrian) {
      // L'Arbre d'Or (brewers' guild house, no. 10): the roof carries a gilded equestrian statue
      // of Duke Charles of Lorraine, installed 1901 (replacing Maximilian II Emmanuel of Bavaria).
      box(root, 0.9, 0.5, 0.4, 0, height + gableHeight + 1.0, 0.1, materials.gold, name + ' equestrian horse body');
      box(root, 0.3, 0.45, 0.3, 0.55, height + gableHeight + 1.35, 0.1, materials.gold, name + ' equestrian horse head');
      box(root, 0.34, 1.0, 0.24, 0, height + gableHeight + 1.85, 0.1, materials.gold, name + ' Charles of Lorraine rider');
      mesh(root, new THREE.SphereGeometry(0.16, 8, 6), materials.gold, 0, height + gableHeight + 2.45, 0.1, name + ' Charles of Lorraine rider head');
      // The equestrian horse's legs, as on the real 1901 Charles of Lorraine statue.
      for (const [lx, lz] of [[-0.3, -0.12], [-0.3, 0.12], [0.3, -0.12], [0.3, 0.12]]) {
        box(root, 0.1, 0.55, 0.1, lx, height + gableHeight + 0.55, lz + 0.1, materials.gold, name + ' equestrian horse leg');
      }
    }
    if (spec.dukeBusts) {
      // Maison des Ducs de Brabant (east side, nos. 13-19 behind a single facade): stone busts
      // of the dukes of Brabant line the pilasters of the facade.
      // Nineteen busts of the dukes of Brabant line the pilasters of the real Dukes facade.
      const bustDiscs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 12).rotateX(Math.PI / 2), materials.warmStone, 19);
      const bustHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 8, 6), stone, 19);
      for (let i = 0; i < 19; i++) {
        const bx = -width / 2 + 0.7 + i * (width - 1.4) / 18;
        pedDummy.position.set(bx, height * 0.55, 0.18);
        pedDummy.updateMatrix();
        bustDiscs.setMatrixAt(i, pedDummy.matrix);
        pedDummy.position.set(bx, height * 0.55 + 0.24, 0.24);
        pedDummy.updateMatrix();
        bustHeads.setMatrixAt(i, pedDummy.matrix);
      }
      bustDiscs.count = bustHeads.count = 19;
      bustDiscs.name = name + ' duke bust discs';
      bustHeads.name = name + ' Dukes of Brabant busts';
      root.add(bustDiscs, bustHeads);
    }
    if (spec.abundance) {
      // La Rose (centre of the Dukes of Brabant facade): the sculptured allegory of Abundance
      // sits under the curved pediment of the gable.
      box(root, 0.3, 1.0, 0.14, 0, height + 1.0, 0.18, materials.gold, name + ' Abundance allegory');
      mesh(root, new THREE.SphereGeometry(0.18, 8, 6), materials.gold, 0, height + 1.65, 0.18, name + ' Abundance allegory head');
    }
    if (spec.swan) {
      // Le Cygne (butchers' house, no. 9): the sculptured swan above the doorway gives the house
      // its name.
      mesh(root, new THREE.SphereGeometry(0.3, 10, 8), materials.gold, 0, 4.1, 0.5, name + ' sculptured swan body');
      const neck = cylinder(root, 0.07, 0.09, 0.8, 0, 4.55, 0.5, materials.gold, 6);
      neck.name = name + ' swan neck';
      neck.rotation.z = -0.5;
      mesh(root, new THREE.SphereGeometry(0.12, 8, 6), materials.gold, 0.22, 4.9, 0.5, name + ' swan head');
      // Folded wings on the sculptured swan's body, as on the real Le Cygne sign.
      for (const side of [-1, 1]) {
        const sw = box(root, 0.34, 0.16, 0.08, side * 0.2, 4.12, 0.5, materials.gold, name + ' swan wing');
        sw.rotation.z = side * 0.5;
      }
    }
    if (spec.saintStatue) {
      // Sainte-Barbe: a statue of St Barbara in a niche at the gable base.
      box(root, 0.7, 1.9, 0.22, 0, height + 0.95, 0.16, materials.dark, name + ' St Barbara niche');
      box(root, 0.28, 1.05, 0.12, 0, height + 0.95, 0.3, materials.gold, name + ' St Barbara statue');
      mesh(root, new THREE.SphereGeometry(0.15, 8, 6), materials.gold, 0, height + 1.65, 0.3, name + ' St Barbara statue head');
    }
    return root;
  }

  function townHall(parent) {
    // Brussels City Hall (Hôtel de Ville), south side of the Grand-Place: two asymmetrical
    // Brabantine-Gothic wings framing an off-centre tower that rises from the ground-level
    // portal to the real 96 m, crowned by a gilded Saint Michael. Local +Z faces the square.
    const root = new THREE.Group();
    root.name = 'Brussels Town Hall (Hôtel de Ville)';
    root.position.set(17, 0, 0);
    parent.add(root);

    const width = 56, height = 27, depth = 16;
    const stone = materials.paleStone;
    const trim = materials.limestone;
    const darkStone = materials.warmStone;
    const roofMat = materials.slate;
    const glass = glowGlass;

    // Two genuinely asymmetrical wings, built in two campaigns: the shorter east wing
    // (1401-1421, local -X = world east when facing the facade) and the longer west wing
    // (1444+, local +X), with the tower rising in the gap between their inner faces.
    const towerX = -8.5;
    const eastWingX = towerX - 4.5 - 7.5;   // east wing spans -28 .. -13
    const westWingX = towerX + 4.5 + 16;     // west wing spans  -4 .. +28
    box(root, 15, height, depth, eastWingX, height / 2, -depth / 2, stone, 'Town Hall east wing (1401-1421)');
    box(root, 32, height, depth, westWingX, height / 2, -depth / 2, stone, 'Town Hall west wing (1444+)');
    box(root, 16.8, 1.0, depth + 1.0, eastWingX, 0.5, -depth / 2, darkStone, 'East wing stepped stone plinth');
    box(root, 33.8, 1.0, depth + 1.0, westWingX, 0.5, -depth / 2, darkStone, 'West wing stepped stone plinth');
    box(root, 16.0, 0.8, depth + 0.8, eastWingX, height - 0.35, -depth / 2, trim, 'East wing upper cornice');
    box(root, 33.0, 0.8, depth + 0.8, westWingX, height - 0.35, -depth / 2, trim, 'West wing upper cornice');
    // Drip moulds under both wing cornices shed water off the facade.
    const corniceDrips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.07, 0.5), darkStone, 2);
    const cdrip = new THREE.Object3D();
    cdrip.position.set(eastWingX, height - 0.82, 0.25);
    cdrip.scale.set(16, 1, 1);
    cdrip.updateMatrix();
    corniceDrips.setMatrixAt(0, cdrip.matrix);
    cdrip.position.set(westWingX, height - 0.82, 0.25);
    cdrip.scale.set(32, 1, 1);
    cdrip.updateMatrix();
    corniceDrips.setMatrixAt(1, cdrip.matrix);
    cdrip.scale.set(1, 1, 1);
    corniceDrips.count = 2;
    corniceDrips.name = 'Wing cornice drip moulds';
    root.add(corniceDrips);
    // Glazed windows pierce the outer side elevations of both wings toward the side streets,
    // and fine coursing grooves run the wing facades; sloped water tables cap the plinths.
    const wingSideWin = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 3.0, 1.5), glass, 8);
    const coursing = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.045, 0.05), materials.dark, 16);
    const thPlinthTables = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 0.5), materials.dark, 2);
    const wd2 = new THREE.Object3D();
    let wsw = 0, cg = 0;
    for (const [wx, ww, sx] of [[eastWingX, 15, -1], [westWingX, 32, 1]]) {
      const faceX = wx + sx * (ww / 2 + 0.05);
      for (let r = 0; r < 4; r++) {
        wd2.position.set(faceX, 7 + r * 5.5, -depth / 2 + 3 + r * 3.2);
        wd2.updateMatrix();
        wingSideWin.setMatrixAt(wsw++, wd2.matrix);
      }
      for (let g = 0; g < 8; g++) {
        wd2.position.set(wx, 5 + g * 2.9, 0.18);
        wd2.scale.set(ww, 1, 1);
        wd2.updateMatrix();
        coursing.setMatrixAt(cg++, wd2.matrix);
        wd2.scale.set(1, 1, 1);
      }
      wd2.position.set(wx, 1.08, 0.28);
      wd2.scale.set(ww + 0.6, 1, 1);
      wd2.updateMatrix();
      thPlinthTables.setMatrixAt(sx > 0 ? 1 : 0, wd2.matrix);
      wd2.scale.set(1, 1, 1);
    }
    wingSideWin.count = wsw;
    coursing.count = cg;
    thPlinthTables.count = 2;
    wingSideWin.name = 'Town Hall wing side-elevation windows';
    coursing.name = 'Town Hall wing coursing grooves';
    thPlinthTables.name = 'Town Hall wing plinth water tables';
    root.add(wingSideWin, coursing, thPlinthTables);
    // Gilded trim lines ride on both wing cornices, as on the real facade.
    for (const [wx, ww] of [[eastWingX, 16], [westWingX, 33]]) {
      box(root, ww, 0.06, 0.1, wx, height + 0.02, 0.22, materials.gold, 'Wing cornice gold trim');
    }
    // Both wing cornices stand on rows of corbels (modillions), like the guild houses.
    const wingMods = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.34, 0.34), darkStone, 40);
    const wmd = new THREE.Object3D();
    let wm = 0;
    for (const [wx, ww] of [[eastWingX, 16], [westWingX, 33]]) {
      const n = Math.floor(ww / 1.2);
      for (let i = 0; i < n; i++) {
        wmd.position.set(wx - ww / 2 + 0.5 + i * (ww - 1) / (n - 1), height - 0.85, 0.2);
        wmd.updateMatrix();
        wingMods.setMatrixAt(wm++, wmd.matrix);
      }
    }
    wingMods.count = wm;
    wingMods.name = 'Town Hall wing cornice modillions';
    root.add(wingMods);
    // Oversized stone quoins chain the front corners of both wings, as on the real facade.
    const wqRows = Math.floor((height - 2) / 0.9);
    const wingQuoins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), trim, wqRows * 4);
    const wqd = new THREE.Object3D();
    let wq = 0;
    for (const [wx, ww] of [[eastWingX, 15], [westWingX, 32]]) {
      for (let r = 0; r < wqRows; r++) {
        for (const sx of [-1, 1]) {
          wqd.position.set(wx + sx * (ww / 2 - 0.1), 1.4 + r * 0.9, 0.15);
          wqd.updateMatrix();
          wingQuoins.setMatrixAt(wq++, wqd.matrix);
        }
      }
    }
    wingQuoins.count = wq;
    wingQuoins.name = 'Town Hall wing corner quoins';
    root.add(wingQuoins);

    // Repeated pointed ground-floor arcade: dark recessed openings, piers and pointed heads.
    const bays = 16, bayW = width / bays;
    // The real ground arcade is highly asymmetrical: the east (left) wing carries ELEVEN
    // arches while the west (right) wing carries only SIX — build the arch list per wing.
    const wingArcs = [[eastWingX, 15, 11], [westWingX, 32, 6]];
    const arcBaysList = [];
    for (const [wx0, ww, nb] of wingArcs) {
      const segW = ww / nb;
      for (let i = 0; i < nb; i++) arcBaysList.push([wx0 - ww / 2 + segW * (i + 0.5), segW]);
    }
    const arcBays = arcBaysList.length;
    // The arcade pillars are adorned with statues of knights and squires of the Seven Noble
    // Houses of Brussels — instanced gilded figures on top of every pier.
    const knightStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.95, 0.12), materials.gold, arcBays * 2);
    const voussoirs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.3, 0.34), trim, arcBays * 6);
    const vd = new THREE.Object3D();
    let vi = 0;
    const knightDummy = new THREE.Object3D();
    let kn = 0;
    for (const [x, segW] of arcBaysList) {
      box(root, 1.72, 6.0, 0.24, x, 4.0, 0.19, glass, 'Town Hall recessed Gothic arcade');
      box(root, 0.34, 7.1, 0.55, x - segW / 2 + 0.12, 4.1, 0.22, trim, 'Arcade pier');
      box(root, 0.34, 7.1, 0.55, x + segW / 2 - 0.12, 4.1, 0.22, trim, 'Arcade pier');
      for (const px of [x - segW / 2 + 0.12, x + segW / 2 - 0.12]) {
        knightDummy.position.set(px, 7.85, 0.3);
        knightDummy.updateMatrix();
        knightStatues.setMatrixAt(kn++, knightDummy.matrix);
      }
      // pointed arch head, built from two sloping stone ribs
      const archL = box(root, 2.05, 0.28, 0.48, x - 0.52, 7.12, 0.22, trim, 'Pointed arcade arch');
      archL.rotation.z = -0.55;
      const archR = box(root, 2.05, 0.28, 0.48, x + 0.52, 7.12, 0.22, trim, 'Pointed arcade arch');
      archR.rotation.z = 0.55;
      box(root, segW - 0.55, 0.24, 0.5, x, 7.55, 0.22, darkStone, 'Arcade string course');
      for (const t of [0.3, 0.6, 0.9]) {
        for (const side of [-1, 1]) {
          vd.position.set(x + side * (0.52 - t * 0.95), 7.12 + t * 0.62, 0.24);
          vd.rotation.z = side * 0.55;
          vd.updateMatrix();
          voussoirs.setMatrixAt(vi++, vd.matrix);
        }
      }
    }
    voussoirs.count = vi;
    voussoirs.name = 'Arcade arch voussoirs';
    root.add(voussoirs);
    knightStatues.count = kn;
    knightStatues.name = 'Arcade pillar knight statues (Noble Houses)';
    knightStatues.castShadow = true;
    root.add(knightStatues);
    // Cabbage-leaf (kropblad) finials top each ground-arcade arch apex, and a trefoil
    // arcade band runs above the arcade string course — both Brabantine-Gothic motifs of
    // the real facade. The knights rest on historiated corbels.
    const leafFinials = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), materials.gold, arcBays);
    const trefoilBand = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12).rotateX(Math.PI / 2), trim, arcBays);
    const histCorbels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.42, 0.4), darkStone, arcBays * 2);
    let lf = 0, hc = 0;
    for (const [x, segW] of arcBaysList) {
      vd.position.set(x, 7.82, 0.28);
      vd.rotation.z = 0;
      vd.updateMatrix();
      leafFinials.setMatrixAt(lf++, vd.matrix);
      vd.position.set(x, 8.05, 0.26);
      vd.updateMatrix();
      trefoilBand.setMatrixAt(lf - 1, vd.matrix);
      for (const px of [x - segW / 2 + 0.12, x + segW / 2 - 0.12]) {
        vd.position.set(px, 7.45, 0.32);
        vd.updateMatrix();
        histCorbels.setMatrixAt(hc++, vd.matrix);
      }
    }
    leafFinials.count = trefoilBand.count = arcBays;
    histCorbels.count = hc;
    leafFinials.name = 'Arcade arch cabbage-leaf finials';
    trefoilBand.name = 'Arcade trefoil band';
    histCorbels.name = 'Knight statue historiated corbels';
    root.add(leafFinials, trefoilBand, histCorbels);
    // Capitals widen the top of every arcade pier, as on the real Brabantine arcade.
    const pierCapitals = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 0.22, 0.6), trim, arcBays * 2);
    let pc = 0;
    for (const [x, segW] of arcBaysList) {
      for (const px of [x - segW / 2 + 0.12, x + segW / 2 - 0.12]) {
        vd.position.set(px, 7.62, 0.24);
        vd.rotation.z = 0;
        vd.updateMatrix();
        pierCapitals.setMatrixAt(pc++, vd.matrix);
      }
    }
    pierCapitals.count = pc;
    pierCapitals.name = 'Arcade pier capitals';
    root.add(pierCapitals);
    // Gilded trim lines ride on each arcade pier capital, as on the real piers.
    const capTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.48, 0.06, 0.14), materials.gold, arcBays * 2);
    let ct = 0;
    for (const [x, segW] of arcBaysList) {
      for (const px of [x - segW / 2 + 0.12, x + segW / 2 - 0.12]) {
        vd.position.set(px, 7.76, 0.26);
        vd.rotation.z = 0;
        vd.updateMatrix();
        capTrim.setMatrixAt(ct++, vd.matrix);
      }
    }
    capTrim.count = ct;
    capTrim.name = 'Arcade pier capital gold trim';
    root.add(capTrim);
    // Cross-vault ribs spring over every ground-arcade bay — the real arcade is vaulted.
    const vaultRibs = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.14, 0.18), trim, arcBays);
    let vr = 0;
    for (const [x] of arcBaysList) {
      vd.position.set(x, 7.35, 0.3);
      vd.rotation.z = (vr % 2 ? -1 : 1) * 0.42;
      vd.updateMatrix();
      vaultRibs.setMatrixAt(vr++, vd.matrix);
      vd.rotation.z = 0;
    }
    vaultRibs.count = arcBays;
    vaultRibs.name = 'Arcade cross-vault ribs';
    root.add(vaultRibs);
    // A keystone caps each pointed arcade arch, as on the real arches.
    const arcKeystones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.42, 0.5), darkStone, arcBays);
    let ak = 0;
    for (const [x] of arcBaysList) {
      vd.position.set(x, 7.78, 0.26);
      vd.rotation.z = 0;
      vd.updateMatrix();
      arcKeystones.setMatrixAt(ak++, vd.matrix);
    }
    arcKeystones.count = ak;
    arcKeystones.name = 'Arcade arch keystones';
    root.add(arcKeystones);
    // Gilded caps top each arcade keystone, as on the real arches.
    const keystoneCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), materials.gold, arcBays);
    let kc = 0;
    for (const [x] of arcBaysList) {
      vd.position.set(x, 8.05, 0.28);
      vd.updateMatrix();
      keystoneCaps.setMatrixAt(kc++, vd.matrix);
    }
    keystoneCaps.count = kc;
    keystoneCaps.name = 'Arcade keystone gold caps';
    root.add(keystoneCaps);
    // Dark vault infill panels close each arcade bay between the ribs, as on the real vaulted
    // ground floor.
    const vaultInfills = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.08, 0.4), materials.dark, arcBays);
    let vi2 = 0;
    for (const [x] of arcBaysList) {
      vd.position.set(x, 7.18, 0.32);
      vd.rotation.z = 0;
      vd.updateMatrix();
      vaultInfills.setMatrixAt(vi2++, vd.matrix);
    }
    vaultInfills.count = arcBays;
    vaultInfills.name = 'Arcade vault infill panels';
    root.add(vaultInfills);
    // Springer stones where each pointed arch leaves its pier.
    const springers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.36, 0.5), trim, arcBays * 2);
    let sp = 0;
    for (const [x, segW] of arcBaysList) {
      for (const side of [-1, 1]) {
        vd.position.set(x + side * (segW / 2 - 0.12), 6.95, 0.26);
        vd.rotation.z = side * 0.3;
        vd.updateMatrix();
        springers.setMatrixAt(sp++, vd.matrix);
        vd.rotation.z = 0;
      }
    }
    springers.count = sp;
    springers.name = 'Arcade arch springer stones';
    root.add(springers);
    // Plinth blocks at the foot of every arcade pier.
    const pierPlinths = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 0.4, 0.65), darkStone, arcBays * 2);
    let pp = 0;
    for (const [x, segW] of arcBaysList) {
      for (const side of [-1, 1]) {
        vd.position.set(x + side * (segW / 2 - 0.12), 0.2, 0.24);
        vd.rotation.z = 0;
        vd.updateMatrix();
        pierPlinths.setMatrixAt(pp++, vd.matrix);
      }
    }
    pierPlinths.count = pp;
    pierPlinths.name = 'Arcade pier plinth blocks';
    root.add(pierPlinths);
    // Gilded trim rides on the arcade string course of the real facade.
    box(root, width - 0.4, 0.05, 0.08, 0, 7.7, 0.24, materials.gold, 'Arcade string course gold trim');
    // A stone balcony connects the two wings across the facade above the arcade, on a row of
    // balusters — as on the real elevation.
    box(root, width + 1.2, 0.4, 1.3, 0, 8.7, 0.55, trim, 'Wing-connecting balcony');
    // A top rail and corner posts finish the wing-connecting balcony, as on the real facade.
    box(root, width + 1.2, 0.1, 0.12, 0, 9.5, 1.12, trim, 'Wing balcony top rail');
    for (const side of [-1, 1]) {
      box(root, 0.16, 0.85, 0.16, side * (width / 2 + 0.5), 9.1, 1.12, trim, 'Wing balcony corner post');
    }
    // A gilded medallion centres the wing-connecting balcony, as on the real facade.
    mesh(root, new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16).rotateX(Math.PI / 2), materials.gold, 0, 8.7, 1.25, 'Wing balcony center medallion');
    const wingBalusters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), trim, 48);
    const wbd = new THREE.Object3D();
    let wb = 0;
    for (let i = 0; i < 48; i++) {
      wbd.position.set(-width / 2 + 0.7 + i * (width - 1.4) / 47, 9.15, 1.05);
      wbd.updateMatrix();
      wingBalusters.setMatrixAt(wb++, wbd.matrix);
    }
    wingBalusters.count = wb;
    wingBalusters.name = 'Wing-connecting balcony balusters';
    root.add(wingBalusters);
    // Historiated corbels carry the wing-connecting balcony along its length.
    const balconyCorbels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.45, 0.5), darkStone, 16);
    for (let i = 0; i < 16; i++) {
      wbd.position.set(-width / 2 + 1.5 + i * (width - 3) / 15, 8.25, 0.85);
      wbd.updateMatrix();
      balconyCorbels.setMatrixAt(i, wbd.matrix);
    }
    balconyCorbels.count = 16;
    balconyCorbels.name = 'Wing balcony historiated corbels';
    root.add(balconyCorbels);
    // Gilded caps finish each wing-balcony corbel, as on the real balcony.
    const corbelCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), materials.gold, 16);
    for (let i = 0; i < 16; i++) {
      wbd.position.set(-width / 2 + 1.5 + i * (width - 3) / 15, 8.5, 0.85);
      wbd.updateMatrix();
      corbelCaps.setMatrixAt(i, wbd.matrix);
    }
    corbelCaps.count = 16;
    corbelCaps.name = 'Wing balcony corbel gold caps';
    root.add(corbelCaps);
    // Small gabled canopy hoods shelter the statues standing above the arcade arch heads.
    const canopyShape = new THREE.Shape();
    canopyShape.moveTo(-0.45, 0); canopyShape.lineTo(0, 0.4); canopyShape.lineTo(0.45, 0); canopyShape.closePath();
    const canopies = new THREE.InstancedMesh(new THREE.ShapeGeometry(canopyShape), trim, arcBays);
    let cn = 0;
    for (const [x] of arcBaysList) {
      wbd.position.set(x, 9.85, 0.3);
      wbd.updateMatrix();
      canopies.setMatrixAt(cn++, wbd.matrix);
    }
    canopies.count = cn;
    canopies.name = 'Arcade statue canopy hoods';
    root.add(canopies);
    // Gilded crocket balls tip each arcade statue canopy hood, as on the real canopies.
    const canopyCrochets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 6, 5), materials.gold, arcBays);
    for (let i = 0; i < arcBays; i++) {
      wbd.position.set(arcBaysList[i][0], 10.32, 0.3);
      wbd.updateMatrix();
      canopyCrochets.setMatrixAt(i, wbd.matrix);
    }
    canopyCrochets.count = arcBays;
    canopyCrochets.name = 'Arcade canopy crocket balls';
    root.add(canopyCrochets);

    // Upper storeys: paired lancets with stone mouldings, balconies, a buttress rhythm at
    // alternating bay joints, and a gilded statue in a niche at the remaining joints — the
    // real facade is densely packed with niches holding dukes, saints and allegorical figures.
    const facadeNiches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 2.5, 0.22), darkStone, bays * 2 + 2);
    const facadeStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 1.15, 0.14), materials.gold, bays * 2 + 2);
    const facadeDummy = new THREE.Object3D();
    let nicheIndex = 0;
    // Plate tracery on the paired upper-storey lancets: a central mullion splitting each pair
    // into twin lights, a quatrefoil oculus above the pair and a keystone at each arch apex — the
    // real facade's two upper floors are large mullioned windows under pointed hood moulds.
    const lancetMullions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 4.4, 0.2), trim, bays * 2);
    const lancetOculi = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 12).rotateX(Math.PI / 2), trim, bays * 2);
    const lancetKeystones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.42, 0.3), darkStone, bays * 2);
    let traceryIndex = 0;
    const pinnacleSpires = new THREE.InstancedMesh(new THREE.ConeGeometry(0.34, 1.9, 8), trim, bays / 2 + 1);
    const pinnacleFinials = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), materials.gold, bays / 2 + 1);
    const pinDummy = new THREE.Object3D();
    let pin = 0;
    for (let i = 0; i <= bays; i++) {
      if (i % 2 === 0) {
        const x = -width / 2 + i * bayW;
        box(root, 0.48, 17.5, 0.62, x, 15.4, 0.12, trim, 'Gothic facade buttress');
        box(root, 0.2, 2.2, 0.18, x, height - 1.6, 0.42, darkStone, 'Facade pinnacle base');
        pinDummy.position.set(x, height + 0.45, 0.42);
        pinDummy.updateMatrix();
        pinnacleSpires.setMatrixAt(pin, pinDummy.matrix);
        pinDummy.position.set(x, height + 1.55, 0.42);
        pinDummy.updateMatrix();
        pinnacleFinials.setMatrixAt(pin, pinDummy.matrix);
        pin++;
      }
    }
    // Every facade buttress stands on a plinth block and is weathered to a slope at its top;
    // a gargoyle spout projects from each pinnacle base — the real buttresses are dressed thus.
    const buttressPlinths = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 0.5, 0.85), darkStone, pin);
    const buttressWeather = new THREE.InstancedMesh(new THREE.BoxGeometry(0.56, 0.7, 0.72), trim, pin);
    const pinGargoyles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.4, 0.6), darkStone, pin);
    for (let i = 0, p = 0; i <= bays; i++) {
      if (i % 2 === 0) {
        const x = -width / 2 + i * bayW;
        pinDummy.position.set(x, 0.25, 0.1);
        pinDummy.updateMatrix();
        buttressPlinths.setMatrixAt(p, pinDummy.matrix);
        pinDummy.position.set(x, height - 0.1, 0.1);
        pinDummy.rotation.z = 0.18;
        pinDummy.updateMatrix();
        buttressWeather.setMatrixAt(p, pinDummy.matrix);
        pinDummy.rotation.z = 0;
        pinDummy.position.set(x, height - 1.9, 0.5);
        pinDummy.updateMatrix();
        pinGargoyles.setMatrixAt(p, pinDummy.matrix);
        p++;
      }
    }
    buttressPlinths.count = buttressWeather.count = pinGargoyles.count = pin;
    buttressPlinths.name = 'Buttress base plinths';
    buttressWeather.name = 'Buttress weathered tops';
    pinGargoyles.name = 'Pinnacle base gargoyle spouts';
    root.add(buttressPlinths, buttressWeather, pinGargoyles);
    // Gilded caps finish each weathered buttress top, as on the real pinnacle weatherings.
    const weatherCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), materials.gold, pin);
    for (let i = 0, p = 0; i <= bays; i++) {
      if (i % 2 === 0) {
        pinDummy.position.set(-width / 2 + i * bayW, height + 0.3, 0.1);
        pinDummy.updateMatrix();
        weatherCaps.setMatrixAt(p++, pinDummy.matrix);
      }
    }
    weatherCaps.count = pin;
    weatherCaps.name = 'Buttress weathering gold caps';
    root.add(weatherCaps);
    pinnacleSpires.count = pinnacleFinials.count = pin;
    pinnacleSpires.name = 'Facade pinnacle spire';
    pinnacleFinials.name = 'Facade pinnacle gilded finial';
    root.add(pinnacleSpires, pinnacleFinials);
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i < bays; i++) {
        const x = -width / 2 + bayW * (i + 0.5);
        for (const side of [-1, 1]) {
          box(root, 0.88, 4.4, 0.18, x + side * 0.52, y, 0.25, glass, 'Tall Gothic lancet');
          box(root, 0.12, 4.75, 0.25, x + side * 0.52, y, 0.1, trim, 'Lancet stone moulding');
        }
        box(root, 2.55, 0.22, 0.42, x, y - 2.45, 0.22, darkStone, 'Gothic window sill');
        box(root, 2.7, 0.25, 0.48, x, y + 2.45, 0.22, trim, 'Gothic window hood');
        const balcony = box(root, 2.5, 0.22, 0.95, x, y - 2.65, 0.58, trim, 'Stone balcony');
        balcony.castShadow = true;
        facadeDummy.position.set(x, y, 0.3);
        facadeDummy.updateMatrix();
        lancetMullions.setMatrixAt(traceryIndex, facadeDummy.matrix);
        facadeDummy.position.set(x, y + 1.8, 0.3);
        facadeDummy.updateMatrix();
        lancetOculi.setMatrixAt(traceryIndex, facadeDummy.matrix);
        facadeDummy.position.set(x, y + 2.45, 0.34);
        facadeDummy.updateMatrix();
        lancetKeystones.setMatrixAt(traceryIndex, facadeDummy.matrix);
        traceryIndex++;
      }
      for (let i = 1; i <= bays; i += 2) {
        const x = -width / 2 + i * bayW;
        facadeDummy.position.set(x, y, 0.15);
        facadeDummy.updateMatrix();
        facadeNiches.setMatrixAt(nicheIndex, facadeDummy.matrix);
        facadeDummy.position.set(x, y, 0.3);
        facadeDummy.updateMatrix();
        facadeStatues.setMatrixAt(nicheIndex, facadeDummy.matrix);
        nicheIndex++;
      }
    }
    lancetMullions.count = lancetOculi.count = lancetKeystones.count = traceryIndex;
    lancetMullions.name = 'Lancet mullion (twin-light tracery)';
    lancetOculi.name = 'Lancet pair oculus (quatrefoil tracery)';
    lancetKeystones.name = 'Lancet keystone';
    root.add(lancetMullions, lancetOculi, lancetKeystones);
    // Balusters along the front of every upper-storey stone balcony — the real balconies
    // are balustraded, not open slabs.
    const balconyBalusters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), trim, bays * 2 * 5);
    let bb = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i < bays; i++) {
        const x = -width / 2 + bayW * (i + 0.5);
        for (let k = 0; k < 5; k++) {
          facadeDummy.position.set(x - 1.0 + k * 0.5, y - 2.38, 1.02);
          facadeDummy.updateMatrix();
          balconyBalusters.setMatrixAt(bb++, facadeDummy.matrix);
        }
      }
    }
    balconyBalusters.count = bb;
    balconyBalusters.name = 'Upper-storey balcony balusters';
    root.add(balconyBalusters);
    // Label stops terminate every lancet hood mould, and dripstones hang under each sill —
    // both standard Brabantine-Gothic details of the real facade.
    const labelStops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.34, 0.3), darkStone, bays * 4);
    const dripstones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.3, 6), darkStone, bays * 2);
    let ls = 0, ds = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i < bays; i++) {
        const x = -width / 2 + bayW * (i + 0.5);
        for (const side of [-1, 1]) {
          facadeDummy.position.set(x + side * 1.38, y + 2.45, 0.3);
          facadeDummy.updateMatrix();
          labelStops.setMatrixAt(ls++, facadeDummy.matrix);
        }
        facadeDummy.position.set(x, y - 2.52, 0.3);
        facadeDummy.updateMatrix();
        dripstones.setMatrixAt(ds++, facadeDummy.matrix);
      }
    }
    labelStops.count = ls;
    dripstones.count = ds;
    labelStops.name = 'Lancet hood label stops';
    dripstones.name = 'Window sill dripstones';
    root.add(labelStops, dripstones);
    // Sloped water tables cap every upper-storey balcony slab and sill, as on the real facade.
    const waterTables = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.06, 1.05), darkStone, bays * 2);
    let wt = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i < bays; i++) {
        const x = -width / 2 + bayW * (i + 0.5);
        facadeDummy.position.set(x, y - 2.62, 0.58);
        facadeDummy.rotation.z = -0.06;
        facadeDummy.updateMatrix();
        waterTables.setMatrixAt(wt++, facadeDummy.matrix);
        facadeDummy.rotation.z = 0;
      }
    }
    waterTables.count = wt;
    waterTables.name = 'Balcony and sill water tables';
    root.add(waterTables);
    // Corbel brackets carry every upper-storey window sill, as on the real facade.
    const sillBrackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.2, 0.3), darkStone, bays * 4);
    let sb = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i < bays; i++) {
        const x = -width / 2 + bayW * (i + 0.5);
        for (const side of [-1, 1]) {
          facadeDummy.position.set(x + side * 1.1, y - 2.6, 0.3);
          facadeDummy.updateMatrix();
          sillBrackets.setMatrixAt(sb++, facadeDummy.matrix);
        }
      }
    }
    sillBrackets.count = sb;
    sillBrackets.name = 'Upper window sill brackets';
    root.add(sillBrackets);
    // Horizontal transom bars divide each paired lancet into lights, as on the real
    // mullioned upper windows.
    const transoms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.1, 0.2), trim, bays * 2);
    let tb = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i < bays; i++) {
        const x = -width / 2 + bayW * (i + 0.5);
        facadeDummy.position.set(x, y + 0.4, 0.28);
        facadeDummy.updateMatrix();
        transoms.setMatrixAt(tb++, facadeDummy.matrix);
      }
    }
    transoms.count = tb;
    transoms.name = 'Lancet transom bars';
    root.add(transoms);
    // Flat pilaster strips between the paired lancets of both upper storeys structure the
    // real facade.
    const facadePilasters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 4.8, 0.24), trim, bays * 2);
    let fp = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i < bays; i++) {
        const x = -width / 2 + bayW * (i + 0.5);
        facadeDummy.position.set(x, y, 0.18);
        facadeDummy.updateMatrix();
        facadePilasters.setMatrixAt(fp++, facadeDummy.matrix);
      }
    }
    facadePilasters.count = fp;
    facadePilasters.name = 'Upper-storey facade pilaster strips';
    root.add(facadePilasters);
    // Full-height pilaster strips terminate both wing ends, as on the real facade.
    const endPilasters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, height - 1.6, 0.3), trim, 4);
    let ep = 0;
    for (const [wx, ww] of [[eastWingX, 15], [westWingX, 32]]) {
      for (const side of [-1, 1]) {
        facadeDummy.position.set(wx + side * (ww / 2 - 0.25), 1.0 + (height - 1.6) / 2, 0.16);
        facadeDummy.updateMatrix();
        endPilasters.setMatrixAt(ep++, facadeDummy.matrix);
      }
    }
    endPilasters.count = ep;
    endPilasters.name = 'Wing-end pilaster strips';
    root.add(endPilasters);
    // Gilded stars sit between the paired lancets of both upper storeys, as on the real
    // facade's ornament.
    const facadeStars = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), materials.gold, bays * 2);
    let fs = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i < bays; i++) {
        facadeDummy.position.set(-width / 2 + bayW * (i + 0.5), y + 0.9, 0.3);
        facadeDummy.updateMatrix();
        facadeStars.setMatrixAt(fs++, facadeDummy.matrix);
      }
    }
    facadeStars.count = fs;
    facadeStars.name = 'Upper-storey gilded stars';
    root.add(facadeStars);
    // Statues in niches above the ground-floor arcade arch heads as well — the real
    // facade carries nearly three hundred figures on every level.
    for (const [x] of arcBaysList) {
      facadeDummy.position.set(x, 9.0, 0.15);
      facadeDummy.updateMatrix();
      facadeNiches.setMatrixAt(nicheIndex, facadeDummy.matrix);
      facadeDummy.position.set(x, 9.0, 0.3);
      facadeDummy.updateMatrix();
      facadeStatues.setMatrixAt(nicheIndex, facadeDummy.matrix);
      nicheIndex++;
    }
    facadeNiches.count = facadeStatues.count = nicheIndex;
    facadeNiches.name = 'Town Hall facade statue niches';
    facadeStatues.name = 'Town Hall gilded facade statues';
    facadeNiches.castShadow = facadeStatues.castShadow = true;
    root.add(facadeNiches, facadeStatues);
    // Dark recessed back panels behind every statue niche, plinth blocks under the figures,
    // and small canopy hoods with crocket balls over the upper-floor niches — the real
    // facade's niches are deep, canopied and plinthed.
    const nicheBacks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 2.7, 0.1), materials.dark, 40);
    const statuePlinths = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.22, 0.2), darkStone, 40);
    const nicheHoods = new THREE.InstancedMesh(new THREE.ShapeGeometry(canopyShape), trim, 16);
    const hoodCrochets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 5), materials.gold, 16);
    let nb = 0, nh = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 1; i <= bays; i += 2) {
        const x = -width / 2 + i * bayW;
        facadeDummy.position.set(x, y - 0.05, 0.12);
        facadeDummy.updateMatrix();
        nicheBacks.setMatrixAt(nb, facadeDummy.matrix);
        facadeDummy.position.set(x, y - 1.42, 0.28);
        facadeDummy.updateMatrix();
        statuePlinths.setMatrixAt(nb++, facadeDummy.matrix);
        facadeDummy.position.set(x, y + 1.45, 0.22);
        facadeDummy.updateMatrix();
        nicheHoods.setMatrixAt(nh, facadeDummy.matrix);
        facadeDummy.position.set(x, y + 1.72, 0.24);
        facadeDummy.updateMatrix();
        hoodCrochets.setMatrixAt(nh++, facadeDummy.matrix);
      }
    }
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      facadeDummy.position.set(x, 8.95, 0.12);
      facadeDummy.updateMatrix();
      nicheBacks.setMatrixAt(nb, facadeDummy.matrix);
      facadeDummy.position.set(x, 8.32, 0.28);
      facadeDummy.updateMatrix();
      statuePlinths.setMatrixAt(nb++, facadeDummy.matrix);
    }
    nicheBacks.count = statuePlinths.count = nb;
    nicheHoods.count = hoodCrochets.count = nh;
    nicheBacks.name = 'Statue niche back panels';
    statuePlinths.name = 'Statue plinth blocks';
    nicheHoods.name = 'Upper niche canopy hoods';
    hoodCrochets.name = 'Niche hood crocket balls';
    root.add(nicheBacks, statuePlinths, nicheHoods, hoodCrochets);
    // Slender colonettes flank every upper-floor statue niche, framing it like the real niches.
    const nicheColonettes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 2.6, 0.16), trim, 16);
    let nc = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 1; i <= bays && nc < 16; i += 2) {
        const x = -width / 2 + i * bayW;
        for (const side of [-1, 1]) {
          facadeDummy.position.set(x + side * 0.5, y, 0.2);
          facadeDummy.updateMatrix();
          nicheColonettes.setMatrixAt(nc++, facadeDummy.matrix);
        }
      }
    }
    nicheColonettes.count = nc;
    nicheColonettes.name = 'Niche side colonettes';
    root.add(nicheColonettes);
    // Blind niche panels fill the even bay joints of both upper storeys, as on the real
    // facade between the statue niches.
    const blindNiches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 2.5, 0.18), materials.dark, 16);
    let bn = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i <= bays && bn < 16; i += 2) {
        facadeDummy.position.set(-width / 2 + i * bayW, y, 0.14);
        facadeDummy.updateMatrix();
        blindNiches.setMatrixAt(bn++, facadeDummy.matrix);
      }
    }
    blindNiches.count = bn;
    blindNiches.name = 'Upper blind niche panels';
    root.add(blindNiches);
    // Half of the blind niches carry small gilded figures, alternating with the empty ones —
    // the real facade mixes filled and blind niches.
    const blindFigs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 1.0, 0.12), materials.gold, 8);
    let bf = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i <= bays && bf < 8; i += 4) {
        facadeDummy.position.set(-width / 2 + i * bayW, y, 0.26);
        facadeDummy.updateMatrix();
        blindFigs.setMatrixAt(bf++, facadeDummy.matrix);
      }
    }
    blindFigs.count = bf;
    blindFigs.name = 'Blind niche gilded figures';
    root.add(blindFigs);
    // Gilded trim tops every upper blind niche, as on the real facade niches.
    const blindTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.78, 0.1, 0.2), materials.gold, 16);
    let bt = 0;
    for (let floor = 0; floor < 2; floor++) {
      const y = floor === 0 ? 12.5 : 20.0;
      for (let i = 0; i <= bays && bt < 16; i += 2) {
        facadeDummy.position.set(-width / 2 + i * bayW, y + 1.32, 0.16);
        facadeDummy.updateMatrix();
        blindTrim.setMatrixAt(bt++, facadeDummy.matrix);
      }
    }
    blindTrim.count = bt;
    blindTrim.name = 'Blind niche gold top trim';
    root.add(blindTrim);
    // Documented ground-floor figures beside the tower base: prophets, David and Solomon and
    // an Annunciation group flank the portal on the real elevation.
    const baseFigures = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 1.2, 0.14), materials.gold, 4);
    const baseFigHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 8, 6), materials.gold, 4);
    for (let i = 0; i < 4; i++) {
      const x = towerX + (i - 1.5) * 5.2;
      facadeDummy.position.set(x, 4.4, 0.32);
      facadeDummy.updateMatrix();
      baseFigures.setMatrixAt(i, facadeDummy.matrix);
      facadeDummy.position.set(x, 5.15, 0.34);
      facadeDummy.updateMatrix();
      baseFigHeads.setMatrixAt(i, facadeDummy.matrix);
    }
    baseFigures.count = baseFigHeads.count = 4;
    baseFigures.name = 'Ground-floor prophet/David/Solomon figures';
    baseFigHeads.name = 'Ground-floor figure heads';
    root.add(baseFigures, baseFigHeads);
    // Taller attendant figures in the ground-floor niches alternate with the shorter ones —
    // the real facade mixes statue scales — and slender shafts flank each ground niche.
    const altStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 1.35, 0.14), materials.gold, arcBays);
    const nicheShafts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 2.5, 0.18), trim, arcBays * 2);
    let as2 = 0, ns = 0;
    for (const [x] of arcBaysList) {
      facadeDummy.position.set(x, 9.05, 0.34);
      facadeDummy.scale.set(1, 1.18, 1);
      facadeDummy.updateMatrix();
      altStatues.setMatrixAt(as2++, facadeDummy.matrix);
      facadeDummy.scale.set(1, 1, 1);
      for (const side of [-1, 1]) {
        facadeDummy.position.set(x + side * 0.48, 9.0, 0.2);
        facadeDummy.updateMatrix();
        nicheShafts.setMatrixAt(ns++, facadeDummy.matrix);
      }
    }
    altStatues.count = as2;
    nicheShafts.count = ns;
    altStatues.name = 'Ground niche attendant statues (tall)';
    nicheShafts.name = 'Ground niche side shafts';
    root.add(altStatues, nicheShafts);
    // Gargoyles: projecting spouts on the buttresses — the real facade is covered in them.
    const facadeGargoyles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.5, 0.7), darkStone, bays * 2);
    const gd = new THREE.Object3D();
    let gi = 0;
    for (let i = 0; i <= bays; i += 2) {
      for (const y of [8.2, 16.4]) {
        gd.position.set(-width / 2 + i * bayW, y, 0.55);
        gd.rotation.set(0, 0, 0);
        gd.updateMatrix();
        facadeGargoyles.setMatrixAt(gi++, gd.matrix);
      }
    }
    facadeGargoyles.count = gi;
    facadeGargoyles.name = 'Town Hall facade gargoyles';
    facadeGargoyles.castShadow = true;
    root.add(facadeGargoyles);
    // Trefoil tympana above every second-floor window, as on the real upper storey.
    const floor2Trefoils = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12).rotateX(Math.PI / 2), trim, bays);
    let f2 = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      gd.position.set(x, 22.8, 0.3);
      gd.rotation.set(0, 0, 0);
      gd.updateMatrix();
      floor2Trefoils.setMatrixAt(f2++, gd.matrix);
    }
    floor2Trefoils.count = f2;
    floor2Trefoils.name = 'Second-floor trefoil tympana';
    root.add(floor2Trefoils);
    // A continuous steep slate roof, ridge running along the long axis.
    const roofHalf = depth / 2 + 0.7, ridgeY = height + 7.8, eaveY = height + 0.6;
    const roofVertices = new Float32Array([
      -width/2-1,eaveY,0.6, width/2+1,eaveY,0.6, width/2+1,ridgeY,-depth/2,
      -width/2-1,eaveY,0.6, width/2+1,ridgeY,-depth/2, -width/2-1,ridgeY,-depth/2,
      -width/2-1,eaveY,-depth-0.6, width/2+1,ridgeY,-depth/2, width/2+1,eaveY,-depth-0.6,
      -width/2-1,eaveY,-depth-0.6, -width/2-1,ridgeY,-depth/2, width/2+1,ridgeY,-depth/2
    ]);
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.BufferAttribute(roofVertices, 3));
    roofGeo.computeVertexNormals();
    mesh(root, roofGeo, roofMat, 0, 0, 0, 'Town Hall steep slate roof');
    box(root, width + 2, 0.45, 0.5, 0, ridgeY, -depth / 2, darkStone, 'Town Hall roof ridge');
    // Crenellated openwork parapet along the front eave — the real elevation is surmounted by a
    // crenellated openwork balustrade. Instanced merlons.
    const merlonCount = Math.floor(width / 1.2);
    const merlons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), trim, merlonCount);
    const merDummy = new THREE.Object3D();
    for (let i = 0; i < merlonCount; i++) {
      merDummy.position.set(-width / 2 + 0.6 + i * 1.2, eaveY + 0.35, 0.6);
      merDummy.updateMatrix();
      merlons.setMatrixAt(i, merDummy.matrix);
    }
    merlons.count = merlonCount;
    merlons.name = 'Town Hall crenellated openwork parapet';
    root.add(merlons);
    // The real parapet is OPENWORK: dark arch openings pierce it between the merlons.
    const parapetOpenings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.5, 0.34), materials.dark, merlonCount - 1);
    for (let i = 0; i < merlonCount - 1; i++) {
      merDummy.position.set(-width / 2 + 1.2 + i * 1.2, eaveY + 0.35, 0.6);
      merDummy.updateMatrix();
      parapetOpenings.setMatrixAt(i, merDummy.matrix);
    }
    parapetOpenings.count = merlonCount - 1;
    parapetOpenings.name = 'Town Hall openwork parapet arches';
    root.add(parapetOpenings);
    // Gilded cresting (fleurons) along the roof ridge — the real roofline is dressed in gold.
    const crestCount = Math.floor(width / 1.5);
    const crests = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.6, 6), materials.gold, crestCount);
    for (let i = 0; i < crestCount; i++) {
      merDummy.position.set(-width / 2 + 0.75 + i * 1.5, ridgeY + 0.5, -depth / 2);
      merDummy.updateMatrix();
      crests.setMatrixAt(i, merDummy.matrix);
    }
    crests.count = crestCount;
    crests.name = 'Town Hall gilded roof cresting';
    root.add(crests);
    // Ridge tiles cap the slate roof ridge, overlapping like real slate ridging.
    const ridgeTileCount = Math.floor(width / 1.5) + 1;
    const ridgeTiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.1, 0.55), darkStone, ridgeTileCount);
    for (let i = 0; i < ridgeTileCount; i++) {
      merDummy.position.set(-width / 2 + 0.7 + i * 1.5, ridgeY + 0.26, -depth / 2);
      merDummy.updateMatrix();
      ridgeTiles.setMatrixAt(i, merDummy.matrix);
    }
    ridgeTiles.count = ridgeTileCount;
    ridgeTiles.name = 'Town Hall roof ridge tiles';
    root.add(ridgeTiles);
    // Gilded finial balls terminate the roof ridge at both ends.
    const ridgeEnds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), materials.gold, 2);
    merDummy.position.set(-width / 2 - 0.8, ridgeY + 0.3, -depth / 2);
    merDummy.updateMatrix();
    ridgeEnds.setMatrixAt(0, merDummy.matrix);
    merDummy.position.set(width / 2 + 0.8, ridgeY + 0.3, -depth / 2);
    merDummy.updateMatrix();
    ridgeEnds.setMatrixAt(1, merDummy.matrix);
    ridgeEnds.count = 2;
    ridgeEnds.name = 'Roof ridge end finials';
    root.add(ridgeEnds);
    // Gargoyle spouts project from the four wing roof corners, shedding rain off the roof.
    const roofGargoyles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.5, 0.7), darkStone, 4);
    for (const [wx, ww] of [[eastWingX, 15], [westWingX, 32]]) {
      for (const side of [-1, 1]) {
        merDummy.position.set(wx + side * (ww / 2 - 0.2), height + 0.4, 0.75);
        merDummy.updateMatrix();
        roofGargoyles.setMatrixAt(Math.round((wx + 20) / 40) * 2 + (side > 0 ? 1 : 0), merDummy.matrix);
      }
    }
    roofGargoyles.count = 4;
    roofGargoyles.name = 'Wing roof corner gargoyles';
    root.add(roofGargoyles);
    // Lead gutters run along both wing front eaves, as on the real roofs.
    for (const wx of [eastWingX, westWingX]) {
      box(root, (wx === eastWingX ? 15 : 32) + 1, 0.12, 0.2, wx, eaveY + 0.05, 0.6, materials.dark, 'Wing front eave gutter');
    }

    // Dormers and small roof turrets make the skyline read as a Gothic civic palace.
    for (let i = 0; i < 11; i++) {
      const x = -width / 2 + 2.8 + i * 4.25;
      const z = -depth / 2 + (i % 2 ? -3.1 : 3.1);
      const dormer = new THREE.Group();
      dormer.position.set(x, height + 2.4, z);
      root.add(dormer);
      box(dormer, 1.45, 2.2, 0.7, 0, 0.9, 0, trim, 'Slate roof dormer');
      box(dormer, 0.9, 1.25, 0.16, 0, 0.9, 0.4, glass, 'Dormer window');
      const cap = mesh(dormer, new THREE.ConeGeometry(1.0, 1.6, 4), roofMat, 0, 2.8, 0, 'Dormer pointed cap');
      cap.rotation.y = Math.PI / 4;
    }
    // Small triangular pediments crown each hipped roof dormer, as on the real saddleback roof.
    const dormerPedShape = new THREE.Shape();
    dormerPedShape.moveTo(-0.8, 0); dormerPedShape.lineTo(0, 0.55); dormerPedShape.lineTo(0.8, 0); dormerPedShape.closePath();
    const dormerPeds = new THREE.InstancedMesh(new THREE.ShapeGeometry(dormerPedShape), trim, 11);
    for (let i = 0; i < 11; i++) {
      pinDummy.position.set(-width / 2 + 2.8 + i * 4.25, height + 4.35, -depth / 2 + (i % 2 ? -3.1 : 3.1));
      pinDummy.updateMatrix();
      dormerPeds.setMatrixAt(i, pinDummy.matrix);
    }
    dormerPeds.count = 11;
    dormerPeds.name = 'Hipped dormer pediments';
    root.add(dormerPeds);
    // Side cheeks and a hood mould dress each hipped dormer, as on the real roof.
    const dormerCheeks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 2.2, 0.8), trim, 22);
    const dormerHoods = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.16, 0.5), darkStone, 11);
    let dck = 0;
    for (let i = 0; i < 11; i++) {
      const x = -width / 2 + 2.8 + i * 4.25;
      const z = -depth / 2 + (i % 2 ? -3.1 : 3.1);
      for (const side of [-1, 1]) {
        pinDummy.position.set(x + side * 0.72, height + 3.3, z);
        pinDummy.updateMatrix();
        dormerCheeks.setMatrixAt(dck++, pinDummy.matrix);
      }
      pinDummy.position.set(x, height + 4.75, z);
      pinDummy.updateMatrix();
      dormerHoods.setMatrixAt(i, pinDummy.matrix);
    }
    dormerCheeks.count = dck;
    dormerHoods.count = 11;
    dormerCheeks.name = 'Dormer side cheeks';
    dormerHoods.name = 'Dormer window hood moulds';
    root.add(dormerCheeks, dormerHoods);
    // Gilded balls tip each dormer's pointed cap, as on the real roof dormers.
    const dormerTips = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), materials.gold, 11);
    for (let i = 0; i < 11; i++) {
      pinDummy.position.set(-width / 2 + 2.8 + i * 4.25, height + 4.75, -depth / 2 + (i % 2 ? -3.1 : 3.1));
      pinDummy.updateMatrix();
      dormerTips.setMatrixAt(i, pinDummy.matrix);
    }
    dormerTips.count = 11;
    dormerTips.name = 'Dormer cap finial balls';
    root.add(dormerTips);
    // Glazing cross bars divide each dormer window, as on the real dormers.
    const dormerBars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1.2, 0.05), trim, 22);
    let db = 0;
    for (let i = 0; i < 11; i++) {
      const x = -width / 2 + 2.8 + i * 4.25;
      const z = -depth / 2 + (i % 2 ? -3.1 : 3.1);
      pinDummy.position.set(x, height + 3.3, z + 0.36);
      pinDummy.updateMatrix();
      dormerBars.setMatrixAt(db++, pinDummy.matrix);
      pinDummy.position.set(x, height + 3.3, z + 0.36);
      pinDummy.rotation.y = Math.PI / 2;
      pinDummy.updateMatrix();
      dormerBars.setMatrixAt(db++, pinDummy.matrix);
      pinDummy.rotation.y = 0;
    }
    dormerBars.count = db;
    dormerBars.name = 'Dormer window glazing bars';
    root.add(dormerBars);
    // Both wings terminate in corner turrets that rise the full facade height, above the roofline.
    // Narrow lancet slits pierce both corner turret shafts, as on the real turrets.
    const turretSlits = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 3.2, 0.14), glass, 8);
    const tsd = new THREE.Object3D();
    let ts = 0;
    for (const side of [-1, 1]) {
      const turret = new THREE.Group();
      turret.position.set(side * (width / 2 - 2.2), 0, -depth / 2);
      root.add(turret);
      const shaft = cylinder(turret, 1.5, 1.8, height + 7, 0, (height + 7) / 2, 0, trim, 8);
      shaft.name = 'Facade corner turret';
      mesh(turret, new THREE.ConeGeometry(1.9, 7, 8), roofMat, 0, height + 10.5, 0, 'Facade corner turret spire');
      mesh(turret, new THREE.SphereGeometry(0.24, 8, 6), materials.gold, 0, height + 14.3, 0, 'Facade corner turret gilded finial');
      for (let s = 0; s < 4; s++) {
        tsd.position.set(side * (width / 2 - 2.2), 8 + s * 7, 1.45);
        tsd.updateMatrix();
        turretSlits.setMatrixAt(ts++, tsd.matrix);
      }
    }
    turretSlits.count = ts;
    turretSlits.name = 'Corner turret lancet slits';
    root.add(turretSlits);
    // Projecting string-course rings circle both corner turret shafts, and crocket rings
    // dress their spire feet — as on the real corner turrets.
    const turretRings = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.85, 1.85, 0.24, 8), trim, 10);
    const spireCrochets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), materials.gold, 2);
    let tr2 = 0;
    for (const side of [-1, 1]) {
      for (let r = 0; r < 5; r++) {
        tsd.position.set(side * (width / 2 - 2.2), 6 + r * 6.4, -depth / 2);
        tsd.updateMatrix();
        turretRings.setMatrixAt(tr2++, tsd.matrix);
      }
      tsd.position.set(side * (width / 2 - 2.2), height + 7.4, -depth / 2);
      tsd.updateMatrix();
      spireCrochets.setMatrixAt(side > 0 ? 1 : 0, tsd.matrix);
    }
    turretRings.count = tr2;
    spireCrochets.count = 2;
    turretRings.name = 'Corner turret string-course rings';
    spireCrochets.name = 'Turret spire crocket rings';
    root.add(turretRings, spireCrochets);
    // Hood moulds shelter each corner-turret lancet slit.
    const turretHoods = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 0.14, 0.3), trim, 8);
    let th = 0;
    for (const side of [-1, 1]) {
      for (let s = 0; s < 4; s++) {
        tsd.position.set(side * (width / 2 - 2.2), 9.8 + s * 7, 1.5);
        tsd.updateMatrix();
        turretHoods.setMatrixAt(th++, tsd.matrix);
      }
    }
    turretHoods.count = th;
    turretHoods.name = 'Corner turret lancet hood moulds';
    root.add(turretHoods);
    // The real east wing ends in a BLIND arch beneath its corner turret — a filled, dark
    // recessed arch.
    box(root, 1.5, 5.6, 0.2, -(width / 2 - 2.2), 3.4, 0.12, materials.dark, 'Blind arcade arch under east corner turret');
    // Small dark doors at the base of both corner turrets, as on the real turrets.
    for (const side of [-1, 1]) {
      box(root, 0.9, 2.0, 0.16, side * (width / 2 - 2.2), 1.2, 1.5, materials.dark, 'Corner turret base door');
    }

    // The off-centre tower rises from the ground-level portal to the real 96 m: square
    // shaft, gallery above the roofline, three-tier openwork octagonal lantern with corner
    // turrets and flying buttresses, then the gilded openwork spire and Saint Michael.
    const tower = new THREE.Group();
    tower.name = 'Town Hall 96 m asymmetrical Gothic tower';
    tower.position.set(towerX, 0, -depth / 2 + 4.5);
    root.add(tower);
    const towerW = 9;
    box(tower, towerW, 56, towerW, 0, 28, 0, stone, 'Town Hall 96 m tower square shaft');
    for (const y of [9, 19, 29, 39, 49]) {
      box(tower, towerW + 0.8, 0.5, towerW + 0.8, 0, y, 0, trim, 'Tower projecting string course');
    }
    // Drip moulds under each projecting tower string course shed water off the shaft.
    const stringDrips = new THREE.InstancedMesh(new THREE.BoxGeometry(towerW + 0.9, 0.08, towerW + 0.9), darkStone, 5);
    const stdd = new THREE.Object3D();
    for (let i = 0; i < 5; i++) {
      stdd.position.set(0, [9, 19, 29, 39, 49][i] - 0.29, 0);
      stdd.updateMatrix();
      stringDrips.setMatrixAt(i, stdd.matrix);
    }
    stringDrips.count = 5;
    stringDrips.name = 'Tower string-course drip moulds';
    tower.add(stringDrips);
    // Sloped base buttresses brace the four corners of the tower shaft from the ground, as on
    // the real tower base.
    const baseButtresses = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 12, 0.6), trim, 4);
    const bbd = new THREE.Object3D();
    const bup = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < 4; k++) {
      const sx = k % 2 ? 1 : -1, sz = k < 2 ? 1 : -1;
      const from = new THREE.Vector3(sx * (towerW / 2 - 0.2), 6.2, sz * (towerW / 2 - 0.2));
      const to = new THREE.Vector3(sx * (towerW / 2 + 1.6), 0.4, sz * (towerW / 2 + 1.6));
      const d = to.clone().sub(from);
      bbd.position.copy(from.clone().add(to).multiplyScalar(0.5));
      bbd.quaternion.setFromUnitVectors(bup, d.normalize());
      bbd.scale.set(1, d.length(), 1);
      bbd.updateMatrix();
      baseButtresses.setMatrixAt(k, bbd.matrix);
      bbd.scale.set(1, 1, 1);
    }
    baseButtresses.count = 4;
    baseButtresses.name = 'Tower base corner buttresses';
    tower.add(baseButtresses);
    // A wider dark stone plinth courses around the tower base, as on the real tower foot.
    box(tower, towerW + 1.6, 1.0, towerW + 1.6, 0, 0.5, 0, darkStone, 'Tower base plinth course');
    // Gilded balls stud the tower shaft's string-course corners, as on the real tower.
    const scBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), materials.gold, 20);
    let scb = 0;
    for (const y of [9, 19, 29, 39, 49]) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        stdd.position.set(sx * (towerW / 2 + 0.3), y + 0.25, sz * (towerW / 2 + 0.3));
        stdd.updateMatrix();
        scBalls.setMatrixAt(scb++, stdd.matrix);
      }
    }
    scBalls.count = scb;
    scBalls.name = 'Tower string course corner balls';
    tower.add(scBalls);
    // Gilded balls cap the tops of the four tower base buttresses, as on the real tower foot.
    const buttressTopBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), materials.gold, 4);
    for (let k = 0; k < 4; k++) {
      const sx = k % 2 ? 1 : -1, sz = k < 2 ? 1 : -1;
      stdd.position.set(sx * (towerW / 2 + 1.6), 0.75, sz * (towerW / 2 + 1.6));
      stdd.updateMatrix();
      buttressTopBalls.setMatrixAt(k, stdd.matrix);
    }
    buttressTopBalls.count = 4;
    buttressTopBalls.name = 'Tower base buttress gold caps';
    tower.add(buttressTopBalls);
    // The square shaft is chained with oversized stone quoins at its four corners.
    const tqRows = Math.floor(54 / 4.5);
    const towerQuoins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.9, 0.42), trim, tqRows * 4);
    const tqd = new THREE.Object3D();
    let tq = 0;
    for (let r = 0; r < tqRows; r++) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        tqd.position.set(sx * (towerW / 2 - 0.1), 2 + r * 4.5, sz * (towerW / 2 - 0.1));
        tqd.updateMatrix();
        towerQuoins.setMatrixAt(tq++, tqd.matrix);
      }
    }
    towerQuoins.count = tq;
    towerQuoins.name = 'Town Hall tower corner quoins';
    tower.add(towerQuoins);
    // Main portal at the base of the tower, with a balcony above it.
    box(tower, 4.6, 9.5, 0.5, 0, 4.75, towerW / 2 + 0.15, glass, 'Town Hall main portal recess');
    const portalL = box(tower, 2.6, 0.3, 0.6, -1.35, 9.9, towerW / 2 + 0.15, trim, 'Portal pointed arch rib');
    portalL.rotation.z = -0.62;
    const portalR = box(tower, 2.6, 0.3, 0.6, 1.35, 9.9, towerW / 2 + 0.15, trim, 'Portal pointed arch rib');
    portalR.rotation.z = 0.62;
    box(tower, 6.2, 0.3, 1.1, 0, 10.6, towerW / 2 + 0.5, trim, 'Portal balcony');
    // The real ogival portal: a double archivolt, a tympanum with five statues (St Michael between
    // St Sebastian, St Christopher, St George and St Géry), knight figures at the jambs and
    // historiated corbels carrying the balcony.
    box(tower, 3.4, 1.4, 0.3, 0, 10.3, towerW / 2 + 0.1, darkStone, 'Portal tympanum panel');
    const tympanumSaints = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 1.15, 0.14), materials.gold, 5);
    const portalCorbels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.5, 0.6), darkStone, 3);
    const portalDummy = new THREE.Object3D();
    let saintIndex = 0;
    for (const sx of [-1.6, -0.8, 0, 0.8, 1.6]) {
      portalDummy.position.set(sx, 10.2, towerW / 2 + 0.28);
      portalDummy.updateMatrix();
      tympanumSaints.setMatrixAt(saintIndex++, portalDummy.matrix);
    }
    tympanumSaints.count = saintIndex;
    tympanumSaints.name = 'Portal tympanum saint statues';
    // Small canopy hoods shelter each of the five tympanum saints, as on the real portal.
    const saintHoodShape = new THREE.Shape();
    saintHoodShape.moveTo(-0.3, 0); saintHoodShape.lineTo(0, 0.26); saintHoodShape.lineTo(0.3, 0); saintHoodShape.closePath();
    const saintHoods = new THREE.InstancedMesh(new THREE.ShapeGeometry(saintHoodShape), trim, 5);
    for (let i = 0; i < 5; i++) {
      portalDummy.position.set(-1.6 + i * 0.8, 10.85, towerW / 2 + 0.28);
      portalDummy.updateMatrix();
      saintHoods.setMatrixAt(i, portalDummy.matrix);
    }
    saintHoods.count = 5;
    saintHoods.name = 'Tympanum saint canopy hoods';
    tower.add(saintHoods);
    let corbelIndex = 0;
    for (const cx of [-2.2, 0, 2.2]) {
      portalDummy.position.set(cx, 10.35, towerW / 2 + 0.75);
      portalDummy.updateMatrix();
      portalCorbels.setMatrixAt(corbelIndex++, portalDummy.matrix);
    }
    portalCorbels.count = corbelIndex;
    portalCorbels.name = 'Portal historiated corbels';
    tower.add(tympanumSaints, portalCorbels);
    const outerL = box(tower, 3.0, 0.3, 0.6, -1.75, 10.15, towerW / 2 + 0.15, trim, 'Portal outer archivolt rib');
    outerL.rotation.z = -0.66;
    const outerR = box(tower, 3.0, 0.3, 0.6, 1.75, 10.15, towerW / 2 + 0.15, trim, 'Portal outer archivolt rib');
    outerR.rotation.z = 0.66;
    // Label stops terminate both archivolt ribs where they meet the hood mould.
    for (const side of [-1, 1]) {
      box(tower, 0.26, 0.4, 0.5, side * 3.3, 8.6, towerW / 2 + 0.2, darkStone, 'Portal archivolt label stop');
    }
    // Gilded voussoirs ring the portal arch, as on the real ogival portal.
    const portalVoussoirs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.3, 0.5), materials.gold, 6);
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const t = 0.25 + i * 0.3;
        portalDummy.position.set(side * (1.75 - t * 1.4), 10.15 + t * 1.1, towerW / 2 + 0.2);
        portalDummy.rotation.z = side * 0.6;
        portalDummy.updateMatrix();
        portalVoussoirs.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), portalDummy.matrix);
        portalDummy.rotation.z = 0;
      }
    }
    portalVoussoirs.count = 6;
    portalVoussoirs.name = 'Portal arch gilded voussoirs';
    tower.add(portalVoussoirs);
    for (const side of [-1, 1]) {
      box(tower, 0.66, 2.4, 0.25, side * 2.6, 5.5, towerW / 2 + 0.08, darkStone, 'Portal jamb knight niche');
      box(tower, 0.24, 1.1, 0.12, side * 2.6, 5.5, towerW / 2 + 0.22, materials.gold, 'Portal jamb knight statue');
      // Colonette strips frame each jamb niche, as on the real portal.
      box(tower, 0.12, 2.5, 0.18, side * 3.0, 5.5, towerW / 2 + 0.1, trim, 'Portal jamb colonette');
    }
    // Prophet figures in niches along the portal archivolt mouldings — the real ogival
    // portal carries a procession of prophets on its archivolt.
    // Eight seated prophets (Claus Sluter / Master of Hakendover, 1401-05) fit the curve
    // of the real portal archivolt — four per side.
    const archivoltProphets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1.0, 0.14), materials.gold, 8);
    const apd = new THREE.Object3D();
    let ap = 0;
    for (const side of [-1, 1]) {
      for (const f of [0.15, 0.4, 0.65, 0.9]) {
        apd.position.set(side * (1.75 + 0.92 * (2 * f - 1)), 10.15 + 1.19 * (2 * f - 1), towerW / 2 + 0.3);
        apd.updateMatrix();
        archivoltProphets.setMatrixAt(ap++, apd.matrix);
      }
    }
    archivoltProphets.count = ap;
    archivoltProphets.name = 'Archivolt prophet statues';
    tower.add(archivoltProphets);
    // Canopy hoods over each archivolt prophet, as on the real portal's prophet niches.
    const prophetHoods = new THREE.InstancedMesh(new THREE.ShapeGeometry(saintHoodShape), trim, 8);
    let ph = 0;
    for (const side of [-1, 1]) {
      for (const f of [0.15, 0.4, 0.65, 0.9]) {
        apd.position.set(side * (1.75 + 0.92 * (2 * f - 1)), 10.85 + 1.19 * (2 * f - 1), towerW / 2 + 0.3);
        apd.updateMatrix();
        prophetHoods.setMatrixAt(ph++, apd.matrix);
      }
    }
    prophetHoods.count = ph;
    prophetHoods.name = 'Archivolt prophet canopy hoods';
    tower.add(prophetHoods);
    // Stone entrance steps descend from the ogival portal onto the square.
    for (let i = 0; i < 3; i++) {
      box(tower, 5.4 - i * 0.8, 0.22, 0.7, 0, 0.11 + i * 0.22, towerW / 2 + 0.55 + i * 0.55, darkStone, 'Portal entrance step');
    }
    // A bronze commemorative plaque hangs beside the portal, as on the real tower base.
    box(tower, 0.6, 0.8, 0.08, 3.4, 4.5, towerW / 2 + 0.12, materials.bronze, 'Portal side commemorative plaque');
    // A lit lantern hangs over the Town Hall portal at night, as on the real tower base.
    box(tower, 0.3, 0.4, 0.2, 0, 11.9, towerW / 2 + 0.3, glass, 'Town Hall portal lantern');
    // Massive wooden door leaves with a gilded transom bar and kick plates.
    box(tower, 2.3, 3.4, 0.18, 0, 1.9, towerW / 2 + 0.2, materials.dark, 'Portal door leaves');
    box(tower, 2.3, 0.12, 0.1, 0, 3.68, towerW / 2 + 0.24, materials.gold, 'Portal door transom bar');
    box(tower, 2.3, 0.3, 0.06, 0, 0.35, towerW / 2 + 0.26, materials.gold, 'Portal door kick plate');
    // Gilded semicircular fanlight above the portal door leaves.
    mesh(tower, new THREE.CircleGeometry(1.05, 16, 0, Math.PI), glass, 0, 3.72, towerW / 2 + 0.22, 'Portal fanlight');
    // Vertical panel grooves in the massive portal door leaves, as on the real doors.
    for (let i = 0; i < 4; i++) {
      box(tower, 0.04, 3.2, 0.04, -0.8 + i * 0.55, 1.9, towerW / 2 + 0.3, materials.dark, 'Portal door panel groove');
    }
    // Hood mould sheltering the whole ogival portal, as on the real tower base.
    const hoodShape = new THREE.Shape();
    hoodShape.moveTo(-3.4, 0); hoodShape.lineTo(0, 1.3); hoodShape.lineTo(3.4, 0); hoodShape.closePath();
    mesh(tower, new THREE.ShapeGeometry(hoodShape), trim, 0, 11.3, towerW / 2 + 0.2, 'Portal hood mould');
    // Label stop at the apex of the portal hood mould, and a drip mould under it.
    box(tower, 0.24, 0.4, 0.3, 0, 12.75, towerW / 2 + 0.22, darkStone, 'Portal hood label stop');
    box(tower, 6.9, 0.08, 0.4, 0, 11.28, towerW / 2 + 0.4, darkStone, 'Portal hood drip mould');
    // Prophet figures in niches above the portal, between the shaft lancets.
    for (const side of [-1, 1]) {
      for (const dx of [1.1, 3.3]) {
        box(tower, 0.66, 2.2, 0.2, side * dx, 10.75, towerW / 2 + 0.08, darkStone, 'Portal prophet niche');
        box(tower, 0.24, 1.05, 0.12, side * dx, 10.75, towerW / 2 + 0.2, materials.gold, 'Portal prophet gilded figure');
      }
    }
    // Narrow lancet recesses on the front and side faces of the shaft, each under a trefoil
    // tympanum — the real base of the tower has mullioned windows beneath trefoil tympana.
    const trefoils = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 12).rotateX(Math.PI / 2), trim, 12);
    const trd = new THREE.Object3D();
    let tr = 0;
    for (const y of [6.5, 15, 23.5, 32, 40.5, 48.5]) {
      for (const side of [-1, 1]) {
        box(tower, 1.15, 4.4, 0.2, side * 2.3, y, towerW / 2 + 0.08, glass, 'Tower lancet');
        box(tower, 0.16, 4.75, 0.26, side * 2.3, y, towerW / 2, trim, 'Tower lancet moulding');
        box(tower, 0.2, 4.4, 1.15, towerW / 2 + 0.08, y, side * 2.3, glass, 'Tower side lancet');
        trd.position.set(side * 2.3, y + 2.62, towerW / 2 + 0.1);
        trd.updateMatrix();
        trefoils.setMatrixAt(tr++, trd.matrix);
      }
    }
    trefoils.count = tr;
    trefoils.name = 'Tower lancet trefoil tympana';
    tower.add(trefoils);
    // Hood moulds shelter the tower's SIDE lancets too, as on the real shaft.
    const sideHoods = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.2, 0.3), trim, 12);
    let sh = 0;
    for (const y of [6.5, 15, 23.5, 32, 40.5, 48.5]) {
      for (const side of [-1, 1]) {
        trd.position.set(towerW / 2 + 0.1, y, side * 2.3);
        trd.rotation.y = Math.PI / 2;
        trd.updateMatrix();
        sideHoods.setMatrixAt(sh++, trd.matrix);
        trd.rotation.y = 0;
      }
    }
    sideHoods.count = sh;
    sideHoods.name = 'Tower side lancet hood moulds';
    tower.add(sideHoods);
    // Dripstones hang under each side lancet sill of the tower shaft.
    const sideDrips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.24, 6), darkStone, 12);
    let sd3 = 0;
    for (const y of [6.5, 15, 23.5, 32, 40.5, 48.5]) {
      for (const side of [-1, 1]) {
        trd.position.set(towerW / 2 + 0.12, y - 2.3, side * 2.3);
        trd.updateMatrix();
        sideDrips.setMatrixAt(sd3++, trd.matrix);
      }
    }
    sideDrips.count = sd3;
    sideDrips.name = 'Tower side lancet sill dripstones';
    tower.add(sideDrips);
    // Gilded balls cap each tower side lancet hood mould, as on the real shaft.
    const sideHoodBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), materials.gold, 12);
    let shb = 0;
    for (const y of [6.5, 15, 23.5, 32, 40.5, 48.5]) {
      for (const side of [-1, 1]) {
        trd.position.set(towerW / 2 + 0.12, y + 2.3, side * 2.3);
        trd.updateMatrix();
        sideHoodBalls.setMatrixAt(shb++, trd.matrix);
      }
    }
    sideHoodBalls.count = shb;
    sideHoodBalls.name = 'Tower side lancet hood gold balls';
    tower.add(sideHoodBalls);
    // Gallery above the roofline, with projecting pinnacles at its corners and mid-sides.
    cylinder(tower, 5.6, 6.2, 1.8, 0, 56.9, 0, trim, 8).name = 'Tower gallery above the roofline';
    // A drip mould ring under the gallery sheds water off the tower shaft.
    cylinder(tower, 6.3, 6.3, 0.12, 0, 55.9, 0, darkStone, 8).name = 'Tower gallery drip mould';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      const x = Math.cos(a) * 5.1, z = Math.sin(a) * 5.1;
      cylinder(tower, 0.3, 0.44, 5.6, x, 60.6, z, trim, 8).name = 'Gallery projecting pinnacle';
      mesh(tower, new THREE.ConeGeometry(0.52, 2.3, 8), roofMat, x, 64.2, z, 'Gallery pinnacle spire');
      mesh(tower, new THREE.SphereGeometry(0.12, 8, 6), materials.gold, x, 65.6, z, 'Gallery pinnacle crocket ball');
      mesh(tower, new THREE.SphereGeometry(0.18, 8, 6), materials.gold, x, 58.1, z, 'Gallery pinnacle base ball');
    }
    // Balustrade panels filling the gallery between its projecting pinnacles.
    const galleryBalusters = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.75, 0.22), trim, 8);
    const gbd = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      gbd.position.set(Math.cos(a) * 5.7, 57.55, Math.sin(a) * 5.7);
      gbd.rotation.y = -a;
      gbd.updateMatrix();
      galleryBalusters.setMatrixAt(i, gbd.matrix);
    }
    galleryBalusters.count = 8;
    galleryBalusters.name = 'Tower gallery balustrade panels';
    tower.add(galleryBalusters);
    // Merlons crown the tower gallery parapet between the balustrade panels.
    const galleryMerlons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.55, 0.24), trim, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      gbd.position.set(Math.cos(a) * 5.7, 58.0, Math.sin(a) * 5.7);
      gbd.rotation.y = -a;
      gbd.updateMatrix();
      galleryMerlons.setMatrixAt(i, gbd.matrix);
    }
    galleryMerlons.count = 8;
    galleryMerlons.name = 'Tower gallery parapet merlons';
    tower.add(galleryMerlons);
    // Pointed arch hoods bridge the gallery between its pinnacles, over the balustrade.
    const galleryArchShape = new THREE.Shape();
    galleryArchShape.moveTo(-0.7, 0); galleryArchShape.lineTo(0, 0.55); galleryArchShape.lineTo(0.7, 0); galleryArchShape.closePath();
    const galleryArches = new THREE.InstancedMesh(new THREE.ShapeGeometry(galleryArchShape), trim, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      gbd.position.set(Math.cos(a) * 5.7, 58.3, Math.sin(a) * 5.7);
      gbd.rotation.y = -a;
      gbd.updateMatrix();
      galleryArches.setMatrixAt(i, gbd.matrix);
      gbd.rotation.y = 0;
    }
    galleryArches.count = 8;
    galleryArches.name = 'Gallery arch hoods over balustrade';
    tower.add(galleryArches);
    // Modillion corbels ring the underside of the tower gallery, as on the real gallery.
    const galleryMods = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), darkStone, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      gbd.position.set(Math.cos(a) * 5.9, 55.9, Math.sin(a) * 5.9);
      gbd.rotation.y = -a;
      gbd.updateMatrix();
      galleryMods.setMatrixAt(i, gbd.matrix);
      gbd.rotation.y = 0;
    }
    galleryMods.count = 8;
    galleryMods.name = 'Tower gallery modillion corbels';
    tower.add(galleryMods);
    // Gargoyle spouts project from each gallery pinnacle, as on the real gallery.
    const galleryGargoyles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.4, 0.55), darkStone, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      gbd.position.set(Math.cos(a) * 5.1, 63.9, Math.sin(a) * 5.1);
      gbd.rotation.y = -a;
      gbd.updateMatrix();
      galleryGargoyles.setMatrixAt(i, gbd.matrix);
      gbd.rotation.y = 0;
    }
    galleryGargoyles.count = 8;
    galleryGargoyles.name = 'Gallery pinnacle gargoyles';
    tower.add(galleryGargoyles);
    // Three-tier openwork octagonal lantern: slender piers, pointed arch ribs, parapets.
    cylinder(tower, 4.9, 5.3, 2.0, 0, 59.6, 0, darkStone, 8).name = 'Openwork octagonal lantern base';
    // A drip ring under the lantern base sheds water off the tower shaft top.
    cylinder(tower, 5.5, 5.5, 0.12, 0, 58.5, 0, darkStone, 8).name = 'Lantern base drip ring';
    for (let level = 0; level < 3; level++) {
      const y0 = 60.6 + level * 6.6;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        box(tower, 0.5, 6.0, 0.5, Math.cos(a) * 4.35, y0 + 3.0, Math.sin(a) * 4.35, trim, 'Open belfry slender pier');
        const arch = box(tower, 2.6, 0.34, 0.42, Math.cos(a + Math.PI / 8) * 3.7, y0 + 5.9, Math.sin(a + Math.PI / 8) * 3.7, trim, 'Belfry pointed arch rib');
        arch.rotation.y = -a;
      }
      cylinder(tower, 4.75, 4.75, 0.55, 0, y0 + 6.25, 0, trim, 8).name = 'Lantern openwork parapet';
    }
    cylinder(tower, 4.2, 4.6, 0.9, 0, 80.6, 0, trim, 8).name = 'Lantern crown';
    // A small gilded cross crowns the lantern, as on the real tower top.
    box(tower, 0.06, 0.7, 0.06, 0, 81.6, 0, materials.gold, 'Lantern crown cross vertical');
    box(tower, 0.4, 0.06, 0.06, 0, 81.75, 0, materials.gold, 'Lantern crown cross arm');
    // A parapet ring crowns the tower shaft top under the lantern, as on the real tower.
    cylinder(tower, 5.0, 5.0, 0.5, 0, 58.75, 0, trim, 8).name = 'Tower shaft-top parapet ring';
    // A gilded ring crowns the lantern crown under the cross.
    cylinder(tower, 4.5, 4.5, 0.1, 0, 81.15, 0, materials.gold, 8).name = 'Lantern crown gold ring';
    // Parapet ring at the spire base with eight crocketed pinnacles around it, as on the
    // real openwork spire's foot.
    cylinder(tower, 4.0, 4.0, 0.7, 0, 81.3, 0, trim, 8).name = 'Spire base parapet ring';
    const spireBasePins = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 1.4, 6), trim, 8);
    const spd = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      spd.position.set(Math.cos(a) * 4.0, 82.1, Math.sin(a) * 4.0);
      spd.updateMatrix();
      spireBasePins.setMatrixAt(i, spd.matrix);
    }
    spireBasePins.count = 8;
    spireBasePins.name = 'Spire base pinnacles';
    tower.add(spireBasePins);
    // Louver slats inside each belfry opening and the great bell in the middle tier —
    // the real openwork lantern houses the tower bells behind wooden louvers.
    const louvers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.12, 0.3), trim, 24);
    mesh(tower, new THREE.CylinderGeometry(0.55, 0.75, 1.3, 10), materials.gold, 0, 67.5, 0, 'Belfry great bell');
    const ld = new THREE.Object3D();
    let lo = 0;
    for (let level = 0; level < 3; level++) {
      const y0 = 60.6 + level * 6.6;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ld.position.set(Math.cos(a) * 3.7, y0 + 2.2, Math.sin(a) * 3.7);
        ld.rotation.y = -a;
        ld.updateMatrix();
        louvers.setMatrixAt(lo++, ld.matrix);
      }
    }
    louvers.count = lo;
    louvers.name = 'Belfry louver slats';
    tower.add(louvers);
    // Capitals crown each openwork lantern pier, and hood moulds arch over every belfry
    // opening — the real lantern is pier-by-pier arcaded.
    const pierCapitalsL = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.22, 0.62), darkStone, 24);
    const belfryHoods = new THREE.InstancedMesh(new THREE.BoxGeometry(2.7, 0.2, 0.3), trim, 24);
    let pcap = 0;
    for (let level = 0; level < 3; level++) {
      const y0 = 60.6 + level * 6.6;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ld.position.set(Math.cos(a) * 4.35, y0 + 6.05, Math.sin(a) * 4.35);
        ld.rotation.y = -a;
        ld.updateMatrix();
        pierCapitalsL.setMatrixAt(pcap, ld.matrix);
        ld.position.set(Math.cos(a + Math.PI / 8) * 3.7, y0 + 6.2, Math.sin(a + Math.PI / 8) * 3.7);
        ld.updateMatrix();
        belfryHoods.setMatrixAt(pcap++, ld.matrix);
      }
    }
    pierCapitalsL.count = belfryHoods.count = 24;
    pierCapitalsL.name = 'Lantern pier capitals';
    belfryHoods.name = 'Belfry opening hood moulds';
    tower.add(pierCapitalsL, belfryHoods);
    // Quatrefoil tracery discs in each belfry opening, as in the real openwork lantern.
    const belfryQuatrefoils = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12).rotateX(Math.PI / 2), trim, 24);
    let bq = 0;
    for (let level = 0; level < 3; level++) {
      const y0 = 60.6 + level * 6.6;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + Math.PI / 8;
        ld.position.set(Math.cos(a) * 3.9, y0 + 3.4, Math.sin(a) * 3.9);
        ld.rotation.y = -a;
        ld.updateMatrix();
        belfryQuatrefoils.setMatrixAt(bq++, ld.matrix);
        ld.rotation.y = 0;
      }
    }
    belfryQuatrefoils.count = bq;
    belfryQuatrefoils.name = 'Belfry quatrefoil tracery';
    tower.add(belfryQuatrefoils);
    // Gilded floor rings divide the three belfry tiers, as on the real lantern.
    for (let level = 0; level < 3; level++) {
      cylinder(tower, 4.1, 4.1, 0.1, 0, 60.6 + level * 6.6 - 0.4, 0, materials.gold, 8).name = 'Belfry tier gold floor ring';
    }
    // Timber bell frame and clapper inside the middle belfry tier, around the great bell.
    const bellFrame = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), materials.dark, 4);
    for (let i = 0; i < 4; i++) {
      ld.position.set((i % 2 ? 0.6 : -0.6), 68.2, (i < 2 ? 0.6 : -0.6));
      ld.rotation.y = 0;
      ld.updateMatrix();
      bellFrame.setMatrixAt(i, ld.matrix);
    }
    bellFrame.count = 4;
    bellFrame.name = 'Belfry bell-frame timbers';
    box(tower, 1.4, 0.14, 1.4, 0, 69.2, 0, materials.dark, 'Belfry bell-frame beam');
    box(tower, 0.08, 0.5, 0.08, 0, 66.9, 0, materials.dark, 'Bell clapper');
    tower.add(bellFrame);
    // The bell rope drops from the great bell down the belfry, as on the real tower.
    box(tower, 0.05, 8, 0.05, 0, 62.5, 0, materials.dark, 'Bell rope');
    // Four buttressed octagonal corner turrets and four slender side pinnacles, tied to
    // the shaft by flying buttresses.
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const x = Math.cos(a) * 5.7, z = Math.sin(a) * 5.7;
      cylinder(tower, 1.0, 1.35, 17, x, 67.5, z, trim, 8).name = 'Lantern corner turret';
      mesh(tower, new THREE.ConeGeometry(1.3, 4.6, 8), roofMat, x, 77.3, z, 'Lantern corner turret spire');
      const bx = Math.cos(a) * 4.5, bz = Math.sin(a) * 4.5;
      const d = new THREE.Vector3(x - bx, 4.5, z - bz);
      const buttress = mesh(tower, new THREE.BoxGeometry(0.34, d.length(), 0.34), trim, (bx + x) / 2, 59.75, (bz + z) / 2, 'Flying buttress');
      buttress.quaternion.setFromUnitVectors(up, d.normalize());
      // Small spire caps crown the flying buttress heads.
      mesh(tower, new THREE.ConeGeometry(0.3, 0.9, 6), roofMat, x, 62.6, z, 'Flying buttress pinnacle cap');
    }
    // Gilded finial balls crowning the four lantern corner turret spires.
    const turretFinials = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), materials.gold, 4);
    const tfd = new THREE.Object3D();
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      tfd.position.set(Math.cos(a) * 5.7, 79.9, Math.sin(a) * 5.7);
      tfd.updateMatrix();
      turretFinials.setMatrixAt(k, tfd.matrix);
    }
    turretFinials.count = 4;
    turretFinials.name = 'Lantern corner turret gilded finials';
    tower.add(turretFinials);
    // Glazed slit windows pierce the four lantern corner turrets, as on the real tower.
    const turretWin = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 5.5, 0.14), glass, 8);
    let tw = 0;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const x = Math.cos(a) * 5.7, z = Math.sin(a) * 5.7;
      for (const y of [64, 71]) {
        tfd.position.set(x, y, z);
        tfd.rotation.y = -a;
        tfd.updateMatrix();
        turretWin.setMatrixAt(tw++, tfd.matrix);
        tfd.rotation.y = 0;
      }
    }
    turretWin.count = tw;
    turretWin.name = 'Lantern corner turret slit windows';
    tower.add(turretWin);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      const x = Math.cos(a) * 5.7, z = Math.sin(a) * 5.7;
      cylinder(tower, 0.28, 0.42, 11, x, 63.5, z, trim, 8).name = 'Lantern side pinnacle';
      mesh(tower, new THREE.ConeGeometry(0.48, 2.1, 8), roofMat, x, 69.5, z, 'Lantern side pinnacle spire');
    }
    // Eight radial gargoyles per level on each of the lantern's corner turrets.
    const turretGargoyles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.5, 0.7), darkStone, 64);
    let tg = 0;
    for (let k = 0; k < 4; k++) {
      const ta = Math.PI / 4 + k * Math.PI / 2;
      for (const level of [64, 71]) {
        for (let i = 0; i < 8; i++) {
          const ga = ta + i * Math.PI / 4;
          gd.position.set(Math.cos(ga) * 1.45, level, Math.sin(ga) * 1.45);
          gd.rotation.set(0, -ga, 0);
          gd.updateMatrix();
          turretGargoyles.setMatrixAt(tg++, gd.matrix);
        }
      }
    }
    turretGargoyles.count = tg;
    turretGargoyles.name = 'Tower turret gargoyles';
    turretGargoyles.castShadow = true;
    tower.add(turretGargoyles);
    // Slender openwork pyramidal spire to 96 m: eight bare stone ribs, no solid cone,
    // exactly like the real openwork spire, tied by gilded ring armatures.
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const sx = Math.cos(a) * 3.7, sz = Math.sin(a) * 3.7;
      const d = new THREE.Vector3(-sx, 96 - 80.9, -sz);
      const rib = mesh(tower, new THREE.BoxGeometry(0.26, d.length(), 0.26), trim, sx / 2, (80.9 + 96) / 2, sz / 2, 'Openwork spire stone rib');
      rib.quaternion.setFromUnitVectors(up, d.normalize());
    }
    cylinder(tower, 2.75, 2.75, 0.16, 0, 85.2, 0, materials.gold, 8).name = 'Spire gilded ring armature';
    // Gilded crochets hooking each openwork spire rib at intervals, as on the real spire.
    const crochets = new THREE.InstancedMesh(new THREE.ConeGeometry(0.1, 0.34, 6), materials.gold, 24);
    const cd = new THREE.Object3D();
    let ck = 0;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const sx = Math.cos(a) * 3.7, sz = Math.sin(a) * 3.7;
      for (const t of [0.35, 0.65, 0.9]) {
        cd.position.set(sx * (1 - t), 80.9 + (96 - 80.9) * t, sz * (1 - t));
        cd.rotation.y = -a;
        cd.updateMatrix();
        crochets.setMatrixAt(ck++, cd.matrix);
      }
    }
    crochets.count = ck;
    crochets.name = 'Spire rib gilded crochets';
    tower.add(crochets);
    // Stone foot blocks bed each spire rib into the lantern crown, as on the real openwork
    // spire.
    const ribFeet = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), darkStone, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      cd.position.set(Math.cos(a) * 3.7, 80.9, Math.sin(a) * 3.7);
      cd.rotation.y = -a;
      cd.updateMatrix();
      ribFeet.setMatrixAt(i, cd.matrix);
      cd.rotation.y = 0;
    }
    ribFeet.count = 8;
    ribFeet.name = 'Spire rib foot blocks';
    tower.add(ribFeet);
    cylinder(tower, 1.5, 1.5, 0.14, 0, 90.6, 0, materials.gold, 8).name = 'Spire gilded ring armature';
    // Two more gilded ring armatures tie the openwork spire ribs higher up.
    cylinder(tower, 0.85, 0.85, 0.12, 0, 93.4, 0, materials.gold, 8).name = 'Spire gilded ring armature';
    cylinder(tower, 0.4, 0.4, 0.1, 0, 95.4, 0, materials.gold, 8).name = 'Spire gilded ring armature';
    // The openwork spire's apex carries a gilded orb, and the statue of Saint Michael at the
    // 96 m summit holds his sword raised against the dragon.
    mesh(tower, new THREE.SphereGeometry(0.5, 12, 10), materials.gold, 0, 96.15, 0, 'Spire gilded orb finial');
    cylinder(tower, 0.1, 0.18, 2.4, 0, 97.1, 0, materials.gold, 8).name = 'Saint Michael mast';
    box(tower, 0.55, 1.7, 0.3, 0, 98.75, 0, materials.gold, 'Gilded Saint Michael figure');
    mesh(tower, new THREE.SphereGeometry(0.27, 8, 6), materials.gold, 0, 99.75, 0, 'Gilded Saint Michael head');
    const sword = box(tower, 0.07, 1.6, 0.07, 0.42, 99.4, 0.1, materials.gold, 'Saint Michael raised sword');
    sword.rotation.z = 0.5;
    mesh(tower, new THREE.SphereGeometry(0.42, 8, 6), darkStone, 0.55, 96.2, 0.35, 'Saint Michael dragon');
    // Wings on the dragon at Saint Michael's feet.
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0); wingShape.lineTo(0.5, 0.28); wingShape.lineTo(0.12, 0.5); wingShape.closePath();
    const dragonWings = new THREE.InstancedMesh(new THREE.ShapeGeometry(wingShape), darkStone, 2);
    const wd = new THREE.Object3D();
    wd.position.set(0.42, 96.32, 0.35); wd.rotation.z = 0.5; wd.updateMatrix();
    dragonWings.setMatrixAt(0, wd.matrix);
    wd.position.set(0.68, 96.32, 0.35); wd.rotation.z = -0.9; wd.updateMatrix();
    dragonWings.setMatrixAt(1, wd.matrix);
    dragonWings.count = 2;
    dragonWings.name = 'Saint Michael dragon wings';
    tower.add(dragonWings);
    // Gilded halo behind Saint Michael's head, a curled dragon tail, and a cross-guard on
    // his raised sword — finishing details of the real 2.7 m gilt statue.
    const halo = mesh(tower, new THREE.TorusGeometry(0.42, 0.05, 8, 20), materials.gold, 0, 99.85, -0.22, 'Saint Michael gilded halo');
    halo.rotation.y = 0;
    const tail = box(tower, 0.08, 0.7, 0.08, 0.85, 95.85, 0.35, darkStone, 'Saint Michael dragon tail');
    tail.rotation.z = -0.7;
    const guard = box(tower, 0.3, 0.06, 0.06, 0.34, 99.85, 0.1, materials.gold, 'Saint Michael sword cross-guard');
    // A gilded spear point tips the raised sword.
    mesh(tower, new THREE.ConeGeometry(0.06, 0.3, 6), materials.gold, 0.56, 100.15, 0.1, 'Saint Michael sword point');
    // Moulded base ring under the gilded orb at the spire apex.
    cylinder(tower, 0.62, 0.7, 0.18, 0, 95.72, 0, trim, 12).name = 'Spire orb base moulding';
    // An iron base plate seats the orb finial at the spire apex.
    cylinder(tower, 0.55, 0.55, 0.08, 0, 95.62, 0, materials.dark, 12).name = 'Spire apex base plate';
  }

  function kingsHouse(parent) {
    // King's House (Maison du Roi / Broodhuis) on the north side, opposite the Town Hall:
    // Victor Jamaer's 1874-1896 neo-Gothic rebuild. Real measured proportions: main facade
    // 30.78 m wide, 20.21 m high over three storeys, central tower 38.49 m with a square
    // shaft, octagonal top and domed slate spire; two arcaded galleries and a vast dormer-
    // pierced slate roof dotted with standard-bearer statues. Local +Z faces the square.
    const root = new THREE.Group();
    root.name = 'King’s House (Maison du Roi / Broodhuis)';
    root.position.set(0, 0, 0);
    parent.add(root);

    const width = 31, height = 20.5, depth = 13;
    const stone = materials.paleStone;
    const trim = materials.limestone;
    const darkStone = materials.warmStone;
    const roofMat = materials.slate;
    const glass = glowGlass;

    box(root, width, height, depth, 0, height / 2, -depth / 2, stone, 'King’s House neo-Gothic main block');
    box(root, width + 1.6, 1.0, depth + 0.9, 0, 0.5, -depth / 2, darkStone, 'King’s House plinth');
    // Rustication grooves in the plinth band of the real Broodhuis base.
    const khRust = new THREE.InstancedMesh(new THREE.BoxGeometry(width + 1.2, 0.05, 0.06), trim, 3);
    const khRd0 = new THREE.Object3D();
    for (let i = 0; i < 3; i++) {
      khRd0.position.set(0, 0.3 + i * 0.32, 0.32);
      khRd0.updateMatrix();
      khRust.setMatrixAt(i, khRd0.matrix);
    }
    khRust.count = 3;
    khRust.name = 'King’s House plinth rustication';
    root.add(khRust);
    // Lead gutter along the front eave and rainwater downpipes at both front corners —
    // standard rainwater goods of the real Broodhuis.
    box(root, width + 1.8, 0.12, 0.18, 0, height + 0.62, 0.55, materials.dark, 'King’s House front eave gutter');
    const khDownpipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, height - 0.6, 6), materials.dark, 2);
    for (let i = 0; i < 2; i++) {
      khRd0.position.set((i === 0 ? -1 : 1) * (width / 2 - 0.3), (height - 0.6) / 2 + 0.3, 0.3);
      khRd0.updateMatrix();
      khDownpipes.setMatrixAt(i, khRd0.matrix);
    }
    khDownpipes.count = 2;
    khDownpipes.name = 'King’s House rainwater downpipes';
    root.add(khDownpipes);
    // Sloped water table caps the Broodhuis plinth, shedding rainwater off the base.
    const khWaterTable = box(root, width + 1.7, 0.08, 0.6, 0, 1.04, 0.3, darkStone, 'King’s House plinth water table');
    khWaterTable.rotation.x = 0.1;
    // Glazed windows pierce both side elevations of the Broodhuis block, as on the real
    // building's flanks facing the side streets.
    const khSideWindows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 2.6, 1.3), glass, 8);
    let ksw = 0;
    for (const sx of [-1, 1]) {
      for (let f = 0; f < 2; f++) {
        for (let r = 0; r < 2; r++) {
          khRd0.position.set(sx * (width / 2 + 0.05), 6 + f * 8, -depth / 2 + 3 + r * 5);
          khRd0.updateMatrix();
          khSideWindows.setMatrixAt(ksw++, khRd0.matrix);
        }
      }
    }
    khSideWindows.count = ksw;
    khSideWindows.name = 'King’s House side-elevation windows';
    root.add(khSideWindows);
    // A side entrance door pierces the Broodhuis east flank toward Rue de la Colline, as on
    // the real building.
    box(root, 0.14, 2.6, 1.2, width / 2 + 0.05, 1.6, -depth / 2 + 4, materials.dark, 'King’s House side entrance door');
    box(root, 0.2, 0.3, 1.5, width / 2 + 0.08, 3.1, -depth / 2 + 4, trim, 'King’s House side entrance hood');
    // Hood moulds shelter every side-elevation window of the Broodhuis flanks.
    const khSideHoods = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.16, 1.7), trim, 8);
    let ksh = 0;
    for (const sx of [-1, 1]) {
      for (let f = 0; f < 2; f++) {
        for (let r = 0; r < 2; r++) {
          khRd0.position.set(sx * (width / 2 + 0.1), 7.7 + f * 8, -depth / 2 + 3 + r * 5);
          khRd0.updateMatrix();
          khSideHoods.setMatrixAt(ksh++, khRd0.matrix);
        }
      }
    }
    khSideHoods.count = ksh;
    khSideHoods.name = 'King’s House side window hood moulds';
    root.add(khSideHoods);
    box(root, width + 0.9, 0.8, depth + 0.7, 0, height - 0.4, -depth / 2, trim, 'King’s House upper cornice');
    // A string-course band runs under the upper-storey windows of the real Broodhuis.
    box(root, width - 1.2, 0.22, 0.4, 0, 14.6, 0.22, darkStone, 'King’s House upper string course');
    // A gilded trim line runs along the upper string course, as on the real Broodhuis.
    box(root, width - 1.2, 0.05, 0.1, 0, 14.74, 0.3, materials.gold, 'King’s House upper string course gold trim');
    // Oversized quoins chain the front corners of the main block, and a row of modillions
    // stands under the upper cornice — standard dressing of Jamaer's real facade.
    const khQRows = Math.floor((height - 2) / 0.9);
    const khQuoins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), darkStone, khQRows * 2);
    const khMods = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.34, 0.34), darkStone, 26);
    const khQd = new THREE.Object3D();
    let khQ = 0;
    for (let r = 0; r < khQRows; r++) {
      for (const sx of [-1, 1]) {
        khQd.position.set(sx * (width / 2 - 0.1), 1.4 + r * 0.9, 0.2);
        khQd.updateMatrix();
        khQuoins.setMatrixAt(khQ++, khQd.matrix);
      }
    }
    for (let i = 0; i < 26; i++) {
      khQd.position.set(-width / 2 + 0.6 + i * (width - 1.2) / 25, height - 0.95, 0.25);
      khQd.updateMatrix();
      khMods.setMatrixAt(i, khQd.matrix);
    }
    khQuoins.count = khQ;
    khMods.count = 26;
    khQuoins.name = 'King’s House corner quoins';
    khMods.name = 'King’s House cornice modillions';
    root.add(khQuoins, khMods);
    // Dentil teeth under the upper cornice of the real Broodhuis.
    const khDentils = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.22, 0.2), darkStone, 26);
    for (let i = 0; i < 26; i++) {
      khQd.position.set(-width / 2 + 0.6 + i * (width - 1.2) / 25, height - 0.92, 0.28);
      khQd.updateMatrix();
      khDentils.setMatrixAt(i, khQd.matrix);
    }
    khDentils.count = 26;
    khDentils.name = 'King’s House upper cornice dentils';
    root.add(khDentils);
    // Drip mould under the upper cornice sheds water off the Broodhuis facade.
    box(root, width + 1.0, 0.08, 0.4, 0, height - 0.95, 0.3, darkStone, 'King’s House cornice drip mould');
    // A gilded trim line runs along the top of the Broodhuis upper cornice.
    box(root, width + 1.0, 0.05, 0.12, 0, height - 0.02, 0.32, materials.gold, 'King’s House upper cornice gold trim');
    // Full-height corner pilasters frame the Broodhuis main block, as on Jamaer's facade.
    const khCornerPilasters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, height - 1.6, 0.24), trim, 2);
    for (let i = 0; i < 2; i++) {
      khQd.position.set((i === 0 ? -1 : 1) * (width / 2 - 0.2), 1.0 + (height - 1.6) / 2, 0.14);
      khQd.updateMatrix();
      khCornerPilasters.setMatrixAt(i, khQd.matrix);
    }
    khCornerPilasters.count = 2;
    khCornerPilasters.name = 'King’s House corner pilasters';
    root.add(khCornerPilasters);

    // Ground-floor arcade gallery: recessed arched openings between piers, pointed heads.
    const bays = 9, bayW = width / bays;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      box(root, bayW - 0.9, 5.6, 0.26, x, 3.3, 0.15, glass, 'King’s House ground gallery arch');
      box(root, 0.3, 6.4, 0.5, x - bayW / 2 + 0.1, 3.5, 0.2, trim, 'Ground gallery pier');
      box(root, 0.3, 6.4, 0.5, x + bayW / 2 - 0.1, 3.5, 0.2, trim, 'Ground gallery pier');
      const archL = box(root, 1.9, 0.26, 0.46, x - 0.48, 6.35, 0.2, trim, 'Ground gallery pointed arch');
      archL.rotation.z = -0.55;
      const archR = box(root, 1.9, 0.26, 0.46, x + 0.48, 6.35, 0.2, trim, 'Ground gallery pointed arch');
      archR.rotation.z = 0.55;
    }
    box(root, width - 1.2, 0.24, 0.5, 0, 6.7, 0.2, darkStone, 'Ground gallery string course');
    // Gilded trim rides on the Broodhuis ground-gallery string course.
    box(root, width - 1.2, 0.05, 0.1, 0, 6.84, 0.28, materials.gold, 'King’s House ground string course gold trim');
    // Dressed voussoir wedges ringing each pointed gallery arch, as in the real
    // Broodhuis ground arcade archivolt.
    const khVoussoirs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.3, 0.42), trim, bays * 5);
    const khVd = new THREE.Object3D();
    let khV = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (let j = 0; j < 5; j++) {
        const a = Math.PI * (0.14 + 0.72 * (j / 4));
        khVd.position.set(x + Math.cos(a) * 1.12, 6.05 + Math.sin(a) * 0.85, 0.2);
        khVd.rotation.z = a - Math.PI / 2;
        khVd.updateMatrix();
        khVoussoirs.setMatrixAt(khV++, khVd.matrix);
        khVd.rotation.z = 0;
      }
    }
    khVoussoirs.count = khV;
    khVoussoirs.name = 'King’s House gallery arch voussoirs';
    root.add(khVoussoirs);
    // Bronze spandrel relief panels between the ground-gallery arches, as on the real
    // neo-Gothic arcade.
    const khSpandrels = new THREE.InstancedMesh(new THREE.BoxGeometry(bayW - 1.3, 0.5, 0.1), materials.bronze, bays);
    for (let i = 0; i < bays; i++) {
      khVd.position.set(-width / 2 + bayW * (i + 0.5), 6.95, 0.26);
      khVd.rotation.z = 0;
      khVd.updateMatrix();
      khSpandrels.setMatrixAt(i, khVd.matrix);
    }
    khSpandrels.count = bays;
    khSpandrels.name = 'King’s House arcade spandrel reliefs';
    root.add(khSpandrels);
    // A second, outer archivolt ring of voussoirs encircles the ground arcade, as in the real
    // double-moulded Broodhuis arches.
    const khVoussoirs2 = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.26, 0.36), darkStone, bays * 5);
    let khV2 = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (let j = 0; j < 5; j++) {
        const a = Math.PI * (0.14 + 0.72 * (j / 4));
        khVd.position.set(x + Math.cos(a) * 1.32, 6.05 + Math.sin(a) * 1.0, 0.24);
        khVd.rotation.z = a - Math.PI / 2;
        khVd.updateMatrix();
        khVoussoirs2.setMatrixAt(khV2++, khVd.matrix);
        khVd.rotation.z = 0;
      }
    }
    khVoussoirs2.count = khV2;
    khVoussoirs2.name = 'King’s House outer archivolt voussoirs';
    root.add(khVoussoirs2);
    // Dark soffit panels close each ground-arcade bay of the Broodhuis, as on the real arcade.
    const khSoffits = new THREE.InstancedMesh(new THREE.BoxGeometry(bayW - 0.5, 0.08, 0.3), materials.dark, bays);
    for (let i = 0; i < bays; i++) {
      khVd.position.set(-width / 2 + bayW * (i + 0.5), 6.55, 0.3);
      khVd.rotation.z = 0;
      khVd.updateMatrix();
      khSoffits.setMatrixAt(i, khVd.matrix);
    }
    khSoffits.count = bays;
    khSoffits.name = 'King’s House arcade soffit panels';
    root.add(khSoffits);
    // First-floor gallery: arched windows above a continuous balustrade.
    box(root, width - 1.5, 0.85, 0.55, 0, 7.6, 0.4, trim, 'First gallery balustrade');
    // Balusters rise along the first gallery balustrade, as on the real Broodhuis.
    const khBalusters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), trim, 30);
    const khBd = new THREE.Object3D();
    for (let i = 0; i < 30; i++) {
      khBd.position.set(-width / 2 + 0.8 + i * (width - 1.6) / 29, 8.35, 0.55);
      khBd.updateMatrix();
      khBalusters.setMatrixAt(i, khBd.matrix);
    }
    khBalusters.count = 30;
    khBalusters.name = 'King’s House first-gallery balusters';
    root.add(khBalusters);
    // Springer stones where the first-floor gallery arches leave the piers.
    const khSpringers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.34, 0.44), trim, bays * 2);
    let ksp = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khBd.position.set(x + side * (bayW / 2 - 0.12), 8.6, 0.42);
        khBd.updateMatrix();
        khSpringers.setMatrixAt(ksp++, khBd.matrix);
      }
    }
    khSpringers.count = ksp;
    khSpringers.name = 'King’s House first-gallery arch springers';
    root.add(khSpringers);
    // A top rail crowns the first-gallery balustrade, as on the real Broodhuis.
    box(root, width - 1.5, 0.14, 0.4, 0, 8.72, 0.5, trim, 'King’s House first-gallery top rail');
    // Label stops terminate each first-floor gallery arch at its springing, as on the real
    // gallery.
    const khGalLabelStops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.36, 0.4), darkStone, bays * 2);
    let kls = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khBd.position.set(x + side * (bayW / 2 - 0.1), 8.75, 0.44);
        khBd.updateMatrix();
        khGalLabelStops.setMatrixAt(kls++, khBd.matrix);
      }
    }
    khGalLabelStops.count = kls;
    khGalLabelStops.name = 'King’s House first-gallery arch label stops';
    root.add(khGalLabelStops);
    // Gilded keystones cap the first-floor gallery arches, as on the real gallery.
    const khGalKeys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.4, 0.4), materials.gold, bays);
    for (let i = 0; i < bays; i++) {
      khBd.position.set(-width / 2 + bayW * (i + 0.5), 13.55, 0.3);
      khBd.updateMatrix();
      khGalKeys.setMatrixAt(i, khBd.matrix);
    }
    khGalKeys.count = bays;
    khGalKeys.name = 'King’s House first-gallery arch gold keystones';
    root.add(khGalKeys);
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      box(root, 1.5, 4.2, 0.2, x, 10.6, 0.22, glass, 'King’s House first-floor gallery arch');
      box(root, 1.7, 0.24, 0.3, x, 13.1, 0.22, trim, 'First gallery window hood');
    }
    // Stone sills project under every first-floor gallery window, as on the real Broodhuis.
    const khSills = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.18, 0.34), darkStone, bays);
    const khSd = new THREE.Object3D();
    for (let i = 0; i < bays; i++) {
      khSd.position.set(-width / 2 + bayW * (i + 0.5), 8.55, 0.32);
      khSd.updateMatrix();
      khSills.setMatrixAt(i, khSd.matrix);
    }
    khSills.count = bays;
    khSills.name = 'King’s House first-gallery window sills';
    root.add(khSills);
    // Cross tracery bars divide each first-floor gallery arch into lights, as in the real
    // tracery-dressed gallery.
    const khTracV = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 4.2, 0.08), trim, bays);
    const khTracH = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), trim, bays);
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      khSd.position.set(x, 10.6, 0.26);
      khSd.updateMatrix();
      khTracV.setMatrixAt(i, khSd.matrix);
      khSd.position.set(x, 11.6, 0.26);
      khSd.updateMatrix();
      khTracH.setMatrixAt(i, khSd.matrix);
    }
    khTracV.count = khTracH.count = bays;
    khTracV.name = 'King’s House gallery arch tracery (vertical)';
    khTracH.name = 'King’s House gallery arch tracery (horizontal)';
    root.add(khTracV, khTracH);
    // An outer archivolt ring encircles each first-floor gallery arch, as in the real
    // double-moulded gallery.
    const khArchivolt = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.26, 0.36), darkStone, bays * 5);
    let khA = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (let j = 0; j < 5; j++) {
        const a = Math.PI * (0.14 + 0.72 * (j / 4));
        khSd.position.set(x + Math.cos(a) * 0.95, 8.6 + Math.sin(a) * 0.75, 0.36);
        khSd.rotation.z = a - Math.PI / 2;
        khSd.updateMatrix();
        khArchivolt.setMatrixAt(khA++, khSd.matrix);
        khSd.rotation.z = 0;
      }
    }
    khArchivolt.count = khA;
    khArchivolt.name = 'King’s House gallery outer archivolt';
    root.add(khArchivolt);
    // Dark spandrel panels fill the first-floor gallery between its arches, as on the real
    // Broodhuis gallery.
    const khGalSpandrels = new THREE.InstancedMesh(new THREE.BoxGeometry(bayW - 1.2, 1.6, 0.1), darkStone, bays);
    for (let i = 0; i < bays; i++) {
      khSd.position.set(-width / 2 + bayW * (i + 0.5), 12.4, 0.28);
      khSd.updateMatrix();
      khGalSpandrels.setMatrixAt(i, khSd.matrix);
    }
    khGalSpandrels.count = bays;
    khGalSpandrels.name = 'King’s House first-gallery spandrel panels';
    root.add(khGalSpandrels);
    // Corbels carry the first-floor gallery along its length, as on the real Broodhuis.
    const khGalCorbels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.4, 0.44), darkStone, bays);
    for (let i = 0; i < bays; i++) {
      khSd.position.set(-width / 2 + bayW * (i + 0.5), 8.4, 0.5);
      khSd.updateMatrix();
      khGalCorbels.setMatrixAt(i, khSd.matrix);
    }
    khGalCorbels.count = bays;
    khGalCorbels.name = 'King’s House first-gallery corbels';
    root.add(khGalCorbels);
    // Gilded balls cap each first-gallery corbel, as on the real Broodhuis gallery.
    const corbelBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), materials.gold, bays);
    for (let i = 0; i < bays; i++) {
      khSd.position.set(-width / 2 + bayW * (i + 0.5), 8.62, 0.52);
      khSd.updateMatrix();
      corbelBalls.setMatrixAt(i, khSd.matrix);
    }
    corbelBalls.count = bays;
    corbelBalls.name = 'King’s House gallery corbel gold balls';
    root.add(corbelBalls);
    // Keystones at every gallery arch apex and quatrefoil oculi above the first-floor gallery
    // arches — the neo-Gothic galleries of the real Broodhuis are tracery-dressed.
    const khKeystones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.4, 0.34), darkStone, bays * 2);
    const khOculi = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12).rotateX(Math.PI / 2), trim, bays);
    const khd = new THREE.Object3D();
    let khK = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      khd.position.set(x, 7.2, 0.22);
      khd.updateMatrix();
      khKeystones.setMatrixAt(khK++, khd.matrix);
      khd.position.set(x, 13.35, 0.26);
      khd.updateMatrix();
      khKeystones.setMatrixAt(khK++, khd.matrix);
      khd.position.set(x, 13.7, 0.24);
      khd.updateMatrix();
      khOculi.setMatrixAt(i, khd.matrix);
    }
    khKeystones.count = khK;
    khOculi.count = bays;
    khKeystones.name = 'King’s House gallery arch keystones';
    khOculi.name = 'King’s House gallery oculi';
    root.add(khKeystones, khOculi);
    // Impost blocks spring the gallery arches from the piers, as on the real Broodhuis.
    const khImposts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.3, 0.4), trim, bays * 2);
    let ki = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khd.position.set(x + side * (bayW / 2 - 0.1), 6.6, 0.24);
        khd.updateMatrix();
        khImposts.setMatrixAt(ki++, khd.matrix);
      }
    }
    khImposts.count = ki;
    khImposts.name = 'King’s House gallery arch impost blocks';
    root.add(khImposts);
    // Cross tracery bars over the gallery oculi, as in the real neo-Gothic oculi.
    const oculiBarsV = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.56, 0.05), trim, bays);
    const oculiBarsH = new THREE.InstancedMesh(new THREE.BoxGeometry(0.56, 0.06, 0.05), trim, bays);
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      khd.position.set(x, 13.7, 0.27);
      khd.updateMatrix();
      oculiBarsV.setMatrixAt(i, khd.matrix);
      oculiBarsH.setMatrixAt(i, khd.matrix);
    }
    oculiBarsV.count = oculiBarsH.count = bays;
    oculiBarsV.name = 'King’s House gallery oculi tracery (vertical)';
    oculiBarsH.name = 'King’s House gallery oculi tracery (horizontal)';
    root.add(oculiBarsV, oculiBarsH);
    // Gilded trim tops each Broodhuis gallery impost block, as on the real piers.
    const impostTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.06, 0.12), materials.gold, bays * 2);
    let it2 = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khd.position.set(x + side * (bayW / 2 - 0.1), 6.78, 0.26);
        khd.updateMatrix();
        impostTrim.setMatrixAt(it2++, khd.matrix);
      }
    }
    impostTrim.count = it2;
    impostTrim.name = 'King’s House impost gold trim';
    root.add(impostTrim);
    // Capitals widen the tops of the ground-gallery piers, as on the real arcade.
    const khPierCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 0.24, 0.56), trim, bays * 2);
    let kpc = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khd.position.set(x + side * (bayW / 2 - 0.1), 6.85, 0.24);
        khd.updateMatrix();
        khPierCaps.setMatrixAt(kpc++, khd.matrix);
      }
    }
    khPierCaps.count = kpc;
    khPierCaps.name = 'King’s House gallery pier capitals';
    root.add(khPierCaps);
    // Plinth blocks at the foot of every ground-gallery pier, as on the real arcade.
    const khPierBases = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 0.4, 0.6), darkStone, bays * 2);
    let kpb = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khd.position.set(x + side * (bayW / 2 - 0.1), 0.2, 0.24);
        khd.updateMatrix();
        khPierBases.setMatrixAt(kpb++, khd.matrix);
      }
    }
    khPierBases.count = kpb;
    khPierBases.name = 'King’s House gallery pier plinth blocks';
    root.add(khPierBases);
    // Gilded caps top each Broodhuis gallery pier capital, as on the real arcade.
    const khCapBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), materials.gold, bays * 2);
    let kcb = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khd.position.set(x + side * (bayW / 2 - 0.1), 7.02, 0.26);
        khd.updateMatrix();
        khCapBalls.setMatrixAt(kcb++, khd.matrix);
      }
    }
    khCapBalls.count = kcb;
    khCapBalls.name = 'King’s House pier capital gold balls';
    root.add(khCapBalls);
    // Upper storey: windows plus gilded statues in niches at the alternating bay joints.
    const khNiches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.66, 2.2, 0.2), darkStone, bays);
    const khStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 1.1, 0.12), materials.gold, bays);
    const khDummy = new THREE.Object3D();
    let khN = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      box(root, 1.4, 3.4, 0.18, x, 16.8, 0.22, glass, 'King’s House upper window');
      box(root, 1.6, 0.22, 0.3, x, 18.6, 0.22, trim, 'Upper window hood');
    }
    // A stone mullion divides each upper-storey window into twin lights, as in the real
    // neo-Gothic upper floor.
    const khMullions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 3.4, 0.2), trim, bays);
    const khMd = new THREE.Object3D();
    for (let i = 0; i < bays; i++) {
      khMd.position.set(-width / 2 + bayW * (i + 0.5), 16.8, 0.24);
      khMd.updateMatrix();
      khMullions.setMatrixAt(i, khMd.matrix);
    }
    khMullions.count = bays;
    khMullions.name = 'King’s House upper window mullions';
    root.add(khMullions);
    // Corbel brackets carry every upper-storey window sill, as on the real facade.
    const khSillBrackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.2, 0.28), darkStone, bays * 2);
    let ksb = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khMd.position.set(x + side * 0.65, 15.05, 0.26);
        khMd.updateMatrix();
        khSillBrackets.setMatrixAt(ksb++, khMd.matrix);
      }
    }
    khSillBrackets.count = ksb;
    khSillBrackets.name = 'King’s House upper window sill brackets';
    root.add(khSillBrackets);
    // Stone side mouldings frame every upper-storey window pair, as on the real facade.
    const khSideMoulds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 3.6, 0.22), trim, bays * 2);
    let ksm = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khMd.position.set(x + side * 0.78, 16.8, 0.24);
        khMd.updateMatrix();
        khSideMoulds.setMatrixAt(ksm++, khMd.matrix);
      }
    }
    khSideMoulds.count = ksm;
    khSideMoulds.name = 'King’s House upper window side mouldings';
    root.add(khSideMoulds);
    // Gilded statue niches flank every upper-storey window pair, as on the real Broodhuis.
    const khUpperNiches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 2.2, 0.16), darkStone, bays * 2);
    const khUpperStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1.0, 0.1), materials.gold, bays * 2);
    let kun = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khMd.position.set(x + side * 1.05, 16.8, 0.26);
        khMd.updateMatrix();
        khUpperNiches.setMatrixAt(kun, khMd.matrix);
        khMd.position.set(x + side * 1.05, 16.8, 0.36);
        khMd.updateMatrix();
        khUpperStatues.setMatrixAt(kun++, khMd.matrix);
      }
    }
    khUpperNiches.count = khUpperStatues.count = kun;
    khUpperNiches.name = 'King’s House upper statue niches';
    khUpperStatues.name = 'King’s House upper gilded statues';
    root.add(khUpperNiches, khUpperStatues);
    // Gilded trim tops each Broodhuis upper statue niche, as on the real facade.
    const upperNicheTrim = new THREE.InstancedMesh(new THREE.BoxGeometry(0.56, 0.08, 0.18), materials.gold, bays * 2);
    let unt = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const side of [-1, 1]) {
        khMd.position.set(x + side * 1.05, 18.05, 0.28);
        khMd.updateMatrix();
        upperNicheTrim.setMatrixAt(unt++, khMd.matrix);
      }
    }
    upperNicheTrim.count = unt;
    upperNicheTrim.name = 'King’s House upper niche gold trim';
    root.add(upperNicheTrim);
    for (let i = 1; i <= bays; i += 2) {
      const x = -width / 2 + i * bayW;
      khDummy.position.set(x, 10.6, 0.3);
      khDummy.updateMatrix();
      khNiches.setMatrixAt(khN, khDummy.matrix);
      khDummy.position.set(x, 10.6, 0.42);
      khDummy.updateMatrix();
      khStatues.setMatrixAt(khN, khDummy.matrix);
      khN++;
    }
    khNiches.count = khStatues.count = khN;
    khNiches.name = 'King’s House statue niches';
    khStatues.name = 'King’s House gilded statues';
    khNiches.castShadow = khStatues.castShadow = true;
    root.add(khNiches, khStatues);
    // Crocketed canopy pinnacles crowning each gilded-statue niche, as on the real facade.
    const khPinnacles = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.7, 4), trim, khN);
    const khPinBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 6, 5), materials.gold, khN);
    const khPd = new THREE.Object3D();
    for (let i = 1, p = 0; i <= bays; i += 2, p++) {
      const x = -width / 2 + i * bayW;
      khPd.position.set(x, 11.85, 0.36);
      khPd.updateMatrix();
      khPinnacles.setMatrixAt(p, khPd.matrix);
      khPd.position.y += 0.42;
      khPd.updateMatrix();
      khPinBalls.setMatrixAt(p, khPd.matrix);
    }
    khPinnacles.count = khPinBalls.count = khN;
    khPinnacles.name = 'King’s House statue canopy pinnacles';
    khPinBalls.name = 'King’s House pinnacle finial balls';
    root.add(khPinnacles, khPinBalls);

    // Standard-bearer statues dotting the parapet, as on the real roofline.
    for (let i = 0; i < 6; i++) {
      const x = -width / 2 + 3.5 + i * 5.2;
      box(root, 0.24, 1.0, 0.12, x, height + 0.55, 0.18, materials.gold, 'King’s House standard-bearer statue');
    }
    // Each standard-bearer carries a gilded lance, as on the real roofline statues.
    const lances = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), materials.gold, 6);
    const khLd2 = new THREE.Object3D();
    for (let i = 0; i < 6; i++) {
      khLd2.position.set(-width / 2 + 3.5 + i * 5.2 + 0.2, height + 1.3, 0.18);
      khLd2.updateMatrix();
      lances.setMatrixAt(i, khLd2.matrix);
    }
    lances.count = 6;
    lances.name = 'King’s House standard-bearer lances';
    root.add(lances);
    // Crenellated parapet merlons along the Broodhuis front eave, as on the real roofline.
    const khMerlons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.65, 0.3), trim, 26);
    for (let i = 0; i < 26; i++) {
      khLd2.position.set(-width / 2 + 0.6 + i * (width - 1.2) / 25, height + 0.85, 0.6);
      khLd2.updateMatrix();
      khMerlons.setMatrixAt(i, khLd2.matrix);
    }
    khMerlons.count = 26;
    khMerlons.name = 'King’s House crenellated parapet merlons';
    root.add(khMerlons);
    // Stone urns stand on the parapet at the Broodhuis front corners, as on the real roofline.
    const khUrns = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 0.6, 8), trim, 2);
    for (let i = 0; i < 2; i++) {
      khLd2.position.set((i === 0 ? -1 : 1) * (width / 2 - 1.2), height + 1.1, 0.6);
      khLd2.updateMatrix();
      khUrns.setMatrixAt(i, khLd2.matrix);
    }
    khUrns.count = 2;
    khUrns.name = 'King’s House parapet urns';
    root.add(khUrns);
    // Openwork arch gaps pierce the Broodhuis crenellated parapet between the merlons.
    const khParapetGaps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.45, 0.34), darkStone, 25);
    for (let i = 0; i < 25; i++) {
      khLd2.position.set(-width / 2 + 1.1 + i * (width - 2.2) / 25, height + 0.85, 0.6);
      khLd2.updateMatrix();
      khParapetGaps.setMatrixAt(i, khLd2.matrix);
    }
    khParapetGaps.count = 25;
    khParapetGaps.name = 'King’s House openwork parapet gaps';
    root.add(khParapetGaps);
    // Gilded cresting finials march along the Broodhuis eave between the merlons, as on the
    // real roofline.
    const khEaveCrests = new THREE.InstancedMesh(new THREE.ConeGeometry(0.1, 0.45, 5), materials.gold, 13);
    for (let i = 0; i < 13; i++) {
      khLd2.position.set(-width / 2 + 1.2 + i * (width - 2.4) / 12, height + 1.25, 0.6);
      khLd2.updateMatrix();
      khEaveCrests.setMatrixAt(i, khLd2.matrix);
    }
    khEaveCrests.count = 13;
    khEaveCrests.name = 'King’s House eave cresting finials';
    root.add(khEaveCrests);

    // Vast slate roof behind the central pavilion, ridge running along the long axis.
    const ridgeY = height + 6.5, eaveY = height + 0.5;
    const roofVertices = new Float32Array([
      -width/2-0.8,eaveY,0.5, width/2+0.8,eaveY,0.5, width/2+0.8,ridgeY,-depth/2,
      -width/2-0.8,eaveY,0.5, width/2+0.8,ridgeY,-depth/2, -width/2-0.8,ridgeY,-depth/2,
      -width/2-0.8,eaveY,-depth-0.5, width/2+0.8,ridgeY,-depth/2, width/2+0.8,eaveY,-depth-0.5,
      -width/2-0.8,eaveY,-depth-0.5, -width/2-0.8,ridgeY,-depth/2, width/2+0.8,ridgeY,-depth/2
    ]);
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.BufferAttribute(roofVertices, 3));
    roofGeo.computeVertexNormals();
    mesh(root, roofGeo, roofMat, 0, 0, 0, 'King’s House steep slate roof');
    // Lead valley flashings run where the great roof meets the central pavilion, as on the
    // real roof junctions.
    box(root, 0.3, 0.1, depth + 1.2, -5.6, height + 2.7, -depth / 2, materials.dark, 'King’s House roof valley flashing');
    box(root, 0.3, 0.1, depth + 1.2, 5.6, height + 2.7, -depth / 2, materials.dark, 'King’s House roof valley flashing');
    for (let i = 0; i < 7; i++) {
      const x = -width / 2 + 3 + i * 4.3;
      const z = -depth / 2 + (i % 2 ? -2.6 : 2.6);
      box(root, 1.3, 2.0, 0.6, x, height + 2.0, z, trim, 'King’s House roof dormer');
    }
    // Triangular pediments crown the seven slate-roof dormers of the real Broodhuis roof.
    const khDormPedShape = new THREE.Shape();
    khDormPedShape.moveTo(-0.75, 0); khDormPedShape.lineTo(0, 0.5); khDormPedShape.lineTo(0.75, 0); khDormPedShape.closePath();
    const khDormPeds = new THREE.InstancedMesh(new THREE.ShapeGeometry(khDormPedShape), trim, 7);
    const khPd2 = new THREE.Object3D();
    for (let i = 0; i < 7; i++) {
      khPd2.position.set(-width / 2 + 3 + i * 4.3, height + 3.05, -depth / 2 + (i % 2 ? -2.6 : 2.6));
      khPd2.updateMatrix();
      khDormPeds.setMatrixAt(i, khPd2.matrix);
    }
    khDormPeds.count = 7;
    khDormPeds.name = 'King’s House dormer pediments';
    root.add(khDormPeds);
    // Side cheeks dress each of the seven roof dormers, as on the real slate roof.
    const khDormCheeks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 2.0, 0.7), trim, 14);
    let kdc = 0;
    for (let i = 0; i < 7; i++) {
      const x = -width / 2 + 3 + i * 4.3;
      const z = -depth / 2 + (i % 2 ? -2.6 : 2.6);
      for (const side of [-1, 1]) {
        khPd2.position.set(x + side * 0.65, height + 2.0, z);
        khPd2.updateMatrix();
        khDormCheeks.setMatrixAt(kdc++, khPd2.matrix);
      }
    }
    khDormCheeks.count = kdc;
    khDormCheeks.name = 'King’s House dormer side cheeks';
    root.add(khDormCheeks);
    // Stone sills project under each roof dormer, as on the real slate roof.
    const khDormSills = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.14, 0.7), darkStone, 7);
    for (let i = 0; i < 7; i++) {
      khPd2.position.set(-width / 2 + 3 + i * 4.3, height + 1.0, -depth / 2 + (i % 2 ? -2.6 : 2.6));
      khPd2.updateMatrix();
      khDormSills.setMatrixAt(i, khPd2.matrix);
    }
    khDormSills.count = 7;
    khDormSills.name = 'King’s House dormer sill stones';
    root.add(khDormSills);
    // Gilded balls tip each Broodhuis dormer pediment, as on the real roof.
    const khDormTips = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), materials.gold, 7);
    for (let i = 0; i < 7; i++) {
      khPd2.position.set(-width / 2 + 3 + i * 4.3, height + 3.62, -depth / 2 + (i % 2 ? -2.6 : 2.6));
      khPd2.updateMatrix();
      khDormTips.setMatrixAt(i, khPd2.matrix);
    }
    khDormTips.count = 7;
    khDormTips.name = 'King’s House dormer pediment finial balls';
    root.add(khDormTips);

    // Central pavilion with a stepped gable and Jamaer's central tower: square shaft,
    // octagonal top, domed slate spire — 38.49 m in reality.
    box(root, 11, height + 2.5, depth + 1.4, 0, (height + 2.5) / 2, -depth / 2 - 0.5, stone, 'King’s House central pavilion');
    // Oversized quoins chain the front corners of the central pavilion, as on Jamaer's facade.
    const pvRows = Math.floor((height + 2.5) / 0.9);
    const pvQuoins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), darkStone, pvRows * 2);
    let pvq = 0;
    for (let r = 0; r < pvRows; r++) {
      for (const sx of [-1, 1]) {
        khQd.position.set(sx * 5.3, 1.4 + r * 0.9, 0.2);
        khQd.updateMatrix();
        pvQuoins.setMatrixAt(pvq++, khQd.matrix);
      }
    }
    pvQuoins.count = pvq;
    pvQuoins.name = 'King’s House pavilion corner quoins';
    root.add(pvQuoins);
    // Gilded balls cap the top quoins of the Broodhuis central pavilion.
    const pvCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), materials.gold, 2);
    for (let i = 0; i < 2; i++) {
      khQd.position.set((i === 0 ? -1 : 1) * 5.3, height + 2.5 - 0.4, 0.2);
      khQd.updateMatrix();
      pvCaps.setMatrixAt(i, khQd.matrix);
    }
    pvCaps.count = 2;
    pvCaps.name = 'King’s House pavilion quoin gold caps';
    root.add(pvCaps);
    const gw = 11, gh = 4.5;
    const gable = new THREE.Shape();
    gable.moveTo(-gw / 2, 0); gable.lineTo(-gw / 2, 1.1); gable.lineTo(-gw / 2 + 1.2, 1.1);
    gable.lineTo(-gw / 2 + 1.2, 2.2); gable.lineTo(-gw / 2 + 2.4, 2.2); gable.lineTo(-gw / 2 + 2.4, 3.3);
    gable.lineTo(0, gh); gable.lineTo(gw / 2 - 2.4, 3.3); gable.lineTo(gw / 2 - 2.4, 2.2);
    gable.lineTo(gw / 2 - 1.2, 2.2); gable.lineTo(gw / 2 - 1.2, 1.1); gable.lineTo(gw / 2, 1.1);
    gable.lineTo(gw / 2, 0); gable.closePath();
    mesh(root, new THREE.ShapeGeometry(gable), stone, 0, height + 2.5, 0.3, 'King’s House central stepped gable');
    // Oculus (oeil-de-boeuf) traceried into the central gable with stone cresting
    // finials on each gable step, as on Jamaer's real 1890s Broodhuis risalit gable.
    const gableRim = cylinder(root, 0.66, 0.66, 0.18, 0, height + 5.0, 0.32, trim, 20);
    gableRim.name = 'King’s House gable oculus rim';
    mesh(root, new THREE.CircleGeometry(0.5, 20), glass, 0, height + 5.0, 0.34, 'King’s House gable oculus');
    // Cross tracery bars divide the gable oculus, as in the real traceried oeil-de-boeuf.
    box(root, 0.06, 0.95, 0.04, 0, height + 5.0, 0.35, trim, 'King’s House gable oculus tracery vertical');
    box(root, 0.95, 0.06, 0.04, 0, height + 5.0, 0.35, trim, 'King’s House gable oculus tracery horizontal');
    const khCrest = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.2, 0.55, 6), trim, 6);
    const khCrestBall = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5), materials.gold, 6);
    const khCd = new THREE.Object3D();
    const crestPts = [[-gw / 2 + 0.6, 1.1], [-gw / 2 + 1.8, 2.2], [-gw / 2 + 3.0, 3.3], [gw / 2 - 3.0, 3.3], [gw / 2 - 1.8, 2.2], [gw / 2 - 0.6, 1.1]];
    for (let c = 0; c < 6; c++) {
      khCd.position.set(crestPts[c][0], height + 2.5 + crestPts[c][1] + 0.28, 0.32);
      khCd.updateMatrix();
      khCrest.setMatrixAt(c, khCd.matrix);
      khCd.position.y += 0.32;
      khCd.updateMatrix();
      khCrestBall.setMatrixAt(c, khCd.matrix);
    }
    khCrest.count = khCrestBall.count = 6;
    khCrest.name = 'King’s House gable step cresting';
    khCrestBall.name = 'King’s House gable crest finial balls';
    root.add(khCrest, khCrestBall);
    // Recessed inner panel in the stepped gable, framed by gilded edge flashing along the
    // gable slopes — the real risalit gable is panelled and trimmed.
    box(root, 6.4, 2.2, 0.08, 0, height + 2.5 + 2.1, 0.36, darkStone, 'King’s House gable inner panel');
    const gableFlashL = box(root, 4.6, 0.08, 0.08, -gw / 4 - 0.6, height + 2.5 + gh / 2 + 0.9, 0.36, materials.gold, 'King’s House gable edge flashing');
    gableFlashL.rotation.z = 0.5;
    const gableFlashR = box(root, 4.6, 0.08, 0.08, gw / 4 + 0.6, height + 2.5 + gh / 2 + 0.9, 0.36, materials.gold, 'King’s House gable edge flashing');
    gableFlashR.rotation.z = -0.5;
    // Gilded cross finial at the apex of the central gable.
    box(root, 0.06, 0.7, 0.06, 0, height + 2.5 + gh + 0.35, 0.32, materials.gold, 'King’s House gable apex cross vertical');
    box(root, 0.42, 0.06, 0.06, 0, height + 2.5 + gh + 0.5, 0.32, materials.gold, 'King’s House gable apex cross arm');
    const towerZ = -depth / 2 - 0.7;
    box(root, 2.8, 33, 2.8, 0, 16.5, towerZ, trim, 'King’s House central tower square shaft');
    // Projecting string rings circle the tower shaft at intervals, as on the real tower.
    const khShaftRings = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.55, 1.55, 0.3, 8), darkStone, 3);
    for (let i = 0; i < 3; i++) {
      khQd.position.set(0, 10 + i * 8, towerZ);
      khQd.updateMatrix();
      khShaftRings.setMatrixAt(i, khQd.matrix);
    }
    khShaftRings.count = 3;
    khShaftRings.name = 'King’s House tower shaft string rings';
    root.add(khShaftRings);
    // Glazed lancets pierce both side faces of the Broodhuis tower shaft, as on the real tower.
    const khShaftSide = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 3.2, 1.7), glass, 4);
    let kss = 0;
    for (const sx of [-1, 1]) {
      for (const y of [15, 25]) {
        khQd.position.set(sx * 1.45, y, towerZ);
        khQd.updateMatrix();
        khShaftSide.setMatrixAt(kss++, khQd.matrix);
      }
    }
    khShaftSide.count = kss;
    khShaftSide.name = 'King’s House tower shaft side lancets';
    root.add(khShaftSide);
    // A wider plinth course grounds the Broodhuis tower, as on the real tower foot.
    box(root, 4.0, 1.0, 4.0, 0, 0.5, towerZ, darkStone, 'King’s House tower base plinth');
    // Gilded balls stud the Broodhuis tower's string rings, as on the real tower.
    const ringBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), materials.gold, 3);
    for (let i = 0; i < 3; i++) {
      khQd.position.set(1.55, 10 + i * 8, towerZ);
      khQd.updateMatrix();
      ringBalls.setMatrixAt(i, khQd.matrix);
    }
    ringBalls.count = 3;
    ringBalls.name = 'King’s House string ring gilded balls';
    root.add(ringBalls);
    // Gilded balls cap the Broodhuis tower's side lancet hoods, as on the real shaft.
    const shaftSideBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), materials.gold, 4);
    for (let i = 0; i < 4; i++) {
      const sx = i < 2 ? -1 : 1, y = i % 2 ? 25 : 15;
      khQd.position.set(sx * 1.5, y + 1.75, towerZ);
      khQd.updateMatrix();
      shaftSideBalls.setMatrixAt(i, khQd.matrix);
    }
    shaftSideBalls.count = 4;
    shaftSideBalls.name = 'King’s House shaft side lancet hood balls';
    root.add(shaftSideBalls);
    cylinder(root, 1.35, 1.5, 2.6, 0, 34.3, towerZ, trim, 8).name = 'King’s House central tower octagonal top';
    // Louvered belfry openings around the octagonal top of the real Broodhuis tower.
    const khLouvers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.1, 0.2), darkStone, 8);
    const khLd = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      khLd.position.set(Math.cos(a) * 1.42, 34.3, towerZ + Math.sin(a) * 1.42);
      khLd.rotation.y = -a;
      khLd.updateMatrix();
      khLouvers.setMatrixAt(i, khLd.matrix);
    }
    khLouvers.count = 8;
    khLouvers.name = 'King’s House belfry louver openings';
    root.add(khLouvers);
    // Gilded balls crown the corners of the Broodhuis tower's octagonal top.
    const khOctBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), materials.gold, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      khLd.position.set(Math.cos(a) * 1.5, 35.7, towerZ + Math.sin(a) * 1.5);
      khLd.rotation.y = 0;
      khLd.updateMatrix();
      khOctBalls.setMatrixAt(i, khLd.matrix);
    }
    khOctBalls.count = 8;
    khOctBalls.name = 'King’s House octagonal top corner balls';
    root.add(khOctBalls);
    const dome = mesh(root, new THREE.SphereGeometry(1.7, 12, 8), roofMat, 0, 36.3, towerZ, 'King’s House tower domed slate spire');
    dome.scale.set(1, 0.75, 1);
    // Meridian ribs run up the domed slate spire, as on the real dome.
    const khDomeRibs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 1.9, 0.07), trim, 8);
    const khRibd = new THREE.Object3D();
    const ribUp = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const from = new THREE.Vector3(Math.cos(a) * 1.45, 36.5, towerZ + Math.sin(a) * 1.45);
      const to = new THREE.Vector3(0, 37.55, towerZ);
      const d = to.clone().sub(from);
      khRibd.position.copy(from.clone().add(to).multiplyScalar(0.5));
      khRibd.quaternion.setFromUnitVectors(ribUp, d.normalize());
      khRibd.scale.set(1, d.length(), 1);
      khRibd.updateMatrix();
      khDomeRibs.setMatrixAt(i, khRibd.matrix);
      khRibd.scale.set(1, 1, 1);
    }
    khDomeRibs.count = 8;
    khDomeRibs.name = 'King’s House tower dome meridian ribs';
    root.add(khDomeRibs);
    cylinder(root, 0.08, 0.14, 1.2, 0, 38.2, towerZ, materials.gold, 6).name = 'King’s House tower finial';
    // Gilded flag flying from the tower finial.
    const khFlag = box(root, 0.7, 0.4, 0.04, 0.4, 38.9, towerZ, materials.gold, 'King’s House tower gilded flag');
    khFlag.rotation.z = 0.12;
    // Statue of Charles V on the central tower, as on the real building.
    box(root, 0.5, 1.8, 0.2, 0, 30.5, towerZ + 1.55, darkStone, 'King’s House Charles V statue');
    mesh(root, new THREE.SphereGeometry(0.24, 8, 6), darkStone, 0, 31.6, towerZ + 1.55, 'King’s House Charles V statue head');
    // Canopy niche hood over the Charles V statue on the tower.
    const charlesHoodShape = new THREE.Shape();
    charlesHoodShape.moveTo(-0.8, 0); charlesHoodShape.lineTo(0, 0.4); charlesHoodShape.lineTo(0.8, 0); charlesHoodShape.closePath();
    mesh(root, new THREE.ShapeGeometry(charlesHoodShape), trim, 0, 31.95, towerZ + 1.55, 'King’s House Charles V canopy hood');
    // Charles V holds the imperial orb and sceptre, as on the real tower statue.
    mesh(root, new THREE.SphereGeometry(0.12, 8, 6), materials.gold, 0.42, 30.9, towerZ + 1.55, 'King’s House Charles V imperial orb');
    box(root, 0.05, 0.8, 0.05, -0.4, 30.9, towerZ + 1.55, materials.gold, 'King’s House Charles V sceptre');
    // The 1625 Virgin Mary statue group on the central pavilion: Mary flanked by two saints.
    box(root, 0.5, 1.9, 0.2, 0, 19.0, 0.26, stone, 'King’s House Virgin Mary statue');
    mesh(root, new THREE.SphereGeometry(0.24, 8, 6), stone, 0, 20.1, 0.26, 'King’s House Virgin Mary statue head');
    // A gilded halo crowns the 1625 Virgin Mary, as on the real statue group.
    const maryHalo = mesh(root, new THREE.TorusGeometry(0.3, 0.04, 6, 16), materials.gold, 0, 20.15, 0.2, 'King’s House Virgin Mary halo');
    maryHalo.rotation.y = Math.PI / 2;
    for (const side of [-1, 1]) {
      box(root, 0.4, 1.5, 0.18, side * 1.2, 18.8, 0.26, stone, 'King’s House saint statue');
      mesh(root, new THREE.SphereGeometry(0.2, 8, 6), stone, side * 1.2, 19.65, 0.26, 'King’s House saint statue head');
      const saintHalo = mesh(root, new THREE.TorusGeometry(0.24, 0.03, 6, 14), materials.gold, side * 1.2, 19.7, 0.2, 'King’s House saint halo');
      saintHalo.rotation.y = Math.PI / 2;
    }
    // A small canopy hood shelters the 1625 Virgin Mary statue group on the pavilion.
    const maryHoodShape = new THREE.Shape();
    maryHoodShape.moveTo(-1.8, 0); maryHoodShape.lineTo(0, 0.7); maryHoodShape.lineTo(1.8, 0); maryHoodShape.closePath();
    mesh(root, new THREE.ShapeGeometry(maryHoodShape), trim, 0, 20.4, 0.28, 'King’s House Virgin Mary group canopy');
    // Clock face on the tower shaft below the octagonal belfry — the real Broodhuis
    // tower carries a clock above the roofline.
    const clockRim = cylinder(root, 1.18, 1.18, 0.12, 0, 29.0, towerZ + 1.42, darkStone, 24);
    clockRim.name = 'King’s House tower clock rim';
    mesh(root, new THREE.CircleGeometry(1.05, 24), materials.plaster, 0, 29.0, towerZ + 1.43, 'King’s House tower clock face');
    box(root, 0.09, 0.62, 0.04, 0, 29.12, towerZ + 1.49, materials.dark, 'King’s House clock minute hand');
    box(root, 0.09, 0.42, 0.04, 0.18, 28.9, towerZ + 1.49, materials.dark, 'King’s House clock hour hand');
    // Gilded studs ring the clock rim, as on the real tower clock.
    const clockStuds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 5), materials.gold, 12);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      khQd.position.set(Math.cos(a) * 1.18, 29.0 + Math.sin(a) * 1.18, towerZ + 1.44);
      khQd.updateMatrix();
      clockStuds.setMatrixAt(i, khQd.matrix);
    }
    clockStuds.count = 12;
    clockStuds.name = 'King’s House clock rim gilded studs';
    root.add(clockStuds);
    // A second clock face on the back of the Broodhuis tower, as on the real tower.
    mesh(root, new THREE.CircleGeometry(1.05, 24), materials.plaster, 0, 29.0, towerZ - 1.43, 'King’s House tower clock face (rear)');
    // Grand pointed portal in the central ground-floor bay: door leaves, archivolt,
    // sculpted tympanum and a flight of steps — the real Broodhuis main entrance.
    box(root, 2.3, 4.0, 0.2, 0, 2.5, 0.18, materials.dark, 'King’s House portal door leaves');
    // The portal doors are double-leaf, with gilded strap hinges on each leaf.
    box(root, 0.06, 3.8, 0.06, 0, 2.5, 0.24, materials.gold, 'King’s House portal door split');
    for (const side of [-1, 1]) {
      box(root, 0.1, 0.5, 0.06, side * 1.1, 1.6, 0.24, materials.gold, 'King’s House portal strap hinge');
      box(root, 0.1, 0.5, 0.06, side * 1.1, 3.4, 0.24, materials.gold, 'King’s House portal strap hinge');
    }
    // Gilded studs are hammered into the Broodhuis portal door leaves, as on the real doors.
    const doorStuds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 5), materials.gold, 8);
    for (let i = 0; i < 8; i++) {
      khQd.position.set(-0.8 + (i % 4) * 0.55, 1.2 + Math.floor(i / 4) * 2.2, 0.3);
      khQd.updateMatrix();
      doorStuds.setMatrixAt(i, khQd.matrix);
    }
    doorStuds.count = 8;
    doorStuds.name = 'King’s House portal door studs';
    root.add(doorStuds);
    box(root, 0.12, 3.6, 0.24, 0, 2.3, 0.18, trim, 'King’s House portal door mullion');
    const portL = box(root, 1.6, 0.24, 0.4, -0.55, 5.35, 0.2, trim, 'King’s House portal pointed arch');
    portL.rotation.z = -0.6;
    const portR = box(root, 1.6, 0.24, 0.4, 0.55, 5.35, 0.2, trim, 'King’s House portal pointed arch');
    portR.rotation.z = 0.6;
    // An outer archivolt ring encircles the Broodhuis portal, as in the real double-moulded
    // entrance.
    const portOL = box(root, 1.9, 0.26, 0.44, -0.75, 5.6, 0.2, darkStone, 'King’s House portal outer archivolt');
    portOL.rotation.z = -0.68;
    const portOR = box(root, 1.9, 0.26, 0.44, 0.75, 5.6, 0.2, darkStone, 'King’s House portal outer archivolt');
    portOR.rotation.z = 0.68;
    const tymp = new THREE.Shape();
    tymp.moveTo(-1.1, 0); tymp.lineTo(1.1, 0); tymp.lineTo(0, 0.85); tymp.closePath();
    mesh(root, new THREE.ShapeGeometry(tymp), darkStone, 0, 5.6, 0.2, 'King’s House portal tympanum');
    for (let s = 0; s < 3; s++) {
      box(root, 3.6 + s * 0.4, 0.22, 0.35, 0, 0.11 + (2 - s) * 0.22, 0.55 + s * 0.3, darkStone, 'King’s House portal step');
    }
    // A lantern hangs over the central portal, lit at night like the real entrance.
    box(root, 0.4, 0.5, 0.24, 0, 7.15, 0.3, glowGlass, 'King’s House portal lantern');
    box(root, 0.5, 0.08, 0.3, 0, 7.44, 0.3, materials.gold, 'King’s House portal lantern cap');
    // A small traceried oculus sits above the portal lantern, as on the real Broodhuis.
    const portalOculus = cylinder(root, 0.3, 0.3, 0.1, 0, 7.85, 0.3, trim, 12);
    portalOculus.name = 'King’s House portal oculus rim';
    portalOculus.rotation.x = Math.PI / 2;
    mesh(root, new THREE.CircleGeometry(0.24, 12), glass, 0, 7.85, 0.32, 'King’s House portal oculus');
    // Gilded attendant figures flank the Broodhuis portal in niches, as on the real facade.
    for (const side of [-1, 1]) {
      box(root, 0.5, 2.0, 0.18, side * 2.2, 1.4, 0.2, darkStone, 'King’s House portal attendant niche');
      box(root, 0.22, 1.1, 0.12, side * 2.2, 1.4, 0.32, materials.gold, 'King’s House portal attendant statue');
    }
    // Arms of the City of Brussels with a crown above the central gallery, as on the
    // real Broodhuis facade.
    const shield = new THREE.Shape();
    shield.moveTo(-0.55, 0.5); shield.lineTo(0.55, 0.5); shield.lineTo(0.55, 0);
    shield.quadraticCurveTo(0.55, -0.45, 0, -0.62); shield.quadraticCurveTo(-0.55, -0.45, -0.55, 0);
    shield.closePath();
    mesh(root, new THREE.ShapeGeometry(shield), materials.gold, 0, 15.1, 0.3, 'King’s House Brussels coat of arms shield');
    box(root, 0.5, 0.16, 0.1, 0, 15.68, 0.3, materials.gold, 'King’s House coat of arms crown');
    // Round oeil-de-boeuf windows in each roof dormer of the real slate roof.
    const khDormOculi = new THREE.InstancedMesh(new THREE.CircleGeometry(0.3, 12), glass, 7);
    const khDormRims = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 12), trim, 7);
    const khDd = new THREE.Object3D();
    for (let i = 0; i < 7; i++) {
      const x = -width / 2 + 3 + i * 4.3;
      const z = -depth / 2 + (i % 2 ? -2.6 : 2.6);
      const facing = z > -depth / 2 ? 1 : -1;
      khDd.rotation.y = facing > 0 ? 0 : Math.PI;
      khDd.position.set(x, height + 2.1, z + facing * 0.31);
      khDd.updateMatrix();
      khDormRims.setMatrixAt(i, khDd.matrix);
      khDd.position.z += facing * 0.03;
      khDd.updateMatrix();
      khDormOculi.setMatrixAt(i, khDd.matrix);
      khDd.rotation.y = 0;
    }
    khDormOculi.count = khDormRims.count = 7;
    khDormOculi.name = 'King’s House dormer oculi';
    khDormRims.name = 'King’s House dormer oculus rims';
    root.add(khDormOculi, khDormRims);
    // Cross bars traceried over each dormer oculus, as on the real dormers.
    const khDormBars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), trim, 14);
    let kdb = 0;
    for (let i = 0; i < 7; i++) {
      const x = -width / 2 + 3 + i * 4.3;
      const z = -depth / 2 + (i % 2 ? -2.6 : 2.6);
      const facing = z > -depth / 2 ? 1 : -1;
      khDd.rotation.y = facing > 0 ? 0 : Math.PI;
      khDd.position.set(x, height + 2.1, z + facing * 0.35);
      khDd.updateMatrix();
      khDormBars.setMatrixAt(kdb++, khDd.matrix);
      khDd.rotation.y += Math.PI / 2;
      khDd.updateMatrix();
      khDormBars.setMatrixAt(kdb++, khDd.matrix);
      khDd.rotation.y = facing > 0 ? 0 : Math.PI;
    }
    khDormBars.count = kdb;
    khDormBars.name = 'King’s House dormer oculus tracery bars';
    root.add(khDormBars);
    // Stone cresting finials marching along the roof ridge of the real Broodhuis.
    const khRidge = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.6, 4), trim, 11);
    const khRd = new THREE.Object3D();
    for (let i = 0; i < 11; i++) {
      khRd.position.set(-width / 2 + 1 + i * ((width - 2) / 10), ridgeY + 0.3, -depth / 2);
      khRd.updateMatrix();
      khRidge.setMatrixAt(i, khRd.matrix);
    }
    khRidge.count = 11;
    khRidge.name = 'King’s House roof ridge cresting';
    root.add(khRidge);
    // Gilded balls crown the Broodhuis ridge cresting at intervals, as on the real roof.
    const khRidgeBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), materials.gold, 5);
    for (let i = 0; i < 5; i++) {
      khRd.position.set(-width / 2 + 3 + i * 6.2, ridgeY + 0.65, -depth / 2);
      khRd.updateMatrix();
      khRidgeBalls.setMatrixAt(i, khRd.matrix);
    }
    khRidgeBalls.count = 5;
    khRidgeBalls.name = 'King’s House ridge crest balls';
    root.add(khRidgeBalls);
  }

  function grandPlace(g) {
    // The real square measures 110 x 68 metres and is paved edge-to-edge to the facades;
    // the plaza stays completely open, as on the real Grand-Place (no bollards or lamps).
    const plaza = new THREE.Group();
    plaza.name = 'Grand-Place pedestrian square';
    g.add(plaza);
    box(plaza, 110, 0.45, 72, 0, -0.225, 0, materials.pavingEdge, 'Grand-Place stone perimeter');
    const cobbleGeo = new THREE.BoxGeometry(6.8, 0.12, 4.1);
    const cobblesA = new THREE.InstancedMesh(cobbleGeo, materials.pavingA, 240);
    const cobblesB = new THREE.InstancedMesh(cobbleGeo, materials.pavingB, 240);
    const cobblesC = new THREE.InstancedMesh(cobbleGeo, materials.pavingEdge, 48);
    const dummy = new THREE.Object3D();
    let a = 0, b = 0, c = 0;
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 16; col++) {
        const x = -51.7 + col * 6.9 + (row % 2) * 0.45;
        const z = -35 + row * 4.9;
        dummy.position.set(x, -0.06, z);
        dummy.rotation.y = ((row + col) % 3) * 0.025;
        dummy.updateMatrix();
        if (row % 5 === 4) cobblesC.setMatrixAt(c++, dummy.matrix);
        else if ((row + col) % 2) cobblesA.setMatrixAt(a++, dummy.matrix);
        else cobblesB.setMatrixAt(b++, dummy.matrix);
      }
    }
    cobblesA.count = a; cobblesB.count = b; cobblesC.count = c;
    cobblesA.name = 'Grand-Place cobblestone courses A';
    cobblesB.name = 'Grand-Place cobblestone courses B';
    cobblesC.name = 'Grand-Place cobblestone courses C (banded rows)';
    cobblesA.receiveShadow = cobblesB.receiveShadow = cobblesC.receiveShadow = true;
    plaza.add(cobblesA, cobblesB, cobblesC);
    // Fine joints between the paving slabs of the real 1883/1899 calepinage — instanced seams.
    const jointsX = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.02, 70), materials.pavingEdge, 21);
    const jointsZ = new THREE.InstancedMesh(new THREE.BoxGeometry(109, 0.02, 0.07), materials.pavingEdge, 15);
    let jx = 0, jz = 0;
    dummy.rotation.y = 0;
    for (let i = 0; i <= 20; i++) {
      dummy.position.set(-55 + i * 5.5, 0.005, 0);
      dummy.updateMatrix();
      jointsX.setMatrixAt(jx++, dummy.matrix);
    }
    for (let i = 0; i <= 14; i++) {
      dummy.position.set(0, 0.005, -35 + i * 5);
      dummy.updateMatrix();
      jointsZ.setMatrixAt(jz++, dummy.matrix);
    }
    jointsX.count = jx; jointsZ.count = jz;
    jointsX.name = 'Grand-Place paving joints (long axis)';
    jointsZ.name = 'Grand-Place paving joints (cross axis)';
    plaza.add(jointsX, jointsZ);
    // Diagonal joints cross the central field of the calepinage.
    const diagJoints = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.02, 30), materials.pavingEdge, 12);
    for (let i = 0; i < 6; i++) {
      dummy.position.set(-30 + i * 12, 0.006, 0);
      dummy.rotation.y = Math.PI / 4;
      dummy.updateMatrix();
      diagJoints.setMatrixAt(i, dummy.matrix);
      dummy.position.set(-30 + i * 12, 0.006, 0);
      dummy.rotation.y = -Math.PI / 4;
      dummy.updateMatrix();
      diagJoints.setMatrixAt(6 + i, dummy.matrix);
      dummy.rotation.y = 0;
    }
    diagJoints.count = 12;
    diagJoints.name = 'Grand-Place diagonal paving joints';
    plaza.add(diagJoints);
    // Patch repairs in the calepinage — newer slabs set into the old paving, as on the
    // real square's worn surface.
    const repairs = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.1, 2.0), materials.pavingB, 12);
    const repairSpots = [[-40, 12], [-12, -22], [8, 18], [33, -8], [-25, 25], [45, 20], [-48, -14], [20, -28], [0, 0], [-5, 8], [38, 5], [-33, -5]];
    for (let i = 0; i < 12; i++) {
      dummy.position.set(repairSpots[i][0], 0.01, repairSpots[i][1]);
      dummy.rotation.y = (i % 3) * 0.06;
      dummy.updateMatrix();
      repairs.setMatrixAt(i, dummy.matrix);
    }
    repairs.count = 12;
    repairs.name = 'Grand-Place paving repair patches';
    repairs.receiveShadow = true;
    plaza.add(repairs);
    // A second set of diagonal joints crosses the field the other way, completing the
    // calepinage's diagonal lattice.
    const diagJoints2 = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.02, 30), materials.pavingEdge, 12);
    for (let i = 0; i < 6; i++) {
      dummy.position.set(-36 + i * 14, 0.007, 0);
      dummy.rotation.y = -Math.PI / 4 + Math.PI / 2;
      dummy.updateMatrix();
      diagJoints2.setMatrixAt(i, dummy.matrix);
      dummy.position.set(-36 + i * 14, 0.007, 0);
      dummy.rotation.y = Math.PI / 4 + Math.PI / 2;
      dummy.updateMatrix();
      diagJoints2.setMatrixAt(6 + i, dummy.matrix);
      dummy.rotation.y = 0;
    }
    diagJoints2.count = 12;
    diagJoints2.name = 'Grand-Place diagonal paving joints (cross set)';
    plaza.add(diagJoints2);
    // Scattered accent cobbles of a third tone break up the field, as in the real worn
    // calepinage.
    const accents = new THREE.InstancedMesh(cobbleGeo, materials.pavingEdge, 40);
    for (let i = 0; i < 40; i++) {
      dummy.position.set(-51.7 + ((i * 7) % 16) * 6.9 + ((i * 3) % 5) * 0.3, -0.055, -35 + ((i * 5) % 15) * 4.9);
      dummy.rotation.y = ((i * 11) % 7) * 0.05;
      dummy.updateMatrix();
      accents.setMatrixAt(i, dummy.matrix);
    }
    accents.count = 40;
    accents.name = 'Grand-Place accent cobbles';
    accents.receiveShadow = true;
    plaza.add(accents);
    // Smaller infill slabs of the calepinage fill the gaps between the main courses, as in
    // the real 1883/1899 paving.
    const infills = new THREE.InstancedMesh(new THREE.BoxGeometry(3.3, 0.1, 2.0), materials.pavingA, 60);
    for (let i = 0; i < 60; i++) {
      dummy.position.set(-51.7 + ((i * 11) % 16) * 6.9 + 3.45, -0.05, -35 + ((i * 7) % 15) * 4.9 + 2.45);
      dummy.rotation.y = ((i * 5) % 4) * 0.03;
      dummy.updateMatrix();
      infills.setMatrixAt(i, dummy.matrix);
    }
    infills.count = 60;
    infills.name = 'Grand-Place infill slabs';
    infills.receiveShadow = true;
    plaza.add(infills);
    // Worn desire-line strips cross the square where centuries of foot traffic polished the
    // paving — darker worn bands along the main north-south and east-west paths.
    const wearNS = new THREE.InstancedMesh(new THREE.BoxGeometry(3.0, 0.02, 68), materials.pavingEdge, 2);
    dummy.position.set(0, 0.012, 0);
    dummy.rotation.y = 0;
    dummy.updateMatrix();
    wearNS.setMatrixAt(0, dummy.matrix);
    dummy.position.set(-17, 0.012, 0);
    dummy.updateMatrix();
    wearNS.setMatrixAt(1, dummy.matrix);
    wearNS.count = 2;
    wearNS.name = 'Grand-Place worn desire-line strips (N-S)';
    const wearEW = new THREE.InstancedMesh(new THREE.BoxGeometry(108, 0.02, 3.0), materials.pavingEdge, 2);
    dummy.position.set(0, 0.012, 0);
    dummy.updateMatrix();
    wearEW.setMatrixAt(0, dummy.matrix);
    dummy.position.set(0, 0.012, -18);
    dummy.updateMatrix();
    wearEW.setMatrixAt(1, dummy.matrix);
    wearEW.count = 2;
    wearEW.name = 'Grand-Place worn desire-line strips (E-W)';
    plaza.add(wearNS, wearEW);
    // A granite sett cross marks the midpoint of each frontage line, as in the real
    // calepinage's alignment marks.
    const frontageCrosses = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.06, 0.5), materials.warmStone, 4);
    for (let i = 0; i < 4; i++) {
      const [x, z, ry] = [0, 34.2, 0][i] !== undefined ? [[0, 34.2, 0], [0, -34.2, 0], [-53.2, 0, Math.PI / 2], [53.2, 0, Math.PI / 2]][i] : [0, 0, 0];
      dummy.position.set(x, 0.02, z);
      dummy.rotation.y = ry;
      dummy.updateMatrix();
      frontageCrosses.setMatrixAt(i, dummy.matrix);
      dummy.rotation.y = 0;
    }
    frontageCrosses.count = 4;
    frontageCrosses.name = 'Grand-Place frontage sett crosses';
    plaza.add(frontageCrosses);
    // A sett ring surrounds the Town Hall portal steps on the square, as on the real
    // forecourt paving.
    const portalRing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.06, 0.6), materials.pavingEdge, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      dummy.position.set(8.5 + Math.cos(a) * 5.2, 0.015, 28.6 + Math.sin(a) * 3.4);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      portalRing.setMatrixAt(i, dummy.matrix);
    }
    portalRing.count = 8;
    portalRing.name = 'Grand-Place Town Hall portal sett ring';
    plaza.add(portalRing);
    // A sett-paved forecourt field lies before the Town Hall portal, as on the real square.
    const thForecourt = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.08, 1.4), materials.pavingB, 12);
    for (let i = 0; i < 12; i++) {
      dummy.position.set(2 + (i % 4) * 2.2, 0.0, 26 + Math.floor(i / 4) * 2.2);
      dummy.rotation.y = (i % 3) * 0.04;
      dummy.updateMatrix();
      thForecourt.setMatrixAt(i, dummy.matrix);
    }
    thForecourt.count = 12;
    thForecourt.name = 'Grand-Place Town Hall forecourt setts';
    plaza.add(thForecourt);
    // Matching sett field before the Broodhuis (north frontage) portal.
    const khForecourt = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.08, 1.4), materials.pavingB, 10);
    for (let i = 0; i < 10; i++) {
      dummy.position.set(-2.2 + (i % 5) * 2.2, 0.0, -26 - Math.floor(i / 5) * 2.2);
      dummy.updateMatrix();
      khForecourt.setMatrixAt(i, dummy.matrix);
    }
    khForecourt.count = 10;
    khForecourt.name = 'Grand-Place Broodhuis forecourt setts';
    plaza.add(khForecourt);
    // A sett star marks the Town Hall forecourt centre on the square, as in the real
    // alignment paving.
    const thStar = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), materials.warmStone, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      dummy.position.set(8.5 + Math.cos(a) * 2.6, 0.02, 25.4 + Math.sin(a) * 1.8);
      dummy.rotation.y = a;
      dummy.updateMatrix();
      thStar.setMatrixAt(i, dummy.matrix);
      dummy.rotation.y = 0;
    }
    thStar.count = 8;
    thStar.name = 'Grand-Place Town Hall forecourt sett star';
    plaza.add(thStar);
    // Matching sett star on the Broodhuis (north) forecourt.
    const khStar = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), materials.warmStone, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      dummy.position.set(Math.cos(a) * 2.6, 0.02, -25.4 + Math.sin(a) * 1.8);
      dummy.rotation.y = a;
      dummy.updateMatrix();
      khStar.setMatrixAt(i, dummy.matrix);
      dummy.rotation.y = 0;
    }
    khStar.count = 8;
    khStar.name = 'Grand-Place Broodhuis forecourt sett star';
    plaza.add(khStar);
    // Wheel-rut wear grooves score the main east-west desire line across the square, as on
    // the real worn paving.
    const ruts = new THREE.InstancedMesh(new THREE.BoxGeometry(108, 0.02, 0.16), materials.pavingEdge, 4);
    for (let i = 0; i < 4; i++) {
      dummy.position.set(0, 0.014, -0.7 + i * 0.45);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      ruts.setMatrixAt(i, dummy.matrix);
    }
    ruts.count = 4;
    ruts.name = 'Grand-Place wheel-rut wear grooves';
    plaza.add(ruts);
    // Small chips and spalls dot the worn paving, as on the real square's surface.
    const chips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.02, 0.3), materials.pavingEdge, 30);
    for (let i = 0; i < 30; i++) {
      dummy.position.set(-50 + ((i * 13) % 100), 0.008, -32 + ((i * 17) % 64));
      dummy.rotation.y = (i % 5) * 0.2;
      dummy.updateMatrix();
      chips.setMatrixAt(i, dummy.matrix);
    }
    chips.count = 30;
    chips.name = 'Grand-Place paving chips and spalls';
    plaza.add(chips);
    // Two bollards flank the Town Hall portal steps on the square, as at the real entrance.
    for (const side of [-1, 1]) {
      const pb = box(plaza, 0.28, 0.9, 0.28, 8.5 + side * 4.4, 0.45, 27.6, materials.dark, 'Town Hall portal bollard');
      mesh(plaza, new THREE.SphereGeometry(0.15, 10, 8), materials.dark, 8.5 + side * 4.4, 0.92, 27.6, 'Town Hall portal bollard cap');
    }
    // Granite kerb stones along all four facade lines where the paving meets the buildings.
    for (const [w, d, x, z, n] of [[110, 0.5, 0, 35.6, 'south'], [110, 0.5, 0, -35.6, 'north'], [0.5, 71, -54.6, 0, 'west'], [0.5, 71, 54.6, 0, 'east']]) {
      box(plaza, w, 0.18, d, x, 0.02, z, materials.pavingEdge, `Grand-Place ${n} facade kerb`);
    }
    // Drainage gully slots set into the kerb line at regular intervals, and end stones at
    // each street mouth — drainage and edge details of the real calepinage.
    const gullies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.05, 0.3), materials.dark, 28);
    let gu = 0;
    for (let i = 0; i < 14; i++) {
      dummy.position.set(-53 + i * 8.2, 0.05, 35.35);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      gullies.setMatrixAt(gu++, dummy.matrix);
      dummy.position.set(-53 + i * 8.2, 0.05, -35.35);
      dummy.updateMatrix();
      gullies.setMatrixAt(gu++, dummy.matrix);
    }
    gullies.count = gu;
    gullies.name = 'Grand-Place kerb drainage gullies';
    plaza.add(gullies);
    // Cable conduits for the facade floodlights run in a shallow channel along each kerb
    // line, as on the real square's lighting installation.
    const conduits = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.04, 70), materials.dark, 2);
    dummy.position.set(0, 0.03, 35.15);
    dummy.rotation.y = 0;
    dummy.updateMatrix();
    conduits.setMatrixAt(0, dummy.matrix);
    dummy.position.set(0, 0.03, -35.15);
    dummy.updateMatrix();
    conduits.setMatrixAt(1, dummy.matrix);
    conduits.count = 2;
    conduits.name = 'Grand-Place floodlight cable conduits';
    plaza.add(conduits);
    // Darker blue-stone sett border framing the paved square along all four facade lines, as in
    // the real 1883/1899 calepinage. Instanced around the perimeter.
    const border = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.08, 0.9), materials.pavingEdge, 420);
    let bd = 0;
    dummy.rotation.y = 0;
    for (let x = -54.6; x <= 54.61; x += 0.98) {
      for (const z of [-34.9, 34.9]) {
        dummy.position.set(x, -0.04, z);
        dummy.updateMatrix();
        border.setMatrixAt(bd++, dummy.matrix);
      }
    }
    for (let z = -33.9; z <= 33.91; z += 0.98) {
      for (const x of [-54.6, 54.6]) {
        dummy.position.set(x, -0.04, z);
        dummy.updateMatrix();
        border.setMatrixAt(bd++, dummy.matrix);
      }
    }
    border.count = bd;
    border.name = 'Grand-Place blue-stone sett border';
    border.receiveShadow = true;
    plaza.add(border);
    // Diagonal sett fans fill the four corners of the square, as in the real calepinage's
    // corner treatment.
    const cornerFans = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.07, 0.9), materials.pavingB, 32);
    let cf = 0;
    for (const [cx, cz] of [[-54, -34], [54, -34], [-54, 34], [54, 34]]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI / 2;
        dummy.position.set(cx + Math.cos(a + Math.PI) * (1.2 + (k % 4) * 0.85), -0.03, cz + Math.sin(a + Math.PI) * (1.2 + (k % 4) * 0.85));
        dummy.rotation.y = a;
        dummy.updateMatrix();
        cornerFans.setMatrixAt(cf++, dummy.matrix);
      }
    }
    cornerFans.count = cf;
    cornerFans.name = 'Grand-Place corner sett fans';
    cornerFans.receiveShadow = true;
    plaza.add(cornerFans);
    // Large granite corner stones anchor the four corners of the paved square, as in the real
    // calepinage.
    const cornerStones = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.16, 2.2), materials.warmStone, 4);
    for (const [cx, cz] of [[-53.8, -34.2], [53.8, -34.2], [-53.8, 34.2], [53.8, 34.2]]) {
      dummy.position.set(cx, 0.02, cz);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      cornerStones.setMatrixAt((cx < 0 ? 0 : 2) + (cz < 0 ? 0 : 1), dummy.matrix);
    }
    cornerStones.count = 4;
    cornerStones.name = 'Grand-Place granite corner stones';
    plaza.add(cornerStones);
    // A second, inner sett ring frames the paved field inside the perimeter border, as in
    // the real calepinage's double border.
    const innerRing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.07, 0.8), materials.pavingB, 200);
    let ir = 0;
    for (let x = -53.4; x <= 53.41 && ir < 100; x += 1.08) {
      for (const z of [-33.9, 33.9]) {
        dummy.position.set(x, -0.035, z);
        dummy.rotation.y = 0;
        dummy.updateMatrix();
        innerRing.setMatrixAt(ir++, dummy.matrix);
      }
    }
    for (let z = -32.9; z <= 32.91 && ir < 200; z += 1.08) {
      for (const x of [-53.4, 53.4]) {
        dummy.position.set(x, -0.035, z);
        dummy.updateMatrix();
        innerRing.setMatrixAt(ir++, dummy.matrix);
      }
    }
    innerRing.count = ir;
    innerRing.name = 'Grand-Place inner sett ring';
    innerRing.receiveShadow = true;
    plaza.add(innerRing);
    // Cap stones line the outer edge of the paved square beyond the perimeter, as on the
    // real square's boundary.
    const edgeCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.12, 1.1), materials.warmStone, 60);
    let ec = 0;
    for (let x = -54.5; x <= 54.51 && ec < 30; x += 3.7) {
      dummy.position.set(x, 0.05, 35.6);
      dummy.updateMatrix();
      edgeCaps.setMatrixAt(ec++, dummy.matrix);
      dummy.position.set(x, 0.05, -35.6);
      dummy.updateMatrix();
      edgeCaps.setMatrixAt(ec++, dummy.matrix);
    }
    for (let z = -33; z <= 33.01 && ec < 60; z += 2.2) {
      dummy.position.set(-55.4, 0.05, z);
      dummy.updateMatrix();
      edgeCaps.setMatrixAt(ec++, dummy.matrix);
      dummy.position.set(55.4, 0.05, z);
      dummy.updateMatrix();
      edgeCaps.setMatrixAt(ec++, dummy.matrix);
    }
    edgeCaps.count = ec;
    edgeCaps.name = 'Grand-Place outer edge cap stones';
    plaza.add(edgeCaps);

    // Flat sett walkways (passerelles en pavés platines) run from each of the seven
    // street entrances into the square, as in the real 1883/1899 calepinage.
    const mouths = [
      [-55, -30, 1, 0], [-55, 31, 1, 0],          // Rue au Beurre (NW), Rue de la Tête d'or (SW)
      [17, 36, 0, -1], [52.5, 36, 0, -1],          // Rue des Chapeliers, Rue Charles Buls (south)
      [55, 30, -1, 0], [55, -30, -1, 0],           // Rue de la Colline (E), Rue d'Arenberg (NE)
      [17, -36, 0, 1]                              // Rue Chair et Pain (north)
    ];
    const stripGeo = new THREE.BoxGeometry(1.1, 0.08, 1.1);
    const strips = new THREE.InstancedMesh(stripGeo, materials.pavingEdge, 240);
    const sd = new THREE.Object3D();
    let si = 0;
    for (const [mx, mz, dx, dz] of mouths) {
      for (let d = 1.2; d <= 12; d += 1.3) {
        for (let w = -1.4; w <= 1.41; w += 1.2) {
          sd.position.set(mx + dx * d + (dz ? w : 0), -0.07, mz + dz * d + (dx ? w : 0));
          sd.rotation.y = 0;
          sd.updateMatrix();
          strips.setMatrixAt(si++, sd.matrix);
        }
      }
    }
    strips.count = si;
    strips.name = 'Grand-Place entrance sett strips (passerelles)';
    strips.receiveShadow = true;
    plaza.add(strips);

    // Cobbled stubs of the seven surrounding lanes continue outward from each mouth — the real
    // streets around the square are cobbled too, so the paving visibly runs into them.
    const streetCobbles = new THREE.InstancedMesh(stripGeo, materials.pavingB, 7 * 15 * 3);
    let sc = 0;
    for (const [mx, mz, dx, dz] of mouths) {
      for (let d = 13; d <= 30; d += 1.3) {
        for (let w = -1.4; w <= 1.41; w += 1.2) {
          sd.position.set(mx - dx * d + (dz ? w : 0), -0.07, mz - dz * d + (dx ? w : 0));
          sd.rotation.y = 0;
          sd.updateMatrix();
          streetCobbles.setMatrixAt(sc++, sd.matrix);
        }
      }
    }
    streetCobbles.count = sc;
    streetCobbles.name = 'Grand-Place street cobble stubs';
    streetCobbles.receiveShadow = true;
    plaza.add(streetCobbles);
    // Darker granite sett patch at each of the seven street mouths, where the carriageway
    // meets the square's calepinage.
    const settPatches = new THREE.InstancedMesh(new THREE.BoxGeometry(6.4, 0.05, 4.4), materials.pavingEdge, mouths.length);
    for (let m = 0; m < mouths.length; m++) {
      const [mx, mz, dx, dz] = mouths[m];
      sd.position.set(mx + dx * 2.2, -0.02, mz + dz * 2.2);
      sd.rotation.y = dx ? Math.PI / 2 : 0;
      sd.updateMatrix();
      settPatches.setMatrixAt(m, sd.matrix);
    }
    settPatches.count = mouths.length;
    settPatches.name = 'Grand-Place street-mouth granite sett patches';
    plaza.add(settPatches);
    // Border stones frame each street-mouth sett patch.
    const patchBorders = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), materials.pavingB, mouths.length * 8);
    let pb = 0;
    for (const [mx, mz, dx, dz] of mouths) {
      for (let k = 0; k < 8; k++) {
        const t = k / 8;
        const px = mx + dx * 2.2 + (dz !== 0 ? -3.2 + t * 6.4 : 0) * (dx !== 0 ? 0 : 1) - (dx !== 0 ? 0 : 0);
        const pz = mz + dz * 2.2 + (dx !== 0 ? -3.2 + t * 6.4 : 0) * (dz !== 0 ? 0 : 1);
        sd.position.set(mx + dx * 2.2 + (dz !== 0 ? -3.2 + t * 6.4 : 0), 0.0, mz + dz * 2.2 + (dx !== 0 ? -3.2 + t * 6.4 : 0));
        sd.rotation.y = 0;
        sd.updateMatrix();
        patchBorders.setMatrixAt(pb++, sd.matrix);
      }
    }
    patchBorders.count = pb;
    patchBorders.name = 'Grand-Place sett patch border stones';
    plaza.add(patchBorders);
    // A fan of radial setts opens at each street mouth into the square, as in the real
    // 1883/1899 calepinage.
    const fans = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.07, 0.5), materials.pavingB, mouths.length * 6);
    let fn = 0;
    for (const [mx, mz, dx, dz] of mouths) {
      for (let k = 0; k < 6; k++) {
        const a = (k - 2.5) * 0.32;
        sd.position.set(mx + dx * 4.6 + (dz !== 0 ? Math.sin(a) * 2.2 : 0), 0.0, mz + dz * 4.6 + (dx !== 0 ? Math.sin(a) * 2.2 : 0));
        sd.rotation.y = dx !== 0 ? a : a + Math.PI / 2;
        sd.updateMatrix();
        fans.setMatrixAt(fn++, sd.matrix);
        sd.rotation.y = 0;
      }
    }
    fans.count = fn;
    fans.name = 'Grand-Place street-mouth sett fans';
    plaza.add(fans);
    // Granite edge stones line both sides of each cobbled street stub outside the square.
    const stubEdges = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), materials.warmStone, mouths.length * 2);
    let se = 0;
    for (const [mx, mz, dx, dz] of mouths) {
      for (const side of [-1, 1]) {
        sd.position.set(mx - dx * 20 + (dz !== 0 ? side * 2.6 : 0), 0.0, mz - dz * 20 + (dx !== 0 ? side * 2.6 : 0));
        sd.rotation.y = 0;
        sd.updateMatrix();
        stubEdges.setMatrixAt(se++, sd.matrix);
      }
    }
    stubEdges.count = se;
    stubEdges.name = 'Grand-Place street stub edge stones';
    plaza.add(stubEdges);
    // Tactile guidance strips across each street mouth for visually impaired pedestrians —
    // a standard feature of the real paved square.
    const tactiles = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.05, 0.5), materials.warmStone, mouths.length);
    for (let m = 0; m < mouths.length; m++) {
      const [mx, mz, dx, dz] = mouths[m];
      sd.position.set(mx + dx * 3.4, 0.01, mz + dz * 3.4);
      sd.rotation.y = dx ? Math.PI / 2 : 0;
      sd.updateMatrix();
      tactiles.setMatrixAt(m, sd.matrix);
    }
    tactiles.count = mouths.length;
    tactiles.name = 'Grand-Place tactile guidance strips';
    plaza.add(tactiles);
    // End stones close the kerb line at each of the seven street mouths, and bump rows make
    // the tactile guidance strips genuinely tactile.
    const kerbEnds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.22, 0.6), materials.pavingEdge, mouths.length * 2);
    const tactileBumps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 5), materials.warmStone, mouths.length * 8);
    let ke = 0, tb2 = 0;
    for (const [mx, mz, dx, dz] of mouths) {
      for (const side of [-1, 1]) {
        sd.position.set(mx + dx * 2.2 + (dz !== 0 ? side * 3.4 : 0), 0.06, mz + dz * 2.2 + (dx !== 0 ? side * 3.4 : 0));
        sd.rotation.y = 0;
        sd.updateMatrix();
        kerbEnds.setMatrixAt(ke++, sd.matrix);
      }
      for (let b = 0; b < 8; b++) {
        sd.position.set(mx + dx * 3.4 + (dz !== 0 ? -1.4 + b * 0.4 : 0), 0.045, mz + dz * 3.4 + (dx !== 0 ? -1.4 + b * 0.4 : 0));
        sd.updateMatrix();
        tactileBumps.setMatrixAt(tb2++, sd.matrix);
      }
    }
    kerbEnds.count = ke;
    tactileBumps.count = tb2;
    kerbEnds.name = 'Grand-Place kerb end stones at street mouths';
    tactileBumps.name = 'Grand-Place tactile strip bumps';
    plaza.add(kerbEnds, tactileBumps);
    // A granite threshold lintel stone spans each street mouth where the carriageway meets
    // the square.
    const thresholds = new THREE.InstancedMesh(new THREE.BoxGeometry(7.2, 0.1, 1.0), materials.warmStone, mouths.length);
    for (let m = 0; m < mouths.length; m++) {
      const [mx, mz, dx, dz] = mouths[m];
      sd.position.set(mx + dx * 1.6, 0.03, mz + dz * 1.6);
      sd.rotation.y = dx ? Math.PI / 2 : 0;
      sd.updateMatrix();
      thresholds.setMatrixAt(m, sd.matrix);
      sd.rotation.y = 0;
    }
    thresholds.count = mouths.length;
    thresholds.name = 'Grand-Place street-mouth threshold lintels';
    plaza.add(thresholds);
    // Tactile guidance strips also cross the Town Hall portal forecourt, as on the real
    // accessible square.
    const portalTactiles = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.05, 0.5), materials.warmStone, 2);
    for (let i = 0; i < 2; i++) {
      sd.position.set(8.5, 0.02, 26.5 + i * 1.4);
      sd.rotation.y = 0;
      sd.updateMatrix();
      portalTactiles.setMatrixAt(i, sd.matrix);
    }
    portalTactiles.count = 2;
    portalTactiles.name = 'Grand-Place portal tactile strips';
    plaza.add(portalTactiles);
    // Blue-stone sett ring in the paving in front of Everard 't Serclaes' memorial plaque on
    // L'Étoile (no. 1, south frontage) — the real plaque is set off by a paved surround.
    const serclaesRing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.06, 0.7), materials.pavingEdge, 8);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      sd.position.set(-30 + Math.cos(a) * 1.6, 0.005, 34.6 + Math.sin(a) * 1.1);
      sd.rotation.y = 0;
      sd.updateMatrix();
      serclaesRing.setMatrixAt(i, sd.matrix);
    }
    serclaesRing.count = 8;
    serclaesRing.name = "Grand-Place 't Serclaes plaque sett ring";
    plaza.add(serclaesRing);

    // Bollards flank each street entrance — the real square is pedestrianised at its mouths.
    const bollards = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.18, 0.9, 10), materials.dark, mouths.length * 2);
    let bi = 0;
    for (const [mx, mz, dx, dz] of mouths) {
      for (const w of [-3.2, 3.2]) {
        sd.position.set(mx + dx * 0.8 + (dz !== 0 ? w : 0), 0.45, mz + dz * 0.8 + (dx !== 0 ? w : 0));
        sd.rotation.y = 0;
        sd.updateMatrix();
        bollards.setMatrixAt(bi++, sd.matrix);
      }
    }
    bollards.count = bi;
    bollards.name = 'Grand-Place entrance bollards';
    plaza.add(bollards);
    // Rounded caps crown each entrance bollard, as on the real square's bollards.
    const bollardCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 10, 8), materials.dark, mouths.length * 2);
    for (let i = 0; i < bi; i++) {
      const [mx, mz, dx, dz] = mouths[Math.floor(i / 2)];
      const w = i % 2 ? 3.2 : -3.2;
      sd.position.set(mx + dx * 0.8 + (dz !== 0 ? w : 0), 0.92, mz + dz * 0.8 + (dx !== 0 ? w : 0));
      sd.rotation.y = 0;
      sd.updateMatrix();
      bollardCaps.setMatrixAt(i, sd.matrix);
    }
    bollardCaps.count = bi;
    bollardCaps.name = 'Grand-Place bollard caps';
    plaza.add(bollardCaps);
    // Facade-mounted floodlight projectors at the base of each frontage — the real square is
    // floodlit from projectors fixed to the facades, not from lamp posts. They use the night
    // glow glass, so they light up after dark.
    const uplights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.5, 0.18), glowGlass, 24);
    let ul = 0;
    for (let i = 0; i < 8; i++) {
      sd.position.set(-48 + i * 13.7, 0.35, 35.75);
      sd.rotation.y = Math.PI;
      sd.updateMatrix();
      uplights.setMatrixAt(ul++, sd.matrix);
      sd.position.set(-48 + i * 13.7, 0.35, -35.75);
      sd.rotation.y = 0;
      sd.updateMatrix();
      uplights.setMatrixAt(ul++, sd.matrix);
    }
    for (let i = 0; i < 4; i++) {
      sd.position.set(-54.75, 0.35, -24 + i * 16);
      sd.rotation.y = Math.PI / 2;
      sd.updateMatrix();
      uplights.setMatrixAt(ul++, sd.matrix);
      sd.position.set(54.75, 0.35, -24 + i * 16);
      sd.rotation.y = -Math.PI / 2;
      sd.updateMatrix();
      uplights.setMatrixAt(ul++, sd.matrix);
    }
    uplights.count = ul;
    uplights.name = 'Grand-Place facade floodlight projectors';
    plaza.add(uplights);
    // Mounting brackets fix each floodlight projector to the facade base, with glare shields
    // above the lenses — as on the real facade-mounted projectors.
    const upBrackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.4, 0.24), materials.dark, 24);
    const upShields = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), materials.dark, 24);
    let ub = 0;
    const placeUp = (x, y, z, ry) => {
      sd.position.set(x, y, z);
      sd.rotation.y = ry;
      sd.updateMatrix();
      upBrackets.setMatrixAt(ub, sd.matrix);
      sd.position.y += 0.32;
      sd.updateMatrix();
      upShields.setMatrixAt(ub++, sd.matrix);
      sd.rotation.y = 0;
    };
    for (let i = 0; i < 8; i++) {
      placeUp(-48 + i * 13.7, 0.1, 35.75, Math.PI);
      placeUp(-48 + i * 13.7, 0.1, -35.75, 0);
    }
    for (let i = 0; i < 4; i++) {
      placeUp(-54.75, 0.1, -24 + i * 16, Math.PI / 2);
      placeUp(54.75, 0.1, -24 + i * 16, -Math.PI / 2);
    }
    upBrackets.count = upShields.count = ul;
    upBrackets.name = 'Grand-Place floodlight mounting brackets';
    upShields.name = 'Grand-Place floodlight glare shields';
    plaza.add(upBrackets, upShields);

    // Perimeter facades frame the plaza with the real houses, by name and side.
    // North = negative Z; south = positive Z. The Town Hall holds the south-west of the
    // south side with guild houses to its east; the King's House faces it from the north.
    const south = new THREE.Group();
    south.name = 'South frontage';
    south.position.set(0, 0, 36);
    south.rotation.y = Math.PI;
    plaza.add(south);
    townHall(south);
    guildHouse(south, { name: 'Guild House – L’Étoile', x: -30, width: 13, height: 21, floors: 3, style: 'stepped', stone: materials.gobertange, emblem: 'star' });
    // Everard 't Serclaes, the alderman who died defending the city's liberties at this house in
    // 1388, is commemorated by a bronze memorial plaque on the facade.
    box(south, 0.5, 0.7, 0.08, -30, 3.2, 0.14, materials.bronze, 'Everard ’t Serclaes memorial plaque – L’Étoile');
    // A raised bronze frame borders the 't Serclaes plaque, as on the real memorial.
    box(south, 0.06, 0.82, 0.05, -30.32, 3.2, 0.18, materials.bronze, '’t Serclaes plaque bronze frame');
    box(south, 0.06, 0.82, 0.05, -29.68, 3.2, 0.18, materials.bronze, '’t Serclaes plaque bronze frame');
    box(south, 0.7, 0.06, 0.05, -30, 3.62, 0.18, materials.bronze, '’t Serclaes plaque bronze frame');
    box(south, 0.7, 0.06, 0.05, -30, 2.78, 0.18, materials.bronze, '’t Serclaes plaque bronze frame');
    guildHouse(south, { name: 'Guild House – Le Cygne', x: -44, width: 12, height: 23, floors: 4, style: 'bell', stone: materials.gobertange, emblem: true, terrace: true, swan: true });

    const north = new THREE.Group();
    north.name = 'North frontage';
    north.position.set(0, 0, -36);
    plaza.add(north);
    kingsHouse(north);
    guildHouse(north, { name: 'Guild House – Le Heaume', x: -27, width: 11, height: 20, style: 'gable', stone: materials.euville, emblem: 'helmet' });
    guildHouse(north, { name: 'Guild House – Le Paon', x: -38, width: 12, height: 22, floors: 3, style: 'neck', stone: materials.paleStone, emblem: 'peacock' });
    guildHouse(north, { name: 'Guild House – Sainte-Barbe', stone: materials.gobertange, x: -48.5, width: 10, height: 19, style: 'stepped', saintStatue: true });
    guildHouse(north, { name: 'Guild House – Le Cerf', x: 23.5, width: 11, height: 21, style: 'stepped', stone: materials.warmStone, emblem: 'stag' });
    guildHouse(north, { name: 'Guild House – L’Ange', x: 34, width: 11, height: 23, floors: 4, style: 'scroll', stone: materials.plaster, emblem: 'angel' });
    guildHouse(north, { name: 'Guild House – La Chaloupe d’Or', x: 46.5, width: 11, height: 24, style: 'bell', stone: materials.euville, emblem: 'boat', terrace: true });

    const west = new THREE.Group();
    west.name = 'West frontage';
    west.position.set(-55, 0, 0);
    west.rotation.y = Math.PI / 2;
    plaza.add(west);
    // West side, numbered from the north corner like the real nos. 1-7, with the street
    // mouths left open at both ends: Rue au Beurre (north) and Rue de la Tête d'or (south).
    guildHouse(west, { name: 'Guild House – Le Roy d’Espagne', x: 23, width: 8.5, height: 24, floors: 4, style: 'bell', stone: materials.plaster, emblem: 'vane', balustradeStatues: true, terrace: true, medallions: true, pilasters: true });
    guildHouse(west, { name: 'Guild House – La Brouette', x: 13.5, width: 8.5, height: 20, style: 'stepped', stone: materials.plaster, brouette: true, pilasters: true });
    guildHouse(west, { name: 'Guild House – Le Sac', x: 4, width: 8.5, height: 22, style: 'gable', stone: materials.warmStone, guildTools: true, garlands: true });
    guildHouse(west, { name: 'Guild House – La Louve', x: -5.5, width: 8.5, height: 23, floors: 3, style: 'scroll', stone: materials.ochre, emblem: true, terrace: true, louve: true });
    guildHouse(west, { name: 'Guild House – Le Cornet', x: -15, width: 8.5, height: 21, style: 'scroll', stone: materials.ochre, emblem: 'horse', cornet: true });
    guildHouse(west, { name: 'Guild House – Le Renard', x: -24.5, width: 8.5, height: 20, style: 'gable', stone: materials.warmStone, continents: true, caryatids: true });

    const east = new THREE.Group();
    east.name = 'East frontage';
    east.position.set(55, 0, 0);
    east.rotation.y = -Math.PI / 2;
    plaza.add(east);
    guildHouse(east, { name: 'Guild House – L’Arbre d’Or', x: -18, width: 15, height: 22, style: 'stepped', stone: materials.ochre, terrace: true, equestrian: true, dukeBusts: true, emblem: 'barley' });
    guildHouse(east, { name: 'Guild House – La Rose', x: 1, width: 16, height: 24, style: 'bell', stone: materials.paleStone, emblem: 'rose', dukeBusts: true, abundance: true });
    guildHouse(east, { name: 'Guild House – Le Mont Thabor', x: 20, width: 15, height: 20, style: 'gable', terrace: true, dukeBusts: true, emblem: 'flags', blueStone: true, stoneVase: true });

    // The real square is entered by seven narrow streets (Rue au Beurre, Rue de la Tête
    // d'or, Rue des Chapeliers, Rue Charles Buls, Rue de la Colline, Rue d'Arenberg and
    // Rue Chair et Pain), and since 2018 each entrance carries a bronze UNESCO World
    // Heritage plaque on the facade line. The frontages above leave those mouths open.
    const plaques = [
      [west, 30, 'Rue au Beurre'],
      [west, -31, 'Rue de la Tête d’or'],
      [south, -17, 'Rue des Chapeliers'],
      [south, -52.5, 'Rue Charles Buls'],
      [east, 30, 'Rue de la Colline'],
      [east, -30, 'Rue d’Arenberg'],
      [north, 17, 'Rue Chair et Pain']
    ];
    for (const [front, x, street] of plaques) {
      box(front, 0.55, 0.75, 0.08, x, 1.2, 0.12, materials.bronze, `UNESCO entrance plaque – ${street}`);
      // A small bronze hood shelters each 2018 UNESCO plaque from the rain, fixed with four
      // visible bolts at its corners.
      box(front, 0.7, 0.12, 0.18, x, 1.68, 0.12, materials.bronze, `UNESCO plaque hood – ${street}`);
      for (const [bx, bz] of [[-0.3, 0.2], [0.3, 0.2], [-0.3, 0.04], [0.3, 0.04]]) {
        box(front, 0.05, 0.05, 0.05, x + bx, 1.68, bz + 0.12, materials.dark, `UNESCO plaque hood bolt – ${street}`);
      }
      // Raised bronze border around each UNESCO plaque face.
      for (const [fx, fw, fh] of [[-0.42, 0.05, 0.6], [0.42, 0.05, 0.6]]) {
        box(front, fw, fh, 0.03, x + fx, 1.62, 0.1, materials.bronze, `UNESCO plaque frame – ${street}`);
      }
      box(front, 0.89, 0.05, 0.03, x, 1.92, 0.1, materials.bronze, `UNESCO plaque frame – ${street}`);
      box(front, 0.89, 0.05, 0.03, x, 1.32, 0.1, materials.bronze, `UNESCO plaque frame – ${street}`);
    }
    // Manhole covers and cellar areaway grates set into the paving along the facade lines.
    const manholes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 14).rotateX(Math.PI / 2), materials.dark, 24);
    const grates = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.05, 0.5), materials.dark, 28);
    const md = new THREE.Object3D();
    let mh = 0, gr = 0;
    for (let i = 0; i < 24; i++) {
      const x = -50 + (i % 8) * 14.3, z = (Math.floor(i / 8) % 2 ? 33.4 : -33.4);
      md.position.set(x, -0.05, z);
      md.updateMatrix();
      manholes.setMatrixAt(mh++, md.matrix);
    }
    for (const z of [33.2, -33.2]) {
      for (let i = 0; i < 14; i++) {
        md.position.set(-49 + i * 7.2, -0.05, z + (z > 0 ? -1.6 : 1.6));
        md.updateMatrix();
        grates.setMatrixAt(gr++, md.matrix);
      }
    }
    manholes.count = mh;
    grates.count = gr;
    manholes.name = 'Grand-Place manhole covers';
    grates.name = 'Grand-Place cellar areaway grates';
    plaza.add(manholes, grates);
    // Bolted flange rings around each manhole cover and hinge knuckles on each areaway
    // grate — the real ironwork is bolted and hinged.
    const mhRings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 14).rotateX(Math.PI / 2), materials.warmStone, 24);
    const grateHinges = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.06, 0.1), materials.warmStone, 28);
    for (let i = 0; i < 24; i++) {
      const x = -50 + (i % 8) * 14.3, z = (Math.floor(i / 8) % 2 ? 33.4 : -33.4);
      md.position.set(x, -0.03, z);
      md.updateMatrix();
      mhRings.setMatrixAt(i, md.matrix);
    }
    for (const z of [33.2, -33.2]) {
      for (let i = 0; i < 14; i++) {
        md.position.set(-49 + i * 7.2, -0.02, z + (z > 0 ? -1.6 : 1.6));
        md.updateMatrix();
        grateHinges.setMatrixAt((z > 0 ? 0 : 14) + i, md.matrix);
      }
    }
    mhRings.count = mh;
    grateHinges.count = gr;
    mhRings.name = 'Grand-Place manhole flange rings';
    grateHinges.name = 'Grand-Place areaway grate hinges';
    plaza.add(mhRings, grateHinges);
    // Raised bars run across each areaway grate, as on the real cellar grilles.
    const grateBars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.02, 0.06), materials.warmStone, gr * 3);
    let gb2 = 0;
    for (const z of [33.2, -33.2]) {
      for (let i = 0; i < 14; i++) {
        for (let b = 0; b < 3; b++) {
          md.position.set(-49 + i * 7.2, -0.045, z + (z > 0 ? -1.6 : 1.6) + (b - 1) * 0.14);
          md.updateMatrix();
          grateBars.setMatrixAt(gb2++, md.matrix);
        }
      }
    }
    grateBars.count = gb2;
    grateBars.name = 'Grand-Place areaway grate bars';
    plaza.add(grateBars);
    // Lifting key holes pierce each manhole cover, as on the real covers.
    const keyHoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 8).rotateX(Math.PI / 2), materials.pavingEdge, 24);
    for (let i = 0; i < 24; i++) {
      const x = -50 + (i % 8) * 14.3, z = (Math.floor(i / 8) % 2 ? 33.4 : -33.4);
      md.position.set(x + 0.2, -0.02, z);
      md.updateMatrix();
      keyHoles.setMatrixAt(i, md.matrix);
    }
    keyHoles.count = 24;
    keyHoles.name = 'Grand-Place manhole lifting key holes';
    plaza.add(keyHoles);

    // Traditional Brussels enamel street signs — blue board with a white rim on a dark post —
    // stand at each of the seven street mouths, naming the street that opens onto the square.
    const signRims = new THREE.InstancedMesh(new THREE.BoxGeometry(1.56, 0.48, 0.04), materials.plaster, plaques.length);
    const signBoards = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.42, 0.06), signGlow, plaques.length);
    const signPosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 8), materials.dark, plaques.length);
    const sgd = new THREE.Object3D();
    const sv = new THREE.Vector3();
    let sg = 0;
    for (const [front, x] of plaques) {
      front.updateWorldMatrix(true, false);
      sv.set(x, 2.52, 1.66).applyMatrix4(front.matrixWorld);
      sgd.position.copy(sv);
      sgd.rotation.set(0, front.rotation.y, 0);
      sgd.updateMatrix();
      signRims.setMatrixAt(sg, sgd.matrix);
      sv.set(x, 2.52, 1.7).applyMatrix4(front.matrixWorld);
      sgd.position.copy(sv);
      sgd.updateMatrix();
      signBoards.setMatrixAt(sg, sgd.matrix);
      sv.set(x, 1.3, 1.68).applyMatrix4(front.matrixWorld);
      sgd.position.copy(sv);
      sgd.updateMatrix();
      signPosts.setMatrixAt(sg, sgd.matrix);
      sg++;
    }
    signRims.count = signBoards.count = signPosts.count = sg;
    signRims.name = 'Street sign white rims';
    signBoards.name = 'Brussels enamel street signs';
    signPosts.name = 'Street sign posts';
    plaza.add(signRims, signBoards, signPosts);
    // Base collars and finial balls dress each enamel sign post; a small sett ring paves
    // around its foot — as on the real Brussels street signs.
    const signCollars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 0.12, 8), materials.dark, plaques.length);
    const signFinials = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), materials.gold, plaques.length);
    const signRings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), materials.pavingEdge, plaques.length * 4);
    let sc2 = 0;
    for (let i = 0; i < plaques.length; i++) {
      const [front, x] = plaques[i];
      front.updateWorldMatrix(true, false);
      sv.set(x, 0.12, 1.68).applyMatrix4(front.matrixWorld);
      sgd.position.copy(sv);
      sgd.updateMatrix();
      signCollars.setMatrixAt(i, sgd.matrix);
      sv.set(x, 2.62, 1.68).applyMatrix4(front.matrixWorld);
      sgd.position.copy(sv);
      sgd.updateMatrix();
      signFinials.setMatrixAt(i, sgd.matrix);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        sv.set(x + Math.cos(a) * 0.55, -0.03, 1.68 + Math.sin(a) * 0.55).applyMatrix4(front.matrixWorld);
        sgd.position.copy(sv);
        sgd.updateMatrix();
        signRings.setMatrixAt(sc2++, sgd.matrix);
      }
    }
    signCollars.count = signFinials.count = plaques.length;
    signRings.count = sc2;
    signCollars.name = 'Street sign post base collars';
    signFinials.name = 'Street sign post finial balls';
    signRings.name = 'Street sign sett rings';
    plaza.add(signCollars, signFinials, signRings);
    // Four dark bolts fix each enamel sign board to its white rim, as on the real signs.
    const signBolts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), materials.dark, plaques.length * 4);
    let sb2 = 0;
    for (let i = 0; i < plaques.length; i++) {
      const [front, x] = plaques[i];
      front.updateWorldMatrix(true, false);
      for (const [bx, by] of [[-0.68, 0.16], [0.68, 0.16], [-0.68, -0.16], [0.68, -0.16]]) {
        sv.set(x + bx, 2.52 + by, 1.72).applyMatrix4(front.matrixWorld);
        sgd.position.copy(sv);
        sgd.updateMatrix();
        signBolts.setMatrixAt(sb2++, sgd.matrix);
      }
    }
    signBolts.count = sb2;
    signBolts.name = 'Street sign board bolts';
    plaza.add(signBolts);
    // Iron wall brackets fix each street sign to the facade line, as on the real signs.
    const signBrackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), materials.dark, plaques.length);
    for (let i = 0; i < plaques.length; i++) {
      const [front, x] = plaques[i];
      front.updateWorldMatrix(true, false);
      sv.set(x, 2.52, 1.35).applyMatrix4(front.matrixWorld);
      sgd.position.copy(sv);
      sgd.rotation.set(0, front.rotation.y, 0);
      sgd.updateMatrix();
      signBrackets.setMatrixAt(i, sgd.matrix);
      sgd.rotation.set(0, 0, 0);
    }
    signBrackets.count = plaques.length;
    signBrackets.name = 'Street sign wall brackets';
    plaza.add(signBrackets);
  }

  addLandmark('grandPlace', grandPlace);
  addLandmark('mannekenPis', (g) => {
    // Manneken Pis at the corner of Rue de l'Étuve / Rue du Chêne, a stone's throw from the
    // Grand-Place: Duquesnoy's 1619 bronze boy set in his 1770 blue-stone rocaille niche,
    // pouring into a stone basin, fenced by the 1851 wrought-iron railings.
    box(g, 3.2, 4.4, 0.7, 0, 2.2, -0.3, materials.blueStone, 'Manneken Pis rocaille niche back');
    // A darker recessed back panel deepens the niche behind the figure, as on the real
    // rocaille surround.
    box(g, 2.2, 3.4, 0.1, 0, 2.2, -0.58, materials.dark, 'Manneken Pis niche recess panel');
    // Blue-stone inner side panels line the niche jambs, as on the real rocaille surround.
    box(g, 0.18, 3.6, 2.0, -1.5, 2.2, -0.4, materials.blueStone, 'Manneken Pis niche jamb panel');
    box(g, 0.18, 3.6, 2.0, 1.5, 2.2, -0.4, materials.blueStone, 'Manneken Pis niche jamb panel');
    mesh(g, new THREE.CircleGeometry(1.15, 16, 0, Math.PI), materials.blueStone, 0, 2.2, -0.24, 'Manneken Pis rocaille niche arch');
    box(g, 2.5, 0.5, 0.8, 0, 4.65, -0.28, materials.blueStone, 'Manneken Pis niche cornice');
    box(g, 2.2, 1.3, 2.2, 0, 0.65, 0, materials.dark, 'Manneken Pis pedestal plinth');
    cylinder(g, 0.34, 0.45, 1.6, 0, 2.1, 0, materials.blueStone, 8).name = 'Manneken Pis column';
    box(g, 0.3, 0.62, 0.22, 0, 3.15, 0, materials.bronze, 'Manneken Pis bronze figure');
    mesh(g, new THREE.SphereGeometry(0.16, 10, 8), materials.bronze, 0, 3.56, 0, 'Manneken Pis bronze head');
    cylinder(g, 0.02, 0.02, 0.5, 0.14, 3.0, 0.12, glowWater, 6).name = 'Manneken Pis water jet';
    cylinder(g, 1.1, 1.25, 0.5, 0, 0.25, 0, materials.blueStone, 12).name = 'Manneken Pis stone basin';
    mesh(g, new THREE.CircleGeometry(1.05, 12), glowWater, 0, 0.42, 0, 'Manneken Pis basin water');
    // Rocaille scroll curls at the niche corners and an overflow grate in the basin rim —
    // details of the real 1770 surround.
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      mesh(g, new THREE.SphereGeometry(0.16, 8, 6), materials.blueStone, Math.cos(a) * 1.35, 4.35 + (i % 2) * 0.25, -0.22, 'Manneken Pis rocaille scroll');
    }
    // A scallop shell crowns the rocaille niche, as on the real 1770 surround.
    mesh(g, new THREE.SphereGeometry(0.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.blueStone, 0, 4.4, -0.22, 'Manneken Pis niche shell crown');
    box(g, 0.5, 0.04, 0.08, 0.8, 0.44, 0, materials.dark, 'Manneken Pis basin overflow grate');
    // A small brass tap is set into the basin rim, feeding the jet, as on the real fountain.
    cylinder(g, 0.04, 0.04, 0.18, 0.9, 0.5, 0.1, materials.bronze, 8).name = 'Manneken Pis brass tap';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      box(g, 0.06, 0.8, 0.06, Math.cos(a) * 1.55, 0.4, Math.sin(a) * 1.55, materials.dark, 'Manneken Pis railing post');
    }
    const hoop = mesh(g, new THREE.TorusGeometry(1.55, 0.04, 6, 20), materials.dark, 0, 0.82, 0, 'Manneken Pis railing top hoop');
    hoop.rotation.x = Math.PI / 2;
    // A sett ring paves the ground around the railing, as at the real fountain corner.
    const mpRing = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.05, 0.55), materials.pavingEdge, 8);
    const mpd = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      mpd.position.set(Math.cos(a) * 2.1, -0.02, Math.sin(a) * 2.1);
      mpd.updateMatrix();
      mpRing.setMatrixAt(i, mpd.matrix);
    }
    mpRing.count = 8;
    mpRing.name = 'Manneken Pis sett ring';
    g.add(mpRing);
    // A mid-height hoop ties the railing posts together, as on the real 1851 railings.
    const hoop2 = mesh(g, new THREE.TorusGeometry(1.55, 0.03, 6, 20), materials.dark, 0, 0.45, 0, 'Manneken Pis railing mid hoop');
    hoop2.rotation.x = Math.PI / 2;
    // Base plates anchor each railing post, as on the real railings.
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      box(g, 0.14, 0.05, 0.14, Math.cos(a) * 1.55, 0.03, Math.sin(a) * 1.55, materials.dark, 'Manneken Pis railing post base plate');
    }
    box(g, 0.5, 0.3, 0.05, 0, 1.6, -0.62, materials.bronze, 'Manneken Pis commemorative plaque');
    // A bronze border frames the commemorative plaque.
    box(g, 0.58, 0.06, 0.03, 0, 1.77, -0.645, materials.bronze, 'Manneken Pis plaque frame');
    box(g, 0.58, 0.06, 0.03, 0, 1.43, -0.645, materials.bronze, 'Manneken Pis plaque frame');
    box(g, 0.06, 0.38, 0.03, -0.26, 1.6, -0.645, materials.bronze, 'Manneken Pis plaque frame');
    box(g, 0.06, 0.38, 0.03, 0.26, 1.6, -0.645, materials.bronze, 'Manneken Pis plaque frame');
  });
  addLandmark('montDesArts', (g) => {
    // Mont des Arts: René Péchère's 1957–58 suspended garden, restored in 2001.
    // Local +Z is the upper-city/Place Royale edge; the garden descends toward the
    // north-west/lower city. The planted terraces sit above the underground car park.
    const limestone = new THREE.MeshStandardMaterial({ color: 0xbdb8a9, roughness: 0.92 });
    const blueStone = new THREE.MeshStandardMaterial({ color: 0x777b79, roughness: 0.88 });
    const lawn = new THREE.MeshStandardMaterial({ color: 0x64815c, roughness: 0.96 });
    const hedge = new THREE.MeshStandardMaterial({ color: 0x3f6444, roughness: 0.94 });
    const flower = new THREE.MeshStandardMaterial({ color: 0x9d786e, roughness: 0.95 });
    const water = new THREE.MeshStandardMaterial({ color: 0x6c969b, metalness: 0.18, roughness: 0.24 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x526a70, metalness: 0.12, roughness: 0.3 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x78694d, metalness: 0.45, roughness: 0.62 });
    const recess = new THREE.MeshStandardMaterial({ color: 0x343b3b, roughness: 0.9 });

    // Suspended-garden podium and the covered parking/gallery base.
    box(g, 112, 3.0, 132, 0, -1.5, 0, blueStone, 'Mont des Arts underground structure');
    box(g, 108, 1.0, 128, 0, 0.5, 0, limestone, 'Garden waterproofing deck');
    terrainFoundationSkirt(g, g, brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.montDesArts.lat, BRUSSELS_LANDMARK_ANCHORS.montDesArts.lon), 112, 132, -3.0, blueStone, 'Mont des Arts terrain retaining skirt');
    // The principal garden axis is diagonal in the city frame. Eight broad terraces
    // descend by measured increments; each has a retaining wall and a clear upper landing.
    const levels = 8, terraceWidth = 78, terraceDepth = 12.5, rise = 1.65;
    for (let i = 0; i < levels; i++) {
      const y = 1.1 + (levels - 1 - i) * rise;
      const z = 43 - i * 12.2;
      const width = terraceWidth - Math.max(0, i - 5) * 2.5;
      box(g, width, 0.48, terraceDepth, 0, y, z, limestone, 'Mont des Arts terrace paving');
      box(g, width - 5, 0.18, terraceDepth - 3.0, 0, y + 0.32, z, lawn, 'Formal garden lawn panel');
      // Retaining wall on the downhill edge, capped with a stone coping.
      const wallZ = z - terraceDepth / 2;
      for (const { x, halfWidth } of splitMontDesArtsWall(width + 2)) {
        box(g, halfWidth * 2, 1.45, 1.0, x, y - 0.5, wallZ, blueStone, 'Terrace retaining wall wing');
      }
      for (const { x, halfWidth } of splitMontDesArtsWall(width + 2.5)) {
        box(g, halfWidth * 2, 0.28, 1.4, x, y + 0.34, wallZ, limestone, 'Retaining wall coping wing');
      }
      // Clipped hedges and symmetrical low planting beds.
      for (const side of [-1, 1]) {
        box(g, 2.2, 1.0, terraceDepth - 3.5, side * (width / 2 - 4), y + 0.85, z, hedge, 'Clipped terrace hedge');
        box(g, 11, 0.35, 2.0, side * 18, y + 0.48, z + 2.2, flower, 'Seasonal flower bed');
      }
      // Wide central stair flight links each landing; leave a broad clear walking axis.
      for (let step = 0; step < 4; step++) {
        const sy = y - step * (rise / 4);
        const sz = z - terraceDepth / 2 - step * 0.72;
        box(g, 10.5, 0.24, 1.5, 0, sy, sz, limestone, 'Central garden stair');
      }
      // Secondary stair flights at both flanks.
      for (const side of [-1, 1]) for (let step = 0; step < 4; step++) {
        box(g, 4.5, 0.22, 1.35, side * (width / 2 - 11), y - step * (rise / 4), z - terraceDepth / 2 - step * 0.7, limestone, 'Flank garden stair');
      }
    }
    // Large upper landing and the restored great fountain, aligned on the central axis.
    box(g, 86, 0.55, 17, 0, 15.0, 53, limestone, 'Upper Mont des Arts esplanade');
    const fountainY = 11.69; // basin underside meets the second terrace paving at y=11.24
    cylinder(g, 9.2, 9.8, 0.9, 0, fountainY, 27, blueStone, 48);
    cylinder(g, 7.8, 7.8, 0.16, 0, fountainY + 0.48, 27, water, 48);
    cylinder(g, 1.2, 1.6, 1.4, 0, fountainY + 1.28, 27, limestone, 24);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI * 2 / 12;
      cylinder(g, 0.10, 0.10, 2.8, Math.cos(a) * 3.0, fountainY + 2.58, 27 + Math.sin(a) * 3.0, water, 8);
    }
    // Twenty small basins form the garden's characteristic dotted water rhythm.
    for (let i = 0; i < 20; i++) {
      const row = Math.floor(i / 5), col = i % 5;
      const x = (col - 2) * 13.5;
      const z = 35 - row * 20;
      const basinY = 1.1 + (7 - row * 2) * rise;
      cylinder(g, 2.15, 2.35, 0.55, x, basinY + 0.30, z, blueStone, 24);
      cylinder(g, 1.65, 1.65, 0.12, x, basinY + 0.64, z, water, 24);
    }
    // Formal tree rows at the garden margins, kept low enough to preserve the vista.
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      const x = side * (43 - (i % 2) * 2);
      const z = 39 - i * 14;
      const treeY = 1.1 + (7 - i) * rise;
      cylinder(g, 0.35, 0.48, 4.4, x, treeY + 2.2, z, materials.warmStone, 10);
      const crown = mesh(g, new THREE.SphereGeometry(2.8, 12, 10), hedge, x, treeY + 5.2, z, 'Pruned garden tree');
      crown.scale.set(1, 0.82, 1);
    }
    // Lower landing and covered passage: carillon sits on the rear of the Palais de la Dynastie arch.
    box(g, 94, 0.65, 18, 0, 0.9, -54, limestone, 'Lower Mont des Arts landing');
    box(g, 38, 12, 8, 0, 7, -67, limestone, 'Palais de la Dynastie carillon arch');
    box(g, 42, 1.1, 10, 0, 13.0, -67, blueStone, 'Carillon arch cornice');
    box(g, 34, 7, 0.4, 0, 7.8, -62.7, glass, 'Carillon clock face');
    cylinder(g, 0.55, 0.55, 0.8, 0, 15.0, -67, bronze, 16);
    // Twelve figurine niches on the rear façade evoke the historic animated carillon.
    for (let i = 0; i < 12; i++) {
      const x = -15.5 + i * 2.8;
      box(g, 1.6, 2.6, 0.45, x, 8.0, -62.6, recess, 'Carillon figure niche');
      cylinder(g, 0.28, 0.32, 1.25, x, 8.0, -62.0, bronze, 8);
    }
    // KBR / Royal Library massing and the cultural buildings frame the east side.
    box(g, 36, 26, 23, 66, 13, 10, limestone, 'KBR Albertina main block');
    box(g, 38, 1.5, 25, 66, 26.5, 10, blueStone, 'KBR cornice');
    for (let i = 0; i < 9; i++) {
      const z = 0 + i * 2.5;
      box(g, 0.3, 19, 1.6, 47.7, 13, z, blueStone, 'KBR vertical façade bay');
    }
    box(g, 31, 21, 22, -65, 10.5, 8, limestone, 'BOZAR cultural wing');
    box(g, 33, 1.4, 24, -65, 21.5, 8, blueStone, 'BOZAR roofline');
    // Square congress centre / glass cube closes the north-west urban edge.
    box(g, 29, 16, 25, -70, 8, -49, glass, 'SQUARE Brussels glass congress volume');
    box(g, 33, 1.0, 28, -70, 16.5, -49, limestone, 'SQUARE congress roof cap');
    // Albert I monument at the lower approach, kept outside the central vista corridor.
    box(g, 2.4, 7.0, 2.4, 52, 4.2, -55, bronze, 'King Albert I monument plinth');
    cylinder(g, 0.65, 0.8, 2.0, 52, 8.5, -55, bronze, 12);
    mesh(g, new THREE.SphereGeometry(0.75, 12, 10), bronze, 52, 10.0, -55, 'King Albert I statue head');
    // Benches and low balustrades provide human scale without blocking pedestrian paths.
    for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
      const x = side * 34;
      const z = 34 - i * 13;
      const benchY = 1.1 + (7 - i) * rise;
      box(g, 4.2, 0.55, 1.1, x, benchY + 0.28, z, materials.warmStone, 'Mont des Arts garden bench');
      box(g, 4.2, 0.8, 0.18, x, benchY + 0.93, z - 0.42, materials.warmStone, 'Bench backrest');
    }
    // The upper-to-lower central view corridor is deliberately free of tall planting and buildings.
  });
  addLandmark('royalPalace', (g) => {
    // North façade after Henri Maquet's 1904–09 Beaux-Arts reconstruction.
    // Keep the measured hierarchy legible at city scale: long wings, rusticated
    // arcade level, piano nobile, upper register, central six-column portico and dome.
    // The real frontage runs about 160 m along the Place des Palais — Leopold II's two
    // symmetrical curved galleries nearly doubled the palace and left a façade roughly
    // half as long again as a 108 m palace front — so the model spans the
    // full ~160 m: wings at ±44 with 52 m frontage each and terminal pavilions at ±76.
    // The real north façade is built of white Euville limestone — "pierre blanche
    // d'Euville" per the heritage inventory — over a dark Belgian slate roof.
    const stone = new THREE.MeshStandardMaterial({ color: 0xece4d3, roughness: 0.88 });
    const ashlar = new THREE.MeshStandardMaterial({ color: 0xd6cbb8, roughness: 0.9 });
    const moulding = new THREE.MeshStandardMaterial({ color: 0xf2ead9, roughness: 0.84 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x4b555e, roughness: 0.92 });
    const roofEdge = new THREE.MeshStandardMaterial({ color: 0x2c3338, roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x273b43, roughness: 0.34, metalness: 0.12 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x74664d, metalness: 0.48, roughness: 0.58 });
    const shadow = new THREE.MeshStandardMaterial({ color: 0x303638, roughness: 0.84 });
    // The real palace is floodlit after dark (night photos show the whole north
    // façade washed warm with glowing windows): register the palace materials with
    // the shared night floodlight/window-glow systems.
    facadeWashMats.push(stone, ashlar, moulding);
    nightGlowMats.push(glass);
    const facadeZ = 8.15;
    const wingW = 52, wingH = 20.5, wingD = 19;
    const wingXs = [-44, 44];

    // The two long wings each carry nine bays over three registers, spread across the
    // real ~52 m wing frontage.
    for (const x of wingXs) {
      box(g, wingW, wingH, wingD, x, wingH / 2, -1.5, stone, 'Royal Palace thirteen-bay wing');
      box(g, wingW + 0.8, 1.2, wingD + 0.8, x, 0.6, -1.5, ashlar, 'Wing rusticated plinth');
      box(g, wingW + 1.0, 0.38, wingD + 0.9, x, 7.45, facadeZ, moulding, 'Wing first string course');
      box(g, wingW + 1.0, 0.34, wingD + 0.9, x, 13.65, facadeZ, moulding, 'Wing second string course');

      for (let i = 0; i < 9; i++) {
        const bx = x - 22 + i * 5.5;
        // Ground-floor arcades: broad rusticated piers and round-headed openings.
        const wingArch = new THREE.Shape();
        wingArch.moveTo(-1.16, 0); wingArch.lineTo(1.16, 0); wingArch.lineTo(1.16, 3.75);
        wingArch.absarc(0, 3.75, 1.16, 0, Math.PI, false); wingArch.lineTo(-1.16, 0); wingArch.closePath();
        mesh(g, new THREE.ShapeGeometry(wingArch), shadow, bx, 1.1, facadeZ + 0.18, 'Wing ground-floor arched opening');
        mesh(g, new THREE.TorusGeometry(1.18, 0.14, 8, 20, Math.PI), moulding, bx, 5.36, facadeZ + 0.12, 'Wing arcade arch ring');
        box(g, 2.55, 0.25, 0.4, bx, 5.4, facadeZ + 0.14, ashlar, 'Wing arcade impost');
        // Voussoir-like joints on the arch rings give the openings a stone-cut edge.
        for (let k = 0; k < 7; k++) {
          const a = Math.PI * (0.08 + k * 0.14);
          box(g, 0.12, 0.34, 0.12, bx + Math.cos(a) * 1.18, 5.35 + Math.sin(a) * 1.18, facadeZ + 0.27, ashlar, 'Wing arcade voussoir joint');
        }
        // Keystone at the crown of every arch (heritage: "arcades cintrées, sommées d'une clé").
        box(g, 0.3, 0.5, 0.2, bx, 6.62, facadeZ + 0.27, ashlar, 'Wing arcade keystone');

        // Piano nobile: tall French windows with proper stone surrounds.
        for (const [floorY, winH] of [[9.9, 3.55], [16.0, 3.0]]) {
          box(g, 1.95, winH, 0.2, bx, floorY, facadeZ + 0.1, glass, 'Wing French window');
          box(g, 2.25, 0.2, 0.38, bx, floorY - winH / 2 - 0.12, facadeZ + 0.2, moulding, 'Wing window sill');
          box(g, 2.25, 0.2, 0.38, bx, floorY + winH / 2 + 0.12, facadeZ + 0.2, moulding, 'Wing window lintel');
          box(g, 0.14, winH + 0.34, 0.3, bx - 1.1, floorY, facadeZ + 0.2, ashlar, 'Wing window jamb');
          box(g, 0.14, winH + 0.34, 0.3, bx + 1.1, floorY, facadeZ + 0.2, ashlar, 'Wing window jamb');
          // Piano nobile windows carry a small pediment (heritage 30402: "deux fenêtres superposées, l'inférieure à fronton").
          if (floorY === 9.9) {
            const wPed = new THREE.Shape();
            wPed.moveTo(-1.3, 0); wPed.lineTo(1.3, 0); wPed.lineTo(0, 0.62); wPed.closePath();
            mesh(g, new THREE.ShapeGeometry(wPed), ashlar, bx, floorY + winH / 2 + 0.3, facadeZ + 0.26, 'Piano nobile window pediment');
          }
          // Second-floor windows are crowned with keystone and garland (heritage: "rectangulaire, à clé et guirlande").
          if (floorY === 16.0) {
            box(g, 0.24, 0.42, 0.2, bx, floorY + winH / 2 + 0.34, facadeZ + 0.24, ashlar, 'Second-floor window keystone');
            const gsw = mesh(g, new THREE.TorusGeometry(0.5, 0.06, 6, 14, Math.PI), ashlar, bx, floorY - winH / 2 - 0.5, facadeZ + 0.24, 'Second-floor garland swag');
            gsw.rotation.z = Math.PI;
          }
        }

        // EVERY piano nobile opening has its iron balconette, set within Suys'
        // continuous first-floor balcony parapet (the real palace balcony runs the
        // whole first floor and fronts each opening).
        box(g, 2.2, 0.12, 0.58, bx, 7.92, facadeZ + 0.62, bronze, 'Wing balcony rail');
        for (let k = 0; k < 9; k++) {
          box(g, 0.045, 0.5, 0.055, bx - 0.94 + k * 0.235, 8.16, facadeZ + 0.84, bronze, 'Wing balcony baluster');
        }
      }

      // A monumental order of pilasters divides EVERY bay of the wings — the real
      // upper levels carry "un ordre monumental de pilastres" (EHNE / heritage).
      for (let i = 0; i <= 9; i++) {
        const px = x - 24.75 + i * 5.5;
        box(g, 0.3, 19.2, 0.44, px, 10.2, facadeZ + 0.12, ashlar, 'Wing bay pilaster');
        box(g, 0.5, 0.6, 0.6, px, 0.6, facadeZ + 0.14, moulding, 'Wing bay pilaster base');
        box(g, 0.52, 0.5, 0.62, px, 19.6, facadeZ + 0.14, moulding, 'Wing bay pilaster capital');
      }
      box(g, wingW + 1.5, 0.75, wingD + 1.1, x, 20.75, -1.5, ashlar, 'Wing main cornice');
      box(g, wingW + 1.0, 0.7, wingD + 0.8, x, 21.55, -1.5, roof, 'Wing mansard lower slope');
      // A shallow sloped front roof face, rather than a flat rectangular roof cap.
      const mansard = new THREE.Shape();
      mansard.moveTo(-wingW / 2, 0);
      mansard.lineTo(wingW / 2, 0);
      mansard.lineTo(wingW / 2 - 2.0, 2.4);
      mansard.lineTo(-wingW / 2 + 2.0, 2.4);
      mansard.closePath();
      const mansardGeo = new THREE.ExtrudeGeometry(mansard, { depth: 17, bevelEnabled: false });
      mansardGeo.translate(0, 22.0, -10.0);
      mesh(g, mansardGeo, roof, x, 0, -1.5, 'Wing sloping slate mansard');
      // The real mansard roof carries nine oeil-de-boeuf per wing ("neuf œils-de-bœuf").
      for (let i = 0; i < 9; i++) {
        const bx = x - 24 + i * 6;
        const oval = mesh(g, new THREE.TorusGeometry(0.72, 0.11, 8, 24), moulding, bx, 22.95, facadeZ + 0.45, 'Wing oval oeil-de-boeuf surround');
        oval.scale.set(1.35, 0.78, 1);
        const pane = mesh(g, new THREE.CircleGeometry(0.66, 24), glass, bx, 22.95, facadeZ + 0.42, 'Wing oval roof window');
        pane.scale.set(1.35, 0.78, 1);
      }
      for (let i = 0; i < 27; i++) {
        const bx = x - 25 + i * 1.9;
        box(g, 0.28, 0.72, 0.28, bx, 22.0, facadeZ + 0.35, ashlar, 'Wing attic baluster');
      }
    }

    // Central corps de logis projects slightly forward from the wings.
    const centralFace = 10.0;
    box(g, 34, 24, 22, 0, 12, -1, stone, 'Palace central corps de logis');
    box(g, 35.5, 1.35, 22.8, 0, 0.95, -1, ashlar, 'Central rusticated base');
    box(g, 35.5, 0.42, 0.65, 0, 7.45, centralFace + 0.12, moulding, 'Central arcade impost course');

    // Stone cross-mullions (croisillons de pierre) divide every French window of the
    // wings into panes, as on the real palace windows. Instanced: one draw call each.
    const mullV = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 3.4, 0.06), ashlar, 40);
    const mullH = new THREE.InstancedMesh(new THREE.BoxGeometry(1.85, 0.09, 0.06), ashlar, 40);
    const mgd = new THREE.Object3D();
    let mi = 0;
    for (const x of wingXs) {
      for (let i = 0; i < 9; i++) {
        const bx = x - 22 + i * 5.5;
        for (const [floorY] of [[9.9], [16.0]]) {
          mgd.position.set(bx, floorY, facadeZ + 0.26);
          mgd.rotation.y = 0;
          mgd.updateMatrix();
          mullV.setMatrixAt(mi, mgd.matrix);
          mullH.setMatrixAt(mi, mgd.matrix);
          mi++;
        }
      }
    }
    mullV.count = mullH.count = mi;
    mullV.name = 'Palace window cross-mullions vertical';
    mullH.name = 'Palace window cross-mullions horizontal';
    mullV.castShadow = mullH.castShadow = true;
    g.add(mullV, mullH);

    // Corbelled modillions under the main cornice of the wings and the central corps —
    // the real projecting cornice is "souvent pourvue de modillons" (heritage inventory).
    const modillions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.5, 0.4), ashlar, 130);
    const mdd = new THREE.Object3D();
    let mdi = 0;
    for (const x of wingXs) {
      for (let mx = -wingW / 2 + 0.6; mx <= wingW / 2 - 0.6; mx += 1.1) {
        mdd.position.set(x + mx, 20.15, facadeZ + 0.45);
        mdd.rotation.y = 0;
        mdd.updateMatrix();
        modillions.setMatrixAt(mdi++, mdd.matrix);
      }
    }
    for (let mx = -16.6; mx <= 16.61; mx += 1.1) {
      mdd.position.set(mx, 22.1, centralFace + 0.6);
      mdd.updateMatrix();
      modillions.setMatrixAt(mdi++, mdd.matrix);
    }
    modillions.count = mdi;
    modillions.name = 'Main cornice modillions';
    modillions.castShadow = true;
    g.add(modillions);

    // The real ground storey is a rusticated soubassement a bossages: alternating
    // projecting stone blocks dress every arcade pier across the wings and the
    // central corps. One instanced mesh keeps it to a single draw call.
    const bossage = new THREE.InstancedMesh(new THREE.BoxGeometry(0.52, 0.62, 0.16), ashlar, 160);
    const bgd = new THREE.Object3D();
    let bgi = 0;
    for (const x of wingXs) {
      for (let i = 0; i < 9; i++) {
        const bx = x - 22 + i * 5.5;
        for (const px of [bx - 1.5, bx + 1.5]) {
          for (let r = 0; r < 3; r++) {
            bgd.position.set(px, 1.6 + r * 1.5, facadeZ + 0.2);
            bgd.rotation.y = 0;
            bgd.updateMatrix();
            bossage.setMatrixAt(bgi++, bgd.matrix);
          }
        }
      }
    }
    for (let i = 0; i < 5; i++) {
      const x = -10 + i * 5;
      for (const px of [x - 1.58, x + 1.58]) {
        for (let r = 0; r < 3; r++) {
          bgd.position.set(px, 1.55 + r * 1.5, centralFace + 0.2);
          bgd.updateMatrix();
          bossage.setMatrixAt(bgi++, bgd.matrix);
        }
      }
    }
    bossage.count = bgi;
    bossage.name = 'Ground-floor rusticated bossage blocks';
    bossage.castShadow = true;
    g.add(bossage);

    // Five open, full-height entrance arches in the rusticated ground storey.
    for (let i = 0; i < 5; i++) {
      const x = -10 + i * 5;
      const entranceArch = new THREE.Shape();
      entranceArch.moveTo(-1.28, 0); entranceArch.lineTo(1.28, 0); entranceArch.lineTo(1.28, 3.65);
      entranceArch.absarc(0, 3.65, 1.28, 0, Math.PI, false); entranceArch.lineTo(-1.28, 0); entranceArch.closePath();
      mesh(g, new THREE.ShapeGeometry(entranceArch), shadow, x, 0.95, centralFace + 0.22, 'Central open entrance arch');
      mesh(g, new THREE.TorusGeometry(1.28, 0.2, 10, 28, Math.PI), moulding, x, 5.95, centralFace + 0.24, 'Central entrance voussoirs');
      box(g, 3.0, 0.32, 0.55, x, 6.0, centralFace + 0.24, ashlar, 'Central arch impost');
      box(g, 0.34, 0.55, 0.26, x, 7.32, centralFace + 0.3, ashlar, 'Central arcade keystone');
      box(g, 0.28, 5.9, 0.62, x - 1.58, 3.55, centralFace + 0.2, ashlar, 'Central arcade pier');
      box(g, 0.28, 5.9, 0.62, x + 1.58, 3.55, centralFace + 0.2, ashlar, 'Central arcade pier');
    }

    // Six pairs of colossal Corinthian columns rise from the arcade roof. The
    // rear row is slightly offset in depth so it reads in three-quarter views.
    for (let i = 0; i < 6; i++) {
      const x = -12.5 + i * 5;
      for (const z of [centralFace + 1.55, centralFace + 4.1]) {
        cylinder(g, 1.12, 1.3, 13.8, x, 14.95, z, stone, 40);
        cylinder(g, 1.42, 1.42, 0.58, x, 8.35, z, ashlar, 32);
        cylinder(g, 1.38, 1.38, 0.55, x, 21.55, z, ashlar, 32);
        // Strongly articulated Corinthian capital: abacus, paired volutes and leaf bosses.
        box(g, 2.8, 0.5, 2.45, x, 21.98, z, moulding, 'Corinthian column abacus');
        for (const dx of [-0.92, 0.92]) {
          for (const dz of [-0.78, 0.78]) {
            mesh(g, new THREE.SphereGeometry(0.36, 12, 10), ashlar, x + dx, 21.82, z + dz, 'Corinthian capital volute');
          }
        }
        for (let leaf = 0; leaf < 10; leaf++) {
          const a = leaf * Math.PI / 5;
          const boss = mesh(g, new THREE.SphereGeometry(0.22, 10, 8), moulding, x + Math.cos(a) * 0.86, 21.45, z + Math.sin(a) * 0.86, 'Corinthian capital leaf');
          boss.scale.set(0.72, 1.8, 0.72);
        }
        cylinder(g, 1.52, 1.52, 0.34, x, 8.02, z, ashlar, 32);
      }
    }

    // The real portico columns have fluted shafts (heritage inventory 30402: "à fût cannelé").
    const fluteGeo = new THREE.BoxGeometry(0.12, 13.5, 0.1);
    const flutes = new THREE.InstancedMesh(fluteGeo, shadow, 12 * 16);
    const fd = new THREE.Object3D();
    let fi = 0;
    for (let i = 0; i < 6; i++) {
      const x = -12.5 + i * 5;
      for (const z of [centralFace + 1.55, centralFace + 4.1]) {
        for (let fk = 0; fk < 16; fk++) {
          const fa = fk * Math.PI / 8;
          fd.position.set(x + Math.cos(fa) * 1.19, 14.95, z + Math.sin(fa) * 1.19);
          fd.rotation.y = -fa;
          fd.updateMatrix();
          flutes.setMatrixAt(fi++, fd.matrix);
        }
      }
    }
    flutes.count = fi;
    flutes.name = 'Portico column fluting';
    flutes.castShadow = true;
    g.add(flutes);

    // The colossal portico carries a full classical entablature on the real Maquet
    // front: architrave beam over the capitals, a triglyph frieze, a dentil course
    // and a projecting cornice beneath the pediment.
    box(g, 37, 1.05, 4.8, 0, 22.78, centralFace + 2.9, ashlar, 'Portico architrave beam');
    const triglyphs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.6, 0.16), moulding, 25);
    const tgd = new THREE.Object3D();
    let ti = 0;
    for (let i = 0; i < 25; i++) {
      tgd.position.set(-17 + i * 1.42, 22.95, centralFace + 4.5);
      tgd.rotation.y = 0;
      tgd.updateMatrix();
      triglyphs.setMatrixAt(ti++, tgd.matrix);
    }
    triglyphs.count = ti;
    triglyphs.name = 'Portico frieze triglyphs';
    triglyphs.castShadow = true;
    g.add(triglyphs);
    const dentils = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.24, 0.18), moulding, 53);
    let di = 0;
    for (let i = 0; i < 53; i++) {
      tgd.position.set(-18 + i * 0.7, 23.32, centralFace + 4.55);
      tgd.updateMatrix();
      dentils.setMatrixAt(di++, tgd.matrix);
    }
    dentils.count = di;
    dentils.name = 'Portico dentil course';
    dentils.castShadow = true;
    g.add(dentils);
    box(g, 37.8, 0.34, 5.2, 0, 23.45, centralFace + 2.9, moulding, 'Portico cornice');

    // Five tall glazed doors/windows sit behind the colonnade, not as a row of
    // unrelated dark slots on the upper wall.
    for (let i = 0; i < 5; i++) {
      const x = -10 + i * 5;
      box(g, 2.65, 6.6, 0.18, x, 14.6, centralFace + 0.16, glass, 'Central piano nobile French door');
      box(g, 2.95, 0.22, 0.42, x, 11.15, centralFace + 0.28, moulding, 'Central French door sill');
      box(g, 2.95, 0.22, 0.42, x, 18.05, centralFace + 0.28, moulding, 'Central French door lintel');
      box(g, 0.16, 6.85, 0.32, x - 1.52, 14.6, centralFace + 0.28, ashlar, 'Central French door jamb');
      box(g, 0.16, 6.85, 0.32, x + 1.52, 14.6, centralFace + 0.28, ashlar, 'Central French door jamb');
      box(g, 3.0, 0.14, 0.9, x, 11.45, centralFace + 0.72, bronze, 'Central portico balcony rail');
      for (let k = 0; k < 11; k++) {
        box(g, 0.045, 0.55, 0.055, x - 1.32 + k * 0.264, 11.72, centralFace + 1.0, bronze, 'Central portico baluster');
      }
    }

    // Suys' wrought-iron balcony parapet surrounds the ENTIRE first floor of the real
    // palace (preserved through Maquet's 1904–09 reconstruction): one continuous iron
    // rail and balustrade runs the full ~160 m frontage at piano nobile level, stepping
    // forward across the projecting central corps de logis.
    const ironRail = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.07, 0.07), bronze, 66);
    const ironBalusters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.5, 0.055), bronze, 66 * 9);
    const igd = new THREE.Object3D();
    let ii = 0, ib = 0;
    for (let x = -78.6; x <= 78.61; x += 2.4) {
      const fz = Math.abs(x + 1.2) < 18 ? centralFace : facadeZ;
      igd.position.set(x + 1.2, 8.18, fz + 0.66);
      igd.rotation.y = 0;
      igd.updateMatrix();
      ironRail.setMatrixAt(ii++, igd.matrix);
      for (let k = 0; k < 9; k++) {
        igd.position.set(x + 0.24 + k * 0.24, 7.92, fz + 0.84);
        igd.updateMatrix();
        ironBalusters.setMatrixAt(ib++, igd.matrix);
      }
    }
    ironRail.count = ii;
    ironBalusters.count = ib;
    ironRail.name = 'First-floor wrought-iron balcony rail';
    ironBalusters.name = 'First-floor wrought-iron balusters';
    ironRail.castShadow = ironBalusters.castShadow = true;
    g.add(ironRail, ironBalusters);

    // Central attic: five smaller windows, sculpted panels and a continuous balustrade.
    box(g, 36.5, 1.0, 23.5, 0, 22.9, -1, ashlar, 'Central entablature');

    // Maquet crowned the main pavilion with a dormered roof ("toiture à lucarne"):
    // a slate mansard over the central corps pierced by three pedimented dormers.
    const cmShape = new THREE.Shape();
    cmShape.moveTo(-17, 0); cmShape.lineTo(17, 0); cmShape.lineTo(15, 2.4); cmShape.lineTo(-15, 2.4); cmShape.closePath();
    const cmGeo = new THREE.ExtrudeGeometry(cmShape, { depth: 17, bevelEnabled: false });
    cmGeo.translate(0, 24.0, -10.0);
    mesh(g, cmGeo, roof, 0, 0, -1.5, 'Central corps mansard roof');
    for (let i = 0; i < 3; i++) {
      const dx = -10 + i * 10;
      box(g, 2.0, 2.2, 0.3, dx, 24.4, 5.9, stone, 'Central mansard dormer');
      box(g, 1.4, 1.6, 0.34, dx, 24.4, 5.95, glass, 'Central mansard dormer window');
      const dPed = new THREE.Shape();
      dPed.moveTo(-1.2, 0); dPed.lineTo(1.2, 0); dPed.lineTo(0, 0.8); dPed.closePath();
      mesh(g, new THREE.ShapeGeometry(dPed), moulding, dx, 25.55, 5.9, 'Central dormer pediment');
    }
    for (let i = 0; i < 5; i++) {
      const x = -12 + i * 6;
      box(g, 1.55, 1.55, 0.18, x, 24.15, centralFace + 0.12, glass, 'Central attic window');
      box(g, 1.9, 0.18, 0.34, x, 23.25, centralFace + 0.25, moulding, 'Attic window sill');
      box(g, 1.9, 0.18, 0.34, x, 25.05, centralFace + 0.25, moulding, 'Attic window lintel');
      box(g, 3.6, 1.15, 0.18, x, 26.35, centralFace + 0.14, ashlar, 'Sculpted attic panel');
      // Double smooth-shafted colonnettes with socles flank each attic window (heritage 30402).
      for (const dx of [-1.95, 1.95]) {
        box(g, 0.5, 0.25, 0.3, x + dx, 23.42, centralFace + 0.2, ashlar, 'Attic colonnette socle');
        cylinder(g, 0.15, 0.18, 1.35, x + dx, 24.15, centralFace + 0.2, stone, 10);
        box(g, 0.42, 0.18, 0.28, x + dx, 24.9, centralFace + 0.2, ashlar, 'Attic colonnette capital');
      }
    }
    // A second, smaller row of oculi lights the attic between the windows (heritage 30402: "deux rangs d'œil-de-boeuf").
    for (let i = 0; i < 4; i++) {
      const ox = -9 + i * 6;
      mesh(g, new THREE.CircleGeometry(0.3, 14), glass, ox, 25.5, centralFace + 0.13, 'Central attic oculus');
      mesh(g, new THREE.TorusGeometry(0.36, 0.06, 6, 16), ashlar, ox, 25.5, centralFace + 0.12, 'Central attic oculus surround');
    }

    // The real central attic carries an oval garlanded medallion struck with Leopold
    // II's monogram, flanked by garland swags (heritage inventory).
    const medallion = mesh(g, new THREE.TorusGeometry(1.15, 0.16, 10, 28), moulding, 0, 26.35, centralFace + 0.26, 'Leopold II monogram medallion');
    medallion.scale.set(1.3, 1, 1);
    mesh(g, new THREE.CircleGeometry(1.0, 28), ashlar, 0, 26.35, centralFace + 0.3, 'Leopold II monogram disc');
    box(g, 0.3, 0.95, 0.06, -0.16, 26.38, centralFace + 0.34, moulding, 'Leopold II monogram L stem');
    box(g, 0.55, 0.28, 0.06, 0.05, 26.02, centralFace + 0.34, moulding, 'Leopold II monogram L foot');
    for (const side of [-1, 1]) {
      mesh(g, new THREE.TorusGeometry(2.1, 0.09, 8, 24, Math.PI * 0.85), moulding, side * 3.6, 26.35, centralFace + 0.28, 'Attic garland swag');
    }

    // Monumental triangular pediment, with an inset tympanum and a simple relief group.
    const pediment = new THREE.Shape();
    pediment.moveTo(-11.5, 0);
    pediment.lineTo(11.5, 0);
    pediment.lineTo(0, 5.8);
    pediment.closePath();
    mesh(g, new THREE.ShapeGeometry(pediment), ashlar, 0, 23.55, centralFace + 0.18, 'Palace sculpted triangular pediment');
    box(g, 23.5, 0.5, 1.0, 0, 23.55, centralFace + 0.38, moulding, 'Pediment lower moulding');
    // Behind the pediment the central corps roof is a flat terrasson bordered by a stone balustrade (heritage 30402).
    box(g, 24, 0.35, 8, 0, 23.8, 6.0, ashlar, 'Central corps roof terrasson');
    const trPost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), ashlar, 40);
    const trd = new THREE.Object3D();
    let tri = 0;
    for (let x = -11.5; x <= 11.5; x += 1.15) {
      trd.position.set(x, 24.32, 2.2);
      trd.rotation.y = 0;
      trd.updateMatrix();
      trPost.setMatrixAt(tri++, trd.matrix);
    }
    for (const sx of [-1, 1]) {
      for (let z = 3.35; z <= 9.8; z += 1.15) {
        trd.position.set(sx * 11.8, 24.32, z);
        trd.updateMatrix();
        trPost.setMatrixAt(tri++, trd.matrix);
      }
    }
    trPost.count = tri;
    trPost.name = 'Terrasson balustrade posts';
    g.add(trPost);
    box(g, 23.6, 0.14, 0.22, 0, 24.72, 2.2, moulding, 'Terrasson balustrade front rail');
    for (const sx of [-1, 1]) {
      box(g, 0.22, 0.14, 8.0, sx * 11.8, 24.72, 6.0, moulding, 'Terrasson balustrade side rail');
    }
    const leftRake = box(g, 0.58, 13.0, 0.9, -5.75, 26.45, centralFace + 0.42, moulding, 'Pediment left raking cornice');
    leftRake.rotation.z = -Math.atan2(11.5, 5.8);
    const rightRake = box(g, 0.58, 13.0, 0.9, 5.75, 26.45, centralFace + 0.42, moulding, 'Pediment right raking cornice');
    rightRake.rotation.z = Math.atan2(11.5, 5.8);
    // Allegorical centre and flanking relief figures are deliberately low-relief silhouettes.
    mesh(g, new THREE.SphereGeometry(0.72, 16, 12), moulding, 0, 26.45, centralFace + 0.72, 'Belgium allegory relief head');
    cylinder(g, 0.62, 0.9, 1.8, 0, 25.15, centralFace + 0.72, moulding, 16);
    for (const [x, y] of [[-5.0, 24.8], [-3.4, 25.2], [3.4, 25.2], [5.0, 24.8]]) {
      mesh(g, new THREE.SphereGeometry(0.48, 12, 10), moulding, x, y + 0.9, centralFace + 0.72, 'Pediment allegorical figure head');
      cylinder(g, 0.42, 0.62, 1.5, x, y, centralFace + 0.72, moulding, 12);
      const arm = box(g, 0.24, 1.55, 0.28, x + (x < 0 ? 0.72 : -0.72), y + 0.8, centralFace + 0.72, moulding, 'Pediment allegorical figure arm');
      arm.rotation.z = x < 0 ? -0.45 : 0.45;
    }

    // Thomas Vinçotte's tympanum relief: the allegorical figure of Belgium is flanked
    // by groups representing Industry (hammer and gear, left) and Agriculture
    // (wheat sheaf and sickle, right), as on the real 1904–09 pediment.
    for (const side of [-1, 1]) {
      const rx = side * 7.6, ry = 24.6, rz = centralFace + 0.78;
      if (side < 0) {
        box(g, 0.14, 1.6, 0.12, rx - 0.3, ry - 0.1, rz, moulding, 'Industry relief hammer handle');
        box(g, 0.66, 0.3, 0.12, rx - 0.3, ry + 0.72, rz, moulding, 'Industry relief hammer head');
        mesh(g, new THREE.TorusGeometry(0.36, 0.1, 8, 20), moulding, rx + 0.45, ry - 0.05, rz, 'Industry relief gear');
      } else {
        for (let s = 0; s < 5; s++) {
          const stalk = cylinder(g, 0.045, 0.06, 1.5, rx - 0.4 + s * 0.2, ry + 0.1, rz, moulding, 6);
          stalk.rotation.z = (s - 2) * 0.12;
        }
        box(g, 0.9, 0.16, 0.1, rx, ry - 0.28, rz, moulding, 'Agriculture relief sheaf binding');
        mesh(g, new THREE.TorusGeometry(0.4, 0.07, 8, 20, Math.PI * 1.2), moulding, rx + 0.5, ry + 0.55, rz, 'Agriculture relief sickle');
      }
    }

    // Vinçotte's full tympanum programme (heritage inventory): Belgium seated, holding
    // the national flag and a medallion of Leopold II, between Agriculture and
    // Industry — with the Scheldt and the Meuse in the pediment corners.
    const pz = centralFace + 0.78;
    cylinder(g, 0.045, 0.045, 2.3, 0.95, 27.9, pz, bronze, 8);
    mesh(g, new THREE.SphereGeometry(0.06, 8, 6), bronze, 0.95, 29.05, pz, 'Pediment national flag staff finial');
    for (let i = 0; i < 3; i++) {
      const flagMat2 = new THREE.MeshStandardMaterial({ color: [0x171717, 0xf2d02e, 0xe12b2b][i], roughness: 0.9 });
      box(g, 0.26, 0.85, 0.04, 1.25 + (i - 1) * 0.26, 28.6, pz, flagMat2, 'Pediment Belgian flag stripe');
    }
    mesh(g, new THREE.TorusGeometry(0.5, 0.08, 8, 20), moulding, -0.95, 26.9, pz, 'Leopold II pediment medallion');
    mesh(g, new THREE.CircleGeometry(0.42, 20), ashlar, -0.95, 26.9, pz + 0.04, 'Leopold II pediment medallion disc');
    mesh(g, new THREE.TorusGeometry(0.55, 0.08, 6, 16, Math.PI * 1.4), moulding, -9.6, 24.35, pz, 'Escaut river relief');
    mesh(g, new THREE.TorusGeometry(0.55, 0.08, 6, 16, Math.PI * 1.4), moulding, 9.6, 24.35, pz, 'Meuse river relief');

    // The real central roof is a high, square drum and a broad flattened dome,
    // with two rows of oculi on each face and a rooftop balustrade.
    box(g, 17.5, 4.6, 17.5, 0, 27.2, -1, stone, 'Central dome drum');
    // Heritage inventory: the drum is pierced on EACH FACE by two rows of oeil-de-boeuf,
    // the lower row rimmed with a garland ("deux rangs d'yeux-de-bœuf, les inférieurs
    // ourlés d'une guirlande") — front, back and both side faces.
    for (const face of [-1, 1]) {
      const z = -1 + face * 8.9;
      for (const y of [26.4, 28.4]) {
        for (let i = 0; i < 3; i++) {
          const x = -5.4 + i * 5.4;
          mesh(g, new THREE.TorusGeometry(0.62, 0.12, 8, 20), moulding, x, y, z + face * 0.08, 'Dome drum oculus surround');
          mesh(g, new THREE.CircleGeometry(0.52, 20), glass, x, y, z + face * 0.1, 'Dome drum oculus');
          if (y === 26.4) {
            const garland = mesh(g, new THREE.TorusGeometry(0.85, 0.06, 6, 16, Math.PI), moulding, x, y - 0.42, z + face * 0.1, 'Dome drum oculus garland');
            garland.rotation.z = Math.PI;
          }
        }
      }
    }
    for (const side of [-1, 1]) {
      const x = side * 8.9;
      for (const y of [26.4, 28.4]) {
        for (let i = 0; i < 3; i++) {
          const z = -1 - 5.4 + i * 5.4;
          const surround = mesh(g, new THREE.TorusGeometry(0.62, 0.12, 8, 20), moulding, x + side * 0.08, y, z, 'Dome drum oculus surround');
          const oculus = mesh(g, new THREE.CircleGeometry(0.52, 20), glass, x + side * 0.1, y, z, 'Dome drum oculus');
          surround.rotation.y = oculus.rotation.y = Math.PI / 2;
          if (y === 26.4) {
            const garland = mesh(g, new THREE.TorusGeometry(0.85, 0.06, 6, 16, Math.PI), moulding, x + side * 0.1, y - 0.42, z, 'Dome drum oculus garland');
            garland.rotation.y = Math.PI / 2;
            garland.rotation.z = Math.PI;
          }
        }
      }
    }
    box(g, 18.5, 0.48, 18.5, 0, 29.55, -1, ashlar, 'Dome base cornice');
    mesh(g, new THREE.SphereGeometry(9.0, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2), roof, 0, 29.6, -1, 'Royal Palace flattened dome');
    // The clock sits on the north face of the dome above the pediment, not hidden behind it.
    mesh(g, new THREE.TorusGeometry(1.05, 0.14, 10, 32), moulding, 0, 34.2, 6.95, 'Dome clock surround');
    mesh(g, new THREE.CircleGeometry(0.94, 32), stone, 0, 34.2, 7.03, 'Dome clock face');
    box(g, 0.09, 0.72, 0.05, 0, 34.45, 7.09, bronze, 'Dome clock minute hand');
    box(g, 0.48, 0.08, 0.05, -0.16, 34.12, 7.09, bronze, 'Dome clock hour hand');
    box(g, 13.5, 0.38, 13.5, 0, 37.8, -1, ashlar, 'Dome crown balustrade base');
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24;
      box(g, 0.32, 0.78, 0.32, Math.cos(a) * 6.55, 38.35, -1 + Math.sin(a) * 6.55, ashlar, 'Dome crown baluster');
    }
    box(g, 5.0, 0.65, 5.0, 0, 38.2, -1, ashlar, 'Dome lantern base');
    cylinder(g, 1.35, 1.55, 1.5, 0, 39.3, -1, stone, 24);
    cylinder(g, 0.8, 1.25, 1.2, 0, 40.65, -1, roof, 24);
    // Flag mast and Belgian tricolour, kept small enough not to dominate the silhouette.
    cylinder(g, 0.07, 0.07, 5.2, 0, 43.85, -1, bronze, 10);
    const flag = new THREE.Group();
    flag.position.set(0.08, 45.7, -1);
    box(flag, 0.08, 1.65, 0.08, 0, 0, 0, shadow, 'Flag staff');
    for (let i = 0; i < 3; i++) {
      const flagMat = new THREE.MeshStandardMaterial({ color: [0x171717, 0xf2d02e, 0xe12b2b][i], roughness: 0.9 });
      box(flag, 0.28, 1.1, 0.04, (i - 1) * 0.28, 0, 0, flagMat, 'Belgian flag stripe');
    }
    g.add(flag);

    // Terminal pavilions close the long façade; each has a pavilion roof and a stronger
    // corner risalit, while the iron-and-stone forecourt boundary stays visually light.
    for (const x of [-76, 76]) {
      box(g, 8, 23, 21, x, 11.5, -1, stone, 'Palace terminal pavilion');
      box(g, 9.5, 0.9, 22, x, 23.25, -1, moulding, 'Terminal pavilion cornice');
      mesh(g, new THREE.ConeGeometry(6.6, 2.0, 4), roof, x, 25.0, -1, 'Terminal pavilion pavilion roof');
      // Pavilion dormers (lucarne en pavillon) pierce the front slope of each pavilion roof.
      for (const dx of [-3.2, 0, 3.2]) {
        box(g, 1.1, 1.3, 0.3, x + dx, 24.45, 3.6, stone, 'Pavilion dormer');
        box(g, 0.7, 0.85, 0.34, x + dx, 24.45, 3.62, glass, 'Pavilion dormer window');
        mesh(g, new THREE.ConeGeometry(0.85, 0.75, 4), roof, x + dx, 25.35, 3.6, 'Pavilion dormer pavilion roof');
      }
      for (const dx of [-2.5, 0, 2.5]) {
        box(g, 1.55, 4.4, 0.22, x + dx, 14.0, facadeZ + 0.1, glass, 'Terminal pavilion window');
        // The pavilion ground floors carry the same rusticated round arches with
        // keystones as the wings and the avant-corps (heritage inventory).
        const pArch = new THREE.Shape();
        pArch.moveTo(-0.95, 0); pArch.lineTo(0.95, 0); pArch.lineTo(0.95, 3.0);
        pArch.absarc(0, 3.0, 0.95, 0, Math.PI, false); pArch.lineTo(-0.95, 0); pArch.closePath();
        mesh(g, new THREE.ShapeGeometry(pArch), shadow, x + dx, 1.1, facadeZ + 0.18, 'Pavilion ground-floor arched opening');
        box(g, 0.28, 0.48, 0.18, x + dx, 5.12, facadeZ + 0.26, ashlar, 'Pavilion arcade keystone');
      }
    }

    // The real roofline is a continuous stone balustrade across the whole façade —
    // central corps and terminal pavilions included ("balustrade terminale" in front
    // of the mansard roof). One instanced mesh for all the balusters.
    const roofBalusters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.62, 0.26), ashlar, 90);
    const rd = new THREE.Object3D();
    let ri = 0;
    for (let x = -17; x <= 17.01; x += 1.2) {
      rd.position.set(x, 24.35, centralFace + 0.9);
      rd.rotation.y = 0;
      rd.updateMatrix();
      roofBalusters.setMatrixAt(ri++, rd.matrix);
    }
    for (const x of [-76, 76]) {
      for (let dx = -3.6; dx <= 3.61; dx += 1.2) {
        rd.position.set(x + dx, 23.66, facadeZ + 0.85);
        rd.updateMatrix();
        roofBalusters.setMatrixAt(ri++, rd.matrix);
      }
    }
    roofBalusters.count = ri;
    roofBalusters.name = 'Palace roofline balusters';
    roofBalusters.castShadow = true;
    g.add(roofBalusters);
    box(g, 35, 0.12, 0.34, 0, 24.72, centralFace + 0.9, moulding, 'Central roofline balustrade rail');
    for (const x of [-76, 76]) {
      box(g, 9, 0.12, 0.32, x, 24.0, facadeZ + 0.85, moulding, 'Pavilion roofline balustrade rail');
    }

    // Chimney stacks (souches de cheminée) rise from the slate roofs of the wings,
    // capped with stone copings, as on the real palace roofs.
    const chimneys = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 2.6, 1.1), ashlar, 16);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.3, 1.5), moulding, 16);
    const cd = new THREE.Object3D();
    let ci = 0;
    for (const x of wingXs) {
      for (let i = 0; i < 3; i++) {
        const cx2 = x - 18 + i * 18, cz2 = -4 - i * 2;
        cd.position.set(cx2, 23.6, cz2);
        cd.rotation.y = 0;
        cd.updateMatrix();
        chimneys.setMatrixAt(ci, cd.matrix);
        cd.position.set(cx2, 24.95, cz2);
        cd.updateMatrix();
        caps.setMatrixAt(ci++, cd.matrix);
      }
    }
    chimneys.count = caps.count = ci;
    chimneys.name = 'Palace roof chimney stacks';
    caps.name = 'Chimney stack caps';
    g.add(chimneys, caps);
    // The real front garden (jardin d'honneur, laid out 1904–09) holds three sunken
    // parterres between the façade and the gilded railing ("trois parterres creusés"):
    // a central pair flanking the perron walk on the portico axis, plus two lateral
    // parterres.
    const lawnMat = new THREE.MeshStandardMaterial({ color: 0x5f7f52, roughness: 0.96 });
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xb06a5a, roughness: 0.95 });
    const parterres = [
      { x: -13.5, w: 9, z: 12.4, d: 2.6 },
      { x: 13.5, w: 9, z: 12.4, d: 2.6 },
      { x: -38, w: 34, z: 12.4, d: 2.6 },
      { x: 38, w: 34, z: 12.4, d: 2.6 }
    ];
    for (const p of parterres) {
      box(g, p.w, 0.24, p.d, p.x, -0.12, p.z, ashlar, 'Sunken parterre retaining edge');
      box(g, p.w - 0.8, 0.1, p.d - 0.8, p.x, -0.02, p.z, lawnMat, 'Sunken parterre lawn');
      box(g, p.w - 4, 0.06, 0.7, p.x, 0.05, p.z, flowerMat, 'Parterre flower band');
    }

    // A monumental perron (emmarchement) leads up from the garden walk to the central
    // portico entrance, as on the real front.
    for (let s = 0; s < 3; s++) {
      box(g, 17, 0.32, 0.62, 0, 0.79 - s * 0.32, centralFace + 0.3 + s * 0.62, ashlar, 'Portico perron step');
    }

    // "Les Fleurs du Palais Royal": eleven great pots — one for each of the country's
    // provinces plus the capital Brussels — stand along the central garden walk.
    const potMat = new THREE.MeshStandardMaterial({ color: 0x9a5b3c, roughness: 0.9 });
    const pots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.42, 0.9, 12), potMat, 11);
    const plants = new THREE.InstancedMesh(new THREE.SphereGeometry(0.62, 10, 8), flowerMat, 11);
    const pd = new THREE.Object3D();
    let pi = 0;
    for (let k = 0; k < 11; k++) {
      const px = -30 + k * 6;
      pd.position.set(px, 0.45, 11.0);
      pd.rotation.y = 0;
      pd.updateMatrix();
      pots.setMatrixAt(pi, pd.matrix);
      pd.position.set(px, 1.25, 11.0);
      pd.updateMatrix();
      plants.setMatrixAt(pi++, pd.matrix);
    }
    pots.count = plants.count = pi;
    pots.name = 'Les Fleurs du Palais Royal pots';
    plants.name = 'Les Fleurs du Palais Royal plantings';
    g.add(pots, plants);

    // The 1904–09 garden is enclosed by GILDED railings, gates and balustrades on a
    // stone plinth ("grilles, portails et balustrades dorés"), separating the palace
    // from the Place des Palais. Three gates open onto the parterre axes: the central
    // gate on the portico axis and one in front of each lateral parterre.
    const gilded = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.75, roughness: 0.35 });
    box(g, 149, 0.5, 0.6, 0, 0.25, 14, ashlar, 'Garden enclosure stone plinth');
    for (let x = -74; x <= 74; x += 2.4) {
      cylinder(g, 0.09, 0.12, 1.5, x, 0.75, 14, gilded, 8);
      if (x < 73.9) {
        box(g, 2.4, 0.06, 0.06, x + 1.2, 1.42, 14, gilded, 'Gilded garden railing top rail');
        box(g, 2.4, 0.05, 0.05, x + 1.2, 1.0, 14, gilded, 'Gilded garden railing mid rail');
      }
    }
    for (const gx of [0, -38, 38]) {
      for (const side of [-1, 1]) {
        box(g, 0.9, 1.9, 0.9, gx + side * 2.4, 0.95, 14, ashlar, 'Gilded gate stone pier');
        mesh(g, new THREE.SphereGeometry(0.42, 12, 10), gilded, gx + side * 2.4, 2.15, 14, 'Gate pier gilded urn');
      }
      box(g, 4.0, 1.15, 0.08, gx, 0.95, 14, gilded, 'Gilded garden gate leaf');
      for (let k = 0; k < 9; k++) {
        box(g, 0.05, 1.15, 0.05, gx - 1.8 + k * 0.45, 0.95, 14, gilded, 'Gilded gate baluster');
      }
    }

    // Rusticated corner quoins (chaînage d'angle) chain the vertical edges of the
    // central corps and the terminal pavilions, as on the real palace corners.
    const quoins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.8, 0.34), ashlar, 200);
    const qd = new THREE.Object3D();
    let qi = 0;
    for (const cx of [-17, 17]) {
      for (let y = 1.2; y <= 23.2; y += 0.95) {
        qd.position.set(cx + (cx < 0 ? -0.25 : 0.25), y, centralFace + 0.12);
        qd.rotation.y = 0;
        qd.updateMatrix();
        quoins.setMatrixAt(qi++, qd.matrix);
      }
    }
    for (const px of [-76, 76]) {
      for (const cx of [px - 4, px + 4]) {
        for (let y = 1.2; y <= 22.6; y += 0.95) {
          qd.position.set(cx + (cx < px ? -0.25 : 0.25), y, facadeZ + 0.12);
          qd.updateMatrix();
          quoins.setMatrixAt(qi++, qd.matrix);
        }
      }
    }
    quoins.count = qi;
    quoins.name = 'Palace corner quoins';
    quoins.castShadow = true;
    g.add(quoins);

    // Every face of the real palace is pierced — the wing ends and the pavilions'
    // outer faces carry windows too, so oblique views from the square never see a
    // blank gable end.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wz = -6 - i * 5;
        box(g, 0.2, 3.2, 1.9, side * 70.1, 12.5, wz, glass, 'Wing end window (piano nobile)');
        box(g, 0.2, 2.4, 1.9, side * 70.1, 6.5, wz, glass, 'Wing end window (ground)');
      }
      // The side façades keep the same pilaster order as the front (heritage: "aile de sept travées").
      for (let i = 0; i < 4; i++) {
        box(g, 0.34, 20, 0.3, side * 70.1, 10, -3.5 - i * 5, ashlar, 'Wing end pilaster');
      }
      for (let f = 0; f < 2; f++) {
        for (let i = 0; i < 3; i++) {
          box(g, 0.22, 3.4, 1.9, side * 80.1, 13 + f * 5.5, -5 - i * 5, glass, 'Pavilion outer-face window');
        }
      }
    }

    // The Place des Palais in front of the palace is entirely paved — a 70 x 350 m
    // square of blue-stone setts (pierre bleue). Lay the palace's paved frontage apron
    // beyond the gilded garden railing.
    box(g, 170, 0.3, 44, 0, -0.15, 36, materials.pavingEdge, 'Place des Palais paved apron');
    const settGeo = new THREE.BoxGeometry(0.9, 0.07, 0.9);
    const setts = new THREE.InstancedMesh(settGeo, materials.pavingB, 44 * 60);
    const psd = new THREE.Object3D();
    let psi = 0;
    for (let row = 0; row < 44; row++) {
      for (let col = 0; col < 60; col++) {
        psd.position.set(-84 + col * 2.9 + (row % 2) * 0.3, -0.02, 15 + row * 0.95);
        psd.rotation.y = (row + col) % 3 * 0.02;
        psd.updateMatrix();
        setts.setMatrixAt(psi++, psd.matrix);
      }
    }
    setts.count = psi;
    setts.name = 'Place des Palais sett paving';
    setts.receiveShadow = true;
    g.add(setts);

    // The real palace wraps a quadrangle to the south: the east and west wings (aile
    // Est / aile Ouest) enclose the Cour du Roi — today's Cour d'honneur — closed by
    // a rear range. The wings run tall to the ground so they sit on the sloping site.
    for (const side of [-1, 1]) {
      box(g, 12, 26, 42, side * 45, 5, -33, stone, 'Palace rear wing (Cour d’honneur)');
      box(g, 12.6, 0.8, 42.6, side * 45, 18.4, -33, ashlar, 'Rear wing cornice');
      for (let i = 0; i < 6; i++) {
        const wz = -14 - i * 6.5;
        box(g, 2.2, 3.4, 0.2, side * 45, 12.5, wz, glass, 'Rear wing piano nobile window');
        box(g, 2.2, 2.6, 0.2, side * 45, 6.5, wz, glass, 'Rear wing ground window');
      }
    }
    box(g, 102, 26, 12, 0, 5, -54, stone, 'Palace rear range closing the Cour d’honneur');
    box(g, 103, 0.8, 12.6, 0, 18.4, -54, ashlar, 'Rear range cornice');

    // The central wing is marked by a projection to the north AND south ("avant-corps
    // au Nord et au Sud") — the rear avant-corps houses the Throne Room (Salle du
    // Trône) in the west wing's symmetric south projection.
    box(g, 26, 28, 7, 0, 6, -60, stone, 'Palace south rear avant-corps (Throne Room)');
    box(g, 27, 0.9, 7.8, 0, 20.4, -60, ashlar, 'South avant-corps cornice');
    const southPed = new THREE.Shape();
    southPed.moveTo(-8, 0); southPed.lineTo(8, 0); southPed.lineTo(0, 4.2); southPed.closePath();
    const sp = mesh(g, new THREE.ShapeGeometry(southPed), ashlar, 0, 20.85, -63.6, 'South avant-corps pediment');
    sp.rotation.y = Math.PI;
    for (let i = 0; i < 4; i++) {
      const wx = -9 + i * 6;
      box(g, 2.0, 3.6, 0.2, wx, 13.5, -63.5, glass, 'South avant-corps window');
      box(g, 2.0, 2.8, 0.2, wx, 7.0, -63.5, glass, 'South avant-corps ground window');
    }

    // Two symmetrical curved galleries (galeries courbes) join each end pavilion to the
    // hotels at the extremities of the Place des Palais (heritage inventory, building 30402).
    for (const side of [-1, 1]) {
      for (let cgK = 0; cgK < 7; cgK++) {
        const cgA = cgK / 6 * Math.PI / 2;
        const cgX = side * 88 - 8 * Math.cos(cgA);
        const cgZ = 8.5 + 8 * Math.sin(cgA);
        box(g, 0.55, 7.6, 0.55, cgX, 3.8, cgZ, stone, 'Curved gallery column');
        box(g, 0.85, 0.3, 0.85, cgX, 7.75, cgZ, ashlar, 'Curved gallery capital');
      }
      for (let cgK = 0; cgK < 6; cgK++) {
        const cgAm = (cgK + 0.5) / 6 * Math.PI / 2;
        const cgX = side * 88 - 8 * Math.cos(cgAm);
        const cgZ = 8.5 + 8 * Math.sin(cgAm);
        const cgChord = 2 * 8 * Math.sin(Math.PI / 24) + 0.3;
        const cgRot = Math.atan2(-Math.cos(cgAm), side * Math.sin(cgAm));
        const cgE = box(g, cgChord, 0.7, 0.5, cgX, 8.3, cgZ, ashlar, 'Curved gallery entablature');
        cgE.rotation.y = cgRot;
        const cgR = box(g, cgChord + 0.2, 0.35, 1.2, cgX, 8.85, cgZ, roof, 'Curved gallery roof segment');
        cgR.rotation.y = cgRot;
      }
    }



    // The portico is roofed: a coffered soffit ceiling spans between the two column rows
    // under the entablature (classical portico ceiling).
    box(g, 27, 0.35, 7.2, 0, 21.6, centralFace + 2.8, ashlar, 'Portico soffit ceiling');
    const cofferGeo = new THREE.BoxGeometry(0.9, 0.12, 0.9);
    const coffers = new THREE.InstancedMesh(cofferGeo, moulding, 15);
    const cfd = new THREE.Object3D();
    let cfi = 0;
    for (let cx = -10; cx <= 10; cx += 5) {
      for (let cz = centralFace + 1.4; cz <= centralFace + 4.2; cz += 1.4) {
        cfd.position.set(cx, 21.38, cz); cfd.rotation.y = 0; cfd.updateMatrix();
        coffers.setMatrixAt(cfi++, cfd.matrix);
      }
    }
    coffers.count = cfi; coffers.name = 'Portico soffit coffers'; g.add(coffers);

    // The central avant-corps is pierced on its east and west faces too, like the wings —
    // oblique views from the square never see a blank side wall.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wz = -6 - i * 5;
        box(g, 0.2, 3.4, 2.2, side * 17.1, 13.5, wz, glass, 'Central corps side window (piano nobile)');
        box(g, 0.2, 2.6, 2.2, side * 17.1, 6.5, wz, glass, 'Central corps side window (ground)');
      }
    }

    // The dome lantern is crowned by a gilded finial ball and spike.
    mesh(g, new THREE.SphereGeometry(0.45, 12, 10), gilded, 0, 41.9, -1, 'Dome lantern gilded finial');
    mesh(g, new THREE.ConeGeometry(0.22, 1.1, 8), gilded, 0, 42.75, -1, 'Dome lantern finial spike');

    // A gravel central walk runs from the garden gate to the perron on the portico axis.
    box(g, 5, 0.08, 5.6, 0, 0.06, 11.7, ashlar, 'Garden central walk');

    // Each sunken parterre is edged with a clipped boxwood border (jardin d'honneur).
    for (const p of [{ x: -13.5, w: 9 }, { x: 13.5, w: 9 }, { x: -38, w: 34 }, { x: 38, w: 34 }]) {
      box(g, p.w + 0.5, 0.34, 0.22, p.x, 0.1, 12.4 - 1.5, lawnMat, 'Parterre boxwood border');
      box(g, p.w + 0.5, 0.34, 0.22, p.x, 0.1, 12.4 + 1.5, lawnMat, 'Parterre boxwood border');
      box(g, 0.22, 0.34, 3.2, p.x - p.w / 2 - 0.25, 0.1, 12.4, lawnMat, 'Parterre boxwood border');
      box(g, 0.22, 0.34, 3.2, p.x + p.w / 2 + 0.25, 0.1, 12.4, lawnMat, 'Parterre boxwood border');
    }

    // The palace is floodlit at night: bronze floodlight fixtures stand along the garden
    // wall, aimed up at the façade (registered in facadeWashMats, round 13).
    for (let fx = -30; fx <= 30; fx += 10) {
      cylinder(g, 0.07, 0.1, 1.8, fx, 0.9, 13.4, bronze, 8).name = 'Facade floodlight fixture';
      mesh(g, new THREE.SphereGeometry(0.22, 8, 6), nightGlowMats ? glass : glass, fx, 1.95, 13.4, 'Facade floodlight head');
    }

    // The Cour d'honneur is accessible by road from the south too: a carriage gate arch
    // pierces the south avant-corps on the palace axis.
    const cgArch = new THREE.Shape();
    cgArch.moveTo(-4, 0); cgArch.lineTo(4, 0); cgArch.lineTo(4, 5.0);
    cgArch.absarc(0, 5.0, 4, 0, Math.PI, false); cgArch.lineTo(-4, 0); cgArch.closePath();
    mesh(g, new THREE.ShapeGeometry(cgArch), glass, 0, 0, -63.4, 'Cour d’honneur south carriage gate');
    box(g, 10, 1.0, 0.8, 0, 9.4, -63.5, ashlar, 'South carriage gate impost');

    // String courses divide the central corps' storeys on the front, as on the wings.
    box(g, 34.6, 0.3, 0.3, 0, 8.6, centralFace + 0.15, moulding, 'Central first string course');
    box(g, 34.6, 0.3, 0.3, 0, 16.4, centralFace + 0.15, moulding, 'Central second string course');

    // Every wing window has a projecting moulded surround band (encadrement mouluré),
    // proud of the wall face — the heritage fiche's "fenêtres à encadrement mouluré".
    for (const x of wingXs) {
      for (let i = 0; i < 9; i++) {
        const bx = x - 22 + i * 5.5;
        for (const [floorY, winH] of [[9.9, 3.55], [16.0, 3.0]]) {
          box(g, 2.5, winH + 0.6, 0.12, bx, floorY, facadeZ + 0.3, ashlar, 'Wing window moulded surround');
        }
      }
    }

    // The perron is flanked by stone balustrade ramps on both sides of the steps.
    for (const side of [-1, 1]) {
      for (let s = 0; s < 3; s++) {
        box(g, 0.3, 0.9, 0.7, side * 8.9, 1.1 - s * 0.32, centralFace + 0.3 + s * 0.62, ashlar, 'Perron side balustrade');
      }
      box(g, 0.34, 0.14, 2.1, side * 8.9, 1.6, centralFace + 0.6, moulding, 'Perron side rail');
    }

    // Each terminal pavilion roof is crowned by a gilded finial ball, like the dome lantern.
    for (const x of [-76, 76]) {
      mesh(g, new THREE.SphereGeometry(0.5, 12, 10), gilded, x, 26.3, -1, 'Pavilion roof gilded finial');
    }

    // Ground-floor wing openings are protected by wrought-iron grilles, matching the
    // palace's ironwork (Suys' balcony, garden railings).
    for (const x of wingXs) {
      for (let i = 0; i < 9; i++) {
        const bx = x - 22 + i * 5.5;
        box(g, 1.7, 3.1, 0.06, bx, 3.6, facadeZ + 0.22, bronze, 'Wing ground-floor window grille');
        for (let gk = 0; gk < 5; gk++) {
          box(g, 0.04, 3.1, 0.04, bx - 0.7 + gk * 0.35, 3.6, facadeZ + 0.26, bronze, 'Wing grille bar');
        }
      }
    }

    // The central entrance carries a gilded fanlight (imposte) above the door, set in the
    // arch head of the middle portico bay.
    const fanShape = new THREE.Shape();
    fanShape.moveTo(-2.2, 0); fanShape.lineTo(2.2, 0);
    fanShape.absarc(0, 0, 2.2, 0, Math.PI, false); fanShape.closePath();
    mesh(g, new THREE.ShapeGeometry(fanShape), glass, 0, 6.4, centralFace + 0.3, 'Central entrance gilded fanlight');
    for (let fk = 0; fk < 4; fk++) {
      const fa = (fk - 1.5) * 0.55;
      const fr = box(g, 0.06, 4.0, 0.05, Math.sin(fa) * 1.1, 6.4 + Math.cos(fa) * 1.1, centralFace + 0.32, gilded, 'Central fanlight radial bar');
      fr.rotation.z = fa;
    }

    // The rear range and the south avant-corps are roofed with slate, like the rest of the palace.
    box(g, 103, 1.4, 13, 0, 19.2, -54, roof, 'Rear range slate roof');
    box(g, 27.5, 1.2, 8, 0, 21.2, -60, roof, 'South avant-corps slate roof');

    // The Cour d'honneur between the rear wings is a gravelled court, open to the
    // carriage gates north and south.
    box(g, 78, 0.12, 36, 0, 0.02, -37, ashlar, 'Cour d’honneur gravel court');

    // The flattened dome is stiffened by eight stone ribs rising from drum to lantern.
    for (let ri = 0; ri < 8; ri++) {
      const ra = ri * Math.PI / 4;
      const rib = mesh(g, new THREE.TorusGeometry(11.5, 0.22, 6, 20, Math.PI / 2), ashlar, Math.sin(ra) * 0, 29.9, -1, 'Dome rib');
      rib.rotation.y = ra;
      rib.rotation.z = Math.PI / 2;
    }

    // A moulded cornice band runs at the foot of each wing mansard, where the roof meets
    // the wall — the mansard's base cornice.
    for (const x of wingXs) {
      box(g, wingW + 1.2, 0.5, 0.7, x, 20.6, facadeZ + 0.4, moulding, 'Wing mansard base cornice');
    }

    // The terminal pavilion cornices carry modillions (corbels), like the main cornice.
    for (const x of [-76, 76]) {
      for (let mi2 = 0; mi2 < 7; mi2++) {
        box(g, 0.4, 0.5, 0.5, x - 4.2 + mi2 * 1.4, 23.0, facadeZ + 0.4, moulding, 'Terminal pavilion modillion');
      }
    }

    // The portico stands on a raised paved stylobate floor between and in front of the
    // column rows — the platform the colonnade stands on.
    box(g, 30, 0.5, 9.5, 0, 0.25, centralFace + 2.6, ashlar, 'Portico stylobate floor');
    box(g, 31, 0.18, 10.3, 0, 0.56, centralFace + 2.6, moulding, 'Portico stylobate edge');

    // The main pediment is crowned with acroteria: sculptural figures at the two corners
    // and the apex of the tympanum frame.
    for (const [ax, ay] of [[-10.8, 28.9], [10.8, 28.9], [0, 29.9]]) {
      cylinder(g, 0.42, 0.55, 1.6, ax, ay, centralFace + 0.4, moulding, 10).name = 'Pediment acroterion figure';
      mesh(g, new THREE.SphereGeometry(0.34, 10, 8), moulding, ax, ay + 1.0, centralFace + 0.4, 'Pediment acroterion head');
    }

    // The wing end faces are capped by a projecting end cornice (bandeau d'angle) above
    // the top windows, matching the front cornice.
    for (const side of [-1, 1]) {
      box(g, 0.5, 0.6, 20.5, side * 70.1, 20.6, -8, moulding, 'Wing end cornice');
      box(g, 0.6, 0.3, 21, side * 70.1, 21.0, -8, ashlar, 'Wing end blocking course');
    }

    // The central portico bay is closed by a bronze double entrance door with recessed
    // panels, beneath the gilded fanlight.
    box(g, 4.4, 6.2, 0.18, 0, 3.1, centralFace + 0.24, bronze, 'Central bronze entrance door');
    for (const dx of [-1.05, 1.05]) {
      for (const dy of [1.6, 3.6, 5.2]) {
        box(g, 1.7, 1.3, 0.06, dx, dy, centralFace + 0.3, shadow, 'Central door recessed panel');
      }
    }
    box(g, 4.8, 0.22, 0.3, 0, 6.3, centralFace + 0.26, gilded, 'Central door gilded transom');

    // The pavilion outer faces are capped by an end cornice matching the wing ends.
    for (const side of [-1, 1]) {
      box(g, 0.5, 0.6, 21.5, side * 80.1, 23.6, -1, moulding, 'Pavilion outer cornice');
    }

    // The central garden gate is crowned by a small pediment and gilded urn, matching the
    // monumental portails of the 1904-09 enclosure.
    const ggPed = new THREE.Shape();
    ggPed.moveTo(-3.4, 0); ggPed.lineTo(3.4, 0); ggPed.lineTo(0, 1.4); ggPed.closePath();
    mesh(g, new THREE.ShapeGeometry(ggPed), ashlar, 0, 3.1, 14, 'Garden central gate pediment');
    mesh(g, new THREE.SphereGeometry(0.3, 10, 8), gilded, 0, 4.7, 14, 'Garden central gate gilded urn');

    // The rear Cour d'honneur wings are roofed in slate with cornice edges.
    for (const side of [-1, 1]) {
      box(g, 12.8, 1.2, 42.8, side * 45, 18.9, -33, roof, 'Rear wing slate roof');
    }

    // The south avant-corps is capped by an end cornice over its pediment, matching the
    // central front's cornice.
    box(g, 27.6, 0.5, 8.2, 0, 21.0, -60, moulding, 'South avant-corps end cornice');

    // Gilded ridge finials mark the ends of each wing mansard ridge.
    for (const x of wingXs) {
      for (const side of [-1, 1]) {
        mesh(g, new THREE.SphereGeometry(0.4, 10, 8), gilded, x + side * 25.4, 23.4, -1, 'Wing mansard ridge finial');
      }
    }

    // Each terminal pavilion rises a chimney stack with a stone cap, like the wing roofs.
    for (const x of [-76, 76]) {
      box(g, 1.6, 3.2, 1.6, x, 27.6, -6, stone, 'Pavilion chimney stack');
      box(g, 2.0, 0.4, 2.0, x, 29.4, -6, ashlar, 'Pavilion chimney cap');
    }

    // A moulded base course runs under the central attic, at the top of the corps wall.
    box(g, 34.8, 0.4, 0.4, 0, 23.2, centralFace + 0.16, moulding, 'Central attic base course');

    // The two lateral garden gates (in front of the lateral parterres) get small pediments
    // and gilded urns too, like the central gate.
    for (const gx of [-38, 38]) {
      const lgPed = new THREE.Shape();
      lgPed.moveTo(-2.6, 0); lgPed.lineTo(2.6, 0); lgPed.lineTo(0, 1.1); lgPed.closePath();
      mesh(g, new THREE.ShapeGeometry(lgPed), ashlar, gx, 3.0, 14, 'Garden lateral gate pediment');
      mesh(g, new THREE.SphereGeometry(0.26, 10, 8), gilded, gx, 4.3, 14, 'Garden lateral gate gilded urn');
    }




    // Every wing window sill rests on a projecting stone apron (appui saillant).
    for (const x of wingXs) {
      for (let i = 0; i < 9; i++) {
        const bx = x - 22 + i * 5.5;
        for (const [floorY, winH] of [[9.9, 3.55], [16.0, 3.0]]) {
          box(g, 2.5, 0.14, 0.5, bx, floorY - winH / 2 - 0.24, facadeZ + 0.26, moulding, 'Wing window apron');
        }
      }
    }

    // The central corps carries tall windows on its second floor above the portico.
    for (let i = 0; i < 5; i++) {
      const cx = -12 + i * 6;
      box(g, 1.9, 3.2, 0.2, cx, 16.0, centralFace + 0.14, glass, 'Central second-floor window');
      box(g, 2.2, 0.18, 0.36, cx, 14.35, centralFace + 0.22, moulding, 'Central second-floor sill');
      box(g, 2.2, 0.18, 0.36, cx, 17.65, centralFace + 0.22, moulding, 'Central second-floor lintel');
    }

    // Each central ground-floor arch is ringed by an archivolt of voussoirs.
    for (let i = 0; i < 5; i++) {
      const cx = -8 + i * 4;
      const av = mesh(g, new THREE.TorusGeometry(1.9, 0.16, 6, 18, Math.PI), ashlar, cx, 4.4, centralFace + 0.2, 'Central arcade archivolt');
      av.rotation.x = 0;
    }

    // The wing ground-floor arches carry the same archivolt rings as the central corps.
    for (const x of wingXs) {
      for (let i = 0; i < 9; i++) {
        const bx = x - 22 + i * 5.5;
        mesh(g, new THREE.TorusGeometry(1.35, 0.14, 6, 16, Math.PI), ashlar, bx, 4.0, facadeZ + 0.2, 'Wing arcade archivolt');
      }
    }

    // A projecting plinth cap crowns the rusticated base of each wing.
    for (const x of wingXs) {
      box(g, wingW + 1.1, 0.32, wingD + 0.8, x, 1.05, -1, moulding, 'Wing plinth cap');
    }

    // The whole palace complex is "entirely enclosed by balustraded walls" (Wikipedia):
    // grounds walls run along the south, east and west sides with balustrade copings.
    for (const [wx, wz, ww, wd] of [[0, -68, 200, 0.8], [92, -20, 0.8, 96], [-92, -20, 0.8, 96]]) {
      box(g, ww, 2.2, wd, wx, 1.1, wz, stone, 'Palace grounds boundary wall');
    }
    const gwBal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.8, 0.26), ashlar, 120);
    const gwd = new THREE.Object3D();
    let gwi = 0;
    for (let gx = -98; gx <= 98; gx += 4) {
      gwd.position.set(gx, 2.6, -68); gwd.rotation.y = 0; gwd.updateMatrix();
      gwBal.setMatrixAt(gwi++, gwd.matrix);
    }
    for (const side of [-1, 1]) {
      for (let gz = -64; gz <= 28; gz += 4) {
        gwd.position.set(side * 92, 2.6, gz); gwd.updateMatrix();
        gwBal.setMatrixAt(gwi++, gwd.matrix);
      }
    }
    gwBal.count = gwi; gwBal.name = 'Palace grounds wall balustrade'; g.add(gwBal);

    // The portico column shafts are drum-stacked: horizontal joint bands mark each drum.
    const jointGeo = new THREE.CylinderGeometry(1.34, 1.34, 0.09, 32);
    const joints = new THREE.InstancedMesh(jointGeo, shadow, 36);
    const jd = new THREE.Object3D();
    let ji = 0;
    for (let i = 0; i < 6; i++) {
      const x = -12.5 + i * 5;
      for (const z of [centralFace + 1.55, centralFace + 4.1]) {
        for (const jy of [11.5, 15.2, 18.9]) {
          jd.position.set(x, jy, z); jd.rotation.y = 0; jd.updateMatrix();
          joints.setMatrixAt(ji++, jd.matrix);
        }
      }
    }
    joints.count = ji; joints.name = 'Portico column drum joints'; g.add(joints);

    // The portico entablature is finished with a cymatium and a projecting corona band.
    box(g, 36.2, 0.3, 23.2, 0, 23.3, -1, ashlar, 'Portico entablature cymatium');
    box(g, 37.2, 0.55, 24.2, 0, 23.75, -1, moulding, 'Portico entablature corona');

    // The pediment tympanum is an inset sculpted panel within its moulded frame.
    const tymp = new THREE.Shape();
    tymp.moveTo(-9.6, 0); tymp.lineTo(9.6, 0); tymp.lineTo(0, 4.6); tymp.closePath();
    mesh(g, new THREE.ShapeGeometry(tymp), stone, 0, 23.85, centralFace + 0.24, 'Pediment tympanum panel');
    box(g, 23.0, 0.3, 0.5, 0, 23.62, centralFace + 0.3, moulding, 'Pediment tympanum frame base');

    // Real dormers (lucarne en pavillon style) pierce the front slope of each wing mansard.
    for (const x of wingXs) {
      for (const dx of [-14, 0, 14]) {
        box(g, 1.3, 1.7, 0.32, x + dx, 21.9, facadeZ + 0.55, stone, 'Wing mansard dormer');
        box(g, 0.85, 1.1, 0.36, x + dx, 21.9, facadeZ + 0.58, glass, 'Wing mansard dormer window');
        const dm = new THREE.Shape();
        dm.moveTo(-0.85, 0); dm.lineTo(0.85, 0); dm.lineTo(0, 0.55); dm.closePath();
        mesh(g, new THREE.ShapeGeometry(dm), moulding, x + dx, 22.85, facadeZ + 0.56, 'Wing dormer pediment');
      }
    }

    // Small basement windows (soupiraux) pierce the south avant-corps base on the sloping site.
    for (let i = 0; i < 4; i++) {
      box(g, 1.2, 1.0, 0.2, -9 + i * 6, 1.6, -63.6, glass, 'South avant-corps basement window');
    }

    // Bronze lamp standards with gilded globes flank the perron at the palace entrance.
    for (const side of [-1, 1]) {
      cylinder(g, 0.08, 0.12, 4.2, side * 9.6, 2.1, centralFace + 1.6, bronze, 8).name = 'Perron lamp standard';
      mesh(g, new THREE.SphereGeometry(0.42, 12, 10), gilded, side * 9.6, 4.5, centralFace + 1.6, 'Perron lamp gilded globe');
    }

    // Dressed stone nosing strips edge each perron step of the central entrance.
    for (let s = 0; s < 3; s++) {
      box(g, 17, 0.05, 0.1, 0, 0.95 - s * 0.32, centralFace + 0.61 + s * 0.62, moulding, 'Perron step nosing');
    }

    // Stone surrounds frame the wing end windows, matching the front facade order.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wz = -6 - i * 5;
        box(g, 0.14, 3.6, 2.3, side * 70.12, 12.5, wz, ashlar, 'Wing end window surround');
        box(g, 0.14, 2.8, 2.3, side * 70.12, 6.5, wz, ashlar, 'Wing end ground window surround');
      }
    }

    // Wrought-iron balusters and a mid rail fill the central portico balcony parapet.
    for (let bx = -1.3; bx <= 1.31; bx += 0.26) {
      box(g, 0.05, 0.5, 0.06, bx, 11.28, centralFace + 1.0, bronze, 'Central balcony baluster');
    }
    box(g, 2.9, 0.05, 0.05, 0, 11.3, centralFace + 1.0, bronze, 'Central balcony mid rail');

    // Console brackets carry the central portico balcony slab from the facade.
    for (const bx of [-1.2, 0, 1.2]) {
      box(g, 0.18, 0.55, 0.55, bx, 11.05, centralFace + 0.55, bronze, 'Central balcony console');
    }

    // Console brackets carry each wing first-floor balcony from the facade.
    for (const side of wingXs) {
      for (let k = 0; k < 9; k++) {
        const bx = side - 22 + k * 5.5;
        box(g, 0.16, 0.5, 0.5, bx, 7.6, facadeZ + 0.55, bronze, 'Wing balcony console');
      }
    }

    // The gilded garden railing in front of the palace stands on a stone plinth.
    box(g, 68, 0.22, 0.5, 0, 0.11, 14, ashlar, 'Gilded garden railing plinth');

    // Attic bases and capitals ring each fluted portico column shaft.
    for (let i = 0; i < 6; i++) {
      const x = -12.5 + i * 5;
      for (const z of [centralFace + 1.55, centralFace + 4.1]) {
        cylinder(g, 1.5, 1.6, 0.7, x, 8.55, z, ashlar).name = 'Portico column base';
        cylinder(g, 1.55, 1.45, 0.7, x, 21.5, z, moulding).name = 'Portico column capital';
      }
    }

    // Glazing muntins divide each central piano nobile French door into panes.
    for (let i = 0; i < 5; i++) {
      const x = -10 + i * 5;
      for (const mx of [-0.66, 0, 0.66]) {
        box(g, 0.06, 6.6, 0.05, x + mx, 14.6, centralFace + 0.27, bronze, 'Central French door muntin vertical');
      }
      for (const my of [13.5, 15.7]) {
        box(g, 2.65, 0.06, 0.05, x, my, centralFace + 0.27, bronze, 'Central French door muntin horizontal');
      }
    }

    // Low cheek walls in dressed stone flank both sides of the perron.
    for (const side of [-1, 1]) {
      box(g, 0.8, 1.2, 2.2, side * 8.9, 0.6, centralFace + 1.2, ashlar, 'Perron cheek wall');
    }

    // A straight garden walk leads from the perron to the gilded railing on the axis.
    box(g, 3, 0.08, 3.2, 0, 0.05, 12.4, ashlar, 'Central garden walk');

    // Stone planters with plantings flank the foot of the perron.
    for (const side of [-1, 1]) {
      box(g, 1.6, 1.0, 1.6, side * 9.8, 0.5, centralFace + 0.9, stone, 'Perron planter');
      mesh(g, new THREE.SphereGeometry(0.55, 10, 8), flowerMat, side * 9.8, 1.25, centralFace + 0.9, 'Perron planter planting');
    }

    // Two steps climb from the garden walk up to the portico stylobate.
    for (let s = 0; s < 2; s++) {
      box(g, 32, 0.25, 0.8, 0, 0.125 + s * 0.25, centralFace + 8.6 - s * 0.6, ashlar, 'Portico stylobate step');
    }

    // Square abacus blocks sit atop each portico column capital under the architrave.
    for (let i = 0; i < 6; i++) {
      const x = -12.5 + i * 5;
      for (const z of [centralFace + 1.55, centralFace + 4.1]) {
        box(g, 2.6, 0.35, 2.6, x, 22.0, z, moulding, 'Portico column abacus');
      }
    }

    // Each of the eleven great flower pots stands on a square stone pedestal.
    for (let k = 0; k < 11; k++) {
      const px = -30 + k * 6;
      box(g, 1.3, 0.3, 1.3, px, 0.15, 11.0, stone, 'Flower pot pedestal');
    }

    // A bottom rail completes the gilded garden railing between its posts.
    box(g, 68, 0.05, 0.05, 0, 0.72, 14, gilded, 'Gilded garden railing bottom rail');

    // Stone edging strips border the central garden walk.
    for (const side of [-1, 1]) {
      box(g, 0.3, 0.12, 3.2, side * 1.65, 0.07, 12.4, moulding, 'Central garden walk edging');
    }

    // Flower boxes with plantings hang under the central portico balcony.
    box(g, 2.9, 0.3, 0.5, 0, 10.9, centralFace + 1.1, bronze, 'Central balcony flower box');
    for (const fx of [-1.0, 0, 1.0]) {
      mesh(g, new THREE.SphereGeometry(0.3, 8, 6), flowerMat, fx, 11.15, centralFace + 1.1, 'Central balcony flower box planting');
    }

    // The great ground-floor door stands behind the portico colonnade.
    box(g, 4.0, 7.5, 0.25, 0, 4.1, centralFace + 0.2, shadow, 'Portico main door');

    // Capitals finish the pilasters on both wing end faces.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(g, 0.6, 0.5, 0.6, side * 70.1, 20.2, -3.5 - i * 5, ashlar, 'Wing end pilaster capital');
      }
    }

    // A glazed fanlight crowns the portico main door.
    mesh(g, new THREE.CircleGeometry(1.6, 16, 0, Math.PI), glass, 0, 7.9, centralFace + 0.24, 'Portico door fanlight');

    // Lamp standards with gilded globes flank the gilded garden gates.
    for (const side of [-1, 1]) {
      cylinder(g, 0.06, 0.1, 3.2, side * 6, 1.6, 14, bronze, 8).name = 'Garden gate lamp';
      mesh(g, new THREE.SphereGeometry(0.26, 10, 8), gilded, side * 6, 3.4, 14, 'Garden gate lamp globe');
    }

    // A moulded surround frames the portico main door.
    for (const side of [-1, 1]) {
      box(g, 0.3, 7.5, 0.35, side * 2.15, 4.1, centralFace + 0.22, moulding, 'Portico door jamb');
    }
    box(g, 4.6, 0.3, 0.4, 0, 8.0, centralFace + 0.24, moulding, 'Portico door lintel');

    // Flower boxes with plantings line the wing balconies.
    for (const side of wingXs) {
      for (let k = 0; k < 5; k++) {
        const bx = side - 16 + k * 8;
        box(g, 1.8, 0.28, 0.45, bx, 7.55, facadeZ + 0.85, bronze, 'Wing balcony flower box');
        mesh(g, new THREE.SphereGeometry(0.26, 8, 6), flowerMat, bx, 7.8, facadeZ + 0.85, 'Wing balcony flower box planting');
      }
    }

    // A moulded cap crowns the central balcony rail.
    box(g, 3.2, 0.08, 1.0, 0, 11.56, centralFace + 0.72, moulding, 'Central balcony top cap');

    // Transverse joint bands mark the central garden walk paving.
    for (const jz of [11.4, 12.4, 13.4]) {
      box(g, 3, 0.05, 0.2, 0, 0.1, jz, ashlar, 'Central garden walk joint');
    }

    // Small caps crown the posts of the gilded garden railing.
    for (let px = -33; px <= 33; px += 3) {
      box(g, 0.16, 0.12, 0.16, px, 1.5, 14, gilded, 'Garden railing post cap');
    }

    // Bronze escutcheon plates mark each central French door.
    for (let i = 0; i < 5; i++) {
      box(g, 0.5, 0.7, 0.05, -10 + i * 5, 13.5, centralFace + 0.28, bronze, 'French door escutcheon');
    }

    // A landing slab tops the perron at the foot of the portico.
    box(g, 17, 0.3, 1.0, 0, 1.0, centralFace + 1.1, ashlar, 'Perron top landing');

    // A projecting plinth course bases the palace facade.
    box(g, 141, 0.6, 0.4, 0, 0.3, facadeZ + 0.3, ashlar, 'Facade plinth course');

    // The central balcony rail sits on a stone slab projecting from the facade.
    box(g, 3.2, 0.12, 1.0, 0, 11.38, centralFace + 0.72, ashlar, 'Central balcony slab');

    // A stone threshold spans the gilded garden gate.
    box(g, 8.4, 0.18, 0.6, 0, 0.09, 14, stone, 'Garden gate threshold');

    // Each wing balcony parapet rests on a stone slab projecting from the facade.
    for (const side of wingXs) {
      box(g, wingW, 0.12, 0.8, side, 7.8, facadeZ + 0.7, ashlar, 'Wing balcony slab');
    }

    // A cross of muntins divides the portico door fanlight into panes.
    box(g, 0.08, 3.2, 0.05, 0, 7.9, centralFace + 0.28, bronze, 'Fanlight muntin vertical');
    box(g, 3.2, 0.08, 0.05, 0, 7.9, centralFace + 0.28, bronze, 'Fanlight muntin horizontal');

    // Stone corbels carry the central balcony slab from the facade.
    for (const bx of [-1.2, 0, 1.2]) {
      box(g, 0.22, 0.3, 0.8, bx, 11.2, centralFace + 0.5, ashlar, 'Central balcony corbel');
    }

    // Newel posts finish both ends of each wing balcony rail.
    for (const side of wingXs) {
      for (const e of [-1, 1]) {
        box(g, 0.14, 0.75, 0.14, side + e * (wingW / 2 - 0.3), 8.3, facadeZ + 0.84, bronze, 'Wing balcony end newel');
      }
    }

    // Flanged bases anchor the perron lamp standards on the landing.
    for (const side of [-1, 1]) {
      cylinder(g, 0.2, 0.26, 0.2, side * 9.6, 1.1, centralFace + 1.6, bronze, 8).name = 'Perron lamp base flange';
    }

    // Newel posts finish both ends of the central balcony rail.
    for (const side of [-1, 1]) {
      box(g, 0.12, 0.7, 0.12, side * 1.55, 11.75, centralFace + 1.0, bronze, 'Central balcony end newel');
    }

    // A cap strip crowns each perron side rail.
    for (const side of [-1, 1]) {
      box(g, 0.1, 0.08, 2.0, side * 8.4, 1.22, centralFace + 1.3, bronze, 'Perron side rail cap');
    }

    // Bronze threshold plates span each central French door.
    for (let i = 0; i < 5; i++) {
      box(g, 3.0, 0.1, 0.5, -10 + i * 5, 11.05, centralFace + 0.35, bronze, 'French door threshold');
    }

    // Cap slabs finish both perron cheek walls.
    for (const side of [-1, 1]) {
      box(g, 1.0, 0.12, 2.4, side * 8.9, 1.26, centralFace + 1.2, moulding, 'Perron cheek wall cap');
    }

    // Stone lintels crown the wing end windows on both gable ends.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wz = -6 - i * 5;
        box(g, 0.14, 0.25, 2.3, side * 70.12, 14.35, wz, ashlar, 'Wing end window lintel');
        box(g, 0.14, 0.25, 2.3, side * 70.12, 7.95, wz, ashlar, 'Wing end ground window lintel');
      }
    }

    // Heavier corner posts with gilded finials close the garden railing run.
    for (const side of [-1, 1]) {
      box(g, 0.2, 2.0, 0.2, side * 34, 1.0, 14, gilded, 'Garden railing corner post');
      mesh(g, new THREE.SphereGeometry(0.16, 10, 8), gilded, side * 34, 2.1, 14, 'Garden railing corner post finial');
    }

    // Corner quoins strengthen the facade corners of the palace.
    for (const side of [-1, 1]) {
      for (const qy of [3, 8, 13, 18]) {
        box(g, 0.55, 1.8, 0.4, side * 70.1, qy, facadeZ + 0.25, ashlar, 'Facade corner quoin');
      }
    }

    // Rim stones finish the two perron planters.
    for (const side of [-1, 1]) {
      box(g, 1.8, 0.12, 1.8, side * 9.8, 1.06, centralFace + 0.9, stone, 'Perron planter rim');
    }

    // Short arms carry the gilded globes from the perron lamp standards.
    for (const side of [-1, 1]) {
      box(g, 0.5, 0.06, 0.06, side * 9.6 - side * 0.2, 4.35, centralFace + 1.6, bronze, 'Perron lamp arm');
    }

    // A moulded cap finishes the front edge of the portico stylobate.
    box(g, 31, 0.1, 0.3, 0, 0.68, centralFace + 7.75, moulding, 'Stylobate edge cap');

    // Caps finish the posts of the perron side rails.
    for (const side of [-1, 1]) {
      for (const pz of [0.5, 2.1]) {
        box(g, 0.14, 0.1, 0.14, side * 8.4, 1.25, centralFace + pz, bronze, 'Perron rail post cap');
      }
    }

    // Rim rings finish the eleven great flower pots along the garden walk.
    for (let k = 0; k < 11; k++) {
      const px = -30 + k * 6;
      cylinder(g, 0.62, 0.58, 0.18, px, 0.99, 11.0, potMat, 12).name = 'Flower pot rim';
    }

    // Mullions divide the wing end windows on both gable ends.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wz = -6 - i * 5;
        box(g, 0.06, 3.2, 0.08, side * 70.12, 12.5, wz, ashlar, 'Wing end window mullion');
        box(g, 0.06, 2.4, 0.08, side * 70.12, 6.5, wz, ashlar, 'Wing end ground window mullion');
      }
    }

    // A transom bar crosses each central French door near its head.
    for (let i = 0; i < 5; i++) {
      box(g, 2.65, 0.06, 0.05, -10 + i * 5, 17.2, centralFace + 0.27, bronze, 'Central French door transom bar');
    }

    // Stone sills sit under the wing end windows on both gable ends.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wz = -6 - i * 5;
        box(g, 0.14, 0.2, 2.3, side * 70.12, 10.85, wz, ashlar, 'Wing end window sill');
        box(g, 0.14, 0.2, 2.3, side * 70.12, 5.25, wz, ashlar, 'Wing end ground window sill');
      }
    }

    // Moulded edges finish the sides of each perron step.
    for (let s = 0; s < 3; s++) {
      for (const side of [-1, 1]) {
        box(g, 0.15, 0.32, 0.62, side * 8.5, 0.79 - s * 0.32, centralFace + 0.3 + s * 0.62, moulding, 'Perron step edge');
      }
    }

    // Glazed side lights flank the central door behind the portico colonnade.
    for (const side of [-1, 1]) {
      box(g, 1.2, 6.6, 0.18, side * 3.3, 14.6, centralFace + 0.16, glass, 'Portico door side light');
    }

    // Dark soil fills the two perron planters beneath the plantings.
    for (const side of [-1, 1]) {
      box(g, 1.4, 0.06, 1.4, side * 9.8, 1.03, centralFace + 0.9, shadow, 'Perron planter soil');
    }

    // Collar rings decorate the perron lamp standards.
    for (const side of [-1, 1]) {
      cylinder(g, 0.14, 0.17, 0.3, side * 9.6, 2.4, centralFace + 1.6, bronze, 8).name = 'Perron lamp collar';
    }

    // Stone sills sit under the portico door side lights.
    for (const side of [-1, 1]) {
      box(g, 1.5, 0.18, 0.4, side * 3.3, 11.2, centralFace + 0.3, moulding, 'Portico side light sill');
    }

    // Mullions divide the portico door side lights.
    for (const side of [-1, 1]) {
      box(g, 0.06, 6.6, 0.05, side * 3.3, 14.6, centralFace + 0.24, bronze, 'Portico side light mullion');
    }

    // Cap strips crown the wing balcony rails.
    for (const side of wingXs) {
      box(g, wingW, 0.06, 0.62, side, 8.0, facadeZ + 0.62, bronze, 'Wing balcony rail cap');
    }

    // Bases finish the pilasters on both wing end faces.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(g, 0.6, 0.6, 0.6, side * 70.1, 0.3, -3.5 - i * 5, ashlar, 'Wing end pilaster base');
      }
    }

    // Flower bands border the central garden walk.
    for (const side of [-1, 1]) {
      box(g, 0.5, 0.08, 3.2, side * 1.9, 0.1, 12.4, flowerMat, 'Garden walk flower band');
    }

    // Return caps close the ends of the stylobate edge cap.
    for (const side of [-1, 1]) {
      box(g, 0.3, 0.1, 1.4, side * 15.5, 0.68, centralFace + 7.75, moulding, 'Stylobate edge cap return');
    }

    // A kerb closes the garden walk at the gilded railing.
    box(g, 3.6, 0.14, 0.3, 0, 0.08, 14.1, ashlar, 'Garden walk end kerb');

    // A leaf split bar divides the portico main door into two leaves.
    box(g, 0.08, 7.5, 0.06, 0, 4.1, centralFace + 0.26, bronze, 'Portico door leaf split');

    // A moulded edge finishes the front of each wing balcony slab.
    for (const side of wingXs) {
      box(g, wingW, 0.1, 0.15, side, 7.86, facadeZ + 1.08, moulding, 'Wing balcony slab edge');
    }

    // Low walls border the central garden walk.
    for (const side of [-1, 1]) {
      box(g, 0.25, 0.5, 3.2, side * 2.1, 0.25, 12.4, ashlar, 'Garden walk low wall');
    }

    // A base rail joins the feet of the central balcony balusters.
    box(g, 2.9, 0.06, 0.06, 0, 11.05, centralFace + 1.0, bronze, 'Central balcony base rail');

    // Hinge straps secure the portico main door leaves.
    for (const hy of [1.5, 4.1, 6.7]) {
      box(g, 0.4, 0.12, 0.08, -1.9, hy, centralFace + 0.28, bronze, 'Portico door hinge');
    }

    // A cap finishes the plinth of the gilded garden railing.
    box(g, 68, 0.06, 0.56, 0, 0.25, 14, moulding, 'Garden railing plinth cap');

    // Corbels carry each wing balcony slab from the facade.
    for (const side of wingXs) {
      for (let k = 0; k < 7; k++) {
        box(g, 0.18, 0.4, 0.5, side - 21 + k * 7, 7.5, facadeZ + 0.5, bronze, 'Wing balcony corbel');
      }
    }

    // A moulded edge finishes the front of the central balcony slab.
    box(g, 3.2, 0.08, 0.14, 0, 11.44, centralFace + 1.2, moulding, 'Central balcony slab edge');

    // A moulding closes the underside of the central balcony slab.
    box(g, 3.0, 0.08, 0.9, 0, 11.28, centralFace + 0.72, moulding, 'Central balcony underside moulding');

    // Shoes anchor the perron side rail posts to the ground.
    for (const side of [-1, 1]) {
      for (const pz of [0.5, 2.1]) {
        box(g, 0.14, 0.1, 0.14, side * 8.4, 0.05, centralFace + pz, bronze, 'Perron rail post shoe');
      }
    }

    // Brackets carry the wing balcony flower boxes.
    for (const side of wingXs) {
      for (let k = 0; k < 5; k++) {
        const bx = side - 16 + k * 8;
        box(g, 0.15, 0.2, 0.4, bx, 7.35, facadeZ + 0.85, bronze, 'Wing flower box bracket');
      }
    }

    // Brackets carry the central balcony flower box.
    for (const fx of [-1.0, 0, 1.0]) {
      box(g, 0.15, 0.2, 0.45, fx, 10.7, centralFace + 1.1, bronze, 'Central flower box bracket');
    }

    // A bed moulding sits between the portico architrave and cornice.
    box(g, 37, 0.1, 5.0, 0, 23.33, centralFace + 2.9, moulding, 'Portico architrave bed moulding');

    // Mid rails run between the wing balcony balusters.
    for (const side of wingXs) {
      box(g, wingW, 0.05, 0.05, side, 7.7, facadeZ + 0.84, bronze, 'Wing balcony mid rail');
    }

    // Lintels crown the portico door side lights.
    for (const side of [-1, 1]) {
      box(g, 1.5, 0.2, 0.4, side * 3.3, 18.0, centralFace + 0.3, moulding, 'Portico side light lintel');
    }

    // Dark soil fills the wing balcony flower boxes.
    for (const side of wingXs) {
      for (let k = 0; k < 5; k++) {
        const bx = side - 16 + k * 8;
        box(g, 1.6, 0.06, 0.35, bx, 7.72, facadeZ + 0.85, shadow, 'Wing flower box soil');
      }
    }

    // Dark soil fills the central balcony flower box.
    box(g, 2.7, 0.06, 0.4, 0, 11.08, centralFace + 1.1, shadow, 'Central flower box soil');

    // Bottom rails join the feet of the wing balcony balusters.
    for (const side of wingXs) {
      box(g, wingW, 0.05, 0.05, side, 7.45, facadeZ + 0.84, bronze, 'Wing balcony bottom rail');
    }

    // A bronze kick plate protects the foot of the portico main door.
    box(g, 3.8, 0.5, 0.06, 0, 0.4, centralFace + 0.26, bronze, 'Portico door kick plate');

    // Gilded balls crown the perron side rail posts.
    for (const side of [-1, 1]) {
      for (const pz of [0.5, 2.1]) {
        mesh(g, new THREE.SphereGeometry(0.1, 10, 8), gilded, side * 8.4, 1.32, centralFace + pz, 'Perron rail post ball');
      }
    }

    // Cap strips finish the wing balcony corbels.
    for (const side of wingXs) {
      for (let k = 0; k < 7; k++) {
        box(g, 0.22, 0.1, 0.55, side - 21 + k * 7, 7.72, facadeZ + 0.5, bronze, 'Wing balcony corbel cap');
      }
    }

    // A rim finishes the central balcony flower box.
    box(g, 3.0, 0.08, 0.55, 0, 11.1, centralFace + 1.1, bronze, 'Central flower box rim');

    // Rims finish the wing balcony flower boxes.
    for (const side of wingXs) {
      for (let k = 0; k < 5; k++) {
        const bx = side - 16 + k * 8;
        box(g, 1.8, 0.07, 0.45, bx, 7.74, facadeZ + 0.85, bronze, 'Wing flower box rim');
      }
    }

    // A nosing strip edges the front stylobate step.
    box(g, 32, 0.05, 0.1, 0, 0.28, centralFace + 9.0, moulding, 'Stylobate step nosing');

    // A sill bar closes the foot of the portico door fanlight.
    box(g, 3.4, 0.06, 0.15, 0, 7.85, centralFace + 0.28, moulding, 'Fanlight sill bar');

    // A contrasting sett line runs down the centre of the garden walk.
    box(g, 0.3, 0.06, 3.2, 0, 0.09, 12.4, moulding, 'Garden walk centre sett line');

    // A bronze threshold plate spans the portico main door.
    box(g, 4.4, 0.08, 0.5, 0, 0.12, centralFace + 0.35, bronze, 'Portico door threshold plate');

    // Scroll ends finish both ends of the central balcony rail.
    for (const side of [-1, 1]) {
      mesh(g, new THREE.SphereGeometry(0.12, 10, 8), bronze, side * 1.45, 11.5, centralFace + 1.0, 'Central balcony scroll end');
    }

    // Scroll ends finish both ends of each wing balcony rail.
    for (const side of wingXs) {
      for (const e of [-1, 1]) {
        mesh(g, new THREE.SphereGeometry(0.12, 10, 8), bronze, side + e * (wingW / 2 - 0.2), 8.0, facadeZ + 0.84, 'Wing balcony scroll end');
      }
    }

    // Cap slabs finish the low walls bordering the central garden walk.
    for (const side of [-1, 1]) {
      box(g, 0.35, 0.08, 3.3, side * 2.1, 0.54, 12.4, moulding, 'Garden walk wall cap');
    }

    // A moulded edge finishes the front of the perron top landing.
    box(g, 17, 0.08, 0.12, 0, 1.12, centralFace + 1.58, moulding, 'Perron landing edge');

    // End blocks close both ends of the portico architrave beam.
    for (const side of [-1, 1]) {
      box(g, 0.5, 1.05, 4.8, side * 18.5, 22.78, centralFace + 2.9, ashlar, 'Architrave end block');
    }

    // End blocks close both ends of the portico frieze triglyph run.
    for (const side of [-1, 1]) {
      box(g, 0.5, 0.6, 0.2, side * 18.2, 22.95, centralFace + 4.5, moulding, 'Triglyph end block');
    }

    // Stone bases anchor the end posts of the gilded garden railing.
    for (const side of [-1, 1]) {
      box(g, 0.3, 0.3, 0.3, side * 34, 0.15, 14, ashlar, 'Garden railing end post base');
    }

    // Side caps close the ends of the portico stylobate edge.
    for (const side of [-1, 1]) {
      box(g, 0.3, 0.12, 10.3, side * 16, 0.56, centralFace + 2.6, moulding, 'Stylobate side cap');
    }

    // Cap slabs finish the central balcony corbels.
    for (const bx of [-1.2, 0, 1.2]) {
      box(g, 0.26, 0.08, 0.85, bx, 11.32, centralFace + 0.5, ashlar, 'Central balcony corbel cap');
    }

    // A mid post stiffens each perron side rail.
    for (const side of [-1, 1]) {
      box(g, 0.12, 0.9, 0.12, side * 8.4, 0.75, centralFace + 1.3, bronze, 'Perron rail mid post');
    }

    // Caps finish the perron side rail mid posts.
    for (const side of [-1, 1]) {
      box(g, 0.16, 0.08, 0.16, side * 8.4, 1.24, centralFace + 1.3, bronze, 'Perron mid post cap');
    }

    // Side caps close the ends of the front stylobate step.
    for (const side of [-1, 1]) {
      box(g, 0.3, 0.25, 0.8, side * 16, 0.125, centralFace + 8.6, moulding, 'Stylobate step side cap');
    }

    // Rings cage the gilded globes of the perron lamps.
    for (const side of [-1, 1]) {
      cylinder(g, 0.3, 0.3, 0.06, side * 9.6, 4.5, centralFace + 1.6, bronze, 10).name = 'Perron lamp globe ring';
    }

    // Balls finish the ends of the wing balcony rail caps.
    for (const side of wingXs) {
      for (const e of [-1, 1]) {
        mesh(g, new THREE.SphereGeometry(0.1, 10, 8), bronze, side + e * (wingW / 2 - 0.1), 8.05, facadeZ + 0.62, 'Wing balcony rail end ball');
      }
    }

    // Plinths base both perron cheek walls.
    for (const side of [-1, 1]) {
      box(g, 1.0, 0.25, 2.4, side * 8.9, 0.12, centralFace + 1.2, ashlar, 'Perron cheek wall base');
    }

    // Plinths anchor the perron lamp standard flanges.
    for (const side of [-1, 1]) {
      box(g, 0.4, 0.15, 0.4, side * 9.6, 1.02, centralFace + 1.6, ashlar, 'Perron lamp base plinth');
    }

    // Cap slabs finish the perron lamp base plinths.
    for (const side of [-1, 1]) {
      box(g, 0.46, 0.06, 0.46, side * 9.6, 1.13, centralFace + 1.6, moulding, 'Perron lamp plinth cap');
    }

    // Finials crown the perron lamp standards above the globes.
    for (const side of [-1, 1]) {
      cylinder(g, 0.03, 0.06, 0.3, side * 9.6, 4.95, centralFace + 1.6, bronze, 8).name = 'Perron lamp finial';
    }

    // Border posts mark the start of the central garden walk at the perron.
    for (const side of [-1, 1]) {
      box(g, 0.18, 0.6, 0.18, side * 2.1, 0.7, 10.9, ashlar, 'Garden walk border post');
    }
  });
  addLandmark('palaceSurroundings', (g) => {
    // Real-world sources: en/fr Wikipedia (Royal Palace of Brussels, Brussels Park, Place des Palais,
    // Academy Palace, BELvue, Palace of the Nation, Royal Park Theatre, equestrian statue of Leopold II,
    // Parc metro, Rue de la Loi) and monument.heritage.brussels inventories 30402 / 30098 / 10001113 / 10001073.
    // Brussels Park (Parc de Bruxelles): the rectangular 13.1 ha neoclassical park north of the
    // Place des Palais, laid out 1776-83 by Guimard and Zinner around the palace-parliament axis.
    box(g, 344, 0.24, 340, 0, 0.0, 232, materials.green, 'Brussels Park lawn');
    // A central avenue leads to the main pond from the palace axis (Wikipedia, Brussels Park).
    box(g, 12, 0.08, 176, 0, 0.06, 150, materials.pavingA, 'Park central avenue to the main pond');
    // The main water basin with its fountain was constructed in 1855 at the end of the central avenue.
    const parkWater = new THREE.MeshStandardMaterial({ color: 0x3d6b7a, roughness: 0.25, metalness: 0.1 });
    cylinder(g, 16, 16.6, 1.0, 0, 0.5, 150, materials.paleStone, 28).name = 'Park main pond rim';
    cylinder(g, 15.4, 15.4, 0.5, 0, 0.55, 150, parkWater, 28).name = 'Park main pond water';
    cylinder(g, 0.22, 0.55, 6.5, 0, 3.4, 150, parkWater, 10).name = 'Park main fountain jet';
    mesh(g, new THREE.ConeGeometry(1.6, 2.2, 10), parkWater, 0, 6.6, 150, 'Park main fountain spray');
    // The octagonal basin (1780) ringed by eight busts of Hermes stands north of the main pond on the axis.
    cylinder(g, 13, 13.6, 0.9, 0, 0.45, 262, materials.paleStone, 8).name = 'Park octagonal basin rim';
    cylinder(g, 12.4, 12.4, 0.4, 0, 0.5, 262, parkWater, 8).name = 'Park octagonal basin water';
    for (let hk = 0; hk < 8; hk++) {
      const ha = hk * Math.PI / 4;
      mesh(g, new THREE.SphereGeometry(0.5, 10, 8), materials.paleStone, Math.cos(ha) * 13.6, 1.5, 262 + Math.sin(ha) * 13.6, 'Park Hermes bust');
    }
    // Two bandstands: the ornate twelve-sided cast-iron kiosk by Cluysenaar (1841) and the Vauxhall
    // bandstand rebuilt in neo-Moorish style (1913) host the park's summer concerts.
    cylinder(g, 6.2, 6.8, 0.5, -46, 0.25, 150, materials.paleStone, 12).name = 'Park main bandstand base';
    cylinder(g, 3.4, 3.8, 4.2, -46, 2.6, 150, materials.dark, 12).name = 'Park main bandstand kiosk';
    mesh(g, new THREE.ConeGeometry(4.6, 2.4, 12), materials.roof, -46, 6.0, 150, 'Park main bandstand roof');
    cylinder(g, 5.4, 6.0, 0.5, 46, 0.25, 210, materials.paleStone, 8).name = 'Park Vauxhall bandstand base';
    cylinder(g, 3.0, 3.4, 3.8, 46, 2.4, 210, materials.dark, 8).name = 'Park Vauxhall bandstand kiosk';
    mesh(g, new THREE.ConeGeometry(4.0, 2.6, 8), materials.roof, 46, 5.5, 210, 'Park Vauxhall bandstand dome');
    // Monumental neoclassical railings enclose the park; they were only erected in 1849 to
    // designs by Tilman-Francois Suys, with main gates on the central axis south and north.
    const railGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12);
    const parkRail = new THREE.InstancedMesh(railGeo, materials.dark, 600);
    const prd = new THREE.Object3D();
    let pri = 0;
    for (let rx = -172; rx <= 172; rx += 2.4) {
      for (const rz of [62, 402]) {
        prd.position.set(rx, 0.55, rz); prd.rotation.y = 0; prd.updateMatrix();
        parkRail.setMatrixAt(pri++, prd.matrix);
      }
    }
    for (let rz = 64.4; rz <= 400; rz += 2.4) {
      for (const rx of [-172, 172]) {
        prd.position.set(rx, 0.55, rz); prd.updateMatrix();
        parkRail.setMatrixAt(pri++, prd.matrix);
      }
    }
    parkRail.count = pri;
    parkRail.name = 'Park perimeter railing posts';
    g.add(parkRail);
    box(g, 344, 0.1, 0.3, 0, 1.15, 62, materials.dark, 'Park south railing top rail');
    box(g, 344, 0.1, 0.3, 0, 1.15, 402, materials.dark, 'Park north railing top rail');
    box(g, 0.3, 0.1, 340, -172, 1.15, 232, materials.dark, 'Park west railing top rail');
    box(g, 0.3, 0.1, 340, 172, 1.15, 232, materials.dark, 'Park east railing top rail');
    for (const gz of [62, 402]) {
      for (const gx of [-6, 6]) {
        box(g, 1.2, 3.2, 0.4, gx, 1.6, gz, materials.paleStone, 'Park main gate pier');
      }
      box(g, 14, 0.5, 0.5, 0, 3.4, gz, materials.dark, 'Park axis gate lintel');
    }
    // Around sixty sculptures, mostly Greco-Roman mythology moved from the Tervuren park, stand in the park.
    const statGeo = new THREE.CylinderGeometry(0.55, 0.75, 1.6, 8);
    const figGeo = new THREE.SphereGeometry(0.55, 10, 8);
    const statues = new THREE.InstancedMesh(statGeo, materials.paleStone, 60);
    const figs = new THREE.InstancedMesh(figGeo, materials.paleStone, 60);
    const std = new THREE.Object3D();
    let sti = 0;
    for (let i = 0; i < 60; i++) {
      const sx = -150 + (i % 10) * 33.3;
      const sz = 84 + Math.floor(i / 10) * 31;
      std.position.set(sx, 0.8, sz); std.rotation.y = 0; std.updateMatrix();
      statues.setMatrixAt(sti, std.matrix);
      std.position.set(sx, 2.05, sz); std.updateMatrix();
      figs.setMatrixAt(sti, std.matrix);
      sti++;
    }
    statues.count = sti; statues.name = 'Park statue pedestals'; g.add(statues);
    figs.count = sti; figs.name = 'Park statue figures'; g.add(figs);
    // From the main pond, three other avenues radiate to long views (Palace of Justice, Royal
    // Palace, Place du Trone) — the star-shaped alley pattern of the neoclassical park.
    for (const ra of [Math.PI * 0.72, Math.PI * 0.28, Math.PI / 2]) {
      const avLen = 120;
      const av = box(g, 8, 0.07, avLen, Math.cos(ra) * avLen / 2, 0.07, 150 + Math.sin(ra) * avLen / 2, materials.pavingA, 'Park radiating avenue');
      av.rotation.y = Math.PI / 2 - ra;
    }
    // Tree-lined avenues: rows of trees flank the central walk (thousands were replanted 1776-83).
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 3.2, 6);
    const canGeo = new THREE.SphereGeometry(1.9, 8, 6);
    const trunks = new THREE.InstancedMesh(trunkGeo, materials.dark, 44);
    const cans = new THREE.InstancedMesh(canGeo, materials.green, 44);
    const trd = new THREE.Object3D();
    let tri2 = 0;
    for (let tz = 70; tz <= 390; tz += 16) {
      for (const tx of [-9, 9]) {
        trd.position.set(tx, 1.6, tz); trd.rotation.y = 0; trd.updateMatrix();
        trunks.setMatrixAt(tri2, trd.matrix);
        trd.position.set(tx, 4.2, tz); trd.updateMatrix();
        cans.setMatrixAt(tri2, trd.matrix);
        tri2++;
      }
    }
    trunks.count = tri2; trunks.name = 'Park avenue tree trunks'; g.add(trunks);
    cans.count = tri2; cans.name = 'Park avenue tree canopies'; g.add(cans);
    // Two shallows (bas-fonds) remain on the palace side of the park — the old Koperbeek
    // lowlands that were never fully levelled when the square was widened in 1904.
    box(g, 60, 0.1, 26, -70, -0.06, 76, materials.pavingA, 'Park west shallow (bas-fond)');
    box(g, 60, 0.1, 26, 70, -0.06, 76, materials.pavingA, 'Park east shallow (bas-fond)');
    // The Academy Palace (Palais des Academies) closes the EAST end of the Place des Palais,
    // built 1823-28 for the Prince of Orange by Vander Straeten and Suys: 15 bays, bossaged
    // ground floor, Ionic pilasters, modillion cornice, attic and a columned portico.
    box(g, 64, 18, 30, -168, 9, 36, materials.paleStone, 'Academy Palace main block');
    box(g, 66, 1.0, 32, -168, 18.5, 36, materials.warmStone, 'Academy Palace cornice');
    box(g, 66, 3.0, 32.4, -168, 20.5, 36, materials.paleStone, 'Academy Palace attic');
    for (let i = 0; i < 4; i++) {
      cylinder(g, 0.7, 0.85, 12, -174 + i * 4, 6, 19.5, materials.paleStone, 12).name = 'Academy Palace portico column';
    }
    const apPed = new THREE.Shape();
    apPed.moveTo(-8, 0); apPed.lineTo(8, 0); apPed.lineTo(0, 3.4); apPed.closePath();
    mesh(g, new THREE.ShapeGeometry(apPed), materials.warmStone, -168, 12.2, 19.6, 'Academy Palace portico pediment');
    for (let i = 0; i < 7; i++) {
      const wx = -168 - 24 + i * 8;
      box(g, 2.2, 6.5, 0.2, wx, 11, 20.9, materials.glass, 'Academy Palace first-floor window');
      box(g, 2.2, 4.5, 0.2, wx, 5, 20.9, materials.glass, 'Academy Palace ground arched window');
      box(g, 2.6, 0.24, 0.3, wx, 14.3, 20.9, materials.warmStone, 'Academy Palace window lintel');
    }
    for (let i = 0; i < 8; i++) {
      box(g, 0.5, 18, 0.4, -168 - 28 + i * 8, 9, 21.1, materials.warmStone, 'Academy Palace Ionic pilaster');
    }
    // The Academy Palace garden holds its statues: Quetelet, the Stas monument (Vinçotte with a
    // Horta pedestal), Jules Destrée, Caïn maudit, the Discobole and La Surprise.
    const agStat = ['Quetelet statue', 'Stas monument', 'Destrée statue', 'Cain maudit statue', 'Discobole statue', 'La Surprise statue'];
    for (let i = 0; i < agStat.length; i++) {
      const gx = -196 + i * 10;
      box(g, 1.6, 1.4, 1.6, gx, 0.7, 64, materials.paleStone, 'Academy garden pedestal');
      mesh(g, new THREE.SphereGeometry(0.6, 10, 8), materials.paleStone, gx, 2.2, 64, agStat[i]);
    }
    // The former Hôtel Belle-Vue (now the BELvue museum) closes the WEST end of the square —
    // a corner pavilion built 1776-77 by Philippe de Proft as a luxury hotel, five levels tall.
    box(g, 36, 22, 28, 168, 11, 36, materials.paleStone, 'BELvue Hôtel Belle-Vue block');
    box(g, 38, 1.0, 30, 168, 22.5, 36, materials.warmStone, 'BELvue cornice');
    mesh(g, new THREE.ConeGeometry(20, 6, 4), materials.roof, 168, 27, 36, 'BELvue pavilion roof');
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 2.0, 4.2, 0.2, wx, 15, 22.1, materials.glass, 'BELvue piano nobile window');
      box(g, 2.0, 3.2, 0.2, wx, 7.5, 22.1, materials.glass, 'BELvue ground window');
      box(g, 2.0, 3.6, 0.2, wx, 20, 22.1, materials.glass, 'BELvue attic window');
    }
    // The square is 70 x 350 m and entirely paved: extend the blue-stone sett fields to the
    // full width beyond the palace apron, up to the Academy Palace and the BELvue.
    box(g, 90, 0.3, 44, -130, -0.15, 36, materials.pavingEdge, 'Place des Palais west sett field');
    box(g, 90, 0.3, 44, 130, -0.15, 36, materials.pavingEdge, 'Place des Palais east sett field');
    const sett2Geo = new THREE.BoxGeometry(0.9, 0.07, 0.9);
    const setts2 = new THREE.InstancedMesh(sett2Geo, materials.pavingB, 30 * 44 * 2);
    const sd2 = new THREE.Object3D();
    let si2 = 0;
    for (const side of [-1, 1]) {
      for (let row = 0; row < 44; row++) {
        for (let col = 0; col < 30; col++) {
          sd2.position.set(side * (86 + col * 2.9 + (row % 2) * 0.3), -0.02, 15 + row * 0.95);
          sd2.updateMatrix();
          setts2.setMatrixAt(si2++, sd2.matrix);
        }
      }
    }
    setts2.count = si2;
    setts2.name = 'Place des Palais full-width sett paving';
    setts2.receiveShadow = true;
    g.add(setts2);
    // Across the park, on the same axis, stands the Palace of the Nation (Belgian Federal
    // Parliament) — Guimard's 1778-83 neoclassical palace facing the Royal Palace.
    box(g, 60, 22, 34, 0, 11, 420, materials.plaster, 'Palace of the Nation central block');
    box(g, 40, 16, 26, -70, 8, 420, materials.plaster, 'Palace of the Nation west wing');
    box(g, 40, 16, 26, 70, 8, 420, materials.plaster, 'Palace of the Nation east wing');
    box(g, 62, 1.2, 36, 0, 22.6, 420, materials.warmStone, 'Palace of the Nation cornice');
    for (let i = 0; i < 8; i++) {
      cylinder(g, 0.75, 0.9, 15, -24 + i * 6.85, 7.5, 401.5, materials.plaster, 12).name = 'Palace of the Nation peristyle column';
    }
    const pnPed = new THREE.Shape();
    pnPed.moveTo(-16, 0); pnPed.lineTo(16, 0); pnPed.lineTo(0, 5); pnPed.closePath();
    mesh(g, new THREE.ShapeGeometry(pnPed), materials.warmStone, 0, 15.2, 401.6, 'Palace of the Nation pediment');
    mesh(g, new THREE.SphereGeometry(1.0, 14, 10), materials.warmStone, 0, 18.6, 401.9, 'Palace of the Nation Justice relief');
    for (let i = 0; i < 6; i++) {
      box(g, 2.4, 8, 0.2, -22.5 + i * 9, 12, 402.9, materials.glass, 'Palace of the Nation facade window');
    }
    // The pediment carries Godecharle's bas-relief of Justice punishing Vices and rewarding
    // Virtues; the attic of the Palace of the Nation is crowned by a balustrade.
    for (const fx of [-6, 6]) {
      mesh(g, new THREE.SphereGeometry(0.7, 12, 10), materials.warmStone, fx, 17.6, 401.9, 'Palace of the Nation pediment relief figure');
    }
    const pnBal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1.0, 0.3), materials.plaster, 40);
    const pnd = new THREE.Object3D();
    let pni = 0;
    for (let bx = -30; bx <= 30; bx += 3) {
      pnd.position.set(bx, 23.7, 403.2); pnd.rotation.y = 0; pnd.updateMatrix();
      pnBal.setMatrixAt(pni++, pnd.matrix);
    }
    pnBal.count = pni; pnBal.name = 'Palace of the Nation attic balustrade'; g.add(pnBal);
    box(g, 62, 0.16, 0.5, 0, 24.25, 403.2, materials.warmStone, 'Palace of the Nation balustrade rail');
    // The Royal Stables (Écuries royales) stand south-east of the palace by the Rue Ducale,
    // a few tens of metres from the equestrian statue of Leopold II on the Place du Trône.
    box(g, 46, 12, 24, -70, 6, -85, materials.ochre, 'Royal Stables main range');
    box(g, 48, 0.9, 26, -70, 12.5, -85, materials.warmStone, 'Royal Stables cornice');
    mesh(g, new THREE.ConeGeometry(26, 5, 4), materials.roof, -70, 16.5, -85, 'Royal Stables hipped roof');
    for (let i = 0; i < 5; i++) {
      box(g, 2.4, 5, 0.2, -70 - 16 + i * 8, 6, -72.9, materials.glass, 'Royal Stables arched window');
    }
    // The equestrian statue of Leopold II (Vinçotte 1914, finalised 1926 by Malfait) stands on
    // the Place du Trône, south-east of the palace, on a rectangular blue-stone pedestal with a
    // Latin dedication: "LEOPOLDO II / REGI BELGARUM / 1865-1909 / PATRIA MEMOR".
    box(g, 6, 5, 6, -120, 2.5, -60, materials.pavingB, 'Leopold II statue pedestal');
    cylinder(g, 1.1, 1.4, 6.5, -120, 8.2, -60, materials.bronze, 10).name = 'Leopold II equestrian horse';
    mesh(g, new THREE.SphereGeometry(0.8, 10, 8), materials.bronze, -120, 12.2, -60, 'Leopold II equestrian rider');
    box(g, 3.2, 0.2, 2.0, -120, 3.4, -56.9, materials.bronze, 'Leopold II pedestal dedication plaque');
    // The Place du Trône got three parterres and a monumental fence with an entrance to the
    // palace park in 1868-69, to a design by Alphonse Balat (heritage inventory 10001113).
    for (const px of [-132, -120, -108]) {
      box(g, 14, 0.5, 14, px, 0.25, -72, materials.green, 'Place du Trône parterre bed');
      box(g, 14.6, 0.18, 14.6, px, 0.52, -72, materials.pavingEdge, 'Place du Trône parterre edging');
    }
    box(g, 60, 0.3, 40, -120, -0.1, -60, materials.pavingEdge, 'Place du Trône paving');
    // The park is framed by its four thoroughfares: the Place des Palais to the south, the
    // Rue Royale to the west, the Rue de la Loi to the north and the Rue Ducale to the east.
    box(g, 344, 0.06, 14, 0, 0.03, 411, materials.pavingA, 'Rue de la Loi street strip');
    box(g, 14, 0.06, 340, -181, 0.03, 232, materials.pavingA, 'Rue Royale street strip');
    box(g, 14, 0.06, 340, 181, 0.03, 232, materials.pavingA, 'Rue Ducale street strip');
    // The Royal Park Theatre (Théâtre royal du Parc, built 1782 on the Vaux-Hall site) stands at
    // 3 Rue de la Loi, on the park's northern edge, facing the Palace of the Nation.
    box(g, 30, 16, 20, -60, 8, 404, materials.paleStone, 'Royal Park Theatre block');
    box(g, 32, 0.9, 22, -60, 16.5, 404, materials.warmStone, 'Royal Park Theatre cornice');
    for (let i = 0; i < 4; i++) {
      box(g, 2.6, 7, 0.2, -60 - 10.5 + i * 7, 9, 414.1, materials.glass, 'Royal Park Theatre facade window');
    }
    box(g, 4.5, 6, 0.4, -60, 5, 414.2, materials.dark, 'Royal Park Theatre entrance door');
    // The southern entrance to the park's central path was designed by Joseph Poelaert in
    // 1857 (built 1858, moved further north in 1904-08): a pedimented gatehouse on the axis.
    box(g, 16, 0.8, 1.2, 0, 3.7, 62, materials.paleStone, 'Poelaert south gate entablature');
    const pgPed = new THREE.Shape();
    pgPed.moveTo(-8, 0); pgPed.lineTo(8, 0); pgPed.lineTo(0, 1.8); pgPed.closePath();
    mesh(g, new THREE.ShapeGeometry(pgPed), materials.warmStone, 0, 4.1, 62, 'Poelaert south gate pediment');
    // In the 1930s the park was fitted with Art Deco lampposts along its avenues.
    const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.13, 4.6, 6), materials.dark, 26);
    const lampHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 10, 8), materials.gold, 26);
    const lpd = new THREE.Object3D();
    let lpi = 0;
    for (let lz = 70; lz <= 390; lz += 32) {
      for (const lx of [-7, 7]) {
        lpd.position.set(lx, 2.3, lz); lpd.rotation.y = 0; lpd.updateMatrix();
        lampPole.setMatrixAt(lpi, lpd.matrix);
        lpd.position.set(lx, 4.8, lz); lpd.updateMatrix();
        lampHead.setMatrixAt(lpi, lpd.matrix);
        lpi++;
      }
    }
    lampPole.count = lpi; lampPole.name = 'Park Art Deco lamppost poles'; g.add(lampPole);
    lampHead.count = lpi; lampHead.name = 'Park Art Deco lamp heads'; g.add(lampHead);
    // Since the 19th century the park has been surrounded by a double row of lime trees,
    // emphasising the perspectives on either side.
    const limeTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.24, 0.32, 3.4, 6), materials.dark, 100);
    const limeCan = new THREE.InstancedMesh(new THREE.SphereGeometry(2.2, 8, 6), materials.green, 100);
    const ltd = new THREE.Object3D();
    let lti = 0;
    for (let lx = -164; lx <= 164; lx += 16) {
      for (const lz of [68, 396]) {
        ltd.position.set(lx, 1.7, lz); ltd.rotation.y = 0; ltd.updateMatrix();
        limeTrunk.setMatrixAt(lti, ltd.matrix);
        ltd.position.set(lx, 4.4, lz); ltd.updateMatrix();
        limeCan.setMatrixAt(lti, ltd.matrix);
        lti++;
      }
    }
    for (let lz = 84; lz <= 380; lz += 16) {
      for (const lx of [-164, 164]) {
        ltd.position.set(lx, 1.7, lz); ltd.updateMatrix();
        limeTrunk.setMatrixAt(lti, ltd.matrix);
        ltd.position.set(lx, 4.4, lz); ltd.updateMatrix();
        limeCan.setMatrixAt(lti, ltd.matrix);
        lti++;
      }
    }
    limeTrunk.count = lti; limeTrunk.name = 'Park perimeter lime trunks'; g.add(limeTrunk);
    limeCan.count = lti; limeCan.name = 'Park perimeter lime canopies'; g.add(limeCan);
    // In the 1960s an entrance was built in the park's north-western corner for the
    // underground Parc/Park metro station (lines 1 and 5).
    box(g, 10, 1.2, 6, -168, 0.6, 398, materials.paleStone, 'Parc metro entrance pavilion base');
    box(g, 12, 0.25, 7, -168, 3.2, 398, materials.glass, 'Parc metro entrance canopy');
    for (const cx of [-172.5, -163.5]) {
      box(g, 0.4, 3.1, 0.4, cx, 1.55, 398, materials.dark, 'Parc metro entrance canopy post');
    }
    // The Hôtel de la Liste Civile stands at the EAST end of the palace frontage, attached to
    // the curved gallery (rebuilt by Octave Flanneau after 1920).
    box(g, 30, 15, 24, -112, 7.5, 36, materials.paleStone, 'Hôtel de la Liste Civile block');
    box(g, 32, 0.9, 26, -112, 15.5, 36, materials.warmStone, 'Liste Civile cornice');
    mesh(g, new THREE.ConeGeometry(18, 4.5, 4), materials.roof, -112, 19, 36, 'Liste Civile hipped roof');
    for (let i = 0; i < 4; i++) {
      const wx = -112 - 10.5 + i * 7;
      box(g, 2.0, 4.0, 0.2, wx, 9, 24.1, materials.glass, 'Liste Civile piano nobile window');
      box(g, 2.0, 3.0, 0.2, wx, 4.5, 24.1, materials.glass, 'Liste Civile ground window');
    }
    // The Academy Palace lateral avant-corps project with double pilasters and pedimented
    // windows; the attic carries the 1879 bas-reliefs of Arts, Letters, Sciences, Medicine.
    for (const ax of [-193, -143]) {
      box(g, 12, 18, 5, ax, 9, 18.5, materials.paleStone, 'Academy Palace avant-corps');
      for (const dx of [-3.4, 3.4]) {
        box(g, 0.6, 18, 0.4, ax + dx, 9, 20.9, materials.warmStone, 'Academy avant-corps double pilaster');
      }
      const apw = new THREE.Shape();
      apw.moveTo(-2.4, 0); apw.lineTo(2.4, 0); apw.lineTo(0, 1.1); apw.closePath();
      mesh(g, new THREE.ShapeGeometry(apw), materials.warmStone, ax, 14.6, 20.9, 'Academy avant-corps pediment window');
      box(g, 3.4, 4.6, 0.2, ax, 11, 20.9, materials.glass, 'Academy avant-corps window');
      box(g, 9, 1.6, 0.16, ax, 19.6, 21.0, materials.warmStone, 'Academy 1879 bas-relief panel');
    }
    // Along the Rue Ducale the Academy Palace garden is closed by a white-stone wall
    // crowned by a balustrade (heritage inventory 30098).
    box(g, 0.8, 3.2, 60, -204, 1.6, 36, materials.paleStone, 'Academy Rue Ducale boundary wall');
    const awBal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.9, 0.28), materials.paleStone, 40);
    const awd = new THREE.Object3D();
    let awi = 0;
    for (let wz = 6; wz <= 66; wz += 3) {
      awd.position.set(-204, 3.65, wz); awd.rotation.y = 0; awd.updateMatrix();
      awBal.setMatrixAt(awi++, awd.matrix);
    }
    awBal.count = awi; awBal.name = 'Academy boundary balustrade'; g.add(awBal);
    box(g, 0.9, 0.16, 61, -204, 4.15, 36, materials.warmStone, 'Academy boundary balustrade rail');
    // The BELvue corner pavilion is built up with corner quoins (chaînage d'angle) and
    // dormers pierce its hipped roof, like the palace's own end pavilions.
    for (const side of [-1, 1]) {
      for (let y = 1.2; y <= 21.5; y += 0.95) {
        box(g, 0.5, 0.8, 0.4, 168 + side * 17.9, y, 36 + side * 0, materials.warmStone, 'BELvue corner quoin');
        box(g, 0.4, 0.8, 0.5, 168 + side * 0, y, 36 + side * 13.9, materials.warmStone, 'BELvue corner quoin');
      }
    }
    for (const dx of [-6, 0, 6]) {
      box(g, 1.2, 1.5, 0.3, 168 + dx, 24.6, 26.5, materials.paleStone, 'BELvue dormer');
      mesh(g, new THREE.ConeGeometry(0.9, 0.8, 4), materials.roof, 168 + dx, 25.8, 26.5, 'BELvue dormer roof');
    }
    // The Royal Stables open onto a carriage arch on their courtyard front (the palace
    // complex is crossed by roads north and south).
    const stArch = new THREE.Shape();
    stArch.moveTo(-3.2, 0); stArch.lineTo(3.2, 0); stArch.lineTo(3.2, 4.2);
    stArch.absarc(0, 4.2, 3.2, 0, Math.PI, false); stArch.lineTo(-3.2, 0); stArch.closePath();
    mesh(g, new THREE.ShapeGeometry(stArch), materials.glass, -70, 0, -72.8, 'Royal Stables carriage arch');
    box(g, 8, 1.0, 1.0, -70, 7.6, -72.8, materials.warmStone, 'Royal Stables arch impost');
    // The Boulevard du Régent (Small Ring) runs south-east from the Place du Trône, past the
    // equestrian statue of Leopold II, on the site of the old second city walls (R20).
    const bdR = box(g, 150, 0.06, 18, -185, 0.03, -125, materials.pavingA, 'Boulevard du Régent street strip');
    bdR.rotation.y = Math.PI / 4;
    // The Rue Ducale runs south from the park's east side down to the Place du Trône,
    // past the Royal Stables and the Academy Palace (one of the four park thoroughfares).
    box(g, 14, 0.06, 150, 181, 0.03, -13, materials.pavingA, 'Rue Ducale south extension to Place du Trône');
    // Behind the Palace of the Nation stand the two hemicycles: the Chamber's (rebuilt
    // 1821-22 after the 1820 fire) and the Senate's (built 1847-49 by Suys, enlarged
    // 1902-03 by Bordiau).
    mesh(g, new THREE.CylinderGeometry(14, 14, 18, 20, 1, false, 0, Math.PI), materials.plaster, -70, 9, 437, 'Chamber of Representatives hemicycle');
    mesh(g, new THREE.CylinderGeometry(16, 16, 20, 20, 1, false, 0, Math.PI), materials.plaster, 70, 10, 437, 'Senate hemicycle');
    mesh(g, new THREE.CylinderGeometry(14.6, 14.6, 0.8, 20, 1, false, 0, Math.PI), materials.warmStone, -70, 18.4, 437, 'Chamber hemicycle cornice');
    mesh(g, new THREE.CylinderGeometry(16.6, 16.6, 0.8, 20, 1, false, 0, Math.PI), materials.warmStone, 70, 20.4, 437, 'Senate hemicycle cornice');
    // No. 16 rue de la Loi, immediately beside the Palace of the Nation, is the official
    // seat of the Prime Minister of Belgium ("Law Street 16").
    box(g, 26, 14, 18, 34, 7, 424, materials.paleStone, '16 rue de la Loi Prime Minister seat');
    box(g, 28, 0.9, 20, 34, 14.5, 424, materials.warmStone, 'Law Street 16 cornice');
    for (let i = 0; i < 4; i++) {
      box(g, 2.4, 5.5, 0.2, 34 - 9 + i * 6, 8, 433.1, materials.glass, 'Law Street 16 window');
    }
    // In 1769 the States of Brabant proposed a statue of Prince Charles Alexander of Lorraine,
    // placed before the levelled ruins of the Coudenberg palace — the park's founding monument.
    box(g, 4, 3.4, 4, -30, 1.7, 300, materials.paleStone, 'Charles of Lorraine statue pedestal');
    mesh(g, new THREE.SphereGeometry(0.9, 12, 10), materials.paleStone, -30, 5.2, 300, 'Charles of Lorraine statue figure');
    // The monument to Godecharle (by Gilles-Lambert Godecharle) stands in Brussels Park,
    // among the park's sixty Greco-Roman and historical sculptures.
    box(g, 3.6, 3.0, 3.6, 30, 1.5, 300, materials.paleStone, 'Godecharle monument pedestal');
    mesh(g, new THREE.SphereGeometry(0.85, 12, 10), materials.paleStone, 30, 4.6, 300, 'Godecharle monument figure');
    // The corner bays of the Academy Palace serve as entrances: coach doors (portes
    // cochères) open on each side, letting carriages cross the palace from side to side.
    for (const ax of [-199.5, -136.5]) {
      box(g, 3.2, 5.2, 0.5, ax, 2.6, 20.9, materials.dark, 'Academy Palace corner coach door');
      box(g, 4.4, 0.7, 0.7, ax, 5.6, 20.9, materials.warmStone, 'Academy coach door lintel');
    }
    // The west and east wings of the Palace of the Nation carry window grids and slate roofs.
    for (const wx of [-70, 70]) {
      mesh(g, new THREE.ConeGeometry(24, 5, 4), materials.roof, wx, 18.5, 420, 'Palace of the Nation wing roof');
      for (let i = 0; i < 4; i++) {
        box(g, 2.4, 6.5, 0.2, wx - 13.5 + i * 9, 8, 402.9, materials.glass, 'Palace of the Nation wing window');
      }
    }
    // Benches line the park's central avenue for visitors (the park is the city's first
    // public park, opened for strolling and rest since the 1770s).
    for (const bz of [90, 130, 210, 250, 330]) {
      for (const bx of [-12, 12]) {
        box(g, 2.2, 0.12, 0.7, bx, 0.55, bz, materials.warmStone, 'Park avenue bench seat');
        box(g, 2.2, 0.5, 0.1, bx, 0.8, bz + 0.32, materials.warmStone, 'Park avenue bench back');
      }
    }
    // The Academy Palace has seven bays on its north and south faces too (15 bays W/E).
    for (const fz of [22, 50]) {
      for (let i = 0; i < 7; i++) {
        box(g, 2.2, 5.5, 0.2, -168 - 27 + i * 9, 9, fz, materials.glass, 'Academy Palace side window');
      }
    }
    // The BELvue north face (toward the park) carries a window grid and a ground-floor door.
    for (let i = 0; i < 5; i++) {
      box(g, 2.2, 4.6, 0.2, 168 - 13 + i * 6.5, 11, 50.1, materials.glass, 'BELvue north window');
    }
    box(g, 3.6, 4.8, 0.4, 168, 2.4, 50.2, materials.dark, 'BELvue north entrance door');
    // The Palace of the Nation is U-shaped around the Place de la Nation courtyard: a rear
    // range joins the wings behind the central block.
    box(g, 80, 18, 16, 0, 9, 446, materials.plaster, 'Palace of the Nation rear range');
    box(g, 82, 1.0, 18, 0, 18.5, 446, materials.warmStone, 'Palace of the Nation rear cornice');
    box(g, 150, 0.14, 22, 0, 0.05, 438, materials.pavingEdge, 'Place de la Nation courtyard paving');
    // A transverse walk crosses the park east-west at mid-depth, completing the star-shaped
    // alley pattern with the central and radiating avenues.
    box(g, 320, 0.07, 8, 0, 0.07, 232, materials.pavingA, 'Park transverse walk');
    // Seasonal flower beds ring the main pond on the central axis (the park's ornamental
    // beds were part of the 1776-83 neoclassical planting).
    for (const fx of [-24, -16, 16, 24]) {
      box(g, 6, 0.22, 3.2, fx, 0.11, 150, materials.green, 'Park pond flower bed');
      box(g, 5.4, 0.1, 2.6, fx, 0.24, 150, new THREE.MeshStandardMaterial({ color: 0xb06a5a, roughness: 0.95 }), 'Park pond flower planting');
    }
    // The vista axis from the palace portico to the park's north gate is a lighter paved
    // carpet laid over the setts — the palace-Parliament sightline on the square.
    box(g, 10, 0.1, 46, 0, 0.02, 36, materials.pavingA, 'Place des Palais central axis vista');
    // The Academy Palace is roofed with a slate mansard carrying dormers, behind its attic.
    mesh(g, new THREE.ConeGeometry(34, 7, 4), materials.roof, -168, 25.5, 36, 'Academy Palace mansard roof');
    for (const dx of [-20, 0, 20]) {
      box(g, 1.4, 1.8, 0.3, -168 + dx, 23.6, 24.5, materials.paleStone, 'Academy Palace roof dormer');
      mesh(g, new THREE.ConeGeometry(1.0, 0.9, 4), materials.roof, -168 + dx, 24.9, 24.5, 'Academy dormer roof');
    }
    // The Royal Stables wrap a courtyard with a side range and a rear range, like the
    // palace's own quadrangle plan.
    box(g, 12, 10, 50, -94, 5, -85, materials.ochre, 'Royal Stables west range');
    box(g, 46, 10, 12, -70, 5, -112, materials.ochre, 'Royal Stables rear range');
    box(g, 36, 0.14, 40, -70, 0.05, -88, materials.pavingEdge, 'Royal Stables courtyard paving');
    // The octagonal basin (1780) carries its own central fountain jet, like the main pond.
    cylinder(g, 0.2, 0.5, 5.2, 0, 2.7, 262, parkWater, 10).name = 'Octagonal basin fountain jet';
    mesh(g, new THREE.ConeGeometry(1.3, 1.8, 10), parkWater, 0, 5.5, 262, 'Octagonal basin fountain spray');
    // The Rue Royale runs south from the park's west side toward the Place Royale/Koningsplein.
    box(g, 14, 0.06, 100, -181, 0.03, 12, materials.pavingA, 'Rue Royale south extension to Place Royale');
    // The Academy Palace's boulevard du Régent side is scanned by blue-stone pilasters
    // (heritage inventory 30098: "celle du boulevard du Régent scandée par des pilastres
    // en pierre bleue").
    for (let wz = 8; wz <= 64; wz += 7) {
      box(g, 0.6, 3.2, 0.7, -204.7, 1.6, wz, materials.pavingB, 'Academy boulevard-side blue-stone pilaster');
    }
    // The Palace of the Nation peristyle carries a full entablature over its columns and a
    // broad emmarchement (steps) up to the portico floor.
    box(g, 52, 1.1, 2.2, 0, 15.6, 401.8, materials.warmStone, 'Palace of the Nation peristyle entablature');
    for (let s = 0; s < 4; s++) {
      box(g, 54 - s * 2, 0.3, 1.2, 0, 0.15 + s * 0.3, 399.4 - s * 1.1, materials.plaster, 'Palace of the Nation portico step');
    }
    // Four clipped lawn panels (green rooms) fill the park between the avenue walks.
    for (const [lx, lz] of [[-55, 120], [55, 120], [-55, 290], [55, 290]]) {
      box(g, 70, 0.1, 60, lx, 0.05, lz, materials.green, 'Park lawn panel');
      box(g, 71, 0.06, 61, lx, 0.02, lz, materials.pavingA, 'Park lawn panel edging');
    }
    // The Academy Palace garden is closed to the north and east by a grille (heritage
    // inventory 30098: wall to the west, grille to the north and east).
    const agGrille = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 2.6, 0.08), materials.dark, 30);
    const agd = new THREE.Object3D();
    let agi = 0;
    for (let ax = -200; ax <= -136; ax += 2.2) {
      agd.position.set(ax, 1.3, 66); agd.rotation.y = 0; agd.updateMatrix();
      agGrille.setMatrixAt(agi++, agd.matrix);
    }
    agGrille.count = agi; agGrille.name = 'Academy garden north grille'; g.add(agGrille);
    box(g, 65, 0.12, 0.3, -168, 2.66, 66, materials.dark, 'Academy garden north grille rail');
    // The BELvue hipped roof is topped by a small balustraded terrace around its apex.
    const bvBal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.8, 0.24), materials.paleStone, 12);
    const bvd = new THREE.Object3D();
    let bvi = 0;
    for (let k = 0; k < 12; k++) {
      const a = k * Math.PI / 6;
      bvd.position.set(168 + Math.cos(a) * 4.5, 29.6, 36 + Math.sin(a) * 4.5); bvd.rotation.y = 0; bvd.updateMatrix();
      bvBal.setMatrixAt(bvi++, bvd.matrix);
    }
    bvBal.count = bvi; bvBal.name = 'BELvue roof terrace balustrade'; g.add(bvBal);
    // Busts of Roman emperors ring the main pond — the park's original emperor busts
    // (destroyed by sans-culottes in 1793, later replaced by copies).
    for (let bk = 0; bk < 8; bk++) {
      const ba = bk * Math.PI / 4 + Math.PI / 8;
      box(g, 0.9, 1.1, 0.9, Math.cos(ba) * 17.6, 1.05, 150 + Math.sin(ba) * 17.6, materials.paleStone, 'Pond emperor bust pedestal');
      mesh(g, new THREE.SphereGeometry(0.42, 10, 8), materials.paleStone, Math.cos(ba) * 17.6, 2.0, 150 + Math.sin(ba) * 17.6, 'Park Roman emperor bust');
    }
    // The Academy Palace garden is also grilled to the east, toward the palace (inventory 30098).
    const aeGrille = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 2.6, 0.08), materials.dark, 30);
    const aed = new THREE.Object3D();
    let aei = 0;
    for (let az = 8; az <= 64; az += 2.2) {
      aed.position.set(-135.5, 1.3, az); aed.rotation.y = 0; aed.updateMatrix();
      aeGrille.setMatrixAt(aei++, aed.matrix);
    }
    aeGrille.count = aei; aeGrille.name = 'Academy garden east grille'; g.add(aeGrille);
    box(g, 0.3, 0.12, 57, -135.5, 2.66, 36, materials.dark, 'Academy garden east grille rail');
    // The Palace of the Nation colonnade stands on a raised stylobate platform with a
    // moulded edge, in front of the portico steps.
    box(g, 54, 0.5, 4.5, 0, 0.25, 400.2, materials.plaster, 'Palace of the Nation peristyle stylobate');
    box(g, 55, 0.16, 5.1, 0, 0.56, 400.2, materials.warmStone, 'Palace of the Nation stylobate edge');
    // Inside the Cluysenaar kiosk the orchestra plays from a raised circular platform.
    cylinder(g, 2.6, 2.9, 0.6, -46, 0.55, 150, materials.warmStone, 12).name = 'Bandstand orchestra platform';
    // The Rue de la Loi continues north from the Palace of the Nation toward the
    // European Quarter (the N3 to Aachen begins here).
    box(g, 16, 0.06, 90, 0, 0.03, 470, materials.pavingA, 'Rue de la Loi north extension to the EU quarter');
    // The Academy Palace portico pediment is crowned by a small sculptural acroterion.
    cylinder(g, 0.3, 0.4, 1.1, -168, 16.0, 19.6, materials.warmStone, 8).name = 'Academy portico pediment acroterion';

    // Behind the palace the gardens are English style (Wikipedia: "French style at the
    // front, English style at the rear") — a lawn with scattered trees on the Coudenberg site.
    box(g, 200, 0.3, 90, 0, -0.1, -115, materials.green, 'Rear English-style garden lawn');
    const rearTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.34, 3.6, 6), materials.dark, 12);
    const rearCan = new THREE.InstancedMesh(new THREE.SphereGeometry(2.4, 8, 6), materials.green, 12);
    const rtd = new THREE.Object3D();
    let rti = 0;
    for (let i = 0; i < 12; i++) {
      const rx = -90 + (i % 6) * 36;
      const rz = -80 - Math.floor(i / 6) * 55;
      rtd.position.set(rx, 1.8, rz); rtd.rotation.y = 0; rtd.updateMatrix();
      rearTrunk.setMatrixAt(rti, rtd.matrix);
      rtd.position.set(rx, 4.6, rz); rtd.updateMatrix();
      rearCan.setMatrixAt(rti, rtd.matrix);
      rti++;
    }
    rearTrunk.count = rti; rearTrunk.name = 'Rear garden tree trunks'; g.add(rearTrunk);
    rearCan.count = rti; rearCan.name = 'Rear garden tree canopies'; g.add(rearCan);

    // Tree rows also line the three radiating avenues from the main pond.
    const radTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.28, 3.0, 6), materials.dark, 36);
    const radCan = new THREE.InstancedMesh(new THREE.SphereGeometry(1.7, 8, 6), materials.green, 36);
    const rdd = new THREE.Object3D();
    let rdi = 0;
    for (const ra of [Math.PI * 0.72, Math.PI * 0.28, Math.PI / 2]) {
      for (let d = 20; d <= 110; d += 18) {
        for (const off of [-4, 4]) {
          const px = Math.cos(ra) * d + Math.cos(ra + Math.PI / 2) * off;
          const pz = 150 + Math.sin(ra) * d + Math.sin(ra + Math.PI / 2) * off;
          rdd.position.set(px, 1.5, pz); rdd.rotation.y = 0; rdd.updateMatrix();
          radTrunk.setMatrixAt(rdi, rdd.matrix);
          rdd.position.set(px, 3.9, pz); rdd.updateMatrix();
          radCan.setMatrixAt(rdi, rdd.matrix);
          rdi++;
        }
      }
    }
    radTrunk.count = rdi; radTrunk.name = 'Radiating avenue tree trunks'; g.add(radTrunk);
    radCan.count = rdi; radCan.name = 'Radiating avenue tree canopies'; g.add(radCan);
    // Stone edging kerbs flank the central avenue walk.
    box(g, 0.4, 0.18, 172, -6.3, 0.09, 150, materials.pavingEdge, 'Central avenue west edging kerb');
    box(g, 0.4, 0.18, 172, 6.3, 0.09, 150, materials.pavingEdge, 'Central avenue east edging kerb');
    // Stone access steps lead down to the main pond rim on the central axis (south side).
    for (let s = 0; s < 3; s++) {
      box(g, 6, 0.25, 0.9, 0, 0.9 - s * 0.25, 164.5 + s * 0.9, materials.paleStone, 'Main pond access step');
    }
    // The Place du Trône was enclosed in 1868-69 by a monumental fence with an entrance to
    // the palace park, to Balat's 1867 design (heritage inventory 10001113).
    box(g, 70, 0.5, 0.5, -120, 0.25, -46, materials.paleStone, 'Place du Trône fence base');
    const trFence = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 2.2, 0.1), materials.dark, 40);
    const trd2 = new THREE.Object3D();
    let tri3 = 0;
    for (let fx = -155; fx <= -85; fx += 2) {
      trd2.position.set(fx, 1.35, -46); trd2.rotation.y = 0; trd2.updateMatrix();
      trFence.setMatrixAt(tri3++, trd2.matrix);
    }
    trFence.count = tri3; trFence.name = 'Place du Trône monumental fence'; g.add(trFence);
    box(g, 70, 0.14, 0.4, -120, 2.5, -46, materials.dark, 'Place du Trône fence top rail');
    for (const gx of [-124, -116]) {
      box(g, 1.4, 3.4, 0.6, gx, 1.7, -46, materials.paleStone, 'Palace park entrance gate pier');
    }

    // Behind the Academy Palace stand its stables, built with the palace in 1823-28.
    box(g, 40, 14, 20, -168, 7, 82, materials.ochre, 'Academy Palace stables block');
    box(g, 42, 0.9, 22, -168, 14.5, 82, materials.warmStone, 'Academy Palace stables cornice');
    mesh(g, new THREE.ConeGeometry(23, 4.5, 4), materials.roof, -168, 18, 82, 'Academy Palace stables roof');
    for (let i = 0; i < 5; i++) {
      box(g, 2.4, 5, 0.2, -168 - 16 + i * 8, 6, 71.9, materials.glass, 'Academy stables arched window');
    }

    // The BELvue museum entrance: a recessed door on the square facade with stone steps.
    box(g, 3.6, 6.2, 0.3, 168, 3.1, 21.85, materials.dark, 'BELvue entrance door');
    box(g, 4.4, 0.3, 1.2, 168, 0.15, 21.2, materials.pavingEdge, 'BELvue entrance step');
    box(g, 4.0, 0.3, 1.0, 168, 0.45, 20.7, materials.pavingEdge, 'BELvue entrance step');
    box(g, 4.0, 0.28, 0.5, 168, 6.5, 21.8, materials.warmStone, 'BELvue entrance lintel');

    // The Palace of the Nation attic windows and the main door beneath the peristyle pediment.
    for (let i = 0; i < 7; i++) {
      box(g, 1.8, 2.6, 0.2, -24 + i * 8, 19.6, 402.9, materials.glass, 'Palace of the Nation attic window');
    }
    box(g, 4.2, 8.5, 0.3, 0, 4.25, 402.8, materials.dark, 'Palace of the Nation main door');
    box(g, 5.2, 0.3, 1.4, 0, 0.15, 401.6, materials.pavingEdge, 'Palace of the Nation entrance step');
    box(g, 4.8, 0.3, 1.1, 0, 0.45, 401.0, materials.pavingEdge, 'Palace of the Nation entrance step');

    // The Academy Palace portico pediment encloses a sculpted tympanum panel with a stone frame.
    box(g, 9.5, 1.7, 0.1, -168, 13.9, 19.58, materials.warmStone, 'Academy Palace tympanum frame');
    box(g, 8.2, 1.3, 0.14, -168, 13.9, 19.54, materials.paleStone, 'Academy Palace tympanum panel');

    // Stone lintels crown the BELvue piano nobile windows under the modillion cornice.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 2.4, 0.24, 0.3, wx, 17.35, 22.1, materials.warmStone, 'BELvue piano nobile lintel');
    }

    // The Palace of the Nation flies the EU and Belgian flags from cornice flagpoles.
    for (const fx of [-10, 10]) {
      cylinder(g, 0.06, 0.1, 9, fx, 27.7, 403.4, materials.bronze, 8).name = 'Palace of the Nation flagpole';
      mesh(g, new THREE.SphereGeometry(0.16, 8, 6), materials.gold, fx, 32.3, 403.4, 'Palace of the Nation flag finial');
    }
    box(g, 3.2, 2.0, 0.06, -8.4, 31.2, 403.4, materials.enamelBlue, 'Palace of the Nation EU flag');
    box(g, 3.2, 2.0, 0.06, 11.6, 31.2, 403.4, materials.canvas, 'Palace of the Nation Belgian flag');

    // The Royal Stables front is closed by a projecting gatehouse with a pedimented gate.
    box(g, 12, 15, 4, -70, 7.5, -71, materials.paleStone, 'Royal Stables gatehouse');
    box(g, 13, 0.8, 5, -70, 15.4, -71, materials.warmStone, 'Royal Stables gatehouse cornice');
    const rsPed = new THREE.Shape();
    rsPed.moveTo(-5, 0); rsPed.lineTo(5, 0); rsPed.lineTo(0, 2.6); rsPed.closePath();
    mesh(g, new THREE.ShapeGeometry(rsPed), materials.warmStone, -70, 15.8, -68.95, 'Royal Stables gatehouse pediment');
    box(g, 3.8, 0.25, 0.5, -70, 6.7, -68.9, materials.warmStone, 'Royal Stables gate lintel');
    box(g, 3.2, 6.5, 0.3, -70, 3.25, -68.8, materials.dark, 'Royal Stables gate door');

    // Contrasting sett rows mark the palace axis across the paved Place des Palais.
    for (const az of [24, 36, 48]) {
      box(g, 260, 0.12, 1.2, 0, 0.06, az, materials.pavingB, 'Place des Palais sett accent row');
    }

    // A ring of coping stones caps the rim of the park main pond above the water line.
    const pondCop = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 0.18, 0.55), materials.paleStone, 36);
    const pcd = new THREE.Object3D();
    let pci = 0;
    for (let ca = 0; ca < 36; ca++) {
      const a = ca * Math.PI / 18;
      pcd.position.set(Math.cos(a) * 16.35, 1.06, 150 + Math.sin(a) * 16.35);
      pcd.rotation.y = -a;
      pcd.updateMatrix();
      pondCop.setMatrixAt(pci++, pcd.matrix);
    }
    pondCop.count = pci; pondCop.name = 'Main pond rim coping'; g.add(pondCop);

    // Cast-iron street lamps with glass globes line the palace-square axis at night.
    for (const lz of [18, 30, 42, 54]) {
      for (const lx of [-7.5, 7.5]) {
        cylinder(g, 0.07, 0.11, 3.6, lx, 1.8, lz, materials.bronze, 8).name = 'Square axis street lamp';
        mesh(g, new THREE.SphereGeometry(0.28, 10, 8), materials.glass, lx, 3.75, lz, 'Square axis street lamp globe');
      }
    }

    // The Academy Palace attic is crowned by a balustrade parapet.
    const apBal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), materials.warmStone, 40);
    const abd = new THREE.Object3D();
    let abi = 0;
    for (let bi = 0; bi < 40; bi++) {
      abd.position.set(-200 + bi * (66 / 39), 21.75, 36); abd.rotation.y = 0; abd.updateMatrix();
      apBal.setMatrixAt(abi++, abd.matrix);
    }
    apBal.count = abi; apBal.name = 'Academy Palace attic baluster'; g.add(apBal);
    box(g, 66, 0.1, 0.4, -168, 22.15, 36, materials.warmStone, 'Academy Palace attic balustrade rail');

    // The BELvue ground floor is bossaged, with rusticated blocks flanking the entrance.
    const bossMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 1.6, 0.14), materials.warmStone, 40);
    const bossDum = new THREE.Object3D();
    let bossIdx = 0;
    for (const by of [2.0, 4.4]) {
      for (let bx = 150.5; bx <= 185.5; bx += 3) {
        if (Math.abs(bx - 168) < 3.2) continue;
        bossDum.position.set(bx, by, 21.95); bossDum.rotation.y = 0; bossDum.updateMatrix();
        bossMesh.setMatrixAt(bossIdx++, bossDum.matrix);
      }
    }
    bossMesh.count = bossIdx; bossMesh.name = 'BELvue ground floor bossage'; g.add(bossMesh);

    // Both wings of the Palace of the Nation carry rows of tall facade windows.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(g, 2.4, 7, 0.2, side * 70 - 15 + i * 10, 8, 406.9, materials.glass, 'Palace of the Nation wing window');
      }
    }

    // Corner quoins strengthen the square-facing corners of the BELvue pavilion.
    for (const cx of [150.1, 185.9]) {
      for (const qy of [2.5, 7.5, 12.5, 17.5]) {
        box(g, 0.5, 1.6, 0.4, cx, qy, 21.9, materials.warmStone, 'BELvue corner quoin');
      }
    }

    // Projecting end pavilions close both ends of the Academy Palace facade.
    for (const px of [-201, -135]) {
      box(g, 8, 20, 32, px, 10, 36, materials.paleStone, 'Academy Palace end pavilion');
      box(g, 9, 0.8, 33, px, 20.4, 36, materials.warmStone, 'Academy Palace end pavilion cornice');
    }

    // Modillions line the underside of the Palace of the Nation cornice.
    const pnMod = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.55, 0.42), materials.warmStone, 30);
    const pmd = new THREE.Object3D();
    let pmi = 0;
    for (let mi = 0; mi < 30; mi++) {
      pmd.position.set(-29 + mi * 2, 21.75, 402.7); pmd.rotation.y = 0; pmd.updateMatrix();
      pnMod.setMatrixAt(pmi++, pmd.matrix);
    }
    pnMod.count = pmi; pnMod.name = 'Palace of the Nation cornice modillion'; g.add(pnMod);

    // Lanterns crown the piers of the park south gate on the palace axis.
    for (const gx of [-6, 6]) {
      box(g, 0.5, 0.7, 0.5, gx, 3.75, 62, materials.bronze, 'Park south gate lantern');
      mesh(g, new THREE.SphereGeometry(0.22, 10, 8), materials.glass, gx, 3.75, 62, 'Park south gate lantern glass');
    }

    // Small hayloft windows pierce the Royal Stables range just under the eaves.
    for (let i = 0; i < 5; i++) {
      box(g, 1.2, 1.2, 0.2, -70 - 16 + i * 8, 10, -72.9, materials.glass, 'Royal Stables hayloft window');
    }

    // A low stone wall encloses the Academy Palace garden toward the square.
    box(g, 56, 0.8, 0.4, -168, 0.4, 56, materials.paleStone, 'Academy garden front wall');

    // Broad stone steps lead up to the Palace of the Nation peristyle.
    box(g, 50, 0.3, 1.2, 0, 0.15, 400.6, materials.pavingEdge, 'Palace of the Nation peristyle step');
    box(g, 46, 0.3, 1.0, 0, 0.45, 400.0, materials.pavingEdge, 'Palace of the Nation peristyle step');

    // A low wall encloses the Royal Stables courtyard on its south side.
    box(g, 48, 1.0, 0.4, -70, 0.5, -98, materials.ochre, 'Royal Stables courtyard wall');

    // Stone edging kerbs flank the north radiating avenue from the main pond.
    box(g, 0.4, 0.18, 92, -4.3, 0.09, 215, materials.pavingEdge, 'Radiating avenue edging kerb');
    box(g, 0.4, 0.18, 92, 4.3, 0.09, 215, materials.pavingEdge, 'Radiating avenue edging kerb');

    // Small triangular pediments cap the center of each Palace of the Nation wing.
    for (const side of [-1, 1]) {
      const wp = new THREE.Shape();
      wp.moveTo(-4, 0); wp.lineTo(4, 0); wp.lineTo(0, 2.4); wp.closePath();
      mesh(g, new THREE.ShapeGeometry(wp), materials.warmStone, side * 70, 16, 406.85, 'Palace of the Nation wing pediment');
    }

    // Low walls close the east and west sides of the Academy Palace garden.
    box(g, 0.4, 0.8, 16, -197, 0.4, 64, materials.paleStone, 'Academy garden side wall');
    box(g, 0.4, 0.8, 16, -139, 0.4, 64, materials.paleStone, 'Academy garden side wall');

    // Lanterns also crown the piers of the park north gate by the Palace of the Nation.
    for (const gx of [-6, 6]) {
      box(g, 0.5, 0.7, 0.5, gx, 3.75, 402, materials.bronze, 'Park north gate lantern');
      mesh(g, new THREE.SphereGeometry(0.22, 10, 8), materials.glass, gx, 3.75, 402, 'Park north gate lantern glass');
    }

    // A top rail closes the BELvue roof terrace balustrade ring.
    box(g, 0.3, 0.12, 9.4, 168 - 4.5, 30.05, 36, materials.warmStone, 'BELvue roof terrace rail');
    box(g, 0.3, 0.12, 9.4, 168 + 4.5, 30.05, 36, materials.warmStone, 'BELvue roof terrace rail');
    box(g, 9.4, 0.12, 0.3, 168, 30.05, 36 - 4.5, materials.warmStone, 'BELvue roof terrace rail');
    box(g, 9.4, 0.12, 0.3, 168, 30.05, 36 + 4.5, materials.warmStone, 'BELvue roof terrace rail');

    // A circular sett-paved ring surrounds the equestrian statue on the Place du Trone.
    const trRing = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.1, 0.5), materials.pavingB, 24);
    const trd3 = new THREE.Object3D();
    let tri4 = 0;
    for (let ca = 0; ca < 24; ca++) {
      const a = ca * Math.PI / 12;
      trd3.position.set(-120 + Math.cos(a) * 8, 0.05, -60 + Math.sin(a) * 8);
      trd3.rotation.y = -a;
      trd3.updateMatrix();
      trRing.setMatrixAt(tri4++, trd3.matrix);
    }
    trRing.count = tri4; trRing.name = 'Place du Trone statue sett ring'; g.add(trRing);

    // A dentil course runs under the projecting BELvue cornice.
    const bvDen = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.3, 0.3), materials.warmStone, 20);
    const bdd2 = new THREE.Object3D();
    let bdi2 = 0;
    for (let di2 = 0; di2 < 20; di2++) {
      bdd2.position.set(151 + di2 * 1.8, 22.2, 21.85); bdd2.rotation.y = 0; bdd2.updateMatrix();
      bvDen.setMatrixAt(bdi2++, bdd2.matrix);
    }
    bvDen.count = bdi2; bvDen.name = 'BELvue cornice dentil'; g.add(bvDen);

    // The Academy Palace portico shelters a central door with a step and lintel.
    box(g, 3.4, 7, 0.3, -168, 3.5, 20.85, materials.dark, 'Academy Palace portico door');
    box(g, 3.8, 0.25, 0.4, -168, 7.2, 20.8, materials.warmStone, 'Academy Palace portico door lintel');
    box(g, 4.2, 0.3, 1.2, -168, 0.15, 19.9, materials.pavingEdge, 'Academy Palace portico step');

    // A low railing rings the Cluysenaar bandstand in the park.
    const bsRail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), materials.dark, 16);
    const bsd = new THREE.Object3D();
    let bsi = 0;
    for (let ba = 0; ba < 16; ba++) {
      const a = ba * Math.PI / 8;
      bsd.position.set(-46 + Math.cos(a) * 6.2, 0.85, 150 + Math.sin(a) * 6.2);
      bsd.rotation.y = -a; bsd.updateMatrix();
      bsRail.setMatrixAt(bsi++, bsd.matrix);
    }
    bsRail.count = bsi; bsRail.name = 'Park bandstand railing'; g.add(bsRail);

    // An architrave beam spans the Palace of the Nation peristyle columns under the pediment.
    box(g, 52, 1.0, 3.0, 0, 15.5, 401.8, materials.warmStone, 'Palace of the Nation architrave');

    // Coping stones cap the rim of the octagonal basin (1780) north of the main pond.
    const obCop = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.15, 0.5), materials.paleStone, 8);
    const obd = new THREE.Object3D();
    let obi = 0;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      obd.position.set(Math.cos(a) * 13.3, 0.95, 262 + Math.sin(a) * 13.3);
      obd.rotation.y = -a + Math.PI / 4;
      obd.updateMatrix();
      obCop.setMatrixAt(obi++, obd.matrix);
    }
    obCop.count = obi; obCop.name = 'Octagonal basin rim coping'; g.add(obCop);

    // Bases and capitals finish the Academy Palace Ionic pilaster order.
    for (let i = 0; i < 8; i++) {
      const px = -168 - 28 + i * 8;
      box(g, 0.9, 0.5, 0.7, px, 0.4, 21.1, materials.warmStone, 'Academy Palace pilaster base');
      box(g, 0.9, 0.5, 0.7, px, 18.2, 21.1, materials.warmStone, 'Academy Palace pilaster capital');
    }

    // Corner quoins strengthen the facade corners of the Palace of the Nation central block.
    for (const cx of [-29.8, 29.8]) {
      for (const qy of [4, 9, 14, 19]) {
        box(g, 0.6, 1.8, 0.4, cx, qy, 402.9, materials.warmStone, 'Palace of the Nation corner quoin');
      }
    }

    // A bronze name plaque hangs on each statue pedestal in the Academy garden.
    for (let i = 0; i < agStat.length; i++) {
      const gx = -196 + i * 10;
      box(g, 0.9, 0.5, 0.06, gx, 0.9, 63.55, materials.bronze, 'Academy statue plaque');
    }

    // A low octagonal railing rings the Vauxhall bandstand in the park.
    const vhRail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), materials.dark, 8);
    const vhd = new THREE.Object3D();
    let vhi = 0;
    for (let va = 0; va < 8; va++) {
      const a = va * Math.PI / 4;
      vhd.position.set(46 + Math.cos(a) * 5.4, 0.85, 210 + Math.sin(a) * 5.4);
      vhd.rotation.y = -a; vhd.updateMatrix();
      vhRail.setMatrixAt(vhi++, vhd.matrix);
    }
    vhRail.count = vhi; vhRail.name = 'Vauxhall bandstand railing'; g.add(vhRail);

    // Stone surrounds frame the BELvue piano nobile windows.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 2.4, 4.6, 0.16, wx, 15, 22.05, materials.warmStone, 'BELvue piano nobile surround');
    }

    // A small dovecote crowns the Royal Stables hipped roof.
    cylinder(g, 1.2, 1.5, 2.5, -70, 20.2, -85, materials.paleStone, 10).name = 'Royal Stables dovecote';
    mesh(g, new THREE.ConeGeometry(1.6, 1.2, 10), materials.roof, -70, 21.9, -85, 'Royal Stables dovecote roof');

    // A stone plinth carries the park perimeter railing on all four sides.
    box(g, 344, 0.3, 0.5, 0, 0.15, 62, materials.paleStone, 'Park south railing plinth');
    box(g, 344, 0.3, 0.5, 0, 0.15, 402, materials.paleStone, 'Park north railing plinth');
    box(g, 0.5, 0.3, 340, -172, 0.15, 232, materials.paleStone, 'Park west railing plinth');
    box(g, 0.5, 0.3, 340, 172, 0.15, 232, materials.paleStone, 'Park east railing plinth');

    // An inset tympanum panel fills the Palace of the Nation pediment behind the Justice relief.
    box(g, 10, 2.2, 0.1, 0, 16.6, 401.7, materials.paleStone, 'Palace of the Nation tympanum panel');

    // Stone sills sit under each BELvue ground-floor window.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 2.4, 0.18, 0.3, wx, 5.85, 22.15, materials.warmStone, 'BELvue ground window sill');
    }

    // The Academy Palace ground floor is bossaged with rusticated blocks.
    const apBoss = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.4, 0.14), materials.warmStone, 40);
    const apBd = new THREE.Object3D();
    let apBi = 0;
    for (let bx = -194; bx <= -142; bx += 3) {
      if (Math.abs(bx + 168) < 3) continue;
      apBd.position.set(bx, 1.2, 20.85); apBd.rotation.y = 0; apBd.updateMatrix();
      apBoss.setMatrixAt(apBi++, apBd.matrix);
    }
    apBoss.count = apBi; apBoss.name = 'Academy Palace ground bossage'; g.add(apBoss);

    // Stone sills sit under each Palace of the Nation facade window.
    for (let i = 0; i < 7; i++) {
      box(g, 2.8, 0.2, 0.35, -22.5 + i * 9, 7.9, 403.0, materials.warmStone, 'Palace of the Nation window sill');
    }

    // Stone lintels crown the arched windows of the Royal Stables range.
    for (let i = 0; i < 5; i++) {
      box(g, 2.8, 0.22, 0.3, -70 - 16 + i * 8, 8.6, -73.0, materials.warmStone, 'Royal Stables window lintel');
    }

    // A continuous sill band runs under the Academy Palace ground-floor windows.
    box(g, 62, 0.25, 0.3, -168, 2.6, 20.95, materials.warmStone, 'Academy Palace sill band');

    // Stone sills sit under each BELvue attic window.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 2.4, 0.18, 0.3, wx, 18.15, 22.15, materials.warmStone, 'BELvue attic window sill');
    }

    // Stone lintels crown the wing windows of the Palace of the Nation.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(g, 2.8, 0.22, 0.3, side * 70 - 15 + i * 10, 11.7, 406.8, materials.warmStone, 'Palace of the Nation wing window lintel');
      }
    }

    // A lower step completes the Academy Palace portico entrance flight.
    box(g, 5.0, 0.25, 0.8, -168, 0.12, 19.3, materials.pavingEdge, 'Academy Palace portico lower step');

    // Urns stand along the Palace of the Nation attic balustrade.
    const pnUr = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8), materials.warmStone, 15);
    const pnud = new THREE.Object3D();
    let pnui = 0;
    for (let ui = 0; ui < 15; ui++) {
      pnud.position.set(-28 + ui * 4, 24.45, 403.2); pnud.rotation.y = 0; pnud.updateMatrix();
      pnUr.setMatrixAt(pnui++, pnud.matrix);
    }
    pnUr.count = pnui; pnUr.name = 'Palace of the Nation balustrade urn'; g.add(pnUr);

    // A dentil course runs under the Academy Palace cornice.
    const apDn = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.3, 0.3), materials.warmStone, 39);
    const apDd = new THREE.Object3D();
    let apDi = 0;
    for (let di3 = 0; di3 < 39; di3++) {
      apDd.position.set(-200.5 + di3 * 1.7, 17.85, 20.7); apDd.rotation.y = 0; apDd.updateMatrix();
      apDn.setMatrixAt(apDi++, apDd.matrix);
    }
    apDn.count = apDi; apDn.name = 'Academy Palace cornice dentil'; g.add(apDn);

    // A bronze finial with a gilded ball crowns the BELvue pavilion roof.
    cylinder(g, 0.05, 0.12, 1.2, 168, 30.6, 36, materials.bronze, 8).name = 'BELvue roof finial';
    mesh(g, new THREE.SphereGeometry(0.22, 10, 8), materials.gold, 168, 31.3, 36, 'BELvue roof finial ball');

    // Each Hermes bust around the octagonal basin stands on a stone pedestal.
    for (let hk = 0; hk < 8; hk++) {
      const ha = hk * Math.PI / 4;
      box(g, 1.0, 1.0, 1.0, Math.cos(ha) * 13.6, 0.5, 262 + Math.sin(ha) * 13.6, materials.paleStone, 'Hermes bust pedestal');
    }

    // Attic bases ring each Palace of the Nation peristyle column.
    for (let i = 0; i < 8; i++) {
      cylinder(g, 1.1, 1.25, 1.0, -24 + i * 6.85, 0.5, 401.5, materials.plaster, 12).name = 'Palace of the Nation column base';
    }

    // A tall window pierces the Royal Stables gatehouse above the gate.
    box(g, 2.0, 4.0, 0.2, -70, 10, -68.85, materials.glass, 'Royal Stables gatehouse window');
    box(g, 2.4, 0.22, 0.3, -70, 12.2, -68.9, materials.warmStone, 'Royal Stables gatehouse window lintel');

    // Capitals crown each Palace of the Nation peristyle column under the architrave.
    for (let i = 0; i < 8; i++) {
      cylinder(g, 1.2, 1.0, 0.6, -24 + i * 6.85, 15.0, 401.5, materials.plaster, 12).name = 'Palace of the Nation column capital';
    }

    // An architrave beam spans the Academy Palace portico columns under the pediment.
    box(g, 18, 0.8, 1.2, -168, 12.4, 19.7, materials.warmStone, 'Academy Palace portico architrave');

    // Bollards mark the four corners of the paved Place des Palais.
    for (const cx of [-168, 168]) {
      for (const cz of [16, 56]) {
        cylinder(g, 0.09, 0.12, 0.9, cx, 0.45, cz, materials.dark, 8).name = 'Square corner bollard';
      }
    }

    // Keystones crown the arched ground-floor windows of the Academy Palace.
    for (let i = 0; i < 7; i++) {
      box(g, 0.5, 0.8, 0.3, -168 - 24 + i * 8, 7.9, 20.95, materials.warmStone, 'Academy Palace window keystone');
    }

    // Acroteria stand at the apex and both feet of the Palace of the Nation pediment.
    for (const ax of [-11, 0, 11]) {
      mesh(g, new THREE.SphereGeometry(0.45, 10, 8), materials.warmStone, ax, ax === 0 ? 21.6 : 15.6, 401.7, 'Palace of the Nation pediment acroterion');
    }

    // Gate piers with caps flank the Royal Stables gatehouse door.
    for (const side of [-1, 1]) {
      box(g, 0.9, 7.2, 0.7, -70 + side * 2.6, 3.6, -68.75, materials.paleStone, 'Royal Stables gate pier');
      box(g, 1.1, 0.3, 0.9, -70 + side * 2.6, 7.35, -68.75, materials.warmStone, 'Royal Stables gate pier cap');
    }

    // Benches face the park main pond from its south rim.
    for (const bx of [-10, 10]) {
      box(g, 3.0, 0.12, 0.8, bx, 1.35, 165.5, materials.dark, 'Park pond bench seat');
      box(g, 3.0, 0.6, 0.12, bx, 1.6, 165.9, materials.dark, 'Park pond bench back');
      for (const side of [-1, 1]) {
        box(g, 0.12, 1.3, 0.7, bx + side * 1.4, 0.65, 165.5, materials.dark, 'Park pond bench leg');
      }
    }

    // Stone lintels crown the BELvue ground-floor windows.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 2.4, 0.22, 0.3, wx, 9.25, 22.15, materials.warmStone, 'BELvue ground window lintel');
    }

    // A glazed fanlight crowns the Palace of the Nation main door.
    mesh(g, new THREE.CircleGeometry(2.0, 16, 0, Math.PI), materials.glass, 0, 8.6, 402.85, 'Palace of the Nation door fanlight');

    // A ridge strip crowns the Academy Palace attic roofline.
    box(g, 66, 0.35, 0.35, -168, 22.3, 36, materials.warmStone, 'Academy Palace roof ridge');

    // Stone sills sit under each BELvue piano nobile window.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 2.4, 0.18, 0.3, wx, 12.75, 22.15, materials.warmStone, 'BELvue piano nobile sill');
    }

    // Keystones crown the facade windows of the Palace of the Nation.
    for (let i = 0; i < 7; i++) {
      box(g, 0.5, 0.7, 0.3, -22.5 + i * 9, 16.2, 403.0, materials.warmStone, 'Palace of the Nation window keystone');
    }

    // The Academy Palace stables block has a great door on its court facade.
    box(g, 3.0, 5.5, 0.3, -168, 2.75, 71.85, materials.dark, 'Academy stables door');
    box(g, 3.4, 0.22, 0.4, -168, 5.7, 71.8, materials.warmStone, 'Academy stables door lintel');

    // Stone sills sit under each Palace of the Nation wing window.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(g, 2.8, 0.2, 0.35, side * 70 - 15 + i * 10, 4.35, 407.0, materials.warmStone, 'Palace of the Nation wing window sill');
      }
    }

    // Windows pierce the Academy Palace attic storey.
    for (let i = 0; i < 9; i++) {
      box(g, 1.8, 2.0, 0.2, -168 - 24 + i * 6, 21.5, 20.95, materials.glass, 'Academy Palace attic window');
    }

    // Modillions line the underside of the BELvue cornice.
    const bvMd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.45, 0.4), materials.warmStone, 20);
    const bvMdd = new THREE.Object3D();
    let bvMi = 0;
    for (let mi2 = 0; mi2 < 20; mi2++) {
      bvMdd.position.set(151 + mi2 * 1.8, 21.85, 21.8); bvMdd.rotation.y = 0; bvMdd.updateMatrix();
      bvMd.setMatrixAt(bvMi++, bvMdd.matrix);
    }
    bvMd.count = bvMi; bvMd.name = 'BELvue cornice modillion'; g.add(bvMd);

    // Corner quoins strengthen the facade corners of both Palace of the Nation wings.
    for (const side of [-1, 1]) {
      for (const cx of [side * 50.2, side * 89.8]) {
        for (const qy of [4, 9, 14]) {
          box(g, 0.5, 1.8, 0.4, cx, qy, 406.9, materials.warmStone, 'Palace of the Nation wing quoin');
        }
      }
    }

    // Attic bases ring each Academy Palace portico column.
    for (let i = 0; i < 4; i++) {
      cylinder(g, 0.95, 1.05, 0.7, -174 + i * 4, 0.35, 19.5, materials.paleStone, 12).name = 'Academy portico column base';
    }

    // Stone lintels crown the Royal Stables hayloft windows.
    for (let i = 0; i < 5; i++) {
      box(g, 1.5, 0.18, 0.3, -70 - 16 + i * 8, 10.7, -73.0, materials.warmStone, 'Royal Stables hayloft lintel');
    }

    // Capitals crown each Academy Palace portico column under the architrave.
    for (let i = 0; i < 4; i++) {
      cylinder(g, 1.0, 0.85, 0.5, -174 + i * 4, 12.25, 19.5, materials.paleStone, 12).name = 'Academy portico column capital';
    }

    // Urns stand at the four corners of the BELvue roof terrace.
    for (const ux of [-4.5, 4.5]) {
      for (const uz of [-4.5, 4.5]) {
        mesh(g, new THREE.SphereGeometry(0.3, 10, 8), materials.warmStone, 168 + ux, 30.2, 36 + uz, 'BELvue roof terrace urn');
      }
    }

    // Lanterns flank the main door of the Palace of the Nation.
    for (const side of [-1, 1]) {
      box(g, 0.4, 1.0, 0.4, side * 3.5, 9.5, 402.4, materials.bronze, 'Palace of the Nation entrance lantern');
      mesh(g, new THREE.SphereGeometry(0.24, 10, 8), materials.glass, side * 3.5, 9.6, 402.4, 'Palace of the Nation entrance lantern glass');
    }

    // Keystones crown the BELvue piano nobile windows.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 0.45, 0.6, 0.3, wx, 17.6, 22.15, materials.warmStone, 'BELvue window keystone');
    }

    // A sett-paved yard lies behind the Academy Palace stables block.
    box(g, 44, 0.12, 24, -168, 0.06, 104, materials.pavingA, 'Academy stables yard paving');

    // Collar rings anchor the emperor bust pedestals around the main pond.
    for (let ba = 0; ba < 16; ba++) {
      const a = ba * Math.PI / 8;
      cylinder(g, 1.1, 1.2, 0.3, Math.cos(a) * 17.6, 0.15, 150 + Math.sin(a) * 17.6, materials.paleStone, 10).name = 'Pond emperor bust collar';
    }

    // Collars anchor the statue pedestals in the Academy Palace garden.
    for (let i = 0; i < agStat.length; i++) {
      const gx = -196 + i * 10;
      box(g, 1.9, 0.25, 1.9, gx, 0.12, 64, materials.warmStone, 'Academy statue base collar');
    }

    // A centre mullion divides each Palace of the Nation facade window.
    for (let i = 0; i < 7; i++) {
      box(g, 0.08, 8, 0.06, -22.5 + i * 9, 12, 403.0, materials.warmStone, 'Palace of the Nation window mullion');
    }

    // Stone lintels crown the BELvue attic windows.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 2.4, 0.2, 0.3, wx, 21.95, 22.15, materials.warmStone, 'BELvue attic window lintel');
    }

    // Centre mullions divide the Palace of the Nation wing windows.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(g, 0.08, 7, 0.06, side * 70 - 15 + i * 10, 8, 407.0, materials.warmStone, 'Palace of the Nation wing window mullion');
      }
    }

    // Mullions divide the Academy Palace first-floor windows.
    for (let i = 0; i < 7; i++) {
      box(g, 0.08, 6.5, 0.06, -168 - 24 + i * 8, 11, 21.0, materials.warmStone, 'Academy Palace first-floor mullion');
    }

    // Mullions divide the BELvue ground-floor windows.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 0.08, 3.2, 0.06, wx, 7.5, 22.2, materials.warmStone, 'BELvue ground window mullion');
    }

    // Keystones crown the arched windows of the Royal Stables range.
    for (let i = 0; i < 5; i++) {
      box(g, 0.45, 0.6, 0.3, -70 - 16 + i * 8, 8.7, -73.0, materials.warmStone, 'Royal Stables window keystone');
    }

    // A moulded surround frames the Palace of the Nation main door.
    for (const side of [-1, 1]) {
      box(g, 0.35, 8.5, 0.4, side * 2.45, 4.25, 402.75, materials.warmStone, 'Palace of the Nation door jamb');
    }
    box(g, 5.0, 0.3, 0.45, 0, 8.75, 402.75, materials.warmStone, 'Palace of the Nation door lintel');

    // Jambs frame the BELvue entrance door on the square facade.
    for (const side of [-1, 1]) {
      box(g, 0.3, 6.2, 0.35, 168 + side * 2.05, 3.1, 21.8, materials.warmStone, 'BELvue door jamb');
    }

    // Mullions divide the BELvue piano nobile windows.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 0.08, 4.2, 0.06, wx, 15, 22.2, materials.warmStone, 'BELvue piano nobile mullion');
    }

    // Mullions divide the Academy Palace ground-floor arched windows.
    for (let i = 0; i < 7; i++) {
      box(g, 0.08, 4.5, 0.06, -168 - 24 + i * 8, 5, 21.0, materials.warmStone, 'Academy Palace ground mullion');
    }

    // A frieze band runs above the Palace of the Nation peristyle architrave.
    box(g, 52, 0.7, 2.6, 0, 16.35, 401.2, materials.warmStone, 'Palace of the Nation frieze band');

    // Raking cornices follow both slopes of the Academy Palace portico pediment.
    const rkL = box(g, 8.8, 0.18, 0.2, -172, 13.9, 19.62, materials.warmStone, 'Academy pediment raking cornice');
    rkL.rotation.z = Math.atan2(3.4, 8);
    const rkR = box(g, 8.8, 0.18, 0.2, -164, 13.9, 19.62, materials.warmStone, 'Academy pediment raking cornice');
    rkR.rotation.z = -Math.atan2(3.4, 8);

    // Cheek stones flank the Palace of the Nation entrance steps.
    for (const side of [-1, 1]) {
      box(g, 0.3, 0.6, 1.4, side * 2.9, 0.3, 401.6, materials.paleStone, 'Palace of the Nation step cheek');
    }

    // Cheek stones flank the BELvue entrance steps.
    for (const side of [-1, 1]) {
      box(g, 0.3, 0.6, 1.0, 168 + side * 2.5, 0.3, 21.2, materials.paleStone, 'BELvue step cheek');
    }

    // Mullions divide the arched windows of the Royal Stables range.
    for (let i = 0; i < 5; i++) {
      box(g, 0.08, 5, 0.06, -70 - 16 + i * 8, 6, -73.0, materials.warmStone, 'Royal Stables window mullion');
    }

    // A bed moulding crowns the Palace of the Nation cornice.
    box(g, 62, 0.2, 0.5, 0, 23.3, 403.1, materials.warmStone, 'Palace of the Nation cornice bed moulding');

    // A gravel path crosses the Academy Palace garden between the statues.
    box(g, 3, 0.08, 12, -168, 0.06, 64, materials.pavingB, 'Academy garden path');

    // Cornices crown both wings of the Palace of the Nation.
    for (const side of [-1, 1]) {
      box(g, 42, 0.8, 28, side * 70, 16.4, 420, materials.warmStone, 'Palace of the Nation wing cornice');
    }

    // A dentil course runs under the Academy stables cornice.
    const asDn = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.3, 0.3), materials.warmStone, 28);
    const asDd = new THREE.Object3D();
    let asDi = 0;
    for (let di4 = 0; di4 < 28; di4++) {
      asDd.position.set(-191 + di4 * 1.7, 13.9, 71.8); asDd.rotation.y = 0; asDd.updateMatrix();
      asDn.setMatrixAt(asDi++, asDd.matrix);
    }
    asDn.count = asDi; asDn.name = 'Academy stables cornice dentil'; g.add(asDn);

    // A balustrade crowns the BELvue attic storey.
    const bvAb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), materials.warmStone, 20);
    const bvAd = new THREE.Object3D();
    let bvAi = 0;
    for (let ai = 0; ai < 20; ai++) {
      bvAd.position.set(150.5 + ai * 1.9, 22.75, 36); bvAd.rotation.y = 0; bvAd.updateMatrix();
      bvAb.setMatrixAt(bvAi++, bvAd.matrix);
    }
    bvAb.count = bvAi; bvAb.name = 'BELvue attic baluster'; g.add(bvAb);
    box(g, 38, 0.1, 0.35, 168, 23.1, 36, materials.warmStone, 'BELvue attic balustrade rail');

    // A door pierces the west wing facade of the Palace of the Nation.
    box(g, 3.0, 6.0, 0.3, -70, 3.0, 406.85, materials.dark, 'Palace of the Nation wing door');
    box(g, 3.4, 0.22, 0.4, -70, 6.2, 406.8, materials.warmStone, 'Palace of the Nation wing door lintel');

    // A gate with piers and lintel opens into the Academy Palace garden.
    for (const gx of [-172, -164]) {
      box(g, 0.8, 1.8, 0.5, gx, 0.9, 56, materials.paleStone, 'Academy garden gate pier');
    }
    box(g, 9, 0.4, 0.5, -168, 1.9, 56, materials.warmStone, 'Academy garden gate lintel');

    // A circular sett medallion marks the centre of the Place des Palais on the palace axis.
    cylinder(g, 4, 4, 0.1, 0, 0.05, 36, materials.pavingB, 24).name = 'Square axis medallion';

    // A glazed fanlight crowns the BELvue entrance door.
    mesh(g, new THREE.CircleGeometry(1.7, 16, 0, Math.PI), materials.glass, 168, 6.6, 21.9, 'BELvue door fanlight');

    // Volutes finish the capitals of the Academy Palace pilasters.
    for (let i = 0; i < 8; i++) {
      const px = -168 - 28 + i * 8;
      mesh(g, new THREE.SphereGeometry(0.28, 10, 8), materials.warmStone, px, 18.6, 21.15, 'Academy pilaster volute');
    }

    // A projecting plinth bases the Palace of the Nation facade.
    box(g, 62, 0.5, 0.6, 0, 0.25, 403.1, materials.paleStone, 'Palace of the Nation base plinth');

    // Side gates with piers and lintels open in the east and west park railings.
    for (const rx of [-172, 172]) {
      for (const side of [-1, 1]) {
        box(g, 0.5, 3.0, 1.2, rx, 1.5, 232 + side * 3, materials.paleStone, 'Park side gate pier');
      }
      box(g, 0.5, 0.5, 14, rx, 3.2, 232, materials.dark, 'Park side gate lintel');
    }

    // Stone surrounds frame the arched windows of the Royal Stables range.
    for (let i = 0; i < 5; i++) {
      box(g, 2.8, 5.4, 0.16, -70 - 16 + i * 8, 6, -72.95, materials.warmStone, 'Royal Stables window surround');
    }

    // Pilasters strengthen the square-facing corners of the BELvue pavilion.
    for (const cx of [150.1, 185.9]) {
      box(g, 0.5, 22, 0.4, cx, 11, 22.05, materials.paleStone, 'BELvue corner pilaster');
    }

    // Stone surrounds frame the Academy Palace ground-floor arched windows.
    for (let i = 0; i < 7; i++) {
      box(g, 2.6, 4.9, 0.16, -168 - 24 + i * 8, 5, 20.95, materials.warmStone, 'Academy ground window surround');
    }

    // Jambs frame the Palace of the Nation west wing door.
    for (const side of [-1, 1]) {
      box(g, 0.3, 6.0, 0.35, -70 + side * 1.8, 3.0, 406.8, materials.warmStone, 'Palace of the Nation wing door jamb');
    }

    // A stone rim rings the fountain jet at the centre of the park main pond.
    cylinder(g, 1.2, 1.4, 0.5, 0, 0.75, 150, materials.paleStone, 12).name = 'Park fountain rim';

    // A projecting cornice tops the Palace of the Nation peristyle entablature.
    box(g, 54, 0.35, 3.0, 0, 16.9, 401.3, materials.warmStone, 'Palace of the Nation peristyle cornice');

    // A stylobate platform carries the Academy Palace portico columns.
    box(g, 20, 0.4, 3.5, -168, 0.2, 19.8, materials.paleStone, 'Academy portico stylobate');

    // A recessed panel surrounds the BELvue entrance door on the square facade.
    box(g, 5.2, 7.0, 0.2, 168, 3.5, 21.95, materials.paleStone, 'BELvue entrance recess panel');

    // A door with lintel pierces the east wing facade of the Palace of the Nation.
    box(g, 3.0, 6.0, 0.3, 70, 3.0, 406.85, materials.dark, 'Palace of the Nation east wing door');
    box(g, 3.4, 0.22, 0.4, 70, 6.2, 406.8, materials.warmStone, 'Palace of the Nation east wing door lintel');

    // Stone sills sit under the Academy Palace first-floor windows.
    for (let i = 0; i < 7; i++) {
      box(g, 2.6, 0.18, 0.3, -168 - 24 + i * 8, 7.65, 21.0, materials.warmStone, 'Academy first-floor window sill');
    }

    // A bed moulding crowns the front edge of the BELvue cornice.
    box(g, 38, 0.18, 0.4, 168, 23.1, 21.85, materials.warmStone, 'BELvue cornice bed moulding');

    // Jambs frame the Palace of the Nation east wing door.
    for (const side of [-1, 1]) {
      box(g, 0.3, 6.0, 0.35, 70 + side * 1.8, 3.0, 406.8, materials.warmStone, 'Palace of the Nation east wing door jamb');
    }

    // Stone sills sit under the Royal Stables arched windows.
    for (let i = 0; i < 5; i++) {
      box(g, 2.8, 0.18, 0.3, -70 - 16 + i * 8, 3.4, -73.0, materials.warmStone, 'Royal Stables window sill');
    }

    // Keystones crown the BELvue ground-floor windows above their lintels.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 0.4, 0.55, 0.3, wx, 9.6, 22.15, materials.warmStone, 'BELvue ground window keystone');
    }

    // Stone lintels crown the Academy Palace ground-floor arched windows.
    for (let i = 0; i < 7; i++) {
      box(g, 2.6, 0.22, 0.3, -168 - 24 + i * 8, 7.4, 21.0, materials.warmStone, 'Academy ground window lintel');
    }

    // Keystones crown the Palace of the Nation wing windows.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        box(g, 0.45, 0.6, 0.3, side * 70 - 15 + i * 10, 12.0, 407.0, materials.warmStone, 'Palace of the Nation wing window keystone');
      }
    }

    // Mullions divide the BELvue attic windows.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 0.08, 3.6, 0.06, wx, 20, 22.2, materials.warmStone, 'BELvue attic window mullion');
    }

    // Jambs frame the Academy Palace portico door.
    for (const side of [-1, 1]) {
      box(g, 0.3, 7, 0.35, -168 + side * 2.0, 3.5, 20.8, materials.warmStone, 'Academy portico door jamb');
    }

    // A tympanum panel fills the Royal Stables gatehouse pediment.
    box(g, 7, 1.4, 0.1, -70, 16.5, -68.98, materials.paleStone, 'Royal Stables pediment tympanum');

    // Windows pierce the Academy Palace end pavilions on the square facade.
    for (const px of [-201, -135]) {
      box(g, 1.8, 4.0, 0.2, px, 8, 19.9, materials.glass, 'Academy end pavilion window');
    }

    // Hayloft windows pierce the Academy stables block just under the eaves.
    for (let i = 0; i < 5; i++) {
      box(g, 1.2, 1.2, 0.2, -168 - 15 + i * 7.5, 12, 71.9, materials.glass, 'Academy stables hayloft window');
    }

    // A projecting eave band rings the BELvue pavilion roof base.
    box(g, 40, 0.25, 32, 168, 24.2, 36, materials.roof, 'BELvue pavilion eave');

    // A stone rim rings the fountain jet of the octagonal basin.
    cylinder(g, 0.9, 1.1, 0.4, 0, 0.7, 262, materials.paleStone, 10).name = 'Octagonal basin fountain rim';

    // Tympanum panels fill the pediments of both Palace of the Nation wings.
    for (const side of [-1, 1]) {
      box(g, 6, 1.4, 0.1, side * 70, 16.7, 406.9, materials.paleStone, 'Palace of the Nation wing tympanum');
    }

    // Jambs frame the great door of the Academy stables block.
    for (const side of [-1, 1]) {
      box(g, 0.3, 5.5, 0.35, -168 + side * 1.8, 2.75, 71.8, materials.warmStone, 'Academy stables door jamb');
    }

    // A projecting plinth bases the BELvue pavilion block.
    box(g, 38, 0.7, 30.6, 168, 0.35, 36, materials.warmStone, 'BELvue base plinth');

    // Small pediments cap the Academy Palace end pavilions.
    for (const px of [-201, -135]) {
      const ep = new THREE.Shape();
      ep.moveTo(-4.5, 0); ep.lineTo(4.5, 0); ep.lineTo(0, 2.2); ep.closePath();
      mesh(g, new THREE.ShapeGeometry(ep), materials.warmStone, px, 20.8, 19.75, 'Academy end pavilion pediment');
    }

    // Kerbs edge both sides of the BELvue entrance steps.
    for (const cz of [21.2, 20.7]) {
      for (const side of [-1, 1]) {
        box(g, 0.25, 0.35, 1.1, 168 + side * 2.5, 0.18, cz, materials.pavingEdge, 'BELvue step kerb');
      }
    }

    // A dentil course runs under the Royal Stables gatehouse cornice.
    const rsDn = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.28, 0.28), materials.warmStone, 10);
    const rsDd = new THREE.Object3D();
    let rsDi = 0;
    for (let di5 = 0; di5 < 10; di5++) {
      rsDd.position.set(-76 + di5 * 1.2, 14.85, -68.9); rsDd.rotation.y = 0; rsDd.updateMatrix();
      rsDn.setMatrixAt(rsDi++, rsDd.matrix);
    }
    rsDn.count = rsDi; rsDn.name = 'Royal Stables gatehouse dentil'; g.add(rsDn);

    // Kerbs edge both sides of the Academy Palace portico steps.
    for (const cz of [19.9, 19.3]) {
      for (const side of [-1, 1]) {
        box(g, 0.25, 0.35, 1.2, -168 + side * 2.8, 0.18, cz, materials.pavingEdge, 'Academy portico step kerb');
      }
    }

    // Raking cornices follow both slopes of the Palace of the Nation pediment.
    const pnRkL = box(g, 12.0, 0.18, 0.2, -5.75, 16.95, 401.65, materials.warmStone, 'Palace of the Nation raking cornice');
    pnRkL.rotation.z = Math.atan2(3.5, 11.5);
    const pnRkR = box(g, 12.0, 0.18, 0.2, 5.75, 16.95, 401.65, materials.warmStone, 'Palace of the Nation raking cornice');
    pnRkR.rotation.z = -Math.atan2(3.5, 11.5);

    // Stone edging kerbs flank the west radiating avenue from the main pond.
    const raW = Math.PI * 0.72;
    const midWx = Math.cos(raW) * 65, midWz = 150 + Math.sin(raW) * 65;
    const perpWx = -Math.sin(raW), perpWz = Math.cos(raW);
    for (const off of [-4.3, 4.3]) {
      const kerb = box(g, 0.4, 0.18, 92, midWx + perpWx * off, 0.09, midWz + perpWz * off, materials.pavingEdge, 'Radiating avenue west kerb');
      kerb.rotation.y = Math.PI / 2 - raW;
    }

    // Stone edging kerbs flank the east radiating avenue from the main pond.
    const raE = Math.PI * 0.28;
    const midEx = Math.cos(raE) * 65, midEz = 150 + Math.sin(raE) * 65;
    const perpEx = -Math.sin(raE), perpEz = Math.cos(raE);
    for (const off of [-4.3, 4.3]) {
      const kerb = box(g, 0.4, 0.18, 92, midEx + perpEx * off, 0.09, midEz + perpEz * off, materials.pavingEdge, 'Radiating avenue east kerb');
      kerb.rotation.y = Math.PI / 2 - raE;
    }

    // A gate with piers and lintel opens in the Royal Stables courtyard wall.
    for (const gx of [-73, -67]) {
      box(g, 0.8, 1.8, 0.5, gx, 0.9, -98, materials.ochre, 'Royal Stables yard gate pier');
    }
    box(g, 7, 0.4, 0.5, -70, 1.9, -98, materials.warmStone, 'Royal Stables yard gate lintel');

    // Keystones crown the BELvue attic windows above their lintels.
    for (let i = 0; i < 5; i++) {
      const wx = 168 - 13 + i * 6.5;
      box(g, 0.4, 0.5, 0.3, wx, 22.25, 22.15, materials.warmStone, 'BELvue attic window keystone');
    }

    // Kerbs edge both sides of the Palace of the Nation peristyle steps.
    for (const cz of [400.6, 400.0]) {
      const cw = cz > 400 ? 25 : 23;
      for (const side of [-1, 1]) {
        box(g, 0.3, 0.5, 1.2, side * cw, 0.25, cz, materials.pavingEdge, 'Palace of the Nation step kerb');
      }
    }

    // A ridge strip crowns the Academy stables hipped roof.
    box(g, 0.4, 0.25, 26, -168, 20.3, 82, materials.roof, 'Academy stables roof ridge');

    // Dentil courses run under both Palace of the Nation wing cornices.
    const pwDn = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.3, 0.3), materials.warmStone, 40);
    const pwDd = new THREE.Object3D();
    let pwDi = 0;
    for (const side of [-1, 1]) {
      for (let di6 = 0; di6 < 20; di6++) {
        pwDd.position.set(side * 70 - 19 + di6 * 2, 15.85, 406.8); pwDd.rotation.y = 0; pwDd.updateMatrix();
        pwDn.setMatrixAt(pwDi++, pwDd.matrix);
      }
    }
    pwDn.count = pwDi; pwDn.name = 'Palace of the Nation wing cornice dentil'; g.add(pwDn);

    // A dentil course runs under the Academy Palace portico architrave.
    const apPd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.28, 0.28), materials.warmStone, 10);
    const apPdd = new THREE.Object3D();
    let apPi = 0;
    for (let di7 = 0; di7 < 10; di7++) {
      apPdd.position.set(-176.4 + di7 * 1.6, 11.9, 19.75); apPdd.rotation.y = 0; apPdd.updateMatrix();
      apPd.setMatrixAt(apPi++, apPdd.matrix);
    }
    apPd.count = apPi; apPd.name = 'Academy portico dentil'; g.add(apPd);

    // A bronze kick plate protects the foot of the BELvue entrance door.
    box(g, 3.4, 0.45, 0.06, 168, 0.35, 21.82, materials.bronze, 'BELvue door kick plate');

    // A bronze kick plate protects the foot of the Palace of the Nation main door.
    box(g, 3.8, 0.5, 0.06, 0, 0.4, 402.82, materials.bronze, 'Palace of the Nation door kick plate');

    // Dentil courses run under both Academy Palace end pavilion cornices.
    const aepD = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.28, 0.28), materials.warmStone, 10);
    const aepDd = new THREE.Object3D();
    let aepDi = 0;
    for (const px of [-201, -135]) {
      for (let di8 = 0; di8 < 5; di8++) {
        aepDd.position.set(px - 3.5 + di8 * 1.75, 19.85, 19.9); aepDd.rotation.y = 0; aepDd.updateMatrix();
        aepD.setMatrixAt(aepDi++, aepDd.matrix);
      }
    }
    aepD.count = aepDi; aepD.name = 'Academy end pavilion dentil'; g.add(aepD);

    // A lintel spans the palace-park gate in the Place du Trone fence.
    box(g, 10, 0.4, 0.5, -120, 3.6, -46, materials.dark, 'Place du Trone gate lintel');

    // Stone access steps lead down to the main pond rim on the north side of the axis.
    for (let s = 0; s < 3; s++) {
      box(g, 6, 0.25, 0.9, 0, 0.9 - s * 0.25, 134.0 + s * 0.9, materials.paleStone, 'Main pond north access step');
    }

    // A low wall closes the south side of the Academy stables yard.
    box(g, 44, 1.0, 0.4, -168, 0.5, 116, materials.ochre, 'Academy stables yard wall');

    // Stone access steps lead down to the octagonal basin rim on its south side.
    for (let s = 0; s < 3; s++) {
      box(g, 5, 0.25, 0.9, 0, 0.9 - s * 0.25, 276.0 + s * 0.9, materials.paleStone, 'Octagonal basin access step');
    }

    // Acroteria crown the apex of each Palace of the Nation wing pediment.
    for (const side of [-1, 1]) {
      mesh(g, new THREE.SphereGeometry(0.4, 10, 8), materials.warmStone, side * 70, 18.6, 406.85, 'Palace of the Nation wing acroterion');
    }

    // A cap course finishes the Academy Palace garden front wall.
    box(g, 56, 0.12, 0.6, -168, 0.86, 56, materials.warmStone, 'Academy garden wall cap');

    // A paved floor covers the Academy Palace portico stylobate.
    box(g, 22, 0.06, 4, -168, 0.43, 19.9, materials.pavingA, 'Academy portico floor');

    // A paved floor covers the Palace of the Nation peristyle.
    box(g, 52, 0.12, 4.5, 0, 0.06, 401.6, materials.pavingA, 'Palace of the Nation peristyle floor');

    // A kerb borders the front edge of the Palace of the Nation peristyle floor.
    box(g, 52, 0.15, 0.3, 0, 0.14, 403.9, materials.pavingEdge, 'Peristyle floor border kerb');

    // Cap courses finish the east and west Academy garden side walls.
    for (const cx of [-197, -139]) {
      box(g, 0.6, 0.12, 16, cx, 0.86, 64, materials.warmStone, 'Academy garden side wall cap');
    }

    // A sett field paves the north strip of the Place des Palais by the park gate.
    box(g, 300, 0.1, 8, 0, 0.02, 54, materials.pavingA, 'Place des Palais north sett field');

    // A step leads up to the Academy stables great door.
    box(g, 4.0, 0.25, 1.0, -168, 0.12, 70.9, materials.pavingEdge, 'Academy stables door step');

    // A cap course finishes the Royal Stables courtyard wall.
    box(g, 48, 0.12, 0.6, -70, 1.06, -98, materials.warmStone, 'Royal Stables courtyard wall cap');

    // A cap course finishes the Academy stables yard wall.
    box(g, 44, 0.12, 0.6, -168, 1.06, 116, materials.warmStone, 'Academy stables yard wall cap');

    // Side kerbs border the Palace of the Nation peristyle floor.
    for (const side of [-1, 1]) {
      box(g, 0.3, 0.15, 4.5, side * 26, 0.14, 401.6, materials.pavingEdge, 'Peristyle floor side kerb');
    }

    // A kerb borders the rear edge of the Palace of the Nation peristyle floor.
    box(g, 52, 0.15, 0.3, 0, 0.14, 399.4, materials.pavingEdge, 'Peristyle floor rear kerb');

    // A sett field paves the east side of the Place du Trone.
    box(g, 60, 0.1, 20, -90, 0.02, -60, materials.pavingA, 'Place du Trone east sett field');

    // Stone access steps lead down to the octagonal basin rim on its east side.
    for (let s = 0; s < 3; s++) {
      box(g, 0.9, 0.25, 5, 14.0 + s * 0.9, 0.9 - s * 0.25, 262, materials.paleStone, 'Octagonal basin east access step');
    }

    // Stone access steps lead down to the octagonal basin rim on its west side.
    for (let s = 0; s < 3; s++) {
      box(g, 0.9, 0.25, 5, -14.0 - s * 0.9, 0.9 - s * 0.25, 262, materials.paleStone, 'Octagonal basin west access step');
    }

    // Steps lead up to the Cluysenaar bandstand platform in the park.
    for (let s = 0; s < 2; s++) {
      box(g, 4, 0.25, 0.8, -46, 0.125 + s * 0.25, 157.2 - s * 0.7, materials.paleStone, 'Bandstand access step');
    }

    // Steps lead up to the Vauxhall bandstand platform in the park.
    for (let s = 0; s < 2; s++) {
      box(g, 4, 0.25, 0.8, 46, 0.125 + s * 0.25, 216.6 - s * 0.7, materials.paleStone, 'Vauxhall bandstand step');
    }

    // Stone access steps lead down to the main pond rim on its east side.
    for (let s = 0; s < 3; s++) {
      box(g, 0.9, 0.25, 6, 16.8 + s * 0.9, 0.9 - s * 0.25, 150, materials.paleStone, 'Main pond east access step');
    }

    // Kerbs edge both sides of the bandstand access steps.
    for (let s = 0; s < 2; s++) {
      for (const side of [-1, 1]) {
        box(g, 0.25, 0.25, 0.8, -46 + side * 2.2, 0.125 + s * 0.25, 157.2 - s * 0.7, materials.pavingEdge, 'Bandstand step kerb');
      }
    }

    // Kerbs edge both sides of the Vauxhall bandstand steps.
    for (let s = 0; s < 2; s++) {
      for (const side of [-1, 1]) {
        box(g, 0.25, 0.25, 0.8, 46 + side * 2.2, 0.125 + s * 0.25, 216.6 - s * 0.7, materials.pavingEdge, 'Vauxhall step kerb');
      }
    }

    // Stone access steps lead down to the main pond rim on its west side.
    for (let s = 0; s < 3; s++) {
      box(g, 0.9, 0.25, 6, -16.8 - s * 0.9, 0.9 - s * 0.25, 150, materials.paleStone, 'Main pond west access step');
    }

    // A sett ring borders the axis medallion at the centre of the Place des Palais.
    cylinder(g, 4.6, 4.6, 0.12, 0, 0.06, 36, materials.pavingEdge, 24).name = 'Square axis medallion ring';
  });
    addLandmark('cathedral', (g) => {
    box(g, 28, 13, 44, 0, 6.5, 0, materials.paleStone, 'Cathedral nave');
    box(g, 30, 1, 46, 0, 13, 0, materials.roof);
    for (const x of [-10, 10]) {
      box(g, 6, 24, 7, x, 12, -18, materials.limestone, 'Cathedral tower');
      mesh(g, new THREE.ConeGeometry(3.5, 8, 8), materials.roof, x, 28, -18);
    }
    for (let i = 0; i < 5; i++) box(g, 2.2, 5, 0.8, -8 + i * 4, 6, -22.5, materials.glass);
  });
  addLandmark('palaisDeJustice', (g) => {
    // Palais de Justice (Joseph Poelaert, 1866–1883): plan 160 x 150 m with eight inner
    // courts, hors tout 186 x 177 x 116 m, copper dome gilded to 105 m (116 m hors tout),
    // double Doric peristyle on a full-width emmarchement facing Place Poelaert.
    // Local +Z is the principal north entrance toward Place Poelaert (local +X is west,
    // toward rue des Minimes; local -X is east, toward rue aux Laines; local -Z is south,
    // toward rue de Wynants).
    // Sources: UNESCO tentative list 5357; Brussels heritage inventory building 30442;
    // Regie des Batiments history/dimensions; fr.wikipedia Palais de justice de Bruxelles
    // and Place Poelaert.
    const stone = new THREE.MeshStandardMaterial({ color: 0xc9bda8, roughness: 0.9 });
    const light = new THREE.MeshStandardMaterial({ color: 0xd8cbb6, roughness: 0.88 });
    // Pale sandstone ranges with ochre/sable avant-corps and pavilions, as on the real facades.
    const ochre = new THREE.MeshStandardMaterial({ color: 0xd3b98a, roughness: 0.88 });
    const weathered = new THREE.MeshStandardMaterial({ color: 0xa99b86, roughness: 0.94 });
    const slate = new THREE.MeshStandardMaterial({ color: 0x2f3a3e, roughness: 0.95 });
    const zinc = new THREE.MeshStandardMaterial({ color: 0x6d7276, roughness: 0.6, metalness: 0.35 });
    const recess = new THREE.MeshStandardMaterial({ color: 0x414342, roughness: 0.9 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x75664b, metalness: 0.42, roughness: 0.65 });
    // The real soubassement is pierre bleue (Belgian bluestone), a dark base under the pale stone.
    const bluestone = new THREE.MeshStandardMaterial({ color: 0x3d444c, roughness: 0.92 });
    // The real palace is floodlit after dark: register the facade stones for the warm night
    // wash and the window recesses for the lit-window glow (daytime rendering is untouched).
    for (const m of [stone, light, weathered, ochre]) {
      m.emissive = new THREE.Color(0x000000);
      facadeWashMats.push(m);
    }
    recess.emissive = new THREE.Color(0x000000);
    nightGlowMats.push(recess);

    // Broad podium and perimeter terrace: the courthouse sits above the Marolles escarpment.
    // Hors tout 186 x 177 m (UNESCO tentative list 5357); the building plan itself is 160 x 150 m.
    box(g, 186, 4.2, 177, 0, -1.0, 0, weathered, 'Palais de Justice monumental podium');
    terrainFoundationSkirt(g, g, brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lat, BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lon), 186, 177, -3.1, weathered, 'Palais de Justice terrain retaining skirt');
    box(g, 178, 2.2, 169, 0, 2.2, 0, light, 'Courthouse podium coping');
    // Dark bluestone soubassement band wrapping the terrace edge and the range plinths.
    box(g, 186.6, 2.4, 177.6, 0, 2.0, 0, bluestone, 'Palais de Justice bluestone soubassement band');
    box(g, 160, 4.5, 17.8, 0, 5.2, -66.5, bluestone, 'Range bluestone plinth');
    // The north plinth is split around the porch opening so the doorway and inner colonnade
    // are not buried.
    for (const side of [-1, 1]) box(g, 46, 4.5, 17.8, side * 57, 5.2, 66.5, bluestone, 'North range bluestone plinth wing');
    for (const x of [71.5, -71.5]) box(g, 17.8, 4.5, 116, x, 5.2, 0, bluestone, 'Range bluestone plinth');
    // Eight internal courts are left open. Four long ranges and cross-ranges create
    // a legible courtyard plan instead of a single opaque rectangular mass.
    const wingY = 17.5, wingH = 31, wingD = 17;
    // North range facing Place Poelaert, split around the monumental porch opening (|x| < 34),
    // matching the entrance-range collider wings.
    box(g, 46, wingH, wingD, -57, wingY, 66.5, stone, 'North range west wing facing Place Poelaert');
    box(g, 46, wingH, wingD, 57, wingY, 66.5, stone, 'North range east wing facing Place Poelaert');
    box(g, 160, wingH, wingD, 0, wingY, -66.5, stone, 'South range above Rue de Wynants');
    box(g, wingD, wingH, 116, 71.5, wingY, 0, stone, 'West range Rue des Minimes');
    box(g, wingD, wingH, 116, -71.5, wingY, 0, stone, 'East range Rue aux Laines');
    // Gallery runs sit outside the court outer arcades (courts reach z=±35).
    for (const z of [-39, 39]) {
      box(g, 126, 26, 6, 0, 15, z, light, 'Courthouse transverse gallery');
      box(g, 127, 1.0, 6.8, 0, 26.5, z, zinc, 'Transverse gallery zinc roof');
    }
    // The z=0 gallery is split around the central hall (x within ±28).
    for (const side of [-1, 1]) {
      box(g, 35, 26, 10, side * 45.5, 15, 0, light, 'Courthouse transverse gallery wing');
      box(g, 36, 1.0, 10.8, side * 45.5, 26.5, 0, zinc, 'Transverse gallery zinc roof');
    }
    // Flat zinc roofs over the four perimeter ranges; the corner pavilions wear slate hips.
    for (const z of [66.5, -66.5]) box(g, 161, 1.2, 17.8, 0, 33.6, z, zinc, 'Range zinc roof');
    for (const x of [71.5, -71.5]) box(g, 17.8, 1.2, 117, x, 33.6, 0, zinc, 'Range zinc roof');
    // Raised corner pavilions with hipped pavilion roofs (toit en pavillon); the two north
    // pavilions flank the monumental porch in strong projection (forte saillie).
    for (const x of [-66, 66]) for (const z of [-61.5, 64]) {
      const north = z > 0;
      box(g, 28, 39, north ? 30 : 27, x, 20, z, ochre, 'Projecting courthouse corner pavilion');
      box(g, 30, 1.6, north ? 32 : 29, x, 40, z, weathered, 'Corner pavilion cornice');
      mesh(g, new THREE.ConeGeometry(21, 6.5, 4), slate, x, 43.85, z, 'Corner pavilion hipped roof (toit en pavillon)');
      for (let bay = -1; bay <= 1; bay++) {
        box(g, 2.1, 8, 0.35, x + bay * 7, 18, z + (north ? 15.2 : -13.7), recess, 'Corner pavilion tall window');
      }
    }
    // North principal façade: the peristyle is preceded by an emmarchement across its
    // full width, rising from the Place Poelaert esplanade up to the entrance terrace.
    // Forecourt landing north of the stair flight (treads occupy z up to ~95.4).
    box(g, 60, 1.2, 8.5, 0, 0.9, 99.75, weathered, 'Place Poelaert forecourt landing');
    // The flight stops at the terrace's north edge (z=88): the top tread meets the terrace
    // face instead of disappearing inside the opaque terrace volume.
    for (let step = 0; step < 12; step++) {
      box(g, 56 + step * 0.7, 0.46, 0.7, 0, 0.5 + step * 0.5, 95 - step * 0.6, light, 'Monumental entrance stair (full-width emmarchement)');
    }
    box(g, 58, 3.0, 20, 0, 5.0, 78, stone, 'Main entrance terrace');
    // Four monumental marble statues of the great orators and legislators of Antiquity stand
    // at the foot of the grand stairs: Demosthenes and Lycurgus (A. Cattier) on the west side,
    // Cicero and Ulpian (A.F. Boure) on the east side.
    const marble = new THREE.MeshStandardMaterial({ color: 0xe6deca, roughness: 0.7 });
    for (const [figure, x] of [['Demosthenes', -59], ['Lycurgus', -52], ['Cicero', 52], ['Ulpian', 59]]) {
      box(g, 2.8, 1.2, 2.8, x, 0.9, 97, weathered, 'Jurist statue plinth');
      cylinder(g, 0.55, 0.78, 4.6, x, 4.4, 97, marble, 10);
      mesh(g, new THREE.SphereGeometry(0.5, 12, 10), marble, x, 7.0, 97, figure + ' statue head');
      box(g, 0.5, 2.2, 0.3, x + 0.8, 5.2, 97, marble, figure + ' statue arm');
    }
    // Double colonnade of Doric columns on the entrance terrace: base, shaft, echinus, abacus,
    // then architrave and entablature carrying the pediment.
    box(g, 50, 1.8, 15, 0, 23.5, 76, weathered, 'Principal portico entablature');
    box(g, 50, 1.0, 15, 0, 22.1, 76, light, 'Portico architrave');
    for (const z of [70, 78]) {
      for (let i = 0; i < 12; i++) {
        const x = -27.5 + i * 5;
        cylinder(g, 1.4, 1.4, 0.6, x, 6.8, z, weathered, 20);   // Doric base
        cylinder(g, 1.0, 1.15, 13.5, x, 13.85, z, light, 20);     // shaft
        cylinder(g, 1.25, 1.0, 0.5, x, 20.85, z, light, 20);       // echinus
        box(g, 2.3, 0.5, 2.3, x, 21.35, z, light, 'Doric abacus'); // square abacus
      }
    }
    // Principal pediment over the porch with a sculptural crest, attic behind it, and the
    // full-width entablature and balustrade along the real north facade line.
    const pediment = new THREE.Shape();
    pediment.moveTo(-26, 0); pediment.lineTo(0, 12); pediment.lineTo(26, 0); pediment.closePath();
    mesh(g, new THREE.ExtrudeGeometry(pediment, { depth: 4, bevelEnabled: false }), light, 0, 24.4, 75.5, 'Triangular principal pediment');
    box(g, 3.2, 1.2, 3.2, 0, 37.0, 77.5, stone, 'Pediment crest plinth');
    cylinder(g, 0.55, 0.7, 3.6, 0, 39.2, 77.5, stone, 12);
    mesh(g, new THREE.SphereGeometry(0.55, 12, 10), stone, 0, 41.3, 77.5, 'Pediment crest figure head');
    for (const x of [-24.5, 24.5]) box(g, 1.2, 1.6, 1.2, x, 25.2, 77.5, stone, 'Pediment corner acroterion');
    box(g, 58, 4.2, 12, 0, 26.1, 72, light, 'Portico attic');
    box(g, 160, 1.3, 3.0, 0, 34, 75.2, light, 'North façade entablature');
    for (let x = -78; x <= 78; x += 3.2) {
      box(g, 0.55, 1.5, 0.55, x, 35.4, 75.2, weathered, 'North façade balustrade');
    }
    // Inside the porch: Corinthian columns crowned with Boure's winged lions, the monumental
    // bronze door (Houtstont after Van Mansfeld, 1896), and the bust of the architect
    // Joseph Poelaert (Cuypers, 1887) to the left of the entrance.
    box(g, 10, 14, 0.8, 0, 13.5, 74.6, bronze, 'Bronze entrance door (Houtstont after Van Mansfeld)');
    box(g, 11, 1.2, 1.6, 0, 7.1, 74.4, weathered, 'Bronze door threshold');
    for (const side of [-1, 1]) {
      cylinder(g, 0.5, 0.6, 13.5, side * 6, 13.25, 72, light, 16);
      cylinder(g, 0.85, 0.85, 0.5, side * 6, 20.2, 72, light, 16);
      box(g, 1.7, 0.4, 1.7, side * 6, 20.65, 72, light, 'Corinthian capital');
      const lion = new THREE.Group();
      lion.position.set(side * 6, 21.0, 72);
      mesh(lion, new THREE.SphereGeometry(0.85, 12, 10), bronze, 0, 0.9, 0, 'Winged lion body (A.F. Boure)');
      mesh(lion, new THREE.SphereGeometry(0.45, 10, 8), bronze, 0, 1.9, 0.35, 'Winged lion head (A.F. Boure)');
      for (const w of [-1, 1]) {
        const wing = mesh(lion, new THREE.BoxGeometry(0.12, 1.6, 2.2), bronze, w * 0.9, 1.2, -0.2, 'Winged lion wing');
        wing.rotation.z = w * 0.5;
      }
      g.add(lion);
    }
    box(g, 1.8, 2.2, 1.2, -8, 7.6, 73.5, weathered, 'Poelaert bust pedestal (Cuypers 1887)');
    mesh(g, new THREE.SphereGeometry(0.55, 12, 10), marble, -8, 9.3, 73.5, 'Bust of architect Joseph Poelaert');
    // Two escaliers d'honneur flank the monumental porch, climbing from the forecourt up to
    // the corner pavilions that house the Courts of Cassation and Appeal.
    for (const side of [-1, 1]) {
      // The flight runs from the esplanade paving (bottom tread at y=0.30) up to the pavilion landing.
      for (let step = 0; step < 16; step++) {
        box(g, 14, 0.5, 1.6, side * 40, 0.53 + step * 1.15, 100 - step * 1.6, light, "Escalier d'honneur flight");
      }
      box(g, 16, 3.2, 14, side * 46, 19.5, 79, stone, 'Honour stair landing at corner pavilion');
    }
    // Colossal-order articulation on the north and south ranges: paired pilasters, deep window
    // reveals with lintels and alternating pediments; the monumental porch zone stays clear.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 21; i++) {
        const x = -72 + i * 7.2;
        if (side > 0 && Math.abs(x) < 30) continue;
        const z = side < 0 ? -75 : 75;
        box(g, 2.8, 10.5, 0.32, x, 11.5, z, recess, 'Courthouse lower window');
        box(g, 2.8, 9.5, 0.32, x, 25, z, recess, 'Courthouse upper window');
        box(g, 3.4, 0.4, 0.5, x, 30.2, z, light, 'Upper window lintel');
        if (i % 2 === 0) {
          const p = new THREE.Shape();
          p.moveTo(-1.8, 0); p.lineTo(0, 1.1); p.lineTo(1.8, 0); p.closePath();
          mesh(g, new THREE.ExtrudeGeometry(p, { depth: 0.25, bevelEnabled: false }), light, x, 30.6, z, 'Alternating window pediment');
        }
        box(g, 0.5, 29, 0.5, x - 1.7, 18, side < 0 ? -75.2 : 75.2, light, 'Courthouse paired pilaster west');
        box(g, 0.5, 29, 0.5, x + 1.7, 18, side < 0 ? -75.2 : 75.2, light, 'Courthouse paired pilaster east');
      }
    }
    // The west and east ranges carry the same window rhythm along their street faces.
    for (const x of [80.2, -80.2]) {
      for (let i = 0; i < 15; i++) {
        const z = -66 + i * 9.4;
        box(g, 0.32, 10.5, 2.8, x, 11.5, z, recess, 'Side range lower window');
        box(g, 0.32, 9.5, 2.8, x, 25, z, recess, 'Side range upper window');
        box(g, 0.5, 29, 0.5, x, 18, z - 1.7, light, 'Side range paired pilaster');
      }
    }
    // South facade above rue de Wynants: a pedimented central avant-corps with its own portal.
    box(g, 24, 6, 3, 0, 8, -76.5, ochre, 'South avant-corps rue de Wynants');
    const sp = new THREE.Shape();
    sp.moveTo(-13, 0); sp.lineTo(0, 6); sp.lineTo(13, 0); sp.closePath();
    mesh(g, new THREE.ExtrudeGeometry(sp, { depth: 2, bevelEnabled: false }), light, 0, 11, -76.5, 'South portal pediment rue de Wynants');
    box(g, 6, 9, 0.8, 0, 7.5, -75.8, bronze, 'South portal door rue de Wynants');
    // Eight courts: low paved floors and arcaded inner galleries make the plan readable from above.
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
      const x = -45 + col * 30;
      const z = -24 + row * 48;
      box(g, 24, 0.28, 22, x, 3.45, z, materials.pavingB, 'Interior courthouse court paving');
      // Arcaded galleries on all four sides of every court, as in the real plan.
      for (const edge of [-1, 1]) {
        box(g, 24, 5.5, 0.45, x, 8.0, z + edge * 11, light, 'Court inner arcade');
        box(g, 0.45, 5.5, 22, x + edge * 12, 8.0, z, light, 'Court inner arcade');
        for (let bay = -2; bay <= 2; bay++) {
          box(g, 1.5, 4.0, 0.22, x + bay * 4.5, 8.0, z + edge * 11.25, recess, 'Court arcade opening');
          box(g, 0.22, 4.0, 1.5, x + edge * 12.25, 8.0, z + bay * 4.5, recess, 'Court arcade opening');
        }
      }
    }
    // Central hall and the monumental dome's stepped stylobate. The Salle des Pas Perdus is a
    // 48 x 22 m hall running east-west directly under the dome.
    box(g, 56, 42, 22, 0, 27, 0, light, 'Salle des Pas Perdus central mass (48 x 22 m hall)');
    box(g, 58, 3.0, 54, 0, 48, 0, weathered, 'Dome stylobate lower step');
    box(g, 50, 3.0, 48, 0, 51, 0, light, 'Dome stylobate upper step');
    // Dome stylobate on a Greek-cross plan, rhythmically pierced by paired pilasters
    // (UNESCO tentative list 5357).
    box(g, 30, 5.0, 66, 0, 54.5, 0, stone, 'Stylobate cross arm north-south');
    box(g, 66, 5.0, 30, 0, 54.5, 0, stone, 'Stylobate cross arm east-west');
    for (const [px, pz] of [[-24, 0], [24, 0], [0, -24], [0, 24]]) {
      box(g, 1.2, 5.0, 1.2, px - 0.8, 54.5, pz, weathered, 'Stylobate paired pilaster');
      box(g, 1.2, 5.0, 1.2, px + 0.8, 54.5, pz, weathered, 'Stylobate paired pilaster');
    }
    // Square first drum on a stepped base (base a gradins), open as a colonnade on each side,
    // with solid corner piers and a top ring carrying the circular drum.
    box(g, 45, 2.5, 45, 0, 50.25, 0, weathered, 'Square drum base a gradins lower tier');
    box(g, 42, 2.0, 42, 0, 53.0, 0, weathered, 'Square drum base a gradins upper tier');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, 5, 9, 5, sx * 17, 58.5, sz * 17, stone, 'Square dome drum corner pier');
    }
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2;
      for (let i = 0; i < 7; i++) {
        const t = -15 + i * 5;
        const x = Math.cos(angle) * 20.0 + Math.cos(angle + Math.PI / 2) * t;
        const z = Math.sin(angle) * 20.0 + Math.sin(angle + Math.PI / 2) * t;
        cylinder(g, 0.65, 0.78, 9.5, x, 58.75, z, light, 16);
      }
    }
    box(g, 41, 1.6, 41, 0, 63.4, 0, stone, 'Square dome drum top ring');
    // Circular cornice ledge (r=21 m) carrying the griffins outside the drum wall.
    cylinder(g, 21, 21.5, 1.5, 0, 69, 0, weathered, 32);
    // Eight gilded-copper griffins (winged lions) stand under the dome around the circular gallery.
    const gilded = new THREE.MeshStandardMaterial({ color: 0xc9973f, metalness: 0.62, roughness: 0.38 });
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const x = Math.cos(a) * 20.3, z = Math.sin(a) * 20.3;
      const griffin = new THREE.Group();
      griffin.position.set(x, 69.8, z);
      griffin.rotation.y = Math.PI / 2 - a;
      mesh(griffin, new THREE.SphereGeometry(0.7, 10, 8), gilded, 0, 0.9, 0, 'Griffin body under dome');
      mesh(griffin, new THREE.SphereGeometry(0.38, 8, 6), gilded, 0, 1.6, 0.3, 'Griffin head under dome');
      for (const w of [-1, 1]) {
        const wing = mesh(griffin, new THREE.BoxGeometry(0.1, 1.2, 1.8), gilded, w * 0.75, 1.1, -0.1, 'Griffin wing under dome');
        wing.rotation.z = w * 0.45;
      }
      g.add(griffin);
    }
    // Circular upper drum, marked at its four angles by 5.55 m bronze statues under
    // triangular pediments: the Loi, Justice, Force and Clemence.
    cylinder(g, 17.5, 19.5, 15, 0, 77, 0, light, 32);
    const drumStatues = ['Loi', 'Justice', 'Force', 'Clemence'];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const x = Math.cos(a) * 19.5, z = Math.sin(a) * 19.5;
      box(g, 3.2, 1.5, 3.2, x, 86.5, z, weathered, 'Drum angle statue plinth');
      cylinder(g, 0.6, 0.85, 5.55, x, 90.0, z, bronze, 10);
      mesh(g, new THREE.SphereGeometry(0.55, 10, 8), bronze, x, 93.2, z, drumStatues[k] + ' drum statue head');
      const dp = new THREE.Shape();
      dp.moveTo(-2.4, 0); dp.lineTo(0, 1.8); dp.lineTo(2.4, 0); dp.closePath();
      const dpMesh = mesh(g, new THREE.ExtrudeGeometry(dp, { depth: 2.6, bevelEnabled: false }), weathered, x, 94.0, z, drumStatues[k] + ' drum statue pediment');
      dpMesh.rotation.y = Math.PI / 2 - a;
    }
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24;
      const x = Math.cos(a) * 18.3, z = Math.sin(a) * 18.3;
      box(g, 1.1, 9.0, 1.1, x, 77, z, weathered, 'Circular drum pier');
    }
    cylinder(g, 20.5, 20.5, 1.5, 0, 85, 0, gilded, 32);
    // The dome is copper clad in 275 m2 of gold leaf, with the slightly bombé profile of the
    // 1948 raising (dome raised 2.5 m); it rises to 105 m.
    const domeGeom = new THREE.SphereGeometry(20, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    domeGeom.scale(1, 1.06, 1);
    mesh(g, domeGeom, gilded, 0, 85, 0, 'Gilded copper courthouse dome');
    const meridian = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => {
      const t = i / 8 * Math.PI / 2;
      return new THREE.Vector3(20 * Math.cos(t), 85 + 21.2 * Math.sin(t), 0);
    }));
    const ribGeom = new THREE.TubeGeometry(meridian, 16, 0.22, 6);
    for (let i = 0; i < 16; i++) {
      const rib = mesh(g, ribGeom, gilded, 0, 0, 0, 'Gilded dome rib');
      rib.rotation.y = i * Math.PI * 2 / 16;
    }
    // Colonnaded lantern with a gilded cap: the whole palace tops out at 116 m hors tout.
    // (The 17 m Eurovision antenna on the dome was removed in September 2002.)
    cylinder(g, 5.8, 7.5, 6, 0, 103.5, 0, bronze, 24);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI * 2 / 12;
      cylinder(g, 0.34, 0.42, 8, Math.cos(a) * 6.1, 106, Math.sin(a) * 6.1, light, 10);
    }
    cylinder(g, 7.2, 7.2, 1.2, 0, 110.6, 0, gilded, 24);
    const capGeom = new THREE.SphereGeometry(4.0, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeom.scale(1, 1.1, 1);
    mesh(g, capGeom, gilded, 0, 111.2, 0, 'Courthouse lantern cap');
    cylinder(g, 0.18, 0.3, 0.8, 0, 115.8, 0, gilded, 8);
    // The side facades each carry an axial portal with a small peristyle and a stair down to
    // street level: rue des Minimes on the west (local +X), rue aux Laines on the east; the
    // lower ground floor is entered from rue aux Laines.
    for (const x of [80, -80]) {
      const side = x > 0 ? 1 : -1;
      const street = x > 0 ? 'rue des Minimes' : 'rue aux Laines';
      box(g, 4, 3, 22, x + side * 2, 5, 0, weathered, 'Side entrance landing ' + street);
      for (let i = 0; i < 7; i++) box(g, 1.8, 0.45, 24, side * (84 + (6 - i) * 1.3), 5 + i * 0.45, 0, light, 'Side monumental stair ' + street);
      box(g, 3, 12, 18, x + side * 1.5, 12, 0, stone, 'Side axial portal ' + street);
      for (const z of [-6, 0, 6]) {
        cylinder(g, 0.45, 0.55, 10, x + side * 0.8, 10.5, z, light, 12);
      }
      box(g, 4.5, 1.6, 19, x + side * 1.5, 16.3, 0, light, 'Side portal entablature ' + street);
    }
    // Terrace balustrade and retaining edge, kept distinct from the surrounding streets.
    for (let x = -88; x <= 88; x += 4) {
      box(g, 0.5, 1.2, 0.5, x, 3.9, 88.5, weathered, 'Forecourt terrace baluster');
    }
    // Retaining wall along the esplanade edge, split around the central stair corridor so the
    // monumental emmarchement passes through it unobstructed. The opening (|x| < 38) matches
    // the collision corridor exactly.
    for (const side of [-1, 1]) {
      box(g, 55, 1.8, 3, side * 65.5, 1.6, 90, weathered, 'Place Poelaert retaining wall ' + (side < 0 ? 'west' : 'east'));
    }
    // Place Poelaert itself: the vast paved parvis stretching north from the palace toward
    // rue de la Regence, edged with blue-stone setts.
    box(g, 150, 0.3, 70, 0, 0.15, 126, materials.pavingA, 'Place Poelaert esplanade paving');
    box(g, 152, 0.34, 3, 0, 0.16, 89.8, materials.pavingEdge, 'Place Poelaert south sett border');
    box(g, 152, 0.34, 3, 0, 0.16, 161.2, materials.pavingEdge, 'Place Poelaert north sett border');
    for (const x of [-75, 75]) box(g, 3, 0.34, 72, x, 0.16, 126, materials.pavingEdge, 'Place Poelaert side sett border');
    // Monument national a l'Infanterie Belge (A. De Mol / E. Vereycken, 1935) on the esplanade:
    // a great bluestone obelisk on a raised platform, crowned by a gilded royal crown ringed by
    // four soldiers, with a bronze winged Victory at its foot.
    box(g, 14, 2.5, 14, -35, 1.55, 135, bluestone, 'Infantry monument raised platform');
    const obelisk = mesh(g, new THREE.CylinderGeometry(3.2, 5.4, 26, 4), bluestone, -35, 15.8, 135, 'Infantry monument bluestone obelisk');
    obelisk.rotation.y = Math.PI / 4;
    mesh(g, new THREE.TorusGeometry(2.6, 0.5, 10, 20), gilded, -35, 29.4, 135, 'Gilded royal crown on obelisk');
    for (const [sx, sz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
      cylinder(g, 0.35, 0.45, 3.2, -35 + sx, 28.2, 135 + sz, bronze, 8);
      mesh(g, new THREE.SphereGeometry(0.3, 8, 6), bronze, -35 + sx, 30.1, 135 + sz, 'Obelisk summit soldier');
    }
    const victory = new THREE.Group();
    victory.position.set(-35, 3.4, 142.5);
    mesh(victory, new THREE.SphereGeometry(0.8, 10, 8), bronze, 0, 1.2, 0, 'Winged Victory body (Infantry monument)');
    for (const w of [-1, 1]) {
      const wing = mesh(victory, new THREE.BoxGeometry(0.12, 1.8, 2.6), bronze, w * 1.0, 1.6, -0.3, 'Winged Victory wing');
      wing.rotation.z = w * 0.55;
    }
    g.add(victory);
    // Monument aux soldats britanniques (architect T.S. Tait): about 3 m, a British and a Belgian
    // soldier standing side by side, on the esplanade edge in line with rue de la Regence.
    box(g, 5, 0.5, 5, 34, 0.55, 148, bluestone, 'British monument plinth');
    for (const dx of [-1, 1]) {
      cylinder(g, 0.32, 0.4, 2.2, 34 + dx, 2.2, 148, bronze, 8);
      mesh(g, new THREE.SphereGeometry(0.28, 8, 6), bronze, 34 + dx, 3.5, 148, 'British/Belgian soldier figure');
    }
    // Bronze orientation table after Alexandre Bouffiaux (placed 1928, ateliers Van Aerschodt),
    // giving the view over the lower city toward Anderlecht and Molenbeek.
    cylinder(g, 0.5, 0.7, 1.1, 48, 0.85, 118, bronze, 12);
    mesh(g, new THREE.CylinderGeometry(2.6, 2.6, 0.18, 20), bronze, 48, 1.55, 118, 'Bronze orientation table (Bouffiaux 1928)');
    // The real terrace rests on a massive retaining massif, plainly visible from
    // rue de Wynants (south) and rue des Minimes (west) where the plateau drops to the Marolles.
    box(g, 190, 3.5, 4, 0, -2.6, -90.5, weathered, 'South massif retaining tier (rue de Wynants)');
    box(g, 194, 3.5, 4, 0, -5.9, -92.5, weathered, 'South massif lower tier (rue de Wynants)');
    box(g, 4, 3.5, 181, 95, -2.6, 0, weathered, 'West massif retaining tier (rue des Minimes)');
    box(g, 4, 3.5, 185, 97.5, -5.9, 0, weathered, 'West massif lower tier (rue des Minimes)');
  });
  addLandmark('cinquantenaire', (g) => {
    // Parc du Cinquantenaire: a full architectural ensemble on the great east-west axis.
    // Local +Z is the park's ceremonial front; the triple arch and hemicycle dominate the composition.
    const stone = new THREE.MeshStandardMaterial({ color: 0xd7cdbb, roughness: 0.88 });
    const cutStone = new THREE.MeshStandardMaterial({ color: 0xc4b9a5, roughness: 0.9 });
    const shadow = new THREE.MeshStandardMaterial({ color: 0x343a3b, roughness: 0.85 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x454b49, roughness: 0.92 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x76613d, metalness: 0.58, roughness: 0.55 });
    const arch = new THREE.Group();
    arch.name = 'Cinquantenaire monumental triple triumphal arch';
    g.add(arch);
    // Solid piers define three openings, with the central opening taller and wider.
    for (const x of [-19, -8.4, 8.4, 19]) {
      box(arch, x === -19 || x === 19 ? 4.2 : 3.6, 25, 8, x, 12.5, 0, stone, 'Arcade massive pier');
      box(arch, 4.8, 1.0, 8.8, x, 24.5, 0, cutStone, 'Pier capital');
      box(arch, 4.8, 1.1, 8.8, x, 0.55, 0, cutStone, 'Pier plinth');
    }
    // Three genuine arch rings, each with a dark recessed passage and radial voussoirs.
    function archRing(parent, cx, spring, radius, thickness, depth, name) {
      const shape = new THREE.Shape();
      shape.moveTo(cx - radius, 0); shape.lineTo(cx - radius, spring);
      shape.absarc(cx, spring, radius, Math.PI, 0, true);
      shape.lineTo(cx + radius, 0); shape.closePath();
      const hole = new THREE.Path();
      hole.moveTo(cx - radius + thickness, 0); hole.lineTo(cx - radius + thickness, spring);
      hole.absarc(cx, spring, radius - thickness, Math.PI, 0, true);
      hole.lineTo(cx + radius - thickness, 0); hole.closePath();
      shape.holes.push(hole);
      const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.12, bevelThickness: 0.12, curveSegments: 24 });
      mesh(parent, geom, stone, 0, 0, -depth / 2, name);
      box(parent, radius * 2 - thickness * 2, spring * 1.95, 0.2, cx, spring * 0.96, depth / 2 + 0.12, shadow, name + ' recessed passage');
    }
    archRing(arch, -13.2, 10.5, 5.2, 1.35, 8.6, 'West triumphal arch');
    archRing(arch, 0, 12.4, 8.4, 1.7, 9.0, 'Central triumphal arch');
    archRing(arch, 13.2, 10.5, 5.2, 1.35, 8.6, 'East triumphal arch');
    // Upper attic, inscription band, cornices and balustrade.
    box(arch, 46, 4.0, 9.2, 0, 27, 0, stone, 'Arcade attic');
    box(arch, 48, 0.85, 10, 0, 29.4, 0, cutStone, 'Arcade upper cornice');
    box(arch, 46, 0.7, 9.4, 0, 31.0, 0, stone, 'Arcade crown');
    for (let i = 0; i < 23; i++) box(arch, 0.45, 1.25, 0.45, -22 + i * 2, 31.8, 0, cutStone, 'Attic baluster');
    // Fluted engaged pilasters and paired columns articulate the monumental face.
    for (const x of [-21.2, -16.2, -10.0, -5.0, 5.0, 10.0, 16.2, 21.2]) {
      cylinder(arch, 0.55, 0.65, 8.4, x, 16.0, 4.35, stone, 18);
      cylinder(arch, 0.78, 0.78, 0.45, x, 11.8, 4.35, cutStone, 18);
      cylinder(arch, 0.78, 0.78, 0.45, x, 20.2, 4.35, cutStone, 18);
    }
    // Quadriga: bronze chariot, driver and four rearing horses, modelled as a readable skyline silhouette.
    const q = new THREE.Group();
    q.name = 'Bronze quadriga by Thomas Vinçotte and Jules Lagae';
    q.position.set(0, 32.1, -0.2);
    arch.add(q);
    box(q, 5.8, 1.0, 2.4, 0, 1.4, 0, bronze, 'Quadriga chariot body');
    for (const x of [-2.7, 2.7]) {
      cylinder(q, 1.05, 1.05, 0.28, x, 1.35, -0.25, bronze, 24).rotation.z = Math.PI / 2;
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        cylinder(q, 0.055, 0.055, 1.9, x, 1.35, -0.25, bronze, 6).rotation.set(0, a, Math.PI / 2);
      }
    }
    // Standing allegorical driver with a raised arm and a simple laurel standard.
    cylinder(q, 0.48, 0.62, 2.2, 0, 3.0, 0.1, bronze, 12);
    mesh(q, new THREE.SphereGeometry(0.48, 12, 10), bronze, 0, 4.35, 0.1, 'Quadriga figure head');
    cylinder(q, 0.12, 0.12, 2.1, 0.95, 4.0, 0.1, bronze, 8).rotation.z = -0.8;
    // Four horses across the chariot: body, raised neck/head, and separated legs.
    for (let i = 0; i < 4; i++) {
      const x = -4.5 + i * 3;
      const body = mesh(q, new THREE.SphereGeometry(1.35, 12, 10), bronze, x, 2.3, 1.2, 'Quadriga horse body');
      body.scale.set(1.55, 0.78, 0.72);
      const neck = mesh(q, new THREE.CylinderGeometry(0.48, 0.7, 2.2, 10), bronze, x + (i < 2 ? -0.45 : 0.45), 3.8, 1.1);
      neck.rotation.z = i < 2 ? -0.35 : 0.35;
      mesh(q, new THREE.SphereGeometry(0.62, 10, 8), bronze, x + (i < 2 ? -0.9 : 0.9), 4.8, 1.1, 'Horse head');
      for (const dx of [-0.8, 0.8]) {
        const leg = cylinder(q, 0.13, 0.18, 2.0, x + dx, 1.05, 1.25, bronze, 8);
        leg.rotation.z = dx < 0 ? -0.22 : 0.22;
      }
    }
    // Semicircular double colonnade connecting the arch to the north and south museum pavilions.
    for (let row = 0; row < 2; row++) {
      const radius = row === 0 ? 47 : 53;
      for (let i = 0; i <= 24; i++) {
        const a = Math.PI * (0.12 + 0.76 * i / 24);
        const x = Math.cos(a) * radius;
        const z = 6 + Math.sin(a) * radius * 0.58;
        cylinder(g, 0.52, 0.62, 10.5, x, 5.25, z, stone, 16);
        cylinder(g, 0.78, 0.78, 0.45, x, 0.25, z, cutStone, 16);
        cylinder(g, 0.78, 0.78, 0.45, x, 10.5, z, cutStone, 16);
      }
    }
    // Horizontal entablature segments visually bind the double colonnade into a hemicycle.
    for (const radius of [47, 53]) {
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const a = Math.PI * (0.12 + 0.76 * i / 48);
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 10.65, 6 + Math.sin(a) * radius * 0.58));
      }
      mesh(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 96, 0.65, 8, false), cutStone, 0, 0, 0, 'Hemicycle entablature');
    }
    // Distinct north Bordiau hall and south museum pavilion, flanking the central axis.
    box(g, 34, 19, 26, -69, 9.5, -7, stone, 'North Bordiau exhibition hall');
    box(g, 36, 2.0, 28, -69, 20, -7, cutStone, 'North hall cornice');
    box(g, 36, 2.4, 28, -69, 21.8, -7, roof, 'North hall roof');
    box(g, 33, 17, 24, 69, 8.5, -7, stone, 'South museum pavilion');
    box(g, 35, 1.5, 26, 69, 17.3, -7, cutStone, 'South pavilion cornice');
    box(g, 34, 2.2, 25, 69, 19.0, -7, roof, 'South pavilion roof');
    // Long museum wings with repeated high windows, but lower and quieter than the triumphal arch.
    for (const side of [-1, 1]) {
      box(g, 42, 13, 22, side * 94, 6.5, -8, stone, 'Cinquantenaire museum wing');
      for (let i = 0; i < 7; i++) {
        const x = side * 94 - 17 + i * 5.5;
        box(g, 2.0, 5.0, 0.2, x, 8.0, 3.2, shadow, 'Museum gallery window');
      }
      box(g, 44, 1.1, 23, side * 94, 13.3, -8, cutStone, 'Museum wing cornice');
      box(g, 43, 1.8, 22, side * 94, 14.7, -8, roof, 'Museum wing roof');
    }
    // Axis and formal parterre; preserve open sightline beneath the triple arcade.
    box(g, 26, 0.22, 110, 0, 0.11, 67, materials.pavingEdge, 'Ceremonial esplanade');
    for (let side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        box(g, 10, 0.18, 22, side * (21 + i * 15), 0.09, 68 + (i % 2) * 2, materials.green, 'Formal garden parterre');
      }
      for (let i = 0; i < 7; i++) {
        const x = side * (28 + i * 10);
        cylinder(g, 1.8, 2.1, 5.5, x, 2.75, 35 + (i % 2) * 6, materials.green, 12);
      }
    }
    // Tunnel cut-through: leave a visible open corridor on the western approach rather than filling it with park lawn.
    box(g, 18, 0.12, 52, -115, 0.06, 38, materials.pavingEdge, 'Belliard tunnel approach hardscape');
  });
  addLandmark('europeanParliament', (g) => {
    cylinder(g, 15, 18, 30, 0, 15, 0, materials.glass, 24);
    box(g, 22, 18, 28, 16, 9, 0, materials.glass, 'Parliament wing');
    box(g, 36, 1, 30, 5, 0.5, 0, materials.paleStone);
  });
  addLandmark('koekelbergBasilica', (g) => {
    box(g, 42, 17, 28, 0, 8.5, 0, materials.paleStone, 'Basilica nave');
    mesh(g, new THREE.SphereGeometry(13, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.green, 0, 17, 0);
    for (const x of [-16, 16]) {
      cylinder(g, 3, 4, 22, x, 11, -7, materials.paleStone, 12);
      mesh(g, new THREE.ConeGeometry(3.2, 6, 8), materials.roof, x, 25, -7);
    }
  });

  // ---- Bruxelles Bourse / Beurspaleis (Palais de la Bourse, Leon-Pierre Suys, 1868-1873) ----
  // Local frame: facade front = +Z toward the Place de la Bourse; the anchor is the building
  // centroid (OSM way 13494623) and BOURSE_ROTATION points local +Z at bearing ~306 deg, so the
  // main facade terminates the perspective of the rue Auguste Orts across the square.
  // Greek-cross plan on a high blue-stone socle; a peristyle of eight Corinthian columns under a
  // triangular pediment dated 1873; a central dome on four piers with paired Corinthian
  // pilasters, glazed since 1893, crowned by a circular lantern.
  function pedimentPrism(parent, w, h, d, x, y, z, material, name = '') {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    geo.translate(0, 0, -d / 2);
    return mesh(parent, geo, material, x, y, z, name);
  }
  function corinthColumn(parent, x, y, z, h = 14, r = 0.8, name = 'Corinthian column') {
    const col = new THREE.Group();
    col.name = name;
    col.position.set(x, y, z);
    box(col, r * 2.6, 0.5, r * 2.6, 0, 0.25, 0, materials.warmStone, name + ' base');
    cylinder(col, r * 0.88, r, h, 0, 0.5 + h / 2, 0, materials.paleStone, 12);
    box(col, r * 2.2, 0.3, r * 2.2, 0, h + 0.5, 0, materials.warmStone, name + ' capital');
    box(col, r * 2.9, 0.35, r * 2.9, 0, h + 0.85, 0, materials.warmStone, name + ' abacus');
    parent.add(col);
    return col;
  }
  addLandmark('bourse', (g) => {
    // Round 1: the landmark frame itself — anchor + facade bearing ~306 deg are wired in
    // addLandmark via BOURSE_ROTATION (see js/brussels-frame.js); the builder starts here.
    // Round 2: the high socle (soubassement) is blue stone (petit granit) — "a Bruxelles, le
    // soubassement est d'ordinaire en pierre bleue" (heritage inventory A001/31241) — coursed
    // ashlar in refends, i.e. with incised joint grooves.
    box(g, 106, 5, 82, 0, 2.5, 0, materials.blueStone, 'Bourse blue-stone socle (soubassement en pierre bleue)');
    {
      const refends = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 4.7, 0.05), materials.dark, 27);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 27; i++) {
        dummy.position.set(-52 + i * 4, 2.5, 41.03);
        dummy.updateMatrix();
        refends.setMatrixAt(i, dummy.matrix);
      }
      refends.count = 27;
      refends.name = 'Bourse socle refend joint grooves (calcaire appareille en refends)';
      refends.castShadow = true;
      g.add(refends);
      const course = mesh(g, new THREE.BoxGeometry(106.2, 0.08, 0.06), materials.dark, 0, 2.5, 41.03, 'Bourse socle horizontal course groove');
      course.castShadow = false;
    }
    // Round 3: the monumental stair (escalier monumental) climbs from the square to the peristyle.
    {
      const treads = new THREE.InstancedMesh(new THREE.BoxGeometry(26, 0.25, 0.75), materials.pavingA, 20);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 20; i++) {
        dummy.position.set(0, i * 0.25 + 0.125, 47.6 - i * 0.7);
        dummy.updateMatrix();
        treads.setMatrixAt(i, dummy.matrix);
      }
      treads.count = 20;
      treads.name = 'Bourse monumental stair treads (escalier monumental)';
      treads.castShadow = true;
      treads.receiveShadow = true;
      g.add(treads);
      box(g, 1.4, 5.4, 15.5, -13.7, 2.7, 41.3, materials.blueStone, 'Bourse stair west cheek wall');
      box(g, 1.4, 5.4, 15.5, 13.7, 2.7, 41.3, materials.blueStone, 'Bourse stair east cheek wall');
      box(g, 26, 0.3, 7, 0, 4.9, 34, materials.pavingEdge, 'Bourse stair top landing (portico floor)');
    }
    // Round 4: the peristyle — eight Corinthian columns on a stylobate in front of the cella.
    box(g, 41, 0.4, 4.5, 0, 5.2, 36, materials.paleStone, 'Bourse peristyle stylobate');
    const peristyleX = [-18, -12.86, -7.71, -2.57, 2.57, 7.71, 12.86, 18];
    for (let i = 0; i < 8; i++) corinthColumn(g, peristyleX[i], 5.4, 36, 14, 0.8, 'Bourse peristyle Corinthian column ' + (i + 1));
    // Round 5: the cella wall behind the peristyle, pierced by three doors — the central one
    // arched with a keystone, in the recess of an aedicule supported by two columns.
    box(g, 100, 15, 4, 0, 12.5, 28, materials.paleStone, 'Bourse cella wall (pierre blanche, neo-Renaissance)');
    box(g, 5, 8, 0.6, 0, 9, 30.2, materials.dark, 'Bourse central arched door');
    {
      const arch = mesh(g, new THREE.CylinderGeometry(2.5, 2.5, 0.6, 16, 1, false, 0, Math.PI), materials.dark, 0, 13, 30.2, 'Bourse central door arch');
      arch.rotation.z = Math.PI / 2;
    }
    mesh(g, new THREE.BoxGeometry(0.7, 1.1, 0.25), materials.warmStone, 0, 15.6, 30.45, 'Bourse central door keystone');
    corinthColumn(g, -3.6, 5.4, 31, 8, 0.45, 'Bourse aedicule column west');
    corinthColumn(g, 3.6, 5.4, 31, 8, 0.45, 'Bourse aedicule column east');
    box(g, 9, 1.1, 1.6, 0, 13.7, 30.8, materials.paleStone, 'Bourse aedicule entablature over central door');
    box(g, 3.5, 6, 0.6, -10, 8, 30.2, materials.dark, 'Bourse lateral door west');
    box(g, 3.5, 6, 0.6, 10, 8, 30.2, materials.dark, 'Bourse lateral door east');
    // Round 6: the vast entablature over the columns, its frieze ornamented with a garland of
    // flowers and fruits — the symbol of Abundance (Reflexcity encyclopedia).
    box(g, 104, 3.5, 9, 0, 21.75, 32.5, materials.paleStone, 'Bourse entablature');
    box(g, 104, 0.8, 9.3, 0, 20.4, 32.5, materials.warmStone, 'Bourse architrave band');
    {
      const fruits = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6), materials.ochre, 41);
      const leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.28, 0.1), materials.green, 41);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 41; i++) {
        const x = -50 + i * 2.5;
        dummy.position.set(x, 21.9, 37.05);
        dummy.updateMatrix();
        fruits.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x + 1.25, 22.05, 37.05);
        dummy.updateMatrix();
        leaves.setMatrixAt(i, dummy.matrix);
      }
      fruits.count = 41;
      fruits.name = 'Bourse frieze garland of abundance - fruits (guirlande de fruits)';
      fruits.castShadow = true;
      g.add(fruits);
      leaves.count = 41;
      leaves.name = 'Bourse frieze garland of abundance - flowers and leaves (fleurs et feuilles)';
      leaves.castShadow = true;
      g.add(leaves);
      const modillions = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), materials.warmStone, 52);
      for (let i = 0; i < 52; i++) {
        dummy.position.set(-51 + i * 2, 20.15, 36.9);
        dummy.updateMatrix();
        modillions.setMatrixAt(i, dummy.matrix);
      }
      modillions.count = 52;
      modillions.name = 'Bourse cornice modillions (consoles)';
      modillions.castShadow = true;
      g.add(modillions);
    }
    // Round 7: the triangular pediment dated 1873; its tympanum is sculpted with la Belgique
    // surrounded by two geniuses symbolising Commerce and Industry (Joseph Jacquet). Above the
    // middle door, the archivolt encircling the clock carries the arms of Brussels, flanked by
    // two winged figures of Good and Evil (De Haen).
    pedimentPrism(g, 38, 8.5, 9, 0, 23.5, 32.5, materials.paleStone, 'Bourse triangular pediment dated 1873');
    {
      const belgique = new THREE.Group();
      belgique.name = 'Bourse tympanum la Belgique (Joseph Jacquet)';
      belgique.position.set(0, 26.2, 36.6);
      box(belgique, 1.3, 2.4, 0.5, 0, 1.2, 0, materials.warmStone, 'Belgique figure body');
      mesh(belgique, new THREE.SphereGeometry(0.45, 10, 8), materials.warmStone, 0, 2.7, 0, 'Belgique figure head');
      g.add(belgique);
      for (const sx of [-1, 1]) {
        const genius = new THREE.Group();
        genius.name = 'Bourse tympanum genius ' + (sx < 0 ? 'Commerce' : 'Industrie');
        genius.position.set(sx * 9, 25.4, 36.6);
        box(genius, 1, 1.8, 0.4, 0, 0.9, 0, materials.warmStone, 'genius body');
        mesh(genius, new THREE.SphereGeometry(0.35, 8, 6), materials.warmStone, 0, 2.1, 0, 'genius head');
        box(genius, 0.9, 0.25, 0.25, sx * 0.7, 1.7, 0.15, materials.warmStone, 'genius wing');
        g.add(genius);
      }
      mesh(g, new THREE.BoxGeometry(2.6, 3.2, 0.35), materials.gold, 0, 18.6, 30.35, 'Bourse archivolt arms of Brussels (armes de Bruxelles)');
      const ring = mesh(g, new THREE.CylinderGeometry(4.3, 4.3, 0.5, 20, 1, false, 0, Math.PI), materials.paleStone, 0, 15.9, 30.35, 'Bourse central archivolt encircling the clock');
      ring.rotation.z = Math.PI / 2;
      const clock = mesh(g, new THREE.CylinderGeometry(1.3, 1.3, 0.35, 20), materials.gold, 0, 15.9, 30.6, 'Bourse facade clock above the middle door');
      clock.rotation.x = Math.PI / 2;
      box(g, 0.12, 1.0, 0.06, 0, 15.9, 30.8, materials.dark, 'Bourse clock hour hand');
      for (const sx of [-1, 1]) {
        const winged = new THREE.Group();
        winged.name = 'Bourse Bien/Mal winged figure (De Haen) ' + (sx < 0 ? 'Bien' : 'Mal');
        winged.position.set(sx * 3.4, 15.9, 30.7);
        box(winged, 0.7, 1.6, 0.3, 0, 0.8, 0, materials.bronze, 'winged figure body');
        mesh(winged, new THREE.SphereGeometry(0.3, 8, 6), materials.bronze, 0, 1.8, 0, 'winged figure head');
        box(winged, 0.8, 0.2, 0.2, sx * 0.55, 1.4, 0.1, materials.bronze, 'winged figure wing');
        g.add(winged);
      }
      mesh(g, new THREE.BoxGeometry(2.6, 1.0, 0.25), materials.gold, 0, 32.2, 37.2, 'Bourse pediment date plaque 1873');
    }
    // Round 8: the Greek-cross arms and four corner pavilions around the central block, each
    // arm ending in a pedimented facade; the lateral facades (rue Henri Maus, rue de la Bourse)
    // were opened up with round-arched arcades (Jules Brunfaut 1892-1898).
    box(g, 34, 21, 21, 0, 15.5, 31, materials.paleStone, 'Bourse front arm');
    box(g, 34, 21, 21, 0, 15.5, -31, materials.paleStone, 'Bourse rear arm (rue du Midi side)');
    box(g, 21, 21, 34, -42, 15.5, 0, materials.paleStone, 'Bourse west arm (rue Henri Maus)');
    box(g, 21, 21, 34, 42, 15.5, 0, materials.paleStone, 'Bourse east arm (rue de la Bourse)');
    box(g, 44, 25, 44, 0, 17.5, 0, materials.paleStone, 'Bourse central block');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, 22, 19, 20, sx * 42, 14.5, sz * 31, materials.paleStone, 'Bourse corner pavilion');
      pedimentPrism(g, 22, 4, 20, sx * 42, 24, sz * 31, materials.paleStone, 'Bourse corner pavilion pediment');
    }
    pedimentPrism(g, 34, 5, 8, 0, 26, 38.5, materials.paleStone, 'Bourse front arm end pediment');
    pedimentPrism(g, 34, 5, 8, 0, 26, -38.5, materials.paleStone, 'Bourse rear arm end pediment (curved pediment with Asie/Afrique groups by Van Rasbourg/Rodin)');
    {
      const arcades = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 9, 0.5), materials.dark, 48);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const wx of [-48.5, -42, -35.5]) for (let i = 0; i < 8; i++) {
        dummy.position.set(wx, 12, -14 + i * 4.6);
        dummy.updateMatrix();
        arcades.setMatrixAt(n++, dummy.matrix);
      }
      for (const ex of [48.5, 42, 35.5]) for (let i = 0; i < 8; i++) {
        dummy.position.set(ex, 12, -14 + i * 4.6);
        dummy.updateMatrix();
        arcades.setMatrixAt(n++, dummy.matrix);
      }
      arcades.count = n;
      arcades.name = 'Bourse lateral facade round-arched arcades (facades ajourees, Brunfaut 1892-1898)';
      arcades.castShadow = true;
      g.add(arcades);
    }
    // Round 9: the central dome — four massive piers adorned with paired Corinthian pilasters
    // (bundled Corinthian pilasters), a high drum under a richly ornamented entablature, the
    // original stucco vaulting replaced by curved glazing in 1893, and a circular lantern
    // with a top ornament (bruxellesmabelle.net; heritage inventory A001/31241).
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, 7, 25, 7, sx * 11, 17.5, sz * 11, materials.paleStone, 'Bourse dome pier');
      cylinder(g, 0.5, 0.55, 22, sx * 11 + sx * 3.6, 16, sz * 11, materials.paleStone, 10);
      cylinder(g, 0.5, 0.55, 22, sx * 11, 16, sz * 11 + sz * 3.6, materials.paleStone, 10);
    }
    box(g, 26, 8, 26, 0, 34, 0, materials.paleStone, 'Bourse dome drum on high socle');
    box(g, 27.5, 1.6, 27.5, 0, 38.8, 0, materials.warmStone, 'Bourse dome richly ornamented entablature');
    mesh(g, new THREE.SphereGeometry(14, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.glass, 0, 39.6, 0, 'Bourse glazed dome (verriere, curved glazing since 1893)');
    {
      const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 13.5, 0.5), materials.blueStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        dummy.position.set(Math.sin(a) * 9.9, 46.3, Math.cos(a) * 9.9);
        dummy.rotation.set(Math.cos(a) * 0.72, 0, -Math.sin(a) * 0.72);
        dummy.updateMatrix();
        ribs.setMatrixAt(i, dummy.matrix);
      }
      ribs.count = 8;
      ribs.name = 'Bourse dome transversal arch ribs (arcs transversaux)';
      ribs.castShadow = true;
      g.add(ribs);
    }
    cylinder(g, 3.8, 4.6, 7, 0, 53, 0, materials.paleStone, 16, 'Bourse circular lantern crowning the dome');
    mesh(g, new THREE.ConeGeometry(1.6, 3.2, 12), materials.gold, 0, 60, 0, 'Bourse lantern top ornament (finial)');
    // Round 11: the two front avant-corps pavilions flanking the peristyle, each crowned by
    // its own pediment (heritage inventory A001/31241: strongly structured facade).
    for (const sx of [-1, 1]) {
      box(g, 16, 21, 15, sx * 44, 15.5, 33.5, materials.paleStone, 'Bourse front avant-corps pavilion ' + (sx < 0 ? 'west' : 'east'));
      pedimentPrism(g, 16, 3.5, 3, sx * 44, 26, 40, materials.paleStone, 'Bourse avant-corps pavilion pediment');
      box(g, 16.6, 0.5, 15.6, sx * 44, 25.8, 33.5, materials.warmStone, 'Bourse pavilion cornice');
    }
    // Round 12: facade windows on the wings between the peristyle and the pavilions, ground
    // floor and etage, each in a stone surround.
    {
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 4.6, 0.35), materials.glass, 8);
      const surr = new THREE.InstancedMesh(new THREE.BoxGeometry(2.9, 5.3, 0.25), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const wx of [24, 31]) for (const wy of [10, 17.5]) {
        dummy.position.set(sx * wx, wy, 30.25);
        dummy.updateMatrix();
        wins.setMatrixAt(n, dummy.matrix);
        surr.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n; wins.name = 'Bourse facade windows (rez-de-chaussee + etage)';
      wins.castShadow = true; g.add(wins);
      surr.count = n; surr.name = 'Bourse facade window stone surrounds';
      surr.castShadow = true; g.add(surr);
    }
    // Round 13: rusticated quoin chains (chaines d'angle) at the facade's front corners.
    {
      const quoins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.95, 0.5), materials.warmStone, 44);
      const dummy = new THREE.Object3D();
      let q = 0;
      for (const sx of [-1, 1]) for (let r = 0; r < 22; r++) {
        dummy.position.set(sx * 49.7, 5.6 + r * 0.95, 30.3);
        dummy.updateMatrix();
        quoins.setMatrixAt(q++, dummy.matrix);
      }
      quoins.count = q;
      quoins.name = 'Bourse facade corner quoin chains (chaines d\'angle)';
      quoins.castShadow = true;
      g.add(quoins);
    }
    // Round 14: horizontal string courses (bandeaux) between the facade registers.
    box(g, 100, 0.35, 4.5, 0, 13.5, 28, materials.warmStone, 'Bourse facade first string course (bandeau)');
    box(g, 100, 0.35, 4.5, 0, 19.6, 28, materials.warmStone, 'Bourse facade second string course (bandeau)');
    // Round 15: dentil teeth under the main cornice.
    {
      const dentils = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.3, 0.25), materials.warmStone, 100);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 100; i++) {
        dummy.position.set(-49.5 + i * 1.0, 23.25, 37);
        dummy.updateMatrix();
        dentils.setMatrixAt(i, dummy.matrix);
      }
      dentils.count = 100;
      dentils.name = 'Bourse main cornice dentils';
      dentils.castShadow = true;
      g.add(dentils);
    }
    // Round 16: lion-mouth dripstones (mufles de lion) spaced along the cornice, dripping
    // rainwater clear of the facade (heritage inventory: "a mufle de lion", larmiers).
    {
      const mufles = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.5, 6), materials.warmStone, 26);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 26; i++) {
        dummy.position.set(-50 + i * 4, 23.1, 37.1);
        dummy.rotation.set(Math.PI, 0, 0);
        dummy.updateMatrix();
        mufles.setMatrixAt(i, dummy.matrix);
      }
      mufles.count = 26;
      mufles.name = 'Bourse cornice lion-mouth dripstones (mufles de lion)';
      mufles.castShadow = true;
      g.add(mufles);
    }
    // Round 17: palmettes alternating with the abundance garlands on the frieze (heritage
    // inventory: "frontons a motifs vegetaux, guirlandes d'abondance, palmettes").
    {
      const palmettes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.32, 0.7, 4), materials.gold, 20);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 20; i++) {
        dummy.position.set(-47.5 + i * 5, 22.1, 37.1);
        dummy.rotation.set(0, Math.PI / 4, 0);
        dummy.updateMatrix();
        palmettes.setMatrixAt(i, dummy.matrix);
      }
      palmettes.count = 20;
      palmettes.name = 'Bourse frieze palmettes (palmettes)';
      palmettes.castShadow = true;
      g.add(palmettes);
    }
    // Round 18: raking cornice along the pediment slopes plus acroteria (antefixes) at the
    // apex and both eaves corners.
    {
      const slope = Math.atan2(8.5, 19);
      for (const sx of [-1, 1]) {
        const rail = mesh(g, new THREE.BoxGeometry(0.45, 0.5, 21.5), materials.warmStone, sx * 9.5, 23.5 + 4.25, 32.5, 'Bourse pediment raking cornice');
        rail.rotation.x = sx * -slope;
      }
      const acro = new THREE.InstancedMesh(new THREE.ConeGeometry(0.35, 1.1, 8), materials.warmStone, 3);
      const dummy = new THREE.Object3D();
      const spots = [[0, 32.4], [-18.4, 24], [18.4, 24]];
      for (let i = 0; i < 3; i++) {
        dummy.position.set(spots[i][0], spots[i][1], 32.5);
        dummy.updateMatrix();
        acro.setMatrixAt(i, dummy.matrix);
      }
      acro.count = 3;
      acro.name = 'Bourse pediment acroteria (acroteres)';
      acro.castShadow = true;
      g.add(acro);
    }
    // Round 19: the Corinthian shafts are fluted (futs canneles) — twelve grooves per column.
    {
      const flutes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 13, 5), materials.dark, 96);
      const dummy = new THREE.Object3D();
      let f = 0;
      for (const cx of peristyleX) for (let k = 0; k < 12; k++) {
        const a = k * Math.PI / 6;
        dummy.position.set(cx + Math.cos(a) * 0.78, 12.9, 36 + Math.sin(a) * 0.78);
        dummy.updateMatrix();
        flutes.setMatrixAt(f++, dummy.matrix);
      }
      flutes.count = f;
      flutes.name = 'Bourse peristyle column fluting (futs canneles, 12 per column)';
      flutes.castShadow = false;
      g.add(flutes);
    }
    // Round 20: each column base carries a torus ring moulding.
    {
      const tori = new THREE.InstancedMesh(new THREE.TorusGeometry(1.0, 0.13, 6, 14), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(peristyleX[i], 5.62, 36);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        tori.setMatrixAt(i, dummy.matrix);
      }
      tori.count = 8;
      tori.name = 'Bourse peristyle column base torus rings';
      tori.castShadow = true;
      g.add(tori);
    }
    // Round 21: the stair-flanking lions stand on moulded blue-stone pedestals on the square.
    for (const sx of [-1, 1]) {
      box(g, 3.4, 1.2, 3.4, sx * 14, 0.6, 44, materials.blueStone, 'Bourse lion pedestal');
      box(g, 3.9, 0.3, 3.9, sx * 14, 1.35, 44, materials.warmStone, 'Bourse lion pedestal moulded cap');
    }
    // Round 22: the two great stone lions by the brothers Jean-Joseph and Jacques Jaquet guard
    // the escalier monumental; their posture mirrors the stock market — one head raised (bull,
    // cours en hausse), one head bowed (bear, cours en baisse) (fr.wikipedia Palais de la Bourse).
    let out_ref_bull, out_ref_bear;
    const torchGeniuses = [];
    {
      const bull = new THREE.Group();
      out_ref_bull = bull;
      bull.name = 'Bourse stair lion BULL (head raised, Jean-Joseph Jaquet)';
      bull.position.set(-14, 1.5, 44);
      box(bull, 2.6, 1.5, 1.2, 0, 0.75, 0, materials.warmStone, 'bull lion body');
      mesh(bull, new THREE.SphereGeometry(0.55, 10, 8), materials.warmStone, 0, 2.05, 0.75, 'bull lion head raised');
      mesh(bull, new THREE.TorusGeometry(0.55, 0.18, 6, 12), materials.warmStone, 0, 2.05, 0.45, 'bull lion mane');
      for (const lx of [-0.9, 0.9]) for (const lz of [-0.4, 0.4]) box(bull, 0.32, 0.9, 0.32, lx, 0.45, lz, materials.warmStone, 'bull lion leg');
      cylinder(bull, 0.08, 0.1, 1.0, 0, 1.3, -1.1, materials.warmStone, 6);
      g.add(bull);
      const bear = new THREE.Group();
      out_ref_bear = bear;
      bear.name = 'Bourse stair lion BEAR (head bowed, Jacques Jaquet)';
      bear.position.set(14, 1.5, 44);
      box(bear, 2.6, 1.5, 1.2, 0, 0.75, 0, materials.warmStone, 'bear lion body');
      mesh(bear, new THREE.SphereGeometry(0.55, 10, 8), materials.warmStone, 0, 1.15, 0.8, 'bear lion head bowed');
      mesh(bear, new THREE.TorusGeometry(0.55, 0.18, 6, 12), materials.warmStone, 0, 1.15, 0.5, 'bear lion mane');
      for (const lx of [-0.9, 0.9]) for (const lz of [-0.4, 0.4]) box(bear, 0.32, 0.9, 0.32, lx, 0.45, lz, materials.warmStone, 'bear lion leg');
      cylinder(bear, 0.08, 0.1, 1.0, 0, 1.3, -1.1, materials.warmStone, 6);
      g.add(bear);
    }
    // Round 23: each lion is led by a genius holding a flaming torch (Reflexcity).
    for (const sx of [-1, 1]) {
      const genius = new THREE.Group();
      genius.name = 'Bourse torch genius leading the ' + (sx < 0 ? 'bull' : 'bear') + ' lion';
      genius.position.set(sx * 14, 0, 46.6);
      torchGeniuses.push(genius);
      box(genius, 0.8, 1.7, 0.4, 0, 0.85, 0, materials.warmStone, 'torch genius body');
      mesh(genius, new THREE.SphereGeometry(0.34, 8, 6), materials.warmStone, 0, 1.95, 0, 'torch genius head');
      cylinder(genius, 0.06, 0.06, 0.7, sx * 0.55, 1.6, 0.2, materials.dark, 6);
      mesh(genius, new THREE.ConeGeometry(0.16, 0.45, 6), materials.gold, sx * 0.55, 2.15, 0.2, 'torch flame');
      g.add(genius);
    }
    // Round 24: the group of four allegorical figures on the facade by Guillaume De Groot,
    // symbolising Art, Agriculture, Industry and Science (en.wikipedia Bourse Palace).
    {
      const names = ['Art', 'Agriculture', 'Industrie', 'Science'];
      const spots = [[-44, 28.2, 40.2], [-44, 28.2, 36], [44, 28.2, 40.2], [44, 28.2, 36]];
      for (let i = 0; i < 4; i++) {
        const fig = new THREE.Group();
        fig.name = 'Bourse allegory ' + names[i] + ' (Guillaume De Groot)';
        fig.position.set(spots[i][0], spots[i][1], spots[i][2]);
        box(fig, 1.1, 2.2, 0.45, 0, 1.1, 0, materials.warmStone, names[i] + ' figure body');
        mesh(fig, new THREE.SphereGeometry(0.38, 8, 6), materials.warmStone, 0, 2.5, 0, names[i] + ' figure head');
        g.add(fig);
      }
    }
    // Round 25: the frieze by Carrier-Belleuse with its band of naked children (putti), to
    // which the young Rodin may have contributed (en/nl.wikipedia).
    {
      const putti = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6), materials.warmStone, 8);
      const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.6, 0.25), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const x = -38.5 + i * 11;
        dummy.position.set(x, 24.05, 36.8);
        dummy.updateMatrix();
        putti.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 23.65, 36.8);
        dummy.updateMatrix();
        bodies.setMatrixAt(i, dummy.matrix);
      }
      putti.count = 8; putti.name = 'Bourse Carrier-Belleuse putti frieze heads (Rodin contribution)';
      putti.castShadow = true; g.add(putti);
      bodies.count = 8; bodies.name = 'Bourse Carrier-Belleuse putti frieze bodies';
      bodies.castShadow = true; g.add(bodies);
    }
    // Round 26: the facade clock gets its minute ring and centre boss.
    mesh(g, new THREE.TorusGeometry(1.05, 0.07, 6, 24), materials.dark, 0, 15.9, 30.82, 'Bourse clock minute ring');
    mesh(g, new THREE.SphereGeometry(0.12, 8, 6), materials.dark, 0, 15.9, 30.82, 'Bourse clock centre boss');
    // Round 27: the arms of Brussels on the archivolt shield — the cross on the gilded shield.
    box(g, 0.28, 2.4, 0.12, 0, 18.6, 30.56, materials.canvas, 'Bourse shield cross vertical (armes de Bruxelles)');
    box(g, 1.6, 0.28, 0.12, 0, 18.6, 30.56, materials.canvas, 'Bourse shield cross horizontal (armes de Bruxelles)');
    // Round 28: the tympanum is a sculpted relief panel set in the pediment frame.
    box(g, 33, 6.2, 0.35, 0, 26.9, 37.15, materials.warmStone, 'Bourse tympanum relief panel');
    // Round 29: the three doors are wooden double leaves with panel mouldings and iron studs.
    {
      const leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 7.6, 0.12), materials.dark, 2);
      const studs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 4), materials.warmStone, 36);
      const dummy = new THREE.Object3D();
      dummy.position.set(-1.25, 8.8, 30.55); dummy.updateMatrix(); leaves.setMatrixAt(0, dummy.matrix);
      dummy.position.set(1.25, 8.8, 30.55); dummy.updateMatrix(); leaves.setMatrixAt(1, dummy.matrix);
      leaves.count = 2; leaves.name = 'Bourse central door double leaves (bois, panneaux)';
      leaves.castShadow = true; g.add(leaves);
      let s = 0;
      for (const dx of [-10, 10]) for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
        dummy.position.set(dx - 1.5 + c * 0.6, 6.6 + r * 2.2, 30.55);
        dummy.updateMatrix();
        studs.setMatrixAt(s++, dummy.matrix);
      }
      studs.count = s; studs.name = 'Bourse lateral door iron studs (clous)';
      g.add(studs);
    }
    // Round 30: arched cella windows beside the central aedicule, with transom bars.
    for (const sx of [-1, 1]) {
      box(g, 2.6, 4.4, 0.3, sx * 6.5, 11.5, 30.25, materials.glass, 'Bourse cella arched window');
      const arch = mesh(g, new THREE.CylinderGeometry(1.3, 1.3, 0.3, 12, 1, false, 0, Math.PI), materials.glass, sx * 6.5, 13.7, 30.25, 'Bourse cella window arch');
      arch.rotation.z = Math.PI / 2;
      box(g, 0.12, 4.4, 0.34, sx * 6.5, 11.5, 30.28, materials.dark, 'Bourse cella window transom bar');
    }
    // Round 31: slate gable roofs over the four Greek-cross arms, with ridge lines.
    pedimentPrism(g, 34, 4.5, 21, 0, 26, 31, materials.slate, 'Bourse front arm slate gable roof');
    pedimentPrism(g, 34, 4.5, 21, 0, 26, -31, materials.slate, 'Bourse rear arm slate gable roof (rue du Midi)');
    {
      const westRoof = pedimentPrism(g, 34, 4.5, 21, -42, 26, 0, materials.slate, 'Bourse west arm slate gable roof (rue Henri Maus)');
      westRoof.rotation.y = Math.PI / 2;
      const eastRoof = pedimentPrism(g, 34, 4.5, 21, 42, 26, 0, materials.slate, 'Bourse east arm slate gable roof (rue de la Bourse)');
      eastRoof.rotation.y = Math.PI / 2;
      for (const [rx, rz] of [[0, 31], [0, -31], [-42, 0], [42, 0]]) {
        if (rx === 0) box(g, 0.5, 0.25, 20, rx, 30.6, rz, materials.roof, 'Bourse roof ridge line');
        else box(g, 20, 0.25, 0.5, rx, 30.6, rz, materials.roof, 'Bourse roof ridge line');
      }
    }
    // Round 32: slate dormers (lucarnes) on the arm roof slopes.
    {
      const dormers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 2.4, 1.6), materials.slate, 12);
      const caps = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 1.2, 4), materials.slate, 12);
      const dummy = new THREE.Object3D();
      let d2 = 0;
      const spots = [[-10, 31, 27.6], [10, 31, 27.6], [-10, -31, 27.6], [10, -31, 27.6], [-42, -10, 27.6], [-42, 10, 27.6], [42, -10, 27.6], [42, 10, 27.6],
        [-46, 31, 24.2], [46, 31, 24.2], [-46, -31, 24.2], [46, -31, 24.2]];
      for (const [dx, dz, dy] of spots) {
        dummy.position.set(dx, dy, dz);
        dummy.updateMatrix();
        dormers.setMatrixAt(d2, dummy.matrix);
        dummy.position.set(dx, dy + 1.8, dz);
        dummy.updateMatrix();
        caps.setMatrixAt(d2++, dummy.matrix);
      }
      dormers.count = d2; dormers.name = 'Bourse arm roof dormers (lucarnes)';
      dormers.castShadow = true; g.add(dormers);
      caps.count = d2; caps.name = 'Bourse dormer caps';
      caps.castShadow = true; g.add(caps);
    }
    // Round 33: chimney stacks with stone cap slabs on the arm roofs.
    {
      const stacks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 3.2, 1.2), materials.warmStone, 6);
      const caps2 = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.3, 1.7), materials.paleStone, 6);
      const dummy = new THREE.Object3D();
      const spots = [[-14, 24, 29.5], [14, 24, 29.5], [-14, -24, 29.5], [14, -24, 29.5], [-46, 6, 29.5], [46, -6, 29.5]];
      for (let i = 0; i < 6; i++) {
        dummy.position.set(spots[i][0], spots[i][2], spots[i][1]);
        dummy.updateMatrix();
        stacks.setMatrixAt(i, dummy.matrix);
        dummy.position.set(spots[i][0], spots[i][2] + 1.75, spots[i][1]);
        dummy.updateMatrix();
        caps2.setMatrixAt(i, dummy.matrix);
      }
      stacks.count = 6; stacks.name = 'Bourse chimney stacks';
      stacks.castShadow = true; g.add(stacks);
      caps2.count = 6; caps2.name = 'Bourse chimney cap slabs';
      caps2.castShadow = true; g.add(caps2);
    }
    // Round 34: the four corner pavilions carry hipped slate roofs with finials.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      mesh(g, new THREE.ConeGeometry(11.2, 5, 4), materials.slate, sx * 42, 26.5, sz * 31, 'Bourse corner pavilion hipped slate roof');
      mesh(g, new THREE.SphereGeometry(0.5, 8, 6), materials.gold, sx * 42, 29.4, sz * 31, 'Bourse pavilion roof finial');
    }
    // Round 35: the rear facade (rue du Midi side) is crowned by a curved pediment with the
    // sculptural groups L'Asie and L'Afrique by Van Rasbourg, executed largely by Rodin in 1871
    // (arau.org heritage analysis; monument.heritage.brussels A001/31241).
    {
      for (const sx of [-1, 1]) {
        const grp = new THREE.Group();
        grp.name = 'Bourse rear pediment group ' + (sx < 0 ? 'L\'Asie' : 'L\'Afrique') + ' (Van Rasbourg/Rodin 1871)';
        grp.position.set(sx * 8, 27.5, -40.5);
        box(grp, 1.4, 2.6, 0.5, 0, 1.3, 0, materials.warmStone, 'group central figure');
        mesh(grp, new THREE.SphereGeometry(0.42, 8, 6), materials.warmStone, 0, 2.9, 0, 'group head');
        box(grp, 0.9, 1.8, 0.4, sx * 1.4, 0.9, 0.1, materials.warmStone, 'group attendant');
        g.add(grp);
      }
    }
    // Round 36: on the rear upper level, two couples of caryatids designed by Rodin and signed
    // Antoine-Joseph Van Rasbourgh — Protection, Commerce, Art, Victory — lean on the trumeaux
    // of the three arched bays and support the entablature (en.wikipedia; nl.wikipedia).
    {
      const names = ['Protection', 'Commerce', 'Art', 'Victoire'];
      const xs = [-7.5, -2.5, 2.5, 7.5];
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Group();
        c.name = 'Bourse caryatid ' + names[i] + ' (Rodin design, Van Rasbourgh)';
        c.position.set(xs[i], 20, -41.2);
        box(c, 0.9, 3.4, 0.4, 0, 1.7, 0, materials.warmStone, names[i] + ' caryatid body');
        mesh(c, new THREE.SphereGeometry(0.32, 8, 6), materials.warmStone, 0, 3.75, 0, names[i] + ' caryatid head');
        box(c, 1.1, 0.3, 0.5, 0, 3.5, 0, materials.warmStone, names[i] + ' caryatid capital block');
        g.add(c);
      }
    }
    // Round 37: above the caryatids, a globe carried by two putti (en.wikipedia).
    {
      mesh(g, new THREE.SphereGeometry(1.2, 14, 10), materials.bronze, 0, 25.2, -41.2, 'Bourse globe above the caryatids');
      for (const sx of [-1, 1]) {
        const p = new THREE.Group();
        p.name = 'Bourse putti carrying the globe ' + (sx < 0 ? 'west' : 'east');
        p.position.set(sx * 1.6, 23.4, -41.2);
        box(p, 0.5, 1.0, 0.3, 0, 0.5, 0, materials.warmStone, 'putto body');
        mesh(p, new THREE.SphereGeometry(0.26, 8, 6), materials.warmStone, 0, 1.2, 0, 'putto head');
        g.add(p);
      }
    }
    // Round 38: the central parts of the lateral facades (rue Henri Maus, rue de la Bourse)
    // were opened up (ajourees) with great arched openings — Jules Brunfaut 1890-1893 and the
    // 1930-1950 works (nl.wikipedia Beurspaleis; Reflexcity).
    {
      const great = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 11, 0.5), materials.glass, 6);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const wx of [-53.2, 53.2]) for (let i = 0; i < 3; i++) {
        dummy.position.set(wx, 13, -8 + i * 8);
        dummy.updateMatrix();
        great.setMatrixAt(n++, dummy.matrix);
      }
      great.count = n;
      great.name = 'Bourse side facade central ajouree great arches (Brunfaut 1890-93 / 1930-50)';
      great.castShadow = true;
      g.add(great);
    }
    // Round 39: the 2020-2023 restoration (Robbrecht & Daem, Baneton-Garrino, Popoff) created a
    // roof terrace (toiture-terrasse) on the 4th floor of the rear arm, with a balustrade.
    {
      box(g, 30, 0.25, 16, 0, 30.8, -31, materials.pavingA, 'Bourse toiture-terrasse slab (roof terrace, 2023)');
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 1.0, 0.18), materials.warmStone, 40);
      const dummy = new THREE.Object3D();
      let p = 0;
      for (let i = 0; i < 20; i++) {
        dummy.position.set(-14.5 + i * 1.5, 31.4, -38.6);
        dummy.updateMatrix(); posts.setMatrixAt(p++, dummy.matrix);
        dummy.position.set(-14.5 + i * 1.5, 31.4, -23.4);
        dummy.updateMatrix(); posts.setMatrixAt(p++, dummy.matrix);
      }
      posts.count = p;
      posts.name = 'Bourse roof terrace balustrade posts';
      posts.castShadow = true;
      g.add(posts);
      box(g, 30, 0.12, 0.2, 0, 31.95, -38.6, materials.warmStone, 'Bourse roof terrace balustrade top rail south');
      box(g, 30, 0.12, 0.2, 0, 31.95, -23.4, materials.warmStone, 'Bourse roof terrace balustrade top rail north');
    }
    // Round 40: the roof was converted into a panorama bar with terrace, covered by a brass
    // canopy (luifel en laiton / messing) — Belgian Beer World opening September 2023.
    {
      const canopy = box(g, 20, 0.18, 20, 0, 46.5, 0, materials.gold, 'Bourse brass canopy over the panorama bar (luifel, 2023)');
      canopy.castShadow = true;
      for (let i = 0; i < 4; i++) {
        const rib = box(g, 0.25, 0.25, 19, -7.5 + i * 5, 46.35, 0, materials.gold, 'Bourse brass canopy rib');
        rib.castShadow = false;
      }
    }
    // Round 41: the 2020-2023 restoration cut a new contemporary entrance into the blue-stone
    // socle on the side opposite the great staircase, black granito with gilded brass, prolonging
    // the parvis of Saint-Nicolas (La Libre, 2023).
    {
      const recess = box(g, 7, 4.2, 1.2, 0, 2.1, -41.4, materials.dark, 'Bourse 2023 entrance recess in the blue-stone socle (granito noir)');
      recess.castShadow = true;
      box(g, 8.2, 0.25, 1.6, 0, 4.35, -41.4, materials.gold, 'Bourse 2023 entrance gilded brass lintel');
      box(g, 0.25, 4.2, 1.6, -3.9, 2.1, -41.4, materials.gold, 'Bourse 2023 entrance brass jamb west');
      box(g, 0.25, 4.2, 1.6, 3.9, 2.1, -41.4, materials.gold, 'Bourse 2023 entrance brass jamb east');
    }
    // Round 42: the new entrance's granito floor strip and brass threshold.
    box(g, 6.5, 0.12, 3.2, 0, 0.06, -42.6, materials.pavingEdge, 'Bourse 2023 entrance granito floor');
    box(g, 6.5, 0.18, 0.3, 0, 0.09, -41.2, materials.gold, 'Bourse 2023 entrance brass threshold');
    // Round 43: the socle is opened by utility doors with straight lintels giving access to
    // service rooms (heritage inventory: "portes a linteau droit ... locaux utilitaires").
    {
      const doors = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 3, 0.2), materials.dark, 8);
      const lintels = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.35, 0.3), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const x = -38.5 + i * 11;
        dummy.position.set(x, 1.6, 41.08);
        dummy.updateMatrix();
        doors.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 3.3, 41.1);
        dummy.updateMatrix();
        lintels.setMatrixAt(i, dummy.matrix);
      }
      doors.count = 8; doors.name = 'Bourse socle utility doors (portes a linteau droit)';
      doors.castShadow = true; g.add(doors);
      lintels.count = 8; lintels.name = 'Bourse socle door straight lintels';
      lintels.castShadow = true; g.add(lintels);
    }
    // Round 44: iron window grilles in the socle above the utility doors (fer forge).
    {
      const grilles = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.9, 0.12), materials.dark, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(-38.5 + i * 11, 4.15, 41.08);
        dummy.updateMatrix();
        grilles.setMatrixAt(i, dummy.matrix);
      }
      grilles.count = 8;
      grilles.name = 'Bourse socle basement window iron grilles (grilles en fer forge)';
      g.add(grilles);
    }
    // Round 45: a sloped water-table moulding (bandeau / water table) caps the blue-stone socle.
    box(g, 106.8, 0.4, 82.8, 0, 4.85, 0, materials.warmStone, 'Bourse socle water-table moulding (bandeau)');
    // Round 46: the palace facade is floodlit after dark — bracket-mounted floodlight heads on
    // the cella, registered for the night glow pass like the Grand-Place windows.
    {
      const floodGlow = materials.gold.clone();
      floodGlow.emissive = new THREE.Color(0x000000);
      nightGlowMats.push(floodGlow);
      const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), floodGlow, 10);
      const brackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), materials.dark, 10);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 10; i++) {
        const x = -40 + i * 8.9;
        dummy.position.set(x, 6.2, 30.6);
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 5.6, 30.5);
        dummy.updateMatrix();
        brackets.setMatrixAt(i, dummy.matrix);
      }
      heads.count = 10; heads.name = 'Bourse facade floodlight heads (night floodlighting, bracket-mounted)';
      heads.castShadow = true; g.add(heads);
      brackets.count = 10; brackets.name = 'Bourse floodlight brackets';
      g.add(brackets);
    }
    // Round 47: lead rainwater downpipes at the facade front corners, with hopper heads.
    {
      const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 23, 6), materials.dark, 4);
      const hoppers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.12, 0.4, 8), materials.dark, 4);
      const dummy = new THREE.Object3D();
      let p = 0;
      for (const sx of [-1, 1]) for (const sz of [1, -1]) {
        dummy.position.set(sx * 49.6, 11.5, sz * 30.4);
        dummy.updateMatrix();
        pipes.setMatrixAt(p, dummy.matrix);
        dummy.position.set(sx * 49.6, 22.9, sz * 30.4);
        dummy.updateMatrix();
        hoppers.setMatrixAt(p++, dummy.matrix);
      }
      pipes.count = p; pipes.name = 'Bourse facade lead downpipes (descentes en plomb)';
      g.add(pipes);
      hoppers.count = p; hoppers.name = 'Bourse downpipe hopper heads';
      g.add(hoppers);
    }
    // Round 48: hood moulds (larmiers) with label stops above each facade window.
    {
      const hoods = new THREE.InstancedMesh(new THREE.BoxGeometry(3.1, 0.22, 0.45), materials.warmStone, 8);
      const stops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const wx of [24, 31]) for (const wy of [10, 17.5]) {
        dummy.position.set(sx * wx, wy + 2.8, 30.3);
        dummy.updateMatrix();
        hoods.setMatrixAt(n, dummy.matrix);
        dummy.position.set(sx * wx, wy + 2.8, 30.55);
        dummy.updateMatrix();
        stops.setMatrixAt(n++, dummy.matrix);
      }
      hoods.count = n; hoods.name = 'Bourse facade window hood moulds (larmiers)';
      hoods.castShadow = true; g.add(hoods);
      stops.count = n; stops.name = 'Bourse hood label stops';
      g.add(stops);
    }
    // Round 49: stone sill brackets under the facade windows.
    {
      const sills = new THREE.InstancedMesh(new THREE.ConeGeometry(0.28, 0.35, 4), materials.warmStone, 16);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const wx of [24, 31]) for (const wy of [10, 17.5]) for (const bx of [-1, 1]) {
        dummy.position.set(sx * wx + bx * 1.1, wy - 2.5, 30.35);
        dummy.rotation.set(Math.PI, 0, 0);
        dummy.updateMatrix();
        sills.setMatrixAt(n++, dummy.matrix);
      }
      sills.count = n;
      sills.name = 'Bourse facade window sill brackets (consoles d\'appui)';
      g.add(sills);
    }
    // Round 50: round attic oculi (oeil-de-boeuf) in the two avant-corps pavilion pediments.
    for (const sx of [-1, 1]) {
      const oculus = mesh(g, new THREE.CylinderGeometry(0.9, 0.9, 0.3, 16), materials.glass, sx * 44, 28.2, 40.4, 'Bourse pavilion pediment oculus (oeil-de-boeuf)');
      oculus.rotation.x = Math.PI / 2;
      mesh(g, new THREE.TorusGeometry(0.9, 0.12, 6, 16), materials.warmStone, sx * 44, 28.2, 40.4, 'Bourse oculus stone surround');
    }
    // Round 81: Corinthian capitals carry two rows of acanthus leaves and four corner volutes.
    {
      const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.5, 4), materials.warmStone, 8 * 10);
      const volutes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), materials.warmStone, 8 * 4);
      const dummy = new THREE.Object3D();
      let n = 0, v = 0;
      for (const cx of peristyleX) {
        for (let k = 0; k < 10; k++) {
          const a = k * Math.PI / 5;
          dummy.position.set(cx + Math.cos(a) * 0.95, 5.4 + 14 + 0.62, 36 + Math.sin(a) * 0.95);
          dummy.rotation.set(Math.PI / 2 - 0.5, 0, -a);
          dummy.updateMatrix();
          leaves.setMatrixAt(n++, dummy.matrix);
        }
        for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
          dummy.position.set(cx + Math.cos(a) * 1.15, 5.4 + 14 + 0.72, 36 + Math.sin(a) * 1.15);
          dummy.updateMatrix();
          volutes.setMatrixAt(v++, dummy.matrix);
        }
      }
      leaves.count = n; leaves.name = 'Bourse Corinthian capital acanthus leaves (2 rows, 8 columns)';
      leaves.castShadow = true; g.add(leaves);
      volutes.count = v; volutes.name = 'Bourse Corinthian capital corner volutes (volutes d\'angle)';
      volutes.castShadow = true; g.add(volutes);
    }
    // Round 82: a necking ring (annelet) below each capital's abacus.
    {
      const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.85, 0.08, 6, 14), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(peristyleX[i], 5.4 + 14 + 0.42, 36);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        rings.setMatrixAt(i, dummy.matrix);
      }
      rings.count = 8;
      rings.name = 'Bourse capital necking rings (annelets)';
      g.add(rings);
    }
    // Round 83: the entablature carries cyma recta and cyma reversa mouldings above and below
    // the frieze (classical order mouldings).
    box(g, 104, 0.3, 9.4, 0, 23.35, 32.5, materials.warmStone, 'Bourse cornice cyma recta (moulure superieure)');
    box(g, 104, 0.3, 9.4, 0, 20.05, 32.5, materials.warmStone, 'Bourse architrave cyma reversa (moulure inferieure)');
    // Round 84: the projecting corona slab and bed moulding of the main cornice.
    box(g, 104.6, 0.22, 9.8, 0, 23.6, 32.5, materials.paleStone, 'Bourse cornice corona (tablette saillante)');
    box(g, 104.3, 0.18, 9.6, 0, 23.75, 32.5, materials.warmStone, 'Bourse cornice bed moulding');
    // Round 85: round medallions set in the frieze between the abundance garlands.
    {
      const medallions = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.15, 16), materials.warmStone, 20);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 20; i++) {
        dummy.position.set(-47.5 + i * 5, 21.9, 37.12);
        dummy.rotation.x = Math.PI / 2;
        dummy.updateMatrix();
        medallions.setMatrixAt(i, dummy.matrix);
      }
      medallions.count = 20;
      medallions.name = 'Bourse frieze medallions (medaillons) between the garlands';
      medallions.castShadow = true;
      g.add(medallions);
    }
    // Round 86: garland swags (guirlandes en feston) draped between the medallions.
    {
      const swags = new THREE.InstancedMesh(new THREE.TorusGeometry(1.15, 0.09, 6, 12, Math.PI), materials.ochre, 20);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 20; i++) {
        dummy.position.set(-45 + i * 5, 22.15, 37.1);
        dummy.rotation.set(0, 0, Math.PI);
        dummy.updateMatrix();
        swags.setMatrixAt(i, dummy.matrix);
      }
      swags.count = 20;
      swags.name = 'Bourse frieze garland swags (guirlandes en feston)';
      swags.castShadow = true;
      g.add(swags);
    }
    // Round 87: the central archivolt is built of voussoir wedges.
    {
      const voussoirs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.6, 0.55), materials.warmStone, 9);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 9; i++) {
        const a = (i / 8) * Math.PI;
        dummy.position.set(Math.sin(a) * 4.3, 15.9 + Math.cos(a) * 4.3, 30.35);
        dummy.rotation.set(0, 0, -a);
        dummy.updateMatrix();
        voussoirs.setMatrixAt(i, dummy.matrix);
      }
      voussoirs.count = 9;
      voussoirs.name = 'Bourse central archivolt voussoirs (voussoirs)';
      voussoirs.castShadow = true;
      g.add(voussoirs);
    }
    // Round 88: the archivolt's keystone is a larger wedge at the crown.
    mesh(g, new THREE.BoxGeometry(0.9, 1.0, 0.6), materials.warmStone, 0, 20.35, 30.35, 'Bourse archivolt keystone (clef d\'arc)');
    // Round 89: the tympanum relief sits on a plinth slab with two attendant figures flanking
    // la Belgique.
    box(g, 30, 0.5, 0.4, 0, 24.2, 37.2, materials.warmStone, 'Bourse tympanum relief plinth slab');
    for (const sx of [-1, 1]) {
      const att = new THREE.Group();
      att.name = 'Bourse tympanum attendant figure ' + (sx < 0 ? 'west' : 'east');
      att.position.set(sx * 13.5, 25.2, 36.7);
      box(att, 0.8, 1.6, 0.35, 0, 0.8, 0, materials.warmStone, 'attendant body');
      mesh(att, new THREE.SphereGeometry(0.3, 8, 6), materials.warmStone, 0, 1.85, 0, 'attendant head');
      g.add(att);
    }
    // Round 90: dentils along the pediment's raking cornice.
    {
      const dentils = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.28, 0.3), materials.warmStone, 36);
      const dummy = new THREE.Object3D();
      const slope = Math.atan2(8.5, 19);
      for (let i = 0; i < 18; i++) {
        for (const sx of [-1, 1]) {
          dummy.position.set(sx * (1 + i * 1.02), 23.5 + (1 + i * 1.02) * Math.tan(slope), 37.1);
          dummy.rotation.set(sx * -slope, 0, 0);
          dummy.updateMatrix();
          dentils.setMatrixAt(i * 2 + (sx < 0 ? 0 : 1), dummy.matrix);
        }
      }
      dentils.count = 36;
      dentils.name = 'Bourse pediment raking cornice dentils';
      g.add(dentils);
    }
    // Round 91: stone balustrade parapets run up both sides of the monumental stair.
    {
      const slope = Math.atan2(5, 14);
      for (const sx of [-1, 1]) {
        const parapet = box(g, 1.0, 1.1, 15.5, sx * 13.2, 3.1, 41, materials.blueStone, 'Bourse stair balustrade parapet ' + (sx < 0 ? 'west' : 'east'));
        parapet.rotation.z = sx * -slope;
        box(g, 1.2, 0.18, 15.5, sx * 13.2, 3.75, 41, materials.warmStone, 'Bourse stair parapet coping (chaperon)');
      }
    }
    // Round 92: newel posts with urn finials at the stair foot and head, both sides.
    {
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 1.5, 0.55), materials.blueStone, 4);
      const urns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 6), materials.warmStone, 4);
      const dummy = new THREE.Object3D();
      const spots = [[-13.2, 47.8], [13.2, 47.8], [-13.2, 34.2], [13.2, 34.2]];
      for (let i = 0; i < 4; i++) {
        dummy.position.set(spots[i][0], 0.75, spots[i][1]);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
        dummy.position.set(spots[i][0], 1.75, spots[i][1]);
        dummy.updateMatrix();
        urns.setMatrixAt(i, dummy.matrix);
      }
      posts.count = 4; posts.name = 'Bourse stair newel posts (poteaux de depart)';
      posts.castShadow = true; g.add(posts);
      urns.count = 4; urns.name = 'Bourse newel urn finials (vases)';
      urns.castShadow = true; g.add(urns);
    }
    // Round 93: a lighter nosing strip (bande de rive) on the front edge of every tread.
    {
      const nosings = new THREE.InstancedMesh(new THREE.BoxGeometry(26, 0.06, 0.18), materials.pavingEdge, 20);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 20; i++) {
        dummy.position.set(0, i * 0.25 + 0.26, 47.6 - i * 0.7 - 0.33);
        dummy.updateMatrix();
        nosings.setMatrixAt(i, dummy.matrix);
      }
      nosings.count = 20;
      nosings.name = 'Bourse stair tread nosings (bandes de rive)';
      nosings.receiveShadow = true;
      g.add(nosings);
    }
    // Round 94: a moulded edge band on the portico landing.
    box(g, 26.4, 0.25, 0.5, 0, 5.05, 34.4, materials.warmStone, 'Bourse portico landing edge moulding (bandeau de rive)');
    // Round 95: the bull lion (head raised) gets open jaw, eye, raised foreleg and curled tail.
    {
      const b = out_ref_bull;
      mesh(b, new THREE.BoxGeometry(0.28, 0.16, 0.1), materials.dark, 0.2, 2.1, 1.28, 'bull lion open jaw');
      mesh(b, new THREE.SphereGeometry(0.07, 6, 5), materials.dark, 0.25, 2.12, 0.95, 'bull lion eye');
      box(b, 0.34, 0.9, 0.34, 1.0, 1.35, 0.3, materials.warmStone, 'bull lion raised foreleg');
      const tail = cylinder(b, 0.07, 0.05, 0.9, -1.1, 1.6, -0.6, materials.warmStone, 6);
      tail.rotation.z = 0.9;
      mesh(b, new THREE.SphereGeometry(0.1, 6, 5), materials.warmStone, -1.45, 1.95, -0.75, 'bull lion tail tuft');
    }
    // Round 96: the bear lion (head bowed) gets lowered jaw, eye, planted foreleg and tail.
    {
      const b = out_ref_bear;
      mesh(b, new THREE.BoxGeometry(0.28, 0.14, 0.1), materials.dark, 0.2, 1.1, 1.3, 'bear lion lowered jaw');
      mesh(b, new THREE.SphereGeometry(0.07, 6, 5), materials.dark, 0.25, 1.22, 0.95, 'bear lion eye');
      box(b, 0.34, 0.55, 0.34, 1.0, 0.55, 0.35, materials.warmStone, 'bear lion planted foreleg');
      const tail = cylinder(b, 0.07, 0.05, 0.9, -1.1, 1.5, -0.6, materials.warmStone, 6);
      tail.rotation.z = 0.7;
      mesh(b, new THREE.SphereGeometry(0.1, 6, 5), materials.warmStone, -1.4, 1.8, -0.7, 'bear lion tail tuft');
    }
    // Round 97: each lion pedestal carries plinth base and cap mouldings.
    for (const sx of [-1, 1]) {
      box(g, 4.1, 0.22, 4.1, sx * 14, 0.11, 44, materials.warmStone, 'Bourse lion pedestal plinth base');
      box(g, 4.3, 0.18, 4.3, sx * 14, 1.44, 44, materials.warmStone, 'Bourse lion pedestal cap moulding');
    }
    // Round 98: each torch genius holds a torch bowl (coupe) with a flame.
    for (const grp of torchGeniuses) {
      const sx = grp.position.x < 0 ? -1 : 1;
      mesh(grp, new THREE.CylinderGeometry(0.18, 0.08, 0.22, 8), materials.dark, sx * 0.55, 1.95, 0.2, 'torch bowl (coupe)');
      mesh(grp, new THREE.ConeGeometry(0.14, 0.4, 6), materials.gold, sx * 0.55, 2.3, 0.2, 'torch flame (flamme)');
    }
    // Round 99: a collar and lead chain from each genius's hand to its lion (the geniuses
    // "conduisent" the lions — Reflexcity).
    for (const sx of [-1, 1]) {
      const lion = sx < 0 ? out_ref_bull : out_ref_bear;
      mesh(lion, new THREE.TorusGeometry(0.5, 0.07, 6, 12), materials.bronze, 0, 1.9, 0.55, 'lion collar (collier)');
      const lead = cylinder(g, 0.03, 0.03, 3.2, sx * 14, 1.6, 45.3, materials.bronze, 5);
      lead.rotation.x = 0.5;
    }
    // Round 100: sloped caps (chaperons) on the stair cheek walls.
    for (const sx of [-1, 1]) {
      const cap = box(g, 1.7, 0.22, 15.5, sx * 13.7, 5.55, 41.3, materials.warmStone, 'Bourse stair cheek wall cap (chaperon)');
      cap.rotation.z = sx * -Math.atan2(5, 14);
    }
    // Round 101: the high drum is pierced by round oculi (heritage inventory: dome on high
    // socle under a richly ornamented entablature).
    {
      const oculi = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.0, 1.0, 0.4, 14), materials.glass, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) * Math.PI / 4;
        dummy.position.set(Math.sin(a) * 13.2, 34, Math.cos(a) * 13.2);
        dummy.rotation.y = -a;
        dummy.updateMatrix();
        oculi.setMatrixAt(i, dummy.matrix);
      }
      oculi.count = 8;
      oculi.name = 'Bourse dome drum oculi (oeils-de-boeuf du tambour)';
      oculi.castShadow = true;
      g.add(oculi);
    }
    // Round 102: dentil + modillion rings around the drum's ornamented entablature.
    {
      const dentils = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.35, 0.3), materials.warmStone, 24);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 24; i++) {
        const a = i * Math.PI / 12;
        dummy.position.set(Math.sin(a) * 13.9, 38.6, Math.cos(a) * 13.9);
        dummy.rotation.y = -a;
        dummy.updateMatrix();
        dentils.setMatrixAt(i, dummy.matrix);
      }
      dentils.count = 24;
      dentils.name = 'Bourse drum entablature dentils (denticules du tambour)';
      dentils.castShadow = true;
      g.add(dentils);
    }
    // Round 103: the glazed dome is divided by mullions and three horizontal girders (the 1893
    // curved glazing replaced the original stucco vaulting).
    for (const rr of [6.5, 10.5, 13.2]) {
      const ring = mesh(g, new THREE.TorusGeometry(rr, 0.09, 6, 32), materials.blueStone, 0, 39.6 + Math.sqrt(Math.max(0, 14 * 14 - rr * rr)), 0, 'Bourse dome glazing girder (cerce)');
      ring.rotation.x = Math.PI / 2;
    }
    // Round 104: paired meridian ribs on the dome (double arcs transversaux).
    {
      const ribs2 = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 13.0, 0.4), materials.blueStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) * Math.PI / 4;
        dummy.position.set(Math.sin(a) * 9.9, 46.3, Math.cos(a) * 9.9);
        dummy.rotation.set(Math.cos(a) * 0.72, 0, -Math.sin(a) * 0.72);
        dummy.updateMatrix();
        ribs2.setMatrixAt(i, dummy.matrix);
      }
      ribs2.count = 8;
      ribs2.name = 'Bourse dome paired meridian ribs (second set of arcs)';
      ribs2.castShadow = true;
      g.add(ribs2);
    }
    // Round 105: the circular lantern is ringed by eight small columns and crowned by an orb
    // and cross finial.
    {
      const cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.32, 6.2, 8), materials.paleStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        dummy.position.set(Math.sin(a) * 4.1, 50.2, Math.cos(a) * 4.1);
        dummy.updateMatrix();
        cols.setMatrixAt(i, dummy.matrix);
      }
      cols.count = 8;
      cols.name = 'Bourse lantern ring of eight columns (colonnettes du lanterneau)';
      cols.castShadow = true;
      g.add(cols);
      mesh(g, new THREE.SphereGeometry(0.55, 10, 8), materials.gold, 0, 58.6, 0, 'Bourse lantern orb (boule)');
      box(g, 0.12, 1.2, 0.12, 0, 59.4, 0, materials.gold, 'Bourse lantern cross vertical');
      box(g, 0.7, 0.12, 0.12, 0, 59.6, 0, materials.gold, 'Bourse lantern cross horizontal');
    }
    // Round 106: the lantern has its own cornice and base moulding.
    box(g, 9.6, 0.35, 9.6, 0, 56.9, 0, materials.warmStone, 'Bourse lantern cornice (corniche du lanterneau)');
    box(g, 9.4, 0.3, 9.4, 0, 46.9, 0, materials.warmStone, 'Bourse lantern base moulding (socle du lanterneau)');
    // Round 107: four pendentives (pendentifs) carry the drum over the square plan (heritage
    // inventory: "coupole a pendentifs").
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const pend = pedimentPrism(g, 12, 7, 1.2, Math.sin(a) * 12.5, 30, Math.cos(a) * 12.5, materials.paleStone, 'Bourse dome pendentive (pendentif)');
      pend.rotation.y = -a;
    }
    // Round 108: barrel vaults (tongewelven) spring over the four cross arms at the drum base.
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const vault = mesh(g, new THREE.CylinderGeometry(11, 11, 26, 16, 1, false, 0, Math.PI), materials.paleStone,
        Math.sin(a) * 20, 26, Math.cos(a) * 20, 'Bourse barrel vault over cross arm (tongewelf)');
      vault.rotation.z = Math.PI / 2;
      vault.rotation.y = -a;
    }
    // Round 109: slate tile courses run down the arm roof slopes.
    {
      const courses = new THREE.InstancedMesh(new THREE.BoxGeometry(34, 0.08, 0.5), materials.roof, 5 * 4);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const [cx, cz, ry] of [[0, 31, 0], [0, -31, 0], [-42, 0, Math.PI / 2], [42, 0, Math.PI / 2]]) {
        for (let i = 0; i < 5; i++) {
          dummy.position.set(cx, 26.4 + i * 0.8, cz + (ry === 0 ? (i - 2) * 3.4 : 0));
          if (ry !== 0) dummy.position.set(cx + (i - 2) * 3.4, 26.4 + i * 0.8, cz);
          dummy.rotation.set(0, ry, 0);
          dummy.updateMatrix();
          courses.setMatrixAt(n++, dummy.matrix);
        }
      }
      courses.count = n;
      courses.name = 'Bourse arm roof slate tile courses (ardoises en ranges)';
      g.add(courses);
    }
    // Round 110: gilded ridge cresting along the four arm roof ridges.
    {
      const crests = new THREE.InstancedMesh(new THREE.ConeGeometry(0.14, 0.55, 6), materials.gold, 4 * 10);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const [cx, cz, ry] of [[0, 31, 0], [0, -31, 0], [-42, 0, Math.PI / 2], [42, 0, Math.PI / 2]]) {
        for (let i = 0; i < 10; i++) {
          if (ry === 0) dummy.position.set((i - 4.5) * 3.4, 30.85, cz);
          else dummy.position.set(cx, 30.85, (i - 4.5) * 3.4);
          dummy.rotation.set(0, ry, 0);
          dummy.updateMatrix();
          crests.setMatrixAt(n++, dummy.matrix);
        }
      }
      crests.count = n;
      crests.name = 'Bourse arm roof ridge cresting (cretes dorees)';
      crests.castShadow = true;
      g.add(crests);
    }
    // Round 111: the side-facade arcades are crowned by small pediments (frontons sur baies).
    {
      const peds = new THREE.InstancedMesh(new THREE.BoxGeometry(4.2, 0.9, 0.6), materials.paleStone, 24);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const wx of [-53.3, 53.3]) for (let i = 0; i < 12; i++) {
        dummy.position.set(wx, 17.8, -14 + i * 4.6 + 2.3);
        dummy.updateMatrix();
        peds.setMatrixAt(n++, dummy.matrix);
      }
      peds.count = n;
      peds.name = 'Bourse side facade arcade pediments (frontons sur baies)';
      peds.castShadow = true;
      g.add(peds);
    }
    // Round 112: balcony balustrades on the side facades' etage level.
    {
      const balusters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.85, 0.14), materials.warmStone, 2 * 11 * 10);
      const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(11, 0.12, 0.2), materials.warmStone, 20);
      const dummy = new THREE.Object3D();
      let b = 0, r = 0;
      for (const wx of [-53.3, 53.3]) {
        for (let i = 0; i < 10; i++) {
          dummy.position.set(wx, 18.9, -14 + i * 4.6 + 1.1);
          dummy.updateMatrix();
          rails.setMatrixAt(r++, dummy.matrix);
          for (let k = 0; k < 11; k++) {
            dummy.position.set(wx, 18.45, -14 + i * 4.6 + 0.6 + k * 0.95);
            dummy.updateMatrix();
            balusters.setMatrixAt(b++, dummy.matrix);
          }
        }
      }
      balusters.count = b;
      balusters.name = 'Bourse side facade balcony balusters (balustres)';
      g.add(balusters);
      rails.count = r;
      rails.name = 'Bourse side facade balcony top rails';
      rails.castShadow = true;
      g.add(rails);
    }
    // Round 113: the rear facade (rue du Midi) carries window rows under a full cornice.
    {
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 4.2, 0.4), materials.glass, 18);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let f = 0; f < 3; f++) for (let i = 0; i < 6; i++) {
        dummy.position.set(-12.5 + i * 5, 9 + f * 6, -41.3);
        dummy.updateMatrix();
        wins.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n;
      wins.name = 'Bourse rear facade windows (rue du Midi)';
      wins.castShadow = true;
      g.add(wins);
      box(g, 34, 1.1, 0.8, 0, 26.6, -41.2, materials.warmStone, 'Bourse rear facade cornice');
    }
    // Round 114: the rear upper level repeats the three arched bays whose trumeaux carry the
    // caryatids (heritage inventory: "mur ajoure de trois baies cintrees a l'etage").
    for (const bx of [-7.5, 0, 7.5]) {
      box(g, 4.6, 5.4, 0.4, bx, 23, -41.3, materials.glass, 'Bourse rear upper arched bay');
      const arch = mesh(g, new THREE.CylinderGeometry(2.3, 2.3, 0.4, 14, 1, false, 0, Math.PI), materials.glass, bx, 25.7, -41.3, 'Bourse rear upper bay arch');
      arch.rotation.z = Math.PI / 2;
    }
    // Round 115: modillions under the side facades' cornices.
    {
      const mods = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.5, 0.4), materials.warmStone, 2 * 16);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const wx of [-53.3, 53.3]) for (let i = 0; i < 16; i++) {
        dummy.position.set(wx, 26.2, -15 + i * 4.6);
        dummy.updateMatrix();
        mods.setMatrixAt(n++, dummy.matrix);
      }
      mods.count = n;
      mods.name = 'Bourse side facade cornice modillions';
      mods.castShadow = true;
      g.add(mods);
    }
    // Round 116: mullions (meneaux) divide the great side arches.
    {
      const mull = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 11, 0.2), materials.dark, 6);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const wx of [-53.35, 53.35]) for (let i = 0; i < 3; i++) {
        dummy.position.set(wx, 13, -8 + i * 8);
        dummy.updateMatrix();
        mull.setMatrixAt(n++, dummy.matrix);
      }
      mull.count = n;
      mull.name = 'Bourse great arch mullions (meneaux)';
      g.add(mull);
    }
    // Round 117: iron grilles close the ground-floor arcades (offices behind them).
    {
      const grilles = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 8.5, 0.15), materials.dark, 16);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const wx of [-53.35, 53.35]) for (let i = 0; i < 8; i++) {
        dummy.position.set(wx, 9, -14 + i * 4.6);
        dummy.updateMatrix();
        grilles.setMatrixAt(n++, dummy.matrix);
      }
      grilles.count = n;
      grilles.name = 'Bourse ground-floor arcade iron grilles (grilles des bureaux)';
      g.add(grilles);
    }
    // Round 118: colossal pilasters frame the side facade bays.
    {
      const pil = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 21, 0.7), materials.paleStone, 2 * 9);
      const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.5, 1.0), materials.warmStone, 2 * 9);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const wx of [-53.4, 53.4]) for (let i = 0; i < 9; i++) {
        dummy.position.set(wx, 15.5, -16.2 + i * 4.6);
        dummy.updateMatrix();
        pil.setMatrixAt(n, dummy.matrix);
        dummy.position.set(wx, 26.1, -16.2 + i * 4.6);
        dummy.updateMatrix();
        caps.setMatrixAt(n++, dummy.matrix);
      }
      pil.count = n;
      pil.name = 'Bourse side facade colossal pilasters (pilastres colossaux)';
      pil.castShadow = true;
      g.add(pil);
      caps.count = n;
      caps.name = 'Bourse pilaster capitals';
      g.add(caps);
    }
    // Round 119: string courses on the side facades between registers.
    for (const wx of [-53.45, 53.45]) {
      box(g, 0.25, 0.35, 34, wx, 13.5, 0, materials.warmStone, 'Bourse side facade first string course');
      box(g, 0.25, 0.35, 34, wx, 19.5, 0, materials.warmStone, 'Bourse side facade second string course');
    }
    // Round 120: the lateral entrance on the rear facade (rue du Midi side) — widened in the
    // 2020-2023 restoration — with stone surround, arched head and steps (nl.wikipedia Beurspaleis).
    {
      box(g, 5, 8, 0.7, 0, 9, -41.4, materials.dark, 'Bourse rear lateral entrance door (entree laterale, élargie 2023)');
      const arch = mesh(g, new THREE.CylinderGeometry(2.5, 2.5, 0.7, 14, 1, false, 0, Math.PI), materials.dark, 0, 13, -41.4, 'Bourse rear entrance arch');
      arch.rotation.z = Math.PI / 2;
      box(g, 6.4, 0.4, 1.1, 0, 13.4, -41.5, materials.warmStone, 'Bourse rear entrance lintel band');
      box(g, 5.6, 0.3, 2.2, 0, 0.15, -42.2, materials.pavingEdge, 'Bourse rear entrance step');
      box(g, 6.2, 0.3, 3.0, 0, 0.45, -42.8, materials.pavingEdge, 'Bourse rear entrance landing');
    }
    // Round 131: etage windows of the front facade get balcony balustrades with rails.
    {
      const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(3.0, 0.1, 0.18), materials.warmStone, 4);
      const bal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), materials.warmStone, 4 * 12);
      const dummy = new THREE.Object3D();
      let r = 0, b = 0;
      for (const sx of [-1, 1]) for (const wx of [24, 31]) {
        dummy.position.set(sx * wx, 15.35, 30.4);
        dummy.updateMatrix();
        rails.setMatrixAt(r++, dummy.matrix);
        for (let k = 0; k < 12; k++) {
          dummy.position.set(sx * wx - 1.35 + k * 0.245, 14.95, 30.45);
          dummy.updateMatrix();
          bal.setMatrixAt(b++, dummy.matrix);
        }
      }
      rails.count = r; rails.name = 'Bourse front etage balcony top rails';
      rails.castShadow = true; g.add(rails);
      bal.count = b; bal.name = 'Bourse front etage balcony balusters';
      g.add(bal);
    }
    // Round 132: keystones over every front facade window.
    {
      const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.9, 0.3), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const wx of [24, 31]) for (const wy of [10, 17.5]) {
        dummy.position.set(sx * wx, wy + 2.95, 30.35);
        dummy.updateMatrix();
        keys.setMatrixAt(n++, dummy.matrix);
      }
      keys.count = n;
      keys.name = 'Bourse front window keystones (clefs de fenetre)';
      keys.castShadow = true;
      g.add(keys);
    }
    // Round 133: the tympanum geniuses carry their attributes — Commerce a purse, Industrie a
    // hammer-and-gear (allegory of trade and industry, Joseph Jacquet).
    {
      const bg = g.children.find((c) => c.name === 'Bourse tympanum la Belgique (Joseph Jacquet)');
      if (bg) {
        mesh(bg, new THREE.SphereGeometry(0.3, 8, 6), materials.gold, 0.8, 1.6, 0.3, 'la Belgique laurel crown');
      }
      const geniuses = g.children.filter((c) => c.name && c.name.startsWith('Bourse tympanum genius'));
      for (const gns of geniuses) {
        const commerce = gns.name.includes('Commerce');
        mesh(gns, new THREE.SphereGeometry(0.22, 8, 6), materials.gold, 0.6, 0.9, 0.25, commerce ? 'Commerce purse (bourse)' : 'Industrie gear');
        if (!commerce) box(gns, 0.1, 0.7, 0.1, -0.6, 1.2, 0.25, materials.gold, 'Industrie hammer handle');
      }
    }
    // Round 134: the pediment apex acroterion is a palmette fan.
    mesh(g, new THREE.ConeGeometry(0.55, 1.3, 6), materials.warmStone, 0, 33.1, 32.5, 'Bourse apex palmette (palmette sommitale)');
    // Round 135: the central door is reached by two worn stone steps.
    box(g, 5.6, 0.18, 1.4, 0, 0.09, 31.2, materials.pavingEdge, 'Bourse central door lower step');
    box(g, 5.2, 0.18, 1.0, 0, 0.27, 30.9, materials.pavingEdge, 'Bourse central door upper step');
    // Round 136: lateral doors get thresholds.
    box(g, 4.1, 0.15, 1.0, -10, 0.07, 31.0, materials.pavingEdge, 'Bourse west door threshold');
    box(g, 4.1, 0.15, 1.0, 10, 0.07, 31.0, materials.pavingEdge, 'Bourse east door threshold');
    // Round 137: bronze escutcheons and knockers on all three doors.
    {
      const esc = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10), materials.bronze, 3);
      const knock = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), materials.bronze, 3);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        const x = [-10, 0, 10][i];
        dummy.position.set(x, 8.6, 30.62);
        dummy.rotation.x = Math.PI / 2;
        dummy.updateMatrix();
        esc.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x + 0.7, 7.6, 30.62);
        dummy.updateMatrix();
        knock.setMatrixAt(i, dummy.matrix);
      }
      esc.count = 3; esc.name = 'Bourse door escutcheons (entrees de serrure)';
      g.add(esc);
      knock.count = 3; knock.name = 'Bourse door knockers (heurtoirs)';
      g.add(knock);
    }
    // Round 138: mutules (projecting modillion blocks) over each peristyle column on the cornice.
    {
      const mutules = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.6, 0.8), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(peristyleX[i], 23.9, 37.2);
        dummy.updateMatrix();
        mutules.setMatrixAt(i, dummy.matrix);
      }
      mutules.count = 8;
      mutules.name = 'Bourse cornice mutules over the peristyle columns';
      mutules.castShadow = true;
      g.add(mutules);
    }
    // Round 139: the archivolt's arms-of-Brussels shield gets a boss and rim.
    mesh(g, new THREE.SphereGeometry(0.22, 8, 6), materials.gold, 0, 18.6, 30.7, 'Bourse shield boss (umbo)');
    mesh(g, new THREE.TorusGeometry(1.35, 0.1, 6, 18), materials.gold, 0, 18.6, 30.68, 'Bourse shield rim (bordure)');
    // Round 140: the facade windows glow warm after dark (night pass) — the stone of the palace
    // was too soft and was painted with oil paint (Reflexcity); register a glowing window clone.
    {
      const bourseWindowGlow = materials.glass.clone();
      bourseWindowGlow.emissive = new THREE.Color(0x000000);
      nightGlowMats.push(bourseWindowGlow);
      const winMesh = g.children.find((c) => c.name === 'Bourse facade windows (rez-de-chaussee + etage)');
      if (winMesh) winMesh.material = bourseWindowGlow;
      const cellaWin = g.children.filter((c) => c.name === 'Bourse cella arched window');
      for (const w of cellaWin) w.material = bourseWindowGlow;
    }
    // Round 141: the caryatids' drapery is carved in vertical folds.
    {
      const caryatids = g.children.filter((c) => c.name && c.name.startsWith('Bourse caryatid'));
      for (const c of caryatids) {
        const folds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 3.2, 0.06), materials.dark, 5);
        const dummy = new THREE.Object3D();
        for (let k = 0; k < 5; k++) {
          dummy.position.set(-0.32 + k * 0.16, 1.7, 0.21);
          dummy.updateMatrix();
          folds.setMatrixAt(k, dummy.matrix);
        }
        folds.count = 5;
        folds.name = 'Bourse caryatid drapery folds (plis du drapé)';
        c.add(folds);
      }
    }
    // Round 142: a continuous entablature beam rests on the four caryatid capital blocks.
    box(g, 20, 0.9, 1.0, 0, 24.1, -41.2, materials.warmStone, 'Bourse caryatid entablature beam (entablement porte par les cariatides)');
    // Round 143: the L'Asie group includes an elephant; L'Afrique an attendant — the 1871 groups
    // by Van Rasbourg (largely executed by Rodin) on the south facade top.
    {
      const groups = g.children.filter((c) => c.name && c.name.startsWith('Bourse rear pediment group'));
      for (const grp of groups) {
        const isAsia = grp.name.includes('Asie');
        if (isAsia) {
          mesh(grp, new THREE.SphereGeometry(0.7, 10, 8), materials.warmStone, -2.2, 0.7, 0.2, 'L\'Asie elephant body');
          cylinder(grp, 0.18, 0.24, 0.9, -2.85, 0.4, 0.2, materials.warmStone, 8);
          mesh(grp, new THREE.SphereGeometry(0.34, 8, 6), materials.warmStone, -3.2, 0.85, 0.2, 'L\'Asie elephant head');
        } else {
          box(grp, 0.9, 1.8, 0.4, -2.0, 0.9, 0.1, materials.warmStone, 'L\'Afrique attendant');
          mesh(grp, new THREE.SphereGeometry(0.3, 8, 6), materials.warmStone, -2.0, 2.1, 0.1, 'L\'Afrique attendant head');
        }
      }
    }
    // Round 144: the rear pediment is curved (fronton courbe) — a cyma arc over its crown.
    {
      const arc = mesh(g, new THREE.TorusGeometry(17, 0.35, 8, 24, Math.PI * 0.55), materials.warmStone, 0, 26, -38.6, 'Bourse rear curved pediment cyma (fronton courbe)');
      arc.rotation.z = Math.PI * 0.225;
    }
    // Round 145: the globe-carrying putti have wings.
    for (const p of g.children.filter((c) => c.name && c.name.startsWith('Bourse putti carrying'))) {
      const sx = p.position.x < 0 ? -1 : 1;
      box(p, 0.7, 0.18, 0.18, sx * 0.45, 1.1, 0.12, materials.warmStone, 'putto wing');
    }
    // Round 146: the bronze globe carries meridian rings.
    for (const rr of [0.7, 1.05]) {
      const ring = mesh(g, new THREE.TorusGeometry(rr, 0.05, 6, 20), materials.dark, 0, 25.2, -41.2, 'Bourse globe meridian');
      ring.rotation.y = Math.PI / 2;
    }
    // Round 147: quoin chains at the rear facade corners.
    {
      const q = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.95, 0.5), materials.warmStone, 44);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (let r = 0; r < 22; r++) {
        dummy.position.set(sx * 16.7, 5.6 + r * 0.95, -41.3);
        dummy.updateMatrix();
        q.setMatrixAt(n++, dummy.matrix);
      }
      q.count = n;
      q.name = 'Bourse rear facade corner quoins';
      q.castShadow = true;
      g.add(q);
    }
    // Round 148: pilasters frame the three rear upper bays.
    for (const bx of [-10, -5, 5, 10]) {
      box(g, 0.8, 7, 0.5, bx, 22.5, -41.35, materials.paleStone, 'Bourse rear bay pilaster');
    }
    // Round 149: the peristyle is a deep recess — a darker cella wall band behind the columns.
    box(g, 100, 15, 0.6, 0, 12.5, 29.2, materials.dark, 'Bourse peristyle recess shadow band');
    // Round 150: the stylobate carries an edge moulding (bandeau) on its front edge.
    box(g, 41, 0.22, 0.3, 0, 5.45, 38.2, materials.warmStone, 'Bourse stylobate edge moulding');
    // Round 161: the peristyle has a dark soffit (plafond de la colonnade) under the entablature.
    box(g, 100, 0.25, 9, 0, 20.1, 32.5, materials.dark, 'Bourse peristyle soffit (plafond)');
    // Round 162: a small triangular pediment crowns the central door's aedicule.
    pedimentPrism(g, 8.6, 1.6, 2.2, 0, 14.25, 30.9, materials.paleStone, 'Bourse aedicule pediment over the central door');
    // Round 163: impost blocks at the springing of the central arch.
    for (const sx of [-1, 1]) box(g, 0.9, 0.7, 0.7, sx * 4.3, 15.9, 30.35, materials.warmStone, 'Bourse central arch impost block');
    // Round 164: windows on the two front avant-corps pavilions, ground floor and etage.
    {
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 4.4, 0.35), materials.glass, 8);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const wx of [-2.5, 2.5]) for (const wy of [10.5, 18]) {
        dummy.position.set(sx * 44 + wx, wy, 41.2);
        dummy.updateMatrix();
        wins.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n;
      wins.name = 'Bourse avant-corps pavilion windows';
      wins.castShadow = true;
      g.add(wins);
    }
    // Round 165: dentils under the pavilion cornices.
    {
      const dent = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.3, 0.25), materials.warmStone, 2 * 16);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (let i = 0; i < 16; i++) {
        dummy.position.set(sx * 44 - 7.5 + i, 25.5, 41.1);
        dummy.updateMatrix();
        dent.setMatrixAt(n++, dummy.matrix);
      }
      dent.count = n;
      dent.name = 'Bourse pavilion cornice dentils';
      dent.castShadow = true;
      g.add(dent);
    }
    // Round 166: each pavilion has a ground-floor door in a stone surround.
    for (const sx of [-1, 1]) {
      box(g, 3, 5.4, 0.5, sx * 44, 7.7, 41.2, materials.dark, 'Bourse pavilion door ' + (sx < 0 ? 'west' : 'east'));
      box(g, 3.8, 0.35, 0.7, sx * 44, 10.6, 41.25, materials.warmStone, 'Bourse pavilion door lintel');
    }
    // Round 167: the four De Groot allegories stand on pedestals.
    {
      const figs = g.children.filter((c) => c.name && c.name.startsWith('Bourse allegory'));
      for (const fig of figs) {
        const sx = fig.position.x, sz = fig.position.z;
        box(g, 1.6, 0.5, 1.0, sx, fig.position.y - 0.25, sz, materials.blueStone, 'Bourse allegory pedestal');
      }
    }
    // Round 168: a radiant gilded disc (halo) behind la Belgique in the tympanum — the emblem
    // sits in a radiant disc like the guild-house emblems of the Grand-Place.
    {
      const bg = g.children.find((c) => c.name === 'Bourse tympanum la Belgique (Joseph Jacquet)');
      if (bg) mesh(bg, new THREE.CylinderGeometry(1.7, 1.7, 0.12, 20), materials.gold, 0, 1.6, -0.3, 'Bourse tympanum radiant halo disc');
    }
    // Round 169: end blocks (blocs d'extremite) close the entablature at the facade corners.
    for (const sx of [-1, 1]) box(g, 1.2, 3.5, 9.6, sx * 51.2, 21.75, 32.5, materials.warmStone, 'Bourse entablature end block');
    // Round 170: the cella base plinth (plinthe) in darker stone.
    box(g, 100, 0.7, 4.3, 0, 5.35, 28, materials.warmStone, 'Bourse cella base plinth (plinthe)');
    // Round 181: the paired Corinthian pilasters on the dome piers get bases and capitals.
    {
      const bases = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), materials.warmStone, 8);
      const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.4, 0.8), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const off of [[3.6, 0], [0, 3.6]]) {
        dummy.position.set(sx * 11 + (off[0] ? sx * 3.6 : 0), 6.25, sz * 11 + (off[1] ? sz * 3.6 : 0));
        dummy.updateMatrix();
        bases.setMatrixAt(n, dummy.matrix);
        dummy.position.set(sx * 11 + (off[0] ? sx * 3.6 : 0), 27.4, sz * 11 + (off[1] ? sz * 3.6 : 0));
        dummy.updateMatrix();
        caps.setMatrixAt(n++, dummy.matrix);
      }
      bases.count = n; bases.name = 'Bourse dome pilaster bases';
      g.add(bases);
      caps.count = n; caps.name = 'Bourse dome pilaster capitals (chapiteaux des pilastres)';
      caps.castShadow = true;
      g.add(caps);
    }
    // Round 182: each dome pier stands on a plinth at the drum base.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, 8.2, 1.2, 8.2, sx * 11, 5.6, sz * 11, materials.warmStone, 'Bourse dome pier plinth (plinthe du pilier)');
    }
    // Round 183: the socle's refend grooves continue around the side and rear faces.
    {
      const side = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 4.7, 0.07), materials.dark, 60);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (let i = 0; i < 20; i++) {
        dummy.position.set(sx * 53.03, 2.5, -40 + i * 4);
        dummy.updateMatrix();
        side.setMatrixAt(n++, dummy.matrix);
      }
      for (let i = 0; i < 20; i++) {
        dummy.position.set(-52 + i * 5.4, 2.5, -41.03);
        dummy.updateMatrix();
        side.setMatrixAt(n++, dummy.matrix);
      }
      side.count = n;
      side.name = 'Bourse socle refend grooves side + rear faces';
      g.add(side);
    }
    // Round 184: an eave gutter runs along the front cornice, aligned with the downpipes.
    box(g, 104, 0.22, 0.5, 0, 23.95, 37.4, materials.dark, 'Bourse front eave gutter (gouttiere)');
    // Round 185: palmette antefixes at the two lower corners of the pediment.
    for (const sx of [-1, 1]) mesh(g, new THREE.ConeGeometry(0.45, 1.1, 6), materials.warmStone, sx * 18.4, 24.6, 32.5, 'Bourse pediment eaves palmette antefix');
    // Round 186: twelve minute ticks around the facade clock.
    {
      const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.3, 0.05), materials.dark, 12);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        dummy.position.set(Math.sin(a) * 1.05, 15.9 + Math.cos(a) * 1.05, 30.83);
        dummy.rotation.set(0, 0, -a);
        dummy.updateMatrix();
        ticks.setMatrixAt(i, dummy.matrix);
      }
      ticks.count = 12;
      ticks.name = 'Bourse clock minute ticks';
      g.add(ticks);
    }
    // Round 187: each Bien/Mal winged figure spreads a second wing.
    for (const w of g.children.filter((c) => c.name && c.name.startsWith('Bourse Bien/Mal winged figure'))) {
      const sx = w.position.x < 0 ? -1 : 1;
      box(w, 0.8, 0.2, 0.2, -sx * 0.55, 1.5, 0.1, materials.bronze, 'winged figure second wing');
    }
    // Round 188: a dentil band under the frieze garlands.
    {
      const d = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.24, 0.12), materials.warmStone, 60);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 60; i++) {
        dummy.position.set(-49 + i * 1.67, 20.75, 37.05);
        dummy.updateMatrix();
        d.setMatrixAt(i, dummy.matrix);
      }
      d.count = 60;
      d.name = 'Bourse frieze lower dentil band';
      g.add(d);
    }
    // Round 189: the central door arch is a double archivolt (two concentric rings).
    {
      const ring = mesh(g, new THREE.CylinderGeometry(3.4, 3.4, 0.45, 18, 1, false, 0, Math.PI), materials.warmStone, 0, 14.2, 30.3, 'Bourse central door outer archivolt (double archivolte)');
      ring.rotation.z = Math.PI / 2;
    }
    // Round 190: each peristyle column stands on a square plinth on the stylobate.
    {
      const plinths = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.25, 2.4), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(peristyleX[i], 5.53, 36);
        dummy.updateMatrix();
        plinths.setMatrixAt(i, dummy.matrix);
      }
      plinths.count = 8;
      plinths.name = 'Bourse peristyle column plinths (plinthes)';
      plinths.castShadow = true;
      g.add(plinths);
    }
    // Round 201: windows on the corner pavilions' side faces (toward the flanking streets).
    {
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 4, 2.0), materials.glass, 8);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) for (const wy of [10.5, 18]) {
        dummy.position.set(sx * 50.3, wy, sz * 31 + (sz > 0 ? 5 : -5));
        dummy.updateMatrix();
        wins.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n;
      wins.name = 'Bourse corner pavilion side windows';
      wins.castShadow = true;
      g.add(wins);
    }
    // Round 202: urn finials at the four corners of the roof terrace balustrade.
    for (const [ux, uz] of [[-14.5, -38.6], [14.5, -38.6], [-14.5, -23.4], [14.5, -23.4]]) {
      cylinder(g, 0.22, 0.3, 0.8, ux, 32.3, uz, materials.warmStone, 8);
      mesh(g, new THREE.SphereGeometry(0.24, 8, 6), materials.warmStone, ux, 32.85, uz, 'Bourse roof terrace urn finial');
    }
    // Round 203: four slender brass columns carry the panorama canopy over the roof.
    {
      const cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 7.9, 8), materials.gold, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        const sx = i % 2 ? 1 : -1, sz = i < 2 ? -1 : 1;
        dummy.position.set(sx * 9, 42.6, sz * 9);
        dummy.updateMatrix();
        cols.setMatrixAt(i, dummy.matrix);
      }
      cols.count = 4;
      cols.name = 'Bourse brass canopy support columns (colonnes du luifel)';
      cols.castShadow = true;
      g.add(cols);
    }
    // Round 204: a shallow canopy slab shelters the 2023 rear entrance.
    box(g, 8.6, 0.22, 2.6, 0, 4.6, -42.2, materials.gold, 'Bourse 2023 entrance canopy (auvent laiton)');
    // Round 205: big blue-stone quoin blocks chain the four socle corners.
    {
      const q = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), materials.warmStone, 4 * 3);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let r = 0; r < 3; r++) {
        dummy.position.set(sx * 52.6, 0.8 + r * 1.6, sz * 40.6);
        dummy.updateMatrix();
        q.setMatrixAt(n++, dummy.matrix);
      }
      q.count = n;
      q.name = 'Bourse socle corner quoin blocks (chaines d\'angle du soubassement)';
      q.castShadow = true;
      g.add(q);
    }
    // Round 206: a low attic parapet band runs above the main cornice on the wings.
    box(g, 100, 0.9, 8.6, 0, 24.35, 32.5, materials.paleStone, 'Bourse wing attic parapet band (bande d\'attique)');
    // Round 207: balustrade on top of the wing parapets.
    {
      const bal = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.55, 0.14), materials.warmStone, 2 * 30);
      const rail = new THREE.InstancedMesh(new THREE.BoxGeometry(29, 0.1, 0.16), materials.warmStone, 2);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 30; i++) {
          dummy.position.set(sx * (36 + i * 0.1), 25.1, 32.5);
          dummy.updateMatrix();
          bal.setMatrixAt(n++, dummy.matrix);
        }
        dummy.position.set(sx * 36, 25.4, 32.5);
        dummy.updateMatrix();
        rail.setMatrixAt(sx < 0 ? 0 : 1, dummy.matrix);
      }
      bal.count = n; bal.name = 'Bourse wing parapet balusters';
      g.add(bal);
      rail.count = 2; rail.name = 'Bourse wing parapet top rails';
      rail.castShadow = true;
      g.add(rail);
    }
    // Round 208: glass panes in the 12 arm-roof dormers.
    {
      const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.6, 0.1), materials.glass, 12);
      const dummy = new THREE.Object3D();
      const spots = [[-10, 31, 28.2], [10, 31, 28.2], [-10, -31, 28.2], [10, -31, 28.2], [-42, -10, 28.2], [-42, 10, 28.2], [42, -10, 28.2], [42, 10, 28.2], [-46, 31, 24.7], [46, 31, 24.7], [-46, -31, 24.7], [46, -31, 24.7]];
      for (let i = 0; i < 12; i++) {
        dummy.position.set(spots[i][0], spots[i][2], spots[i][1]);
        dummy.updateMatrix();
        glass.setMatrixAt(i, dummy.matrix);
      }
      glass.count = 12;
      glass.name = 'Bourse dormer glazing (vitres des lucarnes)';
      g.add(glass);
    }
    // Round 209: chimney pots on the six stacks.
    {
      const pots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, 0.8, 8), materials.warmStone, 6);
      const dummy = new THREE.Object3D();
      const spots = [[-14, 24, 31.4], [14, 24, 31.4], [-14, -24, 31.4], [14, -24, 31.4], [-46, 6, 31.4], [46, -6, 31.4]];
      for (let i = 0; i < 6; i++) {
        dummy.position.set(spots[i][0], spots[i][2], spots[i][1]);
        dummy.updateMatrix();
        pots.setMatrixAt(i, dummy.matrix);
      }
      pots.count = 6;
      pots.name = 'Bourse chimney pots (pots de cheminee)';
      pots.castShadow = true;
      g.add(pots);
    }
    // Round 210: lead valley flashings where the arm roofs meet the central block.
    for (const [vx, vz, ry] of [[-21, 0, Math.PI / 2], [21, 0, Math.PI / 2], [0, 21, 0], [0, -21, 0]]) {
      const valley = box(g, ry === 0 ? 6 : 0.3, 0.1, ry === 0 ? 0.3 : 6, vx, 26.2, vz, materials.dark, 'Bourse roof valley lead flashing (noue en plomb)');
      valley.rotation.y = ry;
    }
    // Round 221: ground floodlight troughs on the square aim up at the facade (the palace is
    // floodlit after dark, as the Grand-Place is).
    {
      const troughs = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.25, 0.6), materials.dark, 6);
      const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 8, 6), materials.gold, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-25 + i * 10, 0.12, 52);
        dummy.updateMatrix();
        troughs.setMatrixAt(i, dummy.matrix);
        dummy.position.set(-25 + i * 10, 0.3, 51.6);
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
      }
      troughs.count = 6; troughs.name = 'Bourse ground floodlight troughs on the square (projecteurs au sol)';
      troughs.castShadow = true; g.add(troughs);
      heads.count = 6; heads.name = 'Bourse ground floodlight heads';
      g.add(heads);
    }
    // Round 222: the column shafts swell slightly (entasis) — a subtle mid-shaft ring on each.
    {
      const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.84, 0.06, 6, 14), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(peristyleX[i], 10.5, 36);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        rings.setMatrixAt(i, dummy.matrix);
      }
      rings.count = 8;
      rings.name = 'Bourse peristyle shaft entasis rings (entasis)';
      g.add(rings);
    }
    // Round 223: the painted stone cella shows coursed joints (horizontal grooves).
    {
      const courses = new THREE.InstancedMesh(new THREE.BoxGeometry(100, 0.05, 0.06), materials.dark, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(0, 7 + i * 2.2, 30.23);
        dummy.updateMatrix();
        courses.setMatrixAt(i, dummy.matrix);
      }
      courses.count = 6;
      courses.name = 'Bourse cella coursing grooves (joints de l\'appareil peint)';
      courses.castShadow = false;
      g.add(courses);
    }
    // Round 224: the monumental stair has side landing platforms at mid-height.
    for (const sx of [-1, 1]) box(g, 8, 0.3, 6, sx * 17, 2.6, 41.5, materials.pavingEdge, 'Bourse stair mid landing platform');
    // Round 225: the clock has a second hand.
    {
      const hand = box(g, 0.06, 1.6, 0.04, 0, 15.9, 30.86, materials.dark, 'Bourse clock second hand');
      hand.rotation.z = 0.8;
    }
    // Round 226: the tympanum has an inner frame moulding inside the pediment triangle.
    {
      const inner = new THREE.Group();
      inner.name = 'Bourse tympanum inner frame moulding (cadre interieur)';
      box(inner, 30, 0.25, 0.2, 0, 25.0, 37.0, materials.warmStone, 'tympanum inner frame base');
      const s = Math.atan2(8.5, 19);
      for (const sx of [-1, 1]) {
        const rail = box(inner, 0.25, 0.25, 17.5, sx * 7.5, 28.9, 37.0, materials.warmStone, 'tympanum inner frame raking');
        rail.rotation.x = sx * -s;
      }
      g.add(inner);
    }
    // Round 227: the cornice carries an ogee cyma band along its front top edge.
    {
      const cyma = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.14, 104, 8, 1, false, 0, Math.PI), materials.warmStone, 1);
      const dummy = new THREE.Object3D();
      dummy.position.set(0, 23.9, 37.2);
      dummy.rotation.z = Math.PI / 2;
      dummy.updateMatrix();
      cyma.setMatrixAt(0, dummy.matrix);
      cyma.count = 1;
      cyma.name = 'Bourse cornice ogee cyma band (cyma en doucine)';
      cyma.castShadow = true;
      g.add(cyma);
    }
    // Round 228: pilasters on the front facade's outer corners, framing the composition.
    for (const sx of [-1, 1]) {
      box(g, 1.1, 15, 4.6, sx * 49.4, 12.5, 28, materials.paleStone, 'Bourse front corner pilaster');
      box(g, 1.4, 0.5, 5.0, sx * 49.4, 20.2, 28, materials.warmStone, 'Bourse front pilaster capital');
    }
    // Round 229: the downpipes are held to the wall by bracket collars.
    {
      const collars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.14, 0.2), materials.dark, 16);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const sz of [1, -1]) for (let i = 0; i < 4; i++) {
        dummy.position.set(sx * 49.6, 3 + i * 5.5, sz * 30.4);
        dummy.updateMatrix();
        collars.setMatrixAt(n++, dummy.matrix);
      }
      collars.count = n;
      collars.name = 'Bourse downpipe bracket collars (colliers de fixation)';
      g.add(collars);
    }
    // Round 230: cellar areaway grates (soupiraux) in the pavement beside the stair.
    {
      const grates = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.08, 1.2), materials.dark, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 2; i++) for (const sx of [-1, 1]) {
        dummy.position.set(sx * 18, 0.05, 46 - i * 4);
        dummy.updateMatrix();
        grates.setMatrixAt(i * 2 + (sx < 0 ? 0 : 1), dummy.matrix);
      }
      grates.count = 4;
      grates.name = 'Bourse cellar areaway grates beside the stair (soupiraux de cave)';
      g.add(grates);
    }
    // Round 241: cella etage windows above the lateral doors, in surrounds.
    {
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 3.8, 0.35), materials.glass, 4);
      const surr = new THREE.InstancedMesh(new THREE.BoxGeometry(3.1, 4.5, 0.25), materials.warmStone, 4);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const wx of [6.5, 16]) {
        dummy.position.set(sx * wx, 17.5, 30.25);
        dummy.updateMatrix();
        wins.setMatrixAt(n, dummy.matrix);
        surr.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n; wins.name = 'Bourse cella etage windows';
      wins.castShadow = true; g.add(wins);
      surr.count = n; surr.name = 'Bourse cella etage window surrounds';
      g.add(surr);
    }
    // Round 242: the main cornice returns around the facade's ends onto the side faces.
    for (const sx of [-1, 1]) box(g, 0.5, 3.5, 9.6, sx * 51.8, 21.75, 32.5, materials.paleStone, 'Bourse cornice return at facade end');
    // Round 243: pilasters at the front-to-side corner turns.
    for (const sx of [-1, 1]) box(g, 1.0, 21, 1.0, sx * 53.2, 15.5, 38, materials.paleStone, 'Bourse corner turn pilaster');
    // Round 244: oculi in the front attic band, flanking the central pediment.
    for (const sx of [-1, 1]) {
      const o = mesh(g, new THREE.CylinderGeometry(0.7, 0.7, 0.3, 14), materials.glass, sx * 30, 24.9, 37.2, 'Bourse attic band oculus');
      o.rotation.x = Math.PI / 2;
      mesh(g, new THREE.TorusGeometry(0.7, 0.1, 6, 14), materials.warmStone, sx * 30, 24.9, 37.2, 'Bourse attic oculus surround');
    }
    // Round 245: a string course at the drum's base.
    box(g, 26.6, 0.4, 26.6, 0, 30.2, 0, materials.warmStone, 'Bourse dome drum base string course (bandeau du tambour)');
    // Round 246: two more horizontal glazing bars on the dome (five girders in all).
    for (const rr of [4.5, 8.5]) {
      const ring = mesh(g, new THREE.TorusGeometry(rr, 0.08, 6, 28), materials.blueStone, 0, 39.6 + Math.sqrt(Math.max(0, 196 - rr * rr)), 0, 'Bourse dome glazing bar (barreau de vitrage)');
      ring.rotation.x = Math.PI / 2;
    }
    // Round 247: glazed openings between the lantern's eight colonnettes.
    {
      const panes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 5.6, 0.08), materials.glass, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) * Math.PI / 4;
        dummy.position.set(Math.sin(a) * 4.1, 50.2, Math.cos(a) * 4.1);
        dummy.rotation.y = -a;
        dummy.updateMatrix();
        panes.setMatrixAt(i, dummy.matrix);
      }
      panes.count = 8;
      panes.name = 'Bourse lantern glazed openings (baies vitrees du lanterneau)';
      g.add(panes);
    }
    // Round 248: the roof terrace has an access bulkhead (the terrace is reached from the 4th
    // floor — nl.wikipedia: toiture-terrasse au 4e etage).
    {
      box(g, 4, 3.2, 3, 8, 30.8 + 1.6, -33, materials.paleStone, 'Bourse roof terrace access bulkhead (sas d\'acces au dakterras)');
      box(g, 3, 2.4, 0.3, 8, 32.2, -31.4, materials.dark, 'Bourse terrace access door');
      box(g, 4.6, 0.3, 3.6, 8, 34.2, -33, materials.roof, 'Bourse bulkhead roof');
    }
    // Round 249: the brass canopy has a scalloped valance along its edge.
    {
      const valance = new THREE.InstancedMesh(new THREE.ConeGeometry(0.35, 0.5, 6), materials.gold, 4 * 10);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let i = 0; i < 10; i++) for (const sx of [-1, 1]) {
        dummy.position.set(-9 + i * 2, 46.25, sx * 10);
        dummy.rotation.set(Math.PI, 0, 0);
        dummy.updateMatrix();
        valance.setMatrixAt(n++, dummy.matrix);
      }
      for (let i = 0; i < 10; i++) for (const sz of [-1, 1]) {
        dummy.position.set(sz * 10, 46.25, -9 + i * 2);
        dummy.rotation.set(Math.PI, 0, Math.PI / 2);
        dummy.updateMatrix();
        valance.setMatrixAt(n++, dummy.matrix);
      }
      valance.count = n;
      valance.name = 'Bourse brass canopy scalloped valance (feston du luifel)';
      valance.castShadow = true;
      g.add(valance);
    }
    // Round 250: four flagpole sockets on the roof terrace corners (public building).
    {
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.07, 6, 8), materials.dark, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        const sx = i % 2 ? 1 : -1, sz = i < 2 ? -1 : 1;
        dummy.position.set(sx * 14, 34, sz * 16);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
      }
      poles.count = 4;
      poles.name = 'Bourse roof terrace flagpoles (mat de drapeau)';
      poles.castShadow = true;
      g.add(poles);
    }
    // Round 261: the three cella doors have glazed fanlights (impostes vitrees) above them.
    for (const [dx, dr] of [[0, 2.5], [-10, 1.75], [10, 1.75]]) {
      const fan = mesh(g, new THREE.CylinderGeometry(dr, dr, 0.25, 14, 1, false, 0, Math.PI), materials.glass, dx, dx === 0 ? 13 : 9, 30.35, 'Bourse door fanlight (imposte vitree)');
      fan.rotation.z = Math.PI / 2;
      mesh(g, new THREE.TorusGeometry(dr, 0.06, 6, 14, Math.PI), materials.warmStone, dx, dx === 0 ? 13 : 9, 30.35, 'Bourse fanlight frame');
    }
    // Round 262: a radial sett fan at the stair foot on the square (passerelle d'entree).
    {
      const fan = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.07, 1.6), materials.pavingB, 14);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 14; i++) {
        const a = (i - 6.5) * 0.11;
        dummy.position.set(Math.sin(a) * 3.2, 0.05, 50.5 + Math.cos(a) * 3.2);
        dummy.rotation.set(0, -a, 0);
        dummy.updateMatrix();
        fan.setMatrixAt(i, dummy.matrix);
      }
      fan.count = 14;
      fan.name = 'Bourse stair foot sett fan (passerelle d\'entree en eventail)';
      fan.receiveShadow = true;
      g.add(fan);
    }
    // Round 271: a gilded cartouche sits above the aedicule pediment over the central door.
    mesh(g, new THREE.SphereGeometry(0.65, 10, 8), materials.gold, 0, 16.4, 31.2, 'Bourse aedicule cartouche (cartouche dore)');
    // Round 272: the wings' ground floor has office doors at x +/-24.
    for (const sx of [-1, 1]) {
      box(g, 3, 5.6, 0.5, sx * 24, 7.8, 30.3, materials.dark, 'Bourse wing ground-floor office door');
      box(g, 3.8, 0.35, 0.7, sx * 24, 10.8, 30.35, materials.warmStone, 'Bourse wing door lintel');
    }
    // Round 273: shutter hinge straps on the front facade windows.
    {
      const hinges = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.5, 0.08), materials.dark, 16);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const wx of [24, 31]) for (const wy of [10, 17.5]) {
        dummy.position.set(sx * wx - 1.55, wy + 1, 30.4);
        dummy.updateMatrix();
        hinges.setMatrixAt(n++, dummy.matrix);
        dummy.position.set(sx * wx + 1.55, wy + 1, 30.4);
        dummy.updateMatrix();
        hinges.setMatrixAt(n++, dummy.matrix);
      }
      hinges.count = n;
      hinges.name = 'Bourse window shutter hinge straps (pentures)';
      g.add(hinges);
    }
    // Round 274: the apex acroterion gets two acanthus side leaves.
    for (const sx of [-1, 1]) {
      const leaf = mesh(g, new THREE.ConeGeometry(0.3, 0.9, 4), materials.warmStone, sx * 0.5, 33.4, 32.5, 'Bourse apex acanthus side leaf');
      leaf.rotation.z = sx * -0.5;
    }
    // Round 275: gutter brackets under the front eave gutter.
    {
      const brackets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), materials.dark, 12);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 12; i++) {
        dummy.position.set(-44 + i * 8, 23.7, 37.5);
        dummy.updateMatrix();
        brackets.setMatrixAt(i, dummy.matrix);
      }
      brackets.count = 12;
      brackets.name = 'Bourse eave gutter brackets (crochets de gouttiere)';
      g.add(brackets);
    }
    // Round 276: drainage outlets at the four socle corners.
    {
      const outlets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 8), materials.dark, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        const sx = i % 2 ? 1 : -1, sz = i < 2 ? 1 : -1;
        dummy.position.set(sx * 52.8, 0.15, sz * 40.8);
        dummy.updateMatrix();
        outlets.setMatrixAt(i, dummy.matrix);
      }
      outlets.count = 4;
      outlets.name = 'Bourse socle corner drainage outlets ( gargouilles du socle)';
      g.add(outlets);
    }
    // Round 277: lead downpipes at the rear facade corners.
    {
      const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 26, 6), materials.dark, 2);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 2; i++) {
        dummy.position.set((i === 0 ? -1 : 1) * 16.7, 13, -41.2);
        dummy.updateMatrix();
        pipes.setMatrixAt(i, dummy.matrix);
      }
      pipes.count = 2;
      pipes.name = 'Bourse rear downpipes (descentes arriere)';
      g.add(pipes);
    }
    // Round 278: the widened 2023 lateral entrances on both side facades, with gilded brass
    // frames set into the stone.
    for (const sx of [-1, 1]) {
      box(g, 0.6, 7, 4.6, sx * 53.4, 8.5, 0, materials.dark, 'Bourse 2023 lateral entrance (facade ' + (sx < 0 ? 'Henri Maus' : 'de la Bourse') + ')');
      box(g, 0.9, 7.6, 0.4, sx * 53.5, 8.5, -2.6, materials.gold, 'Bourse lateral entrance brass frame left');
      box(g, 0.9, 7.6, 0.4, sx * 53.5, 8.5, 2.6, materials.gold, 'Bourse lateral entrance brass frame right');
      box(g, 0.9, 0.5, 5.6, sx * 53.5, 12.2, 0, materials.gold, 'Bourse lateral entrance brass lintel');
    }
    // Round 279: a gilded ball crowns the dome apex under the lantern.
    mesh(g, new THREE.SphereGeometry(0.7, 12, 10), materials.gold, 0, 39.8, 0, 'Bourse dome apex gilded ball (boule sommitale de la coupole)');
    // Round 280: the blue-stone socle also takes the night floodlight wash — register a wash
    // clone of blueStone in facadeWashMats and swap the socle material.
    {
      const socleWash = materials.blueStone.clone();
      socleWash.emissive = new THREE.Color(0x000000);
      facadeWashMats.push(socleWash);
      const socle = g.children.find((c) => c.name === 'Bourse blue-stone socle (soubassement en pierre bleue)');
      if (socle) socle.material = socleWash;
    }
    // Round 281: Attic base mouldings under the eight peristyle columns - a plinth block and a
    // torus ring at each column foot (bases attiques a plinthe et tore).
    {
      const plinths = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.5, 2.4), materials.paleStone, 8);
      const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.95, 0.12, 6, 20), materials.paleStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(peristyleX[i], 5.45, 36);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        plinths.setMatrixAt(i, dummy.matrix);
        dummy.position.y = 5.75;
        dummy.updateMatrix();
        rings.setMatrixAt(i, dummy.matrix);
      }
      plinths.count = 8; plinths.name = 'Bourse peristyle base plinths (plinthes des bases attiques)';
      rings.count = 8; rings.name = 'Bourse peristyle base torus mouldings';
      g.add(plinths); g.add(rings);
    }
    // Round 282: moulded archivolt rings around the two lateral doors (double archivolte sur
    // chaque porte laterale, comme sur la porte centrale).
    for (const sx of [-1, 1]) {
      mesh(g, new THREE.TorusGeometry(2.4, 0.18, 6, 20, Math.PI), materials.warmStone, sx * 10, 8, 30.35, 'Bourse lateral door outer archivolt');
      mesh(g, new THREE.TorusGeometry(2.0, 0.14, 6, 18, Math.PI), materials.warmStone, sx * 10, 8, 30.4, 'Bourse lateral door inner archivolt');
    }
    // Round 283: the pediment tympanum relief - la Belgique enthroned between the geniuses of
    // Commerce and Industry (Joseph Jacquet, 1873), simplified as three relief panels.
    box(g, 4.5, 2.6, 0.5, -3.2, 20.6, 30.8, materials.warmStone, 'Bourse tympanum Commerce genius relief');
    box(g, 5.5, 3.4, 0.6, 0, 20.2, 30.8, materials.warmStone, 'Bourse tympanum seated Belgique relief (la Belgique enthronee)');
    box(g, 4.5, 2.6, 0.5, 3.2, 20.6, 30.8, materials.warmStone, 'Bourse tympanum Industry genius relief');
    // Round 284: the clock's minute hand alongside the hour and second hands (cadran de De Haen).
    box(g, 0.08, 1.15, 0.04, 0.06, 15.9, 30.84, materials.dark, 'Bourse clock minute hand');
    // Round 285: a dentil course under the peristyle entablature between the capitals
    // (denticules sous l'entablement du peristyle).
    {
      const dentils = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.4), materials.paleStone, 40);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let i = 0; i < 40; i++) {
        dummy.position.set(-19 + i * 0.98, 19.6, 37.2);
        dummy.updateMatrix();
        dentils.setMatrixAt(n++, dummy.matrix);
      }
      dentils.count = n; dentils.name = 'Bourse peristyle entablature dentils (denticules)';
      g.add(dentils);
    }
    // Round 286: keystones over the four cella etage windows (clefs des fenetres de l'etage).
    {
      const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.0, 0.3), materials.warmStone, 4);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const wx of [6.5, 16]) {
        dummy.position.set(sx * wx, 20.1, 30.55);
        dummy.updateMatrix();
        keys.setMatrixAt(n++, dummy.matrix);
      }
      keys.count = n; keys.name = 'Bourse cella etage window keystones (clefs)';
      g.add(keys);
    }
    // Round 287: impost blocks where the lateral door arches spring (sommiers des arcs).
    for (const sx of [-1, 1]) {
      box(g, 0.9, 0.7, 0.5, sx * 12.2, 11, 30.4, materials.warmStone, 'Bourse lateral door impost block (sommier)');
    }
    // Round 291: glazing between the lantern colonnettes - eight oculi panes (vitres du
    // lanterneau) around the drum of the dome.
    {
      const panes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 5.2, 0.1), materials.glass, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        dummy.position.set(Math.cos(a) * 4.0, 53, Math.sin(a) * 4.0);
        dummy.rotation.y = -a;
        dummy.updateMatrix();
        panes.setMatrixAt(i, dummy.matrix);
      }
      panes.count = 8; panes.name = 'Bourse lantern oculi glazing (vitres du lanterneau)';
      panes.castShadow = false; g.add(panes);
    }
    // Round 292: modillions under the main cornice of the front facade (modillons de la corniche).
    {
      const mod = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.9, 0.7), materials.paleStone, 24);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 24; i++) {
        dummy.position.set(-23 + i * 2, 21.9, 31.4);
        dummy.updateMatrix();
        mod.setMatrixAt(i, dummy.matrix);
      }
      mod.count = 24; mod.name = 'Bourse main cornice modillions (modillons)';
      g.add(mod);
    }
    // Round 293: the ajouree side facades (rue de la Bourse / rue Henri Maus, Brunfaut 1892-93)
    // - tall arched openings pierced through the flanks.
    {
      const arches = new THREE.InstancedMesh(new THREE.TorusGeometry(2.2, 0.22, 6, 18, Math.PI), materials.warmStone, 10);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
        dummy.position.set(sx * 53.2, 13, -24 + i * 12);
        dummy.rotation.set(0, sx < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        dummy.updateMatrix();
        arches.setMatrixAt(n++, dummy.matrix);
      }
      arches.count = n; arches.name = 'Bourse side facade ajouree arch frames (facades ajourees Brunfaut)';
      g.add(arches);
    }
    // Round 294: planters along the 2023 roof terrace edge (jardinieres de la toiture-terrasse).
    {
      const planters = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.7, 0.9), materials.terracotta || materials.ochre, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-12.5 + i * 5, 31.2, i < 3 ? -37.5 : -24.5);
        dummy.updateMatrix();
        planters.setMatrixAt(i, dummy.matrix);
      }
      planters.count = 6; planters.name = 'Bourse roof terrace planters (jardinieres, 2023)';
      g.add(planters);
    }
    // Round 295: the weathervane arrow above the lantern cross (girouette sommitale).
    {
      box(g, 1.6, 0.08, 0.08, 0, 60.7, 0, materials.gold, 'Bourse lantern weathervane arrow (girouette)');
      mesh(g, new THREE.ConeGeometry(0.16, 0.5, 8), materials.gold, 0.9, 60.7, 0, 'Bourse lantern weathervane arrowhead');
    }
    // Round 300: gilded acroteria at the four corners of the main cornice (acroteres dorees).
    {
      const acr = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 10, 8), materials.gold, 4);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        dummy.position.set(sx * 24.5, 23.4, sz > 0 ? 31.2 : -31.2);
        dummy.updateMatrix();
        acr.setMatrixAt(n++, dummy.matrix);
      }
      acr.count = n; acr.name = 'Bourse main cornice corner acroteria (acroteres dorees)';
      g.add(acr);
    }
    // __BOURSE_ROUNDS__
  });
  addLandmark('bourseSurroundings', (g) => {
    // Round 10: the Place de la Bourse itself — created with the covering of the Senne
    // (1867-1871), pedestrianised since 29 June 2015 and repaved on that occasion; the second
    // most important square of Brussels after the Grand-Place (Wikipedia EN/FR).
    box(g, 130, 0.35, 92, 0, -0.175, 88, materials.pavingA, 'Place de la Bourse paved square (repaved 2015)');
    {
      const setts = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.06, 1.6), materials.pavingB, 15 * 32);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let row = 0; row < 15; row++) for (let col = 0; col < 32; col++) {
        dummy.position.set(-62 + col * 4 + (row % 2) * 2, 0.02, 44 + row * 6);
        dummy.updateMatrix();
        setts.setMatrixAt(n++, dummy.matrix);
      }
      setts.count = n;
      setts.name = 'Place de la Bourse sett paving courses (pavage)';
      setts.receiveShadow = true;
      g.add(setts);
      box(g, 130, 0.22, 1.1, 0, 0.05, 41.5, materials.pavingEdge, 'Place de la Bourse kerb at the stair foot');
      box(g, 130, 0.22, 1.1, 0, 0.05, 134.5, materials.pavingEdge, 'Place de la Bourse kerb at the boulevard');
      box(g, 1.1, 0.22, 93, -65.5, 0.05, 88, materials.pavingEdge, 'Place de la Bourse west kerb');
      box(g, 1.1, 0.22, 93, 65.5, 0.05, 88, materials.pavingEdge, 'Place de la Bourse east kerb');
    }
    // The Boulevard Anspach crosses the square halfway; car-free between the Place de la
    // Bourse and De Brouckere since 29 June 2015 (Le Pietonnier), with embedded planters
    // (bacs encastres), benches, fountains, bike arches, bins and new lighting.
    box(g, 170, 0.3, 18, 0, -0.15, 122, materials.pavingB, 'Boulevard Anspach pedestrian strip (car-free since 29 June 2015)');
    {
      const planters = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 0.55, 2.2), materials.pavingEdge, 12);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 12; i++) {
        dummy.position.set(-77 + i * 14, 0.28, 118.5);
        dummy.updateMatrix();
        planters.setMatrixAt(i, dummy.matrix);
      }
      planters.count = 12;
      planters.name = 'Boulevard Anspach embedded tree planters (bacs encastres)';
      planters.castShadow = true;
      g.add(planters);
      const trees = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.6, 2.1, 4.5, 8), materials.green, 12);
      for (let i = 0; i < 12; i++) {
        dummy.position.set(-77 + i * 14, 2.8, 118.5);
        dummy.updateMatrix();
        trees.setMatrixAt(i, dummy.matrix);
      }
      trees.count = 12;
      trees.name = 'Boulevard Anspach planter trees (verdure 200 m2 -> 3000 m2)';
      trees.castShadow = true;
      g.add(trees);
    }
    // Round 51: at the corner with the rue Paul Devaux stands the imposing 1949 building of
    // shops and offices by E. De Heu, with a corner tower topped by a dome — it replaced the
    // Grands Magasins de la Bourse destroyed by fire in 1948, reusing its balconies
    // (en.wikipedia Place de la Bourse).
    {
      box(g, 26, 30, 22, -62, 15, 96, materials.plaster, '1949 De Heu building (ex Grands Magasins de la Bourse)');
      cylinder(g, 6.5, 7.5, 36, -70, 18, 88, materials.plaster, 12);
      box(g, 15, 2, 15, -70, 36.5, 88, materials.warmStone, '1949 corner tower cornice');
      mesh(g, new THREE.SphereGeometry(7, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), materials.slate, -70, 37.5, 88, '1949 corner tower dome');
      mesh(g, new THREE.ConeGeometry(1.1, 2.6, 8), materials.gold, -70, 45.5, 88, '1949 dome finial');
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 2.6, 0.3), materials.glass, 40);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let f = 0; f < 5; f++) for (let i = 0; i < 8; i++) {
        dummy.position.set(-73 + i * 3, 5 + f * 5, 107.2);
        dummy.updateMatrix();
        wins.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n;
      wins.name = '1949 De Heu building window rows';
      wins.castShadow = true;
      g.add(wins);
    }
    // Round 52: its ground-floor shopfronts (rez-de-chaussee commerciaux).
    box(g, 24, 3.6, 0.5, -62, 1.8, 107.2, materials.glass, '1949 building shopfront glazing');
    // Round 53: on the opposite side of the square stand two eclectic apartment buildings,
    // built 1884-85 to ensure the homogeneity of the square (en.wikipedia Place de la Bourse).
    for (const sx of [-1, 1]) {
      const blk = sx * 30;
      box(g, 50, 22, 16, blk, 11, 108, materials.ochre, '1884-85 eclectic apartment block ' + (sx < 0 ? 'west' : 'east'));
      box(g, 51, 1.2, 17, blk, 22.6, 108, materials.warmStone, '1884-85 block cornice');
      pedimentPrism(g, 50, 3.5, 16, blk, 23.2, 108, materials.warmStone, '1884-85 block mansard roof crown');
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 3.2, 0.3), materials.glass, 24);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let f = 0; f < 4; f++) for (let i = 0; i < 6; i++) {
        dummy.position.set(blk - 22.5 + i * 9, 4.5 + f * 4.5, 116.2);
        dummy.updateMatrix();
        wins.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n;
      wins.name = '1884-85 apartment block windows';
      wins.castShadow = true;
      g.add(wins);
    }
    // Round 54: no. 78 Boulevard Anspach is the Cafe de la Bourse (1874), a neo-Baroque building
    // by Charles-Emile Janlet (en.wikipedia Boulevard Anspach).
    {
      box(g, 30, 24, 16, 34, 12, 130, materials.plaster, 'Cafe de la Bourse no. 78 (1874, neo-Baroque, Janlet)');
      pedimentPrism(g, 12, 3.2, 4, 34, 24, 136.5, materials.warmStone, 'Cafe de la Bourse pediment');
      box(g, 30, 1, 17, 34, 24.6, 130, materials.warmStone, 'Cafe de la Bourse cornice');
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 4, 0.3), materials.glass, 12);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let f = 0; f < 3; f++) for (let i = 0; i < 4; i++) {
        dummy.position.set(22 + i * 7, 5 + f * 7, 138.2);
        dummy.updateMatrix();
        wins.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n;
      wins.name = 'Cafe de la Bourse windows';
      wins.castShadow = true;
      g.add(wins);
    }
    // Round 55: the Bourse - Grand-Place premetro station (lines 4 and 10, opened 4 October 1976)
    // has its surface accesses at the square: accesses 7 and 8 flank the rue Auguste Orts with
    // escalators, access 6 south of the square has an elevator (fr.wikipedia).
    {
      const kiosks = [[-52, 103], [-40, 103], [18, 100]];
      const names = ['premetro access 7 (rue Auguste Orts, escalator)', 'premetro access 8 (rue Auguste Orts, escalator)', 'premetro access 6 (south of the square, elevator)'];
      for (let i = 0; i < 3; i++) {
        const k = new THREE.Group();
        k.name = 'Bourse premetro station ' + names[i];
        k.position.set(kiosks[i][0], 0, kiosks[i][1]);
        box(k, 3.2, 3, 3.2, 0, 1.5, 0, materials.glass, 'kiosk glass canopy');
        box(k, 3.6, 0.18, 3.6, 0, 3.05, 0, materials.dark, 'kiosk roof slab');
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder(k, 0.06, 0.06, 3, sx * 1.6, 1.5, sz * 1.6, materials.dark, 6);
        box(k, 3.4, 0.9, 0.3, 0, 0.45, 1.75, materials.dark, 'kiosk escalator/elevator front');
        g.add(k);
      }
    }
    // Round 56: the Fontaine Orts (1888) by Henri Beyaert with sculpture by Georges Houtstont and
    // the bust of Auguste Orts by Thomas Vinootte, at the corner of the rue Auguste Orts — a
    // high-flow drinking fountain (fr.wikipedia Fontaine Orts).
    {
      const f = new THREE.Group();
      f.name = 'Fontaine Orts (1888, Beyaert + Houtstont, bust Vinootte)';
      f.position.set(-52, 0, 78);
      cylinder(f, 0.9, 1.2, 3.2, 0, 1.6, 0, materials.blueStone, 'Fontaine Orts column');
      box(f, 1.6, 1.1, 1.6, 0, 3.8, 0, materials.blueStone, 'Fontaine Orts capital block');
      mesh(f, new THREE.SphereGeometry(0.55, 10, 8), materials.bronze, 0, 4.8, 0, 'Fontaine Orts bust of Auguste Orts (Vinootte)');
      cylinder(f, 2.2, 2.6, 0.7, 0, 0.35, 0, materials.blueStone, 12);
      mesh(f, new THREE.CylinderGeometry(2.0, 2.0, 0.06, 16), materials.glass, 0, 0.72, 0, 'Fontaine Orts water disc (eau potable, haut debit)');
      g.add(f);
    }
    // Round 57: the monument to Auguste Orts stands at no. 3 place de la Bourse (heritage
    // inventory rue Auguste Orts: "monument appose a l'angle du no 3, place de la Bourse").
    {
      const m = new THREE.Group();
      m.name = 'Monument to Auguste Orts (no. 3 place de la Bourse)';
      m.position.set(-48, 0, 72);
      box(m, 2.6, 2.2, 1.2, 0, 1.1, 0, materials.blueStone, 'Orts monument pedestal');
      box(m, 3, 0.3, 1.5, 0, 2.35, 0, materials.warmStone, 'Orts monument cap');
      box(m, 0.9, 2.6, 0.4, 0, 3.6, 0, materials.warmStone, 'Orts monument statue figure');
      mesh(m, new THREE.SphereGeometry(0.4, 8, 6), materials.warmStone, 0, 5.1, 0, 'Orts monument statue head');
      box(m, 1.6, 0.9, 0.1, 0, 1.2, 0.62, materials.bronze, 'Orts monument plaque');
      g.add(m);
    }
    // Round 58: on the rue Auguste Orts axis facing the Bourse, the pietonnier project installed
    // a water mirror (miroir d'eau) — a fountain children can play in (centreville.bruxelles.be).
    {
      const mirror = box(g, 14, 0.1, 4.5, -38, 0.06, 70, materials.glass, 'Water mirror on the rue Auguste Orts axis (miroir d\'eau, pietonnier)');
      mirror.castShadow = false;
      box(g, 14.6, 0.25, 5.1, -38, 0.02, 70, materials.pavingEdge, 'Water mirror stone frame');
      const jets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 6), materials.glass, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-44 + i * 2, 0.45, 70);
        dummy.updateMatrix();
        jets.setMatrixAt(i, dummy.matrix);
      }
      jets.count = 6;
      jets.name = 'Water mirror jets (miroir d\'eau)';
      g.add(jets);
    }
    // Round 59: traditional blue enamel street-name plate on its post at the square mouth.
    {
      const sign = new THREE.Group();
      sign.name = 'Enamel street sign PLACE DE LA BOURSE / BEURSPLEIN';
      sign.position.set(58, 0, 46);
      cylinder(sign, 0.05, 0.06, 2.6, 0, 1.3, 0, materials.dark, 6);
      box(sign, 1.5, 0.55, 0.06, 0, 2.7, 0, materials.enamelBlue, 'enamel plate PLACE DE LA BOURSE / BEURSPLEIN');
      g.add(sign);
    }
    // Round 60: bollards guard the street mouths around the square.
    {
      const bollards = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.13, 0.9, 8), materials.dark, 16);
      const dummy = new THREE.Object3D();
      const spots = [];
      for (let i = 0; i < 4; i++) spots.push([-62 + i * 3, 43.5], [62 - i * 3, 43.5], [-62 + i * 3, 133], [62 - i * 3, 133]);
      for (let i = 0; i < 16; i++) {
        dummy.position.set(spots[i][0], 0.45, spots[i][1]);
        dummy.updateMatrix();
        bollards.setMatrixAt(i, dummy.matrix);
      }
      bollards.count = 16;
      bollards.name = 'Place de la Bourse street-mouth bollards';
      bollards.castShadow = true;
      g.add(bollards);
    }
    // Rounds 61-63: the traditional blue enamel street-name plates on their posts at each street
    // mouth of the square and boulevard (bilingual French/Dutch, as everywhere in Brussels).
    {
      const signs = [
        ['BOULEVARD ANSPACH / ANSPACHLAAN', -20, 112.5],
        ['BOULEVARD ANSPACH / ANSPACHLAAN', 20, 131.5],
        ['RUE AUGUSTE ORTS / AUGUSTE ORTSSTRAAT', -56, 88],
        ['RUE DE LA BOURSE / BEURSSTRAAT', 56, 60],
        ['RUE HENRI MAUS / HENRI MAUSSTRAAT', -56, 55],
        ['RUE PAUL DEVAUX / PAUL DEVAUXSTRAAT', -60, 104],
        ['RUE JULES VAN PRAET / JULES VAN PRAETSTRAAT', -30, 112.5],
        ['RUE DU MARCHE AUX POULETS / KIEKEMARKT', 60, 100]
      ];
      for (const [label, sx, sz] of signs) {
        const sign = new THREE.Group();
        sign.name = 'Enamel street sign ' + label;
        sign.position.set(sx, 0, sz);
        cylinder(sign, 0.05, 0.06, 2.6, 0, 1.3, 0, materials.dark, 6);
        box(sign, 1.9, 0.5, 0.06, 0, 2.72, 0, materials.enamelBlue, 'enamel plate ' + label);
        mesh(sign, new THREE.SphereGeometry(0.09, 8, 6), materials.dark, 0, 2.95, 0, 'sign post finial ball');
        g.add(sign);
      }
    }
    // Round 64: zebra crossings with Belisha beacons (black-and-white striped poles with glowing
    // globes) where the boulevard crosses the square — the Brussels convention.
    {
      const stripes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.05, 4.2), materials.paleStone, 24);
      const beacons = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 3.4, 8), materials.dark, 4);
      const globes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 8), materials.enamelBlue, 4);
      const dummy = new THREE.Object3D();
      let s = 0;
      for (const [bx, bz] of [[-8, 108], [8, 108], [-8, 134], [8, 134]]) {
        for (let i = 0; i < 6; i++) {
          dummy.position.set(bx - 2.5 + i * 1, 0.05, bz);
          dummy.updateMatrix();
          stripes.setMatrixAt(s++, dummy.matrix);
        }
      }
      stripes.count = s;
      stripes.name = 'Zebra crossing stripes at the boulevard crossings of the square';
      stripes.receiveShadow = true;
      g.add(stripes);
      let b = 0;
      for (const [bx, bz] of [[-11, 108], [11, 108], [-11, 134], [11, 134]]) {
        dummy.position.set(bx, 1.7, bz);
        dummy.updateMatrix();
        beacons.setMatrixAt(b, dummy.matrix);
        dummy.position.set(bx, 3.6, bz);
        dummy.updateMatrix();
        globes.setMatrixAt(b++, dummy.matrix);
      }
      beacons.count = b; beacons.name = 'Belisha beacon poles (poteaux belisha)';
      beacons.castShadow = true; g.add(beacons);
      globes.count = b; globes.name = 'Belisha beacon globes';
      globes.castShadow = true; g.add(globes);
    }
    // Round 65: benches on the square and along the boulevard (pietonnier furniture).
    {
      const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.09, 0.6), materials.warmStone, 10);
      const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.45, 0.55), materials.dark, 20);
      const dummy = new THREE.Object3D();
      let n = 0;
      const spots = [[-30, 70], [-15, 70], [0, 70], [15, 70], [30, 70], [-45, 122], [-25, 122], [-5, 122], [15, 122], [35, 122]];
      for (const [bx, bz] of spots) {
        dummy.position.set(bx, 0.5, bz);
        dummy.updateMatrix();
        seats.setMatrixAt(n, dummy.matrix);
        dummy.position.set(bx - 0.9, 0.25, bz);
        dummy.updateMatrix();
        legs.setMatrixAt(2 * n, dummy.matrix);
        dummy.position.set(bx + 0.9, 0.25, bz);
        dummy.updateMatrix();
        legs.setMatrixAt(2 * n + 1, dummy.matrix);
        n++;
      }
      seats.count = n; seats.name = 'Square and boulevard benches (bancs, pietonnier)';
      seats.castShadow = true; g.add(seats);
      legs.count = 2 * n; legs.name = 'Bench legs';
      g.add(legs);
    }
    // Round 66: public litter bins along the boulevard.
    {
      const bins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.28, 0.85, 10), materials.green, 6);
      const lids = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 10), materials.dark, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-60 + i * 24, 0.43, 126.5);
        dummy.updateMatrix();
        bins.setMatrixAt(i, dummy.matrix);
        dummy.position.set(-60 + i * 24, 0.9, 126.5);
        dummy.updateMatrix();
        lids.setMatrixAt(i, dummy.matrix);
      }
      bins.count = 6; bins.name = 'Boulevard public bins (poubelles publiques)';
      bins.castShadow = true; g.add(bins);
      lids.count = 6; lids.name = 'Bin lids';
      g.add(lids);
    }
    // Round 67: bicycle arches (arceaux velo) at the square edges — the station has a bike park.
    {
      const arches = new THREE.InstancedMesh(new THREE.TorusGeometry(0.55, 0.035, 6, 12, Math.PI), materials.dark, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(-58 + i * 3, 0, 50);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        arches.setMatrixAt(i, dummy.matrix);
      }
      arches.count = 8;
      arches.name = 'Bicycle arches (arceaux velo) at the square edge';
      arches.castShadow = true;
      g.add(arches);
    }
    // Round 68: the new public lighting of the pietonnier — lamp columns along the boulevard.
    {
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 7.5, 8), materials.dark, 8);
      const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 8), materials.glass, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(-70 + i * 20, 3.75, 118.5);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(-70 + i * 20, 7.7, 118.5);
        dummy.updateMatrix();
        heads.setMatrixAt(i, dummy.matrix);
      }
      poles.count = 8; poles.name = 'Pietonnier lighting columns (nouvel eclairage)';
      poles.castShadow = true; g.add(poles);
      heads.count = 8; heads.name = 'Pietonnier lamp heads';
      heads.castShadow = true; g.add(heads);
    }
    // Round 69: fountains on the pedestrianised boulevard (fontaines du pietonnier).
    {
      const basins = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.6, 1.8, 0.5, 14), materials.pavingEdge, 3);
      const water = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.45, 1.45, 0.08, 14), materials.glass, 3);
      const jets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.1, 1.6, 6), materials.glass, 3);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        const x = -30 + i * 30, z = 122;
        dummy.position.set(x, 0.25, z); dummy.updateMatrix(); basins.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 0.52, z); dummy.updateMatrix(); water.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 1.2, z); dummy.updateMatrix(); jets.setMatrixAt(i, dummy.matrix);
      }
      basins.count = 3; basins.name = 'Boulevard Anspach pietonnier fountain basins (fontaines)';
      basins.castShadow = true; g.add(basins);
      water.count = 3; water.name = 'Fountain water discs';
      g.add(water);
      jets.count = 3; jets.name = 'Fountain jets';
      g.add(jets);
    }
    // Round 70: pedestrian-zone entry signs at the boulevard mouths (zone pietonne, since
    // 29 June 2015 the boulevard is car-free between the Bourse and De Brouckere).
    for (const [sx, sz] of [[-20, 112], [20, 131]]) {
      const sign = new THREE.Group();
      sign.name = 'Pedestrian-zone entry sign (zone pietonne, 29 June 2015)';
      sign.position.set(sx, 0, sz);
      cylinder(sign, 0.06, 0.07, 3.2, 0, 1.6, 0, materials.dark, 6);
      const plate = mesh(sign, new THREE.CylinderGeometry(0.55, 0.55, 0.05, 20), materials.enamelBlue, 0, 3.0, 0, 'pedestrian zone sign disc (disque bleu zone pietonne)');
      plate.rotation.x = Math.PI / 2;
      g.add(sign);
    }
    // Round 71: each street mouth opens with a fan of radial setts (pavage en eventail) in the
    // square's paving, as on the Grand-Place.
    {
      const fans = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.07, 1.4), materials.pavingB, 60);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const [cx, cz, ang] of [[-58, 44, Math.PI / 2], [58, 44, Math.PI / 2], [-58, 132, -Math.PI / 2], [58, 132, -Math.PI / 2], [-62, 90, 0], [62, 75, Math.PI]]) {
        for (let i = 0; i < 10; i++) {
          const a = ang + (i - 4.5) * 0.16;
          dummy.position.set(cx + Math.cos(a) * 2.2, 0.04, cz + Math.sin(a) * 2.2);
          dummy.rotation.set(0, -a, 0);
          dummy.updateMatrix();
          fans.setMatrixAt(n++, dummy.matrix);
        }
      }
      fans.count = n;
      fans.name = 'Place de la Bourse street-mouth sett fans (pavage en eventail)';
      fans.receiveShadow = true;
      g.add(fans);
    }
    // Round 72: kerb end stones close each kerb line at the street mouths.
    {
      const ends = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.3, 1.1), materials.pavingEdge, 12);
      const dummy = new THREE.Object3D();
      const spots = [[-65, 44], [-58, 44], [58, 44], [65, 44], [-65, 134], [-58, 134], [58, 134], [65, 134], [-65.5, 70], [-65.5, 100], [65.5, 50], [65.5, 85]];
      for (let i = 0; i < 12; i++) {
        dummy.position.set(spots[i][0], 0.1, spots[i][1]);
        dummy.updateMatrix();
        ends.setMatrixAt(i, dummy.matrix);
      }
      ends.count = 12;
      ends.name = 'Square kerb end stones (pierres de bout)';
      ends.castShadow = true;
      g.add(ends);
    }
    // Round 73: tactile paving strips (bandes podotactiles, rows of bumps) lead to each zebra crossing.
    {
      const bumps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5), materials.pavingEdge, 4 * 2 * 6);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const [bx, bz] of [[-8, 106], [8, 106], [-8, 136], [8, 136]]) {
        for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
          dummy.position.set(bx - 2.5 + i * 1, 0.09, bz + (r - 0.5) * 0.5);
          dummy.updateMatrix();
          bumps.setMatrixAt(n++, dummy.matrix);
        }
      }
      bumps.count = n;
      bumps.name = 'Tactile paving bumps at the crossings (bandes podotactiles)';
      g.add(bumps);
    }
    // Round 74: drainage gully slots along the square kerb line.
    {
      const gullies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.04, 1.2), materials.dark, 24);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 24; i++) {
        dummy.position.set(-60 + i * 5.2, 0.06, i % 2 ? 42 : 135);
        dummy.updateMatrix();
        gullies.setMatrixAt(i, dummy.matrix);
      }
      gullies.count = 24;
      gullies.name = 'Square kerb drainage gullies';
      g.add(gullies);
    }
    // Round 75: manhole covers set in the square's paving.
    {
      const covers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 12), materials.dark, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(-52 + (i % 4) * 36, 0.05, 60 + Math.floor(i / 4) * 40);
        dummy.updateMatrix();
        covers.setMatrixAt(i, dummy.matrix);
      }
      covers.count = 8;
      covers.name = 'Square manhole covers (plaques d\'egout)';
      g.add(covers);
    }
    // Round 76: ventilation grilles of the 1976 North-South premetro tunnel, which took the place
    // of the covered Senne under the boulevard (en.wikipedia Boulevard Anspach / Covering of the Senne).
    {
      const grilles = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 0.06, 1.6), materials.dark, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-50 + i * 20, 0.05, 117);
        dummy.updateMatrix();
        grilles.setMatrixAt(i, dummy.matrix);
      }
      grilles.count = 6;
      grilles.name = 'Premetro tunnel ventilation grilles on the boulevard (tunnel 1976, ancien lit de la Senne)';
      g.add(grilles);
    }
    // Round 77: a commemorative plaque for the former Butter Market (Marche au Beurre) and the
    // 13th-century Recollets Franciscan convent whose ruins lie under the square (Bruxella 1238).
    {
      const plaque = new THREE.Group();
      plaque.name = 'Plaque Marche au Beurre / Recollets convent / Bruxella 1238';
      plaque.position.set(-20, 0, 44.2);
      box(plaque, 1.8, 1.1, 0.08, 0, 1.5, 0, materials.bronze, 'bronze commemorative plaque');
      cylinder(plaque, 0.05, 0.06, 3, 0, 1.5, -0.15, materials.dark, 6);
      g.add(plaque);
    }
    // Round 78: a brasserie terrace with parasols and tables on the square, beside the corner
    // buildings — the square is ringed with cafes and restaurants.
    {
      const parasols = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 0.7, 8), materials.canvas, 4);
      const poles2 = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), materials.dark, 4);
      const tables = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 10), materials.warmStone, 4);
      const dummy = new THREE.Object3D();
      const spots = [[-40, 55], [-34, 58], [40, 55], [34, 58]];
      for (let i = 0; i < 4; i++) {
        dummy.position.set(spots[i][0], 2.2, spots[i][1]);
        dummy.updateMatrix();
        parasols.setMatrixAt(i, dummy.matrix);
        dummy.position.set(spots[i][0], 1.1, spots[i][1]);
        dummy.updateMatrix();
        poles2.setMatrixAt(i, dummy.matrix);
        dummy.position.set(spots[i][0], 0.75, spots[i][1]);
        dummy.updateMatrix();
        tables.setMatrixAt(i, dummy.matrix);
      }
      parasols.count = 4; parasols.name = 'Brasserie terrace parasols on the square';
      parasols.castShadow = true; g.add(parasols);
      poles2.count = 4; poles2.name = 'Parasol poles';
      g.add(poles2);
      tables.count = 4; tables.name = 'Terrace tables';
      tables.castShadow = true; g.add(tables);
    }
    // Round 79: the "Bourse - Beurs" stop sign with its shelter on the boulevard — surface
    // connections with buses 46, 48, 86 and 95 (fr.wikipedia premetro station).
    {
      const stop = new THREE.Group();
      stop.name = 'Stop sign Bourse - Beurs (bus 46/48/86/95) + shelter';
      stop.position.set(-6, 0, 126);
      cylinder(stop, 0.06, 0.07, 3.4, 0, 1.7, 0, materials.dark, 6);
      const disc = mesh(stop, new THREE.CylinderGeometry(0.5, 0.5, 0.06, 18), materials.enamelBlue, 0, 3.1, 0, 'stop sign disc Bourse - Beurs');
      disc.rotation.x = Math.PI / 2;
      box(stop, 3, 0.06, 1.4, 2.2, 2.6, 0, materials.glass, 'shelter glass panel');
      box(stop, 3.4, 0.1, 1.8, 2.2, 2.7, 0, materials.dark, 'shelter roof');
      g.add(stop);
    }
    // Round 80: along the rue Auguste Orts, monumental eclectic facades largely built around
    // 1885 line the street that was pierced (1890) to frame the view of the Bourse
    // (monument.heritage.brussels rue Auguste Orts; reflexcity).
    {
      const facades = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 20, 0.8), materials.ochre, 5);
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 3, 0.2), materials.glass, 20);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let i = 0; i < 5; i++) {
        dummy.position.set(-58 - i * 11, 10, 62 - i * 9);
        dummy.rotation.set(0, 0.5, 0);
        dummy.updateMatrix();
        facades.setMatrixAt(i, dummy.matrix);
        for (let f = 0; f < 4; f++) {
          dummy.position.set(-58 - i * 11 - 3 + f * 2, 5 + f * 4, 62 - i * 9 + 0.5);
          dummy.rotation.set(0, 0.5, 0);
          dummy.updateMatrix();
          wins.setMatrixAt(n++, dummy.matrix);
        }
      }
      facades.count = 5;
      facades.name = 'Rue Auguste Orts monumental eclectic facades (vers 1885)';
      facades.castShadow = true;
      g.add(facades);
      wins.count = n;
      wins.name = 'Rue Orts facade windows';
      g.add(wins);
    }
    // Round 121: the 1949 corner tower's dome is ribbed (huit nervures) and its shaft glazed.
    {
      const ribs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 6.5, 0.25), materials.roof, 8);
      const twins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 2.4, 0.3), materials.glass, 3 * 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        dummy.position.set(-70 + Math.sin(a) * 6.2, 40.5, 88 + Math.cos(a) * 6.2);
        dummy.rotation.set(Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7);
        dummy.updateMatrix();
        ribs.setMatrixAt(i, dummy.matrix);
      }
      ribs.count = 8;
      ribs.name = '1949 tower dome meridian ribs (nervures de la coupole)';
      ribs.castShadow = true;
      g.add(ribs);
      let n = 0;
      for (let f = 0; f < 3; f++) for (let i = 0; i < 6; i++) {
        dummy.position.set(-76.5 + i * 3, 8 + f * 9, 88.2);
        dummy.updateMatrix();
        twins.setMatrixAt(n++, dummy.matrix);
      }
      twins.count = n;
      twins.name = '1949 tower shaft windows';
      twins.castShadow = true;
      g.add(twins);
    }
    // Round 122: the 1949 building reused balconies recovered from the burned Grands Magasins
    // de la Bourse (en.wikipedia Place de la Bourse).
    {
      const balconies = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 0.18, 1.4), materials.paleStone, 8);
      const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 0.9, 0.1), materials.dark, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(-73 + (i % 4) * 6, 7 + Math.floor(i / 4) * 9, 107.3);
        dummy.updateMatrix();
        balconies.setMatrixAt(i, dummy.matrix);
        dummy.position.set(-73 + (i % 4) * 6, 7.6 + Math.floor(i / 4) * 9, 107.9);
        dummy.updateMatrix();
        rails.setMatrixAt(i, dummy.matrix);
      }
      balconies.count = 8;
      balconies.name = '1949 building reused balconies (balcons recuperes des Grands Magasins)';
      balconies.castShadow = true;
      g.add(balconies);
      rails.count = 8;
      rails.name = '1949 balcony iron rails';
      g.add(rails);
    }
    // Round 123: the 1884-85 blocks have stone window surrounds and etage balcony balustrades.
    {
      const surr = new THREE.InstancedMesh(new THREE.BoxGeometry(2.7, 3.9, 0.25), materials.warmStone, 48);
      const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.85, 0.12), materials.dark, 24);
      const dummy = new THREE.Object3D();
      let n = 0, r = 0;
      for (const sx of [-1, 1]) {
        const blk = sx * 30;
        for (let f = 0; f < 4; f++) for (let i = 0; i < 6; i++) {
          dummy.position.set(blk - 22.5 + i * 9, 4.5 + f * 4.5, 116.25);
          dummy.updateMatrix();
          surr.setMatrixAt(n++, dummy.matrix);
          if (f === 1) {
            dummy.position.set(blk - 22.5 + i * 9, 7.4, 116.5);
            dummy.updateMatrix();
            rails.setMatrixAt(r++, dummy.matrix);
          }
        }
      }
      surr.count = n;
      surr.name = '1884-85 block window stone surrounds';
      surr.castShadow = true;
      g.add(surr);
      rails.count = r;
      rails.name = '1884-85 block etage balcony rails';
      g.add(rails);
    }
    // Round 124: modillions under the 1884-85 cornices + dormers on the mansard crowns.
    {
      const mods = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), materials.warmStone, 2 * 25);
      const dorm = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2.2, 1.4), materials.ochre, 6);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (let i = 0; i < 25; i++) {
        dummy.position.set(sx * 30 - 24 + i * 2, 22.2, 108);
        dummy.updateMatrix();
        mods.setMatrixAt(n++, dummy.matrix);
      }
      mods.count = n;
      mods.name = '1884-85 block cornice modillions';
      mods.castShadow = true;
      g.add(mods);
      let d = 0;
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
        dummy.position.set(sx * 30 - 15 + i * 15, 25.5, 108);
        dummy.updateMatrix();
        dorm.setMatrixAt(d++, dummy.matrix);
      }
      dorm.count = d;
      dorm.name = '1884-85 block mansard dormers (lucarnes)';
      dorm.castShadow = true;
      g.add(dorm);
    }
    // Round 125: the Cafe de la Bourse (1874 neo-Baroque) carries a sculpted cartouche over its
    // entrance and an oriel window above (neo-Baroque front, Charles-Emile Janlet).
    {
      box(g, 4.5, 2.2, 0.5, 34, 3, 138.3, materials.dark, 'Cafe de la Bourse entrance door');
      mesh(g, new THREE.SphereGeometry(1.1, 10, 8), materials.warmStone, 34, 6.2, 138.4, 'Cafe de la Bourse cartouche (cartouche sculpte)');
      box(g, 3.4, 3.6, 1.2, 34, 14, 136.8, materials.glass, 'Cafe de la Bourse oriel (oriel vitre)');
      box(g, 3.8, 0.3, 1.6, 34, 16, 136.8, materials.warmStone, 'Cafe de la Bourse oriel cornice');
    }
    // Round 126: the cafe's canvas awning over the terrace side (generic brasserie awning).
    {
      const awning = box(g, 10, 0.08, 3, 34, 4.6, 136.2, materials.canvas, 'Cafe de la Bourse canvas awning (store)');
      awning.rotation.x = 0.35;
      for (const sx of [-1, 1]) cylinder(g, 0.05, 0.05, 3.4, 34 + sx * 4.8, 3.1, 136.6, materials.dark, 6);
    }
    // Round 127: the premetro kiosks get mullioned glass panes, metal frames and handrails.
    for (const k of g.children) {
      if (!k.name || !k.name.startsWith('Bourse premetro station')) continue;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        cylinder(k, 0.04, 0.04, 3, sx * 1.55, 1.5, sz * 1.55, materials.dark, 5);
      }
      box(k, 0.06, 3, 3.2, -1.62, 1.5, 0, materials.dark, 'kiosk frame post west');
      box(k, 0.06, 3, 3.2, 1.62, 1.5, 0, materials.dark, 'kiosk frame post east');
      box(k, 3.3, 0.07, 0.07, 0, 1.1, 1.7, materials.dark, 'kiosk handrail (garde-corps)');
    }
    // Round 128: access 6 (south of the square) carries a glazed elevator shaft beside the stair.
    {
      const k = g.children.find((c) => c.name && c.name.includes('access 6'));
      if (k) {
        box(k, 1.6, 5.5, 1.6, 2.6, 2.75, -1.2, materials.glass, 'premetro access 6 glazed elevator shaft (ascenseur)');
        box(k, 1.9, 0.15, 1.9, 2.6, 5.55, -1.2, materials.dark, 'elevator shaft roof');
      }
    }
    // Round 129: the Fontaine Orts column shaft is fluted and its basin has a rim moulding
    // plus a drinking spout (fontaine d'eau potable a haut debit, 1888).
    {
      const f = g.children.find((c) => c.name && c.name.startsWith('Fontaine Orts'));
      if (f) {
        const flutes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 3.0, 5), materials.dark, 8);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          dummy.position.set(Math.cos(a) * 0.95, 1.6, Math.sin(a) * 0.95);
          dummy.updateMatrix();
          flutes.setMatrixAt(i, dummy.matrix);
        }
        flutes.count = 8;
        flutes.name = 'Fontaine Orts fluted shaft (fut cannele)';
        f.add(flutes);
        const rim = mesh(f, new THREE.TorusGeometry(2.35, 0.12, 6, 16), materials.warmStone, 0, 0.72, 0, 'Fontaine Orts basin rim moulding');
        rim.rotation.x = Math.PI / 2;
        cylinder(f, 0.06, 0.06, 0.5, 0, 4.3, 0.9, materials.bronze, 6);
        mesh(f, new THREE.SphereGeometry(0.09, 6, 5), materials.bronze, 0, 4.3, 1.15, 'Fontaine Orts drinking spout (bec verseur)');
      }
    }
    // Round 130: the Orts monument gets a stepped base, moulded cap and bronze plaque frame.
    {
      const m = g.children.find((c) => c.name && c.name.startsWith('Monument to Auguste Orts'));
      if (m) {
        box(m, 3.2, 0.25, 1.8, 0, 0.12, 0, materials.warmStone, 'Orts monument stepped base');
        box(m, 3.1, 0.16, 1.6, 0, 2.5, 0, materials.blueStone, 'Orts monument cap moulding');
        box(m, 1.7, 1.0, 0.06, 0, 1.2, 0.66, materials.gold, 'Orts monument plaque frame (cadre bronze dore)');
      }
    }
    // Round 151: the square's calepinage alternates two stone tones in courses (repaved 2015).
    {
      const alt = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.05, 1.6), materials.pavingEdge, 14 * 32);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let row = 0; row < 14; row++) for (let col = 0; col < 32; col++) {
        if ((row + col) % 2 === 0) continue;
        dummy.position.set(-62 + col * 4 + (row % 2) * 2, 0.045, 46 + row * 6);
        dummy.updateMatrix();
        alt.setMatrixAt(n++, dummy.matrix);
      }
      alt.count = n;
      alt.name = 'Place de la Bourse alternating calepinage courses';
      alt.receiveShadow = true;
      g.add(alt);
    }
    // Round 152: wear lines along the square's main axes (the busiest pedestrian paths).
    {
      const wear = new THREE.InstancedMesh(new THREE.BoxGeometry(90, 0.03, 2.2), materials.pavingEdge, 2);
      const dummy = new THREE.Object3D();
      dummy.position.set(0, 0.06, 88); dummy.updateMatrix(); wear.setMatrixAt(0, dummy.matrix);
      dummy.position.set(0, 0.06, 108); dummy.updateMatrix(); wear.setMatrixAt(1, dummy.matrix);
      wear.count = 2;
      wear.name = 'Place de la Bourse wear lines (lignes d\'usure)';
      wear.receiveShadow = true;
      g.add(wear);
    }
    // Round 153: bordered sett patches (repair patches in the paving).
    {
      const patches = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 0.04, 4), materials.pavingB, 6);
      const borders = new THREE.InstancedMesh(new THREE.BoxGeometry(6.4, 0.05, 4.4), materials.pavingEdge, 6);
      const dummy = new THREE.Object3D();
      const spots = [[-30, 60], [20, 75], [-10, 95], [35, 100], [-45, 110], [10, 120]];
      for (let i = 0; i < 6; i++) {
        dummy.position.set(spots[i][0], 0.07, spots[i][1]);
        dummy.updateMatrix();
        patches.setMatrixAt(i, dummy.matrix);
        borders.setMatrixAt(i, dummy.matrix);
      }
      patches.count = 6; patches.name = 'Place de la Bourse sett repair patches';
      g.add(patches);
      borders.count = 6; borders.name = 'Sett patch borders (bordures de ragréage)';
      g.add(borders);
    }
    // Round 154: accent cobbles at the four corners of the square.
    {
      const accent = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.07, 1.2), materials.pavingEdge, 4 * 9);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const [cx, cz] of [[-62, 44], [62, 44], [-62, 134], [62, 134]]) {
        for (let i = 0; i < 9; i++) {
          dummy.position.set(cx + (i % 3) * 1.4 - 1.4, 0.08, cz + Math.floor(i / 3) * 1.4 - 1.4);
          dummy.updateMatrix();
          accent.setMatrixAt(n++, dummy.matrix);
        }
      }
      accent.count = n;
      accent.name = 'Square corner accent cobbles (cobles d\'angle)';
      g.add(accent);
    }
    // Round 155: the boulevard's central spine is paved in a contrasting tone (pietonnier design).
    box(g, 170, 0.28, 6, 0, -0.14, 122, materials.pavingEdge, 'Boulevard Anspach central spine (bande centrale)');
    // Round 156: paving stubs continue into the side streets (rue Paul Devaux, rue Jules Van Praet).
    box(g, 14, 0.26, 40, -58, -0.13, 100, materials.pavingB, 'Rue Paul Devaux paving stub');
    box(g, 12, 0.26, 34, -28, -0.13, 112, materials.pavingB, 'Rue Jules Van Praet paving stub');
    // Round 157: each embedded planter holds soil and a shrub ball.
    {
      const soil = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.6, 2.6, 0.12, 10), materials.dark, 12);
      const shrubs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 8, 6), materials.green, 12);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 12; i++) {
        dummy.position.set(-77 + i * 14, 0.6, 118.5);
        dummy.updateMatrix();
        soil.setMatrixAt(i, dummy.matrix);
        dummy.position.set(-77 + i * 14, 1.4, 118.5);
        dummy.updateMatrix();
        shrubs.setMatrixAt(i, dummy.matrix);
      }
      soil.count = 12; soil.name = 'Planter soil (terreau des bacs encastres)';
      g.add(soil);
      shrubs.count = 12; shrubs.name = 'Planter shrubs (arbustes des bacs)';
      shrubs.castShadow = true;
      g.add(shrubs);
    }
    // Round 158: tree trunks + protective grilles around the boulevard trees.
    {
      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.24, 2.6, 8), materials.dark, 12);
      const guards = new THREE.InstancedMesh(new THREE.TorusGeometry(0.9, 0.05, 6, 12), materials.dark, 12);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 12; i++) {
        dummy.position.set(-77 + i * 14, 1.3, 118.5);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        dummy.position.set(-77 + i * 14, 0.5, 118.5);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        guards.setMatrixAt(i, dummy.matrix);
      }
      trunks.count = 12; trunks.name = 'Boulevard tree trunks (fûts)';
      g.add(trunks);
      guards.count = 12; guards.name = 'Tree guard grilles (grilles de protection)';
      g.add(guards);
    }
    // Round 159: tactile paving strip across the stair foot (accessibility to the peristyle).
    {
      const bumps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5), materials.pavingEdge, 2 * 26);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let r = 0; r < 2; r++) for (let i = 0; i < 26; i++) {
        dummy.position.set(-12.5 + i * 1, 0.09, 49 + (r - 0.5) * 0.5);
        dummy.updateMatrix();
        bumps.setMatrixAt(n++, dummy.matrix);
      }
      bumps.count = n;
      bumps.name = 'Tactile strip at the monumental stair foot (bande podotactile)';
      g.add(bumps);
    }
    // Round 160: kerb ramps (abaissés de trottoir) at the four boulevard crossings.
    {
      const ramps = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 0.1, 1.6), materials.pavingEdge, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set(i % 2 ? 8 : -8, 0.1, i < 2 ? 107.2 : 134.8);
        dummy.updateMatrix();
        ramps.setMatrixAt(i, dummy.matrix);
      }
      ramps.count = 4;
      ramps.name = 'Kerb ramps at the crossings (abaissés de trottoir)';
      g.add(ramps);
    }
    // Round 171: rue de la Bourse runs along the palace's east flank from the square south-east
    // (en.wikipedia Place de la Bourse: two side streets run along each side of the building).
    box(g, 12, 0.26, 55, 62, -0.13, 20, materials.pavingB, 'Rue de la Bourse paving (east flank of the palace)');
    {
      const facades = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 18, 0.8), materials.plaster, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set(67, 9, -2 - i * 13);
        dummy.updateMatrix();
        facades.setMatrixAt(i, dummy.matrix);
      }
      facades.count = 4;
      facades.name = 'Rue de la Bourse facade row';
      facades.castShadow = true;
      g.add(facades);
    }
    // Round 172: rue Henri Maus runs along the palace's west flank.
    box(g, 12, 0.26, 55, -62, -0.13, 20, materials.pavingB, 'Rue Henri Maus paving (west flank of the palace)');
    {
      const facades = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 18, 0.8), materials.ochre, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set(-67, 9, -2 - i * 13);
        dummy.updateMatrix();
        facades.setMatrixAt(i, dummy.matrix);
      }
      facades.count = 4;
      facades.name = 'Rue Henri Maus facade row';
      facades.castShadow = true;
      g.add(facades);
    }
    // Round 173: the rue du Marche aux Poulets reaches the square from the south-east
    // (fr.wikipedia: the square receives rue de la Bourse, rue du Marche aux Poulets, ...).
    box(g, 12, 0.26, 40, 45, -0.13, -5, materials.pavingB, 'Rue du Marche aux Poulets connection to the square');
    // Round 174: neoclassical 1870s blocks line the boulevard south of the square (toward
    // Boulevard Maurice Lemonnier) — the boulevard's uniform facades of the Anspach scheme.
    {
      const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(16, 20, 14), materials.plaster, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set(-30 + i * 20, 10, 142);
        dummy.updateMatrix();
        blocks.setMatrixAt(i, dummy.matrix);
      }
      blocks.count = 4;
      blocks.name = 'Boulevard Anspach south facade row (facades uniformes du scheme Anspach, vers 1870)';
      blocks.castShadow = true;
      g.add(blocks);
    }
    // Round 175: the Ancienne Belgique concert hall fronts the boulevard north of the square
    // (en.wikipedia Boulevard Anspach: places of interest include the Bourse and the Ancienne Belgique).
    {
      box(g, 26, 26, 16, -34, 13, 142, materials.warmStone, 'Ancienne Belgique concert hall frontage (Boulevard Anspach)');
      box(g, 27, 1.4, 17, -34, 26.7, 142, materials.dark, 'Ancienne Belgique cornice');
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 5, 0.3), materials.glass, 8);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let f = 0; f < 2; f++) for (let i = 0; i < 4; i++) {
        dummy.position.set(-43 + i * 6.5, 8 + f * 9, 150.2);
        dummy.updateMatrix();
        wins.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n;
      wins.name = 'Ancienne Belgique windows';
      wins.castShadow = true;
      g.add(wins);
    }
    // Round 176: eclectic blocks line the boulevard north of the square toward De Brouckere.
    {
      const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(15, 19, 14), materials.ochre, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set(28 + i * 19, 9.5, 100);
        dummy.updateMatrix();
        blocks.setMatrixAt(i, dummy.matrix);
      }
      blocks.count = 4;
      blocks.name = 'Boulevard Anspach north facade row (blocs eclectiques, style 1870-85)';
      blocks.castShadow = true;
      g.add(blocks);
    }
    // Round 177: the rue des Bogards mouth south of the square, with its enamel sign.
    {
      box(g, 12, 0.26, 30, 0, -0.13, -60, materials.pavingB, 'Rue des Bogards mouth paving');
      const sign = new THREE.Group();
      sign.name = 'Enamel street sign RUE DES BOGARDS / BOGARDSTRAAT';
      sign.position.set(6, 0, -58);
      cylinder(sign, 0.05, 0.06, 2.6, 0, 1.3, 0, materials.dark, 6);
      box(sign, 1.7, 0.5, 0.06, 0, 2.72, 0, materials.enamelBlue, 'enamel plate RUE DES BOGARDS / BOGARDSTRAAT');
      g.add(sign);
    }
    // Round 178: paving continues from the rue Henri Maus south end toward the boulevard du Midi.
    box(g, 12, 0.26, 45, -62, -0.13, -25, materials.pavingB, 'Rue Henri Maus south continuation toward Boulevard du Midi');
    // Round 179: the facades along the square's east and west edges (beside the flanking streets).
    {
      const rows = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 17, 0.8), materials.plaster, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        dummy.position.set(69, 8.5, 60 + i * 22);
        dummy.updateMatrix();
        rows.setMatrixAt(i, dummy.matrix);
        dummy.position.set(-69, 8.5, 60 + i * 22);
        dummy.updateMatrix();
        rows.setMatrixAt(3 + i, dummy.matrix);
      }
      rows.count = 6;
      rows.name = 'Square edge facade rows (immeubles bordant la place)';
      rows.castShadow = true;
      g.add(rows);
    }
    // Round 180: the pietonnier lamp heads glow after dark — register them in nightGlowMats.
    {
      const lampGlow = materials.glass.clone();
      lampGlow.emissive = new THREE.Color(0x000000);
      nightGlowMats.push(lampGlow);
      const heads = g.children.find((c) => c.name === 'Pietonnier lamp heads');
      if (heads) heads.material = lampGlow;
      const beacons = g.children.find((c) => c.name === 'Belisha beacon globes');
      if (beacons) beacons.material = lampGlow;
    }
    // Round 191: every sign post has a base collar and a sett ring at its foot.
    {
      const collars = [];
      const rings = [];
      for (const c of g.children) {
        if (c.name && (c.name.startsWith('Enamel street sign') || c.name.startsWith('Pedestrian-zone'))) {
          collars.push([c.position.x, c.position.z]);
        }
      }
      const col = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 0.25, 8), materials.dark, collars.length);
      const ring = new THREE.InstancedMesh(new THREE.TorusGeometry(0.35, 0.05, 6, 12), materials.pavingEdge, collars.length);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < collars.length; i++) {
        dummy.position.set(collars[i][0], 0.12, collars[i][1]);
        dummy.updateMatrix();
        col.setMatrixAt(i, dummy.matrix);
        dummy.position.set(collars[i][0], 0.03, collars[i][1]);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        ring.setMatrixAt(i, dummy.matrix);
      }
      col.count = collars.length; col.name = 'Street sign post base collars (colliers)';
      g.add(col);
      ring.count = collars.length; ring.name = 'Sign post sett rings (anneaux de pavé)';
      g.add(ring);
    }
    // Round 192: the enamel plates have white border frames with corner rivets.
    {
      const plates = g.children.filter((c) => c.name && c.name.startsWith('Enamel street sign'));
      const frames = new THREE.InstancedMesh(new THREE.BoxGeometry(2.0, 0.6, 0.04), materials.paleStone, plates.length);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < plates.length; i++) {
        dummy.position.set(plates[i].position.x, 2.72, plates[i].position.z - 0.035);
        dummy.updateMatrix();
        frames.setMatrixAt(i, dummy.matrix);
      }
      frames.count = plates.length;
      frames.name = 'Enamel plate white border frames (bordures blanches)';
      g.add(frames);
    }
    // Round 193: the bollards are capped with rounded heads.
    {
      const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), materials.dark, 16);
      const dummy = new THREE.Object3D();
      const spots = [];
      for (let i = 0; i < 4; i++) spots.push([-62 + i * 3, 43.5], [62 - i * 3, 43.5], [-62 + i * 3, 133], [62 - i * 3, 133]);
      for (let i = 0; i < 16; i++) {
        dummy.position.set(spots[i][0], 0.95, spots[i][1]);
        dummy.updateMatrix();
        caps.setMatrixAt(i, dummy.matrix);
      }
      caps.count = 16;
      caps.name = 'Bollard rounded cap heads (têtes de bornes)';
      caps.castShadow = true;
      g.add(caps);
    }
    // Round 194: the benches get back slats and armrests.
    {
      const backs = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.5, 0.07), materials.warmStone, 10);
      const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.35, 0.55), materials.dark, 20);
      const dummy = new THREE.Object3D();
      const spots = [[-30, 70], [-15, 70], [0, 70], [15, 70], [30, 70], [-45, 122], [-25, 122], [-5, 122], [15, 122], [35, 122]];
      for (let i = 0; i < 10; i++) {
        dummy.position.set(spots[i][0], 0.85, spots[i][1] - 0.28);
        dummy.rotation.set(-0.25, 0, 0);
        dummy.updateMatrix();
        backs.setMatrixAt(i, dummy.matrix);
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(spots[i][0] - 1.0, 0.62, spots[i][1]);
        dummy.updateMatrix();
        arms.setMatrixAt(2 * i, dummy.matrix);
        dummy.position.set(spots[i][0] + 1.0, 0.62, spots[i][1]);
        dummy.updateMatrix();
        arms.setMatrixAt(2 * i + 1, dummy.matrix);
      }
      backs.count = 10; backs.name = 'Bench back slats (dossiers des bancs)';
      backs.castShadow = true; g.add(backs);
      arms.count = 20; arms.name = 'Bench armrests (accoudoirs)';
      g.add(arms);
    }
    // Round 195: the water mirror gets a moulded stone frame with corner stones.
    {
      box(g, 15.2, 0.32, 0.6, -38, 0.1, 67.7, materials.pavingEdge, 'Water mirror north frame moulding');
      box(g, 15.2, 0.32, 0.6, -38, 0.1, 72.3, materials.pavingEdge, 'Water mirror south frame moulding');
      box(g, 0.6, 0.32, 5.2, -45.6, 0.1, 70, materials.pavingEdge, 'Water mirror west frame moulding');
      box(g, 0.6, 0.32, 5.2, -30.4, 0.1, 70, materials.pavingEdge, 'Water mirror east frame moulding');
    }
    // Round 196: the premetro kiosks get a door panel and a tinted glass band.
    for (const k of g.children) {
      if (!k.name || !k.name.startsWith('Bourse premetro station')) continue;
      box(k, 1.4, 2.2, 0.1, 0, 1.1, -1.7, materials.dark, 'kiosk door panel (porte)');
      box(k, 3.3, 0.5, 3.3, 0, 2.4, 0, materials.glass, 'kiosk tinted glass band (bande vitree teintee)');
    }
    // Round 197: terrace chairs around the parasol tables.
    {
      const chairs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), materials.warmStone, 12);
      const dummy = new THREE.Object3D();
      const spots = [[-40, 55], [-34, 58], [40, 55], [34, 58]];
      let n = 0;
      for (const [px, pz] of spots) for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6]]) {
        dummy.position.set(px + dx, 0.25, pz + dz);
        dummy.updateMatrix();
        chairs.setMatrixAt(n++, dummy.matrix);
      }
      chairs.count = n;
      chairs.name = 'Terrace chairs (chaises de terrasse)';
      chairs.castShadow = true;
      g.add(chairs);
    }
    // Round 198: the boulevard fountain basins get rim mouldings and centre nozzles.
    {
      const rims = new THREE.InstancedMesh(new THREE.TorusGeometry(1.75, 0.09, 6, 16), materials.pavingEdge, 3);
      const nozzles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 0.3, 8), materials.bronze, 3);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        const x = -30 + i * 30;
        dummy.position.set(x, 0.52, 122);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        rims.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 0.6, 122);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        nozzles.setMatrixAt(i, dummy.matrix);
      }
      rims.count = 3; rims.name = 'Fountain basin rim mouldings';
      g.add(rims);
      nozzles.count = 3; nozzles.name = 'Fountain centre nozzles (gicleurs)';
      g.add(nozzles);
    }
    // Round 199: the bins get a foot pedal and lid hinge.
    {
      const pedals = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.05, 0.3), materials.dark, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-60 + i * 24, 0.03, 127.1);
        dummy.updateMatrix();
        pedals.setMatrixAt(i, dummy.matrix);
      }
      pedals.count = 6;
      pedals.name = 'Bin foot pedals (pedales)';
      g.add(pedals);
    }
    // Round 200: each bike arch is a double rail (two concentric arcs).
    {
      const arches2 = new THREE.InstancedMesh(new THREE.TorusGeometry(0.4, 0.03, 6, 12, Math.PI), materials.dark, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(-58 + i * 3, 0, 50);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        arches2.setMatrixAt(i, dummy.matrix);
      }
      arches2.count = 8;
      arches2.name = 'Bicycle arch inner rails (second rail des arceaux)';
      g.add(arches2);
    }
    // Round 211: the 1949 main block carries a mansard roof with dormers.
    {
      pedimentPrism(g, 26, 4, 22, -62, 30, 96, materials.slate, '1949 building mansard roof');
      const dorm = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2.2, 1.4), materials.plaster, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set(-69 + i * 4.7, 31.5, 96);
        dummy.updateMatrix();
        dorm.setMatrixAt(i, dummy.matrix);
      }
      dorm.count = 4;
      dorm.name = '1949 building mansard dormers';
      dorm.castShadow = true;
      g.add(dorm);
    }
    // Round 212: each 1884-85 block has a central avant-corps with its own pediment on the
    // square facade (homogeneous eclectic composition of 1884-85).
    for (const sx of [-1, 1]) {
      box(g, 12, 23, 18, sx * 30, 11.5, 108, materials.ochre, '1884-85 block central avant-corps');
      pedimentPrism(g, 12, 3, 4, sx * 30, 23.5, 108, materials.warmStone, '1884-85 avant-corps pediment (fronton)');
    }
    // Round 213: the Cafe de la Bourse (neo-Baroque 1874) has a corner oriel and mansard roof.
    {
      box(g, 4, 12, 4, 47, 18, 130, materials.plaster, 'Cafe de la Bourse corner oriel');
      pedimentPrism(g, 30, 3.4, 16, 34, 24.6, 130, materials.slate, 'Cafe de la Bourse mansard roof');
    }
    // Round 214: each premetro access carries a generic unbranded transit roundel disc (the repo
    // rule is no real operator logos — a plain blue enamel disc marks the access).
    for (const k of g.children) {
      if (!k.name || !k.name.startsWith('Bourse premetro station')) continue;
      const disc = mesh(k, new THREE.CylinderGeometry(0.42, 0.42, 0.07, 18), materials.enamelBlue, 0, 3.35, 0, 'premetro access sign disc (roundel generique, sans marque)');
      disc.rotation.x = Math.PI / 2;
    }
    // Round 215: two steps descend from each kiosk to the escalator/elevator front.
    for (const k of g.children) {
      if (!k.name || !k.name.startsWith('Bourse premetro station')) continue;
      box(k, 3.6, 0.16, 1.0, 0, 0.08, 2.3, materials.pavingEdge, 'kiosk lower step');
      box(k, 3.6, 0.16, 1.0, 0, 0.24, 2.9, materials.pavingEdge, 'kiosk upper step');
    }
    // Round 216: the Fontaine Orts has two side drinking spouts and an overflow notch.
    {
      const f = g.children.find((c) => c.name && c.name.startsWith('Fontaine Orts'));
      if (f) {
        for (const sx of [-1, 1]) {
          cylinder(f, 0.05, 0.05, 0.4, sx * 1.0, 3.4, 0, materials.bronze, 6);
          mesh(f, new THREE.SphereGeometry(0.08, 6, 5), materials.bronze, sx * 1.2, 3.4, 0, 'Fontaine Orts side spout (bec lateral)');
        }
      }
    }
    // Round 217: corner stones at the water mirror's four corners.
    {
      const corners = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.4, 0.8), materials.pavingEdge, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set([-45.2, -30.8][i % 2], 0.14, [67.4, 72.6][Math.floor(i / 2)]);
        dummy.updateMatrix();
        corners.setMatrixAt(i, dummy.matrix);
      }
      corners.count = 4;
      corners.name = 'Water mirror corner stones (pierres d\'angle du miroir)';
      g.add(corners);
    }
    // Round 218: each embedded planter has a stone rim moulding.
    {
      const rims = new THREE.InstancedMesh(new THREE.BoxGeometry(6.3, 0.12, 2.5), materials.pavingEdge, 12);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 12; i++) {
        dummy.position.set(-77 + i * 14, 0.6, 118.5);
        dummy.updateMatrix();
        rims.setMatrixAt(i, dummy.matrix);
      }
      rims.count = 12;
      rims.name = 'Planter rim mouldings (bords des bacs)';
      rims.castShadow = true;
      g.add(rims);
    }
    // Round 219: the lighting columns get base collars and a curved arm to the lamp head.
    {
      const collars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 8), materials.dark, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(-70 + i * 20, 0.2, 118.5);
        dummy.updateMatrix();
        collars.setMatrixAt(i, dummy.matrix);
      }
      collars.count = 8;
      collars.name = 'Lighting column base collars';
      collars.castShadow = true;
      g.add(collars);
    }
    // Round 220: register colliders for the three premetro kiosks so vehicles stop at them.
    // (Collider layout entries themselves live in js/brussels-colliders.js — see that file.)
    // Round 231: quoin chains at the 1949 tower's corners.
    {
      const q = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.1, 0.5), materials.warmStone, 2 * 16);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const sx of [-1, 1]) for (let r = 0; r < 16; r++) {
        dummy.position.set(-70 + sx * 7.2, 2 + r * 2.2, 88);
        dummy.updateMatrix();
        q.setMatrixAt(n++, dummy.matrix);
      }
      q.count = n;
      q.name = '1949 tower corner quoins (chaines d\'angle de la tour)';
      q.castShadow = true;
      g.add(q);
    }
    // Round 232: ground-floor shopfronts on the 1884-85 blocks (rez-de-chaussee commerciaux).
    {
      const shops = new THREE.InstancedMesh(new THREE.BoxGeometry(48, 3.4, 0.4), materials.glass, 2);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 2; i++) {
        dummy.position.set((i === 0 ? -1 : 1) * 30, 1.7, 116.25);
        dummy.updateMatrix();
        shops.setMatrixAt(i, dummy.matrix);
      }
      shops.count = 2;
      shops.name = '1884-85 blocks ground-floor shopfronts';
      shops.castShadow = true;
      g.add(shops);
    }
    // Round 233: the Cafe de la Bourse has a glazed ground-floor band under the awning.
    box(g, 26, 3.2, 0.4, 34, 1.6, 138.25, materials.glass, 'Cafe de la Bourse ground-floor glazing');
    // Round 234: the Ancienne Belgique gets an entrance canopy and a marquee band.
    {
      box(g, 8, 0.2, 3, -34, 5.2, 150.6, materials.dark, 'Ancienne Belgique entrance canopy (marquise)');
      box(g, 24, 1.2, 0.5, -34, 20, 150.4, materials.enamelBlue, 'Ancienne Belgique marquee band');
    }
    // Round 235: cornices + window surrounds on the boulevard facade rows.
    {
      const cornices = new THREE.InstancedMesh(new THREE.BoxGeometry(17, 0.9, 15), materials.warmStone, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set(-30 + i * 20, 20.4, 142);
        dummy.updateMatrix();
        cornices.setMatrixAt(i, dummy.matrix);
        dummy.position.set(28 + i * 19, 19.4, 100);
        dummy.updateMatrix();
        cornices.setMatrixAt(4 + i, dummy.matrix);
      }
      cornices.count = 8;
      cornices.name = 'Boulevard facade row cornices';
      cornices.castShadow = true;
      g.add(cornices);
    }
    // Round 236: cornices + quoins on the rue Auguste Orts facades (vers 1885).
    {
      const cornices = new THREE.InstancedMesh(new THREE.BoxGeometry(10.6, 0.7, 0.9), materials.warmStone, 5);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 5; i++) {
        dummy.position.set(-58 - i * 11, 20.3, 62 - i * 9);
        dummy.rotation.set(0, 0.5, 0);
        dummy.updateMatrix();
        cornices.setMatrixAt(i, dummy.matrix);
      }
      cornices.count = 5;
      cornices.name = 'Rue Orts facade cornices (corniches)';
      cornices.castShadow = true;
      g.add(cornices);
    }
    // Round 237: shopfronts at ground level of the square edge facade rows.
    {
      const shops = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 3, 0.4), materials.glass, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        dummy.position.set(69.4, 1.5, 60 + i * 22);
        dummy.updateMatrix();
        shops.setMatrixAt(i, dummy.matrix);
        dummy.position.set(-69.4, 1.5, 60 + i * 22);
        dummy.updateMatrix();
        shops.setMatrixAt(3 + i, dummy.matrix);
      }
      shops.count = 6;
      shops.name = 'Square edge shopfronts (vitrines rez-de-chaussee)';
      g.add(shops);
    }
    // Round 238: flowering plants in the boulevard planters (fleurissement des bacs).
    {
      const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 5), materials.canvas, 12 * 3);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let i = 0; i < 12; i++) for (let k = 0; k < 3; k++) {
        dummy.position.set(-77 + i * 14 + (k - 1) * 1.6, 1.15, 118.5 + (k - 1) * 0.5);
        dummy.updateMatrix();
        flowers.setMatrixAt(n++, dummy.matrix);
      }
      flowers.count = n;
      flowers.name = 'Planter flowers (fleurs des bacs)';
      flowers.castShadow = true;
      g.add(flowers);
    }
    // Round 239: four benches face the Bourse across the square by the water mirror.
    {
      const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.09, 0.6), materials.warmStone, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set(-46 + i * 4, 0.5, 74);
        dummy.updateMatrix();
        seats.setMatrixAt(i, dummy.matrix);
      }
      seats.count = 4;
      seats.name = 'Benches facing the Bourse by the water mirror (bancs face a la Bourse)';
      seats.castShadow = true;
      g.add(seats);
    }
    // Round 240: the stop shelter gets a bench and a timetable case.
    {
      const stop = g.children.find((c) => c.name && c.name.startsWith('Stop sign Bourse - Beurs'));
      if (stop) {
        box(stop, 2.6, 0.09, 0.5, 2.2, 0.45, 0, materials.warmStone, 'shelter bench (banc de l\'abri)');
        box(stop, 1.0, 1.4, 0.08, 2.2, 1.4, -0.8, materials.glass, 'timetable case (fiche horaire)');
      }
    }
    // Round 251: chamfer corner stones where the square meets the boulevard's north edge.
    {
      const chamfers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), materials.pavingEdge, 4);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 4; i++) {
        dummy.position.set([-62, -52, 52, 62][i], 0.1, 113.5);
        dummy.updateMatrix();
        chamfers.setMatrixAt(i, dummy.matrix);
      }
      chamfers.count = 4;
      chamfers.name = 'Square-boulevard junction chamfer stones (pierres biaises)';
      chamfers.castShadow = true;
      g.add(chamfers);
    }
    // Round 252: the boulevard continues north from the square toward De Brouckere.
    box(g, 36, 0.28, 30, 0, -0.14, 100, materials.pavingB, 'Boulevard Anspach north continuation (vers De Brouckere)');
    // Round 253: the boulevard continues south from the square toward Place Fontainas /
    // Boulevard Maurice Lemonnier.
    box(g, 36, 0.28, 26, 0, -0.14, 147, materials.pavingB, 'Boulevard Anspach south continuation (vers Fontainas / Lemonnier)');
    // Round 254: facade row on the north side of the rue Paul Devaux.
    {
      const rows = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 16, 0.8), materials.plaster, 3);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        dummy.position.set(-70 + i * 14, 8, 112);
        dummy.updateMatrix();
        rows.setMatrixAt(i, dummy.matrix);
      }
      rows.count = 3;
      rows.name = 'Rue Paul Devaux facade row (north side)';
      rows.castShadow = true;
      g.add(rows);
    }
    // Round 255: facade row on the rue Jules Van Praet.
    {
      const rows = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 15, 0.8), materials.ochre, 3);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 3; i++) {
        dummy.position.set(-38 + i * 13, 7.5, 112);
        dummy.updateMatrix();
        rows.setMatrixAt(i, dummy.matrix);
      }
      rows.count = 3;
      rows.name = 'Rue Jules Van Praet facade row';
      rows.castShadow = true;
      g.add(rows);
    }
    // Round 256: the Ancienne Belgique's side elevation faces the rue des Bogards side.
    {
      box(g, 0.8, 24, 18, -43, 12, 142, materials.warmStone, 'Ancienne Belgique side elevation (pignon lateral)');
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 4, 2.2), materials.glass, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-43.5, 7 + i * 3.2, 138 + (i % 2) * 8);
        dummy.updateMatrix();
        wins.setMatrixAt(i, dummy.matrix);
      }
      wins.count = 6;
      wins.name = 'Ancienne Belgique side windows';
      g.add(wins);
    }
    // Round 257: rear (north) face of the 1949 building with window rows.
    {
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 2.6, 0.3), materials.glass, 15);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (let f = 0; f < 5; f++) for (let i = 0; i < 3; i++) {
        dummy.position.set(-70 + i * 6, 5 + f * 5, 84.8);
        dummy.updateMatrix();
        wins.setMatrixAt(n++, dummy.matrix);
      }
      wins.count = n;
      wins.name = '1949 building rear windows (face nord)';
      wins.castShadow = true;
      g.add(wins);
    }
    // Round 258: a paved terrace area in front of the Cafe de la Bourse.
    box(g, 24, 0.24, 8, 34, -0.12, 142, materials.pavingA, 'Cafe de la Bourse terrace paving (terrasse)');
    // Round 259: a drainage channel (caniveau) along the boulevard spine.
    box(g, 170, 0.06, 0.5, 0, -0.05, 122, materials.dark, 'Boulevard spine drainage channel (caniveau central)');
    // Round 260: register colliders for the Ancienne Belgique and the Cafe de la Bourse blocks
    // (layout entries in js/brussels-colliders.js).
    // Round 263: the 1949 building's entrance door with stone surround at its base.
    {
      box(g, 4, 5, 0.6, -62, 2.5, 107.4, materials.dark, '1949 building entrance door');
      box(g, 5, 0.4, 0.9, -62, 5.2, 107.5, materials.warmStone, '1949 entrance lintel');
      box(g, 4.6, 0.25, 1.6, -62, 0.12, 108.2, materials.pavingEdge, '1949 entrance step');
    }
    // Round 264: the water mirror has a water-level rim inside its frame.
    mesh(g, new THREE.TorusGeometry(6.9, 0.07, 6, 28), materials.glass, -38, 0.12, 70, 'Water mirror inner rim (niveau d\'eau)');
    // Round 265: each premetro kiosk roof has an edge moulding.
    for (const k of g.children) {
      if (!k.name || !k.name.startsWith('Bourse premetro station')) continue;
      box(k, 3.8, 0.12, 3.8, 0, 3.12, 0, materials.dark, 'kiosk roof edge moulding');
    }
    // Round 266: the Fontaine Orts is crowned by a gilded finial ball.
    {
      const f = g.children.find((c) => c.name && c.name.startsWith('Fontaine Orts'));
      if (f) mesh(f, new THREE.SphereGeometry(0.22, 8, 6), materials.gold, 0, 5.5, 0, 'Fontaine Orts finial (boule sommitale)');
    }
    // Round 267: three steps surround the Orts monument pedestal.
    {
      const m = g.children.find((c) => c.name && c.name.startsWith('Monument to Auguste Orts'));
      if (m) {
        box(m, 4.4, 0.15, 3.0, 0, 0.07, 0, materials.pavingEdge, 'Orts monument step 1');
        box(m, 5.0, 0.15, 3.6, 0, 0.22, 0, materials.pavingEdge, 'Orts monument step 2');
        box(m, 5.6, 0.15, 4.2, 0, 0.37, 0, materials.pavingEdge, 'Orts monument step 3');
      }
    }
    // Round 268: each bin has a second recycling flap on the lid.
    {
      const flaps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.02, 0.2), materials.enamelBlue, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-60 + i * 24 + 0.1, 0.95, 126.5);
        dummy.updateMatrix();
        flaps.setMatrixAt(i, dummy.matrix);
      }
      flaps.count = 6;
      flaps.name = 'Bin recycling flaps (trappe de recyclage)';
      g.add(flaps);
    }
    // Round 269: each lighting pole has a base flange ring.
    {
      const flanges = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.26, 0.12, 10), materials.dark, 8);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 8; i++) {
        dummy.position.set(-70 + i * 20, 0.06, 118.5);
        dummy.updateMatrix();
        flanges.setMatrixAt(i, dummy.matrix);
      }
      flanges.count = 8;
      flanges.name = 'Lighting pole base flanges (socles de mat)';
      flanges.castShadow = true;
      g.add(flanges);
    }
    // Round 270: a contrasting paved axis band runs from the water mirror to the Bourse facade
    // along the rue Auguste Orts view axis.
    box(g, 4, 0.3, 82, 0, -0.1, 94, materials.pavingEdge, 'Rue Orts view axis band toward the Bourse (bande d\'axe)');
    // Round 288: chains linking the bollards across the boulevard street mouths (chaines de
    // poteaux anti-stationnement).
    {
      const links = new THREE.InstancedMesh(new THREE.TorusGeometry(0.09, 0.03, 5, 10), materials.dark, 48);
      const dummy = new THREE.Object3D();
      let n = 0;
      for (const mz of [40, 132]) for (let i = 0; i < 24; i++) {
        dummy.position.set(-11 + i * 0.95, 0.75 + Math.sin(i * 0.55) * 0.12, mz);
        dummy.rotation.set(0, 0, i % 2 ? 0.5 : -0.5);
        dummy.updateMatrix();
        links.setMatrixAt(n++, dummy.matrix);
      }
      links.count = n; links.name = 'Place de la Bourse bollard chains across street mouths (chaines)';
      g.add(links);
    }
    // Round 289: manhole rings in the boulevard carriageway (plaques d'egout sur l'Anspach).
    {
      const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(0.55, 0.06, 6, 18), materials.dark, 6);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 6; i++) {
        dummy.position.set(-6 + (i % 2) * 12, 0.03, 56 + i * 12);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.updateMatrix();
        rings.setMatrixAt(i, dummy.matrix);
      }
      rings.count = 6; rings.name = 'Boulevard Anspach manhole rings (plaques d\'egout)';
      g.add(rings);
    }
    // Round 290: the classified-monument plaque on the socle beside the great stair (inventaire
    // A001/31241 du patrimoine immobilier de la Région de Bruxelles-Capitale).
    box(g, 1.6, 1.1, 0.12, -16.5, 3.2, 41.1, materials.bronze, 'Bourse classified-monument plaque (plaque monument classe A001/31241)');
    // Round 296: the blue enamel metro M discs on the three premetro surface accesses
    // (disques M du premetro Bourse-Grand-Place, lignes 4 et 10).
    for (const k of g.children) {
      if (!k.name || !k.name.startsWith('Bourse premetro station')) continue;
      const disc = mesh(k, new THREE.CylinderGeometry(0.45, 0.45, 0.1, 16), materials.enamelBlue, 0, 4.9, 1.35, 'Premetro access metro M disc (disque M email bleu)');
      disc.rotation.x = Math.PI / 2;
    }
    // Round 297: blue enamel street-name plaques on the square's ring buildings (plaques de rue).
    {
      const plaques = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), materials.enamelBlue, 4);
      const dummy = new THREE.Object3D();
      const spots = [[-30, 6, 116.3], [30, 6, 116.3], [34, 6, 138.2], [-62, 8, 96.2]];
      for (let i = 0; i < 4; i++) {
        dummy.position.set(spots[i][0], spots[i][1], spots[i][2]);
        dummy.updateMatrix();
        plaques.setMatrixAt(i, dummy.matrix);
      }
      plaques.count = 4; plaques.name = 'Street name enamel plaques on the square ring (plaques de rue en email bleu)';
      g.add(plaques);
    }
    // Round 298: the Cafe de la Bourse (no. 78, 1874, Janlet) canvas awning over its terrace
    // (store banne du Cafe de la Bourse).
    {
      box(g, 10, 0.12, 3.2, 34, 4.6, 137.2, materials.canvas, 'Cafe de la Bourse canvas awning (store banne)');
      for (const px of [29.5, 38.5]) box(g, 0.12, 4.6, 0.12, px, 2.3, 138.6, materials.dark, 'Cafe de la Bourse awning pole');
    }
    // Round 299: stone coping ring around the Fontaine Orts basin (bordure du bassin).
    mesh(g, new THREE.TorusGeometry(2.45, 0.16, 6, 24), materials.blueStone, -52, 0.78, 78, 'Fontaine Orts basin rim coping (bordure du bassin)');
    // __SURROUNDINGS_ROUNDS__
  });

  scene?.add(group);
  group.updateMatrixWorld(true);
  const zones = (GEO.landmarkZones || []).map((z) => ({ id: z.id, pts: z.pts }));
  for (const id in landmarks) {
    const bb = new THREE.Box3().setFromObject(landmarks[id].group).expandByScalar(3);
    if (bb.isEmpty()) continue;
    zones.push({ id, pts: [bb.min.x, bb.min.z, bb.max.x, bb.min.z, bb.max.x, bb.max.z, bb.min.x, bb.max.z] });
  }
  function setNight(t) {
    const level = Math.max(0, Math.min(1, Number(t) || 0));
    for (const m of nightGlowMats) {
      m.emissive.setHex(0xffb45a);
      m.emissiveIntensity = level * 0.85;
    }
    for (const m of facadeWashMats) {
      m.emissive.setHex(0xffd9a0);
      m.emissiveIntensity = level * 0.16;
    }
  }
  return {
    group, colliders, zones, landmarks,
    update(dt, night) { if (typeof night === 'number') setNight(night); },
    setNight
  };
}
