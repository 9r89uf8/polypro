# Milan LIMC/MXP METAR Notes

Verified against live endpoints on March 25, 2026.

## Official publisher

For `LIMC` / Milan Malpensa, the actual METAR publisher is `ENAV`, specifically
`ENAV's Milan Meteorological Forecast Office (UPM Milano)`.

Official Italian/ICAO source trail:

- Italy AIP says:
  - `ENAV` operates e-AWOS sensors at 45+ Italian airports and compiles
    METAR/TAF/SIGMET
  - `ENAV's OPMET Data Bank (BDM)` stores all ICAO OPMET data in BUFR and IWXXM
    formats
- The national Met authority is:
  - `Aeronautica Militare / CNMCA` (Centro Nazionale di Meteorologia e
    Climatologia Aerospaziale)
- The public-facing portal is:
  - `MeteoAM` (`meteoam.it` / `api.meteoam.it`), powered by the `DEDA` platform

Practical implication:

- the data chain is: ENAV sensors -> ENAV BDM -> CNMCA -> MeteoAM -> GTS -> NOAA
- unlike Paris where `Meteo-France` publishes directly via AEROWEB, Italy's public
  path goes through the military meteorological service (Aeronautica Militare)

## Best working Italian-origin public endpoints

The public MeteoAM page at `https://www.meteoam.it/it/metar-taf` hard-wires its
widget to:

- `https://api.meteoam.it/deda-ows/metar-taf-icao/`

For LIMC, the practical public METAR URL is:

- `https://api.meteoam.it/deda-ows/metar-taf-icao/LIMC/{time1}/{time2}`

Example call:

- `https://api.meteoam.it/deda-ows/metar-taf-icao/LIMC/2026-03-25T00:00:00Z/2026-03-25T23:59:59Z`

What that METAR endpoint returns:

- JSON array with ICAO, `metar` array, and `taf` array
- each METAR entry has `validity` (ISO datetime) and `metar_message` (raw text)
- no authentication required
- CORS restricted to `Origin: https://www.meteoam.it`

Full API spec available at:

- `https://api.meteoam.it/deda-ows/openapi.json`

Other endpoints in the same API:

- `/api/GetStation/{station}` — station metadata plus an hourly observation
  time series
- `/api/GetMsgIcao/{icao}` — intended raw-message endpoint, but it currently
  crashes server-side for `LIMC`
- `/api/GetPointObs/` — GeoJSON observation points in a bounding box
- `/api/GetStationRadius/{lat}/{lon}` — stations within radius
- `/ows` — OGC WFS/WMS service for map layers
- `/effemeridi-icao/{icao}/{date1}/{date2}` — ephemeris (sunrise/sunset) data

Important distinction:

- `metar-taf-icao` is the only public MeteoAM endpoint I found that returns raw
  LIMC METAR text
- `GetStation/LIMC` is fresher, but it is not a METAR feed; it exposes hourly
  fields like `2t`, `r`, `pmsl`, `wdir`, `wcar`, `wspd`, `wkmh`, `2tf`, and
  `icon`

How I found them:

- the public page at `https://www.meteoam.it/it/metar-taf` embeds
  `serviceURL: https://api.meteoam.it/deda-ows/metar-taf-icao/`
- the OpenAPI 3.0.2 spec at `/deda-ows/openapi.json` documents the endpoint set
- the backend is a FastAPI/Starlette Python 3.6 application

## Measured propagation timing

At `2026-03-25 ~14:50-15:02 UTC`, I tracked the 251450Z METAR from observation
time to appearance on each source:

| Source | 1450Z appeared by | Latency from obs | Auth |
| --- | --- | --- | --- |
| **NOAA tgftp** | 14:56:31 UTC | **~6.5 min** | No |
| **AWC API** | 14:57:04 UTC | **~7 min** | No |
| **MET Norway** | 14:59:29 UTC | **~9.5 min** | No |
| **MeteoAM (deda-ows)** | 15:01:49 UTC | **~12 min** | No (CORS) |
| **Ogimet** | 15:01:49 UTC | **~12 min** | No |

AWC JSON also reported a `receiptTime` of `14:25:35 UTC` for the earlier 1420Z
observation, meaning NOAA received it ~5.5 minutes after observation.

Critical finding:

- **MeteoAM is SLOWER than NOAA, not faster**
- the Italian-origin public API lags ~5 minutes behind NOAA tgftp
- this is the opposite of the Paris result, where the French-origin AEROWEB
  endpoint beat NOAA by one report cycle

Practical read:

- this is a single measured snapshot, not a rigorous multi-cycle race
- but the gap is large enough (~5 min) to suggest the Deda OWS database receives
  METARs through a slower path than the AFTN/GTS chain feeding NOAA
- the MeteoAM API may still be useful as a source-of-truth cross-check, but it is
  not a speed advantage

## Follow-up live check

At `2026-03-25 15:29:26 UTC`, I re-checked the current latest values:

| Source | Latest visible item at check time | Notes |
| --- | --- | --- |
| **NOAA tgftp** | `LIMC 251520Z 16004KT 130V190 9999 BKN045 16/07 Q1002 NOSIG` | already on the `1520Z` cycle |
| **AWC API** | `METAR LIMC 251520Z 16004KT 130V190 9999 BKN045 16/07 Q1002 NOSIG` | `receiptTime = 2026-03-25T15:25:31.613Z` |
| **MeteoAM metar-taf-icao** | `LIMC 251450Z 19006KT 150V230 9999 BKN050 17/06 Q1002 NOSIG` | still one full report behind NOAA |
| **MeteoAM GetStation/LIMC** | latest timeseries head `2026-03-25T15:00:00Z` | fresher Italian observation feed, but **not METAR text** |

What this changes:

- it strengthens the earlier result: the public Italian METAR endpoint was not
  just a few minutes behind NOAA, it was a full half-hour report behind at this
  check
- the only public Italian feed I found that is fresher than the public MeteoAM
  METAR endpoint is `GetStation/LIMC`, but it is an hourly station-observation
  series, not a coded METAR/SPECI product
- `GetMsgIcao/LIMC` still does not help because it currently throws a server-side
  Python error instead of returning messages

## ENAV Self-Briefing Portal

ENAV operates a pilot briefing system at:

- `https://selfbriefing.enav.it/`

What is known:

- redirects to a Citrix VPN login page
- provides NOTAMs, SNOWTAMs, MET messages, flight plans
- restricted to registered pilots/operators
- would be fed directly from ENAV's MET systems

Practical implication:

- this is the closest-to-sensor operational system
- it could theoretically be the fastest Italian source
- but it cannot be polled programmatically from outside

## SADIS OPMET API

The SADIS API from WAFC London carries OPMET including METAR, SPECI, and TAF:

- base URL: `https://gateway.api-management.metoffice.cloud/sadis-opmet/1/`
- auth: OAuth2 Client Credentials (Client ID + Secret -> Bearer Token, 1-hour
  expiry)
- registration: requires approval from State Meteorological Authority
- collections: `tac_opmet_reports` and `iwxxm_opmet_reports` for EUR_NAT region
- update frequency: refreshed minute by minute, data in 5-minute packets
- responses: returns 301 redirects to pre-signed AWS S3 URLs; 36-hour history
- user guide:
  `https://www.icao.int/sites/default/files/METP/Documents/SADIS-API-User-Guide-1st-Edition.pdf`

Practical implication:

- minute-by-minute refresh could potentially beat NOAA's ~6.5 min latency
- but requires institutional access

## EUROCONTROL sources

Two EUROCONTROL paths carry LIMC METARs:

NM B2B OPMET Service:

- access via Internet or NewPENS with PKI certificate authentication
- eligible users: ANSPs, airlines, airports, CFSPs
- protocol: SOAP Web Services and AMQP 1.0 pub/sub
- client library: `https://github.com/DGAC/nmb2b-client-js`

EUROCONTROL SWIM IWXXM METAR-SPECI Service:

- protocol: OGC WFS 2.0 for request/reply; AMQP 1.0 for pub/sub
- format: IWXXM 2023-1 (METAR/SPECI schema 3.1.0) in XML or JSON
- auth: TLS 1.2+ with EUROCONTROL TI Yellow Profile authentication
- model: subscribe by ICAO code, receive METARs as they become available

Practical implication:

- both are enterprise-grade and require organizational agreements
- the AMQP push model could deliver sub-minute latency
- but neither is accessible for a lightweight poll-based approach

## Public HTTPS alternatives

MET Norway tafmetar:

- `https://api.met.no/weatherapi/tafmetar/1.0/metar.txt?icao=LIMC`
- returns last 24 hours of METARs, plain text
- no auth (just needs a User-Agent header)
- ~9.5 min latency in testing — ~3 min slower than NOAA

Ogimet:

- `https://www.ogimet.com/display_metars2.php?lugar=LIMC&tipo=ALL&ord=REV&nil=SI&fmt=txt&lang=en`
- the simpler `getmetar` CGI returned HTTP 500
- ~12 min latency — tied with MeteoAM
- unreliable

AWC Data API:

- `https://aviationweather.gov/api/data/metar?ids=LIMC&format=json`
- richest data: parsed fields, receipt timestamps, raw observation
- ~7 min latency — essentially tied with tgftp

## Current read

What I can now say with confidence:

- **NOAA tgftp and AWC are the fastest publicly accessible sources for LIMC**
  at ~6-7 min latency
- the Italian-origin public MeteoAM METAR API exists and works but is ~5 minutes
  slower than NOAA in the first race and a full cycle behind NOAA in the
  `2026-03-25 15:29:26 UTC` follow-up check
- `https://api.meteoam.it/deda-ows/api/GetStation/LIMC` is the freshest public
  Italian endpoint I found, but it is an hourly observation series rather than a
  METAR feed
- there is no Italian equivalent of France's fast AEROWEB authenticated endpoint
- the ENAV self-briefing portal is behind VPN and cannot be polled
- MET Norway is a decent free alternative at ~9.5 min but still slower than NOAA

What I did not find:

- a public Italian-origin endpoint that beats NOAA
- a way to access ENAV's operational systems without VPN credentials
- proof that MeteoAM's Deda OWS backend can be faster than its measured ~12 min
- a hidden second public MeteoAM METAR endpoint beyond the page's embedded
  `metar-taf-icao` service URL

Important contrast with Paris:

- for Paris, the French-origin AEROWEB endpoint beat NOAA by one report cycle
- for Milan, the Italian-origin public MeteoAM METAR endpoint is ~5 minutes
  slower than NOAA in one measured race and a full cycle behind NOAA in the
  follow-up live check
- this suggests the Italian public dissemination path has more latency in its
  chain than the French one

## Best next moves

If we want to beat NOAA for LIMC, the options are:

1. **SADIS API** — requires institutional registration but updates minute by
   minute; most likely path to sub-5-min latency
2. **EUROCONTROL SWIM AMQP** — push-based, potentially sub-minute, but requires
   organizational agreement
3. **ENAV self-briefing** — closest to sensor, but requires pilot credentials and
   VPN access
4. **Multi-cycle race logger** — run a longer test to confirm whether the MeteoAM
   lag is consistent or variable; it is possible that some cycles are faster
5. **AVIAMM / MeteoAM real-time agreement path** — the public
   `https://www.meteoam.it/it/disponibilita-dati` page tells third parties
   seeking real-time data/products to contact `AVIAMM`; that is the most
   plausible official path to a faster Italian feed than the public Deda widget

Do NOT spend more time on:

- Ogimet (unreliable, slow)
- public JS hunting on MeteoAM
  - the public `metar-taf` page already shows the only embedded METAR service
    URL, and the public JS grep did not surface a second endpoint
- ENAV's website (no public MET API exposed)

## Sources

- ENAV MET Services:
  - `https://www.enav.it/en/what-we-do/we-create-solutions-for-international-markets/meteorologia/met-services`
- ENAV Online Services:
  - `https://www.enav.it/en/online-services`
- ENAV Self-Briefing:
  - `https://selfbriefing.enav.it/`
- MeteoAM METAR/TAF page:
  - `https://www.meteoam.it/it/metar-taf`
- MeteoAM Deda OWS API:
  - `https://api.meteoam.it/deda-ows/metar-taf-icao/LIMC/{time1}/{time2}`
- MeteoAM station-observation endpoint:
  - `https://api.meteoam.it/deda-ows/api/GetStation/LIMC`
- MeteoAM OpenAPI spec:
  - `https://api.meteoam.it/deda-ows/openapi.json`
- MeteoAM Data Availability:
  - `https://www.meteoam.it/it/disponibilita-dati`
- SADIS API — SWIM Registry:
  - `https://eur-registry.swim.aero/services/met-office-sadis-opmet-api-100`
- SADIS API User Guide:
  - `https://www.icao.int/sites/default/files/METP/Documents/SADIS-API-User-Guide-1st-Edition.pdf`
- EUROCONTROL NM B2B:
  - `https://www.eurocontrol.int/service/network-manager-business-business-b2b-web-services`
- EUROCONTROL SWIM METAR-SPECI:
  - `https://eur-registry.swim.aero/services/eurocontrol-iwxxm-metar-speci-subscription-and-request-service-10`
- DGAC NM B2B Client JS:
  - `https://github.com/DGAC/nmb2b-client-js`
- MET Norway tafmetar:
  - `https://api.met.no/weatherapi/tafmetar/1.0/documentation`
- Ogimet:
  - `https://www.ogimet.com/getmetar_help.phtml.en`
- NOAA tgftp help:
  - `https://www.weather.gov/tg/datahelp`
- AWC Data API:
  - `https://aviationweather.gov/data/api/`
