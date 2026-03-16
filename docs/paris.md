# Paris LFPG/CDG METAR Notes

Verified against official/public materials on March 16, 2026.

## Official publisher

For `LFPG` / Paris Charles-de-Gaulle, the actual METAR publisher is
`Meteo-France`.

Official French/ICAO source trail:

- France AIP says:
  - `DGAC` is the ICAO meteorological administration for France
  - `Meteo-France` is the exclusive meteorological services provider for French
    aerodromes
- ICAO EUR Air Navigation Plan lists:
  - `LFPG` as the responsible aerodrome meteorological office for
    Paris/Charles-de-Gaulle
- Meteo-France's aviation guide lists the local office as:
  - `Meteo-France CRA Roissy`

Practical implication:

- if the goal is to beat `NOAA tgftp`, the French origin side is
  `Meteo-France`, not a NOAA/AWC redistribution layer

## Best working authenticated HTTPS endpoints

The best official URLs I can actually poll today with a normal authenticated
`aviation.meteo.fr` account are:

- `https://aviation.meteo.fr/showmessage.php?code=LFPG`
- `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=LFPG`
- `https://aviation.meteo.fr/bulletin_maa.php?mode=html&codes=LFPG`

What they return:

- `showmessage.php`
  - one-airport HTML snippet used by the homepage "Message" box
  - includes `METAR`, `TAF`, `PREDEC`, SIGMET/AIRMET summary, and hidden
    latitude / longitude fields
- `affichemessages.php`
  - one-airport or multi-airport `OPMETS` HTML block
  - includes `METAR`, `TAF`, `PREDEC`, and SIGMET/AIRMET summary
- `bulletin_maa.php`
  - `PREDEC` / aerodrome-warning HTML block

How I found them:

- authenticated `accueil.php` calls:
  - `showmessage.php?code=<ICAO>`
  - `affichemessages.php?mode=html&codes=<ICAO>`
  - `bulletin_maa.php?mode=html&codes=<ICAO>`

Measured snapshot:

- at `2026-03-16 22:32:23 UTC`, the authenticated AEROWEB endpoints returned:
  - `LFPG 162230Z 22005KT 190V270 9999 FEW033 BKN046 10/05 Q1022 NOSIG=`
- at that same check, NOAA dissemination was still on:
  - `tgftp`: `LFPG 162200Z 24005KT 9999 FEW033 BKN046 11/05 Q1022 NOSIG`
  - `AWC API`: `reportTime = 2026-03-16T22:00:00.000Z`

Practical read:

- this is the first concrete Paris result I have where an official
  `aviation.meteo.fr` endpoint appears earlier than NOAA dissemination
- it is only a single measured snapshot, not a rigorous race logger result
- if we want something we can poll right now, `showmessage.php?code=LFPG` is
  the best direct candidate

## Older XML server still separately gated

The older AEROWEB XML server is still live at:

- `https://aviation.meteo.fr/FR/aviation/serveur_donnees.jsp`

What is now clear:

- the public `XSD/Version.txt` file says the data server supports
  `TYPE_DONNEES=OPMET`, `PREDEC`, `MAA`, and other aviation products
- the public `XSD/opmet.xsd` schema says the `OPMET` response groups messages by
  ICAO and can carry `METAR`, `TAFC`, `TAFL`, `SPECI`, `SIGMET`, `AIRMET`, and
  `GAMET`
- the public `XSD/maa.xsd` schema shows a second aerodrome-message product,
  `MAA`
- dummy probes still return:
  - `<?xml version="1.0" encoding="ISO-8859-1"?><acces><code>NOK</code></acces>`
- a normal authenticated AEROWEB web session still returns `NOK`
- using the regular web login as `ID` also still returns `NOK`

Practical read:

- this older XML server appears to require a separate partner code or access
  mode beyond a standard web account
- it is still a good candidate if we can get the right `ID`
- but it is no longer the best practical poll target we can use today

## Closest documented official feed

The strongest closest-to-source operational feed I found is still:

- `Meteo-France SWIM METAR-SPECI (IWXXM)`

Published access methods in the SWIM registry:

- WFS request/reply:
  - `https://metgate.meteo.fr/`
- AMQP 1.0 push:
  - `amqps://metgate-mf-amqp.meteo.fr:5671/metgate`

Published service note:

- the SWIM registry lists a time behaviour of:
  - `less than 2 seconds in 99% of cases`

Important constraint:

- this is not public access
- it requires credentials/approval from `Meteo-France`

Interpretation:

- if the question is "what is the closest documented French-origin feed?", SWIM
  is still the strongest answer
- if the question is "what concrete HTTPS URL can we poll today with a normal
  account?", the authenticated AEROWEB web endpoints above are the stronger
  practical answer

## Approved operational global feeds

If we can use approved operational redistribution feeds instead of a direct
French source, the strongest candidates are:

- `WIFS`
  - carries OPMET in `TAC` and `IWXXM`
  - `OPMET-MINUTE` is generated every minute
  - `M01_OPMET` in the rolling OPMET directory updates every minute
- `SADIS API`
  - carries `METAR/SPECI` in `TAC` and `IWXXM`
  - official descriptions say datasets are refreshed minute by minute

Practical implication:

- `WIFS` / `SADIS` are viable approved operational alternatives if we cannot
  get direct `Meteo-France SWIM` access
- but they are still redistribution layers, not the French origin

## Public JS / bundle investigation

I also inspected the official public web app at:

- `https://aviation.meteo.fr/Aeroweb_maille_fine/index.html?origin=fr`

What I found:

- this app loads plain script files, not a hidden webpack-style bundle
- I did not find any public `METAR`, `OPMET`, or `serveur_donnees.jsp`
  reference in the public JS
- I did not find a public API key
- I did find:
  - `var service_uid = 'vfr'`
  - an auth path:
    - `/wms/v2/auth/login/vfr/{login}/{md5(password)}`
  - a public airport lookup endpoint:
    - `https://aviation.meteo.fr/get_oaci_json.php?oaci=LFPG`

What that airport lookup returns:

- `LFPG` ICAO
- airport name
- latitude / longitude

What the app backend appears to expose publicly:

- airport vector layers
- radar / satellite / lightning observation layers
- forecast map layers

What it does not appear to expose publicly:

- a French-origin `LFPG` METAR text endpoint
- a public aerodrome-message API
- a reusable public secret

Practical implication:

- parsing the public JS did not surface a better no-credential Paris METAR path
- the useful outcome from the bundle pass is mostly negative:
  - no leaked key
  - no hidden public `LFPG` METAR endpoint

## Indexed older pages

Search-engine-visible older AEROWEB pages exist, but they do not yet look like
clean public poll targets:

- `consultation.php?type=texte` without the full old context returns `404`
- `affiche_dossier_preetabli.php` exists, but a bare request returns `500`

Practical implication:

- those older pages may still work with complete tokenized/share parameters
- they are not currently good baseline endpoints for a repeatable `LFPG` race

## Public HTTPS fallback

If we want the simplest public pull over HTTPS instead of `tgftp`, the current
practical replacement is still NOAA/AWC:

- Data API:
  - `https://aviationweather.gov/api/data/metar?ids=LFPG&format=json`
- minute cache:
  - `https://aviationweather.gov/data/cache/metars.cache.xml.gz`

Official AWC note:

- `metars.cache.xml.gz` updates once a minute

Practical implication:

- this is easier than `tgftp`
- but it is still an AWC/NOAA dissemination layer, not the French origin

## Current read

What I can now say with confidence:

- the best working official HTTPS poll targets I found are:
  - `https://aviation.meteo.fr/showmessage.php?code=LFPG`
  - `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=LFPG`
- the closest documented French-origin operational feed is still:
  - `Meteo-France SWIM METAR-SPECI (IWXXM)`
- the best public no-credential benchmark is still:
  - AWC Data API / cache
- `tgftp` remains the NOAA baseline to race against

What I still did not find:

- a public no-credential official `Meteo-France` `LFPG` METAR endpoint
- a public French-origin Paris METAR path hidden in the public JS
- a proof that the older `serveur_donnees.jsp` XML server is unlocked by a
  standard AEROWEB account
- a rigorous long-run latency proof that any of the French-origin paths beat
  `NOAA tgftp`

Important caveat:

- I now have one live head-to-head snapshot where authenticated AEROWEB beat
  `tgftp` and AWC by one report cycle
- I still do not have a multi-cycle logger result
- the main unresolved question is whether the web endpoints stay consistently
  earlier, and whether `serveur_donnees.jsp` or `Meteo-France SWIM` is even
  earlier than the web UI layer

## Best next move

If we want the Paris equivalent of the other airport investigations, the best
practical next step is:

- run a publish-race logger against:
  - `https://aviation.meteo.fr/showmessage.php?code=LFPG`
  - `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=LFPG`
  - `Meteo-France SWIM` or failing that `WIFS` / `SADIS`
  - AWC Data API/cache
  - `tgftp`
- keep `https://aviation.meteo.fr/FR/aviation/serveur_donnees.jsp` on the list
  only if we can get the separate older `ID`
- do not spend much more time on public JS hunting unless a new official
  aerodrome-message endpoint surfaces, because the current client code only
  leaked airport lookup and login wiring

## Sources

- France AIP / SIA:
  - `https://www.sia.aviation-civile.gouv.fr/documents/download/f/d/15032731/`
- AEROWEB login:
  - `https://aviation.meteo.fr/login.php`
- AEROWEB homepage message refresh:
  - `https://aviation.meteo.fr/showmessage.php?code=LFPG`
- AEROWEB `OPMETS` page:
  - `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=LFPG`
- AEROWEB `MAA` page:
  - `https://aviation.meteo.fr/bulletin_maa.php?mode=html&codes=LFPG`
- AEROWEB data-server version file:
  - `https://aviation.meteo.fr/FR/aviation/XSD/Version.txt`
- AEROWEB `OPMET` schema:
  - `https://aviation.meteo.fr/FR/aviation/XSD/opmet.xsd`
- AEROWEB `MAA` schema:
  - `https://aviation.meteo.fr/FR/aviation/XSD/maa.xsd`
- AEROWEB fine-grid app shell:
  - `https://aviation.meteo.fr/Aeroweb_maille_fine/index.html?origin=fr`
- AEROWEB fine-grid app JS:
  - `https://aviation.meteo.fr/Aeroweb_maille_fine/ressources/js/index.js`
- AEROWEB airport lookup:
  - `https://aviation.meteo.fr/get_oaci_json.php?oaci=LFPG`
- SWIM Registry:
  - `https://eur-registry.swim.aero/services/meteo-france-metar-speci-iwxxm-10`
- Aviation Weather Center WIFS guide:
  - `https://aviationweather.gov/wifs/users_guide/`
- Aviation Weather Center Data API:
  - `https://aviationweather.gov/data/api/`
