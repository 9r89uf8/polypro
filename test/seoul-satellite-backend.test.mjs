import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../convex/seoulSatellite.js", import.meta.url), "utf8");
const names = [...source.matchAll(/export const (\w+)/g)].map(match => match[1]);
const construct = new Function("internalMutationGeneric", "internalQueryGeneric", "mutationGeneric", "queryGeneric",
  "v", "internal", "satelliteBundleGap", "satelliteCandidate", "satelliteFrameValidator", "process", "Date",
  source.replace(/import[\s\S]*?from\s+"[^"]+";\s*/g, "").replace(/export const /g, "const ")
  + `\nreturn {${names.join(",")}};`);
const NOW = Date.parse("2026-10-30T01:20:00Z"), MINUTE = 60_000, HOUR = 60 * MINUTE;
const MIME = "image/png; profile=rksi-himawari-loop-v2";
const LEGACY_MIME = "image/jpeg; profile=rksi-himawari-loop-v1";
const VERSION = "rksi-himawari-image-v2";
const CLOUD_VERSION = "rksi-himawari-microphysics-v1";
const CLOUD_MIME = "image/png; profile=rksi-himawari-microphysics-v1";

function candidate(time = NOW - 10 * MINUTE, channel = "infrared") {
  const base = Math.floor(time / 600_000) * 600_000;
  const iso = new Date(base).toISOString();
  const date = iso.slice(0, 10).replaceAll("-", ""), hm = iso.slice(11, 16).replace(":", "");
  const jp = String(1 + (time - base) / 150_000).padStart(2, "0");
  return { key: `AHI-L1b-Japan/${iso.slice(0, 10).replaceAll("-", "/")}/${hm}/HS_H09_${date}_${hm}_${channel === "visible" ? "B03" : "B13"}_JP${jp}_${channel === "visible" ? "R05" : "R20"}_S0101.DAT.bz2`,
    channel, nominalTimeUtc: time, sourceLastModifiedAt: time + 5 * MINUTE, sourceSize: 100 };
}
function cloudCandidate(time = NOW - 10 * MINUTE) {
  const infrared = candidate(time), { key: _key, channel: _channel, ...fields } = infrared;
  const sources = ["B04", "B07", "B13"].map(band => ({ ...fields, band,
    resolution: band === "B04" ? "R10" : "R20",
    key: infrared.key.replace("_B13_", `_${band}_`).replace("_R20_", band === "B04" ? "_R10_" : "_R20_") }));
  return { key: sources[0].key, channel: "cloudAnalysis", nominalTimeUtc: time,
    sourceLastModifiedAt: infrared.sourceLastModifiedAt, sourceSize: 300, sources };
}

function harness(flag = "true") {
  let clock = NOW, nextId = 0;
  const env = { NOAA_HIMAWARI_IMAGES_ENABLED: flag };
  const tables = { seoulSatelliteFrames: [], seoulSatelliteCollectorStatus: [] };
  const uploads = new Map();
  const calls = { reads: 0, scheduled: [], deletedUploads: [], urls: [] };
  const db = {
    query(table) {
      calls.reads++;
      const filters = []; let direction = 1;
      const selector = Object.fromEntries(["eq", "lt", "lte", "gt", "gte"].map(operation => [operation, (key, value) => {
        filters.push(row => ({ eq: row[key] === value, lt: row[key] < value, lte: row[key] <= value,
          gt: row[key] > value, gte: row[key] >= value })[operation]); return selector;
      }]));
      const selected = () => tables[table].filter(row => filters.every(fn => fn(row)))
        .sort((a, b) => direction * ((a.obsTimeUtc ?? 0) - (b.obsTimeUtc ?? 0))).map(row => structuredClone(row));
      const query = { withIndex(_index, fn) { fn(selector); return query; }, order(value) { direction = value === "desc" ? -1 : 1; return query; },
        async first() { return selected()[0] ?? null; }, async take(count) { return selected().slice(0, count); } };
      return query;
    },
    async insert(table, fields) { const row = { _id: `row${++nextId}`, ...structuredClone(fields) }; tables[table].push(row); return row._id; },
    async patch(id, fields) { const row = Object.values(tables).flat().find(value => value._id === id); assert.ok(row);
      for (const [key, value] of Object.entries(fields)) { if (value === undefined) delete row[key]; else row[key] = structuredClone(value); } },
    async replace(id, fields) { for (const table of Object.values(tables)) { const index = table.findIndex(row => row._id === id);
      if (index >= 0) { table[index] = { _id: id, ...structuredClone(fields) }; return; } } throw new Error("Missing replacement row"); },
    async delete(id) { for (const table of Object.values(tables)) { const index = table.findIndex(row => row._id === id); if (index >= 0) table.splice(index, 1); } },
    system: { async get(table, id) { assert.equal(table, "_storage"); return uploads.get(id) ?? null; },
      query(table) { assert.equal(table, "_storage"); return { order() { return this; }, async paginate({ cursor, numItems }) {
        assert.equal(numItems, 200); const all = [...uploads.entries()].map(([id, value]) => ({ _id: id, ...value }));
        const start = Number(cursor ?? 0), page = all.slice(start, start + numItems);
        return { page, isDone: start + numItems >= all.length, continueCursor: String(start + numItems) };
      } }; } },
  };
  const internal = { seoulSatellite: Object.fromEntries(names.map(name => [name, name])), seoulSatelliteNode: { collectFrames: "collectFrames" } };
  const register = value => value, v = new Proxy({}, { get: () => () => ({}) });
  class FakeDate extends Date { static now() { return clock; } }
  const module = construct(register, register, register, register, v, internal, {}, {}, {}, { env }, FakeDate);
  const ctx = { db,
    storage: { async delete(id) { uploads.delete(id); calls.deletedUploads.push(id); },
      async getUrl(id) { calls.urls.push(id); return uploads.has(id) ? `https://storage.test/${id}` : null; } },
    scheduler: { async runAfter(delay, name, args) { calls.scheduled.push({ delay, name, args }); } } };
  const call = (name, args = {}) => module[name].handler(ctx, args);
  return { call, db, ctx, env, tables, calls, uploads, setNow(time) { clock = time; },
    status: () => tables.seoulSatelliteCollectorStatus[0],
    upload(id = "image", changes = {}) { uploads.set(id, { size: 200, contentType: MIME, _creationTime: clock, ...changes }); return id; },
    async prepare(candidates = [candidate()]) {
      await call("requestRefresh"); const runId = this.status().activeRunId;
      const claim = await call("claimWorker", { runId });
      await call("savePlan", { runId, workerToken: claim.workerToken, candidates });
      return { runId, workerToken: claim.workerToken };
    },
    frame(item = candidate(), storageId = "image", changes = {}) {
      return { stationIcao: "RKSI", source: "noaa_himawari9", channel: item.channel, sourceKey: item.key,
        nominalTimeUtc: item.nominalTimeUtc, obsTimeUtc: item.nominalTimeUtc + 54_000,
        sourceLastModifiedAt: item.sourceLastModifiedAt, sourceSize: item.sourceSize, status: "ok", storageId,
        fetchedAt: clock, capturedAt: clock, validFraction: .95, rendererVersion: item.channel === "cloudAnalysis" ? CLOUD_VERSION : VERSION,
        ...(item.channel === "cloudAnalysis" ? { sourceSha256: "d".repeat(64),
          sourceObjects: item.sources.map((source, index) => ({ ...source, fetchedAt: clock, observedAt: item.nominalTimeUtc + 54_000,
            sourceSha256: ["a", "b", "c"][index].repeat(64) })) } : {}),
        geometry: { spanKm: 100, centerLatitude: 37.4602, centerLongitude: 126.4407 }, ...changes };
    } };
}

test("exact operational flag gates public reads, queues and workers", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    const h = harness(flag); h.env.NOAA_HIMAWARI_IMAGES_ENABLED = flag;
    assert.equal((await h.call("requestRefresh")).status, "disabled");
    assert.equal((await h.call("queueScheduledRefresh")).status, "disabled");
    assert.equal((await h.call("getLoop")).enabled, false);
    assert.equal(await h.call("claimWorker", { runId: "old" }), null);
    assert.equal(await h.call("checkWorker", { runId: "old", workerToken: "old" }), false);
    assert.equal(h.calls.reads, 0);
    assert.equal(h.calls.scheduled.length, 0);
  }
});

test("one global run and worker token, cooldown, expiry and bounded continuation", async () => {
  const h = harness(); const items = Array.from({ length: 6 }, (_, n) => candidate(NOW - (n + 2) * 150_000));
  const owner = await h.prepare(items);
  assert.equal((await h.call("requestRefresh")).status, "already_running");
  assert.equal(await h.call("claimWorker", { runId: owner.runId }), null);
  const finish = await h.call("finishWorker", { ...owner, attemptedKeys: items.slice(0, 4).map(row => row.key) });
  assert.equal(finish.continued, true);
  assert.equal(h.calls.scheduled.at(-1).delay, 1000);
  const next = await h.call("claimWorker", { runId: owner.runId });
  assert.equal(next.pendingCandidates.length, 2);
  assert.notEqual(next.workerToken, owner.workerToken);
  assert.equal(await h.call("checkWorker", owner), false);
  await h.call("finishWorker", { runId: owner.runId, workerToken: next.workerToken, attemptedKeys: items.slice(4).map(row => row.key) });
  assert.equal((await h.call("requestRefresh")).status, "cooldown");
  h.setNow(NOW + MINUTE);
  assert.equal((await h.call("requestRefresh")).queued, true);
  h.setNow(NOW + 5 * MINUTE);
  assert.equal((await h.call("requestRefresh")).queued, true);
});

test("successful saves are immutable, expose chronological channels and renew lease", async () => {
  const h = harness(), item = candidate(); const owner = await h.prepare([item]);
  h.upload("first"); h.setNow(NOW + MINUTE);
  assert.equal((await h.call("saveFrame", { ...owner, frame: h.frame(item, "first") })).stored, true);
  assert.equal(h.status().leaseUntil, NOW + 4 * MINUTE);
  h.upload("duplicate");
  assert.equal((await h.call("saveFrame", { ...owner, frame: h.frame(item, "duplicate") })).status, "duplicate");
  assert.equal(h.tables.seoulSatelliteFrames.length, 1);
  assert.equal(h.uploads.has("duplicate"), false);
  const loop = await h.call("getLoop");
  assert.equal(loop.frames[0].url, "https://storage.test/first");
  assert.equal(loop.channels.infrared.latestObservedAt, item.nominalTimeUtc + 54_000);
  assert.equal(loop.channels.visible.frames.length, 0);
  assert.equal(loop.windowStartUtc, NOW + MINUTE - HOUR);
});

test("flag revocation, superseded workers and invalid/future saves clean new uploads", async () => {
  for (const mode of ["disabled", "superseded", "future", "invalid_geometry", "bad_type"]) {
    const h = harness(), item = candidate(); const owner = await h.prepare([item]); h.upload(mode);
    const frame = h.frame(item, mode);
    if (mode === "disabled") h.env.NOAA_HIMAWARI_IMAGES_ENABLED = "false";
    if (mode === "superseded") owner.workerToken = "old";
    if (mode === "future") frame.obsTimeUtc = NOW + 1;
    if (mode === "invalid_geometry") frame.geometry.spanKm = 200;
    if (mode === "bad_type") h.uploads.get(mode).contentType = "text/html";
    assert.equal((await h.call("saveFrame", { ...owner, frame })).stored, false);
    assert.equal(h.uploads.has(mode), mode === "bad_type", "Cleanup must not delete an unowned MIME upload");
    assert.equal(h.tables.seoulSatelliteFrames.length, 0);
  }
});

test("nominal margin retains a genuinely recent acquisition but reads never show old/future frames", async () => {
  const h = harness(); h.setNow(NOW + 30_000);
  const item = candidate(NOW - HOUR); const owner = await h.prepare([item]); h.upload();
  assert.equal(h.status().pendingCandidates.length, 1);
  assert.equal((await h.call("saveFrame", { ...owner, frame: h.frame(item) })).stored, true);
  assert.equal((await h.call("getLoop")).frames.length, 1);
  h.setNow(NOW + 55_000);
  assert.equal((await h.call("getLoop")).frames.length, 0);
  h.upload("future");
  await h.db.insert("seoulSatelliteFrames", h.frame(candidate(), "future", { obsTimeUtc: NOW + HOUR }));
  assert.equal((await h.call("getLoop")).frames.length, 0);
});

test("pruning deletes expired database rows and storage even when disabled", async () => {
  const h = harness(); const item = candidate(NOW - HOUR - 150_000); h.upload("expired");
  await h.db.insert("seoulSatelliteFrames", h.frame(item, "expired"));
  h.env.NOAA_HIMAWARI_IMAGES_ENABLED = "false";
  assert.equal((await h.call("pruneExpiredFrames")).deleted, 1);
  assert.equal(h.tables.seoulSatelliteFrames.length, 0);
  assert.equal(h.uploads.size, 0);
});

test("unavailable visible records suppress retries and report honest missing daylight", async () => {
  const h = harness(), item = candidate(NOW - 10 * MINUTE, "visible"), owner = await h.prepare([item]);
  const frame = h.frame(item, undefined, { status: "unavailable", reason: "Low solar elevation." }); delete frame.storageId;
  assert.equal((await h.call("saveFrame", { ...owner, frame })).stored, true);
  const loop = await h.call("getLoop");
  assert.equal(loop.frames.length, 0);
  assert.equal(loop.channels.visible.status, "unavailable");
  assert.match(loop.channels.visible.unavailableReason, /Low solar/);
  await h.call("finishWorker", { ...owner, attemptedKeys: [item.key] });
  h.setNow(NOW + MINUTE); await h.call("requestRefresh");
  const runId = h.status().activeRunId, claim = await h.call("claimWorker", { runId });
  assert.deepEqual(await h.call("savePlan", { runId, workerToken: claim.workerToken, candidates: [item] }), []);
});

test("errors stop continuation, stale images stay marked and referenced cleanup is safe", async () => {
  const h = harness(), item = candidate(NOW - 20 * MINUTE), owner = await h.prepare([item]); h.upload();
  await h.call("saveFrame", { ...owner, frame: h.frame(item) });
  const result = await h.call("finishWorker", { ...owner, attemptedKeys: [], error: "Provider failed." });
  assert.equal(result.continued, false);
  assert.equal((await h.call("getLoop")).channels.infrared.stale, true);
  await h.call("deleteUploadIfUnreferenced", { storageId: "image" });
  assert.equal(h.uploads.has("image"), true);
  assert.equal(h.calls.scheduled.length, 1);
});

test("per-source failures persist while older candidates continue, then clear on successful retry", async () => {
  const h = harness(), items = Array.from({ length: 6 }, (_, n) => candidate(NOW - (n + 2) * 150_000));
  const owner = await h.prepare(items);
  assert.equal((await h.call("recordSourceFailure", { ...owner, key: items[0].key, error: "Persistent HTTP 503" })).recorded, true);
  const finish = await h.call("finishWorker", { ...owner, attemptedKeys: items.slice(0, 4).map(row => row.key),
    error: "Persistent HTTP 503", continueAfterErrors: true });
  assert.equal(finish.continued, true);
  assert.equal(h.status().sourceFailures[0].key, items[0].key);
  const next = await h.call("claimWorker", { runId: owner.runId });
  assert.deepEqual(next.pendingCandidates.map(row => row.key), items.slice(4).map(row => row.key));
  await h.call("finishWorker", { runId: owner.runId, workerToken: next.workerToken, attemptedKeys: items.slice(4).map(row => row.key) });
  h.setNow(NOW + MINUTE);
  const retry = await h.prepare([items[0]]); h.upload("retry");
  await h.call("saveFrame", { ...retry, frame: h.frame(items[0], "retry") });
  assert.equal(h.status().sourceFailures.length, 0);
});

test("orphan sweep recovers store-before-schedule crashes without touching other uploads", async () => {
  const h = harness(), old = NOW - 6 * MINUTE;
  h.upload("crashed-before-schedule", { _creationTime: old });
  h.upload("legacy-crash", { _creationTime: old, contentType: LEGACY_MIME });
  h.upload("cloud-crash", { _creationTime: old, contentType: CLOUD_MIME });
  h.upload("other-jpeg", { _creationTime: old, contentType: "image/jpeg" });
  h.upload("recent-owned", { _creationTime: NOW - MINUTE });
  h.upload("referenced-owned", { _creationTime: old });
  await h.db.insert("seoulSatelliteFrames", h.frame(candidate(), "referenced-owned"));
  h.env.NOAA_HIMAWARI_IMAGES_ENABLED = "false";
  const result = await h.call("pruneExpiredFrames");
  assert.equal(result.orphanUploadsDeleted, 3);
  assert.equal(result.storageObjectsScanned, 6);
  assert.deepEqual([...h.uploads.keys()], ["other-jpeg", "recent-owned", "referenced-owned"]);
});

test("deployment supersedes legacy active leases and rejects late legacy worker writes", async () => {
  const h = harness(), item = candidate();
  await h.db.insert("seoulSatelliteCollectorStatus", { stationIcao: "RKSI", status: "collecting", updatedAt: NOW,
    activeRunId: "RKSI:legacy", runRendererVersion: VERSION, runStartedAt: NOW, queuedAt: NOW, leaseUntil: NOW + 180_000,
    workerToken: "legacy-token", workerActiveUntil: NOW + 180_000, pendingCandidates: [item], planReady: true });
  assert.equal(await h.call("checkWorker", { runId: "RKSI:legacy", workerToken: "legacy-token" }), false);
  assert.equal((await h.call("requestRefresh")).queued, true, "Old lease and cooldown cannot delay the new renderer");
  const runId = h.status().activeRunId, claim = await h.call("claimWorker", { runId });
  await h.call("savePlan", { runId, workerToken: claim.workerToken, candidates: [item] });
  h.upload("late-legacy", { contentType: LEGACY_MIME });
  const legacy = h.frame(item, "late-legacy"); delete legacy.rendererVersion;
  assert.equal((await h.call("saveFrame", { runId: "RKSI:legacy", workerToken: "legacy-token", frame: legacy })).status, "superseded");
  assert.equal(h.uploads.has("late-legacy"), false);
  h.upload("wrong-current-token-version", { contentType: LEGACY_MIME }); legacy.storageId = "wrong-current-token-version";
  assert.equal((await h.call("saveFrame", { runId, workerToken: claim.workerToken, frame: legacy })).status, "invalid_frame");
  assert.equal(h.uploads.has("wrong-current-token-version"), false);
});

test("legacy source keys rerender atomically, current versions dedupe and queries never mix contrast", async () => {
  const h = harness(), first = candidate(), older = candidate(NOW - 15 * MINUTE), visible = candidate(NOW - 10 * MINUTE, "visible");
  for (const [item, id] of [[first, "old-first"], [older, "old-second"], [visible, "old-visible"]]) {
    h.upload(id, { contentType: LEGACY_MIME }); const frame = h.frame(item, id); delete frame.rendererVersion;
    await h.db.insert("seoulSatelliteFrames", frame);
  }
  const before = await h.call("getLoop");
  assert.equal(before.channels.infrared.frames.length, 2);
  assert.ok(before.frames.every(frame => frame.rendererVersion === "rksi-himawari-image-v1"));
  const owner = await h.prepare([first, older, visible]);
  assert.equal(h.status().pendingCandidates.length, 3, "Existing v1 identity remains eligible");
  const originalId = h.tables.seoulSatelliteFrames.find(row => row.sourceKey === first.key)._id;
  h.upload("new-first");
  assert.equal((await h.call("saveFrame", { ...owner, frame: h.frame(first, "new-first") })).replaced, true);
  assert.equal(h.tables.seoulSatelliteFrames.find(row => row.sourceKey === first.key)._id, originalId);
  assert.equal(h.uploads.has("old-first"), false);
  assert.equal(h.uploads.has("old-second"), true);
  h.calls.urls.length = 0;
  const after = await h.call("getLoop");
  assert.deepEqual(after.channels.infrared.frames.map(frame => frame.url), ["https://storage.test/new-first"]);
  assert.equal(after.channels.infrared.rendererVersion, VERSION);
  assert.equal(after.channels.visible.rendererVersion, "rksi-himawari-image-v1");
  assert.equal(h.calls.urls.includes("old-second"), false, "Hidden legacy frames must not even receive URLs");
  assert.equal(h.calls.urls.includes("old-visible"), true);
  assert.deepEqual((await h.call("savePlan", { ...owner, candidates: [first] })), []);
});

test("invalid, unavailable or source-changed upgrades preserve the old success and clean only new owned data", async () => {
  for (const kind of ["invalid", "unavailable", "source_changed"]) {
    const h = harness(), item = candidate(); h.upload("legacy", { contentType: LEGACY_MIME });
    const old = h.frame(item, "legacy", { sourceSha256: "original-source" }); delete old.rendererVersion;
    await h.db.insert("seoulSatelliteFrames", old);
    const owner = await h.prepare([item]); h.upload("new");
    const updated = h.frame(item, "new", { sourceSha256: kind === "source_changed" ? "replaced-source" : "original-source" });
    if (kind === "invalid") updated.geometry.spanKm = 200;
    if (kind === "unavailable") { updated.status = "unavailable"; delete updated.storageId; updated.reason = "Low sunlight"; }
    assert.equal((await h.call("saveFrame", { ...owner, frame: updated })).stored, false);
    assert.equal(h.tables.seoulSatelliteFrames.length, 1);
    assert.equal(h.tables.seoulSatelliteFrames[0].storageId, "legacy");
    assert.equal(h.uploads.has("legacy"), true);
    if (kind !== "unavailable") assert.equal(h.uploads.has("new"), false);
  }
});

test("cloud collection preserves v2 single-band images and records the complete synchronized bundle", async () => {
  const h = harness(), infrared = candidate(), visible = candidate(NOW - 10 * MINUTE, "visible"), cloud = cloudCandidate();
  for (const [item, id] of [[infrared, "infrared"], [visible, "visible"]]) {
    h.upload(id); await h.db.insert("seoulSatelliteFrames", h.frame(item, id));
  }
  const owner = await h.prepare([infrared, visible, cloud]);
  assert.deepEqual(h.status().pendingCandidates.map(row => row.channel), ["cloudAnalysis"]);
  h.upload("cloud", { contentType: CLOUD_MIME });
  assert.equal((await h.call("saveFrame", { ...owner, frame: h.frame(cloud, "cloud") })).stored, true);
  const loop = await h.call("getLoop");
  assert.equal(loop.frames.length, 3);
  assert.equal(loop.channels.cloudAnalysis.rendererVersion, CLOUD_VERSION);
  assert.deepEqual(loop.channels.cloudAnalysis.frames[0].sourceObjects.map(source => source.band), ["B04", "B07", "B13"]);
  assert.equal(loop.channels.infrared.frames[0].rendererVersion, VERSION);
  assert.equal(loop.channels.visible.frames[0].rendererVersion, VERSION);
});

test("partial, cross-slot and unsynchronized cloud provenance never reaches stored imagery", async () => {
  for (const mode of ["partial_plan", "cross_slot_plan", "missing_hash", "cross_slot_frame", "unsynchronized", "wrong_renderer", "wrong_mime"]) {
    const h = harness(), item = cloudCandidate();
    if (mode === "partial_plan") item.sources.pop();
    if (mode === "cross_slot_plan") item.sources[1].nominalTimeUtc += 150_000;
    if (mode.endsWith("_plan")) { await assert.rejects(h.prepare([item]), /Invalid satellite candidate plan/); continue; }
    const owner = await h.prepare([item]); h.upload("cloud", { contentType: mode === "wrong_mime" ? MIME : CLOUD_MIME });
    const frame = h.frame(item, "cloud");
    if (mode === "missing_hash") frame.sourceObjects[1].sourceSha256 = "";
    if (mode === "cross_slot_frame") frame.sourceObjects[1].nominalTimeUtc += 150_000;
    if (mode === "unsynchronized") { frame.sourceObjects[1].observedAt += 61_000; frame.obsTimeUtc = frame.sourceObjects[1].observedAt; }
    if (mode === "wrong_renderer") frame.rendererVersion = VERSION;
    assert.equal((await h.call("saveFrame", { ...owner, frame })).stored, false, mode);
    assert.equal(h.tables.seoulSatelliteFrames.length, 0, mode);
    assert.equal(h.uploads.has("cloud"), false, mode);
  }
});

test("missing cloud bands are durable honest gaps, never fabricated frames", async () => {
  const h = harness(), owner = await h.prepare([]);
  await h.call("savePlan", { ...owner, candidates: [], missingBundles: [{ nominalTimeUtc: NOW - 10 * MINUTE, missingBands: ["B07"] }] });
  const loop = await h.call("getLoop");
  assert.equal(loop.channels.cloudAnalysis.frames.length, 0);
  assert.equal(loop.channels.cloudAnalysis.status, "unavailable");
  assert.match(loop.channels.cloudAnalysis.unavailableReason, /missing B07/);
  assert.equal(loop.collector.bundleGaps.length, 1);
});

test("minute rediscovery prioritizes new frames without resurrecting failures from this run", async () => {
  const h = harness(), items = Array.from({ length: 6 }, (_, n) => candidate(NOW - (n + 2) * 150_000));
  const owner = await h.prepare(items);
  for (const item of items.slice(0, 4)) await h.call("recordSourceFailure", { ...owner, key: item.key, error: "Persistent source failure" });
  await h.call("finishWorker", { ...owner, attemptedKeys: items.slice(0, 4).map(item => item.key), error: "Source failure", continueAfterErrors: true });
  h.setNow(NOW + MINUTE);
  const claim = await h.call("claimWorker", { runId: owner.runId });
  assert.equal(claim.planReady, false, "A minute-old discovery must refresh even with remaining backfill");
  const newest = { ...candidate(NOW - 150_000), sourceLastModifiedAt: NOW + MINUTE };
  const pending = await h.call("savePlan", { runId: owner.runId, workerToken: claim.workerToken, candidates: [...items, newest] });
  assert.deepEqual(pending.map(item => item.key), [newest, ...items.slice(4)].map(item => item.key));
  assert.equal(h.status().sourceFailures.length, 4);
});

test("75-source-frame plans support nineteen bounded actions, not an unbounded bootstrap", async () => {
  const h = harness(), items = [];
  for (let i = 0; i < 25; i++) {
    const time = NOW - i * 150_000;
    for (const item of [candidate(time), candidate(time, "visible"), cloudCandidate(time)]) {
      item.sourceLastModifiedAt = Math.min(item.sourceLastModifiedAt, NOW);
      for (const source of item.sources ?? []) source.sourceLastModifiedAt = item.sourceLastModifiedAt;
      items.push(item);
    }
  }
  const owner = await h.prepare(items);
  assert.equal(h.status().pendingCandidates.length, 75);
  await assert.rejects(h.call("savePlan", { ...owner, candidates: [...items, candidate(NOW - 10 * MINUTE)] }), /Invalid satellite candidate plan/);
  h.status().continuationCount = 17;
  assert.equal((await h.call("finishWorker", { ...owner, attemptedKeys: [] })).continued, true);
  const claim = await h.call("claimWorker", { runId: owner.runId });
  assert.equal((await h.call("finishWorker", { runId: owner.runId, workerToken: claim.workerToken, attemptedKeys: [] })).continued, false);
});
