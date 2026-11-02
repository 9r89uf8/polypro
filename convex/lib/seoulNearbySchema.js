import { defineTable } from "convex/server";
import { v } from "convex/values";

// Readings are stored exactly as KMA reports them: temperature is the one-minute
// average, wind the ten-minute average, speed in m/s. See docs/seoul.md.
export const nearbyObservationInput = v.object({
  stationId: v.number(), obsTimeUtc: v.number(), obsTimeLocal: v.string(), rawLine: v.string(),
  tempC: v.optional(v.number()), windDirDeg: v.optional(v.number()), windSpeedMs: v.optional(v.number()),
});

export const nearbyStationResult = v.object({
  stationId: v.number(), status: v.union(v.literal("ok"), v.literal("no_rows"), v.literal("error")),
  latestObsTimeUtc: v.optional(v.number()), errorCode: v.optional(v.string()),
});

export const seoulNearbyTables = {
  seoulNearbyStationObservations: defineTable({
    stationId: v.number(), obsTimeUtc: v.number(), obsTimeLocal: v.string(),
    tempC: v.optional(v.number()), windDirDeg: v.optional(v.number()), windSpeedMs: v.optional(v.number()),
    source: v.literal("kma_apihub_aws_minute"), rawLine: v.string(),
    firstSeenAt: v.number(), updatedAt: v.number(),
  })
    .index("by_station_obs_ts", ["stationId", "obsTimeUtc"])
    .index("by_obs_ts", ["obsTimeUtc"]),
  seoulNearbyCollectorStatus: defineTable({
    stationIcao: v.literal("RKSI"), status: v.string(), updatedAt: v.number(),
    collectionQueuedAt: v.optional(v.number()), collectionInFlightSince: v.optional(v.number()), collectionRunId: v.optional(v.string()),
    lastAttemptAt: v.optional(v.number()), lastSuccessAt: v.optional(v.number()), latestObsTimeUtc: v.optional(v.number()),
    errorCode: v.optional(v.string()), lastError: v.optional(v.string()), stations: v.optional(v.array(nearbyStationResult)),
  }).index("by_station", ["stationIcao"]),
};
