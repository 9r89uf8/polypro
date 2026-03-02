Here’s a clean way to build a **read‑only Next.js API endpoint** that pulls **Chicago weather market** data from Polymarket (markets → token IDs → orderbooks → prices), and also computes the kind of “$20 at X¢ → to win $Y” numbers you described.

## What you’ll pull from Polymarket

Polymarket market data is available via public REST endpoints (no auth needed). ([Polymarket Documentation][1])

You’ll typically use:

1. **Gamma API (discovery)** – get event + markets + token IDs

* `GET https://gamma-api.polymarket.com/events/slug/{slug}` ([Polymarket Documentation][2])
* Each market maps to a **pair of CLOB token IDs** (Yes, No). ([Polymarket Documentation][1])
* In Gamma responses, fields like `clobTokenIds`, `outcomes`, `outcomePrices` are often **JSON-encoded strings** (you’ll `JSON.parse` them). ([Polymarket Documentation][1])

2. **CLOB API (orderbooks / prices)** – get the live book per token

* Single: `GET https://clob.polymarket.com/book?token_id=...` ([Polymarket Documentation][3])
* Batch (recommended): `POST https://clob.polymarket.com/books` with `[{ token_id }, ...]` ([Polymarket Documentation][4])

3. (Optional) **WebSocket** for real-time book updates

* `wss://ws-subscriptions-clob.polymarket.com/ws/market` ([Polymarket Documentation][5])

## How “To win” works (for your display)

After resolution, **winning outcome tokens redeem for $1 each**. ([Polymarket Documentation][6])
So if you estimate you’ll receive `shares`, then:

* **To win (gross payout)** ≈ `shares * 1.0` = `shares`
* If you spend a fixed amount `A` at average fill price `P`, then `shares ≈ A / P`

Polymarket’s UI “Avg. Price” often reflects walking the orderbook (slippage), not just the top ask — so you’ll want to estimate the average fill price by consuming the ask levels (example code below).

---

## Next.js API Route (one endpoint for Chicago today + next 2 days)

This route:

* Defaults to the 3 event slugs for the current Chicago date + next 2 days
  (for example, on June 12 it will use June 12, 13, 14)
* Fetches each event from Gamma
* Extracts each market’s **Yes/No token IDs** (`clobTokenIds`)
* Pulls **all orderbooks in one batch** from `/books`
* Returns:

    * per outcome: best bid/ask, trimmed orderbook, and a `$amount` “to win” estimate

Create: `app/api/polymarket/chicago-weather/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

const CHICAGO_TZ = "America/Chicago";

function getChicagoDateParts(now: Date) {
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

    const monthName = d.toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    }).toLowerCase();

    return `highest-temperature-in-chicago-on-${monthName}-${d.getUTCDate()}-${d.getUTCFullYear()}`;
  });
}

// -----------------------
// Types (minimal / loose)
// -----------------------
type GammaMarket = {
  id?: string;
  slug?: string;
  question?: string;
  conditionId?: string;
  enableOrderBook?: boolean;
  // Often a JSON string, sometimes an array depending on client/tools
  clobTokenIds?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;

  // Helpful for multi-market events (often present)
  groupItemTitle?: string;
  shortOutcomes?: unknown;
};

type GammaEvent = {
  id?: string;
  slug?: string;
  title?: string;
  markets?: GammaMarket[];
};

type OrderLevel = { price: string; size: string };

type ClobBook = {
  market: string; // condition id
  asset_id: string; // token id
  timestamp: string;
  hash: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
  last_trade_price: string;
};

function parsePossiblyJsonArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];

  if (typeof value === "string") {
    // Gamma often returns JSON-encoded arrays as strings:
    // e.g. '["123","456"]'
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function toNum(x: string | undefined): number | null {
  if (!x) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function trimBook(book: ClobBook, depth: number): ClobBook {
  return {
    ...book,
    bids: book.bids.slice(0, depth),
    asks: book.asks.slice(0, depth),
  };
}

// Walk asks to estimate how many shares you can buy for amountUsd.
// size is interpreted as "shares" at that price level.
function estimateBuyFromAsks(asks: OrderLevel[], amountUsd: number) {
  let remaining = amountUsd;
  let shares = 0;
  let filledUsd = 0;
  let worstFillPrice: number | null = null;

  for (const lvl of asks) {
    const p = toNum(lvl.price);
    const s = toNum(lvl.size);

    if (!p || p <= 0 || !s || s <= 0) continue;

    const levelNotional = p * s; // dollars to take whole level
    if (levelNotional <= remaining + 1e-12) {
      // take full level
      shares += s;
      remaining -= levelNotional;
      filledUsd += levelNotional;
      worstFillPrice = p;
    } else {
      // partial fill at this level
      const partialShares = remaining / p;
      shares += partialShares;
      filledUsd += remaining;
      remaining = 0;
      worstFillPrice = p;
      break;
    }
  }

  const avgPrice = shares > 0 ? filledUsd / shares : null;

  return {
    amountUsd,
    filledUsd,
    unfilledUsd: remaining,
    fillPct: amountUsd > 0 ? filledUsd / amountUsd : null,
    shares,
    avgPrice, // dollars (0..1)
    avgPriceCents: avgPrice != null ? avgPrice * 100 : null,
    // Gross payout if the outcome wins: $1 per share (ignores fees)
    toWinUsd: shares,
    grossProfitUsd: shares - amountUsd,
    worstFillPrice,
  };
}

async function fetchGammaEventBySlug(slug: string): Promise<GammaEvent> {
  const res = await fetch(`${GAMMA}/events/slug/${encodeURIComponent(slug)}`, {
    cache: "no-store",
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Gamma events/slug failed (${res.status}) for ${slug}`);
  }
  return (await res.json()) as GammaEvent;
}

async function fetchClobBooks(tokenIds: string[]): Promise<ClobBook[]> {
  const res = await fetch(`${CLOB}/books`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(tokenIds.map((t) => ({ token_id: t }))),
  });

  if (!res.ok) {
    throw new Error(`CLOB /books failed (${res.status})`);
  }
  return (await res.json()) as ClobBook[];
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const depth = Math.max(1, Math.min(100, Number(url.searchParams.get("depth") ?? 25)));
    const amount = Math.max(0, Number(url.searchParams.get("amount") ?? 20));

    // Optional override:
    // /api/polymarket/chicago-weather?slugs=slug1,slug2,slug3
    const slugsParam = url.searchParams.get("slugs");
    const eventSlugs =
      slugsParam?.split(",").map((s) => s.trim()).filter(Boolean) ?? buildDefaultChicagoEventSlugs();

    // 1) Fetch events from Gamma
    const events = await Promise.all(eventSlugs.map(fetchGammaEventBySlug));

    // 2) Collect token IDs for all markets across events
    // Each market has clobTokenIds: [YesTokenId, NoTokenId]  :contentReference[oaicite:8]{index=8}
    const tokenSet = new Set<string>();
    for (const ev of events) {
      for (const m of ev.markets ?? []) {
        // only markets tradable via CLOB if enableOrderBook true :contentReference[oaicite:9]{index=9}
        if (m.enableOrderBook === false) continue;

        const ids = parsePossiblyJsonArray<string>(m.clobTokenIds);
        for (const id of ids) {
          if (typeof id === "string" && id.length > 0) tokenSet.add(id);
        }
      }
    }

    const tokenIds = Array.from(tokenSet);
    if (tokenIds.length === 0) {
      return NextResponse.json(
        { error: "No CLOB token IDs found for these slugs." },
        { status: 404 },
      );
    }

    // 3) Batch-fetch orderbooks
    const books = await fetchClobBooks(tokenIds);
    const bookByToken = new Map<string, ClobBook>();
    for (const b of books) bookByToken.set(b.asset_id, b);

    // 4) Build response
    const response = {
      generatedAt: new Date().toISOString(),
      amountUsd: amount,
      depth,
      events: events.map((ev) => {
        const markets = (ev.markets ?? [])
          .filter((m) => m.enableOrderBook !== false)
          .map((m) => {
            const clobTokenIds = parsePossiblyJsonArray<string>(m.clobTokenIds);
            const [yesTokenId, noTokenId] = clobTokenIds;

            const yesBook = yesTokenId ? bookByToken.get(yesTokenId) : undefined;
            const noBook = noTokenId ? bookByToken.get(noTokenId) : undefined;

            const label =
              m.groupItemTitle ??
              // Sometimes "shortOutcomes" is useful in multi-market events
              parsePossiblyJsonArray<string>(m.shortOutcomes)[0] ??
              m.question ??
              m.slug ??
              "Unknown market";

            const yesBestAsk = yesBook?.asks?.[0]?.price ?? null;
            const yesBestBid = yesBook?.bids?.[0]?.price ?? null;

            const noBestAsk = noBook?.asks?.[0]?.price ?? null;
            const noBestBid = noBook?.bids?.[0]?.price ?? null;

            return {
              id: m.id ?? null,
              slug: m.slug ?? null,
              conditionId: m.conditionId ?? null,
              label,

              // Gamma “outcomes/outcomePrices” are often JSON strings :contentReference[oaicite:10]{index=10}
              outcomes: parsePossiblyJsonArray<string>(m.outcomes),
              outcomePrices: parsePossiblyJsonArray<string>(m.outcomePrices),

              tokens: {
                yes: yesTokenId ?? null,
                no: noTokenId ?? null,
              },

              yes: {
                bestAsk: yesBestAsk,
                bestAskCents: yesBestAsk ? Number(yesBestAsk) * 100 : null,
                bestBid: yesBestBid,
                bestBidCents: yesBestBid ? Number(yesBestBid) * 100 : null,
                estimateForAmount: yesBook ? estimateBuyFromAsks(yesBook.asks, amount) : null,
                orderbook: yesBook ? trimBook(yesBook, depth) : null,
              },

              no: {
                bestAsk: noBestAsk,
                bestAskCents: noBestAsk ? Number(noBestAsk) * 100 : null,
                bestBid: noBestBid,
                bestBidCents: noBestBid ? Number(noBestBid) * 100 : null,
                estimateForAmount: noBook ? estimateBuyFromAsks(noBook.asks, amount) : null,
                orderbook: noBook ? trimBook(noBook, depth) : null,
              },
            };
          });

        return {
          id: ev.id ?? null,
          slug: ev.slug ?? null,
          title: ev.title ?? null,
          markets,
        };
      }),
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        // You can tune caching if you want; "no-store" keeps it always live.
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
```

### Call it like:

* Default (all 3 events):
  `GET /api/polymarket/chicago-weather?amount=20&depth=25`

* Or explicitly:
  `GET /api/polymarket/chicago-weather?slugs=highest-temperature-in-chicago-on-june-13-2026&amount=20`

### Response shape (high level)

You’ll get per event → per outcome:

* Yes/No token IDs
* best bid/ask (and cents)
* top `depth` levels of the orderbook
* an **estimated average fill price** + **toWin** for the given `$amount`

That lets you generate text like:

> “June 14 — 40–41°F: hypothetically buying YES for $20 fills at ~34¢ avg → ~58.7 shares → to win ~$58.7”

(You’ll compute it from `estimateForAmount`.)

---

## If you want faster “live” updates: WebSocket

For UI that feels like Polymarket’s orderbook panel, use the public market-data WS and subscribe to `assets_ids` (token IDs): ([Polymarket Documentation][5])

* Endpoint: `wss://ws-subscriptions-clob.polymarket.com/ws/market` ([Polymarket Documentation][5])

In many apps, you:

* fetch initial state via REST (Gamma + /books),
* then keep it updated via WS “price_change” / “book” events.

---

## Notes that matter in practice

* **Don’t assume Gamma fields are arrays**: `clobTokenIds`, `outcomes`, `outcomePrices` may be JSON strings. The helper `parsePossiblyJsonArray()` handles both. ([Polymarket Documentation][1])
* **Use batch CLOB endpoints** (`POST /books`) to cut requests. ([Polymarket Documentation][4])
* **Read endpoints are public** (no keys required). ([Polymarket Documentation][1])
* **Yes token is index 0, No token is index 1** in `clobTokenIds`. ([Polymarket Documentation][7])

---

If you tell me whether you’re using the **App Router** (recommended) or **Pages Router**, I can also drop in the equivalent `pages/api/...` version and/or a tiny React hook (`useChicagoWeatherMarkets`) that calls this endpoint and renders the exact rows you screenshotted.

[1]: https://docs.polymarket.com/market-data/overview "Overview - Polymarket Documentation"
[2]: https://docs.polymarket.com/api-reference/events/get-event-by-slug "Get event by slug - Polymarket Documentation"
[3]: https://docs.polymarket.com/api-reference/market-data/get-order-book "Get order book - Polymarket Documentation"
[4]: https://docs.polymarket.com/api-reference/market-data/get-order-books-request-body "Get order books (request body) - Polymarket Documentation"
[5]: https://docs.polymarket.com/market-data/websocket/market-channel?utm_source=chatgpt.com "Market Channel"
[6]: https://docs.polymarket.com/trading/ctf/redeem?utm_source=chatgpt.com "Redeem Tokens"
[7]: https://docs.polymarket.com/quickstart "Quickstart - Polymarket Documentation"
