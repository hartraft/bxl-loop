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
const withTimeout = (promise, milliseconds, label) => {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
};

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    // Keep WebGL on SwiftShader but force the page compositor onto its software path.
    // Chromium's GPU-surface screenshot readback has stalled on this runner.
    '--disable-gpu-compositing',
    '--use-gl=angle',
    '--use-angle=swiftshader'
  ]
});

try {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const origin = baseUrl.origin;

  page.on('pageerror', (error) => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') errors.push({ type: 'console', message: text });
    else if (text.startsWith('[capture-sync]')) diagnostics.push({ type: 'capture-sync', message: text });
  });
  page.on('requestfailed', (request) => {
    try {
      if (new URL(request.url()).origin === origin) {
        errors.push({ type: 'requestfailed', url: request.url(), message: request.failure()?.errorText || 'request failed' });
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

  console.log(`[browser-scenes] Opening ${appUrl.href}`);
  await page.goto(appUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#canvas-container canvas');
    return !!window.__bxl && typeof window.__bxlTick === 'function' &&
      typeof window.__bxlGpuIdle === 'function' && !!canvas;
  }, null, { timeout: 180000 });
  // The app's first explicit capture-mode tick already calls __bxlGpuIdle()
  // and hides the loading overlay when that submission callback resolves.
  // Calling it again from Playwright duplicates the synchronization and can
  // stall the CDP evaluation even after the first frame was submitted.
  console.log('[browser-scenes] Capture API ready; waiting for first-frame loading overlay dismissal');
  await page.waitForFunction(() => document.getElementById('loading-overlay')?.classList.contains('hidden'), null, { timeout: 60000 });

  const settleFrame = async (label) => {
    console.log(`[browser-scenes] Settling ${label} camera and HUD`);
    await withTimeout(page.evaluate(async () => {
      // Teleports snap the camera. Five fixed steps refresh the HUD/location telemetry
      // without flooding SwiftShader's CPU-backed command queue with redundant frames.
      // The subsequent readPixels call is the synchronization point for WebGL capture.
      for (let i = 0; i < 5; i++) window.__bxlTick(0.05);
      // Submit the small fixed-step batch, then synchronize once rather than
      // waiting between frames (which adds avoidable round-trips in SwiftShader).
      await window.__bxlGpuIdle();
    }), 120000, `Frame settling for ${label}`);
  };
  await settleFrame('default street');

  await page.waitForFunction(() => {
    const plate = document.querySelector('#hud-location .bxl-plate');
    return !!plate && plate.textContent.trim().length > 0;
  }, null, { timeout: 20000 });

  const capture = async (name) => {
    const file = path.join(outputDir, `${name}.png`);
    const contextInfo = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas-container canvas');
      const gl = window.__bxl.renderer.backend.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        contextAttributes: gl.getContextAttributes(),
        version: gl.getParameter(gl.VERSION),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        contextLost: gl.isContextLost()
      };
    });
    diagnostics.push({ name, ...contextInfo });
    console.log(`[browser-scenes] Capturing ${name} with the browser compositor`);
    await withTimeout(
      page.screenshot({ path: file, fullPage: false, animations: 'disabled', timeout: 60000 }),
      90000,
      `Viewport screenshot for ${name}`
    );
    const stat = await fs.stat(file);
    if (stat.size < 15000) throw new Error(`Screenshot ${name} looks unexpectedly small (${stat.size} bytes)`);
    captures.push({
      name,
      file: path.relative(process.cwd(), file),
      bytes: stat.size,
      viewport: page.viewportSize(),
      canvas: contextInfo
    });
    console.log(`[browser-scenes] Captured ${name} (${stat.size} bytes)`);
  };

  await capture('brussels-default-street');

  const views = [
    ['grand-place', 'grandPlace'],
    ['mont-des-arts', 'montDesArts'],
    ['palais-de-justice', 'palaisDeJustice'],
    ['cinquantenaire', 'cinquantenaire']
  ];

  for (const [name, locationId] of views) {
    await page.evaluate(async (id) => {
      const { TELEPORT_LOCATIONS } = await import('./js/city-config.js');
      const destination = TELEPORT_LOCATIONS[id];
      if (!destination) throw new Error(`Missing Brussels teleport location: ${id}`);
      window.__bxl.teleportTo(destination.x, destination.z, destination.heading);
      window.__bxl.selectCamera('chase', true);
    }, locationId);
    await settleFrame(name);
    await capture(name);
  }

  await page.evaluate(async () => {
    const { TELEPORT_LOCATIONS } = await import('./js/city-config.js');
    const destination = TELEPORT_LOCATIONS.grandPlace;
    window.__bxl.teleportTo(destination.x, destination.z, destination.heading);
    window.__bxl.selectCamera('chase', true);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await settleFrame('mobile Grand-Place');
  await capture('brussels-mobile-grand-place');

  const metadata = {
    commit: process.env.GITHUB_SHA || null,
    browser: browser.version(),
    renderer: 'three.js WebGL fallback (headless Chromium / SwiftShader)',
    url: appUrl.href,
    viewport,
    captures,
    diagnostics,
    errors
  };
  if (errors.length) {
    metadata.failure = `Browser reported ${errors.length} error(s)`;
    await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
    throw new Error(`${metadata.failure}:\n${JSON.stringify(errors, null, 2)}`);
  }
  await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(`[browser-scenes] Successfully captured ${captures.length} rendered Brussels views.`);
} catch (error) {
  await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify({
    commit: process.env.GITHUB_SHA || null,
    browser: browser.version(),
    renderer: 'three.js WebGL fallback (headless Chromium / SwiftShader)',
    captures,
    diagnostics,
    errors,
    failure: { name: error.name, message: error.message, stack: error.stack }
  }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
}
