# Paris LFPG Pages

Verified against the in-repo implementation on March 17, 2026.

## `/paris/today`

- Server-side redirect to `/paris/day/[date]` where `[date]` is the current
  `Europe/Paris` date.

## `/paris/day/[date]`

Example route: `/paris/day/2026-03-16`

Purpose:

- show the LFPG METAR day chart with NOAA `tgftp` as the default background
  source and manual AEROWEB official fetches when needed sooner
- show current Paris-airport temperature and daily/hourly forecast context from
  Météo-France
- show forecast-history progression for stored Météo-France daily predictions
- show today's NOAA METAR max for LFPG from AviationWeather raw METAR history

Main page behavior:

- Uses `aeroweb:getDayStationRows` to load stored LFPG rows and the daily
  summary.
- Uses `parisWeather:getMeteoFranceObservations` to load stored CDG DPObs
  6-minute AWS rows for the selected Paris date.
- Uses `parisWeather:getMeteoFranceHourlyForecasts` to load stored
  Météo-France hourly forecast rows for the selected Paris date.
- Uses `parisWeather:getForecastTrend` to load immutable Météo-France daily
  forecast prediction history for the selected Paris date.
- Uses `parisWeather:getDayPageWeather` to load on-demand sidecar data for the
  page:
  - Météo-France mobile daily forecast for the forecast table
  - today's NOAA/AviationWeather LFPG METAR max from a raw METAR pull
- If the selected date equals the current `Europe/Paris` date:
  - runs `aeroweb:pollLatestNoaaStationMetar` on first load
  - `Refresh Default Data` re-runs the NOAA latest ingest, stores a fresh
    Météo-France DPObs observation, stores a fresh Météo-France forecast
    snapshot, and reloads the on-demand sidecar data
  - `Fetch Official Now` runs `aeroweb:pollLatestStationMetar` on demand to
    upgrade the current LFPG observation from authenticated AEROWEB
- If the selected date is not today:
  - no authenticated history backfill is attempted
  - the page only shows rows already captured live and stored earlier
- the page no longer shows the Paris publish-race table because the observed
  LFPG result was stable and decisive: AEROWEB was consistently about 4 to 5
  minutes earlier than NOAA
- instead, the page shows a `Typical Availability` card with the usual LFPG
  routine timing:
  - AEROWEB around `:58` and `:29`
  - NOAA around `:03` and `:33`
- peak-time cells are only populated when the selected forecast day is inside
  the currently stored Météo-France hourly forecast window; later 15-day rows
  keep the Météo-France daily max/min forecast but show no hit time
- when consecutive hourly rows share the same daily high, the page shows a
  start-to-end peak window such as `3:00 PM to 5:00 PM`; an isolated single
  peak hour still shows one time
- the page includes a `Forecast History` section that shows how Météo-France
  changed the predicted high for the selected Paris date over successive stored
  captures
- on mobile, the `Temperature Line` chart can be swiped horizontally; the
  plotted width expands with LFPG data density instead of shrinking down to the
  viewport

Official source used today:

- `https://aviation.meteo.fr/showmessage.php?code=LFPG`

Supporting official pages also identified during the investigation:

- `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=LFPG`
- `https://aviation.meteo.fr/bulletin_maa.php?mode=html&codes=LFPG`

Current known limitation:

- there is no confirmed authenticated day-history endpoint wired for LFPG, so
  older dates depend on what the app already captured live

Convex tables:

- `parisMeteoFranceObservations`
  - one row per stored CDG DPObs observation
  - includes temperature, dewpoint, humidity, wind, pressure, visibility, and
    observation timestamps
- `parisMeteoFranceHourlyForecasts`
  - one row per stored Météo-France hourly forecast-validity timestamp
  - overwritten in place by `(stationIcao, date, forecastTimeUtc)` as newer
    fetches revise the same valid hour
- `parisForecastPredictions`
  - one immutable row per Météo-France daily forecast day per captured fetch
  - stores `targetDate`, `capturedAt`, `captureDate`, `leadDays`, min/max
    temps, and day phrase for forecast-history charts
- `aerowebMetarObservations`
  - one row per stored LFPG METAR/SPECI observation
  - includes parsed temperature, canonical raw METAR, source, and optional
    `aerowebFirstSeenAt`
  - default routine rows are normally inserted from NOAA `tgftp`
  - a manual official AEROWEB fetch can later patch the same timestamped row
    with authenticated-source metadata
- `aerowebDailySummaries`
  - one LFPG summary row per local `Europe/Paris` date
- `aerowebPublishRaceReports`
  - older first-seen timing rows for authenticated AEROWEB vs NOAA `tgftp`
  - retained so Paris race logic can be re-enabled later if needed

Convex functions:

- `aeroweb:pollLatestStationMetar`
  - logs in to `aviation.meteo.fr`
  - fetches `showmessage.php?code=LFPG`
  - stores the latest official METAR/SPECI row on demand
  - the Paris page now calls it with `recordPublishRace: false`, so the manual
    official button upgrades the stored LFPG row without appending new dormant
    race rows
- `aeroweb:pollLatestNoaaStationMetar`
  - samples `tgftp` for LFPG
  - stores the latest LFPG METAR/SPECI row as the default background source
  - does not write Paris publish-race rows
- `aeroweb:getDayStationRows`
  - returns stored LFPG rows plus the daily summary for the selected date
- `parisWeather:pollMeteoFranceObservation`
  - polls the authenticated DPObs 6-minute CDG observation endpoint
  - stores the latest Météo-France AWS row
- `parisWeather:pollMeteoFranceForecast`
  - polls the Météo-France mobile forecast endpoint
  - upserts stored hourly forecast rows for charting and peak detection
  - also writes immutable `parisForecastPredictions` rows for progression
    history
- `parisWeather:getMeteoFranceObservations`
  - returns stored Météo-France DPObs rows for the selected date
- `parisWeather:getMeteoFranceHourlyForecasts`
  - returns stored Météo-France hourly forecast rows for the selected date
- `parisWeather:getForecastTrend`
  - returns ascending stored daily-prediction captures for one target date,
    including per-capture deltas and official-max comparison fields
- `parisWeather:getDayPageWeather`
  - on-demand page helper, does not write tables
  - calls Météo-France mobile forecast for the daily forecast table
  - calls AviationWeather raw METAR history and derives today's NOAA max for
    LFPG in `Europe/Paris`

On-demand external endpoints used by Paris weather helpers:

- Météo-France mobile forecast:
  - `https://webservice.meteofrance.com/forecast?...`
- Météo-France DPObs 6-minute observation:
  - `https://public-api.meteofrance.fr/public/DPObs/v1/station/infrahoraire-6m?...`
- AviationWeather raw METAR history:
  - `https://aviationweather.gov/api/data/metar?ids=LFPG&format=raw&hours=48`

Crons:

- `paris_meteofrance_obs_every_10_min`
  - calls `parisWeather:pollMeteoFranceObservation`
  - runs every 10 minutes
- `paris_meteofrance_forecast_every_hour`
  - calls `parisWeather:pollMeteoFranceForecast`
  - runs at the top of each hour
- `paris_noaa_latest_every_minute`
  - calls `aeroweb:pollLatestNoaaStationMetar`
  - runs every minute
  - this is the normal LFPG background ingest path now

Current dormant code:

- the Paris AEROWEB vs NOAA publish-race tables and helper functions still
  exist in `convex/aeroweb.js`, but they are no longer part of the default page
  or scheduled LFPG background flow
