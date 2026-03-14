# NZWN PreFlight Notes

Verified against the official New Zealand PreFlight app and authenticated
`/data/...` endpoints on March 12-13, 2026.

## Official app

- Main app: `https://gopreflight.co.nz/app`
- Current SPA bundle observed: `https://gopreflight.co.nz/assets/index-DkUxzH6J.js`
- Official latest NZWN endpoint we have used:
  - `https://gopreflight.co.nz/data/aerodromesv3/NZWN`

## Auth model

- The app does not expose a public REDEMET-style API key for aerodrome weather.
- It uses Auth0 user auth and sends `Authorization: Bearer <token>` to
  `/data/...` routes.
- Current bundle still exposes public client config:
  - Auth0 domain: `preflight.au.auth0.com`
  - Audience host: `auth.gopreflight.co.nz`
  - Client ID: `ccdyGGCSWd3IIjuxU1RonZxyTZNGEfKe`
- The bundle also still contains public PubNub keys, but those do not unlock the
  aerodrome weather endpoints by themselves.

## Interesting confirmed endpoints

## AWS call pattern from bundle

The current frontend bundle shows a two-step AWS flow:

- AWS layer list:
  - `GET https://gopreflight.co.nz/data/aws`
  - sent with `Authorization: Bearer <token>`
  - used by the `AWSList` UI to populate clickable AWS features

- AWS detail modal:
  - `GET https://gopreflight.co.nz/data/aws/{designator}`
  - sent with `Authorization: Bearer <token>`
  - the code explicitly uses `clickedFeature.properties.designator`

So the request shape is:

1. fetch the full AWS vector layer from `/data/aws`
2. click one returned feature
3. fetch station detail from `/data/aws/${designator}`

Important implication:

- If `NZWN` is not present in the AWS layer collection, the app will never open
  an AWS modal for `NZWN`.
- That would explain why `aerodromesv3/NZWN` can exist while `/data/aws/NZWN`
  does not yield a useful station object.

### Aerodrome and airport data

- `https://gopreflight.co.nz/data/aerodromes`
  - Auth-gated GeoJSON `FeatureCollection` for the full aerodrome map.
  - Returns many site types, not just major airports.
  - Observed types include:
    - `AD` aerodromes
    - `HP` heliports
    - `WD` waterdromes
  - The payload includes current summary weather-like fields directly on the map
    layer, such as:
    - `winddir`
    - `windstr`
    - `visibility`
    - `metarissuetime`
    - `qnh`
    - `notam`
  - It also exposes runway metadata such as `rwyazimuth`, `rwylength`, and in
    some cases runway geometry strings.

- `https://gopreflight.co.nz/data/aerodromesv3/NZWN`
  - Rich NZWN station packet.
  - Confirmed sections:
    - `runways` GeoJSON
    - `notam` array with full text
    - decoded + raw `taf`
    - rolling `metar` history array
    - decoded + raw `atis`
    - `twilighttimes`
    - `webcams`
  - For NZWN in the sampled response:
    - `webcams` was `null`
    - `atis` was present and fully decoded
    - `metar` was a rolling half-hour history array, not just one latest row

- `https://gopreflight.co.nz/data/aerodrome/NZWN`
  - Older/smaller station route also exists in the bundle.
  - `aerodromesv3` is the richer route.

### Current NZWN payload details

Interesting NZWN fields confirmed in `aerodromesv3/NZWN`:

- Latest METARs include both raw text and structured decoded observation fields.
- `metar[*].updated` is present separately from METAR `issuetime`.
- `atis` includes:
  - runway
  - approach
  - wind
  - visibility
  - cloud
  - temperature
  - QNH
  - two-thousand-foot wind
  - full raw ATIS text
- `notam` rows include:
  - NOTAM identifiers
  - validity windows
  - coordinates/radius
  - full `iteme` text
- `twilighttimes` returns `mct` and `ect`.

### Charts and briefing material

- `https://gopreflight.co.nz/data/chartlist/NZWN`
  - Returns direct AIP PDF chart metadata for Wellington.
  - URLs point to `https://www.aip.net.nz/assets/AIP/Aerodrome-Charts/Wellington-NZWN/...`
  - Confirmed chart families include:
    - arrival/departure
    - noise abatement
    - STAR
    - ILS/LOC
    - VOR/DME
    - RNP
    - aerodrome
    - operational data
    - ground movements
    - visual docking
    - SID
    - VFR arrival/departure

- `https://gopreflight.co.nz/data/chart/NZWN`
  - Timed out on the sampled run.
  - `chartlist/NZWN` was the useful chart index route.

- `https://gopreflight.co.nz/data/gnzsigwx/charts`
  - Returns direct PNG URLs for graphical NZ SIGWX charts.
  - Sample asset host:
    - `https://api.metservice.com/aviation/assets/gnzsigwx/...`
  - Includes multiple levels:
    - `fl100`
    - `fl250`
    - `fl410`

- `https://gopreflight.co.nz/data/grafor/charts`
  - Returns direct GRAFOR chart PNG URLs.

- `https://gopreflight.co.nz/data/msl/charts`
  - Returns MSL analysis/prognosis image URLs.
  - Sample asset host:
    - `https://api.metservice.com/aviation/assets/chart/msl/...`

- `https://gopreflight.co.nz/data/supplements-list`
  - Returned `[]` in the sampled run.

- `https://gopreflight.co.nz/data/supplements`
  - Returned an empty `FeatureCollection` in the sampled run.

### Live advisory and map layers

- `https://gopreflight.co.nz/data/sigmet`
  - Returns live GeoJSON polygons with raw SIGMET text and metadata.
  - Confirmed phenomena in sampled response:
    - `VA ERUPTION`
    - `VA CLD`
    - `SEV ICE`
    - `SEV TURB`
    - `EMBD TS`
  - Interesting quirk:
    - volcanic ash could appear as two rows with the same SIGMET id, one for
      `VA ERUPTION` and one for `VA CLD`

- `https://gopreflight.co.nz/data/sigwx`
  - Returns multiple time-sliced `FeatureCollection`s, not just one chart.
  - Each slice includes:
    - `metadata` for chart validity and notes
    - polygons for turbulence, icing, mountain waves, CB, volcano, etc.
  - This is much richer than the static chart PNG route because it exposes the
    geometry directly.

- `https://gopreflight.co.nz/data/webcams`
  - Returns a nationwide webcam index as GeoJSON.
  - NZWN itself was not present in the sampled list.
  - Nearby relevant Wellington-region locations in the sample included:
    - `Rimutaka Summit`
    - `Paraparaumu Aerodrome`
    - `Masterton Aerodrome`

- `https://gopreflight.co.nz/data/webcam/NZWN`
  - Did not produce a useful NZWN result in the sampled run.

- `https://gopreflight.co.nz/data/aws/NZWN`
  - Confirmed response:
    - `{"layer":"aws","found":false}`
  - This supports the current conclusion that there is no separate station-level
    NZWN AWS object exposed there.

- `https://gopreflight.co.nz/data/aws`
  - Live AWS layer fetch worked with a refreshed token.
  - Sampled layer size on March 13, 2026:
    - `33` AWS features total
  - `NZWN` was not present in the live AWS collection.
  - Other major aerodrome designators also absent in the sampled layer included:
    - `NZPP`
    - `NZMS`
    - `NZOH`
    - `NZAA`
    - `NZCH`
    - `NZWR`

- Nearest live AWS sites to Wellington airport from the sampled layer:
  - `NZBRX` `Brothers Island` about `39.3 km`
  - `NZNWX` `Ngawi` about `46.0 km`
  - `NZCCX` `Cape Campbell` about `62.5 km`
  - `NZSPX` `Stephens Island` about `100.0 km`
  - `NZCPX` `Castlepoint` about `126.9 km`

- Sample nearby AWS detail payloads:
  - `https://gopreflight.co.nz/data/aws/NZBRX`
    - `found: true`
    - `airtemp_01mnavg: 17.1`
    - `obs_timestamp: 2026-03-13T01:57:00Z`
  - `https://gopreflight.co.nz/data/aws/NZNWX`
    - `found: true`
    - `airtemp_01mnavg: 20.8`
    - `dewtemp_01mnavg: 16`
    - `presqnh_01mnavg: 1002.4`
    - `winddir_01mnavg: 309`
    - `windspd_01mnavg: 9`
    - `obs_timestamp: 2026-03-13T02:29:00Z`

### Area weather and briefing helpers

- `https://gopreflight.co.nz/data/aaw/areas/list`
  - Returns named area-aviation-weather area codes.
  - Sample areas:
    - `FN` Far North
    - `TA` Tamaki
    - `ST` Straits
    - `AL` Alps
    - `GE` Gore

- `https://gopreflight.co.nz/data/aaw/areas`
  - Returns GeoJSON polygons for those named areas plus boundary lines.

- `https://gopreflight.co.nz/data/briefingareas/list`
  - Exists and returns briefing-area designators.

- `https://gopreflight.co.nz/data/usnomctect?date=YYYY-MM-DD`
  - Appears to be a twilight helper that proxies the US Naval Observatory.
  - A naked request failed because the route expects coordinates/height/timezone
    context.

### Navigation / en-route map data

Routes visible in the current bundle include:

- `/data/airspace`
- `/data/fir`
- `/data/navaids`
- `/data/icaowaypoints`
- `/data/waypoints`
- `/data/vrp`
- `/data/obstacles`
- `/data/routes`
- `/data/runways`

Sample probe:

- `https://gopreflight.co.nz/data/routes`
  - Returns route geometry and segment metadata.
  - Observed properties include:
    - airway designator
    - sequence
    - category
    - start/end fixes
    - magnetic tracks
    - leg length
    - minimum safe altitude

## Bundle-only routes worth noting

The current frontend bundle references additional routes that I did not fully
probe in this pass:

- `/data/rainforecast`
- `/data/rainradar`
- `/data/cloudforecast`
- `/data/satellite`
- `/data/satelliteimages`
- `/data/hazards`
- `/data/rpas`
- `/data/spacewx`
- `/data/userreport`
- `/data/userreport/data`
- `/data/dev/runways`
- `/data/dev/submitmessage`
- `/data/dev/updateconsolelogs`
- `/data/dev/viewmessages`

Interesting note:

- `rainradar` and `cloudforecast` returned `Internal Server Error` when fetched
  naked, which suggests those routes likely expect additional params or client
  state.

## NZWN ATIS vs METAR timing check

Live watch on `2026-03-13` against the official authenticated
`aerodromesv3/NZWN` endpoint:

- Baseline at `2026-03-13T03:32:33Z` still showed:
  - METAR: `NZWN 130300Z`
  - ATIS: `R 0227`
  - ATIS `validto`: `2026-03-13T03:27:00Z`
- The endpoint emitted some noisy transition behavior before the real rollover:
  - `metar.updated` and `atis.updated` flipped back and forth between two values
  - one sampled fetch returned a malformed transition payload
- First real product change observed:
  - `2026-03-13T03:34:32Z`
  - new METAR became visible: `METAR NZWN 130330Z AUTO 36015KT 5000 -RA HZ BKN013/// BKN018/// BKN028/// 21/19 Q1002 RMK KAUKAU 35028KT`
  - ATIS was still the old `R 0227` message at that moment
- So on this measured cycle:
  - official PreFlight METAR updated before official ATIS
  - both products were delayed relative to their nominal `:30` / `validto`
    times
  - PreFlight backend metadata is noisy during the switchover, so timing logic
    should key off actual raw product text, not just `updated`

## Hidden PreFlight status path

The current bundle contains a separate authenticated status fetch that is not
part of the `/data/...` aerodrome routes:

- `GET https://gopreflight.co.nz/source/status`
- fetched by the `Status` component with React Query
- current frontend polling cadence:
  - `useQuery("status", re, { staleTime: 3e4 })`
  - effectively a 30-second freshness window

What the bundle shows about this status payload:

- rows are keyed by `type`
- `constructStatusData` lowercases the `type` and stores each row under that
  layer key
- the app tracks:
  - `mapOutdated`
  - `refreshCount`
  - `error`
  - `expectedupdate`
- when a layer is marked stale, the frontend forces a refresh by appending a
  cache-buster:
  - ``${baseURL}?t=${Date.now()}``

Practical implication:

- there is a hidden official layer-version/status mechanism separate from the
  raw aerodrome product fetches
- if authenticated access to `/source/status` is available, it may be the best
  way to detect a new Wellington layer/version before the visible product text
  changes

Fresh live status payload captured on `2026-03-13` with a refreshed bearer
token:

- total rows observed:
  - `65`
- most relevant weather/status rows:
  - `Aerodromes`
    - `source: Composite`
    - `schedule: {"minutes": 5}`
    - `count: 228`
    - version included both NOTAM and METAR min/max stamps
  - `ATIS`
    - `source: IFIS`
    - `schedule: {"minutes": 5}`
    - `count: 15`
  - `METAR`
    - `source: MetService`
    - `schedule: {"minutes": 5}`
    - `count: 983`
  - `METAR-GEOJSON`
    - `source: MetService`
    - `schedule: {"minutes": 5}`
  - `AWS`
    - `source: MetService`
    - `schedule: {"minutes": 30}`
    - `count: 33`

Important implications from that live payload:

- official `ATIS` and official `METAR` are both tracked in the hidden status
  feed on a 5-minute backend schedule, even though Wellington routine issuance
  remains half-hourly
- the separate public/authenticated AWS layer is tracked on a 30-minute
  schedule and does not look like the path to a Wellington on-airport
  minute-by-minute feed
- if the goal is to beat NOAA `tgftp`, `source/status` is now the strongest
  official web-side signal found so far

## Official NZWN publication cadence

Official Civil Aviation Authority guidance confirms:

- `NZWN` uses `METAR AUTO`
- issue frequency:
  - every 30 minutes
  - on the hour and half hour
  - 24/7
- `SPECI`:
  - not issued for `NZWN`

Operational implication:

- there is no official Wellington `SPECI` stream to beat the half-hour METAR
  cadence
- if fresher official airport conditions exist, the highest-signal candidates
  are:
  - `ATIS`
  - `AWOS`
  - `BWR`
  rather than a hidden off-cycle `METAR`/`SPECI` product

## Official AWS / ATIS implications

Official CAA weather documentation adds two useful constraints:

- `METAR AUTO` reports are generated from AWOS
- the AWS platform also produces `1-minute` values
- those `1-minute` values are provided to:
  - ATC tower display systems
  - `MetAWIB` VHF broadcast services at selected aerodromes

At the same time, CAA guidance says:

- `ATIS`, `AWOS`, and `BWR` are used to supplement `METAR`, `SPECI`, or
  `METAR AUTO`
- for inflight updates, the official aerodrome update products include:
  - `SIGMET`
  - `TAF`
  - `METAR/SPECI`
  - `METAR AUTO`
  - `BWR`
  - `ATIS`

Practical implication:

- there is an official higher-frequency sensor layer behind the Wellington
  automation stack
- the public half-hour `METAR AUTO` does not expose those `1-minute` values
- the most plausible official near-live Wellington sources are now:
  - `ATIS`
  - `BWR`
  - possibly `MetAWIB`
  rather than another hidden public `METAR` endpoint
- negative bundle finding:
  - the sampled live PreFlight frontend bundle did not contain obvious
    references to `BWR`, `AWIB`, `MetAWIB`, or `AWOS`
  - that makes it less likely those fresher products are exposed through the
    same public/authenticated SPA routes we have mapped so far

## NZWN map-layer vs AWS-layer split

Fresh live payloads make the PreFlight split clearer:

- `https://gopreflight.co.nz/data/aerodromes`
  - `NZWN` is present in the live aerodrome map layer
  - current Wellington fields exposed there include:
    - `winddir`
    - `windstr`
    - `visibility`
    - `metarissuetime`
    - `qnh`
    - `notam`
  - important non-finding:
    - no direct temperature field was exposed for `NZWN` on this map layer
- `https://gopreflight.co.nz/data/aws`
  - carries real near-live sensor payloads with 1-minute aggregates such as:
    - `airtemp_01mnavg`
    - `dewtemp_01mnavg`
    - `presqnh_01mnavg`
    - `winddir_01mnavg`
    - `windspd_01mnavg`
    - `obs_timestamp`
  - but `NZWN` is absent from the live AWS collection

Practical implication:

- official PreFlight clearly has a near-live AWS data model
- but Wellington airport is not exposed through that public/authenticated AWS
  layer
- for Wellington itself, the visible official web surfaces are still:
  - aerodrome map summary
  - `aerodromesv3/NZWN`
  - `ATIS`
  rather than an exposed on-airport AWS sensor route

## Official IFIS / ATIS / BWR trail

Official New Zealand aviation documentation narrows the next layer down like
this:

- Airways says:
  - `IFIS` remains the GA flight-planning tool in the New Zealand FIR
  - `PreFlight` was intended to replace the briefing/weather component of the
    older IFIS stack
- that split helps explain why:
  - official docs still point pilots to `IFIS`
  - but the richer modern weather data now lives in `PreFlight`
  - and no clean public IFIS weather API surfaced in this investigation
- CAA AIP `GEN 3.4` says:
  - active `ATIS` broadcasts are also available on `IFIS`
  - `AWIB` is an automated broadcast for some unattended aerodromes
  - `AWIB` may include:
    - wind
    - visibility
    - cloud
    - temperature
    - QNH / mean sea level pressure
- CAA weather-products guidance says:
  - `BWR` is for preflight and inflight use
  - `BWR` is a verbal comment on actual weather conditions
  - `BWR` is not an alternative to `METAR`, `SPECI`, or `METAR AUTO`
- CAA rule/advisory material reinforces:
  - `BWR` is a verbal current-conditions report class
  - `BWR` and `AWIB` are operational supplements, not the main official coded
    meteorological report stream

For Wellington specifically:

- Wellington AIP charts still list:
  - `ATIS: 126.9`
- AIP `GEN 3.7` also shows a Wellington row with:
  - ident/callsign: `Wellington`
  - service/facility: `ATIS/ D-ATIS`
  - frequency: `126.9`
  - hours: `H24`
- in that same `GEN 3.7` communications table, an actual `AWIB` example appears
  at `Wanaka` on `129.1`
- that contrast is useful:
  - Wellington is explicitly listed as `ATIS/ D-ATIS`
  - not `AWIB`
- AIP `GEN 3.4` says New Zealand provides `D-ATIS` for ED-89A enabled
  aircraft, with locations and hours in `GEN 3.7-1`
- that makes Wellington `ATIS` the strongest documented official candidate for
  something fresher than the half-hour `METAR AUTO`
- it also means Wellington has an official digital ATIS path, but that path is
  an aircraft datalink service rather than a clean public web endpoint
- but I did not find evidence that Wellington has an `AWIB`
  because `AWIB` is documented for unattended aerodromes, while `NZWN` is a
  towered controlled aerodrome
- likewise, I did not find a separate Wellington `BWR` web endpoint

Related operational clue:

- Airways says digital departure clearances are in operational use for flights
  departing Wellington, and those messages include confirmation of the current
  weather report (`ATIS`)
- that supports the idea that Wellington ATIS is available in an official
  machine-readable operational channel even though I have not found a public
  website or API for it

Environment blocker on live verification:

- direct requests to the official IFIS hosts timed out from this environment on
  `2026-03-13`:
  - `https://ifis.airways.co.nz/`
  - `https://www.ifis.airways.co.nz/`
- additional direct probes also timed out:
  - `http://www.ifis.airways.co.nz/`
  - `HEAD https://www.ifis.airways.co.nz/`
- so I could confirm the official documentation trail to `IFIS`, but not a live
  Wellington `ATIS` / `BWR` / `AWIB` page or API response from here

Practical implication:

- if the goal is fresher-than-`tgftp` official Wellington weather, the best
  remaining official lead is still `ATIS on IFIS`
- `AWIB` is unlikely to be the Wellington answer
- `BWR` probably exists only as an operational verbal/reporting pathway, not as
  a public structured web feed

## Practical takeaways

- The official PreFlight stack is much richer than a simple METAR viewer.
- For NZWN specifically, the best station endpoint remains:
  - `aerodromesv3/NZWN`
- There is still no confirmed public near-live station AWS route for NZWN.
- The app does expose a large amount of authenticated national aviation data:
  aerodromes, routes, charts, SIGMET, SIGWX, webcams, NOTAM, ATIS, and area
  weather polygons.
- Static chart/image assets are hosted off-site on:
  - `api.metservice.com`
  - `www.aip.net.nz`

## Non-finding

- `https://about.metservice.com/preflight` returned a 404 in the sampled run, so
  the useful official surface is the live `gopreflight.co.nz` app rather than a
  public product page there.
