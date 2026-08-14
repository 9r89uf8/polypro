import test from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_INTERVAL_MS,
  assessFutureObservationCoverage,
  assessKmaHourlyCurve,
  assessKmaUpwardRevision,
  advanceDecisionState,
  buildObservedTemperatureFeatures,
  circularDifferenceDegrees,
  computeKmaLiveBias,
  computeKmaPeakWindow,
  computeRemainingCeilings,
  normalizeDecisionTargetC,
  planActiveDecisionTargetRegistration,
  robustTemperatureTrend,
} from "../convex/seoulHighPredictionModel.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function observationRows({
  startAt = Date.UTC(2026, 6, 31, 3),
  minutes = 61,
  startC = 26,
  changePerMinuteC = 0,
} = {}) {
  return Array.from({ length: minutes }, (_value, index) => ({
    obsTimeUtc: startAt + index * MINUTE_MS,
    tempC: startC + index * changePerMinuteC,
  }));
}

function forecastRows(startAt, temperatures) {
  return temperatures.map((tempC, index) => ({
    forecastTimeUtc: startAt + index * HOUR_MS,
    forecastTimeLocal: `2026-07-31 ${String(12 + index).padStart(2, "0")}:00`,
    tempC,
  }));
}

test("decision targets normalize to raw AMOS tenths inside a bounded range", () => {
  assert.equal(normalizeDecisionTargetC(undefined), 27);
  assert.equal(normalizeDecisionTargetC(31), 31);
  assert.equal(normalizeDecisionTargetC(31.04), 31);
  assert.equal(normalizeDecisionTargetC(31.05), 31.1);
  assert.equal(normalizeDecisionTargetC(-20), -20);
  assert.equal(normalizeDecisionTargetC(45), 45);

  assert.throws(() => normalizeDecisionTargetC(null), /finite/i);
  assert.throws(() => normalizeDecisionTargetC("31"), /finite/i);
  assert.throws(() => normalizeDecisionTargetC(Number.NaN), /finite/i);
  assert.throws(
    () => normalizeDecisionTargetC(Number.POSITIVE_INFINITY),
    /finite/i,
  );
  assert.throws(() => normalizeDecisionTargetC(-20.1), /-20\.0°C.*45\.0°C/i);
  assert.throws(() => normalizeDecisionTargetC(45.1), /-20\.0°C.*45\.0°C/i);
});

test("batch target registration protects every requested target during LRU ties", () => {
  const activeTargets = [31, 32, 25, 26, 27.1, 28, 29, 30].map(
    (targetC, index) => ({
      _id: `row-${index}`,
      targetC,
      createdAt: index + 1,
      updatedAt: 100,
    }),
  );
  const plan = planActiveDecisionTargetRegistration({
    activeTargets,
    requestedTargetCs: [31, 32, 33],
    maxActiveTargets: 8,
  });

  assert.deepEqual(
    plan.existingRequestedTargets.map((row) => row.targetC),
    [31, 32],
  );
  assert.deepEqual(plan.missingTargetCs, [33]);
  assert.equal(plan.retirementTargets.length, 1);
  assert.equal(plan.retirementTargets[0].targetC, 25);
  assert.ok(
    plan.retirementTargets.every((row) => ![31, 32].includes(row.targetC)),
  );
});

test("pairwise-median trend resists one endpoint outlier", () => {
  const rows = observationRows({ changePerMinuteC: -0.01 });
  rows.at(-1).tempC += 1.5;

  const result = robustTemperatureTrend(rows, 60);

  assert.ok(Math.abs(result.slopeCPerHour + 0.6) < 1e-9);
  assert.equal(result.coverageMinutes, 60);
});

test("trend requires coverage and a recent final pair", () => {
  const shortRows = observationRows({ minutes: 30 });
  assert.equal(robustTemperatureTrend(shortRows, 60).slopeCPerHour, null);

  const gappedRows = observationRows({ minutes: 61 });
  gappedRows.splice(-9, 8);
  assert.equal(robustTemperatureTrend(gappedRows, 60).slopeCPerHour, null);

  const sparseClusters = [
    ...observationRows({ minutes: 12 }),
    ...observationRows({
      startAt: Date.UTC(2026, 6, 31, 3) + 49 * MINUTE_MS,
      minutes: 12,
    }),
  ];
  assert.equal(robustTemperatureTrend(sparseClusters, 60).slopeCPerHour, null);
  assert.equal(robustTemperatureTrend(sparseClusters, 60).coverageMinutes, 24);
});

test("trend keeps decision precision instead of rounding away weak warming", () => {
  const rows = observationRows({ changePerMinuteC: 0.04 / 60 });
  assert.ok(
    Math.abs(robustTemperatureTrend(rows, 60).slopeCPerHour - 0.04) < 1e-9,
  );
});

test("observed features smooth current temperature and use the last near-high", () => {
  const startAt = Date.UTC(2026, 6, 31, 3);
  const rows = observationRows({ startAt, minutes: 61, startC: 25.5 });
  rows[20].tempC = 26.3;
  rows[40].tempC = 26.2;
  rows[58].tempC = 25.9;
  rows[59].tempC = 26.1;
  rows[60].tempC = 26;

  const features = buildObservedTemperatureFeatures(
    rows,
    startAt + 60 * MINUTE_MS,
  );

  assert.equal(features.currentSmoothedC, 26);
  assert.equal(features.observedHighRow.tempC, 26.3);
  assert.equal(features.lastNearHighRow.obsTimeUtc, startAt + 40 * MINUTE_MS);
  assert.equal(features.minutesSinceNearHigh, 20);
  assert.equal(features.dropFromHighC, 0.3);
});

test("live KMA bias uses a median and clips to the operational range", () => {
  const startAt = Date.UTC(2026, 6, 31, 3);
  const forecasts = forecastRows(startAt, [24, 24, 24]);
  const observations = observationRows({
    startAt,
    minutes: 61,
    startC: 26,
  });

  const result = computeKmaLiveBias(observations, forecasts, startAt + HOUR_MS);

  assert.equal(result.liveBiasC, 1.5);
  assert.equal(result.rawBiasC, 2);
});

test("live KMA bias coverage counts only matched forecast residuals", () => {
  const startAt = Date.UTC(2026, 6, 31, 3);
  const observations = observationRows({ startAt, minutes: 61, startC: 26 });
  const forecasts = forecastRows(startAt + 40 * MINUTE_MS, [25, 25]);

  const result = computeKmaLiveBias(observations, forecasts, startAt + HOUR_MS);

  assert.equal(result.liveBiasC, null);
  assert.equal(result.coverageMinutes, 20);
});

test("KMA peak window spans all tied hours and one following interval", () => {
  const startAt = Date.UTC(2026, 6, 31, 3);
  const rows = forecastRows(startAt, [25, 26, 26, 26, 25]);

  const peak = computeKmaPeakWindow(rows);

  assert.equal(peak.firstPeakTimeUtc, startAt + HOUR_MS);
  assert.equal(peak.lastPeakTimeUtc, startAt + 3 * HOUR_MS);
  assert.equal(peak.peakWindowEndUtc, startAt + 4 * HOUR_MS);
  assert.equal(peak.tiedCount, 3);
});

test("KMA curve assessment rejects incomplete and daily-inconsistent guidance", () => {
  const startAt = Date.UTC(2026, 6, 31, 3);
  const endOfDayUtc = startAt + 12 * HOUR_MS;
  const sparse = assessKmaHourlyCurve({
    rows: forecastRows(startAt, [26]),
    evaluatedAt: startAt,
    endOfDayUtc,
    dailyHighC: 27,
  });
  assert.equal(sparse.complete, false);
  assert.equal(sparse.dailyHourlyConsistent, false);

  const lateOnly = assessKmaHourlyCurve({
    rows: forecastRows(startAt + 10 * HOUR_MS, [26, 26]),
    evaluatedAt: startAt,
    endOfDayUtc,
    dailyHighC: 26,
  });
  assert.equal(lateOnly.complete, false);
  assert.equal(lateOnly.maxGapMinutes, 600);

  const complete = assessKmaHourlyCurve({
    rows: forecastRows(
      startAt,
      Array.from({ length: 12 }, () => 26),
    ),
    evaluatedAt: startAt + 2 * HOUR_MS,
    endOfDayUtc,
    dailyHighC: 26,
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.dailyHourlyConsistent, true);
});

test("KMA upward revision compares with the immediately prior evaluation baseline", () => {
  const now = Date.UTC(2026, 6, 31, 5);
  const previousRows = forecastRows(now, [26, 25, 24]);
  const currentRows = forecastRows(now, [26, 25.2, 24]);
  const result = assessKmaUpwardRevision({
    previousCaptureKey: "capture-after-downward-revision",
    currentCaptureKey: "capture-after-small-rebound",
    previousDailyHighC: 26,
    currentDailyHighC: 26,
    previousRemainingUpperC: 26.7,
    currentRemainingUpperC: 26.7,
    previousHourlyRows: previousRows,
    currentHourlyRows: currentRows,
    evaluatedAt: now,
  });

  assert.equal(result.captureChanged, true);
  assert.equal(result.hourlyIncreaseC, 0.2);
  assert.equal(result.upwardDetected, true);
});

test("remaining ceiling matches the documented 26.8 C example", () => {
  const now = Date.UTC(2026, 6, 31, 5);
  const result = computeRemainingCeilings({
    forecastRows: forecastRows(now, [26, 26]),
    evaluatedAt: now,
    endOfDayUtc: now + 12 * HOUR_MS,
    liveBiasC: 0.1,
    currentSmoothedC: 26,
    observedHighC: 26.3,
    slope15mCPerHour: -0.6,
    slope30mCPerHour: -0.4,
    targetC: 27,
  });

  assert.equal(result.kmaRemainingUpperC, 26.8);
  assert.equal(result.nowcastUpperC, 26.2);
  assert.equal(result.remainingRuleCeilingC, 26.8);
  assert.equal(result.marginBelowTargetC, 0.2);
});

test("the target changes the margin without changing the physical ceiling", () => {
  const now = Date.UTC(2026, 6, 31, 5);
  const inputs = {
    forecastRows: forecastRows(now, [30, 30]),
    evaluatedAt: now,
    endOfDayUtc: now + 12 * HOUR_MS,
    liveBiasC: 0.1,
    currentSmoothedC: 29.4,
    observedHighC: 29.8,
    slope15mCPerHour: -0.6,
    slope30mCPerHour: -0.4,
  };
  const lowerTarget = computeRemainingCeilings({ ...inputs, targetC: 30 });
  const higherTarget = computeRemainingCeilings({ ...inputs, targetC: 31 });

  assert.equal(lowerTarget.remainingRuleCeilingC, 30.8);
  assert.equal(higherTarget.remainingRuleCeilingC, 30.8);
  assert.equal(lowerTarget.marginBelowTargetC, -0.8);
  assert.equal(higherTarget.marginBelowTargetC, 0.2);
});

test("negative live bias cannot lower the conservative forecast ceiling", () => {
  const now = Date.UTC(2026, 6, 31, 5);
  const result = computeRemainingCeilings({
    forecastRows: forecastRows(now, [26, 26]),
    evaluatedAt: now,
    endOfDayUtc: now + 12 * HOUR_MS,
    liveBiasC: -1,
    currentSmoothedC: 25,
    observedHighC: 25.5,
    slope15mCPerHour: -0.4,
    slope30mCPerHour: -0.2,
  });

  assert.equal(result.kmaRemainingBestHighC, 25.3);
  assert.equal(result.kmaRemainingUpperC, 26.7);
});

test("confirmation needs a candidate plus three checks spanning 15 minutes", () => {
  const firstAt = Date.UTC(2026, 6, 31, 6);
  const base = {
    observedHighC: 26.3,
    targetC: 27,
    remainingRuleCeilingC: 26.8,
    criticalBlockerCount: 0,
    blockerCount: 0,
  };
  const first = advanceDecisionState({
    ...base,
    previousState: null,
    evaluatedAt: firstAt,
    evaluationSlotUtc: firstAt,
  });
  assert.equal(first.currentState, "peak_candidate");
  assert.equal(first.consecutivePasses, 0);

  const duplicate = advanceDecisionState({
    ...base,
    previousState: {
      ...first,
      lastEvaluationSlotUtc: firstAt,
    },
    evaluatedAt: firstAt + MINUTE_MS,
    evaluationSlotUtc: firstAt,
  });
  assert.equal(duplicate.consecutivePasses, 0);

  const secondAt = firstAt + DECISION_INTERVAL_MS;
  const second = advanceDecisionState({
    ...base,
    previousState: {
      ...duplicate,
      lastEvaluationSlotUtc: firstAt,
    },
    evaluatedAt: secondAt,
    evaluationSlotUtc: secondAt,
  });
  assert.equal(second.consecutivePasses, 1);
  assert.equal(second.currentState, "peak_candidate");

  const thirdAt = secondAt + DECISION_INTERVAL_MS;
  const third = advanceDecisionState({
    ...base,
    previousState: {
      ...second,
      lastEvaluationSlotUtc: secondAt,
    },
    evaluatedAt: thirdAt,
    evaluationSlotUtc: thirdAt,
  });
  assert.equal(third.consecutivePasses, 2);
  assert.equal(third.currentState, "peak_candidate");

  const fourthAt = thirdAt + DECISION_INTERVAL_MS;
  const fourth = advanceDecisionState({
    ...base,
    previousState: {
      ...third,
      lastEvaluationSlotUtc: thirdAt,
    },
    evaluatedAt: fourthAt,
    evaluationSlotUtc: fourthAt,
  });
  assert.equal(fourth.consecutivePasses, 3);
  assert.equal(fourth.currentState, "unlikely_to_reach");
});

test("already reached is evaluated against the selected target", () => {
  const now = Date.UTC(2026, 6, 31, 6);
  const common = {
    previousState: null,
    evaluatedAt: now,
    evaluationSlotUtc: now,
    observedHighC: 29,
    remainingRuleCeilingC: 30.8,
    criticalBlockerCount: 0,
    blockerCount: 0,
  };

  const lowerTarget = advanceDecisionState({ ...common, targetC: 27 });
  const higherTarget = advanceDecisionState({ ...common, targetC: 31 });
  const exactTarget = advanceDecisionState({
    ...common,
    observedHighC: 31,
    targetC: 31,
  });

  assert.equal(lowerTarget.currentState, "already_reached");
  assert.equal(higherTarget.currentState, "peak_candidate");
  assert.equal(higherTarget.consecutivePasses, 0);
  assert.equal(exactTarget.currentState, "already_reached");
});

test("confirmation history never carries between target temperatures", () => {
  const now = Date.UTC(2026, 6, 31, 6);
  const result = advanceDecisionState({
    previousState: {
      targetC: 27,
      currentState: "unlikely_to_reach",
      consecutivePasses: 3,
      candidateSinceUtc: now - 15 * MINUTE_MS,
      lastEvaluationSlotUtc: now - DECISION_INTERVAL_MS,
    },
    evaluatedAt: now,
    evaluationSlotUtc: now,
    observedHighC: 29,
    targetC: 31,
    remainingRuleCeilingC: 30.8,
    criticalBlockerCount: 0,
    blockerCount: 0,
  });

  assert.equal(result.currentState, "peak_candidate");
  assert.equal(result.consecutivePasses, 0);
  assert.equal(result.candidateSinceUtc, now);
});

test("returning to a target after missed slots restarts confirmation", () => {
  const now = Date.UTC(2026, 6, 31, 6);
  const result = advanceDecisionState({
    previousState: {
      targetC: 31,
      currentState: "unlikely_to_reach",
      consecutivePasses: 3,
      candidateSinceUtc: now - 30 * MINUTE_MS,
      lastEvaluationSlotUtc: now - 2 * DECISION_INTERVAL_MS,
    },
    evaluatedAt: now,
    evaluationSlotUtc: now,
    observedHighC: 29,
    targetC: 31,
    remainingRuleCeilingC: 30.8,
    criticalBlockerCount: 0,
    blockerCount: 0,
  });

  assert.equal(result.currentState, "peak_candidate");
  assert.equal(result.consecutivePasses, 0);
  assert.equal(result.candidateSinceUtc, now);
});

test("a blocker immediately revokes a confirmed state", () => {
  const now = Date.UTC(2026, 6, 31, 6);
  const result = advanceDecisionState({
    previousState: {
      currentState: "unlikely_to_reach",
      consecutivePasses: 3,
      candidateSinceUtc: now - 10 * MINUTE_MS,
      lastEvaluationSlotUtc: now - DECISION_INTERVAL_MS,
    },
    evaluatedAt: now,
    evaluationSlotUtc: now,
    observedHighC: 26.3,
    targetC: 27,
    remainingRuleCeilingC: 26.8,
    criticalBlockerCount: 0,
    blockerCount: 1,
  });

  assert.equal(result.currentState, "still_possible");
  assert.equal(result.consecutivePasses, 0);
  assert.equal(result.candidateSinceUtc, null);
});

test("future threshold outcomes are censored across an observation outage", () => {
  const decisionAt = Date.UTC(2026, 6, 31, 6);
  const endOfDayUtc = decisionAt + HOUR_MS;
  const continuous = observationRows({
    startAt: decisionAt + MINUTE_MS,
    minutes: 60,
  });
  assert.equal(
    assessFutureObservationCoverage(continuous, decisionAt, endOfDayUtc)
      .complete,
    true,
  );

  const outage = continuous.filter(
    (row) =>
      row.obsTimeUtc < decisionAt + 20 * MINUTE_MS ||
      row.obsTimeUtc > decisionAt + 35 * MINUTE_MS,
  );
  const result = assessFutureObservationCoverage(
    outage,
    decisionAt,
    endOfDayUtc,
  );
  assert.equal(result.complete, false);
  assert.equal(result.maxGapMinutes, 17);

  const fourMinuteGap = continuous.filter(
    (row) =>
      row.obsTimeUtc < decisionAt + 20 * MINUTE_MS ||
      row.obsTimeUtc > decisionAt + 22 * MINUTE_MS,
  );
  const fourMinuteGapResult = assessFutureObservationCoverage(
    fourMinuteGap,
    decisionAt,
    endOfDayUtc,
  );
  assert.equal(fourMinuteGapResult.maxGapMinutes, 4);
  assert.equal(fourMinuteGapResult.complete, false);
});

test("wind direction differences wrap across north", () => {
  assert.equal(circularDifferenceDegrees(350, 10), 20);
  assert.equal(circularDifferenceDegrees(20, 200), 180);
});
