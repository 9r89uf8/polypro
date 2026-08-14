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
- KORD forecast snapshots and current temperature sources:
  - `docs/kord-forecast-snapshots.md`
  - Summary: documents `/kord/forecast-snapshots` UI, hourly collector in `convex/forecastCollector.js`, Microsoft+source ingest details, NOAA official-max table wiring, and provider-extension plan.
- Seoul data-source research and collector behavior:
  - `docs/seoul.md`
  - Summary: documents RKSI source research, measured latency, GK2A numerical-product discovery, reusable endpoint-research methods, approval requirements, and collector behavior.
- Seoul route behavior and page content:
  - `docs/seoul-pages.md`
  - Summary: documents `/seoul/today` and `/seoul/day/[date]`, their observations, forecast and solar-heating panels, refresh behavior, and backing Convex data.
- Mexico City/MMMX data-source research:
  - `docs/mexico.md`
  - Summary: documents official and high-frequency MMMX temperature-source research, measured cadence and latency, sensor provenance, AVIMET broker tests, SENEAM AWOS/PIIMET and SEMAR AION setup requirements, approval gates, and the future collector contract.
- High-frequency airport weather source research playbook:
  - `docs/high-frequency-airport-weather-research.md`
  - Summary: reusable evidence-led workflow for finding and validating minute-level airport weather sources, including official/provider mapping, hostname and archive research, manuals and procurement forensics, browser/app/APK analysis, image/OCR validation, cadence experiments, sensor provenance, approval gates, Brazil/Argentina localization, and the MMMX/SENEAM continuation checklist.
- London City/EGLC data-source research:
  - `docs/london.md`
  - Summary: documents the fastest verified public EGLC temperature sources, the permission-dependent NATS/LCY native-sensor path, the 2021 owner-linked TraVis/Wayback reconstruction, procurement and sensor-lineage evidence, measured METAR relay latency, WebTrak, nearby high-frequency context, approval boundaries, and the future collector contract.

When editing `/kord/month` or `/kord/day/[date]`, update `docs/kord-pages.md` in the same change.
When editing live METAR ingest functions in `convex/weather.js` (`pollLatestNoaaMetar`, `backfillTodayOfficialFromIem`, `upsertOfficialObservation`) or `/kord/day/[date]` live-mode polling behavior, update `docs/kord-live-today.md` in the same change.
When editing `/kord/today`, `convex/kordPhone.js`, `convex/kordPhoneNode.js`, `convex/http.js`, `convex/crons.js`, or `kordPhoneCalls` schema fields/indexes, update `docs/kord-phone-calls.md` in the same change.
When editing `/kord/forecast-snapshots`, `convex/forecastCollector.js`, or `kordForecastSnapshots` schema fields/indexes, update `docs/kord-forecast-snapshots.md` in the same change.
When changing Seoul data sources, collectors, schemas, schedules, or source-selection logic, update `docs/seoul.md` in the same change.
When editing `/seoul/today`, `/seoul/day/[date]`, or their user-visible refresh and polling behavior, update `docs/seoul-pages.md` in the same change.
When changing Mexico City/MMMX data sources, collectors, schemas, schedules, or source-selection logic, update `docs/mexico.md` in the same change.
When changing London City/EGLC data sources, collectors, schemas, schedules, or source-selection logic, update `docs/london.md` in the same change.

# Approval-gated external integrations

When an external API, dataset, automated download, account capability, or
other production integration requires provider, legal, contractual,
administrator, privacy, security, or data-owner approval, use a two-stage
release:

1. Build and test the complete feature behind a dedicated server-side Convex
   environment variable with a positive, specific name such as
   `NMSC_GK2A_ACCESS_APPROVED`. The Convex value is the production source of
   truth even when the UI is hosted elsewhere; a client-side or Vercel-only
   environment variable is not a substitute.
2. Treat only the exact string `true` as approval. A missing, empty, `false`,
   or unexpected value must fail closed.
3. Keep the approval flag separate from credentials. A working key, login,
   reachable endpoint, public page, or keyless download does not itself prove
   that production use is approved.
4. Enforce the flag in Convex before protected work can be queued or performed;
   a client-side check or disabled button is never the security boundary.
   Manual actions, crons, HTTP routes, retries, and other entry points must all
   use the same gate. If work can remain queued after approval is revoked, the
   worker must check the flag again immediately before the external request or
   side effect.
5. Deploy the code, schema, and schedules to production with the approval flag
   absent. Verify the disabled production state before activation. Code
   deployment and approval activation are separate operations.
6. Set the production flag only after the user confirms that the appropriate
   authority granted the required scope:

   ```text
   npx convex env set <APPROVAL_FLAG> true --prod
   ```

   Removing the flag must disable new protected work:

   ```text
   npx convex env remove <APPROVAL_FLAG> --prod
   ```

7. While disabled, expose an honest `approval required`, `setup required`, or
   unavailable state. Do not fabricate data, relabel a proxy as the protected
   source, or let a fallback bypass the gate. Evaluate and gate each fallback
   independently when required.
8. Document the flag name, approving authority and scope, disabled behavior,
   activation/removal commands, relevant contact or terms, and all protected
   entry points in the associated project documentation. Do not commit
   credentials or sensitive approval evidence.
9. If even development access requires approval, build and test with fixtures,
   mocks, or provider-sanctioned samples. Technical reachability is not
   authorization.

# important

Next.js build does not run in this environment because the Linux SWC binary is missing.
