import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { queueScheduledAirportForecastRefresh, requestAirportForecastRefresh } from "../convex/seoulKmaForecast.js";

const FLAG = "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED";
const NOW = Date.parse("2026-11-03T11:11:00+09:00");
const SECOND = 1_000, MINUTE = 60 * SECOND;

function harness(status) {
  let row = status ? { ...status, _id: "status" } : null;
  const scheduled = [];
  const ctx = {
    db: {
      query: () => ({ withIndex: () => ({ first: async () => row }) }),
      patch: async (_id, fields) => { row = { ...row, ...fields }; },
      insert: async (_table, fields) => { row = { ...fields, _id: "status" }; return "status"; },
    },
    scheduler: { runAfter: async (_delay, _reference, args) => { scheduled.push(args); } },
  };
  return { ctx, scheduled, row: () => row };
}

async function call(fn, app, { flag = "true", now = NOW } = {}) {
  const savedFlag = process.env[FLAG], savedNow = Date.now;
  if (flag === null) delete process.env[FLAG]; else process.env[FLAG] = flag;
  Date.now = () => now;
  try {
    return await fn._handler(app.ctx, { stationIcao: "RKSI" });
  } finally {
    Date.now = savedNow;
    if (savedFlag === undefined) delete process.env[FLAG]; else process.env[FLAG] = savedFlag;
  }
}

test("a scheduled run is not skipped for arriving a moment before the ten minutes are up", async () => {
  const app = harness({ stationIcao: "RKSI", status: "ok", collectionQueuedAt: NOW - 10 * MINUTE + 800 });
  const result = await call(queueScheduledAirportForecastRefresh, app);
  assert.deepEqual([result.queued, result.status, result.collectionTrigger], [true, "queued", "scheduled"]);
  assert.equal(app.scheduled.length, 1);
  assert.equal(app.row().collectionQueuedAt, NOW);
});

test("a scheduled run soon after any other request is skipped", async () => {
  const app = harness({ stationIcao: "RKSI", status: "ok", collectionQueuedAt: NOW - 6 * MINUTE });
  const result = await call(queueScheduledAirportForecastRefresh, app);
  assert.deepEqual([result.queued, result.status], [false, "cooldown"]);
  assert.deepEqual(app.scheduled, []);
});

test("a manual request keeps the full ten-minute limit and says how long to wait", async () => {
  const blocked = harness({ stationIcao: "RKSI", status: "ok", collectionQueuedAt: NOW - 10 * MINUTE + 800 });
  const result = await call(requestAirportForecastRefresh, blocked);
  assert.deepEqual([result.queued, result.status, result.retryAfterSeconds], [false, "cooldown", 1]);
  assert.deepEqual(blocked.scheduled, []);
  const allowed = harness({ stationIcao: "RKSI", status: "ok", collectionQueuedAt: NOW - 10 * MINUTE });
  const queued = await call(requestAirportForecastRefresh, allowed);
  assert.deepEqual([queued.status, queued.requestedAt, queued.cooldownSeconds, queued.collectionTrigger], ["queued", NOW, 600, "manual"]);
  assert.equal(allowed.scheduled.length, 1);
});

test("a request while a check is running queues nothing", async () => {
  const app = harness({ stationIcao: "RKSI", status: "queued", collectionQueuedAt: NOW - 20 * MINUTE, collectionInFlightSince: NOW - 30 * SECOND });
  const result = await call(requestAirportForecastRefresh, app);
  assert.deepEqual([result.queued, result.status], [false, "already_running"]);
  assert.deepEqual(app.scheduled, []);
});

test("without approval nothing is queued or written, by either path", async () => {
  for (const flag of [null, "", "false", "TRUE"]) {
    for (const fn of [requestAirportForecastRefresh, queueScheduledAirportForecastRefresh]) {
      const app = harness(null);
      const result = await call(fn, app, { flag });
      assert.deepEqual([result.queued, result.status], [false, "approval_required"]);
      assert.equal(app.row(), null);
      assert.deepEqual(app.scheduled, []);
    }
  }
});

test("the schedule runs every ten minutes, starting just after KMA's half-hour update", () => {
  const crons = readFileSync(new URL("../convex/crons.js", import.meta.url), "utf8");
  assert.match(crons, /"seoul_kma_amo_airport_forecast_every_10_min",\s+"1,11,21,31,41,51 \* \* \* \*",\s+internal\.seoulKmaForecast\.queueScheduledAirportForecastRefresh/);
});
