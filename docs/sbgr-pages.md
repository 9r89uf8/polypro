# SBGR Pages

This document describes the SBGR routes and the official Brazilian ingest used
by those pages.

## `/sbgr/today`

Purpose: stable entrypoint for the current Sao Paulo local day.

What this route does:

- Server-side redirect to `/sbgr/day/[date]` where `[date]` is the current
  `America/Sao_Paulo` date in `YYYY-MM-DD`.
- Avoids client-side date flicker and gives one bookmarkable URL for "today".

## `/sbgr/day/[date]`

Example route: `/sbgr/day/2026-03-11`

Purpose: simple official SBGR METAR day chart.

What this page displays:

- Header with date navigation:
  - `Home`
  - `Current Date YYYY-MM-DD` for the current Sao Paulo local date
  - two quick previous-day links
  - date picker + `Go`
- Unit toggle (`C` / `F`)
- `Refresh from REDEMET` button
- Live badge when viewing the current Sao Paulo local date
- Summary cards:
  - `Latest`
  - `Day Range`
  - `Messages`
- One line chart:
  - official REDEMET hourly `METAR`
  - off-hour `SPECI` points mixed into the same line
  - blue points for `METAR`, red points for `SPECI`
  - x-axis is `America/Sao_Paulo` local time
- `Latest Raw METAR` panel
- `Publish Race` table showing recent first-seen timing across the official
  REDEMET `mensagens/metar` endpoint and NOAA `tgftp`
  - routine hourly `METAR` rows only
  - off-hour `SPECI` remain in the chart and raw observations table
  - publish-race timestamps are displayed in `America/Chicago`
  - includes both:
    - `REDEMET Seen` from the app's own short-interval watcher
    - `REDEMET Received` from the message endpoint's official `recebimento`
      field
- Raw observations table:
  - `Local Time`
  - `Type`
  - `Temp`
  - `First Seen`
  - `Source`
  - `Raw METAR`

Behavior details:

- Page expects a `YYYY-MM-DD` date segment.
- On first load for a date:
  - runs `redemet:backfillDayStationMessages`
  - saves official SBGR rows for that selected Sao Paulo local day
- If viewing today in `America/Sao_Paulo`:
  - also runs `redemet:pollLatestStationMetar`
  - the page shows the stored first-seen time for any row captured from the
    latest official endpoint
- Manual refresh reruns the same backfill, and reruns the latest poll when the
  route date is today.
- Observations are deduped by `(stationIcao, date, obsTimeUtc)` in
  `redemetMetarObservations`.
- Recent publish-race rows are loaded from `redemetPublishRaceReports`.
- The publish-race logger is separate from the day chart ingest:
  - REDEMET first-seen times come from the `mensagens/metar` race watcher, not
    from the slower `aerodromos/info` summary poll
  - REDEMET `recebimento` is also stored for each message row
  - NOAA `tgftp` first-seen times are written by the race logger
  - winner/lead are computed from the earliest two sources seen for the same
    `reportTsUtc`
  - the page intentionally filters the publish-race table down to routine
    hourly `METAR` rows
  - reason:
    - the SBGR race watcher is centered on the `:55` top-of-hour window
    - that makes it useful for routine publication timing
    - it is not a trustworthy mid-hour `SPECI` race measurement
  - historical note:
    - earlier March 13-15, 2026 sampling proved the AISWEB gateway, AISWEB site
      alias, and REDEMET `pwa` route all lagged the closer
      `REDEMET mensagens/metar` path
    - the live race logger is now intentionally narrowed to
      `mensagens/metar` vs `tgftp`
    - `mensagens/metar` is still the only one exposing `recebimento`
    - as of March 15, 2026 the live watcher now samples this race every `1s`
      by default so near-ties are less likely to be artifacts of the older
      `5s` cadence

## Official Sources

Latest official SBGR JSON:

- `https://api-redemet.decea.mil.br/aerodromos/info?localidade=SBGR&metar='sim'&taf='sim'&aviso='sim'&api_key=...`

Latest official SBGR METAR messages:

- `https://api-redemet.decea.mil.br/mensagens/metar/SBGR?api_key=...&data_ini=YYYYMMDDHH&data_fim=YYYYMMDDHH&page_tam=24`

Historical official message search:

- `https://redemet.decea.mil.br/old/modal/consulta-de-mensagens/`

The historical form is queried in two UTC windows for one Sao Paulo local day:

- selected UTC date `00:00` through `23:59`
- next UTC date `00:00` through `02:59`

Rows are then filtered back down to the selected `America/Sao_Paulo` local date.

## Data Model

- `redemetMetarObservations`
  - one row per official SBGR `METAR` or `SPECI`
  - stores local date, UTC timestamp, local timestamp, raw METAR, parsed temp,
    source, and optional `redemetFirstSeenAt`
- `redemetDailySummaries`
  - one row per station/date
  - stores obs count, latest row fields, min/max temps, and min/max times
- `redemetPublishRaceReports`
  - one row per station/report timestamp
  - stores REDEMET `mensagens/metar` first-seen time, REDEMET `recebimento`,
    NOAA `tgftp` first-seen time, optional `tgftp` `Last-Modified`, winner,
    and lead
  - may also contain off-hour `SPECI` rows captured by REDEMET, but the day
    page race table hides those by default

## Scheduled Ingest

Convex cron:

- `sbgr_redemet_latest_every_minute`
  - calls `redemet:pollLatestStationMetar`
  - station argument is `SBGR`
- `sbgr_publish_race_watch_minute_54`
  - calls `redemet:watchStationPublishRaceWindow`
  - station argument is `SBGR`
  - starts at minute `54`
  - passes `durationMs=600000`, so the watch runs for 10 minutes
  - polls REDEMET `mensagens/metar` and NOAA `tgftp` every `1s` by default from
    `:54` through just after the top of the hour so first-seen timing is more
    precise than a once-per-minute cron

This keeps the current local day updated even if no browser is open.
