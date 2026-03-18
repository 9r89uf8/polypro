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
- `Refresh Current Data` button
- Live badge when viewing the current Wellington local date
- Summary cards:
  - `Latest`
  - `Day Range`
  - `Messages`
  - `Near-Live Now`
- `Weather.com + Google` panel:
  - unofficial Weather.com airport current for `NZWN`
  - current-condition details such as humidity, wind, gust, and pressure when
    present
  - selected-date Weather.com forecast summary
  - Google hourly forecast-derived peak time window
- `Weather.com 5-Day Forecast` table:
  - `Date`
  - `Min`
  - `Max`
  - `Peak Window`
  - `Day`
  - `Night`
- One line chart:
  - official NZWN `METAR`
  - off-hour `SPECI` points if the official feed exposes them
  - blue points for `METAR`, red points for `SPECI`
  - x-axis is `Pacific/Auckland` local time
- `Latest Raw METAR` panel
- `Publish Race` table showing recent first-seen timing across official
  PreFlight, authenticated AEROWEB, and NOAA `tgftp`
  - publish-race timestamps are displayed in `America/Chicago`
  - the UI only shows those three race sources plus `tgftp` `Last-Modified`
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
- Each page load also loads a live unofficial weather sidecar:
  - Weather.com airport current for `NZWN`
  - Weather.com 5-day daily forecast for Wellington
  - Google hourly forecast used to derive peak-time windows
- Manual refresh reruns the same rolling sync, reruns the latest poll when the
  route date is today, and reloads that weather sidecar.
- The unofficial current card is independent of the selected historical date.
- The 5-day forecast and hourly peak windows are limited to the current live
  provider window, so older selected dates usually show no forecast row.
- Observations are deduped by `(stationIcao, date, obsTimeUtc)` in
  `preflightMetarObservations`.
- Recent publish-race rows are loaded from `preflightPublishRaceReports`.
- The publish-race logger is separate from the day chart ingest:
  - official first-seen times are written by `preflight:pollLatestStationMetar`
  - AEROWEB first-seen times are written by
    `preflight:pollLatestAerowebPublishRace`
  - NOAA `tgftp` first-seen times are written by
    `preflight:pollLatestNoaaPublishRace`
  - winner/lead are computed from the earliest two sources seen for the same
    `reportTsUtc`

## Official Source

Latest official NZWN JSON:

- `https://gopreflight.co.nz/data/aerodromesv3/NZWN`

Authenticated AEROWEB NZWN message page used in the publish-race logger:

- `https://aviation.meteo.fr/showmessage.php?code=NZWN`

Near-live unofficial NZWN airport current JSON:

- `https://api.weather.com/v3/wx/observations/current?apiKey=...&language=en-US&units=m&format=json&icaoCode=NZWN`

Near-live unofficial NZWN/Wellington forecast JSON:

- `https://api.weather.com/v3/wx/forecast/daily/5day?apiKey=...&language=en-US&units=m&format=json&geocode=-41.286,174.777`

Google hourly forecast used for peak-window timing:

- `https://weather.googleapis.com/v1/forecast/hours:lookup?key=...&location.latitude=-41.286&location.longitude=174.777`

Requirements:

- Requests must send `Authorization: Bearer <token>`
- The token is a logged-in user access token captured from PreFlight, stored in
  `PREFLIGHT_AUTH_BEARER_TOKEN`
- The unofficial Weather.com current and 5-day endpoints use the public key
  embedded in Wunderground airport pages.
- The Google hourly endpoint uses `GOOGLE_WEATHER_API_KEY`.

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
  - stores PreFlight first-seen time, authenticated AEROWEB first-seen time,
    NOAA `tgftp` first-seen time, optional `tgftp` `Last-Modified`, winner,
    and lead

## Scheduled Ingest

Convex cron:

- `nzwn_preflight_latest_every_minute`
  - calls `preflight:pollLatestStationMetar`
  - station argument is `NZWN`
- `nzwn_tgftp_publish_race_every_minute`
  - calls `preflight:pollLatestNoaaPublishRace`
  - station argument is `NZWN`
- `nzwn_aeroweb_publish_race_every_minute`
  - calls `preflight:pollLatestAerowebPublishRace`
  - station argument is `NZWN`
- `nzwn_publish_race_watch_minute_04_34`
  - calls `preflight:watchStationPublishRaceWindow`
  - station argument is `NZWN`
  - starts at minutes `04` and `34`
  - passes `durationMs=900000`, so each watch runs for 15 minutes
  - polls PreFlight, AEROWEB, and NOAA `tgftp` every `1s` through the usual
    late post-`:00` / post-`:30` release window

NZWN uses both:

- continuous minute-by-minute PreFlight/AEROWEB/NOAA polling as a fallback
- 1-second watch windows starting at `:04` and `:34`

That combination is needed because Wellington reports can appear several minutes
after the nominal `:00` and `:30` schedule.
