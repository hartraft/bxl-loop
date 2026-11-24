// Brussels-specific, procedural landmark geometry. Kept behind the Brussels city selector.
import * as THREE from 'three/webgpu';
import { GEO } from './brx-geodata.js';
import { BRUSSELS_LANDMARK_ANCHORS, MONT_DES_ARTS_ROTATION, PALAIS_DE_JUSTICE_ROTATION, brusselsToWorld } from './brussels-frame.js';
import { foundationSkirtBottom } from './brussels-terrain.js';
import { createBrusselsLandmarkColliders, splitMontDesArtsWall } from './brussels-colliders.js';

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
  // Facade stone materials get a faint warm floodlight wash at night (the real square is
  // floodlit after dark) — clone them so daytime rendering is untouched.
  const facadeWashMats = [];
  for (const key of ['limestone', 'paleStone', 'warmStone', 'ochre', 'plaster', 'gobertange', 'euville', 'gold', 'bronze', 'pavingA', 'pavingB']) {
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
    build(root);
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
    // Rebuild-date cartouche beside the door — the real houses carry "Anno 1697" etc. after the
    // 1695 bombardment — and a small pediment crowns the doorway.
    box(root, 0.8, 0.3, 0.1, width / 2 - 1.3, 3.9, 0.34, materials.dark, name + ' rebuild date cartouche');
    box(root, 0.6, 0.18, 0.04, width / 2 - 1.3, 3.9, 0.4, materials.gold, name + ' rebuild date cartouche rim');
    // Gilded house-number plaque beside the doorway, as on the real facades.
    box(root, 0.4, 0.5, 0.06, width / 2 - 1.3, 3.15, 0.36, materials.gold, name + ' house number plaque');
    const doorPed = new THREE.Shape();
    doorPed.moveTo(-0.35, 0); doorPed.lineTo(0, 0.32); doorPed.lineTo(0.35, 0); doorPed.closePath();
    mesh(root, new THREE.ShapeGeometry(doorPed), stone, 0, 3.32, 0.42, name + ' door surround pediment');
    // Small attic windows in the gable base, flanking the oculus.
    const atticWindows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.7, 0.1), spec.windowMat || glowGlass, 2);
    for (let i = 0; i < 2; i++) {
      modDummy.position.set((i === 0 ? -1 : 1) * width / 4, height + 0.75, 0.14);
      modDummy.updateMatrix();
      atticWindows.setMatrixAt(i, modDummy.matrix);
    }
    atticWindows.count = 2;
    atticWindows.name = name + ' gable attic windows';
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
    box(root, width + 0.7, 0.35, depth + 0.5, 0, height + 0.2, -depth / 2, roof, name + ' roof cap');
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
    box(root, 0.35, height - 1.8, 0.25, -width / 2 + 0.45, height / 2 + 0.5, 0.16, materials.gold);
    box(root, 0.35, height - 1.8, 0.25, width / 2 - 0.45, height / 2 + 0.5, 0.16, materials.gold);
    cylinder(root, 0.12, 0.12, 1.3, 0, height + gableHeight + 0.55, 0.08, materials.gold, 8);
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
        const vane = box(root, 1.1, 0.1, 0.06, 0, height + gableHeight + 2.3, 0.08, materials.gold, name + ' gilded weather vane');
        vane.rotation.y = 0.6;
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
    }
    if (spec.equestrian) {
      // L'Arbre d'Or (brewers' guild house, no. 10): the roof carries a gilded equestrian statue
      // of Duke Charles of Lorraine, installed 1901 (replacing Maximilian II Emmanuel of Bavaria).
      box(root, 0.9, 0.5, 0.4, 0, height + gableHeight + 1.0, 0.1, materials.gold, name + ' equestrian horse body');
      box(root, 0.3, 0.45, 0.3, 0.55, height + gableHeight + 1.35, 0.1, materials.gold, name + ' equestrian horse head');
      box(root, 0.34, 1.0, 0.24, 0, height + gableHeight + 1.85, 0.1, materials.gold, name + ' Charles of Lorraine rider');
      mesh(root, new THREE.SphereGeometry(0.16, 8, 6), materials.gold, 0, height + gableHeight + 2.45, 0.1, name + ' Charles of Lorraine rider head');
    }
    if (spec.dukeBusts) {
      // Maison des Ducs de Brabant (east side, nos. 13-19 behind a single facade): stone busts
      // of the dukes of Brabant line the pilasters of the facade.
      const bustDiscs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12).rotateX(Math.PI / 2), materials.warmStone, 6);
      const bustHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 8, 6), stone, 6);
      for (let i = 0; i < 6; i++) {
        const bx = -width / 2 + 0.8 + i * (width - 1.6) / 5;
        pedDummy.position.set(bx, height * 0.55, 0.18);
        pedDummy.updateMatrix();
        bustDiscs.setMatrixAt(i, pedDummy.matrix);
        pedDummy.position.set(bx, height * 0.55 + 0.24, 0.24);
        pedDummy.updateMatrix();
        bustHeads.setMatrixAt(i, pedDummy.matrix);
      }
      bustDiscs.count = bustHeads.count = 6;
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
    // The arcade pillars are adorned with statues of knights and squires of the Seven Noble
    // Houses of Brussels — instanced gilded figures on top of every pier.
    const knightStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.95, 0.12), materials.gold, bays * 2);
    const voussoirs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.3, 0.34), trim, bays * 6);
    const vd = new THREE.Object3D();
    let vi = 0;
    const knightDummy = new THREE.Object3D();
    let kn = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      box(root, 1.72, 6.0, 0.24, x, 4.0, 0.19, glass, 'Town Hall recessed Gothic arcade');
      box(root, 0.34, 7.1, 0.55, x - bayW / 2 + 0.12, 4.1, 0.22, trim, 'Arcade pier');
      box(root, 0.34, 7.1, 0.55, x + bayW / 2 - 0.12, 4.1, 0.22, trim, 'Arcade pier');
      for (const px of [x - bayW / 2 + 0.12, x + bayW / 2 - 0.12]) {
        knightDummy.position.set(px, 7.85, 0.3);
        knightDummy.updateMatrix();
        knightStatues.setMatrixAt(kn++, knightDummy.matrix);
      }
      // pointed arch head, built from two sloping stone ribs
      const archL = box(root, 2.05, 0.28, 0.48, x - 0.52, 7.12, 0.22, trim, 'Pointed arcade arch');
      archL.rotation.z = -0.55;
      const archR = box(root, 2.05, 0.28, 0.48, x + 0.52, 7.12, 0.22, trim, 'Pointed arcade arch');
      archR.rotation.z = 0.55;
      box(root, bayW - 0.55, 0.24, 0.5, x, 7.55, 0.22, darkStone, 'Arcade string course');
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
    const leafFinials = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), materials.gold, bays);
    const trefoilBand = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 12).rotateX(Math.PI / 2), trim, bays);
    const histCorbels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.42, 0.4), darkStone, bays * 2);
    let lf = 0, hc = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      vd.position.set(x, 7.82, 0.28);
      vd.rotation.z = 0;
      vd.updateMatrix();
      leafFinials.setMatrixAt(lf++, vd.matrix);
      vd.position.set(x, 8.05, 0.26);
      vd.updateMatrix();
      trefoilBand.setMatrixAt(lf - 1, vd.matrix);
      for (const px of [x - bayW / 2 + 0.12, x + bayW / 2 - 0.12]) {
        vd.position.set(px, 7.45, 0.32);
        vd.updateMatrix();
        histCorbels.setMatrixAt(hc++, vd.matrix);
      }
    }
    leafFinials.count = trefoilBand.count = bays;
    histCorbels.count = hc;
    leafFinials.name = 'Arcade arch cabbage-leaf finials';
    trefoilBand.name = 'Arcade trefoil band';
    histCorbels.name = 'Knight statue historiated corbels';
    root.add(leafFinials, trefoilBand, histCorbels);
    // Capitals widen the top of every arcade pier, as on the real Brabantine arcade.
    const pierCapitals = new THREE.InstancedMesh(new THREE.BoxGeometry(0.44, 0.22, 0.6), trim, bays * 2);
    let pc = 0;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      for (const px of [x - bayW / 2 + 0.12, x + bayW / 2 - 0.12]) {
        vd.position.set(px, 7.62, 0.24);
        vd.rotation.z = 0;
        vd.updateMatrix();
        pierCapitals.setMatrixAt(pc++, vd.matrix);
      }
    }
    pierCapitals.count = pc;
    pierCapitals.name = 'Arcade pier capitals';
    root.add(pierCapitals);
    // A stone balcony connects the two wings across the facade above the arcade, on a row of
    // balusters — as on the real elevation.
    box(root, width + 1.2, 0.4, 1.3, 0, 8.7, 0.55, trim, 'Wing-connecting balcony');
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
    // Small gabled canopy hoods shelter the statues standing above the arcade arch heads.
    const canopyShape = new THREE.Shape();
    canopyShape.moveTo(-0.45, 0); canopyShape.lineTo(0, 0.4); canopyShape.lineTo(0.45, 0); canopyShape.closePath();
    const canopies = new THREE.InstancedMesh(new THREE.ShapeGeometry(canopyShape), trim, bays);
    let cn = 0;
    for (let i = 0; i < bays; i++) {
      wbd.position.set(-width / 2 + bayW * (i + 0.5), 9.85, 0.3);
      wbd.updateMatrix();
      canopies.setMatrixAt(cn++, wbd.matrix);
    }
    canopies.count = cn;
    canopies.name = 'Arcade statue canopy hoods';
    root.add(canopies);

    // Upper storeys: paired lancets with stone mouldings, balconies, a buttress rhythm at
    // alternating bay joints, and a gilded statue in a niche at the remaining joints — the
    // real facade is densely packed with niches holding dukes, saints and allegorical figures.
    const facadeNiches = new THREE.InstancedMesh(new THREE.BoxGeometry(0.72, 2.5, 0.22), darkStone, bays * 2);
    const facadeStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 1.15, 0.14), materials.gold, bays * 2);
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
    // Statues in niches above the ground-floor arcade arch heads as well — the real
    // facade carries nearly three hundred figures on every level.
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
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
    for (const side of [-1, 1]) {
      box(tower, 0.66, 2.4, 0.25, side * 2.6, 5.5, towerW / 2 + 0.08, darkStone, 'Portal jamb knight niche');
      box(tower, 0.24, 1.1, 0.12, side * 2.6, 5.5, towerW / 2 + 0.22, materials.gold, 'Portal jamb knight statue');
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
    // Stone entrance steps descend from the ogival portal onto the square.
    for (let i = 0; i < 3; i++) {
      box(tower, 5.4 - i * 0.8, 0.22, 0.7, 0, 0.11 + i * 0.22, towerW / 2 + 0.55 + i * 0.55, darkStone, 'Portal entrance step');
    }
    // Massive wooden door leaves with a gilded transom bar and kick plates.
    box(tower, 2.3, 3.4, 0.18, 0, 1.9, towerW / 2 + 0.2, materials.dark, 'Portal door leaves');
    box(tower, 2.3, 0.12, 0.1, 0, 3.68, towerW / 2 + 0.24, materials.gold, 'Portal door transom bar');
    box(tower, 2.3, 0.3, 0.06, 0, 0.35, towerW / 2 + 0.26, materials.gold, 'Portal door kick plate');
    // Gilded semicircular fanlight above the portal door leaves.
    mesh(tower, new THREE.CircleGeometry(1.05, 16, 0, Math.PI), glass, 0, 3.72, towerW / 2 + 0.22, 'Portal fanlight');
    // Hood mould sheltering the whole ogival portal, as on the real tower base.
    const hoodShape = new THREE.Shape();
    hoodShape.moveTo(-3.4, 0); hoodShape.lineTo(0, 1.3); hoodShape.lineTo(3.4, 0); hoodShape.closePath();
    mesh(tower, new THREE.ShapeGeometry(hoodShape), trim, 0, 11.3, towerW / 2 + 0.2, 'Portal hood mould');
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
    // Gallery above the roofline, with projecting pinnacles at its corners and mid-sides.
    cylinder(tower, 5.6, 6.2, 1.8, 0, 56.9, 0, trim, 8).name = 'Tower gallery above the roofline';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      const x = Math.cos(a) * 5.1, z = Math.sin(a) * 5.1;
      cylinder(tower, 0.3, 0.44, 5.6, x, 60.6, z, trim, 8).name = 'Gallery projecting pinnacle';
      mesh(tower, new THREE.ConeGeometry(0.52, 2.3, 8), roofMat, x, 64.2, z, 'Gallery pinnacle spire');
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
    // Three-tier openwork octagonal lantern: slender piers, pointed arch ribs, parapets.
    cylinder(tower, 4.9, 5.3, 2.0, 0, 59.6, 0, darkStone, 8).name = 'Openwork octagonal lantern base';
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
    cylinder(tower, 1.5, 1.5, 0.14, 0, 90.6, 0, materials.gold, 8).name = 'Spire gilded ring armature';
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
    box(root, width + 0.9, 0.8, depth + 0.7, 0, height - 0.4, -depth / 2, trim, 'King’s House upper cornice');
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

    // Central pavilion with a stepped gable and Jamaer's central tower: square shaft,
    // octagonal top, domed slate spire — 38.49 m in reality.
    box(root, 11, height + 2.5, depth + 1.4, 0, (height + 2.5) / 2, -depth / 2 - 0.5, stone, 'King’s House central pavilion');
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
    // Gilded cross finial at the apex of the central gable.
    box(root, 0.06, 0.7, 0.06, 0, height + 2.5 + gh + 0.35, 0.32, materials.gold, 'King’s House gable apex cross vertical');
    box(root, 0.42, 0.06, 0.06, 0, height + 2.5 + gh + 0.5, 0.32, materials.gold, 'King’s House gable apex cross arm');
    const towerZ = -depth / 2 - 0.7;
    box(root, 2.8, 33, 2.8, 0, 16.5, towerZ, trim, 'King’s House central tower square shaft');
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
    const dome = mesh(root, new THREE.SphereGeometry(1.7, 12, 8), roofMat, 0, 36.3, towerZ, 'King’s House tower domed slate spire');
    dome.scale.set(1, 0.75, 1);
    cylinder(root, 0.08, 0.14, 1.2, 0, 38.2, towerZ, materials.gold, 6).name = 'King’s House tower finial';
    // Gilded flag flying from the tower finial.
    const khFlag = box(root, 0.7, 0.4, 0.04, 0.4, 38.9, towerZ, materials.gold, 'King’s House tower gilded flag');
    khFlag.rotation.z = 0.12;
    // Statue of Charles V on the central tower, as on the real building.
    box(root, 0.5, 1.8, 0.2, 0, 30.5, towerZ + 1.55, darkStone, 'King’s House Charles V statue');
    mesh(root, new THREE.SphereGeometry(0.24, 8, 6), darkStone, 0, 31.6, towerZ + 1.55, 'King’s House Charles V statue head');
    // The 1625 Virgin Mary statue group on the central pavilion: Mary flanked by two saints.
    box(root, 0.5, 1.9, 0.2, 0, 19.0, 0.26, stone, 'King’s House Virgin Mary statue');
    mesh(root, new THREE.SphereGeometry(0.24, 8, 6), stone, 0, 20.1, 0.26, 'King’s House Virgin Mary statue head');
    for (const side of [-1, 1]) {
      box(root, 0.4, 1.5, 0.18, side * 1.2, 18.8, 0.26, stone, 'King’s House saint statue');
      mesh(root, new THREE.SphereGeometry(0.2, 8, 6), stone, side * 1.2, 19.65, 0.26, 'King’s House saint statue head');
    }
    // Clock face on the tower shaft below the octagonal belfry — the real Broodhuis
    // tower carries a clock above the roofline.
    const clockRim = cylinder(root, 1.18, 1.18, 0.12, 0, 29.0, towerZ + 1.42, darkStone, 24);
    clockRim.name = 'King’s House tower clock rim';
    mesh(root, new THREE.CircleGeometry(1.05, 24), materials.plaster, 0, 29.0, towerZ + 1.43, 'King’s House tower clock face');
    box(root, 0.09, 0.62, 0.04, 0, 29.12, towerZ + 1.49, materials.dark, 'King’s House clock minute hand');
    box(root, 0.09, 0.42, 0.04, 0.18, 28.9, towerZ + 1.49, materials.dark, 'King’s House clock hour hand');
    // Grand pointed portal in the central ground-floor bay: door leaves, archivolt,
    // sculpted tympanum and a flight of steps — the real Broodhuis main entrance.
    box(root, 2.3, 4.0, 0.2, 0, 2.5, 0.18, materials.dark, 'King’s House portal door leaves');
    box(root, 0.12, 3.6, 0.24, 0, 2.3, 0.18, trim, 'King’s House portal door mullion');
    const portL = box(root, 1.6, 0.24, 0.4, -0.55, 5.35, 0.2, trim, 'King’s House portal pointed arch');
    portL.rotation.z = -0.6;
    const portR = box(root, 1.6, 0.24, 0.4, 0.55, 5.35, 0.2, trim, 'King’s House portal pointed arch');
    portR.rotation.z = 0.6;
    const tymp = new THREE.Shape();
    tymp.moveTo(-1.1, 0); tymp.lineTo(1.1, 0); tymp.lineTo(0, 0.85); tymp.closePath();
    mesh(root, new THREE.ShapeGeometry(tymp), darkStone, 0, 5.6, 0.2, 'King’s House portal tympanum');
    for (let s = 0; s < 3; s++) {
      box(root, 3.6 + s * 0.4, 0.22, 0.35, 0, 0.11 + (2 - s) * 0.22, 0.55 + s * 0.3, darkStone, 'King’s House portal step');
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
    // Granite kerb stones along all four facade lines where the paving meets the buildings.
    for (const [w, d, x, z, n] of [[110, 0.5, 0, 35.6, 'south'], [110, 0.5, 0, -35.6, 'north'], [0.5, 71, -54.6, 0, 'west'], [0.5, 71, 54.6, 0, 'east']]) {
      box(plaza, w, 0.18, d, x, 0.02, z, materials.pavingEdge, `Grand-Place ${n} facade kerb`);
    }
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
      // A small bronze hood shelters each 2018 UNESCO plaque from the rain.
      box(front, 0.7, 0.12, 0.18, x, 1.68, 0.12, materials.bronze, `UNESCO plaque hood – ${street}`);
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
  }

  addLandmark('grandPlace', grandPlace);
  addLandmark('mannekenPis', (g) => {
    // Manneken Pis at the corner of Rue de l'Étuve / Rue du Chêne, a stone's throw from the
    // Grand-Place: Duquesnoy's 1619 bronze boy set in his 1770 blue-stone rocaille niche,
    // pouring into a stone basin, fenced by the 1851 wrought-iron railings.
    box(g, 3.2, 4.4, 0.7, 0, 2.2, -0.3, materials.blueStone, 'Manneken Pis rocaille niche back');
    mesh(g, new THREE.CircleGeometry(1.15, 16, 0, Math.PI), materials.blueStone, 0, 2.2, -0.24, 'Manneken Pis rocaille niche arch');
    box(g, 2.5, 0.5, 0.8, 0, 4.65, -0.28, materials.blueStone, 'Manneken Pis niche cornice');
    box(g, 2.2, 1.3, 2.2, 0, 0.65, 0, materials.dark, 'Manneken Pis pedestal plinth');
    cylinder(g, 0.34, 0.45, 1.6, 0, 2.1, 0, materials.blueStone, 8).name = 'Manneken Pis column';
    box(g, 0.3, 0.62, 0.22, 0, 3.15, 0, materials.bronze, 'Manneken Pis bronze figure');
    mesh(g, new THREE.SphereGeometry(0.16, 10, 8), materials.bronze, 0, 3.56, 0, 'Manneken Pis bronze head');
    cylinder(g, 0.02, 0.02, 0.5, 0.14, 3.0, 0.12, materials.glass, 6).name = 'Manneken Pis water jet';
    cylinder(g, 1.1, 1.25, 0.5, 0, 0.25, 0, materials.blueStone, 12).name = 'Manneken Pis stone basin';
    mesh(g, new THREE.CircleGeometry(1.05, 12), materials.glass, 0, 0.42, 0, 'Manneken Pis basin water');
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      box(g, 0.06, 0.8, 0.06, Math.cos(a) * 1.55, 0.4, Math.sin(a) * 1.55, materials.dark, 'Manneken Pis railing post');
    }
    const hoop = mesh(g, new THREE.TorusGeometry(1.55, 0.04, 6, 20), materials.dark, 0, 0.82, 0, 'Manneken Pis railing top hoop');
    hoop.rotation.x = Math.PI / 2;
    box(g, 0.5, 0.3, 0.05, 0, 1.6, -0.62, materials.bronze, 'Manneken Pis commemorative plaque');
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
