import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";

const STATION_ICAO = "MMMX";
const MEXICO_TIMEZONE = "America/Mexico_City";
const POLYMARKET_SERIES_ID = "11428";
const POLYMARKET_SERIES_SLUG = "mexico-city-daily-weather";
const POLYMARKET_SOURCE = "polymarket_gamma";
const POLYMARKET_PROBABILITY_SOURCE = "gamma_outcome_price";
const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events/keyset";
const EXPECTED_MARKET_COUNT = 11;
const COLLECTION_START_MINUTE = 11 * 60;
const COLLECTION_END_MINUTE = 18 * 60;
const USER_AGENT =
  "polypro-mmmx-polymarket/1.0 (Mexico City daily-high probability collector)";

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const mexicoPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MEXICO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function assertStation(stationIcao) {
  if ((stationIcao ?? STATION_ICAO).trim().toUpperCase() !== STATION_ICAO) {
    throw new Error("The Mexico Polymarket collector supports MMMX only.");
  }
  return STATION_ICAO;
}

function assertDateKey(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!match) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error("Date must be a real calendar date.");
  }
  return { date: String(date), year, month, day };
}

function parsePossiblyJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function finiteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    return null;
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredString(value, description) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Polymarket returned an invalid ${description}.`);
  }
  return value.trim();
}

function optionalPercent(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 && parsed <= 1
    ? parsed * 100
    : undefined;
}

function optionalEpoch(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

export function mexicoPolymarketLocalParts(epochMs) {
  if (!Number.isFinite(epochMs)) {
    throw new Error("A finite epoch timestamp is required.");
  }
  const values = {};
  for (const part of mexicoPartsFormatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const second = Number(values.second);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
    throw new Error("Unable to resolve Mexico City local time.");
  }
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: [
      year,
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0"),
    ].join("-"),
    dateTime:
      [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join(
        "-",
      ) +
      " " +
      [
        String(hour).padStart(2, "0"),
        String(minute).padStart(2, "0"),
        String(second).padStart(2, "0"),
      ].join(":"),
    minuteOfDay: hour * 60 + minute,
  };
}

export function isMexicoPolymarketCollectionWindow(epochMs) {
  const { minuteOfDay } = mexicoPolymarketLocalParts(epochMs);
  return (
    minuteOfDay >= COLLECTION_START_MINUTE &&
    minuteOfDay <= COLLECTION_END_MINUTE
  );
}

export function buildMexicoPolymarketEventSlug(date) {
  const { year, month, day } = assertDateKey(date);
  return `highest-temperature-in-mexico-city-on-${monthNames[month - 1]}-${day}-${year}`;
}

export function buildMexicoPolymarketGammaUrl(date) {
  assertDateKey(date);
  const url = new URL(GAMMA_EVENTS_URL);
  url.searchParams.set("series_id", POLYMARKET_SERIES_ID);
  url.searchParams.set("event_date", date);
  url.searchParams.set("limit", "5");
  return url.toString();
}

export function normalizeMexicoPolymarketEvent(payload, date) {
  assertDateKey(date);
  const events = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.events)
      ? payload.events
      : [];
  const matchingEvents = events.filter(
    (event) =>
      event &&
      event.eventDate === date &&
      event.seriesSlug === POLYMARKET_SERIES_SLUG,
  );
  if (matchingEvents.length === 0) {
    throw new Error(
      `No ${POLYMARKET_SERIES_SLUG} event was published for ${date}.`,
    );
  }
  if (matchingEvents.length !== 1) {
    throw new Error(
      `Polymarket returned multiple ${POLYMARKET_SERIES_SLUG} events for ${date}.`,
    );
  }
  const event = matchingEvents[0];
  const eventId = requiredString(event.id, "event id");
  const eventSlug = requiredString(event.slug, "event slug");
  const eventTitle = requiredString(event.title, "event title");
  if (
    !Array.isArray(event.markets) ||
    event.markets.length !== EXPECTED_MARKET_COUNT
  ) {
    throw new Error(
      `Polymarket returned ${event.markets?.length ?? 0} temperature buckets; expected ${EXPECTED_MARKET_COUNT}.`,
    );
  }
  const probabilities = event.markets.map((market, index) => {
    const outcomes = parsePossiblyJsonArray(market?.outcomes);
    const outcomePrices = parsePossiblyJsonArray(market?.outcomePrices);
    const clobTokenIds = parsePossiblyJsonArray(market?.clobTokenIds);
    if (
      outcomes.length !== 2 ||
      outcomePrices.length !== outcomes.length ||
      clobTokenIds.length !== outcomes.length ||
      !outcomes.every(
        (outcome) => typeof outcome === "string" && Boolean(outcome.trim()),
      ) ||
      !clobTokenIds.every(
        (tokenId) => typeof tokenId === "string" && Boolean(tokenId.trim()),
      )
    ) {
      throw new Error(
        `Polymarket market ${market?.id ?? index} has inconsistent outcome metadata.`,
      );
    }
    const yesIndexes = outcomes
      .map((outcome, outcomeIndex) =>
        outcome.trim().toLowerCase() === "yes" ? outcomeIndex : -1,
      )
      .filter((outcomeIndex) => outcomeIndex >= 0);
    const parsedOutcomePrices = outcomePrices.map(finiteNumber);
    if (
      yesIndexes.length !== 1 ||
      parsedOutcomePrices.some(
        (price) => price === null || price < 0 || price > 1,
      )
    ) {
      throw new Error(
        `Polymarket market ${market?.id ?? index} has invalid outcome probabilities.`,
      );
    }
    const yesIndex = yesIndexes[0];
    const yesOutcomePrice = parsedOutcomePrices[yesIndex];
    const marketId = requiredString(market?.id, "market id");
    const marketSlug = requiredString(market?.slug, "market slug");
    const conditionId = requiredString(market?.conditionId, "condition id");
    const label = requiredString(market?.groupItemTitle, "bucket label");
    const yesTokenId = requiredString(clobTokenIds[yesIndex], "Yes token id");
    const thresholdOrder = finiteNumber(market.groupItemThreshold);
    if (!Number.isInteger(thresholdOrder) || thresholdOrder < 0) {
      throw new Error(
        `Polymarket market ${marketId} has an invalid bucket order.`,
      );
    }
    const yesBestBidPct = optionalPercent(market.bestBid);
    const yesBestAskPct = optionalPercent(market.bestAsk);
    const yesLastTradePricePct = optionalPercent(market.lastTradePrice);
    return {
      marketId,
      marketSlug,
      conditionId,
      label,
      displayOrder: thresholdOrder,
      yesTokenId,
      yesOutcomePrice,
      yesProbabilityPct: yesOutcomePrice * 100,
      ...(yesBestBidPct !== undefined ? { yesBestBidPct } : {}),
      ...(yesBestAskPct !== undefined ? { yesBestAskPct } : {}),
      ...(yesLastTradePricePct !== undefined ? { yesLastTradePricePct } : {}),
    };
  });

  for (const [field, description] of [
    ["marketId", "market ids"],
    ["marketSlug", "market slugs"],
    ["conditionId", "condition ids"],
    ["yesTokenId", "Yes token ids"],
    ["label", "bucket labels"],
    ["displayOrder", "bucket orders"],
  ]) {
    const values = new Set(probabilities.map((market) => market[field]));
    if (values.size !== probabilities.length) {
      throw new Error(`Polymarket returned duplicate ${description}.`);
    }
  }
  probabilities.sort(
    (left, right) =>
      left.displayOrder - right.displayOrder ||
      left.label.localeCompare(right.label) ||
      left.marketId.localeCompare(right.marketId),
  );
  if (probabilities.some((market, index) => market.displayOrder !== index)) {
    throw new Error("Polymarket returned a non-contiguous bucket order.");
  }
  return {
    eventId,
    eventSlug,
    eventTitle,
    eventUrl: `https://polymarket.com/event/${encodeURIComponent(eventSlug)}`,
    eventActive: event.active === true,
    eventClosed: event.closed === true,
    sourceUpdatedAt: optionalEpoch(event.updatedAt),
    probabilities,
  };
}

export function mexicoPolymarketSnapshotKey(date, epochMs) {
  assertDateKey(date);
  if (!Number.isFinite(epochMs)) {
    throw new Error("A finite snapshot-slot timestamp is required.");
  }
  return `${date}:${Math.floor(epochMs / 60_000)}`;
}

export function isMexicoPolymarketCurrentAttempt(status, attemptAt) {
  return (
    Number.isFinite(status?.lastAttemptAt) && status.lastAttemptAt === attemptAt
  );
}

export function canClaimMexicoPolymarketMinute(existingAttemptAt, attemptAt) {
  if (!Number.isFinite(attemptAt)) {
    throw new Error("A finite claim timestamp is required.");
  }
  return (
    !Number.isFinite(existingAttemptAt) ||
    Math.floor(existingAttemptAt / 60_000) < Math.floor(attemptAt / 60_000)
  );
}

export const claimProbabilityMinute = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    attemptAt: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    const attemptMinute = Math.floor(args.attemptAt / 60_000);
    const existing = await ctx.db
      .query("mexicoCollectorStatus")
      .withIndex("by_station_source", (query) =>
        query.eq("stationIcao", stationIcao).eq("source", POLYMARKET_SOURCE),
      )
      .first();
    const existingMinute = existing
      ? Math.floor(existing.lastAttemptAt / 60_000)
      : null;
    if (
      existing &&
      !canClaimMexicoPolymarketMinute(existing.lastAttemptAt, args.attemptAt)
    ) {
      return {
        claimed: false,
        retryAfterAt: (existingMinute + 1) * 60_000,
      };
    }
    const value = {
      stationIcao,
      source: POLYMARKET_SOURCE,
      status: "fetching",
      lastAttemptAt: args.attemptAt,
      lastError: "",
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
    } else {
      await ctx.db.insert("mexicoCollectorStatus", value);
    }
    return { claimed: true, attemptMinute };
  },
});

export const finishProbabilityMinute = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    attemptAt: v.number(),
    status: v.union(v.literal("ok"), v.literal("error")),
    lastSuccessAt: v.optional(v.number()),
    lastError: v.string(),
    httpStatus: v.optional(v.number()),
    responseBytes: v.optional(v.number()),
    cacheControl: v.optional(v.string()),
    rowCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    const existing = await ctx.db
      .query("mexicoCollectorStatus")
      .withIndex("by_station_source", (query) =>
        query.eq("stationIcao", stationIcao).eq("source", POLYMARKET_SOURCE),
      )
      .first();
    if (!existing) {
      return { applied: false, reason: "missing_claim" };
    }
    if (!isMexicoPolymarketCurrentAttempt(existing, args.attemptAt)) {
      if (
        args.lastSuccessAt !== undefined &&
        args.lastSuccessAt > (existing.lastSuccessAt ?? 0)
      ) {
        await ctx.db.patch(existing._id, { lastSuccessAt: args.lastSuccessAt });
      }
      return { applied: false, reason: "stale_attempt" };
    }
    await ctx.db.patch(existing._id, {
      status: args.status,
      lastError: args.lastError,
      updatedAt: Date.now(),
      ...(args.lastSuccessAt !== undefined
        ? { lastSuccessAt: args.lastSuccessAt }
        : {}),
      ...(args.httpStatus !== undefined ? { httpStatus: args.httpStatus } : {}),
      ...(args.responseBytes !== undefined
        ? { responseBytes: args.responseBytes }
        : {}),
      ...(args.cacheControl !== undefined
        ? { cacheControl: args.cacheControl }
        : {}),
      ...(args.rowCount !== undefined ? { rowCount: args.rowCount } : {}),
    });
    return { applied: true };
  },
});

const probabilityValidator = v.object({
  marketId: v.string(),
  marketSlug: v.string(),
  conditionId: v.string(),
  label: v.string(),
  displayOrder: v.number(),
  yesTokenId: v.string(),
  yesOutcomePrice: v.number(),
  yesProbabilityPct: v.number(),
  yesBestBidPct: v.optional(v.number()),
  yesBestAskPct: v.optional(v.number()),
  yesLastTradePricePct: v.optional(v.number()),
});

export const storeProbabilitySnapshot = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    snapshotKey: v.string(),
    eventId: v.string(),
    eventSlug: v.string(),
    eventTitle: v.string(),
    eventUrl: v.string(),
    eventActive: v.boolean(),
    eventClosed: v.boolean(),
    sourceUpdatedAt: v.optional(v.number()),
    gammaUrl: v.string(),
    probabilitySource: v.literal("gamma_outcome_price"),
    probabilities: v.array(probabilityValidator),
    collectionTrigger: v.union(v.literal("manual"), v.literal("scheduled")),
    fetchStartedAt: v.number(),
    fetchCompletedAt: v.number(),
    capturedAt: v.number(),
    capturedAtLocal: v.string(),
    responseBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    assertDateKey(args.date);
    const existing = await ctx.db
      .query("mexicoPolymarketProbabilitySnapshots")
      .withIndex("by_station_snapshot_key", (query) =>
        query
          .eq("stationIcao", stationIcao)
          .eq("snapshotKey", args.snapshotKey),
      )
      .first();
    if (existing) {
      return { inserted: false, snapshotId: existing._id };
    }
    const snapshotId = await ctx.db.insert(
      "mexicoPolymarketProbabilitySnapshots",
      {
        ...args,
        stationIcao,
        source: POLYMARKET_SOURCE,
        createdAt: Date.now(),
      },
    );
    return { inserted: true, snapshotId };
  },
});

export const getDayProbabilities = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    assertDateKey(args.date);
    const [snapshots, collectorStatus] = await Promise.all([
      ctx.db
        .query("mexicoPolymarketProbabilitySnapshots")
        .withIndex("by_station_date_captured", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", args.date),
        )
        .collect(),
      ctx.db
        .query("mexicoCollectorStatus")
        .withIndex("by_station_source", (query) =>
          query.eq("stationIcao", stationIcao).eq("source", POLYMARKET_SOURCE),
        )
        .first(),
    ]);
    snapshots.sort((left, right) => left.capturedAt - right.capturedAt);
    const firstSnapshot = snapshots[0] ?? null;
    return {
      stationIcao,
      date: args.date,
      timezone: MEXICO_TIMEZONE,
      collectionStartMinute: COLLECTION_START_MINUTE,
      collectionEndMinute: COLLECTION_END_MINUTE,
      probabilitySource: POLYMARKET_PROBABILITY_SOURCE,
      eventSlug: firstSnapshot?.eventSlug ?? null,
      eventUrl: firstSnapshot?.eventUrl ?? null,
      collectorStatus,
      snapshots: snapshots.map((snapshot) => ({
        snapshotKey: snapshot.snapshotKey,
        capturedAt: snapshot.capturedAt,
        capturedAtLocal: snapshot.capturedAtLocal,
        probabilities: snapshot.probabilities.map((probability) => ({
          marketId: probability.marketId,
          label: probability.label,
          displayOrder: probability.displayOrder,
          yesProbabilityPct: probability.yesProbabilityPct,
          ...(probability.yesBestBidPct !== undefined
            ? { yesBestBidPct: probability.yesBestBidPct }
            : {}),
          ...(probability.yesBestAskPct !== undefined
            ? { yesBestAskPct: probability.yesBestAskPct }
            : {}),
          ...(probability.yesLastTradePricePct !== undefined
            ? { yesLastTradePricePct: probability.yesLastTradePricePct }
            : {}),
        })),
      })),
    };
  },
});

async function collectDailyHighProbabilities(ctx, args, trigger) {
  const stationIcao = assertStation(args.stationIcao);
  const fetchStartedAt = Date.now();
  const localStart = mexicoPolymarketLocalParts(fetchStartedAt);
  if (!isMexicoPolymarketCollectionWindow(fetchStartedAt)) {
    return {
      ok: true,
      status: "outside_window",
      date: localStart.date,
      localTime: localStart.dateTime,
      collectionWindow: "11:00-18:00 America/Mexico_City",
    };
  }

  const claim = await ctx.runMutation(
    internal.mexicoPolymarket.claimProbabilityMinute,
    {
      stationIcao,
      attemptAt: fetchStartedAt,
    },
  );
  if (!claim.claimed) {
    return {
      ok: true,
      status: "cooldown",
      retryAfterAt: claim.retryAfterAt,
    };
  }

  const gammaUrl = buildMexicoPolymarketGammaUrl(localStart.date);
  let httpStatus;
  try {
    const response = await fetch(gammaUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(20_000),
    });
    httpStatus = response.status;
    const responseText = await response.text();
    const responseBytes = new TextEncoder().encode(responseText).byteLength;
    if (!response.ok) {
      throw new Error(`Polymarket Gamma returned HTTP ${response.status}.`);
    }
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error("Polymarket Gamma returned malformed JSON.");
    }
    const normalized = normalizeMexicoPolymarketEvent(payload, localStart.date);
    const fetchCompletedAt = Date.now();
    const capturedAtLocal =
      mexicoPolymarketLocalParts(fetchCompletedAt).dateTime;
    const storeResult = await ctx.runMutation(
      internal.mexicoPolymarket.storeProbabilitySnapshot,
      {
        stationIcao,
        date: localStart.date,
        snapshotKey: mexicoPolymarketSnapshotKey(
          localStart.date,
          fetchStartedAt,
        ),
        ...normalized,
        gammaUrl,
        probabilitySource: POLYMARKET_PROBABILITY_SOURCE,
        collectionTrigger: trigger,
        fetchStartedAt,
        fetchCompletedAt,
        capturedAt: fetchCompletedAt,
        capturedAtLocal,
        responseBytes,
      },
    );
    await ctx.runMutation(internal.mexicoPolymarket.finishProbabilityMinute, {
      stationIcao,
      attemptAt: fetchStartedAt,
      status: "ok",
      lastSuccessAt: fetchCompletedAt,
      lastError: "",
      httpStatus: response.status,
      responseBytes,
      cacheControl: response.headers.get("cache-control") ?? "",
      rowCount: normalized.probabilities.length,
    });
    return {
      ok: true,
      status: storeResult.inserted ? "ok" : "not_modified",
      date: localStart.date,
      eventSlug: normalized.eventSlug,
      marketCount: normalized.probabilities.length,
      capturedAt: fetchCompletedAt,
    };
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 500);
    await ctx.runMutation(internal.mexicoPolymarket.finishProbabilityMinute, {
      stationIcao,
      attemptAt: fetchStartedAt,
      status: "error",
      lastError: message,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    });
    throw new Error(message);
  }
}

export const pollDailyHighProbabilities = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) =>
    collectDailyHighProbabilities(ctx, args, "manual"),
});

export const pollScheduledDailyHighProbabilities = internalActionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) =>
    collectDailyHighProbabilities(ctx, args, "scheduled"),
});
