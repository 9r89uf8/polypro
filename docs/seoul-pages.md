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
Weather.com daily-high marker, its hourly peak-time estimate, and coming-hour
cloud cover. The backend still stores internal prediction revisions for
historical retention and evaluation, but the route does not plot a tracker
temperature curve, predicted maximum, or tracker window.

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

The chart does not add a five-minute AMOS series or restore the removed
live-tracker temperature curve. Its Weather.com daily-high marker remains as
described below. Hourly revision diagnostics add a blue dashed latest-stored
temperature curve and a faint, capture-time-labeled morning-baseline curve;
these raw-provider curves do not restore a separate tracker or blended
prediction series.

The x-axis is a complete `00:00–23:59` Seoul local day. The current Seoul minute
is marked when the selected date is today. A date-specific orange sunset line
and `SUNSET · h:mm` label use RKSI's coordinates (`37.4602`, `126.4407`) and the
standard official-sunset zenith, so historical and future dates do not depend
on a forecast-provider response.

Peak timing has two deliberately separate visual references:

- a rose point, vertical line, and in-plot label mark Weather.com's Seoul
  calendar-day high and the first tied maximum in its returned hourly values;
- a violet historical reference shows the median first occurrence of the daily
  15L maximum at `13:44 KST`, with a low-opacity middle-50% band from
  `12:20–14:39 KST`.

The marker is Weather.com-only. Its vertical value is
`calendarDayTemperatureMax` from Weather.com's Seoul daily forecast. Its
horizontal position is the earliest tied maximum among Weather.com's hourly
temperatures for the same date. The latter is a discrete peak-time estimate,
not an exact instant. Weather.com's daily and hourly products can disagree, so
the UI does not claim that the daily maximum literally occurs at that hourly
value.

Both calls use Weather.com's canonical Seoul-city place rather than RKSI's
airport coordinates. This is why the marker is labeled `Weather.com · Seoul`
while the observed AMOS and METAR lines remain RKSI/Incheon data. Live
verification on 2026-07-29 KST returned 32 °C for Seoul and 29 °C for the RKSI
point.

For today and future dates, the chart can read a fresh Weather.com capture
directly so provider revisions appear after the next scheduled capture. The
backend also merges recent Weather.com hourly captures by timestamp: newest
still-returned values win, while elapsed hours remain available from the last
capture that contained them. The 112-capture window covers 28 hours at the
15-minute cadence. A newer direct capture wins over an older stored revision.
The hourly revision/departure diagnostics use the immutable child-row history
rather than being limited to that recent merge window.
For a past date, the chart uses the Weather.com high/time pair retained in that
date's immutable prediction revision. Older revisions without a Weather.com
peak-time estimate are not backfilled and render no marker. The high, first
hourly peak, latest provider capture, and any older retained peak-hour source
time are repeated above the 2,400-pixel scroller.

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

Upcoming full-hour cells use `cloudCoverPct` from the latest stored Weather.com
hourly response. No provider blending or stored legacy prediction curve is
used. Weather.com is identified directly in the cloud detail text. The current
hour's hourly guidance is not relabeled as a forecast for only the remaining
minutes.

The header repeats the latest observed-hour summary and next available
full forecast-hour percentage. `Jump to now` and a one-time initial scroll
position keep the observed/forecast boundary visible on the 2,400-pixel chart.
A collapsible semantic table lists all 24 hours, sources, values, ranges, and
data coverage; the same information is attached to the chart for screen
readers. METAR temperature tooltips retain the original sky/ceiling detail,
while the provider-peak tooltip identifies its provider, temperature, and
forecast hour. Weather.com hourly-point tooltips show the selected morning
baseline, latest and previous-distinct forecasts, capture/detection times,
latest strictly pre-hour forecast, matched AMOS reading, and available
departures. A separate collapsible semantic table exposes the same hourly
revision and departure details without requiring pointer access to the canvas.

The rest of the interface is deliberately compact:

- RKSI/live status and Seoul clock
- previous day, next day, date picker, and today navigation
- Celsius/Fahrenheit toggle
- manual live-observation synchronization
- one status card per plotted series
- capture-second or audit-fallback status for the newest displayed AMOS row

The previous correlation, publish-race, raw-METAR, and raw-observation panels
are no longer part of the primary Seoul page.

## Weather.com hourly revision diagnostics

Weather.com's daily maximum and hourly forecast remain separate products with
separate status and error fields. A successful daily response does not hide a
failed hourly response, and an hourly success does not change daily-product
health. The hourly product stores its own response-completion timestamp instead
of borrowing the timestamp from before the request began. That provider-specific
time is the forecast vintage used for revision and no-lookahead comparisons.
Every saved hourly value retains both its forecast-valid time and capture time,
so a later response appends history rather than overwriting the preceding
prediction.

For a selected Seoul-local date, the morning baseline is the first successful
Weather.com hourly capture from `05:00–07:00 KST`. If none exists, the latest
successful capture from `03:00–05:00 KST` is an explicit fallback. A capture
outside that four-hour window is not labeled as the morning baseline. The UI
shows the selected capture time and identifies the pre-05:00 fallback. A
baseline value is usable only when its capture is strictly earlier than the
forecast-valid hour.

The latest curve uses the newest successful stored value for each
forecast-valid hour. Its revision is the difference from that hour's preceding
distinct stored temperature, so repeated unchanged captures do not create a
change. The scheduled Weather.com collector runs at minutes `:02`, `:17`,
`:32`, and `:47`; the UI therefore labels a revision time as **first detected**
rather than claiming that Weather.com published the change at that exact time.

Observed-departure scoring prevents lookahead:

- only forecast-valid hours that have already arrived can be matched;
- the comparison forecast is the latest successful capture whose completion
  time is strictly before the forecast-valid hour;
- an `08:02` capture can therefore never score the `08:00` observation;
- the representative `rwyNo=2`, `rwyDir=15L` AMOS reading must be within
  ±5 minutes of the forecast-valid time, otherwise the hour remains unmatched;
- departure is `actual AMOS temperature - Weather.com forecast temperature`.

The running signal is the median of the latest three matched hourly departures
and requires at least two matches. A median of `+0.5 °C` or warmer is
`running_warm`, `-0.5 °C` or cooler is `running_cool`, and values between those
thresholds are `on_track`. The summary states when fewer than two matches make
the result tentative and distinguishes the latest-three sample from the total
matched-hour count.

The chart displays `Weather.com · latest stored` as a blue dashed curve and the
selected morning baseline as a faint blue dotted curve. A signed badge marks
every forecast-valid hour whose latest distinct change is at least `1.0 °C`; a
`31 °C` to `28 °C` change therefore remains visible as `↓ -3.0 °C` after later
captures repeat `28 °C`. Smaller changes remain available in the tooltip and
semantic table. The compact summary reports actuals versus the morning
baseline, actuals versus latest strictly pre-hour guidance, matched-hour
counts, and the latest stored Weather.com forecast peak.

For today, `Live vs latest pre-observation curve` chooses the newest successful
Weather.com capture that completed strictly before the freshest usable AMOS
reading and contains hourly values bracketing that observation. It does not
substitute a lone future point or interpolate across a gap longer than
90 minutes. Near the end of the day, the following day's `00:00` value can be
used only as the upper interpolation bracket; it is not added to the selected
day's curve, peak, baseline, or revision history. The live comparison is
separate from the strictly pre-hour forecasts used for scored hourly
departures.

Today and future pages retain the last successful history when the newest
hourly attempt fails or no attempt has completed for more than 90 minutes, but
mark it stale and expose the latest attempt error/time. Historical pages do not
become stale merely because the current collector is old. Missing baseline,
forecast, or AMOS data stays unavailable rather than being fabricated.

Weather.com hourly rows already power the existing Weather.com-only model,
daily-high marker timing, and coming-hour cloud cover. The new
revision/departure layer is diagnostic-only: it does not change those inputs,
model calculations, predicted values, immutable high revisions, or evaluation
behavior.

## Forecast-capture data dependency

The page subscribes to
`seoulWeather:getHighPredictionDashboard({ date })`. The route consumes:

- `latestPrediction.providerDetails`, filtered to `provider="weathercom"`, for
  a retained daily high, hourly time estimate, and capture age
- `latestForecastCapture.weathercomForecastDays` for the newest Weather.com
  calendar-day high
- `latestForecastCapture.weathercomHourlyRows` for the newest hourly time
  estimate and coming-hour cloud guidance
- `weathercomHourlyDiagnostics` for immutable latest/baseline curves,
  per-hour revisions, matched AMOS departures, running states, stale health,
  and the live pre-observation comparison

All of those inputs are optional. Observed temperatures and observed cloud
cover still render when forecast data are unavailable, and missing future
guidance remains explicit. Other prediction-dashboard fields may continue to
be stored and scored by the backend, but this route does not render a predicted
maximum, tracker temperature curve, tracker peak window, confidence/status
reason, provider cards, evaluation, or revision history. The dashboard query
filters prediction provider details to Weather.com, omits old blended hourly
curves, and returns only Weather.com fields from a forecast capture.

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
their 15-minute schedule and update the Weather.com high/time marker
reactively.

Historical routes only display already-captured rows. There is no historical
backfill from these latest-value endpoints, and the historical page does not
trigger recomputation.

## Backend prediction collectors

- `seoul_weathercom_forecast_every_15_min` runs at minutes `:02`, `:17`,
  `:32`, and `:47` and stores Weather.com Seoul daily and hourly results and
  errors together. Daily and hourly status/error fields remain independent.
  The hourly response has its own completion timestamp, and each successful
  hourly value is also appended to query-friendly immutable history. A usable
  latest capture can remain an explicit fallback for at most twelve hours.
- `seoul_15l_high_prediction_every_5_min` recomputes the Seoul-local current
  date. Material changes create immutable revisions; no-op runs retain the
  preceding revision, with a 30-minute heartbeat.
- `seoul_15l_high_finalize_after_midnight` runs at `00:10 KST` and freezes the
  previous day's canonical truth, closing tracker result, and fixed-cutoff
  scores.

These scheduled jobs remain for immutable historical Weather.com high/hour
retention and backend evaluation. Their predicted high, stored Weather.com
temperature curve, and tracker window are not rendered on the Seoul page. The
observed maximum remains valid even when the newest AMOS observation is stale,
and the backend evaluation value is never allowed below that known maximum.

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

Immutable Weather.com Seoul forecast captures. Daily rows hold the
calendar-day high; hourly rows hold temperature, time, phrase, and cloud cover.
Daily and hourly status/error fields are independent, so a partial provider
response remains diagnosable. The hourly product's optional
response-completion timestamp and Seoul-local capture-date fields keep new
history rows from being backdated to the start of the collector run. They are
optional so captures created before this history layer continue to validate.
Optional legacy provider fields likewise remain only for backward
compatibility; new Seoul captures and page selectors use Weather.com.

### `seoulHourlyForecastPredictions`

Immutable, query-friendly child rows for each Weather.com hourly value. Each
row links to its parent `seoulForecastCaptures` document and stores the
station/provider, Seoul target date, forecast-valid timestamp, provider
completion timestamp, temperature, and available phrase/cloud metadata.
Captures are appended rather than updated in place, preserving every detected
value for a forecast-valid hour.

`by_station_provider_target_capturedAt` rebuilds a date's latest and
morning-baseline curves,
`by_station_provider_valid_capturedAt` orders the revision lineage and supports
strictly pre-hour selection, and `by_forecast_capture_id` traces children to one
raw parent capture. Revision deltas and AMOS departures are derived at query
time rather than stored as mutable truth.

The Weather.com hourly/10day response is filtered to the five dates retained by
the existing Seoul capture flow, so one successful request can add up to about
120 child rows. There is no backfill for provider captures made before this
table was introduced and no automatic retention or archive policy. The new
table and the new parent-capture timestamp fields are additive; older forecast
captures and prediction revisions remain valid without them.

### `seoulHighPredictions`

Immutable, numbered prediction revisions containing the predicted high,
confidence interval, peak window, warming rates, Weather.com provider detail,
peak-hour source capture time, status/reason, and the stored Weather.com hourly
curve.

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
