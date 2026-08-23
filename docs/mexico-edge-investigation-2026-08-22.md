# MMMX TDZ sub-degree investigation — 2026-08-22

Research window: **2026-08-23T03:00Z–04:15Z** (evening of 2026-08-22 in Mexico
City), plus a retained-history analysis of Mexico dates 2026-08-20 through
2026-08-22. This report extends, and does not overturn, the
[2026-08-21 edge investigation](./mexico-edge-investigation-2026-08-21.md).
Its evidence, uncertainty, source-rejection, and approval boundaries remain in
force.

## Question investigated

The CAPMA TDZ images are the fastest verified public AICM-specific temperature
display, but every displayed temperature is a whole degree. This session asked
whether the same already-approved source carries sub-degree information.

## Answer

Yes, in two ways, both from the images we already fetch once per minute:

1. **The display carries fields the collector never read.** Besides the two
   whole-degree temperatures, the fixed 1366x768 GUI shows `% HUMEDAD`
   (integer percent relative humidity), `PRESION` (station pressure at
   0.1 hPa), `PUNTO DE ROCIO` (whole-degree dew point), `QNH` (0.01 inHg), a
   2-minute box repeating temperature/dew point/QNH, precipitation, and wind.
   The dew point is **computed by the display from its unrounded temperature
   and humidity**, so the displayed `(T, Td, RH)` triple constrains the
   unrounded temperature more tightly than `T`'s own 1 °C quantization.
2. **Quantization-boundary events carry sub-degree timing information.** When
   a displayed whole-degree or whole-percent value ticks, the underlying
   value is at that display's rounding boundary at a known minute. Multiple
   quantized channels tick at staggered times, so a filter over the
   one-minute series can localize the unrounded temperature well below 1 °C
   during active periods.

### Per-event precision arithmetic

Using the Magnus form (`es(t) = 6.112·exp(17.62·t/(243.12+t))`), near 15–25 °C
and 40–85 % RH:

- a **temperature display tick** fixes the unrounded temperature at the
  display's rounding boundary at a known minute (exact up to sensor noise and
  the unknown rounding rule);
- a **dew-point display tick** fixes the computed dew point at its boundary;
  with humidity read to ±0.5 %, inverting Magnus pins the unrounded
  temperature to roughly **±0.1 °C** (`dTd/dRH ≈ 0.19 °C per %` at 80 % RH
  divided by `dTd/dT ≈ 0.93`);
- a **humidity tick** pins unrounded RH to its 1 % boundary, sharpening later
  dew-point inversions; and
- statically, intersecting `T`'s interval with the `(Td, RH)` Magnus band
  narrowed the feasible temperature interval on live frames from 1.0 °C to
  typically 0.6–0.9 °C even with no tick at all.

Observed channel activity in the live capture window (evening, slow cooling):
humidity ticked every one to three minutes (77→78→81→82→83 across the
sequence), dew point ticked twice in ~35 minutes, and the current temperature
was mostly static. The three retained days show 57–75 current-temperature
ticks per TDZ per day, concentrated in the 12Z–22Z climb window.

### Two-minute channel

Across the three retained days, the two-minute temperature's tick lagged the
current temperature's matching tick by a median of 60–62 seconds. This
confirms the manual's model — a one-minute instantaneous sample and a
two-minute mean — and means the 2-minute series is nearly a one-minute-lagged
copy: useful as a confirmation channel, not an independent thermometer.

### Boundary chatter

Repeated up/down ticks around one boundary (six 24↔25 transitions on TDZ05 on
2026-08-20) mean the unrounded value was hovering within tenths of the
boundary. Chatter density is itself evidence of proximity to the boundary and
must be modeled, not deduplicated away.

## The critical caveat: TDZ is not the METAR sensor

On all three retained days the TDZ displays exceeded the official METAR daily
maximum at the afternoon peak:

| Date       | METAR max | TDZ05 max | TDZ23 max |
| ---------- | --------: | --------: | --------: |
| 2026-08-20 |     25 °C |     26 °C |     25 °C |
| 2026-08-21 |     24 °C |     25 °C |     26 °C |
| 2026-08-22 |     23 °C |     24 °C |     24 °C |

A TDZ tick into a new degree therefore does **not** imply the METAR (or the
Weather Underground settlement table derived from it) will print that degree.

The decomposition matters, though. Matching each METAR observation to the
nearest TDZ frame within ±5 minutes across the three days shows the displays
agree with the official temperature within ±1 count almost everywhere (hourly
mean bias mostly within ±0.35 °C, individual differences almost all in
{-1, 0, +1}), with real divergence only around the convective evening
transition (22Z differences spanned −2 to +5 on TDZ23). The daily-maximum
excess is therefore mostly a **sampling artifact** — a per-minute display
catches brief peaks that hourly-ish METAR observations miss — plus double
quantization, not a large constant sensor offset. That makes the TDZ→METAR
mapping more learnable than a raw 1–2 °C "bias" suggests, but it must still
be learned (time-of-day and weather terms included), and the display's
rounding rule (round-half versus truncation) must be estimated empirically;
until then a tick means "the underlying value crossed this display's
boundary", not a specific .0 or .5 crossing.

## New display behaviors documented

- **Trailing `.0` is dropped.** The `PRESION` box showed `787 hPa` for over
  15 minutes while QNH read 30.43; the value string is centered, so digit
  positions shift between `787.2 hPa` and `787 hPa` layouts. Confirmed
  visually on a 4x crop.
- **QNH↔station-pressure consistency.** Every live pair satisfied
  `QNH(hPa) ≈ 1.3097 × QFE(hPa)` within 0.3 hPa (fixed-elevation reduction),
  giving a strong OCR cross-check for both fields.
- **Magnus consistency.** Every live `(T, Td, RH)` triple was feasible within
  display quantization under the Magnus form, on both TDZs and both display
  palettes, supporting the computed-dew-point model.
- **Retrograde screen times.** During a collector outage window, successive
  distinct TDZ05 frames carried screen times that stepped backward by about
  two minutes (03:22:33 → 03:20:39). Frame identity remains body hash plus
  embedded time; the estimator must tolerate non-monotone screen times.
- The red `SIN HISTORICO` banner on both displays confirms the GUI has a
  history feature that is absent or disabled in the public copies.

## Implementation shipped with this investigation

`convex/mexicoCapmaOcr.js` now extracts, per frame and per display palette,
with independent fail-soft validation:

| Field                  | Display precision | Validation                                    |
| ---------------------- | ----------------: | --------------------------------------------- |
| `dewpointC`            |              1 °C | Same reader/geometry family as temperature    |
| `humidityPercent`      |               1 % | Percent-mark anchor; 1–100 range              |
| `stationPressureHpa`   |           0.1 hPa | 3+1 digits or dropped-`.0`; 700–820; dot rule |
| `qnhInHg`              |         0.01 inHg | 4 digits + decimal gap; 27–32                 |
| `twoMinuteDewpointC`   |              1 °C | Two-minute-box reader geometry                |

Cross-checks fail closed on the fields they implicate: an infeasible
`(T, Td, RH)` Magnus triple drops dew point and humidity; a QNH that does not
match the station pressure within 1.2 hPa drops both pressure fields. A failed
extended field never rejects a frame that the existing core
temperature/timestamp/TDZ gates accepted, and extended confidences are
excluded from the storage-threshold `ocrConfidence`. The engine string is now
`fixed_layout_arial_template_v3_extended_dual_palette`.

The fields are stored on `mexicoCapmaTdzObservations` as optional columns with
per-field confidences. No new approval gate was added: the fields are parsed
from the same approved images, at the same cadence, under the same existing
CAPMA TDZ access/retention/republication capabilities, and they ride the same
fail-closed visibility rules as the existing TDZ rows. Tests:
`test/mexicoCapmaExtendedOcr.test.mjs` (synthetic template-rendered frames plus
live-verified cross-check values); the full suite passes.

The sub-degree **estimator itself is intentionally not implemented yet**. It
needs accumulated multi-channel history, an empirically identified rounding
rule, and a learned TDZ→METAR mapping before any dashboard output. Until then
no dashboard element may present a sub-degree TDZ value; when built, such an
estimate must be labeled a derived estimate with uncertainty, never a sensor
reading.

## Paths checked and rejected this session

- **`/banco/ETDS.HTM`** (linked first under CAPMA's `DATOS MMMX` menu, not
  previously documented): a forecaster-issued hourly takeoff-data forecast
  (temperature, wind, QNH/QFE/QNE), issued about four times daily with a named
  previsor. It is a forecast product, not an observation feed — rejected as a
  fast-observation path; at most minor forecast context alongside TAF.
- **`/vigilancia/itinerarios.php`**: CAPMA product publication schedule; all
  entries are forecast/chart products. Confirms ETDS cadence
  (03:30/09:30/14:30/20:30Z). No observation feeds listed.

## Operational finding: collector egress, not CAPMA downtime

During the research window the production TDZ collector recorded 8-second
timeouts for ~12 minutes while a direct workstation fetch of the same
`pista05.jpg` completed in 0.5 s. At least part of the frame-gap history
(gaps up to ~54 minutes on 2026-08-22) is therefore Convex-egress
reachability, not CAPMA unavailability. Gap-free minutes are exactly what the
sub-degree estimator needs; egress reliability (or a sanctioned alternate
fetch path with identical approval enforcement) is now a real dependency for
this line of work.

Follow-up implemented the same day: all CAPMA requests moved to a
fresh-connection `node:http` transport (`server/mexicoCapmaTransport.js`).
Fresh connections alone did not clear the TDZ failures; retained
successful-fetch durations then showed the real profile — bimodal transfers
(median 0.27 s at ~600 KB/s, slow mode down to a few KB/s with p95 9.5 s,
p99 27.5 s, completed 84 s transfers before an application timeout existed).
The flat 8-second timeout adopted earlier on 2026-08-23 was itself turning
the slow mode into hard failures. Collectors now use escalating per-attempt
budgets (TDZ 12 s then 40 s; AFTN 8 s then 25 s; the high-frequency watcher
one attempt per call), retrying network failures only. The slow-mode root
cause — throttling, congestion, or a middlebox on the path from this egress —
remains undetermined. See [mexico-current.md](./mexico-current.md) for the
durable transport description.

A six-hour post-fix sample (04:33Z–12:00Z on 2026-08-23) then found the
dominant remaining gap cause was the scheduler, not the network: a claim
cooldown equal to the one-minute cron spacing raced scheduling jitter and
skipped roughly alternate cycles as `cooldown`. Stored TDZ gaps were almost
all exactly two minutes with screen/mtime advancing in the documented
~60/62-second origin steps and every post-gap fetch fast — the origin never
stopped producing. This beat also explains the months-old ~530-rows-per-day
TDZ history and many invalidated paired-race slots. Scheduled claim
cooldowns for TDZ 05/23, CAPMA AFTN, and NOAA text were lowered to 45 s
(launch cadence unchanged at one per minute; AWC keeps its documented 60 s
discipline), and collector status rows now keep a capped `recentErrors`
ring buffer, added because one 55-minute TDZ05-only outage in the sample
could not be diagnosed from the single retained lastError message.

The ring buffer then caught a live outage window (12:13Z–12:2xZ): every
direct attempt failed with `connect ETIMEDOUT` to the owner host while a
Vercel-egress probe and a residential fetch of the same URL connected in
under a second in the same minutes. The residual gaps are therefore
egress-path connect drops, cause undetermined. An allowlisted,
shared-secret alternate-egress relay on the Vercel deployment was added as
a once-per-cycle fallback after all direct attempts fail; frames served
through it are marked `fetchTransport: "vercel_relay"`. It is dormant until
its Convex-side transport settings are configured and changes no approved
URL, cadence, or approval boundary.

## Next steps

1. Let the extended fields accumulate several days of history, including full
   climb windows in both display palettes.
2. Empirically identify each display's rounding rule from boundary-crossing
   timing against the METAR sequence.
3. Build the quantized-channel fusion estimator offline; validate against
   held-out days before any dashboard exposure.
4. Learn the TDZ→METAR mapping (time-of-day, wind, weather terms) and express
   its output only as a probability for the next official whole-degree print.
5. Investigate the egress reliability gap separately.
