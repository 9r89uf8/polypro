import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import schema from "../convex/schema.js";
import * as backend from "../convex/seoulProviderForecasts.js";

const MINUTE = 60_000, HOUR = 60 * MINUTE;
const DATE = "2026-11-02";
const at = (time, date = DATE) => Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}+09:00`);
const hourAt = (hour, date = DATE) => at(`${String(hour).padStart(2, "0")}:00`, date);
const tenth = (value) => Math.round(value * 10) / 10;
const ENV_KEYS = ["KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED", "OPEN_METEO_FORECAST_ACCESS_APPROVED", "OPEN_METEO_API_KEY"];
// A warm afternoon: 7°C until 6 AM, a peak at `peakHour`, then cooling.
const profile = (peakHour, peakC) => (hour) => tenth(hour <= 6 ? 7 : hour <= peakHour ? 7 + ((peakC - 7) * (hour - 6)) / (peakHour - 6) : peakC - 0.4 * (hour - peakHour));

function kmaCapture(capturedAt, { createdAt = capturedAt + 20_000, status = "ok", temps = profile(14, 13), date = DATE, source = "kma_amo_airport" } = {}) {
  return {
    stationIcao: "RKSI", source, collectionTrigger: "scheduled", capturedAt, status, createdAt, dailyRows: [],
    hourlyRows: status !== "ok" ? [] : Array.from({ length: 24 }, (_, hour) => ({
      date, forecastTimeUtc: hourAt(hour, date), forecastTimeLocal: `${date} ${String(hour).padStart(2, "0")}:00`, tempC: Math.round(temps(hour)),
      phrase: hour < 12 ? "Partly cloudy" : "Mostly cloudy", conditionCode: hour < 12 ? "mtph02" : "mtph03",
    })).filter((row) => row.forecastTimeUtc >= capturedAt - HOUR),
  };
}

function weathercomCapture(capturedAt, { hourlyAt = capturedAt + 3_000, hourlyStatus = "ok", temps = profile(15, 12.8), date = DATE } = {}) {
  return {
    stationIcao: "RKSI", capturedAt, status: "ok", weathercomStatus: "ok", weathercomHourlyStatus: hourlyStatus, weathercomHourlyCapturedAt: hourlyAt,
    weathercomForecastDays: [], createdAt: hourlyAt,
    weathercomHourlyRows: Array.from({ length: 24 }, (_, hour) => ({
      date, forecastTimeUtc: hourAt(hour, date), forecastTimeLocal: `${date} ${String(hour).padStart(2, "0")}:00`, tempC: Math.round(temps(hour)),
      tempF: 0, phrase: "Cloudy", cloudCoverPct: 70 + hour,
    })).filter((row) => row.forecastTimeUtc >= capturedAt - HOUR),
  };
}

const MODEL_PROFILES = { ecmwf_ifs: profile(15, 12.6), ncep_gfs_global: profile(16, 14.3), dwd_icon_global: profile(14, 11.2) };
const DOMAIN_RUNS = { ecmwf_ifs: "12", ncep_gfs013: "18", dwd_icon: "18" };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// A stand-in for api.open-meteo.com, its metadata and the single-runs archive.
// Runs become available five hours after they start unless `available` says otherwise.
function openMeteo({ fail = new Set(), runs = DOMAIN_RUNS, available = {} } = {}) {
  return async (href) => {
    const url = new URL(href);
    if (url.pathname.startsWith("/data/")) {
      const domain = url.pathname.split("/")[2], init = Date.parse(`2026-11-01T${runs[domain]}:00:00Z`) / 1000;
      return json({ last_run_initialisation_time: init, last_run_availability_time: (available[domain] ?? (init + 5 * 3600) * 1000) / 1000, update_interval_seconds: 21600 });
    }
    const model = url.searchParams.get("models");
    if (fail.has(model)) return json({ error: true, reason: "Too many concurrent requests" }, 429);
    const run = url.searchParams.get("run");
    const start = run ? Date.parse(`${run}:00Z`) : hourAt(0, url.searchParams.get("start_date"));
    const time = Array.from({ length: run ? 48 : 24 }, (_, index) => (start + index * HOUR) / 1000);
    const hourOf = (seconds) => new Date(seconds * 1000 + 9 * HOUR).getUTCHours();
    const units = { time: "unixtime", temperature_2m: "°C", cloud_cover: "%", cloud_cover_low: "%", cloud_cover_mid: model === "ncep_gfs_global" ? "undefined" : "%", cloud_cover_high: "%" };
    return json({
      latitude: 37.50439, longitude: 126.43143, elevation: 6, utc_offset_seconds: 32_400, timezone: "Asia/Seoul", hourly_units: units,
      hourly: {
        time, temperature_2m: time.map((seconds) => MODEL_PROFILES[model](hourOf(seconds))), cloud_cover: time.map((seconds) => 40 + hourOf(seconds)),
        cloud_cover_low: time.map(() => 20), cloud_cover_mid: time.map(() => (model === "ncep_gfs_global" ? null : 10)), cloud_cover_high: time.map(() => 30),
      },
    });
  };
}

function metarRow(date, slot, tempC) {
  const time = `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`, obsTimeUtc = at(time, date);
  return { stationIcao: "RKSI", date, obsTimeUtc, reportType: "METAR", tempC, rawMetar: `RKSI 0000Z 32008KT 9999 ${slot < 26 ? "SCT030" : "CAVOK"} ${String(tempC).padStart(2, "0")}/02 Q1018 NOSIG` };
}

// Runs the real handlers against in-memory tables ordered by the schema's indexes.
function harness() {
  let now = 0, nextId = 0, fetchImpl = async () => { throw new Error("Unexpected external request"); };
  const tables = Object.fromEntries(Object.keys(schema.tables).map((table) => [table, []]));
  const reads = [], requests = [], env = {};
  const compare = (a, b) => (a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1);
  const getRow = (id) => Object.values(tables).flat().find((row) => row._id === id);
  const db = {
    query(table) {
      assert.ok(tables[table], `Unknown table ${table}`);
      reads.push(table);
      const predicates = [];
      let fields = [], direction = 1;
      const selector = Object.fromEntries(["eq", "lt", "lte", "gt", "gte"].map((op) => [op, (field, value) => {
        predicates.push((row) => ({ eq: row[field] === value, lt: row[field] < value, lte: row[field] <= value, gt: row[field] > value, gte: row[field] >= value })[op]);
        return selector;
      }]));
      const selected = () => tables[table].filter((row) => predicates.every((fn) => fn(row))).sort((a, b) => {
        for (const field of [...fields, "_creationTime"]) { const difference = compare(a[field], b[field]); if (difference) return direction * difference; }
        return 0;
      }).map((row) => structuredClone(row));
      const query = {
        withIndex(name, fn) {
          const index = schema.tables[table].indexes.find((item) => item.indexDescriptor === name);
          assert.ok(index, `Unknown index ${table}.${name}`);
          fields = index.fields;
          fn?.(selector);
          return query;
        },
        order(value) { direction = value === "desc" ? -1 : 1; return query; },
        async first() { return selected()[0] ?? null; },
        async unique() { const rows = selected(); assert.ok(rows.length <= 1); return rows[0] ?? null; },
        async collect() { return selected(); },
        async take(count) { return selected().slice(0, count); },
      };
      return query;
    },
    async insert(table, fields) {
      assert.ok(tables[table], `Unknown table ${table}`);
      assert.ok(Object.values(fields).every((value) => value !== undefined), `undefined field in ${table}`);
      const row = { ...structuredClone(fields), _id: `${table}:${++nextId}`, _creationTime: now + nextId / 1000 };
      tables[table].push(row);
      return row._id;
    },
    async patch(id, fields) { Object.assign(getRow(id), structuredClone(fields)); },
    async replace(id, fields) {
      const row = getRow(id);
      for (const key of Object.keys(row)) if (!key.startsWith("_")) delete row[key];
      Object.assign(row, structuredClone(fields));
    },
  };
  const applyEnv = (values) => { for (const key of ENV_KEYS) { if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; } };
  // As in Convex, each execution sees the environment as it was when it
  // started: a nested query or mutation sees the current `env`, while the
  // calling action keeps its own copy.
  const dispatch = async (reference, args) => {
    const outer = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    applyEnv(env);
    try { return await backend[getFunctionName(reference).split(":")[1]]._handler(ctx, args); } finally { applyEnv(outer); }
  };
  const ctx = { db, runQuery: dispatch, runMutation: dispatch };
  const call = async (name, args = {}) => {
    const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    const oldNow = Date.now, oldFetch = globalThis.fetch;
    applyEnv(env);
    Date.now = () => now;
    globalThis.fetch = async (input, options) => { requests.push(String(input)); return fetchImpl(String(input), options); };
    try { return await backend[name]._handler(ctx, args); } finally {
      Date.now = oldNow;
      globalThis.fetch = oldFetch;
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  };
  const seed = (table, rows) => rows.forEach((row) => tables[table].push({ ...row, _id: `${table}:${++nextId}`, _creationTime: row.createdAt ?? row.capturedAt ?? 0 }));
  return { tables, reads, requests, env, call, seed, setNow(value) { now = value; }, setFetch(fn) { fetchImpl = fn; } };
}

const lock = (h, provider, date = DATE) => h.tables.seoulProviderForecastLocks.find((row) => row.provider === provider && row.date === date);

function seedCaptures(h, date = DATE) {
  h.seed("seoulKmaForecastCaptures", [
    kmaCapture(at("02:35", date), { date, temps: () => 30 }), // older than six hours before the lock
    kmaCapture(at("08:05", date), { date, temps: profile(14, 12) }),
    kmaCapture(at("08:35", date), { date }),
    kmaCapture(at("08:45", date), { date, status: "error" }),
    kmaCapture(at("08:58", date), { date, createdAt: at("09:00:30", date), temps: () => 25 }), // finished after 9:00
    kmaCapture(at("09:05", date), { date, temps: () => 20 }),
  ]);
  h.seed("seoulForecastCaptures", [
    weathercomCapture(at("08:32", date), { date, temps: profile(15, 11) }),
    weathercomCapture(at("08:47", date), { date }),
    weathercomCapture(at("08:59:58", date), { date, hourlyAt: at("09:00:01", date), temps: () => 25 }),
    weathercomCapture(at("09:02", date), { date, temps: () => 20 }),
  ]);
}

test("the lock takes the newest capture completed by 9:00 AM and is written once", async () => {
  const h = harness();
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = "true";
  seedCaptures(h);
  h.setNow(at("08:59"));
  assert.deepEqual(await h.call("lockStoredForecasts", { date: DATE }), { status: "too_early" });
  assert.deepEqual(await h.call("runScheduledLock"), { status: "outside_window" });
  h.setNow(at("09:00:02"));
  const first = await h.call("runScheduledLock");
  assert.deepEqual(first, { status: "ran", date: DATE, stored: { kma: "ok", weathercom: "ok" }, models: { status: "approval_required" } });
  assert.deepEqual(h.requests, [], "nothing external is requested while Open-Meteo is not approved");
  const kma = lock(h, "kma"), weathercom = lock(h, "weathercom");
  assert.deepEqual([kma.method, kma.capturedAt, kma.receivedAt, kma.status, kma.lockAt], ["stored_capture", at("08:35"), at("08:35:20"), "ok", at("09:00")]);
  assert.equal(kma.hourly.find((row) => row.hour === 14).tempC, 13, "the 8:35 capture, not the later or unfinished ones");
  assert.deepEqual([kma.highC, kma.peakHours], [13, [14, 15]], "whole-degree KMA values tie across hours");
  assert.equal(kma.hourly.find((row) => row.hour === 12).sky, "Mostly cloudy");
  assert.equal(kma.sourceCaptureId, h.tables.seoulKmaForecastCaptures[2]._id);
  assert.deepEqual([weathercom.capturedAt, weathercom.receivedAt, weathercom.hourly.find((row) => row.hour === 15).cloudCoverPct], [at("08:47"), at("08:47:03"), 85]);
  h.setNow(at("09:05"));
  assert.deepEqual((await h.call("runScheduledLock")).stored, { kma: "duplicate", weathercom: "duplicate" });
  assert.equal(h.tables.seoulProviderForecastLocks.length, 2);
});

test("a day without a usable capture is recorded as an error only by the scheduled run", async () => {
  const h = harness();
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = "true";
  h.seed("seoulKmaForecastCaptures", [kmaCapture(at("01:35"))]);
  h.setNow(at("12:00"));
  assert.deepEqual(await h.call("lockStoredForecasts", { date: DATE }), { kma: "missing", weathercom: "missing" });
  assert.equal(h.tables.seoulProviderForecastLocks.length, 0);
  h.setNow(at("09:00"));
  assert.deepEqual((await h.call("runScheduledLock")).stored, { kma: "error", weathercom: "error" });
  assert.match(lock(h, "kma").error, /No KMA forecast capture completed in the 6 hours before 9:00 AM KST/);
  assert.deepEqual(lock(h, "weathercom").hourly, []);
});

test("KMA locks are neither read, written nor shown without KMA approval", async () => {
  const h = harness();
  seedCaptures(h);
  h.setNow(at("09:00"));
  assert.deepEqual(await h.call("lockStoredForecasts", { date: DATE, recordMissing: true }), { kma: "approval_required", weathercom: "ok" });
  assert.equal(h.reads.includes("seoulKmaForecastCaptures"), false);
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = "true";
  await h.call("lockStoredForecasts", { date: DATE });
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = "false";
  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: DATE });
  assert.deepEqual(view.providers[0], { id: "kma", label: "KMA airport forecast", shortLabel: "KMA", kind: "capture", access: "approval_required",
    approvalFlag: "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED", lock: null, score: null });
  assert.equal(view.providers[1].lock.provider, "weathercom");
});

test("Open-Meteo work fails closed unless the flag is exactly true", async () => {
  for (const value of [undefined, "", "false", "TRUE", "yes"]) {
    const h = harness();
    h.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = value;
    h.env.OPEN_METEO_API_KEY = "a-working-key-is-not-approval";
    h.setFetch(openMeteo());
    h.setNow(at("09:00"));
    assert.deepEqual((await h.call("runScheduledLock")).models, { status: "approval_required" });
    h.setNow(at("12:00", "2026-11-03"));
    assert.deepEqual(await h.call("backfillModelLocks", { startDate: "2026-10-30", endDate: DATE }), { status: "approval_required" });
    assert.deepEqual(await h.call("storeModelLock", { date: DATE, provider: "ecmwf", method: "single_run_archive", status: "ok", modelId: "ecmwf_ifs", runInitAt: 1, hourly: [] }),
      { status: "approval_required" });
    assert.deepEqual(h.requests, [], `no request with flag ${JSON.stringify(value)}`);
    assert.equal(h.tables.seoulProviderForecastLocks.filter((row) => ["ecmwf", "gfs", "icon"].includes(row.provider)).length, 0);
    const view = await h.call("getDashboard", { stationIcao: "RKSI", date: DATE });
    assert.deepEqual(view.providers.slice(2).map((row) => [row.id, row.access, row.approvalFlag]), [
      ["ecmwf", "approval_required", "OPEN_METEO_FORECAST_ACCESS_APPROVED"], ["gfs", "approval_required", "OPEN_METEO_FORECAST_ACCESS_APPROVED"],
      ["icon", "approval_required", "OPEN_METEO_FORECAST_ACCESS_APPROVED"]]);
  }
});

test("approved model locks store the run, grid and hourly values, and never the API key", async () => {
  const h = harness();
  h.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = "true";
  h.env.OPEN_METEO_API_KEY = "secret-key";
  h.setFetch(openMeteo());
  h.setNow(at("09:21"));
  assert.deepEqual(await h.call("runScheduledLock"), { status: "outside_window" });
  assert.deepEqual(h.requests, []);
  h.setNow(at("09:00:01"));
  assert.deepEqual((await h.call("runScheduledLock")).models, { ecmwf: "ok", gfs: "ok", icon: "ok" });
  assert.equal(h.requests.length, 9, "metadata, forecast and metadata again for each model");
  assert.ok(h.requests.every((href) => new URL(href).host.startsWith("customer-") && new URL(href).searchParams.get("apikey") === "secret-key"));
  const forecast = new URL(h.requests[1]);
  assert.deepEqual(Object.fromEntries(["models", "start_date", "end_date", "timezone", "timeformat", "hourly"].map((key) => [key, forecast.searchParams.get(key)])), {
    models: "ecmwf_ifs", start_date: DATE, end_date: DATE, timezone: "Asia/Seoul", timeformat: "unixtime",
    hourly: "temperature_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high" });
  const ecmwf = lock(h, "ecmwf"), gfs = lock(h, "gfs");
  assert.deepEqual([ecmwf.method, ecmwf.status, ecmwf.modelId, ecmwf.runInitAt, ecmwf.runCheck, ecmwf.gridLatitude, ecmwf.hourly.length],
    ["live_fetch", "ok", "ecmwf_ifs", Date.parse("2026-11-01T12:00:00Z"), "stable", 37.50439, 24]);
  assert.deepEqual([ecmwf.highC, ecmwf.peakHours], [12.6, [15]]);
  assert.equal(gfs.runInitAt, Date.parse("2026-11-01T18:00:00Z"));
  assert.deepEqual(gfs.issues, ["cloud_cover_mid unavailable"]);
  assert.equal(gfs.hourly.some((row) => "cloudMidPct" in row), false);
  assert.ok(h.tables.seoulProviderForecastLocks.every((row) => !String(row.requestUrl ?? "").includes("secret-key")));
  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: DATE });
  assert.equal(view.providers[2].lock.highC, 12.6);
  assert.ok(view.providers.every((row) => !row.lock || (!("requestUrl" in row.lock) && !("sourceCaptureId" in row.lock))));
});

test("a failed model request is retried in the window and replaces only its error record", async () => {
  const h = harness();
  h.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = "true";
  h.setFetch(openMeteo({ fail: new Set(["ecmwf_ifs"]) }));
  h.setNow(at("09:00"));
  assert.deepEqual((await h.call("runScheduledLock")).models, { ecmwf: "error", gfs: "ok", icon: "ok" });
  const failed = lock(h, "ecmwf");
  assert.deepEqual([failed.status, failed.hourly.length], ["error", 0]);
  assert.match(failed.error, /Open-Meteo 429: Too many concurrent requests/);
  h.requests.length = 0;
  h.setFetch(openMeteo());
  h.setNow(at("09:05"));
  assert.deepEqual((await h.call("runScheduledLock")).models, { ecmwf: "ok", gfs: "duplicate", icon: "duplicate" });
  assert.ok(h.requests.every((href) => !href.includes("/v1/forecast") || href.includes("models=ecmwf_ifs")));
  assert.deepEqual([lock(h, "ecmwf")._id, lock(h, "ecmwf").status, lock(h, "ecmwf").error], [failed._id, "ok", undefined]);
  h.requests.length = 0;
  h.setNow(at("09:10"));
  assert.deepEqual((await h.call("runScheduledLock")).models, { ecmwf: "duplicate", gfs: "duplicate", icon: "duplicate" });
  assert.deepEqual(h.requests, []);
});

test("removing the flag mid-run stops the remaining model requests and the pending write", async () => {
  const modelLocks = (h) => h.tables.seoulProviderForecastLocks.filter((row) => ["ecmwf", "gfs", "icon"].includes(row.provider));
  // The flag is removed while the first forecast request is in flight; the
  // running action still holds its starting copy of the environment.
  const h = harness();
  h.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = "true";
  const server = openMeteo();
  h.setFetch(async (href) => {
    if (href.includes("/v1/forecast")) delete h.env.OPEN_METEO_FORECAST_ACCESS_APPROVED;
    return server(href);
  });
  h.setNow(at("09:00"));
  assert.deepEqual((await h.call("runScheduledLock")).models, { ecmwf: "approval_required", gfs: "approval_required", icon: "approval_required" });
  assert.deepEqual(h.requests.map((href) => new URL(href).pathname), ["/data/ecmwf_ifs/static/meta.json", "/v1/forecast"], "nothing after the removal");
  assert.equal(modelLocks(h).length, 0);

  // A month-long rebuild stops at the first check after the removal.
  const b = harness();
  b.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = "true";
  b.setFetch(async (href) => { delete b.env.OPEN_METEO_FORECAST_ACCESS_APPROVED; return server(href); });
  b.setNow(at("12:00", "2026-11-03"));
  const rebuilt = await b.call("backfillModelLocks", { startDate: "2026-10-04", endDate: DATE });
  assert.equal(rebuilt.status, "approval_required");
  assert.deepEqual(rebuilt.results, [{ date: "2026-10-04", ecmwf: "approval_required", gfs: "approval_required", icon: "approval_required" }]);
  assert.equal(b.requests.length, 1);
  assert.equal(modelLocks(b).length, 0);
});

test("a retry never locks a model run published after 9:00 AM", async () => {
  const h = harness();
  h.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = "true";
  h.setFetch(openMeteo({ fail: new Set(["ncep_gfs_global"]) }));
  h.setNow(at("09:00"));
  assert.deepEqual((await h.call("runScheduledLock")).models, { ecmwf: "ok", gfs: "error", icon: "ok" });
  // GFS 18Z was late that day and became available at 9:01 AM KST.
  h.requests.length = 0;
  h.setFetch(openMeteo({ available: { ncep_gfs013: at("09:01") } }));
  h.setNow(at("09:05"));
  assert.deepEqual((await h.call("runScheduledLock")).models, { ecmwf: "duplicate", gfs: "error", icon: "duplicate" });
  assert.match(lock(h, "gfs").error, /The newest run \(2026-11-01 18Z\) was published after 9:00 AM KST/);
  assert.deepEqual(h.requests.map((href) => new URL(href).pathname), ["/data/ncep_gfs013/static/meta.json"], "no forecast request for a late run");

  // A run that lands while the forecast is being fetched is refused too.
  const c = harness();
  c.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = "true";
  const runs = { ...DOMAIN_RUNS, ncep_gfs013: "12" }, available = {};
  const server = openMeteo({ runs, available });
  c.setFetch(async (href) => {
    const response = await server(href);
    if (href.includes("models=ncep_gfs_global")) { runs.ncep_gfs013 = "18"; available.ncep_gfs013 = at("09:00:20"); }
    return response;
  });
  c.setNow(at("09:00:30"));
  assert.deepEqual((await c.call("runScheduledLock")).models, { ecmwf: "ok", gfs: "error", icon: "ok" });
  assert.deepEqual([lock(c, "gfs").status, lock(c, "gfs").hourly.length], ["error", 0]);
  assert.match(lock(c, "gfs").error, /2026-11-01 18Z/);
});

test("past days are rebuilt from the run normally current at 9:00 AM and labelled as archived", async () => {
  const h = harness();
  h.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = "true";
  h.setFetch(openMeteo());
  h.setNow(at("09:10"));
  assert.deepEqual(await h.call("backfillModelLocks", { startDate: DATE, endDate: DATE }), { status: "ran", results: [] }, "today's lock window is still open");
  assert.deepEqual(h.requests, []);
  h.setNow(at("12:00"));
  const result = await h.call("backfillModelLocks", { startDate: "2026-11-01", endDate: DATE });
  assert.deepEqual(result.results.map((row) => [row.date, row.ecmwf, row.gfs, row.icon]), [["2026-11-01", "ok", "ok", "ok"], [DATE, "ok", "ok", "ok"]]);
  const runs = h.requests.map((href) => new URL(href)).map((url) => [url.host, url.searchParams.get("models"), url.searchParams.get("run"), url.searchParams.get("forecast_days")]);
  assert.deepEqual(runs.slice(0, 3), [
    ["single-runs-api.open-meteo.com", "ecmwf_ifs", "2026-10-31T12:00", "2"], ["single-runs-api.open-meteo.com", "ncep_gfs_global", "2026-10-31T18:00", "2"],
    ["single-runs-api.open-meteo.com", "dwd_icon_global", "2026-10-31T18:00", "2"]]);
  const gfs = lock(h, "gfs", "2026-11-01");
  assert.deepEqual([gfs.method, gfs.runInitAt, gfs.status, gfs.hourly[0].hour], ["single_run_archive", Date.parse("2026-10-31T18:00:00Z"), "ok", 3]);
  await assert.rejects(h.call("backfillModelLocks", { startDate: "2026-09-01", endDate: DATE }), /At most 31 days/);
});

test("completed days are scored once, and the dashboard shows live scores and the 30-day record", async () => {
  const h = harness();
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = "true";
  h.env.OPEN_METEO_FORECAST_ACCESS_APPROVED = "true";
  seedCaptures(h);
  h.setFetch(openMeteo());
  h.setNow(at("09:00"));
  await h.call("runScheduledLock");
  // Observed: 15L at the top of every hour from 9 AM to 1 PM so far, routine METAR all day.
  const actual = profile(14, 13.2);
  h.seed("seoulAmosObservations", [9, 10, 11, 12, 13].flatMap((hour) => [
    { stationIcao: "RKSI", date: DATE, rwyNo: "2", rwyDir: "15L", obsTimeUtc: hourAt(hour), tempC: actual(hour), collectionCadence: "one_minute", updatedAt: hourAt(hour) },
    { stationIcao: "RKSI", date: DATE, rwyNo: "2", rwyDir: "15L", obsTimeUtc: hourAt(hour), tempC: 99, collectionCadence: "five_minute", updatedAt: hourAt(hour) + 1 },
  ]));
  h.seed("seoulMetarObservations", Array.from({ length: 27 }, (_, slot) => metarRow(DATE, slot, Math.round(actual(slot / 2)))));
  h.setNow(at("13:05"));
  const live = await h.call("getDashboard", { stationIcao: "RKSI", date: DATE });
  assert.deepEqual([live.lockAt, live.lockHour, live.actuals.hourly[13].amosC, live.actuals.hourly[13].sky.code], [at("09:00"), 9, actual(13), "CAVOK"]);
  const kma = live.providers[0].score;
  assert.deepEqual([kma.hoursScored, kma.latest.hour, kma.forecastHighC, kma.forecastHighRoundedC], [5, 13, 13, 13]);
  assert.equal("pairs" in kma, false);
  assert.equal(live.providers[2].score.hoursScored, 5);

  h.seed("seoulAmosObservations", Array.from({ length: 10 }, (_, index) => index + 14).map((hour) => (
    { stationIcao: "RKSI", date: DATE, rwyNo: "2", rwyDir: "15L", obsTimeUtc: hourAt(hour), tempC: actual(hour), collectionCadence: "one_minute", updatedAt: hourAt(hour) })));
  h.seed("seoulMetarObservations", Array.from({ length: 21 }, (_, index) => index + 27).map((slot) => metarRow(DATE, slot, Math.round(actual(slot / 2)))));
  h.setNow(at("00:25", "2026-11-03"));
  assert.deepEqual(await h.call("scoreCompletedDays"), { startDate: "2026-10-27", endDate: DATE, scored: 5, missing: 0 });
  assert.deepEqual(await h.call("scoreCompletedDays"), { startDate: "2026-10-27", endDate: DATE, scored: 0, missing: 0 }, "scoring is idempotent");
  const kmaScore = h.tables.seoulProviderForecastScores.find((row) => row.provider === "kma");
  assert.deepEqual([kmaScore.hoursScored, kmaScore.highComplete, kmaScore.actualHighC, kmaScore.forecastHighRoundedC, kmaScore.highErrorC, kmaScore.afterLockReportCount],
    [15, true, 13, 13, 0, 30]);
  assert.equal(kmaScore.pairs.length, 15);
  const gfsScore = h.tables.seoulProviderForecastScores.find((row) => row.provider === "gfs");
  assert.deepEqual([gfsScore.forecastHighRoundedC, gfsScore.highErrorC, gfsScore.peakErrorMinutes], [14, 1, 16 * 60 - (13 * 60 + 30)], "the routine high of 13°C first came at 1:30 PM");

  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: DATE });
  assert.deepEqual([view.summaryStartDate, view.summaryEndDate, view.summaryDayCount], ["2026-10-04", DATE, 1]);
  assert.deepEqual(view.summary.map((row) => [row.provider, row.days, row.exactHighDays]), [["kma", 1, 1], ["weathercom", 1, 1], ["ecmwf", 1, 1], ["gfs", 1, 0], ["icon", 1, 0]]);
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = undefined;
  const hidden = await h.call("getDashboard", { stationIcao: "RKSI", date: DATE });
  assert.equal(hidden.summary.find((row) => row.provider === "kma").days, 0, "stored KMA results are hidden too");
  await assert.rejects(h.call("getDashboard", { stationIcao: "RKSI", date: "2026-02-30" }), /valid/);
});

test("unapproved providers are not scored", async () => {
  const h = harness();
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = "true";
  seedCaptures(h);
  h.setNow(at("09:00"));
  await h.call("lockStoredForecasts", { date: DATE });
  h.seed("seoulAmosObservations", [{ stationIcao: "RKSI", date: DATE, rwyNo: "2", rwyDir: "15L", obsTimeUtc: hourAt(10), tempC: 10, collectionCadence: "one_minute" }]);
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = undefined;
  h.setNow(at("00:25", "2026-11-03"));
  assert.deepEqual(await h.call("scoreCompletedDays"), { startDate: "2026-10-27", endDate: DATE, scored: 1, missing: 0 });
  assert.deepEqual(h.tables.seoulProviderForecastScores.map((row) => row.provider), ["weathercom"]);
});
