# KORD Pages

This document describes what the KORD routes display and how they are intended to be used.

## `/kord/today`

Purpose: stable entrypoint for the live-today view.

What this route does:

- Server-side redirect to `/kord/day/[date]` where `[date]` is the current Chicago date (`America/Chicago`) in `YYYY-MM-DD`.
- Avoids client-side date flicker and gives one bookmarkable URL for "today".

## `/kord/month`

Purpose: month-level workflow for manual-vs-METAR comparison.

What this page displays:

- Month selector (`year`, `month`) and `Load` button.
- Manual input area:
  - Unit toggle (`C` or `F`).
  - Textarea where each line maps to day 1..N for the selected month.
  - Parse preview table showing `day`, raw value, parsed value, and parse status.
  - `Save Manual Max` action.
- Compute area:
  - `Compute METAR Daily Max` button that computes **both** modes (`official` and `all`) in one run.
  - `Force Recompute` button that re-runs both modes even if already computed.
  - Per-mode status chips (`official`, `all`), per-mode last-computed timestamps, and per-mode errors.
- Comparison table (one row per day):
  - `Date` (clickable; opens day detail route).
  - `Manual Max`.
  - `Official Max`, `Official Time`, `Official Obs`, `Official Raw`, `Official Delta`.
  - `All Max`, `All Time`, `All Obs`, `All Raw`, `All Delta`.
  - Unit display toggle (`C` / `F`) for table temperatures and deltas.

Behavior details:

- Regular compute skips a mode if that month+mode is already fully computed.
- Force recompute refreshes existing records.
- Observation data is refreshed per month+mode (old rows cleared, then replaced), so duplicates are avoided.

## `/kord/day/[date]`

Example route: `/kord/day/2026-02-20`

Purpose: day-level diagnostics for observation-by-observation review.

What this page displays:

- Header with date plus `Home` and `Back to Month` navigation.
- If viewing today (Chicago date), a live badge (`Live polling every 3 minutes`) and `Refresh now` button.
- Unit toggle (`C` / `F`) for day-level display.
- Summary cards:
  - `Manual / WU Max`
  - `Official Max` (+ obs count)
  - `All Max` (+ obs count) on non-today dates.
- Line chart:
  - Today route date: official-only METAR line (normal METAR/SPECI ingest).
  - Non-today dates: official + all METAR lines.
  - Saved phone-call temperatures are overlaid as a separate `Phone calls` line when available for that date.
  - Horizontal annotation line for manual/WU max.
  - X-axis is local time (`America/Chicago`) shown in 12-hour format (`h:mm AM/PM`).
- Raw observations table:
  - `Local Time`, `Mode`, `Temp`, `Source`, `Raw METAR`.
  - Today route date: official rows only.

Behavior details:

- If no observations are stored for that date, the table shows a no-data message.
- Day page expects a `YYYY-MM-DD` date segment.
- If route date equals Chicago today:
  - Runs one-time backfill action: `weather:backfillTodayOfficialFromIem` (IEM last 24h, report types 3/4, filtered to today local date).
  - Runs immediate live poll action: `weather:pollLatestNoaaMetar` (NOAA latest station TXT).
  - Starts a 3-minute interval to poll NOAA while the tab is visible.
  - Inserts are deduped by `(stationIcao, mode=official, date, tsUtc)` via `weather:upsertOfficialObservation`.
  - Official `dailyComparisons` max/count fields are updated incrementally when new rows are inserted.

## Data sources used by these pages

- `dailyComparisons` table for daily aggregates (manual, official, and all fields).
- `monthRuns` table for compute statuses and timestamps.
- `metarObservations` table for per-observation day charting and raw review.
- `kordPhoneCalls` table (via `kordPhone:getDayPhoneReadings`) for optional day-chart phone-temperature overlay.
- Live-today actions:
  - NOAA latest TXT endpoint (`/data/observations/metar/stations/{ICAO}.TXT`) for incremental polling.
  - IEM ASOS request endpoint (`hours=24`, `report_type=3,4`) for today backfill.
