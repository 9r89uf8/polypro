import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANKARA_TIMEZONE = "Europe/Istanbul"; // Turkey is UTC+3, no DST
const STATION_ICAO = "LTAC";
const MGM_BASE_URL = "https://servis.mgm.gov.tr/web";
const MGM_STATION_ID = 17128; // Esenbo\u011fa Airport
const MGM_FORECAST_STATION_ID = 17130; // Ankara city, for hourly forecast
const MGM_DAILY_FORECAST_CENTER_ID = 90601;
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const MGM_HEADERS = {
  Origin: "https://www.mgm.gov.tr",
  Referer: "https://www.mgm.gov.tr/",
  Accept: "application/json",
};
const RACE_SOURCE = {
  MGM: "mgm",
  TGFTP: "tgftp",
};
const PUBLISH_RACE_WINNER = {
  MGM: "mgm",
  TGFTP: "tgftp",
  TIE: "tie",
};
const DEFAULT_RACE_QUERY_LIMIT = 12;
const MAX_RACE_QUERY_LIMIT = 48;

// ---------------------------------------------------------------------------
// Date formatting for Istanbul timezone
// ---------------------------------------------------------------------------

const ankaraDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ANKARA_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ankaraDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ANKARA_TIMEZONE,
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

function formatAnkaraDate(epochMs) {
  const parts = getDateParts(ankaraDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatAnkaraDateTime(epochMs) {
  const parts = getDateParts(ankaraDateTimeFormatter, new Date(epochMs));
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

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

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

function formatErrorMessage(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  return message.slice(0, 280);
}

// ---------------------------------------------------------------------------
// METAR parsing
// ---------------------------------------------------------------------------

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

function extractTempInfo(rawMetar, reportedTempC) {
  // Always prefer the METAR integer so the official line matches the
  // publish-race card.  MGM sondurumlar (0.1 C) is shown separately.
  const mainTempMatch = String(rawMetar ?? "").match(
    /\b(M?\d{2})\/(M?\d{2}|\/\/)\b/,
  );
  if (mainTempMatch) {
    const parsedTemp = parseSignedMetarTemp(mainTempMatch[1]);
    if (parsedTemp !== null) {
      return {
        tempC: roundToTenth(parsedTemp),
        source: "metar_integer",
      };
    }
  }

  // Fall back to MGM reported temp only if METAR parsing failed.
  if (reportedTempC !== null && reportedTempC !== undefined && Number.isFinite(reportedTempC)) {
    return {
      tempC: roundToTenth(reportedTempC),
      source: "reported_temp",
    };
  }

  return null;
}

function extractReportType(rawMetar) {
  const match = /^(METAR|SPECI)\b/.exec(
    String(rawMetar ?? "").trim().toUpperCase(),
  );
  return match ? match[1] : null;
}

function parseReportTimestampFromRaw(rawMetar, nowEpochMs = Date.now()) {
  // Match patterns like "METAR LTAC 230020Z ..." or "SPECI LTAC 230050Z ..."
  const match = /^(?:METAR|SPECI)\s+[A-Z0-9]{4}\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(
    String(rawMetar ?? "").trim(),
  );
  if (!match) {
    return null;
  }

  const now = new Date(nowEpochMs);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const reportDay = Number(match[1]);
  const reportHour = Number(match[2]);
  const reportMinute = Number(match[3]);

  const candidates = [
    Date.UTC(currentYear, currentMonth - 1, reportDay, reportHour, reportMinute, 0, 0),
    Date.UTC(currentYear, currentMonth, reportDay, reportHour, reportMinute, 0, 0),
    Date.UTC(currentYear, currentMonth + 1, reportDay, reportHour, reportMinute, 0, 0),
  ].filter(Number.isFinite);

  let bestCandidate = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - nowEpochMs);
    if (distance < bestDistance) {
      bestCandidate = candidate;
      bestDistance = distance;
    }
  }
  return bestCandidate;
}

function isSameUtcMinute(leftEpochMs, rightEpochMs) {
  if (!Number.isFinite(leftEpochMs) || !Number.isFinite(rightEpochMs)) {
    return false;
  }
  return Math.floor(leftEpochMs / 60000) === Math.floor(rightEpochMs / 60000);
}

// ---------------------------------------------------------------------------
// NOAA tgftp parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// MGM fetch functions
// ---------------------------------------------------------------------------

async function fetchMgmCurrentConditions() {
  const url = `${MGM_BASE_URL}/sondurumlar?istno=${MGM_STATION_ID}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      ...MGM_HEADERS,
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `MGM sondurumlar fetch failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  // sondurumlar returns an array; the first element is our station.
  const station = Array.isArray(payload) ? payload[0] : payload;
  if (!station) {
    throw new Error("MGM sondurumlar returned empty response.");
  }

  // Parse veriZamani (data timestamp) — format is typically "YYYY-MM-DDTHH:mm:ss.SSSZ" or local.
  const rawTimestamp = station.veriZamani;
  let obsTimeUtc = null;
  if (rawTimestamp) {
    const normalized = String(rawTimestamp).includes("T")
      ? String(rawTimestamp)
      : String(rawTimestamp).replace(" ", "T");
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized);
    // MGM timestamps are in UTC+3 (Turkey time) if no timezone specified.
    const withTimezone = hasTimezone ? normalized : `${normalized}+03:00`;
    const epoch = Date.parse(withTimezone);
    if (Number.isFinite(epoch)) {
      obsTimeUtc = epoch;
    }
  }
  if (!obsTimeUtc) {
    obsTimeUtc = Date.now();
  }

  // Temperature in 0.1 C from `sicaklik`; -9999 means unavailable.
  const rawTemp = Number(station.sicaklik);
  const tempC =
    Number.isFinite(rawTemp) && rawTemp > -9000
      ? roundToTenth(rawTemp)
      : null;

  // Raw METAR from `rasatMetar`.
  const rawMetar = toNonEmptyString(station.rasatMetar);

  // AWS fields (-9999 means unavailable).
  const safeNum = (val) => {
    const n = Number(val);
    return Number.isFinite(n) && n > -9000 ? n : null;
  };

  return {
    obsTimeUtc,
    tempC,
    rawMetar,
    humidity: safeNum(station.nem),
    windSpeedMps: safeNum(station.ruzgarHiz),
    windDirection: safeNum(station.ruzgarYon),
    visibility: safeNum(station.gorus),
    pressureHpa: safeNum(station.denizeIndirgenmisBasinc),
    cloudCover: safeNum(station.kapalilik),
  };
}

async function fetchMgm3HourlyForecast() {
  const url = `${MGM_BASE_URL}/tahminler/saatlik?istno=${MGM_FORECAST_STATION_ID}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      ...MGM_HEADERS,
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `MGM 3-hourly forecast fetch failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const stationData = Array.isArray(payload) ? payload[0] : payload;
  const forecasts = Array.isArray(stationData?.tahmin)
    ? stationData.tahmin
    : [];

  const rows = [];
  for (const f of forecasts) {
    const rawDate = f.tarih;
    if (!rawDate) {
      continue;
    }

    // tarih is a UTC ISO string like "2026-03-22T09:00:00.000Z"
    const forecastTimeUtc = Date.parse(rawDate);
    if (!Number.isFinite(forecastTimeUtc)) {
      continue;
    }

    const tempC = Number(f.sicaklik);
    if (!Number.isFinite(tempC)) {
      continue;
    }

    const safeNum = (val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : undefined;
    };

    rows.push({
      date: formatAnkaraDate(forecastTimeUtc),
      forecastTimeUtc,
      forecastTimeLocal: formatAnkaraDateTime(forecastTimeUtc),
      tempC: roundToTenth(tempC),
      tempF: toFahrenheit(tempC),
      humidity: safeNum(f.nem),
      windSpeedKph: safeNum(f.ruzgarHizi),
      windDirection: safeNum(f.ruzgarYonu),
      weatherCode: toNonEmptyString(f.hadise) ?? undefined,
    });
  }

  return rows;
}

async function fetchMgm5DayForecast() {
  const url = `${MGM_BASE_URL}/tahminler/gunluk?merkezid=${MGM_DAILY_FORECAST_CENTER_ID}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      ...MGM_HEADERS,
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `MGM 5-day forecast fetch failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const stationData = Array.isArray(payload) ? payload[0] : payload;
  if (!stationData) {
    throw new Error("MGM 5-day forecast returned empty response.");
  }

  const rows = [];
  // Parse 5-day fields: enDusukGun1..5, enYuksekGun1..5, hadiseGun1..5, tarihGun1..5
  for (let i = 1; i <= 5; i++) {
    const dateField = stationData[`tarihGun${i}`];
    if (!dateField) {
      continue;
    }
    const dateStr = String(dateField).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      continue;
    }

    const minTemp = Number(stationData[`enDusukGun${i}`]);
    const maxTemp = Number(stationData[`enYuksekGun${i}`]);
    const weatherCode = toNonEmptyString(stationData[`hadiseGun${i}`]);

    rows.push({
      date: dateStr,
      minTempC: Number.isFinite(minTemp) ? roundToTenth(minTemp) : undefined,
      minTempF: Number.isFinite(minTemp) ? toFahrenheit(minTemp) : undefined,
      maxTempC: Number.isFinite(maxTemp) ? roundToTenth(maxTemp) : undefined,
      maxTempF: Number.isFinite(maxTemp) ? toFahrenheit(maxTemp) : undefined,
      weatherCode: weatherCode ?? undefined,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// NOAA fetch function
// ---------------------------------------------------------------------------

async function fetchLatestNoaaTgftp(stationIcao) {
  const response = await fetch(
    `${NOAA_LATEST_METAR_BASE_URL}/${stationIcao}.TXT`,
    {
      cache: "no-store",
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

// ---------------------------------------------------------------------------
// Observation row building
// ---------------------------------------------------------------------------

function canonicalizeLabeledRawMetar(reportType, rawMetar) {
  const normalizedType = String(reportType ?? "").trim().toUpperCase();
  const normalizedRaw = toNonEmptyString(rawMetar);
  if (!normalizedRaw) {
    return null;
  }
  if (!normalizedType) {
    return normalizedRaw;
  }
  if (normalizedRaw.toUpperCase().startsWith(`${normalizedType} `)) {
    return normalizedRaw;
  }
  return `${normalizedType} ${normalizedRaw}`;
}

function buildObservationRow({
  stationIcao,
  rawMetar,
  obsTimeUtc,
  reportedTempC,
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

  const tempInfo = extractTempInfo(normalizedMetar, reportedTempC);
  if (!tempInfo) {
    return null;
  }

  const tempC = roundToTenth(tempInfo.tempC);
  const tempF = toFahrenheit(tempC);

  return {
    stationIcao,
    date: formatAnkaraDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatAnkaraDateTime(obsTimeUtc),
    reportType,
    tempC,
    tempF,
    rawMetar: normalizedMetar,
    source: `${sourcePrefix}:${tempInfo.source}`,
  };
}

// ---------------------------------------------------------------------------
// Race winner logic
// ---------------------------------------------------------------------------

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

function computePublishRaceWinner(mgmFirstSeenAt, tgftpFirstSeenAt) {
  if (!Number.isFinite(mgmFirstSeenAt) || !Number.isFinite(tgftpFirstSeenAt)) {
    return { winner: null, leadMs: null };
  }
  if (mgmFirstSeenAt < tgftpFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.MGM,
      leadMs: tgftpFirstSeenAt - mgmFirstSeenAt,
    };
  }
  if (tgftpFirstSeenAt < mgmFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.TGFTP,
      leadMs: mgmFirstSeenAt - tgftpFirstSeenAt,
    };
  }
  return {
    winner: PUBLISH_RACE_WINNER.TIE,
    leadMs: 0,
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

function inferPublishRaceReportType(row) {
  return (
    row?.reportType ??
    extractReportType(
      row?.rawMetar ?? row?.mgmRawMetar ?? row?.tgftpRawMetar ?? "",
    )
  );
}

// ---------------------------------------------------------------------------
// Daily summary recomputation
// ---------------------------------------------------------------------------

async function recomputeDailySummary(ctx, stationIcao, date) {
  const rows = await ctx.db
    .query("ankaraMetarObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("ankaraDailySummaries")
    .withIndex("by_station_date", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .first();

  if (!rows.length) {
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

  await ctx.db.insert("ankaraDailySummaries", patch);
}

// ---------------------------------------------------------------------------
// Internal mutations
// ---------------------------------------------------------------------------

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
        .query("ankaraMetarObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("ankaraMetarObservations", {
          ...row,
          ...(seenAt !== null ? { mgmFirstSeenAt: seenAt } : {}),
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      const patch = {};
      if (existing.mgmFirstSeenAt === undefined && seenAt !== null) {
        patch.mgmFirstSeenAt = seenAt;
      }
      if (observationChanged(existing, row)) {
        patch.obsTimeLocal = row.obsTimeLocal;
        patch.reportType = row.reportType;
        patch.tempC = row.tempC;
        patch.tempF = row.tempF;
        patch.rawMetar = row.rawMetar;
        patch.source = row.source;
      }
      if (!Object.keys(patch).length) {
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
    source: v.union(v.literal(RACE_SOURCE.MGM), v.literal(RACE_SOURCE.TGFTP)),
    rawMetar: v.string(),
    seenAt: v.number(),
    sourceLastModifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ankaraPublishRaceReports")
      .withIndex("by_station_reportTs", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("reportTsUtc", args.reportTsUtc),
      )
      .first();

    const now = Date.now();
    const reportDateLocal = formatAnkaraDate(args.reportTsUtc);

    if (!existing) {
      const patch = {
        stationIcao: args.stationIcao,
        reportDateLocal,
        reportTsUtc: args.reportTsUtc,
        rawMetar: args.rawMetar,
        ...(args.reportType ? { reportType: args.reportType } : {}),
        ...(args.source === RACE_SOURCE.MGM
          ? {
              mgmRawMetar: args.rawMetar,
              mgmFirstSeenAt: args.seenAt,
            }
          : {
              tgftpRawMetar: args.rawMetar,
              tgftpFirstSeenAt: args.seenAt,
            }),
        ...(args.source === RACE_SOURCE.TGFTP &&
        Number.isFinite(args.sourceLastModifiedAt)
          ? { tgftpLastModifiedAt: args.sourceLastModifiedAt }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      const insertedId = await ctx.db.insert("ankaraPublishRaceReports", patch);
      return await ctx.db.get(insertedId);
    }

    const patch = {};
    if (existing.reportDateLocal !== reportDateLocal) {
      patch.reportDateLocal = reportDateLocal;
    }
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

    if (args.source === RACE_SOURCE.MGM) {
      if (!existing.mgmRawMetar) {
        patch.mgmRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.mgmFirstSeenAt)) {
        patch.mgmFirstSeenAt = args.seenAt;
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

    const winnerState = computePublishRaceWinner(
      patch.mgmFirstSeenAt ?? existing.mgmFirstSeenAt,
      patch.tgftpFirstSeenAt ?? existing.tgftpFirstSeenAt,
    );
    if (winnerState.winner && existing.winner !== winnerState.winner) {
      patch.winner = winnerState.winner;
    }
    if (winnerState.winner && existing.leadMs !== winnerState.leadMs) {
      patch.leadMs = winnerState.leadMs;
    }

    if (!Object.keys(patch).length) {
      return existing;
    }

    patch.updatedAt = now;
    await ctx.db.patch(existing._id, patch);
    return await ctx.db.get(existing._id);
  },
});

export const storeMgmObservation = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    obsTimeUtc: v.number(),
    obsTimeLocal: v.string(),
    tempC: v.number(),
    tempF: v.number(),
    humidity: v.optional(v.number()),
    windSpeedMps: v.optional(v.number()),
    windDirection: v.optional(v.number()),
    visibility: v.optional(v.number()),
    pressureHpa: v.optional(v.number()),
    cloudCover: v.optional(v.number()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ankaraMgmObservations")
      .withIndex("by_station_date_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("date", args.date)
          .eq("obsTimeUtc", args.obsTimeUtc),
      )
      .first();
    if (existing) {
      return { inserted: false };
    }
    await ctx.db.insert("ankaraMgmObservations", {
      ...args,
      createdAt: Date.now(),
    });
    return { inserted: true };
  },
});

export const storeMgmHourlyForecastBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(
      v.object({
        date: v.string(),
        forecastTimeUtc: v.number(),
        forecastTimeLocal: v.string(),
        tempC: v.number(),
        tempF: v.number(),
        humidity: v.optional(v.number()),
        windSpeedKph: v.optional(v.number()),
        windDirection: v.optional(v.number()),
        weatherCode: v.optional(v.string()),
      }),
    ),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    let upserted = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("ankaraMgmHourlyForecasts")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("date", row.date)
            .eq("forecastTimeUtc", row.forecastTimeUtc),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          tempC: row.tempC,
          tempF: row.tempF,
          humidity: row.humidity,
          windSpeedKph: row.windSpeedKph,
          windDirection: row.windDirection,
          weatherCode: row.weatherCode,
          capturedAt: args.capturedAt,
        });
      } else {
        await ctx.db.insert("ankaraMgmHourlyForecasts", {
          stationIcao: args.stationIcao,
          ...row,
          capturedAt: args.capturedAt,
        });
      }
      upserted += 1;
    }
    return { upserted };
  },
});

// ---------------------------------------------------------------------------
// Exported actions
// ---------------------------------------------------------------------------

export const pollLatestMgmMetar = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao =
      String(args.stationIcao ?? STATION_ICAO).trim().toUpperCase();

    const mgmData = await fetchMgmCurrentConditions();
    const rawMetar = mgmData.rawMetar;
    if (!rawMetar) {
      return {
        ok: false,
        stationIcao,
        error: "MGM sondurumlar did not include a rasatMetar field.",
      };
    }

    const seenAt = Date.now();

    // Ensure the raw METAR has a report type prefix.
    const reportType = extractReportType(rawMetar) ?? "METAR";
    const labeledMetar = canonicalizeLabeledRawMetar(reportType, rawMetar);

    // Parse the observation timestamp from the raw METAR string.
    const obsTimeUtc = parseReportTimestampFromRaw(labeledMetar);
    if (!Number.isFinite(obsTimeUtc)) {
      return {
        ok: false,
        stationIcao,
        error: "Could not parse observation timestamp from MGM METAR.",
        rawMetar,
      };
    }

    // Only trust sondurumlar.sicaklik for the METAR row when veriZamani matches
    // the METAR observation minute. MGM can publish a newer raw METAR while the
    // AWS/current-conditions fields are still on the previous update.
    const row = buildObservationRow({
      stationIcao,
      rawMetar: labeledMetar,
      obsTimeUtc,
      reportedTempC: isSameUtcMinute(mgmData.obsTimeUtc, obsTimeUtc)
        ? mgmData.tempC
        : null,
      sourcePrefix: "mgm_sondurumlar",
      fallbackReportType: reportType,
    });

    if (!row) {
      return {
        ok: false,
        stationIcao,
        error: "Could not build observation row from MGM METAR.",
        rawMetar,
      };
    }

    const result = await ctx.runMutation("ankara:upsertStationRowsBatch", {
      stationIcao,
      seenAt,
      rows: [row],
    });

    const raceRow = await ctx.runMutation("ankara:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: obsTimeUtc,
      reportType: row.reportType,
      source: RACE_SOURCE.MGM,
      rawMetar: row.rawMetar,
      seenAt,
    });

    return {
      ok: true,
      stationIcao,
      row: {
        ...row,
        mgmFirstSeenAt: raceRow?.mgmFirstSeenAt ?? seenAt,
      },
      availabilityLagMs: Math.max(0, seenAt - obsTimeUtc),
      ...result,
    };
  },
});

export const pollLatestNoaaPublishRace = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao =
      String(args.stationIcao ?? STATION_ICAO).trim().toUpperCase();

    const hit = await fetchLatestNoaaTgftp(stationIcao);
    const raceRow = await ctx.runMutation("ankara:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: hit.reportTsUtc,
      source: RACE_SOURCE.TGFTP,
      rawMetar: hit.rawMetar,
      seenAt: hit.seenAt,
      ...(Number.isFinite(hit.lastModifiedAt)
        ? { sourceLastModifiedAt: hit.lastModifiedAt }
        : {}),
    });

    // Also store the observation from NOAA so we have it in the METAR table.
    const reportType = extractReportType(hit.rawMetar) ?? "METAR";
    const labeledMetar = canonicalizeLabeledRawMetar(reportType, hit.rawMetar);
    const obsTimeUtc = parseReportTimestampFromRaw(labeledMetar ?? hit.rawMetar);

    if (Number.isFinite(obsTimeUtc) && labeledMetar) {
      const row = buildObservationRow({
        stationIcao,
        rawMetar: labeledMetar,
        obsTimeUtc,
        reportedTempC: null,
        sourcePrefix: "tgftp",
        fallbackReportType: reportType,
      });
      if (row) {
        await ctx.runMutation("ankara:upsertStationRowsBatch", {
          stationIcao,
          rows: [row],
        });
      }
    }

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

export const pollMgmCurrentConditions = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao =
      String(args.stationIcao ?? STATION_ICAO).trim().toUpperCase();

    const mgmData = await fetchMgmCurrentConditions();

    if (mgmData.tempC === null) {
      return {
        status: "error",
        error: "MGM sondurumlar did not include a valid temperature.",
      };
    }

    const tempC = roundToTenth(mgmData.tempC);
    const tempF = toFahrenheit(tempC);
    const obsDate = formatAnkaraDate(mgmData.obsTimeUtc);
    const obsLocal = formatAnkaraDateTime(mgmData.obsTimeUtc);

    await ctx.runMutation("ankara:storeMgmObservation", {
      stationIcao,
      date: obsDate,
      obsTimeUtc: mgmData.obsTimeUtc,
      obsTimeLocal: obsLocal,
      tempC,
      tempF,
      humidity: mgmData.humidity ?? undefined,
      windSpeedMps: mgmData.windSpeedMps ?? undefined,
      windDirection: mgmData.windDirection ?? undefined,
      visibility: mgmData.visibility ?? undefined,
      pressureHpa: mgmData.pressureHpa ?? undefined,
      cloudCover: mgmData.cloudCover ?? undefined,
      source: `mgm_sondurumlar_${MGM_STATION_ID}`,
    });

    return {
      status: "ok",
      observedAtUtc: mgmData.obsTimeUtc,
      observedAtLocal: obsLocal,
      tempC,
      tempF,
    };
  },
});

export const pollMgmForecast = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao =
      String(args.stationIcao ?? STATION_ICAO).trim().toUpperCase();

    const [hourlyResult, dailyResult] = await Promise.allSettled([
      fetchMgm3HourlyForecast(),
      fetchMgm5DayForecast(),
    ]);

    let hourlyCount = 0;
    let dailyCount = 0;
    const errors = [];

    if (hourlyResult.status === "fulfilled" && hourlyResult.value.length > 0) {
      await ctx.runMutation("ankara:storeMgmHourlyForecastBatch", {
        stationIcao,
        rows: hourlyResult.value,
        capturedAt: Date.now(),
      });
      hourlyCount = hourlyResult.value.length;
    } else if (hourlyResult.status === "rejected") {
      errors.push(`3-hourly: ${formatErrorMessage(hourlyResult.reason)}`);
    }

    if (dailyResult.status === "fulfilled") {
      dailyCount = dailyResult.value.length;
    } else {
      errors.push(`5-day: ${formatErrorMessage(dailyResult.reason)}`);
    }

    return {
      status: errors.length === 0 ? "ok" : "partial",
      hourlyForecastRows: hourlyCount,
      dailyForecastRows: dailyCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// Exported queries
// ---------------------------------------------------------------------------

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
      .query("ankaraMetarObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("ankaraDailySummaries")
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
    routineOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const stationIcao =
      String(args.stationIcao ?? STATION_ICAO).trim().toUpperCase();
    const requestedLimit = Number.isInteger(args.limit)
      ? Number(args.limit)
      : DEFAULT_RACE_QUERY_LIMIT;
    const limit = Math.max(1, Math.min(MAX_RACE_QUERY_LIMIT, requestedLimit));
    const routineOnly = args.routineOnly !== false;

    const rows = await ctx.db
      .query("ankaraPublishRaceReports")
      .withIndex("by_station_reportTs", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .order("desc")
      .take(MAX_RACE_QUERY_LIMIT);

    const filteredRows = routineOnly
      ? rows.filter((row) => inferPublishRaceReportType(row) !== "SPECI")
      : rows;

    return {
      stationIcao,
      count: Math.min(filteredRows.length, limit),
      rows: filteredRows.slice(0, limit),
    };
  },
});

export const getMgmObservations = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const rows = await ctx.db
      .query("ankaraMgmObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
    return { rows };
  },
});

export const getMgmHourlyForecasts = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const rows = await ctx.db
      .query("ankaraMgmHourlyForecasts")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.forecastTimeUtc - b.forecastTimeUtc);
    return { rows };
  },
});
