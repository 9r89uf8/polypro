# Seoul RKSI live-temperature page

This document describes the focused RKSI temperature view and the collectors
that feed it.

## Routes

### `/seoul/today`

This stable entrypoint redirects server-side to `/seoul/day/[date]`, using the
current `Asia/Seoul` date.

### `/seoul/day/[date]`

Example: `/seoul/day/2026-07-27`.

The route is a single-purpose temperature console. Its dominant element is one
full-day chart with exactly two visible series:

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

The x-axis is a complete `00:00–23:59` Seoul local day. The current Seoul minute
is marked when the selected date is today. The chart uses a 2,400-pixel
horizontal timeline inside a scrollable region, with an x-axis label every hour
so the full-day series remain legible. Y-axis labels retain one decimal place,
matching the AMOS sensor resolution instead of rounding several fractional
ticks to the same whole degree.

The rest of the interface is deliberately compact:

- RKSI/live status and Seoul clock
- previous day, next day, date picker, and today navigation
- Celsius/Fahrenheit toggle
- manual live-source synchronization
- one status card per plotted series
- capture-second or audit-fallback status for the newest displayed AMOS row

The previous forecast, correlation, publish-race, raw-METAR, and raw-observation
panels are no longer part of the primary Seoul page.

## Client behavior

The page subscribes to `seoul:getDayStationRows`, so chart data updates
reactively after the collectors write to Convex.

For the current Seoul date, the first page load and `Sync now` request:

- `seoul:pollLatestNoaaStationMetar`
- `seoul:pollLatestAmosTemperatureSites`

The manual AMOS request is a single immediate fetch. The scheduled rollover
watch remains the lowest-latency path.

Historical routes only display already-captured rows. There is no historical
backfill from these latest-value endpoints.

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
