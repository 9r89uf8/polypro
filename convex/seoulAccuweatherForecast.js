import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  ACCUWEATHER_APPROVAL_FLAG, ACCUWEATHER_KEY_NAME, ACCUWEATHER_LOCATION_KEY, ACCUWEATHER_RETENTION_MS, ForecastLocationError,
  accuweatherDailyRows, recordForecastCheck, verifyAccuweatherLocation,
} from "./lib/seoulForecastHighs.js";
import { forecastHighCheckStatus, forecastHighLocation } from "./lib/seoulForecastHighsSchema.js";

const ACCUWEATHER_HOST = "https://dataservice.accuweather.com";
const FETCH_TIMEOUT_MS = 15_000;
// The location check costs one more call, so it runs once a day. Every forecast
// response is also checked for a link back to the airport.
const LOCATION_MAX_AGE_MS = 24 * 3_600_000;
const PRUNE_SCAN = 500;
const message = (error) => String(error instanceof Error ? error.message : error).slice(0, 300);
const approved = () => process.env[ACCUWEATHER_APPROVAL_FLAG] === "true";

// A running action can keep the environment it started with, so it reads the flag
// through this query before every request.
export const accessState = internalQueryGeneric({
  args: {},
  handler: async (ctx) => {
    if (!approved()) return { approved: false, location: null };
    const check = await ctx.db.query("seoulForecastHighStatus")
      .withIndex("by_station_provider", (q) => q.eq("stationIcao", "RKSI").eq("provider", "accuweather")).first();
    return { approved: true, location: check?.location ?? null };
  },
});

/**
 * Saves one check. The flag is checked again here, so approval removed during a
 * request discards its result. AccuWeather's terms exclude keeping an archive of
 * API data, so only the highs reach the database, not the response.
 */
export const storeCheck = internalMutationGeneric({
  args: {
    capturedAt: v.number(), status: forecastHighCheckStatus, error: v.optional(v.string()), location: v.optional(forecastHighLocation),
    rows: v.array(v.object({ date: v.string(), maxTempC: v.number() })),
  },
  handler: async (ctx, args) => {
    if (!approved()) return { status: "approval_required" };
    if (args.status !== "ok" && args.rows.length) throw new Error("Failed AccuWeather checks cannot store forecast rows.");
    await recordForecastCheck(ctx, { provider: "accuweather", ...args });
    return { status: args.status };
  },
});

async function accuweatherJson(path, params, apiKey) {
  const url = new URL(path, ACCUWEATHER_HOST);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // The key goes in a header, and a redirect could only lead somewhere other than this location.
    const response = await fetch(url.toString(), { headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` }, redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`AccuWeather ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Cron entry. Makes no request and writes nothing until the flag and the key are both set. */
export const collectAirportForecast = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    const access = () => ctx.runQuery(internal.seoulAccuweatherForecast.accessState, {});
    const store = (fields) => ctx.runMutation(internal.seoulAccuweatherForecast.storeCheck, { capturedAt, rows: [], ...fields });
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
      return await store({ status: error instanceof ForecastLocationError ? "location_unverified" : "error", error: message(error) });
    }
  },
});

/** Deletes old AccuWeather highs. Runs with or without the flag; pass retainMs: 0 to clear them all. */
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
