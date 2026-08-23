# MMMX edge dashboard plan and implementation contract

Last updated: **2026-08-23**.

The dated [2026-08-21 production and source investigation](./mexico-edge-investigation-2026-08-21.md)
records the live timing evidence, market-microstructure corrections, sanctioned
source candidates, WebStorm tool audit, and reserved approval gates. Its
measurement rules supersede any interpretation of this plan that would present
a changed-only REST timestamp as an exact reaction time.

This document is the durable build plan for the independent **Mexico Airport
Edge** page at `/mexico/edge`. The existing `/mexico/today` redirect and
`/mexico/day/[date]` dashboard must keep their current behavior. New work goes
into the edge route and its purpose-built backend unless a migration is
explicitly planned here first.

## Product objective

The page helps an operator judge whether an actionable timing edge exists in
the Mexico City daily-high market by putting three timelines on one clock:

1. airport temperature evidence and official METAR/SPECI reports;
2. Polymarket order-book changes; and
3. our collector's own first-observed and fetch timing.

The page must preserve provider timestamps and application first-seen times at
millisecond resolution. It must never turn polling resolution, relay metadata,
or visual proximity into a stronger claim than the evidence supports.

## Non-negotiable truth labels

- Routine MMMX observations are hourly. The May 2019 SENEAM observer manual
  says routine observation work begins at minute `:40` and transmission is due
  by `:56`; the effective report time remains the minute when the final element
  was evaluated. Show the documented **`:40–:56` operational window** and its
  live countdown. A learned first-sighting center from retained reports remains
  secondary context, not an exact observation or public-release second.
- SPECI is event-triggered rather than scheduled. Show `No SPECI clock`, the
  latest special report, observable trigger proximity, and the criteria this
  app cannot observe. A TDZ05 rise of at least `2 °C` versus the latest report
  may be labeled a **temperature special criterion**: the 2019 observer manual
  places it in its special-report/SPECI workflow, while the binding 2022 AFAC
  circular lists it under local special reports rather than its separate SPECI
  list. Never promise that the threshold will produce a publicly distributed
  SPECI.
- A race result means **first observed by this collector**. Store request start,
  response completion, immutable first-seen time, source timestamp when one
  exists, polling interval, and health. Sources first seen in the same polling
  slot are tied/indeterminate. Do not claim originating publisher order from
  completion milliseconds.
- CAPMA TDZ images show whole-degree displayed temperature. Their rounding
  method, current physical sensor, and relationship to the METAR-selected
  sensor are unconfirmed — an initial 2026-08-23 round-to-nearest claim was
  retracted after review (see the
  [2026-08-23 investigation](./mexico-edge-investigation-2026-08-23.md)).
  Keep TDZ 05 and TDZ 23 separate. Since 2026-08-22
  the TDZ collector also retains the display's dew point, integer humidity,
  0.1 hPa station pressure, QNH, and two-minute dew point as optional
  validated columns (see the
  [2026-08-22 investigation](./mexico-edge-investigation-2026-08-22.md)).
  Offline v2.1 research tooling now carries all eight nearest/floor rule
  combinations and ±0.5 °C dew-bias ambiguity into a robust conditional-band
  envelope. It does **not** identify or validate an absolute sub-degree value,
  and the envelope is not a credible interval or accuracy. No dashboard
  element may present a sub-degree TDZ value until same-sensor validation and
  honest uncertainty calibration exist; a TDZ
  whole-degree tick is display evidence, not a METAR prediction — the
  displays exceeded the official daily maximum by 1–2 °C at the peak on all
  three retained days examined.
- A chart can identify the first market move compatible with a weather event.
  It cannot prove which source a trader used or establish causality.
- The Polymarket contract's live resolution source is authoritative for market
  settlement. At the time of this plan the recurring event names Weather
  Underground's MMMX daily observations; NOAA/AWC and CAPMA are signals, not
  substitutes for settlement truth.

Timing and special-report labels are based on the CAPMA-hosted
[May 2019 SENEAM observer manual](http://capma.mx/manuales/Manual_Met_Obs/2019METOBS.pdf),
the CAPMA-hosted
[September 2019 METAR transmission manual](http://capma.mx/manuales/Manual_Reporte_Metar.pdf),
and the binding
[CO AV-20.3/07 R4](https://www.dof.gob.mx/2022/SICT/co-av-20-3-07-r4.pdf).
The transmission manual's `10.x` and `192.168.x` web-form addresses are private
SENEAM-intranet submission interfaces, not public read APIs and not production
integration candidates for this application.

## Page layout

### 1. Command strip

Show Mexico City local time with seconds, UTC, collection health, the current
event title/link, stream state and age, and a compact link back to the existing
Mexico dashboard. Keep those operational controls tied to the live Mexico date.
The reaction explorer has its own day selector without changing this route or
turning current-status cards into historical cards.

### 2. Primary TDZ-to-report cycle chart

The first operational panel after the command strip is the six-hour
`TDZ05 -> :40–:56 routine window -> CAPMA report -> NOAA relay` chart. The
primary chart plots only TDZ 05 at the application first-seen time; TDZ 23 is
intentionally hidden from this chart but remains available in the separate
image deck. TDZ 05 is the operator-selected tactical display, not the official
report. The chart plots the official routine METAR temperature at the time the
CAPMA AFTN relay was first observed. The METAR observation time remains
available in the point detail; it is not confused with publication or collector
receipt time.

The full six-hour history sits in a horizontally scrollable viewport. The
`1x`, `2x`, and `4x` controls change the timeline width without discarding
history, and `Latest` returns the viewport to the newest data. Mouse, trackpad,
keyboard, and touch scrolling remain available. Changing zoom deliberately
returns the viewport to the latest edge so the current report phase is not
silently hidden.

For each historical routine report, the chart shades the documented `:40–:56`
observation/transmission window. TDZ points in the final tactical lead before
CAPMA first-seen remain bright. A point after CAPMA cannot alter that already
issued report, but it remains active in orange as evidence for the next report
and the special-condition watch. A post-report TDZ05 value at least `2 °C`
above the latest official METAR or SPECI is rose-highlighted. The comparison
uses the latest report, including an intervening SPECI, rather than always using
the latest routine METAR.

The current phase and countdown must distinguish:

- `waiting for :40`: countdown to the documented routine observation start;
- `routine window`: observation work is active and `:56` is the transmission
  deadline;
- `CAPMA report locked`: the official METAR text and temperature are already
  known, so later TDZ frames are not evidence for that report;
- `awaiting NOAA relay`: NOAA has not yet exposed the same report; and
- `post-report special watch`: TDZ05 continues against the latest METAR/SPECI
  baseline while the page waits for the next `:40` window.

NOAA receipt is never labeled a second official observation. Its ETA uses the
median lead from valid paired CAPMA/NOAA routine-report races, including sample
count and 60-second measurement resolution. If the model is unavailable or
overdue, the page says so instead of hardcoding an eight-minute delay. The
existing robust routine estimator supplies only a learned CAPMA first-sighting
center inside or near the operational process; it does not replace `:40` or
`:56` and is not an exact CAPMA due second.

### 3. Live temperature and image deck

Show latest official METAR temperature and maximum-so-far alongside separate
CAPMA TDZ 05 and TDZ 23 cards. Each image card includes current and two-minute
whole-degree display values, embedded screen time, fetch completion,
application first-seen time, image age, OCR confidence, source label, and the
latest approved retained image. Since 2026-08-22 each card also shows the
display's raw extended fields when the frame's OCR validated them: dew point
(whole degree, plus the 2-minute value), integer percent humidity, 0.1 hPa
station pressure, and 0.01 inHg QNH. These are the display's own quantized
values under the existing TDZ republication approval — not derived sub-degree
estimates, which remain prohibited on the dashboard until the planned
estimator exists and is validated. Frames stored before the v3 OCR engine
show an em dash for absent fields. A dedicated refresh button invokes the
existing server-gated CAPMA refresh; it does not bypass cooldown or approval.

Image URLs keep the dashboard `rawHash` as a cache-busting version, but that
hash is not an immutable archive address. The approved HTTP query always
selects the current TDZ singleton, including when the URL version raced a newer
frame; the response `ETag` identifies the bytes actually served. Replacement
removes the former singleton from public metadata immediately and schedules
the old unreferenced blob for idempotent cleanup after a 120-second grace so an
already-started HTTP action can complete its storage read. The grace does not
make old hashes discoverable, does not bypass the publication gate, and does
not apply to rejected incoming uploads, which are still cleaned immediately.
A delayed scheduled cleanup can extend unreachable orphan storage until it
runs; the system remains current-only rather than a raw image archive.

### 4. Observation clock and relay race

Show the documented next `:40` start and `:56` transmission deadline with a
second-ticking countdown. Retain the learned first-sighting center, sample size
and confidence as secondary evidence. Beside it, explain that SPECI has no due
clock and show TDZ05 versus the latest METAR/SPECI baseline. A `+2 °C` alert is
a special criterion, not a guaranteed public SPECI. The relay table compares
CAPMA AFTN, NOAA tgftp, AWC, and available resolution-source observations using
first-seen intervals and honest tie states.

### 5. Forecast maximum revisions

Keep TAF TX and SMN/CONAGUA municipal guidance separate. For each, show today's
forecast maximum, prior value, delta, forecast peak time, capture/issue time,
and the time the maximum last changed. Never relabel the municipal forecast as
an airport forecast.

### 6. Exact live market ladder

Discover buckets dynamically from the event instead of assuming eleven.
Preserve token and condition identifiers, resolution source/description,
tick size, neg-risk state, end time, and numeric prices as provider strings.
For every bucket show the platform display probability, best bid, best ask,
midpoint, last trade, spread, and provider/collector timestamps. The display
price follows the documented Polymarket rule: midpoint unless the spread is
greater than $0.10, then last trade. Phase one persists exact CLOB REST book and
last-trade snapshots once per minute. An optional direct browser WebSocket can
make the open page current between snapshots, but its events are explicitly
`browser live · session-only` until a server listener is runtime-validated.
Stale, disconnected and REST-only states must be visible; Gamma outcome price
remains a labeled fallback, not a live order book.

Market discovery and history selection are scoped to the selected Mexico City
calendar date. Rebuild the reaction explorer's bucket choices from that day's
discovered event, preserve the same bucket label across dates when it exists,
and select a valid fallback when it does not. A cold day that has no `29 C`
market must not display or synthesize one. A date with no discovered event or
retained quote history renders an honest empty state.

### 7. Reaction explorer

Plot selected market probability and temperature evidence on a synchronized
millisecond timeline. The explorer selects both a Mexico City calendar date and
one of the probability buckets actually discovered for that date. Its default
`Day` view shows the complete retained early-to-late probability progression,
extends the last step through the latest confirmed successful observation, and
uses a genuinely wider, horizontally scrollable time canvas. `1h`, `3h`, and
`6h` remain optional closer views. Start/earlier/later/latest controls supplement
native mouse, trackpad, keyboard, and touch horizontal scrolling.

Add event rails for CAPMA/NOAA/AWC first sightings, METAR/SPECI observation
time, and market book/trade changes. The synchronized chart and its legend plot
METAR/SPECI and CAPMA TDZ 05 only. CAPMA TDZ 23 is intentionally absent from
this chart's lines, points, source markers, legend, and accessible description;
it remains available in the separate image deck and may still contribute a
separately coverage-qualified reaction audit row. Never connect points from
different sources into one interpolated line.

For each weather event compute the prior confirmed market state, first
compatible state change, a detection interval and uncertainty, and probability
delta. The default visual series is the recorded **platform display**
probability, with display-rule source switches marked. The selectable
REST-detected last-trade price remains a price-state metric, not an execution-
time or trade-count claim: the endpoint supplies neither an execution timestamp
nor trade size, and another trade at the same price is invisible. Keep
last-trade price, executable bid/ask, midpoint and platform display as separate
selectable series. A REST receive timestamp is the closed upper edge of a
detection interval, not an exact trade or reaction time.

`getDashboard` returns a dedicated compact reaction rail from the already-read,
approved whole-degree TDZ 05 rows: at most five minutes between anchors, plus
both sides of every displayed-temperature transition and the day's first/last
retained point. This preserves the selected day's early TDZ 05 context without
using the retired sub-degree estimator or exposing TDZ 23 in this chart. The
rail is retained evidence, not an inferred continuous temperature or settlement
measurement.

Build reaction rows only from a source-specific first strictly higher daily
maximum. Keep official METAR/SPECI, TDZ 05 and TDZ 23 series separate; do not
merge equal repeats or the two TDZ displays. For an immutable first-seen weather
event `E` and consecutive successful market receipts `(L, U]`, classify:

- `E <= L`: compatible with detection after the source, with lag `(L-E,U-E]`;
- `L < E <= U`: ordering indeterminate because the interval contains the
  source event; and
- `E > U`: market change detected before that source arrival.

The lower edge is open. In particular, `E = L` is compatible-after while
`E = U` is indeterminate. With no successful predecessor the result is
left-censored, never a point estimate. Show the last retained transition before
the source separately so a pre-source move is not hidden by the first later
candidate.

The legacy composite `temperatureTimeline` is capped at 900 rows, preserves
every bounded official row, and trims only the dense recent TDZ rails; it must
never be used by itself to infer a TDZ daily maximum. The reaction chart uses
the separate compact TDZ 05 rail described above. `getDashboard` separately
scans at most 6,000 retained TDZ rows for the selected Mexico date and returns
compact `tdzDailyMaximumEvidence`. TDZ 05 and TDZ 23 are coverage-qualified independently only
when the day-page query is not truncated and that series begins, ends and has
no internal gap greater than five minutes. A complete live-day series means
complete **to the query time**, so the browser's one-second clock invalidates
it if its latest screen time ages beyond the same tolerance without another
reactive write. Only fresh complete-series events enter the reaction table;
partial, stale, truncated or unapproved rails are excluded with an honest
coverage notice. TDZ 05 can remain visible as non-maximum chart evidence, while
TDZ 23 remains outside this chart. At the nominal two TDZ rows per minute, a day is about 2,880
rows; the 6,000-row bound accommodates additional manual captures while keeping
the reactive query finite.

Official maximum derivation has a separate truncation guard. The dashboard
reads at most 160 selected-day METAR/SPECI rows and 300 relay sightings, asks
each indexed query for one extra row, and reports
`officialDailyMaximumEvidence`. If either page has an extra row, official
derived maximum reactions fail closed and remain chart-only; the UI does not
silently treat the newest bounded suffix as a complete daily baseline.

## Backend workstreams

### Market metadata, stream and history

- Extend Gamma discovery to retain event description, resolution source,
  dynamic market/token metadata, end time and tick-size-related fields.
- Poll exact public CLOB `/books` and `/last-trades-prices` payloads for the
  day's YES tokens once per minute and preserve decimal strings plus receive
  timestamps. The collector reports `rest_polling`; the server WebSocket state
  must remain explicitly `unavailable` rather than implying a connection.
- A future bounded server market-channel listener may replace the interval
  between REST snapshots only after the Convex runtime, reconnect, heartbeat,
  ordering and loss semantics are validated. A browser-session listener is a
  non-authoritative low-latency overlay and cannot create durable history. Its
  patches are pinned to the REST snapshot version they extend, rather than
  comparing the browser clock to the Convex server clock.
- Store a current quote per token and append a quote event only when a quoted
  or display rule changes. When the separate data approvals are open, also
  append one compact immutable `mexicoEdgeMarketQuoteHeartbeats` row for every
  accepted market/token in every successful poll, even when no value changes.
  The heartbeat retains exact reaction fields, event/market/token identity,
  generation, fingerprint, and separate Gamma, book and last-trade request or
  receive clocks. It deliberately omits depth sizes, book hashes and market
  text. A missing expected book or last-trade token invalidates the whole poll;
  it is not a successful heartbeat. The only no-trades sentinel is the
  documented `0.5` with an empty side, and a reported-trade to no-trades
  regression is rejected.
- Reconcile the current ladder against each newly discovered event, retain
  detailed events and heartbeats for 14 days, and query selected-bucket history
  through a station/date/market index. Switching dates reconciles the market ID
  against that date's event; full-day means all retained successful observations
  for that selected day, not data before retention or outside a bounded query.
  A query returns at most 2,000 ascending
  rows plus one predecessor when truncated, and returns explicit coverage,
  retention and truncation metadata. The UI excludes weather events outside
  complete retained coverage rather than implying a full-day interval. Failed
  attempts are not successful observations and are not yet durable heartbeat
  rows; the public metadata says so explicitly. Create minute rollups before
  pruning if longer history is needed.
- Preserve the existing Gamma collector and charts for the old page.

### Weather timing and revisions

- Build an edge query that composes existing METAR, relay-race, TAF, SMN,
  CAPMA observation/image, and collector-health data without weakening any
  approval sanitization.
- Derive the fixed minute-of-hour `:40–:56` operational window from the SENEAM
  observer procedure. Separately estimate CAPMA first-sighting timing from
  recent observation and receipt history with a robust method, minimum sample
  count and confidence metadata. Never substitute that learned estimate for
  the documented start/deadline or invent an exact publication second.
- Derive immutable forecast-high revision snapshots from each TAF issue and
  SMN raw capture so previous maximum and changed-at remain auditable.
- Keep WU/Weather Company settlement-source acquisition behind dedicated
  exact-`true` access, retention and republication approval gates. Until an
  owner-supported interface and scope exist, expose `approval required` or
  `setup required`; do not scrape via embedded browser credentials.

### Optional high-frequency routine watch

The existing CAPMA/NOAA paired race remains one-minute resolution. A bounded
faster CAPMA AFTN watch may be deployed only behind
`SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED=true`, in addition to
the canonical base approval `SENEAM_MMMX_AFTN_ACCESS_APPROVED=true`. The
separate operational kill switch is
`MEXICO_EDGE_ROUTINE_WATCH_ENABLED=true`. The implemented cron is
server-bounded to the broad `:40` through `:57.999Z` envelope that contains the
learned routine window. The `:40` run has an absolute `:49:00Z` deadline and
the `:49` run has an absolute `:58:00Z` deadline, so a delayed first run cannot
overlap the second session. It never expands based on a client argument, clips
request timeouts and retry waits to the active deadline, and uses exponential
error backoff capped at 30 seconds. Healthy requests keep the five-second
target, but each call is capped at five seconds and the first failure opens at
least a 15-second quiet window before the 30-second capped backoff. This keeps
an unhealthy host from receiving a new fast-watch connection every five
seconds while the TDZ minute collectors are also due. Before every request it
also checks TDZ05/TDZ23 health and defers one target interval while either
image worker holds its 75-second in-flight lease; the returned audit counts
these image-priority deferrals. The watcher must recheck approval immediately
before every request and before storage, and fail closed if either flag
changes. Both new flags are absent by default.

The implemented target cadence is five seconds. It replaced the initial
one-second cadence after production showed intermittent AFTN and TDZ connection
failures following a bounded burst. This cuts the protected fast-watch request
count by 80% while retaining second-level detection intervals. Provider-side
throttling remains an inference, not a documented CAPMA service limit. The UI
shows this target cadence separately from the 60-second resolution of older
paired-race history.

Both the one-minute AFTN collector and the bounded watcher run in Convex's Node
action runtime. Production isolate egress began returning gateway TCP-connect
timeouts for the plain-HTTP AFTN host on 2026-08-23 while the existing Node TDZ
collector still reached the same owner host. The Node transport keeps every
approval check, exact URL, redirect refusal, cadence and storage boundary
unchanged; it is a transport reliability change, not a new source or approval
scope. The bounded watcher uses the five-second per-call limit above; the
one-minute AFTN collector uses the shared 55-second relay/direct cycle budget
below. Collector health displays failure-at time separately from the age of
the last successful sample.

Since later on 2026-08-23, every CAPMA request uses the shared
fresh-connection transport in `server/mexicoCapmaTransport.js`: one non-pooled
`node:http` connection per request, closed afterward, with no redirect
following (3xx is still refused explicitly). Retained fetch history showed
the JPEG transfers are bimodal (median 0.27 s, but a slow mode with p95
9.5 s, p99 27.5 s, and completed 84 s transfers before an application
timeout existed), so a flat 8-second timeout was itself destroying the slow
mode. The one-minute TDZ and AFTN collectors now share a 55-second wall-clock
budget across network paths. With relay settings present, Vercel egress is
tried first (43-second client cap; its route uses the same fresh-connection
transport with a 40-second owner-host cap), then one patient direct connection
receives whatever budget remains. Without relay configuration the direct plan
is capped at 50 seconds. The high-frequency watcher keeps one short direct
attempt per call because its session loop already retries with the longer
failure backoff. An HTTP error status is never retried, and the slow-mode root
cause remains undetermined.

A six-hour post-fix sample then showed the dominant remaining gap cause was
not transport at all: a claim cooldown equal to the one-minute cron spacing
raced scheduling jitter and skipped roughly alternate cycles as `cooldown`,
halving the stored TDZ cadence to ~2 minutes (a months-old pattern) and
invalidating many paired-race slots. Scheduled claim cooldowns for TDZ
05/23, CAPMA AFTN, and NOAA text are now 45 seconds — the cron still
launches once per minute, so the request rate is unchanged — while manual
TDZ refreshes and AWC keep 60 seconds. Collector status rows now retain a
capped `recentErrors` ring buffer for after-the-fact outage diagnosis.

Live production status and logs later exposed an additional overlap race: the
former direct-retry-plus-relay path could last 83.5 seconds, past both the
45-second cooldown and the next one-minute launch. A second worker could claim
the same source, after which the older completion could overwrite the newer
`fetching` row. TDZ and one-minute AFTN attempts now retain a 75-second lease
while `fetching` and carry their claim timestamp into every finish. A late
finish is ignored when a newer claim owns the row. Successful completion
releases the lease immediately, so the normal once-per-minute cadence is not
slowed.

Residual multi-minute outages are windows of `connect ETIMEDOUT` from
Convex egress while other networks reach the same URL instantly. For those,
the TDZ and AFTN collectors use the allowlisted Vercel relay first when it is
configured (`app/api/capma-relay/route.js`, shared-secret protected, same
approved URLs and cadence, no retention), then use the unused part of the same
cycle budget for direct fallback; frames served through the relay carry
`fetchTransport: "vercel_relay"`. The relay path activates when the
`CAPMA_RELAY_URL`/`CAPMA_RELAY_TOKEN` Convex values are configured (done
2026-08-23; `CAPMA_RELAY_BYPASS` is only needed if the relay URL is ever
behind Vercel protection); these are operational transport settings, not
approval gates.
Production verification on 2026-08-23 found that Vercel can remove the relay's
custom marker from a wire-level conditional `304`, causing a valid unchanged
frame to be classified as relay failure and followed by an unnecessary direct
request. The relay now wraps an owner `304` in an HTTP `200` response with both
`x-capma-relay-upstream: 1` and
`x-capma-relay-upstream-status: 304`. Convex maps that envelope back to `304`
only after validating the relay marker, so the TDZ worker records
`not_modified` without attempting the unreliable direct path. Deploy the
backward-compatible Convex decoder before the Vercel envelope change; until
both are live, the older failure behavior can continue, but no protected data
or approval boundary changes.
The TDZ scheduler queues TDZ 05 first and TDZ 23 thirty seconds later. The
stagger reduces ordinary same-host concurrency but cannot guarantee no overlap
during a slow transfer. Both remain behind the same existing exact-`true`
access and retention gates. Each TDZ is launched at most once per minute,
slightly faster than the observed ~60/62-second embedded-image steps. A healthy
transport should accept nearly every produced frame, but a source update is
not proof that our fetch, JPEG validation, or OCR succeeded. The 55-second
network budget and 75-second in-flight lease keep a bad cycle from piling up;
rejected or unreadable frames leave the last accepted image intact and never
invent a temperature.
Ambiguous clock/date glyphs are decoded as a complete timestamp constrained to
the existing 24-hour-past/15-minute-future fetch window, rather than accepting
each glyph's top template independently. The remaining image dimensions,
temperature, TDZ identity, confidence and plausibility checks still fail closed.
Temperature OCR supports both CAPMA display states observed in production:
black digits on light value boxes and yellow digits on dark value boxes. Each
candidate must independently pass the same fixed-layout, range and confidence
checks; the higher-confidence valid candidate wins. Small yellow glyphs may use
a `0.60` template floor only when the winning digit leads the next candidate by
at least `0.08`; the overall image storage threshold remains `0.60`.
All canonical and edge-specific names stay within Convex's 40-character
environment-variable name limit. The old oversized AFTN name remains an
exact-`true` migration alias only for deployments that already contain it; do
not create it in a new environment.

## Planned data model

- `mexicoEdgeMarketEvents`: dynamic event/market/token and resolution metadata.
- `mexicoEdgeMarketQuotes`: one current exact-string quote state per token.
- `mexicoEdgeMarketQuoteEvents`: changed quote states with provider and receive
  timestamps, event type, raw identifiers, and signal-aware detection bounds
  when approved evidence storage is active.
- `mexicoEdgeMarketQuoteHeartbeats`: compact immutable successful-poll evidence
  per market/token, including unchanged states and endpoint-specific clocks.
- `mexicoEdgeMarketStreamStatus`: REST attempt/freshness counters, generation
  and lease protection, plus explicit WebSocket-unavailable,
  operational-enable and error state.
- `mexicoEdgeForecastHighSnapshots`: immutable source-specific maximum
  revisions derived from TAF/SMN captures.
- `mexicoEdgeResolutionObservations`: separately gated settlement-source
  observations and first-seen timing when an approved interface exists.

Indexes must support station/date timelines, token/date timelines, current
token state, source revisions, expiry pruning and lease lookup. New public
queries must cap row counts and payload sizes.

## Approval and operational controls

Existing CAPMA access, retention and republication gates continue to apply to
every edge query, action, image URL and refresh path. The optional fast AFTN
watch has its own additional access gate and kill switch described above. The
approving authority is SENEAM/CAPMA for explicitly bounded sub-minute automated
requests to the existing MMMX AFTN report page.

The canonical CAPMA gates are:

- `SENEAM_MMMX_AFTN_ACCESS_APPROVED`
- `SENEAM_MMMX_TDZ_ACCESS_APPROVED`
- `SENEAM_MMMX_TDZ_RETENTION_APPROVED`
- `SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED`

They are centralized in `convex/mexicoCapmaApprovals.js`. Each accepts only the
exact string `true`. During rollout, each canonical gate also accepts its
previous oversized `SENEAM_CAPMA_MMMX_*` name as an exact-`true` migration
alias so existing Mexico pages do not switch off. Set and verify the canonical
values before removing legacy values. Do not create legacy names in new
environments. If a canonical key is present, only its exact value `true`
authorizes; any other value takes precedence over the alias and fails closed.
The legacy alias is consulted only when the canonical key is absent. During an
emergency migration-state revocation, set the canonical value to `false`,
remove the corresponding legacy alias, and then remove the canonical value so
deleting it cannot reactivate the fallback.

Canonical base activation after the corresponding owner scopes are confirmed:

```text
npx convex env set SENEAM_MMMX_AFTN_ACCESS_APPROVED true --prod
npx convex env set SENEAM_MMMX_TDZ_ACCESS_APPROVED true --prod
npx convex env set SENEAM_MMMX_TDZ_RETENTION_APPROVED true --prod
npx convex env set SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED true --prod
```

Canonical base removal after legacy cleanup:

```text
npx convex env remove SENEAM_MMMX_AFTN_ACCESS_APPROVED --prod
npx convex env remove SENEAM_MMMX_TDZ_ACCESS_APPROVED --prod
npx convex env remove SENEAM_MMMX_TDZ_RETENTION_APPROVED --prod
npx convex env remove SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED --prod
```

After the additional bounded high-frequency scope is confirmed:

```text
npx convex env set SENEAM_MMMX_AFTN_ACCESS_APPROVED true --prod
npx convex env set SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED true --prod
npx convex env set MEXICO_EDGE_ROUTINE_WATCH_ENABLED true --prod
```

Either removal stops new fast requests, including an in-flight session before
its next request or storage step:

```text
npx convex env remove SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED --prod
npx convex env remove MEXICO_EDGE_ROUTINE_WATCH_ENABLED --prod
```

Exact CLOB/Gamma collection for the new route has its own operational switch,
also absent by default. Polymarket's public market-data interfaces do not need
credentials, but an explicit switch keeps the new request load separately
deployable and immediately reversible:

```text
npx convex env set POLYMARKET_MMMX_LIVE_COLLECTION_ENABLED true --prod
npx convex env remove POLYMARKET_MMMX_LIVE_COLLECTION_ENABLED --prod
```

The operational switch is not evidence of provider approval. Retaining every
unchanged response and publishing the resulting derived detection history are
separate capabilities. The implemented heartbeat path therefore requires all
applicable exact-`true` Convex approvals and must be deployed with them absent:

- `POLYMARKET_MMMX_DATA_ACCESS_APPROVED`
- `POLYMARKET_MMMX_DATA_RETENTION_APPROVED`
- `POLYMARKET_MMMX_DATA_PUBLIC_APPROVED`

The approving authority is Polymarket/ICE for the project's precise entity
classification and the scope covering consumption, derived reaction analysis,
14-day Convex retention and public display. The current contact recorded by the
investigation is `data-licensing@polymarket.com`. A public endpoint, working
request, or operational collection flag is not approval.

The access and retention flags are checked again inside the storage mutation
before each heartbeat or new interval-metadata write. Public queries expose
heartbeat rows, predecessor evidence and interval metadata only when all three
flags are exact `true`. With any flag absent, current quotes and legacy
change-only collection continue, but `pollHeartbeats` is empty, interval fields
are sanitized, and the query reports the exact `*_approval_required` state.
Legacy changed events remain left-censored in the UI; they are never promoted
to no-change confirmations. The retention worker remains able to delete
already-stored expired evidence after revocation.

Only after written scope is confirmed:

```text
npx convex env set POLYMARKET_MMMX_DATA_ACCESS_APPROVED true --prod
npx convex env set POLYMARKET_MMMX_DATA_RETENTION_APPROVED true --prod
npx convex env set POLYMARKET_MMMX_DATA_PUBLIC_APPROVED true --prod
```

Removal of any applicable capability fails the protected path closed:

```text
npx convex env remove POLYMARKET_MMMX_DATA_PUBLIC_APPROVED --prod
npx convex env remove POLYMARKET_MMMX_DATA_RETENTION_APPROVED --prod
npx convex env remove POLYMARKET_MMMX_DATA_ACCESS_APPROVED --prod
```

Settlement-source integration reserves these exact-true Convex flags:

- `TWC_MMMX_RES_ACCESS_APPROVED`
- `TWC_MMMX_RES_RETENTION_APPROVED`
- `TWC_MMMX_RES_PUBLIC_APPROVED`

`TWC` means The Weather Company. These shortened names deliberately remain
within Convex's 40-character environment-variable name limit.

The approving authority is The Weather Company/Weather Underground and any
Polymarket-imposed data-use scope. Protected entry points include scheduled
and manual acquisition, retry/queue workers, storage mutations, public queries
and exports. Activation after written scope is confirmed:

```text
npx convex env set TWC_MMMX_RES_ACCESS_APPROVED true --prod
npx convex env set TWC_MMMX_RES_RETENTION_APPROVED true --prod
npx convex env set TWC_MMMX_RES_PUBLIC_APPROVED true --prod
```

Removal of any flag must fail closed for that capability:

```text
npx convex env remove TWC_MMMX_RES_ACCESS_APPROVED --prod
npx convex env remove TWC_MMMX_RES_RETENTION_APPROVED --prod
npx convex env remove TWC_MMMX_RES_PUBLIC_APPROVED --prod
```

Credentials, a reachable endpoint, a browser key, and approval are separate.
Fixtures may be used while approval or interface setup is absent.

## Delivery order and acceptance checks

1. Add schema and pure normalization/timing utilities with fixtures and tests.
2. Add dynamic Gamma metadata plus exact CLOB REST quotes and bounded event
   history; verify duplicate handling, ordering and decimal preservation.
   Validate reconnect/loss behavior separately before enabling a durable
   server WebSocket listener.
3. Add the composite edge query, documented routine-window clock, secondary
   learned release model, honest temperature-special/SPECI state, forecast
   revisions and disabled settlement-source status.
4. Build `/mexico/edge` and keep both prior Mexico routes byte-for-byte
   behavior-compatible.
5. Verify loading, empty, disabled, stale, disconnected and live states at
   desktop and mobile widths in the browser. Switch between dates with different
   bucket sets, confirm unavailable buckets are omitted, and confirm an empty
   date remains empty. For a retained bucket, verify the day view spans its
   earliest through latest confirmed probability, the chart scrolls horizontally
   at desktop and mobile widths without page-wide overflow, TDZ 05 remains
   visible, and TDZ 23 is absent from this chart.
6. Run focused Node tests and Convex generation/type checks. The repository's
   documented missing Linux SWC binary prevents treating `next build` as a
   required local acceptance check.

The first usable release is complete when the new route shows approved current
weather/image evidence, the documented `:40–:56` METAR process window, an
explicit no-SPECI-clock state with a non-promissory `+2 °C` local-special watch,
forecast revisions, exact labeled market quotes with staleness, and a
synchronized reaction timeline without modifying the old Mexico pages. Live
settlement-source data and faster CAPMA polling may remain correctly gated and
disabled until approval is granted.
