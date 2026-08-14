import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
  AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
  buildAirframesDatisStreamConnectionPlan,
  evaluateAirframesDatisStreamAccess,
  evaluateAirframesDatisStreamConnection,
  evaluateAirframesDatisStreamRuntime,
} from "../convex/madridDatisStreamAccess.js";
import {
  buildAirframesDatisStreamStoreArgs,
  minimizeAirframesDatisStreamMessage,
  normalizeAirframesDatisStreamText,
  parseAirframesDatisStreamEvent,
} from "../convex/madridDatisStreamParser.js";

const NOW = Date.parse("2026-07-30T22:00:00Z");

function message(text, timestamp, extra = {}) {
  return {
    text,
    timestamp,
    createdAt: timestamp,
    ...extra,
  };
}

test("stream approval accepts only exact true and stays anonymous", () => {
  assert.equal(
    AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
    "AIRFRAMES_LEMD_STREAM_APPROVED",
  );
  assert.ok(AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG.length <= 40);
  for (const value of [undefined, "", "false", "TRUE", "1", " true "]) {
    assert.deepEqual(
      evaluateAirframesDatisStreamAccess(value),
      {
        approved: false,
        configured: false,
        status: "approval_required",
      },
    );
  }

  assert.deepEqual(evaluateAirframesDatisStreamAccess("true"), {
    approved: true,
    configured: true,
    status: "approved",
    authentication: "anonymous",
  });
});

test("stream connection kill switch accepts only exact true", () => {
  assert.equal(
    AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
    "AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED",
  );
  assert.ok(AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG.length <= 40);
  for (const value of [undefined, "", "false", "TRUE", "1", " true "]) {
    assert.deepEqual(evaluateAirframesDatisStreamConnection(value), {
      enabled: false,
      configured: false,
      status: "connection_disabled",
    });
    assert.deepEqual(
      evaluateAirframesDatisStreamRuntime("true", value),
      {
        approved: true,
        connectionEnabled: false,
        ready: false,
        status: "connection_disabled",
        authentication: "anonymous",
      },
    );
  }
  assert.deepEqual(evaluateAirframesDatisStreamConnection("true"), {
    enabled: true,
    configured: true,
    status: "connection_enabled",
  });
});

test("connection plan requires both exact-true gates", () => {
  const disabled = buildAirframesDatisStreamConnectionPlan(
    "false",
    "true",
  );
  assert.equal(disabled.status, "approval_required");
  assert.equal(disabled.connection, null);
  assert.equal(disabled.subscription, null);

  const operationallyDisabled =
    buildAirframesDatisStreamConnectionPlan("true", "false");
  assert.equal(operationallyDisabled.approved, true);
  assert.equal(operationallyDisabled.connectionEnabled, false);
  assert.equal(operationallyDisabled.status, "connection_disabled");
  assert.equal(operationallyDisabled.connection, null);
  assert.equal(operationallyDisabled.subscription, null);

  const anonymous = buildAirframesDatisStreamConnectionPlan(
    "true",
    "true",
  );
  assert.equal(anonymous.connection.url, "wss://ws.airframes.io");
  assert.deepEqual(anonymous.connection.options.transports, ["websocket"]);
  assert.equal(anonymous.connection.options.autoConnect, false);
  assert.equal(anonymous.connection.options.reconnection, false);
  assert.equal("auth" in anonymous.connection.options, false);
  assert.deepEqual(anonymous.subscription, {
    event: "messages:sniff",
    args: [],
    sampled: true,
  });
});

test("revoked event processing does not inspect the protected payload", () => {
  const protectedPayload = {};
  Object.defineProperty(protectedPayload, "text", {
    get() {
      throw new Error("payload should not be read while disabled");
    },
  });

  const parsed = parseAirframesDatisStreamEvent(
    "message",
    protectedPayload,
    {
      approvalValue: undefined,
      nowMs: NOW,
    },
  );
  assert.equal(parsed.status, "approval_required");
  assert.equal(parsed.messageCount, 0);
  assert.deepEqual(parsed.rows, []);
});

test("repairs split arrival header and parses a sampled message event", () => {
  const text =
    "/MADAAYA.TI2/LEMD ATIS A / RR Y 2110Z SINGLE RWY IN USE " +
    "RWY IN USE 32R CAVOK T34 DP8 QNH 1018HPA CONFIRM ATIS ARR Y";
  assert.match(normalizeAirframesDatisStreamText(text), /LEMD ATIS ARR Y/);

  const parsed = parseAirframesDatisStreamEvent(
    "message",
    message(text, "2026-07-30T21:16:00Z", {
      tail: "fixture-tail-must-not-be-retained",
      station: { ident: "fixture-feeder-must-not-be-retained" },
    }),
    {
      approvalValue: "true",
      nowMs: NOW,
    },
  );

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.messageCount, 1);
  assert.equal(parsed.parsedCount, 1);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(
    {
      stationIcao: parsed.rows[0].stationIcao,
      reportKind: parsed.rows[0].reportKind,
      designator: parsed.rows[0].designator,
      reportTsUtc: parsed.rows[0].reportTsUtc,
      receivedAtUtc: parsed.rows[0].receivedAtUtc,
      deliveryLagMs: parsed.rows[0].deliveryLagMs,
      tempC: parsed.rows[0].tempC,
      dewPointC: parsed.rows[0].dewPointC,
    },
    {
      stationIcao: "LEMD",
      reportKind: "ARR",
      designator: "Y",
      reportTsUtc: Date.parse("2026-07-30T21:10:00Z"),
      receivedAtUtc: Date.parse("2026-07-30T21:16:00Z"),
      deliveryLagMs: 6 * 60 * 1000,
      tempC: 34,
      dewPointC: 8,
    },
  );
  assert.equal("tail" in parsed.rows[0], false);
  assert.equal("station" in parsed.rows[0], false);
  assert.equal("text" in parsed.rows[0], false);
  assert.equal(parsed.rows[0].source, "airframes_acars_datis_stream");
});

test("parses split departure text from an authenticated feed event", () => {
  const parsed = parseAirframesDatisStreamEvent(
    "feed:message",
    message(
      "LEMD ATIS D\n/\nEP Z 2120Z RWY 36L T MS 05 DP M 10 Q1018",
      "2026-07-30T21:21:00Z",
    ),
    {
      approvalValue: "true",
      nowMs: NOW,
    },
  );

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.rows[0].reportKind, "DEP");
  assert.equal(parsed.rows[0].designator, "Z");
  assert.equal(parsed.rows[0].tempC, -5);
  assert.equal(parsed.rows[0].dewPointC, -10);
});

test("parses station monitor batches, rejects noise, and deduplicates relays", () => {
  const parsed = parseAirframesDatisStreamEvent(
    "station:monitor:data",
    {
      stationId: 123,
      newMessages: [
        message(
          "LEMD ATIS A RR A 2130Z RWY 32R T33 DP07",
          "2026-07-30T21:33:00Z",
        ),
        message(
          "LEMD ATIS ARR A 2130Z RWY 32R T32 DP07",
          "2026-07-30T21:31:00Z",
        ),
        message(
          "UNRELATED ACARS MESSAGE",
          "2026-07-30T21:31:00Z",
        ),
      ],
    },
    {
      approvalValue: "true",
      nowMs: NOW,
    },
  );

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.messageCount, 3);
  assert.equal(parsed.parsedCount, 2);
  assert.equal(parsed.rejectedCount, 1);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].receivedAtUtc, Date.parse("2026-07-30T21:31:00Z"));
  assert.equal(parsed.rows[0].tempC, 32);
});

test("bounds event batches and rejects oversized source text", () => {
  const parsed = parseAirframesDatisStreamEvent(
    "message",
    [
      message(
        "LEMD ATIS ARR B 2140Z RWY 32R T33 DP07",
        "2026-07-30T21:41:00Z",
      ),
      message(
        "LEMD ATIS ARR C 2150Z RWY 32R T32 DP07",
        "2026-07-30T21:51:00Z",
      ),
    ],
    {
      approvalValue: "true",
      nowMs: NOW,
      maxMessagesPerEvent: 1,
    },
  );
  assert.equal(parsed.messageCount, 1);
  assert.equal(parsed.truncatedCount, 1);
  assert.equal(parsed.rows[0].designator, "B");

  assert.equal(
    minimizeAirframesDatisStreamMessage(
      message("X".repeat(20), "2026-07-30T21:51:00Z"),
      { maxTextLength: 10 },
    ),
    null,
  );
});

test("classifies control, provider-error, and unknown events without data", () => {
  assert.equal(
    parseAirframesDatisStreamEvent(
      "messages:sniff:started",
      { browserId: "fixture" },
      { approvalValue: "true", nowMs: NOW },
    ).status,
    "control",
  );
  const providerError = parseAirframesDatisStreamEvent(
    "error",
    { message: "  Rate   limit exceeded  " },
    { approvalValue: "true", nowMs: NOW },
  );
  assert.equal(providerError.status, "provider_error");
  assert.equal(providerError.message, "Rate limit exceeded");
  assert.equal(
    parseAirframesDatisStreamEvent(
      "chat:message:new",
      {},
      { approvalValue: "true", nowMs: NOW },
    ).status,
    "ignored_event",
  );
});

test("storage arguments recheck both gates immediately before handoff", () => {
  const parsed = parseAirframesDatisStreamEvent(
    "message",
    message(
      "LEMD ATIS ARR D 2150Z RWY 32R T32 DP07",
      "2026-07-30T21:51:00Z",
    ),
    {
      approvalValue: "true",
      nowMs: NOW,
    },
  );

  const revoked = buildAirframesDatisStreamStoreArgs(parsed, {
    approvalValue: "false",
    connectionEnabledValue: "true",
    attemptedAt: NOW,
  });
  assert.equal(revoked.status, "approval_required");
  assert.equal(revoked.storeArgs, null);

  const connectionDisabled = buildAirframesDatisStreamStoreArgs(parsed, {
    approvalValue: "true",
    connectionEnabledValue: "false",
    attemptedAt: NOW,
  });
  assert.equal(connectionDisabled.status, "connection_disabled");
  assert.equal(connectionDisabled.storeArgs, null);

  const ready = buildAirframesDatisStreamStoreArgs(parsed, {
    approvalValue: "true",
    connectionEnabledValue: "true",
    attemptedAt: NOW,
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.storeArgs.stationIcao, "LEMD");
  assert.equal(ready.storeArgs.attemptedAt, NOW);
  assert.equal(ready.storeArgs.rows.length, 1);
  assert.equal(ready.storeArgs.rows[0].designator, "D");
  assert.deepEqual(
    Object.keys(ready.storeArgs.rows[0]).sort(),
    [
      "date",
      "dedupeKey",
      "deliveryLagMs",
      "designator",
      "dewPointC",
      "dewPointF",
      "receivedAtLocal",
      "receivedAtUtc",
      "reportKind",
      "reportTimeLocal",
      "reportTsUtc",
      "source",
      "stationIcao",
      "tempC",
      "tempF",
    ].sort(),
  );
});
