import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const CHICAGO_TIMEZONE = "America/Chicago";
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const IEM_ASOS_BASE_URL =
  "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py";
const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";
const MICROSOFT_DAILY_FORECAST_URL =
  "https://atlas.microsoft.com/weather/forecast/daily/json";
const MICROSOFT_CURRENT_CONDITIONS_URL =
  "https://atlas.microsoft.com/weather/currentConditions/json";
const ACCUWEATHER_BASE_URL = "https://dataservice.accuweather.com";
const ACCUWEATHER_GEO_POSITION_URL =
  `${ACCUWEATHER_BASE_URL}/locations/v1/cities/geoposition/search`;
const ACCUWEATHER_CURRENT_CONDITIONS_BASE_URL =
  `${ACCUWEATHER_BASE_URL}/currentconditions/v1`;
const ACCUWEATHER_DAILY_FORECAST_BASE_URL =
  `${ACCUWEATHER_BASE_URL}/forecasts/v1/daily/5day`;
const GOOGLE_WEATHER_BASE_URL = "https://weather.googleapis.com/v1";
const GOOGLE_CURRENT_CONDITIONS_URL =
  `${GOOGLE_WEATHER_BASE_URL}/currentConditions:lookup`;
const GOOGLE_DAILY_FORECAST_URL =
  `${GOOGLE_WEATHER_BASE_URL}/forecast/days:lookup`;
const WEATHERCOM_TENDAY_BASE_URL = "https://weather.com/weather/tenday/l";
const WEATHERCOM_API_BASE_URL = "https://api.weather.com";
const WEATHERCOM_LOCATION_POINT_URL = `${WEATHERCOM_API_BASE_URL}/v3/location/point`;
const WEATHERCOM_DAILY_FORECAST_URL = `${WEATHERCOM_API_BASE_URL}/v3/wx/forecast/daily/10day`;
const WEATHERCOM_CURRENT_CONDITIONS_URL = `${WEATHERCOM_API_BASE_URL}/v3/wx/observations/current`;
const WEATHERCOM_FALLBACK_API_KEY = "71f92ea9dd2f4790b92ea9dd2f779061";
const DEFAULT_MICROSOFT_UNIT = "imperial";
const DEFAULT_MICROSOFT_LANGUAGE = "en-US";
const DEFAULT_ACCUWEATHER_LANGUAGE = "en-us";
const DEFAULT_GOOGLE_LANGUAGE = "en";
const DEFAULT_WEATHERCOM_LANGUAGE = "en-US";
const ALLOWED_FORECAST_DURATIONS = new Set([1, 5, 10, 15, 25, 45]);
const MAX_QUERY_LIMIT = 240;
const RETRY_DELAYS_MS = [1000, 3000];
const ACCUWEATHER_LOCATION_KEY_TTL_MS = 1000 * 60 * 60 * 24;

const SNAPSHOT_STATUS = {
  OK: "ok",
  PARTIAL: "partial",
  ERROR: "error",
};

const MICROSOFT_STATUS = {
  OK: "ok",
  ERROR: "error",
};

const ACCUWEATHER_STATUS = {
  OK: "ok",
  ERROR: "error",
};

const GOOGLE_STATUS = {
  OK: "ok",
  ERROR: "error",
};

const WEATHERCOM_STATUS = {
  OK: "ok",
  ERROR: "error",
};

const SOURCE_STATUS = {
  OK: "ok",
  ERROR: "error",
};

const STATIONS = {
  KORD: {
    stationIcao: "KORD",
    stationIem: "ORD",
    stationName: "Chicago O'Hare International Airport",
    lat: 41.9742,
    lon: -87.9073,
    weatherComPlaceId:
      "5473f6c4da1a6479bbeaa444d174bea30ba2252fbbb29ec330b761a58a55287b",
  },
};

const accuweatherLocationKeyCache = new Map();

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

const sourceReadingValidator = v.object({
  source: v.string(),
  status: v.union(v.literal(SOURCE_STATUS.OK), v.literal(SOURCE_STATUS.ERROR)),
  observedAtUtc: v.optional(v.number()),
  observedAtLocal: v.optional(v.string()),
  tempC: v.optional(v.number()),
  tempF: v.optional(v.number()),
  raw: v.optional(v.string()),
  error: v.optional(v.string()),
});

const microsoftForecastDayValidator = v.object({
  date: v.string(),
  minTempC: v.optional(v.number()),
  minTempF: v.optional(v.number()),
  maxTempC: v.optional(v.number()),
  maxTempF: v.optional(v.number()),
  dayPhrase: v.optional(v.string()),
  nightPhrase: v.optional(v.string()),
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

function formatChicagoDate(epochMs) {
  const parts = getDateParts(chicagoDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatChicagoDateTime(epochMs) {
  const parts = getDateParts(chicagoDateTimeFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
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

function extractTempInfo(rawMetar, tmpfField) {
  if (rawMetar) {
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
    if (mainTempMatch) {
      const parsedTemp = parseSignedMetarTemp(mainTempMatch[1]);
      if (parsedTemp !== null) {
        return {
          tempC: parsedTemp,
          sourceDetail: "metar_integer",
        };
      }
    }
  }

  if (tmpfField !== undefined && tmpfField !== null && tmpfField !== "") {
    const tempF = Number(tmpfField);
    if (Number.isFinite(tempF)) {
      return {
        tempC: toCelsius(tempF),
        sourceDetail: "tmpf",
      };
    }
  }

  return null;
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

function normalizeMicrosoftTempUnit(unitValue, requestedUnit) {
  const raw = String(unitValue ?? "").trim().toUpperCase();
  if (raw === "C" || raw === "CELSIUS") {
    return "C";
  }
  if (raw === "F" || raw === "FAHRENHEIT") {
    return "F";
  }
  if (raw === "K" || raw === "KELVIN") {
    return "K";
  }
  return requestedUnit === "metric" ? "C" : "F";
}

function normalizeTempPair(value, unitValue, requestedUnit) {
  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return {};
  }

  const normalizedUnit = normalizeMicrosoftTempUnit(unitValue, requestedUnit);
  if (normalizedUnit === "C") {
    const tempC = roundToTenth(parsed);
    return { tempC, tempF: toFahrenheit(tempC) };
  }
  if (normalizedUnit === "K") {
    const tempC = roundToTenth(parsed - 273.15);
    return { tempC, tempF: toFahrenheit(tempC) };
  }

  const tempF = roundToTenth(parsed);
  return { tempF, tempC: toCelsius(tempF) };
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

function normalizeMicrosoftForecastDays(payload, durationDays, requestedUnit) {
  const rows = Array.isArray(payload?.forecasts) ? payload.forecasts : [];
  const fallbackStartDate = formatChicagoDate(Date.now());
  const normalizedRows = [];

  for (let i = 0; i < rows.length && normalizedRows.length < durationDays; i += 1) {
    const row = rows[i];
    const date = extractIsoDate(row?.date) ?? addUtcDays(fallbackStartDate, i);

    const minimumNode = row?.temperature?.minimum;
    const maximumNode = row?.temperature?.maximum;
    const minimum = normalizeTempPair(
      minimumNode?.value ?? minimumNode,
      minimumNode?.unit,
      requestedUnit,
    );
    const maximum = normalizeTempPair(
      maximumNode?.value ?? maximumNode,
      maximumNode?.unit,
      requestedUnit,
    );

    const dayPhrase =
      toNonEmptyString(row?.day?.shortPhrase) ??
      toNonEmptyString(row?.day?.iconPhrase) ??
      toNonEmptyString(row?.day?.phrase);
    const nightPhrase =
      toNonEmptyString(row?.night?.shortPhrase) ??
      toNonEmptyString(row?.night?.iconPhrase) ??
      toNonEmptyString(row?.night?.phrase);

    const normalized = {
      date,
      ...(minimum.tempC !== undefined ? { minTempC: minimum.tempC } : {}),
      ...(minimum.tempF !== undefined ? { minTempF: minimum.tempF } : {}),
      ...(maximum.tempC !== undefined ? { maxTempC: maximum.tempC } : {}),
      ...(maximum.tempF !== undefined ? { maxTempF: maximum.tempF } : {}),
      ...(dayPhrase ? { dayPhrase } : {}),
      ...(nightPhrase ? { nightPhrase } : {}),
    };
    normalizedRows.push(normalized);
  }

  return normalizedRows;
}

function makeSourceErrorReading(source, error) {
  return {
    source,
    status: SOURCE_STATUS.ERROR,
    error: formatErrorMessage(error),
  };
}

function normalizeAccuWeatherLanguage(language) {
  return (
    toNonEmptyString(language)?.toLowerCase() ?? DEFAULT_ACCUWEATHER_LANGUAGE
  );
}

function getConfiguredAccuWeatherLocationKey(stationIcao) {
  return (
    toNonEmptyString(process.env[`ACCUWEATHER_LOCATION_KEY_${stationIcao}`]) ??
    toNonEmptyString(process.env.ACCUWEATHER_LOCATION_KEY)
  );
}

function getCachedAccuWeatherLocationKey(cacheKey) {
  const cached = accuweatherLocationKeyCache.get(cacheKey);
  if (!cached || typeof cached !== "object") {
    return null;
  }
  if (!Number.isFinite(cached.expiresAt) || cached.expiresAt < Date.now()) {
    accuweatherLocationKeyCache.delete(cacheKey);
    return null;
  }
  const locationKey = toNonEmptyString(cached.locationKey);
  return locationKey ?? null;
}

function cacheAccuWeatherLocationKey(cacheKey, locationKey) {
  accuweatherLocationKeyCache.set(cacheKey, {
    locationKey,
    expiresAt: Date.now() + ACCUWEATHER_LOCATION_KEY_TTL_MS,
  });
}

async function fetchAccuWeatherJson(url, apiKey) {
  const request = async (requestUrl, includeAuthorization) => {
    return await fetch(requestUrl.toString(), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        ...(includeAuthorization
          ? { Authorization: `Bearer ${apiKey}` }
          : {}),
      },
    });
  };

  let response = await request(url, true);
  if (
    !response.ok &&
    (response.status === 401 || response.status === 403) &&
    !url.searchParams.has("apikey")
  ) {
    const fallbackUrl = new URL(url.toString());
    fallbackUrl.searchParams.set("apikey", apiKey);
    response = await request(fallbackUrl, false);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `AccuWeather request failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  return await response.json();
}

async function resolveAccuWeatherLocationKey({ station, language, apiKey }) {
  const configuredLocationKey = getConfiguredAccuWeatherLocationKey(
    station.stationIcao,
  );
  if (configuredLocationKey) {
    return configuredLocationKey;
  }

  const cacheKey = `${station.stationIcao}:${language}`;
  const cachedLocationKey = getCachedAccuWeatherLocationKey(cacheKey);
  if (cachedLocationKey) {
    return cachedLocationKey;
  }

  const url = new URL(ACCUWEATHER_GEO_POSITION_URL);
  url.searchParams.set("q", `${station.lat},${station.lon}`);
  url.searchParams.set("language", language);

  const payload = await fetchAccuWeatherJson(url, apiKey);
  const locationKey = toNonEmptyString(payload?.Key);
  if (!locationKey) {
    throw new Error("AccuWeather geoposition response missing location key.");
  }

  cacheAccuWeatherLocationKey(cacheKey, locationKey);
  return locationKey;
}

function normalizeAccuWeatherForecastDays(payload, durationDays, requestedUnit) {
  const rows = Array.isArray(payload?.DailyForecasts) ? payload.DailyForecasts : [];
  const fallbackStartDate = formatChicagoDate(Date.now());
  const normalizedRows = [];
  const maxRows = Math.min(durationDays, 5);

  for (let i = 0; i < rows.length && normalizedRows.length < maxRows; i += 1) {
    const row = rows[i];
    const date = extractIsoDate(row?.Date) ?? addUtcDays(fallbackStartDate, i);

    const minimumNode = row?.Temperature?.Minimum;
    const maximumNode = row?.Temperature?.Maximum;
    const minimum = normalizeTempPair(
      minimumNode?.Value,
      minimumNode?.Unit,
      requestedUnit,
    );
    const maximum = normalizeTempPair(
      maximumNode?.Value,
      maximumNode?.Unit,
      requestedUnit,
    );

    const dayPhrase =
      toNonEmptyString(row?.Day?.LongPhrase) ??
      toNonEmptyString(row?.Day?.IconPhrase);
    const nightPhrase =
      toNonEmptyString(row?.Night?.LongPhrase) ??
      toNonEmptyString(row?.Night?.IconPhrase);

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

function normalizeAccuWeatherCurrentTemp(row, requestedUnit) {
  const metric = normalizeTempPair(
    row?.Temperature?.Metric?.Value,
    row?.Temperature?.Metric?.Unit,
    requestedUnit,
  );
  if (Number.isFinite(metric.tempC) && Number.isFinite(metric.tempF)) {
    return {
      tempC: roundToTenth(metric.tempC),
      tempF: roundToTenth(metric.tempF),
    };
  }

  const imperial = normalizeTempPair(
    row?.Temperature?.Imperial?.Value,
    row?.Temperature?.Imperial?.Unit,
    requestedUnit,
  );
  if (Number.isFinite(imperial.tempC) && Number.isFinite(imperial.tempF)) {
    return {
      tempC: roundToTenth(imperial.tempC),
      tempF: roundToTenth(imperial.tempF),
    };
  }

  const fallback = normalizeTempPair(
    row?.Temperature?.Value ?? row?.Temperature,
    row?.Temperature?.Unit,
    requestedUnit,
  );
  if (Number.isFinite(fallback.tempC) && Number.isFinite(fallback.tempF)) {
    return {
      tempC: roundToTenth(fallback.tempC),
      tempF: roundToTenth(fallback.tempF),
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

function normalizeGoogleDate(dateNode) {
  const year = toFiniteNumber(dateNode?.year);
  const month = toFiniteNumber(dateNode?.month);
  const day = toFiniteNumber(dateNode?.day);
  if (
    year === null ||
    month === null ||
    day === null ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractGoogleDescription(node) {
  return (
    toNonEmptyString(node?.weatherCondition?.description?.text) ??
    toNonEmptyString(node?.weatherCondition?.description) ??
    toNonEmptyString(node?.weatherCondition?.type) ??
    null
  );
}

function normalizeGoogleForecastDays(payload, durationDays, requestedUnit) {
  const rows = Array.isArray(payload?.forecastDays) ? payload.forecastDays : [];
  const fallbackStartDate = formatChicagoDate(Date.now());
  const normalizedRows = [];
  const maxRows = Math.min(durationDays, 10);

  for (let i = 0; i < rows.length && normalizedRows.length < maxRows; i += 1) {
    const row = rows[i];
    const date =
      normalizeGoogleDate(row?.displayDate) ??
      extractIsoDate(row?.interval?.startTime) ??
      addUtcDays(fallbackStartDate, i);

    const minimum = normalizeTempPair(
      row?.minTemperature?.degrees,
      row?.minTemperature?.unit,
      requestedUnit,
    );
    const maximum = normalizeTempPair(
      row?.maxTemperature?.degrees,
      row?.maxTemperature?.unit,
      requestedUnit,
    );
    const dayPhrase = extractGoogleDescription(row?.daytimeForecast);
    const nightPhrase = extractGoogleDescription(row?.nighttimeForecast);

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

function normalizeGoogleCurrentTemp(payload, requestedUnit) {
  const normalized = normalizeTempPair(
    payload?.temperature?.degrees,
    payload?.temperature?.unit,
    requestedUnit,
  );
  if (Number.isFinite(normalized.tempC) && Number.isFinite(normalized.tempF)) {
    return {
      tempC: roundToTenth(normalized.tempC),
      tempF: roundToTenth(normalized.tempF),
    };
  }
  return null;
}

function normalizeWeatherComLanguage(language) {
  return toNonEmptyString(language) ?? DEFAULT_WEATHERCOM_LANGUAGE;
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

function extractWeatherComPlaceId(rawUrl) {
  const value = String(rawUrl ?? "");
  const match = value.match(/\/weather\/tenday\/l\/([0-9a-f]{32,})/i);
  return match ? match[1] : null;
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

function normalizeWeatherComForecastDays(payload, durationDays, requestedUnit) {
  const fallbackStartDate = formatChicagoDate(Date.now());
  const normalizedRows = [];
  const maxRows = Math.min(durationDays, 10);
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
      (validTimeUtc !== null ? formatChicagoDate(validTimeUtc * 1000) : null) ??
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

    if (
      !date &&
      minimum.tempC === undefined &&
      minimum.tempF === undefined &&
      maximum.tempC === undefined &&
      maximum.tempF === undefined &&
      !dayPhrase &&
      !nightPhrase
    ) {
      continue;
    }

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

async function fetchWeatherComTendayPage(station) {
  const placeId = toNonEmptyString(station.weatherComPlaceId);
  if (!placeId) {
    throw new Error(
      `Missing Weather.com place id for station ${station.stationIcao}.`,
    );
  }

  const url = `${WEATHERCOM_TENDAY_BASE_URL}/${placeId}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/html",
      "Cache-Control": "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Weather.com tenday page failed (${response.status}).`);
  }

  const html = await response.text();
  const canonicalMatch = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  );
  const canonicalUrl = canonicalMatch?.[1] ?? response.url ?? url;
  const canonicalPlaceId =
    extractWeatherComPlaceId(canonicalUrl) ??
    extractWeatherComPlaceId(response.url) ??
    placeId;

  return {
    canonicalUrl,
    placeId: canonicalPlaceId,
  };
}

async function fetchWeatherComLocationPoint({ placeId, language, apiKey }) {
  const url = new URL(WEATHERCOM_LOCATION_POINT_URL);
  url.searchParams.set("placeid", placeId);
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
      `Weather.com location point failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const location = payload?.location ?? payload;
  const lat = toFiniteNumber(location?.latitude);
  const lon = toFiniteNumber(location?.longitude);
  if (lat === null || lon === null) {
    throw new Error("Weather.com location point response missing geocode.");
  }

  return {
    lat,
    lon,
  };
}

async function fetchWeatherComDailyForecast({
  geocode,
  durationDays,
  unit,
  language,
  apiKey,
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
  const forecastDays = normalizeWeatherComForecastDays(payload, durationDays, unit);
  const minimumRequiredRows = durationDays >= 5 ? 5 : 1;
  if (forecastDays.length < minimumRequiredRows) {
    throw new Error(
      `Weather.com daily forecast returned ${forecastDays.length} usable rows.`,
    );
  }
  return forecastDays;
}

async function fetchWeatherComCurrentReading({ geocode, unit, language, apiKey }) {
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
    status: SOURCE_STATUS.OK,
    observedAtUtc,
    observedAtLocal: formatChicagoDateTime(observedAtUtc),
    tempC: normalizedTemp.tempC,
    tempF: normalizedTemp.tempF,
    ...(phrase ? { raw: phrase } : {}),
  };
}

async function fetchWeatherComForecastAndCurrent({
  station,
  durationDays,
  unit,
  language,
}) {
  const apiKey = getWeatherComApiKey();
  if (!apiKey) {
    const error = "Missing WEATHERCOM_API_KEY.";
    return {
      status: WEATHERCOM_STATUS.ERROR,
      error,
      forecastDays: [],
      currentReading: makeSourceErrorReading("weathercom_current", error),
    };
  }

  const weatherComLanguage = normalizeWeatherComLanguage(language);
  let placeId = toNonEmptyString(station.weatherComPlaceId);
  let crawlError = null;

  try {
    const page = await fetchWeatherComTendayPage(station);
    placeId = page.placeId ?? placeId;
  } catch (error) {
    crawlError = formatErrorMessage(error);
  }

  if (!placeId) {
    const error = crawlError ?? "Unable to resolve Weather.com place id.";
    return {
      status: WEATHERCOM_STATUS.ERROR,
      error,
      forecastDays: [],
      currentReading: makeSourceErrorReading("weathercom_current", error),
    };
  }

  let geocode = `${station.lat},${station.lon}`;
  try {
    const point = await fetchWeatherComLocationPoint({
      placeId,
      language: weatherComLanguage,
      apiKey,
    });
    geocode = `${point.lat},${point.lon}`;
  } catch (error) {
    if (!crawlError) {
      crawlError = formatErrorMessage(error);
    }
  }

  const [forecastResult, currentReading] = await Promise.all([
    (async () => {
      try {
        const forecastDays = await fetchWeatherComDailyForecast({
          geocode,
          durationDays,
          unit,
          language: weatherComLanguage,
          apiKey,
        });
        return {
          status: WEATHERCOM_STATUS.OK,
          error: null,
          forecastDays,
        };
      } catch (error) {
        const providerError = formatErrorMessage(error);
        return {
          status: WEATHERCOM_STATUS.ERROR,
          error:
            crawlError && !providerError.includes(crawlError)
              ? `${providerError}; crawl=${crawlError}`
              : providerError,
          forecastDays: [],
        };
      }
    })(),
    resolveSourceReading("weathercom_current", () =>
      fetchWeatherComCurrentReading({
        geocode,
        unit,
        language: weatherComLanguage,
        apiKey,
      }),
    ),
  ]);

  return {
    status: forecastResult.status,
    error: forecastResult.error,
    forecastDays: forecastResult.forecastDays,
    currentReading,
  };
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

async function sleep(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url) {
  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Request failed (${response.status}): ${text.slice(0, 180)}`,
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

  throw new Error(formatErrorMessage(lastError));
}

async function fetchMicrosoftDailyForecast({
  station,
  durationDays,
  unit,
  language,
}) {
  const subscriptionKey =
    process.env.AZURE_MAPS_SUBSCRIPTION_KEY ??
    process.env.MICROSOFT_WEATHER_SUBSCRIPTION_KEY;
  if (!subscriptionKey) {
    return {
      status: MICROSOFT_STATUS.ERROR,
      error:
        "Missing AZURE_MAPS_SUBSCRIPTION_KEY (or MICROSOFT_WEATHER_SUBSCRIPTION_KEY).",
      forecastDays: [],
    };
  }

  try {
    const url = new URL(MICROSOFT_DAILY_FORECAST_URL);
    url.searchParams.set("api-version", "1.1");
    url.searchParams.set("query", `${station.lat},${station.lon}`);
    url.searchParams.set("duration", String(durationDays));
    url.searchParams.set("unit", unit);
    url.searchParams.set("language", language);
    url.searchParams.set("subscription-key", subscriptionKey);

    const response = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        status: MICROSOFT_STATUS.ERROR,
        error: `Microsoft forecast failed (${response.status}): ${text.slice(0, 220)}`,
        forecastDays: [],
      };
    }

    const payload = await response.json();
    const forecastDays = normalizeMicrosoftForecastDays(
      payload,
      durationDays,
      unit,
    );

    return {
      status: MICROSOFT_STATUS.OK,
      forecastDays,
    };
  } catch (error) {
    return {
      status: MICROSOFT_STATUS.ERROR,
      error: formatErrorMessage(error),
      forecastDays: [],
    };
  }
}

async function fetchMicrosoftCurrentReading({ station, unit, language }) {
  const subscriptionKey =
    process.env.AZURE_MAPS_SUBSCRIPTION_KEY ??
    process.env.MICROSOFT_WEATHER_SUBSCRIPTION_KEY;
  if (!subscriptionKey) {
    throw new Error(
      "Missing AZURE_MAPS_SUBSCRIPTION_KEY (or MICROSOFT_WEATHER_SUBSCRIPTION_KEY).",
    );
  }

  const url = new URL(MICROSOFT_CURRENT_CONDITIONS_URL);
  url.searchParams.set("api-version", "1.1");
  url.searchParams.set("query", `${station.lat},${station.lon}`);
  url.searchParams.set("unit", unit);
  url.searchParams.set("language", language);
  url.searchParams.set("subscription-key", subscriptionKey);

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
      `Microsoft current conditions failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const row = Array.isArray(payload?.results)
    ? payload.results[0]
    : payload?.results && typeof payload.results === "object"
      ? payload.results
      : payload?.result && typeof payload.result === "object"
        ? payload.result
        : payload;

  if (!row || typeof row !== "object") {
    throw new Error("Microsoft current conditions response had no result row.");
  }

  const temperatureNode = row.temperature;
  const normalizedTemp = normalizeTempPair(
    temperatureNode?.value ?? temperatureNode,
    temperatureNode?.unit,
    unit,
  );
  const tempC = normalizedTemp.tempC;
  const tempF = normalizedTemp.tempF;
  if (!Number.isFinite(tempC) || !Number.isFinite(tempF)) {
    throw new Error(
      "Microsoft current conditions response missing parseable temperature.",
    );
  }

  const observedAtUtc =
    parseValidUtcEpoch(row.dateTime) ??
    parseValidUtcEpoch(row.observationTime) ??
    Date.now();
  const phrase =
    toNonEmptyString(row.phrase) ??
    toNonEmptyString(row.weatherText) ??
    toNonEmptyString(row.summary) ??
    null;

  return {
    source: "microsoft_current",
    status: SOURCE_STATUS.OK,
    observedAtUtc,
    observedAtLocal: formatChicagoDateTime(observedAtUtc),
    tempC: roundToTenth(tempC),
    tempF: roundToTenth(tempF),
    ...(phrase ? { raw: phrase } : {}),
  };
}

async function fetchAccuWeatherDailyForecast({
  locationKey,
  durationDays,
  unit,
  language,
  apiKey,
}) {
  const url = new URL(
    `${ACCUWEATHER_DAILY_FORECAST_BASE_URL}/${encodeURIComponent(locationKey)}`,
  );
  url.searchParams.set("language", language);
  url.searchParams.set("details", "true");
  url.searchParams.set("metric", unit === "metric" ? "true" : "false");

  const payload = await fetchAccuWeatherJson(url, apiKey);
  return normalizeAccuWeatherForecastDays(payload, durationDays, unit);
}

async function fetchAccuWeatherCurrentReading({
  locationKey,
  unit,
  language,
  apiKey,
}) {
  const url = new URL(
    `${ACCUWEATHER_CURRENT_CONDITIONS_BASE_URL}/${encodeURIComponent(locationKey)}`,
  );
  url.searchParams.set("language", language);
  url.searchParams.set("details", "true");

  const payload = await fetchAccuWeatherJson(url, apiKey);
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") {
    throw new Error("AccuWeather current conditions response had no result row.");
  }

  const normalizedTemp = normalizeAccuWeatherCurrentTemp(row, unit);
  if (!normalizedTemp) {
    throw new Error(
      "AccuWeather current conditions response missing parseable temperature.",
    );
  }

  const epochSeconds = toFiniteNumber(row?.EpochTime);
  const observedAtUtc =
    (epochSeconds !== null ? Math.round(epochSeconds * 1000) : null) ??
    parseValidUtcEpoch(row?.LocalObservationDateTime) ??
    parseValidUtcEpoch(row?.DateTime) ??
    Date.now();
  const phrase = toNonEmptyString(row?.WeatherText);

  return {
    source: "accuweather_current",
    status: SOURCE_STATUS.OK,
    observedAtUtc,
    observedAtLocal: formatChicagoDateTime(observedAtUtc),
    tempC: normalizedTemp.tempC,
    tempF: normalizedTemp.tempF,
    ...(phrase ? { raw: phrase } : {}),
  };
}

async function fetchAccuWeatherForecastAndCurrent({
  station,
  durationDays,
  unit,
  language,
}) {
  const apiKey = toNonEmptyString(process.env.ACCUWEATHER_API_KEY);
  if (!apiKey) {
    const error = "Missing ACCUWEATHER_API_KEY.";
    return {
      status: ACCUWEATHER_STATUS.ERROR,
      error,
      locationKey: null,
      forecastDays: [],
      currentReading: makeSourceErrorReading("accuweather_current", error),
    };
  }

  const accuLanguage = normalizeAccuWeatherLanguage(language);
  let locationKey;
  try {
    locationKey = await resolveAccuWeatherLocationKey({
      station,
      language: accuLanguage,
      apiKey,
    });
  } catch (error) {
    const formattedError = formatErrorMessage(error);
    return {
      status: ACCUWEATHER_STATUS.ERROR,
      error: formattedError,
      locationKey: null,
      forecastDays: [],
      currentReading: makeSourceErrorReading(
        "accuweather_current",
        formattedError,
      ),
    };
  }

  const [forecastResult, currentReading] = await Promise.all([
    (async () => {
      try {
        const forecastDays = await fetchAccuWeatherDailyForecast({
          locationKey,
          durationDays,
          unit,
          language: accuLanguage,
          apiKey,
        });
        return {
          status: ACCUWEATHER_STATUS.OK,
          error: null,
          forecastDays,
        };
      } catch (error) {
        return {
          status: ACCUWEATHER_STATUS.ERROR,
          error: formatErrorMessage(error),
          forecastDays: [],
        };
      }
    })(),
    resolveSourceReading("accuweather_current", () =>
      fetchAccuWeatherCurrentReading({
        locationKey,
        unit,
        language: accuLanguage,
        apiKey,
      }),
    ),
  ]);

  return {
    status: forecastResult.status,
    error: forecastResult.error,
    locationKey,
    forecastDays: forecastResult.forecastDays,
    currentReading,
  };
}

async function fetchGoogleDailyForecast({
  station,
  durationDays,
  unit,
  language,
  apiKey,
}) {
  const url = new URL(GOOGLE_DAILY_FORECAST_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("location.latitude", String(station.lat));
  url.searchParams.set("location.longitude", String(station.lon));
  url.searchParams.set("days", String(Math.min(durationDays, 10)));
  url.searchParams.set("unitsSystem", toGoogleUnitsSystem(unit));
  url.searchParams.set("languageCode", language);

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
      `Google daily forecast failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  return normalizeGoogleForecastDays(payload, durationDays, unit);
}

async function fetchGoogleCurrentReading({ station, unit, language, apiKey }) {
  const url = new URL(GOOGLE_CURRENT_CONDITIONS_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("location.latitude", String(station.lat));
  url.searchParams.set("location.longitude", String(station.lon));
  url.searchParams.set("unitsSystem", toGoogleUnitsSystem(unit));
  url.searchParams.set("languageCode", language);

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
      `Google current conditions failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await response.json();
  const normalizedTemp = normalizeGoogleCurrentTemp(payload, unit);
  if (!normalizedTemp) {
    throw new Error("Google current conditions response missing temperature.");
  }

  const observedAtUtc =
    parseValidUtcEpoch(payload?.currentTime) ??
    parseValidUtcEpoch(payload?.observationTime) ??
    Date.now();
  const phrase = extractGoogleDescription(payload);

  return {
    source: "google_weather_current",
    status: SOURCE_STATUS.OK,
    observedAtUtc,
    observedAtLocal: formatChicagoDateTime(observedAtUtc),
    tempC: normalizedTemp.tempC,
    tempF: normalizedTemp.tempF,
    ...(phrase ? { raw: phrase } : {}),
  };
}

async function fetchGoogleForecastAndCurrent({
  station,
  durationDays,
  unit,
  language,
}) {
  const apiKey = toNonEmptyString(process.env.GOOGLE_WEATHER_API_KEY);
  if (!apiKey) {
    const error = "Missing GOOGLE_WEATHER_API_KEY.";
    return {
      status: GOOGLE_STATUS.ERROR,
      error,
      forecastDays: [],
      currentReading: makeSourceErrorReading("google_weather_current", error),
    };
  }

  const googleLanguage = normalizeGoogleLanguage(language);
  const [forecastResult, currentReading] = await Promise.all([
    (async () => {
      try {
        const forecastDays = await fetchGoogleDailyForecast({
          station,
          durationDays,
          unit,
          language: googleLanguage,
          apiKey,
        });
        return {
          status: GOOGLE_STATUS.OK,
          error: null,
          forecastDays,
        };
      } catch (error) {
        return {
          status: GOOGLE_STATUS.ERROR,
          error: formatErrorMessage(error),
          forecastDays: [],
        };
      }
    })(),
    resolveSourceReading("google_weather_current", () =>
      fetchGoogleCurrentReading({
        station,
        unit,
        language: googleLanguage,
        apiKey,
      }),
    ),
  ]);

  return {
    status: forecastResult.status,
    error: forecastResult.error,
    forecastDays: forecastResult.forecastDays,
    currentReading,
  };
}

async function fetchNoaaCurrentReading(stationIcao) {
  const url = `${NOAA_LATEST_METAR_BASE_URL}/${stationIcao}.TXT`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`NOAA latest METAR failed (${response.status}).`);
  }

  const body = await response.text();
  const { tsUtc, rawMetar } = parseNoaaLatestTxt(body);
  const tempInfo = extractTempInfo(rawMetar, undefined);
  if (!tempInfo) {
    throw new Error("NOAA latest METAR had no parseable temperature.");
  }

  const tempC = roundToTenth(tempInfo.tempC);
  const tempF = toFahrenheit(tempC);

  return {
    source: "noaa_latest_metar",
    status: SOURCE_STATUS.OK,
    observedAtUtc: tsUtc,
    observedAtLocal: formatChicagoDateTime(tsUtc),
    tempC,
    tempF,
    raw: rawMetar,
  };
}

async function fetchIemCurrentReading(stationIem) {
  const params = new URLSearchParams();
  params.set("station", stationIem);
  params.append("report_type", "3");
  params.append("report_type", "4");
  params.append("data", "metar");
  params.append("data", "tmpf");
  params.set("tz", "UTC");
  params.set("format", "onlycomma");
  params.set("hours", "6");

  const csvText = await fetchTextWithRetry(`${IEM_ASOS_BASE_URL}?${params}`);
  const observations = parseCsvObservations(csvText);

  let latest = null;
  for (const observation of observations) {
    const tsUtc = parseValidUtcEpoch(observation.valid);
    if (tsUtc === null) {
      continue;
    }

    const tempInfo = extractTempInfo(observation.metar ?? "", observation.tmpf);
    if (!tempInfo) {
      continue;
    }

    if (!latest || tsUtc > latest.tsUtc) {
      latest = {
        tsUtc,
        rawMetar: observation.metar ?? "",
        tempC: roundToTenth(tempInfo.tempC),
      };
    }
  }

  if (!latest) {
    throw new Error("IEM returned no parseable observation in the last 6 hours.");
  }

  return {
    source: "iem_asos_latest",
    status: SOURCE_STATUS.OK,
    observedAtUtc: latest.tsUtc,
    observedAtLocal: formatChicagoDateTime(latest.tsUtc),
    tempC: latest.tempC,
    tempF: toFahrenheit(latest.tempC),
    raw: latest.rawMetar,
  };
}

async function fetchOpenMeteoCurrentReading(station) {
  const params = new URLSearchParams();
  params.set("latitude", String(station.lat));
  params.set("longitude", String(station.lon));
  params.set("current", "temperature_2m");
  params.set("timezone", "UTC");

  const response = await fetch(`${OPEN_METEO_BASE_URL}?${params}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed (${response.status}).`);
  }

  const payload = await response.json();
  const current = payload?.current ?? payload?.current_weather ?? null;
  const tempC = toFiniteNumber(current?.temperature_2m ?? current?.temperature);
  if (tempC === null) {
    throw new Error("Open-Meteo response missing current temperature.");
  }

  const parsedTime = parseValidUtcEpoch(current?.time);
  const observedAtUtc = parsedTime ?? Date.now();

  return {
    source: "open_meteo_current",
    status: SOURCE_STATUS.OK,
    observedAtUtc,
    observedAtLocal: formatChicagoDateTime(observedAtUtc),
    tempC: roundToTenth(tempC),
    tempF: toFahrenheit(tempC),
    raw: `temperature_2m=${tempC}; time=${current?.time ?? "n/a"}`,
  };
}

async function resolveSourceReading(source, fetcher) {
  try {
    return await fetcher();
  } catch (error) {
    return {
      source,
      status: SOURCE_STATUS.ERROR,
      error: formatErrorMessage(error),
    };
  }
}

export const insertSnapshot = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    stationName: v.string(),
    capturedAt: v.number(),
    capturedAtLocal: v.string(),
    durationDays: v.number(),
    unit: v.union(v.literal("imperial"), v.literal("metric")),
    language: v.string(),
    status: v.union(
      v.literal(SNAPSHOT_STATUS.OK),
      v.literal(SNAPSHOT_STATUS.PARTIAL),
      v.literal(SNAPSHOT_STATUS.ERROR),
    ),
    microsoftStatus: v.union(
      v.literal(MICROSOFT_STATUS.OK),
      v.literal(MICROSOFT_STATUS.ERROR),
    ),
    microsoftError: v.optional(v.string()),
    microsoftForecastDays: v.array(microsoftForecastDayValidator),
    accuweatherStatus: v.union(
      v.literal(ACCUWEATHER_STATUS.OK),
      v.literal(ACCUWEATHER_STATUS.ERROR),
    ),
    accuweatherError: v.optional(v.string()),
    accuweatherLocationKey: v.optional(v.string()),
    accuweatherForecastDays: v.array(microsoftForecastDayValidator),
    googleStatus: v.union(
      v.literal(GOOGLE_STATUS.OK),
      v.literal(GOOGLE_STATUS.ERROR),
    ),
    googleError: v.optional(v.string()),
    googleForecastDays: v.array(microsoftForecastDayValidator),
    weathercomStatus: v.union(
      v.literal(WEATHERCOM_STATUS.OK),
      v.literal(WEATHERCOM_STATUS.ERROR),
    ),
    weathercomError: v.optional(v.string()),
    weathercomForecastDays: v.array(microsoftForecastDayValidator),
    actualReadings: v.array(sourceReadingValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("kordForecastSnapshots", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const collectKordHourlySnapshot = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    durationDays: v.optional(v.number()),
    unit: v.optional(v.union(v.literal("imperial"), v.literal("metric"))),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = (args.stationIcao ?? "KORD").trim().toUpperCase();
    const station = STATIONS[stationIcao];
    if (!station) {
      throw new Error(`Unsupported stationIcao '${stationIcao}'.`);
    }

    const durationDays = Number.isInteger(args.durationDays)
      ? Number(args.durationDays)
      : 5;
    if (!ALLOWED_FORECAST_DURATIONS.has(durationDays)) {
      throw new Error(
        "durationDays must be one of 1, 5, 10, 15, 25, or 45.",
      );
    }

    const unit = args.unit === "metric" ? "metric" : DEFAULT_MICROSOFT_UNIT;
    const language =
      toNonEmptyString(args.language) ?? DEFAULT_MICROSOFT_LANGUAGE;
    const capturedAt = Date.now();
    const capturedAtLocal = formatChicagoDateTime(capturedAt);

    const [
      microsoftResult,
      accuweatherResult,
      googleResult,
      weathercomResult,
      microsoftCurrentResult,
      noaaResult,
      iemResult,
      openMeteoResult,
    ] = await Promise.all([
      fetchMicrosoftDailyForecast({
        station,
        durationDays,
        unit,
        language,
      }),
      fetchAccuWeatherForecastAndCurrent({
        station,
        durationDays,
        unit,
        language,
      }),
      fetchGoogleForecastAndCurrent({
        station,
        durationDays,
        unit,
        language,
      }),
      fetchWeatherComForecastAndCurrent({
        station,
        durationDays,
        unit,
        language,
      }),
      resolveSourceReading("microsoft_current", () =>
        fetchMicrosoftCurrentReading({ station, unit, language }),
      ),
      resolveSourceReading("noaa_latest_metar", () =>
        fetchNoaaCurrentReading(station.stationIcao),
      ),
      resolveSourceReading("iem_asos_latest", () =>
        fetchIemCurrentReading(station.stationIem),
      ),
      resolveSourceReading("open_meteo_current", () =>
        fetchOpenMeteoCurrentReading(station),
      ),
    ]);

    const actualReadings = [
      microsoftCurrentResult,
      accuweatherResult.currentReading,
      googleResult.currentReading,
      weathercomResult.currentReading,
      noaaResult,
      iemResult,
      openMeteoResult,
    ];
    const successfulActualCount = actualReadings.filter(
      (reading) => reading.status === SOURCE_STATUS.OK,
    ).length;
    const forecastProviderErrorCount = [
      microsoftResult.status,
      accuweatherResult.status,
      googleResult.status,
      weathercomResult.status,
    ].filter((providerStatus) => providerStatus === "error").length;

    let status = SNAPSHOT_STATUS.OK;
    if (
      forecastProviderErrorCount === 4 &&
      successfulActualCount === 0
    ) {
      status = SNAPSHOT_STATUS.ERROR;
    } else if (
      forecastProviderErrorCount > 0 ||
      successfulActualCount < actualReadings.length
    ) {
      status = SNAPSHOT_STATUS.PARTIAL;
    }

    const snapshotId = await ctx.runMutation("forecastCollector:insertSnapshot", {
      stationIcao,
      stationName: station.stationName,
      capturedAt,
      capturedAtLocal,
      durationDays,
      unit,
      language,
      status,
      microsoftStatus: microsoftResult.status,
      ...(microsoftResult.error ? { microsoftError: microsoftResult.error } : {}),
      microsoftForecastDays: microsoftResult.forecastDays,
      accuweatherStatus: accuweatherResult.status,
      ...(accuweatherResult.error
        ? { accuweatherError: accuweatherResult.error }
        : {}),
      ...(accuweatherResult.locationKey
        ? { accuweatherLocationKey: accuweatherResult.locationKey }
        : {}),
      accuweatherForecastDays: accuweatherResult.forecastDays,
      googleStatus: googleResult.status,
      ...(googleResult.error ? { googleError: googleResult.error } : {}),
      googleForecastDays: googleResult.forecastDays,
      weathercomStatus: weathercomResult.status,
      ...(weathercomResult.error ? { weathercomError: weathercomResult.error } : {}),
      weathercomForecastDays: weathercomResult.forecastDays,
      actualReadings,
    });

    return {
      ok: status !== SNAPSHOT_STATUS.ERROR,
      status,
      snapshotId,
      stationIcao,
      stationName: station.stationName,
      capturedAt,
      capturedAtLocal,
      durationDays,
      unit,
      language,
      microsoftStatus: microsoftResult.status,
      microsoftError: microsoftResult.error ?? null,
      microsoftForecastDayCount: microsoftResult.forecastDays.length,
      accuweatherStatus: accuweatherResult.status,
      accuweatherError: accuweatherResult.error ?? null,
      accuweatherForecastDayCount: accuweatherResult.forecastDays.length,
      accuweatherLocationKey: accuweatherResult.locationKey ?? null,
      googleStatus: googleResult.status,
      googleError: googleResult.error ?? null,
      googleForecastDayCount: googleResult.forecastDays.length,
      weathercomStatus: weathercomResult.status,
      weathercomError: weathercomResult.error ?? null,
      weathercomForecastDayCount: weathercomResult.forecastDays.length,
      actualReadings,
    };
  },
});

export const getRecentSnapshots = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = (args.stationIcao ?? "KORD").trim().toUpperCase();
    const parsedLimit = Number.isInteger(args.limit) ? Number(args.limit) : 48;
    const limit = Math.max(1, Math.min(MAX_QUERY_LIMIT, parsedLimit));

    const rows = await ctx.db
      .query("kordForecastSnapshots")
      .withIndex("by_station_capturedAt", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .order("desc")
      .take(limit);

    return {
      stationIcao,
      count: rows.length,
      rows,
    };
  },
});
