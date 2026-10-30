"""Unit tests for the WCS discovery and request builder (no network access)."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("download_brussels_dtm", ROOT / "tools/download-brussels-dtm.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class WcsDownloadTests(unittest.TestCase):
    def test_discovers_altitude_coverage(self):
        xml = b"""<?xml version="1.0"?>
        <WCS_Capabilities xmlns="http://www.opengis.net/wcs">
          <Content><CoverageOfferingBrief><name>urbisgrid:Altitude2019</name></CoverageOfferingBrief></Content>
        </WCS_Capabilities>"""
        self.assertEqual(MODULE.discover_coverage(xml, None), "urbisgrid:Altitude2019")

    def test_preferred_coverage_must_be_advertised(self):
        xml = b"""<WCS_Capabilities><Content>
          <CoverageOfferingBrief><name>urbisgrid:Altitude2019</name></CoverageOfferingBrief>
        </Content></WCS_Capabilities>"""
        self.assertEqual(MODULE.discover_coverage(xml, "urbisgrid:Altitude2019"), "urbisgrid:Altitude2019")

    def test_missing_coverage_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "did not advertise"):
            MODULE.discover_coverage(b"<WCS_Capabilities/>", None)

    def test_request_uses_numeric_geotiff_and_requested_crs(self):
        url = MODULE.build_wcs10_url(
            "https://example.test/geoserver/wcs", "urbisgrid:Altitude2019",
            (145000, 170000, 152000, 177000), 1400, 1400, "EPSG:31370"
        )
        from urllib.parse import parse_qs, urlparse
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["SERVICE"], ["WCS"])
        self.assertEqual(query["REQUEST"], ["GetCoverage"])
        self.assertEqual(query["COVERAGE"], ["urbisgrid:Altitude2019"])
        self.assertEqual(query["FORMAT"], ["GeoTIFF"])
        self.assertEqual(query["CRS"], ["EPSG:31370"])


if __name__ == "__main__":
    unittest.main()
