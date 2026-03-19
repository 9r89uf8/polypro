import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { fetchLatestAerowebMessage } from "./aerowebShared.js";

const AUCKLAND_TIMEZONE = "Pacific/Auckland";
const PREFLIGHT_FETCH_TIMEOUT_MS = 25000;
const PREFLIGHT_DEFAULT_BASE_URL = "https://gopreflight.co.nz";
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const WEATHERCOM_API_BASE_URL = "https://api.weather.com";
const WEATHERCOM_CURRENT_CONDITIONS_URL =
  `${WEATHERCOM_API_BASE_URL}/v3/wx/observations/current`;
// Public Weather.com client key embedded in Wunderground airport pages.
const WEATHERCOM_WUNDERGROUND_API_KEY =
  "e1f10a1e78da46f5b10a1e78da96f525";
const RACE_SOURCE = {
  AEROWEB: "aeroweb",
  PREFLIGHT: "preflight",
  TGFTP: "tgftp",
};
const PUBLISH_RACE_WINNER = {
  AEROWEB: "aeroweb",
  PREFLIGHT: "preflight",
  TGFTP: "tgftp",
  TIE: "tie",
};
const DEFAULT_RACE_QUERY_LIMIT = 12;
const MAX_RACE_QUERY_LIMIT = 48;
const DEFAULT_RACE_WATCH_INTERVAL_MS = 1000;
const DEFAULT_RACE_WATCH_DURATION_MS = 15 * 60 * 1000;

const aucklandDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AUCKLAND_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const aucklandDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AUCKLAND_TIMEZONE,
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
  const parts = formatter.formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatAucklandDate(epochMs) {
  const parts = getDateParts(aucklandDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatAucklandDateTime(epochMs) {
  const parts = getDateParts(aucklandDateTimeFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey ?? "");
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function toNonEmptyString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function parseNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSignedMetarTemp(tempToken) {
  if (!tempToken || tempToken === "//") {
    return null;
  }
  const cleaned = tempToken.trim();
  if (!/^(M?\d{2})$/.test(cleaned)) {
    return null;
  }
  const isNegative = cleaned.startsWith("M");
  const magnitude = Number(isNegative ? cleaned.slice(1) : cleaned);
  if (!Number.isFinite(magnitude)) {
    return null;
  }
  return isNegative ? -magnitude : magnitude;
}

function parseReportedTempC(value) {
  const match = /(-?\d+(?:\.\d+)?)/.exec(String(value ?? ""));
  if (!match) {
    return null;
  }
  return parseNumber(match[1]);
}

function extractTempInfo(rawMetar, reportedTempText) {
  const reportedTempC = parseReportedTempC(reportedTempText);
  if (reportedTempC !== null) {
    return {
      tempC: roundToTenth(reportedTempC),
      source: "reported_temp",
    };
  }

  const mainTempMatch = String(rawMetar ?? "").match(/\b(M?\d{2})\/(M?\d{2}|\/\/)\b/);
  if (mainTempMatch) {
    const parsedTemp = parseSignedMetarTemp(mainTempMatch[1]);
    if (parsedTemp !== null) {
      return {
        tempC: roundToTenth(parsedTemp),
        source: "metar_integer",
      };
    }
  }

  return null;
}

function getPreflightBaseUrl() {
  return (
    toNonEmptyString(process.env.PREFLIGHT_BASE_URL)?.replace(/\/+$/, "") ??
    PREFLIGHT_DEFAULT_BASE_URL
  );
}

function getPreflightAuthHeader() {
  const token = toNonEmptyString(process.env.PREFLIGHT_AUTH_BEARER_TOKEN);
  if (!token) {
    throw new Error("Missing PREFLIGHT_AUTH_BEARER_TOKEN.");
  }
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

function buildStationUrl(stationIcao) {
  return `${getPreflightBaseUrl()}/data/aerodromesv3/${encodeURIComponent(stationIcao)}`;
}

function parseIsoTimestamp(value) {
  const epochMs = Date.parse(String(value ?? "").trim());
  return Number.isFinite(epochMs) ? epochMs : null;
}

function extractReportType(rawMetar) {
  const match = /^(METAR|SPECI)\b/.exec(String(rawMetar ?? "").trim().toUpperCase());
  return match ? match[1] : null;
}

function inferPreflightReportType(rawMetar, entryId) {
  const fromRaw = extractReportType(rawMetar);
  if (fromRaw) {
    return fromRaw;
  }
  const normalizedId = String(entryId ?? "").trim().toUpperCase();
  if (normalizedId.startsWith("SPECI-")) {
    return "SPECI";
  }
  if (normalizedId.startsWith("METAR-")) {
    return "METAR";
  }
  return null;
}

function parseNoaaLatestTxt(rawText) {
  const cleaned = String(rawText ?? "")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned) {
    throw new Error("NOAA latest response was empty.");
  }

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let timestampLine = "";
  let metarLine = "";

  if (lines.length >= 2) {
    timestampLine = lines[0];
    metarLine = lines.slice(1).join(" ").trim();
  } else {
    const oneLineMatch = cleaned.match(
      /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\s+(.+)$/,
    );
    if (!oneLineMatch) {
      throw new Error(`Unexpected NOAA format: ${cleaned.slice(0, 120)}`);
    }
    timestampLine = oneLineMatch[1];
    metarLine = oneLineMatch[2].trim();
  }

  const stampMatch = timestampLine.match(
    /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/,
  );
  if (!stampMatch) {
    throw new Error(`Unexpected NOAA timestamp format: ${timestampLine}`);
  }
  if (!metarLine) {
    throw new Error("NOAA latest response did not include a METAR line.");
  }

  return {
    tsUtc: Date.UTC(
      Number(stampMatch[1]),
      Number(stampMatch[2]) - 1,
      Number(stampMatch[3]),
      Number(stampMatch[4]),
      Number(stampMatch[5]),
      0,
      0,
    ),
    rawMetar: metarLine,
  };
}

function parseHttpTimestamp(value) {
  const epochMs = Date.parse(String(value ?? "").trim());
  return Number.isFinite(epochMs) ? epochMs : null;
}

function buildWeatherComAirportCurrentUrl(stationIcao) {
  const url = new URL(WEATHERCOM_CURRENT_CONDITIONS_URL);
  url.searchParams.set("apiKey", WEATHERCOM_WUNDERGROUND_API_KEY);
  url.searchParams.set("language", "en-US");
  url.searchParams.set("units", "m");
  url.searchParams.set("format", "json");
  url.searchParams.set("icaoCode", stationIcao);
  return url.toString();
}

function buildObservationRow({
  stationIcao,
  rawMetar,
  obsTimeUtc,
  reportedTempText,
  sourcePrefix,
  fallbackReportType,
}) {
  const normalizedMetar = toNonEmptyString(rawMetar);
  if (!normalizedMetar) {
    return null;
  }

  const reportType = extractReportType(normalizedMetar) ?? fallbackReportType;
  if (!reportType) {
    return null;
  }

  const tempInfo = extractTempInfo(normalizedMetar, reportedTempText);
  if (!tempInfo) {
    return null;
  }

  const tempC = roundToTenth(tempInfo.tempC);
  const tempF = toFahrenheit(tempC);

  return {
    stationIcao,
    date: formatAucklandDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatAucklandDateTime(obsTimeUtc),
    reportType,
    tempC,
    tempF,
    rawMetar: normalizedMetar,
    source: `${sourcePrefix}:${tempInfo.source}`,
  };
}

function collectPreflightMessageEntries(payload) {
  const entries = [];
  if (Array.isArray(payload?.metar)) {
    entries.push(...payload.metar);
  }
  if (Array.isArray(payload?.speci)) {
    entries.push(...payload.speci);
  }
  return entries;
}

function parsePreflightEntry(entry, stationIcao, sourcePrefix) {
  const obsTimeUtc = parseIsoTimestamp(entry?.issuetime ?? entry?.data?.issueTime);
  if (!Number.isFinite(obsTimeUtc)) {
    return null;
  }

  const reportedTempText =
    entry?.data?.observation?.[0]?.airTemperature?.value ?? null;

  return buildObservationRow({
    stationIcao,
    rawMetar: entry?.raw,
    obsTimeUtc,
    reportedTempText,
    sourcePrefix,
    fallbackReportType: inferPreflightReportType(entry?.raw, entry?.id),
  });
}

function parseLatestObservation(payload, stationIcao) {
  const rows = collectPreflightMessageEntries(payload)
    .map((entry) => parsePreflightEntry(entry, stationIcao, "preflight_latest"))
    .filter(Boolean)
    .sort((a, b) => b.obsTimeUtc - a.obsTimeUtc);

  if (!rows.length) {
    throw new Error("PreFlight latest payload did not include a parseable METAR/SPECI row.");
  }
  return rows[0];
}

function parseRollingObservations(payload, stationIcao) {
  return collectPreflightMessageEntries(payload)
    .map((entry) => parsePreflightEntry(entry, stationIcao, "preflight_rolling"))
    .filter(Boolean);
}

function observationChanged(existing, candidate) {
  const fields = [
    "obsTimeLocal",
    "reportType",
    "tempC",
    "tempF",
    "rawMetar",
    "source",
  ];
  return fields.some((field) => existing[field] !== candidate[field]);
}

function computePublishRaceWinner(firstSeenTimes) {
  const hits = Object.entries(firstSeenTimes)
    .filter(([, seenAt]) => Number.isFinite(seenAt))
    .sort((a, b) => a[1] - b[1]);

  if (hits.length < 2) {
    return { winner: null, leadMs: null };
  }

  const [firstSource, firstSeenAt] = hits[0];
  const [, secondSeenAt] = hits[1];
  if (firstSeenAt === secondSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.TIE,
      leadMs: 0,
    };
  }

  return {
    winner: firstSource,
    leadMs: secondSeenAt - firstSeenAt,
  };
}

function chooseCanonicalRaceRawMetar(existingRawMetar, candidateRawMetar) {
  const existing = toNonEmptyString(existingRawMetar);
  const candidate = toNonEmptyString(candidateRawMetar);
  if (!existing) {
    return candidate;
  }
  if (!candidate) {
    return existing;
  }

  const existingHasType = /^(METAR|SPECI)\b/.test(existing);
  const candidateHasType = /^(METAR|SPECI)\b/.test(candidate);
  if (!existingHasType && candidateHasType) {
    return candidate;
  }
  if (existingHasType && !candidateHasType) {
    return existing;
  }
  return candidate.length > existing.length ? candidate : existing;
}

async function recomputeDailySummary(ctx, stationIcao, date) {
  const rows = await ctx.db
    .query("preflightMetarObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("preflightDailySummaries")
    .withIndex("by_station_date", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .first();

  if (rows.length === 0) {
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return;
  }

  rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
  const latestRow = rows[rows.length - 1];
  let maxRow = rows[0];
  let minRow = rows[0];

  for (const row of rows) {
    if (
      row.tempC > maxRow.tempC ||
      (row.tempC === maxRow.tempC && row.obsTimeUtc > maxRow.obsTimeUtc)
    ) {
      maxRow = row;
    }
    if (
      row.tempC < minRow.tempC ||
      (row.tempC === minRow.tempC && row.obsTimeUtc > minRow.obsTimeUtc)
    ) {
      minRow = row;
    }
  }

  const now = Date.now();
  const patch = {
    stationIcao,
    date,
    obsCount: rows.length,
    latestObsTimeUtc: latestRow.obsTimeUtc,
    latestObsTimeLocal: latestRow.obsTimeLocal,
    latestReportType: latestRow.reportType,
    latestTempC: latestRow.tempC,
    latestTempF: latestRow.tempF,
    latestRawMetar: latestRow.rawMetar,
    maxTempC: maxRow.tempC,
    maxTempF: maxRow.tempF,
    maxTempAtUtc: maxRow.obsTimeUtc,
    maxTempAtLocal: maxRow.obsTimeLocal,
    minTempC: minRow.tempC,
    minTempF: minRow.tempF,
    minTempAtUtc: minRow.obsTimeUtc,
    minTempAtLocal: minRow.obsTimeLocal,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return;
  }

  await ctx.db.insert("preflightDailySummaries", patch);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PREFLIGHT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPreflightPayload(stationIcao) {
  const response = await fetchWithTimeout(buildStationUrl(stationIcao), {
    headers: {
      Accept: "application/json",
      Authorization: getPreflightAuthHeader(),
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `PreFlight station fetch failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return await response.json();
}

async function fetchPreflightStatus() {
  const response = await fetchWithTimeout(
    `${getPreflightBaseUrl()}/source/status`,
    {
      headers: {
        Accept: "application/json",
        Authorization: getPreflightAuthHeader(),
        "Cache-Control": "no-cache",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `PreFlight status fetch failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return await response.json();
}

function findStatusRows(statusPayload) {
  if (!statusPayload) {
    return [];
  }
  if (Array.isArray(statusPayload)) {
    return statusPayload;
  }
  // The response might be wrapped: { data: [...] }, { rows: [...] }, { status: [...] }, etc.
  if (typeof statusPayload === "object") {
    for (const key of Object.keys(statusPayload)) {
      if (Array.isArray(statusPayload[key])) {
        return statusPayload[key];
      }
    }
    // Might be an object keyed by type name: { metar: {...}, atis: {...}, ... }
    const entries = Object.entries(statusPayload);
    if (entries.length > 0 && entries.every(([, v]) => v && typeof v === "object" && !Array.isArray(v))) {
      return entries.map(([key, value]) => ({ ...value, _key: key }));
    }
  }
  return [];
}

function findMetarStatusRow(statusPayload) {
  const rows = findStatusRows(statusPayload);
  // Try matching by `type` field first (case-insensitive).
  let metarRow = rows.find(
    (row) => String(row?.type ?? "").toUpperCase() === "METAR",
  );
  if (metarRow) {
    return metarRow;
  }
  // Try matching by the synthesized `_key` from object-keyed responses.
  metarRow = rows.find(
    (row) => String(row?._key ?? "").toUpperCase() === "METAR",
  );
  return metarRow ?? null;
}

function extractMetarStatusFingerprint(statusPayload) {
  const metarRow = findMetarStatusRow(statusPayload);
  if (!metarRow) {
    return null;
  }
  // Include every non-function field so any change is detectable.
  return JSON.stringify(metarRow);
}

function describeStatusShape(statusPayload) {
  if (statusPayload === null || statusPayload === undefined) {
    return "null";
  }
  if (Array.isArray(statusPayload)) {
    const sample = statusPayload[0];
    const keys = sample && typeof sample === "object" ? Object.keys(sample).slice(0, 8).join(",") : "?";
    return `array[${statusPayload.length}] keys=${keys}`;
  }
  if (typeof statusPayload === "object") {
    const topKeys = Object.keys(statusPayload).slice(0, 8).join(",");
    return `object{${topKeys}}`;
  }
  return typeof statusPayload;
}

async function fetchLatestPreflightRaceHit(stationIcao) {
  const payload = await fetchPreflightPayload(stationIcao);
  const row = parseLatestObservation(payload, stationIcao);
  return {
    seenAt: Date.now(),
    row,
    exposedMessageCount: collectPreflightMessageEntries(payload).length,
  };
}

async function fetchLatestTgftpRaceHit(stationIcao) {
  const response = await fetchWithTimeout(
    `${NOAA_LATEST_METAR_BASE_URL}/${stationIcao}.TXT`,
    {
      headers: {
        "Cache-Control": "no-cache",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `NOAA tgftp latest fetch failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  const body = await response.text();
  const parsed = parseNoaaLatestTxt(body);
  return {
    seenAt: Date.now(),
    reportTsUtc: parsed.tsUtc,
    rawMetar: parsed.rawMetar,
    lastModifiedAt: parseHttpTimestamp(response.headers.get("last-modified")),
  };
}

async function fetchLatestWeatherComAirportCurrentReading(stationIcao) {
  const response = await fetchWithTimeout(
    buildWeatherComAirportCurrentUrl(stationIcao),
    {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Weather.com airport current fetch failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const tempC = parseNumber(payload?.temperature);
  if (tempC === null) {
    throw new Error("Weather.com airport current response missing temperature.");
  }

  const validTimeUtcSeconds = parseNumber(payload?.validTimeUtc);
  const observedAtUtc =
    (validTimeUtcSeconds !== null ? Math.round(validTimeUtcSeconds * 1000) : null) ??
    parseIsoTimestamp(payload?.validTimeLocal) ??
    Date.now();

  const phrase =
    toNonEmptyString(payload?.wxPhraseLong) ??
    toNonEmptyString(payload?.wxPhraseMedium) ??
    toNonEmptyString(payload?.wxPhraseShort);

  return {
    ok: true,
    stationIcao,
    source: "weathercom_airport_current",
    sourceLabel: "Weather.com airport current (unofficial)",
    observedAtUtc,
    observedAtLocal: formatAucklandDateTime(observedAtUtc),
    tempC: roundToTenth(tempC),
    tempF: toFahrenheit(tempC),
    relativeHumidity: parseNumber(payload?.relativeHumidity),
    windSpeedKph: parseNumber(payload?.windSpeed),
    windGustKph: parseNumber(payload?.windGust),
    pressureHpa: parseNumber(payload?.pressureMeanSeaLevel),
    phrase,
    raw: JSON.stringify(
      {
        temperature: payload?.temperature,
        validTimeUtc: payload?.validTimeUtc,
        windSpeed: payload?.windSpeed,
        windGust: payload?.windGust,
        pressureMeanSeaLevel: payload?.pressureMeanSeaLevel,
        wxPhraseLong: payload?.wxPhraseLong,
      },
      null,
      0,
    ),
  };
}

export const upsertStationRowsBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    seenAt: v.optional(v.number()),
    rows: v.array(
      v.object({
        stationIcao: v.string(),
        date: v.string(),
        obsTimeUtc: v.number(),
        obsTimeLocal: v.string(),
        reportType: v.union(v.literal("METAR"), v.literal("SPECI")),
        tempC: v.number(),
        tempF: v.number(),
        rawMetar: v.string(),
        source: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const seenAt =
      typeof args.seenAt === "number" ? Math.round(args.seenAt) : null;
    const now = Date.now();
    let insertedCount = 0;
    let patchedCount = 0;
    let unchangedCount = 0;
    const affectedDates = new Set();

    for (const row of args.rows) {
      if (!parseDateKey(row.date)) {
        throw new Error(`Invalid date key: ${row.date}`);
      }

      const existing = await ctx.db
        .query("preflightMetarObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("preflightMetarObservations", {
          ...row,
          ...(seenAt !== null ? { preflightFirstSeenAt: seenAt } : {}),
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      const patch = {};
      if (existing.preflightFirstSeenAt === undefined && seenAt !== null) {
        patch.preflightFirstSeenAt = seenAt;
      }
      if (observationChanged(existing, row)) {
        patch.obsTimeLocal = row.obsTimeLocal;
        patch.reportType = row.reportType;
        patch.tempC = row.tempC;
        patch.tempF = row.tempF;
        patch.rawMetar = row.rawMetar;
        patch.source = row.source;
      }
      if (Object.keys(patch).length === 0) {
        unchangedCount += 1;
        continue;
      }
      patch.updatedAt = now;
      await ctx.db.patch(existing._id, patch);
      patchedCount += 1;
    }

    for (const date of affectedDates) {
      await recomputeDailySummary(ctx, args.stationIcao, date);
    }

    return {
      insertedCount,
      patchedCount,
      unchangedCount,
      affectedDateCount: affectedDates.size,
    };
  },
});

export const recordPublishRaceHit = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    reportTsUtc: v.number(),
    reportType: v.optional(v.union(v.literal("METAR"), v.literal("SPECI"))),
    source: v.union(
      v.literal(RACE_SOURCE.AEROWEB),
      v.literal(RACE_SOURCE.PREFLIGHT),
      v.literal(RACE_SOURCE.TGFTP),
    ),
    rawMetar: v.string(),
    seenAt: v.number(),
    sourceLastModifiedAt: v.optional(v.number()),
    statusSeenAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("preflightPublishRaceReports")
      .withIndex("by_station_reportTs", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("reportTsUtc", args.reportTsUtc),
      )
      .first();

    const now = Date.now();
    const reportDateLocal = formatAucklandDate(args.reportTsUtc);

    if (!existing) {
      const patch = {
        stationIcao: args.stationIcao,
        reportDateLocal,
        reportTsUtc: args.reportTsUtc,
        rawMetar: args.rawMetar,
        ...(args.reportType ? { reportType: args.reportType } : {}),
        ...(args.source === RACE_SOURCE.AEROWEB
          ? {
              aerowebRawMetar: args.rawMetar,
              aerowebFirstSeenAt: args.seenAt,
            }
          : args.source === RACE_SOURCE.PREFLIGHT
          ? {
              preflightRawMetar: args.rawMetar,
              preflightFirstSeenAt: args.seenAt,
            }
          : {
              tgftpRawMetar: args.rawMetar,
              tgftpFirstSeenAt: args.seenAt,
            }),
        ...(args.source === RACE_SOURCE.TGFTP &&
        Number.isFinite(args.sourceLastModifiedAt)
          ? { tgftpLastModifiedAt: args.sourceLastModifiedAt }
          : {}),
        ...(Number.isFinite(args.statusSeenAt)
          ? { statusFirstSeenAt: args.statusSeenAt }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      const insertedId = await ctx.db.insert("preflightPublishRaceReports", patch);
      return await ctx.db.get(insertedId);
    }

    const patch = {
      reportDateLocal,
    };
    if (!existing.reportType && args.reportType) {
      patch.reportType = args.reportType;
    }
    const canonicalRawMetar = chooseCanonicalRaceRawMetar(
      existing.rawMetar,
      args.rawMetar,
    );
    if (existing.rawMetar !== canonicalRawMetar) {
      patch.rawMetar = canonicalRawMetar;
    }

    if (args.source === RACE_SOURCE.AEROWEB) {
      if (!existing.aerowebRawMetar) {
        patch.aerowebRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.aerowebFirstSeenAt)) {
        patch.aerowebFirstSeenAt = args.seenAt;
      }
    } else if (args.source === RACE_SOURCE.PREFLIGHT) {
      if (!existing.preflightRawMetar) {
        patch.preflightRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.preflightFirstSeenAt)) {
        patch.preflightFirstSeenAt = args.seenAt;
      }
    } else {
      if (!existing.tgftpRawMetar) {
        patch.tgftpRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.tgftpFirstSeenAt)) {
        patch.tgftpFirstSeenAt = args.seenAt;
      }
      if (
        Number.isFinite(args.sourceLastModifiedAt) &&
        !Number.isFinite(existing.tgftpLastModifiedAt)
      ) {
        patch.tgftpLastModifiedAt = args.sourceLastModifiedAt;
      }
    }

    if (
      Number.isFinite(args.statusSeenAt) &&
      !Number.isFinite(existing.statusFirstSeenAt)
    ) {
      patch.statusFirstSeenAt = args.statusSeenAt;
    }

    const winnerState = computePublishRaceWinner({
      [PUBLISH_RACE_WINNER.AEROWEB]:
        patch.aerowebFirstSeenAt ?? existing.aerowebFirstSeenAt,
      [PUBLISH_RACE_WINNER.PREFLIGHT]:
        patch.preflightFirstSeenAt ?? existing.preflightFirstSeenAt,
      [PUBLISH_RACE_WINNER.TGFTP]:
        patch.tgftpFirstSeenAt ?? existing.tgftpFirstSeenAt,
    });
    if (winnerState.winner) {
      patch.winner = winnerState.winner;
      patch.leadMs = winnerState.leadMs;
    }

    if (Object.keys(patch).length === 2) {
      return existing;
    }

    patch.updatedAt = now;
    await ctx.db.patch(existing._id, patch);
    return await ctx.db.get(existing._id);
  },
});

export const pollLatestStationMetar = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const { seenAt, row, exposedMessageCount } = await fetchLatestPreflightRaceHit(
      stationIcao,
    );
    const result = await ctx.runMutation("preflight:upsertStationRowsBatch", {
      stationIcao,
      seenAt,
      rows: [row],
    });
    const raceRow = await ctx.runMutation("preflight:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: row.obsTimeUtc,
      reportType: row.reportType,
      source: RACE_SOURCE.PREFLIGHT,
      rawMetar: row.rawMetar,
      seenAt,
    });

    return {
      ok: true,
      stationIcao,
      row: {
        ...row,
        preflightFirstSeenAt: raceRow?.preflightFirstSeenAt ?? seenAt,
      },
      exposedMessageCount,
      availabilityLagMs: Math.max(0, seenAt - row.obsTimeUtc),
      ...result,
    };
  },
});

export const pollLatestNoaaPublishRace = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const hit = await fetchLatestTgftpRaceHit(stationIcao);
    const raceRow = await ctx.runMutation("preflight:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: hit.reportTsUtc,
      source: RACE_SOURCE.TGFTP,
      rawMetar: hit.rawMetar,
      seenAt: hit.seenAt,
      ...(Number.isFinite(hit.lastModifiedAt)
        ? { sourceLastModifiedAt: hit.lastModifiedAt }
        : {}),
    });

    return {
      ok: true,
      stationIcao,
      reportTsUtc: hit.reportTsUtc,
      reportType: raceRow?.reportType ?? null,
      rawMetar: hit.rawMetar,
      tgftpFirstSeenAt: raceRow?.tgftpFirstSeenAt ?? hit.seenAt,
      tgftpLastModifiedAt: hit.lastModifiedAt,
      winner: raceRow?.winner ?? null,
      leadMs: raceRow?.leadMs ?? null,
    };
  },
});

export const pollLatestAerowebPublishRace = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const hit = await fetchLatestAerowebMessage(stationIcao);
    const raceRow = await ctx.runMutation("preflight:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: hit.reportTsUtc,
      reportType: hit.reportType,
      source: RACE_SOURCE.AEROWEB,
      rawMetar: hit.rawMetar,
      seenAt: hit.seenAt,
    });

    return {
      ok: true,
      stationIcao,
      reportTsUtc: hit.reportTsUtc,
      reportType: raceRow?.reportType ?? hit.reportType,
      rawMetar: hit.rawMetar,
      aerowebFirstSeenAt: raceRow?.aerowebFirstSeenAt ?? hit.seenAt,
      winner: raceRow?.winner ?? null,
      leadMs: raceRow?.leadMs ?? null,
    };
  },
});

export const fetchLatestWeatherComAirportCurrent = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (_ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }
    return await fetchLatestWeatherComAirportCurrentReading(stationIcao);
  },
});

export const probePreflightStatus = actionGeneric({
  args: {},
  handler: async () => {
    const raw = await fetchPreflightStatus();
    const shape = describeStatusShape(raw);
    const metarRow = findMetarStatusRow(raw);
    const fingerprint = extractMetarStatusFingerprint(raw);
    const allRows = findStatusRows(raw);
    const typeKeys = allRows
      .map((row) => row?.type ?? row?._key ?? "?")
      .slice(0, 20);
    return {
      ok: true,
      shape,
      metarRowFound: metarRow !== null,
      metarRowSample: metarRow
        ? JSON.stringify(metarRow).slice(0, 500)
        : null,
      fingerprint: fingerprint ? fingerprint.slice(0, 300) : null,
      typeKeys,
      totalRows: allRows.length,
    };
  },
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const watchStationPublishRaceWindow = actionGeneric({
  args: {
    stationIcao: v.string(),
    intervalMs: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const intervalMs = Math.max(
      1000,
      Math.min(30000, Math.round(args.intervalMs ?? DEFAULT_RACE_WATCH_INTERVAL_MS)),
    );
    const durationMs = Math.max(
      intervalMs,
      Math.min(20 * 60 * 1000, Math.round(args.durationMs ?? DEFAULT_RACE_WATCH_DURATION_MS)),
    );

    const startedAt = Date.now();
    const deadline = startedAt + durationMs;
    let iterations = 0;
    let errorCount = 0;
    let lastError = null;
    let lastPreflight = null;
    let lastAeroweb = null;
    let lastTgftp = null;
    const touchedReportTimestamps = new Set();

    // Status fingerprint tracking for the hidden /source/status endpoint.
    // We track the aerodromesv3 reportTsUtc at each status poll so that
    // when the fingerprint changes we can tell whether aerodromesv3 already
    // showed the new report (common case with 5-iteration polling gap).
    let lastStatusFingerprint = null;
    let pendingStatusSeenAt = null;
    let reportTsAtPreviousStatusPoll = null;
    let statusErrorCount = 0;
    let lastStatusError = null;
    let statusShape = null;
    let statusMetarRowFound = false;
    let statusFingerprintChangeCount = 0;
    let lastPersistedPreflightReportTs = null;
    const aerowebSessionRef = { cookieHeader: null };

    while (Date.now() <= deadline) {
      try {
        // Poll status every 5 iterations (~5s) to reduce overhead.
        const shouldPollStatus = iterations % 5 === 0;
        const statusPromise = shouldPollStatus
          ? fetchPreflightStatus().catch((error) => {
              statusErrorCount += 1;
              lastStatusError = error instanceof Error ? error.message : String(error);
              return null;
            })
          : Promise.resolve(null);

        const [raceResults, statusResult] = await Promise.all([
          Promise.allSettled([
            fetchLatestPreflightRaceHit(stationIcao),
            fetchLatestAerowebMessage(stationIcao, aerowebSessionRef),
            fetchLatestTgftpRaceHit(stationIcao),
          ]),
          statusPromise,
        ]);
        const [preflightResult, aerowebResult, tgftpResult] = raceResults;

        // Detect status fingerprint changes.
        if (statusResult !== null && statusShape === null) {
          statusShape = describeStatusShape(statusResult);
          statusMetarRowFound = findMetarStatusRow(statusResult) !== null;
        }
        if (shouldPollStatus) {
          const currentFingerprint = extractMetarStatusFingerprint(statusResult);
          if (
            currentFingerprint !== null &&
            lastStatusFingerprint !== null &&
            currentFingerprint !== lastStatusFingerprint
          ) {
            pendingStatusSeenAt = Date.now();
            statusFingerprintChangeCount += 1;
          }
          if (currentFingerprint !== null) {
            lastStatusFingerprint = currentFingerprint;
          }
        }

        const mutationCalls = [];
        let isNewSincePreviousStatusPoll = false;
        let statusSeenAtForThisReport;
        let persistedPreflightReportTs = null;

        if (preflightResult.status === "fulfilled") {
          const preflightHit = preflightResult.value;
          lastPreflight = preflightHit;

          const currentReportTs = preflightHit.row.obsTimeUtc;
          isNewSincePreviousStatusPoll =
            reportTsAtPreviousStatusPoll !== null &&
            currentReportTs > reportTsAtPreviousStatusPoll;
          const justDetectedChange =
            shouldPollStatus &&
            statusFingerprintChangeCount > 0 &&
            pendingStatusSeenAt !== null;
          statusSeenAtForThisReport =
            pendingStatusSeenAt !== null && (isNewSincePreviousStatusPoll || justDetectedChange)
              ? pendingStatusSeenAt
              : undefined;

          if (shouldPollStatus) {
            reportTsAtPreviousStatusPoll = currentReportTs;
          }

          if (currentReportTs !== lastPersistedPreflightReportTs) {
            mutationCalls.push(
              ctx.runMutation("preflight:upsertStationRowsBatch", {
                stationIcao,
                seenAt: preflightHit.seenAt,
                rows: [preflightHit.row],
              }),
            );
            persistedPreflightReportTs = currentReportTs;
          }

          mutationCalls.push(
            ctx.runMutation("preflight:recordPublishRaceHit", {
              stationIcao,
              reportTsUtc: currentReportTs,
              reportType: preflightHit.row.reportType,
              source: RACE_SOURCE.PREFLIGHT,
              rawMetar: preflightHit.row.rawMetar,
              seenAt: preflightHit.seenAt,
              ...(statusSeenAtForThisReport !== undefined
                ? { statusSeenAt: statusSeenAtForThisReport }
                : {}),
            }),
          );
        } else {
          errorCount += 1;
          lastError =
            preflightResult.reason instanceof Error
              ? preflightResult.reason.message
              : String(preflightResult.reason);
        }

        if (aerowebResult.status === "fulfilled") {
          lastAeroweb = aerowebResult.value;
          mutationCalls.push(
            ctx.runMutation("preflight:recordPublishRaceHit", {
              stationIcao,
              reportTsUtc: aerowebResult.value.reportTsUtc,
              reportType: aerowebResult.value.reportType,
              source: RACE_SOURCE.AEROWEB,
              rawMetar: aerowebResult.value.rawMetar,
              seenAt: aerowebResult.value.seenAt,
            }),
          );
        } else {
          errorCount += 1;
          lastError =
            aerowebResult.reason instanceof Error
              ? aerowebResult.reason.message
              : String(aerowebResult.reason);
        }

        if (tgftpResult.status === "fulfilled") {
          lastTgftp = tgftpResult.value;
          mutationCalls.push(
            ctx.runMutation("preflight:recordPublishRaceHit", {
              stationIcao,
              reportTsUtc: tgftpResult.value.reportTsUtc,
              source: RACE_SOURCE.TGFTP,
              rawMetar: tgftpResult.value.rawMetar,
              seenAt: tgftpResult.value.seenAt,
              ...(Number.isFinite(tgftpResult.value.lastModifiedAt)
                ? { sourceLastModifiedAt: tgftpResult.value.lastModifiedAt }
                : {}),
            }),
          );
        } else {
          errorCount += 1;
          lastError =
            tgftpResult.reason instanceof Error
              ? tgftpResult.reason.message
              : String(tgftpResult.reason);
        }

        const raceRows = await Promise.all(mutationCalls);

        if (statusSeenAtForThisReport !== undefined && isNewSincePreviousStatusPoll) {
          pendingStatusSeenAt = null;
        }

        if (persistedPreflightReportTs !== null) {
          lastPersistedPreflightReportTs = persistedPreflightReportTs;
        }

        for (const raceRow of raceRows) {
          if (raceRow?.reportTsUtc) {
            touchedReportTimestamps.add(raceRow.reportTsUtc);
          }
        }
      } catch (error) {
        errorCount += 1;
        lastError = error instanceof Error ? error.message : String(error);
      }

      iterations += 1;

      if (Date.now() + intervalMs > deadline) {
        break;
      }
      await sleep(intervalMs);
    }

    return {
      ok: errorCount === 0,
      stationIcao,
      startedAt,
      finishedAt: Date.now(),
      durationMs,
      intervalMs,
      iterations,
      errorCount,
      statusErrorCount,
      lastStatusError,
      statusShape,
      statusMetarRowFound,
      statusFingerprintChangeCount,
      lastError,
      touchedReportCount: touchedReportTimestamps.size,
      latestAerowebReportTsUtc: lastAeroweb?.reportTsUtc ?? null,
      latestPreflightReportTsUtc: lastPreflight?.row?.obsTimeUtc ?? null,
      latestTgftpReportTsUtc: lastTgftp?.reportTsUtc ?? null,
    };
  },
});

export const backfillDayStationMessages = actionGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    const date = String(args.date ?? "").trim();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }
    if (!parseDateKey(date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const payload = await fetchPreflightPayload(stationIcao);
    const dedupedRows = new Map();
    const parsedRows = parseRollingObservations(payload, stationIcao);

    for (const row of parsedRows) {
      if (row.date !== date) {
        continue;
      }
      dedupedRows.set(row.obsTimeUtc, row);
    }

    const rows = Array.from(dedupedRows.values()).sort(
      (a, b) => a.obsTimeUtc - b.obsTimeUtc,
    );
    const result = await ctx.runMutation("preflight:upsertStationRowsBatch", {
      stationIcao,
      rows,
    });

    return {
      ok: true,
      stationIcao,
      date,
      exposedMessageCount: parsedRows.length,
      rowCount: rows.length,
      newestObsTimeUtc: rows.length ? rows[rows.length - 1].obsTimeUtc : null,
      oldestObsTimeUtc: rows.length ? rows[0].obsTimeUtc : null,
      ...result,
    };
  },
});

export const getDayStationRows = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!parseDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const rows = await ctx.db
      .query("preflightMetarObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("preflightDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .first();

    return { rows, summary };
  },
});

export const getRecentPublishRaceReports = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "NZWN").trim().toUpperCase();
    const requestedLimit = Number.isInteger(args.limit)
      ? Number(args.limit)
      : DEFAULT_RACE_QUERY_LIMIT;
    const limit = Math.max(1, Math.min(MAX_RACE_QUERY_LIMIT, requestedLimit));

    const rows = await ctx.db
      .query("preflightPublishRaceReports")
      .withIndex("by_station_reportTs", (query) => query.eq("stationIcao", stationIcao))
      .order("desc")
      .take(limit);

    return {
      stationIcao,
      count: rows.length,
      rows,
    };
  },
});
