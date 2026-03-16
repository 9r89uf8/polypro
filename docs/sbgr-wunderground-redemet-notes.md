# SBGR Wunderground / REDEMET Notes

## Purpose

Capture the current findings about the Wunderground SBGR history page, the Weather.com endpoints it exposes, and the official Brazilian source surfaces available through REDEMET on March 11, 2026.

## Main Surfaces

Wunderground page:

- `https://www.wunderground.com/history/daily/br/guarulhos/SBGR`

Official provider:

- `https://www.redemet.aer.mil.br`
- current app host redirects to:
  - `https://redemet.decea.mil.br`

Organization:

- `DECEA - Departamento de Controle do Espaco Aereo`

## Wunderground SBGR Page

Raw page HTML confirms the route is tied to:

- `SBGR`
- `Guarulhos - Governador Andre Franco Montoro Intl Airport Station`
- geocode:
  - `-23.424,-46.478`

Important rendering note:

- the server-rendered HTML mostly contains the shell and embedded cache objects
- the raw HTML text still shows:
  - `Summary -> No data recorded`
  - `Daily Observations -> No Data Recorded`
- so the visible history table/chart is hydrated client-side, not server-rendered in the initial HTML response

## Weather.com Endpoints Exposed By The SBGR Page

Embedded public Weather.com key already present in the Wunderground page:

- `e1f10a1e78da46f5b10a1e78da96f525`

Embedded airport/location endpoints:

- `https://api.weather.com/v3/location/point?apiKey=...&language=en-US&icaoCode=SBGR&format=json`
- `https://api.weather.com/v3/wx/observations/current?apiKey=...&language=en-US&units=e&format=json&icaoCode=SBGR`
- `https://api.weather.com/v3/wx/observations/current?apiKey=...&geocode=-23.424,-46.478&units=e&language=en-US&format=json`
- `https://api.weather.com/v3/dateTime?apiKey=...&geocode=-23.424,-46.478&format=json`
- `https://api.weather.com/v3/wx/forecast/daily/5day?apiKey=...&geocode=-23.424,-46.478&units=e&language=en-US&format=json`
- `https://api.weather.com/v3/location/near?apiKey=...&geocode=-23.424,-46.478&product=pws&format=json`

Embedded PWS clues:

- page HTML contains the generic path:
  - `https://api.weather.com/v2/pws/history`
- page HTML also contains nearby/current PWS requests such as:
  - `https://api.weather.com/v2/pws/observations/current?apiKey=...&units=e&stationId=ISOPAU288&format=json`
  - `https://api.weather.com/v2/pws/observations/current?apiKey=...&units=e&stationId=ISOPAU318&format=json`

Observed airport metadata from `v3/location/point`:

- `icaoCode=SBGR`
- `city=Guarulhos`
- `adminDistrict=Sao Paulo`
- `airportName="Guarulhos - Governador Andre Franco Montoro Intl Airport"`
- `locId="GRU:9:BR"`
- `pwsId="ISOPAU182"`

Observed current airport conditions from `v3/wx/observations/current` at `2026-03-11T19:52:17-0300`:

- `temperature=68 F`
- `dewPoint=68 F`
- `pressureAltimeter=29.98`
- `windDirection=90`
- `windSpeed=5 mph`
- `wxPhraseLong="Mostly Cloudy"`
- `validTimeUtc=1773269537`

Interpretation:

- this is a current-observation feed, not raw METAR text
- it updates on a sub-hour cadence

## Likely Wunderground History Feed

Using the `pwsId` exposed by `v3/location/point`, this worked:

- `https://api.weather.com/v2/pws/history/all?stationId=ISOPAU182&format=json&units=e&date=20260311&apiKey=...`

Observed behavior:

- returns a dense `5-minute` history series for `2026-03-11`
- rows included times like:
  - `2026-03-11T03:04:46Z`
  - `2026-03-11T03:09:54Z`
  - `2026-03-11T03:14:54Z`
  - ...
  - `2026-03-11T22:54:55Z`
  - `2026-03-11T22:59:59Z`

Observed `ISOPAU182` coordinates from that history feed:

- `lat=-23.572233`
- `lon=-46.617908`

Distance from the airport geocode shown on the SBGR page:

- about `21.8 km`

Interpretation:

- Wunderground clearly exposes a usable 5-minute Weather.com history feed for a nearby PWS tied to the SBGR page context
- that PWS is not located at the airport coordinates
- so the Wunderground page appears to mix:
  - airport current conditions / airport identity
  - nearby PWS-oriented history capability
- this is not the same thing as official raw airport METAR history

## REDEMET Frontend And Public API

The current REDEMET SPA shell is:

- `https://redemet.decea.mil.br`

Its main JS bundle exposed:

- `REACT_APP_API_URL="https://api-redemet.decea.mil.br"`
- `REACT_APP_TOKEN_API="ouyaq0gZ4pEyTFIz86fJyby2snpspM66yU728dB2"`

Observed frontend HTTP client behavior:

- base URL:
  - `https://api-redemet.decea.mil.br`
- appends:
  - `api_key=ouyaq0gZ4pEyTFIz86fJyby2snpspM66yU728dB2`

Important handling note:

- this `api_key` is publicly embedded in the production REDEMET JS bundle
- treat it as app-coupled and subject to change
- local env storage now uses:
  - `REDEMET_API_BASE_URL`
  - `REDEMET_API_KEY`
  - `REDEMET_SBGR_LATEST_METAR_URL`
  - `AISWEB_API_BASE_URL`
  - `AISWEB_CANONICAL_API_BASE_URL`
  - `AISWEB_API_KEY`
  - `AISWEB_API_PASS`
  - `AISWEB_SBGR_LATEST_MET_URL`
  - `AISWEB_SBGR_CANONICAL_MET_URL`

## Official Latest SBGR Endpoint

Most useful official current endpoint found:

- `https://api-redemet.decea.mil.br/aerodromos/info?localidade=SBGR&metar='sim'&taf='sim'&aviso='sim'&api_key=...`

Observed live response fields included:

- `localidade`
- `nome`
- `cidade`
- `lon`
- `lat`
- `localizacao`
- `metar`
- `data`
- `temperatura`
- `ur`
- `visibilidade`
- `teto`
- `ceu`
- `condicoes_tempo`
- `tempoImagem`
- `vento`
- `aviso`
- `taf`
- `tafDec`

Observed live SBGR sample:

- `localidade=SBGR`
- `nome="Aeroporto Internacional de Sao Paulo"`
- `cidade="Sao Paulo/SP"`
- `data="11/03/2026 22:00(UTC)"`
- `metar="METAR SBGR 112200Z 09004KT 9999 SCT008 BKN011 20/20 Q1015="`
- `taf="TAF SBGR 111630Z 1118/1224 10008KT 8000 BKN009 TN19/1209Z TX22/1216Z ... RMK PGE="`

Interpretation:

- this is the cleanest official latest-SBGR endpoint we found
- it returns raw METAR and raw TAF directly in JSON

## Official METAR Message Endpoint

Observed public message-history endpoint:

- `https://api-redemet.decea.mil.br/mensagens/metar/SBGR?api_key=...&data_ini=2026031400&data_fim=2026031404&page_tam=10`

Observed live fields included:

- `id_localidade`
- `validade_inicial`
- `mens`
- `recebimento`

Observed live SBGR sample rows:

- `validade_inicial="2026-03-14 03:00:00"`
- `mens="METAR SBGR 140300Z 07003KT 7000 3000E FEW003 17/17 Q1014="`
- `recebimento="2026-03-14 02:58:44"`

- `validade_inicial="2026-03-14 04:00:00"`
- `mens="METAR SBGR 140400Z 00000KT 8000 NSC 16/16 Q1014="`
- `recebimento="2026-03-14 03:55:47"`

Interpretation:

- this endpoint is much more interesting than `aerodromos/info` for timing work
- `recebimento` looks like the time REDEMET received or registered the message,
  not the later time the summary endpoint refreshed
- because those `recebimento` timestamps arrive a few minutes before the hour,
  this endpoint looks materially closer to `Banco OPMET` than the delayed
  public summary path
- if the goal is to find the closest public web proxy to the operational SBGR
  source, `mensagens/metar` is now the best official Brazilian lead

## Official SPECI Feed

Observed public message endpoint:

- `https://api-redemet.decea.mil.br/mensagens/speci?api_key=...`

Observed behavior:

- paginated JSON list of current/recent `SPECI` messages across Brazil
- sample rows included stations such as:
  - `SBBI`
  - `SBCO`
  - `SBSP`
  - `SBLB`

Observed at the sampled run:

- `SBGR` was not present in the current `SPECI` list at that moment

## Other Official Aeronautical Message Feeds

Observed public JSON feeds:

- `https://api-redemet.decea.mil.br/mensagens/sigmet?api_key=...`
- `https://api-redemet.decea.mil.br/mensagens/airmet?api_key=...`
- `https://api-redemet.decea.mil.br/mensagens/gamet?api_key=...`

Observed `SIGMET` feed behavior:

- paginated JSON list
- each row includes:
  - `id_fir`
  - `validade_inicial`
  - `validade_final`
  - `mens`
  - `no_mens`
  - `title`
  - `fenomeno`
  - `fenomeno_comp`
  - `fenomeno_cor`
  - `fenomeno_transparencia`
  - `lat_lon`

Interesting detail:

- the feed already includes polygon coordinates in `lat_lon`
- so REDEMET is not just exposing raw SIGMET strings; it is also exposing precomputed map geometry

Observed `AIRMET` feed behavior:

- same paginated JSON shape style as `SIGMET`
- sample phenomena included:
  - `BKN CLD`
  - `SFC VIS`
- sample rows included geometry polygons in `lat_lon`

Observed `GAMET` feed behavior:

- paginated JSON list
- includes raw `mens`
- also includes a nested `decoded` object

Observed `decoded` GAMET fields included:

- `FIR`
- `REPORT`
- `VALID`
- `HEADER`
- `SECTION_I`
- `SECTION_II`

Observed structured subfields included:

- `SFC_VIS`
- `SIGWX`
- `SIG_CLD`
- `ICE`
- `PSYS`
- `WIND/T`
- `CLD`
- `FZLVL`
- `MNM_QNH`
- `SEA`
- `VA`

Interpretation:

- REDEMET already exposes structured low-level aviation products, not only raw strings
- `GAMET` is especially useful because the JSON already contains a machine-readable decode

## Official Decoder Endpoint

Observed public decoder endpoint:

- `https://api-redemet.decea.mil.br/mensagens/sigmet/decoder?api_key=...`

Observed behavior:

- accepts a JSON body with:
  - `{"message":"<raw sigmet text>"}`
- returns structured JSON

Observed decoded `SIGMET` fields included:

- `fir`
- `fir_name`
- `sigmet_num`
- `validity`
- `phenomena`
- `status`
- `area_description`
- `coordinates`
- `movement`
- `intensity`
- `flight_levels`
- `fir_boundary`

Interesting detail:

- the decoder response includes both:
  - the parsed event polygon in `coordinates`
  - the full FIR boundary polygon in `fir_boundary`

Interpretation:

- REDEMET exposes a public official raw-to-structured aviation-message parser
- that is a stronger surface than a plain text-only bulletin feed

## Official Historical Message Search

The REDEMET app still links to a legacy modal search UI at:

- `https://redemet.decea.mil.br/old/modal/consulta-de-mensagens/`

Observed form behavior:

- method: `POST`
- same-page HTML response
- supports:
  - latest-only lookup
  - bounded time-range lookup up to `24 hours`
- help text on the page says historical queries can go back to `November 2002`

Useful POST fields for SBGR METAR queries:

- `acao=localidade`
- `msg_localidade=SBGR`
- `tipo_msg[]=metar`
- optional latest-only flag:
  - `consulta_recente=sim`
- optional range:
  - `consulta_data_ini=DD/MM/YYYY HH:MM`
  - `consulta_data_fim=DD/MM/YYYY HH:MM`

Latest-only sample:

- POST with `consulta_recente=sim`
- returned HTML table row:
  - `METAR SBGR 112200Z 09004KT 9999 SCT008 BKN011 20/20 Q1015=`

Range sample:

- POST with:
  - `consulta_data_ini=11/03/2026 18:00`
  - `consulta_data_fim=11/03/2026 23:00`
- returned rows:
  - `METAR SBGR 111800Z 05006KT 8000 -RA SCT010 OVC070 22/19 Q1016=`
  - `METAR SBGR 111900Z 09005KT 9000 -RA SCT030 BKN040 22/20 Q1016=`
  - `METAR SBGR 112000Z 07006KT 9999 FEW010 SCT023 OVC035 22/20 Q1015=`
  - `SPECI SBGR 112040Z 11003KT 4500 -RA BR OVC009 22/20 Q1015=`
  - `METAR SBGR 112100Z 12006KT 6000 -RA BKN009 BKN013 21/20 Q1015=`
  - `METAR SBGR 112200Z 09004KT 9999 SCT008 BKN011 20/20 Q1015=`
  - `METAR SBGR 112300Z 09006KT 8000 -RA BKN009 BKN017 21/19 Q1016=`

Full-day sample on `2026-03-11`:

- query window:
  - `11/03/2026 00:00` to `11/03/2026 23:59`
- returned:
  - `25` total SBGR messages
- cadence breakdown:
  - `24` hourly `METAR`
  - `1` `SPECI`

Observed off-hour official special report:

- `SPECI SBGR 112040Z 11003KT 4500 -RA BR OVC009 22/20 Q1015=`

Interpretation:

- official SBGR routine cadence on this sampled day was hourly
- off-hour reports are exposed as `SPECI` when needed
- there is no evidence here of a routine 5-minute official METAR stream

## Less Useful REDEMET Endpoints

Sampled but not useful in this run:

- `aerodromos/status?pais=br&emcar=true`
- `aerodromos/status/localidades/br`

Observed behavior:

- both returned `{"status":true,"message":"","data":[]}`

So for SBGR, the practical official surfaces are:

- `mensagens/metar/SBGR` for the closest public message-bank timing path
- `aerodromos/info` for the simple latest summary payload
- `old/modal/consulta-de-mensagens/` for historical HTML lookup

## Practical Takeaways

- If you want official latest raw SBGR:
  - use `api-redemet.decea.mil.br/mensagens/metar/SBGR?...` first
  - use `api-redemet.decea.mil.br/aerodromos/info?...` if you want the simpler summary payload
- If you want official SBGR history over a chosen window:
  - use `redemet.decea.mil.br/old/modal/consulta-de-mensagens/` with a POST and parse the returned HTML table
- If you want dense 5-minute weather-style history from the Wunderground/Weather.com side:
  - the exposed `v2/pws/history/all` feed works for `ISOPAU182`
  - but that feed is from a nearby PWS about `21.8 km` from the airport geocode
  - so it should not be treated as official SBGR METAR history
- Wunderground and REDEMET are not interchangeable here:
  - Wunderground gives convenient Weather.com current/PWS-style data
  - REDEMET gives the authoritative raw METAR/TAF surfaces

## Live Publication Timing Check

Directly measured live rollover for the `120000Z` SBGR METAR on `2026-03-12`:

- REDEMET `aerodromos/info` first changed at:
  - `2026-03-12 00:00:06 UTC`
- new REDEMET report:
  - `METAR SBGR 120000Z 08007KT 9999 BKN009 BKN023 21/19 Q1017=`

- NOAA `tgftp` `SBGR.TXT` first changed at:
  - `2026-03-12 00:01:07 UTC`
- `tgftp` HTTP `Last-Modified` on the new file:
  - `Thu, 12 Mar 2026 00:01:03 GMT`
- new `tgftp` file contents:
  - `2026/03/12 00:00`
  - `SBGR 120000Z 08007KT 9999 BKN009 BKN023 21/19 Q1017`

Measured result for that cycle:

- REDEMET published first
- observed lead over `tgftp` was about `61 seconds`

Scope note:

- this was one directly measured live cycle
- later broader sampling on March 13-14, 2026 did not reproduce that result
- treat this single cycle as an early outlier, not the final practical model

## One-Day Practical Result

After about one day of sampled routine SBGR cycles on `2026-03-13` through
`2026-03-14`, the observed public ordering settled into:

- NOAA `tgftp` first, usually by about `5 minutes`
- REDEMET second
- AISWEB third, usually about `2-3 seconds` behind REDEMET

Practical interpretation:

- `tgftp` is the fastest public routine-hourly SBGR `METAR` surface we tested
- REDEMET remains valuable because it preserves off-hour official `SPECI`
- AISWEB is useful as an official DECEA cross-check, but in the sampled cycles
  it did not beat REDEMET

Important scope note:

- that one-day ordering was measured against the slower REDEMET summary-style
  public path, not the closer `mensagens/metar` endpoint with `recebimento`
- the in-repo race logger now targets `mensagens/metar` instead because it is
  the best public Brazilian candidate to beat NOAA `tgftp`

## Likely Operational Dissemination Path

Official DECEA / WMO / NWS material strongly suggests that NOAA is not pulling
SBGR from REDEMET. The more likely path is the operational OPMET / telecom
network, with REDEMET as a slower public presentation layer.

Strongest official evidence:

- Brazil AIP `GEN 3.5` says the `EMS` / `EMS-A` surface meteorological stations
  are responsible for making and disseminating:
  - `METAR`
  - `SPECI`
  - `METAR AUTO`
  - `SPECI AUTO`
- The same AIP says the `CMI` provides:
  - `VOLMET`
  - `D-VOLMET`
  which are operational aviation weather dissemination services
- DECEA's `EMA-800` quality material for `EMS-A3` says the station transmits
  `METAR AUTO` / `SPECI AUTO` to the `Banco Internacional de Mensagens OPMET de
  Brasília`
- DECEA's own quality indicator for manual `METAR/SPECI` measures the
  `Índice de envio do METAR/SPECI dentro do horário` to the `Banco OPMET`
  and cites `Fonte dos dados: REDEMET e Banco OPMET`
  - sampled SBGR row:
    - `AERÓDROMO: SBGR`
    - `Indicador: 99.75`
- WMO says operational `OPMET` information (`METAR`, `SPECI`, `TAF`, `SIGMET`,
  etc.) is disseminated in real time over ICAO-approved aeronautical and
  meteorological telecommunication networks
- NWS Telecommunications Gateway documentation says the US international
  switching centers sit on the WMO GTS main trunk network and that the gateway
  operates the `OPMET data bank` containing aviation messages like `METAR`,
  `TAF`, `SIGMET`, and `AIRMET`

Most defensible path from those sources:

1. SBGR observation is produced by the Brazilian aeronautical meteorology
   station / service (`EMS`, `EMS-A`, `CMA`, under DECEA / CIMAER)
2. The operational report is sent to the Brazilian `Banco OPMET`
3. From there it is exchanged over ICAO / WMO operational telecom paths
   (`AFTN` / `AMHS` / `GTS` style network)
4. NOAA/NWS ingests that operational traffic into its own `OPMET data bank`
5. `tgftp` latest-station text updates from that operational side
6. REDEMET public latest endpoints can lag because they are a different public
   app / API layer

Inference note:

- Steps `2` through `5` are the most defensible interpretation of the official
  documents plus the measured timing behavior
- I do not have packet-level proof of the exact Brazil-to-NOAA routing path for
  SBGR specifically
- But the official docs make `Banco OPMET`, not the REDEMET public API, look
  like the operational timeliness-critical system

## Other Official Public Surface Worth Timing

The official DECEA `AISWEB` aerodrome page for SBGR also shows current
operational weather fields directly, including the latest raw `METAR`:

- `https://aisweb.decea.mil.br/?i=aerodromos&codigo=SBGR`

Sampled page details included:

- current `METAR`
- `CMA 24HR`
- `D-ATIS: 127.750`
- wind / visibility / cloud / temperature / QNH fields

Practical implication:

- if we want the closest public Brazilian mirror to the operational side, the
  next useful timing comparison is likely:
  - `AISWEB` vs `tgftp` vs `REDEMET`

What the page source shows:

- the SBGR `METAR` / `TAF` block is server-rendered HTML, not a client-side
  weather XHR/fetch
- that weather block is explicitly branded with the `REDEMET` logo
- the only public AISWEB page-level API calls I found on that aerodrome page
  were:
  - `area=notam`
  - `area=sol` (sunrise/sunset)
- sampled `area=sol` response was only:
  - date
  - sunrise
  - sunset
  - weekday
  - aerodrome
  - coordinates
- I did not find a public client-side AISWEB weather API call for the displayed
  SBGR `METAR` / `TAF`

Most defensible interpretation:

- AISWEB is probably rendering that weather block from:
  - the same REDEMET/public meteorology backend, or
  - a shared internal DECEA/CIMAER meteorology data source
- I do not yet have proof that AISWEB is pulling directly from the public
  REDEMET API endpoint itself

## Direct AISWEB Meteorology API

The official AISWEB API documentation page does expose a dedicated meteorology
service:

- `Informações Meteorológicas (met) - mensagens METAR/TAF de acordo com a localidade escolhida`

Direct live SBGR probe:

- `https://aisweb.decea.mil.br/api/?apiKey=...&apiPass=...&area=met&icaoCode=SBGR`

Sample live response:

```xml
<aisweb>
  <met>
    <loc>SBGR</loc>
    <metar>METAR SBGR 140200Z 09002KT 9999 FEW006 17/17 Q1015=</metar>
    <taf>TAF SBGR 132200Z 1400/1506 ...</taf>
  </met>
</aisweb>
```

Useful implications:

- there is an official DECEA public API surface for SBGR `METAR` / `TAF`
- this is more direct than scraping:
  - `https://aisweb.decea.mil.br/?i=aerodromos&codigo=SBGR`
- the AISWEB aerodrome page and the direct `area=met` API returned the same
  SBGR `METAR` in the sampled run
- this `area=met` route is now the best official DECEA public candidate to time
  against:
  - `tgftp`
  - `REDEMET`

## Canonical AISWEB Gateway

The official AISWEB Postman documentation points to a canonical API gateway:

- `https://api.decea.mil.br/aisweb/?apiKey=...&apiPass=...&area=met&icaoCode=SBGR`

Observed behavior on `2026-03-15`:

- it returned the same SBGR `METAR` / `TAF` XML payload as the
  `aisweb.decea.mil.br/api/` alias
- response headers identified the host as a Kong gateway:
  - `Via: kong/3.5.0`
  - `Processor: kong-logging`
  - `Environment: production`
  - `X-Kong-Upstream-Latency: 353`

Practical implication:

- this is now worth timing separately from the `aisweb.decea.mil.br/api/` alias
- if there is a public AISWEB surface closer to the backend than the page alias,
  this canonical gateway host is the strongest candidate

Architecture note:

- an official DECEA SWIM workshop slide deck lists `AISWEB` among the systems
  that consume `API-REDEMET`
- that makes it less likely that any AISWEB web surface will beat the closer
  REDEMET message endpoint on first publication timing

Important access note:

- the public AISWEB API page says API access should be requested from DECEA
- the SBGR aerodrome page source still embeds an `apiKey` / `apiPass` pair
  that works for `area=sol`
- in the sampled run, that same pair also worked for `area=met`
- because those credentials are page-exposed and may change, treat them as
  unstable implementation details rather than a permanent contract

## In-Repo Publish Race Logger

The repo now includes an SBGR publish-race logger built on top of the official
AISWEB gateway `area=met` endpoint, the official AISWEB site/API alias,
the official REDEMET `mensagens/metar` endpoint, the hidden REDEMET `pwa`
endpoint, and NOAA `tgftp`.

Current implementation:

- REDEMET `mensagens/metar` poll path writes first-seen times into
  `redemetPublishRaceReports`
- REDEMET `mensagens/metar` also contributes the official `recebimento`
  timestamp into `redemetPublishRaceReports`
- NOAA `tgftp` race rows are written by a dedicated race poller
- an hourly watch window starts at minute `55`
- the scheduled watch currently runs for `10 minutes`
- during that watch window the app polls both sources every few seconds
  and stores whichever source first exposed each new SBGR report

Important scope limit:

- this watch is reliable for the routine hourly SBGR `METAR` race
- it is not a trustworthy mid-hour `SPECI` race measurement
- REDEMET can still surface useful off-hour `SPECI` rows that appear in the day
  chart and raw observations table
- the SBGR page now filters the race table down to routine `METAR` rows only so
  those off-hour `SPECI` do not get misleading `winner` / `lead` readings

Stored race fields include:

- `reportTsUtc`
- `redemetFirstSeenAt`
- `redemetReceivedAt`
- `tgftpFirstSeenAt`
- optional `tgftpLastModifiedAt`
- `winner`
- `leadMs`

The SBGR day page now shows the recent race rows directly.

Current practical reading:

- the older March 13-14, 2026 summary-path sampling favored NOAA `tgftp`
- later March 14-15, 2026 timing showed the AISWEB gateway, AISWEB site alias,
  and hidden REDEMET `pwa` route all lagging the closer
  `REDEMET mensagens/metar` surface
- the live in-repo race logger is therefore narrowed back down to the only
  public Brazilian candidate that still matters:
  `REDEMET mensagens/metar` vs NOAA `tgftp`

## REDEMET LITE Hidden Current Endpoint

The separate official `REDEMET LITE` app at:

- `https://redemet-app.decea.mil.br/`

uses the same `api-redemet.decea.mil.br` host, but its frontend bundle maps its
current airport weather method to a hidden route:

- `https://api-redemet.decea.mil.br/mensagens/pwa/SBGR?api_key=...`

Observed live response on `2026-03-15`:

```json
{
  "SBGR": {
    "metar": "METAR SBGR 150000Z 12002KT 8000 NSC 21/20 Q1014=",
    "taf": "TAF SBGR 142200Z 1500/1606 ..."
  }
}
```

Interpretation:

- this is a lean current-only official aerodrome weather endpoint
- it is much simpler than `aerodromos/info`
- it may be a stronger public first-seen race candidate than the older summary
  endpoint
- unlike `mensagens/metar`, it does not expose `recebimento`

Current practical reading:

- for public web timing, only two sources still matter:
  - `mensagens/metar/SBGR` for the closest Brazilian public signal
  - NOAA `tgftp` for the fastest public publish we have measured so far
- the AISWEB gateway, AISWEB site alias, and hidden `pwa` path are now treated
  as investigated but retired

Adjacent official REDEMET endpoint:

- `https://api-redemet.decea.mil.br/mensagens/meteograma/{localidade}`

Official help docs describe it as:

- a REDEMET database view over `METAR`, `TAF`, and Aerodrome Warning messages
- returning decoded groups such as:
  - wind
  - visibility
  - ceiling
  - `tt` temperature
  - `po` dew point
  - `qnh`
- up to `96` past hours based on the requested time

Practical implication:

- it looks like a richer decoded view over the same message bank, not a closer
  first-publication path than `mensagens/metar`
- useful for decoded temperature series
- not currently the best candidate for beating `tgftp`

## Operational Channels From Official ROTAER

The official AISWEB `rotaer` record for `SBGR` does not expose a fresher web
METAR feed, but it does expose the operational channels around the airport MET
service itself:

- `service type="ATIS"` with callsign `São Paulo`
- `freq=127.750`
- `compl n="6" = D-ATIS`
- `service type="MET"` with `contact=(11) 2445-2179`
- `compl n="7"` says flight plans and updates are accepted by `TEL/CMA` on:
  - `(11) 2445-2179`
  - `(11) 2445-3205`
  - `TEL PLN: (11) 2445-3185`

Practical implication:

- the public web hunt is probably near its limit
- the next serious leads are operational channels tied to the airport MET
  service itself:
  - `ATIS / D-ATIS`
  - `TEL/CMA`
  - whatever Banco OPMET / AMHS / AFTN path sits behind those services

Official DECEA service note:

- AIP `GEN 3.4` says `D-ATIS` is a digital system that provides the same
  operational content in synthesized voice and text, updated simultaneously
- it is provided to properly equipped aircraft that request it, via datalink
- if text and synthesized voice ever disagree, the voice broadcast prevails
- the same chapter also lists `VOLMET` / `D-VOLMET` as the in-flight
  meteorological broadcast / datalink services

Practical implication:

- `D-ATIS` is a real official next lead, but it is not a normal public web API
- if we want something fresher than `tgftp`, the remaining path is likely a
  datalink / radio / operational distribution surface rather than another
  browser endpoint

SBGR-specific access shape from `AD 2.18`:

- `ATIS` callsign: `INFORMAÇÕES GUARULHOS / GUARULHOS INFORMATION`
- voice frequency: `127.750 MHZ`
- hours: `H24`
- `Data Link AVBL`
- `SATVOICE`: `NIL`
- `Logon address`: `NIL`

Practical interpretation:

- `SBGR` definitely has both voice `ATIS` and `D-ATIS`
- but DECEA does not publish a public `SATVOICE` number, phone bridge, or
  datalink `Logon address` for public use in the AIP entry
- so the official documentation confirms the service exists, but it does not
  expose a public self-service way to retrieve `D-ATIS` text over the web

Current best practical capture options:

- official / operational:
  - equipped-aircraft `D-ATIS`
  - direct voice monitoring of `127.750`
- unofficial but reachable:
  - third-party scanner / radio-monitor pages that relay `SBGR ATIS`
  - these may help us measure first public audio availability, but they are not
    an official DECEA distribution path

Observed unofficial relay options:

- `Aeroescuta` has a dedicated `SBGR` page:
  - `https://aeroescuta.com.br/sample-page/fonias-guarulhos-gru/`
  - it exposes an embedded `ESCUTA DO ATIS DE GUARULHOS` player alongside
    tower / ground / traffic streams
- `ATIS.guru` exposes a nominal `SBGR` D-ATIS page, but the sampled page
  currently showed `No ATIS available` while also displaying stale sample text
  from `2026-03-13 08:22 UTC`, so it is not a dependable capture path
- the `ATIS.guru` front page says its D-ATIS feed is collected from `ACARS`
  messages and only appears when an aircraft actually requests D-ATIS

Practical implication:

- if we want a reachable ATIS monitor without operational authorization, the
  strongest current option is a live radio relay such as `Aeroescuta`
- this would let us test whether public audio of the voice `ATIS` flips before
  `NOAA tgftp`, even though it would not be an official DECEA distribution path

In-repo experiment:

- `scripts/capture-sbgr-atis-audio.mjs`
- purpose:
  - discover the current `SBGR` ATIS relay stream from the Aeroescuta page
  - record short timestamped `.mp3` samples
  - log the concurrent `NOAA tgftp` latest-METAR state into a `manifest.jsonl`
    file for later comparison
- current embedded relay discovered from the Aeroescuta page:
  - `https://ssl1.transmissaodigital.com:20102/127.75ATISGRURCB`
- default output directory:
  - `/tmp/sbgr-atis-samples`
- useful environment overrides:
  - `SBGR_ATIS_SAMPLE_MS`
  - `SBGR_ATIS_INTERVAL_MS`
  - `SBGR_ATIS_TOTAL_MS`
  - `SBGR_ATIS_OUTPUT_DIR`
  - `SBGR_ATIS_STREAM_URL`
- smoke-test result on `2026-03-15`:
  - the script successfully recorded timestamped `.mp3` samples and manifest
    rows
  - the relay responded as `audio/mpeg`
  - the stream exposed `icy-metaint=16000`
  - the `icy-name` header was `CONTROLE`, even though the Aeroescuta page
    labels this player as `ATIS`
  - so the relay is reachable, but the actual audio content should still be
    confirmed by listening or transcription before treating it as a strict
    `ATIS` source

False lead note:

- the official AISWEB `area=infotemp` API probe returned:
  - `<infotemp total="0">`
- so `infotemp` is not the missing SBGR METAR or live-temperature feed

Additional official SBGR communications note:

- the SBGR `AD 2.18` communications table in the Brazilian eAIP shows:
  - `CLEARANCE` with `Data Link AVBL`
  - `ATIS` on `127.750 MHZ`
  - `ATIS` also marked `Data Link AVBL`
- that fits the `rotaer` record showing `D-ATIS` and reinforces that the
  fresher operational path is probably datalink / radio, not another browser
  API

## Banco OPMET / AFTN Path

The strongest official description of the root operational path is in AIP
`GEN 3.5`.

Official Banco OPMET function summary:

- Banco OPMET is the `Banco Internacional de Dados Operacionais de
  Meteorologia`
- its functions include:
  - receiving, selecting, storing, and automatically sending meteorological
    information for Brazilian and CAR/SAM aviation use
  - recognizing meteorological information requests received via `AFTN`
  - automatically sending requested meteorological information to subscribed
    `AFTN` recipients, with optional additional recipients
- the Brasília OPMET database `AFTN` designation is `SBBRYZYX`
- the bank supplies at least:
  - `METAR`
  - `SPECI`
  - `TAF`
  - `SIGMET`
  - `AIRMET`
  - `AIREP`
  - `GAMET`
  - area forecasts

Practical implication:

- this looks like the real operational root behind the SBGR report flow
- it is an aeronautical messaging path, not a public web API
- unless we have access to an `AFTN` / `AMHS`-facing operational channel, the
  closest public Brazilian web proxy remains `REDEMET mensagens/metar`

Current best model for SBGR:

- `SBGR observation / Brazilian MET service`
- `Banco OPMET / AFTN-style operational dissemination`
- public republishers like `NOAA tgftp`
- slower downstream Brazilian public web layers such as `REDEMET` summary,
  `PWA`, and `AISWEB`

## Authorized Operational Gate: AMHS WEB

The first concrete non-public Brazilian endpoint family I found is:

- `https://amhsbr.decea.mil.br/taweb/`

Observed official signals:

- public search results expose it as `AMHS WEB`
- it is branded as a DECEA system
- it presents a login / access-request flow
- the access form includes fields such as:
  - `Endereço AFTN`
  - `Código ICAO`
- the page says non-users can request inclusion through the access request flow

Practical implication:

- this is much closer to the operational messaging path than any public
  REDEMET or AISWEB page
- it strongly suggests the real "beat tgftp" path is an authorized
  `AMHS` / `AFTN` endpoint, not another public web API

Related official architecture clues:

- a DECEA SWIM workshop deck says the `API-REDEMET` already serves other DECEA
  systems such as `AISWEB`
- a CISCEA / DECEA note on the new OPMET architecture says:
  - Banco OPMET receives, processes, and retransmits operational meteorological
    messages
  - `AMHS` is the main communication medium for the OPMET system
  - the bank handles more than `300,000` messages per day
- a DECEA directive notes the Banco OPMET evolution toward newer `IWXXM`
  versions to keep meteorological interchange interoperable

Practical conclusion:

- the public web race is effectively exhausted
- the remaining realistic ways to beat `NOAA tgftp` are:
  - authorized access to `AMHS WEB` / `AFTN` / Banco OPMET-side message flow
  - operational `ATIS / D-ATIS`
  - direct airport-side `MET` / `CMA` channels

## Brazilian Aeronautical MET System Map

The official organizational picture is now clearer.

Main actors:

- `CIMAER` (`Centro Integrado de Meteorologia Aeronáutica`)
  - official DECEA unit responsible for coordinating Aeronautical Meteorology
    within the `SISCEAB`
  - multiple eAIP aerodrome pages say questions about the weather portal,
    briefings, and operational MET information should be directed to `CIMAER`
- `CGNA` (`Centro de Gerenciamento da Navegação Aérea`)
  - official DECEA unit responsible for air navigation flow management
  - its `C-AIS` and `SIGMA` systems handle internet/phone access for flight-plan
    and AIS functions, not the MET message root
- `Banco OPMET`
  - operational meteorological message bank
  - official `GEN 3.5` language makes it the core data path for `METAR`,
    `SPECI`, `TAF`, `SIGMET`, `AIRMET`, and related products
- `SISMET`
  - official DECEA / SIRIUS integrated meteorology platform for `CIMAER`
  - official project material says it consolidates radar, aircraft information,
    OPMET messages, satellites, surface and upper-air stations, numerical
    weather products, and Space Weather in a single operational platform
  - official 2024 results material says it also supports `VOLMET`

Practical split:

- `REDEMET`
  - public weather portal / API surface
- `SISMET`
  - internal operational meteorology picture and decision-support platform for
    `CIMAER`
- `SIGMA` / `PLNI`
  - public-ish operational access for AIS / flight-plan workflows
- `Sistema Opmet`
  - authenticated operational console tied directly to the OPMET stack

## Sistema Opmet Webapp

The Banco OPMET side also exposes a separate authenticated web application:

- `https://opmet.decea.mil.br/webapp/#/login`

Observed live characteristics from the current frontend bundle:

- page title: `Sistema Opmet`
- Angular single-page app with JWT-style token storage in `sessionStorage`
- login / forgot-password / change-password flows
- recaptcha site key present in the frontend
- explicit `OBSERVER` role logic in the app
- machine-selection / machine-activation flow
- browser fingerprint handling
- retry/lockout handling around machine keys

Observed backend layout exposed in the bundle:

- `administrator`
- `auth`
- `obs`
- `forecast`
- `report`
- additional service ports for `message`, `proc`, `audit`, `dynamic`, `help`,
  and `grib2`

Observed current frontend environment block:

- the live bundle currently exposes an environment object pointing at
  `https://opmet-dev43.atech.com.br`
- mapped services include:
  - `/administrator`
  - `/auth`
  - `/obs`
  - `/forecast`
  - `/report`
  - ports `30006`, `30010`, `30022`, `30027`, `30029`, and `31449`

Observed runtime environment override:

- the app loads `./assets/environments/environment.json` at runtime
- the public production file currently maps all services to
  `https://opmet.decea.mil.br`
- production service split:
  - `https://opmet.decea.mil.br/administrator`
  - `https://opmet.decea.mil.br/auth`
  - `https://opmet.decea.mil.br/obs`
  - `https://opmet.decea.mil.br/forecast`
  - `https://opmet.decea.mil.br/report`
  - `https://opmet.decea.mil.br/message`
  - `https://opmet.decea.mil.br/proc`
  - `https://opmet.decea.mil.br/audit`
  - `https://opmet.decea.mil.br/dynamic-report`
  - `https://opmet.decea.mil.br/help`
  - `https://opmet.decea.mil.br/grib2`

Interpretation:

- even if the host naming looks non-production, the frontend architecture is
  explicit: separate auth, observation, forecast, reporting, and processing
  services sit behind the `Sistema Opmet` console
- that is much closer to the internal Brazilian MET workflow than any public
  REDEMET or AISWEB page

Practical interpretation:

- this is not a simple public read-only viewer
- it looks like the operational application used by meteorological personnel and
  other authorized users inside the OPMET workflow
- the explicit `OBSERVER` + machine-activation logic strongly suggests station
  observation entry / operational handling, not open public METAR consumption

Public auth artifacts seen in the live bundle:

- a public reCAPTCHA site key is exposed in the frontend
- the baked-in fallback key in the bundle differs from the live production key
- the current production `environment.json` key is:
  `6LffQswaAAAAAJctzd5eodLtmtAQVXs406Yzf61a`
- a hardcoded bearer-looking string also appears in the bundle via `getToken()`,
  but it does not appear to drive the real login flow
- the actual login path in the frontend posts credentials to
  `authUrl + '/login'`
- the app then stores the returned session token in `sessionStorage` and uses
  that token for subsequent API calls

Practical conclusion:

- there is no clear public API key or public client credential in the bundle
  that obviously grants read access to the operational services
- the reCAPTCHA site key is public by design
- the embedded bearer-looking string is more likely a placeholder or dead
  development artifact than a usable public access path

Observed login and session flow:

- login posts to `https://opmet.decea.mil.br/auth/login`
- the frontend sends:
  - `username`
  - `password = btoa(username + password)`
- after login, the app expects an `authorization` token in the response
- it then fetches the user record from:
  `https://opmet.decea.mil.br/administrator/rest/users/{userId}`
- it computes a browser fingerprint locally and stores user/session data in
  `localStorage` and `sessionStorage`
- it starts an `alive` heartbeat against:
  `https://opmet.decea.mil.br/auth/alive`

Observed realtime / post-login transport:

- the frontend opens SockJS / STOMP connections with `X-Authorization`
- auth-side websocket register path:
  `https://opmet.decea.mil.br/auth/register`
- report-side websocket register path:
  `https://opmet.decea.mil.br/report/register`
- after connecting, the report client subscribes to:
  `/user/topic/report/{userId}`
- then publishes to:
  `/app/req-report-status`

Observed anonymous transport metadata:

- both SockJS info endpoints are anonymously reachable:
  - `https://opmet.decea.mil.br/auth/register/info`
  - `https://opmet.decea.mil.br/report/register/info`
- current response shape is the standard SockJS metadata form:
  - `entropy`
  - `origins`
  - `cookie_needed: true`
  - `websocket: true`

Observed gated-vs-public boundary:

- the following production endpoints returned `403` without a real token:
  - `https://opmet.decea.mil.br/auth/alive`
  - `https://opmet.decea.mil.br/administrator/rest/servertime`
  - `https://opmet.decea.mil.br/message/rest/messagetraceability`
  - `https://opmet.decea.mil.br/obs/rest/messageinactive`
  - `https://opmet.decea.mil.br/report/rest/reportqueue`
- even the frontend's odd placeholder header
  `Authorization: not-denied` did not unlock `reportqueue`
- the practical boundary is now clear:
  - publicly reachable metadata:
    - `environment.json`
    - `loginhelp/information`
    - SockJS `/register/info`
  - operational data/services:
    - token-gated

Observed product / workflow shape:

- the route tree includes:
  - `mensagens-meteorologicas/register-flow`
  - `mensagens-meteorologicas/consult`
  - `mensagens-meteorologicas/message-traceability`
  - `mensagens-meteorologicas/rqm`
  - `mensagens-meteorologicas/forecast-message/...`
  - `reports/general-reports/...`
  - `cadastro/aftn-addresses`
  - `cadastro/aftn-address-groups`
  - `cadastro/localidades`
  - `cadastro/maquinas`
  - `cadastro/usuarios`
  - `configuracoes/parameters`
- the weather-message flow includes EMS observation entry and runway subforms
  for temperature, wind, RVR, and summary inputs
- the presence of AFTN address management inside the same app is another strong
  signal that this console sits very close to the operational message-routing
  layer

Observed public access/help path:

- the login help endpoint is public:
  `https://opmet.decea.mil.br/administrator/rest/loginhelp/information`
- current help text tells users to enter their system login, use the forgot
  password flow if needed, and contact the administrator at:
  - `redemet@decea.mil.br`
  - `(21) 2101-6289`

Realistic answer:

- `Sistema Opmet` is the closest semi-visible system to the Brazilian MET core
- but it does not look realistically accessible for a general external user who
  just wants earlier `SBGR` METAR reads
- the likely eligible users are internal staff, contracted operators, or other
  authorized SISCEAB participants

Security posture notes from passive review:

- no obvious anonymous auth bypass was found
- no public API key or client credential was found that unlocked the operational
  services
- the main production service endpoints returned `403` without a real token

Concrete risk / hygiene concerns observed:

- session tokens are stored in `sessionStorage`, and rich user/session state is
  stored in `localStorage`
  - practical implication:
    any successful XSS in the `opmet.decea.mil.br` origin would likely expose
    operational session material and machine-binding context
- the app stores machine-related state in browser storage (`keys`) and uses a
  locally computed fingerprint as part of the machine workflow
  - practical implication:
    this is an operational control, but not a strong standalone secret if the
    browser origin is compromised
- the login flow sends `password = btoa(username + password)`
  - practical implication:
    that encoding is not cryptographic protection; the real protection is TLS
    - this is not a vulnerability by itself, but it is unusual auth design and
      weak build hygiene compared with standard password handling patterns
- the public bundle exposes a detailed internal service map and operational
  workflow structure (`auth`, `obs`, `message`, `forecast`, `report`, `proc`,
  `audit`, `dynamic-report`, `grib2`, AFTN-address management, machine
  activation, message traceability)
  - practical implication:
    this materially improves attacker reconnaissance even though it does not by
    itself break auth
- the bundle still contains fallback config and a bearer-looking token string
  that do not appear to be used in production
  - practical implication:
    this is evidence of imperfect build hygiene, even though we did not confirm
    an exploit path from it
- the SockJS `/register/info` endpoints are anonymously reachable and disclose
  transport metadata
  - practical implication:
    low-severity information exposure
- the public login-help endpoint exposes a real administrator contact
  - practical implication:
    low-severity social-engineering surface

Concrete XSS-relevant findings from the bundle:

- the traceability UI contains an explicit sanitizer bypass:
  - `TraceabilityMessageComponent.getMessage()`
  - it takes server-provided `value`
  - performs a regex `replace(...)`
  - then returns `this.sanitized.bypassSecurityTrustHtml(ret)`
- the traceability template renders that return value through
  `[innerHTML]`
- practical implication:
  if attacker-controlled content can enter the message-traceability data flow,
  Angular's normal HTML sanitization is intentionally bypassed at that sink

- multiple templates render translated strings with `[innerHTML]`, including
  modal and navigation UI fragments
- practical implication:
  if translation content or any upstream string source is compromised, the app
  has several HTML-rendering surfaces to audit carefully

- the sampled `https://opmet.decea.mil.br/webapp/` response did not include a
  `Content-Security-Policy` header
- practical implication:
  if an HTML injection bug exists, there is less browser-side containment than
  there would be with a strong CSP

- the app makes extensive use of browser storage plus browser-side machine keys:
  - `sessionStorage['token']`
  - `localStorage['user']`
  - `localStorage['keys']`
  - `localStorage['token-temp']`
- practical implication:
  any successful DOM XSS on the origin would likely expose:
  - the live auth token
  - user identity and role context
  - machine-binding data used in the operational workflow

Traceability sink data-path analysis:

- the traceability page loads rows from:
  `https://opmet.decea.mil.br/message/rest/messagetraceability`
- the traceability service is explicitly wired to the production
  `environment.messageURL`, and the same bundle wires the compose/edit flows to
  that same `messageURL`
- the app registers a global Angular `JwtInterceptor` that clones outbound
  requests with `Authorization: sessionStorage.getItem('token')`
  - practical implication:
    the message-service calls that do not pass headers inline are still intended
    to be authenticated requests, not anonymous public endpoints
- the table expects backend row fields including:
  - `insertionDate`
  - `message`
  - `detailedDescription`
- the search form filters directly on the backend `message` field via:
  `message=@...`
- the same `message` service family also handles:
  - `messagesearch/...`
  - `inserttacmessage/...`
  - `parsemessages`

Plausible attacker-controlled input sources inside the authenticated workflow:

- the relevant routes are all explicitly auth-gated and role-gated:
  - traceability viewer:
    `mensagens-meteorologicas.message-traceability.r`
  - freeform compose:
    `mensagens-meteorologicas.message-compose.c`
  - other-location compose:
    `mensagens-meteorologicas.other-loc-mes-compose.c`
  - general message consult:
    `mensagens-meteorologicas.all-message.r`
  - edit existing messages from consult screen:
    `mensagens-meteorologicas.all-message.u`
- the `message-compose` route uses a freeform textarea (`app-text`) and is
  explicitly documented in the frontend as a screen that `can receive any type
  of message in text format`
- that freeform textarea is not protected by the shared `acceptTextByRegex`
  directive used on stricter short fields elsewhere in the app
  - the compose template binds:
    - `[(ngModel)]="allMessages"`
    - `(input)="onTextInput($event)"`
    - `(ngModelChange)="onMessageChanged()"`
  - the client-side behavior there is limited to:
    - uppercasing text
    - character counting / max-length enforcement
    - no HTML escaping or regex-based character whitelist on the raw message
      body
- the same component posts raw textarea content directly to:
  `https://opmet.decea.mil.br/message/rest/parsemessages`
  before forwarding parsed TAC content into the message-processing pipeline
- the parser output path does not escape HTML on the client:
  - `formatMessagesParsed(res)` concatenates `header`, `collectiveId`, and
    `m.tac` directly into strings that are then sent onward
  - no client-side HTML escaping or canonicalization was found in that path
- the `other-loc-mes-compose` route uses the same freeform text component and
  posts to:
  `https://opmet.decea.mil.br/message/rest/inserttacmessage/observation`
- the compose acceptance logic is broader than a strict forecast-only workflow:
  - on the `message-compose` screen,
    `isComposeComponentOrForecastMessage(type)` returns true because the active
    component name is `message-compose`, so parsed bodies with non-empty
    `m.tac` are accepted regardless of the forecast-type filter used elsewhere
  - on the `other-loc-mes-compose` screen,
    `isComponseMessageAnotherLocation()` similarly accepts parsed bodies with
    non-empty `m.tac`
- the forecast/text workflow also uses the same freeform text area, parser, and
  processing pipeline before sending messages onward
- the general message-consult screen lets authorized users edit existing message
  TAC content and send updates back through the EMS/message layer
  - the edit UI loads:
    `row.edittedMessage = row.title + '\n' + row.description`
  - the save path then sends:
    `messageCommon.tac = row.edittedMessage ? row.edittedMessage : row.description`
    to:
    `https://opmet.decea.mil.br/message/rest/messageedit`

Practical interpretation of attacker control:

- we did not prove that arbitrary HTML survives server-side validation and is
  later returned by `messagetraceability`
- but the frontend does show multiple authenticated workflows where operators
  can input or alter raw message text that is sent into the same message
  backend family
- the write and read sides now tie to the same production backend family rather
  than only to the same UI module:
  - traceability read:
    `messageURL/rest/messagetraceability`
  - freeform write path:
    `messageURL/rest/parsemessages` ->
    `messageURL/rest/inserttacmessage/...`
  - existing-message edit path:
    `messageURL/rest/messageedit`
- the message-service calls are not evidence of public anonymous write access:
  the bundle's global JWT interceptor indicates they are meant to carry the
  authenticated session token automatically
- the two strongest confirmed paths are now:
  - freeform composition:
    `textarea -> /message/rest/parsemessages -> /message/rest/inserttacmessage/...`
  - edit existing stored content:
    `consult-weather-message textarea -> /message/rest/messageedit`
- among those, the strongest authenticated stored-XSS candidate is the
  existing-message edit flow, not the freeform compose flow
  - reason:
    `messageedit` sends `messageCommon.tac = row.edittedMessage ? row.edittedMessage : row.description`
    directly to the backend family without the extra client-side parse step used
    by compose
  - practical implication:
    if the backend accepts and persists unsafe markup at all, the edit route is
    the shortest and least transformed path into later traceability rendering
- therefore the narrowest defensible conclusion is:
  - the frontend preconditions for an authenticated stored-XSS path are
    confirmed
  - the route roles needed to inject and to view the sink are confirmed
  - exploitability still depends on whether the backend persists and later
    returns unsafe markup in the `message` field without canonicalizing or
    stripping HTML

Threat-model refinement:

- this does not currently look like an unauthenticated public-internet XSS path
- the more realistic threat models are:
  - malicious or compromised authenticated operator
  - compromised upstream message source whose text is persisted and later shown
    in traceability
  - any backend-side sanitation gap in the operational message workflow

Observed browser-security headers on `https://opmet.decea.mil.br/webapp/`:

- present:
  - `Strict-Transport-Security`
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `X-XSS-Protection: 1; mode=block`
- not observed in the sampled response:
  - `Content-Security-Policy`
  - `Referrer-Policy`
  - `Permissions-Policy`

Practical security conclusion:

- the auth boundary appears to be holding
- the main remaining concerns are:
  - XSS blast radius because of browser storage use
  - at least one concrete sanitizer-bypass sink in the traceability flow
  - a plausibly real authenticated stored-XSS path because raw message text can
    be both composed and edited before later traceability rendering
  - information exposure / reconnaissance value from the public bundle
  - build hygiene issues from leftover fallback artifacts

Additional unauthenticated production sweep (`2026-03-16`):

- the following sensitive production endpoints again returned `403` without a
  token:
  - `https://opmet.decea.mil.br/auth/alive`
  - `https://opmet.decea.mil.br/administrator/rest/servertime`
  - `https://opmet.decea.mil.br/message/rest/messagetraceability`
  - `https://opmet.decea.mil.br/obs/rest/messageinactive`
- the anonymous SockJS metadata endpoints remained reachable but exposed only
  transport metadata, not operational content:
  - `https://opmet.decea.mil.br/auth/register/info`
  - `https://opmet.decea.mil.br/report/register/info`
  - response shape:
    `{"origins":["*:*"],"cookie_needed":true,"websocket":true,...}`
- practical implication:
  this deeper passive sweep still found no evidence that sensitive operational
  REST data is reachable without an authenticated session token

## AMHS WEB Access Path

The `AMHS WEB` login surface gives the clearest map of how authorized access is
granted.

Observed access-request shape:

- login page: `https://amhsbr.decea.mil.br/taweb/`
- user can request inclusion through the built-in `solicitar acesso` flow
- the request form asks for:
  - user identity details
  - e-mail
  - `Código ANAC`
  - `Endereço AFTN`
  - `Código ICAO`
  - request `Motivo`
- the page tells the user to await administrator contact
- the login page exposes a commercial support number:
  - `+55 61 3364-8377`

Related official DECEA workflow:

- AIC `A 41/2024` says users of AMHS-based message exchange must use the
  centralized Brazilian telegraphic address `SBRJZPZX` for flight-plan
  messaging
- the same AIC says the associated web service for batch ATS messages requires
  contact with the `SIGMA` administrator, who then provides authentication and
  authorization means such as login and password

Practical interpretation:

- authorized access is real
- but it is clearly meant for operational aviation actors already embedded in
  the Brazilian messaging ecosystem
- the request form itself implies that the normal applicant is expected to have
  an aviation role, an `ICAO` context, and often an `AFTN` identity

Realistic answer for SBGR message access:

- realistic if you are:
  - an airline
  - a dispatch / operations shop
  - an airport or MET unit
  - another authorized SISCEAB / AFTN participant
- probably unrealistic as a general public web user with no operational role
  or `AFTN` identity

Best practical next move if we truly want to beat `tgftp`:

- pursue authorized `AMHS WEB` / Banco OPMET access through an operational
  aviation entity rather than hunting another public endpoint
