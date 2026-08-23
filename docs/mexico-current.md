# MMMX temperature-source investigation handoff

Last consolidated: **2026-08-23**. The underlying handoff remains cumulative;
the newest production timing sample and newly investigated source/licence paths
are in the dated
[2026-08-21 edge investigation](./mexico-edge-investigation-2026-08-21.md).
That report also records the current-law Article 151 correction and reserved,
not-implemented approval gates for every newly found source. The dated
[2026-08-22 TDZ sub-degree investigation](./mexico-edge-investigation-2026-08-22.md)
documents the extended TDZ display fields (dew point, integer humidity,
0.1 hPa station pressure, QNH), the quantized-channel sub-degree inference
path they open, the TDZ-versus-METAR peak bias that bounds its use, and the
collector-egress reliability finding. The dated
[2026-08-23 investigation](./mexico-edge-investigation-2026-08-23.md)
establishes that the TDZ JPEGs are screen captures with no public numeric
endpoint behind them, records the retired first offline sub-degree estimator
prototype (`scripts/tdz-subdegree-estimator.mjs`; its CLI now delegates to
v2.1), and — after
external review falsified its initial rounding-rule discriminator — records
that the display's rounding rule remains **undetermined** and that the
prototype's bands are model-conditional, not validated accuracy. The guarded
v2.1 likelihood identifier (`scripts/tdz-quantizer-id.mjs`) evaluates all eight
quantizer combinations and additive dew-point bias through ±0.5 °C. It finds
that neither the absolute temperature rule nor a shared-versus-mixed T/Td rule
is established independently of those nuisance assumptions. Its
source-time-forward result is a retrospective robust envelope of conditional
bands, not a posterior credible interval; public data therefore do not yet
support a unique, calibrated absolute sub-degree TDZ value.

This is the current, standalone handoff for continuing the Mexico City airport
temperature investigation. It intentionally keeps the durable findings and
explored paths without preserving the chronology of every probe.

## Mission and identity

The target is **Mexico City International Airport / AICM**, ICAO **`MMMX`**,
IATA **`MEX`**. Do not confuse it with Ciudad Juárez, ICAO `MMCS`.

The investigation has two related but different goals:

1. deliver the official `MMMX` METAR/SPECI temperature as soon as the report
   exists; and
2. find a native airport sensor value that updates faster and, ideally, keeps
   the installed system's `0.1 °C` resolution.

Those goals must remain separate. A faster METAR relay is still only the
whole-degree official report. A native runway display is not automatically the
sensor selected for the official METAR.

## Current answer

No public, machine-readable `0.1 °C` native `MMMX` feed has been found.

The fastest verified paths are:

| Rank | Path                                         | What it delivers                                          | Verified delivery                                                            |                Precision | Current conclusion                                                                                    |
| ---: | -------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | -----------------------: | ----------------------------------------------------------------------------------------------------- |
|    1 | CAPMA legacy TDZ images                      | Native-looking runway-end display temperature and weather | Public JPEGs change roughly once/minute                                      |                 Whole °C | Fastest verified public AICM-specific temperature display; exact current sensor lineage is unresolved |
|    2 | CAPMA AFTN report page                       | Official `MMMX` METAR/SPECI text                          | In the paired race, CAPMA won every decisive comparison against NOAA         |                 Whole °C | Fastest verified public official-report relay so far                                                  |
|    3 | NOAA/AWC METAR JSON                          | Canonical structured official report and metadata         | `SPECI` usually 1-2 min; routine reports often arrive in a top-of-hour batch |                 Whole °C | Canonical source and later enrichment path, but not the fastest routine-report relay                  |
|    4 | SENEAM/Vaisala AWOS export, not yet obtained | Potential six-site native airport observations            | Internal display requirement is 5 seconds; no supported external feed found  | Contract requires 0.1 °C | Best unresolved official-airport path                                                                 |
|    5 | SEMAR BASANMEX                               | Separate rooftop airport weather station                  | Native rows nominally 15 min, apparently published in delayed hourly batches |                   0.1 °C | Useful independent airport context after permission; not the `MMMX` official sensor                   |

Nearby personal weather stations can update every one to five minutes, but
their siting and calibration are unverified and they are not airport truth.

## Fastest official-report path: CAPMA AFTN

Exact approved collector target:

```text
http://capma.mx/reportemetar/buscar_samx.php?id=MMMX
```

The URL is publicly reachable without a login, API key, or cookies. It is a
server-rendered webpage over plain HTTP, not a documented API. Public
reachability alone does not establish permission for automated polling,
retention, or republication.

The page contains recent SENEAM/CAPMA AFTN METAR/SPECI report lines. Routine
lines omit the leading `METAR ` token and use padded whitespace. After:

1. collapsing whitespace; and
2. adding `METAR ` when the report-type token is absent,

the CAPMA report is byte-identical to AWC's `rawOb` for the same report. This
lets a CAPMA-first row and the later AWC response share one normalized raw hash
and one `reportKey`. AWC enriches the existing row rather than creating a
second temperature point.

### Paired CAPMA-versus-NOAA result

The production experiment launches CAPMA and NOAA from the same parent action
once per minute. A result counts as a source win only when:

- that source first saw the report in an earlier one-minute slot; and
- both endpoints succeeded in that earlier slot.

Same-slot arrivals are indeterminate. A missing, cooling-down, disabled, or
failed opponent in the earlier slot makes the comparison invalid rather than a
win.

Snapshot through `2026-08-20T22:22:35Z`, combining Mexico City observation
dates `2026-08-19` and `2026-08-20`:

| Metric                                            |                                      Result |
| ------------------------------------------------- | ------------------------------------------: |
| Matched reports                                   |                                          29 |
| Decisive valid comparisons                        |                                          19 |
| CAPMA wins                                        |                                          19 |
| NOAA wins                                         |                                           0 |
| Same polling minute, order unknown                |                                           6 |
| Invalid/incomplete pairs                          |                                           4 |
| CAPMA-only reports in retained comparison history |                                          16 |
| NOAA-only reports                                 |                                           0 |
| Median CAPMA lead, decisive reports               |                     779.514 s / 12m 59.514s |
| Decisive lead range                               | 105.945-1079.646 s / 1m 45.945s-17m 59.646s |

Breakdown:

| Report class    | Matched | Decisive | CAPMA | NOAA | Same slot | Invalid |       Median CAPMA lead |
| --------------- | ------: | -------: | ----: | ---: | --------: | ------: | ----------------------: |
| Routine `METAR` |      20 |       17 |    17 |    0 |         0 |       3 | 839.108 s / 13m 59.108s |
| `SPECI`         |       9 |        2 |     2 |    0 |         6 |       1 |  112.769 s / 1m 52.769s |
| Corrections     |       0 |        0 |     0 |    0 |         0 |       0 |                     n/a |

The `CAPMA-only` count is not a win count. CAPMA returns report history while
NOAA's station file exposes only its current report, so unmatched historical
rows and bootstrap coverage are expected.

The supported conclusion is now strong but narrow:

- CAPMA clearly beat NOAA for routine reports during this observation window;
- CAPMA also won both decisive `SPECI` comparisons, while most special reports
  appeared within the same one-minute slot; and
- this measures relay availability, not sensor sampling or SENEAM's originating
  transmission time.

The experiment should continue for outages, corrections, quiet-weather days,
and longer seasonal coverage. Do not turn a roughly 20-hour sample into a
permanent service-level guarantee.

The experiment was prompted by an earlier unpaired August 3 rollover. CAPMA
was first observed with `METAR MMMX 032345Z` at `23:54:26Z`; AWC's initial
receipt metadata was `23:59:16.677Z`. CAPMA was therefore observed at least
4m 50.7s earlier in that sample. The paired experiment is the stronger result
because it removes the mismatch between ad hoc browser checks.

## Fastest native-looking path: CAPMA legacy TDZ displays

Public route chain:

```text
http://capma.mx/capma/capma.html
  -> /capma/menu.html
  -> /capma/dts.html
  -> /capma/pista05.php -> /banco/pista05.jpg
  -> /capma/pista23.php -> /banco/pista23.JPG
```

The wrappers contain only an image and do not refresh themselves. The files on
the server nevertheless change independently of a browser page reload.

Verified properties:

- both JPEGs are `1366 x 768` and label AICM, `MMMX`, runway `05/23`, and
  `TDZ:05` or `TDZ:23`;
- visible fields include current and two-minute temperature, dew point,
  humidity, station pressure, QNH, wind, gusts, crosswind, and precipitation;
- every visible temperature is a whole degree Celsius, humidity is an integer
  percent, station pressure is `0.1 hPa`, and QNH is `0.01 inHg`; the
  pressure box drops a trailing `.0` (`787 hPa`), and the value strings are
  centered so digit positions shift with value width;
- the displayed dew point is computed from the unrounded temperature and
  humidity (every live `(T, Td, RH)` triple was Magnus-feasible within
  display quantization), so the extended fields support bounded sub-degree
  temperature inference over time — see the
  [2026-08-22 investigation](./mexico-edge-investigation-2026-08-22.md);
- since 2026-08-22 the collector OCRs and retains dew point, humidity,
  station pressure, QNH, and the two-minute dew point as optional per-field
  validated columns on `mexicoCapmaTdzObservations`, under the same existing
  CAPMA TDZ approval gates and without changing frame acceptance;
- the embedded clock has seconds;
- `PISTA 23` advanced in exact 60-second public-file steps during a bounded
  run, with the embedded display consistently 115 seconds behind file time;
- `PISTA 05` usually advanced by 62 seconds, with one 85-second gap, and its
  embedded time normally matched its file time;
- the server honors conditional `ETag` and `If-Modified-Since` requests; and
- two different valid JPEG bodies were observed under one `Last-Modified`
  during a rollover, so body hash plus embedded time—not mtime—is the identity.

A six-page third-party copy of _Manual Operativo de la Estación Telemétrica
AWOS_ contains a 2014 AICM screenshot that exactly matches the live GUI. It says
runway touchdown-zone sensors transmit by radio to a Tower computer and that
the application writes one instantaneous record per minute to a monthly local
history file. This identifies the GUI with high confidence as SENEAM's legacy
telemetric AWOS, but the manual is not hosted by SENEAM and does not identify
the current sensor, logger, radio, or software vendor.

The current images are not static METAR renderings. During the August 3
rollover:

- both displays matched the new `032345Z` METAR's `22 °C`;
- PISTA 05 also matched its `10 °C` dew point;
- displayed wind and QNH did not exactly match the METAR; and
- both displays later moved to `21 °C` while the published METAR remained at
  `22 °C`.

Therefore the displays contain live local telemetry. It remains unknown
whether they show two independent thermometers, an operator-selected source, a
composite, or an older system running beside the newer Vaisala equipment.

The best next request for this path is not access to the workstation or its
documented `C:\historico` directory. Ask SENEAM/CAPMA for a supported read-only
numeric HTTPS export of the same one-minute schema or its current replacement,
with immutable station/sensor IDs and display mapping.

## Canonical official path: NOAA/AWC

Machine endpoint:

```text
https://aviationweather.gov/api/data/metar?ids=MMMX&format=json&hours=2
```

The production collector follows AWC's documented server-side machine-access
rules and shared 60-second cooldown. It uses a rolling lookback so an
intervening `SPECI`, correction, or out-of-order report is not missed.

AWC is canonical because it provides structured official fields and receipt
metadata. It is not the fastest observed routine-report relay.

A 72-hour sample contained 115 reports:

| AWC receipt minus observation | Routine `METAR` | `SPECI` |
| ----------------------------- | --------------: | ------: |
| Minimum                       |          7m 04s |  1m 03s |
| Median                        |         15m 24s |  1m 09s |
| 90th percentile               |         18m 36s |  2m 04s |
| Maximum                       |         20m 56s |  2m 17s |

Fresh production examples also showed routine observations arriving in a
top-of-hour batch 12-18 minutes after observation. The delay is not capped at
14 minutes.

SENEAM's May 2019 observer manual says routine hourly observation work begins
at minute `:40` and the report must be transmitted by `:56`; the coded time is
the effective time when the final element was evaluated. The observed routine
reports often carry observation times around `:43`-`:50`, appear on CAPMA
before the hour, and reach NOAA/AWC around the top of the next hour. This is
consistent with an observer/report-production step followed by different relay
paths. It establishes an operational start and deadline, not an exact sensor
capture, CAPMA publication, or NOAA receipt second, and it does not identify
which physical sensor the observer selected.

The separate September 2019 SENEAM METAR transmission manual documents a
password-protected browser form on private `10.x`/`192.168.x` intranet
addresses. The observer validates the METAR/SPECI, explicitly transmits it, and
the system stores an AFTN-format temporary copy plus database records. Those
RFC1918 addresses are evidence of a human-in-the-loop internal submission
pipeline, not public APIs or sockets, and this application must not attempt to
connect to them.

Timestamp rules:

- `obsTime` or raw `YYGGggZ` is the actual observation time;
- `reportTime` is often normalized to the report cycle and must not be plotted
  as observation or receipt time;
- AWC `receiptTime` is provider metadata and was observed changing for an
  unchanged raw report;
- application `firstSeenAt` is the immutable earliest evidenced relay sighting;
  and
- `firstAwcSeenAt` separately records when this application first received the
  report from AWC.

METAR temperature is encoded at `1 °C` precision. A JSON number must not be
presented as evidence of a decimal sensor value.

Alternate NOAA relay:

```text
https://tgftp.nws.noaa.gov/data/observations/metar/stations/MMMX.TXT
```

This file carries the same report and omits a reliable type token, so the NOAA
probe records sightings only. It never creates an official row. When AWC later
creates or confirms the canonical row, an earlier NOAA sighting may move
`firstSeenAt` backward without changing the report identity. The paired test
shows NOAA did not beat CAPMA in any decisive comparison so far.

## Strongest unresolved native official path: SENEAM/Vaisala

The 2022 AICM/Toluca procurement proves that the awarded AICM system was
**Vaisala AviMet AWS310-SITE**, supplied by **Orvhemet S.A. de C.V.** under:

```text
procedure: LA-009C00001-E157/2022
internal procedure: 009C00001-008/2022
expediente: 2500815
contract: 2903113
reference: SENEAM-LPI-48/2022-MEX
```

The technical annex requires six AICM sites:

```text
05R/23L: TDZ05R, MID-05R/23L, TDZ23L
05L/23R: TDZ05L, MID-05L/23R, TDZ23R
```

Each station includes wind, temperature/relative humidity, pressure,
precipitation, and a logger. The contract requires temperature resolution of
`0.1 °C`, accuracy of `±0.3 °C` or better, five-second air/dew-point display
updates at Tower and CAPMA, at least one year of central storage, and a web
visualization application.

What is not proven:

- final installation and commissioning;
- signed IAT/PSAT/stability/FSAT and service-acceptance records;
- the exact currently deployed sensor/logger/CDU/display software versions;
- whether NM10 was included;
- whether the legacy CAPMA `05/23` displays are fed by the 2022 system;
- whether PIIMET exposes this data;
- the native logging/averaging cadence;
- a provider-supported external URL, API, WFS, SFTP, CSV, database view, or
  service account; or
- public-use rights.

The uncertainty is material. A January 2024 amendment says equipment had been
delivered since October 19, 2023, but installation, configuration,
calibration, commissioning, training, acceptance tests, and documentation were
suspended through 2024 while civil infrastructure was prepared. The 2025 civil
contract was only 41.8% physically complete at year-end and had an amended
nominal end date of March 18, 2026. No final physical-reception, finiquito,
as-built, AviMet acceptance, or current production declaration was found.

A July 23, 2026 SENEAM Transparency Committee record now proves a material
records-access barrier, but still does not resolve commissioning. In case
`449/26`, folio `340028500143126`, the requester asked for:

- the dates when the automatic meteorological observation systems at TLC and
  AICM entered operation; and
- the acquisition technical annex, if one existed.

Agreement `25/EXT/CT/23/07/2026.03` unanimously classified the requested
information as reserved for five years under article 112, fractions I and XVI,
of the General Transparency Law. SENEAM argued that an operating date could be
used to infer technological age, lifecycle, obsolescence, maintenance,
replacement, degradation, or possible vulnerabilities. This is direct evidence
that the obvious public-records request has already been tried and blocked. It
does **not** prove that either system entered service, reveal an operating date,
establish current production, or identify the contents of the withheld annex.

A page-level OCR pass covered all `1,831` pages in the 27 extraordinary SENEAM
Transparency Committee minutes linked from January 8 through August 6, 2026.
The July 23 case above was the only direct result about TLC/AICM automatic-
observation-system operating dates. A June 25 record mentions an unspecified
AWOS station while reserving an unrelated multi-system office, and July 9 hits
concern AICM radar/ILS dates; neither can be mapped to the `MMMX` temperature
system. No other exact AWOS/AviMet/Vaisala/Orvhemet/PIIMET/project-ID or
commissioning result was found. This is a bounded OCR/search negative, not proof
that no other record exists or that OCR could not miss a degraded line.

Vaisala product documentation makes two supported export families concrete:

- AWS Client can retrieve QML logger daily DAT files, convert them to CSV, run
  scheduled downloads, and configure external reports; and
- NM10, if actually included and version-compatible, is an on-premises
  authenticated HTTPS viewer with history and configured export interfaces.

Do not infer that AICM uses NM10 merely because Orvhemet deployed it in an
unrelated Tamaulipas network. Do not apply current AviMet 10 APIs to equipment
delivered before AviMet 10 launched.

## Likely sensor-to-consumer paths

Confidence labels below are important:

- **verified**: directly observed or supported by owner/contract records;
- **documented legacy**: described by the matching third-party AWOS manual;
- **likely**: consistent with the evidence but not proven for the current
  `MMMX` deployment; and
- **unknown**: requires SENEAM confirmation.

### Official report path

```text
[unknown selected airport sensor / observer input]
                  |
                  v
[SENEAM observer or report-production system]
                  |
                  v
        METAR / SPECI report text
                  |
        +---------+-------------------+
        |                             |
        v                             v
SENEAM/CAPMA AFTN page          international/NOAA relays
        |                             |
        v                    +--------+---------+
Convex CAPMA collector       |                  |
        |                    v                  v
        |              NOAA MMMX.TXT       AWC JSON
        |                    |                  |
        +--------------------+----------+-------+
                                        v
                         one canonical report row
                                        |
                                        v
                   white METAR/SPECI dashboard point
```

The report text and public relay endpoints are verified. The exact physical
probe or combination selected for the report is unknown. CAPMA-first insertion
does not make CAPMA a second thermometer; it is an earlier transport for the
same official report.

### Legacy native-display path

```text
[touchdown-zone weather sensors]              documented legacy
                  |
                  v
[field logger / radio transmission]           documented legacy
                  |
                  v
[Tower/OSIV legacy telemetric-AWOS computer]  documented legacy + GUI match
                  |
        +---------+------------------+
        |                            |
        v                            v
[one-minute local history]    blue TDZ 05/23 display
        unknown today                 |
                                     v
                         CAPMA public JPEG copy
                                     |
                                     v
                         Convex validation + OCR
                                     |
                                     v
                         cyan dashboard timeline
```

The current sensor and logger behind the GUI are unknown. Disime is a credible
legacy AICM integrator candidate: official 2010 records tie it to AICM
meteorological capture/transmission equipment, and older Campbell/Disime cases
describe logger-to-VHF-to-PC architectures. That does not prove the current
MMMX logger is Campbell or that Disime authored the blue GUI.

### Awarded newer AWOS path

```text
[six Vaisala AWS310-SITE field stations]       awarded; install state unknown
                  |
                  v
[logger + VHF radiomodem / processing]         contract topology
                  |
                  v
[central data unit / history]                  contract requirement
                  |
        +---------+-------------+-------------------+
        |                       |                   |
        v                       v                   v
Tower displays           CAPMA displays      web viewer / PIIMET?
                                                unknown mapping
```

This is the most promising path to a native `0.1 °C` official-airport value.
The missing work is institutional and interface-specific, not more hostname or
port guessing.

## What the Mexico dashboard does now

Routes:

```text
/mexico/today
/mexico/day/YYYY-MM-DD
```

The browser subscribes reactively to Convex. It does not directly poll CAPMA,
NOAA, AWC, SMN, or Polymarket.

For the **Temperature and weather timeline**:

- white `METAR / SPECI` points come from `mexicoMetarObservations` at
  `obsTimeUtc`;
- CAPMA AFTN can insert that official point before AWC arrives;
- AWC later enriches the same row with canonical decoded and receipt metadata;
- the cyan `CAPMA live temperature` line is the separate TDZ JPEG/OCR source,
  plotted at embedded screen time;
- the weather-category rail comes from the SMN/CONAGUA municipal forecast;
- rain/storm/cloud bands come from official TAF periods; and
- none of the series is averaged, interpolated, or relabeled as another
  sensor.

Current UI caveat: the official series label still says
`Official MMMX METAR / SPECI · AWC` even when CAPMA delivered the report first.
The stored row retains `firstSource`/relay timing, but the chart does not yet
visually distinguish a CAPMA-first point. The CAPMA-versus-NOAA race summary is
also backend-only and has no dashboard card.

Opening today's page or pressing **Sync now** calls the separate CAPMA TDZ
image refresh entry point. The CAPMA AFTN report collector continues through
the server-side paired cron whether or not a page is open.

The latest-image URL includes the dashboard's `rawHash` as a browser
cache-busting version, not as an immutable archived-object address. Only the
current approved singleton is public. If that version is replaced between the
reactive dashboard query and the browser request, the HTTP lookup serves the
new current singleton and its actual hash remains the response `ETag`; it does
not reject the now-old URL with a replacement-race 404.

## Implemented collector and storage map

| Concern                                                       | Code / table                                            |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| Official METAR/SPECI, NOAA sighting adoption, dashboard query | `convex/mexico.js`                                      |
| CAPMA AFTN fetch/parser                                       | `convex/mexicoCapmaAftn.js`                             |
| Paired CAPMA/NOAA race and summaries                          | `convex/mexicoRelayRace.js`                             |
| CAPMA TDZ queue/storage/gates                                 | `convex/mexicoCapma.js`                                 |
| CAPMA TDZ fetch, validation, OCR, image lifecycle             | `convex/mexicoCapmaNode.js`, `convex/mexicoCapmaOcr.js` |
| CAPMA versus official-temperature trust analysis              | `convex/mexicoCapmaSimilarity.js`                       |
| Schedules                                                     | `convex/crons.js`                                       |
| Tables and indexes                                            | `convex/schema.js`                                      |
| Dashboard                                                     | `app/mexico/day/[date]/page.js`                         |
| Regression tests                                              | `test/mexicoBackend.test.mjs`                           |

Important tables:

| Table                        | Purpose                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| `mexicoMetarObservations`    | Canonical official rows, including CAPMA-first/AWC-enriched reports |
| `mexicoRelaySightings`       | Source-specific CAPMA or NOAA first sightings                       |
| `mexicoRelayRaceAttempts`    | Shared minute success/failure evidence, retained for 14 days        |
| `mexicoCollectorStatus`      | Per-source health, cooldown, and HTTP metadata                      |
| `mexicoCapmaTdzObservations` | Parsed TDZ 05/23 screenshot readings                                |
| `mexicoCapmaLatestImages`    | Only the latest validated JPEG per TDZ, not a raw image archive     |
| `mexicoTafForecasts`         | AWC TAF captures and parsed TX/TN/condition periods                 |
| `mexicoSmnHourlyForecasts`   | Venustiano Carranza municipal hourly context                        |

Replacing a `mexicoCapmaLatestImages` row removes the old blob from public
metadata immediately but schedules its existing reference-checked cleanup
after a 120-second grace. That grace lets an HTTP action which already resolved
the old storage ID finish its separate storage read. The old object is not
discoverable by hash and the public lookup still selects only the current
singleton. Rejected new uploads remain subject to immediate cleanup. If the
scheduler is delayed, an unreferenced old object can remain until that
idempotent cleanup runs; this is transient lifecycle storage, not a raw image
archive, and publication still fails closed whenever approval is absent.

Production schedule relevant to the investigation:

| Job                           | Cadence            | Behavior                                                  |
| ----------------------------- | ------------------ | --------------------------------------------------------- |
| AWC METAR/SPECI               | every minute       | Two-hour lookback, shared 60-second cooldown              |
| Paired CAPMA/NOAA report race | every minute       | NOAA always runs; CAPMA requires its exact gate           |
| CAPMA TDZ images              | every minute       | Queue and worker require image access and retention gates |
| AWC TAF                       | every five minutes | Shared AWC rate discipline                                |
| SMN municipal forecast        | hourly at `:20`    | Documented municipal forecast, not airport observation    |

## Explored path inventory

### Productive or still worth pursuing

| Path explored                          | What was learned                                                                                                                                                       | Revisit when                                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAPMA AFTN history                     | Working, fastest official-report relay observed                                                                                                                        | Keep measuring; watch corrections, outages, and long-term reliability                                                                                    |
| CAPMA TDZ JPEGs                        | Working minute-like whole-degree native display; legacy AWOS GUI identified                                                                                            | SENEAM supplies exact sensor mapping or a supported numeric export                                                                                       |
| Vaisala AviMet AWS310-SITE procurement | Award, six-site design, `0.1 °C`, five-second display, storage, and viewer requirements proved                                                                         | Commissioning/as-built/acceptance records or owner-issued interface arrive                                                                               |
| AWS Client/QML export family           | Product supports DAT retrieval, CSV conversion, scheduled downloads, and reports                                                                                       | SENEAM confirms installed logger/build and offers a read-only copied export                                                                              |
| NM10 family                            | Period-correct on-prem HTTPS/history/export product compatible with AviMet                                                                                             | Bill of materials proves NM10 was included and identifies the installed build                                                                            |
| Current PIIMET                         | Official reports and a 2025 ICAO deck support a later operational PIIMET with an AWOS layer                                                                            | SENEAM supplies the current owner-issued URL, role, API/export, and MMMX mapping                                                                         |
| SENEAM formal data service/PNT         | Exact contract, acceptance, as-built, and sample requests are known; a 2026 request for TLC/AICM operating dates and the acquisition annex was reserved for five years | Seek a narrower public/redacted administrative record or owner-authorized nonpublic setup path; do not repeat the same request as though it were untried |
| SEMAR AION                             | Client bundle exposes exact temperature routes and measurement `40605`/`atmp`                                                                                          | SEMAR supplies `ROLE_MET_USUARIO` service auth and BASANMEX `stationId`                                                                                  |
| BASANMEX native Campbell export        | Rooftop enclosure visibly has Campbell lineage                                                                                                                         | SEMAR offers CampbellCloud, LoggerNet/LNDB, API, SFTP, or provider-generated sample                                                                      |
| AICM SIGA AODB/ESB                     | A real-time airport integration platform exists                                                                                                                        | AICM and SENEAM confirm it actually carries a read-only AWOS weather field                                                                               |

### Exhausted or rejected as a faster MMMX temperature path

| Path explored                                | Result                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CAPMA `metartodos.php` temperature graph     | Generated from routine METAR fields and sometimes omitted newer SPECIs; not raw AWOS                       |
| CAPMA `/banco/ETDS.HTM` takeoff-data page    | Forecaster-issued hourly takeoff forecast (4x daily); a forecast product, not an observation feed          |
| CAPMA `/vigilancia/itinerarios.php`          | Publication schedule for forecast/chart products only; confirms ETDS cadence, lists no observation feed    |
| Other public CAPMA pages/directories/scripts | No numeric AWOS/PIIMET endpoint; current linked native values are JPEGs                                    |
| Historical 2021-2022 PIIMET                  | AWOS layer was static demonstration literals with no polling; not a live source                            |
| Orvhemet public site and archive             | Brochure/contact site; no AICM portal, login, API, case study, or support download                         |
| Orvhemet NM10 screenshots                    | Real but belong to an unrelated 2025 Tamaulipas AWS810 network, not AICM                                   |
| SEMAR AVIMET Android/iOS apps                | Marine/severe-weather alert clients, no station-temperature model                                          |
| AVIMET MQTT persistent-session probe         | Two real alert payloads matched the alert schema and contained no temperature field or Celsius value       |
| AVIMET Firebase/iOS adjacent services        | Notification/device-management leads with no temperature model; not worth pursuing for this goal           |
| BASANMEX public chart                        | Re-fetches the same text file every 10 seconds; it is not 10-second data                                   |
| NOAA HADS/interagency mirror                 | No current BASANMEX/CDMX identifier found                                                                  |
| SMN SIVEA                                    | Nearby TEZONTLE was not reporting; nearest active candidate found was about 17 km away                     |
| CDMX REDMET                                  | Network claims internal minute measurements, but public data found was stale hourly/daily archive material |
| UNAM PEMBU/RUOA                              | Fast hardware claims, but checked public files were stale or 30-minute rows                                |
| WMO WIS2 `mx-smn`                            | No aviation/METAR/MMMX collection; `76680` is Tacubaya about 13.4 km west                                  |
| IEM, OGIMET, MADIS/high-frequency claims     | Archives or relays of the same reports; no distinct minute MMMX sensor feed established                    |
| D-ATIS / LiveATC                             | Report-derived, whole-degree, rights-sensitive audio; no official public machine feed                      |
| atis.guru                                    | Incomplete ACARS relay and several days stale during the check                                             |
| Airframes/AirNav D-ATIS                      | Generic provider possibilities; MMMX coverage and terms not verified; still report-level only              |
| WeatherLink PWS                              | One 60-second nearby transition and one five-minute candidate, but private siting is unverified            |
| Weather Underground PWS                      | One 48-second transition and one five-minute candidate, but private context only                           |
| Ambient, PurpleAir, Netatmo                  | No suitable verified airport station; PurpleAir enclosure temperature is not meteorological truth          |
| GOES/satellite                               | Surface skin/radiance and cloud context, not two-metre airport air temperature                             |
| Aircraft Mode-S                              | Airborne airframe temperature, inconsistent and not a surface thermometer                                  |
| Radar/LIDAR/windshear systems                | Precipitation/wind products, not calibrated air temperature                                                |
| WIFS                                         | Forecast/product exchange, not local native observations                                                   |

Do not repeat broad hostname guessing, port scanning, MQTT wildcard discovery,
CAPTCHA automation, device emulation, VHF interception, or airport/internal-LAN
exploration. The remaining high-value work requires an owner-issued interface
or records.

### Nearby and regional identifiers already checked

| Provider / station              |  Approximate distance from the AWC MMMX reference | Observed result                                                         |
| ------------------------------- | ------------------------------------------------: | ----------------------------------------------------------------------- |
| WeatherLink `PDIVM`             |                                            3.4 km | One exact 60-second transition; unverified private sensor               |
| WeatherLink `AGRÍCOLA ORIENTAL` |                                            3.4 km | Timestamp consistent with a five-minute boundary                        |
| WeatherLink `CUAUTEPEC`         | Nearly collocated with `PDIVM` in public metadata | Differed by 19 °F during the same check; strong siting/identity warning |
| Weather Underground `INEZAH5`   |                                            3.4 km | Nearest candidate but offline/empty                                     |
| Weather Underground `IMEXIC159` |                                            6.6 km | One 48-second transition                                                |
| Weather Underground `IMEXIC225` |                                            8.4 km | One exact five-minute-boundary timestamp                                |
| UNAM CCH Oriente                |                                            5.8 km | Public HTML stale and download rows 30 minutes apart                    |
| SMN SIVEA `TEZONTLE`            |                                            6.4 km | Absent from the current temperature response                            |
| CDMX REDMET `MERCED (MER)`      |                                            5.1 km | Urban station; published path was not a live minute feed                |
| WIS2/OSCAR `76680` Tacubaya     |                                      13.4 km west | Hourly SYNOP context, about ten-minute delivery; not AICM               |

`PDIVM`, `CUAUTEPEC`, and WU `INEZAH5` have almost identical published
coordinates. They may be one cross-uploaded device, several devices on one
property, or privacy-shifted locations. Never count them as independent
corroboration until owner and hardware identity are resolved.

## Location and sensor provenance

| Item                          | Coordinate / elevation            | Correct interpretation                                |
| ----------------------------- | --------------------------------- | ----------------------------------------------------- |
| MMMX AIP airport reference    | about `19.435968, -99.073393`     | Surveyed airport reference, not a thermometer         |
| AWC station metadata          | `19.436, -99.072`, 2,224 m        | Rounded station/airport reference                     |
| CAPMA TDZ header              | `19.436389, -99.071944`, 7,297 ft | Same value on both screens; display/airport reference |
| BASANMEX page                 | Malformed DMS, 2,261 m            | Provider coordinate cannot be parsed literally        |
| BASANMEX digit reconstruction | about `19.426221, -99.076859`     | Plausible inference only, not provider/survey truth   |

No checked source identifies the actual temperature-probe coordinate. Store
coordinate value, precision, provenance, and confidence separately.

## Separate airport-context source: SEMAR BASANMEX

Public station and file:

```text
https://meteorologia.semar.gob.mx/dirmet/estaciones/basanmex.html
https://meteorologia.semar.gob.mx/datos_emas/basanmex.txt
```

BASANMEX is a separate SEMAR rooftop automatic station physically described as
being at Benito Juárez airport. It is not the SENEAM/CAPMA observation system
that issues `MMMX` reports.

The file has `0.1 °C` temperature values on nominal 15-minute timestamps. A
captured 192-row window had 28 missing quarter-hour slots; the newest row was
about 41 minutes old. Later evidence showed four quarter-hour records appearing
together, consistent with hourly publication. The public graph's 10-second
JavaScript refresh only downloads the same file repeatedly.

The server supports `ETag`, `If-Modified-Since`, and `304`. If permission is
granted, a conservative conditional watcher can measure publication timing but
cannot turn the source into minute data. Preserve its source age and label it
`SEMAR BASANMEX rooftop`, never `MMMX official`.

Implementation traps already established:

- the row timestamp is UTC/TUC according to SEMAR's network description;
- the public chart incorrectly places file field `PEst` into its `slp` series;
  parse the header rather than copying that bug;
- values labeled `SLP` were near local station pressure and require SEMAR's
  definition before use;
- the displayed DMS coordinate is invalid because its seconds exceed 60; and
- the station photograph shows a Campbell Scientific enclosure but does not
  prove logger model, cloud enrollment, calibration, or equivalence to the
  SENEAM `MMMX` probe.

AION exposes stronger authenticated route shapes:

```text
GET /aion/api/meteorologia/obtenerMediciones/{stationId}/40605
GET /aion/api/meteorologia/estaciones/{stationId}/mediciones/{YYYY-MM-DD}
GET /aion/api/meteorologia/estaciones/{stationId}/mediciones/{from}/{to}
GET /aion/api/meteorologia/estaciones/{stationId}/mediciones/{from}/{to}/{measurement}
```

The client maps `40605` to ambient temperature and range records to `atmp`, but
unauthenticated requests returned `401`. The UI requires
`ROLE_MET_USUARIO`; public registration gives a different external role and
uses reCAPTCHA. Do not automate it. The missing setup packet is a supported
noninteractive read-only credential, exact BASANMEX `stationId`, time/QC
semantics, limits, and use rights.

## Highest-value next actions

### 1. Obtain commissioning truth

Ask SENEAM for the current production status and signed records for both the
2022 Orvhemet/Vaisala contract and the 2025 civil works:

```text
2022: expediente 2500815
      contract 2903113
      SENEAM-LPI-48/2022-MEX

2025: LO-09-C00-009C00001-N-71-2025
      SENEAM/DRM/MEX/LO/050/2025
      project 2309C000003
```

Request:

- the awarded `Anexo 16` / signed `Anexo 2: Propuesta Técnica` and final BOM;
- installed AviMet, CDU, logger, sensor, display, viewer, and database versions;
- SDD, ICD, data dictionary, station mapping, and as-built diagrams;
- signed FAT/IAT/PSAT/stability/FSAT, delivery, service acceptance, and
  commissioning records;
- 2025 physical-reception, progress, as-built, warranty, finiquito, and later
  amendment records; and
- a current declaration of which components are operational at AICM.

Do not simply refile folio `340028500143126`: SENEAM has already reserved the
TLC/AICM operating dates and acquisition technical annex for five years. Split
the next approach into two narrower tracks:

- request existence-only confirmation and public/redacted versions of the
  contract-administration records above, expressly allowing site, personnel,
  security, configuration, and vulnerability details to be removed; and
- ask the data owner through the formal meteorology/instrumentation route for a
  sanctioned observation-only export and a non-sensitive statement of current
  availability, without requesting control, network, or security details.

A denial or reservation is evidence about disclosure policy, not evidence that
the equipment is active, inactive, accepted, canceled, or unavailable to an
authorized operational user.

Existing PNT folios worth requesting in their already-approved public versions:

```text
330028524001267 -> OIC09/040/066/2022
330028524001268 -> CEDN/GD/1382/2022
```

### 2. Ask for one sanctioned native export

Preferred order:

1. a provider-generated, read-only export from the active AviMet central data
   unit or copied QML/AWS Client logs;
2. the contract-required web viewer through a dedicated observation-only role
   and a documented API/WFS/SFTP export matching the installed version;
3. a supported numeric export of the legacy CAPMA one-minute TDZ history or
   its current replacement; and
4. a read-only current PIIMET MMMX AWOS layer/API.

Require a synchronized 72-hour sample before live access. It should contain all
six site IDs, sensor IDs and coordinates, native timestamps, acquisition and
publication times, sample/average/output intervals, raw precision, rounding,
QC/status flags, missing-value rules, and a data dictionary.

Explicitly exclude equipment control, configuration, administrative accounts,
RDP, direct logger/serial access, VHF interception, airport LAN access, other
airports, and operational ATS use.

### 3. Resolve the lineage map

Ask SENEAM to map:

```text
six AWS310-SITE positions
        <-> legacy CAPMA PISTA 05/23 displays
        <-> observer/METAR selected source
        <-> Tower and CAPMA workstations
        <-> PIIMET / SIGIMET / new weather webpage
        <-> any AICM SIGA weather export
```

The result must say whether paths are independent sensors or duplicate relays.
Use a shared hardware alias only after that is known.

### 4. Continue the relay experiment

Keep CAPMA and NOAA paired at one-minute resolution. Report:

- routine, `SPECI`, and correction outcomes separately;
- decisive wins separately from same-slot and invalid pairs;
- source outages and status coverage;
- median, range, and percentiles only from decisive valid pairs; and
- sample dates and observation duration.

Do not infer sub-minute order from HTTP completion milliseconds when both
sources first contain the report in the same race slot.

### 5. Pursue BASANMEX only as an independent diagnostic

Ask SEMAR first for a native provider-generated sample or sanctioned AION
service account. Determine whether public quarter-hour values are instantaneous
samples, averages, or another aggregation. Keep BASANMEX physically and
semantically separate from SENEAM `MMMX` observations.

### Formal routing contacts

Use current formal routes before contacting a vendor. Directory numbers can
change and should be reverified at filing time.

```text
CAPMA H24: +52 55 5802 8525 / +52 55 5802 8520
SENEAM Meteorología y Telecomunicaciones Aeronáuticas: +52 55 5786 5516
SENEAM Subdirección de Meteorología: +52 55 5786 5517
SENEAM Instrumentación Meteorológica: +52 55 5786 5518
SENEAM transparency: ruth.perez@seneam.gob.mx, ext. 5662

SEMAR meteorology: meteorologia@semar.gob.mx
SEMAR switchboard: +52 55 5624 6500, ext. 7244 / 7245
SEMAR AION/archive routing: archivoceanografico@semar.gob.mx, ext. 8490
```

If SENEAM asks that the awarded integrator participate, Vaisala's Mexico
partner directory listed `omar.ramirez@orvhemet.com.mx` and
`victor.hernandez@orvhemet.com.mx` at the last check. Orvhemet cannot grant
SENEAM data rights independently of the owner.

Concise Spanish native-export request:

```text
Solicitamos autorización expresa para acceso automatizado y de solo lectura a
la temperatura del aire del AWOS de AICM/MMMX mediante una exportación o API
operada por SENEAM o por su proveedor. Favor de confirmar que el sistema está
aceptado y en producción, los identificadores y ubicación de cada sensor, la
cadencia nativa de muestreo/promedio/salida, resolución, banderas de calidad,
marcas de tiempo y latencia, y entregar primero una muestra sincronizada de 72
horas con diccionario de datos.

Favor de definir límites de consulta, autenticación de solo lectura, retención
permitida en Convex, uso derivado, exhibición pública/comercial,
redistribución, atribución y vigencia. Se excluyen control, configuración,
acceso a equipos o red operacional, otros aeropuertos y uso ATS.
```

## Approval and safety boundaries

Only the exact Convex string `true` enables a gated integration. Access,
retention, and public display are separate capabilities when the data owner
requires them. A reachable public URL, key, account, or broad verbal approval
does not replace exact owner-approved scope.

Current relevant gates:

| Capability                       | Canonical Convex variable                    | Scope owner                                  |
| -------------------------------- | -------------------------------------------- | -------------------------------------------- |
| CAPMA AFTN report page           | `SENEAM_MMMX_AFTN_ACCESS_APPROVED`           | SENEAM/CAPMA                                 |
| CAPMA TDZ JPEG access            | `SENEAM_MMMX_TDZ_ACCESS_APPROVED`            | SENEAM/CAPMA                                 |
| CAPMA TDZ retention              | `SENEAM_MMMX_TDZ_RETENTION_APPROVED`         | SENEAM/CAPMA                                 |
| CAPMA TDZ public/derived display | `SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED`     | SENEAM and any required AICM authority       |
| Direct SENEAM AWOS access        | `SENEAM_MMMX_AWOS_ACCESS_APPROVED`           | SENEAM/CAPMA for an exact supplied interface |
| Direct AWOS retention            | `SENEAM_MMMX_AWOS_RETENTION_APPROVED`        | SENEAM                                       |
| Direct AWOS republication        | `SENEAM_MMMX_AWOS_REPUBLICATION_APPROVED`    | SENEAM and any required AICM authority       |
| PIIMET MMMX layer                | `SENEAM_PIIMET_MMMX_ACCESS_APPROVED`         | SENEAM/PIIMET administrator                  |
| BASANMEX public file             | `SEMAR_BASANMEX_PUBLIC_FILE_ACCESS_APPROVED` | SEMAR                                        |
| AION BASANMEX temperature        | `SEMAR_AION_BASANMEX_ATMP_ACCESS_APPROVED`   | SEMAR/AION administrator                     |

All four canonical CAPMA names fit Convex's 40-character environment-name
limit. `convex/mexicoCapmaApprovals.js` centralizes their exact-`true` checks.
For a non-breaking deployment migration, it also accepts these already
deployed long names as exact-`true` aliases:

| Canonical name                           | Temporary legacy alias                              |
| ---------------------------------------- | --------------------------------------------------- |
| `SENEAM_MMMX_AFTN_ACCESS_APPROVED`       | `SENEAM_CAPMA_MMMX_AFTN_REPORTS_ACCESS_APPROVED`    |
| `SENEAM_MMMX_TDZ_ACCESS_APPROVED`        | `SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED`      |
| `SENEAM_MMMX_TDZ_RETENTION_APPROVED`     | `SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED`   |
| `SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED` | `SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED` |

The aliases exist only so a deployment that already contains the oversized
names does not turn off during code rollout. Do not create or recreate a
legacy name. Deploy the alias-aware code, set each required canonical value,
verify the protected collector/query state, and then remove the corresponding
legacy value through the deployment environment controls. A canonical `false`
or any other non-`true` canonical value takes precedence and fails closed. The
legacy alias is consulted only when the canonical key is absent. Revocation
must still remove both names: removing the canonical key first would expose a
still-`true` legacy fallback. During an emergency migration-state revocation,
set the canonical value to `false`, remove the legacy alias, and then remove
the canonical value. Any malformed value remains false.

Canonical activation after the documented authority grants each scope:

```text
npx convex env set SENEAM_MMMX_AFTN_ACCESS_APPROVED true --prod
npx convex env set SENEAM_MMMX_TDZ_ACCESS_APPROVED true --prod
npx convex env set SENEAM_MMMX_TDZ_RETENTION_APPROVED true --prod
npx convex env set SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED true --prod
```

Canonical removal after the corresponding legacy aliases are absent:

```text
npx convex env remove SENEAM_MMMX_AFTN_ACCESS_APPROVED --prod
npx convex env remove SENEAM_MMMX_TDZ_ACCESS_APPROVED --prod
npx convex env remove SENEAM_MMMX_TDZ_RETENTION_APPROVED --prod
npx convex env remove SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED --prod
```

Earlier production checks recorded the legacy CAPMA AFTN gate and all three
legacy TDZ gates as exact `true`; CAPMA and NOAA collectors then returned HTTP
`200`. That historical check is migration context, not proof of the current
canonical environment state or current approval scope.

The older broad direct-AWOS and PIIMET flags also currently read `true`, but
they are not a usable integration: no owner-supplied endpoint, station/field
allowlist, credential, or code consumes them. Treat those paths as
`setup_required` and obtain interface-bound authority before adding a worker.
Do not mistake an environment value for commissioning evidence or a setup
packet.

Every cron, manual action, queue producer, worker, retry, store, protected
query, proxy, and export must enforce the relevant flag. Recheck after an HTTP
response and immediately before storage so revocation during an in-flight
request still fails closed.

## Facts that must not be collapsed

- `MMMX` is AICM; `MMCS` is Ciudad Juárez.
- CAPMA AFTN is an early relay of the same official report, not a new sensor.
- CAPMA TDZ images are native-looking local telemetry, not METAR screenshots.
- CAPMA TDZ `05` and `23` do not prove left/right runway station identities.
- The coordinate printed on both CAPMA screens is an airport/display reference,
  not two verified thermometer coordinates.
- The legacy GUI match does not prove it is the 2022 Vaisala system.
- The 2022 award proves equipment selection, not final commissioning.
- SENEAM's five-year reservation of the requested TLC/AICM operating dates and
  acquisition annex proves a disclosure barrier, not that the systems entered
  service or are currently operational.
- A five-second display requirement does not prove five-second logging or a
  public five-second endpoint.
- BASANMEX is at the airport but is a separate SEMAR rooftop station.
- A frontend refresh interval is not an observation cadence.
- A TDZ display tick into a new whole degree does not imply the METAR will
  print that degree: on 2026-08-20 through 2026-08-22 the TDZ displays
  exceeded the official daily maximum by 1–2 °C at the afternoon peak.
- A future sub-degree TDZ estimate is a derived quantity with uncertainty,
  never a sensor reading, and the display's rounding rule is still
  **undetermined**: an initial 2026-08-23 claim of round-to-nearest was
  retracted after review showed the discriminator could not separate
  nearest from floor (see the
  [2026-08-23 investigation](./mexico-edge-investigation-2026-08-23.md)).
  A temperature tick pins the unrounded value to an exact but unidentified
  boundary (x.5 or x.0) until a proper identification exists. The corrected
  v2.1 tool carries all eight T/Td/RH rule combinations and additive Td bias
  through ±0.5 °C; neither the absolute T rule nor shared-versus-mixed T/Td
  behavior is independently established. Its output is a retrospective robust
  envelope of conditional bands, not a calibrated interval or accuracy.
- The TDZ JPEGs are screen captures of the AWOS GUI (cursor artifact,
  `Thumbs.db`, no sibling data file, static `<img>` wrapper); there is no
  public numeric endpoint behind them — do not re-probe the public host for
  one.
- METAR `23/07` means temperature `23 °C`, dew point `7 °C`; it is not
  `23.07 °C`.
- AWC `reportTime` is not the observation time.
- A provider receipt timestamp is not immutable application first-seen time.
- Nearby PWS agreement is context, not calibration or independent airport
  corroboration unless hardware identities are known.

## Reproducible operational checks

Relay summary:

```text
npx convex run mexicoRelayRace:getCapmaNoaaRelayRace \
  '{"stationIcao":"MMMX","date":"YYYY-MM-DD"}' \
  --prod --codegen disable --typecheck disable
```

Collector health:

```text
npx convex run mexico:getCollectorStatus \
  '{"stationIcao":"MMMX","source":"capma_aftn_metar"}' \
  --prod --codegen disable --typecheck disable

npx convex run mexico:getCollectorStatus \
  '{"stationIcao":"MMMX","source":"noaa_text_metar"}' \
  --prod --codegen disable --typecheck disable
```

CAPMA AFTN revocation after legacy cleanup:

```text
npx convex env remove \
  SENEAM_MMMX_AFTN_ACCESS_APPROVED --prod
```

If the legacy alias is still present, first set the canonical value to `false`,
then remove the legacy alias through the deployment environment controls, and
finally remove the canonical value. An explicit canonical non-`true` value
takes precedence and fails closed, while removing the canonical key too early
would restore legacy fallback. Once access is false, new CAPMA requests and
storage stop, CAPMA race data and CAPMA-only official rows are hidden, and an
AWC-confirmed row is sanitized back to its AWC timing view. NOAA and AWC remain
available.

## Curated primary references

### Live products

- AWC METAR API:
  <https://aviationweather.gov/api/data/metar?ids=MMMX&format=json>
- AWC API rules/documentation:
  <https://aviationweather.gov/data/api/>
- NOAA station file:
  <https://tgftp.nws.noaa.gov/data/observations/metar/stations/MMMX.TXT>
- CAPMA AFTN MMMX history:
  <http://capma.mx/reportemetar/buscar_samx.php?id=MMMX>
- CAPMA portal and TDZ displays:
  <http://capma.mx/capma/capma.html>,
  <http://capma.mx/banco/pista05.jpg>,
  <http://capma.mx/banco/pista23.JPG>
- SENEAM site-use conditions:
  <https://www.gob.mx/seneam/acciones-y-programas/condiciones-de-uso-53048>
- BASANMEX station and data:
  <https://meteorologia.semar.gob.mx/dirmet/estaciones/basanmex.html>,
  <https://meteorologia.semar.gob.mx/datos_emas/basanmex.txt>

### SENEAM/AWOS evidence

- SENEAM aviation meteorology:
  <https://www.gob.mx/seneam/acciones-y-programas/meteorologia-aeronautica>
- May 2019 SENEAM observer manual, including the `:40–:56` routine procedure
  and historical temperature-special criterion:
  <http://capma.mx/manuales/Manual_Met_Obs/2019METOBS.pdf>
- September 2019 SENEAM METAR transmission manual, documenting the internal
  authenticated form, validation, explicit transmission and AFTN/database
  handoff:
  <http://capma.mx/manuales/Manual_Reporte_Metar.pdf>
- Binding CO AV-20.3/07 R4, including the current separation between local
  special-report and SPECI criteria:
  <https://www.dof.gob.mx/2022/SICT/co-av-20-3-07-r4.pdf>
- Current MMMX AIP entry:
  <https://aipmexico.seneam.gob.mx/AIP/doc/AD/AD_2/38_MMMX/AD_2-MMMX-2.pdf>
- 2022 AWOS procurement materials:
  <https://www.seneam.gob.mx/gobmx/convocatorias-adquisiciones/saoma>
- Historical CompraNet expediente `2500815`:
  <https://historico-compranet.buengobierno.gob.mx/#/detalle/2500815>
- Signed base contract and January 2024 amendment:
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/LICITACION-INVATRES/LPI%2048/7.SENEAM-LPI-48-2022-MEX.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIIIA/2022/SENEAM-LPI-48-2022-MEX-01.pdf>
- 2025 civil-work contract, amendment, and procurement package:
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/SENEAM-DRM-MEX-LO-050-2025.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/C.M.-SENEAM-DRM-MEX-LO-050-2025-01.pdf>,
  <https://www.seneam.gob.mx/SIPOT/LGTA70FXXVIII/CONV.-LO-050-2025.docx>
- July 23, 2026 SENEAM Transparency Committee agreement reserving the requested
  TLC/AICM automatic-observation-system operating dates and acquisition annex
  for five years, case `449/26`, folio `340028500143126`, agreement
  `25/EXT/CT/23/07/2026.03`, printed pages 12-19:
  <https://seneam.gob.mx/gobmx/transparencia/actas/2026.html>,
  <https://seneam.gob.mx/gobmx/transparencia/actas/archivos/ACT_25-26_EXT_23_07_2026_.pdf>.
  The downloaded 79,025,186-byte file hashes to
  `362A9FF0109292C0E066228A00249D3FF916B4A15A230CB9689E9843C1FD8BD5`.
- SENEAM consolidated report documenting PIIMET:
  <https://www.seneam.gob.mx/gobmx/archivos/Informe_Consolidado%20SENEAM_26082024.pdf>
- 2025 ICAO PIIMET/AWOS presentation:
  <https://www.icao.int/sites/default/files/NACC/MeetingDocs/2025/NACCWG10/Espa%C3%B1ol/04-Presentaciones/NACCWG10-P16.pdf>
- Historical PIIMET demonstrator AWOS literals:
  <https://web.archive.org/web/20220623103426id_/http://capma.seneam.gob.mx/alejandra/js/markers.js>
- Vaisala AviMet/AWS310 information:
  <https://www.vaisala.com/en/products/systems/avimet-awos>
- Period-correct NM10 datasheet:
  <https://www.vaisala.com/sites/default/files/documents/NM10-Datasheet-B211408EN.pdf>
- SENEAM formal meteorological-data service:
  <https://www.gob.mx/tramites/ficha/estadisticas-de-informacion-meteorologica/SENEAM5293>

### Lineage and alternate-path evidence

- Matching third-party legacy AWOS manual:
  <https://es.scribd.com/document/270917790/Manual-Op-Stn-Met-AWOS>
- Campbell/Disime SENEAM architecture case:
  <https://www.campbellsci.com/resources/case-studies/mexico-airports-aws>
- SEMAR AION entry:
  <https://aion.semar.gob.mx/pub/>
- SEMAR public-services manual:
  <https://semar.gob.mx/Difusion/ManualDeServiciosAlPublico.pdf>
- High-frequency airport research method:
  [high-frequency-airport-weather-research.md](./high-frequency-airport-weather-research.md)

## Definition of success for the next investigation phase

The next phase is successful when at least one of these is achieved:

1. SENEAM supplies a supported, read-only native `MMMX` temperature export
   with sensor IDs, timestamps, QC, cadence, precision, and use rights;
2. the legacy CAPMA displays are mapped to current physical sensors and their
   one-minute numeric history is made available through a supported interface;
3. the 2022/2025 commissioning trail conclusively establishes what is active
   and how it reaches CAPMA/Tower/PIIMET; or
4. a substantially longer valid paired sample characterizes CAPMA AFTN versus
   NOAA across routine reports, SPECIs, corrections, and outages.

Until then, the correct operational design is the one already implemented:
CAPMA provides the earliest observed official report when approved, AWC later
confirms and enriches it, and every native/display/context series remains
visibly separate.

## Mexico Airport Edge implementation

Added on **2026-08-20** as a separate `/mexico/edge` product. Its durable
requirements and truth-label contract live in
[mexico-edge.md](./mexico-edge.md). `/mexico/today` and
`/mexico/day/[date]` keep their prior behavior and their existing minute Gamma
history.

### Weather composition and timing

`convex/mexicoEdge.js` exposes the bounded composite edge query. It reads the
existing official METAR/SPECI, relay sightings/race attempts, TAF, SMN and
CAPMA image/OCR tables. It repeats the existing fail-closed CAPMA public-read
rules: CAPMA-only METAR rows and timing disappear if AFTN access approval is
removed, and TDZ history/latest-image metadata require access, retention and
republication approval together.

The primary operational clock now uses the observer manual's documented
minute-of-hour process: observation begins at `:40` and transmission is due by
`:56`. This is not an exact sensor capture or publication second. Separately,
`convex/mexicoEdgeTiming.js` derives a robust CAPMA first-sighting estimate only
when enough recent non-correction routine reports exist and returns sample
count, spread and confidence metadata. The learned center is secondary context
and never replaces the documented start/deadline.

SPECI remains event-triggered and has no due clock. The UI compares each new
TDZ05 value with the latest official report, including an intervening SPECI. A
rise of at least `2 °C` is highlighted as a temperature special criterion. The
2019 observer manual places it in its special-report/SPECI workflow, while the
binding 2022 circular lists it as a local special-report criterion separately
from the public SPECI list; the UI therefore never promises that a public SPECI
will follow.

The first operational panel on `/mexico/edge` is now a six-hour report-cycle
chart implemented by `app/mexico/edge/report-cycle.mjs`. It groups CAPMA AFTN
and NOAA sightings of the same routine METAR rather than treating NOAA's later
receipt as another observation. The primary chart plots TDZ 05 values at
application first-seen time and intentionally hides TDZ 23; both TDZ displays
remain available in the image deck. TDZ 05 is an operator-selected tactical
display, not the official report. CAPMA METAR temperature points are plotted
when the official text was first seen and retain the separate coded observation
time.

The chart keeps six hours of history in a horizontally scrollable timeline.
The `1x`, `2x`, and `4x` controls expand the SVG timeline while retaining the
same data, and `Latest` scrolls to the newest edge. Zoom changes also return to
the latest edge; users can then scroll or swipe backward to inspect a narrower
time range.

The chart shades each documented `:40–:56` routine window and keeps the final
tactical TDZ05 lead before CAPMA bright. TDZ points after CAPMA cannot alter the
already locked report, but remain active in orange for the next report and the
special-condition watch. A point at least `2 °C` above the latest METAR/SPECI
is rose-highlighted. CAPMA-to-NOAA shading and the live NOAA countdown use the
median from valid paired routine-report races, with sample size and 60-second
resolution shown. NOAA is a downstream relay of the already official report;
no fixed eight-minute relay delay or exact CAPMA due second is claimed.

Forecast maxima are immutable, source-separated revisions in
`mexicoEdgeForecastHighSnapshots`:

- `taf_tx` is official airport TAF TX guidance;
- `smn_municipal_hourly` is nearby Venustiano Carranza municipal guidance.

Each row keeps its source input identity, issue/capture time, maximum and peak
time. The page shows current, previous, delta and changed-at without collapsing
the two forecast roles. The idempotent
`mexico_edge_forecast_high_snapshots_every_5_minutes` job derives revisions at
minutes `2,7,...,57` without making another external request. The dashboard
also merges a just-retained TAF or SMN input with persisted revisions, so a
new maximum does not wait for the next snapshot cron to appear.

### Exact Polymarket market data

`convex/mexicoPolymarketLive.js` is additive to the old Gamma snapshot
collector. It dynamically discovers the recurring series `11428` event and
does not assume eleven or contiguous buckets. It retains event description,
resolution source, end time, neg-risk state, condition/token IDs and per-market
metadata.

For every YES token it obtains public CLOB `/books` and
`/last-trades-prices`, preserves provider prices as normalized decimal strings,
and separately stores bid, ask, midpoint, spread, last trade and tick size. The
display price uses Polymarket's documented rule: midpoint for spreads at or
below `0.10`, otherwise last trade. A missing two-sided book is an explicit
fallback, never fabricated liquidity.

Current state and change-only history use:

- `mexicoEdgeMarketEvents`;
- `mexicoEdgeMarketQuotes`;
- `mexicoEdgeMarketQuoteEvents`; and
- `mexicoEdgeMarketStreamStatus`.

Approved no-change evidence additionally uses
`mexicoEdgeMarketQuoteHeartbeats`. It stores one compact immutable row for each
accepted market/token in every successful poll, including unchanged polls. A
row retains the event/token identity, poll generation, exact reaction values
and fingerprint plus separate Gamma, book and last-trade endpoint clocks. It
does not duplicate depth sizes, book hashes or market text. Missing expected
book/trade tokens invalidate the poll; only `0.5` with an empty side is accepted
as the documented no-trades sentinel, and a later no-trades response after a
reported price is rejected as a provider regression.

Detailed changes are retained for 14 days. Phase one durable transport is an
exact CLOB REST snapshot once per minute. The server reports WebSocket
`unavailable` instead of implying a live connection. If the page uses the
public market-channel WebSocket while open, those lower-latency updates are
labeled `browser live · session-only`; they do not become durable history or
evidence of a server stream. Session ticks are excluded from cross-source
delay calculations because the browser and Convex server clocks are not an
authoritative shared clock. Durable REST writes are generation/lease checked,
and selected-bucket history uses its market/date index so other buckets cannot
truncate the reaction timeline.

The edge reaction explorer defaults to REST-detected last-trade-price state,
not the platform display value. Executable bid/ask, midpoint and platform
display remain separate selectable series, with display-source switches marked
explicitly. REST supplies no trade execution timestamp, size or count, and a
same-price trade is invisible, so the UI says `first detected last-trade price
update` rather than `actual trade`.

For consecutive successful last-trade samples the detection evidence is the
open/closed interval `(L,U]`, using the prior successful last-trade endpoint
receipt and the first changed receipt. Relative to a weather first-seen event
`E`, `E <= L` is compatible-after, `L < E <= U` is ordering-indeterminate, and
`E > U` means the market change was detected before that source. No predecessor
is left-censored. Changed-only legacy rows are never treated as same-value poll
confirmations. Selected-market history is indexed, capped at 2,000 rows, and
returns one predecessor plus explicit truncation/coverage metadata. Failed
attempts are not successful observations and are currently reported as absent
from the heartbeat history rather than invented as interval bounds.

TDZ reaction events do not come from the 900-row temperature timeline. That
timeline preserves all bounded official rows and trims only dense TDZ chart
points. The backend
inspects a separately bounded 6,000-row selected-day page and certifies TDZ 05
and TDZ 23 independently. A series must be untruncated and have no start, end
or internal coverage gap above five minutes. The live page rechecks latest-row
age against its own one-second clock, so a previously complete series becomes
chart-only if source writes stop. Partial, stale, truncated or unapproved TDZ
history cannot produce a `daily maximum` reaction row.

Official reaction rows likewise have explicit suffix detection. Selected-day
METAR/SPECI and relay queries request one row beyond their 160- and 300-row
limits. If either is truncated, `officialDailyMaximumEvidence` is `partial`
and official derived maxima remain chart-only instead of treating the retained
suffix as a complete day.

Collection is separately reversible and performs no Gamma/CLOB request unless
this Convex value is the exact string `true`:

```text
POLYMARKET_MMMX_LIVE_COLLECTION_ENABLED
```

Activation and removal:

```text
npx convex env set POLYMARKET_MMMX_LIVE_COLLECTION_ENABLED true --prod
npx convex env remove POLYMARKET_MMMX_LIVE_COLLECTION_ENABLED --prod
```

The live-collection value is an operational switch, not provider approval.
The new unchanged-poll retention and public detection history are separately
fail-closed behind these exact-`true` Convex values:

```text
POLYMARKET_MMMX_DATA_ACCESS_APPROVED
POLYMARKET_MMMX_DATA_RETENTION_APPROVED
POLYMARKET_MMMX_DATA_PUBLIC_APPROVED
```

The appropriate approving authority is Polymarket/ICE for the project's exact
entity classification and scope covering consumption, derived reaction
analysis, 14-day Convex retention and public display. The contact recorded by
the dated investigation is `data-licensing@polymarket.com`. Until that written
scope exists, all three values remain absent.

Access plus retention are required for heartbeat and new interval-metadata
writes. Access, retention and public approval are all required for a query to
return heartbeat rows, predecessor evidence or interval metadata. If any gate
is closed, the current quote and legacy changed-event collector continues, but
the protected query fields are empty/sanitized and its status says which
approval is required. The retention action stays available to erase already
stored expired evidence after revocation.

Activation only after written scope is confirmed:

```text
npx convex env set POLYMARKET_MMMX_DATA_ACCESS_APPROVED true --prod
npx convex env set POLYMARKET_MMMX_DATA_RETENTION_APPROVED true --prod
npx convex env set POLYMARKET_MMMX_DATA_PUBLIC_APPROVED true --prod
```

Removal of any applicable capability fails that path closed:

```text
npx convex env remove POLYMARKET_MMMX_DATA_PUBLIC_APPROVED --prod
npx convex env remove POLYMARKET_MMMX_DATA_RETENTION_APPROVED --prod
npx convex env remove POLYMARKET_MMMX_DATA_ACCESS_APPROVED --prod
```

The new minute collector is
`mexico_edge_polymarket_clob_every_minute`; detailed-event retention runs at
`08:17Z` daily. The old
`mexico_polymarket_daily_high_every_minute` job remains untouched.

### Bounded sub-minute CAPMA routine watcher

`convex/mexicoEdgeWatch.js` implements five-second target receive detection for the
CAPMA AFTN relay only during the broad `:40` through `:57.999Z` routine window.
Two non-overlapping internal-action sessions begin at `:40` and `:49`. Their
absolute deadlines are `:49:00Z` and `:58:00Z`, respectively, so a delayed
first cron start cannot spill into the second session. Each also remains capped
below nine minutes and stops when it sees the current cycle's routine report.
Request timeouts and retry waits are clipped to the session deadline. A healthy
session retains the five-second target, but each request is capped at five
seconds and the first failed request now opens a 15-second quiet window;
subsequent failures back off to the 30-second cap. A successful fetch resets
the backoff. Before each AFTN request the watcher also reads the TDZ05/TDZ23
collector states and defers for one target interval while either image worker
holds its 75-second in-flight lease. The short AFTN page therefore yields to a
slow image transfer instead of competing for the same legacy host; the result
reports the number of image-priority deferrals. The five-second cadence
replaced the initial
one-second cadence after the production host intermittently dropped AFTN and
TDZ connections following the bounded burst. This reduces protected requests
by 80% while preserving bounded second-level detection. CAPMA throttling is a
plausible explanation, not a documented provider limit. This improves application first-seen resolution; it
does not create an official publication timestamp or prove originating order.
NOAA and AWC retain their documented one-minute request discipline.

The regular AFTN collector and bounded watcher use Convex's Node action runtime.
The bounded watcher uses the five-second per-call limit above. The one-minute
AFTN collector shares the relay/direct 55-second cycle budget described below.
This runtime was adopted after production isolate egress returned gateway
TCP-connect timeouts for the plain-HTTP AFTN host on 2026-08-23 while the
existing Node TDZ collector continued to reach the same owner host. The runtime
change does not alter the exact approved URL, cadence, redirect policy, gates
or retention boundary. Collector-health error age is the latest failed status
update; the UI separately labels the age of the last good sample.

Later on 2026-08-23, the warm Node workers themselves began timing out
intermittently against the same host while a fresh single-connection fetch
from another network completed in about half a second. All CAPMA requests now
go through `server/mexicoCapmaTransport.js`, which opens one non-pooled
`node:http` connection per request (`Connection: close`), never reuses a
socket, and never follows a redirect; callers still refuse 3xx statuses
explicitly. Fresh connections alone did not clear the TDZ failures, and
retained successful-fetch durations explained why: the JPEG transfers are
bimodal — median 0.27 s at roughly 600 KB/s, but with a slow mode down to a
few KB/s in which p95 was 9.5 s, p99 was 27.5 s, and completed transfers up
to 84 s existed before any application timeout. The flat 8-second timeout
adopted earlier on 2026-08-23 was therefore converting the origin's slow
mode into hard failures. The one-minute TDZ and AFTN collectors now use one
**55-second wall-clock budget** across both network paths (HTTP error statuses
are never retried). When the approved relay is configured they try Vercel
egress first, capped at 43 seconds end to end; the relay itself uses the same
fresh `node:http` transport and a 40-second owner-host cap. A failed relay
leaves the remaining cycle budget for one patient direct connection, whose
standalone plan is capped at 50 seconds. Without relay configuration the same
direct plan remains available. The high-frequency watcher keeps one short
direct attempt per loop because its session loop already retries with the
failure backoff above. TDZ 05 remains first in the scheduler stagger as the
tactical priority. The slow-mode cause — provider throttling, path congestion,
or middlebox behavior toward an egress — remains undetermined.

A six-hour post-fix sample on 2026-08-23 then exposed a separate,
long-standing scheduler defect: the claim cooldown equal to the one-minute
cron spacing (60 s versus 60 s) raced scheduling jitter, so whenever a
cycle's claim landed a few hundred milliseconds earlier than the previous
one, the whole cycle was skipped as `cooldown`. This silently halved the
stored TDZ cadence to roughly one frame every two minutes — matching months
of retained history (~530 rows per TDZ per day) that had been attributed to
origin or egress problems — and skipped many CAPMA AFTN and NOAA race
slots, consistent with the paired race's high invalid-pair counts.
Screen-time forensics across the gaps showed the origin kept producing its
documented ~60/62-second file steps throughout. Scheduled claim cooldowns
for TDZ 05/23, CAPMA AFTN, and NOAA text are now 45 seconds (manual TDZ
refreshes keep 60 s); the actual request rate is still one cycle per minute
from the cron, and AWC keeps its documented shared 60-second discipline.
`mexicoCollectorStatus` also now retains a capped `recentErrors` ring
buffer (newest last, 20 entries) so multi-minute outages can be diagnosed
after the fact instead of only the latest error message surviving.

A later live sample exposed a second scheduling race. The former retry plus
relay chain could remain in `fetching` for up to 83.5 seconds, longer than both
the 45-second cooldown and the one-minute launch spacing. The next cron could
therefore claim the same TDZ while its prior worker was still running, and the
older worker could then overwrite the newer health row with a late `error` or
`ok`. CAPMA TDZ and one-minute AFTN claims now hold a 75-second lease only while
their row is `fetching`; a normal completion releases it immediately. Every
finish carries its claim timestamp, and a finish from an expired claim is
ignored if a newer attempt owns the row. Thus `fetching` describes the active
attempt and a late failure cannot make a newer cycle look failed. If a worker
really exceeds its lease, monotonic latest-image selection still prevents an
older embedded frame from replacing a newer one.

The ring buffer immediately explained the residual multi-minute outages:
windows in which every direct attempt fails with `connect ETIMEDOUT` against
the owner host while, in the same minute, Vercel-egress and residential
fetches of the same URL connect in under a second (verified live during the
12:13Z–12:2xZ window on 2026-08-23). Whether the drops are owner-side
filtering of that egress or a network-path fault is undetermined. For these
windows the collectors have an **alternate-egress relay path**:
`app/api/capma-relay/route.js` on the Vercel deployment fetches the same
approved URL with an exact three-URL allowlist (never an open proxy), a
required `x-capma-relay-token` shared secret on top of Vercel deployment
protection, conditional-header pass-through, and no retention or content
logging. Production sampling then showed relay-served frames succeeding while
Convex direct connects were failing in the same window, so the configured
relay is now the first path for the one-minute TDZ and AFTN collectors; a fresh
direct connection receives the unused portion of the same 55-second budget if
the relay fails. Frames served through the relay are marked with
`fetchTransport: "vercel_relay"` on `mexicoCapmaTdzObservations`. The relay
path is dormant unless the Convex deployment sets `CAPMA_RELAY_URL` and
`CAPMA_RELAY_TOKEN` (`CAPMA_RELAY_BYPASS` additionally carries a Vercel
protection-bypass secret only if the relay is ever served from a protected
URL); these are operational transport settings for our own infrastructure,
not data-owner approval gates — every CAPMA approval gate is still enforced
in Convex around the whole request, and the relay changes neither the
approved URLs nor the cadence. Configured live on 2026-08-23 against
`https://polypro-alpha.vercel.app/api/capma-relay`: the production alias is
public (Vercel protection covers only deployment/preview URLs here), so the
shared token plus the exact allowlist are the relay's access control, and
unauthenticated requests receive 401. The diagnostic
`app/api/capma-probe/route.js` endpoint is locked by the same token.

A production conditional request on 2026-08-23 exposed one relay-envelope
edge case: the owner returned `304 Not Modified`, but the wire-level relay
response reached Convex without `x-capma-relay-upstream`, so the transport
treated a valid unchanged image as relay failure and fell through to a direct
connection that timed out. The relay no longer emits owner `304` as its outer
HTTP status. It returns an ordinary HTTP `200` envelope with the authenticated
marker and `x-capma-relay-upstream-status: 304`; Convex validates the marker
first and only then reconstructs status `304` for the existing collector
`not_modified` branch. This carries no image body, creates no retained row,
does not count as a new frame, and does not trigger direct fallback. For a
rolling update, deploy the decoder-capable Convex transport before the Vercel
envelope change; the decoder remains compatible with older marked relay
responses that omit the new status header.

The scheduled TDZ collector queues TDZ 05 immediately and TDZ 23 thirty
seconds later. This lowers ordinary same-host concurrency but cannot guarantee
that the two paths never overlap when an owner-host transfer is slow. TDZ 05 is
prioritized because it is the tactical rail shown on the primary chart; TDZ 23
remains collected and independently labeled elsewhere. Each source is still
launched at most once per minute, just below CAPMA's observed ~60/62-second
embedded-image steps. A healthy path should therefore accept nearly every new
frame, but the source's production cadence is not proof of successful
transport: a timed-out transfer, a lease-protected skipped launch, or a JPEG
rejected by validation/OCR creates an honest gap. The 55-second transport
budget plus 75-second in-flight lease prevents those failures from cascading
into overlapping minute workers. A rejected frame leaves the last accepted
image intact and never invents a temperature.

Timestamp OCR uses all ten template scores for each detected clock/date glyph
and selects the highest-scoring complete timestamp only from the existing
24-hour-past/15-minute-future plausibility window around fetch time. This
replaced a single-glyph winner rule after a live `02:25:43Z` TDZ05 frame ranked
its leading `0` only `0.006` below `9`, yielding the impossible hour `92` and
leaving the dashboard on an older valid frame. Temperature, TDZ identity,
dimensions, OCR confidence and time plausibility checks remain fail closed.
The CAPMA application can also switch its value boxes between black text on a
light background and yellow text on a dark background. Both palettes are now
decoded independently with the same geometry, range and confidence rules; if
both validate, only the higher-confidence result is accepted. The yellow/dark
palette permits a `0.60` template score only with at least a `0.08` lead over
the next digit candidate; the collector's overall `0.60` storage threshold
still applies.

The worker performs no protected request unless the base AFTN access capability
and both edge-specific controls are approved. The canonical values are:

```text
SENEAM_MMMX_AFTN_ACCESS_APPROVED
SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED
MEXICO_EDGE_ROUTINE_WATCH_ENABLED
```

The first value is the canonical SENEAM/CAPMA AFTN access approval. During the
migration only, the existing long AFTN name remains an exact-`true` fallback
when the canonical key is absent, as documented in the approval section; new
environments must use the canonical name. The second must specifically
authorize bounded sub-minute automation of the owner page. The third is an
independent operational kill switch. The internal cron action rechecks all
three capabilities before every request,
after every response and immediately before storage. Missing approval returns
`approval_required`; a missing kill switch returns `disabled`; calls outside
the server-side time window return `outside_window` without a request. All
canonical and edge-specific names fit Convex's 40-character limit.

After SENEAM/CAPMA confirms the extra request scope:

```text
npx convex env set SENEAM_MMMX_AFTN_ACCESS_APPROVED true --prod
npx convex env set SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED true --prod
npx convex env set MEXICO_EDGE_ROUTINE_WATCH_ENABLED true --prod
```

Removing either value stops the faster path while the existing one-minute
paired relay experiment continues:

```text
npx convex env remove SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED --prod
npx convex env remove MEXICO_EDGE_ROUTINE_WATCH_ENABLED --prod
```

### Settlement-source boundary

Current Polymarket metadata identifies Weather Underground/Weather Company
MMMX Daily Observations as the settlement source. No supported owner-approved
machine interface has been supplied to this project. The edge query therefore
reports `setup_required` or `approval_required` and makes no Weather Company
request. These reserved exact-true gates do not become authorization merely by
being configured:

```text
TWC_MMMX_RES_ACCESS_APPROVED
TWC_MMMX_RES_RETENTION_APPROVED
TWC_MMMX_RES_PUBLIC_APPROVED
```

`TWC` denotes The Weather Company; the abbreviated names fit Convex's
40-character environment-variable name limit.

The approving scope must cover the exact machine interface, MMMX observations,
Convex retention, derived reaction analysis and public/commercial display.
Protected acquisition, retry, storage, query and export entry points must all
enforce their applicable gates when that integration is added.
