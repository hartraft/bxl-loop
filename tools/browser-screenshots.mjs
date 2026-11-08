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
    if (message.type() === 'error') errors.push({ type: 'console', message: message.text() });
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
  await page.evaluate(async () => { await window.__bxlGpuIdle(); });
  await page.waitForFunction(() => document.getElementById('loading-overlay')?.classList.contains('hidden'), null, { timeout: 60000 });

  const settleFrame = async (label) => {
    console.log(`[browser-scenes] Settling ${label} camera and HUD`);
    await withTimeout(page.evaluate(async () => {
      // 12 maximum-size fixed steps provide 600 ms of camera/HUD settling with fewer
      // expensive SwiftShader renders than 20 smaller steps.
      for (let i = 0; i < 12; i++) {
        window.__bxlTick(0.05);
        await window.__bxlGpuIdle();
      }
    }), 120000, `Frame settling for ${label}`);
  };
  await settleFrame('default street');

  await page.waitForFunction(() => {
    const plate = document.querySelector('#hud-location .bxl-plate');
    return !!plate && plate.textContent.trim().length > 0;
  }, null, { timeout: 20000 });

  const capture = async (name) => {
    const file = path.join(outputDir, `${name}.png`);
    const canvasFile = path.join(outputDir, `${name}-canvas.png`);

    // Export the WebGL drawing buffer directly. Chromium's compositor screenshot
    // path can stall on this large SwiftShader scene, even after the GPU queue is idle.
    console.log(`[browser-scenes] Exporting ${name} canvas at ${page.viewportSize().width}x${page.viewportSize().height}`);
    console.log(`[browser-scenes] Encoding ${name} canvas asynchronously`);
    const dataUrl = await withTimeout(page.evaluate(async () => {
      const canvas = document.querySelector('#canvas-container canvas');
      const gl = window.__bxl.renderer.backend.getContext();
      const attributes = gl?.getContextAttributes();
      if (!attributes?.preserveDrawingBuffer) {
        throw new Error(`WebGL drawing buffer is not preserved: ${JSON.stringify(attributes)}`);
      }
      if (gl.isContextLost()) throw new Error('WebGL context was lost before canvas export');
      // Submit pending work without synchronously blocking Chromium on SwiftShader readback.
      gl.flush();
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error('Canvas.toBlob returned no PNG data'));
        }, 'image/png');
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return `data:image/png;base64,${btoa(binary)}`;
    }), 90000, `Canvas blob export for ${name}`);
    console.log(`[browser-scenes] Canvas export ready for ${name} (${dataUrl.length} data URL characters)`);
    const pngPrefix = 'data:image/png;base64,';
    if (!dataUrl.startsWith(pngPrefix)) throw new Error(`Canvas export for ${name} did not return a PNG data URL`);
    const base64 = dataUrl.slice(pngPrefix.length);
    const canvasBytes = Buffer.from(base64, 'base64');
    if (canvasBytes.length < 15000) {
      throw new Error(`Canvas export for ${name} looks unexpectedly small (${canvasBytes.length} bytes)`);
    }
    await fs.writeFile(canvasFile, canvasBytes);

    // Replace the live WebGL canvas with its already-rendered bitmap just for the
    // viewport capture. This preserves the real DOM HUD while avoiding compositor
    // readback of the software-rendered WebGL surface.
    await page.evaluate((src) => {
      const canvas = document.querySelector('#canvas-container canvas');
      if (!canvas) throw new Error('Rendered canvas disappeared before screenshot');
      const image = document.createElement('img');
      image.id = '__bxl_capture_snapshot';
      image.alt = 'Rendered Brussels scene snapshot';
      image.src = src;
      image.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;z-index:0';
      canvas.style.visibility = 'hidden';
      canvas.parentElement.appendChild(image);
    }, dataUrl);

    try {
      console.log(`[browser-scenes] Compositing ${name} with the DOM HUD`);
      await page.screenshot({ path: file, fullPage: false, animations: 'disabled', timeout: 60000 });
      console.log(`[browser-scenes] Viewport screenshot ready for ${name}`);
    } finally {
      await page.evaluate(() => {
        document.getElementById('__bxl_capture_snapshot')?.remove();
        const canvas = document.querySelector('#canvas-container canvas');
        if (canvas) canvas.style.visibility = '';
      });
    }

    const stat = await fs.stat(file);
    if (stat.size < 15000) throw new Error(`Screenshot ${name} looks unexpectedly small (${stat.size} bytes)`);
    captures.push({
      name,
      file: path.relative(process.cwd(), file),
      bytes: stat.size,
      canvasFile: path.relative(process.cwd(), canvasFile),
      canvasBytes: canvasBytes.length,
      viewport: page.viewportSize()
    });
    console.log(`[browser-scenes] Captured ${name} (${stat.size} bytes; canvas ${canvasBytes.length} bytes)`);
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
    errors,
    failure: { name: error.name, message: error.message, stack: error.stack }
  }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
}
