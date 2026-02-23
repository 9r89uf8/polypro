# Agent Docs Index

- KORD route behavior and page content:
  - `docs/kord-pages.md`
  - Summary: documents what `/kord/month` and `/kord/day/[date]` show, how compute/force-recompute and skip logic work, what chart/table diagnostics appear on the day page, and which Convex tables back each view.
- KORD live-today ingest and polling:
  - `docs/kord-live-today.md`
  - Summary: documents live METAR ingest behavior on `/kord/day/[date]` (today mode), including NOAA polling + IEM backfill actions, dedupe/upsert logic, and known operational limits.
- KORD phone-call ingest and transcript parsing:
  - `docs/kord-phone-calls.md`
  - Summary: documents `/kord/today` phone UI, cron/manual enqueue flow, Twilio webhook processing, Whisper transcription temperature parsing, and `kordPhoneCalls` data model.

When editing `/kord/month` or `/kord/day/[date]`, update `docs/kord-pages.md` in the same change.
When editing live METAR ingest functions in `convex/weather.js` (`pollLatestNoaaMetar`, `backfillTodayOfficialFromIem`, `upsertOfficialObservation`) or `/kord/day/[date]` live-mode polling behavior, update `docs/kord-live-today.md` in the same change.
When editing `/kord/today`, `convex/kordPhone.js`, `convex/kordPhoneNode.js`, `convex/http.js`, `convex/crons.js`, or `kordPhoneCalls` schema fields/indexes, update `docs/kord-phone-calls.md` in the same change.


# important
Next.js build does not run in this environment because the Linux SWC binary is missing.