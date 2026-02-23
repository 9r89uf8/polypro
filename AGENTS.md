# Agent Docs Index

- KORD route behavior and page content:
  - `docs/kord-pages.md`
  - Summary: documents what `/kord/month` and `/kord/day/[date]` show, how compute/force-recompute and skip logic work, what chart/table diagnostics appear on the day page, and which Convex tables back each view.
- KORD live-today ingest and polling:
  - `docs/kord-live-today.md`
  - Summary: documents `/kord/today` redirect behavior, day-page live mode rules, NOAA polling + IEM backfill actions, dedupe/upsert logic, and known operational limits.

When editing `/kord/month` or `/kord/day/[date]`, update `docs/kord-pages.md` in the same change.
When editing `/kord/today` or live ingest functions in `convex/weather.js` (`pollLatestNoaaMetar`, `backfillTodayOfficialFromIem`, `upsertOfficialObservation`), update `docs/kord-live-today.md` in the same change.
