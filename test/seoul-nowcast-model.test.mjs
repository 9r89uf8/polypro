import test from "node:test";
import assert from "node:assert/strict";
import {
  NOWCAST_MODEL_VERSION,
  NOWCAST_HORIZONS_MINUTES,
  NOWCAST_DAMPING_MINUTES,
  NOWCAST_MAX_OBSERVATION_AGE_MS,
  buildNowcast,
} from "../convex/lib/seoulNowcastModel.js";

const MINUTE = 60_000;
const LAST = Date.parse("2026-10-31T04:00:00Z");
const ISSUE = LAST + 15_000;
function row(offset = 0, fields = {}) {
  const time = LAST + offset * MINUTE;
  return {
    _id: `15L-${offset}`,
    stationIcao: "RKSI",
    rwyNo: "2",
    rwyDir: "15L",
    collectionCadence: "one_minute",
    obsTimeUtc: time,
    receivedAt: time + 10_000,
    tempC: 10,
    ...fields,
  };
}
function history({ count = 60, end = 0, slope = 0, tempC = 10 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const offset = end - count + 1 + index;
    return row(offset, { tempC: tempC + slope * (offset - end) });
  });
}
function forecast(versions = history(), fields = {}) {
  return buildNowcast({ versions, issuedAt: ISSUE, ...fields });
}
function close(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}

test("missing observations and invalid clocks return explicit unavailable results", () => {
  for (const issuedAt of [undefined, null, NaN, Infinity, -1, ISSUE + 0.5]) {
    const result = buildNowcast({ issuedAt });
    assert.equal(result.qualityStatus, "unavailable");
    assert.equal(result.reasonCode, "invalid_issue_time");
    assert.deepEqual(result.predictions, []);
    assert.doesNotThrow(() => JSON.stringify(result));
  }
  assert.equal(forecast([]).reasonCode, "amos_missing");
  assert.equal(forecast([], { triggerObsTimeUtc: LAST + 1 }).reasonCode, "invalid_trigger_time");
});

test("flat observations yield persistence and flat trend with no numeric uncertainty band", () => {
  const result = forecast();
  assert.equal(result.modelVersion, NOWCAST_MODEL_VERSION);
  assert.equal(result.qualityStatus, "ready");
  assert.equal(result.intervalStatus, "insufficient_calibration");
  assert.equal(result.features.parametersStatus, "fixed_unvalidated");
  assert.deepEqual(result.predictions.map(p => p.horizonMinutes), NOWCAST_HORIZONS_MINUTES);
  assert.ok(result.predictions.every(p => p.persistenceC === 10 && p.dampedTrendC === 10));
  assert.ok(result.predictions.every(p => !Object.keys(p).some(key => /interval|lower|upper/i.test(key))));
});

for (const slope of [-0.1, 0.1]) {
  test(`damped forecast preserves ${slope < 0 ? "cooling" : "warming"} and uses explicit slope units`, () => {
    const result = forecast(history({ slope }));
    close(result.features.slope15mCPerHour, slope * 60);
    close(result.features.slope15mCPerMinute, slope);
    for (const prediction of result.predictions) {
      close(prediction.dampedTrendC, 10 + slope * 20 * (1 - Math.exp(-prediction.horizonMinutes / 20)));
      assert.ok(Math.abs(prediction.dampedTrendC - 10) < Math.abs(slope * prediction.horizonMinutes));
      assert.equal(prediction.targetTimeUtc, LAST + prediction.horizonMinutes * MINUTE);
      assert.equal(prediction.actualLeadMinutes, prediction.horizonMinutes - 0.25);
      assert.equal(prediction.observationLeadMinutes, prediction.horizonMinutes);
    }
  });
}

test("delayed observations keep issue-minute targets and add observation age to extrapolation", () => {
  const issuedAt = LAST + 90_000;
  const result = forecast(history({ slope: 0.1 }), { issuedAt });
  assert.equal(result.observationAgeMinutes, 1.5);
  const prediction = result.predictions[0];
  assert.equal(prediction.targetTimeUtc, LAST + 11 * MINUTE);
  assert.equal(prediction.actualLeadMinutes, 9.5);
  assert.equal(prediction.observationLeadMinutes, 11);
  close(prediction.dampedTrendC, 10 + 0.1 * NOWCAST_DAMPING_MINUTES * (1 - Math.exp(-11 / NOWCAST_DAMPING_MINUTES)));
});

test("freshness boundary includes exactly two minutes and rejects any older observation", () => {
  assert.equal(forecast(history(), { issuedAt: LAST + NOWCAST_MAX_OBSERVATION_AGE_MS }).qualityStatus, "ready");
  const stale = forecast(history(), { issuedAt: LAST + NOWCAST_MAX_OBSERVATION_AGE_MS + 1 });
  assert.equal(stale.reasonCode, "amos_stale");
  assert.deepEqual(stale.predictions, []);
});

test("future receipt, future observation and old firstSeenAt cannot leak a version into the forecast", () => {
  const available = history({ slope: 0.1 });
  const unavailable = [
    row(0, { _id: "late-revision", receivedAt: ISSUE + 1, sourceFirstSeenAt: LAST - MINUTE, tempC: 20 }),
    row(1, { _id: "future-observation", receivedAt: ISSUE, tempC: 20 }),
    row(-2, { _id: "late-older-observation", receivedAt: ISSUE + 1, tempC: 20 }),
  ];
  const baseline = forecast(available);
  const result = forecast([...available, ...unavailable]);
  assert.deepEqual(result, baseline);
});

test("latest available revision wins regardless of array order or original source insertion clock", () => {
  const original = history();
  const revision = row(0, {
    _id: "revised-last", receivedAt: LAST + 20_000,
    sourceFirstSeenAt: LAST + 10_000, sourceUpdatedAt: LAST + 19_000, tempC: 11,
  });
  assert.equal(forecast([...original, revision]).predictions[0].persistenceC, 10);
  const result = forecast([revision, ...original].reverse(), { issuedAt: LAST + 25_000 });
  assert.equal(result.predictions[0].persistenceC, 11);
  assert.ok(result.inputVersionIds.includes("revised-last"));
  assert.ok(!result.inputVersionIds.includes("15L-0"));
  assert.equal(result.latestObservationReceivedAt, revision.receivedAt);
});

test("invalid latest revision cannot revive an earlier valid payload or previous minute", () => {
  for (const tempC of [NaN, Infinity, -999, 999, 99.9, null, "10.0"]) {
    const versions = [...history(), row(0, { _id: "invalid-revision", receivedAt: LAST + 12_000, tempC })];
    const result = forecast(versions);
    assert.equal(result.reasonCode, "invalid_latest_temperature");
    assert.deepEqual(result.predictions, []);
    assert.equal(result.features.latest15L.tempC, null);
    assert.ok(result.inputVersionIds.includes("invalid-revision"));
  }
});

test("canonical sites and distinct minutes prevent duplicate rows from manufacturing trend coverage", () => {
  const sparse = history({ count: 11, slope: 0.1 });
  const duplicates = sparse.flatMap(r => [r, { ...r, _id: `${r._id}-new`, receivedAt: r.receivedAt + 1 }]);
  const wrongSources = [
    row(-12, { _id: "five-minute", collectionCadence: "five_minute", tempC: 30 }),
    row(-13, { _id: "wrong-runway", rwyNo: "1", tempC: 30 }),
    row(-14, { _id: "wrong-airport", stationIcao: "RKSS", tempC: 30 }),
    row(-15, { _id: "subminute", obsTimeUtc: LAST - 15 * MINUTE + 1, tempC: 30 }),
  ];
  const result = forecast([...duplicates, ...wrongSources]);
  assert.equal(result.qualityStatus, "persistence_only");
  assert.equal(result.reasonCode, "insufficient_trend_coverage");
  assert.equal(result.features.trend15.sampleCount, 11);
  assert.equal(result.features.primaryHistory.length, 11);
  assert.ok(result.predictions.every(p => p.persistenceC === 10 && p.dampedTrendC === null));
  assert.equal(forecast([row()]).qualityStatus, "persistence_only");
});

test("irregular minute coverage uses true elapsed time and enforces the 75 percent threshold", () => {
  const missing = new Set([-13, -9, -5, -2]);
  const versions = history({ count: 16, slope: 0.1 }).filter(r => !missing.has((r.obsTimeUtc - LAST) / MINUTE));
  const result = forecast(versions);
  assert.equal(result.features.trend15.sampleCount, 12);
  assert.equal(result.features.trend15.coverageMinutes, 12);
  assert.equal(result.qualityStatus, "ready");
  close(result.features.slope15mCPerHour, 6);
  assert.equal(forecast(versions.slice(1)).qualityStatus, "persistence_only");
});

test("robust slope resists an isolated interior outlier without rounding the calculation", () => {
  const versions = history({ slope: 0.03 });
  versions.find(r => r.obsTimeUtc === LAST - 7 * MINUTE).tempC += 5;
  const result = forecast(versions);
  close(result.features.slope15mCPerMinute, 0.03);
  assert.notEqual(result.predictions[0].dampedTrendC * 10, Math.round(result.predictions[0].dampedTrendC * 10));
});

test("cross-midnight windows retain yesterday's observations and use KST time features", () => {
  const midnight = Date.parse("2026-10-31T15:00:00Z");
  const shift = midnight - LAST;
  const versions = history({ slope: 0.1 }).map(r => ({ ...r, obsTimeUtc: r.obsTimeUtc + shift, receivedAt: r.receivedAt + shift }));
  const result = forecast(versions, { issuedAt: midnight + 15_000 });
  assert.equal(result.features.minuteOfDayKst, 0);
  assert.equal(result.features.dayOfYearKst, 305);
  assert.equal(result.qualityStatus, "ready");
  assert.equal(result.features.primaryHistory.length, 60);
  assert.equal(result.predictions[0].targetTimeUtc, midnight + 10 * MINUTE);
});

test("60-minute bound excludes old observations while recording available secondary features", () => {
  const versions = [row(-61), row(-60), ...history(), row(0, {
    _id: "16L-latest", rwyNo: "3", rwyDir: "16L", tempC: 10.5,
    dewpointC: 8, windDirAvg: 359, windSpeedAvg: 4,
  })];
  const result = forecast(versions);
  assert.equal(result.features.primaryHistory.length, 60);
  assert.equal(result.features.latest16L.tempC, 10.5);
  assert.equal(result.features.latest16L.windDirAvg, 359);
  assert.equal(result.features.secondaryDifferenceC, 0.5);
  assert.ok(result.inputVersionIds.includes("16L-latest"));
  assert.ok(!result.inputVersionIds.includes("15L--60"));
  const oldSecondary = row(-4, { _id: "16L-old", rwyNo: "3", rwyDir: "16L", tempC: 20 });
  const staleSecondary = forecast([...history(), oldSecondary]);
  assert.equal(staleSecondary.features.latest16L.observationAgeMinutes, 4.25);
  assert.equal(staleSecondary.features.secondaryDifferenceC, null);
  assert.deepEqual(staleSecondary.predictions, forecast(history()).predictions);
});

test("optional sensor sentinels become missing features, not invented predictors", () => {
  const versions = history();
  Object.assign(versions.at(-1), { dewpointC: 8.2, windSpeedAvg: -999, windDirAvg: 999,
    qnhHpa: 9999, morMeters: -999, precipMm: -999 });
  const result = forecast(versions);
  close(result.features.dewpointSpreadC, 1.8);
  for (const field of ["windSpeedAvg", "windDirAvg", "qnhHpa", "morMeters", "precipMm"]) {
    assert.equal(result.features.latest15L[field], null);
  }
  assert.equal(result.qualityStatus, "ready");
});

test("obsolete trigger identity is rejected instead of silently issuing under a different minute", () => {
  assert.equal(forecast(history(), { triggerObsTimeUtc: LAST }).qualityStatus, "ready");
  const result = forecast(history(), { triggerObsTimeUtc: LAST - MINUTE });
  assert.equal(result.reasonCode, "trigger_observation_mismatch");
  assert.deepEqual(result.predictions, []);
});

test("unresolvable receipt-clock ties fail closed and retain both version references", () => {
  const a = row(0, { _id: "version-a", tempC: 11 });
  const b = row(0, { _id: "version-b", tempC: 12 });
  const result = forecast([...history().slice(0, -1), a, b]);
  assert.equal(result.reasonCode, "ambiguous_latest_version");
  assert.deepEqual(result.predictions, []);
  assert.ok(result.inputVersionIds.includes("version-a") && result.inputVersionIds.includes("version-b"));
  const resolved = forecast([...history().slice(0, -1), { ...b, _creationTime: ISSUE - 1 }, { ...a, _creationTime: ISSUE - 2 }]);
  assert.equal(resolved.predictions[0].persistenceC, 12);
});

test("model is pure and does not mutate the immutable version ledger", () => {
  const versions = Object.freeze(history().map(r => Object.freeze(r)));
  const before = JSON.stringify(versions);
  assert.doesNotThrow(() => forecast(versions));
  assert.equal(JSON.stringify(versions), before);
});
