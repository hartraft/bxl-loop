import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const baseUrl = new URL(arg('--base-url', 'http://127.0.0.1:4173/'));
const outputDir = path.resolve(arg('--output', 'artifacts/browser-screenshots'));
const desktop = { width: 1600, height: 900 };
const scenes = [
  { name: 'brussels-default-street', locationId: null, viewport: desktop },
  { name: 'grand-place', locationId: 'grandPlace', viewport: desktop },
  { name: 'mont-des-arts', locationId: 'montDesArts', viewport: desktop },
  { name: 'palais-de-justice', locationId: 'palaisDeJustice', viewport: desktop },
  { name: 'cinquantenaire', locationId: 'cinquantenaire', viewport: desktop },
  { name: 'brussels-mobile-grand-place', locationId: 'grandPlace', viewport: { width: 390, height: 844 } }
];

const metadata = {
  commit: process.env.GITHUB_SHA || null,
  renderer: 'three.js WebGPURenderer WebGL2 fallback (SwiftShader)',
  browser: null,
  expectedScenes: scenes,
  captures: [],
  failures: [],
  diagnostics: []
};
const writeMetadata = async () => {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
};
const validatePng = async (file, viewport) => {
  const bytes = await fs.readFile(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error('Screenshot is not a valid PNG');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== viewport.width || height !== viewport.height) {
    throw new Error(`Screenshot is ${width}x${height}; expected ${viewport.width}x${viewport.height}`);
  }
  if (bytes.length < 12000) throw new Error(`Screenshot is suspiciously small (${bytes.length} bytes)`);
  return {
    width,
    height,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
};

await fs.mkdir(outputDir, { recursive: true });
for (const scene of scenes) {
  let browser;
  const errors = [];
  const file = path.join(outputDir, scene.name + '.png');
  try {
    await fs.rm(file, { force: true });
    browser = await chromium.launch({
      headless: true,
      timeout: 30000,
      args: [
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--disable-dev-shm-usage'
      ]
    });
    metadata.browser ||= browser.version();
    const context = await browser.newContext({
      viewport: scene.viewport,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce'
    });
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push({ type: 'pageerror', message: error.message }));
      page.on('crash', () => errors.push({ type: 'page-crash', message: 'Chromium page crashed' }));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push({ type: 'console', message: message.text() });
        const value = message.text();
        if (value.startsWith('[bxl-capture]')) {
          metadata.diagnostics.push({ scene: scene.name, message: value });
        }
      });
      page.on('requestfailed', (request) => {
        if (new URL(request.url()).origin === baseUrl.origin) {
          errors.push({ type: 'requestfailed', url: request.url(), message: request.failure()?.errorText || 'request failed' });
        }
      });

      const appUrl = new URL(baseUrl);
      appUrl.searchParams.set('city', 'brussels');
      appUrl.searchParams.set('capture', '');
      appUrl.searchParams.set('webgl', '');
      appUrl.searchParams.set('lite', '');
      appUrl.searchParams.set('offline', '');
      appUrl.searchParams.delete('tp');

      console.log(`[brussels-capture] Loading ${scene.name}`);
      await page.goto(appUrl.href, { waitUntil: 'commit', timeout: 60000 });
      await page.waitForFunction(() => window.__bxlCaptureReady === true, null, { timeout: 360000 });
      const state = await page.evaluate(async (locationId) => {
        const result = await window.__bxlCaptureScene(locationId);
        const canvas = document.querySelector('#canvas-container canvas');
        const overlay = document.getElementById('loading-overlay');
        const rect = canvas?.getBoundingClientRect();
        return {
          result,
          canvasPresent: Boolean(canvas),
          canvasWidth: canvas?.width ?? null,
          canvasHeight: canvas?.height ?? null,
          canvasRect: rect ? { width: rect.width, height: rect.height } : null,
          loadingOverlayPresent: Boolean(overlay)
        };
      }, scene.locationId);
      metadata.diagnostics.push({ scene: scene.name, pageState: state });
      if (!state.canvasPresent || state.loadingOverlayPresent) {
        throw new Error(`App did not reach a clean rendered state: ${JSON.stringify(state)}`);
      }
      if (!state.canvasRect ||
          state.canvasRect.width < scene.viewport.width * 0.95 ||
          state.canvasRect.height < scene.viewport.height * 0.95) {
        throw new Error(`3D canvas does not fill the viewport: ${JSON.stringify(state.canvasRect)}`);
      }

      await page.screenshot({
        path: file,
        type: 'png',
        fullPage: false,
        animations: 'disabled',
        timeout: 60000
      });
      const image = await validatePng(file, scene.viewport);
      if (errors.length) throw new Error(`Browser emitted errors: ${JSON.stringify(errors)}`);
      metadata.captures.push({
        name: scene.name,
        locationId: scene.locationId,
        file: path.basename(file),
        viewport: scene.viewport,
        ...image
      });
      console.log(`[brussels-capture] Saved ${scene.name}: ${image.width}x${image.height}, ${image.bytes} bytes`);
    } finally {
      await context.close();
    }
  } catch (error) {
    metadata.failures.push({
      scene: scene.name,
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: error.stack || null,
      browserErrors: errors
    });
    console.error(`[brussels-capture] FAILED ${scene.name}: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    await writeMetadata();
  }
}

const desktopCaptures = metadata.captures.filter((capture) => capture.viewport.width === desktop.width);
const hashes = new Set(desktopCaptures.map((capture) => capture.sha256));
if (desktopCaptures.length === 5 && hashes.size !== 5) {
  metadata.failures.push({
    scene: 'scene-diversity',
    message: 'Desktop scenes did not produce five distinct PNGs; at least one teleport may not have changed the camera.'
  });
}
const missing = scenes.filter((scene) => !metadata.captures.some((capture) => capture.name === scene.name));
if (missing.length) {
  metadata.failures.push({
    scene: 'complete-scene-set',
    message: `Captured ${metadata.captures.length}/${scenes.length}; missing: ${missing.map((scene) => scene.name).join(', ')}`
  });
}
await writeMetadata();
if (metadata.failures.length) {
  throw new Error(`Brussels rendered-scene capture failed: ${metadata.failures.length} failure(s); see metadata.json and available PNGs.`);
}
console.log('[brussels-capture] All six Brussels views captured successfully.');
