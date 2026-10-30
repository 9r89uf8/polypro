# RKSI satellite image loop

The Seoul dashboard includes an airport-centered satellite animation for
visual inspection of cloud formations and movement. Its target is Incheon
International Airport, **RKSI, 37.4602° N, 126.4407° E**. This display does not
change the temperature forecast, cloud-trend model, or trading decisions.

## Source and permission

The source is JMA Himawari-9 Japan-area HSD imagery distributed by NOAA in
`https://noaa-himawari9.s3.amazonaws.com/`. The
[NOAA Open Data registry](https://registry.opendata.aws/noaa-himawari/)
explicitly permits free, open public distribution. Derived images retain
JMA/NOAA attribution and do not imply either agency's endorsement. No API key
or separate provider permission is required for this public distribution.

The feature has its own server-side **operational switch**,
`NOAA_HIMAWARI_IMAGES_ENABLED`. Only the exact string `true` enables it.
This is independent of `NMSC_GK2A_ACCESS_APPROVED` and
`NOAA_GK2A_CLOUD_ENABLED`; neither existing integration grants access to or
controls this loop. No protected KMA/NMSC endpoint or third-party viewer is
used as a fallback.

The app currently uses the explicitly selected Convex deployment
`striped-chipmunk-763`, which the CLI classifies as development even though it
backs the hosted app. The switch is managed there, not in Vercel:

```text
npx convex env set NOAA_HIMAWARI_IMAGES_ENABLED true --deployment-name striped-chipmunk-763
npx convex env remove NOAA_HIMAWARI_IMAGES_ENABLED --deployment-name striped-chipmunk-763
```

The queue, worker, frame-save mutation and public query all enforce this
switch. Code is initially deployed with it absent and disabled behavior is
verified before activation. Removing it prevents new collection and hides
frames from the query; independent retention cleanup continues deleting
expired image blobs and their database rows.

## What the images show

- **Visible:** B03, 0.64 µm, using the embedded updated calibration. A fixed
  solar-angle normalization and display scale make successive images
  comparable. Frames below the visual daylight threshold are unavailable.
  This visual threshold is separate from the stricter forecasting-model
  screen used in the earlier research.
- **Infrared:** B13, 10.4 µm, using the embedded Planck calibration. A fixed
  190–300 K brightness-temperature scale makes colder features lighter.
  This mode works in daylight and at night. Brightness temperature is not
  airport air temperature or a measured cloud-cover percentage.

Images cover a fixed **100 × 100 km** ground-coordinate square around RKSI,
with north at the top. Nearest-neighbor sampling preserves the source cells;
the 256 × 256 display grid does not create additional satellite detail.
The visible band's nominal resolution is 500 m at the sub-satellite point,
and actual sampling near RKSI is approximately 550 × 730 m. Infrared is
coarser. The airport marker is anchored to the exact coordinate rather than
the center of the nearest source pixel.

The viewer defaults to **50 km across**, with 20, 50 and 100 km options.
Zooming changes the displayed area only. All frames use the same geometry,
crop, contrast and orientation. Missing or rejected pixels are distinct from
ordinary dark image pixels. No generated imagery or spatial smoothing is used.

Cloud height and satellite parallax are not corrected. The airport marker
shows a ground location; elevated clouds can appear displaced. A visible
image alone does not classify clouds or establish direct sunlight at RKSI.
The display is intended to inspect formations and movement.

## Collection, storage and retention

The shared Convex cron queues a refresh every minute, independently of open
browser tabs. Himawari Japan-area observations are nominally **2.5 minutes**
apart. The collector discovers actual NOAA objects and captures each
available supported visible/infrared frame in the trailing hour; it does not
invent missing slots or sample every other image.

The collector has one station-wide lease and bounded batches. Page-entry and
manual refresh requests share the same queue, deduplication and cooldown as
the cron. Continuation work keeps the same run identity, checks enablement
again, and stops when the retained window is filled or no eligible data is
available. A failed object is recorded without blocking the remaining images;
failed keys are retried on later refreshes within the retained window. Failure
records are bounded to 50 keys and remain visible in the player. A failed
listing stops that run rather than accepting an incomplete discovery result.

Only airport JPEG derivatives and source/timing metadata are retained in
Convex storage and the database. Compressed regional objects and expanded
raw arrays are temporary worker memory. Requests use the fixed NOAA host,
reject redirects, and enforce byte and timeout limits. The decoder validates
the satellite, band, regional identity, shape, calibration, navigation,
quality and embedded scan times before accepting a frame.

Retention is **60 minutes relative to the current time**, using actual
estimated airport acquisition time. The query and browser both exclude
expired frames; a separate one-minute cleanup removes their stored blobs and
rows. A delayed provider therefore yields a shorter available sequence,
rather than an old hour presented as current. The initial hour fills from
available recent source objects after activation.

Uploads carry the dedicated JPEG MIME profile `rksi-himawari-loop-v1`.
In addition to per-upload cleanup, the retention job advances a persisted
cursor through 200 storage records per run and removes only unreferenced
files with that exact profile once they are at least five minutes old. This
recovers files left by interrupted workers; the full sweep duration depends
on total storage size. Referenced frames and other integrations' files are
preserved, and this cleanup also runs while collection is disabled.

## Playback and clocks

The player provides play/pause, previous/next frame, a scrubber, playback
speed and zoom controls. Frames play in chronological order. The observed
timestamp advances with the displayed image; missing frames and gaps remain
visible. Playback is an accelerated sequence, not a real-time video feed.

Every displayed time uses **KST with AM/PM**, including seconds where needed
for the 2.5-minute cadence. Acquisition time is interpolated from embedded
line-time records and is distinct from nominal slot, NOAA object modification,
download and database capture clocks. The UI labels stale imagery and never
claims the observation is current merely because a refresh succeeded.

The live loop is available only on today's Seoul page. Past and future date
pages do not start collection or display the current loop as historical
imagery. At KST midnight the date check prevents a previous-day page from
continuing to masquerade as live.

## References

- [JMA AHI bands and regional observation cadence](https://www.data.jma.go.jp/mscweb/en/himawari89/space_segment/spsg_ahi.html)
- [NOAA public distribution terms](https://registry.opendata.aws/noaa-himawari/)
- [Earlier HSD navigation and calibration review](./seoul-himawari-review-2026-10-29.md)
- [Seoul dashboard behavior](./seoul-pages.md)

## Release verification

Forty focused tests cover the decoder, source discovery, server-side switch,
worker ownership, rolling retention, failure recovery and browser player
state. They include retained real B03/B13 files checked against an independent
Python calculation, a persistent source failure followed by valid older
frames, and orphan cleanup after an upload is interrupted before scheduling.

The actual player was exercised in a browser with clearly labeled fixtures
at desktop, 390 px and 320 px widths. Playback, keyboard scrubbing, zoom,
channel switching, missing images, nighttime, expired data and non-live dates
were checked. The local Next.js build is unavailable in this environment;
frontend compilation is checked by the hosted Vercel build.

On October 30 KST the backend and indexes were deployed to
`striped-chipmunk-763` with `NOAA_HIMAWARI_IMAGES_ENABLED` absent. The live
`getLoop` query returned disabled with no frames, and `requestRefresh`
returned disabled without queuing work, before collection was enabled.
