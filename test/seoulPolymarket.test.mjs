import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as helpers from "../convex/lib/seoulPolymarket.js";

const DATE = "2026-10-29";
const NOW = Date.parse("2026-10-29T02:40:00Z");
const MINUTE = 60_000;
const condition = (id) => `0x${String(id).padStart(64, "0")}`;
const approvedEnv = () => Object.fromEntries(Object.values(helpers.SEOUL_MARKET_FLAGS).map((name) => [name, "true"]));
function rawEvent() {
  const description = "Synthetic test rules on 29 Oct '26. RKSI routine reports; this is deliberately not the reviewed live template.";
  const resolutionSource = `https://aviationweather.gov/api/data/metar?ids=RKSI&format=raw&date=${DATE}T18:00:00Z&hours=30`;
  return {
    id: "123", slug: helpers.seoulMarketSlug(DATE), title: "Seoul (Incheon) temperature test",
    eventDate: DATE, series: [{ id: "10742", slug: "seoul-daily-weather" }],
    active: true, closed: false, description, resolutionSource,
    markets: ["12°C or below", "13°C", "14°C or higher"].map((label, index) => ({
      id: String(index + 1), conditionId: condition(index + 1), groupItemTitle: label,
      outcomes: '["Yes","No"]', clobTokenIds: JSON.stringify([String(100 + index * 2), String(101 + index * 2)]),
      outcomePrices: '["0.5","0.5"]', enableOrderBook: true, closed: false, version: "v1",
      description, resolutionSource,
    })),
  };
}
async function normalizedEvent({ verified = true } = {}) {
  const result = await helpers.normalizeSeoulMarketEvent(rawEvent(), DATE);
  // Collector harness isolates transport/authorization from the cryptographic
  // template review. Pure-helper tests below verify synthetic rules fail closed.
  result.event.rulesVerified = verified;
  return result;
}
function book(id = 1, overrides = {}) {
  return { market: condition(id), asset_id: String(100 + (id - 1) * 2), timestamp: String(NOW - 10_000),
    bids: [{ price: "0.3", size: "10" }], asks: [{ price: "0.4", size: "20" }],
    min_order_size: "5", tick_size: "0.001", neg_risk: true, ...overrides };
}
const clocks = { bookReceivedAt: NOW, lastTradeReceivedAt: NOW };

test("Seoul date/slug uses KST and rejects impossible calendar dates", () => {
  assert.equal(helpers.seoulMarketDate(Date.parse("2026-10-28T15:00:00Z")), DATE);
  assert.equal(helpers.seoulMarketDate(Date.parse("2026-10-28T14:59:59Z")), "2026-10-28");
  assert.equal(helpers.seoulMarketSlug(DATE), "highest-temperature-in-seoul-on-october-29-2026");
  for (const date of ["2026-02-30", "2026-13-01", "2026-1-1", "not-a-date"]) {
    assert.throws(() => helpers.seoulMarketSlug(date), /calendar date/);
  }
});

test("all approval flags require exact true and public permission is separate", () => {
  for (const flag of Object.values(helpers.SEOUL_MARKET_FLAGS)) {
    for (const value of [undefined, "false", "TRUE", "1", ""]) {
      const env = { ...approvedEnv(), [flag]: value };
      assert.equal(helpers.seoulMarketGate(env, { publicRead: true }).allowed, false);
    }
  }
  const env = approvedEnv();
  delete env[helpers.SEOUL_MARKET_FLAGS.publicDisplay];
  assert.equal(helpers.seoulMarketGate(env).allowed, true);
  assert.equal(helpers.seoulMarketGate(env, { publicRead: true }).status, "public_approval_required");
});

test("rule normalization changes dates only; unknown wording never becomes verified", async () => {
  const one = "on 29 Oct '26. date=2026-10-29T18:00:00Z\nRoutine.";
  const next = "on 30 Oct '26. date=2026-10-30T18:00:00Z Routine.";
  assert.equal(await helpers.seoulRulesFingerprint(one), await helpers.seoulRulesFingerprint(next));
  assert.notEqual(await helpers.seoulRulesFingerprint(one), await helpers.seoulRulesFingerprint(next.replace("Routine", "SPECI")));
  const parsed = await helpers.normalizeSeoulMarketEvent(rawEvent(), DATE);
  assert.equal(parsed.event.rulesVerified, false);
  assert.notEqual(parsed.event.rulesFingerprint, helpers.REVIEWED_SEOUL_RULES_HASH);
});

test("event discovery rejects wrong dates, series, ambiguous buckets and duplicate assets", async () => {
  const cases = [
    (raw) => { raw.eventDate = "2026-10-30"; },
    (raw) => { raw.slug = "highest-temperature-in-mexico-city-on-october-29-2026"; },
    (raw) => { raw.series[0].id = "11428"; },
    (raw) => { raw.markets[1].groupItemTitle = "15°C"; },
    (raw) => { raw.markets[1].clobTokenIds = raw.markets[0].clobTokenIds; },
    (raw) => { raw.markets[1].outcomes = '["Yes","Yes"]'; },
    (raw) => { raw.markets[1].conditionId = "wrong"; },
  ];
  for (const alter of cases) {
    const raw = rawEvent(); alter(raw);
    await assert.rejects(helpers.normalizeSeoulMarketEvent(raw, DATE));
  }
  assert.deepEqual(helpers.parseSeoulTemperatureBucket("−2°C or below"), { temperatureC: -2, bucketKind: "below" });
});

test("quotes preserve exact decimal strings, sort books and discard zero-sized levels", async () => {
  const { markets } = await normalizedEvent();
  const precise = "0.30000000000000000001";
  const rows = helpers.buildSeoulMarketQuotes(markets, [book(1, {
    bids: [{ price: "0.9", size: "0" }, { price: precise, size: "4.50" }, { price: "0.2", size: "10" }],
    asks: [{ price: "0.7", size: "1" }, { price: "0.4", size: "3" }],
  })], [{ token_id: markets[0].yesTokenId, price: "0.35", side: "BUY" }], clocks);
  assert.equal(rows[0].bestBidPrice, precise);
  assert.equal(rows[0].bestBidSize, "4.5");
  assert.equal(rows[0].bestAskPrice, "0.4");
  assert.equal(rows[0].lastTradePrice, "0.35");
  assert.equal(rows[0].bookTimestamp, NOW - 10_000);
  assert.equal(rows[1].quoteStatus, "no_book");
  assert.equal(rows[1].lastTradePrice, null);
  assert.equal(rows[1].lastTradeReceivedAt, null);
});

test("omitted/no-trade last-price entries do not fabricate prices or execution clocks", async () => {
  const { markets } = await normalizedEvent();
  const rows = helpers.buildSeoulMarketQuotes(markets, [book()], [
    { token_id: markets[0].yesTokenId, price: "0.5", side: "" },
  ], clocks);
  assert.equal(rows[0].lastTradePrice, null);
  assert.equal(rows[1].lastTradePrice, null);
  assert.equal(rows[0].lastTradeExecutionAt, undefined);
  assert.equal(rows[1].gammaPrice, "0.5");
  assert.equal(rows[1].bestAskPrice, null);
});

test("fresh receipt cannot freshen cached or future order-book timestamps", async () => {
  const { markets } = await normalizedEvent();
  for (const timestamp of [String(NOW - 3 * MINUTE - 1), String(NOW + 1), "invalid"]) {
    const row = helpers.buildSeoulMarketQuotes(markets, [book(1, { timestamp })], [], clocks)[0];
    assert.equal(row.quoteStatus, "stale");
    assert.equal(row.bestBidPrice, null);
    assert.equal(row.bestAskPrice, null);
  }
});

test("crossed books and mismatched/duplicate assets fail closed", async () => {
  const { markets } = await normalizedEvent();
  assert.throws(() => helpers.buildSeoulMarketQuotes(markets, [book(1, { bids: [{ price: "0.8", size: "5" }] })], [], clocks), /crossed/);
  assert.throws(() => helpers.buildSeoulMarketQuotes(markets, [book(1, { market: condition(2) })], [], clocks), /identity/);
  assert.throws(() => helpers.buildSeoulMarketQuotes(markets, [book(), book()], [], clocks), /duplicate/);
  assert.throws(() => helpers.buildSeoulMarketQuotes(markets, [], [{ token_id: "999", price: "0.4", side: "BUY" }], clocks), /Unexpected/);
});

const backendSource = await readFile(new URL("../convex/seoulPolymarket.js", import.meta.url), "utf8");
const exportNames = [...backendSource.matchAll(/export const (\w+)/g)].map((match) => match[1]);
const helperNames = ["SEOUL_MARKET_SOURCE", "SEOUL_MARKET_FRESHNESS_MS", "SEOUL_MARKET_RETENTION_MS",
  "buildSeoulMarketQuotes", "normalizeSeoulMarketEvent", "seoulMarketDate", "seoulMarketGate",
  "seoulMarketSlug", "seoulQuoteSnapshotStatus"];
const createBackend = new Function("internalActionGeneric", "internalMutationGeneric", "internalQueryGeneric", "queryGeneric",
  "v", "internal", ...helperNames, "seoulMarketSnapshotValidator", "process", "Date", "fetch", "setTimeout", "clearTimeout",
  backendSource.replace(/import[\s\S]*?from\s+"[^"]+";\s*/g, "").replace(/export const /g, "const ") +
    `\nreturn {${exportNames.join(",")}};`);

async function harness({ env = approvedEnv(), verified = true, onFetch, onRead, failBooks = false } = {}) {
  let now = NOW, nextId = 0;
  const normalized = await normalizedEvent({ verified });
  const tables = { seoulPolymarketCollectorStatus: [], seoulPolymarketSnapshots: [] };
  const calls = { reads: 0, writes: 0, fetch: [], scheduled: [], cancelled: 0 };
  const db = {
    query(table) {
      calls.reads += 1;
      const filters = []; let descending = false;
      const selector = { eq(key, value) { filters.push((row) => row[key] === value); return selector; },
        lt(key, value) { filters.push((row) => row[key] < value); return selector; } };
      const values = () => tables[table].filter((row) => filters.every((filter) => filter(row)))
        .sort((a, b) => (descending ? -1 : 1) * ((a.polledAt ?? 0) - (b.polledAt ?? 0))).map((row) => structuredClone(row));
      const query = { withIndex(_name, fn) { fn(selector); return query; }, order(value) { descending = value === "desc"; return query; },
        async first() { return values()[0] ?? null; }, async take(limit) { return values().slice(0, limit); } };
      return query;
    },
    async insert(table, value) { calls.writes += 1; const _id = `${table}:${++nextId}`; tables[table].push({ _id, _creationTime: now, ...structuredClone(value) }); return _id; },
    async patch(id, value) { calls.writes += 1; const row = Object.values(tables).flat().find((entry) => entry._id === id);
      for (const [key, item] of Object.entries(value)) { if (item === undefined) delete row[key]; else row[key] = structuredClone(item); } },
    async delete(id) { calls.writes += 1; for (const rows of Object.values(tables)) { const index = rows.findIndex((row) => row._id === id); if (index >= 0) rows.splice(index, 1); } },
  };
  const fetch = async (url, options) => {
    calls.fetch.push({ url, options }); now += 10;
    onFetch?.(url, env);
    if (failBooks && url.endsWith("/books")) throw new Error("Fixture CLOB failure.");
    const value = url.includes("/events/slug/") ? rawEvent() : url.endsWith("/books") ? [book(1), book(2), book(3)]
      : [{ token_id: "102", price: "0.4", side: "BUY" }];
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return { ok: true, status: 200, headers: { get: (key) => key === "content-type" ? "application/json" : String(bytes.length) },
      body: { getReader() { let read = false; return {
        async read() { onRead?.(url, env); if (read) return { done: true }; read = true; return { done: false, value: bytes }; },
        async cancel() { calls.cancelled += 1; },
      }; } } };
  };
  const v = new Proxy({}, { get: () => () => ({}) });
  class FakeDate extends Date { static now() { return now; } }
  const internal = { seoulPolymarket: Object.fromEntries(exportNames.map((name) => [name, name])) };
  const helperValues = helperNames.map((name) => name === "normalizeSeoulMarketEvent" ? async () => structuredClone(normalized) : helpers[name]);
  const module = createBackend(...Array(4).fill((config) => config), v, internal, ...helperValues, {}, { env }, FakeDate,
    fetch, () => 1, () => {});
  const ctx = { db, scheduler: { async runAfter(delay, name, args) { calls.scheduled.push({ delay, name, args }); } },
    async runQuery(name, args) { return module[name].handler(ctx, args); },
    async runMutation(name, args) { return module[name].handler(ctx, args); } };
  return { env, calls, tables, ctx, call: (name, args = {}) => module[name].handler(ctx, args),
    setNow(value) { now = value; }, current: () => tables.seoulPolymarketCollectorStatus[0],
    async poll() { await module.queueScheduledRefresh.handler(ctx, {}); return module.collectMarket.handler(ctx, calls.scheduled.at(-1).args); } };
}

test("disabled collection/read/write boundaries perform no protected work", async () => {
  const h = await harness({ env: {} });
  assert.equal((await h.call("queueScheduledRefresh")).status, "access_approval_required");
  assert.equal((await h.call("getDashboard")).status, "access_approval_required");
  assert.equal(await h.call("getPollState", { runId: "x" }), null);
  assert.equal((await h.call("finishPoll", { runId: "x", status: "ok", lastAttemptAt: NOW })).stored, false);
  assert.equal((await h.call("collectMarket", { stationIcao: "RKSI", date: DATE, requestedAt: NOW, runId: "x" })).status, "access_approval_required");
  assert.equal(h.calls.reads, 0); assert.equal(h.calls.writes, 0); assert.equal(h.calls.fetch.length, 0);
});

test("public revocation hides retained data before any database read", async () => {
  const h = await harness(); await h.poll();
  const reads = h.calls.reads;
  h.env[helpers.SEOUL_MARKET_FLAGS.publicDisplay] = "false";
  const result = await h.call("getDashboard");
  assert.equal(result.status, "public_approval_required"); assert.equal(result.event, null);
  assert.deepEqual(result.markets, []); assert.equal(h.calls.reads, reads);
});

test("collector uses only exact-date Gamma and read-only CLOB POSTs, storing clocks separately", async () => {
  const h = await harness(); assert.equal((await h.poll()).status, "ok");
  assert.equal(h.tables.seoulPolymarketSnapshots.length, 1);
  const snapshot = h.tables.seoulPolymarketSnapshots[0];
  assert.equal(snapshot.event.eventSlug, helpers.seoulMarketSlug(DATE));
  assert.ok(snapshot.polledAt >= snapshot.bookReceivedAt);
  assert.ok(snapshot.firstSeenAt >= snapshot.polledAt);
  assert.equal(snapshot.markets[0].bookTimestamp, NOW - 10_000);
  assert.equal(snapshot.markets[0].lastTradePrice, null);
  assert.equal(snapshot.markets[1].lastTradePrice, "0.4");
  assert.deepEqual(h.calls.fetch.map((call) => new URL(call.url).pathname), [
    `/events/slug/${helpers.seoulMarketSlug(DATE)}`, "/books", "/last-trades-prices",
  ]);
  for (const call of h.calls.fetch) { assert.equal(call.options.redirect, "error"); assert.equal(call.options.headers.Authorization, undefined); }
  assert.deepEqual(JSON.parse(h.calls.fetch[1].options.body), [{ token_id: "100" }, { token_id: "102" }, { token_id: "104" }]);
  assert.equal((await h.call("getDashboard")).status, "ok");
});

test("new rules store an unavailable metadata snapshot without requesting CLOB", async () => {
  const h = await harness({ verified: false });
  assert.equal((await h.poll()).status, "unsupported_rules");
  assert.equal(h.calls.fetch.length, 1);
  const result = await h.call("getDashboard");
  assert.equal(result.status, "unsupported_rules"); assert.deepEqual(result.markets, []);
});

test("revocation during response streaming discards fetched data", async () => {
  const h = await harness({ onRead: (url, env) => {
    if (url.endsWith("/books")) env[helpers.SEOUL_MARKET_FLAGS.retention] = "false";
  } });
  const result = await h.poll();
  assert.equal(result.status, "retention_approval_required");
  assert.equal(h.tables.seoulPolymarketSnapshots.length, 0);
  assert.ok(h.calls.cancelled > 0);
});

test("revocation at the final mutation boundary prevents snapshot and status writes", async () => {
  const h = await harness();
  const mutate = h.ctx.runMutation;
  let writesAtRevocation;
  h.ctx.runMutation = async (name, args) => {
    if (name === "finishPoll" && args.snapshot) {
      writesAtRevocation = h.calls.writes;
      h.env[helpers.SEOUL_MARKET_FLAGS.access] = "false";
    }
    return await mutate(name, args);
  };
  assert.equal((await h.poll()).status, "access_approval_required");
  assert.equal(h.calls.writes, writesAtRevocation);
  assert.equal(h.tables.seoulPolymarketSnapshots.length, 0);
  assert.ok(h.current().collectionRunId);
});

test("one-minute slots, leases and run ownership prevent duplicate or stale writes", async () => {
  const h = await harness();
  await h.call("queueScheduledRefresh"); const first = h.calls.scheduled[0].args;
  assert.equal((await h.call("queueScheduledRefresh")).status, "already_running");
  await h.call("finishPoll", { runId: first.runId, status: "no_data", lastAttemptAt: NOW });
  assert.equal((await h.call("queueScheduledRefresh")).status, "cooldown");
  h.setNow(NOW + MINUTE); await h.call("queueScheduledRefresh");
  assert.equal((await h.call("collectMarket", first)).status, "superseded");
  assert.equal((await h.call("finishPoll", { runId: first.runId, status: "error", lastAttemptAt: NOW })).status, "superseded");
  assert.equal(h.calls.fetch.length, 0);
});

test("today-only dashboard ages out book/provider clocks and errors never present retained quotes", async () => {
  const h = await harness(); await h.poll();
  const reads = h.calls.reads;
  assert.equal((await h.call("getDashboard", { date: "2026-10-28" })).status, "no_data");
  assert.equal(h.calls.reads, reads);
  h.setNow(NOW + 3 * MINUTE - 5_000);
  const cached = await h.call("getDashboard");
  assert.equal(cached.status, "stale"); assert.deepEqual(cached.markets, []);
  const failure = await harness({ failBooks: true });
  assert.equal((await failure.poll()).status, "error");
  assert.equal((await failure.call("getDashboard")).status, "error");
});

test("a later response failure hides still-fresh quotes from the preceding successful poll", async () => {
  let fail = false;
  const h = await harness({ onFetch: (url) => {
    if (fail && url.endsWith("/books")) throw new Error("Fixture later CLOB failure.");
  } });
  await h.poll();
  assert.equal((await h.call("getDashboard")).markets.length, 3);
  h.setNow(NOW + MINUTE);
  fail = true;
  assert.equal((await h.poll()).status, "error");
  assert.equal(h.tables.seoulPolymarketSnapshots.length, 1);
  const result = await h.call("getDashboard");
  assert.equal(result.status, "error");
  assert.deepEqual(result.markets, []);
});

test("retention cleanup remains deletion-only after approvals are removed", async () => {
  const h = await harness(); await h.poll();
  h.setNow(NOW + helpers.SEOUL_MARKET_RETENTION_MS + MINUTE);
  h.env[helpers.SEOUL_MARKET_FLAGS.access] = "false";
  assert.equal((await h.call("pruneExpiredSnapshots")).prunedCount, 1);
  assert.equal(h.tables.seoulPolymarketSnapshots.length, 0);
});
