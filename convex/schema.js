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

  kordForecastSnapshots: defineTable({
    stationIcao: v.string(),
    stationName: v.string(),
    capturedAt: v.number(),
    capturedAtLocal: v.string(),
    durationDays: v.number(),
    unit: v.union(v.literal("imperial"), v.literal("metric")),
    language: v.string(),
    status: v.union(
      v.literal("ok"),
      v.literal("partial"),
      v.literal("error"),
    ),
    microsoftStatus: v.union(v.literal("ok"), v.literal("error")),
    microsoftError: v.optional(v.string()),
    microsoftForecastDays: v.array(
      v.object({
        date: v.string(),
        minTempC: v.optional(v.number()),
        minTempF: v.optional(v.number()),
        maxTempC: v.optional(v.number()),
        maxTempF: v.optional(v.number()),
        dayPhrase: v.optional(v.string()),
        nightPhrase: v.optional(v.string()),
      }),
    ),
    accuweatherStatus: v.optional(v.union(v.literal("ok"), v.literal("error"))),
    accuweatherError: v.optional(v.string()),
    accuweatherLocationKey: v.optional(v.string()),
    accuweatherForecastDays: v.optional(
      v.array(
        v.object({
          date: v.string(),
          minTempC: v.optional(v.number()),
          minTempF: v.optional(v.number()),
          maxTempC: v.optional(v.number()),
          maxTempF: v.optional(v.number()),
          dayPhrase: v.optional(v.string()),
          nightPhrase: v.optional(v.string()),
        }),
      ),
    ),
    googleStatus: v.optional(v.union(v.literal("ok"), v.literal("error"))),
    googleError: v.optional(v.string()),
    googleForecastDays: v.optional(
      v.array(
        v.object({
          date: v.string(),
          minTempC: v.optional(v.number()),
          minTempF: v.optional(v.number()),
          maxTempC: v.optional(v.number()),
          maxTempF: v.optional(v.number()),
          dayPhrase: v.optional(v.string()),
          nightPhrase: v.optional(v.string()),
        }),
      ),
    ),
    weathercomStatus: v.optional(v.union(v.literal("ok"), v.literal("error"))),
    weathercomError: v.optional(v.string()),
    weathercomForecastDays: v.optional(
      v.array(
        v.object({
          date: v.string(),
          minTempC: v.optional(v.number()),
          minTempF: v.optional(v.number()),
          maxTempC: v.optional(v.number()),
          maxTempF: v.optional(v.number()),
          dayPhrase: v.optional(v.string()),
          nightPhrase: v.optional(v.string()),
        }),
      ),
    ),
    actualReadings: v.array(
      v.object({
        source: v.string(),
        status: v.union(v.literal("ok"), v.literal("error")),
        observedAtUtc: v.optional(v.number()),
        observedAtLocal: v.optional(v.string()),
        tempC: v.optional(v.number()),
        tempF: v.optional(v.number()),
        raw: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_station_capturedAt", ["stationIcao", "capturedAt"]),

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
});
