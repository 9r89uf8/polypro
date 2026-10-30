// In-memory Convex database for the GOCI-II backend handlers (real code, fake storage).
import assert from "node:assert/strict";
import { getFunctionName } from "convex/server";
import * as backend from "../../convex/seoulGoci2.js";
import { fixtureKey } from "./goci2Synthetic.mjs";

export const NOW = Date.parse("2026-10-30T02:50:00Z"), NOMINAL = Date.parse("2026-10-30T02:15:30Z");
export const VERSION = "rksi-goci2-truecolor-v1", MIME = "image/png; profile=rksi-goci2-truecolor-v1";
export const FLAG = "KHOA_GOCI2_ACCESS_APPROVED";

export function createBackendHarness(flag = "true") {
  let clock = NOW, nextId = 0;
  const tables = { seoulGoci2Frames: [], seoulGoci2CollectorStatus: [] }, uploads = new Map();
  const calls = { reads: 0, scheduled: [], deletedUploads: [], urls: [] };
  const db = {
    query(table) {
      calls.reads++;
      const filters = [];
      let direction = 1;
      const selector = Object.fromEntries(["eq", "lt", "lte", "gt", "gte"].map(operation => [operation, (key, value) => {
        filters.push(row => ({ eq: row[key] === value, lt: row[key] < value, lte: row[key] <= value, gt: row[key] > value, gte: row[key] >= value })[operation]);
        return selector;
      }]));
      const selected = () => tables[table].filter(row => filters.every(filter => filter(row)))
        .sort((a, b) => direction * ((a.obsTimeUtc ?? 0) - (b.obsTimeUtc ?? 0))).map(row => structuredClone(row));
      const query = { withIndex(_name, fn) { fn?.(selector); return query; }, order(value) { direction = value === "desc" ? -1 : 1; return query; },
        async first() { return selected()[0] ?? null; }, async take(count) { return selected().slice(0, count); } };
      return query;
    },
    async insert(table, fields) { const row = { _id: `row${++nextId}`, ...structuredClone(fields) }; tables[table].push(row); return row._id; },
    async patch(id, fields) {
      const row = Object.values(tables).flat().find(value => value._id === id); assert.ok(row);
      for (const [key, value] of Object.entries(fields)) { if (value === undefined) delete row[key]; else row[key] = structuredClone(value); }
    },
    async replace(id, fields) {
      for (const table of Object.values(tables)) {
        const index = table.findIndex(row => row._id === id);
        if (index >= 0) { table[index] = { _id: id, ...structuredClone(fields) }; return; }
      }
      throw new Error("Missing replacement row");
    },
    async delete(id) { for (const table of Object.values(tables)) { const index = table.findIndex(row => row._id === id); if (index >= 0) table.splice(index, 1); } },
    system: {
      async get(table, id) { assert.equal(table, "_storage"); return uploads.has(id) ? { _id: id, ...uploads.get(id) } : null; },
      query(table) {
        assert.equal(table, "_storage");
        return { order() { return this; }, async paginate({ cursor, numItems }) {
          const all = [...uploads.entries()].map(([id, value]) => ({ _id: id, ...value })), start = Number(cursor ?? 0);
          return { page: all.slice(start, start + numItems), isDone: start + numItems >= all.length, continueCursor: String(start + numItems) };
        } };
      },
    },
  };
  const env = { [FLAG]: flag };
  const ctx = { db,
    storage: { async delete(id) { uploads.delete(id); calls.deletedUploads.push(id); },
      async getUrl(id) { calls.urls.push(id); return uploads.has(id) ? `https://storage.test/${id}` : null; } },
    scheduler: { async runAfter(delay, reference, args) { calls.scheduled.push({ delay, name: getFunctionName(reference), args }); } } };
  const call = async (name, args = {}) => {
    const previous = { now: Date.now, flag: process.env[FLAG] };
    Date.now = () => clock;
    if (env[FLAG] === undefined) delete process.env[FLAG]; else process.env[FLAG] = env[FLAG];
    try { return await backend[name]._handler(ctx, args); }
    finally { Date.now = previous.now; if (previous.flag === undefined) delete process.env[FLAG]; else process.env[FLAG] = previous.flag; }
  };
  /** Runs an action with this harness's clock and flag for its whole duration;
   * runQuery/runMutation dispatch to the real backend handlers. */
  const runAction = async (action, args, events = []) => {
    let stored = 0;
    const dispatch = async (reference, input) => {
      const name = getFunctionName(reference).replace(/^seoulGoci2:/, ""), result = await call(name, input);
      events.push({ type: name, args: input, result });
      return result;
    };
    const actionCtx = { runQuery: dispatch, runMutation: dispatch, scheduler: ctx.scheduler,
      storage: { async store(blob) {
        const id = `stored${++stored}`;
        uploads.set(id, { size: blob.size, contentType: blob.type, _creationTime: clock });
        events.push({ type: "store", id, size: blob.size, contentType: blob.type, blob });
        return id;
      } } };
    const previous = { now: Date.now, flag: process.env[FLAG] };
    Date.now = () => clock;
    if (env[FLAG] === undefined) delete process.env[FLAG]; else process.env[FLAG] = env[FLAG];
    try { return await action._handler(actionCtx, args); }
    finally { Date.now = previous.now; if (previous.flag === undefined) delete process.env[FLAG]; else process.env[FLAG] = previous.flag; }
  };
  return { call, runAction, ctx, db, env, tables, uploads, calls,
    setNow(time) { clock = time; }, get now() { return clock; },
    status: () => tables.seoulGoci2CollectorStatus[0],
    upload(id = "image", changes = {}) { uploads.set(id, { size: 300_000, contentType: MIME, _creationTime: clock, ...changes }); return id; },
    async claim() {
      assert.equal((await call("requestRefresh")).status, "queued");
      const runId = tables.seoulGoci2CollectorStatus[0].activeRunId, claim = await call("claimWorker", { runId });
      return { runId, workerToken: claim.workerToken, claim };
    },
    frame(changes = {}) {
      return { stationIcao: "RKSI", source: "khoa_nosc_goci2", sourceKey: fixtureKey(), slot: "S007", nominalTimeUtc: NOMINAL,
        obsTimeUtc: Date.parse("2026-10-30T02:27:48Z"), observationStartUtc: Date.parse("2026-10-30T02:27:16Z"),
        observationEndUtc: Date.parse("2026-10-30T02:28:20Z"), status: "ok", storageId: "image", sourceSize: 432845988,
        sourceLastModifiedAt: Date.parse("2026-10-30T02:41:49Z"), fetchedAt: clock, capturedAt: clock, rendererVersion: VERSION,
        imageSha256: "a".repeat(64), sourceObjects: [{ variable: "das", constraint: "", bytes: 100, sha256: "b".repeat(64) }],
        subset: { rowStart: 386, rowEnd: 696, columnStart: 1233, columnEnd: 1665, gridRows: 2780, gridColumns: 2780 },
        solarElevationDeg: 37.8, validFraction: 1, display: { recipe: "goci2-truecolor-v1", lowSun: false },
        geometry: { width: 512, height: 512, spanKm: 100, centerLatitude: 37.4602, centerLongitude: 126.4407,
          nativePixelSpacingKm: { column: 0.259, row: 0.36 } }, ...changes };
    } };
}
