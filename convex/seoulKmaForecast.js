import {
  internalActionGeneric,
  internalMutationGeneric,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { parseKmaAirportForecastHtml } from "./seoulKmaForecastParser.js";

const SEOUL_TIMEZONE = "Asia/Seoul";
const KMA_AMO_APPROVAL_FLAG =
  "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED";
const KMA_AMO_AIRPORT_URL =
  "https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI";
const APPROVAL_REQUIRED_MESSAGE =
  "KMA/AMO airport forecast access approval is required before RKSI collection can run.";
const KMA_SOURCE = "kma_amo_airport";
const KMA_REQUEST_TIMEOUT_MS = 15_000;
const COLLECTION_LOCK_TIMEOUT_MS = 15 * 60 * 1_000;
const MIN_COLLECTION_INTERVAL_MS = 10 * 60 * 1_000;

const SEOUL_STATION = {
  stationIcao: "RKSI",
  stationName: "Incheon International",
  timeZone: SEOUL_TIMEZONE,
};

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

function getDateParts(formatter, epochMs) {
  const values = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatDateInSeoul(epochMs) {
  const parts = getDateParts(dateFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDateTimeInSeoul(epochMs) {
  const parts = getDateParts(dateTimeFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatErrorMessage(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  return message.slice(0, 500);
}

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

async function storeAttempt(ctx, {
  stationIcao,
  collectionTrigger,
  capturedAt,
  status,
  error,
  response,
  responseBytes,
  parsed,
}) {
  return await ctx.runMutation("seoulKmaForecast:storeForecastCapture", {
    stationIcao,
    stationName: parsed?.stationName ?? SEOUL_STATION.stationName,
    source: KMA_SOURCE,
    sourceUrl: KMA_AMO_AIRPORT_URL,
    collectionTrigger,
    capturedAt,
    capturedAtLocal: formatDateTimeInSeoul(capturedAt),
    captureDate: formatDateInSeoul(capturedAt),
    status,
    approvalFlagName: KMA_AMO_APPROVAL_FLAG,
    ...(error ? { error } : {}),
    ...(response
      ? {
          httpStatus: response.status,
          ...(response.headers.get("content-type")
            ? { contentType: response.headers.get("content-type") }
            : {}),
          ...(response.headers.get("etag")
            ? { etag: response.headers.get("etag") }
            : {}),
          ...(response.headers.get("last-modified")
            ? { lastModified: response.headers.get("last-modified") }
            : {}),
        }
      : {}),
    ...(Number.isFinite(responseBytes) ? { responseBytes } : {}),
    ...(Number.isFinite(parsed?.pageReportedAt)
      ? {
          pageReportedAt: parsed.pageReportedAt,
          pageReportedAtLocal: parsed.pageReportedAtLocal,
        }
      : {}),
    dailyRows: parsed?.dailyRows ?? [],
    hourlyRows: parsed?.hourlyRows ?? [],
  });
}

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
    internal.seoulKmaForecast.collectQueuedAirportForecast,
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

async function runAirportForecastCollection(ctx, args, collectionTrigger) {
  const stationIcao = normalizeStationIcao(args.stationIcao);
  const capturedAt = Date.now();

  // This is the action/scheduled-entry gate. A disabled scheduled run records
  // an honest status but never reaches the external request boundary.
  if (!hasApprovedKmaAmoAccess()) {
    const capture = await storeAttempt(ctx, {
      stationIcao,
      collectionTrigger,
      capturedAt,
      status: "approval_required",
      error: APPROVAL_REQUIRED_MESSAGE,
    });
    return {
      status: "approval_required",
      stationIcao,
      collectionTrigger,
      approval: {
        approved: false,
        status: "approval_required",
        flagName: KMA_AMO_APPROVAL_FLAG,
      },
      message: APPROVAL_REQUIRED_MESSAGE,
      capture,
    };
  }

  let response = null;
  let requestTimeoutId = null;
  try {
    // Recheck immediately before the only protected external request.
    assertApprovedKmaAmoAccess();
    const abortController = new AbortController();
    requestTimeoutId = setTimeout(
      () => abortController.abort(),
      KMA_REQUEST_TIMEOUT_MS,
    );
    response = await fetch(KMA_AMO_AIRPORT_URL, {
      cache: "no-store",
      // A redirect could otherwise turn one approved AMO request into an
      // unapproved request to a different host.
      redirect: "error",
      signal: abortController.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "User-Agent": "polypro-rksi-kma-forecast/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(
        `KMA/AMO airport forecast request failed (${response.status} ${response.statusText}).`,
      );
    }
    const finalUrl = new URL(response.url);
    if (
      finalUrl.protocol !== "https:" ||
      finalUrl.hostname !== "amo.kma.go.kr" ||
      finalUrl.pathname !== "/eng/airport.do"
    ) {
      throw new Error(
        `KMA/AMO airport forecast response used an unexpected URL: ${response.url}.`,
      );
    }
    const responseContentType = String(
      response.headers.get("content-type") ?? "",
    ).toLowerCase();
    if (
      !responseContentType.includes("text/html") &&
      !responseContentType.includes("application/xhtml+xml")
    ) {
      throw new Error(
        `KMA/AMO airport forecast returned unexpected content type ${responseContentType || "missing"}.`,
      );
    }
    const html = await response.text();
    clearTimeout(requestTimeoutId);
    requestTimeoutId = null;

    // Revocation after the request discards the response rather than parsing
    // or persisting protected data.
    assertApprovedKmaAmoAccess();
    const parsed = parseKmaAirportForecastHtml(html, {
      expectedStationIcao: stationIcao,
    });
    const responseBytes = new TextEncoder().encode(html).byteLength;

    // Recheck immediately before storage. The storage mutation repeats this
    // gate atomically in its own Convex execution.
    assertApprovedKmaAmoAccess();
    const capture = await storeAttempt(ctx, {
      stationIcao,
      collectionTrigger,
      capturedAt,
      status: "ok",
      response,
      responseBytes,
      parsed,
    });
    return {
      status: "ok",
      stationIcao,
      collectionTrigger,
      approval: {
        approved: true,
        status: "approved",
        flagName: KMA_AMO_APPROVAL_FLAG,
      },
      capture,
      dailyRowCount: parsed.dailyRows.length,
      hourlyRowCount: parsed.hourlyRows.length,
    };
  } catch (error) {
    if (requestTimeoutId !== null) {
      clearTimeout(requestTimeoutId);
    }
    const approvalRevoked = !hasApprovedKmaAmoAccess();
    const message = approvalRevoked
      ? APPROVAL_REQUIRED_MESSAGE
      : formatErrorMessage(error);
    const capture = await storeAttempt(ctx, {
      stationIcao,
      collectionTrigger,
      capturedAt,
      status: approvalRevoked ? "approval_required" : "error",
      error: message,
      response,
    });
    return {
      status: approvalRevoked ? "approval_required" : "error",
      stationIcao,
      collectionTrigger,
      approval: {
        approved: !approvalRevoked,
        status: approvalRevoked ? "approval_required" : "approved",
        flagName: KMA_AMO_APPROVAL_FLAG,
      },
      message,
      capture,
    };
  }
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

export const collectQueuedAirportForecast = internalActionGeneric({
  args: {
    stationIcao: v.string(),
    requestedAt: v.number(),
    collectionTrigger: collectionTriggerValidator,
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const claim = await ctx.runMutation(
      internal.seoulKmaForecast.claimQueuedAirportForecast,
      {
        stationIcao,
        runId: args.runId,
      },
    );
    if (!claim.claimed) {
      if (claim.status === "approval_required") {
        await ctx.runMutation(
          internal.seoulKmaForecast.writeCollectorStatus,
          {
            stationIcao,
            runId: args.runId,
            status: "approval_required",
            completedAt: Date.now(),
            lastError: APPROVAL_REQUIRED_MESSAGE,
          },
        );
        return {
          status: "approval_required",
          stationIcao,
          collectionTrigger: args.collectionTrigger,
          requestedAt: args.requestedAt,
          message: APPROVAL_REQUIRED_MESSAGE,
        };
      }
      return {
        status: "superseded",
        stationIcao,
        collectionTrigger: args.collectionTrigger,
        requestedAt: args.requestedAt,
      };
    }
    try {
      const result = await runAirportForecastCollection(
        ctx,
        { stationIcao },
        args.collectionTrigger,
      );
      await ctx.runMutation(
        internal.seoulKmaForecast.writeCollectorStatus,
        {
          stationIcao,
          runId: args.runId,
          status: result.status,
          completedAt: Date.now(),
          ...(result.message ? { lastError: result.message } : {}),
          ...(Number.isFinite(result.dailyRowCount)
            ? { dailyRowCount: result.dailyRowCount }
            : {}),
          ...(Number.isFinite(result.hourlyRowCount)
            ? { hourlyRowCount: result.hourlyRowCount }
            : {}),
        },
      );
      return {
        ...result,
        requestedAt: args.requestedAt,
      };
    } catch (error) {
      const approvalRevoked = !hasApprovedKmaAmoAccess();
      await ctx.runMutation(
        internal.seoulKmaForecast.writeCollectorStatus,
        {
          stationIcao,
          runId: args.runId,
          status: approvalRevoked ? "approval_required" : "error",
          completedAt: Date.now(),
          lastError: approvalRevoked
            ? APPROVAL_REQUIRED_MESSAGE
            : formatErrorMessage(error),
        },
      );
      throw error;
    }
  },
});
