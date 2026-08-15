import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canClaimMexicoPolymarketMinute,
  buildMexicoPolymarketEventSlug,
  buildMexicoPolymarketGammaUrl,
  isMexicoPolymarketCurrentAttempt,
  isMexicoPolymarketCollectionWindow,
  mexicoPolymarketLocalParts,
  mexicoPolymarketSnapshotKey,
  normalizeMexicoPolymarketEvent,
} from "../convex/mexicoPolymarket.js";
import {
  buildMetarReleaseMarkers,
  buildPolymarketChartPoints,
} from "../app/mexico/polymarket-chart.js";

const DATE = "2026-08-14";
const SLUG = "highest-temperature-in-mexico-city-on-august-14-2026";

function eventPayload(overrides = {}) {
  const additionalMarkets = Array.from({ length: 9 }, (_, offset) => {
    const order = offset + 2;
    const temperature = 19 + order;
    return {
      id: String(3555720 + order),
      slug: `${SLUG}-${temperature}c`,
      conditionId: `condition-${temperature}`,
      groupItemTitle:
        order === 10 ? `${temperature}°C or higher` : `${temperature}°C`,
      groupItemThreshold: String(order),
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.01","0.99"]',
      clobTokenIds: `["yes-${temperature}","no-${temperature}"]`,
    };
  });
  return {
    events: [
      {
        id: "841367",
        slug: SLUG,
        title: "Highest temperature in Mexico City on August 14?",
        eventDate: DATE,
        seriesSlug: "mexico-city-daily-weather",
        active: true,
        closed: false,
        updatedAt: "2026-08-14T18:00:05Z",
        markets: [
          {
            id: "3555721",
            slug: `${SLUG}-20c`,
            conditionId: "condition-20",
            groupItemTitle: "20°C",
            groupItemThreshold: "1",
            outcomes: '["No","Yes"]',
            outcomePrices: '["0.8","0.2"]',
            clobTokenIds: '["no-20","yes-20"]',
            bestBid: "0.18",
            bestAsk: "0.22",
            lastTradePrice: "0.21",
          },
          {
            id: "3555720",
            slug: `${SLUG}-19corbelow`,
            conditionId: "condition-low",
            groupItemTitle: "19°C or below",
            groupItemThreshold: "0",
            outcomes: ["Yes", "No"],
            outcomePrices: [0.75, 0.25],
            clobTokenIds: ["yes-low", "no-low"],
          },
          ...additionalMarkets,
        ],
        ...overrides,
      },
    ],
  };
}

test("uses the Mexico City calendar date for the recurring event slug", () => {
  assert.equal(buildMexicoPolymarketEventSlug(DATE), SLUG);
  const url = new URL(buildMexicoPolymarketGammaUrl(DATE));
  assert.equal(url.origin, "https://gamma-api.polymarket.com");
  assert.equal(url.pathname, "/events/keyset");
  assert.equal(url.searchParams.get("series_id"), "11428");
  assert.equal(url.searchParams.get("event_date"), DATE);
});

test("enforces the inclusive 11:00 through 18:00 Mexico City window", () => {
  assert.equal(
    mexicoPolymarketLocalParts(Date.parse("2026-08-14T17:00:00Z")).dateTime,
    "2026-08-14 11:00:00",
  );
  assert.equal(
    isMexicoPolymarketCollectionWindow(Date.parse("2026-08-14T16:59:59Z")),
    false,
  );
  assert.equal(
    isMexicoPolymarketCollectionWindow(Date.parse("2026-08-14T17:00:00Z")),
    true,
  );
  assert.equal(
    isMexicoPolymarketCollectionWindow(Date.parse("2026-08-15T00:00:59Z")),
    true,
  );
  assert.equal(
    isMexicoPolymarketCollectionWindow(Date.parse("2026-08-15T00:01:00Z")),
    false,
  );
});

test("normalizes dynamic buckets and maps the Yes outcome by label", () => {
  const normalized = normalizeMexicoPolymarketEvent(eventPayload(), DATE);
  assert.equal(normalized.eventId, "841367");
  assert.equal(normalized.eventSlug, SLUG);
  assert.deepEqual(
    normalized.probabilities.slice(0, 2).map((market) => market.label),
    ["19°C or below", "20°C"],
  );
  assert.equal(normalized.probabilities.length, 11);
  assert.equal(normalized.probabilities[0].yesProbabilityPct, 75);
  assert.equal(normalized.probabilities[0].yesTokenId, "yes-low");
  assert.equal(normalized.probabilities[1].yesProbabilityPct, 20);
  assert.equal(normalized.probabilities[1].yesTokenId, "yes-20");
  assert.equal(normalized.probabilities[1].yesBestBidPct, 18);
  assert.equal(normalized.probabilities[1].yesBestAskPct, 22);
  assert.equal(normalized.probabilities[1].yesLastTradePricePct, 21);
});

test("rejects missing, malformed, and out-of-range probability data", () => {
  assert.throws(
    () => normalizeMexicoPolymarketEvent({ events: [] }, DATE),
    /No mexico-city-daily-weather event/,
  );
  const malformed = eventPayload();
  malformed.events[0].markets[0].outcomePrices = '["-0.1","1.1"]';
  assert.throws(
    () => normalizeMexicoPolymarketEvent(malformed, DATE),
    /invalid outcome probabilities/,
  );

  const booleanPrices = eventPayload();
  booleanPrices.events[0].markets[0].outcomePrices = "[true,false]";
  assert.throws(
    () => normalizeMexicoPolymarketEvent(booleanPrices, DATE),
    /invalid outcome probabilities/,
  );

  const missingToken = eventPayload();
  missingToken.events[0].markets[0].clobTokenIds = '["no-20",""]';
  assert.throws(
    () => normalizeMexicoPolymarketEvent(missingToken, DATE),
    /inconsistent outcome metadata/,
  );

  const partial = eventPayload();
  partial.events[0].markets.pop();
  assert.throws(
    () => normalizeMexicoPolymarketEvent(partial, DATE),
    /10 temperature buckets; expected 11/,
  );

  const wrongIdentity = eventPayload();
  delete wrongIdentity.events[0].seriesSlug;
  assert.throws(
    () => normalizeMexicoPolymarketEvent(wrongIdentity, DATE),
    /No mexico-city-daily-weather event/,
  );

  const duplicateCondition = eventPayload();
  duplicateCondition.events[0].markets[1].conditionId =
    duplicateCondition.events[0].markets[0].conditionId;
  assert.throws(
    () => normalizeMexicoPolymarketEvent(duplicateCondition, DATE),
    /duplicate condition ids/,
  );
});

test("preserves valid zero and one endpoint probabilities", () => {
  const payload = eventPayload();
  payload.events[0].markets[0].outcomePrices = '["1","0"]';
  payload.events[0].markets[1].outcomePrices = '["1","0"]';
  const normalized = normalizeMexicoPolymarketEvent(payload, DATE);
  assert.equal(normalized.probabilities[0].yesProbabilityPct, 100);
  assert.equal(normalized.probabilities[1].yesProbabilityPct, 0);
});

test("dedupes request retries into a stable UTC minute slot", () => {
  const first = Date.parse("2026-08-14T18:12:01Z");
  const retry = Date.parse("2026-08-14T18:12:59Z");
  const next = Date.parse("2026-08-14T18:13:00Z");
  assert.equal(
    mexicoPolymarketSnapshotKey(DATE, first),
    mexicoPolymarketSnapshotKey(DATE, retry),
  );
  assert.notEqual(
    mexicoPolymarketSnapshotKey(DATE, first),
    mexicoPolymarketSnapshotKey(DATE, next),
  );
});

test("keeps adjacent claimed minutes distinct and rejects a stale status finish", () => {
  const olderAttempt = Date.parse("2026-08-14T18:12:59.900Z");
  const newerAttempt = Date.parse("2026-08-14T18:13:00.100Z");
  assert.notEqual(
    mexicoPolymarketSnapshotKey(DATE, olderAttempt),
    mexicoPolymarketSnapshotKey(DATE, newerAttempt),
  );
  assert.equal(
    isMexicoPolymarketCurrentAttempt(
      { lastAttemptAt: newerAttempt },
      newerAttempt,
    ),
    true,
  );
  assert.equal(
    isMexicoPolymarketCurrentAttempt(
      { lastAttemptAt: newerAttempt },
      olderAttempt,
    ),
    false,
  );
  assert.equal(
    canClaimMexicoPolymarketMinute(olderAttempt, olderAttempt),
    false,
  );
  assert.equal(
    canClaimMexicoPolymarketMinute(newerAttempt, olderAttempt),
    false,
  );
  assert.equal(
    canClaimMexicoPolymarketMinute(olderAttempt, newerAttempt),
    true,
  );
});

test("charts response-completion time, missing buckets, ordering, and collection gaps", () => {
  const first = Date.parse("2026-08-14T17:00:05Z");
  const snapshots = [
    {
      capturedAt: first + 3 * 60_000,
      capturedAtLocal: "2026-08-14 11:03:05",
      fetchStartedAt: first + 2 * 60_000,
      probabilities: [{ marketId: "market-a", yesProbabilityPct: 30 }],
    },
    {
      capturedAt: first,
      capturedAtLocal: "2026-08-14 11:00:05",
      fetchStartedAt: first - 55_000,
      probabilities: [{ marketId: "market-a", yesProbabilityPct: 10 }],
    },
    {
      capturedAt: first + 60_000,
      capturedAtLocal: "2026-08-14 11:01:05",
      probabilities: [],
    },
  ];
  const points = buildPolymarketChartPoints(snapshots, "market-a");
  assert.deepEqual(
    points.map((point) => point.y),
    [10, null, null, 30],
  );
  assert.equal(points[0].capturedAt, first);
  assert.equal(points[0].x, 660 + 5 / 60);
  assert.equal(points[2].sourceRole, "polymarketGap");
  assert.equal(points[3].x, 663 + 5 / 60);
});

test("builds the top METAR timeline from exact arrival timestamps", () => {
  const awcReceipt = Date.parse("2026-08-14T22:10:37.250Z");
  const firstSeenFallback = Date.parse("2026-08-14T22:50:12.500Z");
  const markers = buildMetarReleaseMarkers(
    [
      {
        reportKey: "later",
        reportType: "SPECI",
        firstSeenAt: firstSeenFallback,
      },
      {
        reportKey: "awc",
        reportType: "METAR",
        initialAwcReceiptTimeUtc: awcReceipt,
        firstSeenAt: awcReceipt + 10_000,
      },
      {
        reportKey: "outside-window",
        reportType: "METAR",
        initialAwcReceiptTimeUtc: Date.parse("2026-08-14T16:55:00Z"),
      },
      {
        reportKey: "next-day",
        reportType: "METAR",
        initialAwcReceiptTimeUtc: Date.parse("2026-08-15T22:10:00Z"),
      },
    ],
    DATE,
    660,
    1082,
  );

  assert.deepEqual(
    markers.map((marker) => marker.reportKey),
    ["awc", "later"],
  );
  assert.equal(markers[0].releaseAt, awcReceipt);
  assert.equal(markers[0].releaseSource, "awcReceipt");
  assert.equal(markers[0].x, 970 + 37.25 / 60);
  assert.equal(markers[1].releaseSource, "firstSeen");
  assert.equal(markers[1].reportType, "SPECI");
});

test("schema, cron, collector, and chart keep the same snapshot contract", async () => {
  const [schema, crons, collector, page] = await Promise.all([
    readFile(new URL("../convex/schema.js", import.meta.url), "utf8"),
    readFile(new URL("../convex/crons.js", import.meta.url), "utf8"),
    readFile(new URL("../convex/mexicoPolymarket.js", import.meta.url), "utf8"),
    readFile(
      new URL("../app/mexico/day/[date]/page.js", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(schema, /mexicoPolymarketProbabilitySnapshots: defineTable/);
  assert.match(
    schema,
    /probabilitySource: v\.literal\("gamma_outcome_price"\)/,
  );
  assert.match(crons, /mexico_polymarket_daily_high_every_minute/);
  assert.match(
    crons,
    /internal\.mexicoPolymarket\.pollScheduledDailyHighProbabilities/,
  );
  assert.match(
    collector,
    /isMexicoPolymarketCollectionWindow\(fetchStartedAt\)/,
  );
  assert.match(collector, /claimProbabilityMinute/);
  assert.match(collector, /canClaimMexicoPolymarketMinute/);
  assert.match(collector, /finishProbabilityMinute/);
  assert.match(
    collector,
    /mexicoPolymarketSnapshotKey\(\s*localStart\.date,\s*fetchStartedAt/s,
  );
  assert.match(collector, /internalActionGeneric/);
  assert.match(page, /Polymarket daily-high probabilities/);
  assert.match(page, /Source · Gamma outcomePrices\[Yes\]/);
  assert.match(page, /Probability capture audit/);
  assert.match(page, /axis: "xy"/);
  assert.match(page, /filter\(_item, index\)/);
  assert.match(page, /OFFICIAL MMMX METAR \/ SPECI ARRIVALS/);
});
