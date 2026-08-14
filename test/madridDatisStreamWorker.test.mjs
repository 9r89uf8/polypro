import assert from "node:assert/strict";
import test from "node:test";

import { runAirframesDatisStreamSession } from "../convex/madridDatisStreamNode.js";

const LEASE_MS = 60_000;

class FakeSocket {
  constructor({ acknowledge = false } = {}) {
    this.acknowledge = acknowledge;
    this.handlers = new Map();
    this.outbound = [];
    this.connectCount = 0;
    this.disconnectCount = 0;
  }

  on(eventName, handler) {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
    return this;
  }

  emit(eventName, ...args) {
    this.outbound.push({ eventName, args });
    if (this.acknowledge && eventName === "messages:sniff") {
      queueMicrotask(() =>
        this.serverEmit("messages:sniff:started", {
          browserId: "fixture",
        }),
      );
    }
    return this;
  }

  connect() {
    this.connectCount += 1;
    queueMicrotask(() => this.serverEmit("connect"));
    return this;
  }

  disconnect() {
    this.disconnectCount += 1;
    return this;
  }

  removeAllListeners() {
    this.handlers.clear();
    return this;
  }

  serverEmit(eventName, payload) {
    for (const handler of this.handlers.get(eventName) ?? []) {
      handler(payload);
    }
  }
}

function createFakeContext({
  getApproved = () => true,
  getConnectionEnabled = () => true,
  queryHook,
} = {}) {
  const calls = [];
  let queryCount = 0;
  return {
    calls,
    async runQuery(_reference, args) {
      queryCount += 1;
      calls.push({ type: "query", args, queryCount });
      if (queryHook) {
        const hooked = await queryHook(queryCount);
        if (hooked) {
          return hooked;
        }
      }
      const approved = getApproved();
      const connectionEnabled = getConnectionEnabled();
      return {
        approved,
        connectionEnabled,
        status: !approved
          ? "approval_required"
          : connectionEnabled
            ? "connection_enabled"
            : "connection_disabled",
      };
    },
    async runMutation(_reference, args) {
      calls.push({ type: "mutation", args });
      if ("startedAt" in args) {
        if (!getApproved()) {
          return { status: "approval_required" };
        }
        if (!getConnectionEnabled()) {
          return { status: "connection_disabled" };
        }
        return {
          status: "connecting",
          leaseUntil: Date.now() + LEASE_MS,
        };
      }
      if ("connectedAt" in args) {
        return { status: "connecting" };
      }
      if ("subscribedAt" in args) {
        return { status: "listening" };
      }
      if ("heartbeatAt" in args) {
        return { status: "listening" };
      }
      if ("rows" in args) {
        return {
          status: "ok",
          insertedCount: args.rows.length,
          updatedCount: 0,
          unchangedCount: 0,
        };
      }
      if ("outcome" in args) {
        return args.outcome === "rotate"
          ? { status: "queued", restarted: true }
          : { status: "backoff", restarted: false };
      }
      if ("endedAt" in args) {
        return { status: "stopped" };
      }
      throw new Error(`Unexpected mutation args: ${JSON.stringify(args)}`);
    },
  };
}

async function waitFor(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for mocked stream state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function runFixtureSession(ctx, socketFactory, getApprovalValue, overrides = {}) {
  return runAirframesDatisStreamSession(
    ctx,
    {
      stationIcao: "LEMD",
      generation: "LEMD:fixture:1",
      leaseUntil: Date.now() + LEASE_MS,
    },
    {
      socketFactory,
      getApprovalValue,
      getConnectionEnabledValue: () => "true",
      maximumSessionMs: 25,
      heartbeatCheckMs: 1_000,
      heartbeatStoreMs: 1_000,
      subscriptionAckTimeoutMs: 100,
      ...overrides,
    },
  );
}

test("disabled gate never constructs or connects a socket", async () => {
  const ctx = createFakeContext({ getApproved: () => false });
  let socketFactoryCalled = false;
  const result = await runFixtureSession(
    ctx,
    () => {
      socketFactoryCalled = true;
      throw new Error("socket must not be constructed");
    },
    () => "false",
  );

  assert.equal(result.status, "approval_required");
  assert.equal(socketFactoryCalled, false);
});

test("approved but operationally disabled gate never constructs a socket", async () => {
  const ctx = createFakeContext({
    getApproved: () => true,
    getConnectionEnabled: () => false,
  });
  let socketFactoryCalled = false;
  const result = await runFixtureSession(
    ctx,
    () => {
      socketFactoryCalled = true;
      throw new Error("socket must not be constructed");
    },
    () => "true",
    { getConnectionEnabledValue: () => "false" },
  );

  assert.equal(result.status, "connection_disabled");
  assert.equal(socketFactoryCalled, false);
});

test("approved session uses one anonymous subscription and rotates cleanly", async () => {
  const socket = new FakeSocket({ acknowledge: true });
  let connectionOptions;
  const ctx = createFakeContext();
  const result = await runFixtureSession(
    ctx,
    (_url, options) => {
      connectionOptions = options;
      return socket;
    },
    () => "true",
  );

  assert.equal(socket.connectCount, 1);
  assert.equal(socket.disconnectCount, 1);
  assert.deepEqual(
    socket.outbound.map((entry) => entry.eventName),
    ["messages:sniff"],
  );
  assert.equal(connectionOptions.autoConnect, false);
  assert.equal(connectionOptions.reconnection, false);
  assert.equal("auth" in connectionOptions, false);
  assert.ok(
    ctx.calls.some(
      (call) =>
        call.type === "mutation" && "subscribedAt" in call.args,
    ),
  );
  assert.equal(result.outcome, "rotate");
  assert.equal(result.restarted, true);
});

test("revocation disconnects, clears the lease, and stores no candidate", async () => {
  let approvalValue = "true";
  const socket = new FakeSocket({ acknowledge: true });
  const ctx = createFakeContext({
    getApproved: () => approvalValue === "true",
  });
  const running = runFixtureSession(
    ctx,
    () => socket,
    () => approvalValue,
    { maximumSessionMs: 250 },
  );

  await waitFor(() =>
    ctx.calls.some(
      (call) =>
        call.type === "mutation" && "subscribedAt" in call.args,
    ),
  );
  approvalValue = "false";
  socket.serverEmit("message", {
    text: "LEMD ATIS ARR A 1200Z RWY 32R T34 DP08",
    timestamp: "2026-07-30T12:01:00Z",
  });
  const result = await running;

  assert.equal(result.status, "approval_required");
  assert.ok(socket.disconnectCount >= 1);
  assert.equal(
    ctx.calls.some(
      (call) => call.type === "mutation" && "rows" in call.args,
    ),
    false,
  );
  assert.equal(
    ctx.calls.some(
      (call) =>
        call.type === "mutation" &&
        "endedAt" in call.args &&
        !("outcome" in call.args),
    ),
    true,
  );
});

test("operational disable disconnects, clears the lease, and stores no candidate", async () => {
  let connectionEnabledValue = "true";
  const socket = new FakeSocket({ acknowledge: true });
  const ctx = createFakeContext({
    getConnectionEnabled: () => connectionEnabledValue === "true",
  });
  const running = runFixtureSession(
    ctx,
    () => socket,
    () => "true",
    {
      getConnectionEnabledValue: () => connectionEnabledValue,
      maximumSessionMs: 250,
    },
  );

  await waitFor(() =>
    ctx.calls.some(
      (call) =>
        call.type === "mutation" && "subscribedAt" in call.args,
    ),
  );
  connectionEnabledValue = "false";
  socket.serverEmit("message", {
    text: "LEMD ATIS ARR A 1200Z RWY 32R T34 DP08",
    timestamp: "2026-07-30T12:01:00Z",
  });
  const result = await running;

  assert.equal(result.status, "connection_disabled");
  assert.ok(socket.disconnectCount >= 1);
  assert.equal(
    ctx.calls.some(
      (call) => call.type === "mutation" && "rows" in call.args,
    ),
    false,
  );
  assert.equal(
    ctx.calls.some(
      (call) =>
        call.type === "mutation" &&
        "endedAt" in call.args &&
        !("outcome" in call.args),
    ),
    true,
  );
});

test("an in-flight late subscription ACK cannot revive an errored session", async () => {
  let resolveAckApproval;
  const ackApproval = new Promise((resolve) => {
    resolveAckApproval = resolve;
  });
  const socket = new FakeSocket();
  const ctx = createFakeContext({
    queryHook: async (queryCount) =>
      queryCount === 5 ? await ackApproval : null,
  });
  const running = runFixtureSession(
    ctx,
    () => socket,
    () => "true",
    { maximumSessionMs: 250 },
  );

  await waitFor(() =>
    socket.outbound.some(
      (entry) => entry.eventName === "messages:sniff",
    ),
  );
  socket.serverEmit("messages:sniff:started", {
    browserId: "fixture",
  });
  await waitFor(() =>
    ctx.calls.some(
      (call) => call.type === "query" && call.queryCount === 5,
    ),
  );
  socket.serverEmit("error", new Error("fixture disconnect"));
  resolveAckApproval({
    approved: true,
    connectionEnabled: true,
    status: "connection_enabled",
  });
  const result = await running;

  assert.equal(result.outcome, "error");
  assert.equal(
    ctx.calls.some(
      (call) =>
        call.type === "mutation" && "subscribedAt" in call.args,
    ),
    false,
  );
});
