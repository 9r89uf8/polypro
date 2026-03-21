import { actionGeneric, internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const AUCKLAND_TIMEZONE = "Pacific/Auckland";
const METSERVICE_BASE_URL = "https://www.metservice.com/publicData";
const METSERVICE_CURRENT_CONDITIONS_URL =
  `${METSERVICE_BASE_URL}/webdata/module/currentConditions/93439/93439`;
const METSERVICE_DAILY_FORECAST_URL =
  `${METSERVICE_BASE_URL}/localForecastlyall-bay`;
const METSERVICE_48HOUR_GRAPH_URL =
  `${METSERVICE_BASE_URL}/webdata/module/48hourGraph/93439/93439`;
const GOOGLE_WEATHER_BASE_URL = "https://weather.googleapis.com/v1";
const GOOGLE_HOURLY_FORECAST_URL =
  `${GOOGLE_WEATHER_BASE_URL}/forecast/hours:lookup`;
const DEFAULT_GOOGLE_LANGUAGE = "en";
const GOOGLE_HOURLY_FORECAST_HOURS = 120;
const GOOGLE_HOURLY_PAGE_SIZE = 24;
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

function extractIsoDate(rawValue) {
  const rawString = String(rawValue ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(rawString)) {
    return rawString.slice(0, 10);
  }
  const parsed = Date.parse(rawString);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const d = new Date(parsed);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function normalizeMetServiceForecastDays(payload) {
  const days = Array.isArray(payload?.days) ? payload.days : [];
  const normalizedRows = [];

  for (const day of days) {
    const date = extractIsoDate(day.dateISO);
    if (!date) {
      continue;
    }
    const maximum = celsiusTempPair(day.max);
    const minimum = celsiusTempPair(day.min);
    const dayPhrase = toNonEmptyString(day.forecast);

    normalizedRows.push({
      date,
      ...(minimum.tempC !== undefined ? { minTempC: minimum.tempC } : {}),
      ...(minimum.tempF !== undefined ? { minTempF: minimum.tempF } : {}),
      ...(maximum.tempC !== undefined ? { maxTempC: maximum.tempC } : {}),
      ...(maximum.tempF !== undefined ? { maxTempF: maximum.tempF } : {}),
      ...(dayPhrase ? { dayPhrase } : {}),
    });
  }

  return normalizedRows;
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

  const observedAtUtc =
    parseValidUtcEpoch(payload?.issuedAt) ??
    parseValidUtcEpoch(payload?.asAt) ??
    Date.now();

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

async function fetchMetServiceDailyForecast() {
  const response = await fetch(METSERVICE_DAILY_FORECAST_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `MetService daily forecast failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const forecastDays = normalizeMetServiceForecastDays(payload);
  if (forecastDays.length === 0) {
    throw new Error("MetService daily forecast returned no usable rows.");
  }

  return forecastDays;
}

async function fetchMetService48HourGraph({ timeZone }) {
  const response = await fetch(METSERVICE_48HOUR_GRAPH_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `MetService 48h graph failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const graphNode = payload?.graph ?? {};
  const seriesArr = Array.isArray(graphNode?.series) ? graphNode.series : [];
  const graphData = Array.isArray(graphNode?.columns) ? graphNode.columns : [];

  // Build a set of indices that are "Observed" vs "Forecast".
  const observedIndices = new Set();
  const forecastIndices = new Set();
  for (const s of seriesArr) {
    const start = Number(s.start) || 0;
    const count = Number(s.count) || 0;
    const label = String(s.label || "").toLowerCase();
    for (let i = start; i < start + count; i += 1) {
      if (label === "observed") {
        observedIndices.add(i);
      } else {
        forecastIndices.add(i);
      }
    }
  }

  const observed = [];
  const forecast = [];

  for (let i = 0; i < graphData.length; i += 1) {
    const point = graphData[i];
    const validTimeUtc = parseValidUtcEpoch(point?.date);
    const temp = celsiusTempPair(point?.temperature);
    if (!Number.isFinite(validTimeUtc) || !Number.isFinite(temp.tempC)) {
      continue;
    }

    const windNode = point?.wind;
    const row = {
      date: formatDateInTimezone(validTimeUtc, timeZone),
      validTimeUtc,
      validTimeLocal: formatDateTimeInTimezone(validTimeUtc, timeZone),
      tempC: temp.tempC,
      tempF: temp.tempF,
      windSpeedKph: toFiniteNumber(windNode?.speed),
      windDirection: toNonEmptyString(windNode?.direction),
      rainfall: toFiniteNumber(point?.rainfall),
    };

    if (observedIndices.has(i)) {
      observed.push(row);
    } else {
      forecast.push(row);
    }
  }

  return { observed, forecast };
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

    const [currentReading, forecastResult, hourlyResult] = await Promise.all([
      (async () => {
        try {
          return await fetchMetServiceCurrentReading({
            timeZone: NZWN_STATION.timeZone,
          });
        } catch (error) {
          return {
            source: "metservice_93439",
            status: WEATHER_STATUS.ERROR,
            error: formatErrorMessage(error),
          };
        }
      })(),
      (async () => {
        try {
          const days = await fetchMetServiceDailyForecast();
          return {
            status: WEATHER_STATUS.OK,
            days,
          };
        } catch (error) {
          return {
            status: WEATHER_STATUS.ERROR,
            error: formatErrorMessage(error),
            days: [],
          };
        }
      })(),
      (async () => {
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
      })(),
    ]);

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
// MetService AWS 10-minute observation storage
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
      return { inserted: false };
    }
    await ctx.db.insert("nzwnMetServiceObservations", {
      ...args,
      createdAt: Date.now(),
    });
    return { inserted: true };
  },
});

export { storeMetServiceObservation };

const storeMetServiceHourlyForecastBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(
      v.object({
        date: v.string(),
        forecastTimeUtc: v.number(),
        forecastTimeLocal: v.string(),
        tempC: v.number(),
        tempF: v.number(),
        windSpeedKph: v.optional(v.number()),
        windDirection: v.optional(v.string()),
        rainfall: v.optional(v.number()),
      }),
    ),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    let upserted = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("nzwnMetServiceHourlyForecasts")
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
          windSpeedKph: row.windSpeedKph,
          windDirection: row.windDirection,
          rainfall: row.rainfall,
          capturedAt: args.capturedAt,
        });
      } else {
        await ctx.db.insert("nzwnMetServiceHourlyForecasts", {
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

export { storeMetServiceHourlyForecastBatch };

export const pollMetServiceCurrentConditions = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao ?? NZWN_STATION.stationIcao;
    const timeZone = NZWN_STATION.timeZone;

    const [reading, graph48h] = await Promise.all([
      fetchMetServiceCurrentReading({ timeZone }),
      fetchMetService48HourGraph({ timeZone }).catch((error) => ({
        observed: [],
        forecast: [],
        error: formatErrorMessage(error),
      })),
    ]);

    // Store the live 10-minute current reading.
    await ctx.runMutation("nzwnWeather:storeMetServiceObservation", {
      stationIcao,
      date: formatDateInTimezone(reading.observedAtUtc, timeZone),
      obsTimeUtc: reading.observedAtUtc,
      obsTimeLocal: reading.observedAtLocal,
      tempC: reading.tempC,
      tempF: reading.tempF,
      relativeHumidity: reading.relativeHumidity ?? undefined,
      windSpeedKph: reading.windSpeedKph ?? undefined,
      windGustKph: reading.windGustKph ?? undefined,
      windDirection: reading.windDirection ?? undefined,
      pressureHpa: reading.pressureHpa ?? undefined,
      source: "metservice_93439",
    });

    // Store hourly observed points from the 48h graph (backfills gaps).
    for (const obs of graph48h.observed) {
      await ctx.runMutation("nzwnWeather:storeMetServiceObservation", {
        stationIcao,
        date: obs.date,
        obsTimeUtc: obs.validTimeUtc,
        obsTimeLocal: obs.validTimeLocal,
        tempC: obs.tempC,
        tempF: obs.tempF,
        windSpeedKph: obs.windSpeedKph ?? undefined,
        windDirection: obs.windDirection ?? undefined,
        source: "metservice_48h_observed",
      });
    }

    // Store hourly forecast points (upsert — forecast values change each poll).
    if (graph48h.forecast.length > 0) {
      await ctx.runMutation("nzwnWeather:storeMetServiceHourlyForecastBatch", {
        stationIcao,
        rows: graph48h.forecast.map((row) => ({
          date: row.date,
          forecastTimeUtc: row.validTimeUtc,
          forecastTimeLocal: row.validTimeLocal,
          tempC: row.tempC,
          tempF: row.tempF,
          windSpeedKph: row.windSpeedKph ?? undefined,
          windDirection: row.windDirection ?? undefined,
          rainfall: row.rainfall ?? undefined,
        })),
        capturedAt: Date.now(),
      });
    }

    return {
      status: "ok",
      observedAtUtc: reading.observedAtUtc,
      observedAtLocal: reading.observedAtLocal,
      tempC: reading.tempC,
      tempF: reading.tempF,
      graph48hObserved: graph48h.observed.length,
      graph48hForecast: graph48h.forecast.length,
    };
  },
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
    const rows = await ctx.db
      .query("nzwnMetServiceHourlyForecasts")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.forecastTimeUtc - b.forecastTimeUtc);
    return { rows };
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
    const rows = await ctx.db
      .query("nzwnMetServiceObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
    return { rows };
  },
});
