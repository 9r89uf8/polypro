"use node";

import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { buildRelayMetarRow, CAPMA_AFTN_SOURCE } from "./mexico.js";
import { capmaAftnAccessApproved } from "./mexicoCapmaApprovals.js";
import { fetchCapmaFreshWithRetries } from "../server/mexicoCapmaTransport.js";

const STATION_ICAO = "MMMX";
// SENEAM/CAPMA's public AFTN report relay. Bounded research on 2026-08-03 and
// 2026-08-20 showed it carrying the raw MMMX METAR/SPECI/COR stream minutes
// before AWC's receiptTime for routine reports. Plain HTTP, owner-published,
// and covered by SENEAM's personal/noncommercial site terms, so automated
// collection requires the dedicated gate below and fails closed without it.
const CAPMA_AFTN_URL = "http://capma.mx/reportemetar/buscar_samx.php?id=MMMX";
const USER_AGENT =
  "polypro-mmmx-weather/1.0 (MMMX weather dashboard; server-side collector)";
// Below the one-minute race-parent spacing on purpose: a 60s cooldown raced
// the 60s launch cadence on scheduling jitter and silently skipped about
// half the slots as "cooldown", invalidating many paired-race comparisons.
// The request rate is still one launch per minute from the race parent.
const COOLDOWN_MS = 45_000;
const ATTEMPT_LEASE_MS = 75_000;
const DIRECT_TIMEOUT_MS = 50_000;
const RELAY_TIMEOUT_MS = 43_000;
const TOTAL_FETCH_BUDGET_MS = 55_000;
const MAX_ROWS = 12;
export { CAPMA_AFTN_SOURCE };

export function parseCapmaAftnReportLines(html) {
  return [
    ...String(html ?? "").matchAll(
      /<p\b(?=[^>]*\bid=["']?tam_let_5["']?)[^>]*>([\s\S]*?)<\/p>/gi,
    ),
  ]
    .slice(0, MAX_ROWS)
    .map((match) =>
      match[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/=\s*\d{6}\s*$/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => /^(METAR |SPECI |COR )?MMMX \d{6}Z/.test(line));
}

export const pollCapmaAftnReports = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    raceSlotUtc: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = (args.stationIcao ?? STATION_ICAO).trim().toUpperCase();
    if (stationIcao !== STATION_ICAO) {
      throw new Error("The CAPMA AFTN collector supports MMMX only.");
    }
    if (!capmaAftnAccessApproved()) {
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: CAPMA_AFTN_SOURCE,
        status: "approval_required",
        lastError: "",
      });
      return { status: "approval_required" };
    }
    const claim = await ctx.runMutation(internal.mexico.claimCollectorAttempt, {
      stationIcao,
      source: CAPMA_AFTN_SOURCE,
      cooldownMs: COOLDOWN_MS,
      leaseMs: ATTEMPT_LEASE_MS,
    });
    if (!claim.claimed) {
      return { status: "cooldown", retryAfterAt: claim.retryAfterAt };
    }
    const fetchStartedAt = Date.now();
    // Recheck immediately before the protected external request.
    if (!capmaAftnAccessApproved()) {
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: CAPMA_AFTN_SOURCE,
        status: "approval_required",
        lastError: "",
        attemptAt: claim.attemptAt,
      });
      return { status: "approval_required" };
    }
    try {
      // Prefer the configured alternate egress, then spend any remaining
      // minute-slot budget on one fresh direct connection. The wall-clock
      // budget covers both paths, so a stalled run cannot pile up indefinitely
      // behind the one-minute race parent.
      const { response } = await fetchCapmaFreshWithRetries(CAPMA_AFTN_URL, {
        headers: { "User-Agent": USER_AGENT },
        timeoutsMs: [DIRECT_TIMEOUT_MS],
        label: "CAPMA AFTN relay",
        allowRelayFallback: true,
        preferRelay: true,
        relayTimeoutMs: RELAY_TIMEOUT_MS,
        totalTimeoutMs: TOTAL_FETCH_BUDGET_MS,
      });
      const text = response.text();
      const fetchCompletedAt = Date.now();
      if (response.status >= 300 && response.status < 400) {
        throw new Error(
          `CAPMA AFTN relay redirected (${response.status}); refusing to follow.`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `CAPMA AFTN relay request failed (${response.status}): ${text.slice(0, 200)}`,
        );
      }
      // Approval can be revoked while the request is in flight. Do not parse
      // or retain the protected response after that point; storage mutations
      // enforce the same gate independently.
      if (!capmaAftnAccessApproved()) {
        await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
          stationIcao,
          source: CAPMA_AFTN_SOURCE,
          status: "approval_required",
          lastError: "",
          attemptAt: claim.attemptAt,
        });
        return { status: "approval_required" };
      }
      const lines = parseCapmaAftnReportLines(text);
      const rows = [];
      for (const line of lines) {
        const row = await buildRelayMetarRow(line, {
          stationIcao,
          source: CAPMA_AFTN_SOURCE,
          fetchStartedAt,
          fetchCompletedAt,
        });
        if (row) {
          rows.push(row);
        }
      }
      const sightingResult = await ctx.runMutation(
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
            ...(args.raceSlotUtc !== undefined
              ? { raceSlotUtc: args.raceSlotUtc }
              : {}),
            firstSeenAt: fetchCompletedAt,
            fetchStartedAt,
            fetchCompletedAt,
          })),
        },
      );
      const result = await ctx.runMutation(internal.mexico.upsertMetarBatch, {
        rows,
      });
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: CAPMA_AFTN_SOURCE,
        status: "ok",
        lastSuccessAt: fetchCompletedAt,
        lastError: "",
        httpStatus: response.status,
        responseBytes: text.length,
        rowCount: rows.length,
        attemptAt: claim.attemptAt,
      });
      return {
        status: "ok",
        insertedCount: result.insertedCount,
        updatedCount: result.updatedCount,
        sightingRecordedCount: sightingResult.recordedCount,
        sightingUpdatedCount: sightingResult.updatedCount,
        rowCount: rows.length,
        fetchStartedAt,
        fetchCompletedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: CAPMA_AFTN_SOURCE,
        status: "error",
        lastError: message,
        attemptAt: claim.attemptAt,
      });
      throw new Error(message);
    }
  },
});
