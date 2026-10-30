// Brussels-specific, procedural landmark geometry. Kept behind the Brussels city selector.
import * as THREE from 'three/webgpu';
import { GEO } from './brx-geodata.js';
import { BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld } from './brussels-frame.js';

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
    root.position.set(p.x, 0, p.z);
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
    for (let i = 0; i < 8; i++) box(g, 38 - i * 2.5, 0.7, 3, 0, 0.35 + i * 0.9, 12 - i * 3.2, materials.paleStone, 'Terraced garden');
    for (let i = 0; i < 6; i++) cylinder(g, 1.2, 1.2, 0.6, -13 + i * 5, 4.3, -8, materials.green, 12);
  });
  addLandmark('royalPalace', (g) => {
    box(g, 54, 13, 13, 0, 6.5, 0, materials.paleStone, 'Royal Palace facade');
    box(g, 18, 17, 15, 0, 8.5, -1, materials.limestone);
    box(g, 60, 1.2, 15, 0, 13.5, 0, materials.gold);
    for (let i = 0; i < 12; i++) cylinder(g, 0.35, 0.45, 8, -24 + i * 4.35, 4, 7.5, materials.paleStone, 10);
    box(g, 54, 1.5, 14, 0, 15, 0, materials.roof);
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
    box(g, 58, 18, 44, 0, 9, 0, materials.paleStone, 'Palace of Justice');
    box(g, 20, 8, 20, 0, 22, -2, materials.limestone);
    mesh(g, new THREE.SphereGeometry(10, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.gold, 0, 25, -2);
    for (const x of [-23, -15, -7, 7, 15, 23]) cylinder(g, 0.8, 1, 9, x, 4.5, 22, materials.paleStone);
  });
  addLandmark('cinquantenaire', (g) => {
    for (const x of [-20, -7, 7, 20]) box(g, 5, 24, 5, x, 12, 0, materials.paleStone, 'Triumphal arch pier');
    box(g, 48, 5, 7, 0, 25, 0, materials.gold, 'Triumphal arch cornice');
    box(g, 12, 12, 2, 0, 31, -1, materials.limestone, 'Arch crown');
    box(g, 45, 1, 34, 0, 0.5, 12, materials.green, 'Park lawn');
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
