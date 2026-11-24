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
  // Facade stone materials get a faint warm floodlight wash at night (the real square is
  // floodlit after dark) — clone them so daytime rendering is untouched.
  const facadeWashMats = [];
  for (const key of ['limestone', 'paleStone', 'warmStone', 'ochre', 'plaster']) {
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
    box(root, width + 0.45, 0.45, 0.35, 0, 1.15, 0.12, materials.warmStone, name + ' plinth');

    const bays = Math.max(3, Math.round(width / 2.8));
    const windowGeo = new THREE.BoxGeometry(1.05, 1.45, 0.16);
    const frameGeo = new THREE.BoxGeometry(1.28, 1.7, 0.12);
    const windows = new THREE.InstancedMesh(windowGeo, spec.windowMat || glowGlass, bays * floors);
    const frames = new THREE.InstancedMesh(frameGeo, materials.gold, bays * floors);
    // Stone cross-mullions (croisées de pierre) dividing each window into four lights — the real
    // houses' upper windows are crossed like this (blue-stone croisillons on e.g. Le Mont Thabor).
    const mullionV = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 1.45, 0.06), stone, bays * floors);
    const mullionH = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 0.09, 0.06), stone, bays * floors);
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
        index++;
      }
    }
    windows.name = name + ' windows';
    frames.name = name + ' gilded window surrounds';
    mullionV.name = mullionH.name = name + ' window stone cross-mullions';
    windows.castShadow = frames.castShadow = true;
    root.add(windows, frames, mullionV, mullionH);

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
    // Arched door leaf with a gilded fanlight in the centre arcade bay of every house.
    box(root, 0.95, 2.5, 0.12, 0, 1.55, 0.42, materials.dark, name + ' arched door leaf');
    const fanlight = cylinder(root, 0.4, 0.4, 0.08, 0, 3.02, 0.44, materials.gold, 16);
    fanlight.name = name + ' door fanlight';
    fanlight.rotation.x = Math.PI / 2;
    if (terrace) {
      // Café awning sloping over each ground-floor arcade bay — the real square's
      // brasseries and cafés sit under canvas awnings on the Grand-Place.
      const awnings = new THREE.InstancedMesh(new THREE.BoxGeometry((width - 2.8) / bays - 0.3, 0.05, 1.3), materials.canvas, bays);
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

    // Repeated pointed ground-floor arcade: dark recessed openings, piers and pointed heads.
    const bays = 16, bayW = width / bays;
    // The arcade pillars are adorned with statues of knights and squires of the Seven Noble
    // Houses of Brussels — instanced gilded figures on top of every pier.
    const knightStatues = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.95, 0.12), materials.gold, bays * 2);
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
    }
    knightStatues.count = kn;
    knightStatues.name = 'Arcade pillar knight statues (Noble Houses)';
    knightStatues.castShadow = true;
    root.add(knightStatues);

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
    // Both wings terminate in corner turrets that rise the full facade height, above the roofline.
    for (const side of [-1, 1]) {
      const turret = new THREE.Group();
      turret.position.set(side * (width / 2 - 2.2), 0, -depth / 2);
      root.add(turret);
      const shaft = cylinder(turret, 1.5, 1.8, height + 7, 0, (height + 7) / 2, 0, trim, 8);
      shaft.name = 'Facade corner turret';
      mesh(turret, new THREE.ConeGeometry(1.9, 7, 8), roofMat, 0, height + 10.5, 0, 'Facade corner turret spire');
      mesh(turret, new THREE.SphereGeometry(0.24, 8, 6), materials.gold, 0, height + 14.3, 0, 'Facade corner turret gilded finial');
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
    // Prophet figures in niches above the portal, between the shaft lancets.
    for (const side of [-1, 1]) {
      for (const dx of [1.1, 3.3]) {
        box(tower, 0.66, 2.2, 0.2, side * dx, 10.75, towerW / 2 + 0.08, darkStone, 'Portal prophet niche');
        box(tower, 0.24, 1.05, 0.12, side * dx, 10.75, towerW / 2 + 0.2, materials.gold, 'Portal prophet gilded figure');
      }
    }
    // Narrow lancet recesses on the front and side faces of the shaft.
    for (const y of [6.5, 15, 23.5, 32, 40.5, 48.5]) {
      for (const side of [-1, 1]) {
        box(tower, 1.15, 4.4, 0.2, side * 2.3, y, towerW / 2 + 0.08, glass, 'Tower lancet');
        box(tower, 0.16, 4.75, 0.26, side * 2.3, y, towerW / 2, trim, 'Tower lancet moulding');
        box(tower, 0.2, 4.4, 1.15, towerW / 2 + 0.08, y, side * 2.3, glass, 'Tower side lancet');
      }
    }
    // Gallery above the roofline, with projecting pinnacles at its corners and mid-sides.
    cylinder(tower, 5.6, 6.2, 1.8, 0, 56.9, 0, trim, 8).name = 'Tower gallery above the roofline';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      const x = Math.cos(a) * 5.1, z = Math.sin(a) * 5.1;
      cylinder(tower, 0.3, 0.44, 5.6, x, 60.6, z, trim, 8).name = 'Gallery projecting pinnacle';
      mesh(tower, new THREE.ConeGeometry(0.52, 2.3, 8), roofMat, x, 64.2, z, 'Gallery pinnacle spire');
    }
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
    box(root, width + 0.9, 0.8, depth + 0.7, 0, height - 0.4, -depth / 2, trim, 'King’s House upper cornice');

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
    // First-floor gallery: arched windows above a continuous balustrade.
    box(root, width - 1.5, 0.85, 0.55, 0, 7.6, 0.4, trim, 'First gallery balustrade');
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + bayW * (i + 0.5);
      box(root, 1.5, 4.2, 0.2, x, 10.6, 0.22, glass, 'King’s House first-floor gallery arch');
      box(root, 1.7, 0.24, 0.3, x, 13.1, 0.22, trim, 'First gallery window hood');
    }
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

    // Standard-bearer statues dotting the parapet, as on the real roofline.
    for (let i = 0; i < 6; i++) {
      const x = -width / 2 + 3.5 + i * 5.2;
      box(root, 0.24, 1.0, 0.12, x, height + 0.55, 0.18, materials.gold, 'King’s House standard-bearer statue');
    }

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
    const towerZ = -depth / 2 - 0.7;
    box(root, 2.8, 33, 2.8, 0, 16.5, towerZ, trim, 'King’s House central tower square shaft');
    cylinder(root, 1.35, 1.5, 2.6, 0, 34.3, towerZ, trim, 8).name = 'King’s House central tower octagonal top';
    const dome = mesh(root, new THREE.SphereGeometry(1.7, 12, 8), roofMat, 0, 36.3, towerZ, 'King’s House tower domed slate spire');
    dome.scale.set(1, 0.75, 1);
    cylinder(root, 0.08, 0.14, 1.2, 0, 38.2, towerZ, materials.gold, 6).name = 'King’s House tower finial';
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
    const dummy = new THREE.Object3D();
    let a = 0, b = 0;
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 16; col++) {
        const x = -51.7 + col * 6.9 + (row % 2) * 0.45;
        const z = -35 + row * 4.9;
        dummy.position.set(x, -0.06, z);
        dummy.rotation.y = ((row + col) % 3) * 0.025;
        dummy.updateMatrix();
        if ((row + col) % 2) cobblesA.setMatrixAt(a++, dummy.matrix);
        else cobblesB.setMatrixAt(b++, dummy.matrix);
      }
    }
    cobblesA.count = a; cobblesB.count = b;
    cobblesA.name = 'Grand-Place cobblestone courses A';
    cobblesB.name = 'Grand-Place cobblestone courses B';
    cobblesA.receiveShadow = cobblesB.receiveShadow = true;
    plaza.add(cobblesA, cobblesB);
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

    // Perimeter facades frame the plaza with the real houses, by name and side.
    // North = negative Z; south = positive Z. The Town Hall holds the south-west of the
    // south side with guild houses to its east; the King's House faces it from the north.
    const south = new THREE.Group();
    south.name = 'South frontage';
    south.position.set(0, 0, 36);
    south.rotation.y = Math.PI;
    plaza.add(south);
    townHall(south);
    guildHouse(south, { name: 'Guild House – L’Étoile', x: -30, width: 13, height: 21, floors: 3, style: 'stepped', stone: materials.warmStone });
    guildHouse(south, { name: 'Guild House – Le Cygne', x: -44, width: 12, height: 23, floors: 4, style: 'bell', stone: materials.plaster, emblem: true, terrace: true, swan: true });

    const north = new THREE.Group();
    north.name = 'North frontage';
    north.position.set(0, 0, -36);
    plaza.add(north);
    kingsHouse(north);
    guildHouse(north, { name: 'Guild House – Le Heaume', x: -27, width: 11, height: 20, style: 'gable', stone: materials.warmStone });
    guildHouse(north, { name: 'Guild House – Le Paon', x: -38, width: 12, height: 22, floors: 3, style: 'neck', stone: materials.paleStone });
    guildHouse(north, { name: 'Guild House – Sainte-Barbe', x: -48.5, width: 10, height: 19, style: 'stepped' });
    guildHouse(north, { name: 'Guild House – Le Cerf', x: 23.5, width: 11, height: 21, style: 'stepped', stone: materials.warmStone });
    guildHouse(north, { name: 'Guild House – L’Ange', x: 34, width: 11, height: 23, floors: 4, style: 'scroll', stone: materials.plaster });
    guildHouse(north, { name: 'Guild House – La Chaloupe d’Or', x: 46.5, width: 11, height: 24, style: 'bell', stone: materials.ochre, emblem: true, terrace: true });

    const west = new THREE.Group();
    west.name = 'West frontage';
    west.position.set(-55, 0, 0);
    west.rotation.y = Math.PI / 2;
    plaza.add(west);
    // West side, numbered from the north corner like the real nos. 1-7, with the street
    // mouths left open at both ends: Rue au Beurre (north) and Rue de la Tête d'or (south).
    guildHouse(west, { name: 'Guild House – Le Roy d’Espagne', x: 23, width: 8.5, height: 24, floors: 4, style: 'bell', stone: materials.plaster, emblem: 'vane', balustradeStatues: true, terrace: true, medallions: true });
    guildHouse(west, { name: 'Guild House – La Brouette', x: 13.5, width: 8.5, height: 20, style: 'stepped', stone: materials.plaster, brouette: true });
    guildHouse(west, { name: 'Guild House – Le Sac', x: 4, width: 8.5, height: 22, style: 'gable', stone: materials.warmStone, guildTools: true });
    guildHouse(west, { name: 'Guild House – La Louve', x: -5.5, width: 8.5, height: 23, floors: 3, style: 'scroll', stone: materials.ochre, emblem: true, terrace: true, louve: true });
    guildHouse(west, { name: 'Guild House – Le Cornet', x: -15, width: 8.5, height: 21, style: 'scroll', stone: materials.ochre, emblem: 'horse', cornet: true });
    guildHouse(west, { name: 'Guild House – Le Renard', x: -24.5, width: 8.5, height: 20, style: 'gable', stone: materials.warmStone, continents: true });

    const east = new THREE.Group();
    east.name = 'East frontage';
    east.position.set(55, 0, 0);
    east.rotation.y = -Math.PI / 2;
    plaza.add(east);
    guildHouse(east, { name: 'Guild House – L’Arbre d’Or', x: -18, width: 15, height: 22, style: 'stepped', stone: materials.ochre, terrace: true, equestrian: true, dukeBusts: true });
    guildHouse(east, { name: 'Guild House – La Rose', x: 1, width: 16, height: 24, style: 'bell', stone: materials.paleStone, emblem: true, dukeBusts: true, abundance: true });
    guildHouse(east, { name: 'Guild House – Le Mont Thabor', x: 20, width: 15, height: 20, style: 'gable', terrace: true, dukeBusts: true });

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
    }

    // Traditional Brussels enamel street signs — blue board with a white rim on a dark post —
    // stand at each of the seven street mouths, naming the street that opens onto the square.
    const signRims = new THREE.InstancedMesh(new THREE.BoxGeometry(1.56, 0.48, 0.04), materials.plaster, plaques.length);
    const signBoards = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.42, 0.06), materials.enamelBlue, plaques.length);
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
    box(g, 2.2, 1.3, 2.2, 0, 0.65, 0, materials.dark);
    cylinder(g, 0.34, 0.45, 1.6, 0, 2.1, 0, materials.gold, 8);
    mesh(g, new THREE.SphereGeometry(0.32, 10, 8), materials.gold, 0, 3.15, 0);
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
    const stone = new THREE.MeshStandardMaterial({ color: 0xd9d1c4, roughness: 0.88 });
    const ashlar = new THREE.MeshStandardMaterial({ color: 0xc8beae, roughness: 0.9 });
    const moulding = new THREE.MeshStandardMaterial({ color: 0xe2dacc, roughness: 0.84 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x596260, roughness: 0.92 });
    const roofEdge = new THREE.MeshStandardMaterial({ color: 0x30393a, roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x273b43, roughness: 0.34, metalness: 0.12 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x74664d, metalness: 0.48, roughness: 0.58 });
    const shadow = new THREE.MeshStandardMaterial({ color: 0x303638, roughness: 0.84 });
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

        // Piano nobile: tall French windows with proper stone surrounds.
        for (const [floorY, winH] of [[9.9, 3.55], [16.0, 3.0]]) {
          box(g, 1.95, winH, 0.2, bx, floorY, facadeZ + 0.1, glass, 'Wing French window');
          box(g, 2.25, 0.2, 0.38, bx, floorY - winH / 2 - 0.12, facadeZ + 0.2, moulding, 'Wing window sill');
          box(g, 2.25, 0.2, 0.38, bx, floorY + winH / 2 + 0.12, facadeZ + 0.2, moulding, 'Wing window lintel');
          box(g, 0.14, winH + 0.34, 0.3, bx - 1.1, floorY, facadeZ + 0.2, ashlar, 'Wing window jamb');
          box(g, 0.14, winH + 0.34, 0.3, bx + 1.1, floorY, facadeZ + 0.2, ashlar, 'Wing window jamb');
        }

        // Delicate iron balconettes recur along the piano nobile, not every opening.
        if (i % 2 === 0) {
          box(g, 2.2, 0.12, 0.58, bx, 7.92, facadeZ + 0.62, bronze, 'Wing balcony rail');
          for (let k = 0; k < 9; k++) {
            box(g, 0.045, 0.5, 0.055, bx - 0.94 + k * 0.235, 8.16, facadeZ + 0.84, bronze, 'Wing balcony baluster');
          }
        }
      }

      // Subtle vertical divisions every third bay and a continuous attic balustrade.
      for (let i = 0; i <= 3; i++) {
        const px = x - 24 + i * 16;
        box(g, 0.28, 19.2, 0.42, px, 10.2, facadeZ + 0.12, ashlar, 'Wing bay pilaster');
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
      for (let i = 0; i < 7; i++) {
        const bx = x - 21 + i * 7;
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
    for (let i = 0; i < 5; i++) {
      const x = -12 + i * 6;
      box(g, 1.55, 1.55, 0.18, x, 24.15, centralFace + 0.12, glass, 'Central attic window');
      box(g, 1.9, 0.18, 0.34, x, 23.25, centralFace + 0.25, moulding, 'Attic window sill');
      box(g, 1.9, 0.18, 0.34, x, 25.05, centralFace + 0.25, moulding, 'Attic window lintel');
      box(g, 3.6, 1.15, 0.18, x, 26.35, centralFace + 0.14, ashlar, 'Sculpted attic panel');
    }

    // Monumental triangular pediment, with an inset tympanum and a simple relief group.
    const pediment = new THREE.Shape();
    pediment.moveTo(-11.5, 0);
    pediment.lineTo(11.5, 0);
    pediment.lineTo(0, 5.8);
    pediment.closePath();
    mesh(g, new THREE.ShapeGeometry(pediment), ashlar, 0, 23.55, centralFace + 0.18, 'Palace sculpted triangular pediment');
    box(g, 23.5, 0.5, 1.0, 0, 23.55, centralFace + 0.38, moulding, 'Pediment lower moulding');
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

    // The real central roof is a high, square drum and a broad flattened dome,
    // with two rows of oculi on each face and a rooftop balustrade.
    box(g, 17.5, 4.6, 17.5, 0, 27.2, -1, stone, 'Central dome drum');
    for (const face of [-1, 1]) {
      const z = -1 + face * 8.9;
      for (const y of [26.4, 28.4]) {
        for (let i = 0; i < 3; i++) {
          const x = -5.4 + i * 5.4;
          mesh(g, new THREE.TorusGeometry(0.62, 0.12, 8, 20), moulding, x, y, z + face * 0.08, 'Dome drum oculus surround');
          mesh(g, new THREE.CircleGeometry(0.52, 20), glass, x, y, z + face * 0.1, 'Dome drum oculus');
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
      for (const dx of [-2.5, 0, 2.5]) {
        box(g, 1.55, 4.4, 0.22, x + dx, 14.0, facadeZ + 0.1, glass, 'Terminal pavilion window');
      }
    }
    // The real front garden (jardin d'honneur, laid out 1904–09) holds three sunken
    // parterres between the façade and the gilded railing: a central parterre on the
    // portico axis flanked by two lateral parterres ("trois parterres creusés").
    const lawnMat = new THREE.MeshStandardMaterial({ color: 0x5f7f52, roughness: 0.96 });
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xb06a5a, roughness: 0.95 });
    const parterres = [
      { x: 0, w: 22, z: 12.4, d: 2.6 },
      { x: -38, w: 34, z: 12.4, d: 2.6 },
      { x: 38, w: 34, z: 12.4, d: 2.6 }
    ];
    for (const p of parterres) {
      box(g, p.w, 0.24, p.d, p.x, -0.12, p.z, ashlar, 'Sunken parterre retaining edge');
      box(g, p.w - 0.8, 0.1, p.d - 0.8, p.x, -0.02, p.z, lawnMat, 'Sunken parterre lawn');
      box(g, p.w - 4, 0.06, 0.7, p.x, 0.05, p.z, flowerMat, 'Parterre flower band');
    }

    for (let x = -74; x <= 74; x += 2.4) {
      cylinder(g, 0.1, 0.14, 1.1, x, 0.55, 14, ashlar, 8);
      if (x < 73.9) box(g, 2.4, 0.07, 0.07, x + 1.2, 0.9, 14, bronze, 'Forecourt railing');
    }
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
    // Palais de Justice (Joseph Poelaert, 1866–1883): monumental 150–160 m
    // footprint, raised podium, eight courts, axial porticoes and the skyline dome.
    // Local +Z is the principal north entrance toward Place Poelaert.
    const stone = new THREE.MeshStandardMaterial({ color: 0xc9bda8, roughness: 0.9 });
    const light = new THREE.MeshStandardMaterial({ color: 0xd8cbb6, roughness: 0.88 });
    const weathered = new THREE.MeshStandardMaterial({ color: 0xa99b86, roughness: 0.94 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x454947, roughness: 0.9 });
    const recess = new THREE.MeshStandardMaterial({ color: 0x414342, roughness: 0.9 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x75664b, metalness: 0.42, roughness: 0.65 });

    // Broad podium and perimeter terrace: the courthouse sits above the Marolles escarpment.
    box(g, 174, 4.2, 182, 0, -1.0, -1, weathered, 'Palais de Justice monumental podium');
    terrainFoundationSkirt(g, g, brusselsToWorld(BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lat, BRUSSELS_LANDMARK_ANCHORS.palaisDeJustice.lon), 174, 182, -3.1, weathered, 'Palais de Justice terrain retaining skirt');
    box(g, 166, 2.2, 174, 0, 2.2, -1, light, 'Courthouse podium coping');
    // Eight internal courts are left open. Four long ranges and cross-ranges create
    // a legible courtyard plan instead of a single opaque rectangular mass.
    const wingY = 17.5, wingH = 31, wingD = 17;
    box(g, 150, wingH, wingD, 0, wingY, -72, stone, 'North range facing Place Poelaert');
    box(g, 150, wingH, wingD, 0, wingY, 70, stone, 'South range above Rue de Wynants');
    box(g, wingD, wingH, 126, -66.5, wingY, -1, stone, 'West range Rue des Minimes');
    box(g, wingD, wingH, 126, 66.5, wingY, -1, stone, 'East range Rue aux Laines');
    for (const z of [-34, 0, 34]) {
      box(g, 116, 26, 10, 0, 15, z, light, 'Courthouse transverse gallery');
    }
    // Raised corner pavilions and central avant-corps articulate the four elevations.
    for (const x of [-61, 61]) for (const z of [-61, 61]) {
      box(g, 28, 39, 27, x, 20, z, light, 'Projecting courthouse corner pavilion');
      box(g, 30, 1.6, 29, x, 40, z, weathered, 'Corner pavilion cornice');
      box(g, 26, 3.2, 25, x, 42.2, z, roof, 'Corner pavilion roof');
      for (let bay = -1; bay <= 1; bay++) {
        box(g, 2.1, 8, 0.35, x + bay * 7, 18, z + (z > 0 ? 13.7 : -13.7), recess, 'Corner pavilion tall window');
      }
    }
    // North principal façade: broad stair, double Doric peristyle and projecting portico.
    box(g, 58, 1.2, 18, 0, 4.1, 91, weathered, 'Place Poelaert forecourt landing');
    for (let step = 0; step < 9; step++) {
      box(g, 62 + step * 1.8, 0.55, 2.2, 0, 4.3 + step * 0.42, 82 - step * 2.15, light, 'Monumental entrance stair');
    }
    box(g, 52, 3.0, 18, 0, 5.0, 80, stone, 'Main entrance terrace');
    box(g, 48, 2.0, 14, 0, 22.0, 76, light, 'Principal portico entablature');
    for (const z of [70, 78]) {
      for (let i = 0; i < 12; i++) {
        const x = -27.5 + i * 5;
        cylinder(g, 1.05, 1.2, 15.5, x, 12.5, z, light, 20);
        cylinder(g, 1.45, 1.45, 0.65, x, 4.8, z, weathered, 20);
        cylinder(g, 1.45, 1.45, 0.65, x, 20.2, z, weathered, 20);
      }
    }
    // Main front pediment and attic balustrade.
    const pediment = new THREE.Shape();
    pediment.moveTo(-25, 0); pediment.lineTo(0, 11); pediment.lineTo(25, 0); pediment.closePath();
    mesh(g, new THREE.ExtrudeGeometry(pediment, { depth: 3, bevelEnabled: false }), light, 0, 23.2, 77, 'Triangular principal pediment');
    box(g, 154, 1.3, 3.0, 0, 34, 58, light, 'North façade entablature');
    for (let x = -73; x <= 73; x += 3.2) {
      box(g, 0.55, 1.5, 0.55, x, 35.2, 58, weathered, 'North façade balustrade');
    }
    // Repeated pilasters, deep window reveals and three storey bands on the outer ranges.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 21; i++) {
        const x = -69 + i * 6.9;
        box(g, 2.8, 10.5, 0.32, x, 11.5, side < 0 ? -63 : 63, recess, 'Courthouse lower window');
        box(g, 2.8, 9.5, 0.32, x, 25, side < 0 ? -63 : 63, recess, 'Courthouse upper window');
        box(g, 0.35, 29, 0.5, x - 2.0, 18, side < 0 ? -63.2 : 63.2, light, 'Courthouse façade pilaster');
      }
    }
    // Eight courts: low garden floors and arcaded inner galleries make the plan readable from above.
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
      const x = -48 + col * 32;
      const z = -43 + row * 86;
      box(g, 22, 0.28, 30, x, 3.45, z, materials.green, 'Interior courthouse court garden');
      for (const edge of [-1, 1]) {
        box(g, 22, 5.5, 0.45, x, 8.0, z + edge * 15, light, 'Court inner arcade');
        for (let bay = -2; bay <= 2; bay++) {
          box(g, 1.5, 4.0, 0.22, x + bay * 4, 8.0, z + edge * 15.25, recess, 'Court arcade opening');
        }
      }
    }
    // Central hall and the monumental dome's stepped square stylobate.
    box(g, 52, 42, 48, 0, 27, -1, light, 'Salle des Pas Perdus central mass');
    box(g, 58, 3.0, 54, 0, 48, -1, weathered, 'Dome stylobate lower step');
    box(g, 50, 3.0, 48, 0, 51, -1, light, 'Dome stylobate upper step');
    // Square first drum with open colonnades on all four sides.
    box(g, 39, 7, 39, 0, 56, -1, stone, 'Square dome drum');
    for (let side = 0; side < 4; side++) {
      const angle = side * Math.PI / 2;
      for (let i = 0; i < 7; i++) {
        const t = -15 + i * 5;
        const x = Math.cos(angle) * 20.0 + Math.cos(angle + Math.PI / 2) * t;
        const z = -1 + Math.sin(angle) * 20.0 + Math.sin(angle + Math.PI / 2) * t;
        cylinder(g, 0.65, 0.78, 9.5, x, 64, z, light, 16);
      }
    }
    box(g, 34, 1.5, 34, 0, 69, -1, weathered, 'Upper dome cornice');
    // Circular upper drum and copper dome; the high lantern is the city's defining silhouette.
    cylinder(g, 17.5, 19.5, 15, 0, 77, -1, light, 32);
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI * 2 / 24;
      const x = Math.cos(a) * 18.3, z = -1 + Math.sin(a) * 18.3;
      box(g, 1.1, 9.0, 1.1, x, 77, z, weathered, 'Circular drum pier');
    }
    cylinder(g, 20.5, 20.5, 1.5, 0, 85, -1, bronze, 32);
    mesh(g, new THREE.SphereGeometry(20, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), roof, 0, 85, -1, 'Copper courthouse dome');
    cylinder(g, 5.8, 7.5, 9, 0, 104, -1, bronze, 24);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI * 2 / 12;
      cylinder(g, 0.34, 0.42, 7.2, Math.cos(a) * 6.1, 104, -1 + Math.sin(a) * 6.1, light, 10);
    }
    cylinder(g, 4.6, 5.8, 2.0, 0, 109, -1, bronze, 20);
    mesh(g, new THREE.SphereGeometry(4.8, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), roof, 0, 110, -1, 'Courthouse lantern cap');
    cylinder(g, 0.22, 0.35, 5.5, 0, 116, -1, bronze, 12);
    // The two side façades and rear range receive their own axial entrances and stair landings.
    for (const x of [-1, 1]) {
      box(g, 20, 3, 18, x * 78, 5, -1, weathered, 'Side entrance landing');
      for (let i = 0; i < 7; i++) box(g, 22, 0.45, 1.8, x * (78 - i * 1.3), 5 + i * 0.45, -1, light, 'Side monumental stair');
    }
    // Terrace balustrade and retaining edge, kept distinct from the surrounding streets.
    for (let x = -82; x <= 82; x += 4) {
      box(g, 0.5, 1.2, 0.5, x, 5.1, 91, weathered, 'Forecourt terrace baluster');
    }
    box(g, 178, 1.8, 3, 0, 1.6, 90, weathered, 'Place Poelaert retaining wall');
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
