# Brussels Loop — Unity P0 prototype

This is an **experimental Unity 6 URP sidecar**, not a replacement for the browser build. Its job is to answer one question before a full port is funded: can the existing Brussels OSM dataset become a recognisable, performant Unity scene without losing the city-specific geography?

## P0 scope

The first scene is a 900 m diameter test area centred on Grand-Place:

- Import the existing `brx-geo.json` road network and `brx-buildings.bin` building footprints.
- Preserve the existing Brussels frame: 1 Unity unit = 1 metre; X east, Z south; origin at Grand-Place; Y up.
- Render road ribbons and extruded building masses, with a simple URP daylight setup and a free-fly camera.
- Keep the import radius configurable so the same importer can create a smaller Steam Deck/mobile test.
- Do not import NYC coordinates, Manhattan landmarks, or NYC street furniture.

The Editor importer is deliberately a **greybox**. It does not yet reproduce the web renderer's materials, terrain, landmarks, traffic or actors. Its purpose is to validate the coordinate/data bridge and establish a first measurable Unity scene.

## Generate the source data

From the repository root, use the existing Brussels pipeline (requires the Belgium Geofabrik PBF and sufficient RAM):

```bash
mkdir -p tools/data
curl -fL https://download.geofabrik.de/europe/belgium-latest.osm.pbf -o tools/data/belgium-latest.osm.pbf
node --max-old-space-size=6144 tools/build-brussels-geodata.mjs
node tools/validate-brussels-geodata.mjs data/brussels-build
```

Alternatively run the **Build Brussels geodata** GitHub Actions workflow and download its generated artifact. Extract the two files into a local folder. Do not commit the large generated binaries.

## Open the prototype

1. Install Unity 6 LTS with the **Universal Render Pipeline** and Windows/Linux build modules.
2. Create a new 3D (URP) project, or copy this folder into an existing Unity project under `Assets/BrusselsPrototype`.
3. Add the Newtonsoft JSON package (`com.unity.nuget.newtonsoft-json`) if it is not already present.
4. Copy `Editor/BrusselsP0Importer.cs` under `Assets/BrusselsPrototype/Editor/`.
5. In Unity, choose **Brussels Loop → Import P0 scene**, select `brx-geo.json` and then `brx-buildings.bin`.
6. The importer creates a scene root named `Brussels P0 (greybox)` with roads and building masses inside the configured radius. Add a directional light and a free-fly camera to inspect it.

The importer currently targets a local Editor workflow; it is not a runtime loader and it does not create a distributable player build.

## P0 acceptance gates

- [ ] Grand-Place is at (0, 0, 0) and the imported road/building footprint orientation matches the browser scene.
- [ ] No NYC/London labels, geometry, coordinate frame or landmarks appear.
- [ ] Compare 4 fixed views against browser screenshots: Grand-Place, Rue du Midi/Marolles edge, Mont des Arts, and a wider city view.
- [ ] No missing/NaN geometry; importer reports counts and elapsed time.
- [ ] Establish baseline on the same PC at 1920×1080: average FPS, 1% low, CPU frame time, GPU frame time, draw calls, triangles, memory.
- [ ] Repeat at 1280×800 on Steam Deck hardware before claiming Deck viability.

P0 is successful if the geography imports correctly and the result is fast enough to justify adding detail. It is **not** successful merely because the Editor script compiles.

## Platform strategy

| Target | Feasibility | Recommended role |
|---|---|---|
| Windows PC | High | First playable build and reference performance target |
| Linux PC | High | Build alongside Windows; test Vulkan and OpenGL paths |
| Steam Deck | High/medium | PC build with controller-first UI, 1280×800 profile and 40/60 FPS targets |
| macOS | Medium | Technically supported; validate Metal and asset pipeline later |
| Android | Medium/low for full scene | Separate mobile quality tier, smaller streamed area, baked lighting, lower density |
| Web | Low/medium for this Unity renderer | Unity Web build is possible, but WebGL 2 constraints and memory/download costs make it a separate optimisation effort; keep Three.js as the browser product for now |

Unity 6 supports Windows, Linux, macOS, Android and browser Web builds, but support does not mean equal performance. Steam Deck is a Linux PC target rather than a separate Unity platform. Console targets are deliberately out of scope for P0.

## Proposed milestones

- **P0 — data bridge / greybox:** roads + building masses around Grand-Place; coordinate and import validation.
- **P1 — Brussels look:** DTM terrain, real landmark meshes, Belgian materials/roof profiles, street furniture and tram/road markings.
- **P2 — playable loop:** third-person walking, vehicle driving, right-hand traffic, pedestrians, camera modes and map.
- **P3 — scale:** chunk streaming, LOD, occlusion, instancing, Jobs/Burst where profiling justifies it; expand the playable area.
- **P4 — platform profiles:** Windows/Linux release, Steam Deck controls/performance, then Android experiment. Web remains the existing Three.js edition unless a measured Unity Web build is compelling.

## Data and licensing

The Brussels source remains the existing OSM-derived dataset and its current attribution/ODbL obligations. Keep the OSM attribution visible in any product that uses this data. The prototype contains no third-party art assets. Review the source project's MIT licence and all OSM-derived data obligations before redistributing a build.
