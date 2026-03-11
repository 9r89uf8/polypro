# KORD Live Today

This document covers the live "today-only" KORD pages, including METAR ingest on `/kord/day/[date]` and the phone-call controls on `/kord/today`.

## Purpose

- Show a live chart for **today only** using official METAR/SPECI plus all-mode observations.
- Keep the day page updated automatically through Convex subscriptions as new rows are ingested.
- Keep official and all-mode METAR ingest running even when no `/kord/day/[date]` tab is open.

## Routes

- `/kord/today`
  - Client page for KORD phone-call temperatures for Chicago today.
  - Includes a manual `Call now` button that queues an immediate outbound call via `kordPhone:enqueueManualCall`.
  - Links to `/kord/day/YYYY-MM-DD` for the live METAR day chart.
- `/kord/day/[date]`
  - Enables live mode only when `[date]` equals Chicago today.
  - Non-today dates remain historical/static views.

## Live Workflow

Server-side ingest (independent of browser tabs):

1. Convex cron runs every 2 minutes:
   - Cron: `kord_official_metar_every_2_min` in `convex/crons.js`
   - Action: `weather:pollLatestNoaaMetar`
   - Args: `{ stationIcao: "KORD" }`
2. Convex cron also runs at minute `:51` every hour:
   - Cron: `kord_official_metar_minute_51`
   - Action: `weather:pollLatestNoaaMetar`
   - Args: `{ stationIcao: "KORD" }`
3. Convex cron runs every 5 minutes for all-mode backfill:
   - Cron: `kord_all_metar_every_5_min`
   - Action: `weather:backfillTodayAllFromIem`
   - Args: `{ stationIem: "ORD", stationIcao: "KORD" }`
4. Convex cron runs every 5 minutes for the hidden NOAA/Synoptic helper feed:
   - Cron: `kord_hidden_synoptic_every_5_min`
   - Action: `synoptic:pollStationTimeseries`
   - Args: `{ stationIcao: "KORD", recentMinutes: 30 }`
   - Source: NOAA WRH KORD time-series page dependency backed by `api.synopticdata.com/v2/stations/timeseries`
   - Uses the local-only `NOAA_WRH_SYNOPTIC_TOKEN` env var plus NOAA-style headers
   - Stores deduped KORD helper rows by observation timestamp and recomputes same-day rollups.
5. Convex cron runs every 5 minutes for nearby Weather.com PWS stations:
   - Cron: `kord_weathercom_pws_every_5_min`
   - Action: `pws:pollWeatherComPwsBatch`
   - Args: `{ stationIcao: "KORD" }`
   - Source: Weather.com PWS current-observation endpoint using the public key embedded in the Wunderground KORD page on March 9, 2026
   - Current station set: `KILBENSE14`, `KILBENSE15`
   - Stores deduped rows by `(stationIcao, pwsStationId, date, obsTimeUtc)` and recomputes per-station day rollups.

When `/kord/day/[date]` is opened for today's Chicago date:

1. Run one-time backfill for today:
   - Action: `weather:backfillTodayOfficialFromIem`
   - Source: IEM ASOS endpoint with `hours=24`, `report_type=3,4`, `data=metar`, `tz=UTC`, `format=onlycomma`
   - Filters to today's Chicago date before insert.
2. Run one-time all-mode backfill for today:
   - Action: `weather:backfillTodayAllFromIem`
   - Source: IEM ASOS endpoint with `hours=24`, `report_type=1,3,4`, `data=metar`, `tz=UTC`, `format=onlycomma`
   - Filters to today's Chicago date before insert.
3. Day-page NOAA latest poll path is currently disabled:
   - In page code: `ENABLE_DAY_PAGE_NOAA_POLL = false`
   - Result: opening the day page does not trigger `weather:pollLatestNoaaMetar`.
4. Do not start recurring client-side interval polling.
5. Live updates continue via Convex subscriptions as server cron ingests rows.
6. Manual "Refresh now" triggers all-mode backfill only.

## Backend Actions and Mutation

Defined in `convex/weather.js`:

- `weather:pollLatestNoaaMetar`
  - Fetches NOAA latest TXT for a station ICAO.
  - Parses UTC timestamp + METAR text.
  - Skips high-frequency generated reports (`MADISHF`).
  - Extracts temperature from METAR remark `T` group first, then integer temp group fallback.
  - Captures poll time (`noaaSeenAt`) and forwards it to `weather:upsertOfficialObservation`.
  - Calls `weather:upsertOfficialObservation`.

- `weather:backfillTodayOfficialFromIem`
  - Fetches recent official routine/special reports from IEM.
  - Parses UTC times, converts to Chicago date keys, keeps only today's date.
  - Inserts via `weather:upsertOfficialObservation`.

- `weather:backfillTodayAllFromIem`
  - Fetches recent all-mode reports from IEM (`report_type=1,3,4`).
  - Parses UTC times, converts to Chicago date keys, keeps only today's date.
  - Skips rows where extracted temperature source is `remark_T`.
  - As a result, source `iem_backfill_all:remark_T` is not stored.
  - Inserts via `weather:upsertAllObservation`.

- `weather:upsertOfficialObservation` (internal mutation)
  - Dedupe key: `(stationIcao, mode=official, date, tsUtc)`.
  - Inserts row into `metarObservations` with `mode: "official"`.
  - Persists `noaaFirstSeenAt` when a row is first observed via NOAA latest polling.
  - If a row already exists (for example from IEM backfill), a later NOAA poll will patch `noaaFirstSeenAt` the first time NOAA sees that same `(station,date,tsUtc)` report.
  - Updates/creates `dailyComparisons` for:
    - `metarObsCount`
    - official max fields (`metarMaxC/F`, max time/raw/source)
    - official deltas (`deltaC`, `deltaF`) when manual values exist.
    - Does not update any forecast/AccuWeather comparison fields.

- `weather:upsertAllObservation` (internal mutation)
  - Dedupe key: `(stationIcao, mode=all, date, tsUtc)`.
  - Inserts row into `metarObservations` with `mode: "all"`.
  - Updates/creates `dailyComparisons` for:
    - `metarAllObsCount`
    - all-mode max fields (`metarAllMaxC/F`, max time/raw/source)
    - all-mode deltas (`deltaAllC`, `deltaAllF`) when manual values exist.

Related phone-call trigger in `convex/kordPhone.js`:

- `kordPhone:enqueueManualCall` (public mutation)
  - Uses Chicago current time as the `slotLocal` key.
  - Dedupe key: `(stationIcao, slotLocal)` via `kordPhoneCalls.by_station_slot`.
  - Inserts a `queued` row and schedules `internal.kordPhoneNode.startCall`.

Related scheduler in `convex/crons.js`:

- `kord_official_metar_every_2_min`
  - Invokes `weather:pollLatestNoaaMetar` every 2 minutes with `stationIcao: "KORD"`.
- `kord_official_metar_minute_51`
  - Invokes `weather:pollLatestNoaaMetar` at minute `:51` every hour with `stationIcao: "KORD"`.
- `kord_all_metar_every_5_min`
  - Invokes `weather:backfillTodayAllFromIem` every 5 minutes with `stationIem: "ORD", stationIcao: "KORD"`.
  - Keeps all-mode ingest active even when no day page is open.
- `kord_hidden_synoptic_every_5_min`
  - Invokes `synoptic:pollStationTimeseries` every 5 minutes with `stationIcao: "KORD", recentMinutes: 30`.
  - Polls the hidden NOAA/Synoptic KORD time-series feed, stores intrahour KORD observations in dedicated tables, and backfills overlap rows via the rolling recent window.
- `kord_weathercom_pws_every_5_min`
  - Invokes `pws:pollWeatherComPwsBatch` every 5 minutes with `stationIcao: "KORD"`.
  - Polls the Wunderground-backed Weather.com PWS endpoint for the configured nearby stations and stores them in dedicated PWS tables.

## Stored Data

- `metarObservations`
  - Uses `mode: "official"` for NOAA poll + official IEM backfill rows.
  - Uses `mode: "all"` for all-mode IEM backfill rows.
  - Official rows can include `noaaFirstSeenAt` (epoch ms) showing first observed time from NOAA latest polling.
  - `source` is tagged with prefixes:
    - `noaa_latest:<temp_source>`
    - `iem_backfill:<temp_source>`
    - `iem_backfill_all:<temp_source>` (excluding `remark_T`)
- `dailyComparisons`
  - Official and all aggregate fields are updated incrementally as new rows arrive.
- `synopticObservations`
  - Stores hidden NOAA/Synoptic rows keyed by `(stationIcao, date, obsTimeUtc)`.
  - Tracks `firstSeenAt` and `lastSeenAt` so helper-feed lag can be measured separately from observation time.
  - Stores parsed fields including temperature, dew point, humidity, wind, visibility, ceiling, metar origin, and raw METAR text.
- `synopticDailySummaries`
  - Stores per-day helper-feed rollups (`obsCount`, latest observation time, daily min/max temperature, latest origin/raw METAR).
  - Intended for day-page summary use without re-scanning the raw intrahour rows.
- `weatherComPwsObservations`
  - Stores nearby PWS rows keyed by `(stationIcao, pwsStationId, date, obsTimeUtc)`.
  - Tracks `firstSeenAt` and `lastSeenAt` for the current-observation polling path.
  - Stores parsed Weather.com/Wunderground PWS fields only, not the raw JSON payload.
- `weatherComPwsDailySummaries`
  - Stores per-day per-station PWS rollups (`obsCount`, latest observation, daily min/max temperature).
  - Intended for later bias/MAE comparison work against Synoptic helper rows and official hourly KORD reports.

## Day Page Behavior in Live Mode

In `app/kord/day/[date]/page.js` when date is today:

- Shows live status badge and refresh control.
- Chart renders official + all series, hidden NOAA/Synoptic helper rows, nearby PWS series, and optional phone-call overlays.
- Raw table renders official + all rows.
- Optional raw subtables render hidden NOAA/Synoptic rows and nearby PWS rows when expanded.
- Nearby PWS summary cards render once `weatherComPwsDailySummaries` exists for the selected day.
- "All Max" summary card is visible.
- Live status message reflects backfill outcomes (with poll-disabled note for manual refresh) and notes that the Synoptic helper feed plus nearby PWS are collected separately by cron.
- No recurring client-side 2-minute poll is scheduled.

When date is not today:

- Page behaves as historical view (official + all datasets/cards).

## Known Limitations

- NOAA station TXT contains only the latest report. If two new reports arrive between polls, one can be missed.
- Official cron jobs can overlap with each other; storage remains deduped by `(stationIcao, mode, date, tsUtc)`.
- All-mode cron, page bootstrap, and manual refresh can fetch overlapping all-mode rows; storage remains deduped by `(stationIcao, mode, date, tsUtc)`.
- `noaaFirstSeenAt` reflects first time this app observed the report from NOAA latest polling, not NOAA's upstream publish timestamp; precision is bounded by poll cadence and tab-visibility pauses.
- The hidden NOAA/Synoptic helper feed is not a stable documented public API. It depends on NOAA page behavior, a locally stored token, and NOAA-style request headers.

## Change Guidance

Update this document when changing any of:

- `/kord/today` phone-call controls (`Call now`) or route/date behavior.
- Live mode gating in `/kord/day/[date]`.
- Day bootstrap/live message/manual refresh behavior.
- `convex/crons.js` METAR poll scheduling.
- `kordPhone:enqueueManualCall`.
- `weather:pollLatestNoaaMetar`, `weather:backfillTodayOfficialFromIem`, `weather:backfillTodayAllFromIem`, `weather:upsertOfficialObservation`, or `weather:upsertAllObservation`.
