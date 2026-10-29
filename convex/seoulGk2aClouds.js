import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  cloudCollectionWindowOpen,
  summarizeCloudTrend,
} from "./lib/seoulGk2aCloudMath.js";

const STATION = "RKSI";
const MINUTE = 60_000;
const COLLECTION_SLOT_MS = 2 * MINUTE;
const LOCK_TIMEOUT_MS = 5 * MINUTE;
const RETENTION_MS = 48 * 60 * MINUTE;
const HISTORY_MS = 45 * MINUTE;
const FRESHNESS_MS = 12 * MINUTE;
const MAX_STARTUP_FRAMES = 4;
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const cloudSampleValidator = v.object({
  obsTimeUtc: v.number(),
  acquisitionTimeUtc: v.number(),
  visibleObjectKey: v.string(),
  infraredObjectKey: v.string(),
  visibleLastModifiedUtc: v.number(),
  infraredLastModifiedUtc: v.number(),
  solarElevationDeg: v.number(),
  reflectance: v.number(),
  brightnessTempK: v.number(),
  validCellCount: v.number(),
  cells: v.array(v.object({
    id: v.number(),
    reflectance: v.number(),
    brightnessTempK: v.number(),
  })),
  methodVersion: v.string(),
  source: v.string(),
});

function enabled() {
  return process.env.NOAA_GK2A_CLOUD_ENABLED === "true";
}

function station(value) {
  const normalized = String(value ?? STATION).trim().toUpperCase();
  if (normalized !== STATION) throw new Error("GK2A cloud sampling supports RKSI only.");
  return normalized;
}

function seoulDate(time) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(new Date(time))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ").trim().slice(0, 500);
}

function validSample(sample, now) {
  const numbers = [
    sample.obsTimeUtc, sample.acquisitionTimeUtc,
    sample.visibleLastModifiedUtc, sample.infraredLastModifiedUtc,
    sample.solarElevationDeg, sample.reflectance, sample.brightnessTempK,
  ];
  return numbers.every(Number.isFinite) &&
    sample.source === "noaa_gk2a_l1b" && sample.methodVersion === "rksi-vis-ir-v1" &&
    sample.obsTimeUtc <= now && sample.obsTimeUtc >= now - HISTORY_MS &&
    sample.acquisitionTimeUtc >= sample.obsTimeUtc - MINUTE &&
    sample.acquisitionTimeUtc <= sample.obsTimeUtc + 2 * MINUTE &&
    sample.acquisitionTimeUtc <= now &&
    sample.solarElevationDeg >= 20 && sample.solarElevationDeg <= 90 &&
    sample.reflectance >= 0 && sample.reflectance <= 1.6 &&
    sample.brightnessTempK >= 150 && sample.brightnessTempK <= 330.1 &&
    sample.validCellCount === sample.cells.length &&
    sample.cells.length >= 20 && sample.cells.length <= 25 &&
    new Set(sample.cells.map((cell) => cell.id)).size === sample.cells.length &&
    sample.cells.every((cell) => Number.isInteger(cell.id) &&
      cell.id >= 0 && cell.id <= 24 &&
      Number.isFinite(cell.reflectance) && Number.isFinite(cell.brightnessTempK) &&
      cell.reflectance >= 0 && cell.reflectance <= 1.6 &&
      cell.brightnessTempK >= 150 && cell.brightnessTempK <= 330.1);
}

async function collectorState(ctx, stationIcao) {
  return await ctx.db.query("seoulGk2aCloudCollectorStatus")
    .withIndex("by_station", (q) => q.eq("stationIcao", stationIcao)).first();
}

async function ownsRun(ctx, stationIcao, runId) {
  const current = await collectorState(ctx, stationIcao);
  return current?.collectionRunId === runId ? current : null;
}

async function prune(ctx, stationIcao, now) {
  const rows = await ctx.db.query("seoulGk2aCloudObservations")
    .withIndex("by_station_obs_ts", (q) =>
      q.eq("stationIcao", stationIcao).lt("obsTimeUtc", now - RETENTION_MS))
    .take(256);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

export const queueScheduledCloudRefresh = internalMutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = station(args.stationIcao);
    if (!enabled()) return { queued: false, status: "disabled" };
    const now = Date.now();
    if (!cloudCollectionWindowOpen(now)) return { queued: false, status: "night" };
    const current = await collectorState(ctx, stationIcao);
    if (Number.isFinite(current?.collectionInFlightSince) &&
        now - current.collectionInFlightSince < LOCK_TIMEOUT_MS) {
      return { queued: false, status: "already_running" };
    }
    if (Number.isFinite(current?.collectionQueuedAt) &&
        Math.floor(current.collectionQueuedAt / COLLECTION_SLOT_MS) ===
          Math.floor(now / COLLECTION_SLOT_MS)) {
      return { queued: false, status: "cooldown" };
    }
    const runId = `${stationIcao}:${now}`;
    const patch = {
      stationIcao,
      status: current?.status ?? "building",
      collectionQueuedAt: now,
      collectionInFlightSince: now,
      collectionRunId: runId,
      lastAttemptAt: now,
      updatedAt: now,
    };
    if (current) await ctx.db.patch(current._id, patch);
    else await ctx.db.insert("seoulGk2aCloudCollectorStatus", patch);
    await ctx.scheduler.runAfter(0, internal.seoulGk2aClouds.collectCloudTrend, {
      stationIcao, requestedAt: now, runId,
    });
    return { queued: true, status: "queued" };
  },
});

export const getCollectionState = internalQueryGeneric({
  args: { stationIcao: v.string() },
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const stationIcao = station(args.stationIcao);
    const [collector, latest] = await Promise.all([
      collectorState(ctx, stationIcao),
      ctx.db.query("seoulGk2aCloudObservations")
        .withIndex("by_station_obs_ts", (q) => q.eq("stationIcao", stationIcao))
        .order("desc").first(),
    ]);
    return { collector, latestObsTimeUtc: latest?.obsTimeUtc ?? null };
  },
});

export const upsertCloudObservations = internalMutationGeneric({
  args: {
    stationIcao: v.string(), runId: v.string(),
    observations: v.array(cloudSampleValidator),
  },
  handler: async (ctx, args) => {
    if (!enabled()) return { status: "disabled", insertedCount: 0 };
    const stationIcao = station(args.stationIcao);
    if (!await ownsRun(ctx, stationIcao, args.runId)) {
      return { status: "superseded", insertedCount: 0 };
    }
    const now = Date.now();
    if (args.observations.length > MAX_STARTUP_FRAMES ||
        args.observations.some((sample) => !validSample(sample, now))) {
      throw new Error("GK2A cloud extraction returned invalid or out-of-window samples.");
    }
    let insertedCount = 0;
    for (const sample of args.observations) {
      const existing = await ctx.db.query("seoulGk2aCloudObservations")
        .withIndex("by_station_obs_ts", (q) =>
          q.eq("stationIcao", stationIcao).eq("obsTimeUtc", sample.obsTimeUtc))
        .first();
      if (existing) continue;
      await ctx.db.insert("seoulGk2aCloudObservations", {
        ...sample, stationIcao, date: seoulDate(sample.obsTimeUtc),
        firstSeenAt: now, updatedAt: now,
      });
      insertedCount += 1;
    }
    await prune(ctx, stationIcao, now);
    return { status: "ok", insertedCount };
  },
});

export const writeCollectorStatus = internalMutationGeneric({
  args: {
    stationIcao: v.string(), runId: v.string(), status: v.string(),
    lastAttemptAt: v.number(), lastSuccessAt: v.optional(v.number()),
    latestObsTimeUtc: v.optional(v.number()),
    lastProcessedTimeUtc: v.optional(v.number()),
    latestRejectedTimeUtc: v.optional(v.number()), lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!enabled()) return { status: "disabled", updated: false };
    const stationIcao = station(args.stationIcao);
    const current = await ownsRun(ctx, stationIcao, args.runId);
    if (!current) return { status: "superseded", updated: false };
    const { runId, ...fields } = args;
    for (const field of ["latestObsTimeUtc", "lastProcessedTimeUtc", "latestRejectedTimeUtc"]) {
      if (Number.isFinite(fields[field])) {
        fields[field] = Math.max(fields[field], current[field] ?? -Infinity);
      }
    }
    await ctx.db.patch(current._id, {
      ...fields, lastError: args.lastError,
      collectionInFlightSince: undefined, collectionRunId: undefined,
      updatedAt: Date.now(),
    });
    return { status: args.status, updated: true };
  },
});

export const collectCloudTrend = internalActionGeneric({
  args: { stationIcao: v.string(), requestedAt: v.number(), runId: v.string() },
  handler: async (ctx, args) => {
    if (!enabled()) return { status: "disabled" };
    const stationIcao = station(args.stationIcao);
    const lastAttemptAt = Date.now();
    const finish = (fields) => ctx.runMutation(
      internal.seoulGk2aClouds.writeCollectorStatus,
      { stationIcao, runId: args.runId, lastAttemptAt, ...fields },
    );
    try {
      const state = await ctx.runQuery(internal.seoulGk2aClouds.getCollectionState, {
        stationIcao,
      });
      if (!enabled() || !state) return { status: "disabled" };
      if (state.collector?.collectionRunId !== args.runId) {
        return { status: "superseded" };
      }
      if (!cloudCollectionWindowOpen(lastAttemptAt)) {
        await finish({ status: "night" });
        return { status: "night" };
      }
      const latestProcessedTime = Math.max(
        state.latestObsTimeUtc ?? -Infinity,
        state.collector.lastProcessedTimeUtc ?? -Infinity,
      );
      const result = await ctx.runAction(
        internal.seoulGk2aCloudsNode.fetchLatestCloudSample,
        { requestedAt: args.requestedAt,
          ...(Number.isFinite(latestProcessedTime) ? { latestProcessedTime } : {}) },
      );
      if (!enabled() || result.status === "disabled") return { status: "disabled" };
      const checkpoint = Number.isFinite(result.lastProcessedTimeUtc) &&
        result.lastProcessedTimeUtc <= Date.now()
        ? { lastProcessedTimeUtc: result.lastProcessedTimeUtc } : {};
      const latestRejectedTimeUtc = Math.max(
        state.collector.latestRejectedTimeUtc ?? -Infinity,
        Number.isFinite(result.latestRejectedTimeUtc) && result.latestRejectedTimeUtc <= Date.now()
          ? result.latestRejectedTimeUtc : -Infinity,
      );
      const rejectionCheckpoint = Number.isFinite(latestRejectedTimeUtc)
        ? { latestRejectedTimeUtc } : {};
      if (result.status !== "ok") {
        const hasUnusableNewerFrame = Math.max(
          latestProcessedTime, checkpoint.lastProcessedTimeUtc ?? -Infinity,
        ) > (state.latestObsTimeUtc ?? -Infinity) ||
          latestRejectedTimeUtc >= (state.latestObsTimeUtc ?? Infinity);
        const status = result.status === "not_modified" && state.latestObsTimeUtc &&
          !hasUnusableNewerFrame
          ? "ok" : "no_data";
        await finish({ status, ...checkpoint, ...rejectionCheckpoint,
          ...(result.message ? { lastError: errorMessage(result.message) } : {}) });
        return { status: result.status };
      }
      const observations = result.observations ?? [];
      if (!observations.length) throw new Error("GK2A cloud extraction returned no samples.");
      const write = await ctx.runMutation(internal.seoulGk2aClouds.upsertCloudObservations, {
        stationIcao, runId: args.runId, observations,
      });
      if (write.status !== "ok") return write;
      const latestObsTimeUtc = Math.max(
        state.latestObsTimeUtc ?? -Infinity,
        ...observations.map((sample) => sample.obsTimeUtc),
      );
      const lastProcessedTimeUtc = Math.max(
        latestProcessedTime, latestObsTimeUtc, checkpoint.lastProcessedTimeUtc ?? -Infinity,
      );
      const status = lastProcessedTimeUtc > latestObsTimeUtc ||
        latestRejectedTimeUtc >= latestObsTimeUtc ? "no_data" : "ok";
      await finish({ status, latestObsTimeUtc, lastProcessedTimeUtc, ...rejectionCheckpoint,
        lastSuccessAt: Date.now() });
      return { status, insertedCount: write.insertedCount };
    } catch (error) {
      if (!enabled()) return { status: "disabled" };
      await finish({ status: "error", lastError: errorMessage(error) });
      return { status: "error" };
    }
  },
});

// Deletion-only maintenance stays available while collection is disabled.
export const pruneExpiredCloudObservations = internalMutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => ({
    prunedCount: await prune(ctx, station(args.stationIcao), Date.now()),
  }),
});

export const getCloudTrendDashboard = queryGeneric({
  args: { stationIcao: v.optional(v.string()), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = station(args.stationIcao);
    const nowMs = Date.now();
    const today = seoulDate(nowMs);
    const date = args.date ?? today;
    const configured = enabled();
    const collectionWindowOpen = cloudCollectionWindowOpen(nowMs);
    const empty = { configured, stationIcao, date, today, collectionWindowOpen,
      latest: null, trend: summarizeCloudTrend([], { nowMs }) };
    if (!configured) return { ...empty, status: "disabled" };
    if (date !== today) return { ...empty, status: "no_data" };
    if (!collectionWindowOpen) return { ...empty, status: "night" };
    const [collector, stored] = await Promise.all([
      collectorState(ctx, stationIcao),
      ctx.db.query("seoulGk2aCloudObservations")
        .withIndex("by_station_obs_ts", (q) =>
          q.eq("stationIcao", stationIcao).lte("obsTimeUtc", nowMs))
        .order("desc").take(32),
    ]);
    const rows = stored.filter((row) => row.obsTimeUtc >= nowMs - RETENTION_MS)
      .sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
    const latest = rows.at(-1) ?? null;
    const rejectionBarrier = collector?.latestRejectedTimeUtc ?? -Infinity;
    const hasUnusableNewerFrame = (Number.isFinite(collector?.lastProcessedTimeUtc) &&
      collector.lastProcessedTimeUtc > (latest?.obsTimeUtc ?? -Infinity)) ||
      (Number.isFinite(rejectionBarrier) && rejectionBarrier >= (latest?.obsTimeUtc ?? -Infinity));
    const trend = hasUnusableNewerFrame ? empty.trend : summarizeCloudTrend(
      rows.filter((row) => row.obsTimeUtc >= nowMs - HISTORY_MS &&
        row.obsTimeUtc > rejectionBarrier), { nowMs },
    );
    const status = hasUnusableNewerFrame ? "no_data"
      : latest && nowMs - latest.obsTimeUtc > FRESHNESS_MS ? "stale"
      : collector?.status === "error" ? "error"
      : !latest ? (collector?.collectionInFlightSince ? "building" : "no_data")
      : trend.state === "unavailable" ? "building" : "ok";
    // Do not expose database identifiers; keep observation and receipt clocks distinct.
    const { _id, _creationTime, ...publicLatest } = latest ?? {};
    return { ...empty, status, latest: latest ? publicLatest : null, trend };
  },
});
