# KORD Hidden NOAA/Synoptic Notes

## Purpose

Capture the current findings about NOAA's hidden KORD time-series page, the live comparison result, and the current migration direction.

## Hidden NOAA KORD Time-Series Feed

Public page:

- `https://www.weather.gov/wrh/LowTimeseries?site=kord`

Public JS loaded by that page:

- `https://www.weather.gov/source/wrh/apiKey.js`
- `https://www.weather.gov/source/wrh/timeseries/lbw_obs.js`

Local env storage:

- store the current token in local-only `.env.local` as `NOAA_WRH_SYNOPTIC_TOKEN`
- do not copy the raw token into versioned docs

Key finding:

- `apiKey.js` exposes a Synoptic token used by the NOAA page.
- `lbw_obs.js` builds a request to:
  - `https://api.synopticdata.com/v2/stations/timeseries`

Observed request shape from the NOAA page JS:

- `STID=KORD`
- `showemptystations=1`
- `units=temp|F,speed|mph,english`
- `recent=<minutes>`
- `complete=1`
- `obtimezone=local`
- `token=<mesoToken from apiKey.js>`

Important access note:

- Direct curl without NOAA browser-like headers returned `403 Invalid request per token rules`.
- Curl with:
  - `Referer: https://www.weather.gov/wrh/LowTimeseries?site=kord`
  - `Origin: https://www.weather.gov`
  - `User-Agent: Mozilla/5.0`
  worked.
- The current token value is stored locally in `.env.local` as `NOAA_WRH_SYNOPTIC_TOKEN`.

## What The Hidden Feed Returns

Station metadata seen in the live KORD payload:

- `STID`
- `NAME`
- `LATITUDE`
- `LONGITUDE`
- `ELEVATION`
- `TIMEZONE`
- `CWA`
- `SHORTNAME`

Observed KORD station metadata:

- `STID=KORD`
- `NAME=Chicago, Chicago-O'Hare International Airport`
- `LATITUDE=41.97972`
- `LONGITUDE=-87.90444`
- `ELEVATION=666.0 ft`
- `SHORTNAME=ASOS/AWOS`

Structured observation arrays seen:

- `date_time`
- `air_temp_set_1`
- `relative_humidity_set_1`
- `dew_point_temperature_set_1d`
- `wind_speed_set_1`
- `wind_direction_set_1`
- `wind_cardinal_direction_set_1d`
- `altimeter_set_1`
- `visibility_set_1`
- `ceiling_set_1`
- `cloud_layer_1_code_set_1`
- `metar_set_1`
- `metar_origin_set_1`
- `weather_cond_code_set_1`
- `weather_condition_set_1d`
- `weather_summary_set_1d`
- `pressure_tendency_set_1`
- `pressure_change_code_set_1`
- `pressure_set_1d`
- `sea_level_pressure_set_1d`
- `wet_bulb_temp_set_1d`
- `wind_chill_set_1d`
- `air_temp_high_6_hour_set_1`
- `air_temp_low_6_hour_set_1`

## Cadence

Live sample pulled on `2026-03-11 00:09Z` over the previous 180 minutes:

- `41` rows total
- cadence counts:
  - `5-minute`: `28`
  - `1-minute`: `3`
  - `2-minute`: `3`
  - `3-minute`: `3`
  - `4-minute`: `3`

Interpretation:

- this behaves like a 5-minute airport stream with inserted special rows and the official `:51` rows.

## Temperature Precision

Hidden NOAA/Synoptic KORD feed:

- not whole-degree rounded
- recent 5-minute `AUTO` rows were things like `39.2`
- inserted official/special rows were things like `39.02`

Example seen in one live run:

- `2026-03-10T18:40:00-0500` -> `39.2`
- `2026-03-10T18:42:00-0500` -> `39.02`
- `2026-03-10T18:51:00-0500` -> `39.02`

Interpretation:

- 5-minute rows appear to line up with the rounded `04/03` style temperature in the METAR body, which in Fahrenheit becomes `39.2 F`.
- official/special rows can carry more precision, matching the `T...` remark conversion, e.g. `T00390028` -> `39.02 F`.

MADIS public HFM:

- also not whole-degree rounded in the raw file
- sample values looked like:
  - `T=276.149994 K`
  - `TD=277.149994 K`
  - `FF=6.687778`
  - `ALTSE=100643.468750`

Interpretation:

- MADIS public HFM exposes numeric floating-point values, but for KORD the temperature often sits on repeated values that correspond to coarse steps.
- so MADIS HFM is not "integer rounded", but it is not as naturally readable as the hidden NOAA/Synoptic feed.

## MADIS Public KORD Feed

Public endpoint in use:

- `https://madis-data.ncep.noaa.gov/madisPublic1/cgi-bin/madisXmlPublicDir?...`

Observed providers in the public KORD dump:

- `ASOS`
- `ASOS-HFM`

Observed columns in the public text dump:

- `STAID`
- `OBDATE`
- `OBTIME`
- `PVDR`
- `SUBPVDR`
- `TD`
- `RH`
- `T`
- `DD`
- `FF`
- `FFGUST`
- `ALTSE`
- QC code columns after each field

Observed cadence:

- `ASOS-HFM` at 5-minute intervals
- `ASOS` at selected times such as `:43`, `:51`, `:00`, `:13`, `:30`, `:42`

## Official Latest METAR Feed

Official latest file:

- `https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT`

Current role:

- authoritative latest report
- only one latest row
- no structured intrahour history on that endpoint

## NOAA Workbook Find

Useful NOAA workbook:

- `https://www.weather.gov/media/asos/ASOS%20Sites%20by%20Equipment%20As%20Of%203_18_2025.xlsx`

Useful KORD rows found:

- `DCP LatLong`
  - `CHICAGO - #1`
  - `41.960167, -87.931639`
  - second coordinate also present: `41.954973, -87.901806`
- `Wind Tower Height`
  - `33.0`

This workbook is worth revisiting for more KORD equipment details later.

## Completed Live Comparison

Watch window:

- local: `2026-03-10 19:50` to `20:00` America/Chicago
- UTC: `2026-03-11 00:50Z` to `01:00Z`

Goal:

- compare hidden NOAA/Synoptic KORD feed vs public MADIS `ASOS-HFM` vs official NOAA `tgftp` around the `00:51Z` cycle
- measure which one first reflects the new official KORD report

Observed first-seen times:

- NOAA `tgftp` latest file changed to `KORD 110051Z ...` at `2026-03-11 00:53:54Z`
- hidden NOAA/Synoptic first exposed the `19:51` local / `110051Z` row at `2026-03-11 00:56:14Z`
- public MADIS `ASOS-HFM` first advanced to `00:50Z` at `2026-03-11 00:58:14Z`
- public MADIS standard `ASOS` was still showing the prior `23:51Z` row after `2026-03-11 01:00Z`

Observed official row in the hidden feed:

- `KORD 110051Z 07007KT 1 3/4SM BR OVC004 04/03 A2968 RMK AO2 PRESFR SLP053 FRQ LTGICCC DSNT SW-W CB DSNT SW-W MOV NE T00440033`

Takeaways:

- hidden NOAA/Synoptic did not beat public NOAA `tgftp` for the new official row
- hidden NOAA/Synoptic was still materially more useful than public MADIS guest for intrahour KORD trend monitoring
- public MADIS `ASOS-HFM` only got the `00:50Z` helper row during the watch, not the new `00:51Z` official row
- hidden NOAA/Synoptic again showed finer temperature precision on the official/special rows than on the surrounding 5-minute rows

## Current Migration Direction

- Official hourly path stays on NOAA `tgftp` plus IEM backfill.
- Intrahour trend path is moving from public MADIS guest to hidden NOAA/Synoptic.
- Reason: Synoptic gives a cleaner, denser KORD-specific trend feed with raw METAR text and better practical timing than MADIS guest.

## Possible Next Places To Look

- more NOAA workbook tabs for KORD:
  - `Ceilometer`
  - `Visibility`
  - `TTd`
  - `Anemometer`
  - `Anemometer 425 Activation Date`
- any other `weather.gov/source/wrh/...` scripts linked from the time-series pages
- whether `timeseries_low` and `timeseries` differ in data shape or just presentation
- whether Synoptic has other station-history endpoints that the NOAA page does not currently use
