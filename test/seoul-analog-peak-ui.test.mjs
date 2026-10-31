import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAnalogPeakState, describeConditions, formatPeakRange, formatPeakTime } from "../app/seoul/day/[date]/analogPeakState.js";

const DATE = "2026-11-02";
const at = (time, date = DATE) => Date.parse(`${date}T${time}+09:00`);
const season = { count: 317, peakFirstMinutes: [558, 780, 900], peakLastMinutes: [750, 900, 1020], medianMaxC: 17 };
const ready = (fields = {}) => ({
  id: "forecast:1", date: DATE, checkpoint: "09:00", issuedAt: at("09:05:10"), status: "ready",
  features: { tempC: 9, maxSoFarC: 9, vector: [9, 3, 7, 1, 5.7, -5.7, 0] },
  analog: { count: 30, peakFirstMinutes: [690, 780, 870], peakLastMinutes: [780, 900, 960], peakAheadProbability: 0.9, predictedMaxC: 17, predictedMaxRangeC: [16, 18] },
  season: { count: 317, peakFirstMinutes: [558, 780, 900], peakLastMinutes: [750, 900, 1020], peakAheadProbability: 0.8, predictedMaxC: 16 },
  analogs: [{ date: "2019-10-28", distance: 0.4, maxC: 17, peakFirstMinutes: 810, peakLastMinutes: 900 }],
  outcome: null, ...fields,
});
const dashboard = (fields = {}) => ({ stationIcao: "RKSI", date: DATE, season, forecasts: [], performance: {}, performanceStartDate: "2026-10-04",
  modelVersion: "rksi-analog-peak-v1", libraryVersion: "rksi-iem-analog-library-v1", ...fields });

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../app/seoul/day/[date]/AnalogPeak.js", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".js": "jsx" },
  plugins: [{ name: "css-module-test", setup(builder) {
    builder.onLoad({ filter: /\.module\.css$/ }, () => ({ loader: "js", contents: "export default new Proxy({}, { get: (_, key) => key });" }));
  } }] });
const componentModule = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), componentModule, componentModule.exports);
const AnalogPeak = componentModule.exports.default;
const render = (data, date = DATE, now = at("10:00:00")) => renderToStaticMarkup(React.createElement(AnalogPeak, { dashboard: data, date, now }));

test("before the 9:00 AM checkpoint the card shows the seasonal window", () => {
  const state = buildAnalogPeakState(dashboard(), DATE, at("07:00:00"));
  assert.deepEqual([state.kind, state.label], ["season", "Season only"]);
  const html = render(dashboard(), DATE, at("07:00:00"));
  assert.match(html, /When today’s high is likely/);
  assert.match(html, /1:00 PM/);
  assert.match(html, /Most days 9:30 AM–3:00 PM/);
  assert.match(html, /317 days within 15 days of this date/);
  assert.match(html, /Typical high.*17°C/);
  assert.match(html, /usually by 9:05 AM/);
});

test("a ready checkpoint shows the similar-day window, odds and likely high beside the season", () => {
  const data = dashboard({ forecasts: [ready()] });
  const state = buildAnalogPeakState(data, DATE, at("10:00:00"));
  assert.deepEqual([state.kind, state.label, state.latest.checkpoint], ["forecast", "From 9:00 AM", "09:00"]);
  const html = render(data);
  assert.match(html, />From 9:00 AM</);
  assert.match(html, /Most similar days 11:30 AM–2:30 PM/);
  assert.match(html, /Season 1:00 PM \(9:30 AM–3:00 PM\)/);
  assert.match(html, />90%</);
  assert.match(html, /Chance the peak comes after 9:00 AM/);
  assert.match(html, /Season 80%/);
  assert.match(html, /Most similar days 16–18°C/);
  assert.match(html, /Season 16°C/);
  assert.match(html, /9:00 AM: 9°C, \+3°C over 3 hours, dew-point spread 7°C, few clouds, wind from the NW at 8 kt, no precipitation/);
  assert.match(html, /Oct 28, 2019 \(high 17°C at 1:30 PM\)/);
  assert.match(html, /last at their high around 3:00 PM/);
});

test("the latest ready checkpoint wins and a missing later update is stated", () => {
  const twelve = ready({ checkpoint: "12:00", issuedAt: at("12:05:00"), analog: { ...ready().analog, peakAheadProbability: 0.6 } });
  assert.equal(buildAnalogPeakState(dashboard({ forecasts: [twelve, ready()] }), DATE, at("12:30:00")).latest.checkpoint, "12:00");
  const unavailable = { date: DATE, checkpoint: "12:00", issuedAt: at("12:55:00"), status: "unavailable", reason: "The checkpoint report is missing." };
  const partial = buildAnalogPeakState(dashboard({ forecasts: [ready(), unavailable] }), DATE, at("13:00:00"));
  assert.deepEqual([partial.latest.checkpoint, partial.detail], ["09:00", "The 12:00 PM update was unavailable."]);
  const none = buildAnalogPeakState(dashboard({ forecasts: [{ ...unavailable, checkpoint: "09:00" }] }), DATE, at("10:00:00"));
  assert.deepEqual([none.kind, none.detail], ["unavailable", "The checkpoint report is missing."]);
  assert.match(render(dashboard({ forecasts: [{ ...unavailable, checkpoint: "09:00" }] })), /The checkpoint report is missing\./);
});

test("an archived day shows its outcome and the recorded results", () => {
  const outcome = { status: "scored", actualMaxC: 16, actualPeakFirstMinutes: 840, actualPeakLastMinutes: 900,
    analog: { peakErrorMinutes: 60, maxErrorC: 1, covered: true }, season: { peakErrorMinutes: 60, maxErrorC: 0, covered: true } };
  const performance = { "09:00": { scoredDays: 3, missingDays: 1,
    analog: { peakMaeMinutes: 70, intervalCoverage: 0.67, brierPeakAhead: 0.05, maxExactShare: 0.33 },
    season: { peakMaeMinutes: 90, intervalCoverage: 1, brierPeakAhead: 0.08, maxExactShare: 0 } } };
  const data = dashboard({ forecasts: [ready({ outcome })], performance });
  const now = at("12:00:00", "2026-11-05");
  assert.equal(buildAnalogPeakState(data, DATE, now).kind, "archived");
  const html = render(data, DATE, now);
  assert.match(html, /When the day’s high came/);
  assert.match(html, /Actual: high 16°C, first reported 2:00 PM, last at 3:00 PM\. Peak-time error 60 min \(season 60 min\)\./);
  assert.match(html, /9:00 AM<\/th><td class="textCell">Similar days<\/td><td>3<\/td><td>70 min<\/td><td>67%<\/td><td>0\.050<\/td><td>33%<\/td>/);
  assert.match(html, /9:00 AM<\/th><td class="textCell">Season<\/td><td>3<\/td><td>90 min<\/td><td>100%<\/td><td>0\.080<\/td><td>0%<\/td>/);
  assert.match(html, /counted as missing/);
  assert.match(html, /Saved model: rksi-analog-peak-v1 · rksi-iem-analog-library-v1/);
  const missing = render(dashboard({ forecasts: [ready({ outcome: { status: "missing" } })] }), DATE, now);
  assert.match(missing, /not enough routine reports/);
});

test("loading, foreign, future and malformed data never invent a peak", () => {
  assert.equal(buildAnalogPeakState(undefined, DATE, at("10:00:00")).kind, "loading");
  assert.equal(buildAnalogPeakState(dashboard(), DATE, null).kind, "loading");
  assert.equal(buildAnalogPeakState(dashboard({ stationIcao: "KORD" }), DATE, at("10:00:00")).kind, "unavailable");
  assert.equal(buildAnalogPeakState(dashboard(), "2026-11-03", at("10:00:00")).kind, "future");
  const broken = ready({ analog: { ...ready().analog, peakFirstMinutes: [900, 780, 870] } });
  const state = buildAnalogPeakState(dashboard({ forecasts: [broken, ready({ date: "2026-11-01" })] }), DATE, at("10:00:00"));
  assert.deepEqual([state.kind, state.latest], ["season", null]);
  assert.doesNotMatch(render(dashboard({ forecasts: [broken] })), />90%</);
});

test("times round to the half hour and conditions read in words", () => {
  assert.deepEqual([formatPeakTime(0), formatPeakTime(750), formatPeakTime(781), formatPeakTime(null)], ["12:00 AM", "12:30 PM", "1:00 PM", "—"]);
  assert.equal(formatPeakRange([600, 700, 905]), "10:00 AM–3:00 PM");
  assert.match(describeConditions({ vector: [-2, -1, 3, 4, 0, 0, 1] }, "12:00"), /12:00 PM: -2°C, -1°C over 3 hours, dew-point spread 3°C, overcast, calm or variable wind, precipitation in the past 3 hours/);
  assert.equal(describeConditions({ vector: [1, 2] }, "09:00"), "");
});
