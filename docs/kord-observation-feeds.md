# KORD Observation Feeds

This note summarizes the KORD observation feeds we currently collect:

1. Official hourly METAR/SPECI reports.
2. Hidden NOAA/Synoptic intrahour KORD observations.
3. Weather.com PWS observations fetched with the Wunderground-embedded key.

The goal is to keep clear which feed is authoritative, which feed is the current higher-frequency trend helper, what public delays we observed, and how each feed is stored in Convex.

## Short Version

- Official hourly data is the authoritative airport report.
- Hidden NOAA/Synoptic is the current higher-frequency KORD trend feed.
- Weather.com/Wunderground PWS is a nearby-station helper feed, not an airport observation.
- On March 11, 2026, public NOAA official METAR dissemination still beat the hidden Synoptic feed for the official `:51` row, but Synoptic beat public MADIS for intrahour usefulness.
- Public MADIS guest `ASOS-HFM` is no longer the active trend feed in the app.

## Official Hourly Reports

### What this feed is

- The official airport observation path for KORD is the METAR/SPECI report stream.
- The routine hourly KORD METAR is typically timestamped at minute `:51Z`.
- A `SPECI` can also appear between hourly cycles when conditions trigger a special report.
- These are the reports we treat as authoritative for "official" temperature.

### Where we get it

Current app sources:

- NOAA latest station TXT:
  - `https://tgftp.nws.noaa.gov/data/observations/metar/stations/KORD.TXT`
  - Used by `weather:pollLatestNoaaMetar` in `convex/weather.js`.
- IEM ASOS CSV backfill:
  - Used by `weather:backfillTodayOfficialFromIem` in `convex/weather.js`.
  - This fills same-day official rows from IEM if the latest-file poll missed a cycle or the page opened later.

### How we poll it

- `kord_official_metar_every_2_min`
  - Runs every 2 minutes.
- `kord_official_metar_minute_51`
  - Runs exactly at minute `:51` each hour.

These are defined in `convex/crons.js`.

### What we save

Rows are stored in `metarObservations` with:

- `mode: "official"`
- `stationIcao`
- `date`
- `tsUtc`
- `tsLocal`
- `tempC`, `tempF`
- `rawMetar`
- `source`
- `noaaFirstSeenAt` when the row was first observed through NOAA latest polling

Daily aggregates are stored in `dailyComparisons`, including:

- `metarObsCount`
- `metarMaxC`, `metarMaxF`
- `metarMaxAtLocal`
- `metarMaxRaw`
- deltas vs manual max when manual data exists

### Observed public delay on March 9, 2026

These are the live timings we observed for public NOAA dissemination of KORD routine hourly reports:

- `13:51Z` METAR:
  - First seen from public NOAA latest TXT at `13:53:49Z`
  - File `Last-Modified` was `13:53:44Z`
- `14:51Z` METAR:
  - First seen from public NOAA latest TXT at `14:53:22Z`
  - File `Last-Modified` was `14:53:13Z`
- `15:51Z` METAR:
  - First seen from public NOAA latest TXT at `15:53:26Z`
  - File `Last-Modified` was `15:53:17Z`

Takeaway:

- The routine `:51Z` report was publicly visible from NOAA about 2-3 minutes after issue in the cycles we measured.
- Because our official latest-file poll runs every 2 minutes, the app can still land the row at `:54` even when NOAA publishes around `:53`.
- `noaaFirstSeenAt` is the first time our app observed the row, not NOAA's upstream issue time.

## Hidden NOAA/Synoptic Trend Feed

### What this feed is

- We collect rows from NOAA's hidden KORD time-series page dependency, which is backed by `api.synopticdata.com/v2/stations/timeseries`.
- This feed behaves like a structured KORD intrahour stream with 5-minute `AUTO` rows, inserted special rows, and the official `:51` row when it lands.
- It is not the authoritative official dissemination path, but it is a better temperature-trend feed than public MADIS guest.
- It includes raw METAR text for rows where Synoptic exposes it.

Important nuance:

- This is a hidden NOAA page dependency, not a documented `api.weather.gov` endpoint.
- Access depends on a locally stored `NOAA_WRH_SYNOPTIC_TOKEN` plus NOAA-style `Referer`, `Origin`, and browser-like request headers.
- We use it only as a trend/helper feed, not as the authoritative official-report source.

### Where we get it

Source chain:

- `https://www.weather.gov/wrh/LowTimeseries?site=kord`
- `https://www.weather.gov/source/wrh/apiKey.js`
- `https://www.weather.gov/source/wrh/timeseries/lbw_obs.js`
- `https://api.synopticdata.com/v2/stations/timeseries`

Collector path:

- `synoptic:pollStationTimeseries` in `convex/synoptic.js`

The collector builds a station-specific request with:

- `stationIcao = KORD`
- `recentMinutes = 30`
- `showemptystations = 1`
- `units = temp|F,speed|mph,english`
- `complete = 1`
- `obtimezone = local`

### How we poll it

- `kord_hidden_synoptic_every_5_min`
  - Runs every 5 minutes.
  - Uses a rolling 30-minute lookback.

The rolling overlap matters because we want a deduped intrahour trend curve even if a later poll re-sees the same 5-minute or special row.

### What we parse

We currently parse and normalize:

- `obsTimeUtc`
- `obsTimeLocal`
- `tempC`, `tempF`
- `dewpointC`, `dewpointF`
- `relativeHumidity`
- `windDirDegrees`
- `windSpeedMph`, `windSpeedMps`
- `visibilityMiles`
- `ceilingFt`
- `altimeterInHg`
- `seaLevelPressureMb`
- `weatherCondition`
- `weatherSummary`
- `metarOrigin`
- `rawMetar`

This is enough for the day-page helper chart and for later comparison against official `tgftp` rows and nearby PWS stations.

### How we save it

Raw-ish observation rows go into `synopticObservations` with:

- `stationIcao`
- `provider`
- `source`
- `date`
- `obsTimeUtc`
- `obsTimeLocal`
- parsed weather fields
- `rawMetar`
- `metarOrigin`
- `firstSeenAt`
- `lastSeenAt`
- `updatedAt`

Deduping and patching behavior:

- Primary key is effectively `(stationIcao, date, obsTimeUtc)`.
- If the same observation time appears again later with new values, the row is patched instead of duplicated.

Daily rollups go into `synopticDailySummaries` with:

- `obsCount`
- `latestObsTimeUtc`
- `latestObsTimeLocal`
- `latestRawMetar`
- `latestMetarOrigin`
- `maxTempC`, `maxTempF`
- `maxTempAtUtc`, `maxTempAtLocal`
- `minTempC`, `minTempF`
- `minTempAtUtc`, `minTempAtLocal`

### Observed timing vs official NOAA

Live comparison for the `00:51Z` KORD cycle on March 11, 2026:

- Official NOAA latest TXT first showed `KORD 110051Z ...` at `2026-03-11 00:53:54Z`
- Hidden NOAA/Synoptic first showed the `19:51` local / `110051Z` row at `2026-03-11 00:56:14Z`
- Public MADIS `ASOS-HFM` only reached `00:50Z` at `2026-03-11 00:58:14Z`
- Public MADIS standard `ASOS` still had the prior `23:51Z` row after `01:00Z`

Takeaway:

- Hidden NOAA/Synoptic did not beat NOAA `tgftp` for the new official row.
- Hidden NOAA/Synoptic was still much better than public MADIS guest for the intrahour trend use case.
- That is why the app now uses Synoptic for the helper trend feed instead of MADIS.

## Historical MADIS Note

- Public MADIS guest `ASOS-HFM` was the earlier helper-feed experiment.
- In the KORD checks we ran on March 9 and March 11, 2026, it lagged both NOAA `tgftp` and the hidden Synoptic feed for practical intrahour use.
- The old MADIS collector code and tables are still useful as historical context, but they are no longer the active trend path.

## Weather.com / Wunderground PWS

### What this feed is

- We collect nearby Personal Weather Station observations from the Weather.com PWS current-observation endpoint.
- The API key path we use is the one embedded in the public Wunderground KORD page, not the older Weather.com frontend key used elsewhere in the repo.
- This feed is not an official KORD airport observation.
- It is intended as a helper/predictor feed to compare against hidden NOAA/Synoptic rows and the next official KORD hourly report.

### Where we get it

Source endpoint:

- `https://api.weather.com/v2/pws/observations/current`

Collector path:

- `pws:pollWeatherComPwsBatch` in `convex/pws.js`

Saved Wunderground-backed key:

- `e1f10a1e78da46f5b10a1e78da96f525`

Saved key-source label:

- `wunderground_kord_page_2026_03_09`

Important nuance:

- The older Weather.com fallback key already used for forecast/current products did not return PWS observations for us.
- The Wunderground-embedded key did return live JSON for KORD-adjacent PWS stations when tested on March 9, 2026.
- The collector requests `numericPrecision=decimal`, so stored PWS temperatures, dew point, wind, humidity, and elevation can include decimal values when the API provides them.

### Which PWS stations we collect

Current KORD defaults:

- `KILBENSE14` (`Bensenville`)
- `KILBENSE15` (`Bensenville`)

These were chosen because:

- they are the current KORD-side Weather.com helper stations we want to compare against hidden NOAA/Synoptic rows and official hourly reports
- the two Bensenville stations sit on the west / southwest side of the airport, closer to the NOAA observing side of KORD than the earlier Edison Park and Rosemont picks
- `stationId=KORD` was removed from the Weather.com PWS helper set after follow-up testing showed it did not return usable data consistently

### How we poll it

- `kord_weathercom_pws_every_5_min`
  - Runs every 5 minutes.
  - Calls `pws:pollWeatherComPwsBatch` with `stationIcao: "KORD"`.

The collector fetches the latest current observation for each configured PWS station and upserts by observation timestamp, so repeated polls of the same current observation update `lastSeenAt` instead of creating duplicates.

### What we parse

We currently normalize and store:

- `pwsStationId`
- `obsTimeUtc`
- `obsTimeLocal`
- `tempC`, `tempF`
- `dewpointC`, `dewpointF`
- `heatIndexC`, `heatIndexF`
- `windChillC`, `windChillF`
- `relativeHumidity`
- `windDirDegrees`
- `windSpeedMph`, `windSpeedMps`
- `windGustMph`, `windGustMps`
- `pressureInHg`, `pressureHpa`
- `precipRateIn`, `precipTotalIn`
- `solarRadiation`
- `uv`
- `qcStatus`
- metadata such as `neighborhood`, `softwareType`, `country`, `latitude`, `longitude`, `elevFt`

### How we save it

Raw current-observation rows go into `weatherComPwsObservations` with:

- `stationIcao`
- `pwsStationId`
- `source`
- `keySource`
- `date`
- `obsTimeUtc`
- `obsTimeLocal`
- parsed weather fields
- `firstSeenAt`
- `lastSeenAt`
- `updatedAt`

Deduping behavior:

- Primary key is effectively `(stationIcao, pwsStationId, date, obsTimeUtc)`.
- If the same PWS observation timestamp is seen again later, the row is patched and `lastSeenAt` advances.

Daily rollups go into `weatherComPwsDailySummaries` with:

- `obsCount`
- `latestObsTimeUtc`
- `latestObsTimeLocal`
- `latestTempC`, `latestTempF`
- `latestQcStatus`
- `latestNeighborhood`
- `maxTempC`, `maxTempF`
- `maxTempAtUtc`, `maxTempAtLocal`
- `minTempC`, `minTempF`
- `minTempAtUtc`, `minTempAtLocal`

### Observed behavior on March 9, 2026

The important initial findings from the live tests:

- The Wunderground-embedded key returned live PWS current-observation JSON without cookies.
- `KILBENSE14` returned live data and measured about `4.53 km / 2.82 mi` from KORD in our distance check.
- `KILBENSE15` returned live data at `41.964465, -87.9461`, elevation `666 ft`, and sat in the same plausible west-of-airport temperature cluster as the other Bensenville-side helper stations in the March 10, 2026 checks.
- At roughly the same time, the latest public MADIS `ASOS-HFM` row for KORD was `21:10Z` with temperature about `71.6 F`.

Takeaway:

- In the initial snapshot, the chosen PWS stations were fresher than public MADIS guest.
- That does not yet prove they are the best long-run predictor for KORD.
- We need a longer saved dataset to compare each station's bias and mean absolute error against hidden NOAA/Synoptic rows and official hourly KORD reports.

## Why We Keep Both

### Official hourly reports

Use this feed when the question is:

- What was the official KORD report?
- What was the official hourly temperature?
- What should count as the authoritative daily official max?

### Hidden NOAA/Synoptic

Use this feed when the question is:

- What did the short-term temperature curve look like between hourly METARs?
- Do we want higher-frequency context around the hourly report?
- Do we want a candidate predictor/helper signal ahead of the next official report?

It should be treated as:

- higher-frequency context
- not the authoritative hourly report
- a hidden NOAA page dependency rather than a documented public NOAA API

### Weather.com / Wunderground PWS

Use this feed when the question is:

- Which nearby PWS stations track KORD most closely over time?
- Do we want a fresher helper signal than the hidden NOAA/Synoptic rows for short-term temperature movement?
- Do we want to rank nearby PWS stations by bias/MAE against hidden NOAA/Synoptic rows or official hourly KORD reports?

It should be treated as:

- nearby-station helper data
- not an airport observation
- dependent on a public Wunderground-embedded client key that could rotate later

## Current UI Exposure

- Official hourly rows appear in the existing official/all day workflows.
- Hidden NOAA/Synoptic is currently exposed on `/kord/day/[date]` only.
- Weather.com/Wunderground PWS is currently exposed on `/kord/day/[date]` and `/kord/forecast-snapshots`.
- Hidden NOAA/Synoptic is not shown on `/kord/month`.

## Relevant Code

- Official ingest:
  - `convex/weather.js`
  - `convex/crons.js`
- Hidden NOAA/Synoptic ingest:
  - `convex/synoptic.js`
  - `convex/crons.js`
- Weather.com/Wunderground PWS ingest:
  - `convex/pws.js`
  - `convex/crons.js`
- Storage:
  - `convex/schema.js`
- Day-page display:
  - `app/kord/day/[date]/page.js`
- Forecast-snapshots helper display:
  - `app/kord/forecast-snapshots/page.js`
