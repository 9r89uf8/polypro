"""Plot metadata freshness from a completed, offline satellite probe audit."""
import datetime as dt
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
packages=ROOT/'tmp/seoul-plot-deps'
if packages.exists(): sys.path.insert(0,str(packages))
os.environ.setdefault('MPLCONFIGDIR',str(ROOT/'tmp/seoul-matplotlib'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.dates import DateFormatter

data=json.loads((ROOT/'docs/assets/seoul-satellite-probe-freshness-20261029.json').read_text())
time=lambda text:dt.datetime.fromisoformat(text.replace('Z','+00:00'))
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,
    'figure.facecolor':'#f6f8fb','axes.facecolor':'white'})
fig,ax=plt.subplots(figsize=(11,5.4),layout='constrained')
for source,name,color in [('himawari9','Himawari-9 B03 + B13','#087e8b'),('gk2a','GK2A VI006 + IR105','#b56a23')]:
    rows=[r for r in data['snapshots'] if r['source']==source and r['status']=='observed_complete_metadata']
    ax.plot([time(r['atUtc']) for r in rows],[r['latestNominalAgeSec']/60 for r in rows],
        marker='o',markersize=3,lw=1.6,color=color,label=name)
ax.axhline(12,color='#9d3554',ls='--',lw=1.3,label='Current cloud row: 12-minute freshness cutoff')
ax.set(xlabel='October 29, 2026 · probe response time (UTC)',ylabel='Age of newest complete metadata pair (minutes)',ylim=(0,25))
ax.xaxis.set_major_formatter(DateFormatter('%H:%M',tz=dt.timezone.utc))
ax.grid(alpha=.18)
ax.legend(frameon=False,loc='upper left',fontsize=9)
fig.suptitle('During this probe, GK2A metadata aged while Himawari kept advancing',fontsize=16,fontweight='bold')
fig.supxlabel('25 sampled cycles over twelve minutes; no satellite files were downloaded or quality-checked.\n'
    'Nominal-time metadata freshness does not establish valid cloud-signal uptime or temperature-prediction skill.',fontsize=9,color='#555b65')
target=ROOT/'docs/assets/seoul-satellite-probe-freshness-20261029'
fig.savefig(target.with_suffix('.png'),dpi=170)
fig.savefig(target.with_suffix('.svg'))
print(target.with_suffix('.png'))
