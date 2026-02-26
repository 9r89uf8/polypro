### Midnight behavior (Feb 25 → Feb 26)

You **do not wait** for Feb 26 to “resolve” before starting Feb 27.

* Your collector runs every hour.
* As soon as the **local date flips to Feb 26 (00:00 America/Chicago)**, the next hourly run will treat:

    * **“today” = Feb 26**
    * **“tomorrow” = Feb 27**
* So yes: **you start collecting predicted highs for Feb 27 immediately at/after midnight Feb 26**.

Separately:

* **Finalizing Feb 26** (computing the actual high and attaching errors) happens **after Feb 26 ends**, typically at **00:00 on Feb 27** (or whatever “finalize time” you choose).
  That finalization does **not block** collecting predictions for Feb 27.

---

## Why your current setup won’t fully use the 72‑hour forecast (and how to fix it)

Right now (based on the earlier design), you’re only saving **leadDays 0 and 1** (today + tomorrow). That means:

* On **Feb 25**, you save predictions for **Feb 26** (tomorrow) ✅
* On **Feb 25**, you **do not** save predictions for **Feb 27** even though it’s inside the 72‑hour window ❌
* You only start saving Feb 27 at **midnight Feb 26** ✅

To make statements like **“32 hours before the target day starts”** (or even **48+ hours**), you should also save **day+2** (and optionally day+3 when fully covered) *from the same hourly 72-hour forecast response*.

### Example (what you want)

For target day **Feb 26**:

* **32 hours before Feb 26 00:00** is **Feb 24 16:00**
* You can only measure that if, on Feb 24 at 4pm, you were already storing a prediction for Feb 26.
  That requires saving **leadDays = 2** records.

---

# What to add

You asked for:

1. **Daily summary table** ✅ (you already have it)
2. **Current day info + “did tomorrow’s predicted max change over time?”** ✅ (you already show the evolution table)
3. A new table like:

* 12h lead: 90% accurate (MAE 1°F)
* 16h lead: 82% accurate (MAE 1.5°F)
* 24h lead: 75% accurate (MAE 2°F)

To do (3) well, we need one extra computed metric per stored prediction:

* **leadHoursToTargetStart** = hours from snapshot → **target day 00:00** (local)

Then we can bucket by lead hours: 12, 16, 24, 32, etc.

---

# Fix 1: Save predictions for ALL dates found in the 72-hour forecast

Instead of only “today/tomorrow”, compute the max temp for every calendar date in the 72 hourly entries and store each.

## Schema change

Add one field so you can filter out partial days later:

* `hoursCoveredForTarget` (how many hourly entries for that target date were present in the 72h response)

Also add:

* `leadHoursToTargetStart` (computed when the day is finalized)

### `convex/schema.ts` (highPredictions additions)

```ts
// Add these fields inside highPredictions:
hoursCoveredForTarget: v.number(),

leadHoursToTargetStart: v.optional(v.number()),
```

(Keep your existing `leadHoursToActualHigh`, `absErrorF`, etc.)

---

## Collector change (weather collector)

### Helper: compute daily maxes from the 72-hour hourly forecast

```js
function daysBetweenISO(aISO, bISO) {
  // b - a in whole days (UTC-safe)
  const [ay, am, ad] = aISO.split("-").map(Number);
  const [by, bm, bd] = bISO.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

function computeDailyHighMap(hourlyArray, timeZone, getLocalParts) {
  // returns Map(dateISO -> { dateISO, count, maxTempF, maxTimeEpochMs })
  const map = new Map();

  for (const h of hourlyArray) {
    const epochMs = (h.EpochDateTime ?? 0) * 1000;
    const tempF = h?.Temperature?.Value;
    if (!epochMs || typeof tempF !== "number") continue;

    const { dateISO } = getLocalParts(epochMs, timeZone);
    const cur = map.get(dateISO) || {
      dateISO,
      count: 0,
      maxTempF: -Infinity,
      maxTimeEpochMs: null,
    };

    cur.count += 1;
    if (tempF > cur.maxTempF) {
      cur.maxTempF = tempF;
      cur.maxTimeEpochMs = epochMs;
    }

    map.set(dateISO, cur);
  }

  return map;
}
```

### Update your `saveHighPrediction` mutation signature

Add `hoursCoveredForTarget`:

```js
export const saveHighPrediction = internalMutation({
  args: {
    locationId: v.id("locations"),
    fetchedAtMs: v.number(),
    fetchedHourBucketMs: v.number(),
    fetchedLocalDateISO: v.string(),
    fetchedLocalHour: v.number(),

    targetDateISO: v.string(),
    leadDays: v.number(),

    predictedHighF: v.number(),
    predictedHighTimeEpochMs: v.number(),

    hoursCoveredForTarget: v.number(),
  },
  handler: async (ctx, args) => {
    // ...same idempotency check...
    return await ctx.db.insert("highPredictions", {
      ...args,
      finalizedAtMs: 0,
    });
  },
});
```

### Update `collectHourly` to store multiple target dates

Inside `collectHourly`, after you fetch `hourly`:

```js
const dailyMap = computeDailyHighMap(hourly, loc.timeZone, getLocalParts);

for (const d of dailyMap.values()) {
  const leadDays = daysBetweenISO(fetchedLocalDateISO, d.dateISO);

  // Keep what you want. For 72h data, leadDays typically 0..3.
  if (leadDays < 0 || leadDays > 3) continue;

  await ctx.runMutation(internal.weather.saveHighPrediction, {
    locationId: loc._id,
    fetchedAtMs: now,
    fetchedHourBucketMs,
    fetchedLocalDateISO,
    fetchedLocalHour,

    targetDateISO: d.dateISO,
    leadDays,

    predictedHighF: d.maxTempF,
    predictedHighTimeEpochMs: d.maxTimeEpochMs,

    hoursCoveredForTarget: d.count,
  });
}
```

✅ Now you’re collecting **Feb 27** predictions on **Feb 25** (leadDays=2), not just starting at midnight Feb 26.

---

# Fix 2: Compute “lead hours before target day start” at finalization

This is what enables your “12h / 16h / 24h / 32h” table.

### Add a robust “local midnight epoch” helper (optional but best)

If you want to keep it simpler, you can compute lead hours from `leadDays*24 - fetchedLocalHour`, but DST can skew it. This version is DST-safe.

In `convex/time.js`:

```js
export function getLocalParts(ms, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(new Date(ms));
  const m = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;

  return {
    dateISO: `${m.year}-${m.month}-${m.day}`,
    hour: Number(m.hour),
    minute: Number(m.minute),
  };
}

export function localMidnightEpochMs(dateISO, timeZone) {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const utcMidnight = Date.UTC(y, mo - 1, d, 0, 0, 0);

  // Search ±14h in 1-minute steps for local 00:00
  const start = utcMidnight - 14 * 3600000;
  for (let i = 0; i <= 28 * 60; i++) {
    const t = start + i * 60000;
    const p = getLocalParts(t, timeZone);
    if (p.dateISO === dateISO && p.hour === 0 && p.minute === 0) return t;
  }

  throw new Error(`Could not find local midnight for ${dateISO} in ${timeZone}`);
}
```

### Update `finalizeDay` to set `leadHoursToTargetStart`

In `finalizeDay`, after you compute `actualHighTimeEpochMs`, do:

```js
const loc = await ctx.db.get(args.locationId);
const tz = loc.timeZone;

const targetStartMs = localMidnightEpochMs(args.dateISO, tz);

for (const p of preds) {
  const absErrorF = Math.abs(p.predictedHighF - actualHighF);

  const leadHoursToActualHigh = Math.floor(
    (actualHighTimeEpochMs - p.fetchedHourBucketMs) / 3600000
  );

  const leadHoursToTargetStart = Math.floor(
    (targetStartMs - p.fetchedHourBucketMs) / 3600000
  );

  await ctx.db.patch(p._id, {
    actualHighF,
    actualHighTimeEpochMs,
    absErrorF,
    leadHoursToActualHigh,
    leadHoursToTargetStart,
    finalizedAtMs: now,
  });
}
```

---

# New Stats: The exact table you described (12h / 16h / 24h / 32h)

### `convex/stats.js`

This returns accuracy + MAE for a list of lead hours.

```js
import { query } from "./_generated/server";
import { v } from "convex/values";

export const leadHourAccuracyTable = query({
  args: {
    locationId: v.id("locations"),
    daysBack: v.number(),          // e.g. 90
    toleranceF: v.number(),        // e.g. 2
    leadHours: v.array(v.number()),// e.g. [12,16,24,32]
    minHoursCovered: v.optional(v.number()), // default 24
  },
  handler: async (ctx, args) => {
    const minHoursCovered = args.minHoursCovered ?? 24;
    const minFinalizedAt = Date.now() - args.daysBack * 86400000;

    const preds = await ctx.db
      .query("highPredictions")
      .withIndex("by_location_finalizedAt", (q) =>
        q.eq("locationId", args.locationId).gt("finalizedAtMs", minFinalizedAt)
      )
      .collect();

    const wanted = new Set(args.leadHours);
    const agg = new Map(); // leadHour -> {n, ok, sumAbs, sumSigned}

    for (const p of preds) {
      if (p.finalizedAtMs === 0) continue;
      if (typeof p.absErrorF !== "number") continue;
      if (typeof p.actualHighF !== "number") continue;
      if (typeof p.leadHoursToTargetStart !== "number") continue;

      if (p.hoursCoveredForTarget < minHoursCovered) continue;

      const lh = p.leadHoursToTargetStart;
      if (!wanted.has(lh)) continue;

      const a = agg.get(lh) || { leadHour: lh, n: 0, ok: 0, sumAbs: 0, sumSigned: 0 };
      a.n += 1;
      a.sumAbs += p.absErrorF;
      a.sumSigned += (p.predictedHighF - p.actualHighF);
      if (p.absErrorF <= args.toleranceF) a.ok += 1;
      agg.set(lh, a);
    }

    return args.leadHours
      .slice()
      .sort((a, b) => a - b)
      .map((lh) => {
        const a = agg.get(lh);
        if (!a) return { leadHour: lh, samples: 0, accuracy: null, mae: null, bias: null };
        return {
          leadHour: lh,
          samples: a.n,
          accuracy: a.n ? a.ok / a.n : null,
          mae: a.n ? a.sumAbs / a.n : null,
          bias: a.n ? a.sumSigned / a.n : null, // + means forecast too warm
        };
      });
  },
});
```

Now you can call it with:

* `[12, 16, 24, 32]` (or add 36/48/60 if you start saving leadDays=2 and 3 with full coverage)

---

# Dashboard: Add the lead-time accuracy table

In `DashboardClient.jsx`:

```jsx
const leadTable =
  useQuery(api.stats.leadHourAccuracyTable, {
    locationId,
    daysBack: 90,
    toleranceF: 2,
    leadHours: [12, 16, 24, 32],
    minHoursCovered: 24,
  }) || [];
```

Render:

```jsx
<section className="border rounded p-4">
  <h2 className="text-lg font-medium">Accuracy vs Lead Time (before target day starts)</h2>
  <div className="text-sm text-gray-600">Tolerance ±2°F · Full-day coverage only</div>

  <div className="mt-3 overflow-x-auto">
    <table className="min-w-full text-sm border">
      <thead className="bg-gray-50">
        <tr>
          <th className="text-left p-2 border">Lead</th>
          <th className="text-left p-2 border">Accuracy</th>
          <th className="text-left p-2 border">MAE</th>
          <th className="text-left p-2 border">Bias</th>
          <th className="text-left p-2 border">Samples</th>
        </tr>
      </thead>
      <tbody>
        {leadTable.map((r) => (
          <tr key={r.leadHour} className="border-t">
            <td className="p-2 border">{r.leadHour}h</td>
            <td className="p-2 border">
              {r.accuracy == null ? "—" : `${Math.round(r.accuracy * 100)}%`}
            </td>
            <td className="p-2 border">
              {r.mae == null ? "—" : `${r.mae.toFixed(1)}°F`}
            </td>
            <td className="p-2 border">
              {r.bias == null ? "—" : `${r.bias.toFixed(1)}°F`}
            </td>
            <td className="p-2 border">{r.samples}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</section>
```

That produces exactly the kind of table you described.

---

# About your screenshot (two quick notes)

### 1) “Today predicted high — (snapshot 12am)” is a UI bug

Right now you’re showing `snapshot 12am` even when there is no `latestToday`.

Change:

```jsx
(snapshot {fmtHour(overview.todayForecast.latest?.fetchedLocalHour ?? 0)})
```

to:

```jsx
{overview.todayForecast.latest
  ? `(snapshot ${fmtHour(overview.todayForecast.latest.fetchedLocalHour)})`
  : ""}
```

So it doesn’t imply there’s a 12am snapshot when there isn’t.

### 2) Daily Summary table empty is expected if you only started today

Your “completed days” table (leadDays=1) won’t show **Feb 26** until **after Feb 26 ends** (finalize runs at **00:00 Feb 27**). And you won’t have a Feb 25 row unless you were collecting on Feb 24.

---

## Does “tomorrow evolution” belong in daily summary?

Not really — it’s **live / in-progress**.

Best practice:

* **Current Day view**: show “tomorrow predicted high” and its changes as the day progresses ✅
* **Daily Summary**: after the target day finishes, show “when it became accurate” + drift + lock-in ✅

If you want, I can add 2 more fields to each daily summary row:

* `changeCount` (how many times predictedHigh changed on the prior day)
* `lastChangeHour` (last hour it changed)

Those make it super easy to see “stable by 10pm” patterns.

---
