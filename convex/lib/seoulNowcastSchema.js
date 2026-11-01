// The 15L minute nowcast was removed on November 2, 2026. These definitions
// stay only so its stored rows keep validating; no function reads or writes
// them. Clear the four tables before removing this file from the schema.
import { defineTable } from "convex/server";
import { v } from "convex/values";

const nullableNumber = v.union(v.number(), v.null());
const nullableString = v.union(v.string(), v.null());

// Fixed KST issue-time windows for score breakdowns. They do not follow
// sunrise, which moves with the season.
export const NOWCAST_TIME_OF_DAY_WINDOWS = Object.freeze([
  { key: "overnight", startHourKst: 0, endHourKst: 6 },
  { key: "morning", startHourKst: 6, endHourKst: 10 },
  { key: "midday", startHourKst: 10, endHourKst: 14 },
  { key: "afternoon", startHourKst: 14, endHourKst: 18 },
  { key: "evening", startHourKst: 18, endHourKst: 24 },
]);
// Seasonal-drift sums start at zero when the drift test was added, so rows and
// windows written earlier simply lack them; no earlier drift forecasts exist.
const driftScoreFields = {
  driftPairedCount: v.optional(v.number()), driftPairedPersistenceAbsErrorSum: v.optional(v.number()),
  driftAbsErrorSum: v.optional(v.number()), driftErrorSum: v.optional(v.number()),
};
const timeOfDayScore = v.object({
  scoredCount: v.number(), pairedCount: v.number(),
  persistenceAbsErrorSum: v.number(), pairedPersistenceAbsErrorSum: v.number(),
  dampedAbsErrorSum: v.number(), persistenceErrorSum: v.number(), dampedErrorSum: v.number(),
  ...driftScoreFields,
});
export const nowcastPrediction = v.object({
  horizonMinutes: v.number(), targetTimeUtc: v.number(),
  observationLeadMinutes: v.number(), actualLeadMinutes: v.number(),
  persistenceC: v.number(), dampedTrendC: nullableNumber,
  climatologyDriftC: v.optional(v.number()),
});

export const seoulNowcastTables = {
  // Append-only, normalized source payload versions. receivedAt is the first
  // database capture of THIS version, never a reconstructed HTTP receipt.
  seoulNowcastObservationVersions: defineTable({
    stationIcao: v.literal("RKSI"), rwyNo: v.string(), rwyDir: v.string(),
    collectionCadence: v.literal("one_minute"), obsTimeUtc: v.number(),
    receivedAt: v.number(), sourceFirstSeenAt: v.optional(v.number()),
    temperatureValid: v.boolean(),
    obsTimeLocal: v.optional(v.string()), source: v.optional(v.string()),
    rwyUse: v.optional(v.string()), rwyMain: v.optional(v.string()),
    tempC: v.optional(v.number()), dewpointC: v.optional(v.number()),
    qnhHpa: v.optional(v.number()), windDirAvg: v.optional(v.number()),
    windDirMin: v.optional(v.number()), windDirMax: v.optional(v.number()),
    windSpeedAvg: v.optional(v.number()), windSpeedMin: v.optional(v.number()),
    windSpeedMax: v.optional(v.number()), crosswind: v.optional(v.string()),
    headtail: v.optional(v.string()), morMeters: v.optional(v.number()),
    rvrMeters: v.optional(v.string()), precipMm: v.optional(v.number()),
  })
    .index("by_station_site_time", ["stationIcao", "rwyDir", "obsTimeUtc", "receivedAt"])
    .index("by_target_valid", ["stationIcao", "rwyDir", "obsTimeUtc", "temperatureValid", "receivedAt"])
    .index("by_received", ["receivedAt"]),

  // These records are never patched. Scoring is kept in a separate table.
  seoulNowcastForecasts: defineTable({
    stationIcao: v.literal("RKSI"), date: v.string(),
    triggerObsTimeUtc: v.number(), modelVersion: v.string(), issuedAt: v.number(),
    driftModelVersion: v.optional(v.string()),
    qualityStatus: v.union(v.literal("ready"), v.literal("persistence_only"), v.literal("unavailable")),
    reasonCode: nullableString, reason: nullableString,
    intervalStatus: v.literal("insufficient_calibration"),
    latestObservationTimeUtc: nullableNumber, latestObservationReceivedAt: nullableNumber,
    observationAgeMinutes: nullableNumber,
    inputVersionIds: v.array(v.id("seoulNowcastObservationVersions")),
    features: v.any(), predictions: v.array(nowcastPrediction),
  })
    .index("by_trigger_model", ["stationIcao", "triggerObsTimeUtc", "modelVersion"])
    .index("by_station_date_issued", ["stationIcao", "date", "issuedAt"])
    .index("by_issued", ["issuedAt"]),

  seoulNowcastOutcomes: defineTable({
    forecastId: v.id("seoulNowcastForecasts"), stationIcao: v.literal("RKSI"),
    date: v.string(), modelVersion: v.string(), issuedAt: v.number(),
    horizonMinutes: v.number(), targetTimeUtc: v.number(),
    persistenceC: v.number(), dampedTrendC: nullableNumber,
    climatologyDriftC: v.optional(v.number()), driftModelVersion: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("scored"), v.literal("missing")),
    scoringVersion: v.string(), actualC: v.optional(v.number()),
    observationVersionId: v.optional(v.id("seoulNowcastObservationVersions")),
    targetReceivedAt: v.optional(v.number()), scoredAt: v.optional(v.number()),
    persistenceErrorC: v.optional(v.number()), dampedErrorC: v.optional(v.number()),
    driftErrorC: v.optional(v.number()),
  })
    .index("by_station_status_target", ["stationIcao", "status", "targetTimeUtc"])
    .index("by_station_date_status_target", ["stationIcao", "date", "status", "targetTimeUtc"])
    .index("by_forecast", ["forecastId"])
    .index("by_issued", ["issuedAt"]),

  seoulNowcastDailyScores: defineTable({
    stationIcao: v.literal("RKSI"), modelVersion: v.string(), date: v.string(),
    horizonMinutes: v.number(), dayStartUtc: v.number(),
    issuedCount: v.number(), scoredCount: v.number(), missingCount: v.number(),
    pairedCount: v.number(), persistenceAbsErrorSum: v.number(),
    pairedPersistenceAbsErrorSum: v.number(), dampedAbsErrorSum: v.number(),
    persistenceErrorSum: v.number(), dampedErrorSum: v.number(),
    ...driftScoreFields,
    // Present once every scored outcome on the row is included. Rows written
    // before the breakdown lack it until backfillTimeOfDayScores runs.
    timeOfDay: v.optional(v.object(Object.fromEntries(NOWCAST_TIME_OF_DAY_WINDOWS
      .map(({ key }) => [key, v.optional(timeOfDayScore)])))),
  })
    .index("by_station_model_date_horizon", ["stationIcao", "modelVersion", "date", "horizonMinutes"])
    .index("by_day", ["dayStartUtc"]),
};
