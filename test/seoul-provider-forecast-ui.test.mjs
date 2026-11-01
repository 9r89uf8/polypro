import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CLOUD_RAMP, buildProviderForecastState, cloudColor, formatPeakHours, formatRun, formatSigned, skyPercentRange,
} from "../app/seoul/day/[date]/providerForecastState.js";

const DATE = "2026-11-02";
const pad = (value) => String(value).padStart(2, "0");
const hourAt = (hour, date = DATE) => Date.parse(`${date}T${pad(hour)}:00:00+09:00`);
const at = (time, date = DATE) => Date.parse(`${date}T${time}:00+09:00`);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

function lock(provider, temps, { from = 9, cloud = null, sky = null, ...fields } = {}) {
  return {
    date: DATE, provider, status: "ok", method: "stored_capture", version: "rksi-provider-lock-v1", lockAt: hourAt(9), lockedAt: hourAt(9) + 2_000,
    capturedAt: at("08:35"), receivedAt: at("08:35") + 3_000,
    hourly: range(from, 23).map((hour) => ({ hour, time: hourAt(hour), tempC: temps(hour), ...(cloud ? { cloudCoverPct: cloud(hour) } : {}), ...(sky ? { sky: sky(hour) } : {}) })),
    ...fields,
  };
}
const approved = (id, label, shortLabel, kind, lockRow, score) => ({ id, label, shortLabel, kind, access: "approved", lock: lockRow, score });
const gated = (id, label, shortLabel) => ({ id, label, shortLabel, kind: "open_meteo", access: "approval_required", approvalFlag: "OPEN_METEO_FORECAST_ACCESS_APPROVED", lock: null, score: null });
const kmaTemps = (hour) => (hour < 13 ? hour : hour <= 15 ? 13 : 12);
const score = (fields) => ({ hoursScored: 5, maeC: 0.62, biasC: 0.4, latest: { hour: 13, errorC: 0.6 }, highComplete: false, highErrorC: 0, peakErrorMinutes: -30, ...fields });

function dashboard(fields = {}) {
  return {
    stationIcao: "RKSI", date: DATE, version: "rksi-provider-lock-v1", lockHour: 9, lockAt: hourAt(9),
    providers: [
      approved("kma", "KMA airport forecast", "KMA", "capture", lock("kma", kmaTemps, { sky: (hour) => (hour < 12 ? "Rain" : "Cloudy") }), score({})),
      approved("weathercom", "Weather.com", "W.com", "capture", lock("weathercom", (hour) => (hour < 14 ? 11 : 12), { from: 8, cloud: (hour) => 90 + (hour % 3) }),
        score({ maeC: 0.38, biasC: -0.2, latest: { hour: 13, errorC: -0.4 } })),
      gated("ecmwf", "ECMWF IFS", "ECMWF"), gated("gfs", "NOAA GFS", "GFS"), gated("icon", "DWD ICON", "ICON"),
    ],
    actuals: {
      date: DATE,
      hourly: range(0, 23).map((hour) => ({ hour, time: hourAt(hour), ...(hour <= 13 ? { amosC: hour * 0.95, metarC: Math.round(hour * 0.95) } : {}),
        ...(hour <= 13 ? { sky: hour < 10 ? { code: "BKN010", label: "Broken clouds", minOktas: 5, maxOktas: 7 } : { code: "CAVOK", label: "No significant cloud", minOktas: null, maxOktas: null } } : {}) })),
      officialHigh: { tempC: 12, time: at("13:00"), reportCount: 27 }, highAfterLock: { tempC: 12, time: at("13:00"), reportCount: 9 }, afterLockReportCount: 9,
    },
    summary: [], summaryStartDate: "2026-10-04", summaryEndDate: DATE, summaryDayCount: 0,
    ...fields,
  };
}

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../app/seoul/day/[date]/ProviderForecasts.js", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".js": "jsx" },
  plugins: [{ name: "css-module-test", setup(builder) {
    builder.onLoad({ filter: /\.module\.css$/ }, () => ({ loader: "js", contents: "export default new Proxy({}, { get: (_, key) => key });" }));
  } }] });
const componentModule = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), componentModule, componentModule.exports);
const ProviderForecasts = componentModule.exports.default;
const sensor = range(0, 13 * 60).filter((minute) => minute % 5 === 0).map((minute) => ({ time: hourAt(0) + minute * 60_000, minute, tempC: (minute / 60) * 0.95 }));
const reports = range(0, 26).map((slot) => ({ time: hourAt(0) + slot * 1_800_000, minute: slot * 30, tempC: Math.round(slot * 0.475) }));
const render = (data, date = DATE, now = at("13:20")) => renderToStaticMarkup(React.createElement(ProviderForecasts, { dashboard: data, date, now, amos: sensor, metar: reports }));

test("today after the lock: scoreboard, closest provider, chart, cloud rows and honest gated models", () => {
  const state = buildProviderForecastState(dashboard(), DATE, at("13:20"));
  assert.deepEqual([state.kind, state.label, state.tone, state.leaders, state.highHits], ["locked", "Locked 9:00 AM", "fresh", ["weathercom"], []]);
  assert.deepEqual(state.providers.map((row) => row.status), ["locked", "locked", "approval_required", "approval_required", "approval_required"]);
  const kma = state.providers[0];
  assert.deepEqual([kma.peak.highC, kma.peak.hours, kma.peak.label, kma.sourceLabel], [13, [13, 14, 15], "1–3 PM", "8:35 AM capture"]);
  assert.equal(kma.score.highErrorC, null, "today's high is not final, so no high result is shown");
  const html = render(dashboard());
  assert.match(html, /Which forecast is closest today/);
  assert.match(html, /class="badge fresh">Locked 9:00 AM</);
  assert.match(html, /Closest so far: W\.com, 0\.4° average miss over 5 hours since 9 AM\./);
  assert.match(html, /KMA airport forecast.*<\/th><td>13°<\/td><td>0\.6°<\/td><td>\+0\.4° warm<\/td><td class="textCell">1–3 PM<\/td><td>5<\/td><td class="textCell">8:35 AM capture<\/td>/);
  assert.match(html, /Weather\.com<\/span><span class="shortName">W\.com<\/span><span class="tag">Closest so far<\/span>/);
  assert.match(html, /−0\.2° cool/);
  assert.equal((html.match(/Approval required/g) ?? []).length, 3, "each gated model says so instead of disappearing");
  assert.doesNotMatch(html, /High result/);
  assert.match(html, /9 AM lock/);
  assert.match(html, /Highest since 9 AM 12°/);
  assert.doesNotMatch(html, /came before the lock/, "the high from 9 AM is also the day's high");
  assert.match(html, /aria-pressed="true"[^>]*>.*KMA airport forecast/);
  assert.match(html, /ECMWF IFS · approval required/);
  assert.match(html, />Rain</, "KMA sky words are written into its cloud row");
  assert.match(html, /KMA: sky words only, no percentage/);
  assert.match(html, /cloud 9[0-2]%<\/title>/);
  assert.match(html, /METAR No significant cloud \(CAVOK\): total cover not reported/);
  assert.match(html, /Temperature by hour/);
  assert.match(html, /ECMWF, GFS and ICON wait for Open-Meteo approval/);
  assert.doesNotMatch(html, /Open-Meteo\.com<\/a>, licensed/, "no model attribution without model data");
});

test("an archived day shows high results, the record and model attribution", () => {
  const final = { highComplete: true };
  const data = dashboard({
    providers: [
      approved("kma", "KMA airport forecast", "KMA", "capture", lock("kma", kmaTemps), score({ ...final, highErrorC: 1, peakErrorMinutes: 90, hoursScored: 15, maeC: 0.7 })),
      approved("weathercom", "Weather.com", "W.com", "capture", lock("weathercom", () => 12), score({ ...final, highErrorC: 0, peakErrorMinutes: -20, hoursScored: 15, maeC: 0.5 })),
      approved("ecmwf", "ECMWF IFS", "ECMWF", "open_meteo", lock("ecmwf", (hour) => 8 + hour * 0.2, { from: 0, method: "live_fetch", capturedAt: undefined, runInitAt: Date.parse("2026-11-01T12:00:00Z"), cloud: () => 64 }),
        score({ ...final, highErrorC: 0, peakErrorMinutes: 600, hoursScored: 15, maeC: 0.5 })),
      approved("gfs", "NOAA GFS", "GFS", "open_meteo", { date: DATE, provider: "gfs", status: "error", method: "live_fetch", hourly: [], error: "Open-Meteo 429: Too many requests" }, null),
      approved("icon", "DWD ICON", "ICON", "open_meteo", null, null),
    ],
    summary: [
      { provider: "kma", days: 3, rebuiltDays: 0, highDays: 3, exactHighDays: 1, withinOneDays: 3, meanAbsHighErrorC: 0.67, meanHighErrorC: 0.67, meanAbsPeakErrorMinutes: 80, hours: 45, hourlyMaeC: 0.71, hourlyBiasC: 0.3 },
      { provider: "ecmwf", days: 2, rebuiltDays: 2, highDays: 2, exactHighDays: 2, withinOneDays: 2, meanAbsHighErrorC: 0, meanHighErrorC: 0, meanAbsPeakErrorMinutes: 45, hours: 30, hourlyMaeC: 0.48, hourlyBiasC: -0.1 },
    ],
    summaryDayCount: 3,
  });
  const now = at("10:00", "2026-11-04");
  const state = buildProviderForecastState(data, DATE, now);
  assert.deepEqual([state.kind, state.leaders, state.highHits], ["archived", ["weathercom", "ecmwf"], ["weathercom", "ecmwf"]]);
  assert.equal(state.providers[2].sourceLabel, "12Z Nov 1 run");
  const html = render(data, DATE, now);
  assert.match(html, /How the 9 AM forecasts did/);
  assert.match(html, /Closest through the day: W\.com and ECMWF, 0\.5° average miss\. Right on the high from 9 AM \(12°C\): W\.com and ECMWF\./);
  assert.match(html, /<th scope="col">High result<\/th>/);
  assert.match(html, /\+1°<span class="tableNote">Peak 1 h 30 min late<\/span>/);
  assert.match(html, /Exact<span class="tableNote">Peak on time<\/span>/);
  assert.match(html, /Exact<span class="tableNote">Peak 10 h late<\/span>/);
  assert.match(html, /Open-Meteo 429: Too many requests/);
  assert.match(html, /No 9 AM forecast stored/);
  assert.match(html, /12\.6°<span class="tableNote">METAR-rounded 13°<\/span>/);
  assert.match(html, /High from 9 AM 12°/);
  assert.match(html, /NOAA GFS · not locked/, "a failed model request");
  assert.match(html, /KMA airport forecast<\/span><span class="shortName">KMA<\/span><\/span><\/th><td>3<\/td><td>1 of 3<\/td><td>3 of 3<\/td><td>0\.7°<\/td><td>0\.7°<\/td><td>\+0\.3° warm<\/td><td>80 min<\/td>/);
  assert.match(html, /2 model days were rebuilt/);
  assert.match(html, /Open-Meteo\.com<\/a>, licensed <a[^>]*>CC BY 4\.0<\/a>/);
  assert.match(html, /© 2026 European Centre for Medium-Range Weather Forecasts/);
  assert.match(html, /3 days recorded in the 30 days to Nov 2/);
});

test("before 9 AM, future dates, loading and foreign data never show a forecast as locked", () => {
  const empty = dashboard({ providers: dashboard().providers.map((row) => (row.access === "approved" ? { ...row, lock: null, score: null } : row)) });
  const waiting = buildProviderForecastState(empty, DATE, at("08:10"));
  assert.deepEqual([waiting.kind, waiting.label], ["waiting", "Waiting for 9:00 AM"]);
  assert.deepEqual(waiting.providers.map((row) => row.status), ["waiting", "waiting", "approval_required", "approval_required", "approval_required"]);
  const waitingHtml = render(empty, DATE, at("08:10"));
  assert.match(waitingHtml, /Forecasts locked at 9 AM/);
  assert.doesNotMatch(waitingHtml, /<svg/);
  assert.equal(buildProviderForecastState(dashboard(), "2026-11-03", at("13:00")).kind, "future");
  assert.equal(buildProviderForecastState(undefined, DATE, at("13:00")).kind, "loading");
  assert.equal(buildProviderForecastState(dashboard(), DATE, null).kind, "loading");
  assert.equal(buildProviderForecastState(dashboard({ stationIcao: "KORD" }), DATE, at("13:00")).kind, "unavailable");
  assert.equal(buildProviderForecastState(dashboard({ date: "2026-11-01" }), DATE, at("13:00")).kind, "unavailable");
  const missing = buildProviderForecastState(empty, DATE, at("13:00"));
  assert.deepEqual([missing.kind, missing.label, missing.tone, missing.noLock, missing.detail], ["locked", "No lock", "delayed", true, "No forecast was locked at 9:00 AM today."]);
});

test("a day without any lock says so instead of promising scores", () => {
  const empty = dashboard({ providers: dashboard().providers.map((row) => (row.access === "approved" ? { ...row, lock: null, score: null } : row)) });
  const locking = buildProviderForecastState(empty, DATE, at("09:00"));
  assert.deepEqual([locking.kind, locking.label, locking.tone], ["locked", "Locking", ""], "the scheduled attempts are still running");
  const captureError = (provider, label) => ({ date: DATE, provider, status: "error", method: "stored_capture", hourly: [],
    error: `No ${label} forecast capture completed in the 6 hours before 9:00 AM KST.` });
  const failed = dashboard({ providers: [
    approved("kma", "KMA airport forecast", "KMA", "capture", captureError("kma", "KMA"), null),
    approved("weathercom", "Weather.com", "W.com", "capture", captureError("weathercom", "Weather.com"), null),
    ...dashboard().providers.slice(2),
  ] });
  assert.equal(buildProviderForecastState(failed, DATE, at("09:00")).label, "No lock", "a missing capture cannot be retried");
  const html = render(failed, DATE, at("09:30"));
  assert.match(html, /class="badge delayed">No lock</);
  assert.match(html, /<h2 id="provider-forecasts-heading">Forecasts locked at 9 AM<\/h2>/);
  assert.match(html, /No forecast was locked at 9:00 AM today\./);
  assert.doesNotMatch(html, /Scores start/);
  assert.match(html, /KMA airport forecast · no capture by 9 AM/);
  assert.doesNotMatch(html, /request failed/, "stored captures make no request");
  assert.match(html, /No Weather\.com forecast capture completed in the 6 hours before 9:00 AM KST\./);
});

test("the high is named as the high from 9 AM, and an earlier day high is pointed out", () => {
  const coldDay = (fields) => dashboard({ actuals: { ...dashboard().actuals, officialHigh: { tempC: 14, time: at("00:30"), reportCount: 48 },
    highAfterLock: { tempC: 12, time: at("23:30"), reportCount: 30 }, afterLockReportCount: 30 }, ...fields });
  const live = render(coldDay());
  assert.match(live, /Today’s highest report, 14°C at 12:30 AM, came before the lock\./);
  const label = /<text x="([\d.]+)"[^>]*class="highLabel"[^>]*>Highest since 9 AM 12°<\/text>/.exec(live);
  assert.ok(label && Number(label[1]) < 46 + (1410 / 1440) * (800 - 14 - 46), "a late high's label is pulled inside the plot");
  const archived = render(coldDay(), DATE, at("10:00", "2026-11-04"));
  assert.match(archived, /The day’s high, 14°C at 12:30 AM, came before the lock\./);
  assert.match(archived, /High from 9 AM 12°/);
  const partial = coldDay();
  partial.providers[0] = { ...partial.providers[0], lock: { ...partial.providers[0].lock, status: "partial" }, score: score({ highComplete: false }) };
  assert.match(render(partial, DATE, at("10:00", "2026-11-04")), /—<span class="tableNote">Not scored: hours missing<\/span>/);
});

test("malformed or mismatched rows are dropped instead of drawn", () => {
  const broken = dashboard();
  broken.providers[0].lock.hourly = [{ hour: 10, time: hourAt(11), tempC: 30 }, { hour: 25, time: hourAt(1), tempC: 30 }, { hour: 11, time: hourAt(11), tempC: "12" }];
  broken.providers[1].lock = { ...broken.providers[1].lock, date: "2026-11-01" };
  const state = buildProviderForecastState(broken, DATE, at("13:20"));
  assert.deepEqual([state.providers[0].status, state.providers[0].hourly.length], ["error", 0]);
  assert.equal(state.providers[1].status, "missing");
  assert.doesNotMatch(render(broken), />30°</);
});

test("formatters", () => {
  assert.deepEqual([formatPeakHours([13, 14, 15]), formatPeakHours([11, 12, 16]), formatPeakHours([9]), formatPeakHours([])], ["1–3 PM", "11 AM–12 PM · 4 PM", "9 AM", "—"]);
  assert.deepEqual([formatSigned(0.44), formatSigned(-1.25), formatSigned(0.02), formatSigned(2, 0), formatSigned(null)], ["+0.4°", "−1.3°", "±0.0°", "+2°", "—"]);
  assert.equal(formatRun(Date.parse("2026-10-31T18:00:00Z")), "18Z Oct 31");
  assert.deepEqual([cloudColor(0), cloudColor(100), cloudColor(-1), cloudColor(null)], [CLOUD_RAMP[0], CLOUD_RAMP.at(-1), null, null]);
  assert.equal(cloudColor(50), CLOUD_RAMP[2]);
  assert.deepEqual([skyPercentRange({ minOktas: 5, maxOktas: 8 }), skyPercentRange({ minOktas: null, maxOktas: null })], [[63, 100], null]);
});
