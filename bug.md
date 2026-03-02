This is almost certainly **not** a “Polymarket returned the same data” problem — it’s a **“we’re reading the wrong side of the book”** problem.

### What’s happening

Your API assumes:

* `asks[0]` = best ask (lowest sell price)
* `bids[0]` = best bid (highest buy price)

…but the CLOB API responses you’re getting are **not reliably ordered that way** (at least for these Chicago temp markets).

Example from the March 3 event, first outcome market (“31°F or below”):

* Gamma says that market’s **bestAsk** is `0.004` (0.4¢) ([gamma-api.polymarket.com][1])
* But the CLOB `/book` response for the first token shows `asks` starting at `0.999`, then `0.99`, `0.98`, … down to `0.004` at the end ([clob.polymarket.com][2])

So in that real response:

* **best ask is the *minimum* ask price (0.004)**, not `asks[0]` (0.999)
* and sometimes bids are also not in the expected order (I saw bids `[0.001, 0.002]` where best bid is the *max*, i.e. last) ([clob.polymarket.com][3])

This also breaks your fill estimator, because you’re “walking” asks in the wrong order (starting at 0.999), which makes many markets look identical.

Docs say asks are ascending and bids descending ([Polymarket Documentation][4]) — but in practice you should treat the arrays as **unsorted** and normalize them yourself.

---

## Fix: Normalize (sort) every book before using it

### 1) Add these helpers in your API route

```js
function normalizeLevels(levels, side) {
  const arr = Array.isArray(levels) ? [...levels] : [];

  // Filter out junk and sort by price.
  arr.sort((a, b) => {
    const pa = Number(a?.price);
    const pb = Number(b?.price);

    // Put invalid numbers last
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
```

### 2) Normalize once when building `bookByToken`

Replace:

```js
const books = await fetchClobBooks(tokenIds);
const bookByToken = new Map();
for (const book of books) {
  if (book?.asset_id) bookByToken.set(book.asset_id, book);
}
```

with:

```js
const books = await fetchClobBooks(tokenIds);
const bookByToken = new Map();
for (const raw of books) {
  if (!raw?.asset_id) continue;
  bookByToken.set(raw.asset_id, normalizeBook(raw));
}
```

### 3) Now your existing logic works correctly

Because after normalization:

* `asks[0]` really is best ask
* `bids[0]` really is best bid
* `estimateBuyFromAsks()` walks from cheapest upwards

Your current:

```js
const yesBestAsk = yesBook?.asks?.[0]?.price ?? null;
const yesBestBid = yesBook?.bids?.[0]?.price ?? null;
```

becomes correct (without changes), **as long as `yesBook` is normalized**.

### 4) Make sure trimming happens *after* sorting

Your current `trimBook()` just slices — that’s fine **if** the book was normalized first (as above).

---

## Quick sanity check to prove this is the bug

After deploying the change, pick a market you know should be ~34¢.

* Before: you’ll often see “Ask ~99.9¢” everywhere (because you were reading the *worst* ask at index 0).
* After: you should see realistic asks/bids matching Polymarket UI.

You can also temporarily log/debug a single market in your API:

```js
if (market.slug?.includes("40-41f")) {
  console.log("YES asks first/last", yesBook?.asks?.[0], yesBook?.asks?.at(-1));
  console.log("YES bids first/last", yesBook?.bids?.[0], yesBook?.bids?.at(-1));
}
```

If you see asks first = low price and bids first = high price, you’re good.

---

## Optional: Add a tiny debug display in your page

If you want to confirm visually without console logs, add a line in the table row:

```jsx
<div className="mt-1 text-[10px] text-black/50">
  YES token: {market?.tokens?.yes?.slice?.(0, 10)}…
</div>
```

That helps confirm you’re not accidentally reusing token IDs.

---

[1]: https://gamma-api.polymarket.com/events/slug/highest-temperature-in-chicago-on-march-3-2026 "gamma-api.polymarket.com"
[2]: https://clob.polymarket.com/book?token_id=40052649971904484806981081975593356734062815047773805472924997087554583696150 "clob.polymarket.com"
[3]: https://clob.polymarket.com/book?token_id=14015333605759216220093659773173972761106753636340931352842847862802739220190 "clob.polymarket.com"
[4]: https://docs.polymarket.com/api-reference/market-data/get-order-book "Get order book - Polymarket Documentation"
