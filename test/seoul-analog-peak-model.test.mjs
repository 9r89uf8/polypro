import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALOG_COUNT, buildAnalogPeak, checkpointFeatures, daySummary, parseRoutineMetar, scoreAnalogPeak, seasonalPeak, seasonalPool,
} from "../convex/lib/seoulAnalogPeakModel.js";
import { ANALOG_LIBRARY } from "../convex/lib/seoulAnalogPeakLibrary.js";

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const report = (fields = {}) => ({ tempC: 10, dewpointC: 5, windU: 0, windV: 0, cloudAmount: 0, precip: false, ...fields });

// Every day from Oct 10 to Nov 20 in 2016-2025, with features and peaks that
// vary predictably by position so rankings and quantiles are checkable.
function syntheticLibrary({ peakFirst = index => 26 + (index % 4) } = {}) {
  const library = { dates: [], maxC: [], peakFirstSlot: [], peakLastSlot: [], checkpoints: {} };
  for (const name of ["09:00", "12:00"]) library.checkpoints[name] = { tempC: [], maxSoFarC: [], vectors: [] };
  for (let year = 2016; year <= 2025; year += 1) {
    for (let time = Date.UTC(year, 9, 10); time <= Date.UTC(year, 10, 20); time += 86_400_000) {
      const index = library.dates.length;
      library.dates.push(new Date(time).toISOString().slice(0, 10));
      library.maxC.push(15 + (index % 5));
      library.peakFirstSlot.push(peakFirst(index));
      library.peakLastSlot.push(peakFirst(index) + 2);
      for (const name of ["09:00", "12:00"]) {
        const tempC = 10 + (index % 5);
        library.checkpoints[name].tempC.push(tempC);
        library.checkpoints[name].maxSoFarC.push(tempC);
        library.checkpoints[name].vectors.push([tempC, index % 3, 4 + (index % 7), index % 5, (index % 9) - 4, (index % 11) - 5, index % 13 === 0 ? 1 : 0]);
      }
    }
  }
  return library;
}

test("routine METARs give temperature, dew point, wind vector, cloud amount and current precipitation", () => {
  const calm = parseRoutineMetar("RKSI 311400Z 06002KT CAVOK 08/03 Q1021 NOSIG");
  assert.deepEqual([calm.tempC, calm.dewpointC, calm.cloudAmount, calm.precip], [8, 3, 0, false]);
  close(calm.windU, -2 * Math.sin(Math.PI / 3));
  close(calm.windV, -2 * Math.cos(Math.PI / 3));
  const showers = parseRoutineMetar("METAR RKSI 010030Z 27010G20KT 9999 -SHRA FEW020 BKN040 M02/M05 Q1012 TEMPO RA");
  assert.deepEqual([showers.tempC, showers.dewpointC, showers.cloudAmount, showers.precip], [-2, -5, 3, true]);
  close(showers.windU, 10);
  const trendOnly = parseRoutineMetar("RKSI 010000Z VRB02KT 5000 BR NSC 05/04 Q1015 BECMG -RA OVC010");
  assert.deepEqual([trendOnly.windU, trendOnly.windV, trendOnly.cloudAmount, trendOnly.precip], [0, 0, 0, false], "trend groups describe a forecast");
  const metric = parseRoutineMetar("RKSI 010000Z 18005MPS 9999 VV001 10/ Q1010");
  assert.deepEqual([metric.tempC, metric.dewpointC, metric.cloudAmount], [10, null, 4]);
  close(metric.windV, 5 * 1.943844);
  assert.equal(parseRoutineMetar("RKSI NIL"), null);
  assert.equal(parseRoutineMetar("RKSI 010000Z 18005KT 9999 FEW030 Q1010"), null);
});

test("checkpoint features use only reports up to the checkpoint and need the 3-hour-earlier report", () => {
  const reports = new Map([[10, report({ tempC: 13 })], [12, report({ tempC: 6 })], [14, report({ precip: true })],
    [18, report({ tempC: 11, dewpointC: 2, cloudAmount: 3, windU: 1.5, windV: -2 })], [20, report({ tempC: 19 })]]);
  const features = checkpointFeatures(reports, 18);
  assert.deepEqual(features.vector, [11, 5, 9, 3, 1.5, -2, 1]);
  assert.equal(features.maxSoFarC, 13, "the later 19°C report is not yet known");
  reports.delete(12);
  assert.equal(checkpointFeatures(reports, 18), null);
  assert.equal(checkpointFeatures(new Map([[12, report()], [18, report({ dewpointC: null })]]), 18), null);
});

test("a day needs 44 routine reports and keeps the first and last slots of its whole-degree maximum", () => {
  const reports = new Map(Array.from({ length: 44 }, (_, slot) => [slot, report({ tempC: slot === 25 || slot === 30 ? 18 : 12 })]));
  assert.deepEqual(daySummary(reports), { maxC: 18, peakFirstSlot: 25, peakLastSlot: 30, reportCount: 44 });
  reports.delete(0);
  assert.equal(daySummary(reports), null);
});

test("the seasonal pool spans the year end and can hold out a target's own season", () => {
  const library = syntheticLibrary();
  const pool = seasonalPool(library, "2026-11-01").map(index => library.dates[index]);
  assert.ok(pool.includes("2016-10-17") && pool.includes("2025-11-16"));
  assert.ok(!pool.includes("2016-10-16") && !pool.includes("2025-11-17"));
  const heldOut = seasonalPool(library, "2020-11-01", { excludeWithinDays: 183 }).map(index => library.dates[index]);
  assert.ok(!heldOut.some(date => date.startsWith("2020-")) && heldOut.includes("2019-11-01") && heldOut.includes("2021-11-01"));
  const winter = { ...library, dates: ["2019-12-25", "2020-01-08", "2020-01-20"] };
  assert.deepEqual(seasonalPool(winter, "2026-01-05").map(index => winter.dates[index]), ["2019-12-25", "2020-01-08", "2020-01-20"]);
});

test("analogs rank by standardized distance and summarize peaks, odds and the likely maximum", () => {
  const library = syntheticLibrary();
  const target = library.dates.indexOf("2018-11-02");
  const features = { tempC: 12, maxSoFarC: 12, vector: library.checkpoints["09:00"].vectors[target] };
  const result = buildAnalogPeak({ library, date: "2026-11-02", checkpoint: "09:00", features });
  assert.equal(result.analogs[0].date, "2018-11-02");
  assert.equal(result.analogs[0].distance, 0);
  assert.equal(result.analog.count, ANALOG_COUNT);
  assert.equal(result.season.count, result.poolCount);
  assert.ok(result.analog.peakFirstMinutes[0] <= result.analog.peakFirstMinutes[1] && result.analog.peakFirstMinutes[1] <= result.analog.peakFirstMinutes[2]);
  assert.equal(result.analog.peakAheadProbability, 1, "every synthetic peak is after 09:00");
  const late = buildAnalogPeak({ library, date: "2026-11-02", checkpoint: "12:00", features: { ...features, maxSoFarC: 30 } });
  assert.equal(late.analog.predictedMaxC, 30, "the maximum already reported is a floor");
  assert.deepEqual(late.analog.predictedMaxRangeC, [30, 30]);
  assert.equal(buildAnalogPeak({ library, date: "2026-03-01", checkpoint: "09:00", features }), null, "too few same-season days");
  assert.throws(() => buildAnalogPeak({ library, date: "2026-11-02", checkpoint: "15:00", features }), /checkpoint/);
});

test("quantiles interpolate like the research study and scores compare analog and season forecasts", () => {
  // 2016 peaks at 10:00 and every other year at 15:00: 31 of the 310 pool days.
  const library = syntheticLibrary({ peakFirst: index => (index < 42 ? 20 : 30) });
  const features = { tempC: 12, maxSoFarC: 12, vector: [12, 1, 7, 2, 0, 0, 0] };
  const result = buildAnalogPeak({ library, date: "2026-11-01", checkpoint: "09:00", features });
  assert.equal(result.poolCount, 310);
  // Linear interpolation: position 309 * 0.1 = 30.9, between the last 10:00 and the first 15:00.
  assert.deepEqual(result.season.peakFirstMinutes.map(minutes => Number(minutes.toFixed(6))), [870, 900, 900]);
  assert.equal(result.season.peakAheadProbability, 1);
  const score = scoreAnalogPeak(result, { maxC: result.season.predictedMaxC + 2, peakFirstSlot: 26 });
  assert.equal(score.peakAhead, true);
  assert.deepEqual([score.season.peakErrorMinutes, score.season.covered, score.season.maxErrorC], [120, false, 2]);
  close(score.season.brierPeakAhead, 0);
  const early = scoreAnalogPeak({ ...result, checkpoint: "12:00" }, { maxC: 0, peakFirstSlot: 20 });
  assert.equal(early.peakAhead, false);
  close(early.season.brierPeakAhead, 1);
});

test("the shipped library reproduces the documented late-October peak window", () => {
  const season = seasonalPeak(ANALOG_LIBRARY, "2026-11-01");
  assert.equal(season.count, 317);
  assert.deepEqual(season.peakFirstMinutes.map(minutes => Math.round(minutes)), [558, 780, 900]);
  assert.deepEqual(season.peakLastMinutes, [750, 900, 1020]);
  assert.equal(season.medianMaxC, 17);
});
