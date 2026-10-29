import assert from "node:assert/strict";
import test from "node:test";
import { buildForecastHistory, buildMarketHistory, priceSegments } from "../app/seoul/day/[date]/historyData.js";
import { formatDayMinute, formatSeoulTime } from "../app/seoul/day/[date]/displayTime.js";

const DATE = "2026-10-29";
const at = (time, date = DATE) => Date.parse(`${date}T${time}+09:00`);
const NOW = at("13:30:00");
const series = (points) => [{ marketId: "1", label: "30°C", temperatureC: 30, bucketKind: "exact", sortOrder: 0, points }];
const point = (time, midpoint, quoteStatus = "ok") => ({ at: at(time), midpoint, quoteStatus });
const market = (fields = {}) => ({
  stationIcao: "RKSI", date: DATE, today: DATE, configured: true, status: "ok", collectorStatus: "ok",
  source: "polymarket_gamma_clob_rest", metric: "yes_bid_ask_midpoint", samplingIntervalMinutes: 5,
  event: { eventSlug: "highest-temperature-in-seoul-on-october-29-2026", rulesVerified: true,
    url: "https://polymarket.com/event/highest-temperature-in-seoul-on-october-29-2026" },
  series: series([point("08:04:00", 0), point("13:29:00", 1)]), ...fields,
});
const forecast = (values, fields = {}) => ({
  stationIcao: "RKSI", date: DATE, today: DATE, approved: true, status: "ok", source: "kma_amo_airport",
  history: values.map(([time, highTempC]) => ({ capturedAt: at(time), highTempC, status: highTempC === null ? "error" : "ok" })),
  ...fields,
});

test("all visible Seoul clocks use AM/PM across midnight, noon and next-day chart endpoints", () => {
  assert.equal(formatSeoulTime(at("00:00:00")), "12:00 AM");
  assert.equal(formatSeoulTime(at("12:00:00")), "12:00 PM");
  assert.equal(formatSeoulTime(at("23:05:09"), { seconds: true }), "11:05:09 PM");
  assert.equal(formatDayMinute(1440, { nextDay: true }), "12:00 AM next day");
  assert.equal(formatDayMinute(780, { compact: true }), "1 PM");
  assert.equal(formatDayMinute(785), "1:05 PM");
  assert.equal(formatSeoulTime(null), "—");
});

test("market history keeps old captured values, converts cents, and exposes partial retention", () => {
  const result = buildMarketHistory(market({ truncated: true }), DATE, NOW);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.series[0].points.map((row) => row.cents), [0, 100]);
  assert.equal(result.truncated, true);
  assert.equal(result.latestAt, at("13:29:00"));
});

test("retained history survives collector errors but never approval revocation or identity mismatch", () => {
  const delayed = buildMarketHistory(market({ collectorStatus: "error" }), DATE, NOW);
  assert.equal(delayed.status, "delayed");
  assert.equal(delayed.series.length, 1);
  for (const fields of [{ configured: false }, { status: "access_approval_required" },
    { status: "retention_approval_required" }, { status: "public_approval_required" },
    { date: "2026-10-28" }, { today: "2026-10-28" }, { stationIcao: "KORD" },
    { metric: "last_trade" }, { source: "unverified" }, { event: { ...market().event, rulesVerified: false } }]) {
    const result = buildMarketHistory(market(fields), DATE, NOW);
    assert.deepEqual(result.series, [], JSON.stringify(fields));
    assert.equal(result.eventUrl, null);
  }
});

test("invalid, missing and stale samples remain gaps without last-trade fallback", () => {
  const result = buildMarketHistory(market({ series: series([
    point("08:00:00", 0.1), { ...point("08:05:00", 0.7, "one_sided"), lastTradePrice: 0.5 },
    point("08:10:00", 2), point("08:15:00", 0.4, "stale"), point("08:20:00", 0.6),
    point("14:00:00", 0.9),
  ]) }), DATE, NOW);
  assert.deepEqual(result.series[0].points.map((row) => row.cents), [10, null, null, null, 60]);
  assert.equal(priceSegments(result.series[0].points).length, 2);
});

test("chart paths stop across absent intervals and conflicting duplicate capture times", () => {
  const result = buildMarketHistory(market({ series: series([
    point("08:00:00", 0.1), point("08:05:00", 0.2), point("08:05:00", 0.3),
    point("08:10:00", 0.3), point("08:25:00", 0.4),
  ]) }), DATE, NOW);
  assert.equal(result.series[0].points[1].cents, null);
  assert.equal(priceSegments(result.series[0].points).length, 3);
});

test("archived quotes remain historical and future dates do not display prices", () => {
  const result = buildMarketHistory(market({ today: "2026-10-30" }), DATE, at("13:30:00", "2026-10-30"));
  assert.equal(result.status, "historical");
  assert.equal(result.series.length, 1);
  assert.deepEqual(buildMarketHistory(market({ date: "2026-10-30" }), "2026-10-30", NOW).series, []);
});

test("forecast changes preserve reversals and group repeated checks without changing capture times", () => {
  const result = buildForecastHistory(forecast([
    ["08:00:00", 30], ["09:00:00", 30], ["10:00:00", 31], ["11:00:00", 29], ["13:00:00", 30],
  ]), DATE, NOW);
  assert.deepEqual(result.changes.map((row) => row.highC), [30, 31, 29, 30]);
  assert.deepEqual(result.changes.map((row) => row.deltaC), [null, 1, -2, 1]);
  assert.equal(result.first.capturedAt, at("08:00:00"));
  assert.equal(result.latest.capturedAt, at("13:00:00"));
  assert.equal(result.captureCount, 5);
  assert.equal(result.deltaC, 0);
});

test("forecast gaps and truncated records never imply a complete day or a prior-day starting high", () => {
  const result = buildForecastHistory(forecast([
    ["08:00:00", 30], ["09:00:00", null], ["13:00:00", 31],
  ], { truncated: true, previousDayBaseline: { highTempC: 28, capturedAt: at("23:00:00", "2026-10-28") } }), DATE, NOW);
  assert.equal(result.deltaC, null);
  assert.equal(result.first.highC, 30);
  assert.equal(result.hasGaps, true);
  assert.equal(result.changes[1].gapBefore, true);
  assert.equal(result.truncated, true);
});

test("forecast history hides revoked or wrong-source captures and retains known values after errors", () => {
  const values = [["08:00:00", 30], ["13:00:00", null]];
  assert.equal(buildForecastHistory(forecast(values, { status: "error" }), DATE, NOW).latest.highC, 30);
  for (const fields of [{ approved: false }, { approved: "true" }, { status: "approval_required" },
    { stationIcao: "KORD" }, { date: "2026-10-28" }, { source: "weathercom" }]) {
    assert.deepEqual(buildForecastHistory(forecast(values, fields), DATE, NOW).changes, []);
  }
});

test("forecast history rejects future and other-day records and distinguishes single from repeated checks", () => {
  const input = forecast([["08:00:00", 30], ["08:05:00", 30], ["15:00:00", 31]]);
  input.history.push({ capturedAt: at("23:00:00", "2026-10-28"), highTempC: 28, status: "ok" });
  const result = buildForecastHistory(input, DATE, NOW);
  assert.equal(result.changes.length, 1);
  assert.equal(result.captureCount, 2);
  assert.equal(result.latest.capturedAt, at("08:05:00"));
  assert.equal(buildForecastHistory(forecast([["08:00:00", 30]]), DATE, NOW).captureCount, 1);
});
