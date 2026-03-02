# KORD Forecast Map

This document covers the 3-day regional forecast route and its AccuWeather + METAR comparison workflow.

## Route

- `/kord/forecast` (`app/kord/forecast/page.js`)
  - Displays 5 locations: O'Hare + 4 nearby suburbs.
  - Provides day toggles (`1 day`, `2 days`, `3 days`).
  - Provides `Generate 3-Day JSON` button for LLM-ready output (no METAR fields).
  - JSON output includes:
    - Primary location: Chicago O'Hare Airport (`role: "primary"`).
    - Support locations: 4 suburbs (`role: "support"`).
    - For each of 3 days:
      - Day forecast (high/low + peak timing window/duration).
      - Hourly forecast array (`epochMs`, local datetime label, `tempF`).
  - Provides `Copy JSON` when the JSON panel is open.
  - Shows a clickable position-based map using stored lat/lon per location.
  - Shows current temperature (`Now`) on each marker.
  - Shows a selected-day side table (high, peak window, peak duration).
  - Shows a selected-day side table `Now` column for quick cross-location current comparisons.
  - Shows a location detail panel with an hourly sparkline plus full current conditions.
  - Shows a location-level `Forecast Change Tracker` table for daily highs:
    - Latest daily high vs first daily snapshot captured today.
    - Latest daily high vs first-ever snapshot captured for that forecast date.
    - Signed delta (`+/- °F`) so small forecast shifts (for example `+1°F`, `-2°F`) are visible.
  - Shows an O'Hare verification card using `dailyComparisons` observed METAR fields.
  - Shows an O'Hare daily table comparing:
    - NOAA official observed high (`metarMaxF`, the same "Official Max" shown on `/kord/day/[date]`)
    - AccuWeather observed high built from current-conditions snapshots (`accuObservedMaxF`)
    - Delta by day (`AccuWeather - NOAA`)

## Data Sources

- Forecast source: AccuWeather API
  - Current conditions endpoint: `/currentconditions/v1/{locationKey}` (`details=true`)
  - Daily endpoint: `/forecasts/v1/daily/5day/{locationKey}` (`metric=false`)
  - Hourly endpoint: `/forecasts/v1/hourly/120hour/{locationKey}` (`metric=false`)
  - Fallback hourly endpoint (when 120h plan access is unavailable): `/forecasts/v1/hourly/72hour/{locationKey}`
  - Location details endpoint: `/locations/v1/{locationKey}`
- Truth source for O'Hare verification:
  - `dailyComparisons.metarMaxF`, `metarMaxAtUtc` (official hourly reports)

Note: the 3-day JSON export intentionally excludes all METAR/NOAA truth fields and only uses AccuWeather-derived forecast data.

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
    - Returns per-location daily-high change rows derived from `forecastSnapshots` `daily5day` payload history.

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
- `forecastObservedDailyHighs`
  - Per-location per-day maximum temperature derived from current-conditions snapshots.
- `forecastRuns`
  - Last run status/error + endpoint fetch/skip counts.
- `dailyComparisons` new fields for O'Hare forecast verification:
  - `accuHighF_latest`, `accuLowF_latest`
  - `accuPeakStartUtc_latest`, `accuPeakEndUtc_latest`
  - `accuPeakStartLocal_latest`, `accuPeakEndLocal_latest`
  - `accuPeakDurationMinutes_latest`, `accuSnapshotAtUtc_latest`
  - `errRawF`, `errRoundedF`
  - `accuObservedMaxC`, `accuObservedMaxF`
  - `accuObservedMaxAtUtc`, `accuObservedMaxAtLocal`
  - `accuObservedObsCount`
  - `errObservedRawF`, `errObservedRoundedF`
  - `peakHit`, `peakTimingDeltaMinutes`

## Environment

- Requires `ACCUWEATHER_API_KEY` in Convex environment.
- If missing, refresh returns an explicit error status and dashboard shows no new forecast snapshots.
