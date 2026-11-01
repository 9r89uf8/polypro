# Seoul 15L minute-temperature nowcast (removed)

Removed on November 2, 2026 KST at the owner's request. From October 31, 2026
it estimated the 15L AMOS reading 10, 15 and 20 minutes after each new
one-minute reading. The headline was the no-change (persistence) estimate,
shown beside a damped-trend test and, from November 1, a seasonal drift test
built offline from open IEM RKSI METARs. Each estimate was scored against the
15L reading at its target minute.

## Results before removal

Mean absolute error on paired cases, November 1, 2026 KST (about 1,420 cases
per lead):

| Lead | No change | Trend test | Drift test |
| --- | ---: | ---: | ---: |
| 10 minutes | 0.12 °C | 0.15 °C | 0.15 °C |
| 15 minutes | 0.14 °C | 0.17 °C | 0.18 °C |
| 20 minutes | 0.17 °C | 0.21 °C | 0.23 °C |

From midnight to 08:09 KST on November 2 (about 470 cases per lead) the errors
were 0.14, 0.18 and 0.23 °C for no change, 0.16, 0.19 and 0.23 °C for the trend
test, and 0.15, 0.19 and 0.24 °C for the drift test. On November 1 neither test
beat no change at any lead or in any issue-time window. Errors were largest
overnight (0.21–0.30 °C for no change) and smallest in the afternoon
(0.05–0.07 °C). The drift test's 4–11% gain in an offline replay of October
26–31 did not hold live.

## What was removed

- The day-page card (`TemperatureNowcast.js`, `nowcastState.js`) and its
  `seoulNowcast:getDashboard` subscription. The stylesheet the remaining
  experimental cards share is now `experimentCard.module.css`.
- `convex/seoulNowcast.js` (issue, score, prune, backfill and dashboard
  functions), the model, the generated drift table, and the hook in the
  one-minute AMOS ingest that saved input versions and queued forecasts.
- The crons `seoul_temperature_nowcast_scoring` and
  `seoul_temperature_nowcast_retention`.
- The nowcast tests, the drift build and replay scripts, and their evidence
  files.

## What remains

The stored rows in `seoulNowcastObservationVersions`, `seoulNowcastForecasts`,
`seoulNowcastOutcomes` and `seoulNowcastDailyScores` are kept, and their
definitions stay in
[`convex/lib/seoulNowcastSchema.js`](../convex/lib/seoulNowcastSchema.js) so the
rows keep validating. No function reads or writes them, and nothing prunes them
any more. To remove them completely, clear the four tables in the Convex
dashboard, then delete that file and its entry in `convex/schema.js`.

`scripts/fetch-iem-rksi-metars.mjs`, which downloads the IEM archive, stays
for the [analog peak library](./seoul-analog-peak.md).
