import { defineTable } from "convex/server";
import { v } from "convex/values";

export const satelliteChannel = v.union(v.literal("visible"), v.literal("infrared"), v.literal("cloudAnalysis"));
export const satelliteSourceCandidate = v.object({
  key: v.string(), band: v.string(), resolution: v.string(), nominalTimeUtc: v.number(),
  sourceLastModifiedAt: v.number(), sourceSize: v.number(),
});
export const satelliteBundleGap = v.object({ nominalTimeUtc: v.number(), missingBands: v.array(v.string()) });
export const satelliteCandidate = v.object({
  key: v.string(), channel: satelliteChannel, nominalTimeUtc: v.number(),
  sourceLastModifiedAt: v.number(), sourceSize: v.number(),
  sources: v.optional(v.array(satelliteSourceCandidate)),
});
export const satelliteFrameFields = {
  stationIcao: v.literal("RKSI"), channel: satelliteChannel,
  source: v.literal("noaa_himawari9"), sourceKey: v.string(),
  nominalTimeUtc: v.number(), obsTimeUtc: v.number(),
  status: v.union(v.literal("ok"), v.literal("unavailable")),
  storageId: v.optional(v.id("_storage")), reason: v.optional(v.string()),
  sourceLastModifiedAt: v.number(), sourceSize: v.number(),
  fetchedAt: v.number(), capturedAt: v.number(),
  sourceSha256: v.optional(v.string()), imageSha256: v.optional(v.string()),
  rendererVersion: v.optional(v.string()),
  sourceObjects: v.optional(v.array(v.object({
    key: v.string(), band: v.string(), resolution: v.string(), nominalTimeUtc: v.number(),
    sourceLastModifiedAt: v.number(), sourceSize: v.number(), fetchedAt: v.number(),
    sourceSha256: v.string(), observedAt: v.optional(v.number()),
  }))),
  solarElevationDeg: v.optional(v.number()), validFraction: v.optional(v.number()),
  geometry: v.optional(v.any()), display: v.optional(v.any()),
};
export const satelliteFrameValidator = v.object(satelliteFrameFields);

export const seoulSatelliteTables = {
  seoulSatelliteFrames: defineTable(satelliteFrameFields)
    .index("by_station_channel_time", ["stationIcao", "channel", "obsTimeUtc"])
    .index("by_station_time", ["stationIcao", "obsTimeUtc"])
    .index("by_station_key", ["stationIcao", "sourceKey"])
    .index("by_storage", ["storageId"]),
  seoulSatelliteCollectorStatus: defineTable({
    stationIcao: v.literal("RKSI"), status: v.string(), updatedAt: v.number(),
    queuedAt: v.optional(v.number()), lastAttemptAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()), lastError: v.optional(v.string()),
    activeRunId: v.optional(v.string()), runStartedAt: v.optional(v.number()),
    runRendererVersion: v.optional(v.string()),
    leaseUntil: v.optional(v.number()), workerToken: v.optional(v.string()),
    workerActiveUntil: v.optional(v.number()), workerSequence: v.optional(v.number()),
    continuationCount: v.optional(v.number()), planReady: v.optional(v.boolean()),
    lastDiscoveryAt: v.optional(v.number()), bundleGaps: v.optional(v.array(satelliteBundleGap)),
    pendingCandidates: v.optional(v.array(satelliteCandidate)),
    cleanupCursor: v.optional(v.string()),
    sourceFailures: v.optional(v.array(v.object({ key: v.string(), channel: satelliteChannel,
      nominalTimeUtc: v.number(), failedAt: v.number(), error: v.string() }))),
  }).index("by_station", ["stationIcao"]),
};
