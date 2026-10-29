"""Summarize independently calibrated, offline Himawari RKSI samples.

Usage: python scripts/analyze-himawari-rksi-trend.py REVIEW.json OUTPUT.json
Input comes from review-himawari-hsd.py. This intentionally emits no cloud
state or temperature forecast: the four-frame method has not been validated.
"""

import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys

if len(sys.argv) != 3:
    raise SystemExit("Usage: python scripts/analyze-himawari-rksi-trend.py REVIEW.json OUTPUT.json")
source = Path(sys.argv[1])
reviews = json.loads(source.read_text(encoding="utf-8-sig"))
parse_time = lambda value: dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
grouped = {}
for review in reviews:
    match = re.fullmatch(r"himawari9-(b03|b13)-(jp\d\d)-(\d{12})\.DAT\.bz2", review["file"])
    if not match:
        raise ValueError("Unexpected research filename: " + review["file"])
    band, observation, timeline = match.groups()
    key = (timeline, observation)
    if band in grouped.setdefault(key, {}):
        raise ValueError("Duplicate channel for pair")
    grouped[key][band] = review

frames = []
for (timeline, observation), channels in grouped.items():
    if set(channels) != {"b03", "b13"}:
        raise ValueError("Unpaired frame")
    visible, infrared = channels["b03"], channels["b13"]
    vis_cells = {cell["id"]:cell for cell in visible["cells"]}
    ir_cells = {cell["id"]:cell for cell in infrared["cells"]}
    if set(vis_cells) != set(range(25)) or set(ir_cells) != set(range(25)):
        raise ValueError("This bounded experiment requires all 25 fixed cells")
    cells = []
    for cell_id in range(25):
        vis, ir = vis_cells[cell_id], ir_cells[cell_id]
        if abs(vis["latitude"]-ir["latitude"]) > 1e-9 or abs(vis["longitude"]-ir["longitude"]) > 1e-9:
            raise ValueError("Channel target coordinates differ")
        cells.append({"id":cell_id, "latitude":vis["latitude"], "longitude":vis["longitude"],
            "reflectance":vis["solarNormalizedReflectance"], "brightnessTempK":ir["brightnessTempK"],
            "visibleInterpolatedLineTimeUtc":vis["interpolatedLineTimeUtc"],
            "infraredInterpolatedLineTimeUtc":ir["interpolatedLineTimeUtc"],
            "visibleLineTimeBracketUtc":vis["lineTimeBracketUtc"],
            "infraredLineTimeBracketUtc":ir["lineTimeBracketUtc"]})
    frames.append({"timeline":timeline, "observationNumber":observation.upper(),
        "scanStartUtc":min(visible["observationStartUtc"], infrared["observationStartUtc"]),
        "scanEndUtc":max(visible["observationEndUtc"], infrared["observationEndUtc"]),
        "medianReflectance":statistics.median(cell["reflectance"] for cell in cells),
        "medianBrightnessTempK":statistics.median(cell["brightnessTempK"] for cell in cells),
        "medianSolarElevationDeg":statistics.median(cell["solar"]["solarElevationDeg"] for cell in visible["cells"]),
        "minHimawariGlintAngleDeg":min(cell["solar"]["glintAngleDeg"] for cell in visible["cells"]),
        "distinctNativeVisiblePixelCount":len({(cell["row"],cell["column"]) for cell in visible["cells"]}),
        "distinctNativeInfraredPixelCount":len({(cell["row"],cell["column"]) for cell in infrared["cells"]}),
        "validCellCount":len(cells), "cells":cells})
frames.sort(key=lambda frame:parse_time(frame["scanStartUtc"]))
if len(frames) < 4:
    raise ValueError("At least four paired frames required")

changes = []
for cell_id in range(25):
    cell_frames = [frame["cells"][cell_id] for frame in frames]
    result = {"id":cell_id}
    for field, time_field, label in [
        ("reflectance", "visibleInterpolatedLineTimeUtc", "visible"),
        ("brightnessTempK", "infraredInterpolatedLineTimeUtc", "infrared"),
    ]:
        times = [parse_time(cell[time_field]) for cell in cell_frames]
        if any(right <= left for left,right in zip(times,times[1:])):
            raise ValueError("Non-increasing per-band acquisition estimates")
        slopes = [(cell_frames[j][field]-cell_frames[i][field])/((times[j]-times[i])/60)
            for i in range(len(frames)-1) for j in range(i+1,len(frames))]
        span = (times[-1]-times[0])/60
        result[label+"SlopePerMinute"] = statistics.median(slopes)
        result[label+"SpanMinutes"] = span
        result[label+"RobustChange"] = statistics.median(slopes)*span
    changes.append(result)

summary = {
    "sampleCount":len(frames), "commonCellCount":len(changes),
    "medianVisibleSpanMinutes":statistics.median(cell["visibleSpanMinutes"] for cell in changes),
    "medianInfraredSpanMinutes":statistics.median(cell["infraredSpanMinutes"] for cell in changes),
    "medianVisibleSlopePerMinute":statistics.median(cell["visibleSlopePerMinute"] for cell in changes),
    "medianInfraredSlopeKPerMinute":statistics.median(cell["infraredSlopePerMinute"] for cell in changes),
    "medianVisibleRobustChange":statistics.median(cell["visibleRobustChange"] for cell in changes),
    "medianInfraredRobustChangeK":statistics.median(cell["infraredRobustChange"] for cell in changes),
    "visibleUpInfraredDownFraction":sum(cell["visibleRobustChange"]>0 and cell["infraredRobustChange"]<0 for cell in changes)/len(changes),
    "visibleDownInfraredUpFraction":sum(cell["visibleRobustChange"]<0 and cell["infraredRobustChange"]>0 for cell in changes)/len(changes),
    "interpretation":"Unvalidated exploratory paired-band changes; no cloud-state class, surface irradiance, market edge, or 2 m temperature forecast assigned.",
    "spatialIndependence":"Agreement fractions are weighted by the 25 fixed target points. They are not counts of 25 independent infrared measurements; native infrared pixels are reused, and nearby measurements are spatially correlated.",
}
output = {"method":"himawari-rksi-exploratory-four-pair-v1", "source":"NOAA-distributed JMA Himawari-9 Japan-area HSD",
    "generatedAtUtc":dt.datetime.now(dt.timezone.utc).isoformat(),
    "calibratedInputSha256":hashlib.sha256(source.read_bytes()).hexdigest(),
    "timingMethod":"Per-cell, per-band acquisition estimates interpolated between embedded line-time records; retain the bracketing timestamps and do not claim exact pixel times.",
    "slopeMethod":"Median of all pairwise time-normalized slopes (Theil-Sen), separately per band and fixed geographic point; multiply each point slope by its own span, then summarize across points.",
    "summary":summary, "frames":frames, "perCellChanges":changes}
Path(sys.argv[2]).write_text(json.dumps(output,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"summary":summary,"frames":[{k:v for k,v in frame.items() if k != "cells"} for frame in frames]},indent=2))
