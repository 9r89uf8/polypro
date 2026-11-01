import { defineTable } from "convex/server";
import { v } from "convex/values";

export const providerForecastProvider = v.union(
  v.literal("kma"), v.literal("weathercom"), v.literal("ecmwf"), v.literal("gfs"), v.literal("icon"),
);
export const providerForecastMethod = v.union(
  // Latest stored KMA or Weather.com capture completed by 09:00 KST.
  v.literal("stored_capture"),
  // Open-Meteo request made in the 09:00 KST lock window.
  v.literal("live_fetch"),
  // Past day rebuilt from Open-Meteo's archive of the run normally current at 09:00 KST.
  v.literal("single_run_archive"),
);
export const providerForecastHour = v.object({
  hour: v.number(), time: v.number(), tempC: v.number(),
  cloudCoverPct: v.optional(v.number()), cloudLowPct: v.optional(v.number()), cloudMidPct: v.optional(v.number()), cloudHighPct: v.optional(v.number()),
  sky: v.optional(v.string()), skyCode: v.optional(v.string()),
});

export const seoulProviderForecastTables = {
  // One record per KST date and provider. A usable lock is never replaced; an
  // error record may be replaced by a later attempt inside the lock window.
  seoulProviderForecastLocks: defineTable({
    stationIcao: v.literal("RKSI"), date: v.string(), provider: providerForecastProvider,
    status: v.union(v.literal("ok"), v.literal("partial"), v.literal("error")), method: providerForecastMethod,
    version: v.string(), lockAt: v.number(), lockedAt: v.number(),
    capturedAt: v.optional(v.number()), receivedAt: v.optional(v.number()), sourceCaptureId: v.optional(v.string()),
    modelId: v.optional(v.string()), requestUrl: v.optional(v.string()),
    runInitAt: v.optional(v.number()), runAvailableAt: v.optional(v.number()),
    runCheck: v.optional(v.union(v.literal("stable"), v.literal("changed"), v.literal("unknown"))),
    gridLatitude: v.optional(v.number()), gridLongitude: v.optional(v.number()), gridElevationM: v.optional(v.number()),
    hourly: v.array(providerForecastHour), highC: v.optional(v.number()), peakHours: v.optional(v.array(v.number())),
    error: v.optional(v.string()), issues: v.optional(v.array(v.string())),
  })
    .index("by_station_date_provider", ["stationIcao", "date", "provider"]),

  // Scored once after KST midnight from the observed record of that day.
  seoulProviderForecastScores: defineTable({
    lockId: v.id("seoulProviderForecastLocks"), stationIcao: v.literal("RKSI"), date: v.string(),
    provider: providerForecastProvider, method: providerForecastMethod, version: v.string(), scoredAt: v.number(),
    status: v.union(v.literal("scored"), v.literal("missing")),
    hoursScored: v.number(), sumAbsErrorC: v.number(), sumErrorC: v.number(),
    maeC: v.optional(v.number()), biasC: v.optional(v.number()),
    forecastHighC: v.optional(v.number()), forecastHighRoundedC: v.optional(v.number()), forecastPeakHours: v.array(v.number()),
    actualHighC: v.optional(v.number()), actualHighTime: v.optional(v.number()), highComplete: v.boolean(),
    highErrorC: v.optional(v.number()), peakErrorMinutes: v.optional(v.number()),
    afterLockReportCount: v.number(),
    pairs: v.array(v.object({ hour: v.number(), forecastC: v.number(), actualC: v.number(), errorC: v.number() })),
  })
    .index("by_lock", ["lockId"])
    .index("by_station_date", ["stationIcao", "date"]),
};
