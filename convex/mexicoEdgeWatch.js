"use node";

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";
import { buildRelayMetarRow, CAPMA_AFTN_SOURCE } from "./mexico.js";
import { mexicoEdgeFastWatchGateState } from "./mexicoCapmaApprovals.js";
import { parseCapmaAftnReportLines } from "./mexicoCapmaAftn.js";
import { fetchCapmaFresh } from "../server/mexicoCapmaTransport.js";

// Re-exported for existing importers/tests; the definition is isolate-safe in
// mexicoCapmaApprovals.js. Isolate modules must import it from there.
export { mexicoEdgeFastWatchGateState };

const STATION_ICAO = "MMMX";
const SOURCE = "capma_aftn_high_frequency_watch";
const CAPMA_AFTN_URL = "http://capma.mx/reportemetar/buscar_samx.php?id=MMMX";
const USER_AGENT =
  "polypro-mmmx-edge/1.0 (approved bounded routine-observation watcher)";
const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_DURATION_MS = 8 * 60_000 + 45_000;
const MAX_DURATION_MS = 9 * 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const MIN_ERROR_BACKOFF_MS = 15_000;
const MAX_ERROR_BACKOFF_MS = 30_000;
const IMAGE_ATTEMPT_LEASE_MS = 75_000;
const IMAGE_SOURCES = ["capma_tdz05", "capma_tdz23"];

export function isTargetRoutineMetar(row, sessionStartedAt) {
  if (
    row?.reportType !== "METAR" ||
    row?.isCorrection === true ||
    !Number.isFinite(row?.obsTimeUtc) ||
    !Number.isFinite(sessionStartedAt)
  ) {
    return false;
  }
  const hourStart = Math.floor(sessionStartedAt / 3_600_000) * 3_600_000;
  // MMMX routine observations have historically carried a late-hour time.
  // This deliberately wide bound identifies the current cycle without
  // encoding an unofficial exact report minute.
  return (
    row.obsTimeUtc >= hourStart + 30 * 60_000 &&
    row.obsTimeUtc < hourStart + 90 * 60_000
  );
}

export function isMexicoRoutineWatchWindow(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return false;
  }
  const offsetInHour = ((epochMs % 3_600_000) + 3_600_000) % 3_600_000;
  return offsetInHour >= 40 * 60_000 && offsetInHour < 58 * 60_000;
}

export function mexicoRoutineWatchSessionEnd(epochMs) {
  if (!isMexicoRoutineWatchWindow(epochMs)) {
    return null;
  }
  const hourStart = Math.floor(epochMs / 3_600_000) * 3_600_000;
  const offsetInHour = epochMs - hourStart;
  return hourStart + (offsetInHour < 49 * 60_000 ? 49 : 58) * 60_000;
}

export function mexicoRoutineWatchRetryDelayMs(
  intervalMs,
  consecutiveErrorCount,
) {
  // A slow or unreachable owner host is already under pressure. Keep the
  // five-second target while healthy, but after the first failure leave a
  // meaningful quiet window for the once-per-minute TDZ image captures.
  const baseDelayMs = Math.max(
    MIN_ERROR_BACKOFF_MS,
    Math.max(1, Math.round(intervalMs)),
  );
  const errorCount = Math.max(0, Math.floor(consecutiveErrorCount));
  const multiplier = 2 ** Math.min(5, Math.max(0, errorCount - 1));
  return Math.min(MAX_ERROR_BACKOFF_MS, baseDelayMs * multiplier);
}

export function capmaImageCollectorInFlight(status, nowMs) {
  return Boolean(
    status?.status === "fetching" &&
    Number.isFinite(status?.lastAttemptAt) &&
    nowMs >= status.lastAttemptAt &&
    nowMs - status.lastAttemptAt < IMAGE_ATTEMPT_LEASE_MS,
  );
}

async function capmaImageFetchInFlight(ctx, stationIcao) {
  const statuses = await Promise.all(
    IMAGE_SOURCES.map((source) =>
      ctx.runQuery(api.mexico.getCollectorStatus, { stationIcao, source }),
    ),
  );
  const nowMs = Date.now();
  return statuses.some((status) => capmaImageCollectorInFlight(status, nowMs));
}

function assertStation(value) {
  const stationIcao = String(value ?? STATION_ICAO)
    .trim()
    .toUpperCase();
  if (stationIcao !== STATION_ICAO) {
    throw new Error("The Mexico edge routine watcher supports MMMX only.");
  }
  return stationIcao;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCapmaAftn(deadline) {
  const fetchStartedAt = Date.now();
  const remainingMs = deadline - fetchStartedAt;
  if (remainingMs <= 0) {
    return null;
  }
  // Single attempt per call: the surrounding session loop already applies
  // exponential backoff, so per-call retries would multiply request volume.
  const response = await fetchCapmaFresh(CAPMA_AFTN_URL, {
    headers: { "User-Agent": USER_AGENT },
    timeoutMs: Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remainingMs)),
    maxBodyBytes: MAX_RESPONSE_BYTES,
  });
  const text = response.text();
  const fetchCompletedAt = Date.now();
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `CAPMA AFTN relay redirected (${response.status}); refusing to follow.`,
    );
  }
  if (!response.ok) {
    throw new Error(`CAPMA AFTN relay request failed (${response.status}).`);
  }
  return {
    response,
    text,
    fetchStartedAt,
    fetchCompletedAt,
  };
}

async function setStatus(ctx, stationIcao, status, values = {}) {
  await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
    stationIcao,
    source: SOURCE,
    status,
    ...values,
  });
}

/**
 * Bounded sub-minute CAPMA watcher for an explicitly approved routine window.
 *
 * The public action is safe to place on a cron because all three exact-true
 * gates are checked before the session, before every request, after every
 * response, and immediately before each storage mutation. With the production
 * default (flags absent) it performs no external request.
 */
export const watchRoutineMetarWindow = internalActionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    intervalMs: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    const intervalMs = Math.max(
      1_000,
      Math.min(15_000, Math.round(args.intervalMs ?? DEFAULT_INTERVAL_MS)),
    );
    const durationMs = Math.max(
      intervalMs,
      Math.min(
        MAX_DURATION_MS,
        Math.round(args.durationMs ?? DEFAULT_DURATION_MS),
      ),
    );
    const startedAt = Date.now();
    const initialGate = mexicoEdgeFastWatchGateState();
    if (
      !initialGate.baseAccessApproved ||
      !initialGate.highFrequencyAccessApproved
    ) {
      await setStatus(ctx, stationIcao, "approval_required", {
        lastError:
          "CAPMA base and high-frequency access approval are both required.",
      });
      return { status: "approval_required", ...initialGate };
    }
    if (!initialGate.collectionEnabled) {
      await setStatus(ctx, stationIcao, "idle", {
        lastError: "Mexico edge high-frequency collection is disabled.",
      });
      return { status: "disabled", ...initialGate };
    }
    if (!isMexicoRoutineWatchWindow(startedAt)) {
      await setStatus(ctx, stationIcao, "idle", {
        lastError:
          "Outside the bounded :40 through :57 UTC routine watch window.",
      });
      return {
        status: "outside_window",
        stationIcao,
        startedAt,
        watchWindowMinuteStart: 40,
        watchWindowMinuteEndExclusive: 58,
      };
    }
    const windowEnd = mexicoRoutineWatchSessionEnd(startedAt);
    const effectiveDurationMs = Math.max(
      1,
      Math.min(durationMs, windowEnd - startedAt),
    );

    const claim = await ctx.runMutation(internal.mexico.claimCollectorAttempt, {
      stationIcao,
      source: SOURCE,
      cooldownMs: Math.max(1, effectiveDurationMs - 1_000),
    });
    if (!claim.claimed) {
      return { status: "cooldown", retryAfterAt: claim.retryAfterAt };
    }

    const deadline = startedAt + effectiveDurationMs;
    let iterations = 0;
    let successCount = 0;
    let errorCount = 0;
    let parsedRowCount = 0;
    let recordedCount = 0;
    let lastSuccessAt;
    let lastHttpStatus;
    let lastResponseBytes;
    let lastError = "";
    let targetReport = null;
    let revoked = false;
    let consecutiveErrorCount = 0;
    let imagePriorityDeferrals = 0;
    const seenReportLines = new Set();

    while (Date.now() < deadline) {
      const iterationStartedAt = Date.now();
      let delayAfterIterationMs = intervalMs;
      iterations += 1;
      // Recheck immediately before the protected request.
      if (!mexicoEdgeFastWatchGateState().allowed) {
        revoked = true;
        break;
      }
      try {
        // TDZ frames exist for only about one source cadence. If either image
        // worker is holding its bounded lease, defer this small-page fast poll
        // rather than adding another connection to the same legacy host.
        if (await capmaImageFetchInFlight(ctx, stationIcao)) {
          imagePriorityDeferrals += 1;
          const remaining = deadline - Date.now();
          const waitMs = Math.min(remaining, intervalMs);
          if (waitMs > 0) {
            await sleep(waitMs);
          }
          continue;
        }
        const fetched = await fetchCapmaAftn(deadline);
        if (!fetched || fetched.fetchCompletedAt >= deadline) {
          break;
        }
        consecutiveErrorCount = 0;
        lastHttpStatus = fetched.response.status;
        lastResponseBytes = fetched.text.length;
        // Do not parse or retain a protected response after revocation.
        if (!mexicoEdgeFastWatchGateState().allowed) {
          revoked = true;
          break;
        }
        const parsedLines = parseCapmaAftnReportLines(fetched.text);
        const lines = parsedLines.filter((line) => !seenReportLines.has(line));
        for (const line of parsedLines) {
          seenReportLines.add(line);
        }
        const rows = [];
        for (const line of lines) {
          const row = await buildRelayMetarRow(line, {
            stationIcao,
            source: CAPMA_AFTN_SOURCE,
            fetchStartedAt: fetched.fetchStartedAt,
            fetchCompletedAt: fetched.fetchCompletedAt,
          });
          if (row) {
            rows.push(row);
          }
        }
        parsedRowCount += rows.length;
        if (rows.length > 0) {
          // The worker itself enforces the additional approval and kill switch;
          // existing storage mutations independently recheck base CAPMA access.
          if (!mexicoEdgeFastWatchGateState().allowed) {
            revoked = true;
            break;
          }
          const sightings = await ctx.runMutation(
            internal.mexico.recordRelaySightings,
            {
              rows: rows.map((row) => ({
                stationIcao,
                source: CAPMA_AFTN_SOURCE,
                date: row.date,
                obsTimeUtc: row.obsTimeUtc,
                typelessHash: row.typelessHash,
                rawReport: row.rawMetar,
                reportTypeHint: row.reportType,
                isCorrectionHint: row.isCorrection,
                firstSeenAt: fetched.fetchCompletedAt,
                fetchStartedAt: fetched.fetchStartedAt,
                fetchCompletedAt: fetched.fetchCompletedAt,
              })),
            },
          );
          if (!mexicoEdgeFastWatchGateState().allowed) {
            revoked = true;
            break;
          }
          await ctx.runMutation(internal.mexico.upsertMetarBatch, { rows });
          recordedCount += sightings.recordedCount;
        }
        successCount += 1;
        lastSuccessAt = fetched.fetchCompletedAt;
        targetReport =
          rows.find((row) => isTargetRoutineMetar(row, startedAt)) ?? null;
        if (targetReport) {
          break;
        }
        delayAfterIterationMs = Math.max(
          0,
          intervalMs - (Date.now() - iterationStartedAt),
        );
      } catch (error) {
        if (Date.now() >= deadline) {
          break;
        }
        errorCount += 1;
        consecutiveErrorCount += 1;
        lastError = error instanceof Error ? error.message : String(error);
        delayAfterIterationMs = mexicoRoutineWatchRetryDelayMs(
          intervalMs,
          consecutiveErrorCount,
        );
      }
      const remaining = deadline - Date.now();
      const waitMs = Math.min(remaining, delayAfterIterationMs);
      if (waitMs <= 0) {
        if (remaining <= 0) {
          break;
        }
        continue;
      }
      await sleep(waitMs);
    }
    const completedAt = Date.now();

    if (revoked) {
      const finalGate = mexicoEdgeFastWatchGateState();
      const approvalStillPresent =
        finalGate.baseAccessApproved && finalGate.highFrequencyAccessApproved;
      const revokedStatus = approvalStillPresent
        ? "disabled"
        : "approval_required";
      await setStatus(
        ctx,
        stationIcao,
        approvalStillPresent ? "idle" : "approval_required",
        {
          lastError: approvalStillPresent
            ? "The Mexico edge high-frequency collection kill switch was disabled during the session."
            : "CAPMA approval was removed during the session.",
          ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
          ...(lastHttpStatus !== undefined
            ? { httpStatus: lastHttpStatus }
            : {}),
          ...(lastResponseBytes !== undefined
            ? { responseBytes: lastResponseBytes }
            : {}),
          rowCount: recordedCount,
        },
      );
      return {
        status: revokedStatus,
        startedAt,
        completedAt,
        intervalMs,
        durationMs: effectiveDurationMs,
        iterations,
        successCount,
        errorCount,
        recordedCount,
        imagePriorityDeferrals,
      };
    }

    const status = successCount > 0 ? "ok" : "error";
    await setStatus(ctx, stationIcao, status, {
      ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
      lastError,
      ...(lastHttpStatus !== undefined ? { httpStatus: lastHttpStatus } : {}),
      ...(lastResponseBytes !== undefined
        ? { responseBytes: lastResponseBytes }
        : {}),
      rowCount: recordedCount,
    });
    return {
      status,
      stationIcao,
      startedAt,
      completedAt,
      intervalMs,
      durationMs: effectiveDurationMs,
      iterations,
      successCount,
      errorCount,
      parsedRowCount,
      recordedCount,
      imagePriorityDeferrals,
      targetReport: targetReport
        ? {
            reportKey: targetReport.reportKey,
            obsTimeUtc: targetReport.obsTimeUtc,
            firstSeenAt: targetReport.firstSeenAt,
            tempC: targetReport.tempC,
          }
        : null,
      lastError: lastError || null,
    };
  },
});
