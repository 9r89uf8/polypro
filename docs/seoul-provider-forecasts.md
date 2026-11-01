# Seoul 9 AM provider forecast lock

Added November 1, 2026 KST. The Seoul day page compares five forecasts for RKSI
**as they stood at 9:00 AM KST** with what happened afterwards, so that over
many days it shows which provider tends to be right about the hourly
temperature and the daily high. It is experimental. Nothing else on the page
uses its output.

| Provider | Source | Gate |
|---|---|---|
| KMA airport forecast | Stored `seoulKmaForecastCaptures` (no new request) | `KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED` (existing) |
| Weather.com | Stored `seoulForecastCaptures` (no new request) | none (existing unofficial secondary source) |
| ECMWF IFS 9 km (`ecmwf_ifs`) | Open-Meteo forecast API | `OPEN_METEO_FORECAST_ACCESS_APPROVED` (new) |
| NOAA GFS (`ncep_gfs_global`) | Open-Meteo forecast API | `OPEN_METEO_FORECAST_ACCESS_APPROVED` |
| DWD ICON (`dwd_icon_global`) | Open-Meteo forecast API | `OPEN_METEO_FORECAST_ACCESS_APPROVED` |

Open-Meteo's own KMA models (`kma_seamless`, `kma_gdps`, `kma_ldps`) returned
only null values when checked on November 1, 2026 and are not used. JMA, Météo-France
and UKMO are available from the same API and could replace a model in
`PROVIDERS` ([`convex/lib/seoulProviderForecastModel.js`](../convex/lib/seoulProviderForecastModel.js)).

## The lock

The lock time is `Date.parse(`${date}T09:00:00+09:00`)` (00:00 UTC). One record
per KST date and provider is written to `seoulProviderForecastLocks`. A usable
record (`ok` or `partial`) is never replaced; an `error` record may be replaced
by a later attempt.

- **KMA:** the newest `ok` capture from `kma_amo_airport` with `capturedAt` at
  most 6 hours before and not after 09:00, whose stored `createdAt` (when the
  capture finished) is not after 09:00, and which has hourly rows for the date.
  KMA is collected at :05 and :35, so the lock is normally the 08:35 capture.
  Only that capture's rows are used; hours are never merged across captures.
- **Weather.com:** the newest capture in the same window whose hourly product
  succeeded and whose `weathercomHourlyCapturedAt` (response completion) is not
  after 09:00, normally the 08:47 capture.
- **Models:** one Open-Meteo request per model at 09:00 KST with
  `latitude=37.4602&longitude=126.4407&models=<id>&hourly=temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=Asia/Seoul&start_date=<date>&end_date=<date>&timeformat=unixtime`.
  The response does not name its model run, so the model's
  `/data/<domain>/static/meta.json` is read before and after (`ecmwf_ifs`,
  `ncep_gfs013`, `dwd_icon`). The record keeps the run's start and availability
  times and `runCheck` (`stable`, `changed` or `unknown`), the grid cell and
  elevation, and the request URL without any API key. A run published after
  09:00 (its availability time, read before or after the request, is after the
  lock) is refused: the attempt records an error naming the run instead of a
  forecast, and makes no forecast request when the first metadata read already
  shows such a run. A run that changed during the request without a known
  availability time is stored without a run time, with an issue note; one that
  became available less than 10 minutes earlier gets a note too.

Because KMA and Weather.com locks depend only on what had been stored by 09:00,
rebuilding a past date reproduces exactly what a live lock would have chosen.

**Which model run the lock gets.** Checked live in the November 1 lock window:
at 00:00 UTC ECMWF's newest run was the previous day's 12Z (its 18Z run became
available at 00:21 UTC), while GFS and ICON were on 18Z. ECMWF therefore starts
six hours behind; the card says so. GFS 18Z became available only about 33
minutes before the lock, so a late run leaves GFS on 12Z for that day. A retry
after a failed 09:00 request never takes a run published after 09:00; when only
such a run is served, the day keeps an error record. `backfillModelLocks` can
fill it later, but always with the usual run, so on a day when that run was
late the rebuilt lock (labelled “Rebuilt”) is a run that was not yet served at
09:00.

Hourly rows are stored for every on-the-hour value of the KST date
(`hour`, `time`, `tempC`, and `cloudCoverPct`/`cloudLowPct`/`cloudMidPct`/`cloudHighPct`
where the source gives them, plus `sky` words and KMA's `skyCode`). A variable
the model does not provide (unit `"undefined"`) or a null value is left out,
never stored as 0. KMA rows never carry a cloud percentage. The record's status
is `ok` when every hour from 9 AM to 11 PM is present, `partial` with some and
`error` with none.

## Scoring

- **Hourly:** for every hour from 9 AM to 11 PM, the forecast minus the 15L
  AMOS reading at exactly that minute (one-minute rows first, then five-minute,
  then legacy; the newest update breaks ties). No interpolation, no 16L
  substitution. Missing readings are skipped. Average miss (MAE) and bias are
  over the hours scored; positive bias is warmer than observed. KMA and
  Weather.com publish whole degrees; rounding adds at most 0.25 °C to the MAE
  of an otherwise perfect forecast, and only a few hundredths at typical misses
  near 1 °C.
- **High:** the forecast high is the highest hourly value from 9 AM on; every
  hour that reaches it is a peak hour. It is rounded half up to whole degrees
  (12.5 becomes 13) and compared with the highest routine METAR from 9 AM on
  (reports at :00/:30 only, which excludes SPECIs). The peak-time error is the
  first forecast peak hour minus the first report at the observed high. A high
  is scored only for a lock with every hour from 9 AM to 11 PM (missing hours
  may hold the provider's peak; the hours that exist still count toward the
  MAE) and with at least 26 of the 30 routine reports after the lock.
- **High from 9 AM, not the settlement high:** the market settles on the
  routine reports of the whole KST date. On a day whose high came before 9 AM
  the two differ, so the card labels every scored high “from 9 AM” and its
  headline names the earlier high on such days.
- **Observed sky:** the METAR at each hour, parsed by
  [`convex/lib/seoulMetarSky.js`](../convex/lib/seoulMetarSky.js) with the day
  page's rules (several layers bound the union; CAVOK, NSC, NCD, CLR and
  vertical visibility are unknown cover, not clear sky). Cloud cover is shown,
  not scored.

`getDashboard` computes today's scores live from the stored record.
`scoreCompletedDays` saves one `seoulProviderForecastScores` row per lock after
KST midnight (window: the last 7 days by default), with the hour pairs used.

## Schedules and entry points

| Function | Kind | What it does |
|---|---|---|
| `runScheduledLock` | internal action, cron `seoul_provider_forecast_lock` `0,5,10,15 0 * * *` UTC | Inside 09:00–09:20 KST only: locks KMA (if approved) and Weather.com, then each missing or failed model (if approved) |
| `lockStoredForecasts` | internal mutation | KMA/Weather.com lock for one date; refuses before 09:00; `recordMissing` writes an error record when no capture qualifies |
| `storeModelLock` | internal mutation | Saves a model lock; re-checks the approval flag; a live lock must be stored within 25 minutes of 09:00, an archived one needs its run time |
| `backfillStoredForecasts` | internal action | KMA/Weather.com locks for up to 31 past dates; never records errors |
| `backfillModelLocks` | internal action | Gated rebuild from Open-Meteo's single-runs archive (`run=` previous day 12Z for ECMWF, 18Z for GFS and ICON, `forecast_days=2`), labelled `single_run_archive`; stops with `approval_required` at the first check after the flag is removed |
| `openMeteoAccess` | internal query | The Open-Meteo flag as a fresh execution sees it; read before every Open-Meteo request |
| `scoreCompletedDays` | internal mutation, cron `seoul_provider_forecast_scoring` `25 15 * * *` UTC (00:25 KST) | Scores approved locks once |
| `getDashboard` | public query | Locks, observed record, live scores and the 30-day summary for one date |
| `lockStatuses` | internal query | Status per provider for a date |

Backfill commands (deployment `striped-chipmunk-763`, which the CLI classifies
as development):

```text
npx convex run seoulProviderForecasts:backfillStoredForecasts '{"startDate":"2026-10-29","endDate":"2026-11-01"}' --deployment-name striped-chipmunk-763
npx convex run seoulProviderForecasts:scoreCompletedDays '{"startDate":"2026-10-29","endDate":"2026-10-31"}' --deployment-name striped-chipmunk-763
```

KMA captures start on 2026-10-29 07:44 KST, so earlier dates have no KMA lock.

## Open-Meteo approval gate

Open-Meteo is keyless and technically reachable, but its
[terms](https://open-meteo.com/en/terms) allow the free API for non-commercial
use only; sites with subscriptions or advertising, commercial products and
undisclosed research at commercial entities are listed as commercial. Whether
this application's use is commercial is the owner's decision. Production model
requests therefore fail closed behind the server-side Convex value:

```text
OPEN_METEO_FORECAST_ACCESS_APPROVED=true
```

Only the exact string `true` approves; missing, empty, `false` or any other
value does not. The approving authority is the project owner, confirming that
the use complies with Open-Meteo's terms: either non-commercial use of the free
API, or a paid Open-Meteo subscription that covers it (API Standard covers the
forecast endpoint; the single-runs archive needs Professional, per Open-Meteo's
pricing page). The scope is the hourly variables above for the RKSI point from
the three models, once per day (at most four attempts, each making three requests — metadata,
forecast, metadata — per model not yet locked) plus optional archive rebuilds, with storage and display on the day
page. The optional `OPEN_METEO_API_KEY` switches requests to
`customer-api.open-meteo.com` / `customer-single-runs-api.open-meteo.com`; a key
is a credential, not approval, and is never stored or returned.

**While disabled:** no Open-Meteo request is made and nothing is written;
`runScheduledLock` and `backfillModelLocks` return `approval_required`,
`storeModelLock` refuses, `scoreCompletedDays` skips model locks and
`getDashboard` returns ECMWF, GFS and ICON as `approval_required` without any
stored data. The card lists them as "Approval required" and its footer says
they wait for Open-Meteo approval. A running action can keep the environment
it started with, so the flag is read through the internal query
`openMeteoAccess` (a fresh execution) before every Open-Meteo request (each
metadata read, forecast and archive request), and again in the mutation that
stores a result. Removing it ends the run at the next check: nothing more is
requested or stored, the remaining models are reported as
`approval_required`, and a rebuild stops at that date with
`status: "approval_required"`. A request already in flight at the removal
completes, and its result is discarded.

The same rules apply to KMA through its existing flag: without it the lock does
not read KMA captures, scoring skips KMA and the dashboard hides KMA data.

Deploy code, schema and schedules with the flag absent and verify the disabled
state first. Then, only after the owner confirms the scope:

```text
npx convex env set OPEN_METEO_FORECAST_ACCESS_APPROVED true --deployment-name striped-chipmunk-763
```

Remove it to stop new requests and hide stored model data:

```text
npx convex env remove OPEN_METEO_FORECAST_ACCESS_APPROVED --deployment-name striped-chipmunk-763
```

For a Convex production target the same commands use `--prod`.

**Deployed** to `striped-chipmunk-763` on November 1, 2026 at 11:36 KST with
the flag absent (no `OPEN_METEO_*` variable set). `getDashboard` for
2026-11-01 then returned ECMWF, GFS and ICON as `approval_required` with no
data, and KMA and Weather.com as approved. The flag has not been set.

**Attribution** (shown in the card's details whenever model data is shown):
Open-Meteo data is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
with a link to [open-meteo.com](https://open-meteo.com/); ECMWF IFS carries
"© ECMWF, source www.ecmwf.int, CC BY 4.0" with ECMWF's no-liability statement
([licence](https://apps.ecmwf.int/datasets/licences/general/)); ICON credits
DWD ([copyright](https://www.dwd.de/copyright)); GFS is NOAA public-domain data
with no endorsement implied.

## Limits

- One airport sensor against a model grid cell. The cells chosen on November 1
  were 5.0 km (ECMWF), 3.5 km (GFS) and 19.1 km (ICON, land cell; the nearest
  cell would be 6.9 km and differed by up to 2.3 °C overnight) from RKSI. ICON
  moves to its native grid after November 30, 2026.
- Model values are instants at the hour, so a short peak between hours is not
  in any hourly forecast.
- A few days decide nothing. Providers can also have different numbers of
  scored days (KMA from October 29; models only after approval or a rebuild),
  so compare them over shared days.
- METAR cloud is a coarse range from one observer, and CAVOK hides cloud above
  about 5,000 ft; forecast total cloud includes high cloud.

## Tests

`test/seoul-provider-forecast-model.test.mjs`,
`test/seoul-provider-forecast-backend.test.mjs` and
`test/seoul-provider-forecast-ui.test.mjs` cover row normalization, the capture
selection clocks, write-once and retry behaviour, every gate path (including a
flag removed mid-run while the action keeps its starting environment, for the
daily lock and a month-long rebuild), a retry refusing a run published after
9:00, the archive run choice, scoring (including a partial lock's high), the
dashboard and the card's states. Open-Meteo responses in tests are synthetic.
