//convex/schema.js
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  notes: defineTable({
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    imageIds: v.array(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

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


    kordPhoneCalls: defineTable({
        stationIcao: v.string(),
        date: v.string(), // YYYY-MM-DD (Chicago)
        slotLocal: v.string(), // YYYY-MM-DD HH:MM (Chicago) scheduled slot or manual trigger time
        tsUtc: v.optional(v.number()), // recording start (ms epoch)
        tsLocal: v.optional(v.string()), // YYYY-MM-DD HH:MM (Chicago), derived from tsUtc

        callSid: v.optional(v.string()),
        recordingSid: v.optional(v.string()),
        recordingUrl: v.optional(v.string()),
        recordingDuration: v.optional(v.number()),

        transcript: v.optional(v.string()),

        tempC: v.optional(v.number()),
        tempF: v.optional(v.number()),

        status: v.union(
            v.literal("queued"),
            v.literal("calling"),
            v.literal("recorded"),
            v.literal("transcribed"),
            v.literal("parsed"),
            v.literal("error"),
        ),
        error: v.optional(v.string()),

        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_station_date", ["stationIcao", "date"])
        .index("by_station_slot", ["stationIcao", "slotLocal"])
        .index("by_callSid", ["callSid"]),

  metarObservations: defineTable({
    stationIcao: v.string(),
    mode: v.union(v.literal("official"), v.literal("all")),
    date: v.string(),
    tsUtc: v.number(),
    tsLocal: v.string(),
    tempC: v.number(),
    tempF: v.number(),
    rawMetar: v.string(),
    source: v.string(),
    noaaFirstSeenAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_station_mode_date_ts", ["stationIcao", "mode", "date", "tsUtc"]),


    locations: defineTable({
        name: v.string(),                 // "Chicago O'Hare Intl Airport"
        timeZone: v.string(),             // "America/Chicago"
        lat: v.number(),
        lon: v.number(),
        stationIcao: v.optional(v.string()),
        accuweatherLocationKey: v.string(),
        accuweatherType: v.optional(v.string()),
        accuweatherEnglishName: v.optional(v.string()),
        active: v.boolean(),
    })
        .index("by_accuweatherKey", ["accuweatherLocationKey"])
        .index("by_active", ["active"]),

    observations: defineTable({
        locationId: v.id("locations"),
        epochMs: v.number(),
        epochHourBucketMs: v.number(),    // used for idempotency (one obs per hour)
        localDateISO: v.string(),         // YYYY-MM-DD in location tz
        localHour: v.number(),            // 0-23 in location tz
        tempF: v.number(),
    })
        .index("by_location_date", ["locationId", "localDateISO"])
        .index("by_location_epochHour", ["locationId", "epochHourBucketMs"]),

    highPredictions: defineTable({
        locationId: v.id("locations"),
        hoursCoveredForTarget: v.number(),

        leadHoursToTargetStart: v.optional(v.number()),
        fetchedAtMs: v.number(),
        fetchedHourBucketMs: v.number(),  // idempotency: one snapshot per hour
        fetchedLocalDateISO: v.string(),
        fetchedLocalHour: v.number(),

        targetDateISO: v.string(),        // day we are predicting
        leadDays: v.number(),             // typically 0..3 from 72h forecast coverage

        predictedHighF: v.number(),
        predictedHighTimeEpochMs: v.number(),

        // Filled in at local midnight AFTER the target day ends
        actualHighF: v.optional(v.number()),
        actualHighTimeEpochMs: v.optional(v.number()),
        absErrorF: v.optional(v.number()),
        leadHoursToActualHigh: v.optional(v.number()),

        // Always present, 0 until finalized; helps range queries
        finalizedAtMs: v.number(),
    })
        .index("by_location_target", ["locationId", "targetDateISO"])
        .index("by_location_target_lead_bucket", [
            "locationId",
            "targetDateISO",
            "leadDays",
            "fetchedHourBucketMs",
        ])
        .index("by_location_finalizedAt", ["locationId", "finalizedAtMs"])
    .index("by_location_lead_target_bucket", [
        "locationId",
        "leadDays",
        "targetDateISO",
        "fetchedHourBucketMs",
    ])
        .index("by_location_target_bucket", [
            "locationId",
            "targetDateISO",
            "fetchedHourBucketMs",
        ]),

});
