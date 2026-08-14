import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMadridDatisStreamGeneration,
  getMadridDatisStreamBackoffMs,
  isMadridDatisStreamHeartbeatStale,
  isMadridDatisStreamLeaseActive,
  MADRID_DATIS_STREAM_LEASE_MS,
  MADRID_DATIS_STREAM_SESSION_MS,
} from "../convex/madridDatisStreamLifecycle.js";

test("stream session rotates before its generation lease expires", () => {
  assert.ok(MADRID_DATIS_STREAM_SESSION_MS > 8 * 60 * 1000);
  assert.ok(MADRID_DATIS_STREAM_SESSION_MS < MADRID_DATIS_STREAM_LEASE_MS);
});

test("only a non-empty unexpired generation owns the listener lease", () => {
  const now = 1_000_000;
  assert.equal(
    isMadridDatisStreamLeaseActive(
      { generation: "LEMD:1:1", leaseUntil: now + 1 },
      now,
    ),
    true,
  );
  assert.equal(
    isMadridDatisStreamLeaseActive(
      { generation: "LEMD:1:1", leaseUntil: now },
      now,
    ),
    false,
  );
  assert.equal(
    isMadridDatisStreamLeaseActive(
      { generation: "", leaseUntil: now + 1 },
      now,
    ),
    false,
  );
});

test("generation fencing changes on every supervised attempt", () => {
  const now = 1_000_000;
  assert.equal(
    buildMadridDatisStreamGeneration("LEMD", now, 7),
    "LEMD:1000000:7",
  );
  assert.notEqual(
    buildMadridDatisStreamGeneration("LEMD", now, 7),
    buildMadridDatisStreamGeneration("LEMD", now, 8),
  );
});

test("listener heartbeat becomes stale only in listening state", () => {
  const now = 1_000_000;
  assert.equal(
    isMadridDatisStreamHeartbeatStale(
      {
        status: "listening",
        lastHeartbeatAt: now - 91_000,
      },
      now,
    ),
    true,
  );
  assert.equal(
    isMadridDatisStreamHeartbeatStale(
      {
        status: "listening",
        lastHeartbeatAt: now - 89_000,
      },
      now,
    ),
    false,
  );
  assert.equal(
    isMadridDatisStreamHeartbeatStale(
      {
        status: "connecting",
        lastHeartbeatAt: now - 91_000,
      },
      now,
    ),
    false,
  );
});

test("failure backoff is bounded, increasing, and deterministic", () => {
  const generation = "LEMD:1000000:7";
  const delays = Array.from({ length: 12 }, (_, index) =>
    getMadridDatisStreamBackoffMs(index + 1, generation),
  );
  assert.ok(delays[0] >= 5_000);
  assert.ok(delays.at(-1) <= 330_000);
  assert.ok(delays[1] > delays[0]);
  assert.deepEqual(
    delays,
    Array.from({ length: 12 }, (_, index) =>
      getMadridDatisStreamBackoffMs(index + 1, generation),
    ),
  );
});
