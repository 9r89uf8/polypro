import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const SEOUL_TIMEZONE = "Asia/Seoul";
const AMO_FETCH_TIMEOUT_MS = 25000;
const DEFAULT_AMO_API_BASE_URL = "http://amoapi.kma.go.kr";
const GLOBAL_AMO_API_BASE_URL = "https://global.amo.go.kr/mobileApi/global_api/v1";
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const RACE_SOURCE = {
  AMO: "amo",
  TGFTP: "tgftp",
};
const PUBLISH_RACE_WINNER = {
  AMO: "amo",
  TGFTP: "tgftp",
  TIE: "tie",
};
const DEFAULT_RACE_QUERY_LIMIT = 12;
const MAX_RACE_QUERY_LIMIT = 48;

const seoulDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const seoulDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
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
  const parts = formatter.formatToParts(date);
  const values = {};
  for (const part of parts) {
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
  if (!trimmed || trimmed === "-") {
    return null;
  }
  const parsed = Number(trimmed.replace(/,/g, ""));
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
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
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

function extractReportType(rawMetar) {
  const match = /^(METAR|SPECI)\b/.exec(String(rawMetar ?? "").trim().toUpperCase());
  return match ? match[1] : null;
}

function parseReportTimestampFromRaw(rawMetar, nowEpochMs = Date.now()) {
  const match = /^(METAR|SPECI)\s+[A-Z0-9]{4}\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(
    String(rawMetar ?? "").trim(),
  );
  if (!match) {
    return null;
  }

  const now = new Date(nowEpochMs);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const reportDay = Number(match[2]);
  const reportHour = Number(match[3]);
  const reportMinute = Number(match[4]);

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

function parseSeoulLocalTimestamp(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      String(value ?? "").trim(),
    );
  if (!match) {
    return null;
  }
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 9,
    Number(match[5]),
    match[6] ? Number(match[6]) : 0,
    0,
  );
}

function decodeXmlEntities(value) {
  return String(value ?? "").replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, entity) => {
      const named = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: '"',
      };
      if (named[entity]) {
        return named[entity];
      }
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const parsed = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
      }
      if (entity.startsWith("#")) {
        const parsed = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
      }
      return match;
    },
  );
}

function extractAmoMetar(rawXml) {
  const xml = String(rawXml ?? "");
  const match = /<metarMsg\b[^>]*>([\s\S]*?)<\/metarMsg>/i.exec(xml);
  if (!match) {
    throw new Error("AMO API response did not include a metarMsg field.");
  }

  const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(match[1]);
  const text = cdataMatch ? cdataMatch[1] : decodeXmlEntities(match[1]);
  const normalized = toNonEmptyString(text?.replace(/\s+/g, " "));
  if (!normalized) {
    throw new Error("AMO API metarMsg field was empty.");
  }
  return normalized;
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
    date: formatSeoulDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatSeoulDateTime(obsTimeUtc),
    reportType,
    tempC,
    tempF,
    rawMetar: normalizedMetar,
    source: `${sourcePrefix}:${tempInfo.source}`,
  };
}

function parseAmoLatestPayload(xmlText, stationIcao) {
  const rawMetar = extractAmoMetar(xmlText);
  if (!new RegExp(`\\b${stationIcao}\\b`, "i").test(rawMetar)) {
    throw new Error(`AMO API did not return ${stationIcao}.`);
  }

  const reportType = extractReportType(rawMetar);
  if (!reportType) {
    throw new Error("AMO API METAR did not include a METAR/SPECI prefix.");
  }

  const obsTimeUtc = parseReportTimestampFromRaw(rawMetar);
  if (!Number.isFinite(obsTimeUtc)) {
    throw new Error("AMO API METAR did not include a parseable observation timestamp.");
  }

  const row = buildObservationRow({
    stationIcao,
    rawMetar,
    obsTimeUtc,
    sourcePrefix: "amo_api",
    fallbackReportType: reportType,
  });
  if (!row) {
    throw new Error("AMO API METAR did not include a parseable temperature row.");
  }
  return row;
}

function inferPublishRaceReportType(row) {
  return (
    row?.reportType ??
    extractReportType(
      row?.rawMetar ?? row?.amoRawMetar ?? row?.tgftpRawMetar ?? "",
    )
  );
}

function amosObservationChanged(existing, candidate) {
  const fields = [
    "obsTimeLocal",
    "rwyUse",
    "rwyMain",
    "tempC",
    "tempF",
    "dewpointC",
    "dewpointF",
    "qnhHpa",
    "qnhInHg",
    "windDirAvg",
    "windDirMin",
    "windDirMax",
    "windSpeedAvg",
    "windSpeedMin",
    "windSpeedMax",
    "crosswind",
    "headtail",
    "morMeters",
    "rvrMeters",
    "precipMm",
    "source",
    "rawJson",
  ];
  return fields.some((field) => existing[field] !== candidate[field]);
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

function computePublishRaceWinner(amoFirstSeenAt, tgftpFirstSeenAt) {
  if (!Number.isFinite(amoFirstSeenAt) || !Number.isFinite(tgftpFirstSeenAt)) {
    return { winner: null, leadMs: null };
  }
  if (amoFirstSeenAt < tgftpFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.AMO,
      leadMs: tgftpFirstSeenAt - amoFirstSeenAt,
    };
  }
  if (tgftpFirstSeenAt < amoFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.TGFTP,
      leadMs: amoFirstSeenAt - tgftpFirstSeenAt,
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

async function recomputeDailySummary(ctx, stationIcao, date) {
  const rows = await ctx.db
    .query("seoulMetarObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("seoulDailySummaries")
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

  await ctx.db.insert("seoulDailySummaries", patch);
}

function getAmoApiBaseUrl() {
  return (
    toNonEmptyString(process.env.AMO_API_BASE_URL)?.replace(/\/+$/, "") ??
    DEFAULT_AMO_API_BASE_URL
  );
}

function buildAmoMetarUrl(stationIcao) {
  const url = new URL(`${getAmoApiBaseUrl()}/amoApi/metar`);
  url.searchParams.set("icao", stationIcao);
  return url.toString();
}

function buildGlobalAmoAmosInfoUrl(stationIcao) {
  const url = new URL(`${GLOBAL_AMO_API_BASE_URL}/amos_info.do`);
  url.searchParams.set("air_code", stationIcao);
  return url.toString();
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AMO_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchLatestAmoRaceHit(stationIcao) {
  const response = await fetchWithTimeout(buildAmoMetarUrl(stationIcao), {
    headers: {
      Accept: "application/xml,text/xml,*/*",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AMO API latest fetch failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const body = await response.text();
  const row = parseAmoLatestPayload(body, stationIcao);
  return {
    seenAt: Date.now(),
    row,
  };
}

function parseAmoRunwayRow(item, stationIcao) {
  if (String(item?.air_code ?? "").trim().toUpperCase() !== stationIcao) {
    return null;
  }

  const obsTimeLocalBase = toNonEmptyString(item?.tm_fc);
  const obsTimeUtc = parseSeoulLocalTimestamp(obsTimeLocalBase);
  if (!Number.isFinite(obsTimeUtc)) {
    return null;
  }

  const obsTimeLocal =
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(obsTimeLocalBase)
      ? `${obsTimeLocalBase}:00`
      : formatSeoulDateTime(obsTimeUtc);

  const tempC = parseNumber(item?.temp);
  const dewpointC = parseNumber(item?.dewpoint);

  return {
    stationIcao,
    date: formatSeoulDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal,
    rwyNo: toNonEmptyString(item?.rwy_no) ?? "?",
    rwyDir: toNonEmptyString(item?.rwy_dir) ?? "?",
    ...(toNonEmptyString(item?.rwy_use) ? { rwyUse: toNonEmptyString(item?.rwy_use) } : {}),
    ...(toNonEmptyString(item?.rwy_main)
      ? { rwyMain: toNonEmptyString(item?.rwy_main) }
      : {}),
    ...(tempC !== null ? { tempC: roundToTenth(tempC), tempF: toFahrenheit(tempC) } : {}),
    ...(dewpointC !== null
      ? { dewpointC: roundToTenth(dewpointC), dewpointF: toFahrenheit(dewpointC) }
      : {}),
    ...(parseNumber(item?.qnh_hpa) !== null ? { qnhHpa: parseNumber(item?.qnh_hpa) } : {}),
    ...(parseNumber(item?.qnh_inhg) !== null
      ? { qnhInHg: parseNumber(item?.qnh_inhg) }
      : {}),
    ...(parseNumber(item?.wd_avg) !== null ? { windDirAvg: parseNumber(item?.wd_avg) } : {}),
    ...(parseNumber(item?.wd_min) !== null ? { windDirMin: parseNumber(item?.wd_min) } : {}),
    ...(parseNumber(item?.wd_max) !== null ? { windDirMax: parseNumber(item?.wd_max) } : {}),
    ...(parseNumber(item?.ws_avg) !== null ? { windSpeedAvg: parseNumber(item?.ws_avg) } : {}),
    ...(parseNumber(item?.ws_min) !== null ? { windSpeedMin: parseNumber(item?.ws_min) } : {}),
    ...(parseNumber(item?.ws_max) !== null ? { windSpeedMax: parseNumber(item?.ws_max) } : {}),
    ...(toNonEmptyString(item?.cross) ? { crosswind: toNonEmptyString(item?.cross) } : {}),
    ...(toNonEmptyString(item?.headtail)
      ? { headtail: toNonEmptyString(item?.headtail) }
      : {}),
    ...(parseNumber(item?.mor) !== null ? { morMeters: parseNumber(item?.mor) } : {}),
    ...(toNonEmptyString(item?.rvr) ? { rvrMeters: toNonEmptyString(item?.rvr) } : {}),
    ...(parseNumber(item?.rn) !== null ? { precipMm: parseNumber(item?.rn) } : {}),
    source: "amos_info",
    rawJson: JSON.stringify(item),
  };
}

async function fetchLatestAmoRunwayRows(stationIcao) {
  const response = await fetchWithTimeout(buildGlobalAmoAmosInfoUrl(stationIcao), {
    headers: {
      Accept: "application/json,*/*",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `AMO runway info fetch failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.results?.items) ? payload.results.items : [];
  const rows = items
    .map((item) => parseAmoRunwayRow(item, stationIcao))
    .filter(Boolean)
    .sort((a, b) =>
      a.obsTimeUtc === b.obsTimeUtc
        ? a.rwyNo.localeCompare(b.rwyNo) || a.rwyDir.localeCompare(b.rwyDir)
        : a.obsTimeUtc - b.obsTimeUtc,
    );

  if (!rows.length) {
    throw new Error("AMO runway info response did not include parseable RKSI rows.");
  }

  return rows;
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
        .query("seoulMetarObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("seoulMetarObservations", {
          ...row,
          ...(seenAt !== null ? { amoFirstSeenAt: seenAt } : {}),
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      const patch = {};
      if (existing.amoFirstSeenAt === undefined && seenAt !== null) {
        patch.amoFirstSeenAt = seenAt;
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

export const upsertAmosRowsBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(
      v.object({
        stationIcao: v.string(),
        date: v.string(),
        obsTimeUtc: v.number(),
        obsTimeLocal: v.string(),
        rwyNo: v.string(),
        rwyDir: v.string(),
        rwyUse: v.optional(v.string()),
        rwyMain: v.optional(v.string()),
        tempC: v.optional(v.number()),
        tempF: v.optional(v.number()),
        dewpointC: v.optional(v.number()),
        dewpointF: v.optional(v.number()),
        qnhHpa: v.optional(v.number()),
        qnhInHg: v.optional(v.number()),
        windDirAvg: v.optional(v.number()),
        windDirMin: v.optional(v.number()),
        windDirMax: v.optional(v.number()),
        windSpeedAvg: v.optional(v.number()),
        windSpeedMin: v.optional(v.number()),
        windSpeedMax: v.optional(v.number()),
        crosswind: v.optional(v.string()),
        headtail: v.optional(v.string()),
        morMeters: v.optional(v.number()),
        rvrMeters: v.optional(v.string()),
        precipMm: v.optional(v.number()),
        source: v.string(),
        rawJson: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let insertedCount = 0;
    let patchedCount = 0;
    let unchangedCount = 0;

    for (const row of args.rows) {
      if (!parseDateKey(row.date)) {
        throw new Error(`Invalid date key: ${row.date}`);
      }

      const existing = await ctx.db
        .query("seoulAmosObservations")
        .withIndex("by_station_date_ts_rwy", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc)
            .eq("rwyNo", row.rwyNo)
            .eq("rwyDir", row.rwyDir),
        )
        .first();

      if (!existing) {
        await ctx.db.insert("seoulAmosObservations", {
          ...row,
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      if (!amosObservationChanged(existing, row)) {
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
    };
  },
});

export const recordPublishRaceHit = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    reportTsUtc: v.number(),
    reportType: v.optional(v.union(v.literal("METAR"), v.literal("SPECI"))),
    source: v.union(v.literal(RACE_SOURCE.AMO), v.literal(RACE_SOURCE.TGFTP)),
    rawMetar: v.string(),
    seenAt: v.number(),
    sourceLastModifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("seoulPublishRaceReports")
      .withIndex("by_station_reportTs", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("reportTsUtc", args.reportTsUtc),
      )
      .first();

    const now = Date.now();
    const reportDateLocal = formatSeoulDate(args.reportTsUtc);

    if (!existing) {
      const patch = {
        stationIcao: args.stationIcao,
        reportDateLocal,
        reportTsUtc: args.reportTsUtc,
        rawMetar: args.rawMetar,
        ...(args.reportType ? { reportType: args.reportType } : {}),
        ...(args.source === RACE_SOURCE.AMO
          ? {
              amoRawMetar: args.rawMetar,
              amoFirstSeenAt: args.seenAt,
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
      const insertedId = await ctx.db.insert("seoulPublishRaceReports", patch);
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

    if (args.source === RACE_SOURCE.AMO) {
      if (!existing.amoRawMetar) {
        patch.amoRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.amoFirstSeenAt)) {
        patch.amoFirstSeenAt = args.seenAt;
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
      patch.amoFirstSeenAt ?? existing.amoFirstSeenAt,
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

export const pollLatestStationMetar = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const { seenAt, row } = await fetchLatestAmoRaceHit(stationIcao);
    const result = await ctx.runMutation("seoul:upsertStationRowsBatch", {
      stationIcao,
      seenAt,
      rows: [row],
    });
    const raceRow = await ctx.runMutation("seoul:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: row.obsTimeUtc,
      reportType: row.reportType,
      source: RACE_SOURCE.AMO,
      rawMetar: row.rawMetar,
      seenAt,
    });

    return {
      ok: true,
      stationIcao,
      row: {
        ...row,
        amoFirstSeenAt: raceRow?.amoFirstSeenAt ?? seenAt,
      },
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
    const raceRow = await ctx.runMutation("seoul:recordPublishRaceHit", {
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

export const pollLatestAmosRunways = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const rows = await fetchLatestAmoRunwayRows(stationIcao);
    const result = await ctx.runMutation("seoul:upsertAmosRowsBatch", {
      stationIcao,
      rows,
    });
    const latest15L =
      rows.find((row) => row.rwyDir === "15L" && Number.isFinite(row.tempC)) ?? null;

    return {
      ok: true,
      stationIcao,
      rowCount: rows.length,
      sampleTimeUtc: rows[0]?.obsTimeUtc ?? null,
      sampleTimeLocal: rows[0]?.obsTimeLocal ?? null,
      latest15L,
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
      .query("seoulMetarObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("seoulDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .first();

    const amosRows = await ctx.db
      .query("seoulAmosObservations")
      .withIndex("by_station_date_ts_rwy", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    amosRows.sort((a, b) =>
      a.obsTimeUtc === b.obsTimeUtc
        ? a.rwyNo.localeCompare(b.rwyNo) || a.rwyDir.localeCompare(b.rwyDir)
        : a.obsTimeUtc - b.obsTimeUtc,
    );

    return { rows, summary, amosRows };
  },
});

export const getRecentPublishRaceReports = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    limit: v.optional(v.number()),
    routineOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "RKSI").trim().toUpperCase();
    const requestedLimit = Number.isInteger(args.limit)
      ? Number(args.limit)
      : DEFAULT_RACE_QUERY_LIMIT;
    const limit = Math.max(1, Math.min(MAX_RACE_QUERY_LIMIT, requestedLimit));
    const routineOnly = args.routineOnly !== false;

    const rows = await ctx.db
      .query("seoulPublishRaceReports")
      .withIndex("by_station_reportTs", (query) => query.eq("stationIcao", stationIcao))
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
