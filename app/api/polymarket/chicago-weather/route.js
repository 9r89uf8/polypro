import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const CHICAGO_TZ = "America/Chicago";

function getChicagoDateParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("Unable to derive Chicago date parts.");
  }

  return { year, month, day };
}

function buildDefaultChicagoEventSlugs(now = new Date()) {
  // Anchor on Chicago calendar date (not UTC date) to avoid timezone drift.
  const { year, month, day } = getChicagoDateParts(now);
  const start = new Date(Date.UTC(year, month - 1, day));

  return Array.from({ length: 3 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);

    const monthName = d
      .toLocaleString("en-US", {
        month: "long",
        timeZone: "UTC",
      })
      .toLowerCase();

    return `highest-temperature-in-chicago-on-${monthName}-${d.getUTCDate()}-${d.getUTCFullYear()}`;
  });
}

function parsePossiblyJsonArray(value) {
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function toNum(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLevels(levels, side) {
  const arr = Array.isArray(levels) ? [...levels] : [];
  arr.sort((a, b) => {
    const pa = Number(a?.price);
    const pb = Number(b?.price);

    if (!Number.isFinite(pa) && !Number.isFinite(pb)) return 0;
    if (!Number.isFinite(pa)) return 1;
    if (!Number.isFinite(pb)) return -1;

    // asks: lowest first, bids: highest first
    return side === "asks" ? pa - pb : pb - pa;
  });
  return arr;
}

function normalizeBook(book) {
  if (!book) return book;
  return {
    ...book,
    bids: normalizeLevels(book.bids, "bids"),
    asks: normalizeLevels(book.asks, "asks"),
  };
}

function trimBook(book, depth) {
  return {
    ...book,
    bids: Array.isArray(book?.bids) ? book.bids.slice(0, depth) : [],
    asks: Array.isArray(book?.asks) ? book.asks.slice(0, depth) : [],
  };
}

function estimateBuyFromAsks(asks, amountUsd) {
  let remaining = amountUsd;
  let shares = 0;
  let filledUsd = 0;
  let worstFillPrice = null;

  for (const level of Array.isArray(asks) ? asks : []) {
    const price = toNum(level?.price);
    const size = toNum(level?.size);
    if (!price || price <= 0 || !size || size <= 0) continue;

    const levelNotional = price * size;
    if (levelNotional <= remaining + 1e-12) {
      shares += size;
      remaining -= levelNotional;
      filledUsd += levelNotional;
      worstFillPrice = price;
      continue;
    }

    const partialShares = remaining / price;
    shares += partialShares;
    filledUsd += remaining;
    remaining = 0;
    worstFillPrice = price;
    break;
  }

  const avgPrice = shares > 0 ? filledUsd / shares : null;

  return {
    amountUsd,
    filledUsd,
    unfilledUsd: remaining,
    fillPct: amountUsd > 0 ? filledUsd / amountUsd : null,
    shares,
    avgPrice,
    avgPriceCents: avgPrice != null ? avgPrice * 100 : null,
    // Gross payout if the outcome wins: $1 per share (ignores fees)
    toWinUsd: shares,
    grossProfitUsd: shares - amountUsd,
    worstFillPrice,
  };
}

async function fetchGammaEventBySlug(slug) {
  const response = await fetch(`${GAMMA}/events/slug/${encodeURIComponent(slug)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Gamma events/slug failed (${response.status}) for ${slug}`);
  }

  return response.json();
}

async function fetchClobBooks(tokenIds) {
  const response = await fetch(`${CLOB}/books`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(tokenIds.map((tokenId) => ({ token_id: tokenId }))),
  });

  if (!response.ok) {
    throw new Error(`CLOB /books failed (${response.status})`);
  }

  return response.json();
}

export async function GET(request) {
  try {
    const url = new URL(request.url);

    const requestedDepth = Number(url.searchParams.get("depth") ?? 25);
    const requestedAmount = Number(url.searchParams.get("amount") ?? 20);

    const depth = Number.isFinite(requestedDepth)
      ? Math.max(1, Math.min(100, requestedDepth))
      : 25;
    const amount = Number.isFinite(requestedAmount) ? Math.max(0, requestedAmount) : 20;

    const slugsParam = url.searchParams.get("slugs");
    const explicitSlugs = slugsParam
      ? slugsParam
          .split(",")
          .map((slug) => slug.trim())
          .filter(Boolean)
      : [];
    const eventSlugs = explicitSlugs.length > 0 ? explicitSlugs : buildDefaultChicagoEventSlugs();

    const events = await Promise.all(eventSlugs.map(fetchGammaEventBySlug));
    const allMarkets = events.flatMap((event) => event?.markets ?? []);
    const randomMarket =
      allMarkets.length > 0
        ? allMarkets[Math.floor(Math.random() * allMarkets.length)]
        : null;
    console.log("[polymarket/chicago-weather] random Gamma market", randomMarket);

    const tokenSet = new Set();
    for (const event of events) {
      for (const market of event?.markets ?? []) {
        if (market?.enableOrderBook === false) continue;
        const ids = parsePossiblyJsonArray(market?.clobTokenIds);
        for (const id of ids) {
          if (typeof id === "string" && id.length > 0) tokenSet.add(id);
        }
      }
    }

    const tokenIds = Array.from(tokenSet);
    if (tokenIds.length === 0) {
      return NextResponse.json(
        { error: "No CLOB token IDs found for these slugs.", eventSlugs },
        { status: 404 },
      );
    }

    const books = await fetchClobBooks(tokenIds);
    const bookByToken = new Map();
    for (const raw of books) {
      if (!raw?.asset_id) continue;
      bookByToken.set(raw.asset_id, normalizeBook(raw));
    }

    const response = {
      generatedAt: new Date().toISOString(),
      amountUsd: amount,
      depth,
      eventSlugs,
      events: events.map((event) => {
        const markets = (event?.markets ?? [])
          .filter((market) => market?.enableOrderBook !== false)
          .map((market) => {
            const clobTokenIds = parsePossiblyJsonArray(market?.clobTokenIds);
            const [yesTokenId, noTokenId] = clobTokenIds;

            const yesBook = yesTokenId ? bookByToken.get(yesTokenId) : undefined;
            const noBook = noTokenId ? bookByToken.get(noTokenId) : undefined;

            const label =
              market?.groupItemTitle ??
              parsePossiblyJsonArray(market?.shortOutcomes)[0] ??
              market?.question ??
              market?.slug ??
              "Unknown market";

            const gammaYesBestAsk = toNum(market?.bestAsk);
            const gammaYesBestBid = toNum(market?.bestBid);
            const gammaYesLastTradePrice = toNum(market?.lastTradePrice);

            const clobYesBestAsk = toNum(yesBook?.asks?.[0]?.price);
            const clobYesBestBid = toNum(yesBook?.bids?.[0]?.price);
            const clobNoBestAsk = toNum(noBook?.asks?.[0]?.price);
            const clobNoBestBid = toNum(noBook?.bids?.[0]?.price);

            const yesBestAsk = gammaYesBestAsk ?? clobYesBestAsk;
            const yesBestBid = gammaYesBestBid ?? clobYesBestBid;
            const noBestAsk = clobNoBestAsk ?? (yesBestBid != null ? 1 - yesBestBid : null);
            const noBestBid = clobNoBestBid ?? (yesBestAsk != null ? 1 - yesBestAsk : null);

            return {
              id: market?.id ?? null,
              slug: market?.slug ?? null,
              conditionId: market?.conditionId ?? null,
              label,
              outcomes: parsePossiblyJsonArray(market?.outcomes),
              outcomePrices: parsePossiblyJsonArray(market?.outcomePrices),
              tokens: {
                yes: yesTokenId ?? null,
                no: noTokenId ?? null,
              },
              yes: {
                bestAsk: yesBestAsk,
                bestAskCents: yesBestAsk != null ? yesBestAsk * 100 : null,
                bestBid: yesBestBid,
                bestBidCents: yesBestBid != null ? yesBestBid * 100 : null,
                lastTradePrice: gammaYesLastTradePrice,
                lastTradePriceCents:
                  gammaYesLastTradePrice != null ? gammaYesLastTradePrice * 100 : null,
                quoteSource: gammaYesBestAsk != null || gammaYesBestBid != null ? "gamma" : "clob",
                estimateForAmount: yesBook ? estimateBuyFromAsks(yesBook.asks, amount) : null,
                orderbook: yesBook ? trimBook(yesBook, depth) : null,
              },
              no: {
                bestAsk: noBestAsk,
                bestAskCents: noBestAsk != null ? noBestAsk * 100 : null,
                bestBid: noBestBid,
                bestBidCents: noBestBid != null ? noBestBid * 100 : null,
                estimateForAmount: noBook ? estimateBuyFromAsks(noBook.asks, amount) : null,
                orderbook: noBook ? trimBook(noBook, depth) : null,
              },
            };
          });

        return {
          id: event?.id ?? null,
          slug: event?.slug ?? null,
          title: event?.title ?? null,
          markets,
        };
      }),
    };

    return NextResponse.json(response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
