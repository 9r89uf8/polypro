# RKSI: fastest current-temperature source

Last researched: **2026-07-29 KST**.

## Bottom line

The fastest source we actually measured is AMO/KMA's public mobile AMOS JSON:

```text
GET https://global.amo.go.kr/mobileApi/global_api/v1/amos_info.do?air_code=RKSI
```

It exposes minute AMOS display records derived from the live airport sensors,
without an API key. In measured boundary tests, a new observation minute first
appeared about **14-16 seconds after the minute**. The response carries
temperatures to 0.1 °C on runway-designated display rows, along with `tm_fc`,
`rwy_dir`, `rwy_use`, `rwy_main`, dew point, QNH, wind, visibility, and other
AMOS fields.

The rows are runway-shaped display records, not one independent thermometer per
`rwy_dir`. Live probes found only two distinct temperature series: the 15L
primary/representative series was copied across the runway 1/2 rows, and the 16L
series was copied across the runway 3/4 rows.

For a documented and more durable production integration, the best candidate is
KMA API Hub's authenticated **AMOS every-minute API**:

```text
GET https://apihub.kma.go.kr/api/typ01/url/amos.php?dtm=5&stn=113&help=0&authKey=KEY
```

`113` is Incheon Airport. The API defines `TM` as the observation time and `TA`
as air temperature at 0.1 °C resolution. It requires a free KMA API Hub account
and key. We confirmed that the endpoint is live, but could not measure its
publication lag without a key.

The important distinction is:

- For the freshest measured temperature, use **minute AMOS**, not METAR.
- For the first official coded RKSI report, use a METAR feed, but RKSI routine
  METARs are only issued every 30 minutes and temperature is rounded to 1 °C.

## Connection and collector status

The source is verified through direct unauthenticated HTTP requests and Convex
actions. The low-latency collector now uses the observed publication boundary
instead of one conservative fixed request:

- `seoul:scheduleLatestAmosTemperatureSites` schedules the expected next
  observation minute at second `:12`.
- `seoul:captureLatestAmosTemperatureMinute` checks sequentially once per
  second, stops as soon as the 15L timestamp advances, and upserts 15L/16L once.
- Each request has a three-second timeout and the burst stops after eight
  attempts.
- The normal one-minute and full five-minute captures carry distinct
  `collectionCadence` values and remain separate database rows.
- `seoul:pollLatestNoaaStationMetar` now stores the actual NOAA RKSI METAR in
  the chart table; the retired AMO METAR API is no longer used by the chart
  cron.

A live rollover probe started at `:12.005`, remained stale at `:13.245`, and
returned the fresh minute at `:14.753` on the third request. This is about five
seconds faster than the former fixed `:20` strategy while still stopping the
burst immediately after success.

Production deployment verification on 2026-07-27 KST confirmed the complete
chart path:

- NOAA stored the actual 11:30 RKSI METAR at 30 °C.
- The automatic burst stored the cadence-tagged 11:50 one-minute AMOS row at
  second `:16.410`, with representative 15L at 29.6 °C.
- The next automatic minute arrived at `11:51:15.412`, confirming the cron
  continues across consecutive minutes.
- The five-minute collector independently stored its cadence-tagged 11:50 AMOS
  row at second `:16.660`.
- Both cadence rows coexist for the same sensor timestamp and carry the same
  upstream temperature. The five-minute collector is a separate polling
  snapshot, not an average or independent product, so the chart presents only
  the one-minute AMOS line and uses five-minute rows solely to fill missing
  timestamps.

## RKSI 15L forecast capture and backend evaluation

The Seoul page now has one active forecast source: **Weather.com**. It does not
collect, select, blend, or display another provider for the Seoul high marker
or forecast cloud guidance.

The Weather.com forecast is requested explicitly for Incheon International
Airport with `icaoCode=RKSI`, not a Seoul city place ID or a
coordinate-to-locality lookup. During live verification on 2026-07-29 KST,
Weather.com's location service returned `airportName=Incheon Intl Airport` and
`icaoCode=RKSI`; the former coordinate lookup resolved to the `Unseo-dong`
neighborhood without an airport identifier. The chart therefore labels the
marker `Weather.com · RKSI`, matching its RKSI/Incheon AMOS and METAR
observation lines.

The two Weather.com products have separate jobs:

- Daily `/v3/wx/forecast/daily/5day`
  `calendarDayTemperatureMax` supplies the displayed maximum. This field
  covers the local midnight-to-midnight calendar day.
- Hourly `/v3/wx/forecast/hourly/10day` temperature values supply the
  horizontal time estimate. The earliest returned hour wins when the hottest
  hourly value is tied. Captures retain the five calendar dates covered by the
  daily product.
- Hourly `cloudCover` supplies coming-hour cloud guidance.

The rose chart point consequently uses the Weather.com daily high as its
vertical value and the first hottest Weather.com hourly value as its horizontal
position. That hour is a discrete **peak-time estimate**, not an exact instant.
The daily and hourly products can occasionally disagree, so the UI does not
claim that the daily maximum literally occurs at that hourly value.

Forecasts are captured immutably every 15 minutes and the UI repeats the
capture time because the provider can revise both the high and hourly timing.
Weather.com's today response begins at the current hour rather than replaying
elapsed hours. The backend therefore merges recent immutable Weather.com
captures by forecast timestamp: the newest value replaces each still-returned
hour, while an elapsed hour remains available from the last response that
contained it. The merge reads 112 captures, covering 28 hours at the current
cadence. A fresh direct capture is the UI fallback before a new backend revision
exists. When the selected hourly maximum came from an earlier capture, the UI
shows that peak-hour source time separately from the latest provider capture.

The backend still stores numbered evaluation revisions, but the page does not
render its predicted maximum, temperature curve, or tracker window. Model
version `rksi15l-weathercom-v4` records only a Weather.com provider detail and a
Weather.com hourly curve. Old stored provider fields and revisions remain in
the database solely for schema compatibility; page selectors explicitly ignore
them and do not backfill a marker when no Weather.com peak-time estimate exists.

At 00:10 KST the completed day is finalized against the canonical 15L series.
One-minute rows win when duplicate timestamps also have five-minute or legacy
captures, and the first occurrence wins when the maximum temperature is tied.
The evaluator retains the backend-only closing tracker result, but the page does
not present it. It is not independent forecast skill because by late day it has
already absorbed live observations. Honest temperature-error and peak-window
statistics are instead recorded at fixed 09:00, 12:00, and 15:00 KST cutoffs.

The AMOS 15L display record also exposes dew point, QNH, average/minimum/maximum
wind direction and speed, crosswind/headwind-tailwind fields, visibility, RVR,
precipitation, and cloud fields in the raw payload. These remain possible
backend evaluation inputs, but model version `rksi15l-weathercom-v4` keeps the
forecast side Weather.com-only. Its output is not a separate page forecast.
Fixed-cutoff scores should accumulate before adding more features or claiming
that a more complex model is better.

## Ranked findings

| Order | Source                               | Granularity | Authentication | Observed freshness                                                         | Verdict                                                                          |
| ----: | ------------------------------------ | ----------: | -------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
|     1 | AMO mobile `amos_info.do`            |    1 minute | None           | New minute appeared about 14-16 seconds after the minute in measured tests | Fastest practical machine feed measured; official host but undocumented contract |
|    1b | AMO public AMOS HTML                 |    1 minute | None           | New minute appeared roughly 12-17 seconds after the minute in two tests    | Effectively tied within the small sample, but HTML parsing is more brittle       |
|   TBD | KMA API Hub AMOS `amos.php`          |    1 minute | KMA key        | Not yet measurable without a key                                           | Preferred supported API; race it against the two no-key feeds                    |
|     2 | KMA Weather station 113 web JSON     |    1 minute | None           | About 5-6 minutes behind during the live comparison                        | Official fallback, not a speed winner                                            |
|     3 | AviationWeather.gov API / NOAA tgftp |  30 minutes | None           | About 4m20s-4m45s after the nominal METAR time over a 12-hour sample       | Good supported METAR access, not current sensor temperature                      |
|     4 | KMA WIS2 METAR                       |  30 minutes | None           | About 5m10s after nominal time in the sampled cycles                       | KMA-origin audit/backup feed; it did not beat AWC                                |

The observed timings are small live samples, not provider SLAs. They should be
retested over at least 24-48 hours before making a hard latency guarantee.

## 1. Fastest measured: AMO mobile AMOS JSON

Endpoint:

```text
https://global.amo.go.kr/mobileApi/global_api/v1/amos_info.do?air_code=RKSI
```

Live behavior on 2026-07-27 KST:

- HTTP 200 JSON, no login or cookies required.
- `Cache-Control: no-store, no-cache, max-age=0`.
- Twelve rows were returned: runway ends and midpoint rows for the two runway
  complexes.
- All rows carried the current minute in `tm_fc`.
- Measured minute rollovers became visible approximately 14-16 seconds after
  the minute.
- Typical request time from this environment was about 1-1.5 seconds.
- At 10:04 KST this feed already held 10:04 data while KMA Weather's station
  113 web feed still held 09:59 data.

Example fields:

```text
tm_fc, rwy_dir, rwy_use, rwy_main, temp, dewpoint,
qnh_hpa, qnh_inhg, wd_avg, ws_avg, mor, rvr, rn
```

This endpoint is queried by both `pollLatestAmosTemperatureSites` and
`pollLatestAmosRunways` in [`convex/seoul.js`](../convex/seoul.js). The targeted
collector starts a bounded rollover watch at second `:12` and stores the two
temperature-site rows as soon as the new minute appears. The full collector
retains cadence-tagged display rows every five minutes for auditing. A request
exactly at `:00` will normally see the previous minute because the tested
publication boundary was near `:15`.

Risks:

- It is on an official AMO production host, but it is an undocumented
  mobile-application endpoint.
- There is no published schema, rate limit, availability commitment, or CORS
  contract.
- It returns multiple runway-position readings. Preserve the rows and their
  runway metadata instead of silently averaging them into one airport value.

## 2. Supported target: KMA API Hub minute AMOS

Official documentation:

- [KMA API Hub: AMOS every-minute API](https://apihub.kma.go.kr/apiList.do?apiMov=%EA%B8%B0%EC%83%81%EC%B2%AD%20AMOS%20%EB%A7%A4%EB%B6%84%EC%9E%90%EB%A3%8C%20%EC%A1%B0%ED%9A%8C&seqApi=14&seqApiSub=259)
- [KMA API Hub usage and key limits](https://apihub.kma.go.kr/apiInfo.do)
- [Public Data Portal listing](https://www.data.go.kr/data/15139484/openapi.do?recommendDataYn=Y)

Request:

```text
https://apihub.kma.go.kr/api/typ01/url/amos.php
  ?dtm=5
  &stn=113
  &help=0
  &authKey=KEY
```

Parameters and fields:

- Omit `tm` to request the current time, or pass `YYYYMMDDHHmm` in KST.
- `dtm` is the lookback in minutes, with a maximum of 60.
- `stn=113` selects Incheon Airport.
- `TM` is observation time.
- `TA` is temperature at 0.1 °C resolution.
- Other fields include dew point, humidity, pressure, rain, visibility, and
  two- and ten-minute wind values.

KMA describes this as real-time data produced at minute, hourly, and daily
cadences. General accounts are automatically approved for up to 20,000 calls
per day and 5 GB per day; one request a minute is only 1,440 calls per day.

This should be the primary production source if its measured publication time
is competitive with `amos_info.do`. It has a documented contract and a formal
key, while the mobile JSON is best retained as a speed comparator or fallback.

## Which temperature should represent RKSI?

### Is there a live 15L temperature sensor?

**Yes, with a labeling caveat.** KMA's current equipment inventory lists a
primary temperature/humidity sensor (`온·습도`) under Incheon runway 2's
**15L** position. It also lists a primary temperature/humidity sensor under
runway 3's **16L** position; runway 4 has none. The inventory assigns the sensor
to the 15L runway position, but does not provide coordinates or establish that
the thermometer is physically at the 15L threshold.

The same equipment manual, section 2.1.3.6.1, requires a temperature/humidity
sensor to be installed at a location representative of the airport, 1.25-2 m
above the ground in a radiation shield. Section 2.1.3.6.2 says to minimize local
effects from buildings, aircraft exhaust, and wake. Thus "15L sensor" means the
representative AMOS sensor assigned to the 15L site, not a probe on the runway
pavement.

The mobile JSON does not preserve that provenance cleanly. In four live probes:

| KST minute | Every populated runway 1/2 row | Every runway 3/4 row |
| ---------- | -----------------------------: | -------------------: |
| 10:38      |                        29.3 °C |              28.9 °C |
| 10:39      |                        29.5 °C |              28.7 °C |
| 10:41      |                        29.5 °C |              28.9 °C |
| 10:42      |                        29.4 °C |              28.9 °C |

Wind and sometimes QNH still varied by runway direction. This shows that
`amos_info.do` flattens each temperature onto several display rows rather than
reporting a separate thermometer for each `rwy_dir`.

KMA's aviation-observation manual separately says that the representative AMOS
value is used in METAR/SPECI and names **15L as Incheon's representative
runway**. Therefore:

1. Prefer `rwy_dir=15L` for the canonical METAR-comparison series.
2. Label it **"RKSI representative AMOS temperature (15L designation)"** or
   **"runway-2 AMOS temperature"**, not "temperature measured at the 15L
   threshold."
3. Preserve all raw rows and `rwy_main` metadata so the selection is auditable.
4. Do not average the 15L and 16L series unless the product intentionally wants
   a synthetic airport-wide value.
5. Compare the 15L tenths value with the later whole-degree METAR temperature
   to verify the operational rounding behavior.

Sources:

- [KMA/AMO Aviation Meteorological Observation Equipment Manual (2026), page 63](https://amo.kma.go.kr/servlet/kamaboard?bid=lawinfo&callback=https%3A%2F%2Famo.kma.go.kr%2Finformation%2Flaw.do&fno=2&k=ATC202601091506552_06Ocf7Wsj6gVfIJEl1rv.pdf&mode=download&num=142&ses=)
- [KMA/AMO Manual for Aviation Meteorological Observation](https://amo.kma.go.kr/information/law.do?bid=lawinfo&mode=view&num=124&page=1&field=&text=),
  sections 1.7.4 and 5.3.6.1

## Other official paths tested

### Public AMOS HTML

```text
GET  https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do
POST https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do
     stnId=113
```

The [public AMOS display](https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do)
is server-rendered and works without a key. It includes a KST minute stamp,
runway data, 0.1 °C temperatures, and the current raw METAR. Its own JavaScript
refreshes every 50 seconds, but a server-side poll can observe it sooner. Two
tested rollovers appeared roughly 12-17 seconds after the minute.

This is a useful independent fallback for the mobile JSON. It is less convenient
because HTML structure can change and the page exposes two temperature blocks
rather than one clean canonical field.

### KMA Weather station 113 JSON

```text
https://www.weather.go.kr/w/observation/land/aws-obs-data.do
  ?db=MINDB_01M
  &tm=
  &stnId=113
  &sidoCode=2800000000
  &sort=
  &config=full
```

Station 113 is `인천(공)` / Incheon Airport, not station 112 (`인천`, the city
station). This endpoint is official and no-key, but it was consistently about
5-6 minutes behind the mobile AMOS feed in the live comparison.

The KMA Open Data Portal also confirms that AMOS minute data contains
temperature, wind, precipitation, and visibility measured by equipment:
[KMA AMOS data portal](https://data.kma.go.kr/data/air/selectAmosRltmList.do).
Its interactive/CSV interface is more useful for history than low-latency
polling.

### AMO station card and MET REPORT

AMO also exposes:

```text
GET https://global.amo.go.kr/mobileApi/global_api/v1/airport_weather.do?air_code=RKSI
```

That station card follows the half-hour observation product rather than the
one-minute sensors. A boundary test also showed an early value being revised
under the same timestamp, so consumers must upsert rather than treat the first
value as final.

MET REPORT is a local aerodrome report, not a faster continuous-temperature
feed. KMA's manual says RKSI routine METAR and MET REPORT observations are made
every 30 minutes. RKSI omits routine-between-report SPECI because it already
uses that 30-minute schedule. MET REPORT can be operationally richer, but it
does not beat minute AMOS for current temperature.

### AWC API versus NOAA tgftp

The supported AWC query is:

```text
https://aviationweather.gov/api/data/metar?ids=RKSI&format=json
```

In a 12-hour, 24-report sample, AWC `receiptTime` was approximately 4m20s-4m45s
after each nominal RKSI report time. For one 00:30Z report:

- AWC receipt time: 00:34:28Z.
- NOAA tgftp `Last-Modified`: 00:34:27Z.
- Both carried the same 00:30Z METAR.

AWC is a cleaner supported interface, but it was not materially faster than
tgftp in this test. It should be treated as the robust global METAR path, not as
a source of live sensor temperature.

Source: [Aviation Weather Center Data API](https://aviationweather.gov/data/api/).

### KMA WIS2

KMA publishes aviation METAR bulletins through its public WIS2 node:

```text
origin/a/wis2/kr-kma/data/core/weather/aviation/metar
```

The OGC collection can also be queried at:

```text
https://wis2box.kma.go.kr/oapi/collections/messages/items
  ?f=json
  &limit=20
  &metadata_id=urn:wmo:md:kr-kma:core.aviation.metar
  &sortby=-pubtime
```

The decoded WMO bulletin contained RKSI. The sampled 00:30Z report had a WIS2
publication time of 00:35:11Z, 43 seconds after AWC received the same report.
Several cycles showed the same approximate `:05:10` / `:35:10` pattern. WIS2 is
valuable as a KMA-origin backup or audit trail, but it did not win the latency
race, and this KMA node did not advertise the minute AMOS dataset.

Source: [KMA WIS2 node](https://wis2box.kma.go.kr/).

### Other relays and commercial APIs

No additional public METAR mirror beat AWC/NOAA in the controlled 01:00Z cycle:

- [MET Norway Tafmetar](https://api.met.no/weatherapi/tafmetar/1.0/documentation)
  first exposed `270100Z` at about 01:07:18Z, roughly 2m52s after AWC. It is a
  useful genuinely independent public fallback, subject to MET Norway's
  User-Agent, caching, and attribution requirements.
- [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/info/datasets/metar.html)
  generated its RKSI result at 01:05:15Z, at least 49 seconds after AWC.
  IEM documents that its real-time METAR path is mainly NOAAPort and that the
  distribution round trip itself adds minutes.
- CheckWX is the only opaque commercial API that still seems worth a trial
  benchmark. It claims rapid publication after it receives a report, but does
  not disclose the upstream source or an ingest timestamp, so there is no
  evidence yet that it can win.
- VATSIM allowed a ten-minute cache, while Ogimet, AVWX, MetarCentral, and MADIS
  ultimately depended on AMO/NOAA or slower polling. None offered a new
  source-adjacent path.
- Generic "current weather" providers were excluded. Their value may be a
  blended model, nearby station, or private sensor rather than the exact RKSI
  instrument, and most do not expose both observation and first-ingest times.

These relays are potential resilience sources, not competitors to one-minute
AMOS for current temperature.

### ATIS: the remaining source-adjacent experiment

The Korean eAIP lists RKSI H24 ATIS, including telephone ARS
`+82-32-743-2676`, and ATIS carries temperature, dew point, and QNH. A timed
phone capture around `:00` and `:30` is the only untested path found that might
beat international METAR distribution for the new official report:
[RKSI eAIP](https://aim.koca.go.kr/eaipPub/Package/2026-01-08/html/eAIP/KR-AD-2.RKSI-en-GB.html?ver=20250728).

This would not beat AMOS as a continuously current sensor feed, and the eAIP
marks the telephone service as reference-only. It is nevertheless worth a
three- to seven-day experiment if the precise first availability of each
half-hour report matters.

Publicly relayed D-ATIS/ACARS is not a reliable substitute. In the live test,
one 00:30Z RKSI D-ATIS appeared at 00:49Z and the 01:00Z message had not appeared
by 01:09Z; arrival depends on an aircraft request and receiver coverage.

## Retired API warning

The former recommendation in this document was:

```text
http://amoapi.kma.go.kr/amoApi/metar?icao=RKSI
```

That recommendation is no longer valid. AMO announced that its legacy API
service would end on **2026-07-20** as access was centralized through KMA/public
data portals. Live checks of the old METAR endpoint timed out.

Source: [AMO API shutdown notice](https://global.amo.go.kr/etc/notice-detail.do?seq=7569).

This matters to the current repository:

- The live chart cron now uses `pollLatestNoaaStationMetar`; it parses and
  stores the current NOAA `tgftp` RKSI report.
- The legacy `pollLatestStationMetar` action remains only for historical
  diagnostics and is not scheduled or called by the redesigned page.
- `pollLatestAmosTemperatureSites` uses the still-live mobile AMOS JSON every
  minute, while the internal burst collector detects the rollover as soon as
  practical.
- `pollLatestAmosRunways` retains cadence-tagged display rows every five
  minutes for auditing.
- NOAA supplies the actual coded METAR comparison but cannot compete with AMOS
  for current-temperature freshness.

## Recommended latency experiment

Run a 24-48 hour side-by-side watcher for:

1. AMO mobile `amos_info.do`.
2. KMA API Hub `amos.php` with a key.
3. Public AMOS HTML.
4. KMA Weather station 113 JSON.
5. AWC API and NOAA tgftp.
6. KMA WIS2 METAR.

For each changed value, store:

```text
source
source_observation_time
first_seen_at
first_seen_latency_ms
temperature_c
feed_row_designation
sensor_series
rwy_main
raw_payload_hash
is_revision
```

The production watcher polls sequentially once per second from `:12` and stops
when the new timestamp appears, with a hard eight-attempt cap. Do not schedule
only at `:00`; the measured AMOS data was not published until roughly `:15`.
For future comparison experiments, keep the same bounded-window approach rather
than polling continuously for the entire minute.

The decision rule should be:

- Use the source with the earliest stable `first_seen_at` for live temperature.
- Prefer the documented API Hub feed if it is within a few seconds of the
  mobile feed.
- Keep the mobile AMOS feed as the fastest fallback while validating its schema
  continuously.
- Use AWC/NOAA and WIS2 to verify the eventual official METAR, not to drive the
  freshest temperature display.
