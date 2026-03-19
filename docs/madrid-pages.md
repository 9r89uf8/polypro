# Madrid Pages

Routes:

- `/madrid/today`
- `/madrid/day/[date]`

## Source And Scope

- Official source: authenticated AEMET AMA `metar-taf` search flow for `LEMD`
- Comparison source: NOAA `tgftp`
- Station: `LEMD` / Adolfo Suarez Madrid-Barajas
- Local timezone on the page: `Europe/Madrid`

The Madrid page stores the latest official AEMET METAR or SPECI rows as they
are seen live. It does not have a confirmed AEMET history endpoint wired, so
historical dates depend on rows that were already captured.

## Day Page

`/madrid/day/[date]` shows:

- latest stored official temperature
- day max and min from stored official rows
- a single official temperature line chart
- latest raw METAR
- a publish-race table for AEMET vs NOAA `tgftp`
- the raw stored observation rows with AEMET first-seen timestamps

When the selected date is the current Madrid date, the page bootstraps a fresh
official poll on load, and the `Refresh Current Data` button polls again.

## Publish Race

The publish-race table tracks first-seen timestamps for the same `LEMD` report
across:

- AEMET AMA
- NOAA `tgftp`

Official AEMET polling uses a short publish-race watch:

- start at `:03` and `:33`
- poll every `10s`
- run for `6m`

NOAA `tgftp` is sampled every minute so delayed mirrors are still recorded.

The race table is routine-only by default, so `SPECI` rows are filtered out.
