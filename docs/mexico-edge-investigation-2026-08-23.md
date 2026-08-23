# MMMX TDZ provenance and rounding-rule investigation — 2026-08-23

Research window: **2026-08-23T13:50Z–15:10Z**, using retained
`mexicoCapmaTdzObservations` rows with extended fields (available since
2026-08-23T03:47Z) and bounded public reads of the CAPMA owner host. This
extends the [2026-08-22 investigation](./mexico-edge-investigation-2026-08-22.md);
its boundaries remain in force.

## Finding 1: the TDZ JPEG is a screen capture — no public data endpoint exists behind it

The hypothesis that `pista05.jpg` is rendered from a fetchable numeric feed
was tested and is **rejected**:

- a fresh frame contains a **Windows mouse-cursor arrow** inside the compass
  rose — an artifact of screen capture, impossible in a server-side render;
- the `Index of /banco` listing contains `Thumbs.db` (a Windows Explorer
  thumbnail cache) and a `WINGRIDDS/` folder: the directory is a Windows
  forecaster workstation's product-output folder published through the
  `Apache/2.4.55 (Ubuntu)` host, and every entry is a rendered image or PDF;
- no sibling data file exists — `pista05.txt`, `pista05.json`, and
  `pista05.dat` all return 404;
- `/capma/pista05.php` is a 249-byte static HTML `<img>` wrapper with no
  dynamic call; and
- the JPEG itself is a bare JFIF with all metadata stripped and no trailing
  payload.

The temperature is drawn as pre-rounded text (no analog gauge), so the
public pixels cannot carry decimals even in principle. The unrounded value
exists only inside the AWOS GUI on SENEAM's internal network; the sanctioned
SENEAM/Vaisala AWOS export path documented in
[mexico-current.md](./mexico-current.md) remains the only route to the true
0.1 °C number. Do not re-run this line of inquiry against the public host.

## Finding 2: the display's rounding rule remains UNDETERMINED (earlier same-day claim retracted)

An earlier version of this section claimed the rounding rule was
empirically established as round-to-nearest. **That claim was wrong and is
retracted.** External review falsified the discriminator, and an
independent synthetic reproduction confirmed the review:

- The static three-box feasibility test cannot discriminate: 0 % infeasible
  frames under all four hypothesis combinations — the boxes are too wide.
- The residual statistic (implied-T from the dew-point/humidity boxes minus
  displayed T) was argued to predict 0.0 under round-half and +0.5 under
  truncation. The +0.5 null was an analysis error: under an all-floor
  display, the dew-point and humidity channels shift the same way, and the
  statistic's fixed `Td ± 0.5` window cancels most of the shift. On
  synthetic Magnus-generated data with known quantizers the statistic
  returns ≈ 0.0 under all-nearest and only ≈ **+0.10 to +0.15** under
  all-floor — not +0.5.
- The observed live residuals (+0.05 TDZ05, +0.08 TDZ23) therefore sit
  between the two hypotheses' predictions and cannot decide them, even
  before noting that the printed standard errors were 2–3x too small
  (lag-one residual autocorrelation 0.78/0.57; only ~27–29 distinct
  `(T, Td, RH)` triples behind 266/219 frames).
- The dew-point holdout is rule-insensitive (94.1 % under nearest versus
  93.2 % under floor on TDZ23) and cannot resolve the quantizer either.
- A further confound: the production OCR's Magnus-consistency gate uses
  centered (nearest-shaped) windows, so retained `(T, Td, RH)` triples are
  already filtered toward nearest-consistency; research on retained rows
  inherits that selection.

Consequences: a temperature tick pins the unrounded value to an exact but
**unidentified** boundary (x.5 under nearest, x.0 under floor/truncation);
the +0.05/+0.08 residuals are descriptive statistics confounded by
quantization and formula differences, not calibration constants; and any
consumer of tick events must carry the ±0.5 rule ambiguity until a proper
identification exists. The recommended identification is a joint latent
T/RH model compared across quantizer combinations by marginal predictive
likelihood (with a formula-bias term), guarded against numerical artifacts by
all-rule synthetic safety tests, then validated on frozen untouched data that
were retained without the target-dependent Magnus gate.

## Finding 3: retired v1 estimator and retracted validation claim

`scripts/tdz-subdegree-estimator.mjs` originally implemented this pipeline on
day-dump JSON: per-frame three-way Magnus feasible intervals → a constrained
grid-HMM smoother (soft interval costs, random-walk prior, forward-backward
posterior) → mean plus 10–90 % band. First results on ~11 h of
extended-field frames (mostly flat overnight hours — the weakest regime,
with zero temperature ticks):

| Metric                                             | TDZ 05 | TDZ 23 |
| -------------------------------------------------- | -----: | -----: |
| Median 10–90 % band width                          | 0.45 °C | 0.50 °C |
| Dew point predicted after refit **without** it     | 77.4 % | 94.1 % |
| … baseline from rounded inputs alone               | 71.1 % | 80.8 % |

Review-corrected interpretation of that table:

- The dew-point comparison is a **retrospective leave-one-channel-out
  consistency check**, not genuine out-of-sample validation: the dew point
  helped select the model, the retained data passed the production OCR's
  Magnus gate, the smoother is non-causal (backward recursion sees the
  future), and no untouched day was held out. Beating the rounded-inputs
  baseline shows temporal smoothing recovers cross-channel consistency; it
  does not measure hidden-temperature error.
- The band widths are **model-conditional inferred ranges**, not
  demonstrated accuracy: `obsSigma` and the random-walk sigma are
  hand-chosen, and plausible alternatives move the median 10–90 % width
  from roughly 0.15 to 1.1 °C. No decimal ground truth from the same
  sensor exists to check coverage.
- The smoother is offline; adding future frames revises past estimates by
  up to ~0.4–0.5 °C in sampled prefixes. Live use would require a causal
  filter or a declared fixed lag, evaluated by rolling-origin prediction.
- Additional implementation limits: usable frames were restricted to those
  with extended fields (temperature-only frames and their ticks were
  discarded); the 2-minute test assumes an exact, correctly phased mean of
  two 1-minute samples, which is unestablished; `Math.floor` is not
  truncation-toward-zero for negative temperatures; and there are no
  automated tests or frozen input manifests, so published numbers cannot be
  reproduced from a changing live-day query.

These are estimates of the **TDZ display's own underlying value**: not the
METAR-selected sensor, never settlement truth, and nothing here may reach a
dashboard until real validation passes and the output is labeled a derived,
model-conditional estimate. The tool stays offline and experimental.

## v2.1: likelihood-based quantizer identification and corrective audit

`scripts/tdz-quantizer-id.mjs` is the guarded replacement for the retired v1
CLI. It uses a joint latent `(T, RH)` grid model and a source-time forward
filter, but its evidence is explicitly a **finite-grid approximation** and its
output is an offline, retrospective research result. It does not produce
settlement truth, a sensor reading, or a calibrated accuracy interval.

The first v2 run reported 829/857 frames, a decisive shared T/Td rule, and a
median 1.0 °C `10–90 %` band. Review found four additional artifacts large
enough to alter those interpretations, so that first-run conclusion is
preserved here as history but **retracted**:

- the candidate list contained only six of the eight T/Td/RH rule triples and
  omitted both mixed T/Td cases with floor RH;
- the additive dew-point formula-bias profile was limited without external
  justification to `−0.15, 0, +0.15 °C`; allowing the natural approximately
  half-degree alias makes shared and mixed T/Td rule families competitive;
- the dew-point emission treated the nonlinear image of a rectangular
  `(T,RH)` cell as uniform over a local min/max span; and
- two selected model means were equally averaged and their conditional
  `p10/p90` endpoints enveloped. That is not marginalization and the envelope
  is not itself an 80 % credible interval.

The exact 829/857 input dumps and result files were not retained in the
workspace, so their hashes and headline margins cannot be reproduced from the
later, changing live-day query. A digest verifies retained bytes; it does not
preserve them.

### v2.1 corrections

- All eight Cartesian T/Td/RH nearest/floor combinations are evaluated.
- Additive Td bias is integrated on a recorded nonuniform quadrature spanning
  `−0.5..+0.5 °C`; combination and family evidence are reported separately
  for temperature rule, shared-vs-mixed T/Td behavior, and humidity rule.
- Axis-channel cell overlap is analytic. Dew-point cell area is evaluated by
  eight-point inverse-Magnus Gauss–Legendre quadrature instead of a uniform
  projected-span approximation. Finite-grid transition kernels are
  renormalized at boundaries, and long gaps forget stale state progressively.
- The multi-seed numerical-safety suite covers every rule truth, including
  mixed T/Td with floor RH. It is a regression barrier against decisively
  wrong numerical conclusions, **not** identifiability or accuracy
  validation. Matched fixed-bias positive controls must also produce at least
  one decisive-correct result, so an always-undecided implementation cannot
  pass. `identify` and `estimate` fail closed before loading live inputs if the
  suite fails.
- The estimate envelopes the model-conditional `p10/p90` bands of every
  quantizer/bias model within the declared profile-likelihood threshold. Its
  fields are `conditionalP10Envelope` and `conditionalP90Envelope`; this is a
  robust set envelope, not a posterior-mixture interval. Model inclusion and
  weights use the complete sample, so historical points are retrospective
  even though each state recursion is forward-only.
- `identify --out` and `estimate --out` include exact input SHA-256 digests,
  the script digest, the resolved grid/dynamics/bias/hypothesis configuration,
  gate outcomes, and the qualified output semantics.
- Direct execution of `scripts/tdz-subdegree-estimator.mjs` delegates to this
  guarded v2.1 path. The falsified v1 path requires the explicit local
  `TDZ_RUN_RETIRED_V1=true` reproduction escape hatch.
- Live retention sometimes contains dew point without humidity. Input
  normalization keeps the independently valid temperature frame, explicitly
  removes both incomplete auxiliary fields, records the discarded-pair count,
  and leaves the direct model API strict about requiring Td and RH together.

Focused verification in `test/tdzQuantizerId.test.mjs` covers all-eight truth
combinations across multiple seeds, half-degree bias confounding, a dense
dew-cell area oracle, hard gate enforcement, grid validation, robust-envelope
field semantics, incomplete auxiliary-pair normalization, and persisted
manifests.

### Corrected live-data check on 2026-08-23

An ephemeral production query for Mexico-local 2026-08-22 and 2026-08-23 was
rerun after the v2.1 corrections. It yielded 853 deduplicated TDZ05 frames and
894 TDZ23 frames; 39 and 47 rows respectively had an incomplete auxiliary pair
and were retained as temperature-only. Because this check was piped directly
from the changing dashboard query rather than frozen to a dump, these counts
and results are timestamped evidence, not a reproducible input artifact.

- TDZ05: the top-combination evidence margin was `0.1555`; temperature-rule
  family margin `0.5219`; shared-vs-mixed T/Td margin `0.1007`.
- TDZ23: the corresponding margins were `0.0012`, `0.0331`, and `0.4033`.
- All are far below the declared decisive threshold of `10`. Hour-block signs
  were also unstable. The corrected live run therefore supports neither a
  nearest-vs-floor verdict nor the retracted shared-formatter verdict.

### Defensible conclusion

The retained public triple does not currently identify a unique, calibrated
absolute sub-degree TDZ temperature. Nearest-versus-floor and
shared-versus-mixed rule conclusions remain sensitive to formula-bias and
model assumptions, so every absolute tick/trajectory interpretation must
carry that ambiguity. A roughly one-degree conditional-band envelope observed
on a changing sample is a useful diagnostic, not a precision or coverage
guarantee.

This is practical under-identification, not a proof of mathematical
impossibility. Magnus curvature breaks the shift symmetry weakly; longer and
more diverse data could add evidence, but no feasible-volume claim is yet
validated. Strong external anchors remain SENEAM/vendor formatter
documentation or a sanctioned decimal export from the same logger/sensor.
METAR rounding is useful only if common sensor lineage, timing, averaging, and
encoding are independently established; otherwise it supports a TDZ→METAR
mapping, not formatter identification.

Still open: retain pre-Magnus-gate OCR candidates to remove target-dependent
selection, freeze complete-day input/result artifacts, tune on prior days,
evaluate untouched days in true arrival order, and calibrate interval coverage
against same-sensor decimal truth.

## Trader-reaction timing: what Polymarket participants act on

Question: do traders react to the CAPMA-visible report (~:41–:52), the
NOAA/AWC/Weather-Underground-visible report (~:54–:08), or something ~5
minutes before the :40 observation start? Data: all retained
`mexicoEdgeMarketQuoteEvents` for 2026-08-21..23 (3,507 changed-quote events,
11 buckets/day), joined with the same days' METAR arrival times. Units are
honest detection intervals from ~1-minute REST polling (±1-minute blur);
changed-only history left-censors most of 08-21; three days; compatibility
only, never causality.

Findings:

1. **No pre-:40 anticipation.** Minutes :33–:39 carry BELOW-uniform activity
   (trade-price changes x0.55, book changes x0.70 vs uniform). The ~:35
   hypothesis is not supported.
2. **A small fast cohort acts at CAPMA speed.** In the per-cycle event study
   of new-daily-max routine reports, the first activity on the newly
   relevant bucket landed 2–4 minutes after CAPMA first sighting and 10+
   minutes BEFORE AWC in the classifiable majority of daytime cycles
   (e.g., 08-22 15:45Z: +130..190 s after CAPMA, >635 s before AWC;
   08-23 06:40Z: +182..242 s after CAPMA, >883 s before AWC). On 08-22
   18:45Z — when our own CAPMA collector was delayed ~10 minutes by the
   egress outage — the market still moved within (45 s, 105 s] of the coded
   observation time, i.e., someone watches a CAPMA-speed source directly,
   not our sighting and not NOAA.
3. **The bulk of flow trades at NOAA/top-of-hour time.** Excluding the 06Z
   hour (midnight local: 22 of the 35 :00-minute trades are date-rollover /
   settlement positioning, not weather reaction), the :54–:08 window holds
   **52.6 % of all trade-price changes (x2.11 uniform)** and 49.1 % of book
   price changes (x1.96), peaking at :59–:02 exactly where AWC receipt
   clusters. Most participants wait for the official public chain — which
   includes Weather Underground, the settlement source display.
4. SPECIs reach CAPMA and NOAA in the same minute (documented 08-21), so
   special reports do not separate the cohorts.

Implication for the edge thesis: the ~13-minute median CAPMA→NOAA relay gap
is real and mostly UN-arbitraged — one fast actor (or few) moves the
relevant bucket minutes early on thin size, and the majority reprices at the
top of the hour. Analysis scripts: session scratchpad
(`reaction-timing.mjs`, `reaction-timing2.mjs`); underlying data reproducible
from `mexicoPolymarketLive:getQuoteHistory` per bucket/date.

### Size in the reaction window (top-of-book evidence)

Tick-level inspection of the new-max cycles quantifies "thin": in the
CAPMA→NOAA window, visible top-of-book size on the relevant bucket ran
roughly 3–80 shares (about $1–$40 notional at prevailing prices), and the
fast actor's price-moving executions consumed asks of ~3–5 shares (single-
digit dollars). Example (08-21, 24 °C bucket): pre-report ask 0.22 x5.16 was
consumed at 19:40–:43 with prints 0.22→0.35→0.36 (~$3–5 total), leaving
ask 0.45–0.46 x5–56 through the window; that bucket ultimately resolved at
1.00. Caveats: only best bid/ask depth is retained (depth behind the BBO is
invisible), REST last-trade carries no size, three days, and books deepen
near settlement. A second nuance for any strategy: buying the newly printed
degree is a bet the climb STOPS there — on 08-22 the 23 °C bucket's ask fell
0.19→0.09 after the 23 °C print as the market priced a further rise.

## Next-calendar-day forecast source check

Research window: **2026-08-23T20:45Z–21:15Z**. This check affects forecast
timing and source labels only; it does not change the TDZ provenance or
sub-degree conclusions above.

CAPMA is SENEAM's aviation meteorology forecast center, not a separate provider.
The official MMMX TAF contains `TXnn/DDHHZ` maximum groups and is already
collected through NOAA Aviation Weather Center's documented API. Fourteen
consecutive 00Z-cycle samples from August 10–23 had issue times from
`23:02Z–23:52Z` (`17:02–17:52` Mexico City), 24-hour `DD00/(DD+1)00` validity,
and a TX group for the upcoming local calendar day. Earlier routine cycles
usually stop before the following afternoon, so tomorrow's airport maximum is
normally unavailable until that late-afternoon 00Z cycle.

This is an observed bounded sample, not a promised CAPMA publication window.
The February 2026 MMMX AIP still describes CAPMA TAF validity as 30 hours while
all checked operational messages were 24 hours. Consumers must parse each raw
validity group and target-date TX rather than assume either horizon.

Other CAPMA products do not improve next-day-high coverage. The published ETDS
schedule contains roughly 11–12-hour takeoff-data forecasts; its evening issue
reaches the next morning but not the next afternoon. Historical FMMX extreme-
temperature output carried the issue day's maximum and following morning's
minimum, and the current legacy FMMX path returned an empty body. No direct
CAPMA UI scrape, supported API contract, or republication grant was established.

SMN/CONAGUA's already collected `method=3` hourly municipal feed spans multiple
days, so tomorrow's Venustiano Carranza high is derivable from retained rows.
The separately documented `method=1` product also returns explicit `tmax/tmin`
for today plus three days, but it is another product from the same provider,
not a third independent source. It supplies no reliable issue timestamp. The
implementation therefore reuses method 3 and its existing immutable snapshot,
status, attribution and cooldown paths rather than add a redundant collector.

Weather.com/The Weather Company was not added. Its licensed ICAO daily/hourly
API could be a separately labeled secondary comparator after forecast-specific
approval and an MMMX-local fixed-vintage backtest, but consumer-site scraping
is not an authorized production interface and the existing `TWC_MMMX_RES_*`
flags are reserved for settlement observations.

Primary references:

- SENEAM CAPMA: <https://www.gob.mx/seneam/acciones-y-programas/centro-de-analisis-y-pronosticos-capma>
- MMMX AIP: <https://aipmexico.seneam.gob.mx/AIP/doc/AD/AD_2/38_MMMX/AD_2-MMMX-2.pdf>
- AWC TAF API: <https://aviationweather.gov/api/data/taf?ids=MMMX&format=raw>
- AWC API documentation: <https://connect.aviationweather.gov/data/api/>
- CAPMA ETDS schedule: <http://capma.mx/vigilancia/itinerarios.php>
- SMN web-service documentation: <https://smn.conagua.gob.mx/es/web-service-api>
- SMN municipal forecast page: <https://smn.conagua.gob.mx/es/pronosticos/pronostico-del-tiempo-por-municipios>
