// js/brussels-terrain.js — compact, browser-friendly sampler for the CC0 Brussels Mobility DTM.
// Generated assets are deliberately kept out of git until the source export and datum have been verified.

const finite = Number.isFinite;

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
