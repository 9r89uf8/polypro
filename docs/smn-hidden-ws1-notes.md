# SMN Hidden WS1 Notes

## Purpose

Capture the current findings about `smn.gob.ar` public pages, the hidden/semi-hidden `ws1.smn.gob.ar` API they call, and the current limits we observed while probing it on March 11, 2026.

## Main Pattern

Public SMN pages such as:

- `https://www.smn.gob.ar/pronostico`
- `https://www.smn.gob.ar/observaciones`
- `https://www.smn.gob.ar/radar`
- `https://www.smn.gob.ar/ranking`

inline a short-lived JWT into page HTML with:

- `localStorage.setItem('token', '<jwt>')`

and then call:

- `https://ws1.smn.gob.ar/v1`

Important handling note:

- do not copy raw JWT values into versioned docs
- extract a fresh token from live page HTML when needed
- for short-term local testing, keep the current token only in local `.env.local`

Observed JWT behavior from one decoded sample:

- `sub=web`
- scopes include:
  - `ROLE_USER_FORECAST`
  - `ROLE_USER_GEOREF`
  - `ROLE_USER_HISTORY`
  - `ROLE_USER_IMAGES`
  - `ROLE_USER_MAP`
  - `ROLE_USER_MESSAGES`
  - `ROLE_USER_RANKING`
  - `ROLE_USER_STATISTICS`
  - `ROLE_USER_WARNING`
  - `ROLE_USER_WEATHER`
- token lifetime was about `1 hour` (`exp - iat = 3600`)

Observed request pattern in SMN JS:

- header:
  - `Authorization: JWT <token>`
- plus:
  - `Accept: application/json`

## Forecast Page Endpoints

`/pronostico` sets:

- `UrlWs="https://ws1.smn.gob.ar/v1"`

Observed endpoints in page JS:

- `/forecast/location/<locationId>`
- `/forecast/location/map/2`
- `/weather/location/<locationId>`
- `/warning/shortterm/`
- `/georef/location/search?name=<query>`

Observed access behavior:

- `/forecast/location/<locationId>` required JWT
- `/forecast/location/map/2` required JWT
- `/weather/location/<locationId>` required JWT
- `/warning/shortterm/` accepted JWT; sampled response was `[]`
- `/georef/location/search` worked without JWT in our sample runs

## Georef Search And Location Mapping

Useful search samples:

- `https://ws1.smn.gob.ar/v1/georef/location/search?name=Buenos`
- `https://ws1.smn.gob.ar/v1/georef/location/search?name=Cordoba`

Observed sample rows:

- `[[4864,"Ciudad Autónoma de Buenos Aires","CABA","CABA",87585,4864,-58.4258,-34.6217,6.38,"BUENOS AIRES OBSERVATORIO"]]`
- `[[6425,"Córdoba","Capital","Córdoba",87345,6425,-64.2075,-31.3988,2.59,"CORDOBA OBSERVATORIO"], ...]`

Inferred tuple shape from comparing search results with structured lookup:

- `[locationId, locationName, department, province, stationId, refLocationId, lon, lat, distanceKm, stationName]`

Structured lookup:

- `/georef/location/<locationId>`

Observed sample for `4864`:

- returns location metadata
- returns `ref.station.id=87585`
- returns `ref.station.name="BUENOS AIRES OBSERVATORIO"`
- returns `ref.station.distance=6.38`

Interpretation:

- the search result tuple is enough to discover a usable `locationId`
- `/georef/location/<locationId>` is the cleaner way to map a location to its backing station

## Forecast Payload Shape

Observed sample:

- `/forecast/location/4864`

Returned top-level fields included:

- `updated`
- `location`
- `type`
- `forecast`

Observed `forecast[]` fields:

- `date`
- `temp_min`
- `temp_max`
- `humidity_min`
- `humidity_max`
- period objects:
  - `early_morning`
  - `morning`
  - `afternoon`
  - `night`

Observed period fields:

- `humidity`
- `rain_prob_range`
- `gust_range`
- `temperature`
- `visibility`
- `rain06h`
- `weather.description`
- `weather.id`
- `wind.direction`
- `wind.deg`
- `wind.speed_range`
- `river`
- `border`

Observed map feed:

- `/forecast/location/map/2`

Observed behavior:

- returns a large array of location forecast objects across Argentina
- each object includes:
  - `updated`
  - `type`
  - `location`
  - `forecast`
  - `zoom`

This is the main hidden bulk forecast feed we found.

## Observations Page Endpoints

`/observaciones` also seeds the JWT and uses:

- `UrlWs="https://ws1.smn.gob.ar/v1"`
- `UrlWsBuscador="https://ws1.smn.gob.ar/v1"`

Observed endpoints in page JS:

- `/weather/location/<locationId>`
- `/georef/location/<locationId>`
- `/history/weather/location/<locationId>?start=<iso>&end=<iso>`
- `/history/precipitation/location/<locationId>?start=<iso>&end=<iso>`
- `/history/temperature/location/<locationId>?start=<date>&end=<date>`
- `/statistics/location/<locationId>?month=<1-12>`
- `/georef/location/search?name=<query>`

## Current Weather Payload

Observed sample:

- `/weather/location/4864`

Observed fields:

- `date`
- `humidity`
- `pressure`
- `feels_like`
- `temperature`
- `visibility`
- `weather.description`
- `weather.id`
- `wind.direction`
- `wind.deg`
- `wind.speed`
- `station_id`
- `location`

Observed sample values for `4864` on March 11, 2026:

- `station_id=87585`
- `temperature=25.7`
- `pressure=1014.2`
- `weather.description="Despejado"`

Interpretation:

- this is the live observation endpoint the page uses for the current conditions card
- the returned station is not necessarily at the exact searched location; it is the mapped nearby reference station

## History And Statistics Payloads

Observed weather history sample:

- `/history/weather/location/4864?start=2026-03-10T00:00:00-03:00&end=2026-03-11T23:59:59-03:00`

Observed response shape:

- `station_id`
- `list`
- `location`

Observed `list[]` fields:

- `date`
- `humidity`
- `pressure`
- `feels_like`
- `temperature`
- `visibility`
- `weather.description`
- `weather.id`
- `wind.direction`
- `wind.deg`
- `wind.speed`

Observed cadence:

- hourly rows

Observed precipitation history sample:

- `/history/precipitation/location/4864?start=2026-03-09T18:00:00-03:00&end=2026-03-11T18:00:00-03:00`

Observed fields:

- `date`
- `precipitation`
- `accumulated`
- `valid`

Observed temperature-history sample:

- `/history/temperature/location/4864?start=2026-03-10&end=2026-03-11`

Important parameter note:

- this endpoint wanted date-only values like `YYYY-MM-DD`
- our first timestamp-style query returned `400`
- the page JS also builds it with date-only strings

Observed returned fields:

- `date`
- `temp_max`
- `temp_min`

Observed statistics sample:

- `/statistics/location/4864?month=3`

Observed returned fields:

- `month`
- `temp_max_abs`
- `temp_min_abs`
- `temp_max_mean`
- `temp_min_mean`
- `temp_mean`
- `precip_max`
- `period`

## Radar Image Feeds

`/radar` page inlines:

- `dir = "https://estaticos.smn.gob.ar/vmsr/radar/"`
- `ruta = "https://ws1.smn.gob.ar/v1/images/radar/"`

The page exposes selectable radar codes such as:

- `COMP_ARG`
- `COMP_CEN`
- `COMP_NOR`
- `RMA1_240`
- `RMA2_240`
- `RMA3_240`
- `RMA4_240`
- `RMA5_240`
- `RMA6_240`
- `RMA7_240`
- `RMA8_240`
- `RMA9_240`
- `RMA10_240`
- `RMA11_240`
- `RMA12_240`
- `RMA13_240`
- `RMA14_240`
- `RMA15_240`
- `RMA16_240`
- `RMA17_240`
- `RMA18_240`
- `ANG_240`
- `PAR_240`
- `PER_240`

Observed authenticated image-list responses:

- `/images/radar/COMP_ARG`
- `/images/radar/RMA1_240`
- `/images/radar/RMA2_240`

Observed response shape:

- `id`
- `product`
- `radar`
- `list`

Observed examples:

- `COMP_ARG` returned 12 filenames like:
  - `COMP_ARG_ZH_CMAX_20260311_175500Z.png`
- `RMA1_240` returned 12 filenames like:
  - `RMA1_240_ZH_CMAX_20260311_181722Z.png`
- `RMA2_240` returned an empty `list` in our sample run

Interpretation:

- the radar list endpoint is live and useful
- some individual radars may temporarily return no recent images
- the static host likely serves the actual PNGs using the filenames from the JSON list

Current access caveat:

- direct CLI fetches to `estaticos.smn.gob.ar` hit a Cloudflare challenge (`403`) in this environment
- that does not prove the browser page cannot load them normally

## Ranking Page Behavior

`/ranking` also seeds the JWT, but the page content looked server-rendered.

Observed behavior:

- no obvious `ws1` XHR was embedded in the page source
- probing `https://ws1.smn.gob.ar/v1/ranking/temperature` returned `404`
- the ranking HTML already contains table rows for:
  - descending temperatures
  - ascending temperatures
  - Antarctic bases

Interpretation:

- ranking data may be rendered directly by Drupal/PHP on the server side rather than loaded from the browser through `ws1`
- there may still be a separate internal ranking source, but we did not identify a browser-called JSON endpoint for it

## METAR, TAF, And SIGMET Pages

Observed current public shell pages:

- `https://www.smn.gob.ar/metar`
- `https://www.smn.gob.ar/taf`
- `https://www.smn.gob.ar/mensajes-sigmet`

Observed iframe targets in current page HTML:

- `/metar` embeds:
  - `https://ssl.smn.gob.ar/mensajes/index.php?operacion=seleccion&observacion=metar`
- `/taf` embeds:
  - `https://ssl.smn.gob.ar/mensajes/index.php?operacion=seleccion&observacion=taf`
- `/mensajes-sigmet` embeds:
  - `https://ssl.smn.gob.ar/mensajes/index.php?operacion=seleccion&observacion=sigmet`

Observed behavior differences versus forecast/observations/radar pages:

- these pages did not inline the short-lived `ws1` JWT in the HTML we fetched
- these pages did not expose `UrlWs="https://ws1.smn.gob.ar/v1"`
- they behave like wrappers around a separate legacy PHP app rather than modern `ws1` clients

Current access caveat:

- direct CLI fetches to `ssl.smn.gob.ar/mensajes/...` returned a Cloudflare challenge page saying JavaScript and cookies are required
- the older `http://www.smn.gov.ar/mensajes/...` path now `301` redirects to HTTPS on `www.smn.gov.ar` behind Cloudflare as well

Headless-browser attempt on March 11, 2026:

- a disposable Playwright + Chromium setup was able to render the live challenge page from:
  - `https://ssl.smn.gob.ar/mensajes/index.php?operacion=seleccion&observacion=metar`
- the rendered page showed:
  - `Verificación de seguridad en curso`
  - a visible Cloudflare "verify you are human" widget
- Playwright could see a nested Cloudflare Turnstile frame under:
  - `https://challenges.cloudflare.com/cdn-cgi/challenge-platform/.../turnstile/...`
- a direct click inside that challenge frame still did not advance to the METAR page
- the captured network trace showed repeated Cloudflare challenge-flow requests and then the original METAR URL still returning `403`
- the challenge trace also included `.../pat/...` requests that returned `401`

Interpretation:

- this is no longer just a missing-header or non-JS problem
- from this environment, Cloudflare is actively re-challenging the automated browser session and not granting access to the legacy METAR app
- a real interactive browser outside this environment may still succeed

Confirmed from a real interactive browser session provided by the user:

- the legacy app does return raw METAR text as server-rendered HTML after Cloudflare clearance
- the request shape is a plain page navigation, not a discovered `ws1` or XHR API
- observed request form:
  - `https://ssl.smn.gob.ar/mensajes/index.php?observacion=metar&operacion=consultar&87576=on`
- observed result page characteristics:
  - title area `Observaciones METAR`
  - station header `Aeropuerto EZEIZA`
  - raw METAR line embedded directly in the HTML table
  - printable copy duplicated into a hidden form field for `imprimir.php`
- observed raw METAR page sample:
  - `METAR SAEZ 112100Z 08013KT CAVOK 26/15 Q1015 NOSIG RMK PP000 =`

Interpretation:

- SMN does have a raw-METAR result page
- the browser workflow appears to be:
  - `operacion=seleccion` to choose one or more stations
  - `operacion=consultar&<stationCheckboxId>=on` to render the result page
- in the confirmed sample, checkbox id `87576` mapped to `SAEZ / Aeropuerto Ezeiza`

Interpretation:

- SMN's raw aviation-message stack is currently distinct from the `ws1` weather/forecast stack
- the public `/metar` page is only a shell page; the actual message UI lives in the legacy `mensajes` app
- in this environment we could confirm the embed target, but not drive the Cloudflare-cleared browser flow ourselves

## `ws1` Message Namespace Probing

Reason for probing:

- decoded JWT scopes include `ROLE_USER_MESSAGES`

Observed `404` responses from current `ws1` probes:

- `/messages`
- `/message`
- `/mensajes`
- `/mensaje`
- `/messages/metar`
- `/message/metar`
- `/messages/taf`
- `/message/taf`
- `/messages/sigmet`
- `/message/sigmet`
- `/messages?observation=metar`
- `/messages?observacion=metar`
- `/messages?observation=taf`
- `/messages?observacion=taf`
- `/message?observation=metar`
- `/message?observacion=metar`
- `/aviation/messages`
- `/aviation/message`
- `/aeronautica/messages`
- `/aeronautica/message`

Interpretation:

- if `ROLE_USER_MESSAGES` is still used, the browser-facing path is not obvious from the current public pages
- we did not find a live `ws1` JSON endpoint for METAR, TAF, or SIGMET

## WIS2 / OAPI Findings

Observed public OAPI root:

- `https://w2b.smn.gov.ar/oapi`

Observed collections on March 11, 2026:

- `discovery-metadata`
- `stations`
- `urn:wmo:md:ar-smn:slt0ci`
- `messages`

Observed `messages` sample behavior:

- `/oapi/collections/messages/items?f=json&limit=50` returned only:
  - `metadata_id='urn:wmo:md:ar-smn:slt0ci'`
  - `data_id` prefixes under `ar-smn:slt0ci`
- sample message items contained:
  - `content.encoding='base64'`
  - `content.value` as BUFR payload text
  - `wigos_station_identifier`
  - `datetime`
  - `pubtime`

Interpretation:

- this public OAPI is a WIS2 / BUFR-oriented publication surface
- in current samples it exposed surface-observation notifications, not raw METAR text
- we did not find a separate METAR collection in the current OAPI collection list

## Practical METAR Fallback

If raw METAR text is the goal and SMN's own legacy app is blocked, the cleanest verified fallback we found on March 11, 2026 was the official U.S. Aviation Weather Center feed.

Verified single-station API examples:

- `https://aviationweather.gov/api/data/metar?ids=SAEZ&format=json`
- `https://aviationweather.gov/api/data/metar?ids=SABE,SAEZ&format=json`

Observed sample results:

- `SAEZ` returned:
  - `rawOb="METAR SAEZ 111900Z 07013KT CAVOK 27/14 Q1015 NOSIG"`
  - `reportTime="2026-03-11T19:00:00.000Z"`
  - `name="Buenos Aires/Pistarini Arpt, B, AR"`
- `SABE` returned:
  - `rawOb="METAR SABE 111900Z 10015KT 9999 FEW030 23/17 Q1017 NOSIG"`
  - `reportTime="2026-03-11T19:00:00.000Z"`
  - `name="Buenos Aires/Newbery Arpt, C, AR"`

Observed useful JSON fields:

- `icaoId`
- `receiptTime`
- `reportTime`
- `metarType`
- `rawOb`
- `temp`
- `dewp`
- `wdir`
- `wspd`
- `visib`
- `altim`
- `lat`
- `lon`
- `name`

Verified bulk fallback:

- `https://aviationweather.gov/data/cache/metars.cache.xml.gz`

Observed bulk sample for `SAEZ`:

- `raw_text="METAR SAEZ 111900Z 07013KT CAVOK 27/14 Q1015 NOSIG"`
- `observation_time="2026-03-11T19:00:00.000Z"`
- `metar_type="METAR"`

Recommendation:

- for latest-per-station reads, prefer the AWC JSON API
- for periodic wide fan-out across many stations, prefer the bulk cache file
- keep SMN pages as reference UI only unless a real interactive browser can get through the Cloudflare gate

## Legacy Interface Clue

Now confirmed from user-provided browser output:

- the legacy `mensajes` app uses a follow-on query like `operacion=consultar` with checkbox-style station parameters after the `operacion=seleccion` page
- confirmed sample:
  - `index.php?observacion=metar&operacion=consultar&87576=on`

Still open:

- full station-id mapping for the entire selector list
- whether multiple checked stations are supported in one response page

## Current Practical Endpoints

Most useful findings so far:

- `https://ws1.smn.gob.ar/v1/georef/location/search?name=<query>`
- `https://ws1.smn.gob.ar/v1/georef/location/<locationId>`
- `https://ws1.smn.gob.ar/v1/weather/location/<locationId>`
- `https://ws1.smn.gob.ar/v1/forecast/location/<locationId>`
- `https://ws1.smn.gob.ar/v1/forecast/location/map/2`
- `https://ws1.smn.gob.ar/v1/history/weather/location/<locationId>?start=<iso>&end=<iso>`
- `https://ws1.smn.gob.ar/v1/history/precipitation/location/<locationId>?start=<iso>&end=<iso>`
- `https://ws1.smn.gob.ar/v1/history/temperature/location/<locationId>?start=<date>&end=<date>`
- `https://ws1.smn.gob.ar/v1/statistics/location/<locationId>?month=<1-12>`
- `https://ws1.smn.gob.ar/v1/images/radar/<radarCode>`
- `https://w2b.smn.gov.ar/oapi/collections/messages/items?f=json&limit=<n>` for BUFR-style WIS2 notifications

All except georef search were observed behind the page-issued JWT in current page JS.

Important limitation:

- none of the endpoints we verified in `ws1` or `w2b` yielded raw SMN METAR text directly
- the raw METAR path still appears to be the legacy `ssl.smn.gob.ar/mensajes` app

## Open Questions

- Is there a satellite image API parallel to `/v1/images/radar/<code>`?
- Is ranking backed by a hidden service not exposed in the browser, or is it purely server-rendered?
- Does the static radar host require browser clearance, referer, or Cloudflare cookies for direct non-browser fetches?
- Can the legacy `mensajes` METAR app be reached in a headless browser or other JS-capable client from this environment?
- Does the blocked legacy METAR flow still submit `operacion=consultar` plus station checkbox params on the current host?
