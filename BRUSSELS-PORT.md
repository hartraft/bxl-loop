# Brussels Loop port plan

This repository is being adapted from the London Loop codebase into a playable, 1:1-scale Brussels city.

## Current state

The current game code and baked geodata are still London-specific. Do not treat the app as a Brussels build until new Brussels OSM data has been generated and the world frame, map, landmarks and traffic have been switched together.

## Work plan

### 1. Brussels world and data pipeline
- Set the world origin near Grand-Place and define a bounded play area covering central Brussels first.
- Create a Brussels OSM extraction and bake pipeline based on the existing dependency-free London pipeline.
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
- GitHub Issues are disabled for this repository, so this file is the living implementation checklist until issue tracking is enabled.
