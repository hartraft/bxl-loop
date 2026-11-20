# Browser-rendered Brussels scene review

The `Brussels rendered-scene screenshots` workflow builds the current pull-request source with the same Brussels OSM data and validated 5 m terrain grid used by the Pages build. It serves that staged site locally and captures six real browser views:

- Default street-level view
- Grand-Place
- Mont des Arts
- Palais de Justice
- Cinquantenaire
- Mobile Grand-Place (390 × 844 CSS pixels)

The workflow is deliberately separate from Pages deployment. It has `contents: read` permission only, runs on pull requests targeting `main`, and never configures or deploys GitHub Pages. The production deployment workflow remains restricted to pushes to `main`.

## Capture implementation

The capture runner launches a fresh Chromium process for each view, uses the app's own deterministic capture API and existing Brussels teleport coordinates, then saves the browser viewport as a PNG. The software WebGL path uses a conventional depth buffer because SwiftShader does not reliably provide the clip-control support needed by reversed depth. The mobile view sends a harmless touch pointer event and asserts that the touch-specific HUD is visible before capture. Chromium runs under Xvfb; if the DevTools screenshot API fails, the runner captures the X11 display front buffer instead. The application keeps its normal WebGPU, post-processing and shadow path for interactive users. Only `?capture&webgl` uses the WebGL2 fallback, half-resolution drawing buffer, no shadow-map updates, and a direct scene render without the SSR/Bloom intermediate render targets. Capture mode skips the large parallel shader-precompile sweep and advances the simulation in fixed steps so it does not overwhelm software rendering.

Each run uploads `metadata.json` and every PNG completed before a failure. Metadata records the commit, Chromium version, renderer path, expected scenes, viewport dimensions, image hashes, browser diagnostics and per-scene failures. The runner rejects missing scenes, invalid or undersized PNGs, incorrect dimensions, browser errors, a missing canvas/loading overlay, repeated desktop images, and black/near-empty central viewports (checked using decoded pixel colour and edge detail).

The workflow is wired into the main-branch PR checks so the implementation is exercised with the same workflow definition that future Brussels PRs will use.

These are review captures, not pixel-diff baselines. A passing workflow proves that all six browser captures were produced and passed basic integrity checks; it does not replace a human visual review of landmark framing, terrain alignment, 3D scene detail and the mobile HUD.

## Local reproduction

After staging the site as `_site/` with the generated Brussels geodata and terrain assets:

```sh
npm install --no-save playwright
npx playwright install chromium
sudo apt-get install -y imagemagick x11-apps xvfb
python3 -m http.server 4173 --directory _site
```

In another terminal:

```sh
xvfb-run --auto-servernum --server-args='-screen 0 1600x1000x24 -ac +extension GLX +render -noreset' node tools/browser-screenshots.mjs --base-url http://127.0.0.1:4173/
```

The images and metadata are written to `artifacts/browser-screenshots/`.
