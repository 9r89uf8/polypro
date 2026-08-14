import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAirframesDatisAccess } from "../convex/madridDatisAccess.js";
import {
  dedupeAirframesDatisRows,
  parseAirframesDatisMessage,
  parseAirframesDatisPayload,
} from "../convex/madridDatisParser.js";

const NOW = Date.parse("2026-07-29T02:00:00Z");

function message(text, timestamp) {
  return { text, timestamp, createdAt: timestamp };
}

test("approval gate accepts only exact true and treats the key as optional", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", " true "]) {
    assert.deepEqual(evaluateAirframesDatisAccess(value, "working-key"), {
      approved: false,
      configured: false,
      status: "approval_required",
    });
  }

  assert.deepEqual(evaluateAirframesDatisAccess("true", "  "), {
    approved: true,
    configured: true,
    status: "approved",
    authentication: "anonymous",
    apiKey: null,
  });
  assert.deepEqual(evaluateAirframesDatisAccess("true", " issued-key "), {
    approved: true,
    configured: true,
    status: "approved",
    authentication: "bearer",
    apiKey: "issued-key",
  });
});

test("parses a live LEMD arrival D-ATIS temperature at report time", () => {
  const row = parseAirframesDatisMessage(
    message(
      "/MADAAYA.TI2/LEMD ATIS ARR U 0030Z RWY 32L T25 DP10 Q1018",
      "2026-07-29T00:32:14Z",
    ),
    { nowMs: NOW },
  );

  assert.deepEqual(
    {
      stationIcao: row.stationIcao,
      reportKind: row.reportKind,
      designator: row.designator,
      reportTsUtc: row.reportTsUtc,
      tempC: row.tempC,
      tempF: row.tempF,
      dewPointC: row.dewPointC,
      deliveryLagMs: row.deliveryLagMs,
    },
    {
      stationIcao: "LEMD",
      reportKind: "ARR",
      designator: "U",
      reportTsUtc: Date.parse("2026-07-29T00:30:00Z"),
      tempC: 25,
      tempF: 77,
      dewPointC: 10,
      deliveryLagMs: 134_000,
    },
  );
});

test("accepts multiline departure messages and signed temperature tokens", () => {
  const row = parseAirframesDatisMessage(
    message(
      "LEMD ATIS\nDEP V 0140Z\nRWY 36L\nT MS 05 DP M 10 Q1018",
      "2026-07-29T01:43:00Z",
    ),
    { nowMs: NOW },
  );

  assert.equal(row.reportKind, "DEP");
  assert.equal(row.designator, "V");
  assert.equal(row.tempC, -5);
  assert.equal(row.dewPointC, -10);
});

test("reconstructs the previous UTC day across midnight", () => {
  const row = parseAirframesDatisMessage(
    message(
      "LEMD ATIS ARR A 2350Z RWY 32L T18 DP09 Q1016",
      "2026-07-30T00:02:00Z",
    ),
    { nowMs: Date.parse("2026-07-30T00:05:00Z") },
  );

  assert.equal(row.reportTsUtc, Date.parse("2026-07-29T23:50:00Z"));
  assert.equal(row.deliveryLagMs, 12 * 60 * 1000);
});

test("rejects wrong-station, malformed, stale-delivery and future messages", () => {
  assert.equal(
    parseAirframesDatisMessage(
      message("LEBL ATIS ARR A 0100Z T24 DP12", "2026-07-29T01:02:00Z"),
      { nowMs: NOW },
    ),
    null,
  );
  assert.equal(
    parseAirframesDatisMessage(
      message("LEMD ATIS ARR A 0100Z DP12", "2026-07-29T01:02:00Z"),
      { nowMs: NOW },
    ),
    null,
  );
  assert.equal(
    parseAirframesDatisMessage(
      message("LEMD ATIS ARR A 0030Z T24 DP12", "2026-07-29T01:40:00Z"),
      { nowMs: NOW },
    ),
    null,
  );
  assert.equal(
    parseAirframesDatisMessage(
      message("LEMD ATIS ARR A 0210Z T24 DP12", "2026-07-29T02:10:00Z"),
      { nowMs: NOW },
    ),
    null,
  );
});

test("deduplicates relay copies by report identity and keeps first receipt", () => {
  const later = parseAirframesDatisMessage(
    message("LEMD ATIS ARR U 0030Z T26 DP10", "2026-07-29T00:37:00Z"),
    { nowMs: NOW },
  );
  const earlier = parseAirframesDatisMessage(
    message("LEMD ATIS ARR U 0030Z T25 DP10", "2026-07-29T00:32:00Z"),
    { nowMs: NOW },
  );
  const rows = dedupeAirframesDatisRows([later, earlier]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].receivedAtUtc, Date.parse("2026-07-29T00:32:00Z"));
  assert.equal(rows[0].tempC, 25);
});

test("normalizes array payloads and reports rejection and duplicate counts", () => {
  const parsed = parseAirframesDatisPayload(
    [
      message("LEMD ATIS ARR U 0030Z T25 DP10", "2026-07-29T00:32:00Z"),
      message("LEMD ATIS ARR U 0030Z T25 DP10", "2026-07-29T00:35:00Z"),
      message("unrelated ACARS message", "2026-07-29T00:35:00Z"),
    ],
    { nowMs: NOW },
  );

  assert.equal(parsed.messageCount, 3);
  assert.equal(parsed.parsedCount, 2);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.rejectedCount, 1);
  assert.equal(parsed.rows.length, 1);
});
