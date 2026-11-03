// The daily high each provider publishes for RKSI, kept as one row per distinct
// value per KST date so the day page can show when a forecast changed, and the
// checks that a forecast is for the airport rather than the city around it. See
// docs/seoul-forecast-highs.md.
import { distanceAndBearing } from "./seoulNearbyStations.js";
import { KMA_APPROVAL_FLAG, RKSI_POINT, isValidDate, kstDate, shiftDate, tenth } from "./seoulProviderForecastModel.js";

export const ACCUWEATHER_APPROVAL_FLAG = "ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED";
export const ACCUWEATHER_KEY_NAME = "ACCUWEATHER_RKSI_API_KEY";
// A stopgap until an API key exists. AccuWeather's website terms prohibit scraping
// without a separate written agreement, so setting this is the owner's decision,
// not AccuWeather's approval.
export const ACCUWEATHER_PAGE_APPROVAL_FLAG = "ACCUWEATHER_RKSI_PUBLIC_PAGE_ACCESS_APPROVED";
// The airport's own AccuWeather location. A geoposition search would return the
// neighbouring city instead, so the key is fixed and never looked up.
export const ACCUWEATHER_LOCATION_KEY = "3602_poi";
export const ACCUWEATHER_PAGE_URL = `https://www.accuweather.com/en/kr/incheon-international-airport/${ACCUWEATHER_LOCATION_KEY}/10-day-weather-forecast/${ACCUWEATHER_LOCATION_KEY}`;
const ACCUWEATHER_PAGE_ROWS = 5;
// AccuWeather's API terms allow keeping its data for up to two weeks. The hourly
// cleanup can run an hour late, so this stays a full day inside that limit.
export const ACCUWEATHER_RETENTION_MS = 13 * 86_400_000;
const ACCUWEATHER_LEAD_DAYS = 4;
// RKSI's reference point is inside the airport; Incheon city is about 20 km away.
export const MAX_AIRPORT_DISTANCE_KM = 5;

// Fixed order: the card lists them this way.
export const FORECAST_HIGH_PROVIDERS = [
  { id: "kma", label: "KMA", sourceUrl: "https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI", approvalFlag: KMA_APPROVAL_FLAG },
  { id: "weathercom", label: "Weather.com", sourceUrl: "https://weather.com/kr/incheon/airport/incheon-international-airport/tenday", approvalFlag: null },
  { id: "accuweather", label: "AccuWeather", sourceUrl: `https://www.accuweather.com/en/kr/incheon-international-airport/${ACCUWEATHER_LOCATION_KEY}/weather-forecast/${ACCUWEATHER_LOCATION_KEY}`, approvalFlag: ACCUWEATHER_APPROVAL_FLAG, keyName: ACCUWEATHER_KEY_NAME, pageFlag: ACCUWEATHER_PAGE_APPROVAL_FLAG,
    // AccuWeather's terms require its logo, linked to its site, wherever its data appears.
    attribution: { logoUrl: "https://developer.accuweather.com/brand-assets/horizontal/svg/AW_RGB_Rev_Small_R.svg", href: "https://www.accuweather.com" } },
];
export const forecastHighProviderById = (id) => FORECAST_HIGH_PROVIDERS.find((provider) => provider.id === id) ?? null;

/** Only the exact string "true" approves. A key is a credential, not approval, so it is checked second. */
export function forecastHighAccess(provider, env) {
  if (provider.pageFlag && env?.[provider.pageFlag] === "true") return "approved";
  if (provider.approvalFlag && env?.[provider.approvalFlag] !== "true") return "approval_required";
  return provider.keyName && !env?.[provider.keyName] ? "setup_required" : "approved";
}

/** Whether the cleanup may already have removed a date's earliest AccuWeather highs. */
export function accuweatherHistoryMayBePruned(date, now) {
  return Date.parse(`${date}T00:00:00+09:00`) - ACCUWEATHER_LEAD_DAYS * 86_400_000 <= now - ACCUWEATHER_RETENTION_MS;
}

const text = (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : undefined);
const compact = (row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));

/** A forecast that cannot be shown to be for the airport. Its values are never recorded. */
export class ForecastLocationError extends Error {}

function distanceFromAirport(label, latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new ForecastLocationError(`${label} location has no coordinates.`);
  const distanceKm = Math.round(distanceAndBearing(RKSI_POINT, { latitude, longitude }).distanceKm * 10) / 10;
  if (distanceKm > MAX_AIRPORT_DISTANCE_KM) throw new ForecastLocationError(`${label} location (${latitude}, ${longitude}) is ${distanceKm} km from RKSI.`);
  return distanceKm;
}

/** Weather.com's record for the icaoCode the forecast requests are made with. */
export function verifyWeathercomLocation(payload, verifiedAt) {
  const location = payload?.location ?? payload;
  const icaoCode = text(location?.icaoCode)?.toUpperCase();
  if (icaoCode !== "RKSI") throw new ForecastLocationError(`Weather.com location is ${icaoCode ?? "missing its ICAO code"}, not RKSI.`);
  const latitude = Number(location.latitude), longitude = Number(location.longitude);
  return compact({ name: text(location.airportName) ?? text(location.displayName), icaoCode, latitude, longitude,
    distanceKm: distanceFromAirport("Weather.com", latitude, longitude), verifiedAt });
}

export function verifyAccuweatherLocation(payload, verifiedAt) {
  const locationKey = text(payload?.Key)?.toLowerCase();
  if (locationKey !== ACCUWEATHER_LOCATION_KEY) throw new ForecastLocationError(`AccuWeather location is ${locationKey ?? "missing its key"}, not ${ACCUWEATHER_LOCATION_KEY}.`);
  const name = text(payload?.EnglishName) ?? text(payload?.LocalizedName);
  if (!/incheon/i.test(name ?? "") || !/airport/i.test(name ?? "")) throw new ForecastLocationError(`AccuWeather location ${locationKey} is named ${name ?? "nothing"}, not the airport.`);
  if (payload?.Country?.ID !== "KR") throw new ForecastLocationError(`AccuWeather location ${locationKey} is not in South Korea.`);
  const latitude = payload?.GeoPosition?.Latitude, longitude = payload?.GeoPosition?.Longitude;
  return { name, locationKey, latitude, longitude, distanceKm: distanceFromAirport("AccuWeather", latitude, longitude), verifiedAt };
}

/** Daily rows from AccuWeather's 5-day forecast requested with metric=true. Every row must link back to the airport. */
export function accuweatherDailyRows(payload) {
  const days = Array.isArray(payload?.DailyForecasts) ? payload.DailyForecasts : [];
  if (!days.length) throw new Error("AccuWeather forecast has no daily rows.");
  return days.map((day) => {
    if (!`${day?.Link ?? ""} ${day?.MobileLink ?? ""}`.toLowerCase().includes(ACCUWEATHER_LOCATION_KEY)) {
      throw new ForecastLocationError("AccuWeather forecast does not link to the airport location.");
    }
    const date = /^(\d{4}-\d{2}-\d{2})T[\d:.]+\+09:00$/.exec(day?.Date ?? "")?.[1];
    if (!date) throw new Error("AccuWeather forecast date is not in Seoul time.");
    const maximum = day?.Temperature?.Maximum;
    if (maximum?.Unit !== "C" || !Number.isFinite(maximum.Value)) throw new Error("AccuWeather forecast has no Celsius maximum.");
    return { date, maxTempC: tenth(maximum.Value) };
  });
}

function jsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * The airport evidence and daily highs in AccuWeather's server-rendered 10-day page.
 * The page has no published format, so this is checked against what it returned on
 * November 3, 2026. Rows carry month/day only and use the page's unit, so both are read.
 */
export function accuweatherPageForecast(html, capturedAt) {
  const key = ACCUWEATHER_LOCATION_KEY;
  const canonical = /<link\s+rel="canonical"\s+href="([^"]+)"/.exec(html)?.[1] ?? "";
  if (!canonical.toLowerCase().includes(`/${key}/`)) throw new ForecastLocationError("AccuWeather page is not for the airport location.");
  const place = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => jsonOrNull(match[1])).find((row) => row?.["@type"] === "Place");
  const name = text(place?.name);
  if (!/incheon/i.test(name ?? "") || !/airport/i.test(name ?? "")) throw new ForecastLocationError(`AccuWeather page names ${name ?? "nothing"}, not the airport.`);
  if (place?.geo?.addressCountry !== "KR") throw new ForecastLocationError("AccuWeather page is not for South Korea.");
  const latitude = Number(place?.geo?.latitude), longitude = Number(place?.geo?.longitude);
  const distanceKm = distanceFromAirport("AccuWeather", latitude, longitude);
  if (!/"timeZoneName"\s*:\s*"Asia\/Seoul"/.test(html)) throw new Error("AccuWeather page is not in Seoul time.");
  const unit = /class="header-temp">[^<]*<span class="unit">([CF])<\/span>/.exec(html)?.[1];
  if (!unit) throw new Error("AccuWeather page does not show its temperature unit.");
  const today = kstDate(capturedAt);
  const rows = html.split('class="daily-wrapper"').slice(1, ACCUWEATHER_PAGE_ROWS + 1).flatMap((block) => {
    const href = /class="daily-forecast-card[^"]*"\s+href="([^"]+)"/.exec(block)?.[1] ?? "";
    if (!href.toLowerCase().includes(`/${key}/`)) throw new ForecastLocationError("AccuWeather page row does not link to the airport location.");
    const monthDay = /module-header sub date">\s*(\d{1,2})\/(\d{1,2})\s*</.exec(block);
    const high = /class="high">\s*(-?\d+)(?:&#xB0;|°)/.exec(block)?.[1];
    if (!monthDay || high === undefined) return [];
    const suffix = `-${monthDay[1].padStart(2, "0")}-${monthDay[2].padStart(2, "0")}`;
    const thisYear = `${today.slice(0, 4)}${suffix}`;
    // A late-December page lists January dates, which belong to the next year.
    const date = thisYear < shiftDate(today, -7) ? `${Number(today.slice(0, 4)) + 1}${suffix}` : thisYear;
    return [{ date, maxTempC: unit === "F" ? tenth(((Number(high) - 32) * 5) / 9) : Number(high) }];
  });
  if (!rows.length) throw new Error("AccuWeather page has no daily highs.");
  return { rows, location: { name, locationKey: key, latitude, longitude, distanceKm, verifiedAt: capturedAt } };
}

/**
 * The highs in one capture. A date that has already ended is left out, so a
 * later capture cannot change a finished day, and so is a date whose rows disagree.
 */
export function forecastHighsInCapture(rows, capturedAt) {
  const today = kstDate(capturedAt), highs = new Map(), conflicting = new Set();
  for (const row of rows ?? []) {
    if (!isValidDate(row?.date) || row.date < today || !Number.isFinite(row.maxTempC) || row.maxTempC < -80 || row.maxTempC > 60) continue;
    if (highs.has(row.date) && highs.get(row.date) !== row.maxTempC) conflicting.add(row.date);
    highs.set(row.date, row.maxTempC);
  }
  return [...highs].filter(([date]) => !conflicting.has(date)).map(([date, highC]) => ({ date, highC }));
}

/** Adds a change row for each new value; a repeated value only moves lastSeenAt. */
export async function recordForecastHighs(ctx, provider, rows, capturedAt) {
  for (const { date, highC } of forecastHighsInCapture(rows, capturedAt)) {
    const latest = await ctx.db.query("seoulForecastHighChanges")
      .withIndex("by_station_provider_target_seen", (q) => q.eq("stationIcao", "RKSI").eq("provider", provider).eq("targetDate", date).lte("firstSeenAt", capturedAt))
      .order("desc").first();
    if (latest?.highC !== highC) {
      await ctx.db.insert("seoulForecastHighChanges", { stationIcao: "RKSI", provider, targetDate: date, highC,
        firstSeenAt: capturedAt, lastSeenAt: capturedAt, createdAt: Date.now() });
    } else if (capturedAt > latest.lastSeenAt) {
      await ctx.db.patch(latest._id, { lastSeenAt: capturedAt });
    }
  }
}

/** Records one provider check: its highs when it succeeded, and its status either way. */
export async function recordForecastCheck(ctx, { provider, capturedAt, status, error, location, rows }) {
  if (status === "ok") await recordForecastHighs(ctx, provider, rows, capturedAt);
  const existing = await ctx.db.query("seoulForecastHighStatus")
    .withIndex("by_station_provider", (q) => q.eq("stationIcao", "RKSI").eq("provider", provider)).first();
  const fields = {
    status, lastCheckAt: capturedAt, lastSuccessAt: status === "ok" ? capturedAt : existing?.lastSuccessAt,
    lastError: status === "ok" ? undefined : error, location: status === "location_unverified" ? undefined : location ?? existing?.location,
    updatedAt: Date.now(),
  };
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("seoulForecastHighStatus", compact({ stationIcao: "RKSI", provider, ...fields }));
}
