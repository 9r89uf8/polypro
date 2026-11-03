import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import schema from "../convex/schema.js";
import * as highs from "../convex/seoulForecastHighs.js";
import * as accuweather from "../convex/seoulAccuweatherForecast.js";
import * as kma from "../convex/seoulKmaForecast.js";
import * as weather from "../convex/seoulWeather.js";
import { forecastHighsInCapture, verifyAccuweatherLocation, verifyWeathercomLocation } from "../convex/lib/seoulForecastHighs.js";

const MODULES = { seoulForecastHighs: highs, seoulAccuweatherForecast: accuweather, seoulKmaForecast: kma, seoulWeather: weather };
const ENV_KEYS = ["KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED", "ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED", "ACCUWEATHER_RKSI_API_KEY", "WEATHERCOM_API_KEY"];
const API_KEY = "fixture-accuweather-key";
const DATE = "2026-11-03", NEXT = "2026-11-04";
const at = (time, date = DATE) => Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}+09:00`);
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

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
      const predicates = [], read = { table };
      let fields = [], direction = 1;
      reads.push(read);
      const selector = Object.fromEntries(["eq", "lt", "lte", "gt", "gte"].map((op) => [op, (field, value) => {
        if (op === "eq") read[field] = value;
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
        async take(count) { return selected().slice(0, count); },
      };
      return query;
    },
    async get(id) { return structuredClone(getRow(id) ?? null); },
    async insert(table, fields) {
      assert.ok(tables[table], `Unknown table ${table}`);
      assert.ok(Object.values(fields).every((value) => value !== undefined), `undefined field in ${table}`);
      const row = { ...structuredClone(fields), _id: `${table}:${++nextId}`, _creationTime: now + nextId / 1000 };
      tables[table].push(row);
      return row._id;
    },
    async delete(id) {
      for (const rows of Object.values(tables)) { const index = rows.findIndex((row) => row._id === id); if (index >= 0) rows.splice(index, 1); }
    },
    async patch(id, fields) {
      const row = getRow(id);
      for (const [key, value] of Object.entries(fields)) { if (value === undefined) delete row[key]; else row[key] = structuredClone(value); }
    },
  };
  const applyEnv = (values) => { for (const key of ENV_KEYS) { if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; } };
  // As in Convex, each execution sees the environment as it was when it started:
  // a nested query or mutation sees the current `env`, the calling action its own copy.
  const dispatch = async (reference, args) => {
    const [module, name] = (typeof reference === "string" ? reference : getFunctionName(reference)).split(":");
    const outer = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    applyEnv(env);
    try { return await MODULES[module][name]._handler(ctx, args); } finally { applyEnv(outer); }
  };
  const ctx = { db, runQuery: dispatch, runMutation: dispatch };
  const call = async (module, name, args = {}) => {
    const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    const oldNow = Date.now, oldFetch = globalThis.fetch;
    applyEnv(env);
    Date.now = () => now;
    globalThis.fetch = async (input, options) => { requests.push({ url: String(input), options }); return fetchImpl(new URL(String(input)), options); };
    try { return await module[name]._handler(ctx, args); } finally {
      Date.now = oldNow;
      globalThis.fetch = oldFetch;
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  };
  const seed = (table, rows) => rows.forEach((row) => tables[table].push({ ...row, _id: `${table}:${++nextId}`, _creationTime: row.capturedAt ?? 0 }));
  return { tables, reads, requests, env, call, seed, setNow(value) { now = value; }, setFetch(fn) { fetchImpl = fn; } };
}

// Synthetic stand-ins for AccuWeather's location and 5-day forecast responses.
const accuLocation = (fields = {}) => ({
  Key: "3602_poi", Type: "POI", LocalizedName: "Incheon International Airport", EnglishName: "Incheon International Airport",
  Country: { ID: "KR", LocalizedName: "South Korea" }, GeoPosition: { Latitude: 37.469, Longitude: 126.451 }, ...fields,
});
const accuDay = (date, maxC, fields = {}) => ({
  Date: `${date}T07:00:00+09:00`,
  Temperature: { Minimum: { Value: maxC - 7, Unit: "C", UnitType: 17 }, Maximum: { Value: maxC, Unit: "C", UnitType: 17 } },
  Day: { IconPhrase: "Partly sunny" }, Night: { IconPhrase: "Cloudy" },
  Link: `http://www.accuweather.com/en/kr/incheon-international-airport/3602_poi/daily-weather-forecast/3602_poi?day=1&lang=en-us`, ...fields,
});
function accuweatherApi(h, { high = () => 18.3, location = accuLocation(), day = {} } = {}) {
  h.setFetch(async (url) => (url.pathname.startsWith("/locations/") ? json(location)
    : json({ Headline: {}, DailyForecasts: [accuDay(DATE, high(), day), accuDay(NEXT, 17.2, day)] })));
}
function approvedAccuweather() {
  const h = harness();
  h.env.ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED = "true";
  h.env.ACCUWEATHER_RKSI_API_KEY = API_KEY;
  return h;
}
const collect = (h) => h.call(accuweather, "collectAirportForecast");
const changes = (h, provider, targetDate = DATE) => h.tables.seoulForecastHighChanges
  .filter((row) => row.provider === provider && row.targetDate === targetDate)
  .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
  .map(({ highC, firstSeenAt, lastSeenAt }) => ({ highC, firstSeenAt, lastSeenAt }));
const providerRow = async (h, id, date = DATE) => (await h.call(highs, "getProviderHighs", { date })).providers.find((row) => row.id === id);

test("AccuWeather requests and stores nothing until the flag is exactly true and a key is set", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    const h = harness();
    if (value !== undefined) h.env.ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED = value;
    h.env.ACCUWEATHER_RKSI_API_KEY = API_KEY; // a working key is not approval
    h.setNow(at("09:00"));
    assert.deepEqual(await collect(h), { status: "approval_required" });
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.tables.seoulForecastHighStatus, []);
    assert.equal((await providerRow(h, "accuweather")).access, "approval_required");
  }
  const h = harness();
  h.env.ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED = "true";
  h.setNow(at("09:00"));
  assert.deepEqual(await collect(h), { status: "setup_required" });
  assert.deepEqual(h.requests, []);
  assert.equal((await providerRow(h, "accuweather")).access, "setup_required");
});

test("stored AccuWeather highs disappear with the flag, before any of its rows are read", async () => {
  const h = approvedAccuweather();
  accuweatherApi(h);
  h.setNow(at("09:00"));
  await collect(h);
  assert.equal((await providerRow(h, "accuweather")).changes.length, 1);
  delete h.env.ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED;
  h.reads.length = 0;
  const row = await providerRow(h, "accuweather");
  assert.deepEqual([row.access, row.changes, row.location], ["approval_required", [], undefined]);
  assert.deepEqual(h.reads.filter((read) => read.provider === "accuweather"), []);
});

test("approval removed during the requests discards the result and stops the run", async () => {
  const h = approvedAccuweather();
  h.setNow(at("09:00"));
  h.setFetch(async (url) => { delete h.env.ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED; return json(accuLocation()); });
  assert.deepEqual(await collect(h), { status: "approval_required" });
  assert.equal(h.requests.length, 1, "the forecast is not requested after the location check");

  const second = approvedAccuweather();
  second.setNow(at("09:00"));
  second.setFetch(async (url) => {
    if (url.pathname.startsWith("/locations/")) return json(accuLocation());
    delete second.env.ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED;
    return json({ DailyForecasts: [accuDay(DATE, 18)] });
  });
  assert.deepEqual(await collect(second), { status: "approval_required" });
  assert.deepEqual(second.tables.seoulForecastHighStatus, []);
  assert.deepEqual(second.tables.seoulForecastHighChanges, []);
});

test("AccuWeather uses the airport's own location, sends the key as a header and checks the location daily", async () => {
  const h = approvedAccuweather();
  accuweatherApi(h);
  h.setNow(at("09:00"));
  assert.deepEqual(await collect(h), { status: "ok" });
  assert.deepEqual(h.requests.map(({ url }) => new URL(url).pathname), ["/locations/v1/3602_poi", "/forecasts/v1/daily/5day/3602_poi"]);
  for (const { url, options } of h.requests) {
    assert.equal(new URL(url).host, "dataservice.accuweather.com");
    assert.ok(!url.includes(API_KEY), "the key is never in a URL");
    assert.equal(options.headers.Authorization, `Bearer ${API_KEY}`);
    assert.equal(options.redirect, "error");
  }
  assert.equal(new URL(h.requests[1].url).searchParams.get("metric"), "true");
  const [check] = h.tables.seoulForecastHighStatus;
  assert.equal(check.status, "ok");
  assert.equal(check.location.name, "Incheon International Airport");
  assert.equal(check.location.distanceKm, 1.3);
  assert.deepEqual(h.tables.seoulForecastHighChanges.map((row) => [row.targetDate, row.highC]), [[DATE, 18.3], [NEXT, 17.2]]);
  assert.ok(!schema.tables.seoulAccuweatherForecastCaptures, "the terms exclude an archive, so responses are not stored");

  h.setNow(at("09:15"));
  assert.deepEqual(await collect(h), { status: "ok" });
  assert.equal(h.requests.length, 3, "a verified location is reused, saving a call");
  h.setNow(at("09:15", NEXT));
  await collect(h);
  assert.equal(new URL(h.requests[3].url).pathname, "/locations/v1/3602_poi", "and checked again after a day");
});

test("a location that cannot be shown to be the airport records nothing", async () => {
  const wrong = [
    accuLocation({ Key: "223658" }), accuLocation({ EnglishName: "Unseo-dong", LocalizedName: "Unseo-dong" }),
    accuLocation({ Country: { ID: "JP" } }), accuLocation({ GeoPosition: { Latitude: 37.5665, Longitude: 126.978 } }),
    accuLocation({ GeoPosition: {} }),
  ];
  for (const location of wrong) {
    const h = approvedAccuweather();
    accuweatherApi(h, { location });
    h.setNow(at("09:00"));
    assert.deepEqual(await collect(h), { status: "location_unverified" }, JSON.stringify(location));
    assert.equal(h.requests.length, 1, "no forecast is requested for the wrong place");
    assert.deepEqual(h.tables.seoulForecastHighChanges, []);
    const row = await providerRow(h, "accuweather");
    assert.deepEqual([row.status, row.location, row.changes], ["location_unverified", null, []]);
  }
  const h = approvedAccuweather();
  accuweatherApi(h, { day: { Link: "http://www.accuweather.com/en/kr/incheon/223658/daily-weather-forecast/223658" } });
  h.setNow(at("09:00"));
  assert.deepEqual(await collect(h), { status: "location_unverified" });
  assert.deepEqual(h.tables.seoulForecastHighChanges, []);
});

test("AccuWeather failures are recorded without touching the last good high or exposing the message", async () => {
  const h = approvedAccuweather();
  accuweatherApi(h);
  h.setNow(at("09:00"));
  await collect(h);
  h.setNow(at("09:15"));
  h.setFetch(async () => json({ Code: "Unauthorized", Message: "Api Authorization failed" }, 401));
  assert.deepEqual(await collect(h), { status: "error" });
  h.setNow(at("09:30"));
  accuweatherApi(h, { day: { Date: `${DATE}T07:00:00Z` } });
  assert.deepEqual(await collect(h), { status: "error" }, "a date outside Seoul time is refused");
  assert.deepEqual(changes(h, "accuweather"), [{ highC: 18.3, firstSeenAt: at("09:00"), lastSeenAt: at("09:00") }]);
  const row = await providerRow(h, "accuweather");
  assert.equal(row.status, "error");
  assert.equal(row.location.locationKey, "3602_poi", "a transport failure does not undo the location check");
  h.setNow(at("09:45"));
  h.setFetch(async () => json({ Code: "Unauthorized", Message: "Api Authorization failed" }, 401));
  await collect(h);
  assert.match(h.tables.seoulForecastHighStatus[0].lastError, /AccuWeather 401: .*Unauthorized/);
  assert.ok(!JSON.stringify(await providerRow(h, "accuweather")).includes("Unauthorized"));
});

test("the change rows keep when each high first and last appeared, including a return to an earlier value", async () => {
  const h = approvedAccuweather();
  const values = [["09:00", 18.3], ["09:15", 18.3], ["09:30", 18.9], ["09:45", 18.3], ["10:00", 18.3]];
  for (const [time, value] of values) {
    accuweatherApi(h, { high: () => value });
    h.setNow(at(time));
    await collect(h);
  }
  assert.deepEqual(changes(h, "accuweather"), [
    { highC: 18.3, firstSeenAt: at("09:00"), lastSeenAt: at("09:15") },
    { highC: 18.9, firstSeenAt: at("09:30"), lastSeenAt: at("09:30") },
    { highC: 18.3, firstSeenAt: at("09:45"), lastSeenAt: at("10:00") },
  ]);
  assert.deepEqual(changes(h, "accuweather", NEXT).map((row) => row.highC), [17.2]);
  assert.deepEqual((await providerRow(h, "accuweather")).changes.map((row) => row.highC), [18.3, 18.9, 18.3]);
  assert.deepEqual((await providerRow(h, "accuweather", NEXT)).changes.map((row) => row.highC), [17.2]);
  assert.deepEqual((await providerRow(h, "accuweather", "2026-11-05")).changes, []);
});

test("AccuWeather highs are deleted inside its terms' two-week limit, with or without the flag", async () => {
  const h = approvedAccuweather();
  const row = (targetDate, seen, highC = 18) => ({ stationIcao: "RKSI", provider: "accuweather", targetDate, highC, firstSeenAt: seen, lastSeenAt: seen, createdAt: seen });
  h.seed("seoulForecastHighChanges", [row("2026-10-19", at("08:00", "2026-10-19")), row("2026-10-22", at("08:00", "2026-10-18")),
    row("2026-10-22", at("08:00", "2026-10-21"), 19), { ...row("2026-10-19", at("08:00", "2026-10-19")), provider: "kma" }]);
  delete h.env.ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED;
  h.setNow(at("09:00", "2026-11-02"));
  assert.deepEqual(await h.call(accuweather, "pruneExpired"), { deleted: 2, more: false });
  assert.deepEqual(h.tables.seoulForecastHighChanges.map((item) => [item.provider, item.highC]), [["accuweather", 19], ["kma", 18]]);
  assert.deepEqual(await h.call(accuweather, "pruneExpired", { retainMs: 0 }), { deleted: 1, more: false });
  assert.deepEqual(h.tables.seoulForecastHighChanges.map((item) => item.provider), ["kma"], "only AccuWeather's rows are touched");
  h.env.ACCUWEATHER_RKSI_FORECAST_ACCESS_APPROVED = "true";
  assert.equal((await providerRow(h, "accuweather", "2026-10-22")).truncated, true, "a date whose first sightings may be gone says so");
  assert.equal((await providerRow(h, "accuweather", "2026-11-03")).truncated, false);
});

test("a capture cannot change a finished day, and disagreeing rows for a date are left out", () => {
  assert.deepEqual(forecastHighsInCapture([
    { date: "2026-11-02", maxTempC: 20 }, { date: DATE, maxTempC: 18 }, { date: NEXT, maxTempC: 17 }, { date: NEXT, maxTempC: 16 },
    { date: "2026-11-05", maxTempC: 61 }, { date: "2026-11-06" }, { date: "not-a-date", maxTempC: 10 }, { date: "2026-11-07", maxTempC: 12 }, { date: "2026-11-07", maxTempC: 12 },
  ], at("00:05")), [{ date: DATE, highC: 18 }, { date: "2026-11-07", highC: 12 }]);
});

// Synthetic Weather.com daily, hourly and location responses.
function weathercomApi(h, { high = 17, location = { icaoCode: "RKSI", airportName: "Incheon International Airport", latitude: 37.469, longitude: 126.451 }, locationStatus = 200, dailyStatus = 200 } = {}) {
  const dates = [DATE, NEXT, "2026-11-05", "2026-11-06", "2026-11-07"];
  h.setFetch(async (url) => {
    assert.equal(url.searchParams.get("icaoCode"), "RKSI");
    if (url.pathname === "/v3/location/point") return json({ location }, locationStatus);
    if (url.pathname === "/v3/wx/forecast/daily/5day") {
      return json({ validTimeLocal: dates.map((date) => `${date}T07:00:00+0900`), calendarDayTemperatureMax: dates.map((_, index) => high - index), calendarDayTemperatureMin: dates.map(() => 7) }, dailyStatus);
    }
    return json({ validTimeUtc: [at("12:00") / 1000], temperature: [high], cloudCover: [50], wxPhraseLong: ["Cloudy"] });
  });
}
const snapshot = (h) => h.call(weather, "collectForecastSnapshot", {});

test("Weather.com highs are recorded only while its location record still resolves to the airport", async () => {
  const h = harness();
  weathercomApi(h);
  h.setNow(at("09:02"));
  await snapshot(h);
  assert.deepEqual(changes(h, "weathercom"), [{ highC: 17, firstSeenAt: at("09:02"), lastSeenAt: at("09:02") }]);
  assert.equal(h.tables.seoulForecastCaptures[0].weathercomLocation.distanceKm, 1.3);
  let row = await providerRow(h, "weathercom");
  assert.deepEqual([row.access, row.status, row.location.icaoCode], ["approved", "ok", "RKSI"]);

  for (const [time, options] of [
    ["09:17", { high: 25, location: { icaoCode: "RKSS", latitude: 37.558, longitude: 126.79 } }],
    ["09:32", { high: 25, location: { icaoCode: "RKSI", latitude: 37.5665, longitude: 126.978 } }],
    ["09:47", { high: 25, locationStatus: 500 }],
  ]) {
    weathercomApi(h, options);
    h.setNow(at(time));
    await snapshot(h);
    assert.deepEqual(changes(h, "weathercom").map((item) => item.highC), [17], time);
    row = await providerRow(h, "weathercom");
    assert.deepEqual([row.status, row.location], ["location_unverified", null], time);
  }
  assert.equal(h.tables.seoulForecastCaptures.length, 4, "the capture itself is kept for the backend's existing uses");
  assert.equal(h.tables.seoulForecastCaptures[1].weathercomForecastDays[0].maxTempC, 25);
  assert.match(h.tables.seoulForecastCaptures[1].weathercomLocationError, /RKSS/);

  weathercomApi(h, { dailyStatus: 500 });
  h.setNow(at("10:02"));
  await snapshot(h);
  assert.equal((await providerRow(h, "weathercom")).status, "error");
  weathercomApi(h, { high: 18 });
  h.setNow(at("10:17"));
  await snapshot(h);
  assert.deepEqual(changes(h, "weathercom").map((item) => item.highC), [17, 18]);
});

const kmaCapture = (capturedAt, high, fields = {}) => ({
  stationIcao: "RKSI", stationName: "Incheon International", source: "kma_amo_airport", sourceUrl: "https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI",
  collectionTrigger: "scheduled", capturedAt, capturedAtLocal: "", captureDate: DATE, status: "ok", approvalFlagName: "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED",
  dailyRows: [{ date: DATE, forecastType: "short_term", maxTempC: high }, { date: NEXT, forecastType: "short_term", maxTempC: high + 2 }], hourlyRows: [], ...fields,
});

test("KMA captures feed the change rows, failed ones leave them alone, and the flag hides them before any read", async () => {
  const h = harness();
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = "true";
  h.setNow(at("09:01"));
  await h.call(kma, "storeForecastCapture", kmaCapture(at("09:01"), 16));
  h.setNow(at("09:11"));
  await h.call(kma, "storeForecastCapture", kmaCapture(at("09:11"), 0, { status: "error", error: "KMA/AMO request failed", dailyRows: [] }));
  assert.equal((await providerRow(h, "kma")).status, "error");
  h.setNow(at("09:21"));
  await h.call(kma, "storeForecastCapture", kmaCapture(at("09:21"), 17));
  assert.deepEqual(changes(h, "kma"), [{ highC: 16, firstSeenAt: at("09:01"), lastSeenAt: at("09:01") }, { highC: 17, firstSeenAt: at("09:21"), lastSeenAt: at("09:21") }]);
  const row = await providerRow(h, "kma");
  assert.deepEqual([row.access, row.status, row.location.icaoCode, row.changes.length], ["approved", "ok", "RKSI", 2]);

  delete h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED;
  h.reads.length = 0;
  const hidden = await providerRow(h, "kma");
  assert.deepEqual([hidden.access, hidden.changes], ["approval_required", []]);
  assert.deepEqual(h.reads.filter((read) => read.provider === "kma"), []);
  assert.equal((await providerRow(h, "weathercom")).access, "approved", "Weather.com has no flag of its own");
  await h.call(kma, "storeForecastCapture", kmaCapture(at("09:31"), 0, { status: "approval_required", dailyRows: [] }));
  assert.equal(h.tables.seoulForecastHighStatus.length, 1, "an approval-required attempt is not a check");
});

test("the query is limited to RKSI and valid dates, and flags a list it had to cut short", async () => {
  const h = harness();
  await assert.rejects(h.call(highs, "getProviderHighs", { stationIcao: "KORD", date: DATE }), /RKSI/);
  await assert.rejects(h.call(highs, "getProviderHighs", { date: "2026-13-01" }), /valid/);
  h.seed("seoulForecastHighChanges", Array.from({ length: 62 }, (_, index) => ({ stationIcao: "RKSI", provider: "weathercom", targetDate: DATE, highC: index % 2,
    firstSeenAt: at("00:00") + index * 60_000, lastSeenAt: at("00:00") + index * 60_000, createdAt: 0 })));
  const row = await providerRow(h, "weathercom");
  assert.equal(row.truncated, true);
  assert.equal(row.changes.length, 60);
  assert.equal(row.changes.at(-1).firstSeenAt, at("00:00") + 61 * 60_000, "the newest changes are kept");
});

test("backfill replays stored captures once, joins live rows and respects the KMA flag", async () => {
  const h = harness();
  h.seed("seoulKmaForecastCaptures", [
    kmaCapture(at("23:00", "2026-11-02"), 15, { captureDate: "2026-11-02" }),
    ...Array.from({ length: 30 }, (_, index) => kmaCapture(at("00:01") + index * 600_000, index < 20 ? 16 : 17)),
    kmaCapture(at("08:00"), 0, { status: "error", dailyRows: [] }),
  ]);
  h.seed("seoulForecastCaptures", [{ stationIcao: "RKSI", capturedAt: at("01:02"), status: "ok", weathercomStatus: "ok",
    weathercomForecastDays: [{ date: DATE, maxTempC: 17 }] }, { stationIcao: "RKSI", capturedAt: at("01:17"), status: "error", weathercomStatus: "error", weathercomForecastDays: [] }]);
  const args = { provider: "kma", startDate: "2026-11-02", endDate: DATE };
  assert.deepEqual(await h.call(highs, "backfillChanges", args), { status: "approval_required", captures: 0 });
  assert.deepEqual(h.tables.seoulForecastHighChanges, []);
  h.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED = "true";
  assert.deepEqual(await h.call(highs, "backfillChanges", args), { status: "done", captures: 32 });
  const expected = [
    { highC: 15, firstSeenAt: at("23:00", "2026-11-02"), lastSeenAt: at("23:00", "2026-11-02") },
    { highC: 16, firstSeenAt: at("00:01"), lastSeenAt: at("00:01") + 19 * 600_000 },
    { highC: 17, firstSeenAt: at("00:01") + 20 * 600_000, lastSeenAt: at("00:01") + 29 * 600_000 },
  ];
  assert.deepEqual(changes(h, "kma"), expected);
  assert.deepEqual(h.tables.seoulForecastHighStatus, [], "old captures never overwrite the current status");
  await h.call(highs, "backfillChanges", args);
  assert.deepEqual(changes(h, "kma"), expected, "a second run changes nothing");
  assert.deepEqual(await h.call(highs, "backfillChanges", { provider: "weathercom", startDate: DATE, endDate: DATE }), { status: "done", captures: 2 });
  assert.deepEqual(changes(h, "weathercom").map((row) => row.highC), [17]);
  await assert.rejects(h.call(highs, "backfillChanges", { provider: "weathercom", startDate: NEXT, endDate: DATE }), /in order/);
});

test("AccuWeather's logo and link come with its row, and only its row", async () => {
  const h = approvedAccuweather();
  const { providers } = await h.call(highs, "getProviderHighs", { date: DATE });
  assert.deepEqual(providers.map((row) => [row.id, row.attribution?.href ?? null]), [["kma", undefined ?? null], ["weathercom", null], ["accuweather", "https://www.accuweather.com"]]);
});

test("the airport checks accept the locations seen on the providers' own pages", () => {
  assert.equal(verifyWeathercomLocation({ location: { icaoCode: "rksi", displayName: "Incheon International Airport", latitude: 37.469, longitude: 126.451 } }, 1).distanceKm, 1.3);
  assert.equal(verifyAccuweatherLocation(accuLocation({ Key: "3602_POI" }), 1).locationKey, "3602_poi");
});
