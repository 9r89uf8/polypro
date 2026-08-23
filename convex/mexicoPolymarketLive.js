import {
  actionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";

const SUPPORTED_STATION_ICAO = "MMMX";
const MEXICO_TIMEZONE = "America/Mexico_City";
const POLYMARKET_SERIES_ID = "11428";
const POLYMARKET_SERIES_SLUG = "mexico-city-daily-weather";
const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events/keyset";
const CLOB_BASE_URL = "https://clob.polymarket.com";
const FETCH_TIMEOUT_MS = 20_000;
const POLL_LEASE_MS = 90_000;
const MANUAL_COOLDOWN_MS = 60_000;
const SCHEDULED_COOLDOWN_MS = 25_000;
const MAX_QUERY_EVENT_LIMIT = 2_000;
const RETENTION_BATCH_SIZE = 500;
// Drain up to 32,000 expired rows per daily run. That exceeds a full day of
// worst-case one-minute changes for the current market while each individual
// mutation remains bounded to 500 deletes.
const MAX_RETENTION_BATCHES = 64;
const USER_AGENT =
  "polypro-mmmx-edge/1.0 (MMMX Polymarket public market-data collector)";

export const POLYMARKET_LIVE_COLLECTION_FLAG =
  "POLYMARKET_MMMX_LIVE_COLLECTION_ENABLED";
export const POLYMARKET_DATA_ACCESS_APPROVAL_FLAG =
  "POLYMARKET_MMMX_DATA_ACCESS_APPROVED";
export const POLYMARKET_DATA_RETENTION_APPROVAL_FLAG =
  "POLYMARKET_MMMX_DATA_RETENTION_APPROVED";
export const POLYMARKET_DATA_PUBLIC_APPROVAL_FLAG =
  "POLYMARKET_MMMX_DATA_PUBLIC_APPROVED";
export const MEXICO_EDGE_QUOTE_EVENT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const MEXICO_EDGE_QUOTE_HEARTBEAT_RETENTION_MS =
  MEXICO_EDGE_QUOTE_EVENT_RETENTION_MS;

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const mexicoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MEXICO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function evaluateMexicoPolymarketDataApprovals({
  access,
  retention,
  publicDisplay,
} = {}) {
  const accessApproved = access === "true";
  const retentionApproved = retention === "true";
  const publicApproved = publicDisplay === "true";
  const storageEnabled = accessApproved && retentionApproved;
  const publicEnabled = storageEnabled && publicApproved;
  return {
    access: {
      approved: accessApproved,
      flagName: POLYMARKET_DATA_ACCESS_APPROVAL_FLAG,
    },
    retention: {
      approved: retentionApproved,
      flagName: POLYMARKET_DATA_RETENTION_APPROVAL_FLAG,
    },
    public: {
      approved: publicApproved,
      flagName: POLYMARKET_DATA_PUBLIC_APPROVAL_FLAG,
    },
    storageEnabled,
    publicEnabled,
    storageStatus: !accessApproved
      ? "access_approval_required"
      : !retentionApproved
        ? "retention_approval_required"
        : "ok",
    publicStatus: !accessApproved
      ? "access_approval_required"
      : !retentionApproved
        ? "retention_approval_required"
        : !publicApproved
          ? "public_approval_required"
          : "ok",
  };
}

function getDataApprovals() {
  return evaluateMexicoPolymarketDataApprovals({
    access: process.env[POLYMARKET_DATA_ACCESS_APPROVAL_FLAG],
    retention: process.env[POLYMARKET_DATA_RETENTION_APPROVAL_FLAG],
    publicDisplay: process.env[POLYMARKET_DATA_PUBLIC_APPROVAL_FLAG],
  });
}

// Only fields that can change the executable/displayed probability (or its
// market rule) create reaction-history events. Depth, hashes and provider book
// timestamps still update the current quote without fabricating a price tick.
const quoteEventFields = [
  "gammaOutcomePrice",
  "bestBidPrice",
  "bestAskPrice",
  "midpointPrice",
  "spreadPrice",
  "lastTradePrice",
  "lastTradeSide",
  "lastTradeStatus",
  "platformDisplayPrice",
  "platformDisplaySource",
  "tickSize",
  "minOrderSize",
  "bookAvailable",
];

const gammaSignalFields = new Set(["gammaOutcomePrice"]);
const bookSignalFields = new Set([
  "bestBidPrice",
  "bestAskPrice",
  "midpointPrice",
  "spreadPrice",
  "tickSize",
  "minOrderSize",
  "bookAvailable",
]);
const lastTradeSignalFields = new Set([
  "lastTradePrice",
  "lastTradeSide",
  "lastTradeStatus",
]);

const optionalQuoteFields = [
  "gammaOutcomePrice",
  "gammaProbabilityPct",
  "bestBidPrice",
  "bestBidSize",
  "bestAskPrice",
  "bestAskSize",
  "midpointPrice",
  "spreadPrice",
  "lastTradePrice",
  "lastTradeSide",
  "lastTradeStatus",
  "platformDisplayPrice",
  "platformDisplayProbabilityPct",
  "tickSize",
  "minOrderSize",
  "bookTimestamp",
  "bookHash",
  "gammaReceivedAt",
  "bookFetchStartedAt",
  "bookReceivedAt",
  "lastTradeFetchStartedAt",
  "lastTradeReceivedAt",
];

const optionalEventFields = [
  "description",
  "resolutionSource",
  "endTimeUtc",
  "endTimeIso",
  "sourceUpdatedAt",
];

function normalizeStationIcao(value) {
  const stationIcao = String(value ?? SUPPORTED_STATION_ICAO)
    .trim()
    .toUpperCase();
  if (stationIcao !== SUPPORTED_STATION_ICAO) {
    throw new Error("The Mexico live Polymarket collector supports MMMX only.");
  }
  return stationIcao;
}

function assertDateKey(value) {
  const date = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error("Date must be a real calendar date.");
  }
  return { date, year, month, day };
}

function currentMexicoDate(now = Date.now()) {
  const parts = {};
  for (const part of mexicoDateFormatter.formatToParts(new Date(now))) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Polymarket returned an invalid ${label}.`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePossiblyJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function optionalEpoch(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  if (/^\d+$/.test(value.trim())) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumber(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseNormalizedDecimal(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("A decimal string or finite number is required.");
  }
  const raw = String(value).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match || (!match[2] && !match[3])) {
    throw new Error(`Invalid decimal value: ${raw || "(empty)"}.`);
  }
  const sign = match[1] === "-" ? "-" : "";
  const whole = match[2] || "0";
  const fraction = match[3] || "";
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) {
    throw new Error("Decimal exponent is outside the supported range.");
  }
  let digits = `${whole}${fraction}`;
  let decimalPosition = whole.length + exponent;
  if (decimalPosition <= 0) {
    digits = `${"0".repeat(-decimalPosition)}${digits}`;
    decimalPosition = 0;
  } else if (decimalPosition >= digits.length) {
    digits = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
    decimalPosition = digits.length;
  }
  let integerPart = digits.slice(0, decimalPosition) || "0";
  let fractionalPart = digits.slice(decimalPosition);
  integerPart = integerPart.replace(/^0+(?=\d)/, "");
  fractionalPart = fractionalPart.replace(/0+$/, "");
  if (/^0+$/.test(integerPart) && !fractionalPart) {
    return { normalized: "0", sign: "", digits: 0n, scale: 0 };
  }
  const normalized = `${sign}${integerPart}${
    fractionalPart ? `.${fractionalPart}` : ""
  }`;
  const magnitudeDigits =
    `${integerPart}${fractionalPart}`.replace(/^0+/, "") || "0";
  return {
    normalized,
    sign,
    digits: BigInt(`${sign}${magnitudeDigits}`),
    scale: fractionalPart.length,
  };
}

export function normalizePolymarketDecimal(value, options = {}) {
  const parsed = parseNormalizedDecimal(value);
  if (options.nonNegative !== false && parsed.digits < 0n) {
    throw new Error("Price values cannot be negative.");
  }
  if (
    options.maxOne === true &&
    compareNormalizedDecimals(parsed.normalized, "1") > 0
  ) {
    throw new Error("Price values cannot exceed one.");
  }
  return parsed.normalized;
}

function toAlignedIntegers(left, right) {
  const leftParsed = parseNormalizedDecimal(left);
  const rightParsed = parseNormalizedDecimal(right);
  const scale = Math.max(leftParsed.scale, rightParsed.scale);
  return {
    left: leftParsed.digits * 10n ** BigInt(scale - leftParsed.scale),
    right: rightParsed.digits * 10n ** BigInt(scale - rightParsed.scale),
    scale,
  };
}

export function compareNormalizedDecimals(left, right) {
  const aligned = toAlignedIntegers(left, right);
  return aligned.left < aligned.right
    ? -1
    : aligned.left > aligned.right
      ? 1
      : 0;
}

function scaledIntegerToDecimal(integer, scale) {
  const negative = integer < 0n;
  let digits = (negative ? -integer : integer).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, "0");
    const split = digits.length - scale;
    digits = `${digits.slice(0, split)}.${digits.slice(split)}`;
  }
  return normalizePolymarketDecimal(`${negative ? "-" : ""}${digits}`, {
    nonNegative: false,
  });
}

function subtractDecimals(left, right) {
  const aligned = toAlignedIntegers(left, right);
  return scaledIntegerToDecimal(aligned.left - aligned.right, aligned.scale);
}

function midpointDecimals(left, right) {
  const aligned = toAlignedIntegers(left, right);
  const sum = aligned.left + aligned.right;
  if (sum % 2n === 0n) {
    return scaledIntegerToDecimal(sum / 2n, aligned.scale);
  }
  return scaledIntegerToDecimal(sum * 5n, aligned.scale + 1);
}

function probabilityPct(value) {
  if (value === undefined) {
    return undefined;
  }
  const numeric = Number(value) * 100;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function optionalPrice(value, label) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  try {
    return normalizePolymarketDecimal(value, { maxOne: true });
  } catch (error) {
    throw new Error(
      `Polymarket returned an invalid ${label}: ${error.message}`,
    );
  }
}

function optionalNonNegativeDecimal(value, label) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  try {
    return normalizePolymarketDecimal(value);
  } catch (error) {
    throw new Error(
      `Polymarket returned an invalid ${label}: ${error.message}`,
    );
  }
}

export function evaluateMexicoPolymarketLiveCollection(value) {
  return {
    enabled: value === "true",
    status: value === "true" ? "enabled" : "collection_disabled",
    flagName: POLYMARKET_LIVE_COLLECTION_FLAG,
  };
}

function getCollectionAccess() {
  return evaluateMexicoPolymarketLiveCollection(
    process.env[POLYMARKET_LIVE_COLLECTION_FLAG],
  );
}

export function buildMexicoPolymarketLiveEventSlug(date) {
  const { year, month, day } = assertDateKey(date);
  return `highest-temperature-in-mexico-city-on-${monthNames[month - 1]}-${day}-${year}`;
}

export function buildMexicoPolymarketLiveGammaUrl(date) {
  assertDateKey(date);
  const url = new URL(GAMMA_EVENTS_URL);
  url.searchParams.set("series_id", POLYMARKET_SERIES_ID);
  url.searchParams.set("event_date", date);
  url.searchParams.set("limit", "10");
  return url.toString();
}

function eventSeriesMatches(event) {
  if (event?.seriesSlug === POLYMARKET_SERIES_SLUG) {
    return true;
  }
  const series = Array.isArray(event?.series) ? event.series : [];
  return series.some(
    (item) =>
      String(item?.id ?? "") === POLYMARKET_SERIES_ID ||
      item?.slug === POLYMARKET_SERIES_SLUG,
  );
}

function findResolutionSource(event) {
  const direct = optionalString(event?.resolutionSource);
  if (direct) {
    return direct;
  }
  for (const market of Array.isArray(event?.markets) ? event.markets : []) {
    const source = optionalString(market?.resolutionSource);
    if (source) {
      return source;
    }
  }
  return undefined;
}

function findEventDescription(event) {
  const direct = optionalString(event?.description);
  if (direct) {
    return direct;
  }
  for (const market of Array.isArray(event?.markets) ? event.markets : []) {
    const description = optionalString(market?.description);
    if (description) {
      return description;
    }
  }
  return undefined;
}

function findEventEndTime(event) {
  const candidates = [
    event?.endDate,
    event?.endDateIso,
    event?.endTime,
    ...(Array.isArray(event?.markets)
      ? event.markets.flatMap((market) => [
          market?.endDate,
          market?.endDateIso,
          market?.endTime,
        ])
      : []),
  ];
  for (const candidate of candidates) {
    const epoch = optionalEpoch(candidate);
    if (epoch !== undefined) {
      return {
        endTimeUtc: epoch,
        endTimeIso: new Date(epoch).toISOString(),
      };
    }
  }
  return {};
}

export function normalizeMexicoPolymarketLiveEvent(payload, date) {
  assertDateKey(date);
  const expectedSlug = buildMexicoPolymarketLiveEventSlug(date);
  const events = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.events)
      ? payload.events
      : [];
  const exactSlugMatches = events.filter(
    (event) => event?.slug === expectedSlug,
  );
  const dateSeriesMatches = events.filter(
    (event) => event?.eventDate === date && eventSeriesMatches(event),
  );
  const matches = exactSlugMatches.length
    ? exactSlugMatches
    : dateSeriesMatches;
  if (matches.length === 0) {
    throw new Error(
      `No ${POLYMARKET_SERIES_SLUG} event was published for ${date}.`,
    );
  }
  if (matches.length !== 1) {
    throw new Error(
      `Polymarket returned multiple ${POLYMARKET_SERIES_SLUG} events for ${date}.`,
    );
  }

  const event = matches[0];
  const eventId = requiredString(String(event.id ?? ""), "event id");
  const eventSlug = requiredString(event.slug, "event slug");
  const eventTitle = requiredString(event.title, "event title");
  if (!Array.isArray(event.markets) || event.markets.length === 0) {
    throw new Error("Polymarket returned no temperature buckets.");
  }

  const markets = event.markets.map((market, sourceIndex) => {
    const marketId = requiredString(String(market?.id ?? ""), "market id");
    const marketSlug = requiredString(market?.slug, "market slug");
    const conditionId = requiredString(market?.conditionId, "condition id");
    const label = requiredString(
      market?.groupItemTitle ?? market?.question,
      "bucket label",
    );
    const outcomes = parsePossiblyJsonArray(market?.outcomes);
    const tokenIds = parsePossiblyJsonArray(market?.clobTokenIds);
    const outcomePrices = parsePossiblyJsonArray(market?.outcomePrices);
    if (
      outcomes.length < 2 ||
      tokenIds.length !== outcomes.length ||
      !outcomes.every(
        (outcome) => typeof outcome === "string" && outcome.trim(),
      ) ||
      !tokenIds.every(
        (tokenId) => typeof tokenId === "string" && tokenId.trim(),
      )
    ) {
      throw new Error(
        `Polymarket market ${marketId} has inconsistent outcomes.`,
      );
    }
    const yesIndexes = outcomes
      .map((outcome, index) =>
        outcome.trim().toLowerCase() === "yes" ? index : -1,
      )
      .filter((index) => index >= 0);
    if (yesIndexes.length !== 1) {
      throw new Error(
        `Polymarket market ${marketId} has no unique Yes outcome.`,
      );
    }
    const yesIndex = yesIndexes[0];
    const noIndex = outcomes.findIndex(
      (outcome) => outcome.trim().toLowerCase() === "no",
    );
    let gammaOutcomePrice;
    if (outcomePrices.length > yesIndex) {
      gammaOutcomePrice = optionalPrice(
        outcomePrices[yesIndex],
        `Gamma Yes price for market ${marketId}`,
      );
    }
    const threshold = finiteNumber(market?.groupItemThreshold);
    const displayOrder = Number.isFinite(threshold) ? threshold : sourceIndex;
    return {
      marketId,
      marketSlug,
      conditionId,
      label,
      displayOrder,
      sourceIndex,
      yesTokenId: requiredString(tokenIds[yesIndex], "Yes token id"),
      ...(noIndex >= 0
        ? { noTokenId: requiredString(tokenIds[noIndex], "No token id") }
        : {}),
      ...(gammaOutcomePrice !== undefined
        ? {
            gammaOutcomePrice,
            gammaProbabilityPct: probabilityPct(gammaOutcomePrice),
          }
        : {}),
      enableOrderBook: market?.enableOrderBook !== false,
      negRisk: market?.negRisk === true,
      ...(optionalString(market?.question)
        ? { question: optionalString(market.question) }
        : {}),
      ...(optionalString(market?.description)
        ? { description: optionalString(market.description) }
        : {}),
      ...(optionalString(market?.resolutionSource)
        ? { resolutionSource: optionalString(market.resolutionSource) }
        : {}),
    };
  });

  for (const [field, label] of [
    ["marketId", "market ids"],
    ["marketSlug", "market slugs"],
    ["conditionId", "condition ids"],
    ["yesTokenId", "Yes token ids"],
  ]) {
    if (
      new Set(markets.map((market) => market[field])).size !== markets.length
    ) {
      throw new Error(`Polymarket returned duplicate ${label}.`);
    }
  }
  markets.sort(
    (left, right) =>
      left.displayOrder - right.displayOrder ||
      left.sourceIndex - right.sourceIndex ||
      left.label.localeCompare(right.label),
  );

  const description = findEventDescription(event);
  const resolutionSource = findResolutionSource(event);
  const endTime = findEventEndTime(event);
  return {
    eventId,
    eventSlug,
    eventTitle,
    eventUrl: `https://polymarket.com/event/${encodeURIComponent(eventSlug)}`,
    ...(description ? { description } : {}),
    ...(resolutionSource ? { resolutionSource } : {}),
    ...endTime,
    eventActive: event.active === true,
    eventClosed: event.closed === true,
    negRisk:
      event.negRisk === true ||
      markets.some((market) => market.negRisk === true),
    ...(optionalEpoch(event.updatedAt) !== undefined
      ? { sourceUpdatedAt: optionalEpoch(event.updatedAt) }
      : {}),
    markets,
  };
}

function normalizeBookLevels(levels, side) {
  if (!Array.isArray(levels)) {
    return [];
  }
  const normalized = levels.map((level, index) => ({
    price: optionalPrice(level?.price, `${side} level ${index} price`),
    size: optionalNonNegativeDecimal(
      level?.size,
      `${side} level ${index} size`,
    ),
  }));
  if (
    normalized.some(
      (level) => level.price === undefined || level.size === undefined,
    )
  ) {
    throw new Error(`Polymarket returned an incomplete ${side} level.`);
  }
  normalized.sort((left, right) => {
    const comparison = compareNormalizedDecimals(left.price, right.price);
    return side === "bid" ? -comparison : comparison;
  });
  return normalized;
}

export function derivePolymarketPlatformDisplay({
  bestBidPrice,
  bestAskPrice,
  lastTradePrice,
  gammaOutcomePrice,
}) {
  if (bestBidPrice !== undefined && bestAskPrice !== undefined) {
    if (compareNormalizedDecimals(bestAskPrice, bestBidPrice) < 0) {
      throw new Error("Polymarket returned a crossed Yes order book.");
    }
    const midpointPrice = midpointDecimals(bestBidPrice, bestAskPrice);
    const spreadPrice = subtractDecimals(bestAskPrice, bestBidPrice);
    if (
      compareNormalizedDecimals(spreadPrice, "0.1") > 0 &&
      lastTradePrice !== undefined
    ) {
      return {
        midpointPrice,
        spreadPrice,
        platformDisplayPrice: lastTradePrice,
        platformDisplaySource: "last_trade",
      };
    }
    return {
      midpointPrice,
      spreadPrice,
      platformDisplayPrice: midpointPrice,
      platformDisplaySource: "midpoint",
    };
  }
  if (lastTradePrice !== undefined) {
    return {
      platformDisplayPrice: lastTradePrice,
      platformDisplaySource: "last_trade",
    };
  }
  if (gammaOutcomePrice !== undefined) {
    return {
      platformDisplayPrice: gammaOutcomePrice,
      platformDisplaySource: "gamma_outcome",
    };
  }
  return { platformDisplaySource: "unavailable" };
}

export function normalizeMexicoPolymarketClobBook(
  rawBook,
  { tokenId, gammaOutcomePrice, lastTrade } = {},
) {
  if (!rawBook) {
    const lastTradePrice = optionalPrice(
      lastTrade?.price,
      `last trade for ${tokenId ?? "unknown token"}`,
    );
    const display = derivePolymarketPlatformDisplay({
      lastTradePrice,
      gammaOutcomePrice,
    });
    return {
      bookAvailable: false,
      ...(lastTradePrice !== undefined ? { lastTradePrice } : {}),
      ...(optionalString(lastTrade?.side)
        ? { lastTradeSide: optionalString(lastTrade.side).toUpperCase() }
        : {}),
      ...display,
    };
  }
  const assetId = requiredString(rawBook.asset_id, "CLOB asset id");
  if (tokenId && assetId !== tokenId) {
    throw new Error("Polymarket returned a CLOB book for the wrong token.");
  }
  const bids = normalizeBookLevels(rawBook.bids, "bid");
  const asks = normalizeBookLevels(rawBook.asks, "ask");
  const bestBid = bids[0];
  const bestAsk = asks[0];
  const lastTradePrice = optionalPrice(
    lastTrade !== undefined ? lastTrade?.price : rawBook.last_trade_price,
    `last trade for ${assetId}`,
  );
  const lastTradeSide = optionalString(lastTrade?.side)?.toUpperCase();
  const display = derivePolymarketPlatformDisplay({
    bestBidPrice: bestBid?.price,
    bestAskPrice: bestAsk?.price,
    lastTradePrice,
    gammaOutcomePrice,
  });
  const bookTimestamp = optionalEpoch(rawBook.timestamp);
  const tickSize = optionalNonNegativeDecimal(rawBook.tick_size, "tick size");
  const minOrderSize = optionalNonNegativeDecimal(
    rawBook.min_order_size,
    "minimum order size",
  );
  return {
    bookAvailable: true,
    ...(bestBid
      ? { bestBidPrice: bestBid.price, bestBidSize: bestBid.size }
      : {}),
    ...(bestAsk
      ? { bestAskPrice: bestAsk.price, bestAskSize: bestAsk.size }
      : {}),
    ...(lastTradePrice !== undefined ? { lastTradePrice } : {}),
    ...(lastTradeSide ? { lastTradeSide } : {}),
    ...(tickSize !== undefined ? { tickSize } : {}),
    ...(minOrderSize !== undefined ? { minOrderSize } : {}),
    ...(bookTimestamp !== undefined ? { bookTimestamp } : {}),
    ...(optionalString(rawBook.hash)
      ? { bookHash: optionalString(rawBook.hash) }
      : {}),
    negRisk: rawBook.neg_risk === true,
    ...display,
  };
}

export function buildMexicoPolymarketQuoteFingerprint(quote) {
  return quoteEventFields
    .map((field) => `${field}=${quote?.[field] ?? ""}`)
    .join("|");
}

export function diffMexicoPolymarketQuoteFields(previous, next) {
  return quoteEventFields.filter(
    (field) =>
      (previous?.[field] ?? undefined) !== (next?.[field] ?? undefined),
  );
}

export function hasSameMexicoPolymarketQuoteIdentity(previous, next) {
  return Boolean(
    previous &&
    previous.eventId === next?.eventId &&
    previous.marketId === next?.marketId &&
    previous.yesTokenId === next?.yesTokenId,
  );
}

export function assertMexicoPolymarketLastTradeProgression(previous, next) {
  const previouslyReported =
    previous?.lastTradeStatus === "reported" ||
    previous?.lastTradePrice !== undefined;
  if (previouslyReported && next?.lastTradeStatus === "no_trades") {
    throw new Error(
      "Polymarket last-trade response regressed from a reported trade to the no-trades sentinel.",
    );
  }
  return true;
}

function signalBoundaryAt(changedFields, snapshot) {
  const candidates = [];
  let hasDirectSignal = false;
  if (changedFields.some((field) => gammaSignalFields.has(field))) {
    hasDirectSignal = true;
    if (!Number.isFinite(snapshot?.gammaReceivedAt)) {
      return undefined;
    }
    candidates.push(snapshot.gammaReceivedAt);
  }
  if (changedFields.some((field) => bookSignalFields.has(field))) {
    hasDirectSignal = true;
    if (!Number.isFinite(snapshot?.bookReceivedAt)) {
      return undefined;
    }
    candidates.push(snapshot.bookReceivedAt);
  }
  if (changedFields.some((field) => lastTradeSignalFields.has(field))) {
    hasDirectSignal = true;
    if (!Number.isFinite(snapshot?.lastTradeReceivedAt)) {
      return undefined;
    }
    candidates.push(snapshot.lastTradeReceivedAt);
  }
  if (hasDirectSignal) {
    return Math.max(...candidates);
  }
  return Number.isFinite(snapshot?.receivedAt)
    ? snapshot.receivedAt
    : undefined;
}

export function deriveMexicoPolymarketDetectionInterval({
  changedFields,
  previous,
  current,
}) {
  // An initial/current-contract rollover row establishes state but is not a
  // reaction transition. Use the accepted poll completion as a left-censored
  // upper edge even for a Gamma-only market with no CLOB endpoint clocks.
  if (!previous) {
    if (!Number.isFinite(current?.receivedAt)) {
      throw new Error("An initial quote state requires a finite receive time.");
    }
    return {
      detectionEndAt: current.receivedAt,
      detectionIntervalKind: "left_unbounded",
    };
  }
  const detectionStartAt = previous
    ? signalBoundaryAt(changedFields, previous)
    : undefined;
  const detectionEndAt = signalBoundaryAt(changedFields, current);
  if (!Number.isFinite(detectionEndAt)) {
    throw new Error("A quote detection interval requires a finite end time.");
  }
  return {
    ...(Number.isFinite(detectionStartAt) ? { detectionStartAt } : {}),
    detectionEndAt,
    detectionIntervalKind: Number.isFinite(detectionStartAt)
      ? "bounded"
      : "left_unbounded",
  };
}

// Heartbeats intentionally retain only the values used by reaction analysis.
// Market metadata, depth sizes, book hashes, and Gamma text remain in their
// canonical event/current-quote rows instead of being copied every minute.
export function buildMexicoPolymarketPollHeartbeat({
  stationIcao,
  date,
  generation,
  trigger,
  quote,
  previous,
  fetchedAt,
  receivedAt,
  createdAt,
}) {
  const quoteChanged =
    !previous || previous.quoteFingerprint !== quote.quoteFingerprint;
  const changedFields = !previous
    ? quoteEventFields.slice()
    : quoteChanged
      ? diffMexicoPolymarketQuoteFields(previous, quote)
      : [];
  return {
    stationIcao,
    date,
    source: "polymarket_clob_rest",
    eventId: quote.eventId,
    marketId: quote.marketId,
    yesTokenId: quote.yesTokenId,
    pollGeneration: generation,
    trigger,
    quoteFingerprint: quote.quoteFingerprint,
    ...(previous?.quoteFingerprint !== undefined
      ? { previousQuoteFingerprint: previous.quoteFingerprint }
      : {}),
    quoteChanged,
    changedFields,
    ...(quote.bestBidPrice !== undefined
      ? { bestBidPrice: quote.bestBidPrice }
      : {}),
    ...(quote.bestAskPrice !== undefined
      ? { bestAskPrice: quote.bestAskPrice }
      : {}),
    ...(quote.midpointPrice !== undefined
      ? { midpointPrice: quote.midpointPrice }
      : {}),
    ...(quote.spreadPrice !== undefined
      ? { spreadPrice: quote.spreadPrice }
      : {}),
    ...(quote.lastTradePrice !== undefined
      ? { lastTradePrice: quote.lastTradePrice }
      : {}),
    ...(quote.lastTradeSide !== undefined
      ? { lastTradeSide: quote.lastTradeSide }
      : {}),
    ...(quote.lastTradeStatus !== undefined
      ? { lastTradeStatus: quote.lastTradeStatus }
      : {}),
    ...(quote.platformDisplayPrice !== undefined
      ? { platformDisplayPrice: quote.platformDisplayPrice }
      : {}),
    platformDisplaySource: quote.platformDisplaySource,
    ...(Number.isFinite(quote.gammaReceivedAt)
      ? { gammaReceivedAt: quote.gammaReceivedAt }
      : {}),
    ...(Number.isFinite(quote.bookFetchStartedAt)
      ? { bookFetchStartedAt: quote.bookFetchStartedAt }
      : {}),
    ...(Number.isFinite(quote.bookReceivedAt)
      ? { bookReceivedAt: quote.bookReceivedAt }
      : {}),
    ...(Number.isFinite(quote.lastTradeFetchStartedAt)
      ? { lastTradeFetchStartedAt: quote.lastTradeFetchStartedAt }
      : {}),
    ...(Number.isFinite(quote.lastTradeReceivedAt)
      ? { lastTradeReceivedAt: quote.lastTradeReceivedAt }
      : {}),
    ...(Number.isFinite(previous?.gammaReceivedAt)
      ? { previousGammaReceivedAt: previous.gammaReceivedAt }
      : {}),
    ...(Number.isFinite(previous?.bookReceivedAt)
      ? { previousBookReceivedAt: previous.bookReceivedAt }
      : {}),
    ...(Number.isFinite(previous?.lastTradeReceivedAt)
      ? { previousLastTradeReceivedAt: previous.lastTradeReceivedAt }
      : {}),
    fetchedAt,
    receivedAt,
    ...(Number.isFinite(previous?.receivedAt)
      ? { previousPollReceivedAt: previous.receivedAt }
      : {}),
    createdAt,
  };
}

const eventMarketValidator = v.object({
  marketId: v.string(),
  marketSlug: v.string(),
  conditionId: v.string(),
  label: v.string(),
  displayOrder: v.number(),
  sourceIndex: v.number(),
  yesTokenId: v.string(),
  noTokenId: v.optional(v.string()),
  gammaOutcomePrice: v.optional(v.string()),
  gammaProbabilityPct: v.optional(v.number()),
  enableOrderBook: v.boolean(),
  negRisk: v.boolean(),
  question: v.optional(v.string()),
  description: v.optional(v.string()),
  resolutionSource: v.optional(v.string()),
});

const liveEventValidator = v.object({
  eventId: v.string(),
  eventSlug: v.string(),
  eventTitle: v.string(),
  eventUrl: v.string(),
  description: v.optional(v.string()),
  resolutionSource: v.optional(v.string()),
  endTimeUtc: v.optional(v.number()),
  endTimeIso: v.optional(v.string()),
  eventActive: v.boolean(),
  eventClosed: v.boolean(),
  negRisk: v.boolean(),
  sourceUpdatedAt: v.optional(v.number()),
  markets: v.array(eventMarketValidator),
});

const liveQuoteValidator = v.object({
  eventId: v.string(),
  marketId: v.string(),
  marketSlug: v.string(),
  conditionId: v.string(),
  label: v.string(),
  displayOrder: v.number(),
  yesTokenId: v.string(),
  gammaOutcomePrice: v.optional(v.string()),
  gammaProbabilityPct: v.optional(v.number()),
  bookAvailable: v.boolean(),
  bestBidPrice: v.optional(v.string()),
  bestBidSize: v.optional(v.string()),
  bestAskPrice: v.optional(v.string()),
  bestAskSize: v.optional(v.string()),
  midpointPrice: v.optional(v.string()),
  spreadPrice: v.optional(v.string()),
  lastTradePrice: v.optional(v.string()),
  lastTradeSide: v.optional(v.string()),
  lastTradeStatus: v.optional(
    v.union(v.literal("reported"), v.literal("no_trades")),
  ),
  platformDisplayPrice: v.optional(v.string()),
  platformDisplayProbabilityPct: v.optional(v.number()),
  platformDisplaySource: v.string(),
  tickSize: v.optional(v.string()),
  minOrderSize: v.optional(v.string()),
  bookTimestamp: v.optional(v.number()),
  bookHash: v.optional(v.string()),
  bookFetchStartedAt: v.optional(v.number()),
  bookReceivedAt: v.optional(v.number()),
  lastTradeFetchStartedAt: v.optional(v.number()),
  lastTradeReceivedAt: v.optional(v.number()),
  negRisk: v.boolean(),
  quoteFingerprint: v.string(),
});

async function getStatusRow(ctx, stationIcao) {
  return await ctx.db
    .query("mexicoEdgeMarketStreamStatus")
    .withIndex("by_station", (query) => query.eq("stationIcao", stationIcao))
    .first();
}

async function writeStatus(ctx, stationIcao, patch) {
  const existing = await getStatusRow(ctx, stationIcao);
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("mexicoEdgeMarketStreamStatus", {
    stationIcao,
    transport: "rest_polling",
    websocketStatus: "unavailable",
    websocketReason:
      "Persistent CLOB WebSocket sessions are not enabled in this runtime; REST snapshots are authoritative.",
    totalPollCount: 0,
    totalChangedQuoteCount: 0,
    ...patch,
  });
}

export const claimLivePoll = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
    attemptAt: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    assertDateKey(args.date);
    const access = getCollectionAccess();
    const existing = await getStatusRow(ctx, stationIcao);
    if (!access.enabled) {
      await writeStatus(ctx, stationIcao, {
        collectionEnabled: false,
        status: "collection_disabled",
        activeDate: args.date,
        generation: "",
        leaseUntil: 0,
        lastError: "",
        updatedAt: Date.now(),
      });
      return {
        claimed: false,
        status: access.status,
        flagName: access.flagName,
      };
    }
    if (
      existing?.status === "fetching" &&
      existing.generation &&
      Number.isFinite(existing.leaseUntil) &&
      existing.leaseUntil > args.attemptAt
    ) {
      return {
        claimed: false,
        status: "busy",
        retryAfterAt: existing.leaseUntil,
      };
    }
    const cooldownMs =
      args.trigger === "manual" ? MANUAL_COOLDOWN_MS : SCHEDULED_COOLDOWN_MS;
    if (
      Number.isFinite(existing?.lastAttemptAt) &&
      args.attemptAt - existing.lastAttemptAt < cooldownMs
    ) {
      return {
        claimed: false,
        status: "cooldown",
        retryAfterAt: existing.lastAttemptAt + cooldownMs,
      };
    }
    const generation = `${stationIcao}:${args.date}:${Math.trunc(args.attemptAt)}:${args.trigger}`;
    await writeStatus(ctx, stationIcao, {
      collectionEnabled: true,
      status: "fetching",
      activeDate: args.date,
      trigger: args.trigger,
      generation,
      leaseUntil: args.attemptAt + POLL_LEASE_MS,
      lastAttemptAt: args.attemptAt,
      lastError: "",
      updatedAt: Date.now(),
    });
    return { claimed: true, status: "fetching", generation };
  },
});

export const cancelDisabledLivePoll = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const existing = await getStatusRow(ctx, stationIcao);
    if (existing?.generation !== args.generation) {
      return { applied: false, status: "generation_stale" };
    }
    await ctx.db.patch(existing._id, {
      collectionEnabled: false,
      status: "collection_disabled",
      activeDate: args.date,
      generation: "",
      leaseUntil: 0,
      lastError: "",
      updatedAt: Date.now(),
    });
    return { applied: true, status: "collection_disabled" };
  },
});

export const renewLivePollLease = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    date: v.string(),
    renewedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const existing = await getStatusRow(ctx, stationIcao);
    if (
      !getCollectionAccess().enabled ||
      existing?.generation !== args.generation ||
      existing?.activeDate !== args.date ||
      existing?.status !== "fetching"
    ) {
      return { renewed: false, status: "generation_stale" };
    }
    await ctx.db.patch(existing._id, {
      leaseUntil: args.renewedAt + POLL_LEASE_MS,
      updatedAt: args.renewedAt,
    });
    return { renewed: true, leaseUntil: args.renewedAt + POLL_LEASE_MS };
  },
});

export const finishLivePoll = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    generation: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    completedAt: v.number(),
    lastError: v.string(),
    responseBytes: v.optional(v.number()),
    marketCount: v.optional(v.number()),
    changedQuoteCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const existing = await getStatusRow(ctx, stationIcao);
    if (existing?.generation !== args.generation) {
      return { applied: false, status: "generation_stale" };
    }
    await ctx.db.patch(existing._id, {
      collectionEnabled: getCollectionAccess().enabled,
      status: args.status,
      generation: "",
      leaseUntil: 0,
      lastCompletedAt: args.completedAt,
      ...(args.status === "ok" ? { lastSuccessAt: args.completedAt } : {}),
      lastError: args.lastError,
      ...(args.responseBytes !== undefined
        ? { responseBytes: args.responseBytes }
        : {}),
      ...(args.marketCount !== undefined
        ? { marketCount: args.marketCount }
        : {}),
      ...(args.changedQuoteCount !== undefined
        ? { lastChangedQuoteCount: args.changedQuoteCount }
        : {}),
      totalPollCount: (existing.totalPollCount ?? 0) + 1,
      totalChangedQuoteCount:
        (existing.totalChangedQuoteCount ?? 0) + (args.changedQuoteCount ?? 0),
      updatedAt: Date.now(),
    });
    return { applied: true, status: args.status };
  },
});

export const storeLiveMarketSnapshot = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    generation: v.string(),
    event: liveEventValidator,
    quotes: v.array(liveQuoteValidator),
    gammaUrl: v.string(),
    fetchedAt: v.number(),
    gammaReceivedAt: v.number(),
    receivedAt: v.number(),
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    assertDateKey(args.date);
    // Recheck the operational kill switch inside the storage boundary so a
    // flag removal between the final response and this mutation cannot retain
    // a new market snapshot.
    if (!getCollectionAccess().enabled) {
      throw new Error(
        "Polymarket live collection was disabled before snapshot storage.",
      );
    }
    const activePoll = await getStatusRow(ctx, stationIcao);
    if (
      activePoll?.generation !== args.generation ||
      activePoll?.activeDate !== args.date ||
      activePoll?.status !== "fetching" ||
      !Number.isFinite(activePoll?.leaseUntil) ||
      activePoll.leaseUntil < Date.now()
    ) {
      throw new Error("Polymarket live snapshot generation is stale.");
    }
    if (
      new Set(args.quotes.map((quote) => quote.marketId)).size !==
        args.quotes.length ||
      new Set(args.quotes.map((quote) => quote.yesTokenId)).size !==
        args.quotes.length
    ) {
      throw new Error(
        "Polymarket live snapshot contains duplicate markets or Yes tokens.",
      );
    }
    const heartbeatApprovals = getDataApprovals();
    // An action may retry a committed mutation response. Keep the immutable
    // audit trail at exactly one heartbeat per generation and market while
    // returning the original changed/unchanged totals to finishLivePoll.
    const storedHeartbeats = [];
    if (heartbeatApprovals.storageEnabled) {
      for (const quote of args.quotes) {
        const storedHeartbeat = await ctx.db
          .query("mexicoEdgeMarketQuoteHeartbeats")
          .withIndex("by_station_date_generation_market", (query) =>
            query
              .eq("stationIcao", stationIcao)
              .eq("date", args.date)
              .eq("pollGeneration", args.generation)
              .eq("marketId", quote.marketId),
          )
          .first();
        if (storedHeartbeat) {
          storedHeartbeats.push(storedHeartbeat);
        }
      }
    }
    if (storedHeartbeats.length > 0) {
      if (storedHeartbeats.length !== args.quotes.length) {
        throw new Error(
          "Polymarket live snapshot has a partial heartbeat generation.",
        );
      }
      const changedCount = storedHeartbeats.filter(
        (heartbeat) => heartbeat.quoteChanged,
      ).length;
      return {
        insertedCount: 0,
        changedCount,
        unchangedCount: storedHeartbeats.length - changedCount,
        removedCount: 0,
        heartbeatCount: 0,
        deduplicatedHeartbeatCount: storedHeartbeats.length,
        heartbeatStatus: heartbeatApprovals.storageStatus,
      };
    }
    const existingEvent = await ctx.db
      .query("mexicoEdgeMarketEvents")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", stationIcao).eq("date", args.date),
      )
      .first();
    const eventValue = {
      stationIcao,
      date: args.date,
      seriesId: POLYMARKET_SERIES_ID,
      seriesSlug: POLYMARKET_SERIES_SLUG,
      source: "polymarket_gamma",
      gammaUrl: args.gammaUrl,
      ...args.event,
      marketCount: args.event.markets.length,
      fetchedAt: args.fetchedAt,
      receivedAt: args.gammaReceivedAt,
      updatedAt: Date.now(),
    };
    if (existingEvent) {
      const eventPatch = { ...eventValue };
      for (const field of optionalEventFields) {
        eventPatch[field] = args.event[field];
      }
      await ctx.db.patch(existingEvent._id, eventPatch);
    } else {
      await ctx.db.insert("mexicoEdgeMarketEvents", {
        ...eventValue,
        createdAt: Date.now(),
      });
    }

    let insertedCount = 0;
    let changedCount = 0;
    let unchangedCount = 0;
    let heartbeatCount = 0;
    for (const quote of args.quotes) {
      const existing = await ctx.db
        .query("mexicoEdgeMarketQuotes")
        .withIndex("by_station_date_market", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("date", args.date)
            .eq("marketId", quote.marketId),
        )
        .first();
      // A Gamma event or Yes-token rollover starts a new evidence chain even
      // when Polymarket reuses a market id. Do not bridge an interval across
      // different contracts.
      const previous = hasSameMexicoPolymarketQuoteIdentity(existing, quote)
        ? existing
        : undefined;
      assertMexicoPolymarketLastTradeProgression(previous, quote);
      const heartbeat = buildMexicoPolymarketPollHeartbeat({
        stationIcao,
        date: args.date,
        generation: args.generation,
        trigger: args.trigger,
        quote: { ...quote, gammaReceivedAt: args.gammaReceivedAt },
        previous,
        fetchedAt: args.fetchedAt,
        receivedAt: args.receivedAt,
        createdAt: Date.now(),
      });
      const evidenceStorageEnabled =
        heartbeatApprovals.storageEnabled && getDataApprovals().storageEnabled;
      const {
        bookFetchStartedAt: _bookFetchStartedAt,
        bookReceivedAt: _bookReceivedAt,
        lastTradeFetchStartedAt: _lastTradeFetchStartedAt,
        lastTradeReceivedAt: _lastTradeReceivedAt,
        ...quoteWithoutEvidenceTimings
      } = quote;
      const quoteForStorage = evidenceStorageEnabled
        ? { ...quote, gammaReceivedAt: args.gammaReceivedAt }
        : quoteWithoutEvidenceTimings;
      const changedFields = heartbeat.changedFields;
      const changed = heartbeat.quoteChanged;
      const quoteValue = {
        stationIcao,
        date: args.date,
        source: "polymarket_clob_rest",
        ...quoteForStorage,
        fetchedAt: args.fetchedAt,
        receivedAt: args.receivedAt,
        lastChangedAt: changed
          ? args.receivedAt
          : (previous?.lastChangedAt ?? args.receivedAt),
        updatedAt: Date.now(),
      };
      if (existing) {
        const quotePatch = { ...quoteValue };
        for (const field of optionalQuoteFields) {
          quotePatch[field] = quoteForStorage[field];
        }
        await ctx.db.patch(existing._id, quotePatch);
      } else {
        await ctx.db.insert("mexicoEdgeMarketQuotes", {
          ...quoteValue,
          createdAt: Date.now(),
        });
        insertedCount += 1;
      }
      if (changed) {
        const detectionInterval = evidenceStorageEnabled
          ? deriveMexicoPolymarketDetectionInterval({
              changedFields,
              previous,
              current: quoteValue,
            })
          : undefined;
        await ctx.db.insert("mexicoEdgeMarketQuoteEvents", {
          ...quoteValue,
          eventType: previous ? "quote_change" : "initial",
          changedFields,
          trigger: args.trigger,
          ...(evidenceStorageEnabled
            ? {
                pollGeneration: args.generation,
                ...detectionInterval,
              }
            : {}),
          createdAt: Date.now(),
        });
        changedCount += 1;
      } else {
        unchangedCount += 1;
      }
      if (evidenceStorageEnabled) {
        // evidenceStorageEnabled rechecks the exact-true approvals at this
        // protected per-token write boundary.
        await ctx.db.insert("mexicoEdgeMarketQuoteHeartbeats", heartbeat);
        heartbeatCount += 1;
      }
    }
    const activeMarketIds = new Set(args.quotes.map((quote) => quote.marketId));
    const currentRows = await ctx.db
      .query("mexicoEdgeMarketQuotes")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", stationIcao).eq("date", args.date),
      )
      .take(500);
    let removedCount = 0;
    for (const row of currentRows) {
      if (!activeMarketIds.has(row.marketId)) {
        await ctx.db.delete(row._id);
        removedCount += 1;
      }
    }
    return {
      insertedCount,
      changedCount,
      unchangedCount,
      removedCount,
      heartbeatCount,
      deduplicatedHeartbeatCount: 0,
      heartbeatStatus: heartbeatApprovals.storageStatus,
    };
  },
});

async function fetchJson(url, options = {}) {
  const requestStartedAt = Date.now();
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await response.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }
  try {
    return {
      payload: JSON.parse(text),
      bytes,
      requestStartedAt,
      receivedAt: Date.now(),
    };
  } catch {
    throw new Error(`${url} returned malformed JSON.`);
  }
}

export function normalizeMexicoPolymarketLastTrade(row, tokenId) {
  const side = optionalString(row?.side)?.toUpperCase();
  const price = optionalPrice(row?.price, `last trade for ${tokenId}`);
  // The public endpoint documents exactly 0.5 plus an empty side as its
  // no-trades sentinel. Missing/empty side at any other value is an invalid
  // partial response and must not establish a successful poll boundary.
  if (!side) {
    if (price === "0.5") {
      return {};
    }
    throw new Error(
      `Polymarket returned an invalid no-trades sentinel for ${tokenId}.`,
    );
  }
  if (side !== "BUY" && side !== "SELL") {
    throw new Error(
      `Polymarket returned an invalid trade side for ${tokenId}.`,
    );
  }
  if (price === undefined) {
    throw new Error(
      `Polymarket returned an incomplete last trade for ${tokenId}.`,
    );
  }
  return { price, side };
}

function normalizeLastTrades(payload) {
  if (!Array.isArray(payload)) {
    throw new Error("Polymarket CLOB returned an invalid last-trades payload.");
  }
  const byToken = new Map();
  for (const row of payload) {
    const tokenId = requiredString(row?.token_id, "last-trade token id");
    if (byToken.has(tokenId)) {
      throw new Error("Polymarket CLOB returned duplicate last-trade tokens.");
    }
    byToken.set(tokenId, normalizeMexicoPolymarketLastTrade(row, tokenId));
  }
  return byToken;
}

export function validateMexicoPolymarketTokenCoverage(
  expectedTokenIds,
  bookTokenIds,
  lastTradeTokenIds,
) {
  const expected = new Set(expectedTokenIds);
  if (expected.size !== expectedTokenIds.length) {
    throw new Error("The requested Polymarket token list contains duplicates.");
  }
  for (const [label, actualIds] of [
    ["book", bookTokenIds],
    ["last-trade", lastTradeTokenIds],
  ]) {
    const actual = new Set(actualIds);
    if (actual.size !== actualIds.length) {
      throw new Error(`Polymarket returned duplicate ${label} tokens.`);
    }
    const missing = expectedTokenIds.filter((tokenId) => !actual.has(tokenId));
    const unexpected = actualIds.filter((tokenId) => !expected.has(tokenId));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `Polymarket ${label} token coverage mismatch ` +
          `(missing ${missing.length}, unexpected ${unexpected.length}).`,
      );
    }
  }
  return true;
}

function buildLiveQuotes(
  event,
  booksPayload,
  lastTradesPayload,
  transportTimingsByToken,
) {
  if (!Array.isArray(booksPayload)) {
    throw new Error("Polymarket CLOB returned an invalid books payload.");
  }
  const booksByToken = new Map();
  for (const book of booksPayload) {
    const tokenId = requiredString(book?.asset_id, "CLOB asset id");
    if (booksByToken.has(tokenId)) {
      throw new Error("Polymarket CLOB returned duplicate books.");
    }
    booksByToken.set(tokenId, book);
  }
  const lastTradesByToken = normalizeLastTrades(lastTradesPayload);
  const expectedTokenIds = event.markets
    .filter((market) => market.enableOrderBook)
    .map((market) => market.yesTokenId);
  validateMexicoPolymarketTokenCoverage(
    expectedTokenIds,
    [...booksByToken.keys()],
    [...lastTradesByToken.keys()],
  );
  return event.markets.map((market) => {
    const lastTrade = lastTradesByToken.get(market.yesTokenId);
    const normalizedBook = normalizeMexicoPolymarketClobBook(
      booksByToken.get(market.yesTokenId),
      {
        tokenId: market.yesTokenId,
        gammaOutcomePrice: market.gammaOutcomePrice,
        lastTrade,
      },
    );
    const quote = {
      eventId: event.eventId,
      marketId: market.marketId,
      marketSlug: market.marketSlug,
      conditionId: market.conditionId,
      label: market.label,
      displayOrder: market.displayOrder,
      yesTokenId: market.yesTokenId,
      ...(market.gammaOutcomePrice !== undefined
        ? {
            gammaOutcomePrice: market.gammaOutcomePrice,
            gammaProbabilityPct: market.gammaProbabilityPct,
          }
        : {}),
      ...normalizedBook,
      ...(market.enableOrderBook
        ? {
            lastTradeStatus:
              lastTrade?.price !== undefined ? "reported" : "no_trades",
          }
        : {}),
      ...(transportTimingsByToken?.get(market.yesTokenId) ?? {}),
      platformDisplayProbabilityPct: probabilityPct(
        normalizedBook.platformDisplayPrice,
      ),
      negRisk: normalizedBook.negRisk ?? market.negRisk,
    };
    if (quote.platformDisplayProbabilityPct === undefined) {
      delete quote.platformDisplayProbabilityPct;
    }
    quote.quoteFingerprint = buildMexicoPolymarketQuoteFingerprint(quote);
    return quote;
  });
}

async function collectLiveMarket(ctx, args, trigger) {
  const stationIcao = normalizeStationIcao(args.stationIcao);
  const date = args.date ? assertDateKey(args.date).date : currentMexicoDate();
  const attemptAt = Date.now();
  const claim = await ctx.runMutation(
    internal.mexicoPolymarketLive.claimLivePoll,
    { stationIcao, date, trigger, attemptAt },
  );
  if (!claim.claimed) {
    return {
      ok: claim.status === "cooldown" || claim.status === "busy",
      status: claim.status,
      stationIcao,
      date,
      flagName: POLYMARKET_LIVE_COLLECTION_FLAG,
      ...(claim.retryAfterAt !== undefined
        ? { retryAfterAt: claim.retryAfterAt }
        : {}),
    };
  }
  const generation = claim.generation;
  const gammaUrl = buildMexicoPolymarketLiveGammaUrl(date);
  let responseBytes = 0;
  try {
    if (!getCollectionAccess().enabled) {
      await ctx.runMutation(
        internal.mexicoPolymarketLive.cancelDisabledLivePoll,
        { stationIcao, generation, date },
      );
      return {
        ok: false,
        status: "collection_disabled",
        stationIcao,
        date,
        flagName: POLYMARKET_LIVE_COLLECTION_FLAG,
      };
    }
    const gamma = await fetchJson(gammaUrl);
    responseBytes += gamma.bytes;
    const event = normalizeMexicoPolymarketLiveEvent(gamma.payload, date);
    const gammaReceivedAt = gamma.receivedAt;
    const gammaLease = await ctx.runMutation(
      internal.mexicoPolymarketLive.renewLivePollLease,
      { stationIcao, generation, date, renewedAt: Date.now() },
    );
    if (!gammaLease.renewed) {
      throw new Error(
        "Polymarket live poll generation became stale after Gamma discovery.",
      );
    }
    const tokenIds = [
      ...new Set(
        event.markets
          .filter((market) => market.enableOrderBook)
          .map((market) => market.yesTokenId),
      ),
    ];
    let booksPayload = [];
    let lastTradesPayload = [];
    const transportTimingsByToken = new Map();
    let clobReceivedAt = gamma.receivedAt;
    for (let offset = 0; offset < tokenIds.length; offset += 500) {
      if (!getCollectionAccess().enabled) {
        await ctx.runMutation(
          internal.mexicoPolymarketLive.cancelDisabledLivePoll,
          { stationIcao, generation, date },
        );
        return {
          ok: false,
          status: "collection_disabled",
          stationIcao,
          date,
          flagName: POLYMARKET_LIVE_COLLECTION_FLAG,
        };
      }
      const chunkLease = await ctx.runMutation(
        internal.mexicoPolymarketLive.renewLivePollLease,
        { stationIcao, generation, date, renewedAt: Date.now() },
      );
      if (!chunkLease.renewed) {
        throw new Error(
          "Polymarket live poll generation became stale before CLOB fetch.",
        );
      }
      const chunk = tokenIds.slice(offset, offset + 500);
      const body = JSON.stringify(
        chunk.map((tokenId) => ({ token_id: tokenId })),
      );
      const [books, lastTrades] = await Promise.all([
        fetchJson(`${CLOB_BASE_URL}/books`, { method: "POST", body }),
        fetchJson(`${CLOB_BASE_URL}/last-trades-prices`, {
          method: "POST",
          body,
        }),
      ]);
      if (!Array.isArray(books.payload) || !Array.isArray(lastTrades.payload)) {
        throw new Error("Polymarket CLOB returned an invalid batch payload.");
      }
      booksPayload.push(...books.payload);
      lastTradesPayload.push(...lastTrades.payload);
      for (const tokenId of chunk) {
        transportTimingsByToken.set(tokenId, {
          bookFetchStartedAt: books.requestStartedAt,
          bookReceivedAt: books.receivedAt,
          lastTradeFetchStartedAt: lastTrades.requestStartedAt,
          lastTradeReceivedAt: lastTrades.receivedAt,
        });
      }
      responseBytes += books.bytes + lastTrades.bytes;
      clobReceivedAt = Math.max(
        clobReceivedAt,
        books.receivedAt,
        lastTrades.receivedAt,
      );
    }
    const quotes = buildLiveQuotes(
      event,
      booksPayload,
      lastTradesPayload,
      transportTimingsByToken,
    );
    const receivedAt = Math.max(gamma.receivedAt, clobReceivedAt);
    if (!getCollectionAccess().enabled) {
      await ctx.runMutation(
        internal.mexicoPolymarketLive.cancelDisabledLivePoll,
        { stationIcao, generation, date },
      );
      return {
        ok: false,
        status: "collection_disabled",
        stationIcao,
        date,
        flagName: POLYMARKET_LIVE_COLLECTION_FLAG,
      };
    }
    const storageLease = await ctx.runMutation(
      internal.mexicoPolymarketLive.renewLivePollLease,
      { stationIcao, generation, date, renewedAt: Date.now() },
    );
    if (!storageLease.renewed) {
      throw new Error(
        "Polymarket live poll generation became stale before storage.",
      );
    }
    const stored = await ctx.runMutation(
      internal.mexicoPolymarketLive.storeLiveMarketSnapshot,
      {
        stationIcao,
        date,
        generation,
        event,
        quotes,
        gammaUrl,
        fetchedAt: attemptAt,
        gammaReceivedAt,
        receivedAt,
        trigger,
      },
    );
    await ctx.runMutation(internal.mexicoPolymarketLive.finishLivePoll, {
      stationIcao,
      generation,
      status: "ok",
      completedAt: Date.now(),
      lastError: "",
      responseBytes,
      marketCount: quotes.length,
      changedQuoteCount: stored.changedCount,
    });
    return {
      ok: true,
      status: "ok",
      stationIcao,
      date,
      eventId: event.eventId,
      eventSlug: event.eventSlug,
      marketCount: quotes.length,
      changedQuoteCount: stored.changedCount,
      heartbeatCount: stored.heartbeatCount,
      heartbeatStatus: stored.heartbeatStatus,
      receivedAt,
      gammaReceivedAt,
      transport: "rest_polling",
    };
  } catch (error) {
    const message = String(error?.message ?? error)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
    await ctx.runMutation(internal.mexicoPolymarketLive.finishLivePoll, {
      stationIcao,
      generation,
      status: "error",
      completedAt: Date.now(),
      lastError: message,
      ...(responseBytes ? { responseBytes } : {}),
    });
    return {
      ok: false,
      status: "error",
      stationIcao,
      date,
      error: message,
    };
  }
}

export const refreshLiveMarket = actionGeneric({
  args: {
    stationIcao: v.string(),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentDate = currentMexicoDate();
    if (args.date !== undefined && args.date !== currentDate) {
      return {
        ok: false,
        status: "current_date_only",
        stationIcao: normalizeStationIcao(args.stationIcao),
        date: args.date,
        currentDate,
      };
    }
    return collectLiveMarket(ctx, { ...args, date: currentDate }, "manual");
  },
});

export const pollScheduledLiveMarket = internalActionGeneric({
  args: {
    stationIcao: v.string(),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => collectLiveMarket(ctx, args, "scheduled"),
});

export const superviseLiveMarketStream = internalActionGeneric({
  args: { stationIcao: v.string() },
  handler: async (_ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    return {
      stationIcao,
      status: "unavailable",
      connected: false,
      transport: "rest_polling",
      reason:
        "No persistent CLOB WebSocket listener is enabled in the current Convex runtime; scheduled REST polling remains authoritative.",
    };
  },
});

export const pruneQuoteEventsBatch = internalMutationGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    before: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao
      ? normalizeStationIcao(args.stationIcao)
      : undefined;
    const rows = stationIcao
      ? await ctx.db
          .query("mexicoEdgeMarketQuoteEvents")
          .withIndex("by_station_received_at", (query) =>
            query.eq("stationIcao", stationIcao).lt("receivedAt", args.before),
          )
          .take(RETENTION_BATCH_SIZE)
      : await ctx.db
          .query("mexicoEdgeMarketQuoteEvents")
          .withIndex("by_received_at", (query) =>
            query.lt("receivedAt", args.before),
          )
          .take(RETENTION_BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return {
      deletedCount: rows.length,
      hasMore: rows.length === RETENTION_BATCH_SIZE,
    };
  },
});

export const pruneQuoteHeartbeatsBatch = internalMutationGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    before: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao
      ? normalizeStationIcao(args.stationIcao)
      : undefined;
    const rows = stationIcao
      ? await ctx.db
          .query("mexicoEdgeMarketQuoteHeartbeats")
          .withIndex("by_station_received_at", (query) =>
            query.eq("stationIcao", stationIcao).lt("receivedAt", args.before),
          )
          .take(RETENTION_BATCH_SIZE)
      : await ctx.db
          .query("mexicoEdgeMarketQuoteHeartbeats")
          .withIndex("by_received_at", (query) =>
            query.lt("receivedAt", args.before),
          )
          .take(RETENTION_BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return {
      deletedCount: rows.length,
      hasMore: rows.length === RETENTION_BATCH_SIZE,
    };
  },
});

export const runQuoteEventRetention = internalActionGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const before = Date.now() - MEXICO_EDGE_QUOTE_EVENT_RETENTION_MS;
    let eventDeletedCount = 0;
    let eventHasMore = false;
    for (let batch = 0; batch < MAX_RETENTION_BATCHES; batch += 1) {
      const result = await ctx.runMutation(
        internal.mexicoPolymarketLive.pruneQuoteEventsBatch,
        {
          ...(args.stationIcao ? { stationIcao: args.stationIcao } : {}),
          before,
        },
      );
      eventDeletedCount += result.deletedCount;
      eventHasMore = result.hasMore;
      if (!eventHasMore) {
        break;
      }
    }
    let heartbeatDeletedCount = 0;
    let heartbeatHasMore = false;
    for (let batch = 0; batch < MAX_RETENTION_BATCHES; batch += 1) {
      const result = await ctx.runMutation(
        internal.mexicoPolymarketLive.pruneQuoteHeartbeatsBatch,
        {
          ...(args.stationIcao ? { stationIcao: args.stationIcao } : {}),
          before,
        },
      );
      heartbeatDeletedCount += result.deletedCount;
      heartbeatHasMore = result.hasMore;
      if (!heartbeatHasMore) {
        break;
      }
    }
    return {
      before,
      deletedCount: eventDeletedCount + heartbeatDeletedCount,
      eventDeletedCount,
      heartbeatDeletedCount,
      hasMore: eventHasMore || heartbeatHasMore,
      eventHasMore,
      heartbeatHasMore,
    };
  },
});

function publicStatusRow(row) {
  if (!row) {
    return null;
  }
  return compactObject({
    status: row.status,
    activeDate: row.activeDate,
    transport: row.transport,
    websocketStatus: row.websocketStatus,
    websocketReason: row.websocketReason,
    trigger: row.trigger,
    lastAttemptAt: row.lastAttemptAt,
    lastCompletedAt: row.lastCompletedAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    responseBytes: row.responseBytes,
    marketCount: row.marketCount,
    lastChangedQuoteCount: row.lastChangedQuoteCount,
    totalPollCount: row.totalPollCount,
    totalChangedQuoteCount: row.totalChangedQuoteCount,
    updatedAt: row.updatedAt,
  });
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  );
}

function publicQuote(row, { includeEvidenceMetadata = false } = {}) {
  return compactObject({
    eventId: row.eventId,
    marketId: row.marketId,
    marketSlug: row.marketSlug,
    conditionId: row.conditionId,
    label: row.label,
    displayOrder: row.displayOrder,
    yesTokenId: row.yesTokenId,
    gammaOutcomePrice: row.gammaOutcomePrice,
    gammaProbabilityPct: row.gammaProbabilityPct,
    bookAvailable: row.bookAvailable,
    bestBidPrice: row.bestBidPrice,
    bestBidProbabilityPct: probabilityPct(row.bestBidPrice),
    bestBidSize: row.bestBidSize,
    bestAskPrice: row.bestAskPrice,
    bestAskProbabilityPct: probabilityPct(row.bestAskPrice),
    bestAskSize: row.bestAskSize,
    midpointPrice: row.midpointPrice,
    midpointProbabilityPct: probabilityPct(row.midpointPrice),
    spreadPrice: row.spreadPrice,
    spreadPctPoints: probabilityPct(row.spreadPrice),
    lastTradePrice: row.lastTradePrice,
    lastTradeProbabilityPct: probabilityPct(row.lastTradePrice),
    lastTradeSide: row.lastTradeSide,
    platformDisplayPrice: row.platformDisplayPrice,
    platformDisplayProbabilityPct: row.platformDisplayProbabilityPct,
    platformDisplaySource: row.platformDisplaySource,
    tickSize: row.tickSize,
    minOrderSize: row.minOrderSize,
    bookTimestamp: row.bookTimestamp,
    bookHash: row.bookHash,
    ...(includeEvidenceMetadata
      ? {
          lastTradeStatus: row.lastTradeStatus,
          gammaReceivedAt: row.gammaReceivedAt,
          bookFetchStartedAt: row.bookFetchStartedAt,
          bookReceivedAt: row.bookReceivedAt,
          lastTradeFetchStartedAt: row.lastTradeFetchStartedAt,
          lastTradeReceivedAt: row.lastTradeReceivedAt,
        }
      : {}),
    negRisk: row.negRisk,
    fetchedAt: row.fetchedAt,
    receivedAt: row.receivedAt,
    lastChangedAt: row.lastChangedAt,
  });
}

function publicQuoteEvent(row, { includeEvidenceMetadata = false } = {}) {
  const detectionStartAt = Number.isFinite(row.detectionStartAt)
    ? row.detectionStartAt
    : undefined;
  return compactObject({
    ...publicQuote(row, { includeEvidenceMetadata }),
    eventType: row.eventType,
    changedFields: includeEvidenceMetadata
      ? row.changedFields
      : row.changedFields.filter((field) => field !== "lastTradeStatus"),
    trigger: row.trigger,
    ...(includeEvidenceMetadata
      ? {
          pollGeneration: row.pollGeneration,
          polledAt: row.receivedAt,
          isHeartbeat: false,
          ...(detectionStartAt !== undefined ? { detectionStartAt } : {}),
          detectionEndAt: Number.isFinite(row.detectionEndAt)
            ? row.detectionEndAt
            : row.receivedAt,
          detectionIntervalKind:
            row.detectionIntervalKind ??
            (detectionStartAt !== undefined ? "bounded" : "left_unbounded"),
        }
      : {}),
  });
}

function publicPollHeartbeat(row) {
  const detectionStartAt = Number.isFinite(row.previousPollReceivedAt)
    ? row.previousPollReceivedAt
    : undefined;
  return compactObject({
    source: row.source,
    eventId: row.eventId,
    marketId: row.marketId,
    yesTokenId: row.yesTokenId,
    pollId: row.pollGeneration,
    pollGeneration: row.pollGeneration,
    trigger: row.trigger,
    quoteFingerprint: row.quoteFingerprint,
    previousQuoteFingerprint: row.previousQuoteFingerprint,
    quoteChanged: row.quoteChanged,
    changedFields: row.changedFields,
    bestBidPrice: row.bestBidPrice,
    bestBidProbabilityPct: probabilityPct(row.bestBidPrice),
    bestAskPrice: row.bestAskPrice,
    bestAskProbabilityPct: probabilityPct(row.bestAskPrice),
    midpointPrice: row.midpointPrice,
    midpointProbabilityPct: probabilityPct(row.midpointPrice),
    spreadPrice: row.spreadPrice,
    spreadPctPoints: probabilityPct(row.spreadPrice),
    lastTradePrice: row.lastTradePrice,
    lastTradeProbabilityPct: probabilityPct(row.lastTradePrice),
    lastTradeSide: row.lastTradeSide,
    lastTradeStatus: row.lastTradeStatus,
    platformDisplayPrice: row.platformDisplayPrice,
    platformDisplayProbabilityPct: probabilityPct(row.platformDisplayPrice),
    platformDisplaySource: row.platformDisplaySource,
    gammaReceivedAt: row.gammaReceivedAt,
    bookFetchStartedAt: row.bookFetchStartedAt,
    bookReceivedAt: row.bookReceivedAt,
    lastTradeFetchStartedAt: row.lastTradeFetchStartedAt,
    lastTradeReceivedAt: row.lastTradeReceivedAt,
    previousGammaReceivedAt: row.previousGammaReceivedAt,
    previousBookReceivedAt: row.previousBookReceivedAt,
    previousLastTradeReceivedAt: row.previousLastTradeReceivedAt,
    fetchedAt: row.fetchedAt,
    receivedAt: row.receivedAt,
    polledAt: row.receivedAt,
    previousPollReceivedAt: row.previousPollReceivedAt,
    successfulPollGapMs:
      detectionStartAt !== undefined
        ? row.receivedAt - detectionStartAt
        : undefined,
    pollIntervalStartAt: detectionStartAt,
    pollIntervalEndAt: row.receivedAt,
    gammaDetectionStartAt: row.previousGammaReceivedAt,
    gammaDetectionEndAt: row.gammaReceivedAt,
    bookDetectionStartAt: row.previousBookReceivedAt,
    bookDetectionEndAt: row.bookReceivedAt,
    lastTradeDetectionStartAt: row.previousLastTradeReceivedAt,
    lastTradeDetectionEndAt: row.lastTradeReceivedAt,
    detectionStartAt,
    detectionEndAt: row.receivedAt,
    detectionIntervalKind:
      detectionStartAt !== undefined ? "bounded" : "left_unbounded",
    isHeartbeat: true,
    eventType: "poll_heartbeat",
  });
}

export const getLiveMarket = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const date = assertDateKey(args.date).date;
    const requestedLimit = Number.isFinite(args.limit)
      ? Math.trunc(args.limit)
      : 500;
    const limit = Math.max(1, Math.min(MAX_QUERY_EVENT_LIMIT, requestedLimit));
    const [event, quotes, newestEvents, status] = await Promise.all([
      ctx.db
        .query("mexicoEdgeMarketEvents")
        .withIndex("by_station_date", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .first(),
      ctx.db
        .query("mexicoEdgeMarketQuotes")
        .withIndex("by_station_date", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .collect(),
      ctx.db
        .query("mexicoEdgeMarketQuoteEvents")
        .withIndex("by_station_date_received", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .order("desc")
        .take(limit),
      getStatusRow(ctx, stationIcao),
    ]);
    quotes.sort(
      (left, right) =>
        left.displayOrder - right.displayOrder ||
        left.label.localeCompare(right.label) ||
        left.marketId.localeCompare(right.marketId),
    );
    const access = getCollectionAccess();
    const heartbeatApprovals = getDataApprovals();
    return {
      stationIcao,
      date,
      timezone: MEXICO_TIMEZONE,
      collection: {
        enabled: access.enabled,
        status: access.status,
        flagName: access.flagName,
      },
      heartbeatApprovals,
      transport: {
        active: "rest_polling",
        websocketStatus: "unavailable",
        websocketConnected: false,
        websocketReason:
          "Persistent CLOB WebSocket sessions are not enabled; data shown here comes from exact CLOB REST snapshots.",
      },
      displayRule:
        "Use the exact midpoint when the Yes spread is 0.10 or less; when it is greater than 0.10, use the exact last-trade price when available.",
      collectorStatus: publicStatusRow(status),
      event: event
        ? compactObject({
            eventId: event.eventId,
            eventSlug: event.eventSlug,
            eventTitle: event.eventTitle,
            eventUrl: event.eventUrl,
            description: event.description,
            resolutionSource: event.resolutionSource,
            endTimeUtc: event.endTimeUtc,
            endTimeIso: event.endTimeIso,
            eventActive: event.eventActive,
            eventClosed: event.eventClosed,
            negRisk: event.negRisk,
            sourceUpdatedAt: event.sourceUpdatedAt,
            marketCount: event.marketCount,
            receivedAt: event.receivedAt,
          })
        : null,
      quotes: quotes.map((row) =>
        publicQuote(row, {
          includeEvidenceMetadata: heartbeatApprovals.publicEnabled,
        }),
      ),
      quoteEvents: newestEvents.reverse().map((row) =>
        publicQuoteEvent(row, {
          includeEvidenceMetadata: heartbeatApprovals.publicEnabled,
        }),
      ),
    };
  },
});

export const getQuoteHistory = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    marketId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const date = assertDateKey(args.date).date;
    const marketId = requiredString(args.marketId, "market id");
    const requestedLimit = Number.isFinite(args.limit)
      ? Math.trunc(args.limit)
      : 1_000;
    const limit = Math.max(1, Math.min(MAX_QUERY_EVENT_LIMIT, requestedLimit));
    const heartbeatApprovals = getDataApprovals();
    const [rows, heartbeatRows] = await Promise.all([
      ctx.db
        .query("mexicoEdgeMarketQuoteEvents")
        .withIndex("by_station_date_market_received", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("date", date)
            .eq("marketId", marketId),
        )
        .order("desc")
        .take(limit + 1),
      heartbeatApprovals.publicEnabled
        ? ctx.db
            .query("mexicoEdgeMarketQuoteHeartbeats")
            .withIndex("by_station_date_market_received", (query) =>
              query
                .eq("stationIcao", stationIcao)
                .eq("date", date)
                .eq("marketId", marketId),
            )
            .order("desc")
            .take(limit + 1)
        : Promise.resolve([]),
    ]);
    const quoteEventsTruncated = rows.length > limit;
    const pollHeartbeatsTruncated = heartbeatRows.length > limit;
    const quoteEventPage = rows.slice(0, limit);
    const heartbeatPage = heartbeatRows.slice(0, limit);
    const predecessorHeartbeat = pollHeartbeatsTruncated
      ? publicPollHeartbeat(heartbeatRows[limit])
      : null;
    const quoteEventHistory = compactObject({
      limit,
      returnedCount: quoteEventPage.length,
      truncated: quoteEventsTruncated,
      oldestReceivedAt: quoteEventPage.at(-1)?.receivedAt,
      newestReceivedAt: quoteEventPage[0]?.receivedAt,
    });
    const pollHeartbeatHistory = compactObject({
      limit,
      returnedCount: heartbeatPage.length,
      truncated: pollHeartbeatsTruncated,
      oldestReceivedAt: heartbeatPage.at(-1)?.receivedAt,
      newestReceivedAt: heartbeatPage[0]?.receivedAt,
      retentionMs: MEXICO_EDGE_QUOTE_HEARTBEAT_RETENTION_MS,
      failedPollAttemptsIncluded: false,
      enabled: heartbeatApprovals.publicEnabled,
      status: heartbeatApprovals.publicStatus,
      requiredFlagNames: [
        POLYMARKET_DATA_ACCESS_APPROVAL_FLAG,
        POLYMARKET_DATA_RETENTION_APPROVAL_FLAG,
        POLYMARKET_DATA_PUBLIC_APPROVAL_FLAG,
      ],
    });
    return {
      stationIcao,
      date,
      marketId,
      heartbeatApprovals,
      quoteEvents: quoteEventPage.reverse().map((row) =>
        publicQuoteEvent(row, {
          includeEvidenceMetadata: heartbeatApprovals.publicEnabled,
        }),
      ),
      pollHeartbeats: heartbeatPage.reverse().map(publicPollHeartbeat),
      predecessorHeartbeat,
      quoteEventHistory,
      pollHeartbeatHistory,
    };
  },
});
