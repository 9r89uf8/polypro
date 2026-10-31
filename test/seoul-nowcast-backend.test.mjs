import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import schema from "../convex/schema.js";
import * as backend from "../convex/seoulNowcast.js";
import { upsertAmosRowsBatch } from "../convex/seoul.js";
import { buildNowcast, NOWCAST_MODEL_VERSION } from "../convex/lib/seoulNowcastModel.js";

const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const NOW = Date.parse("2026-10-31T02:00:20Z");
const OBS = Math.floor(NOW / MINUTE) * MINUTE;
const VERSION_TABLE = "seoulNowcastObservationVersions";
const FORECAST_TABLE = "seoulNowcastForecasts";
const OUTCOME_TABLE = "seoulNowcastOutcomes";
const localDate = time => new Date(time + 9 * 60 * MINUTE).toISOString().slice(0, 10);

function observation(obsTimeUtc = OBS, changes = {}) {
  return {
    stationIcao: "RKSI", date: localDate(obsTimeUtc), obsTimeUtc,
    obsTimeLocal: new Date(obsTimeUtc + 9 * 60 * MINUTE).toISOString().replace("T", " ").slice(0, 19),
    collectionCadence: "one_minute", rwyNo: "2", rwyDir: "15L", rwyUse: "1", rwyMain: "Y",
    tempC: 20, tempF: 68, dewpointC: 12, dewpointF: 53.6, qnhHpa: 1015, qnhInHg: 29.97,
    windDirAvg: 270, windDirMin: 250, windDirMax: 290,
    windSpeedAvg: 8, windSpeedMin: 5, windSpeedMax: 10,
    crosswind: "3", headtail: "7", morMeters: 10000, rvrMeters: "P2000", precipMm: 0,
    source: "amo_amos", rawJson: "{\"fixture\":true}", ...changes,
  };
}

// Execute the actual mutation/query handlers with detached reads and the real
// schema's index order. Scheduler work runs only when a test explicitly asks.
function harness(initialNow = NOW) {
  let now = initialNow, nextId = 0;
  const tables = Object.fromEntries(Object.keys(schema.tables).map(table => [table, []]));
  const calls = { scheduled: [], writes: [], external: [] };
  const getRow = id => Object.values(tables).flat().find(row => row._id === id);
  const compare = (a, b) => a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1;
  const db = {
    query(table) {
      assert.ok(tables[table], `Unknown table ${table}`);
      const predicates = [];
      let indexFields = [], direction = 1;
      const selector = Object.fromEntries(["eq", "lt", "lte", "gt", "gte"].map(op => [op, (field, value) => {
        predicates.push(row => ({ eq: row[field] === value, lt: row[field] < value, lte: row[field] <= value,
          gt: row[field] > value, gte: row[field] >= value })[op]);
        return selector;
      }]));
      function selected() {
        return tables[table].filter(row => predicates.every(fn => fn(row))).sort((a, b) => {
          for (const field of [...indexFields, "_creationTime", "_id"]) {
            const difference = compare(a[field], b[field]);
            if (difference) return direction * difference;
          }
          return 0;
        }).map(row => structuredClone(row));
      }
      const query = {
        withIndex(name, fn) {
          const index = schema.tables[table].indexes.find(value => value.indexDescriptor === name);
          assert.ok(index, `Unknown index ${table}.${name}`);
          indexFields = index.fields;
          fn?.(selector);
          return query;
        },
        order(value) { direction = value === "desc" ? -1 : 1; return query; },
        async first() { return selected()[0] ?? null; },
        async unique() { const rows = selected(); assert.ok(rows.length <= 1); return rows[0] ?? null; },
        async collect() { return selected(); },
        async take(count) { return selected().slice(0, count); },
        async paginate({ cursor, numItems }) {
          const rows = selected(), offset = Number(cursor ?? 0);
          return { page: rows.slice(offset, offset + numItems), isDone: offset + numItems >= rows.length,
            continueCursor: String(offset + numItems) };
        },
      };
      return query;
    },
    async get(id) { return structuredClone(getRow(id) ?? null); },
    async insert(table, fields) {
      assert.ok(tables[table], `Unknown table ${table}`);
      const row = { ...structuredClone(fields), _id: `${table}:${++nextId}`, _creationTime: now + nextId / 1000 };
      tables[table].push(row);
      calls.writes.push({ op: "insert", table, id: row._id });
      return row._id;
    },
    async patch(id, fields) {
      const row = getRow(id); assert.ok(row, `Missing row ${id}`);
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete row[key]; else row[key] = structuredClone(value);
      }
      calls.writes.push({ op: "patch", id });
    },
    async delete(id) {
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex(row => row._id === id);
        if (index >= 0) { rows.splice(index, 1); calls.writes.push({ op: "delete", id }); return; }
      }
      throw new Error(`Missing deletion row ${id}`);
    },
  };
  const ctx = { db, scheduler: { async runAfter(delay, reference, args = {}) {
    const name = typeof reference === "string" ? reference : getFunctionName(reference);
    calls.scheduled.push({ delay, name, args: structuredClone(args) });
    return `scheduled:${calls.scheduled.length}`;
  } } };
  const invoke = async (handler, args) => {
    const oldNow = Date.now, oldFetch = globalThis.fetch;
    Date.now = () => now;
    globalThis.fetch = async (...input) => { calls.external.push(input); throw new Error("Unexpected external request"); };
    try { return await handler(ctx, args); }
    finally { Date.now = oldNow; globalThis.fetch = oldFetch; }
  };
  const call = (name, args = {}) => {
    assert.equal(typeof backend[name]?._handler, "function", `Missing handler ${name}`);
    return invoke(backend[name]._handler, args);
  };
  const ingest = rows => invoke(upsertAmosRowsBatch._handler, { stationIcao: "RKSI", rows });
  return { tables, calls, db, ctx, call, ingest,
    setNow(value) { now = value; }, get now() { return now; },
    versions: () => tables[VERSION_TABLE], forecasts: () => tables[FORECAST_TABLE], outcomes: () => tables[OUTCOME_TABLE],
    issue: (obsTimeUtc = OBS) => call("issueForObservation", { stationIcao: "RKSI", obsTimeUtc }),
    async seedHistory({ end = OBS, count = 60, secondary = true } = {}) {
      for (let i = count - 1; i >= 0; i--) {
        const time = end - i * MINUTE;
        now = time + 20_000;
        const rows = [observation(time, { tempC: 20 - i * 0.02 })];
        if (secondary) rows.push(observation(time, { rwyNo: "3", rwyDir: "16L", tempC: 19.5 - i * 0.02 }));
        await ingest(rows);
      }
    },
  };
}

test("ingestion snapshots only canonical minute sites, preserves source fields, and schedules primary minutes once", async () => {
  const h = harness();
  const primary = observation();
  const secondary = observation(OBS, { rwyNo: "3", rwyDir: "16L", tempC: 19.5 });
  await h.ingest([primary, secondary,
    observation(OBS, { collectionCadence: "five_minute" }),
    observation(OBS, { rwyNo: "2", rwyDir: "33R" }),
    observation(OBS, { stationIcao: "RKSS", rwyNo: "2", rwyDir: "15L" }),
  ]);
  assert.equal(h.versions().length, 2);
  const captured = h.versions().find(row => row.rwyDir === "15L");
  for (const [key, value] of Object.entries(primary)) {
    if (!["date", "tempF", "dewpointF", "qnhInHg", "rawJson"].includes(key)) {
      assert.deepEqual(captured[key], value, `source field ${key}`);
    }
  }
  assert.equal(captured.receivedAt, NOW);
  assert.deepEqual(h.calls.scheduled.map(({ name, args }) => ({ name, args })), [
    { name: "seoulNowcast:issueForObservation", args: { stationIcao: "RKSI", obsTimeUtc: OBS } },
  ]);
  h.setNow(NOW + 10_000);
  await h.ingest([primary, secondary]);
  assert.equal(h.versions().length, 2, "repeat polling is not a new source version");
  assert.equal(h.calls.scheduled.length, 1, "repeat polling cannot queue duplicate forecasts");
  assert.deepEqual(h.calls.external, []);
});

test("corrections append versions with their own receipt clock and leave prior versions intact", async () => {
  const h = harness();
  await h.ingest([observation()]);
  const original = structuredClone(h.versions()[0]);
  h.setNow(NOW + 30_000);
  await h.ingest([observation(OBS, { tempC: 21, rawJson: "{\"corrected\":true}" })]);
  assert.equal(h.versions().length, 2);
  assert.deepEqual(h.versions()[0], original);
  assert.equal(h.versions()[1].receivedAt, NOW + 30_000);
  assert.equal(h.versions()[1].sourceFirstSeenAt, NOW);
  assert.equal(h.calls.scheduled.length, 1, "a revised minute does not issue a second forecast");
});

test("the first capture after release never backdates availability to an existing mutable observation", async () => {
  const h = harness();
  await h.db.insert("seoulAmosObservations", { ...observation(), firstSeenAt: OBS + 1_000, updatedAt: OBS + 1_000 });
  await h.ingest([observation()]);
  assert.equal(h.versions().length, 1);
  assert.equal(h.versions()[0].receivedAt, NOW);
  assert.equal(h.versions()[0].sourceFirstSeenAt, OBS + 1_000);
  assert.equal(h.calls.scheduled.length, 1);
});

test("issuance freezes available inputs, forecasts and distinct outcomes, and retries are idempotent", async () => {
  const h = harness();
  await h.seedHistory();
  const receiptTime = h.now;
  h.setNow(receiptTime + 5_000);
  const issued = await h.issue();
  assert.equal(issued.status, "ready");
  assert.equal(h.forecasts().length, 1);
  const forecast = structuredClone(h.forecasts()[0]);
  assert.equal(forecast.issuedAt, receiptTime + 5_000, "issue clock is when the worker actually ran");
  assert.equal(forecast.modelVersion, NOWCAST_MODEL_VERSION);
  assert.equal(forecast.features.latest15L.tempC, 20);
  assert.equal(forecast.features.latest16L.tempC, 19.5);
  assert.equal(forecast.intervalStatus, "insufficient_calibration");
  assert.ok(forecast.inputVersionIds.length >= 100, "the preceding hour is captured, not just the latest row");
  assert.ok(forecast.inputVersionIds.every(id => h.versions().some(row => row._id === id && row.receivedAt <= forecast.issuedAt)));
  assert.deepEqual(h.outcomes().map(row => [row.horizonMinutes, row.targetTimeUtc, row.status]),
    [10, 15, 20].map(horizon => [horizon, OBS + horizon * MINUTE, "pending"]));
  assert.ok(h.outcomes().every(row => row.forecastId === forecast._id));
  assert.equal((await h.issue()).status, "duplicate");
  h.setNow(NOW + 35_000);
  await h.ingest([observation(OBS, { tempC: 25 })]);
  assert.equal((await h.issue()).status, "duplicate");
  assert.deepEqual(h.forecasts(), [forecast], "upstream correction and retry cannot rewrite an issued forecast");
  assert.equal(Object.hasOwn(forecast.features, "primaryHistory"), false);
  assert.equal(Object.hasOwn(forecast.features, "secondaryHistory"), false);
  const replay = buildNowcast({
    versions: forecast.inputVersionIds.map(id => h.versions().find(row => row._id === id)),
    issuedAt: forecast.issuedAt, triggerObsTimeUtc: forecast.triggerObsTimeUtc,
  });
  const { primaryHistory, secondaryHistory, ...replayedFeatures } = replay.features;
  assert.ok(primaryHistory.length > 1 && secondaryHistory.length > 1);
  assert.deepEqual(replay.predictions, forecast.predictions, "saved immutable IDs reproduce predictions after a later source correction");
  assert.deepEqual(replayedFeatures, forecast.features, "compact stored features retain exact replayability");
  assert.deepEqual(replay.inputVersionIds, forecast.inputVersionIds);
  assert.equal(h.outcomes().length, 3);
  assert.ok(h.tables.seoulNowcastDailyScores.every(row => row.issuedCount === 1));
  assert.deepEqual(h.calls.external, []);
});

test("a correction received before the worker runs is included without backdating the issue", async () => {
  const h = harness();
  await h.seedHistory();
  h.setNow(NOW + 10_000);
  await h.ingest([observation(OBS, { tempC: 20.2 })]);
  const correction = h.versions().at(-1);
  h.setNow(NOW + 15_000);
  await h.issue();
  assert.equal(h.forecasts()[0].features.latest15L.tempC, 20.2);
  assert.equal(h.forecasts()[0].features.latest15L.versionId, correction._id);
  assert.equal(h.forecasts()[0].issuedAt, NOW + 15_000);
});

test("delayed workers skip superseded triggers and cannot backfill forecasts from stale readings", async () => {
  const superseded = harness();
  await superseded.seedHistory();
  superseded.setNow(NOW + MINUTE);
  await superseded.ingest([observation(OBS + MINUTE)]);
  assert.equal((await superseded.issue(OBS)).status, "superseded");
  assert.equal(superseded.forecasts().length, 0);
  assert.equal(superseded.outcomes().length, 0);
  await superseded.issue(OBS + MINUTE);
  assert.equal(superseded.forecasts()[0].issuedAt, NOW + MINUTE);
  assert.deepEqual(superseded.forecasts()[0].predictions.map(row => row.targetTimeUtc),
    [10, 15, 20].map(horizon => OBS + (horizon + 1) * MINUTE));

  const stale = harness();
  await stale.seedHistory();
  stale.setNow(OBS + 3 * MINUTE);
  assert.equal((await stale.issue()).status, "unavailable");
  assert.equal(stale.forecasts()[0].reasonCode, "amos_stale");
  assert.equal(stale.forecasts()[0].issuedAt, OBS + 3 * MINUTE);
  assert.deepEqual(stale.forecasts()[0].predictions, []);
  assert.deepEqual(stale.outcomes(), []);
});

test("source history and target scoring span Korean midnight without mixing issue-day attribution", async () => {
  const midnight = Date.parse("2026-10-31T15:00:00Z");
  const h = harness(midnight + 20_000);
  await h.seedHistory({ end: midnight });
  await h.issue(midnight);
  const forecast = h.forecasts()[0];
  assert.equal(forecast.date, "2026-11-01");
  assert.ok(forecast.inputVersionIds.some(id => h.versions().some(row => row._id === id && row.obsTimeUtc < midnight)));
  assert.equal(forecast.qualityStatus, "ready");
  const target = midnight + 10 * MINUTE;
  h.setNow(target + 20_000);
  await h.ingest([observation(target, { tempC: 21 })]);
  await h.call("scorePending");
  assert.equal(h.outcomes().find(row => row.horizonMinutes === 10).status, "scored");
  const today = await h.call("getDashboard", { stationIcao: "RKSI", date: "2026-11-01" });
  const yesterday = await h.call("getDashboard", { stationIcao: "RKSI", date: "2026-10-31" });
  assert.equal(today.latest.id, forecast._id);
  assert.equal(yesterday.latest, null);
  assert.equal(today.metrics.find(row => row.horizonMinutes === 10).scoredCount, 1);
});

test("a forecast issued before Korean midnight is scored on its issue day when the target falls tomorrow", async () => {
  const issueMinute = Date.parse("2026-10-31T14:59:00Z");
  const h = harness(issueMinute + 20_000);
  await h.seedHistory({ end: issueMinute });
  await h.issue(issueMinute);
  const target = issueMinute + 10 * MINUTE;
  assert.equal(h.forecasts()[0].date, "2026-10-31");
  assert.equal(localDate(target), "2026-11-01");
  h.setNow(target + 20_000);
  await h.ingest([observation(target, { tempC: 21 })]);
  await h.call("scorePending");
  const outcome = h.outcomes().find(row => row.horizonMinutes === 10);
  assert.equal(outcome.date, "2026-10-31");
  assert.equal(outcome.status, "scored");
  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: "2026-10-31" });
  assert.equal(view.latest.predictions.find(row => row.horizonMinutes === 10).status, "scored");
  assert.equal(view.metrics.find(row => row.horizonMinutes === 10).scoredCount, 1);
});

test("outcomes use the first valid captured exact-minute primary version, with no interpolation or rewriting", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  const frozenForecast = structuredClone(h.forecasts()[0]);
  const target = OBS + 10 * MINUTE;
  h.setNow(target + 5_000);
  await h.ingest([
    observation(target - MINUTE, { tempC: 21 }),
    observation(target + MINUTE, { tempC: 21.1 }),
    observation(target, { rwyNo: "3", rwyDir: "16L", tempC: 22 }),
    observation(target, { collectionCadence: "five_minute", tempC: 22 }),
    observation(target, { tempC: -999 }),
  ]);
  await h.call("scorePending");
  assert.equal(h.outcomes().find(row => row.horizonMinutes === 10).status, "pending");
  h.setNow(target + 15_000);
  await h.ingest([observation(target, { tempC: 21.2 })]);
  const firstValid = h.versions().at(-1);
  h.setNow(target + 25_000);
  await h.ingest([observation(target, { tempC: 25 })]);
  await h.call("scorePending");
  const result = structuredClone(h.outcomes().find(row => row.horizonMinutes === 10));
  assert.equal(result.status, "scored");
  assert.equal(result.actualC, 21.2);
  assert.equal(result.observationVersionId, firstValid._id);
  assert.equal(result.targetReceivedAt, target + 15_000);
  assert.ok(Math.abs(result.persistenceErrorC - (20 - 21.2)) < 1e-10);
  const stats = structuredClone(h.tables.seoulNowcastDailyScores);
  h.setNow(target + 60_000);
  await h.ingest([observation(target, { tempC: 30 })]);
  await h.call("scorePending");
  assert.deepEqual(h.outcomes().find(row => row.horizonMinutes === 10), result);
  assert.deepEqual(h.tables.seoulNowcastDailyScores, stats);
  assert.deepEqual(h.forecasts(), [frozenForecast]);
});

test("missing targets finalize after the wait window and late corrections cannot resurrect them", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  const target = OBS + 10 * MINUTE;
  h.setNow(target + 30 * MINUTE - 1);
  await h.call("scorePending");
  assert.equal(h.outcomes().find(row => row.horizonMinutes === 10).status, "pending");
  h.setNow(target + 30 * MINUTE);
  await h.call("scorePending");
  const missing = structuredClone(h.outcomes().find(row => row.horizonMinutes === 10));
  assert.equal(missing.status, "missing");
  h.setNow(target + 30 * MINUTE + 1);
  await h.ingest([observation(target, { tempC: 21 })]);
  await h.call("scorePending");
  assert.deepEqual(h.outcomes().find(row => row.horizonMinutes === 10), missing);
  assert.equal(h.tables.seoulNowcastDailyScores.find(row => row.horizonMinutes === 10).missingCount, 1);
});

test("a delayed scoring worker honors the target receipt deadline, not its own run time", async () => {
  const accepted = harness();
  await accepted.seedHistory();
  await accepted.issue();
  const target = OBS + 10 * MINUTE;
  accepted.setNow(target + 30 * MINUTE);
  await accepted.ingest([observation(target, { tempC: 21 })]);
  accepted.setNow(target + 2 * 60 * MINUTE);
  await accepted.call("scorePending");
  assert.equal(accepted.outcomes().find(row => row.horizonMinutes === 10).status, "scored");

  const late = harness();
  await late.seedHistory();
  await late.issue();
  late.setNow(target + 30 * MINUTE + 1);
  await late.ingest([observation(target, { tempC: 21 })]);
  await late.call("scorePending");
  assert.equal(late.outcomes().find(row => row.horizonMinutes === 10).status, "missing");
});

test("many invalid target revisions cannot conceal a valid in-window target", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  const target = OBS + 10 * MINUTE;
  for (let i = 0; i < 105; i++) {
    h.setNow(target + 1_000 + i);
    await h.ingest([observation(target, { tempC: -999, windDirAvg: i })]);
  }
  h.setNow(target + 20_000);
  await h.ingest([observation(target, { tempC: 21 })]);
  h.setNow(target + 31 * MINUTE);
  await h.call("scorePending");
  const scored = h.outcomes().find(row => row.horizonMinutes === 10);
  assert.equal(scored.status, "scored");
  assert.equal(scored.actualC, 21);
});

test("removing a temperature creates an honest invalid version instead of reviving an older value", async () => {
  const h = harness();
  await h.seedHistory();
  h.setNow(NOW + 10_000);
  const corrected = observation();
  delete corrected.tempC;
  await h.ingest([corrected]);
  assert.equal(h.versions().at(-1).tempC, undefined);
  await h.issue();
  assert.equal(h.forecasts()[0].qualityStatus, "unavailable");
  assert.equal(h.forecasts()[0].reasonCode, "invalid_latest_temperature");
  assert.deepEqual(h.outcomes(), []);
});

test("dashboard compares damped forecasts with persistence on the same scored subset across days", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  const pairedPrediction = h.forecasts()[0].predictions.find(row => row.horizonMinutes === 10);
  h.setNow(OBS + 10 * MINUTE + 20_000);
  await h.ingest([observation(OBS + 10 * MINUTE, { tempC: 21 })]);
  await h.call("scorePending");

  h.setNow(NOW + DAY);
  await h.ingest([observation(OBS + DAY, { tempC: 20 })]);
  await h.issue(OBS + DAY);
  assert.equal(h.forecasts().at(-1).qualityStatus, "persistence_only");
  h.setNow(OBS + DAY + 10 * MINUTE + 20_000);
  await h.ingest([observation(OBS + DAY + 10 * MINUTE, { tempC: 23 })]);
  await h.call("scorePending");
  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW + DAY) });
  const metrics = view.metrics.find(row => row.horizonMinutes === 10);
  assert.deepEqual([metrics.scoredCount, metrics.pairedCount, metrics.scoredDayCount, metrics.dayCount], [2, 1, 2, 1]);
  assert.equal(metrics.persistenceMaeC, 2);
  assert.equal(metrics.pairedPersistenceMaeC, 1);
  assert.equal(metrics.persistenceBiasC, -2);
  assert.ok(Math.abs(metrics.dampedMaeC - Math.abs(pairedPrediction.dampedTrendC - 21)) < 1e-10);
  assert.equal(view.latest.qualityStatus, "persistence_only");
  assert.equal(view.latest.predictions.find(row => row.horizonMinutes === 10).actualC, 23);
  assert.equal(view.metricsWindowDays, 30);
  assert.equal(view.modelVersion, NOWCAST_MODEL_VERSION);
  await assert.rejects(h.call("getDashboard", { stationIcao: "RKSI", date: "2026-02-30" }), /valid/);
  assert.deepEqual(h.calls.external, []);
});

test("drift forecasts are saved with each outcome and scored against no-change on the same cases", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  const prediction = h.forecasts()[0].predictions.find(row => row.horizonMinutes === 10);
  assert.equal(h.forecasts()[0].driftModelVersion, "rksi15l-iem-drift-v1");
  const outcome = h.outcomes().find(row => row.horizonMinutes === 10);
  assert.deepEqual([outcome.climatologyDriftC, outcome.driftModelVersion], [prediction.climatologyDriftC, "rksi15l-iem-drift-v1"]);
  h.setNow(OBS + 10 * MINUTE + 20_000);
  await h.ingest([observation(OBS + 10 * MINUTE, { tempC: 21 })]);
  await h.call("scorePending");
  const scored = h.outcomes().find(row => row.horizonMinutes === 10);
  assert.ok(Math.abs(scored.driftErrorC - (prediction.climatologyDriftC - 21)) < 1e-10);
  const row = h.tables.seoulNowcastDailyScores.find(item => item.horizonMinutes === 10);
  assert.equal(row.driftPairedCount, 1);
  assert.equal(row.timeOfDay.midday.driftPairedCount, 1);
  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW) });
  const metrics = view.metrics.find(item => item.horizonMinutes === 10);
  assert.deepEqual([metrics.driftPairedCount, metrics.driftDayCount, metrics.driftPairedPersistenceMaeC], [1, 1, 1]);
  assert.ok(Math.abs(metrics.driftMaeC - Math.abs(prediction.climatologyDriftC - 21)) < 1e-10);
  const window = view.timeOfDayMetrics.find(item => item.window === "midday" && item.horizonMinutes === 10);
  assert.ok(Math.abs(window.driftMaeC - metrics.driftMaeC) < 1e-12);
  assert.equal(view.latest.driftModelVersion, "rksi15l-iem-drift-v1");
  assert.equal(view.latest.predictions.find(item => item.horizonMinutes === 10).climatologyDriftC, prediction.climatologyDriftC);
});

test("scores recorded before the drift test start its sums at zero without touching other totals", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  // A row and window written by the release before the drift test existed.
  const before = h.tables.seoulNowcastDailyScores.find(item => item.horizonMinutes === 10);
  await h.db.patch(before._id, { driftPairedCount: undefined, driftPairedPersistenceAbsErrorSum: undefined,
    driftAbsErrorSum: undefined, driftErrorSum: undefined, timeOfDay: { midday: { scoredCount: 2, pairedCount: 2,
      persistenceAbsErrorSum: 1, pairedPersistenceAbsErrorSum: 1, dampedAbsErrorSum: 2, persistenceErrorSum: 1, dampedErrorSum: 2 } } });
  await h.db.patch(before._id, { scoredCount: 2, pairedCount: 2, persistenceAbsErrorSum: 1, pairedPersistenceAbsErrorSum: 1,
    dampedAbsErrorSum: 2, persistenceErrorSum: 1, dampedErrorSum: 2 });
  const legacyView = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW) });
  assert.deepEqual([legacyView.metrics[0].driftPairedCount, legacyView.metrics[0].driftMaeC], [0, null]);
  h.setNow(OBS + 10 * MINUTE + 20_000);
  await h.ingest([observation(OBS + 10 * MINUTE, { tempC: 21 })]);
  await h.call("scorePending");
  const after = h.tables.seoulNowcastDailyScores.find(item => item.horizonMinutes === 10);
  assert.deepEqual([after.scoredCount, after.pairedCount, after.driftPairedCount], [3, 3, 1]);
  assert.deepEqual([after.timeOfDay.midday.scoredCount, after.timeOfDay.midday.driftPairedCount], [3, 1]);
  assert.ok(Math.abs(after.driftPairedPersistenceAbsErrorSum - 1) < 1e-10, "only the new case is in the drift baseline");
});

test("time-of-day sums follow the KST issue time and add up to the daily totals", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  const midday = h.forecasts()[0].predictions.find(row => row.horizonMinutes === 10);
  h.setNow(OBS + 10 * MINUTE + 20_000);
  await h.ingest([observation(OBS + 10 * MINUTE, { tempC: 21 })]);
  await h.call("scorePending");

  const evening = Date.parse("2026-10-31T10:00:00Z");
  await h.seedHistory({ end: evening });
  await h.issue(evening);
  h.setNow(evening + 10 * MINUTE + 20_000);
  await h.ingest([observation(evening + 10 * MINUTE, { tempC: 19 })]);
  await h.call("scorePending");

  const row = h.tables.seoulNowcastDailyScores.find(item => item.horizonMinutes === 10);
  assert.deepEqual(Object.keys(row.timeOfDay).sort(), ["evening", "midday"]);
  for (const key of ["scoredCount", "pairedCount", "persistenceAbsErrorSum", "dampedAbsErrorSum"]) {
    const total = row.timeOfDay.midday[key] + row.timeOfDay.evening[key];
    assert.ok(Math.abs(total - row[key]) < 1e-10, `time-of-day ${key} adds up to the daily total`);
  }
  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW) });
  const cell = (window, horizon) => view.timeOfDayMetrics.find(item => item.window === window && item.horizonMinutes === horizon);
  assert.equal(view.timeOfDayMetrics.length, 15);
  assert.deepEqual([cell("midday", 10).startHourKst, cell("midday", 10).endHourKst], [10, 14]);
  assert.deepEqual([cell("midday", 10).pairedCount, cell("midday", 10).dayCount], [1, 1]);
  assert.ok(Math.abs(cell("midday", 10).dampedMaeC - Math.abs(midday.dampedTrendC - 21)) < 1e-10);
  assert.equal(cell("midday", 10).pairedPersistenceMaeC, 1);
  assert.equal(cell("evening", 10).scoredCount, 1);
  assert.deepEqual([cell("morning", 10).scoredCount, cell("morning", 10).dampedMaeC], [0, null]);
  assert.equal(view.timeOfDayExcludedDayCount, 0);
});

test("rows written before the breakdown stay excluded until the backfill recomputes them from outcomes", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  h.setNow(OBS + 10 * MINUTE + 20_000);
  await h.ingest([observation(OBS + 10 * MINUTE, { tempC: 21 })]);
  await h.call("scorePending");
  // Rows recorded by the release before time-of-day sums existed.
  for (const row of h.tables.seoulNowcastDailyScores) await h.db.patch(row._id, { timeOfDay: undefined });
  h.setNow(OBS + 15 * MINUTE + 20_000);
  await h.ingest([observation(OBS + 15 * MINUTE, { tempC: 21.5 })]);
  await h.call("scorePending");
  assert.ok(h.tables.seoulNowcastDailyScores.every(row => row.timeOfDay === undefined), "a legacy row never receives a partial sum");
  const before = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW) });
  assert.equal(before.timeOfDayExcludedDayCount, 1);
  assert.ok(before.timeOfDayMetrics.every(item => item.scoredCount === 0));

  const result = await h.call("backfillTimeOfDayScores");
  assert.deepEqual([result.backfilledRows, result.mismatchedRows, result.more], [3, 0, false]);
  for (const row of h.tables.seoulNowcastDailyScores) {
    const parts = Object.values(row.timeOfDay);
    assert.equal(parts.reduce((sum, part) => sum + part.scoredCount, 0), row.scoredCount);
    assert.equal(parts.reduce((sum, part) => sum + part.pairedCount, 0), row.pairedCount);
  }
  const after = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW) });
  assert.equal(after.timeOfDayExcludedDayCount, 0);
  const restored = after.timeOfDayMetrics.find(item => item.window === "midday" && item.horizonMinutes === 15);
  const overall = after.metrics.find(item => item.horizonMinutes === 15);
  assert.equal(restored.scoredCount, overall.scoredCount);
  assert.ok(Math.abs(restored.dampedMaeC - overall.dampedMaeC) < 1e-12);
  assert.deepEqual(await h.call("backfillTimeOfDayScores"), { backfilledRows: 0, mismatchedRows: 0, more: false });

  h.setNow(OBS + 20 * MINUTE + 20_000);
  await h.ingest([observation(OBS + 20 * MINUTE, { tempC: 22 })]);
  await h.call("scorePending");
  const later = h.tables.seoulNowcastDailyScores.find(row => row.horizonMinutes === 20);
  assert.deepEqual([later.scoredCount, later.timeOfDay.midday.scoredCount], [1, 1], "later scores add to restored sums");
});

test("the backfill skips rows whose retained outcomes disagree and continues to later dates", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  h.setNow(OBS + 10 * MINUTE + 20_000);
  await h.ingest([observation(OBS + 10 * MINUTE, { tempC: 21 })]);
  await h.call("scorePending");
  h.setNow(NOW + DAY);
  await h.ingest([observation(OBS + DAY, { tempC: 20 })]);
  await h.issue(OBS + DAY);
  h.setNow(OBS + DAY + 10 * MINUTE + 20_000);
  await h.ingest([observation(OBS + DAY + 10 * MINUTE, { tempC: 23 })]);
  await h.call("scorePending");
  for (const row of h.tables.seoulNowcastDailyScores) await h.db.patch(row._id, { timeOfDay: undefined });
  const firstDay = localDate(NOW);
  const lost = h.outcomes().find(row => row.date === firstDay && row.status === "scored");
  await h.db.delete(lost._id);

  const first = await h.call("backfillTimeOfDayScores");
  assert.deepEqual([first.date, first.backfilledRows, first.mismatchedRows, first.more], [firstDay, 2, 1, true]);
  const continuation = h.calls.scheduled.filter(row => row.name === "seoulNowcast:backfillTimeOfDayScores");
  assert.equal(continuation.length, 1);
  assert.equal(h.tables.seoulNowcastDailyScores.find(row => row.date === firstDay && row.horizonMinutes === 10).timeOfDay, undefined);
  const second = await h.call("backfillTimeOfDayScores", continuation[0].args);
  assert.deepEqual([second.date, second.backfilledRows, second.mismatchedRows, second.more], [localDate(NOW + DAY), 3, 0, false]);
  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW + DAY) });
  assert.equal(view.timeOfDayExcludedDayCount, 1, "the unmatched day stays visibly excluded");
});

test("recent completed checks stay visible when fresh pending forecasts fill the recent list", async () => {
  const h = harness();
  await h.seedHistory();
  await h.issue();
  const completedId = h.forecasts()[0]._id;
  const target = OBS + 10 * MINUTE;
  h.setNow(target + 20_000);
  await h.ingest([observation(target, { tempC: 21 })]);
  await h.call("scorePending");
  for (let minute = 11; minute <= 30; minute++) {
    const time = OBS + minute * MINUTE;
    h.setNow(time + 20_000);
    await h.ingest([observation(time, { tempC: 21 + minute / 100 })]);
    await h.issue(time);
  }
  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW) });
  assert.equal(view.recent.length, 12);
  assert.ok(view.recent.every(row => row.id !== completedId));
  assert.ok(view.recent.every(row => row.predictions.every(prediction => prediction.status === "pending")));
  assert.deepEqual(view.recentResolved.map(row => row.id), [completedId]);
  const completed = view.recentResolved[0].predictions.find(row => row.horizonMinutes === 10);
  assert.equal(completed.status, "scored");
  assert.equal(completed.actualC, 21);
  assert.equal(view.latest.id, h.forecasts().at(-1)._id, "the live latest forecast is unchanged");
  const otherDate = await h.call("getDashboard", { stationIcao: "RKSI", date: localDate(NOW + DAY) });
  assert.deepEqual(otherDate.recentResolved, []);
});

test("bounded retention keeps recent evidence and durable daily scores and schedules further cleanup", async () => {
  const h = harness();
  for (const ageDays of [366, 33, 31, 30, 29, 0]) {
    const time = OBS - ageDays * DAY;
    h.setNow(time + 20_000);
    await h.ingest([observation(time)]);
    await h.issue(time);
  }
  const recentForecasts = h.forecasts().filter(row => row.issuedAt >= NOW - 30 * DAY).map(row => row._id);
  const retainedSourceIds = h.versions().filter(row => row.receivedAt >= NOW - 32 * DAY).map(row => row._id);
  const oldForecast = structuredClone(h.forecasts().find(row => row.issuedAt === NOW - 33 * DAY));
  delete oldForecast._id;
  delete oldForecast._creationTime;
  for (let i = 0; i < 130; i++) await h.db.insert(FORECAST_TABLE, { ...oldForecast, triggerObsTimeUtc: oldForecast.triggerObsTimeUtc - i * MINUTE });
  h.setNow(NOW);
  const first = await h.call("pruneExpired");
  assert.equal(first.more, true);
  assert.ok(h.calls.scheduled.some(row => row.name === "seoulNowcast:pruneExpired"));
  const second = await h.call("pruneExpired");
  assert.equal(second.more, false);
  assert.deepEqual(h.forecasts().map(row => row._id).sort(), recentForecasts.sort());
  assert.deepEqual(h.versions().map(row => row._id).sort(), retainedSourceIds.sort());
  assert.ok(h.outcomes().every(row => row.issuedAt >= NOW - 30 * DAY));
  assert.ok(h.tables.seoulNowcastDailyScores.some(row => row.date === localDate(NOW - 33 * DAY)), "older daily validation totals survive raw retention");
  assert.ok(h.tables.seoulNowcastDailyScores.every(row => row.dayStartUtc >= NOW - 365 * DAY));
  assert.ok(h.forecasts().every(row => row.inputVersionIds.every(id => h.versions().some(version => version._id === id))));
  assert.deepEqual(h.calls.external, []);
});
