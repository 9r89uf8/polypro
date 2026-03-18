import { actionGeneric } from "convex/server";
import { v } from "convex/values";

const SEOUL_TIMEZONE = "Asia/Seoul";
const WEATHERCOM_API_BASE_URL = "https://api.weather.com";
const WEATHERCOM_DAILY_FORECAST_URL =
  `${WEATHERCOM_API_BASE_URL}/v3/wx/forecast/daily/5day`;
const DEFAULT_WEATHERCOM_LANGUAGE = "en-US";
const WEATHERCOM_FALLBACK_API_KEY = "71f92ea9dd2f4790b92ea9dd2f779061";
const WEATHER_STATUS = {
  OK: "ok",
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

function formatDateInTimezone(epochMs, timeZone) {
  const parts = getDateParts(getDateFormatter(timeZone), new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
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

function normalizeWeatherComTempPair(value, requestedUnit) {
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
    const maxValue =
      payload?.temperatureMax?.[i] ?? payload?.calendarDayTemperatureMax?.[i];
    const minValue =
      payload?.temperatureMin?.[i] ?? payload?.calendarDayTemperatureMin?.[i];
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
  geocode,
  durationDays,
  unit,
  language,
  apiKey,
  timeZone,
}) {
  const url = new URL(WEATHERCOM_DAILY_FORECAST_URL);
  url.searchParams.set("geocode", geocode);
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

export const getDayPageWeather = actionGeneric({
  args: {
    date: v.string(),
  },
  handler: async (_ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const apiKey = getWeatherComApiKey();
    const geocode = `${SEOUL_STATION.lat},${SEOUL_STATION.lon}`;
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
          geocode,
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
