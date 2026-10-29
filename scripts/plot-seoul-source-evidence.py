"""Render the October 29 source audit from local research exports; no network."""
import csv
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
local_packages = ROOT / "tmp/seoul-plot-deps"
if local_packages.exists():
    sys.path.insert(0, str(local_packages))
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / "tmp/seoul-matplotlib"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def read(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8-sig"))

day = read("tmp/seoul-restore/2026-10-29-day.json")
sites = read("tmp/seoul-amos-sites-audit-2026-10-29.json")
audit = read("tmp/seoul-amos-metar-audit-2026-10-29.json")
with (ROOT / "docs/assets/seoul-gk2a-publication-20261029.csv").open(encoding="utf-8-sig", newline="") as stream:
    satellite = list(csv.DictReader(stream))
complete_hour = read("docs/assets/seoul-gk2a-complete-hour-2026102901.json")["pairs"]
# The initial 24-pair LA listing missed six very late arrivals. Preserve that
# artifact but plot the completed 30-pair hour so its slow tail is included.
satellite = [r for r in satellite if not (r["area"] == "LA" and r["nominal_utc"][11:13] == "01")]
satellite += [{"area":"LA", "nominal_utc":r["nominalUtc"], "visible_delay_sec":r["visible"]["delaySec"], "pair_delay_sec":r["pairDelaySec"]} for r in complete_hour]

def hour(row):
    value = row["obsTimeLocal"].split(" ")[1].split(":")
    return int(value[0]) + int(value[1]) / 60

primary = sorted((r for r in sites if r.get("date") == "2026-10-29" and r.get("rwyDir") == "15L" and r.get("collectionCadence") == "one_minute" and hour(r) <= 11.5), key=hour)
secondary = sorted((r for r in sites if r.get("date") == "2026-10-29" and r.get("rwyDir") == "16L" and r.get("collectionCadence") == "one_minute" and hour(r) <= 11.5), key=hour)
reports = day["rows"]

plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.titleweight": "bold", "figure.facecolor": "#f6f8fb", "axes.facecolor": "white"})
fig = plt.figure(figsize=(14, 10), layout="constrained")
grid = fig.add_gridspec(2, 2, height_ratios=[1, 1])
ax = fig.add_subplot(grid[0, 0])
for rows, label, color in [(primary, "AMOS 15L", "#086f99"), (secondary, "AMOS 16L", "#d48a00")]:
    ax.plot([hour(r) for r in rows], [r["tempC"] for r in rows], lw=1.3, label=label, color=color)
ax.scatter([hour(r) for r in reports], [r["tempC"] for r in reports], s=25, color="#1f2937", label="Routine METAR", zorder=3)
ax.set(title="A. Two airport series and the official report", xlabel="October 29, KST hour", ylabel="Temperature (°C)", xlim=(0, 11.5))
ax.legend(frameon=False, ncol=3, fontsize=9, loc="lower right")
ax.grid(axis="y", alpha=.18)

ax = fig.add_subplot(grid[0, 1])
for rows, label, color in [(primary, "15L", "#086f99"), (secondary, "16L", "#d48a00")]:
    selected = [r for r in rows if 2 + 20/60 <= hour(r) <= 2 + 40/60]
    ax.plot([(hour(r)-2)*60 for r in selected], [r["tempC"] for r in selected], marker=".", label=label, color=color)
ax.axvline(30, ls="--", color="#6b7280", lw=1)
ax.scatter([30], [7], marker="D", s=60, color="#1f2937", label="02:30 METAR = 7°C", zorder=4)
ax.annotate("15L 6.1°C", (30, 6.1), xytext=(31.2, 5.86), color="#086f99", fontsize=10)
ax.annotate("16L 7.4°C", (30, 7.4), xytext=(31.2, 7.55), color="#9b6200", fontsize=10)
ax.set(title="B. Same-minute rounding has a counterexample", xlabel="02:xx KST minute", ylabel="Temperature (°C)", xlim=(20, 40), ylim=(5.5, 8.25))
ax.legend(frameon=False, fontsize=9, loc="upper right")
ax.grid(axis="y", alpha=.18)

ax = fig.add_subplot(grid[1, 0])
studies = audit["leadStudies"]
x = [r["leadMinutes"] for r in studies]
ax.plot(x, [r["amosMatches"] for r in studies], color="#086f99", marker="o", lw=2, label="Latest AMOS available then")
ax.plot(x, [r["priorMetarMatches"] for r in studies], color="#7e8190", marker="s", ls="--", label="Prior METAR persistence")
ax.set_xticks(x, [r["leadMinutes"] for r in studies])
ax.set_yticks([0, 5, 10, 15, 20, 22])
ax.set(title="C. Short-lead agreement, 22 cases", xlabel="Decision time: minutes before nominal METAR", ylabel="Exactly matching reports (out of 22)", ylim=(0, 22))
ax.legend(frameon=False, fontsize=9, loc="lower left")
ax.grid(axis="y", alpha=.18)
ax.text(.02, .46, "0 min uses the previous available minute.\nSame-time AMOS arrives about 15 s later.", transform=ax.transAxes, fontsize=9, va="top")

ax = fig.add_subplot(grid[1, 1])
# Column names are explicit so a changed evidence format fails visibly.
keys = set(satellite[0]) if satellite else set()
if not {"area", "pair_delay_sec", "visible_delay_sec", "nominal_utc"}.issubset(keys):
    raise ValueError(f"Inspect the evidence CSV header before plotting: {sorted(keys)}")
for area, field, label, color, marker in [("LA", "visible_delay_sec", "LA visible only", "#61a5c2", "."),
                                        ("LA", "pair_delay_sec", "LA complete pair", "#086f99", "o"),
                                        ("FD", "pair_delay_sec", "Full-disk pair", "#c27900", "^")]:
    selected = [r for r in satellite if r["area"] == area and r["nominal_utc"][11:13] == "01"]
    minutes = [int(r["nominal_utc"][14:16]) for r in selected]
    ax.scatter(minutes, [float(r[field])/60 for r in selected], label=label, color=color, marker=marker, s=30)
ax.axhline(12, color="#ad314a", ls="--", lw=1.2, label="Cloud-row freshness limit")
ax.set(title="D. The completed GK2A hour includes a late batch", xlabel="Nominal observation: 01:xx UTC", ylabel="S3 object timestamp delay (minutes)", ylim=(0, 65))
ax.legend(frameon=False, fontsize=9, loc="upper left")
ax.grid(axis="y", alpha=.18)
fig.suptitle("Seoul source evidence · October 29, 2026", fontsize=19, fontweight="bold")
fig.supxlabel("Small, retrospective sample. Temperature correspondence and source timing do not establish a tradable advantage.\nS3 modification times are not repeated first-publication measurements. See the linked reports for methods and limitations.", fontsize=10, color="#555b65")
destination = ROOT / "docs/assets/seoul-source-evidence-2026-10-29"
fig.savefig(destination.with_suffix(".png"), dpi=170)
fig.savefig(destination.with_suffix(".svg"))
print(destination.with_suffix(".png"))
