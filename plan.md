You’re already *very* close to what you described. Your current model (`highPredictions` snapshots + `finalizeDay` to attach the actual high + error + lead-hours) is the right backbone.

The big “gotcha” (and it matters a lot for **leadDays = 0 / same‑day**) is this:

### The 72h hourly endpoint only contains *future hours*

So once the real high has already happened, the “daily max” you compute from the remaining hourly forecast is no longer the day’s high — it becomes **“max of the remaining hours”**.

That’s exactly why your original plan says “stop collecting once the highest temperature is reached.” If you don’t stop (or at least filter), then any “lock-in” or “stays-accurate” metric will look worse than it should, because you’re no longer measuring the same thing after the high passes.

Your code *already* has the ingredients to fix this cleanly, without changing your collector cadence.

---

## What you should measure (definitions that won’t bite you later)

For each **snapshot hour** (when you fetch the AccuWeather hourly forecast):

* **Target date**: `targetDateISO` (e.g. `2026-02-26`)
* **Prediction**:

    * `predictedHighF`: max temp found among forecast hours that fall on `targetDateISO`
    * `predictedHighTimeEpochMs`: time of that max
* **Truth**:

    * `actualHighF`, `actualHighTimeEpochMs` (computed after the day ends)
* **Lead time**:

    * `leadHoursToActualHigh`: hours from snapshot → the actual high time
      (you already compute this in `finalizeDay`)

Then the two most useful accuracy views are:

1. **Accuracy at a given lead hour** (your `accuracyByLeadHour` already does this)

    * “When the high was 12 hours away, how often was the predicted high within ±1°F?”
2. **Earliest time it becomes accurate / lock-in time**

    * “How many hours before the high did it first become within ±1°F?”
    * “How many hours before the high did it lock in and never leave ±1°F again (up to the high)?”

The crucial add-on is: for same-day, “up to the high” must literally mean **stop evaluating after the high occurs**.

---

## The main fix: treat “after the high” as out-of-scope for same‑day

You already compute:

```js
leadHoursToActualHigh = Math.floor((actualHighTimeEpochMs - p.fetchedHourBucketMs) / 3600000)
```

So any snapshot taken after the actual high will have:

* `leadHoursToActualHigh < 0`

### Rule

For *same-day* evaluation (and honestly it’s safe for all leadDays), only include snapshots where:

* `leadHoursToActualHigh >= 0`

Your `accuracyByLeadHour` query already does this filtering:

```js
if (lh < 0 || lh > args.maxLeadHours) continue;
```

But your **daily “lock-in” / summary** logic currently does **not** stop at the high — it tries to reason across the whole day’s snapshots (0..23), which will break for leadDays=0.

### Patch your `summarizeDay` so lock-in only considers snapshots before the actual high

Below is a drop-in style change (keep your overall structure, but compute `lastRelevantHour` and only evaluate up to that).

#### Replace the top of `summarizeDay` with a “relevant predictions” filter

```js
function summarizeDay(predsForDay, toleranceF) {
  // Extract actual high fields if already finalized
  let actualHighF = null;
  let actualHighTimeEpochMs = null;

  for (const p of predsForDay) {
    if (typeof p.actualHighF === "number") actualHighF = p.actualHighF;
    if (typeof p.actualHighTimeEpochMs === "number") actualHighTimeEpochMs = p.actualHighTimeEpochMs;
  }

  // Only consider snapshots taken BEFORE (or at) the actual high time.
  // For leadDays=1/2/3 this won't remove anything; for leadDays=0 it fixes the “remaining max” issue.
  const relevant =
    typeof actualHighTimeEpochMs === "number"
      ? predsForDay.filter((p) => (p.fetchedHourBucketMs ?? p.fetchedAtMs) <= actualHighTimeEpochMs)
      : predsForDay;

  // Map by fetched hour for the “snapshot day”
  const byHour = Array(24).fill(null);

  let predMin = null;
  let predMax = null;

  let lastRelevantHour = null;

  for (const p of relevant) {
    const h = p.fetchedLocalHour;
    if (h >= 0 && h <= 23) {
      byHour[h] = p;
      lastRelevantHour = lastRelevantHour === null ? h : Math.max(lastRelevantHour, h);
    }

    if (typeof p.predictedHighF === "number") {
      predMin = predMin === null ? p.predictedHighF : Math.min(predMin, p.predictedHighF);
      predMax = predMax === null ? p.predictedHighF : Math.max(predMax, p.predictedHighF);
    }
  }

  const coverage = relevant.length;
  const missing = 24 - coverage;

  // ... then keep building your row as before ...
```

#### Then update “first accurate” and “lock-in” loops to stop at `lastRelevantHour`

Replace your loops with variants that stop at `lastRelevantHour` (instead of 23):

```js
  // If not finalized yet, return row with null metrics (same as you do today)
  if (typeof actualHighF !== "number") {
    return {
      // ...your row fields...
      firstAccurateHour: null,
      firstAccurateLeadHours: null,
      lockInHourLenient: null,
      lockInLeadHoursLenient: null,
      lockInHourStrict: null,
      lockInLeadHoursStrict: null,
    };
  }

  const endH = lastRelevantHour ?? 23;

  // First accurate hour (earliest hour with absError <= tolerance)
  let firstAccurateHour = null;
  let firstAccurateLeadHours = null;
  for (let h = 0; h <= endH; h++) {
    const p = byHour[h];
    if (!p || typeof p.absErrorF !== "number") continue;
    if (p.absErrorF <= toleranceF) {
      firstAccurateHour = h;
      firstAccurateLeadHours =
        typeof p.leadHoursToActualHigh === "number" ? p.leadHoursToActualHigh : null;
      break;
    }
  }

  // Lock-in (lenient): earliest hour after which ALL later *recorded* snapshots stayed accurate (up to endH)
  let lockInHourLenient = null;
  let lockInLeadHoursLenient = null;
  let allLaterAccurate = true;
  for (let h = endH; h >= 0; h--) {
    const p = byHour[h];
    if (!p || typeof p.absErrorF !== "number") continue; // lenient ignores missing
    if (p.absErrorF <= toleranceF && allLaterAccurate) {
      lockInHourLenient = h;
      lockInLeadHoursLenient =
        typeof p.leadHoursToActualHigh === "number" ? p.leadHoursToActualHigh : null;
    } else {
      allLaterAccurate = false;
    }
  }

  // Lock-in (strict): requires complete uninterrupted run h..endH and all accurate
  let lockInHourStrict = null;
  let lockInLeadHoursStrict = null;
  for (let h = 0; h <= endH; h++) {
    let ok = true;
    for (let k = h; k <= endH; k++) {
      const p = byHour[k];
      if (!p || typeof p.absErrorF !== "number" || p.absErrorF > toleranceF) {
        ok = false;
        break;
      }
    }
    if (ok) {
      lockInHourStrict = h;
      lockInLeadHoursStrict =
        typeof byHour[h]?.leadHoursToActualHigh === "number" ? byHour[h].leadHoursToActualHigh : null;
      break;
    }
  }
```

**Result:** For leadDays=0, your summary metrics won’t be wrecked by “remaining-max” snapshots after the high.

---

## How to produce the exact statement you want (“12 hours in advance with 1°F error”)

You already have the best query for that:

### Use `accuracyByLeadHour`

Call it with:

* `toleranceF: 1`
* `maxLeadHours: 36` (or whatever)
* `daysBack: 60` or `90`
* optionally `leadDays: 0` (same-day highs) or `leadDays: 1` (tomorrow highs)

Interpretation:

* The bucket where `leadHour == 12` answers:
  **“When the actual high was 12 hours away, how often was AccuWeather’s predicted high within ±1°F?”**

If you want a more “human” phrasing like:

> “AccuWeather can predict the daily high 12+ hours in advance within ±1°F on 73% of days.”

Then compute a **cumulative** version:

* include all snapshots where `leadHoursToActualHigh >= 12`
* accuracy = ok / total

You can do that in the client from the returned buckets, or add a small query.

---

## About “stop collecting once high is reached”

You don’t *need* to stop collecting API data (you still want tomorrow + day+2), but you can stop **storing leadDays=0 snapshots for today** once the high is very likely done.

You already compute this in the UI:

```js
highLikelyPassed =
  observedHighSoFar != null &&
  forecastRemainingMax != null &&
  observedHighSoFar > forecastRemainingMax + 0.5;
```

If you want to enforce your original rule at the storage layer, do the same check inside `collectHourly` **for today only** and skip saving today’s `highPredictions` once it flips true.

The only extra thing you’d need is reading “observed high so far today” inside `collectHourly` (from your `observations` table), which is easy but is an extra query per location per hour. Many people just keep saving and filter later (simpler + fewer moving parts).

**My recommendation:** keep saving; filter at analysis time using `leadHoursToActualHigh >= 0` (as above). You get correctness *and* simpler ops.

---

## One more important point: don’t let “truth” be AccuWeather if you want a real accuracy test

Right now your “actual high” comes from:

* `/currentconditions/v1/{key}` hourly snapshots → `observations`

That’s fine for a prototype, but it’s not ideal if your claim is “AccuWeather forecast accuracy”, because you’re using AccuWeather itself as the observation source.

If you want this to be defensible, use an independent ground truth:

* METAR (you already ingest it!)
* NOAA / IEM / official station dataset

A practical compromise:

* keep `observations` for the “live dashboard”
* but in `finalizeDay`, compute `actualHighF` from `metarObservations` (official mode) when available

That will make your accuracy numbers mean what people assume they mean.

---

## Showing 3 separate tables for 26 / 27 / 28 (today/tomorrow/day+2)

Your storage already supports it: you’re saving predictions for all target days in `dailyMap`.

To display it, extend `dayOverview` to also fetch:

* `day2ISO = addDaysISO(todayISO, 2)`
* query `highPredictions` for `targetDateISO == day2ISO` like you do for tomorrow

Then render the same “evolution table” component three times.

---

## Quick checklist of what I’d change (minimal + high impact)

1. **Fix daily summary lock-in logic** to only consider snapshots up to the actual high time (patch above).
2. Decide which evaluation you want:

    * **leadDays=0** ⇒ “same-day high prediction lead time”
    * **leadDays=1** ⇒ “tomorrow’s high prediction lead time”
3. For your headline claim, drive it from `accuracyByLeadHour(toleranceF=1)` and report:

    * accuracy at 12h, 15h, 18h, etc.
    * and/or the earliest lead-hour where accuracy exceeds a threshold (80%, 90%)
4. (Strongly recommended) switch `finalizeDay` truth source to METAR for real accuracy.

If you want, I can also propose a single “headline metrics” query that returns something like:

* `p80LeadHoursWithin1F`
* `p80LeadHoursWithin2F`
* `maeAt12h`, `maeAt18h`, `maeAt24h`
* `biasAt12h`, etc.

…but the main thing to fix first is the “after-the-high becomes remaining-max” issue, because that’s the one that will quietly distort your conclusions.
