# RKSI: fastest current-temperature source

Last researched: **2026-08-03 KST**.

## Bottom line

The fastest source we actually measured is AMO/KMA's public mobile AMOS JSON:

```text
GET https://global.amo.go.kr/mobileApi/global_api/v1/amos_info.do?air_code=RKSI
```

It exposes minute AMOS display records derived from the live airport sensors,
without an API key. In measured boundary tests, a new observation minute first
appeared about **14-16 seconds after the minute**. The response carries
temperatures to 0.1 °C on runway-designated display rows, along with `tm_fc`,
`rwy_dir`, `rwy_use`, `rwy_main`, dew point, QNH, wind, visibility, and other
AMOS fields.

The rows are runway-shaped display records, not one independent thermometer per
`rwy_dir`. Live probes found only two distinct temperature series: the 15L
primary/representative series was copied across the runway 1/2 rows, and the 16L
series was copied across the runway 3/4 rows.

For a documented and more durable production integration, the best candidate is
KMA API Hub's authenticated **AMOS every-minute API**:

```text
GET https://apihub.kma.go.kr/api/typ01/url/amos.php?dtm=5&stn=113&help=0&authKey=KEY
```

`113` is Incheon Airport. The API defines `TM` as the observation time and `TA`
as air temperature at 0.1 °C resolution. It requires a free KMA API Hub account
and key. We confirmed that the endpoint is live, but could not measure its
publication lag without a key.

The important distinction is:

- For the freshest measured temperature, use **minute AMOS**, not METAR.
- For the first official coded RKSI report, use a METAR feed, but RKSI routine
  METARs are only issued every 30 minutes and temperature is rounded to 1 °C.

## Connection and collector status

The source is verified through direct unauthenticated HTTP requests and Convex
actions. The low-latency collector now uses the observed publication boundary
instead of one conservative fixed request:

- `seoul:scheduleLatestAmosTemperatureSites` schedules the expected next
  observation minute at second `:12`.
- `seoul:captureLatestAmosTemperatureMinute` checks sequentially once per
  second, stops as soon as the 15L timestamp advances, and upserts 15L/16L once.
- Each request has a three-second timeout and the burst stops after eight
  attempts.
- The normal one-minute and full five-minute captures carry distinct
  `collectionCadence` values and remain separate database rows.
- Every newly inserted AMOS row records an immutable `firstSeenAt` at its first
  successful database write. Later upstream revisions may advance `updatedAt`
  but never replace `firstSeenAt`; legacy rows remain without a fabricated
  first-seen time.
- `seoul:pollLatestNoaaStationMetar` now stores the actual NOAA RKSI METAR in
  the chart table; the retired AMO METAR API is no longer used by the chart
  cron.

A live rollover probe started at `:12.005`, remained stale at `:13.245`, and
returned the fresh minute at `:14.753` on the third request. This is about five
seconds faster than the former fixed `:20` strategy while still stopping the
burst immediately after success.

Production deployment verification on 2026-07-27 KST confirmed the complete
chart path:

- NOAA stored the actual 11:30 RKSI METAR at 30 °C.
- The automatic burst stored the cadence-tagged 11:50 one-minute AMOS row at
  second `:16.410`, with representative 15L at 29.6 °C.
- The next automatic minute arrived at `11:51:15.412`, confirming the cron
  continues across consecutive minutes.
- The five-minute collector independently stored its cadence-tagged 11:50 AMOS
  row at second `:16.660`.
- Both cadence rows coexist for the same sensor timestamp and carry the same
  upstream temperature. The five-minute collector is a separate polling
  snapshot, not an average or independent product, so the chart presents only
  the one-minute AMOS line and uses five-minute rows solely to fill missing
  timestamps.

## Historical analog-ensemble feasibility

### Decision

The proposed analog method is buildable, with one important narrowing of the
first version: use the official station-113 minute and hourly observation
archives, run it as a separate shadow model, and do not assume that historical
KMA forecast captures, 16L, or measured GK2A radiation exist for 2005-2025.

Basic historical availability is no longer an open question. Direct tests on
2026-08-03 KST downloaded and parsed station-113 files from 2005 and 2025,
retrieved a complete August 2, 2025, and matched the current archive temperature
against this project's stored live 15L/16L observations. The remaining work is
an importer, quality control, instrument-era classification, feature
generation, and walk-forward validation.

The first model should be named something like
`rksi15l-analog-peak-time-v1`. It should use 15-30 weighted analog days and
produce a peak-time distribution, probability that the peak has already
occurred, remaining warming, effective analog count, and one or more peak
windows. August 2 of the previous year is useful as a visible same-date
baseline, but must not be the prediction by itself.

### Historical dates and access verified

KMA's [AMOS data portal](https://data.kma.go.kr/data/air/selectAmosRltmList.do)
advertises minute, hourly, and daily airport observations from 2005 onward,
with the exact start varying by station. Its interactive minute query is
limited to one day, but the portal's file-set page publishes station/month ZIP
bundles suitable for bulk ingest. The related
[Public Data Portal file listing](https://www.data.go.kr/data/15052608/fileData.do)
describes the CSV data as free and Public Nuri Type 1, with attribution and
third-party-rights conditions; the supported download workflow is
account/login based.

The station-113 file-set catalogue was enumerated from January 2005 through
August 2026:

- 257 of the 260 expected monthly labels were present.
- For the completed 2005-2025 period, 249 of 252 monthly bundles were listed.
- For June-September 2005-2025, 83 of 84 monthly bundles were listed. Only
  August 2020 was absent from the bulk catalogue.
- The other absent catalogue labels were December 2018 and May 2025.
- A missing bundle does not mean missing observations. The database query
  exposed all 1,440 station-113 minute rows for August 2, 2020, demonstrating
  that the absent monthly bundle is a packaging gap; an authenticated daily
  export can fill it.
- The current August 2026 bundle was also present and updating, so completed
  2026 dates can come from finalized KMA data as well as the existing live
  store.
- All 21 annual station-113 hourly bundles and all 21 annual daily bundles for
  2005-2025 were listed, so the minute archive can be supplemented and checked
  without making hourly API calls across the full period.

Representative files were downloaded and parsed rather than inferred from
catalogue metadata:

- January 2005 contained 24,861 rows, beginning on January 13 at 13:15 KST.
  KMA conservatively documents station-dependent holdings from February 2005,
  so January should be treated as bonus partial coverage rather than a promised
  start date.
- August 2, 2005 contained 1,351 of 1,440 expected minutes. Early years are
  usable only after per-day gap filtering.
- August 2025 contained 44,640 rows without duplicate timestamps or gaps.
  August 2 had all 1,440 minutes from 00:00 through 23:59 KST. Its maximum was
  33.0 C at 16:12 KST; the first minute within 0.1 C of the maximum was 15:29.

The June 20-August 2 example across 2005-2025 is at most 924 candidate days and
about 1.33 million minute rows. A +/-45-calendar-day search across 21 completed
years is at most 1,911 days and about 2.75 million rows. Both are modest for an
offline import and feature-building job. They should not be queried as millions
of individual Convex documents for every live prediction.

KMA monthly files use a non-obvious KST boundary: a nominal month contains
`(month start 00:00, next month 00:00]`. In practice it starts at 00:01 on day
one and includes 00:00 on the first day of the next month. The importer must
assign dates from the timestamp and include the preceding bundle when the
midnight at the start of a month matters.

### Station-113 temperature is the current 15L series

The archive file does not carry a runway or sensor identifier, so this was
tested instead of assumed. Station-113 minute `TA` was joined by exact KST
timestamp to the current project's stored one-minute observations for August
1 through August 3, 2026. There were 2,822 minutes on which archive `TA`, live
15L, and live 16L were all present:

| Comparison | Result |
| --- | ---: |
| Archive `TA` exact match to 15L | 2,822 / 2,822 |
| Archive `TA` exact match to 16L | 119 / 2,822 |
| Mean absolute error versus 15L | 0.0000 C |
| Mean absolute error versus 16L | 0.4708 C |

All 2,703 discriminating minutes matched only 15L; none matched only 16L. The
zero-offset timestamps also aligned exactly. This is strong evidence that the
current station-113 archive temperature is the representative 15L series.
It agrees with
[KMA's aviation observation guidance](https://data.kma.go.kr/resources/images/publication/%ED%95%AD%EA%B3%B5%EA%B8%B0%EC%83%81%EA%B4%80%EC%B8%A1%EC%A7%80%EC%B9%A8%2820240611%29.pdf),
which identifies 15L as Incheon's representative runway and says
representative AMOS values are used for METAR/SPECI.

This proves the current mapping, not an unchanged physical sensor back to
2005. The archive does not record the runway, primary/reserve selection,
failover, individual sensor replacement, or calibration state. Official KMA
material says the runway 1/2 systems were introduced in 2010, and a
[2020 AMO notice](https://amo.kma.go.kr/information/press.do?bid=bodo&field=&mode=view&num=33&page=3&text=)
discussed their replacement. At minimum, 2005-2009 must be a separate
unverified instrument era. Later commissioning or change dates should also
form era boundaries when confirmed.

Before production use, retain the exact overlap comparison as a reproducible
import test and extend it over at least 30 finalized recent days. Compare both
15L and 16L at exact KST minutes, emphasize minutes where they differ by at
least 0.2 C, and record exact-tenth match rate, MAE, RMSE, and best lag from
-10 to +10 minutes. Request representative-runway history, equipment-change
dates, and reserve-substitution information from AMO/KMA; use statistical
change-point checks where records are unavailable.

### Fields actually available for historical matching

The minute file header was inspected directly. It contains:

```text
station, time, temperature C, 10-minute-average wind speed KT,
10-minute-average wind direction degrees, 10-minute-average MOR m,
10-minute-average RVR m, cumulative precipitation mm
```

The annual station-113 hourly file was also downloaded and inspected. It adds
hourly wind/gust, visibility, weather, four cloud amounts/types/heights,
temperature, dew point, sea-level pressure, station pressure, and
precipitation.

Therefore a no-lookahead version-one analog can match:

- Temperature at the checkpoint, morning minimum and warming from it, distance
  below the observed high, recent two-to-four-hour curve, and 15/30/60-minute
  slopes.
- Ten-minute-average wind represented as `u`/`v`, plus recent wind-vector
  changes.
- MOR/RVR visibility and reset-aware precipitation occurrence/recent ending.
- The most recent hourly dew point or dew-point depression, station/sea-level
  pressure and tendency, weather, cloud amount/layers, and ceiling available
  at or before the checkpoint.
- KST minute, day of year, and calculated Haurwitz clear-sky solar geometry.

The following are not available consistently enough for the 2005-2025 analog
distance and must be omitted from version one:

- Historical 16L temperature or 15L-16L divergence.
- Minute dew point, humidity, pressure, cloud, ceiling, or quality flags from
  the bulk file. The authenticated
  [API Hub minute definition](https://apihub.kma.go.kr/apiList.do?apiMov=%EA%B8%B0%EC%83%81%EC%B2%AD+AMOS+%EB%A7%A4%EB%B6%84%EC%9E%90%EB%A3%8C+%EC%A1%B0%ED%9A%8C&seqApi=14&seqApiSub=259)
  lists richer fields but allows at most a 60-minute request window; old-date
  availability of those fields has not been validated with an account, and it
  would be inefficient for a bulk backfill.
- Historical KMA forecast curves. This project only began immutable KMA
  forecast capture in July 2026, and the current airport page cannot recreate
  past issue-time forecasts.
- Historical measured GK2A radiation/transmission. Raw numerical observations
  are retained for 48 hours. Haurwitz solar geometry remains valid because it
  is calculated from location and time rather than future observations.
- Any inferred primary/reserve or sensor-failover state.

Current KMA hourly guidance, live 16L divergence, live AMOS slopes/wind/rain,
and approved live GK2A signals remain valuable in the existing physical
nowcast. They should be combined with the analog output after the analog model
runs; they must not be backfilled or mislabeled as historical analog features.

### Import, storage, and quality-control plan

The safest first ingest is an operator-run local importer over authorized KMA
portal ZIP exports. It avoids making a production collector depend on an
undocumented portal request. The importer should:

1. Record the portal dataset, station, requested period, original filename,
   byte hash, retrieval time, parser version, and source license metadata.
2. Expand the nested ZIPs, decode the Korean CSV encoding, validate the exact
   headers, parse all timestamps explicitly as KST, and treat numeric blanks as
   missing rather than zero.
3. Reconcile the monthly boundary, duplicate timestamps, cumulative-rain
   resets, gaps, out-of-order rows, and full-day coverage.
4. Join the hourly record without allowing an observation later than the analog
   checkpoint into its feature vector.
5. Reject days without adequate coverage from the morning checkpoint through
   the eventual maximum and to midnight, especially days with gaps near the
   high. Keep rejected days and rejection reasons auditable.
6. Produce canonical daily outcomes: maximum, first exact-maximum time, first
   and last times within 0.1 C of the maximum, peak plateau/window, remaining
   warming after each checkpoint, and late-rebound flags.
7. Write in resumable, idempotent chunks and verify row/day counts and hashes
   after import.

Do not place historical archive rows in `seoulAmosObservations` with invented
`rwyNo`, `rwyDir`, live `collectionCadence`, or `firstSeenAt` values. A compact
historical schema should instead use approximately one document per day, with
fields such as:

- station/date, `archiveSeries=station113_representative_ta`, instrument-era
  ID, source/hash/parser provenance, and coverage/QC flags;
- packed or array minute temperature/wind/visibility/rain series and hourly
  meteorology;
- derived day outcomes and per-15-minute checkpoint feature vectors;
- immutable shadow predictions, analog IDs/distances/weights, and backtest
  results.

Precomputing checkpoint features and seasonal standardization prevents every
live request from scanning or decoding the full raw archive. Effective analog
count should be `1 / sum(weight^2)`, and weak support should be reported when
too few comparable cases dominate.

The official download metadata requires a login. Although the portal's current
internal sample-download route returned complete ZIPs during research,
production code must not depend on that undocumented route. KMA API Hub offers
a documented account/key route, but its 60-minute maximum would require roughly
184,000 requests for a 21-year minute backfill; monthly files are the practical
starting point.

If a later server-side downloader uses a registered KMA account, API key, or
other provider-approved application scope, treat that scope as approval under
this repository's external-integration policy. Implement it behind a separate
exact-`true` Convex flag such as
`KMA_AMOS_HISTORY_DOWNLOAD_APPROVED`, distinct from its credential, and recheck
it at every manual, scheduled, worker, request, and write boundary. No such
automated integration or approval flag is implemented by this research change.

### Analog calculation and no-lookahead rules

At a live checkpoint, compare only data through that KST minute on both today
and each candidate day. Candidate observations after the checkpoint may be
used only as the known outcome to transfer:

```text
translated future temperature = today's checkpoint temperature
                              + candidate future temperature change
```

Standardize features by time of day and season. Tune distance weights in a
nested walk-forward backtest rather than on the dates being scored. Select the
nearest 15-30 compatible days, apply a distance-decay weight, and retain the
full weighted set of translated future trajectories. Report first maximum,
last time within 0.1 C of the maximum, the central 50% and 80% peak windows,
probability already peaked, remaining-warming distribution, and effective
analog count. Cluster distinct early-peak and late-rebound modes instead of
hiding them behind one median time.

For a 2026 live prediction, all completed compatible 2005-2025 days and earlier
completed 2026 days may be candidates. For a historical walk-forward target,
only archive dates that would already have been available at that historical
checkpoint may be selected. A target must never select a later year merely
because it is present in today's completed archive.

Evaluate every 15 minutes from roughly 09:00 through 18:00 KST against:

- the same calendar date in the prior year;
- seasonal median peak time;
- one nearest analog;
- top-k weighted analog ensemble;
- current KMA hourly peak window;
- the existing `rksi15l-remaining-ceiling-v2` live model; and
- the hybrid KMA/live/analog distribution.

Measure peak-time MAE, 50%/80% window coverage, already-peaked calibration and
Brier score, remaining-warming/final-maximum error, and false early-peak
declarations followed by rebounds, split by checkpoint and weather regime.

The analog model should initially be shadow-only. It may eventually widen or
narrow a displayed peak-time range, but it must not lower the existing
conservative `remainingRuleCeilingC`, independently produce
`unlikely_to_reach`, or declare the peak complete. Promotion into the combined
decision requires a walk-forward improvement over the current KMA/live
baselines without increasing false early-peak declarations.

## GK2A surface shortwave radiation

The numerical source for direct solar-heating input is the anonymously
reachable NMSC GK2A satellite viewer. Its requests do not require a KMA API Hub
account, API key, or browser-supplied credential. That technical reachability
does not establish reuse permission: the downloaded NetCDF's embedded license
says access is restricted to approved users, while KMA's copyright policy asks
users to consult KMA before using unmarked material. The production collector
therefore requires `NMSC_GK2A_ACCESS_APPROVED=true`, which must be set only
after NMSC confirms this automated use. Only the exact string `true` enables
collection; a missing or different value fails closed.

Approval activation is deliberately separate from code deployment:

```text
npx convex env set NMSC_GK2A_ACCESS_APPROVED true --prod
```

To disable subsequent manual and scheduled collection requests, remove the
flag:

```text
npx convex env remove NMSC_GK2A_ACCESS_APPROVED --prod
```

While disabled, the dashboard reports `approval required`, the manual request
returns `access_not_approved`, and the scheduled queue does not start metadata
or NetCDF requests. The protected initiating paths are
`seoulGk2aCollector:requestSolarHeatingRefresh`,
`seoulGk2aCollector:queueScheduledSolarHeatingRefresh`, and the compatibility
action `seoulGk2a:pollLatestSolarHeating`; the internal worker is
`seoulGk2aCollector:collectSolarHeating`. The protected write boundaries are
`seoulGk2aCollector:upsertAndPruneSolarObservations`,
`seoulGk2aCollector:writeCollectorStatus`, and the retained compatibility
mutations `seoulGk2a:upsertSolarObservations` and
`seoulGk2a:recordCollectorStatus`. The Node extraction action checks the
same flag before metadata discovery, again before download and extraction, and
the parent worker checks it after the Node action returns. The database upsert
mutations and collector-status mutations perform final independent checks
before inspecting or storing rows or protected frame metadata. Work queued just
before approval removal therefore discards any in-flight payload. The
decision-input query returns only local Haurwitz fields without querying
retained NMSC rows while disabled, and the separate prediction mutation
rechecks the flag before it can persist a supplied solar snapshot.

The ten-minute daylight collection cadence and the use of copied GK2A inputs
inside long-lived temperature-decision revisions are both part of the required
approval scope. Approval must cover automated retrieval at that cadence,
storage of the extracted/derived values and provenance, and their use and
display in the `rksi15l-remaining-ceiling-v2` decision. The flag remains
fail-closed at every protected entry point and immediately before NMSC work.
This implementation did **not** run either Convex environment command and did
not activate `NMSC_GK2A_ACCESS_APPROVED` in any environment.

The collector uses the viewer's own discovery, file-resolution, and download
requests:

```text
GET https://nmsc.kma.go.kr/enhome/json/satellite/viewer/selectSatViewer.do
  ?timezone=UTC
  &searchDate=YYYY-MM-DD
  &fileKey=GK2A:AMI:LE2:DSR:PNG:KO:020:LC

GET https://nmsc.kma.go.kr/enhome/json/satellite/viewer/selectNewSatFileList.do
  ?timeZone=UTC
  &fileKey=GK2A:AMI:LE2:DSR:PNG:KO:020:LC
  &startDate=YYYYMMDDHHmm
  &endDate=YYYYMMDDHHmm
  &etc=NC

GET https://nmsc.kma.go.kr/enhome/html/satellite/viewer/selectImgDown.do
  ?fileKey=GK2A:AMI:LE2:DSR:NC:KO:020:LC
  &observationTime=YYYYMMDDHHmm
  &type=NC
```

### How the keyless viewer flow was discovered

These are not documented KMA API Hub endpoints. They were found by observing
the requests made by NMSC's own public satellite viewer rather than by guessing
an API URL:

1. The NMSC product-definition page was searched first for the physical
   variable needed by the dashboard. Its shortwave-radiation entry identifies
   surface downward shortwave radiation as `DSR`, absorbed surface shortwave
   radiation as `ASR`, and identifies the Korea SWRAD filename family. The live
   resolver then showed the actual service-image name as
   `gk2a_ami_le2_swrad-dsr_ko020lc_YYYYMMDDhhmm.png` and the bundled numerical
   file as `gk2a_ami_le2_swrad_ko020lc_YYYYMMDDhhmm.nc`.
2. The public satellite viewer was opened with browser developer tools. In the
   Network panel, the log was preserved, the cache was disabled, and requests
   were filtered to Fetch/XHR and document downloads.
3. Selecting GK2A AMI Level 2 DSR, the Korea area, 2 km resolution, and the
   Lambert-conformal display exposed `selectSatViewer.do`. Moving the timeline
   showed that `data.fileList[]` contains `fileName`, `filePath`,
   `observationTime`, and the exact viewer `key`.
4. Choosing the NetCDF download exposed `selectNewSatFileList.do`. Its
   `data.fileList[0].NC` object supplies the numerical file's `name`, `path`,
   `size`, UTC/KST timestamps, and `key`. The newest PNG can be listed before
   its NetCDF is ready, so the collector resolves several recent candidates
   instead of assuming the newest image is immediately downloadable.
5. Clicking the resulting download exposed `selectImgDown.do`. Discovery and
   resolution use the PNG viewer key, while the binary download changes its
   representation segment to `NC` and sends `type=NC`.
6. The captured metadata requests were replayed in a clean HTTP client without
   cookies, an `Authorization` header, or an API key. This established
   technical keylessness only; it did not establish permission for automated
   use.
7. A one-off research download was validated by its bytes rather than by its
   filename or HTTP status. The `.nc` file begins with the HDF5 signature.
   Reading its structure exposed `DSR`, `ASR`, `DSR_DQF1`, `ASR_DQF1`, and
   `SW_DQF`, plus scale, offset, fill, projection, and license metadata. The
   product definition and SWRAD algorithm document were then used to confirm
   the variables' meaning, units, quality rules, range, cadence, and known
   limitations.

The captured viewer identifier is:

```text
GK2A:AMI:LE2:DSR:PNG:KO:020:LC
```

Its segments reflect the satellite, instrument, processing level, product,
representation, area, resolution, and projection selected in the viewer.
Treat the complete value as an opaque identifier captured from the current
viewer, not as a stable API contract or a value to construct from assumptions.
Also preserve parameter spelling: discovery uses `timezone`, while resolution
uses `timeZone`.

The executable version of this discovery chain, download validation, and
selected-dataset point extraction is
[`convex/seoulGk2aNode.js`](../convex/seoulGk2aNode.js).

### Repeating the search for another airport or product

SWRAD is a geographic grid, not an airport-specific endpoint. An airport inside
the existing Korea grid does not need a different discovery or download URL.
Use verified airport coordinates, generalize the collector's RKSI station
guard, project the point into the grid, and confirm that the resulting cell is
inside the documented coverage. A nearby known location should also be checked
to catch a reversed row, column, latitude, or longitude.

For an airport outside the Korea grid, or for another potentially useful GK2A
variable, repeat the source-discovery work instead of editing this `fileKey` by
hand:

1. Start with the current official product-definition page. Candidate airport
   products include cloud amount/type/layers, fog, surface temperature,
   precipitation, aerosols, cloud optical properties, and radiation, but their
   coverage and numerical availability differ.
2. Change one selector at a time in the public viewer and capture the exact
   resulting requests and `fileKey`. Check whether the required variable is
   actually offered for the Korea (`KO`), East Asia (`EA`), or full-disk
   domain; availability for one product does not imply availability for
   another.
3. Confirm that the resolver advertises an `NC` object. Do not assume that
   every displayed PNG has a downloadable numerical product.
4. Inspect a sample file's global attributes, embedded license, dimensions,
   projection, variables, units, `_FillValue`, `scale_factor`, `add_offset`,
   and quality flags. Do not reuse the 900-by-900 Korea grid constants or the
   SWRAD quality rules unless the new file and algorithm documentation confirm
   them.
5. Compare the viewer label, filename definition, NetCDF metadata, and
   algorithm document before assigning physical meaning to a field. Never
   infer numerical values from display-image colors merely because a NetCDF is
   unavailable.
6. Measure cadence, publication delay, file size, revisions, missing frames,
   and failure behavior with a short bounded probe. Use those observations to
   choose a narrow collection window, cooldown, timeout, dedupe key, and
   retention period rather than polling continuously.
7. Re-test captured requests without browser state, but treat a successful
   keyless request only as a technical finding. Review the current provider
   terms and the file's embedded license, identify the approval contact, and
   keep production access disabled behind a dedicated Convex approval
   environment variable until approval is documented.
8. Record the research date, response shapes, exact product key, coverage,
   coordinate/projection method, quality rules, approval source, and a known
   good sample in the new airport's source document.

When adding another provider, apply the same sequence: establish provenance,
observe the provider's own client requests, validate the raw payload and
semantics, measure real publication behavior, check permission, then implement
the smallest bounded collector. An alternative source must be evaluated and,
when necessary, approval-gated independently; it must not silently bypass the
primary source's approval gate.

Times in these requests are UTC. The first response discovers available
observation times, the second confirms the matching NetCDF file, and the third
downloads that file. A single SWRAD NetCDF contains the Korea-area grids needed
by the dashboard:

- `DSR`: surface downward shortwave radiation in W/m²;
- `ASR`: surface absorbed shortwave radiation in W/m².

KMA/NMSC documents the GK2A SWRAD product at approximately 2 km resolution and
a ten-minute production cadence. The official algorithm document gives DSR a
nominal 0–1500 W/m² range and describes daytime/high-zenith-angle limitations.
The collector converts RKSI and any wind-projected coordinates to the
900-by-900 Korea Lambert conformal grid, applies each dataset's scale and fill
metadata, and accepts DSR or ASR only when its product quality flag and the
shared solar-angle quality flag mark the cell usable. Missing, fill, nighttime,
or rejected cells remain unavailable rather than becoming zero radiation.

The downloaded NetCDF is a transient extraction artifact. The Node collector
writes it beneath an operating-system temporary directory, extracts the small
set of required grid cells, closes the HDF5 file, and removes the whole
temporary directory in a `finally` block on both success and failure. Convex
stores the extracted numerical samples and source metadata, not the raw
NetCDF.

After access approval, cron
`seoul_gk2a_solar_daylight_window` queues the collector every ten minutes at
UTC minutes `:06`, `:16`, `:26`, `:36`, `:46`, and `:56`. This matches the
ten-minute SWRAD product cadence while retaining the publication-delay offset.
The cron itself runs around the clock, but the shared server-side Haurwitz gate
returns `outside_collection_window` before queueing work whenever modeled
clear-sky DSR at RKSI is below 50 W/m². The manual `Refresh GK2A` path uses the
same approval, Haurwitz, cooldown, and lock checks. The worker also applies the
50 W/m² test to the resolved frame before storing it.

NMSC discovery is keyed by UTC date. Near UTC midnight the newest usable frame
can still belong to the preceding UTC date, so discovery now requests both the
current date and a time 30 minutes earlier when those dates differ, merges the
candidate lists by observation time, and resolves the newest distinct frames.
The recent-wind lookup likewise reads both the current and previous Seoul date,
preventing a local-midnight partition boundary from hiding the newest AMOS
wind.

The server permits at most one queue attempt per ten-minute UTC slot, so cron
jitter cannot accidentally skip a nominal product slot. It also skips a frame
already resolved even when its cells were unusable and permits only one
run-owned collection lock at a time. The optional
`seoulGk2aCollectorStatus.lastResolvedFrameTimeUtc` field persists that
resolved-frame checkpoint, including for an out-of-window frame, and is part of
the table's schema validator. That dedicated button is the only
client-triggered collection path; the page's initial load and combined
observation sync do not download the SWRAD NetCDF. Dashboard queries hide
numerical rows once they reach 48 hours, and a database-only cleanup runs every
30 minutes. Raw `seoulGk2aSolarObservations` therefore remain a 48-hour
operational window rather than a permanent satellite archive. When the v2
temperature decision consumes a solar sample, it copies the derived values,
source coordinates/file/grid provenance, quality flags, trend, upwind signal,
ETA, and wind used into the immutable prediction revision. Those compact
decision snapshots are retained with prediction history after the raw solar
rows expire.

The NetCDF does not provide the local clear-sky surface-DSR denominator used by
the panel. The dashboard therefore computes:

```text
estimated solar transmission = measured GK2A DSR / Haurwitz clear-sky GHI
```

The Haurwitz denominator uses the observation time and RKSI/point coordinates.
Ratios are withheld below 50 W/m² modeled clear-sky irradiance and outside a
0–200 percent plausibility guard. This is a useful operational signal, not a
calibrated atmospheric-transmission retrieval; clear-sky-model error can be
largest near sunrise/sunset and under unusual aerosol conditions.

The 30-minute change uses the closest valid stored sample within ±15 minutes of
the target. The recent direction uses the median of pairwise transmission
slopes across the latest hour, requiring at least three samples and 30 minutes
of coverage. A magnitude under five percentage points per hour is `steady`.

For upstream context, the collector reads the freshest representative 15L AMOS
average wind. At two knots or stronger and no more than 45 minutes old, it
projects points the surface wind would traverse in 20, 40, and 60 minutes and
extracts DSR/ASR for all of those locations from the same downloaded grid. A
median upstream transmission at least ten percentage points above RKSI is
`clearing`; ten points below is `cloudier`. The nearest qualifying projected
horizon supplies the displayed arrival estimate. Surface wind is only an
orientation/advection proxy and can differ substantially from motion at cloud
level.

After NMSC approves access, the viewer NetCDF is the only numerical GK2A
source. A discovery, download, validation, or extraction failure is recorded as
source failure; the collector does not fall back to the retired API Hub point
query, cloud-cover categories, or image-pixel estimates.

The optional image loop is independent of the numerical NetCDF collector.
KMA's public weather image service supplies recent two-minute Korea-area
`RGB cloud-enhanced` frames. `/api/seoul/gk2a-loop` assembles a 90-minute
window, exposes every other frame for a four-minute display cadence, validates
requested timestamps, and proxies only KMA-listed image paths. The browser
does not request the loop until the user expands it. This produces a lighter
visual loop while the NMSC SWRAD samples remain the numerical source of truth.

Official references:

- [NMSC public satellite viewer](https://nmsc.kma.go.kr/enhome/html/satellite/viewer/selectSatViewer.do)
- [NMSC GK2A product definitions](https://nmsc.kma.go.kr/homepage/html/base/cmm/selectPage.do?page=static.utilization.productDefinition)
- [NMSC SWRAD algorithm document](https://nmsc.kma.go.kr/resources/common/pdf/%EC%99%B8GK2A_L2_ATBD_%EA%B5%AD%EB%AC%B8_%EB%8B%A8%ED%8C%8C%EB%B3%B5%EC%82%AC_SWRAD.pdf)
- [NMSC access/application contact](https://nmsc.kma.go.kr/enhome/html/base/cmm/selectPage.do?page=static.utilization.reqStation)
- [KMA copyright and prior-consultation policy](https://www.kma.go.kr/kmadev/guide/copyright.jsp)
- [KMA public GK2A image viewer](https://www.weather.go.kr/w/image/sat.do)

## RKSI airport forecast capture and backend evaluation

### Canonical KMA/AMO source

The sole primary forecast source for the Seoul routes is KMA Aviation
Meteorological Office's RKSI airport page:

```text
https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI
```

The response identifies `RKSI` as Incheon International Airport, so it is not
the Seoul-city forecast that an address or coordinate lookup might return. It
is a server-rendered HTML page rather than a documented JSON API. The collector
parses the forecast values already present in that HTML: daily minimum and
maximum, and hourly KST rows with temperature, condition phrase/icon, ceiling,
wind, visibility, and crosswind fields when present. The page's
`.tm_issue_date` belongs to the current aerodrome-conditions header, so any
stored value from it is described only as the page/current-conditions reported
time, not as a forecast issue timestamp.

The parser reads the page's `ts-daily-item` and `ts-hourly-item` blocks. Daily
rows are keyed by date with short-term data preferred where short-term and
midterm overlap. Hourly `data-date`, `data-hour`, and `data-atemp` values are
converted from KST to explicit local and UTC timestamps. A response without at
least one usable daily min/max row and one usable hourly temperature row is a
parse error rather than a partial success.

The parser also reads the airport code displayed in the page's
`span.airport_spl` element and is called with expected station `RKSI`. A
missing or different displayed ICAO code is a provenance mismatch and fails
the attempt before successful storage. This prevents a redirect, default
airport, or changed page from being mislabeled as the requested RKSI forecast.
The Node HTTPS request uses only the fixed
`https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI` host and path, does not
follow redirects, and accepts only a successful HTML response, so a different
host cannot be followed and relabeled as AMO.

### TLS chain handling

As verified on 2026-07-29, `amo.kma.go.kr` sends its valid `*.kma.go.kr` leaf
certificate but omits the issuing `RapidSSL TLS RSA CA G1` intermediate from
the TLS handshake. Node therefore correctly fails to build the chain with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, while Windows clients may appear to work
because they retrieve or cache the certificate named by the leaf's AIA field.

The internal fetch worker runs in the Convex Node runtime and appends the exact
[DigiCert-published RapidSSL intermediate](https://cacerts.digicert.com/RapidSSLTLSRSACAG1.crt.pem)
to Node's normal root certificates for this request. Its SHA-256 fingerprint
is
`44:22:E9:63:EE:53:CD:58:CC:9F:85:CD:40:BF:5F:FE:C0:09:5F:DF:1A:15:45:35:66:1C:1C:06:BC:AD:C6:9B`.
Request-time validation checks that fingerprint, its CA identity, its issuer, its
signature against Node's trusted `DigiCert Global Root G2`, and the presence of
that trusted root. The request keeps `rejectUnauthorized: true`, default
hostname validation, and SNI for `amo.kma.go.kr`. It never disables TLS
verification, trusts a partial chain, follows a redirect, or downloads an AIA
certificate at runtime.

The bundled intermediate expires on 2027-11-02. Replace or remove the bundle
before then based on KMA's live chain; the preferred upstream resolution is
for KMA to serve the complete certificate chain.

KMA/AMO controls the canonical expected maximum and primary forecast curve:

- KMA's published daily maximum supplies the expected maximum. The only
  adjustment is an observed-data floor: once representative 15L AMOS has
  already exceeded the forecast, the displayed and stored expected maximum
  cannot be lower than reality.
- KMA's hourly temperatures supply the primary temperature curve. Peak-window
  decisions use every hour tied for the hottest KMA value, from the first tied
  hour through one forecast interval after the last tied hour.
- KMA's exact condition text, such as `Clear`, `Partly cloudy`,
  `Mostly cloudy`, or `Haze`, supplies coming-hour sky guidance. The displayed
  ceiling is a separate KMA value.

The application never converts those categories into invented cloud-cover
percentages. In particular, `Mostly cloudy` is not stored or displayed as an
assumed percentage, `Haze` does not imply a cloud amount, and a ceiling height
does not describe total cloud cover.

Weather.com remains collected only as a conspicuously labeled **secondary
comparison**. Its daily high, hourly temperatures, phrases, and cloud-cover
percentages may support secondary history and diagnostics, but its prediction
weight is zero. Weather.com never supplies or fills a missing KMA daily
maximum, primary hourly curve, expected current temperature, peak time,
condition, or ceiling, and it is never blended with KMA. A fresh Weather.com
remaining high at or above the target is only a conservative veto against the
strongest threshold decision. This is the same source hierarchy used by the
Wellington research: an official aviation source stays canonical while
Weather.com remains an unofficial helper.

### Remaining-temperature ceiling v2

The current deterministic decision model is
`rksi15l-remaining-ceiling-v2`. It answers the raw representative 15L AMOS
question “will the series still reach the selected target?” The target is an
exact raw-tenths Celsius value, not a whole-degree display threshold. For
example, raw `27.0°C` and the approximately `26.5°C` value that may round to a
whole-number display of 27 are deliberately separate prediction problems.

Targets are normalized on the server to one decimal place and must be between
`-20.0°C` and `45.0°C`, inclusive. The normal page mode captures KMA's current
published daily high as a stable target value for the selected date; later
reactive KMA revisions do not silently move that in-memory selection. `Use KMA
published high` explicitly captures the currently displayed KMA value again.
`Next +0.1°C` captures the current raw observed high plus `0.1°C` once, and the
custom form accepts another fixed raw Celsius target. The page temperature-unit
toggle does not change the custom input unit. A target remains fixed until the
user applies or captures another one.

The model keeps two outputs separate:

1. **Expected daily maximum** (`predictedHighC`) remains the larger of the KMA
   published daily maximum and the observed raw 15L high.
2. **Remaining rule ceiling** (`remainingRuleCeilingC`) is the conservative
   threshold-decision value. It is a transparent policy ceiling, not a
   guaranteed physical bound or calibrated confidence interval.

The v2 decision does not store the former heuristic band as a statistical
confidence interval. It reports the rule ceiling, margin below the selected
target, blocker codes and descriptions, freshness, and confirmation count
instead.

#### Observed features and KMA adjustment

The raw one-minute 15L series determines whether the selected target was
reached and the day's observed high. Trend calculations use these
deterministic features:

- `currentSmoothedC` is the median of the latest three valid temperatures;
- `lastNearHighAtUtc` is the latest row within 0.1°C of the raw observed high,
  so a re-tied plateau is not mistaken for an old peak;
- `dropFromHighC` and `minutesSinceNearHigh` measure separation from that
  plateau; and
- the 15-, 30-, and 60-minute slopes are medians of all pairwise temperature
  slopes whose endpoints are separated by at least the smaller of ten minutes
  or one quarter of the requested window.

Each robust slope needs at least four rows, valid observations in minute buckets
covering at least 75 percent of its requested window, and no gap greater than
five minutes at the latest edge. Counting represented minute buckets rather
than only the first-to-last span prevents two sparse clusters around a long
outage from passing. The trailing-hour decision additionally requires at least
45 represented minutes. Slopes retain their full raw median precision for
blocker comparisons and are rounded only for presentation.

For every usable 15L observation in the previous hour, the model interpolates
the KMA hourly curve and forms `observed - KMA`. The live bias is the median of
those residuals, requires at least three matched values spanning 30 minutes of
matched (not merely observed) coverage, and is clipped to -1.5…+1.5°C. A
missing usable bias is a critical
data blocker rather than an assumed cool adjustment.

For forecast hour `h`, the signed bias used by the best estimate decays linearly
to zero over three hours. The conservative forecast upper applies only a
positive bias and adds a 0.7°C policy allowance:

```text
best(h)  = KMA(h) + bias * max(0, 1 - hoursAhead / 3)
upper(h) = KMA(h) + max(0, bias) * max(0, 1 - hoursAhead / 3) + 0.7°C
```

The 0.7°C consists of the initial KMA integer-resolution and operational/sensor
allowance; it has not been statistically calibrated. Future points stop at the
next Seoul-local midnight. The short-term continuation ceiling is:

```text
nowcast upper = current smoothed temperature
              + min(1.0°C, 0.5 * max(0, slope15, slope30))
              + 0.2°C
```

Slopes are in °C/hour, so the `0.5` term represents 30 minutes of continued
warming. The final rule ceiling is the maximum of the raw observed high, KMA
remaining upper, and nowcast upper, rounded upward to the next tenth. A cool
live departure can lower the best estimate but cannot lower the conservative
upper.

The KMA peak window is `[first tied peak, last tied peak + forecast interval)`.
The interval is the median valid spacing between KMA hours, with one hour as a
fallback. Even after that complete tied window ends, a further 30-minute safety
lag must pass before confirmation can begin.

#### Freshness and blocker rules

Critical input blockers produce `insufficient_data`:

| Code                                                                                     | Exact starting rule                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `amos_missing` / `amos_stale`                                                            | No 15L temperature, or latest row older than 3 minutes                         |
| `amos_coverage_weak`                                                                     | Less than 45 minutes represented in the trailing hour                          |
| `amos_recent_gap`                                                                        | Latest edge gap is missing or greater than 5 minutes                           |
| `amos_trend_15m_unavailable`, `amos_trend_30m_unavailable`, `amos_trend_60m_unavailable` | The corresponding robust slope fails its coverage/sample/gap requirements      |
| `kma_stale`                                                                              | KMA capture missing or older than 90 minutes                                   |
| `kma_peak_window_unavailable`                                                            | Complete tied KMA peak window cannot be calculated                             |
| `kma_live_bias_unavailable`                                                              | Fewer than three matched residuals or less than 30 minutes of matched coverage |
| `kma_hourly_curve_incomplete`                                                            | Hourly guidance is sparse, has no future point, or does not cover day end      |
| `kma_daily_hourly_inconsistent`                                                          | Published daily high exceeds the captured hourly maximum by more than 0.7°C    |
| `rule_ceiling_unavailable`                                                               | A remaining rule ceiling cannot be calculated                                  |

With critical inputs available, any of these rebound blockers keeps the result
at `still_possible`:

| Code                                                                     | Exact starting rule                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `kma_peak_window_active`                                                 | Last tied KMA peak interval plus 30 minutes has not ended                                                            |
| `kma_revised_upward`                                                     | A new KMA capture raises daily, future hourly, or remaining-upper guidance; confirmation resets immediately          |
| `recent_warming_or_flat`                                                 | 15-minute slope is greater than -0.2°C/hour                                                                          |
| `medium_trend_not_cooling`                                               | 30-minute slope is greater than -0.1°C/hour                                                                          |
| `hour_trend_positive`                                                    | 60-minute slope is greater than 0°C/hour                                                                             |
| `still_near_observed_high`                                               | Smoothed current value is less than 0.2°C below the high                                                             |
| `recent_high_or_retie`                                                   | A value within 0.1°C of the high occurred less than 30 minutes ago                                                   |
| `solar_inputs_unavailable`                                               | The solar decision query failed                                                                                      |
| `solar_approval_required`                                                | Useful modeled solar energy remains but NMSC approval is not active                                                  |
| `solar_observation_unavailable`                                          | While useful energy remains, GK2A is older than 30 minutes or fails quality checks                                   |
| `solar_transmission_increasing` / `solar_transmission_trend_unavailable` | Transmission is increasing or lacks the required history                                                             |
| `solar_upwind_clearing`                                                  | Upwind GK2A transmission indicates clearing, with its projected ETA retained                                         |
| `solar_dsr_trend_unavailable` / `solar_dsr_rising`                       | A 20–30-minute DSR comparison is absent or DSR increased                                                             |
| `clear_sky_irradiance_rising`                                            | Haurwitz clear-sky DSR is still increasing                                                                           |
| `secondary_16l_warming`                                                  | Fresh 16L is warming while 15L meets its cooling threshold                                                           |
| `secondary_16l_near_target`                                              | Fresh 16L is within 0.3°C of, or above, the selected target                                                          |
| `secondary_16l_divergence_changing`                                      | Absolute 15L–16L difference change reaches 0.4°C in 30 minutes                                                       |
| `recent_wind_shift` / `forecast_wind_shift`                              | Observed 30-minute or forecast next-two-hour direction change exceeds 45°                                            |
| `recent_wind_speed_change` / `forecast_wind_speed_change`                | Absolute speed change reaches 5 kt                                                                                   |
| `dewpoint_rising_with_wind_shift`                                        | Dew point rises at least 0.5°C with an observed or forecast direction shift                                          |
| `rain_ended_with_clearing`                                               | Rain occurred in the prior hour, up to the five latest precipitation rows are dry, and KMA or GK2A suggests clearing |
| `secondary_forecast_reaches_target`                                      | Weather.com capture is no older than 90 minutes and its remaining guidance reaches the selected target               |
| `temperature_rebounded`                                                  | During a candidate/confirmed state, smoothed 15L rises at least 0.2°C from the prior decision                        |

The solar blockers are removed once current Haurwitz clear-sky DSR is below
50 W/m². Radiation is used only as a rebound veto; the model does not convert
DSR into degrees Celsius. The 16L checks apply only when its latest observation
is no older than three minutes. The 16L designation is airport-wide
corroboration, not proof of an upwind sensor location.

Even with no blocker, the result remains `still_possible` whenever the rule
ceiling is at or above the selected target. A raw observed high at or above
that target immediately produces `already_reached`. This is normal even early
in the day: `already_reached` describes the threshold, not whether the KMA
forecast maximum has been reached.

#### Confirmation state, immutable snapshots, and evaluation

`seoulPeakDecisionState` is the small mutable row keyed by station, date, model
version, and target. It stores the candidate start, consecutive-pass count,
last five-minute evaluation slot, last rule ceiling/current smoothed value,
the last evaluated KMA capture/daily high/upper ceiling/hourly curve, the
locally modeled `solarDecisionRequired` flag, current state, blockers, and
latest immutable prediction ID. Keeping the KMA baseline in this mutable row
means even a non-material downward capture becomes the comparison point for
the next upward-revision veto. Repeated work in
the same slot cannot increment confirmation. Only exactly consecutive
five-minute slots continue a candidate; a gap or failed rule resets it.
Changing the target selects a different mutable row and immutable prediction
lineage. Candidate time, pass count, `already_reached`, and KMA-revision
baseline never carry between targets. Returning to a previously used target
after one or more missed five-minute slots restarts its confirmation rather
than resuming a stale candidate.

The states are `already_reached`, `insufficient_data`, `still_possible`,
`peak_candidate`, `unlikely_to_reach`, and completed-day `final`. The first
fully passing evaluation starts `peak_candidate` and the 15-minute clock at
zero completed follow-up checks. The next three exactly consecutive
five-minute slots advance the count to three; only the third follow-up, at
least 15 elapsed minutes after candidate start, can produce
`unlikely_to_reach`. Any new blocker, upward KMA revision, rule ceiling at or
above the target, target observation, or qualifying rebound revokes the
passing state immediately.

Every evaluation updates the mutable row even when no immutable revision is
needed. `seoulHighPredictions` stores a new v2 revision for material changes to
the expected maximum, decision state, ceiling or target margin, or blocker
codes/descriptions. A change in whether useful solar energy still requires
GK2A evidence is also material because it controls revocation behavior.
Intermediate follow-up counts and the current KMA comparison baseline therefore live only in the
mutable row; the third follow-up creates an immutable revision because the
state changes to `unlikely_to_reach`. There is no heartbeat-only revision. Each revision copies
the derived solar values and source/QC provenance, 16L corroboration, AMOS
wind/dew-point/precipitation diagnostics, Weather.com veto high and age,
target, margin, and all ceiling components. This makes the decision auditable
after the 48-hour raw GK2A rows are pruned.

Current prediction reads use `by_station_date_model_target_revision`; mutable
state uses `by_station_date_model_target`; completed evaluations use their
model-aware target/date and target/finalization indexes. Revision numbers,
`previousPredictionId`, material-change comparisons, and dashboard history are
therefore scoped to one exact normalized target. V1 rows remain stored but are
not mixed with `rksi15l-remaining-ceiling-v2` history or accuracy.

`seoulPeakActiveTargets` is the bounded registry used by unattended
evaluation. Selecting or applying a target registers it for the station, date,
and model. The day page also initializes the current KMA high and the current
observed-high-plus-`0.1°C` semantic targets when those values change. The
five-minute cron always evaluates the legacy-compatible `27.0°C` target plus up
to eight registered custom targets for the current Seoul date; registering
`27.0°C` does not consume a custom slot. When a ninth distinct selected or
automatic target is registered, the least-recently-selected registry entry
retires from recurring checks. Its prediction and decision history remain
stored. This rolling bound prevents an unauthenticated target input from
creating unlimited recurring work without rejecting the newly selected target.
The browser initializes each exact target once; the cron—not an open browser—is
what keeps registered confirmation states advancing.

At `00:10 KST`, finalization enumerates every target-specific mutable decision
state stored for the completed date, with `27.0°C` as the compatibility
fallback only when no states exist. Within each exact target lineage it finds transitions into
`unlikely_to_reach` and scans later raw 15L rows. A declaration is false when
15L subsequently reaches that lineage's target. A declaration with no later
target is counted as correct only when the future 15L series continues to
Seoul midnight without a gap greater than three minutes; otherwise it is
censored and excluded from the false-declaration-rate denominator. A later
target observation remains conclusively false even if a subsequent outage
occurs. One `seoulHighEvaluations` row is stored per station, date, model, and
target; finalizing one target cannot finalize or suppress another. Accuracy
queries and false-declaration aggregates require an exact target and never mix
the outcomes of different thresholds. Each evaluation stores the first
declaration and its rule ceiling/future high/margin, whether and when the
target was later reached, the first correct declaration, observation-coverage
diagnostics, and total, evaluated, censored, revocation, and
false-declaration counts. Historical v2 decisions cannot be honestly
backfilled where their GK2A inputs were never retained.

NMSC revocation also applies at every prediction read boundary, including the
public recompute response. Copied `solar*` fields, GK2A-derived blocker text and
non-prefixed clearing-risk fields are removed for every state. A stored
candidate or confirmed result is downgraded only when its persisted local
`solarDecisionRequired` flag says useful solar energy remained; a post-sunset
low-solar decision remains valid. NMSC-backed finalization and accuracy reads
are hidden until approval is active again.

Nearby upwind **surface temperature**, dew point, and wind ingest is not
implemented. GK2A's upwind samples describe incoming radiation/cloudiness only.
A surface source must first be selected, its station provenance and wind-sector
selection validated, and any required provider/data-owner approval obtained
and separately fail-closed before it can become a blocker or supporting input.

### Approval gate

The KMA/AMO page is technically reachable without a key, login, or credential.
That reachability is not authorization for automated production reuse. KMA's
copyright policy says material without an applicable public-use mark requires
prior consultation, so production collection fails closed behind the
server-side Convex value:

```text
KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED=true
```

Only the exact string `true` enables the protected work. Missing, empty,
`false`, or any other value is not approval. The approving authority is KMA,
AMO, or the relevant KMA data/content owner, and the approval must explicitly
cover automated production retrieval, parsing, storage, and display of the
English RKSI airport forecast page. The flag is deliberately separate from
credentials and from the independent NMSC GK2A approval.

KMA's [copyright-policy page](https://www.kma.go.kr/kmadev/guide/copyright.jsp)
lists the **Information and Communications Technology Division,
02-2181-0432** as its copyright contact. Recheck that official page for the
current office and number immediately before requesting approval, since
contact details can change.

Code, schema, and schedule are deployed with this flag absent. After the
appropriate authority grants that scope, activate production separately:

```text
npx convex env set KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED true --prod
```

Removing the flag disables new protected requests:

```text
npx convex env remove KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED --prod
```

Every protected entry point uses the same current flag:

- `seoulKmaForecast:requestAirportForecastRefresh` is the public manual queue
  mutation used by the Seoul-page button. It checks approval and an atomic
  per-station cooldown/lock before it can schedule work; it never fetches AMO
  directly.
- `seoulKmaForecast:queueScheduledAirportForecastRefresh` is the internal
  mutation invoked by cron
  `seoul_kma_amo_airport_forecast_every_30_min` at minutes `:05` and `:35`.
  It uses the same queue as manual requests.
- `seoulKmaForecastNode:collectQueuedAirportForecast` is the internal-only Node fetch
  worker. `seoulKmaForecast:claimQueuedAirportForecast` atomically verifies its
  run ID immediately before protected work, and
  `seoulKmaForecast:writeCollectorStatus` clears its run-owned lock.
- `seoulKmaForecast:storeForecastCapture` is the internal storage mutation.
- `seoulWeather:recomputeTodayHighPrediction` accepts either one normalized
  target or an interactive batch of up to three.
  `seoulWeather:registerActiveHighPredictionTargetsInternal` is the separately
  approval-gated atomic registration write that protects the whole requested
  batch from LRU eviction. The action reuses one solar snapshot while
  `seoulWeather:recomputeHighPredictionInternal` creates each current
  KMA-primary prediction revision. Registered current-day targets continue on
  the five-minute server schedule.
- `seoulWeather:finalizeCompletedDay` and
  `seoulWeather:finalizeHighPredictionInternal` create completed-day
  evaluations.
- `seoulWeather:getHighPredictionDashboard`,
  `seoulWeather:getHighPredictionDecisionSummaries`,
  `seoulWeather:getDayPageWeather`, and
  `seoulWeather:getHighPredictionAccuracy` are the protected read surfaces.

The public/manual and scheduled queue mutations check the flag before writing
queue state or scheduling work. The internal worker checks it again when it
begins, immediately before the outbound request, after the response,
immediately before storage, and again inside the storage mutation. The prediction,
finalization, dashboard, day-weather, and accuracy boundaries also check the
current flag and do not expose or derive from stored protected KMA rows after
revocation. While disabled, a manual queue request returns
`approval_required` without writing queue state, scheduling a worker, or
contacting AMO. A worker already queued when approval is revoked records only
the metadata-only `approval_required` attempt and stores no daily or hourly
forecast rows. The UI says approval or setup is required. Observed AMOS and
METAR values remain visible, but every KMA forecast field is unavailable;
Weather.com does not silently replace it.

Manual and scheduled requests share a ten-minute minimum interval and a
15-minute stale-lock timeout in the singleton
`seoulKmaForecastCollectorStatus` row for RKSI. The queue transaction returns
`queued`, `already_running`, `cooldown`, or `approval_required`, so repeated
clicks, concurrent tabs, direct Convex callers, and a cron arriving beside a
manual click cannot create unbounded upstream requests. Each queued run owns a
run ID; only that run may clear its lock or publish its final collector status.
The internal worker must atomically claim that still-current run ID before any
fetch or storage, so a delayed worker superseded after the stale-lock timeout
exits without contacting AMO.
Because the public route is unauthenticated, a caller can deliberately consume
the one global slot every ten minutes, for a hard ceiling of 144 KMA requests
per day; a scheduled attempt inside that cooldown is skipped. Provider
approval must therefore cover public manual initiation and that maximum
request cadence, not only the twice-hourly cron.
Approval record: on 2026-07-29, the project owner confirmed that KMA/AMO
approved the production RKSI integration for public on-demand initiation at
the documented global limit of one request per ten minutes, in addition to the
scheduled collection. No private approval correspondence or credentials are
stored in the repository.
The maximum-outlook header exposes this path as `Collect KMA now` on current
and future forecast dates, reports queued/success/error state, and shows the
remaining cooldown. Historical dates omit it because the current AMO page
cannot backfill an archived forecast.

### Capture and provenance

Each attempt creates an immutable `seoulKmaForecastCaptures` document with its
`manual` or `scheduled` trigger, source URL, status (`ok`, `error`, or
`approval_required`), capture/creation times, and, when applicable, HTTP
status, content type, response byte count, ETag, Last-Modified value, parsed
daily rows, parsed hourly rows, or a bounded error. A
page/current-conditions reported time may also be retained, but is not given
forecast-issue semantics. Captures preserve provider revisions instead of
updating one mutable forecast in place.

The request uses a 15-second abort timeout. The parser reads the response in
memory and stores only normalized fields; the raw HTML is not retained.

The source URL and provider identity live on the enclosing capture. Daily and
hourly array entries do not have independent row-level source tags. Consumers
must therefore retain their parent-capture provenance and must not detach a row
and relabel it as a mixed, Weather.com, or generic model forecast.
The canonical daily maximum, hourly curve, conditions, ceiling values, peak
time, and capture timestamp always come from one coherent successful page
response. KMA hours are not reconstructed across revisions; a missing hour
stays missing rather than being carried forward with a newer capture time.

The backend stores target-specific numbered high-prediction revisions for
historical retention and evaluation. Current revisions use
`rksi15l-remaining-ceiling-v2`, with KMA weight `1` and Weather.com weight `0`.
A KMA capture is available to the general forecast display only when approval
is active, it is no more than six hours old, and it has both a daily maximum
and hourly temperature for the target date; the stronger threshold decision
separately blocks once that capture is older than 90 minutes.

At `00:10 KST` the completed day is finalized against the canonical
representative 15L series. One-minute rows win when duplicate timestamps also
have five-minute or legacy captures. The first occurrence remains the stored
time of the actual maximum, while v2 separately stores the last observation
within 0.1°C of that high for plateau/re-tie logic. Evaluations and prediction
queries select the exact model version and normalized target, keeping v1,
other legacy rows, and other threshold histories out of the selected v2
lineage. Expected-high and peak-window checkpoint diagnostics at `09:00`,
`12:00`, and `15:00 KST` remain available alongside the target-specific
false-declaration metrics; the closing expected-high tracker has already
absorbed live observations and is not independent forecast skill.

Relevant policy and source pages:

- [KMA/AMO RKSI airport forecast](https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI)
- [KMA copyright and prior-consultation policy](https://www.kma.go.kr/kmadev/guide/copyright.jsp)
- [Wellington official-versus-secondary source precedent](./nzwn-preflight-notes.md)

## Ranked findings

| Order | Source                               | Granularity | Authentication | Observed freshness                                                         | Verdict                                                                          |
| ----: | ------------------------------------ | ----------: | -------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
|     1 | AMO mobile `amos_info.do`            |    1 minute | None           | New minute appeared about 14-16 seconds after the minute in measured tests | Fastest practical machine feed measured; official host but undocumented contract |
|    1b | AMO public AMOS HTML                 |    1 minute | None           | New minute appeared roughly 12-17 seconds after the minute in two tests    | Effectively tied within the small sample, but HTML parsing is more brittle       |
|   TBD | KMA API Hub AMOS `amos.php`          |    1 minute | KMA key        | Not yet measurable without a key                                           | Preferred supported API; race it against the two no-key feeds                    |
|     2 | KMA Weather station 113 web JSON     |    1 minute | None           | About 5-6 minutes behind during the live comparison                        | Official fallback, not a speed winner                                            |
|     3 | AviationWeather.gov API / NOAA tgftp |  30 minutes | None           | About 4m20s-4m45s after the nominal METAR time over a 12-hour sample       | Good supported METAR access, not current sensor temperature                      |
|     4 | KMA WIS2 METAR                       |  30 minutes | None           | About 5m10s after nominal time in the sampled cycles                       | KMA-origin audit/backup feed; it did not beat AWC                                |

The observed timings are small live samples, not provider SLAs. They should be
retested over at least 24-48 hours before making a hard latency guarantee.

## 1. Fastest measured: AMO mobile AMOS JSON

Endpoint:

```text
https://global.amo.go.kr/mobileApi/global_api/v1/amos_info.do?air_code=RKSI
```

Live behavior on 2026-07-27 KST:

- HTTP 200 JSON, no login or cookies required.
- `Cache-Control: no-store, no-cache, max-age=0`.
- Twelve rows were returned: runway ends and midpoint rows for the two runway
  complexes.
- All rows carried the current minute in `tm_fc`.
- Measured minute rollovers became visible approximately 14-16 seconds after
  the minute.
- Typical request time from this environment was about 1-1.5 seconds.
- At 10:04 KST this feed already held 10:04 data while KMA Weather's station
  113 web feed still held 09:59 data.

Example fields:

```text
tm_fc, rwy_dir, rwy_use, rwy_main, temp, dewpoint,
qnh_hpa, qnh_inhg, wd_avg, ws_avg, mor, rvr, rn
```

This endpoint is queried by both `pollLatestAmosTemperatureSites` and
`pollLatestAmosRunways` in [`convex/seoul.js`](../convex/seoul.js). The targeted
collector starts a bounded rollover watch at second `:12` and stores the two
temperature-site rows as soon as the new minute appears. The full collector
retains cadence-tagged display rows every five minutes for auditing. A request
exactly at `:00` will normally see the previous minute because the tested
publication boundary was near `:15`.

Risks:

- It is on an official AMO production host, but it is an undocumented
  mobile-application endpoint.
- There is no published schema, rate limit, availability commitment, or CORS
  contract.
- It returns multiple runway-position readings. Preserve the rows and their
  runway metadata instead of silently averaging them into one airport value.

## 2. Supported target: KMA API Hub minute AMOS

Official documentation:

- [KMA API Hub: AMOS every-minute API](https://apihub.kma.go.kr/apiList.do?apiMov=%EA%B8%B0%EC%83%81%EC%B2%AD%20AMOS%20%EB%A7%A4%EB%B6%84%EC%9E%90%EB%A3%8C%20%EC%A1%B0%ED%9A%8C&seqApi=14&seqApiSub=259)
- [KMA API Hub usage and key limits](https://apihub.kma.go.kr/apiInfo.do)
- [Public Data Portal listing](https://www.data.go.kr/data/15139484/openapi.do?recommendDataYn=Y)

Request:

```text
https://apihub.kma.go.kr/api/typ01/url/amos.php
  ?dtm=5
  &stn=113
  &help=0
  &authKey=KEY
```

Parameters and fields:

- Omit `tm` to request the current time, or pass `YYYYMMDDHHmm` in KST.
- `dtm` is the lookback in minutes, with a maximum of 60.
- `stn=113` selects Incheon Airport.
- `TM` is observation time.
- `TA` is temperature at 0.1 °C resolution.
- Other fields include dew point, humidity, pressure, rain, visibility, and
  two- and ten-minute wind values.

KMA describes this as real-time data produced at minute, hourly, and daily
cadences. General accounts are automatically approved for up to 20,000 calls
per day and 5 GB per day; one request a minute is only 1,440 calls per day.

This should be the primary production source if its measured publication time
is competitive with `amos_info.do`. It has a documented contract and a formal
key, while the mobile JSON is best retained as a speed comparator or fallback.

## Which temperature should represent RKSI?

### Is there a live 15L temperature sensor?

**Yes, with a labeling caveat.** KMA's current equipment inventory lists a
primary temperature/humidity sensor (`온·습도`) under Incheon runway 2's
**15L** position. It also lists a primary temperature/humidity sensor under
runway 3's **16L** position; runway 4 has none. The inventory assigns the sensor
to the 15L runway position, but does not provide coordinates or establish that
the thermometer is physically at the 15L threshold.

The same equipment manual, section 2.1.3.6.1, requires a temperature/humidity
sensor to be installed at a location representative of the airport, 1.25-2 m
above the ground in a radiation shield. Section 2.1.3.6.2 says to minimize local
effects from buildings, aircraft exhaust, and wake. Thus "15L sensor" means the
representative AMOS sensor assigned to the 15L site, not a probe on the runway
pavement.

The mobile JSON does not preserve that provenance cleanly. In four live probes:

| KST minute | Every populated runway 1/2 row | Every runway 3/4 row |
| ---------- | -----------------------------: | -------------------: |
| 10:38      |                        29.3 °C |              28.9 °C |
| 10:39      |                        29.5 °C |              28.7 °C |
| 10:41      |                        29.5 °C |              28.9 °C |
| 10:42      |                        29.4 °C |              28.9 °C |

Wind and sometimes QNH still varied by runway direction. This shows that
`amos_info.do` flattens each temperature onto several display rows rather than
reporting a separate thermometer for each `rwy_dir`.

KMA's aviation-observation manual separately says that the representative AMOS
value is used in METAR/SPECI and names **15L as Incheon's representative
runway**. Therefore:

1. Prefer `rwy_dir=15L` for the canonical METAR-comparison series.
2. Label it **"RKSI representative AMOS temperature (15L designation)"** or
   **"runway-2 AMOS temperature"**, not "temperature measured at the 15L
   threshold."
3. Preserve all raw rows and `rwy_main` metadata so the selection is auditable.
4. Do not average the 15L and 16L series unless the product intentionally wants
   a synthetic airport-wide value.
5. Compare the 15L tenths value with the later whole-degree METAR temperature
   to verify the operational rounding behavior.

Sources:

- [KMA/AMO Aviation Meteorological Observation Equipment Manual (2026), page 63](https://amo.kma.go.kr/servlet/kamaboard?bid=lawinfo&callback=https%3A%2F%2Famo.kma.go.kr%2Finformation%2Flaw.do&fno=2&k=ATC202601091506552_06Ocf7Wsj6gVfIJEl1rv.pdf&mode=download&num=142&ses=)
- [KMA/AMO Manual for Aviation Meteorological Observation](https://amo.kma.go.kr/information/law.do?bid=lawinfo&mode=view&num=124&page=1&field=&text=),
  sections 1.7.4 and 5.3.6.1

## Other official paths tested

### Public AMOS HTML

```text
GET  https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do
POST https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do
     stnId=113
```

The [public AMOS display](https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do)
is server-rendered and works without a key. It includes a KST minute stamp,
runway data, 0.1 °C temperatures, and the current raw METAR. Its own JavaScript
refreshes every 50 seconds, but a server-side poll can observe it sooner. Two
tested rollovers appeared roughly 12-17 seconds after the minute.

This is a useful independent fallback for the mobile JSON. It is less convenient
because HTML structure can change and the page exposes two temperature blocks
rather than one clean canonical field.

### KMA Weather station 113 JSON

```text
https://www.weather.go.kr/w/observation/land/aws-obs-data.do
  ?db=MINDB_01M
  &tm=
  &stnId=113
  &sidoCode=2800000000
  &sort=
  &config=full
```

Station 113 is `인천(공)` / Incheon Airport, not station 112 (`인천`, the city
station). This endpoint is official and no-key, but it was consistently about
5-6 minutes behind the mobile AMOS feed in the live comparison.

The KMA Open Data Portal also confirms that AMOS minute data contains
temperature, wind, precipitation, and visibility measured by equipment:
[KMA AMOS data portal](https://data.kma.go.kr/data/air/selectAmosRltmList.do).
Its interactive/CSV interface is more useful for history than low-latency
polling.

### AMO station card and MET REPORT

AMO also exposes:

```text
GET https://global.amo.go.kr/mobileApi/global_api/v1/airport_weather.do?air_code=RKSI
```

That station card follows the half-hour observation product rather than the
one-minute sensors. A boundary test also showed an early value being revised
under the same timestamp, so consumers must upsert rather than treat the first
value as final.

MET REPORT is a local aerodrome report, not a faster continuous-temperature
feed. KMA's manual says RKSI routine METAR and MET REPORT observations are made
every 30 minutes. RKSI omits routine-between-report SPECI because it already
uses that 30-minute schedule. MET REPORT can be operationally richer, but it
does not beat minute AMOS for current temperature.

### AWC API versus NOAA tgftp

The supported AWC query is:

```text
https://aviationweather.gov/api/data/metar?ids=RKSI&format=json
```

In a 12-hour, 24-report sample, AWC `receiptTime` was approximately 4m20s-4m45s
after each nominal RKSI report time. For one 00:30Z report:

- AWC receipt time: 00:34:28Z.
- NOAA tgftp `Last-Modified`: 00:34:27Z.
- Both carried the same 00:30Z METAR.

AWC is a cleaner supported interface, but it was not materially faster than
tgftp in this test. It should be treated as the robust global METAR path, not as
a source of live sensor temperature.

Source: [Aviation Weather Center Data API](https://aviationweather.gov/data/api/).

### KMA WIS2

KMA publishes aviation METAR bulletins through its public WIS2 node:

```text
origin/a/wis2/kr-kma/data/core/weather/aviation/metar
```

The OGC collection can also be queried at:

```text
https://wis2box.kma.go.kr/oapi/collections/messages/items
  ?f=json
  &limit=20
  &metadata_id=urn:wmo:md:kr-kma:core.aviation.metar
  &sortby=-pubtime
```

The decoded WMO bulletin contained RKSI. The sampled 00:30Z report had a WIS2
publication time of 00:35:11Z, 43 seconds after AWC received the same report.
Several cycles showed the same approximate `:05:10` / `:35:10` pattern. WIS2 is
valuable as a KMA-origin backup or audit trail, but it did not win the latency
race, and this KMA node did not advertise the minute AMOS dataset.

Source: [KMA WIS2 node](https://wis2box.kma.go.kr/).

### Other relays and commercial APIs

No additional public METAR mirror beat AWC/NOAA in the controlled 01:00Z cycle:

- [MET Norway Tafmetar](https://api.met.no/weatherapi/tafmetar/1.0/documentation)
  first exposed `270100Z` at about 01:07:18Z, roughly 2m52s after AWC. It is a
  useful genuinely independent public fallback, subject to MET Norway's
  User-Agent, caching, and attribution requirements.
- [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/info/datasets/metar.html)
  generated its RKSI result at 01:05:15Z, at least 49 seconds after AWC.
  IEM documents that its real-time METAR path is mainly NOAAPort and that the
  distribution round trip itself adds minutes.
- CheckWX is the only opaque commercial API that still seems worth a trial
  benchmark. It claims rapid publication after it receives a report, but does
  not disclose the upstream source or an ingest timestamp, so there is no
  evidence yet that it can win.
- VATSIM allowed a ten-minute cache, while Ogimet, AVWX, MetarCentral, and MADIS
  ultimately depended on AMO/NOAA or slower polling. None offered a new
  source-adjacent path.
- Generic "current weather" providers were excluded. Their value may be a
  blended model, nearby station, or private sensor rather than the exact RKSI
  instrument, and most do not expose both observation and first-ingest times.

These relays are potential resilience sources, not competitors to one-minute
AMOS for current temperature.

### ATIS: the remaining source-adjacent experiment

The Korean eAIP lists RKSI H24 ATIS, including telephone ARS
`+82-32-743-2676`, and ATIS carries temperature, dew point, and QNH. A timed
phone capture around `:00` and `:30` is the only untested path found that might
beat international METAR distribution for the new official report:
[RKSI eAIP](https://aim.koca.go.kr/eaipPub/Package/2026-01-08/html/eAIP/KR-AD-2.RKSI-en-GB.html?ver=20250728).

This would not beat AMOS as a continuously current sensor feed, and the eAIP
marks the telephone service as reference-only. It is nevertheless worth a
three- to seven-day experiment if the precise first availability of each
half-hour report matters.

Publicly relayed D-ATIS/ACARS is not a reliable substitute. In the live test,
one 00:30Z RKSI D-ATIS appeared at 00:49Z and the 01:00Z message had not appeared
by 01:09Z; arrival depends on an aircraft request and receiver coverage.

## Retired API warning

The former recommendation in this document was:

```text
http://amoapi.kma.go.kr/amoApi/metar?icao=RKSI
```

That recommendation is no longer valid. AMO announced that its legacy API
service would end on **2026-07-20** as access was centralized through KMA/public
data portals. Live checks of the old METAR endpoint timed out.

Source: [AMO API shutdown notice](https://global.amo.go.kr/etc/notice-detail.do?seq=7569).

This matters to the current repository:

- The live chart cron now uses `pollLatestNoaaStationMetar`; it parses and
  stores the current NOAA `tgftp` RKSI report.
- The legacy `pollLatestStationMetar` action remains only for historical
  diagnostics and is not scheduled or called by the redesigned page.
- `pollLatestAmosTemperatureSites` uses the still-live mobile AMOS JSON every
  minute, while the internal burst collector detects the rollover as soon as
  practical.
- `pollLatestAmosRunways` retains cadence-tagged display rows every five
  minutes for auditing.
- The day-page query returns only the representative `rwyNo=2`,
  `rwyDir=15L` rows through `by_station_date_rwy_ts`; the other runway-shaped
  five-minute records remain stored for backend auditing.
- NOAA supplies the actual coded METAR comparison but cannot compete with AMOS
  for current-temperature freshness.

## Recommended latency experiment

Run a 24-48 hour side-by-side watcher for:

1. AMO mobile `amos_info.do`.
2. KMA API Hub `amos.php` with a key.
3. Public AMOS HTML.
4. KMA Weather station 113 JSON.
5. AWC API and NOAA tgftp.
6. KMA WIS2 METAR.

For each changed value, store:

```text
source
source_observation_time
first_seen_at
first_seen_latency_ms
temperature_c
feed_row_designation
sensor_series
rwy_main
raw_payload_hash
is_revision
```

The production watcher polls sequentially once per second from `:12` and stops
when the new timestamp appears, with a hard eight-attempt cap. Do not schedule
only at `:00`; the measured AMOS data was not published until roughly `:15`.
For future comparison experiments, keep the same bounded-window approach rather
than polling continuously for the entire minute.

The decision rule should be:

- Use the source with the earliest stable `first_seen_at` for live temperature.
- Prefer the documented API Hub feed if it is within a few seconds of the
  mobile feed.
- Keep the mobile AMOS feed as the fastest fallback while validating its schema
  continuously.
- Use AWC/NOAA and WIS2 to verify the eventual official METAR, not to drive the
  freshest temperature display.
