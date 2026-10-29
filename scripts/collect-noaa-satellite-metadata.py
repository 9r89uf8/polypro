"""Capture the predeclared 22 public S3 listings; never fetch imagery or retry.

Usage: python scripts/collect-noaa-satellite-metadata.py OUTPUT_DIRECTORY
The fixed window is 2026-10-28 00..08 UTC and 2026-10-29 00..01 UTC.
Existing output is refused so an earlier snapshot cannot be overwritten.
"""

import concurrent.futures
import datetime as dt
import email.utils
import gzip
import hashlib
import json
from pathlib import Path
import sys
import urllib.parse
import urllib.request


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def listing_url(source, hour):
    stamp = dt.datetime.fromisoformat(hour.replace("Z", "+00:00"))
    if source == "himawari9_japan":
        bucket = "noaa-himawari9"
        prefix = stamp.strftime("AHI-L1b-Japan/%Y/%m/%d/%H")
    elif source == "gk2a_la":
        bucket = "noaa-gk2a-pds"
        prefix = stamp.strftime("AMI/L1B/LA/%Y%m/%d/%H/")
    else:
        raise ValueError("Unsupported source")
    return "https://" + bucket + ".s3.amazonaws.com/?" + urllib.parse.urlencode(
        {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
    ), prefix


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=False)
    (output / "listings").mkdir()
    hours = [f"2026-10-28T{hour:02d}:00:00Z" for hour in range(9)]
    hours += [f"2026-10-29T{hour:02d}:00:00Z" for hour in range(2)]
    requests = [(source, hour) for hour in hours for source in ("himawari9_japan", "gk2a_la")]
    started = now()

    def capture(item):
        source, hour = item
        url, prefix = listing_url(source, hour)
        record = {"source": source, "hourUtc": hour, "url": url, "prefix": prefix,
                  "requestStartedAtUtc": now(), "maxKeys": 1000}
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "polypro-bounded-metadata-research/1.0"})
            with urllib.request.urlopen(req, timeout=45) as response:
                raw = response.read(2_000_001)
                record["httpStatus"] = response.status
                record["responseUrl"] = response.url
                record["httpDate"] = response.headers.get("Date")
                record["httpResponseDateUtc"] = email.utils.parsedate_to_datetime(record["httpDate"]).isoformat()
                record["etag"] = response.headers.get("ETag")
            record["responseCompletedAtUtc"] = now()
            if len(raw) > 2_000_000:
                raise ValueError("Metadata response exceeded fixed 2 MB limit")
            name = source + "-" + hour.replace("-", "").replace(":", "").replace("T", "-").replace("Z", "")
            record["xmlPath"] = "listings/" + name + ".xml.gz"
            record["xmlSha256"] = hashlib.sha256(raw).hexdigest()
            record["xmlBytes"] = len(raw)
            (output / record["xmlPath"]).write_bytes(gzip.compress(raw, mtime=0))
        except Exception as error:
            record["responseCompletedAtUtc"] = now()
            record["error"] = type(error).__name__ + ": " + str(error)
        return record

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(capture, requests))
    manifest = {
        "schemaVersion": 1,
        "purpose": "Predeclared broader retrospective public-object timestamp comparison; no images",
        "requestPolicy": "Exactly one GET for each of 22 hour/source listings, max-keys=1000; no retries or pagination",
        "startedAtUtc": started, "completedAtUtc": now(),
        "expectedHoursUtc": hours, "expectedRequestCount": 22, "requests": records,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"requests": len(records), "errors": sum("error" in r for r in records),
                      "manifest": str(output / "manifest.json")}, indent=2))


if __name__ == "__main__":
    main()
