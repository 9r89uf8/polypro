import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const CHICAGO_TIMEZONE = "America/Chicago";
const O_HARE_LOCATION_KEY = "5595_poi";
const O_HARE_ICAO = "KORD";
const ACCUWEATHER_BASE_URL = "https://dataservice.accuweather.com";
const FORECAST_RUN_KEY = "kord_accuweather_forecast";
const CACHE_REFRESH_SKEW_MS = 60 * 1000;
const LOCATION_STAGGER_MS = 550;
const JITTER_MIN_MS = 15 * 1000;
const JITTER_MAX_MS = 75 * 1000;
const NEAR_PEAK_DELTA_F = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_CHANGE_SNAPSHOT_LIMIT = 72;

const ENDPOINT_TYPE = {
  LOCATION: "location",
  CURRENT_CONDITIONS: "currentconditions",
  DAILY_5DAY: "daily5day",
  HOURLY_72HOUR: "hourly72hour",
  HOURLY_120HOUR: "hourly120hour",
};

const endpointTypeValidator = v.union(
  v.literal(ENDPOINT_TYPE.LOCATION),
  v.literal(ENDPOINT_TYPE.CURRENT_CONDITIONS),
  v.literal(ENDPOINT_TYPE.DAILY_5DAY),
  v.literal(ENDPOINT_TYPE.HOURLY_72HOUR),
  v.literal(ENDPOINT_TYPE.HOURLY_120HOUR),
);

const FORECAST_LOCATIONS = [
  {
    locationKey: "5595_poi",
    name: "O'Hare",
    stationIcao: "KORD",
    lat: 41.9786,
    lon: -87.9048,
    timeZone: CHICAGO_TIMEZONE,
  },
  {
    locationKey: "338056",
    name: "Schiller Park",
    lat: 41.957,
    lon: -87.87,
    timeZone: CHICAGO_TIMEZONE,
  },
  {
    locationKey: "2256000",
    name: "Rosemont",
    lat: 41.9953,
    lon: -87.884,
    timeZone: CHICAGO_TIMEZONE,
  },
  {
    locationKey: "2256415",
    name: "Bensenville",
    lat: 41.9554,
    lon: -87.9401,
    timeZone: CHICAGO_TIMEZONE,
  },
  {
    locationKey: "332838",
    name: "Elk Grove Village",
    lat: 42.0039,
    lon: -87.9703,
    timeZone: CHICAGO_TIMEZONE,
  },
];

const chicagoDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CHICAGO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
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

function buildDateFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const dateFormatterCache = new Map();
function getDateFormatter(timeZone) {
  if (!dateFormatterCache.has(timeZone)) {
    dateFormatterCache.set(timeZone, buildDateFormatter(timeZone));
  }
  return dateFormatterCache.get(timeZone);
}

function formatDateForZone(epochMs, timeZone) {
  const formatter = getDateFormatter(timeZone || CHICAGO_TIMEZONE);
  const parts = getDateParts(formatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildDateTimeFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
}

const dateTimeFormatterCache = new Map();
function getDateTimeFormatter(timeZone) {
  if (!dateTimeFormatterCache.has(timeZone)) {
    dateTimeFormatterCache.set(timeZone, buildDateTimeFormatter(timeZone));
  }
  return dateTimeFormatterCache.get(timeZone);
}

function formatDateTimeForZone(epochMs, timeZone) {
  const formatter = getDateTimeFormatter(timeZone || CHICAGO_TIMEZONE);
  const parts = getDateParts(formatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHttpDateMs(rawValue) {
  if (!rawValue) {
    return null;
  }
  const parsed = Date.parse(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeStringHash(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function extractDateIso(rawDateTime) {
  if (typeof rawDateTime === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawDateTime)) {
    return rawDateTime.slice(0, 10);
  }
  const parsed = Date.parse(rawDateTime ?? "");
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return formatChicagoDate(parsed);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeHourly120Unsupported(errorMessage) {
  const message = String(errorMessage ?? "").toLowerCase();
  return (
    message.includes("hourly120hour request failed (401)") ||
    message.includes("hourly120hour request failed (403)") ||
    message.includes("hourly120hour request failed (404)") ||
    message.includes("developer") ||
    message.includes("not authorized") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  );
}

function buildAccuweatherUrl(path, apiKey, extraParams = {}) {
  const params = new URLSearchParams({
    apikey: apiKey,
    language: "en-us",
    ...extraParams,
  });
  return `${ACCUWEATHER_BASE_URL}${path}?${params.toString()}`;
}

function parseLocationDetails(payload, fallback) {
  const latitude = toFiniteNumber(payload?.GeoPosition?.Latitude) ?? fallback.lat;
  const longitude = toFiniteNumber(payload?.GeoPosition?.Longitude) ?? fallback.lon;
  const localizedName =
    payload?.LocalizedName || payload?.EnglishName || fallback.name;
  const englishName = payload?.EnglishName || fallback.name;
  const timeZoneName = payload?.TimeZone?.Name || fallback.timeZone || CHICAGO_TIMEZONE;
  return {
    name: localizedName,
    englishName,
    lat: latitude,
    lon: longitude,
    timeZone: timeZoneName,
    accuweatherType: payload?.Type || undefined,
  };
}

function parseCurrentConditions(payload, timeZone) {
  const row = Array.isArray(payload) ? payload[0] : null;
  if (!row || typeof row !== "object") {
    return {
      sourceFetchedAtMs: Date.now(),
    };
  }

  const observedAtEpochMs = Number.isFinite(Date.parse(row?.LocalObservationDateTime))
    ? Date.parse(row.LocalObservationDateTime)
    : undefined;
  const tempF = toFiniteNumber(row?.Temperature?.Imperial?.Value);
  const tempC = toFiniteNumber(row?.Temperature?.Metric?.Value);
  const realFeelF = toFiniteNumber(row?.RealFeelTemperature?.Imperial?.Value);
  const realFeelC = toFiniteNumber(row?.RealFeelTemperature?.Metric?.Value);
  const weatherIcon = toFiniteNumber(row?.WeatherIcon);
  const localDateISO =
    extractDateIso(row?.LocalObservationDateTime) ??
    (observedAtEpochMs !== undefined
      ? formatDateForZone(observedAtEpochMs, timeZone)
      : undefined);

  return {
    ...(localDateISO ? { localDateISO } : {}),
    observedAtEpochMs,
    ...(observedAtEpochMs !== undefined
      ? { observedAtLocal: formatDateTimeForZone(observedAtEpochMs, timeZone) }
      : {}),
    ...(tempF !== null ? { tempF: roundToTenth(tempF) } : {}),
    ...(tempC !== null ? { tempC: roundToTenth(tempC) } : {}),
    ...(realFeelF !== null ? { realFeelF: roundToTenth(realFeelF) } : {}),
    ...(realFeelC !== null ? { realFeelC: roundToTenth(realFeelC) } : {}),
    ...(row?.WeatherText ? { weatherText: String(row.WeatherText) } : {}),
    ...(weatherIcon !== null ? { weatherIcon: Math.round(weatherIcon) } : {}),
    ...(typeof row?.IsDayTime === "boolean" ? { isDayTime: row.IsDayTime } : {}),
    ...(typeof row?.HasPrecipitation === "boolean"
      ? { hasPrecipitation: row.HasPrecipitation }
      : {}),
    ...(row?.PrecipitationType ? { precipitationType: String(row.PrecipitationType) } : {}),
    ...(row?.MobileLink ? { mobileLink: String(row.MobileLink) } : {}),
    ...(row?.Link ? { link: String(row.Link) } : {}),
    sourceFetchedAtMs: Date.now(),
  };
}

function parseDailyForecasts(payload) {
  const rows = Array.isArray(payload?.DailyForecasts) ? payload.DailyForecasts : [];
  return rows
    .slice(0, 3)
    .map((row, dayIndex) => {
      const localDateISO = extractDateIso(row?.Date);
      const highF = toFiniteNumber(row?.Temperature?.Maximum?.Value);
      if (!localDateISO || highF === null) {
        return null;
      }
      const lowF = toFiniteNumber(row?.Temperature?.Minimum?.Value);
      return {
        dayIndex,
        localDateISO,
        forecastHighF: roundToTenth(highF),
        forecastLowF: lowF === null ? undefined : roundToTenth(lowF),
      };
    })
    .filter(Boolean);
}

function parseHourlyForecasts(payload, timeZone) {
  const rows = Array.isArray(payload) ? payload : [];
  const parsed = [];
  for (const row of rows) {
    const dateTime = row?.DateTime;
    const tempF = toFiniteNumber(row?.Temperature?.Value);
    if (!dateTime || tempF === null) {
      continue;
    }
    const epochMs = Date.parse(dateTime);
    if (!Number.isFinite(epochMs)) {
      continue;
    }
    const localDateISO = extractDateIso(dateTime) ?? formatDateTimeForZone(epochMs, timeZone).slice(0, 10);
    parsed.push({
      epochMs,
      tempF: roundToTenth(tempF),
      localDateISO,
    });
  }
  parsed.sort((a, b) => a.epochMs - b.epochMs);
  return parsed;
}

function parseSnapshotPayload(payloadJson) {
  if (typeof payloadJson !== "string" || payloadJson.length === 0) {
    return null;
  }
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

function buildDailyHighChangeRows(snapshotRows, trackedDates) {
  const chicagoTodayIso = formatChicagoDate(Date.now());
  const targetDates = Array.isArray(trackedDates)
    ? [...new Set(trackedDates.filter((value) => typeof value === "string" && value.length > 0))]
    : [];
  const targetDateSet = new Set(targetDates);
  const historyByDate = new Map();

  for (const snapshot of snapshotRows) {
    const payload = parseSnapshotPayload(snapshot.payloadJson);
    if (!payload) {
      continue;
    }
    const dailyForecasts = parseDailyForecasts(payload);
    for (const forecast of dailyForecasts) {
      if (targetDateSet.size > 0 && !targetDateSet.has(forecast.localDateISO)) {
        continue;
      }
      if (!historyByDate.has(forecast.localDateISO)) {
        historyByDate.set(forecast.localDateISO, []);
      }
      historyByDate.get(forecast.localDateISO).push({
        fetchedAtMs: snapshot.fetchedAtMs,
        snapshotChicagoDate: formatChicagoDate(snapshot.fetchedAtMs),
        highF: forecast.forecastHighF,
      });
    }
  }

  const orderedDates =
    targetDates.length > 0
      ? [...targetDates].sort((a, b) => a.localeCompare(b))
      : [...historyByDate.keys()].sort((a, b) => a.localeCompare(b));

  return orderedDates.map((localDateISO) => {
    const history = historyByDate.get(localDateISO) ?? [];
    const latest = history[0] ?? null;
    const previous = history[1] ?? null;
    const todayHistory = history.filter(
      (entry) => entry.snapshotChicagoDate === chicagoTodayIso,
    );
    const firstToday = todayHistory[todayHistory.length - 1] ?? null;
    return {
      localDateISO,
      latestHighF: latest ? roundToTenth(latest.highF) : null,
      latestSnapshotAtMs: latest?.fetchedAtMs ?? null,
      previousHighF: previous ? roundToTenth(previous.highF) : null,
      previousSnapshotAtMs: previous?.fetchedAtMs ?? null,
      deltaFromPreviousF:
        latest && previous ? roundToTenth(latest.highF - previous.highF) : null,
      firstTodayHighF: firstToday ? roundToTenth(firstToday.highF) : null,
      firstTodaySnapshotAtMs: firstToday?.fetchedAtMs ?? null,
      deltaFromFirstTodayF:
        latest && firstToday ? roundToTenth(latest.highF - firstToday.highF) : null,
      snapshotsTracked: history.length,
    };
  });
}

function chooseBetterRun(candidate, currentBest) {
  if (!currentBest) {
    return candidate;
  }
  if (candidate.length > currentBest.length) {
    return candidate;
  }
  if (candidate.length < currentBest.length) {
    return currentBest;
  }
  if (candidate.maxTemp > currentBest.maxTemp) {
    return candidate;
  }
  if (candidate.maxTemp < currentBest.maxTemp) {
    return currentBest;
  }
  return candidate.startEpochMs < currentBest.startEpochMs ? candidate : currentBest;
}

function computePeakWindow(hourlyPoints, forecastHighF) {
  if (!Number.isFinite(forecastHighF) || !hourlyPoints.length) {
    return {
      peakMethod: "daily_only",
    };
  }

  const nearPeakThresholdF = roundToTenth(forecastHighF - NEAR_PEAK_DELTA_F);
  let bestRun = null;
  let currentRun = null;

  function finalizeCurrentRun() {
    if (!currentRun) {
      return;
    }
    bestRun = chooseBetterRun(currentRun, bestRun);
    currentRun = null;
  }

  for (const point of hourlyPoints) {
    const qualifies = point.tempF >= nearPeakThresholdF;
    if (!qualifies) {
      finalizeCurrentRun();
      continue;
    }

    if (!currentRun) {
      currentRun = {
        length: 1,
        startEpochMs: point.epochMs,
        endEpochMs: point.epochMs,
        maxTemp: point.tempF,
      };
      continue;
    }

    const deltaMs = point.epochMs - currentRun.endEpochMs;
    if (deltaMs > 75 * 60 * 1000) {
      finalizeCurrentRun();
      currentRun = {
        length: 1,
        startEpochMs: point.epochMs,
        endEpochMs: point.epochMs,
        maxTemp: point.tempF,
      };
      continue;
    }

    currentRun.length += 1;
    currentRun.endEpochMs = point.epochMs;
    currentRun.maxTemp = Math.max(currentRun.maxTemp, point.tempF);
  }
  finalizeCurrentRun();

  if (!bestRun) {
    const sortedByTemp = [...hourlyPoints].sort((a, b) => b.tempF - a.tempF);
    const maxPoint = sortedByTemp[0];
    if (!maxPoint) {
      return {
        peakMethod: "daily_only",
      };
    }
    return {
      peakMethod: "hourly_max",
      nearPeakThresholdF,
      peakStartEpochMs: maxPoint.epochMs,
      peakEndEpochMs: maxPoint.epochMs,
      peakDurationMinutes: 60,
    };
  }

  return {
    peakMethod: "near_peak_window",
    nearPeakThresholdF,
    peakStartEpochMs: bestRun.startEpochMs,
    peakEndEpochMs: bestRun.endEpochMs,
    peakDurationMinutes: bestRun.length * 60,
  };
}

function buildDailySummaries({
  locationName,
  timeZone,
  dailyForecasts,
  hourlyForecasts,
  snapshotFetchedAtMs,
}) {
  const hourlyByDate = new Map();
  for (const point of hourlyForecasts) {
    if (!hourlyByDate.has(point.localDateISO)) {
      hourlyByDate.set(point.localDateISO, []);
    }
    hourlyByDate.get(point.localDateISO).push({
      epochMs: point.epochMs,
      tempF: point.tempF,
    });
  }

  const summaries = [];
  for (const daily of dailyForecasts) {
    const hourlyPoints = hourlyByDate.get(daily.localDateISO) ?? [];
    const peak = computePeakWindow(hourlyPoints, daily.forecastHighF);

    summaries.push({
      locationName,
      timeZone,
      localDateISO: daily.localDateISO,
      dayIndex: daily.dayIndex,
      forecastHighF: daily.forecastHighF,
      forecastLowF: daily.forecastLowF,
      peakMethod: peak.peakMethod,
      nearPeakThresholdF: peak.nearPeakThresholdF,
      peakStartEpochMs: peak.peakStartEpochMs,
      peakEndEpochMs: peak.peakEndEpochMs,
      peakDurationMinutes: peak.peakDurationMinutes,
      peakStartLocal: Number.isFinite(peak.peakStartEpochMs)
        ? formatDateTimeForZone(peak.peakStartEpochMs, timeZone)
        : undefined,
      peakEndLocal: Number.isFinite(peak.peakEndEpochMs)
        ? formatDateTimeForZone(peak.peakEndEpochMs, timeZone)
        : undefined,
      snapshotFetchedAtMs,
      hourlyPoints,
    });
  }

  return summaries;
}

function computePeakTimingDeltaMinutes(observedUtcMs, peakStartUtcMs, peakEndUtcMs) {
  if (
    !Number.isFinite(observedUtcMs) ||
    !Number.isFinite(peakStartUtcMs) ||
    !Number.isFinite(peakEndUtcMs)
  ) {
    return null;
  }
  const inclusivePeakEndMs = peakEndUtcMs + 59 * 60 * 1000;
  if (observedUtcMs >= peakStartUtcMs && observedUtcMs <= inclusivePeakEndMs) {
    return 0;
  }
  const deltaMs =
    observedUtcMs < peakStartUtcMs
      ? peakStartUtcMs - observedUtcMs
      : observedUtcMs - inclusivePeakEndMs;
  return Math.round(deltaMs / 60000);
}

function getConfiguredLocationByKey(locationKey) {
  return FORECAST_LOCATIONS.find((location) => location.locationKey === locationKey);
}

function sortLocationsByConfiguredOrder(locations) {
  const orderByKey = new Map(
    FORECAST_LOCATIONS.map((location, index) => [location.locationKey, index]),
  );
  return [...locations].sort((a, b) => {
    const aOrder = orderByKey.get(a.accuweatherLocationKey) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = orderByKey.get(b.accuweatherLocationKey) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.name.localeCompare(b.name);
  });
}

const dailySummaryInputValidator = v.object({
  locationName: v.string(),
  timeZone: v.string(),
  localDateISO: v.string(),
  dayIndex: v.number(),
  forecastHighF: v.number(),
  forecastLowF: v.optional(v.number()),
  peakMethod: v.string(),
  nearPeakThresholdF: v.optional(v.number()),
  peakStartEpochMs: v.optional(v.number()),
  peakEndEpochMs: v.optional(v.number()),
  peakDurationMinutes: v.optional(v.number()),
  peakStartLocal: v.optional(v.string()),
  peakEndLocal: v.optional(v.string()),
  snapshotFetchedAtMs: v.number(),
  hourlyPoints: v.array(
    v.object({
      epochMs: v.number(),
      tempF: v.number(),
    }),
  ),
});

export const getLatestSnapshot = queryGeneric({
  args: {
    locationKey: v.string(),
    endpointType: endpointTypeValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("forecastSnapshots")
      .withIndex("by_location_endpoint_fetched", (query) =>
        query
          .eq("locationKey", args.locationKey)
          .eq("endpointType", args.endpointType),
      )
      .order("desc")
      .first();
  },
});

export const getForecastDashboard = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const activeLocations = await ctx.db
      .query("locations")
      .withIndex("by_active", (query) => query.eq("active", true))
      .collect();

    const locationsToUse =
      activeLocations.length > 0
        ? sortLocationsByConfiguredOrder(activeLocations)
        : FORECAST_LOCATIONS.map((location) => ({
            _id: null,
            name: location.name,
            timeZone: location.timeZone,
            lat: location.lat,
            lon: location.lon,
            stationIcao: location.stationIcao,
            accuweatherLocationKey: location.locationKey,
            accuweatherType: undefined,
            accuweatherEnglishName: location.name,
            active: true,
          }));

    const locations = [];
    for (const location of locationsToUse) {
      const summaries = await ctx.db
        .query("forecastDailySummaries")
        .withIndex("by_location", (query) =>
          query.eq("locationKey", location.accuweatherLocationKey),
        )
        .collect();
      const current = await ctx.db
        .query("forecastCurrentConditions")
        .withIndex("by_location", (query) =>
          query.eq("locationKey", location.accuweatherLocationKey),
        )
        .first();
      summaries.sort(
        (a, b) => a.dayIndex - b.dayIndex || a.localDateISO.localeCompare(b.localDateISO),
      );
      const trackedDates = [...new Set(summaries.map((summary) => summary.localDateISO))];
      const dailySnapshots = await ctx.db
        .query("forecastSnapshots")
        .withIndex("by_location_endpoint_fetched", (query) =>
          query
            .eq("locationKey", location.accuweatherLocationKey)
            .eq("endpointType", ENDPOINT_TYPE.DAILY_5DAY),
        )
        .order("desc")
        .take(FORECAST_CHANGE_SNAPSHOT_LIMIT);
      const forecastHighChanges = buildDailyHighChangeRows(dailySnapshots, trackedDates);

      locations.push({
        locationKey: location.accuweatherLocationKey,
        name: location.name,
        englishName: location.accuweatherEnglishName ?? location.name,
        stationIcao: location.stationIcao ?? null,
        timeZone: location.timeZone,
        lat: location.lat,
        lon: location.lon,
        currentConditions: current
          ? {
              observedAtEpochMs: current.observedAtEpochMs ?? null,
              observedAtLocal: current.observedAtLocal ?? null,
              tempF: current.tempF ?? null,
              tempC: current.tempC ?? null,
              realFeelF: current.realFeelF ?? null,
              realFeelC: current.realFeelC ?? null,
              weatherText: current.weatherText ?? null,
              weatherIcon: current.weatherIcon ?? null,
              isDayTime: current.isDayTime ?? null,
              hasPrecipitation: current.hasPrecipitation ?? null,
              precipitationType: current.precipitationType ?? null,
              mobileLink: current.mobileLink ?? null,
              link: current.link ?? null,
              sourceFetchedAtMs: current.sourceFetchedAtMs ?? null,
            }
          : null,
        summaries: summaries.map((summary) => ({
          localDateISO: summary.localDateISO,
          dayIndex: summary.dayIndex,
          forecastHighF: summary.forecastHighF,
          forecastLowF: summary.forecastLowF ?? null,
          peakMethod: summary.peakMethod,
          nearPeakThresholdF: summary.nearPeakThresholdF ?? null,
          peakStartEpochMs: summary.peakStartEpochMs ?? null,
          peakEndEpochMs: summary.peakEndEpochMs ?? null,
          peakDurationMinutes: summary.peakDurationMinutes ?? null,
          peakStartLocal: summary.peakStartLocal ?? null,
          peakEndLocal: summary.peakEndLocal ?? null,
          snapshotFetchedAtMs: summary.snapshotFetchedAtMs,
          hourlyPoints: summary.hourlyPoints,
        })),
        forecastHighChanges,
      });
    }

    const ohareLocation =
      locations.find((location) => location.locationKey === O_HARE_LOCATION_KEY) ?? null;
    const ohareDates = [...new Set((ohareLocation?.summaries ?? []).map((row) => row.localDateISO))];
    const ohareComparisons = {};
    for (const dateKey of ohareDates) {
      const comparison = await ctx.db
        .query("dailyComparisons")
        .withIndex("by_station_date", (query) =>
          query.eq("stationIcao", O_HARE_ICAO).eq("date", dateKey),
        )
        .first();
      if (!comparison) {
        continue;
      }
      const derivedForecastErrRawF =
        comparison.accuHighF_latest !== undefined &&
        comparison.accuHighF_latest !== null &&
        comparison.metarMaxF !== undefined &&
        comparison.metarMaxF !== null
          ? roundToTenth(comparison.accuHighF_latest - comparison.metarMaxF)
          : null;
      const derivedForecastErrRoundedF =
        comparison.accuHighF_latest !== undefined &&
        comparison.accuHighF_latest !== null &&
        comparison.metarMaxF !== undefined &&
        comparison.metarMaxF !== null
          ? roundToTenth(comparison.accuHighF_latest - Math.round(comparison.metarMaxF))
          : null;
      const derivedObservedErrRawF =
        comparison.accuObservedMaxF !== undefined &&
        comparison.accuObservedMaxF !== null &&
        comparison.metarMaxF !== undefined &&
        comparison.metarMaxF !== null
          ? roundToTenth(comparison.accuObservedMaxF - comparison.metarMaxF)
          : null;
      const derivedObservedErrRoundedF =
        comparison.accuObservedMaxF !== undefined &&
        comparison.accuObservedMaxF !== null &&
        comparison.metarMaxF !== undefined &&
        comparison.metarMaxF !== null
          ? roundToTenth(comparison.accuObservedMaxF - Math.round(comparison.metarMaxF))
          : null;

      ohareComparisons[dateKey] = {
        metarOfficialMaxF: comparison.metarMaxF ?? null,
        metarOfficialMaxAtUtc: comparison.metarMaxAtUtc ?? null,
        accuHighF_latest: comparison.accuHighF_latest ?? null,
        accuLowF_latest: comparison.accuLowF_latest ?? null,
        accuObservedMaxF: comparison.accuObservedMaxF ?? null,
        accuObservedMaxAtUtc: comparison.accuObservedMaxAtUtc ?? null,
        accuObservedObsCount: comparison.accuObservedObsCount ?? null,
        accuPeakStartUtc_latest: comparison.accuPeakStartUtc_latest ?? null,
        accuPeakEndUtc_latest: comparison.accuPeakEndUtc_latest ?? null,
        accuPeakDurationMinutes_latest: comparison.accuPeakDurationMinutes_latest ?? null,
        errRawF: derivedForecastErrRawF,
        errRoundedF: derivedForecastErrRoundedF,
        errObservedRawF: derivedObservedErrRawF,
        errObservedRoundedF: derivedObservedErrRoundedF,
        peakHit: comparison.peakHit ?? null,
        peakTimingDeltaMinutes: comparison.peakTimingDeltaMinutes ?? null,
        accuSnapshotAtUtc_latest: comparison.accuSnapshotAtUtc_latest ?? null,
      };
    }

    const historyStartDate = formatChicagoDate(Date.now() - 60 * DAY_MS);
    const historicalRows = await ctx.db
      .query("dailyComparisons")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", O_HARE_ICAO).gte("date", historyStartDate),
      )
      .collect();
    const observedComparisonRows = historicalRows
      .filter(
        (row) =>
          row.accuObservedMaxF !== undefined &&
          row.accuObservedMaxF !== null &&
          row.metarMaxF !== undefined &&
          row.metarMaxF !== null,
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 60)
      .map((row) => ({
        date: row.date,
        noaaHighF: row.metarMaxF,
        noaaHighAtUtc: row.metarMaxAtUtc ?? null,
        accuHighF: row.accuObservedMaxF,
        accuHighAtUtc: row.accuObservedMaxAtUtc ?? null,
        accuObsCount: row.accuObservedObsCount ?? null,
        deltaF: roundToTenth(row.accuObservedMaxF - row.metarMaxF),
      }));

    const run = await ctx.db
      .query("forecastRuns")
      .withIndex("by_runKey", (query) => query.eq("runKey", FORECAST_RUN_KEY))
      .first();

    return {
      generatedAtMs: Date.now(),
      runKey: FORECAST_RUN_KEY,
      mainLocationKey: O_HARE_LOCATION_KEY,
      locations,
      dates: ohareDates,
      ohareComparisons,
      observedComparisonRows,
      run: run
        ? {
            lastStatus: run.lastStatus,
            lastStartedAt: run.lastStartedAt ?? null,
            lastFinishedAt: run.lastFinishedAt ?? null,
            lastSuccessAt: run.lastSuccessAt ?? null,
            lastError: run.lastError ?? null,
            locationsProcessed: run.locationsProcessed ?? null,
            endpointsFetched: run.endpointsFetched ?? null,
            endpointsSkipped: run.endpointsSkipped ?? null,
          }
        : null,
    };
  },
});

export const ensureForecastLocations = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let updated = 0;
    for (const configured of FORECAST_LOCATIONS) {
      const existing = await ctx.db
        .query("locations")
        .withIndex("by_accuweatherKey", (query) =>
          query.eq("accuweatherLocationKey", configured.locationKey),
        )
        .first();

      const desired = {
        name: configured.name,
        timeZone: configured.timeZone,
        lat: configured.lat,
        lon: configured.lon,
        accuweatherLocationKey: configured.locationKey,
        accuweatherEnglishName: configured.name,
        active: true,
        ...(configured.stationIcao ? { stationIcao: configured.stationIcao } : {}),
      };

      if (!existing) {
        await ctx.db.insert("locations", desired);
        updated += 1;
        continue;
      }

      const patch = {};
      for (const [key, value] of Object.entries(desired)) {
        if (existing[key] !== value) {
          patch[key] = value;
        }
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
        updated += 1;
      }
    }
    return { updated, atMs: now };
  },
});

export const upsertLocationFromDetails = internalMutationGeneric({
  args: {
    locationKey: v.string(),
    name: v.string(),
    englishName: v.optional(v.string()),
    lat: v.number(),
    lon: v.number(),
    timeZone: v.string(),
    accuweatherType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const configured = getConfiguredLocationByKey(args.locationKey);
    const existing = await ctx.db
      .query("locations")
      .withIndex("by_accuweatherKey", (query) =>
        query.eq("accuweatherLocationKey", args.locationKey),
      )
      .first();

    const stationIcao = configured?.stationIcao;
    const desired = {
      name: args.name,
      timeZone: args.timeZone,
      lat: args.lat,
      lon: args.lon,
      accuweatherLocationKey: args.locationKey,
      accuweatherEnglishName: args.englishName ?? args.name,
      active: true,
      ...(stationIcao ? { stationIcao } : {}),
      ...(args.accuweatherType ? { accuweatherType: args.accuweatherType } : {}),
    };

    if (!existing) {
      const locationId = await ctx.db.insert("locations", desired);
      return await ctx.db.get(locationId);
    }

    const patch = {};
    for (const [key, value] of Object.entries(desired)) {
      if (value !== undefined && existing[key] !== value) {
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(existing._id, patch);
    }
    return await ctx.db.get(existing._id);
  },
});

export const insertSnapshot = internalMutationGeneric({
  args: {
    locationKey: v.string(),
    endpointType: endpointTypeValidator,
    fetchedAtMs: v.number(),
    headerDateMs: v.optional(v.number()),
    expiresAtMs: v.optional(v.number()),
    payloadHash: v.string(),
    payloadJson: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("forecastSnapshots", {
      ...args,
      updatedAt: now,
    });
  },
});

export const upsertCurrentConditions = internalMutationGeneric({
  args: {
    locationKey: v.string(),
    localDateISO: v.optional(v.string()),
    observedAtEpochMs: v.optional(v.number()),
    observedAtLocal: v.optional(v.string()),
    tempF: v.optional(v.number()),
    tempC: v.optional(v.number()),
    realFeelF: v.optional(v.number()),
    realFeelC: v.optional(v.number()),
    weatherText: v.optional(v.string()),
    weatherIcon: v.optional(v.number()),
    isDayTime: v.optional(v.boolean()),
    hasPrecipitation: v.optional(v.boolean()),
    precipitationType: v.optional(v.string()),
    mobileLink: v.optional(v.string()),
    link: v.optional(v.string()),
    sourceFetchedAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const location = await ctx.db
      .query("locations")
      .withIndex("by_accuweatherKey", (query) =>
        query.eq("accuweatherLocationKey", args.locationKey),
      )
      .first();
    if (!location) {
      throw new Error(`Location ${args.locationKey} is not configured.`);
    }

    const existing = await ctx.db
      .query("forecastCurrentConditions")
      .withIndex("by_location", (query) => query.eq("locationKey", args.locationKey))
      .first();
    const now = Date.now();
    const patch = {
      locationId: location._id,
      locationKey: args.locationKey,
      ...(args.observedAtEpochMs !== undefined
        ? { observedAtEpochMs: args.observedAtEpochMs }
        : {}),
      ...(args.observedAtLocal !== undefined ? { observedAtLocal: args.observedAtLocal } : {}),
      ...(args.tempF !== undefined ? { tempF: args.tempF } : {}),
      ...(args.tempC !== undefined ? { tempC: args.tempC } : {}),
      ...(args.realFeelF !== undefined ? { realFeelF: args.realFeelF } : {}),
      ...(args.realFeelC !== undefined ? { realFeelC: args.realFeelC } : {}),
      ...(args.weatherText !== undefined ? { weatherText: args.weatherText } : {}),
      ...(args.weatherIcon !== undefined ? { weatherIcon: args.weatherIcon } : {}),
      ...(args.isDayTime !== undefined ? { isDayTime: args.isDayTime } : {}),
      ...(args.hasPrecipitation !== undefined
        ? { hasPrecipitation: args.hasPrecipitation }
        : {}),
      ...(args.precipitationType !== undefined
        ? { precipitationType: args.precipitationType }
        : {}),
      ...(args.mobileLink !== undefined ? { mobileLink: args.mobileLink } : {}),
      ...(args.link !== undefined ? { link: args.link } : {}),
      sourceFetchedAtMs: args.sourceFetchedAtMs,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return;
    }

    await ctx.db.insert("forecastCurrentConditions", {
      ...patch,
      createdAt: now,
    });
  },
});

export const upsertObservedDailyHigh = internalMutationGeneric({
  args: {
    locationKey: v.string(),
    stationIcao: v.optional(v.string()),
    timeZone: v.string(),
    localDateISO: v.optional(v.string()),
    observedAtEpochMs: v.optional(v.number()),
    observedAtLocal: v.optional(v.string()),
    tempF: v.optional(v.number()),
    tempC: v.optional(v.number()),
    sourceFetchedAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      args.observedAtEpochMs === undefined ||
      args.observedAtEpochMs === null ||
      args.tempF === undefined ||
      args.tempF === null
    ) {
      return { updated: false, reason: "missing_observation" };
    }

    const location = await ctx.db
      .query("locations")
      .withIndex("by_accuweatherKey", (query) =>
        query.eq("accuweatherLocationKey", args.locationKey),
      )
      .first();
    if (!location) {
      throw new Error(`Location ${args.locationKey} is not configured.`);
    }

    const localDateISO =
      args.localDateISO ||
      formatDateForZone(args.observedAtEpochMs, args.timeZone || location.timeZone);
    const observedAtLocal =
      args.observedAtLocal ||
      formatDateTimeForZone(args.observedAtEpochMs, args.timeZone || location.timeZone);
    const now = Date.now();
    const roundedTempF = roundToTenth(args.tempF);
    const roundedTempC =
      args.tempC === undefined || args.tempC === null
        ? undefined
        : roundToTenth(args.tempC);

    const existing = await ctx.db
      .query("forecastObservedDailyHighs")
      .withIndex("by_location_date", (query) =>
        query.eq("locationKey", args.locationKey).eq("localDateISO", localDateISO),
      )
      .first();

    let maxTempF = roundedTempF;
    let maxTempC = roundedTempC;
    let maxObservedAtEpochMs = args.observedAtEpochMs;
    let maxObservedAtLocal = observedAtLocal;
    let sampleCount = 1;

    if (existing) {
      sampleCount = (existing.sampleCount ?? 0) + 1;
      const shouldReplaceMax =
        roundedTempF > existing.maxTempF ||
        (roundedTempF === existing.maxTempF &&
          args.observedAtEpochMs > existing.maxObservedAtEpochMs);
      if (!shouldReplaceMax) {
        maxTempF = existing.maxTempF;
        maxTempC = existing.maxTempC;
        maxObservedAtEpochMs = existing.maxObservedAtEpochMs;
        maxObservedAtLocal = existing.maxObservedAtLocal;
      }

      await ctx.db.patch(existing._id, {
        maxTempF,
        ...(maxTempC !== undefined ? { maxTempC } : {}),
        maxObservedAtEpochMs,
        maxObservedAtLocal,
        sampleCount,
        lastObservedAtEpochMs: args.observedAtEpochMs,
        lastObservedAtLocal: observedAtLocal,
        sourceFetchedAtMs: args.sourceFetchedAtMs,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("forecastObservedDailyHighs", {
        locationId: location._id,
        locationKey: args.locationKey,
        localDateISO,
        maxTempF,
        ...(maxTempC !== undefined ? { maxTempC } : {}),
        maxObservedAtEpochMs,
        maxObservedAtLocal,
        sampleCount,
        lastObservedAtEpochMs: args.observedAtEpochMs,
        lastObservedAtLocal: observedAtLocal,
        sourceFetchedAtMs: args.sourceFetchedAtMs,
        createdAt: now,
        updatedAt: now,
      });
    }

    if ((args.stationIcao ?? "").toUpperCase() !== O_HARE_ICAO) {
      return {
        updated: true,
        localDateISO,
        maxTempF,
        sampleCount,
      };
    }

    const comparison = await ctx.db
      .query("dailyComparisons")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", O_HARE_ICAO).eq("date", localDateISO),
      )
      .first();

    const comparisonPatch = {
      accuObservedMaxF: maxTempF,
      ...(maxTempC !== undefined ? { accuObservedMaxC: maxTempC } : {}),
      accuObservedMaxAtUtc: maxObservedAtEpochMs,
      accuObservedMaxAtLocal: maxObservedAtLocal,
      accuObservedObsCount: sampleCount,
      updatedAt: now,
    };

    const metarOfficialMaxF = comparison?.metarMaxF;
    if (metarOfficialMaxF !== undefined && metarOfficialMaxF !== null) {
      comparisonPatch.errObservedRawF = roundToTenth(maxTempF - metarOfficialMaxF);
      comparisonPatch.errObservedRoundedF = roundToTenth(
        maxTempF - Math.round(metarOfficialMaxF),
      );
    }

    if (comparison) {
      await ctx.db.patch(comparison._id, comparisonPatch);
    } else {
      await ctx.db.insert("dailyComparisons", {
        stationIcao: O_HARE_ICAO,
        date: localDateISO,
        ...comparisonPatch,
      });
    }

    return {
      updated: true,
      localDateISO,
      maxTempF,
      sampleCount,
    };
  },
});

export const upsertDailySummaries = internalMutationGeneric({
  args: {
    locationKey: v.string(),
    stationIcao: v.optional(v.string()),
    summaries: v.array(dailySummaryInputValidator),
  },
  handler: async (ctx, args) => {
    const location = await ctx.db
      .query("locations")
      .withIndex("by_accuweatherKey", (query) =>
        query.eq("accuweatherLocationKey", args.locationKey),
      )
      .first();
    if (!location) {
      throw new Error(`Location ${args.locationKey} is not configured.`);
    }

    const keepDates = new Set();
    const now = Date.now();

    for (const summary of args.summaries) {
      keepDates.add(summary.localDateISO);

      const existing = await ctx.db
        .query("forecastDailySummaries")
        .withIndex("by_location_date", (query) =>
          query
            .eq("locationKey", args.locationKey)
            .eq("localDateISO", summary.localDateISO),
        )
        .first();

      const patch = {
        locationId: location._id,
        locationKey: args.locationKey,
        locationName: summary.locationName,
        timeZone: summary.timeZone,
        localDateISO: summary.localDateISO,
        dayIndex: summary.dayIndex,
        forecastHighF: roundToTenth(summary.forecastHighF),
        ...(summary.forecastLowF !== undefined
          ? { forecastLowF: roundToTenth(summary.forecastLowF) }
          : {}),
        peakMethod: summary.peakMethod,
        ...(summary.nearPeakThresholdF !== undefined
          ? { nearPeakThresholdF: roundToTenth(summary.nearPeakThresholdF) }
          : {}),
        ...(summary.peakStartEpochMs !== undefined
          ? { peakStartEpochMs: summary.peakStartEpochMs }
          : {}),
        ...(summary.peakEndEpochMs !== undefined
          ? { peakEndEpochMs: summary.peakEndEpochMs }
          : {}),
        ...(summary.peakDurationMinutes !== undefined
          ? { peakDurationMinutes: summary.peakDurationMinutes }
          : {}),
        ...(summary.peakStartLocal !== undefined
          ? { peakStartLocal: summary.peakStartLocal }
          : {}),
        ...(summary.peakEndLocal !== undefined
          ? { peakEndLocal: summary.peakEndLocal }
          : {}),
        snapshotFetchedAtMs: summary.snapshotFetchedAtMs,
        hourlyPoints: summary.hourlyPoints,
        updatedAt: now,
      };

      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("forecastDailySummaries", {
          ...patch,
          createdAt: now,
        });
      }

      if ((args.stationIcao ?? "").toUpperCase() !== O_HARE_ICAO) {
        continue;
      }

      const comparison = await ctx.db
        .query("dailyComparisons")
        .withIndex("by_station_date", (query) =>
          query.eq("stationIcao", O_HARE_ICAO).eq("date", summary.localDateISO),
        )
        .first();

      const comparisonPatch = {
        accuHighF_latest: roundToTenth(summary.forecastHighF),
        ...(summary.forecastLowF !== undefined
          ? { accuLowF_latest: roundToTenth(summary.forecastLowF) }
          : {}),
        ...(summary.peakStartEpochMs !== undefined
          ? { accuPeakStartUtc_latest: summary.peakStartEpochMs }
          : {}),
        ...(summary.peakEndEpochMs !== undefined
          ? { accuPeakEndUtc_latest: summary.peakEndEpochMs }
          : {}),
        ...(summary.peakStartLocal !== undefined
          ? { accuPeakStartLocal_latest: summary.peakStartLocal }
          : {}),
        ...(summary.peakEndLocal !== undefined
          ? { accuPeakEndLocal_latest: summary.peakEndLocal }
          : {}),
        ...(summary.peakDurationMinutes !== undefined
          ? { accuPeakDurationMinutes_latest: summary.peakDurationMinutes }
          : {}),
        accuSnapshotAtUtc_latest: summary.snapshotFetchedAtMs,
        updatedAt: now,
      };

      if (comparison?.metarMaxF !== undefined && comparison.metarMaxF !== null) {
        const rawErrorF = roundToTenth(summary.forecastHighF - comparison.metarMaxF);
        const roundedErrorF = roundToTenth(
          summary.forecastHighF - Math.round(comparison.metarMaxF),
        );
        comparisonPatch.errRawF = rawErrorF;
        comparisonPatch.errRoundedF = roundedErrorF;
      }

      const timingDeltaMinutes = computePeakTimingDeltaMinutes(
        comparison?.metarMaxAtUtc,
        summary.peakStartEpochMs,
        summary.peakEndEpochMs,
      );
      if (timingDeltaMinutes !== null) {
        comparisonPatch.peakHit = timingDeltaMinutes === 0;
        comparisonPatch.peakTimingDeltaMinutes = timingDeltaMinutes;
      }

      if (comparison) {
        await ctx.db.patch(comparison._id, comparisonPatch);
      } else {
        await ctx.db.insert("dailyComparisons", {
          stationIcao: O_HARE_ICAO,
          date: summary.localDateISO,
          ...comparisonPatch,
        });
      }
    }

    const existingRows = await ctx.db
      .query("forecastDailySummaries")
      .withIndex("by_location", (query) => query.eq("locationKey", args.locationKey))
      .collect();
    let removed = 0;
    for (const row of existingRows) {
      if (!keepDates.has(row.localDateISO)) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }

    return { upserted: args.summaries.length, removed };
  },
});

export const updateForecastRunStatus = internalMutationGeneric({
  args: {
    runKey: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("ok"),
      v.literal("error"),
    ),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    successAt: v.optional(v.number()),
    error: v.optional(v.string()),
    locationsProcessed: v.optional(v.number()),
    endpointsFetched: v.optional(v.number()),
    endpointsSkipped: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("forecastRuns")
      .withIndex("by_runKey", (query) => query.eq("runKey", args.runKey))
      .first();
    const now = Date.now();
    const patch = {
      lastStatus: args.status,
      ...(args.startedAt !== undefined ? { lastStartedAt: args.startedAt } : {}),
      ...(args.finishedAt !== undefined ? { lastFinishedAt: args.finishedAt } : {}),
      ...(args.successAt !== undefined ? { lastSuccessAt: args.successAt } : {}),
      ...(args.error !== undefined ? { lastError: args.error } : {}),
      ...(args.locationsProcessed !== undefined
        ? { locationsProcessed: args.locationsProcessed }
        : {}),
      ...(args.endpointsFetched !== undefined
        ? { endpointsFetched: args.endpointsFetched }
        : {}),
      ...(args.endpointsSkipped !== undefined
        ? { endpointsSkipped: args.endpointsSkipped }
        : {}),
      updatedAt: now,
    };

    if (!existing) {
      await ctx.db.insert("forecastRuns", {
        runKey: args.runKey,
        ...patch,
      });
      return;
    }
    await ctx.db.patch(existing._id, patch);
  },
});

async function fetchEndpointWithCache({
  ctx,
  locationKey,
  endpointType,
  url,
  force = false,
}) {
  const now = Date.now();
  if (!force) {
    const latest = await ctx.runQuery("forecast:getLatestSnapshot", {
      locationKey,
      endpointType,
    });
    if (
      latest?.expiresAtMs !== undefined &&
      latest.expiresAtMs !== null &&
      latest.expiresAtMs > now + CACHE_REFRESH_SKEW_MS
    ) {
      const payload = JSON.parse(latest.payloadJson);
      return {
        payload,
        fetchedAtMs: latest.fetchedAtMs,
        skippedFetch: true,
      };
    }
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${endpointType} request failed (${response.status}): ${body.slice(0, 160)}`,
    );
  }

  const payloadJson = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error(`${endpointType} response was not valid JSON.`);
  }
  const fetchedAtMs = Date.now();
  await ctx.runMutation("forecast:insertSnapshot", {
    locationKey,
    endpointType,
    fetchedAtMs,
    headerDateMs: parseHttpDateMs(response.headers.get("Date")) ?? undefined,
    expiresAtMs: parseHttpDateMs(response.headers.get("Expires")) ?? undefined,
    payloadHash: computeStringHash(payloadJson),
    payloadJson,
  });

  return {
    payload,
    fetchedAtMs,
    skippedFetch: false,
  };
}

async function refreshSingleLocation({ ctx, configured, apiKey, force }) {
  const locationResponse = await fetchEndpointWithCache({
    ctx,
    locationKey: configured.locationKey,
    endpointType: ENDPOINT_TYPE.LOCATION,
    url: buildAccuweatherUrl(`/locations/v1/${configured.locationKey}`, apiKey),
    force,
  });

  const locationDetails = parseLocationDetails(locationResponse.payload, configured);
  await ctx.runMutation("forecast:upsertLocationFromDetails", {
    locationKey: configured.locationKey,
    name: locationDetails.name,
    englishName: locationDetails.englishName,
    lat: locationDetails.lat,
    lon: locationDetails.lon,
    timeZone: locationDetails.timeZone,
    accuweatherType: locationDetails.accuweatherType,
  });

  let currentConditionsFetched = 0;
  let currentConditionsSkipped = 0;
  let currentConditionsError = "";
  let currentConditionsSnapshotAtMs = 0;
  try {
    const currentConditionsResponse = await fetchEndpointWithCache({
      ctx,
      locationKey: configured.locationKey,
      endpointType: ENDPOINT_TYPE.CURRENT_CONDITIONS,
      url: buildAccuweatherUrl(
        `/currentconditions/v1/${configured.locationKey}`,
        apiKey,
        {
          details: "true",
        },
      ),
      force,
    });
    currentConditionsFetched = Number(currentConditionsResponse.skippedFetch === false);
    currentConditionsSkipped = Number(currentConditionsResponse.skippedFetch === true);
    currentConditionsSnapshotAtMs = currentConditionsResponse.fetchedAtMs;

    const parsedCurrent = parseCurrentConditions(
      currentConditionsResponse.payload,
      locationDetails.timeZone,
    );
    await ctx.runMutation("forecast:upsertCurrentConditions", {
      locationKey: configured.locationKey,
      ...parsedCurrent,
      sourceFetchedAtMs: currentConditionsResponse.fetchedAtMs,
    });
    await ctx.runMutation("forecast:upsertObservedDailyHigh", {
      locationKey: configured.locationKey,
      stationIcao: configured.stationIcao,
      timeZone: locationDetails.timeZone,
      localDateISO: parsedCurrent.localDateISO,
      observedAtEpochMs: parsedCurrent.observedAtEpochMs,
      observedAtLocal: parsedCurrent.observedAtLocal,
      tempF: parsedCurrent.tempF,
      tempC: parsedCurrent.tempC,
      sourceFetchedAtMs: currentConditionsResponse.fetchedAtMs,
    });
  } catch (error) {
    currentConditionsError = error instanceof Error ? error.message : String(error);
  }

  const dailyResponse = await fetchEndpointWithCache({
    ctx,
    locationKey: configured.locationKey,
    endpointType: ENDPOINT_TYPE.DAILY_5DAY,
    url: buildAccuweatherUrl(
      `/forecasts/v1/daily/5day/${configured.locationKey}`,
      apiKey,
      {
        metric: "false",
      },
    ),
    force,
  });

  let hourlyResponse = null;
  let hourlyFallbackUsed = false;
  let hourlyFallbackReason = "";
  try {
    hourlyResponse = await fetchEndpointWithCache({
      ctx,
      locationKey: configured.locationKey,
      endpointType: ENDPOINT_TYPE.HOURLY_120HOUR,
      url: buildAccuweatherUrl(
        `/forecasts/v1/hourly/120hour/${configured.locationKey}`,
        apiKey,
        {
          metric: "false",
        },
      ),
      force,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!looksLikeHourly120Unsupported(message)) {
      throw error;
    }
    hourlyFallbackUsed = true;
    hourlyFallbackReason = message;
    hourlyResponse = await fetchEndpointWithCache({
      ctx,
      locationKey: configured.locationKey,
      endpointType: ENDPOINT_TYPE.HOURLY_72HOUR,
      url: buildAccuweatherUrl(
        `/forecasts/v1/hourly/72hour/${configured.locationKey}`,
        apiKey,
        {
          metric: "false",
        },
      ),
      force,
    });
  }

  const dailyForecasts = parseDailyForecasts(dailyResponse.payload);
  if (dailyForecasts.length === 0) {
    throw new Error("No daily forecasts returned.");
  }
  const hourlyForecasts = parseHourlyForecasts(
    hourlyResponse.payload,
    locationDetails.timeZone,
  );
  const snapshotFetchedAtMs = Math.max(
    locationResponse.fetchedAtMs,
    currentConditionsSnapshotAtMs,
    dailyResponse.fetchedAtMs,
    hourlyResponse.fetchedAtMs,
  );

  const summaries = buildDailySummaries({
    locationName: locationDetails.name,
    timeZone: locationDetails.timeZone,
    dailyForecasts,
    hourlyForecasts,
    snapshotFetchedAtMs,
  });

  await ctx.runMutation("forecast:upsertDailySummaries", {
    locationKey: configured.locationKey,
    stationIcao: configured.stationIcao,
    summaries,
  });

  const endpointsFetched =
    Number(locationResponse.skippedFetch === false) +
    currentConditionsFetched +
    Number(dailyResponse.skippedFetch === false) +
    Number(hourlyResponse.skippedFetch === false);
  const endpointsSkipped =
    Number(locationResponse.skippedFetch === true) +
    currentConditionsSkipped +
    Number(dailyResponse.skippedFetch === true) +
    Number(hourlyResponse.skippedFetch === true);

  return {
    locationKey: configured.locationKey,
    locationName: locationDetails.name,
    summariesCreated: summaries.length,
    endpointsFetched,
    endpointsSkipped,
    snapshotFetchedAtMs,
    ...(currentConditionsError
      ? { currentConditionsError: currentConditionsError.slice(0, 220) }
      : {}),
    hourlyFallbackUsed,
    hourlyFallbackReason,
  };
}

export const refreshForecastNow = actionGeneric({
  args: {
    force: v.optional(v.boolean()),
    withJitter: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const force = args.force ?? false;
    const withJitter = args.withJitter ?? false;

    await ctx.runMutation("forecast:ensureForecastLocations", {});

    if (withJitter) {
      const jitterMs =
        JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS + 1));
      await sleep(jitterMs);
    }

    const apiKey = process.env.ACCUWEATHER_API_KEY;
    if (!apiKey) {
      const message = "Missing ACCUWEATHER_API_KEY environment variable.";
      await ctx.runMutation("forecast:updateForecastRunStatus", {
        runKey: FORECAST_RUN_KEY,
        status: "error",
        startedAt,
        finishedAt: Date.now(),
        error: message,
        locationsProcessed: 0,
        endpointsFetched: 0,
        endpointsSkipped: 0,
      });
      return { ok: false, reason: "missing_api_key", message };
    }

    await ctx.runMutation("forecast:updateForecastRunStatus", {
      runKey: FORECAST_RUN_KEY,
      status: "running",
      startedAt,
      error: "",
    });

    const locationResults = [];
    let endpointsFetched = 0;
    let endpointsSkipped = 0;

    for (let index = 0; index < FORECAST_LOCATIONS.length; index += 1) {
      if (index > 0) {
        await sleep(LOCATION_STAGGER_MS);
      }
      const configured = FORECAST_LOCATIONS[index];
      try {
        const refreshed = await refreshSingleLocation({
          ctx,
          configured,
          apiKey,
          force,
        });
        endpointsFetched += refreshed.endpointsFetched;
        endpointsSkipped += refreshed.endpointsSkipped;
        locationResults.push({
          locationKey: configured.locationKey,
          ok: true,
          summariesCreated: refreshed.summariesCreated,
          endpointsFetched: refreshed.endpointsFetched,
          endpointsSkipped: refreshed.endpointsSkipped,
          snapshotFetchedAtMs: refreshed.snapshotFetchedAtMs,
          ...(refreshed.currentConditionsError
            ? { currentConditionsError: refreshed.currentConditionsError }
            : {}),
          hourlyFallbackUsed: refreshed.hourlyFallbackUsed,
          ...(refreshed.hourlyFallbackReason
            ? { hourlyFallbackReason: refreshed.hourlyFallbackReason }
            : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        locationResults.push({
          locationKey: configured.locationKey,
          ok: false,
          error: message,
        });
      }
    }

    const succeeded = locationResults.filter((row) => row.ok).length;
    const failed = locationResults.length - succeeded;
    const finishedAt = Date.now();
    const ok = succeeded > 0;
    const status = ok ? "ok" : "error";
    const failureRows = locationResults.filter((row) => !row.ok);
    const failureDetails = failureRows
      .slice(0, 3)
      .map((row) => `${row.locationKey}: ${String(row.error ?? "").slice(0, 110)}`)
      .join(" | ");
    const errorMessage =
      failed === 0
        ? ""
        : ok
          ? `${failed} of ${locationResults.length} locations failed.${failureDetails ? ` ${failureDetails}` : ""}`
          : `Forecast refresh failed for all configured locations.${failureDetails ? ` ${failureDetails}` : ""}`;

    await ctx.runMutation("forecast:updateForecastRunStatus", {
      runKey: FORECAST_RUN_KEY,
      status,
      startedAt,
      finishedAt,
      ...(ok ? { successAt: finishedAt } : {}),
      error: errorMessage,
      locationsProcessed: succeeded,
      endpointsFetched,
      endpointsSkipped,
    });

    return {
      ok,
      partial: failed > 0 && ok,
      startedAt,
      finishedAt,
      locationsProcessed: succeeded,
      locationsFailed: failed,
      endpointsFetched,
      endpointsSkipped,
      error: errorMessage || undefined,
      results: locationResults,
    };
  },
});
