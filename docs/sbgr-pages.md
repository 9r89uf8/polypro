# SBGR Pages

This document describes the SBGR routes and the official REDEMET-backed ingest
used by those pages.

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
- `Publish Race` table showing recent first-seen timing between REDEMET and
  NOAA `tgftp`
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
  - REDEMET first-seen times can also be written by the existing latest poll
  - NOAA `tgftp` first-seen times are written by the race logger
  - winner/lead are computed only when both sources have first-seen times for
    the same `reportTsUtc`

## Official Sources

Latest official SBGR JSON:

- `https://api-redemet.decea.mil.br/aerodromos/info?localidade=SBGR&metar='sim'&taf='sim'&aviso='sim'&api_key=...`

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
  - stores REDEMET first-seen time, NOAA `tgftp` first-seen time, optional
    `tgftp` `Last-Modified`, winner, and lead

## Scheduled Ingest

Convex cron:

- `sbgr_redemet_latest_every_minute`
  - calls `redemet:pollLatestStationMetar`
  - station argument is `SBGR`
- `sbgr_publish_race_watch_minute_59`
  - calls `redemet:watchStationPublishRaceWindow`
  - station argument is `SBGR`
  - polls REDEMET and NOAA `tgftp` in short intervals through the top-of-hour
    window so first-seen timing is more precise than a once-per-minute cron

This keeps the current local day updated even if no browser is open.
