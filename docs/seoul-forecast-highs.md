# Seoul forecast highs by provider

Added November 3, 2026 KST. The Forecast high card lists the daily high that KMA,
Weather.com and AccuWeather publish for RKSI, and when each one last changed.
KMA stays the large number and the source of the peak hours; the other two are
separate labeled rows and never replace or blend with it.

| Provider | State | Collected | Gate |
|---|---|---|---|
| KMA airport forecast | Live | Every 10 minutes (existing) | `KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED` (existing) |
| Weather.com | Live | Every 15 minutes (existing) | None (existing unofficial secondary source) |
| AccuWeather | Off until activated | Every 15 minutes once activated | `ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED` (new) and `ACCUWEATHER_RKSI_API_KEY` (new) |

## Is each forecast for the airport?

Each provider's high reaches the page only with evidence that it is for the airport.
Otherwise the row says `Airport location not confirmed` and nothing is recorded.

| Provider | Requested by | Runtime check | What was seen on November 3, 2026 |
|---|---|---|---|
| KMA | `amo.kma.go.kr/eng/airport.do?icaoCode=RKSI` | The parser refuses a page that does not display `RKSI` | The page's airport code |
| Weather.com | `icaoCode=RKSI` on the forecast request | `v3/location/point?icaoCode=RKSI` on every run must return ICAO `RKSI` within 5 km of RKSI's reference point (37.4602, 126.4407) | The linked 10-day page describes an `Airport`: ICN, RKSI, 37.469, 126.451, which is 1.3 km away |
| AccuWeather | Fixed location key `3602_poi` | `locations/v1/3602_poi` once a day: that key, a name with “Incheon” and “airport”, country `KR`, within 5 km. Every row of every forecast must also link back to `3602_poi` | The linked page is “Incheon International Airport” at 37.469, 126.451 |

The AccuWeather key is never looked up. The geoposition search that the KORD
collector uses returns the nearest city rather than the airport, so it is not a
fallback here, and neither is any other location.

**Not yet seen working:**

- **Weather.com's location check.** `v3/location/point?icaoCode=RKSI` has not been run;
  a local test was blocked by a permission check. The fields it reads come from the
  existing `placeid` request in `convex/forecastCollector.js` and from Weather.com's page.
  The first production run decides it: if a field is missing, the row reads
  `Airport location not confirmed` until the check is corrected. Check the stored
  `seoulForecastHighStatus` row after deploying.
- **Weather.com's values against its page.** Stored `icaoCode=RKSI` highs for
  November 3, 4 and 5 (17, 17, 16 °C) match the page (62, 63, 61 °F). That is supporting
  evidence, not proof of the same grid point.
- **Anything from AccuWeather's API.** No key exists, so its responses in tests are
  synthetic, and whether the API accepts a `_poi` key is unconfirmed. A refusal shows
  as `Check failed`; it never falls back to another location.

## Which high each provider means

The three numbers are not the same quantity:

- **KMA:** its published daily maximum.
- **Weather.com:** `calendarDayTemperatureMax`, midnight to midnight, which the
  collector already preferred because the market settles on the KST date. Weather.com's
  10-day page shows the narrower daytime `temperatureMax`, so the two can differ. On
  November 3 the stored value for November 6 was 14 °C while the page showed 51 °F (about
  11 °C). That fits a cold front passing just after midnight, though it wasn't confirmed.
- **AccuWeather:** `Temperature.Maximum` for its forecast day, which starts at 7 AM.

## When a forecast changes

Every successful check passes its daily rows to `recordForecastCheck`
([`convex/lib/seoulForecastHighs.js`](../convex/lib/seoulForecastHighs.js)):

- `seoulForecastHighChanges` holds one row per distinct high per provider and target
  date. A new value inserts a row with `firstSeenAt`; a repeated value only moves
  `lastSeenAt`. A return to an earlier value is a new row, so reversals are kept.
- All dates in a capture are recorded, so a date's history starts days ahead of it,
  not at its own midnight. A date that has already ended is skipped, so a later
  capture can't alter a finished day, and so is a date whose rows disagree.
- `seoulForecastHighStatus` holds one row per provider with its latest check, last
  success, last error and airport evidence. Error text stays on the server; the page
  only learns that a check failed.

The times are ours, not the provider's. `firstSeenAt` is when our check started, so
the card says a value changed after the previous check rather than giving an exact
time. Neither is a provider issue time. A failed check leaves the last good high in
place with a `last check failed` note; live rows show `older forecast` after six hours
without a sighting.

`seoulForecastHighs:getProviderHighs` reads at most 60 changes per provider, newest
first, and flags a list it cut short. It replaces
`seoulDashboardHistory:getForecastHighHistory` on the page, which read every capture of
the day and the day before, and only showed changes made on the selected day. That
query stays deployed for bundles already open.

AccuWeather is not part of the [9 AM provider lock](./seoul-provider-forecasts.md),
which needs hourly values.

## AccuWeather approval gate

Production use fails closed behind the server-side Convex value:

```text
ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED=true
```

Only the exact string `true` approves. `ACCUWEATHER_RKSI_API_KEY` is a credential, not
approval. It is separate from the KORD collector's `ACCUWEATHER_API_KEY`, so setting it
doesn't start KORD's calls or share their quota.

**Approving authority and scope.** The project owner, confirming that an AccuWeather
plan and its [Terms of Use](https://developer.accuweather.com/documentation/terms-of-use)
cover this use: the 5-day forecast and location lookup for `3602_poi`, 96 forecast calls
and one location call a day (about 2,900 a month), keeping the daily highs for up to 13
days, and showing them on the public day page. As read on November 3, 2026:

- **Plan.** [Plans](https://developer.accuweather.com/documentation/overview) start
  with a 14-day trial at 500 calls a day, then Starter at $2 a month with 15,000 calls.
  Starter is limited to personal or non-commercial use, defined as not directed toward
  commercial advantage or monetary compensation. Whether a dashboard used for market
  trading fits that is the owner's decision; otherwise it needs Standard ($25 a month)
  or a separate license (sales@accuweather.com).
- **Storage.** API data may be cached for up to two weeks to improve the user experience,
  no other storage is licensed, and an archive or database is excluded. So no response
  is stored, only each high and when it was seen, and `seoul_accuweather_forecast_retention`
  deletes those at 13 days. Whether a change list counts as a cache is part of what the
  owner is confirming. On termination the data must be deleted:
  `npx convex run seoulAccuweatherForecast:pruneExpired '{"retainMs":0}' --deployment-name striped-chipmunk-763`.
- **Attribution.** The [brand guidelines](https://developer.accuweather.com/documentation/brand-guidelines)
  require the logo, linked to accuweather.com, in clear view wherever the data appears.
  The row replaces its name with AccuWeather's small dark-background logo whenever it
  shows data, loaded from their brand-assets URL at 14 px high, about the width their
  small-space artwork is meant for. Confirm the size against the guidelines on activation.
- **Scraping.** The website's [terms](https://legal.accuweather.com/) prohibit scraping
  without a separate written agreement, so the collector uses only the API and never
  reads the pages. The site link in the card is for people.

**While disabled:** no AccuWeather request is made and nothing is written.
`collectAirportForecast` returns `approval_required`, `storeCheck` discards, and
`getProviderHighs` returns the provider as `approval_required` before reading any of its
rows. With the flag set but no key it returns `setup_required`, requests nothing and the
row reads `API key needed`. A running action can keep the environment it started with, so
the flag is read through the internal query `accessState` before each request and again
in the store mutation. Cleanup only deletes, so it runs regardless.

**Protected entry points:** `seoulAccuweatherForecast:collectAirportForecast` (cron only,
with no public or manual path, and the page's Refresh doesn't call it),
`seoulAccuweatherForecast:accessState`, `seoulAccuweatherForecast:storeCheck` and
`seoulForecastHighs:getProviderHighs`.

Deploy code, schema and schedules with the flag absent and verify the disabled state
first. Then, only after the owner confirms the scope:

```text
npx convex env set ACCUWEATHER_RKSI_API_KEY <key> --deployment-name striped-chipmunk-763
npx convex env set ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED true --deployment-name striped-chipmunk-763
```

Remove the flag to stop new requests and hide stored highs:

```text
npx convex env remove ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED --deployment-name striped-chipmunk-763
```

For a Convex production target the same commands use `--prod`. Neither command has been
run, and this release has not been deployed.

## Weather.com

Weather.com keeps its existing arrangement, listed as unofficial in the
[provider lock](./seoul-provider-forecasts.md): no approval flag, and the collector
falls back to a hard-coded key when `WEATHERCOM_API_KEY` is unset. This change adds its
daily high to a second card and one location request per run. It doesn't add a gate. The
page already shows Weather.com's forecast in the 9 AM card and the hourly strip.

## Schedules and entry points

| Function | Kind | What it does |
|---|---|---|
| `seoulKmaForecast:storeForecastCapture` | internal mutation (existing) | Also records KMA's highs and status |
| `seoulWeather:collectForecastSnapshot`, `storeForecastCapture` | internal, cron `seoul_weathercom_forecast_every_15_min` (existing) | Also runs the location check and records highs and status |
| `seoulAccuweatherForecast:collectAirportForecast` | internal action, cron `seoul_accuweather_forecast_every_15_min` `7,22,37,52 * * * *` | Gated forecast request and airport checks |
| `seoulAccuweatherForecast:pruneExpired` | internal mutation, cron `seoul_accuweather_forecast_retention` `12 * * * *` | Deletes AccuWeather highs older than 13 days |
| `seoulForecastHighs:getProviderHighs` | public query | Each provider's changes and latest check for one date |
| `seoulForecastHighs:backfillChanges` | internal action | Replays stored KMA or Weather.com captures into the change rows |

## After deploying

Deploy Convex before the frontend, because the page subscribes to the new query. Once a
`seoulForecastHighStatus` row shows Weather.com's location was confirmed, replay what is
already stored so the card has history from the start. Running it again changes nothing.
Old Weather.com captures have no location evidence of their own; they were requested with
the same `icaoCode=RKSI`.

```text
npx convex run seoulForecastHighs:backfillChanges '{"provider":"kma","startDate":"2026-10-29","endDate":"2026-11-03"}' --deployment-name striped-chipmunk-763
npx convex run seoulForecastHighs:backfillChanges '{"provider":"weathercom","startDate":"2026-10-29","endDate":"2026-11-03"}' --deployment-name striped-chipmunk-763
```

## Tests

`test/seoul-forecast-highs.test.mjs` runs the real handlers against in-memory tables, with
synthetic provider responses: every gate path, approval removed mid-run, wrong-location
refusals for each provider, change rows, retention, attribution and backfill.
`test/seoul-history-ui.test.mjs` covers what each card row says.
