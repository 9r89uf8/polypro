# Paris LFPG Pages

Verified against the in-repo implementation on March 17, 2026.

## `/paris/today`

- Server-side redirect to `/paris/day/[date]` where `[date]` is the current
  `Europe/Paris` date.

## `/paris/day/[date]`

Example route: `/paris/day/2026-03-16`

Purpose:

- show the official LFPG METAR day chart backed by authenticated
  `aviation.meteo.fr` polling
- compare recent AEROWEB first-seen timing against NOAA `tgftp`
- show current Paris-airport temperature and 5-day forecast context from
  Weather.com
- show today's NOAA METAR max for LFPG from AviationWeather raw METAR history

Main page behavior:

- Uses `aeroweb:getDayStationRows` to load stored LFPG rows and the daily
  summary.
- Uses `aeroweb:getRecentPublishRaceReports` with `routineOnly: true` to load
  recent routine publish-race rows.
- Uses `parisWeather:getDayPageWeather` to load on-demand sidecar data for the
  page:
  - Weather.com current temperature for the LFPG airport geocode
  - Weather.com 5-day daily forecast
  - Google Weather API hourly forecast, used to derive per-day peak hit time
    where available
  - today's NOAA/AviationWeather LFPG METAR max from a raw METAR pull
- If the selected date equals the current `Europe/Paris` date:
  - runs `aeroweb:pollLatestStationMetar` on first load
  - manual refresh re-runs both the authenticated AEROWEB poll and the
    on-demand Weather.com / NOAA sidecar fetch
- If the selected date is not today:
  - no authenticated history backfill is attempted
  - the page only shows rows already captured live and stored earlier
- peak-time cells are only populated when the selected forecast day is inside
  the current Google hourly forecast window; later 5-day rows keep the
  Weather.com daily max/min forecast but show no hit time
- when consecutive hourly rows share the same daily high, the page shows a
  start-to-end peak window such as `3:00 PM to 5:00 PM`; an isolated single
  peak hour still shows one time

Official source used today:

- `https://aviation.meteo.fr/showmessage.php?code=LFPG`

Supporting official pages also identified during the investigation:

- `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=LFPG`
- `https://aviation.meteo.fr/bulletin_maa.php?mode=html&codes=LFPG`

Current known limitation:

- there is no confirmed authenticated day-history endpoint wired for LFPG, so
  older dates depend on what the app already captured live

Convex tables:

- `aerowebMetarObservations`
  - one row per stored LFPG METAR/SPECI observation
  - includes parsed temperature, canonical raw METAR, source, and optional
    `aerowebFirstSeenAt`
- `aerowebDailySummaries`
  - one LFPG summary row per local `Europe/Paris` date
- `aerowebPublishRaceReports`
  - first-seen timing rows for authenticated AEROWEB vs NOAA `tgftp`

Convex functions:

- `aeroweb:pollLatestStationMetar`
  - logs in to `aviation.meteo.fr`
  - fetches `showmessage.php?code=LFPG`
  - stores the latest official METAR/SPECI row
  - records the AEROWEB side of the publish-race row
- `aeroweb:pollLatestNoaaPublishRace`
  - samples `tgftp` for LFPG
  - records the NOAA side of the publish-race row
- `aeroweb:getDayStationRows`
  - returns stored LFPG rows plus the daily summary for the selected date
- `aeroweb:getRecentPublishRaceReports`
  - returns recent LFPG publish-race rows
- `parisWeather:getDayPageWeather`
  - on-demand page helper, does not write tables
  - calls Weather.com current conditions for LFPG
  - calls Weather.com 5-day daily forecast for LFPG
  - calls Google Weather API hourly forecast for LFPG and derives hourly
    peak-hit timing
  - calls AviationWeather raw METAR history and derives today's NOAA max for
    LFPG in `Europe/Paris`

On-demand external endpoints used by `parisWeather:getDayPageWeather`:

- Weather.com current:
  - `https://api.weather.com/v3/wx/observations/current`
- Weather.com 5-day:
  - `https://api.weather.com/v3/wx/forecast/daily/5day`
- Google hourly peak timing:
  - `https://weather.googleapis.com/v1/forecast/hours:lookup`
- AviationWeather raw METAR history:
  - `https://aviationweather.gov/api/data/metar?ids=LFPG&format=raw&hours=48`

Crons:

- `paris_aeroweb_latest_window_minutes`
  - calls `aeroweb:pollLatestStationMetar`
  - runs at minute `29`, `30`, `31`, `58`, `59`, `00`, and `01`
  - this is the only scheduled AEROWEB poll path for Paris now, so the
    publish-race table reflects minute-window sampling rather than the older
    1-second watch
- `paris_tgftp_publish_race_every_minute`
  - calls `aeroweb:pollLatestNoaaPublishRace`
