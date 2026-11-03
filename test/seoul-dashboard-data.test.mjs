import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTemperatureSeries,
  chartPeakHours,
  forecastCheckResult,
  forecastCheckStatus,
  summarizeClouds,
  summarizeForecast,
  summarizeSatelliteCloudTrend,
  summarizeSeoulMarket,
  summarizeSunlight,
  temperatureDomain,
} from "../app/seoul/day/[date]/dashboardData.js";

const solar = (state = "increasing", fields = {}) => ({
  date: DATE, today: DATE, configured: true, collectionWindowOpen: true, status: "ok",
  latest: { obsTimeUtc: at(9, 30), dsrWm2: 130.2, transmissionPct: 31 },
  trend: { state, sampleCount: 4, coverageMinutes: 30, slopePctPointsPerHour: state === "increasing" ? 12 : state === "decreasing" ? -12 : 0 },
  ...fields,
});

test("sunlight uses the measured normalized trend, not the upstream forecast", () => {
  for (const state of ["increasing", "decreasing", "steady"]) {
    const result = summarizeSunlight(solar(state, { expectedNextHour: "decreasing" }), DATE, at(9, 50), true);
    assert.equal(result.state, state);
    assert.equal(result.label, `Sunlight ${state}`);
    assert.equal(result.observedAt, at(9, 30));
    assert.equal(result.detail, "Relative to clear sky · past 30 min");
  }
});

test("sunlight hides directions when approval, daylight, dates or local freshness fail", () => {
  const now = at(9, 50);
  for (const fields of [
    { configured: false }, { collectionWindowOpen: false }, { status: "night" },
    { status: "error" }, { status: "stale" }, { status: "no_data" },
    { date: "2026-10-28" }, { today: "2026-10-28" },
    { latest: { obsTimeUtc: at(10), dsrWm2: 100, transmissionPct: 40 } },
  ]) {
    assert.equal(summarizeSunlight(solar("increasing", fields), DATE, now, true).state, "unavailable");
  }
  assert.equal(summarizeSunlight(solar(), DATE, at(10, 6), true).label, "Sunlight data delayed");
  assert.equal(summarizeSunlight(solar(), DATE, now, false).state, "unavailable");
  assert.equal(summarizeSunlight(undefined, DATE, now, true).label, "Loading sunlight…");
});

test("sunlight needs usable airport data and 30 minutes of history", () => {
  for (const trend of [
    { state: "increasing", sampleCount: 3, coverageMinutes: 20, slopePctPointsPerHour: 10 },
    { state: "increasing", sampleCount: 2, coverageMinutes: 40, slopePctPointsPerHour: 10 },
    { state: "increasing", slopePctPointsPerHour: 10 },
    { state: "unavailable", sampleCount: 4, coverageMinutes: 30, slopePctPointsPerHour: null },
  ]) {
    assert.equal(summarizeSunlight(solar("increasing", { trend }), DATE, at(9, 50), true).label, "Sunlight trend building");
  }
  assert.equal(summarizeSunlight(solar("increasing", { latest: null }), DATE, at(9, 50), true).state, "unavailable");
});

test("partial upwind coverage and a zero sunlight measurement do not hide a valid airport trend", () => {
  const result = summarizeSunlight(solar("decreasing", {
    status: "partial", latest: { obsTimeUtc: at(9, 30), dsrWm2: 0, transmissionPct: 0 },
  }), DATE, at(9, 50), true);
  assert.equal(result.state, "decreasing");
});

const DATE = "2026-10-29";
const at = (hour, minute = 0) => Date.parse(`${DATE}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`);
const satelliteClouds = (state = "clearing", fields = {}) => ({
  stationIcao: "RKSI", date: DATE, today: DATE, configured: true, collectionWindowOpen: true, status: "ok",
  latest: { obsTimeUtc: at(9, 40), reflectance: 0.32, brightnessTempK: 280, validCellCount: 24 },
  trend: { state, sampleCount: 4, coverageMinutes: 6, commonCellCount: 20 },
  ...fields,
});
const marketDashboard = (fields = {}) => ({
  stationIcao: "RKSI", date: DATE, today: DATE, configured: true, status: "ok",
  source: "polymarket_gamma_clob_rest", polledAt: at(10),
  event: { eventId: "event-1", eventSlug: "highest-temperature-in-seoul-on-october-29-2026", title: "Highest temperature in Seoul on October 29?",
    url: "https://polymarket.com/event/highest-temperature-in-seoul-on-october-29-2026", rulesVerified: true, closed: false },
  markets: [{ marketId: "market-1", label: "13°C", sortOrder: 13, bucketKind: "exact", temperatureC: 13,
    bestBidPrice: "0.42", bestBidSize: "15.125", bestAskPrice: "0.45", bestAskSize: "20.5", lastTradePrice: "0.43", gammaPrice: "0.99",
    bookReceivedAt: at(10), bookTimestamp: at(10), lastTradeReceivedAt: at(10), quoteStatus: "ok" }],
  ...fields,
});

test("Seoul market prices preserve exact cents and keep last trade separate from quotes", () => {
  const result = summarizeSeoulMarket(marketDashboard(), DATE, at(10, 1), true);
  assert.equal(result.status, "ok");
  assert.equal(result.markets[0].bidLabel, "42¢");
  assert.equal(result.markets[0].askLabel, "45¢");
  assert.equal(result.markets[0].lastLabel, "43¢");
  assert.equal(result.markets[0].bidSize, "15.125");
  assert.equal(result.markets[0].lastTradeReceivedAt, at(10));
  const precise = marketDashboard();
  Object.assign(precise.markets[0], { bestBidPrice: "0", bestAskPrice: "0.00012345", lastTradePrice: "1.000" });
  const prices = summarizeSeoulMarket(precise, DATE, at(10, 1), true).markets[0];
  assert.deepEqual([prices.bidLabel, prices.askLabel, prices.lastLabel], ["0¢", "0.012345¢", "100¢"]);
});

test("market approvals, station, source and date checks fail closed without leaking quotes or links", () => {
  for (const fields of [{ configured: false }, { configured: "true" }, { status: "disabled" },
    { status: "access_approval_required" }, { status: "retention_approval_required" }, { status: "public_approval_required" },
    { stationIcao: "MMMX" }, { source: "other" }, { date: "2026-10-28" }, { today: "2026-10-28" }]) {
    const result = summarizeSeoulMarket(marketDashboard(fields), DATE, at(10, 1), true);
    assert.deepEqual(result.markets, [], JSON.stringify(fields));
    assert.equal(result.eventUrl, null);
  }
  assert.deepEqual(summarizeSeoulMarket(marketDashboard(), DATE, at(10, 1), false).markets, []);
  assert.deepEqual(summarizeSeoulMarket(marketDashboard(), DATE, at(10, 1) + 86400_000, true).markets, []);
  assert.equal(summarizeSeoulMarket(undefined, DATE, at(10, 1), true).status, "loading");
});

test("market rules and event identity must match today before displaying prices", () => {
  for (const fields of [{ rulesVerified: false }, { rulesVerified: "true" }, { eventSlug: "highest-temperature-in-seoul-on-october-28-2026" }, { closed: true }]) {
    const input = marketDashboard();
    Object.assign(input.event, fields);
    assert.deepEqual(summarizeSeoulMarket(input, DATE, at(10, 1), true).markets, []);
  }
  for (const status of ["unsupported_rules", "error", "no_data", "stale"]) {
    assert.deepEqual(summarizeSeoulMarket(marketDashboard({ status }), DATE, at(10, 1), true).markets, []);
  }
  const badLink = marketDashboard();
  badLink.event.url = "https://polymarket.com.attacker.example/event/highest-temperature-in-seoul-on-october-29-2026";
  assert.equal(summarizeSeoulMarket(badLink, DATE, at(10, 1), true).eventUrl, null);
});

test("market quotes age out after three minutes locally and future receipt clocks are rejected", () => {
  const input = marketDashboard();
  assert.equal(summarizeSeoulMarket(input, DATE, at(10, 3), true).status, "ok");
  const delayed = summarizeSeoulMarket(input, DATE, at(10, 3) + 1, true);
  assert.equal(delayed.status, "stale");
  assert.deepEqual(delayed.markets, []);
  assert.deepEqual(summarizeSeoulMarket(marketDashboard({ polledAt: at(10, 2) }), DATE, at(10, 1), true).markets, []);
  for (const bookReceivedAt of [at(9, 55), at(10, 2), undefined]) {
    const partial = marketDashboard();
    partial.markets[0].bookReceivedAt = bookReceivedAt;
    const result = summarizeSeoulMarket(partial, DATE, at(10, 1), true);
    assert.equal(result.status, "partial");
    assert.deepEqual([result.markets[0].bidLabel, result.markets[0].askLabel, result.markets[0].lastLabel], ["—", "—", "43¢"]);
  }
  for (const bookTimestamp of [at(9, 55), at(10, 2), undefined]) {
    const cached = marketDashboard();
    cached.markets[0].bookTimestamp = bookTimestamp;
    const result = summarizeSeoulMarket(cached, DATE, at(10, 1), true);
    assert.equal(result.status, "partial");
    assert.deepEqual([result.markets[0].bidLabel, result.markets[0].askLabel, result.markets[0].lastLabel], ["—", "—", "43¢"]);
  }
});

test("crossed or unusable books never fall back to Gamma or stale last trades", () => {
  const input = marketDashboard();
  Object.assign(input.markets[0], { bestBidPrice: "0.7", bestAskPrice: "0.6" });
  const crossed = summarizeSeoulMarket(input, DATE, at(10, 1), true).markets[0];
  assert.deepEqual([crossed.bidLabel, crossed.askLabel, crossed.lastLabel], ["—", "—", "43¢"]);
  assert.equal(crossed.quoteNote, "Book unavailable");
  for (const change of [{ quoteStatus: "no_book" }, { quoteStatus: "stale" }, { bestBidPrice: "1.2", bestAskPrice: "-0.1" }, { bestBidPrice: "", bestAskPrice: "NaN" }]) {
    const unusable = marketDashboard();
    Object.assign(unusable.markets[0], change, { lastTradeReceivedAt: at(9, 55) });
    assert.deepEqual(summarizeSeoulMarket(unusable, DATE, at(10, 1), true).markets, []);
  }
});

test("market outcomes are sorted and duplicate or invalid identities cannot produce misleading rows", () => {
  const input = marketDashboard();
  input.markets.unshift({ ...input.markets[0], marketId: "market-2", label: "14°C or higher", bucketKind: "above", temperatureC: 14, sortOrder: 14 });
  assert.deepEqual(summarizeSeoulMarket(input, DATE, at(10, 1), true).markets.map(({ label }) => label), ["13°C", "14°C or higher"]);
  input.markets[0].marketId = "market-1";
  assert.deepEqual(summarizeSeoulMarket(input, DATE, at(10, 1), true).markets, []);
  const invalid = marketDashboard();
  invalid.markets[0].temperatureC = null;
  assert.deepEqual(summarizeSeoulMarket(invalid, DATE, at(10, 1), true).markets, []);
});

test("rapid satellite clouds show only supported directions without numerical sky cover", () => {
  for (const state of ["clearing", "increasing", "steady"]) {
    const result = summarizeSatelliteCloudTrend(satelliteClouds(state), DATE, at(9, 50), true);
    assert.deepEqual(result, { state, label: `Clouds ${state}`, detail: "Satellite estimate", observedAt: at(9, 40) });
  }
  const zeroReflectance = satelliteClouds("steady");
  zeroReflectance.latest.reflectance = 0;
  assert.equal(summarizeSatelliteCloudTrend(zeroReflectance, DATE, at(9, 50), true).state, "steady");
});

test("rapid clouds fail closed for wrong station, date, approval and operational status", () => {
  const now = at(9, 50);
  for (const fields of [
    { configured: false }, { configured: "true" }, { configured: undefined },
    { stationIcao: "RKSS" }, { stationIcao: undefined },
    { date: "2026-10-28" }, { today: "2026-10-28" },
    { status: "disabled" }, { status: "error" }, { status: "no_data" }, { status: "partial" },
    { collectionWindowOpen: undefined },
  ]) {
    const result = summarizeSatelliteCloudTrend(satelliteClouds("clearing", fields), DATE, now, true);
    assert.equal(result.state, "unavailable", JSON.stringify(fields));
    assert.equal(result.observedAt, null);
  }
  assert.equal(summarizeSatelliteCloudTrend(satelliteClouds(), DATE, now, false).state, "unavailable");
  assert.equal(summarizeSatelliteCloudTrend(satelliteClouds(), DATE, now + 86400_000, true).state, "unavailable");
  assert.equal(summarizeSatelliteCloudTrend(undefined, DATE, now, true).label, "Loading cloud trend…");
  assert.equal(summarizeSatelliteCloudTrend(satelliteClouds(), DATE, null, true).state, "unavailable");
});

test("rapid clouds expire locally after twelve minutes even when the query has not changed", () => {
  const snapshot = satelliteClouds();
  assert.equal(summarizeSatelliteCloudTrend(snapshot, DATE, at(9, 52), true).state, "clearing");
  const expired = summarizeSatelliteCloudTrend(snapshot, DATE, at(9, 52) + 1, true);
  assert.equal(expired.label, "Cloud data delayed");
  assert.equal(expired.state, "unavailable");
  assert.equal(expired.observedAt, null);
  assert.equal(summarizeSatelliteCloudTrend(satelliteClouds("clearing", { status: "stale" }), DATE, at(9, 41), true).label, "Cloud data delayed");
});

test("night and low sun pause rapid cloud direction without a stale daytime arrow", () => {
  for (const fields of [{ status: "night" }, { collectionWindowOpen: false }]) {
    const result = summarizeSatelliteCloudTrend(satelliteClouds("clearing", fields), DATE, at(9, 50), true);
    assert.equal(result.label, "Cloud trend paused");
    assert.equal(result.state, "unavailable");
    assert.equal(result.observedAt, null);
  }
});

test("rapid cloud directions require valid paired satellite data and common cells", () => {
  const latest = satelliteClouds().latest;
  for (const badLatest of [null, { ...latest, obsTimeUtc: at(9, 51) }, { ...latest, obsTimeUtc: 1e30 },
    { ...latest, reflectance: null }, { ...latest, reflectance: NaN },
    { ...latest, brightnessTempK: undefined }, { ...latest, validCellCount: 19 }]) {
    assert.equal(summarizeSatelliteCloudTrend(satelliteClouds("clearing", { latest: badLatest }), DATE, at(9, 50), true).state, "unavailable");
  }
  const trend = satelliteClouds().trend;
  for (const badTrend of [null, { ...trend, sampleCount: 3 }, { ...trend, coverageMinutes: 5.99 },
    { ...trend, commonCellCount: 19 }, { ...trend, commonCellCount: undefined }, { ...trend, state: "unavailable" }]) {
    const result = summarizeSatelliteCloudTrend(satelliteClouds("clearing", { trend: badTrend }), DATE, at(9, 50), true);
    assert.equal(result.label, "Cloud trend building");
    assert.equal(result.state, "unavailable");
  }
});

test("uncorroborated satellite trends remain neutral and building status cannot expose a direction", () => {
  const uncertain = summarizeSatelliteCloudTrend(satelliteClouds("uncertain"), DATE, at(9, 50), true);
  assert.equal(uncertain.label, "Cloud trend uncertain");
  assert.equal(uncertain.state, "unavailable");
  assert.equal(uncertain.observedAt, at(9, 40));
  const building = summarizeSatelliteCloudTrend(satelliteClouds("clearing", { status: "building" }), DATE, at(9, 50), true);
  assert.equal(building.label, "Cloud trend building");
  assert.equal(building.state, "unavailable");
  const firstCollection = summarizeSatelliteCloudTrend(satelliteClouds("unavailable", { status: "building", latest: null }), DATE, at(9, 50), true);
  assert.equal(firstCollection.label, "Cloud trend building");
  assert.equal(firstCollection.state, "unavailable");
  assert.equal(firstCollection.observedAt, null);
});

const amos = (hour, tempC, fields = {}) => ({
  stationIcao: "RKSI", date: DATE, obsTimeUtc: at(hour), tempC, rwyNo: "2", rwyDir: "15L", collectionCadence: "one_minute", ...fields,
});
const metar = (hour, tempC, cloud = "SCT020", fields = {}) => ({
  stationIcao: "RKSI", date: DATE, obsTimeUtc: at(hour), tempC, reportType: "METAR",
  rawMetar: `RKSI 290000Z 10005KT 9999 ${cloud} 10/02 Q1022 NOSIG`, ...fields,
});
const forecast = (rows, fields = {}) => ({
  kmaAccess: { approved: true, status: "approved" },
  kmaForecast: {
    status: "ok", isStale: false, staleAfterMinutes: 360,
    latestCapture: {
      source: "kma_amo_airport", status: "ok", capturedAt: at(8),
      dailyRows: [{ date: DATE, maxTempC: 14 }],
      hourlyRows: rows.map(([hour, tempC]) => ({ date: DATE, forecastTimeUtc: at(hour), tempC })),
    },
  },
  ...fields,
});

test("temperature points prefer one-minute representative AMOS without inventing first receipt", () => {
  const day = {
    amosRows: [
      amos(9, 12.5, { firstSeenAt: at(9) + 14_500 }),
      amos(9, 13, { collectionCadence: "five_minute", updatedAt: at(10) }),
      amos(10, 12.8, { collectionCadence: "five_minute" }),
      amos(11, 13.1, { collectionCadence: undefined }),
      amos(12, 30, { rwyNo: "3", rwyDir: "16L" }),
      amos(8, NaN),
      amos(7, 10, { obsTimeUtc: Date.parse("2026-10-28T23:00:00+09:00") }),
    ], rows: [],
  };
  const result = buildTemperatureSeries(day, DATE);
  assert.deepEqual(result.amos.map(({ tempC }) => tempC), [12.5, 12.8, 13.1]);
  assert.equal(result.amos[0].minute, 540);
  assert.equal(result.amos[0].firstSeenAt, at(9) + 14_500);
  assert.equal(result.amos[1].firstSeenAt, null);
  assert.equal(result.latestAmos.time, at(11));
  assert.equal(result.officialHigh, null);
});

test("official high is routine METAR only, accepts unlabeled RKSI and applies corrections", () => {
  const day = { amosRows: [amos(12, 30)], rows: [
    metar(9, 15, "SCT020", { updatedAt: 1 }),
    metar(9, 12, "SCT020", { updatedAt: 2, rawMetar: "METAR RKSI 290000Z COR 10005KT 9999 SCT020 12/02 Q1022" }),
    metar(10, 25, "SCT020", { reportType: "SPECI" }),
    metar(11, 24, "SCT020", { rawMetar: "SPECI RKSI 290200Z 10005KT 9999 SCT020 24/02 Q1022" }),
    metar(12, 13, "SCT020", { reportType: undefined }),
    metar(13, 13),
  ] };
  const result = buildTemperatureSeries(day, DATE);
  assert.deepEqual(result.metar.map(({ tempC }) => tempC), [12, 13, 13]);
  assert.deepEqual(result.officialHigh, { tempC: 13, time: at(12) });
});

test("temperature date filtering uses actual KST observation time and validates local fallback", () => {
  const result = buildTemperatureSeries({ rows: [
    metar(0, 8),
    metar(1, 30, "SCT020", { obsTimeUtc: at(0) - 1 }),
    metar(2, 31, "SCT020", { obsTimeUtc: 1e30 }),
  ], amosRows: [
    amos(1, 8.2, { obsTimeUtc: undefined, obsTimeLocal: `${DATE} 01:00:00` }),
    amos(2, 99, { obsTimeUtc: undefined, obsTimeLocal: `${DATE} 25:00:00` }),
  ] }, DATE);
  assert.deepEqual(result.officialHigh, { tempC: 8, time: at(0) });
  assert.equal(result.amos.length, 1);
  assert.equal(result.amos[0].time, at(1));
  assert.deepEqual(buildTemperatureSeries(undefined, DATE), { amos: [], metar: [], latestAmos: null, officialHigh: null });
});

test("forecast preserves daily published high and every separate tied peak window", () => {
  const result = summarizeForecast(forecast([[10, 12], [12, 13], [13, 13], [14, 12], [16, 13], [18, 13], [19, 13]]), DATE, at(9));
  assert.equal(result.highC, 14);
  assert.equal(result.hourlyPeakC, 13);
  assert.deepEqual(result.peakWindows, [
    { startHour: 12, endHour: 13 },
    { startHour: 16, endHour: 16 },
    { startHour: 18, endHour: 19 },
  ]);
  assert.equal(result.status, "ok");
  assert.equal(result.capturedAt, at(8));
});

test("forecast peak ties are exact and missing intervening hours are not bridged", () => {
  const result = summarizeForecast(forecast([[13, 12.9], [14, 12.899], [15, 12.9], [17, 12.9]]), DATE, at(9));
  assert.deepEqual(result.peakWindows, [13, 15, 17].map((hour) => ({ startHour: hour, endHour: hour })));
});

test("the forecast check button says what happened and when it can run again", () => {
  const idle = forecastCheckStatus(null, at(10), at(11));
  assert.deepEqual(idle, { disabled: false, label: "Check KMA now", message: "" });
  assert.deepEqual(forecastCheckStatus({ kind: "sending" }, at(10), at(11)), { disabled: true, label: "Checking…", message: "" });

  // Too soon: the wait is rounded, never to zero, and the button returns when it is over.
  const waiting = forecastCheckResult({ status: "cooldown", retryAfterSeconds: 250 }, at(11));
  assert.deepEqual(forecastCheckStatus(waiting, at(10), at(11)), { disabled: true, label: "Next check in 4 min", message: "KMA allows one check every 10 minutes, including scheduled ones." });
  assert.equal(forecastCheckStatus(waiting, at(10), at(11) + 240_000).label, "Next check in 1 min");
  assert.deepEqual(forecastCheckStatus(waiting, at(10), at(11) + 251_000), idle);

  // Accepted: it waits for a capture newer than the request, and says so if none comes.
  const checking = forecastCheckResult({ status: "queued", requestedAt: at(11), cooldownSeconds: 600 }, at(11) + 500);
  const during = forecastCheckStatus(checking, at(10), at(11) + 30_000);
  assert.deepEqual([during.disabled, during.label, during.message], [true, "Next check in 10 min", "Checking KMA…"]);
  assert.match(forecastCheckStatus(checking, at(11) + 40_000, at(11) + 60_000).message, /^Captured at /);
  assert.match(forecastCheckStatus(checking, at(10), at(11) + 3 * 60_000).message, /No new capture arrived/);
  assert.equal(forecastCheckStatus(checking, at(11) + 40_000, at(11) + 11 * 60_000).disabled, false);

  assert.match(forecastCheckStatus(forecastCheckResult({ status: "already_running" }, at(11)), at(10), at(11)).message, /already running/);
  assert.match(forecastCheckStatus(forecastCheckResult({ status: "approval_required" }, at(11)), at(10), at(11)).message, /approval is required/);
  assert.match(forecastCheckStatus(forecastCheckResult(null, at(11)), at(10), at(11)).message, /could not be requested/);
});

test("the chart marks the latest forecast's peak hours while the table still lists earlier hours", () => {
  const morning = summarizeForecast(forecast([[11, 14], [12, 15], [13, 16], [14, 16], [15, 16], [16, 16], [17, 15]]), DATE, at(10));
  assert.deepEqual(chartPeakHours(morning, [14, 15]), { windows: [{ startHour: 13, endHour: 16 }], label: "1–4 PM", fromLock: false });
  const ties = summarizeForecast(forecast([[10, 12], [12, 13], [14, 12], [16, 13]]), DATE, at(9));
  assert.deepEqual(chartPeakHours(ties, null), { windows: [{ startHour: 12, endHour: 12 }, { startHour: 16, endHour: 16 }], label: "12 PM · 4 PM", fromLock: false });
});

test("the chart falls back to the 9 AM lock once peak hours leave KMA's table, and marks nothing without one", () => {
  // At 2 PM the table starts at 3 PM, so its peak is cut off and would shrink to 3–4 PM.
  const shrinking = summarizeForecast(forecast([[15, 16], [16, 16], [17, 15]]), DATE, at(14));
  assert.deepEqual(chartPeakHours(shrinking, [13, 14, 15, 16]), { windows: [{ startHour: 13, endHour: 16 }], label: "1–4 PM", fromLock: true });
  assert.equal(chartPeakHours(shrinking, null), null);
  assert.equal(chartPeakHours(shrinking, []), null);
  // In the evening the remaining hours' high is not the day's peak.
  const evening = summarizeForecast(forecast([[20, 13], [21, 12]]), DATE, at(19));
  assert.deepEqual(chartPeakHours(evening, [13, 15]), { windows: [{ startHour: 13, endHour: 13 }, { startHour: 15, endHour: 15 }], label: "1 PM · 3 PM", fromLock: true });
  assert.equal(chartPeakHours(summarizeForecast(undefined, DATE, at(9)), undefined), null);
});

test("the temperature axis ticks every whole degree around the day's values", () => {
  const rows = (...values) => values.map((tempC) => ({ tempC }));
  const day = temperatureDomain([rows(6.2, 13.8), rows(16)]);
  assert.deepEqual([day.low, day.high], [5, 18]);
  assert.deepEqual(day.ticks, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(temperatureDomain([rows(-2.5, 1)]).ticks, [-4, -3, -2, -1, 0, 1, 2]);
  assert.deepEqual(temperatureDomain([rows(10)]).ticks, [9, 10, 11]);
  assert.deepEqual(temperatureDomain([[], []]).ticks, [0, 10, 20, 30]);
});

test("forecast fails closed without approval and never uses observed highs or Weather.com aliases", () => {
  const input = forecast([[13, 13]], { summary: { maxTempC: 30 } });
  assert.equal(summarizeForecast(input, DATE, at(9)).highC, 14);
  for (const approval of [false, undefined, "true"]) {
    const result = summarizeForecast({ ...input, kmaAccess: { approved: approval } }, DATE, at(9));
    assert.equal(result.status, "approval_required");
    assert.equal(result.highC, null);
    assert.deepEqual(result.hourly, []);
  }
  const legacy = { kmaAccess: { approved: true }, latestForecastCapture: input.kmaForecast.latestCapture, summary: { maxTempC: 30 } };
  assert.equal(summarizeForecast(legacy, DATE, at(9)).status, "no_data");
  const wrongSource = forecast([[13, 13]]);
  wrongSource.kmaForecast.latestCapture.source = "weathercom";
  assert.equal(summarizeForecast(wrongSource, DATE, at(9)).highC, null);
});

test("forecast distinguishes old live data, historical captures, failures and loading", () => {
  const input = forecast([[13, 13]]);
  assert.equal(summarizeForecast(input, DATE, at(15)).status, "stale");
  assert.equal(summarizeForecast(input, DATE, at(9) + 24 * 60 * 60_000).status, "historical");
  input.kmaForecast.latestAttemptStatus = "error";
  const result = summarizeForecast(input, DATE, at(9));
  assert.equal(result.status, "error");
  assert.equal(result.highC, 14); // The retained successful forecast remains separately labeled.
  assert.equal(summarizeForecast(undefined, DATE, at(9)).status, "loading");
});

test("forecast never infers a missing daily high from hourly values and excludes other dates", () => {
  const input = forecast([[13, 13]]);
  input.kmaForecast.latestCapture.dailyRows = [{ date: "2026-10-30", maxTempC: 30 }];
  input.kmaForecast.latestCapture.hourlyRows.push({ date: "2026-10-30", forecastTimeUtc: at(0) + 24 * 60 * 60_000, tempC: 50 });
  const result = summarizeForecast(input, DATE, at(9));
  assert.equal(result.highC, null);
  assert.equal(result.hourlyPeakC, 13);
  assert.equal(result.hourly.length, 1);
});

test("cloud trend compares only recent explicit observations and includes SPECI", () => {
  const result = summarizeClouds([
    metar(10, 12, "BKN020"),
    metar(10, 12, "SCT020", { obsTimeUtc: at(10, 30), reportType: "SPECI" }),
  ], DATE, at(10, 35), true);
  assert.equal(result.label, "Scattered clouds");
  assert.deepEqual([result.coverageMin, result.coverageMax], [3, 4]);
  assert.equal(result.trend, "clearing");
  assert.equal(result.observedAt, at(10, 30));
  const increasing = summarizeClouds([
    metar(10, 12, "SKC"), metar(10, 12, "FEW020", { obsTimeUtc: at(10, 30) }),
  ], DATE, at(10, 35), true);
  assert.equal(increasing.trend, "increasing");
});

test("CAVOK, NSC, NCD, CLR and obscured sky do not imply numerical total cloud cover", () => {
  for (const cloud of ["CAVOK", "NSC", "NCD", "CLR", "VV003"]) {
    const result = summarizeClouds([
      metar(10, 12, "BKN020"), metar(10, 12, cloud, { obsTimeUtc: at(10, 30) }),
    ], DATE, at(10, 35), true);
    assert.equal(result.coverageMin, null, cloud);
    assert.equal(result.coverageMax, null, cloud);
    assert.equal(result.trend, "unknown", cloud);
  }
});

test("cloud parser ignores forecasts and remarks after the observed part", () => {
  const result = summarizeClouds([metar(10, 12, "FEW020", {
    rawMetar: "RKSI 290100Z 10005KT 9999 FEW020 12/02 Q1022 TEMPO BKN010 RMK OVC020",
  })], DATE, at(10, 10), true);
  assert.equal(result.label, "Few clouds");
  assert.deepEqual([result.coverageMin, result.coverageMax], [1, 2]);
});

test("multiple layers produce overlap bounds rather than a false exact total or trend", () => {
  const result = summarizeClouds([
    metar(10, 12, "FEW020 SCT060"),
    metar(10, 12, "BKN040", { obsTimeUtc: at(10, 30) }),
  ], DATE, at(10, 35), true);
  assert.deepEqual([result.coverageMin, result.coverageMax], [5, 7]);
  assert.equal(result.trend, "unknown"); // Previous combined range 3–6 overlaps 5–7.
  const combined = summarizeClouds([metar(10, 12, "FEW020 BKN100")], DATE, at(10, 10), true);
  assert.deepEqual([combined.coverageMin, combined.coverageMax], [5, 8]);
});

test("unchanged reported categories are steady without claiming sub-category precision", () => {
  const result = summarizeClouds([
    metar(10, 12, "SCT020"), metar(10, 12, "SCT030", { obsTimeUtc: at(10, 30) }),
  ], DATE, at(10, 35), true);
  assert.equal(result.trend, "steady");
  assert.match(result.trendDetail, /category unchanged/);
});

test("stale, historical and missing intervening cloud observations cannot claim a live trend", () => {
  const rows = [metar(10, 12, "BKN020"), metar(10, 12, "SCT020", { obsTimeUtc: at(10, 30) })];
  assert.equal(summarizeClouds(rows, DATE, at(11, 30), true).stale, true);
  assert.equal(summarizeClouds(rows, DATE, at(11, 30), true).trend, "unknown");
  assert.equal(summarizeClouds(rows, DATE, at(10, 50), true).trend, "unknown"); // Previous report older than 45 minutes.
  const historical = summarizeClouds(rows, DATE, at(11) + 24 * 60 * 60_000, false);
  assert.equal(historical.stale, false);
  assert.equal(historical.trend, "unknown");
  assert.match(historical.detail, /Last report for this date/);
  const interrupted = summarizeClouds([
    metar(10, 12, "OVC020"), metar(10, 12, "CAVOK", { obsTimeUtc: at(10, 15) }), metar(10, 12, "SCT020", { obsTimeUtc: at(10, 30) }),
  ], DATE, at(10, 35), true);
  assert.equal(interrupted.trend, "unknown");
});

test("clouds use corrected latest report and ignore future observations", () => {
  const result = summarizeClouds([
    metar(10, 12, "OVC020", { updatedAt: 1 }),
    metar(10, 12, "FEW020", { updatedAt: 2 }),
    metar(11, 12, "OVC020"),
  ], DATE, at(10, 10), true);
  assert.equal(result.label, "Few clouds");
  assert.equal(result.observedAt, at(10));
  assert.equal(summarizeClouds([], DATE, at(10), true).observedAt, null);
});
