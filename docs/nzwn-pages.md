# NZWN Pages

This document describes the NZWN routes and the official PreFlight-backed
ingest used by those pages.

## `/nzwn/today`

Purpose: stable entrypoint for the current Wellington local day.

What this route does:

- Server-side redirect to `/nzwn/day/[date]` where `[date]` is the current
  `Pacific/Auckland` date in `YYYY-MM-DD`.
- Avoids client-side date flicker and gives one bookmarkable URL for "today".

## `/nzwn/day/[date]`

Example route: `/nzwn/day/2026-03-13`

Purpose: simple official NZWN METAR day chart.

What this page displays:

- Header with date navigation:
  - `Home`
  - `Current Date YYYY-MM-DD` for the current Wellington local date
  - two quick previous-day links
  - date picker + `Go`
- Unit toggle (`C` / `F`)
- `Refresh from PreFlight` button
- Live badge when viewing the current Wellington local date
- Summary cards:
  - `Latest`
  - `Day Range`
  - `Messages`
  - `Near-Live Now`
- One line chart:
  - official NZWN `METAR`
  - off-hour `SPECI` points if the official feed exposes them
  - blue points for `METAR`, red points for `SPECI`
  - x-axis is `Pacific/Auckland` local time
- `Latest Raw METAR` panel
- `Near-Live Airport Current` panel
  - unofficial Weather.com/Wunderground airport-current observation for `NZWN`
  - separate from the official METAR history series
- `Publish Race` table showing recent first-seen timing between official
  PreFlight and NOAA `tgftp`
  - publish-race timestamps are displayed in `America/Chicago`
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
  - runs `preflight:backfillDayStationMessages`
  - saves any official NZWN rows for that selected Wellington local day that are
    still present in the current PreFlight rolling message window
- If viewing today in `Pacific/Auckland`:
  - also runs `preflight:pollLatestStationMetar`
  - the page shows the stored first-seen time for any row captured from the
    latest official endpoint
- Manual refresh reruns the same rolling sync, and reruns the latest poll when
  the route date is today.
- Each page load and manual refresh also fetches a live unofficial
  `Weather.com/Wunderground` airport-current reading for `NZWN`.
- The unofficial card is independent of the selected historical date.
- Observations are deduped by `(stationIcao, date, obsTimeUtc)` in
  `preflightMetarObservations`.
- Recent publish-race rows are loaded from `preflightPublishRaceReports`.
- The publish-race logger is separate from the day chart ingest:
  - official first-seen times are written by `preflight:pollLatestStationMetar`
  - NOAA `tgftp` first-seen times are written by
    `preflight:pollLatestNoaaPublishRace`
  - winner/lead are computed only when both sources have first-seen times for
    the same `reportTsUtc`

## Official Source

Latest official NZWN JSON:

- `https://gopreflight.co.nz/data/aerodromesv3/NZWN`

Near-live unofficial NZWN airport current JSON:

- `https://api.weather.com/v3/wx/observations/current?apiKey=...&language=en-US&units=m&format=json&icaoCode=NZWN`

Requirements:

- Requests must send `Authorization: Bearer <token>`
- The token is a logged-in user access token captured from PreFlight, stored in
  `PREFLIGHT_AUTH_BEARER_TOKEN`
- The unofficial Weather.com current endpoint uses the public key embedded in
  Wunderground airport pages.

Known limitation:

- The official endpoint we found exposes a rolling recent message array, not a
  date-bounded history search.
- That means same-day backfill only works for rows still visible in the rolling
  window.
- Older dates are accurate only if those rows were already captured live by the
  cron or by an earlier page visit.

## Data Model

- `preflightMetarObservations`
  - one row per official NZWN `METAR` or `SPECI`
  - stores local date, UTC timestamp, local timestamp, raw METAR, parsed temp,
    source, and optional `preflightFirstSeenAt`
- `preflightDailySummaries`
  - one row per station/date
  - stores obs count, latest row fields, min/max temps, and min/max times
- `preflightPublishRaceReports`
  - one row per station/report timestamp
  - stores PreFlight first-seen time, NOAA `tgftp` first-seen time, optional
    `tgftp` `Last-Modified`, winner, and lead

## Scheduled Ingest

Convex cron:

- `nzwn_preflight_latest_every_minute`
  - calls `preflight:pollLatestStationMetar`
  - station argument is `NZWN`
- `nzwn_tgftp_publish_race_every_minute`
  - calls `preflight:pollLatestNoaaPublishRace`
  - station argument is `NZWN`
- `nzwn_publish_race_watch_minute_25_55`
  - calls `preflight:watchStationPublishRaceWindow`
  - station argument is `NZWN`
  - starts at minutes `25` and `55`
  - passes `durationMs=900000`, so each watch runs for 15 minutes
  - polls PreFlight and NOAA `tgftp` in short intervals through the usual late
    `:00` / `:30` release window

NZWN uses both:

- continuous minute-by-minute official/NOAA polling as a fallback
- short-interval watch windows around the routine half-hour boundaries

That combination is needed because Wellington reports can appear several minutes
after the nominal `:00` and `:30` schedule.
