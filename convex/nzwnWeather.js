import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const AUCKLAND_TIMEZONE = "Pacific/Auckland";
const METSERVICE_PUBLICDATA_APPROVAL_FLAG =
  "METSERVICE_PUBLICDATA_ACCESS_APPROVED";
const METSERVICE_BASE_URL = "https://www.metservice.com/publicData";
const METSERVICE_CURRENT_CONDITIONS_URL =
  `${METSERVICE_BASE_URL}/webdata/module/currentConditions/93439/93439`;
const GOOGLE_WEATHER_BASE_URL = "https://weather.googleapis.com/v1";
const GOOGLE_HOURLY_FORECAST_URL =
  `${GOOGLE_WEATHER_BASE_URL}/forecast/hours:lookup`;
const DEFAULT_GOOGLE_LANGUAGE = "en";
const GOOGLE_HOURLY_FORECAST_HOURS = 120;
const GOOGLE_HOURLY_PAGE_SIZE = 24;
const METSERVICE_LIVE_SOURCE = "metservice_93439";
const METSERVICE_STATION_ID = "93439";
const COLLECTION_WINDOW_START_MINUTES = 9 * 60;
const COLLECTION_WINDOW_END_MINUTES = 19 * 60;
const APPROVAL_REQUIRED_MESSAGE =
  "MetService PublicData access approval is required before NZWN collection can run.";
const LEGACY_METSERVICE_SOURCE_DISABLED_MESSAGE =
  "Legacy MetService forecast and 48-hour graph collection is disabled and is not authorized by the station-current approval flag.";
const WEATHER_STATUS = {
  OK: "ok",
  ERROR: "error",
};

const NZWN_STATION = {
  stationIcao: "NZWN",
  stationName: "Wellington International",
  // Lyall Bay / Wellington Aero station 93439 — closest to the airport.
  lat: -41.327,
  lon: 174.805,
  timeZone: AUCKLAND_TIMEZONE,
};

const dateFormatterCache = new Map();
const dateTimeFormatterCache = new Map();

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

function getDateFormatter(timeZone) {
  const cacheKey = `${timeZone}:date`;
  let formatter = dateFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatterCache.set(cacheKey, formatter);
  }
  return formatter;
}

function getDateTimeFormatter(timeZone) {
  const cacheKey = `${timeZone}:datetime`;
  let formatter = dateTimeFormatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    });
    dateTimeFormatterCache.set(cacheKey, formatter);
  }
  return formatter;
}

function formatDateInTimezone(epochMs, timeZone) {
  const parts = getDateParts(getDateFormatter(timeZone), new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDateTimeInTimezone(epochMs, timeZone) {
  const parts = getDateParts(getDateTimeFormatter(timeZone), new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function minuteOfDayInTimezone(epochMs, timeZone) {
  const parts = getDateParts(getDateTimeFormatter(timeZone), new Date(epochMs));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isWithinMetServiceCollectionWindow(epochMs) {
  const minuteOfDay = minuteOfDayInTimezone(epochMs, AUCKLAND_TIMEZONE);
  return (
    minuteOfDay >= COLLECTION_WINDOW_START_MINUTES &&
    minuteOfDay < COLLECTION_WINDOW_END_MINUTES
  );
}

function hasApprovedMetServicePublicDataAccess() {
  return (
    process.env.METSERVICE_PUBLICDATA_ACCESS_APPROVED === "true"
  );
}

function assertApprovedMetServicePublicDataAccess() {
  if (!hasApprovedMetServicePublicDataAccess()) {
    throw new Error(APPROVAL_REQUIRED_MESSAGE);
  }
}

function normalizeNzwnStationIcao(value) {
  const stationIcao = String(value ?? NZWN_STATION.stationIcao)
    .trim()
    .toUpperCase();
  if (stationIcao !== NZWN_STATION.stationIcao) {
    throw new Error("The MetService PublicData collector supports NZWN only.");
  }
  return stationIcao;
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
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

function parseValidUtcEpoch(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).includes("T")
    ? String(value)
    : String(value).replace(" ", "T");
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized);
  const withTimezone = hasTimezone ? normalized : `${normalized}Z`;
  const epoch = Date.parse(withTimezone);
  return Number.isFinite(epoch) ? epoch : null;
}

function celsiusTempPair(value) {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return {};
  }
  const tempC = roundToTenth(parsed);
  return { tempC, tempF: toFahrenheit(tempC) };
}

function normalizeGoogleLanguage(language) {
  return toNonEmptyString(language) ?? DEFAULT_GOOGLE_LANGUAGE;
}

function toGoogleUnitsSystem(unit) {
  return unit === "metric" ? "METRIC" : "IMPERIAL";
}

function extractGoogleDescription(node) {
  return (
    toNonEmptyString(node?.weatherCondition?.description?.text) ??
    toNonEmptyString(node?.weatherCondition?.description) ??
    toNonEmptyString(node?.weatherCondition?.type) ??
    null
  );
}

function normalizeGoogleHourlyRows(payload, timeZone) {
  const rows = [];
  const forecastHours = Array.isArray(payload?.forecastHours)
    ? payload.forecastHours
    : [];

  for (const row of forecastHours) {
    const validTimeUtc = parseValidUtcEpoch(row?.interval?.startTime);
    const temperature = celsiusTempPair(row?.temperature?.degrees);

    if (
      !Number.isFinite(validTimeUtc) ||
      !Number.isFinite(temperature.tempC) ||
      !Number.isFinite(temperature.tempF)
    ) {
      continue;
    }

    rows.push({
      date: formatDateInTimezone(validTimeUtc, timeZone),
      validTimeUtc,
      validTimeLocal: formatDateTimeInTimezone(validTimeUtc, timeZone),
      tempC: roundToTenth(temperature.tempC),
      tempF: roundToTenth(temperature.tempF),
      phrase: extractGoogleDescription(row),
    });
  }

  return rows;
}

function selectPeakForecastRow(rows, date) {
  let bestRow = null;
  for (const row of rows) {
    if (date && row.date !== date) {
      continue;
    }
    if (
      !bestRow ||
      row.tempC > bestRow.tempC ||
      (row.tempC === bestRow.tempC && row.validTimeUtc < bestRow.validTimeUtc)
    ) {
      bestRow = row;
    }
  }

  if (!bestRow) {
    return null;
  }

  return {
    date: bestRow.date,
    validTimeUtc: bestRow.validTimeUtc,
    validTimeLocal: bestRow.validTimeLocal,
    tempC: bestRow.tempC,
    tempF: bestRow.tempF,
    phrase: bestRow.phrase ?? null,
  };
}

function getGoogleWeatherApiKey() {
  return toNonEmptyString(process.env.GOOGLE_WEATHER_API_KEY);
}

async function fetchMetServiceCurrentReading({ timeZone }) {
  // This guard deliberately lives beside the network request as a second
  // boundary in addition to the manual and scheduled action checks.
  assertApprovedMetServicePublicDataAccess();
  const url = `${METSERVICE_CURRENT_CONDITIONS_URL}?pagetype=48hr`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `MetService current conditions failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const tempNode = Array.isArray(payload?.observations?.temperature)
    ? payload.observations.temperature[0]
    : null;
  const currentTemp = celsiusTempPair(tempNode?.current);
  if (!Number.isFinite(currentTemp.tempC)) {
    throw new Error("MetService current conditions response missing temperature.");
  }

  // `asAt` is the source observation timestamp. Never substitute collection
  // time: dedupe and stale-response rejection depend on the upstream time.
  const observedAtUtc = parseValidUtcEpoch(payload?.asAt);
  if (!Number.isFinite(observedAtUtc)) {
    throw new Error(
      "MetService current conditions response missing an observation timestamp.",
    );
  }

  const windNode = Array.isArray(payload?.observations?.wind)
    ? payload.observations.wind[0]
    : null;
  const rainNode = Array.isArray(payload?.observations?.rain)
    ? payload.observations.rain[0]
    : null;
  const pressureNode = Array.isArray(payload?.observations?.pressure)
    ? payload.observations.pressure[0]
    : null;

  return {
    source: "metservice_93439",
    sourceLabel: "MetService Wellington Aero (93439)",
    status: WEATHER_STATUS.OK,
    observedAtUtc,
    observedAtLocal: formatDateTimeInTimezone(observedAtUtc, timeZone),
    tempC: currentTemp.tempC,
    tempF: currentTemp.tempF,
    relativeHumidity: toFiniteNumber(rainNode?.relativeHumidity),
    windSpeedKph: toFiniteNumber(windNode?.averageSpeed),
    windGustKph: toFiniteNumber(windNode?.gustSpeed),
    windDirection: toNonEmptyString(windNode?.direction),
    pressureHpa: toFiniteNumber(pressureNode?.atSeaLevel),
  };
}

async function fetchGoogleHourlyForecast({
  station,
  hours,
  unit,
  language,
  apiKey,
  timeZone,
}) {
  const rows = [];
  let nextPageToken = null;

  do {
    const url = new URL(GOOGLE_HOURLY_FORECAST_URL);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("location.latitude", String(station.lat));
    url.searchParams.set("location.longitude", String(station.lon));
    url.searchParams.set("unitsSystem", toGoogleUnitsSystem(unit));
    url.searchParams.set("languageCode", language);
    url.searchParams.set("hours", String(hours));
    url.searchParams.set("pageSize", String(GOOGLE_HOURLY_PAGE_SIZE));
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Google hourly forecast failed (${response.status}): ${text.slice(0, 220)}`,
      );
    }

    const payload = await response.json();
    rows.push(...normalizeGoogleHourlyRows(payload, timeZone));
    nextPageToken = toNonEmptyString(payload?.nextPageToken);
  } while (nextPageToken);

  if (!rows.length) {
    throw new Error("Google hourly forecast returned no usable rows.");
  }

  return rows;
}

export const getDayPageWeather = actionGeneric({
  args: {
    date: v.string(),
  },
  handler: async (_ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const unit = "metric";
    const googleLanguage = normalizeGoogleLanguage(DEFAULT_GOOGLE_LANGUAGE);
    const todayDate = formatDateInTimezone(Date.now(), NZWN_STATION.timeZone);
    const googleApiKey = getGoogleWeatherApiKey();
    const currentReading = {
      source: METSERVICE_LIVE_SOURCE,
      status: "source_disabled",
      error:
        "Legacy direct current-condition loading is disabled; use the gated stored live-temperature query.",
    };
    const forecastResult = {
      status: "source_disabled",
      error: LEGACY_METSERVICE_SOURCE_DISABLED_MESSAGE,
      days: [],
    };
    const hourlyResult = await (async () => {
      if (!googleApiKey) {
        return {
          status: WEATHER_STATUS.ERROR,
          error: "Missing GOOGLE_WEATHER_API_KEY.",
          rows: [],
        };
      }
      try {
        const rows = await fetchGoogleHourlyForecast({
          station: NZWN_STATION,
          hours: GOOGLE_HOURLY_FORECAST_HOURS,
          unit,
          language: googleLanguage,
          apiKey: googleApiKey,
          timeZone: NZWN_STATION.timeZone,
        });
        return {
          status: WEATHER_STATUS.OK,
          rows,
        };
      } catch (error) {
        return {
          status: WEATHER_STATUS.ERROR,
          error: formatErrorMessage(error),
          rows: [],
        };
      }
    })();

    return {
      stationIcao: NZWN_STATION.stationIcao,
      stationName: NZWN_STATION.stationName,
      todayDate,
      currentReading,
      forecast: forecastResult,
      hourly: hourlyResult,
      selectedDateForecast:
        forecastResult.days.find((day) => day.date === args.date) ?? null,
      selectedDatePeak: selectPeakForecastRow(hourlyResult.rows, args.date),
      todayPeak: selectPeakForecastRow(hourlyResult.rows, todayDate),
    };
  },
});

// ---------------------------------------------------------------------------
// Approval-gated MetService station 93439 near-live observation storage
// ---------------------------------------------------------------------------

const storeMetServiceObservation = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    obsTimeUtc: v.number(),
    obsTimeLocal: v.string(),
    tempC: v.number(),
    tempF: v.number(),
    relativeHumidity: v.optional(v.number()),
    windSpeedKph: v.optional(v.number()),
    windGustKph: v.optional(v.number()),
    windDirection: v.optional(v.string()),
    pressureHpa: v.optional(v.number()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.source !== METSERVICE_LIVE_SOURCE) {
      throw new Error(LEGACY_METSERVICE_SOURCE_DISABLED_MESSAGE);
    }
    // Storage is a separate security boundary from the action. This closes
    // the race where approval is revoked after the HTTP response arrives.
    assertApprovedMetServicePublicDataAccess();
    const latest = await ctx.db
      .query("nzwnMetServiceObservations")
      .withIndex("by_station_source_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("source", args.source),
      )
      .order("desc")
      .first();
    if (latest && args.obsTimeUtc < latest.obsTimeUtc) {
      return {
        inserted: false,
        outcome: "stale_rejected",
        latestObsTimeUtc: latest.obsTimeUtc,
        latestObsTimeLocal: latest.obsTimeLocal,
      };
    }
    if (latest && args.obsTimeUtc === latest.obsTimeUtc) {
      return {
        inserted: false,
        outcome: "duplicate",
        latestObsTimeUtc: latest.obsTimeUtc,
        latestObsTimeLocal: latest.obsTimeLocal,
      };
    }

    const existing = await ctx.db
      .query("nzwnMetServiceObservations")
      .withIndex("by_station_date_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("date", args.date)
          .eq("obsTimeUtc", args.obsTimeUtc),
      )
      .first();
    if (existing) {
      return {
        inserted: false,
        outcome: "duplicate",
        latestObsTimeUtc: existing.obsTimeUtc,
        latestObsTimeLocal: existing.obsTimeLocal,
      };
    }
    await ctx.db.insert("nzwnMetServiceObservations", {
      ...args,
      createdAt: Date.now(),
    });
    return {
      inserted: true,
      outcome: "inserted",
      latestObsTimeUtc: args.obsTimeUtc,
      latestObsTimeLocal: args.obsTimeLocal,
    };
  },
});

export { storeMetServiceObservation };

const metServiceCollectorStatusValidator = v.union(
  v.literal("ok"),
  v.literal("no_data"),
  v.literal("error"),
  v.literal("approval_required"),
  v.literal("outside_collection_window"),
);

const writeMetServiceCollectorStatus = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    status: metServiceCollectorStatusValidator,
    configured: v.boolean(),
    lastAttemptAt: v.number(),
    lastAttemptAtLocal: v.string(),
    lastSuccessAt: v.optional(v.number()),
    lastSuccessAtLocal: v.optional(v.string()),
    latestObsTimeUtc: v.optional(v.number()),
    latestObsTimeLocal: v.optional(v.string()),
    lastError: v.optional(v.string()),
    lastIngestResult: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("nzwnMetServiceCollectorStatus")
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
      (args.status === "ok" ||
        args.status === "no_data" ||
        args.status === "outside_collection_window")
    ) {
      patch.lastError = undefined;
    }
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { updated: true };
    }
    await ctx.db.insert("nzwnMetServiceCollectorStatus", patch);
    return { updated: true };
  },
});

export { writeMetServiceCollectorStatus };

async function runMetServiceCurrentConditionsPoll(ctx, args, mode) {
  const stationIcao = normalizeNzwnStationIcao(args.stationIcao);
  const timeZone = NZWN_STATION.timeZone;
  const lastAttemptAt = Date.now();
  const lastAttemptAtLocal = formatDateTimeInTimezone(
    lastAttemptAt,
    timeZone,
  );

  if (!hasApprovedMetServicePublicDataAccess()) {
    await ctx.runMutation("nzwnWeather:writeMetServiceCollectorStatus", {
      stationIcao,
      status: "approval_required",
      configured: false,
      lastAttemptAt,
      lastAttemptAtLocal,
      lastError: APPROVAL_REQUIRED_MESSAGE,
    });
    return {
      status: "approval_required",
      mode,
      stationIcao,
      approvalFlag: METSERVICE_PUBLICDATA_APPROVAL_FLAG,
      message: APPROVAL_REQUIRED_MESSAGE,
    };
  }

  if (!isWithinMetServiceCollectionWindow(lastAttemptAt)) {
    const message =
      "NZWN near-live collection runs from 09:00 through 18:59 Pacific/Auckland.";
    await ctx.runMutation("nzwnWeather:writeMetServiceCollectorStatus", {
      stationIcao,
      status: "outside_collection_window",
      configured: true,
      lastAttemptAt,
      lastAttemptAtLocal,
      lastError: message,
    });
    return {
      status: "outside_collection_window",
      mode,
      stationIcao,
      message,
    };
  }

  try {
    const reading = await fetchMetServiceCurrentReading({ timeZone });
    // Recheck after the external request. A revoked flag must discard the
    // response rather than allowing it to enter persistent storage.
    assertApprovedMetServicePublicDataAccess();
    const obsDate = formatDateInTimezone(reading.observedAtUtc, timeZone);
    // Check once more immediately before crossing into the storage mutation;
    // the mutation enforces the same gate atomically as well.
    assertApprovedMetServicePublicDataAccess();
    const storeResult = await ctx.runMutation(
      "nzwnWeather:storeMetServiceObservation",
      {
        stationIcao,
        date: obsDate,
        obsTimeUtc: reading.observedAtUtc,
        obsTimeLocal: reading.observedAtLocal,
        tempC: reading.tempC,
        tempF: reading.tempF,
        relativeHumidity: reading.relativeHumidity ?? undefined,
        windSpeedKph: reading.windSpeedKph ?? undefined,
        windGustKph: reading.windGustKph ?? undefined,
        windDirection: reading.windDirection ?? undefined,
        pressureHpa: reading.pressureHpa ?? undefined,
        source: METSERVICE_LIVE_SOURCE,
      },
    );

    if (storeResult.inserted) {
      await ctx.runMutation("nzwnWeather:recomputeDailySummary", {
        stationIcao,
        date: obsDate,
      });
    }

    const completedAt = Date.now();
    await ctx.runMutation("nzwnWeather:writeMetServiceCollectorStatus", {
      stationIcao,
      status: "ok",
      configured: true,
      lastAttemptAt,
      lastAttemptAtLocal,
      lastSuccessAt: completedAt,
      lastSuccessAtLocal: formatDateTimeInTimezone(completedAt, timeZone),
      latestObsTimeUtc: storeResult.latestObsTimeUtc,
      latestObsTimeLocal: storeResult.latestObsTimeLocal,
      lastIngestResult: storeResult.outcome,
    });

    return {
      status: "ok",
      mode,
      stationIcao,
      observedAtUtc: reading.observedAtUtc,
      observedAtLocal: reading.observedAtLocal,
      tempC: reading.tempC,
      tempF: reading.tempF,
      ingestResult: storeResult.outcome,
      latestObsTimeUtc: storeResult.latestObsTimeUtc,
      latestObsTimeLocal: storeResult.latestObsTimeLocal,
    };
  } catch (error) {
    const message = formatErrorMessage(error);
    const approvalRevoked = !hasApprovedMetServicePublicDataAccess();
    await ctx.runMutation("nzwnWeather:writeMetServiceCollectorStatus", {
      stationIcao,
      status: approvalRevoked ? "approval_required" : "error",
      configured: !approvalRevoked,
      lastAttemptAt,
      lastAttemptAtLocal,
      lastError: approvalRevoked ? APPROVAL_REQUIRED_MESSAGE : message,
    });
    return {
      status: approvalRevoked ? "approval_required" : "error",
      mode,
      stationIcao,
      ...(approvalRevoked
        ? { approvalFlag: METSERVICE_PUBLICDATA_APPROVAL_FLAG }
        : {}),
      message: approvalRevoked ? APPROVAL_REQUIRED_MESSAGE : message,
    };
  }
}

export const pollMetServiceCurrentConditions = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await runMetServiceCurrentConditionsPoll(ctx, args, "manual"),
});

export const pollScheduledMetServiceCurrentConditions = internalActionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await runMetServiceCurrentConditionsPoll(ctx, args, "scheduled"),
});

export const getMetServiceHourlyForecasts = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    normalizeNzwnStationIcao(args.stationIcao);
    return {
      status: "source_disabled",
      message: LEGACY_METSERVICE_SOURCE_DISABLED_MESSAGE,
      rows: [],
    };
  },
});

export const getMetServiceObservations = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const stationIcao = normalizeNzwnStationIcao(args.stationIcao);
    if (!hasApprovedMetServicePublicDataAccess()) {
      return {
        status: "approval_required",
        approval: {
          approved: false,
          status: "approval_required",
          flagName: METSERVICE_PUBLICDATA_APPROVAL_FLAG,
        },
        rows: [],
      };
    }
    const rows = await ctx.db
      .query("nzwnMetServiceObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", stationIcao).eq("date", args.date),
      )
      .collect();
    const currentRows = rows
      .filter((row) => row.source === METSERVICE_LIVE_SOURCE)
      .sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
    return {
      status: "ok",
      approval: {
        approved: true,
        status: "approved",
        flagName: METSERVICE_PUBLICDATA_APPROVAL_FLAG,
      },
      rows: currentRows,
    };
  },
});

export const getLiveTemperature = queryGeneric({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const now = Date.now();
    const approved = hasApprovedMetServicePublicDataAccess();
    const activeNow = isWithinMetServiceCollectionWindow(now);
    if (!approved) {
      return {
        stationIcao: NZWN_STATION.stationIcao,
        stationName: NZWN_STATION.stationName,
        stationId: METSERVICE_STATION_ID,
        sourceLabel: "MetService Wellington Aero (93439)",
        approval: {
          approved: false,
          status: "approval_required",
          flagName: METSERVICE_PUBLICDATA_APPROVAL_FLAG,
        },
        collectionWindow: {
          timeZone: AUCKLAND_TIMEZONE,
          startLocal: "09:00",
          endLocal: "19:00",
          activeNow,
        },
        collector: {
          status: "approval_required",
          configured: false,
          lastError: APPROVAL_REQUIRED_MESSAGE,
        },
        latest: null,
        latestAgeMinutes: null,
        latestForDate: null,
        observations: [],
        summary: null,
      };
    }

    const allDateRows = await ctx.db
      .query("nzwnMetServiceObservations")
      .withIndex("by_station_date_ts", (query) =>
        query
          .eq("stationIcao", NZWN_STATION.stationIcao)
          .eq("date", args.date),
      )
      .collect();
    const observations = allDateRows
      .filter((row) => row.source === METSERVICE_LIVE_SOURCE)
      .sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
    const [latest, storedCollector] = await Promise.all([
      ctx.db
        .query("nzwnMetServiceObservations")
        .withIndex("by_station_source_ts", (query) =>
          query
            .eq("stationIcao", NZWN_STATION.stationIcao)
            .eq("source", METSERVICE_LIVE_SOURCE),
        )
        .order("desc")
        .first(),
      ctx.db
        .query("nzwnMetServiceCollectorStatus")
        .withIndex("by_station", (query) =>
          query.eq("stationIcao", NZWN_STATION.stationIcao),
        )
        .first(),
    ]);

    let maxRow = null;
    let minRow = null;
    for (const row of observations) {
      if (!maxRow || row.tempC > maxRow.tempC) {
        maxRow = row;
      }
      if (!minRow || row.tempC < minRow.tempC) {
        minRow = row;
      }
    }
    const latestForDate =
      observations.length > 0 ? observations[observations.length - 1] : null;
    const summary =
      observations.length > 0
        ? {
            obsCount: observations.length,
            maxTempC: maxRow.tempC,
            maxTempF: maxRow.tempF,
            maxTempAtUtc: maxRow.obsTimeUtc,
            maxTempAtLocal: maxRow.obsTimeLocal,
            minTempC: minRow.tempC,
            minTempF: minRow.tempF,
            minTempAtUtc: minRow.obsTimeUtc,
            minTempAtLocal: minRow.obsTimeLocal,
            latestObsTimeUtc: latestForDate.obsTimeUtc,
            latestObsTimeLocal: latestForDate.obsTimeLocal,
          }
        : null;
    const collectorStatus = !activeNow
      ? "outside_collection_window"
      : storedCollector?.status ?? "no_data";
    const collectorError =
      collectorStatus === "outside_collection_window"
        ? "NZWN near-live collection runs from 09:00 through 18:59 Pacific/Auckland."
        : collectorStatus === "error"
          ? storedCollector?.lastError
          : null;

    return {
      stationIcao: NZWN_STATION.stationIcao,
      stationName: NZWN_STATION.stationName,
      stationId: METSERVICE_STATION_ID,
      sourceLabel: "MetService Wellington Aero (93439)",
      approval: {
        approved,
        status: approved ? "approved" : "approval_required",
        flagName: METSERVICE_PUBLICDATA_APPROVAL_FLAG,
      },
      collectionWindow: {
        timeZone: AUCKLAND_TIMEZONE,
        startLocal: "09:00",
        endLocal: "19:00",
        activeNow,
      },
      collector: {
        status: collectorStatus,
        configured: approved,
        ...(storedCollector?.lastAttemptAt !== undefined
          ? { lastAttemptAt: storedCollector.lastAttemptAt }
          : {}),
        ...(storedCollector?.lastAttemptAtLocal
          ? { lastAttemptAtLocal: storedCollector.lastAttemptAtLocal }
          : {}),
        ...(storedCollector?.lastSuccessAt !== undefined
          ? { lastSuccessAt: storedCollector.lastSuccessAt }
          : {}),
        ...(storedCollector?.lastSuccessAtLocal
          ? { lastSuccessAtLocal: storedCollector.lastSuccessAtLocal }
          : {}),
        ...(storedCollector?.latestObsTimeUtc !== undefined
          ? { latestObsTimeUtc: storedCollector.latestObsTimeUtc }
          : {}),
        ...(storedCollector?.latestObsTimeLocal
          ? { latestObsTimeLocal: storedCollector.latestObsTimeLocal }
          : {}),
        ...(storedCollector?.lastIngestResult
          ? { lastIngestResult: storedCollector.lastIngestResult }
          : {}),
        ...(collectorError ? { lastError: collectorError } : {}),
      },
      latest,
      latestAgeMinutes: latest
        ? Math.max(0, Math.round(((now - latest.obsTimeUtc) / 60_000) * 10) / 10)
        : null,
      latestForDate,
      observations,
      summary,
    };
  },
});

export const collectForecastSnapshot = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const stationIcao = normalizeNzwnStationIcao(args.stationIcao);
    return {
      status: "source_disabled",
      stationIcao,
      message: LEGACY_METSERVICE_SOURCE_DISABLED_MESSAGE,
    };
  },
});

// ---------------------------------------------------------------------------
// Daily summary recomputation
// ---------------------------------------------------------------------------

const recomputeDailySummary = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const observations = await ctx.db
      .query("nzwnMetServiceObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();

    const existing = await ctx.db
      .query("nzwnDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .first();

    if (observations.length === 0) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      return { updated: false, obsCount: 0 };
    }

    let maxRow = null;
    let minRow = null;
    let latestRow = null;

    for (const obs of observations) {
      if (obs.tempC === undefined || obs.tempC === null) continue;
      if (!maxRow || obs.tempC > maxRow.tempC) maxRow = obs;
      if (!minRow || obs.tempC < minRow.tempC) minRow = obs;
      if (!latestRow || obs.obsTimeUtc > latestRow.obsTimeUtc) latestRow = obs;
    }

    const summaryFields = {
      stationIcao: args.stationIcao,
      date: args.date,
      obsCount: observations.length,
      ...(maxRow
        ? {
            maxTempC: maxRow.tempC,
            maxTempF: maxRow.tempF,
            maxTempAtUtc: maxRow.obsTimeUtc,
            maxTempAtLocal: maxRow.obsTimeLocal,
          }
        : {}),
      ...(minRow
        ? {
            minTempC: minRow.tempC,
            minTempF: minRow.tempF,
            minTempAtUtc: minRow.obsTimeUtc,
            minTempAtLocal: minRow.obsTimeLocal,
          }
        : {}),
      ...(latestRow
        ? {
            latestObsTimeUtc: latestRow.obsTimeUtc,
            latestObsTimeLocal: latestRow.obsTimeLocal,
          }
        : {}),
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, summaryFields);
    } else {
      await ctx.db.insert("nzwnDailySummaries", summaryFields);
    }

    return { updated: true, obsCount: observations.length };
  },
});

export { recomputeDailySummary };

// ---------------------------------------------------------------------------
// Forecast accuracy analysis
// ---------------------------------------------------------------------------

export const getForecastAccuracy = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    trailingDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao ?? NZWN_STATION.stationIcao;
    const trailingDays = Math.max(1, Math.min(90, args.trailingDays ?? 30));
    const todayDate = formatDateInTimezone(Date.now(), AUCKLAND_TIMEZONE);
    const actualSource = "official_preflight";
    const actualSourceLabel = "Official NZWN max (PreFlight METAR/SPECI)";
    const selectionPolicy = "earliest_capture_per_lead_day";

    // Build date range: from (today - trailingDays) to yesterday
    const dates = [];
    for (let i = 1; i <= trailingDays; i++) {
      const epoch = Date.parse(todayDate + "T00:00:00Z") - i * 24 * 60 * 60 * 1000;
      const d = new Date(epoch);
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      dates.push(`${year}-${month}-${day}`);
    }

    // Fetch summaries and predictions for all dates
    const dateDetails = [];
    const buckets = {};
    for (let ld = 0; ld <= 9; ld++) {
      buckets[ld] = { errors: [], biases: [], within1: 0, within2: 0, count: 0 };
    }

    for (const date of dates) {
      const [summary, predictions] = await Promise.all([
        ctx.db
          .query("preflightDailySummaries")
          .withIndex("by_station_date", (q) =>
            q.eq("stationIcao", stationIcao).eq("date", date),
          )
          .first(),
        ctx.db
          .query("nzwnForecastPredictions")
          .withIndex("by_station_provider_target_capturedAt", (q) =>
            q
              .eq("stationIcao", stationIcao)
              .eq("provider", "metservice")
              .eq("targetDate", date),
          )
          .collect(),
      ]);

      const actualMaxC = summary?.maxTempC ?? null;
      const dateRow = {
        date,
        actualMaxC,
        actualMinC: summary?.minTempC ?? null,
        obsCount: summary?.obsCount ?? 0,
        predictions: [],
      };

      // Deduplicate predictions: keep the earliest stored capture per leadDays.
      const byLead = new Map();
      for (const pred of predictions) {
        const existing = byLead.get(pred.leadDays);
        if (!existing || pred.capturedAt < existing.capturedAt) {
          byLead.set(pred.leadDays, pred);
        }
      }

      for (const [leadDays, pred] of byLead) {
        const predMaxC = pred.maxTempC ?? null;
        let errorC = null;
        if (actualMaxC !== null && predMaxC !== null) {
          errorC = roundToTenth(predMaxC - actualMaxC);
          const absError = Math.abs(errorC);
          if (leadDays >= 0 && leadDays <= 9) {
            buckets[leadDays].errors.push(absError);
            buckets[leadDays].biases.push(errorC);
            buckets[leadDays].count += 1;
            if (absError <= 1) buckets[leadDays].within1 += 1;
            if (absError <= 2) buckets[leadDays].within2 += 1;
          }
        }
        dateRow.predictions.push({
          leadDays,
          capturedAt: pred.capturedAt,
          capturedAtLocal: pred.capturedAtLocal,
          maxTempC: predMaxC,
          minTempC: pred.minTempC ?? null,
          errorC,
          dayPhrase: pred.dayPhrase ?? null,
        });
      }
      dateRow.predictions.sort((a, b) => a.leadDays - b.leadDays);
      dateDetails.push(dateRow);
    }

    // Compute per-lead-day metrics
    const leadDayMetrics = [];
    for (let ld = 0; ld <= 9; ld++) {
      const b = buckets[ld];
      if (b.count === 0) {
        leadDayMetrics.push({
          leadDays: ld,
          sampleSize: 0,
          mae: null,
          meanBias: null,
          within1Pct: null,
          within2Pct: null,
        });
        continue;
      }
      const mae = roundToTenth(
        b.errors.reduce((s, e) => s + e, 0) / b.count,
      );
      const meanBias = roundToTenth(
        b.biases.reduce((s, e) => s + e, 0) / b.count,
      );
      const within1Pct = roundToTenth((b.within1 / b.count) * 100);
      const within2Pct = roundToTenth((b.within2 / b.count) * 100);
      leadDayMetrics.push({
        leadDays: ld,
        sampleSize: b.count,
        mae,
        meanBias,
        within1Pct,
        within2Pct,
      });
    }

    dateDetails.sort((a, b) => b.date.localeCompare(a.date));

    return {
      stationIcao,
      trailingDays,
      todayDate,
      actualSource,
      actualSourceLabel,
      selectionPolicy,
      leadDayMetrics,
      dateDetails,
    };
  },
});

// ---------------------------------------------------------------------------
// Forecast trend for a single target date
// ---------------------------------------------------------------------------

export const getForecastTrend = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    targetDate: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao ?? NZWN_STATION.stationIcao;
    const actualSource = "official_preflight";
    const actualLabel = "Official NZWN max (PreFlight METAR/SPECI)";

    const [predictions, summary] = await Promise.all([
      ctx.db
        .query("nzwnForecastPredictions")
        .withIndex("by_station_provider_target_capturedAt", (q) =>
          q
            .eq("stationIcao", stationIcao)
            .eq("provider", "metservice")
            .eq("targetDate", args.targetDate),
        )
        .collect(),
      ctx.db
        .query("preflightDailySummaries")
        .withIndex("by_station_date", (q) =>
          q.eq("stationIcao", stationIcao).eq("date", args.targetDate),
        )
        .first(),
    ]);

    predictions.sort((a, b) => a.capturedAt - b.capturedAt);

    const actualMaxC = summary?.maxTempC ?? null;
    const actualMinC = summary?.minTempC ?? null;

    let previousMaxC = null;
    const trendRows = predictions.map((pred) => {
      const maxC = pred.maxTempC ?? null;
      const deltaC =
        maxC !== null && previousMaxC !== null
          ? roundToTenth(maxC - previousMaxC)
          : null;
      if (maxC !== null) previousMaxC = maxC;
      const errorC =
        maxC !== null && actualMaxC !== null
          ? roundToTenth(maxC - actualMaxC)
          : null;

      return {
        capturedAt: pred.capturedAt,
        capturedAtLocal: pred.capturedAtLocal,
        captureDate: pred.captureDate,
        leadDays: pred.leadDays,
        maxTempC: maxC,
        minTempC: pred.minTempC ?? null,
        dayPhrase: pred.dayPhrase ?? null,
        deltaC,
        errorC,
      };
    });

    return {
      stationIcao,
      targetDate: args.targetDate,
      actualSource,
      actualLabel,
      actualMaxC,
      actualMinC,
      obsCount: summary?.obsCount ?? 0,
      count: trendRows.length,
      rows: trendRows,
    };
  },
});
