import { internalActionGeneric, internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { FORECAST_HIGH_PROVIDERS, accuweatherHistoryMayBePruned, forecastHighAccess, forecastHighProviderById, recordForecastHighs } from "./lib/seoulForecastHighs.js";
import { isValidDate, shiftDate } from "./lib/seoulProviderForecastModel.js";

const CHANGE_LIMIT = 60;
const BACKFILL_PAGE = 25;

/**
 * Each provider's published highs for one KST date and when they changed. A
 * provider that is not approved comes back with no data, before any of its rows
 * are read. Failure messages stay on the server.
 */
export const getProviderHighs = queryGeneric({
  args: { stationIcao: v.optional(v.string()), date: v.string() },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "RKSI").trim().toUpperCase();
    if (stationIcao !== "RKSI") throw new Error("Seoul forecast highs support RKSI only.");
    if (!isValidDate(args.date)) throw new Error("Date must be a valid YYYY-MM-DD date");
    const providers = [];
    for (const provider of FORECAST_HIGH_PROVIDERS) {
      const access = forecastHighAccess(provider, process.env);
      const base = { id: provider.id, label: provider.label, sourceUrl: provider.sourceUrl, access };
      if (access === "approval_required") {
        providers.push({ ...base, status: "no_data", changes: [], truncated: false });
        continue;
      }
      const rows = await ctx.db.query("seoulForecastHighChanges")
        .withIndex("by_station_provider_target_seen", (q) => q.eq("stationIcao", stationIcao).eq("provider", provider.id).eq("targetDate", args.date))
        .order("desc").take(CHANGE_LIMIT + 1);
      const check = await ctx.db.query("seoulForecastHighStatus")
        .withIndex("by_station_provider", (q) => q.eq("stationIcao", stationIcao).eq("provider", provider.id)).first();
      providers.push({
        ...base, attribution: provider.attribution ?? null, status: check?.status ?? "no_data", lastCheckAt: check?.lastCheckAt ?? null, location: check?.location ?? null,
        changes: rows.slice(0, CHANGE_LIMIT).reverse().map(({ highC, firstSeenAt, lastSeenAt }) => ({ highC, firstSeenAt, lastSeenAt })),
        truncated: rows.length > CHANGE_LIMIT || (provider.id === "accuweather" && accuweatherHistoryMayBePruned(args.date, Date.now())),
      });
    }
    return { stationIcao, date: args.date, providers };
  },
});

const BACKFILL_SOURCES = {
  kma: { table: "seoulKmaForecastCaptures", rows: (capture) => (capture.status === "ok" && capture.source === "kma_amo_airport" ? capture.dailyRows : []) },
  weathercom: { table: "seoulForecastCaptures", rows: (capture) => (capture.weathercomStatus === "ok" ? capture.weathercomForecastDays : []) },
};
const backfillProvider = v.union(v.literal("kma"), v.literal("weathercom"));

export const backfillPage = internalMutationGeneric({
  args: { provider: backfillProvider, after: v.number(), before: v.number() },
  handler: async (ctx, { provider, after, before }) => {
    if (forecastHighAccess(forecastHighProviderById(provider), process.env) !== "approved") return { status: "approval_required" };
    const source = BACKFILL_SOURCES[provider];
    const captures = await ctx.db.query(source.table)
      .withIndex("by_station_capturedAt", (q) => q.eq("stationIcao", "RKSI").gt("capturedAt", after).lt("capturedAt", before))
      .order("asc").take(BACKFILL_PAGE);
    for (const capture of captures) await recordForecastHighs(ctx, provider, source.rows(capture), capture.capturedAt);
    return { status: captures.length < BACKFILL_PAGE ? "done" : "more", count: captures.length, after: captures.at(-1)?.capturedAt ?? after };
  },
});

/** Replays stored captures into the change rows, oldest first. Running it again changes nothing. */
export const backfillChanges = internalActionGeneric({
  args: { provider: backfillProvider, startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { provider, startDate, endDate }) => {
    if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) throw new Error("startDate and endDate must be valid dates, in order");
    const before = Date.parse(`${shiftDate(endDate, 1)}T00:00:00+09:00`);
    let after = Date.parse(`${startDate}T00:00:00+09:00`) - 1, captures = 0;
    for (;;) {
      const page = await ctx.runMutation(internal.seoulForecastHighs.backfillPage, { provider, after, before });
      if (page.status === "approval_required") return { status: "approval_required", captures };
      captures += page.count;
      if (page.status === "done") return { status: "done", captures };
      after = page.after;
    }
  },
});
