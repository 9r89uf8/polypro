# Seoul RKSI live-temperature page

This document describes the focused RKSI 15L temperature timeline, observed
cloud-cover estimates, KMA forecast conditions/ceilings, and GK2A solar-heating
panel, plus the collectors that feed them.

## Routes

### `/seoul/today`

This stable entrypoint redirects server-side to `/seoul/day/[date]`, using the
current `Asia/Seoul` date.

### `/seoul/day/[date]`

Example: `/seoul/day/2026-07-27`.

The route is a focused RKSI representative-temperature timeline. It starts with
live-source status cards, a compact maximum outlook, and one horizontally
scrollable full-day chart. Large provider-card and high-prediction revision
panels are not rendered. A compact remaining-ceiling decision block is rendered
inside the maximum outlook; it is not a revision-history browser.

Forecast-capture machinery remains connected because it supplies KMA/AMO's
official RKSI daily high, hourly temperatures and peak-time estimate, exact
condition phrases, ceilings, and the compact outlook. Weather.com history
remains visible only as an explicitly secondary comparison. The backend still
stores internal prediction revisions for historical retention and evaluation,
but the route derives its displayed expected maximum directly from the KMA
capture plus the observed floor and does not plot a tracker curve. Separately,
it renders the backend `rksi15l-remaining-ceiling-v2` decision for a selected
raw-tenths Celsius target.

The maximum outlook has six concise readings:

- the freshest displayed representative AMOS temperature;
- the observed AMOS maximum and its first occurrence;
- an expected maximum using KMA's published daily high, never lower than the
  observed maximum;
- KMA's published daily high as a separate raw official reading;
- KMA's hottest hourly temperature and its first-to-last tied-hour window;
- a robust 60-minute AMOS trend in degrees per hour.

Below those six readings, the v2 decision block shows the mutable current
state, target, rule ceiling, target margin, candidate time, confirmation count,
and current mutable blocker descriptions, plus immutable ceiling components,
robust 15/30/60-minute slopes, AMOS/KMA/GK2A evaluation freshness, 16L
corroboration, and model version. The UI labels the mutable state-check time separately from
the latest material snapshot time, so a no-op evaluation does not imply that
the immutable trend/source snapshot was refreshed. The expected maximum and
rule ceiling remain separate: the
former is the KMA published high floored by the observed high; the latter is a
conservative threshold policy value rather than a statistical confidence
interval.

The remaining-ceiling header always exposes three target controls:

- `Use KMA published high` captures the currently displayed raw KMA daily high
  once for the selected date. The captured value remains fixed while selected;
  a later reactive KMA revision does not silently move the threshold.
- `Next +0.1°C` captures the current representative raw observed maximum plus
  `0.1°C` once. It switches to custom mode but does not keep advancing as new
  observations arrive.
- `Custom raw target (°C)` accepts an explicit target in `0.1°C` steps. The
  server rounds to one decimal and accepts only `-20.0°C` through `45.0°C`,
  inclusive.

The custom input is always Celsius even when the page's display toggle is
Fahrenheit. The browser retains only the selected `kma` or `custom` mode and
the applied custom value under `polypro:seoul:remaining-target:v1`; it does not
persist a resolved KMA or `Next` value as if it were a new provider forecast.
Applying another target switches to that target's independent mutable state
and immutable revision lineage.

`already_reached` is target-relative. It appears as soon as the raw
representative observed high is greater than or equal to the selected target,
even at 10:00 KST and even when KMA forecasts a much higher daily maximum. It
does not mean that the forecast daily high has already occurred.

### Plain-language maximum summary

The maximum outlook also condenses the existing detailed values into three
plain-language questions. This is a presentation layer, not another forecast
model, and it does not replace the selected-target decision or its blockers.

#### Is today's high locked?

For the live day, the lock check uses its own raw AMOS target exactly `0.1°C`
above the observed high. That is the smallest possible new high in the
one-decimal series. It says `Yes` or `likely locked` only after this independent
next-tenth target reaches `unlikely_to_reach`, including the full blocker-free
15-minute confirmation. An arbitrary custom target being unlikely is not proof
that the current high is locked because the series could still rise without
reaching that farther target.

If the next-tenth decision becomes `already_reached`, a new high was detected;
the lock answer returns to unconfirmed and its target advances to the new
observed high plus `0.1°C`. `still_possible` means only that the deterministic
rules have not ruled out another tenth. It does **not** mean that another rise
is likely. Missing, stale, candidate, or insufficient states remain `awaiting`
or `not confirmed`. For a completed archived day, the card reports the highest
available stored observation rather than presenting a live lock inference or
claiming complete observation coverage that has not been finalized.

#### Is KMA's forecast high too low, on track, or too high?

This answer compares the observed high with the current published
`kma.dailyHighC` and keeps raw-tenths semantics explicit. Unlike the stable KMA
target captured by the selector, this forecast assessment follows a new
current KMA revision:

- A strict exceed is detected when the observed high is at least the current
  KMA high plus `0.1°C`. Differences below `0.5°C` are labeled as slightly low
  but within KMA's whole-degree publication resolution; `too low` is reserved
  for a difference of at least `0.5°C`.
- When the observed high equals the KMA high, the forecast has been `met`; it
  has not yet been strictly exceeded.
- KMA is `likely too high` or `likely to fall short` only when a decision whose
  target is the current published KMA high reaches `unlikely_to_reach`.
- Otherwise the forecast remains `on track` or tentative. Existing
  `running_warm`, `running_cool`, and `on_track` values describe direction
  relative to the hourly curve; they are not final verdicts on the daily high.

The strict exceed test deliberately compares integer raw tenths against the
current `KMA high + 0.1°C`, rather than using a floating-point greater-than
shortcut. Missing or stale KMA guidance produces an unavailable/tentative
answer instead of promoting Weather.com or guessing. If a stale stored KMA
value has already been met or exceeded, the card names it as a stored value and
does not relabel it as current guidance. Archived comparisons likewise say
`stored KMA value`; they are not forecast-skill scores because the available
capture may contain a later revision.

#### Is warming slowing?

This answer requires fresh, valid robust 15-, 30-, and 60-minute AMOS slopes.
The 15-minute slope describes the most recent rate, while the longer windows
show whether that rate is changing consistently. A `0.2°C/hour` band prevents
small quantized changes from being presented as meaningful acceleration:

- a 15-minute slope at or below `-0.2°C/hour` is `cooling`;
- a 15-minute slope strictly between `-0.2` and `+0.2°C/hour` is nearly steady;
- while still warming, rates stepping down by at least `0.2°C/hour` from 60 to
  30 to 15 minutes are `slowing`;
- a recent rate inside the steady band after that step-down is `leveled off`;
- positive 15-minute warming after a sub-`0.2°C/hour` 30-minute rate is
  `resumed`; other positive but non-monotonic sequences remain `still warming`
  or unresolved; and
- positive rates, each at least `+0.2°C/hour`, stepping up by at least
  `0.2°C/hour` from 60 to 30 to 15 minutes are `accelerating`.

Unavailable or stale slopes produce `awaiting data`. `Slowing` describes a
change in the warming rate only. It is not a locked high, a passed peak, or an
`unlikely_to_reach` decision; cloud clearing, advection, wind changes, or a
later rebound can still reverse the short trend.

On archived routes, the three questions use `final` or `last observed` wording
where applicable. A completed actual maximum may be called locked, but the
last stored slope is never presented as if it were a live trend.

The panel accepts only an approved KMA capture as forecast guidance; an older
Weather.com-only or multi-provider prediction revision cannot be relabeled as
official KMA guidance. A fresh query cannot make stale provider input look
fresh. When KMA collection is approval-gated or no stored KMA daily maximum is
available, the expected maximum falls back to the observed maximum and
Weather.com never fills the gap. A stale stored KMA daily maximum may remain
visible only with the stale label described below. The trends use median
pairwise slopes with minimum pair separations of 3.75, 7.5, and 10 minutes for
the 15-, 30-, and 60-minute windows. Each requires at least 75 percent distinct
minute coverage and no latest gap over five minutes, which reduces sensitivity
to one quantized or anomalous minute. On today's page the trend is suppressed
whenever the newest AMOS row is delayed or stale; an old window is never
presented as current warming or cooling.

The primary visualization has two observed series:

- `Official coded METAR · audit`
  - parsed RKSI temperature from the NOAA `tgftp` latest-METAR file
  - normally one report every 30 minutes
  - white line with prominent report markers
- `Representative AMOS · 15L designation`
  - representative row `rwyNo=2`, `rwyDir=15L`
  - captured by the AMOS minute-rollover watcher
  - cyan high-resolution line
  - silently uses a five-minute audit snapshot only when the matching
    one-minute timestamp is missing

The chart does not add a five-minute AMOS series or a separate live-tracker
temperature curve. A green diamond and horizontal dashed line mark the first
occurrence of the displayed representative AMOS maximum. A violet dashed
`KMA/AMO · official RKSI airport forecast` curve is the primary temperature
guidance, and its published daily-high marker remains as described below.
Secondary Weather.com revision diagnostics add a thinner blue latest-stored
curve and a faint, capture-time-labeled morning-baseline curve. The secondary
curves do not restore a tracker, blend into KMA, or fill a missing KMA value.

The x-axis is a complete `00:00–23:59` Seoul local day. The current Seoul minute
is marked when the selected date is today. A date-specific orange sunset line
and `SUNSET · h:mm` label use RKSI's coordinates (`37.4602`, `126.4407`) and the
standard official-sunset zenith, so historical and future dates do not depend
on a forecast-provider response.

Peak timing has two deliberately separate visual references:

- a rose circle marks KMA/AMO's published RKSI daily high at the first tied
  maximum in its hourly airport forecast; it deliberately has no vertical
  guide, in-plot label, or legend entry, while its exact provider, temperature,
  forecast hour, condition, and ceiling remain available in the tooltip and
  screen-reader description;
- a violet historical reference shows the median first occurrence of the daily
  15L maximum at `13:44 KST`, with a low-opacity middle-50% band from
  `12:20–14:39 KST`, only for March-through-July dates.

The rose marker intentionally remains on the first tied KMA hour. The v2 safety
decision instead uses the whole tied interval from the first tied hour through
the last tied hour plus one forecast interval, followed by another 30-minute
lag. A first-tie marker must not be interpreted as permission to confirm that
the peak window has ended.

The marker is KMA-only. Its vertical value is KMA/AMO's published daily maximum
for RKSI, floored by the observed AMOS maximum only in the separate expected-max
reading. Its horizontal position is the earliest tied maximum among KMA's
hourly temperatures for the same date. That hour is a discrete peak-time
estimate, not an exact instant; if the daily and hourly values disagree, the UI
does not claim that the published daily maximum literally occurs at the
selected hourly value.

The source URL selects Incheon International Airport explicitly with
`icaoCode=RKSI`:

```text
https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI
```

It does not use a Seoul-city place ID or coordinate-to-locality lookup. For
today and future dates, the chart reads the latest successful immutable KMA
capture and marks it stale when appropriate. Historical pages use
already-stored KMA captures and do not fetch a backfill. A date without an
approved KMA daily/hourly pair renders no KMA marker; a secondary Weather.com
high or hour is never substituted. The KMA daily row, hourly curve, conditions,
ceilings, peak time, and source timestamp all come from that same capture;
hours from older revisions are not carried into it.
Successful collection also requires the returned page's
`span.airport_spl` element to display `RKSI`; a missing or different ICAO is a
provenance mismatch, so a redirect or default-airport page cannot be stored as
the RKSI forecast.

The existing Weather.com child-row history still supports its secondary
latest, morning-baseline, revision, and AMOS-departure diagnostics. Its
provider completion times remain intact, but all visible Weather.com labels
say `Secondary Weather.com` and those rows have no authority over the primary
marker or curve.

The historical reference is a fixed, versioned snapshot of 130 complete 15L
days from `2026-03-20` through `2026-07-27`. Its circular clock-time average was
`13:39 KST`. It is labeled `Mar–Jul archive` rather than a
condition-matched forecast because the archive does not yet cover every season
and does not contain comparable historical forecast inputs for cloud, wind,
and precipitation. It is hidden for August-through-February dates rather than
being presented as a year-round typical window. For applicable dates the chart
header repeats the historical median and sunset time even when those parts of
the 2,400-pixel timeline are outside the current horizontal scroll position.
The x-axis has a label every hour so the full-day series remain legible. Y-axis
labels retain one decimal place, matching the AMOS sensor resolution instead of
rounding several fractional ticks to the same whole degree.

The chart reserves a 24-cell `HOURLY SKY COVER` strip immediately above the
temperature plot. Past and future cells intentionally use different kinds of
evidence:

- solid slate cells summarize completed-hour METAR observations;
- the current hour is clipped at the live `NOW` boundary: its elapsed observed
  portion uses an amber top edge and its not-yet-observed remainder stays
  hatched;
- violet forecast cells show KMA/AMO's exact upcoming categorical condition
  and, when published, its separate ceiling in feet;
- missing or non-quantifiable hours stay hatched and explicitly say `NO DATA`,
  `NO LOW CLOUD`, `SKY HIDDEN`, `VARIABLE`, or `PARTIAL` rather than looking
  like clear sky.

For observed hours, each coded sky state is carried forward only until the next
METAR/SPECI, with a maximum hold of 45 minutes. The bounded intervals are
intersected with each KST hour. An estimate is shown only when at least 45
minutes of a completed hour have explicit, quantifiable coverage. The current
hour needs at least 15 represented minutes. Category midpoints are
duration-weighted and rounded to the nearest 10 percent, with an `≈` prefix.
Because ordinary METAR spacing can leave part of an hour unrepresented, the
result estimates the represented METAR sample rather than claiming continuous
whole-hour measurement. A value is never presented as exact unless the full
window is represented. The details table preserves the range implied by the
time-weighted METAR category bounds:

- `FEW`: greater than 0 through 25 percent;
- `SCT`: 38–50 percent;
- `BKN`: 63–88 percent;
- `OVC`: 100 percent;
- `SKC`: 0 percent.

`CAVOK`, `NSC`, `NCD`, and automated `CLR` do not prove zero total cloud
cover, while `VV` means the sky is obscured rather than a known percentage.
Those states therefore remain textual. AMOS `cld1`, `cld2`, and `cld3` are
detected layer bases without coverage amount and are not used.

KMA's phrases are not percentages. The route preserves values such as
`Clear`, `Partly cloudy`, `Mostly cloudy`, and `Haze` verbatim and never maps
them to a numeric amount. A KMA ceiling is shown beside the condition but is
not treated as cloud amount. If a future KMA row has neither a condition nor a
ceiling, the cell says `KMA condition unavailable`; Weather.com is not used to
fill it.

Weather.com's numeric cloud field survives only as a clearly labeled secondary
completed-hour diagnostic. For each completed hour with a numeric
METAR-sample estimate, the route can compare the latest Weather.com
`cloudCoverPct` captured strictly before that hour. The signed value is
**secondary Weather.com forecast minus observed**: `+10%` means the secondary
forecast was 10 percentage points cloudier than the METAR sample, while `-20%`
means it was 20 percentage points clearer. A forecast captured at or after the
valid hour is never scored against that hour. The live partial hour,
non-quantifiable observations, and hours without a strictly pre-hour secondary
forecast show no delta. This score does not alter KMA's primary condition or
the high prediction.

The header repeats the latest observed-hour summary and the next available KMA
condition/ceiling. `Jump to now` and a one-time initial scroll position keep the
observed/forecast boundary visible on the 2,400-pixel chart. A collapsible
semantic table lists all 24 hours, sources, observed ranges, KMA conditions and
ceilings, capture times, and any secondary Weather.com comparison; the same
information is attached to the chart for screen readers. METAR temperature
tooltips retain the original observed sky/ceiling detail, while the KMA
forecast and provider-peak tooltips identify the official source, temperature,
forecast hour, condition, and ceiling. Weather.com hourly-point tooltips show
the selected secondary morning baseline, latest and previous-distinct
forecasts, capture/detection times, latest strictly pre-hour forecast, matched
AMOS reading, and available departures. A separate collapsible semantic table
exposes the same secondary revision and departure details without requiring
pointer access to the canvas.

The rest of the interface is deliberately compact:

- RKSI/live status and Seoul clock
- previous day, next day, date picker, and today navigation
- Celsius/Fahrenheit toggle
- manual live-observation synchronization
- one status card per plotted series
- fresh/delayed/stale observation-age badges for the newest AMOS and coded
  METAR rows
- observation age and AMOS receive latency shown as separate concepts; METAR
  uses `last stored` wording because its `updatedAt` is not immutable receipt
  truth
- capture-second or audit-fallback status for the newest displayed AMOS row

The previous correlation, publish-race, raw-METAR, and raw-observation panels
are no longer part of the primary Seoul page.

## GK2A solar-heating panel

The compact `SOLAR HEATING` panel adds a direct daytime-heating observation
alongside the categorical sky-cover strip. It subscribes to
`seoulGk2a:getSolarHeatingDashboard({ stationIcao: "RKSI", date })` and shows:

- estimated solar transmission, defined as the latest GK2A surface downward
  shortwave radiation (`DSR`) divided by a local Haurwitz clear-sky estimate;
- the change from the nearest valid sample approximately 30 minutes earlier;
- an increasing, steady, or decreasing next-hour signal from a robust recent
  transmission trend, overridden when the latest wind-projected upstream
  points show a materially clearer or cloudier signal;
- whether the upstream corridor is at least ten percentage points clearer than
  RKSI, plus an approximate arrival time when such a signal exists.

The anonymously reachable NMSC viewer normally publishes the Korea-area GK2A
SWRAD product
every ten minutes at approximately 2 km resolution. The collector discovers
the newest viewer frame, resolves its NetCDF download, and extracts both
surface downward shortwave radiation (`DSR`) and absorbed shortwave radiation
(`ASR`) from that one grid. DSR and ASR remain separate stored values in W/m².
The clear-sky denominator is a model, not another GK2A measurement, so the UI
calls the ratio **estimated solar transmission**. Transmission is omitted when
modeled clear-sky DSR is below 50 W/m², including night and very low sun, rather
than rendering a misleading zero percent.

`Current` and next-hour/upstream guidance are shown only for a fresh sample
while modeled Haurwitz clear-sky DSR is at least 50 W/m². Once it falls below
that solar threshold, or when a sample is stale, the panel labels the value as
the latest retained transmission, shows its age, and suppresses future
guidance. There is no longer a fixed 16:00 cutoff.

The collector projects 20-, 40-, and 60-minute upstream sample points from the
latest representative 15L AMOS wind direction and speed. These are spatial
GK2A DSR samples extracted from the same NetCDF grid as RKSI, but the distance
and arrival time use surface wind as a proxy. They are not satellite-derived
cloud-motion vectors. Missing, stale, or calm wind leaves the upstream reading
unavailable.

An expandable loop beneath the metrics requests the previous 90 minutes of
KMA's public `RGB cloud-enhanced` Korea-area GK2A imagery. The source produces
two-minute frames; the dashboard displays every other frame for a four-minute
visual cadence and loads them only when expanded. The server route
`/api/seoul/gk2a-loop` validates frame timestamps, obtains the KMA-owned image,
and proxies it without exposing arbitrary upstream URLs. The UI applies a
fixed RKSI crop, airport marker, surface-wind arrow, and upwind corridor. The
loop remains lazy and contextual; the browser requests it only after expansion,
and the numerical panel continues to use the NMSC SWRAD NetCDF.

The viewer requests do not require `KMA_API_HUB_AUTH_KEY`, but keyless
reachability is not treated as usage approval. The downloaded NetCDF declares
that access is restricted to approved users, and KMA's copyright policy
requires prior consultation for material without an applicable KOGL mark.
Collection therefore remains disabled unless Convex has
`NMSC_GK2A_ACCESS_APPROVED=true` after NMSC confirms this use, including the
ten-minute solar-window cadence, persisted derived decision snapshots,
threshold evaluation, and display scope. There is no API
Hub, cloud-category, or image-derived numerical fallback. Once enabled, a
failed viewer discovery, NetCDF download, or grid extraction is shown as source
failure while any still-retained observation remains visible with its age. The
downloaded NetCDF exists only in a temporary directory during extraction and
is deleted in a `finally` path; the application stores extracted samples, not
the raw file. Dashboard queries and a database-only cleanup limit raw numerical
observations to 48 hours. The compact derived GK2A inputs used by a material v2
decision revision remain in that immutable prediction so the decision is
auditable later. Approval revocation redacts copied `solar*` fields,
GK2A-derived blocker/reason text, clearing-risk fields, raw dashboard values,
and threshold evaluation/accuracy output. Confirmed or candidate decisions are
downgraded only if their local `solarDecisionRequired` snapshot was true, so a
low-solar decision remains usable without NMSC data. Historical routes never
trigger a satellite backfill.

## Secondary Weather.com hourly revision diagnostics

This entire section is secondary. Weather.com's daily maximum and hourly
forecast remain separate products with separate status and error fields, but
neither is a KMA fallback or an input to the canonical maximum, primary curve,
peak time, condition, or ceiling. The hourly product stores its own
response-completion timestamp instead of borrowing the timestamp from before
the request began. That provider-specific time is the forecast vintage used
for secondary revision and no-lookahead comparisons. Every saved hourly value
retains both its forecast-valid time and capture time, so a later response
appends history rather than overwriting the preceding prediction.

For a selected Seoul-local date, the morning baseline is the first successful
Weather.com hourly capture from `05:00–07:00 KST`. If none exists, the latest
successful capture from `03:00–05:00 KST` is an explicit fallback. A capture
outside that four-hour window is not labeled as the morning baseline. The UI
shows the selected capture time and identifies the pre-05:00 fallback. A
baseline value is usable only when its capture is strictly earlier than the
forecast-valid hour.

The latest curve uses the newest successful stored value for each
forecast-valid hour. Its revision is the difference from that hour's preceding
distinct stored temperature, so repeated unchanged captures do not create a
change. The scheduled Weather.com collector runs at minutes `:02`, `:17`,
`:32`, and `:47`; the UI therefore labels a revision time as **first detected**
rather than claiming that Weather.com published the change at that exact time.

Observed-departure scoring prevents lookahead:

- only forecast-valid hours that have already arrived can be matched;
- the comparison forecast is the latest successful capture whose completion
  time is strictly before the forecast-valid hour;
- an `08:02` capture can therefore never score the `08:00` observation;
- the representative `rwyNo=2`, `rwyDir=15L` AMOS reading must be within
  ±5 minutes of the forecast-valid time, otherwise the hour remains unmatched;
- departure is `actual AMOS temperature - Weather.com forecast temperature`.

The running signal is the median of the latest three matched hourly departures
and requires at least two matches. A median of `+0.5 °C` or warmer is
`running_warm`, `-0.5 °C` or cooler is `running_cool`, and values between those
thresholds are `on_track`. The summary states when fewer than two matches make
the result tentative and distinguishes the latest-three sample from the total
matched-hour count.

The chart displays `Secondary Weather.com · latest stored` as a thin blue
dashed curve and the selected secondary morning baseline as a faint blue
dotted curve. A signed badge marks every forecast-valid hour whose latest
distinct change is at least `1.0 °C`; a `31 °C` to `28 °C` change therefore
remains visible as `↓ -3.0 °C` after later captures repeat `28 °C`. Smaller
changes remain available in the tooltip and semantic table. The compact
secondary summary reports actuals versus the morning baseline, actuals versus
latest strictly pre-hour guidance, matched-hour counts, and the latest stored
Weather.com forecast peak.

For today, `Live vs latest pre-observation curve` chooses the newest successful
Weather.com capture that completed strictly before the freshest usable AMOS
reading and contains hourly values bracketing that observation. It does not
substitute a lone future point or interpolate across a gap longer than
90 minutes. Near the end of the day, the following day's `00:00` value can be
used only as the upper interpolation bracket; it is not added to the selected
day's curve, peak, baseline, or revision history. The live comparison is
separate from the strictly pre-hour forecasts used for scored hourly
departures.

Today and future pages retain the last successful history when the newest
hourly attempt fails or no attempt has completed for more than 90 minutes, but
mark it stale and expose the latest attempt error/time. Historical pages do not
become stale merely because the current collector is old. Missing baseline,
forecast, or AMOS data stays unavailable rather than being fabricated.

Weather.com hourly history does not change KMA inputs, the expected maximum,
the primary curve/peak/condition/ceiling, or primary cloud guidance. One narrow
exception is deliberate: when a Weather.com capture no older than 90 minutes
still has a future hourly temperature at or above the selected target, v2 records
`secondary_forecast_reaches_target` and withholds the strongest threshold
state. The source remains a zero-weight disagreement veto, not a blended
forecast.

## Forecast-capture data dependency

The page subscribes to
`seoulWeather:getHighPredictionDashboard({ stationIcao: "RKSI", date, targetC })`.
The server normalizes `targetC` before indexed reads, and the route never
renders a stored prediction or mutable state whose target differs from the
currently selected value while a target switch is loading. The route consumes:

- `kmaAccess` for approval, flag, and source-URL state
- `nmscDecisionAccess` for the independent solar-decision/evaluation approval
  state; evaluation and accuracy are `null` while it is inactive
- `kmaForecast.latestCapture`, `selectedDateForecast`, `hourlyRows`,
  `latestSuccessAgeMinutes`, `latestAttemptStatus`,
  `latestAttemptError`, and `sourceUrl` for the latest successful stored
  capture, official daily high, temperature curve, peak timing, exact
  condition phrase, ceiling, source vintage, and health; this stored capture
  can be present while `kmaForecast.isStale` is true
- `kmaHourlyDiagnostics`, a KMA-only diagnostic/safety alias over the same
  hourly guidance
- `latestPrediction` for the last material v2 immutable snapshot: ceiling
  components, robust slopes, copied GK2A/16L/wind/rain/Weather.com evidence,
  target margin, and blockers
- `decisionState` for the mutable current state, most recent rule ceiling,
  candidate time, and consecutive-pass count even when no immutable revision
  was necessary; the read boundary uses its internal solar-required flag before
  removing that flag from the public object
- `weathercomHourlyDiagnostics` for immutable latest/baseline curves,
  per-hour revisions, matched AMOS departures, the secondary strictly pre-hour
  cloud-cover comparison for completed hours, running states, stale health,
  and the live pre-observation comparison

Today's two auxiliary plain-language checks do not duplicate that heavy
dashboard query. One bounded
`seoulWeather:getHighPredictionDecisionSummaries({ stationIcao, date, targetCs })`
subscription reads only the exact mutable state and latest revision for up to
three normalized targets. The page uses it for the current KMA high and the
observed-high-plus-`0.1°C` lock target, deduplicating either value when it is
already the selected target. Archived routes skip this auxiliary query because
their cards use stored observations rather than live decision state.

`latestKmaForecastCapture` and the compatibility alias
`latestForecastCapture` both refer to KMA. Weather.com's latest capture is
separately named `secondaryWeathercomForecastCapture`; consumers must not
reinterpret the compatibility alias as Weather.com.

The compatibility action `seoulWeather:getDayPageWeather` delegates to that
dashboard and returns stored KMA data; it no longer makes a Weather.com request.
`seoulWeather:getHighPredictionAccuracy({ stationIcao, trailingDays, targetC })`
uses the same normalized target and returns only that threshold's finalized
rows and safety metrics. It never aggregates declarations from another target.

All of those inputs are optional. Observed temperatures and observed cloud
cover still render when KMA is unavailable, and missing future guidance remains
explicit. Revoking approval also causes the dashboard/query boundary to hide
previously stored protected KMA rows. The route renders the expected maximum,
KMA published high/hourly peak, and a compact current v2 decision. It does not
render a tracker, provider-card grid, evaluation panel, or high-prediction
revision history. Persisted decision evidence comes from `latestPrediction`,
while state/confirmation comes from `decisionState`, so a no-op immutable write
cannot make the confirmation count stale. Weather.com fields remain separately
labeled secondary diagnostics, apart from the conservative veto described
above.

## KMA/AMO forecast approval and disabled state

The official forecast is parsed server-side from:

```text
https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI
```

The page is reachable without a credential, but KMA's policy requires prior
consultation for material without an applicable public-use mark. Automated
production retrieval, parsing, storage, and display therefore remain disabled
unless the server-side Convex value is exactly:

```text
KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED=true
```

Approval must come from KMA, AMO, or the relevant KMA data/content owner and
cover that exact RKSI airport-forecast use. It is not implied by a successful
request, public HTML, or an unrelated KMA/NMSC approval.

KMA's [copyright-policy page](https://www.kma.go.kr/kmadev/guide/copyright.jsp)
lists the **Information and Communications Technology Division,
02-2181-0432** as its copyright contact. Recheck the official page for the
current office and number immediately before requesting approval because
contact details can change.

The gate is checked before either the public manual or internal scheduled queue
can write queue state, again when the internal worker begins, immediately
before the request, after the response, immediately before storage, and inside
the storage mutation. The dashboard/query boundary checks it too and hides
stored protected KMA rows after revocation. With the flag absent, the manual
queue returns `approval_required` without scheduling work or contacting AMO.
A worker already queued when approval is revoked records only a metadata-only
`approval_required` attempt and stores no forecast rows. The page shows a
visible `Official KMA forecast unavailable` banner, names
`KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED`, keeps actual AMOS and METAR
observations available, and marks the KMA maximum, curve, peak, condition, and
ceiling unavailable. It does not promote Weather.com to primary or use it as a
fallback.

The browser can call only
`seoulKmaForecast:requestAirportForecastRefresh`, a public queue mutation that
checks approval and atomically enforces the shared cooldown and in-flight lock.
It cannot call the internal fetch worker. Manual and scheduled requests share
a ten-minute minimum interval and a 15-minute stale-lock timeout, so repeated
clicks, concurrent tabs, direct Convex calls, and a neighboring cron cannot
create unbounded AMO traffic. Immediately before protected work, the worker
atomically claims the still-current run ID; a delayed worker superseded after
the stale timeout exits without an AMO request or capture. The Node fetch uses
only the fixed HTTPS AMO host/path, does not follow redirects, and requires a
successful HTML content type before parsing.

As verified on 2026-07-29, AMO's TLS server sends its `*.kma.go.kr` leaf but
omits the `RapidSSL TLS RSA CA G1` intermediate. The Node-only worker appends
the exact DigiCert-published intermediate (SHA-256
`44:22:E9:63:EE:53:CD:58:CC:9F:85:CD:40:BF:5F:FE:C0:09:5F:DF:1A:15:45:35:66:1C:1C:06:BC:AD:C6:9B`)
to Node's normal root store after validating its identity and signature
against the trusted `DigiCert Global Root G2`. TLS and hostname verification
remain enabled, the worker never trusts a partial chain or fetches an AIA
certificate at runtime, and native HTTPS never follows a redirect. The
intermediate expires on 2027-11-02 and must be replaced or removed based on
KMA's live chain before then.

The public queue is unauthenticated, so a caller can intentionally occupy its
single global slot every ten minutes: at most 144 KMA requests per day.
Scheduled attempts that land inside that cooldown are skipped. KMA/AMO
approval must explicitly cover public manual initiation and this maximum
cadence in addition to the normal twice-hourly schedule.
On 2026-07-29, the project owner confirmed that KMA/AMO granted that production
scope: public on-demand RKSI collection at the documented global ten-minute
limit plus scheduled collection. The repository records only the authority,
scope, and confirmation date, not private approval correspondence.

The forecast status badge is one of `Current KMA forecast`,
`Stored KMA forecast`, `Stored KMA forecast · stale`,
`KMA approval required`, `KMA setup required`, or
`KMA forecast unavailable`. Primary metric labels are `Expected max`,
`KMA published high`, and `KMA hourly peak`. The future sky-strip legend says
`KMA condition + ceiling`, its source is `KMA forecast`, and the table column
is `Condition / ceiling`. The Weather.com diagnostic opens with
`Secondary comparison only · not used for the expected maximum, KMA curve,
peak timing, or cloud guidance`; its cloud-score column is
`Secondary Weather.com − observed`.

For today and future forecast dates, the maximum-outlook header also shows
`Collect KMA now`. The button becomes `Collecting KMA…` while its internal
worker owns the lock and `Retry in Xm` during the server-enforced cooldown.
Approval/setup states disable it with the matching label. Its live status text
reports queued, successful row counts, error, revocation, or timeout without
discarding an older successful capture. Historical routes omit the button
because collecting the current KMA page cannot backfill an archived date.

KMA guidance becomes stale after `360` minutes. The page may retain and
visibly label stale stored KMA values, while the backend KMA-primary prediction
requires a capture no more than six hours old. Weather.com does not replace it.

The protected entry points are:

- collection: `seoulKmaForecast:requestAirportForecastRefresh`,
  `seoulKmaForecast:queueScheduledAirportForecastRefresh`,
  `seoulKmaForecast:claimQueuedAirportForecast`,
  `seoulKmaForecastNode:collectQueuedAirportForecast`,
  `seoulKmaForecast:writeCollectorStatus`, and
  `seoulKmaForecast:storeForecastCapture`
- prediction/finalization:
  `seoulWeather:recomputeTodayHighPrediction`,
  `seoulWeather:registerActiveHighPredictionTargetsInternal`,
  `seoulWeather:recomputeHighPredictionInternal`,
  `seoulWeather:finalizeCompletedDay`, and
  `seoulWeather:finalizeHighPredictionInternal`
- reads: `seoulWeather:getHighPredictionDashboard`,
  `seoulWeather:getHighPredictionDecisionSummaries`,
  `seoulWeather:getDayPageWeather`, and
  `seoulWeather:getHighPredictionAccuracy`

Activation and removal are separate production operations:

```text
npx convex env set KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED true --prod
npx convex env remove KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED --prod
```

## Client behavior

The page subscribes to `seoul:getDayStationRows`, so chart data updates
reactively after the collectors write to Convex.

Route validation checks actual calendar dates, including month lengths and leap
years, rather than accepting every string shaped like `YYYY-MM-DD`.

For the current Seoul date, the first page load and `Sync now` request:

- `seoul:pollLatestNoaaStationMetar`
- `seoul:pollLatestAmosTemperatureSites`

The page no longer calls `seoulWeather:recomputeTodayHighPrediction` from the
observation-refresh path. The status message reports partial
observation-source failures.
For today's date, opening the page or changing any relevant target calls that
action once with a bounded, deduplicated batch containing the selected target,
the current KMA high, and observed-high-plus-`0.1°C`. One atomic mutation
refreshes existing members, protects every requested member from LRU eviction,
retires only a non-requested oldest target when space is needed, and registers
the missing station/date/model/target tuples in `seoulPeakActiveTargets`. The
action then evaluates the batch with one shared solar snapshot. The page does
not create a per-tab five-minute recomputation loop. The server cron evaluates
the legacy-compatible `27.0°C` target plus up to eight registered custom or
semantic targets every five minutes, so confirmation does not depend on
leaving a browser open.
Registering `27.0°C` does not consume a custom slot. Selecting a ninth distinct
target—including an automatic semantic target—retires the
least-recently-selected registry entry from recurring checks while retaining
its prediction and decision history.
Switching targets never reuses the other target's candidate time or pass count;
switching back after missed slots restarts the 15-minute confirmation.
The manual AMOS request is a single immediate fetch, while the scheduled
rollover watch remains the lowest-latency path. Initial load and `Sync now`
remain observation-only and do not invoke the KMA forecast collector. The
separate `Collect KMA now` button calls the bounded public queue mutation; its
internal worker and collector-state updates flow back through the reactive
dashboard query. The current-day solar panel
provides a separate `Refresh GK2A` button that calls
`seoulGk2aCollector:requestSolarHeatingRefresh` during the server-reported
useful-solar window
and shows its own queued/in-flight/final state. The server permits one attempt
per ten-minute UTC slot, deduplicates already-resolved frames, and serializes work
with a run-owned lock. The button is the only client-triggered GK2A collection
path; the initial load and combined `Sync now` do not download the SWRAD
NetCDF. It is disabled when the server-reported Haurwitz clear-sky DSR is below
50 W/m² and until NMSC access is approved; the browser does not duplicate a
fixed clock window. A GK2A failure therefore does not make the METAR or AMOS
refresh look failed, and there is no alternate numerical solar source.
Forecast collectors continue on their independent schedules. An approved KMA
capture updates the primary high, curve, timing, condition, ceiling, and v2
decision reactively; Weather.com updates its secondary diagnostic history and
may only add the independent-forecast veto.

Historical routes only display already-captured rows. There is no historical
backfill from these latest-value endpoints, and the historical page does not
trigger recomputation.

## Backend forecast and prediction collectors

- After NMSC access is approved, the GK2A solar collector runs at
  minutes `:06`, `:16`, `:26`, `:36`, `:46`, and `:56` every hour. The
  server-side Haurwitz gate queues external work only while RKSI modeled
  clear-sky DSR is at least 50 W/m²; the sixteen-minute offset accommodates the
  measured publication delay for each ten-minute product frame. Each run
  discovers the newest NMSC viewer frame, downloads one SWRAD NetCDF, samples
  RKSI and the available wind-projected upstream points from that grid, and
  idempotently skips a frame already resolved. During the first 30 minutes of
  a UTC day, discovery merges the prior UTC date so a publishable 23:50 frame
  is not missed. `Refresh GK2A` uses the same gate. A separate database-only
  cleanup runs every 30 minutes; it does not contact NMSC.
- `seoul_kma_amo_airport_forecast_every_30_min` runs at minutes `:05` and
  `:35` and invokes the internal
  `seoulKmaForecast:queueScheduledAirportForecastRefresh`. The public
  `seoulKmaForecast:requestAirportForecastRefresh` mutation used by the button
  enters the same queue. Both paths share the ten-minute interval and
  run-owned lock, then schedule only
  `seoulKmaForecastNode:collectQueuedAirportForecast`. The worker parses the
  server-rendered RKSI page and stores immutable attempts through
  `seoulKmaForecast:storeForecastCapture`. The parser requires the page itself
  to display `RKSI` before an attempt can succeed. Successful KMA guidance is
  usable for at most six hours and must include both a daily maximum and
  hourly temperature for the selected date. Its daily high, primary hourly
  curve, conditions, ceilings, peak, and source time all come from one capture;
  hours are not merged across KMA revisions.
  The six-hour limit is the general stored-display limit; the v2 threshold
  decision independently blocks confirmation once the capture is older than
  90 minutes.
- `seoul_weathercom_forecast_every_15_min` runs at minutes `:02`, `:17`,
  `:32`, and `:47` and stores Weather.com RKSI airport daily and hourly results
  and errors together. Both requests use the explicit `icaoCode=RKSI`
  selector. Daily and hourly status/error fields remain independent. The
  hourly response has its own completion timestamp, and each successful hourly
  value is also appended to query-friendly immutable history. A usable latest
  capture can remain visible in the secondary diagnostic for at most twelve
  hours; it is not a KMA fallback.
- `seoul_15l_high_prediction_every_5_min` recomputes the Seoul-local current
  date for the always-scheduled `27.0°C` compatibility target plus up to eight
  rows in `seoulPeakActiveTargets`, using model version
  `rksi15l-remaining-ceiling-v2`. KMA has weight `1` for the expected maximum
  and primary curve; Weather.com has weight `0` and can only veto
  `unlikely_to_reach`. The decision requires AMOS no older than 3 minutes, KMA
  no older than 90 minutes, and, while useful solar remains, a quality-usable
  GK2A sample no older than 30 minutes. Each target updates its own
  `seoulPeakDecisionState`; material changes to that target's expected maximum,
  decision state, ceiling/margin, blockers, or solar-required policy flag
  create revisions in that target's immutable lineage. There is no
  heartbeat-only revision. Candidate entry starts a 15-minute clock at zero;
  three following consecutive five-minute slots are required for confirmation.
- `seoul_15l_high_finalize_after_midnight` runs at `00:10 KST` and freezes the
  previous day's canonical truth and independently finalizes every target with
  a stored mutable decision state for that date, falling back to `27.0°C` only
  when no state exists. Closing tracker results, fixed-cutoff scores, and
  threshold declaration/revocation/false-declaration outcomes remain
  target-scoped.

These scheduled jobs retain immutable KMA official captures, secondary
Weather.com history, and backend evaluations. The displayed outlook reads KMA
directly; Weather.com's stored curve remains diagnostic rather than a tracker
or model input. The observed maximum remains valid even when the newest AMOS
observation is stale, and both the backend evaluation value and the displayed
expected maximum are never allowed below that known maximum.

## Truthful cadence separation

`seoulAmosObservations.collectionCadence` records which collector produced a
row:

- `one_minute`
- `five_minute`

Cadence is part of the new
`by_station_date_ts_rwy_cadence` identity index. This intentionally permits a
one-minute and a five-minute capture for the same sensor timestamp to coexist.
The five-minute capture is a separate poll of the same upstream minute value,
not an average or independent temperature product, so it is not presented as a
separate chart series.

Rows stored before cadence tagging remain valid because the schema field is
optional. The displayed AMOS line starts with legacy/five-minute audit rows and
then replaces every matching timestamp with its one-minute capture:

- normal live coverage therefore shows only the one-minute observations
- a five-minute or legacy row appears only where no one-minute row exists
- fallback points are identified as audit fallbacks in the tooltip

New AMOS rows also retain immutable optional `firstSeenAt`. The source card
calculates receive latency only as `firstSeenAt - obsTimeUtc`; it never treats
mutable `updatedAt` as first receipt. Legacy rows without `firstSeenAt` say
`receive latency unavailable`, while their separate capture-second/audit label
can still use the existing stored metadata.

## Fast one-minute AMOS collector

Source:

```text
https://global.amo.go.kr/mobileApi/global_api/v1/amos_info.do?air_code=RKSI
```

The source publishes one new observation minute around second `:14–:16`; it
does not provide a push stream.

`seoul_amos_temperature_sites_every_minute` invokes the internal
`seoul:scheduleLatestAmosTemperatureSites` mutation. The mutation schedules
`seoul:captureLatestAmosTemperatureMinute` for second `:12` of the next minute.

The internal action:

1. receives the expected observation-minute timestamp;
2. sends sequential requests no more often than once per second;
3. uses a three-second timeout for each request;
4. accepts freshness when the representative 15L `obsTimeUtc` reaches the
   expected minute, even if temperature did not change;
5. stops immediately and performs one idempotent batch upsert for 15L and 16L;
6. stops after eight attempts if the source remains stale or unavailable.

A measured rollover became fresh on the third request at `:14.753`, about five
seconds earlier than the former fixed `:20` fetch.

The production cron subsequently stored the 11:50 KST one-minute row at
`:16.410`. This includes scheduler and Convex mutation latency, while still
beating the former fixed request time. The following 11:51 row arrived at
`:15.412`, confirming consecutive automatic captures.

## Five-minute AMOS collector

`seoul_amos_runways_every_5_min` invokes
`seoul:pollLatestAmosRunways`.

It stores all display rows with `collectionCadence="five_minute"`. The chart
does not plot these snapshots as a separate series. Its exact representative
`rwyNo=2`, `rwyDir=15L` row can fill a missing timestamp in the single AMOS
line, while the remaining runway-shaped records are retained for auditing.

Production verification stored separate `one_minute` and `five_minute` rows for
the same 11:50 KST sensor timestamp with the same temperature.

## Actual METAR collector

Source:

```text
https://tgftp.nws.noaa.gov/data/observations/metar/stations/RKSI.TXT
```

`seoul_noaa_metar_every_minute` invokes
`seoul:pollLatestNoaaStationMetar`. The action:

- parses the current NOAA RKSI METAR temperature;
- upserts it into `seoulMetarObservations`;
- recomputes the local-day summary;
- continues recording NOAA first-seen timing in `seoulPublishRaceReports`.

This replaces the chart's dependency on the retired AMO latest-METAR endpoint.
METAR is still the official coded comparison, not the fastest current
temperature.

## Data model

### `seoulMetarObservations`

One row per `(stationIcao, date, obsTimeUtc)` with report type, parsed
temperature, raw METAR, source, and ingest metadata.

### `seoulDailySummaries`

One row per station/date with latest, minimum, and maximum METAR fields.

### `seoulAmosObservations`

One row per station/date/observation time/runway/direction/cadence. It preserves
temperature, dew point, QNH, wind, visibility, precipitation, runway metadata,
raw JSON, the collection cadence, and optional immutable first-seen time.

### `seoulAmosDailySummaries`

One representative-15L row per station/date with observation counts, latest
temperature, and the day's minimum and maximum temperature and occurrence
times.

### `seoulGk2aSolarObservations`

Airport rows are unique by station/date/airport sample key/observation time and
participate in a rolling 48-hour history. Wind-projected rows use a
per-collection sample key for the 20-, 40-, and 60-minute corridor positions
and have the same 48-hour limit. Rows preserve extracted DSR, optional ASR,
modeled clear-sky DSR, solar elevation, optional transmission, source grid
coordinates and quality metadata, wind and corridor metadata, the NMSC source
frame identity, and ingest timing. The raw NetCDF is not retained.

### `seoulGk2aCollectorStatus`

One row per station records `ok`, `partial`, `no_data`, `error`, or the
approval-required configuration state, together
with last attempt/success times, latest source observation, requested/stored
counts, upstream availability, the last resolved frame, run-owned collection
lock, and the wind used for the most recent collection. The approval gate is
separate from API-key configuration because the viewer requests themselves are
anonymous.

### `seoulKmaForecastCaptures`

Immutable attempts to retrieve the server-rendered KMA/AMO RKSI airport page.
Each capture records its trigger, canonical source URL, status (`ok`, `error`,
or `approval_required`), capture/creation times, and, when available,
HTTP/response metadata, the page/current-conditions reported time, parsed daily
minimum/maximum rows, parsed hourly KST rows, or a bounded error. Hourly rows
preserve temperature, KMA condition phrase/icon, ceiling, wind, visibility,
and crosswind when present. The 15-second request timeout is enforced with an
abort signal. The raw HTML is parsed in memory and is not stored.

The source identity is capture-level: daily and hourly array entries do not
have independent row-level source tags. Consumers must keep rows attached to
the parent capture's KMA provenance. The query boundary returns no protected
capture content while
`KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED` is not exactly `true`, including
after approval is revoked.

The table indexes `(stationIcao, capturedAt)` and
`(stationIcao, status, capturedAt)`. Daily rows identify `short_term` or
`midterm`; hourly timestamps store both UTC and Seoul-local representations.

### `seoulKmaForecastCollectorStatus`

One row per station serializes manual and scheduled KMA forecast requests. It
records the latest queue time, in-flight start, manual/scheduled mode, run ID,
completion/success times, final status/error, and successful daily/hourly row
counts. The `(stationIcao)` index lets the public queue mutation apply its
ten-minute cooldown and 15-minute stale-lock check atomically. Run-ID matching
prevents an older or superseded worker from performing protected work or
clearing a newer worker's lock.
This operational metadata is kept separate from immutable provider captures
and is hidden by the KMA dashboard boundary while approval is absent.

### `seoulForecastCaptures`

Immutable **secondary Weather.com** RKSI airport forecast captures. Daily rows
hold the calendar-day high; hourly rows hold temperature, time, phrase, and
cloud cover. Daily and hourly status/error fields are independent, so a partial
provider response remains diagnosable. The hourly product's optional
response-completion timestamp and Seoul-local capture-date fields keep new
history rows from being backdated to the start of the collector run. They are
optional so captures created before this history layer continue to validate.
Optional legacy fields remain for compatibility; current Seoul selectors use
these captures only for the labeled Weather.com comparison.

### `seoulHourlyForecastPredictions`

Immutable, query-friendly child rows for each secondary Weather.com hourly
value. Each row links to its parent `seoulForecastCaptures` document and stores
the station/provider, Seoul target date, forecast-valid timestamp, provider
completion timestamp, temperature, and available phrase/cloud metadata.
Captures are appended rather than updated in place, preserving every detected
value for a forecast-valid hour.

`by_station_provider_target_capturedAt` rebuilds a date's latest and
morning-baseline curves,
`by_station_provider_valid_capturedAt` orders the revision lineage and supports
strictly pre-hour selection, and `by_forecast_capture_id` traces children to one
raw parent capture. Revision deltas and AMOS departures are derived at query
time rather than stored as mutable truth.

The Weather.com hourly/10day response is filtered to the five dates retained by
the existing Seoul capture flow, so one successful request can add up to about
120 child rows. There is no backfill for provider captures made before this
table was introduced and no automatic retention or archive policy. The new
table and the new parent-capture timestamp fields are additive; older forecast
captures and prediction revisions remain valid without them.

### `seoulHighPredictions`

Immutable, model-versioned material revisions. V2 keeps `predictedHighC` as the
KMA-published/observed expected maximum and separately stores the normalized
raw-tenths target, current smoothed temperature, last near-high time, robust 15/30/60
slopes and coverage, live KMA bias, remaining best/upper curve values, nowcast
upper, rule ceiling, margin, complete tied KMA window, hourly-curve
completeness and daily/hourly consistency, upward-revision detection, decision state, blocker
codes/descriptions, and confirmation snapshot. It also copies the GK2A
source/QC/upwind values, 16L corroboration, AMOS wind/dew-point/precipitation
diagnostics, and fresh Weather.com veto used by that decision. The former
confidence-band fields are optional legacy fields and are not statistical v2
confidence intervals. `by_station_date_model_target_revision` prevents model
versions and target lineages from mixing; revision numbers and
`previousPredictionId` advance only within that exact target.

### `seoulPeakDecisionState`

One mutable row per station/date/model/target. It records candidate start,
consecutive passes (capped at three), the last distinct five-minute evaluation
slot, last ceiling/current smoothed temperature, the last evaluated KMA capture
and curve used for immediate upward-revision comparison, whether solar evidence
was required, current state, blockers, and
latest immutable prediction ID. It updates even when the immutable material
snapshot is unchanged, so retries in one slot cannot manufacture confirmation
and a missing slot resets the candidate. A row from another target is never a
valid predecessor, even if it was evaluated in the immediately prior slot.

### `seoulPeakActiveTargets`

One bounded registry row per station/date/model/target. A current-day selected,
current-KMA, or next-high target is registered when the page initializes it.
The five-minute cron processes the
legacy-compatible `27.0°C` target plus no more than eight registry targets for
a date/model; registering `27.0°C` does not consume a custom slot. A ninth
custom value replaces the least-recently-selected registry entry but does not
delete that target's stored history. The registry preserves
target-specific recurring evaluation without requiring an open browser and
without allowing unbounded unauthenticated cron work.

### `seoulHighEvaluations`

Finalized actual high, peak time, revision count, lifecycle opening/closing
tracker diagnostics, and honest 09:00/12:00/15:00 KST checkpoint temperature
and peak-window scores. V2 also stores the first `unlikely_to_reach`
declaration, its ceiling/future high/margin, whether and when that row's target
was later reached, the first correct declaration, and declaration, revocation, and false
declaration counts. A no-target outcome is counted only with continuous future
AMOS coverage through midnight with no gap greater than three minutes;
otherwise it is stored as censored and omitted
from the false-rate denominator. Current rows store one exact
`thresholdTargetC`; target-aware date and finalized-time indexes keep
finalization and accuracy from combining two thresholds. Older rows retain
optional model/target fields for migration compatibility.

### `seoulPublishRaceReports`

Historical AMO/NOAA first-seen timing. It remains available in Convex even
though the redesigned page no longer renders the diagnostic table.

## Operational notes

- The mobile AMOS URL is publicly reachable without authentication but is an
  undocumented application endpoint. It has no published rate-limit or
  stability contract.
- Access is server-side because the response does not advertise a cross-origin
  browser contract.
- The 15L label is the feed's representative row designation; it should not be
  described as proof that the physical thermometer is at the 15L threshold.
- The old `http://amoapi.kma.go.kr/amoApi/metar` service was retired on
  2026-07-20 and is not used by the live chart collector.
- KMA/AMO forecast collection is server-side HTML parsing of the exact RKSI
  page, not a JSON API and not a Seoul-city forecast. Keyless reachability does
  not establish authorization.
  `KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED=true` must not be set until KMA,
  AMO, or the relevant data/content owner approves automated production
  retrieval, parsing, storage, and display. Revocation hides stored protected
  rows and stops every protected entry point before another request or write.
- KMA condition phrases and ceilings remain categorical/separate. Missing KMA
  data stays missing; no percentage is fabricated and Weather.com remains only
  a labeled secondary diagnostic.
- GK2A numerical collection remains server-side. The viewer is anonymously
  reachable and requires no API key, but its NetCDF embeds a restricted-access
  license. `NMSC_GK2A_ACCESS_APPROVED=true` must not be set until NMSC confirms
  the intended automated use, including the ten-minute solar-threshold cadence
  and retained derived threshold-decision/evaluation/display scope. This change
  does not activate that environment value. Once enabled, Convex performs the
  bounded NetCDF download, HDF5 validation, quality filtering, coordinate
  conversion, and temporary-file cleanup; the browser receives only extracted
  dashboard values. The worker rechecks approval before download, after the
  Node action, and in the database upsert; the decision query and mutation have
  their own read/write checks. Removing the flag stops new work, redacts raw
  and copied solar values plus derived blocker text, and hides NMSC-backed
  evaluation/accuracy output at the read boundary.
- The NMSC viewer NetCDF is the sole numerical solar source. Failures remain
  explicit and do not fall back to API Hub, the optional imagery loop, or
  cloud-cover categories.
- KMA/NMSC documents the SWRAD DSR product as a daylight retrieval with
  limitations at high solar/viewing zenith angles. The UI preserves missing
  values and source health instead of substituting cloud-cover categories or
  zero radiation.
- Research and source comparisons are in [seoul.md](./seoul.md).
