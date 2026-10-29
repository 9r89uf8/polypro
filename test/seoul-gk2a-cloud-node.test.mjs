import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import test from "node:test";

const source = await readFile(new URL("../convex/seoulGk2aCloudsNode.js", import.meta.url), "utf8");
const createModule = new Function(
  "internalActionGeneric", "v", "mkdtemp", "rm", "writeFile", "tmpdir", "join",
  "decodeCloudFrame", "parseGk2aTime", "cloudCollectionWindowOpen", "process", "Date",
  "fetch", "loadH5", "setTimeout", "clearTimeout",
  source.replace(/import[\s\S]*?from\s+"[^"]+";\s*/g, "")
    .replace('import("h5wasm/node")', "loadH5()")
    .replace(/export const /g, "const ") + "\nreturn fetchLatestCloudSample;",
);
const MINUTE = 60_000;
const NOW = Date.parse("2026-10-29T01:50:00Z");
const ORIGIN = "https://noaa-gk2a-pds.s3.amazonaws.com";
const SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const validBytes = () => Buffer.from([...SIGNATURE, 1, 2, 3, 4, 5, 6, 7, 8]);
const timeAt = (minute) => Date.parse(`2026-10-29T01:${String(minute).padStart(2, "0")}:00Z`);
function compact(time) { return new Date(time).toISOString().replace(/[-:T]/g, "").slice(0, 12); }
function object(time, channel, changes = {}) {
  const stamp = compact(time);
  return {
    key: `AMI/L1B/LA/${stamp.slice(0, 6)}/${stamp.slice(6, 8)}/${stamp.slice(8, 10)}/gk2a_ami_le1b_${channel}_la${channel === "vi006" ? "005" : "020"}ge_${stamp}.nc`,
    time, channel, modified: time + 6 * MINUTE, bytes: validBytes(), ...changes,
  };
}
function pair(time) { return [object(time, "vi006"), object(time, "ir105")]; }

function harness({ objects = pair(timeAt(44)), flag = "true", daylight = true,
  reject = new Set(), failFetch, onRead } = {}) {
  const env = { NOAA_GK2A_CLOUD_ENABLED: flag };
  const calls = { fetch: [], reads: [], cancelled: [], directories: [], writes: [], removes: [],
    h5Loads: 0, opened: [], closed: [], decoded: [], timers: [], cleared: [] };
  const context = { env, calls };
  const response = (bytes, name, overrides = {}) => ({
    ok: true, status: 200,
    headers: { get: (key) => key === "content-length" ? String(bytes.length) : null },
    body: { getReader() {
      let offset = 0;
      return {
        async read() {
          calls.reads.push(name);
          onRead?.(name, offset, context);
          if (offset++) return { done: true };
          return { done: false, value: new Uint8Array(bytes) };
        },
        async cancel() { calls.cancelled.push(name); },
      };
    } },
    ...overrides,
  });
  const fetch = async (input, options) => {
    const url = new URL(input);
    calls.fetch.push({ url: url.href, options });
    const failure = failFetch?.(url, context);
    if (failure) throw failure;
    if (url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix");
      const listed = objects.filter((entry) => entry.key.startsWith(prefix));
      const xml = `<ListBucketResult><IsTruncated>false</IsTruncated>${listed.map((entry) =>
        `<Contents><Key>${entry.key}</Key><LastModified>${new Date(entry.modified).toISOString()}</LastModified><Size>${entry.bytes.length}</Size></Contents>`,
      ).join("")}</ListBucketResult>`;
      return response(Buffer.from(xml), "listing");
    }
    const entry = objects.find((candidate) => `/${candidate.key}` === url.pathname);
    assert.ok(entry, `Unexpected download: ${url.href}`);
    return response(entry.bytes, entry.key);
  };
  class FakeDate extends Date { static now() { return NOW; } }
  const v = new Proxy({}, { get: () => () => ({}) });
  const module = createModule(
    (config) => config, v,
    async (prefix) => { calls.directories.push(prefix); return `${prefix}test`; },
    async (path, options) => { calls.removes.push({ path, options }); },
    async (path, bytes) => { calls.writes.push({ path, length: bytes.length }); },
    () => "/tmp", posix.join,
    (_visible, _infrared, frame) => {
      calls.decoded.push(frame.obsTimeUtc);
      if (reject.has(frame.obsTimeUtc)) throw new Error("Fixture quality rejection.");
      return { obsTimeUtc: frame.obsTimeUtc, source: "noaa_gk2a_l1b" };
    },
    (stamp) => /^\d{12}$/.test(stamp) ? Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)), Number(stamp.slice(8, 10)), Number(stamp.slice(10, 12))) : NaN,
    () => daylight, { env }, FakeDate, fetch,
    async () => {
      calls.h5Loads += 1;
      return { ready: Promise.resolve(), File: class {
        constructor(path, mode) { calls.opened.push({ path, mode }); }
        close() { calls.closed.push(true); }
      } };
    },
    (_fn, delay) => { calls.timers.push(delay); return calls.timers.length; },
    (id) => { calls.cleared.push(id); },
  );
  return { ...context, run: (args = {}) => module.handler({}, { requestedAt: NOW, ...args }) };
}

function binaryCalls(h) { return h.calls.fetch.filter((call) => new URL(call.url).pathname.endsWith(".nc")); }
function assertCleanup(h) {
  assert.equal(h.calls.directories.length, 1);
  assert.deepEqual(h.calls.removes, [{
    path: "/tmp/polypro-noaa-cloud-test", options: { recursive: true, force: true },
  }]);
  assert.equal(h.calls.closed.length, h.calls.opened.length);
  assert.equal(h.calls.cleared.length, h.calls.timers.length);
}

test("disabled and low-sun collectors perform no fetch, filesystem access or HDF5 load", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1"]) {
    const h = harness({ flag });
    h.env.NOAA_GK2A_CLOUD_ENABLED = flag;
    assert.equal((await h.run()).status, "disabled");
    assert.equal(h.calls.fetch.length, 0);
    assert.equal(h.calls.directories.length, 0);
    assert.equal(h.calls.writes.length, 0);
    assert.equal(h.calls.removes.length, 0);
    assert.equal(h.calls.h5Loads, 0);
  }
  const h = harness({ daylight: false });
  assert.equal((await h.run()).status, "unavailable");
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.directories.length, 0);
});

test("requests stay on fixed NOAA HTTPS URLs, forbid redirects, and clean up successful extraction", async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.status, "ok");
  assert.equal(result.observations.length, 1);
  assert.equal(result.lastProcessedTimeUtc, timeAt(44));
  assert.equal(binaryCalls(h).length, 2);
  for (const { url, options } of h.calls.fetch) {
    assert.equal(new URL(url).origin, ORIGIN);
    assert.equal(new URL(url).username, "");
    assert.equal(new URL(url).password, "");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, undefined);
  }
  assert.ok(h.calls.timers.includes(15_000));
  assert.ok(h.calls.timers.includes(25_000));
  assertCleanup(h);
});

test("only correctly paired channels newer than the checkpoint are downloaded", async () => {
  const malformed = object(timeAt(43), "vi006");
  malformed.key = malformed.key.replace("vi006_la005", "vi006_la020");
  const h = harness({ objects: [
    ...pair(timeAt(38)), ...pair(timeAt(40)), ...pair(timeAt(42)),
    object(timeAt(43), "vi006"), object(timeAt(41), "ir105"), malformed,
  ] });
  const result = await h.run({ latestProcessedTime: timeAt(40) });
  assert.deepEqual(result.observations.map((row) => row.obsTimeUtc), [timeAt(42)]);
  assert.equal(binaryCalls(h).length, 2);
  assert.ok(binaryCalls(h).every((call) => call.url.includes("202610290142")));
  assertCleanup(h);
  const unchanged = harness({ objects: pair(timeAt(40)) });
  assert.equal((await unchanged.run({ latestProcessedTime: timeAt(40) })).status, "not_modified");
  assert.equal(binaryCalls(unchanged).length, 0);
  assert.equal(unchanged.calls.directories.length, 0);
});

test("startup downloads at most the four newest paired frames in chronological order", async () => {
  const h = harness({ objects: [18, 30, 32, 34, 36, 38, 40, 42, 44].flatMap((minute) => pair(timeAt(minute))) });
  const result = await h.run();
  assert.deepEqual(h.calls.decoded, [38, 40, 42, 44].map(timeAt));
  assert.deepEqual(result.observations.map((row) => row.obsTimeUtc), [38, 40, 42, 44].map(timeAt));
  assert.equal(binaryCalls(h).length, 8);
  assertCleanup(h);
});

test("invalid NetCDF signature advances the quality-rejection checkpoint without decoding", async () => {
  const objects = pair(timeAt(44));
  objects[0].bytes = Buffer.alloc(16, 0x20);
  const h = harness({ objects });
  const result = await h.run();
  assert.equal(result.status, "unavailable");
  assert.equal(result.lastProcessedTimeUtc, timeAt(44));
  assert.equal(result.latestRejectedTimeUtc, timeAt(44));
  assert.equal(result.observations.length, 0);
  assert.equal(h.calls.decoded.length, 0);
  assert.match(result.message, /signature/);
  assertCleanup(h);
});

test("network failure throws without a processed checkpoint and remains retryable", async () => {
  let failOnce = true;
  const h = harness({ failFetch: (url) => {
    if (failOnce && url.pathname.includes("vi006")) {
      failOnce = false;
      return new Error("Fixture network interruption.");
    }
  } });
  await assert.rejects(h.run({ latestProcessedTime: timeAt(42) }), /network interruption/);
  assert.equal(h.calls.decoded.length, 0);
  assertCleanup(h);
  const result = await h.run({ latestProcessedTime: timeAt(42) });
  assert.equal(result.status, "ok");
  assert.equal(result.lastProcessedTimeUtc, timeAt(44));
  assert.equal(result.latestRejectedTimeUtc, undefined);
  assert.equal(binaryCalls(h).filter((call) => call.url.includes("vi006")).length, 2);
  assert.equal(h.calls.removes.length, 2);
});

test("later network failure preserves completed samples and QA rejection while leaving its frame retryable", async () => {
  let failOnce = true;
  const h = harness({
    objects: [40, 42, 44].flatMap((minute) => pair(timeAt(minute))),
    reject: new Set([timeAt(42)]),
    failFetch: (url) => {
      if (failOnce && url.pathname.includes("vi006") && url.pathname.includes("202610290144")) {
        failOnce = false;
        return new Error("Fixture later download interruption.");
      }
    },
  });
  const partial = await h.run();
  assert.equal(partial.status, "unavailable");
  assert.deepEqual(partial.observations.map((row) => row.obsTimeUtc), [timeAt(40)]);
  assert.equal(partial.lastProcessedTimeUtc, timeAt(42));
  assert.equal(partial.latestRejectedTimeUtc, timeAt(42));
  assert.match(partial.message, /later download interruption/);
  assert.deepEqual(h.calls.decoded, [timeAt(40), timeAt(42)]);
  assertCleanup(h);

  const retry = await h.run({ latestProcessedTime: partial.lastProcessedTimeUtc });
  assert.equal(retry.status, "ok");
  assert.deepEqual(retry.observations.map((row) => row.obsTimeUtc), [timeAt(44)]);
  assert.equal(retry.lastProcessedTimeUtc, timeAt(44));
  assert.equal(retry.latestRejectedTimeUtc, undefined);
  assert.deepEqual(h.calls.decoded, [timeAt(40), timeAt(42), timeAt(44)]);
  for (const minute of [40, 42]) {
    assert.equal(binaryCalls(h).filter((call) => call.url.includes(compact(timeAt(minute)))).length, 2);
  }
  assert.equal(binaryCalls(h).filter((call) => call.url.includes(compact(timeAt(44)))).length, 4);
  assert.equal(h.calls.removes.length, 2);
});

test("a failed earlier frame and good newest frame return the rejection barrier together", async () => {
  const h = harness({ objects: [...pair(timeAt(42)), ...pair(timeAt(44))], reject: new Set([timeAt(42)]) });
  const result = await h.run();
  assert.equal(result.status, "ok");
  assert.equal(result.latestRejectedTimeUtc, timeAt(42));
  assert.equal(result.lastProcessedTimeUtc, timeAt(44));
  assert.deepEqual(result.observations.map((row) => row.obsTimeUtc), [timeAt(44)]);
  assertCleanup(h);
});

test("a rejected newest frame does not turn successful warmup rows into a current result", async () => {
  const h = harness({ objects: [...pair(timeAt(42)), ...pair(timeAt(44))], reject: new Set([timeAt(44)]) });
  const result = await h.run();
  assert.equal(result.status, "unavailable");
  assert.equal(result.latestRejectedTimeUtc, timeAt(44));
  assert.equal(result.lastProcessedTimeUtc, timeAt(44));
  assert.deepEqual(result.observations.map((row) => row.obsTimeUtc), [timeAt(42)]);
  assertCleanup(h);
});

test("revocation during streaming cancels and discards bytes before extraction", async () => {
  const h = harness({ onRead: (name, offset, context) => {
    if (name.endsWith(".nc") && offset === 0) context.env.NOAA_GK2A_CLOUD_ENABLED = "false";
  } });
  const result = await h.run();
  assert.equal(result.status, "disabled");
  assert.equal(result.observations, undefined);
  assert.equal(result.lastProcessedTimeUtc, undefined);
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.decoded.length, 0);
  assert.ok(h.calls.cancelled.length >= 1);
  assertCleanup(h);
});

test("old request clocks fail before touching NOAA or the filesystem", async () => {
  const h = harness();
  await assert.rejects(h.run({ requestedAt: NOW - 6 * MINUTE }), /Invalid GK2A cloud request time/);
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.directories.length, 0);
});
