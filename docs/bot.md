For **daily-high weather**, make the bot **rules-driven, not city-driven**. Your Paris example resolves to the **Charles de Gaulle Airport Station** from a specific **Wunderground daily page** and uses **whole degrees Celsius**; a Wellington market resolves to **Wellington Intl Airport Station** and also uses **whole °C**; a Chicago market resolves to **Chicago O’Hare Intl Airport Station** and uses **whole °F**. So the same bot can handle Paris, New Zealand, or anywhere else, as long as it reads the **exact station, unit, and source page from the market rules** each time instead of assuming “city weather.” ([Polymarket][1])

1. **Fetch the event by slug and read the bucket metadata.**
   Use the URL slug with `GET /events/slug/{slug}`. Polymarket’s event response includes a `markets` array, and each market has fields such as `description`, `resolutionSource`, `lowerBound`, `upperBound`, `clobTokenIds`, `orderPriceMinTickSize`, and `orderMinSize`. For daily-high markets, those `lowerBound` / `upperBound` fields are the safe way to define buckets; do not hardcode bucket widths from the label text. ([Polymarket Documentation][2])

2. **Parse only the binding rules block, not page summaries.**
   This matters a lot. On Wellington’s page, the binding rule says settlement comes from the Wunderground Wellington airport page, but the page also contains an **AI-generated summary** mentioning MetService and model commentary. For a bot, treat the explicit rule text / resolution source as authoritative and ignore the summary/FAQ prose. ([Polymarket][3])

3. **Forecast the exact station’s local-day maximum, then map it to buckets.**
   For the forecast side, use a global API that can give you **hourly temperatures for ensemble members** or at least hourly deterministic values. Open-Meteo’s Ensemble API returns **hourly forecasts for each ensemble member**, and its forecast and previous-runs docs support current and archived forecast retrieval, which is useful for backtests. For U.S. cities, the NWS API is also useful for forecast/observation cross-checks. Because Polymarket settles from a station-specific **daily** page for a named date, the quantity you want is the **station’s local-calendar-day Tmax**—that local-day interpretation is an inference from the settlement rule using the station’s Wunderground daily page for that date. ([Open Meteo][4])

4. **Trade off bucket edges, not just the modal outcome.**
   Compute a fair probability for every bucket, then compare that to the live book. Also, do **not** assume all daily-high markets use 1-degree buckets: Paris/Wellington show **single-degree Celsius** buckets with tails, while Chicago shows **two-degree Fahrenheit** buckets with tails. That is exactly why `lowerBound` / `upperBound` should drive the math. ([Polymarket][1])

A good daily-high architecture is:

* **Scanner:** pull slugs, fetch event, parse station/unit/Wunderground URL/bounds.
* **Valuer:** build a distribution for the station’s local-day Tmax and convert it into bucket probabilities.
* **Executor:** compare fair value to best ask/bid, place only when edge clears fees/slippage/risk buffer.
* **Resolver monitor:** watch the exact Wunderground daily page named in the rules; the pages explicitly say markets cannot resolve until the source is finalized, and later revisions after finalization are ignored. ([Polymarket][1])

Here is the **daily-high-specific core** I’d use in Python. It assumes you already fetched the event payload from `GET /events/slug/{slug}` and that your forecast layer has produced one local-day hourly temperature path per ensemble member, already converted into the source unit (`C` or `F`). The documented `clobTokenIds` ordering is Yes then No. ([Polymarket Documentation][2])

```python
import json
import re
from typing import Any, Dict, List, Optional

WU_RE = re.compile(r"https://www\.wunderground\.com/history/daily/\S+")

def parse_daily_high_market(market: Dict[str, Any]) -> Dict[str, Any]:
    text = market.get("description") or ""
    station_m = re.search(r"recorded at the (.*?) in degrees", text)
    station = station_m.group(1) if station_m else None

    unit = "C" if "degrees Celsius" in text else "F" if "degrees Fahrenheit" in text else None
    wu_m = WU_RE.search(text)
    wu_url = wu_m.group(0) if wu_m else None

    lower = market.get("lowerBound")
    upper = market.get("upperBound")
    lower = None if lower in (None, "") else int(float(lower))
    upper = None if upper in (None, "") else int(float(upper))

    yes_token, no_token = json.loads(market["clobTokenIds"])

    return {
        "question": market["question"],
        "station": station,
        "unit": unit,
        "wunderground_url": wu_url,
        "lower": lower,
        "upper": upper,
        "yes_token": yes_token,
        "no_token": no_token,
        "tick_size": float(market["orderPriceMinTickSize"]),
        "min_size": float(market.get("orderMinSize", 5)),
        "neg_risk": bool(market.get("negRisk", False)),
    }

def bucket_hit(obs_int: int, lower: Optional[int], upper: Optional[int]) -> bool:
    if lower is not None and obs_int < lower:
        return False
    if upper is not None and obs_int > upper:
        return False
    return True

def fair_yes_prob_from_members(
    member_hourly_paths: List[List[float]],
    lower: Optional[int],
    upper: Optional[int],
    quantize=round,  # first-pass approximation
) -> float:
    """
    member_hourly_paths:
      one list of hourly temperatures per ensemble member,
      already sliced to the contract's LOCAL calendar day
      and already converted to the source unit (C or F).
    """
    if not member_hourly_paths:
        return 0.0

    hits = 0
    for hourly in member_hourly_paths:
        tmax = max(hourly)
        source_obs = int(quantize(tmax))  # calibrate this empirically
        if bucket_hit(source_obs, lower, upper):
            hits += 1

    return hits / len(member_hourly_paths)

def fairs_for_event(event: Dict[str, Any], member_hourly_paths: List[List[float]]) -> List[Dict[str, Any]]:
    results = []
    for market in event["markets"]:
        m = parse_daily_high_market(market)
        p_yes = fair_yes_prob_from_members(member_hourly_paths, m["lower"], m["upper"])
        results.append({
            "question": m["question"],
            "station": m["station"],
            "unit": m["unit"],
            "lower": m["lower"],
            "upper": m["upper"],
            "yes_token": m["yes_token"],
            "no_token": m["no_token"],
            "fair_yes": p_yes,
            "fair_no": 1.0 - p_yes,
            "tick_size": m["tick_size"],
            "min_size": m["min_size"],
            "neg_risk": m["neg_risk"],
        })
    return results
```

The only part I would not hardcode is the `quantize=round` step. The rules say settlement uses **whole degrees** from the named Wunderground page, but the best mapping from a continuous forecast Tmax to the published Wunderground integer should be **calibrated empirically** with archived forecast runs and realized source outcomes. Start with nearest-integer rounding, then replace it with an empirical confusion matrix once you backtest. Open-Meteo’s archived/previous-run docs are useful for that backtest workflow. ([Polymarket][1])

For execution, I’d make three changes from a generic Polymarket bot:

First, **always geoblock-check before trading**. “Not in the USA” is not enough; Polymarket’s docs say orders from blocked regions are rejected, and the blocked-country list currently includes places like **France, Germany, the UK, Italy, Australia, and Belgium**. So a Paris weather market may exist even while a France-based trader is blocked from opening positions. ([Polymarket Documentation][5])

Second, **read the book directly instead of trusting `getPrice` side semantics**. Polymarket’s docs currently conflict: the API reference says `GET /price` returns best bid for `BUY` and best ask for `SELL`, while the orderbook guide says `getPrice("BUY")` is the best ask and `getPrice("SELL")` is the best bid. Because of that conflict, the safest bot logic is to use the full order book or WebSocket `best_bid_ask` and explicitly read `asks[0]` for buy cost and `bids[0]` for sell proceeds. ([Polymarket Documentation][6])

Third, **use the orderbook/WebSocket path for scale and correctness**. The orderbook docs expose batch requests across up to **500 tokens**, and the market WebSocket streams `book`, `price_change`, `last_trade_price`, `best_bid_ask`, and `tick_size_change`. That last event matters for weather tails because Polymarket notes that using an old tick size can get your orders rejected. For order placement, use the market’s live `tick_size` and `neg_risk` values; the auth and quickstart docs also spell out `signature_type` / `funder` requirements for EOA vs proxy wallets. ([Polymarket Documentation][7])

So the practical recipe is:

* **Do not special-case Paris vs New Zealand.**
  Special-case only the **rule format**: station, unit, local date, and bounds. ([Polymarket][1])
* **Forecast the exact station Tmax distribution.**
  Not the city center, not a generic country forecast. ([Polymarket][1])
* **Map forecast distribution to `lowerBound` / `upperBound`.**
  Not to the visible label text. ([Polymarket Documentation][2])
* **Use orderbook asks/bids, tick size, and neg-risk flags from live market data.** ([Polymarket Documentation][7])

Send one slug plus the weather API you want to use for forecasts, and I’ll turn this into a concrete Python order loop for that daily-high market family.

[1]: https://polymarket.com/event/highest-temperature-in-paris-on-march-24-2026 "Highest temperature in Paris on March 24? Trading Odds & Predictions (Mar. 24, 2026) | Polymarket"
[2]: https://docs.polymarket.com/api-reference/events/get-event-by-slug "Get event by slug - Polymarket Documentation"
[3]: https://polymarket.com/event/highest-temperature-in-wellington-on-march-18-2026 "Highest temperature in Wellington on March 18? Trading Odds & Predictions (Mar. 18, 2026) | Polymarket"
[4]: https://open-meteo.com/en/docs/ensemble-api "Ensemble API | Open-Meteo.com"
[5]: https://docs.polymarket.com/api-reference/geoblock "Geographic Restrictions - Polymarket Documentation"
[6]: https://docs.polymarket.com/api-reference/market-data/get-market-price "Get market price - Polymarket Documentation"
[7]: https://docs.polymarket.com/trading/orderbook "Orderbook - Polymarket Documentation"
