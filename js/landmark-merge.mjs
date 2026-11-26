import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Merges the static meshes of a landmark root into one mesh per (material, attribute
// signature), baking each mesh's root-relative transform — and its instances, when there
// are few — into the geometry. A landmark built from hundreds of small meshes then costs
// a few dozen draw calls per frame instead of hundreds, in the view pass and in every
// shadow cascade. Meshes that stay animated or share no material with another mesh are
// left untouched. Landmark materials are shared objects, so night-glow emissive still
// reaches the merged meshes.

const DEFAULT_MAX_BAKE_INSTANCES = 512;

function attributeSignature(geometry) {
  const names = Object.keys(geometry.attributes).sort().join(',');
  return (geometry.index ? 'i:' : 'n:') + names;
}

function triangleCount(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

/**
 * Merges the static meshes under `root` in place.
 * opts.maxBakeInstances: instance counts up to this are baked into the merged geometry;
 *   larger InstancedMeshes are already a single draw call and are kept as they are.
 * opts.shadowFlags(maxExtent) -> { castShadow, receiveShadow }: applied to each merged mesh
 *   from its bounding box (pass landmarkShadowFlags to keep only the large masses casting).
 * Returns { meshesBefore, meshesAfter, mergedMeshes, trianglesBefore, trianglesAfter }.
 */
export function mergeStaticGeometry(root, opts = {}) {
  const maxBakeInstances = opts.maxBakeInstances ?? DEFAULT_MAX_BAKE_INSTANCES;
  const shadowFlags = typeof opts.shadowFlags === 'function' ? opts.shadowFlags : null;
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const baked = new THREE.Matrix4();
  const size = new THREE.Vector3();

  const countVisible = () => {
    let meshes = 0, triangles = 0;
    root.traverse((o) => {
      if (o.isMesh && o.visible && o.geometry) {
        meshes++;
        triangles += triangleCount(o.geometry) * (o.isInstancedMesh ? o.count : 1);
      }
    });
    return { meshes, triangles };
  };
  const before = countVisible();

  const records = []; // { obj, geometries: [baked], castShadow, receiveShadow }
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.isSkinnedMesh || !o.geometry || Array.isArray(o.material)) return;
    if (o.isInstancedMesh && o.count > maxBakeInstances) return; // kept as one draw call
    rel.multiplyMatrices(rootInv, o.matrixWorld);
    const geometries = [];
    if (o.isInstancedMesh) {
      const e = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) {
        instance.fromArray(e, i * 16);
        baked.multiplyMatrices(rel, instance);
        const g = o.geometry.clone();
        g.applyMatrix4(baked);
        geometries.push(g);
      }
    } else {
      const g = o.geometry.clone();
      g.applyMatrix4(rel);
      geometries.push(g);
    }
    records.push({ obj: o, geometries, castShadow: o.castShadow, receiveShadow: o.receiveShadow });
  });

  const groups = new Map(); // material.uuid|signature -> { material, signature, records, castShadow, receiveShadow, renderOrder, layers, name }
  for (const record of records) {
    const signature = attributeSignature(record.obj.geometry);
    const key = record.obj.material.uuid + '|' + signature;
    let group = groups.get(key);
    if (!group) {
      const o = record.obj;
      group = { material: o.material, records: [], castShadow: false, receiveShadow: false, renderOrder: o.renderOrder, layers: o.layers.mask, name: o.name || '' };
      groups.set(key, group);
    }
    group.records.push(record);
    group.castShadow = group.castShadow || record.castShadow;
    group.receiveShadow = group.receiveShadow || record.receiveShadow;
  }

  let mergedMeshes = 0;
  for (const group of groups.values()) {
    if (group.records.length < 2) {
      for (const g of group.records[0].geometries) g.dispose();
      continue;
    }
    const geometries = [];
    for (const r of group.records) geometries.push(...r.geometries);
    const mergedGeometry = mergeGeometries(geometries);
    if (!mergedGeometry) { // attribute mismatch: keep the originals
      for (const g of geometries) g.dispose();
      continue;
    }
    for (const g of geometries) g.dispose();
    const mesh = new THREE.Mesh(mergedGeometry, group.material);
    mesh.name = group.name ? `${group.name} +${group.records.length - 1} merged` : `merged ${group.records.length}`;
    mesh.renderOrder = group.renderOrder;
    mesh.layers.mask = group.layers;
    if (shadowFlags) {
      mergedGeometry.computeBoundingBox();
      mergedGeometry.boundingBox.getSize(size);
      const flags = shadowFlags(Math.max(size.x, size.y, size.z));
      mesh.castShadow = flags.castShadow;
      mesh.receiveShadow = flags.receiveShadow;
    } else {
      mesh.castShadow = group.castShadow;
      mesh.receiveShadow = group.receiveShadow;
    }
    mergedGeometry.computeBoundingSphere();
    root.add(mesh);
    for (const r of group.records) if (r.obj.parent) r.obj.parent.remove(r.obj);
    mergedMeshes++;
  }

  const after = countVisible();
  return {
    meshesBefore: before.meshes,
    meshesAfter: after.meshes,
    mergedMeshes,
    trianglesBefore: before.triangles,
    trianglesAfter: after.triangles
  };
}
