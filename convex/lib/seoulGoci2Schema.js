import { defineTable } from "convex/server";
import { v } from "convex/values";

// KHOA/NOSC has not published reuse terms for GOCI-II OPeNDAP files. Every
// download, stored image and public read requires this exact-"true" flag.
export const GOCI2_APPROVAL_FLAG = "KHOA_GOCI2_ACCESS_APPROVED";
export const GOCI2_RENDERER_VERSION = "rksi-goci2-truecolor-v1";
export const GOCI2_IMAGE_CONTENT_TYPE = "image/png; profile=rksi-goci2-truecolor-v1";
export const GOCI2_IMAGE_SIZE = 512;
export const GOCI2_IMAGE_SPAN_KM = 100;
export const GOCI2_RETENTION_MS = 24 * 60 * 60_000;
export const GOCI2_SOURCE_LABEL = "KHOA NOSC GOCI-II (GK-2B) L1B";

export const goci2SourceObject = v.object({
  variable: v.string(), constraint: v.string(), bytes: v.number(), sha256: v.string(),
});
export const goci2FrameFields = {
  stationIcao: v.literal("RKSI"), source: v.literal("khoa_nosc_goci2"),
  sourceKey: v.string(), slot: v.string(),
  nominalTimeUtc: v.number(), obsTimeUtc: v.number(),
  observationStartUtc: v.number(), observationEndUtc: v.number(),
  status: v.union(v.literal("ok"), v.literal("unavailable")),
  storageId: v.optional(v.id("_storage")), reason: v.optional(v.string()),
  sourceSize: v.optional(v.number()), sourceLastModifiedAt: v.optional(v.number()),
  fetchedAt: v.number(), capturedAt: v.number(),
  rendererVersion: v.string(), imageSha256: v.optional(v.string()),
  sourceObjects: v.array(goci2SourceObject),
  subset: v.object({ rowStart: v.number(), rowEnd: v.number(), columnStart: v.number(), columnEnd: v.number(),
    gridRows: v.number(), gridColumns: v.number() }),
  solarElevationDeg: v.optional(v.number()), validFraction: v.optional(v.number()),
  geometry: v.optional(v.any()), display: v.optional(v.any()),
};
export const goci2FrameValidator = v.object(goci2FrameFields);

export const seoulGoci2Tables = {
  seoulGoci2Frames: defineTable(goci2FrameFields)
    .index("by_station_time", ["stationIcao", "obsTimeUtc"])
    .index("by_station_key", ["stationIcao", "sourceKey"])
    .index("by_storage", ["storageId"]),
  seoulGoci2CollectorStatus: defineTable({
    stationIcao: v.literal("RKSI"), status: v.string(), updatedAt: v.number(),
    queuedAt: v.optional(v.number()), lastAttemptAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()), lastError: v.optional(v.string()),
    activeRunId: v.optional(v.string()), runStartedAt: v.optional(v.number()),
    leaseUntil: v.optional(v.number()), workerToken: v.optional(v.string()),
    workerActiveUntil: v.optional(v.number()), workerSequence: v.optional(v.number()),
    lastSlot: v.optional(v.string()), cleanupCursor: v.optional(v.string()),
    sourceFailures: v.optional(v.array(v.object({ sourceKey: v.string(), nominalTimeUtc: v.number(),
      failedAt: v.number(), error: v.string() }))),
  }).index("by_station", ["stationIcao"]),
};
