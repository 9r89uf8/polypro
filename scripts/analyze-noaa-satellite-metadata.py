"""Offline, expected-slot analysis of captured NOAA satellite S3 XML listings.

Usage: python scripts/analyze-noaa-satellite-metadata.py MANIFEST.json OUTPUT.json
No network access. Full matching pairs, unpaired slots, absent slots, unusable
listings, source bindings and source XML hashes are retained independently.
"""

import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zlib

UTC = dt.timezone.utc
NS = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
SOURCES = {
    "himawari9_japan": {"bucket": "noaa-himawari9", "bands": ("B03", "B13"), "stepSec": 150},
    "gk2a_la": {"bucket": "noaa-gk2a-pds", "bands": ("vi006", "ir105"), "stepSec": 120},
}


def instant(value):
    stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("Timestamp lacks timezone")
    return stamp.astimezone(UTC)


def iso(stamp):
    return stamp.isoformat().replace("+00:00", "Z")


def stats(values):
    if not values:
        return {"count": 0, "min": None, "median": None, "p90": None, "max": None}
    ordered = sorted(values)
    return {"count": len(values), "min": ordered[0], "median": statistics.median(ordered),
            "p90": ordered[math.ceil(0.9 * len(ordered)) - 1], "max": ordered[-1]}


def expected_prefix(source, hour):
    if source == "himawari9_japan":
        return hour.strftime("AHI-L1b-Japan/%Y/%m/%d/%H")
    return hour.strftime("AMI/L1B/LA/%Y%m/%d/%H/")


def bind_key(source, hour, key):
    """Return (band, nominal slot), None for other bands; reject malformed targets."""
    if source == "himawari9_japan":
        if not any("_" + band + "_" in key for band in SOURCES[source]["bands"]):
            return None
        pattern = r"AHI-L1b-Japan/(\d{4})/(\d{2})/(\d{2})/(\d{4})/HS_H09_(\d{8})_(\d{4})_(B03|B13)_JP(0[1-4])_(R05|R20)_S0101\.DAT\.bz2"
        found = re.fullmatch(pattern, key)
        if not found:
            raise ValueError("Malformed target H09/JP/segment/resolution path")
        year, month, day, directory, date, timeline, band, jp, resolution = found.groups()
        if year + month + day != date or directory != timeline:
            raise ValueError("Directory and filename date/timeline disagree")
        base = dt.datetime.strptime(date + timeline, "%Y%m%d%H%M").replace(tzinfo=UTC)
        if base.replace(minute=0) != hour or base.minute % 10:
            raise ValueError("Timeline outside bound hour or not a ten-minute boundary")
        if resolution != {"B03": "R05", "B13": "R20"}[band]:
            raise ValueError("Target band/resolution mismatch")
        return band, base + dt.timedelta(seconds=(int(jp) - 1) * 150)
    if not any("_" + band + "_" in key for band in SOURCES[source]["bands"]):
        return None
    pattern = r"AMI/L1B/LA/(\d{6})/(\d{2})/(\d{2})/gk2a_ami_le1b_(vi006|ir105)_(la005ge|la020ge)_(\d{12})\.nc"
    found = re.fullmatch(pattern, key)
    if not found:
        raise ValueError("Malformed target GK2A/LA/projection/resolution path")
    month, day, directory_hour, band, resolution, stamp = found.groups()
    if month + day + directory_hour != stamp[:10]:
        raise ValueError("Directory and filename date/hour disagree")
    base = dt.datetime.strptime(stamp, "%Y%m%d%H%M").replace(tzinfo=UTC)
    if base.replace(minute=0) != hour or base.minute % 2:
        raise ValueError("Timeline outside bound hour or not a two-minute boundary")
    if resolution != {"vi006": "la005ge", "ir105": "la020ge"}[band]:
        raise ValueError("Target band/resolution mismatch")
    return band, base


def one_text(element, name):
    values = element.findall("s:" + name, NS)
    if len(values) != 1 or values[0].text is None:
        raise ValueError("Missing or duplicate " + name)
    return values[0].text


def analyze_listing(record, base):
    source = record["source"]
    config = SOURCES[source]
    hour = instant(record["hourUtc"])
    if hour.minute or hour.second or hour.microsecond:
        raise ValueError("Hour must be an exact UTC boundary")
    slots = {iso(hour + dt.timedelta(seconds=second)): {
        "nominalSlotUtc": iso(hour + dt.timedelta(seconds=second)), "objects": {}, "rejectedCandidates": []
    } for second in range(0, 3600, config["stepSec"])}
    result = {"source": source, "hourUtc": iso(hour), "utcDate": hour.date().isoformat(),
              "requestEvidence": record, "listingUsable": False, "listingErrors": [],
              "rejectedObjects": [], "ignoredOtherBandObjects": 0, "objectCount": 0}
    try:
        if record.get("error"):
            raise ValueError("Captured request failed: " + record["error"])
        if record.get("httpStatus") != 200 or record.get("maxKeys") != 1000:
            raise ValueError("Unexpected HTTP status or listing bound")
        prefix = expected_prefix(source, hour)
        url = urllib.parse.urlsplit(record["url"])
        query = urllib.parse.parse_qs(url.query)
        if (url.scheme != "https" or url.netloc != config["bucket"] + ".s3.amazonaws.com"
                or url.path != "/" or url.fragment or query != {"list-type": ["2"], "prefix": [prefix], "max-keys": ["1000"]}
                or record["prefix"] != prefix or record.get("responseUrl") != record["url"]):
            raise ValueError("Source URL/prefix binding failed")
        path = (base / record["xmlPath"]).resolve()
        if not path.is_relative_to(base.resolve()):
            raise ValueError("XML path leaves manifest directory")
        raw = gzip.decompress(path.read_bytes())
        if hashlib.sha256(raw).hexdigest() != record["xmlSha256"] or len(raw) != record["xmlBytes"]:
            raise ValueError("XML hash or size mismatch")
        root = ET.fromstring(raw)
        if root.tag != "{" + NS["s"] + "}ListBucketResult":
            raise ValueError("Unexpected XML root")
        if (one_text(root, "Name") != config["bucket"] or one_text(root, "Prefix") != prefix
                or one_text(root, "IsTruncated") != "false" or one_text(root, "MaxKeys") != "1000"):
            raise ValueError("Listing bucket/prefix/bound mismatch or truncated listing")
        objects = root.findall("s:Contents", NS)
        if len(objects) > 1000 or int(one_text(root, "KeyCount")) != len(objects):
            raise ValueError("Invalid object count")
        result["objectCount"] = len(objects)
        receipt = instant(record["responseCompletedAtUtc"])
        response_date = instant(record["httpResponseDateUtc"])
        result["hourEndAgeAtCaptureSec"] = (receipt - hour - dt.timedelta(hours=1)).total_seconds()
        seen_targets = set()
        for obj in objects:
            key = None
            slot = None
            try:
                key = one_text(obj, "Key")
                if not key.startswith(prefix):
                    raise ValueError("Object outside bound listing prefix")
                bound = bind_key(source, hour, key)
                if bound is None:
                    result["ignoredOtherBandObjects"] += 1
                    continue
                band, nominal = bound
                slot = slots[iso(nominal)]
                if (iso(nominal), band) in seen_targets:
                    slot["objects"].pop(band, None)
                    raise ValueError("Ambiguous duplicate target band/slot; both excluded")
                seen_targets.add((iso(nominal), band))
                modified = instant(one_text(obj, "LastModified"))
                size = int(one_text(obj, "Size"))
                if size <= 0 or modified < nominal:
                    raise ValueError("Empty object or negative nominal timestamp delay")
                if modified > max(receipt, response_date):
                    raise ValueError("Object modification timestamp later than capture")
                slot["objects"][band] = {"key": key, "lastModifiedUtc": iso(modified), "bytes": size,
                                         "etag": one_text(obj, "ETag"), "nominalDelaySec": (modified - nominal).total_seconds()}
            except (KeyError, TypeError, ValueError) as error:
                rejected = {"key": key, "reason": str(error)}
                result["rejectedObjects"].append(rejected)
                if slot is not None:
                    slot["rejectedCandidates"].append(rejected)
        result["listingUsable"] = True
    except (OSError, EOFError, KeyError, TypeError, ValueError, ET.ParseError, zlib.error) as error:
        result["listingErrors"].append(str(error))
    for slot in slots.values():
        slot["missingBands"] = [band for band in config["bands"] if band not in slot["objects"]]
        if not result["listingUsable"]:
            slot["status"] = "unusable_listing"
        elif not slot["missingBands"]:
            slot["status"] = "paired"
            slot["pairLastModifiedUtc"] = iso(max(instant(obj["lastModifiedUtc"]) for obj in slot["objects"].values()))
            slot["pairDelaySec"] = max(obj["nominalDelaySec"] for obj in slot["objects"].values())
        elif slot["objects"]:
            slot["status"] = "unpaired"
        else:
            slot["status"] = "missing"
    result["slots"] = list(slots.values())
    result["summary"] = summarize(result["slots"])
    result["summary"]["availablePairsOnly"] = True
    result["coverageState"] = "all_expected_pairs_present" if result["summary"]["pairedSlots"] == len(slots) else "incomplete_at_capture"
    return result


def summarize(slots):
    paired = [s["pairDelaySec"] for s in slots if s["status"] == "paired"]
    return {"expectedSlots": len(slots), "pairedSlots": len(paired),
            "unpairedSlots": sum(s["status"] == "unpaired" for s in slots),
            "missingSlots": sum(s["status"] == "missing" for s in slots),
            "unusableListingSlots": sum(s["status"] == "unusable_listing" for s in slots),
            "pairCoverageFraction": len(paired) / len(slots) if slots else None,
            "pairDelaySec": stats(paired),
            "pairedDelayAbove600Sec": sum(v > 600 for v in paired),
            "pairedDelayAbove900Sec": sum(v > 900 for v in paired),
            "pairedDelayAbove1800Sec": sum(v > 1800 for v in paired),
            "pairedDelayAbove3600Sec": sum(v > 3600 for v in paired)}


def analyze_manifest(path):
    manifest = json.loads(path.read_text(encoding="utf-8-sig"))
    expected = [(source, iso(instant(hour))) for hour in manifest["expectedHoursUtc"] for source in SOURCES]
    actual = [(r["source"], iso(instant(r["hourUtc"]))) for r in manifest["requests"]]
    if len(set(expected)) != len(expected) or len(set(actual)) != len(actual) or set(expected) != set(actual):
        raise ValueError("Manifest does not contain exactly one request per declared source/hour")
    if len(actual) != manifest["expectedRequestCount"]:
        raise ValueError("Manifest request count mismatch")
    hours = [analyze_listing(record, path.parent) for record in manifest["requests"]]
    day_summaries = []
    for date in sorted({h["utcDate"] for h in hours}):
        for source in SOURCES:
            selected = [h for h in hours if h["utcDate"] == date and h["source"] == source]
            complete = [h for h in selected if h["coverageState"] == "all_expected_pairs_present"]
            day_summaries.append({"utcDate": date, "source": source, "hours": len(selected),
                                  "completeHours": len(complete),
                                  **summarize([s for h in selected for s in h["slots"]]),
                                  "availablePairsOnly": True,
                                  "completeHoursOnly": summarize([s for h in complete for s in h["slots"]])})
    comparisons = []
    for hour in manifest["expectedHoursUtc"]:
        pair = {h["source"]: h for h in hours if h["hourUtc"] == iso(instant(hour))}
        complete = all(h["coverageState"] == "all_expected_pairs_present" for h in pair.values())
        hs = pair["himawari9_japan"]["summary"]["pairDelaySec"]["median"]
        gs = pair["gk2a_la"]["summary"]["pairDelaySec"]["median"]
        comparisons.append({"hourUtc": iso(instant(hour)), "bothSourcesAllExpectedPairsPresent": complete,
                            "himawariMedianSec": hs, "gk2aMedianSec": gs,
                            "gk2aMinusHimawariMedianSec": gs - hs if complete else None})
    complete_common_hours = {c["hourUtc"] for c in comparisons if c["bothSourcesAllExpectedPairsPresent"]}
    common_day_summaries = []
    for date in sorted({h["utcDate"] for h in hours}):
        for source in SOURCES:
            selected = [h for h in hours if h["utcDate"] == date and h["source"] == source
                        and h["hourUtc"] in complete_common_hours]
            common_day_summaries.append({"utcDate": date, "source": source,
                "hoursUtc": [h["hourUtc"] for h in selected],
                **summarize([s for h in selected for s in h["slots"]])})
    return {"method": "noaa-public-satellite-expected-slot-timestamps-v1", "generatedAtUtc": iso(dt.datetime.now(UTC)),
            "manifestSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "requestCount": len(actual), "expectedSlots": sum(len(h["slots"]) for h in hours),
            "p90Method": "Nearest rank: sorted values at ceil(0.9*n)-1; median averages the middle two for even n",
            "interpretation": "Retrospective S3 LastModified minus nominal slot, not first publication, scan end, pixel time, application receipt, SLA or trading edge. Missing/unpaired slots remain censored at capture and are not zero delays. Complete coverage can still conceal object replacements or later changes.",
            "sources": SOURCES, "hours": hours, "daySummaries": day_summaries, "hourComparisons": comparisons,
            "matchedCompleteHourDaySummaries": common_day_summaries}


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    result = analyze_manifest(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"requestCount": result["requestCount"], "expectedSlots": result["expectedSlots"],
                      "daySummaries": result["daySummaries"], "hourComparisons": result["hourComparisons"]}, indent=2))


if __name__ == "__main__":
    main()
