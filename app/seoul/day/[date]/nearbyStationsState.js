import { formatSeoulTime } from "./displayTime.js";

const MINUTE = 60_000;
const KNOTS_PER_MS = 1.94384;
// AMOS's own freshness limit on this page. KMA's delivery delay is not measured
// yet, so the station limit is a first choice to review once it is.
export const AIRPORT_STALE_MS = 3 * MINUTE;
export const STATION_STALE_MS = 10 * MINUTE;
// North-up map, half its width in kilometres. Every station uses the same scale.
export const MAP_SPAN_KM = 16;
const HEIGHT_TAG_FROM_M = 50;
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compassPoint = (degrees) => POINTS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];

const number = (value) => typeof value === "number" && Number.isFinite(value);

export function ageLabel(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / MINUTE);
  if (minutes < 1) return "Under 1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""} ago`;
}

// The map's short form; the table keeps the full age.
function shortAge(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / MINUTE);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`;
}

/** Offset from the map's centre, as a fraction of its half-width (x east, y south). */
export function mapOffset({ distanceKm, bearingDeg }) {
  const radians = (bearingDeg * Math.PI) / 180;
  return { x: (distanceKm * Math.sin(radians)) / MAP_SPAN_KM, y: (-distanceKm * Math.cos(radians)) / MAP_SPAN_KM };
}

const speedLabel = (knots) => (knots < 0.5 ? "under 1 kt" : `${Math.round(knots)} kt`);
// A source that only names a compass point gets no degrees, because it has none.
const direction = (dirDeg, compass) => (compass ? { from: compass, degrees: "" } : { from: compassPoint(dirDeg), degrees: ` (${Math.round(dirDeg)}°)` });

/**
 * Wind direction is where the wind comes from. The arrow shows where the air is
 * going, so `arrowDeg` is the opposite way. Unknown parts stay unknown.
 */
export function describeWind({ dirDeg, speedKt, speedMs, compass }) {
  const hasDir = number(dirDeg), knots = number(speedKt) ? speedKt : number(speedMs) ? speedMs * KNOTS_PER_MS : null;
  if (knots === 0) return { kind: "calm", arrowDeg: null, short: "Calm", detail: "Calm" };
  if (!hasDir && knots === null) return { kind: "missing", arrowDeg: null, short: "Wind not reported", detail: "Wind not reported" };
  const raw = number(speedMs) ? ` (${speedMs.toFixed(1)} m/s)` : "";
  if (knots === null) {
    const { from, degrees } = direction(dirDeg, compass);
    return { kind: "direction_only", arrowDeg: (dirDeg + 180) % 360, short: `from ${from}`, detail: `from ${from}${degrees}, speed not reported` };
  }
  if (!hasDir) return { kind: "speed_only", arrowDeg: null, short: speedLabel(knots), detail: `${speedLabel(knots)}${raw}, direction not reported` };
  const { from, degrees } = direction(dirDeg, compass);
  return { kind: "wind", arrowDeg: (dirDeg + 180) % 360, short: `from ${from} ${speedLabel(knots)}`, detail: `from ${from}${degrees} · ${speedLabel(knots)}${raw}` };
}

function describeReading(reading, now, staleAfterMs) {
  if (!reading || !number(reading.obsTimeUtc)) return { state: "missing", temperature: "—", wind: describeWind({}), observedAt: null, timeLabel: "No reading", ageLabel: "No reading", mapAgeLabel: "No reading" };
  const age = now - reading.obsTimeUtc, stale = age > staleAfterMs;
  return {
    state: stale ? "stale" : "fresh", observedAt: reading.obsTimeUtc, timeLabel: formatSeoulTime(reading.obsTimeUtc),
    ageLabel: stale ? `Stale · ${ageLabel(age)}` : ageLabel(age), mapAgeLabel: stale ? `Stale · ${shortAge(age)}` : ageLabel(age),
    tempC: number(reading.tempC) ? reading.tempC : null,
    temperature: number(reading.tempC) ? `${reading.tempC.toFixed(1)}°` : "—",
    wind: describeWind({ dirDeg: reading.windDirDeg, speedKt: reading.windSpeedKt, speedMs: reading.windSpeedMs, compass: reading.windDirCompass }),
  };
}

const ERROR_LABELS = {
  key_rejected: "KMA rejected the API key",
  api_not_applied: "KMA says the key has no application for this API",
  rate_limited: "KMA limited the requests",
  format: "KMA’s response did not match the expected format",
  http_error: "KMA returned an error",
  network: "KMA could not be reached",
};

// Everything else, such as an unexpected status, is treated as not yet usable.
function panelStatus(dashboard, stations, airportState) {
  const lastAttempt = dashboard.collector?.lastAttemptAt ? formatSeoulTime(dashboard.collector.lastAttemptAt) : null;
  const failure = ERROR_LABELS[dashboard.collector?.errorCode] ?? "KMA could not be read";
  const anyReading = stations.some((station) => station.state !== "missing");
  switch (dashboard.status) {
    case "approval_required": return { kind: "approval_required", badge: "Approval required", tone: "neutral",
      message: "Nearby station readings are off until KMA use is approved, so nothing new is requested from KMA or stored, and no station reading is shown. The airport’s own reading does not need this approval." };
    case "setup_required": return { kind: "setup_required", badge: "Setup required", tone: "neutral",
      message: `The KMA API key is not set, so no new station readings are collected.${anyReading ? " Readings below are the last stored ones." : ""}` };
    case "error": return { kind: "error", badge: "Refresh failed", tone: "delayed",
      message: `The last KMA check${lastAttempt ? ` at ${lastAttempt}` : ""} failed: ${failure}.${anyReading ? " Readings below are the last stored ones." : ""}` };
    case "building": return { kind: "building", badge: "Waiting", tone: "neutral",
      message: lastAttempt ? `The last KMA check at ${lastAttempt} returned no station readings.` : "Waiting for the first KMA station readings." };
    case "partial": return { kind: "partial", badge: "Some missing", tone: "delayed",
      message: `The last KMA check${lastAttempt ? ` at ${lastAttempt}` : ""} did not return every station. Each one below shows its own time.` };
    case "ok":
      if (!stations.some((station) => station.state === "fresh")) return { kind: "delayed", badge: "Delayed", tone: "delayed", message: "No station has a recent reading. KMA’s newest readings have not arrived." };
      if (airportState !== "fresh") return { kind: "delayed", badge: "Delayed", tone: "delayed", message: "The airport’s own reading is old or missing. Station readings are current." };
      return { kind: "ok", badge: "Live", tone: "fresh", message: "" };
    default: return { kind: "unavailable", badge: "Unavailable", tone: "neutral", message: "Nearby station readings are unavailable." };
  }
}

/**
 * Builds the panel from the dashboard query. Readings are shown exactly as
 * stored: nothing is blended, interpolated or adjusted for height. Past and
 * future dates get an explicit note, never a reading.
 */
export function buildNearbyState(dashboard, now, { isToday, isPast = false } = {}) {
  if (!number(now) || (isToday && dashboard === undefined)) return { kind: "loading", badge: "Loading", tone: "neutral", message: "Loading readings around the airport…" };
  if (!isToday) {
    return { kind: "not_live", badge: "Today only", tone: "neutral",
      message: `This panel only shows the latest live readings, so it is empty for ${isPast ? "past" : "future"} dates.` };
  }
  if (dashboard === null) return { kind: "unavailable", badge: "Unavailable", tone: "neutral", message: "Nearby station readings are unavailable." };
  const airportElevationM = dashboard.airport?.elevationM;
  const stations = (dashboard.stations ?? []).map((station) => {
    const aboveAirportM = number(airportElevationM) ? station.elevationM - airportElevationM : null;
    return {
      id: station.id, name: station.name, nameKo: station.nameKo, elevationM: station.elevationM, distanceKm: station.distanceKm, bearingDeg: station.bearingDeg,
      directionLabel: compassPoint(station.bearingDeg), offset: mapOffset(station),
      aboveAirportM, heightNote: number(aboveAirportM) && aboveAirportM >= HEIGHT_TAG_FROM_M ? `${aboveAirportM} m above RKSI` : null,
      ...describeReading(station.reading, now, STATION_STALE_MS),
    };
  });
  const reference = describeReading(dashboard.airport?.reference, now, AIRPORT_STALE_MS);
  const status = panelStatus(dashboard, stations, reference.state);
  return {
    ...status, withheld: status.kind === "approval_required", stations, usesPublicPage: dashboard.source === "kma_public_aws_page",
    airport: {
      name: dashboard.airport?.name ?? "Incheon Airport", icao: dashboard.airport?.icao ?? "RKSI", elevationM: airportElevationM, reference,
      comparison: describeReading(dashboard.airport?.comparison, now, AIRPORT_STALE_MS),
    },
    tallStations: stations.filter((station) => station.heightNote),
  };
}
