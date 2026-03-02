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

- Header with date plus navigation:
  - `Home` and `Current Date YYYY-MM-DD` (jumps to Chicago "today").
  - Two quick previous-day buttons (relative to the route date): `date - 1 day` and `date - 2 days`.
  - `Pick Date` button that opens a date picker and routes to `/kord/day/[picked-date]`.
- If viewing today (Chicago date), a live badge (`Live ingest enabled`) and `Refresh now` button.
- Unit toggle (`C` / `F`) for day-level display.
- Summary cards:
  - `Manual / WU Max` (includes day-level manual entry controls: unit toggle, numeric input, and `Save`)
  - `Official Max` (+ obs count)
  - `All Max` (+ obs count).
- Line chart:
  - Today route date: official + all METAR lines.
  - Non-today dates: official + all METAR lines.
  - Toggle controls to show/hide each series: `Official`, unofficial `All`, and `Phone Calls`.
  - Saved phone-call temperatures are overlaid as a separate `Phone calls` line when available for that date.
  - Horizontal annotation line for manual/WU max.
  - X-axis is local time (`America/Chicago`) shown in 12-hour format (`h:mm AM/PM`).
  - X-axis labels are hourly.
  - Mobile behavior (`<=768px`):
    - Larger point markers and larger point hit radii for easier tapping.
    - Interaction is biased to the x-axis (`nearest` by x), making touch selection less precise-sensitive.
    - Slightly larger tooltip text for readability.
    - Horizontally scrollable chart region (`overflow-x-auto`) with a wider mobile plot area (`min-width: 2000px`) so denser time labels remain legible.
    - Taller chart container and a mobile tip note (`swipe horizontally to inspect points across the full day`).
  - Desktop behavior:
    - Horizontally scrollable chart region is also enabled.
    - Plot area uses a wider minimum width so hourly labels remain readable.
- Raw observations table:
  - Hidden by default behind a `Show Raw Observations` toggle.
  - Defaults to official rows only; unofficial `all` rows are hidden until `Show Unofficial (All)` is enabled.
  - `Local Time`, `Mode`, `Temp`, `Source`, `NOAA First Seen`, `Lag vs Obs`, `Raw METAR`.
  - `Local Time` and `NOAA First Seen` are displayed in 12-hour local time with AM/PM.
  - `NOAA First Seen` is populated for official rows once NOAA latest polling first observes that report.
  - `Lag vs Obs` shows `(NOAA First Seen - METAR observation tsUtc)` in minutes.
  - Today route date: official + all rows.

Behavior details:

- If no observations are stored for that date, the table shows a no-data message.
- Day page expects a `YYYY-MM-DD` date segment.
- If route date equals Chicago today:
  - Runs one-time backfill action: `weather:backfillTodayOfficialFromIem` (IEM last 24h, report types 3/4, filtered to today local date).
  - Runs one-time backfill action: `weather:backfillTodayAllFromIem` (IEM last 24h, report types 1/3/4, filtered to today local date).
  - NOAA latest poll call exists in page code but is disabled (`ENABLE_DAY_PAGE_NOAA_POLL = false`), so day-page load does not trigger `weather:pollLatestNoaaMetar`.
  - Does not run a recurring client poll interval.
  - Ongoing official ingest runs via Convex crons (`kord_official_metar_every_2_min` plus `kord_official_metar_minute_51`).
  - Ongoing all-mode ingest runs via Convex cron (`kord_all_metar_every_5_min`).
  - Manual refresh triggers all-mode today backfill only (no day-page NOAA poll).
  - Inserts are deduped by `(stationIcao, mode, date, tsUtc)` via:
    - `weather:upsertOfficialObservation` for `mode=official`
    - `weather:upsertAllObservation` for `mode=all`
  - Official rows may include `noaaFirstSeenAt` when seen by NOAA latest poll jobs (cron-driven; includes patching an existing backfilled row on first NOAA sighting).
  - `dailyComparisons` official/all max/count fields are updated incrementally when new rows are inserted.
- Manual/WU max can be saved directly from this page for the selected day:
  - Uses `weather:upsertManualMonth` with a single day value (`values: [{ date, value }]`).
  - Updates `dailyComparisons.manualMaxC/manualMaxF` and related deltas immediately.

## Data sources used by these pages

- `dailyComparisons` table for daily aggregates (manual, official, and all fields).
- `monthRuns` table for compute statuses and timestamps.
- `metarObservations` table for per-observation day charting and raw review.
- `kordPhoneCalls` table (via `kordPhone:getDayPhoneReadings`) for optional day-chart phone-temperature overlay.
- Live-today actions:
  - NOAA latest TXT endpoint (`/data/observations/metar/stations/{ICAO}.TXT`) for incremental polling.
  - IEM ASOS request endpoint (`hours=24`, `report_type=3,4`) for official today backfill.
  - IEM ASOS request endpoint (`hours=24`, `report_type=1,3,4`) for all-mode today backfill.
