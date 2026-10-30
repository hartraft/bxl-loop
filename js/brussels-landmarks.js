// Brussels-specific, procedural landmark geometry. Kept behind the Brussels city selector.
import * as THREE from 'three/webgpu';
import { GEO } from './brx-geodata.js';
import { BRUSSELS_LANDMARK_ANCHORS, MONT_DES_ARTS_ROTATION, brusselsToWorld } from './brussels-frame.js';

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
    dark: new THREE.MeshStandardMaterial({ color: 0x4a4035, roughness: 0.92 }),
    pavingA: new THREE.MeshStandardMaterial({ color: 0x77756d, roughness: 0.96 }),
    pavingB: new THREE.MeshStandardMaterial({ color: 0x89857a, roughness: 0.96 }),
    pavingEdge: new THREE.MeshStandardMaterial({ color: 0x55534d, roughness: 0.96 })
  };
  const landmarks = {};
  const colliders = [];

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
  function addLandmark(id, build) {
    const anchor = BRUSSELS_LANDMARK_ANCHORS[id];
    if (!anchor) return;
    const p = brusselsToWorld(anchor.lat, anchor.lon);
    const root = new THREE.Group();
    root.name = id;
    root.position.set(p.x, opts.world?.groundHeight?.(p.x, p.z) || 0, p.z);
    // Align each landmark's local architectural frontage with the real city axis.
    if (id === 'royalPalace') root.rotation.y = Math.PI; // north-facing façade toward Parc de Bruxelles
    if (id === 'palaisDeJustice') root.rotation.y = Math.PI; // monumental entrance faces Place Poelaert to the north
    if (id === 'montDesArts') root.rotation.y = MONT_DES_ARTS_ROTATION; // local +Z points southeast; the garden descends northwest
    if (id === 'cinquantenaire') root.rotation.y = Math.PI / 2; // triumphal axis east-west; pavilions north/south
    build(root);
    group.add(root);
    landmarks[id] = { group: root, anchor };
  }

  // A facade is modelled in local coordinates: its front is +Z and the building extends behind it.
  // Instanced windows keep the repeated historic detail to two draw calls per facade.
  function guildHouse(parent, spec) {
    const { name, x, width, height, depth = 11, floors = 3, stone = materials.limestone,
      roof = materials.roof, style = 'gable', rotation = 0, y = 0 } = spec;
    const root = new THREE.Group();
    root.name = name;
    root.position.set(x, y, 0);
    root.rotation.y = rotation;
    parent.add(root);

    box(root, width, height, depth, 0, height / 2, -depth / 2, stone, name + ' masonry');
    box(root, width + 0.8, 0.65, depth + 0.4, 0, height - 0.35, -depth / 2, materials.gold, name + ' cornice');
    box(root, width + 0.45, 0.45, 0.35, 0, 1.15, 0.12, materials.warmStone, name + ' plinth');

    const bays = Math.max(3, Math.round(width / 2.8));
    const windowGeo = new THREE.BoxGeometry(1.05, 1.45, 0.16);
    const frameGeo = new THREE.BoxGeometry(1.28, 1.7, 0.12);
    const windows = new THREE.InstancedMesh(windowGeo, materials.glass, bays * floors);
    const frames = new THREE.InstancedMesh(frameGeo, materials.gold, bays * floors);
    const dummy = new THREE.Object3D();
    let index = 0;
    for (let floor = 0; floor < floors; floor++) {
      const wy = 3.0 + floor * ((height - 5.2) / Math.max(1, floors - 1));
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
        index++;
      }
    }
    windows.name = name + ' windows';
    frames.name = name + ' gilded window surrounds';
    windows.castShadow = frames.castShadow = true;
    root.add(windows, frames);

    // Each house gets a distinct roofline instead of the repeated identical cones of the old model.
    const gableHeight = style === 'stepped' ? 4.8 : style === 'bell' ? 3.6 : 4.2;
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
    } else {
      shape.moveTo(-width / 2, 0); shape.lineTo(0, gableHeight); shape.lineTo(width / 2, 0);
    }
    shape.closePath();
    mesh(root, new THREE.ShapeGeometry(shape), stone, 0, height, 0.08, name + ' gable');
    box(root, width + 0.7, 0.35, depth + 0.5, 0, height + 0.2, -depth / 2, roof, name + ' roof cap');
    box(root, 0.35, height - 1.8, 0.25, -width / 2 + 0.45, height / 2 + 0.5, 0.16, materials.gold);
    box(root, 0.35, height - 1.8, 0.25, width / 2 - 0.45, height / 2 + 0.5, 0.16, materials.gold);
    cylinder(root, 0.12, 0.12, 1.3, 0, height + gableHeight + 0.55, 0.08, materials.gold, 8);
    return root;
  }

  function townHall(parent) {
    const root = new THREE.Group();
    root.name = 'Brussels Town Hall (Hôtel de Ville)';
    root.position.set(20, 0, 0);
    parent.add(root);
    const width = 47, height = 25, depth = 14;
    box(root, width, height, depth, 0, height / 2, -depth / 2, materials.paleStone, 'Town Hall Gothic facade');
    box(root, width + 1.5, 1.1, depth + 1, 0, 22.8, -depth / 2, materials.gold, 'Town Hall parapet');
    box(root, width + 2, 1.2, depth + 1, 0, 1, -depth / 2, materials.warmStone, 'Town Hall base');
    // Tall pointed openings, buttress piers and the strong horizontal gallery rhythm.
    for (let i = 0; i < 13; i++) {
      const x = -21 + i * 3.5;
      box(root, 1.65, 8.2, 0.22, x, 9.2, 0.2, materials.glass, 'Gothic lancet window');
      box(root, 0.24, 9.1, 0.3, x - 0.95, 9.2, 0.22, materials.gold);
      box(root, 0.24, 9.1, 0.3, x + 0.95, 9.2, 0.22, materials.gold);
      box(root, 2.35, 0.28, 0.35, x, 13.9, 0.22, materials.gold);
      box(root, 1.1, 4.5, 0.3, x, 19, 0.22, materials.glass);
    }
    // The famous asymmetrical, open-work belfry rises from the western portion of the roof.
    const tower = new THREE.Group();
    tower.name = 'Town Hall tower and openwork spire';
    tower.position.set(16, 22, -6);
    root.add(tower);
    box(tower, 8.5, 17, 8.5, 0, 8.5, 0, materials.paleStone, 'Town Hall square tower');
    for (let level = 0; level < 3; level++) {
      const yy = 3 + level * 5.3;
      box(tower, 9.4 - level * 0.7, 0.6, 9.4 - level * 0.7, 0, yy, 0, materials.gold, 'Tower string course');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        box(tower, 0.65, 4.2, 0.65, sx * 3.6, yy + 2.4, sz * 3.6, materials.warmStone, 'Tower corner pier');
      }
    }
    cylinder(tower, 4.5, 5.5, 5, 0, 20, 0, materials.paleStone, 8);
    cylinder(tower, 3.8, 4.5, 4, 0, 24, 0, materials.gold, 8);
    // Open belfry lantern: eight piers and two octagonal rings leave the silhouette visibly open.
    cylinder(tower, 3.8, 3.8, 0.55, 0, 28.5, 0, materials.gold, 8);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      box(tower, 0.42, 9.2, 0.42, Math.cos(angle) * 3.45, 33.2, Math.sin(angle) * 3.45, materials.paleStone, 'Open belfry pier');
    }
    cylinder(tower, 3.8, 3.8, 0.55, 0, 38, 0, materials.gold, 8);
    mesh(tower, new THREE.ConeGeometry(3.8, 18, 8), materials.roof, 0, 47, 0, 'Town Hall octagonal spire');
    cylinder(tower, 0.12, 0.3, 1.8, 0, 56.2, 0, materials.gold, 8);
    // A small gilded pinnacle/guardian silhouette, visible above the roofline.
    const finial = mesh(tower, new THREE.SphereGeometry(0.42, 8, 6), materials.gold, 0, 57.4, 0, 'Town Hall gilded finial');
    finial.scale.set(0.7, 1.6, 0.7);
  }

  function grandPlace(g) {
    // The square is approximately 110 x 68 metres; the plaza remains open and pedestrian-only.
    const plaza = new THREE.Group();
    plaza.name = 'Grand-Place pedestrian square';
    g.add(plaza);
    box(plaza, 108, 0.45, 66, 0, -0.225, 0, materials.pavingEdge, 'Grand-Place stone perimeter');
    const cobbleGeo = new THREE.BoxGeometry(6.8, 0.12, 4.1);
    const cobblesA = new THREE.InstancedMesh(cobbleGeo, materials.pavingA, 180);
    const cobblesB = new THREE.InstancedMesh(cobbleGeo, materials.pavingB, 180);
    const dummy = new THREE.Object3D();
    let a = 0, b = 0;
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 15; col++) {
        const x = -50 + col * 6.9 + (row % 2) * 0.45;
        const z = -30 + row * 5.15;
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

    // Perimeter facades frame the plaza. North = negative Z; south = positive Z.
    // Town Hall occupies the south-west frontage; King's House faces it from the north.
    const south = new THREE.Group();
    south.name = 'South frontage';
    south.position.set(0, 0, 36);
    south.rotation.y = Math.PI;
    plaza.add(south);
    townHall(south);
    guildHouse(south, { name: 'Guild House – Le Pigeon', x: -24, width: 12, height: 19, floors: 3, style: 'stepped', stone: materials.warmStone });
    guildHouse(south, { name: 'Guild House – La Brouette', x: -39, width: 13, height: 22, floors: 4, style: 'bell', stone: materials.paleStone });

    const north = new THREE.Group();
    north.name = 'North frontage';
    north.position.set(0, 0, -36);
    plaza.add(north);
    guildHouse(north, { name: 'Guild House – Le Renard', x: -43, width: 12, height: 20, style: 'stepped', stone: materials.warmStone });
    guildHouse(north, { name: 'Guild House – Le Cornet', x: -29, width: 13, height: 23, style: 'gable', stone: materials.paleStone });
    guildHouse(north, { name: 'King’s House (Maison du Roi / Broodhuis)', x: 0, width: 31, height: 25, depth: 13, floors: 3, style: 'stepped', stone: materials.paleStone });
    guildHouse(north, { name: 'Guild House – La Chaloupe d’Or', x: 27, width: 15, height: 24, style: 'bell', stone: materials.warmStone });
    guildHouse(north, { name: 'Guild House – Le Sac', x: 43, width: 12, height: 19, style: 'gable', stone: materials.limestone });

    const west = new THREE.Group();
    west.name = 'West frontage';
    west.position.set(-55, 0, 0);
    west.rotation.y = Math.PI / 2;
    plaza.add(west);
    guildHouse(west, { name: 'West guild houses', x: -18, width: 15, height: 21, style: 'bell', stone: materials.warmStone });
    guildHouse(west, { name: 'West stepped gable', x: 1, width: 16, height: 23, style: 'stepped', stone: materials.paleStone });
    guildHouse(west, { name: 'West guild house', x: 20, width: 15, height: 20, style: 'gable' });

    const east = new THREE.Group();
    east.name = 'East frontage';
    east.position.set(55, 0, 0);
    east.rotation.y = -Math.PI / 2;
    plaza.add(east);
    guildHouse(east, { name: 'East guild house', x: -18, width: 15, height: 22, style: 'stepped', stone: materials.paleStone });
    guildHouse(east, { name: 'East guild house', x: 1, width: 16, height: 24, style: 'bell', stone: materials.warmStone });
    guildHouse(east, { name: 'East guild house', x: 20, width: 15, height: 20, style: 'gable' });

    // Low stone bollards and warm lantern standards mark the pedestrian edge without blocking it.
    for (let i = 0; i < 12; i++) {
      const x = -48 + i * 8.7;
      cylinder(plaza, 0.32, 0.42, 0.9, x, 0.55, 34, materials.warmStone, 10);
      cylinder(plaza, 0.32, 0.42, 0.9, x, 0.55, -34, materials.warmStone, 10);
    }
    for (const x of [-47, 47]) for (const z of [-25, 25]) {
      cylinder(plaza, 0.18, 0.24, 5.4, x, 2.7, z, materials.dark, 10);
      box(plaza, 0.9, 0.35, 0.9, x, 5.5, z, materials.gold, 'Historic square lantern');
    }
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
      box(g, width + 2, 1.45, 1.0, 0, y - 0.5, z - terraceDepth / 2, blueStone, 'Terrace retaining wall');
      box(g, width + 2.5, 0.28, 1.4, 0, y + 0.34, z - terraceDepth / 2, limestone, 'Retaining wall coping');
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
    // Palais Royal: the long, pale Euville-stone north front facing Parc de Bruxelles.
    // The model is deliberately composed as the real accreted palace: central corps de logis,
    // two long wings and slightly projecting terminal pavilions, rather than one generic block.
    const stone = new THREE.MeshStandardMaterial({ color: 0xd8d0c2, roughness: 0.86 });
    const ashlar = new THREE.MeshStandardMaterial({ color: 0xc7bdad, roughness: 0.9 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x343a3a, roughness: 0.92 });
    const shadow = new THREE.MeshStandardMaterial({ color: 0x303a3c, roughness: 0.8 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x796c53, metalness: 0.35, roughness: 0.72 });
    const facadeZ = 8;
    const wingW = 39, wingH = 20.5, wingD = 19;
    const wingXs = [-42, 42];
    for (const x of wingXs) {
      box(g, wingW, wingH, wingD, x, wingH / 2, -1.5, stone, 'Royal Palace long wing');
      // Rusticated piano nobile base with evenly spaced arched ground-floor openings.
      box(g, wingW + 0.5, 1.1, wingD + 0.4, x, 0.55, -1.5, ashlar, 'Palace rusticated plinth');
      for (let i = 0; i < 7; i++) {
        const bx = x - 16.5 + i * 5.5;
        box(g, 2.6, 5.2, 0.22, bx, 3.4, facadeZ + 0.1, shadow, 'Ground-floor arched opening');
        mesh(g, new THREE.TorusGeometry(1.3, 0.16, 6, 16, Math.PI), stone, bx, 6.0, facadeZ + 0.1, 'Arcade voussoir');
        box(g, 3.7, 0.3, 0.45, bx, 6.15, facadeZ + 0.12, ashlar, 'Arcade impost');
      }
      // Two upper storeys: aligned French windows, stone surrounds, sill courses and cornices.
      for (let floor = 0; floor < 2; floor++) {
        const y = floor === 0 ? 10.1 : 16.0;
        for (let i = 0; i < 7; i++) {
          const bx = x - 16.5 + i * 5.5;
          box(g, 2.05, 3.45, 0.18, bx, y, facadeZ + 0.13, shadow, 'Palace tall sash window');
          box(g, 2.45, 0.22, 0.3, bx, y - 1.95, facadeZ + 0.22, ashlar, 'Window sill');
          box(g, 2.45, 0.2, 0.3, bx, y + 1.9, facadeZ + 0.22, ashlar, 'Window lintel');
          box(g, 0.16, 3.75, 0.24, bx - 1.2, y, facadeZ + 0.22, ashlar, 'Window jamb');
          box(g, 0.16, 3.75, 0.24, bx + 1.2, y, facadeZ + 0.22, ashlar, 'Window jamb');
        }
      }
      box(g, wingW + 1.8, 0.8, wingD + 1, x, 20.6, -1.5, ashlar, 'Palace continuous entablature');
      box(g, wingW + 1.2, 1.3, wingD + 0.8, x, 21.6, -1.5, roof, 'Palace mansard roof');
      // Dormers punctuate the slate roof.
      for (let i = 0; i < 5; i++) {
        const bx = x - 15 + i * 7.5;
        box(g, 1.7, 1.8, 1.2, bx, 22.7, 4.5, stone, 'Palace roof dormer');
        mesh(g, new THREE.ConeGeometry(1.2, 1.1, 4), roof, bx, 24.0, 4.5, 'Dormer cap');
      }
    }
    // Central projecting avant-corps, the ceremonial focus of the façade.
    box(g, 34, 22.5, 22, 0, 11.25, -1, stone, 'Palace central corps de logis');
    box(g, 35, 1.4, 22.8, 0, 1.0, -1, ashlar, 'Central rusticated base');
    // Five open arcades at ground level.
    for (let i = 0; i < 5; i++) {
      const x = -10 + i * 5;
      box(g, 2.6, 5.6, 0.32, x, 3.8, facadeZ + 0.35, shadow, 'Central ceremonial arcade');
      mesh(g, new THREE.TorusGeometry(1.3, 0.19, 8, 20, Math.PI), ashlar, x, 6.5, facadeZ + 0.35, 'Central arcade arch');
      box(g, 3.4, 0.35, 0.5, x, 6.65, facadeZ + 0.35, ashlar, 'Arcade impost');
    }
    // Six monumental columns above the arcade.
    for (let i = 0; i < 6; i++) {
      const x = -12.5 + i * 5;
      cylinder(g, 0.72, 0.82, 9.1, x, 12.5, facadeZ + 0.9, stone, 20);
      cylinder(g, 0.95, 0.95, 0.45, x, 8.0, facadeZ + 0.9, ashlar, 20);
      cylinder(g, 0.95, 0.95, 0.5, x, 17.0, facadeZ + 0.9, ashlar, 20);
      cylinder(g, 0.12, 0.12, 0.35, x, 17.5, facadeZ + 0.9, bronze, 12);
    }
    // Upper ceremonial windows and the deep classical entablature.
    for (let i = 0; i < 7; i++) {
      const x = -14 + i * 4.65;
      box(g, 2.0, 3.2, 0.18, x, 19.2, facadeZ + 0.25, shadow, 'Palace piano nobile window');
    }
    box(g, 37, 1.15, 24, 0, 22.8, -1, ashlar, 'Palace central entablature');
    box(g, 38, 0.65, 24.5, 0, 23.7, -1, stone, 'Palace attic balustrade');
    for (let i = 0; i < 25; i++) {
      const x = -18 + i * 1.5;
      box(g, 0.42, 1.0, 0.42, x, 24.5, facadeZ + 0.2, ashlar, 'Balustrade baluster');
    }
    // The restrained square-plan central roof pavilion and shallow dome; not an oversized fantasy cupola.
    box(g, 11, 3.0, 11, 0, 25.4, -1, roof, 'Palace central roof pavilion');
    box(g, 9.5, 0.45, 9.5, 0, 27.1, -1, ashlar, 'Dome cornice');
    mesh(g, new THREE.SphereGeometry(4.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), roof, 0, 27.0, -1, 'Palace shallow dome');
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      cylinder(g, 0.72, 0.72, 0.22, Math.sin(a) * 3.5, 29.3, -1 + Math.cos(a) * 3.5, ashlar, 16);
    }
    cylinder(g, 0.16, 0.2, 1.2, 0, 31.0, -1, bronze, 12);
    // Terminal pavilions and the ceremonial forecourt railing.
    for (const x of [-65, 65]) {
      box(g, 8, 23, 21, x, 11.5, -1, stone, 'Palace terminal pavilion');
      box(g, 9.5, 1, 22, x, 23.2, -1, ashlar, 'Pavilion cornice');
      box(g, 9, 1.4, 21, x, 24.3, -1, roof, 'Pavilion roof');
      for (const dx of [-2.5, 0, 2.5]) box(g, 1.5, 4, 0.2, x + dx, 14, facadeZ + 0.1, shadow, 'Pavilion window');
    }
    for (let x = -58; x <= 58; x += 4) {
      cylinder(g, 0.12, 0.16, 1.15, x, 0.58, 14, ashlar, 8);
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
  return {
    group, colliders, zones: GEO.landmarkZones || [], landmarks,
    update() {},
    towerBridge: null,
    setNight() {}
  };
}
