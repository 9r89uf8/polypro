"""Offline synthetic checks for NOAA listing analysis; no network requests."""

import datetime as dt
import gzip
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
import urllib.parse
import xml.etree.ElementTree as ET

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "analyze-noaa-satellite-metadata.py"
SPEC = importlib.util.spec_from_file_location("noaa_metadata", MODULE_PATH)
ANALYZER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ANALYZER)
NS = "http://s3.amazonaws.com/doc/2006-03-01/"


def h9(band, jp="01", resolution=None):
    resolution = resolution or {"B03": "R05", "B13": "R20"}[band]
    return f"AHI-L1b-Japan/2026/10/28/0000/HS_H09_20261028_0000_{band}_JP{jp}_{resolution}_S0101.DAT.bz2"


def gk(band, minute="00"):
    resolution = {"vi006": "la005ge", "ir105": "la020ge"}[band]
    return f"AMI/L1B/LA/202610/28/00/gk2a_ami_le1b_{band}_{resolution}_2026102800{minute}.nc"


class MetadataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_root = MODULE_PATH.parents[1] / "tmp" / "noaa-metadata-tests"
        cls.temp_root.mkdir(parents=True, exist_ok=True)

    def fixture(self, directory, source, objects, truncated="false"):
        bucket = {"himawari9_japan": "noaa-himawari9", "gk2a_la": "noaa-gk2a-pds"}[source]
        prefix = {"himawari9_japan": "AHI-L1b-Japan/2026/10/28/00", "gk2a_la": "AMI/L1B/LA/202610/28/00/"}[source]
        root = ET.Element("{" + NS + "}ListBucketResult")
        def put(parent, name, value):
            ET.SubElement(parent, "{" + NS + "}" + name).text = str(value)
        for name, value in [("Name", bucket), ("Prefix", prefix), ("IsTruncated", truncated), ("MaxKeys", 1000), ("KeyCount", len(objects))]:
            put(root, name, value)
        for key, modified in objects:
            obj = ET.SubElement(root, "{" + NS + "}Contents")
            for name, value in [("Key", key), ("LastModified", modified), ("Size", 10), ("ETag", '"example"')]:
                put(obj, name, value)
        raw = ET.tostring(root)
        (directory / "listing.xml.gz").write_bytes(gzip.compress(raw))
        url = f"https://{bucket}.s3.amazonaws.com/?" + urllib.parse.urlencode({"list-type": "2", "prefix": prefix, "max-keys": "1000"})
        return {"source": source, "hourUtc": "2026-10-28T00:00:00Z", "url": url, "responseUrl": url,
                "prefix": prefix, "httpStatus": 200, "maxKeys": 1000, "xmlPath": "listing.xml.gz",
                "xmlSha256": hashlib.sha256(raw).hexdigest(), "xmlBytes": len(raw),
                "responseCompletedAtUtc": "2026-10-29T03:00:01Z", "httpResponseDateUtc": "2026-10-29T03:00:00Z"}

    def test_expected_slots_preserve_absent_and_unpaired(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temp:
            base = Path(temp)
            record = self.fixture(base, "himawari9_japan", [
                (h9("B03"), "2026-10-28T00:05:00Z"),
                (h9("B13"), "2026-10-28T00:06:00Z"),
                (h9("B03", "02"), "2026-10-28T00:08:00Z"),
            ])
            result = ANALYZER.analyze_listing(record, base)
            self.assertEqual((result["summary"]["expectedSlots"], result["summary"]["pairedSlots"],
                              result["summary"]["unpairedSlots"], result["summary"]["missingSlots"]), (24, 1, 1, 22))
            self.assertEqual(result["slots"][0]["pairDelaySec"], 360)
            self.assertEqual(result["slots"][1]["nominalSlotUtc"], "2026-10-28T00:02:30Z")
            self.assertEqual(result["coverageState"], "incomplete_at_capture")

    def test_jp04_uses_seven_and_half_minute_slot(self):
        hour = dt.datetime(2026, 10, 28, tzinfo=dt.timezone.utc)
        self.assertEqual(ANALYZER.bind_key("himawari9_japan", hour, h9("B03", "04"))[1], hour + dt.timedelta(seconds=450))

    def test_wrong_resolution_and_directory_cannot_bind(self):
        hour = dt.datetime(2026, 10, 28, tzinfo=dt.timezone.utc)
        bad = [h9("B03", resolution="R20"), h9("B03").replace("/0000/", "/0010/"),
               h9("B03").replace("HS_H09", "HS_H08"), gk("vi006", "01"),
               gk("vi006").replace("la005ge", "la020ge")]
        for key in bad:
            source = "himawari9_japan" if key.startswith("AHI") else "gk2a_la"
            with self.subTest(key=key), self.assertRaises(ValueError):
                ANALYZER.bind_key(source, hour, key)

    def test_truncated_listing_is_not_a_coverage_sample(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temp:
            base = Path(temp)
            record = self.fixture(base, "gk2a_la", [], truncated="true")
            result = ANALYZER.analyze_listing(record, base)
            self.assertFalse(result["listingUsable"])
            self.assertEqual(result["summary"]["unusableListingSlots"], 30)
            self.assertIsNone(result["summary"]["pairDelaySec"]["median"])

    def test_hash_and_source_url_fail_closed(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temp:
            base = Path(temp)
            record = self.fixture(base, "gk2a_la", [])
            record["xmlSha256"] = "0" * 64
            self.assertFalse(ANALYZER.analyze_listing(record, base)["listingUsable"])
            record = self.fixture(base, "gk2a_la", [])
            record["url"] = record["url"].replace("noaa-gk2a-pds", "noaa-himawari9")
            self.assertFalse(ANALYZER.analyze_listing(record, base)["listingUsable"])

    def test_ambiguous_duplicate_never_keeps_a_convenient_version(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temp:
            base = Path(temp)
            record = self.fixture(base, "gk2a_la", [
                (gk("vi006"), "2026-10-27T23:59:00Z"),
                (gk("vi006"), "2026-10-28T00:05:00Z"),
                (gk("ir105"), "2026-10-28T00:06:00Z"),
            ])
            result = ANALYZER.analyze_listing(record, base)
            self.assertEqual(result["summary"]["pairedSlots"], 0)
            self.assertEqual(result["slots"][0]["status"], "unpaired")
            self.assertEqual(result["slots"][0]["missingBands"], ["vi006"])

    def test_complete_gk_hour_has_thirty_slots(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temp:
            base = Path(temp)
            objects = [(gk(band, f"{minute:02d}"), "2026-10-28T02:00:00Z")
                       for minute in range(0, 60, 2) for band in ("vi006", "ir105")]
            record = self.fixture(base, "gk2a_la", objects)
            result = ANALYZER.analyze_listing(record, base)
            self.assertEqual(result["coverageState"], "all_expected_pairs_present")
            self.assertEqual(result["summary"]["pairedSlots"], 30)
            self.assertEqual(result["slots"][-1]["nominalSlotUtc"], "2026-10-28T00:58:00Z")

    def test_pair_timestamp_uses_time_not_iso_lexical_order(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temp:
            base = Path(temp)
            record = self.fixture(base, "gk2a_la", [
                (gk("vi006"), "2026-10-28T00:06:00Z"),
                (gk("ir105"), "2026-10-28T00:06:00.500Z"),
            ])
            slot = ANALYZER.analyze_listing(record, base)["slots"][0]
            self.assertEqual(slot["pairLastModifiedUtc"], "2026-10-28T00:06:00.500000Z")
            self.assertEqual(slot["pairDelaySec"], 360.5)

    def test_truncated_gzip_preserves_unusable_expected_slots(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as temp:
            base = Path(temp)
            record = self.fixture(base, "gk2a_la", [])
            archive = base / record["xmlPath"]
            archive.write_bytes(archive.read_bytes()[:-12])
            result = ANALYZER.analyze_listing(record, base)
            self.assertFalse(result["listingUsable"])
            self.assertEqual(result["summary"]["unusableListingSlots"], 30)

    def test_percentile_is_nearest_rank_and_empty_is_unavailable(self):
        result = ANALYZER.stats(list(range(1, 11)))
        self.assertEqual((result["median"], result["p90"]), (5.5, 9))
        self.assertIsNone(ANALYZER.stats([])["p90"])


if __name__ == "__main__":
    unittest.main()
