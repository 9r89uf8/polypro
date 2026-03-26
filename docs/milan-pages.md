# Milan LIMC Pages

This document describes the Milan/Malpensa routes and the LIMC public-source
logger used by those pages.

## `/milan/today`

Purpose: stable entrypoint for the current Milan local day.

What this route does:

- Server-side redirect to `/milan/day/[date]` where `[date]` is the current
  `Europe/Rome` date in `YYYY-MM-DD`.
- Avoids client-side date flicker and gives one bookmarkable URL for "today".

## `/milan/day/[date]`

Example route: `/milan/day/2026-03-25`

Purpose: stored LIMC METAR logger for the public Italian-origin MeteoAM feed,
with a publish-race table against NOAA `tgftp`.

What this page displays:

- Header with date navigation:
  - `Home`
  - `Current Date YYYY-MM-DD` for the current Milan local date
  - two quick previous-day links
  - date picker + `Go`
- Unit toggle (`C` / `F`)
- `Refresh Current Data` button
- Live badge when viewing the current Milan local date
- Summary cards:
  - `Latest`
  - `Day Range`
  - `Messages`
  - `Latest MeteoAM Seen`
- One line chart:
  - stored LIMC temperatures from the public MeteoAM Deda endpoint
  - x-axis is `Europe/Rome` local time
- `Latest Raw METAR` panel
- `Publish Race` table showing recent first-seen timing across:
  - MeteoAM Deda
  - NOAA `tgftp`
  - publish-race timestamps are shown in `America/Chicago` for consistency with
    the other station race pages
- Raw observations table:
  - `Local Time`
  - `Type`
  - `Temp`
  - `First Seen`
  - `Source`
  - `Raw METAR`

Behavior details:

- Page expects a `YYYY-MM-DD` date segment.
- If viewing today in `Europe/Rome`:
  - runs `milan:pollLatestStationMetar` on first load
  - also runs `milan:pollLatestNoaaPublishRace` on first load
  - manual refresh reruns both polls
- If viewing a historical date:
  - no MeteoAM history backfill is attempted
  - the page only shows rows already captured live and stored earlier
- Observations are deduped by `(stationIcao, date, obsTimeUtc)` in
  `milanMetarObservations`.
- Recent publish-race rows are loaded from `milanPublishRaceReports`.
- The publish-race logger is separate from the day-chart ingest:
  - MeteoAM first-seen times are written by `milan:pollLatestStationMetar`
  - NOAA `tgftp` first-seen times are written by
    `milan:pollLatestNoaaPublishRace`
  - winner/lead are computed from the earliest two sources seen for the same
    `reportTsUtc`
- The publish-race table defaults to routine reports only, so captured `SPECI`
  rows do not crowd the comparison view.

## Source

Public Italian-origin latest-METAR source used here:

- `https://api.meteoam.it/deda-ows/metar-taf-icao/LIMC/{time1}/{time2}`

NOAA comparison source:

- `https://tgftp.nws.noaa.gov/data/observations/metar/stations/LIMC.TXT`

Research note used while choosing the Milan source:

- [docs/milan.md](/mnt/c/Users/alexa/WebstormProjects/polypro2/docs/milan.md)

Known limitation:

- The MeteoAM endpoint wired here is a date-range pull, not a confirmed
  date-bounded archive API.
- That means older dates are accurate only if those rows were already captured
  live by the cron or by an earlier page visit.
- The public Italian endpoint has measured lag versus NOAA, so this page is
  useful as a logger and cross-check, not as proof of the fastest possible
  Italian operational feed.

## Data Model

- `milanMetarObservations`
  - one row per stored LIMC `METAR` or `SPECI`
  - stores local date, UTC timestamp, local timestamp, raw METAR, parsed temp,
    source, and optional `meteoAmFirstSeenAt`
- `milanDailySummaries`
  - one row per station/date
  - stores obs count, latest row fields, and max/min temperatures with times
- `milanPublishRaceReports`
  - one row per station/report timestamp
  - stores MeteoAM first-seen time, NOAA `tgftp` first-seen time, optional
    NOAA `tgftp` `Last-Modified`, winner, and lead

## Scheduled Ingest

Convex crons:

- `milan_meteoam_latest_every_minute`
  - calls `milan:pollLatestStationMetar`
  - station argument is `LIMC`
- `milan_tgftp_publish_race_every_minute`
  - calls `milan:pollLatestNoaaPublishRace`
  - station argument is `LIMC`

Milan does not use a 1-second publish-race watch. The public MeteoAM endpoint
lags by multiple minutes and does not currently justify a narrow expected-time
window, so the logger samples both sides once per minute instead.
