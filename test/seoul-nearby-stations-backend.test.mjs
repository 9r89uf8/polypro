import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getFunctionName } from "convex/server";
import schema from "../convex/schema.js";
import { NEARBY_APPROVAL_FLAG, NEARBY_KEY_NAME, NEARBY_PUBLIC_APPROVAL_FLAG, NEARBY_PUBLIC_SOURCE, NEARBY_PUBLIC_URL, NEARBY_SOURCE, NEARBY_STATIONS, nearbyAccess, nearbyStationsWithGeometry, parseAwsMinuteResponse, parsePublicAwsPage, sanitizeNearbyError } from "../convex/lib/seoulNearbyStations.js";
import * as backend from "../convex/seoulNearbyStations.js";

const MINUTE = 60_000, DATE = "2026-11-02";
const at = (time, date = DATE) => Date.parse(`${date}T${time}:00+09:00`);
const NOW = at("12:31");
const KEY = "test-key-not-real";
const ENV_KEYS = [NEARBY_APPROVAL_FLAG, NEARBY_KEY_NAME, NEARBY_PUBLIC_APPROVAL_FLAG];
const APPROVED = { [NEARBY_APPROVAL_FLAG]: "true", [NEARBY_KEY_NAME]: KEY };
const PUBLIC_APPROVED = { [NEARBY_PUBLIC_APPROVAL_FLAG]: "true" };
const stamp = (time) => new Date(time + 9 * 3_600_000).toISOString().slice(0, 16).replace(/[-:T]/g, "");

// The layout of KMA's published nph-aws2_min sample with synthetic values, not KMA data.
const HEADER = ["#START7777", "# YYMMDDHHMI STN WD1 WS1 WDS WSS WD10 WS10 TA RE RN-15m RN-60m RN-12H RN-DAY HM PA PS TD", "#        KST  ID deg m/s deg m/s deg m/s C mm mm mm mm % hPa hPa C"];
const row = (time, id, { wd10 = "310.0", ws10 = "4.7", ta = "12.9" } = {}) => `${stamp(time)} ${id} 300.0 5.0 305.0 7.0 ${wd10} ${ws10} ${ta} 0.0 0.0 0.0 0.0 0.0 60.0 1010.0 1020.0 5.0`;
const body = (...rows) => [...HEADER, ...rows, "#7777END"].join("\n");
const text = (value, status = 200) => ({ ok: status < 400, status, text: async () => value });

// Runs the real handlers against in-memory tables ordered by the schema's indexes.
function harness() {
  let now = NOW, nextId = 0, fetchImpl = async () => { throw new Error("Unexpected external request"); };
  const tables = Object.fromEntries(Object.keys(schema.tables).map((table) => [table, []]));
  const reads = [], requests = [], scheduled = [], env = {};
  const compare = (a, b) => (a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1);
  const getRow = (id) => Object.values(tables).flat().find((item) => item._id === id);
  const db = {
    query(table) {
      assert.ok(tables[table], `Unknown table ${table}`);
      reads.push(table);
      const predicates = [];
      let fields = [], direction = 1;
      const selector = Object.fromEntries(["eq", "lt", "lte", "gt", "gte"].map((op) => [op, (field, value) => {
        predicates.push((item) => ({ eq: item[field] === value, lt: item[field] < value, lte: item[field] <= value, gt: item[field] > value, gte: item[field] >= value })[op]);
        return selector;
      }]));
      const selected = () => tables[table].filter((item) => predicates.every((fn) => fn(item))).sort((a, b) => {
        for (const field of [...fields, "_creationTime"]) { const difference = compare(a[field], b[field]); if (difference) return direction * difference; }
        return 0;
      }).map((item) => structuredClone(item));
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
        async take(count) { return selected().slice(0, count); },
      };
      return query;
    },
    async insert(table, fields) {
      assert.ok(tables[table], `Unknown table ${table}`);
      assert.ok(Object.values(fields).every((value) => value !== undefined), `undefined field in ${table}`);
      const item = { ...structuredClone(fields), _id: `${table}:${++nextId}`, _creationTime: now + nextId / 1000 };
      tables[table].push(item);
      return item._id;
    },
    async patch(id, fields) { Object.assign(getRow(id), structuredClone(fields)); },
    async replace(id, fields) {
      const item = getRow(id);
      for (const key of Object.keys(item)) if (!key.startsWith("_")) delete item[key];
      Object.assign(item, structuredClone(fields));
    },
    async delete(id) { for (const rows of Object.values(tables)) { const index = rows.findIndex((item) => item._id === id); if (index >= 0) rows.splice(index, 1); } },
  };
  const applyEnv = (values) => { for (const key of ENV_KEYS) { if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; } };
  // As in Convex, each execution sees the environment as it was when it started:
  // a nested query or mutation sees the current `env`, the calling action its own copy.
  const dispatch = async (reference, args) => {
    const outer = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    applyEnv(env);
    try { return await backend[getFunctionName(reference).split(":")[1]]._handler(ctx, args); } finally { applyEnv(outer); }
  };
  const ctx = { db, runQuery: dispatch, runMutation: dispatch, scheduler: { runAfter: async (delay, reference, args) => { scheduled.push({ delay, name: getFunctionName(reference), args }); } } };
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
  const seed = (table, rows) => rows.forEach((item) => tables[table].push({ ...item, _id: `${table}:${++nextId}`, _creationTime: item.firstSeenAt ?? item.updatedAt ?? 0 }));
  const amos = (rwyNo, rwyDir, tempC, time = NOW) => ({ stationIcao: "RKSI", date: DATE, obsTimeUtc: time, obsTimeLocal: "", rwyNo, rwyDir, tempC, windDirAvg: 310, windSpeedAvg: 9.2, collectionCadence: "one_minute", source: "amos_info", updatedAt: time });
  return { tables, reads, requests, scheduled, env, call, seed, amos, setNow(value) { now = value; }, setFetch(fn) { fetchImpl = fn; } };
}

const stationFetch = (make) => async (href) => {
  const url = new URL(href);
  return make(Number(url.searchParams.get("stn")), url);
};
const allOk = stationFetch((id) => text(body(row(NOW - MINUTE, id, { ta: `${10 + id / 1000}` }))));

// The layout of KMA's public page JSON with synthetic values, not KMA data.
const publicItem = (time, id, fields = {}) => ({ awsStnId: id, tm: stamp(time), awsTmp: "9.7", awsWd10: "남남동", awsWs10: "1.8", awsWd1: "남", awsWs1: "1.7", awsTroblKnd: "", windUnit: null, ...fields });
const publicBody = (items, fields = {}) => JSON.stringify({ dataTm: stamp(NOW), windUnit: "m/s", items, ...fields });
const publicOk = (time = NOW - 6 * MINUTE, fields = {}) => async () => text(publicBody([publicItem(time, 201), ...NEARBY_STATIONS.map((station) => publicItem(time, station.id, fields))]));

test("station geometry matches the supplied report and KMA's coordinates", () => {
  const geometry = Object.fromEntries(nearbyStationsWithGeometry().map((station) => [station.id, [station.distanceKm, station.bearingDeg]]));
  assert.deepEqual(geometry, { 508: [7.1, 276], 665: [7.9, 190], 543: [10.5, 66], 577: [12.3, 312] });
});

test("the parser reads the documented columns by name and treats -50 and below as missing", () => {
  const { rows } = parseAwsMinuteResponse(body(row(NOW, 508), row(NOW - MINUTE, 508, { ta: "-99.7", wd10: "-99.9", ws10: "1.2" })), 508);
  assert.equal(rows.length, 2);
  assert.deepEqual({ tempC: rows[0].tempC, windDirDeg: rows[0].windDirDeg, windSpeedMs: rows[0].windSpeedMs, obsTimeUtc: rows[0].obsTimeUtc, obsTimeLocal: rows[0].obsTimeLocal }, { tempC: 12.9, windDirDeg: 310, windSpeedMs: 4.7, obsTimeUtc: NOW, obsTimeLocal: "2026-11-02 12:31" });
  assert.equal(rows[1].tempC, undefined);
  assert.equal(rows[1].windDirDeg, undefined);
  assert.equal(rows[1].windSpeedMs, 1.2);
});

test("the parser also accepts the comma layout and drops rows with nothing usable", () => {
  const comma = ["#START7777", "# YYMMDDHHMI,STN,WD1,WS1,WDS,WSS,WD10,WS10,TA,RE,=", `${stamp(NOW)},543,300.0,5.0,305.0,7.0,90.0,2.0,8.5,0.0,=`, `${stamp(NOW - MINUTE)},543,300.0,5.0,305.0,7.0,-99.9,-99.9,-99.7,0.0,=`, "#7777END"].join("\n");
  const { rows, rejected } = parseAwsMinuteResponse(comma, 543);
  assert.deepEqual(rows.map((item) => [item.stationId, item.tempC, item.windDirDeg]), [[543, 8.5, 90]]);
  assert.equal(rejected, 1);
});

test("the parser refuses anything that is not the documented table for this station", () => {
  assert.throws(() => parseAwsMinuteResponse(body(row(NOW, 577)), 508), (error) => error.code === "format" && /named station 577/.test(error.message));
  assert.throws(() => parseAwsMinuteResponse('{"result":{"status":401}}', 508), (error) => error.code === "key_rejected");
  assert.throws(() => parseAwsMinuteResponse('{"result":{"status":403}}', 508), (error) => error.code === "api_not_applied");
  assert.throws(() => parseAwsMinuteResponse("<html>busy</html>", 508), (error) => error.code === "format");
  assert.throws(() => parseAwsMinuteResponse("#START7777\n# YYMMDDHHMI STN TA\n#7777END", 508), (error) => error.code === "format" && /WD10, WS10/.test(error.message));
  assert.throws(() => parseAwsMinuteResponse(body(`202611311200 508 1 1 1 1 1 1 1 0 0 0 0 0 1 1 1 1`), 508), (error) => error.code === "format" && /do not fit/.test(error.message));
  assert.deepEqual(parseAwsMinuteResponse(body(), 508), { rows: [], rejected: 0 });
  assert.deepEqual(parseAwsMinuteResponse(body(row(NOW, 508, { ta: "-99.7", wd10: "-99.9", ws10: "-99.9" })), 508), { rows: [], rejected: 1 });
});

test("only the exact string true approves, and a key alone enables nothing", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", " true", "true "]) {
    assert.deepEqual(nearbyAccess({ [NEARBY_APPROVAL_FLAG]: flag, [NEARBY_PUBLIC_APPROVAL_FLAG]: flag, [NEARBY_KEY_NAME]: KEY }), { approved: false, configured: false, key: "", source: null, approvedSources: [] });
  }
  assert.deepEqual(nearbyAccess({ [NEARBY_APPROVAL_FLAG]: "true" }), { approved: true, configured: false, key: "", source: null, approvedSources: [NEARBY_SOURCE] });
  assert.deepEqual(nearbyAccess({ [NEARBY_APPROVAL_FLAG]: "true", [NEARBY_KEY_NAME]: `  ${KEY}  ` }), { approved: true, configured: true, key: KEY, source: NEARBY_SOURCE, approvedSources: [NEARBY_SOURCE] });
});

test("each source has its own flag, and API Hub takes over once it has approval and a key", () => {
  const publicOnly = { approved: true, configured: true, key: "", source: NEARBY_PUBLIC_SOURCE, approvedSources: [NEARBY_PUBLIC_SOURCE] };
  assert.deepEqual(nearbyAccess(PUBLIC_APPROVED), publicOnly);
  // A key without API Hub's own flag changes nothing, and the public flag never approves API Hub.
  assert.deepEqual(nearbyAccess({ ...PUBLIC_APPROVED, [NEARBY_KEY_NAME]: KEY }), publicOnly);
  assert.deepEqual(nearbyAccess({ ...PUBLIC_APPROVED, [NEARBY_APPROVAL_FLAG]: "true" }), { approved: true, configured: true, key: "", source: NEARBY_PUBLIC_SOURCE, approvedSources: [NEARBY_SOURCE, NEARBY_PUBLIC_SOURCE] });
  assert.deepEqual(nearbyAccess({ ...PUBLIC_APPROVED, ...APPROVED }), { approved: true, configured: true, key: KEY, source: NEARBY_SOURCE, approvedSources: [NEARBY_SOURCE, NEARBY_PUBLIC_SOURCE] });
});

test("the public page parser keeps the panel's stations and turns compass words into points", () => {
  const { rows, rejected } = parsePublicAwsPage(publicBody([
    publicItem(NOW, 201),
    publicItem(NOW, 508),
    publicItem(NOW, 665, { awsTmp: null, awsWd10: "북", awsWs10: "0" }),
    publicItem(NOW, 543, { awsTmp: "-99.9", awsWd10: "", awsWs10: "." }),
    publicItem(NOW, 577, { awsTmp: "10.4", awsTroblKnd: "1" }),
  ]));
  assert.equal(rejected, 2);
  assert.deepEqual(rows.map(({ rawLine, ...fields }) => fields), [
    { stationId: 508, obsTimeUtc: NOW, obsTimeLocal: "2026-11-02 12:31", tempC: 9.7, windDirDeg: 157.5, windDirCompass: "SSE", windSpeedMs: 1.8 },
    { stationId: 665, obsTimeUtc: NOW, obsTimeLocal: "2026-11-02 12:31", windDirDeg: 0, windDirCompass: "N", windSpeedMs: 0 },
  ]);
  assert.deepEqual(parsePublicAwsPage(publicBody([])), { rows: [], rejected: 0 });
  assert.equal(parsePublicAwsPage(publicBody([publicItem(NOW, 508, { awsWd10: "정온" })])).rows[0].windDirDeg, undefined);
});

test("the public page parser refuses anything that does not look as expected", () => {
  const format = (value) => assert.throws(() => parsePublicAwsPage(value), (error) => error.code === "format");
  format("<html>busy</html>");
  format(JSON.stringify({ windUnit: "m/s" }));
  format(publicBody([publicItem(NOW, 508)], { windUnit: "km/h" }));
  const renamed = publicItem(NOW, 508);
  delete renamed.awsTmp;
  format(publicBody([renamed]));
  format(publicBody([publicItem(NOW, 508, { tm: "202611311200" })]));
});

test("an approved public page run makes one request, stores its stations and labels the source", async () => {
  const app = harness();
  Object.assign(app.env, PUBLIC_APPROVED);
  app.setFetch(publicOk());
  assert.deepEqual(await app.call("queueScheduledRefresh", {}), { queued: true, status: "queued" });
  assert.equal((await app.call("collectLatest", app.scheduled[0].args)).status, "ok");
  assert.deepEqual(app.requests, [NEARBY_PUBLIC_URL]);
  assert.equal(app.tables.seoulNearbyStationObservations.length, NEARBY_STATIONS.length);
  assert.ok(app.tables.seoulNearbyStationObservations.every((item) => item.source === NEARBY_PUBLIC_SOURCE));
  assert.equal(app.tables.seoulNearbyCollectorStatus[0].source, NEARBY_PUBLIC_SOURCE);
  const dashboard = await app.call("getDashboard", { date: DATE });
  assert.deepEqual([dashboard.status, dashboard.source], ["ok", NEARBY_PUBLIC_SOURCE]);
  assert.deepEqual(dashboard.stations.find((station) => station.id === 508).reading, { obsTimeUtc: NOW - 6 * MINUTE, firstSeenAt: NOW, tempC: 9.7, windDirDeg: 157.5, windDirCompass: "SSE", windSpeedMs: 1.8 });
});

test("public page failures stay explicit, and a missing station is only partial", async () => {
  const app = harness();
  Object.assign(app.env, PUBLIC_APPROVED);
  const run = async () => { await app.call("queueScheduledRefresh", {}); return await app.call("collectLatest", app.scheduled.at(-1).args); };
  app.setFetch(async () => text("", 403));
  assert.equal((await run()).status, "error");
  assert.equal(app.tables.seoulNearbyCollectorStatus[0].errorCode, "http_error");
  assert.deepEqual((await app.call("getDashboard", { date: DATE })).collector.errorCode, "http_error");
  app.setNow(NOW + MINUTE);
  app.setFetch(async () => text("<html>maintenance</html>"));
  assert.equal((await run()).status, "error");
  assert.equal(app.tables.seoulNearbyCollectorStatus[0].errorCode, "format");
  app.setNow(NOW + 2 * MINUTE);
  app.setFetch(async () => { throw new Error("connection reset"); });
  assert.equal((await run()).status, "error");
  assert.equal(app.tables.seoulNearbyCollectorStatus[0].errorCode, "network");
  app.setNow(NOW + 3 * MINUTE);
  app.setFetch(async () => text(publicBody([publicItem(NOW, 508)])));
  assert.equal((await run()).status, "partial");
  const dashboard = await app.call("getDashboard", { date: DATE });
  assert.equal(dashboard.status, "partial");
  assert.equal(dashboard.stations.find((station) => station.id === 665).reading, null);
});

test("removing the public flag stops queued work, discards in-flight results and hides stored rows", async () => {
  const queued = harness();
  Object.assign(queued.env, PUBLIC_APPROVED);
  queued.setFetch(publicOk());
  await queued.call("queueScheduledRefresh", {});
  delete queued.env[NEARBY_PUBLIC_APPROVAL_FLAG];
  assert.deepEqual(await queued.call("collectLatest", queued.scheduled[0].args), { status: "approval_required" });
  assert.deepEqual(queued.requests, []);

  const inFlight = harness();
  Object.assign(inFlight.env, PUBLIC_APPROVED);
  const respond = publicOk();
  inFlight.setFetch(async () => { delete inFlight.env[NEARBY_PUBLIC_APPROVAL_FLAG]; return respond(); });
  await inFlight.call("queueScheduledRefresh", {});
  assert.deepEqual(await inFlight.call("collectLatest", inFlight.scheduled[0].args), { status: "approval_required", insertedCount: 0 });
  assert.equal(inFlight.tables.seoulNearbyStationObservations.length, 0);

  const stored = harness();
  Object.assign(stored.env, PUBLIC_APPROVED);
  stored.setFetch(publicOk());
  await stored.call("queueScheduledRefresh", {});
  await stored.call("collectLatest", stored.scheduled[0].args);
  delete stored.env[NEARBY_PUBLIC_APPROVAL_FLAG];
  stored.reads.length = 0;
  const dashboard = await stored.call("getDashboard", { date: DATE });
  assert.deepEqual([dashboard.status, dashboard.source], ["approval_required", null]);
  assert.ok(dashboard.stations.every((station) => station.reading === null));
  assert.ok(!stored.reads.includes("seoulNearbyStationObservations"));
});

test("collection moves to API Hub with its flag and key, and each source's rows follow its own flag", async () => {
  const app = harness();
  Object.assign(app.env, PUBLIC_APPROVED);
  const run = async () => { await app.call("queueScheduledRefresh", {}); return await app.call("collectLatest", app.scheduled.at(-1).args); };
  app.setFetch(publicOk(NOW - 6 * MINUTE));
  await run();

  // The key and API Hub's flag arrive: API Hub is used and its rows win.
  app.setNow(NOW + MINUTE);
  Object.assign(app.env, APPROVED);
  app.requests.length = 0;
  app.setFetch(allOk);
  assert.equal((await run()).status, "ok");
  assert.equal(app.requests.length, NEARBY_STATIONS.length);
  assert.ok(app.requests.every((href) => href.startsWith("https://apihub.kma.go.kr/")));
  let dashboard = await app.call("getDashboard", { date: DATE });
  assert.equal(dashboard.source, NEARBY_SOURCE);
  assert.deepEqual([dashboard.stations[0].reading.obsTimeUtc, dashboard.stations[0].reading.windDirCompass], [NOW - MINUTE, undefined]);

  // A revoked API Hub hides its newer rows and leaves the approved public rows showing.
  delete app.env[NEARBY_APPROVAL_FLAG];
  dashboard = await app.call("getDashboard", { date: DATE });
  assert.equal(dashboard.source, NEARBY_PUBLIC_SOURCE);
  assert.deepEqual([dashboard.stations[0].reading.obsTimeUtc, dashboard.stations[0].reading.windDirCompass], [NOW - 6 * MINUTE, "SSE"]);

  // Results from a source that lost approval mid-run are not stored under any source.
  app.setNow(NOW + 2 * MINUTE);
  assert.deepEqual(await app.call("storeReadings", { stationIcao: "RKSI", runId: "x", source: NEARBY_SOURCE, rows: [] }), { status: "approval_required", insertedCount: 0 });
  assert.deepEqual(await app.call("finishRun", { stationIcao: "RKSI", runId: "x", source: NEARBY_SOURCE, status: "ok", lastAttemptAt: NOW, stations: [] }), { status: "approval_required", updated: false });
});

test("without approval nothing is queued, requested, written or read, and AMOS still shows", async () => {
  for (const flag of [undefined, "false", "TRUE"]) {
    const app = harness();
    Object.assign(app.env, { [NEARBY_APPROVAL_FLAG]: flag, [NEARBY_PUBLIC_APPROVAL_FLAG]: flag, [NEARBY_KEY_NAME]: KEY });
    app.seed("seoulAmosObservations", [app.amos("2", "15L", 13.8), app.amos("3", "16L", 13.2)]);
    app.seed("seoulNearbyStationObservations", [{ stationId: 508, obsTimeUtc: NOW - MINUTE, obsTimeLocal: "", tempC: 99, source: "kma_apihub_aws_minute", rawLine: "", firstSeenAt: NOW, updatedAt: NOW }]);
    app.seed("seoulNearbyCollectorStatus", [{ stationIcao: "RKSI", status: "ok", updatedAt: NOW, collectionRunId: "old" }]);
    assert.deepEqual(await app.call("queueScheduledRefresh", {}), { queued: false, status: "approval_required" });
    assert.deepEqual(app.scheduled, []);
    assert.deepEqual(await app.call("collectLatest", { stationIcao: "RKSI", runId: "old" }), { status: "approval_required" });
    assert.deepEqual(app.requests, []);
    assert.equal(app.tables.seoulNearbyStationObservations.length, 1);
    for (const source of [NEARBY_SOURCE, NEARBY_PUBLIC_SOURCE]) {
      assert.deepEqual(await app.call("storeReadings", { stationIcao: "RKSI", runId: "old", source, rows: [{ stationId: 508, obsTimeUtc: NOW, obsTimeLocal: "", rawLine: "x", tempC: 1 }] }), { status: "approval_required", insertedCount: 0 });
      assert.deepEqual(await app.call("finishRun", { stationIcao: "RKSI", runId: "old", source, status: "error", lastAttemptAt: NOW, stations: [] }), { status: "approval_required", updated: false });
    }
    assert.equal(app.tables.seoulNearbyStationObservations.length, 1);
    assert.equal(app.tables.seoulNearbyCollectorStatus[0].status, "ok");
    app.reads.length = 0;
    const dashboard = await app.call("getDashboard", { stationIcao: "RKSI", date: DATE });
    assert.equal(dashboard.status, "approval_required");
    assert.equal(dashboard.approved, false);
    assert.equal(dashboard.collector, null);
    assert.ok(dashboard.stations.every((station) => station.reading === null));
    assert.equal(dashboard.stations.length, NEARBY_STATIONS.length);
    assert.deepEqual([dashboard.airport.reference.tempC, dashboard.airport.comparison.tempC], [13.8, 13.2]);
    assert.deepEqual([...new Set(app.reads)], ["seoulAmosObservations"]);
  }
});

test("approval without a key asks for setup and queues nothing", async () => {
  const app = harness();
  app.env[NEARBY_APPROVAL_FLAG] = "true";
  assert.deepEqual(await app.call("queueScheduledRefresh", {}), { queued: false, status: "setup_required" });
  assert.deepEqual(app.scheduled, []);
  assert.deepEqual(await app.call("collectLatest", { stationIcao: "RKSI", runId: "x" }), { status: "setup_required" });
  assert.deepEqual(app.requests, []);
  assert.equal((await app.call("getDashboard", { date: DATE })).status, "setup_required");
});

test("an approved run requests each station once, stores its rows and shows them", async () => {
  const app = harness();
  Object.assign(app.env, APPROVED);
  app.setFetch(allOk);
  assert.deepEqual(await app.call("queueScheduledRefresh", {}), { queued: true, status: "queued" });
  assert.deepEqual(await app.call("queueScheduledRefresh", {}), { queued: false, status: "already_running" });
  assert.equal(app.scheduled.length, 1);
  assert.equal(app.scheduled[0].name, "seoulNearbyStations:collectLatest");
  assert.equal((await app.call("collectLatest", app.scheduled[0].args)).status, "ok");
  assert.equal(app.requests.length, NEARBY_STATIONS.length);
  const urls = app.requests.map((href) => new URL(href));
  assert.deepEqual(urls.map((url) => Number(url.searchParams.get("stn"))), NEARBY_STATIONS.map((station) => station.id));
  for (const url of urls) {
    assert.equal(`${url.origin}${url.pathname}`, "https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-aws2_min");
    assert.equal(url.searchParams.get("tm2"), "202611021231");
    assert.equal(url.searchParams.get("tm1"), "202611021216");
    assert.equal(url.searchParams.get("disp"), "1");
    assert.equal(url.searchParams.get("authKey"), KEY);
  }
  assert.equal(app.tables.seoulNearbyStationObservations.length, NEARBY_STATIONS.length);
  const dashboard = await app.call("getDashboard", { date: DATE });
  assert.equal(dashboard.status, "ok");
  const wangsan = dashboard.stations.find((station) => station.id === 508);
  assert.deepEqual(wangsan.reading, { obsTimeUtc: NOW - MINUTE, firstSeenAt: NOW, tempC: 10.508, windDirDeg: 310, windSpeedMs: 4.7 });
  assert.equal(JSON.stringify(dashboard).includes(KEY), false);
  const status = app.tables.seoulNearbyCollectorStatus[0];
  assert.equal(status.status, "ok");
  assert.equal(status.collectionRunId, undefined);
  assert.equal(status.collectionInFlightSince, undefined);
});

test("a later revision keeps the first-seen time, and an unchanged minute writes nothing", async () => {
  const app = harness();
  Object.assign(app.env, APPROVED);
  let temperature = "12.9";
  app.setFetch(stationFetch((id) => text(body(row(NOW - MINUTE, id, { ta: temperature })))));
  const run = async () => { await app.call("queueScheduledRefresh", {}); await app.call("collectLatest", app.scheduled.at(-1).args); };
  await run();
  app.setNow(NOW + MINUTE);
  await run();
  const stored = () => app.tables.seoulNearbyStationObservations.find((item) => item.stationId === 508);
  assert.equal(stored().updatedAt, NOW);
  app.setNow(NOW + 2 * MINUTE);
  temperature = "13.1";
  await run();
  assert.equal(app.tables.seoulNearbyStationObservations.length, NEARBY_STATIONS.length);
  assert.deepEqual([stored().tempC, stored().firstSeenAt, stored().updatedAt], [13.1, NOW, NOW + 2 * MINUTE]);
});

test("revoking approval stops queued work before the request and discards in-flight results", async () => {
  const app = harness();
  Object.assign(app.env, APPROVED);
  app.setFetch(allOk);
  await app.call("queueScheduledRefresh", {});
  delete app.env[NEARBY_APPROVAL_FLAG];
  assert.deepEqual(await app.call("collectLatest", app.scheduled[0].args), { status: "approval_required" });
  assert.deepEqual(app.requests, []);

  const later = harness();
  Object.assign(later.env, APPROVED);
  later.setFetch(stationFetch((id) => { delete later.env[NEARBY_APPROVAL_FLAG]; return text(body(row(NOW - MINUTE, id))); }));
  await later.call("queueScheduledRefresh", {});
  assert.deepEqual(await later.call("collectLatest", later.scheduled[0].args), { status: "approval_required", insertedCount: 0 });
  assert.equal(later.tables.seoulNearbyStationObservations.length, 0);
});

test("a superseded worker makes no request", async () => {
  const app = harness();
  Object.assign(app.env, APPROVED);
  await app.call("queueScheduledRefresh", {});
  assert.deepEqual(await app.call("collectLatest", { stationIcao: "RKSI", runId: "someone-else" }), { status: "superseded" });
  assert.deepEqual(app.requests, []);
});

test("provider failures stay explicit, release the lock and never store the key", async () => {
  const app = harness();
  Object.assign(app.env, APPROVED);
  app.setFetch(async () => text("", 401));
  await app.call("queueScheduledRefresh", {});
  assert.equal((await app.call("collectLatest", app.scheduled[0].args)).status, "error");
  let status = app.tables.seoulNearbyCollectorStatus[0];
  assert.deepEqual([status.status, status.errorCode, status.collectionRunId], ["error", "key_rejected", undefined]);
  let dashboard = await app.call("getDashboard", { date: DATE });
  assert.deepEqual([dashboard.status, dashboard.collector.errorCode], ["error", "key_rejected"]);
  assert.equal("lastError" in dashboard.collector, false);

  // One station's network error names the URL with its key; the stored text must not.
  app.setNow(NOW + MINUTE);
  app.setFetch(stationFetch((id, url) => { if (id === 508) throw new Error(`fetch failed for ${url.href} using ${KEY}`); return text(body(row(NOW, id))); }));
  await app.call("queueScheduledRefresh", {});
  assert.equal((await app.call("collectLatest", app.scheduled.at(-1).args)).status, "partial");
  status = app.tables.seoulNearbyCollectorStatus[0];
  assert.deepEqual([status.status, status.errorCode], ["partial", "network"]);
  assert.equal(status.lastError.includes(KEY), false);
  assert.deepEqual(status.stations.find((item) => item.stationId === 508), { stationId: 508, status: "error", errorCode: "network" });
  dashboard = await app.call("getDashboard", { date: DATE });
  assert.equal(dashboard.status, "partial");
  assert.equal(dashboard.stations.find((station) => station.id === 508).reading, null);

  // A clean run clears the failure.
  app.setNow(NOW + 2 * MINUTE);
  app.setFetch(allOk);
  await app.call("queueScheduledRefresh", {});
  await app.call("collectLatest", app.scheduled.at(-1).args);
  status = app.tables.seoulNearbyCollectorStatus[0];
  assert.deepEqual([status.status, status.errorCode, status.lastError], ["ok", undefined, undefined]);
  assert.equal(sanitizeNearbyError(`https://x/?authKey=${KEY}&stn=1 ${KEY}`, KEY), "https://x/?authKey=[redacted]&stn=1 [redacted]");
});

test("readings outside the retention window or in the future are not stored", async () => {
  const app = harness();
  Object.assign(app.env, APPROVED);
  app.setFetch(stationFetch((id) => text(body(row(NOW + 5 * MINUTE, id), row(NOW - 72 * 60 * MINUTE, id)))));
  await app.call("queueScheduledRefresh", {});
  await app.call("collectLatest", app.scheduled[0].args);
  assert.equal(app.tables.seoulNearbyStationObservations.length, 0);
  assert.equal((await app.call("getDashboard", { date: DATE })).stations.every((station) => station.reading === null), true);
});

test("retention deletes old rows while collection is off, and other dates get no readings", async () => {
  const app = harness();
  app.seed("seoulNearbyStationObservations", [
    { stationId: 508, obsTimeUtc: NOW - 49 * 60 * MINUTE, obsTimeLocal: "", tempC: 1, source: "kma_apihub_aws_minute", rawLine: "", firstSeenAt: NOW, updatedAt: NOW },
    { stationId: 508, obsTimeUtc: NOW - 47 * 60 * MINUTE, obsTimeLocal: "", tempC: 2, source: "kma_apihub_aws_minute", rawLine: "", firstSeenAt: NOW, updatedAt: NOW },
  ]);
  assert.deepEqual(await app.call("pruneExpired", {}), { prunedCount: 1 });
  assert.equal(app.tables.seoulNearbyStationObservations.length, 1);
  Object.assign(app.env, APPROVED);
  app.reads.length = 0;
  for (const date of ["2026-11-01", "2026-11-03"]) {
    const dashboard = await app.call("getDashboard", { date });
    assert.equal(dashboard.status, "not_today");
    assert.ok(dashboard.stations.every((station) => station.reading === null));
    assert.equal(dashboard.airport.reference, null);
  }
  assert.ok(!app.reads.includes("seoulNearbyStationObservations") && !app.reads.includes("seoulNearbyCollectorStatus"));
  assert.ok(app.reads.includes("seoulAmosObservations"), "a read is what wakes an early subscription");
});

test("rows that do not fit the table surface as a format error, not a quiet wait", async () => {
  const app = harness();
  Object.assign(app.env, APPROVED);
  app.setFetch(stationFetch(() => text(body("202611021230 508 1.0"))));
  await app.call("queueScheduledRefresh", {});
  assert.equal((await app.call("collectLatest", app.scheduled[0].args)).status, "error");
  assert.equal(app.tables.seoulNearbyCollectorStatus[0].errorCode, "format");
  const dashboard = await app.call("getDashboard", { date: DATE });
  assert.deepEqual([dashboard.status, dashboard.collector.errorCode], ["error", "format"]);
});

test("the middle card follows the chart's rule for the newest AMOS reading", async () => {
  const app = harness();
  const amosRow = (time, fields) => ({ ...app.amos("2", "15L", 13, time), ...fields });
  app.seed("seoulAmosObservations", [
    amosRow(NOW - 2 * MINUTE, { tempC: 13 }),
    amosRow(NOW - MINUTE, { tempC: 13.4 }),
    amosRow(NOW - MINUTE, { tempC: 13.1, collectionCadence: "five_minute", updatedAt: NOW + MINUTE }),
    amosRow(NOW, { tempC: undefined, collectionCadence: "five_minute" }),
  ]);
  const { airport } = await app.call("getDashboard", { date: DATE });
  assert.deepEqual([airport.reference.tempC, airport.reference.obsTimeUtc], [13.4, NOW - MINUTE]);
  const noTemperature = harness();
  noTemperature.seed("seoulAmosObservations", [{ ...noTemperature.amos("2", "15L", undefined, NOW) }]);
  const missing = (await noTemperature.call("getDashboard", { date: DATE })).airport.reference;
  assert.deepEqual([missing.tempC, missing.obsTimeUtc, missing.windDirDeg], [undefined, NOW, 310]);
});

test("the airport falls back to the previous date in the first minute of a day", async () => {
  const app = harness();
  app.setNow(at("00:00", "2026-11-03"));
  app.seed("seoulAmosObservations", [app.amos("2", "15L", 9.5, at("23:59"))]);
  const dashboard = await app.call("getDashboard", { date: "2026-11-03" });
  assert.equal(dashboard.airport.reference.tempC, 9.5);
  assert.equal(dashboard.airport.comparison, null);
});

test("both crons are registered", () => {
  const crons = readFileSync(new URL("../convex/crons.js", import.meta.url), "utf8");
  assert.match(crons, /"seoul_nearby_stations_every_minute",\s+"\* \* \* \* \*",\s+internal\.seoulNearbyStations\.queueScheduledRefresh/);
  assert.match(crons, /"seoul_nearby_stations_retention",\s+"27 \* \* \* \*",\s+internal\.seoulNearbyStations\.pruneExpired/);
});
