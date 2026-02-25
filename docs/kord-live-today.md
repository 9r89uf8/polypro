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

When `/kord/day/[date]` is opened for today's Chicago date:

1. Run one-time backfill for today:
   - Action: `weather:backfillTodayOfficialFromIem`
   - Source: IEM ASOS endpoint with `hours=24`, `report_type=3,4`, `data=metar`, `tz=UTC`, `format=onlycomma`
   - Filters to today's Chicago date before insert.
2. Run one-time all-mode backfill for today:
   - Action: `weather:backfillTodayAllFromIem`
   - Source: IEM ASOS endpoint with `hours=24`, `report_type=1,3,4`, `data=metar`, `tz=UTC`, `format=onlycomma`
   - Filters to today's Chicago date before insert.
3. Run immediate NOAA latest poll:
   - Action: `weather:pollLatestNoaaMetar`
   - Source: NOAA latest station TXT (`.../stations/KORD.TXT`)
4. Do not start recurring client-side interval polling.
5. Live updates continue via Convex subscriptions as server cron ingests rows.
6. Manual "Refresh now" triggers all-mode backfill + immediate NOAA poll.

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

## Stored Data

- `metarObservations`
  - Uses `mode: "official"` for NOAA poll + official IEM backfill rows.
  - Uses `mode: "all"` for all-mode IEM backfill rows.
  - Official rows can include `noaaFirstSeenAt` (epoch ms) showing first observed time from NOAA latest polling.
  - `source` is tagged with prefixes:
    - `noaa_latest:<temp_source>`
    - `iem_backfill:<temp_source>`
    - `iem_backfill_all:<temp_source>`
- `dailyComparisons`
  - Official and all aggregate fields are updated incrementally as new rows arrive.

## Day Page Behavior in Live Mode

In `app/kord/day/[date]/page.js` when date is today:

- Shows live status badge and refresh control.
- Chart renders official + all series.
- Raw table renders official + all rows.
- "All Max" summary card is visible.
- Live status message reflects backfill/poll outcomes.
- No recurring client-side 2-minute poll is scheduled.

When date is not today:

- Page behaves as historical view (official + all datasets/cards).

## Known Limitations

- NOAA station TXT contains only the latest report. If two new reports arrive between polls, one can be missed.
- Official cron and manual refresh can fetch the same official report; storage remains deduped by `(stationIcao, mode, date, tsUtc)`.
- All-mode cron, page bootstrap, and manual refresh can fetch overlapping all-mode rows; storage remains deduped by `(stationIcao, mode, date, tsUtc)`.
- `noaaFirstSeenAt` reflects first time this app observed the report from NOAA latest polling, not NOAA's upstream publish timestamp; precision is bounded by poll cadence and tab-visibility pauses.

## Change Guidance

Update this document when changing any of:

- `/kord/today` phone-call controls (`Call now`) or route/date behavior.
- Live mode gating in `/kord/day/[date]`.
- Day bootstrap/live message/manual refresh behavior.
- `convex/crons.js` METAR poll scheduling.
- `kordPhone:enqueueManualCall`.
- `weather:pollLatestNoaaMetar`, `weather:backfillTodayOfficialFromIem`, `weather:backfillTodayAllFromIem`, `weather:upsertOfficialObservation`, or `weather:upsertAllObservation`.
