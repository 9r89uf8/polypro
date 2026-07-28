# Seoul RKSI live-temperature page

This document describes the focused RKSI 15L temperature and daily-high
prediction view, plus the collectors that feed it.

## Routes

### `/seoul/today`

This stable entrypoint redirects server-side to `/seoul/day/[date]`, using the
current `Asia/Seoul` date.

### `/seoul/day/[date]`

Example: `/seoul/day/2026-07-27`.

The route is a single-purpose 15L daily-high tracker. Its dominant panel shows
the latest continuously revised prediction:

- predicted maximum temperature
- confidence interval
- most likely peak-time window in `Asia/Seoul`
- observed 15L maximum and its first occurrence so far
- current 15L temperature, expected temperature now, and deviation
- recent 30-minute warming rate
- an on-track/running-warm/running-cool/final status and plain-language reason
- prediction revision and update time

The prediction target is the maximum 0.1 °C temperature reported by the
representative RKSI `rwyNo=2`, `rwyDir=15L` AMOS row during that Seoul-local
calendar date. It is an airport prediction, not a central-Seoul city
temperature prediction.

Below the prediction is one full-day chart with two observed series:

- `Actual METAR`
  - parsed RKSI temperature from the NOAA `tgftp` latest-METAR file
  - normally one report every 30 minutes
  - white line with prominent report markers
- `AMOS · 1 minute`
  - representative row `rwyNo=2`, `rwyDir=15L`
  - captured by the AMOS minute-rollover watcher
  - cyan high-resolution line
  - silently uses a five-minute audit snapshot only when the matching
    one-minute timestamp is missing

The chart adds one forecast dataset, `15L high forecast`. It is the hourly curve
from the latest prediction and is drawn as a clearly distinct amber dashed
line. It does not add a five-minute AMOS series.

The x-axis is a complete `00:00–23:59` Seoul local day. The current Seoul minute
is marked when the selected date is today. A date-specific orange sunset line
and `SUNSET · h:mm` label use RKSI's coordinates (`37.4602`, `126.4407`) and the
standard official-sunset zenith, so historical and future dates do not depend
on a forecast-provider response.

Peak timing has two deliberately separate visual references:

- the current prediction's amber peak-window band comes from the latest hourly
  ensemble curve and therefore remains the condition-aware timing estimate;
- a violet historical reference shows the median first occurrence of the daily
  15L maximum at `13:44 KST`, with a low-opacity middle-50% band from
  `12:20–14:39 KST`.

The historical reference is a fixed, versioned snapshot of 130 complete 15L
days from `2026-03-20` through `2026-07-27`. Its circular clock-time average was
`13:39 KST`. It is labeled as a spring–summer empirical reference rather than a
condition-matched forecast because the archive does not yet cover every season
and does not contain comparable historical forecast inputs for cloud, wind,
and precipitation. The chart header repeats the historical median and sunset
time even when those parts of the 2,400-pixel timeline are outside the current
horizontal scroll position. The x-axis has a label every hour so the full-day
series remain legible. Y-axis labels retain one decimal place, matching the
AMOS sensor resolution instead of rounding several fractional ticks to the
same whole degree.

The rest of the interface is deliberately compact:

- RKSI/live status and Seoul clock
- previous day, next day, date picker, and today navigation
- Celsius/Fahrenheit toggle
- manual live-source and prediction synchronization
- one status card per plotted series
- capture-second or audit-fallback status for the newest displayed AMOS row
- compact horizontally scrollable provider signals and immutable prediction
  revision history when those records are available

The previous correlation, publish-race, raw-METAR, and raw-observation panels
are no longer part of the primary Seoul page.

## Prediction dashboard behavior

The page subscribes to
`seoulWeather:getHighPredictionDashboard({ date })`. Its main UI contract is:

- `latestPrediction`: the current prediction and hourly forecast curve
- `revisions`: immutable earlier predictions for the selected date
- `summary`: observed-day aggregates
- `evaluation`: current/final forecast evaluation
- `latestForecastCapture`: the most recent provider capture and provider health
- `accuracy`: finalized accuracy fields when the day is complete

The UI treats every part of the dashboard as optional. While the query is
loading it shows a prediction skeleton. A date with no prediction gets an
explicit empty state instead of fabricated values. An unavailable provider does
not hide the ensemble prediction; its provider signal is marked unavailable
when the backend returns that state.

The predicted maximum must never be below the observed 15L maximum already
stored for the day. The displayed status and reason explain whether the live
temperature remains near the expected hourly curve or has caused a revision.
Historical revisions remain visible and are never overwritten by the latest
forecast.

When a completed date has an evaluation, the panel switches to `Final` while
preserving the last stored value as the **closing tracker estimate**. It shows
that estimate beside the actual 15L high, closing error, closing peak-window
result, observation count, and revision count. The closing estimate has already
absorbed live observations through the day, so its error is not presented as
independent forecast skill. The backend separately scores the latest immutable
prediction available at 09:00, 12:00, and 15:00 KST; each checkpoint records
temperature error and whether its predicted peak window contained the actual
first occurrence of the maximum.

## Client behavior

The page subscribes to `seoul:getDayStationRows`, so chart data updates
reactively after the collectors write to Convex.

For the current Seoul date, the first page load and `Sync now` first request:

- `seoul:pollLatestNoaaStationMetar`
- `seoul:pollLatestAmosTemperatureSites`

After both observation requests settle, the page calls
`seoulWeather:recomputeTodayHighPrediction({ date })`. Recalculation is still
attempted if one live observation source is temporarily unavailable, and the
status message reports partial failures. The manual AMOS request is a single
immediate fetch. The scheduled rollover watch remains the lowest-latency path.

Historical routes only display already-captured rows. There is no historical
backfill from these latest-value endpoints, and the historical page does not
trigger recomputation.

## Prediction collectors

- `seoul_forecast_capture_hourly` runs at minute `:02` and stores independent
  Weather.com, Google Weather, and Open-Meteo results and errors. A usable
  provider capture can remain an explicit fallback for at most twelve hours.
- `seoul_15l_high_prediction_every_5_min` recomputes the Seoul-local current
  date. Material changes create immutable revisions; no-op runs retain the
  preceding revision, with a 30-minute heartbeat.
- `seoul_15l_high_finalize_after_midnight` runs at `00:10 KST` and freezes the
  previous day's canonical truth, closing tracker result, and fixed-cutoff
  scores.

The current AMOS value affects live bias only while it is at most ten minutes
old. The observed maximum remains valid even when the newest observation is
stale, and the predicted high is never allowed below that known maximum.

## Truthful cadence separation

`seoulAmosObservations.collectionCadence` records which collector produced a
row:

- `one_minute`
- `five_minute`

Cadence is part of the new
`by_station_date_ts_rwy_cadence` identity index. This intentionally permits a
one-minute and a five-minute capture for the same sensor timestamp to coexist.
The five-minute capture is a separate poll of the same upstream minute value,
not an average or independent temperature product, so it is not presented as a
separate chart series.

Rows stored before cadence tagging remain valid because the schema field is
optional. The displayed AMOS line starts with legacy/five-minute audit rows and
then replaces every matching timestamp with its one-minute capture:

- normal live coverage therefore shows only the one-minute observations
- a five-minute or legacy row appears only where no one-minute row exists
- fallback points are identified as audit fallbacks in the tooltip

## Fast one-minute AMOS collector

Source:

```text
https://global.amo.go.kr/mobileApi/global_api/v1/amos_info.do?air_code=RKSI
```

The source publishes one new observation minute around second `:14–:16`; it
does not provide a push stream.

`seoul_amos_temperature_sites_every_minute` invokes the internal
`seoul:scheduleLatestAmosTemperatureSites` mutation. The mutation schedules
`seoul:captureLatestAmosTemperatureMinute` for second `:12` of the next minute.

The internal action:

1. receives the expected observation-minute timestamp;
2. sends sequential requests no more often than once per second;
3. uses a three-second timeout for each request;
4. accepts freshness when the representative 15L `obsTimeUtc` reaches the
   expected minute, even if temperature did not change;
5. stops immediately and performs one idempotent batch upsert for 15L and 16L;
6. stops after eight attempts if the source remains stale or unavailable.

A measured rollover became fresh on the third request at `:14.753`, about five
seconds earlier than the former fixed `:20` fetch.

The production cron subsequently stored the 11:50 KST one-minute row at
`:16.410`. This includes scheduler and Convex mutation latency, while still
beating the former fixed request time. The following 11:51 row arrived at
`:15.412`, confirming consecutive automatic captures.

## Five-minute AMOS collector

`seoul_amos_runways_every_5_min` invokes
`seoul:pollLatestAmosRunways`.

It stores all display rows with `collectionCadence="five_minute"`. The chart
does not plot these snapshots as a separate series. Its exact representative
`rwyNo=2`, `rwyDir=15L` row can fill a missing timestamp in the single AMOS
line, while the remaining runway-shaped records are retained for auditing.

Production verification stored separate `one_minute` and `five_minute` rows for
the same 11:50 KST sensor timestamp with the same temperature.

## Actual METAR collector

Source:

```text
https://tgftp.nws.noaa.gov/data/observations/metar/stations/RKSI.TXT
```

`seoul_noaa_metar_every_minute` invokes
`seoul:pollLatestNoaaStationMetar`. The action:

- parses the current NOAA RKSI METAR temperature;
- upserts it into `seoulMetarObservations`;
- recomputes the local-day summary;
- continues recording NOAA first-seen timing in `seoulPublishRaceReports`.

This replaces the chart's dependency on the retired AMO latest-METAR endpoint.
METAR is still the official coded comparison, not the fastest current
temperature.

## Data model

### `seoulMetarObservations`

One row per `(stationIcao, date, obsTimeUtc)` with report type, parsed
temperature, raw METAR, source, and ingest metadata.

### `seoulDailySummaries`

One row per station/date with latest, minimum, and maximum METAR fields.

### `seoulAmosObservations`

One row per station/date/observation time/runway/direction/cadence. It preserves
temperature, dew point, QNH, wind, visibility, precipitation, runway metadata,
raw JSON, and the collection cadence.

### `seoulAmosDailySummaries`

One representative-15L row per station/date with observation counts, latest
temperature, and the day's minimum and maximum temperature and occurrence
times.

### `seoulForecastCaptures`

Immutable multi-provider forecast captures. Weather.com contributes a daily
high while Google Weather and Open-Meteo can contribute hourly curves. Provider
status and error text are stored independently so a missing key or failed
provider does not discard the usable inputs.

### `seoulHighPredictions`

Immutable, numbered prediction revisions containing the predicted high,
confidence interval, peak window, live-curve bias and warming rates, provider
details, status/reason, and hourly ensemble curve.

### `seoulHighEvaluations`

Finalized actual high, peak time, revision count, lifecycle opening/closing
tracker diagnostics, and honest 09:00/12:00/15:00 KST checkpoint temperature
and peak-window scores.

### `seoulPublishRaceReports`

Historical AMO/NOAA first-seen timing. It remains available in Convex even
though the redesigned page no longer renders the diagnostic table.

## Operational notes

- The mobile AMOS URL is publicly reachable without authentication but is an
  undocumented application endpoint. It has no published rate-limit or
  stability contract.
- Access is server-side because the response does not advertise a cross-origin
  browser contract.
- The 15L label is the feed's representative row designation; it should not be
  described as proof that the physical thermometer is at the 15L threshold.
- The old `http://amoapi.kma.go.kr/amoApi/metar` service was retired on
  2026-07-20 and is not used by the live chart collector.
- Research and source comparisons are in [seoul.md](./seoul.md).
