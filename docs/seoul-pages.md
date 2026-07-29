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
    one-minute timestamp has no usable temperature

The chart keeps the predictor's `15L high forecast` dataset. It is the hourly
ensemble curve from the latest prediction and is drawn as a clearly distinct
amber dashed line. Weather.com hourly guidance is an additional diagnostic
layer: `Weather.com · latest stored` is a blue dashed curve and the
capture-time-labeled morning baseline is a faint blue dotted curve. Material
per-hour revisions receive signed badges such as `↑ +1.0 °C`. The Weather.com
curves do not add a five-minute AMOS series and do not currently contribute to
the predictor's hourly ensemble. Both the daily and hourly Weather.com
collectors select the airport explicitly with `icaoCode=RKSI`; they do not use
a Seoul or Incheon city lookup.

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

The chart reserves a 24-cell `HOURLY SKY COVER` strip immediately above the
temperature plot. Meter height is the primary visual encoding, so a user can
compare past and coming hours without decoding aviation abbreviations:

- solid slate cells summarize completed-hour METAR observations;
- the current hour is clipped at the live `NOW` boundary: its elapsed observed
  portion uses an amber top edge and its not-yet-observed remainder stays
  hatched;
- diagonally patterned cyan cells show upcoming model cloud-cover percentages;
- missing or non-quantifiable hours stay hatched and explicitly say `NO DATA`,
  `NO LOW CLOUD`, `SKY HIDDEN`, `VARIABLE`, or `PARTIAL` rather than looking
  like clear sky.

For observed hours, each coded sky state is carried forward only until the next
METAR/SPECI, with a maximum hold of 45 minutes. The bounded intervals are
intersected with each KST hour. An estimate is shown only when at least 45
minutes of a completed hour have explicit, quantifiable coverage. The current
hour needs at least 15 represented minutes. Category midpoints are
duration-weighted and rounded to the nearest 10 percent, with an `≈` prefix.
Because ordinary METAR spacing can leave part of an hour unrepresented, the
result estimates the represented METAR sample rather than claiming continuous
whole-hour measurement. A value is never presented as exact unless the full
window is represented. The details table preserves the range implied by the
time-weighted METAR category bounds:

- `FEW`: greater than 0 through 25 percent;
- `SCT`: 38–50 percent;
- `BKN`: 63–88 percent;
- `OVC`: 100 percent;
- `SKC`: 0 percent.

`CAVOK`, `NSC`, `NCD`, and automated `CLR` do not prove zero total cloud
cover, while `VV` means the sky is obscured rather than a known percentage.
Those states therefore remain textual. AMOS `cld1`, `cld2`, and `cld3` are
detected layer bases without coverage amount and are not used.

Upcoming full-hour cells use `cloudCoverPct` from the same stored hourly
forecast input as the temperature curve. Google Weather's hourly `cloudCover`
already represents its one-hour interval. Open-Meteo requests instantaneous
hourly `cloud_cover`, which is available without the Google key; adjacent
hour-boundary values are averaged to estimate the matching forward-hour
interval. Available values use the same Google `0.35` and Open-Meteo `0.45`
provider weights as the temperature ensemble and retain `cloudProviderCount`.
The current hour's hourly guidance is not relabeled as a forecast for only the
remaining minutes.

The header repeats the latest observed-hour summary and next available
full forecast-hour percentage. `Jump to now` and a one-time initial scroll
position keep the observed/forecast boundary visible on the 2,400-pixel chart.
A collapsible semantic table lists all 24 hours, sources, values, ranges, and
data coverage; the same information is attached to the chart for screen
readers. METAR temperature tooltips retain the original sky/ceiling detail,
while ensemble forecast temperature tooltips include cloud-cover percentage.
Weather.com tooltips instead show the forecast-valid hour, the morning
baseline, the latest captured value and capture time, the signed revision, and
the matched AMOS temperature/departure when those values exist. A separate
collapsible semantic table exposes the same per-hour revision and departure
details without requiring pointer access to the canvas.

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

## Weather.com hourly revision diagnostics

Weather.com's daily maximum and hourly forecast are captured as separate
products with separate status and error fields. A successful daily response
does not hide a failed hourly response in the hourly diagnostics, and a
successful hourly response does not change the daily product's health.
The daily product uses `weathercomStatus`/`weathercomError`; the hourly product
uses `weathercomHourlyStatus`/`weathercomHourlyError` and
`weathercomHourlyRows`. The hourly product also records its own response
completion timestamp instead of borrowing the time from before the parallel
provider requests began. That provider-specific timestamp is the forecast
vintage used by revision and no-lookahead logic.
The hourly rows preserve both their forecast-valid timestamps and their
capture timestamps, so revisions can be reconstructed rather than overwriting
the preceding value.

For a selected Seoul-local date, the morning baseline is the first successful
Weather.com hourly capture from `05:00–07:00 KST`. If that capture is missing,
the latest successful capture from `03:00–05:00 KST` is an explicit fallback.
A capture outside that four-hour window is not mislabeled as a morning
baseline. The UI always shows the selected capture time and identifies the
pre-05:00 fallback. A baseline value is used only when its capture is strictly
earlier than the forecast-valid hour. The latest curve uses the newest
successful stored value for each forecast-valid hour. A revision is the
difference from that hour's preceding distinct stored prediction; unchanged
captures do not create a change badge.

The hourly collector runs only at minute `:02`, so the UI describes the capture
where a change first appeared as **first detected**. It must not claim that
Weather.com published the revision at that exact time; the upstream change
could have happened at any point since the preceding successful capture.

Observed-departure scoring deliberately prevents lookahead:

- for an already observed forecast-valid hour, the comparison forecast is the
  latest successful capture whose capture time is strictly before that hour;
- an `08:02` capture can therefore never be used to score the `08:00`
  observation;
- the representative `15L` AMOS observation must be within ±5 minutes of the
  forecast-valid time, otherwise that hour remains unmatched;
- departure is `actual AMOS temperature - Weather.com forecast temperature`.

The Weather.com running signal uses the median of the latest three matched
hourly departures. It requires at least two matched hours. A median of
`+0.5 °C` or warmer is labeled running warm, `-0.5 °C` or cooler is labeled
running cool, and values between those thresholds are on track. This is
separate from the predictor's existing live-bias status.

The chart shows both the latest stored Weather.com curve and the faint,
capture-time-labeled morning baseline. Revision badges identify every
forecast-valid hour whose latest distinct change is at least `1.0 °C`; a
`31 °C` to `28 °C` change therefore remains visible as `↓ -3.0 °C` after later
captures repeat `28 °C`. Smaller changes remain available in the tooltip
without adding label clutter. Tooltips and the semantic details table expose
the baseline, latest, and previous distinct values, signed change,
first-detection capture time, matched AMOS value, and departures against the
morning baseline and the selected latest strictly pre-hour forecast when
available. The compact three-part summary reports actuals versus the selected
morning capture, actuals versus latest pre-hour guidance, the matched-hour
counts, and the latest Weather.com forecast peak.

A separate `Live vs latest pre-observation curve` line chooses the newest
successful Weather.com capture that is strictly older than the freshest AMOS
observation and has valid hourly points bracketing that observation time. It
does not substitute a lone future hour or interpolate across a gap longer than
90 minutes. Near the end of the selected day, the following day's `00:00` row
is eligible only as that interpolation bracket; it is not added to the
selected day's chart, peak, or revision history. This live result is not
substituted for the strictly pre-hour history used by the scored running
signal. If the newest hourly attempt failed or no collector attempt has
completed for more than 90 minutes, the UI keeps the last stored history
visible but marks it stale and exposes the latest attempt error/time.
Unavailable baseline or observation data is shown as unavailable rather than
fabricated.

Weather.com hourly guidance is diagnostic-only for now. It is not assigned an
hourly ensemble weight, does not alter `predictedHighC`, and does not duplicate
the existing Weather.com daily-provider signal. This separation allows the
revision and observed-departure history to be evaluated before it affects the
daily-high model.

## Prediction dashboard behavior

The page subscribes to
`seoulWeather:getHighPredictionDashboard({ stationIcao: "RKSI", date })`. Its
main UI contract is:

- `latestPrediction`: the current prediction and hourly forecast curve
- `revisions`: immutable earlier predictions for the selected date
- `summary`: observed-day aggregates
- `evaluation`: current/final forecast evaluation
- `latestForecastCapture`: the most recent provider capture and provider health
- `weathercomHourlyDiagnostics`: baseline/latest curves, detected revisions,
  matched AMOS departures, forecast peak, and running states
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
  Weather.com daily, Weather.com hourly, Google Weather hourly, and Open-Meteo
  hourly results and errors. Weather.com's daily and hourly health remain
  separate even though both products are requested in the same collector run.
  Both Weather.com requests use the explicit `RKSI` ICAO airport selector
  rather than a city name or coordinate-to-locality lookup.
  A usable provider-product capture can remain an explicit fallback for at
  most twelve hours.
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
then replaces every matching timestamp with its usable one-minute capture:

- normal live coverage therefore shows only the one-minute observations
- a five-minute or legacy row appears only where no usable one-minute
  temperature exists
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

Immutable multi-provider forecast captures. Weather.com contributes both daily
forecast rows and its raw hourly curve, while Google Weather and Open-Meteo
also contribute hourly curves. Weather.com's daily and hourly status/error
fields are separate; the other provider status and errors remain independent
as well. A missing key or one failed product therefore does not discard usable
inputs from another product. The hourly product also stores its own
response-completion timestamp and Seoul-local capture date, so its children
are never backdated to the start of the parallel collector run.

### `seoulHourlyForecastPredictions`

Immutable, query-friendly child rows for each Weather.com hourly value. Each
row links to its parent `seoulForecastCaptures` record and stores the provider,
station, Seoul target date, forecast-valid timestamp, capture timestamp,
temperature, and available phrase/cloud metadata. Captures are appended, not
updated in place, so all predictions made for the same forecast-valid hour
remain available.

The table has `by_station_provider_target_capturedAt` for rebuilding a date's
latest and morning-baseline curves,
`by_station_provider_valid_capturedAt` for the ordered revision history and
strictly pre-hour lookup for one valid timestamp, and
`by_forecast_capture_id` for tracing child rows to one raw capture. Revision
deltas and AMOS departures are derived at query time rather than stored as
mutable truth.

The table intentionally retains every detected hourly vintage and therefore
adds up to 48 child rows per successful hourly capture. There is no historical
backfill for captures made before Weather.com hourly collection was deployed,
and there is currently no automatic retention/archive policy.

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
