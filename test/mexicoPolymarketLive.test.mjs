import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MEXICO_EDGE_QUOTE_EVENT_RETENTION_MS,
  MEXICO_EDGE_QUOTE_HEARTBEAT_RETENTION_MS,
  POLYMARKET_DATA_ACCESS_APPROVAL_FLAG,
  POLYMARKET_DATA_PUBLIC_APPROVAL_FLAG,
  POLYMARKET_DATA_RETENTION_APPROVAL_FLAG,
  assertMexicoPolymarketLastTradeProgression,
  buildMexicoPolymarketPollHeartbeat,
  buildMexicoPolymarketLiveEventSlug,
  buildMexicoPolymarketLiveGammaUrl,
  buildMexicoPolymarketQuoteFingerprint,
  compareNormalizedDecimals,
  derivePolymarketPlatformDisplay,
  deriveMexicoPolymarketDetectionInterval,
  diffMexicoPolymarketQuoteFields,
  evaluateMexicoPolymarketLiveCollection,
  evaluateMexicoPolymarketDataApprovals,
  hasSameMexicoPolymarketQuoteIdentity,
  normalizeMexicoPolymarketClobBook,
  normalizeMexicoPolymarketLastTrade,
  normalizeMexicoPolymarketLiveEvent,
  normalizePolymarketDecimal,
  validateMexicoPolymarketTokenCoverage,
} from "../convex/mexicoPolymarketLive.js";

const DATE = "2026-08-20";
const SLUG = "highest-temperature-in-mexico-city-on-august-20-2026";

function market({ id, order, label, outcomes, prices, tokens, ...overrides }) {
  return {
    id,
    slug: `${SLUG}-${id}`,
    conditionId: `condition-${id}`,
    groupItemTitle: label,
    groupItemThreshold: String(order),
    outcomes: JSON.stringify(outcomes),
    outcomePrices: JSON.stringify(prices),
    clobTokenIds: JSON.stringify(tokens),
    enableOrderBook: true,
    ...overrides,
  };
}

function eventPayload(overrides = {}) {
  return {
    events: [
      {
        id: "event-20",
        slug: SLUG,
        title: "Highest temperature in Mexico City on August 20?",
        eventDate: DATE,
        seriesSlug: "mexico-city-daily-weather",
        description: "Resolves using the airport daily observations page.",
        resolutionSource: "https://example.test/history/MMMX",
        endDate: "2026-08-21T03:59:00Z",
        updatedAt: "2026-08-20T17:00:00Z",
        active: true,
        closed: false,
        negRisk: true,
        markets: [
          market({
            id: "high",
            order: 30,
            label: "30°C or higher",
            outcomes: ["Yes", "No"],
            prices: ["0.0100", "0.9900"],
            tokens: ["yes-high", "no-high"],
          }),
          market({
            id: "low",
            order: 10,
            label: "28°C or below",
            outcomes: ["No", "Yes"],
            prices: ["0.250", "0.750"],
            tokens: ["no-low", "yes-low"],
          }),
          market({
            id: "middle",
            order: 20,
            label: "29°C",
            outcomes: ["Yes", "No"],
            prices: ["2.5e-1", "7.5e-1"],
            tokens: ["yes-middle", "no-middle"],
          }),
        ],
        ...overrides,
      },
    ],
  };
}

test("builds the series-11428 discovery request for a Mexico calendar date", () => {
  assert.equal(buildMexicoPolymarketLiveEventSlug(DATE), SLUG);
  const url = new URL(buildMexicoPolymarketLiveGammaUrl(DATE));
  assert.equal(url.origin, "https://gamma-api.polymarket.com");
  assert.equal(url.pathname, "/events/keyset");
  assert.equal(url.searchParams.get("series_id"), "11428");
  assert.equal(url.searchParams.get("event_date"), DATE);
});

test("normalizes decimal strings without rounding provider prices", () => {
  assert.equal(normalizePolymarketDecimal("0.0100", { maxOne: true }), "0.01");
  assert.equal(normalizePolymarketDecimal("2.50e-1", { maxOne: true }), "0.25");
  assert.equal(normalizePolymarketDecimal(".5000", { maxOne: true }), "0.5");
  assert.equal(normalizePolymarketDecimal("1e0", { maxOne: true }), "1");
  assert.equal(compareNormalizedDecimals("0.100", ".1"), 0);
  assert.equal(compareNormalizedDecimals("0.1001", ".1"), 1);
  assert.throws(
    () => normalizePolymarketDecimal("1.0001", { maxOne: true }),
    /cannot exceed one/,
  );
  assert.throws(() => normalizePolymarketDecimal("NaN"), /Invalid decimal/);
});

test("keeps event metadata and supports an arbitrary non-contiguous bucket count", () => {
  const normalized = normalizeMexicoPolymarketLiveEvent(eventPayload(), DATE);
  assert.equal(normalized.eventId, "event-20");
  assert.equal(
    normalized.description,
    "Resolves using the airport daily observations page.",
  );
  assert.equal(
    normalized.resolutionSource,
    "https://example.test/history/MMMX",
  );
  assert.equal(normalized.endTimeUtc, Date.parse("2026-08-21T03:59:00Z"));
  assert.equal(normalized.endTimeIso, "2026-08-21T03:59:00.000Z");
  assert.equal(normalized.negRisk, true);
  assert.equal(normalized.markets.length, 3);
  assert.deepEqual(
    normalized.markets.map((row) => row.label),
    ["28°C or below", "29°C", "30°C or higher"],
  );
  assert.deepEqual(
    normalized.markets.map((row) => row.displayOrder),
    [10, 20, 30],
  );
  assert.equal(normalized.markets[0].yesTokenId, "yes-low");
  assert.equal(normalized.markets[0].gammaOutcomePrice, "0.75");
  assert.equal(normalized.markets[1].gammaOutcomePrice, "0.25");
  assert.equal(normalized.markets[2].gammaOutcomePrice, "0.01");
});

test("rejects duplicate Yes tokens while making no fixed-11 assertion", () => {
  const duplicate = eventPayload();
  duplicate.events[0].markets[1].clobTokenIds = JSON.stringify([
    "no-low",
    "yes-high",
  ]);
  assert.throws(
    () => normalizeMexicoPolymarketLiveEvent(duplicate, DATE),
    /duplicate Yes token ids/,
  );
  const single = eventPayload({
    markets: [eventPayload().events[0].markets[0]],
  });
  assert.equal(
    normalizeMexicoPolymarketLiveEvent(single, DATE).markets.length,
    1,
  );
});

test("normalizes the exact top of book and uses midpoint for a tight spread", () => {
  const quote = normalizeMexicoPolymarketClobBook(
    {
      asset_id: "yes-middle",
      timestamp: "1755701234567",
      hash: "book-hash",
      bids: [
        { price: "0.3500", size: "4.00" },
        { price: "0.400", size: "2.50" },
      ],
      asks: [
        { price: "0.500", size: "8" },
        { price: "0.4500", size: "3.25" },
      ],
      tick_size: "0.0100",
      min_order_size: "5.000",
      neg_risk: true,
      last_trade_price: "0.43",
    },
    {
      tokenId: "yes-middle",
      gammaOutcomePrice: "0.25",
      lastTrade: { price: "0.4400", side: "BUY" },
    },
  );
  assert.equal(quote.bestBidPrice, "0.4");
  assert.equal(quote.bestBidSize, "2.5");
  assert.equal(quote.bestAskPrice, "0.45");
  assert.equal(quote.bestAskSize, "3.25");
  assert.equal(quote.midpointPrice, "0.425");
  assert.equal(quote.spreadPrice, "0.05");
  assert.equal(quote.lastTradePrice, "0.44");
  assert.equal(quote.platformDisplayPrice, "0.425");
  assert.equal(quote.platformDisplaySource, "midpoint");
  assert.equal(quote.tickSize, "0.01");
  assert.equal(quote.minOrderSize, "5");
  assert.equal(quote.bookTimestamp, 1755701234567);
  assert.equal(quote.negRisk, true);
});

test("uses last trade only when the exact spread is greater than 0.10", () => {
  assert.deepEqual(
    derivePolymarketPlatformDisplay({
      bestBidPrice: "0.4",
      bestAskPrice: "0.5",
      lastTradePrice: "0.44",
    }),
    {
      midpointPrice: "0.45",
      spreadPrice: "0.1",
      platformDisplayPrice: "0.45",
      platformDisplaySource: "midpoint",
    },
  );
  assert.deepEqual(
    derivePolymarketPlatformDisplay({
      bestBidPrice: "0.4",
      bestAskPrice: "0.5001",
      lastTradePrice: "0.44",
    }),
    {
      midpointPrice: "0.45005",
      spreadPrice: "0.1001",
      platformDisplayPrice: "0.44",
      platformDisplaySource: "last_trade",
    },
  );
});

test("falls back honestly when no two-sided CLOB book exists", () => {
  const last = normalizeMexicoPolymarketClobBook(undefined, {
    tokenId: "yes-low",
    gammaOutcomePrice: "0.75",
    lastTrade: { price: "0.72", side: "SELL" },
  });
  assert.equal(last.bookAvailable, false);
  assert.equal(last.platformDisplayPrice, "0.72");
  assert.equal(last.platformDisplaySource, "last_trade");

  const gamma = normalizeMexicoPolymarketClobBook(undefined, {
    tokenId: "yes-low",
    gammaOutcomePrice: "0.75",
  });
  assert.equal(gamma.platformDisplayPrice, "0.75");
  assert.equal(gamma.platformDisplaySource, "gamma_outcome");

  const noTradeSentinel = normalizeMexicoPolymarketClobBook(undefined, {
    tokenId: "yes-low",
    gammaOutcomePrice: "0.75",
    lastTrade: {},
  });
  assert.equal(noTradeSentinel.lastTradePrice, undefined);
  assert.equal(noTradeSentinel.platformDisplayPrice, "0.75");

  const bookWithNoTradeSentinel = normalizeMexicoPolymarketClobBook(
    {
      asset_id: "yes-low",
      bids: [{ price: "0.7", size: "2" }],
      asks: [{ price: "0.8", size: "2" }],
      last_trade_price: "0.5",
    },
    {
      tokenId: "yes-low",
      gammaOutcomePrice: "0.75",
      lastTrade: {},
    },
  );
  assert.equal(bookWithNoTradeSentinel.lastTradePrice, undefined);
  assert.equal(bookWithNoTradeSentinel.platformDisplayPrice, "0.75");
  assert.equal(bookWithNoTradeSentinel.platformDisplaySource, "midpoint");
});

test("accepts only the documented empty-side 0.5 no-trades sentinel", () => {
  assert.deepEqual(
    normalizeMexicoPolymarketLastTrade(
      { token_id: "yes-low", price: "0.5000", side: "" },
      "yes-low",
    ),
    {},
  );
  assert.deepEqual(
    normalizeMexicoPolymarketLastTrade(
      { token_id: "yes-low", price: "0.42", side: "buy" },
      "yes-low",
    ),
    { price: "0.42", side: "BUY" },
  );
  assert.throws(
    () =>
      normalizeMexicoPolymarketLastTrade(
        { token_id: "yes-low", price: "0.42", side: "" },
        "yes-low",
      ),
    /invalid no-trades sentinel/,
  );
  assert.throws(
    () =>
      normalizeMexicoPolymarketLastTrade(
        { token_id: "yes-low", price: "0.42", side: "HOLD" },
        "yes-low",
      ),
    /invalid trade side/,
  );
});

test("accepts a first trade but rejects a same-token no-trades regression", () => {
  assert.equal(
    assertMexicoPolymarketLastTradeProgression(
      { lastTradeStatus: "no_trades" },
      { lastTradeStatus: "reported", lastTradePrice: "0.42" },
    ),
    true,
  );
  assert.throws(
    () =>
      assertMexicoPolymarketLastTradeProgression(
        { lastTradeStatus: "reported", lastTradePrice: "0.42" },
        { lastTradeStatus: "no_trades" },
      ),
    /regressed from a reported trade to the no-trades sentinel/,
  );
  // Legacy current rows predate lastTradeStatus but still carry the price.
  assert.throws(
    () =>
      assertMexicoPolymarketLastTradeProgression(
        { lastTradePrice: "0.42" },
        { lastTradeStatus: "no_trades" },
      ),
    /regressed from a reported trade/,
  );
});

test("creates stable fingerprints and lists changed exact quote fields", () => {
  const initial = {
    bestBidPrice: "0.4",
    bestAskPrice: "0.45",
    platformDisplayPrice: "0.425",
    platformDisplaySource: "midpoint",
    bookAvailable: true,
  };
  const update = {
    ...initial,
    bestBidPrice: "0.41",
    platformDisplayPrice: "0.43",
  };
  assert.notEqual(
    buildMexicoPolymarketQuoteFingerprint(initial),
    buildMexicoPolymarketQuoteFingerprint(update),
  );
  assert.deepEqual(diffMexicoPolymarketQuoteFields(initial, update), [
    "bestBidPrice",
    "platformDisplayPrice",
  ]);

  const metadataOnly = {
    ...initial,
    bestBidSize: "99",
    bestAskSize: "101",
    bookTimestamp: 9_999,
    bookHash: "new-depth-only-hash",
  };
  assert.equal(
    buildMexicoPolymarketQuoteFingerprint(initial),
    buildMexicoPolymarketQuoteFingerprint(metadataOnly),
  );
  assert.deepEqual(diffMexicoPolymarketQuoteFields(initial, metadataOnly), []);
});

test("never bridges interval evidence across an event or Yes-token rollover", () => {
  const previous = {
    eventId: "event-old",
    marketId: "market-1",
    yesTokenId: "yes-old",
  };
  assert.equal(
    hasSameMexicoPolymarketQuoteIdentity(previous, { ...previous }),
    true,
  );
  assert.equal(
    hasSameMexicoPolymarketQuoteIdentity(previous, {
      ...previous,
      eventId: "event-new",
    }),
    false,
  );
  assert.equal(
    hasSameMexicoPolymarketQuoteIdentity(previous, {
      ...previous,
      yesTokenId: "yes-new",
    }),
    false,
  );
});

test("builds compact immutable heartbeat values for unchanged successful polls", () => {
  const previous = {
    quoteFingerprint: "same-fingerprint",
    receivedAt: 1_000,
    gammaReceivedAt: 950,
    bookReceivedAt: 980,
    lastTradeReceivedAt: 990,
  };
  const heartbeat = buildMexicoPolymarketPollHeartbeat({
    stationIcao: "MMMX",
    date: DATE,
    generation: "poll-2",
    trigger: "scheduled",
    quote: {
      eventId: "event-20",
      marketId: "middle",
      yesTokenId: "yes-middle",
      quoteFingerprint: "same-fingerprint",
      bestBidPrice: "0.4",
      bestBidSize: "999",
      bestAskPrice: "0.5",
      midpointPrice: "0.45",
      spreadPrice: "0.1",
      lastTradePrice: "0.44",
      lastTradeSide: "BUY",
      lastTradeStatus: "reported",
      platformDisplayPrice: "0.45",
      platformDisplaySource: "midpoint",
      bookHash: "not-copied",
      gammaReceivedAt: 1_045,
      bookFetchStartedAt: 1_050,
      bookReceivedAt: 1_080,
      lastTradeFetchStartedAt: 1_051,
      lastTradeReceivedAt: 1_070,
    },
    previous,
    fetchedAt: 1_040,
    receivedAt: 1_080,
    createdAt: 1_081,
  });
  assert.equal(heartbeat.pollGeneration, "poll-2");
  assert.equal(heartbeat.quoteChanged, false);
  assert.deepEqual(heartbeat.changedFields, []);
  assert.equal(heartbeat.previousPollReceivedAt, 1_000);
  assert.equal(heartbeat.lastTradeStatus, "reported");
  assert.equal(heartbeat.bookReceivedAt, 1_080);
  assert.equal(heartbeat.lastTradeReceivedAt, 1_070);
  assert.equal(heartbeat.previousGammaReceivedAt, 950);
  assert.equal(heartbeat.previousBookReceivedAt, 980);
  assert.equal(heartbeat.previousLastTradeReceivedAt, 990);
  assert.equal("bestBidSize" in heartbeat, false);
  assert.equal("bookHash" in heartbeat, false);
});

test("derives signal-aware bounded detection intervals", () => {
  const previous = {
    receivedAt: 1_000,
    gammaReceivedAt: 910,
    bookReceivedAt: 970,
    lastTradeReceivedAt: 990,
  };
  const current = {
    receivedAt: 1_100,
    gammaReceivedAt: 1_010,
    bookReceivedAt: 1_090,
    lastTradeReceivedAt: 1_070,
  };
  assert.deepEqual(
    deriveMexicoPolymarketDetectionInterval({
      changedFields: ["lastTradePrice", "platformDisplayPrice"],
      previous,
      current,
    }),
    {
      detectionStartAt: 990,
      detectionEndAt: 1_070,
      detectionIntervalKind: "bounded",
    },
  );
  assert.deepEqual(
    deriveMexicoPolymarketDetectionInterval({
      changedFields: ["bestBidPrice", "lastTradePrice"],
      previous,
      current,
    }),
    {
      detectionStartAt: 990,
      detectionEndAt: 1_090,
      detectionIntervalKind: "bounded",
    },
  );
  assert.deepEqual(
    deriveMexicoPolymarketDetectionInterval({
      changedFields: ["gammaOutcomePrice"],
      current,
    }),
    {
      detectionEndAt: 1_100,
      detectionIntervalKind: "left_unbounded",
    },
  );
  assert.deepEqual(
    deriveMexicoPolymarketDetectionInterval({
      changedFields: ["bestBidPrice", "lastTradePrice"],
      previous: { receivedAt: 1_000, bookReceivedAt: 970 },
      current,
    }),
    {
      detectionEndAt: 1_090,
      detectionIntervalKind: "left_unbounded",
    },
  );
});

test("an initial Gamma-only quote is left-censored without CLOB clocks", () => {
  assert.deepEqual(
    deriveMexicoPolymarketDetectionInterval({
      changedFields: ["gammaOutcomePrice", "bookAvailable"],
      previous: undefined,
      current: { receivedAt: 2_000 },
    }),
    {
      detectionEndAt: 2_000,
      detectionIntervalKind: "left_unbounded",
    },
  );
});

test("requires exact book and last-trade coverage for every requested token", () => {
  assert.equal(
    validateMexicoPolymarketTokenCoverage(
      ["yes-a", "yes-b"],
      ["yes-b", "yes-a"],
      ["yes-a", "yes-b"],
    ),
    true,
  );
  assert.throws(
    () =>
      validateMexicoPolymarketTokenCoverage(
        ["yes-a", "yes-b"],
        ["yes-a"],
        ["yes-a", "yes-b"],
      ),
    /book token coverage mismatch \(missing 1, unexpected 0\)/,
  );
  assert.throws(
    () =>
      validateMexicoPolymarketTokenCoverage(
        ["yes-a"],
        ["yes-a"],
        ["yes-a", "yes-extra"],
      ),
    /last-trade token coverage mismatch \(missing 0, unexpected 1\)/,
  );
});

test("bounds quote events and poll heartbeats to the same fourteen-day retention", () => {
  assert.equal(MEXICO_EDGE_QUOTE_EVENT_RETENTION_MS, 14 * 24 * 60 * 60 * 1000);
  assert.equal(
    MEXICO_EDGE_QUOTE_HEARTBEAT_RETENTION_MS,
    MEXICO_EDGE_QUOTE_EVENT_RETENTION_MS,
  );
});

test("the operational collection gate accepts only the exact string true", () => {
  assert.equal(evaluateMexicoPolymarketLiveCollection("true").enabled, true);
  for (const value of [undefined, "", "false", "TRUE", " true ", true]) {
    assert.deepEqual(evaluateMexicoPolymarketLiveCollection(value), {
      enabled: false,
      status: "collection_disabled",
      flagName: "POLYMARKET_MMMX_LIVE_COLLECTION_ENABLED",
    });
  }
});

test("the new heartbeat storage and public capabilities fail closed", () => {
  assert.deepEqual(
    [
      POLYMARKET_DATA_ACCESS_APPROVAL_FLAG,
      POLYMARKET_DATA_RETENTION_APPROVAL_FLAG,
      POLYMARKET_DATA_PUBLIC_APPROVAL_FLAG,
    ],
    [
      "POLYMARKET_MMMX_DATA_ACCESS_APPROVED",
      "POLYMARKET_MMMX_DATA_RETENTION_APPROVED",
      "POLYMARKET_MMMX_DATA_PUBLIC_APPROVED",
    ],
  );
  const enabled = evaluateMexicoPolymarketDataApprovals({
    access: "true",
    retention: "true",
    publicDisplay: "true",
  });
  assert.equal(enabled.storageEnabled, true);
  assert.equal(enabled.publicEnabled, true);
  assert.equal(enabled.storageStatus, "ok");
  assert.equal(enabled.publicStatus, "ok");

  for (const value of [undefined, "", "false", "TRUE", " true ", true]) {
    const accessDenied = evaluateMexicoPolymarketDataApprovals({
      access: value,
      retention: "true",
      publicDisplay: "true",
    });
    assert.equal(accessDenied.storageEnabled, false);
    assert.equal(accessDenied.publicEnabled, false);
    assert.equal(accessDenied.storageStatus, "access_approval_required");

    const retentionDenied = evaluateMexicoPolymarketDataApprovals({
      access: "true",
      retention: value,
      publicDisplay: "true",
    });
    assert.equal(retentionDenied.storageEnabled, false);
    assert.equal(retentionDenied.publicStatus, "retention_approval_required");

    const publicDenied = evaluateMexicoPolymarketDataApprovals({
      access: "true",
      retention: "true",
      publicDisplay: value,
    });
    assert.equal(publicDenied.storageEnabled, true);
    assert.equal(publicDenied.publicEnabled, false);
    assert.equal(publicDenied.publicStatus, "public_approval_required");
  }
});

test("exports REST polling, retention, and an explicit unavailable stream supervisor", async () => {
  const source = await readFile(
    new URL("../convex/mexicoPolymarketLive.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /export const refreshLiveMarket = actionGeneric/);
  assert.match(
    source,
    /export const pollScheduledLiveMarket = internalActionGeneric/,
  );
  assert.match(
    source,
    /export const runQuoteEventRetention = internalActionGeneric/,
  );
  assert.match(
    source,
    /export const pruneQuoteHeartbeatsBatch = internalMutationGeneric/,
  );
  assert.match(source, /mexicoEdgeMarketQuoteHeartbeats/);
  assert.match(source, /by_station_date_generation_market/);
  assert.match(source, /pollHeartbeats: heartbeatPage\.reverse\(\)/);
  assert.match(source, /if \(heartbeatApprovals\.storageEnabled\)/);
  assert.match(source, /heartbeatApprovals\.publicEnabled\s*\?/);
  assert.match(source, /\.take\(RETENTION_BATCH_SIZE\)/);
  assert.match(source, /batch < MAX_RETENTION_BATCHES/);
  assert.match(
    source,
    /export const superviseLiveMarketStream = internalActionGeneric/,
  );
  assert.match(source, /status: "unavailable"/);
  assert.match(source, /\$\{CLOB_BASE_URL\}\/books/);
  assert.match(source, /\$\{CLOB_BASE_URL\}\/last-trades-prices/);
  assert.match(source, /disabled before snapshot storage/);
  assert.doesNotMatch(source, /EXPECTED_MARKET_COUNT/);
});
