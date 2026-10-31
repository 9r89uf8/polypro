# RKSI GOCI-II hourly view (approval-gated)

This document describes the retained collector, renderer and card for an
hourly, daytime, true-colour view of Incheon International Airport,
**RKSI, 37.4602° N, 126.4407° E**, from GOCI-II on GK-2B. It is for visual
inspection only. It does not change the temperature forecast, cloud-trend
model, market display or any trading decision.

## Status

**Current dashboard status:** the **Hourly high-resolution view** panel has
been removed from `/seoul/day/[date]`, including the live route reached through
`/seoul/today`. The page no longer mounts the card, subscribes to
`seoulGoci2:getLatest`, or exposes its Refresh control. The retained component,
collector, schedule, retention and `KHOA_GOCI2_ACCESS_APPROVED` gate are
unchanged; this UI removal does not revoke approval or stop collection.

**Collector activation record.** The code was deployed on October 30, 2026
(October 31 KST) with the approval flag absent, and the disabled state was verified (see
[Release verification](#release-verification)). The user then set
`KHOA_GOCI2_ACCESS_APPROVED=true` on `striped-chipmunk-763`. The first live
run exposed a slot-search bug, fixed after the real NOSC formats were checked
(see [Activation and first live run](#activation-and-first-live-run)).

## Why GOCI-II

Measurements from the October 30, 2026 investigation (check again before
relying on them):

- **Sharper.** RKSI lies in local-area slot S007 at row 541, column 1449.
  The file's own latitude/longitude give pixels of about 0.265 × 0.356 km
  there; a geostationary model at 128.2° E gives 0.259 × 0.360 km. Himawari-9
  B03 is about 0.545 × 0.735 km at RKSI, so GOCI-II is about twice as fine
  per axis. No other public geostationary source is sharper at RKSI.
- **Hourly and daytime only.** S007 was observed at about :27 UTC. The
  local-area nominal hours are 23:15–08:15 UTC, so observations fall at about
  08:27–17:27 KST. The slot NetCDF appeared about 14 minutes after observation
  (02:41:49 GMT for 02:27:16–02:28:20 UTC).
- It complements, and does not replace, the 2.5-minute Himawari loop.

NOSC posted ten GK-2B schedule-change notices between May and October 2026,
and one directory that day was 06:16:30 rather than 06:15:30. Directories,
times and slots are therefore discovered on every run, never hard-coded.

## Source, terms and approval

- **Source:** KHOA National Ocean Satellite Center (NOSC) OPeNDAP (Hyrax),
  `https://nosc.go.kr/opendap/GOCI-II/YYYY/MM/DD/L1B_COMP/`. Each slot
  directory `GK2_GC2_L1B_YYYYMMDD_HHMMSS/` holds one file per slot,
  `GK2_GOCI2_L1B_YYYYMMDD_HHMMSS_LA_Snnn.nc` (about 433 MB): 12 UInt32
  `L_TOA` radiance bands (380–865 nm) plus latitude and longitude on a
  2780 × 2780 geostationary grid (sub-satellite longitude 128.2° E).
- **Terms:** NOSC pages state only "All rights reserved". The license and
  acknowledgement attributes in the L1B file are empty (publisher KHOA-NOSC,
  creator contact `kosc@kiost.ac.kr`). The NOSC OPEN API terms
  (`https://www.nosc.go.kr/openapi/actionOpenApiIssue.do`, article 6-3) forbid
  copying, storing or retransmitting results. No reuse terms were found for
  OPeNDAP. Production use is therefore treated as approval-required.
- **Approving authority and scope:** KHOA / NOSC must confirm, in writing,
  all three uses: (1) automated hourly retrieval of DAP2 subsets of GOCI-II
  L1B slot files by a server, (2) storage of derived airport images for up
  to 24 hours, and (3) public display of those images on the dashboard with
  attribution. Contact: NOSC / KHOA, `kosc@kiost.ac.kr`.
- **Flag:** `KHOA_GOCI2_ACCESS_APPROVED`, a server-side Convex environment
  variable. Only the exact string `true` enables anything; missing, empty,
  `false`, `TRUE`, `1`, `" true"` and any other value fail closed. No
  credential is needed today. If NOSC later issues a key, store it in a
  separate variable; a working key never implies approval. A reachable,
  keyless server does not imply approval either.

The hosted app currently uses the Convex deployment `striped-chipmunk-763`,
which the CLI classifies as development, so use its explicit name. Set the
flag only after the user confirms that KHOA/NOSC granted the scope above:

```text
npx convex env set KHOA_GOCI2_ACCESS_APPROVED true --deployment-name striped-chipmunk-763
```

Remove it to stop new downloads, storage and display immediately. Stored
images are then hidden at once and deleted by retention within 24 hours; to
delete them immediately, run the purge until it reports `remaining: false`:

```text
npx convex env remove KHOA_GOCI2_ACCESS_APPROVED --deployment-name striped-chipmunk-763
npx convex run seoulGoci2:purgeStoredImages --deployment-name striped-chipmunk-763
```

For a Convex production target, the same commands use `--prod`
(`npx convex env set KHOA_GOCI2_ACCESS_APPROVED true --prod`,
`npx convex env remove KHOA_GOCI2_ACCESS_APPROVED --prod`). Code deployment
and approval activation are separate operations: deploy with the flag absent
and verify the disabled state first.

## Protected entry points

| Entry point | Without approval |
| --- | --- |
| Cron `seoul_goci2_rksi_every_5_min` → `seoulGoci2:queueScheduledRefresh` | Returns `approval_required` before any database read or scheduling. |
| Public mutation `seoulGoci2:requestRefresh` (card Refresh button) | Same queue and gate. |
| Worker action `seoulGoci2Node:collectLatest` | Returns before claiming. Before **every** NOSC request it re-checks the flag locally and through `checkWorker`; streaming reads check it per chunk and cancel on revocation; it is checked again before storing the PNG. |
| `claimWorker`, `checkWorker`, `recordSourceFailure`, `finishWorker` | Return `null`, `false` or `approval_required`; no state change. |
| `saveFrame` | Deletes the just-uploaded PNG and stores nothing. |
| Public query `seoulGoci2:getLatest` | Returns `approval_required` with no database read, storage URL or collector detail. |

There are no HTTP routes. Deletion-only maintenance is intentionally not
gated so revocation never extends retention: `pruneExpiredFrames` (cron
`seoul_goci2_rksi_retention`), `deleteUploadIfUnreferenced` and
`purgeStoredImages`.

**Disabled behavior.** The card says "GOCI-II approval required" and explains
that nothing is collected or shown until KHOA grants permission. It renders
no image element and no proxy imagery: Himawari or any other source is never
shown or relabelled as GOCI-II. Refresh and zoom are disabled.

## Collection

1. **Discovery.** Day catalogs `…/L1B_COMP/catalog.xml` (THREDDS) for the
   current UTC day and the UTC day three hours earlier; a missing day folder
   is not an error. Slot directories with a nominal time in the last three
   hours are considered, newest first, skipping those already stored with the
   current renderer and those that failed in the last 30 minutes. At most two
   directories are processed per run.
2. **Slot selection.** The directory catalog lists `…_LA_Snnn.nc` files. The
   last verified slot (`lastSlot`) is tried first. On the first run, or if
   that slot no longer contains the airport square, other published slots are
   probed in ascending order with a 3 × 3 latitude/longitude sample. A slot
   far from RKSI or with unusable navigation is skipped with a reason, and
   the reasons are reported if no slot fits. On the live server the first
   search probes S000–S006 before S007 (about 25 small requests, once); the
   saved `lastSlot` then avoids the search. Without a remembered slot the
   worker waits until a directory is 30 minutes old; with one, it waits up to
   45 minutes for that slot before searching.
3. **Locate.** The slot's DDS gives the grid shape and types. A 72 × 72
   strided latitude/longitude sample locates RKSI; an affine fit around it
   maps the 100 km square plus margin to a native window (about 311 × 433
   pixels). A square that crosses the slot edge is rejected, not partly drawn.
4. **Download.** The DAS, then five DAP2 subsets of that window: latitude,
   longitude and `L_TOA_660`, `L_TOA_555`, `L_TOA_443`, about 0.54 MB each.
   About 2.7 MB per hourly image; whole slot files are never requested.

Every request passes an allowlist of exactly these URL classes on
`https://nosc.go.kr`: day catalog, directory catalog, `.das`, `.dds`, and a
`.dods` subset of one allowlisted variable in one canonical encoding (group
slashes as `%2F`, brackets as `%5B`/`%5D`) with at most 420 × 520 elements.
Redirects are rejected, `Accept-Encoding` is `identity`, and responses have
byte limits (catalog 512 KiB, DAS 256 KiB, DDS 64 KiB, subset exact size plus
16 KiB) and a 25-second deadline. A steady hour costs about 12 requests for
the image, plus two or three small catalog requests per five-minute poll in
the period before the next image is due.

Each frame keeps its provenance: source key, slot, nominal and observation
clocks, catalog size and modification time, the native window, and the
constraint, byte count and SHA-256 of every request (at most 16).

## Rendering

- **Grid.** A north-up 100 × 100 km square centered on RKSI (local
  equirectangular), 512 × 512 cells: 5.12 cells per km, 0.195 km cells. This
  meets the "at least 400 cells per 100 km" requirement; the Himawari grid
  (256 cells, 0.39 km) would discard GOCI-II detail.
- **Navigation.** A cubic least-squares map from local km to native
  row/column is fitted to every second valid file latitude/longitude pair,
  and every valid pair must agree within 0.35 pixel. The airport marker is
  the exact coordinate.
- **Sampling.** Bilinear between native pixels; the nearest valid pixel at a
  fill edge; otherwise the invalid color `#241932`. Display cells are finer
  than the source, and zoom does not add detail beyond the native pixels.
- **Calibration.** Radiance = count × `scale_factor` + `add_offset` from the
  DAS. `units` must be W m⁻² µm⁻¹ sr⁻¹. `_FillValue` and any
  `valid_min`/`valid_max` make a pixel invalid.
- **Reflectance.** ρ = π L d² / (F0 μs). The Earth–Sun distance d follows the
  day of year. μs comes from the NOAA solar-position equations at each
  location for the mid-observation time, the mean of the file's
  `observation_start_time` and `observation_end_time` (about 64 s apart).
- **F0.** A per-band file attribute named `F0`, `solar_irradiance` or
  `mean_solar_irradiance` is used when present (W m⁻² µm⁻¹, or
  mW cm⁻² µm⁻¹, within 15% of the reference); an implausible value rejects
  the frame. Otherwise the renderer uses reference values of 1885, 1840 and
  1545 W m⁻² µm⁻¹ for 443, 555 and 660 nm. These are approximate 10 nm
  band-centre values that agree within about 2% with Thuillier-based F0 for
  neighbouring ocean-colour bands; they are not official GOCI-II
  band-integrated values, and no published GOCI-II F0 table was found. The
  source used is recorded per frame (`display.f0`).
- **Rayleigh.** An approximate single-scattering removal for colour balance:
  Hansen & Travis optical depth at standard pressure, Rayleigh phase function
  at the scattering angle, diffuse transmittance e^(−τ/2μ) and a
  single-scattering spherical albedo. Multiple scattering, aerosol, gas
  absorption and terrain pressure are ignored, so some blue haze remains.
- **Tone.** True colour from 660/555/443 nm with one fixed gamma-2.2 curve
  over reflectance 0–1.1 for every image; there is no per-image stretch.
- **Quality.** The sun must be at least 10° above the horizon at RKSI and
  5° at each pixel, and at least 90% of cells must be valid; otherwise the
  frame is stored as an honest `unavailable` record with its reason and is
  not downloaded again. Sun glint is not masked; the card notes it when the
  minimum glint angle is below 25°.
- **Limits.** This is not a cloud mask or surface-reflectance product.
  Cloud height (parallax) is not corrected: GK-2B is almost due south of
  RKSI at a 43.4° viewing zenith, so a 10 km cloud top appears about 9.5 km
  north of the point beneath it. Ocean-colour band saturation on bright
  cloud has not been checked against real files.

## Storage, retention and schedule

- `seoulGoci2Frames`: one row per slot file (`sourceKey`), `ok` with a PNG or
  `unavailable` with a reason, plus the provenance above. Indexes:
  `by_station_time`, `by_station_key`, `by_storage`.
- `seoulGoci2CollectorStatus`: one RKSI row with the run lease and worker
  token, `lastSlot`, the cleanup cursor and at most 20 recent failures.
- PNGs are 512 × 512 lossless RGB with the MIME profile
  `image/png; profile=rksi-goci2-truecolor-v1`, at most 3 MB.
- **Retention:** 24 hours by observation time. The hourly
  `seoul_goci2_rksi_retention` cron (`23 * * * *`) deletes expired rows and
  blobs and sweeps unreferenced blobs of this profile older than 10 minutes,
  also while access is not approved.
- **Schedule:** `seoul_goci2_rksi_every_5_min` (`*/5 * * * *`). The queue
  does no work outside the daylight window (sun at least 5° at RKSI at some
  point in the last 150 minutes), within 2 minutes of the previous queue,
  while a run holds its 5-minute lease, or within 50 minutes of the newest
  stored observation, because the next hourly slot cannot exist yet.

## Retained dashboard component

The [current Seoul page contract](./seoul-pages.md) removes this card from
the dashboard. Its retained implementation shows today's KST images only
(latest by default, hourly buttons for earlier ones), with 20/50/100 km zoom,
an RKSI marker, north arrow, scale bar and KST AM/PM observation times. If
mounted for a past or future date, it does not query images.

## Verification (October 30, 2026)

- `node --test test/seoul-goci2-*.test.mjs`: 33 tests covering naming,
  catalogs, DAS/DDS/DAP2 parsing, the URL allowlist, navigation, reflectance
  and rendering, every approval entry point for eight non-`true` flag values,
  queue spacing and leases, frame validation, retention and purge while
  disabled, and full worker runs against a fake NOSC host (including slot
  search, waiting, revocation mid-download, provider errors and backoff).
  All fixtures are synthetic; no request leaves the test process.
- The actual card was rendered in a browser from an esbuild fixture with
  labelled synthetic data at 1440, 1100 and 375 px: the approval-required
  state has no image and disabled controls, and the populated, night,
  collecting, unavailable and past-date states render without console errors
  or page overflow. A failing query shows the card's own error state while
  the Himawari loop keeps working.
- **Not yet verified:** a full day of hourly runs, cloudy scenes, image
  appearance at higher sun, and ocean-colour band saturation on bright cloud.
  None occurred in the first real scene; its maximum 660 nm radiance was 80.6.
  The real formats were checked on October 31 (see
  [Activation and first live run](#activation-and-first-live-run)).

## Release verification

Deployed on October 30, 2026 at about 18:50 CDT (October 31, 08:50 KST),
from commit `9de6b28`, with `KHOA_GOCI2_ACCESS_APPROVED` absent:

- **Before deploying.** The live Himawari loop still reported renderer
  `rksi-himawari-image-v2`, so no newer uncommitted Himawari work was live to
  be overwritten. The deployed function list matched this commit except for
  the twelve new `seoulGoci2` functions.
- **Convex (`striped-chipmunk-763`).** A dry run validated the schema,
  deleted no index and added only the four GOCI-II indexes; the apply step
  matched it. Afterwards `convex env get KHOA_GOCI2_ACCESS_APPROVED`
  reported not found; `seoulGoci2:getLatest` returned `approved: false`,
  `approval_required`, no frames and no collector; `seoulGoci2:requestRefresh`
  returned `approval_required` without queuing; both GOCI-II tables were
  empty. The `seoul_goci2_rksi_every_5_min` cron ran at 18:55:20 CDT without
  starting a worker or writing a row. The Himawari loop was unchanged
  (renderer v2, frames still served).
- **Vercel.** Production was rebuilt from `main` at `9de6b28`. On
  `polypro-alpha.vercel.app/seoul/day/2026-10-31` the card showed "GOCI-II
  approval required" with no image and Refresh disabled, beside the working
  Himawari loop: side by side at 1440 px, stacked at 1024 px, with no console
  errors.

## Activation and first live run

The user set `KHOA_GOCI2_ACCESS_APPROVED=true` on `striped-chipmunk-763` on the
evening of October 30 CDT (morning of October 31 KST).

- **Failure.** The first live run, at 01:15 UTC on October 31 (10:15 KST),
  failed directory `GK2_GC2_L1B_20261030_231630` with "no valid navigation in
  sample". With no remembered slot, the search probed slots in ascending
  order. S000 lies at about 23.7–31.4° N, 135.9–144.4° E, so none of its probe
  points fell inside the sanity window around RKSI. The locator threw instead
  of skipping that slot, which failed the whole directory and started its
  30-minute back-off.
- **Real formats**, checked on one S007 file with 17 small allowlisted
  requests (about 2.8 MB) through the production parsers:
  - The THREDDS catalogs parse as built. The October 31 UTC day folder did
    not exist yet at 01:21 UTC (404, handled).
  - All twelve slot files were listed, published 15–35 minutes after the
    23:16:30 nominal time (S007 at +25.5 minutes).
  - The DDS has unnamed `[2780][2780]` dimensions plus 1-D
    `/number_of_lines` and `/number_of_columns`.
  - In the DAS, global attributes are in `H5_GLOBAL`, not `NC_GLOBAL`. The
    clock attributes are `observation_start_time` `20261030_232852` and
    `observation_end_time` `20261030_233000`. Bands have `units`
    `W m-2 um-1 sr-1`, `scale_factor` 9.999999975e-07, `add_offset` 0,
    `_FillValue` 4294967295, and `valid_min` 0 / `valid_max` 1000000000.
  - Navigation is unscaled Float32 with fill −999. The file also carries
    `geospatial_*` bounds (S007: 30.67–39.29° N, 121.99–130.41° E).
  - There is **no per-band F0 attribute**, so the labelled reference F0 is
    used.
  - The `.dods` framing and XDR decoding match the parser.
- **Fix.** The locator now reports a slot that does not surround RKSI as
  not containing the airport, with a reason, and the search moves on.
  `H5_GLOBAL` is accepted and scaled navigation arrays are rejected. The
  synthetic fixture mirrors the real layouts. Regression tests cover far
  slots listed before S007 and the case where no slot fits.
- **Real end-to-end render** (local diagnostic, same code, nothing stored):
  - Window of 309 × 431 pixels; 2.71 MB downloaded, with no fill or
    out-of-range counts.
  - Navigation residual 0.004 pixel; native spacing 0.2596 × 0.3605 km;
    RKSI at row 540.94, column 1449.21.
  - All cells valid, with the sun at 16° (08:29 KST). PNG of 181 KB.
  - The scene was cloud-free, with the coastline and islands in place. The
    low sun leaves the blue haze expected from the approximate Rayleigh
    removal.

## Before activation

1. Done on October 31, 2026 (see
   [Activation and first live run](#activation-and-first-live-run)). For a
   future format change, compare one S007 `.das`, `.dds` and catalog with the
   synthetic fixture (`test/fixtures/goci2Synthetic.mjs`) and update the
   parser and fixture if they differ.
2. Done on October 30, 2026 (see [Release verification](#release-verification)).
   For any later redeploy, deploy the Convex code, schema and crons with the
   flag absent, before the frontend. If the frontend ships first, the missing
   query fails and an error boundary limits the damage to this card
   ("GOCI-II status could not load"). Verify that `seoulGoci2:getLatest`
   returns `approval_required` with no frames and that
   `seoulGoci2:requestRefresh` returns `approval_required` without queuing.
3. Set the flag only after the user confirms KHOA/NOSC approval of the scope
   above, then watch the first runs (collector status, failures, PNG size
   and appearance). The user set it on October 31 KST.

## References

- [Seoul data sources](./seoul.md#hourly-goci-ii-airport-view--october-30-2026)
- [RKSI satellite image loop](./seoul-satellite-loop.md)
- NOSC GOCI-II specification: `https://www.nosc.go.kr/eng/boardContents/actionBoardContentsCons0024.do`
- NOSC OPEN API terms: `https://www.nosc.go.kr/openapi/actionOpenApiIssue.do`
- GOCI-II time attribute names: [Satpy GOCI-II L2 reader](https://satpy.readthedocs.io/en/latest/api/satpy.readers.goci2_l2_nc.html)
