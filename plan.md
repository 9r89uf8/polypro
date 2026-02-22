Below is a “hand to a coding agent” implementation plan that does **NOT** crawl Wunderground and does **NOT** use cron jobs. The user will **paste daily max temps manually** for a month, and the app will **fetch historical METAR/SPECI** for that month on-demand, compute **daily max + timestamp**, then compare.

One important note up front: the NOAA `KORD.TXT` URL you linked is **only the latest METAR**, not an archive. NOAA’s own help describes it as “latest … METAR report.” ([Weather.gov][1])
So for “all METAR for Feb 1” you need an archive source. The most practical is IEM’s public METAR archive service (`asos.py`). ([Iowa Environmental Mesonet][2])

---

## What “no API” will mean here

* **No Weather.com/Wunderground API** (and no scraping WU).
* **No API keys**.
* **No scheduled jobs** (everything is user-triggered).
* The app will still make a **single HTTP download** of public METAR history from IEM when the user clicks **Compute**. If you truly mean “no external HTTP calls at all,” see the “Zero external calls mode” at the end.

IEM provides a scriptable CSV download endpoint for METAR/ASOS data and documents rate limiting and report types. ([Iowa Environmental Mesonet][2])

---

## Goal / Output

For each day in a chosen month:

* `manualMax` (what user pasted)
* `metarMax` (computed from all METAR/SPECI/HFMETAR in that day)
* `metarMaxTimestamp` (local + UTC)
* `metarObsCount` (how many reports were evaluated)
* `delta = manualMax - metarMax`
* Show a table + optional drilldown.

---

## Data source for METAR archive (recommended)

Use IEM `asos.py`:

* Station: **ORD** (IEM’s IL_ASOS identifier for Chicago O’Hare) ([Iowa Environmental Mesonet][3])
* Request report types: `1,3,4` where:

    * `1` = HFMETAR
    * `3` = Routine
    * `4` = Specials ([Iowa Environmental Mesonet][2])
* Request output as CSV (`format=onlycomma`) and include `metar` (raw) so you can parse temps precisely. ([Iowa Environmental Mesonet][2])
* Implement retry/backoff because IEM explicitly notes IP-based rate limits and possible 503s. ([Iowa Environmental Mesonet][2])

---

# Step-by-step implementation plan

## 1) Create the Next.js + Tailwind + Convex project

1. Create Next.js app **without TypeScript**.
2. Install TailwindCSS and verify a styled page renders.
3. Install Convex and run `npx convex dev` once so the backend folder + generated API exist.

**Acceptance check**

* You can load `/` and see Tailwind styling.
* Convex dashboard shows your deployment running.

---

## 2) Decide the month “unit” and timezone rules (make this explicit in code)

**Timezone rule (critical):**
Compare by **America/Chicago local date** (that’s what WU “daily” typically reflects for the station day). You must convert METAR timestamps (UTC “Z” time) into Chicago dates before grouping.

**Unit rule:**
Support manual paste in **either C or F**. Internally store **both** C and F for manual + metar so UI can toggle.

**Acceptance check**

* A METAR at `00:30Z` correctly falls on the prior local date in Chicago when appropriate.
* Manual input can be pasted as C or F.

---

## 3) Convex schema (two tables, clean and scalable)

You want a “pro” data model that’s easy to query and won’t hit document size limits. Convex values must be under **1MB**, so don’t store an entire month’s raw METAR in a single document. ([Convex Developer Hub][4])

### Table A: `monthRuns`

One row per station+month. Tracks status and “last computed”.

Fields:

* `stationIcao`: `"KORD"` (UI name)
* `stationIem`: `"ORD"` (archive name)
* `year`: number
* `month`: number (1–12)
* `manualUnit`: `"C"` or `"F"` (what user pasted)
* `createdAt`, `updatedAt`
* `metarLastComputedAt` (ms epoch)
* `metarLastStatus`: `"idle" | "computing" | "ok" | "error"`
* `metarLastError`: string (optional)

Indexes:

* unique-ish index on `(stationIcao, year, month)`

### Table B: `dailyComparisons`

One row per station+date.

Fields:

* Keys:

    * `stationIcao`: `"KORD"`
    * `date`: `"YYYY-MM-DD"` in **America/Chicago**
* Manual fields:

    * `manualMaxC`, `manualMaxF`
    * `manualNotes` (optional)
* METAR computed fields:

    * `metarMaxC`, `metarMaxF`
    * `metarMaxAtUtc` (ISO string or epoch ms)
    * `metarMaxAtLocal` (string like `"YYYY-MM-DD HH:mm"`)
    * `metarObsCount`
    * `metarMaxRaw` (raw METAR line for the max)
    * `metarMaxSource` (e.g. `"remark_T" | "metar_integer" | "tmpf"`)
* Compare fields:

    * `deltaC`, `deltaF`
* `updatedAt`

Indexes:

* `(stationIcao, date)` for lookup
* `(stationIcao, date)` range queries for month pages

**Acceptance check**

* You can fetch all rows for a month by date range query.
* You can update manual and metar fields independently.

---

## 4) Convex functions you need (JS, not TS)

Convex has three relevant function types:

* **Queries**: read data
* **Mutations**: write data transactionally
* **Actions**: do external fetch / long work, then call mutations ([Convex Developer Hub][5])

### 4.1 Query: `getMonthComparison(stationIcao, year, month)`

* Returns all `dailyComparisons` for that month, sorted by date.

### 4.2 Mutation: `upsertManualMonth(stationIcao, year, month, unit, values[])`

Input format for `values[]`:

* either `{ day: 1..31, value: number }`
* or `{ date: "YYYY-MM-DD", value: number }`

Mutation responsibilities:

1. Upsert the `monthRuns` record.
2. For each day value:

    * Convert into both C and F.
    * Upsert `dailyComparisons` row for that date.
3. Do **not** touch any METAR fields.

### 4.3 Action: `computeMetarMonth(stationIcao, year, month)`

Action responsibilities:

1. Mark `monthRuns.metarLastStatus = "computing"`.
2. Fetch METAR history from IEM in **one request** for the month (details below). ([Iowa Environmental Mesonet][2])
3. Parse rows, group by Chicago local date, compute:

    * daily max temperature
    * timestamp of the max
    * raw METAR that produced the max
    * obs count
4. Call an internal mutation like `upsertMetarMonthResults(rows[])` to:

    * upsert/push METAR results into `dailyComparisons`
    * compute deltas vs manual if manual exists
5. Update `monthRuns` status to `"ok"` and set `metarLastComputedAt`.
6. If fetch fails (503/rate limit), do retry/backoff; if still fails set `"error"`.

**Acceptance check**

* Clicking Compute fills in METAR max+time for each day in the month.

---

## 5) Build the IEM request (single fetch for the whole month)

### Station mapping

* UI station: `"KORD"`
* IEM station: `"ORD"` (IL_ASOS station table lists Chicago OHare as `ORD`) ([Iowa Environmental Mesonet][3])

### Request endpoint

`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py` ([Iowa Environmental Mesonet][2])

### Recommended query params

* `station=ORD`
* `sts=YYYY-MM-01T00:00:00Z`
* `ets=YYYY-(MM+1)-01T00:00:00Z`
* `report_type=1,3,4` (HFMETAR + Routine + Specials) ([Iowa Environmental Mesonet][2])
* `data=metar` (raw line; enough to parse temps) ([Iowa Environmental Mesonet][2])
* (optional) `data=tmpf` (lets you fall back to parsed temp if needed) ([Iowa Environmental Mesonet][2])
* `format=onlycomma` ([Iowa Environmental Mesonet][2])
* `tz=UTC` (docs strongly recommend explicitly setting tz; you’ll convert to Chicago yourself) ([Iowa Environmental Mesonet][2])

### Retry/backoff

IEM states it has an IP-based rate limit and can return 503 under load. ([Iowa Environmental Mesonet][2])
Implement:

* try up to 3 times
* backoff: 1s → 3s → 10s
* if final fail: store the error in `monthRuns`

---

## 6) Parsing temperatures from METAR (the “pro” part)

You want the **highest temperature reported** in the METAR stream.

### Temperature extraction order (best → fallback)

1. **Remark “T” group** (tenths of °C) when present
   Many ASOS stations include a `TsnTTTsdDDD` group (e.g., `T10391111`). This gives **temperature in tenths of °C**.

* Regex: `\bT([01])(\d{3})([01])(\d{3})\b`
* tempTenths = sign*(TTT/10)

2. If no remark-T, parse the main temp/dew group: `M05/M12` or `02/00`

* Regex: `\b(M?\d{2})/(M?\d{2}|//)\b`
* integer °C

3. If both missing, fallback to `tmpf` (if requested from IEM) and convert to °C.

### Timestamp parsing

IEM CSV includes a `valid` column (timestamp). The service has a `tz` parameter controlling timestamps. ([Iowa Environmental Mesonet][2])
You set `tz=UTC`, so parse `valid` as UTC (append `Z` if needed).

### Grouping into “Chicago day”

For each observation timestamp:

* Convert UTC → America/Chicago date key using `Intl.DateTimeFormat` with `timeZone: "America/Chicago"`.
* That date key is what you store in `dailyComparisons.date`.

### Keep these per-day aggregates

* `maxTempC` (float, could be tenth precision)
* `maxAtUtc` (epoch ms or ISO)
* `maxAtLocal` (formatted)
* `maxRawMetar` (string)
* `obsCount`

**Acceptance check**

* For a day with SPECI reports, your obsCount is higher than 24 and you still compute correctly.

---

## 7) UI flow (Next.js pages/components)

### Page: `/kord/month`

(You can generalize later; start with KORD hardcoded)

**Sections**

1. Month selector

* Year dropdown
* Month dropdown
* “Load” button

2. Manual paste box

* Unit toggle: C / F
* Textarea (one value per line; line1=day1)
* “Preview parse” box that shows:

    * day number
    * parsed value
    * any errors (blank lines, non-numeric)
* Button: **Save Manual Max**

3. METAR compute box

* Button: **Compute METAR Daily Max**
* Show status from `monthRuns.metarLastStatus`
* If error, show `metarLastError`

4. Comparison table
   Columns:

* Date
* Manual Max (C/F)
* METAR Max (C/F)
* METAR time (local)
* Obs count
* Delta (Manual − METAR)

Add conditional styling:

* Delta 0: neutral/green
* |Delta| ≤ 1: yellow
* |Delta| > 1: red

### Optional drilldown: `/kord/day/YYYY-MM-DD`

Shows:

* Manual max
* METAR max + time + raw
* “Top 5 temps” list (if you store it)

---

## 8) Storage strategy for “all METAR data” (without blowing up Convex)

You have two options:

### Option A (recommended): Don’t store every METAR row

Store only daily aggregates + the max raw METAR line. This is the simplest and fits easily.

### Option B (debug/pro): Store observations, but as many small documents

Add a third table `metarObservations`:

* `stationIcao`
* `tsUtc` (epoch ms)
* `dateLocal` (YYYY-MM-DD)
* `tempC`
* `rawMetar`
  Index on `(stationIcao, dateLocal)`.

This avoids hitting the **1MB value limit** by spreading observations across documents. ([Convex Developer Hub][4])

If you don’t need full drilldown, skip this.

---

## 9) Edge cases your agent must handle

1. **Missing temp in a METAR**
   Skip the row and continue.

2. **Duplicate timestamps** (possible when mixing report types)
   Keep the higher temp; if equal, prefer the one with remark-T precision.

3. **Month boundaries in UTC vs local**
   A report near midnight UTC may belong to previous local day. Your “Chicago date key” conversion handles this.

4. **DST transition days**
   Using `Intl.DateTimeFormat` with `"America/Chicago"` will handle DST shifts correctly for date grouping.

5. **Manual data missing days**

* Show status “manual missing” for that date; still compute METAR.

---

## 10) Testing checklist (what “done” means)

### Unit tests (JS)

* METAR integer parsing:

    * `M05/M12` → -5
    * `00/M01` → 0
* Remark-T parsing:

    * `T10391111` → -3.9°C (example sign decode)
* Date key conversion:

    * A UTC time that should map to previous local day in Chicago

### Integration “smoke test”

* Pick a known month, run Compute, confirm:

    * You get ~700–1500 obs for a month (depends on specials)
    * You get a METAR max for most days

---

---

## Why this plan is “PRO”

* On-demand only (no cron).
* No WU crawling / no paid keys.
* Uses a proper archive endpoint with documented report types and timestamps. ([Iowa Environmental Mesonet][2])
* Correct timezone grouping for daily comparisons.
* Robust parsing (tenths precision when available).
* Convex best-practice separation: external fetch in **actions**, writes in **mutations**. ([Convex Developer Hub][5])

[1]: https://www.weather.gov/tg/datahelp?utm_source=chatgpt.com "Help Guide"
[2]: https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?help= "Iowa Environmental Mesonet"
[3]: https://mesonet.agron.iastate.edu/sites/networks.php?network=IL_ASOS&station=ORD&utm_source=chatgpt.com "IEM :: Network Station Tables - Iowa Environmental Mesonet"
[4]: https://docs.convex.dev/database/types?utm_source=chatgpt.com "Data Types | Convex Developer Hub"
[5]: https://docs.convex.dev/functions?utm_source=chatgpt.com "Functions | Convex Developer Hub"
