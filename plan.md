Got it. You want a **live “today-only” chart** of **normal METAR/SPECI** temps (no HF/MADIS), fed by the **NOAA “latest METAR” TXT** endpoint, updated by a **3‑minute poll**, and persisted so the chart updates automatically via Convex subscriptions.

Important constraint: that NOAA endpoint only ever returns **the most recent report** (timestamp + METAR in the TXT). Example format for KORD looks like: `YYYY/MM/DD HH:MM` followed by the METAR line. ([NOAA FTP Server][1])

Below is a detailed “do this then that” plan your agent can implement with your existing app structure.

---

# What you are building

### Behavior

* A “**Today (Live)**” page that shows **only today’s official METAR/SPECI temps** on a line chart.
* The page:

    1. does a **one-time backfill** for today (so you don’t start with an empty chart at 5pm),
    2. then **polls NOAA every 3 minutes** and inserts a new observation **only if it changed**.
* Chart updates automatically as Convex data changes.

### Data

* Reuse your existing `metarObservations` table with:

    * `mode: "official"`
    * `source: "noaa_latest"` or `"iem_backfill"`
* Reuse `dailyComparisons` for max/summary if you want (optional, but your day page already expects it).

---

# Why you should do a one-time backfill (PRO detail)

If you only poll `KORD.TXT`, then you only capture observations **from the moment the user opened the tab**. That’s usually not what “today’s chart” means.

**PRO approach (no cron needed):**

* On page load, fetch the **last 24 hours** of routine + special METAR from IEM and filter to **today local**.
* Then start NOAA polling.

IEM explicitly supports `hours=24` and `report_type=3,4` (Routine + Specials). ([Iowa Environmental Mesonet][2])

This is still “no cron” because it runs only when a user opens the page.

---

# Step-by-step implementation plan

## Step 1 — Add a new “Live Today” route

Create:

**`app/kord/today/page.js`** (server component redirect; clean, no client flicker)

```js
import { redirect } from "next/navigation";

const CHICAGO_TZ = "America/Chicago";

function chicagoTodayKey() {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function TodayRedirectPage() {
  const date = chicagoTodayKey();
  redirect(`/kord/day/${date}`);
}
```

Now you can link users to `/kord/today` and they’ll land on today’s day page.

---

## Step 2 — Add Convex “live ingest” backend functions

You will add 2 Actions + 1 internal Mutation to **`convex/weather.js`**.

### 2.1 Helpers: parse NOAA TXT, parse METAR temp, format Chicago date/time

Add these helpers in `convex/weather.js` (top-level, not exported):

```js
const CHICAGO_TZ = "America/Chicago";

function cToF(c) {
  return c * 9 / 5 + 32;
}

// Returns { dateKey: "YYYY-MM-DD", tsLocal: "YYYY-MM-DD HH:mm" }
function formatChicago(tsUtcMs) {
  const d = new Date(tsUtcMs);

  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  return { dateKey, tsLocal: `${dateKey} ${time}` };
}

function parseNoaaLatestTxt(text) {
  const cleaned = text.trim().replace(/\r/g, "");
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);

  let stamp;
  let metar;

  if (lines.length >= 2) {
    stamp = lines[0];
    metar = lines[1];
  } else {
    // sometimes the file is one line: "YYYY/MM/DD HH:MM METAR..."
    const m = cleaned.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\s+(.*)$/);
    if (!m) throw new Error(`Unexpected NOAA format: ${cleaned.slice(0, 80)}...`);
    stamp = m[1];
    metar = m[2];
  }

  const tm = stamp.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!tm) throw new Error(`Bad NOAA timestamp line: ${stamp}`);

  const year = Number(tm[1]);
  const month = Number(tm[2]);
  const day = Number(tm[3]);
  const hour = Number(tm[4]);
  const minute = Number(tm[5]);

  const tsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return { tsUtcMs, metar };
}

// Best: parse remark T group (tenths C). Fallback: integer group M06/M11
function extractTempC(metar) {
  if (!metar) return { tempC: null, source: "none" };

  // Example: RMK ... T10611111 -> temp = -6.1C
  const t = metar.match(/\bT([01])(\d{3})([01])(\d{3})\b/);
  if (t) {
    const sign = t[1] === "1" ? -1 : 1;
    const tenths = Number(t[2]);
    if (Number.isFinite(tenths)) {
      return { tempC: sign * (tenths / 10), source: "remark_T" };
    }
  }

  // Example: M06/M11 or 08/06
  const m = metar.match(/\b(M?\d{2})\/(M?\d{2}|\/\/)\b/);
  if (m) {
    const raw = m[1];
    const neg = raw.startsWith("M");
    const v = Number(raw.replace("M", ""));
    if (Number.isFinite(v)) {
      return { tempC: neg ? -v : v, source: "metar_integer" };
    }
  }

  return { tempC: null, source: "none" };
}
```

This matches what you need:

* NOAA file always contains timestamp + METAR line ([NOAA FTP Server][1])
* Parse tenths (better) or integer.

---

### 2.2 Internal Mutation: upsert an observation and update daily max/count

Add:

```js
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const upsertOfficialObservation = internalMutation({
  args: {
    stationIcao: v.string(),
    date: v.string(),     // YYYY-MM-DD (Chicago)
    tsUtc: v.number(),    // ms epoch
    tsLocal: v.string(),  // "YYYY-MM-DD HH:mm"
    tempC: v.number(),
    tempF: v.number(),
    rawMetar: v.string(),
    source: v.string(),   // "noaa_latest" | "iem_backfill"
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Dedupe: same station+mode+date+tsUtc => already have it
    const existing = await ctx.db
      .query("metarObservations")
      .withIndex("by_station_mode_date_ts", (q) =>
        q
          .eq("stationIcao", args.stationIcao)
          .eq("mode", "official")
          .eq("date", args.date)
          .eq("tsUtc", args.tsUtc)
      )
      .unique();

    if (existing) {
      return { inserted: false };
    }

    await ctx.db.insert("metarObservations", {
      stationIcao: args.stationIcao,
      mode: "official",
      date: args.date,
      tsUtc: args.tsUtc,
      tsLocal: args.tsLocal,
      tempC: args.tempC,
      tempF: args.tempF,
      rawMetar: args.rawMetar,
      source: args.source,
      updatedAt: now,
    });

    // Update dailyComparisons summary (optional but keeps your day page cards accurate)
    let comp = await ctx.db
      .query("dailyComparisons")
      .withIndex("by_station_date", (q) =>
        q.eq("stationIcao", args.stationIcao).eq("date", args.date)
      )
      .unique();

    if (!comp) {
      const id = await ctx.db.insert("dailyComparisons", {
        stationIcao: args.stationIcao,
        date: args.date,
        updatedAt: now,
      });
      comp = await ctx.db.get(id);
    }

    const prevCount = comp.metarObsCount ?? 0;
    const prevMaxC = comp.metarMaxC;

    const patch = {
      metarObsCount: prevCount + 1,
      updatedAt: now,
    };

    const isNewMax =
      prevMaxC === undefined || prevMaxC === null || args.tempC > prevMaxC;

    if (isNewMax) {
      patch.metarMaxC = args.tempC;
      patch.metarMaxF = args.tempF;
      patch.metarMaxAtUtc = args.tsUtc;
      patch.metarMaxAtLocal = args.tsLocal;
      patch.metarMaxRaw = args.rawMetar;
      patch.metarMaxSource = args.source;

      // Update delta if manual exists
      if (comp.manualMaxC !== undefined && comp.manualMaxC !== null) {
        patch.deltaC = comp.manualMaxC - args.tempC;
      }
      if (comp.manualMaxF !== undefined && comp.manualMaxF !== null) {
        patch.deltaF = comp.manualMaxF - args.tempF;
      }
    }

    await ctx.db.patch(comp._id, patch);

    return { inserted: true };
  },
});
```

This gives you:

* “insert if new”
* “update summary max/count”
* no duplicates

---

### 2.3 Action: Poll NOAA latest METAR (every 3 minutes from client)

Add:

```js
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const pollLatestNoaaMetar = action({
  args: {
    stationIcao: v.string(), // "KORD"
  },
  handler: async (ctx, { stationIcao }) => {
    const url = `https://tgftp.nws.noaa.gov/data/observations/metar/stations/${stationIcao}.TXT`;

    // NOAA file contains a UTC timestamp + the latest METAR :contentReference[oaicite:3]{index=3}
    const res = await fetch(url, {
      // best-effort to avoid caching
      headers: { "Cache-Control": "no-cache" },
    });

    if (!res.ok) {
      throw new Error(`NOAA fetch failed ${res.status}`);
    }

    const text = await res.text();
    const { tsUtcMs, metar } = parseNoaaLatestTxt(text);
    const { dateKey, tsLocal } = formatChicago(tsUtcMs);

    const { tempC, source: tempSource } = extractTempC(metar);
    if (tempC === null) {
      return { ok: false, reason: "no_temp_in_metar", dateKey, tsUtcMs };
    }

    const tempF = cToF(tempC);

    const result = await ctx.runMutation(internal.weather.upsertOfficialObservation, {
      stationIcao,
      date: dateKey,
      tsUtc: tsUtcMs,
      tsLocal,
      tempC,
      tempF,
      rawMetar: metar,
      source: "noaa_latest:" + tempSource,
    });

    return {
      ok: true,
      inserted: result.inserted,
      dateKey,
      tsUtcMs,
      tempC,
      tempF,
    };
  },
});
```

This is the function your page calls every 3 minutes.

---

### 2.4 Action: One-time backfill for today from IEM (last 24 hours → filter to today)

Add (recommended):

```js
export const backfillTodayOfficialFromIem = action({
  args: {
    stationIem: v.string(),   // "ORD"
    stationIcao: v.string(),  // "KORD"
  },
  handler: async (ctx, { stationIem, stationIcao }) => {
    // IEM supports hours=24 and report_type=3,4 (routine + specials) :contentReference[oaicite:4]{index=4}
    const url = new URL("https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py");
    url.searchParams.set("station", stationIem);
    url.searchParams.append("data", "metar");
    url.searchParams.set("report_type", "3,4");
    url.searchParams.set("tz", "UTC");
    url.searchParams.set("format", "onlycomma");
    url.searchParams.set("hours", "24");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`IEM fetch failed ${res.status}`);

    const csv = await res.text();
    const rows = parseCsv(csv); // reuse your CSV parser from month compute

    const todayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: CHICAGO_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    let insertedCount = 0;
    for (const r of rows) {
      // IEM 'valid' is like "YYYY-MM-DD HH:MM" when tz=UTC :contentReference[oaicite:5]{index=5}
      const m = String(r.valid || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
      if (!m) continue;
      const tsUtcMs = Date.UTC(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4]), Number(m[5]), 0, 0
      );

      const { dateKey, tsLocal } = formatChicago(tsUtcMs);
      if (dateKey !== todayKey) continue;

      const metar = String(r.metar || "");
      const { tempC, source: tempSource } = extractTempC(metar);
      if (tempC === null) continue;

      const tempF = cToF(tempC);

      const result = await ctx.runMutation(internal.weather.upsertOfficialObservation, {
        stationIcao,
        date: dateKey,
        tsUtc: tsUtcMs,
        tsLocal,
        tempC,
        tempF,
        rawMetar: metar,
        source: "iem_backfill:" + tempSource,
      });

      if (result.inserted) insertedCount += 1;
    }

    return { ok: true, insertedCount };
  },
});
```

Notes:

* This uses **report_type=3,4 only** (Routine + Specials), no HF data. ([Iowa Environmental Mesonet][2])
* It’s only called once when the page opens (or when the user clicks Backfill).

---

## Step 3 — Add polling to your existing Day page only when it is “today”

In **`app/kord/day/[date]/page.js`**, add:

1. import `useEffect`, `useAction`:

```js
import { useEffect, useRef } from "react";
import { useAction } from "convex/react";
```

2. add helpers:

```js
const CHICAGO_TZ = "America/Chicago";
function chicagoTodayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
```

3. inside `KordDayPage()`, create actions:

```js
const pollLatest = useAction("weather:pollLatestNoaaMetar");
const backfillToday = useAction("weather:backfillTodayOfficialFromIem");

const isToday = isDateValid(date) && date === chicagoTodayKey();
const inFlightRef = useRef(false);
```

4. add the polling effect:

```js
useEffect(() => {
  if (!isToday) return;

  let cancelled = false;

  async function safeCall(fn) {
    if (cancelled) return;
    if (document.hidden) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await fn();
    } catch (err) {
      console.error(err);
    } finally {
      inFlightRef.current = false;
    }
  }

  // 1) Backfill once so the chart has today’s earlier points
  safeCall(() =>
    backfillToday({ stationIem: "ORD", stationIcao: STATION_ICAO })
  );

  // 2) Poll immediately and then every 3 minutes
  safeCall(() => pollLatest({ stationIcao: STATION_ICAO }));

  const id = setInterval(() => {
    safeCall(() => pollLatest({ stationIcao: STATION_ICAO }));
  }, 180000);

  return () => {
    cancelled = true;
    clearInterval(id);
  };
}, [isToday, pollLatest, backfillToday]);
```

Now your existing `useQuery("weather:getDayObservations", ...)` will “just update” as new rows are inserted.

---

## Step 4 — Make the chart “official only” when live (optional but matches your request)

Right now you render both “Official” and “All”. For today live view, you can hide “All”:

Replace your dataset build:

```js
const chartData = useMemo(
  () => ({
    datasets: isToday
      ? [buildLineDataset(officialRows, displayUnit, "Official", "#0f766e")]
      : [
          buildLineDataset(officialRows, displayUnit, "Official", "#0f766e"),
          buildLineDataset(allRows, displayUnit, "All", "#111827"),
        ],
  }),
  [officialRows, allRows, displayUnit, isToday]
);
```

And in the raw table merge, you can also switch to official only when live if you want.

---

## Step 5 — Add a “Live” badge + manual refresh button (quality polish)

In your header, if `isToday` true:

* show `LIVE (polling every 3 min)`
* add a “Refresh now” button that calls `pollLatest(...)`

This makes it feel pro and gives you a manual escape hatch.

---

# Testing checklist (your agent should follow)

1. Open `/kord/today` → it redirects to `/kord/day/YYYY-MM-DD`.
2. Page loads:

    * Backfill runs once → chart shows points from earlier today (if any).
3. Leave tab open across `:51–:54` past the hour:

    * Within 3 minutes after the new METAR posts, a new point appears.
4. Confirm dedupe:

    * polling every 3 minutes should not create duplicates (same timestamp won’t insert again).
5. Confirm time axes:

    * points show correct local `HH:mm` (America/Chicago), including around midnight boundaries.

---

# Two key limitations (so you don’t get surprised)

1. **Polling “latest-only” can miss a report** if two METAR/SPECI updates happen between polls.
   The one-time backfill reduces the “missing earlier in the day” problem, but it won’t catch a rapid pair that happened in the last 3 minutes. (Rare at KORD, but possible.)

2. **Multiple users = multiple polls**
   Each open tab will call the action every 3 minutes. If that’s a concern later, you can add a shared “cooldown” doc in Convex so only one poll per minute happens globally.

---

[1]: https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT "tgftp.nws.noaa.gov"
[2]: https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?help= "Iowa Environmental Mesonet"
