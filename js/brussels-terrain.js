// js/brussels-terrain.js — compact, browser-friendly sampler for the CC0 Brussels Mobility DTM.
// Generated assets are deliberately kept out of git until the source export and datum have been verified.

const finite = Number.isFinite;

/** Lowest scene-relative foundation-skirt vertex; terrain above the podium underside needs no exposed skirt. */
export function foundationSkirtBottom(terrainY, podiumBottomY, clearance = 0.05) {
  if (![terrainY, podiumBottomY, clearance].every(finite) || clearance < 0) throw new TypeError('Invalid foundation skirt heights');
  return Math.min(terrainY, podiumBottomY - clearance);
}

/** Terrain-conforming lower edge for ground-level building walls. Inputs and result are scene-relative metres. */
export function foundationWallBase(terrainAt, anchorY, lowerY, upperY) {
  if (![terrainAt, anchorY, lowerY, upperY].every(finite)) throw new TypeError('Invalid foundation wall heights');
  if (upperY <= lowerY + 0.05) return lowerY;
  return Math.max(lowerY, Math.min(upperY - 0.05, terrainAt - anchorY + 0.04));
}

export function createTerrainSampler(metadata, values) {
  const { width, height, cellSize, minX, minZ, noData = -9999 } = metadata || {};
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2 ||
      !finite(cellSize) || cellSize <= 0 || !finite(minX) || !finite(minZ)) {
    throw new Error('Invalid Brussels terrain metadata');
  }
  if (!(values instanceof Float32Array) || values.length !== width * height) {
    throw new Error('Brussels terrain grid size does not match metadata');
  }

  function sample(x, z) {
    if (!finite(x) || !finite(z)) return null;
    // Grid values are sampled at cell centres.
    const gx = (x - minX) / cellSize - 0.5;
    const gz = (z - minZ) / cellSize - 0.5;
    if (gx < 0 || gz < 0 || gx > width - 1 || gz > height - 1) return null;
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const x1 = Math.min(width - 1, x0 + 1), z1 = Math.min(height - 1, z0 + 1);
    const tx = gx - x0, tz = gz - z0;
    const candidates = [
      [z0 * width + x0, (1 - tx) * (1 - tz)],
      [z0 * width + x1, tx * (1 - tz)],
      [z1 * width + x0, (1 - tx) * tz],
      [z1 * width + x1, tx * tz]
    ];
    let sum = 0, weight = 0;
    for (const [index, w] of candidates) {
      const value = values[index];
      if (w > 0 && finite(value) && Math.abs(value - noData) > 1e-5) {
        sum += value * w;
        weight += w;
      }
    }
    return weight > 0 ? sum / weight : null;
  }

  return Object.freeze({
    sample,
    width,
    height,
    cellSize,
    minX,
    minZ,
    maxX: minX + width * cellSize,
    maxZ: minZ + height * cellSize,
    source: metadata.source || 'Brussels Mobility / Paradigm DTM (CC0)'
  });
}

/** Load the optional baked Float32 grid. Missing assets are a safe flat-world fallback. */
export async function loadBrusselsTerrain({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const metadataUrl = new URL('../data/brussels-terrain/metadata.json', import.meta.url);
  const metadataResponse = await fetchImpl(metadataUrl);
  if (!metadataResponse.ok) {
    if (metadataResponse.status === 404) return null;
    throw new Error(`Unable to load Brussels terrain metadata: HTTP ${metadataResponse.status}`);
  }
  const metadata = await metadataResponse.json();
  if (!metadata || typeof metadata.dataFile !== 'string' || metadata.dataFile.includes('..')) {
    throw new Error('Invalid Brussels terrain data-file reference');
  }
  const dataUrl = new URL(metadata.dataFile, metadataUrl);
  const dataResponse = await fetchImpl(dataUrl);
  if (!dataResponse.ok) throw new Error(`Unable to load Brussels terrain grid: HTTP ${dataResponse.status}`);
  const buffer = await dataResponse.arrayBuffer();
  const expectedBytes = metadata.width * metadata.height * 4;
  if (buffer.byteLength !== expectedBytes) throw new Error('Brussels terrain binary has an unexpected byte length');
  const view = new DataView(buffer);
  const values = new Float32Array(metadata.width * metadata.height);
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
  return createTerrainSampler(metadata, values);
}

/**
 * Convert Belgian zero-D elevations into the existing local scene's Y frame.
 * The local origin (Grand-Place) is scene Y=0. A cosine fade returns the
 * existing flat-world height outside the DTM edge instead of creating a cliff.
 */
export function createTerrainSurface(terrain, { referenceX = 0, referenceZ = 0, edgeBlend = 250 } = {}) {
  if (!terrain) return null;
  if (!finite(referenceX) || !finite(referenceZ) || !finite(edgeBlend) || edgeBlend < 0) {
    throw new Error('Invalid Brussels terrain surface options');
  }
  const referenceElevation = terrain.sample(referenceX, referenceZ);
  if (!finite(referenceElevation)) throw new Error('Brussels terrain does not cover its local vertical reference');
  const smoothstep = (t) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
  function sample(x, z) {
    const absolute = terrain.sample(x, z);
    if (!finite(absolute)) return 0;
    const edgeDistance = Math.min(x - terrain.minX, terrain.maxX - x, z - terrain.minZ, terrain.maxZ - z);
    const fade = edgeBlend === 0 ? 1 : smoothstep(edgeDistance / edgeBlend);
    return fade <= 0 ? 0 : (absolute - referenceElevation) * fade;
  }
  return Object.freeze({ sample, referenceElevation, referenceX, referenceZ, edgeBlend, source: terrain.source });
}

/**
 * Build a conforming barycentric subdivision for one triangle.
 * A shared steps value across a polygon guarantees matching samples on shared edges.
 */
export function subdivideTerrainTriangle(p0, p1, p2, maxStep = 50, sharedSteps = null) {
  if (![...p0, ...p1, ...p2, maxStep].every(finite) || maxStep <= 0) {
    throw new Error('Invalid terrain triangle');
  }
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const steps = sharedSteps ?? Math.max(1, Math.ceil(Math.max(distance(p0, p1), distance(p1, p2), distance(p2, p0)) / maxStep));
  if (!Number.isInteger(steps) || steps < 1) throw new Error('Invalid terrain subdivision steps');
  const vertices = [], index = new Map();
  const vertex = (i, j) => {
    const key = i + ',' + j;
    if (index.has(key)) return index.get(key);
    const u = i / steps, v = j / steps, w = 1 - u - v;
    const id = vertices.length;
    vertices.push([p0[0] * w + p1[0] * u + p2[0] * v, p0[1] * w + p1[1] * u + p2[1] * v]);
    index.set(key, id);
    return id;
  };
  const winding = (p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]) >= 0;
  const triangles = [];
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps - i; j++) {
      const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i, j + 1);
      triangles.push(winding ? [a, b, c] : [a, c, b]);
      if (i + j < steps - 1) {
        const d = vertex(i + 1, j + 1);
        triangles.push(winding ? [b, d, c] : [b, c, d]);
      }
    }
  }
  return { vertices, triangles, steps };
}
