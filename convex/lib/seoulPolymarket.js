import {
  compareNormalizedDecimals,
  normalizeMexicoPolymarketClobBook,
  normalizeMexicoPolymarketLastTrade,
  normalizePolymarketDecimal,
} from "../mexicoPolymarketLive.js";

export const SEOUL_MARKET_SOURCE = "polymarket_gamma_clob_rest";
export const SEOUL_MARKET_FRESHNESS_MS = 3 * 60_000;
export const SEOUL_MARKET_RETENTION_MS = 14 * 24 * 60 * 60_000;
export const SEOUL_MARKET_FLAGS = Object.freeze({
  enabled: "POLYMARKET_RKSI_COLLECTION_ENABLED",
  access: "POLYMARKET_RKSI_DATA_ACCESS_APPROVED",
  retention: "POLYMARKET_RKSI_DATA_RETENTION_APPROVED",
  publicDisplay: "POLYMARKET_RKSI_DATA_PUBLIC_APPROVED",
});
// Reviewed October 29, 2026 against both the October 29 and October 30 events.
// A new template requires a fresh source/rules review before it can supply quotes.
export const REVIEWED_SEOUL_RULES_HASH = "07dfa801b7849b13e801b1c9c07f4fab5addb104b8fb5014603104fb63c992f6";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});

export function seoulMarketDate(now = Date.now()) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(now))
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validSeoulMarketDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}

export function seoulMarketSlug(date) {
  if (!validSeoulMarketDate(date)) throw new Error("Invalid Seoul market calendar date.");
  const [year, month, day] = date.split("-").map(Number);
  return `highest-temperature-in-seoul-on-${MONTHS[month - 1]}-${day}-${year}`;
}

export function seoulMarketGate(env, { publicRead = false } = {}) {
  const approved = Object.fromEntries(Object.entries(SEOUL_MARKET_FLAGS)
    .map(([name, flag]) => [name, env[flag] === "true"]));
  const status = !approved.access ? "access_approval_required"
    : !approved.retention ? "retention_approval_required"
    : publicRead && !approved.publicDisplay ? "public_approval_required"
    : !approved.enabled ? "disabled" : "ok";
  return { allowed: status === "ok", status, flags: approved };
}

export function normalizeSeoulRules(text) {
  return String(text ?? "")
    .replace(/\bon \d{1,2} [A-Z][a-z]{2} '\d{2}\b/g, "on {DATE}")
    .replace(/date=\d{4}-\d{2}-\d{2}T18:00:00Z/g, "date={DATE}T18:00:00Z")
    .replace(/\s+/g, " ").trim();
}

export async function seoulRulesFingerprint(description) {
  const bytes = new TextEncoder().encode(normalizeSeoulRules(description));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function text(value, label, limit = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new Error(`Invalid Polymarket ${label}.`);
  }
  return value.trim();
}

function identifier(value, label) {
  const result = text(String(value ?? ""), label, 100);
  if (!/^\d+$/.test(result)) throw new Error(`Invalid Polymarket ${label}.`);
  return result;
}

function array(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function unique(items, name) {
  if (new Set(items).size !== items.length) throw new Error(`Duplicate Polymarket ${name}.`);
}

export function parseSeoulTemperatureBucket(label) {
  const match = /^(-?\d+)°C(?: or (below|higher))?$/.exec(String(label ?? "").replace(/−/g, "-").trim());
  if (!match || Number(match[1]) < -80 || Number(match[1]) > 60) throw new Error("Unsupported Seoul temperature bucket.");
  return { temperatureC: Number(match[1]), bucketKind: match[2] === "below" ? "below" : match[2] === "higher" ? "above" : "exact" };
}

export async function normalizeSeoulMarketEvent(raw, date) {
  const slug = seoulMarketSlug(date);
  if (!raw || raw.slug !== slug || raw.eventDate !== date ||
      !Array.isArray(raw.series) || !raw.series.some((series) => String(series.id) === "10742" && series.slug === "seoul-daily-weather")) {
    throw new Error("Polymarket event does not match the requested Seoul date and series.");
  }
  if (!Array.isArray(raw.markets) || raw.markets.length < 3 || raw.markets.length > 32) {
    throw new Error("Unsupported Seoul market bucket count.");
  }
  const description = text(raw.description, "event rules", 20_000);
  const resolutionSource = text(raw.resolutionSource, "resolution source", 1_000);
  const [year, month, day] = date.split("-").map(Number);
  const expectedDateText = `on ${day} ${MONTH_SHORT[month - 1]} '${String(year).slice(-2)}.`;
  const expectedSource = `https://aviationweather.gov/api/data/metar?ids=RKSI&format=raw&date=${date}T18:00:00Z&hours=30`;
  const rulesFingerprint = await seoulRulesFingerprint(description);
  let rulesVerified = rulesFingerprint === REVIEWED_SEOUL_RULES_HASH &&
    description.includes(expectedDateText) && resolutionSource === expectedSource;
  const markets = raw.markets.map((market) => {
    const label = text(market.groupItemTitle, "temperature label", 80);
    const outcomes = array(market.outcomes).map((value) => String(value).trim().toLowerCase());
    const tokens = array(market.clobTokenIds);
    const prices = array(market.outcomePrices);
    if (outcomes.length !== 2 || outcomes.filter((value) => value === "yes").length !== 1 ||
        outcomes.filter((value) => value === "no").length !== 1 || tokens.length !== 2 ||
        (prices.length !== 0 && prices.length !== 2)) throw new Error("Invalid binary Seoul market outcomes.");
    // V2 position IDs need a separately reviewed identity mapping.
    rulesVerified &&= (!market.version || market.version === "v1") &&
      normalizeSeoulRules(market.description) === normalizeSeoulRules(description) &&
      market.resolutionSource === expectedSource;
    const yesIndex = outcomes.indexOf("yes");
    const conditionId = text(market.conditionId, "condition id", 66).toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(conditionId)) throw new Error("Invalid Seoul market condition id.");
    return {
      marketId: identifier(market.id, "market id"), label,
      ...parseSeoulTemperatureBucket(label),
      yesTokenId: identifier(tokens[yesIndex], "Yes asset id"),
      noTokenId: identifier(tokens[1 - yesIndex], "No asset id"),
      conditionId,
      gammaPrice: prices.length ? normalizePolymarketDecimal(prices[yesIndex], { maxOne: true }) : null,
      enableOrderBook: market.enableOrderBook === true && market.closed !== true,
    };
  }).sort((a, b) => a.temperatureC - b.temperatureC);
  unique(markets.map((market) => market.marketId), "market ids");
  unique(markets.map((market) => market.conditionId), "condition ids");
  unique(markets.flatMap((market) => [market.yesTokenId, market.noTokenId]), "outcome asset ids");
  if (markets.some((market, index) => market.temperatureC !== markets[0].temperatureC + index ||
      market.bucketKind !== (index === 0 ? "below" : index === markets.length - 1 ? "above" : "exact"))) {
    throw new Error("Seoul temperature buckets are not an unambiguous contiguous partition.");
  }
  return {
    event: {
      eventId: identifier(raw.id, "event id"), eventSlug: slug,
      title: text(raw.title, "event title"), url: `https://polymarket.com/event/${slug}`,
      resolutionSource, description, rulesFingerprint, rulesVerified, closed: raw.closed === true,
    },
    markets: markets.map((market, sortOrder) => ({ ...market, sortOrder })),
  };
}

function responseMap(rows, field, expected, kind) {
  if (!Array.isArray(rows) || rows.length > 32) throw new Error(`Invalid Polymarket ${kind} response.`);
  const result = new Map();
  for (const row of rows) {
    const id = String(row?.[field] ?? "");
    if (!expected.has(id) || result.has(id)) throw new Error(`Unexpected or duplicate Polymarket ${kind} asset.`);
    result.set(id, row);
  }
  return result;
}

export function buildSeoulMarketQuotes(markets, books, trades, clocks) {
  const expected = new Set(markets.filter((market) => market.enableOrderBook).map((market) => market.yesTokenId));
  const byBook = responseMap(books, "asset_id", expected, "book");
  const byTrade = responseMap(trades, "token_id", expected, "last trade");
  return markets.map((market) => {
    const rawBook = byBook.get(market.yesTokenId);
    const rawTrade = byTrade.get(market.yesTokenId);
    const lastTrade = rawTrade ? normalizeMexicoPolymarketLastTrade(rawTrade, market.yesTokenId) : {};
    let book = rawBook;
    if (book) {
      if (String(book.market).toLowerCase() !== market.conditionId ||
          !Array.isArray(book.bids) || !Array.isArray(book.asks) || book.bids.length + book.asks.length > 10_000) {
        throw new Error("Invalid Seoul order book identity or levels.");
      }
      const nonempty = (levels) => levels.filter((level) =>
        compareNormalizedDecimals(normalizePolymarketDecimal(level?.size), "0") > 0);
      book = { ...book, bids: nonempty(book.bids), asks: nonempty(book.asks) };
    }
    const quote = normalizeMexicoPolymarketClobBook(book, { tokenId: market.yesTokenId, lastTrade });
    const bookTimestamp = quote.bookTimestamp ?? null;
    const staleBook = Boolean(book) && (!Number.isFinite(bookTimestamp) ||
      bookTimestamp > clocks.bookReceivedAt || clocks.bookReceivedAt - bookTimestamp > SEOUL_MARKET_FRESHNESS_MS);
    const quoteStatus = !book ? "no_book" : staleBook ? "stale" : "ok";
    return {
      marketId: market.marketId, label: market.label, sortOrder: market.sortOrder,
      bucketKind: market.bucketKind, temperatureC: market.temperatureC, yesTokenId: market.yesTokenId,
      bestBidPrice: quoteStatus === "ok" ? quote.bestBidPrice ?? null : null,
      bestBidSize: quoteStatus === "ok" ? quote.bestBidSize ?? null : null,
      bestAskPrice: quoteStatus === "ok" ? quote.bestAskPrice ?? null : null,
      bestAskSize: quoteStatus === "ok" ? quote.bestAskSize ?? null : null,
      lastTradePrice: lastTrade.price ?? null,
      gammaPrice: market.gammaPrice,
      bookTimestamp, bookReceivedAt: book ? clocks.bookReceivedAt : null,
      lastTradeReceivedAt: rawTrade ? clocks.lastTradeReceivedAt : null,
      quoteStatus,
    };
  });
}

export function seoulQuoteSnapshotStatus(markets) {
  if (!markets.length) return "no_data";
  if (markets.every((market) => market.quoteStatus === "stale")) return "stale";
  return markets.every((market) => market.quoteStatus === "ok") ? "ok" : "partial";
}
