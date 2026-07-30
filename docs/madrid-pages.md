# Madrid Pages

Routes:

- `/madrid/today`
- `/madrid/day/[date]`

## Sources And Scope

The Madrid day page combines three temperature series:

- **AEMET hourly forecast** for municipality `28104` (Paracuellos de Jarama).
  This is the closest configured municipal forecast to Barajas, about 4.9 km
  from the airport; it is not an aerodrome forecast.
- **AEMET OpenData station 3129 observations** from Madrid Airport. These
  observations have 0.1°C precision but the source reports hourly.
- **Official LEMD METAR/SPECI actuals** fetched through the authenticated AEMET
  AMA `metar-taf` flow and the existing NOAA `tgftp` publish-race collector.
  The page can use whichever copy of a report is seen first. Routine METAR is
  normally half-hourly and reports whole-degree Celsius.

All page times use `Europe/Madrid`. Forecast points are positioned from
`forecastTimeLocal`; the page does not use `forecastTimeUtc` for chart
placement.

Historical METAR dates depend on rows already captured because no official
date-bounded AMA history endpoint is wired.

## Day Page

`/madrid/day/[date]` is a focused temperature view. It shows:

- the freshest airport observation available from station 3129 or the official
  METAR/SPECI feed, selected by observation timestamp; equal timestamps prefer
  METAR because its publication path is the faster of the two
- the maximum value in the selected date's AEMET hourly forecast
- the local peak time or contiguous peak window; all tied maximum forecast
  points are marked
- a Madrid-local clock with seconds
- late-aware countdowns for the next expected routine METAR publication and
  station 3129 temperature update
- one 24-hour chart containing the hourly forecast, station 3129 observations,
  and official METAR/SPECI actuals
- a horizontal forecast-maximum guide, shaded peak-time window, and a current
  Madrid-time line for today's chart
- Celsius/Fahrenheit switching, previous/next/today navigation, a date picker,
  and a manual live refresh

The page intentionally does not show the older cloud decoder, raw METAR block,
publish-race table, SYNOP line, daily METAR range cards, or raw-observation
table. Those collectors and stored tables still exist; they are simply outside
the focused day-page presentation.

The chart renders whenever any one of its forecast, station, or METAR datasets
has points. On narrow screens the full-day chart scrolls horizontally rather
than compressing all 24 hours into an unreadable width.

## Live Clock And Update Countdowns

The current Madrid date shows three live timing values:

- the current `Europe/Madrid` time, updated once per second
- the next routine METAR countdown
- the next station 3129 0.1°C countdown

The METAR countdown is anchored to the latest stored routine half-hour report.
Its target is the next nominal `:00` or `:30` observation plus the median valid
first-seen lag from the latest 24 routine reports. The fallback is four minutes
and twenty seconds when no recent lag samples are available. SPECI reports are
excluded because they are unscheduled and may arrive before the countdown
finishes.

The station countdown is anchored to the latest stored station 3129 observation.
Its target is the following nominal hourly observation. Once that boundary
passes, the page shows that it is awaiting the reading and separately counts
down to the next ten-minute backend source check. A source check does not imply
that the upstream hourly temperature has changed. The timing queries include
the previous Madrid date so the schedule remains available across midnight;
recent publish-race rows provide the same continuity for METAR timing.

If the expected target passes without a new corresponding row, the countdown
shows `Awaiting`. It does not roll forward until the new METAR or station
observation is actually stored. A routine METAR older than 90 minutes or a
station observation older than two hours is labelled `Feed delayed`. This makes
delayed publication visible instead of implying that an update occurred.

Historical dates keep the current Madrid clock but do not show live-source
countdowns.

## Refresh Behavior

For the current Madrid date, opening the page and pressing `Refresh live`
request:

- `madrid:pollLatestNoaaPublishRace`

The authenticated AMA action is not triggered by page visits. AMA remains part
of the background publish-race collector when that deployment has the approved
and configured credentials; the on-demand page path stays on NOAA plus AEMET
OpenData. AEMET OpenData is collected only by the scheduled backend jobs, not
once per page visitor; this avoids spending the provider's per-minute request
budget on frontend traffic.

The Convex queries remain subscribed after that refresh, so collector writes
appear without a page reload. Historical pages only show stored data and do not
run live external polls.

Background collection remains:

- an AEMET AMA/NOAA publish-race watch at `:03` and `:33`, polling every second
  for six minutes
- NOAA `tgftp` sampling every minute
- the AEMET municipal forecast collector every hour
- the station 3129 collector every ten minutes; the upstream observations
  themselves remain hourly
- the WMO 08221 SYNOP collector every ten minutes; SYNOP is not plotted on this
  page

## Publish Race

The backend continues to track first-seen timestamps for matching LEMD reports
across AEMET AMA and NOAA `tgftp`. The day page no longer displays that
diagnostic table.
