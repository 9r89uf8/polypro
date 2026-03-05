# KORD Forecast + Current Temperature

This document covers how O'Hare forecast and current-temperature data flows work for `/kord/forecast-snapshots`.

## Purpose

- Store hourly forecast snapshots for KORD.
- Show the latest Microsoft, AccuWeather, and Google 5-day forecasts on one page.
- Show current temperatures from Microsoft, AccuWeather, Google, NOAA, IEM, and Open-Meteo.
- Show NOAA official max temperature for Chicago today using the same official-max path used on `/kord/day/[date]`.

## Route and UI

- Route: `/kord/forecast-snapshots` (`app/kord/forecast-snapshots/page.js`)
- Uses:
  - `forecastCollector:getRecentSnapshots` for snapshot history and latest snapshot.
  - `forecastCollector:collectKordHourlySnapshot` for manual "Collect Now".
  - `weather:getDayObservations` (today's date, Chicago timezone) for NOAA official max table.
- Sections:
  - `Latest Snapshot`: capture time, overall status, Microsoft status, AccuWeather status, Google status, source health counts.
  - `Current Temperature Sources`: latest Microsoft + AccuWeather + Google current readings.
  - `Latest NOAA METAR Max (Official Max Today)`: `metarMaxF` and related official fields from `dailyComparisons`.
  - `Microsoft 5-Day Forecast`: latest `microsoftForecastDays` (displayed columns: date, max F, day phrase, night phrase).
  - `AccuWeather 5-Day Forecast`: latest `accuweatherForecastDays` (displayed columns: date, max F, day phrase, night phrase).
  - `Google 5-Day Forecast`: latest `googleForecastDays` (displayed columns: date, max F, day phrase, night phrase).
  - `Recent Hourly History`: per-snapshot status + provider statuses + current readings for Microsoft/AccuWeather/Google/NOAA/IEM/Open-Meteo.

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
  - Computes row status:
    - `ok`: Microsoft + AccuWeather + Google forecasts succeeded and all current sources succeeded.
    - `partial`: any forecast provider failed or any current source failed.
    - `error`: all three forecast providers failed and all current sources failed.

- Query: `forecastCollector:getRecentSnapshots`
  - Returns latest-first rows for a station.

- Internal mutation: `forecastCollector:insertSnapshot`
  - Inserts normalized snapshot payload into storage.

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
- Forecast payload:
  - `microsoftForecastDays[]` (date, min/max temps, phrases)
  - `accuweatherForecastDays[]` (same normalized shape, optional for backward compatibility)
  - `accuweatherLocationKey` (optional)
  - `googleForecastDays[]` (same normalized shape, optional for backward compatibility)
- Current payload:
  - `actualReadings[]` (source, status, observed time, tempF/tempC, raw/error)
  - Includes `microsoft_current`, `accuweather_current`, `google_weather_current`, `noaa_latest_metar`, `iem_asos_latest`, `open_meteo_current`.
- Index:
  - `by_station_capturedAt` (`stationIcao`, `capturedAt`)

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

Optional for AccuWeather location-key pinning:

- `ACCUWEATHER_LOCATION_KEY`
- `ACCUWEATHER_LOCATION_KEY_KORD`

Without a provider key, snapshot rows are still written, but that provider is error-marked.

## Change Guidance

Update this document when changing any of:

- `/kord/forecast-snapshots` UI structure or table semantics.
- `convex/forecastCollector.js` source endpoints, parse logic, status logic, or payload shape.
- `kordForecastSnapshots` schema fields/indexes.
- `kord_microsoft_5day_hourly` cron schedule or args.
- Provider strategy, provider auth flow, or location-key handling.
