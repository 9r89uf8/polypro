# NZWN Pages

This document describes the NZWN routes and the official PreFlight-backed
ingest used by those pages.

## `/nzwn/today`

Purpose: stable entrypoint for the current Wellington local day.

What this route does:

- Server-side redirect to `/nzwn/day/[date]` where `[date]` is the current
  `Pacific/Auckland` date in `YYYY-MM-DD`.
- Avoids client-side date flicker and gives one bookmarkable URL for "today".

## `/nzwn/day/[date]`

Example route: `/nzwn/day/2026-03-13`

Purpose: focused Wellington Airport surface-temperature monitor.

What this page displays:

- Compact navigation with Wellington date controls, live Auckland clock, and
  `C` / `F` toggle.
- A dominant station `93439` temperature hero with:
  - explicit near-live, delayed, stale, archive, unavailable, or
    approval-required state
  - exact accepted observation time and relative age
  - change over approximately 30 minutes
  - manual refresh during the configured collection window
- Signal summary:
  - high and low from accepted near-live observations
  - humidity and pressure
  - latest official NZWN METAR temperature as a separately labelled comparator
  - fast-feed difference from the METAR value
- Responsive temperature trajectory:
  - teal line for timestamped MetService station `93439` readings
  - amber reference points for routine official NZWN METAR
  - Wellington-local time axis and no horizontally oversized mobile plot
- Wind panel with direction, average speed, gust, collection window, last
  success, and collector state.
- Recent accepted station readings, newest first.
- Source-control panel with the approval flag, source identity, last collector
  attempt/error, a link to MetService's station page, and a link to the
  separate forecast archive.

Behavior details:

- Page expects a `YYYY-MM-DD` date segment.
- Opening a date reads already-stored official NZWN METAR rows for the separate
  comparison series. It does not automatically call PreFlight or backfill its
  rolling message window.
- If viewing today in `Pacific/Auckland`, Convex query subscriptions update the
  page when the scheduled station collector accepts a newer source timestamp.
- Manual refresh is available only for today, only when the approval flag is
  enabled, and only inside the `09:00`-`19:00` Wellington collection window.
  It polls only the approval-gated station current. The METAR comparison is
  read-only on this page and never triggers a PreFlight request.
- The page reads its near-live state through
  `nzwnWeather:getLiveTemperature`; it does not make a MetService request
  merely because a browser opened the route.
- If approval is absent, the current-day hero displays `LOCKED`, names the
  required Convex flag, disables refresh, and does not substitute METAR or
  another provider as the near-live temperature.
- With approval enabled, historical routes display stored readings for the
  selected local date and are labelled as archives. With approval absent,
  historical protected readings are also withheld.
- The newest accepted source timestamp drives the hero. Cached responses with
  an older timestamp are rejected in Convex and cannot move the display
  backward.
- PreFlight station/status fetches retry transient transport failures and
  `5xx` responses a few times before surfacing an error, which reduces noisy
  NZWN refresh failures caused by short upstream hiccups.
- Observations are deduped by `(stationIcao, date, obsTimeUtc)` in
  `preflightMetarObservations`.
- Forecast history remains available at `/nzwn/forecast-accuracy`; the day page
  no longer loads forecast, publish-race, notes, or forecast-history data.

## Official Source

Latest official NZWN JSON:

- `https://gopreflight.co.nz/data/aerodromesv3/NZWN`

Near-live unofficial NZWN airport current JSON:

- `https://www.metservice.com/publicData/webdata/module/currentConditions/93439/93439?pagetype=48hr`

Legacy NZWN/Wellington forecast JSON, currently disabled:

- `https://www.metservice.com/publicData/localForecastlyall-bay`

Google hourly forecast retained only in the unused legacy page-weather action:

- `https://weather.googleapis.com/v1/forecast/hours:lookup?key=...&location.latitude=-41.286&location.longitude=174.777`

Requirements:

- Requests must send `Authorization: Bearer <token>`
- The token is a logged-in user access token captured from PreFlight, stored in
  `PREFLIGHT_AUTH_BEARER_TOKEN`
- The repo includes `scripts/refresh-preflight-token.mjs` to refresh that
  bearer token from `PREFLIGHT_USERNAME` and `PREFLIGHT_PASSWORD` using the
  normal browser login flow. It can update `.env.local` and/or `npx convex env
  set PREFLIGHT_AUTH_BEARER_TOKEN`.
- Package entrypoint:
  - `npm run refresh:preflight-token -- --write-env-file .env.local`
  - add `--set-convex` or `--convex-prod` as needed
- The unofficial MetService airport-current endpoint is a keyless
  `metservice.com/publicData` JSON feed, but keyless reachability does not grant
  permission for automated production use. The station-current request and
  persisted/read data are therefore protected by the dedicated Convex
  approval flag described below.
- The old MetService daily-forecast and 48-hour-graph integrations are disabled.
  The station-current flag does not authorize either source.
- The Google hourly endpoint uses `GOOGLE_WEATHER_API_KEY`.

### MetService PublicData approval gate

The production source of truth is the server-side Convex environment variable:

```text
METSERVICE_PUBLICDATA_ACCESS_APPROVED
```

Only the exact value `true` enables a request. Missing, empty, `false`, and
other values fail closed. A reachable page or a valid response is not approval.
The approving authority must be MetService, with scope covering automated
production retrieval and display of the Wellington station `93439`
`publicData` response.

Protected entry points:

- manual `nzwnWeather:pollMetServiceCurrentConditions`
- scheduled internal
  `nzwnWeather:pollScheduledMetServiceCurrentConditions`
- the station-current fetch helper immediately before the network request
- the internal `nzwnWeather:storeMetServiceObservation` mutation immediately
  before a live row can be stored
- `nzwnWeather:getLiveTemperature` and
  `nzwnWeather:getMetServiceObservations` before protected rows are read

The legacy `nzwnWeather:getDayPageWeather` MetService portions,
`nzwnWeather:getMetServiceHourlyForecasts`, and
`nzwnWeather:collectForecastSnapshot` return `status: "source_disabled"` and do
not make a MetService request or expose stored forecast rows. There is no
scheduled MetService forecast collector.

While approval is absent:

- manual and scheduled current-temperature polls return
  `status: "approval_required"` before making an external request
- `nzwnWeather:getLiveTemperature` returns
  `approval.status: "approval_required"` with `latest`, `latestForDate`, and
  `summary` set to `null` and `observations` set to `[]`
- `nzwnWeather:getMetServiceObservations` returns
  `status: "approval_required"` and `rows: []`
- previously stored rows can remain in Convex, but are not returned while
  approval is absent and collector state is not represented as live or
  configured

After written approval for the required scope:

```text
npx convex env set METSERVICE_PUBLICDATA_ACCESS_APPROVED true --prod
```

To disable future requests immediately:

```text
npx convex env remove METSERVICE_PUBLICDATA_ACCESS_APPROVED --prod
```

Production deployment topology as of July 29, 2026:

- Vercel production (`polypro-alpha.vercel.app`) is wired to the Convex
  production deployment `rapid-greyhound-887`.
- The repository's local `.env.local` selects the separate development
  deployment `polite-wildcat-940`.
- Deploy backend changes from the linked repository with `npx convex deploy`;
  verify the CLI output names `rapid-greyhound-887`, then run the production
  query with `npx convex run --prod`. Deploying only to the local selector
  leaves Vercel on stale functions and produces client-side
  `Function not found`/generic server errors.

Do not store approval evidence or credentials in the repository. This endpoint
does not require a credential; the approval flag is intentionally separate
from technical reachability.

### Near-live temperature collector contract

The redesigned temperature surface reads:

```text
nzwnWeather:getLiveTemperature({ date: "YYYY-MM-DD" })
```

It returns:

- station identity (`NZWN`, station `93439`)
- approval state and the flag name
- the `09:00`-`19:00` `Pacific/Auckland` collection window
- collector status, last attempt, last success, and last ingest result
- the collector's latest stored observation timestamp
- latest stored station reading and its age
- ordered readings and a min/max/latest summary for the requested local date

The refresh action is:

```text
nzwnWeather:pollMetServiceCurrentConditions({ stationIcao: "NZWN" })
```

Both scheduled and manual polls enforce approval and the collection window
server-side. The live collector only downloads the timestamped current
conditions response; it no longer downloads the separate 48-hour graph on
every poll.

Only a valid source `asAt` value is accepted as the observation timestamp.
`issuedAt` and collection time are never used as fallbacks. The action checks
approval before the request, again after the response, and again immediately
before calling storage. The storage mutation independently checks approval
before any read or write, closing the revocation race between action and
mutation. Writes are monotonic for source `metservice_93439`:

- a newer timestamp is inserted
- an identical timestamp is deduplicated
- a response older than the latest stored timestamp is rejected

This specifically protects the series from CDN responses that regress to an
older cached observation.

Known limitation:

- The official endpoint we found exposes a rolling recent message array, not a
  date-bounded history search.
- That means same-day backfill only works for rows still visible in the rolling
  window.
- Older dates are accurate only if those rows were already captured live by the
  cron or by an earlier page visit.

## `/nzwn/forecast-accuracy`

Purpose: analyze how well stored MetService daily forecasts predicted the
official NZWN day high.

What this page displays:

- `Accuracy by Lead Time`
  - MAE, mean bias, `≤1°C`, `≤2°C`, and sample count by lead day
  - benchmark is the official NZWN daily max from `preflightDailySummaries`
  - each lead-day bucket keeps the earliest stored forecast capture for that
    date, so same-day late updates do not dominate the score
- `Forecast Progression`
  - all stored MetService captures for one selected date
  - shows how the predicted max changed across successive captures
  - overlays the official NZWN max for that day
  - defaults to the latest completed/scored NZWN date with stored forecast
    history, rather than the current in-progress Auckland date
- `Recent Predictions`
  - compact grid of recent dates showing the official max and representative
    lead-day predictions

Behavior details:

- Forecast snapshots are stored immutably in `nzwnForecastPredictions`; old
  forecast values are not overwritten.
- Accuracy scoring uses official PreFlight day summaries as truth, not
  `nzwnDailySummaries`.
- The representative lead-day metric uses the earliest stored capture in each
  lead-day bucket.

## Data Model

- `preflightMetarObservations`
  - one row per official NZWN `METAR` or `SPECI`
  - stores local date, UTC timestamp, local timestamp, raw METAR, parsed temp,
    source, and optional `preflightFirstSeenAt`
- `preflightDailySummaries`
  - one row per station/date
  - stores obs count, latest row fields, min/max temps, and min/max times
- `nzwnForecastPredictions`
  - one row per MetService forecast day per captured snapshot
  - stores captured time, target date, lead days, min/max forecast temps, and
    forecast phrase
- `nzwnMetServiceObservations`
  - current production writes are station-current readings only
  - legacy 48-hour-graph rows may remain stored but are neither newly collected
    nor returned by the current-source queries
  - near-live source rows use `source=metservice_93439`, source `asAt` as
    `obsTimeUtc`, and monotonic source ordering
- `nzwnMetServiceCollectorStatus`
  - one row for `NZWN`
  - stores last attempt/success, latest source time, last ingest outcome, and an
    honest approval/window/error state
- `nzwnDailySummaries`
  - one row per station/date derived from `nzwnMetServiceObservations`
  - used for unofficial sidecar diagnostics, not as the forecast-accuracy
    benchmark
- `preflightPublishRaceReports`
  - one row per station/report timestamp
  - stores PreFlight first-seen time, NOAA `tgftp` first-seen time, optional
    `tgftp` `Last-Modified`, winner, and lead for the current NZWN race view

## Scheduled Ingest

Convex cron:

- `nzwn_preflight_latest_every_minute`
  - calls `preflight:pollLatestStationMetar`
  - station argument is `NZWN`
- `nzwn_tgftp_publish_race_every_minute`
  - calls `preflight:pollLatestNoaaPublishRace`
  - station argument is `NZWN`
- `nzwn_publish_race_watch_minute_04_34`
  - calls `preflight:watchStationPublishRaceWindow`
  - station argument is `NZWN`
  - starts at minutes `04` and `34`
  - passes `durationMs=900000`, so each watch runs for 15 minutes
  - polls PreFlight and NOAA `tgftp` every `1s` through the usual late
    post-`:00` / post-`:30` release window
- `nzwn_metservice_publicdata_every_2_min`
  - calls internal
    `nzwnWeather:pollScheduledMetServiceCurrentConditions`
  - exits without a request unless approval is the exact string `true`
  - exits without a request outside `09:00` through `18:59`
    `Pacific/Auckland`
  - stores only a newer timestamped station `93439` current reading
  - deduplicates equal timestamps and rejects cached timestamp regressions
- MetService daily-forecast snapshot collection is disabled and has no cron;
  the current-conditions approval flag cannot activate it

NZWN uses both:

- continuous minute-by-minute PreFlight/NOAA polling as a fallback
- 1-second watch windows starting at `:04` and `:34`

That combination is needed because Wellington reports can appear several minutes
after the nominal `:00` and `:30` schedule.
