import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCK_HOUR, MIN_AFTER_LOCK_REPORTS, PROVIDERS, buildActuals, forecastPeak, hourTime, isProviderApproved, kmaLockRows, lockStatus,
  openMeteoLockRows, peakWindows, pickAmosRow, roundHalfUp, scoreLock, summarizeScores, weathercomLockRows,
} from "../convex/lib/seoulProviderForecastModel.js";
import { metarSky } from "../convex/lib/seoulMetarSky.js";

const DATE = "2026-11-02";
const HOUR = 3_600_000;
const at = (time, date = DATE) => Date.parse(`${date}T${time}:00+09:00`);
const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

function metarRow(time, tempC, sky = "FEW030", { reportType = "METAR", date = DATE } = {}) {
  const obsTimeUtc = at(time, date);
  return { stationIcao: "RKSI", date, obsTimeUtc, reportType, tempC, rawMetar: `RKSI 0000Z 32008KT 9999 ${sky} ${String(tempC).padStart(2, "0")}/02 Q1018 NOSIG` };
}

test("only the exact string true approves a gated provider", () => {
  const [kma, weathercom, ecmwf] = PROVIDERS;
  assert.equal(isProviderApproved(weathercom, {}), true, "Weather.com has no approval flag");
  for (const value of [undefined, "", "false", "TRUE", "1", " true"]) assert.equal(isProviderApproved(ecmwf, { OPEN_METEO_FORECAST_ACCESS_APPROVED: value }), false);
  assert.equal(isProviderApproved(ecmwf, { OPEN_METEO_FORECAST_ACCESS_APPROVED: "true" }), true);
  assert.equal(isProviderApproved(kma, { OPEN_METEO_FORECAST_ACCESS_APPROVED: "true" }), false, "each provider uses its own flag");
  assert.deepEqual(PROVIDERS.map((provider) => provider.id), ["kma", "weathercom", "ecmwf", "gfs", "icon"]);
});

test("KMA rows keep one capture's on-the-hour values for the date and only its sky category", () => {
  const capture = { hourlyRows: [
    { date: DATE, forecastTimeUtc: at("10:00"), tempC: 11, phrase: "Mostly cloudy", conditionCode: "mtph03", ceilingFt: 3000 },
    { date: DATE, forecastTimeUtc: at("09:00"), tempC: 10, phrase: "Partly cloudy" },
    { date: DATE, forecastTimeUtc: at("10:00"), tempC: 99 },
    { date: DATE, forecastTimeUtc: at("11:30"), tempC: 12 },
    { date: "2026-11-03", forecastTimeUtc: at("00:00", "2026-11-03"), tempC: 7 },
    { date: DATE, forecastTimeUtc: at("12:00"), tempC: null },
  ] };
  const rows = kmaLockRows(capture, DATE);
  assert.deepEqual(rows, [
    { hour: 9, time: at("09:00"), tempC: 10, sky: "Partly cloudy" },
    { hour: 10, time: at("10:00"), tempC: 11, sky: "Mostly cloudy", skyCode: "mtph03" },
  ]);
  assert.ok(rows.every((row) => !("cloudCoverPct" in row)), "no percentage is invented from a category");
});

test("Weather.com rows carry a clamped whole-number cloud cover", () => {
  const rows = weathercomLockRows({ weathercomHourlyRows: [
    { date: DATE, forecastTimeUtc: at("13:00"), tempC: 12.8, cloudCoverPct: 84.6, phrase: "Cloudy" },
    { date: DATE, forecastTimeUtc: at("14:00"), tempC: 13, cloudCoverPct: 140 },
    { date: DATE, forecastTimeUtc: at("15:00"), tempC: 12 },
  ] }, DATE);
  assert.deepEqual(rows.map((row) => [row.hour, row.tempC, row.cloudCoverPct, row.sky]), [[13, 12.8, 85, "Cloudy"], [14, 13, 100, undefined], [15, 12, undefined, undefined]]);
});

test("Open-Meteo rows need Seoul unixtime responses and leave unsupported variables out", () => {
  const time = hours(0, 25).map((hour) => (hourTime(DATE, 0) + hour * HOUR) / 1000);
  const payload = {
    latitude: 37.429222, longitude: 126.44531, elevation: 6, utc_offset_seconds: 32_400,
    hourly_units: { time: "unixtime", temperature_2m: "°C", cloud_cover: "%", cloud_cover_low: "%", cloud_cover_mid: "undefined", cloud_cover_high: "%" },
    hourly: {
      time, temperature_2m: time.map((_, index) => (index === 3 ? null : 8 + index * 0.25)), cloud_cover: time.map(() => 62.4),
      cloud_cover_low: time.map(() => null), cloud_cover_mid: time.map(() => null), cloud_cover_high: time.map(() => 30),
    },
  };
  const { rows, issues, grid } = openMeteoLockRows(payload, DATE);
  assert.equal(rows.length, 23, "next-day hours and the null temperature are dropped");
  assert.deepEqual(rows[0], { hour: 0, time: hourTime(DATE, 0), tempC: 8, cloudCoverPct: 62, cloudHighPct: 30 });
  assert.equal(rows.find((row) => row.hour === 13).tempC, 11.3);
  assert.ok(rows.every((row) => !("cloudMidPct" in row) && !("cloudLowPct" in row)), "a missing or unsupported layer is never stored as 0");
  assert.deepEqual(issues, ["cloud_cover_mid unavailable"]);
  assert.deepEqual(grid, { gridLatitude: 37.429222, gridLongitude: 126.44531, gridElevationM: 6 });
  assert.throws(() => openMeteoLockRows({ ...payload, utc_offset_seconds: 0 }, DATE), /Seoul time/);
  assert.throws(() => openMeteoLockRows({ ...payload, hourly_units: { ...payload.hourly_units, time: "iso8601" } }, DATE), /Unix seconds/);
  assert.throws(() => openMeteoLockRows({ ...payload, hourly: { time } }, DATE), /no temperature/);
});

test("a lock is complete only with every hour from 9 AM to 11 PM", () => {
  const row = (hour) => ({ hour, time: hourTime(DATE, hour), tempC: 10 });
  assert.equal(lockStatus(hours(0, 23).map(row)), "ok");
  assert.equal(lockStatus(hours(9, 23).map(row)), "ok");
  assert.equal(lockStatus(hours(10, 23).map(row)), "partial");
  assert.equal(lockStatus(hours(0, 8).map(row)), "error");
  assert.equal(lockStatus([]), "error");
});

test("the forecast high and peak hours ignore hours before the lock and group ties", () => {
  const rows = [[7, 15], [9, 10], [12, 13], [13, 13], [14, 12.6], [16, 13]].map(([hour, tempC]) => ({ hour, tempC }));
  assert.deepEqual(forecastPeak(rows), { highC: 13, hours: [12, 13, 16], firstHour: 12 });
  assert.deepEqual(peakWindows([16, 12, 13]), [{ startHour: 12, endHour: 13 }, { startHour: 16, endHour: 16 }]);
  assert.equal(forecastPeak([{ hour: 8, tempC: 20 }]), null);
  assert.deepEqual([roundHalfUp(12.5), roundHalfUp(12.4), roundHalfUp(12.45 + 0.05), roundHalfUp(13)], [13, 12, 13, 13]);
});

test("the 15L reading prefers the one-minute row at the exact minute", () => {
  const base = { rwyNo: "2", rwyDir: "15L", obsTimeUtc: at("13:00") };
  assert.equal(pickAmosRow([{ ...base, tempC: 12.1, collectionCadence: "five_minute" }, { ...base, tempC: 12.3, collectionCadence: "one_minute" }]).tempC, 12.3);
  assert.equal(pickAmosRow([{ ...base, rwyDir: "16L", tempC: 12, collectionCadence: "one_minute" }]), null);
  assert.equal(pickAmosRow([{ ...base, tempC: 11.9, updatedAt: 1 }, { ...base, tempC: 12.2, updatedAt: 2 }]).tempC, 12.2);
});

test("actuals use routine reports only, with the METAR sky at each hour", () => {
  const metarRows = [
    metarRow("08:30", 9, "CAVOK"), metarRow("09:00", 10, "FEW020 BKN040"), metarRow("12:00", 13, "OVC015"),
    metarRow("13:30", 14), metarRow("14:00", 14), metarRow("12:45", 16), metarRow("15:00", 12, "FEW030", { reportType: "SPECI" }),
  ];
  const actuals = buildActuals({ date: DATE, amosByHour: { 9: { tempC: 9.8, collectionCadence: "one_minute" } }, metarRows });
  assert.equal(actuals.hourly.length, 24);
  assert.deepEqual(actuals.hourly[9], { hour: 9, time: at("09:00"), amosC: 9.8, amosCadence: "one_minute", metarC: 10,
    sky: { code: "FEW020 BKN040", label: "Broken clouds", minOktas: 5, maxOktas: 8 } }, "two layers bound the union: 5 to 2 + 7, capped at 8");
  assert.deepEqual(actuals.hourly[12].sky, { code: "OVC015", label: "Overcast", minOktas: 8, maxOktas: 8 });
  assert.equal(actuals.hourly[13].metarC, undefined, "13:30 is a half-hour report, not the 1 PM value");
  assert.deepEqual(actuals.officialHigh, { tempC: 14, time: at("13:30"), reportCount: 5 }, "the 12:45 SPECI-like row and the SPECI are excluded");
  assert.deepEqual([actuals.highAfterLock.tempC, actuals.afterLockReportCount], [14, 4]);
  assert.equal(metarSky("RKSI 0000Z 9999 CAVOK 10/02 Q1018").minOktas, null, "CAVOK is not read as clear sky");
  assert.deepEqual(metarSky("RKSI 0000Z 9999 SKC 10/02 Q1018"), { code: "SKC", label: "Clear sky", minOktas: 0, maxOktas: 0 });
  assert.equal(metarSky("RKSI 0000Z 9999 FEW020 10/02 Q1018 TEMPO BKN010").maxOktas, 2, "trend groups are not observations");
});

test("scores compare hours from the lock on with the 15L reading and the high in whole degrees", () => {
  const values = { 8: 9, 9: 10, 10: 11.5, 11: 12, 12: 12.2, 13: 12.5, 14: 12.4 };
  const lock = { hourly: hours(8, 23).map((hour) => ({ hour, time: hourTime(DATE, hour), tempC: values[hour] ?? 11 })) };
  const actuals = { hourly: [{ hour: 8, amosC: 7 }, { hour: 9, amosC: 10.4 }, { hour: 10, amosC: 11.1 }, { hour: 13, amosC: 12.9 }],
    highAfterLock: { tempC: 13, time: at("13:30") }, afterLockReportCount: MIN_AFTER_LOCK_REPORTS };
  const score = scoreLock(lock, actuals);
  assert.deepEqual(score.pairs.map((pair) => [pair.hour, pair.errorC]), [[9, -0.4], [10, 0.4], [13, -0.4]], "8 AM is before the lock; 11 AM has no reading");
  assert.deepEqual([score.hoursScored, score.maeC, score.biasC, score.sumAbsErrorC], [3, 0.4, -0.13, 1.2]);
  assert.deepEqual([score.forecastHighC, score.forecastHighRoundedC, score.actualHighC, score.highErrorC, score.highComplete], [12.5, 13, 13, 0, true]);
  assert.equal(score.peakErrorMinutes, 13 * 60 - (13 * 60 + 30));
  assert.equal(score.latest.hour, 13);
  assert.equal(scoreLock(lock, { ...actuals, afterLockReportCount: MIN_AFTER_LOCK_REPORTS - 1 }).highComplete, false, "too few reports after the lock");
  // Missing afternoon hours may hold the provider's peak: the hours still count, the high does not.
  const gappy = scoreLock({ hourly: lock.hourly.filter((row) => row.hour < 13 || row.hour > 17) }, actuals);
  assert.deepEqual([gappy.hoursScored, gappy.forecastHighC, gappy.highComplete], [2, 12.2, false]);
  const empty = scoreLock({ hourly: [] }, actuals);
  assert.deepEqual([empty.hoursScored, empty.maeC, empty.forecastHighC, empty.highErrorC, LOCK_HOUR], [0, null, null, null, 9]);
});

test("the summary weights hourly misses by hours and counts highs only on complete days", () => {
  const row = (provider, fields) => ({ provider, status: "scored", method: "stored_capture", hoursScored: 15, sumAbsErrorC: 15, sumErrorC: -7.5,
    highComplete: true, highErrorC: 0, peakErrorMinutes: -60, ...fields });
  const summary = summarizeScores([
    row("kma", {}), row("kma", { highErrorC: 1, hoursScored: 5, sumAbsErrorC: 10, sumErrorC: 10, peakErrorMinutes: 120 }),
    row("kma", { highComplete: false, highErrorC: 3 }), row("ecmwf", { method: "single_run_archive", highErrorC: -2 }),
    { provider: "gfs", status: "missing", hoursScored: 0, sumAbsErrorC: 0, sumErrorC: 0, highComplete: false },
  ]);
  const kma = summary.find((item) => item.provider === "kma");
  assert.deepEqual([kma.days, kma.highDays, kma.exactHighDays, kma.withinOneDays, kma.meanAbsHighErrorC, kma.meanHighErrorC], [3, 2, 1, 2, 0.5, 0.5]);
  assert.deepEqual([kma.hours, kma.hourlyMaeC, kma.hourlyBiasC, kma.meanAbsPeakErrorMinutes], [35, 1.14, -0.14, 90]);
  const ecmwf = summary.find((item) => item.provider === "ecmwf");
  assert.deepEqual([ecmwf.days, ecmwf.rebuiltDays, ecmwf.withinOneDays], [1, 1, 0]);
  assert.deepEqual(summary.find((item) => item.provider === "gfs"), { provider: "gfs", days: 0, rebuiltDays: 0, highDays: 0, exactHighDays: 0,
    withinOneDays: 0, meanAbsHighErrorC: null, meanHighErrorC: null, meanAbsPeakErrorMinutes: null, hours: 0, hourlyMaeC: null, hourlyBiasC: null });
});
