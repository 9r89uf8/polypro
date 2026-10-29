"""Inspect a local NOAA/JMA Himawari Standard Data file at RKSI.

Usage: python scripts/inspect-himawari-rksi.py <local DAT.bz2>
No network requests. HSD v1.3 structure follows the JMA format guide linked in
docs/seoul-edge-research-2026-10-29.md. The output is a footprint/timing check,
not calibrated cloud amount, surface irradiance, or a temperature forecast.
"""

import bz2
import datetime as dt
import json
import math
from pathlib import Path
import struct
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/inspect-himawari-rksi.py <local DAT.bz2>")
path = Path(sys.argv[1])
buf = bz2.decompress(path.read_bytes())
if buf[5] not in (0, 1):
    raise ValueError("Invalid HSD byte order")
endian = '<' if buf[5] == 0 else '>'
def read(fmt, pos):
    value = struct.unpack_from(endian + fmt, buf, pos)
    return value[0] if len(value) == 1 else value
def iso(mjd):
    return (dt.datetime(1858, 11, 17, tzinfo=dt.timezone.utc) + dt.timedelta(days=mjd)).isoformat()
blocks = {}
pos = 0
for _ in range(read('H', 3)):
    number = buf[pos]
    length = read('I' if number == 10 else 'H', pos + 1)
    if number in blocks or not 1 <= number <= 11 or length < 3 or pos + length > len(buf):
        raise ValueError("Invalid HSD header block")
    blocks[number] = (pos, length)
    pos += length
assert pos == read('I', 70)
assert set(blocks) == set(range(1, 12))
p2, _ = blocks[2]
columns, lines = read('HH', p2 + 5)
assert read('H', p2 + 3) == 16 and read('B', p2 + 9) == 0
assert len(buf) - pos == read('I', 74) == columns * lines * 2
p7, _ = blocks[7]
total_segments, segment_sequence, first_line = read('BBH', p7 + 3)
assert first_line >= 1 and 1 <= segment_sequence <= total_segments
p3, _ = blocks[3]
sub_lon = read('d', p3 + 3)
cfac, lfac = read('II', p3 + 11)
coff, loff = read('ff', p3 + 19)
rs, req, rpol = read('ddd', p3 + 27)
lat, lon = 37.4602, 126.4407
phi = math.atan((rpol / req) ** 2 * math.tan(math.radians(lat)))
rc = rpol / math.sqrt(1 - (1 - (rpol / req) ** 2) * math.cos(phi) ** 2)
dlon = math.radians(lon - sub_lon)
r1 = rs - rc * math.cos(phi) * math.cos(dlon)
r2 = -rc * math.cos(phi) * math.sin(dlon)
r3 = rc * math.sin(phi)
rn = math.sqrt(r1*r1 + r2*r2 + r3*r3)
x = math.atan2(-r2, r1)
y = math.asin(-r3 / rn)
column_1 = coff + math.degrees(x) * cfac / 65536
line_1 = loff + math.degrees(y) * lfac / 65536
row, column = math.floor(line_1 + 0.5) - first_line, math.floor(column_1 + 0.5) - 1
p5, _ = blocks[5]
band = read('H', p5 + 3)
valid_bits = read('H', p5 + 13)
errors, outside = read('HH', p5 + 15)
in_rectangle = 0 <= row < lines and 0 <= column < columns
pixel = read('H', pos + 2*(row*columns+column)) if in_rectangle else None
xx = math.radians((column + 1 - coff) * 65536 / cfac)
yy = math.radians((row + first_line - loff) * 65536 / lfac)
den = math.cos(yy)**2 + (req/rpol)**2 * math.sin(yy)**2
sd = (rs*math.cos(xx)*math.cos(yy))**2 - den*(rs**2-req**2)
sn = (rs*math.cos(xx)*math.cos(yy)-math.sqrt(sd))/den
s1 = rs-sn*math.cos(xx)*math.cos(yy)
s2 = sn*math.sin(xx)*math.cos(yy)
s3 = -sn*math.sin(yy)
center_lon = sub_lon + math.degrees(math.atan2(s2,s1))
center_lat = math.degrees(math.atan((req/rpol)**2*s3/math.hypot(s1,s2)))
neighborhood = [read('H',pos+2*(rr*columns+cc)) for rr in range(row-1,row+2) for cc in range(column-1,column+2)] if 1<=row<lines-1 and 1<=column<columns-1 else []
p8, _ = blocks[8]
navigation_corrections = {'rotationMicroradians':read('d',p8+11),'count':read('H',p8+19)}
navigation_corrections['entries'] = [{'line':read('H',p8+21+10*i),'columnShift':read('f',p8+23+10*i),'lineShift':read('f',p8+27+10*i)} for i in range(navigation_corrections['count'])]
if navigation_corrections['rotationMicroradians'] != 0 or any(entry['columnShift'] != 0 or entry['lineShift'] != 0 for entry in navigation_corrections['entries']):
    raise ValueError("Nonzero navigation corrections need separate review before geolocating pixels")
p9, _ = blocks[9]
obs_count = read('H', p9+3)
line_times = [{'line':read('H',p9+5+10*i),'utc':iso(read('d',p9+7+10*i))} for i in range(obs_count)]
result = {
    'file': path.name, 'checkedAtUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
    'format':buf[82:114].decode('ascii').strip('\x00 '), 'area':buf[38:42].decode('ascii'),
    'observationStartUtc':iso(read('d',46)), 'observationEndUtc':iso(read('d',54)),
    'fileCreationUtc':iso(read('d',62)), 'qualityFlags':list(buf[78:82]),
    'columns':columns, 'lines':lines, 'compression':read('B',p2+9),
    'totalSegments':total_segments, 'segmentSequence':segment_sequence, 'firstLine':first_line,
    'band':band, 'projection':{'subLon':sub_lon,'cfac':cfac,'lfac':lfac,'coff':coff,'loff':loff,'rsKm':rs,'equatorialRadiusKm':req,'polarRadiusKm':rpol},
    'rksi':{'lat':lat,'lon':lon,'lineOneBased':line_1,'columnOneBased':column_1,'rowZeroBased':row,'columnZeroBased':column,'inRectangle':in_rectangle,'count':pixel,'errorCode':errors,'outsideScanCode':outside,'validBits':valid_bits,'validCount':in_rectangle and pixel not in (errors,outside) and 0 <= pixel < (1 << valid_bits),'nearestCellCenterLat':center_lat,'nearestCellCenterLon':center_lon,'neighborhood3x3':neighborhood,'validNeighborhoodCount':sum(v not in (errors,outside) and 0 <= v < (1 << valid_bits) for v in neighborhood)},
    'navigationCorrections':navigation_corrections,
    'lineObservationTimes':line_times,
    'note':'Research parser of JMA HSD v1.3 tables. Nonzero navigation corrections are rejected. A valid pixel is not a validated cloud or irradiance retrieval.'
}
print(json.dumps(result, indent=2))
path.with_suffix('.inspection.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
