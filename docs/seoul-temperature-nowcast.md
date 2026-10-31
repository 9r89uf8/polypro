# Seoul 15L minute-temperature nowcast

Version one predicts the **15L AMOS temperature reading** at explicit target
minutes approximately 10, 15 and 20 minutes after issuance. It is independent
of the daily-high ceiling, official integer METAR and market settlement. It
makes no claim of measured skill or calibrated uncertainty. The dashboard
headlines the persistence (no-change) estimate; a replay of stored minutes
found the damped trend less accurate, so it is shown only as a smaller test
value. See [the display decision](#display-decision-and-stored-minute-replay).

## Issuance and timing

`seoul:upsertAmosRowsBatch` retains immutable normalized input versions for
canonical RKSI runway 2/15L and 3/16L one-minute rows. After that transaction
commits, a newly captured 15L observation minute schedules
`seoulNowcast:issueForObservation`. Repeat polling, five-minute snapshots and
corrections to an already captured minute do not reissue. Atomic lookup by
station/observation-minute/model-version makes retries idempotent.

The worker uses its actual transaction time as `issuedAt`, never the earlier
ingestion clock. Targets are `floor(issuedAt / 60000) * 60000 + horizon`.
Issuance at 12:00:14 KST targets 12:10, 12:15 and 12:20, with actual leads of
9m46s, 14m46s and 19m46s. With an 11:59 latest observation, the extrapolation
spans 11, 16 and 21 minutes. Both lead lengths are saved. Delayed workers skip
superseded triggers instead of issuing under an older minute's identity.

Inputs cover the preceding 60 minutes across KST date boundaries. Only
versions captured by issuance are eligible. A 15L reading older than two
minutes produces an unavailable record. Invalid latest values cannot revive
older, apparently fresh readings. Primary and secondary sites stay distinct.
A 600-version-per-site read limit fails closed if reached, rather than
estimating from a truncated window.

## Methods and calibration

`convex/lib/seoulNowcastModel.js` identifies the model as
`rksi15l-minute-nowcast-v1`. Internal calculation precision is preserved.

- **Persistence:** the latest valid 15L reading at every target.
- **Damped trend:** latest 15L temperature plus
  `slopeCPerMinute * 20 * (1 - exp(-observationLeadMinutes / 20))`.
  The slope reuses the robust pairwise-median 15-minute temperature trend:
  at least four distinct observations, at least 75% represented minute
  coverage, and a final adjacent-observation gap no greater than five minutes.
  Pairwise offsets use elapsed time, not array positions.
- Insufficient trend coverage leaves a clearly labeled persistence fallback
  with the damped estimate absent.

The window and damping time are **fixed, unvalidated starting parameters**.
16L, wind, dew point, pressure, visibility/RVR, precipitation and local time are
retained for future analysis; they do not adjust this first model. Rain totals
are not interpreted as minute rainfall. Cloud base is not cloud coverage.
Satellite and market prices are not inputs. No regression or training job is
deployed.

Every result carries `intervalStatus: insufficient_calibration`. The UI says
“No calibrated prediction range yet”; no confidence band is invented. A learned
model needs chronological training/tuning, separate calibration and untouched
later evaluation across multiple days/weather episodes. Adjacent forecasts
are dependent. Seasonal features do not establish unseen-season skill.

## Immutable evidence and scoring

Mutable `seoulAmosObservations` rows remain the chart's current data, not a
source of exact historical replay. `seoulNowcastObservationVersions` is
append-only during retention and preserves exact normalized model inputs,
identity and each version's `receivedAt`. This is database capture time, not
HTTP receipt or upstream publication. A source row's original `firstSeenAt`
is retained separately when known; it cannot date a later correction.
Existing rows first encountered after release get the new capture clock,
never invented historical availability. Raw JSON and redundant Fahrenheit
and inHg values remain in the existing collector table and are not duplicated.

`seoulNowcastForecasts` stores immutable predictions, input-version IDs, a
feature snapshot, quality/rejection reasons, model version, clocks,
targets and both lead lengths. Scoring never patches it. Conflicting versions
with indistinguishable receipt/creation clocks fail closed. Historical input
payloads are referenced rather than duplicated in each forecast; the source
versions reconstruct the complete calculation window.

Separate `seoulNowcastOutcomes` records are pending/scored/missing. The
`seoul_temperature_nowcast_scoring` cron calls `seoulNowcast:scorePending`
every minute, including with no open page or a failed source feed. Policy
`first-valid-captured-15l-v1` is:

1. Require an exact target-minute canonical one-minute 15L reading. Never
   interpolate or substitute neighboring minutes.
2. Select the first valid version captured after issuance and no later than
   target plus 30 minutes. Broad -80…60°C sanity limits reject common
   sentinels; they are not instrument quality control.
3. Freeze the score. Later corrections remain separate source versions and
   do not rewrite predictions or scores. First valid captured does not mean
   first provider publication.
4. Mark missing after that deadline if no eligible target exists. Missing
   targets are counted and excluded from error statistics.

The valid-target index finds the first eligible target even after many
invalid revisions. Outcome and daily-statistic updates are atomic, so retries
cannot double-count errors.

## Dashboard and retention

`seoulNowcast:getDashboard` selects the **issuance date** in KST, returning the
latest issue, up to twelve recent issues with outcomes, up to four issues
having a scored target, and current-model
daily aggregates for the 30 dates ending on the selected date. Targets can
cross midnight. The frontend prefers the scored issues in its details, so a
continuous stream of new pending forecasts does not hide actual results.
Each card's large value is the persistence estimate. The damped trend appears
as a smaller “Trend test” line, or “Trend test unavailable” when coverage is
insufficient, and recent results list both beside the actual 15L reading.

The existing 15-second client clock expires live status when either issue or
source-observation age exceeds two minutes, even if database writes stop.
Past dates show archived forecasts with explicit cross-date target times.
Page refresh neither reissues nor makes saved values fresh.

`seoulNowcastDailyScores` keeps issued/scored/missing/paired counts and absolute
and signed error sums by issuance date, horizon and model. Persistence MAE
uses all scored targets; **paired** persistence MAE and damped MAE compare
exactly the same cases. The API also exposes bias and scored/paired-day
counts. These are experimental records, not independent sample counts or
calibrated uncertainty.

Issued counts describe generated horizon forecasts only. Unavailable issue
records and skipped/superseded jobs are not counted as forecast opportunities
in these score denominators.

Hourly `seoul_temperature_nowcast_retention` calls `seoulNowcast:pruneExpired`.
It removes at most 128 rows per table per transaction and reschedules while
another batch may remain.

| Records | Retention |
| --- | --- |
| Immutable forecasts and separate outcomes | 30 days from issuance |
| Normalized input versions | 32 days from capture |
| Daily scores | 365 days |

The two-day source buffer exceeds the one-hour input lookback. Retained
forecasts retain their source evidence. Export before expiry for longer
research; this rolling ledger does not provide an annual training archive.

## Display decision and stored-minute replay

On November 1, 2026 KST the dashboard's large value changed from the damped
trend to persistence. The trend is still issued, saved and scored on paired
cases, so the live ledger can show whether it ever earns the headline. The
model, scoring and stored records did not change.

The decision follows an offline replay of the unchanged `buildNowcast` rule
over every stored one-minute 15L row from 10:42 KST on October 26 through
23:32 KST on October 31: 7,910 issues, 7,888 with a trend and 22
persistence-only. Each issue saw only rows whose stored `firstSeenAt` preceded
it, and targets followed the first-valid-captured rule. The rule was not tuned
on these days.

| Target | Paired cases | Persistence MAE | Damped-trend MAE | Trend change |
| --- | ---: | ---: | ---: | ---: |
| 10 minutes | 7,824 | 0.242°C | 0.283°C | +17.2% |
| 15 minutes | 7,815 | 0.294°C | 0.348°C | +18.3% |
| 20 minutes | 7,809 | 0.342°C | 0.399°C | +16.5% |

- The trend was less accurate on every KST issue date, apart from one
  20-minute tie on October 27.
- It helped only during the 06:00–10:00 KST warm-up, with 8–15% lower error,
  and roughly tied from 14:00 to 18:00. It was 14–16% worse from 10:00 to
  14:00, 24–29% worse overnight and 31–38% worse from 18:00 to midnight.
- When the actual change was at least 0.5°C, the trend was still 5–9% worse.
- Rounded to whole degrees at routine METAR minutes, persistence matched 198,
  189 and 178 reports, versus 192, 171 and 166 for the trend, out of 263, 263
  and 262 paired slots.

A 15-minute slope follows short fluctuations and 0.1°C steps, and the
20-minute damping still keeps 63–79% of a straight-line projection at these
leads. These are 5.5 dependent late-October days from one season, not a skill
estimate for other weather. The exports hold only each minute's current row,
so unretained revisions cannot be replayed.

Reproduce from stored `seoul:getDayStationRows` responses saved as
`day-YYYY-MM-DD.json` in one directory. They contain database IDs, so keep them
in ignored local storage:

```text
node scripts/replay-seoul-nowcast-v1.mjs <export-directory> <new-output.json>
```

The [saved replay summary](assets/seoul-nowcast-v1-replay-20261101.json)
records input and source hashes, assumptions, and per-horizon, time-of-day and
per-date results. The script makes no requests and refuses to overwrite an
existing output.

## Boundaries and checks

This computes from the existing AMOS feed and adds no external request,
credentials, provider capability, approval flag or satellite fallback. Existing
access gates remain unchanged. Issuance, scoring and retention entry points
are internal; the dashboard query is read-only. No trading behavior is added.

Tests cover future-data exclusion, revisions/sentinels, timing, midnight,
duplicate polling, coverage, fallback, delayed jobs, immutable issuance,
target corrections, missing targets, paired metrics, retention, client
freshness and the no-change headline. Publish Convex schema/functions before the frontend calls the new
query. The local Next.js build limitation in `AGENTS.md` still applies.
