import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// A dedicated target keeps the planar mirror pass separate from the SSR RenderPipeline.
export const roadReflectionTarget = new THREE.RenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  depthBuffer: true
});
roadReflectionTarget.texture.name = 'BrusselsWetRoadReflection';
roadReflectionTarget.texture.minFilter = THREE.LinearFilter;
roadReflectionTarget.texture.magFilter = THREE.LinearFilter;
roadReflectionTarget.texture.generateMipmaps = false;

export const roadReflectionEnabled = uniform(0);

const _size = new THREE.Vector2();
const _normal = new THREE.Vector3(0, 1, 0);
const _view = new THREE.Vector3();
const _target = new THREE.Vector3();
const _lookAtPosition = new THREE.Vector3();
const _cameraPosition = new THREE.Vector3();
const _planePoint = new THREE.Vector3(0, 0, 0);
const _rotation = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();

const REFLECTION_EXCLUDED_MATERIALS = new Set([
  'BrusselsAsphalt',
  'BrusselsGround',
  'BrusselsPaving',
  'BrusselsMarkings',
  'BrusselsGrass',
  'BrusselsWater',
  'BrusselsBallast'
]);

function hasExcludedGroundMaterial(object) {
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.some((material) => material && REFLECTION_EXCLUDED_MATERIALS.has(material.name));
}

/**
 * Mirrors the scene around the street plane into a small render target.
 * The target is sampled by the asphalt material only while the road-wetness
 * uniform is active. The ground-level surfaces themselves are omitted from
 * the mirror pass to avoid reflecting road markings and the mirror plane.
 */
export function createRoadReflections(scene, renderer, { enabled = true, surfaceHeight = null, fallbackSurfaceHeight = null } = {}) {
  const mirrorCamera = new THREE.PerspectiveCamera();
  const excluded = [];
  scene.traverse((object) => {
    if (object.isMesh && hasExcludedGroundMaterial(object)) excluded.push(object);
  });

  let active = Boolean(enabled);
  let frame = 0;
  let failed = false;
  const coarsePointer = typeof window !== 'undefined'
    && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const resolutionScale = coarsePointer ? 0.18 : 0.28;
  const frameSkip = coarsePointer ? 3 : 2;

  roadReflectionEnabled.value = 0;

  function update(activeRenderer, camera, wetness = 1) {
    if (!active || failed || !camera) return;
    if (wetness <= 0.01) {
      roadReflectionEnabled.value = 0;
      roadReflectionEnabled.needsUpdate = true;
      return;
    }
    frame += 1;
    if (frame % frameSkip !== 0) return;

    camera.updateMatrixWorld();
    _cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    // Follow the local road/sidewalk height so the mirror tracks the optional Brussels DTM
    // and raised bridge approaches instead of assuming the entire city is at y=0.
    _planePoint.set(_cameraPosition.x, 0, _cameraPosition.z);
    const sampledHeight = surfaceHeight?.(_planePoint.x, _planePoint.z);
    const fallbackHeight = fallbackSurfaceHeight?.(_planePoint.x, _planePoint.z);
    _planePoint.y = Number.isFinite(sampledHeight)
      ? sampledHeight
      : Number.isFinite(fallbackHeight) ? fallbackHeight : 0;
    // A camera at/below the local surface cannot produce a useful mirror. Clear the
    // enable uniform as well, otherwise the last valid view remains frozen in asphalt.
    if (_cameraPosition.y <= _planePoint.y + 0.05) {
      roadReflectionEnabled.value = 0;
      roadReflectionEnabled.needsUpdate = true;
      return;
    }

    activeRenderer.getDrawingBufferSize(_size);
    const width = Math.max(1, Math.round(_size.x * resolutionScale));
    const height = Math.max(1, Math.round(_size.y * resolutionScale));
    if (roadReflectionTarget.width !== width || roadReflectionTarget.height !== height) {
      roadReflectionTarget.setSize(width, height);
    }

    try {
      _view.subVectors(_planePoint, _cameraPosition);
      _view.reflect(_normal).negate().add(_planePoint);

      _rotation.extractRotation(camera.matrixWorld);
      _lookAtPosition.set(0, 0, -1).applyMatrix4(_rotation).add(_cameraPosition);
      _target.subVectors(_planePoint, _lookAtPosition);
      _target.reflect(_normal).negate().add(_planePoint);

      mirrorCamera.coordinateSystem = camera.coordinateSystem;
      mirrorCamera.fov = camera.fov;
      mirrorCamera.aspect = camera.aspect;
      mirrorCamera.near = camera.near;
      mirrorCamera.far = camera.far;
      mirrorCamera.position.copy(_view);
      mirrorCamera.up.set(0, 1, 0).applyMatrix4(_rotation).reflect(_normal);
      mirrorCamera.layers.mask = camera.layers.mask;
      mirrorCamera.lookAt(_target);
      mirrorCamera.updateMatrixWorld(true);
      mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);

      _plane.setFromNormalAndCoplanarPoint(_normal, _planePoint);
      _plane.applyMatrix4(mirrorCamera.matrixWorldInverse);
      _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);

      const projection = mirrorCamera.projectionMatrix;
      _q.x = (Math.sign(_clip.x) + projection.elements[8]) / projection.elements[0];
      _q.y = (Math.sign(_clip.y) + projection.elements[9]) / projection.elements[5];
      _q.z = -1;
      _q.w = (1 + projection.elements[10]) / projection.elements[14];
      const denominator = _clip.dot(_q);
      if (Math.abs(denominator) < 1e-6) return;
      _clip.multiplyScalar(1 / denominator);
      projection.elements[2] = _clip.x;
      projection.elements[6] = _clip.y;
      projection.elements[10] = activeRenderer.coordinateSystem === THREE.WebGPUCoordinateSystem
        ? _clip.z
        : _clip.z + 1;
      projection.elements[14] = _clip.w;
      mirrorCamera.projectionMatrixInverse.copy(projection).invert();

      const previousTarget = activeRenderer.getRenderTarget();
      const previousMRT = activeRenderer.getMRT?.() ?? null;
      const previousAutoClear = activeRenderer.autoClear;
      const visibility = excluded.map((object) => object.visible);

      try {
        for (const object of excluded) object.visible = false;
        activeRenderer.setMRT?.(null);
        activeRenderer.setRenderTarget(roadReflectionTarget);
        activeRenderer.autoClear = true;
        activeRenderer.render(scene, mirrorCamera);
        roadReflectionEnabled.value = 1;
        roadReflectionEnabled.needsUpdate = true;
      } finally {
        activeRenderer.setMRT?.(previousMRT);
        activeRenderer.setRenderTarget(previousTarget);
        activeRenderer.autoClear = previousAutoClear;
        for (let i = 0; i < excluded.length; i++) excluded[i].visible = visibility[i];
      }
    } catch (error) {
      failed = true;
      roadReflectionEnabled.value = 0;
      roadReflectionEnabled.needsUpdate = true;
      console.warn('[road reflections] Disabled after a render failure:', error);
    }
  }

  function dispose() {
    active = false;
    roadReflectionEnabled.value = 0;
    roadReflectionEnabled.needsUpdate = true;
    roadReflectionTarget.dispose();
  }

  return { update, dispose, target: roadReflectionTarget };
}
