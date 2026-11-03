import assert from "node:assert/strict";
import test from "node:test";
import { buildForecastProviders, buildMarketHistory, priceSegments } from "../app/seoul/day/[date]/historyData.js";
import { formatDayMinute, formatSeoulDateTime, formatSeoulTime } from "../app/seoul/day/[date]/displayTime.js";

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
const provider = (changes, fields = {}) => ({
  id: "weathercom", label: "Weather.com", sourceUrl: "https://weather.com/kr/incheon/airport/incheon-international-airport/tenday",
  access: "approved", status: "ok", lastCheckAt: NOW - 60_000, truncated: false,
  location: { name: "Incheon International Airport", icaoCode: "RKSI", distanceKm: 1.3, verifiedAt: NOW - 60_000 },
  changes: changes.map(([highC, firstSeenAt, lastSeenAt = firstSeenAt]) => ({ highC, firstSeenAt, lastSeenAt })), ...fields,
});
const forecastProviders = (row, date = DATE, now = NOW) => buildForecastProviders({ stationIcao: "RKSI", date, providers: [row] }, date, now).providers[0];

test("all visible Seoul clocks use AM/PM across midnight, noon and next-day chart endpoints", () => {
  assert.equal(formatSeoulTime(at("00:00:00")), "12:00 AM");
  assert.equal(formatSeoulTime(at("12:00:00")), "12:00 PM");
  assert.equal(formatSeoulTime(at("23:05:09"), { seconds: true }), "11:05:09 PM");
  assert.equal(formatDayMinute(1440, { nextDay: true }), "12:00 AM next day");
  assert.equal(formatDayMinute(780, { compact: true }), "1 PM");
  assert.equal(formatDayMinute(785), "1:05 PM");
  assert.equal(formatSeoulTime(null), "—");
  assert.equal(formatSeoulDateTime(at("21:15:00", "2026-10-28")), "Oct 28, 9:15 PM");
  assert.equal(formatSeoulDateTime(null), "—");
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

test("each provider shows its latest high and when it last changed, keeping reversals and earlier days", () => {
  const row = forecastProviders(provider([
    [16, at("21:15:00", "2026-10-28"), at("23:45:00", "2026-10-28")], [17, at("08:02:00"), at("09:02:00")],
    [16.4, at("09:17:00")], [17, at("11:02:00"), at("13:17:00")],
  ]));
  assert.equal(row.highC, 17);
  assert.deepEqual(row.changes.map((point) => point.deltaC), [null, 1, -0.6, 0.6]);
  assert.deepEqual(row.changes.map((point) => point.seenLabel), ["Oct 28, 9:15 PM", "8:02 AM", "9:17 AM", "11:02 AM"]);
  assert.deepEqual(row.changes.map((point) => point.afterLabel), [null, "Oct 28, 11:45 PM", "9:02 AM", "9:17 AM"]);
  assert.deepEqual(row.changes.map((point) => point.deltaLabel), [null, "+1°C", "-0.6°C", "+0.6°C"]);
  assert.equal(row.note, "+0.6°C at 11:02 AM");
  assert.equal(row.warning, false);
  assert.equal(row.checkedLabel, "Oct 29, 1:29 PM");
  assert.equal(row.airportNote, "Airport confirmed: Incheon International Airport · RKSI · 1.3 km from the RKSI reference point.");
});

test("a provider whose high has not changed says since when, and repeated rows from a backfill join up", () => {
  const row = forecastProviders(provider([[17, at("00:02:00"), at("05:00:00")], [17, at("05:15:00"), at("13:17:00")]]));
  assert.equal(row.changes.length, 1);
  assert.equal(row.changes[0].lastSeenAt, at("13:17:00"));
  assert.equal(row.note, "No change since 12:02 AM");
});

test("providers without data say why, and unusable or future rows are ignored", () => {
  const empty = (fields) => forecastProviders(provider([], fields));
  assert.equal(empty({ access: "approval_required", location: undefined }).note, "Approval required");
  assert.equal(empty({ access: "approval_required", location: undefined }).airportNote, null);
  assert.equal(empty({ access: "setup_required" }).note, "API key needed");
  assert.equal(empty({ status: "location_unverified", location: null }).note, "Airport location not confirmed");
  assert.equal(empty({ status: "location_unverified", location: null }).airportNote, "Airport location not confirmed yet.");
  assert.equal(empty({ status: "error" }).note, "Check failed");
  assert.equal(empty({ status: "no_data" }).note, "No forecast captured for this date");
  const row = forecastProviders(provider([[17, at("08:00:00")], [18, at("14:00:00")], [null, at("09:00:00")], [19, "soon"]]));
  assert.deepEqual(row.changes.map((point) => point.highC), [17]);
});

test("a live provider warns when its last check failed, moved off the airport or went quiet, but keeps its high", () => {
  const changes = [[17, at("08:00:00"), at("13:17:00")]];
  assert.equal(forecastProviders(provider(changes, { status: "error" })).note, "No change since 8:00 AM · last check failed");
  assert.equal(forecastProviders(provider(changes, { status: "location_unverified" })).note, "No change since 8:00 AM · airport not confirmed");
  const stale = forecastProviders(provider([[17, at("07:00:00")]]));
  assert.equal(stale.note, "No change since 7:00 AM · older forecast");
  for (const row of [forecastProviders(provider(changes, { status: "error" })), stale]) {
    assert.equal(row.highC, 17);
    assert.equal(row.warning, true);
  }
  const archived = forecastProviders(provider([[17, at("07:00:00")]], { status: "error" }), DATE, at("13:30:00", "2026-10-30"));
  assert.equal(archived.note, "No change since 7:00 AM", "a finished day is not late");
  assert.equal(archived.warning, false);
  const future = forecastProviders(provider([[17, at("07:00:00")]]), "2026-10-30", NOW);
  assert.equal(future.note, "No change since Oct 29, 7:00 AM · older forecast");
});

test("a provider's attribution appears only with its data", () => {
  const attribution = { logoUrl: "https://developer.accuweather.com/logo.svg", href: "https://www.accuweather.com" };
  assert.deepEqual(forecastProviders(provider([[18, at("08:00:00")]], { attribution })).attribution, attribution);
  assert.equal(forecastProviders(provider([], { attribution })).attribution, null);
});

test("the provider list refuses another station or date and exposes a cut-short history", () => {
  assert.equal(buildForecastProviders(undefined, DATE, NOW).status, "loading");
  for (const fields of [{ stationIcao: "KORD" }, { date: "2026-10-28" }, { providers: null }]) {
    const result = buildForecastProviders({ stationIcao: "RKSI", date: DATE, providers: [provider([])], ...fields }, DATE, NOW);
    assert.deepEqual([result.status, result.providers], ["unavailable", []], JSON.stringify(fields));
  }
  assert.equal(forecastProviders(provider([[17, at("08:00:00")]], { truncated: true })).truncated, true);
});
