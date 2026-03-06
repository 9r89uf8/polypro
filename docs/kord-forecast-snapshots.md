# KORD Forecast + Current Temperature

This document covers how O'Hare forecast and current-temperature data flows work for `/kord/forecast-snapshots`.

## Purpose

- Store hourly forecast snapshots for KORD.
- Store query-friendly per-provider, per-target-date forecast points for trend charts.
- Show the latest Microsoft, AccuWeather, Google, and Weather.com 5-day forecasts on one page.
- Show current temperatures from Microsoft, AccuWeather, Google, Weather.com, NOAA, IEM, and Open-Meteo.
- Show NOAA official max temperature for Chicago today using the same official-max path used on `/kord/day/[date]`.

## Route and UI

- Route: `/kord/forecast-snapshots` (`app/kord/forecast-snapshots/page.js`)
- Uses:
  - `forecastCollector:getRecentSnapshots` for snapshot history and latest snapshot.
  - `forecastCollector:collectKordHourlySnapshot` for manual "Collect Now".
  - `forecastCollector:backfillKordForecastPredictions` for one-time indexing of existing snapshots into trend rows.
  - `forecastCollector:getForecastTrend` for provider/date progression charts.
  - `weather:getDayObservations` (today's date, Chicago timezone) for NOAA official max table.
- Sections:
  - `Latest Snapshot`: capture time, overall status, Microsoft status, AccuWeather status, Google status, Weather.com status, source health counts.
  - `Forecast Progression`: provider selector, target-date picker, quick date chips from the latest forecast, summary cards, a stepped line chart of predicted high temperature over capture time, and a per-capture delta table.
  - `Current Temperature Sources`: latest Microsoft + AccuWeather + Google + Weather.com current readings.
  - `Latest NOAA METAR Max (Official Max Today)`: `metarMaxF` and related official fields from `dailyComparisons`.
  - `Microsoft 5-Day Forecast`: latest `microsoftForecastDays` (displayed columns: date, max F, day phrase, night phrase).
  - `AccuWeather 5-Day Forecast`: latest `accuweatherForecastDays` (displayed columns: date, max F, day phrase, night phrase).
  - `Google 5-Day Forecast`: latest `googleForecastDays` (displayed columns: date, max F, day phrase, night phrase).
  - `Weather.com 5-Day Forecast`: latest `weathercomForecastDays` (displayed columns: date, max F, day phrase, night phrase).
  - `Recent Hourly History`: per-snapshot status + provider statuses + current readings for Microsoft/AccuWeather/Google/Weather.com/NOAA/IEM/Open-Meteo.

All displayed local timestamps are in America/Chicago and shown in 12-hour AM/PM format.

## Backend Collector

Defined in `convex/forecastCollector.js`.

- Action: `forecastCollector:collectKordHourlySnapshot`
  - Default station: `KORD`.
  - Default forecast duration: `5` days.
  - Fetches in parallel:
    - Microsoft daily forecast (Azure Maps):
      - `https://atlas.microsoft.com/weather/forecast/daily/json`
    - Microsoft current conditions (Azure Maps):
      - `https://atlas.microsoft.com/weather/currentConditions/json`
    - AccuWeather geoposition lookup (lat/lon to location key):
      - `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search`
    - AccuWeather 5-day daily forecast:
      - `https://dataservice.accuweather.com/forecasts/v1/daily/5day/{locationKey}`
    - AccuWeather current conditions:
      - `https://dataservice.accuweather.com/currentconditions/v1/{locationKey}`
    - Google current conditions:
      - `https://weather.googleapis.com/v1/currentConditions:lookup`
    - Google daily forecast:
      - `https://weather.googleapis.com/v1/forecast/days:lookup`
    - Weather.com tenday page crawl (place-id source):
      - `https://weather.com/weather/tenday/l/{placeId}`
    - Weather.com location point:
      - `https://api.weather.com/v3/location/point`
    - Weather.com daily forecast:
      - `https://api.weather.com/v3/wx/forecast/daily/10day`
    - Weather.com current conditions:
      - `https://api.weather.com/v3/wx/observations/current`
    - NOAA latest METAR:
      - `https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT`
    - IEM ASOS latest recent rows:
      - `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py`
    - Open-Meteo current:
      - `https://api.open-meteo.com/v1/forecast`
  - AccuWeather key behavior:
    - Uses `Authorization: Bearer` by default.
    - Falls back to `apikey` query auth if auth-header request returns 401/403.
    - Uses in-memory 24-hour location key cache by station/language.
    - Optional env override supports fixed keys (`ACCUWEATHER_LOCATION_KEY` or station-specific `ACCUWEATHER_LOCATION_KEY_KORD`).
  - Writes one snapshot row to `kordForecastSnapshots`.
  - Also expands that snapshot into normalized `kordForecastPredictions` rows:
    - one row per provider per target date in the captured forecast arrays.
    - each row stores `provider`, `targetDate`, `capturedAt`, `captureDate`, `leadDays`, min/max temps, phrases, and `snapshotId`.
  - Computes row status:
    - `ok`: Microsoft + AccuWeather + Google + Weather.com forecasts succeeded and all current sources succeeded.
    - `partial`: any forecast provider failed or any current source failed.
    - `error`: all four forecast providers failed and all current sources failed.

- Query: `forecastCollector:getRecentSnapshots`
  - Returns latest-first rows for a station.

- Query: `forecastCollector:getForecastTrend`
  - Inputs: `stationIcao`, `provider`, `targetDate`.
  - Reads normalized rows from `kordForecastPredictions`.
  - Returns ascending capture-time rows with derived `deltaMaxF` and `changeDirection` (`initial` | `up` | `down` | `same`) so the page can render a stepped progression chart and change table.

- Internal mutation: `forecastCollector:insertSnapshot`
  - Inserts normalized snapshot payload into storage.
  - Dual-writes normalized trend rows into `kordForecastPredictions`.

- Action: `forecastCollector:backfillKordForecastPredictions`
  - Calls an internal mutation that scans recent `kordForecastSnapshots` rows and inserts missing `kordForecastPredictions` children.
  - Intended for one-time indexing after deploying the normalized trend table.
  - The page button currently backfills the latest 720 snapshots.

## Scheduler

Defined in `convex/crons.js`.

- Cron: `kord_microsoft_5day_hourly`
  - Expression: `0 * * * *` (top of each hour, UTC-based cron schedule).
  - Calls `api.forecastCollector.collectKordHourlySnapshot` with:
    - `stationIcao: "KORD"`
    - `durationDays: 5`
    - `unit: "imperial"`
    - `language: "en-US"`

Manual refresh can also be triggered at any time from the page button (`Collect Now`).

## Data Model

Table: `kordForecastSnapshots` (`convex/schema.js`)

- Identity/context:
  - `stationIcao`, `stationName`, `capturedAt`, `capturedAtLocal`
- Forecast request:
  - `durationDays`, `unit`, `language`
- Snapshot health:
  - `status` (`ok` | `partial` | `error`)
  - `microsoftStatus` (`ok` | `error`)
  - `microsoftError` (optional)
  - `accuweatherStatus` (optional `ok` | `error`)
  - `accuweatherError` (optional)
  - `googleStatus` (optional `ok` | `error`)
  - `googleError` (optional)
  - `weathercomStatus` (optional `ok` | `error`)
  - `weathercomError` (optional)
- Forecast payload:
  - `microsoftForecastDays[]` (date, min/max temps, phrases)
  - `accuweatherForecastDays[]` (same normalized shape, optional for backward compatibility)
  - `accuweatherLocationKey` (optional)
  - `googleForecastDays[]` (same normalized shape, optional for backward compatibility)
  - `weathercomForecastDays[]` (same normalized shape, optional for backward compatibility)
- Current payload:
  - `actualReadings[]` (source, status, observed time, tempF/tempC, raw/error)
  - Includes `microsoft_current`, `accuweather_current`, `google_weather_current`, `weathercom_current`, `noaa_latest_metar`, `iem_asos_latest`, `open_meteo_current`.
- Index:
  - `by_station_capturedAt` (`stationIcao`, `capturedAt`)

Table: `kordForecastPredictions` (`convex/schema.js`)

- Fields:
  - `stationIcao`
  - `provider` (`microsoft` | `accuweather` | `google` | `weathercom`)
  - `targetDate` (forecasted Chicago date, `YYYY-MM-DD`)
  - `capturedAt`, `capturedAtLocal`
  - `captureDate` (Chicago date of the snapshot fetch)
  - `leadDays` (`targetDate - captureDate`)
  - `minTempC`, `minTempF`, `maxTempC`, `maxTempF`
  - `dayPhrase`, `nightPhrase`
  - `snapshotId` (parent `kordForecastSnapshots` row)
- Indexes:
  - `by_station_provider_target_capturedAt` (`stationIcao`, `provider`, `targetDate`, `capturedAt`)
  - `by_snapshotId` (`snapshotId`)

## NOAA Official Max Path (Shared with Day Page)

The NOAA max table on `/kord/forecast-snapshots` does not compute maxima itself.
It reads official aggregate fields produced by the METAR ingest pipeline:

- Query: `weather:getDayObservations`
- Table field source: `dailyComparisons`
  - `metarMaxF`
  - `metarMaxAtLocal`
  - `metarObsCount`
  - `metarMaxSource`
  - `metarMaxRaw`

This is the same official-max source shown as "Official Max" on `/kord/day/[date]`.

## Environment

Required for Microsoft calls:

- `AZURE_MAPS_SUBSCRIPTION_KEY`
  - or `MICROSOFT_WEATHER_SUBSCRIPTION_KEY` (fallback variable name)

Required for AccuWeather calls:

- `ACCUWEATHER_API_KEY`

Required for Google calls:

- `GOOGLE_WEATHER_API_KEY`

Optional override for Weather.com internal API key used by the page-crawl bridge:

- `WEATHERCOM_API_KEY`
  - If unset, collector falls back to an embedded Weather.com public client key observed on the site.

Optional for AccuWeather location-key pinning:

- `ACCUWEATHER_LOCATION_KEY`
- `ACCUWEATHER_LOCATION_KEY_KORD`

Without an explicit provider key, snapshot rows are still written; providers that fail auth/upstream are error-marked.

## Weather.com Key Discovery (Reproducible)

The Weather.com fallback key was obtained from Weather.com’s own shipped frontend bundles (not from a private account key).

Steps used:

1. Fetch the KORD tenday page HTML:
   - `curl -sS 'https://weather.com/weather/tenday/l/5473f6c4da1a6479bbeaa444d174bea30ba2252fbbb29ec330b761a58a55287b'`
2. Extract `_next/static/chunks/...` JS bundle URLs from that HTML.
3. Download those chunk files and search for `api.weather.com` + `apiKey` strings.
4. Locate Weather API URL-builder code in a chunk that defines:
   - `/v3/location/point`
   - `/v3/wx/forecast/daily/{duration}`
   - `/v3/wx/observations/current`
   - with an inline `apiKey` value.
5. Verify by live request checks against KORD:
   - `v3/location/point` with `placeid=5473...`
   - `v3/wx/forecast/daily/10day` with resolved geocode
   - `v3/wx/observations/current` with the same geocode

Notes:

- This is a frontend client key path and can rotate or be blocked.
- `WEATHERCOM_API_KEY` env override exists so we can replace the fallback quickly without code changes.

## Change Guidance

Update this document when changing any of:

- `/kord/forecast-snapshots` UI structure or table semantics.
- `convex/forecastCollector.js` source endpoints, parse logic, status logic, or payload shape.
- `kordForecastSnapshots` or `kordForecastPredictions` schema fields/indexes.
- `kord_microsoft_5day_hourly` cron schedule or args.
- Provider strategy, provider auth flow, or location-key handling.
