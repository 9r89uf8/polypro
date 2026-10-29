# Seoul satellite latency investigation — October 29, 2026 KST

This is a source comparison for RKSI (37.4602°N, 126.4407°E), performed on
October 28 in Chicago / October 29 UTC and KST. It does not change production
collectors, schedules, approval flags, or the dashboard's source selection.

**Follow-up:** the [later paired-channel investigation](./seoul-edge-research-2026-10-29.md)
supersedes this report's preliminary ranking. A completed GK2A hour had a
17m13s median modification-time delay and a late batch reaching 58m22s.
Public NOAA Himawari-9 B03/B13 pairs were faster in the compared hour, with a
6m45s median. These are different measurements from the small viewer snapshot
below. Neither raw-channel method has demonstrated a temperature or market
advantage. The AMATERASS irradiance candidate below is a separate delivered
product, with its own rights and availability questions.

## Findings

In the initial viewer snapshot, **two-minute GK2A Korea cloud imagery** was
fresher than the listed radiation product. At 10:29 KST, its newest listed observation was about five minutes
old; the newest listed processed surface-radiation observation was about
19 minutes old. Imagery can support earlier cloud-change information, but
does not itself supply surface irradiance in W/m² or calibrated total cloud
coverage. Keep that distinction visible if adding a derived cloud signal.
An additional NOAA Open Data raw GK2A L1B sample had a valid RKSI pixel and
an S3 modification timestamp 6m07s after its nominal frame time. This is a
more suitable numerical input for developing a cloud indicator than RGB
image brightness, but it is still reflected radiance rather than surface DSR.

AMATERASS/Himawari is a promising alternative numerical irradiance product,
with advertised 2.5-minute regional sampling and roughly ten-minute delivery.
Current RKSI pixel availability, actual receipt delay, operational continuity,
and appropriate usage rights remain unverified. It is a benchmark candidate,
not a replacement selected by this investigation.

## Measurements from the current system

A read-only query of `striped-chipmunk-763` returned eight airport frames.
The observation timestamp is compared with `firstSeenAt`, the database's first
insertion time after extraction. All times below are October 29, 2026 KST.

| Observation | First persisted | End-to-end delay |
| --- | --- | --- |
| 09:00 | 09:16:50.139 | 16m 50.139s |
| 09:10 | 09:26:50.362 | 16m 50.362s |
| 09:20 | 09:36:52.286 | 16m 52.286s |
| 09:30 | 09:46:50.836 | 16m 50.836s |
| 09:40 | 09:56:50.895 | 16m 50.895s |
| 09:50 | 10:06:54.038 | 16m 54.038s |
| 10:00 | 10:16:52.501 | 16m 52.501s |
| 10:10 | 10:26:51.707 | 16m 51.707s |

Median delay was **16m 51.301s**. This small daytime sample is not a service
guarantee. For the 10:10 frame, work was queued at 10:26:46.003, began at
10:26:46.105, and reached the database about 5.6 seconds later. Download and
extraction were not a multi-minute bottleneck in that attempt.

Timestamp interpretation matters:

- `collectionRunAt` is assigned the frame's observation time in the active
  collector; it is not a download or receipt clock.
- `lastSuccessAt` uses the worker's start time, not insertion/completion time.
- `firstSeenAt - obsTimeUtc` includes publication, polling, network and
  extraction delays. It does not isolate the provider's publication delay.

Code references: `convex/seoulGk2aCollector.js` (`buildObservationRows`,
`upsertAndPruneSolarObservations`, `collectSolarHeating`) and
`convex/seoulGk2aNode.js` (`discoverCandidateFrames`, `selectNetcdfFrame`).

## Simultaneous public metadata check

Requests began at approximately **2026-10-29 01:29:04 UTC / 10:29:04 KST**.

| Listing | Newest observation returned | Age at request start |
| --- | --- | --- |
| NMSC DSR Korea viewer | 10:10 KST | 19m 04s |
| KMA RGB cloud-enhanced Korea imagery | 10:24 KST | 5m 04s |

The RGB listing also contained 10:18, 10:20 and 10:22 frames. This verifies a
two-minute sequence in that snapshot. These are **ages of the newest listed
frames**, not measurements of their first publication. The DSR listing is a
PNG discovery response; numeric availability additionally requires resolving
the matching NetCDF. No radiation values were inferred from RGB pixels.

The checks used the existing documented endpoints:

- NMSC `selectSatViewer.do`, UTC date `2026-10-29`, product
  `GK2A:AMI:LE2:DSR:PNG:KO:020:LC`.
- KMA `/w/wnuri-img/rest/sat/images/gk2a.do`, `area=ko020lc`, `data=rgb-cs`.

The existing `app/api/seoul/gk2a-loop/route.js` uses this RGB listing but
downsamples it to four-minute displayed frames. The streamlined Seoul page
does not display that loop. Restoring the old route alone would not produce a
validated numerical sunlight trend.

## Alternatives and evidence limits

| Source | Documented product | Assessment for this dashboard |
| --- | --- | --- |
| GK2A Korea L1B/cloud imagery | Two-minute regional imagery; visible red channel can resolve 0.5 km | Fresher in the initial viewer snapshot; broader paired-channel latency is much less favorable. Raw calibrated channels or validated cloud products are preferable to treating RGB brightness as radiation. |
| NOAA Open Data GK2A L1B local area | Two-minute visible/IR imagery; one current 0.5 km visible sample contains RKSI | Public distribution without an AWS account; one sample's S3 timestamp was 6m07s after nominal frame time. Requires maintained footprint, quality, calibration and cloud inference checks. |
| Existing GK2A SWRAD/DSR | Approximately 2 km, ten-minute surface-radiation estimates | Retain quantitative baseline. No two-minute DSR service was verified. |
| KMA API Hub point radiation | `nph_sun_sat_txt`, nearest-grid DSR/ASR and cloud variables, ten-minute intervals, authentication key | Smaller responses could simplify collection. Earlier publication than the viewer is unproven; current worker processing is already only seconds. |
| KMA AI radiation point service | `nph_sun_sat_ana_txt`, 30-minute intervals | Not a cadence improvement. |
| AMATERASS/Himawari | 1 km regional `jp01`–`jp04` irradiance every 2.5 minutes; roughly ten-minute availability advertised | Best alternative numerical candidate to benchmark. A published example supports Seoul/Incheon coverage, but live valid RKSI pixels and receipt times remain untested. |
| JAXA P-Tree shortwave radiation | Japan-domain 1 km, ten-minute sampling; approximately 15 minutes after observation completion | No demonstrated speed advantage. Observation completion is not necessarily the nominal frame timestamp used in our timing comparison. |
| Solcast Live | Global modeled irradiance; five-minute issuance/granularity, with satellite-driven updates described as 5–15 minutes | Commercial candidate with convenient API and clear-sky fields. Five-minute output does not prove five-minute-old satellite input at RKSI. A trial must expose freshness and distinguish estimates/nowcasts. |

Primary documentation:

- [KMA satellite observations](https://www.kma.go.kr/kma/biz/observation04.jsp)
  confirms ten-minute full-disk and two-minute Korean-area observations.
- [NMSC product catalog](https://nmsc.kma.go.kr/homepage/html/base/cmm/selectPage.do?page=static.convergence.utilizationProducts)
  distinguishes radiances, cloud products, and surface radiation.
- [SWRAD algorithm document](https://api.nmsc.kma.go.kr/resources/common/pdf/%EC%99%B8GK2A_L2_ATBD_%EA%B5%AD%EB%AC%B8_%EB%8B%A8%ED%8C%8C%EB%B3%B5%EC%82%AC_SWRAD.pdf)
  describes the numerical retrieval and its resolution.
- [KMA energy API documentation](https://apihub.kma.go.kr/specialApiList.do),
  sections 4–5, describes the two radiation point services.
- [KMA satellite API documentation](https://apihub.kma.go.kr/apiList.do?seqApi=6)
  documents L1B file access separately from convenient decoded numeric
  `WthrSatlitInfoService` endpoints. Some of those decoded endpoints accept
  observations only from two days to six hours ago and are unsuitable for
  live collection. Do not generalize that restriction to the L1B file APIs.
- [AMATERASS specifications](https://amaterass.science/products-guide/),
  [overview](https://amaterass.science/overview/), and
  [published regional example](https://amaterass.science/products-guide-assets/img/jp-sequence-en.webp)
  describe irradiance products and demonstrate historical regional coverage.
  A product's bounding rectangle alone does not prove valid pixels within
  the satellite scan footprint.
- [JAXA SWR catalog](https://www.eorc.jaxa.jp/catalog/details/92)
  supplies its cadence and latency specification.
- [Solcast Live](https://www.solcast.com/live-weather-irradiance-data) and
  [methodology](https://www.solcast.com/irradiance-data-methodology)
  distinguish modeled output resolution from the source observations.

### NOAA Open Data raw-file check

The [NOAA GK2A dataset registry](https://registry.opendata.aws/noaa-gk2a-pds/)
describes public use and anonymous S3 access. A bounded research download of
[this VI006 local-area sample](https://noaa-gk2a-pds.s3.amazonaws.com/AMI/L1B/LA/202610/29/01/gk2a_ami_le1b_vi006_la005ge_202610290126.nc)
confirmed the following metadata and geolocation:

- Nominal filename time: 01:26:00 UTC / 10:26:00 KST.
- Embedded `scene_acquisition_time`: 01:26:55 UTC.
- Embedded `file_generation_time`: 01:28:16 UTC.
- S3 `LastModified`: 01:32:07 UTC (6m07s after nominal time, 5m12s after
  the embedded scene time). This is an object timestamp, not a repeated
  absent/present first-publication measurement or service guarantee.
- `VI006`, 0.64 µm visible red, nominal 0.5 km, 2000 × 2000 local-area grid.
- GEOS projection parameters in the file place RKSI at zero-based row 954,
  column 955. The nearest cell center is 37.460224°N, 126.440290°E, with a
  raw pixel value of 1566. Calibration coefficients and pixel-quality metadata
  are present; no surface-radiation value was inferred from that raw count.

This was downloaded and inspected at 01:38 UTC. The adjacent listing contained
01:18, 01:20, 01:22, 01:24 and 01:26 frames. Their upload timestamps were
clustered rather than strictly following observation order, so sustained
delivery jitter must be measured. The active `AMI/L1B/LA/` prefix mattered:
the apparently more obvious `GK2A/LE1B/VI006/KO/data/` prefix contained only
October 10–11, 2023 directories in this inspection. The root local-target
list was also historical. Do not assume a current footprint from those names
or a stale target list; check each frame's geometry.

NOAA's open-distribution terms are an independently documented route, not an
assumed extension of NMSC viewer approval. Attribute the source, identify any
derived estimates as modified, and check the exact product's terms before
building a production collector. No S3 notification subscription or recurring
download was created.

## Access and operational limits

The current NMSC viewer approval remains separate from credentials and new
service scopes. Its documented collection cadence is ten minutes. A shift
within that cadence and an increase in request frequency are different changes;
do not assume permission for continuous polling, additional products, or FTP
access from the existing flag alone.

NMSC advertises a [registered real-time AMI FTP service](https://nmsc.kma.go.kr/enhome/html/base/cmm/selectPage.do?page=static.utilization.reqStation).
It is a legitimate distribution option to discuss with NMSC, but no earlier
delivery guarantee was found. The [rapid-scan request service](https://nmsc.kma.go.kr/homepage/html/special/specialIntro.do?lang=ko)
serves national meteorological services with two-minute target imagery; it is
not a verified sub-two-minute Seoul irradiance service.

[AMATERASS usage conditions](https://amaterass.science/product-download/)
allow educational/research use without charge and require prior contact for
corporate/commercial use. Its former consortium's
[December 2025 continuity notice](https://www.amaterass.org/news/20251217.html)
does not guarantee data provision for FY2026 onward. The developer's newer
site still describes ongoing near-real-time products, so confirm the current
service and rights before relying on them. No corporate/commercial permission
was assumed and no new AMATERASS collector was activated.

Any approval-dependent integration must follow `AGENTS.md`: build and test
behind a dedicated server-side Convex approval gate, deploy disabled, verify
the disabled state, and activate only after the user confirms the appropriate
authority approved the precise scope. No such new integration was released by
this investigation.

## Recommended sequence

1. Keep the current quantified DSR series. Instrument separate metadata-ready,
   download, extraction and insertion clocks to measure where its delay occurs.
   An earlier ten-minute poll may recover a few minutes, but the existing
   comment about twelve-minute publication is not a fresh measurement. Moving
   a poll too early could miss a frame for another ten minutes.
2. Benchmark two-minute GK2A raw imagery/cloud products for a separately labeled
   clearing/clouding signal. Validate RKSI geolocation, changing sun angle,
   cloud shadows/parallax, coastal land/water effects, nighttime and missing
   frames. Preserve the distinction from quantified surface sunlight.
3. If earlier W/m² estimates are required, confirm AMATERASS operation and usage
   scope, then compare valid RKSI pixels and receipt times against GK2A. Use
   per-pixel observation time where supplied, not just filename time.

The existing sunlight arrow also summarizes 30–60 minutes of history. Faster
delivery alone does not turn that into an instantaneous signal; changing its
window would be a separate behavior change needing validation and clear
labeling.
