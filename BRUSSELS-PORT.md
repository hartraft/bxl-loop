# Brussels Loop port plan

This repository is being adapted from the London Loop codebase into a playable, 1:1-scale Brussels city.

## Current state

The current game runtime and baked data remain London-specific. The build pipeline can now select the Brussels coordinate frame without changing the default runtime frame. Do not treat the app as a playable Brussels build until fresh data is generated and the runtime, map, landmarks and traffic are switched together.

## Work plan

### 1. Brussels world and data pipeline
- Set the world origin near Grand-Place and define a bounded play area covering central Brussels first.
- Added `tools/build-brussels-geodata.mjs`: extracts a central Brussels bbox from a local Belgium OSM PBF and bakes `brx-geo.json` + `brx-buildings.bin` using the Brussels frame.
- The existing `js/geo-frame.js` keeps London as the default; `CITY=brussels` selects Brussels only for the Node-side bake process.
- Local build: `mkdir -p tools/data && curl -L https://download.geofabrik.de/europe/belgium-latest.osm.pbf -o tools/data/belgium-latest.osm.pbf && node --max-old-space-size=12000 tools/build-brussels-geodata.mjs`.
- The Belgium PBF is large; the extraction reads the PBF and can require substantial memory. Pass an existing PBF and output directory as arguments to the build script if needed.
- Generate fresh road, building, water, park, rail/tram and landmark-zone data. Never ship the London baked files under a Brussels label.
- Preserve OSM attribution and ODbL requirements.

### 2. Gameplay and local identity
- Replace landmark anchors and builders with Grand-Place, Manneken Pis, Mont des Arts, Royal Palace, St Michael and St Gudula Cathedral, Palais de Justice, Cinquantenaire and European Parliament; add Atomium and Koekelberg Basilica if included in the play area.
- Switch to right-hand traffic and account for Belgian roundabouts, tram tracks, crossings and road markings.
- Adapt vehicles, route/job mode, sounds, signs and street furniture to Brussels without copying real operator branding.
- Keep the existing control modes, cameras, map/GPS routing, time/weather, pedestrians and offline fallback where feasible.

### 3. Validation and publishing
- Add tests for the Brussels frame, landmarks, OSM bounds and baked-data integrity.
- Add small sandbox pages for visual checks and test module loading.
- Ensure GitHub Actions builds/tests the static site and deploys the correct branch to GitHub Pages.
- Publish only after the default spawn and map demonstrably show Brussels.

## Acceptance criteria
1. Spawn and default camera are in central Brussels.
2. Roads/buildings/parks/water are derived from Brussels OSM data and aligned at 1 unit = 1 metre.
3. Landmark locations and teleport points are Brussels-specific.
4. Vehicles use right-hand traffic.
5. No fatal module errors; automated checks pass.
6. GitHub Pages serves the validated Brussels build.

## Repository notes
- Feature branch: `feat/brussels-world-port`
- Tracking issue: [#3 — Port London Loop into a playable Brussels city](https://github.com/hartraft/bxl-loop/issues/3)
- Current CI checks validate the frame and build-script syntax; they do not yet download OSM data, generate the full map, or test the browser runtime.
