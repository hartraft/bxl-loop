#!/usr/bin/env python3
"""Integration test for the Brussels DTM GeoTIFF -> local Float32 grid importer."""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
BOUNDS = (50.815, 4.305, 50.875, 4.405)


def main():
    to_lambert = Transformer.from_crs("EPSG:4326", "EPSG:3812", always_xy=True)
    south, west, north, east = BOUNDS
    corners = [to_lambert.transform(lon, lat) for lon, lat in [(west, south), (west, north), (east, south), (east, north)]]
    xs, ys = zip(*corners)
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    source_res = 20.0
    left, top = xmin - 200, ymax + 200
    width = math.ceil((xmax - xmin + 400) / source_res)
    height = math.ceil((ymax - ymin + 400) / source_res)
    rr, cc = np.mgrid[0:height, 0:width]
    xx = left + (cc + 0.5) * source_res
    yy = top - (rr + 0.5) * source_res
    elevation = (100 + (xx - xmin) * 0.001 + (yy - ymin) * 0.001).astype(np.float32)

    with tempfile.TemporaryDirectory(prefix="brussels-dtm-test-") as temp:
        temp = Path(temp)
        source = temp / "synthetic-dtm.tif"
        output = temp / "terrain"
        with rasterio.open(
            source, "w", driver="GTiff", width=width, height=height, count=1,
            dtype="float32", crs="EPSG:3812",
            transform=Affine(source_res, 0, left, 0, -source_res, top), nodata=-9999,
        ) as dst:
            dst.write(elevation, 1)

        subprocess.run([
            sys.executable, str(ROOT / "tools/prepare-brussels-terrain.py"),
            str(source), "--resolution", "100", "--output", str(output),
        ], check=True, cwd=ROOT)

        metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
        data = np.fromfile(output / metadata["dataFile"], dtype="<f4")
        assert metadata["format"] == "float32-le"
        assert metadata["sourceCrs"] == "EPSG:3812"
        assert data.size == metadata["width"] * metadata["height"]
        valid = data[data != metadata["noData"]]
        assert valid.size > 0, "expected valid elevation samples"
        assert np.all(np.isfinite(valid))
        assert float(valid.min()) > 90 and float(valid.max()) < 140
        print(f"Terrain importer integration passed: {metadata['width']}x{metadata['height']}, {valid.size} valid cells")


if __name__ == "__main__":
    main()
