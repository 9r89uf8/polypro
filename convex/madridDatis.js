import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import {
  AIRFRAMES_DATIS_APPROVAL_FLAG,
  evaluateAirframesDatisAccess,
} from "./madridDatisAccess.js";
import { parseAirframesDatisPayload } from "./madridDatisParser.js";

const AIRFRAMES_MESSAGES_URL = "https://api.airframes.io/v1/messages";
const AIRFRAMES_ATTRIBUTION =
  "Data provided by Airframes.io and its community of feeders.";
const SUPPORTED_STATION_ICAO = "LEMD";
const POLL_COOLDOWN_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 12 * 1000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const collectorStatusValidator = v.union(
  v.literal("fetching"),
  v.literal("ok"),
  v.literal("no_data"),
  v.literal("error"),
  v.literal("rate_limited"),
);

const datisRowValidator = v.object({
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
  source: v.string(),
  dedupeKey: v.string(),
});

function getAirframesApiKey() {
  const access = evaluateAirframesDatisAccess(
    process.env.AIRFRAMES_LEMD_DATIS_ACCESS_APPROVED,
    process.env.AIRFRAMES_API_KEY,
  );
  return access.status === "approved" ? access.apiKey : null;
}

function normalizeStationIcao(value) {
  const stationIcao = String(value ?? SUPPORTED_STATION_ICAO)
    .trim()
    .toUpperCase();
  if (stationIcao !== SUPPORTED_STATION_ICAO) {
    throw new Error("The Airframes D-ATIS collector supports LEMD only.");
  }
  return stationIcao;
}

function assertApprovedAirframesDatisAccess() {
  const access = evaluateAirframesDatisAccess(
    process.env.AIRFRAMES_LEMD_DATIS_ACCESS_APPROVED,
    process.env.AIRFRAMES_API_KEY,
  );
  if (access.status !== "approved") {
    throw new Error(
      `Approval required: set ${AIRFRAMES_DATIS_APPROVAL_FLAG} to the exact string true only after the documented permissions are granted.`,
    );
  }
}

function getConfigurationStatus() {
  return evaluateAirframesDatisAccess(
    process.env.AIRFRAMES_LEMD_DATIS_ACCESS_APPROVED,
    process.env.AIRFRAMES_API_KEY,
  ).status;
}

function formatErrorMessage(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown Airframes error";
  return message.slice(0, 280);
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function parseRetryAfterAt(value, nowMs = Date.now()) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return nowMs + POLL_COOLDOWN_MS;
  }
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return nowMs + Math.max(POLL_COOLDOWN_MS, seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  return Number.isFinite(dateMs) && dateMs > nowMs
    ? dateMs
    : nowMs + POLL_COOLDOWN_MS;
}

class AirframesRateLimitError extends Error {
  constructor(message, retryAt) {
    super(message);
    this.name = "AirframesRateLimitError";
    this.retryAt = retryAt;
  }
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

async function fetchAirframesDatisMessages() {
  const url = new URL(AIRFRAMES_MESSAGES_URL);
  url.searchParams.set("text", "LEMD ATIS");
  url.searchParams.set("limit", "100");

  assertApprovedAirframesDatisAccess();
  const apiKey = getAirframesApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 240);
      const retryAfter = response.headers.get("retry-after");
      const message = `Airframes messages request failed (${response.status})${
        retryAfter ? `; retry after ${retryAfter}` : ""
      }: ${body}`;
      if (response.status === 429) {
        throw new AirframesRateLimitError(
          message,
          parseRetryAfterAt(retryAfter),
        );
      }
      throw new Error(message);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new Error(
        `Airframes returned an unexpected content type: ${contentType || "missing"}.`,
      );
    }
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) {
      throw new Error("Airframes response exceeded the configured size limit.");
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("Airframes returned invalid JSON.");
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export const reserveAirframesDatisPoll = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    attemptedAt: v.number(),
    mode: v.union(v.literal("manual"), v.literal("scheduled")),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const configurationStatus = getConfigurationStatus();
    if (configurationStatus !== "approved") {
      return { status: configurationStatus };
    }

    const existing = await ctx.db
      .query("madridDatisCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .first();
    if (
      existing?.retryAfterAt &&
      args.attemptedAt < existing.retryAfterAt
    ) {
      return {
        status: "rate_limited",
        retryAt: existing.retryAfterAt,
      };
    }
    if (
      existing &&
      args.attemptedAt - existing.lastAttemptAt < POLL_COOLDOWN_MS
    ) {
      return {
        status: "cooldown",
        retryAt: existing.lastAttemptAt + POLL_COOLDOWN_MS,
      };
    }

    const patch = {
      stationIcao,
      status: "fetching",
      configured: true,
      mode: args.mode,
      lastAttemptAt: args.attemptedAt,
      lastError: undefined,
      retryAfterAt: undefined,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("madridDatisCollectorStatus", patch);
    }
    return { status: "reserved" };
  },
});

export const storeAirframesDatisBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    attemptedAt: v.number(),
    fetchedCount: v.number(),
    rejectedCount: v.number(),
    duplicateCount: v.number(),
    rows: v.array(datisRowValidator),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const configurationStatus = getConfigurationStatus();
    if (configurationStatus !== "approved") {
      return {
        status: configurationStatus,
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
        throw new Error("Invalid LEMD D-ATIS row.");
      }

      const existing = await ctx.db
        .query("madridDatisObservations")
        .withIndex("by_station_dedupe_key", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("dedupeKey", row.dedupeKey),
        )
        .first();

      if (!existing) {
        await ctx.db.insert("madridDatisObservations", {
          ...row,
          capturedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      if (row.receivedAtUtc < existing.receivedAtUtc) {
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

    const storedCollector = await ctx.db
      .query("madridDatisCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .first();
    const latestReportTsUtc = args.rows.length
      ? Math.max(...args.rows.map((row) => row.reportTsUtc))
      : storedCollector?.latestReportTsUtc;
    const status = args.rows.length ? "ok" : "no_data";
    const collectorPatch = {
      stationIcao,
      status,
      configured: true,
      mode: storedCollector?.mode ?? "scheduled",
      lastAttemptAt: args.attemptedAt,
      lastSuccessAt: now,
      fetchedCount: args.fetchedCount,
      parsedCount: args.rows.length,
      rejectedCount: args.rejectedCount,
      duplicateCount: args.duplicateCount,
      insertedCount,
      updatedCount,
      unchangedCount,
      ...(Number.isFinite(latestReportTsUtc)
        ? { latestReportTsUtc }
        : {}),
      lastError: undefined,
      retryAfterAt: undefined,
      updatedAt: now,
    };
    if (storedCollector) {
      await ctx.db.patch(storedCollector._id, collectorPatch);
    } else {
      await ctx.db.insert("madridDatisCollectorStatus", collectorPatch);
    }

    return {
      status,
      insertedCount,
      updatedCount,
      unchangedCount,
    };
  },
});

export const recordAirframesDatisFailure = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    attemptedAt: v.number(),
    message: v.string(),
    retryAfterAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const configurationStatus = getConfigurationStatus();
    if (configurationStatus !== "approved") {
      return { status: configurationStatus };
    }

    const existing = await ctx.db
      .query("madridDatisCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .first();
    const patch = {
      stationIcao,
      status: Number.isFinite(args.retryAfterAt)
        ? "rate_limited"
        : "error",
      configured: true,
      mode: existing?.mode ?? "scheduled",
      lastAttemptAt: args.attemptedAt,
      lastError: args.message.slice(0, 280),
      retryAfterAt: args.retryAfterAt,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("madridDatisCollectorStatus", patch);
    }
    return {
      status: patch.status,
      ...(Number.isFinite(args.retryAfterAt)
        ? { retryAt: args.retryAfterAt }
        : {}),
    };
  },
});

async function runAirframesDatisPoll(ctx, args, mode) {
  const stationIcao = normalizeStationIcao(args.stationIcao);
  let attemptedAt = Date.now();
  const configurationStatus = getConfigurationStatus();
  if (configurationStatus !== "approved") {
    return {
      status: configurationStatus,
      stationIcao,
      mode,
      approvalFlagName: AIRFRAMES_DATIS_APPROVAL_FLAG,
    };
  }

  let reservation = await ctx.runMutation(
    "madridDatis:reserveAirframesDatisPoll",
    { stationIcao, attemptedAt, mode },
  );
  if (
    mode === "scheduled" &&
    reservation.status === "cooldown" &&
    Number.isFinite(reservation.retryAt)
  ) {
    const remainingCooldownMs = Math.max(
      0,
      reservation.retryAt - Date.now(),
    );
    if (remainingCooldownMs <= POLL_COOLDOWN_MS) {
      await sleep(Math.min(POLL_COOLDOWN_MS, remainingCooldownMs + 25));
      // A delayed scheduled attempt is new work: recheck approval,
      // configuration, Retry-After, and the shared reservation atomically.
      const resumedConfigurationStatus = getConfigurationStatus();
      if (resumedConfigurationStatus !== "approved") {
        return {
          status: resumedConfigurationStatus,
          stationIcao,
          mode,
          approvalFlagName: AIRFRAMES_DATIS_APPROVAL_FLAG,
        };
      }
      attemptedAt = Date.now();
      reservation = await ctx.runMutation(
        "madridDatis:reserveAirframesDatisPoll",
        { stationIcao, attemptedAt, mode },
      );
    }
  }
  if (reservation.status !== "reserved") {
    return {
      ...reservation,
      stationIcao,
      mode,
    };
  }

  try {
    assertApprovedAirframesDatisAccess();
    const payload = await fetchAirframesDatisMessages();

    // Revocation or credential removal after the request discards the
    // response. The storage mutation repeats both checks transactionally.
    assertApprovedAirframesDatisAccess();
    const parsed = parseAirframesDatisPayload(payload, { nowMs: Date.now() });
    assertApprovedAirframesDatisAccess();
    const stored = await ctx.runMutation(
      "madridDatis:storeAirframesDatisBatch",
      {
        stationIcao,
        attemptedAt,
        fetchedCount: parsed.messageCount,
        rejectedCount: parsed.rejectedCount,
        duplicateCount: parsed.duplicateCount,
        rows: parsed.rows,
      },
    );

    return {
      ...stored,
      stationIcao,
      mode,
      fetchedCount: parsed.messageCount,
      parsedCount: parsed.parsedCount,
      canonicalCount: parsed.rows.length,
      rejectedCount: parsed.rejectedCount,
      duplicateCount: parsed.duplicateCount,
    };
  } catch (error) {
    const status = getConfigurationStatus();
    if (status !== "approved") {
      return {
        status,
        stationIcao,
        mode,
        approvalFlagName: AIRFRAMES_DATIS_APPROVAL_FLAG,
      };
    }

    const message = formatErrorMessage(error);
    const failure = await ctx.runMutation(
      "madridDatis:recordAirframesDatisFailure",
      {
        stationIcao,
        attemptedAt,
        message,
        ...(Number.isFinite(error?.retryAt)
          ? { retryAfterAt: error.retryAt }
          : {}),
      },
    );
    return {
      status: failure.status,
      stationIcao,
      mode,
      message,
      ...(Number.isFinite(failure.retryAt)
        ? { retryAt: failure.retryAt }
        : {}),
    };
  }
}

export const pollAirframesDatis = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await runAirframesDatisPoll(ctx, args, "manual"),
});

export const pollScheduledAirframesDatis = internalActionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await runAirframesDatisPoll(ctx, args, "scheduled"),
});

export const getDatisObservations = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const configurationStatus = getConfigurationStatus();
    const base = {
      stationIcao,
      approval: {
        approved: configurationStatus !== "approval_required",
        status: configurationStatus,
        flagName: AIRFRAMES_DATIS_APPROVAL_FLAG,
      },
      source: {
        provider: "Airframes",
        label: "D-ATIS operational temperature via Airframes ACARS relay",
        url: "https://airframes.io",
        attribution: AIRFRAMES_ATTRIBUTION,
        authentication:
          configurationStatus === "approved"
            ? getAirframesApiKey()
              ? "bearer"
              : "anonymous"
            : "disabled",
        nominalIntervalMinutes: 10,
        captureGuaranteed: false,
      },
    };

    if (configurationStatus !== "approved") {
      return {
        ...base,
        status: configurationStatus,
        collector: {
          status: configurationStatus,
          configured: false,
        },
        latest: null,
        rows: [],
      };
    }

    const [storedRows, latestCandidates, collector] = await Promise.all([
      ctx.db
        .query("madridDatisObservations")
        .withIndex("by_station_date_report_ts", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", args.date),
        )
        .collect(),
      ctx.db
        .query("madridDatisObservations")
        .withIndex("by_station_report_ts", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .order("desc")
        .take(12),
      ctx.db
        .query("madridDatisCollectorStatus")
        .withIndex("by_station", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .first(),
    ]);
    const rows = selectCanonicalDatisRows(storedRows);
    const canonicalLatestCandidates =
      selectCanonicalDatisRows(latestCandidates);
    const latestReportTsUtc = canonicalLatestCandidates.length
      ? Math.max(
          ...canonicalLatestCandidates.map((row) => row.reportTsUtc),
        )
      : null;
    const latest = Number.isFinite(latestReportTsUtc)
      ? canonicalLatestCandidates.find(
          (row) => row.reportTsUtc === latestReportTsUtc,
        ) ?? null
      : null;

    return {
      ...base,
      status: collector?.status ?? (rows.length ? "ok" : "no_data"),
      collector: collector
        ? {
            status: collector.status,
            configured: true,
            mode: collector.mode,
            lastAttemptAt: collector.lastAttemptAt,
            lastSuccessAt: collector.lastSuccessAt,
            latestReportTsUtc: collector.latestReportTsUtc,
            fetchedCount: collector.fetchedCount,
            parsedCount: collector.parsedCount,
            lastError: collector.lastError,
            retryAfterAt: collector.retryAfterAt,
          }
        : {
            status: "no_data",
            configured: true,
          },
      latest,
      rows,
    };
  },
});
