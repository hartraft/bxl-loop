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

This is a staged integration, not yet approval to publish the DTM asset. Foundation wall bases now conform to sampled terrain along each footprint edge, but broad podiums and complex large-building interiors may still need explicit plinths or retaining structures. Water levels and embankments need a separate hydrographic datum decision, and all secondary details must be checked against the terrain. The public build remains flat because the generated DTM files are not committed.

## Validation gate before publishing the terrain asset

1. Confirm the GeoTIFF opens as a numeric raster and its CRS is correct.
2. Confirm its vertical reference is Belgian zero-D / Uccle orthometric height; do not infer this from the horizontal CRS.
3. Check nodata percentage, min/max and coverage. Values must be plausible for Brussels and the file must cover Grand-Place, Mont des Arts, Parc de Bruxelles / Royal Palace, Palais de Justice and Cinquantenaire.
4. Record sampled elevations at those locations and along the Grand-Place → Mont des Arts → Parc Royal route. Inspect the climb profile for axis/sign mistakes and abrupt discontinuities.
5. Grade large building foundations and resolve water / embankment heights before adding the generated asset to the public Pages build.
6. Establish the canal / river water-surface elevation in the same Belgian vertical datum before changing WATER_LEVEL. Port of Brussels publishes variable canal depths (2.5–5.8 m by section), not an absolute water-surface altitude; Flowbru is the authoritative next data source for surface-water level observations, but a suitable canal station and its vertical reference must be confirmed. Do not derive water-surface Y from depth alone.
7. Render and visually inspect the city, especially Grand-Place, Mont des Arts, Place Poelaert, the canal banks, bridges and the transition at the DTM coverage edge.

The runtime still falls back to the existing flat ground if the optional asset is absent. Keep the generated grid out of Git and Pages until the remaining integration and rendered review are complete.
