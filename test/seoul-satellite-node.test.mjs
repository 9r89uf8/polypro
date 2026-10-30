import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../convex/seoulSatelliteNode.js", import.meta.url), "utf8");
const construct = new Function("internalActionGeneric", "v", "createHash", "internal", "decodeHimawariImage", "process", "Date", "fetch", "setTimeout", "clearTimeout", "Buffer", "Blob",
  source.replace(/import[\s\S]*?from\s+"[^"]+";\s*/g, "").replace(/export const /g, "const ")
  + "\nreturn {collectFrames,parseListing,parseListedCandidate,hourlyPrefixes};");
const NOW = Date.parse("2026-10-30T01:20:00Z"), MINUTE = 60_000, ORIGIN = "https://noaa-himawari9.s3.amazonaws.com";
const VERSION = "rksi-himawari-image-v2";
function pngBytes() {
  const bytes = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12, "ascii"); bytes.writeUInt32BE(256, 16); bytes.writeUInt32BE(256, 20);
  Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).copy(bytes, 33);
  return bytes;
}
function object(time = NOW - 10 * MINUTE, channel = "infrared") {
  const base = Math.floor(time / 600_000) * 600_000, iso = new Date(base).toISOString();
  const date = iso.slice(0, 10).replaceAll("-", ""), hm = iso.slice(11, 16).replace(":", "");
  const jp = String(1 + (time - base) / 150_000).padStart(2, "0");
  const key = `AHI-L1b-Japan/${iso.slice(0, 10).replaceAll("-", "/")}/${hm}/HS_H09_${date}_${hm}_${channel === "visible" ? "B03" : "B13"}_JP${jp}_${channel === "visible" ? "R05" : "R20"}_S0101.DAT.bz2`;
  return { key, channel, nominalTimeUtc: time, sourceLastModifiedAt: time + 6 * MINUTE,
    sourceSize: 100, bytes: Buffer.alloc(100, 3) };
}
const xml = (entries, truncated = "false") => `<ListBucketResult><IsTruncated>${truncated}</IsTruncated>${entries.map(row => `<Contents><Key>${row.key}</Key><LastModified>${new Date(row.sourceLastModifiedAt).toISOString()}</LastModified><Size>${row.sourceSize}</Size></Contents>`).join("")}</ListBucketResult>`;

function harness({ flag = "true", objects = [object()], onRead, responseOverrides, decode, busy = false,
  checkWorker = () => true, onStore, pending } = {}) {
  const env = { NOAA_HIMAWARI_IMAGES_ENABLED: flag };
  let clock = NOW, nextUpload = 0;
  const calls = { fetch: [], decoded: [], stored: [], saved: [], failures: [], cleanup: [], scheduled: [], queries: [], mutations: [], cancelled: [], finish: [] };
  function response(bytes, label, headers = {}) {
    const override = responseOverrides?.(label, headers) ?? {};
    const values = { "content-length": String(bytes.length), ...headers, ...override.headers };
    return { ok: true, status: 200, ...override,
      headers: { get(name) { return values[name.toLowerCase()] ?? null; } },
      body: { getReader() { let sent = false;
        return { async read() { onRead?.({ label, env, advance(ms) { clock += ms; }, calls });
          if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; },
        async cancel() { calls.cancelled.push(label); } };
      } } };
  }
  const fetch = async (input, options) => {
    const url = new URL(input); calls.fetch.push({ url: url.href, options });
    assert.equal(url.origin, ORIGIN); assert.equal(options.redirect, "error");
    if (url.search) {
      assert.equal(url.searchParams.get("max-keys"), "1000");
      const contents = objects.filter(row => row.key.startsWith(url.searchParams.get("prefix")));
      const override = responseOverrides?.("listingXml", {})?.xml;
      return response(Buffer.from(override ?? xml(contents)), "listing");
    }
    const row = objects.find(entry => `/${entry.key}` === url.pathname);
    assert.ok(row, `Unexpected source object ${url.href}`);
    return response(row.bytes, row.key, { "last-modified": new Date(row.sourceLastModifiedAt).toUTCString() });
  };
  const backendNames = ["claimWorker", "checkWorker", "savePlan", "saveFrame", "recordSourceFailure", "finishWorker", "deleteUploadIfUnreferenced"];
  const internal = { seoulSatellite: Object.fromEntries(backendNames.map(name => [name, name])) };
  const ctx = {
    async runQuery(name, args) { calls.queries.push({ name, args }); return env.NOAA_HIMAWARI_IMAGES_ENABLED === "true" && checkWorker(calls); },
    async runMutation(name, args) {
      calls.mutations.push({ name, args });
      if (name === "claimWorker") return busy ? null : { workerToken: "run:1", rendererVersion: VERSION, planReady: Boolean(pending), pendingCandidates: pending ?? [] };
      if (name === "savePlan") { calls.plan = args.candidates; return args.candidates.slice(0, 4); }
      if (name === "saveFrame") { calls.saved.push(args.frame); return { stored: true, status: args.frame.status }; }
      if (name === "recordSourceFailure") { calls.failures.push(args); return env.NOAA_HIMAWARI_IMAGES_ENABLED === "true"
        ? { recorded: true, status: "source_failed" } : { recorded: false, status: "disabled" }; }
      if (name === "finishWorker") { calls.finish.push(args); return { status: args.error ? "error" : "idle", continued: false }; }
      if (name === "deleteUploadIfUnreferenced") { calls.cleanup.push(args.storageId); return null; }
      throw new Error(`Unexpected mutation ${name}`);
    },
    storage: { async store(blob) { assert.equal(blob.type, "image/png; profile=rksi-himawari-loop-v2"); calls.stored.push(blob.size); onStore?.({ env, calls }); return `upload${++nextUpload}`; } },
    scheduler: { async runAfter(delay, name, args) { calls.scheduled.push({ delay, name, args }); } },
  };
  const decoder = (bytes, opts) => {
    calls.decoded.push({ size: bytes.length, ...opts });
    return decode ? decode(bytes, opts) : { status: "ok", version: VERSION, pngBytes: pngBytes(),
      observedAt: opts.nominalTimeUtc + 54_000, solarElevationDeg: 30, validFraction: .95,
      geometry: { spanKm: 100, centerLatitude: 37.4602, centerLongitude: 126.4407 }, display: { kind: "fixture" } };
  };
  class FakeDate extends Date { static now() { return clock; } }
  const v = new Proxy({}, { get: () => () => ({}) });
  const module = construct(value => value, v, createHash, internal, decoder, { env }, FakeDate, fetch,
    () => 1, () => {}, Buffer, Blob);
  return { calls, env, module, ctx, run: () => module.collectFrames.handler(ctx, { runId: "run" }) };
}

test("worker is disabled by every value except exact true and respects ownership", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    const h = harness({ flag }); h.env.NOAA_HIMAWARI_IMAGES_ENABLED = flag;
    assert.equal((await h.run()).status, "disabled"); assert.equal(h.calls.fetch.length, 0); assert.equal(h.calls.mutations.length, 0);
  }
  const busy = harness({ busy: true }); assert.equal((await busy.run()).status, "superseded_or_busy"); assert.equal(busy.calls.fetch.length, 0);
  const lost = harness({ checkWorker: () => false }); assert.equal((await lost.run()).status, "error"); assert.equal(lost.calls.fetch.length, 0);
});

test("two hourly lists discover newest available keys, at most four objects are captured", async () => {
  const objects = Array.from({ length: 8 }, (_, n) => object(NOW - (n + 3) * 150_000, n % 2 ? "visible" : "infrared"));
  const h = harness({ objects }); assert.equal((await h.run()).status, "idle");
  assert.equal(h.calls.fetch.filter(row => new URL(row.url).search).length, 2);
  assert.equal(h.calls.decoded.length, 4); assert.equal(h.calls.saved.length, 4); assert.equal(h.calls.stored.length, 4);
  assert.deepEqual(h.calls.plan.map(row => row.nominalTimeUtc), objects.map(row => row.nominalTimeUtc));
  assert.equal(h.calls.finish[0].attemptedKeys.length, 4);
  assert.ok(h.calls.saved.every(frame => /^[a-f0-9]{64}$/.test(frame.sourceSha256) && /^[a-f0-9]{64}$/.test(frame.imageSha256)));
  assert.ok(h.calls.scheduled.every(row => row.delay === 300_000 && row.name === "deleteUploadIfUnreferenced"));
});

test("strict listings reject truncation and malformed XML without downloading images", async () => {
  for (const malformed of [xml([object()], "true"), "<ListBucketResult><IsTruncated>false</IsTruncated>",
    "<!DOCTYPE x><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"]) {
    const h = harness({ responseOverrides: label => label === "listingXml" ? { xml: malformed } : {} });
    assert.equal((await h.run()).status, "error"); assert.equal(h.calls.decoded.length, 0);
  }
});

test("candidate parser rejects mismatched paths/channels/future or oversized files", () => {
  const h = harness(), row = object(), iso = new Date(row.sourceLastModifiedAt).toISOString();
  assert.equal(h.module.parseListedCandidate(row.key.replace("_R20_", "_R05_"), "100", iso), null);
  assert.equal(h.module.parseListedCandidate(row.key.replace("HS_H09_20261030", "HS_H09_20261029"), "100", iso), null);
  assert.equal(h.module.parseListedCandidate(row.key, String(25 * 1024 * 1024), iso), null);
  const future = object(NOW + 150_000);
  assert.deepEqual(h.module.parseListing(xml([future]), "AHI-L1b-Japan/2026/10/30/01", NOW), []);
  assert.equal(h.module.hourlyPrefixes(Date.parse("2026-10-30T00:01:00Z")).length, 2);
});

test("headers must match discovery and reject unexpected encodings or response sizes", async () => {
  for (const changed of [{ "last-modified": new Date(NOW).toUTCString() }, { "content-length": String(25 * 1024 * 1024) },
    { "content-length": null }, { "content-encoding": "gzip" }]) {
    const h = harness({ responseOverrides: label => label.endsWith("bz2") ? { headers: changed } : {} });
    assert.equal((await h.run()).status, "error"); assert.equal(h.calls.decoded.length, 0); assert.equal(h.calls.stored.length, 0);
  }
});

test("streaming timeout and revocation cancel reading without uploads", async () => {
  const timeout = harness({ onRead({ label, advance }) { if (label !== "listing") advance(26_000); } });
  assert.equal((await timeout.run()).status, "error"); assert.equal(timeout.calls.stored.length, 0); assert.equal(timeout.calls.cancelled.length, 1);
  const revoked = harness({ onRead({ label, env }) { if (label !== "listing") env.NOAA_HIMAWARI_IMAGES_ENABLED = "false"; } });
  assert.equal((await revoked.run()).status, "disabled"); assert.equal(revoked.calls.stored.length, 0); assert.equal(revoked.calls.cancelled.length, 1);
});

test("quality unavailability and structural rejections persist without fabricated images", async () => {
  for (const decode of [(_bytes, opts) => ({ status: "unavailable", version: VERSION, reason: "Low solar elevation", observedAt: opts.nominalTimeUtc + 54_000 }),
    () => { throw new Error("Corrupt data block"); }]) {
    const h = harness({ objects: [object(NOW - 10 * MINUTE, "visible")], decode });
    await h.run(); assert.equal(h.calls.saved.length, 1); assert.equal(h.calls.saved[0].status, "unavailable");
    assert.equal(h.calls.stored.length, 0); assert.equal(h.calls.saved[0].storageId, undefined);
  }
});

test("continuation avoids listing again and rejects oversized PNGs before storage", async () => {
  const item = object(); const { bytes, ...pending } = item;
  const h = harness({ objects: [item], pending: [pending], decode: (_bytes, opts) => ({ status: "ok", version: VERSION, observedAt: opts.nominalTimeUtc,
    pngBytes: Buffer.alloc(2 * 1024 * 1024 + 1) }) });
  assert.equal((await h.run()).status, "error"); assert.equal(h.calls.fetch.length, 1); assert.equal(h.calls.stored.length, 0);
});

test("a persistent newest-object failure cannot starve older available frames", async () => {
  const objects = Array.from({ length: 6 }, (_, n) => object(NOW - (n + 3) * 150_000));
  const h = harness({ objects, responseOverrides: label => label === objects[0].key ? { ok: false, status: 503 } : {} });
  await h.run();
  assert.equal(h.calls.failures.length, 1);
  assert.equal(h.calls.failures[0].key, objects[0].key);
  assert.equal(h.calls.saved.length, 3);
  assert.deepEqual(h.calls.saved.map(frame => frame.sourceKey), objects.slice(1, 4).map(row => row.key));
  assert.equal(h.calls.finish[0].attemptedKeys.length, 4);
  assert.equal(h.calls.finish[0].continueAfterErrors, true);
});

test("only exact-version, correctly framed 256-square PNG output reaches storage", async () => {
  for (const kind of ["legacy_version", "jpeg", "signature", "iend", "dimensions"]) {
    const h = harness({ decode: (_bytes, opts) => {
      const result = { status: "ok", version: VERSION, observedAt: opts.nominalTimeUtc + 54_000, pngBytes: pngBytes() };
      if (kind === "legacy_version") result.version = "rksi-himawari-image-v1";
      if (kind === "jpeg") result.pngBytes = Buffer.from([255, 216, 255, 217]);
      if (kind === "signature") result.pngBytes[0] = 0;
      if (kind === "iend") result.pngBytes[result.pngBytes.length - 1] = 0;
      if (kind === "dimensions") result.pngBytes.writeUInt32BE(512, 16);
      return result;
    } });
    await h.run(); assert.equal(h.calls.stored.length, 0, kind); assert.equal(h.calls.failures.length, 1, kind);
  }
});
