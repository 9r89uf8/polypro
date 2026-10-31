import { defineTable } from "convex/server";
import { v } from "convex/values";

const checkpoint = v.union(v.literal("09:00"), v.literal("12:00"));
const peakForecast = v.object({
  count: v.number(),
  peakFirstMinutes: v.array(v.number()), peakLastMinutes: v.array(v.number()),
  peakAheadProbability: v.number(), predictedMaxC: v.number(),
  predictedMaxRangeC: v.optional(v.array(v.number())),
});
const peakScore = v.object({
  peakErrorMinutes: v.number(), covered: v.boolean(), brierPeakAhead: v.number(), maxErrorC: v.number(),
});

export const seoulAnalogPeakTables = {
  // One immutable record per KST date and checkpoint. Scores live separately.
  seoulAnalogPeakForecasts: defineTable({
    stationIcao: v.literal("RKSI"), date: v.string(), checkpoint,
    issuedAt: v.number(), modelVersion: v.string(), libraryVersion: v.string(),
    status: v.union(v.literal("ready"), v.literal("unavailable")), reason: v.optional(v.string()),
    inputReportTimesUtc: v.array(v.number()), checkpointReceivedAt: v.optional(v.number()),
    features: v.optional(v.object({ tempC: v.number(), maxSoFarC: v.number(), vector: v.array(v.number()) })),
    poolCount: v.optional(v.number()), analog: v.optional(peakForecast), season: v.optional(peakForecast),
    analogs: v.optional(v.array(v.object({
      date: v.string(), distance: v.number(), maxC: v.number(), peakFirstMinutes: v.number(), peakLastMinutes: v.number(),
    }))),
  })
    .index("by_station_date_checkpoint", ["stationIcao", "date", "checkpoint"])
    .index("by_station_status_date", ["stationIcao", "status", "date"]),

  seoulAnalogPeakOutcomes: defineTable({
    forecastId: v.id("seoulAnalogPeakForecasts"), stationIcao: v.literal("RKSI"), date: v.string(), checkpoint,
    status: v.union(v.literal("scored"), v.literal("missing")), scoredAt: v.number(), reportCount: v.number(),
    actualMaxC: v.optional(v.number()), actualPeakFirstMinutes: v.optional(v.number()), actualPeakLastMinutes: v.optional(v.number()),
    peakAhead: v.optional(v.boolean()), analog: v.optional(peakScore), season: v.optional(peakScore),
  })
    .index("by_forecast", ["forecastId"])
    .index("by_station_date", ["stationIcao", "date"]),
};
