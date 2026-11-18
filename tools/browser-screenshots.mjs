import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
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
const decodedImages = new Map();
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
let browserVersion = null;
const metadata = () => ({
  commit: process.env.GITHUB_SHA || null,
  browser: browserVersion,
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

  // Validate the pixels a reviewer will actually see, not WebGL's raw back buffer.
  // Direct gl.readPixels() on the WebGPURenderer fallback can race its compositor
  // and has caused SwiftShader device loss after the app's first-frame marker.
  const rgb = execFileSync('convert', [file, '-alpha', 'off', '-depth', '8', 'rgb:-'], {
    maxBuffer: 16 * 1024 * 1024
  });
  if (rgb.length !== width * height * 3) {
    throw new Error(`Screenshot pixel decode for ${file} returned ${rgb.length} bytes; expected ${width * height * 3}`);
  }

  let edgeCount = 0;
  let comparisons = 0;
  const threshold = 24;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      if (x + 1 < width) {
        const right = offset + 3;
        if (Math.max(
          Math.abs(rgb[offset] - rgb[right]),
          Math.abs(rgb[offset + 1] - rgb[right + 1]),
          Math.abs(rgb[offset + 2] - rgb[right + 2])
        ) > threshold) edgeCount++;
        comparisons++;
      }
      if (y + 1 < height) {
        const below = offset + width * 3;
        if (Math.max(
          Math.abs(rgb[offset] - rgb[below]),
          Math.abs(rgb[offset + 1] - rgb[below + 1]),
          Math.abs(rgb[offset + 2] - rgb[below + 2])
        ) > threshold) edgeCount++;
        comparisons++;
      }
    }
  }
  const edgeRatio = edgeCount / comparisons;
  const minimumEdgeRatio = width < 500 ? 0.02 : 0.01;
  if (edgeRatio < minimumEdgeRatio) {
    throw new Error(`Screenshot ${file} has only ${(edgeRatio * 100).toFixed(3)}% edge detail; expected at least ${(minimumEdgeRatio * 100).toFixed(1)}%. The loading overlay or a blank/stale canvas may still be visible.`);
  }

  // Exclude the outer HUD/touch controls and check the central 76% of the
  // screenshot, where the actual 3D scene should be visible.
  const left = Math.floor(width * 0.12);
  const right = Math.ceil(width * 0.88);
  const top = Math.floor(height * 0.12);
  const bottom = Math.ceil(height * 0.88);
  let regionNonBlack = 0;
  let regionEdges = 0;
  let regionComparisons = 0;
  const regionColors = new Set();
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 3;
      const r = rgb[offset], g = rgb[offset + 1], b = rgb[offset + 2];
      if (Math.max(r, g, b) > 16) regionNonBlack++;
      regionColors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      if (x + 1 < right) {
        const adjacent = offset + 3;
        if (Math.max(
          Math.abs(r - rgb[adjacent]),
          Math.abs(g - rgb[adjacent + 1]),
          Math.abs(b - rgb[adjacent + 2])
        ) > threshold) regionEdges++;
        regionComparisons++;
      }
      if (y + 1 < bottom) {
        const adjacent = offset + width * 3;
        if (Math.max(
          Math.abs(r - rgb[adjacent]),
          Math.abs(g - rgb[adjacent + 1]),
          Math.abs(b - rgb[adjacent + 2])
        ) > threshold) regionEdges++;
        regionComparisons++;
      }
    }
  }
  const regionPixels = (right - left) * (bottom - top);
  const sceneRegion = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    nonBlackRatio: Number((regionNonBlack / regionPixels).toFixed(4)),
    colorBuckets: regionColors.size,
    edgeRatio: Number((regionEdges / regionComparisons).toFixed(5))
  };
  if (sceneRegion.nonBlackRatio < 0.08 || sceneRegion.colorBuckets < 24 || sceneRegion.edgeRatio < 0.003) {
    throw new Error(`Screenshot ${file} does not contain a sufficiently detailed 3D scene in the central viewport: ${JSON.stringify(sceneRegion)}`);
  }

  decodedImages.set(path.basename(file, '.png'), rgb);
  return { bytes: data.length, width, height, edgeRatio: Number(edgeRatio.toFixed(5)), sceneRegion };
};

await fs.mkdir(outputDir, { recursive: true });
try {
  for (const scene of scenes) {
    // Give every scene a fresh Chromium/SwiftShader process. Reusing one browser
    // across the six heavy WebGL builds leaks software-renderer resources on CI;
    // later pages can stall before their first frame despite identical scene setup.
    browser = await chromium.launch({
      headless: false,
      timeout: 30000,
      args: [
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--kiosk',
        '--window-size=1600,1000',
        '--window-position=0,0'
      ]
    });
    // Preserve the version independently of the browser lifecycle: each scene
    // closes its browser, but the final metadata must still identify the build.
    browserVersion ??= browser.version();
    const context = await browser.newContext({
      viewport: scene.viewport,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce'
    });
    try {
      const page = await context.newPage();
      const origin = baseUrl.origin;
      let resolveFirstFrameReady;
      let rejectFirstFrameReady;
      const firstFrameReady = new Promise((resolve, reject) => {
        resolveFirstFrameReady = resolve;
        rejectFirstFrameReady = reject;
      });

      page.on('pageerror', (error) => errors.push({ type: 'pageerror', scene: scene.name, message: error.message }));
      page.on('crash', () => errors.push({ type: 'page-crash', scene: scene.name, message: 'Chromium page crashed' }));
      page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error') errors.push({ type: 'console', scene: scene.name, message: text });
        if (text.startsWith('[capture-sync]') || text.startsWith('[capture-settle]')) {
          diagnostics.push({ type: 'browser-console', scene: scene.name, message: text });
          if (text === '[capture-sync] browser presentation frame completed') {
            console.log(`[browser-scenes] Browser presentation frame ready for ${scene.name}`);
            resolveFirstFrameReady();
          }
          const gpuFailure = text.match(/^\[capture-sync\] first-frame GPU completion failed: (.+)$/);
          if (gpuFailure) {
            rejectFirstFrameReady(new Error(`Capture GPU synchronization failed for ${scene.name}: ${gpuFailure[1]}`));
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
      // Wait only for the response commit. DOMContentLoaded waits for the large ES
      // module graph and can be held up by WebGL initialization in CI; the app's own
      // first-frame signal below is the meaningful readiness condition.
      await page.goto(appUrl.href, { waitUntil: 'commit', timeout: 60000 });
      console.log(`[browser-scenes] Navigation committed for ${scene.name}; waiting for app first frame`);
      await withTimeout(firstFrameReady, 240000, `Wait for first-frame completion for ${scene.name}`);
      diagnostics.push({
        type: 'capture-ready',
        scene: scene.name,
        locationId: scene.locationId,
        viewport: scene.viewport,
        renderer
      });

      // Inspect the DOM independently of the console readiness marker. Do not
      // query the WebGL context or call readPixels() here: the browser viewport
      // screenshot is the user-visible output and is validated directly below.
      const pageState = await page.evaluate(() => {
        const overlay = document.getElementById('loading-overlay');
        const canvas = document.querySelector('#canvas-container canvas');
        const rect = canvas?.getBoundingClientRect();
        const overlayStyle = overlay ? getComputedStyle(overlay) : null;
        return {
          readyState: document.readyState,
          overlayPresent: Boolean(overlay),
          overlayVisible: Boolean(overlay && overlayStyle &&
            overlayStyle.display !== 'none' &&
            overlayStyle.visibility !== 'hidden' &&
            Number(overlayStyle.opacity) > 0),
          canvasPresent: Boolean(canvas),
          canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
          canvasRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
        };
      });
      diagnostics.push({ type: 'page-state-before-capture', scene: scene.name, ...pageState });
      if (pageState.overlayPresent || pageState.overlayVisible || !pageState.canvasPresent) {
        throw new Error(`Application is not visually ready for ${scene.name}: ${JSON.stringify(pageState)}`);
      }
      if (!pageState.canvasRect ||
          pageState.canvasRect.width < scene.viewport.width * 0.95 ||
          pageState.canvasRect.height < scene.viewport.height * 0.95) {
        throw new Error(`3D canvas does not fill the expected viewport for ${scene.name}: ${JSON.stringify(pageState.canvasRect)}`);
      }

      // Invalidate the compositor after the WebGL frame and overlay removal. The
      // screenshot API captures the browser viewport (DOM + WebGL canvas) directly;
      // X11 remains a fallback for Chromium builds whose WebGL readback path fails.
      await page.evaluate(async () => {
        window.dispatchEvent(new Event('resize'));
        const canvas = document.querySelector('#canvas-container canvas');
        if (canvas) {
          canvas.style.willChange = 'transform';
          canvas.style.transform = 'translateZ(0)';
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          canvas.style.transform = '';
          canvas.style.willChange = '';
        } else {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const file = path.join(outputDir, scene.name + '.png');
      const cdpFile = path.join(outputDir, scene.name + '.browser.png');
      const raw = path.join(outputDir, scene.name + '.xwd');
      await fs.rm(file, { force: true });
      await fs.rm(cdpFile, { force: true });
      await fs.rm(raw, { force: true });
      const captureStarted = Date.now();
      let image;
      let browserCaptureError = null;
      console.log(`[browser-scenes] Capturing ${scene.name} from the browser viewport`);
      try {
        await page.screenshot({ path: cdpFile, type: 'png', fullPage: false, animations: 'disabled', timeout: 30000 });
        image = await validatePng(cdpFile, scene.viewport);
        await fs.rename(cdpFile, file);
        diagnostics.push({ type: 'capture-method', scene: scene.name, method: 'playwright-viewport' });
      } catch (error) {
        browserCaptureError = error.message;
        await fs.rm(cdpFile, { force: true });
        console.warn(`[browser-scenes] Browser viewport capture failed for ${scene.name}: ${browserCaptureError}`);
      }
      if (!image) {
        console.log(`[browser-scenes] Falling back to X11 display capture for ${scene.name}`);
        execFileSync('xwd', ['-root', '-silent', '-out', raw], { timeout: 15000 });
        execFileSync('convert', [raw, '-crop', `${scene.viewport.width}x${scene.viewport.height}+0+85`, '+repage', file], { timeout: 30000 });
        await fs.rm(raw, { force: true });
        try {
          image = await validatePng(file, scene.viewport);
          diagnostics.push({ type: 'capture-method', scene: scene.name, method: 'x11-display', browserCaptureError });
        } catch (x11Error) {
          throw new Error(`Both screenshot methods failed for ${scene.name}. Browser viewport: ${browserCaptureError || 'not attempted'}. X11: ${x11Error.message}`);
        }
      }
      captures.push({
        name: scene.name,
        file: path.relative(process.cwd(), file),
        ...image,
        locationId: scene.locationId,
        durationMs: Date.now() - captureStarted
      });
      diagnostics.push({ type: 'capture-complete', scene: scene.name, durationMs: Date.now() - captureStarted });
      await writeMetadata();
      console.log(`[browser-scenes] Captured scene ${scene.name} (${image.width}x${image.height}, ${image.bytes} bytes)`);
    } finally {
      await context.close();
      if (browser) {
        await browser.close();
        browser = null;
      }
    }
    if (errors.length) throw new Error(`Browser reported ${errors.length} error(s) after ${scene.name}:\n${JSON.stringify(errors, null, 2)}`);
  }

  if (captures.length !== scenes.length || scenes.some((scene) => !captures.some((capture) => capture.name === scene.name))) {
    throw new Error(`Incomplete scene set: captured ${captures.length} of ${scenes.length} required views`);
  }

  // The five desktop viewpoints must contain materially different pixels. This
  // catches a stale loading screen or a runner that captured the same camera frame
  // for every teleport, even when all PNGs have valid dimensions and file sizes.
  const desktopScenes = scenes.filter((scene) => scene.viewport.width === viewport.width);
  for (let i = 0; i < desktopScenes.length; i++) {
    for (let j = i + 1; j < desktopScenes.length; j++) {
      const first = desktopScenes[i];
      const second = desktopScenes[j];
      const a = decodedImages.get(first.name);
      const b = decodedImages.get(second.name);
      let changedPixels = 0;
      const pixels = first.viewport.width * first.viewport.height;
      for (let offset = 0; offset < a.length; offset += 3) {
        if (
          Math.abs(a[offset] - b[offset]) > 8 ||
          Math.abs(a[offset + 1] - b[offset + 1]) > 8 ||
          Math.abs(a[offset + 2] - b[offset + 2]) > 8
        ) changedPixels++;
      }
      const changedRatio = changedPixels / pixels;
      diagnostics.push({
        type: 'scene-diversity',
        first: first.name,
        second: second.name,
        changedPixelRatio: Number(changedRatio.toFixed(5))
      });
      if (changedRatio < 0.005) {
        throw new Error(`Desktop captures ${first.name} and ${second.name} differ in only ${(changedRatio * 100).toFixed(3)}% of pixels; expected at least 0.5%. A stale or repeated scene may have been captured.`);
      }
    }
  }
  await writeMetadata();
  console.log(`[browser-scenes] Successfully captured and validated all ${captures.length} rendered Brussels views.`);
} catch (error) {
  await writeMetadata(error);
  throw error;
} finally {
  if (browser) await browser.close();
}
