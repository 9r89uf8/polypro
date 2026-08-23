import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  capmaImageCollectorInFlight,
  isMexicoRoutineWatchWindow,
  isTargetRoutineMetar,
  mexicoEdgeFastWatchGateState,
  mexicoRoutineWatchRetryDelayMs,
  mexicoRoutineWatchSessionEnd,
} from "../convex/mexicoEdgeWatch.js";

test("high-frequency CAPMA watch fails closed unless every exact gate is true", () => {
  assert.equal(mexicoEdgeFastWatchGateState({}).allowed, false);
  assert.equal(
    mexicoEdgeFastWatchGateState({
      SENEAM_MMMX_AFTN_ACCESS_APPROVED: "true",
      SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED: "TRUE",
      MEXICO_EDGE_ROUTINE_WATCH_ENABLED: "true",
    }).allowed,
    false,
  );
  assert.equal(
    mexicoEdgeFastWatchGateState({
      SENEAM_MMMX_AFTN_ACCESS_APPROVED: "true",
      SENEAM_MMMX_AFTN_HF_ACCESS_APPROVED: "true",
      MEXICO_EDGE_ROUTINE_WATCH_ENABLED: "true",
    }).allowed,
    true,
  );
});

test("routine target detection uses a wide current-cycle bound", () => {
  const startedAt = Date.parse("2026-08-20T22:40:00Z");
  assert.equal(
    isTargetRoutineMetar(
      {
        reportType: "METAR",
        isCorrection: false,
        obsTimeUtc: Date.parse("2026-08-20T22:45:00Z"),
      },
      startedAt,
    ),
    true,
  );
  assert.equal(
    isTargetRoutineMetar(
      {
        reportType: "SPECI",
        isCorrection: false,
        obsTimeUtc: Date.parse("2026-08-20T22:45:00Z"),
      },
      startedAt,
    ),
    false,
  );
  assert.equal(
    isTargetRoutineMetar(
      {
        reportType: "METAR",
        isCorrection: false,
        obsTimeUtc: Date.parse("2026-08-20T21:45:00Z"),
      },
      startedAt,
    ),
    false,
  );
});

test("high-frequency requests are server-bounded to the late-hour window", () => {
  assert.equal(
    isMexicoRoutineWatchWindow(Date.parse("2026-08-20T22:39:59.999Z")),
    false,
  );
  assert.equal(
    isMexicoRoutineWatchWindow(Date.parse("2026-08-20T22:40:00.000Z")),
    true,
  );
  assert.equal(
    isMexicoRoutineWatchWindow(Date.parse("2026-08-20T22:57:59.999Z")),
    true,
  );
  assert.equal(
    isMexicoRoutineWatchWindow(Date.parse("2026-08-20T22:58:00.000Z")),
    false,
  );
});

test("the two bounded cron sessions do not overlap", async () => {
  assert.equal(
    mexicoRoutineWatchSessionEnd(Date.parse("2026-08-20T22:40:00Z")),
    Date.parse("2026-08-20T22:49:00Z"),
  );
  assert.equal(
    mexicoRoutineWatchSessionEnd(Date.parse("2026-08-20T22:45:00Z")),
    Date.parse("2026-08-20T22:49:00Z"),
  );
  assert.equal(
    mexicoRoutineWatchSessionEnd(Date.parse("2026-08-20T22:49:00Z")),
    Date.parse("2026-08-20T22:58:00Z"),
  );
  assert.equal(
    mexicoRoutineWatchSessionEnd(Date.parse("2026-08-20T22:55:00Z")),
    Date.parse("2026-08-20T22:58:00Z"),
  );
  assert.equal(
    mexicoRoutineWatchSessionEnd(Date.parse("2026-08-20T22:58:00Z")),
    null,
  );

  const [crons, watcher] = await Promise.all([
    readFile(new URL("../convex/crons.js", import.meta.url), "utf8"),
    readFile(new URL("../convex/mexicoEdgeWatch.js", import.meta.url), "utf8"),
  ]);
  assert.match(crons, /mexico_edge_capma_routine_watch_minute_40/);
  assert.match(crons, /mexico_edge_capma_routine_watch_minute_49/);
  assert.match(crons, /durationMs: 525000/);
  assert.match(crons, /intervalMs: 5000/);
  assert.match(watcher, /^"use node";/);
  assert.match(watcher, /const REQUEST_TIMEOUT_MS = 5_000;/);
  assert.match(watcher, /const MIN_ERROR_BACKOFF_MS = 15_000;/);
  assert.match(watcher, /const IMAGE_ATTEMPT_LEASE_MS = 75_000;/);
  // Fresh-connection transport; the session loop supplies retries/backoff, so
  // each call is a single bounded attempt clipped to the session deadline.
  assert.match(watcher, /fetchCapmaFresh\(CAPMA_AFTN_URL/);
  assert.match(
    watcher,
    /Math\.max\(1, Math\.min\(REQUEST_TIMEOUT_MS, remainingMs\)\)/,
  );
  assert.match(watcher, /capmaImageFetchInFlight\(ctx, stationIcao\)/);
  assert.match(watcher, /imagePriorityDeferrals \+= 1/);
});

test("high-frequency AFTN requests yield to active TDZ image leases", () => {
  const active = { status: "fetching", lastAttemptAt: 1_000 };
  assert.equal(capmaImageCollectorInFlight(active, 60_999), true);
  assert.equal(capmaImageCollectorInFlight(active, 76_000), false);
  assert.equal(
    capmaImageCollectorInFlight({ ...active, status: "error" }, 2_000),
    false,
  );
  assert.equal(
    capmaImageCollectorInFlight(
      { status: "fetching", lastAttemptAt: undefined },
      2_000,
    ),
    false,
  );
});

test("fetch retry delay backs off exponentially and remains bounded", () => {
  assert.equal(mexicoRoutineWatchRetryDelayMs(1_000, 1), 15_000);
  assert.equal(mexicoRoutineWatchRetryDelayMs(1_000, 2), 30_000);
  assert.equal(mexicoRoutineWatchRetryDelayMs(1_000, 5), 30_000);
  assert.equal(mexicoRoutineWatchRetryDelayMs(1_000, 6), 30_000);
  assert.equal(mexicoRoutineWatchRetryDelayMs(1_000, 20), 30_000);
  assert.equal(mexicoRoutineWatchRetryDelayMs(1_000, 0), 15_000);
  assert.equal(mexicoRoutineWatchRetryDelayMs(20_000, 1), 20_000);
});
