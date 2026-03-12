import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const SAO_PAULO_TIMEZONE = "America/Sao_Paulo";
const REDEMET_HISTORY_FORM_URL =
  "https://redemet.decea.mil.br/old/modal/consulta-de-mensagens/";
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const REDEMET_FETCH_TIMEOUT_MS = 25000;
const REDEMET_EARLY_UTC_HOURS_FOR_LOCAL_DAY = 3;
const RACE_SOURCE = {
  REDEMET: "redemet",
  TGFTP: "tgftp",
};
const PUBLISH_RACE_WINNER = {
  REDEMET: "redemet",
  TGFTP: "tgftp",
  TIE: "tie",
};
const DEFAULT_RACE_QUERY_LIMIT = 12;
const MAX_RACE_QUERY_LIMIT = 48;
const DEFAULT_RACE_WATCH_INTERVAL_MS = 5000;
const DEFAULT_RACE_WATCH_DURATION_MS = 4 * 60 * 1000;

const saoPauloDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SAO_PAULO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const saoPauloDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SAO_PAULO_TIMEZONE,
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

function formatSaoPauloDate(epochMs) {
  const parts = getDateParts(saoPauloDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatSaoPauloDateTime(epochMs) {
  const parts = getDateParts(saoPauloDateTimeFormatter, new Date(epochMs));
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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateKeyFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate(),
  )}`;
}

function shiftDateKey(dateKey, deltaDays) {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    return null;
  }
  const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day);
  return formatDateKeyFromUtcDate(new Date(utcMs + deltaDays * 24 * 60 * 60 * 1000));
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

function getRedemetApiBaseUrl() {
  const baseUrl = toNonEmptyString(process.env.REDEMET_API_BASE_URL);
  if (!baseUrl) {
    throw new Error("Missing REDEMET_API_BASE_URL.");
  }
  return baseUrl.replace(/\/+$/, "");
}

function getRedemetApiKey() {
  const apiKey = toNonEmptyString(process.env.REDEMET_API_KEY);
  if (!apiKey) {
    throw new Error("Missing REDEMET_API_KEY.");
  }
  return apiKey;
}

function buildLatestInfoUrl(stationIcao) {
  const url = new URL(`${getRedemetApiBaseUrl()}/aerodromos/info`);
  url.searchParams.set("localidade", stationIcao);
  url.searchParams.set("metar", "'sim'");
  url.searchParams.set("taf", "'sim'");
  url.searchParams.set("aviso", "'sim'");
  url.searchParams.set("api_key", getRedemetApiKey());
  return url.toString();
}

function parseRedemetUtcTimestamp(value) {
  const match =
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?:\(UTC\))?$/.exec(
      String(value ?? "").trim(),
    );
  if (!match) {
    return null;
  }
  return Date.UTC(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
}

function extractReportType(rawMetar) {
  const match = /^(METAR|SPECI)\b/.exec(String(rawMetar ?? "").trim().toUpperCase());
  return match ? match[1] : null;
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

function buildObservationRow({
  stationIcao,
  rawMetar,
  obsTimeUtc,
  reportedTempText,
  sourcePrefix,
}) {
  const normalizedMetar = toNonEmptyString(rawMetar);
  if (!normalizedMetar) {
    return null;
  }

  const reportType = extractReportType(normalizedMetar);
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
    date: formatSaoPauloDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatSaoPauloDateTime(obsTimeUtc),
    reportType,
    tempC,
    tempF,
    rawMetar: normalizedMetar,
    source: `${sourcePrefix}:${tempInfo.source}`,
  };
}

function parseLatestObservation(payload, stationIcao) {
  const data = payload?.data ?? {};
  const rawMetar = data.metar;
  const obsTimeUtc = parseRedemetUtcTimestamp(data.data);
  if (!Number.isFinite(obsTimeUtc)) {
    throw new Error("REDEMET latest payload did not include a valid UTC timestamp.");
  }

  const row = buildObservationRow({
    stationIcao,
    rawMetar,
    obsTimeUtc,
    reportedTempText: data.temperatura,
    sourcePrefix: "redemet_latest",
  });
  if (!row) {
    throw new Error("REDEMET latest payload did not include a parseable METAR/SPECI row.");
  }
  return row;
}

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, entity) => {
      const named = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      if (named[entity]) {
        return named[entity];
      }
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const codePoint = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      if (entity.startsWith("#")) {
        const codePoint = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      return match;
    },
  );
}

function stripHtmlTags(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseHistoryHtmlRows(htmlText, stationIcao) {
  const rows = [];
  const rowPattern =
    /<tr>\s*<td[^>]*>\s*([\s\S]*?)\s*<\/td>\s*<td[^>]*>\s*([\s\S]*?)\s*<\/td>\s*<td[^>]*>\s*([\s\S]*?)\s*<\/td>\s*<td[^>]*>\s*([\s\S]*?)\s*<\/td>\s*<\/tr>/gi;

  let match;
  while ((match = rowPattern.exec(String(htmlText ?? ""))) !== null) {
    const stationCell = stripHtmlTags(match[1]).toUpperCase();
    const utcDateText = stripHtmlTags(match[3]);
    const rawMetar = stripHtmlTags(match[4]);
    if (stationCell !== stationIcao.toUpperCase()) {
      continue;
    }
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(utcDateText)) {
      continue;
    }
    if (!/^(METAR|SPECI)\b/.test(rawMetar)) {
      continue;
    }
    rows.push({ utcDateText, rawMetar });
  }

  return rows;
}

function parseHistoryObservation(row, stationIcao) {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.utcDateText ?? "");
  if (!dateMatch) {
    return null;
  }
  const reportMatch = /^(METAR|SPECI)\s+[A-Z0-9]{4}\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(
    row.rawMetar ?? "",
  );
  if (!reportMatch) {
    return null;
  }

  const obsTimeUtc = Date.UTC(
    Number(dateMatch[3]),
    Number(dateMatch[2]) - 1,
    Number(reportMatch[2]),
    Number(reportMatch[3]),
    Number(reportMatch[4]),
    0,
    0,
  );

  return buildObservationRow({
    stationIcao,
    rawMetar: row.rawMetar,
    obsTimeUtc,
    sourcePrefix: "redemet_history",
  });
}

function buildHistoryQueryWindows(localDateKey) {
  const nextUtcDateKey = shiftDateKey(localDateKey, 1);
  if (!nextUtcDateKey) {
    throw new Error(`Invalid date key: ${localDateKey}`);
  }

  const localParts = parseDateKey(localDateKey);
  const nextParts = parseDateKey(nextUtcDateKey);
  if (!localParts || !nextParts) {
    throw new Error(`Invalid date key: ${localDateKey}`);
  }

  return [
    {
      start: `${pad2(localParts.day)}/${pad2(localParts.month)}/${localParts.year} 00:00`,
      end: `${pad2(localParts.day)}/${pad2(localParts.month)}/${localParts.year} 23:59`,
    },
    {
      start: `${pad2(nextParts.day)}/${pad2(nextParts.month)}/${nextParts.year} 00:00`,
      end: `${pad2(nextParts.day)}/${pad2(nextParts.month)}/${nextParts.year} ${pad2(
        REDEMET_EARLY_UTC_HOURS_FOR_LOCAL_DAY - 1,
      )}:59`,
    },
  ];
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

function computePublishRaceWinner(redemetFirstSeenAt, tgftpFirstSeenAt) {
  if (!Number.isFinite(redemetFirstSeenAt) || !Number.isFinite(tgftpFirstSeenAt)) {
    return { winner: null, leadMs: null };
  }
  if (redemetFirstSeenAt < tgftpFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.REDEMET,
      leadMs: tgftpFirstSeenAt - redemetFirstSeenAt,
    };
  }
  if (tgftpFirstSeenAt < redemetFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.TGFTP,
      leadMs: redemetFirstSeenAt - tgftpFirstSeenAt,
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
    .query("redemetMetarObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("redemetDailySummaries")
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

  await ctx.db.insert("redemetDailySummaries", patch);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REDEMET_FETCH_TIMEOUT_MS);
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

async function fetchLatestRedemetRaceHit(stationIcao) {
  const response = await fetchWithTimeout(buildLatestInfoUrl(stationIcao), {
    headers: {
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `REDEMET latest fetch failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  const payload = await response.json();
  const row = parseLatestObservation(payload, stationIcao);
  return {
    seenAt: Date.now(),
    row,
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

async function fetchHistoryHtml(window, stationIcao) {
  const formData = new URLSearchParams();
  formData.set("acao", "localidade");
  formData.set("msg_localidade", stationIcao);
  formData.set("consulta_data_ini", window.start);
  formData.set("consulta_data_fim", window.end);
  formData.append("tipo_msg[]", "metar");

  const response = await fetchWithTimeout(REDEMET_HISTORY_FORM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Cache-Control": "no-cache",
    },
    body: formData.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `REDEMET history fetch failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }
  return await response.text();
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
        .query("redemetMetarObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("redemetMetarObservations", {
          ...row,
          ...(seenAt !== null ? { redemetFirstSeenAt: seenAt } : {}),
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      const patch = {};
      if (existing.redemetFirstSeenAt === undefined && seenAt !== null) {
        patch.redemetFirstSeenAt = seenAt;
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
    source: v.union(v.literal(RACE_SOURCE.REDEMET), v.literal(RACE_SOURCE.TGFTP)),
    rawMetar: v.string(),
    seenAt: v.number(),
    sourceLastModifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("redemetPublishRaceReports")
      .withIndex("by_station_reportTs", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("reportTsUtc", args.reportTsUtc),
      )
      .first();

    const now = Date.now();
    const reportDateLocal = formatSaoPauloDate(args.reportTsUtc);

    if (!existing) {
      const patch = {
        stationIcao: args.stationIcao,
        reportDateLocal,
        reportTsUtc: args.reportTsUtc,
        rawMetar: args.rawMetar,
        ...(args.reportType ? { reportType: args.reportType } : {}),
        ...(args.source === RACE_SOURCE.REDEMET
          ? {
              redemetRawMetar: args.rawMetar,
              redemetFirstSeenAt: args.seenAt,
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
      const insertedId = await ctx.db.insert("redemetPublishRaceReports", patch);
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

    if (args.source === RACE_SOURCE.REDEMET) {
      if (!existing.redemetRawMetar) {
        patch.redemetRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.redemetFirstSeenAt)) {
        patch.redemetFirstSeenAt = args.seenAt;
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
      patch.redemetFirstSeenAt ?? existing.redemetFirstSeenAt,
      patch.tgftpFirstSeenAt ?? existing.tgftpFirstSeenAt,
    );
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

    const { seenAt, row } = await fetchLatestRedemetRaceHit(stationIcao);
    const result = await ctx.runMutation("redemet:upsertStationRowsBatch", {
      stationIcao,
      seenAt,
      rows: [row],
    });
    const raceRow = await ctx.runMutation("redemet:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: row.obsTimeUtc,
      reportType: row.reportType,
      source: RACE_SOURCE.REDEMET,
      rawMetar: row.rawMetar,
      seenAt,
    });

    return {
      ok: true,
      stationIcao,
      row: {
        ...row,
        redemetFirstSeenAt: raceRow?.redemetFirstSeenAt ?? seenAt,
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
    const raceRow = await ctx.runMutation("redemet:recordPublishRaceHit", {
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
      Math.min(10 * 60 * 1000, Math.round(args.durationMs ?? DEFAULT_RACE_WATCH_DURATION_MS)),
    );

    const startedAt = Date.now();
    const deadline = startedAt + durationMs;
    let iterations = 0;
    let errorCount = 0;
    let lastError = null;
    let lastRedemet = null;
    let lastTgftp = null;
    const touchedReportTimestamps = new Set();

    while (Date.now() <= deadline) {
      try {
        const [redemetHit, tgftpHit] = await Promise.all([
          fetchLatestRedemetRaceHit(stationIcao),
          fetchLatestTgftpRaceHit(stationIcao),
        ]);

        lastRedemet = redemetHit;
        lastTgftp = tgftpHit;

        const [redemetRaceRow, tgftpRaceRow] = await Promise.all([
          ctx.runMutation("redemet:recordPublishRaceHit", {
            stationIcao,
            reportTsUtc: redemetHit.row.obsTimeUtc,
            reportType: redemetHit.row.reportType,
            source: RACE_SOURCE.REDEMET,
            rawMetar: redemetHit.row.rawMetar,
            seenAt: redemetHit.seenAt,
          }),
          ctx.runMutation("redemet:recordPublishRaceHit", {
            stationIcao,
            reportTsUtc: tgftpHit.reportTsUtc,
            source: RACE_SOURCE.TGFTP,
            rawMetar: tgftpHit.rawMetar,
            seenAt: tgftpHit.seenAt,
            ...(Number.isFinite(tgftpHit.lastModifiedAt)
              ? { sourceLastModifiedAt: tgftpHit.lastModifiedAt }
              : {}),
          }),
        ]);

        if (redemetRaceRow?.reportTsUtc) {
          touchedReportTimestamps.add(redemetRaceRow.reportTsUtc);
        }
        if (tgftpRaceRow?.reportTsUtc) {
          touchedReportTimestamps.add(tgftpRaceRow.reportTsUtc);
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
      lastError,
      touchedReportCount: touchedReportTimestamps.size,
      latestRedemetReportTsUtc: lastRedemet?.row?.obsTimeUtc ?? null,
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

    const windows = buildHistoryQueryWindows(date);
    const dedupedRows = new Map();
    let downloadedRowCount = 0;

    for (const window of windows) {
      const html = await fetchHistoryHtml(window, stationIcao);
      const parsedRows = parseHistoryHtmlRows(html, stationIcao);
      downloadedRowCount += parsedRows.length;
      for (const parsedRow of parsedRows) {
        const observationRow = parseHistoryObservation(parsedRow, stationIcao);
        if (!observationRow) {
          continue;
        }
        if (observationRow.date !== date) {
          continue;
        }
        dedupedRows.set(observationRow.obsTimeUtc, observationRow);
      }
    }

    const rows = Array.from(dedupedRows.values()).sort(
      (a, b) => a.obsTimeUtc - b.obsTimeUtc,
    );
    const result = await ctx.runMutation("redemet:upsertStationRowsBatch", {
      stationIcao,
      rows,
    });

    return {
      ok: true,
      stationIcao,
      date,
      downloadedRowCount,
      rowCount: rows.length,
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
      .query("redemetMetarObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("redemetDailySummaries")
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
    const stationIcao = String(args.stationIcao ?? "SBGR").trim().toUpperCase();
    const requestedLimit = Number.isInteger(args.limit)
      ? Number(args.limit)
      : DEFAULT_RACE_QUERY_LIMIT;
    const limit = Math.max(1, Math.min(MAX_RACE_QUERY_LIMIT, requestedLimit));

    const rows = await ctx.db
      .query("redemetPublishRaceReports")
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
