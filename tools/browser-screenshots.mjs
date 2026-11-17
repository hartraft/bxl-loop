import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const baseUrl = new URL(arg('--base-url', 'http://127.0.0.1:4173/'));
const outputDir = path.resolve(arg('--output', 'artifacts/browser-screenshots'));
const viewport = { width: 1600, height: 900 };
const errors = [];
const captures = [];
const diagnostics = [];
const renderer = 'three.js WebGL fallback (headless Chromium / SwiftShader)';
const withTimeout = (promise, milliseconds, label) => {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
};

const scenes = [
  { name: 'brussels-default-street', locationId: null, viewport },
  { name: 'grand-place', locationId: 'grandPlace', viewport },
  { name: 'mont-des-arts', locationId: 'montDesArts', viewport },
  { name: 'palais-de-justice', locationId: 'palaisDeJustice', viewport },
  { name: 'cinquantenaire', locationId: 'cinquantenaire', viewport },
  { name: 'brussels-mobile-grand-place', locationId: 'grandPlace', viewport: { width: 390, height: 844 } }
];

let browser;
const metadata = () => ({
  commit: process.env.GITHUB_SHA || null,
  browser: browser?.version() || null,
  renderer,
  viewportPolicy: 'CSS pixels; deviceScaleFactor=1',
  expectedScenes: scenes.map(({ name, locationId, viewport: size }) => ({ name, locationId, viewport: size })),
  captures,
  diagnostics,
  errors
});
const writeMetadata = async (failure = null) => {
  const result = metadata();
  if (failure) result.failure = { name: failure.name || 'Error', message: failure.message || String(failure), stack: failure.stack || null };
  await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify(result, null, 2) + '\n');
};
const validatePng = async (file, expectedViewport) => {
  const data = await fs.readFile(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 24 || !data.subarray(0, 8).equals(signature)) {
    throw new Error(`Screenshot is not a valid PNG: ${file}`);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expectedViewport.width || height !== expectedViewport.height) {
    throw new Error(`Screenshot dimensions for ${file} are ${width}x${height}; expected ${expectedViewport.width}x${expectedViewport.height}`);
  }
  if (data.length < 15000) throw new Error(`Screenshot ${file} is suspiciously small (${data.length} bytes)`);
  return { bytes: data.length, width, height };
};

await fs.mkdir(outputDir, { recursive: true });
try {
  browser = await chromium.launch({
    headless: true,
    timeout: 30000,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      // Keep the WebGL renderer on SwiftShader, but leave Chromium's normal compositor
      // enabled. Disabling GPU compositing caused Playwright's screenshot readback to
      // hang after the WebGL frame had rendered.
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });

  for (const scene of scenes) {
    const context = await browser.newContext({
      viewport: scene.viewport,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce'
    });
    try {
      const page = await context.newPage();
      const origin = baseUrl.origin;
      let firstFrameReadySeen = false;
      let resolveFirstFrameReady;
      const firstFrameReady = new Promise((resolve) => { resolveFirstFrameReady = resolve; });
      let pngTotal = 0;
      const pngChunks = new Map();
      let resolvePng;
      const pngReady = new Promise((resolve) => { resolvePng = resolve; });

      page.on('pageerror', (error) => errors.push({ type: 'pageerror', scene: scene.name, message: error.message }));
      page.on('crash', () => errors.push({ type: 'page-crash', scene: scene.name, message: 'Chromium page crashed' }));
      page.on('console', (message) => {
        const text = message.text();
        const pngMatch = text.match(/^\[capture-png\](\d+)\/(\d+):([A-Za-z0-9+/=]+)$/);
        if (pngMatch) {
          const index = Number(pngMatch[1]);
          pngTotal = Number(pngMatch[2]);
          pngChunks.set(index, pngMatch[3]);
          if (pngChunks.size === pngTotal) resolvePng();
          return;
        }
        if (message.type() === 'error') errors.push({ type: 'console', scene: scene.name, message: text });
        if (text.startsWith('[capture-sync]') || text.startsWith('[capture-settle]')) {
          diagnostics.push({ type: 'browser-console', scene: scene.name, message: text });
          if (text === '[capture-sync] loading overlay dismissed') {
            firstFrameReadySeen = true;
            resolveFirstFrameReady();
          }
        }
      });
      page.on('requestfailed', (request) => {
        try {
          if (new URL(request.url()).origin === origin) {
            errors.push({
              type: 'requestfailed',
              scene: scene.name,
              url: request.url(),
              message: request.failure()?.errorText || 'request failed'
            });
          }
        } catch {
          // Ignore malformed/non-URL requests; page errors are captured separately.
        }
      });

      const appUrl = new URL(baseUrl);
      appUrl.searchParams.set('city', 'brussels');
      appUrl.searchParams.set('webgl', '');
      appUrl.searchParams.set('lite', '');
      appUrl.searchParams.set('offline', '');
      appUrl.searchParams.set('capture', '');
      if (scene.locationId) appUrl.searchParams.set('tp', scene.locationId);
      else appUrl.searchParams.delete('tp');

      console.log(`[browser-scenes] Opening ${scene.name} at ${appUrl.href}`);
      await page.goto(appUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('#canvas-container canvas');
        return !!window.__bxl && typeof window.__bxlTick === 'function' &&
          typeof window.__bxlGpuIdle === 'function' && !!canvas &&
          canvas.width > 0 && canvas.height > 0;
      }, null, { timeout: 180000 });

      console.log(`[browser-scenes] Capture API ready for ${scene.name}; waiting for first-frame completion`);
      if (!firstFrameReadySeen) {
        await withTimeout(firstFrameReady, 30000, `Wait for first-frame completion for ${scene.name}`);
      }
      diagnostics.push({
        type: 'capture-ready',
        scene: scene.name,
        locationId: scene.locationId,
        viewport: scene.viewport,
        renderer
      });

      // Wait outside the page so we do not issue DevTools Runtime commands while the
      // software WebGL renderer is finishing its first submitted frame.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const file = path.join(outputDir, scene.name + '.png');
      await fs.rm(file, { force: true });
      console.log(`[browser-scenes] Exporting preserved WebGL frame for ${scene.name}`);
      const captureStarted = Date.now();
      await withTimeout(pngReady, 30000, `Wait for WebGL PNG export for ${scene.name}`);
      if (!pngTotal || pngChunks.size !== pngTotal) {
        throw new Error(`Incomplete WebGL PNG export for ${scene.name}: received ${pngChunks.size} of ${pngTotal} chunks`);
      }
      const png = Buffer.from(Array.from({ length: pngTotal }, (_, index) => pngChunks.get(index)).join(''), 'base64');
      await fs.writeFile(file, png);
      const image = await validatePng(file, { width: Math.floor(scene.viewport.width * 0.75), height: Math.floor(scene.viewport.height * 0.75) });
      captures.push({
        name: scene.name,
        file: path.relative(process.cwd(), file),
        ...image,
        locationId: scene.locationId,
        durationMs: Date.now() - captureStarted
      });
      diagnostics.push({ type: 'capture-complete', scene: scene.name, durationMs: Date.now() - captureStarted });
      await writeMetadata();
      console.log(`[browser-scenes] Captured WebGL scene ${scene.name} (${image.width}x${image.height}, ${image.bytes} bytes)`);
    } finally {
      await context.close();
    }
    if (errors.length) throw new Error(`Browser reported ${errors.length} error(s) after ${scene.name}:\n${JSON.stringify(errors, null, 2)}`);
  }

  if (captures.length !== scenes.length || scenes.some((scene) => !captures.some((capture) => capture.name === scene.name))) {
    throw new Error(`Incomplete scene set: captured ${captures.length} of ${scenes.length} required views`);
  }
  await writeMetadata();
  console.log(`[browser-scenes] Successfully captured and validated all ${captures.length} rendered Brussels views.`);
} catch (error) {
  await writeMetadata(error);
  throw error;
} finally {
  if (browser) await browser.close();
}
