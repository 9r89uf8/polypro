# Paris LFPG Pages

Verified against the in-repo implementation on March 16, 2026.

## `/paris/today`

- Server-side redirect to `/paris/day/[date]` where `[date]` is the current
  `Europe/Paris` date.

## `/paris/day/[date]`

Example route: `/paris/day/2026-03-16`

Purpose:

- show the official LFPG METAR day chart backed by authenticated
  `aviation.meteo.fr` polling
- compare recent AEROWEB first-seen timing against NOAA `tgftp`

Main page behavior:

- Uses `aeroweb:getDayStationRows` to load stored LFPG rows and the daily
  summary.
- Uses `aeroweb:getRecentPublishRaceReports` with `routineOnly: true` to load
  recent routine publish-race rows.
- If the selected date equals the current `Europe/Paris` date:
  - runs `aeroweb:pollLatestStationMetar` on first load
  - allows manual refresh from the authenticated AEROWEB endpoint
- If the selected date is not today:
  - no authenticated history backfill is attempted
  - the page only shows rows already captured live and stored earlier

Official source used today:

- `https://aviation.meteo.fr/showmessage.php?code=LFPG`

Supporting official pages also identified during the investigation:

- `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=LFPG`
- `https://aviation.meteo.fr/bulletin_maa.php?mode=html&codes=LFPG`

Current known limitation:

- there is no confirmed authenticated day-history endpoint wired for LFPG, so
  older dates depend on what the app already captured live

Convex tables:

- `aerowebMetarObservations`
  - one row per stored LFPG METAR/SPECI observation
  - includes parsed temperature, canonical raw METAR, source, and optional
    `aerowebFirstSeenAt`
- `aerowebDailySummaries`
  - one LFPG summary row per local `Europe/Paris` date
- `aerowebPublishRaceReports`
  - first-seen timing rows for authenticated AEROWEB vs NOAA `tgftp`

Convex functions:

- `aeroweb:pollLatestStationMetar`
  - logs in to `aviation.meteo.fr`
  - fetches `showmessage.php?code=LFPG`
  - stores the latest official METAR/SPECI row
  - records the AEROWEB side of the publish-race row
- `aeroweb:pollLatestNoaaPublishRace`
  - samples `tgftp` for LFPG
  - records the NOAA side of the publish-race row
- `aeroweb:watchStationPublishRaceWindow`
  - performs 1-second watch-window polling for AEROWEB vs `tgftp`
- `aeroweb:getDayStationRows`
  - returns stored LFPG rows plus the daily summary for the selected date
- `aeroweb:getRecentPublishRaceReports`
  - returns recent LFPG publish-race rows

Crons:

- `paris_aeroweb_latest_every_minute`
  - calls `aeroweb:pollLatestStationMetar`
- `paris_tgftp_publish_race_every_minute`
  - calls `aeroweb:pollLatestNoaaPublishRace`
- `paris_publish_race_watch_minute_29_59`
  - calls `aeroweb:watchStationPublishRaceWindow`
  - starts before the expected LFPG `:00` and `:30` routine boundaries
