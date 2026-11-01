import assert from "node:assert/strict";
import test from "node:test";
import schema from "../convex/schema.js";
import * as backend from "../convex/seoulAnalogPeak.js";

const MINUTE = 60_000;
const at = (date, time) => Date.parse(`${date}T${time}:00+09:00`);
const slotTime = slot => `${String(Math.floor(slot / 2)).padStart(2, "0")}:${slot % 2 ? "30" : "00"}`;
// Flat 6°C until 06:00, warming to a single 16°C peak at 14:00, then cooling.
const profile = slot => (slot < 12 ? 6 : slot <= 28 ? 6 + Math.floor(((slot - 12) * 10) / 16) : 16 - Math.floor((slot - 28) / 2));

function metarRow(date, slot, tempC = profile(slot), { reportType = "METAR", minute = null } = {}) {
  const time = minute ?? slotTime(slot), obsTimeUtc = at(date, time);
  const zulu = new Date(obsTimeUtc).toISOString();
  const temp = value => (value < 0 ? `M${String(-value).padStart(2, "0")}` : String(value).padStart(2, "0"));
  return {
    stationIcao: "RKSI", date, obsTimeUtc, obsTimeLocal: `${date} ${time}:00`, reportType, tempC, tempF: tempC * 1.8 + 32,
    rawMetar: `RKSI ${zulu.slice(8, 10)}${zulu.slice(11, 13)}${zulu.slice(14, 16)}Z 32008KT 9999 FEW030 ${temp(tempC)}/${temp(tempC - 7)} Q1018 NOSIG`,
    source: "noaa_tgftp:metar_integer", updatedAt: obsTimeUtc + 5 * MINUTE,
  };
}

// Executes the real handlers against an in-memory table set ordered by the
// schema's indexes, like the provider forecast backend tests.
function harness() {
  let now = 0, nextId = 0;
  const tables = Object.fromEntries(Object.keys(schema.tables).map(table => [table, []]));
  const compare = (a, b) => (a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1);
  const db = {
    query(table) {
      const predicates = [];
      let fields = [], direction = 1;
      const selector = Object.fromEntries(["eq", "lt", "lte", "gt", "gte"].map(op => [op, (field, value) => {
        predicates.push(row => ({ eq: row[field] === value, lt: row[field] < value, lte: row[field] <= value, gt: row[field] > value, gte: row[field] >= value })[op]);
        return selector;
      }]));
      const selected = () => tables[table].filter(row => predicates.every(fn => fn(row))).sort((a, b) => {
        for (const field of [...fields, "_creationTime"]) { const d = compare(a[field], b[field]); if (d) return direction * d; }
        return 0;
      }).map(row => structuredClone(row));
      const query = {
        withIndex(name, fn) {
          const index = schema.tables[table].indexes.find(item => item.indexDescriptor === name);
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
      const row = { ...structuredClone(fields), _id: `${table}:${++nextId}`, _creationTime: now + nextId / 1000 };
      tables[table].push(row);
      return row._id;
    },
  };
  const call = async (name, args = {}) => {
    const original = Date.now;
    Date.now = () => now;
    try { return await backend[name]._handler({ db }, args); } finally { Date.now = original; }
  };
  return { tables, db, call, setNow(value) { now = value; },
    async seed(date, slots) { for (const slot of slots) { now = at(date, slotTime(slot)) + 5 * MINUTE; await db.insert("seoulMetarObservations", metarRow(date, slot)); } } };
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

test("issuance waits for the 09:00 report, then saves one forecast from reports up to the checkpoint", async () => {
  const h = harness(), date = "2026-11-02";
  await h.seed(date, range(0, 17));
  h.setNow(at(date, "09:05"));
  assert.deepEqual(await h.call("issueScheduledCheckpoint"), { status: "waiting" });
  await h.db.insert("seoulMetarObservations", metarRow(date, 18));
  await h.db.insert("seoulMetarObservations", metarRow(date, 19, 30));
  await h.db.insert("seoulMetarObservations", metarRow(date, 17, 25, { reportType: "SPECI", minute: "08:45" }));
  h.setNow(at(date, "09:10"));
  const issued = await h.call("issueScheduledCheckpoint");
  assert.equal(issued.status, "ready");
  const [forecast] = h.tables.seoulAnalogPeakForecasts;
  assert.deepEqual([forecast.date, forecast.checkpoint, forecast.issuedAt], [date, "09:00", at(date, "09:10")]);
  assert.deepEqual(forecast.features.vector.slice(0, 4), [9, 3, 7, 1]);
  assert.equal(forecast.features.maxSoFarC, 9, "the later 30°C report and the SPECI are not inputs");
  assert.equal(forecast.inputReportTimesUtc.at(-1), at(date, "09:00"));
  assert.equal(forecast.analog.count, 30);
  assert.ok(forecast.season.count >= 300 && forecast.analogs.length === 5);
  h.setNow(at(date, "09:15"));
  assert.equal((await h.call("issueScheduledCheckpoint")).status, "duplicate");
  assert.equal(h.tables.seoulAnalogPeakForecasts.length, 1);
});

test("the last attempt in the hour records an unavailable forecast; other hours issue nothing", async () => {
  const h = harness(), date = "2026-11-03";
  await h.seed(date, range(0, 20));
  h.setNow(at(date, "12:50"));
  assert.equal((await h.call("issueScheduledCheckpoint")).status, "waiting");
  h.setNow(at(date, "12:55"));
  assert.equal((await h.call("issueScheduledCheckpoint")).status, "unavailable");
  const [forecast] = h.tables.seoulAnalogPeakForecasts;
  assert.deepEqual([forecast.checkpoint, forecast.status], ["12:00", "unavailable"]);
  assert.match(forecast.reason, /missing or incomplete/);
  h.setNow(at(date, "10:30"));
  assert.deepEqual(await h.call("issueScheduledCheckpoint"), { status: "outside_window" });
});

test("completed days are scored against the full routine record and short days are marked missing", async () => {
  const h = harness();
  await h.seed("2026-11-02", range(0, 47));
  h.setNow(at("2026-11-02", "09:10"));
  await h.call("issueScheduledCheckpoint");
  await h.seed("2026-11-04", range(0, 24));
  h.setNow(at("2026-11-04", "12:10"));
  assert.equal((await h.call("issueScheduledCheckpoint")).status, "ready");
  h.setNow(at("2026-11-05", "00:20"));
  assert.deepEqual(await h.call("scoreCompletedDays"), { scored: 1, missing: 1 });
  const scored = h.tables.seoulAnalogPeakOutcomes.find(row => row.date === "2026-11-02");
  assert.deepEqual([scored.status, scored.actualMaxC, scored.actualPeakFirstMinutes, scored.peakAhead, scored.reportCount], ["scored", 16, 840, true, 48]);
  assert.ok(Number.isFinite(scored.analog.peakErrorMinutes) && Number.isFinite(scored.season.brierPeakAhead));
  const missing = h.tables.seoulAnalogPeakOutcomes.find(row => row.date === "2026-11-04");
  assert.deepEqual([missing.status, missing.reportCount], ["missing", 25]);
  assert.deepEqual(await h.call("scoreCompletedDays"), { scored: 0, missing: 0 }, "scoring is idempotent");

  const view = await h.call("getDashboard", { stationIcao: "RKSI", date: "2026-11-02" });
  assert.ok(view.season.count >= 300);
  assert.equal(view.forecasts.length, 1);
  assert.equal(view.forecasts[0].outcome.status, "scored");
  assert.equal(Object.hasOwn(view.forecasts[0], "inputReportTimesUtc"), false);
  assert.deepEqual([view.performance["09:00"].scoredDays, view.performance["12:00"].scoredDays], [1, 0]);
  assert.equal(view.performance["09:00"].analog.peakMaeMinutes, scored.analog.peakErrorMinutes);
  assert.equal(view.performanceStartDate, "2026-10-04");
  await assert.rejects(h.call("getDashboard", { stationIcao: "RKSI", date: "2026-02-30" }), /valid/);
});

test("a preview computes a checkpoint without saving it", async () => {
  const h = harness(), date = "2026-11-02";
  await h.seed(date, range(0, 30));
  const preview = await h.call("previewCheckpoint", { date, checkpoint: "12:00" });
  assert.deepEqual([preview.reportCount, preview.features.tempC, preview.result.analog.count], [25, profile(24), 30]);
  assert.equal(h.tables.seoulAnalogPeakForecasts.length, 0);
});
