# Independent Himawari-9 HSD review for RKSI — October 29, 2026

The inspected Japan-area files really cover RKSI, and an independent geometry
and calibration calculation agrees with the initial reader. The review found
no navigation error in these eight files. It did identify two interpretation
requirements: use the current visible calibration, and do not count the 25
target locations as 25 independent infrared measurements.

The calibration review uses four previously captured public B03/B13 pairs.
A separate bounded benchmark below downloads one of those pairs again to
measure local transfer and processing time. Neither establishes a validated
cloud classification or temperature forecast. No application source,
approval flag, or production schedule changed here.

## Sample and evidence

The four pairs are `0220/JP04`, `0230/JP01`, `0230/JP02`, and `0230/JP03` on
October 29 UTC. Public object URLs, byte sizes, SHA-256 hashes, embedded clocks,
and S3 timestamps are retained in the
[four-pair source evidence](assets/seoul-himawari-four-pair-evidence-20261029.json).
The [independent calibrated output](assets/seoul-himawari-calibrated-review-20261029.json)
retains all 200 channel/target samples. The smaller
[independent-check summary](assets/seoul-himawari-independent-checks-20261029.json)
contains the separate projection comparison and calibration checks.

Every file is Himawari-9 HSD v1.3, has a complete uncompressed data block after
outer bzip2 decompression, and reports segment 1 of 1 with first line 1. All
eight operation/degradation flags are zero, all navigation rotations and
line/column shifts are zero, and no error-line entries are present. Processing
center flags 3 and 4 are retained as `77` and `1`; they are not treated as
per-pixel cloud quality measurements.

The [JMA HSD specification](https://www.data.jma.go.jp/mscweb/en/himawari89/space_segment/hsd_sample/HS_D_users_guide_en_v13.pdf)
was checked at PDF pages 15–19, including rendered calibration equations and
navigation footnotes. It defines the projection, segment offset, special
pixel counts, calibration fields, and navigation corrections. The
[NOAA open-data registry](https://registry.opendata.aws/noaa-himawari/)
describes the public distribution used for this bounded research.

## Navigation and pixel conventions

The independent calculation uses Earth-centered Cartesian coordinates, then
the satellite viewing angles. It does not reuse the first reader's
geocentric-latitude expression. A separate `proj4` GEOS calculation used each
file's ellipsoid and satellite metadata with `sweep=y`. Across 200 target
positions, the largest difference was **4.55 × 10⁻¹² pixels**. This checks
the algebra and coordinate conventions, not absolute geolocation accuracy
against surveyed landmarks.

Both channels embed equatorial/polar radii of 6378.137/6356.7523 km, a virtual
satellite radius of 42164 km, and longitude 140.7°. For `proj4`, the height is
the satellite radius minus the equatorial radius, converted to meters. Using
the geocentric radius directly as height would be incorrect.

| JP03 field | B03 visible | B13 infrared |
| --- | ---: | ---: |
| Image columns × lines | 6000 × 4800 | 1500 × 1200 |
| CFAC and LFAC | 81865099 | 20466275 |
| COFF | 4300.5 | 1075.5 |
| LOFF | 9200.5 | 2300.5 |
| RKSI continuous one-based column | 1902.476691 | 475.994165 |
| RKSI continuous one-based line | 1818.335890 | 454.958950 |
| Nearest zero-based column / row | 1901 / 1817 | 475 / 454 |
| Nearest center distance from RKSI | 0.395 km | 0.124 km |

The implemented angle mapping is `column = COFF + degrees(x) × CFAC / 65536`
and `line = LOFF + degrees(y) × LFAC / 65536`, with the image's vertical angle
positive southward. Convert a nearest center to array coordinates only once:
`column0 = floor(column + 0.5) - 1` and
`row0 = floor(line + 0.5) - firstLine`.

The half-pixel values in COFF/LOFF do not justify another half-pixel shift.
Subtracting one from the line works for these files because `firstLine=1`;
it is not the general segmented-file rule. Real segmented inputs were not
validated here. The research reader rejects nonzero navigation corrections
instead of silently ignoring a rotation or interpolated shift it has not
implemented.

## Calibration and the October update

JMA's [October 14 notice](https://www.data.jma.go.jp/mscweb/en/oper/eventlog/Update_of_Calibration_Information_2026.pdf)
scheduled new Himawari-9 visible/near-infrared calibration coefficients for
**07:00 UTC on October 26, 2026**. Its B03 table exactly matches the updated
fields embedded in all four inspected visible files:

| B03 coefficient | Original header value | Updated header value used |
| --- | ---: | ---: |
| Count-to-radiance slope | 0.3051037058823529 | 0.31089897 |
| Count-to-radiance intercept | −6.102074117647058 | −6.21797943 |

The updated slope is **1.89944% greater**. Choosing the original coefficients
would lower this sample's radiance/albedo correspondingly. The embedded
coefficient timestamp is September 22 at 20:40 UTC; it is retained separately
from the notice's deployment date. All four frames use the same updated
coefficients, so there is no calibration-version transition within this
short sequence. A longer analysis crossing October 26 must preserve that
distinction.

B03's albedo coefficient is `0.00192798475658132`; it converts calibrated
radiance to a dimensionless fraction. The optional division by cosine of solar
zenith in this experiment creates a solar-normalized reflectance proxy. It
does not retrieve surface shortwave radiation. The existing GK2A grid pattern
was used only to choose the same geographic targets and visible 3×3 median
sampling operation.

For JP03 at RKSI, the nearest visible count is 830. The 3×3 median used by the
proxy is 821, producing radiance **249.03007494 W/(m² sr µm)**, albedo
**0.4801261884**, and solar-normalized reflectance **0.7709865291**. These
values refer to the explicitly stated median sample, not the nearest count.

B13 embeds a wavelength of 10.4074 µm and a negative count-to-radiance slope
of `−0.0037525074318633814`; a generic positive-gain check would wrongly reject
it. The reader uses its own embedded physical constants and Planck correction
coefficients. Wavelength is converted to meters and radiance per micrometer
to radiance per meter before applying the wavelength-form Planck function.
It then applies the embedded quadratic correction to effective temperature.
The nearest JP03 count, 2735, gives **261.27196148 K**. Inverting the embedded
temperature-to-radiance polynomial returns radiance with a maximum relative
error below **2.14 × 10⁻⁸** across all 100 infrared samples. This numerical
consistency check is not a measurement of sensor accuracy.

The HSD error/outside-scan values, 65535 and 65534, are rejected before
calibration, as are values outside the band's valid count range. The GK2A
decoder's two-high-bit quality interpretation is not applied to HSD.

## Timing and spatial limits that affect any follow-up

`0230` identifies a timeline, not the RKSI pixel's exact observation time.
For JP03, the B03 image spans 02:35:15.573–02:36:43.046 UTC. The RKSI row lies
between embedded line-time records at **02:35:44.876** and **02:36:14.078**.
Linear interpolation gives **02:35:56.395**, which remains an estimate. The
review retains the bracket alongside that estimate; it does not assign the
whole image's start time to every location.

S3 `LastModified` is also a separate clock. It is retrospective object
metadata, not a repeated first-seen measurement of public availability. The
four-pair timing evidence and the
[exploratory change calculation](assets/seoul-himawari-four-pair-trend-20261029.json)
preserve those distinctions. The short sequence cannot establish normal
delivery latency or future temperature prediction.

All 25 geographic targets have valid values in each channel. They map to
**25 distinct B03 centers but only 15 distinct B13 centers**. Reported
fractions across the 25 targets are spatial-grid-weighted descriptions;
they are not 25 independent infrared trials. Adjacent visible samples and
successive images are also correlated.

The surface projection does not correct cloud parallax. To illustrate the
scale, an explicitly hypothetical cloud 10 km above RKSI would have apparent
surface locations about **3.51 km apart** when viewed from Himawari-9 and
GK2A. That is a geometric example, not a cloud height inferred from these
images. Comparing the same surface coordinates across satellites does not
guarantee sampling the same elevated cloud feature.

## Relation to the existing GK2A method

The current production decoder is specific to AMI VI006/IR105, its native
NetCDF geometry, per-pixel flags, and calibration version. Its IR conversion
uses wavenumber radiance units and NMSC coefficients. The Himawari review
uses AHI B03/B13, HSD navigation, wavelength radiance units, and embedded JMA
coefficients. Those conversion parameters are not interchangeable.

The solar elevation calculation is portable, but the satellite viewing vector
for glint is not: this review uses **140.7°**, while the current GK2A helper
uses **128.2°**. Both inspected scenes pass the exploratory illumination and
glint screens, but future calculations must preserve the correct satellite.

Four frames do not validate transfer of GK2A thresholds, cloud labels, or
temperature relationships to Himawari. The current evidence supports a
separately named research candidate. A production source would still require
its own reviewed method, clocks, failure handling, permitted-use scope, and
the project's applicable approval boundary; it must not appear under the
GK2A name or inherit a stale direction when its data are unavailable.

## Interpreting the midday overlap

A separate production read at **02:56:57.968 UTC / 11:56:57.968 KST** supplies
approximately overlapping context, preserved in the
[overlap extract](assets/seoul-himawari-overlap-context-20261029.json):

| Source and nominal local time | Retained value |
| --- | --- |
| RKSI routine METAR, 11:30 | `CAVOK`, temperature 11°C |
| GK2A SWRAD, 11:30 | DSR 210.2 W/m²; modeled clear-sky DSR 617.7 W/m²; ratio 34.0% |
| Himawari four-frame spatial medians, about 11:28–11:36 | B13 261.01–261.61 K; solar-normalized B03 0.7173–0.7304 |

The METAR was inserted locally at 11:34:39.022 KST. The solar query's history
does not expose a per-row first receipt timestamp; `collectionRunAt` equals
the observation slot and is not treated as receipt time. Thus the table is
retrospective physical context, not an as-of comparison or latency claim.
The SWRAD number is a satellite retrieval, and the denominator is the
application's Haurwitz clear-sky model. The 34% ratio is neither a ground
pyranometer measurement nor a directly measured cloud transmission.

`CAVOK` does not require a cloud-free column at every altitude. Its cloud
criteria concern aviation-significant cloud and the applicable lower-height
limit, alongside visibility and weather conditions. Consequently it can
coexist with a satellite signal influenced by upper cloud. This reconciles
the meanings of the observations without diagnosing the cloud in this
particular scene. See the [Met Office METAR guide](https://docs.mavis.metoffice.gov.uk/guidance/metar-decode/).

The 261 K value is an equivalent brightness temperature for an infrared
channel, not the airport's air temperature and not an established physical
cloud-top temperature. Semi-transparent cloud allows contributions from
underlying cloud or the surface. Current
[NWC SAF cloud-height documentation](https://www.nwcsaf.org/ctth_description_2025)
therefore uses additional infrared channels and atmospheric profiles to
correct semi-transparency, and treats fractional clouds separately. A
single-window temperature cannot resolve that mixture by itself.

JMA's [two-layer cloud-method study](https://www.data.jma.go.jp/mscweb/technotes/msctechrep64-3.pdf),
PDF pages 2 and 6 / printed pages 24 and 28, explicitly models radiation from
two cloud layers, the intervening atmosphere, and the surface. It combines
multiple spectral measurements rather than inferring cloud phase or type
from one infrared value. This is the relevant ambiguity for the two-band
experiment: a change in visible reflectance or infrared brightness can
reflect changing optical thickness, layer mixtures, or sampling of cloud
edges as well as changes in cloud amount.

It follows that paired signs alone are insufficient to establish surface
heating. A brighter visible return and colder infrared return do not identify
how much direct or diffuse sunlight reaches RKSI. A warmer infrared return
does not establish that a shadow has left the temperature sensor. Cloud
parallax locates the apparent feature; solar geometry and cloud height locate
its shadow, which need not lie beneath that apparent feature. These are
possible explanations to test, not a cloud-type, cloud-height, or temperature
direction assignment for this sample. The observed SWRAD reduction relative
to modeled clear sky is compatible with attenuation, but the overlapping
satellite estimates do not independently validate each other against a ground
measurement.

Before using a new signal for a temperature experiment:

1. Distinguish opaque, semi-transparent, mixed/fractional, and invalid scenes
   using a separately validated multi-band method with appropriate surface,
   snow/ice, atmospheric-profile, and geometry inputs. The
   [NWC SAF cloud-type specification](https://www.nwcsaf.org/web/guest/ct_description)
   documents these dependencies and satellite-specific thresholds; adding
   bands is not by itself validation.
2. Validate a surface-irradiance or shadow-arrival quantity against an
   appropriately timed reference. Preserve cloud-height/parallax uncertainty,
   the solar direction, spatial averaging, and any motion estimate; a surface
   wind observation alone does not demonstrate the movement of upper cloud.
3. Freeze the signal and all receipt clocks before each evaluated future
   AMOS/METAR outcome. Compare held-out performance with AMOS trend, the prior
   routine report, and the KMA forecast. Keep accuracy of the next report,
   accuracy of the daily maximum, and any market-price reaction separate.

The four-frame analysis reports small mixed spectral changes and no cloud
state. The overlap does not justify promoting those changes to a directional
temperature forecast.

## Local download and decode benchmark

A single bounded run at **03:31:23.814 UTC** freshly downloaded the already
verified `0230/JP03` B03 and B13 objects, once each. Both sizes and SHA-256
hashes matched the earlier evidence exactly. The
[benchmark record](assets/seoul-himawari-benchmark-20261029.json) retains
request start/end times, response headers, hashes, monotonic wall times,
process CPU time, reader-source hashes, and Windows memory counters.

| Measurement | B03 visible | B13 infrared |
| --- | ---: | ---: |
| Compressed bytes received | 15,249,786 | 1,058,200 |
| HTTP request through body write/hash | 2.644 s | 1.081 s |
| Strict decoder wall time | 4.983 s | 0.122 s |
| Strict decoder process CPU time | 3.266 s | 0.109 s |
| Fresh child process, including startup | 5.260 s | 0.362 s |
| Raw pixel array bytes, excluding headers | 57,600,000 | 3,600,000 |
| Decoder process peak working set | 149.38 MiB | 31.84 MiB |

The two downloads ran concurrently and completed in **2.764 s**, measured
from benchmark setup. Sequential strict decodes then produced both validated
25-point results by **8.387 s** from that same start. Each decoder ran in a
fresh process; its peak working set includes Python and temporary allocation,
with initial working sets around 22.4 MiB. It is not a claim that the pixel
array alone consumes 149 MiB. The independent footprint inspector subsequently
reproduced both center counts and shapes; that second decode is excluded
from the 8.387 s figure. The whole run, including those checks, took 11.409 s.

This used Python 3.12 on local Windows and older, already available objects.
There was no cold-cache control or repeated performance distribution. It
measures one download-and-processing path, not first public availability,
new-frame freshness, a service-level guarantee, or Convex execution time.
HTTP and local clock values are retained separately; elapsed durations use
the local monotonic clock. No extra requests were made to repeat or improve
the result.

The sample also gives concrete implementation constraints:

- The existing GK2A collector caps each file at **12 MiB**. This B03 object
  exceeds that cap by 2,666,874 bytes. Its 6000×4800 grid also exceeds the
  current decoder's **2200-per-dimension** check. HSD/bzip2 is not the expected
  NetCDF/HDF5 format, so merely changing a URL or raising a size cap is not an
  implementation.
- Together, these compressed files contain 16,307,986 bytes. At 24 pairs per
  hour, the same sizes would imply about **391.4 MB/hour** of transfers before
  retries or metadata. This is arithmetic for capacity planning, not a
  measured continuing rate; actual imagery compresses differently.
- Whole-file decompression creates 61.2 MB of pixels for one pair. Holding
  four pairs simultaneously would require 244.8 MB for pixels alone, before
  compressed buffers and runtime overhead. The current Node download helper
  also retains chunks before `Buffer.concat`, unlike this benchmark's
  streaming writes to disk.
- A candidate implementation should bound compressed and decompressed sizes,
  process pairs sequentially, retain only necessary geographic samples after
  decode, and benchmark its actual runtime. Streaming decompression could
  reduce memory if implemented and validated; it does not eliminate reading
  the compressed stream. None of those optimizations was tested here.

The [benchmark script](../scripts/benchmark-himawari-rksi.py) refuses to
overwrite its evidence or redownload existing benchmark files. Its
`--use-existing` mode permits an explicitly requested offline rerun without
another network request. Fresh downloads require `--download-once`, and its
allowlist is limited to this verified public pair. The raw benchmark files
remain under ignored `tmp/seoul-himawari-benchmark-20261029/` storage.

## Reproduction

The [offline reviewer](../scripts/review-himawari-hsd.py) uses Python's standard
library and prints JSON. For example:

```text
python scripts/review-himawari-hsd.py tmp/himawari9-b03-jp03-202610290230.DAT.bz2 tmp/himawari9-b13-jp03-202610290230.DAT.bz2
```

Pass the other six saved paths to reproduce the complete output. Raw imagery
stays in ignored research storage; public URLs and hashes are preserved in
the evidence above. The reader is deliberately limited to the inspected
Himawari-9 Japan-area B03/B13 format and zero-correction cases. It is not a
general-purpose or production HSD ingestion library.

The [separate geometry checker](../scripts/check-himawari-review.mjs) reproduces
the `proj4` comparison, native-pixel counts, and hypothetical parallax example
from the saved calibrated output, without downloading imagery:

```text
node scripts/check-himawari-review.mjs docs/assets/seoul-himawari-calibrated-review-20261029.json docs/assets/seoul-himawari-independent-checks-20261029.json
```
