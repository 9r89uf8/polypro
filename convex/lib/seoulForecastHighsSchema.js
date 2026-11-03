import { defineTable } from "convex/server";
import { v } from "convex/values";

export const forecastHighProvider = v.union(v.literal("kma"), v.literal("weathercom"), v.literal("accuweather"));
export const forecastHighCheckStatus = v.union(v.literal("ok"), v.literal("error"), v.literal("location_unverified"));
// What showed a forecast was for the airport: the ICAO code the page displays
// (KMA), or the provider's own location record and its distance from RKSI.
export const forecastHighLocation = v.object({
  name: v.optional(v.string()), icaoCode: v.optional(v.string()), locationKey: v.optional(v.string()),
  latitude: v.optional(v.number()), longitude: v.optional(v.number()), distanceKm: v.optional(v.number()),
  verifiedAt: v.number(),
});

export const seoulForecastHighTables = {
  // One row per distinct daily high a provider published for a KST date. A new
  // value inserts a row; a repeated value only moves lastSeenAt. AccuWeather's
  // rows are deleted before its terms' two-week limit on keeping API data.
  seoulForecastHighChanges: defineTable({
    stationIcao: v.literal("RKSI"), provider: forecastHighProvider, targetDate: v.string(), highC: v.number(),
    firstSeenAt: v.number(), lastSeenAt: v.number(), createdAt: v.number(),
  })
    .index("by_station_provider_target_seen", ["stationIcao", "provider", "targetDate", "firstSeenAt"]),

  // One row per provider: the result of its latest check.
  seoulForecastHighStatus: defineTable({
    stationIcao: v.literal("RKSI"), provider: forecastHighProvider, status: forecastHighCheckStatus,
    lastCheckAt: v.number(), lastSuccessAt: v.optional(v.number()), lastError: v.optional(v.string()),
    location: v.optional(forecastHighLocation), updatedAt: v.number(),
  })
    .index("by_station_provider", ["stationIcao", "provider"]),
};
