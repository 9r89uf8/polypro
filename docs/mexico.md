# MMMX: fastest current-temperature source

Last researched: **2026-08-04 America/Mexico_City**.

## Scope and airport identity

This report follows the requested ICAO station code **`MMMX`**. That code is
Mexico City International Airport (Aeropuerto Internacional Benito Juárez,
AICM; IATA `MEX`), not the airport in Ciudad Juárez:

| Airport                                   | City                     | ICAO   | IATA  |
| ----------------------------------------- | ------------------------ | ------ | ----- |
| Aeropuerto Internacional Benito Juárez    | Mexico City              | `MMMX` | `MEX` |
| Aeropuerto Internacional Abraham González | Ciudad Juárez, Chihuahua | `MMCS` | `CJS` |

Every finding below is for `MMMX`. A future Ciudad Juárez investigation should
be separate and use `MMCS`.

## Bottom line

No public, machine-readable **0.1 °C** official-airport feed was found for
`MMMX`. The final CAPMA pass did, however, materially change the sub-hourly
answer: CAPMA's visible `DATOS MMMX` navigation exposes two live runway-end
display screenshots. Both public JPEGs advanced at roughly one-minute cadence
during the bounded check. They show current and two-minute temperature at
whole-degree precision—not the contract-required 0.1 °C sensor resolution. An
operations manual containing 2014 screenshots exactly matches the GUI and
identifies it with high confidence as SENEAM's legacy telemetric AWOS display.
Its current sensor IDs,
hardware/vendor lineage, relationship to the separately procured 2022
AWOS/PIIMET system, screenshot automation terms, and public-use rights remain
undocumented.

By raw delivery cadence, these are now the **fastest verified public
AICM-specific temperature displays** found in the investigation. AWC remains
ranked first for canonical, machine-readable official-report use.

The best current sources are:

1. **NOAA/Aviation Weather Center (AWC) MMMX METAR/SPECI** is the canonical
   public airport observation. Routine reports are effectively hourly and
   significant weather can trigger unscheduled `SPECI` reports. Temperature is
   rounded to a whole degree Celsius. The measured API response advertised a
   60-second cache lifetime, but that is a delivery property, not a new
   observation cadence.
2. **CAPMA's public `PISTA 05` and `PISTA 23` JPEGs are the best newly verified
   native-airport lead.** The screens identify AICM, `MMMX`, runway `05/23`, and
   touchdown-zone views; show temperature, two-minute temperature, dew point,
   humidity, pressure, and wind; and carry a clock with seconds. A bounded check
   found the `PISTA 23` file advancing every 60 seconds while its embedded
   screen was consistently 115 seconds older than the file write. `PISTA 05`
   usually advanced by 62 seconds, with one 85-second gap. Both expose only
   whole °C, and the wrapper pages do not auto-refresh. The public pixels and
   page source do not label the system, but a six-page manual containing 2014
   screenshots exactly matches the AICM screen and identifies the application
   as a telemetric AWOS.
   It describes touchdown-zone sensors sending readings by radio to the Tower
   computer and a local one-minute history file. The manual is a third-party
   user upload rather than an authenticated SENEAM-hosted copy, and the same
   screenshot filenames were in use by 2015. This identifies the legacy GUI,
   not the current sensor hardware or the separately procured 2022 system.
3. **SEMAR BASANMEX** is the only verified public sub-hourly numeric series whose
   thermometer is physically described as being at Benito Juárez airport. Its
   separate rooftop station publishes nominal 15-minute rows at 0.1 °C
   precision. During this investigation the file lagged, arrived with gaps, and
   had reuse questions requiring SEMAR approval before production collection.
4. **SENEAM's awarded Vaisala AviMet AWS310-SITE is the strongest 0.1 °C
   permission-dependent lead.** The 2022 fallo explicitly names that system for
   AICM and Toluca. The technical annex requires six AICM stations, 0.1 °C
   temperature resolution, five-second air-temperature and dew-point display
   updates at Tower and CAPMA, at least one year of central storage, and a web
   viewer. The accepted matrix includes three CAPMA display units. A focused
   Orvhemet website pass found no linked customer portal, login, AICM/SENEAM
   case study, AviMet/AWS310 detail page, or support download. Its one public
   dashboard case is an unrelated 2025 AWS810/NM10 environmental network in
   Tamaulipas, not `MMMX`. That case does prove that Orvhemet deploys Vaisala's
   portal-style Observation Network Manager. Vaisala's period-correct NM10
   documentation says it is normally installed on customer premises, uses an
   authenticated HTTPS browser UI, supports AviMet airport systems, retains
   current/history data, and can export through configured interfaces. Whether
   NM10 was included at AICM is now a precise BOM question, not an inference.
   Vaisala's supported AWS Client can separately retrieve the AWS310-SITE QML
   logger's timestamped logs, convert its daily binary DAT files to CSV,
   schedule downloads, and configure reports to external systems. These facts
   identify concrete viewer and structured-export families. They still do not
   prove AICM commissioning, identify the deployed sensor or software versions,
   say that the GUI renders tenths, prove five-second sensor sampling/logging,
   or expose a public endpoint. The complete public expediente omits the
   awarded technical proposal and acceptance records. A recovered 2022 public
   PIIMET prototype has an `AWOS` layer, but its four-airport payload is static
   placeholder data with no polling; it is not the operational feed. SENEAM's
   newly recovered 2025 civil-work package independently names the AICM system
   as `AWS310 SITE (AWOS)` and maps six deployment positions, but it also shows
   why acquisition did not equal commissioning: the follow-on construction did
   not start until November 19, 2025, was only 41.8% physically complete at
   year-end, and had an amended nominal end date of March 18, 2026. The current
   public folder contains the advance invoice, not the later construction
   certificates, physical-reception act, finiquito, as-builts, or an AviMet
   acceptance record. Those are now exact records to request rather than an
   inferred missing portal.
5. **SMN/CONAGUA SIVEA and CDMX REDMET** prove that nearby networks measure at
   ten-minute or even internal one-minute cadence. Neither exposes a current
   public airport-temperature series that can be treated as `MMMX`.

The wider search did find low-latency **nearby personal weather station
observations**:

- WeatherLink `PDIVM`, about 3.4 km from the airport reference point, advanced
  by exactly 60 seconds in one live transition;
- WeatherLink `AGRÍCOLA ORIENTAL`, also about 3.4 km away, had a timestamp and
  age consistent with a five-minute boundary;
- Weather Underground `IMEXIC159`, about 6.6 km away, uploaded twice 48 seconds
  apart; and `IMEXIC225`, about 8.4 km away, had one exact five-minute-boundary
  timestamp.

These answer the broad “is any one- or five-minute temperature visible near
the airport?” question with **yes**, but not the stricter “is it the airport
temperature?” question. They are privately sited, unverified consumer sensors.
An almost co-located WeatherLink station differed from `PDIVM` by 19 °F during
the same check, which is a concrete warning against treating proximity as
quality or airport representativeness.

At the initial live check, AWC's latest official report was:

```text
SPECI MMMX 312205Z ... 23/07 ...
```

That means a special observation at **22:05 UTC / 16:05 Mexico City local time
on July 31, 2026**, with temperature **23 °C** and dew point **7 °C**. The two
numbers in `23/07` are not a 23.07 °C high-resolution reading.

A later follow-up at about `01:26Z` found a newer thunderstorm `SPECI`, visible
on both AWC and CAPMA:

```text
SPECI MMMX 010122Z ... 18/11 ...
```

That observation was issued at **01:22 UTC / 19:22 Mexico City local time on
July 31**, with temperature **18 °C** and dew point **11 °C**. This is useful
evidence that event-driven reports can update between routine hourly reports;
it is still not a one-minute temperature series.

At the final `02:06Z` follow-up, both relays had advanced again to:

```text
METAR MMMX 010150Z ... 16/12 ...
```

That routine observation was at **01:50 UTC / 19:50 Mexico City local time on
July 31**, with temperature **16 °C** and dew point **12 °C**. AWC was observed
with it at `02:06:10Z` and CAPMA at `02:06:22Z`; because this was not continuous
monitoring, those checks do not establish which relay received it first or its
true upstream latency.

The final bounded rollover on August 3 supplied the missing direct comparison.
Both runway displays matched the new `032345Z` METAR temperature of `22 °C`, and
PISTA 05 also matched its `10 °C` dew point. Their wind and QNH did not exactly
match, and both displays subsequently changed to `21 °C` while the published
METAR stayed at `22 °C`. CAPMA's AFTN page was observed with the report at least
4 minutes 50.7 seconds before AWC's initial receipt timestamp. The public
screens are therefore valuable live local telemetry, not screenshots of METAR
text or a static rendering of its fields.

The practical recommendation is therefore:

- use AWC every 60 seconds for official MMMX METAR/SPECI;
- ask SENEAM/CAPMA to identify the current sensor hardware behind the legacy
  telemetric-AWOS displays and provide a supported numeric HTTPS export of the
  documented one-minute history stream—or its current replacement. Do not seek
  access to the workstation's local drive, and do not production-poll, retain,
  OCR, or republish the images until the exact-path access, retention, and
  republication gates are approved. Specifically ask whether Disime's 2010 AICM
  capture/transmission equipment, the blue application shown in 2014, and the 2022 AWOS
  are separate generations or share a supported interface;
- ask SENEAM first for a provider-issued, read-only MMMX AWOS export or current
  PIIMET access, after confirming that the AICM system is commissioned; do not
  treat the recovered public PIIMET demonstrator as a data source. Ask for the
  owner-issued URL/status of the separate 2025 `Nueva página Web para Servicio
Meteorológico Aeronáutico`/`SIGIMET` interface, and file the paired 2022
  AviMet-acceptance and 2025 civil-reception record request described below;
- pursue written SEMAR permission for BASANMEX as a clearly labeled,
  independent 15-minute diagnostic series;
- do not interpolate, average, or relabel BASANMEX or a city station as the
  official airport thermometer;
- describe the screenshots narrowly as the legacy SENEAM telemetric-AWOS GUI;
  do not claim that they are the 2022 AWOS/PIIMET system or infer a decimal
  temperature from humidity, dew point, pressure, or adjacent pixels;
- run a bounded first-seen experiment before claiming a reliable delivery
  latency for any source.

User-level confirmations led to eleven broad access, retention,
republication, decryption, and session flags being set to exact `true` in both
Convex environments. The final audit corrects the earlier interpretation of
those values: they are **premature/misconfigured**, not active compliant
approvals. Neither authority supplied an endpoint-bound scope packet, and no
repository code consumes the flags. SENEAM supplied no AWOS/PIIMET host,
account, station ID, or data dictionary, and SEMAR supplied no native
BASANMEX host or station ID. Those paths therefore remain both **approval
required** and **setup required**. Of the flagged paths, only AVIMET has a
known endpoint; its approved bounded tests produced alerts with no temperature
field, so it is rejected for this feature. Static inspection found exact AION
temperature request routes, but the AION-specific gate, meteorology role,
service authentication, and BASANMEX station ID are not configured. The full
flag audit and non-executed cleanup commands appear below.

The SEMAR site also advertises an Android/iOS app named **AVIMET**. A static
inspection of both official packages and the 14-page SEMAR manual found a
persistent alert-delivery connection, but **no hidden airport-observation
feed**. AVIMET distributes marine and severe-weather images and notices by
coastal region. Its connection indicator is not evidence of one-minute sensor
data, and neither client contains an `MMMX`, BASANMEX, station-temperature, or
Celsius observation model. The approved persistent-session test then received
and decrypted two real messages: both used the same alert schema and neither
contained a temperature field or Celsius value.

## Ranked findings

The ranking below is by usefulness for an airport page, not by raw update
frequency. Identity and authority outrank a fast but unverified nearby sensor.

| Rank | Source                            | Sensor/site identity                                                                             | Observation cadence                                                                                    |                                           Temperature precision | Measured delivery behavior                                                                                                            | Production status                                                                                                             |
| ---: | --------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
|    1 | AWC `MMMX` METAR/SPECI JSON       | Official MMMX aviation report, relayed by NOAA                                                   | Routine about hourly; event-driven `SPECI`                                                             |                                                            1 °C | API cache advertises `max-age=60`; 72-hour sample detailed below                                                                      | Usable without a special approval flag; obey AWC API rules                                                                    |
|    2 | CAPMA `PISTA 05`/`PISTA 23` JPEGs | Owner-published legacy SENEAM telemetric-AWOS TDZ displays; exact current sensors/vendor unknown | Roughly minute-published JPEGs; manual documents a legacy one-minute local record                      |                            Whole °C in image and 2-minute panel | Live rollover matched METAR temperature but screens then changed independently; CAPMA AFTN exposed the report before AWC              | Approval/setup required: supported numeric export, or exact-path image access, retention, derivation, and republication gates |
|    3 | SEMAR BASANMEX text               | Separate rooftop automatic station at the airport                                                | Nominal 15 minutes                                                                                     |                                                          0.1 °C | Latest row was roughly 41 minutes old; 28 missing quarter-hour slots; public chart re-requests the same file every 10 seconds         | Approval required: `SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED`                                                               |
|    4 | WeatherLink `PDIVM`               | Unverified PWS about 3.4 km away                                                                 | One 60-second transition observed                                                                      |                                  Whole °F in public map payload | Two consecutive timestamps advanced by exactly 60 seconds; age stayed under one minute                                                | Context only; documented API and `MEXICO_WEATHERLINK_ACCESS_APPROVED`                                                         |
|    5 | WeatherLink `AGRÍCOLA ORIENTAL`   | Unverified PWS about 3.4 km away                                                                 | One five-minute-aligned sample                                                                         |                                  Whole °F in public map payload | Timestamp and age were consistent with a five-minute boundary; consecutive rollovers untested                                         | Same WeatherLink gate                                                                                                         |
|    6 | Weather Underground PWS           | Unverified stations 6.6-8.4 km away                                                              | One 48-second transition or one five-minute-aligned sample                                             |                                          0.1 °C in API response | `IMEXIC159` advanced once in 48 seconds; `IMEXIC225` had one boundary timestamp                                                       | Context only; commercial agreement and `MEXICO_WU_PWS_ACCESS_APPROVED`                                                        |
|    7 | NOAA single-station `MMMX.TXT`    | Same METAR/SPECI, alternate NOAA relay                                                           | Same report stream                                                                                     |                                                            1 °C | One `SPECI` sample appeared in file metadata about 50 seconds after observation                                                       | Useful fallback/probe, not a higher-cadence sensor                                                                            |
|    8 | MMMX D-ATIS                       | Operational airport information based partly on reported weather                                 | Changes when ATIS is reissued, not a sensor-minute stream                                              |                                    Usually METAR-style whole °C | H24 service exists; no official public endpoint found                                                                                 | Provider-specific approval required for any third-party feed                                                                  |
|    9 | SMN/CONAGUA SIVEA                 | Regional automatic stations, not MMMX                                                            | Some stations update on 10-minute boundaries                                                           |                                      0.1 °C in viewer responses | Nearby TEZONTLE was not reporting; nearest active candidate found was about 17 km away                                                | Context only; `SMN_SIVEA_ACCESS_APPROVED` if integrated                                                                       |
|   10 | CDMX REDMET                       | Urban environmental network, not an airport sensor                                               | Network says it measures minute-by-minute internally                                                   | Published download is hourly/daily rather than live minute data | 2026 archive checked on July 31 was last modified April 7                                                                             | Licensed archive only; gate any undocumented live path separately                                                             |
|   11 | SEMAR AVIMET mobile app           | Marine/severe-weather alert publisher and client, not an EMAS/AWOS station                       | Persistent delivery connection; satellite/synoptic products at 08:00 and 20:00, other notices by event |                                    No numeric temperature field | Persistent approved probe received/decrypted two QoS 1 alerts; both matched the alert schema and had zero temperature/Celsius matches | Rejected as temperature source; any MQTT use requires `SEMAR_AVIMET_MQTT_ACCESS_APPROVED`                                     |

## 1. Official MMMX METAR/SPECI through AWC

### Endpoints

```text
GET https://aviationweather.gov/api/data/metar?ids=MMMX&format=json
```

- Human-readable station page:
  <https://aviationweather.gov/data/metar/?id=MMMX>
- API documentation:
  <https://aviationweather.gov/data/api/>
- OpenAPI description:
  <https://aviationweather.gov/data/schema/openapi.yaml>

AWC explicitly provides machine-to-machine access and worldwide terminal
observations. Its published rules say to use a custom user agent, limit request
scope, stay below 100 requests per minute overall, and not consume an endpoint
more often than once per minute per thread. CORS is not enabled, so collection
belongs in a server-side Convex action rather than directly in the browser.

An appropriate request is:

```bash
curl -sS \
  -A "polypro-mmmx-monitor/1.0 (operator-contact@example.com)" \
  "https://aviationweather.gov/api/data/metar?ids=MMMX&format=json"
```

Poll once every 60 seconds. Faster polling would violate the endpoint guidance
and cannot make MMMX issue observations more frequently.

### What the temperature represents

METAR encodes temperature and dew point as whole degrees Celsius. AWC's
documentation says each is rounded to the nearest whole degree. The structured
JSON `temp` value therefore must not be presented as sub-degree precision.

`METAR` is the routine observation. `SPECI` is an unscheduled complete report
issued when qualifying significant conditions occur. Thunderstorms during the
research window produced many special reports. The combined stream had one
interval as short as one minute—a `SPECI` followed by the routine `METAR`—and
the shortest `SPECI`-to-`SPECI` interval was two minutes. That does **not** turn
the source into a guaranteed one-minute feed: quiet-weather periods still have
only the routine reports.

The SENEAM observer manual says a regular hourly observation begins around
minute `:40` and should be transmitted by `:56`. Although some airport
categories can receive half-hour reports, the measured MMMX stream was
effectively hourly plus event-driven `SPECI`.

### Measured 72-hour behavior

A direct AWC request at approximately `2026-07-31T22:34Z` used:

```text
GET https://aviationweather.gov/api/data/metar
  ?ids=MMMX
  &format=json
  &hours=72
```

It returned 115 reports covering `2026-07-28T22:47Z` through
`2026-07-31T22:05Z`. All 115 `obsTime` values were unique in that snapshot.
Rows were grouped by `metarType`; each lag in milliseconds was
`Date.parse(receiptTime) - (obsTime * 1000)`; and the displayed median/p90 are
the lower observed values at zero-based index
`floor((count - 1) * percentile)` after sorting:

| Metric                          | Routine `METAR` | `SPECI` |
| ------------------------------- | --------------: | ------: |
| Rows                            |              71 |      44 |
| Minimum `receiptTime - obsTime` |          7m 04s |  1m 03s |
| Median `receiptTime - obsTime`  |         15m 24s |  1m 09s |
| 90th percentile                 |         18m 36s |  2m 04s |
| Maximum                         |         20m 56s |  2m 17s |

Across both report types, successive observation times were 1 to 125 minutes
apart, with a median interval of 38 minutes. The short intervals came from
special reports; the long intervals show why no fixed high-frequency guarantee
should be inferred.

These are retrospective `receiptTime` measurements contained in the AWC
records, not a measured client-side `firstSeenAt`. Network and cache latency can
add more time. A production collector should record its own immutable
`firstSeenAt`.

### Important timestamp trap

Use JSON `obsTime`, or parse the raw `YYGGggZ` group, for the actual observation
time.

For routine MMMX reports, AWC often normalizes `reportTime` to the following
hour. For example, a raw report containing `312050Z` had:

```text
obsTime    = 2026-07-31T20:50:00Z
reportTime = 2026-07-31T21:00:00Z
```

Treating `reportTime` as the sensor time would create a false ten-minute
latency improvement and put the observation at the wrong chart coordinate.
Store all of `obsTime`, `reportTime`, `receiptTime`, and the raw report.

### Alternate NOAA single-station file

NOAA also exposes:

```text
GET https://tgftp.nws.noaa.gov/data/observations/metar/stations/MMMX.TXT
```

For the `312205Z` special report, the file's `Last-Modified` was
`22:05:50Z`, while AWC recorded `receiptTime=22:06:18.825Z`. That one sample
suggests the single-station file can occasionally surface a report a few
seconds earlier. It does not establish a stable latency advantage, and it is
the same whole-degree METAR/SPECI rather than a separate sensor feed.

AWC JSON remains the preferred structured interface. If the text file is
tested as a fallback, parse the raw report independently, preserve the response
headers, and do not double-count the same observation.

### Approval assessment

No special Convex approval flag is proposed for the documented AWC API. It is
explicitly intended for machine access, and the required rate-limit and user
agent behavior are public. This assessment does not excuse abusive polling or
remove the need to preserve source attribution and raw provenance.

## 2. SEMAR BASANMEX: verified 15-minute airport series

### Public endpoints

- Station page:
  <https://meteorologia.semar.gob.mx/dirmet/estaciones/basanmex.html>
- Plain-text observations:
  <https://meteorologia.semar.gob.mx/datos_emas/basanmex.txt>
- Station photograph:
  <https://meteorologia.semar.gob.mx/dirmet/estaciones/images_emas/basanmex.jpg>
- SEMAR automatic-station network description:
  <https://meteorologia.semar.gob.mx/leermasredestaciones.html>

The station page calls this an automatic surface meteorological station at
Aeropuerto Benito Juárez and visibly shows rooftop-mounted equipment. It is
operated/published by SEMAR, not the SENEAM/CAPMA observing service that issues
the `MMMX` aviation report.

### Text format

The feed is a small whitespace-delimited file:

```text
AAAA-MM-DD-HH:MM Dirs Mgts Dirmx Mgtmx Temp Hr PEst Pcp SLP
```

| Field     | Meaning                                               | Unit                                              |
| --------- | ----------------------------------------------------- | ------------------------------------------------- |
| timestamp | Observation time                                      | UTC/TUC, as stated by SEMAR's network description |
| `Dirs`    | Wind direction                                        | degrees                                           |
| `Mgts`    | Wind magnitude                                        | knots                                             |
| `Dirmx`   | Maximum-wind direction                                | degrees                                           |
| `Mgtmx`   | Maximum-wind magnitude                                | knots                                             |
| `Temp`    | Air temperature                                       | °C, one decimal                                   |
| `Hr`      | Relative humidity                                     | percent                                           |
| `PEst`    | Station pressure                                      | hPa                                               |
| `Pcp`     | Precipitation                                         | mm                                                |
| `SLP`     | Provider-labeled `SLP`; meaning requires confirmation | hPa                                               |

The timestamps all landed on quarter-hour boundaries in the captured file.
The feed has no explicit row identifier or revision marker, so a collector
should key by station plus timestamp and retain a raw-row hash.

The row itself has no timezone suffix, but SEMAR's linked network description
explicitly identifies the displayed schedule as UTC/TUC. Store the parsed time
as UTC while also preserving the raw timestamp.

Do **not** automatically interpret `SLP` as conventional sea-level pressure.
Captured values were around 790 hPa at a 2,261 m site, close to the station
pressure and far below a plausible sea-level-reduced value near 1,000 hPa.
Keep the provider's raw label/value and ask SEMAR to define it before plotting,
renaming, or deriving pressure diagnostics.

### Measured freshness and gaps

At a fetch around `2026-07-31T22:26Z`:

- HTTP status was 200;
- `Last-Modified` was `2026-07-31T22:18:07Z`;
- the newest observation was `2026-07-31T21:45Z`, about 41 minutes old;
- the file contained 192 observations spanning 54.75 elapsed hours;
- 185 adjacent intervals were the expected 15 minutes;
- five gaps were 75 minutes and one gap was 135 minutes;
- those gaps represent 28 absent quarter-hour timestamps.

The file is therefore **nominally 15-minute**, not reliably real-time. Its
server modification time also shows that a fresh HTTP response does not imply
a fresh observation. The snapshot is consistent with delayed or batched
publication, but only a first-seen watcher can distinguish them. The sliding
window can skip timestamps, and a consumer must display source age explicitly.

A second live snapshot on August 1 again contained exactly 192 rows. Its
newest four records were the `:45`, `:30`, `:15`, and `:00` observations, while
three gaps were whole hourly blocks. The newest observation was `20:45Z` and
the file changed at `21:17:42Z`. Together with the earlier `:18` publication,
this strongly supports hourly publication of four native 15-minute records,
not guaranteed 15-minute delivery. The fixed 192-row length is a record-count
buffer, not a guaranteed 48-hour complete series.

The server honors both `If-None-Match` and `If-Modified-Since`, returning
`304` with an empty body. An approved collector should use both validators and
store the file-level `ETag`/`Last-Modified` separately from each observation
time. The feed has no row-level receipt/publication time, QC, revision flag, or
missing-data status.

This is still the strongest verified sub-hourly candidate: it is at the
airport, gives 0.1 °C values, requires no technical login, and is more frequent
than the routine METAR. It should remain a separate diagnostic line labeled
`SEMAR BASANMEX rooftop`, never `MMMX official`.

### The ten-second chart refresh is not ten-second data

SEMAR also has a more live-looking path:

- network map: <https://meteorologia.semar.gob.mx/red_emas_ligero_maps.html>;
- BASANMEX chart: <https://meteorologia.semar.gob.mx/graficaDatos.htm?id=51>;
- chart code: <https://meteorologia.semar.gob.mx/java/Base.js>.

The chart's station table maps ID `51` to file stem `basanmex`. Its JavaScript
sets `updateInterval = 10000`, constructs `datos_emas/basanmex.txt`, and runs an
`XMLHttpRequest` for that file every ten seconds. There is no separate JSON,
XML, WebSocket, or station-observation API behind the graph. It repeatedly
downloads the same nominal 15-minute text series.

The chart parser also incorrectly pushes field 7, `PEst`, into its `slp`
series even though the file header places `SLP` at field 9. A collector must
parse the header/field 9 rather than reproduce this first-party UI bug.

This is the strongest explanation for an apparent fast SEMAR feed: the
**display refreshes every ten seconds**, while the **measurement rows remain on
quarter-hour timestamps**. A frontend poll interval must never be reported as
sensor resolution.

A second check at `2026-07-31T23:10:51Z` made the distinction unusually clear:

- newest observation: `2026-07-31T21:45Z`, `25.6 °C`;
- file `Last-Modified`: `2026-07-31T22:18:07Z`;
- observation age: 1 hour 25 minutes 51 seconds;
- file age: 52 minutes 44 seconds; and
- publication lag from newest row to file modification: 33 minutes 7 seconds.

An exact Internet Archive snapshot from 2022 also shows the same descending
quarter-hour sequence (`00:15`, `00:00`, `23:45`, `23:30`, and so on). The
15-minute cadence is therefore long-standing rather than an accidental
limitation of the current chart UI.

### Coordinate warning

The page prints malformed coordinates:

```text
Latitude:  19° 42' 62.21" N
Longitude: 99° 07' 68.59" W
Elevation: 2261 m
```

DMS seconds must be below 60, so the displayed `62.21` and `68.59` seconds are
invalid. Concatenating the displayed digit groups as decimal-degree digits
gives a geographically plausible
**inference**, approximately `19.426221, -99.076859`, close to the airport.
That reconstruction is not an authoritative coordinate and must not be stored
with `coordinateSource="provider"`. Use a provenance such as
`inferred_from_malformed_semar_page` and keep the raw strings.

The station photograph is useful evidence of rooftop exposure and visibly
labels the lower enclosure `CAMPBELL SCIENTIFIC`, but it does not identify a
logger or sensor model, cloud enrollment, exact surveyed location, sensor
height, calibration, or equivalence to the MMMX METAR temperature probe. It
supports asking SEMAR for a read-only CampbellCloud share or LoggerNet/LNDB
export; it does not support direct PakBus/logger access or a guessed vendor
endpoint.

### Approval and terms

Technical reachability is not production authorization. The controlling
current route is SEMAR's June 2026 _Manual de Servicios al Público_, printed
page 44. It says automatic-surface-station records are free and that the
request must be filed through the national transparency platform, specifying
the geographic area, station name or names, and time period:

- <https://semar.gob.mx/Difusion/ManualDeServiciosAlPublico.pdf>
- <https://www.plataformadetransparencia.org.mx/>

Older SEMAR pages distinguished educational/government/collaboration uses from
for-profit use, but their linked request forms now return 404 and must be
treated as stale historical guidance rather than the current route:

- <https://www.semar.gob.mx/paginas_html/formato_sin_fines_de_lucro.html>
- <https://www.semar.gob.mx/paginas_html/formato_con_fines_de_lucro.html>

The older for-profit page says authorized fees can apply to station series;
the current manual describes the transparency request as free. The request
should therefore ask SEMAR to resolve which route and terms govern the intended
automated/commercial use. Before automated collection, ask SEMAR to approve:

- polling the current plaintext endpoint and the maximum frequency;
- retaining raw and parsed historical rows;
- public and, if relevant, commercial display;
- derived values, alerts, and market-related downstream use;
- required attribution and redistribution limits.

Contact published with the service:

```text
meteorologia@semar.gob.mx
+52 55 5624 6500, extensions 7244 / 7245
```

The production gate is:

```text
SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED
```

Only the exact Convex value `true` may enable the source. Credentials, if SEMAR
later provides any, belong in a separate environment variable.

### Permission-backed BASANMEX paths

The public observation paths exposed by the current SEMAR station, map, chart,
and linked first-party scripts were exhausted in this review: the station page
and ten-second chart both read the same `basanmex.txt`, and those paths exposed
no alternate station API, WebSocket, EventSource, MQTT topic, or observation
resource. The next useful step is to ask SEMAR for the upstream source rather
than enumerate undocumented hosts.

Ranked requests:

1. **Native BASANMEX feed or logger archive.** Ask Dirección de
   Meteorología/CAPMAR for a provider-operated, read-only API, SFTP export,
   push relay, or raw file at the logger's native cadence. Request a 72-hour
   sample with acquisition and publication timestamps, temperature, units,
   QC/status flags, missing-value rules, and whether each public 15-minute row
   is an instantaneous sample, average, or other aggregation. Also resolve a
   first-party metadata conflict: the station page calls BASANMEX an `EMAS`
   at 2,261 m with a blank WMO ID, while the chart index renders `EMACS`,
   2,260 m, and WMO/OMM `En trámite`. SEMAR should identify the real station
   class, transmission path, validation stage, sensor/logger models, and
   relocation/calibration history.

   ```text
   SEMAR_BASANMEX_NATIVE_FEED_ACCESS_APPROVED
   SEMAR_BASANMEX_NATIVE_DATA_RETENTION_APPROVED
   SEMAR_BASANMEX_NATIVE_DATA_REPUBLICATION_APPROVED
   SEMAR_BASANMEX_HISTORICAL_ARCHIVE_ACCESS_APPROVED
   ```

   The native access flag permits only the approved transport and minimum
   volatile diagnostics. Both live and historical native records require the
   retention flag before Convex storage and the republication flag before any
   public/commercial display or export.

2. **AION Meteorology GeoPortal.** The SEMAR station map's historical-data
   path leads to AION. The current public client bundle exposes real
   same-origin meteorology request contracts after authentication:

   ```text
   GET /aion/api/meteorologia/estacionesMonitoreo
   GET /aion/api/meteorologia/estacionesMonitoreoPorCanal?canalId=1
   GET /aion/api/meteorologia/estacionesMonitoreo/{stationId}
   GET /aion/api/meteorologia/estacionesMonitoreoPorNombre?query=<name>&canalId=<id>
   GET /aion/api/meteorologia/obtenerMediciones/{stationId}/40605
   GET /aion/api/meteorologia/estaciones/{stationId}/mediciones/{YYYY-MM-DD}
   GET /aion/api/meteorologia/estaciones/{stationId}/mediciones/{from}/{to}
   GET /aion/api/meteorologia/estaciones/{stationId}/mediciones/{from}/{to}/{measurement}
   ```

   The current fixed-station client hard-codes measurement ID `40605` as
   `Temperatura ambiente`. The latest-measurement response is consumed as an
   object containing at least `valor` and `tipoMedicion.unidad.simbolo`. Range
   records name ambient temperature `atmp` and sample time `fechaMuestreo`;
   the UI labels temperature `TEMP (°C)`, displays UTC, and limits a range
   request to 31 days. This exact latest-value route is the strongest concrete
   SEMAR live-temperature path found, but BASANMEX's `stationId` and its
   freshness/timestamp/QC semantics remain unverified.

   It is not an anonymous API: direct unauthenticated requests to the two exact
   station-list routes returned HTTP 401, and the UI checks for the exact
   meteorology role `ROLE_MET_USUARIO`, including before enabling export.
   Public registration visibly creates `ROLE_USUARIO_EXTERNO`, a distinct role;
   the public bundle does not establish an automatic meteorology grant. The
   interactive login posts to `/aion/api/login` with a reCAPTCHA token and a
   credentialed cookie session. Production automation therefore needs a
   provider-approved noninteractive/service-account method, not CAPTCHA
   automation. Neither current bundle contains `BASANMEX` or a public station
   ID. Approval alone therefore leaves the account/role, service authentication,
   and exact BASANMEX station ID as setup dependencies. Do not automate
   registration or CAPTCHA, guess station IDs, or call administrative
   SutronWin/socket configuration surfaces. In particular, the public chart's
   `id=51` is not evidence of AION's `stationId` and must not be reused without
   SEMAR confirmation:

   ```text
   SEMAR_AION_BASANMEX_ATMP_ACCESS_APPROVED
   ```

   Entry points are <https://diredimoat.semar.gob.mx/oceanografia/AION.html>
   and <https://aion.semar.gob.mx/pub/>. The published routing contact is
   `archivoceanografico@semar.gob.mx`, extension `8490`. Ask it for a
   noninteractive, read-only role no broader than required, the exact BASANMEX
   `stationId`, confirmation of channel `1` and measurement `40605`/`atmp`, and
   supported automated read/export limits. A free external account or
   `ROLE_USUARIO_EXTERNO` is not meteorology authorization.

3. **CAPMAR interagency mirror.** Current SEMAR reporting describes real-time
   station monitoring and sharing its meteorological database with other
   institutions; older SEMAR material separately described real-time NOAA
   transfer. NOAA HADS lists many station names matching SEMAR's core coastal
   EMAS sites, but the current Mexico list contains no BASANMEX/CDMX entry.
   BASANMEX is classified as an EMACS and its WMO identifier is shown as in
   process, which may explain the absence. Proceed only if SEMAR supplies the
   exact station identifier and sanctioned endpoint; separately obtain the
   endpoint operator's permission:

   ```text
   SEMAR_BASANMEX_INTERAGENCY_FEED_ACCESS_APPROVED
   ```

4. **Named vendor cloud/export or MQTT topic.** The BASANMEX photograph shows a
   Campbell Scientific enclosure. Ask whether SEMAR already collects it through
   CampbellCloud or LoggerNet/LNDB and can create a permissioned read-only
   share, database view, or scheduled TOA5/CSV export. This is a vendor clue,
   not proof of model or enrollment. Several other SEMAR stations link to
   WeatherLink, but BASANMEX does not. Alternatively, an exact BASANMEX MQTT
   topic supplied by SEMAR could be tested; the alert app's `digaohm-events`
   topic is not evidence of a station stream.

   ```text
   SEMAR_BASANMEX_VENDOR_CLOUD_ACCESS_APPROVED
   SEMAR_BASANMEX_MQTT_ACCESS_APPROVED
   ```

   Do not use broker wildcards or topic enumeration. If SEMAR wants a discovery
   exercise, it must first name the broker, exact permitted MQTT topic filters,
   purpose, and security owner; define a broker-specific gate only after that
   scope exists. Exclude root `#`, leading `+`, and `$SYS/#` unless each is
   separately named. Passive wildcard observation is incomplete and is not an
   authoritative topic inventory. Ordinary AVIMET access does not authorize
   discovery and provides no evidence of a BASANMEX topic.

SEMAR's useful routing contact is `meteorologia@semar.gob.mx`,
`+52 55 5624 6500`, extensions `7244` / `7245`. Ask for a provider-operated
relay or export, never access to the physical logger, station device, airport
LAN, or SEMAR internal network.

Suggested PNT/AION request wording:

```text
Solicito los registros de temperatura ambiente de la Estación Meteorológica
Automática de Superficie BASANMEX-SEMAR (Aeropuerto Internacional Benito
Juárez, Ciudad de México) en su resolución temporal nativa más fina conservada,
no remuestreados ni promediados, para [periodo]. Favor de informar si existen
series a 1, 5 o 10 minutos; entregar en CSV u otro formato abierto legible por
máquina, incluyendo fecha/hora y zona horaria, unidades, banderas de control de
calidad, valores faltantes, cambios de sensor/ubicación y metadatos de estación.
Solicito además el identificador exacto de estación, el rol mínimo de AION, los
límites de consulta y un método soportado de exportación/API de solo lectura.
```

A concise Spanish permission request is:

```text
Solicitamos autorización expresa para acceso automatizado y de solo lectura a
los datos de temperatura de la estación BASANMEX, mediante una interfaz o
exportación operada por SEMAR. Favor de confirmar la cadencia nativa, si el
registro público de 15 minutos es muestra o promedio, identificadores y
banderas de calidad, marcas de tiempo, límites de acceso, retención permitida,
uso interno y derivado, exhibición pública/comercial, redistribución,
atribución y vigencia. Solicitamos primero una muestra de 72 horas y no acceso
al equipo ni a la red interna.
```

Independently, the public text file supports conditional `ETag`/`304`
requests. After `SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED` is granted, a bounded 24- to
72-hour one-minute conditional monitor can measure when each 15-minute row
first appears and whether rows arrive in batches. It cannot create faster
observations and must not be represented as a one-minute sensor feed.

## 3. SEMAR AVIMET: a live alert channel, not live temperature

The app mentioned on SEMAR's home page is real and currently downloadable. It
was worth investigating because a continuously connected mobile client can
sometimes reveal a faster data interface. In this case it revealed a faster
**notification path**, not a faster weather-station path.

### Official artifacts and package identity

| Artifact | Provider path and identity                                                             | Reproducibility evidence from 2026-07-31                                                                                    |
| -------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Android  | Direct SEMAR sideload APK, package `mx.gob.semar`, label `Aviso Met`, version `1.0.2`  | 3,976,265 bytes; `Last-Modified: 2026-06-11`; SHA-256 `28d142087364a3506543db06a25d7e49b1a3fccb8f302149f2b7afc10c8cd253`    |
| iOS      | QR-linked enterprise OTA package, bundle `unindetec.app.alertas.avimet`, version `1.2` | 1,251,208-byte IPA; `Last-Modified: 2025-07-21`; SHA-256 `74c3083422ac357f84d71076060d0c5e210875c4c52175b16fcc24a7d5724e59` |
| Manual   | SEMAR/UNINDETEC 14-page installation and user manual                                   | PDF created 2024-12-06 and served with `Last-Modified: 2026-06-11`                                                          |

Official entry points:

- SEMAR home-page app section:
  <https://meteorologia.semar.gob.mx/>
- Android APK:
  <https://meteorologia.semar.gob.mx/dirmet/aplicacion/avimet_1.0.2.apk>
- iOS QR PDF:
  <https://meteorologia.semar.gob.mx/dirmet/aplicacion/qr_avimet_ios.pdf>
- Installation/user manual:
  <https://meteorologia.semar.gob.mx/dirmet/aplicacion/manual.pdf>

The app is not distributed through Google Play or Apple's public App Store.
The Android manual instructs users to allow a direct APK install. The iOS QR
decodes to <https://calipso.unindetec.edu.mx/avimet/>, whose page invokes an
Apple enterprise `itms-services` manifest at
<https://calipso.unindetec.edu.mx/avimet/app/avimet.plist>. The manual then
instructs the user to trust the enterprise developer
`SECRETARÍA DE MARINA-ARMADA DE MÉXICO`. The public version metadata is at
<https://calipso.unindetec.edu.mx/avimet/version.json>.

The distribution metadata is inconsistent: the landing page says `1.1`, the
manifest and IPA say `1.2`, and `version.json` says Android `1.0` while SEMAR's
actual APK is `1.0.2`. Static inspection also found that the enterprise
provisioning profile embedded in the iOS package expired on **2026-07-21**.
That would ordinarily prevent a new installation or launch until SEMAR
republishes the package. No installation was attempted, so this is a package
metadata finding rather than a live-device test.

The package-review phase downloaded the provider-hosted artifacts for **static
inspection only**. It did not install or execute either app, log into the
protected alert publisher, or register a device token. The separately
authorized broker connections and exact subscription are described below.

### What the manual says the app carries

SEMAR calls the system `Sistema de Avisos Meteorológicos`. Its password-
protected publisher at <https://meteorologia.semar.gob.mx/alertas/> lets an
authorized operator select an image and one of six notice types:

1. synoptic chart;
2. swell;
3. satellite image;
4. northerly-wind event;
5. tropical cyclone; or
6. general alert.

For applicable products, the operator selects the Caribbean, Gulf, or Pacific
coast. The phone shows the image, message, publication date, and coastal
region. There is no station picker, observation table, numeric weather form,
or temperature field in the documented publisher or client screens.

The manual states that the satellite image and synoptic chart are published
daily at **08:00 and 20:00**, while the other notices are published **by
event**. A current SEMAR cold-front document likewise describes AVIMET as a
place where severe-weather notices are published. That is entirely different
from a one-, five-, or ten-minute automatic-station series.

Most importantly, the manual's three-state status icon means:

- network interfaces disabled;
- network available but the receiving service disconnected; or
- network available and the receiving service connected.

The green state therefore proves only that the app is ready to receive a new
notice promptly. It says nothing about the cadence of a thermometer.

### Static protocol and payload trace

The official Android package contains this public configuration endpoint:

```text
https://meteorologia.semar.gob.mx/alertas/config/config.txt
```

At the check it returned an MQTT broker address. The client uses Eclipse Paho,
keeps a non-clean session, and subscribes at QoS 1 to a single topic named
`digaohm-events`. It does not configure a broker username or password in the
connection routine. That technical openness is not permission to connect or
republish.

The exact public configuration value was:

```text
tcp://brokermet.semar.gob.mx:8883
```

Incoming application messages are encrypted before the client parses the
alert object. The package contains what it needs to read them, but no embedded
implementation detail, reachable socket, or absence of a login constitutes
authorization to subscribe or decrypt production traffic.

The Android message model contains only:

```text
title, body, ocean, metereology, publishedDate, routine
```

The misspelled `metereology` value selects the product image under the public
base path `https://meteorologia.semar.gob.mx/alertas/img`. The known product
keys are alert, cyclone, satellite, swell, synoptic, and wind. The known region
keys are general, Gulf, Pacific, and Caribbean variants.

The iOS client uses an APNs notification-service extension, sends device-token
and coastal-preference operations to the undocumented base host
`https://unindetms.online:49710`, opens the same SEMAR alert images, and links
to SEMAR 24/48-hour marine forecast PDFs. Its local model is likewise
message/image/date/type/URL oriented. The backend includes token deletion and
preference operations; it was not contacted during this research.

Static string and class searches across both packages found:

- no `MMMX` or `BASANMEX` identifier;
- no station or `estación` observation model;
- no temperature, Celsius, dew-point, humidity, latitude, or longitude field;
- no EMAS/AWOS data endpoint; and
- no link between the AVIMET message channel and `basanmex.txt`.

The SEMAR 2018-2024 management report also discusses maintaining AVIMET and
maintaining/programming the EMAS station network as separate activities. The
best-supported interpretation is therefore that AVIMET is downstream of human
forecast/alert production, not a mobile window into the automatic-station
telemetry system.

### Bounded approved MQTT connectivity probe

After the user confirmed SEMAR/DIGAOHM authorization, the development Convex
deployment was set to:

```text
SEMAR_AVIMET_MQTT_ACCESS_APPROVED=true
```

A single bounded probe then used a random client ID, MQTT 3.1.1 over the
provider-configured plaintext TCP transport, a clean session, no reconnects,
and no username or password. It did not publish, persist payloads, or attempt
decryption.

Measured on `2026-07-31`:

- `23:59:01.013Z`: broker returned successful `CONNACK` code `0` with
  `sessionPresent=false`;
- `23:59:01.156Z`: broker granted subscription to `digaohm-events` at QoS 1;
- the client listened for 30 seconds;
- no retained or live messages arrived; and
- `23:59:30.661Z`: the client ended the clean session and disconnected.

A post-probe readback found the flag set to exact `true` in both development
and production. This research issued the development `env set` command only;
the production value appeared during the test window. No repository code
currently reads this flag or implements an AVIMET collector, so the production
value does not itself start a connection or scheduled job.

This proves that the advertised broker accepted an unauthenticated MQTT
connection and subscription at that moment. It does **not** establish event
frequency, historical availability, payload validity, a service-level
guarantee, or any relationship to BASANMEX/MMMX temperature. With no retained
message and an event-driven publisher, a much longer authorized observation
window could still receive nothing.

### Second authorized temperature-content probe

After decryption and retention permission was confirmed, a second probe was
designed to decrypt any received message in memory and report only its JSON
field paths and temperature-related matches. It rechecked the MQTT flag before
connecting and the decryption/retention flags before any corresponding payload
operation. It did not print or persist ciphertext, plaintext, or the key.

The first attempt connected and subscribed successfully at
`2026-08-01T00:14:01Z`, but the broker closed the idle connection after about
30 seconds at the first 30-second keepalive boundary. It delivered no message.
The final retry used a ten-second keepalive:

- `00:15:24.903Z`: successful `CONNACK`, code `0`, clean session with no prior
  session present;
- `00:15:25.001Z`: QoS 1 subscription to `digaohm-events` granted;
- access approval was rechecked during the session;
- the connection remained open for the complete 120-second window;
- messages received: `0`;
- ciphertext bytes received: `0`;
- retained messages received: `0`; and
- messages decrypted or inspected for temperature fields: `0`.

This test found **no live temperature**, but only because the event-driven
topic was silent. It does not constitute a live-payload schema sample. The
stronger negative evidence remains the app's static message model, which has
alert title/body, region, product type, publication time, and routine status
but no station-temperature field. Capturing an actual payload would require an
authorized monitor to be connected when SEMAR publishes an alert; even then,
the channel's documented purpose and schema remain alerts rather than EMAS
observations.

### Persistent-session test after explicit permission

The Android client uses QoS 1 with `cleanSession=false`. Both completed probes
used clean sessions, so they could only see a retained message or an alert
published while the probe was online. They could not receive QoS 1 alerts that
the broker had queued for a previously established offline app session.
Subscription QoS 1 does not guarantee an offline payload: a message published
at QoS 0 is not queued, and broker queue limits or expiry can discard QoS 1
messages.

A persistent test required one additional, provider-approved gate before it
could attempt to obtain a real AVIMET payload:

```text
SEMAR_AVIMET_MQTT_PERSISTENT_SESSION_APPROVED
```

That approval was subsequently confirmed and set to exact `true` in Convex
development and production. At `2026-08-01T01:04:38Z`, a bounded client used a
new dedicated random ID, `cleanSession=false`, and the exact
`digaohm-events` topic. The broker returned `sessionPresent=false`, granted the
single QoS 1 subscription, and the client disconnected normally without
unsubscribing. No message arrived while establishing it. This created one
intentional offline broker session so a QoS 1 event published during the
approved window could be queued. The reconnect uses the same ID and never
resubscribes; if the broker reports the session is gone, it proceeds directly
to cleanup. It is followed by a `cleanSession=true` connection to request
deletion. The client ID and payload decoder remain temporary and are not
committed. The reconnect was scheduled for `2026-08-01T02:01:00Z` (20:01
Mexico City), with a 120-second maximum, exact-topic enforcement, no publish or
unsubscribe, at most eight messages, 64 KiB per message, and 256 KiB total.

The reconnect completed successfully:

- `02:01:08.193Z`: resume began, and the broker returned
  `sessionPresent=true`, proving that it had preserved the dedicated
  subscription;
- `02:01:08.570Z`: one non-retained, non-duplicate QoS 1 message arrived almost
  immediately. This timing strongly suggests it was queued while the client was
  offline, although only broker administration can prove enqueue time;
- `02:01:30.735Z`: a second non-retained, non-duplicate QoS 1 message arrived
  during the live window;
- the two encrypted payloads totaled 798 bytes and both decrypted to JSON
  objects;
- both had exactly the same paths: `to`, `data`, `data.body`,
  `data.metereology`, `data.ocean`, `data.publishedDate`, `data.routine`, and
  `data.title`;
- dedicated temperature-field-name and Celsius-text checks found **zero
  matches** in both messages;
- no ciphertext, plaintext, title, or body content was printed or retained;
  only bounded sizes, hashes, delivery flags, field paths, and the zero-match
  result were recorded; and
- `02:03:50.911Z`: observation ended, the same client ID connected with
  `cleanSession=true`, the broker accepted the cleanup request, local session
  state was removed, and stderr was empty. MQTT cannot independently prove
  administrative deletion, so cleanup is protocol-confirmed but not
  provider-console-confirmed.

This is the first real AVIMET payload evidence, and it agrees with the static
client model: the channel carries alert/product notification objects, not
station observations. Two messages cannot prove that free-form alert prose will
never mention a temperature, but they show no numeric temperature field and no
Celsius value in the actual sample. AVIMET should therefore remain rejected as
an MMMX/BASANMEX temperature source.

This flag is additional to the already approved MQTT, decryption, and retention
flags because a durable broker-side subscription creates external state. The
permission must name the exact `digaohm-events` topic, dedicated client ID,
broker queue duration, allowed offline/reconnect window, maximum message/byte
count, retention and deletion behavior, and session-cleanup procedure. No
production app's client ID may be copied or displaced.

The bounded sequence is:

1. prefer an out-of-band sample payload or a SEMAR-controlled test
   environment/segregated topic; never ask for a synthetic alert or replay on
   production `digaohm-events`, because it could notify real users;
2. connect with the dedicated ID and `cleanSession=false`, subscribe only to
   the exact approved topic at QoS 1, and disconnect normally;
3. reconnect with that same ID during the approved window and inspect
   `sessionPresent` without resubscribing. If it is false, the previous
   subscription/queue is gone; stop and proceed to cleanup rather than creating
   a new observation window;
4. record only counts, bounded sizes, retained/publish-QoS flags, and the
   authorized schema information; and
5. after the observation, reconnect once with the same ID and
   `cleanSession=true` to request deletion of the test session. MQTT's
   mandatory `sessionPresent=false` on that clean connection does not prove
   deletion; only broker administration can confirm cleanup. After an emergency
   revocation, do not reconnect—ask SEMAR to delete the client session.

Every connect/reconnect must recheck the access and persistent-session flags.
Every payload decrypt/store/read must independently recheck its existing flag.
Because the advertised connection is plaintext TCP, successful decryption
would not prove publisher authenticity. Treat all bytes and decoded fields as
untrusted, enforce ciphertext/plaintext size and nesting limits, and never
render message HTML, URLs, or embedded content directly.
The likely result is still an alert object, not temperature; this test helps
validate the app investigation, not the MMMX sensor series.

### Remaining app-adjacent connection paths

These are lower value and should only be pursued if SEMAR specifically wants
them tested:

- Android resources contain stale-looking Firebase identifiers for
  `https://alertas-digaohm.firebaseio.com` and
  `alertas-digaohm.appspot.com`, but the APK contains no Firebase SDK classes,
  Android provider/service, or custom-code references. A bounded Realtime
  Database read of exact provider-named paths would use
  `SEMAR_DIGAOHM_FIREBASE_READ_APPROVED`; it does not authorize Cloud Storage
  bucket listing, object guessing, redirects to unapproved hosts, writes, rule
  bypass, credential guessing, shallow enumeration, or path discovery.
- Static iOS analysis found five request builders for
  `https://unindetms.online:49710`; all are `POST` operations managing device
  identity, APNs tokens, coastal preferences, or notification settings. No
  health or `OPTIONS` route was found. A bounded probe would use
  `UNINDETEC_AVIMET_IOS_API_PROBE_APPROVED` only after the provider names the
  exact supported method and path. Any actual registration needs the separate
  `UNINDETEC_AVIMET_IOS_DEVICE_REGISTRATION_APPROVED`, an APNs-issued token from
  a SEMAR/UNINDETEC-authorized test build, device, bundle/team, and environment,
  plus privacy terms and cleanup. The inspected profile is expired; never use
  a synthetic or real user's token. Neither path has a temperature model.
- The deterministic alert-image paths can establish product provenance and
  retrieval/cache timing under `SEMAR_AVIMET_IMAGES_ACCESS_APPROVED`, but HTTP
  headers are not authoritative publication times and the files contain
  maps/images rather than a calibrated MMMX thermometer. The approval must
  separately name exact URLs, retrieval, retention, OCR/derivatives, and
  republication rights, or the single flag must remain absent.
- A provider-issued read-only publisher role could expose alert history or
  upstream labels under `SEMAR_AVIMET_PUBLISHER_READ_APPROVED`. The role must
  be enforced server-side and separately name viewing, export, and any job
  creation; an export can itself create server state. It must forbid uploads,
  edits, and sends. There is no temperature reason to request publisher write
  access.

### Approval boundary

Merely linking to the public app artifacts in this report needs no collector
flag. Any production use of the undocumented interfaces does.

Use this dedicated Convex flag for server-side retrieval of the MQTT
configuration, broker connection, subscription, and receipt of ciphertext into
volatile memory:

```text
SEMAR_AVIMET_MQTT_ACCESS_APPROVED
```

Only the exact value `true` enables it. Written approval should come from
SEMAR/DIGAOHM or the authority SEMAR designates, and cover the exact topic and
automated connection/session limits. The worker must recheck the flag
immediately before connecting. Missing, false, revoked, or unexpected values
must stop the connection and show `approval required`.

Decryption and retention are independently gated:

```text
SEMAR_AVIMET_MESSAGE_DECRYPTION_APPROVED
SEMAR_AVIMET_MESSAGE_RETENTION_APPROVED
```

The decryption flag must be checked immediately before decrypting each payload.
The retention flag must be checked immediately before every raw-ciphertext or
decrypted-content insert/upsert and on every read, export, retry, or derived
job that uses retained messages. Retaining decrypted content requires all
three MQTT, decryption, and retention flags to be exact `true`. If any required
flag fails, discard the payload after the narrowest already-authorized
in-memory handling; do not queue it for later processing.

The user confirmed SEMAR/DIGAOHM permission for message decryption and
retention on `2026-07-31`. Both new flags subsequently read back as exact
`true` in development and production. No collector or message table exists, so
they currently start no work. Any cryptographic key remains a separate Convex
secret, not an approval flag, and was not set during this research.

Public display, redistribution, commercial use, or third-party export is not
implied by retention permission and requires:

```text
SEMAR_AVIMET_MESSAGE_REPUBLICATION_APPROVED
```

The public contact for routing that request is `meteorologia@semar.gob.mx`,
`+52 55 5624 6500`, extensions `7243` / `7245`. SEMAR should identify whether
DIGAOHM, UNINDETEC, or another data owner must sign off on each capability.

Any bounded provider-supported method/path probe of the separate iOS backend
has a different security scope and needs its own flag:

```text
UNINDETEC_AVIMET_IOS_API_PROBE_APPROVED
```

Device/APNs-token registration is a write and privacy operation requiring
`UNINDETEC_AVIMET_IOS_DEVICE_REGISTRATION_APPROVED`, an APNs-issued token from
an authorized SEMAR/UNINDETEC test build/device/environment, planned
operations, retention, and cleanup. Credentials and device tokens remain
separate secrets. Neither AVIMET flag inherits from
`SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED`, and BASANMEX approval does not authorize the
app backends.

If alert images are ever collected independently of an approved MQTT workflow,
use a separate `SEMAR_AVIMET_IMAGES_ACCESS_APPROVED` flag for automated image
retrieval, retention, redistribution, and public/commercial display. A
provider-issued read-only publisher role would use
`SEMAR_AVIMET_PUBLISHER_READ_APPROVED`. Publishing is an administrative write
side effect, not a data-source investigation, and is outside this project's
scope; the read flag must never authorize it.

There is no temperature-product reason to implement either integration. An
alert panel or archive must remain separate from the airport-temperature
series; do not use AVIMET as an MMMX-temperature fallback.

## Investigation of one-, five-, and ten-minute paths

### Nearby personal stations with verified fast delivery

Distances in this section are great-circle estimates from AWC's rounded MMMX
reference coordinate, `19.436, -99.072`. They do not measure distance from the
unknown airport thermometer. Public PWS coordinates can also be rounded or
privacy-shifted.

#### WeatherLink

The WeatherLink public map exposed two strong low-latency candidates:

| Station             | Public coordinate     |      Distance | Live behavior observed July 31                                                                                       | Verdict                                                                            |
| ------------------- | --------------------- | ------------: | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `PDIVM`             | `19.46158, -99.05430` | about 3.40 km | `lastTimestamp` advanced by exactly 60 seconds; temperature changed 68 °F to 67 °F; data age stayed under 59 seconds | One verified 60-second transition; long-run cadence and siting unverified          |
| `AGRÍCOLA ORIENTAL` | `19.40528, -99.07391` | about 3.42 km | timestamp on an exact five-minute boundary; 74 °F (about 23.3 °C), age about 288 seconds just before rollover        | Consistent with five-minute publication/batching; consecutive rollovers unverified |

Read-only research endpoints:

```text
https://www.weatherlink.com/map/data/station/2de99f16-922e-4ff5-8738-84d2735206db
https://www.weatherlink.com/bulletin/2de99f16-922e-4ff5-8738-84d2735206db

https://www.weatherlink.com/map/data/station/80015241-25de-4796-b3c2-ac8035ed746c
https://www.weatherlink.com/bulletin/80015241-25de-4796-b3c2-ac8035ed746c
```

`PDIVM` reported `isDavisStation=false`; station hardware, radiation shield,
roof/ground exposure, height, maintenance, and calibration are not assured.
That flag also means the documented v2 API may not support this exact station;
Pro/Pro+ eligibility must be confirmed with WeatherLink rather than assumed.
`CUAUTEPEC` appeared at almost the same public coordinate but read 86 °F while
`PDIVM` read 67 °F. The 19 °F divergence could reflect poor siting, bad
metadata, a nonstandard sensor, or privacy-rounded coordinates. Regardless of
cause, it disqualifies an automatic nearest-station-is-best rule.

The `/map/data/station/...` route is an undocumented browser endpoint and must
not become the production collector. WeatherLink's documented v2 API says a
station must be owned, shared to the account, or be public with a Pro/Pro+
upgrade applied by the API consumer:

- API introduction: <https://weatherlink.github.io/v2-api/>
- Data permissions: <https://weatherlink.github.io/v2-api/data-permissions>
- Rate limits: <https://weatherlink.github.io/v2-api/rate-limits>

For common WeatherLink station types, Pro access supplies the most recent
five-minute record and Pro+ supplies the most recent record. The default API
limit is 1,000 calls/hour and 10 calls/second. Those technical entitlements do
not automatically grant republication of a third party's data.

Production requires both the documented API path and explicit rights for the
selected station, retention, derived values, public/commercial display, and
market use:

```text
MEXICO_WEATHERLINK_ACCESS_APPROVED
WEATHERLINK_API_KEY=<separate credential>
WEATHERLINK_API_SECRET=<separate credential>
```

If approved, display each PWS separately with distance, observation age,
owner/provider attribution, and a persistent `nearby unverified PWS` badge.
Apply range, step-change, cross-station, and stuck-sensor checks. Never let the
PWS drive the official high or inherit an MMMX label.

#### Weather Underground / The Weather Company

Station discovery produced:

| Station     | Coordinate              |      Distance | Result                                                                                                       |
| ----------- | ----------------------- | ------------: | ------------------------------------------------------------------------------------------------------------ |
| `INEZAH5`   | `19.4616, -99.05416`    | about 3.41 km | Nearest found, but current observation was empty/offline                                                     |
| `IMEXIC159` | `19.479, -99.115`       | about 6.57 km | Active; timestamps advanced from 22:25:49Z to 22:26:37Z, a 48-second interval; 17.6 °C; QC status 1          |
| `IMEXIC225` | `19.399393, -99.142225` | about 8.41 km | Active with one exact five-minute-boundary timestamp; 23.7 °C at the check; consecutive rollovers unverified |

Human-facing dashboards:

- <https://www.wunderground.com/dashboard/pws/INEZAH5>
- <https://www.wunderground.com/dashboard/pws/IMEXIC159>
- <https://www.wunderground.com/dashboard/pws/IMEXIC225>

The documented current-observation request is shaped as:

```text
GET https://api.weather.com/v2/pws/observations/current
  ?stationId=IMEXIC159
  &format=json
  &units=m
  &apiKey=YOUR_KEY
```

- Current PWS API:
  <https://developer.weather.com/docs/openapi/pws-observations-current-conditions-2-0/get-v2-pws-observations-current-by-stationid>
- Current/historical product documentation:
  <https://developer.weather.com/docs/current-historical>
- Weather Underground data description:
  <https://www.wunderground.com/about/data>
- Weather Underground/The Weather Company terms:
  <https://www.wunderground.com/company/legal>

The consumer terms grant personal, noncommercial use and restrict automated
copying, publication, and distribution without express written permission.
Production needs a Weather Company commercial arrangement and any necessary
station-owner rights:

```text
MEXICO_WU_PWS_ACCESS_APPROVED
WEATHER_COMPANY_API_KEY=<separate credential>
```

Do not copy a key found in Weather Underground's frontend. As with WeatherLink,
these observations are fast nearby context, not an airport measurement.

`PDIVM` and `INEZAH5` are only about 15 metres apart in their published
coordinates, and `CUAUTEPEC` is pinned in essentially the same place. They may
be one device cross-uploaded to multiple services, several devices on one
property, or privacy-coarsened locations. Treat `provider + immutable station
ID` as the source key, maintain an explicit alias/hardware-identity table, and
do not count these feeds as independent corroboration until ownership and
hardware identity are established.

### UNAM PEMBU/RUOA: fast hardware, slow public files

UNAM's PEMBU station description says its Davis Vantage Pro2 sensors can report
to the console each second and the web display updates about every two minutes:

<https://pembu.dgenp.unam.mx/presentaci%C3%B3n/estaci%C3%B3n-meteorol%C3%B3gica>

The closest active site checked was CCH Oriente. Its RUOA page printed a
malformed coordinate, while its own map embed placed the campus near
`19.385349, -99.059292`, about 5.8 km from the airport reference:

- Station page: <https://ruoa.unam.mx/pembu/ccho-pembu/>
- Current HTML:
  <https://ruoa.unam.mx/pembu/datos/ccho/actual_plantel.html>
- Download file:
  <https://ruoa.unam.mx/pembu/datos/ccho/downld02.txt>

At `22:22Z` on July 31, 2026, the current HTML had last changed at
`22:00:24Z`, and the download rows were 30 minutes apart. Another nearby
station, ENP3, was stale since the previous day. The public delivery therefore
failed the claimed high-frequency test even though the hardware may sample
faster.

UNAM could still provide a direct one-/two-/five-minute feed. Written approval
must cover the direct product, automation, retention, attribution, and public
or commercial use:

```text
MEXICO_UNAM_PEMBU_ACCESS_APPROVED
```

### SENEAM AICM AWOS and PIIMET

This is the best path to investigate a potentially high-rate native airport
temperature feed. It is also the path where permission and operational-status
confirmation matter most.

SENEAM says its airport network measures temperature, dew point, pressure,
wind, visibility, clouds, and present weather. The current MMMX AIP entry lists
an H24 OSIV/CAPMA meteorological office, METAR/TAF service, and H24 D-ATIS on
127.650 MHz:

- <https://www.gob.mx/seneam/acciones-y-programas/meteorologia-aeronautica>
- <https://aipmexico.seneam.gob.mx/AIP/doc/AD/AD_2/38_MMMX/AD_2-MMMX-2.pdf?1599195905=>
- <http://capma.mx/manuales/Manual_Met_Obs/2019METOBS.pdf>

There is stronger evidence than the public METAR alone:

- The official 2022 procurement DOCX contains its scanned `Anexo Técnico` and
  `Apéndice A` as embedded PDF objects. The technical annex specifies six AICM
  automatic aeronautical weather stations. Annex PDF page 20 requires
  temperature-sensor accuracy of ±0.3 °C or better and 0.1 °C resolution;
  pages 31-32 separately require air-temperature and dew-point display refresh
  every **five seconds** at TWR and CAPMA/ATFCM. Pages 26-27 and 30 require a
  central unit retaining at least one year of sensor/event data, stored log
  files, and an alphanumeric/graphical web visualization application for remote
  users. This is the first official evidence of a high-rate internal AICM
  temperature path. It does not say that the GUI prints tenths, prove a
  five-second native sensor sample, identify an Internet deployment, or supply
  a public endpoint.
  For reproducibility, the extracted 46-page technical-annex PDF had SHA-256
  `FD8A5D16F8DD828A93020B6D75E200CCE622546862BCE3553068B23D14397257`;
  the five-page Appendix A PDF had SHA-256
  `BF6E955C2C83C89F8EA1828E29E9D9A9CDF5631B473C97543F189D2C0FA086FE`.
- Annex section 2.6, pages 18-21, resolves the official six-site MEX layout.
  The runway designators were already public in the AIP, but this sensor mapping
  is material new detail: physical runway `05R/23L` has `TDZ05R`, its own `MID`,
  and `TDZ23L`; physical runway `05L/23R` has `TDZ05L`, a separate `MID`, and
  `TDZ23R`. These are two reciprocal runway pairs with three station sites per
  strip, not four separate runways. Each of the six automatic stations must
  include wind, temperature/relative-humidity, pressure, precipitation and a
  data logger. RVR sensors use the same six positions; ceilometers are specified
  only at `TDZ05L` and `TDZ23L`; and MEX's one present-weather sensor is placed
  at `TDZ23L`. The scan reads `TDZ05L` with zero, despite plausible OCR as
  `TDZO5L`. Until the ICD supplies official identifiers, distinguish the two
  otherwise unlabeled sites as `MID-05R/23L` and `MID-05L/23R` in research data.
- Annex pages 15-17 and 29 specify the MEX topology as field sensors and VHF
  radiomodems feeding processing/distribution equipment, then TWR and CAPMA
  display workstations over an existing local network dedicated to
  meteorological equipment. Pages 21 and 37 mention spare RS-485/RS-232 logger
  interfaces and optional future AFTN/SWIM/AMHS integration. The annex requires
  standard aviation interfaces and Interface Control Documents, but names no
  HTTP API, MQTT broker/topic, JSON/CSV endpoint, FTP/SFTP path, database
  connection, hostname, port, manufacturer, model, operating system, or
  commercial software. Those operational radio, LAN, logger, remote-control,
  configuration, and calibration surfaces are explicitly out of scope; ask
  SENEAM for a provider-operated read-only mirror, export, or web/API service
  instead.
- Acceptance was not automatic. The annex requires FAT, IAT, PSAT, an
  operational-stability period, and FSAT, followed by signed delivery/receipt
  certificates. Appendix A separately lists installation, manuals, training,
  SAT, commissioning, warranty, and signed goods/services acceptance acts for
  AICM. The public convocatoria says payment required an original signed
  `Acta Entrega–Recepción de los Sistemas`. The specifications therefore name
  the exact commissioning evidence to request, but do not prove it was signed
  or that final acceptance occurred.
- The international tender was `LA-009C00001-E157/2022`, internally
  `009C00001-008/2022`, with contract reference `SENEAM-LPI-48/2022-MEX`. The
  historical CompraNet record identifies awardee Orvhemet S.A. de C.V.,
  contract `2903113`, expediente `2500815`, for USD 1,376,405 before VAT with a
  2022-11-18 08:00 to 2023-07-18 23:59 term. Fallo PDF pages 9-10 go further:
  the awarded line items explicitly name **Vaisala AviMet AWS310-SITE** for both
  Toluca (USD 585,850) and AICM (USD 790,555). This proves the awarded system
  make/model, not installation, successful AICM acceptance, or that a current
  CAPMA/PIIMET value comes from it.
- The downloaded `descargar expediente completo` ZIP was 177,543,455 bytes with
  SHA-256
  `F38EA7AECBFFA3A67C688529364F70251CABDDA18BD5EC43144DB56C27436FF9`.
  Its 12 entries comprise the portal-generated record plus the 11 advertised
  procurement files. It contains no bidder technical proposal, signed
  contract, bill of materials, system manual, FAT/IAT/PSAT/FSAT record,
  delivery-receipt certificate, or commissioning evidence. “Complete
  expediente” therefore does not mean the complete awarded technical offer.
- The official OCDS release independently confirms award/contract `2903113`
  and Orvhemet but exposes no contract documents, implementation section,
  proposal, BOM, ICD or acceptance record. Its current `terminated` contract
  status means only that the signed contract is closed; under the OCDS codelist
  it does not distinguish successful completion from early termination.
- A stronger publication lead exists in SENEAM's July 14, 2023 Transparency
  Committee act. Case `146/23`, printed page 77, lists
  `SENEAM-LPI-48/2022-MEX` as item 37 in the 2022 contract batch for SIPOT.
  Printed page 82, agreement `03/ORD/CT/14/07/2023.25`, approves public versions
  with only specified personal and financial fields classified. This proves the
  contract was included in a SIPOT publication batch, but not that every annex
  was uploaded. The historical SIPOT row and its `Hipervínculo al documento del
contrato y sus anexos` field remain useful publication metadata; the current
  public mirror described next is the stronger direct artifact.
- SENEAM's current public SIPOT mirror supplies the signed base contract in a
  dedicated `LPI 48` folder. Page 2 of the eight-page contract says signed
  `Anexo 1: Anexo Técnico y Apéndice A`, `Anexo 2: Propuesta Técnica`, and
  `Anexo 3: Propuesta Económica` are integral to it. The public PDF nevertheless
  ends at page 8 and includes none of them. The folder's `PREPOSICIONES` file is
  only the eight-page opening act; it is not the bidder submission. Thus the
  base contract has been recovered, while its decisive signed Anexo 2 remains
  omitted from the public package. The 7,429,799-byte contract hashes to
  `2D6F7829798A51BA9E7FDF755A96413386EFADED173ADE9E44DB2A2ADB02806E`.
- A separately published first amendment, signed January 15, 2024, records that
  the systems had been delivered since October 19, 2023 and assigns 88.97% of
  the USD 1,376,405 pre-VAT contract value to those goods. The remaining 11.03%
  covered installation, configuration, calibration, commissioning, training,
  acceptance tests and documentation. It also records SENEAM's suspension from
  January 16 through December 31, 2024 so those services would occur only after
  the necessary AICM/Toluca installation infrastructure existed. Goods payment
  required an original signed `Acta Entrega–Recepción de los Sistemas`; service
  payment required an original `constancia de aceptación de servicios` signed
  by SENEAM's technical area and Orvhemet. This proves equipment delivery and
  incomplete downstream work at the start of the suspension, not later
  resumption, installation, FSAT, payment or final acceptance. The 1,067,663-byte
  amendment hashes to
  `03D4C2C70BD84128F3EB15C718DC3AF2A71B7C3C3CB1FA8D04F67DF3B51524F4`.
- The current official PNT thematic Contracts index has one record for this
  contract, ID `b1KGmq3_O7wBRusB-jP2-A==`. It links exactly the eight-page base
  contract and one `hipervinculoampliacion`, the January 2024 amendment. A
  bounded search of all 30 current Orvhemet records, including nine SENEAM
  records, exposed no later resumption, payment, acceptance/FSAT, annex/BOM,
  ICD or native-sample link. This is a negative result for the current public
  index, not proof the underlying records do not exist. SENEAM's public
  amendment directory likewise lists only `/01`; targeted `-02`, `-03`, and
  `-2` filename variants under the 2022-2026 year paths returned `404`. That is
  only a bounded publication check, not proof that no differently named or
  unpublished later instrument exists.
- Opening-act PDF pages 15-16 preserve Acrobat `Recientes` screenshots of the
  missing bidder files. They show `Propuesta Tecnica ORVHEMET`, approximately
  39 MB, and `Propuesta Economica ORVH...`, approximately 7.3 MB, opened during
  evaluation on October 14, 2022. The opening checklist calls the bidder
  submission `PROPUESTA TÉCNICA (ANEXO 16)`, while the embedded model contract
  incorporates the awarded proposal as signed contract `Anexo 2: Propuesta
Técnica`, alongside `Anexo 3: Propuesta Económica`. Neither file is in the
  public ZIP. Use both annex labels in a filing to remove any ambiguity. The
  exact immediate retrieval target is therefore the awarded `Anexo 16` as
  incorporated in executed contract `2903113` / `SENEAM-LPI-48/2022-MEX` as
  signed Anexo 2, especially the approximately 39 MB `Propuesta Tecnica
ORVHEMET` PDF—not another copy of the generic tender annex.
- The fallo's four-bidder evaluation is an important lineage control. Orvhemet
  was the only legally, technically, and economically solvent offer.
  Ingeniería Geofísica y Sistemas/All Weather passed technically but failed the
  legal review; Defence Export's files could not be opened; and Telnorm passed
  the legal review but failed technically. The technical matrix labels the
  losing Telnorm column `TELNORM CAMPBELL SCIENTIFIC`. Campbell and All Weather
  are thus documented as competing lineages, not as the awarded AICM system.
- The accepted matrix marks Orvhemet compliant with a web-visualization
  application, configurable display software, source/configuration delivery,
  system migration, and three display units at CAPMA. It names no URL,
  authentication method, HTTP/API service, database, CSV/XML/JSON export,
  hostname, port, PIIMET mapping, or JPEG process. The first 12 fallo pages also
  repeat a wrong `E158/2022` ceilometer header. SENEAM's November 4, 2022
  rectification formally substitutes the correct `E157/2022` AICM/Toluca AWOS
  title and says that correction does not affect the remainder of the fallo.
- The clarification act narrows the internal architecture without revealing an
  endpoint. SENEAM calls CAPMA an operational data-display position and says
  the stored-log viewer must be installed on every listed display unit. A
  bidder proposed using a standard-browser web GUI for those display units;
  SENEAM did not confirm that implementation and left the technology/method to
  each compliant design. More usefully, SENEAM required the winner to deliver
  every password and access needed for SENEAM maintenance and hardware/software
  expansion, while its programming, compatibility, and security standards
  would be provided privately after award. This supports an administered
  export request to the data owner; it is not evidence of a public login or
  authorization to discover operational credentials.
- Vaisala's AWS310-SITE documentation identifies a concrete supported data
  route to ask SENEAM for. The station uses a QML data logger; AWS Client can
  connect over serial or TCP/IP, retrieve timestamped quality-status/value log
  entries, download daily binary `L0YYMMDD.dat` files, convert them to CSV, run
  scheduled downloads, and configure reports for transfer to an external
  system. The logger normally retains daily files on its external memory card
  for 366 days. These are documented product capabilities, not proof of AICM's
  setup, logging interval, field list, access policy, or current availability.
  A SENEAM/Vaisala-supported read-only export from the central data unit or a
  copied AWS Client/QML log is now a much more specific target than a generic
  request for an unnamed Disime API.
- The focused Orvhemet public-surface audit on August 4 found a brochure site,
  not a customer data service. The current homepage links only its corporate,
  products, services, news, and contact pages plus Vaisala and EKO; it has no
  customer-login, portal, dashboard, AviMet/AWS310 product-detail, manual,
  support-download, AICM, SENEAM, or `MMMX` link. Both `/robots.txt` and
  `/sitemap.xml` returned `404`. The collapsed Wayback URL inventory returned a
  2021 root-page capture, likewise a one-page corporate site with no portal
  link. Passive certificate
  transparency returned only the apex and wildcard names, which neither
  identifies nor rules out an unlinked customer host. No candidate subdomain,
  login, port, or operational service was guessed or contacted.
- Orvhemet does publish one real dashboard case, but the page itself makes it a
  negative control for AICM. Its news text describes a 20-station network made
  from Vaisala AWS810 stations, DMU801 loggers, WXT536 multisensors, AQT560 air-
  quality sensors, and Observation Network Manager NM10. The three public
  screenshots show NM10 version `4.8.1.2`, dates from January 31 through
  February 19, 2025, and station names including Tampico, Altamira, Ciudad
  Victoria, Matamoros, Reynosa, and Nuevo Laredo. They expose a map, current
  measurements, charts, reports,
  events, alerts, one-minute and ten-minute aggregates, history, health, and
  administrative controls. They show no browser address and Orvhemet links no
  live instance. This is credible evidence that Orvhemet can deliver and
  configure a Vaisala portal-style monitoring UI; it is not an AICM case study,
  an AviMet screen, an awarded-system acceptance record, or an `MMMX` endpoint:
  <https://www.orvhemet.com.mx/>,
  <https://www.orvhemet.com.mx/noticias.html>,
  <https://www.orvhemet.com.mx/assets/images/Noticia1.jpg>,
  <https://www.orvhemet.com.mx/assets/images/Noticia2.jpg>,
  <https://www.orvhemet.com.mx/assets/images/Noticia3.jpg>.
- Vaisala's 2020 NM10 datasheet is the strongest period-correct explanation for
  where an Orvhemet-delivered portal might live. NM10 accepts AviMet airport
  systems, persists observations/events in PostgreSQL and text logs, and offers
  configurable map, list, chart, wind-rose, text, report, and IFRAME widgets for
  real-time and historical data. It is a stand-alone Windows/Linux system
  installed on the **customer's premises**, configured per customer, with a
  username/password-restricted HTTPS UI. Its general export options include
  FTP/SFTP and WFS over HTTPS. Its RDP-over-HTTPS airport-system access is a
  maintenance/control surface, not a read-only data export and remains out of
  scope. The datasheet proves compatibility and an interface family, not that
  AICM bought, installed, exposed, or configured NM10:
  <https://www.vaisala.com/sites/default/files/documents/NM10-Datasheet-B211408EN.pdf>.
- Vaisala's period-correct AviMet AWOS brochure describes the central data unit
  and preconfigured operator workstations as the normal collection,
  calculation, storage, distribution, and display path. A separate Vaisala
  EANA case lists AviMet AWOS, RVR, and NM10 as distinct supplied components.
  That is strong lineage control: AviMet compatibility does not imply that
  NM10 was included. Likewise, current NM10 documentation's `Public API` and
  later `GET /measurements` material cannot be back-applied to Orvhemet's
  photographed `4.8.1.2` system or to AICM. Request the installed build and its
  version-matched manual/ICD before naming an API:
  <https://www.vaisala.com/sites/default/files/documents/WEA-AVI-Brochure-AWOS-B210848EN-E.pdf>,
  <https://www.vaisala.com/en/case/safety-efficiency-and-modernization>,
  <https://docs.vaisala.com/api/khub/documents/_GwXrTbmzzk6upP~A2zHdg/content>,
  <https://docs.vaisala.com/r/M213187EN-A/en-US/GUID-CC7BD793-9F62-47CF-A7A7-32B31A17DEA5>.
- Current Vaisala pages now advertise AviMet 10's browser UI and drag-and-drop
  dashboards, but Vaisala launched AviMet 10 on May 12, 2025, after the 2022
  award and October 2023 equipment delivery. Those current capabilities cannot
  identify AICM's awarded major version or prove an upgrade. The contract-
  required viewer could be an AviMet display, NM10, or another compliant
  implementation until the signed Orvhemet proposal/as-built BOM and viewer
  manual resolve it.
- Vaisala does operate customer-facing services, but neither is evidence of an
  observation dashboard. Official MyVaisala material describes support cases,
  contracts, orders, warranty/calibration records, certificates, and product
  documentation. Vaisala's separate AviMet Remote Monitoring and Diagnostics
  service is a Network Operation Centre health/diagnostics path over a VPN.
  MyVaisala and the NOC service must not be relabeled as an `MMMX` weather-data
  portal or queried for observations without an owner-supplied data interface:
  <https://www.vaisala.com/en/services/myvaisala-online-hub>,
  <https://www.vaisala.com/en/support-portal>,
  <https://docs.vaisala.com/api/khub/documents/1qibteD2sEntxWt~WPmJ3Q/content>.
- Period-correct Vaisala literature supplies search vocabulary, not AICM asset
  identification. A 2022 remote-monitoring document supports AviMet 8.0 onward;
  a 2017 datasheet names `CDU401` as an AviMet central-unit family; and 2020
  WID513 documentation shows an ATC display mode that rounds temperature to
  integer °C while MET mode displays 0.1 °C. AviMet 10 was launched only in 2025. Search the awarded BOM for AviMet build/module, `CDU401`, WID512/WID513,
  QML201C, AWS Client and Lizard, but do not attribute any of those optional or
  period products to AICM until the signed proposal, SDD or FSAT identifies it.
- SENEAM's 2018-2024 report, PDF page 41, calls the AICM/Toluca systems
  acquired, but says AICM meteorological civil infrastructure lacked 2023
  budget and remained in recalendarization during 2024. The annex makes SENEAM
  responsible for civil works, explaining how equipment could be acquired
  while field installation remained incomplete. The signed January 2024
  amendment now independently corroborates that sequence. An August 2023 AICM
  minute still described AWOS modernization as future work.
- The July 2025 civil-works notice is no longer the end of the public trail.
  SENEAM's current SIPOT mirror exposes the opening act, clarification act,
  fallo, signed base contract, budget-sufficiency record, convocatoria, advance
  invoice, and first amendment for procedure
  `LO-09-C00-009C00001-N-71-2025`, internal reference
  `LPN-OP-009C00001-008/2025`, and contract
  `SENEAM/DRM/MEX/LO/050/2025`. The August 15, 2025 fallo awarded the single
  civil-work package to **José Luis Flores Martínez**, not Orvhemet, for MXN
  6,803,103.05 including VAT. Orvhemet participated jointly with MC
  Construestructuras and passed the legal/administrative stage, but its 32.15
  technical score was below the 37.5-point threshold, so its economic offer was
  not evaluated. Orvhemet's bid documents its later participation; it does not
  make Orvhemet the 2025 construction contractor or prove completion of its
  separate 2022 supply contract.
- The signed civil contract is dated August 29, 2025 and provides 120 calendar
  days beginning on the business day after the advance. Its 30% advance was MXN
  2,040,930.91 including VAT; the public invoice is dated November 4 and the
  first amendment records payment on November 18. Amendment `/01`, signed
  November 19, consequently moves execution to **November 19, 2025 through
  March 18, 2026** without changing the 120-day term. This is the best
  documentary explanation for the 2025 public account: project `2309C000003`
  reports **41.8% physical cumulative progress** at year-end against MXN
  17,028,699 total investment, and MXN 6,803,103 modified and exercised—100%
  financial execution against the reduced modified allocation, not 100%
  construction completion.
- The contract keeps civil acceptance separate from AviMet acceptance. It calls
  for five completed-activity records in `Cédula de Avances y Pagos Programados`
  format `E-5`, verification, a physical-reception act, defect warranty,
  finiquito, and extinction of rights and obligations. The embedded Terms of
  Reference additionally require test results, final as-built plans, manuals,
  warranties, and operation/maintenance material for permanent equipment. The
  current public folder exposes only the advance invoice; it contains no later
  `E-5`, progress estimate, BESOP log, physical-reception act, finiquito,
  as-built package, or final invoice. That bounded negative result is not proof
  the records do not exist elsewhere, but the invoice must not be misread as
  payment for completed work. The directory index dates the amendment and
  invoice publications March 10, 2026 and has no other current hyperlink whose
  filename contains `LO-050-2025`; records can still live under another name,
  folder, procurement system, or non-public contract file.
- The convocatoria is technically much more valuable than its outer DOCX
  suggests. It embeds a 36-page Terms of Reference PDF and a 14-page
  `Memoria Descriptiva`. The latter explicitly defines the deployed family as
  **`Estación Meteorológica Aeronáutica Automática para Aviación AWS310 SITE
(AWOS)`**, describing wind, pressure, temperature/humidity, precipitation and
  present-weather observations sent to a central processing unit. Its site plan
  covers `TDZ23R`, `TDZ23L`, `MID-05R/23L`, `TDZ05R`, `TDZ05L`, and
  `MID-05L/23R`, plus paired RVR and two ceilometer areas. This is a second
  official, 2025 product-family confirmation independent of the 2022 fallo.
- The civil package also prevents an overclaim about what was already live. Its
  `Estado actual` says only **two older meteorological stations** were then
  installed and increasingly failure-prone. Elsewhere, the specifications call
  an AWOS tower/site `existing` at `TDZ23R`, `TDZ23L`, `TDZ05L`, and
  `MID-05L/23R`, while requiring new Vaisala `DKE200` tower foundations/towers
  at `MID-05R/23L` and `TDZ05R`. An existing base, tower, cabinet, or delivered
  station is not evidence that its AWS310 sensors, CDU, display, history, web
  viewer, PIIMET mapping, or service acceptance were operational. The source
  also contains apparent coordinate/label inconsistencies, so its coordinates
  are planning references until SENEAM releases the validated as-built station
  register and ICD.
- For reproducibility, the downloaded fallo hashes to
  `8A64A58480C8516EEB6B3A52CA3FE46AA7FF3C29E56AABA97BBEC859D88F11C6`;
  the base contract to
  `D8A6B322C1FE7A7D0400F21556A24A43C97728CF0668ADB2B6A3F16DDD62FCED`;
  amendment `/01` to
  `3AD77121F55D8AF008C05894A7004C8157B7400DE28490B2E9A8CD78B3F92A3B`;
  and the convocatoria DOCX to
  `62672B6D97618B9577130A0C76185255A38628D84A455983C91FD5C563900044`.
  Its extracted Terms of Reference and `Memoria Descriptiva` PDFs hash to
  `110BCC2D4B6C03391CFD18F2C839458525913EA28F6F48766387BF51269BF4E5`
  and
  `206E5AF29A8E0A9910D4ED22899CEAD0E2526799FBC7559A75EA3D2531F2000E`.
- SICT's 2025 work program, page 82, set a target of 100% completion of AICM
  AWOS/LIDAR civil work; page 37 says SENEAM had MXN 7.2 million in excess-
  income investment resources as of August 31. The public account is the
  stronger actual-status record. The 2026 SICT work program and federal
  investment annex checked do not name project `2309C000003` or a
  continuation/completion line. The current AIP,
  effective February 19, 2026, continues to list H24 OSIV/CAPMA products but no
  AWOS make/model, six-site inventory, PIIMET account, raw-data service, or
  commissioning state. These omissions do not prove cancellation. They leave
  the last affirmative public status as an amended March 18, 2026 civil-work end
  date with no located reception/finiquito, while no public FSAT, signed AviMet
  service-acceptance record, or production declaration was found through the
  August 4, 2026 sources checked.
- A full-text check of every ordinary SENEAM Transparency Committee minute
  listed for 2025 and through July 16, 2026 found no `AWOS`, `AviMet`, `Vaisala`,
  `Orvhemet`, `PIIMET`, AICM, civil-work, contract, project or procedure-ID hit.
  The 2023 and 2024 ASF SENEAM audits did not sample this Orvhemet award, and
  AICM's public Operations and Schedules Committee index stops at 2023. These
  oversight negatives cannot validate payment, completion, acceptance, or
  cancellation; they record where the evidence was not found and prevent those
  general audits from being misused as commissioning proof.
- The same SENEAM report, PDF page 47, says PIIMET, the `Plataforma de
Integración de Información Meteorológica`, entered operational use at CAPMA.
  Slide 12 of SENEAM's 2025 ICAO presentation visibly places an AWOS layer in
  PIIMET, but neither source supplies a current hostname, API, account method,
  MMMX identifier, cadence, or external interface. A separate archive pass did
  recover a 2021-2022 public PIIMET prototype at `capma.seneam.gob.mx`; its AWOS
  layer was static demonstrator data, not the operational feed described by the
  later report.
- The same 2025 slide actually depicts **two separate interfaces**. Beside
  PIIMET is a `Nueva página Web para Servicio Meteorológico Aeronáutico`, with
  headings for `METAR / SPECI`, `TAF`, `SIGMET`, `Contacto`, aerodrome and
  meteorological-watch offices, and external meteorological information. Its
  top navigation visibly says `SIGIMET`, and the screenshot contains a
  September 3, 2025 chart. It shows no browser address, login, API, export,
  station view, or Vaisala branding. This is strong evidence that SENEAM built
  or demonstrated another portal-style product surface; it is not evidence
  that the page is public or that it exposes native AWS310-SITE observations.
- Exact phrase/label searches, the public SENEAM sitemap, Wayback and public
  urlscan history exposed no deployed copy of that new page. The sitemap's
  newest `lastmod` was March 18, 2014 and contained no PIIMET, AWOS, AviMet,
  AWS310, NM10, or MMMX-dashboard URL. Current CAPMA navigation still links only
  the legacy frames/products and no PIIMET or new-service page. Passive records
  show a generic `app.seneam.gob.mx`, but no indexed title, archive, scan, or
  individual certificate identifies its purpose; confidence that it is weather
  related is low. Ask SENEAM whether it is the sanctioned service. Do not probe
  it or infer a login from the hostname.
- A current AFAC circular, `CO AV-1.03/25`, sections 4.6.1 and 7.4.1.5-.6,
  requires integrated automatic systems at the applicable instrument airports
  to measure air and dew-point temperature and show/distribute the value in
  real time to MET and ATS using the same sensors. This proves that an internal
  real-time value is the right target. It does **not** state its sampling
  interval, output resolution, or availability to third parties.
- SENEAM's November 14, 2024 Transparency Committee act, case `276/24`, PDF/
  printed pages 12-13, says an exhaustive search located two AWOS-procurement
  records and approved public versions with only `Firma electrónica`, `Cadena
Original`, and `QR` redacted: OIC memorandum `OIC09/040/066/2022` (PNT folio
  `330028524001267`) and Digital Strategy memorandum `CEDN/GD/1382/2022`
  (folio `330028524001268`). Request the already-approved public versions and
  complete electronic response attachments, not a fresh classification. The
  16,525,693-byte act hashes to
  `B6D8A03E532BBB0BBC1242FCA2D9ABC277F7FDA90974028A38C5A245F71B2803`.

#### CAPMA exact-page deep dive: live legacy-AWOS TDZ images, not the 0.1 °C feed

The suggested URL was worth the final pass. SENEAM's official CAPMA page calls
it the CAPMA portal, and AFAC circular `CA AV-019/14 R2` specifically points to
the exact URL for consulting CAPMA SIGMETs:

- <https://www.gob.mx/seneam/acciones-y-programas/centro-de-analisis-y-pronosticos-capma>
- <https://www.dof.gob.mx/2024/SICT/ca-av-019-14-r2-31-ene-24r-07022024.pdf>
- <http://capma.mx/capma/capma.html>

The exact page is a 500-byte static frameset, not an application shell. It
loads `menu.html`, `aft.html`, and an initially blank `central.html`. The current
menu's visible `DATOS MMMX` route leads to this owner-published chain:

```text
/capma/capma.html
  -> /capma/menu.html
  -> /capma/dts.html
  -> /capma/pista05.php -> /banco/pista05.jpg
  -> /capma/pista23.php -> /banco/pista23.JPG
```

The two wrapper pages contain only an `<img>` and have no refresh instruction.
The portal and the relevant linked pages have no external script bundle,
`fetch`, XHR, WebSocket, EventSource, cookie/session hook, or hidden JSON/CSV/XML
request. A browser therefore keeps the loaded snapshot until the user reloads;
the fact that the server-side JPEG later changes does not make the page a
five-second live viewer.

The JPEGs are nevertheless real, current airport-display captures. Both are
`1366 x 768`, identify Aeropuerto Internacional de la Ciudad de México,
`MMMX`, runway `05/23`, and either `TDZ:05` or `TDZ:23`, and show:

- current temperature and dew point;
- separate two-minute wind, temperature, dew-point, and QNH fields;
- humidity, station pressure, QNH, current wind, ten-minute gust, crosswind,
  and current/previous-hour precipitation; and
- a date and clock with seconds.

Those generic legacy labels cannot be mapped from the public pixels to the 2022
annex's `TDZ05R` versus `TDZ05L`, or `TDZ23L` versus `TDZ23R`, positions. A
screen could represent either runway end, a selected/composite value, or the
older installation. Do not relabel `pista05.jpg` or `pista23.JPG` with an L/R
suffix until an ICD, as-built mapping or SENEAM confirmation establishes it.

The screens print position `192611N 0990419W` and elevation `7297 ft`. That
position converts to about `19.436389, -99.071944`, only about 0.159 km from
the documented MMMX reference point. Because both TDZ screens print the same
position, it is a display/airport reference and must not be stored as either
thermometer's verified coordinate.

A reproducible pair of samples was fetched on August 3, 2026:

| Public file   | HTTP check  | `Last-Modified` | Embedded screen time | Current / 2-minute temperature | Dew point | SHA-256                                                            |
| ------------- | ----------- | --------------- | -------------------- | ------------------------------ | --------- | ------------------------------------------------------------------ |
| `pista05.jpg` | `22:59:54Z` | `22:59:04Z`     | `22:59:04Z`          | `25 °C / 25 °C`                | `5 °C`    | `44F24687529EA79A7CFC9DB56434171738ECA1F7CDFCA6ADCE64B438E239A99E` |
| `pista23.jpg` | `22:59:55Z` | `22:59:39Z`     | `22:57:44Z`          | `25 °C / 25 °C`                | `5 °C`    | `D53BE7DC905B46FEC6AC163B9053EA689D0C0B4B396BABB81C654BBF7CB9896D` |

An earlier `PISTA 05` capture at `22:55:58Z` showed current `25 °C` but a
two-minute value of `26 °C`, confirming that those two fields are not merely
duplicate labels. The comparison became stronger at the next report arrival:
the `23:00:14Z` PISTA 05 screen showed current `25/6 °C`, current wind
`130/9 kt`, and two-minute `25/5 °C` with wind `100/4 kt`. Six seconds later,
AWC recorded receipt of `METAR MMMX 032250Z 13014KT ... 26/05 ...`. The image is
therefore not merely re-rendering the latest whole-degree METAR; it carries
distinct local/runway display values. That supports native display provenance,
but does not identify the sensor, averaging/rounding rules, official status, or
whether PISTA 05 and PISTA 23 are independent thermometers.

At the METAR's own `22:50` observation minute, a PISTA 05 screen showed current
`26/6 °C` and two-minute `26/5 °C`; the two-minute temperature/dew point matched
the METAR's `26/05`, while its current and two-minute wind values did not match
`13014KT`. The screens may feed or share local instrumentation with the
observer workflow, but this single alignment is not a sensor-selection or
averaging contract.

The public delivery cadence is separate from the second-resolved screen clock.
A bounded conditional-GET run, with requests starting roughly 5.8-6.7 seconds
apart, observed:

- `pista23.jpg` `Last-Modified` states at `22:59:39`, `23:00:39`,
  `23:01:39`, `23:02:39`, `23:03:39`, `23:04:39`, `23:05:39`, and
  `23:06:39Z`: exactly 60 seconds apart. Inspected embedded clocks advanced by
  the same 60 seconds but stayed exactly 115 seconds behind the public file
  time. The test cannot distinguish relay delay from source-clock skew;
- `pista05.jpg` embedded/file times at `23:00:14`, `23:01:16`, `23:02:18`,
  `23:03:20`, `23:04:22`, `23:05:47`, and `23:06:49Z`: deltas of 62, 62,
  62, 62, 85, and 62 seconds. Every visually checked embedded clock equaled
  its HTTP `Last-Modified`; and
- both `If-None-Match` and `If-Modified-Since` returned `304 Not Modified`, so
  a future approved experiment can avoid retransmitting unchanged images.

There is an update race: twice, the first read just after a `PISTA 23` rollover
returned a valid JPEG with a weak ETag, then a later read returned a different
valid JPEG body and strong ETag with the **same** `Last-Modified`. File time is
therefore not a unique observation key. Any approved collector must validate
the JPEG, preserve the embedded clock, hash the body, and handle a transient
write without treating one mtime as one immutable image.

That bounded window establishes neither a long-run service level nor native
sensor cadence. It does establish that the public path is sub-hourly and that
the two files have different publication behavior. The correct immutable keys
would initially be display `TDZ:05`/`TDZ:23`, embedded screen time, and content
hash—not a guessed AWOS station ID.

##### Exact GUI identification: legacy SENEAM telemetric AWOS

A public six-page copy titled _Manual Operativo de la Estación Telemétrica
AWOS_ resolves the GUI identity with high confidence. Its first page contains a
January 29, 2014 AICM/MMMX screenshot with the same blue-and-white panel
geometry, `192611N 0990419W` position, runway `05/23`, current and two-minute
field groups, runway/wind graphic, and exit control as the current CAPMA images.
The old screen says `CABECERA:05` and elevation `7316`; the current revision says
`TDZ:05`, elevation `7297`, and `SIN HISTORICO`. The second page shows the same
application at MMCE/Ciudad del Carmen, confirming a reusable multi-airport
SENEAM application rather than an AICM-only webpage.

The manual describes this architecture and behavior:

- meteorological sensors are installed beside the runway in the touchdown zone
  and transmit readings by radio to a computer whose display is available in
  the Control Tower;
- the application presents temperature, humidity, wind, station pressure,
  precipitation, dew point, and QNH to Tower and OSIV users;
- it starts automatically with the workstation and supports day/night modes;
  and
- it writes one instantaneous station record every minute to an automatically
  generated monthly file under `C:\historico`. The documented fields include
  ICAO, runway/head, timestamp, wind and gusts, whole-degree temperature and dew
  point, QNH, station pressure, and rainfall.

This is unusually strong technical evidence, but not first-party
authentication. The surviving copy is a public Scribd upload by user
`mario_fregoso`; no official or independently hosted copy was found through
exact-title, distinctive-text, SENEAM, `gob.mx`, or CAPMA searches. Its footer
names SENEAM's `Subdirección de Meteorología`, and the content exactly matches
the live screen, but the uploader is not authenticated as a SENEAM employee.
The six pages state no publication or revision date; “2014 manual” would be too
strong. The year comes only from GUI screenshots dated January 29 and July 1, 2014.
The manual names no vendor, sensor model, radio protocol, API, database, network
address, executable, or current asset ID. It therefore identifies the legacy
application lineage, not the hardware now feeding it and not the separately
procured 2022 AWOS/PIIMET system.

The current screen's `SIN HISTORICO` message may indicate that the documented
local history path is unavailable; that interpretation is an inference, not a
defined status found in the manual. The live values and advancing clocks prove
that the display itself is not frozen, but the public pixels do not prove that
the legacy one-minute file is still being written. The appropriate request is
for a SENEAM-supported numeric export of that schema or its current replacement,
not access to the workstation or its `C:` drive. Because the legacy schema
documents integer temperature/dew-point fields, that export may still be only
whole-degree; it is a structured high-cadence lead, not evidence of hidden
0.1 °C precision.

CAPMA's public bank also contains `MMTJ_P27.jpg`, a visibly different Windows XP
application whose title says `ESTACION METEOROLOGICA VAISALA`. Its public file
mtime advanced while the embedded clock remained roughly 35 hours stale. This
proves that CAPMA's minute-copy layer can republish a stale workstation screen,
so collectors must use embedded time rather than file mtime. It also shows what
an explicitly labeled Vaisala screen elsewhere in the same bank looks like; it
does **not** identify the unbranded MMMX application as Vaisala.

Historical procurement and integrator evidence substantially narrows—but does
not close—the legacy vendor question. Campbell Scientific's original 2009 case
study says SENEAM contracted Disime, Campbell's Mexican representative and
system integrator, for six airport weather stations. In that documented design,
sensors connected to Campbell `CR10X` and later `CR850` dataloggers, the logger
broadcast data by VHF radio to a PC, and Disime set up the display software for
customer and ICAO requirements. The original PDF's screen identifies Veracruz
`MMVR`, runway 18/36, and `AWS-2.2 V51`; the current gallery photo identifies San
José del Cabo `MMSD`, runway 16/34. Both use a materially different black/green,
English-language interface rather than the blue/white Spanish application in
the AWOS manual's 2014 screenshots. The case does not enumerate all six airports, mention
MMMX, name the software author, define its logging path, or say that every
sensor was made by Campbell. “Set up” establishes Disime as integrator/software
configurator, not necessarily application developer.

Official procurement adds an AICM-specific Disime link. CompraNet 3.0 file
`LP2010.csv`, line 34213, records SENEAM international tender
`09111003-008-10`, contract `20100143SNF`, for ten meteorological data-capture
and transmission units awarded to Disime on September 10, 2010 for MXN
3,116,500 before VAT. SENEAM's official 2006–2012 accountability report, printed
page 70, places the corresponding 2010 acquisition at airports in México D.F.,
Guadalajara, Mérida, and Tijuana. This is a cross-document inference—neither
record alone contains both supplier and airport—but it directly associates
Disime with the AICM capture/transmission layer.

A 2007 official award also names Disime for five SENEAM telemetric stations at
Ciudad del Carmen, La Paz, Los Mochis, San José del Cabo, and Veracruz. This
aligns with two identifiable Campbell-case images and makes Disime a credible
lineage candidate for the later blue application shown at MMCE and MMMX. It
still does not prove that AICM used a Campbell logger, that Disime authored the
blue GUI, or that the 2014 local-history files were Campbell software. The best
bounded attribution is therefore **documented AICM legacy integrator candidate:
Disime; exact blue-GUI author and AICM logger/vendor: unconfirmed**.

Disime's current <https://disime.com.mx/meteorologia.html> supports the capability
side of that inference: it advertises meteorological, temperature, humidity,
logger, communications, and related integration work. It does not publish the
AICM data. The current site is a static product brochure with no observation
request, API, WebSocket, station selector, or customer-data portal in its client
code. A review of 909 archived HTTP-200 Disime URLs found product/catalog,
LoggerNet, WeatherLink, and a generic application-login surface, but no
CSV/JSON/DAT/log/history/database export or SENEAM/MMMX station route. Disime's
DNS is also wildcarded: arbitrary made-up subdomains return the same brochure,
so names resembling `api`, `portal`, or `awos` are not evidence of services.
This leaves Disime as a strong integrator/contact lead, not a discovered data
host, and is consistent with the documented logger/radio/local-PC architecture.

Crucially, every visible MMMX temperature field is a whole number of degrees
Celsius. The JPEGs contain no EXIF/comment metadata identifying software or a
raw value—only ordinary JFIF 1.1/96-dpi image metadata—and neither the pixels nor
their pages say `AWOS` or `PIIMET`; the identification comes from the external
matching manual. CAPMA's May 2019 observer manual does not reveal a hidden
decimal feed either: its ambient-temperature reporting instruction uses whole
°C, and it lists `AWOS SENEAM` among telemetric equipment separately from All
Weather, Davis, Grome, Qualimetrics, and Vaisala. Its nearby `0.1` entry means
millimetres of precipitation, not temperature precision. An old CAPMA
`datosmmmx.html` page, visibly dated March 30, 2015, links the same two image
filenames on an RFC 1918 host. The screenshot bridge therefore predates the
2022 procurement and cannot be used as evidence that the new contract AWOS or
its remote web viewer was commissioned.

##### Live METAR rollover comparison

A bounded rollover test ran from `2026-08-03T23:52:31Z` through
`2026-08-04T00:02:41Z`. CAPMA image requests were conditional and roughly 15
seconds apart, with bodies saved only when their SHA-256 changed; AWC was called
no more often than every 65 seconds. The new routine report was:

```text
METAR MMMX 032345Z 03018KT 9SM VCRA BKN020CB BKN080 OVC220 22/10 A3022 TEMPO 6SM TSRA RMK SLP068 57006 903 8/963 HZY PCPN W
```

The nearest available post-observation display states were:

| Source/state        | Embedded or observation time | Temperature / dew point | Wind        | QNH/altimeter |
| ------------------- | ---------------------------- | ----------------------- | ----------- | ------------- |
| Routine METAR       | `23:45:00Z`                  | `22 / 10 °C`            | `030/18 kt` | `A30.22`      |
| PISTA 23 current    | `23:49:46Z`                  | `22 / 11 °C`            | `360/4 kt`  | `30.23`       |
| PISTA 23 two-minute | `23:49:46Z`                  | `22 / 11 °C`            | `360/3 kt`  | `A30.23`      |
| PISTA 05 current    | `23:51:43Z`                  | `22 / 10 °C`            | `360/12 kt` | `30.23`       |
| PISTA 05 two-minute | `23:51:43Z`                  | `22 / 10 °C`            | `010/14 kt` | `A30.23`      |

Both displays therefore matched the new METAR's whole-degree temperature in
the nearest captured frames. PISTA 05 also matched its dew point; PISTA 23's
current dew point reached `10 °C` on its next embedded screen at `23:50:46Z`.
Neither display matched the METAR's wind, and displayed QNH was `0.01 inHg`
higher. Most decisively, PISTA 23 current temperature changed to `21 °C` at
embedded `23:55:46Z` while its two-minute value stayed `22 °C`; PISTA 05 changed
to `21 °C` at `23:59:35Z`. The published METAR remained `22 °C`. These are live,
independently changing local display values, not a static rendering of the
METAR report.

The preceding `SPECI MMMX 032335Z ... 23/10 A3022` gives a second comparison.
PISTA 05 at `23:37:54Z` matched its temperature, dew point, QNH, and current wind
direction, although displayed speed was `14 kt` rather than `20 kt`. PISTA 23 at
`23:35:46Z` showed `22/9 °C`, `A30.23`, and only matched the current wind
direction. Across the two reports, thermodynamic fields look more consistent
with TDZ 05, but this is only suggestive: the frames were not simultaneous,
integer rounding can hide differences, neither display's wind consistently
matched, and the METAR may use another reference sensor or an operator-selected
composite.

CAPMA's public AFTN page was first observed with the `032345Z` report at
`23:54:26Z`. The first bounded AWC poll containing it was `23:59:23Z`, and AWC's
initial `receiptTime` was `23:59:16.677Z`; CAPMA was therefore observed with the
report at least 4 minutes 50.7 seconds before that AWC receipt. AWC changed
`receiptTime` to `00:00:07.401Z` for the identical raw report on the next
response. This is a relay-delivery result, not sensor latency, and reinforces
the need to preserve an immutable collector `firstSeenAt` and raw hash rather
than treating a provider receipt field as immutable.

A second check during a new `SPECI` supplied an independent result. At
`2026-08-04T03:42:49Z`, CAPMA's report page still showed
`SPECI MMMX 040332Z ... 16/12 A3033 ...`. Post-observation PISTA 23 and PISTA 05
screens embedded `03:36:55Z` and `03:39:08Z`, respectively; both instead showed
current `17/12 °C`. Their local wind also differed from `27010KT`. The runway
screens therefore remained independent of the published report even when the
report was already present on the same CAPMA server.

##### Automated CAPMA report endpoints: METAR-derived, not raw AWOS

The public `/reportemetar/` directory did reveal an automated station-data
surface, but its provenance is report text rather than the runway sensor stream:

- <http://capma.mx/reportemetar/elegir_samx_3.php> presents the latest SAMX
  METAR/SPECI for each station, and its published MMMX link
  <http://capma.mx/reportemetar/buscar_samx.php?id=MMMX> returns recent raw
  report history as server-rendered HTML;
- <http://capma.mx/reportemetar/gramet.php> is a station index whose published
  MMMX target <http://capma.mx/reportemetar/metartodos.php?id=MMMX> generates an
  on-demand `1800 x 1000` PNG. Its title is `Gráfica de Temperatura, punto de
rocío y altímetro de MMMX`; and
- during the test, the graph's latest point was the regular `040250Z` METAR at
  `17/12 °C` and `A3032`, exactly matching AWC. The later `040258Z` and
  `040316Z` SPECIs were already present in CAPMA/AWC but absent from the graph.
  Its exact report timestamps, integer fields, and omission of the newer
  special reports rule out a continuously sampled AWOS source.

The chart index contains no JavaScript, form, iframe, polling, or refresh
instruction. Its PNG response is generated at request time and advertises
`must-revalidate, no-cache`; two immediate bodies were byte-identical. Other
promisingly named public report pages either returned ordinary METAR material,
an access-error page, or blank HTTP 500 responses without data. No form was
submitted and no session was authenticated. This branch is useful as a
low-latency CAPMA report relay, but it does not expose 0.1 °C or five-second
AWOS observations.

CAPMA's ETDS page at <http://capma.mx/banco/ETDS.HTM> is an hourly departure
forecast, not raw observations. Beyond the METAR/report endpoints above,
publicly linked pages, exposed read-only directory indexes, search indexes,
Wayback captures, `robots.txt`, and `sitemap.xml` exposed no numeric AWOS/PIIMET
endpoint or decimal-temperature file. A read-only sweep of all 79 text/HTML/JS/
CSS entries explicitly listed by the public `/capma/` directory likewise found
zero `AWOS`, `PIIMET`, `fetch`, XHR, WebSocket, or EventSource matches; runway
references were JPEG links only. No private address, login, report-editing
route, port, or guessed vendor path was accessed.

All CAPMA routes are plain HTTP; port 443 did not accept a connection during
the check. The linked images' reachability is not automation, retention, OCR,
or republication approval. SENEAM's published site conditions describe a
personal, noncommercial visit/print permission and reserve broader copying,
publication, transmission, derivatives, and other reuse without prior written
consent. SENEAM/CAPMA should identify the current hardware and sensor IDs behind
the legacy telemetric-AWOS GUI and provide a supported numeric HTTPS export of
its documented one-minute schema or the current replacement. Until exact-path
scope is approved, the screenshots remain a high-value research finding, not a
production collector.

#### Recovered 2021-2022 PIIMET prototype: the public AWOS layer was a mock

The last archive pass recovered the historical SENEAM-CAPMA PIIMET web surface
at `capma.seneam.gob.mx`. This is the missing portal lineage, but not the missing
live feed. The archived public chain was:

```text
/alejandra/vis_seneam.php  "Visualizador SENEAM-CAPMA"
  -> /alejandra/f_piimet.php
  -> iframe /alejandra/d_piimet.php
  -> /alejandra/js/markers.js
  -> /alejandra/js/piimet.js
```

The landing/navigation source labels the PIIMET link `Demo` in a commented
block, although direct PIIMET pages and a later card were publicly reachable.
The display is a Leaflet layer viewer. Its `AWOS` group points only to a
`markerClusters` object populated by the 1.4 KB `markers.js` file. That file is
a four-record JavaScript literal for MMMX, MMMY, AIFA, and MMGL—not a request to
a service:

- every airport repeats the identical `SPECI MMMX 010031Z ... 15/M02 ...`
  string and common QNH/QFE/humidity/visibility/precipitation/SLP constants;
- MMMX's separate display literal says `23°,17°`, contradicting the embedded
  report's `15/M02`; and
- the client has zero `fetch`, XHR/AJAX, WebSocket, EventSource, reload,
  `setInterval`, or `setTimeout` calls for AWOS. Three runway-temperature
  values—`20.5`, `24.5`, and `23.5 °C`—are also source-code literals located
  around AIFA rather than AICM.

The archived `markers.js` response was captured in June 2022 but carried an
origin `Last-Modified` date of June 25, 2021, further weighing against a live
feed.

The same bundle did contain genuinely automated products: current-for-capture
FV3-GFS JSON, MMMX model-sounding data, a model wind grid, and WMS-backed
forecast/satellite/surface-analysis layers. The WMS branch used a PHP proxy to
an internal RFC 1918 service; it was not an AWOS observation service. Sensitive
connection material present in archived source was redacted, not used, and is
not reproduced here.

A bulk audit of 215 archived HTML, 204 JavaScript, 73 JSON, and 143
query-bearing URL keys found no second marker source, AWOS API, refresh worker,
or numeric observation route. This makes the recovered public build a
prototype/demonstrator with static AWOS placeholders. It does **not** show that
the later operational PIIMET installation uses placeholders.

That distinction matters because the later official evidence is real. SENEAM's
August 2024 consolidated report says PIIMET was implemented operationally at
CAPMA. The 2025 ICAO slide shows the same distinctive Leaflet layer taxonomy as
the archive—`GOES-16`, `FV3-GFS`, `WRF`, `AWOS`, `NHC`, surface analysis,
SENEAM sectors, management regions, and SENEAM airports—and the following slide
depicts workstation use at OMA/CAPMA, OVM/Tulum, OVM/MEX, and ACC MEX, with the
latter sites labeled 2024. This is
strong visual/codebase lineage and evidence of a later institutional
deployment. It is not evidence that the archived dummy values became a public
API, that current PIIMET is Internet-accessible, or that its current AWOS layer
contains the 2022 AICM system.

The historical hostname still resolves, but bounded root HTTP and HTTPS reads
timed out; no current page or data was obtained. Passive certificate/DNS,
official-site, sitemap, open-data, archive, and source-code searches found no
current public PIIMET/AWOS hostname or supported machine-readable route. No
login was attempted, no private service was contacted, and no archived secret
was used. The exact route must come from SENEAM/CAPMA or the system supplier.

#### August 3, 2026 public-surface verification

A bounded follow-up used only owner-published pages, documents, and links. It
did not scan or guess hosts or ports, inspect the airport network, intercept
VHF, attempt PIIMET authentication, or touch an AWOS control surface.

- Visual inspection of SENEAM's 2025 ICAO deck confirms that the current PIIMET
  visual includes an `AWOS` layer, but the screenshot exposes no current URL,
  API, account method, or automation contract. Its layer names closely match
  the recovered 2022 prototype; the archive identifies historical application
  lineage, not the current operational data backend.
- AICM's current 2026 open-data plan contained 168 publication-plan rows and no
  meteorology, weather, temperature, AWOS, or SENEAM dataset. This does not
  prove that AICM can never publish weather data, but it supplies no current
  open-data route to the five-second display path.
- At about `22:08Z`, CAPMA's public station page and AWC both showed
  `METAR MMMX 032150Z ... 25/06 ...`. AWC recorded upstream receipt at
  `22:00:16Z`; CAPMA supplied the same whole-degree report and recent report
  history over plain HTTP. Neither public response contained the 0.1 °C AWOS
  field or a native sensor sample.

No provider-published **current, operational** machine-readable connection
target was available for the legacy display values or the 2022 AWOS/PIIMET
system. The historical public `markers.js` target is machine-readable only in
the literal sense; it is demonstrator data and cannot support a collector.
Therefore no direct AWOS or current PIIMET connection was attempted, and there
is no supported interface against which a safe Convex collector can yet be
implemented.

#### Commissioning must be confirmed first

Acquisition is not proof that the current AICM system is fully accepted and in
production. SENEAM's 2024 report described AICM civil infrastructure as
pending/recalendarized; the July 2025 tender then covered AWOS bases, towers,
and ducts. The 2025 public account shows 41.8% physical/cumulative project
progress and 100% execution of the modified financial allocation. These facts
weigh against assuming full 2022 field installation and acceptance, while not
proving that every acquired component was offline.

Before requesting credentials or trying any protocol, ask SENEAM for:

1. the site-acceptance or commissioning date and current production status at
   `MMMX`;
2. signed IAT, PSAT, operational-stability, FSAT, delivery/receipt, and
   commissioning records;
3. whether the live temperature is currently visible in the legacy telemetric-
   AWOS application, the annex-required web application, PIIMET, CAPMA, OSIV,
   TWR, and APP, and whether these are distinct systems or relays;
4. the exact system vendor, model, software version, station/site ID, sensor
   model, and sensor coordinates; whether Disime authored or only integrated the
   blue GUI; and which AICM assets were delivered under contract
   `20100143SNF`; and
5. whether NM10 was included in the delivered AICM/Toluca BOM; if so, its exact
   build, installation owner/location, six-site mapping, SENEAM-administered
   read-only observation role, viewer URL, and version-matched export/API/ICD;
   if not, identify the supported AviMet CDU or central-history export; and
6. the awarded proposal, asset inventory, SDD, ICD, as-built/interface
   diagrams, redacted web-viewer manual, a provider-supported read-only export
   of the legacy one-minute schema or current replacement, and the responsible
   system administrator.

The public fallo establishes that Orvhemet offered `Vaisala AviMet
AWS310-SITE`; it still does not establish installation, commissioning, current
software version, or the installed protocol. Vaisala documents continuous
real-time AviMet reports and supported output interfaces, while AWS Client
documents QML log retrieval and CSV conversion. That makes a vendor-supported
read-only export concrete rather than hypothetical, but supplies no authority
to connect to an operational station or guess ports. Ask SENEAM for the awarded
proposal, current asset inventory, and an administered export.

`Vaisala AviMet` is also unrelated to SEMAR/DIGAOHM's mobile alert application
named `AVIMET`. The shared name must not be used to infer a shared broker,
owner, protocol, or data source.

#### Preferred direct AWOS request

First ask for a provider-operated, read-only numeric export of the legacy
telemetric-AWOS application's documented one-minute station record or its
current replacement. Also ask about automated access to the contract-required
AICM web visualization application. If neither is suitable, ask SENEAM for a
central-unit log/API/database mirror, file export, or push relay selected by
SENEAM. Explicitly exclude workstation-drive access, equipment control,
configuration changes, direct logger/serial access, VHF interception, the
airport LAN, ATC operational use, other airports, and publishing unless
separately approved.

The Orvhemet audit supplies no login URL. Ask SENEAM whether the viewer is an
AviMet workstation surface, an NM10 instance, or another implementation and
whether it is hosted on SENEAM premises. If NM10 is present, prefer a dedicated
read-only observation role and a documented Public API/WFS/SFTP mirror that
matches the installed build. Do not request an Orvhemet/Vaisala administrator
account, `root` access, RDP, a QML maintenance socket, or a logger control path.

The request should require:

- exact station, site, sensor, and field identifiers;
- native sample, averaging, output, and delivery intervals;
- temperature units, numeric resolution, sensor accuracy, and rounding rules;
- raw versus validated/QC fields and every status, maintenance, or missing-data
  flag;
- UTC observation/acquisition time, system receipt time, publication time, and
  expected latency;
- authentication, source-IP restrictions, rate/session limits, reconnect
  behavior, and support/security contacts;
- a 72-hour representative sample and data dictionary before live access;
- permitted Convex retention duration, internal research/derived use, public
  or commercial display, redistribution/export, attribution, and expiration.

Suggested Spanish wording:

```text
Solicitamos autorización expresa para acceso automatizado y de solo lectura a
la temperatura del aire del AWOS de AICM/MMMX, ya sea mediante la capa AWOS de
PIIMET o una exportación/API directa soportada por el proveedor. Favor de
confirmar que el sistema está aceptado y en producción, sus identificadores de
estación/sensor, coordenadas, intervalo nativo de muestreo/promedio/salida,
resolución, campos crudos y validados, banderas de calidad, marcas de tiempo y
latencia, límites de sesión/consulta, retención permitida en Convex, uso
derivado, exhibición pública/comercial, redistribución, atribución y vigencia.
Se excluyen expresamente control o configuración, uso operacional ATS, otros
aeropuertos y publicación sin autorización separada.
```

Use separate gates because transport access does not imply storage or public
display:

```text
SENEAM_MMMX_AWOS_ACCESS_APPROVED
SENEAM_MMMX_AWOS_RETENTION_APPROVED
SENEAM_MMMX_AWOS_REPUBLICATION_APPROVED
```

The first bounded live test should subscribe to or request only the named
MMMX temperature/status fields, perform no writes, and measure source cadence
separately from delivery cadence. It should stop at its approved duration and
byte/request limit. No connection should be attempted until SENEAM supplies
the sanctioned interface and confirms the commissioned system.

These three flags currently read back as exact `true` in both Convex
development and production, but they are **premature/misconfigured**, not an
active compliant release. SENEAM supplied no exact interface and no repository
code enforces the gates. Remove the production values, then use an
interface-specific access flag only after approval is bound to the exact URL,
transport, six AICM station IDs/fields, credentials, limits, and intended use.
Retention and republication remain separately scoped. Until that setup packet
exists, return `setup_required` rather than trying likely vendor ports or
hostnames.

#### PIIMET fallback

If direct AWOS export is unavailable, request a read-only PIIMET account and a
documented API or export limited to the MMMX AWOS temperature/status layer:

```text
SENEAM_PIIMET_MMMX_ACCESS_APPROVED
```

The scope must say whether browser automation is permitted or whether SENEAM
will provide a machine interface. A login does not authorize scraping, VPN
discovery, other stations/layers, or data retention. Retention and
republication still require the two AWOS flags above. PIIMET is a potentially
excellent sanctioned interface because SENEAM documents a later operational
deployment, but it has not been shown to expose a current one-minute field
externally. The recovered 2022 `markers.js` is a static public demonstrator and
must never be accepted as fulfillment of this request.

The 2025 screenshot makes the portal questions exact: ask for the owner-issued
URL and deployment status of the slide-12 `Nueva página Web para Servicio
Meteorológico Aeronáutico`; what its `SIGIMET` navigation label identifies;
whether that site and PIIMET are public, partner-only, or SENEAM-intranet
services; whether either exposes a read-only MMMX AWOS view or supported
API/export; and whether `app.seneam.gob.mx` hosts either service. The last
hostname is only a low-confidence passive lead and must not be contacted until
SENEAM identifies it and grants the exact scope.

#### Formal data and technical-document routes

The official `SENEAM-02-002 Información Meteorológica - Datos Meteorológicos`
service is a fallback for a native sample, archive, data dictionary, or bespoke
export. A February 2026 simplification removed the free-form-letter requirement
and reduced the maximum response time from 90 to 45 business days; the process
still calls for the request form, proof of identity/legal personality, and
proof of payment. It is a formal data route, not evidence of a live API:

- <https://www.gob.mx/tramites/ficha/estadisticas-de-informacion-meteorologica/SENEAM5293>
- <https://www.dof.gob.mx/nota_detalle_popup.php?codigo=5780615>

The 2022 technical annex, Appendix A, fallo, rectification and eight-page signed
base contract are now public. Preserve the direct `LPI 48` directory, contract,
January 2024 amendment and current PNT Contracts record
`b1KGmq3_O7wBRusB-jP2-A==`. They establish that the signed contract annexes were
omitted and identify the precise acceptance records. The historical SIPOT row
and its `Hipervínculo al documento del contrato y sus anexos` remain useful for
publication metadata, but are no longer prerequisites to a focused filing. Also
preserve SENEAM's public 2025 civil chain: procedure
`LO-09-C00-009C00001-N-71-2025`, contract
`SENEAM/DRM/MEX/LO/050/2025`, amendment `/01`, and project
`2309C000003`. That chain makes the remaining construction and commissioning
records much more precise. SENEAM's current transparency page supplies a direct
PNT subject preset with entity `33` and obligated-subject `285`. Request, in
this order:

- the complete awarded `Anexo 16: Propuesta Técnica` as incorporated into the
  executed contract as signed `Anexo 2: Propuesta Técnica`, plus signed `Anexo
3: Propuesta Económica`, specifically the approximately 39 MB file shown
  during evaluation as `Propuesta Tecnica ORVHEMET`;
- the final/as-built hardware, software and licence schedule: exact AviMet
  major/minor/build and modules; CDU/rack and server make/model/topology; OS;
  central history/archive component and database engine/schema/retention/export;
  every workstation/HMI application and role; panel-display model/firmware;
  whether NM10 was included and, if so, its exact build, modules, host owner,
  roles, retention, Public API/WFS/SFTP capabilities and version-matched manual;
  and AWS Client, Lizard and QML logger model/firmware/setup identifiers;
- the SDD contractually due within 45 days, ICDs, as-built diagrams, data
  dictionary, web-viewer name/manual, and the station-to-CDU, CDU-to-display and
  CDU-to-PIIMET mappings, including cadence, averaging, precision, quality
  flags, timebase, site IDs, missing-value and checksum rules; require explicit
  mappings for `TDZ05R`, `MID-05R/23L`, `TDZ23L`, `TDZ05L`, `MID-05L/23R`, and
  `TDZ23R`, including which source, if any, feeds each legacy CAPMA `05/23` view;
- a synchronized 72-hour sample at three layers: original QML binary logs plus
  the active setup and lossless CSV conversion; central-CDU native history plus
  its dictionary; and the raw station-to-CDU/CDU-to-PIIMET interface messages;
  include all six MEX station sites and preserve UTC timestamps, native cadence,
  validity flags and file hashes;
- for the 2025 civil contract, signed `Anexo 2`/final proposal and every schedule
  as modified; the validated executive project; the BESOP bitácora export;
  each of the five `Cédula de Avances y Pagos Programados` `E-5` records and
  invoice; progress estimates; tests and measurements; final as-built plans and
  station register; physical-reception act; defect warranty; finiquito; act of
  extinction of rights and obligations; every later amendment; the latest
  physical/financial progress certificate; unpaid balance; and current contract
  status;
- signed FAT/IAT/PSAT/ORD/FSAT, punch-list closure, commissioning,
  backup/restore and export-demonstration records; the original `Acta
Entrega–Recepción de los Sistemas`; the original `constancia de aceptación de
servicios`; every later amendment, suspension/resumption/termination record;
  a current production/acceptance declaration; and a written sequencing record
  stating whether completion of the 2025 civil work caused the suspended 2022
  Orvhemet installation/configuration/calibration/commissioning services to
  resume after December 31, 2024;
- the complete electronic response packages and attachments for PNT folios
  `330028524001267` and `330028524001268`, including the approved public
  versions of memoranda `OIC09/040/066/2022` and `CEDN/GD/1382/2022`.

Anchor the filing to expediente `2500815`, contract `2903113`, and reference
`SENEAM-LPI-48/2022-MEX`, and cross-reference procedure
`LO-09-C00-009C00001-N-71-2025`, civil contract
`SENEAM/DRM/MEX/LO/050/2025`, and investment project `2309C000003`. Ask SENEAM
to search the procurement, engineering, meteorology/telecommunications, CAPMA,
contract-administration, warehouse and payment record systems rather than
answering from one contract folder. The 72-hour sample is a new data request,
not a named contract deliverable. Permit operational credentials, secrets,
security-sensitive topology and personal data to be redacted; request interface
definitions and a provider-administered read-only export rather than
credentials. Obtain access setup privately from the named system administrator
after approval.

Ready-to-file Spanish PNT wording for the record-retrieval half:

```text
Solicito copia electrónica, en versión pública cuando corresponda, de los
registros existentes relacionados con el sistema AWOS Vaisala AviMet AWS310-SITE
del AICM/MMMX. Favor de realizar la búsqueda en las unidades de adquisiciones,
recursos materiales, ingeniería, meteorología y telecomunicaciones, CAPMA,
administración de contratos, almacén y pagos.

1. Las versiones públicas ya aprobadas y los anexos electrónicos completos de
los folios PNT 330028524001267 y 330028524001268, memorandos
OIC09/040/066/2022 y CEDN/GD/1382/2022.
2. Para el expediente 2500815, contrato 2903113,
SENEAM-LPI-48/2022-MEX: Anexo 16/Anexo 2 Propuesta Técnica adjudicada, Anexo 3,
SDD, ICD, BOM/as-built, avisos o convenios posteriores al 31 de diciembre de
2024, actas FAT/IAT/PSAT/ORD/FSAT, Acta Entrega-Recepción de los Sistemas,
constancia de aceptación de servicios, pagos, cierre y el documento más reciente
que haga constar su estado de aceptación/operación.
3. Para LO-09-C00-009C00001-N-71-2025,
SENEAM/DRM/MEX/LO/050/2025 y proyecto 2309C000003: Anexo 2/propuesta final,
programas modificados, bitácora BESOP, las cinco cédulas E-5 y facturas,
estimaciones y pruebas, proyecto ejecutivo validado, planos y padrón de
estaciones as-built, acta de recepción física, garantía por vicios, finiquito,
extinción de derechos y obligaciones, convenios posteriores y el certificado
más reciente de avance físico/financiero y saldo pendiente.
4. Registros que documenten si la terminación de la obra civil permitió
reanudar y aceptar los servicios suspendidos del contrato Orvhemet de 2022.

No se solicitan contraseñas, secretos, configuraciones de control ni acceso a la
red operacional. Pueden testarse datos personales y detalles de seguridad; se
solicita la información técnica y contractual segregable restante.
```

Use `SENEAM-02-002`, rather than the PNT request, for the newly generated
72-hour data sample, recurring export quote, delivery format, and licence/use
terms. A transparency filing retrieves existing records; it should not be
expected to create a new data extract.

Useful current routing contacts are:

```text
CAPMA H24: +52 55 5802 8525 / +52 55 5802 8520
SENEAM Dirección de Meteorología y Telecomunicaciones Aeronáuticas: +52 55 5786 5516
SENEAM Subdirección de Meteorología: +52 55 5786 5517
SENEAM Instrumentación Meteorológica: +52 55 5786 5518
```

The current SENEAM transparency page lists `ruth.perez@seneam.gob.mx`,
`+52 55 5786 5510` extension `5662`. If SENEAM wants the awarded supplier
included, Vaisala's official Mexico partner directory currently lists Orvhemet
aviation contacts `omar.ramirez@orvhemet.com.mx` and
`victor.hernandez@orvhemet.com.mx`. The fallo proves the awarded product, but
these contacts do not prove installation status or let the supplier grant
SENEAM data rights independently of the data owner.

The AIP separately identifies OSIV as H24. The directory numbers may be legacy;
prefer the current AIP CAPMA numbers and the formal service route. SENEAM/CAPMA
is the meteorological provider and primary authority/custodian; confirm legal
ownership/licensing and republication authority. AICM Operations can
facilitate but should not be assumed to grant SENEAM data access.

### SMN/CONAGUA SIVEA ten-minute stations

The official SIVEA viewer exposes automatic station data and UI controls for
the last 30 minutes and last hour:

- Network description:
  <https://smn.conagua.gob.mx/es/observando-el-tiempo/estaciones-meteorologicas-automaticas-ema-s>
- Viewer:
  <https://smn.conagua.gob.mx/tools/GUI/sivea_v3/sivea.php>
- Viewer JavaScript:
  <https://smn.conagua.gob.mx/tools/GUI/sivea_v3/js/sivea.js>

The browser application calls undocumented JSON/PHP paths resembling:

```text
https://smn.conagua.gob.mx/tools/GUI/sivea_v3/php/getTodasEstaciones.php
https://smn.conagua.gob.mx/tools/GUI/sivea_v3/php/getTemperatura.php?per=T30
https://smn.conagua.gob.mx/tools/GUI/sivea_v3/php/getTemperatura.php?per=T1
```

Some SMN/ESMA timestamps land on ten-minute boundaries, consistent with SMN's
description of ten-minute server transfers. The airport search did not produce
a usable MMMX station:

- `TEZONTLE` is about 6.4 km from the AWC MMMX reference coordinate but was
  absent from the live 30-/60-minute temperature response;
- the nearest station found with a current temperature was `CCA`, about
  17.3 km away;
- `BENITO JUAREZSMN` is in Oaxaca and is a name collision, not AICM.

These stations can describe the regional air mass, not airport pavement or
runway conditions. They must not be used as `MMMX` truth.

The endpoints are browser internals rather than a documented production API,
and automated/commercial reuse permission was not established. Any future
regional-context integration therefore requires:

```text
SMN_SIVEA_ACCESS_APPROVED
```

The SIVEA viewer publishes contacts including:

```text
juan.olalde@conagua.gob.mx
edgar.romero@conagua.gob.mx
+52 55 2636 4600, extensions 3335 / 3317
```

### CDMX REDMET one-minute measurement claim

The Mexico City REDMET open-data record says the network measures temperature,
humidity, wind direction, and wind speed continuously and permanently,
minute-by-minute:

<https://datos.cdmx.gob.mx/dataset/redmet>

That is a statement about the network's measurement process, not a live
one-minute public API. The public data path investigated advertised hourly
downloads:

```text
https://www.aire.cdmx.gob.mx/default.php?opc='aKBi'
https://aire.cdmx.gob.mx/descargas/Opendata/Bases_publicas/REDMET/26REDMET.zip
```

On July 31, the 2026 ZIP returned successfully but had an HTTP
`Last-Modified` of April 7, 2026 and contained legacy XLS files such as
`2026TMP.xls`. The CDMX portal's summarized resource is daily/monthly rather
than a fresh minute stream. No verified live minute endpoint or current
airport-located REDMET station was found.

The nearest useful listed site was `MERCED (MER)` at approximately
`19.42461, -99.119594`, about 5.1 km from the MMMX reference point. It is an
urban monitoring site, not airport equipment. Station-setting documentation:

<https://www.aire.cdmx.gob.mx/descargas/publicaciones/simat-entornos.pdf>

Published REDMET open-data resources declare a Creative Commons Attribution
4.0 license and can be used within that license without a special approval
flag. If a future implementation discovers an undocumented minute endpoint,
do not assume the archive license covers that service. Gate it pending written
confirmation with:

```text
CDMX_REDMET_MINUTE_ACCESS_APPROVED
```

Keep any REDMET observations as off-airport urban context with their actual
station coordinates.

### Other personal-sensor leads

These providers have technically fast products but no verified suitable
station near MMMX:

| Provider        | Potential cadence                                                                                            | Why it was rejected for now                                                                                                                                                                                      | Gate if access is obtained                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Ambient Weather | Provider documentation says most, not all, devices update each minute; historical records can be five-minute | WU `IMEXIC72` at `19.477467, -99.129476` (about 7.59 km away) showed roughly five-minute wind uploads from `AMBWeatherV4.2.9`, but temperature/humidity were null; this does not prove direct Ambient API access | `MEXICO_AMBIENT_ACCESS_APPROVED`; keep application/device keys separate |
| PurpleAir       | Sensor reports about every two minutes and API may be polled minutely                                        | Temperature sensor is inside a particulate-monitor housing, not a shielded meteorological thermometer; no nearby suitable sensor verified without keyed/paid query                                               | `MEXICO_PURPLEAIR_ACCESS_APPROVED`                                      |
| Netatmo         | Potential roughly five-minute consumer observations; cadence was not verified here                           | No station near MMMX could be verified from the unauthenticated public map                                                                                                                                       | `MEXICO_NETATMO_ACCESS_APPROVED`                                        |

References:

- Ambient Weather update timing:
  <https://github.com/ambient-weather/api-docs/wiki/Device-Data-Specs>,
  <https://ambientweather.com/faqs/question/view/id/1811/>,
  <https://ambientweather.com/faqs/question/view/id/1890/>
- PurpleAir API guidance and license:
  <https://community.purpleair.com/t/api-use-guidelines/1589>,
  <https://www2.purpleair.com/pages/technology>,
  <https://www2.purpleair.com/pages/license>
- Netatmo Weather API and application guidelines:
  <https://dev.netatmo.com/apidocumentation/weather>,
  <https://dev.netatmo.com/guideline>

These should remain optional qualitative cross-checks. In particular,
PurpleAir's internal enclosure temperature is unsuitable as an official
two-metre air-temperature substitute.

The `IMEXIC72` Weather Underground dashboard is:

<https://www.wunderground.com/dashboard/pws/IMEXIC72>

### D-ATIS and radio-derived temperature

The MMMX AIP lists D-ATIS at 127.650 MHz, H24. ATIS can be useful because it is
operationally close to the airport. Its weather is report-derived and normally
updates on the hourly routine cycle and/or after significant change, not on
every underlying AWOS sample. It is not a one-minute sensor product. If
temperature is included, it would normally be METAR-style whole °C; no official
public MMMX D-ATIS feed was available to verify its content or freshness.

No official public SENEAM D-ATIS API or audio stream was found. At the research
check, LiveATC's international directory listed `MMMX ATIS 127.650` as up. This
is a third-party volunteer relay, and its legal terms restrict reproduction,
redistribution, operational, and commercial use:

- Feed index:
  <https://www.liveatc.net/feedindex.php?type=international-na>
- Terms:
  <https://www.liveatc.net/legal/>

Do not record, transcribe, retain, or display that audio in production without
permission from LiveATC and confirmation of any applicable Mexican aviation,
radio, and privacy requirements. The gate would be:

```text
LIVEATC_MMMX_ACCESS_APPROVED
```

An `atis.guru` MMMX page was also tested on July 31. Its newest arrival item
showed capture at `2026-07-26T04:18Z` for an issue time of `03:47Z`—about
31 minutes of relay delay and already more than five days stale at the check.
The departure item was captured `2026-07-25T15:34Z` for issue at `14:45Z`.
The service depends on ACARS-equipped aircraft requesting D-ATIS within
receiver coverage, so it is not complete or operationally reliable:

<https://atis.guru/atis/MMMX>

Any future automated use would need provider permission and a separate gate:

```text
ATIS_GURU_MMMX_ACCESS_APPROVED
```

A provider-authorized commercial API would be preferable to scraping display
sites, but MMMX coverage was not verified for either candidate below. AirNav
Radar documents a generic “Get D-ATIS by airport” product. Airframes documents
authorized ACARS/message access and identifies D-ATIS as an ACARS use case, but
the API overview checked here did not expose a dedicated D-ATIS endpoint.
Treat both as provider inquiries, not working MMMX sources:

```text
AIRFRAMES_MMMX_DATIS_ACCESS_APPROVED
AIRNAVRADAR_MMMX_DATIS_ACCESS_APPROVED
```

- Airframes API and ACARS overview:
  <https://docs.airframes.io/api/>,
  <https://docs.airframes.io/docs/intro/>
- AirNav Radar API: <https://www.airnavradar.com/api/documentation>

Keep the provider API key or account credential in a separate variable. A paid
subscription, successful login, or API key does not itself confirm the
required automated-retention/public-display scope.

### WMO/WIS2 and official exchange products

WMO lists Mexico centre `mx-smn` as newly operational in 2026. Its exact Global
Discovery Catalogue inventory contains only three datasets: SYNOP, upper-air
TEMP, and DAYCLI. It has no Mexico aviation, METAR, OPMET, IWXXM, or `MMMX`
collection.

The presumed airport identifier also needed correction. Current OSCAR metadata
maps `0-20000-0-76679` to `AEROP. INTERNACIONAL MEXICO, D.F.` / alias
`Radiosondeo Tacubaya` at approximately `19.403703, -99.196600`, not AICM. The
record contains no `MMMX` identifier. Its surface-temperature deployment is
marked non-NRT and not internationally exchanged; its upper-air temperature is
exchanged about twice daily. The exact WIS2 SYNOP cache prefix for `76679` was
empty even though the collection was actively publishing other stations, while
the `76679` TEMP files arrived roughly two hours after observation.

A separate collocated station, `0-20000-0-76680` (`MEXICO (CENTRAL), D.F.` /
`CENTRAL TACUBAYA, CD MX`), does publish hourly SYNOP surface temperature. In a
46-hour window it had about 89% coverage and arrived around ten minutes after
the hour. It is approximately 13.4 km west of AICM, so it can be displayed only
as optional Tacubaya context and must never be relabeled `MMMX` airport truth.

The registered GTS-to-WIS2 gateways did not expose NOAA's current
`SAMX41 MMMX` METAR bulletin either. Therefore WIS2 supplies no distinct faster
AICM aviation path.

WIS2 `core` data are explicitly free and unrestricted, and the advertised
Global Broker credentials are public. A `76680` context collector would not
need a provider-approval Convex flag unless a separate legal/internal review
imposes one. It would still need the exact consumer topic
`cache/a/wis2/mx-smn/data/core/weather/surface-based-observations/synop`, a
WIGOS allowlist, MQTT/TLS broker failover, BUFR4 decoding, prompt object fetch,
deduplication, provenance, and monitoring for the cache's short lifecycle.
None of that changes the conclusion that a faster **airport** source requires
SENEAM/CAPMA AWOS access.

### Aircraft and satellite dead ends

Mode-S BDS 4,4 can encode an aircraft's static air temperature at fine
resolution, but that is airborne airframe data, is not consistently present,
and is not a surface thermometer. OpenSky state vectors do not expose a
temperature field. This path cannot answer the MMMX surface-temperature
question.

- EUROCONTROL Mode-S specific services:
  <https://www.eurocontrol.int/sites/default/files/library/016_Mode-S_Specific_Services.pdf>
- OpenSky REST state vectors:
  <https://openskynetwork.github.io/opensky-api/rest.html>

GOES ABI offers frequent imagery—nominally five- or ten-minute in some scan
modes—but the imagery is radiance/cloud context. The operational land-surface
temperature product is slower, clear-sky dependent, spatially coarse, and
measures surface skin rather than two-metre air temperature. Satellite data
can support storm/solar diagnostics but cannot replace an airport thermometer.

- GOES ABI scan modes:
  <https://goes-r.noaa.gov/spacesegment/abi.html>
- GOES land-surface-temperature product notes:
  <https://www.ospo.noaa.gov/operations/goes/product-quality-overview/ps-pvr/goes-16/ABI/Land%20Surface%20Temperature/Full/GOES-16_ABI_L2_LandSurfaceTemperature_Full_ReadMe.pdf>

### Aviation relays and archives

Iowa Environmental Mesonet and OGIMET expose the same METAR/SPECI reports:

- IEM station page:
  <https://mesonet.agron.iastate.edu/sites/site.php?network=MX__ASOS&station=MMMX>
- IEM observation history:
  <https://mesonet.agron.iastate.edu/sites/obhistory.php?network=MX__ASOS&station=MMMX>
- OGIMET history:
  <https://www.ogimet.com/display_metars2.php?fmt=html&lang=en&lugar=MMMX&nil=SI&ord=REV&tipo=ALL>

They are useful for archive comparison and outage diagnosis, not a faster
sensor. IEM's generic “high frequency” interfaces do not prove that MMMX
publishes minute MADIS data. Do not scrape OGIMET for production without
provider permission.

## Ranked connection plan after permission

The table separates paths worth asking for from paths that are merely
technically connectable. The CAPMA JPEG cadence was directly observed; cadence
for every requested upstream/numeric interface remains a provider question.

| Priority | Requested interface                              | What it could add                                                                                         | First bounded test after approval                                                                | Main limitation                                                                                                                |
| -------: | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
|        1 | SENEAM/Vaisala AviMet CDU or QML-log export      | Structured data from the awarded AWS310-SITE family; AWS Client supports DAT retrieval and CSV conversion | Provider-generated 72-hour native sample, schema, sensor/site IDs and quality flags              | Award is proven; installation, exact setup, native logging cadence and current access remain unverified                        |
|        2 | SENEAM contract-required AWOS web viewer         | Contract-required internal five-second display; could be AviMet, NM10 or another compliant implementation | Confirm product/build and owner; then owner-issued URL, read-only role and six-station allowlist | No Orvhemet portal was found; NM10 inclusion, commissioning, precision, external access and automation terms remain unverified |
|        3 | SENEAM-supported legacy CAPMA TDZ numeric export | Structured values from the identified telemetric-AWOS one-minute record behind the JPEG system            | Provider-generated schema/72-hour sample, sensor IDs, then approved parallel JPEG comparison     | Public JPEG is plain HTTP/OCR/whole °C; current sensors, native precision and export status are unknown                        |
|        4 | Current PIIMET MMMX AWOS layer                   | Potential sanctioned interface to the official AWOS data; current backend must be verified                | Owner-issued read-only service account plus documented export/API; one airport/layer allowlist   | Archived public 2022 AWOS was static demo data; no current supported endpoint or MMMX mapping is published                     |
|        5 | SEMAR AION BASANMEX latest-temperature route     | Exact client-used current-value route plus JSON/CSV history for the rooftop station                       | Confirm BASANMEX `stationId`, channel `1`, measurement `40605`/`atmp`, then one bounded read     | Requires noninteractive role; BASANMEX mapping, freshness, cadence and QC are unverified                                       |
|        6 | SEMAR native BASANMEX/Campbell export            | Provider-confirmed native rooftop cadence through API/SFTP/CampbellCloud/LoggerNet/LNDB                   | Provider-generated 72-hour sample, then exact read-only share/export                             | Separate sensor, not official MMMX; model/enrollment and aggregation semantics are unknown                                     |
|        7 | SEMAR public `basanmex.txt` conditional watcher  | Measured arrival latency and gaps for the verified nominal 15-minute rooftop series                       | Approved ETag/If-Modified-Since watcher with conservative interval and explicit source age       | Hourly batching/gaps; cannot create faster observations                                                                        |
|        8 | AICM SIGA AODB/ESB weather export                | Possible airport-system relay of AWOS data                                                                | Ask whether ESB/AODB carries raw AWOS fields; use only an owner-named read-only interface        | SIGA's existence proves real-time operations integration, not weather content                                                  |
|        9 | Direct SENEAM D-ATIS or AFTN/AMHS OPMET          | Authoritative first-arrival comparison for report-level weather                                           | Read-only MMMX OPMET/text feed selected by SENEAM                                                | Carries METAR/SPECI, not the native five-second thermometer                                                                    |

WIS2 station `76680` needs no provider permission for its public `core` SYNOP
topic and can be added as optional Tacubaya context after a product decision.
It is not part of the airport-source ranking. AVIMET and its adjacent
Firebase/iOS/image paths are rejected for temperature; the approved bounded
MQTT tests found alerts, not station observations, so no further temperature
access request is justified.

The direct SENEAM D-ATIS flags, if requested, should be
`SENEAM_MMMX_DATIS_TEXT_ACCESS_APPROVED`; use
`SENEAM_AFTN_OPMET_ACCESS_APPROVED` for an OPMET connection. AICM's announced
SIGA contains AODB, RMS, ESB, PASSUR, and A-CDM components; only create
`AICM_SIGA_WEATHER_ACCESS_APPROVED` if AICM confirms that an authorized
weather export exists. Do not infer raw AWOS from the existence of an
enterprise service bus.

SENEAM's historical 2017 AFTN tariff page lists METAR, SPECI, TAF, and related
messages. It supports the transport's historical product scope, not current
availability, prices, terms, or access. Obtain current confirmation; even then,
it is not a path to one-minute sensor data:

- <https://www.seneam.gob.mx/gobmx/cuotas/cuotas2017.html>
- <https://www.aicm.com.mx/nuevo-sistema-de-gestion-aeroportuaria-en-el-aicm/27-04-2026>

### Paths not worth requesting for temperature

- WIFS is an aviation forecast/product exchange, not the local raw thermometer.
- AICM's Doppler radar/LIDAR/windshear systems measure precipitation and wind
  structure, not calibrated two-metre air temperature.
- GOES land-surface temperature is surface skin temperature and is not an
  airport air-temperature substitute.
- D-ATIS audio and third-party ACARS relays repeat report-style weather and add
  rights, coverage, and latency problems.
- Broad MQTT wildcards, Firebase enumeration, vendor-port scanning, device
  emulation, and access to airport/SEMAR internal networks are neither needed
  nor covered by a normal data-use approval.

The best permission outcome is therefore a provider-created read-only egress
path—not permission to explore operational infrastructure.

## Location and sensor provenance

| Item                             | Coordinate/elevation              | What it means                                                                                 |
| -------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| MMMX AIP airport reference point | about `19.435968, -99.073393`     | Surveyed airport reference point, not thermometer                                             |
| AWC station metadata             | `19.436, -99.072`, 2,224 m        | Rounded station/airport reference used with the METAR                                         |
| CAPMA TDZ screen header          | `19.436389, -99.071944`, 7,297 ft | Same coordinate printed on both TDZ views; display/airport reference, not two probe locations |
| BASANMEX page                    | malformed DMS; 2,261 m            | Provider display cannot be parsed as valid DMS                                                |
| BASANMEX inferred point          | about `19.426221, -99.076859`     | Plausible digit reconstruction only, not survey-grade                                         |

The MMMX airport reference can be viewed at:

<https://www.openstreetmap.org/?mlat=19.436&mlon=-99.072#map=18/19.436/-99.072>

The BASANMEX inference can be viewed at:

<https://www.openstreetmap.org/?mlat=19.426221&mlon=-99.076859#map=19/19.426221/-99.076859>

None of these points is a verified thermometer coordinate. The AIP, AWC, and
CAPMA values are airport/display references, and the public documents checked
here did not identify a temperature-probe position. The CAPMA header is about
0.159 km from the documented MMMX reference point. A future schema should store
coordinate value, precision, provenance, and confidence separately.

## Approval and Convex environment variables

A read-only audit on August 1, 2026 found the following eleven values set to
exact `true` in both Convex development and production:

```text
SENEAM_MMMX_AWOS_ACCESS_APPROVED
SENEAM_MMMX_AWOS_RETENTION_APPROVED
SENEAM_MMMX_AWOS_REPUBLICATION_APPROVED
SENEAM_PIIMET_MMMX_ACCESS_APPROVED
SEMAR_BASANMEX_NATIVE_FEED_ACCESS_APPROVED
SEMAR_BASANMEX_NATIVE_DATA_RETENTION_APPROVED
SEMAR_BASANMEX_NATIVE_DATA_REPUBLICATION_APPROVED
SEMAR_AVIMET_MQTT_ACCESS_APPROVED
SEMAR_AVIMET_MQTT_PERSISTENT_SESSION_APPROVED
SEMAR_AVIMET_MESSAGE_DECRYPTION_APPROVED
SEMAR_AVIMET_MESSAGE_RETENTION_APPROVED
```

A targeted read-only recheck on August 3 confirmed that the four SENEAM values
in that list remain exact `true` in both environments. The other seven values
were not rechecked. No environment value was changed during the follow-up.

These are **premature/misconfigured values**, not active compliant releases.
No repository code consumes them, no protected integration is deployed, and
the owner did not provide an exact endpoint-bound setup packet. A working
credential, broad permission, reachable host, or environment variable does not
substitute for approval naming the interface, transport, station IDs, fields,
retention, republication, rate limits, and security constraints.

Remove the production values before implementing any protected source. The
AVIMET values should remain absent for this temperature feature because its
approved bounded probes found no temperature. The broad AWOS/PIIMET and native
BASANMEX values may be re-created only after the relevant authority binds the
scope to a provider-named interface; deploy the gates/code with production
values absent, verify every entry point and worker fails closed, and set only
the required exact `true` values as the final activation step. Development
should use fixtures or provider-sanctioned samples until that scope exists.

The proposed specific gates
`SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED` and
`SEMAR_AION_BASANMEX_ATMP_ACCESS_APPROVED` were absent in both environments at
the audit. The newly proposed CAPMA TDZ-image gates have not been implemented
or audited and must remain absent unless SENEAM approves the exact two-image
scope. Public BASANMEX, native BASANMEX, AION, CAPMA TDZ images, SENEAM AWOS,
PIIMET, SIGA, and AVIMET must never authorize one another.

Recommended production cleanup (not executed by this investigation):

```text
npx convex env remove SENEAM_MMMX_AWOS_ACCESS_APPROVED --prod
npx convex env remove SENEAM_MMMX_AWOS_RETENTION_APPROVED --prod
npx convex env remove SENEAM_MMMX_AWOS_REPUBLICATION_APPROVED --prod
npx convex env remove SENEAM_PIIMET_MMMX_ACCESS_APPROVED --prod
npx convex env remove SEMAR_BASANMEX_NATIVE_FEED_ACCESS_APPROVED --prod
npx convex env remove SEMAR_BASANMEX_NATIVE_DATA_RETENTION_APPROVED --prod
npx convex env remove SEMAR_BASANMEX_NATIVE_DATA_REPUBLICATION_APPROVED --prod
npx convex env remove SEMAR_AVIMET_MQTT_ACCESS_APPROVED --prod
npx convex env remove SEMAR_AVIMET_MQTT_PERSISTENT_SESSION_APPROVED --prod
npx convex env remove SEMAR_AVIMET_MESSAGE_DECRYPTION_APPROVED --prod
npx convex env remove SEMAR_AVIMET_MESSAGE_RETENTION_APPROVED --prod
```

| Source or capability                | Convex flag                                              | Authority and required scope                                                                                                                                        | Behavior while absent                                                                      |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| AWC documented METAR API            | none proposed                                            | Follow published machine-access and rate-limit rules                                                                                                                | Collector may run at no more than once/minute/thread                                       |
| Polymarket public Gamma market data | none proposed                                            | Official public, unauthenticated market-data API; preserve source semantics and remain within published limits                                                      | Fail honestly on missing/malformed events; never synthesize or normalize probability rows |
| NOAA `MMMX.TXT` relay               | none proposed for a bounded standards-compliant fallback | Same operational restraint and attribution                                                                                                                          | Prefer AWC; no high-frequency hammering                                                    |
| SEMAR BASANMEX public file          | `SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED`             | SEMAR approval for automated polling, retention, derivation, public/commercial display and attribution                                                              | Do not queue/fetch/store; show `approval required`                                         |
| BASANMEX native feed                | `SEMAR_BASANMEX_NATIVE_FEED_ACCESS_APPROVED`             | SEMAR/CAPMAR approval for the named provider-operated export, cadence, authentication, limits and volatile diagnostics                                              | Do not discover, connect, fetch, retain, or substitute the public file                     |
| BASANMEX native-data retention      | `SEMAR_BASANMEX_NATIVE_DATA_RETENTION_APPROVED`          | SEMAR approval for raw/parsed samples, timestamps, QC/status, Convex duration, reads, deletion and derived internal use                                             | Do not insert/upsert, queue, retry, export, or use retained native data                    |
| BASANMEX native-data republication  | `SEMAR_BASANMEX_NATIVE_DATA_REPUBLICATION_APPROVED`      | SEMAR approval for public/commercial display, export, redistribution, derivatives, attribution and expiry                                                           | Keep approved retained data internal and hidden                                            |
| BASANMEX historical archive         | `SEMAR_BASANMEX_HISTORICAL_ARCHIVE_ACCESS_APPROVED`      | SEMAR approval for the exact date range, provider export/download method, bulk-transfer limits and volatile validation                                              | Do not request/download; storage/display needs the native-data gates                       |
| SEMAR AION BASANMEX temperature     | `SEMAR_AION_BASANMEX_ATMP_ACCESS_APPROVED`               | DIREDIMOAT/AION approval for exact BASANMEX `stationId`, channel 1, measurement `40605`/`atmp`, service auth and intended use                                       | Do not register, log in, automate CAPTCHA, enumerate stations, or retain data              |
| BASANMEX interagency mirror         | `SEMAR_BASANMEX_INTERAGENCY_FEED_ACCESS_APPROVED`        | SEMAR plus endpoint-operator approval for the exact station ID, endpoint, automation and downstream rights                                                          | Do not guess station aliases or call a third-party feed                                    |
| BASANMEX vendor cloud/export        | `SEMAR_BASANMEX_VENDOR_CLOUD_ACCESS_APPROVED`            | SEMAR and named vendor approval for exact read-only CampbellCloud station or LoggerNet/LNDB table/export and intended use                                           | Do not guess enrollment/model or access PakBus/logger control surfaces                     |
| Exact BASANMEX MQTT topic           | `SEMAR_BASANMEX_MQTT_ACCESS_APPROVED`                    | SEMAR approval for a provider-named topic, authentication, sessions, rate/byte limits and payload handling                                                          | Do not infer it from or wildcard around `digaohm-events`                                   |
| SEMAR AVIMET MQTT alert channel     | `SEMAR_AVIMET_MQTT_ACCESS_APPROVED`                      | SEMAR/DIGAOHM approval for config retrieval, the exact topic, automated connection/subscription and session limits                                                  | Do not fetch config, connect, subscribe, or receive ciphertext                             |
| AVIMET persistent MQTT session      | `SEMAR_AVIMET_MQTT_PERSISTENT_SESSION_APPROVED`          | SEMAR/broker-owner approval for dedicated client ID, offline queue, reconnect window, limits and broker-side cleanup                                                | Clean sessions only; create no durable broker state                                        |
| AVIMET message decryption           | `SEMAR_AVIMET_MESSAGE_DECRYPTION_APPROVED`               | SEMAR/DIGAOHM approval to decrypt production-topic payloads using the client-compatible scheme                                                                      | Do not decrypt; discard after authorized transport diagnostics                             |
| AVIMET message retention            | `SEMAR_AVIMET_MESSAGE_RETENTION_APPROVED`                | SEMAR/DIGAOHM approval covering raw ciphertext, decrypted content, retention duration, Convex storage, internal reads and deletion                                  | Do not insert/upsert, queue, retry, export, or use retained content                        |
| AVIMET message republication        | `SEMAR_AVIMET_MESSAGE_REPUBLICATION_APPROVED`            | Separate approval for public display, redistribution, third-party export, commercial use and attribution                                                            | Keep retained data internal and hidden                                                     |
| DIGAOHM Firebase bounded read       | `SEMAR_DIGAOHM_FIREBASE_READ_APPROVED`                   | Firebase owner approval for exact Realtime Database paths, rate/size, handling and redirect-host allowlist                                                          | No request, Cloud Storage access, writes, bypass, guessing, enumeration, or retention      |
| UNINDETEC iOS API probe             | `UNINDETEC_AVIMET_IOS_API_PROBE_APPROVED`                | SEMAR/UNINDETEC approval for an exact provider-supported method/path, rate, response and redirect handling                                                          | Do not invent health/`OPTIONS` routes or call device/preference operations                 |
| UNINDETEC test-device registration  | `UNINDETEC_AVIMET_IOS_DEVICE_REGISTRATION_APPROVED`      | APNs-issued authorized test-build/device token, approved writes, privacy/retention scope, revocation and cleanup                                                    | Do not synthesize a token, emulate a device, or send a real user's token                   |
| Direct AVIMET image collection      | `SEMAR_AVIMET_IMAGES_ACCESS_APPROVED`                    | SEMAR approval for exact URL allowlist plus retrieval, retention, OCR/derivatives, republication, display and attribution                                           | Linking remains separate; headers are not authoritative publication times                  |
| AVIMET publisher read-only role     | `SEMAR_AVIMET_PUBLISHER_READ_APPROVED`                   | SEMAR-issued server-enforced role separately naming views, exports/job creation, retention and use                                                                  | Never upload, edit, publish, or send; credentials remain separate                          |
| CAPMA MMMX TDZ image access         | `SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED`           | SENEAM/CAPMA approval for conditional automated GETs of only `pista05.jpg`/`pista23.jpg`, allowed rate, OCR/derivation, transport risk, sensor identity and support | Do not queue, fetch, OCR, retry, or treat browser reachability as automation permission    |
| CAPMA MMMX TDZ image retention      | `SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED`        | SENEAM approval for raw JPEG/body hash, parsed fields, embedded times, Convex duration, internal reads and deletion                                                 | Keep only approved volatile diagnostics; do not insert/upsert or retain images/readings    |
| CAPMA MMMX TDZ data republication   | `SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED`      | SENEAM and any required AICM authority for public/commercial display of images or OCR fields, derivatives, export, attribution and expiry                           | Keep approved retained data internal and hidden; linking alone grants no downstream rights |
| Direct SENEAM MMMX AWOS             | `SENEAM_MMMX_AWOS_ACCESS_APPROVED`                       | SENEAM/CAPMA approval for exact owner-provided web viewer/export/API, six AICM stations, temperature/dew point, automation and limits                               | Do not scan, intercept VHF, guess protocols, or access logger/LAN/control surfaces         |
| SENEAM MMMX AWOS retention          | `SENEAM_MMMX_AWOS_RETENTION_APPROVED`                    | SENEAM approval for raw/current samples, timestamps and QC/status retention in Convex for a stated duration                                                         | Process only the minimum volatile diagnostics allowed by access approval                   |
| SENEAM MMMX AWOS republication      | `SENEAM_MMMX_AWOS_REPUBLICATION_APPROVED`                | SENEAM approval for public/commercial display, export, derivatives, attribution and expiry                                                                          | Keep authorized retained data internal and hidden                                          |
| PIIMET MMMX AWOS layer              | `SENEAM_PIIMET_MMMX_ACCESS_APPROVED`                     | SENEAM/CAPMA/PIIMET administrator approval for read-only MMMX layer, documented API/export and session limits                                                       | Do not log in, scrape, use VPN, enumerate layers, or access other airports                 |
| Direct SENEAM D-ATIS text           | `SENEAM_MMMX_DATIS_TEXT_ACCESS_APPROVED`                 | SENEAM and, if applicable, the named delivery operator for interface use, automation, retention and onward display                                                  | Do not infer access from the broadcast frequency                                           |
| SENEAM AFTN/AMHS OPMET              | `SENEAM_AFTN_OPMET_ACCESS_APPROVED`                      | SENEAM/network-security approval for read-only MMMX OPMET messages and exact connection scope                                                                       | No connection; METAR/SPECI remains the public fallback                                     |
| AICM SIGA weather export            | `AICM_SIGA_WEATHER_ACCESS_APPROVED`                      | AICM plus SENEAM approval after confirming a named raw-weather field and read-only AODB/ESB export                                                                  | Do not inspect SIGA or infer weather data from ESB/AODB existence                          |
| SMN SIVEA browser endpoints         | `SMN_SIVEA_ACCESS_APPROVED`                              | CONAGUA/SMN confirmation for automated use of undocumented endpoints                                                                                                | No SIVEA requests; no silent regional fallback                                             |
| WeatherLink nearby PWS              | `MEXICO_WEATHERLINK_ACCESS_APPROVED`                     | Davis/WeatherLink entitlement plus station and republication rights for the exact use                                                                               | No public-map scrape; no API calls or display                                              |
| Weather Underground PWS             | `MEXICO_WU_PWS_ACCESS_APPROVED`                          | Weather Company commercial terms and relevant station rights                                                                                                        | No borrowed frontend key; no collection                                                    |
| UNAM PEMBU direct data              | `MEXICO_UNAM_PEMBU_ACCESS_APPROVED`                      | UNAM approval for direct cadence, retention, attribution and display                                                                                                | Public slow files may be researched; no production collector                               |
| Undocumented REDMET minute endpoint | `CDMX_REDMET_MINUTE_ACCESS_APPROVED`                     | SEDEMA/CDMX confirmation that live automation is covered                                                                                                            | Licensed published archives remain separate; no live scrape                                |
| Ambient Weather station             | `MEXICO_AMBIENT_ACCESS_APPROVED`                         | Provider and station-owner authorization for selected device                                                                                                        | No application/device requests                                                             |
| PurpleAir sensor                    | `MEXICO_PURPLEAIR_ACCESS_APPROVED`                       | API/license compliance and downstream distribution scope                                                                                                            | No keyed/paid requests or display                                                          |
| Netatmo station                     | `MEXICO_NETATMO_ACCESS_APPROVED`                         | Provider review and station/data rights                                                                                                                             | No authenticated collection                                                                |
| LiveATC audio/transcription         | `LIVEATC_MMMX_ACCESS_APPROVED`                           | LiveATC permission plus applicable radio/privacy authority                                                                                                          | Do not stream, record, transcribe, or retain                                               |
| atis.guru D-ATIS relay              | `ATIS_GURU_MMMX_ACCESS_APPROVED`                         | Provider permission for automation, retention and display                                                                                                           | Do not scrape or present stale relay data                                                  |
| Airframes D-ATIS candidate          | `AIRFRAMES_MMMX_DATIS_ACCESS_APPROVED`                   | Provider confirmation of MMMX coverage plus contract for automation, retention and display                                                                          | No API requests; key alone is insufficient                                                 |
| AirNav Radar D-ATIS candidate       | `AIRNAVRADAR_MMMX_DATIS_ACCESS_APPROVED`                 | Provider confirmation of MMMX coverage plus contract for automation, retention and display                                                                          | No API requests; key alone is insufficient                                                 |

Provider-level approval must not silently authorize every station on that
provider. For owner-sensitive PWS data, Convex must also enforce a server-side
allowlist containing only immutable station/device IDs named in the approval:

```text
MEXICO_WEATHERLINK_APPROVED_STATION_IDS=<approved UUIDs only>
MEXICO_WU_PWS_APPROVED_STATION_IDS=<approved station IDs only>
MEXICO_AMBIENT_APPROVED_DEVICE_IDS=<approved device IDs only>
MEXICO_PURPLEAIR_APPROVED_SENSOR_IDS=<approved sensor IDs only>
MEXICO_NETATMO_APPROVED_DEVICE_IDS=<approved device IDs only>
```

Both the provider's `_ACCESS_APPROVED` value and allowlist membership must pass.
A missing/empty list fails closed, and adding a new ID requires approval for
that owner/station scope rather than just a configuration change.

Only the exact value `true` enables an approval-gated integration:

```js
if (process.env.SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED !== "true") {
  return { ok: false, status: "approval_required" };
}
```

Activate only after the user confirms that the named authority granted the
required scope:

```text
npx convex env set SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED true --prod
```

Revocation must stop new work:

```text
npx convex env remove SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED --prod
```

For the CAPMA screenshots specifically, deploy the gate checks with all three
values absent. Only after SENEAM/CAPMA grants the documented exact-path scope,
activate the approved capabilities separately:

```text
npx convex env set SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED true --prod
npx convex env set SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED true --prod
npx convex env set SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED true --prod
```

Removing access must stop all new requests; remove retention and republication
as well when their scopes end:

```text
npx convex env remove SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED --prod
npx convex env remove SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED --prod
npx convex env remove SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED --prod
```

Apply the same commands with the appropriate flag for another source. Every
manual action, cron, HTTP entry point, retry, queue producer, and worker must
check its own provider flag. A worker must check again immediately before the
protected external request **and again before storing/upserting the response or
performing another protected side effect**, so revocation during an in-flight
request still fails closed.

Queries, exports, public HTTP routes, and derived computations must also check
the current source flag and station allowlist before returning or using stored
gated rows. Revocation may leave retained records for audit according to the
approved retention policy, but it must immediately hide them from unapproved
read surfaces and stop them from feeding derived products.

Approval flags and credentials are independent. For example:

```text
AIRFRAMES_MMMX_DATIS_ACCESS_APPROVED=true
AIRFRAMES_API_KEY=<separate secret>
```

The UI is not the security boundary. While a source is disabled, show
`approval required`, `setup required`, or `unavailable`; do not substitute
another sensor and retain the protected source's label.

## Recommended collector and page design

There is currently no Mexico route, Convex collector, schema table, or cron.
This document is the research and implementation contract for later work.

### Series must remain separate

Recommended logical series:

| Series                     | Role                                                               | Suggested dedupe key                                             |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `MMMX METAR/SPECI (AWC)`   | Canonical official airport observation                             | station + raw observation time + report type/correction identity |
| `MMMX CAPMA TDZ display`   | Owner-published whole-degree legacy SENEAM telemetric-AWOS display | TDZ 05/23 + embedded screen time + body hash                     |
| `MMMX AWOS (SENEAM)`       | Native official-airport sensor candidate                           | SENEAM station/sensor ID + observation time + revision           |
| `MMMX PIIMET AWOS relay`   | Possible relay of the same AWOS fields                             | source layer/field ID + observation time + revision              |
| `BASANMEX rooftop (SEMAR)` | Independent high-resolution context                                | source station + row timestamp                                   |
| `SMN regional station`     | Optional off-airport context                                       | exact station ID + row timestamp                                 |
| `Nearby PWS`               | Optional unverified neighborhood context                           | provider + immutable station ID + observation timestamp          |
| `MMMX D-ATIS`              | Optional report-delivery experiment                                | provider + ATIS type + issue time + content hash                 |

Do not merge them into one “airport temperature” row. A chart may align the
series visually, but tooltips, legends, exports, and calculations must retain
sensor identity.

### Minimum provenance fields

Store at least:

```text
airportIcao
source
sourceStationId
sourceSiteLabel
hardwareAliasGroup
observationTime
reportTime
upstreamReceiptTime
firstSeenAt
updatedAt
temperatureC
temperaturePrecisionC
reportType
rawPayload
rawHash
isCorrection
declaredCadenceMinutes
collectionCadenceSeconds
latitude
longitude
coordinateSource
coordinateConfidence
approvalScopeVersion
```

`firstSeenAt` is immutable. If a provider revises a row, update `updatedAt`,
retain the original first-seen timestamp, and record the raw revision. Never
infer a high-resolution temperature from a whole-degree METAR. Resolve known
cross-provider aliases before counting station agreement or calculating any
ensemble diagnostic. The live MMMX test observed AWC mutate `receiptTime` for
one unchanged raw METAR, so provider receipt time is metadata rather than a
dedupe key or replacement for collector first-seen time.

### AWC collector

A safe initial path is:

1. Server-side Convex action runs every minute with a descriptive user agent.
2. Fetch a short rolling lookback such as
   `ids=MMMX&format=json&hours=2`, not latest-only.
3. Use `obsTime` as the canonical observation time.
4. Upsert every unseen report in the returned window and preserve `rawOb`.
5. Record request start/end, cache headers, status, and immutable `firstSeenAt`.
6. Back off on 429/5xx; never parallelize requests to evade the one-minute
   per-thread rule.
7. Render explicit source age and report type. Do not label a cached unchanged
   response as a new reading.

The rolling lookback matters because two reports can share one client polling
interval or arrive out of order. Latest-only polling could silently miss an
intervening `SPECI`.

### CAPMA TDZ-image collector only after approval

Prefer a provider-supported numeric HTTPS export of the legacy application's
documented one-minute station record or its current replacement. Do not access
the workstation's `C:\historico` drive path directly. If SENEAM instead
authorizes the public JPEGs, allow only the exact owner-published `pista05.jpg`
and `pista23.jpg` paths and require
`SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED` immediately before every queue,
conditional request, retry, and OCR operation. The approved rate should be no
faster than needed to see the observed roughly one-minute publication cycle;
the five-second internal contract requirement does not justify five-second
polling of this undocumented public server.

Validate `Content-Type`, JPEG decoding, dimensions, fixed labels, TDZ identity,
embedded date/time, and every OCR field. Reject rather than guess when a glyph,
date, unit, layout, or station label is ambiguous. Preserve response time,
headers, embedded screen time, body hash, OCR confidence, and raw displayed
text. Do not use `Last-Modified` as a dedupe key: the bounded test received two
different valid bodies under one mtime during a rollover. A stable re-read
policy must be approved and bounded, not an unbounded retry loop.

Require `SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED` immediately before
storing either a raw screenshot or parsed field and before using retained data
internally. Require `SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED` for any
public page, API, export, derived product, or image display. Keep credentials,
if a replacement interface needs them, separate from all three flags. Revoking
access must stop requests; revoking retention must stop writes/derived reads;
revoking republication must hide the series immediately.

Store TDZ 05 and TDZ 23 separately until SENEAM supplies immutable sensor/site
IDs and states whether they are distinct probes, two views of one system, or
processed relays. Label the displayed values as whole-degree CAPMA legacy-AWOS
TDZ display readings, not raw 0.1 °C sensor samples, the 2022 AWOS/PIIMET
system, or METAR observations. Do not derive a decimal temperature from rounded
dew point, humidity, pressure, or adjacent pixels. Use the embedded screen time
for staleness, while preserving file time only as relay metadata; the stale
MMTJ example proves that a freshly copied public JPEG need not contain a fresh
workstation screen.

### SENEAM AWOS/PIIMET collector after approval

Do not build against a guessed vendor interface. Once SENEAM provides the
documented contract, implement only its read-only operation and server-side
six-station/field allowlist. If SENEAM selects the contract-required web
viewer, automate it only if the approval expressly permits machine access;
otherwise require an API/log/database mirror. The direct worker must require
`SENEAM_MMMX_AWOS_ACCESS_APPROVED` immediately before every queue,
connection/request, network retry, and reconnect. The PIIMET worker must use
`SENEAM_PIIMET_MMMX_ACCESS_APPROVED` at the same boundaries. Neither access
flag authorizes the other source.

Require `SENEAM_MMMX_AWOS_RETENTION_APPROVED` immediately before every
insert/upsert and every internal read or derived use of retained samples, within
the approved purpose and duration. Public pages/APIs, external exports, and
other onward distribution must additionally require
`SENEAM_MMMX_AWOS_REPUBLICATION_APPROVED`. A transport retry is governed by the
source access flag, not the retention flag.

Preserve native acquisition, averaging-window, output, provider-receipt, and
first-seen times. Store sensor/status/QC identifiers and raw numeric precision;
do not manufacture decimal places. If both direct AWOS and PIIMET are
available, first determine whether they are two transports of the same sensor
and add a shared `hardwareAliasGroup`. Never count identical relays as two
independent thermometers.

### AION collector after setup and approval

Do not automate the interactive login or reCAPTCHA. Wait for SEMAR to issue a
supported noninteractive read-only credential, `ROLE_MET_USUARIO` (or a narrower
service role), and the exact BASANMEX `stationId`. Keep all credentials separate
from `SEMAR_AION_BASANMEX_ATMP_ACCESS_APPROVED`; require the flag before login,
every request/retry, and every store/read. Enforce a server-side allowlist of
one station ID, channel `1`, and only latest measurement `40605` / historical
measurement `atmp`. Pair each latest-value check with daily/range records until
SEMAR documents the latest route's observation time and freshness semantics.
Parse `fechaMuestreo` as UTC only after SEMAR confirms the wire semantics,
preserve raw precision and QC metadata, respect the UI's 31-day maximum, and
never call station-administration or SutronWin/socket configuration operations.
Establish native cadence from a provider sample before choosing a collector
schedule or describing the data as live.

### BASANMEX collector after approval

The source changes only nominally every 15 minutes, so a five-minute
conditional request is a reasonable starting proposal to ask SEMAR to approve.
Use both `If-None-Match` and `If-Modified-Since`, which the server was observed
to honor with `304`, parse the full sliding file, and upsert all unseen
timestamps. Parse pressure by the file header, not the chart's incorrect field
mapping. Preserve missing intervals rather than interpolating them. Because
the observed `Last-Modified` did not match the newest observation, freshness
must be calculated from the row timestamp.

## Recommended 24- to 48-hour latency experiment

The single most valuable next investigation is a bounded watcher around both
routine and convective periods.

For each request, record:

```text
source
requestStartedAt
responseCompletedAt
httpStatus
cacheControl
etag
lastModified
observationTime
providerReceiptTime
firstSeenAt
rawHash
temperatureC
reportType
revisionOf
```

Run:

- AWC with a short rolling `hours=2` lookback once every 60 seconds, aligned
  but with small jitter;
- NOAA `MMMX.TXT` once every 60 seconds only for the bounded comparison;
- BASANMEX no faster than the cadence approved by SEMAR;
- WeatherLink/WU only through their documented APIs and only after the
  corresponding approval flag is exactly `true`; preserve each station rather
  than averaging them;
- no gated source until its exact flag is `true`.

Report separately:

- sensor interval: consecutive `observationTime` differences;
- provider delay: provider receipt/modification minus observation time;
- client discovery delay: `firstSeenAt - observationTime`;
- network delay: request duration;
- revisions and first-seen preservation;
- freshness failures and missing expected slots;
- PWS agreement, step changes, stuck values, and divergence from the official
  MMMX report, without treating the comparison as calibration.

This will distinguish “source publishes every minute” from “our poller checks
every minute,” quantify whether the NOAA text relay is consistently earlier,
determine whether BASANMEX rows arrive individually or in delayed batches, and
show whether the fast nearby PWS signals are stable enough to be useful as
clearly labeled context.

## Reusable endpoint-research method

The expanded cross-airport blueprint is
[`high-frequency-airport-weather-research.md`](./high-frequency-airport-weather-research.md).
It preserves the full MMMX technique inventory and generalizes it for future
Brazil, Argentina, and other airport investigations.

For future Mexico providers:

1. Start with provider-owned product documentation, data policies, and station
   metadata.
2. Inspect the browser's same-origin XHR/fetch calls and loaded JavaScript for
   exact parameters only when no documented API exists.
3. Reproduce a read-only request with an explicit user agent and conservative
   rate.
4. Save response headers, raw sample, source timestamp, and actual first-seen
   time.
5. Verify station identity and distance; reject misleading name collisions.
6. Separate technical reachability from permission. Undocumented or
   approval-sensitive paths get their own positive Convex flag.
7. Test at an expected rollover boundary for at least 24 hours before claiming
   cadence or latency.
8. Record dead ends so later work does not mistake a stale archive, relay, or
   nearby station for a live airport sensor.

## Sources

Primary sources used in this report:

- NOAA/AWC API documentation:
  <https://aviationweather.gov/data/api/>
- NOAA/AWC MMMX JSON:
  <https://aviationweather.gov/api/data/metar?ids=MMMX&format=json>
- NOAA/AWC METAR explanation:
  <https://aviationweather.gov/help/data/>
- Mexico AIP MMMX entry:
  <https://aipmexico.seneam.gob.mx/AIP/doc/AD/AD_2/38_MMMX/AD_2-MMMX-2.pdf>
- SENEAM aviation meteorology:
  <https://www.gob.mx/seneam/acciones-y-programas/meteorologia-aeronautica>
- SENEAM observer manual:
  <http://capma.mx/manuales/Manual_Met_Obs/2019METOBS.pdf>
- SENEAM procurement page and official 2022 DOCX containing the embedded AWOS
  Technical Annex and Appendix A:
  <https://www.seneam.gob.mx/gobmx/convocatorias-adquisiciones/saoma>,
  <https://www.seneam.gob.mx/gobmx/convocatorias-adquisiciones/assets/archivos/Conv%20008%202022%20LA-009C00001-E157%20Sist%20Aut%20Obs%20Meteorol%C3%B3gica.docx>,
  <https://www.seneam.gob.mx/gobmx/convocatorias-adquisiciones/assets/archivos/CONVOCATORIA%208.pdf>
- SENEAM 2018-2024 consolidated report documenting AWOS acquisition and PIIMET:
  <https://www.seneam.gob.mx/gobmx/archivos/Informe_Consolidado%20SENEAM_26082024.pdf>
- AICM August 2023 minute describing AWOS modernization as future work,
  SENEAM's July 2023 Transparency Committee act placing
  `SENEAM-LPI-48/2022-MEX` in a SIPOT publication batch, and its November 2024
  act identifying exact procurement-file records:
  <https://www.aicm.com.mx/ResumenEjecutivo2015/ordinarias2023/COyH_8a_ORD_2023.pdf>,
  <https://seneam.gob.mx/gobmx/transparencia/actas/archivos/ACT_03-23_ORD_14_07_2023.pdf>,
  <https://seneam.gob.mx/gobmx/transparencia/actas/archivos/ACT_23-24_EXT_14_11_2024_.pdf>
- SENEAM 2025/2026 Transparency Committee minute indexes and the 2023/2024 ASF
  SENEAM audits checked for later AWOS/civil-work/acceptance evidence. The
  minutes and audits did not supply it, and the audits did not sample the
  Orvhemet contract:
  <https://www.seneam.gob.mx/gobmx/transparencia/actas/2025.html>,
  <https://www.seneam.gob.mx/gobmx/transparencia/actas/2026.html>,
  <https://www.asf.gob.mx/Trans/Informes/IR2023b/Documentos/Auditorias/2023_0404_a.pdf>,
  <https://informe.asf.gob.mx/Documentos/Auditorias/2024_0410_a.pdf>,
  <https://www.aicm.com.mx/aicm/resumen-ejecutivo-del-comite-de-operaciones-y-horario>
- AICM 2026 institutional open-data publication plan checked for a weather or
  AWOS release:
  <https://www.datos.gob.mx/dataset/plan_apertura_datos_aicm>
- Official historical CompraNet record for the 2022 AICM/Toluca AWOS
  procurement, expediente `2500815`, its official OCDS release, and the OCDS
  contract-status definition:
  <https://historico-compranet.buengobierno.gob.mx/#/detalle/2500815>,
  <https://historico-compranet.buengobierno.gob.mx/whitney/sitiopublico_cnet5/expedientes/2500815>,
  <https://upcp-cnetservicios.buengobierno.gob.mx/whitney/sitiopublico/ocds/2500815>,
  <https://standard.open-contracting.org/latest/en/schema/codelists/#contract-status>
- SENEAM's public SIPOT LPI-48 directory, eight-page signed base contract, and
  signed January 2024 amendment. The contract incorporates but omits its signed
  annexes; the amendment documents delivery, suspension and the two named
  acceptance records:
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/LICITACION-INVATRES/LPI%2048/>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/LICITACION-INVATRES/LPI%2048/7.SENEAM-LPI-48-2022-MEX.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIIIA/2022/SENEAM-LPI-48-2022-MEX-01.pdf>
- Current official PNT thematic Contracts search endpoint, the official
  CompraNet bulk row for contract `2903113`, and the applicable 2021 technical
  guidelines defining the public contract-and-annex hyperlink field:
  <https://backbuscadortematico.plataformadetransparencia.org.mx/api/tematico/buscador/consulta>,
  <https://www.datos.gob.mx/api/3/action/datastore_search?resource_id=59d2ed60-ef81-48a4-96ba-46483e373bff&limit=100&filters=%7B%22codigo_contrato%22%3A%222903113%22%7D>,
  <https://inicio.inai.org.mx/doc/DGE/verificaciones/2022/Normativos/04_Vigentes_LTG_DOF-21-07-2021.pdf>
- Official 2022 SICT labor report describing PIIMET's integrated sources:
  <https://www.telecomm.gob.mx/sipot/DPEII_2021/Formato_29_Informes_Emitidos/Informe_de_Labores/4to_Informe_de_Labores_SICT.pdf>
- SENEAM 2025 ICAO PIIMET/AWOS presentation:
  <https://www.icao.int/sites/default/files/NACC/MeetingDocs/2025/NACCWG10/Espa%C3%B1ol/04-Presentaciones/NACCWG10-P16.pdf>
- SENEAM's public homepage, robots file and stale official sitemap checked for
  the slide-12 `SIGIMET`/new aviation-weather page, PIIMET, AWOS, AviMet,
  AWS310, NM10 and an MMMX dashboard. No matching public route appeared:
  <https://www.seneam.gob.mx/>,
  <https://www.seneam.gob.mx/robots.txt>,
  <https://www.seneam.gob.mx/sitemap.xml>
- Archived 2021-2022 SENEAM-CAPMA PIIMET prototype. These establish the public
  application chain and its static demonstrator AWOS layer; they are historical
  artifacts, not current service endpoints:
  <https://web.archive.org/web/20220614004539id_/http://capma.seneam.gob.mx/alejandra/vis_seneam.php>,
  <https://web.archive.org/web/20220629024317id_/http://capma.seneam.gob.mx/alejandra/f_piimet.php>,
  <https://web.archive.org/web/20220629024241id_/http://capma.seneam.gob.mx/alejandra/d_piimet.php>,
  <https://web.archive.org/web/20220623103426id_/http://capma.seneam.gob.mx/alejandra/js/markers.js>. The larger archived application script is intentionally not
  linked because it contains sensitive connection material; that material was
  neither used nor copied into this report.
- Current AFAC aeronautical-meteorology circular `CO AV-1.03/25`:
  <https://www.gob.mx/afac/acciones-y-programas/servicios-de-navegacion-aerea-co>,
  <https://www.gob.mx/cms/uploads/attachment/file/1021009/co-av-1-03-25-publicacion-2025f-08092025f.pdf>
- AICM/Toluca AWOS procurement and follow-on civil works:
  <https://dof.gob.mx/nota_detalle_popup.php?codigo=5664549>,
  <https://sidof.segob.gob.mx/notas/docFuente/5763570>
- SENEAM's current SIPOT directory and complete located 2025 AICM civil-work
  publication chain: opening act, fallo, clarification act, signed base
  contract, amendment `/01`, convocatoria with embedded Terms of Reference and
  `Memoria Descriptiva`, advance invoice, and budget sufficiency:
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/A-P.A.P.-LO-050-2025.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/A.-FALLO-LO-050-2025.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/A.J.A.-LO-050-2025.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/SENEAM-DRM-MEX-LO-050-2025.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/C.M.-SENEAM-DRM-MEX-LO-050-2025-01.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/CONV.-LO-050-2025.docx>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/FACT-LO-050-2025.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/SUF%20PRESUP-LO-050-2025.pdf>
- Historical CompraNet contract dataset and 2025 federal AICM meteorological-
  infrastructure investment report:
  <https://www.datos.gob.mx/dataset/contratos_expedientes_sistema_historico_compranet>,
  <https://www.cuentapublica.hacienda.gob.mx/work/models/CP/2025/tomo/III/Print.9R09.04.INVAPGF.pdf>
- SICT 2025/2026 work programs and the 2026 federal investment-program annex
  checked for the AICM meteorological civil project. The 2025 program supplies a
  target; the public account above supplies actual reported progress. Absence
  from the 2026 documents is a bounded negative, not proof of cancellation:
  <https://micrs.sct.gob.mx/images/DireccionesGrales/DGP/PDF/Documentos-2025-2030/SICT_PT-2025.pdf>,
  <https://micrs.sct.gob.mx/images/DireccionesGrales/DGP/PDF/Documentos-2025-2030/SICT_PT-2026.pdf>,
  <https://www.pef.hacienda.gob.mx/work/models/P3f26115/PEF2026/y6k1r4r1/docs/09/r09_pief.pdf>
- Orvhemet's current brochure site, separate AWS810/NM10 dashboard case and
  public dashboard images. The pages demonstrate Orvhemet's NM10 capability but
  contain no AICM case study or linked customer portal:
  <https://www.orvhemet.com.mx/>,
  <https://www.orvhemet.com.mx/noticias.html>,
  <https://www.orvhemet.com.mx/assets/images/Noticia1.jpg>,
  <https://www.orvhemet.com.mx/assets/images/Noticia2.jpg>,
  <https://www.orvhemet.com.mx/assets/images/Noticia3.jpg>,
  <https://web.archive.org/web/20211219025855id_/http://orvhemet.com.mx/>
- Official Vaisala AviMet/AWS310-SITE information. The procurement fallo,
  rather than these product pages, identifies the awarded AICM system:
  <https://www.vaisala.com/en/products/systems/avimet-awos>,
  <https://docs.vaisala.com/api/khub/documents/~r~dS99azRrVTjv0II7DBQ/content>,
  <https://docs.vaisala.com/r/M210932EN-F/en-US/GUID-B6532A7D-0B89-4485-9B4E-68A0D651407C>,
  <https://docs.vaisala.com/r/M210932EN-F/en-US/GUID-F759847B-9715-426D-BA01-B8606B6406D7>,
  <https://docs.vaisala.com/r/M210932EN-F/en-US/GUID-42447ED3-599C-4262-B425-117FBABCD1F9>,
  <https://docs.vaisala.com/r/M210932EN-F/en-US/GUID-92229D18-CBCA-4080-A39E-AE0E81F6ECCC/GUID-F198E210-3CF8-4CC2-B6DA-6659F03BDE26>,
  <https://docs.vaisala.com/api/khub/documents/vlcKz5Mg5TH79DiOe1jAeg/content>,
  <https://www.vaisala.com/en/partners/find-partner?field_countries_value=MX>
- Period-correct Vaisala sources used only to define BOM search terms and a
  possible display-rounding mechanism, not to attribute these components to
  AICM: the 2020 on-premises NM10 interface/export contract, the period AviMet
  AWOS architecture, the EANA component distinction, 2022 AviMet 8.0+ remote-
  monitoring requirements, CDU401, WID513, and the 2025 AviMet 10 launch date:
  <https://www.vaisala.com/sites/default/files/documents/NM10-Datasheet-B211408EN.pdf>,
  <https://www.vaisala.com/sites/default/files/documents/WEA-AVI-Brochure-AWOS-B210848EN-E.pdf>,
  <https://www.vaisala.com/en/case/safety-efficiency-and-modernization>,
  <https://docs.vaisala.com/api/khub/documents/_GwXrTbmzzk6upP~A2zHdg/content>,
  <https://docs.vaisala.com/r/M213187EN-A/en-US/GUID-CC7BD793-9F62-47CF-A7A7-32B31A17DEA5>,
  <https://docs.vaisala.com/api/khub/documents/1qibteD2sEntxWt~WPmJ3Q/content>,
  <https://www.vaisala.com/en/services/myvaisala-online-hub>,
  <https://www.vaisala.com/en/support-portal>,
  <https://docs.vaisala.com/api/khub/documents/F7APay8B5_3SPr7IDblh4Q/content>,
  <https://docs.vaisala.com/r/M211676EN-G/en-US/GUID-1E284424-28CE-4698-8777-0038B726583E/GUID-26C618A5-61BE-4065-9E3F-9B4CE7026880>,
  <https://www.vaisala.com/en/press-releases/2025-05/vaisala-launches-avimet-10-elevate-airport-weather-awareness>
- SENEAM formal meteorological-data service, 2026 simplification, directory,
  AFTN tariff page, transparency page, and its direct PNT/SIPOT subject preset:
  <https://www.gob.mx/tramites/ficha/estadisticas-de-informacion-meteorologica/SENEAM5293>,
  <https://www.dof.gob.mx/nota_detalle_popup.php?codigo=5780615>,
  <https://www.seneam.gob.mx/breve/address/tel.htm>,
  <https://www.seneam.gob.mx/gobmx/cuotas/cuotas2017.html>,
  <https://www.seneam.gob.mx/gobmx/transparencia/transparencia.html>,
  <https://consultapublicamx.plataformadetransparencia.org.mx/vut-web/faces/view/consultaPublica.xhtml?idEntidad=MzM=&idSujetoObligado=Mjg1#inicio>
- SEMAR BASANMEX page and plaintext feed:
  <https://meteorologia.semar.gob.mx/dirmet/estaciones/basanmex.html>,
  <https://meteorologia.semar.gob.mx/datos_emas/basanmex.txt>
- SEMAR EMAS map, BASANMEX chart, and chart JavaScript:
  <https://meteorologia.semar.gob.mx/red_emas_ligero_maps.html>,
  <https://meteorologia.semar.gob.mx/graficaDatos.htm?id=51>,
  <https://meteorologia.semar.gob.mx/java/Base.js>
- Archived BASANMEX feed showing the same quarter-hour series in 2022:
  <https://web.archive.org/web/20220625052832id_/https://meteorologia.semar.gob.mx/datos_emas/basanmex.txt>
- SEMAR AION entry points and NOAA HADS Mexico list used to investigate an
  authorized archive/interagency mirror:
  <https://diredimoat.semar.gob.mx/oceanografia/AION.html>,
  <https://diredimoat.semar.gob.mx/oceanografia/CarruselAion2.html>,
  <https://aion.semar.gob.mx/pub/>,
  <https://aion.semar.gob.mx/aion/app.js?v=20260721113618>,
  <https://hads.ncep.noaa.gov/charts/MX.shtml>
- Campbell Scientific references used only to frame a provider-mediated
  BASANMEX export request, not to infer enrollment or logger model:
  <https://www.campbellsci.com/campbellcloud>,
  <https://help.campbellsci.com/cloud-en/api-requests/receive-data-from-station.htm>,
  <https://www.campbellsci.com/lndb>
- SEMAR's current public-services manual and national transparency request
  portal for automatic-station data:
  <https://semar.gob.mx/Difusion/ManualDeServiciosAlPublico.pdf>,
  <https://www.plataformadetransparencia.org.mx/>
- Current SEMAR real-time monitoring/database-sharing report and historical
  NOAA transfer description (the latter is not evidence of a current route):
  <https://transparencia.semar.gob.mx/rendicion%20de%20cuentas/AVANCE_Y_RESULTADOS_ENERO_2023_-_JUNIO_2024_PSM.PDF>,
  <https://www.semar.gob.mx/meteorologia/reporteNOAA.htm>
- SEMAR AVIMET home page, packages, manual, and public configuration:
  <https://meteorologia.semar.gob.mx/>,
  <https://meteorologia.semar.gob.mx/dirmet/aplicacion/avimet_1.0.2.apk>,
  <https://meteorologia.semar.gob.mx/dirmet/aplicacion/qr_avimet_ios.pdf>,
  <https://meteorologia.semar.gob.mx/dirmet/aplicacion/manual.pdf>,
  <https://meteorologia.semar.gob.mx/alertas/config/config.txt>
- SEMAR cold-front publication describing AVIMET's severe-weather role:
  <https://meteorologia.semar.gob.mx/dirmet/pdf/pron_frentes_frios.pdf>
- SEMAR 2018-2024 management report describing AVIMET and EMAS separately:
  <https://transparencia.semar.gob.mx/programas/Informe_de_Gestion_Gubernamental_SEMAR.pdf>
- UNINDETEC AVIMET iOS landing, enterprise manifest, and version metadata:
  <https://calipso.unindetec.edu.mx/avimet/>,
  <https://calipso.unindetec.edu.mx/avimet/app/avimet.plist>,
  <https://calipso.unindetec.edu.mx/avimet/version.json>
- SEMAR request forms:
  <https://www.semar.gob.mx/paginas_html/formato_sin_fines_de_lucro.html>,
  <https://www.semar.gob.mx/paginas_html/formato_con_fines_de_lucro.html>
- SENEAM's official CAPMA portal identity, site-use conditions, and AFAC's
  circular identifying the exact portal as a CAPMA SIGMET publication surface:
  <https://www.gob.mx/seneam/acciones-y-programas/centro-de-analisis-y-pronosticos-capma>,
  <https://www.gob.mx/seneam/acciones-y-programas/condiciones-de-uso-53048>,
  <https://www.dof.gob.mx/2024/SICT/ca-av-019-14-r2-31-ene-24r-07022024.pdf>
- CAPMA exact portal, visible `DATOS MMMX` navigation, public TDZ wrappers and
  changing runway-display JPEGs:
  <http://capma.mx/capma/capma.html>,
  <http://capma.mx/capma/menu.html>,
  <http://capma.mx/capma/dts.html>,
  <http://capma.mx/capma/pista05.php>,
  <http://capma.mx/capma/pista23.php>,
  <http://capma.mx/banco/pista05.jpg>,
  <http://capma.mx/banco/pista23.JPG>,
  <http://capma.mx/banco/MMTJ_P27.jpg>
- Public third-party copy of _Manual Operativo de la Estación Telemétrica AWOS_
  used for the exact 2014 AICM GUI match and architecture/history description.
  The uploader is not authenticated as SENEAM and no official hosted copy was
  found; this is strong technical identification evidence, not first-party
  provenance:
  <https://es.scribd.com/document/270917790/Manual-Op-Stn-Met-AWOS>,
  <https://es.scribd.com/user/193687933/mario-fregoso>
- SENEAM organizational-function documents used only to corroborate that its
  meteorology subdirectorate creates manuals and plans meteorological systems,
  not to authenticate the third-party upload:
  <https://www.seneam.gob.mx/transparencia/archivos/FUNCIONES.pdf>,
  <https://www.seneam.gob.mx/transparencia/archivos/1099.pdf>
- Campbell Scientific's original 2009 SENEAM/Disime case, current case page,
  full-resolution San José del Cabo display photograph, and current Disime
  partner listing. These establish the six-airport Campbell-logger/VHF/PC
  architecture and Disime's integrator/configurator role, not MMMX logger or
  blue-GUI authorship:
  <https://www.campbellsci.com/resources/case-studies/mexico-airports-aws>,
  <https://s.campbellsci.com/documents/af/case-studies/mexico%20aviation.pdf>,
  <https://res.cloudinary.com/campbellsci/image/upload/502.jpg>,
  <https://www.campbellsci.es/disime>
- Disime's current meteorology and corporate product pages, used as capability/
  contact evidence rather than evidence of a public station-data service:
  <https://disime.com.mx/meteorologia.html>,
  <https://disime.com.mx/>
- Official CompraNet 3.0 archive and SENEAM accountability report used for the
  cross-document AICM/Disime link. In the archive, use `LP2010.csv`, physical
  line 34213, procedure `09111003-008-10`, contract `20100143SNF`, file UUID
  `236c5a83-9157-4c1c-97c0-8b51098dfa29`; the SENEAM report's printed page 70
  names the destination airports:
  <https://comprasmx.buengobierno.gob.mx/cnet3>,
  <https://www.seneam.gob.mx/transparencia/archivos/IRC_I_SENEAM_2012.pdf>
- Official 2007 SENEAM award notice naming Disime for telemetric stations at
  Ciudad del Carmen, La Paz, Los Mochis, San José del Cabo, and Veracruz:
  <https://dof.gob.mx/nota_detalle_popup.php?codigo=5005006>
- CAPMA's legacy 2015-era `DATOS MMMX` page using the same image filenames and
  the Wayback record for the stable exact portal frameset:
  <http://capma.mx/capma/datosmmmx.html>,
  <https://web.archive.org/cdx/search/cdx?url=capma.mx/capma/capma.html&output=json>
- CAPMA public live AFTN METAR relay and MMMX ETDS departure forecast:
  <http://capma.mx/reportemetar/elegir_samx_3.php>,
  <http://capma.mx/banco/ETDS.HTM>
- CAPMA's server-rendered MMMX report history and METAR-derived temperature/
  dew-point/altimeter chart:
  <http://capma.mx/reportemetar/buscar_samx.php?id=MMMX>,
  <http://capma.mx/reportemetar/gramet.php>,
  <http://capma.mx/reportemetar/metartodos.php?id=MMMX>
- SMN/CONAGUA SIVEA:
  <https://smn.conagua.gob.mx/tools/GUI/sivea_v3/sivea.php>
- CDMX REDMET open data:
  <https://datos.cdmx.gob.mx/dataset/redmet>
- WeatherLink v2 API and data permissions:
  <https://weatherlink.github.io/v2-api/>,
  <https://weatherlink.github.io/v2-api/data-permissions>
- Weather Company/Weather Underground terms:
  <https://www.wunderground.com/company/legal>
- UNAM PEMBU/RUOA:
  <https://pembu.dgenp.unam.mx/presentaci%C3%B3n/estaci%C3%B3n-meteorol%C3%B3gica>,
  <https://ruoa.unam.mx/pembu/ccho-pembu/>
- LiveATC terms:
  <https://www.liveatc.net/legal/>
- AICM SIGA announcement:
  <https://www.aicm.com.mx/nuevo-sistema-de-gestion-aeroportuaria-en-el-aicm/27-04-2026>
- WMO `mx-smn` operational notice, exact discovery inventory, and OSCAR
  records that distinguish Tacubaya `76679` from hourly surface station
  `76680`:
  <https://wmo.int/media/news/wis2-operational-newsletter-no3>,
  <https://wis2-gdc.weather.gc.ca/collections/wis2-discovery-metadata/items?centre-id=mx-smn&limit=100&f=json>,
  <https://oscar.wmo.int/surface/rest/api/stations/station/10863/stationReport>,
  <https://oscar.wmo.int/surface/rest/api/stations/station/10864/stationReport>
- WMO GTS-to-WIS2 transition guidance and NOAA's current report-level MMMX
  bulletin:
  <https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/wmo-information-system-wis/guidance-transition-from-gtswis1-wis2>,
  <https://tgftp.nws.noaa.gov/data/raw/sa/samx41.mmmx..txt>

## Implemented Mexico weather dashboard

Implementation reviewed: **2026-08-14**.

This section is the implementation contract added after the source research
above. It supersedes only the earlier historical statement that no Mexico route,
collector, schema table, or cron existed. It does not weaken any source-identity,
precision, permission, or approval conclusion in the research.

### Routes and displayed source boundaries

- `/mexico/today` resolves the current calendar date in
  `America/Mexico_City` on the server and redirects to
  `/mexico/day/YYYY-MM-DD`.
- `/mexico/day/[date]` is the dated MMMX dashboard. Its stored-data queries are
  `mexico:getDayDashboard` and
  `mexicoPolymarket:getDayProbabilities`, both with `stationIcao: "MMMX"` and
  the route date.
- The page reads Convex storage reactively. Browser code does not fetch AWC,
  SMN, CAPMA, or Polymarket directly. Manual refreshes use these server-side
  entry points:
  - `mexico:pollAwcMetars`;
  - `mexico:pollAwcTaf`;
  - `mexicoForecastNode:pollSmnHourlyForecast`;
  - `mexicoPolymarket:pollDailyHighProbabilities`; and
  - `mexicoCapma:requestCapmaRefresh` for the approval-gated TDZ images.
- On today's route the client invokes that same five-source refresh once when
  the date is first displayed. After that, the reactive Convex query reflects
  cron-written rows; the browser does not run its own upstream polling loop.
  The one-second timer on the page updates only its displayed clock and
  freshness labels. Historical dates never trigger source refresh actions.
- The combined temperature chart keeps forecast and observation meanings
  visually and semantically separate:
  - SMN/CONAGUA hourly municipal forecast temperature at its valid hour;
  - the official MMMX TAF `TX` maximum at its forecast occurrence time;
  - one official MMMX METAR/SPECI temperature series at observation time; and
  - one CAPMA live-temperature series at embedded screen time, only while all
    required CAPMA gates permit public display. TDZ 05 is the whole-day chart
    source when it has rows; TDZ 23 is used only as a whole-day fallback when
    TDZ 05 has none. Both TDZ feeds remain separately visible in source cards,
    image/OCR audit, and trust analysis.
- The built-in Chart.js legend is disabled because the page has one explicit
  source key. This avoids naming the same observed source twice and makes the
  two observed concepts unambiguous: `METAR / SPECI` and `CAPMA live
temperature`.
- Forecast weather icons and precipitation details come from the SMN hourly
  row. TAF change windows retain their decoded `BECMG`, `TEMPO`, `FM`, or
  `PROB` meaning; a `TEMPO` rain interval is not presented as continuous rain.
- The chart never blends, averages, interpolates, or relabels municipal,
  METAR, TAF, and CAPMA data as one thermometer. Tooltips and supporting tables
  retain the source, site, precision, valid/observation time, and collection
  metadata.
- Polymarket probabilities use a separate `0-100%` chart, never the temperature
  chart's y-axis. Each line is one dynamically discovered daily-high bucket.
  Historical dated routes read only the snapshots that were actually stored for
  that date.
- The homepage links to `/mexico/today` rather than calculating the Mexico
  City date in the browser.

### AWC METAR/SPECI collection and publication timestamps

`mexico:pollAwcMetars` calls the documented machine endpoint server-side:

```text
https://aviationweather.gov/api/data/metar?ids=MMMX&format=json&hours=2
```

The action sends a descriptive user agent, uses a two-hour rolling lookback,
and has a shared 60-second per-source cooldown. The lookback prevents an
intervening `SPECI`, correction, or out-of-order arrival from being lost. AWC
states that an endpoint must not be consumed more often than once per minute
per thread; the production cron therefore polls once per minute. HTTP failures
update collector status and do not create observations.

The timestamps have distinct meanings:

| Stored field                        | Meaning                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `obsTimeUtc`                        | Effective observation time from AWC `obsTime` / raw `YYGGggZ`                            |
| `reportTimeUtc`                     | AWC report-cycle time; stored as metadata, never used as observation or publication time |
| `initialAwcReceiptTimeUtc`          | First AWC `receiptTime` stored for the raw report                                        |
| `latestAwcReceiptTimeUtc`           | Most recent AWC receipt metadata seen for the same raw report                            |
| `firstSeenAt`                       | Immutable time this application first fetched the report                                 |
| `fetchStartedAt`/`fetchCompletedAt` | Local request envelope used to bound application delivery time                           |

Chart points use `obsTimeUtc`. The UI may say **AWC received** for
`initialAwcReceiptTimeUtc` and **first seen here** for `firstSeenAt`; it must
not call either value SENEAM's unexposed originating transmission time. The
stored raw METAR and provider JSON remain available for audit. AWC occasionally
omits a decoded temperature even when the official raw METAR/SPECI and its
timestamps are usable. Such a report is still stored and shown in the
publication-audit table with an unavailable temperature; only its temperature
chart point is omitted. When present, METAR temperature has `1 °C` encoded
precision even though the UI can convert it to Fahrenheit.

Rows dedupe by station, observation time, report type, and raw hash. A
correction with changed raw content is therefore preserved instead of silently
overwriting the report it corrects.

### Continuous CAPMA versus METAR/SPECI trust analysis

`mexico:getDayDashboard` continuously derives a gated CAPMA trust result from
the stored official reports and OCR observations. Today's page shows a rolling
24-hour result; a historical page shows the selected day's result. Convex
reactivity recomputes the card as the minute collector adds CAPMA rows or the
AWC collector adds a METAR/SPECI. No upstream request is made by the browser.

The dashboard deliberately returns two differently anchored results:

- **release-window agreement**, requested for the live dashboard, uses
  `initialAwcReceiptTimeUtc` when AWC supplies it and otherwise the immutable
  application `firstSeenAt`; and
- **observation-time agreement** uses the official report's `obsTimeUtc`,
  because that is the time to which the encoded METAR temperature actually
  applies.

The release anchor is described as an **AWC receipt / application first-seen
release proxy**. It is never called the exact SENEAM originating publication or
transmission time, which remains unexposed. `reportTimeUtc` is not used.

For each TDZ independently, the algorithm selects the nearest eligible CAPMA
row at or before the anchor and the first strictly later row. Both must be
within an inclusive two-minute window and use embedded `screenTimeUtc`. Thus a
00:01 anchor can pair 00:00 with 00:02, or cross the local date boundary by
pairing 23:59 with 00:03. The two sides must come from the same TDZ; an exact
anchor row is used once as the `before` side. Deterministic ties use earliest
`firstSeenAt` and then lexical body hash.

The headline uses CAPMA's large `currentTempC` field, matching the live chart.
The separate two-minute display field is calculated only as a labeled
diagnostic and is never substituted to improve the score. A CAPMA row is
ineligible for live comparison when its validated image arrived more than
three minutes after its embedded screen time or appears more than 30 seconds in
the future.

Both official and CAPMA temperature fields have whole-degree Celsius
precision. One distinct official report receives one vote and passes only when
every reading in every complete TDZ bracket is within `±1 °C` of the official
temperature. The card also returns exact-match rate, reading-level mean/max
absolute error, two-minute-field agreement, pending-window count, and missing-
bracket count. Corrections remain in the raw audit, but only the latest stored
raw report for a station + observation time + report type contributes to the
percentage so a correction cannot double-weight one observation.

The UI always exposes numerator and denominator. It labels results below 10
eligible official reports as **collecting baseline** and shows any early
percentage only as explicitly non-trusted context. Ten through 19 is
**provisional**; 20 or more is **established**. The percentage is a report match
rate, not a fabricated `100 - temperature difference` score.

The UTC range read uses
`mexicoCapmaTdzObservations.by_station_screen_time`, so midnight brackets do
not depend on the selected local-date partition. All CAPMA access, retention,
and republication gates must be exact `true` before rows or derived trust
results are queried or returned.

### AWC TAF, forecast maximum, and peak time

`mexico:pollAwcTaf` calls:

```text
https://aviationweather.gov/api/data/taf?ids=MMMX&format=json
```

It stores the raw TAF plus AWC `issueTime`, `bulletinTime`, `dbPopTime`, and
validity bounds. `issueTimeUtc` is the forecast issuance time;
`bulletinTimeUtc` is the official bulletin time; `awcDatabaseTimeUtc` is when
AWC received/populated the product; and `firstSeenAt` is this application's
receipt. Corrections and amendments are marked explicitly and captures dedupe
by station, issue time, and raw hash.

The AWC schema defines decoded `fcsts[].temp`, but live MMMX responses were
observed with empty decoded temperature arrays while `rawTAF` still contained
groups such as:

```text
TX25/0421Z TN15/0512Z
```

The collector therefore parses raw `TX`/`TN` groups. `M` is a negative sign.
To resolve a day-of-month across a month boundary, it generates candidates in
the previous, anchor, and following UTC months and accepts only the unique
candidate inside the inclusive TAF validity interval. Ambiguous or invalid
groups are omitted rather than guessed. The `TX` point supplies the
airport-specific forecast maximum and its peak time; SMN's municipal hourly
maximum remains a separate value.

Decoded TAF periods store their validity windows, change type, probability,
weather code, clouds, visibility, and wind. The day query selects the newest
stored TAF capture whose temperature group or validity interval covers the
requested Mexico City date. TAF collection uses the same descriptive AWC user
agent and shared cooldown/rate discipline as METAR collection.

### SMN/CONAGUA municipal hourly forecast

`mexicoForecastNode:pollSmnHourlyForecast` is a Node action that fetches the
documented compressed hourly service:

```text
https://smn.conagua.gob.mx/tools/GUI/webservices/?method=3
```

SMN documents the endpoint as `PronosticoPorMunicipios48HrsGZ` at
<https://smn.conagua.gob.mx/es/web-service-api>.

It selects only:

```text
ides="9"
idmun="17"
nmun="Venustiano Carranza"
latitude=19.4193
longitude=-99.1137
```

That municipal point is about `4.8 km` from the MMMX reference point. Every
legend, tooltip, and source label must therefore say **SMN/CONAGUA municipal
forecast · Venustiano Carranza · 4.8 km from MMMX**, not “MMMX airport
forecast.” The airport-specific maximum/peak marker comes from TAF.

The response is a gzip attachment rather than an HTTP content-encoding. A live
research sample was about `7.7 MB` compressed and `104 MB` decompressed. The
Node collector streams `Response.body` through SHA-256 accounting and
`createGunzip`, incrementally recognizes complete JSON objects, and retains
only state `9` / municipality `17`. It does not buffer or `JSON.parse` the
entire national payload. The stream parser requires exactly one complete JSON
root array: optional leading JSON whitespace, the opening `[`, object entries
with valid separators, the closing `]`, and only JSON whitespace afterward.
Missing brackets, a trailing comma, trailing non-whitespace data, an object
over `32 KB`, an incomplete gzip/JSON stream, unexpected content type, fewer
than 24 usable target rows, or an HTTP failure rejects the capture.

SMN values arrive as strings. The collector parses `hloc` with the row's `dh`
UTC offset and stores temperature, the original Spanish condition text, a
normalized condition key, precipitation probability and amount, humidity,
dew point, wind, gusts, and the exact selected source row. It does not rely on
the documented “48-hour” row count; the live service has returned more than
48 target hours.

The action has a 30-minute backend cooldown and uses `If-Modified-Since` when
available. SMN describes the feed as updated hourly at minute `:15`; the
production cron runs at `:20`, allowing a five-minute publication margin. That
margin is a collection choice, not a measured SMN delivery SLA.
`Last-Modified` is relay metadata, not a forecast issuance time.
Each successful collection stores one capture record with sizes, hashes, total
object count, target-row count, and only the selected municipality rows, then
upserts the current query-friendly curve by forecast valid time.
Collector status, capture rows, normalized rows, and the page status lookup all
use the same source key: `smn_municipal_hourly`.

The service is explicitly documented for consumption by SMN and CONAGUA's
open-data guidance permits reuse and redistribution. It is not approval-gated,
but the UI must attribute **Servicio Meteorológico Nacional / CONAGUA**, link
the source, preserve the municipal-site disclosure, and avoid excess bulk
downloads. The applicable CONAGUA open-data guidance is at
<https://app.conagua.gob.mx/datosabiertoscna/index.html>.

### Polymarket daily-high probability snapshots

`mexicoPolymarket:pollDailyHighProbabilities` records the public implied
probabilities for Polymarket's recurring **Mexico City Daily Weather** series.
The supplied August 14 example is:

```text
https://polymarket.com/event/highest-temperature-in-mexico-city-on-august-14-2026
```

The collector discovers each local date through the stable series identity
`series_id=11428` and `event_date=YYYY-MM-DD`:

```text
https://gamma-api.polymarket.com/events/keyset?series_id=11428&event_date=YYYY-MM-DD&limit=5
```

It validates `seriesSlug=mexico-city-daily-weather` and the event's local date.
Daily bucket ranges are not hardcoded: August 14 exposed 11 markets from `19°C
or below` through `29°C or higher`, while adjacent dates can shift those bounds.
The recurring template returned 11 markets with thresholds `0..10` on sampled
dates from May through August 2026. The collector therefore requires that
complete shape with unique, contiguous ordinals; a partial response or future
template change fails closed for review instead of being charted as a complete
snapshot.
For every market the collector JSON-decodes `outcomes`, `outcomePrices`, and
`clobTokenIds`, locates the outcome named `Yes`, and takes the price and token at
that same array index. `groupItemTitle` is the display label and numeric
`groupItemThreshold` is only the bucket order; the code does not infer a
temperature from a slug. The three arrays must be one-to-one binary metadata,
with exactly one `Yes`, strict numeric prices, and a nonempty token at each
outcome index. Missing event date/series identity, malformed JSON, duplicate
market IDs/slugs/conditions/Yes tokens/labels/orders, or any outcome price
outside `0..1` rejects the entire snapshot.

The stored/charted percentage is `outcomePrices[Yes] * 100`, with the explicit
semantic label `gamma_outcome_price`. Polymarket documents outcome prices as
implied probabilities. The collector also retains available Yes best-bid,
best-ask, and last-trade percentages for tooltip/audit context, but it does not
substitute an ask, a stale last trade, or a locally calculated value for the
published outcome probability. It preserves every bucket value exactly as
published and does **not** normalize the bucket total to 100%; independent
request timing and market spreads can make the displayed sum differ slightly.

The server-side `America/Mexico_City` gate permits upstream work only from
`11:00` through the `18:00` minute, inclusive. The production cron invokes the
action every minute, but outside that window the action returns before claiming
or making an HTTP request. Cron and manual entry points share an atomic UTC
minute-slot claim. Claims move forward monotonically, so at most one request
starts in each minute without a late or out-of-order manual attempt suppressing
the next cron minute. Each successful request writes
one compact document containing all daily buckets. Its snapshot key combines
the local event date with the claimed UTC request-start minute, keeping adjacent
claims distinct even if both responses complete in the same minute. Status
completion is conditional on that exact claim, so an older overlapping request
cannot overwrite a newer attempt's state. Capture and chart time remain the
completed response time, not the request start. The page reads a chart-only
projection of those rows reactively and renders one stepped line per bucket on
a separate `0-100%` chart. Line dash patterns supplement color, the capture
audit table exposes the same history non-visually, and a gap longer than 90
seconds explicitly breaks every line. Hover selection uses two-dimensional
nearest-line distance and the tooltip is restricted to one bucket, so pointing
at (for example) the `26°C` line shows only that bucket's probability, quote
context, and exact snapshot time rather than every bucket captured in that
minute.

The probability chart also has an independent top timeline for official MMMX
`METAR`/`SPECI` arrivals during the visible collection window. Each tick is
positioned and labeled to the millisecond from `initialAwcReceiptTimeUtc`; when
that provider field is unavailable, the chart uses `firstSeenAt`, adds `*` to
the report type, and displays a first-seen fallback note. These are exact stored
timestamps for the AWC relay/application arrival, not a claim about SENEAM's
unexposed originating publication or transmission time. The bottom axis remains
the hourly Mexico City probability-capture timeline.

During the active window, a last collector attempt more than two
local clock minutes old is labeled stale rather than healthy. The outbound
event link appears only after a stored snapshot has
verified that event. Historical pages do not call Polymarket or
fabricate/backfill samples.

Gamma discovery/current market data is an official unauthenticated public read
API and needs no wallet, API key, or special production approval flag. This
collector is far below Polymarket's published Gamma rate limits. Provider
unavailability updates the shared `polymarket_gamma` collector status and does
not insert a partial or synthetic snapshot. Relevant official documentation:

- market-data model and outcome-price semantics:
  <https://docs.polymarket.com/market-data/overview>;
- public versus authenticated endpoints:
  <https://docs.polymarket.com/api-reference/introduction>;
- keyset event discovery:
  <https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination>;
- rate limits:
  <https://docs.polymarket.com/api-reference/rate-limits>.

### Convex tables

| Table                        | Purpose and identity                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mexicoCollectorStatus`      | One operational status per station/source, including cooldown, HTTP/cache metadata, row count, errors, and last success                               |
| `mexicoMetarObservations`    | Auditable official METAR/SPECI rows keyed by station + observation time + report type + raw hash; decoded `tempC`/`tempF` are optional                |
| `mexicoTafForecasts`         | Immutable TAF issue/raw-hash captures with TX/TN groups and decoded condition periods                                                                 |
| `mexicoSmnForecastCaptures`  | Per-fetch SMN provenance, sizes/hash/counts, and the selected Venustiano Carranza raw rows                                                            |
| `mexicoSmnHourlyForecasts`   | Latest normalized municipal forecast by station + valid time for chart queries                                                                        |
| `mexicoPolymarketProbabilitySnapshots` | One idempotent minute snapshot containing the daily event identity and all dynamically discovered Yes probability buckets                    |
| `mexicoCapmaTdzObservations` | Separately identified TDZ 05/23 OCR readings keyed by station + TDZ + JPEG body hash, with UTC screen-time indexing for cross-midnight trust brackets |
| `mexicoCapmaLatestImages`    | One replaceable raw JPEG and its display/OCR metadata per station + TDZ; never an image history                                                       |

`mexicoCapmaTdzObservations` stores the parsed current and two-minute whole-
degree temperatures, embedded screen time, dimensions, OCR confidence/engine,
headers, byte count, body hash, and collection envelope. Historical OCR rows
remain auditable, but raw-image retention is deliberately bounded:
`mexicoCapmaLatestImages` has at most one referenced Convex storage object for
TDZ 05 and one for TDZ 23. A successful new image atomically replaces that
TDZ's metadata and deletes the prior storage object. If CAPMA returns an
unchanged body with HTTP 200, the newly uploaded duplicate is deleted and the
existing object remains. Latest-image selection is monotonic by the embedded
`screenTimeUtc`: a differing JPEG with an older screen time still creates or
updates its historical OCR observation, but its upload is deleted and it cannot
roll the viewer backward. At an equal embedded timestamp, the existing
validated image wins deterministically; the incoming image replaces it only
when the referenced current storage object is missing or fails its stored hash,
size, or content-type checks. This is a latest-image viewer, not a raw-image
archive.

### CAPMA fixed-layout JPEG extraction

The only allowed image URLs are:

```text
http://capma.mx/banco/pista05.jpg
http://capma.mx/banco/pista23.JPG
```

The Node worker uses conditional `If-None-Match` and `If-Modified-Since`
requests, validates a JPEG content type and a `50,000` to `1,000,000` byte
body, decodes with `jpeg-js`, and refuses fixed-layout OCR unless the image is
exactly `1366 x 768`.

The fetch uses `redirect: "manual"`; it never follows a response away from the
two approved URLs. `304 Not Modified` is the sole accepted 3xx response because
it is cache validation and has no redirected body. Every other `300` through
`399` status is rejected before any body can enter validation, OCR, or storage.

Its current template regions are:

| Field                  | Rectangle (`x0,y0` to `x1,y1`) |
| ---------------------- | ------------------------------ |
| Embedded UTC date      | `1070,12` to `1245,47`         |
| Embedded UTC time      | `1065,48` to `1255,90`         |
| Current temperature    | `330,215` to `550,275`         |
| Two-minute temperature | `145,546` to `245,580`         |
| TDZ digits             | `375,655` to `420,690`         |

`fixed_layout_arial_template_v1` performs deterministic connected-component
and digit-template classification. It validates all eight date digits, all six
time digits, both temperature fields, the expected `05`/`23` TDZ, a minimum
combined confidence of `0.60`, and an embedded timestamp no more than 15
minutes ahead of or 24 hours behind the fetch. A dimension, layout, timestamp,
field, confidence, or TDZ mismatch rejects the image; the collector never
guesses. The displayed timestamp is parsed as UTC. The plotted value is the
large current-temperature field; the separate two-minute value remains an
explicit diagnostic. Both have `1 °C` precision.

Only after those validations and a fresh access/retention gate check does the
Node action upload the JPEG as `image/jpeg`. It computes the digest bytes once,
uses their 64-character lowercase hexadecimal form as the public/dedupe
`rawHash`, and uses their 44-character base64 form as the expected Convex
storage digest. Convex production currently reports `_storage.sha256` in that
base64 representation, while compatible runtimes may report hex. The storage
mutation rechecks both gates and accepts the platform digest only when it
equals one of those two representations of the same digest bytes. It persists
the exact verified platform value separately as `storageSha256`; every later
storage validity check uses that field, while proxy paths and public identity
continue to use lowercase-hex `rawHash`.

The same mutation also verifies byte count and content type against the
validated response, stores the OCR observation, swaps the singleton
latest-image row, and deletes the prior object in one transaction. If the
action uploads a file but the following gate
check, validation, or transaction fails, a cleanup mutation first proves no
latest-image row references the upload and only then deletes it. That reference
check also covers the ambiguous case where a mutation committed but its caller
received an error.

ETag and `Last-Modified` are retained only as relay metadata. The immutable
dedupe identity uses TDZ plus SHA-256 body hash, and chart timing uses the
embedded screen timestamp. A fresh file timestamp cannot make a stale screen
fresh, and one `Last-Modified` value cannot identify one immutable image. The
worker sends conditional headers only when that TDZ already has a retained
latest-image row. This guarantees the first fetch after the storage feature is
deployed requests a body instead of accepting a `304` based on older collector
status metadata and leaving the viewer empty.

### CAPMA approving authority, scope, and environment gates

Production image automation remains fail-closed unless **SENEAM/CAPMA**, as the
site/data owner and operator, has granted permission for the exact two URLs,
conditional automated polling cadence, plain-HTTP transport, transient image
processing, OCR/derivatives, sensor/display identity, support and attribution.
SENEAM and any required **AICM** authority must separately approve retention
duration and public/commercial display, export, redistribution, derivatives,
attribution, and expiry. A reachable URL, working code, user request, or
credential is not provider/data-owner approval.

The three capabilities are independent and require these exact Convex values:

```text
SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED=true
SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED=true
SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED=true
```

Anything other than the exact string `true` fails closed. Credentials, if a
future provider-supported replacement needs them, must remain separate.

Protected entry points enforce the gates as follows:

1. `mexicoCapma:requestCapmaRefresh` checks access and retention before a
   manual request can queue either TDZ worker.
2. `mexicoCapma:queueScheduledCapmaRefresh` performs the same check before a
   cron can queue work.
3. `mexicoCapmaNode:collectCapmaImage` checks again at worker start,
   immediately before the external request, before JPEG decoding/OCR, and
   before raw-JPEG upload and metadata storage. An unattached upload is deleted
   on failure. Its conditional request has no hidden retry bypass.
4. `mexicoCapma:storeCapmaObservation` checks access and retention again
   inside the database mutation so revocation during an in-flight request
   prevents the row or latest-image reference from being retained. The same
   transaction replaces the TDZ image reference and deletes the prior object.
5. `mexico:getDayDashboard` requires access, retention, and republication
   before querying or returning stored CAPMA rows and before constructing image
   proxy paths. `capma.latestImages` is an object keyed by `05` and `23`; each
   value is either `null` or the globally latest gated relative `path` plus
   screen/capture timestamps, dimensions, byte count, SHA-256, OCR confidence,
   and display metadata. For hosted Convex deployments, the browser derives the
   matching `.convex.site` origin from `NEXT_PUBLIC_CONVEX_URL`, which is already
   the data-query source of truth. `NEXT_PUBLIC_CONVEX_SITE_URL` is only an HTTPS
   fallback for a nonstandard/self-hosted cloud URL. This prevents a stale site
   variable from sending an otherwise valid image path to another Convex
   deployment. Production still sets both variables to the same deployment
   (`rapid-greyhound-887`). Removing republication therefore hides retained rows
   and returns no latest-image paths without relabeling the data.
6. `GET /mexico/capma/latest-image` is the only browser image endpoint. It
   accepts only station `MMMX`, TDZ `05` or `23`, and the exact 64-character
   lowercase SHA-256 of the currently referenced image. The HTTP action checks
   all three gates before its internal lookup, again before reading Convex
   storage, and again before returning the body. It never exposes the permanent
   `ctx.storage.getUrl` bearer URL. A replaced image's hash URL stops resolving,
   and gate removal makes previously issued proxy URLs fail closed. Successful
   responses are `image/jpeg` with `private, no-store, max-age=0`, `Pragma:
no-cache`, and `X-Content-Type-Options: nosniff`.

With the deployment-default access or retention flag absent, manual refresh
returns `approval_required`, scheduled work is not queued, no image is
requested or OCRed, and the public query returns an empty CAPMA series plus the
individual gate states. If access and retention are approved for internal
collection while republication is not, authorized rows may be retained but
the public query still returns none of them and `latestImages` contains only
null values. In either case the page displays
the applicable honest **SENEAM approval required** state. It does not show the
JPEG, fabricate minute values, or substitute SMN/METAR
under the CAPMA label. AWC and SMN remain available under their own labels.

Deploy code, schema, and the disabled cron with all three flags absent. After
the user confirms that the named authorities granted the documented scope,
activate production separately:

```text
npx convex env set SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED true --prod
npx convex env set SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED true --prod
npx convex env set SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED true --prod
```

Revocation must stop new access first and then remove the other capabilities:

```text
npx convex env remove SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED --prod
npx convex env remove SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED --prod
npx convex env remove SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED --prod
```

Development collection also requires authority covering development use. Test
the OCR pipeline with pre-existing local fixtures while approval is absent;
do not make a protected CAPMA request to create a test fixture. The conditional
regression reads all 21 manually transcribed captures when they are present and
skips cleanly when they are absent. Fixture/commit hygiene is enforced by the
exact `.gitignore` entries `/tmp/capma-metar-test/`,
`/tmp/capma-p05-current.jpg`, and `/tmp/capma-p23-current.jpg`; captured images
and their local transcription evidence must never be committed.

### Production cron cadence

| Job / deployed name                                        | Cron expression                             | Entry point                                | Gate/cooldown behavior                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| AWC MMMX METAR/SPECI / `mexico_awc_metar_every_minute`     | `* * * * *`                                 | `mexico:pollAwcMetars`                     | Documented AWC access; 60-second shared cooldown                                                             |
| AWC MMMX TAF / `mexico_awc_taf_every_5_minutes`            | `1,6,11,16,21,26,31,36,41,46,51,56 * * * *` | `mexico:pollAwcTaf`                        | Documented AWC access; 60-second shared cooldown                                                             |
| SMN hourly / `mexico_smn_hourly_forecast_minute_20`        | `20 * * * *`                                | `mexicoForecastNode:pollSmnHourlyForecast` | Venustiano Carranza; five minutes after the documented `:15` update boundary; 30-minute shared cooldown      |
| Polymarket daily high / `mexico_polymarket_daily_high_every_minute` | `* * * * *`                       | internal `mexicoPolymarket:pollScheduledDailyHighProbabilities` | Public Gamma API; server gate allows requests only 11:00-18:00 Mexico City; shared atomic one-minute slot |
| CAPMA image queue / `mexico_capma_tdz_images_every_minute` | `* * * * *`                                 | `mexicoCapma:queueScheduledCapmaRefresh`   | No queue/request unless access and retention are exact `true`; each TDZ worker also has a 60-second cooldown |

Crons and manual controls share backend claim/status rows, so an open page
cannot double the Polymarket request rate within a minute. A cron schedule does not weaken a
provider gate: the CAPMA scheduled mutation must remain deployed and visibly
disabled while approval is absent, and the worker rechecks approval immediately
before every protected side effect.


### What to recheck when SENEAM finishes the new sensors

Do not restart from hostname guessing. Start from the existing contract and
commissioning trail. Ask for or verify:

- current physical completion and production status of the AICM/MMMX civil
  work and six station positions;
- physical-reception, closeout, as-built, punch-list, warranty, and final
  progress records;
- whether suspended installation/configuration/calibration/commissioning work
  resumed;
- signed FAT/IAT/PSAT/stability/FSAT and service-acceptance records;
- exact deployed station, sensor, logger, central unit, display, viewer, and
  software versions;
- the mapping among the six sites, the old public `PISTA 05/23` screens, METAR
  production, PIIMET/SIGIMET, Tower/CAPMA displays, and any new web viewer;
- the provider-issued URL and a read-only role or supported numeric export;
- native sample, averaging, output, display, and archive intervals;
- 0.1 °C versus whole-degree display behavior, quality flags, and rounding;
- a synchronized representative sample and data dictionary; and
- renewed access, retention, derivation, and republication scope for the exact
  new interface.

The appearance of a new page, hostname, login, or value is not commissioning
evidence and does not inherit approval from the legacy JPEG path.
