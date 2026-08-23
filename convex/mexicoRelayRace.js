import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";
import {
  CAPMA_AFTN_SOURCE,
  formatMexicoDate,
  NOAA_TEXT_SOURCE,
} from "./mexico.js";
import { capmaAftnAccessApproved } from "./mexicoCapmaApprovals.js";

const STATION_ICAO = "MMMX";
const ATTEMPT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function assertStation(stationIcao) {
  const normalized = (stationIcao ?? STATION_ICAO).trim().toUpperCase();
  if (normalized !== STATION_ICAO) {
    throw new Error("The Mexico relay race supports MMMX only.");
  }
  return normalized;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function shiftDateKey(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function settledResult(result) {
  if (result.status === "rejected") {
    return { status: "error" };
  }
  return result.value ?? { status: "error" };
}

export const recordRelayRaceAttempt = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    raceSlotUtc: v.number(),
    startedAt: v.number(),
    completedAt: v.number(),
    capmaStatus: v.string(),
    noaaStatus: v.string(),
    capmaFetchStartedAt: v.optional(v.number()),
    capmaFetchCompletedAt: v.optional(v.number()),
    noaaFetchStartedAt: v.optional(v.number()),
    noaaFetchCompletedAt: v.optional(v.number()),
    capmaRowCount: v.optional(v.number()),
    noaaRowCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mexicoRelayRaceAttempts")
      .withIndex("by_station_slot", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("raceSlotUtc", args.raceSlotUtc),
      )
      .first();
    const value = { ...args, updatedAt: args.completedAt };
    if (existing) {
      await ctx.db.patch(existing._id, value);
    } else {
      await ctx.db.insert("mexicoRelayRaceAttempts", value);
    }
    const expired = await ctx.db
      .query("mexicoRelayRaceAttempts")
      .withIndex("by_station_slot", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .lt("raceSlotUtc", args.raceSlotUtc - ATTEMPT_RETENTION_MS),
      )
      .take(100);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return { recorded: true };
  },
});

// Start both relay actions from the same parent turn. One-minute source
// cooldowns remain the request-rate boundary. The shared slot lets analysis
// classify same-poll appearances as indeterminate instead of treating HTTP
// response-time noise as publication order.
export const pollCapmaNoaaRelayRace = actionGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    const startedAt = Date.now();
    const raceSlotUtc = Math.floor(startedAt / 60_000) * 60_000;
    const settled = await Promise.allSettled([
      ctx.runAction(api.mexicoCapmaAftn.pollCapmaAftnReports, {
        stationIcao,
        raceSlotUtc,
      }),
      ctx.runAction(api.mexico.pollNoaaTextMetar, {
        stationIcao,
        raceSlotUtc,
      }),
    ]);
    const completedAt = Date.now();
    const capma = settledResult(settled[0]);
    const noaa = settledResult(settled[1]);

    // Disabled minutes do not create thousands of non-experiment rows. The
    // CAPMA collector status still exposes approval_required in production.
    if (capma.status !== "approval_required") {
      await ctx.runMutation(internal.mexicoRelayRace.recordRelayRaceAttempt, {
        stationIcao,
        date: formatMexicoDate(raceSlotUtc),
        raceSlotUtc,
        startedAt,
        completedAt,
        capmaStatus: capma.status,
        noaaStatus: noaa.status,
        ...(Number.isFinite(capma.fetchStartedAt)
          ? { capmaFetchStartedAt: capma.fetchStartedAt }
          : {}),
        ...(Number.isFinite(capma.fetchCompletedAt)
          ? { capmaFetchCompletedAt: capma.fetchCompletedAt }
          : {}),
        ...(Number.isFinite(noaa.fetchStartedAt)
          ? { noaaFetchStartedAt: noaa.fetchStartedAt }
          : {}),
        ...(Number.isFinite(noaa.fetchCompletedAt)
          ? { noaaFetchCompletedAt: noaa.fetchCompletedAt }
          : {}),
        ...(Number.isFinite(capma.rowCount)
          ? { capmaRowCount: capma.rowCount }
          : {}),
        ...(Number.isFinite(noaa.recordedCount)
          ? { noaaRowCount: noaa.recordedCount }
          : {}),
      });
    }
    return { raceSlotUtc, capma, noaa };
  },
});

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function reportIdentity(row) {
  return `${row.obsTimeUtc}:${row.typelessHash}`;
}

function summarizeComparisons(comparisons) {
  const decisive = comparisons.filter(
    (comparison) =>
      comparison.outcome === "capma" || comparison.outcome === "noaa",
  );
  const capmaWins = decisive.filter(
    (comparison) => comparison.outcome === "capma",
  ).length;
  const noaaWins = decisive.length - capmaWins;
  return {
    matchedReportCount: comparisons.length,
    decisiveReportCount: decisive.length,
    capmaWins,
    noaaWins,
    samePollCount: comparisons.filter(
      (comparison) => comparison.outcome === "same_poll",
    ).length,
    invalidPairCount: comparisons.filter(
      (comparison) => comparison.outcome === "invalid_pair",
    ).length,
    capmaWinRatePct:
      decisive.length > 0
        ? Math.round((capmaWins / decisive.length) * 1000) / 10
        : null,
    medianCapmaLeadSeconds: median(
      decisive.map((comparison) => comparison.capmaLeadSeconds),
    ),
  };
}

export function buildRelayRaceSummary({ sightings, attempts, metarRows }) {
  const attemptsBySlot = new Map(
    attempts.map((attempt) => [attempt.raceSlotUtc, attempt]),
  );
  const officialByIdentity = new Map(
    metarRows
      .filter((row) => row.typelessHash)
      .map((row) => [reportIdentity(row), row]),
  );
  const grouped = new Map();
  for (const sighting of sightings) {
    if (![CAPMA_AFTN_SOURCE, NOAA_TEXT_SOURCE].includes(sighting.source)) {
      continue;
    }
    const key = reportIdentity(sighting);
    const group = grouped.get(key) ?? {};
    const current = group[sighting.source];
    if (!current || sighting.firstSeenAt < current.firstSeenAt) {
      group[sighting.source] = sighting;
    }
    grouped.set(key, group);
  }

  let capmaOnlyCount = 0;
  let noaaOnlyCount = 0;
  const comparisons = [];
  for (const [identity, group] of grouped.entries()) {
    const capma = group[CAPMA_AFTN_SOURCE];
    const noaa = group[NOAA_TEXT_SOURCE];
    if (!capma || !noaa) {
      capmaOnlyCount += capma ? 1 : 0;
      noaaOnlyCount += noaa ? 1 : 0;
      continue;
    }
    let outcome = "invalid_pair";
    if (
      Number.isFinite(capma.raceSlotUtc) &&
      Number.isFinite(noaa.raceSlotUtc)
    ) {
      if (capma.raceSlotUtc === noaa.raceSlotUtc) {
        const attempt = attemptsBySlot.get(capma.raceSlotUtc);
        if (attempt?.capmaStatus === "ok" && attempt?.noaaStatus === "ok") {
          outcome = "same_poll";
        }
      } else {
        const earlierSlot = Math.min(capma.raceSlotUtc, noaa.raceSlotUtc);
        const attempt = attemptsBySlot.get(earlierSlot);
        if (attempt?.capmaStatus === "ok" && attempt?.noaaStatus === "ok") {
          outcome = capma.raceSlotUtc < noaa.raceSlotUtc ? "capma" : "noaa";
        }
      }
    }
    const official = officialByIdentity.get(identity);
    comparisons.push({
      obsTimeUtc: capma.obsTimeUtc,
      reportType:
        official?.reportType ??
        capma.reportTypeHint ??
        noaa.reportTypeHint ??
        null,
      isCorrection:
        official?.isCorrection ??
        capma.isCorrectionHint ??
        noaa.isCorrectionHint ??
        false,
      outcome,
      capmaFirstSeenAt: capma.firstSeenAt,
      noaaFirstSeenAt: noaa.firstSeenAt,
      capmaRaceSlotUtc: capma.raceSlotUtc ?? null,
      noaaRaceSlotUtc: noaa.raceSlotUtc ?? null,
      capmaLeadSeconds: (noaa.firstSeenAt - capma.firstSeenAt) / 1000,
      pollingSlotLeadSeconds:
        Number.isFinite(capma.raceSlotUtc) && Number.isFinite(noaa.raceSlotUtc)
          ? (noaa.raceSlotUtc - capma.raceSlotUtc) / 1000
          : null,
    });
  }
  comparisons.sort((left, right) => right.obsTimeUtc - left.obsTimeUtc);
  return {
    measurementResolutionSeconds: 60,
    samePollMeaning: "publication order unknown within the one-minute slot",
    capmaOnlyCount,
    noaaOnlyCount,
    all: summarizeComparisons(comparisons),
    metar: summarizeComparisons(
      comparisons.filter(
        (comparison) =>
          comparison.reportType === "METAR" && !comparison.isCorrection,
      ),
    ),
    speci: summarizeComparisons(
      comparisons.filter((comparison) => comparison.reportType === "SPECI"),
    ),
    corrections: summarizeComparisons(
      comparisons.filter((comparison) => comparison.isCorrection),
    ),
    recentComparisons: comparisons.slice(0, 50),
  };
}

export const getCapmaNoaaRelayRace = queryGeneric({
  args: { stationIcao: v.string(), date: v.string() },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    if (!isDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const accessApproved = capmaAftnAccessApproved();
    const statuses = await ctx.db
      .query("mexicoCollectorStatus")
      .withIndex("by_station_source", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .collect();
    const collectorStatuses = Object.fromEntries(
      statuses
        .filter((row) =>
          [CAPMA_AFTN_SOURCE, NOAA_TEXT_SOURCE].includes(row.source),
        )
        .map((row) => [row.source, row]),
    );
    if (!accessApproved) {
      return {
        status: "approval_required",
        stationIcao,
        date: args.date,
        accessApproved: false,
        collectorStatuses,
        race: null,
      };
    }
    const attemptDates = [args.date, shiftDateKey(args.date, 1)];
    const [sightings, attempts, metarRows] = await Promise.all([
      ctx.db
        .query("mexicoRelaySightings")
        .withIndex("by_station_date", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", args.date),
        )
        .collect(),
      Promise.all(
        attemptDates.map((date) =>
          ctx.db
            .query("mexicoRelayRaceAttempts")
            .withIndex("by_station_date_slot", (query) =>
              query.eq("stationIcao", stationIcao).eq("date", date),
            )
            .collect(),
        ),
      ).then((rows) => rows.flat()),
      ctx.db
        .query("mexicoMetarObservations")
        .withIndex("by_station_date_obs", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", args.date),
        )
        .collect(),
    ]);
    return {
      status: "ok",
      stationIcao,
      date: args.date,
      accessApproved: true,
      collectorStatuses,
      attemptCount: attempts.length,
      race: buildRelayRaceSummary({ sightings, attempts, metarRows }),
    };
  },
});
