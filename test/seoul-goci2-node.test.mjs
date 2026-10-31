import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PNG } from "pngjs";
import * as worker from "../convex/seoulGoci2Node.js";
import { createBackendHarness, FLAG, MIME, NOW } from "./fixtures/goci2BackendHarness.mjs";
import { createFixtureServer, fixtureDas } from "./fixtures/goci2Synthetic.mjs";

// SYNTHETIC end-to-end runs: real worker and backend code, in-memory Convex,
// and a fake NOSC host. No request leaves this process.
async function collect(h, server, events = []) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => { events.push({ type: "fetch", href: String(input), options }); return server.fetch(input, options); };
  try {
    const queued = await h.call("requestRefresh");
    if (queued.status !== "queued") return { queued, events };
    const result = await h.runAction(worker.collectLatest, h.calls.scheduled.at(-1).args, events);
    return { queued, result, events };
  } finally { globalThis.fetch = realFetch; }
}
const fetches = events => events.filter(event => event.type === "fetch");
const hyperslabs = server => server.requests.filter(request => request.kind === "dods").map(request => decodeURIComponent(new URL(request.href).search));

test("the worker makes no request and no mutation unless approval is exactly true", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    const h = createBackendHarness(); h.env[FLAG] = flag;
    const server = createFixtureServer(), events = [];
    const result = await h.runAction(worker.collectLatest, { runId: "RKSI:goci2:1" }, events);
    assert.deepEqual(result, { status: "approval_required" });
    assert.equal(server.requests.length, 0);
    assert.deepEqual(events, []);
  }
});

test("first activation discovers the slot holding RKSI, downloads bounded subsets and stores one PNG", async () => {
  const h = createBackendHarness(), server = createFixtureServer();
  const { result, events } = await collect(h, server);
  assert.equal(result.status, "idle");
  for (const [index, event] of events.entries()) {
    if (event.type !== "fetch") continue;
    assert.equal(events[index - 1].type, "checkWorker", "approval and ownership are re-checked immediately before every NOSC request");
    assert.equal(events[index - 1].result, true);
    assert.equal(event.options.redirect, "error");
    assert.equal(event.options.headers["Accept-Encoding"], "identity");
  }
  assert.deepEqual(server.requests.map(request => request.kind),
    ["dayCatalog", "dayCatalog", "directoryCatalog", "dds", "dods", "dods", "dds", "dods", "dods", "dods", "dods", "das", "dods", "dods", "dods", "dods", "dods"]);
  assert.ok(server.requests.every(request => !request.href.endsWith(".nc")), "whole slot files are never requested");
  const slabs = hyperslabs(server);
  assert.ok(slabs.slice(0, 2).every(slab => slab.includes("_S006") || /\[0:1389:2779\]\[0:1389:2779\]$/.test(slab)), "slot probe is 3 × 3");
  assert.ok(slabs.slice(4, 6).every(slab => /\[0:39:2779\]\[0:39:2779\]$/.test(slab)), "coarse locate is strided");
  assert.ok(slabs.slice(6).every(slab => /\[386:1:696\]\[1233:1:1665\]$/.test(slab)), "all fine arrays share one airport window");
  const frame = h.tables.seoulGoci2Frames[0];
  assert.equal(h.tables.seoulGoci2Frames.length, 1);
  assert.deepEqual([frame.status, frame.slot, frame.nominalTimeUtc, frame.obsTimeUtc],
    ["ok", "S007", Date.parse("2026-10-30T02:15:30Z"), Date.parse("2026-10-30T02:27:48Z")]);
  assert.equal(frame.sourceKey, "GOCI-II/2026/10/30/L1B_COMP/GK2_GC2_L1B_20261030_021530/GK2_GOCI2_L1B_20261030_021530_LA_S007.nc");
  assert.equal(frame.sourceSize, 432845988);
  assert.equal(frame.sourceObjects.length, 11);
  assert.ok(frame.sourceObjects.every(source => /^[a-f0-9]{64}$/.test(source.sha256) && source.bytes > 0));
  assert.ok(frame.sourceObjects.filter(source => source.constraint).reduce((sum, source) => sum + source.bytes, 0) < 3_000_000, "≈ 2.7 MB per hourly image");
  const upload = h.uploads.get(frame.storageId);
  assert.equal(upload.contentType, MIME);
  assert.equal(h.status().lastSlot, "S007");
  assert.equal(h.calls.scheduled.at(-1).name, "seoulGoci2:deleteUploadIfUnreferenced");
  const view = await h.call("getLatest");
  assert.equal(view.frames.length, 1);
  assert.equal(view.frames[0].geometry.width, 512);
});

test("regression: far-away slots listed before S007 are skipped instead of failing the directory", async () => {
  // Live NOSC on 2026-10-31: S000 (≈24–31° N, 136–144° E) is probed first.
  const h = createBackendHarness(), server = createFixtureServer({ slots: ["S000", "S005", "S006", "S007"] });
  const { result } = await collect(h, server);
  assert.equal(result.status, "idle");
  assert.equal(h.tables.seoulGoci2Frames[0].slot, "S007");
  assert.equal(h.status().lastSlot, "S007");
  assert.equal(server.requests.filter(request => request.kind === "dds").length, 4);
  assert.equal(server.requests.filter(request => request.kind === "das").length, 1, "metadata is read for the chosen slot only");
});

test("when no published slot holds the airport view, the recorded failure names each skipped slot", async () => {
  const h = createBackendHarness(), server = createFixtureServer({ slots: ["S000", "S005", "S006"] });
  const { result } = await collect(h, server);
  assert.equal(result.status, "error");
  assert.match(h.status().sourceFailures[0].error, /No published GOCI-II slot .*S000: .*; S005: .*; S006: RKSI is outside this slot/);
  assert.equal(server.requests.filter(request => request.kind === "das").length, 0);
  assert.equal(h.tables.seoulGoci2Frames.length, 0);
});

test("a remembered slot skips the search; a young directory without it waits without probing", async () => {
  const h = createBackendHarness();
  await h.db.insert("seoulGoci2CollectorStatus", { stationIcao: "RKSI", status: "idle", updatedAt: NOW - 3_600_000, lastSlot: "S007" });
  const server = createFixtureServer();
  await collect(h, server);
  assert.equal(server.requests.length, 12);
  assert.ok(server.requests.every(request => !request.href.includes("_S006")));
  const waiting = createBackendHarness();
  waiting.setNow(Date.parse("2026-10-30T02:40:00Z"));
  await waiting.db.insert("seoulGoci2CollectorStatus", { stationIcao: "RKSI", status: "idle", updatedAt: NOW - 3_600_000, lastSlot: "S007" });
  const partial = createFixtureServer({ slots: ["S000", "S001"] });
  const { result } = await collect(waiting, partial);
  assert.equal(result.status, "waiting");
  assert.deepEqual(partial.requests.map(request => request.kind), ["dayCatalog", "dayCatalog", "directoryCatalog"]);
  assert.equal(waiting.tables.seoulGoci2Frames.length, 0);
});

test("revocation during a download cancels it before any image is stored", async () => {
  const h = createBackendHarness();
  const server = createFixtureServer({ override: ({ kind, href }) => kind === "dods" && href.includes("L_TOA_555")
    ? { onRead: () => { h.env[FLAG] = "false"; process.env[FLAG] = "false"; } } : null });
  const { result } = await collect(h, server);
  assert.deepEqual(result, { status: "approval_required" });
  assert.equal(server.requests.at(-1).cancelled, true);
  assert.ok(server.requests.some(request => request.href.includes("L_TOA_660")), "660 nm is fetched before 555 nm");
  assert.ok(!server.requests.some(request => request.href.includes("L_TOA_443")), "no request after revocation");
  assert.equal(h.tables.seoulGoci2Frames.length, 0);
  assert.equal([...h.uploads.values()].length, 0);
});

test("provider errors, oversized or altered responses become recorded failures without images", async () => {
  const cases = {
    http503: ({ kind, href }) => kind === "dods" && href.includes("L_TOA_443") ? { status: 503 } : null,
    redirectBody: ({ kind }) => kind === "das" ? { body: Buffer.from("<html>Login</html>") } : null,
    oversized: ({ kind }) => kind === "dds" ? { headers: { "content-length": String(65 * 1024) } } : null,
    lengthChanged: ({ kind, response }) => kind === "dods" ? { headers: { "content-length": String(response.body.length + 1) } } : null,
    gzip: ({ kind }) => kind === "das" ? { headers: { "content-encoding": "gzip" } } : null,
    truncated: ({ kind, href, response }) => kind === "dods" && href.includes("L_TOA_660") ? { body: response.body.subarray(0, -8) } : null,
  };
  for (const [name, override] of Object.entries(cases)) {
    const h = createBackendHarness(), server = createFixtureServer({ override });
    const { result } = await collect(h, server);
    assert.equal(result.status, "error", name);
    assert.equal(h.tables.seoulGoci2Frames.length, 0, name);
    assert.equal(h.uploads.size, 0, name);
    assert.equal(h.status().sourceFailures.length, 1, name);
    assert.equal(h.status().sourceFailures[0].sourceKey, "GOCI-II/2026/10/30/L1B_COMP/GK2_GC2_L1B_20261030_021530", name);
  }
});

test("metadata that contradicts the slot is recorded once and backs off instead of re-downloading", async () => {
  const h = createBackendHarness(), server = createFixtureServer({ das: fixtureDas({ units: "mW cm-2 um-1 sr-1" }) });
  await collect(h, server);
  assert.match(h.status().sourceFailures[0].error, /units/);
  const before = server.requests.length;
  h.setNow(NOW + 5 * 60_000);
  await collect(h, server);
  assert.deepEqual(server.requests.slice(before).map(request => request.kind), ["dayCatalog", "dayCatalog"], "only discovery while backing off");
});

test("a deterministic render rejection is stored as an honest unavailable record, not retried", async () => {
  const h = createBackendHarness();
  const server = createFixtureServer({ fill: (row, column, band) => band === 660 && row < 541 });
  await collect(h, server);
  const frame = h.tables.seoulGoci2Frames[0];
  assert.equal(frame.status, "unavailable");
  assert.equal(frame.storageId, undefined);
  assert.match(frame.reason, /10 percent/);
  assert.equal(h.uploads.size, 0);
  assert.equal((await h.call("getLatest")).status, "unavailable");
  h.setNow(NOW + 3 * 60_000);
  assert.equal((await h.call("requestRefresh")).status, "waiting_for_next_observation");
});

test("the stored synthetic image decodes as 512 × 512 RGB, north-up with the airport at its center", async () => {
  const h = createBackendHarness(), { events } = await collect(h, createFixtureServer());
  const stored = events.find(event => event.type === "store");
  assert.equal(stored.contentType, MIME);
  const image = PNG.sync.read(Buffer.from(await stored.blob.arrayBuffer()));
  assert.deepEqual([image.width, image.height], [512, 512]);
  const at = (x, y) => [...image.data.subarray(4 * (y * 512 + x), 4 * (y * 512 + x) + 3)];
  assert.ok(at(256, 256).every(value => value < 60), "RKSI sits on the synthetic dark sea");
  assert.ok(at(256, 154).every(value => value > 200), "the synthetic cloud is 20 km north, above center");
  assert.equal(h.tables.seoulGoci2Frames[0].imageSha256.length, 64);
});

test("the worker has exactly one network call site and it is behind the approval and ownership check", async () => {
  const source = await readFile(new URL("../convex/seoulGoci2Node.js", import.meta.url), "utf8");
  assert.equal(source.match(/\bfetch\(/g).length, 1);
  const body = source.slice(source.indexOf("async function boundedFetch"), source.indexOf("const response = await fetch("));
  assert.match(body, /classifyGoci2Url\(href\)/);
  assert.match(body, /await assertWorker\(ctx, runId, workerToken\);/);
  assert.match(source, /function approved\(\) \{ return process\.env\.KHOA_GOCI2_ACCESS_APPROVED === "true"; \}/);
});
