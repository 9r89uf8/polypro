import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildNowcastState, formatNowcastAge, formatNowcastChange, formatNowcastError, formatNowcastTemperature, formatNowcastTime,
  NOWCAST_FRESHNESS_MS,
} from "../app/seoul/day/[date]/nowcastState.js";

const DATE = "2026-10-31";
const at = (time, date = DATE) => Date.parse(`${date}T${time}+09:00`);
const NOW = at("12:00:30");
const issue = (fields = {}) => ({
  issuedAt: at("12:00:15"), latestObservationTimeUtc: at("12:00:00"),
  modelVersion: "damped-trend-v1", qualityStatus: "ready", qualityReason: "",
  intervalStatus: "insufficient_calibration",
  predictions: [
    { horizonMinutes: 10, targetTimeUtc: at("12:11:00"), persistenceC: 8.3, dampedTrendC: 8.1, climatologyDriftC: 8.4, status: "pending" },
    { horizonMinutes: 15, targetTimeUtc: at("12:16:00"), persistenceC: 8.3, dampedTrendC: 8.0, climatologyDriftC: 8.5, status: "pending" },
    { horizonMinutes: 20, targetTimeUtc: at("12:21:00"), persistenceC: 8.3, dampedTrendC: 7.9, climatologyDriftC: 8.6, status: "pending" },
  ], ...fields,
});
const dashboard = (fields = {}) => ({ stationIcao: "RKSI", date: DATE, latest: issue(), recent: [], metrics: [],
  metricsStartDate: "2026-10-02", metricsEndDate: DATE, metricsWindowDays: 30, ...fields });

// Render the real JSX component with React, stubbing only CSS module class names.
const bundled = await build({ entryPoints: [fileURLToPath(new URL("../app/seoul/day/[date]/TemperatureNowcast.js", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
  loader: { ".js": "jsx" }, plugins: [{ name: "css-module-test", setup(builder) {
    builder.onLoad({ filter: /\.module\.css$/ }, () => ({ loader: "js", contents: "export default new Proxy({}, { get: (_, key) => key });" }));
  } }] });
const componentModule = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), componentModule, componentModule.exports);
const TemperatureNowcast = componentModule.exports.default;
const render = (data = dashboard(), date = DATE, now = NOW) => renderToStaticMarkup(React.createElement(TemperatureNowcast, { dashboard: data, date, now }));

test("fresh forecasts preserve the actual target and lead from issuance", () => {
  const state = buildNowcastState(dashboard(), DATE, NOW);
  assert.equal(state.kind, "ready");
  assert.equal(state.isLive, true);
  assert.deepEqual(state.predictions.map(row => row.estimateC), [8.3, 8.3, 8.3]);
  assert.equal(state.predictions[0].actualLeadMinutes, 10.75);
  assert.equal(state.predictions[0].observationLeadMinutes, 11);
  const html = render();
  assert.match(html, /15L AMOS · EXPERIMENTAL/);
  assert.match(html, /12:11 PM KST/);
  assert.match(html, /10\.8 min from issue/);
  assert.match(html, /No calibrated prediction range yet/);
  assert.match(html, /Separate from official METAR temperatures and the daily high/);
  assert.doesNotMatch(html, /80%|95%|±/);
});

test("no change is the headline; drift and trend appear only as smaller test lines", () => {
  const state = buildNowcastState(dashboard(), DATE, NOW);
  assert.ok(state.predictions.every(row => row.method === "persistence"));
  assert.deepEqual(state.predictions.map(row => row.dampedTrendC), [8.1, 8.0, 7.9]);
  assert.deepEqual(state.predictions.map(row => row.driftC), [8.4, 8.5, 8.6]);
  const html = render();
  assert.match(html, />Fresh</);
  assert.equal((html.match(/class="value">8\.3°C</g) ?? []).length, 3);
  assert.doesNotMatch(html, /class="value">(8\.1|8\.0|7\.9|8\.4|8\.5|8\.6)°C</);
  for (const [drift, trend] of [["8.4", "8.1"], ["8.5", "8.0"], ["8.6", "7.9"]]) {
    assert.match(html, new RegExp(`class="testValue">Drift test ${drift.replace(".", "\\.")}°C</span><span class="testValue">Trend test ${trend.replace(".", "\\.")}°C<`));
  }
  assert.match(html, /Neither replaces the large number until saved results show it beating no change/);
  assert.match(html, /Iowa Environmental Mesonet/);
});

test("a parent clock tick expires the same cached query without changing saved values", () => {
  const data = dashboard();
  assert.equal(buildNowcastState(data, DATE, at("12:02:00")).isLive, true);
  const state = buildNowcastState(data, DATE, at("12:02:01"));
  assert.equal(NOWCAST_FRESHNESS_MS, 120_000);
  assert.equal(state.kind, "stale");
  assert.equal(state.isLive, false);
  assert.equal(state.latest.issuedAt, data.latest.issuedAt);
  assert.deepEqual(state.predictions.map(row => row.estimateC), [8.3, 8.3, 8.3]);
  const html = render(data, DATE, at("12:02:01"));
  assert.match(html, /Last issued temperature nowcast/);
  assert.match(html, /Updates delayed/);
  assert.match(html, /Showing saved estimates/);
  assert.doesNotMatch(html, />Fresh</);
});

test("a newly issued forecast cannot make an old input observation fresh", () => {
  const data = dashboard({ latest: issue({ latestObservationTimeUtc: at("11:57:00") }) });
  const state = buildNowcastState(data, DATE, NOW);
  assert.equal(state.kind, "stale");
  assert.equal(state.isLive, false);
  assert.match(render(data), /3m 30s ago/);
});

test("a forecast issued since the last 15-second page tick shows at once instead of blanking the card", () => {
  const fresh = dashboard({ latest: issue({ issuedAt: NOW + 10_000, latestObservationTimeUtc: at("12:00:30") }) });
  const state = buildNowcastState(fresh, DATE, NOW);
  assert.equal(state.kind, "ready");
  assert.equal(state.isLive, true);
  assert.equal(state.clock, NOW + 10_000);
  assert.deepEqual(state.predictions.map(row => row.estimateC), [8.3, 8.3, 8.3]);
  assert.match(render(fresh), /0s ago/);
  const tooFar = buildNowcastState(dashboard({ latest: issue({ issuedAt: NOW + 31_000 }) }), DATE, NOW);
  assert.deepEqual([tooFar.kind, tooFar.predictions], ["empty", []]);
});

test("persistence-only uses the no-change estimate even if stray trend values are present", () => {
  const data = dashboard({ latest: issue({ qualityStatus: "persistence_only", qualityReason: "Waiting for enough recent readings." }) });
  const state = buildNowcastState(data, DATE, NOW);
  assert.equal(state.kind, "persistence_only");
  assert.deepEqual(state.predictions.map(row => row.estimateC), [8.3, 8.3, 8.3]);
  assert.ok(state.predictions.every(row => row.method === "persistence"));
  const html = render(data);
  assert.match(html, />Fresh</);
  assert.match(html, /Trend test unavailable\. Waiting for enough recent readings\./);
  assert.doesNotMatch(html, /Trend test \d/);
  assert.match(html, /Drift test 8\.4°C/, "the drift test does not depend on trend coverage");
  assert.equal((html.match(/No change · persistence/g) ?? []).length, 3);
});

test("unavailable worker results preserve the reason without publishing carried predictions", () => {
  const data = dashboard({ latest: issue({ qualityStatus: "unavailable", latestObservationTimeUtc: null,
    qualityReason: "No valid 15L temperature is available." }) });
  const state = buildNowcastState(data, DATE, NOW);
  assert.equal(state.kind, "unavailable");
  assert.deepEqual(state.predictions, []);
  assert.match(render(data), /No valid 15L temperature is available/);
  assert.doesNotMatch(render(data), /8\.1°C/);
  assert.deepEqual(buildNowcastState(dashboard({ latest: issue({ qualityStatus: "unknown" }) }), DATE, NOW).predictions, []);
});

test("missing or duplicate horizon records never turn into invented forecast temperatures", () => {
  const raw = issue();
  raw.predictions = [raw.predictions[0], raw.predictions[0], raw.predictions[2]];
  const state = buildNowcastState(dashboard({ latest: raw }), DATE, NOW);
  assert.deepEqual(state.predictions.map(row => row.estimateC), [null, null, 8.3]);
  assert.deepEqual(state.predictions.map(row => row.driftC), [null, null, 8.6]);
  assert.deepEqual(state.predictions.map(row => row.targetTimeUtc), [null, null, at("12:21:00")]);
  assert.equal(formatNowcastTemperature(NaN), "—");
  assert.equal(formatNowcastTemperature("8.3"), "—");
  assert.equal(formatNowcastTemperature(-0.01), "0.0°C");
});

test("loading, foreign identity, future issuance and future dates never claim live forecasts", () => {
  assert.equal(buildNowcastState(undefined, DATE, NOW).kind, "loading");
  assert.equal(buildNowcastState(dashboard(), DATE, null).kind, "loading");
  for (const data of [dashboard({ stationIcao: "KORD" }), dashboard({ date: "2026-10-30" }),
    dashboard({ latest: issue({ issuedAt: NOW + 60_000 }) })]) {
    const state = buildNowcastState(data, DATE, NOW);
    assert.equal(state.isLive, false);
    assert.deepEqual(state.predictions, []);
  }
  const state = buildNowcastState(dashboard({ date: "2026-11-01" }), "2026-11-01", NOW);
  assert.equal(state.kind, "future");
  assert.deepEqual(state.predictions, []);
});

test("archived issues retain next-day targets and known results without a live or delayed label", () => {
  const archived = issue({ issuedAt: at("23:55:15"), latestObservationTimeUtc: at("23:55:00"), predictions: [
    { horizonMinutes: 10, targetTimeUtc: at("00:06:00", "2026-11-01"), persistenceC: 8.3, dampedTrendC: 8.1,
      status: "scored", actualC: 8.0, scoredAt: at("00:07:00", "2026-11-01") },
  ] });
  const data = dashboard({ latest: archived, recent: [archived] });
  const now = at("12:00:00", "2026-11-01");
  const state = buildNowcastState(data, DATE, now);
  assert.equal(state.kind, "archived");
  assert.equal(state.isLive, false);
  assert.equal(state.predictions[0].actualC, 8.0);
  assert.equal(formatNowcastTime(archived.predictions[0].targetTimeUtc, DATE), "12:06 AM KST · 2026-11-01");
  const html = render(data, DATE, now);
  assert.match(html, /Saved temperature nowcasts/);
  assert.match(html, /12:06 AM KST · 2026-11-01/);
  assert.match(html, /Actual: 8\.0°C/);
  assert.doesNotMatch(html, />Fresh<|Updates delayed|ago<|Temperature in the next/);
});

test("actuals appear only after the target and score exist; missing is distinct from pending", () => {
  const raw = issue();
  raw.predictions[0] = { ...raw.predictions[0], status: "scored", actualC: 9.9, scoredAt: at("12:12:00") };
  raw.predictions[1] = { ...raw.predictions[1], status: "missing" };
  const data = dashboard({ latest: raw });
  const early = buildNowcastState(data, DATE, NOW);
  assert.equal(early.predictions[0].actualC, null);
  assert.equal(early.predictions[0].status, "pending");
  assert.equal(early.predictions[1].status, "pending");
  assert.doesNotMatch(render(data), /9\.9°C/);
  const later = buildNowcastState(data, DATE, at("12:18:00"));
  assert.equal(later.predictions[0].actualC, 9.9);
  assert.equal(later.predictions[1].status, "missing");
  assert.equal(later.predictions[2].status, "pending");
  assert.match(render(data, DATE, at("12:18:00")), /Reading missing/);
});

test("accuracy lists each method against no change on its own cases and exposes sample days and window", () => {
  const data = dashboard({ metrics: [{ horizonMinutes: 10, scoredCount: 100, scoredDayCount: 3, pairedCount: 40, dayCount: 2,
    persistenceMaeC: 0.9, pairedPersistenceMaeC: 0.4, dampedMaeC: 0.2,
    driftPairedCount: 60, driftDayCount: 2, driftPairedPersistenceMaeC: 0.5, driftMaeC: 0.45 }] });
  const state = buildNowcastState(data, DATE, NOW);
  assert.deepEqual([state.metrics[0].persistenceMaeC, state.metrics[0].scoredDayCount], [0.9, 3]);
  assert.deepEqual([state.metrics[0].pairedCount, state.metrics[0].dayCount, state.metrics[0].pairedPersistenceMaeC], [40, 2, 0.4]);
  assert.deepEqual([state.metrics[0].driftPairedCount, state.metrics[0].driftMaeC, state.metrics[0].driftPairedPersistenceMaeC], [60, 0.45, 0.5]);
  const html = render(data);
  assert.match(html, /Recorded performance · past 30 days/);
  assert.match(html, /2026-10-02 to 2026-10-31/);
  assert.match(html, /No-change MAE, same cases/);
  assert.match(html, /10 min<\/th><td class="textCell">No change<\/td><td>100<\/td><td>3<\/td><td>0\.90°C<\/td><td>—<\/td>/);
  assert.match(html, /10 min<\/th><td class="textCell">Drift test<\/td><td>60<\/td><td>2<\/td><td>0\.45°C<\/td><td>0\.50°C<\/td>/);
  assert.match(html, /10 min<\/th><td class="textCell">Trend test<\/td><td>40<\/td><td>2<\/td><td>0\.20°C<\/td><td>0\.40°C<\/td>/);
  assert.match(html, /Recorded days may cover only part of this window/);
  const invalid = buildNowcastState(dashboard({ metrics: [{ ...data.metrics[0], pairedCount: 0, driftPairedCount: 101 }] }), DATE, NOW);
  assert.deepEqual([invalid.metrics[0].dampedMaeC, invalid.metrics[0].pairedPersistenceMaeC], [null, null]);
  assert.deepEqual([invalid.metrics[0].driftPairedCount, invalid.metrics[0].driftMaeC], [0, null], "drift cases cannot exceed scored cases");
  assert.equal(formatNowcastError(0.04), "0.04°C");
  assert.notEqual(formatNowcastError(0.06), formatNowcastError(0.09));
  assert.deepEqual([formatNowcastChange(0.2, 0.25), formatNowcastChange(0.45, 0.3), formatNowcastChange(0.3, 0.3)], ["−20%", "+50%", "0%"]);
  assert.deepEqual([formatNowcastChange(null, 0.3), formatNowcastChange(0.2, 0)], ["—", "—"]);
});

test("time-of-day accuracy lists each KST window and lead, ignoring conflicting or invalid rows", () => {
  const timeOfDayMetrics = [
    { window: "morning", horizonMinutes: 10, scoredCount: 50, pairedCount: 40, dayCount: 2, pairedPersistenceMaeC: 0.25, dampedMaeC: 0.2,
      driftPairedCount: 50, driftDayCount: 2, driftPairedPersistenceMaeC: 0.26, driftMaeC: 0.13 },
    { window: "evening", horizonMinutes: 20, scoredCount: 30, pairedCount: 30, dayCount: 1, pairedPersistenceMaeC: 0.3, dampedMaeC: 0.45 },
    { window: "overnight", horizonMinutes: 10, scoredCount: 5, pairedCount: 9, dayCount: 1, pairedPersistenceMaeC: 0.1, dampedMaeC: 0.1 },
    { window: "midday", horizonMinutes: 15, scoredCount: 9, pairedCount: 9, dayCount: 1, pairedPersistenceMaeC: 0.1, dampedMaeC: 0.2 },
    { window: "midday", horizonMinutes: 15, scoredCount: 9, pairedCount: 9, dayCount: 1, pairedPersistenceMaeC: 0.4, dampedMaeC: 0.1 },
  ];
  const data = dashboard({ timeOfDayMetrics, timeOfDayExcludedDayCount: 1 });
  const state = buildNowcastState(data, DATE, NOW);
  assert.equal(state.timeOfDay.length, 15);
  assert.deepEqual(state.timeOfDay.slice(0, 3).map(row => [row.key, row.horizonMinutes]), [["overnight", 10], ["overnight", 15], ["overnight", 20]]);
  const cell = (key, horizon) => state.timeOfDay.find(row => row.key === key && row.horizonMinutes === horizon);
  assert.deepEqual([cell("morning", 10).pairedCount, cell("morning", 10).pairedPersistenceMaeC, cell("morning", 10).dampedMaeC], [40, 0.25, 0.2]);
  assert.deepEqual([cell("morning", 10).driftPairedCount, cell("morning", 10).driftPairedPersistenceMaeC, cell("morning", 10).driftMaeC], [50, 0.26, 0.13]);
  assert.deepEqual([cell("evening", 20).driftPairedCount, cell("evening", 20).driftMaeC], [0, null]);
  assert.deepEqual([cell("overnight", 10).pairedCount, cell("overnight", 10).dampedMaeC], [0, null], "paired cannot exceed scored");
  assert.deepEqual([cell("midday", 15).pairedCount, cell("midday", 15).dampedMaeC], [0, null], "duplicates are not merged");
  assert.equal(state.timeOfDayExcludedDays, 1);
  const html = render(data);
  assert.match(html, /By time of day/);
  assert.match(html, /Drift test cases<\/th><th scope="col">Drift test vs no change<\/th><th scope="col">Trend test cases<\/th><th scope="col">Trend test vs no change/);
  assert.match(html, /Morning · 6–10 AM<span class="tableNote">10 min ahead<\/span><\/th><td>50<\/td><td>−50%<span class="tableNote">0\.13°C vs 0\.26°C<\/span><\/td><td>40<\/td><td>−20%<span class="tableNote">0\.20°C vs 0\.25°C<\/span><\/td>/);
  assert.match(html, /Evening · 6 PM–12 AM<span class="tableNote">20 min ahead<\/span><\/th><td>0<\/td><td>—<\/td><td>30<\/td><td>\+50%<span class="tableNote">0\.45°C vs 0\.30°C<\/span><\/td>/);
  assert.match(html, /Excludes 1 day recorded before time-of-day results were kept\./);
  const empty = render(dashboard());
  assert.match(empty, /No test forecasts have been scored by time of day yet\./);
  assert.doesNotMatch(empty, /Excludes \d/);
});

test("fresh pending minute issues do not hide separately supplied completed forecasts", () => {
  const completed = issue({ issuedAt: at("11:39:15"), latestObservationTimeUtc: at("11:39:00"), predictions: [
    { horizonMinutes: 10, targetTimeUtc: at("11:50:00"), persistenceC: 8.3, dampedTrendC: 8.1, climatologyDriftC: 8.2,
      status: "scored", actualC: 8.0, scoredAt: at("11:50:30") },
  ] });
  const data = dashboard({ recent: [issue()], recentResolved: [completed] });
  const state = buildNowcastState(data, DATE, NOW);
  assert.equal(state.latest.issuedAt, at("12:00:15"));
  assert.equal(state.recent[0].issuedAt, at("11:39:15"));
  assert.equal(state.recent[0].predictions[0].actualC, 8.0);
  assert.equal(state.recentResolved, true);
  const html = render(data);
  assert.match(html, /Recent scored forecasts/);
  assert.match(html, /No change<\/th><th scope="col">Drift test<\/th><th scope="col">Trend test<\/th><th scope="col">Actual 15L/);
  assert.match(html, /<td>8\.3°C<\/td><td>8\.2°C<\/td><td>8\.1°C<\/td><td>8\.0°C<\/td>/);
});

test("recent history is bounded, sorted, and excludes other issue dates and future records", () => {
  const records = Array.from({ length: 8 }, (_, i) => issue({ issuedAt: NOW - i * 60_000,
    latestObservationTimeUtc: NOW - i * 60_000 - 15_000 }));
  const data = dashboard({ recent: [records[2], ...records, issue({ issuedAt: NOW + 60_000 }),
    issue({ issuedAt: at("23:59:00", "2026-10-30"), latestObservationTimeUtc: at("23:58:00", "2026-10-30") })] });
  const state = buildNowcastState(data, DATE, NOW);
  assert.equal(state.recent.length, 4);
  assert.deepEqual(state.recent.map(row => row.issuedAt), records.slice(0, 4).map(row => row.issuedAt));
  assert.equal(formatNowcastAge(at("12:00:00"), NOW), "30s ago");
  assert.equal(formatNowcastAge(at("11:59:00"), NOW), "1m 30s ago");
});
