# Browser-rendered scene screenshots

The GitHub Pages deployment workflow captures the built Brussels site's WebGL drawing buffer in Chromium before publishing it. It exports the preserved canvas directly rather than asking Chromium's compositor to read back a WebGL surface.

## What is captured

- Desktop default street-level view (1600 × 900 CSS viewport; 1200 × 675 PNG)
- Grand-Place
- Mont des Arts
- Palais de Justice / Place Poelaert
- Cinquantenaire
- Mobile Grand-Place view (390 × 844 CSS viewport; 292 × 633 PNG)

The runner uses the same built HTML, JavaScript, generated map data and terrain assets that are staged for Pages. It drives the existing in-game teleport API rather than relying on screen-coordinate clicks.

## CI artifacts

Each successful or failed screenshot step attempts to upload a `brussels-browser-screenshots-<commit-sha>` artifact containing PNGs and `metadata.json`. Open the corresponding GitHub Actions run and download the artifact to inspect the rendered views. The metadata records the commit, Chromium version, viewport, renderer and captured files.

The CI browser uses three.js' WebGL fallback with SwiftShader at a 0.75 drawing-buffer scale to keep CPU rendering bounded. Capture mode preserves the WebGL drawing buffer and disables expensive dynamic shadows only for CI. The runner exports the rendered scene canvas as PNG through chunked browser-console messages; this avoids Chromium's `Page.captureScreenshot` failure on the software-rendered WebGL surface. These PNGs show the 3D scene (not the HTML HUD). The real city geometry, materials, camera, lighting and post-processing are exercised. Normal users continue to get the default WebGPU renderer.

## Run locally

From the repository root, after generating the Brussels map and terrain assets and staging the site in `_site/`:

```sh
npm install --no-save playwright
npx playwright install chromium
python3 -m http.server 4173 --directory _site
```

In another terminal:

```sh
node tools/browser-screenshots.mjs --base-url http://127.0.0.1:4173/
```

Screenshots are written to `artifacts/browser-screenshots/`. The runner fails on page errors, browser console errors, failed same-origin requests, missing renderer readiness, invalid PNG signatures, unexpected image dimensions, suspiciously small files, or an incomplete scene set. Metadata is updated after every successful capture so a failed run still preserves the completed views and diagnostics. The artifact upload is required rather than silently skipped.

These captures are review artifacts, not pixel-diff baselines. Review them for composition, terrain alignment, landmark readability, HUD labels and obvious rendering regressions. Geometry and coordinate tests remain separate and continue to run.
