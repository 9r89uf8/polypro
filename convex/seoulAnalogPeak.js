import { internalMutationGeneric, internalQueryGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { ANALOG_LIBRARY, ANALOG_LIBRARY_SOURCE, ANALOG_LIBRARY_VERSION } from "./lib/seoulAnalogPeakLibrary.js";
import {
  ANALOG_PEAK_CHECKPOINTS, ANALOG_PEAK_MODEL_VERSION, buildAnalogPeak, checkpointFeatures, daySummary, parseRoutineMetar,
  scoreAnalogPeak, seasonalPeak,
} from "./lib/seoulAnalogPeakModel.js";

const DAY = 86_400_000, KST_OFFSET = 9 * 3_600_000;
const checkpointArg = v.union(v.literal("09:00"), v.literal("12:00"));
const kstDate = (time) => new Date(time + KST_OFFSET).toISOString().slice(0, 10);
const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
function assertDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("Date must be a valid YYYY-MM-DD date");
  }
}

// Stored routine METARs for a KST date, parsed from their raw text exactly as
// the library was built, keyed by half-hour slot. SPECIs are not used.
async function routineReports(ctx, date, untilSlot = 47) {
  const rows = await ctx.db.query("seoulMetarObservations")
    .withIndex("by_station_date_ts", (q) => q.eq("stationIcao", "RKSI").eq("date", date)).collect();
  const reports = new Map();
  for (const row of rows) {
    const local = new Date(row.obsTimeUtc + KST_OFFSET);
    if (row.reportType !== "METAR" || local.getUTCMinutes() % 30 || local.getUTCSeconds()) continue;
    const slot = local.getUTCHours() * 2 + local.getUTCMinutes() / 30;
    const parsed = slot <= untilSlot ? parseRoutineMetar(row.rawMetar) : null;
    if (parsed) reports.set(slot, { ...parsed, obsTimeUtc: row.obsTimeUtc, receivedAt: row._creationTime });
  }
  return reports;
}

async function issue(ctx, { date, checkpoint, now, final }) {
  const existing = await ctx.db.query("seoulAnalogPeakForecasts")
    .withIndex("by_station_date_checkpoint", (q) => q.eq("stationIcao", "RKSI").eq("date", date).eq("checkpoint", checkpoint)).unique();
  if (existing) return { status: "duplicate", forecastId: existing._id };
  const slot = ANALOG_PEAK_CHECKPOINTS[checkpoint];
  const reports = await routineReports(ctx, date, slot);
  const features = checkpointFeatures(reports, slot);
  const result = features ? buildAnalogPeak({ library: ANALOG_LIBRARY, date, checkpoint, features }) : null;
  if (!result && !final) return { status: "waiting" };
  const base = {
    stationIcao: "RKSI", date, checkpoint, issuedAt: now, modelVersion: ANALOG_PEAK_MODEL_VERSION, libraryVersion: ANALOG_LIBRARY_VERSION,
    inputReportTimesUtc: [...reports.values()].map((report) => report.obsTimeUtc).sort((a, b) => a - b),
  };
  if (!result) {
    const reason = features ? "Too few same-season library days." : "The checkpoint or 3-hour-earlier routine METAR is missing or incomplete.";
    return { status: "unavailable", forecastId: await ctx.db.insert("seoulAnalogPeakForecasts", { ...base, status: "unavailable", reason }) };
  }
  const forecastId = await ctx.db.insert("seoulAnalogPeakForecasts", {
    ...base, status: "ready", checkpointReceivedAt: reports.get(slot).receivedAt, features,
    poolCount: result.poolCount, analog: result.analog, season: result.season, analogs: result.analogs,
  });
  return { status: "ready", forecastId };
}

// Runs every five minutes through the 09:00 and 12:00 KST hours. The routine
// METAR usually arrives about five minutes after the hour; the final attempt
// records an explicit unavailable forecast instead of silently skipping.
export const issueScheduledCheckpoint = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now(), local = new Date(now + KST_OFFSET);
    const checkpoint = Object.keys(ANALOG_PEAK_CHECKPOINTS).find((name) => Number(name.slice(0, 2)) === local.getUTCHours());
    if (!checkpoint) return { status: "outside_window" };
    return await issue(ctx, { date: kstDate(now), checkpoint, now, final: local.getUTCMinutes() >= 55 });
  },
});

// Dry run for inspection: computes a checkpoint forecast from stored reports
// without saving it, so a past date never enters the forward record.
export const previewCheckpoint = internalQueryGeneric({
  args: { date: v.string(), checkpoint: checkpointArg },
  handler: async (ctx, args) => {
    assertDate(args.date);
    const slot = ANALOG_PEAK_CHECKPOINTS[args.checkpoint];
    const reports = await routineReports(ctx, args.date, slot);
    const features = checkpointFeatures(reports, slot);
    return { date: args.date, checkpoint: args.checkpoint, reportCount: reports.size, features,
      result: features ? buildAnalogPeak({ library: ANALOG_LIBRARY, date: args.date, checkpoint: args.checkpoint, features }) : null };
  },
});

// Runs after KST midnight. Forecasts from the past week without an outcome are
// scored against that day's full routine record, or marked missing when the
// day has too few reports to establish its maximum.
export const scoreCompletedDays = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now(), today = kstDate(now);
    const forecasts = await ctx.db.query("seoulAnalogPeakForecasts")
      .withIndex("by_station_status_date", (q) => q.eq("stationIcao", "RKSI").eq("status", "ready")
        .gte("date", shiftDate(today, -7)).lt("date", today)).collect();
    let scored = 0, missing = 0;
    for (const forecast of forecasts) {
      const existing = await ctx.db.query("seoulAnalogPeakOutcomes").withIndex("by_forecast", (q) => q.eq("forecastId", forecast._id)).first();
      if (existing) continue;
      const reports = await routineReports(ctx, forecast.date);
      const summary = daySummary(reports);
      const base = { forecastId: forecast._id, stationIcao: "RKSI", date: forecast.date, checkpoint: forecast.checkpoint, scoredAt: now, reportCount: reports.size };
      if (!summary) {
        await ctx.db.insert("seoulAnalogPeakOutcomes", { ...base, status: "missing" });
        missing += 1;
        continue;
      }
      const score = scoreAnalogPeak(forecast, summary);
      await ctx.db.insert("seoulAnalogPeakOutcomes", {
        ...base, status: "scored", actualMaxC: summary.maxC, actualPeakFirstMinutes: summary.peakFirstSlot * 30,
        actualPeakLastMinutes: summary.peakLastSlot * 30, peakAhead: score.peakAhead, analog: score.analog, season: score.season,
      });
      scored += 1;
    }
    return { scored, missing };
  },
});

function performance(outcomes) {
  return Object.fromEntries(Object.keys(ANALOG_PEAK_CHECKPOINTS).map((checkpoint) => {
    const rows = outcomes.filter((row) => row.checkpoint === checkpoint && row.status === "scored");
    const mean = (pick) => (rows.length ? rows.reduce((sum, row) => sum + pick(row), 0) / rows.length : null);
    const summary = (key) => ({
      peakMaeMinutes: mean((row) => row[key].peakErrorMinutes),
      intervalCoverage: mean((row) => (row[key].covered ? 1 : 0)),
      brierPeakAhead: mean((row) => row[key].brierPeakAhead),
      maxExactShare: mean((row) => (row[key].maxErrorC === 0 ? 1 : 0)),
    });
    return [checkpoint, { scoredDays: rows.length, missingDays: outcomes.filter((row) => row.checkpoint === checkpoint && row.status === "missing").length,
      analog: summary("analog"), season: summary("season") }];
  }));
}

export const getDashboard = queryGeneric({
  args: { stationIcao: v.literal("RKSI"), date: v.string() },
  handler: async (ctx, args) => {
    assertDate(args.date);
    const forecasts = await ctx.db.query("seoulAnalogPeakForecasts")
      .withIndex("by_station_date_checkpoint", (q) => q.eq("stationIcao", "RKSI").eq("date", args.date)).take(4);
    const withOutcomes = await Promise.all(forecasts.map(async ({ _id, _creationTime, inputReportTimesUtc, ...forecast }) => ({
      id: _id, ...forecast, outcome: await ctx.db.query("seoulAnalogPeakOutcomes").withIndex("by_forecast", (q) => q.eq("forecastId", _id)).first(),
    })));
    const performanceStartDate = shiftDate(args.date, -29);
    const outcomes = await ctx.db.query("seoulAnalogPeakOutcomes")
      .withIndex("by_station_date", (q) => q.eq("stationIcao", "RKSI").gte("date", performanceStartDate).lte("date", args.date)).take(120);
    return {
      stationIcao: "RKSI", date: args.date, season: seasonalPeak(ANALOG_LIBRARY, args.date),
      forecasts: withOutcomes.sort((a, b) => a.checkpoint.localeCompare(b.checkpoint)),
      performance: performance(outcomes), performanceStartDate, performanceEndDate: args.date,
      modelVersion: ANALOG_PEAK_MODEL_VERSION, libraryVersion: ANALOG_LIBRARY_VERSION, librarySource: ANALOG_LIBRARY_SOURCE,
    };
  },
});
