#!/usr/bin/env python3
"""Validate a baked Brussels DTM grid and report elevations at five landmark checkpoints."""
import json
import math
import sys
from pathlib import Path

import numpy as np

LAT0, LON0 = 50.84673, 4.35247
M_PER_DEG_LAT = 111132.92 - 559.82 * math.cos(math.radians(2 * LAT0)) + 1.175 * math.cos(math.radians(4 * LAT0))
M_PER_DEG_LON = 111412.84 * math.cos(math.radians(LAT0)) - 93.5 * math.cos(math.radians(3 * LAT0))
POINTS = {
    "Grand-Place": (50.84670, 4.35250),
    "Mont des Arts": (50.84280, 4.35765),
    "Parc de Bruxelles": (50.84380, 4.36200),
    "Palais de Justice": (50.83665, 4.35175),
    "Cinquantenaire": (50.84130, 4.39180),
}


def sample(values, meta, lat, lon):
    x = (lon - LON0) * M_PER_DEG_LON
    z = -(lat - LAT0) * M_PER_DEG_LAT
    gx = (x - meta["minX"]) / meta["cellSize"] - 0.5
    gz = (z - meta["minZ"]) / meta["cellSize"] - 0.5
    if gx < 0 or gz < 0 or gx > meta["width"] - 1 or gz > meta["height"] - 1:
        raise ValueError(f"checkpoint ({lat}, {lon}) lies outside baked grid")
    x0, z0 = int(math.floor(gx)), int(math.floor(gz))
    x1, z1 = min(meta["width"] - 1, x0 + 1), min(meta["height"] - 1, z0 + 1)
    tx, tz = gx - x0, gz - z0
    cells = (
        (z0 * meta["width"] + x0, (1 - tx) * (1 - tz)),
        (z0 * meta["width"] + x1, tx * (1 - tz)),
        (z1 * meta["width"] + x0, (1 - tx) * tz),
        (z1 * meta["width"] + x1, tx * tz),
    )
    total = weight = 0.0
    for index, w in cells:
        value = float(values[index])
        if w > 0 and math.isfinite(value) and abs(value - meta.get("noData", -9999)) > 1e-5:
            total += value * w
            weight += w
    if weight <= 0:
        raise ValueError(f"checkpoint ({lat}, {lon}) contains only nodata cells")
    return total / weight


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: validate-brussels-dtm.py <baked-terrain-directory>")
    root = Path(sys.argv[1])
    meta = json.loads((root / "metadata.json").read_text())
    values = np.fromfile(root / meta["dataFile"], dtype="<f4")
    if values.size != meta["width"] * meta["height"]:
        raise SystemExit("terrain binary size does not match metadata")
    nodata = meta.get("noData", -9999)
    valid = values[np.isfinite(values) & (np.abs(values - nodata) > 1e-5)]
    if valid.size < values.size * 0.98:
        raise SystemExit(f"DTM coverage too sparse: {valid.size}/{values.size} valid cells")
    if valid.size == 0 or float(valid.min()) < -5 or float(valid.max()) > 250:
        raise SystemExit(f"implausible Brussels elevations: {float(valid.min())}..{float(valid.max())} m")
    print(f"Grid: {meta['width']} x {meta['height']} at {meta['cellSize']} m; valid {valid.size}/{values.size}")
    print(f"Elevation range: {float(valid.min()):.2f}..{float(valid.max()):.2f} m; mean {float(valid.mean()):.2f} m")
    elevations = {}
    for name, (lat, lon) in POINTS.items():
        value = sample(values, meta, lat, lon)
        if not 0 <= value <= 150:
            raise SystemExit(f"implausible {name} elevation: {value:.2f} m")
        elevations[name] = round(value, 2)
    print("Landmark checkpoints (Belgian zero-D / Uccle orthometric metres):")
    for name, value in elevations.items():
        print(f"  {name}: {value:.2f} m")
    if elevations["Mont des Arts"] < elevations["Grand-Place"] + 5:
        raise SystemExit("Mont des Arts should be materially higher than Grand-Place; check axis/datum/resampling")
    print("Brussels DTM checkpoint validation passed")


if __name__ == "__main__":
    main()
