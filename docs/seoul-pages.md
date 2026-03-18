# Seoul RKSI Pages

This document describes the Seoul/Incheon routes and the RKSI official ingest
used by those pages.

## `/seoul/today`

Purpose: stable entrypoint for the current Seoul local day.

What this route does:

- Server-side redirect to `/seoul/day/[date]` where `[date]` is the current
  `Asia/Seoul` date in `YYYY-MM-DD`.
- Avoids client-side date flicker and gives one bookmarkable URL for "today".

## `/seoul/day/[date]`

Example route: `/seoul/day/2026-03-18`

Purpose: official RKSI METAR day chart plus a publish-race view.

What this page displays:

- Header with date navigation:
  - `Home`
  - `Current Date YYYY-MM-DD` for the current Seoul local date
  - two quick previous-day links
  - date picker + `Go`
- Unit toggle (`C` / `F`)
- `Refresh Current Data` button
- Live badge when viewing the current Seoul local date
- Summary cards:
  - `Latest`
  - `Day Range`
  - `Messages`
- One line chart:
  - official RKSI `METAR`
  - off-hour `SPECI` points if the official AMO feed exposes them
  - blue points for `METAR`, red points for `SPECI`
  - x-axis is `Asia/Seoul` local time
- `Latest Raw METAR` panel
- `Publish Race` table showing recent first-seen timing across the official
  AMO/KMA latest-METAR API and NOAA `tgftp`
  - publish-race timestamps are displayed in `America/Chicago`
  - the UI shows AMO seen time, NOAA `tgftp` seen time, and NOAA `tgftp`
    `Last-Modified`
- Raw observations table:
  - `Local Time`
  - `Type`
  - `Temp`
  - `First Seen`
  - `Source`
  - `Raw METAR`

Behavior details:

- Page expects a `YYYY-MM-DD` date segment.
- If viewing today in `Asia/Seoul`:
  - runs `seoul:pollLatestStationMetar` on first load
  - manual refresh reruns that official poll
  - the page shows the stored AMO first-seen time for any row captured from the
    latest official endpoint
- If viewing a historical date:
  - no official history backfill is attempted
  - the page only shows rows already captured live and stored earlier
- Observations are deduped by `(stationIcao, date, obsTimeUtc)` in
  `seoulMetarObservations`.
- Recent publish-race rows are loaded from `seoulPublishRaceReports`.
- The publish-race logger is separate from the day-chart ingest:
  - official first-seen times are written by `seoul:pollLatestStationMetar`
  - NOAA `tgftp` first-seen times are written by
    `seoul:pollLatestNoaaPublishRace`
  - winner/lead are computed from the earliest two sources seen for the same
    `reportTsUtc`
- The publish-race table defaults to routine reports only, so captured `SPECI`
  rows do not crowd the comparison view.

## Official Source

Official latest RKSI METAR XML:

- `http://amoapi.kma.go.kr/amoApi/metar?icao=RKSI`

NOAA comparison source:

- `https://tgftp.nws.noaa.gov/data/observations/metar/stations/RKSI.TXT`

Research note used while choosing the Seoul source:

- [docs/seoul.md](/mnt/c/Users/alexa/WebstormProjects/polypro2/docs/seoul.md)

Known limitation:

- The official endpoint wired here is a latest-message lookup, not a confirmed
  date-bounded history search.
- That means older dates are accurate only if those rows were already captured
  live by the cron or by an earlier page visit.

## Data Model

- `seoulMetarObservations`
  - one row per official RKSI `METAR` or `SPECI`
  - stores local date, UTC timestamp, local timestamp, raw METAR, parsed temp,
    source, and optional `amoFirstSeenAt`
- `seoulDailySummaries`
  - one row per station/date
  - stores obs count, latest row fields, min/max temps, and min/max times
- `seoulPublishRaceReports`
  - one row per station/report timestamp
  - stores AMO first-seen time, NOAA `tgftp` first-seen time, optional NOAA
    `tgftp` `Last-Modified`, winner, and lead

## Scheduled Ingest

Convex crons:

- `seoul_amo_latest_window_minutes`
  - calls `seoul:pollLatestStationMetar`
  - station argument is `RKSI`
  - runs at minute `29`, `30`, `31`, `58`, `59`, `00`, and `01`
- `seoul_tgftp_publish_race_every_minute`
  - calls `seoul:pollLatestNoaaPublishRace`
  - station argument is `RKSI`

Seoul does not use a 1-second publish-race watch. The official AMO side is
sampled only in the routine half-hour windows so the app avoids excessive RKSI
API traffic while still capturing who usually publishes first.
