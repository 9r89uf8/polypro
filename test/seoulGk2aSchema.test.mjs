import assert from "node:assert/strict";
import test from "node:test";

import schema from "../convex/schema.js";

test("GK2A collector status accepts the resolved-frame checkpoint", () => {
  const exportedSchema = JSON.parse(schema.export());
  const statusTable = exportedSchema.tables.find(
    (table) => table.tableName === "seoulGk2aCollectorStatus",
  );
  const field = statusTable?.documentType?.value?.lastResolvedFrameTimeUtc;

  assert.ok(statusTable, "seoulGk2aCollectorStatus must exist");
  assert.deepEqual(field, {
    fieldType: { type: "number" },
    optional: true,
  });
});

test("Seoul v2 decision state and immutable snapshot fields are declared", () => {
  const exportedSchema = JSON.parse(schema.export());
  const predictions = exportedSchema.tables.find(
    (table) => table.tableName === "seoulHighPredictions",
  );
  const state = exportedSchema.tables.find(
    (table) => table.tableName === "seoulPeakDecisionState",
  );
  const activeTargets = exportedSchema.tables.find(
    (table) => table.tableName === "seoulPeakActiveTargets",
  );
  const evaluations = exportedSchema.tables.find(
    (table) => table.tableName === "seoulHighEvaluations",
  );

  assert.ok(predictions, "seoulHighPredictions must exist");
  assert.ok(state, "seoulPeakDecisionState must exist");
  assert.ok(activeTargets, "seoulPeakActiveTargets must exist");
  assert.ok(evaluations, "seoulHighEvaluations must exist");
  for (const field of [
    "currentSmoothedC",
    "kmaRemainingUpperC",
    "remainingRuleCeilingC",
    "decisionStatus",
    "blockerCodes",
    "kmaDailyHourlyHighGapC",
    "kmaRevisionUpwardDetected",
    "solarDsrWm2",
    "solarDecisionRequired",
    "secondary16LCurrentC",
    "weathercomVetoActive",
  ]) {
    assert.ok(
      predictions.documentType.value[field],
      `seoulHighPredictions.${field} must exist`,
    );
  }
  for (const field of [
    "evaluatedUnlikelyDeclarationCount",
    "censoredUnlikelyDeclarationCount",
    "thresholdObservationCoverageComplete",
    "thresholdMaxFutureGapMinutes",
  ]) {
    assert.ok(
      evaluations.documentType.value[field],
      `seoulHighEvaluations.${field} must exist`,
    );
  }
  for (const field of [
    "lastKmaForecastCaptureId",
    "lastKmaDailyHighC",
    "lastKmaRemainingUpperC",
    "lastKmaHourlyRows",
    "solarDecisionRequired",
  ]) {
    assert.ok(
      state.documentType.value[field],
      `seoulPeakDecisionState.${field} must exist`,
    );
  }
  for (const field of [
    "stationIcao",
    "targetDate",
    "modelVersion",
    "targetC",
    "createdAt",
    "updatedAt",
  ]) {
    assert.ok(
      activeTargets.documentType.value[field],
      `seoulPeakActiveTargets.${field} must exist`,
    );
  }
  assert.ok(
    predictions.indexes.some(
      (index) =>
        index.indexDescriptor === "by_station_date_model_target_revision" &&
        index.fields.join(",") ===
          "stationIcao,targetDate,modelVersion,targetC,revision",
    ),
  );
  assert.ok(
    state.indexes.some(
      (index) =>
        index.indexDescriptor === "by_station_date_model_target" &&
        index.fields.join(",") ===
          "stationIcao,targetDate,modelVersion,targetC",
    ),
  );
  assert.ok(
    activeTargets.indexes.some(
      (index) =>
        index.indexDescriptor === "by_station_date_model_target" &&
        index.fields.join(",") ===
          "stationIcao,targetDate,modelVersion,targetC",
    ),
  );
  assert.ok(
    evaluations.indexes.some(
      (index) =>
        index.indexDescriptor === "by_station_model_date_target" &&
        index.fields.join(",") ===
          "stationIcao,modelVersion,targetDate,thresholdTargetC",
    ),
  );
  assert.ok(
    evaluations.indexes.some(
      (index) =>
        index.indexDescriptor === "by_station_model_target_finalizedAt" &&
        index.fields.join(",") ===
          "stationIcao,modelVersion,thresholdTargetC,finalizedAt",
    ),
  );
});
