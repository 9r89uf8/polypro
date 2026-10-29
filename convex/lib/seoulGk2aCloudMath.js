const MINUTE_MS = 60_000;
const RKSI_LATITUDE = 37.4602;
const RKSI_LONGITUDE = 126.4407;
const MAX_AGE_MS = 12 * MINUTE_MS;
const MAX_GAP_MS = 4 * MINUTE_MS;
const MIN_COMMON_CELLS = 20;
const MIN_AGREEMENT = 0.65;

export const CLOUD_METHOD_VERSION = "rksi-vis-ir-v1";
export const CLOUD_POINTS = Object.freeze(Array.from({ length: 25 }, (_, id) => Object.freeze({
  id,
  latitude: RKSI_LATITUDE + (4 - Math.floor(id / 5) * 2) / 111.32,
  longitude: RKSI_LONGITUDE + ((id % 5) * 2 - 4) / (111.32 * Math.cos(RKSI_LATITUDE * Math.PI / 180)),
})));

const radians = (value) => value * Math.PI / 180;
const degrees = (value) => value * 180 / Math.PI;
const clamp = (value) => Math.max(-1, Math.min(1, value));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const validTime = (value) => finite(value) && Number.isFinite(new Date(value).getTime());
const inRange = (value, low, high) => finite(value) && value >= low && value <= high;
// Absorb only arithmetic roundoff at inclusive change thresholds.
const atLeast = (value, limit) => value >= limit - 1e-12;
const atMost = (value, limit) => value <= limit + 1e-12;
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** NOAA fractional-year solar position, without atmospheric refraction.
 * https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * Azimuth is clockwise from north. Glint compares the solar reflection from
 * a horizontal WGS84 surface with its observer-to-GK2A viewing vector.
 */
export function solarGeometry(time, latitude, longitude) {
  const invalid = { solarElevationDeg: null, cosZenith: null, azimuthDeg: null, glintAngleDeg: null };
  if (!validTime(time) || !inRange(latitude, -90, 90) || !inRange(longitude, -180, 180)) return invalid;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const daysInYear = (Date.UTC(year + 1, 0, 1) - yearStart) / 86400_000;
  const day = Math.floor((time - yearStart) / 86400_000) + 1;
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60_000;
  const gamma = 2 * Math.PI / daysInYear * (day - 1 + (utcMinutes / 60 - 12) / 24);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = ((utcMinutes + equationOfTime + 4 * longitude) % 1440 + 1440) % 1440;
  const hourAngle = radians(trueSolarMinutes / 4 - 180);
  const lat = radians(latitude);
  const lon = radians(longitude);
  const sun = [
    -Math.cos(declination) * Math.sin(hourAngle),
    Math.cos(lat) * Math.sin(declination) - Math.sin(lat) * Math.cos(declination) * Math.cos(hourAngle),
    Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
  ];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const equatorialRadius = 6378137;
  const polarRadius = 6356752.314245;
  const eccentricitySquared = 1 - (polarRadius / equatorialRadius) ** 2;
  const radius = equatorialRadius / Math.sqrt(1 - eccentricitySquared * Math.sin(lat) ** 2);
  const observer = [radius * Math.cos(lat) * Math.cos(lon), radius * Math.cos(lat) * Math.sin(lon),
    radius * (1 - eccentricitySquared) * Math.sin(lat)];
  const satelliteRadius = equatorialRadius + 35785863;
  const satelliteLongitude = radians(128.2);
  const toSatellite = [satelliteRadius * Math.cos(satelliteLongitude) - observer[0],
    satelliteRadius * Math.sin(satelliteLongitude) - observer[1], -observer[2]];
  const distance = Math.hypot(...toSatellite);
  const view = [dot(toSatellite, east), dot(toSatellite, north), dot(toSatellite, up)].map((value) => value / distance);
  const reflectedSun = [-sun[0], -sun[1], sun[2]];
  return {
    solarElevationDeg: degrees(Math.asin(clamp(sun[2]))),
    cosZenith: clamp(sun[2]),
    azimuthDeg: (degrees(Math.atan2(sun[0], sun[1])) + 360) % 360,
    glintAngleDeg: view[2] > 0 ? degrees(Math.acos(clamp(dot(reflectedSun, view)))) : null,
  };
}

export function cloudCollectionWindowOpen(nowMs) {
  const geometry = solarGeometry(nowMs, RKSI_LATITUDE, RKSI_LONGITUDE);
  return finite(geometry.solarElevationDeg) && geometry.solarElevationDeg >= 20 &&
    finite(geometry.glintAngleDeg) && geometry.glintAngleDeg >= 25;
}

function usableRow(row, nowMs) {
  if (!row || !validTime(row.obsTimeUtc) || !validTime(row.acquisitionTimeUtc) ||
      row.obsTimeUtc > nowMs || row.acquisitionTimeUtc > nowMs ||
      row.acquisitionTimeUtc < row.obsTimeUtc - MINUTE_MS || row.acquisitionTimeUtc > row.obsTimeUtc + 2 * MINUTE_MS ||
      row.methodVersion !== CLOUD_METHOD_VERSION || row.source !== "noaa_gk2a_l1b" ||
      (row.stationIcao !== undefined && row.stationIcao !== "RKSI") ||
      !inRange(row.solarElevationDeg, 20, 90) || !inRange(row.reflectance, 0, 1.6) ||
      !inRange(row.brightnessTempK, 150, 330.1) || !Number.isInteger(row.validCellCount) ||
      !inRange(row.validCellCount, MIN_COMMON_CELLS, 25) || !Array.isArray(row.cells)) return null;
  if (!cloudCollectionWindowOpen(row.acquisitionTimeUtc)) return null;
  const cells = new Map();
  const seen = new Set();
  for (const cell of row.cells) {
    if (!Number.isInteger(cell?.id) || cell.id < 0 || cell.id > 24 || seen.has(cell.id)) return null;
    seen.add(cell.id);
    if (inRange(cell.reflectance, 0, 1.6) && inRange(cell.brightnessTempK, 150, 330.1)) cells.set(cell.id, cell);
  }
  if (cells.size !== row.validCellCount || cells.size < MIN_COMMON_CELLS) return null;
  return { ...row, cells };
}

function empty(reason, fields = {}) {
  return { state: "unavailable", sampleCount: 0, coverageMinutes: 0, commonCellCount: 0,
    visibleChange: null, infraredChangeK: null, agreementFraction: null, reason, ...fields };
}

/** Conservative change heuristics, not calibrated cloud amount or a forecast.
 * Pair the same fixed ground cells in both bands, then estimate each cell's
 * Theil–Sen change. Never bridge an invalid row, method change or long gap.
 */
export function summarizeCloudTrend(rows, { nowMs } = {}) {
  if (!validTime(nowMs)) return empty("invalid_clock");
  if (!cloudCollectionWindowOpen(nowMs)) return empty("low_sun_or_glint");
  if (!Array.isArray(rows) || !rows.length) return empty("no_data");
  if (rows.some((row) => !validTime(row?.obsTimeUtc))) return empty("invalid_observation_time");
  const ordered = [...rows].sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
  const latest = ordered.at(-1);
  if (nowMs - latest.obsTimeUtc > MAX_AGE_MS) return empty("stale");
  const counts = new Map();
  for (const row of ordered) counts.set(row.obsTimeUtc, (counts.get(row.obsTimeUtc) ?? 0) + 1);
  const segment = [];
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const row = ordered[i];
    if (latest.obsTimeUtc - row.obsTimeUtc > MAX_AGE_MS) break;
    const usable = counts.get(row.obsTimeUtc) === 1 ? usableRow(row, nowMs) : null;
    if (!usable) {
      if (!segment.length) return empty("invalid_latest");
      break;
    }
    const next = segment.at(-1);
    if (next && (next.obsTimeUtc - row.obsTimeUtc > MAX_GAP_MS ||
        next.acquisitionTimeUtc <= row.acquisitionTimeUtc || next.acquisitionTimeUtc - row.acquisitionTimeUtc > MAX_GAP_MS)) break;
    segment.push(usable);
  }
  segment.reverse();
  const coverageMinutes = (segment.at(-1).obsTimeUtc - segment[0].obsTimeUtc) / MINUTE_MS;
  const commonIds = [...segment[0].cells.keys()].filter((id) => segment.every((row) => row.cells.has(id)));
  const fields = { sampleCount: segment.length, coverageMinutes, commonCellCount: commonIds.length };
  if (segment.length < 4 || coverageMinutes < 6) return empty("insufficient_history", fields);
  if (commonIds.length < MIN_COMMON_CELLS) return empty("insufficient_common_cells", fields);
  const acquisitionSpanMinutes = (segment.at(-1).acquisitionTimeUtc - segment[0].acquisitionTimeUtc) / MINUTE_MS;
  const changes = commonIds.map((id) => {
    const visibleSlopes = [];
    const infraredSlopes = [];
    for (let i = 0; i < segment.length - 1; i += 1) {
      for (let j = i + 1; j < segment.length; j += 1) {
        const elapsedMinutes = (segment[j].acquisitionTimeUtc - segment[i].acquisitionTimeUtc) / MINUTE_MS;
        if (elapsedMinutes < 2) continue;
        const before = segment[i].cells.get(id);
        const after = segment[j].cells.get(id);
        visibleSlopes.push((after.reflectance - before.reflectance) / elapsedMinutes);
        infraredSlopes.push((after.brightnessTempK - before.brightnessTempK) / elapsedMinutes);
      }
    }
    return { visible: median(visibleSlopes) * acquisitionSpanMinutes, infrared: median(infraredSlopes) * acquisitionSpanMinutes };
  });
  const visibleChange = median(changes.map((change) => change.visible));
  const infraredChangeK = median(changes.map((change) => change.infrared));
  const increasingAgreement = changes.filter(({ visible, infrared }) => visible > 0 && infrared < 0).length / commonIds.length;
  const clearingAgreement = changes.filter(({ visible, infrared }) => visible < 0 && infrared > 0).length / commonIds.length;
  const steadyAgreement = changes.filter(({ visible, infrared }) => atMost(Math.abs(visible), 0.02) && atMost(Math.abs(infrared), 1)).length / commonIds.length;
  const evidence = { ...fields, visibleChange, infraredChangeK, increasingAgreement, clearingAgreement, steadyAgreement };
  if (atLeast(visibleChange, 0.04) && atMost(infraredChangeK, -2) && increasingAgreement >= MIN_AGREEMENT) {
    return { ...evidence, state: "increasing", agreementFraction: increasingAgreement, reason: "paired_bands" };
  }
  if (atMost(visibleChange, -0.04) && atLeast(infraredChangeK, 2) && clearingAgreement >= MIN_AGREEMENT) {
    return { ...evidence, state: "clearing", agreementFraction: clearingAgreement, reason: "paired_bands" };
  }
  if (atMost(Math.abs(visibleChange), 0.02) && atMost(Math.abs(infraredChangeK), 1) && steadyAgreement >= MIN_AGREEMENT) {
    return { ...evidence, state: "steady", agreementFraction: steadyAgreement, reason: "paired_bands" };
  }
  return { ...evidence, state: "uncertain", agreementFraction: Math.max(increasingAgreement, clearingAgreement, steadyAgreement), reason: "bands_or_cells_disagree" };
}
