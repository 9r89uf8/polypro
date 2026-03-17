# Munich EDDM METAR Notes

Verified against live endpoints and official/public materials on March 17, 2026.

## Goal

Find a place to poll `EDDM` / Munich Airport Station that can beat or at least
match `NOAA tgftp` for the official `METAR`.

This note follows the same method that worked for `LFPG` / Paris:

1. identify the real national publisher
2. find the official user-facing or machine-facing surfaces
3. inspect public web pages / JS / auth gates for pollable endpoints
4. run a live head-to-head check against `tgftp`

## Official publisher

For `EDDM`, the real METAR origin side is `DWD`, not `AEROWEB` and not NOAA.

What the official DWD pages now make clear:

- `DWD` is the designated aeronautical meteorological service for Germany
- at international airports in Germany, `DWD` operates its own meteorological
  sensors plus the `ASDUV` automated recording / distribution system
- `ASDUV` sends airport weather data to `DFS` every `10 seconds`
- `DWD` also provides half-hourly routine reports and special weather reports
  that are transmitted to `DFS` and partly worldwide

Practical read:

- if we want the closest official Munich source, we should still think
  `DWD -> DFS / DWD dissemination`, not `AEROWEB`
- `AEROWEB` is an imported foreign-station surface for `EDDM`, even though it
  can still be useful in practice

## How I repeated the France workflow

For Paris, the breakthrough was:

- determine that `Meteo-France` was the actual publisher
- log into the official aviation portal
- inspect which authenticated pages were actually used to render a station
- compare those pages directly against `tgftp`

For Munich, I repeated the same pattern:

- traced the national publisher first: `DWD`
- checked the official German aviation portal family:
  - `https://flugwetter.de`
  - `https://www.flugwetter.de/`
  - `https://www.dwd.de/EN/specialusers/aviation/aviation_node.html`
  - `https://www.dwd.de/EN/ourservices/aviation_lf_01_pc_met/pcmet_internet_node.html`
- checked whether the DWD public-facing web entry leaked a clean machine
  endpoint or public key
- checked whether our authenticated `AEROWEB` account can already see `EDDM`
- ran a live race between `AEROWEB` and `NOAA tgftp`

## AEROWEB discovery pattern copied from France

The reusable part from the France investigation was:

- log in to `https://aviation.meteo.fr/login.php`
- note that the web login posts to:
  - `https://aviation.meteo.fr/ajax/login_valid.php`
- keep the authenticated session cookie
- probe the station pages that the authenticated portal uses:
  - `showmessage.php?code=<ICAO>`
  - `affichemessages.php?mode=html&codes=<ICAO>`

For Munich, using that same pattern with `EDDM` immediately worked, which is
why `AEROWEB` became the first practical Munich poll target even though the
official publisher is German, not French.

## DWD user-facing access today

The main official DWD self-briefing product is:

- `https://flugwetter.de`
- `https://www.flugwetter.de/`

Current live behavior:

- both `https://flugwetter.de` and `https://www.flugwetter.de/` returned
  `200 OK` on March 17, 2026
- both currently serve the same public landing page

The official DWD `pc_met` page says:

- `pc_met` is the DWD self-briefing system
- it is available at `www.flugwetter.de`
- access is licensed
- current published pricing is:
  - `EUR 36.13` for `6` months
  - `EUR 66.81` for `12` months

The actual application entry is gated:

- `https://www.flugwetter.de/fw/warn/sitemap.htm`
- unauthenticated request returns:
  - `401 Unauthorized`
  - `WWW-Authenticate: Basic realm="GBG - pc_met Internetservice"`

Credentialed check on March 17, 2026:

- a provided DWD username/password pair still returned `401 Unauthorized`
  against the `pc_met` Basic-auth gate
- the DWD order page says users must first register in the `WetterShop` and
  then order `pc_met` internet access

Practical implication:

- a plain DWD / WeatherShop account is probably not enough by itself
- the most likely explanations are:
  - no active `pc_met` license yet
  - a different final `pc_met` username is issued after ordering / activation
  - the account exists but has not been activated for the Basic-auth service

Free DWD aviation products do exist, but they are a different thing:

- the DWD Shop "Entgeltfreie Informationen" page links `Flugwetter` to
  `https://www.dwd.de/luftfahrt`
- the DWD free aeronautical products page lists free products such as:
  - aviation weather summaries for Germany
  - `GAFOR` forecasts
  - 3-day `VFR` / air-sports forecasts
  - twilight times for selected German airports
  - `QNH` maps for selected airports
- that same DWD page explicitly says:
  - further information is available through the fee-paying `pc_met` internet
    service at `www.flugwetter.de`
  - material needed for full pre-flight action can be found in the closed user
    group portal `www.flugwetter.de`

Practical implication:

- yes, DWD has free aviation data pages
- no, that is not the same as free authenticated `pc_met` access
- from the public DWD wording, the free products do not look like a public
  `EDDM` METAR station endpoint replacement

Practical read:

- `pc_met` is probably the strongest practical German-origin web surface for
  `EDDM`
- but it is not public / no-credential access
- without working `pc_met` service access, I cannot yet inspect its
  authenticated station endpoints or measure it against `tgftp`

## Public JS / bundle / endpoint pass

I checked the public DWD / FlugWetter web side for the same kind of clues that
helped with France.

What I found:

- `https://www.flugwetter.de/` is a simple old HTML landing page, not a modern
  bundle-heavy app
- the real app entry is behind HTTP Basic auth before any useful app HTML or JS
  is exposed
- the public landing page did not expose a public `METAR` endpoint
- the public landing page did not expose a reusable API key

I also checked public DWD GeoServer capabilities:

- `https://maps.dwd.de/geoserver/wfs?service=WFS&version=2.0.0&request=GetCapabilities`

Result:

- public aviation-related layers are visible for warnings, for example
  `dwd:forecast-avn_warn-warn_aero`
- I did not find a public `METAR`, `SPECI`, `IWXXM`, or obvious `EDDM`
  aerodrome-report layer in the public capabilities output

Practical read:

- I did not find a public no-credential DWD machine endpoint for `EDDM`
- unlike France, the public web surface did not leak a hidden useful station
  endpoint or key

## Best working authenticated AEROWEB endpoints

With a normal authenticated `aviation.meteo.fr` account, these Munich URLs work
today:

- `https://aviation.meteo.fr/showmessage.php?code=EDDM`
- `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=EDDM`

What they returned during the live check:

- `EDDM 170120Z AUTO 27004KT 9999 FEW006 01/01 Q1022 NOSIG=`

Practical read:

- `AEROWEB` is a real pollable authenticated HTTPS surface for Munich right now
- it is not the German official origin, but it is operationally useful

## Measured AEROWEB vs NOAA tgftp race

I ran a live race around the next `EDDM` update after the previous
`170050Z` report.

Measured cycle:

- starting report:
  - `EDDM 170050Z AUTO 26005KT CAVOK 02/01 Q1022 NOSIG`
- new report:
  - `EDDM 170120Z AUTO 27004KT 9999 FEW006 01/01 Q1022 NOSIG`

First seen times:

- `AEROWEB` first saw the new report at:
  - `2026-03-17 01:23:29 UTC`
- `tgftp` first saw the new report at:
  - `2026-03-17 01:23:33 UTC`
- `tgftp` `Last-Modified` after the update was:
  - `2026-03-17 01:23:32 UTC`

Current result:

- `AEROWEB` won this measured `EDDM` cycle by about `4 seconds`

Important caveat:

- this is one measured cycle, not yet a long-run logger
- still, it is a real head-to-head result, and it is different from what we saw
  for `NZWN` and `SBGR`

## Current read

What I can say with confidence now:

- the official Munich publisher is `DWD`
- the official DWD user-facing self-briefing product is `pc_met` /
  `www.flugwetter.de`
- the public DWD web side did not expose a no-credential Munich `METAR`
  endpoint or public key
- authenticated `AEROWEB` does expose `EDDM`
- in one live measured cycle, authenticated `AEROWEB` beat `NOAA tgftp` by
  about `4s`

What I still do not have:

- a working authenticated `pc_met` station endpoint for `EDDM`
- a DWD-origin machine endpoint I can poll today without extra credentials
- a multi-cycle latency proof showing whether `AEROWEB` is consistently earlier
  than `tgftp` for Munich

## Best next move

If the goal is "find the earliest official Munich source", the next steps are:

- get `pc_met` credentials and inspect the authenticated `flugwetter.de` app
  for the real `EDDM` station endpoint
- run a logger against:
  - `pc_met`
  - `AEROWEB`
  - `NOAA tgftp`
- treat `AEROWEB` as a practical existing benchmark, not as proof of German
  origin

## Sources

- `https://www.dwd.de/EN/specialusers/aviation/aviation_node.html`
- `https://www.dwd.de/EN/ourservices/aviation_lf_01_pc_met/pcmet_internet_node.html`
- `https://www.dwd.de/EN/ourservices/aviation_lf_01_pc_met/order.html`
- `https://www.dwd.de/luftfahrt`
- `https://www.dwd.de/EN/ourservices/aviation_lf_10_free_aeronautical_meteorological_products/free_aeronautical_meteorological_products_node.html`
- `https://www.dwd.de/EN/ourservices/aviation_lf_11_aviation_weather_operations_services/weather_%20observation%20_node_20.html`
- `https://flugwetter.de`
- `https://www.flugwetter.de/`
- `https://www.flugwetter.de/fw/warn/sitemap.htm`
- `https://maps.dwd.de/geoserver/wfs?service=WFS&version=2.0.0&request=GetCapabilities`
- `https://aviation.meteo.fr/showmessage.php?code=EDDM`
- `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=EDDM`
- `https://tgftp.nws.noaa.gov/weather/current/EDDM.html`
