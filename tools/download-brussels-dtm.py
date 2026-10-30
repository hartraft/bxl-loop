#!/usr/bin/env python3
"""Download the official Brussels Mobility / Paradigm DTM through GeoServer WCS.

This retrieves numeric GeoTIFF pixels (never a WMS-rendered PNG), then hands the file
to prepare-brussels-terrain.py. Requires rasterio/pyproj only for the bbox transform.
"""
import argparse
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ENDPOINT = "https://geoservices-urbis.irisnet.be/geoserver/wcs"
SOURCE_URL = "https://data.mobility.brussels/fr/info/511c6314-7144-4223-9bda-725e06b9f60a/"
BOUNDS = (4.305, 50.815, 4.405, 50.875)  # west, south, east, north


def local_name(tag):
    return tag.rsplit("}", 1)[-1].split(":")[-1]


def find_text(node, name):
    for child in node.iter():
        if local_name(child.tag) == name and child.text:
            return child.text.strip()
    return None


def discover_coverage(xml_bytes, preferred):
    root = ET.fromstring(xml_bytes)
    candidates = []
    for node in root.iter():
        if local_name(node.tag) not in {"CoverageOfferingBrief", "CoverageSummary"}:
            continue
        name = find_text(node, "name") or find_text(node, "CoverageId") or find_text(node, "Identifier")
        if name:
            candidates.append(name)
    if preferred in candidates:
        return preferred
    matches = [name for name in candidates if "altitude2019" in name.lower()]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise RuntimeError("WCS capabilities did not advertise an Altitude2019 coverage. Advertised: " + ", ".join(candidates[:30]))
    raise RuntimeError("Multiple Altitude2019 coverages found; pass --coverage explicitly: " + ", ".join(matches))


def request_bytes(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "bxl-loop-terrain-baker/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def build_wcs10_url(endpoint, coverage, bbox, width, height, crs):
    params = {
        "SERVICE": "WCS", "VERSION": "1.0.0", "REQUEST": "GetCoverage",
        "COVERAGE": coverage, "CRS": crs,
        "BBOX": ",".join(f"{v:.3f}" for v in bbox),
        "WIDTH": str(width), "HEIGHT": str(height), "FORMAT": "GeoTIFF",
    }
    return endpoint + ("&" if "?" in endpoint else "?") + urllib.parse.urlencode(params)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default=ENDPOINT, help="GeoServer WCS endpoint")
    parser.add_argument("--coverage", help="override the coverage identifier discovered from GetCapabilities")
    parser.add_argument("--crs", default="EPSG:31370", help="requested output CRS (default: Belgian Lambert 72)")
    parser.add_argument("--resolution", type=float, default=5.0, help="requested output pixel size in metres")
    parser.add_argument("--output", type=Path, default=Path("brussels-dtm-wcs.tif"))
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    if args.resolution <= 0:
        parser.error("--resolution must be positive")

    try:
        caps_url = args.endpoint + ("&" if "?" in args.endpoint else "?") + urllib.parse.urlencode({
            "SERVICE": "WCS", "VERSION": "1.0.0", "REQUEST": "GetCapabilities"
        })
        capabilities = request_bytes(caps_url, args.timeout)
        coverage = discover_coverage(capabilities, args.coverage)

        # Transform all four geographic corners, then request a slightly padded Lambert 72 rectangle.
        from pyproj import Transformer
        to_crs = Transformer.from_crs("EPSG:4326", args.crs, always_xy=True)
        west, south, east, north = BOUNDS
        corners = [to_crs.transform(lon, lat) for lon, lat in (
            (west, south), (west, north), (east, south), (east, north)
        )]
        xs, ys = zip(*corners)
        pad = args.resolution * 2
        bbox = (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)
        width = math.ceil((bbox[2] - bbox[0]) / args.resolution)
        height = math.ceil((bbox[3] - bbox[1]) / args.resolution)
        url = build_wcs10_url(args.endpoint, coverage, bbox, width, height, args.crs)
        print(f"Coverage: {coverage}")
        print(f"Output: {width} x {height} pixels, {args.resolution:g} m, {args.crs}")
        print(f"Source licence: CC0 — Paradigm / Brussels Mobility ({SOURCE_URL})")
        payload = request_bytes(url, args.timeout)
        if len(payload) < 1024 or not (payload[:4] in (b"II*\\x00", b"MM\\x00*")):
            preview = payload[:500].decode("utf-8", errors="replace")
            raise RuntimeError("WCS did not return a TIFF payload. Response begins: " + preview)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(payload)
        print(f"Saved {args.output} ({len(payload):,} bytes)")
        print("Next: python tools/prepare-brussels-terrain.py " + str(args.output))
    except (urllib.error.URLError, TimeoutError, ET.ParseError, RuntimeError, ImportError) as exc:
        print(f"DTM download failed: {exc}", file=sys.stderr)
        print("The service may expose WCS 2.0 only, use another endpoint, or require a different output format.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
