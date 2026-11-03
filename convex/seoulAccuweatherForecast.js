import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  ACCUWEATHER_APPROVAL_FLAG, ACCUWEATHER_KEY_NAME, ACCUWEATHER_LOCATION_KEY, ACCUWEATHER_PAGE_APPROVAL_FLAG, ACCUWEATHER_PAGE_URL,
  ACCUWEATHER_RETENTION_MS, ForecastLocationError, accuweatherDailyRows, accuweatherPageForecast, recordForecastCheck, verifyAccuweatherLocation,
} from "./lib/seoulForecastHighs.js";
import { forecastHighCheckStatus, forecastHighLocation } from "./lib/seoulForecastHighsSchema.js";

const ACCUWEATHER_HOST = "https://dataservice.accuweather.com";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_LENGTH = 2_000_000;
// The location check costs one more call, so it runs once a day. Every forecast
// response is also checked for a link back to the airport.
const LOCATION_MAX_AGE_MS = 24 * 3_600_000;
const PRUNE_SCAN = 500;
const message = (error) => String(error instanceof Error ? error.message : error).slice(0, 300);
const apiApproved = () => process.env[ACCUWEATHER_APPROVAL_FLAG] === "true";
const pageApproved = () => process.env[ACCUWEATHER_PAGE_APPROVAL_FLAG] === "true";
const failureStatus = (error) => (error instanceof ForecastLocationError ? "location_unverified" : "error");

// A running action can keep the environment it started with, so it reads the flags
// through this query before every request.
export const accessState = internalQueryGeneric({
  args: {},
  handler: async (ctx) => {
    if (!apiApproved() && !pageApproved()) return { approved: false, pageApproved: false, location: null };
    const check = await ctx.db.query("seoulForecastHighStatus")
      .withIndex("by_station_provider", (q) => q.eq("stationIcao", "RKSI").eq("provider", "accuweather")).first();
    return { approved: apiApproved(), pageApproved: pageApproved(), location: check?.location ?? null };
  },
});

/**
 * Saves one check. Its source's flag is checked again here, so approval removed
 * during a request discards the result. AccuWeather's terms exclude keeping an
 * archive of API data, so only the highs reach the database, not the response.
 */
export const storeCheck = internalMutationGeneric({
  args: {
    source: v.union(v.literal("api"), v.literal("page")), capturedAt: v.number(), status: forecastHighCheckStatus,
    error: v.optional(v.string()), location: v.optional(forecastHighLocation), rows: v.array(v.object({ date: v.string(), maxTempC: v.number() })),
  },
  handler: async (ctx, { source, ...args }) => {
    if (!(source === "page" ? pageApproved() : apiApproved())) return { status: "approval_required" };
    if (args.status !== "ok" && args.rows.length) throw new Error("Failed AccuWeather checks cannot store forecast rows.");
    await recordForecastCheck(ctx, { provider: "accuweather", ...args });
    return { status: args.status };
  },
});

async function timedFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // A redirect could only lead somewhere other than this location.
    const response = await fetch(url, { ...options, redirect: "error", signal: controller.signal });
    return { status: response.status, ok: response.ok, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function accuweatherJson(path, params, apiKey) {
  const url = new URL(path, ACCUWEATHER_HOST);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  // The key goes in a header, never in a URL.
  const response = await timedFetch(url.toString(), { headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`AccuWeather ${response.status}: ${response.body.slice(0, 200)}`);
  return JSON.parse(response.body);
}

/** Cron entry for the official API. Makes no request and writes nothing until the flag and the key are both set. */
export const collectAirportForecast = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    const access = () => ctx.runQuery(internal.seoulAccuweatherForecast.accessState, {});
    const store = (fields) => ctx.runMutation(internal.seoulAccuweatherForecast.storeCheck, { source: "api", capturedAt, rows: [], ...fields });
    const state = await access();
    if (!state.approved) return { status: "approval_required" };
    const apiKey = process.env[ACCUWEATHER_KEY_NAME];
    if (!apiKey) return { status: "setup_required" };
    const capturedAt = Date.now();
    let location = capturedAt - (state.location?.verifiedAt ?? 0) < LOCATION_MAX_AGE_MS ? state.location : null;
    try {
      if (!location) {
        location = verifyAccuweatherLocation(await accuweatherJson(`/locations/v1/${ACCUWEATHER_LOCATION_KEY}`, { language: "en-us" }, apiKey), Date.now());
        if (!(await access()).approved) return { status: "approval_required" };
      }
      const forecast = await accuweatherJson(`/forecasts/v1/daily/5day/${ACCUWEATHER_LOCATION_KEY}`, { language: "en-us", details: "false", metric: "true" }, apiKey);
      return await store({ status: "ok", location, rows: accuweatherDailyRows(forecast) });
    } catch (error) {
      return await store({ status: failureStatus(error), error: message(error) });
    }
  },
});

/**
 * Cron entry for the stopgap until a key exists: one plain request for the public
 * 10-day page, identified as this project. It stops by itself once the official API
 * is set up. A refusal is recorded as a failed check and is never worked around.
 */
export const collectAirportPage = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    const access = () => ctx.runQuery(internal.seoulAccuweatherForecast.accessState, {});
    const store = (fields) => ctx.runMutation(internal.seoulAccuweatherForecast.storeCheck, { source: "page", capturedAt, rows: [], ...fields });
    const state = await access();
    if (!state.pageApproved) return { status: "approval_required" };
    if (state.approved && process.env[ACCUWEATHER_KEY_NAME]) return { status: "superseded" };
    const capturedAt = Date.now();
    try {
      const response = await timedFetch(ACCUWEATHER_PAGE_URL, { headers: { Accept: "text/html", "Accept-Language": "en-US,en;q=0.9", "User-Agent": "polypro-rksi-forecast/1.0" } });
      if (!response.ok) throw new Error(`AccuWeather page ${response.status}`);
      if (response.body.length > MAX_PAGE_LENGTH) throw new Error("AccuWeather page is unexpectedly large.");
      if (!(await access()).pageApproved) return { status: "approval_required" };
      return await store({ status: "ok", ...accuweatherPageForecast(response.body, capturedAt) });
    } catch (error) {
      return await store({ status: failureStatus(error), error: message(error) });
    }
  },
});

/** Deletes old AccuWeather highs. Runs with or without the flags; pass retainMs: 0 to clear them all. */
export const pruneExpired = internalMutationGeneric({
  args: { retainMs: v.optional(v.number()) },
  handler: async (ctx, { retainMs = ACCUWEATHER_RETENTION_MS }) => {
    const cutoff = Date.now() - retainMs;
    const rows = await ctx.db.query("seoulForecastHighChanges")
      .withIndex("by_station_provider_target_seen", (q) => q.eq("stationIcao", "RKSI").eq("provider", "accuweather")).take(PRUNE_SCAN);
    const expired = rows.filter((row) => row.lastSeenAt <= cutoff);
    await Promise.all(expired.map((row) => ctx.db.delete(row._id)));
    return { deleted: expired.length, more: rows.length === PRUNE_SCAN };
  },
});
