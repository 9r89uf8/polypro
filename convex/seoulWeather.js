import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const SEOUL_TIMEZONE = "Asia/Seoul";
const WEATHERCOM_API_BASE_URL = "https://api.weather.com";
const WEATHERCOM_DAILY_FORECAST_URL = `${WEATHERCOM_API_BASE_URL}/v3/wx/forecast/daily/5day`;
const WEATHERCOM_HOURLY_FORECAST_URL = `${WEATHERCOM_API_BASE_URL}/v3/wx/forecast/hourly/10day`;
const DEFAULT_WEATHERCOM_LANGUAGE = "en-US";
const WEATHERCOM_FALLBACK_API_KEY = "71f92ea9dd2f4790b92ea9dd2f779061";
const RKSI_REPRESENTATIVE_RUNWAY_NO = "2";
const RKSI_REPRESENTATIVE_RUNWAY_DIRECTION = "15L";
const MILLIS_PER_MINUTE = 60 * 1000;
const MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE;
const PREDICTION_INTERVAL_MS = 5 * MILLIS_PER_MINUTE;
const MAX_LIVE_OBSERVATION_AGE_MS = 10 * MILLIS_PER_MINUTE;
const MAX_PROVIDER_CAPTURE_AGE_MS = 12 * MILLIS_PER_HOUR;
const WEATHERCOM_BASELINE_WINDOW_MS = 2 * MILLIS_PER_HOUR;
const WEATHERCOM_HISTORY_STALE_MS = 90 * MILLIS_PER_MINUTE;
const PREDICTION_HEARTBEAT_MS = 30 * MILLIS_PER_MINUTE;
const PREDICTION_MODEL_VERSION = "rksi15l-weathercom-v4";
const MAX_DASHBOARD_REVISIONS = 288;
const MAX_FORECAST_CAPTURES_FOR_DAY = 112;
const WEATHER_STATUS = {
  OK: "ok",
  PARTIAL: "partial",
  ERROR: "error",
};

const SEOUL_STATION = {
  stationIcao: "RKSI",
  stationName: "Incheon International",
  lat: 37.4602,
  lon: 126.4407,
  timeZone: SEOUL_TIMEZONE,
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

function toCelsius(fahrenheit) {
  return roundToTenth(((fahrenheit - 32) * 5) / 9);
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

function addUtcDays(dateIso, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!match) {
    return dateIso;
  }
  const epoch = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  );
  const d = new Date(epoch);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function assertDateKey(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) {
    return null;
  }
  return finite.reduce((total, value) => total + value, 0) / finite.length;
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) {
    return null;
  }
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2
    ? finite[middle]
    : (finite[middle - 1] + finite[middle]) / 2;
}

function standardDeviation(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) {
    return 0;
  }
  const average = mean(finite);
  const variance =
    finite.reduce((total, value) => total + (value - average) ** 2, 0) /
    finite.length;
  return Math.sqrt(variance);
}

function weightedMean(entries) {
  const usable = entries.filter(
    (entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight),
  );
  const totalWeight = usable.reduce((total, entry) => total + entry.weight, 0);
  if (!usable.length || totalWeight <= 0) {
    return null;
  }
  return (
    usable.reduce((total, entry) => total + entry.value * entry.weight, 0) /
    totalWeight
  );
}

function normalizeWeatherComTempPair(value, requestedUnit) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return {};
  }
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return {};
  }
  if (requestedUnit === "metric") {
    const tempC = roundToTenth(parsed);
    return { tempC, tempF: toFahrenheit(tempC) };
  }
  const tempF = roundToTenth(parsed);
  return { tempF, tempC: toCelsius(tempF) };
}

function normalizeWeatherComForecastDays(
  payload,
  durationDays,
  requestedUnit,
  timeZone,
) {
  const fallbackStartDate = formatDateInTimezone(Date.now(), timeZone);
  const normalizedRows = [];
  const maxRows = Math.min(durationDays, 5);
  const daypartNode =
    Array.isArray(payload?.daypart) && payload.daypart.length > 0
      ? payload.daypart[0]
      : null;
  const daypartNarratives = Array.isArray(daypartNode?.narrative)
    ? daypartNode.narrative
    : [];
  const rowCount = Math.max(
    Array.isArray(payload?.validTimeLocal) ? payload.validTimeLocal.length : 0,
    Array.isArray(payload?.validTimeUtc) ? payload.validTimeUtc.length : 0,
    Array.isArray(payload?.temperatureMax) ? payload.temperatureMax.length : 0,
    Array.isArray(payload?.calendarDayTemperatureMax)
      ? payload.calendarDayTemperatureMax.length
      : 0,
    Array.isArray(payload?.temperatureMin) ? payload.temperatureMin.length : 0,
    Array.isArray(payload?.calendarDayTemperatureMin)
      ? payload.calendarDayTemperatureMin.length
      : 0,
    Array.isArray(payload?.narrative) ? payload.narrative.length : 0,
  );

  for (let i = 0; i < rowCount && normalizedRows.length < maxRows; i += 1) {
    const validTimeLocal = payload?.validTimeLocal?.[i];
    const validTimeUtc = toFiniteNumber(payload?.validTimeUtc?.[i]);
    const date =
      extractIsoDate(validTimeLocal) ??
      (validTimeUtc !== null
        ? formatDateInTimezone(validTimeUtc * 1000, timeZone)
        : null) ??
      addUtcDays(fallbackStartDate, i);
    // The chart covers a Seoul calendar day (midnight to midnight), so use
    // Weather.com's calendar-day fields before its narrower daypart fields.
    const maxValue =
      payload?.calendarDayTemperatureMax?.[i] ?? payload?.temperatureMax?.[i];
    const minValue =
      payload?.calendarDayTemperatureMin?.[i] ?? payload?.temperatureMin?.[i];
    const maximum = normalizeWeatherComTempPair(maxValue, requestedUnit);
    const minimum = normalizeWeatherComTempPair(minValue, requestedUnit);
    const dayPhrase =
      toNonEmptyString(daypartNarratives[i * 2]) ??
      toNonEmptyString(payload?.narrative?.[i]);
    const nightPhrase = toNonEmptyString(daypartNarratives[i * 2 + 1]);

    normalizedRows.push({
      date,
      ...(Number.isFinite(minimum.tempC) ? { minTempC: minimum.tempC } : {}),
      ...(Number.isFinite(minimum.tempF) ? { minTempF: minimum.tempF } : {}),
      ...(Number.isFinite(maximum.tempC) ? { maxTempC: maximum.tempC } : {}),
      ...(Number.isFinite(maximum.tempF) ? { maxTempF: maximum.tempF } : {}),
      ...(dayPhrase ? { dayPhrase } : {}),
      ...(nightPhrase ? { nightPhrase } : {}),
    });
  }

  return normalizedRows;
}

function toWeatherComUnits(unit) {
  return unit === "metric" ? "m" : "e";
}

function getWeatherComApiKey() {
  return (
    toNonEmptyString(process.env.WEATHERCOM_API_KEY) ??
    WEATHERCOM_FALLBACK_API_KEY
  );
}

async function fetchWeatherComDailyForecast({
  icaoCode,
  durationDays,
  unit,
  language,
  apiKey,
  timeZone,
}) {
  const url = new URL(WEATHERCOM_DAILY_FORECAST_URL);
  url.searchParams.set("icaoCode", icaoCode);
  url.searchParams.set("units", toWeatherComUnits(unit));
  url.searchParams.set("language", language);
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", apiKey);

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
      `Weather.com daily forecast failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const forecastDays = normalizeWeatherComForecastDays(
    payload,
    durationDays,
    unit,
    timeZone,
  );
  if (forecastDays.length < Math.min(durationDays, 5)) {
    throw new Error(
      `Weather.com daily forecast returned ${forecastDays.length} usable rows.`,
    );
  }

  return forecastDays;
}

function normalizeCloudCover(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : Math.round(clamp(parsed, 0, 100));
}

function normalizeWeatherComHourlyRows(payload, requestedUnit, timeZone) {
  const rows = [];
  const rowCount = Math.max(
    Array.isArray(payload?.validTimeUtc) ? payload.validTimeUtc.length : 0,
    Array.isArray(payload?.temperature) ? payload.temperature.length : 0,
    Array.isArray(payload?.cloudCover) ? payload.cloudCover.length : 0,
    Array.isArray(payload?.wxPhraseLong) ? payload.wxPhraseLong.length : 0,
  );

  for (let index = 0; index < rowCount; index += 1) {
    if (
      payload?.validTimeUtc?.[index] === null ||
      payload?.validTimeUtc?.[index] === undefined ||
      (typeof payload?.validTimeUtc?.[index] === "string" &&
        payload.validTimeUtc[index].trim() === "")
    ) {
      continue;
    }
    const validTimeUtc = toFiniteNumber(payload?.validTimeUtc?.[index]);
    const forecastTimeUtc =
      validTimeUtc === null ? null : Math.round(validTimeUtc * 1000);
    const temperature = normalizeWeatherComTempPair(
      payload?.temperature?.[index],
      requestedUnit,
    );
    if (
      !Number.isFinite(forecastTimeUtc) ||
      !Number.isFinite(temperature.tempC)
    ) {
      continue;
    }
    const phrase =
      toNonEmptyString(payload?.wxPhraseLong?.[index]) ??
      toNonEmptyString(payload?.wxPhraseShort?.[index]);
    const cloudCoverPct = normalizeCloudCover(payload?.cloudCover?.[index]);
    rows.push({
      date: formatDateInTimezone(forecastTimeUtc, timeZone),
      forecastTimeUtc,
      forecastTimeLocal: formatDateTimeInTimezone(forecastTimeUtc, timeZone),
      tempC: temperature.tempC,
      tempF: temperature.tempF,
      ...(phrase ? { phrase } : {}),
      ...(Number.isFinite(cloudCoverPct) ? { cloudCoverPct } : {}),
    });
  }

  return rows;
}

async function fetchWeatherComHourlyForecast({
  icaoCode,
  unit,
  language,
  apiKey,
  timeZone,
}) {
  const url = new URL(WEATHERCOM_HOURLY_FORECAST_URL);
  url.searchParams.set("icaoCode", icaoCode);
  url.searchParams.set("units", toWeatherComUnits(unit));
  url.searchParams.set("language", language);
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", apiKey);

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
      `Weather.com hourly forecast failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const rows = normalizeWeatherComHourlyRows(payload, unit, timeZone);
  if (!rows.length) {
    throw new Error("Weather.com hourly forecast returned no usable rows.");
  }
  rows.sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc);
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

    const apiKey = getWeatherComApiKey();
    const unit = "metric";
    const language = DEFAULT_WEATHERCOM_LANGUAGE;
    const todayDate = formatDateInTimezone(Date.now(), SEOUL_STATION.timeZone);

    const forecast = await (async () => {
      if (!apiKey) {
        return {
          status: WEATHER_STATUS.ERROR,
          error: "Missing WEATHERCOM_API_KEY.",
          days: [],
        };
      }
      try {
        const days = await fetchWeatherComDailyForecast({
          icaoCode: SEOUL_STATION.stationIcao,
          durationDays: 5,
          unit,
          language,
          apiKey,
          timeZone: SEOUL_STATION.timeZone,
        });
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
    })();

    return {
      stationIcao: SEOUL_STATION.stationIcao,
      stationName: SEOUL_STATION.stationName,
      todayDate,
      forecast,
      selectedDateForecast:
        forecast.days.find((day) => day.date === args.date) ?? null,
    };
  },
});

const forecastDayValidator = v.object({
  date: v.string(),
  minTempC: v.optional(v.number()),
  minTempF: v.optional(v.number()),
  maxTempC: v.optional(v.number()),
  maxTempF: v.optional(v.number()),
  dayPhrase: v.optional(v.string()),
  nightPhrase: v.optional(v.string()),
});

const hourlyForecastRowValidator = v.object({
  date: v.string(),
  forecastTimeUtc: v.number(),
  forecastTimeLocal: v.string(),
  tempC: v.number(),
  tempF: v.number(),
  phrase: v.optional(v.string()),
  cloudCoverPct: v.optional(v.number()),
});

export const storeForecastCapture = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    stationName: v.string(),
    capturedAt: v.number(),
    capturedAtLocal: v.string(),
    captureDate: v.string(),
    status: v.union(
      v.literal(WEATHER_STATUS.OK),
      v.literal(WEATHER_STATUS.PARTIAL),
      v.literal(WEATHER_STATUS.ERROR),
    ),
    weathercomStatus: v.union(
      v.literal(WEATHER_STATUS.OK),
      v.literal(WEATHER_STATUS.ERROR),
    ),
    weathercomError: v.optional(v.string()),
    weathercomForecastDays: v.array(forecastDayValidator),
    weathercomHourlyStatus: v.union(
      v.literal(WEATHER_STATUS.OK),
      v.literal(WEATHER_STATUS.ERROR),
    ),
    weathercomHourlyError: v.optional(v.string()),
    weathercomHourlyCapturedAt: v.optional(v.number()),
    weathercomHourlyCapturedAtLocal: v.optional(v.string()),
    weathercomHourlyCaptureDate: v.optional(v.string()),
    weathercomHourlyRows: v.array(hourlyForecastRowValidator),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const weathercomHourlyCapturedAt =
      args.weathercomHourlyCapturedAt ?? args.capturedAt;
    const weathercomHourlyCapturedAtLocal =
      args.weathercomHourlyCapturedAtLocal ?? args.capturedAtLocal;
    const weathercomHourlyCaptureDate =
      args.weathercomHourlyCaptureDate ?? args.captureDate;
    const captureId = await ctx.db.insert("seoulForecastCaptures", {
      ...args,
      createdAt,
    });
    for (const row of args.weathercomHourlyRows) {
      await ctx.db.insert("seoulHourlyForecastPredictions", {
        stationIcao: args.stationIcao,
        provider: "weathercom",
        targetDate: row.date,
        forecastTimeUtc: row.forecastTimeUtc,
        forecastTimeLocal: row.forecastTimeLocal,
        capturedAt: weathercomHourlyCapturedAt,
        capturedAtLocal: weathercomHourlyCapturedAtLocal,
        captureDate: weathercomHourlyCaptureDate,
        tempC: row.tempC,
        tempF: row.tempF,
        ...(row.phrase ? { phrase: row.phrase } : {}),
        ...(Number.isFinite(row.cloudCoverPct)
          ? { cloudCoverPct: row.cloudCoverPct }
          : {}),
        forecastCaptureId: captureId,
        createdAt,
      });
    }
    return await ctx.db.get(captureId);
  },
});

export const collectForecastSnapshot = internalActionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(
      args.stationIcao ?? SEOUL_STATION.stationIcao,
    ).toUpperCase();
    if (stationIcao !== SEOUL_STATION.stationIcao) {
      throw new Error(
        "The Seoul forecast collector currently supports RKSI only.",
      );
    }

    const capturedAt = Date.now();
    const capturedAtLocal = formatDateTimeInTimezone(
      capturedAt,
      SEOUL_TIMEZONE,
    );
    const captureDate = formatDateInTimezone(capturedAt, SEOUL_TIMEZONE);
    const apiKey = getWeatherComApiKey();
    const [weathercomDaily, weathercomHourly] = await Promise.all([
      (async () => {
        try {
          const rows = await fetchWeatherComDailyForecast({
            icaoCode: stationIcao,
            durationDays: 5,
            unit: "metric",
            language: DEFAULT_WEATHERCOM_LANGUAGE,
            apiKey,
            timeZone: SEOUL_TIMEZONE,
          });
          return { status: WEATHER_STATUS.OK, rows };
        } catch (error) {
          return {
            status: WEATHER_STATUS.ERROR,
            error: formatErrorMessage(error),
            rows: [],
          };
        }
      })(),
      (async () => {
        try {
          const rows = await fetchWeatherComHourlyForecast({
            icaoCode: stationIcao,
            unit: "metric",
            language: DEFAULT_WEATHERCOM_LANGUAGE,
            apiKey,
            timeZone: SEOUL_TIMEZONE,
          });
          const providerCapturedAt = Date.now();
          return {
            status: WEATHER_STATUS.OK,
            rows,
            capturedAt: providerCapturedAt,
            capturedAtLocal: formatDateTimeInTimezone(
              providerCapturedAt,
              SEOUL_TIMEZONE,
            ),
            captureDate: formatDateInTimezone(
              providerCapturedAt,
              SEOUL_TIMEZONE,
            ),
          };
        } catch (error) {
          const providerCapturedAt = Date.now();
          return {
            status: WEATHER_STATUS.ERROR,
            error: formatErrorMessage(error),
            rows: [],
            capturedAt: providerCapturedAt,
            capturedAtLocal: formatDateTimeInTimezone(
              providerCapturedAt,
              SEOUL_TIMEZONE,
            ),
            captureDate: formatDateInTimezone(
              providerCapturedAt,
              SEOUL_TIMEZONE,
            ),
          };
        }
      })(),
    ]);

    const okCount = [weathercomDaily, weathercomHourly].filter(
      (provider) => provider.status === WEATHER_STATUS.OK,
    ).length;
    const status =
      okCount === 2
        ? WEATHER_STATUS.OK
        : okCount > 0
          ? WEATHER_STATUS.PARTIAL
          : WEATHER_STATUS.ERROR;
    const capturedForecastDates = new Set(
      Array.from({ length: 5 }, (_value, offset) =>
        addUtcDays(captureDate, offset),
      ),
    );
    const weathercomHourlyRows = weathercomHourly.rows.filter((row) =>
      capturedForecastDates.has(row.date),
    );

    const capture = await ctx.runMutation("seoulWeather:storeForecastCapture", {
      stationIcao,
      stationName: SEOUL_STATION.stationName,
      capturedAt,
      capturedAtLocal,
      captureDate,
      status,
      weathercomStatus: weathercomDaily.status,
      ...(weathercomDaily.error
        ? { weathercomError: weathercomDaily.error }
        : {}),
      weathercomForecastDays: weathercomDaily.rows,
      weathercomHourlyStatus: weathercomHourly.status,
      ...(weathercomHourly.error
        ? { weathercomHourlyError: weathercomHourly.error }
        : {}),
      weathercomHourlyCapturedAt: weathercomHourly.capturedAt,
      weathercomHourlyCapturedAtLocal: weathercomHourly.capturedAtLocal,
      weathercomHourlyCaptureDate: weathercomHourly.captureDate,
      weathercomHourlyRows,
    });

    return {
      ...capture,
      providerCounts: {
        weathercomDays: weathercomDaily.rows.length,
        weathercomHours: weathercomHourlyRows.length,
      },
    };
  },
});

function amosCadencePriority(row) {
  if (row.collectionCadence === "one_minute") {
    return 2;
  }
  if (row.collectionCadence === "five_minute") {
    return 1;
  }
  return 0;
}

function canonicalizeRepresentativeAmosRows(rows) {
  const byTimestamp = new Map();
  for (const row of rows) {
    if (
      row.rwyNo !== RKSI_REPRESENTATIVE_RUNWAY_NO ||
      row.rwyDir !== RKSI_REPRESENTATIVE_RUNWAY_DIRECTION ||
      !Number.isFinite(row.tempC)
    ) {
      continue;
    }
    const existing = byTimestamp.get(row.obsTimeUtc);
    if (
      !existing ||
      amosCadencePriority(row) > amosCadencePriority(existing) ||
      (amosCadencePriority(row) === amosCadencePriority(existing) &&
        (row.updatedAt ?? 0) > (existing.updatedAt ?? 0))
    ) {
      byTimestamp.set(row.obsTimeUtc, row);
    }
  }
  return Array.from(byTimestamp.values())
    .filter((row) => Number.isFinite(row.tempC))
    .sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
}

function selectExtremeRow(rows, mode) {
  let selected = null;
  for (const row of rows) {
    if (
      !selected ||
      (mode === "max" && row.tempC > selected.tempC) ||
      (mode === "min" && row.tempC < selected.tempC) ||
      (row.tempC === selected.tempC && row.obsTimeUtc < selected.obsTimeUtc)
    ) {
      selected = row;
    }
  }
  return selected;
}

function calculateSlopeCPerHour(rows, windowMinutes) {
  if (rows.length < 2) {
    return null;
  }
  const latest = rows[rows.length - 1];
  const targetTime = latest.obsTimeUtc - windowMinutes * MILLIS_PER_MINUTE;
  let baseline = null;
  for (const row of rows) {
    if (row.obsTimeUtc <= targetTime) {
      baseline = row;
    } else {
      break;
    }
  }
  if (!baseline) {
    return null;
  }
  const elapsedHours =
    (latest.obsTimeUtc - baseline.obsTimeUtc) / MILLIS_PER_HOUR;
  if (
    elapsedHours < (windowMinutes / 60) * 0.75 ||
    elapsedHours > (windowMinutes / 60) * 1.5
  ) {
    return null;
  }
  return roundToTenth((latest.tempC - baseline.tempC) / elapsedHours);
}

function interpolateHourlyTemperature(rows, epochMs) {
  if (!rows.length || !Number.isFinite(epochMs)) {
    return null;
  }
  const ordered = [...rows].sort(
    (a, b) => a.forecastTimeUtc - b.forecastTimeUtc,
  );
  let before = null;
  let after = null;
  for (const row of ordered) {
    if (row.forecastTimeUtc <= epochMs) {
      before = row;
    }
    if (row.forecastTimeUtc >= epochMs) {
      after = row;
      break;
    }
  }
  if (before && after) {
    if (before.forecastTimeUtc === after.forecastTimeUtc) {
      return before.tempC;
    }
    const ratio =
      (epochMs - before.forecastTimeUtc) /
      (after.forecastTimeUtc - before.forecastTimeUtc);
    return before.tempC + (after.tempC - before.tempC) * ratio;
  }
  const nearest = before ?? after;
  if (
    nearest &&
    Math.abs(nearest.forecastTimeUtc - epochMs) <= 2 * MILLIS_PER_HOUR
  ) {
    return nearest.tempC;
  }
  return null;
}

function interpolateBracketedHourlyTemperature(rows, epochMs) {
  if (!rows.length || !Number.isFinite(epochMs)) {
    return null;
  }
  const ordered = [...rows].sort(
    (a, b) => a.forecastTimeUtc - b.forecastTimeUtc,
  );
  let before = null;
  let after = null;
  for (const row of ordered) {
    if (row.forecastTimeUtc <= epochMs) {
      before = row;
    }
    if (row.forecastTimeUtc >= epochMs) {
      after = row;
      break;
    }
  }
  if (!before || !after) {
    return null;
  }
  if (before.forecastTimeUtc === after.forecastTimeUtc) {
    return before.tempC;
  }
  if (after.forecastTimeUtc - before.forecastTimeUtc > 90 * MILLIS_PER_MINUTE) {
    return null;
  }
  const ratio =
    (epochMs - before.forecastTimeUtc) /
    (after.forecastTimeUtc - before.forecastTimeUtc);
  return before.tempC + (after.tempC - before.tempC) * ratio;
}

function findHighestForecastRow(rows, generatedAt, targetIsToday) {
  const remaining = targetIsToday
    ? rows.filter(
        (row) => row.forecastTimeUtc >= generatedAt - MILLIS_PER_MINUTE,
      )
    : rows;
  const candidates = remaining.length ? remaining : rows;
  let selected = null;
  for (const row of candidates) {
    if (
      !selected ||
      row.tempC > selected.tempC ||
      (row.tempC === selected.tempC &&
        row.forecastTimeUtc < selected.forecastTimeUtc)
    ) {
      selected = row;
    }
  }
  return selected;
}

function selectLatestUsableWeatherComCapture({
  captures,
  targetDate,
  generatedAt,
}) {
  return (
    captures.find((capture) => {
      if (
        generatedAt - capture.capturedAt > MAX_PROVIDER_CAPTURE_AGE_MS ||
        capture.capturedAt > generatedAt + MILLIS_PER_MINUTE
      ) {
        return false;
      }
      return (
        capture.weathercomStatus === WEATHER_STATUS.OK &&
        capture.weathercomHourlyStatus === WEATHER_STATUS.OK &&
        (capture.weathercomForecastDays ?? []).some(
          (row) => row.date === targetDate && Number.isFinite(row.maxTempC),
        ) &&
        (capture.weathercomHourlyRows ?? []).some(
          (row) => row.date === targetDate && Number.isFinite(row.tempC),
        )
      );
    }) ?? null
  );
}

function mergeWeatherComHourlyRows(captures, targetDate) {
  const rowsByTime = new Map();
  for (const capture of [...captures].sort(
    (left, right) => left.capturedAt - right.capturedAt,
  )) {
    if (
      capture.weathercomStatus !== WEATHER_STATUS.OK ||
      capture.weathercomHourlyStatus !== WEATHER_STATUS.OK ||
      !(capture.weathercomForecastDays ?? []).some(
        (day) => day.date === targetDate && Number.isFinite(day.maxTempC),
      )
    ) {
      continue;
    }
    for (const row of capture.weathercomHourlyRows ?? []) {
      if (row.date === targetDate && Number.isFinite(row.forecastTimeUtc)) {
        // New captures replace still-future values, while an elapsed hour
        // remains available from the last capture in which Weather.com sent it.
        rowsByTime.set(row.forecastTimeUtc, {
          ...row,
          peakSourceCapturedAt:
            capture.weathercomHourlyCapturedAt ?? capture.capturedAt,
          peakSourceCapturedAtLocal:
            capture.weathercomHourlyCapturedAtLocal ?? capture.capturedAtLocal,
        });
      }
    }
  }
  return [...rowsByTime.values()].sort(
    (left, right) => left.forecastTimeUtc - right.forecastTimeUtc,
  );
}

function buildWeatherComProvider({
  capture,
  hourlyRows,
  targetDate,
  targetIsToday,
  generatedAt,
}) {
  const day = capture?.weathercomForecastDays?.find(
    (row) => row.date === targetDate,
  );
  const dailyUsable =
    capture?.weathercomStatus === WEATHER_STATUS.OK &&
    Number.isFinite(day?.maxTempC);
  const dateRows = (hourlyRows ?? []).filter(
    (row) => row.date === targetDate && Number.isFinite(row.tempC),
  );
  const hourlyPeak = findHighestForecastRow(dateRows, generatedAt, false);
  const usable = dailyUsable && Boolean(hourlyPeak);
  const dailyHighC = dailyUsable ? roundToTenth(day.maxTempC) : null;
  const dailyHighF = dailyUsable
    ? (day.maxTempF ?? toFahrenheit(dailyHighC))
    : null;
  const expectedCurrentC =
    targetIsToday && dateRows.length
      ? interpolateHourlyTemperature(dateRows, generatedAt)
      : null;
  const detail = {
    provider: "weathercom",
    label: "Weather.com · RKSI",
    status: usable ? WEATHER_STATUS.OK : WEATHER_STATUS.ERROR,
    ...(!usable
      ? {
          error: !dailyUsable
            ? (capture?.weathercomError ??
              `No Weather.com daily maximum for ${targetDate}.`)
            : (capture?.weathercomHourlyError ??
              `No Weather.com hourly peak-time estimate for ${targetDate}.`),
        }
      : {}),
    weight: usable ? 1 : 0,
    ...(dailyUsable
      ? {
          rawHighC: dailyHighC,
          rawHighF: dailyHighF,
          adjustedHighC: dailyHighC,
          adjustedHighF: dailyHighF,
        }
      : {}),
    ...(usable
      ? {
          dailyHighC,
          dailyHighF,
          dailyPeakTimeUtc: hourlyPeak.forecastTimeUtc,
          dailyPeakTimeLocal: hourlyPeak.forecastTimeLocal,
          peakTimeUtc: hourlyPeak.forecastTimeUtc,
          peakTimeLocal: hourlyPeak.forecastTimeLocal,
          peakSourceCapturedAt: hourlyPeak.peakSourceCapturedAt,
          peakSourceCapturedAtLocal: hourlyPeak.peakSourceCapturedAtLocal,
          capturedAt: capture.capturedAt,
          capturedAtLocal: capture.capturedAtLocal,
          captureAgeMinutes: roundToTenth(
            Math.max(0, generatedAt - capture.capturedAt) / MILLIS_PER_MINUTE,
          ),
        }
      : {}),
    pointCount: dateRows.length,
  };
  return {
    detail,
    rows: dateRows,
    expectedCurrentC,
    adjustedHighC: dailyHighC,
    hourlyPeak,
  };
}

function buildHourlyEnsembleCurve(providerCurves) {
  const points = new Map();
  for (const provider of providerCurves) {
    for (const row of provider.rows) {
      let point = points.get(row.forecastTimeUtc);
      if (!point) {
        point = {
          forecastTimeUtc: row.forecastTimeUtc,
          forecastTimeLocal: row.forecastTimeLocal,
          values: [],
          cloudValues: [],
        };
        points.set(row.forecastTimeUtc, point);
      }
      point.values.push({ value: row.tempC, weight: provider.weight });
      if (Number.isFinite(row.cloudCoverPct)) {
        point.cloudValues.push({
          value: row.cloudCoverPct,
          weight: provider.weight,
        });
      }
    }
  }

  return Array.from(points.values())
    .sort((a, b) => a.forecastTimeUtc - b.forecastTimeUtc)
    .map((point) => {
      const tempC = roundToTenth(weightedMean(point.values));
      const cloudCoverPct = point.cloudValues.length
        ? Math.round(clamp(weightedMean(point.cloudValues), 0, 100))
        : null;
      return {
        forecastTimeUtc: point.forecastTimeUtc,
        forecastTimeLocal: point.forecastTimeLocal,
        tempC,
        tempF: toFahrenheit(tempC),
        providerCount: point.values.length,
        ...(Number.isFinite(cloudCoverPct)
          ? {
              cloudCoverPct,
              cloudProviderCount: point.cloudValues.length,
            }
          : {}),
      };
    });
}

function selectPreferredDailyPeakProvider(providerDetails) {
  return (
    providerDetails
      .filter(
        (provider) =>
          provider.status === WEATHER_STATUS.OK &&
          provider.weight > 0 &&
          Number.isFinite(provider.dailyHighC) &&
          Number.isFinite(provider.dailyPeakTimeUtc),
      )
      .sort(
        (left, right) =>
          right.weight - left.weight ||
          (right.capturedAt ?? 0) - (left.capturedAt ?? 0) ||
          left.provider.localeCompare(right.provider),
      )[0] ?? null
  );
}

function predictionState({
  previousPrediction,
  predictedHighC,
  observedHighC,
  observedCurrentC,
  expectedCurrentC,
  slope60mCPerHour,
  generatedAt,
  peakWindowEndUtc,
  futureForecastHighC,
}) {
  if (!Number.isFinite(observedCurrentC)) {
    return {
      status: "awaiting_observations",
      reason:
        "Forecast providers are available, but no canonical RKSI 15L AMOS temperature has been observed yet.",
    };
  }

  const predictionDeltaC = previousPrediction
    ? roundToTenth(predictedHighC - previousPrediction.predictedHighC)
    : 0;
  if (previousPrediction && predictionDeltaC >= 0.2) {
    return {
      status: "revised_up",
      reason: `Revised up ${predictionDeltaC.toFixed(1)}°C as the live 15L observations and latest provider curve run warmer.`,
    };
  }
  if (previousPrediction && predictionDeltaC <= -0.2) {
    return {
      status: "revised_down",
      reason: `Revised down ${Math.abs(predictionDeltaC).toFixed(1)}°C as the live 15L observations and latest provider curve run cooler.`,
    };
  }

  if (
    Number.isFinite(peakWindowEndUtc) &&
    generatedAt > peakWindowEndUtc + MILLIS_PER_HOUR &&
    Number.isFinite(slope60mCPerHour) &&
    slope60mCPerHour <= 0 &&
    Number.isFinite(observedHighC) &&
    (!Number.isFinite(futureForecastHighC) ||
      observedHighC >= futureForecastHighC - 0.2)
  ) {
    return {
      status: "peak_likely_passed",
      reason:
        "The likely peak window has passed, the one-hour trend is flat or falling, and no remaining forecast hour exceeds the observed high.",
    };
  }

  const liveDepartureC =
    Number.isFinite(expectedCurrentC) && Number.isFinite(observedCurrentC)
      ? observedCurrentC - expectedCurrentC
      : null;
  if (Number.isFinite(liveDepartureC) && liveDepartureC >= 0.5) {
    return {
      status: "running_warm",
      reason: `RKSI 15L is ${roundToTenth(liveDepartureC).toFixed(1)}°C warmer than the current hourly ensemble.`,
    };
  }
  if (Number.isFinite(liveDepartureC) && liveDepartureC <= -0.5) {
    return {
      status: "running_cool",
      reason: `RKSI 15L is ${Math.abs(roundToTenth(liveDepartureC)).toFixed(1)}°C cooler than the current hourly ensemble.`,
    };
  }
  if (!Number.isFinite(expectedCurrentC)) {
    return {
      status: "limited_guidance",
      reason:
        "A live 15L observation is available, but no fresh hourly ensemble exists for an on-track comparison.",
    };
  }
  return {
    status: "on_track",
    reason:
      "The live RKSI 15L temperature remains within 0.5°C of the current Weather.com hourly curve.",
  };
}

export const recomputeHighPredictionInternal = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    assertDateKey(args.date);
    const generatedAt = Date.now();
    const generatedAtLocal = formatDateTimeInTimezone(
      generatedAt,
      SEOUL_TIMEZONE,
    );
    const evaluationSlotUtc =
      Math.floor(generatedAt / PREDICTION_INTERVAL_MS) * PREDICTION_INTERVAL_MS;
    const todayDate = formatDateInTimezone(generatedAt, SEOUL_TIMEZONE);
    const targetIsToday = args.date === todayDate;

    const rawObservations = await ctx.db
      .query("seoulAmosObservations")
      .withIndex("by_station_date_rwy_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("date", args.date)
          .eq("rwyNo", RKSI_REPRESENTATIVE_RUNWAY_NO)
          .eq("rwyDir", RKSI_REPRESENTATIVE_RUNWAY_DIRECTION),
      )
      .collect();
    const observations = canonicalizeRepresentativeAmosRows(rawObservations);
    const firstRow = observations[0] ?? null;
    const latestRow = observations[observations.length - 1] ?? null;
    const maxRow = selectExtremeRow(observations, "max");
    const minRow = selectExtremeRow(observations, "min");
    const oneMinuteObsCount = observations.filter(
      (row) => row.collectionCadence === "one_minute",
    ).length;
    const summaryFields = {
      stationIcao: args.stationIcao,
      date: args.date,
      rwyNo: RKSI_REPRESENTATIVE_RUNWAY_NO,
      rwyDir: RKSI_REPRESENTATIVE_RUNWAY_DIRECTION,
      obsCount: observations.length,
      oneMinuteObsCount,
      fallbackObsCount: observations.length - oneMinuteObsCount,
      ...(firstRow
        ? {
            firstObsTimeUtc: firstRow.obsTimeUtc,
            firstObsTimeLocal: firstRow.obsTimeLocal,
          }
        : {}),
      ...(latestRow
        ? {
            latestObsTimeUtc: latestRow.obsTimeUtc,
            latestObsTimeLocal: latestRow.obsTimeLocal,
            latestTempC: latestRow.tempC,
            latestTempF: latestRow.tempF ?? toFahrenheit(latestRow.tempC),
          }
        : {}),
      ...(maxRow
        ? {
            maxTempC: maxRow.tempC,
            maxTempF: maxRow.tempF ?? toFahrenheit(maxRow.tempC),
            maxTempAtUtc: maxRow.obsTimeUtc,
            maxTempAtLocal: maxRow.obsTimeLocal,
          }
        : {}),
      ...(minRow
        ? {
            minTempC: minRow.tempC,
            minTempF: minRow.tempF ?? toFahrenheit(minRow.tempC),
            minTempAtUtc: minRow.obsTimeUtc,
            minTempAtLocal: minRow.obsTimeLocal,
          }
        : {}),
      updatedAt: generatedAt,
    };
    const existingSummary = await ctx.db
      .query("seoulAmosDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .first();
    let summaryId;
    if (existingSummary) {
      await ctx.db.patch(existingSummary._id, summaryFields);
      summaryId = existingSummary._id;
    } else {
      summaryId = await ctx.db.insert("seoulAmosDailySummaries", summaryFields);
    }
    const summary = await ctx.db.get(summaryId);

    const captures = await ctx.db
      .query("seoulForecastCaptures")
      .withIndex("by_station_capturedAt", (query) =>
        query.eq("stationIcao", args.stationIcao),
      )
      .order("desc")
      .take(MAX_FORECAST_CAPTURES_FOR_DAY);
    const weathercomCapture = selectLatestUsableWeatherComCapture({
      captures,
      targetDate: args.date,
      generatedAt,
    });
    const weathercomHourlyRows = mergeWeatherComHourlyRows(captures, args.date);
    const primaryCapture = weathercomCapture;
    const previousPrediction = await ctx.db
      .query("seoulHighPredictions")
      .withIndex("by_station_date_revision", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("targetDate", args.date),
      )
      .order("desc")
      .first();
    const observationAgeMinutes = latestRow
      ? roundToTenth(
          Math.max(0, generatedAt - latestRow.obsTimeUtc) / MILLIS_PER_MINUTE,
        )
      : null;
    const liveLatestRow =
      targetIsToday &&
      latestRow &&
      generatedAt - latestRow.obsTimeUtc <= MAX_LIVE_OBSERVATION_AGE_MS &&
      latestRow.obsTimeUtc <= generatedAt + 2 * MILLIS_PER_MINUTE
        ? latestRow
        : null;

    const weathercom = buildWeatherComProvider({
      capture: weathercomCapture,
      hourlyRows: weathercomHourlyRows,
      targetDate: args.date,
      targetIsToday,
      generatedAt,
    });
    const providerDetails = [weathercom.detail];
    const preferredDailyPeakProvider =
      selectPreferredDailyPeakProvider(providerDetails);
    const previousPreferredDailyPeakProvider = selectPreferredDailyPeakProvider(
      previousPrediction?.providerDetails ?? [],
    );
    const hourlyEnsembleCurve =
      weathercom.detail.weight > 0
        ? buildHourlyEnsembleCurve([
            {
              rows: weathercom.rows,
              weight: weathercom.detail.weight,
            },
          ])
        : [];

    const expectedCurrentC = weathercom.expectedCurrentC;
    const ensemblePeak = findHighestForecastRow(
      hourlyEnsembleCurve,
      generatedAt,
      targetIsToday,
    );
    let forecastHighC = weathercom.adjustedHighC;
    if (
      !Number.isFinite(forecastHighC) &&
      previousPrediction?.modelVersion === PREDICTION_MODEL_VERSION
    ) {
      forecastHighC = previousPrediction.predictedHighC;
    }
    if (!Number.isFinite(forecastHighC) && maxRow) {
      forecastHighC = maxRow.tempC;
    }
    if (!Number.isFinite(forecastHighC)) {
      throw new Error(
        `No provider forecast or RKSI 15L observation is available for ${args.date}.`,
      );
    }

    const predictedHighC = roundToTenth(
      Math.max(forecastHighC, maxRow?.tempC ?? Number.NEGATIVE_INFINITY),
    );
    const predictedHighF = toFahrenheit(predictedHighC);
    const providerHighs = providerDetails
      .map((provider) => provider.adjustedHighC)
      .filter(Number.isFinite);
    const uncertaintyC = clamp(
      0.6 +
        standardDeviation(providerHighs) +
        (providerHighs.length < 2 ? 0.4 : 0) +
        (!liveLatestRow ? 0.3 : 0),
      0.7,
      2.5,
    );
    const confidenceLowC = roundToTenth(
      Math.max(
        predictedHighC - uncertaintyC,
        maxRow?.tempC ?? Number.NEGATIVE_INFINITY,
      ),
    );
    const confidenceHighC = roundToTenth(predictedHighC + uncertaintyC);

    const futureForecastHighC = ensemblePeak?.tempC ?? null;
    const observedSetsPeak =
      maxRow &&
      (!ensemblePeak || maxRow.tempC >= ensemblePeak.tempC) &&
      predictedHighC === maxRow.tempC;
    const peakWindowStartUtc = observedSetsPeak
      ? Math.floor(maxRow.obsTimeUtc / MILLIS_PER_HOUR) * MILLIS_PER_HOUR
      : (ensemblePeak?.forecastTimeUtc ??
        Date.parse(`${args.date}T14:00:00+09:00`));
    const peakWindowEndUtc = Number.isFinite(peakWindowStartUtc)
      ? peakWindowStartUtc + MILLIS_PER_HOUR
      : null;

    const slope15mCPerHour = calculateSlopeCPerHour(observations, 15);
    const slope30mCPerHour = calculateSlopeCPerHour(observations, 30);
    const slope60mCPerHour = calculateSlopeCPerHour(observations, 60);
    const state = predictionState({
      previousPrediction,
      predictedHighC,
      observedHighC: maxRow?.tempC,
      observedCurrentC: liveLatestRow?.tempC,
      expectedCurrentC,
      slope60mCPerHour,
      generatedAt,
      peakWindowEndUtc,
      futureForecastHighC,
    });
    const materialChange =
      !previousPrediction ||
      previousPrediction.modelVersion !== PREDICTION_MODEL_VERSION ||
      Math.abs(
        roundToTenth(previousPrediction.predictedHighC - predictedHighC),
      ) >= 0.1 ||
      previousPrediction.status !== state.status ||
      previousPrediction.peakWindowStartUtc !== peakWindowStartUtc ||
      previousPrediction.peakWindowEndUtc !== peakWindowEndUtc ||
      previousPreferredDailyPeakProvider?.provider !==
        preferredDailyPeakProvider?.provider ||
      previousPreferredDailyPeakProvider?.dailyHighC !==
        preferredDailyPeakProvider?.dailyHighC ||
      previousPreferredDailyPeakProvider?.dailyPeakTimeUtc !==
        preferredDailyPeakProvider?.dailyPeakTimeUtc ||
      previousPrediction.observedHighC !== maxRow?.tempC ||
      (Number.isFinite(previousPrediction.observedCurrentC) &&
      Number.isFinite(latestRow?.tempC)
        ? Math.abs(
            roundToTenth(previousPrediction.observedCurrentC - latestRow.tempC),
          ) >= 0.2
        : previousPrediction.observedCurrentC !== latestRow?.tempC) ||
      String(previousPrediction.forecastCaptureId ?? "") !==
        String(primaryCapture?._id ?? "") ||
      generatedAt - previousPrediction.generatedAt >= PREDICTION_HEARTBEAT_MS;
    if (!materialChange) {
      return { prediction: previousPrediction, summary };
    }

    const revision = (previousPrediction?.revision ?? 0) + 1;
    const predictionId = await ctx.db.insert("seoulHighPredictions", {
      stationIcao: args.stationIcao,
      targetDate: args.date,
      revision,
      evaluationSlotUtc,
      modelVersion: PREDICTION_MODEL_VERSION,
      generatedAt,
      generatedAtLocal,
      ...(primaryCapture
        ? {
            forecastCaptureId: primaryCapture._id,
            forecastCapturedAt: primaryCapture.capturedAt,
            forecastAgeMinutes: roundToTenth(
              Math.max(0, generatedAt - primaryCapture.capturedAt) /
                MILLIS_PER_MINUTE,
            ),
          }
        : {}),
      ...(previousPrediction
        ? { previousPredictionId: previousPrediction._id }
        : {}),
      observedCount: observations.length,
      ...(latestRow
        ? {
            observedCurrentC: latestRow.tempC,
            observedCurrentF: latestRow.tempF ?? toFahrenheit(latestRow.tempC),
            observedCurrentAtUtc: latestRow.obsTimeUtc,
            observedCurrentAtLocal: latestRow.obsTimeLocal,
            observationAgeMinutes,
          }
        : {}),
      ...(maxRow
        ? {
            observedHighC: maxRow.tempC,
            observedHighF: maxRow.tempF ?? toFahrenheit(maxRow.tempC),
            observedHighAtUtc: maxRow.obsTimeUtc,
            observedHighAtLocal: maxRow.obsTimeLocal,
          }
        : {}),
      ...(Number.isFinite(slope15mCPerHour) ? { slope15mCPerHour } : {}),
      ...(Number.isFinite(slope30mCPerHour) ? { slope30mCPerHour } : {}),
      ...(Number.isFinite(slope60mCPerHour) ? { slope60mCPerHour } : {}),
      ...(Number.isFinite(expectedCurrentC)
        ? { expectedCurrentC: roundToTenth(expectedCurrentC) }
        : {}),
      predictedHighC,
      predictedHighF,
      confidenceLowC,
      confidenceLowF: toFahrenheit(confidenceLowC),
      confidenceHighC,
      confidenceHighF: toFahrenheit(confidenceHighC),
      ...(Number.isFinite(peakWindowStartUtc)
        ? {
            peakWindowStartUtc,
            peakWindowStartLocal: formatDateTimeInTimezone(
              peakWindowStartUtc,
              SEOUL_TIMEZONE,
            ),
          }
        : {}),
      ...(Number.isFinite(peakWindowEndUtc)
        ? {
            peakWindowEndUtc,
            peakWindowEndLocal: formatDateTimeInTimezone(
              peakWindowEndUtc,
              SEOUL_TIMEZONE,
            ),
          }
        : {}),
      status: state.status,
      reason: state.reason,
      providerDetails,
      hourlyEnsembleCurve,
      createdAt: generatedAt,
    });
    return {
      prediction: await ctx.db.get(predictionId),
      summary,
    };
  },
});

export const recomputeTodayHighPrediction = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(
      args.stationIcao ?? SEOUL_STATION.stationIcao,
    ).toUpperCase();
    if (stationIcao !== SEOUL_STATION.stationIcao) {
      throw new Error("The Seoul high predictor currently supports RKSI only.");
    }
    const date = args.date ?? formatDateInTimezone(Date.now(), SEOUL_TIMEZONE);
    assertDateKey(date);
    const todayDate = formatDateInTimezone(Date.now(), SEOUL_TIMEZONE);
    if (date !== todayDate) {
      throw new Error(
        `recomputeTodayHighPrediction only accepts Seoul today (${todayDate}).`,
      );
    }
    const result = await ctx.runMutation(
      "seoulWeather:recomputeHighPredictionInternal",
      { stationIcao, date },
    );
    return result.prediction;
  },
});

function summarizeEvaluations(evaluations) {
  const initialErrors = evaluations
    .map((row) => row.initialErrorC)
    .filter(Number.isFinite);
  const finalErrors = evaluations
    .map((row) => row.finalErrorC)
    .filter(Number.isFinite);
  const peakRows = evaluations.filter(
    (row) => typeof row.peakWindowHit === "boolean",
  );
  const buildMetrics = (errors) => {
    if (!errors.length) {
      return {
        sampleSize: 0,
        maeC: null,
        meanBiasC: null,
        within1CPct: null,
      };
    }
    return {
      sampleSize: errors.length,
      maeC: roundToTenth(
        errors.reduce((total, error) => total + Math.abs(error), 0) /
          errors.length,
      ),
      meanBiasC: roundToTenth(
        errors.reduce((total, error) => total + error, 0) / errors.length,
      ),
      within1CPct: roundToTenth(
        (errors.filter((error) => Math.abs(error) <= 1).length /
          errors.length) *
          100,
      ),
    };
  };
  const checkpointMetrics = [9, 12, 15].map((localHour) => {
    const checkpoints = evaluations
      .map((row) =>
        row.checkpoints?.find(
          (checkpoint) => checkpoint.localHour === localHour,
        ),
      )
      .filter(Boolean);
    const errors = checkpoints
      .map((checkpoint) => checkpoint?.errorC)
      .filter(Number.isFinite);
    const peakChecks = checkpoints.filter(
      (checkpoint) => typeof checkpoint.peakWindowHit === "boolean",
    );
    return {
      localHour,
      ...buildMetrics(errors),
      peakWindowSampleSize: peakChecks.length,
      peakWindowHitPct: peakChecks.length
        ? roundToTenth(
            (peakChecks.filter((checkpoint) => checkpoint.peakWindowHit)
              .length /
              peakChecks.length) *
              100,
          )
        : null,
    };
  });
  return {
    completedDayCount: evaluations.length,
    initial: buildMetrics(initialErrors),
    checkpoints: checkpointMetrics,
    // Lifecycle diagnostic only: the observed-high invariant makes this a
    // closing tracker, not an independent forecast-skill measurement.
    closingTracker: buildMetrics(finalErrors),
    closingPeakWindowSampleSize: peakRows.length,
    closingPeakWindowHitPct: peakRows.length
      ? roundToTenth(
          (peakRows.filter((row) => row.peakWindowHit).length /
            peakRows.length) *
            100,
        )
      : null,
  };
}

export const finalizeHighPredictionInternal = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    assertDateKey(args.date);
    const todayDate = formatDateInTimezone(Date.now(), SEOUL_TIMEZONE);
    if (args.date >= todayDate) {
      throw new Error("Only completed Seoul-local dates can be finalized.");
    }

    const existingEvaluation = await ctx.db
      .query("seoulHighEvaluations")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("targetDate", args.date),
      )
      .first();
    if (existingEvaluation) {
      return existingEvaluation;
    }

    const rawObservations = await ctx.db
      .query("seoulAmosObservations")
      .withIndex("by_station_date_rwy_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("date", args.date)
          .eq("rwyNo", RKSI_REPRESENTATIVE_RUNWAY_NO)
          .eq("rwyDir", RKSI_REPRESENTATIVE_RUNWAY_DIRECTION),
      )
      .collect();
    const observations = canonicalizeRepresentativeAmosRows(rawObservations);
    const maxRow = selectExtremeRow(observations, "max");
    if (!maxRow) {
      throw new Error(
        `Cannot finalize ${args.date}: no canonical RKSI 15L AMOS temperatures.`,
      );
    }
    const firstRow = observations[0];
    const latestRow = observations[observations.length - 1];
    const minRow = selectExtremeRow(observations, "min");
    const oneMinuteObsCount = observations.filter(
      (row) => row.collectionCadence === "one_minute",
    ).length;
    const summaryFields = {
      stationIcao: args.stationIcao,
      date: args.date,
      rwyNo: RKSI_REPRESENTATIVE_RUNWAY_NO,
      rwyDir: RKSI_REPRESENTATIVE_RUNWAY_DIRECTION,
      obsCount: observations.length,
      oneMinuteObsCount,
      fallbackObsCount: observations.length - oneMinuteObsCount,
      firstObsTimeUtc: firstRow.obsTimeUtc,
      firstObsTimeLocal: firstRow.obsTimeLocal,
      latestObsTimeUtc: latestRow.obsTimeUtc,
      latestObsTimeLocal: latestRow.obsTimeLocal,
      latestTempC: latestRow.tempC,
      latestTempF: latestRow.tempF ?? toFahrenheit(latestRow.tempC),
      maxTempC: maxRow.tempC,
      maxTempF: maxRow.tempF ?? toFahrenheit(maxRow.tempC),
      maxTempAtUtc: maxRow.obsTimeUtc,
      maxTempAtLocal: maxRow.obsTimeLocal,
      minTempC: minRow.tempC,
      minTempF: minRow.tempF ?? toFahrenheit(minRow.tempC),
      minTempAtUtc: minRow.obsTimeUtc,
      minTempAtLocal: minRow.obsTimeLocal,
      updatedAt: Date.now(),
    };
    const existingSummary = await ctx.db
      .query("seoulAmosDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .first();
    if (existingSummary) {
      await ctx.db.patch(existingSummary._id, summaryFields);
    } else {
      await ctx.db.insert("seoulAmosDailySummaries", summaryFields);
    }

    const predictions = await ctx.db
      .query("seoulHighPredictions")
      .withIndex("by_station_date_revision", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("targetDate", args.date),
      )
      .collect();
    predictions.sort((a, b) => a.revision - b.revision);
    const initialPrediction = predictions[0] ?? null;
    const finalPrediction = predictions[predictions.length - 1] ?? null;
    const initialErrorC = initialPrediction
      ? roundToTenth(initialPrediction.predictedHighC - maxRow.tempC)
      : null;
    const finalErrorC = finalPrediction
      ? roundToTenth(finalPrediction.predictedHighC - maxRow.tempC)
      : null;
    const checkpoints = [9, 12, 15].map((localHour) => {
      const hour = String(localHour).padStart(2, "0");
      const cutoffAtUtc = Date.parse(`${args.date}T${hour}:00:00+09:00`);
      const eligible = predictions.filter(
        (prediction) => prediction.generatedAt <= cutoffAtUtc,
      );
      const prediction = eligible[eligible.length - 1] ?? null;
      const errorC = prediction
        ? roundToTenth(prediction.predictedHighC - maxRow.tempC)
        : null;
      const checkpointPeakHit =
        prediction &&
        Number.isFinite(prediction.peakWindowStartUtc) &&
        Number.isFinite(prediction.peakWindowEndUtc)
          ? maxRow.obsTimeUtc >= prediction.peakWindowStartUtc &&
            maxRow.obsTimeUtc < prediction.peakWindowEndUtc
          : null;
      return {
        localHour,
        cutoffAtUtc,
        cutoffAtLocal: formatDateTimeInTimezone(cutoffAtUtc, SEOUL_TIMEZONE),
        ...(prediction
          ? {
              predictionId: prediction._id,
              predictedHighC: prediction.predictedHighC,
              predictedHighF: prediction.predictedHighF,
              errorC,
              absoluteErrorC: Math.abs(errorC),
              ...(Number.isFinite(prediction.peakWindowStartUtc)
                ? { peakWindowStartUtc: prediction.peakWindowStartUtc }
                : {}),
              ...(Number.isFinite(prediction.peakWindowEndUtc)
                ? { peakWindowEndUtc: prediction.peakWindowEndUtc }
                : {}),
              ...(typeof checkpointPeakHit === "boolean"
                ? { peakWindowHit: checkpointPeakHit }
                : {}),
            }
          : {}),
      };
    });
    const peakWindowHit =
      finalPrediction &&
      Number.isFinite(finalPrediction.peakWindowStartUtc) &&
      Number.isFinite(finalPrediction.peakWindowEndUtc)
        ? maxRow.obsTimeUtc >= finalPrediction.peakWindowStartUtc &&
          maxRow.obsTimeUtc < finalPrediction.peakWindowEndUtc
        : null;
    const finalizedAt = Date.now();
    const evaluationId = await ctx.db.insert("seoulHighEvaluations", {
      stationIcao: args.stationIcao,
      targetDate: args.date,
      finalizedAt,
      finalizedAtLocal: formatDateTimeInTimezone(finalizedAt, SEOUL_TIMEZONE),
      actualHighC: maxRow.tempC,
      actualHighF: maxRow.tempF ?? toFahrenheit(maxRow.tempC),
      actualHighAtUtc: maxRow.obsTimeUtc,
      actualHighAtLocal: maxRow.obsTimeLocal,
      obsCount: observations.length,
      ...(initialPrediction
        ? {
            initialPredictionId: initialPrediction._id,
            initialPredictedHighC: initialPrediction.predictedHighC,
            initialPredictedHighF: initialPrediction.predictedHighF,
            initialErrorC,
            initialAbsoluteErrorC: Math.abs(initialErrorC),
          }
        : {}),
      ...(finalPrediction
        ? {
            finalPredictionId: finalPrediction._id,
            finalPredictedHighC: finalPrediction.predictedHighC,
            finalPredictedHighF: finalPrediction.predictedHighF,
            finalErrorC,
            finalAbsoluteErrorC: Math.abs(finalErrorC),
            ...(Number.isFinite(finalPrediction.peakWindowStartUtc)
              ? {
                  finalPeakWindowStartUtc: finalPrediction.peakWindowStartUtc,
                }
              : {}),
            ...(Number.isFinite(finalPrediction.peakWindowEndUtc)
              ? {
                  finalPeakWindowEndUtc: finalPrediction.peakWindowEndUtc,
                }
              : {}),
            ...(typeof peakWindowHit === "boolean" ? { peakWindowHit } : {}),
          }
        : {}),
      checkpoints,
      revisionCount: predictions.length,
      createdAt: finalizedAt,
    });
    return await ctx.db.get(evaluationId);
  },
});

export const finalizeCompletedDay = internalActionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(
      args.stationIcao ?? SEOUL_STATION.stationIcao,
    ).toUpperCase();
    if (stationIcao !== SEOUL_STATION.stationIcao) {
      throw new Error("The Seoul high evaluator currently supports RKSI only.");
    }
    const todayDate = formatDateInTimezone(Date.now(), SEOUL_TIMEZONE);
    const date = args.date ?? addUtcDays(todayDate, -1);
    assertDateKey(date);
    return await ctx.runMutation(
      "seoulWeather:finalizeHighPredictionInternal",
      { stationIcao, date },
    );
  },
});

export const getHighPredictionAccuracy = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    trailingDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(
      args.stationIcao ?? SEOUL_STATION.stationIcao,
    ).toUpperCase();
    const trailingDays = clamp(Math.trunc(args.trailingDays ?? 30), 1, 365);
    const todayDate = formatDateInTimezone(Date.now(), SEOUL_TIMEZONE);
    const earliestDate = addUtcDays(todayDate, -trailingDays);
    const rows = await ctx.db
      .query("seoulHighEvaluations")
      .withIndex("by_station_finalizedAt", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .order("desc")
      .take(365);
    const evaluations = rows.filter(
      (row) => row.targetDate >= earliestDate && row.targetDate < todayDate,
    );
    return {
      stationIcao,
      trailingDays,
      earliestDate,
      todayDate,
      ...summarizeEvaluations(evaluations),
      evaluations,
    };
  },
});

function toWeatherComOnlyPagePrediction(prediction) {
  if (!prediction) {
    return null;
  }
  return {
    ...prediction,
    providerDetails: (prediction.providerDetails ?? []).filter(
      (provider) => provider.provider === "weathercom",
    ),
    hourlyEnsembleCurve:
      prediction.modelVersion === PREDICTION_MODEL_VERSION
        ? prediction.hourlyEnsembleCurve
        : [],
  };
}

function toFahrenheitDelta(celsiusDelta) {
  return roundToTenth((celsiusDelta * 9) / 5);
}

function departureStatus(departureC) {
  if (departureC >= 0.5) {
    return "running_warm";
  }
  if (departureC <= -0.5) {
    return "running_cool";
  }
  return "on_track";
}

function summarizeWeatherComDepartures(points, departureField) {
  const allMatched = points.filter((point) =>
    Number.isFinite(point[departureField]),
  );
  const matched = allMatched.slice(-3);
  const bias =
    matched.length > 0
      ? roundToTenth(median(matched.map((point) => point[departureField])))
      : null;
  return {
    status: matched.length >= 2 ? departureStatus(bias) : "insufficient_data",
    sampleCount: matched.length,
    matchedCount: allMatched.length,
    ...(Number.isFinite(bias)
      ? {
          biasC: bias,
          biasF: toFahrenheitDelta(bias),
          fromAtLocal: matched[0].forecastTimeLocal,
          toAtLocal: matched[matched.length - 1].forecastTimeLocal,
        }
      : {}),
  };
}

function findNearestAmosObservation(observations, targetTimeUtc) {
  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const observation of observations) {
    const distance = Math.abs(observation.obsTimeUtc - targetTimeUtc);
    if (
      distance < nearestDistance ||
      (distance === nearestDistance &&
        observation.obsTimeUtc < (nearest?.obsTimeUtc ?? Infinity))
    ) {
      nearest = observation;
      nearestDistance = distance;
    }
    if (observation.obsTimeUtc > targetTimeUtc && distance > nearestDistance) {
      break;
    }
  }
  return nearestDistance <= 5 * MILLIS_PER_MINUTE ? nearest : null;
}

function sameForecastCapture(left, right) {
  return (
    left &&
    right &&
    String(left.forecastCaptureId) === String(right.forecastCaptureId)
  );
}

function selectPeakDiagnosticPoint(points, tempField) {
  let peak = null;
  for (const point of points) {
    if (!Number.isFinite(point[tempField])) {
      continue;
    }
    if (
      !peak ||
      point[tempField] > peak[tempField] ||
      (point[tempField] === peak[tempField] &&
        point.forecastTimeUtc < peak.forecastTimeUtc)
    ) {
      peak = point;
    }
  }
  return peak;
}

function weatherComHourlyHealth({
  targetDate,
  todayDate,
  latestForecastCapture,
  latestSuccessfulCapture,
  now,
}) {
  if (targetDate < todayDate) {
    return {};
  }
  const latestAttemptStatus =
    latestForecastCapture?.weathercomHourlyStatus ?? "missing";
  const latestAttemptedAt =
    latestForecastCapture?.weathercomHourlyCapturedAt ??
    latestForecastCapture?.capturedAt;
  const latestAttemptedAtLocal =
    latestForecastCapture?.weathercomHourlyCapturedAtLocal ??
    latestForecastCapture?.capturedAtLocal;
  const latestAttemptAgeMinutes = Number.isFinite(latestAttemptedAt)
    ? roundToTenth(Math.max(0, now - latestAttemptedAt) / MILLIS_PER_MINUTE)
    : null;
  const latestSuccessAgeMinutes = latestSuccessfulCapture
    ? roundToTenth(
        Math.max(0, now - latestSuccessfulCapture.capturedAt) /
          MILLIS_PER_MINUTE,
      )
    : null;
  const isStale =
    latestAttemptStatus === WEATHER_STATUS.ERROR ||
    !Number.isFinite(latestAttemptedAt) ||
    now - latestAttemptedAt > WEATHERCOM_HISTORY_STALE_MS;
  return {
    latestAttemptStatus,
    ...(latestForecastCapture?.weathercomHourlyError
      ? {
          latestAttemptError: latestForecastCapture.weathercomHourlyError,
        }
      : {}),
    ...(Number.isFinite(latestAttemptedAt)
      ? {
          latestAttemptedAt,
          latestAttemptedAtLocal,
        }
      : {}),
    ...(Number.isFinite(latestSuccessAgeMinutes)
      ? { latestSuccessAgeMinutes }
      : {}),
    ...(Number.isFinite(latestAttemptAgeMinutes)
      ? { latestAttemptAgeMinutes }
      : {}),
    isStale,
  };
}

function buildWeatherComHourlyDiagnostics({
  predictionRows,
  adjacentPredictionRows,
  rawObservations,
  targetDate,
  todayDate,
  latestForecastCapture,
  now,
}) {
  const emptyRunningBaseline = summarizeWeatherComDepartures(
    [],
    "departureBaselineC",
  );
  const emptyRunningPreHour = summarizeWeatherComDepartures(
    [],
    "departurePreHourC",
  );
  if (!predictionRows.length) {
    const health = weatherComHourlyHealth({
      targetDate,
      todayDate,
      latestForecastCapture,
      latestSuccessfulCapture: null,
      now,
    });
    return {
      status: WEATHER_STATUS.ERROR,
      error:
        health.latestAttemptError ??
        `No Weather.com hourly forecast history has been captured for ${targetDate}.`,
      points: [],
      runningBaseline: emptyRunningBaseline,
      runningPreHour: emptyRunningPreHour,
      peak: null,
      ...health,
    };
  }

  const observations = canonicalizeRepresentativeAmosRows(rawObservations);
  const orderedRows = [...predictionRows].sort(
    (left, right) =>
      left.capturedAt - right.capturedAt ||
      left.forecastTimeUtc - right.forecastTimeUtc ||
      left.createdAt - right.createdAt,
  );
  const liveOrderedRows = [
    ...orderedRows,
    ...(adjacentPredictionRows ?? []),
  ].sort(
    (left, right) =>
      left.capturedAt - right.capturedAt ||
      left.forecastTimeUtc - right.forecastTimeUtc ||
      left.createdAt - right.createdAt,
  );
  const captureById = new Map();
  for (const row of orderedRows) {
    const captureKey = String(row.forecastCaptureId);
    if (!captureById.has(captureKey)) {
      captureById.set(captureKey, {
        forecastCaptureId: row.forecastCaptureId,
        capturedAt: row.capturedAt,
        capturedAtLocal: row.capturedAtLocal,
      });
    }
  }
  const captures = Array.from(captureById.values()).sort(
    (left, right) => left.capturedAt - right.capturedAt,
  );
  const fiveAmLocal = Date.parse(`${targetDate}T05:00:00+09:00`);
  const morningWindowStart = fiveAmLocal - WEATHERCOM_BASELINE_WINDOW_MS;
  const morningWindowEnd = fiveAmLocal + WEATHERCOM_BASELINE_WINDOW_MS;
  const baselineCapture =
    captures.find(
      (capture) =>
        capture.capturedAt >= fiveAmLocal &&
        capture.capturedAt <= morningWindowEnd,
    ) ??
    [...captures]
      .reverse()
      .find(
        (capture) =>
          capture.capturedAt < fiveAmLocal &&
          capture.capturedAt >= morningWindowStart,
      ) ??
    null;
  const latestCapture = captures[captures.length - 1] ?? null;
  const health = weatherComHourlyHealth({
    targetDate,
    todayDate,
    latestForecastCapture,
    latestSuccessfulCapture: latestCapture,
    now,
  });

  const rowsByForecastTime = new Map();
  for (const row of orderedRows) {
    let history = rowsByForecastTime.get(row.forecastTimeUtc);
    if (!history) {
      history = [];
      rowsByForecastTime.set(row.forecastTimeUtc, history);
    }
    const duplicateIndex = history.findIndex(
      (existing) =>
        existing.capturedAt === row.capturedAt &&
        sameForecastCapture(existing, row),
    );
    if (duplicateIndex >= 0) {
      history[duplicateIndex] = row;
    } else {
      history.push(row);
    }
  }

  const points = Array.from(rowsByForecastTime.values())
    .map((history) => {
      history.sort(
        (left, right) =>
          left.capturedAt - right.capturedAt ||
          left.createdAt - right.createdAt,
      );
      const latest = history[history.length - 1];
      let latestRunStartIndex = history.length - 1;
      while (
        latestRunStartIndex > 0 &&
        history[latestRunStartIndex - 1].tempC === latest.tempC
      ) {
        latestRunStartIndex -= 1;
      }
      const latestRunStart = history[latestRunStartIndex];
      const previousDistinct =
        latestRunStartIndex > 0 ? history[latestRunStartIndex - 1] : null;
      const baseline =
        baselineCapture && baselineCapture.capturedAt < latest.forecastTimeUtc
          ? (history.find((row) => sameForecastCapture(row, baselineCapture)) ??
            null)
          : null;
      const preHour =
        [...history]
          .reverse()
          .find((row) => row.capturedAt < latest.forecastTimeUtc) ?? null;
      const actual =
        latest.forecastTimeUtc <= now
          ? findNearestAmosObservation(observations, latest.forecastTimeUtc)
          : null;
      const revisionDeltaC = previousDistinct
        ? roundToTenth(latest.tempC - previousDistinct.tempC)
        : null;
      const departureBaselineC =
        actual && baseline ? roundToTenth(actual.tempC - baseline.tempC) : null;
      const departurePreHourC =
        actual && preHour ? roundToTenth(actual.tempC - preHour.tempC) : null;

      return {
        forecastTimeUtc: latest.forecastTimeUtc,
        forecastTimeLocal: latest.forecastTimeLocal,
        latestTempC: latest.tempC,
        latestTempF: latest.tempF,
        latestCapturedAt: latest.capturedAt,
        latestCapturedAtLocal: latest.capturedAtLocal,
        latestForecastCaptureId: latest.forecastCaptureId,
        ...(latest.phrase
          ? { phrase: latest.phrase, latestPhrase: latest.phrase }
          : {}),
        ...(Number.isFinite(latest.cloudCoverPct)
          ? {
              cloudCoverPct: latest.cloudCoverPct,
              latestCloudCoverPct: latest.cloudCoverPct,
            }
          : {}),
        ...(baseline
          ? {
              baselineTempC: baseline.tempC,
              baselineTempF: baseline.tempF,
              baselineCapturedAt: baseline.capturedAt,
              baselineCapturedAtLocal: baseline.capturedAtLocal,
              baselineForecastCaptureId: baseline.forecastCaptureId,
            }
          : {}),
        ...(previousDistinct
          ? {
              previousDistinctTempC: previousDistinct.tempC,
              previousDistinctTempF: previousDistinct.tempF,
              previousDistinctCapturedAt: previousDistinct.capturedAt,
              previousDistinctCapturedAtLocal: previousDistinct.capturedAtLocal,
              revisionDeltaC,
              revisionDeltaF: toFahrenheitDelta(revisionDeltaC),
              revisionDetectedAt: latestRunStart.capturedAt,
              revisionDetectedAtLocal: latestRunStart.capturedAtLocal,
            }
          : {}),
        ...(preHour
          ? {
              preHourTempC: preHour.tempC,
              preHourTempF: preHour.tempF,
              ...(Number.isFinite(preHour.cloudCoverPct)
                ? { preHourCloudCoverPct: preHour.cloudCoverPct }
                : {}),
              preHourCapturedAt: preHour.capturedAt,
              preHourCapturedAtLocal: preHour.capturedAtLocal,
              preHourForecastCaptureId: preHour.forecastCaptureId,
            }
          : {}),
        ...(actual
          ? {
              actualTempC: actual.tempC,
              actualTempF: actual.tempF ?? toFahrenheit(actual.tempC),
              actualAtUtc: actual.obsTimeUtc,
              actualAtLocal: actual.obsTimeLocal,
              ...(actual.collectionCadence
                ? {
                    actualCollectionCadence: actual.collectionCadence,
                  }
                : {}),
            }
          : {}),
        ...(Number.isFinite(departureBaselineC)
          ? {
              departureBaselineC,
              departureBaselineF: toFahrenheitDelta(departureBaselineC),
            }
          : {}),
        ...(Number.isFinite(departurePreHourC)
          ? {
              departurePreHourC,
              departurePreHourF: toFahrenheitDelta(departurePreHourC),
            }
          : {}),
      };
    })
    .sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc);

  const runningBaseline = summarizeWeatherComDepartures(
    points,
    "departureBaselineC",
  );
  const runningPreHour = summarizeWeatherComDepartures(
    points,
    "departurePreHourC",
  );
  const latestPeak = selectPeakDiagnosticPoint(points, "latestTempC");
  const baselinePeak = selectPeakDiagnosticPoint(points, "baselineTempC");
  const peakDeltaC =
    latestPeak && baselinePeak
      ? roundToTenth(latestPeak.latestTempC - baselinePeak.baselineTempC)
      : null;
  const peak = latestPeak
    ? {
        latestTempC: latestPeak.latestTempC,
        latestTempF: latestPeak.latestTempF,
        latestForecastTimeUtc: latestPeak.forecastTimeUtc,
        latestForecastTimeLocal: latestPeak.forecastTimeLocal,
        latestCapturedAt: latestPeak.latestCapturedAt,
        latestCapturedAtLocal: latestPeak.latestCapturedAtLocal,
        ...(baselinePeak
          ? {
              baselineTempC: baselinePeak.baselineTempC,
              baselineTempF: baselinePeak.baselineTempF,
              baselineForecastTimeUtc: baselinePeak.forecastTimeUtc,
              baselineForecastTimeLocal: baselinePeak.forecastTimeLocal,
              baselineCapturedAt: baselinePeak.baselineCapturedAt,
              baselineCapturedAtLocal: baselinePeak.baselineCapturedAtLocal,
            }
          : {}),
        ...(Number.isFinite(peakDeltaC)
          ? {
              deltaC: peakDeltaC,
              deltaF: toFahrenheitDelta(peakDeltaC),
            }
          : {}),
      }
    : null;

  let live = null;
  const latestObservation = observations[observations.length - 1] ?? null;
  if (
    targetDate === todayDate &&
    latestObservation &&
    now - latestObservation.obsTimeUtc <= MAX_LIVE_OBSERVATION_AGE_MS &&
    latestObservation.obsTimeUtc <= now + 2 * MILLIS_PER_MINUTE
  ) {
    let liveForecastCapture = null;
    let liveForecastC = null;
    for (const capture of [...captures].reverse()) {
      if (capture.capturedAt >= latestObservation.obsTimeUtc) {
        continue;
      }
      const curve = liveOrderedRows.filter((row) =>
        sameForecastCapture(row, capture),
      );
      const candidate = interpolateBracketedHourlyTemperature(
        curve,
        latestObservation.obsTimeUtc,
      );
      if (Number.isFinite(candidate)) {
        liveForecastCapture = capture;
        liveForecastC = candidate;
        break;
      }
    }
    if (Number.isFinite(liveForecastC)) {
      const departureC = roundToTenth(latestObservation.tempC - liveForecastC);
      const forecastTempC = roundToTenth(liveForecastC);
      live = {
        status: departureStatus(departureC),
        actualAtUtc: latestObservation.obsTimeUtc,
        actualAtLocal: latestObservation.obsTimeLocal,
        actualTempC: latestObservation.tempC,
        actualTempF:
          latestObservation.tempF ?? toFahrenheit(latestObservation.tempC),
        ...(latestObservation.collectionCadence
          ? {
              actualCollectionCadence: latestObservation.collectionCadence,
            }
          : {}),
        forecastTempC,
        forecastTempF: toFahrenheit(forecastTempC),
        departureC,
        departureF: toFahrenheitDelta(departureC),
        forecastCapturedAt: liveForecastCapture.capturedAt,
        forecastCapturedAtLocal: liveForecastCapture.capturedAtLocal,
      };
    }
  }

  return {
    status: health.isStale ? "stale" : WEATHER_STATUS.OK,
    captureCount: captures.length,
    pointCount: points.length,
    ...health,
    ...(baselineCapture
      ? {
          baselineCapturedAt: baselineCapture.capturedAt,
          baselineCapturedAtLocal: baselineCapture.capturedAtLocal,
          baselineForecastCaptureId: baselineCapture.forecastCaptureId,
          baselineSelection:
            baselineCapture.capturedAt >= fiveAmLocal
              ? "first_at_or_after_05:00"
              : "latest_before_05:00",
          baselineCapture,
        }
      : {}),
    ...(latestCapture
      ? {
          latestCapturedAt: latestCapture.capturedAt,
          latestCapturedAtLocal: latestCapture.capturedAtLocal,
          latestForecastCaptureId: latestCapture.forecastCaptureId,
          latestCapture,
        }
      : {}),
    points,
    runningBaseline,
    runningPreHour,
    peak,
    ...(live
      ? {
          live,
          liveLatestCurveDeviation: live,
        }
      : {}),
  };
}

export const getHighPredictionDashboard = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(
      args.stationIcao ?? SEOUL_STATION.stationIcao,
    ).toUpperCase();
    const now = Date.now();
    const todayDate = formatDateInTimezone(now, SEOUL_TIMEZONE);
    const date = args.date ?? todayDate;
    assertDateKey(date);
    const nextDate = addUtcDays(date, 1);
    const nextMidnightUtc = Date.parse(`${nextDate}T00:00:00+09:00`);

    const [
      summary,
      revisionRows,
      forecastCaptureRows,
      evaluation,
      accuracyRows,
      weathercomHourlyRows,
      adjacentWeathercomHourlyRows,
      recentWeathercomAmosObservations,
    ] = await Promise.all([
      ctx.db
        .query("seoulAmosDailySummaries")
        .withIndex("by_station_date", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .first(),
      ctx.db
        .query("seoulHighPredictions")
        .withIndex("by_station_date_revision", (query) =>
          query.eq("stationIcao", stationIcao).eq("targetDate", date),
        )
        .order("desc")
        .take(MAX_DASHBOARD_REVISIONS),
      ctx.db
        .query("seoulForecastCaptures")
        .withIndex("by_station_capturedAt", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .order("desc")
        .take(MAX_FORECAST_CAPTURES_FOR_DAY),
      ctx.db
        .query("seoulHighEvaluations")
        .withIndex("by_station_date", (query) =>
          query.eq("stationIcao", stationIcao).eq("targetDate", date),
        )
        .first(),
      ctx.db
        .query("seoulHighEvaluations")
        .withIndex("by_station_finalizedAt", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .order("desc")
        .take(30),
      ctx.db
        .query("seoulHourlyForecastPredictions")
        .withIndex("by_station_provider_target_capturedAt", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("provider", "weathercom")
            .eq("targetDate", date),
        )
        .collect(),
      ctx.db
        .query("seoulHourlyForecastPredictions")
        .withIndex("by_station_provider_valid_capturedAt", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("provider", "weathercom")
            .eq("forecastTimeUtc", nextMidnightUtc),
        )
        .collect(),
      ctx.db
        .query("seoulAmosObservations")
        .withIndex("by_station_date_rwy_ts", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("date", date)
            .eq("rwyNo", RKSI_REPRESENTATIVE_RUNWAY_NO)
            .eq("rwyDir", RKSI_REPRESENTATIVE_RUNWAY_DIRECTION),
        )
        .order("desc")
        .take(32),
    ]);
    const weathercomForecastTimes = Array.from(
      new Set(
        weathercomHourlyRows
          .map((row) => row.forecastTimeUtc)
          .filter(Number.isFinite),
      ),
    );
    const weathercomObservationBuckets = await Promise.all(
      weathercomForecastTimes.map((forecastTimeUtc) =>
        ctx.db
          .query("seoulAmosObservations")
          .withIndex("by_station_date_rwy_ts", (query) =>
            query
              .eq("stationIcao", stationIcao)
              .eq("date", date)
              .eq("rwyNo", RKSI_REPRESENTATIVE_RUNWAY_NO)
              .eq("rwyDir", RKSI_REPRESENTATIVE_RUNWAY_DIRECTION)
              .gte("obsTimeUtc", forecastTimeUtc - 5 * MILLIS_PER_MINUTE)
              .lte("obsTimeUtc", forecastTimeUtc + 5 * MILLIS_PER_MINUTE),
          )
          .collect(),
      ),
    );
    const weathercomRawObservations = [
      ...weathercomObservationBuckets.flat(),
      ...recentWeathercomAmosObservations,
    ];
    const latestAttemptedForecastCapture = forecastCaptureRows[0] ?? null;
    const latestPrediction = toWeatherComOnlyPagePrediction(
      revisionRows[0] ?? null,
    );
    const revisions = [...revisionRows]
      .reverse()
      .map(toWeatherComOnlyPagePrediction);
    const latestWeatherComCapture = selectLatestUsableWeatherComCapture({
      captures: forecastCaptureRows,
      targetDate: date,
      generatedAt: now,
    });
    const mergedWeatherComHourlyRows = mergeWeatherComHourlyRows(
      forecastCaptureRows,
      date,
    );
    const latestForecastCapture = latestWeatherComCapture
      ? {
          _id: latestWeatherComCapture._id,
          _creationTime: latestWeatherComCapture._creationTime,
          stationIcao: latestWeatherComCapture.stationIcao,
          stationName: latestWeatherComCapture.stationName,
          capturedAt: latestWeatherComCapture.capturedAt,
          capturedAtLocal: latestWeatherComCapture.capturedAtLocal,
          captureDate: latestWeatherComCapture.captureDate,
          status: latestWeatherComCapture.status,
          weathercomStatus: latestWeatherComCapture.weathercomStatus,
          ...(latestWeatherComCapture.weathercomError
            ? { weathercomError: latestWeatherComCapture.weathercomError }
            : {}),
          weathercomForecastDays:
            latestWeatherComCapture.weathercomForecastDays,
          weathercomHourlyStatus:
            latestWeatherComCapture.weathercomHourlyStatus,
          ...(latestWeatherComCapture.weathercomHourlyError
            ? {
                weathercomHourlyError:
                  latestWeatherComCapture.weathercomHourlyError,
              }
            : {}),
          ...(Number.isFinite(
            latestWeatherComCapture.weathercomHourlyCapturedAt,
          )
            ? {
                weathercomHourlyCapturedAt:
                  latestWeatherComCapture.weathercomHourlyCapturedAt,
                weathercomHourlyCapturedAtLocal:
                  latestWeatherComCapture.weathercomHourlyCapturedAtLocal,
                weathercomHourlyCaptureDate:
                  latestWeatherComCapture.weathercomHourlyCaptureDate,
              }
            : {}),
          weathercomHourlyRows: mergedWeatherComHourlyRows,
        }
      : null;
    const weathercomHourlyDiagnostics = buildWeatherComHourlyDiagnostics({
      predictionRows: weathercomHourlyRows,
      adjacentPredictionRows: adjacentWeathercomHourlyRows,
      rawObservations: weathercomRawObservations,
      targetDate: date,
      todayDate,
      latestForecastCapture: latestAttemptedForecastCapture,
      now,
    });

    return {
      station: {
        stationIcao,
        stationName: SEOUL_STATION.stationName,
        lat: SEOUL_STATION.lat,
        lon: SEOUL_STATION.lon,
        timeZone: SEOUL_TIMEZONE,
        targetRwyNo: RKSI_REPRESENTATIVE_RUNWAY_NO,
        targetRwyDir: RKSI_REPRESENTATIVE_RUNWAY_DIRECTION,
      },
      stationIcao,
      stationName: SEOUL_STATION.stationName,
      date,
      todayDate,
      isToday: date === todayDate,
      summary,
      latestPrediction,
      revisions,
      latestForecastCapture,
      weathercomHourlyDiagnostics,
      evaluation,
      accuracy: summarizeEvaluations(accuracyRows),
    };
  },
});
