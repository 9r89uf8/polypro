# KORD Forecast Map

This document covers the 3-day regional forecast route and its AccuWeather + METAR comparison workflow.

## Route

- `/kord/forecast` (`app/kord/forecast/page.js`)
  - Displays 5 locations: O'Hare + 4 nearby suburbs.
  - Provides day toggles (`1 day`, `2 days`, `3 days`).
  - Shows a clickable position-based map using stored lat/lon per location.
  - Shows current temperature (`Now`) on each marker.
  - Shows a selected-day side table (high, peak window, peak duration).
  - Shows a selected-day side table `Now` column for quick cross-location current comparisons.
  - Shows a location detail panel with an hourly sparkline plus full current conditions.
  - Shows an O'Hare verification card using `dailyComparisons` observed METAR fields.

## Data Sources

- Forecast source: AccuWeather API
  - Current conditions endpoint: `/currentconditions/v1/{locationKey}` (`details=true`)
  - Daily endpoint: `/forecasts/v1/daily/5day/{locationKey}` (`metric=false`)
  - Hourly endpoint: `/forecasts/v1/hourly/120hour/{locationKey}` (`metric=false`)
  - Fallback hourly endpoint (when 120h plan access is unavailable): `/forecasts/v1/hourly/72hour/{locationKey}`
  - Location details endpoint: `/locations/v1/{locationKey}`
- Truth source for O'Hare verification:
  - `dailyComparisons.metarAllMaxF`, `metarAllMaxAtUtc`, `metarMaxAtUtc`

## Backend Module

- `convex/forecast.js`
  - `forecast:refreshForecastNow` (action)
    - Refreshes all configured locations.
    - Uses `Expires` cache headers to skip endpoint calls when still fresh.
    - Fetches/stores latest current conditions per location.
    - Falls back from 120-hour hourly to 72-hour hourly when 120-hour access is not available for the API key.
    - Stores endpoint payload snapshots for history.
    - Derives 3-day summaries (high/low, peak window, duration, hourly points).
    - Updates O'Hare comparison fields in `dailyComparisons`.
  - `forecast:getForecastDashboard` (query)
    - Returns active locations, 3-day summaries, run status, and O'Hare comparison rows.

## Scheduler

- `convex/crons.js`
  - `kord_accuweather_forecast_every_20_min`
    - Cron: `*/20 * * * *`
    - Action: `api.forecast.refreshForecastNow`
    - Args: `{ withJitter: true }`

## Schema Additions

- `forecastSnapshots`
  - Raw endpoint payload history + freshness metadata (`Date`/`Expires`).
- `forecastDailySummaries`
  - Derived per-location day rows used directly by `/kord/forecast`.
- `forecastCurrentConditions`
  - Latest current conditions row per location for map/table/detail rendering.
- `forecastRuns`
  - Last run status/error + endpoint fetch/skip counts.
- `dailyComparisons` new fields for O'Hare forecast verification:
  - `accuHighF_latest`, `accuLowF_latest`
  - `accuPeakStartUtc_latest`, `accuPeakEndUtc_latest`
  - `accuPeakStartLocal_latest`, `accuPeakEndLocal_latest`
  - `accuPeakDurationMinutes_latest`, `accuSnapshotAtUtc_latest`
  - `errRawF`, `errRoundedF`
  - `peakHit`, `peakTimingDeltaMinutes`

## Environment

- Requires `ACCUWEATHER_API_KEY` in Convex environment.
- If missing, refresh returns an explicit error status and dashboard shows no new forecast snapshots.
