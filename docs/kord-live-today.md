# KORD Live Today

This document covers the live "today-only" METAR feature for KORD, including routes, backend ingest actions, and day-page live behavior.

## Purpose

- Show a live chart for **today only** using normal official METAR/SPECI reports.
- Keep the day page updated automatically through Convex subscriptions as new rows are ingested.
- Avoid cron requirements by running ingest logic only when a user has the page open.

## Routes

- `/kord/today`
  - Server-side redirect route.
  - Resolves current Chicago date (`America/Chicago`) and redirects to `/kord/day/YYYY-MM-DD`.
- `/kord/day/[date]`
  - Enables live mode only when `[date]` equals Chicago today.
  - Non-today dates remain historical/static views.

## Live Workflow

When `/kord/day/[date]` is opened for today's Chicago date:

1. Run one-time backfill for today:
   - Action: `weather:backfillTodayOfficialFromIem`
   - Source: IEM ASOS endpoint with `hours=24`, `report_type=3,4`, `data=metar`, `tz=UTC`, `format=onlycomma`
   - Filters to today's Chicago date before insert.
2. Run immediate NOAA latest poll:
   - Action: `weather:pollLatestNoaaMetar`
   - Source: NOAA latest station TXT (`.../stations/KORD.TXT`)
3. Start interval polling every 3 minutes while the tab is visible.
4. Manual "Refresh now" button triggers an immediate poll.

## Backend Actions and Mutation

Defined in `convex/weather.js`:

- `weather:pollLatestNoaaMetar`
  - Fetches NOAA latest TXT for a station ICAO.
  - Parses UTC timestamp + METAR text.
  - Skips high-frequency generated reports (`MADISHF`).
  - Extracts temperature from METAR remark `T` group first, then integer temp group fallback.
  - Calls `weather:upsertOfficialObservation`.

- `weather:backfillTodayOfficialFromIem`
  - Fetches recent official routine/special reports from IEM.
  - Parses UTC times, converts to Chicago date keys, keeps only today's date.
  - Inserts via `weather:upsertOfficialObservation`.

- `weather:upsertOfficialObservation` (internal mutation)
  - Dedupe key: `(stationIcao, mode=official, date, tsUtc)`.
  - Inserts row into `metarObservations` with `mode: "official"`.
  - Updates/creates `dailyComparisons` for:
    - `metarObsCount`
    - official max fields (`metarMaxC/F`, max time/raw/source)
    - official deltas (`deltaC`, `deltaF`) when manual values exist.

## Stored Data

- `metarObservations`
  - Uses `mode: "official"` for live ingest rows.
  - `source` is tagged with prefixes:
    - `noaa_latest:<temp_source>`
    - `iem_backfill:<temp_source>`
- `dailyComparisons`
  - Official aggregate fields are updated incrementally as new rows arrive.

## Day Page Behavior in Live Mode

In `app/kord/day/[date]/page.js` when date is today:

- Shows live status badge and refresh control.
- Chart renders official series only.
- Raw table renders official rows only.
- "All Max" summary card is hidden.
- Live status message reflects backfill/poll outcomes.

When date is not today:

- Page behaves as historical view (official + all datasets/cards).

## Known Limitations

- NOAA station TXT contains only the latest report. If two new reports arrive between polls, one can be missed.
- Polling is per-browser-tab. Multiple open tabs can issue multiple poll calls.
- No server-side scheduler is used; ingest runs only while users have live pages open.

## Change Guidance

Update this document when changing any of:

- `/kord/today` routing/date resolution.
- Live mode gating in `/kord/day/[date]`.
- Poll interval, visibility gating, or manual refresh behavior.
- `weather:pollLatestNoaaMetar`, `weather:backfillTodayOfficialFromIem`, or `weather:upsertOfficialObservation`.
