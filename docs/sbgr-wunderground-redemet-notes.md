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
  - `AISWEB_API_KEY`
  - `AISWEB_API_PASS`
  - `AISWEB_SBGR_LATEST_MET_URL`

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

So for SBGR, `aerodromos/info` and `old/modal/consulta-de-mensagens/` are the practical official surfaces.

## Practical Takeaways

- If you want official latest raw SBGR:
  - use `api-redemet.decea.mil.br/aerodromos/info?...`
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

- this is one directly measured live cycle
- it is strong evidence that the Brazilian official source can beat NOAA `tgftp` for SBGR publication timing

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

Important access note:

- the public AISWEB API page says API access should be requested from DECEA
- the SBGR aerodrome page source still embeds an `apiKey` / `apiPass` pair
  that works for `area=sol`
- in the sampled run, that same pair also worked for `area=met`
- because those credentials are page-exposed and may change, treat them as
  unstable implementation details rather than a permanent contract

## In-Repo Publish Race Logger

The repo now includes an SBGR publish-race logger built on top of the official
AISWEB `area=met` endpoint, the official REDEMET latest endpoint, and NOAA
`tgftp`.

Current implementation:

- AISWEB latest poll path writes first-seen times into
  `redemetPublishRaceReports`
- REDEMET latest poll path writes first-seen times into
  `redemetPublishRaceReports`
- NOAA `tgftp` race rows are written by a dedicated race poller
- an hourly watch window starts at minute `55`
- the scheduled watch currently runs for `10 minutes`
- during that watch window the app polls all three sources every few seconds
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
- `aiswebFirstSeenAt`
- `redemetFirstSeenAt`
- `tgftpFirstSeenAt`
- optional `tgftpLastModifiedAt`
- `winner`
- `leadMs`

The SBGR day page now shows the recent race rows directly.
