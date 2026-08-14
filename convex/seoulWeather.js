import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import {
  DECISION_INTERVAL_MS,
  SEOUL_RAW_TARGET_C,
  SEOUL_REMAINING_CEILING_MODEL_VERSION,
  advanceDecisionState,
  assessFutureObservationCoverage,
  assessKmaHourlyCurve,
  assessKmaUpwardRevision,
  buildAmosChangeDiagnostics,
  buildObservedTemperatureFeatures,
  circularDifferenceDegrees,
  computeKmaLiveBias,
  computeKmaPeakWindow,
  computeRemainingCeilings,
  nearestRowAt,
  normalizeDecisionTargetC,
  planActiveDecisionTargetRegistration,
} from "./seoulHighPredictionModel.js";

const SEOUL_TIMEZONE = "Asia/Seoul";
const KMA_AMO_APPROVAL_FLAG = "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED";
const KMA_AMO_AIRPORT_FORECAST_URL =
  "https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI";
const WEATHERCOM_API_BASE_URL = "https://api.weather.com";
const WEATHERCOM_DAILY_FORECAST_URL = `${WEATHERCOM_API_BASE_URL}/v3/wx/forecast/daily/5day`;
const WEATHERCOM_HOURLY_FORECAST_URL = `${WEATHERCOM_API_BASE_URL}/v3/wx/forecast/hourly/10day`;
const DEFAULT_WEATHERCOM_LANGUAGE = "en-US";
const WEATHERCOM_FALLBACK_API_KEY = "71f92ea9dd2f4790b92ea9dd2f779061";
const RKSI_REPRESENTATIVE_RUNWAY_NO = "2";
const RKSI_REPRESENTATIVE_RUNWAY_DIRECTION = "15L";
const RKSI_SECONDARY_RUNWAY_NO = "3";
const RKSI_SECONDARY_RUNWAY_DIRECTION = "16L";
const MILLIS_PER_MINUTE = 60 * 1000;
const MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE;
const PREDICTION_INTERVAL_MS = DECISION_INTERVAL_MS;
const MAX_LIVE_OBSERVATION_AGE_MS = 10 * MILLIS_PER_MINUTE;
const MAX_PROVIDER_CAPTURE_AGE_MS = 12 * MILLIS_PER_HOUR;
const MAX_KMA_CAPTURE_AGE_MS = 6 * MILLIS_PER_HOUR;
const KMA_COLLECTION_COOLDOWN_SECONDS = 10 * 60;
const KMA_COLLECTION_LOCK_TIMEOUT_SECONDS = 15 * 60;
const WEATHERCOM_BASELINE_WINDOW_MS = 2 * MILLIS_PER_HOUR;
const WEATHERCOM_HISTORY_STALE_MS = 90 * MILLIS_PER_MINUTE;
const PREDICTION_MODEL_VERSION = SEOUL_REMAINING_CEILING_MODEL_VERSION;
const MAX_DECISION_OBSERVATION_AGE_MS = 3 * MILLIS_PER_MINUTE;
const MAX_DECISION_KMA_AGE_MS = 90 * MILLIS_PER_MINUTE;
const MAX_DECISION_WEATHERCOM_AGE_MS = 90 * MILLIS_PER_MINUTE;
const PEAK_CONFIRMATION_LAG_MS = 30 * MILLIS_PER_MINUTE;
const NMSC_GK2A_APPROVAL_FLAG = "NMSC_GK2A_ACCESS_APPROVED";
const MAX_DASHBOARD_REVISIONS = 288;
const MAX_FORECAST_CAPTURES_FOR_DAY = 112;
const MAX_ACTIVE_DECISION_TARGETS = 8;
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

function hasApprovedKmaAmoAccess() {
  return process.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED === "true";
}

function hasApprovedNmscGk2aAccess() {
  return process.env.NMSC_GK2A_ACCESS_APPROVED === "true";
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
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const dashboard = await ctx.runQuery(
      "seoulWeather:getHighPredictionDashboard",
      {
        stationIcao: SEOUL_STATION.stationIcao,
        date: args.date,
      },
    );
    const days = dashboard.kmaForecast?.latestCapture?.dailyRows ?? [];
    const forecast = {
      provider: "kma_amo",
      label: "KMA/AMO · RKSI",
      role: "primary",
      sourceUrl: KMA_AMO_AIRPORT_FORECAST_URL,
      status: dashboard.kmaForecast?.status ?? "no_data",
      ...(dashboard.kmaForecast?.latestAttemptError
        ? { error: dashboard.kmaForecast.latestAttemptError }
        : {}),
      days,
    };

    return {
      stationIcao: SEOUL_STATION.stationIcao,
      stationName: SEOUL_STATION.stationName,
      todayDate: dashboard.todayDate,
      approval: dashboard.kmaAccess,
      forecast,
      selectedDateForecast: dashboard.kmaForecast?.selectedDateForecast ?? null,
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

function canonicalizeAmosRows(
  rows,
  rwyNo = RKSI_REPRESENTATIVE_RUNWAY_NO,
  rwyDir = RKSI_REPRESENTATIVE_RUNWAY_DIRECTION,
) {
  const byTimestamp = new Map();
  for (const row of rows) {
    if (
      row.rwyNo !== rwyNo ||
      row.rwyDir !== rwyDir ||
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

function canonicalizeRepresentativeAmosRows(rows) {
  return canonicalizeAmosRows(rows);
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

function selectLatestUsableKmaCapture({ captures, targetDate, generatedAt }) {
  if (!hasApprovedKmaAmoAccess()) {
    return null;
  }
  return (
    captures.find((capture) => {
      if (
        capture.status !== WEATHER_STATUS.OK ||
        generatedAt - capture.capturedAt > MAX_KMA_CAPTURE_AGE_MS ||
        capture.capturedAt > generatedAt + MILLIS_PER_MINUTE
      ) {
        return false;
      }
      return (
        (capture.dailyRows ?? []).some(
          (row) => row.date === targetDate && Number.isFinite(row.maxTempC),
        ) &&
        (capture.hourlyRows ?? []).some(
          (row) => row.date === targetDate && Number.isFinite(row.tempC),
        )
      );
    }) ?? null
  );
}

function buildKmaProvider({ capture, targetDate, targetIsToday, generatedAt }) {
  const day = capture?.dailyRows?.find((row) => row.date === targetDate);
  const dailyUsable =
    capture?.status === WEATHER_STATUS.OK && Number.isFinite(day?.maxTempC);
  // Keep the daily maximum, hourly curve, condition metadata, peak time, and
  // capture vintage on one coherent KMA page response. Unlike Weather.com,
  // elapsed KMA hours are not reconstructed across provider revisions.
  const dateRows = (capture?.hourlyRows ?? [])
    .filter((row) => row.date === targetDate && Number.isFinite(row.tempC))
    .map((row) => ({
      ...row,
      capturedAt: capture.capturedAt,
      capturedAtLocal: capture.capturedAtLocal,
    }));
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
    provider: "kma_amo",
    label: "KMA/AMO · RKSI",
    role: "primary",
    sourceUrl: KMA_AMO_AIRPORT_FORECAST_URL,
    status: usable ? WEATHER_STATUS.OK : WEATHER_STATUS.ERROR,
    ...(!usable
      ? {
          error: !hasApprovedKmaAmoAccess()
            ? "KMA/AMO airport forecast access approval is required."
            : !dailyUsable
              ? `No fresh KMA/AMO daily maximum for ${targetDate}.`
              : `No fresh KMA/AMO hourly peak-time estimate for ${targetDate}.`,
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
          peakSourceCapturedAt: capture.capturedAt,
          peakSourceCapturedAtLocal: capture.capturedAtLocal,
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
    label: "Weather.com · RKSI (secondary)",
    role: "secondary",
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
    // Weather.com remains visible as a secondary comparison, but a zero
    // canonical weight prevents it from entering the KMA prediction or curve.
    weight: 0,
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
          metadataRows: [],
        };
        points.set(row.forecastTimeUtc, point);
      }
      point.values.push({ value: row.tempC, weight: provider.weight });
      point.metadataRows.push({ row, weight: provider.weight });
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
      const metadata =
        [...point.metadataRows].sort(
          (left, right) => right.weight - left.weight,
        )[0]?.row ?? null;
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
        ...(metadata?.phrase ? { phrase: metadata.phrase } : {}),
        ...(metadata?.conditionCode
          ? { conditionCode: metadata.conditionCode }
          : {}),
        ...(Number.isFinite(metadata?.ceilingFt)
          ? { ceilingFt: metadata.ceilingFt }
          : {}),
        ...(metadata?.ceilingText ? { ceilingText: metadata.ceilingText } : {}),
        ...(Number.isFinite(metadata?.windDirectionDeg)
          ? { windDirectionDeg: metadata.windDirectionDeg }
          : {}),
        ...(Number.isFinite(metadata?.windSpeedKt)
          ? { windSpeedKt: metadata.windSpeedKt }
          : {}),
        ...(Number.isFinite(metadata?.windGustKt)
          ? { windGustKt: metadata.windGustKt }
          : {}),
        ...(metadata?.windSpeedText
          ? { windSpeedText: metadata.windSpeedText }
          : {}),
        ...(Number.isFinite(metadata?.visibilityM)
          ? { visibilityM: metadata.visibilityM }
          : {}),
        ...(metadata?.visibilityText
          ? { visibilityText: metadata.visibilityText }
          : {}),
        ...(metadata?.crosswindText
          ? { crosswindText: metadata.crosswindText }
          : {}),
      };
    });
}

function addBlocker(target, code, description, critical = false) {
  if (target.codes.includes(code)) {
    return;
  }
  target.codes.push(code);
  target.descriptions.push(description);
  if (critical) {
    target.criticalCodes.push(code);
  }
}

function forecastWindDiagnostics(rows, generatedAt, liveWind) {
  const future = (rows ?? []).filter(
    (row) =>
      row.forecastTimeUtc >= generatedAt - MILLIS_PER_MINUTE &&
      row.forecastTimeUtc <= generatedAt + 2 * MILLIS_PER_HOUR,
  );
  let maxDirectionChange = null;
  let maxSpeedChange = null;
  for (const row of future) {
    if (
      Number.isFinite(liveWind?.windDirAvg) &&
      Number.isFinite(row.windDirectionDeg)
    ) {
      const change = circularDifferenceDegrees(
        liveWind.windDirAvg,
        row.windDirectionDeg,
      );
      maxDirectionChange = Number.isFinite(maxDirectionChange)
        ? Math.max(maxDirectionChange, change)
        : change;
    }
    if (
      Number.isFinite(liveWind?.windSpeedAvg) &&
      Number.isFinite(row.windSpeedKt)
    ) {
      const change = Math.abs(row.windSpeedKt - liveWind.windSpeedAvg);
      maxSpeedChange = Number.isFinite(maxSpeedChange)
        ? Math.max(maxSpeedChange, change)
        : change;
    }
  }
  return {
    forecastWindDirectionChange2hDeg: Number.isFinite(maxDirectionChange)
      ? roundToTenth(maxDirectionChange)
      : null,
    forecastWindSpeedChange2hKt: Number.isFinite(maxSpeedChange)
      ? roundToTenth(maxSpeedChange)
      : null,
  };
}

function secondaryTemperatureDiagnostics({
  primaryFeatures,
  secondaryFeatures,
  generatedAt,
}) {
  const secondaryLatest = secondaryFeatures.latestRow;
  const primaryAtSecondary = secondaryLatest
    ? nearestRowAt(primaryFeatures.rows, secondaryLatest.obsTimeUtc, 3)
    : null;
  const referenceTime = secondaryLatest
    ? secondaryLatest.obsTimeUtc - 30 * MILLIS_PER_MINUTE
    : null;
  const secondaryReference = Number.isFinite(referenceTime)
    ? nearestRowAt(secondaryFeatures.rows, referenceTime, 10)
    : null;
  const primaryReference = secondaryReference
    ? nearestRowAt(primaryFeatures.rows, secondaryReference.obsTimeUtc, 3)
    : null;
  const currentDifference =
    primaryAtSecondary && secondaryLatest
      ? roundToTenth(secondaryLatest.tempC - primaryAtSecondary.tempC)
      : null;
  const referenceDifference =
    primaryReference && secondaryReference
      ? secondaryReference.tempC - primaryReference.tempC
      : null;
  return {
    secondaryLatest,
    observationAgeMinutes: secondaryLatest
      ? roundToTenth(
          Math.max(0, generatedAt - secondaryLatest.obsTimeUtc) /
            MILLIS_PER_MINUTE,
        )
      : null,
    differenceFrom15LC: currentDifference,
    differenceChange30mC:
      Number.isFinite(currentDifference) && Number.isFinite(referenceDifference)
        ? roundToTenth(currentDifference - referenceDifference)
        : null,
  };
}

function weathercomVetoDiagnostics({
  weathercom,
  capture,
  generatedAt,
  targetC,
}) {
  const captureAgeMinutes = Number.isFinite(capture?.capturedAt)
    ? roundToTenth(
        Math.max(0, generatedAt - capture.capturedAt) / MILLIS_PER_MINUTE,
      )
    : null;
  const fresh =
    Number.isFinite(captureAgeMinutes) &&
    captureAgeMinutes <= MAX_DECISION_WEATHERCOM_AGE_MS / MILLIS_PER_MINUTE;
  const futureHourlyHigh = fresh
    ? Math.max(
        ...weathercom.rows
          .filter(
            (row) =>
              row.forecastTimeUtc >= generatedAt - MILLIS_PER_MINUTE &&
              Number.isFinite(row.tempC),
          )
          .map((row) => row.tempC),
        Number.NEGATIVE_INFINITY,
      )
    : null;
  const remainingHighC = Number.isFinite(futureHourlyHigh)
    ? futureHourlyHigh
    : null;
  return {
    remainingHighC: Number.isFinite(remainingHighC)
      ? roundToTenth(remainingHighC)
      : null,
    capturedAt: capture?.capturedAt ?? null,
    captureAgeMinutes,
    vetoActive: Number.isFinite(remainingHighC) && remainingHighC >= targetC,
  };
}

function solarSnapshotForPrediction(solar) {
  if (!solar) {
    return {};
  }
  const policyFields = {
    ...(typeof solar.solarUsefulEnergyRemaining === "boolean"
      ? {
          solarUsefulEnergyRemaining: solar.solarUsefulEnergyRemaining,
        }
      : {}),
    solarDecisionRequired: solar.solarUsefulEnergyRemaining !== false,
  };
  if (!hasApprovedNmscGk2aAccess() || solar.solarApprovalConfigured !== true) {
    // These booleans come from the local Haurwitz model, not protected NMSC
    // rows. Retaining them lets read-side revocation distinguish a legitimate
    // low-solar decision from one that required GK2A evidence.
    return policyFields;
  }
  const mapping = {
    ...policyFields,
    solarStatus: solar.solarStatus,
    solarObservedAtUtc: solar.solarObservedAtUtc,
    solarObservedAtLocal: solar.solarObservedAtLocal,
    solarObservationAgeMinutes: solar.solarObservationAgeMinutes,
    solarDsrWm2: solar.solarDsrWm2,
    solarAsrWm2: solar.solarAsrWm2,
    solarClearSkyDsrWm2: solar.solarClearSkyDsrWm2,
    solarDsrChange30mWm2: solar.solarDsrChange30mWm2,
    solarClearSkyDsrChange30mWm2: solar.solarModeledClearSkyDsrChange30mWm2,
    solarTransmissionPct: solar.solarTransmissionPct,
    solarTransmissionTrend: solar.solarTransmissionTrend,
    solarTransmissionSlopePctPointsPerHour:
      solar.solarTransmissionSlopePctPointsPerHour,
    solarUpwindSignal: solar.solarUpwindSignal,
    solarUpwindEtaMinutes: solar.solarUpwindEtaMinutes,
    solarUpwindTransmissionPct: solar.solarUpwindMedianTransmissionPct,
    solarUpwindDifferencePctPoints: solar.solarUpwindDifferencePctPoints,
    solarUpwindPointCount: solar.solarUpwindPointCount,
    solarWindObservedAtUtc: solar.solarWindObservedAtUtc,
    solarWindDirectionFromDeg: solar.solarWindDirectionFromDeg,
    solarWindSpeedKt: solar.solarWindSpeedKt,
    solarLatitude: solar.solarLatitude,
    solarLongitude: solar.solarLongitude,
    solarSourceLatitude: solar.solarSourceLatitude,
    solarSourceLongitude: solar.solarSourceLongitude,
    solarSource: solar.solarSource,
    solarSourceEndpoint: solar.solarSourceEndpoint,
    solarSourceFileName: solar.solarSourceFileName,
    solarSourceGridRow: solar.solarSourceGridRow,
    solarSourceGridColumn: solar.solarSourceGridColumn,
    solarSampleKey: solar.solarSampleKey,
    solarProductCadenceMinutes: solar.solarProductCadenceMinutes,
    solarCollectionRunAt: solar.solarCollectionRunAt,
    solarDsrQualityFlag: solar.solarDsrQualityFlag,
    solarAsrQualityFlag: solar.solarAsrQualityFlag,
    solarShortwaveQualityFlag: solar.solarShortwaveQualityFlag,
  };
  return Object.fromEntries(
    Object.entries(mapping).filter(([_field, value]) => value != null),
  );
}

function solarInputsAtMutationBoundary(solar) {
  if (hasApprovedNmscGk2aAccess()) {
    return solar;
  }
  const usefulSolarEnergyRemaining =
    solar?.solarUsefulEnergyRemaining === false ? false : true;
  return {
    stationIcao: solar?.stationIcao,
    date: solar?.date,
    evaluatedAtUtc: solar?.evaluatedAtUtc,
    solarStatus: usefulSolarEnergyRemaining ? "approval_required" : "low_solar",
    solarApprovalConfigured: false,
    solarCollectionEligibleNow: false,
    solarUsefulEnergyRemaining: usefulSolarEnergyRemaining,
  };
}

function predictionKmaDailyHighC(prediction) {
  const kma = (prediction?.providerDetails ?? []).find(
    (provider) => provider.provider === "kma_amo",
  );
  return Number.isFinite(kma?.rawHighC) ? kma.rawHighC : null;
}

function decisionReason(
  status,
  targetC,
  ceilingC,
  consecutivePasses,
  blockers,
) {
  if (status === "already_reached") {
    return `The representative 15L AMOS temperature has reached ${targetC.toFixed(1)}°C.`;
  }
  if (status === "insufficient_data") {
    return blockers[0] ?? "Critical decision input is unavailable or stale.";
  }
  if (status === "peak_candidate") {
    return `The rule ceiling is ${ceilingC.toFixed(1)}°C, but the 15-minute confirmation has completed only ${consecutivePasses} of 3 follow-up checks.`;
  }
  if (status === "unlikely_to_reach") {
    return `Unlikely to reach ${targetC.toFixed(1)}°C: the ${ceilingC.toFixed(1)}°C rule ceiling and all rebound checks passed ${consecutivePasses} consecutive evaluations.`;
  }
  if (blockers.length) {
    return blockers[0];
  }
  return Number.isFinite(ceilingC)
    ? `Still possible: the remaining rule ceiling is ${ceilingC.toFixed(1)}°C against a ${targetC.toFixed(1)}°C target.`
    : "Still possible: no complete remaining-temperature ceiling is available.";
}

function kmaForecastSuggestsClearing(rows, generatedAt) {
  return (rows ?? []).some((row) => {
    if (
      row.forecastTimeUtc < generatedAt - MILLIS_PER_MINUTE ||
      row.forecastTimeUtc > generatedAt + 2 * MILLIS_PER_HOUR
    ) {
      return false;
    }
    return /clear|fair|sun|few|scattered|improv/i.test(
      `${row.phrase ?? ""} ${row.conditionCode ?? ""}`,
    );
  });
}

function buildDecisionBlockers({
  generatedAt,
  targetC,
  primaryFeatures,
  observationAgeMinutes,
  kmaCaptureAgeMinutes,
  kmaPeakWindow,
  kmaBias,
  kmaCurve,
  kmaRevision,
  ceilings,
  solar,
  secondaryFeatures,
  secondaryDiagnostics,
  amosDiagnostics,
  forecastWind,
  kmaRows,
  weathercomVeto,
  previousDecisionState,
}) {
  const blockers = { codes: [], descriptions: [], criticalCodes: [] };
  if (!primaryFeatures.latestRow) {
    addBlocker(
      blockers,
      "amos_missing",
      "No representative 15L AMOS temperature is available.",
      true,
    );
  } else if (
    !Number.isFinite(observationAgeMinutes) ||
    observationAgeMinutes > MAX_DECISION_OBSERVATION_AGE_MS / MILLIS_PER_MINUTE
  ) {
    addBlocker(
      blockers,
      "amos_stale",
      "The latest representative 15L AMOS observation is older than 3 minutes.",
      true,
    );
  }
  if (primaryFeatures.trailingHourCoverageMinutes < 45) {
    addBlocker(
      blockers,
      "amos_coverage_weak",
      "The trailing hour contains less than 45 minutes of representative AMOS coverage.",
      true,
    );
  }
  if (
    !Number.isFinite(primaryFeatures.latestObservationGapMinutes) ||
    primaryFeatures.latestObservationGapMinutes > 5
  ) {
    addBlocker(
      blockers,
      "amos_recent_gap",
      "The representative AMOS series has a major gap at its latest edge.",
      true,
    );
  }
  for (const [minutes, slope] of [
    [15, primaryFeatures.slope15mCPerHour],
    [30, primaryFeatures.slope30mCPerHour],
    [60, primaryFeatures.slope60mCPerHour],
  ]) {
    if (!Number.isFinite(slope)) {
      addBlocker(
        blockers,
        `amos_trend_${minutes}m_unavailable`,
        `The robust ${minutes}-minute AMOS trend lacks required coverage.`,
        true,
      );
    }
  }
  if (
    !Number.isFinite(kmaCaptureAgeMinutes) ||
    kmaCaptureAgeMinutes > MAX_DECISION_KMA_AGE_MS / MILLIS_PER_MINUTE
  ) {
    addBlocker(
      blockers,
      "kma_stale",
      "The KMA/AMO forecast capture is unavailable or older than 90 minutes.",
      true,
    );
  }
  if (!kmaPeakWindow) {
    addBlocker(
      blockers,
      "kma_peak_window_unavailable",
      "The complete tied KMA peak window is unavailable.",
      true,
    );
  }
  if (!Number.isFinite(kmaBias.liveBiasC)) {
    addBlocker(
      blockers,
      "kma_live_bias_unavailable",
      "The live KMA bias lacks 30 minutes of matched AMOS coverage.",
      true,
    );
  }
  if (!kmaCurve.complete) {
    addBlocker(
      blockers,
      "kma_hourly_curve_incomplete",
      "The KMA hourly curve does not provide continuous future coverage through the end of the Seoul day.",
      true,
    );
  }
  if (!kmaCurve.dailyHourlyConsistent) {
    addBlocker(
      blockers,
      "kma_daily_hourly_inconsistent",
      "The KMA daily maximum is more than 0.7°C above the captured hourly curve.",
      true,
    );
  }
  if (!Number.isFinite(ceilings.remainingRuleCeilingC)) {
    addBlocker(
      blockers,
      "rule_ceiling_unavailable",
      "The remaining rule ceiling cannot be calculated.",
      true,
    );
  }

  if (
    kmaPeakWindow &&
    generatedAt < kmaPeakWindow.peakWindowEndUtc + PEAK_CONFIRMATION_LAG_MS
  ) {
    addBlocker(
      blockers,
      "kma_peak_window_active",
      "The last tied KMA peak hour plus its 30-minute safety lag has not ended.",
    );
  }
  if (kmaRevision.upwardDetected) {
    addBlocker(
      blockers,
      "kma_revised_upward",
      "A new KMA capture revised the daily, hourly, or remaining upper temperature guidance upward.",
    );
  }
  if (
    Number.isFinite(primaryFeatures.slope15mCPerHour) &&
    primaryFeatures.slope15mCPerHour > -0.2
  ) {
    addBlocker(
      blockers,
      "recent_warming_or_flat",
      "The robust 15-minute trend is not cooling faster than 0.2°C/hour.",
    );
  }
  if (
    Number.isFinite(primaryFeatures.slope30mCPerHour) &&
    primaryFeatures.slope30mCPerHour > -0.1
  ) {
    addBlocker(
      blockers,
      "medium_trend_not_cooling",
      "The robust 30-minute trend is not cooling faster than 0.1°C/hour.",
    );
  }
  if (
    Number.isFinite(primaryFeatures.slope60mCPerHour) &&
    primaryFeatures.slope60mCPerHour > 0
  ) {
    addBlocker(
      blockers,
      "hour_trend_positive",
      "The robust 60-minute temperature trend is still positive.",
    );
  }
  if (
    Number.isFinite(primaryFeatures.dropFromHighC) &&
    primaryFeatures.dropFromHighC < 0.2
  ) {
    addBlocker(
      blockers,
      "still_near_observed_high",
      "The current smoothed temperature remains within 0.2°C of the observed high.",
    );
  }
  if (
    Number.isFinite(primaryFeatures.minutesSinceNearHigh) &&
    primaryFeatures.minutesSinceNearHigh < 30
  ) {
    addBlocker(
      blockers,
      "recent_high_or_retie",
      "The temperature was within 0.1°C of its observed high during the last 30 minutes.",
    );
  }

  if (!solar || solar.solarStatus === "error") {
    addBlocker(
      blockers,
      "solar_inputs_unavailable",
      "The GK2A solar rebound check could not be evaluated.",
    );
  } else if (solar.solarUsefulEnergyRemaining === true) {
    if (solar.solarApprovalConfigured !== true) {
      addBlocker(
        blockers,
        "solar_approval_required",
        `${NMSC_GK2A_APPROVAL_FLAG}=true approval is required while useful solar energy remains.`,
      );
    } else if (
      solar.solarObservationFresh !== true ||
      solar.solarQualityUsable !== true
    ) {
      addBlocker(
        blockers,
        "solar_observation_unavailable",
        "A fresh, quality-usable GK2A observation is required while useful solar energy remains.",
      );
    } else {
      if (solar.solarTransmissionTrend === "increasing") {
        addBlocker(
          blockers,
          "solar_transmission_increasing",
          "GK2A estimated solar transmission is increasing.",
        );
      } else if (solar.solarTransmissionTrend === "unavailable") {
        addBlocker(
          blockers,
          "solar_transmission_trend_unavailable",
          "GK2A transmission history is not yet long enough to rule out clearing.",
        );
      }
      if (solar.solarUpwindSignal === "clearing") {
        addBlocker(
          blockers,
          "solar_upwind_clearing",
          `Clearer sky is approaching${
            Number.isFinite(solar.solarUpwindEtaMinutes)
              ? ` in approximately ${solar.solarUpwindEtaMinutes} minutes`
              : ""
          } according to GK2A upwind samples.`,
        );
      }
      if (!Number.isFinite(solar.solarDsrChange30mWm2)) {
        addBlocker(
          blockers,
          "solar_dsr_trend_unavailable",
          "A 20–30-minute GK2A DSR comparison is unavailable.",
        );
      } else if (solar.solarDsrChange30mWm2 > 0) {
        addBlocker(
          blockers,
          "solar_dsr_rising",
          "Observed GK2A downward shortwave radiation has risen over the last 20–30 minutes.",
        );
      }
      if (solar.solarModeledClearSkyDsrChange30mWm2 > 0) {
        addBlocker(
          blockers,
          "clear_sky_irradiance_rising",
          "Modeled clear-sky irradiance is still increasing.",
        );
      }
    }
  }

  const secondaryFresh =
    Number.isFinite(secondaryDiagnostics.observationAgeMinutes) &&
    secondaryDiagnostics.observationAgeMinutes <=
      MAX_DECISION_OBSERVATION_AGE_MS / MILLIS_PER_MINUTE;
  const primaryCooling =
    primaryFeatures.slope15mCPerHour <= -0.2 ||
    primaryFeatures.slope30mCPerHour <= -0.1;
  const secondaryWarming =
    secondaryFeatures.slope15mCPerHour > 0 ||
    secondaryFeatures.slope30mCPerHour > 0;
  if (secondaryFresh && primaryCooling && secondaryWarming) {
    addBlocker(
      blockers,
      "secondary_16l_warming",
      "15L is cooling while the independent 16L temperature is warming.",
    );
  }
  if (
    secondaryFresh &&
    Number.isFinite(secondaryFeatures.currentSmoothedC) &&
    secondaryFeatures.currentSmoothedC >= targetC - 0.3
  ) {
    addBlocker(
      blockers,
      "secondary_16l_near_target",
      "The independent 16L temperature remains within 0.3°C of the target.",
    );
  }
  if (
    secondaryFresh &&
    Number.isFinite(secondaryDiagnostics.differenceChange30mC) &&
    Math.abs(secondaryDiagnostics.differenceChange30mC) >= 0.4
  ) {
    addBlocker(
      blockers,
      "secondary_16l_divergence_changing",
      "The 15L–16L temperature difference changed by at least 0.4°C in 30 minutes.",
    );
  }

  const observedWindShift =
    Number.isFinite(amosDiagnostics.windDirectionShift30mDeg) &&
    amosDiagnostics.windDirectionShift30mDeg > 45;
  const observedWindSpeedChange =
    Number.isFinite(amosDiagnostics.windSpeedChange30mKt) &&
    Math.abs(amosDiagnostics.windSpeedChange30mKt) >= 5;
  const forecastWindShift =
    Number.isFinite(forecastWind.forecastWindDirectionChange2hDeg) &&
    forecastWind.forecastWindDirectionChange2hDeg > 45;
  const forecastWindSpeedChange =
    Number.isFinite(forecastWind.forecastWindSpeedChange2hKt) &&
    forecastWind.forecastWindSpeedChange2hKt >= 5;
  if (observedWindShift) {
    addBlocker(
      blockers,
      "recent_wind_shift",
      "AMOS wind direction shifted by more than 45° during the last 30 minutes.",
    );
  }
  if (observedWindSpeedChange) {
    addBlocker(
      blockers,
      "recent_wind_speed_change",
      "AMOS wind speed changed sharply during the last 30 minutes.",
    );
  }
  if (forecastWindShift) {
    addBlocker(
      blockers,
      "forecast_wind_shift",
      "KMA predicts a wind-direction change greater than 45° in the next two hours.",
    );
  }
  if (forecastWindSpeedChange) {
    addBlocker(
      blockers,
      "forecast_wind_speed_change",
      "KMA predicts a sharp wind-speed change in the next two hours.",
    );
  }
  if (
    Number.isFinite(amosDiagnostics.dewpointChange30mC) &&
    amosDiagnostics.dewpointChange30mC >= 0.5 &&
    (observedWindShift || forecastWindShift)
  ) {
    addBlocker(
      blockers,
      "dewpoint_rising_with_wind_shift",
      "Dew point rose by at least 0.5°C while the wind direction changed materially.",
    );
  }
  const clearingSuggested =
    solar?.solarUpwindSignal === "clearing" ||
    solar?.solarTransmissionTrend === "increasing" ||
    solar?.solarExpectedNextHour === "increasing" ||
    kmaForecastSuggestsClearing(kmaRows, generatedAt);
  if (amosDiagnostics.rainEndedRecently && clearingSuggested) {
    addBlocker(
      blockers,
      "rain_ended_with_clearing",
      "Recent rain has ended while KMA or GK2A indicates clearing and rebound risk.",
    );
  }
  if (weathercomVeto.vetoActive) {
    addBlocker(
      blockers,
      "secondary_forecast_reaches_target",
      `Fresh Weather.com guidance still reaches ${targetC.toFixed(1)}°C; it is used only as a conservative veto.`,
    );
  }
  if (
    (previousDecisionState?.currentState === "peak_candidate" ||
      previousDecisionState?.currentState === "unlikely_to_reach") &&
    Number.isFinite(previousDecisionState.lastCurrentSmoothedC) &&
    Number.isFinite(primaryFeatures.currentSmoothedC) &&
    primaryFeatures.currentSmoothedC -
      previousDecisionState.lastCurrentSmoothedC >=
      0.2 - Number.EPSILON
  ) {
    addBlocker(
      blockers,
      "temperature_rebounded",
      "The smoothed 15L temperature rose by at least 0.2°C since the preceding decision.",
    );
  }
  return {
    ...blockers,
    observedWindShift,
    observedWindSpeedChange,
    forecastWindShift,
    forecastWindSpeedChange,
  };
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
        "The KMA/AMO airport forecast is available, but no canonical RKSI 15L AMOS temperature has been observed yet.",
    };
  }

  const predictionDeltaC = previousPrediction
    ? roundToTenth(predictedHighC - previousPrediction.predictedHighC)
    : 0;
  if (previousPrediction && predictionDeltaC >= 0.2) {
    return {
      status: "revised_up",
      reason: `Revised up ${predictionDeltaC.toFixed(1)}°C as the live 15L observations and latest KMA/AMO curve run warmer.`,
    };
  }
  if (previousPrediction && predictionDeltaC <= -0.2) {
    return {
      status: "revised_down",
      reason: `Revised down ${Math.abs(predictionDeltaC).toFixed(1)}°C as the live 15L observations and latest KMA/AMO curve run cooler.`,
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
        "A live 15L observation is available, but no fresh KMA/AMO hourly curve exists for an on-track comparison.",
    };
  }
  return {
    status: "on_track",
    reason:
      "The live RKSI 15L temperature remains within 0.5°C of the current KMA/AMO hourly curve.",
  };
}

export const registerActiveHighPredictionTargetsInternal =
  internalMutationGeneric({
    args: {
      stationIcao: v.string(),
      date: v.string(),
      targetCs: v.array(v.number()),
    },
    handler: async (ctx, args) => {
      assertDateKey(args.date);
      if (!hasApprovedKmaAmoAccess()) {
        return {
          status: "approval_required",
          targetCs: [],
          retiredTargetCs: [],
        };
      }
      if (!args.targetCs.length || args.targetCs.length > 3) {
        throw new Error(
          "Register one to three Seoul decision targets at once.",
        );
      }
      const now = Date.now();
      const activeTargets = await ctx.db
        .query("seoulPeakActiveTargets")
        .withIndex("by_station_date_model_target", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("targetDate", args.date)
            .eq("modelVersion", PREDICTION_MODEL_VERSION),
        )
        .collect();
      const registration = planActiveDecisionTargetRegistration({
        activeTargets,
        requestedTargetCs: args.targetCs,
        maxActiveTargets: MAX_ACTIVE_DECISION_TARGETS,
      });
      const retiredTargetCs = [];
      for (const row of registration.retirementTargets) {
        retiredTargetCs.push(normalizeDecisionTargetC(row.targetC));
        await ctx.db.delete(row._id);
      }
      for (const row of registration.existingRequestedTargets) {
        await ctx.db.patch(row._id, { updatedAt: now });
      }
      for (const targetC of registration.missingTargetCs) {
        await ctx.db.insert("seoulPeakActiveTargets", {
          stationIcao: args.stationIcao,
          targetDate: args.date,
          modelVersion: PREDICTION_MODEL_VERSION,
          targetC,
          createdAt: now,
          updatedAt: now,
        });
      }
      return {
        status: "registered",
        targetCs: [
          ...(args.targetCs.some(
            (targetC) =>
              normalizeDecisionTargetC(targetC) === SEOUL_RAW_TARGET_C,
          )
            ? [SEOUL_RAW_TARGET_C]
            : []),
          ...registration.requestedTargetCs,
        ],
        retiredTargetCs,
      };
    },
  });

export const getActiveHighPredictionTargetsInternal = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    assertDateKey(args.date);
    const rows = await ctx.db
      .query("seoulPeakActiveTargets")
      .withIndex("by_station_date_model_target", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("targetDate", args.date)
          .eq("modelVersion", PREDICTION_MODEL_VERSION),
      )
      .collect();
    return rows.map((row) => normalizeDecisionTargetC(row.targetC));
  },
});

export const getHighPredictionStateTargetsInternal = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    assertDateKey(args.date);
    const rows = await ctx.db
      .query("seoulPeakDecisionState")
      .withIndex("by_station_date_model_target", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("targetDate", args.date)
          .eq("modelVersion", PREDICTION_MODEL_VERSION),
      )
      .collect();
    return rows.map((row) => normalizeDecisionTargetC(row.targetC));
  },
});

export const recomputeHighPredictionInternal = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    targetC: v.number(),
    evaluatedAtUtc: v.optional(v.number()),
    solarDecisionInputs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    assertDateKey(args.date);
    if (!hasApprovedKmaAmoAccess()) {
      return {
        prediction: null,
        summary: null,
        unavailable: {
          status: "approval_required",
          reason: "KMA/AMO airport forecast access approval is required.",
        },
      };
    }
    const targetC = normalizeDecisionTargetC(args.targetC);
    const generatedAt = Number.isFinite(args.evaluatedAtUtc)
      ? args.evaluatedAtUtc
      : Date.now();
    const generatedAtLocal = formatDateTimeInTimezone(
      generatedAt,
      SEOUL_TIMEZONE,
    );
    const evaluationSlotUtc =
      Math.floor(generatedAt / PREDICTION_INTERVAL_MS) * PREDICTION_INTERVAL_MS;
    const todayDate = formatDateInTimezone(generatedAt, SEOUL_TIMEZONE);
    const targetIsToday = args.date === todayDate;

    const [rawObservations, rawSecondaryObservations] = await Promise.all([
      ctx.db
        .query("seoulAmosObservations")
        .withIndex("by_station_date_rwy_ts", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("date", args.date)
            .eq("rwyNo", RKSI_REPRESENTATIVE_RUNWAY_NO)
            .eq("rwyDir", RKSI_REPRESENTATIVE_RUNWAY_DIRECTION),
        )
        .collect(),
      ctx.db
        .query("seoulAmosObservations")
        .withIndex("by_station_date_rwy_ts", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("date", args.date)
            .eq("rwyNo", RKSI_SECONDARY_RUNWAY_NO)
            .eq("rwyDir", RKSI_SECONDARY_RUNWAY_DIRECTION),
        )
        .collect(),
    ]);
    const observations = canonicalizeRepresentativeAmosRows(rawObservations);
    const secondaryObservations = canonicalizeAmosRows(
      rawSecondaryObservations,
      RKSI_SECONDARY_RUNWAY_NO,
      RKSI_SECONDARY_RUNWAY_DIRECTION,
    );
    const primaryFeatures = buildObservedTemperatureFeatures(
      observations,
      generatedAt,
    );
    const secondaryFeatures = buildObservedTemperatureFeatures(
      secondaryObservations,
      generatedAt,
    );
    const firstRow = primaryFeatures.rows[0] ?? null;
    const latestRow = primaryFeatures.latestRow;
    const maxRow = primaryFeatures.observedHighRow;
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

    const kmaAccessApproved = hasApprovedKmaAmoAccess();
    const kmaCaptures = kmaAccessApproved
      ? await ctx.db
          .query("seoulKmaForecastCaptures")
          .withIndex("by_station_capturedAt", (query) =>
            query.eq("stationIcao", args.stationIcao),
          )
          .order("desc")
          .take(MAX_FORECAST_CAPTURES_FOR_DAY)
      : [];
    const weathercomCaptures = await ctx.db
      .query("seoulForecastCaptures")
      .withIndex("by_station_capturedAt", (query) =>
        query.eq("stationIcao", args.stationIcao),
      )
      .order("desc")
      .take(MAX_FORECAST_CAPTURES_FOR_DAY);
    const kmaCapture = selectLatestUsableKmaCapture({
      captures: kmaCaptures,
      targetDate: args.date,
      generatedAt,
    });
    const weathercomCapture = selectLatestUsableWeatherComCapture({
      captures: weathercomCaptures,
      targetDate: args.date,
      generatedAt,
    });
    const weathercomHourlyRows = mergeWeatherComHourlyRows(
      weathercomCaptures,
      args.date,
    );
    const primaryCapture = kmaCapture;
    const previousPrediction = await ctx.db
      .query("seoulHighPredictions")
      .withIndex("by_station_date_model_target_revision", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("targetDate", args.date)
          .eq("modelVersion", PREDICTION_MODEL_VERSION)
          .eq("targetC", targetC),
      )
      .order("desc")
      .first();
    const previousCanonicalPrediction = previousPrediction ?? null;
    const previousDecisionState = await ctx.db
      .query("seoulPeakDecisionState")
      .withIndex("by_station_date_model_target", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("targetDate", args.date)
          .eq("modelVersion", PREDICTION_MODEL_VERSION)
          .eq("targetC", targetC),
      )
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

    const kma = buildKmaProvider({
      capture: kmaCapture,
      targetDate: args.date,
      targetIsToday,
      generatedAt,
    });
    const weathercom = buildWeatherComProvider({
      capture: weathercomCapture,
      hourlyRows: weathercomHourlyRows,
      targetDate: args.date,
      targetIsToday,
      generatedAt,
    });
    const kmaBias = computeKmaLiveBias(
      primaryFeatures.rows,
      kma.rows,
      generatedAt,
    );
    const providerDetails = [
      {
        ...kma.detail,
        ...(Number.isFinite(kmaBias.liveBiasC)
          ? { liveBiasC: kmaBias.liveBiasC }
          : {}),
      },
      weathercom.detail,
    ];
    const hourlyEnsembleCurve =
      kma.detail.weight > 0
        ? buildHourlyEnsembleCurve([
            {
              rows: kma.rows,
              weight: kma.detail.weight,
            },
          ])
        : [];

    const forecastHighC = kma.adjustedHighC;
    const predictedHighCandidates = [forecastHighC, maxRow?.tempC].filter(
      Number.isFinite,
    );
    const predictedHighC = predictedHighCandidates.length
      ? roundToTenth(Math.max(...predictedHighCandidates))
      : null;
    const predictedHighF = Number.isFinite(predictedHighC)
      ? toFahrenheit(predictedHighC)
      : null;
    const kmaPeakWindow = computeKmaPeakWindow(kma.rows);
    const nextDate = addUtcDays(args.date, 1);
    const endOfDayUtc = Date.parse(`${nextDate}T00:00:00+09:00`);
    const ceilings = computeRemainingCeilings({
      forecastRows: kma.rows,
      evaluatedAt: generatedAt,
      endOfDayUtc,
      liveBiasC: kmaBias.liveBiasC,
      currentSmoothedC: primaryFeatures.currentSmoothedC,
      observedHighC: maxRow?.tempC,
      slope15mCPerHour: primaryFeatures.slope15mCPerHour,
      slope30mCPerHour: primaryFeatures.slope30mCPerHour,
      targetC,
    });
    const kmaCurve = assessKmaHourlyCurve({
      rows: kma.rows,
      evaluatedAt: generatedAt,
      endOfDayUtc,
      dailyHighC: forecastHighC,
    });
    const kmaRevision = assessKmaUpwardRevision({
      previousCaptureKey:
        previousDecisionState?.lastKmaForecastCaptureId ??
        previousCanonicalPrediction?.forecastCaptureId,
      currentCaptureKey: primaryCapture?._id,
      previousDailyHighC:
        previousDecisionState?.lastKmaDailyHighC ??
        predictionKmaDailyHighC(previousCanonicalPrediction),
      currentDailyHighC: forecastHighC,
      previousRemainingUpperC:
        previousDecisionState?.lastKmaRemainingUpperC ??
        previousCanonicalPrediction?.kmaRemainingUpperC,
      currentRemainingUpperC: ceilings.kmaRemainingUpperC,
      previousHourlyRows:
        previousDecisionState?.lastKmaHourlyRows ??
        previousCanonicalPrediction?.hourlyEnsembleCurve,
      currentHourlyRows: kma.rows,
      evaluatedAt: generatedAt,
    });
    const secondaryDiagnostics = secondaryTemperatureDiagnostics({
      primaryFeatures,
      secondaryFeatures,
      generatedAt,
    });
    const amosDiagnostics = buildAmosChangeDiagnostics(
      primaryFeatures.rows,
      generatedAt,
    );
    const forecastWind = forecastWindDiagnostics(
      kma.rows,
      generatedAt,
      amosDiagnostics.latest,
    );
    const weathercomVeto = weathercomVetoDiagnostics({
      weathercom,
      capture: weathercomCapture,
      generatedAt,
      targetC,
    });
    // Recheck NMSC approval in this mutation immediately before the decision
    // state can be written. An approved snapshot passed by the action must not
    // survive a flag removal that happened between the query and mutation.
    const solarDecisionInputs = solarInputsAtMutationBoundary(
      args.solarDecisionInputs,
    );
    const decisionBlockers = buildDecisionBlockers({
      generatedAt,
      targetC,
      primaryFeatures,
      observationAgeMinutes,
      kmaCaptureAgeMinutes: Number.isFinite(primaryCapture?.capturedAt)
        ? roundToTenth(
            Math.max(0, generatedAt - primaryCapture.capturedAt) /
              MILLIS_PER_MINUTE,
          )
        : null,
      kmaPeakWindow,
      kmaBias,
      kmaCurve,
      kmaRevision,
      ceilings,
      solar: solarDecisionInputs,
      secondaryFeatures,
      secondaryDiagnostics,
      amosDiagnostics,
      forecastWind,
      kmaRows: kma.rows,
      weathercomVeto,
      previousDecisionState,
    });
    const decision = advanceDecisionState({
      previousState: previousDecisionState,
      evaluatedAt: generatedAt,
      evaluationSlotUtc,
      observedHighC: maxRow?.tempC,
      targetC,
      remainingRuleCeilingC: ceilings.remainingRuleCeilingC,
      criticalBlockerCount: decisionBlockers.criticalCodes.length,
      blockerCount: decisionBlockers.codes.length,
    });
    const persistedDecisionBlockers =
      decision.currentState === "already_reached"
        ? { codes: [], descriptions: [] }
        : decisionBlockers;
    // KMA guidance is also approval-gated. Do not persist its derived mutable
    // state if approval changed after the capture was read.
    if (!hasApprovedKmaAmoAccess()) {
      return {
        prediction: null,
        summary,
        unavailable: {
          status: "approval_required",
          reason: "KMA/AMO airport forecast access approval is required.",
        },
      };
    }
    const currentKmaBaselineRows = (kma.rows ?? [])
      .filter(
        (row) =>
          Number.isFinite(row?.forecastTimeUtc) && Number.isFinite(row?.tempC),
      )
      .map((row) => ({
        forecastTimeUtc: row.forecastTimeUtc,
        tempC: row.tempC,
      }));
    const decisionStateFields = {
      stationIcao: args.stationIcao,
      targetDate: args.date,
      modelVersion: PREDICTION_MODEL_VERSION,
      targetC,
      consecutivePasses: decision.consecutivePasses,
      lastEvaluationAt: generatedAt,
      lastEvaluationSlotUtc: evaluationSlotUtc,
      ...(Number.isFinite(ceilings.remainingRuleCeilingC)
        ? { lastRuleCeilingC: ceilings.remainingRuleCeilingC }
        : {}),
      ...(Number.isFinite(primaryFeatures.currentSmoothedC)
        ? { lastCurrentSmoothedC: primaryFeatures.currentSmoothedC }
        : {}),
      ...(primaryCapture?._id && currentKmaBaselineRows.length
        ? {
            lastKmaForecastCaptureId: primaryCapture._id,
            lastKmaHourlyRows: currentKmaBaselineRows,
          }
        : {}),
      ...(Number.isFinite(forecastHighC)
        ? { lastKmaDailyHighC: forecastHighC }
        : {}),
      ...(Number.isFinite(ceilings.kmaRemainingUpperC)
        ? { lastKmaRemainingUpperC: ceilings.kmaRemainingUpperC }
        : {}),
      solarDecisionRequired:
        solarDecisionInputs?.solarUsefulEnergyRemaining !== false,
      currentState: decision.currentState,
      blockerCodes: persistedDecisionBlockers.codes,
      blockerDescriptions: persistedDecisionBlockers.descriptions,
      updatedAt: generatedAt,
    };
    let decisionStateId;
    if (previousDecisionState) {
      await ctx.db.patch(previousDecisionState._id, {
        ...decisionStateFields,
        candidateSinceUtc: Number.isFinite(decision.candidateSinceUtc)
          ? decision.candidateSinceUtc
          : undefined,
        lastRuleCeilingC: Number.isFinite(ceilings.remainingRuleCeilingC)
          ? ceilings.remainingRuleCeilingC
          : undefined,
        lastCurrentSmoothedC: Number.isFinite(primaryFeatures.currentSmoothedC)
          ? primaryFeatures.currentSmoothedC
          : undefined,
      });
      decisionStateId = previousDecisionState._id;
    } else {
      decisionStateId = await ctx.db.insert("seoulPeakDecisionState", {
        ...decisionStateFields,
        ...(Number.isFinite(decision.candidateSinceUtc)
          ? { candidateSinceUtc: decision.candidateSinceUtc }
          : {}),
        createdAt: generatedAt,
      });
    }

    const futureForecastHighC = Number.isFinite(ceilings.kmaRemainingBestHighC)
      ? ceilings.kmaRemainingBestHighC
      : null;
    const state = predictionState({
      previousPrediction: previousCanonicalPrediction,
      predictedHighC,
      observedHighC: maxRow?.tempC,
      observedCurrentC: liveLatestRow?.tempC,
      expectedCurrentC: ceilings.expectedCurrentC,
      slope60mCPerHour: primaryFeatures.slope60mCPerHour,
      generatedAt,
      peakWindowEndUtc: kmaPeakWindow?.peakWindowEndUtc,
      futureForecastHighC,
    });
    const reason = decisionReason(
      decision.currentState,
      targetC,
      ceilings.remainingRuleCeilingC,
      decision.consecutivePasses,
      persistedDecisionBlockers.descriptions,
    );
    const materialChange =
      !previousCanonicalPrediction ||
      (Number.isFinite(previousCanonicalPrediction.predictedHighC) &&
      Number.isFinite(predictedHighC)
        ? Math.abs(
            roundToTenth(
              previousCanonicalPrediction.predictedHighC - predictedHighC,
            ),
          ) >= 0.1
        : previousCanonicalPrediction.predictedHighC !== predictedHighC) ||
      previousCanonicalPrediction.decisionStatus !== decision.currentState ||
      previousCanonicalPrediction.remainingRuleCeilingC !==
        ceilings.remainingRuleCeilingC ||
      previousCanonicalPrediction.marginBelowTargetC !==
        ceilings.marginBelowTargetC ||
      previousCanonicalPrediction.solarDecisionRequired !==
        (solarDecisionInputs?.solarUsefulEnergyRemaining !== false) ||
      JSON.stringify(previousCanonicalPrediction.blockerCodes ?? []) !==
        JSON.stringify(persistedDecisionBlockers.codes) ||
      JSON.stringify(previousCanonicalPrediction.blockerDescriptions ?? []) !==
        JSON.stringify(persistedDecisionBlockers.descriptions);
    if (!Number.isFinite(predictedHighC) || !materialChange) {
      const decisionState = await ctx.db.get(decisionStateId);
      return {
        prediction: Number.isFinite(predictedHighC)
          ? previousCanonicalPrediction
          : null,
        summary,
        decisionState,
        ...(!Number.isFinite(forecastHighC)
          ? {
              unavailable: {
                status: kmaAccessApproved ? "no_data" : "approval_required",
                reason: kmaAccessApproved
                  ? `No fresh KMA/AMO airport forecast is available for ${args.date}.`
                  : "KMA/AMO airport forecast access approval is required.",
              },
            }
          : {}),
      };
    }

    // Recheck immediately before the KMA-derived write so revocation during a
    // longer recomputation cannot create another protected prediction row.
    if (!hasApprovedKmaAmoAccess()) {
      return {
        prediction: null,
        summary,
        unavailable: {
          status: "approval_required",
          reason: "KMA/AMO airport forecast access approval is required.",
        },
      };
    }
    const revision = (previousCanonicalPrediction?.revision ?? 0) + 1;
    const trailingHourObservationCount = primaryFeatures.latestRow
      ? primaryFeatures.rows.filter(
          (row) =>
            row.obsTimeUtc >=
            primaryFeatures.latestRow.obsTimeUtc - 60 * MILLIS_PER_MINUTE,
        ).length
      : 0;
    const recentPrecipRows = primaryFeatures.latestRow
      ? primaryFeatures.rows.filter(
          (row) =>
            row.obsTimeUtc >=
              primaryFeatures.latestRow.obsTimeUtc - 60 * MILLIS_PER_MINUTE &&
            Number.isFinite(row.precipMm),
        )
      : [];
    const precipObservedInLast60m = recentPrecipRows.some(
      (row) => row.precipMm > 0,
    );
    const lastWetRow = [...recentPrecipRows]
      .reverse()
      .find((row) => row.precipMm > 0);
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
      ...(previousCanonicalPrediction
        ? { previousPredictionId: previousCanonicalPrediction._id }
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
      ...(Number.isFinite(primaryFeatures.slope15mCPerHour)
        ? {
            slope15mCPerHour: primaryFeatures.slope15mCPerHour,
            robustSlope15mCPerHour: primaryFeatures.slope15mCPerHour,
          }
        : {}),
      ...(Number.isFinite(primaryFeatures.slope30mCPerHour)
        ? {
            slope30mCPerHour: primaryFeatures.slope30mCPerHour,
            robustSlope30mCPerHour: primaryFeatures.slope30mCPerHour,
          }
        : {}),
      ...(Number.isFinite(primaryFeatures.slope60mCPerHour)
        ? {
            slope60mCPerHour: primaryFeatures.slope60mCPerHour,
            robustSlope60mCPerHour: primaryFeatures.slope60mCPerHour,
          }
        : {}),
      ...(Number.isFinite(primaryFeatures.currentSmoothedC)
        ? { currentSmoothedC: primaryFeatures.currentSmoothedC }
        : {}),
      ...(primaryFeatures.lastNearHighRow
        ? {
            lastNearHighAtUtc: primaryFeatures.lastNearHighRow.obsTimeUtc,
            lastNearHighAtLocal: primaryFeatures.lastNearHighRow.obsTimeLocal,
          }
        : {}),
      ...(Number.isFinite(primaryFeatures.minutesSinceNearHigh)
        ? { minutesSinceNearHigh: primaryFeatures.minutesSinceNearHigh }
        : {}),
      ...(Number.isFinite(primaryFeatures.dropFromHighC)
        ? { dropFromHighC: primaryFeatures.dropFromHighC }
        : {}),
      trend15mCoverageMinutes: primaryFeatures.trend15.coverageMinutes,
      trend30mCoverageMinutes: primaryFeatures.trend30.coverageMinutes,
      trend60mCoverageMinutes: primaryFeatures.trend60.coverageMinutes,
      ...(Number.isFinite(primaryFeatures.latestObservationGapMinutes)
        ? {
            trendLatestGapMinutes: primaryFeatures.latestObservationGapMinutes,
          }
        : {}),
      trailingHourObservationCount,
      ...(Number.isFinite(ceilings.expectedCurrentC)
        ? { expectedCurrentC: ceilings.expectedCurrentC }
        : {}),
      ...(Number.isFinite(kmaBias.liveBiasC)
        ? {
            liveBiasC: kmaBias.liveBiasC,
            kmaLiveBiasC: kmaBias.liveBiasC,
          }
        : {}),
      ...(Number.isFinite(ceilings.kmaRemainingBestHighC)
        ? { kmaRemainingBestHighC: ceilings.kmaRemainingBestHighC }
        : {}),
      ...(Number.isFinite(ceilings.kmaRemainingUpperC)
        ? { kmaRemainingUpperC: ceilings.kmaRemainingUpperC }
        : {}),
      kmaHourlyPointCount: kmaCurve.pointCount,
      kmaFutureHourlyPointCount: kmaCurve.futurePointCount,
      ...(Number.isFinite(kmaCurve.lastForecastTimeUtc)
        ? { kmaHourlyCoverageEndUtc: kmaCurve.lastForecastTimeUtc }
        : {}),
      ...(Number.isFinite(kmaCurve.maxGapMinutes)
        ? { kmaMaxHourlyGapMinutes: kmaCurve.maxGapMinutes }
        : {}),
      ...(Number.isFinite(kmaCurve.dailyHourlyHighGapC)
        ? { kmaDailyHourlyHighGapC: kmaCurve.dailyHourlyHighGapC }
        : {}),
      kmaRevisionUpwardDetected: kmaRevision.upwardDetected,
      ...(Number.isFinite(ceilings.nowcastUpperC)
        ? { nowcastUpperC: ceilings.nowcastUpperC }
        : {}),
      ...(Number.isFinite(ceilings.remainingRuleCeilingC)
        ? { remainingRuleCeilingC: ceilings.remainingRuleCeilingC }
        : {}),
      predictedHighC,
      predictedHighF,
      ...(Number.isFinite(kmaPeakWindow?.firstPeakTimeUtc)
        ? {
            peakWindowStartUtc: kmaPeakWindow.firstPeakTimeUtc,
            peakWindowStartLocal: formatDateTimeInTimezone(
              kmaPeakWindow.firstPeakTimeUtc,
              SEOUL_TIMEZONE,
            ),
            firstKmaPeakTimeUtc: kmaPeakWindow.firstPeakTimeUtc,
            firstKmaPeakTimeLocal: formatDateTimeInTimezone(
              kmaPeakWindow.firstPeakTimeUtc,
              SEOUL_TIMEZONE,
            ),
          }
        : {}),
      ...(Number.isFinite(kmaPeakWindow?.peakWindowEndUtc)
        ? {
            peakWindowEndUtc: kmaPeakWindow.peakWindowEndUtc,
            peakWindowEndLocal: formatDateTimeInTimezone(
              kmaPeakWindow.peakWindowEndUtc,
              SEOUL_TIMEZONE,
            ),
            kmaPeakWindowEndUtc: kmaPeakWindow.peakWindowEndUtc,
            kmaPeakWindowEndLocal: formatDateTimeInTimezone(
              kmaPeakWindow.peakWindowEndUtc,
              SEOUL_TIMEZONE,
            ),
          }
        : {}),
      ...(Number.isFinite(kmaPeakWindow?.lastPeakTimeUtc)
        ? {
            lastKmaPeakTimeUtc: kmaPeakWindow.lastPeakTimeUtc,
            lastKmaPeakTimeLocal: formatDateTimeInTimezone(
              kmaPeakWindow.lastPeakTimeUtc,
              SEOUL_TIMEZONE,
            ),
          }
        : {}),
      targetC,
      ...(Number.isFinite(ceilings.marginBelowTargetC)
        ? { marginBelowTargetC: ceilings.marginBelowTargetC }
        : {}),
      decisionStatus: decision.currentState,
      ...(Number.isFinite(decision.candidateSinceUtc)
        ? {
            candidateSinceUtc: decision.candidateSinceUtc,
            candidateSinceLocal: formatDateTimeInTimezone(
              decision.candidateSinceUtc,
              SEOUL_TIMEZONE,
            ),
          }
        : {}),
      consecutivePasses: decision.consecutivePasses,
      blockerCodes: persistedDecisionBlockers.codes,
      blockerDescriptions: persistedDecisionBlockers.descriptions,
      ...solarSnapshotForPrediction(solarDecisionInputs),
      ...(secondaryDiagnostics.secondaryLatest
        ? {
            secondary16LObservedAtUtc:
              secondaryDiagnostics.secondaryLatest.obsTimeUtc,
            secondary16LObservedAtLocal:
              secondaryDiagnostics.secondaryLatest.obsTimeLocal,
            secondary16LObservationAgeMinutes:
              secondaryDiagnostics.observationAgeMinutes,
            secondary16LCurrentC: secondaryFeatures.currentSmoothedC,
            secondary16LCurrentF: toFahrenheit(
              secondaryFeatures.currentSmoothedC,
            ),
          }
        : {}),
      ...(Number.isFinite(secondaryFeatures.slope15mCPerHour)
        ? {
            secondary16LSlope15mCPerHour: secondaryFeatures.slope15mCPerHour,
          }
        : {}),
      ...(Number.isFinite(secondaryFeatures.slope30mCPerHour)
        ? {
            secondary16LSlope30mCPerHour: secondaryFeatures.slope30mCPerHour,
          }
        : {}),
      ...(Number.isFinite(secondaryDiagnostics.differenceFrom15LC)
        ? {
            secondary16LDifferenceFrom15LC:
              secondaryDiagnostics.differenceFrom15LC,
          }
        : {}),
      ...(Number.isFinite(secondaryDiagnostics.differenceChange30mC)
        ? {
            secondary16LDifferenceChange30mC:
              secondaryDiagnostics.differenceChange30mC,
          }
        : {}),
      ...(amosDiagnostics.latest
        ? {
            windObservedAtUtc: amosDiagnostics.latest.obsTimeUtc,
            ...(Number.isFinite(amosDiagnostics.latest.windDirAvg)
              ? { windDirectionDeg: amosDiagnostics.latest.windDirAvg }
              : {}),
            ...(Number.isFinite(amosDiagnostics.latest.windSpeedAvg)
              ? { windSpeedKt: amosDiagnostics.latest.windSpeedAvg }
              : {}),
            ...(Number.isFinite(amosDiagnostics.latest.dewpointC)
              ? { currentDewpointC: amosDiagnostics.latest.dewpointC }
              : {}),
            ...(Number.isFinite(amosDiagnostics.latest.precipMm)
              ? { currentPrecipMm: amosDiagnostics.latest.precipMm }
              : {}),
          }
        : {}),
      ...(Number.isFinite(amosDiagnostics.windDirectionShift30mDeg)
        ? {
            windDirectionChange30mDeg: amosDiagnostics.windDirectionShift30mDeg,
          }
        : {}),
      ...(Number.isFinite(amosDiagnostics.windSpeedChange30mKt)
        ? { windSpeedChange30mKt: amosDiagnostics.windSpeedChange30mKt }
        : {}),
      ...(Number.isFinite(forecastWind.forecastWindDirectionChange2hDeg)
        ? {
            forecastWindDirectionChange2hDeg:
              forecastWind.forecastWindDirectionChange2hDeg,
          }
        : {}),
      ...(Number.isFinite(forecastWind.forecastWindSpeedChange2hKt)
        ? {
            forecastWindSpeedChange2hKt:
              forecastWind.forecastWindSpeedChange2hKt,
          }
        : {}),
      materialWindShiftDetected:
        decisionBlockers.observedWindShift ||
        decisionBlockers.forecastWindShift,
      ...(Number.isFinite(amosDiagnostics.dewpointChange30mC)
        ? { dewpointChange30mC: amosDiagnostics.dewpointChange30mC }
        : {}),
      dewpointRisingWithWindShift: decisionBlockers.codes.includes(
        "dewpoint_rising_with_wind_shift",
      ),
      precipObservedInLast60m,
      ...(amosDiagnostics.rainEndedRecently && lastWetRow
        ? { recentPrecipEndedAtUtc: lastWetRow.obsTimeUtc }
        : {}),
      rainEndedClearingRisk: decisionBlockers.codes.includes(
        "rain_ended_with_clearing",
      ),
      ...(Number.isFinite(weathercomVeto.remainingHighC)
        ? { weathercomRemainingHighC: weathercomVeto.remainingHighC }
        : {}),
      ...(Number.isFinite(weathercomVeto.capturedAt)
        ? { weathercomForecastCapturedAt: weathercomVeto.capturedAt }
        : {}),
      ...(Number.isFinite(weathercomVeto.captureAgeMinutes)
        ? { weathercomForecastAgeMinutes: weathercomVeto.captureAgeMinutes }
        : {}),
      weathercomVetoActive: weathercomVeto.vetoActive,
      status: state.status,
      reason,
      providerDetails,
      hourlyEnsembleCurve,
      createdAt: generatedAt,
    });
    await ctx.db.patch(decisionStateId, { lastPredictionId: predictionId });
    return {
      prediction: await ctx.db.get(predictionId),
      summary,
      decisionState: await ctx.db.get(decisionStateId),
    };
  },
});

export const recomputeTodayHighPrediction = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    date: v.optional(v.string()),
    targetC: v.optional(v.number()),
    targetCs: v.optional(v.array(v.number())),
    trigger: v.optional(
      v.union(v.literal("interactive"), v.literal("scheduled")),
    ),
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
    const trigger = args.trigger ?? "interactive";
    if (!hasApprovedKmaAmoAccess()) {
      if (trigger === "interactive" && args.targetCs === undefined) {
        return null;
      }
      return {
        trigger,
        evaluatedAtUtc: Date.now(),
        targetCount: 0,
        targets: [],
        unavailable: "approval_required",
      };
    }
    let targetCs;
    if (trigger === "scheduled") {
      if (args.targetCs !== undefined) {
        throw new Error("Scheduled Seoul evaluation does not accept targetCs.");
      }
      const activeTargets = await ctx.runQuery(
        "seoulWeather:getActiveHighPredictionTargetsInternal",
        { stationIcao, date },
      );
      targetCs = Array.from(
        new Set([
          SEOUL_RAW_TARGET_C,
          ...activeTargets.map((targetC) => normalizeDecisionTargetC(targetC)),
        ]),
      );
    } else {
      if (args.targetCs !== undefined && args.targetC !== undefined) {
        throw new Error("Pass either targetC or targetCs, not both.");
      }
      if (args.targetCs !== undefined) {
        if (!args.targetCs.length || args.targetCs.length > 3) {
          throw new Error(
            "Interactive Seoul evaluation accepts one to three targets.",
          );
        }
        targetCs = Array.from(
          new Set(
            args.targetCs.map((targetC) => normalizeDecisionTargetC(targetC)),
          ),
        );
      } else {
        targetCs = [normalizeDecisionTargetC(args.targetC)];
      }
      await ctx.runMutation(
        "seoulWeather:registerActiveHighPredictionTargetsInternal",
        { stationIcao, date, targetCs },
      );
    }
    const evaluatedAtUtc = Date.now();
    let solarDecisionInputs;
    try {
      solarDecisionInputs = await ctx.runQuery(
        "seoulGk2a:getSolarDecisionInputs",
        {
          stationIcao,
          date,
          evaluatedAtUtc,
        },
      );
    } catch (error) {
      solarDecisionInputs = {
        stationIcao,
        date,
        evaluatedAtUtc,
        solarStatus: "error",
        solarApprovalConfigured: hasApprovedNmscGk2aAccess(),
      };
    }
    const results = [];
    for (const targetC of targetCs) {
      const result = await ctx.runMutation(
        "seoulWeather:recomputeHighPredictionInternal",
        {
          stationIcao,
          date,
          targetC,
          evaluatedAtUtc,
          solarDecisionInputs,
        },
      );
      results.push({
        targetC,
        prediction: toCanonicalPagePrediction(result.prediction),
      });
    }
    if (trigger === "interactive" && args.targetCs === undefined) {
      return results[0]?.prediction ?? null;
    }
    return {
      trigger,
      evaluatedAtUtc,
      targetCount: results.length,
      targets: results.map((result) => ({
        targetC: result.targetC,
        decisionStatus: result.prediction?.decisionStatus ?? null,
      })),
    };
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
  const thresholdRows = evaluations.filter((row) =>
    Number.isFinite(row.thresholdTargetC),
  );
  const unlikelyDeclarationCount = thresholdRows.reduce(
    (total, row) => total + (row.unlikelyDeclarationCount ?? 0),
    0,
  );
  const evaluatedUnlikelyDeclarationCount = thresholdRows.reduce(
    (total, row) =>
      total +
      (row.evaluatedUnlikelyDeclarationCount ??
        row.unlikelyDeclarationCount ??
        0),
    0,
  );
  const censoredUnlikelyDeclarationCount = thresholdRows.reduce(
    (total, row) => total + (row.censoredUnlikelyDeclarationCount ?? 0),
    0,
  );
  const falseUnlikelyDeclarationCount = thresholdRows.reduce(
    (total, row) => total + (row.falseUnlikelyDeclarationCount ?? 0),
    0,
  );
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
    thresholdSafety: {
      evaluatedDayCount: thresholdRows.length,
      daysWithUnlikelyDeclaration: thresholdRows.filter(
        (row) => (row.unlikelyDeclarationCount ?? 0) > 0,
      ).length,
      unlikelyDeclarationCount,
      evaluatedUnlikelyDeclarationCount,
      censoredUnlikelyDeclarationCount,
      falseUnlikelyDeclarationCount,
      falseDeclarationPct: evaluatedUnlikelyDeclarationCount
        ? roundToTenth(
            (falseUnlikelyDeclarationCount /
              evaluatedUnlikelyDeclarationCount) *
              100,
          )
        : null,
      revocationCount: thresholdRows.reduce(
        (total, row) => total + (row.unlikelyRevocationCount ?? 0),
        0,
      ),
    },
  };
}

export const finalizeHighPredictionInternal = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    targetC: v.number(),
  },
  handler: async (ctx, args) => {
    assertDateKey(args.date);
    const targetC = normalizeDecisionTargetC(args.targetC);
    if (!hasApprovedKmaAmoAccess() || !hasApprovedNmscGk2aAccess()) {
      return null;
    }
    const todayDate = formatDateInTimezone(Date.now(), SEOUL_TIMEZONE);
    if (args.date >= todayDate) {
      throw new Error("Only completed Seoul-local dates can be finalized.");
    }

    const markDecisionStateFinal = async (finalizedAt) => {
      const decisionState = await ctx.db
        .query("seoulPeakDecisionState")
        .withIndex("by_station_date_model_target", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("targetDate", args.date)
            .eq("modelVersion", PREDICTION_MODEL_VERSION)
            .eq("targetC", targetC),
        )
        .first();
      if (decisionState) {
        await ctx.db.patch(decisionState._id, {
          currentState: "final",
          candidateSinceUtc: undefined,
          blockerCodes: [],
          blockerDescriptions: [],
          lastEvaluationAt: finalizedAt,
          lastEvaluationSlotUtc:
            Math.floor(finalizedAt / PREDICTION_INTERVAL_MS) *
            PREDICTION_INTERVAL_MS,
          updatedAt: finalizedAt,
        });
      }
    };

    const existingEvaluation = await ctx.db
      .query("seoulHighEvaluations")
      .withIndex("by_station_model_date_target", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("modelVersion", PREDICTION_MODEL_VERSION)
          .eq("targetDate", args.date)
          .eq("thresholdTargetC", targetC),
      )
      .first();
    if (existingEvaluation) {
      await markDecisionStateFinal(existingEvaluation.finalizedAt);
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

    const predictions = hasApprovedKmaAmoAccess()
      ? await ctx.db
          .query("seoulHighPredictions")
          .withIndex("by_station_date_model_target_revision", (query) =>
            query
              .eq("stationIcao", args.stationIcao)
              .eq("targetDate", args.date)
              .eq("modelVersion", PREDICTION_MODEL_VERSION)
              .eq("targetC", targetC),
          )
          .collect()
      : [];
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
    const unlikelyDeclarations = predictions.filter(
      (prediction, index) =>
        prediction.decisionStatus === "unlikely_to_reach" &&
        predictions[index - 1]?.decisionStatus !== "unlikely_to_reach",
    );
    const thresholdEndOfDayUtc = Date.parse(
      `${addUtcDays(args.date, 1)}T00:00:00+09:00`,
    );
    const declarationOutcomes = unlikelyDeclarations.map((prediction) => {
      const coverage = assessFutureObservationCoverage(
        observations,
        prediction.generatedAt,
        thresholdEndOfDayUtc,
      );
      const futureHighRow = selectExtremeRow(coverage.futureRows, "max");
      const targetReachedRow = coverage.futureRows.find(
        (row) => row.tempC >= targetC,
      );
      const assessable = Boolean(targetReachedRow) || coverage.complete;
      return {
        prediction,
        futureHighRow,
        assessable,
        wasFalse: assessable ? Boolean(targetReachedRow) : null,
        targetReachedRow: targetReachedRow ?? null,
        coverage,
      };
    });
    const firstUnlikelyOutcome = declarationOutcomes[0] ?? null;
    const firstCorrectUnlikelyOutcome = declarationOutcomes.find(
      (outcome) => outcome.wasFalse === false,
    );
    const evaluatedUnlikelyDeclarationCount = declarationOutcomes.filter(
      (outcome) => outcome.assessable,
    ).length;
    const censoredUnlikelyDeclarationCount =
      declarationOutcomes.length - evaluatedUnlikelyDeclarationCount;
    const thresholdMaxFutureGapMinutes = declarationOutcomes.length
      ? Math.max(
          ...declarationOutcomes.map(
            (outcome) => outcome.coverage.maxGapMinutes,
          ),
        )
      : null;
    const unlikelyRevocationCount = predictions.filter(
      (prediction, index) =>
        index > 0 &&
        predictions[index - 1].decisionStatus === "unlikely_to_reach" &&
        prediction.decisionStatus !== "unlikely_to_reach",
    ).length;
    const finalizedAt = Date.now();
    if (!hasApprovedKmaAmoAccess() || !hasApprovedNmscGk2aAccess()) {
      return null;
    }
    const evaluationId = await ctx.db.insert("seoulHighEvaluations", {
      stationIcao: args.stationIcao,
      targetDate: args.date,
      modelVersion: PREDICTION_MODEL_VERSION,
      finalizedAt,
      finalizedAtLocal: formatDateTimeInTimezone(finalizedAt, SEOUL_TIMEZONE),
      actualHighC: maxRow.tempC,
      actualHighF: maxRow.tempF ?? toFahrenheit(maxRow.tempC),
      actualHighAtUtc: maxRow.obsTimeUtc,
      actualHighAtLocal: maxRow.obsTimeLocal,
      obsCount: observations.length,
      thresholdTargetC: targetC,
      unlikelyDeclarationCount: declarationOutcomes.length,
      evaluatedUnlikelyDeclarationCount,
      censoredUnlikelyDeclarationCount,
      unlikelyRevocationCount,
      falseUnlikelyDeclarationCount: declarationOutcomes.filter(
        (outcome) => outcome.wasFalse === true,
      ).length,
      ...(firstUnlikelyOutcome
        ? {
            thresholdObservationCoverageComplete:
              firstUnlikelyOutcome.coverage.complete,
            ...(Number.isFinite(firstUnlikelyOutcome.coverage.coverageEndUtc)
              ? {
                  thresholdObservationCoverageEndUtc:
                    firstUnlikelyOutcome.coverage.coverageEndUtc,
                }
              : {}),
            ...(Number.isFinite(thresholdMaxFutureGapMinutes)
              ? { thresholdMaxFutureGapMinutes }
              : {}),
          }
        : {}),
      ...(firstUnlikelyOutcome
        ? {
            firstUnlikelyPredictionId: firstUnlikelyOutcome.prediction._id,
            firstUnlikelyAtUtc: firstUnlikelyOutcome.prediction.generatedAt,
            firstUnlikelyAtLocal: formatDateTimeInTimezone(
              firstUnlikelyOutcome.prediction.generatedAt,
              SEOUL_TIMEZONE,
            ),
            ...(Number.isFinite(
              firstUnlikelyOutcome.prediction.remainingRuleCeilingC,
            )
              ? {
                  firstUnlikelyRuleCeilingC:
                    firstUnlikelyOutcome.prediction.remainingRuleCeilingC,
                }
              : {}),
            ...(Number.isFinite(firstUnlikelyOutcome.futureHighRow?.tempC)
              ? {
                  firstUnlikelyFutureHighC:
                    firstUnlikelyOutcome.futureHighRow.tempC,
                }
              : {}),
            ...(Number.isFinite(
              firstUnlikelyOutcome.prediction.marginBelowTargetC,
            )
              ? {
                  firstUnlikelyMarginBelowTargetC:
                    firstUnlikelyOutcome.prediction.marginBelowTargetC,
                }
              : {}),
            ...(typeof firstUnlikelyOutcome.wasFalse === "boolean"
              ? {
                  firstUnlikelyWasFalse: firstUnlikelyOutcome.wasFalse,
                  targetReachedAfterFirstUnlikely:
                    firstUnlikelyOutcome.wasFalse,
                }
              : {}),
            ...(firstUnlikelyOutcome.targetReachedRow
              ? {
                  targetReachedAfterFirstUnlikelyAtUtc:
                    firstUnlikelyOutcome.targetReachedRow.obsTimeUtc,
                }
              : {}),
          }
        : {}),
      ...(firstCorrectUnlikelyOutcome
        ? {
            firstCorrectUnlikelyAtUtc:
              firstCorrectUnlikelyOutcome.prediction.generatedAt,
            firstCorrectUnlikelyAtLocal: formatDateTimeInTimezone(
              firstCorrectUnlikelyOutcome.prediction.generatedAt,
              SEOUL_TIMEZONE,
            ),
          }
        : {}),
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
    await markDecisionStateFinal(finalizedAt);
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
    const stateTargets = await ctx.runQuery(
      "seoulWeather:getHighPredictionStateTargetsInternal",
      { stationIcao, date },
    );
    const targetCs = Array.from(
      new Set(
        (stateTargets.length ? stateTargets : [SEOUL_RAW_TARGET_C]).map(
          (targetC) => normalizeDecisionTargetC(targetC),
        ),
      ),
    );
    const evaluations = [];
    for (const targetC of targetCs) {
      evaluations.push(
        await ctx.runMutation("seoulWeather:finalizeHighPredictionInternal", {
          stationIcao,
          date,
          targetC,
        }),
      );
    }
    return evaluations;
  },
});

export const getHighPredictionAccuracy = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    trailingDays: v.optional(v.number()),
    targetC: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(
      args.stationIcao ?? SEOUL_STATION.stationIcao,
    ).toUpperCase();
    if (stationIcao !== SEOUL_STATION.stationIcao) {
      throw new Error("The Seoul high accuracy query supports RKSI only.");
    }
    const targetC = normalizeDecisionTargetC(args.targetC);
    const trailingDays = clamp(Math.trunc(args.trailingDays ?? 30), 1, 365);
    const todayDate = formatDateInTimezone(Date.now(), SEOUL_TIMEZONE);
    const earliestDate = addUtcDays(todayDate, -trailingDays);
    const kmaApproved = hasApprovedKmaAmoAccess();
    const nmscApproved = hasApprovedNmscGk2aAccess();
    if (!kmaApproved || !nmscApproved) {
      const missingFlags = [
        !kmaApproved ? KMA_AMO_APPROVAL_FLAG : null,
        !nmscApproved ? NMSC_GK2A_APPROVAL_FLAG : null,
      ].filter(Boolean);
      return {
        status: "approval_required",
        approval: {
          approved: false,
          status: "approval_required",
          flagName: missingFlags[0],
          flagNames: missingFlags,
        },
        stationIcao,
        targetC,
        trailingDays,
        earliestDate,
        todayDate,
        ...summarizeEvaluations([]),
        evaluations: [],
      };
    }
    const rows = await ctx.db
      .query("seoulHighEvaluations")
      .withIndex("by_station_model_target_finalizedAt", (query) =>
        query
          .eq("stationIcao", stationIcao)
          .eq("modelVersion", PREDICTION_MODEL_VERSION)
          .eq("thresholdTargetC", targetC),
      )
      .order("desc")
      .take(365);
    const evaluations = rows.filter(
      (row) => row.targetDate >= earliestDate && row.targetDate < todayDate,
    );
    return {
      stationIcao,
      targetC,
      trailingDays,
      earliestDate,
      todayDate,
      ...summarizeEvaluations(evaluations),
      evaluations,
    };
  },
});

function isNmscDerivedBlockerCode(code) {
  return (
    String(code ?? "").startsWith("solar_") ||
    code === "rain_ended_with_clearing"
  );
}

function sanitizeNmscBlockers(codes = [], descriptions = []) {
  const keptCodes = [];
  const keptDescriptions = [];
  let removed = false;
  for (let index = 0; index < codes.length; index += 1) {
    if (isNmscDerivedBlockerCode(codes[index])) {
      removed = true;
      continue;
    }
    keptCodes.push(codes[index]);
    if (descriptions[index]) {
      keptDescriptions.push(descriptions[index]);
    }
  }
  return { codes: keptCodes, descriptions: keptDescriptions, removed };
}

function solarWasRequiredForStoredDecision(row) {
  if (typeof row?.solarDecisionRequired === "boolean") {
    return row.solarDecisionRequired;
  }
  // Rows created before solarDecisionRequired existed fail closed.
  return (
    row?.currentState === "peak_candidate" ||
    row?.currentState === "unlikely_to_reach" ||
    row?.decisionStatus === "peak_candidate" ||
    row?.decisionStatus === "unlikely_to_reach"
  );
}

function toCanonicalPagePrediction(prediction) {
  if (
    !prediction ||
    prediction.modelVersion !== PREDICTION_MODEL_VERSION ||
    !hasApprovedKmaAmoAccess()
  ) {
    return null;
  }
  const canonical = {
    ...prediction,
    providerDetails: (prediction.providerDetails ?? []).filter(
      (provider) =>
        provider.provider === "kma_amo" || provider.provider === "weathercom",
    ),
    hourlyEnsembleCurve: prediction.hourlyEnsembleCurve,
  };
  if (!hasApprovedNmscGk2aAccess()) {
    const solarDecisionRequired = solarWasRequiredForStoredDecision(prediction);
    const sanitizedBlockers = sanitizeNmscBlockers(
      canonical.blockerCodes ?? [],
      canonical.blockerDescriptions ?? [],
    );
    for (const field of Object.keys(canonical)) {
      if (field.startsWith("solar")) {
        delete canonical[field];
      }
    }
    delete canonical.rainEndedClearingRisk;
    canonical.blockerCodes = sanitizedBlockers.codes;
    canonical.blockerDescriptions = sanitizedBlockers.descriptions;
    if (
      solarDecisionRequired &&
      (canonical.decisionStatus === "peak_candidate" ||
        canonical.decisionStatus === "unlikely_to_reach")
    ) {
      canonical.decisionStatus = "still_possible";
      delete canonical.candidateSinceUtc;
      delete canonical.candidateSinceLocal;
      canonical.consecutivePasses = 0;
    }
    if (
      solarDecisionRequired &&
      canonical.decisionStatus !== "already_reached" &&
      canonical.decisionStatus !== "final"
    ) {
      canonical.blockerCodes.push("solar_approval_required");
      canonical.blockerDescriptions.push(
        `${NMSC_GK2A_APPROVAL_FLAG}=true approval is required before a GK2A-backed decision can be shown.`,
      );
    }
    if (solarDecisionRequired || sanitizedBlockers.removed) {
      canonical.reason =
        canonical.decisionStatus === "already_reached"
          ? `The representative 15L AMOS temperature has reached ${(canonical.targetC ?? SEOUL_RAW_TARGET_C).toFixed(1)}°C.`
          : (canonical.blockerDescriptions[0] ??
            "Stored GK2A-derived decision details are hidden while NMSC approval is inactive.");
    }
  }
  return canonical;
}

function toCanonicalPageDecisionState(decisionState) {
  if (!decisionState) {
    return null;
  }
  const solarDecisionRequired =
    solarWasRequiredForStoredDecision(decisionState);
  const publicState = { ...decisionState };
  delete publicState.solarDecisionRequired;
  delete publicState.lastKmaForecastCaptureId;
  delete publicState.lastKmaDailyHighC;
  delete publicState.lastKmaRemainingUpperC;
  delete publicState.lastKmaHourlyRows;
  if (hasApprovedNmscGk2aAccess()) {
    return publicState;
  }
  const sanitizedBlockers = sanitizeNmscBlockers(
    decisionState.blockerCodes ?? [],
    decisionState.blockerDescriptions ?? [],
  );
  const shouldDowngrade =
    solarDecisionRequired &&
    (decisionState.currentState === "peak_candidate" ||
      decisionState.currentState === "unlikely_to_reach");
  if (shouldDowngrade) {
    publicState.currentState = "still_possible";
    publicState.candidateSinceUtc = undefined;
    publicState.consecutivePasses = 0;
  }
  publicState.blockerCodes = sanitizedBlockers.codes;
  publicState.blockerDescriptions = sanitizedBlockers.descriptions;
  if (
    solarDecisionRequired &&
    publicState.currentState !== "already_reached" &&
    publicState.currentState !== "final"
  ) {
    publicState.blockerCodes.push("solar_approval_required");
    publicState.blockerDescriptions.push(
      `${NMSC_GK2A_APPROVAL_FLAG}=true approval is required before a GK2A-backed decision can be shown.`,
    );
  }
  return publicState;
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

function buildKmaForecastView({
  approved,
  captures,
  collectorState,
  targetDate,
  now,
}) {
  const base = {
    provider: "kma_amo",
    label: "KMA/AMO · RKSI",
    role: "primary",
    sourceUrl: KMA_AMO_AIRPORT_FORECAST_URL,
    staleAfterMinutes: MAX_KMA_CAPTURE_AGE_MS / MILLIS_PER_MINUTE,
    collectionCooldownSeconds: KMA_COLLECTION_COOLDOWN_SECONDS,
    collectionLockTimeoutSeconds: KMA_COLLECTION_LOCK_TIMEOUT_SECONDS,
  };
  if (!approved) {
    return {
      ...base,
      collector: {
        status: "approval_required",
      },
      status: "approval_required",
      latestAttemptStatus: "approval_required",
      latestAttempt: null,
      latestCapture: null,
      selectedDateForecast: null,
      hourlyRows: [],
      isStale: true,
    };
  }

  const latestAttempt = captures[0] ?? null;
  const latestSuccessfulCapture =
    captures.find(
      (capture) =>
        capture.status === WEATHER_STATUS.OK &&
        (capture.dailyRows ?? []).some((row) => row.date === targetDate),
    ) ?? null;
  const canonicalCapture = selectLatestUsableKmaCapture({
    captures,
    targetDate,
    generatedAt: now,
  });
  const latestSuccessAgeMinutes = latestSuccessfulCapture
    ? roundToTenth(
        Math.max(0, now - latestSuccessfulCapture.capturedAt) /
          MILLIS_PER_MINUTE,
      )
    : null;
  const isStale =
    !canonicalCapture ||
    !Number.isFinite(latestSuccessAgeMinutes) ||
    latestSuccessAgeMinutes > MAX_KMA_CAPTURE_AGE_MS / MILLIS_PER_MINUTE;
  const latestAttemptStatus = latestAttempt?.status ?? "no_data";
  const status =
    latestAttemptStatus === WEATHER_STATUS.ERROR
      ? WEATHER_STATUS.ERROR
      : !latestSuccessfulCapture
        ? "no_data"
        : isStale
          ? "stale"
          : WEATHER_STATUS.OK;
  const selectedDateForecast =
    latestSuccessfulCapture?.dailyRows?.find(
      (row) => row.date === targetDate,
    ) ?? null;
  const hourlyRows = (latestSuccessfulCapture?.hourlyRows ?? [])
    .filter((row) => row.date === targetDate && Number.isFinite(row.tempC))
    .map((row) => ({
      ...row,
      capturedAt: latestSuccessfulCapture.capturedAt,
      capturedAtLocal: latestSuccessfulCapture.capturedAtLocal,
    }));

  return {
    ...base,
    status,
    latestAttemptStatus,
    ...(latestAttempt?.error
      ? { latestAttemptError: latestAttempt.error }
      : {}),
    ...(Number.isFinite(latestAttempt?.capturedAt)
      ? {
          latestAttemptedAt: latestAttempt.capturedAt,
          latestAttemptedAtLocal: latestAttempt.capturedAtLocal,
        }
      : {}),
    ...(Number.isFinite(latestSuccessAgeMinutes)
      ? { latestSuccessAgeMinutes }
      : {}),
    latestAttempt,
    latestCapture: latestSuccessfulCapture,
    canonicalCapture,
    collector: collectorState ?? null,
    selectedDateForecast,
    hourlyRows,
    isStale,
  };
}

export const getHighPredictionDecisionSummaries = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    date: v.string(),
    targetCs: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(
      args.stationIcao ?? SEOUL_STATION.stationIcao,
    ).toUpperCase();
    if (stationIcao !== SEOUL_STATION.stationIcao) {
      throw new Error("The Seoul decision summary supports RKSI only.");
    }
    assertDateKey(args.date);
    if (args.targetCs.length > 3) {
      throw new Error(
        "At most three Seoul decision targets can be summarized.",
      );
    }
    const targetCs = Array.from(
      new Set(
        args.targetCs.map((targetC) => normalizeDecisionTargetC(targetC)),
      ),
    );
    if (!hasApprovedKmaAmoAccess()) {
      return {
        stationIcao,
        date: args.date,
        targets: [],
      };
    }

    const targets = await Promise.all(
      targetCs.map(async (targetC) => {
        const [decisionState, prediction] = await Promise.all([
          ctx.db
            .query("seoulPeakDecisionState")
            .withIndex("by_station_date_model_target", (query) =>
              query
                .eq("stationIcao", stationIcao)
                .eq("targetDate", args.date)
                .eq("modelVersion", PREDICTION_MODEL_VERSION)
                .eq("targetC", targetC),
            )
            .first(),
          ctx.db
            .query("seoulHighPredictions")
            .withIndex("by_station_date_model_target_revision", (query) =>
              query
                .eq("stationIcao", stationIcao)
                .eq("targetDate", args.date)
                .eq("modelVersion", PREDICTION_MODEL_VERSION)
                .eq("targetC", targetC),
            )
            .order("desc")
            .first(),
        ]);
        const publicDecisionState = toCanonicalPageDecisionState(decisionState);
        const publicPrediction = toCanonicalPagePrediction(prediction);
        return {
          targetC,
          decisionState: publicDecisionState
            ? {
                targetC: publicDecisionState.targetC,
                currentState: publicDecisionState.currentState,
                lastEvaluationAt: publicDecisionState.lastEvaluationAt,
              }
            : null,
          latestPrediction: publicPrediction
            ? {
                targetC: publicPrediction.targetC,
                decisionStatus: publicPrediction.decisionStatus,
                status: publicPrediction.status,
                generatedAt: publicPrediction.generatedAt,
              }
            : null,
        };
      }),
    );
    return {
      stationIcao,
      date: args.date,
      targets,
    };
  },
});

export const getHighPredictionDashboard = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    date: v.optional(v.string()),
    targetC: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(
      args.stationIcao ?? SEOUL_STATION.stationIcao,
    ).toUpperCase();
    if (stationIcao !== SEOUL_STATION.stationIcao) {
      throw new Error("The Seoul forecast dashboard supports RKSI only.");
    }
    const selectedTargetC = normalizeDecisionTargetC(args.targetC);
    const now = Date.now();
    const todayDate = formatDateInTimezone(now, SEOUL_TIMEZONE);
    const date = args.date ?? todayDate;
    assertDateKey(date);
    const nextDate = addUtcDays(date, 1);
    const nextMidnightUtc = Date.parse(`${nextDate}T00:00:00+09:00`);
    const kmaAccessApproved = hasApprovedKmaAmoAccess();
    const nmscDecisionAccessApproved = hasApprovedNmscGk2aAccess();

    const [
      summary,
      decisionState,
      revisionRows,
      kmaForecastCaptureRows,
      kmaForecastCollectorState,
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
      kmaAccessApproved
        ? ctx.db
            .query("seoulPeakDecisionState")
            .withIndex("by_station_date_model_target", (query) =>
              query
                .eq("stationIcao", stationIcao)
                .eq("targetDate", date)
                .eq("modelVersion", PREDICTION_MODEL_VERSION)
                .eq("targetC", selectedTargetC),
            )
            .first()
        : Promise.resolve(null),
      kmaAccessApproved
        ? ctx.db
            .query("seoulHighPredictions")
            .withIndex("by_station_date_model_target_revision", (query) =>
              query
                .eq("stationIcao", stationIcao)
                .eq("targetDate", date)
                .eq("modelVersion", PREDICTION_MODEL_VERSION)
                .eq("targetC", selectedTargetC),
            )
            .order("desc")
            .take(MAX_DASHBOARD_REVISIONS)
        : Promise.resolve([]),
      kmaAccessApproved
        ? ctx.db
            .query("seoulKmaForecastCaptures")
            .withIndex("by_station_capturedAt", (query) =>
              query.eq("stationIcao", stationIcao),
            )
            .order("desc")
            .take(MAX_FORECAST_CAPTURES_FOR_DAY)
        : Promise.resolve([]),
      kmaAccessApproved
        ? ctx.db
            .query("seoulKmaForecastCollectorStatus")
            .withIndex("by_station", (query) =>
              query.eq("stationIcao", stationIcao),
            )
            .first()
        : Promise.resolve(null),
      ctx.db
        .query("seoulForecastCaptures")
        .withIndex("by_station_capturedAt", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .order("desc")
        .take(MAX_FORECAST_CAPTURES_FOR_DAY),
      kmaAccessApproved && nmscDecisionAccessApproved
        ? ctx.db
            .query("seoulHighEvaluations")
            .withIndex("by_station_model_date_target", (query) =>
              query
                .eq("stationIcao", stationIcao)
                .eq("modelVersion", PREDICTION_MODEL_VERSION)
                .eq("targetDate", date)
                .eq("thresholdTargetC", selectedTargetC),
            )
            .first()
        : Promise.resolve(null),
      kmaAccessApproved && nmscDecisionAccessApproved
        ? ctx.db
            .query("seoulHighEvaluations")
            .withIndex("by_station_model_target_finalizedAt", (query) =>
              query
                .eq("stationIcao", stationIcao)
                .eq("modelVersion", PREDICTION_MODEL_VERSION)
                .eq("thresholdTargetC", selectedTargetC),
            )
            .order("desc")
            .take(30)
        : Promise.resolve([]),
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
    const latestPrediction = toCanonicalPagePrediction(
      revisionRows.find(
        (prediction) => prediction.modelVersion === PREDICTION_MODEL_VERSION,
      ) ?? null,
    );
    const publicDecisionState = toCanonicalPageDecisionState(decisionState);
    const revisions = [...revisionRows]
      .filter(
        (prediction) => prediction.modelVersion === PREDICTION_MODEL_VERSION,
      )
      .reverse()
      .map(toCanonicalPagePrediction)
      .filter(Boolean);
    const kmaForecast = buildKmaForecastView({
      approved: kmaAccessApproved,
      captures: kmaForecastCaptureRows,
      collectorState: kmaForecastCollectorState,
      targetDate: date,
      now,
    });
    const latestWeatherComCapture = selectLatestUsableWeatherComCapture({
      captures: forecastCaptureRows,
      targetDate: date,
      generatedAt: now,
    });
    const mergedWeatherComHourlyRows = mergeWeatherComHourlyRows(
      forecastCaptureRows,
      date,
    );
    const secondaryWeathercomForecastCapture = latestWeatherComCapture
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
      selectedTargetC,
      todayDate,
      isToday: date === todayDate,
      summary,
      decisionState: publicDecisionState,
      kmaAccess: {
        approved: kmaAccessApproved,
        status: kmaAccessApproved ? "approved" : "approval_required",
        flagName: KMA_AMO_APPROVAL_FLAG,
        sourceUrl: KMA_AMO_AIRPORT_FORECAST_URL,
      },
      nmscDecisionAccess: {
        approved: nmscDecisionAccessApproved,
        status: nmscDecisionAccessApproved ? "approved" : "approval_required",
        flagName: NMSC_GK2A_APPROVAL_FLAG,
      },
      kmaForecast,
      kmaCollector: kmaForecast.collector,
      latestKmaForecastCapture: kmaForecast.latestCapture,
      // Canonical compatibility alias. This no longer points at Weather.com.
      latestForecastCapture: kmaForecast.latestCapture,
      kmaHourlyDiagnostics: {
        status: kmaForecast.status,
        isStale: kmaForecast.isStale,
        staleAfterMinutes: kmaForecast.staleAfterMinutes,
        pointCount: kmaForecast.hourlyRows.length,
        points: kmaForecast.hourlyRows,
        latestCapture: kmaForecast.latestCapture,
        selectedDateForecast: kmaForecast.selectedDateForecast,
        ...(Number.isFinite(kmaForecast.latestSuccessAgeMinutes)
          ? {
              latestSuccessAgeMinutes: kmaForecast.latestSuccessAgeMinutes,
            }
          : {}),
        ...(kmaForecast.latestAttemptError
          ? { error: kmaForecast.latestAttemptError }
          : {}),
      },
      latestPrediction,
      revisions,
      secondaryWeathercomForecastCapture,
      weathercomHourlyDiagnostics,
      evaluation,
      accuracy: nmscDecisionAccessApproved
        ? summarizeEvaluations(accuracyRows)
        : null,
    };
  },
});
