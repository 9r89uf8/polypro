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

function isHighFrequencyGeneratedMetar(rawMetar) {
  if (!rawMetar) {
    return false;
  }
  return rawMetar.toUpperCase().includes("MADISHF");
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

    parsedObservationCount += 1;

    const existing = byDate.get(dateKey);
    if (!existing) {
      byDate.set(dateKey, {
        date: dateKey,
        metarMaxC: tempInfo.tempC,
        metarMaxAtUtc: utcEpoch,
        metarMaxAtLocal: formatChicagoDateTime(utcEpoch),
        metarObsCount: 1,
        metarMaxRaw: observation.metar ?? "",
        metarMaxSource: tempInfo.source,
      });
      continue;
    }

    existing.metarObsCount += 1;

    const existingPriority = SOURCE_PRIORITY[existing.metarMaxSource] ?? -1;
    const candidatePriority = SOURCE_PRIORITY[tempInfo.source] ?? -1;
    const shouldReplace =
      tempInfo.tempC > existing.metarMaxC ||
      (tempInfo.tempC === existing.metarMaxC &&
        candidatePriority > existingPriority);

    if (shouldReplace) {
      existing.metarMaxC = tempInfo.tempC;
      existing.metarMaxAtUtc = utcEpoch;
      existing.metarMaxAtLocal = formatChicagoDateTime(utcEpoch);
      existing.metarMaxRaw = observation.metar ?? "";
      existing.metarMaxSource = tempInfo.source;
    }
  }

  const rows = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    rows,
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

export const computeMetarMonth = actionGeneric({
  args: {
    ...monthArgsValidator,
    mode: v.optional(metarModeValidator),
  },
  handler: async (ctx, args) => {
    assertValidYearMonth(args.year, args.month);
    const mode = normalizeMetarMode(args.mode);
    const stationIem = stationToIem(args.stationIcao);

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
      const { rows, parsedObservationCount } = computeDailyMetarMax(
        observations,
        args.year,
        args.month,
        mode,
      );

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
      throw new Error(`METAR compute failed: ${message}`);
    }
  },
});
