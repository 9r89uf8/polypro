"""Plot the saved offline NOAA metadata analysis without downloading data."""

import json
import os
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
packages = ROOT / "tmp/seoul-plot-deps"
if packages.exists():
    sys.path.insert(0, str(packages))
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / "tmp/noaa-metadata-matplotlib"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

if len(sys.argv) != 3:
    raise SystemExit("Usage: python scripts/plot-noaa-satellite-metadata.py ANALYSIS.json OUTPUT.png")
data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
hours = [entry["hourUtc"] for entry in data["hourComparisons"]]
labels = [hour[5:10] + "\n" + hour[11:13] + " UTC" for hour in hours]
fig, axes = plt.subplots(2, 1, figsize=(12, 7), sharex=True)
colors = {"himawari9_japan": "#087e8b", "gk2a_la": "#bd4c2f"}
names = {"himawari9_japan": "Himawari-9 Japan B03 + B13", "gk2a_la": "GK2A local area VI006 + IR105"}
for axis, stat, title in zip(axes, ["median", "p90"], ["Hourly median", "Hourly p90 (nearest rank)"]):
    for source in names:
        entries = [next(h for h in data["hours"] if h["hourUtc"] == hour and h["source"] == source) for hour in hours]
        values = [h["summary"]["pairDelaySec"][stat] / 60 for h in entries]
        axis.plot(range(len(hours)), values, color=colors[source], linewidth=1.7, label=names[source], zorder=2)
        for index, entry in enumerate(entries):
            complete = entry["coverageState"] == "all_expected_pairs_present"
            axis.scatter(index, values[index], s=45 if complete else 80, marker="o" if complete else "D",
                         facecolors=colors[source] if complete else "white", edgecolors=colors[source],
                         linewidths=1.8, zorder=3)
    axis.set_ylabel("Minutes after nominal slot")
    axis.set_title(title, loc="left", fontsize=12, fontweight="bold")
    axis.set_ylim(bottom=0)
    axis.grid(axis="y", color="#d9dfe5", linewidth=0.6)
    axis.axvline(8.5, color="#9aa2ad", linestyle="--", linewidth=0.8)
    axis.spines[["top", "right"]].set_visible(False)
axes[0].legend(loc="lower left", ncol=2, frameon=False)
axes[1].set_xticks(range(len(hours)), labels, fontsize=9)
fig.suptitle("NOAA public object timestamps across 11 predeclared hours", x=0.08, ha="left", fontsize=17, fontweight="bold")
fig.text(0.08, 0.015, "Captured 2026-10-29 03:30:52-54 UTC. Hollow diamond: only 25/30 GK2A pairs present.\n"
         "LastModified is not first public availability or application receipt. Missing slots have no assigned delay.",
         fontsize=10, color="#414951")
fig.tight_layout(rect=(0.03, 0.08, 0.99, 0.93))
fig.savefig(sys.argv[2], dpi=160, facecolor="white")
plt.close(fig)
