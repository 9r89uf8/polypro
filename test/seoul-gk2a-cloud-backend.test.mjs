import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../convex/seoulGk2aClouds.js", import.meta.url), "utf8");
const exports = [...source.matchAll(/export const (\w+)/g)].map((match) => match[1]);
const createModule = new Function(
  "internalActionGeneric", "internalMutationGeneric", "internalQueryGeneric", "queryGeneric",
  "v", "internal", "cloudCollectionWindowOpen", "summarizeCloudTrend", "process", "Date",
  source.replace(/import[\s\S]*?from\s+"[^"]+";\s*/g, "")
    .replace(/export const /g, "const ") + `\nreturn { ${exports.join(",")} };`,
);
const START = Date.parse("2026-10-29T01:20:00Z");
const MINUTE = 60_000;

function sample(time, extra = {}) {
  return {
    obsTimeUtc: time, acquisitionTimeUtc: time + 1_000,
    visibleObjectKey: `AMI/L1B/LA/visible_${time}.nc`,
    infraredObjectKey: `AMI/L1B/LA/infrared_${time}.nc`,
    visibleLastModifiedUtc: time + 5 * MINUTE,
    infraredLastModifiedUtc: time + 5 * MINUTE,
    solarElevationDeg: 30, reflectance: 0.4, brightnessTempK: 280,
    validCellCount: 25,
    cells: Array.from({ length: 25 }, (_, id) => ({ id, reflectance: 0.4, brightnessTempK: 280 })),
    source: "noaa_gk2a_l1b", methodVersion: "rksi-vis-ir-v1", ...extra,
  };
}

function harness({ flag = "true", daylight = true, trendState } = {}) {
  const env = { NOAA_GK2A_CLOUD_ENABLED: flag };
  let now = START;
  const tables = { seoulGk2aCloudObservations: [], seoulGk2aCloudCollectorStatus: [] };
  const calls = { reads: 0, writes: 0, takes: [], scheduled: [], actions: [] };
  let id = 0;
  const db = {
    query(table) {
      calls.reads += 1;
      const filters = [];
      let descending = false;
      const selector = {
        eq(field, value) { filters.push((row) => row[field] === value); return selector; },
        lt(field, value) { filters.push((row) => row[field] < value); return selector; },
        lte(field, value) { filters.push((row) => row[field] <= value); return selector; },
      };
      const matching = () => tables[table].filter((row) => filters.every((fn) => fn(row)))
        .sort((a, b) => (descending ? -1 : 1) * ((a.obsTimeUtc ?? 0) - (b.obsTimeUtc ?? 0)))
        .map((row) => structuredClone(row));
      const query = {
        withIndex(_name, fn) { fn(selector); return query; },
        order(value) { descending = value === "desc"; return query; },
        async first() { return matching()[0] ?? null; },
        async take(limit) { calls.takes.push(limit); return matching().slice(0, limit); },
      };
      return query;
    },
    async insert(table, data) {
      calls.writes += 1;
      const row = { _id: `${table}:${++id}`, _creationTime: now, ...structuredClone(data) };
      tables[table].push(row);
      return row._id;
    },
    async patch(rowId, patch) {
      calls.writes += 1;
      const row = Object.values(tables).flat().find((entry) => entry._id === rowId);
      assert.ok(row);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete row[key];
        else row[key] = structuredClone(value);
      }
    },
    async delete(rowId) {
      calls.writes += 1;
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex((row) => row._id === rowId);
        if (index >= 0) rows.splice(index, 1);
      }
    },
  };
  const registration = (config) => config;
  const v = new Proxy({}, { get: () => () => ({}) });
  const internal = {
    seoulGk2aClouds: Object.fromEntries(exports.map((name) => [name, name])),
    seoulGk2aCloudsNode: { fetchLatestCloudSample: "fetchLatestCloudSample" },
  };
  class FakeDate extends Date { static now() { return now; } }
  const module = createModule(registration, registration, registration, registration,
    v, internal, () => daylight, (rows) => ({
      state: trendState ?? (rows.length >= 4 ? "steady" : "unavailable"),
      sampleCount: rows.length,
      coverageMinutes: rows.length ? (rows.at(-1).obsTimeUtc - rows[0].obsTimeUtc) / MINUTE : 0,
      visibleChange: null, infraredChangeK: null, commonCellCount: 0,
    }), { env }, FakeDate);
  const ctx = {
    db,
    scheduler: { async runAfter(delay, name, args) { calls.scheduled.push({ delay, name, args }); } },
    async runQuery(name, args) { return module[name].handler(ctx, args); },
    async runMutation(name, args) { return module[name].handler(ctx, args); },
    async runAction(name, args) {
      calls.actions.push({ name, args });
      return { status: "not_modified" };
    },
  };
  return {
    ctx, calls, tables, env,
    call: (name, args = {}) => module[name].handler(ctx, args),
    setNow(value) { now = value; },
    current: () => tables.seoulGk2aCloudCollectorStatus[0],
    seedSample(value) { return db.insert("seoulGk2aCloudObservations", {
      stationIcao: "RKSI", date: "2026-10-29", firstSeenAt: now, updatedAt: now, ...value,
    }); },
  };
}

test("the exact operational flag gates queue, worker, protected reads and writes", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    const h = harness({ flag });
    h.env.NOAA_GK2A_CLOUD_ENABLED = flag;
    assert.equal((await h.call("queueScheduledCloudRefresh")).status, "disabled");
    assert.equal((await h.call("getCloudTrendDashboard")).status, "disabled");
    assert.equal(await h.call("getCollectionState", { stationIcao: "RKSI" }), null);
    assert.equal((await h.call("collectCloudTrend", {
      stationIcao: "RKSI", requestedAt: START, runId: "old",
    })).status, "disabled");
    assert.equal((await h.call("upsertCloudObservations", {
      stationIcao: "RKSI", runId: "old", observations: [],
    })).status, "disabled");
    assert.equal((await h.call("writeCollectorStatus", {
      stationIcao: "RKSI", runId: "old", status: "ok", lastAttemptAt: START,
    })).status, "disabled");
    assert.equal(h.calls.reads, 0);
    assert.equal(h.calls.writes, 0);
    assert.equal(h.calls.actions.length, 0);
    assert.equal(h.calls.scheduled.length, 0);
  }
});

test("night and historical requests do not trigger database or provider reads", async () => {
  const night = harness({ daylight: false });
  assert.equal((await night.call("queueScheduledCloudRefresh")).status, "night");
  assert.equal((await night.call("getCloudTrendDashboard")).status, "night");
  assert.equal(night.calls.reads, 0);
  const history = harness();
  assert.equal((await history.call("getCloudTrendDashboard", { date: "2026-10-28" })).status, "no_data");
  assert.equal(history.calls.reads, 0);
});

test("queue has one in-flight run, two-minute slots, and run-owned status/sample writes", async () => {
  const h = harness();
  assert.equal((await h.call("queueScheduledCloudRefresh")).queued, true);
  const firstRun = h.current().collectionRunId;
  assert.equal((await h.call("queueScheduledCloudRefresh")).status, "already_running");
  await h.call("writeCollectorStatus", {
    stationIcao: "RKSI", runId: firstRun, status: "ok", lastAttemptAt: START,
  });
  assert.equal((await h.call("queueScheduledCloudRefresh")).status, "cooldown");
  h.setNow(START + 2 * MINUTE);
  assert.equal((await h.call("queueScheduledCloudRefresh")).queued, true);
  const currentRun = h.current().collectionRunId;
  assert.notEqual(firstRun, currentRun);
  assert.equal((await h.call("writeCollectorStatus", {
    stationIcao: "RKSI", runId: firstRun, status: "error", lastAttemptAt: START,
  })).status, "superseded");
  assert.equal((await h.call("upsertCloudObservations", {
    stationIcao: "RKSI", runId: firstRun, observations: [sample(START - MINUTE)],
  })).status, "superseded");
  assert.equal(h.current().collectionRunId, currentRun);
  assert.equal(h.tables.seoulGk2aCloudObservations.length, 0);
});

test("expired locks recover and superseded workers never call the extractor", async () => {
  const h = harness();
  await h.call("queueScheduledCloudRefresh");
  const old = h.calls.scheduled[0].args;
  h.setNow(START + 6 * MINUTE);
  assert.equal((await h.call("queueScheduledCloudRefresh")).queued, true);
  assert.equal((await h.call("collectCloudTrend", old)).status, "superseded");
  assert.equal(h.calls.actions.length, 0);
});

test("observation insertion is immutable, bounded, and records actual first persistence", async () => {
  const h = harness();
  await h.call("queueScheduledCloudRefresh");
  const args = { stationIcao: "RKSI", runId: h.current().collectionRunId };
  const initial = sample(START - 8 * MINUTE);
  await h.call("upsertCloudObservations", { ...args, observations: [initial] });
  h.setNow(START + MINUTE);
  await h.call("upsertCloudObservations", { ...args, observations: [{ ...initial, reflectance: 0.9 }] });
  assert.equal(h.tables.seoulGk2aCloudObservations.length, 1);
  assert.equal(h.tables.seoulGk2aCloudObservations[0].firstSeenAt, START);
  assert.equal(h.tables.seoulGk2aCloudObservations[0].reflectance, 0.4);
  await assert.rejects(h.call("upsertCloudObservations", {
    ...args, observations: Array.from({ length: 5 }, () => initial),
  }), /invalid or out-of-window/);
  await assert.rejects(h.call("upsertCloudObservations", {
    ...args, observations: [sample(START - 46 * MINUTE)],
  }), /invalid or out-of-window/);
});

test("disabling during extraction discards the downloaded result", async () => {
  const h = harness();
  await h.call("queueScheduledCloudRefresh");
  const writesBefore = h.calls.writes;
  h.ctx.runAction = async () => {
    h.env.NOAA_GK2A_CLOUD_ENABLED = "false";
    return { status: "ok", observations: [sample(START - 8 * MINUTE)] };
  };
  assert.equal((await h.call("collectCloudTrend", h.calls.scheduled[0].args)).status, "disabled");
  assert.equal(h.calls.writes, writesBefore);
  assert.equal(h.tables.seoulGk2aCloudObservations.length, 0);
});

test("sample boundary rejects invalid physics, provenance, pixel coverage and scene clocks", async () => {
  const h = harness();
  await h.call("queueScheduledCloudRefresh");
  const args = { stationIcao: "RKSI", runId: h.current().collectionRunId };
  const observed = START - 8 * MINUTE;
  const good = sample(observed);
  const badSamples = [
    { source: "unverified" }, { methodVersion: "unknown" },
    { reflectance: 1.601 }, { reflectance: -0.01 },
    { brightnessTempK: 149.9 }, { brightnessTempK: 330.2 },
    { solarElevationDeg: 19.9 },
    { acquisitionTimeUtc: observed - MINUTE - 1 },
    { acquisitionTimeUtc: observed + 2 * MINUTE + 1 },
    { obsTimeUtc: START, acquisitionTimeUtc: START + 1 },
    { validCellCount: 19, cells: good.cells.slice(0, 19) },
    { validCellCount: 24 },
    { cells: good.cells.map((cell, index) => index === 0 ? { ...cell, id: 25 } : cell) },
    { cells: good.cells.map((cell, index) => index === 0 ? { ...cell, id: 1 } : cell) },
    { cells: good.cells.map((cell, index) => index === 0 ? { ...cell, reflectance: 2 } : cell) },
    { cells: good.cells.map((cell, index) => index === 0 ? { ...cell, brightnessTempK: NaN } : cell) },
  ];
  for (const changes of badSamples) {
    await assert.rejects(h.call("upsertCloudObservations", {
      ...args, observations: [{ ...good, ...changes }],
    }), /invalid or out-of-window/);
  }
  assert.equal(h.tables.seoulGk2aCloudObservations.length, 0);
  await h.call("upsertCloudObservations", {
    ...args, observations: [{ ...good, validCellCount: 20, cells: good.cells.slice(0, 20) }],
  });
  assert.equal(h.tables.seoulGk2aCloudObservations.length, 1);
});

test("a rejected newer frame suppresses the older arrow across not-modified polls", async () => {
  const h = harness();
  for (const minutes of [12, 10, 8, 6]) await h.seedSample(sample(START - minutes * MINUTE));
  assert.equal((await h.call("getCloudTrendDashboard")).status, "ok");
  await h.call("queueScheduledCloudRefresh");
  const badFrameTime = START - 4 * MINUTE;
  h.ctx.runAction = async () => ({
    status: "unavailable", lastProcessedTimeUtc: badFrameTime,
    // A rejected newest frame may still accompany older startup samples.
    observations: [sample(START - 14 * MINUTE)], message: "Latest scene failed quality checks.",
  });
  await h.call("collectCloudTrend", h.calls.scheduled.at(-1).args);
  assert.equal(h.current().status, "no_data");
  assert.equal(h.tables.seoulGk2aCloudObservations.length, 4);
  let dashboard = await h.call("getCloudTrendDashboard");
  assert.equal(dashboard.status, "no_data");
  assert.equal(dashboard.trend.state, "unavailable");
  h.setNow(START + 2 * MINUTE);
  await h.call("queueScheduledCloudRefresh");
  h.ctx.runAction = async (_name, args) => {
    assert.equal(args.latestProcessedTime, badFrameTime);
    return { status: "not_modified" };
  };
  await h.call("collectCloudTrend", h.calls.scheduled.at(-1).args);
  assert.equal(h.current().status, "no_data");
  dashboard = await h.call("getCloudTrendDashboard");
  assert.equal(dashboard.status, "no_data");
  assert.equal(dashboard.trend.state, "unavailable");
  h.setNow(START + 4 * MINUTE);
  await h.call("queueScheduledCloudRefresh");
  h.ctx.runAction = async () => ({
    status: "ok", observations: [sample(START - 2 * MINUTE)],
    lastProcessedTimeUtc: START - 2 * MINUTE,
  });
  await h.call("collectCloudTrend", h.calls.scheduled.at(-1).args);
  assert.equal(h.current().status, "ok");
  assert.equal((await h.call("getCloudTrendDashboard")).status, "ok");
});

test("quality rejection remains a barrier until four new good frames rebuild the trend", async () => {
  const h = harness();
  for (const minutes of [12, 10, 8, 6]) await h.seedSample(sample(START - minutes * MINUTE));
  assert.equal((await h.call("getCloudTrendDashboard")).status, "ok");
  const badFrameTime = START - 4 * MINUTE;
  await h.call("queueScheduledCloudRefresh");
  h.ctx.runAction = async () => ({
    status: "unavailable", lastProcessedTimeUtc: badFrameTime,
    latestRejectedTimeUtc: badFrameTime, message: "Rejected newest scene.",
  });
  await h.call("collectCloudTrend", h.calls.scheduled.at(-1).args);
  assert.equal((await h.call("getCloudTrendDashboard")).status, "no_data");
  for (let index = 1; index <= 4; index += 1) {
    h.setNow(START + index * 2 * MINUTE);
    await h.call("queueScheduledCloudRefresh");
    const observed = badFrameTime + index * 2 * MINUTE;
    // Successful subsequent runs do not repeat the rejection metadata.
    h.ctx.runAction = async () => ({
      status: "ok", observations: [sample(observed)], lastProcessedTimeUtc: observed,
    });
    await h.call("collectCloudTrend", h.calls.scheduled.at(-1).args);
    assert.equal(h.current().latestRejectedTimeUtc, badFrameTime);
    const dashboard = await h.call("getCloudTrendDashboard");
    assert.equal(dashboard.trend.sampleCount, index);
    assert.equal(dashboard.status, index < 4 ? "building" : "ok");
  }
  // A delayed older result must never move the rejection barrier backward.
  h.setNow(START + 10 * MINUTE);
  await h.call("queueScheduledCloudRefresh");
  await h.call("writeCollectorStatus", {
    stationIcao: "RKSI", runId: h.current().collectionRunId,
    status: "ok", lastAttemptAt: START + 10 * MINUTE,
    latestRejectedTimeUtc: badFrameTime - 2 * MINUTE,
  });
  assert.equal(h.current().latestRejectedTimeUtc, badFrameTime);
});

test("a good newest frame still records a rejected earlier frame in the same extraction", async () => {
  const h = harness();
  for (const minutes of [12, 10, 8, 6]) await h.seedSample(sample(START - minutes * MINUTE));
  await h.call("queueScheduledCloudRefresh");
  h.ctx.runAction = async () => ({
    status: "ok", observations: [sample(START - 2 * MINUTE)],
    lastProcessedTimeUtc: START - 2 * MINUTE,
    latestRejectedTimeUtc: START - 4 * MINUTE,
  });
  await h.call("collectCloudTrend", h.calls.scheduled.at(-1).args);
  const dashboard = await h.call("getCloudTrendDashboard");
  assert.equal(h.current().latestRejectedTimeUtc, START - 4 * MINUTE);
  assert.equal(dashboard.status, "building");
  assert.equal(dashboard.trend.sampleCount, 1);
});

test("successful completion records receipt time and forwards the checkpoint on the next poll", async () => {
  const h = harness();
  await h.call("queueScheduledCloudRefresh");
  const observed = START - 8 * MINUTE;
  h.ctx.runAction = async (_name, args) => {
    h.calls.actions.push(args);
    h.setNow(START + 4_000);
    return { status: "ok", observations: [sample(observed)], lastProcessedTimeUtc: observed };
  };
  await h.call("collectCloudTrend", h.calls.scheduled[0].args);
  assert.equal(h.current().lastAttemptAt, START);
  assert.equal(h.current().lastSuccessAt, START + 4_000);
  assert.equal(h.tables.seoulGk2aCloudObservations[0].firstSeenAt, START + 4_000);
  h.setNow(START + 2 * MINUTE);
  await h.call("queueScheduledCloudRefresh");
  h.ctx.runAction = async (_name, args) => {
    assert.equal(args.latestProcessedTime, observed);
    return { status: "not_modified" };
  };
  await h.call("collectCloudTrend", h.calls.scheduled.at(-1).args);
  assert.equal(h.tables.seoulGk2aCloudObservations.length, 1);
});

test("dashboard bounds history and distinguishes building, stale, uncertain, and errors", async () => {
  const h = harness();
  await h.seedSample(sample(START - 8 * MINUTE));
  assert.equal((await h.call("getCloudTrendDashboard")).status, "building");
  for (const minutes of [10, 12, 14]) await h.seedSample(sample(START - minutes * MINUTE));
  const ready = await h.call("getCloudTrendDashboard");
  assert.equal(ready.status, "ok");
  assert.equal(ready.trend.sampleCount, 4);
  assert.equal(ready.latest._id, undefined);
  assert.ok(h.calls.takes.includes(32));
  h.setNow(START + 5 * MINUTE);
  assert.equal((await h.call("getCloudTrendDashboard")).status, "stale");
  const uncertain = harness({ trendState: "uncertain" });
  await uncertain.seedSample(sample(START - 8 * MINUTE));
  assert.equal((await uncertain.call("getCloudTrendDashboard")).status, "ok");
  await uncertain.call("queueScheduledCloudRefresh");
  await uncertain.call("writeCollectorStatus", {
    stationIcao: "RKSI", runId: uncertain.current().collectionRunId,
    status: "error", lastAttemptAt: START, lastError: "Unavailable provider",
  });
  assert.equal((await uncertain.call("getCloudTrendDashboard")).status, "error");
});

test("deletion-only retention removes expired rows even with collection disabled", async () => {
  const h = harness({ flag: "false" });
  await h.seedSample(sample(START - 49 * 60 * MINUTE));
  await h.seedSample(sample(START - MINUTE));
  assert.equal((await h.call("pruneExpiredCloudObservations")).prunedCount, 1);
  assert.equal(h.tables.seoulGk2aCloudObservations.length, 1);
  assert.equal(h.tables.seoulGk2aCloudObservations[0].obsTimeUtc, START - MINUTE);
});
