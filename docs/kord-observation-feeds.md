# KORD Observation Feeds

This note summarizes the KORD observation feeds we currently collect:

1. Official hourly METAR/SPECI reports.
2. Public MADIS `ASOS-HFM` high-frequency observations.
3. Weather.com PWS observations fetched with the Wunderground-embedded key.

The goal is to keep clear which feed is authoritative, which feed is higher-frequency, what public delay we observed on March 9, 2026, and how each feed is stored in Convex.

## Short Version

- Official hourly data is the authoritative airport report.
- Public MADIS `ASOS-HFM` is a useful higher-frequency supporting feed, not the official hourly report.
- Weather.com/Wunderground PWS is a nearby-station helper feed, not an airport observation.
- On March 9, 2026, public NOAA official METAR dissemination beat public MADIS guest for KORD.
- Public MADIS guest `ASOS-HFM` was still useful, but it lagged observation time by roughly 8-12 minutes in the checks we ran that day.

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

## Public MADIS HFM

### What this feed is

- We collect rows where the MADIS provider is `ASOS-HFM`.
- This is a high-frequency ASOS/HFMETAR-style feed from the MADIS public guest service.
- It is not raw METAR text.
- It arrives as structured observation values plus quality-control descriptors.

Important nuance:

- MADIS documentation refers to HFMETAR as a one-minute ASOS-style feed.
- In the public guest output we observed for KORD on March 9, 2026, `ASOS-HFM` appeared at 5-minute timestamps, not 1-minute timestamps.
- So the public guest feed is best treated as a lagged public high-frequency view, not proof of full real-time 1-minute public access.

### Where we get it

Source endpoint:

- `https://madis-data.ncep.noaa.gov/madisPublic1/cgi-bin/madisXmlPublicDir`

Collector path:

- `madis:pollPublicAsosHfm` in `convex/madis.js`

The collector builds a station-specific request with:

- `stationIcao = KORD`
- `lookbackMinutes = 30`
- `xml = 5` CSV-style response embedded in HTML

### How we poll it

- `kord_public_madis_hfm_every_5_min`
  - Runs every 5 minutes.
  - Uses a rolling 30-minute lookback.

The rolling lookback matters because public MADIS guest can expose rows late, and sometimes a row first appears partially populated before a later poll fills more fields.

### What we parse

We currently parse and normalize:

- `obsTimeUtc`
- `obsTimeLocal`
- `tempC`, `tempF`
- `dewpointC`, `dewpointF`
- `relativeHumidity`
- `windDirDegrees`
- `windSpeedMps`
- `windGustMps`
- `altimeterPa`
- QC descriptor fields such as `tempQcd`

The public dump can also include `ASOS`, but our collector currently filters to `ASOS-HFM` only.

### How we save it

Raw-ish observation rows go into `madisHfmObservations` with:

- `stationIcao`
- `provider`
- `source`
- `date`
- `obsTimeUtc`
- `obsTimeLocal`
- parsed weather fields
- `firstSeenAt`
- `lastSeenAt`
- `updatedAt`

Deduping and patching behavior:

- Primary key is effectively `(stationIcao, date, obsTimeUtc)`.
- If the same observation time appears again later with new values, the row is patched instead of duplicated.
- This is intentional because the public MADIS guest feed can surface delayed or partially filled rows.

Daily rollups go into `madisHfmDailySummaries` with:

- `obsCount`
- `latestObsTimeUtc`
- `latestObsTimeLocal`
- `maxTempC`, `maxTempF`
- `maxTempAtUtc`, `maxTempAtLocal`
- `minTempC`, `minTempF`
- `minTempAtUtc`, `minTempAtLocal`

### Observed public delay on March 9, 2026

These are the key observations from the live checks we ran:

- During the `15:51Z` KORD routine METAR cycle:
  - Public NOAA latest TXT showed the new official METAR at `15:53:26Z`
  - Public MADIS guest only advanced `ASOS-HFM` to `15:45Z`
  - It updated that `15:45Z` row around `15:53:05Z` to `15:53:15Z`
  - It never reached `15:50Z` or `15:55Z` before the watch ended at `15:57:00Z`
- At `16:41:41Z`:
  - Latest public MADIS `ASOS-HFM` row was `16:30Z`
  - That was about `11 minutes 41 seconds` old
- At `17:08:00Z`:
  - Latest public MADIS `ASOS-HFM` row was `17:00Z`
  - That was about `8 minutes` old

Takeaway:

- Public MADIS guest `ASOS-HFM` did not beat public NOAA official METAR dissemination for KORD in the checks we ran on March 9, 2026.
- It was still useful as a denser temperature curve, but its public delay looked variable and was roughly 8-12 minutes in the spot checks that day.

## Weather.com / Wunderground PWS

### What this feed is

- We collect nearby Personal Weather Station observations from the Weather.com PWS current-observation endpoint.
- The API key path we use is the one embedded in the public Wunderground KORD page, not the older Weather.com frontend key used elsewhere in the repo.
- This feed is not an official KORD airport observation.
- It is intended as a helper/predictor feed to compare against MADIS HFM and the next official KORD hourly report.

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

- `KILCHICA999` (`Edison Park`)
- `KILROSEM2` (`Rosemont`)
- `KILBENSE14` (`Bensenville`)

These were chosen because:

- they appear in Wunderground's nearby-KORD PWS list
- all three returned live current-observation payloads
- `KILROSEM2` and `KILBENSE14` are geographically closer to KORD than the earlier `KILWOODD9` default
- `stationId=KORD` itself returned `204 No Content`, so the airport identifier is not a usable PWS station ID in this feed

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
- `KILCHICA999` returned `2026-03-09T21:21:00Z`, `73 F`, `qcStatus=1`.
- `KILROSEM2` returned live data and measured about `3.57 km / 2.22 mi` from KORD in our distance check.
- `KILBENSE14` returned live data and measured about `4.53 km / 2.82 mi` from KORD in our distance check.
- At roughly the same time, the latest public MADIS `ASOS-HFM` row for KORD was `21:10Z` with temperature about `71.6 F`.

Takeaway:

- In the initial snapshot, the chosen PWS stations were fresher than public MADIS guest.
- That does not yet prove they are the best long-run predictor for KORD.
- We need a longer saved dataset to compare each station's bias and mean absolute error against MADIS HFM and official hourly KORD reports.

## Why We Keep Both

### Official hourly reports

Use this feed when the question is:

- What was the official KORD report?
- What was the official hourly temperature?
- What should count as the authoritative daily official max?

### Public MADIS HFM

Use this feed when the question is:

- What did the short-term temperature curve look like between hourly METARs?
- Do we want higher-frequency context around the hourly report?
- Do we want a candidate predictor/helper signal ahead of the next official report?

It should be treated as:

- higher-frequency context
- not the authoritative hourly report
- potentially delayed in public form

### Weather.com / Wunderground PWS

Use this feed when the question is:

- Which nearby PWS stations track KORD most closely over time?
- Do we want a fresher helper signal than public MADIS guest for short-term temperature movement?
- Do we want to rank nearby PWS stations by bias/MAE against MADIS HFM or official hourly KORD reports?

It should be treated as:

- nearby-station helper data
- not an airport observation
- dependent on a public Wunderground-embedded client key that could rotate later

## Current UI Exposure

- Official hourly rows appear in the existing official/all day workflows.
- MADIS HFM is currently exposed on `/kord/day/[date]` only.
- Weather.com/Wunderground PWS is currently exposed on `/kord/day/[date]` and `/kord/forecast-snapshots`.
- MADIS HFM is not shown on `/kord/month`.

## Relevant Code

- Official ingest:
  - `convex/weather.js`
  - `convex/crons.js`
- MADIS HFM ingest:
  - `convex/madis.js`
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
