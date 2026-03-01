

### Current baseline (already implemented)

- METAR data collection is already in place.
- Official high temperature persistence is already in place.
- `finalizeDay` already stores the highest recorded value, so this should not be reimplemented.


Below is a full “no-code” plan that folds your **NOAA METAR daily high truth** into the AccuWeather-based forecast display + suburb cross-check + map UI you described.

I’m going to treat **KORD / O’Hare** as the *verification source* (truth) and AccuWeather as the *forecast source* for all five locations.

---

## 0) What you’re building (clear definitions)

### Primary user-facing output (forecast display)

For each location (O’Hare + 4 suburbs), you want a **3‑day forecast by day**:

* **Forecasted High (°F)** (headline number)
* **Peak time window** (when it hits/holds the max)
* **Peak duration** (how long it stays at/near the max)

This is best built from:

* AccuWeather **Daily forecast** for the high value (`Temperature.Maximum`) ([AccuWeather Developer][1])
* AccuWeather **Hourly forecast** for the peak timing window (`DateTime` + `Temperature`) ([AccuWeather Developer][2])

### Verification / accuracy output (analysis)

For O’Hare only (KORD), you already store:

* `metarAllMaxF` (decimal)
* `metarMaxAtUTC` (UTC time of max)

You want to compare:

* **Observed daily high (NOAA METAR)** vs **Forecasted daily high (AccuWeather)**

Your METAR source file format supports this: it includes a UTC timestamp and the METAR string, e.g. `2026/03/01 02:51 ... KORD 010251Z ...` ([National Weather Service FTP][3])

---

## 1) Data sources & endpoints you’ll use

### AccuWeather (forecast source)

You’ll use 3 categories of API calls:

1. **Daily forecasts** (for the “High” you display)

* `/forecasts/v1/daily/5day/{locationKey}` (you’ll display only the next 3 days) ([AccuWeather Developer][1])
  The response includes `DailyForecasts[].Date` and `Temperature.Maximum.Value`. ([AccuWeather Developer][1])

2. **Hourly forecasts** (for peak time + duration)

* `/forecasts/v1/hourly/72hour/{locationKey}` or `/120hour/` ([AccuWeather Developer][4])
  Each hourly record includes `DateTime` and a `Temperature` object. ([AccuWeather Developer][2])

**Which one should you pick?**

* If you truly want “3 calendar days” (today, tomorrow, next day) with full coverage even early in the day, **120-hour** is the safest.
* If you’re okay with occasionally missing late hours on “day 3” depending on the current time, **72-hour** can work.

3. **Location details** (for the map + timezone correctness)

* `/locations/v1/{locationKey}` returns `GeoPosition` (lat/long) and `TimeZone` metadata. ([AccuWeather Developer][5])
  This is how you place markers in their **true positions** and handle local time display reliably.

> Important nuance: AccuWeather forecast temperatures are *rounded* in their schema descriptions (“forecasted temperature with a rounded value…”). ([AccuWeather Developer][2])
> So you’ll want to treat METAR decimals as truth, but comparisons should include “rounded truth” too (more on that below).

---

### NOAA METAR (truth source)

You already have ingestion and storage; the only integration step is: **join your METAR daily max record to the AccuWeather forecast summaries for the same local day**.

Your KORD file format provides a timestamp + METAR in one line (at least via tgftp right now). ([National Weather Service FTP][3])

---

## 2) Refresh strategy (20 minutes, all five locations)

You said: “refresh all five locations together every ~20 minutes.”

You can keep that cadence, but make it robust and API-friendly by adding two small concepts:

### A) “20 minutes” as a scheduler tick, not necessarily “always hit AccuWeather”

AccuWeather explicitly recommends using the **`Expires`** response header to decide when to refresh cached data. ([AccuWeather Developer][6])

So the plan is:

* **Every 20 minutes** your job runs
* For each endpoint+location you check:

    * If cached data is still valid (now < `Expires`), you *can* skip the call and reuse cached content
    * If expired (or within a small “refresh soon” window), you fetch again

This keeps your UI updating smoothly while preventing unnecessary calls.

### B) Add jitter so you don’t hammer on exact :00/:20/:40

AccuWeather’s best practices recommend randomizing refresh rates to avoid synchronized load spikes. ([AccuWeather Developer][6])
Even though you’re not “many devices,” it’s still smart to jitter your refresh start time by ±30–90 seconds.

### C) Keep the five locations “together,” but stagger by a few seconds

You can still treat the refresh as a single batch (“all locations refreshed as one group”), but execute calls in a slight stagger (or concurrency-limited parallel) so one transient failure doesn’t block the whole batch.

---

## 3) Data model changes to integrate METAR truth + AccuWeather forecast

You already have `dailyComparisons` with METAR fields for O’Hare.

To integrate your new goals cleanly, think in **three layers**:

### Layer 1 — Static location configuration

A simple config table/object like:

* `locationKey`
* `displayName`
* `isMain` (true only for O’Hare)
* `mapPriority / label`
* `manualCompassHint` (optional: “left”, “right”… for UX)
* `geo` (lat/long pulled from `/locations/v1/{locationKey}`) ([AccuWeather Developer][5])

Even if you “know” Rosemont is right, etc., using true lat/long makes the map always correct.

---

### Layer 2 — Raw forecast snapshots (“what did AccuWeather say at time T?”)

Create a table for **forecast snapshots**, keyed by:

* `snapshotAtUTC` (when you fetched)
* `provider = AccuWeather`
* `locationKey`
* `endpointType` (daily5day, hourly120hour)
* `responseHeaders.Date` and `responseHeaders.Expires` (so you can reason about freshness) ([AccuWeather Developer][6])
* optionally: `payloadHash` (to detect “no-change” updates)

This snapshot history is what lets you answer:

* “Did AccuWeather change its forecast high today?”
* “How often does it change?”
* “How does accuracy vary with lead time?”

---

### Layer 3 — Derived daily summaries (“what does the UI need?”)

From each snapshot, compute a **per-location per-day summary** for the next 3 days:

For each (locationKey, localDate):

**Daily headline**

* `accuHighF` = Daily forecast `Temperature.Maximum.Value` ([AccuWeather Developer][1])
* (optional) `accuLowF` = Daily `Temperature.Minimum.Value` ([AccuWeather Developer][1])

**Peak timing**

* `peakStartLocal`
* `peakEndLocal`
* `peakDurationMinutes`
* `peakMethod` = “near-peak window from hourly”

This “derived summary” is what your UI reads fast, without reprocessing hourly arrays on every page load.

---

## 4) Computing “peak time and for how long” (hourly → daily peak window)

You’ll compute this from hourly `DateTime` and `Temperature` values. ([AccuWeather Developer][2])

Because AccuWeather temps are rounded in the schema descriptions, expect plateaus/ties. ([AccuWeather Developer][2])
So define your peak window like this:

### Step 1: Determine the target “high”

Use **Daily** as the target high:

* `targetHigh = daily Temperature.Maximum.Value` ([AccuWeather Developer][1])

### Step 2: Pick a “near-peak” threshold

A stable default:

* “near peak” if hourlyTemp ≥ targetHigh − 1°F

(You can tighten to 0°F later if you want a very strict definition.)

### Step 3: Find the contiguous window

Within that local calendar day:

* Find all hours that qualify as near-peak
* Compute the **longest contiguous run**
* That becomes `(peakStart, peakEnd, duration)`

This gives nice UX outputs like:

* “High 34°F — peaks **2–4 PM**, holds near-peak **1–5 PM**”

### Step 4: Timezone/day-bucketing correctness

Use the ISO8601 offsets in the forecast timestamps and bucket by **local date**, not UTC. ([AccuWeather Developer][2])

And if you use AccuWeather location timezone data (GMTOffset), be mindful of DST changes / `NextOffsetChange`. ([AccuWeather Developer][6])

---

## 5) Integrating NOAA truth into the plan (your core accuracy goal)

You already store truth for O’Hare in `dailyComparisons`:

* `metarAllMaxF` (decimal)
* `metarMaxAtUTC`

Now add **forecast comparison fields** that are derived from your AccuWeather daily summaries.

### A) What you store in `dailyComparisons` for AccuWeather (O’Hare only)

For each local day D (for the main location):

**Observed (truth)**

* already: `metarAllMaxF`, `metarMaxAtUTC`

**Forecast (AccuWeather)**

* `accuHighF_latest` (the most recent forecast high you had for day D before day ended)
* `accuPeakWindow_latest` (start/end/duration, local)
* `accuSnapshotAtUTC_latest` (so you can audit the forecast “as-of” time)

**Errors**
Because METAR has decimals and AccuWeather is rounded, store two error flavors:

1. **Raw error**

* `errRawF = accuHighF_latest - metarAllMaxF`

2. **Rounded truth error** (recommended headline accuracy metric)

* `errRoundedF = accuHighF_latest - round(metarAllMaxF)`

This avoids penalizing AccuWeather for not forecasting tenths.

**Peak timing validation (optional but valuable)**

* Convert `metarMaxAtUTC` → local time
* Check if it falls within the forecast peak window
* Store:

    * `peakHit = true/false`
    * `peakTimingDeltaMinutes` (if outside window, how far)

### B) Add lead-time accuracy (this is where your 20-min snapshots become powerful)

If you only compare “latest forecast” vs truth, you miss a lot of insight.

Since you refresh every 20 minutes anyway, you can compute accuracy as a function of lead time:

For each day D, pick a few standard “as-of” times:

* End of previous day (e.g., 11:30 PM local)
* Morning (e.g., 7:00 AM local)
* Midday (e.g., 12:00 PM local)

Then store:

* `accuHighF_asof_0730`
* `accuHighF_asof_1200`
* etc.

This answers questions like:

* “Is AccuWeather good 48 hours out but drifts on the day-of?”
* “Does it consistently under/overpredict in certain patterns?”

You don’t need new data collection—just query the snapshot history.

---

## 6) Using suburbs as a “forecast stability / change detection” system

Your intuition is solid: if O’Hare is centered and suburbs surround it, spatial consistency can highlight when O’Hare’s forecast might be “about to move.”

### A) Spatial spread metrics (per day)

For each day and snapshot:

* `spreadHighF = max(highsAcross5) - min(highsAcross5)`
* `ohareDeltaFromMean = ohareHigh - mean(suburbHighs)`

Trigger UI flags like:

* **“Forecast disagreement high”** if spreadHighF ≥ 4°F
* **“O’Hare outlier”** if O’Hare is outside the suburb min/max band

### B) Hourly divergence (optional, for “about to change” detection)

For the next ~12 hours:

* compare O’Hare hourly temp to the suburb average hourly temp
* track if O’Hare is becoming an outlier

This can drive a subtle indicator:

* “O’Hare forecast diverging from nearby locations”

---

## 7) UI plan (3-day forecast + clickable map + day toggles)

### A) Top-level layout

A practical dashboard layout:

1. **Day selector**: buttons/tabs: “1 day / 2 days / 3 days”
2. **Map** with the 5 markers
3. **Side panel table** listing all locations + selected day’s values
4. **Detail drawer** when clicking a marker (hourly strip + peak window)

### B) Map: “true positions” + center O’Hare

Use `/locations/v1/{locationKey}` GeoPosition (lat/long) to place markers accurately. ([AccuWeather Developer][5])
That will naturally yield the relationship you described (Rosemont right-ish, Elk Grove left-ish, etc.), but correctly.

Each marker displays (for the selected day index):

* Location name
* Forecast high (AccuWeather)
* Peak time range (short form like “2–4 PM”)

For O’Hare marker only, add a second line when available:

* **Observed high so far today** (METAR max so far)
* Or “Yesterday observed high: …” for completed days

### C) Day toggle behavior (key UX requirement you stated)

When the user clicks:

* “1 day” → show only today
* “2 days” → show today + tomorrow in the side panel; markers show today by default but allow toggling
* “3 days” → show a compact 3-row mini-table in each marker tooltip/popover, or keep marker as “today” and show the 3 days in the side panel

**Best pattern:**

* Keep the markers showing *one selected day at a time* (less clutter)
* The day selector changes that single selected day (Day 1/2/3)
* The side panel always lists all locations for that selected day

### D) Clicking a marker (detail view)

For the chosen location and chosen day, show:

* Forecast high / low
* Peak window + duration
* Optional “hourly sparkline” (24-hour temp line)
* For O’Hare: NOAA comparison card

    * Observed high (metarAllMaxF)
    * Forecast high (accuHighF_latest or “as-of now”)
    * Error (rounded + raw)
    * METAR max time vs forecast peak window

---

## 8) Operational details & guardrails

### A) Units

Set AccuWeather calls to imperial (`metric=false`) so your UI stays in °F. ([AccuWeather Developer][4])

### B) Handling “forecast made time”

AccuWeather doesn’t provide a clean “issued at” in the JSON for hourly/daily; instead:

* store your fetch time
* store `Date` and `Expires` headers to reason about freshness (also helps caching) ([AccuWeather Developer][6])

### C) Data retention

Hourly payloads can get large if you store every snapshot forever.

A good retention approach:

* Keep raw hourly snapshots for ~7–14 days (enough to debug/change-detect)
* Keep derived daily summaries + daily comparisons indefinitely (these are small and power your analytics)

### D) Rate limiting & failures

Plan for:

* transient failures (retry/backoff)
* 429 responses (respect retry-after if provided; otherwise slow down)
* partial refresh (don’t block the UI if one suburb fails—show last-known-good with a “stale” indicator)

---

## 9) What your final system can answer (the “end state”)

Once integrated, you’ll be able to:

1. Display a 3‑day forecast for:

* O’Hare (5595_poi)
* Schiller Park (338056)
* Rosemont (2256000)
* Bensenville (2256415)
* Elk Grove Village (332838)

2. For each location/day, show:

* forecast high
* peak time window + duration

3. For O’Hare, verify daily:

* observed METAR high (decimal) and time (UTC/local)
* AccuWeather forecast high (and its peak window)
* forecast error (raw + rounded)
* forecast drift across the day (since you snapshot every 20 minutes)

4. Use suburbs as a confidence/stability overlay:

* detect O’Hare outliers
* highlight disagreement zones spatially on the map

---

If you want one “decision” baked in (so you don’t have to revisit it later): I’d implement **120-hour hourly** for all five locations so “3-day by calendar day” peak windows are always computable, then cap storage by keeping only derived daily summaries long-term and raw hourly snapshots short-term. ([AccuWeather Developer][4])

[1]: https://developer.accuweather.com/core-weather/location-key-daily "Location Key - Core Weather | AccuWeather Developer"
[2]: https://developer.accuweather.com/core-weather/~schemas "Schemas  | AccuWeather Developer"
[3]: https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT "tgftp.nws.noaa.gov"
[4]: https://developer.accuweather.com/core-weather/location-key-hourly "Location Key - Core Weather | AccuWeather Developer"
[5]: https://developer.accuweather.com/core-weather/location-key-locations "Location Key - Core Weather | AccuWeather Developer"
[6]: https://developer.accuweather.com/documentation/best-practices "Best practices | AccuWeather Developer"
