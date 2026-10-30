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

The downloader probes WCS 1.0.0 GetCapabilities, discovers the Altitude2019 coverage, and requests a numeric GeoTIFF covering the playable area in EPSG:31370. If the service does not advertise WCS 1.0.0, inspect its GetCapabilities response and adapt the protocol/coverage identifier rather than guessing. The output GeoTIFF's CRS is read by rasterio; the importer transforms the grid into the game's local x/z frame.

The importer writes:

- `data/brussels-terrain/heightmap.f32` — little-endian Float32 metres
- `data/brussels-terrain/metadata.json` — dimensions, cell size, local origin, source CRS, vertical datum and attribution

## Validation gate before enabling runtime terrain

1. Confirm the GeoTIFF opens as a numeric raster and its CRS is correct.
2. Confirm its vertical reference is Belgian zero-D / Uccle orthometric height; do not infer this from the horizontal CRS.
3. Check nodata percentage, min/max and coverage. Values must be plausible for Brussels and the file must cover Grand-Place, Mont des Arts, Parc de Bruxelles / Royal Palace, Palais de Justice and Cinquantenaire.
4. Record sampled elevations at those locations and along the Grand-Place → Mont des Arts → Parc Royal route. Inspect the climb profile for axis/sign mistakes and abrupt discontinuities.
5. Only then add the generated asset and enable the terrain mesh. Roads, pavements, plazas, parks, buildings, landmarks, vehicles and pedestrians must be conformed together; bridges, tunnels and stairs retain engineered geometry.

The current runtime deliberately falls back to the existing flat ground if the optional asset is absent. This avoids a half-enabled DEM where roads and buildings float or intersect the terrain.
