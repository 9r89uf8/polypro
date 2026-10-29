# RKSI local paper-forecast ledger readiness — October 29, 2026

The revised bounded probe preserves the exact source snapshots used for a
prediction, records when its prediction file finishes syncing, and retains
outcome responses before parsing or scoring. It remains a **single-target
local research tool**, not a complete multi-day performance ledger. This work
adds no production collector, schema, schedule, approval activation, market
request, or order. After offline hardening, one fixed live target at 13:00
KST was captured and independently replayed. Its prediction was sealed
84.392 seconds before the target: AMOS predicted the observed 12°C while
persistence predicted 11°C. See the
[forward study and retained evidence](./seoul-amos-metar-study-2026-10-29.md#third-forward-check-at-1300-kst-the-predictions-differ)
for the clocks and limitations; this does not establish a repeatable edge.

## Existing storage and its limits

The audit inspected [the Seoul schema](../convex/schema.js) and
[collectors and queries](../convex/seoul.js).

| Record | What it retains | Limitation for historical evaluation |
| --- | --- | --- |
| `seoulAmosObservations` | Current payload, runway/cadence labels, optional immutable `firstSeenAt`, and `updatedAt` | Earlier payload versions and original HTTP receipt clocks are not retained; legacy rows can lack first receipt. |
| `seoulMetarObservations` | Current raw report, temperature/type/source, `_creationTime`, `updatedAt`, optional legacy `amoFirstSeenAt` | Updates replace content. Initial insertion is not the current version's first receipt. NOAA ingest does not populate the optional AMO receipt field. |
| `seoulPublishRaceReports` | First source-specific raw reports and receipt clocks, optional TGFTP `Last-Modified` | One first version per source, not a correction archive. The canonical raw field can change. Join a receipt only to matching content. |
| `seoulDailySummaries` | Current aggregate maximum and latest report | Not a frozen record of the maximum known at an earlier decision. |

The probe uses read-only `seoul:getDayStationRows`, which returns the requested
date's reports and runway-2/15L AMOS rows, not an independent 16L series. The
separate race query is capped at 48 recent records before routine filtering;
it is neither a complete day nor a complete version history, and v2 does not
add that query. A preserved live snapshot establishes availability to this
observer at query receipt; it does not establish first upstream publication.
Database clocks are retained separately, with inconsistent clocks flagged.

## V1 preservation

The two completed v1 captures are unchanged. Their `frozenAtUtc` field is
**query receipt**, not prediction-file sync completion. A stronger seal clock
cannot be reconstructed retroactively. The v1 source was copied before edits:

```text
tmp/probe-seoul-next-metar-v1-20261029.mjs
SHA-256 b7a55148e8d8b4f8c23dcdac382a6629294d109d36dbce0af767d37c4c26007d
```

Its companion is `tmp/seoul-probe-v1-source-provenance-20261029.json`. This
retained source copy is not a newly measured execution timestamp for old runs.

## V2 artifact and clock semantics

The [CLI](../scripts/probe-seoul-next-metar.mjs) delegates to the
[recorder](../scripts/lib/seoul-paper-probe-runner.mjs); the
[pure evaluator](../scripts/lib/seoul-paper-forecast.mjs) performs no I/O.

1. Exclusively create a new convenience-summary path and evidence directory.
   Existing paths are never adopted or overwritten. Save immutable `run.json`
   with the target, rule, bounds, backend, and evaluator/recorder source hashes.
2. Query **both the preceding and target KST dates**. Preserve each full
   structured SDK response or failure, its request/receipt clocks, and file
   hash. A missing query differs from a successfully queried empty date.
3. Prepare after all receipts and snapshot writes. Keep the AMOS forecast,
   persistence baseline, maximum, rejection reasons and coverage separate.
4. Exclusively write `prediction.json`, call `FileHandle.sync()`, and close it.
   Then sample `predictionSealCompletedAt` and save `prediction-seal.json`.
   A late or missing seal cannot proceed to scoring.
5. Preserve each complete AWC body and request/header/body-completion clocks
   before parsing or selection. Save inspection results separately, followed
   by immutable `result.json`. The convenience summary may change and is
   explicitly labeled `mutable_convenience_summary`.

Midnight can use yesterday's fresh AMOS and prior report for prediction;
yesterday's maximum must not become today's maximum. An uninitialized maximum
is `null`. A forecast may remain available while a baseline comparison is
unavailable. The helper computes the maximum from captured eligible reports,
not the mutable daily summary.

## Bounds and explicit abstentions

- Convex responses are capped at **4 MiB before SDK JSON/error-text parsing**,
  with a 15-second timeout. AWC bodies are capped at **500,000 bytes**;
  oversized streams are cancelled and logged as failures, not absent reports.
- AWC polling starts no earlier than target plus one minute, with at least
  **60 seconds between starts on both wall and monotonic clocks**. Body
  completion at or after either target-plus-ten-minute deadline is retained
  as `outside_capture_window` and never scored. Abort timers alone are not
  evidence that a response completed inside the window. Initial waiting for
  the next target is additional to the ten-minute outcome window.
- Raw METAR station, UTC day/hour/minute, and routine type must match metadata.
  SPECI, NIL/cancelled, unsupported or contradictory content is not scored.
  Multiple target versions remain ambiguous. A single `COR` report retains
  its marker and is only the first matching version seen by this observer,
  not proof of initial issuance or final corrected content.
- Valid `T` remarks supply tenths; otherwise use the parsed integer body.
  Round ties toward the warmer integer, including negatives, and round the
  maximum before comparing integer buckets. Contradictory body versus rounded
  `T` values are a **local research quality rejection**, not a change to market
  contract precision precedence or the production NOAA parser.
- Keep the fixed runway-2/15L one-minute policy. Do not silently substitute
  16L, another cadence, or a favorable lag. Conflicting latest versions
  abstain. A changed `rwyMain` label triggers conservative abstention; it
  does not prove a physical sensor switch. Missing labels remain warnings.
- Missing/unexpected query dates, future receipts, late preparation, missing
  fresh observations and late seals remain explicit. Invalid calendar dates
  are rejected; UTC METAR header dates are distinct from KST date strings.
  Ambiguous or unsupported prior reports cannot establish an understated
  maximum. Missing expected slots and off-schedule reports are retained.

“New known high” means above the locally captured eligible NOAA maximum.
It is not a complete AWC settlement history or a final daily-high forecast.
Provider receipt, client receipt, preparation and file-sync clocks remain
separate; file hashes do not provide an externally trusted timestamp.

## Remaining work before a multi-day ledger

A future run needs a manifest fixed before its first decision: dates, rules,
code versions, all expected half-hour slots, planned decision times, freshness
limits and outcome/correction windows. `expectedSeoulRoutineSlots(date)` gives
48 expected slots; it does not guarantee that all reports will be issued.
Every planned slot must end in a recorded status, including missed invocation,
shutdown, failed query, abstention, late seal, ambiguity and timeout. The
current CLI chooses one target at invocation and cannot supply that denominator.

Retain observer versions without rewriting old predictions. Score the first
captured version separately from later corrections and the completed-day
maximum; a ten-minute capture cannot certify all future corrections. A local
reducer must verify hashes/references and account for every manifest slot
without consulting later mutable source state. That full reducer and restart
protocol are **not implemented**. Preserve matching source-code versions and
set storage/retention budgets before continuing captures. Full snapshots can
contain database IDs and belong in ignored local storage; sanitize public
extracts. New recurring collection or provider scope is not authorized by
this bounded test. Keep held-out days and coverage, accuracy, false alerts,
misses and baseline comparisons separate. The later single incremental
success does not estimate repeatable accuracy, price response, fills, fees
or profit.

## Verification and later local use

```text
node --test test/seoul-paper-forecast.test.mjs test/seoul-paper-probe.test.mjs
```

All **27 offline tests** passed, including date rollover, ambiguous versions,
precision, raw bindings, coverage, artifact collisions, late sealing, byte
limits, wall-clock jumps and both deadline cutoffs. Independent review closed
with no remaining findings in this scope. Existing captured evidence was not
rewritten. A later explicitly selected bounded capture uses a **new** path:

```text
node scripts/probe-seoul-next-metar.mjs tmp/seoul-paper-example.json
```

That command performs live read-only queries and bounded AWC requests. The
example path was not used; the subsequent fixed-target validation used its
own new path and the same recorder. Preserve the entire adjacent
`tmp/seoul-paper-example.evidence/` directory, not just its mutable summary.
