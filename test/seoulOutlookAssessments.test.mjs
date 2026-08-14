import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyForecastHigh,
  classifyHighLock,
  classifyKmaDifferenceMagnitude,
  classifyWarmingMomentum,
} from "../app/seoul/day/[date]/outlookAssessments.js";

test("high lock requires the exact next tenth and a recent confirmation", () => {
  const base = {
    observedHighC: 30.6,
    nextHighTargetC: 30.7,
    dashboardTargetC: 30.7,
    decisionStatus: "unlikely_to_reach",
    amosFresh: true,
    decisionAgeMs: 5 * 60 * 1000,
  };
  assert.equal(classifyHighLock(base), "locked");
  assert.equal(classifyHighLock({ ...base, dashboardTargetC: 31 }), "pending");
  assert.equal(
    classifyHighLock({ ...base, decisionAgeMs: 11 * 60 * 1000 }),
    "stale_decision",
  );
  assert.equal(
    classifyHighLock({ ...base, decisionStatus: "still_possible" }),
    "possible",
  );
});

test("forecast assessment distinguishes met, exceeded, revised, and likely high", () => {
  const base = {
    forecastHighC: 31,
    observedHighC: 30.6,
    dashboardTargetC: 31,
    decisionStatus: "still_possible",
    amosFresh: true,
    decisionAgeMs: 5 * 60 * 1000,
    predictionAgeMs: 5 * 60 * 1000,
    predictionStatus: "on_track",
  };
  assert.equal(classifyForecastHigh({ ...base, observedHighC: 31 }), "met");
  assert.equal(
    classifyForecastHigh({ ...base, observedHighC: 31.1 }),
    "exceeded",
  );
  assert.equal(
    classifyForecastHigh({
      ...base,
      decisionStatus: "unlikely_to_reach",
    }),
    "likely_too_high",
  );
  assert.equal(
    classifyForecastHigh({ ...base, dashboardTargetC: 30 }),
    "starting",
  );
  assert.equal(
    classifyForecastHigh({
      ...base,
      observedHighC: 31.1,
      forecastStale: true,
    }),
    "stale_exceeded",
  );
});

test("KMA difference presentation changes at the documented half-degree boundary", () => {
  assert.equal(classifyKmaDifferenceMagnitude(0.4), "within_resolution");
  assert.equal(classifyKmaDifferenceMagnitude(-0.4), "within_resolution");
  assert.equal(classifyKmaDifferenceMagnitude(0.5), "material");
});

test("warming momentum uses the exact three-window 0.2 C/hour boundaries", () => {
  const classify = (slopes) =>
    classifyWarmingMomentum({ amosFresh: true, ...slopes });

  assert.equal(
    classify({
      slope60mCPerHour: 0.8,
      slope30mCPerHour: 0.6,
      slope15mCPerHour: 0.4,
    }),
    "slowing",
  );
  assert.equal(
    classify({
      slope60mCPerHour: 0.6,
      slope30mCPerHour: 0.4,
      slope15mCPerHour: 0.1,
    }),
    "leveled_off",
  );
  assert.equal(
    classify({
      slope60mCPerHour: 0.1,
      slope30mCPerHour: -0.1,
      slope15mCPerHour: -0.2,
    }),
    "cooling",
  );
  assert.equal(
    classify({
      slope60mCPerHour: 0.4,
      slope30mCPerHour: 0.6,
      slope15mCPerHour: 0.8,
    }),
    "accelerating",
  );
  assert.equal(
    classify({
      slope60mCPerHour: 0.8,
      slope30mCPerHour: 0.7,
      slope15mCPerHour: 0.4,
    }),
    "warming_mixed",
  );
  assert.equal(
    classify({
      slope60mCPerHour: 0.1,
      slope30mCPerHour: 0.1,
      slope15mCPerHour: 0.4,
    }),
    "resumed",
  );
  assert.equal(
    classifyWarmingMomentum({
      amosFresh: false,
      slope60mCPerHour: 0.8,
      slope30mCPerHour: 0.6,
      slope15mCPerHour: 0.4,
    }),
    "stale",
  );
});
