import assert from "node:assert/strict";
import test from "node:test";
import { getPriceHistory } from "../convex/seoulPolymarket.js";
import { getForecastHighHistory } from "../convex/seoulDashboardHistory.js";
import {
  REVIEWED_SEOUL_RULES_HASH, SEOUL_MARKET_FLAGS, SEOUL_MARKET_SOURCE, seoulMarketSlug,
} from "../convex/lib/seoulPolymarket.js";
import {
  SEOUL_FORECAST_APPROVAL_FLAG, SEOUL_FORECAST_SOURCE, SEOUL_FORECAST_URL,
  buildSeoulForecastHighHistory, buildSeoulPriceHistory, historicalSeoulMidpoint,
  seoulHistoryDay, seoulPriceHistoryWindows,
} from "../convex/lib/seoulDashboardHistory.js";

const DATE = "2026-10-29";
const at = (time, date = DATE) => Date.parse(`${date}T${time}+09:00`);
const NOW = at("12:00:00");
const MINUTE = 60_000;

function market(fields = {}) {
  return { marketId: "123", yesTokenId: "456", label: "15°C", temperatureC: 15,
    bucketKind: "exact", sortOrder: 1, quoteStatus: "ok", bestBidPrice: "0.4", bestAskPrice: "0.6",
    bestBidSize: "12", bestAskSize: "15", bookTimestamp: at("09:59:40"), bookReceivedAt: at("09:59:50"),
    lastTradePrice: "0.9", gammaPrice: "0.8", ...fields };
}
function snapshot(fields = {}) {
  const slug = seoulMarketSlug(DATE);
  return { stationIcao: "RKSI", date: DATE, source: SEOUL_MARKET_SOURCE, polledAt: at("10:00:00"),
    status: "ok", event: { eventId: "42", eventSlug: slug, title: "Fixture Seoul market", url: `https://polymarket.com/event/${slug}`,
      rulesVerified: true, rulesFingerprint: REVIEWED_SEOUL_RULES_HASH, closed: false,
      resolutionSource: `https://aviationweather.gov/api/data/metar?ids=RKSI&format=raw&date=${DATE}T18:00:00Z&hours=30` },
    markets: [market()], ...fields };
}
function capture(time, high, fields = {}) {
  const capturedAt = at(time);
  return { stationIcao: "RKSI", source: SEOUL_FORECAST_SOURCE, sourceUrl: SEOUL_FORECAST_URL,
    capturedAt, captureDate: DATE, status: "ok", pageReportedAt: capturedAt - 2 * MINUTE,
    dailyRows: high === null ? [] : [{ date: DATE, forecastType: "short_term", maxTempC: high }], ...fields };
}

function database(tables = {}) {
  const calls = { reads: 0, limits: [] };
  const db = { query(table) {
    calls.reads += 1;
    let sortKey = "capturedAt", direction = 1;
    const conditions = [];
    const selector = Object.fromEntries(Object.entries({
      eq: (a, b) => a === b, gte: (a, b) => a >= b, lt: (a, b) => a < b,
    }).map(([name, compare]) => [name, (key, value) => { conditions.push((row) => compare(row[key], value)); return selector; }]));
    const values = () => (tables[table] ?? []).filter((row) => conditions.every((condition) => condition(row)))
      .sort((a, b) => direction * (a[sortKey] - b[sortKey]));
    const query = { withIndex(name, fn) { sortKey = name === "by_station_date_polled" ? "polledAt" : "capturedAt"; fn(selector); return query; },
      order(value) { direction = value === "desc" ? -1 : 1; return query; },
      async first() { calls.limits.push(1); return structuredClone(values()[0] ?? null); },
      async take(limit) { calls.limits.push(limit); return structuredClone(values().slice(0, limit)); } };
    return query;
  } };
  return { ctx: { db }, calls };
}

async function withEnvironment(values, callback, now = NOW) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const originalNow = Date.now;
  Date.now = () => now;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return await callback(); }
  finally {
    Date.now = originalNow;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
const approvals = () => Object.fromEntries(Object.values(SEOUL_MARKET_FLAGS).map((flag) => [flag, "true"]));

test("history calendar windows use KST, bound the day, and reject invalid/future/expired dates", () => {
  const beforeMidnight = at("23:59:59");
  const windows = seoulPriceHistoryWindows(DATE, beforeMidnight);
  assert.equal(windows.length, 288);
  assert.equal(windows[0].start, Date.parse("2026-10-28T15:00:00Z"));
  assert.equal(windows.at(-1).end, Date.parse("2026-10-29T15:00:00Z"));
  assert.equal(seoulPriceHistoryWindows(DATE, at("00:00:00")).length, 1);
  for (const date of ["bad", "2026-02-30", "2026-10-30", "2026-10-14"]) assert.equal(seoulHistoryDay(date, NOW), null);
});

test("midpoints use usable two-sided quotes at capture time, including old and zero-priced data", () => {
  const result = historicalSeoulMidpoint(market(), at("10:00:00"));
  assert.equal(result.midpoint, 0.5);
  assert.equal(result.bestBidPrice, "0.4");
  assert.equal(result.bookReceivedAt, at("09:59:50"));
  assert.equal(historicalSeoulMidpoint(market({ bestBidPrice: "0", bestAskPrice: "0" }), at("10:00:00")).midpoint, 0);
  const exact = market({ bestBidPrice: "0.60000000000000000001", bestAskPrice: "0.6" });
  assert.equal(historicalSeoulMidpoint(exact, at("10:00:00")).quoteStatus, "crossed");
  for (const fields of [
    { bestAskPrice: null }, { bestBidPrice: null }, { bestAskSize: "0" }, { bestBidSize: "-1" },
    { bestBidPrice: "0.8" }, { bestBidPrice: "NaN" }, { bestAskPrice: "1.1" }, { quoteStatus: "error" },
    { bookReceivedAt: at("10:00:01") }, { bookTimestamp: at("09:59:51") },
    { bookTimestamp: at("09:56:59") }, { bookTimestamp: null },
  ]) assert.equal(historicalSeoulMidpoint(market(fields), at("10:00:00")).midpoint, null, JSON.stringify(fields));
  assert.equal(historicalSeoulMidpoint(null, NOW).midpoint, null);
});

test("the oldest rolling-retention day reports its omitted opening hours as truncated", async () => {
  const date = "2026-10-15";
  const windows = seoulPriceHistoryWindows(date, NOW);
  assert.equal(windows[0].start, at("12:00:00", date));
  assert.equal(windows.length, 144);
  const h = database();
  await withEnvironment(approvals(), async () => {
    const result = await getPriceHistory._handler(h.ctx, { date });
    assert.equal(result.truncated, true);
    assert.equal(result.status, "no_data");
    assert.equal((await getPriceHistory._handler(h.ctx, { date: DATE })).truncated, false);
  });
});

test("sampled price history keeps historical data during collector errors and leaves missing/invalid gaps", () => {
  const samples = [
    { start: at("10:00:00"), snapshot: snapshot() },
    { start: at("10:05:00"), snapshot: null },
    { start: at("10:10:00"), snapshot: snapshot({ polledAt: at("10:10:17"), markets: [market({ bestAskPrice: null })] }) },
    { start: at("10:15:00"), snapshot: snapshot({ polledAt: at("10:15:11"), markets: [market({ bookTimestamp: at("10:15:00"), bookReceivedAt: at("10:15:05") })] }) },
  ];
  const result = buildSeoulPriceHistory({ samples, date: DATE, now: NOW, collector: { status: "error" } });
  assert.equal(result.status, "ok");
  assert.equal(result.collectorStatus, "error");
  assert.deepEqual(result.series[0].points.map((point) => point.midpoint), [0.5, null, null, 0.5]);
  assert.equal(result.series[0].points.at(-1).at, at("10:15:11"));
});

test("history cannot join different events, rules, dates, or Yes asset identities", () => {
  const good = snapshot();
  const cases = [
    { ...good, date: "2026-10-28" }, { ...good, source: "other" }, { ...good, stationIcao: "MMMX" },
    { ...good, event: { ...good.event, rulesVerified: false } },
    { ...good, event: { ...good.event, rulesFingerprint: "other" } },
    { ...good, event: { ...good.event, eventId: "99" } },
    { ...good, event: { ...good.event, eventSlug: "wrong-date" } },
    { ...good, markets: [market({ yesTokenId: "999" })] },
  ];
  for (const bad of cases) {
    const result = buildSeoulPriceHistory({ samples: [{ start: at("10:00:00"), snapshot: bad },
      { start: at("10:05:00"), snapshot: snapshot({ polledAt: at("10:05:00"), markets: [market({ bookTimestamp: at("10:04:50"), bookReceivedAt: at("10:04:55") })] }) }],
    date: DATE, now: NOW });
    assert.equal(result.series[0].points[0].midpoint, null);
    assert.equal(result.series[0].points[1].midpoint, 0.5);
  }
});

test("every market gate hides history before DB reads, including revocation with retained data", async () => {
  for (const flag of Object.values(SEOUL_MARKET_FLAGS)) {
    for (const value of [undefined, "false", "TRUE", "1", ""]) {
      const h = database({ seoulPolymarketSnapshots: [snapshot()] });
      await withEnvironment({ ...approvals(), [flag]: value }, async () => {
        const result = await getPriceHistory._handler(h.ctx, { date: DATE });
        assert.equal(result.configured, false);
        assert.equal(result.event, null);
        assert.deepEqual(result.series, []);
        assert.equal(h.calls.reads, 0);
      });
    }
  }
});

test("market query selects latest poll per window and returns no forecast or unrelated-day data", async () => {
  const h = database({ seoulPolymarketSnapshots: [snapshot(), snapshot({ polledAt: at("10:01:00"),
    markets: [market({ bestAskPrice: "0.8", bookTimestamp: at("10:00:40"), bookReceivedAt: at("10:00:50") })] }),
  snapshot({ date: "2026-10-28", polledAt: at("10:02:00") }), snapshot({ polledAt: at("12:00:01") })],
  seoulPolymarketCollectorStatus: [{ stationIcao: "RKSI", status: "error" }] });
  await withEnvironment(approvals(), async () => {
    const result = await getPriceHistory._handler(h.ctx, { date: DATE });
    assert.equal(result.sampleCount, 1);
    assert.equal(result.series[0].points.find((point) => point.midpoint !== null).at, at("10:01:00"));
    assert.ok(Math.abs(result.series[0].points.find((point) => point.midpoint !== null).midpoint - 0.6) < 1e-10);
    assert.ok(h.calls.reads <= 289);
    assert.ok(h.calls.limits.every((limit) => limit === 1));
  });
  const empty = database();
  await withEnvironment(approvals(), async () => {
    assert.equal((await getPriceHistory._handler(empty.ctx, { date: "2026-10-30" })).status, "out_of_range");
    assert.equal(empty.calls.reads, 0);
  });
});

test("forecast history compares selected-day captures and exposes a separate prior-day baseline", () => {
  const baselineAt = at("23:50:00", "2026-10-28");
  const baseline = capture("00:00:00", 21, { capturedAt: baselineAt, captureDate: "2026-10-28", pageReportedAt: baselineAt - MINUTE });
  const result = buildSeoulForecastHighHistory({ date: DATE, now: NOW, captures: [
    capture("09:30:00", 19), capture("00:05:00", 18), capture("06:00:00", 20),
    capture("05:00:00", 18), capture("10:00:00", null, { status: "error" }),
    capture("11:00:00", 99, { dailyRows: [{ date: "2026-10-30", forecastType: "short_term", maxTempC: 99 }] }),
  ], previousCaptures: [baseline] });
  assert.equal(result.first.highTempC, 18);
  assert.equal(result.latest.highTempC, 19);
  assert.equal(result.deltaC, 1);
  assert.equal(result.revisionCount, 2);
  assert.equal(result.previousDayBaseline.highTempC, 21);
  assert.deepEqual(result.history.map((point) => point.deltaC), [null, 0, 2, -1, null, null]);
  assert.equal(result.history[0].capturedAt, at("00:05:00"));
  assert.equal(result.history[0].pageReportedAt, at("00:03:00"));
  assert.equal(result.history[0].issuedAt, undefined);
});

test("forecast history retains earlier high after failure, rejects wrong sources and does not claim a full-day delta after truncation", () => {
  const result = buildSeoulForecastHighHistory({ date: DATE, now: NOW, captures: [
    capture("01:00:00", 17), capture("11:00:00", 20), capture("11:10:00", 40, { source: "other" }),
    capture("11:20:00", 41, { stationIcao: "MMMX" }), capture("11:30:00", null, { status: "error" }),
  ], previousCaptures: [], truncated: true });
  assert.equal(result.status, "error");
  assert.equal(result.latest.highTempC, 20);
  assert.equal(result.captureCount, 3);
  assert.equal(result.deltaC, null);
  assert.equal(result.revisionCount, 1);
  assert.equal(buildSeoulForecastHighHistory({ date: DATE, now: NOW, captures: [capture("01:00:00", 17)], previousCaptures: [] }).status, "stale");
});

test("forecast gate requires exact true before any retained capture or collector read", async () => {
  for (const value of [undefined, "false", "TRUE", "1", ""]) {
    const h = database({ seoulKmaForecastCaptures: [capture("11:00:00", 20)] });
    await withEnvironment({ [SEOUL_FORECAST_APPROVAL_FLAG]: value }, async () => {
      const result = await getForecastHighHistory._handler(h.ctx, { date: DATE });
      assert.equal(result.status, "approval_required");
      assert.equal(result.latest, null);
      assert.equal(result.previousDayBaseline, null);
      assert.deepEqual(result.history, []);
      assert.equal(h.calls.reads, 0);
    });
  }
});

test("forecast query uses bounded capture-date ranges and reports truncation without fabricating delta", async () => {
  const rows = Array.from({ length: 161 }, (_, index) => capture("00:00:00", 10 + index, {
    capturedAt: at("00:00:00") + index * MINUTE,
    dailyRows: [{ date: DATE, forecastType: "short_term", maxTempC: 10 + index / 10 }],
  }));
  const baselineAt = at("23:55:00", "2026-10-28");
  rows.push(capture("00:00:00", 9, { capturedAt: baselineAt, captureDate: "2026-10-28" }));
  rows.push(capture("12:00:01", 49));
  const h = database({ seoulKmaForecastCaptures: rows });
  await withEnvironment({ [SEOUL_FORECAST_APPROVAL_FLAG]: "true" }, async () => {
    const result = await getForecastHighHistory._handler(h.ctx, { date: DATE });
    assert.equal(result.truncated, true);
    assert.equal(result.captureCount, 160);
    assert.equal(result.deltaC, null);
    assert.equal(result.previousDayBaseline.highTempC, 9);
    assert.equal(result.latest.highTempC, 26);
    assert.deepEqual(h.calls.limits.sort((a, b) => a - b), [1, 161, 161]);
  });
});
