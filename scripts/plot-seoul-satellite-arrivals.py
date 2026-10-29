"""Plot retained NOAA publication metadata and bounded first-seen evidence."""
import csv
import datetime as dt
import json
import os
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
packages = ROOT / 'tmp/seoul-plot-deps'
if packages.exists():
    sys.path.insert(0, str(packages))
os.environ.setdefault('MPLCONFIGDIR', str(ROOT / 'tmp/seoul-matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

read = lambda name: json.loads((ROOT / name).read_text(encoding='utf-8-sig'))
parse = lambda value: dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
h9 = read('docs/assets/seoul-himawari-publication-2026102901.json')['pairs']
gk = read('docs/assets/seoul-gk2a-complete-hour-2026102901.json')['pairs']
probe_name = sys.argv[1] if len(sys.argv) > 1 else 'docs/assets/seoul-satellite-first-seen-20261029.json'
probe = read(probe_name)
if not probe.get('completedAtUtc'):
    raise ValueError('Only plot a completed bounded probe, not a changing partial result')
groups = [
    ('Himawari-9 B03 + B13', '#087e8b', [(parse(r['nominalSlotUtc']), r['pairDelaySec']/60) for r in h9]),
    ('GK2A VI006 + IR105', '#b56a23', [(parse(r['nominalUtc']), r['pairDelaySec']/60) for r in gk]),
]
plt.rcParams.update({'font.size':10, 'axes.spines.top':False, 'axes.spines.right':False,
    'axes.titleweight':'bold', 'figure.facecolor':'#f6f8fb', 'axes.facecolor':'white'})
fig, axes = plt.subplots(1, 3, figsize=(16, 5.8), layout='constrained', gridspec_kw={'width_ratios':[1.15, 1, 1.15]})
for name, color, values in groups:
    axes[0].plot([t.minute+t.second/60 for t,v in values], [v for t,v in values], marker='o', markersize=3.5, lw=1.1, color=color, label=name)
    delays=sorted(v for t,v in values)
    axes[1].step(delays, [100*(i+1)/len(delays) for i in range(len(delays))], where='post', color=color, lw=2,
        label=f'{name.split()[0]}: median {statistics.median(delays):.2f} min')
axes[0].axhline(12, color='#9d3554', ls='--', lw=1.2, label='Current cloud freshness cutoff')
axes[0].set(title='A. Same hour, both channels required', xlabel='Nominal slot: 01:xx UTC', ylabel='Later object modification delay (min)', xlim=(-1,60), ylim=(0,65))
axes[0].legend(frameon=False, fontsize=8.5, loc='upper left')
axes[1].set(title='B. Retrospective metadata distribution', xlabel='Later object modification delay (min)', ylabel='Pairs at or below this delay (%)', xlim=(0,65), ylim=(0,105))
axes[1].legend(frameon=False, fontsize=8.5, loc='lower right')
arrivals=sorted(probe['arrivals'], key=lambda r:(r['source'], r['nominalSlotUtc']))
labels=[]
for i,row in enumerate(arrivals):
    low=row['appearanceDelayLowerSec']/60
    high=row['appearanceDelayUpperSec']/60
    color='#087e8b' if row['source']=='himawari9' else '#b56a23'
    label=('H9' if row['source']=='himawari9' else 'GK2A')+' '+row['nominalSlotUtc'][11:19]
    labels.append(label)
    axes[2].plot([low,high],[i,i], color=color, lw=3, solid_capstyle='round')
    axes[2].scatter([high],[i], color=color, s=20)
axes[2].set_yticks(range(len(labels)),labels,fontsize=8)
axes[2].invert_yaxis()
axes[2].set(title='C. Live listing appearance brackets', xlabel='Delay after nominal slot (min)', ylabel='Source and nominal UTC slot')
if not arrivals:
    axes[2].text(.5,.5,'No newly complete pairs observed',ha='center',transform=axes[2].transAxes)
for ax in axes:
    ax.grid(alpha=.18)
fig.suptitle('Faster satellite delivery is plausible; predictive value is still unproven', fontsize=17, fontweight='bold')
start=probe['startedAtUtc'][11:19]
end=probe['completedAtUtc'][11:19]
fig.supxlabel(f'October 29, 2026. A–B: 24 Himawari pairs and 30 GK2A pairs, 01 UTC; delayed GK2A tail included. C: polling about every 30 s, {start}–{end} UTC.\n'
    'Initial complete pairs excluded. Modification time and listing appearance are not exact pixel acquisition or usable application receipt. Sources: NOAA / JMA / KMA.',
    fontsize=9, color='#555b65')
dest=ROOT/'docs/assets/seoul-satellite-arrivals-20261029'
fig.savefig(dest.with_suffix('.png'),dpi=170)
fig.savefig(dest.with_suffix('.svg'))
print(dest.with_suffix('.png'))
