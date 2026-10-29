// Lightweight, procedural Brussels landmarks used while keeping the existing city renderer.
import * as THREE from 'three/webgpu';
import { GEO } from './ldn-geodata.js';
import { BRUSSELS_LANDMARK_ANCHORS, brusselsToWorld } from './brussels-frame.js';

export function buildBrusselsLandmarks(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'BrusselsLandmarks';
  const materials = {
    stone: new THREE.MeshStandardMaterial({ color: 0xc6b69a, roughness: 0.86 }),
    pale: new THREE.MeshStandardMaterial({ color: 0xe4d7bd, roughness: 0.78 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x4c5550, roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x6d9da4, roughness: 0.28, metalness: 0.18 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc79b4b, roughness: 0.5, metalness: 0.35 }),
    green: new THREE.MeshStandardMaterial({ color: 0x70936a, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x5d5145, roughness: 0.8 })
  };
  const landmarks = {};
  const colliders = [];
  const zones = GEO.landmarkZones || [];

  function part(parent, geometry, material, x, y, z, name = '') {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (name) mesh.name = name;
    parent.add(mesh);
    return mesh;
  }
  function box(parent, w, h, d, x, y, z, material = materials.stone, name = '') {
    return part(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z, name);
  }
  function cylinder(parent, rTop, rBottom, h, x, y, z, material = materials.pale, sides = 12) {
    return part(parent, new THREE.CylinderGeometry(rTop, rBottom, h, sides), material, x, y, z);
  }
  function cone(parent, r, h, x, y, z, material = materials.roof) {
    return part(parent, new THREE.ConeGeometry(r, h, 8), material, x, y, z);
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

  // A compact, stylised skyline model rather than London landmarks at Brussels coordinates.
  addLandmark('grandPlace', (g) => {
    box(g, 40, 1, 50, 0, 0.5, 0, materials.dark, 'Grand-Place paving');
    for (let i = 0; i < 5; i++) {
      const x = -24 + i * 12;
      box(g, 9, 16 + (i % 2) * 3, 8, x, 8, -28, materials.pale, 'Guildhall');
      box(g, 9.5, 1.1, 8.5, x, 14, -28, materials.gold);
      cone(g, 4.5, 5, x, 19 + (i % 2) * 3, -28, materials.roof);
      box(g, 9, 14 + (i % 3) * 2, 8, x, 7, 28, materials.stone, 'Guildhall');
      cone(g, 4.5, 4, x, 16 + (i % 3) * 2, 28, materials.roof);
    }
    box(g, 8, 26, 8, 0, 13, -31, materials.pale, 'Town hall tower');
    cone(g, 4.5, 7, 0, 29, -31, materials.roof);
  });
  addLandmark('mannekenPis', (g) => {
    box(g, 2.2, 1.3, 2.2, 0, 0.65, 0, materials.dark);
    cylinder(g, 0.34, 0.45, 1.6, 0, 2.1, 0, materials.gold, 8);
    part(g, new THREE.SphereGeometry(0.32, 10, 8), materials.gold, 0, 3.15, 0);
  });
  addLandmark('montDesArts', (g) => {
    for (let i = 0; i < 8; i++) {
      box(g, 38 - i * 2.5, 0.7, 3, 0, 0.35 + i * 0.9, 12 - i * 3.2, materials.pale, 'Terraced garden');
    }
    for (let i = 0; i < 6; i++) {
      cylinder(g, 1.2, 1.2, 0.6, -13 + i * 5, 4.3, -8, materials.green);
    }
  });
  addLandmark('royalPalace', (g) => {
    box(g, 54, 13, 13, 0, 6.5, 0, materials.pale, 'Royal Palace facade');
    box(g, 18, 17, 15, 0, 8.5, -1, materials.stone);
    box(g, 60, 1.2, 15, 0, 13.5, 0, materials.gold);
    for (let i = 0; i < 12; i++) cylinder(g, 0.35, 0.45, 8, -24 + i * 4.35, 4, 7.5, materials.pale, 10);
    box(g, 54, 1.5, 14, 0, 15, 0, materials.roof);
  });
  addLandmark('cathedral', (g) => {
    box(g, 28, 13, 44, 0, 6.5, 0, materials.pale, 'Cathedral nave');
    box(g, 30, 1, 46, 0, 13, 0, materials.roof);
    for (const x of [-10, 10]) {
      box(g, 6, 24, 7, x, 12, -18, materials.stone, 'Cathedral tower');
      cone(g, 3.5, 8, x, 28, -18, materials.roof);
    }
    for (let i = 0; i < 5; i++) box(g, 2.2, 5, 0.8, -8 + i * 4, 6, -22.5, materials.glass);
  });
  addLandmark('palaisDeJustice', (g) => {
    box(g, 58, 18, 44, 0, 9, 0, materials.pale, 'Palace of Justice');
    box(g, 20, 8, 20, 0, 22, -2, materials.stone);
    part(g, new THREE.SphereGeometry(10, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.gold, 0, 25, -2);
    for (const x of [-23, -15, -7, 7, 15, 23]) cylinder(g, 0.8, 1, 9, x, 4.5, 22, materials.pale);
  });
  addLandmark('cinquantenaire', (g) => {
    for (const x of [-20, -7, 7, 20]) box(g, 5, 24, 5, x, 12, 0, materials.pale, 'Triumphal arch pier');
    box(g, 48, 5, 7, 0, 25, 0, materials.gold, 'Triumphal arch cornice');
    box(g, 12, 12, 2, 0, 31, -1, materials.stone, 'Arch crown');
    box(g, 45, 1, 34, 0, 0.5, 12, materials.green, 'Park lawn');
  });
  addLandmark('europeanParliament', (g) => {
    part(g, new THREE.CylinderGeometry(15, 18, 30, 24), materials.glass, 0, 15, 0, 'Parliament glass volume');
    box(g, 22, 18, 28, 16, 9, 0, materials.glass, 'Parliament wing');
    box(g, 36, 1, 30, 5, 0.5, 0, materials.pale);
  });
  addLandmark('koekelbergBasilica', (g) => {
    box(g, 42, 17, 28, 0, 8.5, 0, materials.pale, 'Basilica nave');
    part(g, new THREE.SphereGeometry(13, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), materials.green, 0, 17, 0);
    for (const x of [-16, 16]) {
      cylinder(g, 3, 4, 22, x, 11, -7, materials.pale, 12);
      cone(g, 3.2, 6, x, 25, -7, materials.roof);
    }
  });

  scene?.add(group);
  return {
    group, colliders, zones, landmarks,
    update() {},
    towerBridge: null,
    setNight() {}
  };
}
