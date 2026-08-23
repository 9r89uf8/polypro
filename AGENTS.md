# Agent Docs Index


When editing `/kord/month` or `/kord/day/[date]`, update `docs/kord-pages.md` in the same change.
When editing live METAR ingest functions in `convex/weather.js` (`pollLatestNoaaMetar`, `backfillTodayOfficialFromIem`, `upsertOfficialObservation`) or `/kord/day/[date]` live-mode polling behavior, update `docs/kord-live-today.md` in the same change.
When editing `/kord/today`, `convex/kordPhone.js`, `convex/kordPhoneNode.js`, `convex/http.js`, `convex/crons.js`, or `kordPhoneCalls` schema fields/indexes, update `docs/kord-phone-calls.md` in the same change.
When editing `/kord/forecast-snapshots`, `convex/forecastCollector.js`, or `kordForecastSnapshots` schema fields/indexes, update `docs/kord-forecast-snapshots.md` in the same change.
When changing Seoul data sources, collectors, schemas, schedules, or source-selection logic, update `docs/seoul.md` in the same change.
When editing `/seoul/today`, `/seoul/day/[date]`, or their user-visible refresh and polling behavior, update `docs/seoul-pages.md` in the same change.
When changing Mexico City/MMMX data sources, collectors, schemas, schedules, or source-selection logic, update `docs/mexico-current.md` in the same change.
When editing `/mexico/edge`, its live-market/weather collectors, `mexicoEdge*` schema fields/indexes, or the user-visible timing and reaction-analysis behavior, follow and update `docs/mexico-edge.md` in the same change. Preserve the evidence, uncertainty, source-rejection, and approval boundaries in `docs/mexico-edge-investigation-2026-08-21.md`; update it or add a newer dated investigation when new production evidence changes those conclusions.
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
