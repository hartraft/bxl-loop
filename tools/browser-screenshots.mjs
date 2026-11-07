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

  const settleFrame = async () => page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      window.__bxlTick(1 / 30);
      await window.__bxlGpuIdle();
    }
  });
  await settleFrame();

  await page.waitForFunction(() => {
    const plate = document.querySelector('#hud-location .bxl-plate');
    return !!plate && plate.textContent.trim().length > 0;
  }, null, { timeout: 20000 });

  const capture = async (name) => {
    const file = path.join(outputDir, `${name}.png`);
    // Capture only after deterministic frame stepping and GPU queue completion.
    await page.screenshot({ path: file, fullPage: false, animations: 'disabled', timeout: 60000 });
    const stat = await fs.stat(file);
    if (stat.size < 15000) throw new Error(`Screenshot ${name} looks unexpectedly small (${stat.size} bytes)`);
    captures.push({ name, file: path.relative(process.cwd(), file), bytes: stat.size, viewport: page.viewportSize() });
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
    await settleFrame();
    await capture(name);
  }

  await page.evaluate(async () => {
    const { TELEPORT_LOCATIONS } = await import('./js/city-config.js');
    const destination = TELEPORT_LOCATIONS.grandPlace;
    window.__bxl.teleportTo(destination.x, destination.z, destination.heading);
    window.__bxl.selectCamera('chase', true);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await settleFrame();
  await capture('brussels-mobile-grand-place');

  await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify({
    commit: process.env.GITHUB_SHA || null,
    browser: browser.version(),
    renderer: 'three.js WebGL fallback (headless Chromium / SwiftShader)',
    url: appUrl.href,
    viewport,
    captures,
    errors
  }, null, 2) + '\n');

  if (errors.length) {
    throw new Error(`Browser reported ${errors.length} error(s):\n${JSON.stringify(errors, null, 2)}`);
  }
  console.log(`[browser-scenes] Successfully captured ${captures.length} rendered Brussels views.`);
} finally {
  await browser.close();
}
