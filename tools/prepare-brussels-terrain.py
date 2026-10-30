#!/usr/bin/env python3
"""Prepare the Brussels Mobility CC0 DTM GeoTIFF as a compact local-world grid.

Usage:
  python3 tools/prepare-brussels-terrain.py source-dtm.tif [--resolution 5]

Dependencies: numpy, rasterio, pyproj. The input must be a numeric DTM raster (not a WMS-rendered PNG).
The output is data/brussels-terrain/heightmap.f32 plus metadata.json. Float32 values are metres above Belgian
zero-D (Uccle); the output grid is aligned to the Brussels Loop local x/z frame.
"""
import argparse
import json
import math
import os
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[1]
LAT0, LON0 = 50.84673, 4.35247
M_PER_DEG_LAT = 111132.92 - 559.82 * math.cos(math.radians(2 * LAT0)) + 1.175 * math.cos(math.radians(4 * LAT0))
phi = math.radians(LAT0)
M_PER_DEG_LON = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
BOUNDS = {"south": 50.815, "west": 4.305, "north": 50.875, "east": 4.405}


def world(lat, lon):
    return ((lon - LON0) * M_PER_DEG_LON, -(lat - LAT0) * M_PER_DEG_LAT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="numeric source DTM GeoTIFF")
    parser.add_argument("--resolution", type=float, default=5.0, help="output grid spacing in metres (default: 5)")
    parser.add_argument("--output", type=Path, default=ROOT / "data/brussels-terrain")
    args = parser.parse_args()
    if args.resolution <= 0:
        parser.error("--resolution must be positive")
    if not args.source.is_file():
        parser.error(f"source raster not found: {args.source}")

    sw = world(BOUNDS["south"], BOUNDS["west"])
    ne = world(BOUNDS["north"], BOUNDS["east"])
    min_x, max_x = sw[0], ne[0]
    min_z, max_z = ne[1], sw[1]
    cell = args.resolution
    width = math.ceil((max_x - min_x) / cell)
    height = math.ceil((max_z - min_z) / cell)

    with rasterio.open(args.source) as src:
        if src.crs is None:
            raise SystemExit("Source DTM has no CRS; refusing to guess its coordinate system")
        if src.count < 1:
            raise SystemExit("Source DTM contains no raster bands")
        to_source = Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
        # Transform the four geographic corners to find a small source window.
        corners = [
            to_source.transform(BOUNDS["west"], BOUNDS["south"]),
            to_source.transform(BOUNDS["west"], BOUNDS["north"]),
            to_source.transform(BOUNDS["east"], BOUNDS["south"]),
            to_source.transform(BOUNDS["east"], BOUNDS["north"]),
        ]
        xs, ys = zip(*corners)
        pad = max(abs(src.res[0]), abs(src.res[1])) * 4
        win = from_bounds(min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad, src.transform)
        win = win.round_offsets().round_lengths()
        raster = src.read(1, window=win, masked=False).astype(np.float32, copy=False)
        transform = src.window_transform(win)
        inv = ~transform
        nodata = src.nodata
        out = np.full((height, width), -9999.0, dtype="<f4")

        # Chunk rows to keep memory bounded while preserving exact alignment with the game's equirectangular frame.
        for row0 in range(0, height, 128):
            row1 = min(height, row0 + 128)
            rr, cc = np.mgrid[row0:row1, 0:width]
            wx = min_x + (cc + 0.5) * cell
            wz = min_z + (rr + 0.5) * cell
            lon = LON0 + wx / M_PER_DEG_LON
            lat = LAT0 - wz / M_PER_DEG_LAT
            sx, sy = to_source.transform(lon, lat)
            sc = inv.a * sx + inv.b * sy + inv.c - 0.5
            sr = inv.d * sx + inv.e * sy + inv.f - 0.5
            c0 = np.floor(sc).astype(np.int64)
            r0 = np.floor(sr).astype(np.int64)
            tx, ty = sc - c0, sr - r0
            valid = (c0 >= 0) & (r0 >= 0) & (c0 + 1 < raster.shape[1]) & (r0 + 1 < raster.shape[0])
            safe_c = np.clip(c0, 0, max(0, raster.shape[1] - 2))
            safe_r = np.clip(r0, 0, max(0, raster.shape[0] - 2))
            vals = [raster[safe_r, safe_c], raster[safe_r, safe_c + 1], raster[safe_r + 1, safe_c], raster[safe_r + 1, safe_c + 1]]
            weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty]
            total = np.zeros_like(wx, dtype=np.float64)
            weight_sum = np.zeros_like(wx, dtype=np.float64)
            for value, weight in zip(vals, weights):
                ok = np.isfinite(value)
                if nodata is not None:
                    ok &= value != nodata
                w = np.where(ok, weight, 0.0)
                total += np.where(ok, value, 0.0) * w
                weight_sum += w
            valid &= weight_sum > 1e-8
            block = np.full_like(wx, -9999.0, dtype=np.float32)
            block[valid] = (total[valid] / weight_sum[valid]).astype(np.float32)
            out[row0:row1] = block

    args.output.mkdir(parents=True, exist_ok=True)
    data_path = args.output / "heightmap.f32"
    out.tofile(data_path)
    metadata = {
        "format": "float32-le",
        "width": width,
        "height": height,
        "cellSize": cell,
        "minX": min_x,
        "minZ": min_z,
        "noData": -9999,
        "dataFile": "heightmap.f32",
        "verticalDatum": "Belgian zero-D (Uccle), orthometric height",
        "source": "Brussels Mobility DTM res: 1m, Paradigm, CC0",
        "sourceUrl": "https://data.mobility.brussels/fr/info/511c6314-7144-4223-9bda-725e06b9f60a/",
        "sourceCrs": str(src.crs),
        "sourceRaster": args.source.name,
        "attribution": "Source: Paradigm / Brussels Mobility (CC0)",
    }
    (args.output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\\n", encoding="utf-8")
    print(f"Wrote {data_path} ({data_path.stat().st_size:,} bytes)")
    print(f"Grid: {width} x {height} at {cell:g} m; valid cells: {np.count_nonzero(out != -9999):,}/{out.size:,}")
    print("Review metadata, vertical datum and elevation checkpoints before enabling the grid in the runtime.")


if __name__ == "__main__":
    main()
