import {
  internalActionGeneric, internalMutationGeneric, internalQueryGeneric, queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  SEOUL_MARKET_SOURCE, SEOUL_MARKET_FRESHNESS_MS, SEOUL_MARKET_RETENTION_MS,
  buildSeoulMarketQuotes, normalizeSeoulMarketEvent, seoulMarketDate, seoulMarketGate,
  seoulMarketSlug, seoulQuoteSnapshotStatus,
} from "./lib/seoulPolymarket.js";
import { seoulMarketSnapshotValidator } from "./lib/seoulPolymarketSchema.js";
import { buildSeoulPriceHistory, seoulHistoryDay, seoulPriceHistoryWindows } from "./lib/seoulDashboardHistory.js";

const MINUTE = 60_000;
const LEASE_MS = 90_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const GAMMA_ORIGIN = "https://gamma-api.polymarket.com";
const CLOB_ORIGIN = "https://clob.polymarket.com";

function station(value) {
  const result = String(value ?? "RKSI").trim().toUpperCase();
  if (result !== "RKSI") throw new Error("Seoul Polymarket data supports RKSI only.");
  return result;
}

function gate(publicRead = false) { return seoulMarketGate(process.env, { publicRead }); }
function assertCollection() {
  const state = gate();
  if (!state.allowed) { const error = new Error(state.status); error.code = "COLLECTION_DISABLED"; throw error; }
}
function message(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 500);
}
async function statusRow(ctx) {
  return await ctx.db.query("seoulPolymarketCollectorStatus")
    .withIndex("by_station", (q) => q.eq("stationIcao", "RKSI")).first();
}

async function fetchPublicJson(url, body) {
  assertCollection();
  const endpoint = new URL(url);
  const permitted = body === undefined
    ? endpoint.origin === GAMMA_ORIGIN && /^\/events\/slug\/highest-temperature-in-seoul-on-[a-z]+-\d{1,2}-\d{4}$/.test(endpoint.pathname)
    : endpoint.origin === CLOB_ORIGIN && ["/books", "/last-trades-prices"].includes(endpoint.pathname);
  if (!permitted || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw new Error("Unexpected Polymarket read endpoint.");
  }
  const requestedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "polypro-rksi-market-data/1.0" },
      redirect: "error", cache: "no-store", signal: controller.signal,
    });
    if (response.status === 404 && body === undefined) return { missing: true, requestedAt, receivedAt: Date.now() };
    if (!response.ok) throw new Error(`Polymarket public data returned HTTP ${response.status}.`);
    if (!String(response.headers.get("content-type") ?? "").toLowerCase().includes("json") ||
        Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw new Error("Invalid Polymarket response type or size.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Polymarket response.");
    const chunks = []; let length = 0;
    try {
      while (true) {
        assertCollection();
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) throw new Error("Polymarket response exceeded its size limit.");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    assertCollection();
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { data: JSON.parse(new TextDecoder().decode(bytes)), requestedAt, receivedAt: Date.now() };
  } finally { clearTimeout(timeout); }
}

export const queueScheduledRefresh = internalMutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    station(args.stationIcao);
    const access = gate();
    if (!access.allowed) return { queued: false, status: access.status };
    const now = Date.now();
    const current = await statusRow(ctx);
    if (Number.isFinite(current?.collectionInFlightSince) && now - current.collectionInFlightSince < LEASE_MS) {
      return { queued: false, status: "already_running" };
    }
    if (Number.isFinite(current?.collectionQueuedAt) && Math.floor(current.collectionQueuedAt / MINUTE) === Math.floor(now / MINUTE)) {
      return { queued: false, status: "cooldown" };
    }
    const runId = `RKSI:${now}`;
    const fields = { stationIcao: "RKSI", status: current?.status ?? "no_data", collectionQueuedAt: now,
      collectionInFlightSince: now, collectionRunId: runId, lastAttemptAt: now, updatedAt: now };
    if (current) await ctx.db.patch(current._id, fields);
    else await ctx.db.insert("seoulPolymarketCollectorStatus", fields);
    await ctx.scheduler.runAfter(0, internal.seoulPolymarket.collectMarket, {
      stationIcao: "RKSI", date: seoulMarketDate(now), requestedAt: now, runId,
    });
    return { queued: true, status: "queued" };
  },
});

export const getPollState = internalQueryGeneric({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    if (!gate().allowed) return null;
    const current = await statusRow(ctx);
    return current?.collectionRunId === args.runId ? current : null;
  },
});

export const finishPoll = internalMutationGeneric({
  args: { runId: v.string(), status: v.string(), lastAttemptAt: v.number(),
    error: v.optional(v.string()), snapshot: v.optional(seoulMarketSnapshotValidator) },
  handler: async (ctx, args) => {
    const access = gate();
    if (!access.allowed) return { status: access.status, stored: false };
    const current = await statusRow(ctx);
    if (current?.collectionRunId !== args.runId) return { status: "superseded", stored: false };
    const now = Date.now();
    const snapshot = args.snapshot;
    if (snapshot) {
      if (snapshot.date !== seoulMarketDate(now) || snapshot.stationIcao !== "RKSI" ||
          snapshot.source !== SEOUL_MARKET_SOURCE || snapshot.event.eventSlug !== seoulMarketSlug(snapshot.date) ||
          ![snapshot.pollSlotUtc, snapshot.polledAt, snapshot.gammaRequestedAt, snapshot.gammaReceivedAt].every(Number.isFinite) ||
          snapshot.pollSlotUtc !== Math.floor(current.collectionQueuedAt / MINUTE) ||
          snapshot.markets.length > 32 || snapshot.polledAt < current.collectionQueuedAt || snapshot.polledAt > now ||
          snapshot.gammaRequestedAt > snapshot.gammaReceivedAt || snapshot.gammaReceivedAt > snapshot.polledAt ||
          snapshot.gammaRequestedAt < current.collectionQueuedAt ||
          (snapshot.markets.length && (!snapshot.event.rulesVerified || snapshot.event.closed)) ||
          new Set(snapshot.markets.map((market) => market.marketId)).size !== snapshot.markets.length ||
          new Set(snapshot.markets.map((market) => market.yesTokenId)).size !== snapshot.markets.length) {
        throw new Error("Invalid Seoul market snapshot identity, clocks, or rules.");
      }
      for (const prefix of ["book", "lastTrade"]) {
        const started = snapshot[`${prefix}RequestedAt`], received = snapshot[`${prefix}ReceivedAt`];
        if ((started === null) !== (received === null) || (started !== null &&
            (!Number.isFinite(started) || !Number.isFinite(received) || started < snapshot.gammaReceivedAt ||
              started > received || received > snapshot.polledAt))) throw new Error("Invalid Seoul CLOB response clocks.");
      }
      const duplicate = await ctx.db.query("seoulPolymarketSnapshots")
        .withIndex("by_station_slot", (q) => q.eq("stationIcao", "RKSI").eq("pollSlotUtc", snapshot.pollSlotUtc)).first();
      if (!duplicate) await ctx.db.insert("seoulPolymarketSnapshots", { ...snapshot, firstSeenAt: now });
    }
    await ctx.db.patch(current._id, {
      status: args.status, lastAttemptAt: args.lastAttemptAt, lastError: args.error,
      ...(snapshot ? { lastSuccessAt: now } : {}),
      collectionInFlightSince: undefined, collectionRunId: undefined, updatedAt: now,
    });
    return { status: args.status, stored: Boolean(snapshot) };
  },
});

export const collectMarket = internalActionGeneric({
  args: { stationIcao: v.string(), date: v.string(), requestedAt: v.number(), runId: v.string() },
  handler: async (ctx, args) => {
    station(args.stationIcao);
    const access = gate();
    if (!access.allowed) return { status: access.status };
    const lastAttemptAt = Date.now();
    const finish = (fields) => ctx.runMutation(internal.seoulPolymarket.finishPoll,
      { runId: args.runId, lastAttemptAt, ...fields });
    try {
      if (!await ctx.runQuery(internal.seoulPolymarket.getPollState, { runId: args.runId })) return { status: "superseded" };
      if (args.date !== seoulMarketDate(lastAttemptAt) || Math.abs(lastAttemptAt - args.requestedAt) > LEASE_MS) {
        return await finish({ status: "no_data", error: "The queued market date or request time is no longer current." });
      }
      const gamma = await fetchPublicJson(`${GAMMA_ORIGIN}/events/slug/${seoulMarketSlug(args.date)}`);
      assertCollection();
      if (gamma.missing) return await finish({ status: "no_data", error: "Today's Seoul market has not been published." });
      const normalized = await normalizeSeoulMarketEvent(gamma.data, args.date);
      assertCollection();
      if (!await ctx.runQuery(internal.seoulPolymarket.getPollState, { runId: args.runId })) return { status: "superseded" };
      let books = null, trades = null, markets = [];
      if (normalized.event.rulesVerified && !normalized.event.closed) {
        const body = normalized.markets.filter((market) => market.enableOrderBook)
          .map((market) => ({ token_id: market.yesTokenId }));
        if (body.length) {
          [books, trades] = await Promise.all([
            fetchPublicJson(`${CLOB_ORIGIN}/books`, body),
            fetchPublicJson(`${CLOB_ORIGIN}/last-trades-prices`, body),
          ]);
        }
        assertCollection();
        markets = buildSeoulMarketQuotes(normalized.markets, books?.data ?? [], trades?.data ?? [], {
          bookReceivedAt: books?.receivedAt ?? null, lastTradeReceivedAt: trades?.receivedAt ?? null,
        });
      }
      const status = !normalized.event.rulesVerified ? "unsupported_rules"
        : normalized.event.closed ? "no_data" : seoulQuoteSnapshotStatus(markets);
      const snapshot = {
        stationIcao: "RKSI", date: args.date, pollSlotUtc: Math.floor(args.requestedAt / MINUTE),
        source: SEOUL_MARKET_SOURCE, polledAt: Math.max(gamma.receivedAt, books?.receivedAt ?? 0, trades?.receivedAt ?? 0),
        gammaRequestedAt: gamma.requestedAt, gammaReceivedAt: gamma.receivedAt,
        bookRequestedAt: books?.requestedAt ?? null, bookReceivedAt: books?.receivedAt ?? null,
        lastTradeRequestedAt: trades?.requestedAt ?? null, lastTradeReceivedAt: trades?.receivedAt ?? null,
        status, event: normalized.event, markets,
      };
      assertCollection();
      return await finish({ status, snapshot });
    } catch (error) {
      const currentGate = gate();
      if (!currentGate.allowed) return { status: currentGate.status };
      return await finish({ status: "error", error: message(error) });
    }
  },
});

export const getDashboard = queryGeneric({
  args: { stationIcao: v.optional(v.string()), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    station(args.stationIcao);
    const now = Date.now(), today = seoulMarketDate(now), date = args.date ?? today;
    const access = gate(true);
    const empty = { stationIcao: "RKSI", date, today, configured: access.allowed,
      source: SEOUL_MARKET_SOURCE, polledAt: null, event: null, markets: [] };
    if (!access.allowed) return { ...empty, status: access.status };
    if (date !== today) return { ...empty, status: "no_data" };
    const [collector, snapshot] = await Promise.all([
      statusRow(ctx), ctx.db.query("seoulPolymarketSnapshots")
        .withIndex("by_station_date_polled", (q) => q.eq("stationIcao", "RKSI").eq("date", date))
        .order("desc").first(),
    ]);
    if (!snapshot) return { ...empty, status: collector?.status === "error" ? "error" : "no_data" };
    const base = { ...empty, polledAt: snapshot.polledAt, event: snapshot.event };
    if (collector?.status === "error") return { ...base, status: "error" };
    if (collector?.status === "no_data" && collector.lastAttemptAt > snapshot.polledAt) return { ...base, status: "no_data" };
    if (!snapshot.event.rulesVerified) return { ...base, status: "unsupported_rules" };
    if (snapshot.event.closed) return { ...base, status: "no_data" };
    if (snapshot.polledAt > now || now - snapshot.polledAt > SEOUL_MARKET_FRESHNESS_MS) return { ...base, status: "stale" };
    const markets = snapshot.markets.map((market) => {
      const bookFresh = market.quoteStatus === "ok" && Number.isFinite(market.bookReceivedAt) &&
        Number.isFinite(market.bookTimestamp) && market.bookTimestamp <= now && market.bookReceivedAt <= now &&
        now - market.bookTimestamp <= SEOUL_MARKET_FRESHNESS_MS && now - market.bookReceivedAt <= SEOUL_MARKET_FRESHNESS_MS;
      const tradeFresh = Number.isFinite(market.lastTradeReceivedAt) && market.lastTradeReceivedAt <= now &&
        now - market.lastTradeReceivedAt <= SEOUL_MARKET_FRESHNESS_MS;
      return { ...market,
        bestBidPrice: bookFresh ? market.bestBidPrice : null, bestBidSize: bookFresh ? market.bestBidSize : null,
        bestAskPrice: bookFresh ? market.bestAskPrice : null, bestAskSize: bookFresh ? market.bestAskSize : null,
        lastTradePrice: tradeFresh ? market.lastTradePrice : null,
        quoteStatus: market.quoteStatus === "ok" && !bookFresh ? "stale" : market.quoteStatus,
      };
    });
    const status = seoulQuoteSnapshotStatus(markets);
    return { ...base, status, markets: ["ok", "partial"].includes(status) ? markets : [] };
  },
});

export const getPriceHistory = queryGeneric({
  args: { stationIcao: v.optional(v.string()), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    station(args.stationIcao);
    const now = Date.now(), today = seoulMarketDate(now), date = args.date ?? today;
    const access = gate(true);
    const empty = { stationIcao: "RKSI", date, today, configured: access.allowed,
      source: SEOUL_MARKET_SOURCE, metric: "yes_bid_ask_midpoint", timeZone: "Asia/Seoul",
      event: null, series: [], collectorStatus: "no_data", latestPolledAt: null,
      sampleCount: 0, samplingIntervalMinutes: 5, truncated: false };
    if (!access.allowed) return { ...empty, status: access.status };
    if (!seoulHistoryDay(date, now)) return { ...empty, status: "out_of_range" };
    const windows = seoulPriceHistoryWindows(date, now);
    // One latest sample per elapsed five-minute window bounds full-document
    // reads to 288 while keeping the entire KST day and explicit empty windows.
    const [collector, samples] = await Promise.all([
      statusRow(ctx), Promise.all(windows.map(async (window) => ({ ...window,
        snapshot: await ctx.db.query("seoulPolymarketSnapshots")
          .withIndex("by_station_date_polled", (q) => q.eq("stationIcao", "RKSI").eq("date", date)
            .gte("polledAt", window.start).lt("polledAt", Math.min(window.end, now + 1)))
          .order("desc").first(),
      }))),
    ]);
    return { ...empty, ...buildSeoulPriceHistory({ samples, date, now, collector }) };
  },
});

// Deletion-only housekeeping remains available after access or retention revocation.
export const pruneExpiredSnapshots = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db.query("seoulPolymarketSnapshots")
      .withIndex("by_polled", (q) => q.lt("polledAt", Date.now() - SEOUL_MARKET_RETENTION_MS)).take(256);
    for (const row of expired) await ctx.db.delete(row._id);
    return { prunedCount: expired.length };
  },
});
