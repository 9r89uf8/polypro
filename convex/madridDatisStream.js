import {
  internalMutationGeneric,
  internalQueryGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
  AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
  evaluateAirframesDatisStreamAccess,
  evaluateAirframesDatisStreamConnection,
  evaluateAirframesDatisStreamRuntime,
} from "./madridDatisStreamAccess.js";
import {
  buildMadridDatisStreamGeneration,
  getMadridDatisStreamBackoffMs,
  isMadridDatisStreamHeartbeatStale,
  isMadridDatisStreamLeaseActive,
  MADRID_DATIS_STREAM_LEASE_MS,
  MADRID_DATIS_STREAM_STALE_MS,
} from "./madridDatisStreamLifecycle.js";

const SUPPORTED_STATION_ICAO = "LEMD";
const AIRFRAMES_ATTRIBUTION =
  "Data provided by Airframes.io and its community of feeders.";

const datisStreamRowValidator = v.object({
  stationIcao: v.string(),
  date: v.string(),
  reportTsUtc: v.number(),
  reportTimeLocal: v.string(),
  reportKind: v.union(v.literal("ARR"), v.literal("DEP")),
  designator: v.string(),
  tempC: v.number(),
  tempF: v.number(),
  dewPointC: v.number(),
  dewPointF: v.number(),
  receivedAtUtc: v.number(),
  receivedAtLocal: v.string(),
  deliveryLagMs: v.number(),
  source: v.literal("airframes_acars_datis_stream"),
  dedupeKey: v.string(),
});

function normalizeStationIcao(value) {
  const stationIcao = String(value ?? SUPPORTED_STATION_ICAO)
    .trim()
    .toUpperCase();
  if (stationIcao !== SUPPORTED_STATION_ICAO) {
    throw new Error("The Airframes D-ATIS stream supports LEMD only.");
  }
  return stationIcao;
}

function getStreamAccess() {
  return evaluateAirframesDatisStreamAccess(
    process.env.AIRFRAMES_LEMD_STREAM_APPROVED,
  );
}

function getStreamConnection() {
  return evaluateAirframesDatisStreamConnection(
    process.env.AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED,
  );
}

function getStreamRuntime() {
  return evaluateAirframesDatisStreamRuntime(
    process.env.AIRFRAMES_LEMD_STREAM_APPROVED,
    process.env.AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED,
  );
}

function isListenerStatusStale(status, nowMs) {
  if (!status || !isMadridDatisStreamLeaseActive(status, nowMs)) {
    return false;
  }
  if (isMadridDatisStreamHeartbeatStale(status, nowMs)) {
    return true;
  }
  return (
    (status.status === "queued" || status.status === "connecting") &&
    nowMs - status.updatedAt > MADRID_DATIS_STREAM_STALE_MS
  );
}

function selectCanonicalDatisRows(rows) {
  const byReportIdentity = new Map();
  for (const row of rows) {
    const existing = byReportIdentity.get(row.dedupeKey);
    if (
      !existing ||
      row.receivedAtUtc < existing.receivedAtUtc
    ) {
      byReportIdentity.set(row.dedupeKey, row);
    }
  }
  return [...byReportIdentity.values()].sort(
    (a, b) =>
      a.reportTsUtc - b.reportTsUtc ||
      a.receivedAtUtc - b.receivedAtUtc ||
      a.reportKind.localeCompare(b.reportKind) ||
      a.designator.localeCompare(b.designator),
  );
}

async function getStoredStatus(ctx, stationIcao) {
  return await ctx.db
    .query("madridDatisStreamStatus")
    .withIndex("by_station", (query) =>
      query.eq("stationIcao", stationIcao),
    )
    .first();
}

async function queueStreamListener(ctx, stationIcao, existing, now) {
  const runtime = getStreamRuntime();
  if (!runtime.ready) {
    return {
      status: runtime.status,
      queued: false,
      stationIcao,
      approvalFlagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
      connectionFlagName: AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
    };
  }
  const attemptCount = (existing?.attemptCount ?? 0) + 1;
  const generation = buildMadridDatisStreamGeneration(
    stationIcao,
    now,
    attemptCount,
  );
  const leaseUntil = now + MADRID_DATIS_STREAM_LEASE_MS;
  const patch = {
    stationIcao,
    status: "queued",
    configured: true,
    generation,
    leaseUntil,
    attemptCount,
    lastAttemptAt: now,
    sessionStartedAt: undefined,
    sessionEndedAt: undefined,
    sessionProviderEventCount: 0,
    sessionCandidateCount: 0,
    sessionParsedCount: 0,
    sessionStoredCount: 0,
    lastError: undefined,
    retryAfterAt: undefined,
    updatedAt: now,
  };
  let statusId = existing?._id;
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    statusId = await ctx.db.insert("madridDatisStreamStatus", {
      ...patch,
      consecutiveFailures: 0,
      totalProviderEventCount: 0,
      totalCandidateCount: 0,
      totalParsedCount: 0,
      totalStoredCount: 0,
    });
  }
  const scheduleRuntime = getStreamRuntime();
  if (!scheduleRuntime.ready) {
    await ctx.db.patch(statusId, {
      status: "queued",
      configured: false,
      generation: "",
      leaseUntil: 0,
      updatedAt: Date.now(),
    });
    return {
      status: scheduleRuntime.status,
      queued: false,
      stationIcao,
      approvalFlagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
      connectionFlagName: AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
    };
  }
  await ctx.scheduler.runAfter(
    0,
    internal.madridDatisStreamNode.listenAirframesDatisStream,
    {
      stationIcao,
      generation,
      leaseUntil,
    },
  );
  return {
    status: "queued",
    queued: true,
    stationIcao,
    generation,
    leaseUntil,
  };
}

export const superviseScheduledStream = internalMutationGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const runtime = getStreamRuntime();
    if (!runtime.ready) {
      return {
        status: runtime.status,
        queued: false,
        stationIcao,
        approvalFlagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
        connectionFlagName: AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
      };
    }

    const now = Date.now();
    const existing = await getStoredStatus(ctx, stationIcao);
    if (
      existing?.retryAfterAt &&
      existing.retryAfterAt > now &&
      !isListenerStatusStale(existing, now)
    ) {
      return {
        status: "backoff",
        queued: false,
        stationIcao,
        retryAfterAt: existing.retryAfterAt,
      };
    }
    if (
      isMadridDatisStreamLeaseActive(existing, now) &&
      !isListenerStatusStale(existing, now)
    ) {
      return {
        status: existing.status,
        queued: false,
        stationIcao,
        generation: existing.generation,
        leaseUntil: existing.leaseUntil,
      };
    }

    return await queueStreamListener(ctx, stationIcao, existing, now);
  },
});

export const getStreamApprovalState = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (_ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const access = getStreamAccess();
    const connection = getStreamConnection();
    return {
      stationIcao,
      approved: access.approved,
      connectionEnabled: connection.enabled,
      status: !access.approved ? access.status : connection.status,
      approvalStatus: access.status,
      connectionStatus: connection.status,
      approvalFlagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
      connectionFlagName: AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
      authentication: access.approved
        ? access.authentication
        : "disabled",
      checkedAt: Date.now(),
    };
  },
});

export const beginStreamListener = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const runtime = getStreamRuntime();
    if (!runtime.ready) {
      return { status: runtime.status };
    }
    const existing = await getStoredStatus(ctx, stationIcao);
    if (
      !existing ||
      existing.generation !== args.generation ||
      !isMadridDatisStreamLeaseActive(existing, args.startedAt)
    ) {
      return { status: "generation_stale" };
    }
    await ctx.db.patch(existing._id, {
      status: "connecting",
      sessionStartedAt: args.startedAt,
      lastHeartbeatAt: args.startedAt,
      updatedAt: Date.now(),
    });
    return {
      status: "connecting",
      leaseUntil: existing.leaseUntil,
    };
  },
});

export const recordStreamConnected = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    connectedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const runtime = getStreamRuntime();
    if (!runtime.ready) {
      return { status: runtime.status };
    }
    const existing = await getStoredStatus(ctx, stationIcao);
    if (
      existing?.generation !== args.generation ||
      existing.status !== "connecting" ||
      !isMadridDatisStreamLeaseActive(existing, args.connectedAt)
    ) {
      return { status: "generation_stale" };
    }
    await ctx.db.patch(existing._id, {
      status: "connecting",
      lastConnectedAt: args.connectedAt,
      lastHeartbeatAt: args.connectedAt,
      updatedAt: Date.now(),
    });
    return { status: "connecting" };
  },
});

export const recordStreamListening = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    subscribedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const runtime = getStreamRuntime();
    if (!runtime.ready) {
      return { status: runtime.status };
    }
    const existing = await getStoredStatus(ctx, stationIcao);
    if (
      existing?.generation !== args.generation ||
      existing.status !== "connecting" ||
      !isMadridDatisStreamLeaseActive(existing, args.subscribedAt)
    ) {
      return { status: "generation_stale" };
    }
    await ctx.db.patch(existing._id, {
      status: "listening",
      lastSubscribedAt: args.subscribedAt,
      lastHeartbeatAt: args.subscribedAt,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { status: "listening" };
  },
});

export const recordStreamHeartbeat = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    heartbeatAt: v.number(),
    providerEventCount: v.number(),
    candidateCount: v.number(),
    parsedCount: v.number(),
    storedCount: v.number(),
    lastProviderEventAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const runtime = getStreamRuntime();
    if (!runtime.ready) {
      return { status: runtime.status };
    }
    const existing = await getStoredStatus(ctx, stationIcao);
    if (
      existing?.generation !== args.generation ||
      !isMadridDatisStreamLeaseActive(existing, args.heartbeatAt)
    ) {
      return { status: "generation_stale" };
    }
    await ctx.db.patch(existing._id, {
      lastHeartbeatAt: args.heartbeatAt,
      sessionProviderEventCount: args.providerEventCount,
      sessionCandidateCount: args.candidateCount,
      sessionParsedCount: args.parsedCount,
      sessionStoredCount: args.storedCount,
      ...(Number.isFinite(args.lastProviderEventAt)
        ? { lastProviderEventAt: args.lastProviderEventAt }
        : {}),
      updatedAt: Date.now(),
    });
    return { status: existing.status };
  },
});

export const storeStreamDatisRows = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    matchedAt: v.number(),
    rows: v.array(datisStreamRowValidator),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const runtime = getStreamRuntime();
    if (!runtime.ready) {
      return {
        status: runtime.status,
        insertedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
      };
    }
    const statusRow = await getStoredStatus(ctx, stationIcao);
    if (
      statusRow?.generation !== args.generation ||
      !isMadridDatisStreamLeaseActive(statusRow, args.matchedAt)
    ) {
      return {
        status: "generation_stale",
        insertedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
      };
    }

    const now = Date.now();
    let insertedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    for (const row of args.rows) {
      if (
        row.stationIcao !== stationIcao ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
      ) {
        throw new Error("Invalid LEMD stream D-ATIS row.");
      }
      const existing = await ctx.db
        .query("madridDatisStreamObservations")
        .withIndex("by_station_dedupe_key", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("dedupeKey", row.dedupeKey),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("madridDatisStreamObservations", {
          ...row,
          capturedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        insertedCount += 1;
      } else if (row.receivedAtUtc < existing.receivedAtUtc) {
        await ctx.db.patch(existing._id, {
          reportTimeLocal: row.reportTimeLocal,
          tempC: row.tempC,
          tempF: row.tempF,
          dewPointC: row.dewPointC,
          dewPointF: row.dewPointF,
          receivedAtUtc: row.receivedAtUtc,
          receivedAtLocal: row.receivedAtLocal,
          deliveryLagMs: row.deliveryLagMs,
          capturedAt: now,
          updatedAt: now,
        });
        updatedCount += 1;
      } else {
        unchangedCount += 1;
      }
    }

    const latestReportTsUtc = Math.max(
      statusRow.latestReportTsUtc ?? Number.NEGATIVE_INFINITY,
      ...args.rows.map((row) => row.reportTsUtc),
    );
    await ctx.db.patch(statusRow._id, {
      lastMatchAt: args.matchedAt,
      lastSuccessAt: now,
      ...(Number.isFinite(latestReportTsUtc)
        ? { latestReportTsUtc }
        : {}),
      updatedAt: now,
    });
    return {
      status: args.rows.length ? "ok" : "no_data",
      insertedCount,
      updatedCount,
      unchangedCount,
    };
  },
});

export const finishStreamListener = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    endedAt: v.number(),
    outcome: v.union(
      v.literal("rotate"),
      v.literal("error"),
      v.literal("disconnected"),
      v.literal("limit"),
    ),
    message: v.optional(v.string()),
    providerEventCount: v.number(),
    candidateCount: v.number(),
    parsedCount: v.number(),
    storedCount: v.number(),
    lastProviderEventAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const runtime = getStreamRuntime();
    if (!runtime.ready) {
      return { status: runtime.status, restarted: false };
    }
    const existing = await getStoredStatus(ctx, stationIcao);
    if (existing?.generation !== args.generation) {
      return { status: "generation_stale", restarted: false };
    }

    const totals = {
      totalProviderEventCount:
        (existing.totalProviderEventCount ?? 0) +
        args.providerEventCount,
      totalCandidateCount:
        (existing.totalCandidateCount ?? 0) + args.candidateCount,
      totalParsedCount:
        (existing.totalParsedCount ?? 0) + args.parsedCount,
      totalStoredCount:
        (existing.totalStoredCount ?? 0) + args.storedCount,
    };
    if (args.outcome === "rotate") {
      const next = await queueStreamListener(
        ctx,
        stationIcao,
        {
          ...existing,
          ...totals,
          consecutiveFailures: 0,
          sessionEndedAt: args.endedAt,
          lastProviderEventAt:
            args.lastProviderEventAt ?? existing.lastProviderEventAt,
        },
        args.endedAt,
      );
      await ctx.db.patch(existing._id, {
        ...totals,
        consecutiveFailures: 0,
        sessionEndedAt: args.endedAt,
        ...(Number.isFinite(args.lastProviderEventAt)
          ? { lastProviderEventAt: args.lastProviderEventAt }
          : {}),
      });
      return { ...next, restarted: next.queued === true };
    }

    const consecutiveFailures = (existing.consecutiveFailures ?? 0) + 1;
    const backoffMs = getMadridDatisStreamBackoffMs(
      consecutiveFailures,
      args.generation,
    );
    const retryAfterAt = args.endedAt + backoffMs;
    await ctx.db.patch(existing._id, {
      status: "backoff",
      generation: "",
      leaseUntil: 0,
      sessionEndedAt: args.endedAt,
      sessionProviderEventCount: args.providerEventCount,
      sessionCandidateCount: args.candidateCount,
      sessionParsedCount: args.parsedCount,
      sessionStoredCount: args.storedCount,
      ...totals,
      consecutiveFailures,
      retryAfterAt,
      lastError: String(args.message ?? "Airframes stream ended.")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280),
      ...(Number.isFinite(args.lastProviderEventAt)
        ? { lastProviderEventAt: args.lastProviderEventAt }
        : {}),
      updatedAt: Date.now(),
    });
    const retryRuntime = getStreamRuntime();
    if (retryRuntime.ready) {
      await ctx.scheduler.runAfter(
        backoffMs,
        internal.madridDatisStream.superviseScheduledStream,
        { stationIcao },
      );
    }
    return {
      status: retryRuntime.ready ? "backoff" : retryRuntime.status,
      restarted: false,
      retryAfterAt,
    };
  },
});

export const clearStoppedStreamListener = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    endedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const existing = await getStoredStatus(ctx, stationIcao);
    if (existing?.generation !== args.generation) {
      return { status: "generation_stale" };
    }
    const runtime = getStreamRuntime();
    await ctx.db.patch(existing._id, {
      status: "queued",
      configured: runtime.ready,
      generation: "",
      leaseUntil: 0,
      sessionEndedAt: args.endedAt,
      retryAfterAt: undefined,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    const restartRuntime = getStreamRuntime();
    if (runtime.ready && restartRuntime.ready) {
      await ctx.scheduler.runAfter(
        0,
        internal.madridDatisStream.superviseScheduledStream,
        { stationIcao },
      );
    }
    return {
      status:
        runtime.ready && restartRuntime.ready
          ? "stopped"
          : !runtime.ready
            ? runtime.status
            : restartRuntime.status,
    };
  },
});

export const getStreamObservations = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const access = getStreamAccess();
    const connection = getStreamConnection();
    const base = {
      stationIcao,
      approval: {
        approved: access.approved,
        status: access.status,
        flagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
      },
      connection: {
        enabled: connection.enabled,
        status: connection.status,
        flagName: AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
      },
      source: {
        provider: "Airframes",
        label: "Sampled live D-ATIS relay via Airframes Socket.IO",
        url: "https://airframes.io",
        attribution: AIRFRAMES_ATTRIBUTION,
        authentication: access.approved
          ? access.authentication
          : "disabled",
        transport: "socket.io",
        subscription: "messages:sniff",
        sampled: true,
        captureGuaranteed: false,
      },
    };
    if (!access.approved) {
      return {
        ...base,
        status: "approval_required",
        listener: {
          status: "approval_required",
          configured: false,
        },
        latest: null,
        rows: [],
      };
    }

    const [storedRows, latestCandidates, listener] = await Promise.all([
      ctx.db
        .query("madridDatisStreamObservations")
        .withIndex("by_station_date_report_ts", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", args.date),
        )
        .collect(),
      ctx.db
        .query("madridDatisStreamObservations")
        .withIndex("by_station_report_ts", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .order("desc")
        .take(12),
      getStoredStatus(ctx, stationIcao),
    ]);
    const toPublicRow = (row) => ({
      stationIcao: row.stationIcao,
      date: row.date,
      reportTsUtc: row.reportTsUtc,
      reportTimeLocal: row.reportTimeLocal,
      reportKind: row.reportKind,
      designator: row.designator,
      tempC: row.tempC,
      tempF: row.tempF,
      dewPointC: row.dewPointC,
      dewPointF: row.dewPointF,
      receivedAtUtc: row.receivedAtUtc,
      receivedAtLocal: row.receivedAtLocal,
      deliveryLagMs: row.deliveryLagMs,
      source: row.source,
      deliveryPath: "stream",
    });
    const rows = selectCanonicalDatisRows(storedRows).map(toPublicRow);
    const latestRows = selectCanonicalDatisRows(latestCandidates);
    const latestReportTsUtc = latestRows.length
      ? Math.max(...latestRows.map((row) => row.reportTsUtc))
      : null;
    const latestStored = Number.isFinite(latestReportTsUtc)
      ? latestRows.find((row) => row.reportTsUtc === latestReportTsUtc) ??
        null
      : null;
    const latest = latestStored ? toPublicRow(latestStored) : null;
    const stale = isListenerStatusStale(listener, Date.now());
    const publicStatus = !connection.enabled
      ? "connection_disabled"
      : stale
        ? "stale"
        : listener?.status ?? "queued";

    return {
      ...base,
      status: publicStatus,
      listener: listener
        ? {
            status: publicStatus,
            configured: connection.enabled,
            lastAttemptAt: listener.lastAttemptAt,
            lastConnectedAt: listener.lastConnectedAt,
            lastSubscribedAt: listener.lastSubscribedAt,
            lastHeartbeatAt: listener.lastHeartbeatAt,
            lastProviderEventAt: listener.lastProviderEventAt,
            lastMatchAt: listener.lastMatchAt,
            lastSuccessAt: listener.lastSuccessAt,
            latestReportTsUtc: listener.latestReportTsUtc,
            retryAfterAt: listener.retryAfterAt,
          }
        : {
            status: connection.enabled
              ? "queued"
              : "connection_disabled",
            configured: connection.enabled,
          },
      latest,
      rows,
    };
  },
});
