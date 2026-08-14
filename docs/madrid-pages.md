# Madrid Pages

Routes:

- `/madrid/today`
- `/madrid/day/[date]`

## Sources And Scope

The Madrid day page can combine four separately labelled temperature series:

- **AEMET hourly forecast** for municipality `28104` (Paracuellos de Jarama).
  This is the closest configured municipal forecast to Barajas, about 4.9 km
  from the airport; it is not an aerodrome forecast.
- **AEMET OpenData station 3129 observations** from Madrid Airport. These
  observations have 0.1°C precision but the source reports hourly.
- **Official LEMD METAR/SPECI actuals** fetched through the authenticated AEMET
  AMA `metar-taf` flow and the existing NOAA `tgftp` publish-race collector.
  The page can use whichever copy of a report is seen first. Routine METAR is
  normally half-hourly and reports whole-degree Celsius.
- **LEMD ARR/DEP D-ATIS operational temperatures relayed by Airframes.** One
  whole-degree chart series can merge two independently approval-gated
  delivery paths: the existing one-minute REST lookup and the separately
  gated sampled Socket.IO stream. The REST key remains optional for the REST
  lookup. The selected stream is deliberately anonymous and never transmits
  that key; it uses `messages:sniff` and does not make the feed complete.
  Stream permission and provider operation are separate Convex gates:
  `AIRFRAMES_LEMD_STREAM_APPROVED` protects the authorized persistence/public
  display scope, while `AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED` is an
  exact-`true` connection kill switch. Approval alone does not open or
  reconnect a socket.
  Airframes reception is aircraft-demand driven, so it is not a direct
  sensor, guaranteed feed, or substitute for voice/controller information.
  D-ATIS remains distinct from METAR.

All page times use `Europe/Madrid`. Forecast points are positioned from
`forecastTimeLocal`; the page does not use `forecastTimeUtc` for chart
placement.

Historical METAR dates depend on rows already captured because no official
date-bounded AMA history endpoint is wired.

## Day Page

`/madrid/day/[date]` is a focused temperature view. It shows:

- the freshest airport observation available from station 3129, official
  METAR/SPECI, or enabled D-ATIS operational temperature, selected by
  report/observation timestamp; source labels never collapse D-ATIS into METAR
- the maximum value in the selected date's AEMET hourly forecast
- the local peak time or contiguous peak window; all tied maximum forecast
  points are marked
- a Madrid-local clock with seconds
- late-aware countdowns for the next expected routine METAR publication and
  station 3129 temperature update, plus an explicitly nominal ten-minute
  D-ATIS bulletin countdown when either protected delivery path is enabled
- a separate Airframes transport line that distinguishes the one-minute
  lookup from the live-stream state (`approval required`, provider connection
  paused with automatic reconnect disabled, `connecting`, `listening`,
  `backoff`, or stale/recovery pending)
- one 24-hour chart containing the hourly forecast, station 3129 observations,
  official METAR/SPECI actuals, and a separate violet D-ATIS point series when
  approved
- a horizontal forecast-maximum guide, shaded peak-time window, and a current
  Madrid-time line for today's chart
- Celsius/Fahrenheit switching, previous/next/today navigation, a date picker,
  and a manual live refresh

The page intentionally does not show the older cloud decoder, raw METAR block,
publish-race table, SYNOP line, daily METAR range cards, or raw-observation
table. Those collectors and stored tables still exist; they are simply outside
the focused day-page presentation.

The chart renders whenever any forecast, station, METAR, or approved D-ATIS
dataset has points. On narrow screens the full-day chart scrolls horizontally
rather than compressing all 24 hours into an unreadable width. REST and stream
copies of the same D-ATIS report are deduplicated into one point using the
earliest receipt; ARR and DEP reports with the same timestamp remain distinct.
The tooltip identifies which path saw a report first. Revoking the stream flag
hides stream-only rows without hiding an independently authorized REST copy.
Keeping stream approval true while the connection kill switch is false leaves
approved stored rows visible but labels the provider stream as paused; it does
not imply that another capture or retry is pending.
When both approvals are absent, the page plots zero protected rows; there is no
cached-data flash.

## Live Clock And Update Countdowns

The current Madrid date shows four live timing values:

- the current `Europe/Madrid` time, updated once per second
- the next nominal ten-minute D-ATIS bulletin boundary, or an honest
  `Approval required` state; when streaming is approved but it is the only
  authorized path and its provider connection is paused, this instead says
  `Connection paused`
- the next routine METAR countdown
- the next station 3129 0.1°C countdown

The D-ATIS value is a nominal operational bulletin cycle. It is never labelled
as the next stream message or guaranteed temperature update. Aircraft-demand
replies and Airframes sampling mean capture may arrive later or not at all.
Chart points use the embedded D-ATIS report time; tooltips and the
freshest-reading card separately expose relay delivery lag and the first-seen
delivery path. The stream health timestamp is connection provenance, not an
airport observation.

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
- `madridDatis:pollAirframesDatis`, only when the subscribed Convex query says
  the source is approved

The D-ATIS action independently repeats the server-side gate, so the client
decision is an optimization rather than the security boundary. METAR refresh
continues when the REST lookup is disabled. Page opening and `Refresh live`
never start, reconnect, or claim to refresh the WebSocket listener.

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
- the approval-gated Airframes D-ATIS scheduled action every minute; a shared
  60-second rolling cooldown prevents manual and scheduled requests from
  exceeding one provider attempt per minute; a jitter-early scheduled action
  waits the remaining cooldown and rechecks the gate rather than dropping the
  cycle, while persisted `Retry-After` deadlines can extend the pause
- the separately gated
  `madrid_airframes_datis_stream_supervisor_every_minute` watchdog. Both
  `AIRFRAMES_LEMD_STREAM_APPROVED=true` and
  `AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED=true` must be exact before it may
  schedule its bounded 8.5-minute Node listener. Generation fencing prevents
  duplicate persistence, a five-second dual-gate heartbeat closes after
  revocation or an operational pause, normal rotations queue the next
  dual-gated generation through the shared lease path, and failures use
  bounded backoff. While the connection flag is false, the watchdog opens no
  socket and schedules no reconnect even when approval remains true. Approval
  false additionally hides protected stream rows; connection false does not.
  Continuous dual-gate activation uses near-continuous Convex Node action
  compute.
- the AEMET municipal forecast collector every hour
- the station 3129 collector every ten minutes; the upstream observations
  themselves remain hourly
- the WMO 08221 SYNOP collector every ten minutes; SYNOP is not plotted on this
  page

## Airframes Stream Operational Pause

The Airframes connection kill switch defaults to `false` for development,
preview, and production. The page treats that independently from written
approval: an approved-but-paused response renders
`Live stream paused — Airframes unavailable` and
`Automatic reconnect disabled by Convex kill switch.` It never renders the
paused state as an approval failure or as pending automatic recovery.

The switch was added after `ws.airframes.io` returned pre-authentication
Cloudflare `502`/`503` responses to isolated clients and Airframes' own live
page on July 31, 2026 Madrid time. The inspected Airframes application bundle
also listened directly for `message`, while its published documentation
described `messages:sniff` plus a `messages:sniff:started` acknowledgement.
Before any later retry, obtain the required written approval, confirm the
current provider protocol, enable
`AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED=true` only for a controlled test, and
set it back to `false` if the provider or subscription is still unavailable.
The exact commands and rollback checklist are in `docs/spain.md`.

## Publish Race

The backend continues to track first-seen timestamps for matching LEMD reports
across AEMET AMA and NOAA `tgftp`. The day page no longer displays that
diagnostic table.
