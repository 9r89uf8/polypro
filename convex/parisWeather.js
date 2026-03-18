import { actionGeneric } from "convex/server";
import { v } from "convex/values";

const PARIS_TIMEZONE = "Europe/Paris";
const WEATHERCOM_API_BASE_URL = "https://api.weather.com";
const WEATHERCOM_CURRENT_CONDITIONS_URL =
  `${WEATHERCOM_API_BASE_URL}/v3/wx/observations/current`;
const WEATHERCOM_DAILY_FORECAST_URL =
  `${WEATHERCOM_API_BASE_URL}/v3/wx/forecast/daily/5day`;
const AVIATION_WEATHER_METAR_DATA_URL =
  "https://aviationweather.gov/api/data/metar";
const DEFAULT_WEATHERCOM_LANGUAGE = "en-US";
const WEATHERCOM_FALLBACK_API_KEY = "71f92ea9dd2f4790b92ea9dd2f779061";
const GOOGLE_WEATHER_BASE_URL = "https://weather.googleapis.com/v1";
const GOOGLE_HOURLY_FORECAST_URL =
  `${GOOGLE_WEATHER_BASE_URL}/forecast/hours:lookup`;
const DEFAULT_GOOGLE_LANGUAGE = "en";
const GOOGLE_HOURLY_FORECAST_HOURS = 120;
const GOOGLE_HOURLY_PAGE_SIZE = 24;
const WEATHERCOM_STATUS = {
  OK: "ok",
  ERROR: "error",
};

const PARIS_STATION = {
  stationIcao: "LFPG",
  stationName: "Paris Charles de Gaulle Airport",
  lat: 49.0097,
  lon: 2.5479,
  timeZone: PARIS_TIMEZONE,
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

function normalizeWeatherComCurrentTemp(payload, requestedUnit) {
  const normalized = normalizeWeatherComTempPair(payload?.temperature, requestedUnit);
  if (Number.isFinite(normalized.tempC) && Number.isFinite(normalized.tempF)) {
    return {
      tempC: roundToTenth(normalized.tempC),
      tempF: roundToTenth(normalized.tempF),
    };
  }
  return null;
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
      ...(minimum.tempC !== undefined ? { minTempC: minimum.tempC } : {}),
      ...(minimum.tempF !== undefined ? { minTempF: minimum.tempF } : {}),
      ...(maximum.tempC !== undefined ? { maxTempC: maximum.tempC } : {}),
      ...(maximum.tempF !== undefined ? { maxTempF: maximum.tempF } : {}),
      ...(dayPhrase ? { dayPhrase } : {}),
      ...(nightPhrase ? { nightPhrase } : {}),
    });
  }

  return normalizedRows;
}

function normalizeGoogleHourlyRows(payload, requestedUnit, timeZone) {
  const rows = [];
  const forecastHours = Array.isArray(payload?.forecastHours)
    ? payload.forecastHours
    : [];

  for (const row of forecastHours) {
    const validTimeUtc = parseValidUtcEpoch(row?.interval?.startTime);
    const temperature = normalizeWeatherComTempPair(
      row?.temperature?.degrees,
      requestedUnit,
    );

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

function parseSignedMetarTemp(tempToken) {
  if (!tempToken || tempToken === "//") {
    return null;
  }
  const cleaned = String(tempToken).trim();
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

function extractMetarTempInfo(rawMetar) {
  if (!rawMetar) {
    return null;
  }

  const remarkMatch = rawMetar.match(/\bT([01])(\d{3})([01])(\d{3})\b/);
  if (remarkMatch) {
    const isNegative = remarkMatch[1] === "1";
    const magnitude = Number(remarkMatch[2]) / 10;
    const tempC = isNegative ? -magnitude : magnitude;
    return {
      tempC: roundToTenth(tempC),
      sourceDetail: "remark_T",
    };
  }

  const mainTempMatch = rawMetar.match(/\b(M?\d{2})\/(M?\d{2}|\/\/)\b/);
  if (!mainTempMatch) {
    return null;
  }

  const parsedTemp = parseSignedMetarTemp(mainTempMatch[1]);
  if (parsedTemp === null) {
    return null;
  }

  return {
    tempC: parsedTemp,
    sourceDetail: "metar_integer",
  };
}

function parseReportTimestampFromRaw(rawMetar, referenceEpochMs = Date.now()) {
  const match = /^(?:(METAR|SPECI)\s+)?([A-Z0-9]{4})\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(
    String(rawMetar ?? "").trim(),
  );
  if (!match) {
    return null;
  }

  const now = new Date(referenceEpochMs);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const reportDay = Number(match[3]);
  const reportHour = Number(match[4]);
  const reportMinute = Number(match[5]);

  const candidates = [
    Date.UTC(
      currentYear,
      currentMonth - 1,
      reportDay,
      reportHour,
      reportMinute,
      0,
      0,
    ),
    Date.UTC(
      currentYear,
      currentMonth,
      reportDay,
      reportHour,
      reportMinute,
      0,
      0,
    ),
    Date.UTC(
      currentYear,
      currentMonth + 1,
      reportDay,
      reportHour,
      reportMinute,
      0,
      0,
    ),
  ].filter(Number.isFinite);

  let bestCandidate = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - referenceEpochMs);
    if (distance < bestDistance) {
      bestCandidate = candidate;
      bestDistance = distance;
    }
  }

  return bestCandidate;
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

function getGoogleWeatherApiKey() {
  return toNonEmptyString(process.env.GOOGLE_WEATHER_API_KEY);
}

async function fetchWeatherComCurrentReading({
  geocode,
  unit,
  language,
  apiKey,
  timeZone,
}) {
  const url = new URL(WEATHERCOM_CURRENT_CONDITIONS_URL);
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
      `Weather.com current conditions failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const normalizedTemp = normalizeWeatherComCurrentTemp(payload, unit);
  if (!normalizedTemp) {
    throw new Error("Weather.com current conditions response missing temperature.");
  }

  const validTimeUtcSeconds = toFiniteNumber(payload?.validTimeUtc);
  const observedAtUtc =
    (validTimeUtcSeconds !== null ? Math.round(validTimeUtcSeconds * 1000) : null) ??
    parseValidUtcEpoch(payload?.validTimeLocal) ??
    Date.now();
  const phrase =
    toNonEmptyString(payload?.wxPhraseLong) ??
    toNonEmptyString(payload?.wxPhraseMedium) ??
    toNonEmptyString(payload?.wxPhraseShort) ??
    null;

  return {
    source: "weathercom_current",
    status: WEATHERCOM_STATUS.OK,
    observedAtUtc,
    observedAtLocal: formatDateTimeInTimezone(observedAtUtc, timeZone),
    tempC: normalizedTemp.tempC,
    tempF: normalizedTemp.tempF,
    ...(phrase ? { raw: phrase } : {}),
  };
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
    rows.push(...normalizeGoogleHourlyRows(payload, unit, timeZone));
    nextPageToken = toNonEmptyString(payload?.nextPageToken);
  } while (nextPageToken);

  if (!rows.length) {
    throw new Error("Google hourly forecast returned no usable rows.");
  }

  return rows;
}

async function fetchNoaaOfficialDayMax({ stationIcao, date, timeZone }) {
  const url = new URL(AVIATION_WEATHER_METAR_DATA_URL);
  url.searchParams.set("ids", stationIcao);
  url.searchParams.set("format", "raw");
  url.searchParams.set("hours", "48");

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      Accept: "text/plain",
      "Cache-Control": "no-cache",
    },
  });
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(
      `AviationWeather METAR request failed (${response.status}): ${rawText.slice(0, 220)}`,
    );
  }

  const rawRows = String(rawText ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => new RegExp(`\\b${stationIcao}\\b`, "i").test(line));

  const rows = [];
  const now = Date.now();
  for (const rawMetar of rawRows) {
    const obsTimeUtc = parseReportTimestampFromRaw(rawMetar, now);
    if (!Number.isFinite(obsTimeUtc)) {
      continue;
    }

    const localDate = formatDateInTimezone(obsTimeUtc, timeZone);
    if (localDate !== date) {
      continue;
    }

    const tempInfo = extractMetarTempInfo(rawMetar);
    if (!tempInfo) {
      continue;
    }

    const tempC = roundToTenth(tempInfo.tempC);
    rows.push({
      obsTimeUtc,
      obsTimeLocal: formatDateTimeInTimezone(obsTimeUtc, timeZone),
      tempC,
      tempF: toFahrenheit(tempC),
      rawMetar,
      source: `aviationweather_api:${tempInfo.sourceDetail}`,
    });
  }

  let maxRow = null;
  for (const row of rows) {
    if (
      !maxRow ||
      row.tempC > maxRow.tempC ||
      (row.tempC === maxRow.tempC && row.obsTimeUtc > maxRow.obsTimeUtc)
    ) {
      maxRow = row;
    }
  }

  return {
    status: WEATHERCOM_STATUS.OK,
    date,
    obsCount: rows.length,
    ...(maxRow
      ? {
          maxTempC: maxRow.tempC,
          maxTempF: maxRow.tempF,
          maxAtUtc: maxRow.obsTimeUtc,
          maxAtLocal: maxRow.obsTimeLocal,
          rawMetar: maxRow.rawMetar,
          source: maxRow.source,
        }
      : {}),
  };
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
    const geocode = `${PARIS_STATION.lat},${PARIS_STATION.lon}`;
    const unit = "metric";
    const weatherComLanguage = DEFAULT_WEATHERCOM_LANGUAGE;
    const googleLanguage = normalizeGoogleLanguage(DEFAULT_GOOGLE_LANGUAGE);
    const todayDate = formatDateInTimezone(Date.now(), PARIS_STATION.timeZone);
    const googleApiKey = getGoogleWeatherApiKey();

    const [
      currentReading,
      forecastResult,
      hourlyResult,
      noaaOfficialMax,
    ] = await Promise.all([
      (async () => {
        if (!apiKey) {
          return {
            source: "weathercom_current",
            status: WEATHERCOM_STATUS.ERROR,
            error: "Missing WEATHERCOM_API_KEY.",
          };
        }
        try {
          return await fetchWeatherComCurrentReading({
            geocode,
            unit,
            language: weatherComLanguage,
            apiKey,
            timeZone: PARIS_STATION.timeZone,
          });
        } catch (error) {
          return {
            source: "weathercom_current",
            status: WEATHERCOM_STATUS.ERROR,
            error: formatErrorMessage(error),
          };
        }
      })(),
      (async () => {
        if (!apiKey) {
          return {
            status: WEATHERCOM_STATUS.ERROR,
            error: "Missing WEATHERCOM_API_KEY.",
            days: [],
          };
        }
        try {
          const days = await fetchWeatherComDailyForecast({
            geocode,
            durationDays: 5,
            unit,
            language: weatherComLanguage,
            apiKey,
            timeZone: PARIS_STATION.timeZone,
          });
          return {
            status: WEATHERCOM_STATUS.OK,
            days,
          };
        } catch (error) {
          return {
            status: WEATHERCOM_STATUS.ERROR,
            error: formatErrorMessage(error),
            days: [],
          };
        }
      })(),
      (async () => {
        if (!googleApiKey) {
          return {
            status: WEATHERCOM_STATUS.ERROR,
            error: "Missing GOOGLE_WEATHER_API_KEY.",
            rows: [],
          };
        }
        try {
          const rows = await fetchGoogleHourlyForecast({
            station: PARIS_STATION,
            hours: GOOGLE_HOURLY_FORECAST_HOURS,
            unit,
            language: googleLanguage,
            apiKey: googleApiKey,
            timeZone: PARIS_STATION.timeZone,
          });
          return {
            status: WEATHERCOM_STATUS.OK,
            rows,
          };
        } catch (error) {
          return {
            status: WEATHERCOM_STATUS.ERROR,
            error: formatErrorMessage(error),
            rows: [],
          };
        }
      })(),
      (async () => {
        try {
          return await fetchNoaaOfficialDayMax({
            stationIcao: PARIS_STATION.stationIcao,
            date: todayDate,
            timeZone: PARIS_STATION.timeZone,
          });
        } catch (error) {
          return {
            status: WEATHERCOM_STATUS.ERROR,
            date: todayDate,
            obsCount: 0,
            error: formatErrorMessage(error),
          };
        }
      })(),
    ]);

    return {
      stationIcao: PARIS_STATION.stationIcao,
      stationName: PARIS_STATION.stationName,
      todayDate,
      currentReading,
      forecast: forecastResult,
      hourly: hourlyResult,
      selectedDateForecast:
        forecastResult.days.find((day) => day.date === args.date) ?? null,
      selectedDatePeak: selectPeakForecastRow(hourlyResult.rows, args.date),
      todayPeak: selectPeakForecastRow(hourlyResult.rows, todayDate),
      noaaOfficialMax,
    };
  },
});
