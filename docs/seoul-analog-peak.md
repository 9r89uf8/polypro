# Seoul analog peak timing

Added November 1, 2026 KST. The Seoul day page estimates **when the day's
highest whole-degree routine METAR will first appear**, the chance that it is
still ahead, and the likely high, from the most similar past mornings. This is
the reading the daily-high market settles on. It is experimental and separate
from the 15L minute nowcast and from the `rksi15l-remaining-ceiling-v2`
decision; neither uses its output.

## Library

[`convex/lib/seoulAnalogPeakLibrary.js`](../convex/lib/seoulAnalogPeakLibrary.js)
is generated from the open Iowa Environmental Mesonet RKSI archive described in
the [nowcast specification](./seoul-temperature-nowcast.md#seasonal-drift-test),
using reports from January 1, 2016 until October 26, 2026 KST. Days need at least
44 of the 48 routine :00/:30 reports; 3,927 of 3,951 qualified. For each day it
stores the maximum, the first and last half-hour slots reporting it, and the
features at 09:00 and 12:00 KST (3,923 days each). Two reports could not be
parsed. Production never requests IEM data.

[`convex/lib/seoulAnalogPeakModel.js`](../convex/lib/seoulAnalogPeakModel.js) is
shared by the builder, the live issuer and the evaluation, so stored and
historical reports are parsed from raw METAR text in the same way. Trend groups
and remarks are ignored.

## Model `rksi-analog-peak-v1`

At a checkpoint the features are temperature, change since the report three
hours earlier, dew-point spread, the most covered cloud layer (0 clear to 4
overcast or vertical visibility), wind as east and north components in knots
(variable wind counts as none), and any precipitation in the past three hours.
Both the checkpoint report and the one three hours earlier must exist.

The pool is every library day within 15 calendar days of the date, across the
year end. Features are standardized over the pool with equal weights, and the
30 nearest days are the analogs. Outputs, beside the same figures for the whole
pool ("season"):

- 10th, 50th and 90th percentile of the first and last peak times, by linear
  interpolation;
- the share of days whose peak came after the checkpoint;
- the likely high: today's checkpoint temperature plus each day's remaining
  rise, never below the highest report so far; median and 10th–90th range;
- the five closest days.

## Issuance, scoring and storage

`seoul_analog_peak_checkpoints` runs `seoulAnalogPeak:issueScheduledCheckpoint`
every five minutes through the 09:00 and 12:00 KST hours. The routine report
usually arrives about five minutes after the hour, so the first attempts wait.
Once features exist, one immutable `seoulAnalogPeakForecasts` record is saved
per date and checkpoint, with the input report times and the checkpoint
report's database receipt. If nothing usable exists at the :55 attempt, an
`unavailable` record states why. Only routine METARs at or before the
checkpoint are read; SPECIs are ignored.

`seoul_analog_peak_scoring` runs `seoulAnalogPeak:scoreCompletedDays` at 00:20
KST. Ready forecasts from the past week without an outcome get a separate
`seoulAnalogPeakOutcomes` record: `scored`, with the actual maximum, first and
last peak times and both methods' errors, or `missing` when the day has fewer
than 44 routine reports. Scoring is idempotent. Both tables hold about two rows
a day and are kept.

`seoulAnalogPeak:previewCheckpoint` is an internal dry run for any stored date;
it saves nothing, so past dates never enter the forward record.

`seoulAnalogPeak:getDashboard` returns the seasonal window for the selected
date, its checkpoint forecasts with outcomes, and 30-day results per checkpoint
for both methods: peak-time error, how often the 10th–90th range held the
actual peak, the Brier score for "still ahead", and the exact-high share.

## Historical evaluation

[`scripts/evaluate-seoul-analog-peak.mjs`](../scripts/evaluate-seoul-analog-peak.mjs)
forecast every library day from analogs at least 183 days away, so a day's own
season never informs it:

| Checkpoint | Peak-time error, analog vs season | Range held actual | "Still ahead" Brier | High exact |
| --- | ---: | ---: | ---: | ---: |
| 09:00 | 126 vs 134 min | 81% vs 85% | 0.062 vs 0.082 | 28% vs 23% |
| 12:00 | 125 vs 134 min | 83% vs 85% | 0.181 vs 0.207 | 47% vs 45% |

The analog range was much narrower at about the same coverage (354 versus 446
minutes at 09:00). Gains were largest in winter, with a 09:00 peak-time error
of 168 versus 193 minutes, a "still ahead" Brier of 0.087 versus 0.129, and at
12:00 an exact high on 48% versus 38% of days. Spring and summer peak times did
not improve. Single peak times stay about two hours off because whole-degree
highs are often reached late in the morning and held for hours, and some
winter highs come at night with a change in weather. For the late-October
season the high is usually first reported around 1:00 PM (most days 9:30 AM to
3:00 PM) and last around 3:00 PM.

The feature weights and the analog count were fixed, not tuned. The scored
live record, not this look-back test, decides whether the card earns more
weight.

## Dashboard

The card on `/seoul/day/[date]` follows the nowcast card. Before 9:00 AM it
shows the seasonal window and typical high, labeled throughout as past days near
the date rather than a forecast for today (“When the high usually comes”, “Past
days only”, “Usually first at the high”). After each checkpoint it shows the
analog peak time and range, the chance the high is still ahead, and the likely
high, each beside the season figure, then the matched conditions, the closest
days and when similar days last reported their high. A later unavailable
checkpoint is stated. Past dates show the saved forecast and, after scoring,
the actual high and peak-time errors. Details explain the method and list 30-day
results. Times are rounded to the half hour the reports use.

## Reproduction

```text
node scripts/fetch-iem-rksi-metars.mjs <new-iem-dir> 2016 2026-10-26
node scripts/build-seoul-analog-library.mjs <iem-dir> 2026-10-26 rksi-iem-analog-library-v1 convex/lib/seoulAnalogPeakLibrary.js <new-evidence.json>
node scripts/evaluate-seoul-analog-peak.mjs <new-output.json>
node --test test/seoul-analog-peak-model.test.mjs test/seoul-analog-peak-backend.test.mjs test/seoul-analog-peak-ui.test.mjs
```

The [build evidence](assets/seoul-analog-peak-library-v1-build-20261101.json)
records input hashes and counts, and the
[evaluation](assets/seoul-analog-peak-v1-evaluation-20261101.json) records every
season's results with model and library hashes. A new library needs a new
library version; changing features or weights needs a new model version.

## Boundaries

No external request, credential, provider capability or approval flag is
added; issuance and scoring read stored routine METARs only. IEM data is
credited on the card. Tests cover METAR parsing (CAVOK, variable and metric
wind, vertical visibility, trend groups), checkpoint inputs, day coverage,
seasonal pools across the year end, analog ranking and quantiles, issuance
waiting, duplicates and unavailable records, scoring and missing days, the
dashboard, and every card state.
