import {
  REVIEWED_SEOUL_RULES_HASH, SEOUL_MARKET_FRESHNESS_MS, SEOUL_MARKET_RETENTION_MS,
  SEOUL_MARKET_SOURCE, parseSeoulTemperatureBucket, seoulMarketDate, seoulMarketSlug,
  validSeoulMarketDate,
} from "./seoulPolymarket.js";
import { compareNormalizedDecimals, normalizePolymarketDecimal } from "../mexicoPolymarketLive.js";

export const SEOUL_HISTORY_SAMPLE_MS = 5 * 60_000;
export const SEOUL_FORECAST_HISTORY_LIMIT = 160;
export const SEOUL_FORECAST_STALE_MS = 6 * 60 * 60_000;
export const SEOUL_FORECAST_APPROVAL_FLAG = "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED";
export const SEOUL_FORECAST_SOURCE = "kma_amo_airport";
export const SEOUL_FORECAST_URL = "https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI";
const DAY = 86_400_000;

export function seoulHistoryDay(date, now) {
  if (!validSeoulMarketDate(date)) return null;
  const start = Date.parse(`${date}T00:00:00+09:00`), end = start + DAY;
  if (start > now || end <= now - SEOUL_MARKET_RETENTION_MS) return null;
  return { start, end, retainedStart: Math.max(start, now - SEOUL_MARKET_RETENTION_MS) };
}

export function seoulPriceHistoryWindows(date, now) {
  const day = seoulHistoryDay(date, now);
  if (!day) return [];
  const windows = [];
  for (let start = day.start; start <= now && start < day.end; start += SEOUL_HISTORY_SAMPLE_MS) {
    if (start + SEOUL_HISTORY_SAMPLE_MS <= day.retainedStart) continue;
    windows.push({ start: Math.max(start, day.retainedStart), end: Math.min(start + SEOUL_HISTORY_SAMPLE_MS, day.end) });
  }
  return windows;
}

function validEvent(snapshot, date, now) {
  const event = snapshot?.event;
  const slug = seoulMarketSlug(date);
  return snapshot?.stationIcao === "RKSI" && snapshot.source === SEOUL_MARKET_SOURCE && snapshot.date === date &&
    Number.isFinite(snapshot.polledAt) && snapshot.polledAt <= now && seoulMarketDate(snapshot.polledAt) === date &&
    event?.rulesVerified === true && event.rulesFingerprint === REVIEWED_SEOUL_RULES_HASH && /^\d+$/.test(event.eventId) &&
    event.eventSlug === slug && event.url === `https://polymarket.com/event/${slug}` &&
    event.resolutionSource === `https://aviationweather.gov/api/data/metar?ids=RKSI&format=raw&date=${date}T18:00:00Z&hours=30`;
}

function validBucket(market) {
  if (!market || !/^\d+$/.test(market.marketId) || !/^\d+$/.test(market.yesTokenId) ||
      !Number.isInteger(market.sortOrder) || market.sortOrder < 0) return false;
  try {
    const parsed = parseSeoulTemperatureBucket(market.label);
    return parsed.temperatureC === market.temperatureC && parsed.bucketKind === market.bucketKind;
  } catch { return false; }
}

function sameBucket(left, right) {
  return left.marketId === right.marketId && left.yesTokenId === right.yesTokenId &&
    left.temperatureC === right.temperatureC && left.bucketKind === right.bucketKind && left.label === right.label;
}

export function historicalSeoulMidpoint(market, polledAt) {
  const empty = (quoteStatus) => ({ midpoint: null, quoteStatus, bestBidPrice: null, bestAskPrice: null,
    bookTimestamp: null, bookReceivedAt: null });
  if (!market) return empty("missing");
  if (market.quoteStatus !== "ok") return empty(market.quoteStatus ?? "invalid");
  if (![market.bookTimestamp, market.bookReceivedAt, polledAt].every(Number.isFinite) ||
      market.bookTimestamp > market.bookReceivedAt || market.bookReceivedAt > polledAt ||
      polledAt - market.bookTimestamp > SEOUL_MARKET_FRESHNESS_MS ||
      polledAt - market.bookReceivedAt > SEOUL_MARKET_FRESHNESS_MS) return empty("stale");
  if (market.bestBidPrice === null || market.bestAskPrice === null ||
      market.bestBidPrice === undefined || market.bestAskPrice === undefined) return empty("one_sided");
  try {
    const bid = normalizePolymarketDecimal(market.bestBidPrice, { maxOne: true });
    const ask = normalizePolymarketDecimal(market.bestAskPrice, { maxOne: true });
    if (compareNormalizedDecimals(bid, ask) > 0) return empty("crossed");
    if (compareNormalizedDecimals(normalizePolymarketDecimal(market.bestBidSize), "0") <= 0 ||
        compareNormalizedDecimals(normalizePolymarketDecimal(market.bestAskSize), "0") <= 0) return empty("empty_size");
    return { midpoint: (Number(bid) + Number(ask)) / 2, quoteStatus: "ok",
      bestBidPrice: bid, bestAskPrice: ask, bookTimestamp: market.bookTimestamp, bookReceivedAt: market.bookReceivedAt };
  } catch { return empty("invalid"); }
}

export function buildSeoulPriceHistory({ samples, date, now, collector }) {
  const day = seoulHistoryDay(date, now);
  const validSamples = samples.filter(({ snapshot }) => validEvent(snapshot, date, now));
  const anchor = [...validSamples].reverse().find(({ snapshot }) => snapshot.markets.length > 0)?.snapshot;
  const latestPolledAt = samples.reduce((latest, { snapshot }) =>
    Number.isFinite(snapshot?.polledAt) && snapshot.polledAt <= now ? Math.max(latest ?? 0, snapshot.polledAt) : latest, null);
  const common = { collectorStatus: collector?.status ?? "no_data", latestPolledAt,
    sampleCount: samples.filter(({ snapshot }) => snapshot !== null).length,
    samplingIntervalMinutes: SEOUL_HISTORY_SAMPLE_MS / 60_000,
    truncated: Boolean(day && day.retainedStart > day.start) };
  if (!anchor) return { ...common, status: samples.some(({ snapshot }) => snapshot && !validEvent(snapshot, date, now))
    ? "unsupported_rules" : "no_data", event: null, series: [] };
  const buckets = anchor.markets.filter(validBucket);
  if (buckets.length !== anchor.markets.length || buckets.length > 32 ||
      new Set(buckets.map((row) => row.marketId)).size !== buckets.length ||
      new Set(buckets.map((row) => row.yesTokenId)).size !== buckets.length) {
    return { ...common, status: "unsupported_rules", event: null, series: [] };
  }
  const series = buckets.sort((a, b) => a.sortOrder - b.sortOrder).map((bucket) => ({
    marketId: bucket.marketId, yesTokenId: bucket.yesTokenId, label: bucket.label,
    temperatureC: bucket.temperatureC, bucketKind: bucket.bucketKind, sortOrder: bucket.sortOrder,
    points: samples.map(({ start, snapshot }) => {
      const valid = validEvent(snapshot, date, now) && snapshot.event.eventId === anchor.event.eventId;
      const market = valid ? snapshot.markets.find((row) => validBucket(row) && sameBucket(row, bucket)) : null;
      return { at: Number.isFinite(snapshot?.polledAt) ? snapshot.polledAt : start,
        ...historicalSeoulMidpoint(market, snapshot?.polledAt) };
    }),
  }));
  const event = { eventId: anchor.event.eventId, eventSlug: anchor.event.eventSlug, title: anchor.event.title,
    url: anchor.event.url, rulesFingerprint: anchor.event.rulesFingerprint, rulesVerified: true,
    resolutionSource: anchor.event.resolutionSource, closed: anchor.event.closed };
  return { ...common, status: series.some((item) => item.points.some((point) => point.midpoint !== null)) ? "ok" : "no_data",
    event, series };
}

function forecastPoint(capture, targetDate) {
  const common = { capturedAt: capture.capturedAt,
    pageReportedAt: Number.isFinite(capture.pageReportedAt) ? capture.pageReportedAt : null,
    highTempC: null, forecastType: null, deltaC: null, status: capture.status === "error" ? "error" : "no_data" };
  if (capture.status !== "ok") return common;
  const targetRows = (capture.dailyRows ?? []).filter((row) => row.date === targetDate &&
    ["short_term", "midterm"].includes(row.forecastType) && Number.isFinite(row.maxTempC) && row.maxTempC >= -80 && row.maxTempC <= 60);
  const rows = targetRows.some((row) => row.forecastType === "short_term")
    ? targetRows.filter((row) => row.forecastType === "short_term") : targetRows;
  if (!rows.length || new Set(rows.map((row) => row.maxTempC)).size !== 1) return common;
  return { ...common, highTempC: rows[0].maxTempC, forecastType: rows[0].forecastType, status: "ok" };
}

export function buildSeoulForecastHighHistory({ captures, previousCaptures, date, now, collector, truncated = false,
  previousDayTruncated = false }) {
  const day = seoulHistoryDay(date, now);
  const valid = (capture) => capture.stationIcao === "RKSI" && capture.source === SEOUL_FORECAST_SOURCE &&
    capture.sourceUrl === SEOUL_FORECAST_URL && Number.isFinite(capture.capturedAt) && capture.capturedAt <= now &&
    seoulMarketDate(capture.capturedAt) === capture.captureDate;
  const history = captures.filter((row) => valid(row) && row.capturedAt >= day.start && row.capturedAt < day.end)
    .sort((a, b) => a.capturedAt - b.capturedAt).map((row) => forecastPoint(row, date));
  let previous = null, revisionCount = 0;
  for (const point of history) {
    if (point.highTempC === null) continue;
    if (previous !== null) {
      point.deltaC = Math.round((point.highTempC - previous) * 1e6) / 1e6;
      if (point.deltaC !== 0) revisionCount += 1;
    }
    previous = point.highTempC;
  }
  const usable = history.filter((point) => point.highTempC !== null);
  const first = usable[0] ?? null, latest = usable.at(-1) ?? null;
  const previousDayBaseline = previousCaptures.filter((row) => valid(row) && row.capturedAt >= day.start - DAY && row.capturedAt < day.start)
    .sort((a, b) => b.capturedAt - a.capturedAt).map((row) => forecastPoint(row, date)).find((point) => point.highTempC !== null) ?? null;
  const lastAttempt = history.at(-1);
  const status = lastAttempt?.status === "error" ? "error" : !latest ? "no_data"
    : date === seoulMarketDate(now) && now - latest.capturedAt > SEOUL_FORECAST_STALE_MS ? "stale" : "ok";
  return { status, collectorStatus: collector?.status ?? "no_data", truncated, previousDayTruncated,
    captureCount: history.length, revisionCount, first, latest,
    deltaC: first && latest && !truncated ? Math.round((latest.highTempC - first.highTempC) * 1e6) / 1e6 : null,
    previousDayBaseline, history };
}
