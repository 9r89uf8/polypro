# Polymarket Weather Bot — Implementation Plan

## Overview

An automated trading bot for Polymarket daily-high-temperature markets. Runs on a VPS in a non-blocked country (Mexico preferred). Uses Open-Meteo ensemble forecasts to build probability distributions, compares fair value against live orderbook prices, and places trades when edge exceeds a configurable threshold.

The bot is **rules-driven, not city-driven** — it parses each market's description to extract the station, unit, Wunderground URL, and bucket bounds, so the same code handles Paris (°C), Wellington (°C), Chicago (°F), or any future city.

## Deployment: VPS in Mexico

**Why a VPS, not Cloudflare Workers:**
- Workers run at the nearest edge PoC — you can't control the exit IP country
- Polymarket geoblocks by IP at order submission time
- A VPS gives a fixed, known Mexican IP for all outbound API calls

**Setup:**
- Provider: OVH Mexico City, or HostDime Latin America, or any VPS in a non-blocked country
- OS: Ubuntu 22.04+ minimal
- Runtime: Python 3.12+ (the bot.md reference code is Python, and py-clob-client is the official Polymarket SDK)
- Process manager: systemd unit or `supervisord` to keep the bot alive
- The VPS only runs the bot — no web serving, no database. It calls Polymarket APIs and Open-Meteo directly.

**Blocked countries to avoid (per Polymarket docs):**
USA, France, Germany, UK, Italy, Australia, Belgium, and others listed in their geoblock docs.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   VPS (Mexico)                       │
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐   │
│  │ Scanner  │───>│  Valuer  │───>│   Executor   │   │
│  │          │    │          │    │              │   │
│  │ Gamma API│    │ Open-    │    │ CLOB API    │   │
│  │ slug     │    │ Meteo    │    │ place order │   │
│  │ parsing  │    │ ensemble │    │ via SDK     │   │
│  └──────────┘    └──────────┘    └──────────────┘   │
│        │                                │            │
│        v                                v            │
│  ┌──────────────────────────────────────────────┐   │
│  │              Resolver Monitor                 │   │
│  │  Watch Wunderground daily page for settlement │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              Logging / Alerts                 │   │
│  │  JSON logs, Discord/Telegram webhook alerts   │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Component Details

### 1. Scanner

**Purpose:** Discover active weather markets, parse rules, extract trading parameters.

**Flow:**
1. Build candidate slugs by date pattern: `highest-temperature-in-{city}-on-{month}-{day}-{year}`
2. Cities to scan: configurable list (start with `paris`, `wellington`, `chicago`)
3. For each slug, `GET /events/slug/{slug}` via Gamma API
4. Parse each market's `description` to extract:
   - Station name (regex: `recorded at the (.*?) in degrees`)
   - Unit: `C` or `F` (from "degrees Celsius" / "degrees Fahrenheit")
   - Wunderground URL (regex: `https://www.wunderground.com/history/daily/\S+`)
5. Read `lowerBound` / `upperBound` from market fields (not from label text)
6. Read `clobTokenIds` (ordered: [yes, no]), `orderPriceMinTickSize`, `orderMinSize`, `negRisk`
7. Output: list of `ParsedMarket` objects ready for valuation

**Station-to-coordinates mapping:**
The bot needs lat/lon for Open-Meteo queries. Maintain a small config:
```python
STATIONS = {
    "Wellington International Airport Station": {"lat": -41.327, "lon": 174.805, "tz": "Pacific/Auckland"},
    "Charles de Gaulle Airport Station":        {"lat": 49.010, "lon": 2.548,   "tz": "Europe/Paris"},
    "O'Hare International Airport Station":     {"lat": 41.974, "lon": -87.907, "tz": "America/Chicago"},
}
```

### 2. Valuer

**Purpose:** Build a Tmax probability distribution and convert to per-bucket fair prices.

**Data source:** Open-Meteo Ensemble API (`https://ensemble-api.open-meteo.com/v1/ensemble`)
- Returns hourly temperatures for 50+ ensemble members (ECMWF IFS, GFS, ICON, etc.)
- Free, no API key needed, global coverage
- Supports `&models=icon_seamless,gfs_seamless,ecmwf_ifs04` for multi-model ensembles

**Flow:**
1. Fetch ensemble hourly forecasts for the station lat/lon and target date
2. For each ensemble member, extract the local-calendar-day hourly temps
3. Compute Tmax for each member → gives a sample of ~50-150 Tmax values
4. Convert each Tmax to the source unit (°C or °F)
5. Quantize to integer using `round()` (calibrate later via backtest)
6. For each bucket `[lowerBound, upperBound]`: fair_yes = count_in_bucket / total_members

**Edge detection:**
- For each bucket, compare `fair_yes` to `best_ask` (cost to buy YES)
- Edge = `fair_yes - best_ask`
- Only trade when edge > threshold (start with 5-8%, tune empirically)
- Also check: `fair_no` vs NO best_ask for selling (equivalent to bidding YES)

**Calibration (phase 2):**
- Use Open-Meteo's previous-runs endpoint to backtest archived forecasts against realized Wunderground outcomes
- Replace `round()` with an empirical confusion matrix for the quantization step
- Measure: does the Wunderground published integer match `round(actual_max)`, `floor()`, `ceil()`, or something else?

### 3. Executor

**Purpose:** Place orders on Polymarket when edge exceeds threshold.

**SDK:** `py-clob-client` (official Polymarket Python SDK)

**Flow:**
1. Connect with wallet private key and API credentials
2. For each market with sufficient edge:
   - Read live orderbook (use `GET /books` with token IDs, not `GET /price`)
   - Compute fill estimate at target amount
   - If avg fill price still gives edge > threshold after fees: submit limit order
3. Order parameters:
   - `token_id`: YES or NO token depending on direction
   - `price`: at or slightly above best ask (for buying)
   - `size`: configurable per-trade amount (start small: $5-20)
   - `tick_size`: from live market data (stale tick_size → rejected orders)
   - `neg_risk`: from market metadata
   - `signature_type`: depends on EOA vs proxy wallet

**Risk controls:**
- Max position per bucket (e.g., $50)
- Max total exposure per event (e.g., $200)
- Max daily loss limit
- Don't trade within 1 hour of market close (liquidity dries up, settlement risk)
- Log every order attempt, fill, and rejection

### 4. Resolver Monitor

**Purpose:** Watch for settlement and verify bot P&L.

**Flow:**
1. After market end time, poll the Wunderground daily page URL from the market rules
2. Extract the published daily high integer
3. Compare to the bucket the bot traded — was it a win or loss?
4. Log result; alert on unexpected outcomes

**Important:** Markets cannot resolve until the Wunderground source is "finalized." Later revisions after finalization are ignored. The monitor should check for the "finalized" state, not just any temperature display.

### 5. Logging & Alerts

- All decisions logged as structured JSON (forecast, fair values, edge, order, fill)
- Discord or Telegram webhook for: trades placed, fills, errors, daily P&L summary
- Persist logs locally on VPS + optionally push to a cloud store

## Leverage from Existing Codebase

The polypro2 codebase already has useful infrastructure:

1. **`app/api/polymarket/chicago-weather/route.js`** — working market data fetcher (Gamma API + CLOB orderbooks). The slug-building, book normalization, and fill estimation logic can be ported to Python.

2. **Observation data for backtesting** — Convex tables already store AWS/METAR observations for NZWN, LFPG, LEMD, KORD, LTAC, RKSI. The `nzwnDailySummaries` and similar tables give actual daily max temps that can be compared against Wunderground published values to calibrate the quantization step.

3. **Forecast accuracy analysis** — The new `getForecastAccuracy` query measures MetService forecast MAE by lead time. The same pattern can validate Open-Meteo ensemble accuracy before trusting it for trading.

4. **`docs/bot.md`** — Contains the reference Python code for market parsing and bucket probability computation.

## Run Loop

```
every 15 minutes:
  1. Scanner: discover active markets for today + next 2-3 days
  2. Valuer: fetch ensemble forecasts, compute fair values
  3. Executor: compare to live books, place orders where edge exists
  4. Log everything

every 1 hour:
  1. Resolver Monitor: check settled markets, compute P&L

on startup:
  1. Verify VPS IP is not in a blocked country (hit Polymarket geoblock endpoint)
  2. Verify wallet balance and API connectivity
  3. Load any existing positions from prior run
```

## Implementation Phases

### Phase 0: VPS Setup
- Provision VPS in Mexico (or other non-blocked country)
- Install Python 3.12+, pip, virtualenv
- Verify Polymarket API is accessible from the VPS IP
- Set up systemd service template

### Phase 1: Read-Only Scanner + Valuer
- Port slug builder and Gamma API fetch from existing `route.js`
- Implement market parser (from bot.md reference code)
- Integrate Open-Meteo ensemble API
- Output: "I would buy YES on bucket X at $0.08, fair value $0.15, edge 7%"
- No real trades — paper trading mode with logged decisions

### Phase 2: Executor (Live Trading)
- Integrate `py-clob-client` SDK
- Implement order placement with risk controls
- Start with minimum sizes ($5 per trade)
- Run for 1-2 weeks with small amounts

### Phase 3: Calibration & Backtest
- Fetch archived Open-Meteo forecasts for past dates
- Compare ensemble Tmax predictions to Wunderground published integers
- Build empirical quantization function to replace `round()`
- Measure: is the bot's edge real or a calibration artifact?

### Phase 4: Multi-City Scale
- Add more city slugs as Polymarket launches new weather markets
- Tune per-city parameters (some stations may have systematic biases)
- Monitor for Polymarket rule changes or new resolution sources

## File Structure (on VPS)

```
polymarket-weather-bot/
├── config.py              # station coords, API keys, risk limits
├── scanner.py             # slug builder, Gamma API, market parser
├── valuer.py              # Open-Meteo ensemble fetch, bucket probabilities
├── executor.py            # py-clob-client order placement
├── resolver.py            # Wunderground monitor, P&L tracking
├── main.py                # run loop orchestrator
├── backtest.py            # historical calibration tooling
├── requirements.txt       # py-clob-client, requests, etc.
└── logs/                  # structured JSON logs
```

## Open Questions

1. **Wunderground rounding behavior** — does the published integer use `round()`, `floor()`, or something else? Must be determined empirically before going live.
2. **Optimal edge threshold** — Polymarket charges ~2% fees. Start with 5% minimum edge, tune based on realized win rate.
3. **Multi-model weighting** — should we weight ECMWF members higher than GFS? Start equal, calibrate with backtest data.
4. **Position management** — should the bot actively manage positions (sell if edge reverses), or just hold to settlement? Start with hold-to-settlement for simplicity.
