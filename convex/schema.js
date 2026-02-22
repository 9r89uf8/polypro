import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  monthRuns: defineTable({
    stationIcao: v.string(),
    stationIem: v.string(),
    year: v.number(),
    month: v.number(),
    manualUnit: v.union(v.literal("C"), v.literal("F")),
    createdAt: v.number(),
    updatedAt: v.number(),
    metarLastComputedAt: v.optional(v.number()),
    metarLastStatus: v.union(
      v.literal("idle"),
      v.literal("computing"),
      v.literal("ok"),
      v.literal("error"),
    ),
    metarLastError: v.optional(v.string()),
    metarAllLastComputedAt: v.optional(v.number()),
    metarAllLastStatus: v.optional(
      v.union(
        v.literal("idle"),
        v.literal("computing"),
        v.literal("ok"),
        v.literal("error"),
      ),
    ),
    metarAllLastError: v.optional(v.string()),
  }).index("by_station_month", ["stationIcao", "year", "month"]),

  dailyComparisons: defineTable({
    stationIcao: v.string(),
    date: v.string(),
    manualMaxC: v.optional(v.number()),
    manualMaxF: v.optional(v.number()),
    manualNotes: v.optional(v.string()),
    metarMaxC: v.optional(v.number()),
    metarMaxF: v.optional(v.number()),
    metarMaxAtUtc: v.optional(v.number()),
    metarMaxAtLocal: v.optional(v.string()),
    metarObsCount: v.optional(v.number()),
    metarMaxRaw: v.optional(v.string()),
    metarMaxSource: v.optional(v.string()),
    deltaC: v.optional(v.number()),
    deltaF: v.optional(v.number()),
    metarAllMaxC: v.optional(v.number()),
    metarAllMaxF: v.optional(v.number()),
    metarAllMaxAtUtc: v.optional(v.number()),
    metarAllMaxAtLocal: v.optional(v.string()),
    metarAllObsCount: v.optional(v.number()),
    metarAllMaxRaw: v.optional(v.string()),
    metarAllMaxSource: v.optional(v.string()),
    deltaAllC: v.optional(v.number()),
    deltaAllF: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_station_date", ["stationIcao", "date"]),
});
