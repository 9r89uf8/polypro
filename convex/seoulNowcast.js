import { internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { buildNowcast, NOWCAST_MODEL_VERSION, NOWCAST_HORIZONS_MINUTES } from "./lib/seoulNowcastModel.js";
import { NOWCAST_TIME_OF_DAY_WINDOWS } from "./lib/seoulNowcastSchema.js";

const MINUTE = 60_000, DAY = 86400_000;
export const NOWCAST_SCORING_VERSION = "first-valid-captured-15l-v1";
export const NOWCAST_TARGET_WAIT_MS = 30 * MINUTE;
const SOURCE_LIMIT = 600;
const SOURCE_FIELDS = [
  "stationIcao", "rwyNo", "rwyDir", "collectionCadence", "obsTimeUtc", "obsTimeLocal",
  "source", "rwyUse", "rwyMain", "tempC", "dewpointC", "qnhHpa", "windDirAvg",
  "windDirMin", "windDirMax", "windSpeedAvg", "windSpeedMin", "windSpeedMax",
  "crosswind", "headtail", "morMeters", "rvrMeters", "precipMm",
];
const dateKey = (time) => new Date(time + 9 * 3600_000).toISOString().slice(0, 10);
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}
const validTemperature = (value) => Number.isFinite(value) && value >= -80 && value <= 60;

// Called within the existing ingestion transaction. Existing mutable AMOS rows
// are not used for retrospective issuance: only versions captured from now on.
export async function captureObservation(ctx, row, receivedAt, sourceFirstSeenAt) {
  if (row.stationIcao !== "RKSI" || row.collectionCadence !== "one_minute" ||
      !((row.rwyNo === "2" && row.rwyDir === "15L") || (row.rwyNo === "3" && row.rwyDir === "16L")) ||
      !Number.isFinite(row.obsTimeUtc) || row.obsTimeUtc % MINUTE !== 0 ||
      !Number.isFinite(receivedAt) || row.obsTimeUtc > receivedAt) {
    return { versionId: null, changed: false, newMinute: false };
  }
  const previous = await ctx.db.query("seoulNowcastObservationVersions")
    .withIndex("by_station_site_time", (q) => q.eq("stationIcao", "RKSI").eq("rwyDir", row.rwyDir).eq("obsTimeUtc", row.obsTimeUtc))
    .order("desc").first();
  const payload = Object.fromEntries(SOURCE_FIELDS.filter((field) => row[field] !== undefined)
    .map((field) => [field, row[field]]));
  if (previous && SOURCE_FIELDS.every((field) => Object.is(previous[field], payload[field]))) {
    return { versionId: previous._id, changed: false, newMinute: false };
  }
  const versionId = await ctx.db.insert("seoulNowcastObservationVersions", {
    ...payload, receivedAt, temperatureValid: validTemperature(payload.tempC),
    ...(Number.isFinite(sourceFirstSeenAt) ? { sourceFirstSeenAt } : {}),
  });
  return { versionId, changed: true, newMinute: !previous };
}

function timeOfDayKey(issuedAt) {
  const hour = new Date(issuedAt + 9 * 3600_000).getUTCHours();
  return NOWCAST_TIME_OF_DAY_WINDOWS.find((window) => hour >= window.startHourKst && hour < window.endHourKst).key;
}

// Adds one scored outcome's errors to a score record. Drift sums may be absent
// on records written before the drift test existed and then start from zero.
function addScore(current, persistenceErrorC, dampedErrorC, driftErrorC) {
  const paired = dampedErrorC !== null, drift = driftErrorC !== null;
  return {
    scoredCount: current.scoredCount + 1,
    pairedCount: current.pairedCount + (paired ? 1 : 0),
    persistenceAbsErrorSum: current.persistenceAbsErrorSum + Math.abs(persistenceErrorC),
    pairedPersistenceAbsErrorSum: current.pairedPersistenceAbsErrorSum + (paired ? Math.abs(persistenceErrorC) : 0),
    dampedAbsErrorSum: current.dampedAbsErrorSum + (paired ? Math.abs(dampedErrorC) : 0),
    persistenceErrorSum: current.persistenceErrorSum + persistenceErrorC,
    dampedErrorSum: current.dampedErrorSum + (paired ? dampedErrorC : 0),
    driftPairedCount: (current.driftPairedCount ?? 0) + (drift ? 1 : 0),
    driftPairedPersistenceAbsErrorSum: (current.driftPairedPersistenceAbsErrorSum ?? 0) + (drift ? Math.abs(persistenceErrorC) : 0),
    driftAbsErrorSum: (current.driftAbsErrorSum ?? 0) + (drift ? Math.abs(driftErrorC) : 0),
    driftErrorSum: (current.driftErrorSum ?? 0) + (drift ? driftErrorC : 0),
  };
}

function addTimeOfDayScore(timeOfDay, key, persistenceErrorC, dampedErrorC, driftErrorC) {
  const current = timeOfDay[key] ?? { scoredCount: 0, pairedCount: 0, persistenceAbsErrorSum: 0,
    pairedPersistenceAbsErrorSum: 0, dampedAbsErrorSum: 0, persistenceErrorSum: 0, dampedErrorSum: 0 };
  return { ...timeOfDay, [key]: addScore(current, persistenceErrorC, dampedErrorC, driftErrorC) };
}

async function dailyScore(ctx, record) {
  return ctx.db.query("seoulNowcastDailyScores")
    .withIndex("by_station_model_date_horizon", (q) => q.eq("stationIcao", "RKSI")
      .eq("modelVersion", record.modelVersion).eq("date", record.date).eq("horizonMinutes", record.horizonMinutes))
    .unique();
}

async function recordIssuance(ctx, record) {
  const previous = await dailyScore(ctx, record);
  if (previous) {
    await ctx.db.patch(previous._id, { issuedCount: previous.issuedCount + 1 });
  } else {
    await ctx.db.insert("seoulNowcastDailyScores", {
      stationIcao: "RKSI", modelVersion: record.modelVersion, date: record.date,
      horizonMinutes: record.horizonMinutes, dayStartUtc: Date.parse(`${record.date}T00:00:00+09:00`),
      issuedCount: 1, scoredCount: 0, missingCount: 0, pairedCount: 0,
      persistenceAbsErrorSum: 0, pairedPersistenceAbsErrorSum: 0, dampedAbsErrorSum: 0,
      persistenceErrorSum: 0, dampedErrorSum: 0, driftPairedCount: 0, driftPairedPersistenceAbsErrorSum: 0,
      driftAbsErrorSum: 0, driftErrorSum: 0, timeOfDay: {},
    });
  }
}

export const issueForObservation = internalMutationGeneric({
  args: { stationIcao: v.literal("RKSI"), obsTimeUtc: v.number() },
  handler: async (ctx, args) => {
    const issuedAt = Date.now();
    const duplicate = await ctx.db.query("seoulNowcastForecasts")
      .withIndex("by_trigger_model", (q) => q.eq("stationIcao", "RKSI")
        .eq("triggerObsTimeUtc", args.obsTimeUtc).eq("modelVersion", NOWCAST_MODEL_VERSION)).unique();
    if (duplicate) return { status: "duplicate", forecastId: duplicate._id };
    const siteVersions = await Promise.all(["15L", "16L"].map((site) =>
      ctx.db.query("seoulNowcastObservationVersions")
        .withIndex("by_station_site_time", (q) => q.eq("stationIcao", "RKSI").eq("rwyDir", site)
          .gte("obsTimeUtc", issuedAt - 61 * MINUTE).lte("obsTimeUtc", issuedAt))
        .order("desc").take(SOURCE_LIMIT)));
    // A queued worker never pretends that it ran at the original ingest time.
    // Superseded jobs cannot publish duplicate forecasts for the newest minute.
    const newest15L = siteVersions[0][0];
    if (!newest15L || newest15L.obsTimeUtc !== args.obsTimeUtc) return { status: "superseded" };
    const result = buildNowcast({ versions: siteVersions.flat(), issuedAt, triggerObsTimeUtc: args.obsTimeUtc });
    if (siteVersions.some((rows) => rows.length === SOURCE_LIMIT)) {
      result.qualityStatus = "unavailable";
      result.reasonCode = "input_limit_exceeded";
      result.reason = "Too many source revisions to build a complete input window.";
      result.predictions = [];
    }
    const date = dateKey(issuedAt);
    // Source IDs already preserve the complete immutable input window. Avoid
    // duplicating 120 historical payloads in every minute's forecast record.
    const { primaryHistory, secondaryHistory, ...features } = result.features;
    const forecastId = await ctx.db.insert("seoulNowcastForecasts", {
      ...result, features, stationIcao: "RKSI", date, triggerObsTimeUtc: args.obsTimeUtc,
    });
    for (const prediction of result.predictions) {
      const record = {
        forecastId, stationIcao: "RKSI", date, modelVersion: result.modelVersion, issuedAt,
        horizonMinutes: prediction.horizonMinutes, targetTimeUtc: prediction.targetTimeUtc,
        persistenceC: prediction.persistenceC, dampedTrendC: prediction.dampedTrendC,
        ...(Number.isFinite(prediction.climatologyDriftC)
          ? { climatologyDriftC: prediction.climatologyDriftC, driftModelVersion: result.driftModelVersion } : {}),
        status: "pending", scoringVersion: NOWCAST_SCORING_VERSION,
      };
      await ctx.db.insert("seoulNowcastOutcomes", record);
      await recordIssuance(ctx, record);
    }
    return { status: result.qualityStatus, forecastId };
  },
});

export const scorePending = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db.query("seoulNowcastOutcomes")
      .withIndex("by_station_status_target", (q) => q.eq("stationIcao", "RKSI")
        .eq("status", "pending").lte("targetTimeUtc", now)).order("asc").take(100);
    let scored = 0, missing = 0;
    for (const outcome of pending) {
      const deadline = outcome.targetTimeUtc + NOWCAST_TARGET_WAIT_MS;
      // Immutable first valid captured target; later upstream corrections stay
      // in the source ledger but never rewrite an already scored result.
      const target = await ctx.db.query("seoulNowcastObservationVersions")
        .withIndex("by_target_valid", (q) => q.eq("stationIcao", "RKSI").eq("rwyDir", "15L")
          .eq("obsTimeUtc", outcome.targetTimeUtc).eq("temperatureValid", true)
          .gte("receivedAt", outcome.issuedAt).lte("receivedAt", Math.min(now, deadline)))
        .order("asc").first();
      if (!target && now < deadline) continue;
      const stats = await dailyScore(ctx, outcome);
      if (!stats) throw new Error("Missing nowcast daily score record");
      if (target) {
        const persistenceErrorC = outcome.persistenceC - target.tempC;
        const paired = Number.isFinite(outcome.dampedTrendC);
        const dampedErrorC = paired ? outcome.dampedTrendC - target.tempC : null;
        const driftErrorC = Number.isFinite(outcome.climatologyDriftC) ? outcome.climatologyDriftC - target.tempC : null;
        await ctx.db.patch(outcome._id, {
          status: "scored", actualC: target.tempC, observationVersionId: target._id,
          targetReceivedAt: target.receivedAt, scoredAt: now, persistenceErrorC,
          ...(paired ? { dampedErrorC } : {}),
          ...(driftErrorC !== null ? { driftErrorC } : {}),
        });
        await ctx.db.patch(stats._id, {
          ...addScore(stats, persistenceErrorC, dampedErrorC, driftErrorC),
          // Rows written before the breakdown stay without it; the backfill
          // recomputes them from outcomes rather than holding a partial sum.
          ...(stats.timeOfDay ? { timeOfDay: addTimeOfDayScore(stats.timeOfDay,
            timeOfDayKey(outcome.issuedAt), persistenceErrorC, dampedErrorC, driftErrorC) } : {}),
        });
        scored++;
      } else {
        await ctx.db.patch(outcome._id, { status: "missing", scoredAt: now });
        await ctx.db.patch(stats._id, { missingCount: stats.missingCount + 1 });
        missing++;
      }
    }
    // Drain a backlog without spinning on targets that are still awaiting data.
    if (pending.length === 100 && scored + missing > 0) {
      await ctx.scheduler.runAfter(1000, internal.seoulNowcast.scorePending, {});
    }
    return { scored, missing, pendingChecked: pending.length };
  },
});

// One-time catch-up for daily rows written before time-of-day sums existed.
// Each row is recomputed from its retained scored outcomes in one transaction,
// so a concurrent score is either already included or added afterwards. Rows
// whose outcomes may have expired, or whose recomputed counts disagree with the
// daily totals, stay excluded rather than partially summed.
export const backfillTimeOfDayScores = internalMutationGeneric({
  args: { afterDayStartUtc: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const oldest = Date.now() - 29 * DAY;
    const legacy = (await ctx.db.query("seoulNowcastDailyScores")
      .withIndex("by_day", (q) => q.gt("dayStartUtc", Math.max(oldest, args.afterDayStartUtc ?? oldest))).collect())
      .filter((row) => row.stationIcao === "RKSI" && !row.timeOfDay);
    if (!legacy.length) return { backfilledRows: 0, mismatchedRows: 0, more: false };
    const { date, dayStartUtc } = legacy[0];
    const outcomes = await ctx.db.query("seoulNowcastOutcomes")
      .withIndex("by_station_date_status_target", (q) => q.eq("stationIcao", "RKSI").eq("date", date).eq("status", "scored"))
      .collect();
    let backfilledRows = 0, mismatchedRows = 0;
    for (const row of legacy.filter((item) => item.date === date)) {
      let timeOfDay = {};
      for (const outcome of outcomes) {
        if (outcome.modelVersion !== row.modelVersion || outcome.horizonMinutes !== row.horizonMinutes
          || !Number.isFinite(outcome.persistenceErrorC)) continue;
        timeOfDay = addTimeOfDayScore(timeOfDay, timeOfDayKey(outcome.issuedAt), outcome.persistenceErrorC,
          Number.isFinite(outcome.dampedErrorC) ? outcome.dampedErrorC : null,
          Number.isFinite(outcome.driftErrorC) ? outcome.driftErrorC : null);
      }
      const total = (key) => Object.values(timeOfDay).reduce((sum, part) => sum + part[key], 0);
      if (total("scoredCount") !== row.scoredCount || total("pairedCount") !== row.pairedCount
        || total("driftPairedCount") !== (row.driftPairedCount ?? 0)) {
        mismatchedRows++;
        continue;
      }
      await ctx.db.patch(row._id, { timeOfDay });
      backfilledRows++;
    }
    const more = legacy.some((row) => row.dayStartUtc > dayStartUtc);
    if (more) await ctx.scheduler.runAfter(0, internal.seoulNowcast.backfillTimeOfDayScores, { afterDayStartUtc: dayStartUtc });
    return { date, backfilledRows, mismatchedRows, more };
  },
});

export const pruneExpired = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now(), limit = 128;
    const groups = [
      ["seoulNowcastForecasts", "by_issued", "issuedAt", now - 30 * DAY],
      ["seoulNowcastOutcomes", "by_issued", "issuedAt", now - 30 * DAY],
      ["seoulNowcastObservationVersions", "by_received", "receivedAt", now - 32 * DAY],
      ["seoulNowcastDailyScores", "by_day", "dayStartUtc", now - 365 * DAY],
    ];
    let deleted = 0, more = false;
    for (const [table, index, field, cutoff] of groups) {
      const rows = await ctx.db.query(table).withIndex(index, (q) => q.lt(field, cutoff)).take(limit);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted += rows.length;
      more ||= rows.length === limit;
    }
    if (more) await ctx.scheduler.runAfter(1000, internal.seoulNowcast.pruneExpired, {});
    return { deleted, more };
  },
});

// Drift sums are absent on records written before the drift test; they count
// as zero because no earlier drift forecasts exist.
function driftMetrics(records) {
  const sum = (key) => records.reduce((total, record) => total + (record[key] ?? 0), 0);
  const driftPairedCount = sum("driftPairedCount");
  return {
    driftPairedCount, driftDayCount: records.filter((record) => (record.driftPairedCount ?? 0) > 0).length,
    driftPairedPersistenceMaeC: driftPairedCount ? sum("driftPairedPersistenceAbsErrorSum") / driftPairedCount : null,
    driftMaeC: driftPairedCount ? sum("driftAbsErrorSum") / driftPairedCount : null,
    driftBiasC: driftPairedCount ? sum("driftErrorSum") / driftPairedCount : null,
  };
}

async function publicForecast(ctx, forecast) {
  const outcomes = await ctx.db.query("seoulNowcastOutcomes")
    .withIndex("by_forecast", (q) => q.eq("forecastId", forecast._id)).take(3);
  return {
    id: forecast._id, issuedAt: forecast.issuedAt, date: forecast.date, modelVersion: forecast.modelVersion,
    driftModelVersion: forecast.driftModelVersion ?? null,
    qualityStatus: forecast.qualityStatus, qualityReason: forecast.reason,
    intervalStatus: forecast.intervalStatus, latestObservationTimeUtc: forecast.latestObservationTimeUtc,
    latestObservationReceivedAt: forecast.latestObservationReceivedAt,
    predictions: forecast.predictions.map((prediction) => {
      const outcome = outcomes.find((row) => row.horizonMinutes === prediction.horizonMinutes);
      return { ...prediction, status: outcome?.status ?? "pending",
        ...(outcome?.status === "scored" ? { actualC: outcome.actualC, scoredAt: outcome.scoredAt,
          targetReceivedAt: outcome.targetReceivedAt } : {}) };
    }),
  };
}

export const getDashboard = queryGeneric({
  args: { stationIcao: v.literal("RKSI"), date: v.string() },
  handler: async (ctx, args) => {
    if (!validDate(args.date)) throw new Error("Date must be a valid YYYY-MM-DD date");
    const metricsStartDate = new Date(Date.parse(`${args.date}T12:00:00Z`) - 29 * DAY).toISOString().slice(0, 10);
    const forecasts = await ctx.db.query("seoulNowcastForecasts")
      .withIndex("by_station_date_issued", (q) => q.eq("stationIcao", "RKSI").eq("date", args.date))
      .order("desc").take(12);
    const scores = await ctx.db.query("seoulNowcastDailyScores")
      .withIndex("by_station_model_date_horizon", (q) => q.eq("stationIcao", "RKSI").eq("modelVersion", NOWCAST_MODEL_VERSION)
        .gte("date", metricsStartDate).lte("date", args.date)).take(90);
    const metrics = NOWCAST_HORIZONS_MINUTES.map((horizonMinutes) => {
      const days = scores.filter((row) => row.horizonMinutes === horizonMinutes);
      const sum = (key) => days.reduce((total, row) => total + row[key], 0);
      const scoredCount = sum("scoredCount"), pairedCount = sum("pairedCount");
      return {
        horizonMinutes, scoredCount, pairedCount, dayCount: days.filter((row) => row.pairedCount > 0).length,
        scoredDayCount: days.filter((row) => row.scoredCount > 0).length,
        missingCount: sum("missingCount"), pendingCount: sum("issuedCount") - scoredCount - sum("missingCount"),
        persistenceMaeC: scoredCount ? sum("persistenceAbsErrorSum") / scoredCount : null,
        pairedPersistenceMaeC: pairedCount ? sum("pairedPersistenceAbsErrorSum") / pairedCount : null,
        dampedMaeC: pairedCount ? sum("dampedAbsErrorSum") / pairedCount : null,
        persistenceBiasC: scoredCount ? sum("persistenceErrorSum") / scoredCount : null,
        dampedBiasC: pairedCount ? sum("dampedErrorSum") / pairedCount : null,
        ...driftMetrics(days),
      };
    });
    // Days whose rows predate the breakdown are counted as excluded, never
    // summed partially. Windows use each forecast's KST issue time.
    const timeOfDayMetrics = NOWCAST_TIME_OF_DAY_WINDOWS.flatMap((window) => NOWCAST_HORIZONS_MINUTES.map((horizonMinutes) => {
      const parts = scores.filter((row) => row.horizonMinutes === horizonMinutes && row.timeOfDay?.[window.key])
        .map((row) => row.timeOfDay[window.key]);
      const sum = (key) => parts.reduce((total, part) => total + part[key], 0);
      const scoredCount = sum("scoredCount"), pairedCount = sum("pairedCount");
      return {
        window: window.key, startHourKst: window.startHourKst, endHourKst: window.endHourKst, horizonMinutes,
        scoredCount, pairedCount, dayCount: parts.filter((part) => part.pairedCount > 0).length,
        persistenceMaeC: scoredCount ? sum("persistenceAbsErrorSum") / scoredCount : null,
        pairedPersistenceMaeC: pairedCount ? sum("pairedPersistenceAbsErrorSum") / pairedCount : null,
        dampedMaeC: pairedCount ? sum("dampedAbsErrorSum") / pairedCount : null,
        dampedBiasC: pairedCount ? sum("dampedErrorSum") / pairedCount : null,
        ...driftMetrics(parts),
      };
    }));
    const timeOfDayExcludedDayCount = new Set(scores.filter((row) => !row.timeOfDay).map((row) => row.date)).size;
    const recent = await Promise.all(forecasts.map((forecast) => publicForecast(ctx, forecast)));
    // Fresh issues have not reached their targets yet. A separate bounded read
    // keeps actual completed checks visible during continuous minute issuance.
    const resolved = await ctx.db.query("seoulNowcastOutcomes")
      .withIndex("by_station_date_status_target", (q) => q.eq("stationIcao", "RKSI")
        .eq("date", args.date).eq("status", "scored")).order("desc").take(12);
    const resolvedIds = [...new Set(resolved.map((row) => row.forecastId))].slice(0, 4);
    const resolvedForecasts = (await Promise.all(resolvedIds.map((id) => ctx.db.get(id))))
      .filter((row) => row && row.stationIcao === "RKSI" && row.date === args.date);
    const recentResolved = await Promise.all(resolvedForecasts.map((row) => publicForecast(ctx, row)));
    return { stationIcao: "RKSI", date: args.date, latest: recent[0] ?? null, recent, recentResolved, metrics,
      timeOfDayMetrics, timeOfDayExcludedDayCount,
      metricsStartDate, metricsEndDate: args.date, metricsWindowDays: 30,
      modelVersion: NOWCAST_MODEL_VERSION, scoringVersion: NOWCAST_SCORING_VERSION };
  },
});
