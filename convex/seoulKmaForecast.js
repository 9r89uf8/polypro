import { internalMutationGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";

const KMA_AMO_APPROVAL_FLAG =
  "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED";
const APPROVAL_REQUIRED_MESSAGE =
  "KMA/AMO airport forecast access approval is required before RKSI collection can run.";
const KMA_SOURCE = "kma_amo_airport";
const COLLECTION_LOCK_TIMEOUT_MS = 15 * 60 * 1_000;
const MIN_COLLECTION_INTERVAL_MS = 10 * 60 * 1_000;

const SEOUL_STATION = {
  stationIcao: "RKSI",
};

function hasApprovedKmaAmoAccess() {
  return process.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED === "true";
}

function assertApprovedKmaAmoAccess() {
  if (!hasApprovedKmaAmoAccess()) {
    throw new Error(APPROVAL_REQUIRED_MESSAGE);
  }
}

function normalizeStationIcao(value) {
  const stationIcao = String(value ?? SEOUL_STATION.stationIcao)
    .trim()
    .toUpperCase();
  if (stationIcao !== SEOUL_STATION.stationIcao) {
    throw new Error("The KMA/AMO airport forecast collector supports RKSI only.");
  }
  return stationIcao;
}

const captureStatusValidator = v.union(
  v.literal("ok"),
  v.literal("error"),
  v.literal("approval_required"),
);

const collectionTriggerValidator = v.union(
  v.literal("manual"),
  v.literal("scheduled"),
);

const dailyRowValidator = v.object({
  date: v.string(),
  forecastType: v.union(v.literal("short_term"), v.literal("midterm")),
  minTempC: v.optional(v.number()),
  minTempF: v.optional(v.number()),
  maxTempC: v.optional(v.number()),
  maxTempF: v.optional(v.number()),
  phrase: v.optional(v.string()),
});

const hourlyRowValidator = v.object({
  date: v.string(),
  forecastTimeUtc: v.number(),
  forecastTimeLocal: v.string(),
  tempC: v.number(),
  tempF: v.number(),
  phrase: v.optional(v.string()),
  conditionCode: v.optional(v.string()),
  ceilingFt: v.optional(v.number()),
  ceilingText: v.optional(v.string()),
  windDirectionDeg: v.optional(v.number()),
  windSpeedKt: v.optional(v.number()),
  windGustKt: v.optional(v.number()),
  windSpeedText: v.optional(v.string()),
  visibilityM: v.optional(v.number()),
  visibilityText: v.optional(v.string()),
  crosswindText: v.optional(v.string()),
});

export const storeForecastCapture = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    stationName: v.string(),
    source: v.literal(KMA_SOURCE),
    sourceUrl: v.string(),
    collectionTrigger: collectionTriggerValidator,
    capturedAt: v.number(),
    capturedAtLocal: v.string(),
    captureDate: v.string(),
    status: captureStatusValidator,
    approvalFlagName: v.literal(KMA_AMO_APPROVAL_FLAG),
    error: v.optional(v.string()),
    httpStatus: v.optional(v.number()),
    contentType: v.optional(v.string()),
    responseBytes: v.optional(v.number()),
    etag: v.optional(v.string()),
    lastModified: v.optional(v.string()),
    pageReportedAt: v.optional(v.number()),
    pageReportedAtLocal: v.optional(v.string()),
    dailyRows: v.array(dailyRowValidator),
    hourlyRows: v.array(hourlyRowValidator),
  },
  handler: async (ctx, args) => {
    // Successful protected data may enter storage only while approval remains
    // active. Error/approval-required attempts remain safe, immutable audit
    // rows and contain no protected forecast data.
    if (args.status === "ok") {
      assertApprovedKmaAmoAccess();
    }
    if (
      args.status !== "ok" &&
      (args.dailyRows.length > 0 || args.hourlyRows.length > 0)
    ) {
      throw new Error(
        "Non-successful KMA/AMO captures cannot store protected forecast rows.",
      );
    }
    const captureId = await ctx.db.insert("seoulKmaForecastCaptures", {
      ...args,
      createdAt: Date.now(),
    });
    return await ctx.db.get(captureId);
  },
});

async function queueAirportForecastCollection(
  ctx,
  { stationIcao, collectionTrigger },
) {
  const now = Date.now();
  if (!hasApprovedKmaAmoAccess()) {
    return {
      queued: false,
      status: "approval_required",
      stationIcao,
      approval: {
        approved: false,
        status: "approval_required",
        flagName: KMA_AMO_APPROVAL_FLAG,
      },
    };
  }

  const existing = await ctx.db
    .query("seoulKmaForecastCollectorStatus")
    .withIndex("by_station", (query) =>
      query.eq("stationIcao", stationIcao),
    )
    .first();
  if (
    Number.isFinite(existing?.collectionInFlightSince) &&
    now - existing.collectionInFlightSince < COLLECTION_LOCK_TIMEOUT_MS
  ) {
    return {
      queued: false,
      status: "already_running",
      stationIcao,
      collectionQueuedAt: existing.collectionQueuedAt,
      collectionInFlightSince: existing.collectionInFlightSince,
    };
  }
  if (
    Number.isFinite(existing?.collectionQueuedAt) &&
    now - existing.collectionQueuedAt < MIN_COLLECTION_INTERVAL_MS
  ) {
    return {
      queued: false,
      status: "cooldown",
      stationIcao,
      retryAfterSeconds: Math.ceil(
        (MIN_COLLECTION_INTERVAL_MS - (now - existing.collectionQueuedAt)) /
          1_000,
      ),
    };
  }

  const runId = `${collectionTrigger}:${now}`;
  const patch = {
    stationIcao,
    status: "queued",
    collectionQueuedAt: now,
    collectionInFlightSince: now,
    collectionMode: collectionTrigger,
    collectionRunId: runId,
    lastError: undefined,
    dailyRowCount: undefined,
    hourlyRowCount: undefined,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("seoulKmaForecastCollectorStatus", patch);
  }
  await ctx.scheduler.runAfter(
    0,
    internal.seoulKmaForecastNode.collectQueuedAirportForecast,
    {
      stationIcao,
      requestedAt: now,
      collectionTrigger,
      runId,
    },
  );
  return {
    queued: true,
    status: "queued",
    stationIcao,
    requestedAt: now,
    collectionTrigger,
    cooldownSeconds: MIN_COLLECTION_INTERVAL_MS / 1_000,
  };
}

// Browser clients can request a refresh only through this atomic, globally
// rate-limited queue. The upstream-fetching action remains internal.
export const requestAirportForecastRefresh = mutationGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await queueAirportForecastCollection(ctx, {
      stationIcao: normalizeStationIcao(args.stationIcao),
      collectionTrigger: "manual",
    }),
});

export const queueScheduledAirportForecastRefresh = internalMutationGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await queueAirportForecastCollection(ctx, {
      stationIcao: normalizeStationIcao(args.stationIcao),
      collectionTrigger: "scheduled",
    }),
});

export const claimQueuedAirportForecast = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const existing = await ctx.db
      .query("seoulKmaForecastCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .first();
    if (!existing || existing.collectionRunId !== args.runId) {
      return {
        claimed: false,
        status: "superseded",
        stationIcao,
      };
    }
    if (!hasApprovedKmaAmoAccess()) {
      return {
        claimed: false,
        status: "approval_required",
        stationIcao,
      };
    }
    const startedAt = Date.now();
    await ctx.db.patch(existing._id, {
      collectionInFlightSince: startedAt,
      updatedAt: startedAt,
    });
    return {
      claimed: true,
      status: "claimed",
      stationIcao,
      startedAt,
    };
  },
});

export const writeCollectorStatus = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    runId: v.string(),
    status: captureStatusValidator,
    completedAt: v.number(),
    lastError: v.optional(v.string()),
    dailyRowCount: v.optional(v.number()),
    hourlyRowCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("seoulKmaForecastCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", args.stationIcao),
      )
      .first();
    if (!existing || existing.collectionRunId !== args.runId) {
      return { updated: false, reason: "superseded" };
    }
    await ctx.db.patch(existing._id, {
      status: args.status,
      lastCompletedAt: args.completedAt,
      ...(args.status === "ok"
        ? {
            lastSuccessAt: args.completedAt,
            lastError: undefined,
            dailyRowCount: args.dailyRowCount,
            hourlyRowCount: args.hourlyRowCount,
          }
        : {
            lastError: args.lastError,
            dailyRowCount: undefined,
            hourlyRowCount: undefined,
          }),
      collectionInFlightSince: undefined,
      collectionMode: undefined,
      collectionRunId: undefined,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});
