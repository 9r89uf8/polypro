# Munich EDDM Pages

Verified against the in-repo implementation on March 16, 2026.

## `/munich/today`

- Server-side redirect to `/munich/day/[date]` where `[date]` is the current
  `Europe/Berlin` date.

## `/munich/day/[date]`

Example route: `/munich/day/2026-03-16`

Purpose:

- show the authenticated AEROWEB-backed `EDDM` METAR day chart
- compare recent AEROWEB first-seen timing against NOAA `tgftp`

Main page behavior:

- Uses `aeroweb:getDayStationRows` to load stored `EDDM` rows and the daily
  summary.
- Uses `aeroweb:getRecentPublishRaceReports` with `routineOnly: true` to load
  recent routine publish-race rows.
- If the selected date equals the current `Europe/Berlin` date:
  - runs `aeroweb:pollLatestStationMetar` on first load
  - allows manual refresh from the authenticated AEROWEB endpoint
- If the selected date is not today:
  - no authenticated history backfill is attempted
  - the page only shows rows already captured live and stored earlier

Current source used today:

- `https://aviation.meteo.fr/showmessage.php?code=EDDM`

Supporting AEROWEB page also confirmed:

- `https://aviation.meteo.fr/affichemessages.php?mode=html&codes=EDDM`

Current known limitation:

- there is no confirmed authenticated day-history endpoint wired for `EDDM`, so
  older dates depend on what the app already captured live
- the page does not yet include direct `DWD pc_met` ingest because the current
  provided DWD credentials were not active for the `pc_met` Basic-auth gate

Convex tables:

- `aerowebMetarObservations`
  - one row per stored `EDDM` METAR/SPECI observation
  - includes parsed temperature, canonical raw METAR, source, and optional
    `aerowebFirstSeenAt`
- `aerowebDailySummaries`
  - one `EDDM` summary row per local date
- `aerowebPublishRaceReports`
  - first-seen timing rows for authenticated AEROWEB vs NOAA `tgftp`

Convex functions:

- `aeroweb:pollLatestStationMetar`
  - logs in to `aviation.meteo.fr`
  - fetches `showmessage.php?code=EDDM`
  - stores the latest AEROWEB METAR/SPECI row
  - records the AEROWEB side of the publish-race row
- `aeroweb:pollLatestNoaaPublishRace`
  - samples `tgftp` for `EDDM`
  - records the NOAA side of the publish-race row
- `aeroweb:watchStationPublishRaceWindow`
  - performs 1-second watch-window polling for AEROWEB vs `tgftp`
- `aeroweb:getDayStationRows`
  - returns stored `EDDM` rows plus the daily summary for the selected date
- `aeroweb:getRecentPublishRaceReports`
  - returns recent `EDDM` publish-race rows

Crons:

- `munich_aeroweb_latest_every_minute`
  - calls `aeroweb:pollLatestStationMetar`
- `munich_tgftp_publish_race_every_minute`
  - calls `aeroweb:pollLatestNoaaPublishRace`
- `munich_publish_race_watch_minute_19_49`
  - calls `aeroweb:watchStationPublishRaceWindow`
  - starts before the observed `EDDM` `:20` and `:50` routine boundaries
