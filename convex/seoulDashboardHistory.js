import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { seoulMarketDate } from "./lib/seoulPolymarket.js";
import {
  SEOUL_FORECAST_APPROVAL_FLAG, SEOUL_FORECAST_HISTORY_LIMIT, SEOUL_FORECAST_SOURCE,
  SEOUL_FORECAST_URL, buildSeoulForecastHighHistory, seoulHistoryDay,
} from "./lib/seoulDashboardHistory.js";

export const getForecastHighHistory = queryGeneric({
  args: { stationIcao: v.optional(v.string()), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "RKSI").trim().toUpperCase();
    if (stationIcao !== "RKSI") throw new Error("Seoul forecast history supports RKSI only.");
    const now = Date.now(), today = seoulMarketDate(now), date = args.date ?? today;
    const approved = process.env[SEOUL_FORECAST_APPROVAL_FLAG] === "true";
    const empty = { stationIcao, date, today, approved, source: SEOUL_FORECAST_SOURCE, sourceUrl: SEOUL_FORECAST_URL,
      approvalFlagName: SEOUL_FORECAST_APPROVAL_FLAG, timeZone: "Asia/Seoul", captureCount: 0, revisionCount: 0,
      truncated: false, previousDayTruncated: false, first: null, latest: null, deltaC: null,
      previousDayBaseline: null, history: [], collectorStatus: "no_data" };
    // Gate before even reading retained captures or collector metadata.
    if (!approved) return { ...empty, status: "approval_required" };
    const day = seoulHistoryDay(date, now);
    if (!day) return { ...empty, status: "out_of_range" };
    const read = (start, end) => ctx.db.query("seoulKmaForecastCaptures")
      .withIndex("by_station_capturedAt", (q) => q.eq("stationIcao", stationIcao).gte("capturedAt", start).lt("capturedAt", end))
      .order("desc").take(SEOUL_FORECAST_HISTORY_LIMIT + 1);
    const [captures, previousCaptures, collector] = await Promise.all([
      read(day.start, Math.min(day.end, now + 1)), read(day.start - 86_400_000, day.start),
      ctx.db.query("seoulKmaForecastCollectorStatus").withIndex("by_station", (q) => q.eq("stationIcao", stationIcao)).first(),
    ]);
    return { ...empty, ...buildSeoulForecastHighHistory({
      captures: captures.slice(0, SEOUL_FORECAST_HISTORY_LIMIT),
      previousCaptures: previousCaptures.slice(0, SEOUL_FORECAST_HISTORY_LIMIT), date, now, collector,
      truncated: captures.length > SEOUL_FORECAST_HISTORY_LIMIT,
      previousDayTruncated: previousCaptures.length > SEOUL_FORECAST_HISTORY_LIMIT,
    }) };
  },
});
