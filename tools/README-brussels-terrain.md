# Brussels terrain data workflow

The Brussels runtime supports an optional compact Float32 elevation grid. The grid is intentionally **not enabled or checked in** until the numeric source export, horizontal CRS, vertical datum, nodata behaviour and landmark checkpoints have been verified.

## Approved source candidate

Use the Brussels Mobility **DTM res: 1m** dataset, published by Paradigm:

- Dataset record: https://data.mobility.brussels/fr/info/511c6314-7144-4223-9bda-725e06b9f60a/
- Licence: CC0
- Attribution retained in generated metadata: Paradigm / Brussels Mobility
- Advertised raster layer: `Urbis:Urbis:Altitude2019` (GeoServer preview also shows `urbisgrid:Altitude2019`)

Do not substitute NGI's DTM 5m or national DTM 1m: their specific records carry restrictive terms. Do not use a WMS PNG/hillshade as numeric elevation data.

## Download and bake

From the repository root, with Python 3.12 and network access:

```bash
python -m pip install -r tools/requirements-terrain.txt
python tools/download-brussels-dtm.py --output /tmp/brussels-dtm-wcs.tif
python tools/prepare-brussels-terrain.py /tmp/brussels-dtm-wcs.tif --resolution 5
```

The downloader probes the workspace-scoped GeoServer endpoint `https://geoservices-urbis.irisnet.be/geoserver/urbisgrid/wcs` (the root `/geoserver/wcs` endpoint returns `No workspace specified`), discovers the Altitude2019 coverage from WCS 1.0.0 GetCapabilities, and requests a numeric GeoTIFF covering the playable area in EPSG:31370. CI now downloads a 5 m numeric GeoTIFF, bakes the browser grid, and checks elevation samples at Grand-Place, Mont des Arts, Parc de Bruxelles, Palais de Justice and Cinquantenaire. The generated grid is uploaded as a 14-day GitHub Actions artifact for review; it remains out of Git and out of the public Pages site until the runtime surfaces are all terrain-conformed and visually reviewed. If the service does not advertise WCS 1.0.0, inspect its GetCapabilities response and adapt the protocol/coverage identifier rather than guessing. The output GeoTIFF's CRS is read by rasterio; the importer transforms the grid into the game's local x/z frame.

The importer writes:

- `data/brussels-terrain/heightmap.f32` — little-endian Float32 metres
- `data/brussels-terrain/metadata.json` — dimensions, cell size, local origin, source CRS, vertical datum and attribution

## Runtime integration status

The vertical reference is now explicit: `createTerrainSurface()` normalizes Belgian zero-D heights so Grand-Place is scene y=0, and applies a 250 m smooth fade at the grid boundary. The optional surface is exposed through `WORLD.terrainSurfaceHeight(x, z)`.

When the optional grid is present, the current terrain-aware geometry path provides:

- Base ground mesh sampled on a 50 m grid, with slope-derived vertex normals.
- At-grade road / path ribbons sampled along their centre lines at up to 25 m spacing; authored bridge deck profiles remain unchanged. The traffic and pedestrian road network also carries sampled terrain elevations through its lanes, derived pavements and crossings.
- Park and plaza polygons subdivided into a shared terrain-following triangle lattice (up to 50 m spacing).
- Building upper geometry remains anchored at the footprint centroid, while ground-level wall bottoms are graded independently at every footprint-edge endpoint; ground-level collider bottoms use the lowest sampled footprint-edge elevation. Elevated buildings and party-wall cuts retain their authored clearances.
- Landmark roots and world ground-height queries use the scene-relative terrain surface.
- Mapped and scattered trees, park benches and pedestrian-street bollards use the shared ground-height query; kerbside street furniture continues to use the terrain-aware pavement strips.

This is a staged integration. The validated DTM is generated and published by the Pages deployment workflow. Building wall bases are subdivided to <=10 m along ground-level footprint edges, and the Palais de Justice and Mont des Arts podiums have sampled retaining skirts. Building colliders now sample the complete footprint perimeter at <=10 m intervals (including between OSM corners) so their lower bounds cannot float over a terrain hollow. This does not replace rendered review of entrances, arcades, passages, podiums and terrace transitions.

## Remaining validation gates for terrain completeness

1. Confirm the GeoTIFF opens as a numeric raster and its CRS is correct.
2. Confirm its vertical reference is Belgian zero-D / Uccle orthometric height; do not infer this from the horizontal CRS.
3. Check nodata percentage, min/max and coverage. Values must be plausible for Brussels and the file must cover Grand-Place, Mont des Arts, Parc de Bruxelles / Royal Palace, Palais de Justice and Cinquantenaire.
4. Record sampled elevations at those locations and along the Grand-Place → Mont des Arts → Parc Royal route. Inspect the climb profile for axis/sign mistakes and abrupt discontinuities.
5. Visually verify large building foundations, entrances, arcades, podiums and retaining walls against the already-published terrain.
6. Establish the canal / river water-surface elevation in the same Belgian vertical datum before changing WATER_LEVEL. Port of Brussels publishes variable canal depths (2.5–5.8 m by section), not an absolute water-surface altitude; Flowbru is the authoritative next data source for surface-water level observations, but a suitable canal station and its vertical reference must be confirmed. Do not derive water-surface Y from depth alone.
7. Render and visually inspect the city, especially Grand-Place, Mont des Arts, Place Poelaert, the canal banks, bridges and the transition at the DTM coverage edge. Capture repeatable screenshots and inspect them; a passing build is not a substitute for visual review.

The runtime still falls back to the existing flat ground if the optional asset is absent. The public Pages build includes the generated grid. Keep the water surface and quay geometry on their existing conservative scene levels until a canal-specific absolute water level with a documented datum is verified; do not infer it from channel depth or from a sensor whose reference elevation is missing.

## Hydrographic datum decision (2026-11-19)

Hydria reports that FLOWBRU has 25 stations measuring surface-water level/flow and five-minute telemetry, but the public network summary does not identify a canal station with a published absolute level and vertical reference: https://hydria.be/flowbru/. The FLOWBRU Senne Buda station (N02) reports a calculated Senne level in mDNG, but it is on the Senne at the regional boundary, not the Brussels–Charleroi canal: https://hydria.be/wp-content/uploads/2024/09/N02-Senne-Buda.pdf. The available Percke sheet publishes an absolute basin level, but that is a stormwater basin in Uccle, not surface water in the canal: https://hydria.be/wp-content/uploads/2025/06/C14-DO21-BO-Percke.pdf.

Therefore neither is a valid calibration for the canal. Keep the current Brussels water plane and quay tops unchanged until Hydria confirms a canal/lock/bief gauge, its surveyed sensor zero in mDNG, and the conversion to the DTM's Belgian zero-D reference. HIC water-level data are explicitly referenced to 0 m TAW, but that does not establish that an arbitrary HIC station represents the Brussels canal: https://hicws.vlaanderen.be/.
