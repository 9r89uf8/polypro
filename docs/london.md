# EGLC: fastest current-temperature source

Last researched: **2026-08-08 UTC / 2026-08-08 Europe/London**.

Status: **reopened on 2026-08-08 for a bounded WebTrak build-graph pass, then
closed again as a negative temperature-source result**. The user reports that
approval to validate the newly mapped, currently client-disabled WebTrak
TAFOR/anemometer operations was requested; no recipient, written scope or grant
is recorded here, so it is not treated as granted. Reopen numerical access only after the
applicable exact-`true` Convex gates and written scope are in place, or for a
provider-approved NATS/LCY export or materially new public evidence.

## Scope and airport identity

This investigation is for **London City Airport**, not for another airport in
the London metropolitan area.

| Field                         | Value                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Airport                       | London City Airport                                                                          |
| ICAO / IATA                   | `EGLC` / `LCY`                                                                               |
| AIP aerodrome reference point | `513019N 0000319E` (about `51.50528, 0.05528`)                                               |
| AIP aerodrome elevation       | `20 ft`                                                                                      |
| Local time zone               | `Europe/London`                                                                              |
| Target variable               | Outdoor dry-bulb air temperature representative of the aerodrome                             |
| Desired product               | Freshest real measurement, ideally a native sample rather than a republished report          |
| Target cadence / precision    | One minute or faster and `0.1 °C`, if a supported airport feed exists                        |
| Required freshness            | Fastest supportable delivery; no service-level target has yet been agreed                    |
| Public baseline               | Official `EGLC` aviation observation with honest whole-degree precision                      |
| Retention need                | Not yet specified; no protected raw data may be retained without explicit provider scope     |
| Use assumption                | A future public production application; commercial and republication rights therefore matter |

Heathrow (`EGLL`), Gatwick (`EGKK`), Luton (`EGGW`), Stansted (`EGSS`), and
Southend (`EGMC`) are outside this dossier. Nearby non-airport thermometers are
kept as separate context series and must never be relabelled as `EGLC`.

The evidence labels `observed`, `documented`, `inferred`, `unknown`, and
`rejected`, and identity levels `I0` through `I5`, have the meanings defined in
[`high-frequency-airport-weather-research.md`](./high-frequency-airport-weather-research.md).

## Bottom line

This investigation found **no documented, reusable public machine interface**
for London City's native one-minute airport temperature.
The investigation nevertheless found strong regulatory and operational
evidence that a higher-frequency value should exist inside the airport system;
no native LCY sensor output was directly observed:

- **Documented:** UK CAA CAP 746 requires electronic aerodrome temperature
  sensors to be sampled at least once per minute and measured at `0.1 °C`
  resolution. Accuracy is a separate, looser requirement: better than
  `±1.0 °C`.
- **Documented:** the CAA's 2026 oversight plan identifies **NATS (Services)
  Ltd** as the meteorological-unit provider at London City.
- **Observed:** public `EGLC` reports carry only half-hourly, whole-degree report
  output; they do not reveal the current logger's native behavior. A seven-day
  sample contained 336 reports, all exactly 30 minutes apart at `:20` and `:50`.
- **Decision:** a provider-approved NATS/LCY raw temperature export is the best
  route to the fastest true airport value. Its endpoint, actual sample/filter
  behavior, sensor asset, and external-use rights remain `unknown`.
- **Private paths exist, but their relationship is unknown:** the correctly identified CAA
  response compendium is **CAP 1635**, not CAP 1605. London City's response says
  panoramic video plus “sensory and operational data” are carried to Swanwick
  over secure fibre. Separately, NATS says another provider could take data from
  relevant LCY services. The document does not say that the sensory feed—or a
  temperature field—is the transferable data, and maps no cadence or API.
- **Deployable public baseline:** use the official `EGLC` METAR redistributed by
  NOAA. In three spot samples, NOAA `Last-Modified` preceded AWC's embedded
  `receiptTime` by `3.5–12.7 s`; this cross-provider timestamp proxy may include
  clock skew and is not a client first-seen SLA. AWC is the better documented
  structured interface.
- **Observed public rollover winner:** for `052250Z`, NOAA's file changed before
  the public WIS2 gateway notification, AWC, WebTrak, and XCWeather. WIS2's
  notification was timely but its canonical bulletin download required
  credentials, so it did not expose a usable public temperature payload.
- **Bounded current WebTrak loaded graph mapped:** a cold, isolated 2026-08-08
  browser load exposed a legacy RequireJS/AngularJS module graph; no route
  chunks were observed in the bounded loaded graph. It contains real data flow for TAFOR text plus airport
  anemometer station and wind operations, but the LCY configuration returned
  `weather/anemometers/enable=0` and `weather/tafor/enable=0`. The traced
  numerical consumer accepts wind speed, direction, a maximum-wind-speed field,
  station ID, coordinates and timestamps—no temperature field. The
  client-disabled operations were not called. This is a gated provenance lead, not a new
  temperature source.
- **Historical TraVis result is now resolved:** the airport owner's 2021 page
  linked `travislcy.topsonic.aero`; a 2013 LCY capture preserves the exact
  helper request, integer-second time parameter and ten-second timer. No LCY
  numeric XML survived, but five generated XML payloads from the same TraVis
  application family at Luton, Hamburg and Stuttgart align with
  contemporaneous routine `:20`/`:50` METAR timestamps and exposed fields.
  Whole-degree report temperatures were serialized as `.00`. Together with
  LCY's own 30-minute/60-minute-delay help, this strongly supports treating the
  decimal display as a delayed routine-report wrapper, not evidence of sensor
  tenths. It does not prove LCY's exact upstream source or which component did
  the decoding. The host is retired and `NXDOMAIN`.
- **Planning-application result:** all 209 rows in the archived Newham document
  register for `22/03045/VAR` were inventoried, along with 98 original-submission
  PDFs on the airport's public mirror. No `CSV`, `XLSX`, `DAT`, `.met`, model
  archive, interface specification, or raw weather attachment was exposed. The
  useful discovery is provenance: the air-quality work used **hourly sequential
  2017–2021 London City Airport METAR-site data prepared by the Met Office and
  sold to Air Quality Consultants**, which validated the series and interpolated
  short gaps. This is historical modelling input, not a live or native-minute
  feed.
- **Historical station IDs resolved:** CEDA maps `ICAO EGLC` to MIDAS
  `src_id 18929` and lists METAR plus climatological `CARLOS` records, but says
  no MIDAS Open data are available for the station and records a legacy/
  catalogue hourly remark inconsistent with the current AIP and 2026 sample.
  NOAA maps London City to ISD/USAF `037683-99999`.
  Neither identifier unlocks a public minute stream.
- **A material station-ID error was found:** several consultant reports label
  “surface station 3763” as EGLC. ADM's own public station map and the Met
  Office HadISD catalogue show that `037630`/`3763` is **Bracknell/Beaufort**;
  London City is `037683-99999`, rendered `3768.3` in ADM's map. Reports claiming
  2022 and 2024 data also expose the same hidden `London_City_17.met` path, and
  three nominally different wind roses have identical vector geometry after
  page scaling. Those exhibits are template-contaminated and cannot establish
  independent year, station or precision provenance.
- **Official WOW is an identity-only dead end:** Met Office WOW site
  `955386003` is exactly London City Airport, official and Met Office-owned, but
  says it is not reporting, has no last observation and returned zero rows for
  every sampled year. A Northolt control returned observations through the same
  endpoint. The ID therefore confirms a catalogue identity, not a live feed or
  current sensor.
- **The airport-linked 2021 AQC portal is pollutant-only:** its three archived
  sites exposed hourly/daily NO2, NOx, PM10 and PM2.5 controls. No temperature,
  dew-point, wind, humidity or pressure field appeared in the archived pages,
  exposed form/AJAX parameters, preserved JavaScript or 43-key URL inventory
  examined. It does not expose the offline meteorological input used by AQC.
- **Operational-record result:** an AAIB investigation obtained observations
  from the SAMOS in use at London City, while the public PAMS case study names
  a `SAMOS Gateway`. These are strong lineage clues. The former prints only two
  selected report times; the latter is an alarm/status integration and discloses
  no numeric field, MIB/OID, endpoint, or cadence.
- **Fast nearby context exists but is not the airport.** A home Weather
  Underground station about 1.9 km away advanced in exact 16-second timestamp
  steps, and a Docklands Sailing and Watersports Centre probe about 5.6 km away
  logged every five minutes. Neither has airport siting, calibration, or
  representativeness.

The supplied Met Office summary needs two important corrections:

1. The temperature under **“Next hour”** on the London City Airport page is an
   hourly forecast, not a live observation.
2. That page's **“Last 3 days weather”** link currently opens the observation
   page for **East Malling, Kent**, about 36.9 km from the `EGLC` reference
   point. It is not an airport observation history.

Polling any forecast or observation endpoint every four or five minutes does
not make its underlying source a four- or five-minute measurement.

## Blueprint phase audit

This second pass explicitly followed every numbered phase and the approval
block in the [research blueprint](./high-frequency-airport-weather-research.md).
`Complete` means the bounded public investigation was performed; it does not
mean a private airport feed was found. The blueprint jumps from Phase 11 to
Phase 13; the table labels its intervening unnumbered approval block as Phase
12 so that nothing is silently skipped.

| Phase                                  | Status                                                 | Work performed                                                                                                                                                | Result or remaining boundary                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Scope                               | Complete                                               | Fixed `EGLC`/`LCY`, dry-bulb temperature, airport boundary, time zone, precision, latency and future public-use assumptions.                                  | Prevents Heathrow or a nearby PWS from silently becoming the target.                                                                                                                                                   |
| 1. Authority map                       | Complete                                               | Mapped CAA, Met Office, NATS Services, London City Airport, NATS Data Services, Saab and the public relays.                                                   | NATS/LCY is the raw-data request path; Met Office's airport-named page is a forecast.                                                                                                                                  |
| 2. Provider web surface                | Complete                                               | Inspected current owner pages, current WebTrak configuration/client requests and RequireJS graph, 2021 owner captures, linked terms and common well-known files. | The 2026-08-08 client graph exposed no source map, import map, build manifest, module preload, web manifest or service-worker registration in the bounded loaded graph. Earlier scripted owner-surface requests returned a common `403`; neither result proves unreferenced files do not exist. |
| 3. Hostnames and history               | Complete                                               | Queried all-year owner/TraVis CDX inventories, exact 2013/2021 captures, sibling TraVis deployments, Common Crawl, Arquivo.pt, DNS, certificate/search records and the WebTrak migration bracket. | Recovered the retired client and LCY helper error; sibling generated XML shows that decimal-looking TraVis values can be routine-report values. No successful numeric LCY XML survived and the old host is `NXDOMAIN`. |
| 4. Manuals, procurement and acceptance | Complete for public records; exact asset still blocked | Read CAP 746, CAP 1635, CAA remote-tower/change records, the 2016 ATC and 2017 A429-01 TED notices, NATS acceptance milestones, PAMS/SAMOS material, 24 AAIB PDFs and six audit-plan years. | Establishes requirements, provider, private sensory-data path, system family, ownership split and acceptance chronology, but not the current sensor asset, numeric interface or LCY acceptance pack.                    |
| 5. Browser applications/viewers        | Complete                                               | Traced the retired TraVis request flow, current WebTrak XML flow and a cold-load WebTrak RequireJS/module graph from airport-owner links. | WebTrak's only traced temperature consumer remains the slower METAR wrapper. Its separate TAFOR/anemometer subgraph is disabled for LCY and wind-only in the shipped consumer schema. |
| 6. Mobile/desktop apps                 | Complete bounded negative                              | Searched the archived owner surface for official package/store/PWA links and investigated the only package found whose historical notes mentioned LCY weather. | No official app was found on the checked surfaces. `com.horseboxsoftware.LCY` is explicitly unofficial, and no exact 2021 APK was recovered from the repositories searched. |
| 7. Images/screenshots/charts           | Complete bounded negative                              | Rendered decisive CAA, AAIB, planning and research pages; inspected NATS remote-tower images; extracted off-page PDF text and compared wind-rose vectors.      | No legible temperature channel appeared. The forensic pass instead exposed a 2017 model-file path and near-exact reuse of wind-rose geometry in later reports.                                                         |
| 8. Numeric/binary payload validation   | Complete for public candidates                         | Parsed raw METAR, AWC/WOW JSON, WebTrak and sibling TraVis XML, ThingSpeak JSON, WIS2 notifications, OpenAPI contracts, planning inventories and ADM KML.      | TraVis decimal syntax can mirror already-rounded routine reports; WOW is empty; WIS2 objects are restricted; CEDA/MIDAS and ADM files expose identity/hourly provenance only.                                           |
| 9. Cadence and latency                 | Complete for public sources; native source blocked     | Measured seven days of EGLC/AWC history, a multi-cycle NOAA/AWC monitor, two WIS2 rollovers, WebTrak behavior and nearby-source cadences.                       | Every usable exact-airport public value remains the half-hourly METAR. A provider feed is required to measure native latency.                                                                                           |
| 10. Sensor/field provenance            | Partial (`I3`)                                         | Established airport, provider, system family, private data path, requirements and archive IDs `18929`, `037683-99999`/ADM `3768.3` and `50LC`; falsified `3763`. | The valid IDs still resolve station/report archives rather than the current sensor/channel; `I4`/`I5` remain blocked on NATS/LCY asset, calibration and acceptance records.                                             |
| 11. Agreement study                    | Partial but executed                                   | Pre-registered two time anchors and compared 336 EGLC reports with the five-minute DSWC series for seven days.                                                | The nearby probe disagreed too much to substitute for airport truth; a native-sensor comparison still needs access.                                                                                                    |
| 12. Approval/legal gate                | Complete design; approval pending                      | Recorded owner/provider terms and specified separate exact-`true` Convex gates for protected integrations and WebTrak access, retention and republication. | The user reports a WebTrak approval request on 2026-08-08, but no recipient, scope or grant is recorded. Public/no-login reachability is not approval; protected gates must stay unset and fail closed. |
| 13. Collector design                   | Complete design only                                   | Specified source separation, timestamps, revisions, provenance, staleness and failure behavior.                                                               | No collector or product code was requested or created.                                                                                                                                                                 |

## 2013–2024 Wayback reconstruction: the retired TraVis path

### Owner-to-provider chain

The airport owner's archived [Track aircraft page from 27 February
2021](https://web.archive.org/web/20210227064200id_/https://www.londoncityairport.com/corporate/Environment/Track-aircraft)
explicitly told users to open **TraVis** and linked:

```text
https://travislcy.topsonic.aero
```

The raw archived owner HTML was 568,514 bytes with SHA-256
`c8c084bc136d7df070670d0d2082e73afbb000ae6ba1326c1ed4def95b37d447`.
Owner captures from February, May, August and October 2021 retained the same
destination. A collapsed 2021 owner CDX inventory contained 942 successful
records plus a header (928 HTML, six JavaScript, five fonts and one each of
PNG, ICO and CSS). It exposed no separate airport-weather route; a URL
containing `temperature` concerned COVID checks, not a thermometer.

The owner CDX artifact was retrieved at `2026-08-05T23:15:15Z`, was 147,146
bytes and hashed
`2e50f99eadc7e29f2d1b31d776ee9decfdfec35ccea7d503f1d08445e9bff886`.
The inventory is evidence about archived URL names, not proof that uncaptured
routes never existed.

```text
https://web.archive.org/cdx/search/cdx?url=www.londoncityairport.com/*&from=2021&to=2021&output=json&filter=statuscode:200&collapse=urlkey&fl=timestamp,original,statuscode,mimetype,digest,length&limit=50000
```

### What the 2021 client actually did

The exact [22 January 2021 TraVis
capture](https://web.archive.org/web/20210122115100id_/https://travislcy.topsonic.aero/)
is titled `TraVis - London City Airport`, identifies client version `3.1.1`
dated 28 October 2016, and is byte-identical by Wayback digest to all six 2021
root captures. A fresh raw-byte replay check measured 305,507 bytes and hashed
`9fbfcfcea7c53f62e6cbf04731aee70c9053694bfe4dbfbd6620ac13faaf1c20`.

Its unobfuscated client code provides the decisive semantics:

```text
liveDelayTimeInMinutes = 60
loadWeather timer = 11,000 ms

GET getWeatherData.php?session=<client-random>&time=<selected-epoch>
GET xmlSessionData/weather<session>.xml?r=<cache-buster>
```

The first request triggered server-side generation; after it completed, the
client fetched the per-session XML file. The client parsed `time`,
`windspeed`, `winddir`, `temp`, `humidity`, `airpressure`, `dewpoint`,
precipitation, visibility and cloud-cover fields. It rendered temperature as
`toFixed(1)` in the detail pane and `toFixed(0)` in the header.

Those implementation details can easily be misread as an 11-second decimal
sensor. The same application says, in its user help, that weather information
is updated **every 30 minutes**, corresponds to the selected replay time, and
that live data has a **60-minute delay**. The 11-second timer merely refreshed
the replay helper; `toFixed(1)` is presentation formatting, not proof of
native precision. This disqualifies TraVis for fastest live temperature even
when judged by its 2021 behavior rather than its present retirement.

### Earlier LCY capture: the exact helper contract survives

The deeper all-years pass found an earlier [7 December 2013 LCY root
capture](https://web.archive.org/web/20131207014408id_/http://travislcy.topsonic.aero:80/).
The 261,141-byte raw replay hashes
`1bc2f31cf2a1e09597c2f66b4697d5a95eefc624263495e5c5d4ff92c87268dc`.
That version rounded the selected time to integer Unix epoch seconds, built a
client session identifier, called the same helper, and then requested the same
per-session XML on a ten-second timer:

```text
GET getWeatherData.php?session=<sessionID>&time=<integer-Unix-seconds>
GET xmlSessionData/weather<sessionID>.xml?r=<random>
```

Wayback also retained the [8 December 2013 no-parameter helper
response](https://web.archive.org/web/20131208131012id_/http://travislcy.topsonic.aero:80/getWeatherData.php).
It is a 227-byte LCY-branded page ending `Wrong time parameter .....`, with
SHA-256
`3511181f4a0f3529355d02b768daacf11a61adfa4b659f9a04891d21cd677990`.
This is direct LCY server evidence that the helper existed. It contains no
weather value, and no parameterized LCY helper response or generated LCY XML
survived, so it cannot be used to reconstruct a historical observation.

### Sibling TraVis payloads resolve the decimal-display ambiguity

A product-family comparison found generated `weather<session>.xml` payloads
from the same TraVis application family at Hamburg, Luton and Stuttgart. This
is cross-deployment evidence, not a direct LCY payload, so its conclusion is
explicitly `inferred` for London City. Five archived payloads across three
deployments were checked; all fell exactly at routine `:20` or `:50`
observation times, aligned with the contemporaneous airport METAR in the
exposed fields, converted knots to metres per second and QNH to decimal
pressure, and serialized whole-degree temperatures with two decimal places.

| Deployment / observation | Archived XML evidence | Contemporaneous report check | Result |
| ------------------------ | --------------------- | ---------------------------- | ------ |
| [Luton, 27 Feb 2018 23:20Z](https://web.archive.org/web/20180228000853id_/http://travisltn.topsonic.aero/xmlSessionData/weather1234406207279.xml?r=0.012519945959245105) | `temp=-5.00`, `dewpoint=-6.00`, `wind=2.57 m/s @ 010`, `pressure=1018.92`; 344 bytes; SHA-256 `f4f2b870ffdf3740b6ce3bb15b0e4b4a646dd408294a3cf03038d4d77c9c9010` | `EGGW 272320Z AUTO 01005KT 9999 BKN005 M05/M06 Q1019` | Routine-report-aligned serialization |
| [Hamburg, 19 Jun 2022 20:50Z](https://web.archive.org/web/20220619211506id_/https://travisham.topsonic.aero/xmlSessionData/weather230536774140.xml?r=0.12545141221644385) | `temp=12.00`, `dewpoint=12.00`, `pressure=1013.00`; 376 bytes; SHA-256 `6eda41cace1f09509ba818cbd6382921582e6d716fbf8e97e8ae36e08df209b8` | `EDDH 192050Z AUTO VRB01KT CAVOK 12/12 Q1013 NOSIG` | Routine-report-aligned serialization |
| [Stuttgart, 26 Jul 2020 17:50Z](https://web.archive.org/web/20200726180916id_/https://travisstr.topsonic.aero/xmlSessionData/weather1003035212605.xml?r=0.07083227386040947) | `temp=19.00`, `dewpoint=15.00`, `wind=3.09 m/s @ 270`, `pressure=1016.92`, light rain; 349 bytes; SHA-256 `7f751b1059fb946fd76bfb63712eb43dd2876e26a3f17bb0eae2c0fa96f96d47` | Routine `EDDS 261750Z` fields matched | Routine-report-aligned serialization |

Two additional Stuttgart payloads, for [18 April 2020
05:50Z](https://web.archive.org/web/20200418061351id_/https://travisstr.topsonic.aero/xmlSessionData/weather769714500709.xml?r=0.3823424059809506)
and [25 January 2022
23:50Z](https://web.archive.org/web/20220126000227id_/https://travisstr.topsonic.aero/xmlSessionData/weather1138919941792.xml?r=0.05282506132318243)—the latter captured shortly after midnight on 26
January—produced the same result; their SHA-256 values are
`12ef4a110556a5a5b6fb72102dfac9202307c489ce9a1d5f96c3274e512d5bff`
and `6bc019123c422c029cbac76f79ceec3763a000e17466ff59785230ecdd6ea7c8`.
The archived [Luton
root](https://web.archive.org/web/20180114152117id_/http://travisltn.topsonic.aero:80/)
and [Hamburg
root](https://web.archive.org/web/20220619211442id_/https://travisham.topsonic.aero/)
and [Stuttgart
root](https://web.archive.org/web/20200726180909id_/https://travisstr.topsonic.aero/)
establish the deployment identities and common TraVis application family. The
safe conclusion is not
that sibling airports prove LCY's exact upstream configuration; it is that
TraVis's decimal XML/display schema is demonstrably capable of serializing a
routine report's already-rounded temperature with added decimal places. LCY's
own 30-minute update statement and 60-minute replay delay make a delayed
routine-report wrapper the strongest evidence-supported interpretation. The
comparison does not prove LCY's exact upstream source or that TraVis itself
performed the decoding.

### Archive completeness, persistence and retirement

The root was captured six times in 2021—22 January, 22 April, 12 May, 5 August,
18 October and 4 December—with Wayback digest
`GQZZZWTW3PQ3MDNFHDTAMOK2O7LTBL3S`. The same 11-second/30-minute/60-minute
behavior appears in the first 2019 root, a 2022 root and the last root from 21
February 2024. Their raw SHA-256 hashes differ because the surrounding page
changed, but the decisive client behavior did not.

A collapsed `travislcy.topsonic.aero/*` CDX inventory for 2018–2024 returned
189 successful URL keys: 91 JavaScript, 49 CSS, 32 PNG, 14 GIF, two ICO and one
HTML. An all-years follow-up incorporated the 2013 root and no-parameter error
above. The displayed queries are the reproducible collapsed inventories;
separate exact, uncollapsed searches for parameterized helper URLs and
generated `xmlSessionData/weather…xml` files also found no successful numeric
LCY weather payload:

```text
https://web.archive.org/cdx/search/cdx?url=travislcy.topsonic.aero/*&output=json&filter=statuscode:200&collapse=urlkey&fl=timestamp,original,statuscode,mimetype,digest,length&limit=50000
```

```text
https://web.archive.org/cdx/v1/search/cdx?url=travislcy.topsonic.aero/*&from=2018&to=2024&output=json&filter=statuscode:200&collapse=urlkey&fl=timestamp,original,statuscode,mimetype,digest,length&limit=50000
```

```text
/getWeatherData.php?session=*&time=*
/xmlSessionData/*
/*weather*
```

A top-level [`weather.xml`
capture](https://web.archive.org/web/20131208125541id_/http://travislcy.topsonic.aero:80/weather.xml)
does survive, but it is only a 282-byte Apache `404` response, SHA-256
`4d749cbdbcf108656e514cd10afb0e886df300607e493abd543755a92c1f35d1`—not
weather data. The only successful weather-named archived image was a static
wind-rose GIF; it contained no timestamped numeric observation.

Therefore the LCY request contract and helper error are archived, but no LCY
numeric payload can be replayed or used for a cadence experiment. The sibling
payloads resolve product behavior, not London City's historical values. A
Common Crawl December 2021
WARC independently preserved the same root code (crawl time
`2021-12-04T16:10:05Z`, origin IP `85.10.212.70`), while its robots request was
`404`. The compressed 68,102-byte range hashed
`435399946868093b4c146020016314505f8795e6c2be68e2695c75b5c6c155cd`;
the 306,361-byte decompressed response hashed
`beb8e78f3e8a0904b415507c54b6a9d15d82090da951af1b9650894b7f6d18ee`.
The reproducible WARC member is
`crawl-data/CC-MAIN-2021-49/segments/1637964362999.66/warc/CC-MAIN-20211204154554-20211204184554-00368.warc.gz`,
compressed byte range `655741957-655810058`.

The current hostname returns `NXDOMAIN`; an exact-domain urlscan query returned
zero results. No neighboring TraVis host was probed. Certificate transparency
exposed one LCY-specific neighboring name,
`ntmslcy01.noiselcy.topsonic.aero`, first logged 28 April 2021 with renewals
through September 2022. It has no current address and produced no Wayback or
urlscan result. Its name indicates noise monitoring, not meteorology, so it was
recorded as passive infrastructure lineage and not probed. A separate
`travisbase.topsonic.aero` string appeared only in the archived aircraft-picture
request flow. Neither is a temperature candidate.

The public migration can be bracketed without guessing an exact cutover:

| Evidence                           | Last/first archived date   |
| ---------------------------------- | -------------------------- |
| Old owner `Track-aircraft` surface | last seen 10 October 2023  |
| Old `travislcy.topsonic.aero` root | last seen 21 February 2024 |
| New owner flight-track page        | first seen 14 June 2024    |
| `webtrak.emsbk.com/lcy`            | first seen 20 June 2024    |
| `eu.webtrak.aero/lcy`              | first seen 3 December 2025 |

No archived `webtrak-server-eu.../WebTrak/lcy/*` data payload was found. The
old TraVis terms limited use to personal/non-commercial purposes and barred
copying, distribution, publication and derivatives without written LCY
permission. Historical accessibility therefore supplies neither a live source
nor production reuse rights.

### The separate 2021 LCY air-quality portal was pollutant-only

The official [Newham 2019 Annual Status Summary
Report](https://www.newham.gov.uk/downloads/file/1415/assr-public-2019), physical
page 10, links `https://lcy.aqconsultants.co.uk` and describes three real-time
air-quality stations. The 12,921,901-byte PDF hashes
`391461a73aaa4a18f6753689d5696327fd94a36b5deec1243b6e49e0b273dc8a`.
This owner/council link made the portal worth reconstructing rather than
dismissing it from its hostname.

The exact March 2021 pages were:

| Site | Archived page | Public variables |
| ---- | ------------- | ---------------- |
| `CAH` | [2 March 2021](https://web.archive.org/web/20210302230340id_/https://lcy.aqconsultants.co.uk/sites/CAH) | NO2, NOx and PM10; hourly/daily |
| `KGV` | [2 March 2021](https://web.archive.org/web/20210302230458id_/https://lcy.aqconsultants.co.uk/sites/KGV) | PM10 and PM2.5; hourly/daily |
| `ND` | [3 March 2021](https://web.archive.org/web/20210303002550id_/https://lcy.aqconsultants.co.uk/sites/ND) | NO2 and NOx; hourly/daily |

The pages posted to `/sites/update_stats` for HTML statistics and
`/sites/update_graph` for JSON graph data, while `/sites/download_data`
supplied historical CSV downloads. A complete all-years collapsed archive
inventory contained 43 URL keys. No air-temperature, dew-point, humidity,
pressure or wind field appeared in the archived pages, exposed form/AJAX
parameters, preserved JavaScript or URL inventory examined. The archived [map
bundle](https://web.archive.org/web/20211103023827id_/https://lcy.aqconsultants.co.uk/static/js/map.70d23197a408.js)
was static site mapping, not a weather layer. Current production and test
hostnames are `NXDOMAIN`.

```text
https://web.archive.org/cdx/search/cdx?url=lcy.aqconsultants.co.uk/*&from=2010&to=2026&output=json&collapse=urlkey&fl=timestamp,original,statuscode,mimetype,digest,length&limit=50000
```

This closes a potentially confusing 2021 branch: the public portal carried
pollutant data only, with hourly/daily downloads and monthly statistics. It
does not show that AQC lacked private meteorological model inputs; the planning
record below proves that it had an offline, Met Office-prepared hourly LCY
series. It only shows that those inputs were not exposed through the archived
public client surface examined.

## Planning, station-catalogue and historical-data forensics

### Newham application `22/03045/VAR`: complete attachment audit

The application was validated on 19 December 2022, so an application-specific
2021 Wayback capture cannot exist. The separate 2021 owner/TraVis path above is
the relevant historical web surface for that year. Newham identifies the
application with internal key `RNYU92JY5NA00`; its current [summary
tab](https://pa.newham.gov.uk/online-applications/applicationDetails.do?activeTab=summary&keyVal=RNYU92JY5NA00)
and [document
tab](https://pa.newham.gov.uk/online-applications/applicationDetails.do?activeTab=documents&keyVal=RNYU92JY5NA00)
timed out from the research client, so the archived register was used.

The [first successful summary capture, 9 February
2023](https://web.archive.org/web/20230209202536id_/https://pa.newham.gov.uk/online-applications/applicationDetails.do?activeTab=summary&keyVal=RNYU92JY5NA00)
reported 109 documents. The [7 March 2023 documents
capture](https://web.archive.org/web/20230307195713id_/https://pa.newham.gov.uk/online-applications/applicationDetails.do?activeTab=documents&keyVal=RNYU92JY5NA00)
contained 209 unique rows. Every row was parsed, rather than relying on a
search-engine sample:

| Register field | Count/detail |
| -------------- | ------------ |
| Correspondence | 92 |
| Documentation | 72 |
| Drawing | 35 |
| Consultee Comment | 8 |
| Application Form / CIL | 1 each |
| File extensions | 206 PDF, one PNG, one DOCX and one GIF |
| Data/model formats | No ZIP, XLS, XLSX, CSV, DAT, `.met` or similar row |

The three non-PDF files were a press-notice image, a Crossrail safeguarding
document and a works key-plan image. The [attachment CDX
inventory](https://web.archive.org/cdx/search/cdx?url=pa.newham.gov.uk%2Fonline-applications%2Ffiles%2F*&from=2022&to=2025&output=json&fl=timestamp%2Coriginal%2Cstatuscode%2Cmimetype%2Cdigest%2Clength&filter=original%3A.*22_03045_VAR.*&collapse=urlkey&limit=10000)
added 213 unique attachment URLs through 2024: 199 overlapped the March
register, ten appeared only in the register and fourteen appeared only in CDX.
Wayback retained the filenames and register metadata but not the files: 212
attachment replays produced 404 HTML pages and the remaining extensionless URL
was a 302. The additional named items were council, GLA, MP or objection
correspondence, not weather data.

The airport's [applicant submission-document
mirror](https://feature-corporate-footer.lcy-airport.pages.dev/corporate/corporate-info/future-airport-and-planning/submission-documents)
exposed 98 original-submission assets through embedded Nuxt data. All 98 were
PDFs. The [appeal core-document
list](https://gat04-live-1517c8a4486c41609369c68f30c8-aa81074.divio-media.org/filer_public/54/8c/548ccc01-56ea-45cd-9bd0-3adfc6ead3e6/lcy_-_core_documents_list_-_18_october_2023.pdf)
and the appeal collection were also searched. None of these surfaces exposed a
raw meteorological file, model archive, spreadsheet, interface-control
document, data dictionary, equipment schedule or acceptance-test attachment.

This is a bounded public-document result, not proof that the files never
existed. The [final LUC review, core document
CD4.5.10](https://gat04-live-1517c8a4486c41609369c68f30c8-aa81074.divio-media.org/filer_public/47/fc/47fc8f15-9eee-4f2b-a120-da55e4fbedbc/cd4510_review_of_the_environmental_statement_for_london_city_airport_final_review_report_by_luc.pdf),
physical pages 21, 54–56, 216 and 221, records requests for modelling files and
spreadsheets and an unresolved intellectual-property/NDA dispute. That explains
the public-file gap; it does not authorize obtaining the private inputs.

### What the planning record actually reveals

The original [Appendix 9.3, Detailed Modelling
Methodology](https://assets.ctfassets.net/lmkdg513arga/1n8LJjhXzOcH1hQsdJMbHX/944663d43318e85128ee049c392e3694/CADP1_S73_ES_Vol_2_Appendix_9.3_Detailed_modelling_methodology.pdf),
physical PDF page 15 / printed page 13, paragraph 9.1.57, says the dispersion
assessment used **hourly sequential** data for 2017–2021 from the Met Office
station at the airport. The next page describes an `airfile` and a time-varying
emissions file, but gives no filename, header, checksum or sample.

The June 2023 Air Quality Consultants response embedded in CD4.5.10 supplies
the strongest provenance:

- physical page 103, embedded page 20, paragraph 2.25 identifies the source as
  the **London City Airport METAR site** and says the Met Office prepared and
  sold the series to AQC for dispersion modelling;
- AQC validated and processed the data, including interpolation over short
  gaps, and says no other station was used;
- Table 7 reports 2017–2021 completeness for `U`, `PHI`, `T0C`, `RHUM` and
  `CL`, plus calm-hour counts; and
- the [official CERC ADMS variable
  definitions](https://www.cerc.co.uk/environmental-software/assets/data/doc_userguides/CERC_ADMS-Screen_User_Guide.pdf)
  map those generic codes to wind speed, wind direction, surface temperature,
  relative humidity and cloud cover.

| AQC Table 7 field | 2017 | 2018 | 2019 | 2020 | 2021 |
| ----------------- | ---: | ---: | ---: | ---: | ---: |
| `U` completeness | 99.7% | 99.5% | 99.6% | 99.6% | 99.7% |
| `PHI` completeness | 99.7% | 99.3% | 99.4% | 99.5% | 99.4% |
| `T0C` completeness | 99.8% | 99.8% | 100% | 100% | 100% |
| `RHUM` completeness | 99.8% | 99.8% | 100% | 100% | 100% |
| `CL` completeness | 99.8% | 99.8% | 100% | 100% | 100% |
| Calm hours | 26 | 52 | 62 | 78 | 79 |

The ADMS definitions show what the generic model variables mean. They do not
prove the headers of AQC's undisclosed file. The response's “hourly or smaller”
model capability is likewise not evidence of sub-hourly LCY observations; the
application-specific source is expressly described as hourly sequential.

This closes the planning branch for the live-source question: it identifies a
commercially supplied, quality-controlled historical **hourly** product derived
from the airport METAR site. It neither exposes nor points to the pre-METAR
minute sample.

### Climate baseline and the Table 11-32 discrepancy

The climate clarification in CD4.5.10, physical pages 61–62 and 132, says it
used 2018–2022 data from a weather station located at London City Airport. It
reports `12.7 °C` average annual temperature, `16.2 °C` “summer,” `9.15 °C`
“winter,” `39 °C` maximum summer, `−5 °C` minimum winter, `661.4 mm` annual
rainfall and monthly rainfall extrema of `102.2 mm` in October and `25.3 mm` in
April.

The response says these details are in Table 11-32. They are not. The original
[Chapter 11, Climate
Change](https://assets.ctfassets.net/lmkdg513arga/6T2dpnsOoP8Bj5tevLw2DT/5f343657e2bc01748d0fb83aa05c4785/CADP1_S73_ES_Vol_1_Ch_11_Climate_Change.pdf),
physical page 60 / printed page 58, titles Table 11-32 “Current Climate Change
Hazards” and gives qualitative flood, drought, storm, heatwave, snow and ice
information based on national assessments. It contains none of the quoted
airport-station statistics. The clarification's citation is therefore
inaccurate or materially imprecise.

A reproducibility check against [NOAA Global Summary of the
Day](https://www.ncei.noaa.gov/data/global-summary-of-the-day/access/) station
`037683-99999` found 1,823 daily rows for 2018–2022. Their overall mean
temperature is `12.718 °C`, maximum summer value `39 °C` and minimum winter
value `−5 °C`, matching three figures in the response. But conventional
June–August and December–February means are about `19.24 °C` and `7.16 °C`,
not `16.2 °C` and `9.15 °C`, and GSOD precipitation is missing for the station.
The match supports—but does not prove—that the response used the same station
lineage; the undefined “summer” and “winter” labels cannot be reconstructed
confidently.

The reproducible file pattern was
`https://www.ncei.noaa.gov/data/global-summary-of-the-day/access/{year}/03768399999.csv`
for each year 2018–2022. Fahrenheit temperature fields were converted to
Celsius, missing-value sentinels were excluded, and meteorological summer and
winter were defined as June–August and December–February. The result is a
cross-check of published daily summaries, not evidence of the airport's native
sampling interval.

### Exact archive identities—and what they do not mean

The [CEDA MIDAS station
record](https://utils.ceda.ac.uk/cgi-bin/midas_stations/station_details.cgi.py?id=18929&db=midas_stations)
provides the strongest official identity crosswalk:

| Field | CEDA value |
| ----- | ---------- |
| Name / source ID | `LONDON CITY` / `18929` |
| Station code | `ICAO EGLC` |
| Message types | `METAR` and `CARLOS`, 1 October 1987 to “Current” |
| Coordinates | `51.52076, 0.07579`; WGS84 shown as `51.52127, 0.07416` |
| Elevation | `2.0 m` |
| Observing-practice remark | `06Z-20Z HOURLY`, 4 September 1996 to “Current” |
| Open access | “No MIDAS Open data are available from this station” |

The [CEDA message-type
dictionary](https://artefacts.ceda.ac.uk/badc_datadocs/ukmo-midas/met_domain.html)
defines `CARLOS` as monthly and annual climatological averages calculated by
NCIC. That makes it a plausible route behind the planning climate summary, but
the planning response never names `CARLOS`; the connection is an inference.
The [full MIDAS
collection](https://catalogue.ceda.ac.uk/uuid/220a65615218d5c9cc9e4785a3234bd0/)
is restricted, while MIDAS Open excludes this exact station. The generic
[MIDAS hourly
schema](https://artefacts.ceda.ac.uk/badc_datadocs/ukmo-midas/WH_Table.html)
publishes fields such as observation time, source ID, air temperature and
dewpoint, but is not evidence of AQC's private file layout or a live endpoint.

CEDA's `06Z-20Z HOURLY` remark marked “Current” conflicts with the current AIP's
`HO+` entry and the 2026 sample's half-hourly overnight reports. It must be
treated as legacy/catalogue or MIDAS-ingest metadata, not the current
operational schedule.

The Met Office Library's [1987–1989 London City Airport
register](https://library.metoffice.gov.uk/Portal/recordview/index/635237) uses
archive reference `MET/2/4/1/1/a/533` and historical code `50LC`, and describes
mainly half-hourly observations. NOAA's authoritative
[`isd-history.csv`](https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv)
instead maps `LONDON CITY` / `EGLC` to ISD/USAF `037683` with WBAN `99999`.
A 2013 research-paper graphic labels `037683` as a “WMO nr.” The safer exact
description is the six-digit ISD/USAF/WMO-type identifier used in NCEI
products; it is not the canonical five-digit legacy WMO station-number format.

These identifiers resolve archive/report identity and are valuable search
keys. They do not identify the current thermometer, logger channel, exact
sensor coordinate or native sampling field. The CEDA coordinate also differs
from the AIP aerodrome reference point, so it must not be promoted to a current
sensor coordinate without provider confirmation.

### The consultant “3763 = EGLC” label is false and template-contaminated

An apparently useful exact identifier emerged in multiple dispersion-model
reports: `Surface Station Number 3763 - EGLC`. It does **not** survive primary
source checking.

Atmospheric Dispersion Modelling Ltd's archived [meteorological-data supplier
page](https://web.archive.org/web/20191029142923id_/http://www.aboutair.com/met-data.htm)
links a public [station map](https://www.google.com/maps/d/viewer?mid=14z8zeHHUirmdnnHABRQv9IV84Mw&usp=sharing).
Its downloadable [KML](https://www.google.com/maps/d/kml?mid=14z8zeHHUirmdnnHABRQv9IV84Mw&forcekml=1)
gives the following contemporaneous rows:

| ADM row | Coordinates / elevation | Supplier identifiers | Meaning |
| ------- | ----------------------- | -------------------- | ------- |
| `LONDON/CITY` | `51.505, 0.055`, `5.8 m` | station `GLC`; displayed `3768.3` | London City; the map has 2015–2018 layers and reports overall missingness of 0.8%, 0.5% and 2.6% for 2016–2018 |
| `BRACKNELL/BEAUFORT` | `51.383, -0.783` | station `GRR`; `3763.0` | A different station west of London, with 100% cloud/wind missing in the displayed 2015 layer |

The Met Office's official [HadISD final station
list](https://www.metoffice.gov.uk/hadobs/hadisd/v343_2025f/files/hadisd_station_fullinfo_v343_2025f.txt)
independently resolves `037630-99999` as **BRACKNELL/BEAUFORT** and
`037683-99999` as **LONDON CITY**, at the same respective coordinates. ADM
separately renders the co-located London City identity as `3768.3`, while
`3763` belongs to Bracknell. The identity relationship is demonstrated, but
the formatting mechanism—and a dropped `8.` as a possible transcription
mechanism—remain inferences. The identity error itself is directly demonstrated.

PDF forensics show that the error is not safe to treat as an isolated typo:

- a [December 2023 Kidbrooke
  appendix](https://docs.planning.org.uk/20240111/53/_GRNW_DCAPR_118439/zgbogppls73m6nty.pdf)
  claims 2022 `3763/EGLC` data but embeds off-page text pointing to
  `C:\Users\nickh\Dropbox\07 Reference Documents\15 Met Data\ADMS\London City 2017\London_City_17.met`;
- a [November 2025 Hawkins
  report](https://docs.planning.org.uk/20260519/152/DCAPR_150503/0z6p6hc1ls4ior7v.pdf)
  claims 2024 data but exposes the same 2017 path; and
- wind-rose pages in [H3228
  (2021)](https://docs.planning.org.uk/20210614/58/QTRG6PJN0AH00/x5m7l4rp04347dg1.pdf),
  [H3817
  (2023)](https://www.chelmsford.gov.uk/media/o0gn3dul/cd0102-air-quality-assessment.pdf)
  and the 2025 report each contain 180 coloured radial vector drawings. After
  only independent affine scaling of page x/y coordinates, every bounding-box
  coordinate matches the 2021 figure with maximum residual below `0.06` PDF
  point.

That is strong evidence that the figure/template was reused despite later
captions claiming different years. The hidden local path is not a public file
URL and does not expose `.met` bytes. Other planning reports independently name
ADM as supplier of hourly, model-ready London City data—for example, this
[Environment Agency consultation
attachment](https://consult.environment-agency.gov.uk/psc/rm7-7pn-green-mountain-dc-uk-limited-fp3630eu-v002/supporting_documents/Application%20variation%20V002%20%20Air%20Quality%20Assessment.pdf)
states both ADM supply and hourly sequential 2015–2019 LCY records—and ADM's
archived page advertises hourly WMO-station files for ADMS/AERMOD/ISC. Adjacent public
paths disclose filenames from `London_City_13.met` through `_19.met`, but
bounded archive and site searches recovered no raw file. Hawkins itself does
not name ADM, so the supplier relationship for that exact report remains
plausible rather than proved.

This branch provides useful historical supplier/identity evidence, but no live
interface. It also establishes a durable exclusion rule: never use consultant
`3763` labels, wind-rose year captions or the fact that ADMS `.met` syntax can
hold decimals as evidence of native LCY precision without the underlying file
and source metadata.

### AAIB operational extracts

The AAIB catalogue was searched using the exact airport name. Twenty-two report
landing pages plus the EI-CZO short bulletin and the G-BOAW appendix produced 24
PDFs; text-extractable documents were searched and image-only material was
rendered for inspection. Only [formal report 5/2009 on
  EI-CZO](https://assets.publishing.service.gov.uk/media/5422eb10e5274a1314000055/5-2009_EI-CZO.pdf),
physical PDF page 22 / printed page 14, identifies SAMOS.

The report says investigators obtained records from the SAMOS in use at London
City Airport. It prints observations at 08:20 and 08:40 around an 08:33
incident; both have `10 °C`, `8 °C` dew point and `1006 mb`, while the wind
changed. This proves that operational LCY SAMOS records could be extracted. It
does not prove a 20-minute native cadence: the report selected two observations
that bracketed the event and did not publish the underlying log.

No other inspected AAIB report exposed a SAMOS/METAR interface, calibration
record, FAT/SAT pack, as-built schedule or data dictionary. The older G-BOAW
material contains a Met Office reconstructed temperature cross-section, not a
raw station log.

The [GOV.UK content record for report
5/2009](https://www.gov.uk/api/content/aaib-reports/5-2009-bae-146-200-ei-czo-20-february-2007)
lists exactly two attachments—the full report and bulletin summary. Searches
for occurrence `EW/C2007/02/06` found no separately published SAMOS extract or
supporting appendix. The operational log may have existed in the investigation
file, but it is not an omitted link on the public landing record.

### Consultancy, research and public-code branches

The exact phrase and resolved identifiers were then used in planning libraries,
regulatory attachments, scholarly repositories and code search:

- a [2024 Westminster AQC
study](https://www.westminster.gov.uk/sites/default/files/media/documents/Westminster%20WHO%20Compliance%20Study%20-%20Full%20Report%20AQ%20Consultants.pdf),
  paragraph A1.15, uses hourly sequential 2022 London City data and says the
  Met Office supplied and quality-assured the raw series;
- an [Environment Agency permit
  attachment](https://consult.environment-agency.gov.uk/psc/da17-6jy-cory-environmental-holdings-ltd/supporting_documents/application-bespoke-appendix-i-air-emissions-risk-assessmentpdf-1),
  paragraph 4.4.1, uses five years of hourly sequential London City data for
  2018–2022; and other consultant reports repeat hourly LCY model inputs;
- the 2026 LCY RNP-AR consultation's [air-quality technical
  report](https://consultations.airspacechange.co.uk/london-city-airport/rnp-ar-approaches/supporting_documents/annex-d-air-quality-technical-reportpdf)
  carries forward the `22/03045/VAR` modelling method but supplies no new
  meteorological filename, station metadata, raw attachment or cadence;
- the Zenodo record [“2016 - London GL Weather stations + AMDAR + Picarro +
  Spatial”](https://zenodo.org/records/2596931) explicitly lists EGLC, but its
  files are embargoed until 30 April 2027 and the public record does not expose
  a live interface, EGLC schema or proved EGLC cadence; and
- exact GitHub code searches for the planning report ID, `SAMOS`/`RAMOS` with
  `EGLC`, `SAMOS Gateway`, the retired TraVis hostname and its weather-helper
  strings produced no relevant public implementation before the authenticated
  search quota was reached. This is a bounded negative, not a repository-wide
  proof of absence.

WMO OSCAR/Surface was queried by `London City Airport`, `EGLC`, `037683` and a
tight coordinate box around the airport. Exact identifier searches and the
tight box returned no discoverable LCY record; a wider London-area box did
return other UK stations, demonstrating that the search itself was functioning.
No WIGOS identifier was resolved. This result is limited to the public search
surface and does not override the exact CEDA/NOAA mappings.

The lower-priority D-ATIS/local-report branch is documented separately below.
It found a published voice/telephone product and event-driven reporting rules,
not a public structured EGLC API or continuous sensor sample. None of the
planning, catalogue, consultancy, academic, code, OSCAR or D-ATIS branches
changes the source decision.

## Source architecture

The evidence supports this flow. Items in square brackets are not publicly
exposed or not yet provider-confirmed at field level.

```text
[EGLC temperature sensor]
  CAP 746: >= 1 sample/minute, 0.1 °C resolution
        |
        v
[NATS/LCY observing system / SAMOS-family workflow]
        |--------------------> local dynamic display / local reports / ATIS
        |
        v
EGLC METAR encoding
  routine :20 and :50, temperature rounded to whole °C
        |
        v
NATS Data Services -> SAUK32 EGGY aviation bulletin
        |--------------------> AFTN / AMHS / SADIS / MAVIS / Direct Line
        |--------------------> GTS-to-WIS2 notification -> restricted canonical object
        |--------------------> NOAA tgftp -> AWC JSON
        `--------------------> third-party METAR displays such as WebTrak/XCWeather

Separate CAP 1635 evidence:
  [LCY panoramic + sensory/operational data] -> secure fibre -> Swanwick
  [future provider may take data from relevant LCY services]
  [relationship to SAMOS/temperature/export unknown]
```

This is why finding a faster METAR relay can reduce distribution delay by
seconds or minutes but cannot recover one-minute samples or decimal precision
that were removed before dissemination.

The planning-model path is a separate historical branch:

```text
EGLC METAR-site observations -> Met Office/other supplier prepared hourly series
  -> commercial delivery -> validation/gap interpolation -> ADMS input
  valid identities: 037683 / ADM 3768.3; consultant 3763 labels rejected
```

It improves source identity and archive vocabulary; it does not bypass the
public-report reduction or expose the upstream native sample.

## Authority and ownership map

| Role                                   | Organization                      | Evidence and implication                                                                                                                                           |
| -------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UK Meteorological Authority            | Civil Aviation Authority          | The current UK AIP identifies the CAA as the authority; CAP 746 sets observing and equipment requirements.                                                         |
| Aviation forecast and climatology ANSP | Met Office                        | CAA designation; the EGLC AIP lists Met Office Heathrow for associated office and TAF preparation. This does not make the public forecast page a live sensor feed. |
| EGLC meteorological observing unit     | NATS (Services) Ltd               | Named for London City in the CAA 2026 ANSP audit plan. A necessary provider contact for lineage/export, paired with LCY and any separately identified data owner; the plan does not establish sole ownership. |
| Air traffic service                    | NATS / London City                | London City is remotely controlled from the NATS centre at Swanwick using the Saab digital-tower system.                                                           |
| Airport operator                       | London City Airport Ltd           | AIP/operator material and the airport's public WebTrak link.                                                                                                       |
| Aviation report aggregation            | NATS Data Services                | CAP 746 says it collects transmitted METARs and assembles the predetermined aviation bulletins.                                                                    |
| Historical/model-data supplier          | Met Office / Air Quality Consultants | AQC says the Met Office prepared and sold its 2017–2021 LCY METAR-site series; AQC validated it and interpolated short gaps. This establishes hourly historical provenance, not a live API.                                     |
| Other historical model-data distributor | Atmospheric Dispersion Modelling Ltd | Its public map correctly distinguishes LCY `3768.3` from Bracknell `3763`; other reports name ADM as supplier of hourly model files. No raw LCY `.met` file or live interface was public.                                        |
| Official archive metadata               | Met Office / CEDA                 | MIDAS maps `EGLC` to source `18929`, but explicitly exposes no MIDAS Open data for the station.                                                                      |
| Dormant official catalogue               | Met Office WOW                    | Site `955386003` is exact official London City Airport metadata, but every sampled table is empty and the page says it is not reporting.                                                                                            |
| Public global relay                    | NOAA/NWS Aviation Weather Center  | Machine-readable worldwide METAR access; not the original UK sensor owner.                                                                                         |
| Airport-owner public display vendor    | Envirosuite/Bruel & Kjaer WebTrak | Public client linked by the airport; its weather response is a repackaged METAR, not a raw LCY sensor channel.                                                     |

The [current EGLC AIP entry](https://www.aurora.nats.co.uk/htmlAIP/Publications/2026-08-06-AIRAC/html/eAIP/EG-AD-2.EGLC-en-GB.html)
lists Met Office Heathrow as the associated office, `H24` Met Office support,
TAF/METAR material, and the London City automated ATIS telephone. The
[current GEN 3.5 section](https://www.aurora.nats.co.uk/htmlAIP/Publications/2026-08-06-AIRAC/html/eAIP/EG-GEN-3.5-en-GB.html)
lists `EGLC` as half-hourly `METAR ‡`, where `‡` means an AUTO METAR overseen
by a certificated observer during aerodrome opening hours. Its observing-hours
code is `HO+`: more than operational hours, but not a published `H24`
guarantee.

## Ranked candidate matrix

The first ranking is by usefulness for a trustworthy airport product, not by
raw update frequency alone.

| Rank | Candidate                                          | Identity                                                                 | Native/source cadence                                                     |                                                    Precision | Measured/publication behavior                                                                         | Permission                                                        | Decision                                                               |
| ---: | -------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | -----------------------------------------------------------: | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
|    1 | NATS/LCY raw electronic temperature                | `I3`; exact provider/system class, exact field/channel and asset unknown | Regulatory minimum once/minute; actual EGLC cadence unknown               | CAP 746 requires `0.1 °C` resolution and better than `±1 °C` accuracy; actual export unknown | External interface not found | Written provider + airport/data-owner scope required | **Target** for fastest true airport value; setup and approval required |
|    2 | NOAA `EGLC.TXT` / AWC METAR JSON                   | `I3` report identity; exact sensor asset unknown                         | All 335 seven-day intervals were exactly 30 minutes                       | `1 °C` report encoding | AWC median receipt about 4m20s after nominal observation; NOAA/AWC timestamp proxies and bounded client first-seen tests favor NOAA provisionally | Public machine access; obey published rate guidance | **Use now** as official baseline |
|    3 | EGLC local report / ATIS                           | `I3` operational airport product                                         | Half-hourly plus event-driven local specials; not a regular sensor stream |                               Normally report-style whole °C | AIP publishes voice/telephone only; no public API tested                                              | Automation, recording, retention, and reuse require written scope | Approval-gated experiment only                                         |
|    4 | WIS2 DWD GTS-to-WIS2                               | Official multi-station bulletin family; public notification metadata only | Event-driven notification; member bytes unavailable                       | No usable public value retrieved | Two bounded windows saw origin/recommended metadata only on subscribed topics; canonical objects returned 401 | Public broker metadata; OPMET bytes restricted to authorized aviation/met services | **Rejected** as public value source |
|    5 | SADIS / MAVIS / Direct Line                        | Same official report, not new measurement                                | Distribution/UI cadence only: SADIS batches and MAVIS polls every five minutes; underlying METAR is routine half-hourly/event-driven | Same whole-degree METAR | Faster distribution may help an approved user but cannot recreate logger samples | Account, eligibility, licence, and/or commercial terms | Approval-gated relay only |
|    6 | Airport-linked WebTrak weather XML                 | `I2` airport display artifact; upstream sensor not identified            | Wrapper generated on request; underlying observation remains half-hourly  | Whole °C | `052250Z` switch interval-censored to 83.1–98.7 s after AWC receipt; first observed new response was +98.7 s | Portal terms prohibit reuse absent written permission | **Rejected** as a slower wrapper |
|    7 | WebTrak TAFOR/anemometer subgraph                  | Shared client data flow; exact LCY station/sensor unobserved              | Client requests would use 120/600-second wind durations and 1800-second TAFOR duration; physical cadence unknown | Wind schema only; no temperature field | LCY config returned both client feature flags as `0`; client-disabled data operations were not called | Written LCY/WebTrak/data-owner scope plus exact-`true` gates | Approval-pending provenance lead; **not a temperature source** |
|    8 | Retired owner-linked TraVis (2013–2024 archive)    | `I2` LCY display; sibling payloads establish application family, not LCY sensor or exact upstream source | Client poll 10/11 s; LCY help says weather every 30 min | Decimal schema/display, but sibling whole-degree routine-report values became `.00` | LCY live mode delayed 60 min; no successful numeric LCY XML; five sibling XMLs aligned with routine reports | Personal/non-commercial; written LCY permission otherwise | **Rejected** delayed routine-report wrapper; retired and not fast |
|    9 | Nearby high-frequency personal/community sensors   | `I1`–`I3` for their own sites, not `EGLC`                                | Observed provider timestamp/update steps of 16 s, 1 min, 5 min, or intermittent; physical sampling often unknown | Often `0.1 °C` display resolution | Fresh values observed, but exposure/calibration/airport representativeness unresolved | Provider-specific terms and approvals | Context/diagnostics only |
|   10 | Met Office/AQC/CEDA historical LCY data            | `I3` station/report identity; exact current sensor unknown                | Hourly sequential model series; monthly/annual climatology                | Archive/product-dependent | AQC model series is 2017–2021; separate climate clarification claims 2018–2022; CEDA source `18929` has no MIDAS Open files | Commercial/restricted/archive-specific | Identity/provenance lead only; **rejected** for live temperature |
|   11 | Met Office WOW site `955386003`                    | Exact official, Met Office-owned LCY catalogue identity; no current sensor mapping | None observed                                                            |                                                     No value | “Not reporting,” null last observation and zero rows across sampled 2012–2026 dates; Northolt control worked | Public metadata; download disabled/no data                         | **Rejected** dormant identity record                                   |
|   12 | Met Office Land Observations API                   | `I0` for an authenticated DataHub EGLC mapping                            | Hourly product cadence; EGLC exposure and native sensor cadence unverified | Product-dependent | Documentation defines 24 standard slots/day; no authenticated DataHub station test performed | Subscription, API key, terms, attribution | Too slow; do not call it EGLC without provider confirmation |
|   13 | Met Office London City forecast page / Global Spot | Coordinate forecast, not sensor identity                                 | Hourly forecast                                                           |                                           Displayed whole °C | “Next hour” and hourly table are explicitly forecasts                                                 | Public page or keyed forecast API                                 | **Rejected** for live temperature                                      |

Any future claim of a “minute LCY feed” must satisfy all four conditions before
it can displace the public baseline:

1. an exact sensor/channel/field mapping to `EGLC`, not merely an airport name;
2. an observation timestamp that advances independently at about 60-second
   intervals or faster;
3. a decimal value shown to be native measurement precision rather than
   formatting, conversion or interpolation; and
4. a provider-documented public interface, or explicit owner authorization for
   the intended machine retrieval, retention and display.

None of the public candidates in this dossier passes all four.

## 1. Permissioned target: NATS/LCY native temperature

### What the regulator proves

[CAA CAP 746, version 6](https://www.caa.co.uk/publication/download/12602)
applies minimum standards to meteorological equipment at UK aerodromes that
produce METARs. The decisive requirements are:

- page 78, sections 7.54–7.59: temperature/dew-point sensors should be 1.25–2 m above earth or grass, away
  from buildings and artificial heat, and protected from radiation and water;
- page 78, section 7.56: accuracy must be better than `±1.0 °C` over the
  specified operating range;
- page 78, section 7.58: temperature and dew point must be measured at
  `0.1 °C` resolution;
- page 78, section 7.59: electronic temperature sensors must be sampled at
  least once per minute;
- sampled-data clocks must use UTC and be accurate within 15 seconds; and
- equipment providing dynamic information solely to the observer should be
  refreshed at least every five minutes.

The pages were rendered and visually checked, rather than relying only on PDF
text extraction. Page 51, sections 4.113–4.118 separately require the public
METAR dry-bulb/dew-point fields to be whole degrees and define the warmer-side
rounding rule. Page 84, section 8.7 specifies the UK half-hourly `:20`/`:50`
schedule; page 85, section 8.9 identifies collection by NATS Data Services;
page 88, section 9.14 gives the five-minute transmission windows.

A non-authoritative mirror of CAP 746 Issue 4 from March 2017 contains the same
temperature clauses at printed page 88/PDF page 90. The official Issue 6
revision history describes the July 2020 Issue 5 changes without identifying a
change to those clauses. This supports—but does not directly prove from an
official Issue 5 binary—that the once-per-minute/`0.1 °C` design rule applied
during the 2021 TraVis/remote-tower period.

The same document distinguishes the local operational product from the public
METAR. Local routine/special reports stay at the aerodrome; the public METAR is
the disseminated ICAO report. A local special temperature report is triggered
when air temperature changes by `2.0 °C` from the previous report. Local
specials therefore do not expose every native sample.

These requirements establish what a conforming EGLC system must measure and,
together with the current regulated meteorological service, make a
higher-resolution, higher-frequency internal value strongly expected. They do
**not** independently prove the behavior of the current LCY asset or establish:

- that the actual EGLC logger outputs once per minute rather than sampling once
  per minute into a slower product;
- an instantaneous versus averaged/filtering rule;
- the current sensor make, model, serial, calibration history, exact coordinate,
  or field ID;
- the data owner or a right to retain and republish it; or
- a supported external protocol.

### System-family evidence

The CAA 2026 audit plan names `London City (NATS (Services) Ltd)` as a
meteorological unit. Period records establish **SAMOS** at the site more
carefully than the current marketing page alone:

- the [NATS Holdings 2017 annual
  report](https://www.nats.aero/wp-content/uploads/2017/07/NATS6247_AnnualReport_2017-FULL.pdf),
  PDF page 31, and [NATS Services FY2016/17 statutory
  report](https://www.nats.aero/wp-content/uploads/2017/08/NATS-Services-Limited-FY1617_245497809.pdf),
  PDF page 9, list `Semi Automatic Meteorological Observation Systems at
  Manchester and London City` as an engineering milestone. The table places
  `August` in its 2017 column and `February` in its 2016 comparator column; it
  does not key either month to a named site. It therefore proves period/system-
  family activity but not an exact LCY installation date, and the milestone's
  sensor/core/gateway/UI/acceptance scope is not disclosed;
- the exact [2019 PAMS project-page
  archive](https://web.archive.org/web/20191016180123id_/https://pams.aero/london-city-airport-remote-tower-alarm-management.html)
  documents a Swanwick alarm server, 64 local digital inputs, 16 outputs to
  Saab SDATS, LCY remote I/O, workstations and generic SNMP, but contains no
  `SAMOS`, `IRVR` or temperature reference;
- [January 2021](https://web.archive.org/web/20210119094118id_/https://pams.aero/london-city-airport-remote-tower-alarm-management.html),
  April and September 2021 captures still contain none of those terms; and
- a [Tascomp/PAMS PDF created 4 January
  2022](https://www.approvedbusiness.co.uk/storage/brochures/46523-tascomp-ltd-pams-london-city-airport.pdf),
  pages 2–4, first identifies a local SAMOS digital input and an SNMP `SAMOS
Gateway`, along with FAT, pre-FAT, SAT, soak, training and support.

The 2022 document describes alarm states/closed contacts and SNMP equipment
alarms, not numeric weather values or cadence. It must not be backdated into
the 2019/2021 PAMS page, and the operational gateway must not be probed. The
[current PAMS case
study](https://pams.aero/london-city-airport-remote-tower-alarm-management/)
is retrospective and says NATS specified the system, the Swanwick and LCY sites
use private secure fibre, local digital inputs include `IRVR, SAMOS & UPS`, and
SNMP inputs include `SAMOS Gateway`. Its FAT, SAT, soak-test, training and
documentation claims concern the PAMS alarm-management delivery. Millisecond
alarm timestamps do not imply millisecond—or any numeric—weather transport.
No temperature field, MIB/OID, schema or measurement cadence is disclosed.
This chain establishes `I3` site/system-family evidence, not an `I4`/`I5`
temperature field or asset.

The generic [Tascomp Prodigy V9 user
guide](https://www.tascomp.com/images/Prodigy-V9-User-Guide.pdf) confirms that
the underlying platform is capable of polling I/O, recording real-time analog
values, defining temperature tags, exporting events and CSV, and interfacing
through OPC/Modbus. That prevents an over-broad claim that PAMS could never
carry a number. The LCY project evidence is narrower and decisive: its named
inputs are closed-contact digital states and SNMP alarm/status, with no numeric
temperature tag or export. The rejection is based on the disclosed LCY
configuration, not generic product incapability.

Contemporaneous [MM Aviation AeroMET/SAMOS
material](https://web.archive.org/web/20210306022214id_/https://www.mmaviation.com/samos/)
describes generic one- and two-temperature/humidity/pressure profiles, while
its [NATS UI award
page](https://web.archive.org/web/20210306024152id_/https://www.mmaviation.com/uncategorized/nats-new-samos-user-interface/)
names no LCY deployment and illustrates Manchester/Stansted. Product-family
capability cannot be assigned to London City's exact asset.

An archived [AeroMetRCR application
shell](https://web.archive.org/web/20240830091028id_/https://aerometrcr.mmaviation.com/)
adds only product lineage. Its hashed Angular/PWA bundles were not archived;
the recovered shell contains no LCY identifier, configuration, payload or API
route. It is not an authorization to probe an operational deployment.

The [London City owner announcement](https://www.londoncityairport.com/media-centre/press-releases/remote-digital-air-traffic-control-tower-operational)
and [NATS tower factsheet](https://www.nats.aero/wp-content/uploads/2024/08/TowersFactsheets2023.pdf)
document the remote-tower operation at Swanwick. Its presence likewise does
not imply that Saab owns the thermometer or offers the temperature externally.
Saab's period [remote-tower
description](https://www.saab.com/markets/india/stories/2017/transforming-air-traffic-management-through-remote-towers)
says “other sensors” transmit radar, meteorological and surface-movement data
and names LCY/NATS as a test installation. This is useful generic architecture
evidence, but it does not map London City's SAMOS field, protocol or sample
rate to Saab's system.

The CAA record that directly addresses the private data path is [CAP
1635](https://www.caa.co.uk/data-and-publications/publications/documents/content/cap1635/),
the February 2018 compendium of responses to the TANS call for evidence. The
previous dossier draft mislabeled its download as CAP 1605; actual [CAP
1605](https://www.caa.co.uk/publication/download/16264) is the November 2017
call for evidence itself. CAP 1635 physical page 31 records London City's
statement that the panoramic live feed plus **sensory and operational data**
are sent to Swanwick over secure fibre. Physical pages 42–43 record NATS's
position that another provider could take data from the relevant LCY services,
that assets were replicable/COTS and that access to data supported transition.
These are two useful but unjoined evidence strands: a private LCY-to-Swanwick
sensory/operational path, and a provider-transition statement about relevant
service data. CAP 1635 does not say the sensory feed—or temperature—is the
transferable data, identify a protocol, give cadence/precision, or authorize
public access.

### Procurement, commissioning and acceptance chronology

The public record supports a chronology, not a completed sensor inventory:

| Date                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                            | What it proves—and does not prove                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2007 records, published 2009             | [AAIB formal report 5/2009](https://assets.publishing.service.gov.uk/media/5422eb10e5274a1314000055/5-2009_EI-CZO.pdf), PDF p. 22 / printed p. 14                                                                                                                                                                                                                              | AAIB obtained two selected observations from the LCY SAMOS. This proves retained operational records, not native cadence or an external interface.                                                                                              |
| 19 Jan 2016                              | [TED 2016/S 012-017668](https://ted.europa.eu/en/notice/017668-2016/xml)                                                                                                                                                                                                                                                                                                              | LCY sought ATC services including maintenance/renewal of CNS assets for up to ten years plus a possible three-year extension. The XML includes technical-capacity requirements, but the detailed service requirement was reserved to the non-public ITT; no SAMOS/interface annex is public. |
| 2 Feb 2017                               | [TED 2017/S 023-040143, project A429-01](https://ted.europa.eu/en/notice/-/detail/40143-2017)                                                                                                                                                                                                                                                                                         | About £7m of physical digital-tower works: a 50 m tower supporting a separately supplied 16-camera module, base/data rooms, power/HVAC, substations and cabling. No preserved PQQ was found in Wayback, Arquivo.pt or bounded Common Crawl checks. The public notice is not the missing sensor/interface procurement record. |
| 2016/2017, exact LCY month unresolved    | NATS annual/statutory reports above                                                                                                                                                                                                                                                                                                                                                 | A combined Manchester/London City SAMOS milestone row has February in the 2016 comparator and August in 2017, without mapping a month to either site. Exact LCY components and acceptance state are absent.                                      |
| Nov 2017                                 | [CAA CAP 1605](https://www.caa.co.uk/publication/download/16264)                                                                                                                                                                                                                                                                                                                     | Public call for evidence; records LCY's planned move to remote provision and sector-level data-transfer issues. It is not the response compendium.                                                                                               |
| Feb–Apr 2018                             | [CAA CAP 1635](https://www.caa.co.uk/publication/download/16359), physical pp. 31 and 42–43; [CAP 1634](https://www.caa.co.uk/publication/download/16363), document pp. 20–23 and 37–38; and [CAP 1648](https://www.caa.co.uk/publication/download/16465), document pp. 20–24 and 39–41 | LCY had cancelled the competitive tender and renewed NATS Services for ten years. CAP 1635 separately documents secure-fibre sensory/operational transport and service-data transition; it does not connect temperature to the transferable data. |
| FY2017/18                                | [NATS Holdings 2018 annual report](https://www.nats.aero/wp-content/uploads/2018/08/NATS-Holdings-Ltd-2018.pdf), physical p. 46 / printed p. 45                                                                                                                                                                                                                                      | Records completion of Swanwick site-acceptance testing for LCY's digital-tower capability. The public report contains no SAT script, result, interface annex or MET field.                                                                      |
| Mar 2019                                 | [NATS Holdings 2019 annual report](https://www.nats.aero/wp-content/uploads/2019/06/NATS-Holdings-Limited-2019.pdf), physical p. 26 / printed p. 25                                                                                                                                                                                                                                  | Records a digital-tower factory-acceptance milestone and live images relayed to Swanwick. Exact-phrase searches found no public FAT pack; the milestone does not identify numeric weather.                                                       |
| 2019–2020                                | PAMS archive and construction records                                                                                                                                                                                                                                                                                                                                               | Alarm-management/remote I/O architecture and Swanwick facility build; no numeric met path.                                                                                                                                                      |
| 22 Jan 2021 / public announcement 30 Apr | [NATS commissioning account](https://att.mydigitalpublication.co.uk/articles/the-commissioning-of-london-city-airport-s-digital-tower-is-the-first-step-in-a-wider-transition-for-the-atc-sector) and [Saab announcement](https://www.saab.com/newsroom/press-releases/2021/saabs-technology-makes-london-city-airport-first-major-uk-operator-of-remote-air-traffic-control-tower) | Operational changeover/public launch chronology; not a weather API.                                                                                                                                                                             |
| 2021 CAA approval                        | [CAA submission of 6 October 2021](https://www.parliament.scot/chamber-and-committees/committees/current-and-previous-committees/session-6/session-6-citizen-participation-and-public-petitions-committee/correspondence/2021/pe1804_oo-civil-aviation-authority-submission-of-6-october-2021)                                                                                              | CAA says the full LCY virtual control room at Swanwick was approved after audit and safety assurance. This is system-level approval, not a public SAMOS interface or acceptance pack.                                                            |
| Aug 2021 policy                          | [CAA Remote Tower Policy V4](https://www.caa.co.uk/publication/download/17213), pp. 10–11, 20–21 and 25–26                                                                                                                                                                                                                                                                          | Remote meteorological service needs additional CAA approval, QMS/observing/reporting/dissemination review, contingencies, observer conversion and roughly six months of testing including winter. The LCY acceptance pack itself was not found. |
| Jan 2022                                 | Tascomp/PAMS PDF above                                                                                                                                                                                                                                                                                                                                                              | SAMOS alarm integration plus FAT/SAT/soak/support evidence; not a numeric sensor export.                                                                                                                                                        |
| 2026                                     | CAA audit plan, visually checked PDF page 3                                                                                                                                                                                                                                                                                                                                         | NATS Services remains the named LCY meteorological unit.                                                                                                                                                                                        |

A429-01's public PQQ link,
`https://public.huddle.com/a/rBVXWjx/index.html`, now returns only Ideagen's
“Page not available” shell. Exact-token Wayback, Arquivo.pt and bounded
Common Crawl checks found no preserved PQQ; the TED full-text query returns
only the original notice, not an award or corrigendum. [Bysteel](https://bysteel.pt/en/projects/london-city-digital-air-traffic-control-tower-1/)
and [Modulift](https://www.modulift.com/portfolio/city-lifting-and-modulift-raise-tower-at-london-airport/)
project pages independently name Buckingham Group Contracting and the physical
steel/lifting chain, but neither maps a meteorological system. Bysteel's camera
count/height also conflict with the official notice, so those marketing figures
are not reused here.

The absence of a standalone Newham digital-tower planning application is not an
unexplained search gap. The official appeal [Statement of Common
Ground](https://gat04-live-1517c8a4486c41609369c68f30c8-aa81074.divio-media.org/filer_public/b9/cc/b9cc2a8f-edc5-408d-9cf3-1f025a435593/cd111_agreed_statement_of_common_ground_between_the_appellant_and_lbn.pdf),
physical pages 3–4, says the tower was constructed in 2019, operational in
2021, and built under airport permitted-development rights in Part 8 Class F of
the 2015 GPDO. There was therefore no ordinary application attachment set from
which to recover the separately supplied system specification.

An archived [May 2021 NATS engineering
account](https://web.archive.org/web/20210517100029id_/https://nats.aero/blog/2021/05/making-london-citys-digital-tower-all-weather-ready/)
adds that teams combined camera recordings with weather logs, made simultaneous
observations with Met Office airport-MET auditors at the conventional and
digital towers, and obtained approval for meteorological and ATC service from
the digital tower. It still exposes no endpoint, field, equipment ID, cadence
or calibration record. The three full-size article images were also inspected;
they show tower views and consoles but no legible numeric weather field.

The CAA's current [ANSP change-management
process](https://www.caa.co.uk/commercial-industry/airspace/air-traffic-management-and-air-navigational-services/air-navigation-services/ansp-certification-and-designation/change-management-and-change-notification-process/)
identifies likely request classes: `SRG1430`, supporting
technical documents, “No Review” or reviewed approvals, and sampled safety-
assurance material for major changes. Its [oversight
process](https://www.caa.co.uk/commercial-industry/airspace/air-traffic-management-and-air-navigational-services/air-navigation-services/ongoing-oversight-of-training-organisations/)
says detailed Oversight Reports are made available to the auditee. Public
[2021](https://www.caa.co.uk/media/gpkle0fr/2021-yearly-audit-plan.pdf) through
2026 plans scheduled LCY/NATS entries; plans do not prove the audits occurred.
Current and frozen 2021 disclosure-log searches found no released LCY SAMOS/
digital-tower report. The vocabulary supports a targeted request but does not
prove that a specific historic LCY `SRG1430` or change pack exists.

Exact and full-text searches of TED's current ten-year search corpus, Find a
Tender and passively accessible Contracts Finder material covered `SAMOS`,
`RAMOS`, their expansions, `EGLC`, London City with meteorological/weather
terms, NATS with meteorological equipment and remote-aerodrome meteorology. No
LCY-specific meteorological award or annex was found. Nine old UK TED hits use
the generic Achilles category “IRVR Transmission meters,
AMOs/RAMOS/SAMOS/FAMOS,” but representative notices identify neither NATS nor
London City. TED returned eleven 2016–2018 notices for the exact LCY buyer; they
concerned terminal, construction, baggage or fencing work. Contracts Finder's
keyword request malfunctioned and its indexed results were negative, so no
database-wide absence claim is made.

The missing acceptance material is now a precise records request rather than
a generic search: LCY RAMOS approval/change notices; the combined 2016/2017
SAMOS milestone's exact LCY date and scope; equipment inventory/as-built
ownership; test scripts/results;
audit findings; current sensor identity, location and calibration; maintenance
and substitution history; and the sanctioned sensor-to-logger-to-observer/UI-
to-METAR/ATIS data lineage.

### Exact request to NATS and London City

Ask for a provider-issued, read-only export of the dry-bulb temperature used by
the `EGLC` observing system. The request should ask NATS/LCY to confirm:

1. endpoint and supported protocol (`HTTPS`, push/SWIM, SFTP, or another
   provider-selected interface);
2. station/channel/field ID and its mapping to `EGLC`;
   specifically confirm whether archive identities MIDAS `18929`, ISD
   `037683-99999`, ADM `3768.3` and historical code `50LC` refer to the same
   observing site and what, if anything, changed over time; explicitly reject
   or explain the erroneous consultant label `3763/EGLC`;
3. sensor coordinate, height, exposure, manufacturer/model, calibration and
   quality flags;
4. native sampling, filtering, averaging, display refresh, logger timestamp,
   and publication cadence;
5. whether the value is the same dry-bulb input used for METAR or a local-only
   sensor;
6. ownership, permitted application, polling, storage duration, derived use,
   public display/republication, attribution, commercial use, SLA and support;
7. outage, maintenance, substitution, stuck-value and clock behavior; and
8. a data dictionary plus sanctioned test fixture/sample.

Do not ask for workstation, SAMOS gateway, SNMP, remote-tower, or internal
network access. The desired deliverable is a supported, least-privilege data
export chosen by the provider.

Use the right channel for each part:

- the CAA's current [information-request
  route](https://www.caa.co.uk/about-us/request-information/how-to-request-information/)
  and the CAA Met Authority
  (`metauthority@caa.co.uk`) for record indexes or severable portions of RAMOS
  approval/change, audit and compliance records;
- a voluntary provider request to NATS for the live data lineage and supported
  export—[ICO decision
  FS50627910](https://ico.org.uk/media2/migrated/decision-notices/2013708/fs50627910.pdf),
  paragraph 4 records that, as of its 16 March 2017 decision, NATS was not a
  public authority for FOIA purposes; and
- the [airport-owner contact
  route](https://www.londoncityairport.com/at-the-airport/need-to-know/get-in-touch)
  for as-built ownership, site/asset/calibration records and permission scope.

MM Aviation and Tascomp/PAMS can clarify product/project history, but only the
authority, service provider and identified data owner can establish the
current certified asset and authorize access.

### Approval gate

A future raw collector must be disabled by default behind:

```text
NATS_LCY_RAW_MET_SENSOR_ACCESS_APPROVED
```

Only exact server-side Convex value `true` enables queueing or external access.
Credentials are separate. The approving scope must come from NATS Services,
London City Airport and any separately identified data owner as applicable,
and must cover the exact
endpoint, field, application and polling. If a future feature stores protected
raw values beyond a provider-approved transient window or displays/redistributes
them publicly, define and obtain separate exact-`true` capabilities rather
than letting access imply them:

```text
NATS_LCY_RAW_MET_SENSOR_RETENTION_APPROVED
NATS_LCY_RAW_MET_SENSOR_REPUBLICATION_APPROVED
```

Every cron, manual action, retry, HTTP route and worker must enforce the
applicable gates before queueing, at worker start and immediately before each
external request, storage operation or protected read/export. While disabled,
the UI must show `setup/approval required` and use the public METAR rather than
a fabricated decimal value.

Deploy with all three flags absent and verify the disabled production state.
Activation and removal, only after each applicable scope is documented, are:

```text
npx convex env set NATS_LCY_RAW_MET_SENSOR_ACCESS_APPROVED true --prod
npx convex env set NATS_LCY_RAW_MET_SENSOR_RETENTION_APPROVED true --prod
npx convex env set NATS_LCY_RAW_MET_SENSOR_REPUBLICATION_APPROVED true --prod
npx convex env remove NATS_LCY_RAW_MET_SENSOR_ACCESS_APPROVED --prod
npx convex env remove NATS_LCY_RAW_MET_SENSOR_RETENTION_APPROVED --prod
npx convex env remove NATS_LCY_RAW_MET_SENSOR_REPUBLICATION_APPROVED --prod
```

No London collector, schema, cron, route, credential or approval flag was
created during this investigation.

## 2. Public official baseline: EGLC METAR

### Endpoints

Structured AWC request:

```text
GET https://aviationweather.gov/api/data/metar
  ?ids=EGLC
  &format=json
  &hours=1
```

Single-station NOAA file:

```text
GET https://tgftp.nws.noaa.gov/data/observations/metar/stations/EGLC.TXT
```

Useful references:

- [AWC machine-to-machine API documentation](https://connect.aviationweather.gov/data/api/)
- [AWC human-readable EGLC report](https://aviationweather.gov/data/metar/?ids=EGLC)
- [NOAA decoded single-station file](https://tgftp.nws.noaa.gov/data/observations/metar/decoded/EGLC.TXT)

AWC requires a descriptive custom `User-Agent`, limits each endpoint/thread to
no more than one request per minute, rate-limits requests, and does not enable
CORS. Collection therefore belongs on the server. The response observed during
research advertised `Cache-Control: max-age=60`.

### What the temperature represents

The UK AIP says temperature is obtained from liquid-in-glass or electrical
resistance thermometers in a ventilated screen. CAP 746 says the METAR encodes
dry-bulb and dew-point temperature to the nearest whole Celsius degree, with
exact half values rounded toward the warmer temperature. The structured AWC
`temp` number must therefore not be displayed as decimal-precision data.

The NATS AIP publishes the routine observation frequency as half-hourly. CAP
746 says UK reports are normally observed at `:20` and `:50`, transmitted in
the following five-minute window, collected by NATS Data Services, assembled
into bulletins, and distributed through aviation channels. The EGLC bulletin
is `SAUK32 EGGY`.

### Measured seven-day cadence and AWC receipt delay

At `2026-08-05T23:30:10.872Z`, the larger bounded query used:

```text
GET https://aviationweather.gov/api/data/metar
  ?ids=EGLC
  &format=json
  &hours=168
```

It returned 336 unique observations covering
`2026-07-29T23:50:00Z` through `2026-08-05T23:20:00Z`.
The 134,744-byte UTF-8 JSON body hashed
`683792a78637861cf6a5612e7c3502b9e9ffec872907f8ee7f91f87165ad0e76`.

| Metric                                   |                    Observed result |
| ---------------------------------------- | ---------------------------------: |
| Rows / unique observation times          |                          336 / 336 |
| Observation minutes                      |         168 at `:20`; 168 at `:50` |
| Consecutive intervals                    | 335 of 335 were exactly 30 minutes |
| Raw `AUTO` reports                       |                         336 of 336 |
| `METAR` / `SPECI` / corrected reports    |                        336 / 0 / 0 |
| Temperatures with a fractional component |                                  0 |
| Minimum AWC `receiptTime - obsTime`      |              246.253 s (4m06.253s) |
| Median                                   |              260.390 s (4m20.390s) |
| 90th percentile, nearest-rank            |              273.871 s (4m33.871s) |
| 95th percentile, nearest-rank            |              281.118 s (4m41.118s) |
| Maximum                                  |              391.507 s (6m31.507s) |

This is a retrospective distribution of AWC's own `receiptTime`, not a client
`firstSeenAt` SLA. The sample's uninterrupted overnight coverage is
`observed`, but the AIP's `HO+` code means it must not be generalized into a
contractual H24 guarantee.

### Spot comparison: NOAA text versus AWC JSON

Three report transitions supplied a direct but small relay comparison:

| Observation | NOAA file `Last-Modified`    | AWC `receiptTime`          |                Difference |
| ----------- | ---------------------------- | -------------------------- | ------------------------: |
| `052150Z`   | about `2026-08-05T21:54:08Z` | `2026-08-05T21:54:14.703Z` |  NOAA about 6.7 s earlier |
| `052220Z`   | `2026-08-05T22:24:12Z`       | `2026-08-05T22:24:15.531Z` |  NOAA about 3.5 s earlier |
| `052250Z`   | `2026-08-05T22:54:15Z`       | `2026-08-05T22:54:27.695Z` | NOAA about 12.7 s earlier |

For the second sample, both carried:

```text
METAR EGLC 052220Z AUTO 27012KT 9999 NCD 19/10 Q1018
```

The NOAA file's HTTP write time is a relay-publication proxy, not a sensor
timestamp. Three samples are not enough for a latency SLA, but they justify
testing the text file as the fastest HTTP trigger while using AWC JSON for
structured validation/backfill.

### Live multi-relay rollover: `052250Z`

A bounded monitor around the next routine report compared immutable report
`EGLC 052250Z AUTO 25011KT 9999 NCD 18/09 Q1018` across the available relays.
The observation time was `2026-08-05T22:50:00Z`.

| Source/event                           | Relevant UTC time  | Lag after observation | Difference from NOAA first-seen |
| -------------------------------------- | ------------------ | --------------------: | ------------------------------: |
| NOAA file `Last-Modified`              | `22:54:15.000Z`    |             4m15.000s |                        -1.436 s |
| NOAA first completed retrieval         | `22:54:16.436Z`    |             4m16.436s |                        baseline |
| WIS2 DWD gateway `pubtime`             | `22:54:16.834788Z` |             4m16.835s |                        +0.399 s |
| WIS2 first-seen, NOAA global broker    | `22:54:17.892Z`    |             4m17.892s |                        +1.456 s |
| WIS2 first-seen, Météo-France broker   | `22:54:17.942Z`    |             4m17.942s |                        +1.506 s |
| AWC embedded `receiptTime`             | `22:54:27.695Z`    |             4m27.695s |                       +11.259 s |
| WebTrak first response with new report | `22:56:06.382Z`    |             6m06.382s |                      +1m49.946s |
| XCWeather first response with report   | `22:58:49.867Z`    |             8m49.867s |                      +4m33.431s |

This is one rollover, not a latency distribution. It nevertheless rejects the
idea that WIS2, WebTrak, or XCWeather was a faster **usable** public source for
this event. The WIS2 observation is especially important:

- public subscriptions succeeded on both [registered WIS2 global
  brokers](https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/wmo-information-system-wis/wis-20-global-services);
- the event arrived on
  `origin/a/wis2/de-dwd-gts-to-wis2/data/recommended/S/A/U/K/32/EGGY`, which
  matches the published `SAUK32 EGGY` bulletin identity;
- notification `96183b26-9120-11f1-ac23-9659593d1730` carried a bulletin/data
  reference datetime separately from gateway `pubtime`;
- its canonical DWD object URL ended in
  `A_SAUK32EGGY052250_C_EDZW_20260805225413_71922011`, but both ordinary and
  public-broker credentials received HTTP `401` with realm
  `Recommended Data - Restricted Access`; and
- a follow-up notification whose filename carried `RRA` arrived about 26
  seconds later. Its
  canonical object was also access-controlled. No corresponding JMA-gateway
  event was observed between `22:45:40Z` and `23:00:00Z`; that bounded absence
  is not evidence of a JMA outage.

The MQTT notification therefore exposes timely metadata, not the actual public
temperature payload. The DWD notification advertised canonical SHA-512
`CTAdfGRx1xPx9/5ZApQiTRbUa5sqrfJtGCwh7ggbxNzi2kEqxz76O9XEfx6unabMsXzOBVtdXIRoizwV/UIxRw==`,
but the bytes could not be retrieved or independently hashed. If DWD ever
authorizes the payload, a collector must use separate credentials and fail
closed behind exact server-side Convex flag
`DWD_WIS2_RECOMMENDED_GTS_ACCESS_APPROVED`. It is the same OPMET/METAR bulletin
family, but the exact member bytes were unverified. Seeking access remains
lower priority than the NATS/LCY raw-sensor request.

A second bounded WIS2 pass around `062350Z` reproduced the architecture rather
than changing the decision. The origin notification carried gateway
`pubtime=2026-08-06T23:54:10.740986Z` and was locally first seen at
`23:54:11.691757Z`; its `RRA` follow-up carried `pubtime=23:54:30.742929Z`
and was seen at `23:54:31.784767Z`. For the same report, NOAA advertised
`Last-Modified=23:54:08Z` and AWC embedded
`receiptTime=23:54:14.488Z`. During the stated bounded subscriptions, only the
registered `origin/.../data/recommended/S/A/U/K/32/EGGY` topic appeared; no
core/cache counterpart appeared on the subscribed brokers/topics, and both canonical objects again required HTTP Basic
credentials. Their embedded security descriptions limit OPMET/aviation access
to national meteorological/aeronautical services and identify `wis@dwd.de` as
the access contact; anonymous GETs returned `401` with the Basic-auth realm
`Recommended Data - Restricted Access`.

```text
https://wis2.dwd.de/recommended/gts/eggy/A_SAUK32EGGY062350_C_EDZW_20260806235409_72513654
https://wis2.dwd.de/recommended/gts/eggy/A_SAUK32EGGY062350RRA_C_EDZW_20260806235429_72513664
```

The main notification advertised 358 bytes and SHA-512/base64
`jgk09TzGIC/ykg41OsF8n+h3aGk6Ta4d/sUbQj1ytTmC1H2RqfF65DJ80Cw4vUcXRlyv9j+xNq69bFZ1vnh03A==`;
the RRA advertised 74 bytes and
`q2C9iaPmKQzvLqxUzhCx6SxaCBAyYj7kczaXu8RuKX7/7EjHpmdsgbATmX1AzjK/2iaJfFkpKhGknwGI2acJMg==`.
Because the objects were not authorized, those advertised digests could not be
verified against retrieved bytes.

That is expected behavior, not a cache outage. The official [WIS2
overview](https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/wmo-information-system-wis/wis2-overview)
says Global Caches copy freely available **core** data, while recommended data
must be fetched from the publisher and may be access-controlled. WMO's own
[recommended-dataset training](https://training.wis2box.wis.wmo.int/practical-sessions/datasets-with-access-control/)
uses METAR as the aviation example, states that aeronautical meteorology is
subject to usage restrictions, and explicitly says Global Caches do not cache
recommended data. A faster public cache object therefore cannot be expected
for this bulletin. WIS2 is useful for near-real-time arrival metadata, but it
does not currently provide anonymously retrievable EGLC report bytes.

### Timestamp trap

Use `obsTime`, or parse the raw `DDHHMMZ` group, for the measurement/report
time. AWC can normalize `reportTime` for a `:50` observation to the next hour.
For example, the raw `052150Z` report had observation time `21:50Z` but
`reportTime=22:00Z`. Treating `reportTime` as the observation time would move
the point ten minutes into the future and falsely improve computed latency.

Store independently:

```text
observationTime
providerReceiptTime
httpLastModified
requestStartedAt
responseCompletedAt
firstSeenAt
rawReport
rawHash
```

### OpenAPI contract and observed schema drift

The official [AWC OpenAPI
file](https://connect.aviationweather.gov/data/schema/openapi.yaml) was retrieved
at `2026-08-05T23:34:21.930Z`. The 87,776-byte response had ETag
`"6a6be38d-156e0"`, `Last-Modified: Thu, 30 Jul 2026 23:51:41 GMT`, and SHA-256
`d7a6f291187d57c5d4d8a4d59277115a4eecfe79afcec37d97548031fbf0c25c`.
Its METAR schema documents:

- `obsTime` as the Unix observation time;
- `receiptTime` as when the observation was received;
- `reportTime` as report time;
- `temp` as numeric degrees Celsius; and
- raw report, coordinates and elevation as separate properties.

The current JSON also contained `qcField=2`, but `qcField` is absent from the
OpenAPI METAR properties and is documented elsewhere for aircraft reports.
That value is therefore preserved as opaque schema drift; no quality meaning
is inferred. Likewise, a generic decimal schema example does not restore
precision discarded by the raw UK whole-degree METAR.

### Public collector recommendation

If implementation is requested later:

- poll one source no faster than once per minute with a descriptive user agent;
- deduplicate by `EGLC + observationTime + rawReport` and handle corrections as
  new versions;
- parse and compare the latest `rawOb`; do not treat a response ETag/body hash
  as an observation ID, because AWC's one-hour result window changes when an
  older row ages out even though the latest report is unchanged;
- validate ICAO, raw time, unit, plausible temperature range and staleness;
- preserve the immutable application `firstSeenAt`;
- treat NOAA text and AWC as two relays of one observation, not two sensors;
- show whole degrees and label the series `EGLC METAR`;
- use conditional requests/backoff and a shared cooldown for cron/manual work;
- never interpolate a “live” value between reports; and
- retain source attribution and raw provenance.

The AWC API is explicitly intended for machine access, so no special project
approval flag is proposed for compliant AWC use. The same conclusion does not
authorize aggressive polling of the NOAA text directory.

## 3. Local reports and ATIS

The current EGLC AIP publishes:

```text
CITY INFORMATION (voice ATIS): 136.355 MHz
Automated recording telephone: +44 (0)207-511 6055
```

CAA guidance says ATIS may be updated more often when weather changes. UK local
special reports also exist during observing service and are made without delay
when defined thresholds are crossed; for temperature the threshold in CAP 746
is a `2.0 °C` change from the last report. Those local reports are intended for
the ATS provider and aerodrome users, not automatically disseminated as public
SPECI reports.

ATIS may therefore beat the next routine METAR during a material change, but it
is not a continuous numeric one-minute source. No documented public ATIS API
was found, and no telephone call, radio capture, recording or transcription was
performed.

A future bounded automation experiment requires a positive exact-`true` gate:

```text
NATS_LCY_ATIS_AUTOMATION_APPROVED
```

Written scope must cover automated calling or authorized audio/data delivery,
recording, transcription, retention, derived temperature, display and
republication. A provider-issued D-ATIS or structured local-report feed is
preferable to telephone scraping. Removal of the gate must stop calls and
queued retries immediately.

## 4. Airport-owner WebTrak: a timestamp trap, not a faster sensor

### Discovery chain

The route was discovered only through owner-linked public pages:

1. [London City Airport flight-track and monitoring page](https://www.londoncityairport.com/corporate/environment/noise-management-and-monitoring/flight-track-and-monitoring-system)
2. `https://webtrak.emsbk.com/lcy`
3. redirect to `https://eu.webtrak.aero/lcy`
4. public client configuration for site `lcy`
5. client-constructed weather request:

```text
GET https://webtrak-server-eu.emsbk.com/WebTrak/lcy/weather
```

The public configuration identifies London City Airport, `LCY`,
`Europe/London`, coordinates near the airport, and visible fields
`time,temperature,pressure,humidity,dewpoint,visibility`. No account was
required. This is a valid owner-published display path, but its weather-source
lineage is not documented.

A bounded current owner-surface check requested `robots.txt`, `sitemap.xml`,
`sitemap-index.xml`, `/.well-known/assetlinks.json`, `manifest.json` and
`service-worker.js`. Each scripted request received the same `403` HTML/no-store
response. That records a client-access boundary; it does not prove those files
or unlisted routes are absent. The owner-linked page and WebTrak browser client
therefore remain the reproducible discovery chain.

### 2026-08-08 build-graph and lazy-route reconstruction

A cold load of `https://eu.webtrak.aero/lcy` was recorded in an isolated
browser context at the browser/DevTools level. The entry document was 22,606
bytes with SHA-256
`a4c80da2b39ed4f60f8bca5abc06c12bf86cc3e20bc4737093f3aa0104879753`.
The normal site-list response selected this exact row:

```text
site_name=lcy
server_name=webtrak-server-eu.emsbk.com
location_name=London City Airport
latitude=51.504844
longitude=0.049518
status=Public
source_location=null
require_valid_user=No
```

`Public` and `No` are technical access/configuration facts, not permission to
copy, retain, poll or republish the data. `source_location=null` makes LCY use
the default client tree. `git.version.json` identified WebTrak `6.0.33`, with a
release timestamp of `2026-04-01T10:27:00Z`.

The application is a legacy RequireJS/AMD plus AngularJS single-page client,
not a Next.js, Vite or webpack route-chunk build. Its default
`static/app/scripts/main.js?6.0.33` sets `baseUrl: scripts`; the cold runtime
loaded 99 first-party JavaScript files as individually named controllers,
models, providers, views and libraries. `/lcy` selects the site, while feature
navigation is implemented by tabs and ten explicit HTML partial/template
requests—eight core layout partials plus flight and noise-monitor popups—rather
than client routes. The loaded graph contained no
`sourceMappingURL`, source map, build manifest, import map, `modulepreload`,
prefetch link, web manifest or service-worker registration. That is a bounded
negative over the entry document and its observed/imported graph, not a claim
that no unreferenced file exists. The explicit playback worker implements only
timer start/stop messages.

The graph did expose a new, coherent TAFOR/anemometer subgraph:

```text
GET https://eu.webtrak.aero/api/tafor/lcy/getConfig
GET https://eu.webtrak.aero/api/tafor/lcy/stations/
GET https://eu.webtrak.aero/api/tafor/lcy/getWind/{duration}/{minEpoch}/{maxEpoch}
GET https://eu.webtrak.aero/api/tafor/lcy/getString/{duration}/{minEpoch}/{maxEpoch}
```

These are not grammar guesses. `configs/appConfig.js` constructs the paths;
`providers/DataSource.js` carries them to concrete GET call sites; and
`controllers/CompassManager.js`, `models/windCompass.js` and
`views/flightBoardLayer.js` consume their expected fields. The client asks for
wind duration values `120` and `600` and a TAFOR-string duration value `1800`.
Those parameters and comments describe client requests/aggregates; they do not
prove physical sample cadence.

The ordinary LCY boot requested `getConfig` twice. Both 262-byte responses were
identical, SHA-256
`a869ad7bda0d7ce127424addd1d61e57df096c098d1a6f788bf7772cbca15712`,
and returned:

```text
weather/anemometers/enable=0
weather/anemometers/visibleAtStart=1
weather/anemometers/colourmap=""
weather/tafor/enable=0
weather/tafor/visibleAtStart=0
```

The client therefore made no request to `stations`, `getWind` or `getString`.
Those client-disabled operations were not manually called. Static data flow shows the
wind consumer uses `config_weather_station_id`, `data_time`,
`wind_speed_meters_per_second`, `wind_direction_degrees` and
`wind_speed_max_meters_per_second`. The station consumer expects
`local_sensor_id`, name, description and WGS84 coordinates. The TAFOR board
expects `data_time` plus `raw_data`. No temperature, dew-point, humidity or
pressure field appears in this subgraph. It could become a sensor-lineage clue
after authorization, but it is not evidence of an LCY temperature channel.

The browser graph also reconstructed flight, noise, message, layer, complaint,
rainfall and reference-data operations. They are outside the temperature goal
and were not validated merely because their templates appeared in shared
client code. In particular, no sibling site was selected or queried.

### WebTrak approval boundary

The owner site's terms place third-party links under the third party's terms;
an airport-owner link is not a reuse licence. WebTrak's displayed March 2023
terms limit use to personal/non-commercial use and restrict copying,
publication, derivatives and redistribution. Public/no-login reachability and
a working request therefore do not establish production rights.

The user reports that approval for further WebTrak validation was requested on
2026-08-08, but no recipient, written scope or grant is recorded. No WebTrak
collector, cron, queue, worker,
schema, UI, API route, credential or Convex environment value was added or set.
Any future implementation must fail closed behind these separate server-side
Convex flags:

```text
LCY_WEBTRAK_ACCESS_APPROVED
LCY_WEBTRAK_WEATHER_ACCESS_APPROVED
LCY_WEBTRAK_TAFOR_ANEMOMETER_ACCESS_APPROVED
LCY_WEBTRAK_ARTIFACT_RETENTION_APPROVED
LCY_WEBTRAK_REPUBLICATION_APPROVED
```

Only the exact value `true` counts. The first flag covers automated access to
the WebTrak client/data surface. It is conjunctive with the relevant
operation-specific flag: the second separately covers the known weather
wrapper, and the third covers validation or use of the client-disabled
TAFOR/anemometer operations. The fourth covers retaining raw responses or
client artifacts beyond a transient sanctioned test, and the fifth covers
UI/API/export or other republication. Credentials, reachability and one
capability flag cannot substitute for another. The approving scope
must come in writing from London City Airport and the WebTrak/data rightsholder
they identify, and cover the exact operations, request rate, retention,
derivative analysis and republication intended.

Every future protected manual action, HTTP route, cron/job, retry and worker
must check `LCY_WEBTRAK_ACCESS_APPROVED` before queueing and immediately before
each external request. Weather operations must additionally check
`LCY_WEBTRAK_WEATHER_ACCESS_APPROVED`; TAFOR, station and wind operations must
additionally check `LCY_WEBTRAK_TAFOR_ANEMOMETER_ACCESS_APPROVED`. Storage must
also check the retention flag, and every protected read, display or export must
also check the republication flag. Revocation must disable queued work as well
as new work. Deploy with all flags absent; while disabled, show
`approval required` and do not substitute or fabricate data.

For each capability actually covered by recorded written approval, the
activation/removal commands are:

```text
npx convex env set LCY_WEBTRAK_ACCESS_APPROVED true --prod
npx convex env set LCY_WEBTRAK_WEATHER_ACCESS_APPROVED true --prod
npx convex env set LCY_WEBTRAK_TAFOR_ANEMOMETER_ACCESS_APPROVED true --prod
npx convex env set LCY_WEBTRAK_ARTIFACT_RETENTION_APPROVED true --prod
npx convex env set LCY_WEBTRAK_REPUBLICATION_APPROVED true --prod
npx convex env remove LCY_WEBTRAK_ACCESS_APPROVED --prod
npx convex env remove LCY_WEBTRAK_WEATHER_ACCESS_APPROVED --prod
npx convex env remove LCY_WEBTRAK_TAFOR_ANEMOMETER_ACCESS_APPROVED --prod
npx convex env remove LCY_WEBTRAK_ARTIFACT_RETENTION_APPROVED --prod
npx convex env remove LCY_WEBTRAK_REPUBLICATION_APPROVED --prod
```

### Live evidence

At `2026-08-05T22:27:41Z`, the XML response contained, in part:

```xml
<weather generated-at="Wed Aug  5 23:27:42 2026">
  <report id="38339"
    observation_time="2026-08-05 23:20:00"
    temp_c="19"
    dewpoint_c="10"
    wind_degrees="270"
    pressure_in="30.06" />
</weather>
```

BST was UTC+1 on the research date, so its local `23:20` observation maps to
the same `22:20Z` `EGLC` report shown above. The response also pointed to a
`weather.gov` icon and reproduced the METAR-derived wind, temperature, dew
point, visibility and pressure.

Two requests four seconds apart then showed:

| Request UTC     | `generated-at` local | Report ID | Observation local | Temperature |
| --------------- | -------------------- | --------: | ----------------- | ----------: |
| `22:33:38.696Z` | `23:33:39`           |     38339 | `23:20:00`        |       19 °C |
| `22:33:42.596Z` | `23:33:43`           |     38339 | `23:20:00`        |       19 °C |

`generated-at` is the wrapper-generation time, not observation freshness. The
report ID and embedded observation stayed fixed. WebTrak is therefore
`rejected` for the fastest-temperature role: it adds a wrapper and ambiguous
local timestamps without adding samples or precision. Its direct endpoint
should not be production-polled: the portal terms prohibit copying,
distribution, and commercial reuse absent written permission, and there is no
reason to pursue that permission while the documented NOAA interface provides
the same report.

A second rollover confirmed the inference. The `052250Z` report had AWC
`receiptTime=22:54:27.695Z`; WebTrak still served the previous report at
`22:55:50.799Z` and first served new report ID `38340` at `22:56:06.382Z`.
The switch was interval-censored to 83.104–98.687 seconds after AWC receipt;
the first observed new response was `+98.687 s`. Relative to the NOAA file's
`Last-Modified`, the interval was 1m51–2m06. The client polls the weather widget
every two minutes, but that UI timer is not source cadence.

XCWeather provided a final third-party control. Its home page first returned
the exact `052250Z` raw report at `22:58:49.867Z`, 4m22.172s after AWC receipt;
the response SHA-256 was
`a46689e8a5e177a51cb34ba556d945ce37d938207f7c59a3dbdd51c304d85247`.
The probe also encountered repeated resets/timeouts. More decisively, the
[XCWeather FAQ](https://www.xcweather.co.uk/Info/FAQ) says observation maps
update every 30 minutes and asks users not to take its data. It is slower,
less reliable in this probe, and unavailable for production reuse without a
new written licence.

### Mobile, PWA and image branches

The 2021 airport-owner and TraVis archives exposed no official App Store,
Google Play, APK/IPA, PWA manifest, service worker, WebSocket, EventSource or
source-map lead. The only package found in the checked searches whose
historical notes mentioned LCY weather was [Android
`com.horseboxsoftware.LCY`](https://play.google.com/store/apps/details?id=com.horseboxsoftware.LCY)
/ [iOS app `1099560800`](https://apps.apple.com/app/id1099560800). Its listings
explicitly say it is not official or endorsed, and no exact 2021 APK was
recovered from the repositories searched. It cannot identify a London City
sensor, cadence or endpoint and was rejected without installing an unrelated
newer binary.

Official LCY/NATS/Saab image searches and archived tower imagery were also
checked. They document the 50 m mast, cameras, controllers and the fact that
weather readings may be presented, but no screenshot exposes a legible field
identifier, timestamped decimal series, hostname or physical temperature
sensor label. With no archived TraVis-generated XML, OCR cannot validate even
a historic value. Images add operational context, not a faster source.

## 5. Official Met Office products

### Public London City page: forecast, not observation

The [London City Airport weather page](https://weather.metoffice.gov.uk/forecast/u10j124jp)
labels its main table **“7 day forecast”** and **“Hourly forecast”**. Its
explanation says an hourly symbol represents the conditions expected during
that hour. The `Next hour` temperature is therefore a forecast value.

The page's `Last 3 days weather` link currently resolves to:

```text
https://weather.metoffice.gov.uk/observations/u10j124jp
```

That destination is titled **“East Malling (Kent) last 24 hours weather.”** A
haversine calculation from the published page coordinate (`51.283, 0.45`) to
the EGLC reference point is about 36.9 km. This link cannot be used to establish
an EGLC observation or sensor lineage.

### Met Office WOW: exact LCY identity, zero observations

The ultra-deep pass found an exact official catalogue record that ordinary web
search had missed. WOW's public [site-search
API](https://wow.metoffice.gov.uk/api/sites/search?text=London%20City%20Airport)
returns one exact result, site `955386003`. The [site
JSON](https://wow.metoffice.gov.uk/api/sites/955386003) identifies **London
City Airport** at `51.5048, 0.058`, elevation `5 m`, organization `Met Office`,
reason `Met Office Owned Site`, and marks it official. Dry-bulb temperature is
listed among the possible measurements.

It is not a live source. The [observation/detail
page](https://wow.metoffice.gov.uk/observations/details/?site_id=955386003)
says **“This site is not reporting observations”**, sets download false, and
the JSON has `lastObservationDate: null` and no last-modified observation. The
site JSON's generic catalogue flags `isActive: true` and `allowDownload: true`
do not override that observation state: the rendered page sets its observation
download flag false, the dates are null and the sampled tables are empty. The
underlying public table request was reproduced directly:

```text
GET https://wow.metoffice.gov.uk/observations/details/tableviewdata/
    955386003/details/<date>
    ?startAt=0&hours=23:59:59&firstDate=<date>&lastDate=<date>
    &fields=DryBulbTemperature&timezone=UTC
```

Samples in 2012, 2014, 2016–2026—including the exact 2 March 2021 archive
target—each returned `Observations: []` and `TotalPageCount: 0`. The 2 March
2021 response was 150,360 bytes with SHA-256
`26ae15cf620474fdcedf8eb970072175a5d919003c82efdf601b3c0674110673`.
This was not an endpoint or authentication failure: the same request structure
returned 24 hourly rows for official Northolt on a one-day control, and 715
rows for its November 2025 control window. A nearby unofficial WOW station also
returned decimal five-minute rows, demonstrating that the endpoint can carry
faster decimals when a site actually reports; it is not airport truth and is
not proposed as a source.

Wayback returned zero captures for the exact ID or its API URL. A broader
inventory contained 1,101 unique WOW detail URLs from 2016 through July 2026,
none for `955386003`. No evidence found supports “historic rows exist but the
current UI hides them”; the record was dormant on every public surface checked.
This does not prove that no observation ever existed on an unsampled date. The
[WOW home page](https://wow.metoffice.gov.uk/home) also
states that retirement of DataPoint stopped Met Office automated-station
observations flowing into WOW; [DataPoint retired on 1 December
2025](https://www.metoffice.gov.uk/services/data/datapoint/datapoint-retirement-faqs),
with Weather DataHub Land Observations offered as a non-like-for-like
replacement.

`955386003` must not be promoted to a current sensor, DCNN identity or proof of
historic output. It is valuable solely because it confirms that the exact
airport received an official WOW catalogue record. The evidence rejects WOW as
a demonstrated current or recoverable historical public LCY value source; it
does not establish that the catalogue record never emitted any observation.

The Met Office's current [UK synoptic and climate station
list](https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-synoptic-and-climate-stations)
lists Heathrow, Northolt and other London-area sites but not London City. Its
own note says some sites are omitted when not operating or when run for a
specific customer requirement, so the omission is consistent with the WOW
result but is not independent proof that no operational airport sensor exists.

### Weather DataHub Land Observations

The [official Land Observations overview](https://datahub.metoffice.gov.uk/docs/g/category/observations/overview)
describes actual automated ground measurements from about 150 UK locations.
Standard observing times are hourly from `00:00` through `23:00 UTC`, or 24
observations per day. The API requires a subscription and `apikey` header.
The public OpenAPI exposes nearest-site and 48-hour geohash retrieval and uses
floating-point observation fields. Float transport is a schema capability, not
evidence that an EGLC row exists or that its source retains native tenths.

CEDA now supplies an exact **archive** mapping—MIDAS `src_id 18929`, station
code `ICAO EGLC`—but CEDA also says this station has no MIDAS Open data. That
mapping does not prove that Weather DataHub exposes the station, uses the same
identifier or returns the same current sensor.

No account or key was created for this research. The nearest-station response
needs an authenticated check, and its documented identifier must be confirmed
by the Met Office before any row can be called `EGLC`. The public forecast
page's East Malling history makes it especially unsafe to assume that the
nearest public Land Observations series is the airport sensor.

HadISD independently confirms the historical identity but is not a DataHub or
live alternative. Its [project page](https://www.metoffice.gov.uk/hadobs/hadisd/)
marks `3.4.3.2025f` as the final version after ISD append updates stopped in
August 2025; London City's historical `037683-99999.nc.gz` ends on 24 August
2025. It is licensed historical research data, not a current relay.

The originally cited 360-calls/day Site-Specific allowance belongs to a
**forecast** product. The current [Land Observations pricing
page](https://datahub.metoffice.gov.uk/pricing/observations) independently also
advertises a free plan of up to 360 calls/day. That affects cost, not cadence:
the [observation specification](https://datahub.metoffice.gov.uk/docs/g/category/observations/overview)
still says hourly updates and 24 standard times, so polling every four minutes
normally repeats the same hourly product until a new or revised observation
appears. It says nothing about native sensor sampling.

Any future DataHub integration must accept the applicable subscription terms,
attribution and raw-redistribution limits, prove the station mapping, and be
disabled behind an exact-`true` server-side gate such as:

```text
METOFFICE_DATAHUB_LAND_OBSERVATIONS_ACCESS_APPROVED
```

### Aviation portals and commercial distribution

- **[MAVIS](https://www.metoffice.gov.uk/services/transport/aviation/regulated/mavis):**
  the Met Office's operational aviation browser portal displays
  METAR/TAF and other aviation products. The public update log says the UI
  polls for fresh data every five minutes. It requires sign-up and offers no
  documented public data API. UI polling does not create new observations.
- **[SADIS API](https://www.metoffice.gov.uk/services/transport/aviation/regulated/international-aviation/sadis/sadis-api):**
  offers TAC/IWXXM OPMET, including METAR/SPECI, and publishes
  received data in five-minute batches with 36-hour retention. Registration,
  licence acceptance and SADIS-manager onboarding are required; eligibility
  and permitted use are restricted to aviation purposes. It is still the same
  whole-degree report.
- **[Direct Line](https://www.metoffice.gov.uk/services/transport/aviation/commercial/aviation-data-services/direct-line):**
  the Met Office commercial route for OPMET TAC, including
  METAR, for users outside regulated SADIS criteria or requiring a backup.
  Public material gives no EGLC-specific latency SLA.

These paths could shorten or stabilize report distribution for an approved
aviation user, but none exposes the required/regulatory minute-resolution
temperature channel. A
SADIS collector would require `METOFFICE_SADIS_OPMET_ACCESS_APPROVED`, separate
credentials, and exact licence scope. MAVIS browser-session automation was not
attempted and is not proposed.

## 6. Nearby high-frequency thermometers

These sources answer “what is a recent temperature near the airport?” They do
not answer “what does the London City airport thermometer read?” The series
must remain visibly separate.

### Docklands Sailing and Watersports Centre / ThingSpeak

The [centre's own weather page](https://www.dswc.org/livecam_weather/) says its
on-site air-temperature probe reads every five minutes. It links public
ThingSpeak channel `547822`:

```text
GET https://api.thingspeak.com/channels/547822/feeds.json?results=5
GET https://api.thingspeak.com/channels/547822/feeds/last.json
```

Channel metadata identifies `Docklands London Air Temperature Monitor`, a
`Digital Air Temperature Probe with 5 Minute Logging`, at
`51.4942, -0.024253`. That is about 5.62 km west of the EGLC reference point.

Five consecutive rows observed at `22:03:06`, `22:08:05`, `22:13:05`,
`22:18:05`, and `22:23:06Z` were separated by 299–301 seconds and carried raw
values in `0.0625 °C` steps. A bounded rollover then saw entry `602455`:

```text
created_at = 2026-08-05T22:28:07Z
first response containing it = 2026-08-05T22:28:07.802Z
field1 = 17.93750
```

The 0.802-second difference is provider timestamp to first client sighting,
not proven physical sensor latency. The owner page says its public display uses
60-minute averages rounded to `0.1 °C`, while the raw channel exposes the
five-minute uploads. Exact sensor model, shield/exposure, calibration and reuse
rights remain unknown. This is useful local context only.

### Seven-day agreement test: DSWC is not an airport substitute

The comparison method was fixed before computing the statistics:

- official series: all 336 `AUTO` EGLC reports in the seven-day AWC sample;
- context series: DSWC ThingSpeak channel `547822`, `field1`, explicitly a
  different site and unknown sensor;
- physical-time diagnostic: nearest DSWC provider timestamp within `±180 s` of
  the nominal METAR observation; this symmetric offline diagnostic may choose a
  later point and therefore must never be used for live selection;
- no-look-ahead availability proxy: last DSWC provider timestamp no later than
  AWC `receiptTime`, with a maximum age of 600 seconds;
- reject missing/non-numeric/out-of-range values, require at least 300 pairs,
  define difference as `DSWC - EGLC`, and report both `±0.5 °C` and `±1 °C`
  bands because METAR is whole-degree encoded. Historical ThingSpeak
  `created_at` timestamps do not prove that each row was publicly retrievable
  by that instant; only one live transition had measured first-seen availability.

The DSWC query, retrieved at `2026-08-05T23:31:03Z`, returned 1,857 feeds from
`2026-07-29T23:30:51Z` through `2026-08-05T23:28:17Z`. Its 195,337-byte JSON
body hashed
`e6df739f8fb5d88882eb4ee29337f3fc0a4c259676d3412cea1dce50072fa2cd`.
Provider timestamp intervals had a minimum of 293 seconds, median 301 seconds
and maximum 6,970 seconds; 1,134 were 299–301 seconds, 107 gaps exceeded 360
seconds, and about 154 five-minute slots were missing by
`sum(max(0, round(interval/300) - 1))`. There were no duplicate timestamps or
invalid temperatures.

| Metric                      | Nearest to METAR time | Latest provider timestamp by AWC receipt (availability proxy) |
| --------------------------- | --------------------: | -------------------------------------------------------------: |
| Valid pairs                 |                   306 |                             328 |
| Mean bias                   |          `+0.9992 °C` |                    `+0.9489 °C` |
| Mean absolute error         |           `1.5237 °C` |                     `1.5038 °C` |
| RMSE                        |           `2.3882 °C` |                     `2.3373 °C` |
| Pearson correlation         |              `0.8741` |                        `0.8769` |
| Within `±0.5 °C`            |              `38.56%` |                        `39.02%` |
| Within `±1.0 °C`            |              `59.80%` |                        `57.01%` |
| Maximum absolute difference |           `8.6875 °C` |                     `8.6875 °C` |

For nearest-time pairs, DSWC alignment ranged from 163 seconds before to 154
seconds after the METAR clock, with conventional median `+12 s` and
nearest-rank 95th percentile `+134 s`.
For no-look-ahead proxy pairs, the provider-timestamp age at AWC receipt ranged from 0.171 to
578.090 seconds, with median 158.736 seconds and nearest-rank 95th percentile
408.548 seconds. The worst positive differences occurred around daytime
heating.

The correlation shows that both sites experience the same broad weather; the
large bias, errors and occasional `8.7 °C` separation show why correlation is
not provenance. The five-minute DSWC series is useful context but is unsafe as
airport truth, outage backfill or a training label for invented decimal EGLC
values.

### Other nearby stations

The bounded search found several faster non-airport sources. Their identity,
cadence, and permission limits are summarized here and linked below.

| Source                                      | Approx. distance | Observed timestamp/freshness behavior                                   | Limitation                                                                            |
| ------------------------------------------- | ---------------: | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Weather Underground `ILONDO1011` (Woolwich) |          1.89 km | Observation timestamps advanced exactly 16 s; samples were 8–25 s old   | Anonymous home PWS; unknown siting/calibration; provider key and written scope needed |
| Netatmo station `70:ee:50:14:7b:28`         |          1.22 km | Intermittent in this probe; successive timestamps were 10m15s apart     | Opt-in consumer module; exact outdoor siting/calibration and reuse scope unresolved   |
| WeatherLink LSEC Greenwich                  |          2.28 km | Exact 60 s timestamp steps; first-seen age no more than 15.6 s          | Public map is integer °F; supported access to another station needs provider setup    |
| WeatherLink Greenwich Yacht Club            |          2.75 km | Exact 60 s timestamp steps; first-seen age no more than 8.1 s           | Riverside Vantage Vue; not airport instrumentation; reuse scope unresolved            |
| LGfL Bow weather station `ID78`             |          6.29 km | Exact 60 s timestamps; first seen about 2 s after embedded time         | School/community network; free data is documented for non-commercial use only         |
| Tom's Weather Services, Upton Park          |          6.61 km | Client file regenerated every 5 s; embedded time advanced every 10–13 s | Owner-run Davis VP2 Plus/FARS; separate urban site and no reuse licence found         |

The very fast `ILONDO1011` series is tempting precisely because it is close.
It still fails the identity and quality gates: a home gateway and decimal
display do not establish airport exposure, calibration, maintenance, or the
temperature used by NATS. It may be shown only as an explicitly named nearby
diagnostic after provider authorization; it must not drive the official card.

### Nearby-source endpoint and permission records

- **Weather Underground:** the [public `ILONDO1011`
  dashboard](https://www.wunderground.com/dashboard/pws/ILONDO1011) identified
  an Ecowitt `GW2000A` gateway, which is not the outdoor sensor model. A bounded
  four-sample sequence had observation ages `24.8`, `15.2`, `11.6`, and
  `7.9 s`. The supported [PWS current-conditions
  API](https://developer.weather.com/docs/openapi/pws-observations-current-conditions-2-0/get-v2-pws-observations-current-by-stationid)
  requires a provider-issued key. The browser's key must not be reused;
  production commercial use or redistribution requires the applicable written
  [TWC agreement](https://weather.com/en-US/privacy/terms-of-use) and an
  approval gate.
- **WeatherLink:** the public map exposed exact station paths for [LSEC
  Greenwich](https://www.weatherlink.com/map/data/station/7c07a86b-2de2-463e-8fe0-75ac02dab456)
  and [Greenwich Yacht
  Club](https://www.weatherlink.com/map/data/station/b13acc3e-56d8-4762-8086-202be7cec540).
  The latter's [owner-configured
  display](https://www.weatherlink.com/embeddablePage/show/733efac978e64479ba1794851d305bb5/slim)
  identifies a Vantage Vue connected wirelessly by IP. The [WeatherLink v2 API
  documentation](https://weatherlink.github.io/v2-api/) says supported access
  to a public station requires a Pro/Pro+ subscription applied to that station.
  Do not automate the undocumented map path; obtain supported access and reuse
  scope first.
- **Netatmo:** the source is discoverable on the [opt-in public
  Weathermap](https://weathermap.netatmo.com/), but the bounded samples became
  more than eight minutes stale. The [documented public-data
  API](https://dev.netatmo.com/apidocumentation/weather#getpublicdata) requires
  an issued key, and its [published legal terms](https://dev.netatmo.com/legal)
  restrict unapproved commercial use. It is not a speed leader in this sample.
- **Tom's Weather Services:** the [owner's equipment and exposure
  page](https://www.tomsweatherservices.co.uk/live/about.php) documents a Davis
  Vantage Pro2 Plus with fan-aspirated radiation shield; the public
  [`customclientraw.txt`](https://www.tomsweatherservices.co.uk/live/customclientraw.txt)
  changed quickly. No reuse licence was found, so owner permission is required.
- **LGfL Bow:** the [network sensor
  page](https://weather.lgfl.org.uk/sensors.aspx) documents a shielded Davis
  system class, but not Bow's exact asset. [Published access
  terms](https://weather.lgfl.org.uk/get_a_login.aspx?src=h) permit the live data
  for non-commercial use; a public commercial product needs separate approval.

Each protected nearby integration should use its own positive exact-`true`
Convex approval flag. Approval for one provider must never authorize another.

### Nearby official-network negative checks

- The Air Quality England airport monitors [KGV House
  `LCA01`](https://www.airqualityengland.co.uk/site/latest?site_id=LCA01) and
  [Newham Dockside
  `LCA02`](https://www.airqualityengland.co.uk/site/latest?site_id=LCA02) are
  about 0.30 and 0.49 km from the reference point. Their public fields are
  pollutants, not dry-bulb air temperature.
- The Environment Agency flood-monitoring station search with a 10 km radius
  and `parameter=temperature` returned no station.
- Nearby Weather Underground pages `ILONDON1479` and `ILONDO363` were offline
  during the research window. An offline name containing “London City Airport”
  is not evidence of airport ownership or siting.

## Endpoint records

### Retired LCY TraVis weather helper

```text
sourceName: London City Airport owner-linked TraVis weather display
discoveryMethod: 2021 airport-owner Wayback page -> 2013/2021 Topsonic client and helper captures -> sibling generated XML
ownerPage: https://web.archive.org/web/20210227064200id_/https://www.londoncityairport.com/corporate/Environment/Track-aircraft
exactUrlOrInterface: https://travislcy.topsonic.aero/getWeatherData.php?session=<random>&time=<selected-epoch>, then /xmlSessionData/weather<session>.xml
stationParameters: path/client bound to LCY; exact upstream sensor/station unknown
authentication: none was visible in archived client; endpoint is retired
method: two sequential GETs from browser client
requestHeaders: historic browser request; random cache-buster on XML
responseType: generated XML; LCY no-parameter error survived, but no numeric LCY response; sibling numeric XML survived
redirectPolicy: historic exact Topsonic host only
documentedRate: 2013/2021 client helper every 10/11 s; LCY help says weather every 30 min
measuredRate: no LCY payload; five sibling payloads aligned with routine :20/:50 reports and formatted whole temperatures as .00; LCY live timeline delayed 60 min
termsOrApproval: personal/non-commercial; written LCY permission for broader use
researchDate: 2026-08-07
decision: rejected; retired/NXDOMAIN, delayed routine-report product, no native decimal evidence or exact upstream mapping
```

### AWC EGLC METAR

```text
sourceName: NOAA/NWS Aviation Weather Center EGLC METAR
discoveryMethod: documented AWC API and ICAO station query
ownerPage: https://connect.aviationweather.gov/data/api/
exactUrlOrInterface: https://aviationweather.gov/api/data/metar?ids=EGLC&format=json&hours=1
stationParameters: ids=EGLC
authentication: none
method: GET
requestHeaders: descriptive User-Agent
responseType: application/json
redirectPolicy: HTTPS only; allow documented aviationweather.gov host
documentedRate: no endpoint/thread faster than once/minute; 100 requests/minute global limit
measuredRate: max-age=60 response; all 335 source intervals exactly 30 minutes in seven-day sample
termsOrApproval: documented public machine service; no special project gate proposed
researchDate: 2026-08-05
decision: production baseline
```

### NOAA station text

```text
sourceName: NOAA tgftp EGLC single-station text
discoveryMethod: linked NOAA public METAR directory
ownerPage: https://tgftp.nws.noaa.gov/data/observations/metar/stations/
exactUrlOrInterface: https://tgftp.nws.noaa.gov/data/observations/metar/stations/EGLC.TXT
stationParameters: path-bound EGLC
authentication: none
method: GET, preferably conditional
requestHeaders: descriptive User-Agent
responseType: text/plain
redirectPolicy: exact HTTPS origin/path
documentedRate: not found; use conservative one-minute shared cooldown
measuredRate: same half-hourly report; no-cache/private response; 3.5–12.7 s ahead of AWC in three samples
termsOrApproval: public NOAA/NWS file; no special project gate proposed
researchDate: 2026-08-05
decision: fastest public trigger candidate; AWC remains structured validation/backfill
```

### WIS2 DWD GTS notification

```text
sourceName: DWD GTS-to-WIS2 notification for SAUK32 EGGY
discoveryMethod: AIP bulletin identity -> WMO global-broker registry -> bounded MQTT subscription
ownerPage: https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/wmo-information-system-wis/wis-20-global-services
exactUrlOrInterface: mqtts://wis2broker.globaldata.nws.noaa.gov:8883 and mqtts://globalbroker.meteo.fr:8883; topic origin/a/wis2/de-dwd-gts-to-wis2/data/recommended/S/A/U/K/32/EGGY
canonicalObject: https://wis2.dwd.de/recommended/gts/eggy/A_SAUK32EGGY052250_C_EDZW_20260805225413_71922011
stationParameters: AIP maps EGLC to multi-station bulletin SAUK32 EGGY; WNM is bulletin-level metadata and member bytes were unavailable
authentication: public broker subscription succeeded; canonical DWD object requires separate credentials
method: MQTT QoS 1 notification, followed by provider canonical HTTPS GET
requestHeaders: provider-approved authorization only for canonical object
responseType: WIS2 notification JSON; canonical aviation bulletin unavailable in test
redirectPolicy: exact WMO-registered broker and notification-advertised DWD HTTPS origin only
documentedRate: event-driven
measuredRate: two bounded windows; first WNM seen 1.456–1.506 s after NOAA client first-seen, second WNM pubtime 2.796 s before AWC receipt; no core/cache counterpart appeared on subscribed topics
termsOrApproval: public metadata only; DWD payload access requires written scope and exact-true gate
researchDate: 2026-08-07
decision: rejected as deployable public value source; optional relay diagnostic only
```

### LCY WebTrak weather

```text
sourceName: London City Airport-linked WebTrak weather
discoveryMethod: airport owner page -> WebTrak redirect -> public client config/code
ownerPage: https://www.londoncityairport.com/corporate/environment/noise-management-and-monitoring/flight-track-and-monitoring-system
exactUrlOrInterface: https://webtrak-server-eu.emsbk.com/WebTrak/lcy/weather
stationParameters: path-bound site lcy
authentication: none in public client
method: GET
requestHeaders: ordinary browser/client request
responseType: application/xml
redirectPolicy: only owner-linked WebTrak/Envirosuite hosts
documentedRate: client weather widget runs every two minutes; no direct-endpoint allowance found
measuredRate: request-time wrapper around half-hourly METAR; 052250Z switch interval-censored to 83.104–98.687 s after AWC receipt, first observed new response +98.687 s
termsOrApproval: rendered portal terms restrict non-personal reuse; written LCY/provider approval plus conjunctive LCY_WEBTRAK_ACCESS_APPROVED and LCY_WEBTRAK_WEATHER_ACCESS_APPROVED would be required
researchDate: 2026-08-05
decision: rejected as a slower, restricted temperature source
```

### LCY WebTrak build graph and client-disabled TAFOR/anemometer operations

```text
sourceName: London City Airport-linked WebTrak client graph
discoveryMethod: isolated cold browser load -> RequireJS runtime graph -> backward data-flow from GET sinks -> LCY live feature config
ownerPage: https://www.londoncityairport.com/corporate/environment/noise-management-and-monitoring/flight-track-and-monitoring-system
exactUrlOrInterface: https://eu.webtrak.aero/lcy plus observed same-origin https://eu.webtrak.aero/api/tafor/lcy/getConfig; same-origin stations/getWind/getString templates were not called
stationParameters: disabled client expects local_sensor_id, station name/description and WGS84 coordinates; no LCY station response obtained
authentication: LCY site row says Public / require_valid_user=No; this is not reuse approval
method: GET for entry/assets/config; client-disabled data operations not requested
requestHeaders: ordinary isolated-browser requests
responseType: HTML, JavaScript and JSON config
redirectPolicy: airport-owner link -> WebTrak redirect -> exact LCY client and directly loaded origins; no sibling site selected
documentedRate: client templates use wind duration parameters 120 and 600, TAFOR duration 1800, and a 60-second reload lockout; none proves sensor cadence
measuredRate: not measured; LCY config returned weather/anemometers/enable=0 and weather/tafor/enable=0 twice
termsOrApproval: user reports approval requested, but no grant/scope is recorded; conjunctive LCY_WEBTRAK_ACCESS_APPROVED and LCY_WEBTRAK_TAFOR_ANEMOMETER_ACCESS_APPROVED required for further operation access, with separate retention/republication flags
researchDate: 2026-08-08
decision: strongly supported client-disabled wind/TAFOR interface family; wind-only consumer schema; not a temperature source and not validated while approval is pending
```

### DSWC ThingSpeak channel

```text
sourceName: Docklands London Air Temperature Monitor
discoveryMethod: DSWC owner page -> linked ThingSpeak channel
ownerPage: https://www.dswc.org/livecam_weather/
exactUrlOrInterface: https://api.thingspeak.com/channels/547822/feeds.json
stationParameters: channel 547822, field1
authentication: none for public channel
method: GET
requestHeaders: descriptive User-Agent
responseType: application/json
redirectPolicy: exact api.thingspeak.com HTTPS origin
documentedRate: owner says five-minute readings
measuredRate: 299–301 s row intervals; one transition first seen 0.802 s after provider created_at
termsOrApproval: display is public; production API reuse/republication scope unresolved
researchDate: 2026-08-05
decision: nearby context only, never EGLC
```

### CEDA MIDAS station record (metadata only)

```text
sourceName: CEDA / Met Office MIDAS station catalogue
discoveryMethod: planning-document station language -> CEDA station search -> exact ICAO crosswalk
exactUrlOrInterface: https://utils.ceda.ac.uk/cgi-bin/midas_stations/station_details.cgi.py?id=18929&db=midas_stations
stationParameters: src_id 18929; station code ICAO EGLC
authentication: none for metadata page; full MIDAS data have separate restricted access
method: GET
responseType: text/html
documentedRate: static catalogue; observing-practice remark says 06Z-20Z HOURLY
measuredRate: not applicable; page contains no observation values
termsOrApproval: page is public; no MIDAS Open files exist for this station
researchDate: 2026-08-06
decision: retain as exact archive/report identity metadata; reject as a live source
```

### Met Office WOW LCY record (metadata only)

```text
sourceName: Met Office Weather Observations Website, London City Airport
discoveryMethod: exact WOW public site search -> site JSON -> detail/table endpoint -> control-site comparison
exactUrlOrInterface: https://wow.metoffice.gov.uk/api/sites/955386003 and /observations/details/tableviewdata/955386003/details/<date>
stationParameters: site_id 955386003; 51.5048, 0.058; elevation 5 m; Met Office-owned and official
authentication: none for metadata and table reads tested
method: GET
responseType: JSON/HTML
documentedRate: site record lists dry-bulb capability but no reporting cadence
measuredRate: zero LCY rows across sampled 2012–2026 dates; official Northolt control returned hourly rows
termsOrApproval: public metadata; detail page disables download; no observation data available
researchDate: 2026-08-07
decision: exact dormant catalogue identity only; reject as current or historical value source
```

## Artifact manifest

Hashes for text/JSON/XML samples below are SHA-256 over the UTF-8 body returned
to the research client. PDF/HTML document hashes are over raw response bytes.
No downloaded artifact is committed to the repository. The 2026-08-08 WebTrak
client bodies were held only in a transient local capture for bounded analysis,
hashed, and deleted after the findings were recorded; no raw bundle or response
body was retained in the project.

| Artifact                                                                                                                                                       | Retrieved UTC              | Status/type |     Bytes | Last-Modified / ETag                                | SHA-256                                                            | Purpose                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------- | --------: | --------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| [CAA CAP 746](https://www.caa.co.uk/publication/download/12602)                                                                                                | `2026-08-05T22:36:36.973Z` | 200 PDF     | 1,673,344 | not supplied                                        | `c7ab1282b1364136448514603c59d42869658764723b85d7a18315fe7cdd6388` | Sensor resolution, sampling, siting, dissemination rules |
| [CAP 746 Issue 4 mirror](https://www.shipmotion.eu/files/CAP%20746%20March%202017.pdf)                                                                         | `2026-08-05`               | 200 PDF     | 1,565,114 | PDF created `2017-03-20`                            | `bb722480a40a53830e4b827acf0338f4246ca5bb59e68f0cd27c4f7d16718704` | Period rule continuity; non-authoritative mirror         |
| [CAA 2026 ANSP audit plan](https://www.caa.co.uk/media/op2pubzs/2026-yearly-audit-plan.pdf)                                                                    | `2026-08-05T22:36:58.660Z` | 200 PDF     |    84,277 | not supplied                                        | `ca27f3e53ff3f16a75b81bf9bc42f5fe807e80719730033acdc6a2b29ed1d9d2` | NATS Services identity at London City                    |
| [CAA Remote Tower Policy V4](https://www.caa.co.uk/publication/download/17213)                                                                                 | `2026-08-05`               | 200 PDF     |   328,030 | PDF created `2021-08-17`                            | `0f7ddc926ce4692a36eafdd71fa8aa9516878ee6cb14d44555236fc0a1c9bfed` | Remote-MET acceptance requirements                       |
| [CAA CAP 1635](https://www.caa.co.uk/publication/download/16359)                                                                                               | `2026-08-05`               | 200 PDF     | 3,481,159 | version date `2018-02-15`                           | `ae950d7fb9bf5dc7db61261be89bba5317f08a166baa2438bbc6c3432f0eed4d` | Private LCY sensory-data path and transferability        |
| [CAA CAP 1605](https://www.caa.co.uk/publication/download/16264)                                                                                               | `2026-08-07`               | 200 PDF     |   320,119 | November 2017                                       | `b9064c406df5f44a85d88885228836660a5402c46b1dda7a3461ec76dd9b2557` | Actual call for TANS evidence; corrects prior label       |
| [CAA CAP 1648](https://www.caa.co.uk/publication/download/16465)                                                                                               | `2026-08-05`               | 200 PDF     |   811,292 | not supplied                                        | `b2c7e197ce83bf1600617f8db457224aea6dea7e84e67ac217c06fa714950017` | Pre-tender cancellation and NATS renegotiation           |
| [NATS Holdings annual report 2017](https://www.nats.aero/wp-content/uploads/2017/07/NATS6247_AnnualReport_2017-FULL.pdf)                                       | `2026-08-05`               | 200 PDF     | 9,563,248 | report year 2017                                    | `1f9846a8e27e9e2bd5976fb448bb751f7a6cb2ffa868e9267742db8b2a8411f0` | LCY/Manchester SAMOS milestone                           |
| [NATS Services FY2016/17](https://www.nats.aero/wp-content/uploads/2017/08/NATS-Services-Limited-FY1617_245497809.pdf)                                         | `2026-08-05`               | 200 PDF     |   453,757 | report year 2017                                    | `96c817b142502830901bdc1179a2e2107328ceb8189243af1740eafe88669f55` | Duplicate statutory milestone evidence                   |
| [Archived LCY owner Track-aircraft page](https://web.archive.org/web/20210227064200id_/https://www.londoncityairport.com/corporate/Environment/Track-aircraft) | `2026-08-05`               | 200 HTML    |   568,514 | capture `2021-02-27T06:42:00Z`                      | `c8c084bc136d7df070670d0d2082e73afbb000ae6ba1326c1ed4def95b37d447` | First-party TraVis link                                  |
| [Archived LCY TraVis root](https://web.archive.org/web/20210122115100id_/https://travislcy.topsonic.aero/)                                                     | `2026-08-05`               | 200 HTML    |   305,507 | capture `2021-01-22T11:51:00Z`                      | `9fbfcfcea7c53f62e6cbf04731aee70c9053694bfe4dbfbd6620ac13faaf1c20` | Client flow, 30-minute cadence, 60-minute delay          |
| [Archived 2013 LCY TraVis root](https://web.archive.org/web/20131207014408id_/http://travislcy.topsonic.aero:80/)                                             | `2026-08-07`               | 200 HTML    |   261,141 | capture `2013-12-07T01:44:08Z`                      | `1bc2f31cf2a1e09597c2f66b4697d5a95eefc624263495e5c5d4ff92c87268dc` | Integer-time helper contract and ten-second timer        |
| [Archived 2013 LCY helper error](https://web.archive.org/web/20131208131012id_/http://travislcy.topsonic.aero:80/getWeatherData.php)                           | `2026-08-07`               | 200 HTML    |       227 | capture `2013-12-08T13:10:12Z`                      | `3511181f4a0f3529355d02b768daacf11a61adfa4b659f9a04891d21cd677990` | Direct LCY server/helper existence; no numeric value     |
| [Archived Luton TraVis generated XML](https://web.archive.org/web/20180228000853id_/http://travisltn.topsonic.aero/xmlSessionData/weather1234406207279.xml?r=0.012519945959245105) | `2026-08-07` | 200 XML | 344 | capture `2018-02-28T00:08:53Z` | `f4f2b870ffdf3740b6ce3bb15b0e4b4a646dd408294a3cf03038d4d77c9c9010` | Sibling proof that whole METAR values became decimals    |
| [Archived Hamburg TraVis generated XML](https://web.archive.org/web/20220619211506id_/https://travisham.topsonic.aero/xmlSessionData/weather230536774140.xml?r=0.12545141221644385) | `2026-08-07` | 200 XML | 376 | capture `2022-06-19T21:15:06Z` | `6eda41cace1f09509ba818cbd6382921582e6d716fbf8e97e8ae36e08df209b8` | Cross-deployment routine-report alignment                |
| [Archived Stuttgart TraVis generated XML](https://web.archive.org/web/20200726180916id_/https://travisstr.topsonic.aero/xmlSessionData/weather1003035212605.xml?r=0.07083227386040947) | `2026-08-07` | 200 XML | 349 | capture `2020-07-26T18:09:16Z` | `7f751b1059fb946fd76bfb63712eb43dd2876e26a3f17bb0eae2c0fa96f96d47` | Third-deployment routine-report alignment                |
| [Archived LCY top-level `weather.xml`](https://web.archive.org/web/20131208125541id_/http://travislcy.topsonic.aero:80/weather.xml) | `2026-08-07` | 404 HTML | 282 | capture `2013-12-08T12:55:41Z` | `4d749cbdbcf108656e514cd10afb0e886df300607e493abd543755a92c1f35d1` | Preserves negative response, not a weather payload       |
| Owner 2021 collapsed CDX inventory                                                                                                                             | `2026-08-05T23:15:15Z`     | 200 JSON    |   147,146 | 942 records plus JSON header                        | `2e50f99eadc7e29f2d1b31d776ee9decfdfec35ccea7d503f1d08445e9bff886` | Historical surface inventory                             |
| TraVis 2018–2024 collapsed CDX inventory                                                                                                                       | `2026-08-05T23:19:18Z`     | 200 JSON    |    27,412 | 189 URL keys                                        | `7e1d4a2956616a4a5133708d946241e2276baef6a73303553c5d7a8b311ed212` | Static/dynamic archive boundary                          |
| [Archived 2019 PAMS LCY page](https://web.archive.org/web/20191016180123id_/https://pams.aero/london-city-airport-remote-tower-alarm-management.html)          | `2026-08-05`               | 200 HTML    |    47,185 | capture `2019-10-16T18:01:23Z`                      | `486ffebdd61d38980bec0829cc5633fc73f48a33283bc9afdd4eeb68ac77b90b` | Period-correct alarm architecture                        |
| [Archived 2021 PAMS LCY page](https://web.archive.org/web/20210119094118id_/https://pams.aero/london-city-airport-remote-tower-alarm-management.html)          | `2026-08-05`               | 200 HTML    |    46,707 | capture `2021-01-19T09:41:18Z`                      | `3b3feaf858955a2f4195734df37e4c9692dcb7093c97c1dddc4295497bf3432f` | Proves SAMOS/temperature labels absent in 2021 page      |
| [Tascomp/PAMS LCY case PDF](https://www.approvedbusiness.co.uk/storage/brochures/46523-tascomp-ltd-pams-london-city-airport.pdf)                               | `2026-08-05`               | 200 PDF     |   545,445 | PDF created/modified `2022-01-04T16:12:21Z`         | `750a9662780fe1fc5b2125fedc366fdbd6e3c4501cf6ef00e57236a6712bdabc` | First dated SAMOS alarm-gateway label                    |
| [Current PAMS LCY case study](https://pams.aero/london-city-airport-remote-tower-alarm-management/)                                                           | `2026-08-06`               | 200 HTML    |    83,106 | page supplies no publication date                   | `e19fc0a290a0d8c5b54f269c1eb3355af48abcce7b8e44df1fe0356d65a2a78e` | Current alarm architecture, FAT/SAT and SAMOS Gateway    |
| [TED 2016/S 012-017668 XML](https://ted.europa.eu/en/notice/017668-2016/xml)                                                                                     | `2026-08-06`               | 200 XML     |    13,833 | published `2016-01-19`                              | `ed697bdbc1979ab9cc6a61588b70d6f848048cc6b526c8dd58b1035963ce553e` | Public ATC tender scope; non-public technical ITT        |
| [TED 2017/S 023-040143, A429-01](https://ted.europa.eu/en/notice/40143-2017/pdf)                                                                                | `2026-08-07`               | 200 PDF     |   126,600 | published `2017-02-02`                              | `88119808262102f0a2d339081894021e7306abade802a8804ee266d9fbf0ee19` | Physical tower/base works; system module separate        |
| [LCY/Newham Statement of Common Ground](https://gat04-live-1517c8a4486c41609369c68f30c8-aa81074.divio-media.org/filer_public/b9/cc/b9cc2a8f-edc5-408d-9cf3-1f025a435593/cd111_agreed_statement_of_common_ground_between_the_appellant_and_lbn.pdf) | `2026-08-07` | 200 PDF | 684,889 | not supplied | `6d10cbd54e8aa9e29c8063bf16db9a3ab94386ad5e3c368c2a3d91d03d877ec7` | Explains permitted-development planning boundary         |
| [NATS Holdings annual report 2018](https://www.nats.aero/wp-content/uploads/2018/08/NATS-Holdings-Ltd-2018.pdf)                                                 | `2026-08-07`               | 200 PDF     | 1,024,469 | report year 2018                                    | `ae537d7ebbd0544bab3b34b4108effa55c5a318f48f8677e6beb58c88aebc079` | Exact Swanwick site-acceptance milestone                 |
| [NATS Holdings annual report 2019](https://www.nats.aero/wp-content/uploads/2019/06/NATS-Holdings-Limited-2019.pdf)                                             | `2026-08-07`               | 200 PDF     | 1,498,729 | report year 2019                                    | `4982690ff49a3caadef946585c091fce87a052551a53df425e325e6d4d39e34a` | Exact FAT/live-image milestone                           |
| [CAA CAP 1634](https://www.caa.co.uk/publication/download/16363)                                                                                                | `2026-08-06`               | 200 PDF     |   793,914 | February 2018                                       | `8a6782c0aec4d0d0bea49a2d8743b21cb6951587ab4f6855417e0b1acab31582` | Tender outcome, ownership and data-transition evidence  |
| [AAIB report 5/2009, EI-CZO](https://assets.publishing.service.gov.uk/media/5422eb10e5274a1314000055/5-2009_EI-CZO.pdf)                                     | `2026-08-06`               | 200 PDF     | 1,389,466 | report `5/2009`                                     | `481dd3ba755eb195df9039a55771b81ef09596c3a07031e46047bbc1a460b6c3` | Historical extraction of LCY SAMOS records              |
| [Newham documents tab, archived 7 Mar 2023](https://web.archive.org/web/20230307195713id_/https://pa.newham.gov.uk/online-applications/applicationDetails.do?activeTab=documents&keyVal=RNYU92JY5NA00) | `2026-08-06` | 200 HTML | 176,116 | capture `2023-03-07T19:57:13Z` | `28d830bcc40cb8bd5ff524d6002fb15110d951fadb22a17a9309d3fb1aa6ecbf` | Complete 209-row planning-document register             |
| [Newham 2019 Annual Status Summary Report](https://www.newham.gov.uk/downloads/file/1415/assr-public-2019)                                                     | `2026-08-07`               | 200 PDF     | 12,921,901 | not supplied                                        | `391461a73aaa4a18f6753689d5696327fd94a36b5deec1243b6e49e0b273dc8a` | First-party link to LCY AQC pollution portal             |
| [Archived AQC `CAH` site](https://web.archive.org/web/20210302230340id_/https://lcy.aqconsultants.co.uk/sites/CAH)                                             | `2026-08-07`               | 200 HTML    |    25,655 | capture `2021-03-02T23:03:40Z`                      | `55bb64ea2023651980f715da82fdb9eb0f6b1ddf91075ad8fe698800114289d7` | Pollutant-only route/field evidence                      |
| [Archived AQC `KGV` site](https://web.archive.org/web/20210302230458id_/https://lcy.aqconsultants.co.uk/sites/KGV)                                             | `2026-08-07`               | 200 HTML    |    22,921 | capture `2021-03-02T23:04:58Z`                      | `30ca718c286fc6047f0ff75480d35f85132b3caa228cfe007ac06af4e5a44d0a` | Pollutant-only route/field evidence                      |
| [Archived AQC `ND` site](https://web.archive.org/web/20210303002550id_/https://lcy.aqconsultants.co.uk/sites/ND)                                               | `2026-08-07`               | 200 HTML    |    24,393 | capture `2021-03-03T00:25:50Z`                      | `5563a53bd5101b64bdd96c1c4302e1a984534255ed85c8ae70bc61253952aa84` | Pollutant-only route/field evidence                      |
| Newham 22/03045/VAR attachment CDX inventory                                                                                                                   | `2026-08-06`               | 200 JSON    |    47,608 | 213 unique attachment URLs                          | `c73e2b5fcdd872373d8c4b1fa5c8eb056b32512aaf252476ec6fd0c5dc5abb49` | Attachment formats and archive-payload boundary         |
| [Applicant submission-document page](https://feature-corporate-footer.lcy-airport.pages.dev/corporate/corporate-info/future-airport-and-planning/submission-documents) | `2026-08-06`           | 200 HTML    |   674,719 | 98 embedded original-submission PDF URLs            | `7f0c71e72597d562cb56f88745a26740c413dcc01f7ddd8521fe7e77e689ebac` | Applicant-hosted planning-attachment inventory          |
| [Appendix 9.3, Detailed Modelling Methodology](https://assets.ctfassets.net/lmkdg513arga/1n8LJjhXzOcH1hQsdJMbHX/944663d43318e85128ee049c392e3694/CADP1_S73_ES_Vol_2_Appendix_9.3_Detailed_modelling_methodology.pdf) | `2026-08-06` | 200 PDF | 1,783,131 | no embedded attachments | `cc323798019d527b9d1b62f330cf1437f4cdbda3cc76ab57edc8bb05b8bc4ba7` | Proves hourly sequential 2017–2021 airport data         |
| [Chapter 11, Climate Change](https://assets.ctfassets.net/lmkdg513arga/6T2dpnsOoP8Bj5tevLw2DT/5f343657e2bc01748d0fb83aa05c4785/CADP1_S73_ES_Vol_1_Ch_11_Climate_Change.pdf) | `2026-08-06` | 200 PDF | 1,515,704 | no embedded attachments | `e226a9de2056a5c4af0c54cfc0c3caa1731be844bf13898189657bb1d7e8b398` | Verifies Table 11-32 discrepancy                        |
| [LUC final ES review, CD4.5.10](https://gat04-live-1517c8a4486c41609369c68f30c8-aa81074.divio-media.org/filer_public/47/fc/47fc8f15-9eee-4f2b-a120-da55e4fbedbc/cd4510_review_of_the_environmental_statement_for_london_city_airport_final_review_report_by_luc.pdf) | `2026-08-06` | 200 PDF | 7,791,983 | PDF modified `2023-06-20` | `27ef7ee241fb229161d942f05bb552a6dd364ab0a940ee515c4f31e2b684dbc4` | AQC source/provenance, climate summary and file dispute |
| [CEDA MIDAS source 18929](https://utils.ceda.ac.uk/cgi-bin/midas_stations/station_details.cgi.py?id=18929&db=midas_stations)                                        | `2026-08-06`               | 200 HTML    |     9,164 | station marked current; no MIDAS Open data          | `a6e7dfdf33ffc964470bb459fbb25bdf3858d5ad18049042cc7920fd97896c0f` | Exact EGLC archive identity and hourly remark           |
| [NOAA ISD station history](https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv)                                                                              | `2026-08-06`               | 200 CSV     | 2,914,601 | row `037683-99999`, data end `2025-08-24`           | `1994747ab4af1b97e63adb434b4d0d022f2daee76f0c144ea9ab46be2d906604` | Exact NOAA archive identifier crosswalk                 |
| [ADM 2015–2018 station-map KML](https://www.google.com/maps/d/kml?mid=14z8zeHHUirmdnnHABRQv9IV84Mw&forcekml=1)                                                  | `2026-08-07`               | 200 KML     | 4,878,075 | filename `2015 - 2018 Met data Summary.kml`         | `fac12a72326f2359ba4689c774eb36ea28a34df58a8d6f04342aeb74f48427d3` | Proves LCY `3768.3` and Bracknell `3763` distinction     |
| [H3228 air-quality report](https://docs.planning.org.uk/20210614/58/QTRG6PJN0AH00/x5m7l4rp04347dg1.pdf)                                                        | `2026-08-07`               | 200 PDF     | 3,658,089 | not supplied                                        | `e544dfbf7ed7f5b2ddb3ed57239870b21d3dcdb3a4aa1da663a164693dbe1719` | First erroneous `3763/EGLC` figure/vector baseline       |
| [H3817 air-quality report](https://www.chelmsford.gov.uk/media/o0gn3dul/cd0102-air-quality-assessment.pdf)                                                     | `2026-08-07`               | 200 PDF     | 2,846,472 | not supplied                                        | `857c7f048b8eacd815f78f64d71b30f5d21a5faca90b28a703d220edb4692cee` | 2019 claim and reused wind-rose geometry                 |
| [Kidbrooke air-quality appendix](https://docs.planning.org.uk/20240111/53/_GRNW_DCAPR_118439/zgbogppls73m6nty.pdf)                                             | `2026-08-07`               | 200 PDF     |   416,562 | not supplied                                        | `f2dba4d6795400792b635ce46626637ff14991bd87e017bfbcf88b38d8128023` | 2022 claim exposing `London_City_17.met` path            |
| [H4596 air-quality report](https://docs.planning.org.uk/20260519/152/DCAPR_150503/0z6p6hc1ls4ior7v.pdf)                                                       | `2026-08-07`               | 200 PDF     | 1,927,672 | not supplied                                        | `a5de241c69580667bf63e73f207e1803c52ff890e9d4ddb7aa051eda7af759dc` | 2024 claim exposing same 2017 path/vector reuse          |
| [WOW exact LCY search](https://wow.metoffice.gov.uk/api/sites/search?text=London%20City%20Airport)                                                            | `2026-08-07`               | 200 JSON    |       123 | not supplied                                        | `d7d9bb47578bd537c3befa6f62b71d205470f2504c6b06def5240f67a3db64ee` | Resolves official WOW site `955386003`                   |
| [WOW LCY site JSON](https://wow.metoffice.gov.uk/api/sites/955386003)                                                                                          | `2026-08-07`               | 200 JSON    |     2,466 | no last observation                                 | `99f0095bf8eb94c00501c1901db765c5fd98a43c4366ab800b870edca07cab4f` | Official/dormant identity metadata                       |
| [WOW LCY details](https://wow.metoffice.gov.uk/observations/details/?site_id=955386003)                                                                        | `2026-08-07`               | 200 HTML    |    37,344 | page says not reporting                             | `751e4973217942f53252e1c1df3daebdbd121abf657f03fef2ebf40feb0dd9a4` | Human-visible no-observation state                       |
| [WOW LCY November 2025 table payload](https://wow.metoffice.gov.uk/observations/details/tableviewdata/955386003/details/2025-11-30?startAt=0&hours=23%3A59%3A59&firstDate=2025-11-01&lastDate=2025-11-30&fields=DryBulbTemperature_Celsius&impacts=&hazards=&timezone=Europe%2FLondon) | `2026-08-07` | 200 JSON | 150,926 | zero observations | `c5ad93cb6aba108244a023c2fe1d9484cbb3f234cbb232d6b9aad63ed17307e2` | Empty monthly LCY control |
| [WOW Northolt November 2025 table control](https://wow.metoffice.gov.uk/observations/details/tableviewdata/5023/details/2025-11-30?startAt=0&hours=23%3A59%3A59&firstDate=2025-11-01&lastDate=2025-11-30&fields=DryBulbTemperature_Celsius&impacts=&hazards=&timezone=Europe%2FLondon) | `2026-08-07` | 200 JSON | 713,581 | 715 observations | `4238adb61e20d87e53edf194e32ee96e62c156477fed92017b8bfc4058f226b0` | Proves table endpoint works for official observations |
| [EGLC AIP AD 2, 6 August 2026 AIRAC](https://www.aurora.nats.co.uk/htmlAIP/Publications/2026-08-06-AIRAC/html/eAIP/EG-AD-2.EGLC-en-GB.html)                       | `2026-08-07T01:00Z`        | 200 XHTML   |   259,214 | `2026-06-11T06:53:28Z` / `W/"254894-1781160808966"` | `492874865fff52b9e17160e41c1f9058add8a4641b94dea50fa5675a5c8b2567` | Current airport identity, office and ATIS                |
| [UK AIP GEN 3.5, 6 August 2026 AIRAC](https://www.aurora.nats.co.uk/htmlAIP/Publications/2026-08-06-AIRAC/html/eAIP/EG-GEN-3.5-en-GB.html)                        | `2026-08-07T01:00Z`        | 200 XHTML   |   397,776 | `2026-06-11T06:53:29Z` / `W/"393456-1781160809430"` | `03bf1121a8dc44851a26e8586b847c5234ee65e030d909a6a883d8247ac4a9ee` | Current report cadence/type and bulletin lineage         |
| AWC 168-hour EGLC JSON                                                                                                                                         | `2026-08-05T23:30:10.872Z` | 200 JSON    |   134,744 | `Cache-Control: max-age=60`                         | `683792a78637861cf6a5612e7c3502b9e9ffec872907f8ee7f91f87165ad0e76` | Seven-day cadence, gaps/revisions and receipt latency    |
| [AWC OpenAPI YAML](https://connect.aviationweather.gov/data/schema/openapi.yaml)                                                                               | `2026-08-05T23:34:21.930Z` | 200 YAML    |    87,776 | `"6a6be38d-156e0"` / `2026-07-30T23:51:41Z`         | `d7a6f291187d57c5d4d8a4d59277115a4eecfe79afcec37d97548031fbf0c25c` | Timestamp contract and schema-drift check                |
| Initial AWC 72-hour EGLC JSON (superseded by 168-hour sample)                                                                                                  | `2026-08-05T22:27:30.656Z` | 200 JSON    |    58,159 | `Cache-Control: max-age=60`                         | `db00da65aee96f2763ff27b4e7e3c5c608124e5627abdd7f42715b94e1b410ae` | Preserved first-pass artifact                            |
| NOAA `EGLC.TXT`, `052220Z`                                                                                                                                     | `2026-08-05T22:27:40.161Z` | 200 text    |        64 | `2026-08-05T22:24:12Z`                              | `6229ace21c9f16b578e26fc5ffe00a71e42b382ce80142c758fe1e6527950d6f` | Relay comparison                                         |
| AWC latest JSON, `052220Z`                                                                                                                                     | `2026-08-05T22:27:40.541Z` | 200 JSON    |       393 | `Cache-Control: max-age=60`                         | `8e0432b7b1842118bce9cfb33b71d83ff17ee2b524978da30716c77d8174047e` | Relay comparison and timestamp fields                    |
| NOAA `EGLC.TXT`, `052250Z`                                                                                                                                     | `2026-08-05T22:56:56.438Z` | 200 text    |        64 | `2026-08-05T22:54:15Z`                              | `76049e5258d550889c626fa0d24196acd398f57a746c8ec670aac678c37d8ab1` | Third relay comparison                                   |
| AWC one-hour JSON containing `052250Z`                                                                                                                         | `2026-08-05T22:56:56.932Z` | 200 JSON    |       784 | `Cache-Control: max-age=60`                         | `a703da004f0278b3dd39ea34f771fec652c49f01c4e0d3392cc204a1e1fc42b4` | Third relay comparison and normalized `reportTime` trap  |
| [Current LCY WebTrak entry](https://eu.webtrak.aero/lcy)                                                                                                      | `2026-08-08T22:52Z`        | 200 HTML    |    22,606 | `2026-05-06T23:36:32Z`                              | `a4c80da2b39ed4f60f8bca5abc06c12bf86cc3e20bc4737093f3aa0104879753` | Build-graph entry and LCY site selection                 |
| [Current WebTrak version record](https://eu.webtrak.aero/git.version.json)                                                                                     | `2026-08-08T22:52Z`        | 200 JSON    |        81 | not retained                                        | `fe29bafc62022ba805f8ecc644c92756e40df2a82add3649269f365232144e6f` | Version `6.0.33` / release timestamp                     |
| Current WebTrak default `main.js?6.0.33`                                                                                                                       | `2026-08-08T22:52–22:56Z`  | 200 JS      |    31,579 | `2026-05-06T23:36:33Z`                              | `a94df95551a1f86bc3aa551c08121eb67e3f745850b0e93eb46de004fe0ce450` | RequireJS paths, bootstrap and conditional imports       |
| Current WebTrak `configs/appConfig.js`                                                                                                                        | `2026-08-08T22:52–22:56Z`  | 200 JS      |    14,176 | not retained                                        | `8759cbfb7d8bcd379e8b779c2f3aea77242e93edf00d229a3b15eacec250cf2e` | Constructs TAFOR/anemometer operation templates          |
| Current WebTrak `providers/DataSource.js`                                                                                                                     | `2026-08-08T22:52–22:56Z`  | 200 JS      |    72,236 | not retained                                        | `8bb8eca57e0062a1ccbb6ccfc14c11209488951e0044470726c37cb1ecacf26c` | Implements concrete GET call sites and known weather flow |
| Current WebTrak `controllers/CompassManager.js`                                                                                                              | `2026-08-08T22:52–22:56Z`  | 200 JS      |    11,982 | not retained                                        | `da94be6727a6c9015c83234fb0886cc1c090fe67d6b598f4f3d47ccf2345d21b` | Enable gates, 120/600 wind requests and station mapping  |
| Current WebTrak `views/flightBoardLayer.js`                                                                                                                   | `2026-08-08T22:52–22:56Z`  | 200 JS      |    32,114 | not retained                                        | `76b837ada8970e4b77ffd452cfda00a8e0b9e5c0ce27a06452bb3470a6fb6dea` | TAFOR-string consumer and 1800 duration                  |
| Current WebTrak `models/windCompass.js`                                                                                                                       | `2026-08-08T22:52–22:56Z`  | 200 JS      |     8,759 | not retained                                        | `4727e9b44e4b46362835a78ab31b957068c26ed00ae68874716c7e3ae7e4220a` | Wind-only numerical schema; no temperature field         |
| LCY WebTrak `/api/tafor/lcy/getConfig`                                                                                                                        | `2026-08-08T22:52–22:56Z`  | 200 JSON    |       262 | two identical normal-boot responses                 | `a869ad7bda0d7ce127424addd1d61e57df096c098d1a6f788bf7772cbca15712` | Records both LCY client feature flags as off             |
| WebTrak weather XML, report 38339                                                                                                                              | `2026-08-05T22:27:40.946Z` | 200 XML     |       509 | not supplied                                        | `73cf615790ddc1abb17d0588b38aaa30133e8573be6043db488d509f4dc5b0a2` | Request-time wrapper trap                                |
| ThingSpeak channel 547822, five rows                                                                                                                           | `2026-08-05T22:27:41.985Z` | 200 JSON    |       880 | `Cache-Control: max-age=7, private`                 | `3c8a1f27ba9e22743fee1e592db0b7ac13eec0c42068073d21767e438bcecf93` | Five-minute nearby cadence                               |
| ThingSpeak channel 547822, seven-day window                                                                                                                    | `2026-08-05T23:31:03Z`     | 200 JSON    |   195,337 | `Cache-Control: max-age=7, private`                 | `e6df739f8fb5d88882eb4ee29337f3fc0a4c259676d3412cea1dce50072fa2cd` | Pre-registered agreement comparison                      |

## Negative results and reopening evidence

| Candidate                    | Why it looked promising                                     | Exact bounded check                                                              | Why rejected/blocked                                                                           | What would reopen it                                                                    |
| ---------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Met Office `Next hour`       | Official airport-named page                                 | Page labels and hourly-table semantics inspected                                 | Forecast, not observation                                                                      | A separately documented measured EGLC field                                             |
| Met Office `Last 3 days`     | Linked from the airport forecast page                       | Followed exact link; title/coordinates checked                                   | East Malling, about 36.9 km away                                                               | Corrected provider mapping to EGLC with station metadata                                |
| DataHub Land Observations    | Official measured UK network                                | Public docs, CEDA crosswalk and unauthenticated surface inspected; no account created | Hourly; CEDA proves an archive EGLC identity, but DataHub exposure/current-sensor mapping remains unproven       | Authenticated response plus Met Office station confirmation and licensed scope          |
| Met Office WOW `955386003`  | Exact official, Met Office-owned London City Airport record | Site/search JSON, detail page, 2012–2026 date samples, 1,101-URL archive inventory and Northolt control | Site says not reporting; null last observation; every sampled LCY table empty; no exact-ID capture | Met Office activates the exact site with documented current sensor mapping and rows     |
| Newham `22/03045/VAR` files | Airport-station climate and model data named in the record  | All 209 archived register rows, 213 CDX URLs, 98 applicant PDFs and appeal set audited | Only historical hourly provenance survived publicly; raw `.met`, spreadsheet and model files were not exposed | A severable public attachment or owner/consultant-authorized raw input package           |
| CEDA MIDAS source `18929`   | Exact official `ICAO EGLC` station identity                 | Station record, message dictionary, full/Open collections and generic schema inspected | No MIDAS Open files for this station; hourly archive remark; no live endpoint                           | Authorized full-MIDAS access for a historical use, or a separately documented live API  |
| OSCAR/Surface               | Potential WIGOS and deployment metadata                     | Exact name/ICAO/ISD queries plus tight and wider coordinate boxes                 | No discoverable LCY result or WIGOS ID on the public search surface                                  | WMO/Met Office supplies an exact current LCY WIGOS record                               |
| Zenodo London 2016 record   | Explicitly lists `EGLC` among research weather-station data | Public record and file-access state inspected                                    | Files embargoed to 30 Apr 2027; no live interface or proven EGLC schema/cadence                         | Embargo lifts or owner grants legitimate access; remains historical                     |
| WIS2 DWD gateway             | Event-driven official-bulletin metadata                     | Two rollovers; origin/cache and core/recommended topics; canonical and RRA objects | Aviation data appeared only as origin/recommended; no cache copy; objects returned 401 under explicit OPMET restriction | DWD-approved aviation scope; still only the rounded METAR                               |
| WebTrak weather              | Airport-owner linked, appears live                          | Client link/config plus repeated requests through a report rollover              | Same report; switch interval-censored to 83.104–98.687 s after AWC receipt; restricted reuse    | Owner documents a distinct native sensor field/cadence and reuse right                  |
| WebTrak TAFOR/anemometers    | Shipped client contains station, wind and TAFOR GET data flow | Cold RequireJS graph plus two identical normal-boot feature-config responses; client-disabled data operations were not called | LCY returned both client feature flags as `0`; numerical consumer is wind-only and contains no temperature field; user reports approval requested, but no grant/scope is recorded | Written LCY/WebTrak/data-owner scope, all applicable exact-`true` gates, then a bounded read-only validation; a temperature claim would still require an observed temperature field |
| 2013–2024 owner-linked TraVis | Dedicated LCY viewer, 10/11 s timer and decimal display     | LCY root/helper captures, all-years CDX, Common Crawl and five sibling generated XML/report pairs | LCY weather is 30-minute/60-minute delayed; sibling `.00` values show decimal syntax is not native-precision evidence; no successful numeric LCY XML; exact upstream source unknown; retired/NXDOMAIN | Provider documents a distinct supported native endpoint with field lineage              |
| 2021 LCY/AQC air-quality portal | Airport/council-linked “real-time” station portal       | Three exact site pages, HTML-statistics/JSON-graph/CSV controls, map bundle and 43-key all-years archive inventory | Pollutant data only, with hourly/daily downloads and monthly statistics; no meteorological field in the archived client surface examined | AQC publishes an authorized meteorological route tied to the airport input              |
| Consultant `3763/EGLC`      | Repeated exact-looking station number and hourly wind roses | ADM KML, official HadISD list, four PDFs, hidden source paths and vector-geometry comparison | `3763` is Bracknell; LCY is `037683`/ADM `3768.3`; later year claims reuse 2017 path/geometry | Underlying supplier file plus authoritative header, licence and untampered year lineage |
| ADM `.met` model files      | Named London City hourly model inputs and public supplier map | Archived supplier page/KML, adjacent filenames and bounded site/archive search | No raw file bytes; format can hold decimals but does not prove native LCY tenths; not live     | Supplier-authorized raw file and metadata; still historical/hourly                      |
| LCY third-party mobile app   | Historical package notes mentioned airport weather          | Owner archive, store/package history and exact 2021-version searches              | Explicitly unofficial; no exact 2021 APK recovered and no source provenance                     | Official LCY endorsement plus documented measured endpoint                              |
| XCWeather                    | Server page embeds exact `EGLC` METAR                       | Five-second rollover probe plus public HTML/FAQ inspection                       | Same report; 4m22s behind AWC; FAQ prohibits taking data                                       | Written provider licence plus measured relay advantage worth the dependency             |
| Weather Underground EGLC history | Airport-code URL and tabular temperatures              | Current daily history fields/timestamps and linked station header inspected       | Half-hourly `:20`/`:50` METAR rows, whole-Fahrenheit presentation; header links an offline Custom House PWS; automated reuse restricted | Provider-authorized distinct airport observation with provenance                         |
| AirQualityEngland `LCA01/02` | Very near airport and official monitoring                   | Station parameters inspected                                                     | Pollution fields only, no air temperature                                                      | A documented dry-bulb field added to one of those exact sites                           |
| Environment Agency           | Official open monitoring API                                | 10 km temperature-parameter station query                                        | No result                                                                                      | A new nearby dry-bulb station with suitable siting                                      |
| Nearby PWS/community sensors | Much faster numeric updates                                 | Bounded timestamp/cadence sampling                                               | Not airport; quality and reuse limits                                                          | Provider authorization and use solely as named context, never airport truth             |
| PAMS/SAMOS gateway           | Closest named site/system architecture                      | AAIB record, 2017 NATS milestone, 2019/2021 archives, 2022/current PAMS material and CAA records | Retained records plus alarm/status path only; no numeric value interface or authorization       | Provider-issued read-only export, asset mapping and exact scope                         |
| A429-01 / tower acceptance  | Public tower procurement plus named FAT/SAT milestones      | TED/PQQ archives, NATS 2018/2019 reports, CAA change/oversight records and planning basis | Physical works/module separation and system-level milestones only; scripts, interface annexes and MET mapping non-public | Severable acceptance/change pack or provider-issued data dictionary                     |
| Tower images/screenshots     | Weather readings are shown operationally                    | Official/archived LCY, NATS and Saab image searches                              | No legible field ID, endpoint, sensor label or timestamped series                              | First-party annotated image tied to an approved numeric export                          |
| ATIS telephone               | Official airport-specific local report                      | AIP and CAA rules inspected; no call made                                        | Voice-only, event/routine report, automation rights absent                                     | NATS-approved structured feed or bounded call/transcription permission                  |

## Recommended next experiment

### Provider path

The highest-value next step is not more hostname discovery. It is a scoped
request to NATS Services and London City for the raw dry-bulb export described
above. If provided, first use provider-sanctioned samples/fixtures while the
production approval flag remains absent. Then run a 24–72 hour bounded capture
that records native timestamps, first-seen times, revisions, flags and outages.

The passive document search is now exhausted to a defensible boundary. A
secondary records request may cite Newham key `RNYU92JY5NA00`, AQC report
`J10/12793H/10/1/F1`, MIDAS `18929`, ISD `037683-99999`, ADM `3768.3`
(explicitly **not** `3763`), historical `50LC`, dormant WOW `955386003`,
`SAMOS Gateway`, A429-01 and AAIB report 5/2009. Ask Newham/LCY/AQC/Met Office for the
severable register entry, metadata/header and release terms for the historical
hourly file; ask why the exact WOW site never reported; and ask CAA for an index
plus severable `SRG1430`, RAMOS/SAMOS change/approval, audit and acceptance
records. The repeated hidden `London_City_17.met` path and false `3763` caption
should be included so a respondent does not simply return another contaminated
figure. Those requests can improve lineage, but only NATS/LCY can establish and
authorize a current numerical export.

Pre-register a comparison against the public METAR:

- compare the raw value nearest the METAR nominal observation time;
- also compare the last raw value known when AWC first received the report;
- use `±0.5 °C` as a precision-aware diagnostic around whole-degree encoding,
  accounting for the UK's warmer-direction rule at exact halves;
- report bias/MAE, within-tolerance share, maximum difference, missing samples,
  stuck values and raw sample ages;
- never use agreement alone to claim that the two products share an exact
  sensor; and
- preserve corrections and do not look ahead when choosing a raw sample.

### Approval-pending WebTrak provenance path

The user reports a 2026-08-08 WebTrak approval request, but no recipient,
written scope or grant is recorded, so this dossier treats it as pending. This
path is lower priority than the NATS/LCY raw-temperature request because the shipped
consumer schema is wind-only. If written scope is granted, first record which
of client access, TAFOR/anemometer validation, artifact retention and
republication it covers. Enable only the matching exact-`true` Convex flags.

The smallest useful experiment is one read-only `stations` request followed,
only if separately authorized, by one narrow `getWind` window. Record station
IDs, names, coordinates, field names and provider timestamps without assuming
that a generic weather-station label implies temperature or current certified
LCY lineage. Do not call `getString` merely to prove it exists, and do not
expand to sibling sites. If the response remains wind-only, close this branch
as provenance context. Any temperature claim would require a distinct observed
field, documented sensor mapping and its own approved use scope.

### Public relay path

Run a bounded first-seen monitor over at least 48 routine cycles for:

1. NOAA `EGLC.TXT` with conditional one-minute requests;
2. AWC JSON and its `receiptTime`;
3. public WIS2 `SAUK32 EGGY` notification metadata only, unless DWD separately
   authorizes canonical recommended-data access;
4. MAVIS/SADIS only if the provider grants appropriate account/API scope; and
5. neither WebTrak nor XCWeather extraction unless written permission reverses
   their published restrictions and a measured benefit justifies the added
   dependency.

Record observation time, report raw hash, provider/bulletin timestamp, HTTP
metadata, notification time and application `firstSeenAt`. Rank by a latency
distribution, not a single winner. The one-cycle rollover above is enough for
a provisional ranking, not a production SLA.

## Future collector and UI contract

Keep three products separate:

1. **Official report:** `EGLC METAR`, whole °C, half-hourly, with raw report and
   observation/receipt/first-seen timestamps.
2. **Native airport sensor:** only after exact provider approval; decimal value,
   sensor/channel metadata, quality flags, actual sample/aggregation semantics,
   and an honest unavailable state.
3. **Nearby context:** explicitly named station, distance, owner, quality caveat
   and separate chart/card. Never blend or backfill it into the airport series.

Minimum provenance fields for every stored row:

```text
airportIcao
sourceId
sourceClass
stationOrSensorId
sensorLatitude
sensorLongitude
observationTime
aggregationWindowStart
aggregationWindowEnd
providerReceiptTime
providerPublicationTime
requestStartedAt
responseCompletedAt
firstSeenAt
temperatureC
nativePrecisionC
reportedPrecisionC
qualityFlags
reportType
rawPayloadHash
rawPayloadOrApprovedReference
revisionOf
ingestStatus
```

Do not derive decimal temperature from dew point/humidity, interpolate between
METARs, substitute a forecast, or silently use a PWS when the airport source is
stale. The UI should expose source, observation age, precision and approval/
setup state.

## Investigation status

- [x] Airport identity and timezone verified.
- [x] Authority and source map completed.
- [x] Official report baseline captured over seven days (336 reports / 335 intervals).
- [x] One five-relay `:50` rollover compared; a separate approximately 100-minute NOAA/AWC monitor captured three report transitions before the investigation was closed, and a second WIS2 rollover added another bounded event.
- [x] Airport-owner WebTrak flow inspected from an owner link.
- [x] Current WebTrak `6.0.33` RequireJS graph reconstructed from a cold,
  isolated browser session; no route-chunk/source-map/manifest/service-worker
  lead appeared in the bounded loaded graph.
- [x] TAFOR/anemometer station, wind and text data flow traced to concrete GET
  call sites and typed consumers without calling the client-disabled operations.
- [x] Two identical normal-boot config responses proved LCY currently sets
  `weather/anemometers/enable=0` and `weather/tafor/enable=0`; the numerical
  schema is wind-only and exposes no temperature field.
- [x] 2013–2024 owner-linked TraVis reconstructed from exact Wayback/CDX and Common Crawl evidence.
- [x] Historical client timer, delay clock, helper error, XML request contract, terms and archive gaps separated.
- [x] Five sibling TraVis XML payloads across three deployments paired with contemporaneous routine reports; decimal formatting distinguished from native precision without claiming LCY's exact upstream source.
- [x] The 2021 LCY/AQC public portal reconstructed as pollutant-only, with hourly/daily downloads and monthly statistics rather than a hidden weather route.
- [x] Newham `22/03045/VAR` register exhaustively parsed: 209 rows, 213 attachment CDX URLs and 98 applicant-hosted originals; no raw/model-data attachment exposed.
- [x] Appendix 9.3 and the AQC Regulation 25 response traced to a Met Office-prepared, AQC-processed hourly 2017–2021 LCY METAR-site series.
- [x] Climate response checked against the actual Table 11-32 and NOAA 2018–2022 daily archive; citation error and seasonal-definition ambiguity recorded.
- [x] Archive identities resolved as MIDAS `18929`, ISD/USAF `037683-99999` and historical Met Office code `50LC`, without promoting them to a current sensor ID.
- [x] Consultant `3763/EGLC` label falsified against ADM KML and HadISD; correct ADM rendering `3768.3` recorded.
- [x] Hidden `London_City_17.met` paths and sub-0.06-point vector-geometry reuse demonstrate template contamination in later-year reports.
- [x] Exact official WOW site `955386003` tested across years and against Northolt control; dormant/empty branch closed.
- [x] Twenty-four AAIB PDFs inspected; report 5/2009 proves retained LCY SAMOS observations but no native cadence/interface.
- [x] TED, Find a Tender, Contracts Finder, CAA and PAMS records checked; A429-01 module separation, NATS FAT/SAT milestones and CAP 1635 private sensory-data path recovered, but no numeric interface annex was public.
- [x] OSCAR, CEDA, consultancy/academic supplements, Zenodo, targeted code searches and D-ATIS/local-report branches completed and bounded.
- [x] Public hostname, DNS, certificate/search, redirect, configuration and migration provenance recorded.
- [x] Procurement/commissioning/acceptance trail checked without backdating a 2022 SAMOS label into 2021.
- [x] Mobile/PWA/desktop and image/screenshot branches investigated and bounded honestly.
- [x] Public structured payloads and AWC OpenAPI contract validated; undocumented `qcField` left opaque.
- [x] WIS2 recommended-data policy, no-cache behavior, DWD OPMET restriction and two live notifications validated.
- [x] Sensor minimum requirements and likely system family documented.
- [x] Nearby-source cadence and coordinate limitations separated.
- [x] Forecast, observation, local report, ATIS and report-relay semantics kept distinct.
- [x] Decisive artifact metadata, retrieval dates, sizes and hashes recorded in this dossier; restricted WIS2 object bytes were never obtained.
- [x] Seven-day DSWC/METAR comparison pre-registered and executed; nearby data rejected as airport substitute.
- [ ] Exact NATS/LCY sensor/channel/model/calibration provenance (`I4`/`I5`).
- [ ] Provider-issued native endpoint and approval scope.
- [ ] Written LCY/WebTrak/data-rightsholder scope for the user-reported
  2026-08-08 WebTrak request; no recipient/scope/grant is recorded, so all
  WebTrak approval flags must stay unset and fail closed.
- [ ] Gated, bounded WebTrak station/wind provenance validation, only if the
  requested scope is granted; not expected to supply temperature from the
  shipped schema.
- [ ] 24–72 hour native-sensor latency/quality experiment.
- [ ] Multi-cycle public relay first-seen, revision, gap, stale-data, and update-race distribution.
- [ ] Production collector, schema, schedule, route and UI (not requested yet).

**Closure decision:** no checked public source passed the four acceptance tests
for a native minute-level EGLC temperature. The build-graph pass found a real
but client-disabled wind/TAFOR branch, not a temperature channel. The investigation is
closed at the public-evidence boundary; the remaining unchecked items require
provider access, a granted and gated WebTrak scope, or a materially new source,
not more polling of the same public METAR relays.
