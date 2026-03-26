import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const MILAN_TIMEZONE = "Europe/Rome";
const METEOAM_FETCH_TIMEOUT_MS = 25000;
const DEFAULT_METEOAM_BASE_URL = "https://api.meteoam.it/deda-ows";
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const RACE_SOURCE = {
  METEOAM: "meteoam",
  TGFTP: "tgftp",
};
const PUBLISH_RACE_WINNER = {
  METEOAM: "meteoam",
  TGFTP: "tgftp",
  TIE: "tie",
};
const DEFAULT_RACE_QUERY_LIMIT = 12;
const MAX_RACE_QUERY_LIMIT = 48;
const METEOAM_LOOKBACK_MS = 36 * 60 * 60 * 1000;
const METEOAM_LOOKAHEAD_MS = 60 * 60 * 1000;

const milanDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MILAN_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const milanDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MILAN_TIMEZONE,
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

function formatMilanDate(epochMs) {
  const parts = getDateParts(milanDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatMilanDateTime(epochMs) {
  const parts = getDateParts(milanDateTimeFormatter, new Date(epochMs));
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

function extractTempInfo(rawMetar) {
  const remarkMatch = String(rawMetar ?? "").match(/\bT([01])(\d{3})([01])(\d{3})\b/);
  if (remarkMatch) {
    const isNegative = remarkMatch[1] === "1";
    const magnitude = Number(remarkMatch[2]) / 10;
    const tempC = isNegative ? -magnitude : magnitude;
    return {
      tempC: roundToTenth(tempC),
      source: "remark_T",
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
  const match =
    /^(?:(METAR|SPECI)\s+)?[A-Z0-9]{4}\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(
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

function parseValidUtcEpoch(validValue) {
  const trimmed = toNonEmptyString(validValue);
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const withTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const epochMs = Date.parse(withTimezone);
  return Number.isFinite(epochMs) ? epochMs : null;
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

function formatIsoSecondZ(epochMs) {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function getMeteoAmBaseUrl() {
  return (
    toNonEmptyString(process.env.METEOAM_BASE_URL)?.replace(/\/+$/, "") ??
    DEFAULT_METEOAM_BASE_URL
  );
}

function buildMeteoAmMetarRangeUrl(stationIcao, startIso, endIso) {
  return `${getMeteoAmBaseUrl()}/metar-taf-icao/${encodeURIComponent(
    stationIcao,
  )}/${encodeURIComponent(startIso)}/${encodeURIComponent(endIso)}`;
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), METEOAM_FETCH_TIMEOUT_MS);
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

function buildObservationRow({
  stationIcao,
  rawMetar,
  obsTimeUtc,
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

  const tempInfo = extractTempInfo(normalizedMetar);
  if (!tempInfo) {
    return null;
  }

  const tempC = roundToTenth(tempInfo.tempC);
  const tempF = toFahrenheit(tempC);

  return {
    stationIcao,
    date: formatMilanDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatMilanDateTime(obsTimeUtc),
    reportType,
    tempC,
    tempF,
    rawMetar: normalizedMetar,
    source: `${sourcePrefix}:${tempInfo.source}`,
  };
}

function parseMeteoAmLatestPayload(payload, stationIcao, nowEpochMs = Date.now()) {
  const stations = Array.isArray(payload) ? payload : [];
  const stationPayload =
    stations.find(
      (item) => String(item?.icao ?? "").trim().toUpperCase() === stationIcao,
    ) ?? stations[0];
  const metarEntries = Array.isArray(stationPayload?.metar)
    ? stationPayload.metar
    : [];

  const rows = metarEntries
    .map((entry) => {
      const rawMetar = toNonEmptyString(entry?.metar_message);
      if (!rawMetar) {
        return null;
      }
      if (!new RegExp(`\\b${stationIcao}\\b`, "i").test(rawMetar)) {
        return null;
      }

      const reportType = extractReportType(rawMetar) ?? "METAR";
      const rawObsTimeUtc = parseReportTimestampFromRaw(rawMetar, nowEpochMs);
      const validObsTimeUtc = parseValidUtcEpoch(entry?.validity);
      const obsTimeUtc = rawObsTimeUtc ?? validObsTimeUtc;

      if (!Number.isFinite(obsTimeUtc)) {
        return null;
      }
      if (obsTimeUtc > nowEpochMs + METEOAM_LOOKAHEAD_MS) {
        return null;
      }

      return buildObservationRow({
        stationIcao,
        rawMetar,
        obsTimeUtc,
        sourcePrefix: "meteoam_deda",
        fallbackReportType: reportType,
      });
    })
    .filter(Boolean)
    .sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

  if (!rows.length) {
    throw new Error(
      `MeteoAM response did not include a parseable ${stationIcao} METAR row.`,
    );
  }

  return rows[rows.length - 1];
}

async function fetchLatestMeteoAmRaceHit(stationIcao) {
  const nowEpochMs = Date.now();
  const startIso = formatIsoSecondZ(nowEpochMs - METEOAM_LOOKBACK_MS);
  const endIso = formatIsoSecondZ(nowEpochMs + METEOAM_LOOKAHEAD_MS);
  const response = await fetchWithTimeout(
    buildMeteoAmMetarRangeUrl(stationIcao, startIso, endIso),
    {
      headers: {
        Accept: "application/json,*/*",
        "Cache-Control": "no-cache",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `MeteoAM latest fetch failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  const row = parseMeteoAmLatestPayload(payload, stationIcao, nowEpochMs);
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

function computePublishRaceWinner(meteoAmFirstSeenAt, tgftpFirstSeenAt) {
  if (!Number.isFinite(meteoAmFirstSeenAt) || !Number.isFinite(tgftpFirstSeenAt)) {
    return { winner: null, leadMs: null };
  }
  if (meteoAmFirstSeenAt < tgftpFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.METEOAM,
      leadMs: tgftpFirstSeenAt - meteoAmFirstSeenAt,
    };
  }
  if (tgftpFirstSeenAt < meteoAmFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.TGFTP,
      leadMs: meteoAmFirstSeenAt - tgftpFirstSeenAt,
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
      row?.rawMetar ?? row?.meteoAmRawMetar ?? row?.tgftpRawMetar ?? "",
    ) ??
    (row?.meteoAmRawMetar ? "METAR" : null)
  );
}

async function recomputeDailySummary(ctx, stationIcao, date) {
  const rows = await ctx.db
    .query("milanMetarObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("milanDailySummaries")
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

  await ctx.db.insert("milanDailySummaries", patch);
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
        .query("milanMetarObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("milanMetarObservations", {
          ...row,
          ...(seenAt !== null ? { meteoAmFirstSeenAt: seenAt } : {}),
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      const patch = {};
      if (existing.meteoAmFirstSeenAt === undefined && seenAt !== null) {
        patch.meteoAmFirstSeenAt = seenAt;
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
    source: v.union(v.literal(RACE_SOURCE.METEOAM), v.literal(RACE_SOURCE.TGFTP)),
    rawMetar: v.string(),
    seenAt: v.number(),
    sourceLastModifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("milanPublishRaceReports")
      .withIndex("by_station_reportTs", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("reportTsUtc", args.reportTsUtc),
      )
      .first();

    const now = Date.now();
    const reportDateLocal = formatMilanDate(args.reportTsUtc);

    if (!existing) {
      const patch = {
        stationIcao: args.stationIcao,
        reportDateLocal,
        reportTsUtc: args.reportTsUtc,
        rawMetar: args.rawMetar,
        ...(args.reportType ? { reportType: args.reportType } : {}),
        ...(args.source === RACE_SOURCE.METEOAM
          ? {
              meteoAmRawMetar: args.rawMetar,
              meteoAmFirstSeenAt: args.seenAt,
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
      const insertedId = await ctx.db.insert("milanPublishRaceReports", patch);
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

    if (args.source === RACE_SOURCE.METEOAM) {
      if (!existing.meteoAmRawMetar) {
        patch.meteoAmRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.meteoAmFirstSeenAt)) {
        patch.meteoAmFirstSeenAt = args.seenAt;
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
      patch.meteoAmFirstSeenAt ?? existing.meteoAmFirstSeenAt,
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

    const { seenAt, row } = await fetchLatestMeteoAmRaceHit(stationIcao);
    const result = await ctx.runMutation("milan:upsertStationRowsBatch", {
      stationIcao,
      seenAt,
      rows: [row],
    });
    const raceRow = await ctx.runMutation("milan:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: row.obsTimeUtc,
      reportType: row.reportType,
      source: RACE_SOURCE.METEOAM,
      rawMetar: row.rawMetar,
      seenAt,
    });

    return {
      ok: true,
      stationIcao,
      row: {
        ...row,
        meteoAmFirstSeenAt: raceRow?.meteoAmFirstSeenAt ?? seenAt,
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
    const raceRow = await ctx.runMutation("milan:recordPublishRaceHit", {
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
      .query("milanMetarObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("milanDailySummaries")
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
    const stationIcao = String(args.stationIcao ?? "LIMC").trim().toUpperCase();
    const requestedLimit = Number.isInteger(args.limit)
      ? Number(args.limit)
      : DEFAULT_RACE_QUERY_LIMIT;
    const limit = Math.max(1, Math.min(MAX_RACE_QUERY_LIMIT, requestedLimit));
    const routineOnly = args.routineOnly !== false;

    const rows = await ctx.db
      .query("milanPublishRaceReports")
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
