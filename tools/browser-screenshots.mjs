import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { deflateSync } from 'node:zlib';
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

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
};
const encodeRgbaPng = (width, height, pixels) => {
  const rowBytes = width * 4;
  if (!width || !height || pixels.length !== rowBytes * height) {
    throw new Error('Invalid WebGL pixel buffer: ' + width + 'x' + height + ', ' + pixels.length + ' bytes');
  }
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const target = y * (rowBytes + 1);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, (height - 1 - y) * rowBytes, (height - y) * rowBytes);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
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
      // Teleports snap the camera. Five fixed steps refresh the HUD/location telemetry
      // without flooding SwiftShader's CPU-backed command queue with redundant frames.
      // The subsequent readPixels call is the synchronization point for WebGL capture.
      for (let i = 0; i < 5; i++) {
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

    // Read the WebGL default framebuffer directly. Chromium's canvas encoders can
    // stall indefinitely with SwiftShader even after the renderer's GPU queue is idle.
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
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        contextLost: gl.isContextLost()
      };
    });
    diagnostics.push({ name, ...contextInfo });
    console.log('[browser-scenes] Reading ' + name + ' WebGL framebuffer at ' + contextInfo.width + 'x' + contextInfo.height);
    const readback = await withTimeout(page.evaluate(async () => {
      const canvas = document.querySelector('#canvas-container canvas');
      const gl = window.__bxl.renderer.backend.getContext();
      if (gl.isContextLost()) throw new Error('WebGL context was lost before pixel readback');
      const width = canvas.width;
      const height = canvas.height;
      // A WebGL fence can remain unsignalled indefinitely on headless SwiftShader,
      // even after the renderer reports its queue idle. readPixels performs the
      // required synchronization itself; keep it inside the outer Playwright timeout.
      const pixels = new Uint8Array(width * height * 4);
      gl.flush();
      const previousReadFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      try {
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      } finally {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);
      }
      const glError = gl.getError();
      if (glError !== gl.NO_ERROR) {
        throw new Error('WebGL readPixels failed with error 0x' + glError.toString(16));
      }
      let binary = '';
      for (let offset = 0; offset < pixels.length; offset += 0x8000) {
        binary += String.fromCharCode(...pixels.subarray(offset, offset + 0x8000));
      }
      return { width, height, rgbaBase64: btoa(binary), glError };
    }), 90000, 'WebGL pixel readback for ' + name);
    const rgba = Buffer.from(readback.rgbaBase64, 'base64');
    const canvasBytes = encodeRgbaPng(readback.width, readback.height, rgba);
    if (readback.glError !== 0) diagnostics.push({ name, webglError: readback.glError });
    if (canvasBytes.length < 15000) {
      throw new Error('WebGL capture for ' + name + ' looks unexpectedly small (' + canvasBytes.length + ' bytes)');
    }
    await fs.writeFile(canvasFile, canvasBytes);
    const dataUrl = 'data:image/png;base64,' + canvasBytes.toString('base64');
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
