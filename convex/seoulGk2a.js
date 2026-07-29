import {
  actionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const SEOUL_TIMEZONE = "Asia/Seoul";
const RKSI_STATION_ICAO = "RKSI";
const RKSI_LATITUDE = 37.4602;
const RKSI_LONGITUDE = 126.4407;
const RKSI_REPRESENTATIVE_RUNWAY_NO = "2";
const RKSI_REPRESENTATIVE_RUNWAY_DIRECTION = "15L";

const KMA_GK2A_POINT_URL =
  "https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph_sun_sat_txt";
const KMA_SOURCE = "kma_api_hub_gk2a";
const KMA_SOURCE_ENDPOINT = "nph_sun_sat_txt";
const PRODUCT_CADENCE_MINUTES = 10;
const COLLECTION_LOOKBACK_MINUTES = 80;
const FETCH_TIMEOUT_MS = 20_000;
const MILLIS_PER_MINUTE = 60 * 1000;
const MAX_RECENT_WIND_AGE_MINUTES = 45;
const MIN_UPWIND_WIND_SPEED_KT = 2;
const TRANSMISSION_MIN_CLEAR_SKY_WM2 = 50;
const TRANSMISSION_MAX_PCT = 200;
const FRESH_OBSERVATION_AGE_MINUTES = 35;
const UPWIND_HORIZONS_MINUTES = [20, 40, 60];

const COLLECTOR_STATUS = {
  OK: "ok",
  PARTIAL: "partial",
  NO_DATA: "no_data",
  ERROR: "error",
  UNCONFIGURED: "unconfigured",
};

const POINT_KIND = {
  AIRPORT: "airport",
  UPWIND_20M: "upwind_20m",
  UPWIND_40M: "upwind_40m",
  UPWIND_60M: "upwind_60m",
};

const pointKindByHorizon = new Map([
  [20, POINT_KIND.UPWIND_20M],
  [40, POINT_KIND.UPWIND_40M],
  [60, POINT_KIND.UPWIND_60M],
]);

const seoulDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const seoulDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

function getDateParts(formatter, date) {
  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatSeoulDate(epochMs) {
  const parts = getDateParts(seoulDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatSeoulDateTime(epochMs) {
  const parts = getDateParts(seoulDateTimeFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatUtcRequestTimestamp(epochMs) {
  const date = new Date(epochMs);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
  ].join("");
}

function isValidDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function shiftDateKey(dateKey, deltaDays) {
  const parsed = new Date(`${dateKey}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toNonEmptyString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function getKmaApiHubAuthKey() {
  return toNonEmptyString(process.env.KMA_API_HUB_AUTH_KEY);
}

function normalizeStationIcao(value) {
  const stationIcao = String(value ?? RKSI_STATION_ICAO)
    .trim()
    .toUpperCase();
  if (stationIcao !== RKSI_STATION_ICAO) {
    throw new Error("The GK2A solar collector currently supports RKSI only.");
  }
  return stationIcao;
}

function formatErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([?&]authKey=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function parseFiniteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(
      String(value).trim(),
    )
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUtcTimestampParts(year, month, day, hour, minute, second = 0) {
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const parsed = new Date(epochMs);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    return null;
  }
  return epochMs;
}

function parseCompactUtcTimestamp(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(
    String(value ?? "").trim(),
  );
  if (!match) {
    return null;
  }
  return parseUtcTimestampParts(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  );
}

function findUtcTimestamp(line, tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const epochMs = parseCompactUtcTimestamp(tokens[index]);
    if (Number.isFinite(epochMs)) {
      return { epochMs, tokenIndex: index };
    }
  }

  const separated = String(line).match(
    /\b(\d{4})[-/.](\d{2})[-/.](\d{2})[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?\b/,
  );
  if (!separated) {
    return null;
  }
  const epochMs = parseUtcTimestampParts(
    Number(separated[1]),
    Number(separated[2]),
    Number(separated[3]),
    Number(separated[4]),
    Number(separated[5]),
    Number(separated[6] ?? 0),
  );
  return Number.isFinite(epochMs) ? { epochMs, tokenIndex: -1 } : null;
}

function splitKmaLine(line) {
  return String(line)
    .trim()
    .replace(/^\uFEFF/, "")
    .split(/[,\s|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeHeaderToken(token) {
  return String(token ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
}

function isRadiationHeaderColumn(column, product) {
  return (
    column === product || new RegExp(`^${product}_?W(?:M2|M)?$`).test(column)
  );
}

function findHeaderColumns(lines, product) {
  let best = null;
  for (const line of lines) {
    if (/\b\d{12,14}\b/.test(line)) {
      continue;
    }
    const columns = splitKmaLine(line.replace(/^\s*#+\s*/, "")).map(
      normalizeHeaderToken,
    );
    const hasTime = columns.some((column) =>
      /^(?:TM|TIME|DATETIME|DATE)(?:UTC|KST)?$/.test(column),
    );
    const hasValue = columns.some(
      (column) =>
        ["VALUE", "VAL", "DATA"].includes(column) ||
        isRadiationHeaderColumn(column, product),
    );
    if (hasTime && hasValue) {
      best = columns;
    }
  }
  return best;
}

function valueAtHeaderColumn(tokens, headerColumns, acceptedColumns) {
  if (!headerColumns || headerColumns.length !== tokens.length) {
    return null;
  }
  const index = headerColumns.findIndex(
    (column) =>
      acceptedColumns.includes(column) ||
      acceptedColumns.some(
        (accepted) =>
          (["DSR", "ASR"].includes(accepted) &&
            isRadiationHeaderColumn(column, accepted)) ||
          (["LAT", "LON"].includes(accepted) && column.startsWith(accepted)),
      ),
  );
  return index >= 0 ? parseFiniteNumber(tokens[index]) : null;
}

function findCoordinateTokenIndex(tokens, expectedValue, excludedIndexes) {
  let bestIndex = -1;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = 0; index < tokens.length; index += 1) {
    if (excludedIndexes.has(index)) {
      continue;
    }
    const value = parseFiniteNumber(tokens[index]);
    if (!Number.isFinite(value)) {
      continue;
    }
    const difference = Math.abs(value - expectedValue);
    if (difference <= 0.25 && difference < bestDifference) {
      bestIndex = index;
      bestDifference = difference;
    }
  }
  return bestIndex;
}

function extractRadiationValue({
  line,
  tokens,
  headerColumns,
  product,
  timestampTokenIndex,
  expectedLatitude,
  expectedLongitude,
}) {
  const headerValue = valueAtHeaderColumn(tokens, headerColumns, [
    product,
    "VALUE",
    "VAL",
    "DATA",
  ]);
  if (Number.isFinite(headerValue)) {
    return headerValue;
  }

  const labelledMatch = new RegExp(
    `\\b${product}\\b\\s*[:=]?\\s*([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?)`,
    "i",
  ).exec(line);
  if (labelledMatch) {
    return parseFiniteNumber(labelledMatch[1]);
  }

  const excludedIndexes = new Set(
    timestampTokenIndex >= 0 ? [timestampTokenIndex] : [],
  );
  const latitudeIndex = findCoordinateTokenIndex(
    tokens,
    expectedLatitude,
    excludedIndexes,
  );
  if (latitudeIndex >= 0) {
    excludedIndexes.add(latitudeIndex);
  }
  const longitudeIndex = findCoordinateTokenIndex(
    tokens,
    expectedLongitude,
    excludedIndexes,
  );
  if (longitudeIndex >= 0) {
    excludedIndexes.add(longitudeIndex);
  }

  const candidates = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (excludedIndexes.has(index)) {
      continue;
    }
    const value = parseFiniteNumber(tokens[index]);
    if (Number.isFinite(value)) {
      candidates.push(value);
    }
  }
  // KMA's standard point rows leave a single numeric value after the UTC
  // timestamp and nearest-grid coordinates are excluded. If a future format
  // adds an unlabelled quality flag or grid index, reject the ambiguous row
  // instead of silently storing the wrong numeric column as radiation.
  return candidates.length === 1 ? candidates[0] : null;
}

function extractSourceCoordinate(tokens, headerColumns, name, fallback) {
  const acceptedColumns =
    name === "latitude" ? ["LAT", "LATITUDE"] : ["LON", "LONGITUDE"];
  const headerValue = valueAtHeaderColumn(
    tokens,
    headerColumns,
    acceptedColumns,
  );
  if (Number.isFinite(headerValue)) {
    return headerValue;
  }

  const expected = fallback;
  let best = null;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const value = parseFiniteNumber(token);
    if (!Number.isFinite(value)) {
      continue;
    }
    const difference = Math.abs(value - expected);
    if (difference <= 0.25 && difference < bestDifference) {
      best = value;
      bestDifference = difference;
    }
  }
  return best;
}

function parseKmaErrorPayload(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const payload = JSON.parse(trimmed);
    const status = Number(payload?.result?.status ?? payload?.status);
    const message =
      toNonEmptyString(payload?.result?.message) ??
      toNonEmptyString(payload?.message);
    return status >= 400 || message ? { status, message } : null;
  } catch {
    return null;
  }
}

function parseKmaPointProductText(text, product, point) {
  const apiError = parseKmaErrorPayload(text);
  if (apiError) {
    throw new Error(
      `KMA API Hub ${product} response error${
        Number.isFinite(apiError.status) ? ` ${apiError.status}` : ""
      }: ${apiError.message ?? "unknown error"}`,
    );
  }

  const body = String(text ?? "").replace(/^\uFEFF/, "");
  if (
    /<html[\s>]/i.test(body) ||
    /(유효한\s*인증키가\s*아닙니다|unauthorized|invalid\s+auth)/i.test(body)
  ) {
    throw new Error(`KMA API Hub ${product} returned an authentication error.`);
  }

  const lines = body.split(/\r?\n/);
  const headerColumns = findHeaderColumns(lines, product);
  const rowsByTime = new Map();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const tokens = splitKmaLine(line);
    const timestamp = findUtcTimestamp(line, tokens);
    if (!timestamp) {
      continue;
    }
    const value = extractRadiationValue({
      line,
      tokens,
      headerColumns,
      product,
      timestampTokenIndex: timestamp.tokenIndex,
      expectedLatitude: point.latitude,
      expectedLongitude: point.longitude,
    });
    if (!Number.isFinite(value) || value < 0 || value > 2000) {
      continue;
    }
    rowsByTime.set(timestamp.epochMs, {
      obsTimeUtc: timestamp.epochMs,
      value: round(value, 2),
      sourceLatitude: extractSourceCoordinate(
        tokens,
        headerColumns,
        "latitude",
        point.latitude,
      ),
      sourceLongitude: extractSourceCoordinate(
        tokens,
        headerColumns,
        "longitude",
        point.longitude,
      ),
      rawLine: line.slice(0, 500),
    });
  }

  return [...rowsByTime.values()].sort(
    (left, right) => left.obsTimeUtc - right.obsTimeUtc,
  );
}

function buildKmaPointProductUrl({
  authKey,
  product,
  point,
  requestStartUtc,
  requestEndUtc,
}) {
  const url = new URL(KMA_GK2A_POINT_URL);
  url.searchParams.set("tm1", formatUtcRequestTimestamp(requestStartUtc));
  url.searchParams.set("tm2", formatUtcRequestTimestamp(requestEndUtc));
  url.searchParams.set("int", String(PRODUCT_CADENCE_MINUTES));
  url.searchParams.set("varn", product);
  url.searchParams.set("lat", point.latitude.toFixed(6));
  url.searchParams.set("lon", point.longitude.toFixed(6));
  url.searchParams.set("authKey", authKey);
  return url;
}

async function fetchKmaPointProductRows({
  authKey,
  product,
  point,
  requestStartUtc,
  requestEndUtc,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      buildKmaPointProductUrl({
        authKey,
        product,
        point,
        requestStartUtc,
        requestEndUtc,
      }),
      {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "text/plain,*/*",
          "Cache-Control": "no-cache",
        },
      },
    );
    const body = await response.text();
    if (!response.ok) {
      const apiError = parseKmaErrorPayload(body);
      throw new Error(
        `KMA API Hub ${product} fetch failed (${response.status}): ${
          apiError?.message ?? body.slice(0, 180)
        }`,
      );
    }
    return parseKmaPointProductText(body, product, point);
  } finally {
    clearTimeout(timeoutId);
  }
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

function dayOfYearUtc(epochMs) {
  const date = new Date(epochMs);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((epochMs - yearStart) / (24 * 60 * 60 * 1000)) + 1;
}

function solarPosition(epochMs, latitude, longitude) {
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const daysInYear =
    Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1) > 365 * 24 * 60 * 60 * 1000
      ? 366
      : 365;
  const utcHour =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const fractionalYear =
    ((2 * Math.PI) / daysInYear) *
    (dayOfYearUtc(epochMs) - 1 + (utcHour - 12) / 24);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(fractionalYear) -
      0.032077 * Math.sin(fractionalYear) -
      0.014615 * Math.cos(2 * fractionalYear) -
      0.040849 * Math.sin(2 * fractionalYear));
  const declination =
    0.006918 -
    0.399912 * Math.cos(fractionalYear) +
    0.070257 * Math.sin(fractionalYear) -
    0.006758 * Math.cos(2 * fractionalYear) +
    0.000907 * Math.sin(2 * fractionalYear) -
    0.002697 * Math.cos(3 * fractionalYear) +
    0.00148 * Math.sin(3 * fractionalYear);
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarMinutes =
    (((utcMinutes + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440;
  const hourAngleDegrees =
    trueSolarMinutes / 4 < 0
      ? trueSolarMinutes / 4 + 180
      : trueSolarMinutes / 4 - 180;
  const latitudeRadians = degreesToRadians(latitude);
  const hourAngle = degreesToRadians(hourAngleDegrees);
  const cosineZenith = clamp(
    Math.sin(latitudeRadians) * Math.sin(declination) +
      Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngle),
    -1,
    1,
  );
  return {
    cosineZenith,
    solarElevationDeg: radiansToDegrees(Math.asin(cosineZenith)),
  };
}

function haurwitzClearSkyDsr(epochMs, latitude, longitude) {
  const position = solarPosition(epochMs, latitude, longitude);
  const clearSkyDsrWm2 =
    position.cosineZenith > 0
      ? 1098 * position.cosineZenith * Math.exp(-0.059 / position.cosineZenith)
      : 0;
  return {
    solarElevationDeg: round(position.solarElevationDeg, 2),
    clearSkyDsrWm2: round(Math.max(0, clearSkyDsrWm2), 1),
  };
}

function destinationPoint(latitude, longitude, bearingDegrees, distanceKm) {
  const earthRadiusKm = 6371.0088;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearing = degreesToRadians(bearingDegrees);
  const latitudeRadians = degreesToRadians(latitude);
  const longitudeRadians = degreesToRadians(longitude);
  const destinationLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance) +
      Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude =
    longitudeRadians +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
      Math.cos(angularDistance) -
        Math.sin(latitudeRadians) * Math.sin(destinationLatitude),
    );
  return {
    latitude: round(radiansToDegrees(destinationLatitude), 6),
    longitude: round(
      ((radiansToDegrees(destinationLongitude) + 540) % 360) - 180,
      6,
    ),
  };
}

function buildSamplingPoints(wind, collectionRunAt) {
  const airport = {
    pointKind: POINT_KIND.AIRPORT,
    sampleKey: POINT_KIND.AIRPORT,
    latitude: RKSI_LATITUDE,
    longitude: RKSI_LONGITUDE,
  };
  if (!wind) {
    return {
      points: [airport],
      upwindStatus: "unavailable",
      upwindReason: "No recent representative AMOS wind is stored.",
    };
  }
  if (wind.ageMinutes > MAX_RECENT_WIND_AGE_MINUTES) {
    return {
      points: [airport],
      upwindStatus: "unavailable",
      upwindReason: "The latest representative AMOS wind is stale.",
      wind,
    };
  }
  if (wind.windSpeedKt < MIN_UPWIND_WIND_SPEED_KT) {
    return {
      points: [airport],
      upwindStatus: "calm",
      upwindReason: `Wind below ${MIN_UPWIND_WIND_SPEED_KT} kt does not define a useful upwind corridor.`,
      wind,
    };
  }

  const upwindPoints = UPWIND_HORIZONS_MINUTES.map((upwindMinutes) => {
    const distanceUpwindKm = Math.min(
      120,
      (wind.windSpeedKt * 1.852 * upwindMinutes) / 60,
    );
    const coordinate = destinationPoint(
      RKSI_LATITUDE,
      RKSI_LONGITUDE,
      wind.windDirectionFromDeg,
      distanceUpwindKm,
    );
    return {
      pointKind: pointKindByHorizon.get(upwindMinutes),
      sampleKey: `${pointKindByHorizon.get(upwindMinutes)}:${collectionRunAt}`,
      ...coordinate,
      upwindMinutes,
      distanceUpwindKm: round(distanceUpwindKm, 2),
    };
  }).filter(
    (point) =>
      point.latitude >= 33 &&
      point.latitude <= 43 &&
      point.longitude >= 124 &&
      point.longitude <= 132,
  );

  return {
    points: [airport, ...upwindPoints],
    upwindStatus: upwindPoints.length === 3 ? "available" : "partial",
    upwindReason:
      upwindPoints.length === 3
        ? null
        : "One or more wind-projected points fell outside the supported GK2A point-query domain.",
    wind,
  };
}

async function fetchPointProducts({
  authKey,
  point,
  requestStartUtc,
  requestEndUtc,
}) {
  const [dsrResult, asrResult] = await Promise.allSettled(
    ["DSR", "ASR"].map((product) =>
      fetchKmaPointProductRows({
        authKey,
        product,
        point,
        requestStartUtc,
        requestEndUtc,
      }),
    ),
  );
  return {
    point,
    dsrRows: dsrResult.status === "fulfilled" ? dsrResult.value : [],
    asrRows: asrResult.status === "fulfilled" ? asrResult.value : [],
    errors: [
      ...(dsrResult.status === "rejected"
        ? [`DSR: ${formatErrorMessage(dsrResult.reason)}`]
        : []),
      ...(asrResult.status === "rejected"
        ? [`ASR: ${formatErrorMessage(asrResult.reason)}`]
        : []),
    ],
  };
}

function mergePointProductRows({
  pointResult,
  wind,
  collectionRunAt,
  keepHistory,
}) {
  const rowsByTime = new Map();
  for (const row of pointResult.dsrRows) {
    rowsByTime.set(row.obsTimeUtc, {
      obsTimeUtc: row.obsTimeUtc,
      dsrWm2: row.value,
      dsrRawLine: row.rawLine,
      sourceLatitude: row.sourceLatitude,
      sourceLongitude: row.sourceLongitude,
    });
  }
  for (const row of pointResult.asrRows) {
    const existing = rowsByTime.get(row.obsTimeUtc) ?? {
      obsTimeUtc: row.obsTimeUtc,
    };
    rowsByTime.set(row.obsTimeUtc, {
      ...existing,
      asrWm2: row.value,
      asrRawLine: row.rawLine,
      sourceLatitude: existing.sourceLatitude ?? row.sourceLatitude,
      sourceLongitude: existing.sourceLongitude ?? row.sourceLongitude,
    });
  }

  let mergedRows = [...rowsByTime.values()].sort(
    (left, right) => left.obsTimeUtc - right.obsTimeUtc,
  );
  if (!keepHistory) {
    const latestWithDsr = [...mergedRows]
      .reverse()
      .find((row) => Number.isFinite(row.dsrWm2));
    mergedRows = latestWithDsr ? [latestWithDsr] : [];
  }

  return mergedRows.map((row) => {
    const applicableWind =
      wind &&
      (pointResult.point.pointKind !== POINT_KIND.AIRPORT ||
        Math.abs(wind.obsTimeUtc - row.obsTimeUtc) <= 30 * MILLIS_PER_MINUTE)
        ? wind
        : null;
    const clearSky = haurwitzClearSkyDsr(
      row.obsTimeUtc,
      pointResult.point.latitude,
      pointResult.point.longitude,
    );
    const rawTransmissionPct =
      Number.isFinite(row.dsrWm2) &&
      clearSky.clearSkyDsrWm2 >= TRANSMISSION_MIN_CLEAR_SKY_WM2
        ? (row.dsrWm2 / clearSky.clearSkyDsrWm2) * 100
        : null;
    const transmissionPct =
      Number.isFinite(rawTransmissionPct) &&
      rawTransmissionPct >= 0 &&
      rawTransmissionPct <= TRANSMISSION_MAX_PCT
        ? round(rawTransmissionPct, 1)
        : null;
    return {
      stationIcao: RKSI_STATION_ICAO,
      date: formatSeoulDate(row.obsTimeUtc),
      obsTimeUtc: row.obsTimeUtc,
      obsTimeLocal: formatSeoulDateTime(row.obsTimeUtc),
      pointKind: pointResult.point.pointKind,
      sampleKey: pointResult.point.sampleKey,
      latitude: pointResult.point.latitude,
      longitude: pointResult.point.longitude,
      ...(Number.isFinite(row.sourceLatitude)
        ? { sourceLatitude: row.sourceLatitude }
        : {}),
      ...(Number.isFinite(row.sourceLongitude)
        ? { sourceLongitude: row.sourceLongitude }
        : {}),
      ...(Number.isFinite(pointResult.point.upwindMinutes)
        ? { upwindMinutes: pointResult.point.upwindMinutes }
        : {}),
      ...(Number.isFinite(pointResult.point.distanceUpwindKm)
        ? { distanceUpwindKm: pointResult.point.distanceUpwindKm }
        : {}),
      ...(Number.isFinite(row.dsrWm2) ? { dsrWm2: row.dsrWm2 } : {}),
      ...(Number.isFinite(row.asrWm2) ? { asrWm2: row.asrWm2 } : {}),
      clearSkyDsrWm2: clearSky.clearSkyDsrWm2,
      solarElevationDeg: clearSky.solarElevationDeg,
      ...(Number.isFinite(transmissionPct) ? { transmissionPct } : {}),
      ...(row.dsrRawLine ? { dsrRawLine: row.dsrRawLine } : {}),
      ...(row.asrRawLine ? { asrRawLine: row.asrRawLine } : {}),
      ...(applicableWind
        ? {
            windObservedAtUtc: applicableWind.obsTimeUtc,
            windDirectionFromDeg: applicableWind.windDirectionFromDeg,
            windSpeedKt: applicableWind.windSpeedKt,
            windSpeedMps: applicableWind.windSpeedMps,
          }
        : {}),
      source: KMA_SOURCE,
      sourceEndpoint: KMA_SOURCE_ENDPOINT,
      productCadenceMinutes: PRODUCT_CADENCE_MINUTES,
      collectionRunAt,
    };
  });
}

const pointKindValidator = v.union(
  v.literal(POINT_KIND.AIRPORT),
  v.literal(POINT_KIND.UPWIND_20M),
  v.literal(POINT_KIND.UPWIND_40M),
  v.literal(POINT_KIND.UPWIND_60M),
);

const collectorStatusValidator = v.union(
  v.literal(COLLECTOR_STATUS.OK),
  v.literal(COLLECTOR_STATUS.PARTIAL),
  v.literal(COLLECTOR_STATUS.NO_DATA),
  v.literal(COLLECTOR_STATUS.ERROR),
  v.literal(COLLECTOR_STATUS.UNCONFIGURED),
);

const solarObservationValidator = v.object({
  stationIcao: v.string(),
  date: v.string(),
  obsTimeUtc: v.number(),
  obsTimeLocal: v.string(),
  pointKind: pointKindValidator,
  sampleKey: v.string(),
  latitude: v.number(),
  longitude: v.number(),
  sourceLatitude: v.optional(v.number()),
  sourceLongitude: v.optional(v.number()),
  upwindMinutes: v.optional(v.number()),
  distanceUpwindKm: v.optional(v.number()),
  dsrWm2: v.optional(v.number()),
  asrWm2: v.optional(v.number()),
  clearSkyDsrWm2: v.number(),
  solarElevationDeg: v.number(),
  transmissionPct: v.optional(v.number()),
  dsrRawLine: v.optional(v.string()),
  asrRawLine: v.optional(v.string()),
  windObservedAtUtc: v.optional(v.number()),
  windDirectionFromDeg: v.optional(v.number()),
  windSpeedKt: v.optional(v.number()),
  windSpeedMps: v.optional(v.number()),
  source: v.string(),
  sourceEndpoint: v.string(),
  productCadenceMinutes: v.number(),
  collectionRunAt: v.number(),
});

function observationChanged(existing, candidate) {
  const fields = [
    "obsTimeLocal",
    "latitude",
    "longitude",
    "sourceLatitude",
    "sourceLongitude",
    "upwindMinutes",
    "distanceUpwindKm",
    "dsrWm2",
    "asrWm2",
    "clearSkyDsrWm2",
    "solarElevationDeg",
    "transmissionPct",
    "dsrRawLine",
    "asrRawLine",
    "windObservedAtUtc",
    "windDirectionFromDeg",
    "windSpeedKt",
    "windSpeedMps",
    "source",
    "sourceEndpoint",
    "productCadenceMinutes",
    "collectionRunAt",
  ];
  return fields.some(
    (field) =>
      Object.prototype.hasOwnProperty.call(candidate, field) &&
      existing[field] !== candidate[field],
  );
}

function windCadenceScore(row) {
  if (row.collectionCadence === "one_minute") {
    return 2;
  }
  if (row.collectionCadence === "five_minute") {
    return 1;
  }
  return 0;
}

export const getRecentWindForCollector = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const currentDate = formatSeoulDate(args.now);
    const previousDate = shiftDateKey(currentDate, -1);
    const rowGroups = await Promise.all(
      [currentDate, previousDate].map((date) =>
        ctx.db
          .query("seoulAmosObservations")
          .withIndex("by_station_date_rwy_ts", (query) =>
            query
              .eq("stationIcao", args.stationIcao)
              .eq("date", date)
              .eq("rwyNo", RKSI_REPRESENTATIVE_RUNWAY_NO)
              .eq("rwyDir", RKSI_REPRESENTATIVE_RUNWAY_DIRECTION),
          )
          .order("desc")
          .take(20),
      ),
    );
    const rows = rowGroups
      .flat()
      .filter(
        (row) =>
          Number.isFinite(row.obsTimeUtc) &&
          Number.isFinite(row.windDirAvg) &&
          Number.isFinite(row.windSpeedAvg),
      )
      .sort(
        (left, right) =>
          right.obsTimeUtc - left.obsTimeUtc ||
          windCadenceScore(right) - windCadenceScore(left),
      );
    const latest = rows[0] ?? null;
    if (!latest) {
      return null;
    }
    const ageMinutes =
      Math.max(0, args.now - latest.obsTimeUtc) / MILLIS_PER_MINUTE;
    const windDirectionFromDeg =
      ((Number(latest.windDirAvg) % 360) + 360) % 360;
    const windSpeedKt = Math.max(0, Number(latest.windSpeedAvg));
    return {
      obsTimeUtc: latest.obsTimeUtc,
      obsTimeLocal: latest.obsTimeLocal,
      ageMinutes: round(ageMinutes, 1),
      windDirectionFromDeg: round(windDirectionFromDeg, 1),
      windSpeedKt: round(windSpeedKt, 1),
      windSpeedMps: round(windSpeedKt * 0.514444, 2),
      collectionCadence: latest.collectionCadence ?? "legacy",
    };
  },
});

export const upsertSolarObservations = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(solarObservationValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedCount = 0;
    let patchedCount = 0;
    let unchangedCount = 0;
    let latestObsTimeUtc = null;

    for (const row of args.rows) {
      if (!isValidDateKey(row.date)) {
        throw new Error(`Invalid GK2A observation date: ${row.date}`);
      }
      const existing = await ctx.db
        .query("seoulGk2aSolarObservations")
        .withIndex("by_station_date_sample_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("sampleKey", row.sampleKey)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();
      latestObsTimeUtc = Math.max(
        latestObsTimeUtc ?? Number.NEGATIVE_INFINITY,
        row.obsTimeUtc,
      );

      if (!existing) {
        await ctx.db.insert("seoulGk2aSolarObservations", {
          ...row,
          firstSeenAt: now,
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }
      if (!observationChanged(existing, row)) {
        unchangedCount += 1;
        continue;
      }
      await ctx.db.patch(existing._id, {
        ...row,
        updatedAt: now,
      });
      patchedCount += 1;
    }

    return {
      insertedCount,
      patchedCount,
      unchangedCount,
      rowCount: args.rows.length,
      latestObsTimeUtc,
    };
  },
});

export const recordCollectorStatus = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    status: collectorStatusValidator,
    configured: v.boolean(),
    lastAttemptAt: v.number(),
    lastAttemptAtLocal: v.string(),
    lastSuccessAt: v.optional(v.number()),
    lastSuccessAtLocal: v.optional(v.string()),
    latestObsTimeUtc: v.optional(v.number()),
    latestObsTimeLocal: v.optional(v.string()),
    lastError: v.optional(v.string()),
    requestedPointCount: v.optional(v.number()),
    storedRowCount: v.optional(v.number()),
    upwindStatus: v.optional(v.string()),
    windObservedAtUtc: v.optional(v.number()),
    windDirectionFromDeg: v.optional(v.number()),
    windSpeedKt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("seoulGk2aCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", args.stationIcao),
      )
      .first();
    const patch = {
      ...args,
      updatedAt: Date.now(),
    };
    if (
      !args.lastError &&
      (args.status === COLLECTOR_STATUS.OK ||
        args.status === COLLECTOR_STATUS.PARTIAL)
    ) {
      patch.lastError = undefined;
    }
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return await ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert("seoulGk2aCollectorStatus", patch);
    return await ctx.db.get(id);
  },
});

async function updateCollectorStatus(ctx, status) {
  return await ctx.runMutation("seoulGk2a:recordCollectorStatus", status);
}

export const pollLatestSolarHeating = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const lastAttemptAt = Date.now();
    const lastAttemptAtLocal = formatSeoulDateTime(lastAttemptAt);
    const authKey = getKmaApiHubAuthKey();

    if (!authKey) {
      const message =
        "KMA_API_HUB_AUTH_KEY is not configured in the Convex deployment.";
      await updateCollectorStatus(ctx, {
        stationIcao,
        status: COLLECTOR_STATUS.UNCONFIGURED,
        configured: false,
        lastAttemptAt,
        lastAttemptAtLocal,
        lastError: message,
        requestedPointCount: 0,
        storedRowCount: 0,
        upwindStatus: "unavailable",
      });
      return {
        ok: false,
        status: COLLECTOR_STATUS.UNCONFIGURED,
        configured: false,
        stationIcao,
        message,
        lastAttemptAt,
        rowCount: 0,
      };
    }

    try {
      const collectionRunAt =
        Math.floor(
          lastAttemptAt / (PRODUCT_CADENCE_MINUTES * MILLIS_PER_MINUTE),
        ) *
        PRODUCT_CADENCE_MINUTES *
        MILLIS_PER_MINUTE;
      const requestEndUtc = collectionRunAt;
      const requestStartUtc =
        requestEndUtc - COLLECTION_LOOKBACK_MINUTES * MILLIS_PER_MINUTE;
      const wind = await ctx.runQuery("seoulGk2a:getRecentWindForCollector", {
        stationIcao,
        now: lastAttemptAt,
      });
      const sampling = buildSamplingPoints(wind, collectionRunAt);
      const pointResults = await Promise.all(
        sampling.points.map((point) =>
          fetchPointProducts({
            authKey,
            point,
            requestStartUtc,
            requestEndUtc,
          }),
        ),
      );
      const rows = pointResults.flatMap((pointResult) =>
        mergePointProductRows({
          pointResult,
          wind: sampling.wind ?? null,
          collectionRunAt,
          keepHistory: pointResult.point.pointKind === POINT_KIND.AIRPORT,
        }),
      );
      const airportDsrRows = rows.filter(
        (row) =>
          row.pointKind === POINT_KIND.AIRPORT && Number.isFinite(row.dsrWm2),
      );
      const requestErrors = pointResults.flatMap((pointResult) =>
        pointResult.errors.map(
          (error) => `${pointResult.point.pointKind} ${error}`,
        ),
      );

      let status;
      if (!rows.length) {
        status = requestErrors.length
          ? COLLECTOR_STATUS.ERROR
          : COLLECTOR_STATUS.NO_DATA;
      } else if (!airportDsrRows.length || requestErrors.length) {
        status = COLLECTOR_STATUS.PARTIAL;
      } else {
        status = COLLECTOR_STATUS.OK;
      }

      const writeResult = rows.length
        ? await ctx.runMutation("seoulGk2a:upsertSolarObservations", {
            stationIcao,
            rows,
          })
        : {
            insertedCount: 0,
            patchedCount: 0,
            unchangedCount: 0,
            rowCount: 0,
            latestObsTimeUtc: null,
          };
      const latestAirportRow = airportDsrRows.at(-1) ?? null;
      const lastError = requestErrors.length
        ? requestErrors.join("; ").slice(0, 500)
        : status === COLLECTOR_STATUS.PARTIAL && !airportDsrRows.length
          ? "KMA API Hub returned no parseable airport DSR rows in the requested window."
          : status === COLLECTOR_STATUS.NO_DATA
            ? "KMA API Hub returned no parseable GK2A point rows in the requested window."
            : undefined;
      const successful =
        status === COLLECTOR_STATUS.OK || status === COLLECTOR_STATUS.PARTIAL;
      await updateCollectorStatus(ctx, {
        stationIcao,
        status,
        configured: true,
        lastAttemptAt,
        lastAttemptAtLocal,
        ...(successful
          ? {
              lastSuccessAt: lastAttemptAt,
              lastSuccessAtLocal: lastAttemptAtLocal,
            }
          : {}),
        ...(latestAirportRow
          ? {
              latestObsTimeUtc: latestAirportRow.obsTimeUtc,
              latestObsTimeLocal: latestAirportRow.obsTimeLocal,
            }
          : {}),
        ...(lastError ? { lastError } : {}),
        requestedPointCount: sampling.points.length,
        storedRowCount: rows.length,
        upwindStatus: sampling.upwindStatus,
        ...(sampling.wind
          ? {
              windObservedAtUtc: sampling.wind.obsTimeUtc,
              windDirectionFromDeg: sampling.wind.windDirectionFromDeg,
              windSpeedKt: sampling.wind.windSpeedKt,
            }
          : {}),
      });

      return {
        ok: successful,
        status,
        configured: true,
        stationIcao,
        lastAttemptAt,
        requestStartUtc,
        requestEndUtc,
        requestedPointCount: sampling.points.length,
        upwindStatus: sampling.upwindStatus,
        ...(sampling.upwindReason
          ? { upwindReason: sampling.upwindReason }
          : {}),
        ...(sampling.wind ? { wind: sampling.wind } : {}),
        ...(latestAirportRow
          ? {
              latestObsTimeUtc: latestAirportRow.obsTimeUtc,
              latestObsTimeLocal: latestAirportRow.obsTimeLocal,
            }
          : {}),
        errors: requestErrors,
        ...writeResult,
      };
    } catch (error) {
      const message = formatErrorMessage(error);
      await updateCollectorStatus(ctx, {
        stationIcao,
        status: COLLECTOR_STATUS.ERROR,
        configured: true,
        lastAttemptAt,
        lastAttemptAtLocal,
        lastError: message,
        storedRowCount: 0,
        upwindStatus: "unknown",
      });
      return {
        ok: false,
        status: COLLECTOR_STATUS.ERROR,
        configured: true,
        stationIcao,
        message,
        lastAttemptAt,
        rowCount: 0,
      };
    }
  },
});

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function findReferenceRow(rows, targetTimeUtc, toleranceMinutes = 15) {
  let best = null;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!Number.isFinite(row.transmissionPct)) {
      continue;
    }
    const difference = Math.abs(row.obsTimeUtc - targetTimeUtc);
    if (
      difference <= toleranceMinutes * MILLIS_PER_MINUTE &&
      difference < bestDifference
    ) {
      best = row;
      bestDifference = difference;
    }
  }
  return best;
}

function transmissionTrend(rows, latest) {
  if (!latest || !Number.isFinite(latest.transmissionPct)) {
    return {
      state: "unavailable",
      slopePctPointsPerHour: null,
      sampleCount: 0,
      coverageMinutes: 0,
    };
  }
  const recent = rows.filter(
    (row) =>
      Number.isFinite(row.transmissionPct) &&
      row.obsTimeUtc >= latest.obsTimeUtc - 60 * MILLIS_PER_MINUTE &&
      row.obsTimeUtc <= latest.obsTimeUtc,
  );
  const coverageMinutes = recent.length
    ? (recent.at(-1).obsTimeUtc - recent[0].obsTimeUtc) / MILLIS_PER_MINUTE
    : 0;
  const slopes = [];
  for (let leftIndex = 0; leftIndex < recent.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < recent.length;
      rightIndex += 1
    ) {
      const elapsedHours =
        (recent[rightIndex].obsTimeUtc - recent[leftIndex].obsTimeUtc) /
        (60 * MILLIS_PER_MINUTE);
      if (elapsedHours >= 1 / 6) {
        slopes.push(
          (recent[rightIndex].transmissionPct -
            recent[leftIndex].transmissionPct) /
            elapsedHours,
        );
      }
    }
  }
  const slope = median(slopes);
  if (recent.length < 3 || coverageMinutes < 30 || !Number.isFinite(slope)) {
    return {
      state: "unavailable",
      slopePctPointsPerHour: null,
      sampleCount: recent.length,
      coverageMinutes: round(coverageMinutes, 1),
    };
  }
  return {
    state: slope >= 5 ? "increasing" : slope <= -5 ? "decreasing" : "steady",
    slopePctPointsPerHour: round(slope, 1),
    sampleCount: recent.length,
    coverageMinutes: round(coverageMinutes, 1),
  };
}

function publicObservation(row) {
  if (!row) {
    return null;
  }
  return {
    obsTimeUtc: row.obsTimeUtc,
    obsTimeLocal: row.obsTimeLocal,
    pointKind: row.pointKind,
    latitude: row.latitude,
    longitude: row.longitude,
    ...(Number.isFinite(row.sourceLatitude)
      ? { sourceLatitude: row.sourceLatitude }
      : {}),
    ...(Number.isFinite(row.sourceLongitude)
      ? { sourceLongitude: row.sourceLongitude }
      : {}),
    ...(Number.isFinite(row.upwindMinutes)
      ? { upwindMinutes: row.upwindMinutes }
      : {}),
    ...(Number.isFinite(row.distanceUpwindKm)
      ? { distanceUpwindKm: row.distanceUpwindKm }
      : {}),
    ...(Number.isFinite(row.dsrWm2) ? { dsrWm2: row.dsrWm2 } : {}),
    ...(Number.isFinite(row.asrWm2) ? { asrWm2: row.asrWm2 } : {}),
    clearSkyDsrWm2: row.clearSkyDsrWm2,
    solarElevationDeg: row.solarElevationDeg,
    ...(Number.isFinite(row.transmissionPct)
      ? { transmissionPct: row.transmissionPct }
      : {}),
    ...(Number.isFinite(row.windObservedAtUtc)
      ? { windObservedAtUtc: row.windObservedAtUtc }
      : {}),
    ...(Number.isFinite(row.windDirectionFromDeg)
      ? { windDirectionFromDeg: row.windDirectionFromDeg }
      : {}),
    ...(Number.isFinite(row.windSpeedKt)
      ? { windSpeedKt: row.windSpeedKt }
      : {}),
    ...(Number.isFinite(row.windSpeedMps)
      ? { windSpeedMps: row.windSpeedMps }
      : {}),
    source: row.source,
    sourceEndpoint: row.sourceEndpoint,
    productCadenceMinutes: row.productCadenceMinutes,
    collectionRunAt: row.collectionRunAt,
  };
}

function dashboardStatusMessage(status, collector, latest, ageMinutes) {
  if (status === COLLECTOR_STATUS.UNCONFIGURED) {
    return "GK2A solar input is unavailable until KMA_API_HUB_AUTH_KEY is configured.";
  }
  if (status === "night") {
    return "Solar transmission is not calculated while modeled clear-sky irradiance is below 50 W/m².";
  }
  if (status === "stale") {
    return `The latest GK2A point observation is ${Math.round(
      ageMinutes,
    )} minutes old.`;
  }
  if (status === COLLECTOR_STATUS.ERROR) {
    return collector?.lastError ?? "The latest GK2A collection attempt failed.";
  }
  if (status === COLLECTOR_STATUS.NO_DATA || !latest) {
    return "No GK2A solar observation is stored for this date.";
  }
  if (status === COLLECTOR_STATUS.PARTIAL) {
    return "GK2A solar data are available, but part of the latest point collection failed.";
  }
  return "GK2A surface shortwave radiation is current.";
}

export const getSolarHeatingDashboard = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const now = Date.now();
    const today = formatSeoulDate(now);
    const date = args.date ?? today;
    if (!isValidDateKey(date)) {
      throw new Error("Date must be a real YYYY-MM-DD calendar date.");
    }

    const [collector, airportRows, ...upwindRowGroups] = await Promise.all([
      ctx.db
        .query("seoulGk2aCollectorStatus")
        .withIndex("by_station", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .first(),
      ctx.db
        .query("seoulGk2aSolarObservations")
        .withIndex("by_station_date_point_ts", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("date", date)
            .eq("pointKind", POINT_KIND.AIRPORT),
        )
        .collect(),
      ...[
        POINT_KIND.UPWIND_20M,
        POINT_KIND.UPWIND_40M,
        POINT_KIND.UPWIND_60M,
      ].map((pointKind) =>
        ctx.db
          .query("seoulGk2aSolarObservations")
          .withIndex("by_station_date_point_ts", (query) =>
            query
              .eq("stationIcao", stationIcao)
              .eq("date", date)
              .eq("pointKind", pointKind),
          )
          .order("desc")
          .take(24),
      ),
    ]);
    const configured = Boolean(getKmaApiHubAuthKey());
    const orderedAirportRows = airportRows
      .filter(
        (row) =>
          row.obsTimeUtc <= now + PRODUCT_CADENCE_MINUTES * MILLIS_PER_MINUTE,
      )
      .sort((left, right) => left.obsTimeUtc - right.obsTimeUtc);
    const latest =
      [...orderedAirportRows]
        .reverse()
        .find((row) => Number.isFinite(row.dsrWm2)) ??
      orderedAirportRows.at(-1) ??
      null;
    const ageMinutes =
      latest && date === today
        ? Math.max(0, now - latest.obsTimeUtc) / MILLIS_PER_MINUTE
        : null;
    const isNight =
      date === today &&
      haurwitzClearSkyDsr(now, RKSI_LATITUDE, RKSI_LONGITUDE).clearSkyDsrWm2 <
        TRANSMISSION_MIN_CLEAR_SKY_WM2;
    let status;
    if (!configured) {
      status = COLLECTOR_STATUS.UNCONFIGURED;
    } else if (isNight) {
      status = "night";
    } else if (
      date === today &&
      latest &&
      ageMinutes > FRESH_OBSERVATION_AGE_MINUTES
    ) {
      status = "stale";
    } else if (collector?.status === COLLECTOR_STATUS.ERROR && date === today) {
      status = COLLECTOR_STATUS.ERROR;
    } else if (!latest) {
      status =
        date === today && collector?.status
          ? collector.status
          : COLLECTOR_STATUS.NO_DATA;
    } else if (
      date === today &&
      collector?.status === COLLECTOR_STATUS.PARTIAL
    ) {
      status = COLLECTOR_STATUS.PARTIAL;
    } else {
      status = COLLECTOR_STATUS.OK;
    }

    const reference30Minutes = latest
      ? findReferenceRow(
          orderedAirportRows,
          latest.obsTimeUtc - 30 * MILLIS_PER_MINUTE,
        )
      : null;
    const change30MinutesPctPoints =
      Number.isFinite(latest?.transmissionPct) &&
      Number.isFinite(reference30Minutes?.transmissionPct)
        ? round(latest.transmissionPct - reference30Minutes.transmissionPct, 1)
        : null;
    const change30mActualMinutes =
      Number.isFinite(latest?.transmissionPct) &&
      Number.isFinite(reference30Minutes?.transmissionPct)
        ? round(
            (latest.obsTimeUtc - reference30Minutes.obsTimeUtc) /
              MILLIS_PER_MINUTE,
            1,
          )
        : null;
    const trend = transmissionTrend(orderedAirportRows, latest);
    const matchingUpwindRows = latest
      ? upwindRowGroups
          .map(
            (rows) =>
              rows.find(
                (row) =>
                  row.collectionRunAt === latest.collectionRunAt &&
                  Math.abs(row.obsTimeUtc - latest.obsTimeUtc) <=
                    15 * MILLIS_PER_MINUTE,
              ) ?? null,
          )
          .filter(Boolean)
      : [];
    const upwindTransmissionPct = median(
      matchingUpwindRows.map((row) => row.transmissionPct),
    );
    const upwindDifferencePctPoints =
      Number.isFinite(upwindTransmissionPct) &&
      Number.isFinite(latest?.transmissionPct)
        ? round(upwindTransmissionPct - latest.transmissionPct, 1)
        : null;
    const cloudClearingUpstream = Number.isFinite(upwindDifferencePctPoints)
      ? upwindDifferencePctPoints >= 10
      : null;
    const upstreamSignal = !Number.isFinite(upwindDifferencePctPoints)
      ? "unavailable"
      : upwindDifferencePctPoints >= 10
        ? "clearing"
        : upwindDifferencePctPoints <= -10
          ? "cloudier"
          : "similar";
    const expectedNextHour =
      upstreamSignal === "clearing"
        ? "increasing"
        : upstreamSignal === "cloudier"
          ? "decreasing"
          : trend.state;
    const upstreamEtaMinutes =
      upstreamSignal === "clearing" || upstreamSignal === "cloudier"
        ? (matchingUpwindRows
            .filter(
              (row) =>
                Number.isFinite(row.transmissionPct) &&
                Number.isFinite(latest?.transmissionPct) &&
                (upstreamSignal === "clearing"
                  ? row.transmissionPct - latest.transmissionPct >= 10
                  : row.transmissionPct - latest.transmissionPct <= -10),
            )
            .sort(
              (left, right) =>
                (left.upwindMinutes ?? Number.POSITIVE_INFINITY) -
                (right.upwindMinutes ?? Number.POSITIVE_INFINITY),
            )[0]?.upwindMinutes ?? null)
        : null;
    const publicHistory = orderedAirportRows.map(publicObservation);

    return {
      stationIcao,
      date,
      today,
      configured,
      status,
      statusMessage: dashboardStatusMessage(
        status,
        collector,
        latest,
        ageMinutes,
      ),
      source: {
        provider: "KMA API Hub",
        satellite: "GK2A",
        endpoint: KMA_SOURCE_ENDPOINT,
        productCadenceMinutes: PRODUCT_CADENCE_MINUTES,
        clearSkyModel: "Haurwitz",
      },
      collector: collector
        ? {
            status: collector.status,
            configured: collector.configured,
            lastAttemptAt: collector.lastAttemptAt,
            lastAttemptAtLocal: collector.lastAttemptAtLocal,
            ...(Number.isFinite(collector.lastSuccessAt)
              ? {
                  lastSuccessAt: collector.lastSuccessAt,
                  lastSuccessAtLocal: collector.lastSuccessAtLocal,
                }
              : {}),
            ...(collector.status !== COLLECTOR_STATUS.OK && collector.lastError
              ? { lastError: collector.lastError }
              : {}),
            ...(collector.upwindStatus
              ? { upwindStatus: collector.upwindStatus }
              : {}),
          }
        : null,
      latest: publicObservation(latest),
      observationAgeMinutes: Number.isFinite(ageMinutes)
        ? round(ageMinutes, 1)
        : null,
      currentDsrWm2: latest?.dsrWm2 ?? null,
      currentAsrWm2: latest?.asrWm2 ?? null,
      currentClearSkyDsrWm2: latest?.clearSkyDsrWm2 ?? null,
      currentSolarTransmissionPct: latest?.transmissionPct ?? null,
      reference30Minutes: publicObservation(reference30Minutes),
      change30MinutesPctPoints,
      change30mPctPoints: change30MinutesPctPoints,
      change30mActualMinutes,
      trend,
      expectedNextHour,
      cloudClearingUpstream,
      upstreamClearing: cloudClearingUpstream,
      upstreamEtaMinutes,
      windDirectionDeg:
        latest?.windDirectionFromDeg ?? collector?.windDirectionFromDeg ?? null,
      windSpeedKt: latest?.windSpeedKt ?? collector?.windSpeedKt ?? null,
      sourceAgeMinutes: Number.isFinite(ageMinutes)
        ? round(ageMinutes, 1)
        : null,
      upstream: {
        status:
          matchingUpwindRows.length === 3
            ? "available"
            : matchingUpwindRows.length
              ? "partial"
              : "unavailable",
        signal: upstreamSignal,
        medianTransmissionPct: Number.isFinite(upwindTransmissionPct)
          ? round(upwindTransmissionPct, 1)
          : null,
        differenceFromAirportPctPoints: upwindDifferencePctPoints,
        points: matchingUpwindRows
          .sort(
            (left, right) =>
              (left.upwindMinutes ?? 0) - (right.upwindMinutes ?? 0),
          )
          .map(publicObservation),
      },
      samples: publicHistory.slice(-12),
      history: publicHistory,
    };
  },
});
