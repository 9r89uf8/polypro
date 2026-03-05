# Weather.com Crawl Implementation Checklist (KORD)

This checklist turns the Weather.com crawl plan into concrete, executable work for this repo.

## Goal

- Add Weather.com as a new forecast provider and current-temperature source on `/kord/forecast-snapshots`.
- Use website crawling flow (no owned Weather.com API account key).
- Keep existing snapshot behavior intact for Microsoft, AccuWeather, Google, NOAA, IEM, and Open-Meteo.

## Scope

- Station: `KORD`
- URL: `https://weather.com/weather/tenday/l/5473f6c4da1a6479bbeaa444d174bea30ba2252fbbb29ec330b761a58a55287b`
- Cadence: same hourly snapshot job already used by `forecastCollector:collectKordHourlySnapshot`

## Phase 0: Decision Gate (Required)

- [ ] Confirm runtime strategy with one short spike:
- [ ] Try extracting usable weather payload from a plain HTML fetch of the Weather.com tenday page.
- [ ] Pass criteria: parseable current temp and at least 5 forecast days from fetched page artifacts only.
- [ ] If spike passes: implement in `convex/forecastCollector.js` with fetch + parser.
- [ ] If spike fails: move crawler to an external Node worker (Playwright), then feed normalized results into Convex.
- [ ] Record final architecture decision at top of this file before implementation starts.

## Phase 1: Data Contract Lock

- [ ] Lock normalized Weather.com provider names:
- [ ] Forecast provider status field names: `weathercomStatus`, `weathercomError`, `weathercomForecastDays`.
- [ ] Current reading source name in `actualReadings`: `weathercom_current`.
- [ ] Lock normalized forecast day shape to match existing provider shape:
- [ ] `date`, `minTempC`, `minTempF`, `maxTempC`, `maxTempF`, `dayPhrase`, `nightPhrase`.
- [ ] Lock validation gates:
- [ ] Forecast success requires at least 5 valid rows.
- [ ] Current success requires parseable temperature and observed time when available.

## Phase 2: Schema + Types

Target file: `convex/schema.js`

- [ ] Add optional Weather.com forecast status fields to `kordForecastSnapshots`:
- [ ] `weathercomStatus` (`ok` | `error`) optional.
- [ ] `weathercomError` optional string.
- [ ] `weathercomForecastDays` optional array with same object validator used by other forecast providers.
- [ ] Keep backwards compatibility by making new Weather.com fields optional.
- [ ] Ensure `actualReadings` validator still accepts new source value `weathercom_current` through generic `source: v.string()`.

## Phase 3: Collector Integration

Target file: `convex/forecastCollector.js`

- [ ] Add Weather.com constants:
- [ ] `WEATHERCOM_TENDAY_URL` for KORD.
- [ ] Add Weather.com helper functions:
- [ ] Crawl function for page fetch or worker-call, based on Phase 0 decision.
- [ ] Parser function that returns normalized `forecastDays` and `currentReading`.
- [ ] Validation function that enforces minimum viable payload.
- [ ] Error formatter for crawler/parser failures.
- [ ] Integrate Weather.com call into existing `Promise.all` in `collectKordHourlySnapshot`.
- [ ] Include Weather.com status + error + forecast rows in inserted snapshot payload.
- [ ] Append Weather.com current reading to `actualReadings`.
- [ ] Update snapshot status computation so Weather.com forecast failure contributes to provider-error count.
- [ ] Keep all existing provider behavior unchanged.

## Phase 4: Insert Mutation Args

Target file: `convex/forecastCollector.js` (`insertSnapshot` args and insert payload)

- [ ] Add optional Weather.com args to `insertSnapshot`:
- [ ] `weathercomStatus`, `weathercomError`, `weathercomForecastDays`.
- [ ] Pass Weather.com values from `collectKordHourlySnapshot` into `insertSnapshot`.
- [ ] Preserve current `ok`/`partial`/`error` semantics with Weather.com included in forecast-provider health.

## Phase 5: UI Integration

Target file: `app/kord/forecast-snapshots/page.js`

- [ ] Add Weather.com status card in latest snapshot summary.
- [ ] Add Weather.com 5-day table section:
- [ ] Columns: `date`, `max F`, `day phrase`, `night phrase`.
- [ ] Do not add a `Min F` column.
- [ ] Add Weather.com current source row to current-temperature section.
- [ ] Add Weather.com status/error and current reading into recent hourly history table.
- [ ] Keep source order readable and deterministic.

## Phase 6: Cron + Trigger Behavior

Target file: `convex/crons.js` (only if job naming/comment updates are needed)

- [ ] Keep existing hourly cron schedule unchanged unless explicitly changing cadence.
- [ ] Update comments/job description to include Weather.com provider.

## Phase 7: Docs Update

Target file: `docs/kord-forecast-snapshots.md`

- [ ] Add Weather.com to route purpose summary.
- [ ] Document Weather.com collector path and status/error behavior.
- [ ] Document Weather.com schema fields on `kordForecastSnapshots`.
- [ ] Document Weather.com as a current-temperature source (`weathercom_current`).
- [ ] Update status logic description to include Weather.com forecast provider count.

## Phase 8: Validation Checklist (Manual)

- [ ] Run one manual `Collect Now` on `/kord/forecast-snapshots`.
- [ ] Confirm Weather.com status appears in latest snapshot card.
- [ ] Confirm Weather.com current temp appears in current sources.
- [ ] Confirm Weather.com 5-day table renders with 5 rows minimum.
- [ ] Confirm no `Min F` column is shown on Weather.com table.
- [ ] Confirm recent history rows include Weather.com status and current reading.
- [ ] Confirm a forced failure path marks Weather.com as `error` and snapshot as `partial` (not total failure if others succeed).

## Phase 9: Operational Safety

- [ ] Keep crawl cadence at hourly max.
- [ ] Add retry with backoff for transient failures.
- [ ] Store short raw diagnostics (`raw`/`error`) for failure triage.
- [ ] Add guardrails for payload drift:
- [ ] If parser shape changes, mark Weather.com provider error and continue snapshot insert.

## Definition of Done

- [ ] Weather.com forecast + current data are captured hourly in `kordForecastSnapshots`.
- [ ] UI shows Weather.com forecast and current values alongside other providers.
- [ ] Existing providers are unaffected.
- [ ] `docs/kord-forecast-snapshots.md` reflects the final implementation.
