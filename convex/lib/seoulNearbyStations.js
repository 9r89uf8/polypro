// The KMA stations around RKSI and the parser for KMA API Hub's one-minute AWS
// text response. KMA's specification for nph-aws2_min defines the columns; the
// response is checked against them because no key was available when this was
// written (see "Stations around the airport" in docs/seoul.md).

export const NEARBY_APPROVAL_FLAG = "KMA_APIHUB_AWS_MINUTE_ACCESS_APPROVED";
export const NEARBY_KEY_NAME = "KMA_APIHUB_AUTH_KEY";
export const NEARBY_SOURCE = "kma_apihub_aws_minute";
export const NEARBY_API_URL = "https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-aws2_min";
export const NEARBY_RETENTION_MS = 48 * 3_600_000;
// Each request asks for this many past minutes, so a missed poll is filled in. It
// is longer than the panel's 10-minute stale limit because KMA's delivery delay is
// not measured: its public page ran about 6 minutes behind, and a shorter window
// would return nothing at all if the API lags the same way.
export const NEARBY_WINDOW_MINUTES = 15;

const KST_OFFSET = 9 * 3_600_000;
const EARTH_RADIUS_KM = 6371.0088;
// KMA's specification: -50 or below means no observation or an error.
const MISSING_AT_OR_BELOW = -50;
const REQUIRED_COLUMNS = ["YYMMDDHHMI", "STN", "WD10", "WS10", "TA"];

export const AIRPORT = { icao: "RKSI", name: "Incheon Airport", latitude: 37.4602, longitude: 126.4407, elevationM: 7 };

// Coordinates and heights are as KMA lists them. Nearest first.
export const NEARBY_STATIONS = [
  { id: 508, name: "Wangsan", nameKo: "왕산", latitude: 37.46649, longitude: 126.36093, elevationM: 141 },
  { id: 665, name: "Muui-do", nameKo: "무의도", latitude: 37.39043, longitude: 126.42521, elevationM: 28 },
  { id: 543, name: "Yeongjong-do", nameKo: "영종도", latitude: 37.499, longitude: 126.54958, elevationM: 26 },
  { id: 577, name: "Jangbong-do", nameKo: "장봉도", latitude: 37.53347, longitude: 126.33659, elevationM: 9 },
];

const radians = (value) => (value * Math.PI) / 180;

/** Great-circle distance and true bearing from one point to another. */
export function distanceAndBearing(from, to) {
  const a = radians(from.latitude), b = radians(to.latitude), delta = radians(to.longitude - from.longitude);
  const haversine = Math.sin((b - a) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(delta / 2) ** 2;
  const bearing = (Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) * 180) / Math.PI;
  return { distanceKm: 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine)), bearingDeg: (bearing + 360) % 360 };
}

export const nearbyStationsWithGeometry = () => NEARBY_STATIONS.map((station) => {
  const { distanceKm, bearingDeg } = distanceAndBearing(AIRPORT, station);
  return { ...station, distanceKm: Math.round(distanceKm * 10) / 10, bearingDeg: Math.round(bearingDeg) };
});

// The approval flag and the key are separate: a key alone never enables anything.
export function nearbyAccess(env) {
  const approved = env[NEARBY_APPROVAL_FLAG] === "true";
  const key = typeof env[NEARBY_KEY_NAME] === "string" ? env[NEARBY_KEY_NAME].trim() : "";
  return { approved, configured: approved && key.length > 0, key: approved ? key : "" };
}

const kstFields = (time) => new Date(time + KST_OFFSET).toISOString();
export const kstDate = (time) => kstFields(time).slice(0, 10);
export const kstMinuteParam = (time) => kstFields(time).slice(0, 16).replace(/[-:T]/g, "");

export function parseKstMinute(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:00`;
  const time = Date.parse(`${iso}+09:00`);
  if (!Number.isFinite(time) || kstFields(time).slice(0, 19) !== iso) return null;
  return { time, local: `${year}-${month}-${day} ${hour}:${minute}` };
}

function reading(token, minimum, maximum) {
  const value = Number(token);
  if (token === undefined || token === "" || !Number.isFinite(value) || value <= MISSING_AT_OR_BELOW) return undefined;
  return value >= minimum && value <= maximum ? value : undefined;
}

export class NearbySourceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// disp=1 separates with commas and can end a row with "=", disp=0 with spaces.
const tokens = (line) => line.replace(/^#\s*/, "").split(/[\s,]+/).filter((token) => token && token !== "=");

/**
 * Reads one station's response. A response that does not look like the
 * documented table, or that names another station, is refused rather than
 * stored under this station's name.
 */
export function parseAwsMinuteResponse(text, stationId) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.some((line) => line.startsWith("#START7777"))) {
    // KMA's specification lists 401 and 403 without saying whether they arrive as
    // the HTTP status or in the body, so a body naming one gets the same label.
    const status = /"status"\s*:\s*"?(401|403)\b/.exec(String(text ?? ""))?.[1];
    if (status) throw nearbyHttpError(Number(status));
    throw new NearbySourceError("format", "KMA response has no #START7777 marker.");
  }
  const header = lines.find((line) => /^#\s*YYMMDDHHMI\b/.test(line));
  if (!header) throw new NearbySourceError("format", "KMA response has no column header.");
  const columns = tokens(header);
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length) throw new NearbySourceError("format", `KMA response is missing columns: ${missing.join(", ")}.`);
  const column = (fields, name) => fields[columns.indexOf(name)];
  const rows = [];
  let malformed = 0, empty = 0;
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const fields = tokens(line);
    if (fields.length < columns.length) { malformed += 1; continue; }
    if (Number(column(fields, "STN")) !== stationId) throw new NearbySourceError("format", `KMA response for station ${stationId} named station ${column(fields, "STN")}.`);
    const parsed = parseKstMinute(column(fields, "YYMMDDHHMI"));
    if (!parsed) { malformed += 1; continue; }
    const tempC = reading(column(fields, "TA"), -49.9, 60);
    const windDirDeg = reading(column(fields, "WD10"), 0, 360);
    const windSpeedMs = reading(column(fields, "WS10"), 0, 100);
    if (tempC === undefined && windDirDeg === undefined && windSpeedMs === undefined) { empty += 1; continue; }
    rows.push({
      stationId, obsTimeUtc: parsed.time, obsTimeLocal: parsed.local, rawLine: line.slice(0, 300),
      ...(tempC !== undefined ? { tempC } : {}),
      ...(windDirDeg !== undefined ? { windDirDeg } : {}),
      ...(windSpeedMs !== undefined ? { windSpeedMs } : {}),
    });
  }
  // Rows that do not fit the table are a format problem, not a quiet minute.
  if (!rows.length && malformed) throw new NearbySourceError("format", `KMA response had ${malformed} row(s) that do not fit the documented table.`);
  return { rows, rejected: malformed + empty };
}

// KMA's specification lists 401 and 403; the rest are general failures.
export function nearbyHttpError(status) {
  if (status === 401) return new NearbySourceError("key_rejected", "KMA API Hub 401: the key is not valid.");
  if (status === 403) return new NearbySourceError("api_not_applied", "KMA API Hub 403: this API needs an application (활용신청) on the key's account.");
  if (status === 429) return new NearbySourceError("rate_limited", "KMA API Hub 429: too many requests.");
  return new NearbySourceError("http_error", `KMA API Hub returned HTTP ${status}.`);
}

// A key must never reach a stored error message.
export function sanitizeNearbyError(message, key) {
  let text = String(message ?? "").replace(/authKey=[^&\s"']+/gi, "authKey=[redacted]");
  if (key) text = text.split(key).join("[redacted]");
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}
