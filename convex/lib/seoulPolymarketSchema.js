import { defineTable } from "convex/server";
import { v } from "convex/values";

const nullableNumber = v.union(v.number(), v.null());
const nullableString = v.union(v.string(), v.null());
export const seoulMarketEventValidator = v.object({
  eventId: v.string(), eventSlug: v.string(), title: v.string(), url: v.string(),
  resolutionSource: v.string(), description: v.string(), rulesFingerprint: v.string(),
  rulesVerified: v.boolean(), closed: v.boolean(),
});
export const seoulMarketQuoteValidator = v.object({
  marketId: v.string(), label: v.string(), sortOrder: v.number(),
  bucketKind: v.union(v.literal("below"), v.literal("exact"), v.literal("above")),
  temperatureC: v.number(), yesTokenId: v.string(),
  bestBidPrice: nullableString, bestBidSize: nullableString,
  bestAskPrice: nullableString, bestAskSize: nullableString,
  lastTradePrice: nullableString, gammaPrice: nullableString,
  bookTimestamp: nullableNumber, bookReceivedAt: nullableNumber, lastTradeReceivedAt: nullableNumber,
  quoteStatus: v.union(v.literal("ok"), v.literal("no_book"), v.literal("stale"), v.literal("error")),
});
export const seoulMarketSnapshotFields = {
  stationIcao: v.literal("RKSI"), date: v.string(), pollSlotUtc: v.number(),
  source: v.literal("polymarket_gamma_clob_rest"), polledAt: v.number(),
  gammaRequestedAt: v.number(), gammaReceivedAt: v.number(),
  bookRequestedAt: nullableNumber, bookReceivedAt: nullableNumber,
  lastTradeRequestedAt: nullableNumber, lastTradeReceivedAt: nullableNumber,
  status: v.union(v.literal("ok"), v.literal("partial"), v.literal("stale"),
    v.literal("no_data"), v.literal("unsupported_rules")),
  event: seoulMarketEventValidator, markets: v.array(seoulMarketQuoteValidator),
};
export const seoulMarketSnapshotValidator = v.object(seoulMarketSnapshotFields);

export const seoulPolymarketTables = {
  seoulPolymarketCollectorStatus: defineTable({
    stationIcao: v.literal("RKSI"), status: v.string(),
    collectionQueuedAt: v.number(), collectionInFlightSince: v.optional(v.number()),
    collectionRunId: v.optional(v.string()), lastAttemptAt: v.number(),
    lastSuccessAt: v.optional(v.number()), lastError: v.optional(v.string()), updatedAt: v.number(),
  }).index("by_station", ["stationIcao"]),
  seoulPolymarketSnapshots: defineTable({
    ...seoulMarketSnapshotFields, firstSeenAt: v.number(),
  }).index("by_station_date_polled", ["stationIcao", "date", "polledAt"])
    .index("by_station_slot", ["stationIcao", "pollSlotUtc"])
    .index("by_polled", ["polledAt"]),
};
