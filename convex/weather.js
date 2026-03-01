//convex/weather.js
import {
  actionGeneric,
  internalMutationGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const CHICAGO_TIMEZONE = "America/Chicago";
const COMPARISON_DAY_START_MINUTE = 51;
const MILLIS_IN_DAY = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 3000, 10000];
const OBS_INSERT_CHUNK_SIZE = 400;
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const METAR_MODE = {
  OFFICIAL: "official",
  ALL: "all",
};
const STATION_TO_IEM = {
  KORD: "ORD",
};
const SOURCE_PRIORITY = {
  tmpf: 0,
  metar_integer: 1,
  remark_T: 2,
};

const chicagoDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CHICAGO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const chicagoDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CHICAGO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

const monthArgsValidator = {
  stationIcao: v.string(),
  year: v.number(),
  month: v.number(),
};
const metarModeValidator = v.union(
  v.literal(METAR_MODE.OFFICIAL),
  v.literal(METAR_MODE.ALL),
);

function normalizeMetarMode(mode) {
  if (mode === METAR_MODE.ALL) {
    return METAR_MODE.ALL;
  }
  return METAR_MODE.OFFICIAL;
}

function getReportTypesForMode(mode) {
  if (mode === METAR_MODE.ALL) {
    return ["1", "3", "4"];
  }
  return ["3", "4"];
}

function assertValidYearMonth(year, month) {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error("Invalid year.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid month.");
  }
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function toCelsius(fahrenheit) {
  return roundToTenth(((fahrenheit - 32) * 5) / 9);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextMonth(year, month) {
  if (month === 12) {
    return { year: year + 1, month: 1 };
  }
  return { year, month: month + 1 };
}

function makeDateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function monthStartDateKey(year, month) {
  return makeDateKey(year, month, 1);
}

function monthEndExclusiveDateKey(year, month) {
  const next = nextMonth(year, month);
  return makeDateKey(next.year, next.month, 1);
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return { year, month, day };
}

function isDateKeyInMonth(dateKey, year, month) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return false;
  }
  return parsed.year === year && parsed.month === month;
}

function stationToIem(stationIcao) {
  if (STATION_TO_IEM[stationIcao]) {
    return STATION_TO_IEM[stationIcao];
  }
  if (stationIcao.startsWith("K")) {
    return stationIcao.slice(1);
  }
  return stationIcao;
}

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

function formatChicagoDate(epochMs) {
  const parts = getDateParts(chicagoDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatChicagoDateTime(epochMs) {
  const parts = getDateParts(chicagoDateTimeFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatComparisonDateKey(epochMs) {
  const parts = getDateParts(chicagoDateTimeFormatter, new Date(epochMs));
  const hourValue = Number(parts.hour);
  const minuteValue = Number(parts.minute);
  const normalizedHour = hourValue === 24 ? 0 : hourValue;

  if (
    normalizedHour === 0 &&
    Number.isFinite(minuteValue) &&
    minuteValue < COMPARISON_DAY_START_MINUTE
  ) {
    return formatChicagoDate(epochMs - MILLIS_IN_DAY);
  }

  return formatChicagoDate(epochMs);
}

function parseValidUtcEpoch(validValue) {
  if (!validValue) {
    return null;
  }
  const normalized = validValue.includes("T")
    ? validValue
    : validValue.replace(" ", "T");
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized);
  const withTimezone = hasTimezone ? normalized : `${normalized}Z`;
  const epoch = Date.parse(withTimezone);
  if (Number.isNaN(epoch)) {
    return null;
  }
  return epoch;
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

function extractTempInfo(rawMetar, tmpfField) {
  if (rawMetar) {
    const remarkMatch = rawMetar.match(/\bT([01])(\d{3})([01])(\d{3})\b/);
    if (remarkMatch) {
      const isNegative = remarkMatch[1] === "1";
      const magnitude = Number(remarkMatch[2]) / 10;
      const tempC = isNegative ? -magnitude : magnitude;
      return {
        tempC: roundToTenth(tempC),
        source: "remark_T",
      };
    }

    const mainTempMatch = rawMetar.match(/\b(M?\d{2})\/(M?\d{2}|\/\/)\b/);
    if (mainTempMatch) {
      const parsedTemp = parseSignedMetarTemp(mainTempMatch[1]);
      if (parsedTemp !== null) {
        return {
          tempC: parsedTemp,
          source: "metar_integer",
        };
      }
    }
  }

  if (tmpfField !== undefined && tmpfField !== null && tmpfField !== "") {
    const tempF = Number(tmpfField);
    if (Number.isFinite(tempF)) {
      return {
        tempC: toCelsius(tempF),
        source: "tmpf",
      };
    }
  }

  return null;
}

function getSourcePriority(source) {
  if (!source || typeof source !== "string") {
    return -1;
  }
  const pieces = source.split(":");
  const key = pieces[pieces.length - 1];
  return SOURCE_PRIORITY[key] ?? -1;
}

function isHighFrequencyGeneratedMetar(rawMetar) {
  if (!rawMetar) {
    return false;
  }
  return rawMetar.toUpperCase().includes("MADISHF");
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

  const tsUtc = Date.UTC(
    Number(stampMatch[1]),
    Number(stampMatch[2]) - 1,
    Number(stampMatch[3]),
    Number(stampMatch[4]),
    Number(stampMatch[5]),
    0,
    0,
  );

  return {
    tsUtc,
    rawMetar: metarLine,
  };
}

function chicagoTodayDateKey() {
  return formatChicagoDate(Date.now());
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];

    if (char === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && csvText[i + 1] === "\n") {
        i += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function parseCsvObservations(csvText) {
  const parsedRows = parseCsv(csvText);
  if (parsedRows.length === 0) {
    return [];
  }

  const headers = parsedRows[0].map((header) => header.trim().toLowerCase());
  const observations = [];

  for (let i = 1; i < parsedRows.length; i += 1) {
    const row = parsedRows[i];
    if (row.length === 1 && row[0].trim() === "") {
      continue;
    }

    const observation = {};
    for (let column = 0; column < headers.length; column += 1) {
      observation[headers[column]] = row[column] ?? "";
    }
    observations.push(observation);
  }

  return observations;
}

function buildIemUrl(stationIem, year, month, mode) {
  const startIso = new Date(
    Date.UTC(year, month - 1, 1, 0, 0, 0) - MILLIS_IN_DAY,
  ).toISOString();
  const endIso = new Date(
    Date.UTC(year, month, 1, 0, 0, 0) + MILLIS_IN_DAY,
  ).toISOString();

  const params = new URLSearchParams();
  params.set("station", stationIem);
  params.set("sts", startIso);
  params.set("ets", endIso);
  for (const reportType of getReportTypesForMode(mode)) {
    params.append("report_type", reportType);
  }
  params.append("data", "metar");
  params.append("data", "tmpf");
  params.set("format", "onlycomma");
  params.set("tz", "UTC");

  return `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${params.toString()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCsvWithRetry(url) {
  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `IEM request failed (${response.status}): ${errorBody.slice(0, 180)}`,
        );
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_DELAYS_MS.length - 1) {
        break;
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("IEM request failed.");
}

function computeDailyMetarMax(observations, year, month, mode) {
  const byDate = new Map();
  const observationRows = [];
  let parsedObservationCount = 0;

  for (const observation of observations) {
    const utcEpoch = parseValidUtcEpoch(observation.valid);
    if (utcEpoch === null) {
      continue;
    }

    if (
      mode === METAR_MODE.OFFICIAL &&
      isHighFrequencyGeneratedMetar(observation.metar)
    ) {
      continue;
    }

    const tempInfo = extractTempInfo(observation.metar, observation.tmpf);
    if (!tempInfo) {
      continue;
    }

    const dateKey = formatComparisonDateKey(utcEpoch);
    if (!isDateKeyInMonth(dateKey, year, month)) {
      continue;
    }

    const tempC = roundToTenth(tempInfo.tempC);
    const tempF = toFahrenheit(tempC);
    parsedObservationCount += 1;
    observationRows.push({
      date: dateKey,
      tsUtc: utcEpoch,
      tsLocal: formatChicagoDateTime(utcEpoch),
      tempC,
      tempF,
      rawMetar: observation.metar ?? "",
      source: tempInfo.source,
    });

    const existing = byDate.get(dateKey);
    if (!existing) {
      byDate.set(dateKey, {
        date: dateKey,
        metarMaxC: tempC,
        metarMaxAtUtc: utcEpoch,
        metarMaxAtLocal: formatChicagoDateTime(utcEpoch),
        metarObsCount: 1,
        metarMaxRaw: observation.metar ?? "",
        metarMaxSource: tempInfo.source,
      });
      continue;
    }

    existing.metarObsCount += 1;

    const existingPriority = getSourcePriority(existing.metarMaxSource);
    const candidatePriority = getSourcePriority(tempInfo.source);
    const shouldReplace =
      tempC > existing.metarMaxC ||
      (tempC === existing.metarMaxC &&
        candidatePriority > existingPriority);

    if (shouldReplace) {
      existing.metarMaxC = tempC;
      existing.metarMaxAtUtc = utcEpoch;
      existing.metarMaxAtLocal = formatChicagoDateTime(utcEpoch);
      existing.metarMaxRaw = observation.metar ?? "";
      existing.metarMaxSource = tempInfo.source;
    }
  }

  const rows = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  observationRows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.tsUtc - b.tsUtc,
  );

  return {
    rows,
    observationRows,
    parsedObservationCount,
  };
}

async function findMonthRun(ctx, stationIcao, year, month) {
  return await ctx.db
    .query("monthRuns")
    .withIndex("by_station_month", (query) =>
      query
        .eq("stationIcao", stationIcao)
        .eq("year", year)
        .eq("month", month),
    )
    .first();
}

async function ensureMonthRun(ctx, { stationIcao, year, month, stationIem, manualUnit }) {
  const now = Date.now();
  const existing = await findMonthRun(ctx, stationIcao, year, month);

  if (!existing) {
    const runId = await ctx.db.insert("monthRuns", {
      stationIcao,
      stationIem,
      year,
      month,
      manualUnit: manualUnit ?? "C",
      createdAt: now,
      updatedAt: now,
      metarLastStatus: "idle",
      metarLastError: "",
      metarAllLastStatus: "idle",
      metarAllLastError: "",
    });
    return await ctx.db.get(runId);
  }

  const patch = { updatedAt: now };
  if (manualUnit && manualUnit !== existing.manualUnit) {
    patch.manualUnit = manualUnit;
  }
  if (stationIem && stationIem !== existing.stationIem) {
    patch.stationIem = stationIem;
  }
  if (!existing.metarAllLastStatus) {
    patch.metarAllLastStatus = "idle";
  }
  if (existing.metarAllLastError === undefined) {
    patch.metarAllLastError = "";
  }
  if (Object.keys(patch).length > 0) {
    await ctx.db.patch(existing._id, patch);
  }

  return await ctx.db.get(existing._id);
}

async function findDailyComparison(ctx, stationIcao, date) {
  return await ctx.db
    .query("dailyComparisons")
    .withIndex("by_station_date", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .first();
}

function resolveManualDate(entry, year, month) {
  if (entry.day !== undefined) {
    if (!Number.isInteger(entry.day)) {
      throw new Error(`Day must be an integer (received: ${entry.day}).`);
    }
    const maxDay = daysInMonth(year, month);
    if (entry.day < 1 || entry.day > maxDay) {
      throw new Error(`Day ${entry.day} is outside the selected month.`);
    }
    return makeDateKey(year, month, entry.day);
  }

  if (entry.date) {
    const parsed = parseDateKey(entry.date);
    if (!parsed) {
      throw new Error(`Invalid date format: ${entry.date}.`);
    }
    if (parsed.year !== year || parsed.month !== month) {
      throw new Error(`Date ${entry.date} does not match selected month.`);
    }
    const maxDay = daysInMonth(year, month);
    if (parsed.day < 1 || parsed.day > maxDay) {
      throw new Error(`Date ${entry.date} is outside valid day range.`);
    }
    return makeDateKey(parsed.year, parsed.month, parsed.day);
  }

  throw new Error("Each value entry must include either `day` or `date`.");
}

function splitIntoChunks(values, chunkSize) {
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

export const upsertOfficialObservation = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    tsUtc: v.number(),
    tsLocal: v.string(),
    tempC: v.number(),
    tempF: v.number(),
    rawMetar: v.string(),
    source: v.string(),
    noaaSeenAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!parseDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const tempC = roundToTenth(args.tempC);
    const tempF = roundToTenth(args.tempF);
    const now = Date.now();
    const noaaSeenAt =
      typeof args.noaaSeenAt === "number" ? Math.round(args.noaaSeenAt) : null;

    const existing = await ctx.db
      .query("metarObservations")
      .withIndex("by_station_mode_date_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("mode", METAR_MODE.OFFICIAL)
          .eq("date", args.date)
          .eq("tsUtc", args.tsUtc),
      )
      .first();

    if (existing) {
      let recordedSeenAt = existing.noaaFirstSeenAt ?? null;
      if (recordedSeenAt === null && noaaSeenAt !== null) {
        await ctx.db.patch(existing._id, {
          noaaFirstSeenAt: noaaSeenAt,
          updatedAt: now,
        });
        recordedSeenAt = noaaSeenAt;
      }
      return { inserted: false, noaaFirstSeenAt: recordedSeenAt };
    }

    await ctx.db.insert("metarObservations", {
      stationIcao: args.stationIcao,
      mode: METAR_MODE.OFFICIAL,
      date: args.date,
      tsUtc: args.tsUtc,
      tsLocal: args.tsLocal,
      tempC,
      tempF,
      rawMetar: args.rawMetar,
      source: args.source,
      ...(noaaSeenAt !== null ? { noaaFirstSeenAt: noaaSeenAt } : {}),
      updatedAt: now,
    });

    const existingComparison = await findDailyComparison(
      ctx,
      args.stationIcao,
      args.date,
    );
    let comparison = existingComparison;
    if (!comparison) {
      const comparisonId = await ctx.db.insert("dailyComparisons", {
        stationIcao: args.stationIcao,
        date: args.date,
        updatedAt: now,
      });
      comparison = await ctx.db.get(comparisonId);
    }

    if (!comparison) {
      throw new Error("Failed to load daily comparison after insertion.");
    }

    const patch = {
      metarObsCount: (comparison.metarObsCount ?? 0) + 1,
      updatedAt: now,
    };

    const shouldReplaceMax =
      comparison.metarMaxC === undefined ||
      comparison.metarMaxC === null ||
      tempC > comparison.metarMaxC ||
      (tempC === comparison.metarMaxC &&
        getSourcePriority(args.source) >
          getSourcePriority(comparison.metarMaxSource));

    if (shouldReplaceMax) {
      patch.metarMaxC = tempC;
      patch.metarMaxF = tempF;
      patch.metarMaxAtUtc = args.tsUtc;
      patch.metarMaxAtLocal = args.tsLocal;
      patch.metarMaxRaw = args.rawMetar;
      patch.metarMaxSource = args.source;

      if (comparison.manualMaxC !== undefined && comparison.manualMaxC !== null) {
        patch.deltaC = roundToTenth(comparison.manualMaxC - tempC);
      }
      if (comparison.manualMaxF !== undefined && comparison.manualMaxF !== null) {
        patch.deltaF = roundToTenth(comparison.manualMaxF - tempF);
      }
      if (
        comparison.accuObservedMaxF !== undefined &&
        comparison.accuObservedMaxF !== null
      ) {
        patch.errObservedRawF = roundToTenth(comparison.accuObservedMaxF - tempF);
        patch.errObservedRoundedF = roundToTenth(
          comparison.accuObservedMaxF - Math.round(tempF),
        );
      }
    }

    await ctx.db.patch(comparison._id, patch);

    return { inserted: true, noaaFirstSeenAt: noaaSeenAt };
  },
});

export const upsertAllObservation = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    tsUtc: v.number(),
    tsLocal: v.string(),
    tempC: v.number(),
    tempF: v.number(),
    rawMetar: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    if (!parseDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const tempC = roundToTenth(args.tempC);
    const tempF = roundToTenth(args.tempF);
    const now = Date.now();

    const existing = await ctx.db
      .query("metarObservations")
      .withIndex("by_station_mode_date_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("mode", METAR_MODE.ALL)
          .eq("date", args.date)
          .eq("tsUtc", args.tsUtc),
      )
      .first();

    if (existing) {
      return { inserted: false };
    }

    await ctx.db.insert("metarObservations", {
      stationIcao: args.stationIcao,
      mode: METAR_MODE.ALL,
      date: args.date,
      tsUtc: args.tsUtc,
      tsLocal: args.tsLocal,
      tempC,
      tempF,
      rawMetar: args.rawMetar,
      source: args.source,
      updatedAt: now,
    });

    const existingComparison = await findDailyComparison(
      ctx,
      args.stationIcao,
      args.date,
    );
    let comparison = existingComparison;
    if (!comparison) {
      const comparisonId = await ctx.db.insert("dailyComparisons", {
        stationIcao: args.stationIcao,
        date: args.date,
        updatedAt: now,
      });
      comparison = await ctx.db.get(comparisonId);
    }

    if (!comparison) {
      throw new Error("Failed to load daily comparison after insertion.");
    }

    const patch = {
      metarAllObsCount: (comparison.metarAllObsCount ?? 0) + 1,
      updatedAt: now,
    };

    const shouldReplaceMax =
      comparison.metarAllMaxC === undefined ||
      comparison.metarAllMaxC === null ||
      tempC > comparison.metarAllMaxC ||
      (tempC === comparison.metarAllMaxC &&
        getSourcePriority(args.source) >
          getSourcePriority(comparison.metarAllMaxSource));

    if (shouldReplaceMax) {
      patch.metarAllMaxC = tempC;
      patch.metarAllMaxF = tempF;
      patch.metarAllMaxAtUtc = args.tsUtc;
      patch.metarAllMaxAtLocal = args.tsLocal;
      patch.metarAllMaxRaw = args.rawMetar;
      patch.metarAllMaxSource = args.source;

      if (comparison.manualMaxC !== undefined && comparison.manualMaxC !== null) {
        patch.deltaAllC = roundToTenth(comparison.manualMaxC - tempC);
      }
      if (comparison.manualMaxF !== undefined && comparison.manualMaxF !== null) {
        patch.deltaAllF = roundToTenth(comparison.manualMaxF - tempF);
      }
    }

    await ctx.db.patch(comparison._id, patch);

    return { inserted: true };
  },
});

export const pollLatestNoaaMetar = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao.trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const url = `${NOAA_LATEST_METAR_BASE_URL}/${stationIcao}.TXT`;
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) {
      throw new Error(`NOAA latest fetch failed (${response.status}).`);
    }

    const body = await response.text();
    const { tsUtc, rawMetar } = parseNoaaLatestTxt(body);
    const polledAt = Date.now();

    if (isHighFrequencyGeneratedMetar(rawMetar)) {
      return {
        ok: false,
        reason: "high_frequency_generated",
        dateKey: formatChicagoDate(tsUtc),
        tsUtc,
      };
    }

    const tempInfo = extractTempInfo(rawMetar, undefined);
    if (!tempInfo) {
      return {
        ok: false,
        reason: "no_temp_in_metar",
        dateKey: formatChicagoDate(tsUtc),
        tsUtc,
      };
    }

    const dateKey = formatChicagoDate(tsUtc);
    const tempC = roundToTenth(tempInfo.tempC);
    const tempF = toFahrenheit(tempC);
    const tsLocal = formatChicagoDateTime(tsUtc);

    const result = await ctx.runMutation("weather:upsertOfficialObservation", {
      stationIcao,
      date: dateKey,
      tsUtc,
      tsLocal,
      tempC,
      tempF,
      rawMetar,
      source: `noaa_latest:${tempInfo.source}`,
      noaaSeenAt: polledAt,
    });
    const noaaFirstSeenAt = result.noaaFirstSeenAt ?? polledAt;

    return {
      ok: true,
      inserted: result.inserted,
      dateKey,
      tsUtc,
      tsLocal,
      tempC,
      tempF,
      noaaFirstSeenAt,
      availabilityLagMs: Math.max(0, noaaFirstSeenAt - tsUtc),
    };
  },
});

export const backfillTodayOfficialFromIem = actionGeneric({
  args: {
    stationIem: v.string(),
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIem = args.stationIem.trim().toUpperCase();
    const stationIcao = args.stationIcao.trim().toUpperCase();
    if (!stationIem || !stationIcao) {
      throw new Error("stationIem and stationIcao are required.");
    }

    const params = new URLSearchParams();
    params.set("station", stationIem);
    params.append("report_type", "3");
    params.append("report_type", "4");
    params.append("data", "metar");
    params.set("tz", "UTC");
    params.set("format", "onlycomma");
    params.set("hours", "24");

    const csvText = await fetchCsvWithRetry(
      `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${params.toString()}`,
    );
    const observations = parseCsvObservations(csvText);
    const todayKey = chicagoTodayDateKey();
    let insertedCount = 0;
    let consideredCount = 0;

    for (const observation of observations) {
      const utcEpoch = parseValidUtcEpoch(observation.valid);
      if (utcEpoch === null) {
        continue;
      }

      const dateKey = formatChicagoDate(utcEpoch);
      if (dateKey !== todayKey) {
        continue;
      }

      const rawMetar = observation.metar ?? "";
      if (isHighFrequencyGeneratedMetar(rawMetar)) {
        continue;
      }

      const tempInfo = extractTempInfo(rawMetar, undefined);
      if (!tempInfo) {
        continue;
      }

      consideredCount += 1;
      const tempC = roundToTenth(tempInfo.tempC);
      const tempF = toFahrenheit(tempC);
      const result = await ctx.runMutation("weather:upsertOfficialObservation", {
        stationIcao,
        date: dateKey,
        tsUtc: utcEpoch,
        tsLocal: formatChicagoDateTime(utcEpoch),
        tempC,
        tempF,
        rawMetar,
        source: `iem_backfill:${tempInfo.source}`,
      });

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    return {
      ok: true,
      dateKey: todayKey,
      downloadedRows: observations.length,
      consideredCount,
      insertedCount,
    };
  },
});

export const backfillTodayAllFromIem = actionGeneric({
  args: {
    stationIem: v.string(),
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIem = args.stationIem.trim().toUpperCase();
    const stationIcao = args.stationIcao.trim().toUpperCase();
    if (!stationIem || !stationIcao) {
      throw new Error("stationIem and stationIcao are required.");
    }

    const params = new URLSearchParams();
    params.set("station", stationIem);
    params.append("report_type", "1");
    params.append("report_type", "3");
    params.append("report_type", "4");
    params.set("data", "metar");
    params.set("tz", "UTC");
    params.set("format", "onlycomma");
    params.set("hours", "24");

    const csvText = await fetchCsvWithRetry(
      `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${params.toString()}`,
    );
    const observations = parseCsvObservations(csvText);
    const todayKey = chicagoTodayDateKey();
    let insertedCount = 0;
    let consideredCount = 0;

    for (const observation of observations) {
      const utcEpoch = parseValidUtcEpoch(observation.valid);
      if (utcEpoch === null) {
        continue;
      }

      const dateKey = formatChicagoDate(utcEpoch);
      if (dateKey !== todayKey) {
        continue;
      }

      const rawMetar = observation.metar ?? "";
      const tempInfo = extractTempInfo(rawMetar, undefined);
      if (!tempInfo) {
        continue;
      }

      consideredCount += 1;
      const tempC = roundToTenth(tempInfo.tempC);
      const tempF = toFahrenheit(tempC);
      const result = await ctx.runMutation("weather:upsertAllObservation", {
        stationIcao,
        date: dateKey,
        tsUtc: utcEpoch,
        tsLocal: formatChicagoDateTime(utcEpoch),
        tempC,
        tempF,
        rawMetar,
        source: `iem_backfill_all:${tempInfo.source}`,
      });

      if (result.inserted) {
        insertedCount += 1;
      }
    }

    return {
      ok: true,
      dateKey: todayKey,
      downloadedRows: observations.length,
      consideredCount,
      insertedCount,
    };
  },
});

export const getMonthComparison = queryGeneric({
  args: monthArgsValidator,
  handler: async (ctx, args) => {
    assertValidYearMonth(args.year, args.month);

    const start = monthStartDateKey(args.year, args.month);
    const end = monthEndExclusiveDateKey(args.year, args.month);

    const monthRun = await findMonthRun(
      ctx,
      args.stationIcao,
      args.year,
      args.month,
    );

    const rows = await ctx.db
      .query("dailyComparisons")
      .withIndex("by_station_date", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .gte("date", start)
          .lt("date", end),
      )
      .collect();

    return {
      stationIcao: args.stationIcao,
      year: args.year,
      month: args.month,
      monthRun: monthRun ?? null,
      rows,
    };
  },
});

export const getMonthModeState = queryGeneric({
  args: {
    ...monthArgsValidator,
    mode: metarModeValidator,
  },
  handler: async (ctx, args) => {
    assertValidYearMonth(args.year, args.month);
    const mode = normalizeMetarMode(args.mode);
    const monthRun = await findMonthRun(
      ctx,
      args.stationIcao,
      args.year,
      args.month,
    );
    const start = monthStartDateKey(args.year, args.month);
    const end = monthEndExclusiveDateKey(args.year, args.month);

    const observationRows = await ctx.db
      .query("metarObservations")
      .withIndex("by_station_mode_date_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("mode", mode)
          .gte("date", start)
          .lt("date", end),
      )
      .collect();

    const status =
      mode === METAR_MODE.ALL
        ? monthRun?.metarAllLastStatus ?? "idle"
        : monthRun?.metarLastStatus ?? "idle";
    const computedAt =
      mode === METAR_MODE.ALL
        ? monthRun?.metarAllLastComputedAt ?? null
        : monthRun?.metarLastComputedAt ?? null;

    return {
      mode,
      status,
      computedAt,
      observationCount: observationRows.length,
      alreadyComputed:
        status === "ok" &&
        computedAt !== null &&
        observationRows.length > 0,
    };
  },
});

export const getDayObservations = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const dateParts = parseDateKey(args.date);
    if (!dateParts) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const comparison = await findDailyComparison(
      ctx,
      args.stationIcao,
      args.date,
    );

    const officialRows = await ctx.db
      .query("metarObservations")
      .withIndex("by_station_mode_date_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("mode", METAR_MODE.OFFICIAL)
          .eq("date", args.date),
      )
      .collect();

    const allRows = await ctx.db
      .query("metarObservations")
      .withIndex("by_station_mode_date_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("mode", METAR_MODE.ALL)
          .eq("date", args.date),
      )
      .collect();

    return {
      stationIcao: args.stationIcao,
      date: args.date,
      comparison: comparison ?? null,
      officialRows,
      allRows,
    };
  },
});

const manualValueValidator = v.object({
  day: v.optional(v.number()),
  date: v.optional(v.string()),
  value: v.number(),
});

export const upsertManualMonth = mutationGeneric({
  args: {
    ...monthArgsValidator,
    unit: v.union(v.literal("C"), v.literal("F")),
    values: v.array(manualValueValidator),
  },
  handler: async (ctx, args) => {
    assertValidYearMonth(args.year, args.month);
    const stationIem = stationToIem(args.stationIcao);
    await ensureMonthRun(ctx, {
      stationIcao: args.stationIcao,
      year: args.year,
      month: args.month,
      stationIem,
      manualUnit: args.unit,
    });

    const dedupedValues = new Map();
    for (const entry of args.values) {
      const date = resolveManualDate(entry, args.year, args.month);
      dedupedValues.set(date, entry.value);
    }

    let updatedDays = 0;
    for (const [date, sourceValue] of dedupedValues.entries()) {
      const manualMaxC =
        args.unit === "C" ? roundToTenth(sourceValue) : toCelsius(sourceValue);
      const manualMaxF =
        args.unit === "F" ? roundToTenth(sourceValue) : toFahrenheit(sourceValue);

      const now = Date.now();
      const existing = await findDailyComparison(ctx, args.stationIcao, date);

      const patch = {
        manualMaxC,
        manualMaxF,
        updatedAt: now,
      };

      if (existing?.metarMaxC !== undefined) {
        patch.deltaC = roundToTenth(manualMaxC - existing.metarMaxC);
      }
      if (existing?.metarMaxF !== undefined) {
        patch.deltaF = roundToTenth(manualMaxF - existing.metarMaxF);
      }
      if (existing?.metarAllMaxC !== undefined) {
        patch.deltaAllC = roundToTenth(manualMaxC - existing.metarAllMaxC);
      }
      if (existing?.metarAllMaxF !== undefined) {
        patch.deltaAllF = roundToTenth(manualMaxF - existing.metarAllMaxF);
      }

      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("dailyComparisons", {
          stationIcao: args.stationIcao,
          date,
          ...patch,
        });
      }
      updatedDays += 1;
    }

    return { updatedDays };
  },
});

export const setMonthRunStatus = internalMutationGeneric({
  args: {
    ...monthArgsValidator,
    mode: metarModeValidator,
    status: v.union(
      v.literal("idle"),
      v.literal("computing"),
      v.literal("ok"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),
    computedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertValidYearMonth(args.year, args.month);
    const mode = normalizeMetarMode(args.mode);
    const stationIem = stationToIem(args.stationIcao);
    const monthRun = await ensureMonthRun(ctx, {
      stationIcao: args.stationIcao,
      year: args.year,
      month: args.month,
      stationIem,
    });

    const patch = { updatedAt: Date.now() };
    if (mode === METAR_MODE.ALL) {
      patch.metarAllLastStatus = args.status;
      patch.metarAllLastError = args.error ?? "";
      if (args.status === "ok") {
        patch.metarAllLastComputedAt = args.computedAt ?? Date.now();
      }
    } else {
      patch.metarLastStatus = args.status;
      patch.metarLastError = args.error ?? "";
      if (args.status === "ok") {
        patch.metarLastComputedAt = args.computedAt ?? Date.now();
      }
    }

    await ctx.db.patch(monthRun._id, patch);
  },
});

const metarResultRowValidator = v.object({
  date: v.string(),
  metarMaxC: v.number(),
  metarMaxAtUtc: v.number(),
  metarMaxAtLocal: v.string(),
  metarObsCount: v.number(),
  metarMaxRaw: v.string(),
  metarMaxSource: v.string(),
});

const metarObservationRowValidator = v.object({
  date: v.string(),
  tsUtc: v.number(),
  tsLocal: v.string(),
  tempC: v.number(),
  tempF: v.number(),
  rawMetar: v.string(),
  source: v.string(),
  noaaFirstSeenAt: v.optional(v.number()),
});

export const upsertMetarMonthResults = internalMutationGeneric({
  args: {
    ...monthArgsValidator,
    mode: metarModeValidator,
    rows: v.array(metarResultRowValidator),
  },
  handler: async (ctx, args) => {
    assertValidYearMonth(args.year, args.month);
    const mode = normalizeMetarMode(args.mode);
    const stationIem = stationToIem(args.stationIcao);
    await ensureMonthRun(ctx, {
      stationIcao: args.stationIcao,
      year: args.year,
      month: args.month,
      stationIem,
    });

    let updatedDays = 0;

    for (const resultRow of args.rows) {
      const now = Date.now();
      const metarMaxC = roundToTenth(resultRow.metarMaxC);
      const metarMaxF = toFahrenheit(metarMaxC);
      const existing = await findDailyComparison(
        ctx,
        args.stationIcao,
        resultRow.date,
      );

      const patch = { updatedAt: now };

      if (mode === METAR_MODE.ALL) {
        patch.metarAllMaxC = metarMaxC;
        patch.metarAllMaxF = metarMaxF;
        patch.metarAllMaxAtUtc = resultRow.metarMaxAtUtc;
        patch.metarAllMaxAtLocal = resultRow.metarMaxAtLocal;
        patch.metarAllObsCount = resultRow.metarObsCount;
        patch.metarAllMaxRaw = resultRow.metarMaxRaw;
        patch.metarAllMaxSource = resultRow.metarMaxSource;
        if (existing?.manualMaxC !== undefined) {
          patch.deltaAllC = roundToTenth(existing.manualMaxC - metarMaxC);
        }
        if (existing?.manualMaxF !== undefined) {
          patch.deltaAllF = roundToTenth(existing.manualMaxF - metarMaxF);
        }
      } else {
        patch.metarMaxC = metarMaxC;
        patch.metarMaxF = metarMaxF;
        patch.metarMaxAtUtc = resultRow.metarMaxAtUtc;
        patch.metarMaxAtLocal = resultRow.metarMaxAtLocal;
        patch.metarObsCount = resultRow.metarObsCount;
        patch.metarMaxRaw = resultRow.metarMaxRaw;
        patch.metarMaxSource = resultRow.metarMaxSource;
        if (existing?.manualMaxC !== undefined) {
          patch.deltaC = roundToTenth(existing.manualMaxC - metarMaxC);
        }
        if (existing?.manualMaxF !== undefined) {
          patch.deltaF = roundToTenth(existing.manualMaxF - metarMaxF);
        }
        if (
          existing?.accuObservedMaxF !== undefined &&
          existing?.accuObservedMaxF !== null
        ) {
          patch.errObservedRawF = roundToTenth(
            existing.accuObservedMaxF - metarMaxF,
          );
          patch.errObservedRoundedF = roundToTenth(
            existing.accuObservedMaxF - Math.round(metarMaxF),
          );
        }
      }

      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("dailyComparisons", {
          stationIcao: args.stationIcao,
          date: resultRow.date,
          ...patch,
        });
      }
      updatedDays += 1;
    }

    return { updatedDays };
  },
});

export const clearMonthObservations = internalMutationGeneric({
  args: {
    ...monthArgsValidator,
    mode: metarModeValidator,
  },
  handler: async (ctx, args) => {
    assertValidYearMonth(args.year, args.month);
    const mode = normalizeMetarMode(args.mode);
    const start = monthStartDateKey(args.year, args.month);
    const end = monthEndExclusiveDateKey(args.year, args.month);

    const existingRows = await ctx.db
      .query("metarObservations")
      .withIndex("by_station_mode_date_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("mode", mode)
          .gte("date", start)
          .lt("date", end),
      )
      .collect();

    for (const row of existingRows) {
      await ctx.db.delete(row._id);
    }

    return { removed: existingRows.length };
  },
});

export const insertObservationChunk = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    mode: metarModeValidator,
    rows: v.array(metarObservationRowValidator),
  },
  handler: async (ctx, args) => {
    const mode = normalizeMetarMode(args.mode);
    const now = Date.now();
    let inserted = 0;

    for (const row of args.rows) {
      await ctx.db.insert("metarObservations", {
        stationIcao: args.stationIcao,
        mode,
        date: row.date,
        tsUtc: row.tsUtc,
        tsLocal: row.tsLocal,
        tempC: row.tempC,
        tempF: row.tempF,
        rawMetar: row.rawMetar,
        source: row.source,
        ...(row.noaaFirstSeenAt !== undefined
          ? { noaaFirstSeenAt: row.noaaFirstSeenAt }
          : {}),
        updatedAt: now,
      });
      inserted += 1;
    }

    return { inserted };
  },
});

export const computeMetarMonth = actionGeneric({
  args: {
    ...monthArgsValidator,
    mode: v.optional(metarModeValidator),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const mode = normalizeMetarMode(args.mode);
    return await computeAndPersistMode(ctx, args, mode, {
      force: args.force ?? false,
    });
  },
});

async function computeAndPersistMode(ctx, args, mode, options = {}) {
  assertValidYearMonth(args.year, args.month);
  const force = options.force === true;
  const stationIem = stationToIem(args.stationIcao);

  const monthState = await ctx.runQuery("weather:getMonthModeState", {
    stationIcao: args.stationIcao,
    year: args.year,
    month: args.month,
    mode,
  });
  if (!force && monthState.alreadyComputed) {
    return {
      mode,
      skipped: true,
      reason: "already-computed",
      daysUpdated: 0,
      parsedObservationCount: 0,
      downloadedRows: 0,
      savedObservationRows: monthState.observationCount,
    };
  }

  await ctx.runMutation("weather:setMonthRunStatus", {
    stationIcao: args.stationIcao,
    year: args.year,
    month: args.month,
    mode,
    status: "computing",
    error: "",
  });

  try {
    const iemUrl = buildIemUrl(stationIem, args.year, args.month, mode);
    const csvText = await fetchCsvWithRetry(iemUrl);
    const observations = parseCsvObservations(csvText);
    const { rows, observationRows, parsedObservationCount } = computeDailyMetarMax(
      observations,
      args.year,
      args.month,
      mode,
    );

    await ctx.runMutation("weather:clearMonthObservations", {
      stationIcao: args.stationIcao,
      year: args.year,
      month: args.month,
      mode,
    });
    const chunks = splitIntoChunks(observationRows, OBS_INSERT_CHUNK_SIZE);
    for (const chunk of chunks) {
      await ctx.runMutation("weather:insertObservationChunk", {
        stationIcao: args.stationIcao,
        mode,
        rows: chunk,
      });
    }

    const upsertResult = await ctx.runMutation(
      "weather:upsertMetarMonthResults",
      {
        stationIcao: args.stationIcao,
        year: args.year,
        month: args.month,
        mode,
        rows,
      },
    );

    await ctx.runMutation("weather:setMonthRunStatus", {
      stationIcao: args.stationIcao,
      year: args.year,
      month: args.month,
      mode,
      status: "ok",
      error: "",
      computedAt: Date.now(),
    });

    return {
      mode,
      daysUpdated: upsertResult.updatedDays,
      parsedObservationCount,
      downloadedRows: observations.length,
      savedObservationRows: observationRows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation("weather:setMonthRunStatus", {
      stationIcao: args.stationIcao,
      year: args.year,
      month: args.month,
      mode,
      status: "error",
      error: message,
    });
    throw new Error(`METAR ${mode} compute failed: ${message}`);
  }
}

export const computeMetarMonthBoth = actionGeneric({
  args: {
    ...monthArgsValidator,
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertValidYearMonth(args.year, args.month);
    const force = args.force ?? false;
    const official = await computeAndPersistMode(ctx, args, METAR_MODE.OFFICIAL, {
      force,
    });
    const all = await computeAndPersistMode(ctx, args, METAR_MODE.ALL, {
      force,
    });
    return { official, all };
  },
});
