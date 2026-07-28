# Seoul RKSI live-temperature page

This document describes the focused RKSI 15L temperature and cloud-cover
timeline, plus the collectors that feed it.

## Routes

### `/seoul/today`

This stable entrypoint redirects server-side to `/seoul/day/[date]`, using the
current `Asia/Seoul` date.

### `/seoul/day/[date]`

Example: `/seoul/day/2026-07-27`.

The route is a single-purpose 15L weather timeline. It starts with live-source
status cards and one horizontally scrollable full-day chart. The former
maximum-temperature prediction summary, provider cards, and revision-history
panel are not rendered.

Forecast-capture machinery remains connected because it supplies the
selected-provider daily-peak-hour marker and coming-hour cloud cover. The
backend still stores internal prediction revisions for historical retention
and evaluation, but the route does not plot its live ensemble temperature
curve, predicted maximum, or peak window.

The primary visualization has two observed series:

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

The chart does not add a five-minute AMOS series or a live-tracker temperature
curve. Its only forecast-temperature overlay is the selected provider peak
described below.

The x-axis is a complete `00:00–23:59` Seoul local day. The current Seoul minute
is marked when the selected date is today. A date-specific orange sunset line
and `SUNSET · h:mm` label use RKSI's coordinates (`37.4602`, `126.4407`) and the
standard official-sunset zenith, so historical and future dates do not depend
on a forecast-provider response.

Peak timing has two deliberately separate visual references:

- a rose point, vertical line, and in-plot label mark the full-day maximum and
  first tied forecast hour from one selected hourly provider;
- a violet historical reference shows the median first occurrence of the daily
  15L maximum at `13:44 KST`, with a low-opacity middle-50% band from
  `12:20–14:39 KST`.

The provider marker uses the highest-weight usable hourly provider with all 24
Seoul-local hours: Open-Meteo has weight `0.45`, while Google Weather has weight
`0.35` and is the fallback. Weather.com's daily-only input is not eligible
because it cannot supply a peak hour. The marker pairs that provider's native
full-day maximum with the first hourly timestamp that produces it; it never
combines a temperature from one provider or forecast capture with a time from
another. This is an operational availability/weight rule, not a claim that one
provider has proven superior forecast accuracy.

For today and future dates, the chart reads the latest complete provider
capture directly, so an hourly forecast change is visible as soon as Convex
stores it. For a past date, it uses the complete provider peak retained in that
date's immutable prediction revision. Existing older revisions that predate
this field are not backfilled and render no provider marker. The selected
provider, temperature, peak forecast hour, and capture time are repeated above
the 2,400-pixel scroller.

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

Upcoming full-hour cells use `cloudCoverPct` from stored hourly provider input.
Google Weather's hourly `cloudCover` already represents its one-hour interval.
Open-Meteo requests instantaneous hourly `cloud_cover`, which is available
without the Google key; adjacent hour-boundary values are averaged to estimate
the matching forward-hour interval. Available values use Google `0.35` and
Open-Meteo `0.45` weights and retain `cloudProviderCount`. The current hour's
hourly guidance is not relabeled as a forecast for only the remaining minutes.

The header repeats the latest observed-hour summary and next available
full forecast-hour percentage. `Jump to now` and a one-time initial scroll
position keep the observed/forecast boundary visible on the 2,400-pixel chart.
A collapsible semantic table lists all 24 hours, sources, values, ranges, and
data coverage; the same information is attached to the chart for screen
readers. METAR temperature tooltips retain the original sky/ceiling detail,
while the provider-peak tooltip identifies its provider, temperature, and
forecast hour.

The rest of the interface is deliberately compact:

- RKSI/live status and Seoul clock
- previous day, next day, date picker, and today navigation
- Celsius/Fahrenheit toggle
- manual live-observation synchronization
- one status card per plotted series
- capture-second or audit-fallback status for the newest displayed AMOS row

The previous correlation, publish-race, raw-METAR, and raw-observation panels
are no longer part of the primary Seoul page.

## Forecast-capture data dependency

The page subscribes to
`seoulWeather:getHighPredictionDashboard({ date })`. The route consumes:

- `latestPrediction.hourlyCurve` only for stored cloud-cover fields; its
  temperature values are not plotted
- `latestPrediction.providerDetails` for a historical provider daily-peak
  value, peak forecast hour, capture age, and provider-selection weight
- `latestForecastCapture` for the newest today/future provider peak and as
  fallback cloud guidance

All of those inputs are optional. Observed temperatures and observed cloud
cover still render when forecast data are unavailable, and missing future
guidance remains explicit. Other prediction-dashboard fields may continue to
be stored and scored by the backend, but this route does not render a predicted
maximum, live-tracker temperature curve, tracker peak window,
confidence/status reason, provider cards, evaluation, or revision history.

## Client behavior

The page subscribes to `seoul:getDayStationRows`, so chart data updates
reactively after the collectors write to Convex.

For the current Seoul date, the first page load and `Sync now` first request:

- `seoul:pollLatestNoaaStationMetar`
- `seoul:pollLatestAmosTemperatureSites`

The page no longer calls `seoulWeather:recomputeTodayHighPrediction` from this
manual path. The status message reports partial observation-source failures.
The manual AMOS request is a single immediate fetch, while the scheduled
rollover watch remains the lowest-latency path. Provider captures continue on
their hourly schedule and update the current/future provider peak reactively.

Historical routes only display already-captured rows. There is no historical
backfill from these latest-value endpoints, and the historical page does not
trigger recomputation.

## Backend prediction collectors

- `seoul_forecast_capture_hourly` runs at minute `:02` and stores independent
  Weather.com, Google Weather, and Open-Meteo results and errors. A usable
  provider capture can remain an explicit fallback for at most twelve hours.
- `seoul_15l_high_prediction_every_5_min` recomputes the Seoul-local current
  date. Material changes create immutable revisions; no-op runs retain the
  preceding revision, with a 30-minute heartbeat.
- `seoul_15l_high_finalize_after_midnight` runs at `00:10 KST` and freezes the
  previous day's canonical truth, closing tracker result, and fixed-cutoff
  scores.

These scheduled jobs remain for immutable historical provider peak/hour
retention and backend evaluation. Their live predicted high, ensemble
temperature curve, and tracker window are not rendered on the Seoul page.

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
