// Offline independent cross-check of review-himawari-hsd.py JSON using proj4.
// No network, production writes, or atmospheric retrieval. The 10 km parallax
// example is hypothetical and must never be interpreted as an observed height.
// Usage: node scripts/check-himawari-review.mjs INPUT.json [OUTPUT.json]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import proj4 from 'proj4';

const [input, output] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/check-himawari-review.mjs INPUT.json [OUTPUT.json]');
const bytes = await fs.readFile(input);
const rows = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
assert(Array.isArray(rows) && rows.length > 0);
const visible = rows.filter(row => row.band === 3);
const infrared = rows.filter(row => row.band === 13);
assert(visible.length && visible.length === infrared.length);
let maxPixelDifference = 0, comparedPositions = 0;
for (const row of rows) {
  assert.equal(row.satellite, 'Himawari-9');
  assert.equal(row.format, '1.3');
  assert.equal(row.firstLine, 1);
  assert.equal(row.totalSegments, 1);
  assert.equal(row.cells.length, 25);
  const p = row.projection, height = (p.rsKm - p.aKm) * 1000;
  const projection = `+proj=geos +h=${height} +lon_0=${p.subLon} +a=${p.aKm * 1000} +b=${p.bKm * 1000} +sweep=y +units=m +no_defs`;
  for (const cell of row.cells) {
    const [x, y] = proj4('EPSG:4326', projection, [cell.longitude, cell.latitude]);
    const column = p.coff + x / height * 180 / Math.PI * p.cfac / 65536;
    const line = p.loff - y / height * 180 / Math.PI * p.lfac / 65536;
    const difference = Math.max(Math.abs(column - cell.columnOneBased), Math.abs(line - cell.lineOneBased));
    assert(Number.isFinite(difference) && difference < 1e-6);
    maxPixelDifference = Math.max(maxPixelDifference, difference);
    comparedPositions += 1;
  }
}
const degrees = value => value * 180 / Math.PI;
const radians = value => value * Math.PI / 180;
const distanceKm = (a, b) => Math.hypot((a.latitude - b.latitude) * 111.32,
  (a.longitude - b.longitude) * 111.32 * Math.cos(radians((a.latitude + b.latitude) / 2)));

function hypotheticalApparentCloud(subLongitude, cloudHeightKm) {
  const latitude = 37.4602, longitude = 126.4407;
  const phi = radians(latitude), deltaLongitude = radians(longitude - subLongitude);
  const a = 6378.137, b = 6356.7523, satelliteRadius = 42164;
  const radius = a / Math.sqrt(1 - (1 - (b / a) ** 2) * Math.sin(phi) ** 2);
  const px = (radius + cloudHeightKm) * Math.cos(phi) * Math.cos(deltaLongitude);
  const py = (radius + cloudHeightKm) * Math.cos(phi) * Math.sin(deltaLongitude);
  const pz = (radius * (b / a) ** 2 + cloudHeightKm) * Math.sin(phi);
  const x = Math.atan2(py, satelliteRadius - px);
  const y = -Math.atan2(pz, Math.hypot(satelliteRadius - px, py));
  const coefficient = Math.cos(y) ** 2 + (a / b) ** 2 * Math.sin(y) ** 2;
  const term = satelliteRadius * Math.cos(x) * Math.cos(y);
  const sn = (term - Math.sqrt(term ** 2 - coefficient * (satelliteRadius ** 2 - a ** 2))) / coefficient;
  const sx = satelliteRadius - sn * Math.cos(x) * Math.cos(y);
  const sy = sn * Math.sin(x) * Math.cos(y), sz = -sn * Math.sin(y);
  const result = {
    latitude: degrees(Math.atan2((a / b) ** 2 * sz, Math.hypot(sx, sy))),
    longitude: subLongitude + degrees(Math.atan2(sy, sx)),
  };
  return { ...result, apparentSurfaceDisplacementKm: distanceKm(result, { latitude, longitude }) };
}

const sample = visible.find(row => row.area === 'JP03') ?? visible[0];
const nativeCount = row => new Set(row.cells.map(cell => `${cell.row}:${cell.column}`)).size;
assert(visible.every(row => nativeCount(row) === nativeCount(visible[0])));
assert(infrared.every(row => nativeCount(row) === nativeCount(infrared[0])));
const himawari = hypotheticalApparentCloud(140.7, 10), gk2a = hypotheticalApparentCloud(128.2, 10);
const result = {
  generatedAtUtc: new Date().toISOString(),
  scope: 'Offline independent geometry/calibration checks against saved Himawari-9 files. No atmospheric product validation.',
  calibratedEvidence: input,
  inputSha256: createHash('sha256').update(bytes).digest('hex'),
  geometry: { method: 'Independent Earth-centered Cartesian forward projection compared with proj4 GEOS sweep=y and per-file ellipsoid, radius, longitude, CFAC/LFAC/COFF/LOFF.',
    comparedPositions, maxPixelDifference, allSamplesFirstLine: 1, allSamplesSegments: 1 },
  spatialSampling: { geographicTargets: 25, distinctB03Pixels: nativeCount(visible[0]), distinctB13Pixels: nativeCount(infrared[0]),
    maxB03NearestCenterDistanceKm: Math.max(...visible.flatMap(row => row.cells.map(cell => cell.nearestCenterDistanceKm))),
    maxB13NearestCenterDistanceKm: Math.max(...infrared.flatMap(row => row.cells.map(cell => cell.nearestCenterDistanceKm))),
    warning: 'Target-grid counts are not independent native IR samples; surface projection does not correct cloud parallax.' },
  calibration: { noticeUrl: 'https://www.data.jma.go.jp/mscweb/en/oper/eventlog/Update_of_Calibration_Information_2026.pdf',
    effectiveAtUtc: '2026-10-26T07:00:00Z', embeddedCalibrationUpdateUtc: sample.calibration.updatedAtUtc,
    updatedGain: sample.calibration.updatedGain, updatedOffset: sample.calibration.updatedOffset,
    updatedVsOriginalGainPct: (sample.calibration.updatedGain / sample.calibration.originalGain - 1) * 100,
    maxB13RadianceRoundtripRelativeError: Math.max(...infrared.flatMap(row => row.cells.map(cell => cell.radianceRoundtripRelativeError))) },
  hypotheticalParallax: { assumedCloudHeightKm: 10, trueLatitude: 37.4602, trueLongitude: 126.4407,
    notObservedCloudHeight: true, Himawari9: himawari, GK2A: gk2a,
    betweenApparentSurfaceLocationsKm: distanceKm(himawari, gk2a),
    interpretation: 'Illustration of viewing geometry only; no cloud-height measurement or correction inferred from these images.' },
};
if (output) await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
