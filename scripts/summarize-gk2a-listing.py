"""Offline, strict paired-channel summary of one retained NOAA S3 XML listing.

Usage: python scripts/summarize-gk2a-listing.py LISTING.xml OUTPUT.json
The resulting file has no invented retrieval clock: record request/response
provenance separately. Preserve the original XML to reproduce every pair.
"""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys
import xml.etree.ElementTree as ET

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
source, destination = map(Path, sys.argv[1:])
raw = source.read_bytes()
root = ET.fromstring(raw)
ns = {'s':'http://s3.amazonaws.com/doc/2006-03-01/'}
if root.findtext('s:IsTruncated', namespaces=ns) != 'false':
    raise ValueError('A complete listing page is required')
prefix = root.findtext('s:Prefix', namespaces=ns)
pattern = re.compile(r'^AMI/L1B/(LA|FD)/(\d{6})/(\d{2})/(\d{2})/gk2a_ami_le1b_(vi006|ir105)_(la|fd)(005|020)ge_(\d{12})\.nc$')
pairs = {}
for item in root.findall('s:Contents', ns):
    key = item.findtext('s:Key', namespaces=ns)
    if not any('_'+band+'_' in key for band in ('vi006','ir105')):
        continue
    match = pattern.fullmatch(key)
    if not match:
        raise ValueError('Unsupported channel object: '+key)
    area, month, day, hour, band, short_area, resolution, stamp = match.groups()
    if area.lower() != short_area or not stamp.startswith(month+day+hour):
        raise ValueError('Path and filename observation identity disagree')
    if resolution != ('005' if band == 'vi006' else '020'):
        raise ValueError('Unexpected band resolution')
    time = dt.datetime.strptime(stamp, '%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
    modified = item.findtext('s:LastModified', namespaces=ns)
    modified_time = dt.datetime.fromisoformat(modified.replace('Z','+00:00'))
    pair = pairs.setdefault(stamp, {'area':area, 'nominalUtc':time.isoformat()})
    field = 'visible' if band == 'vi006' else 'infrared'
    if field in pair:
        raise ValueError('Duplicate channel')
    pair[field] = {'key':key, 'lastModifiedUtc':modified,
        'bytes':int(item.findtext('s:Size', namespaces=ns)),
        'delaySec':(modified_time-time).total_seconds()}
complete, partial = [], []
for stamp, pair in sorted(pairs.items()):
    if 'visible' in pair and 'infrared' in pair:
        pair['pairDelaySec'] = max(pair['visible']['delaySec'],pair['infrared']['delaySec'])
        complete.append(pair)
    else:
        partial.append(pair)
stats = lambda values: {'count':len(values),'min':min(values),'median':statistics.median(values),'max':max(values)} if values else None
result = {'method':'Later channel S3 modification timestamp minus nominal filename timestamp. Retrospective metadata, not first usable receipt.',
    'sourceXmlSha256':hashlib.sha256(raw).hexdigest(), 'prefix':prefix,
    'isTruncated':False,'pairs':complete,'unpairedFrames':partial,
    'summary':{'pairs':len(complete),'unpairedFrames':len(partial),
        'pairDelaySec':stats([p['pairDelaySec'] for p in complete]),
        'visibleDelaySec':stats([p['visible']['delaySec'] for p in complete])}}
destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result['summary'],indent=2))
