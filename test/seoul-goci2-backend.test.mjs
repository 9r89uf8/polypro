import assert from "node:assert/strict";
import test from "node:test";
import { createBackendHarness, FLAG, NOMINAL, NOW } from "./fixtures/goci2BackendHarness.mjs";
import { fixtureKey } from "./fixtures/goci2Synthetic.mjs";

const MINUTE = 60_000, HOUR = 60 * MINUTE;
const DIRECTORY_KEY = "GOCI-II/2026/10/30/L1B_COMP/GK2_GC2_L1B_20261030_021530";

test("every collection, storage and display entry point is closed unless the flag is exactly true", async () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", " true", "true ", "yes"]) {
    const h = createBackendHarness(); h.env[FLAG] = flag;
    assert.deepEqual(await h.call("requestRefresh"), { queued: false, status: "approval_required" });
    assert.deepEqual(await h.call("queueScheduledRefresh", { stationIcao: "RKSI" }), { queued: false, status: "approval_required" });
    const view = await h.call("getLatest");
    assert.equal(view.approved, false); assert.equal(view.status, "approval_required");
    assert.deepEqual(view.frames, []); assert.equal(view.collector, null);
    assert.equal(await h.call("claimWorker", { runId: "RKSI:goci2:1" }), null);
    assert.equal(await h.call("checkWorker", { runId: "RKSI:goci2:1", workerToken: "t" }), false);
    assert.equal(await h.call("finishWorker", { runId: "RKSI:goci2:1", workerToken: "t" }).then(result => result.status), "approval_required");
    assert.equal((await h.call("recordSourceFailure", { runId: "r", workerToken: "t", directoryKey: DIRECTORY_KEY, error: "x" })).status, "approval_required");
    assert.equal(h.calls.reads, 0, "no database read before approval");
    assert.equal(h.calls.scheduled.length, 0, "no worker is scheduled");
    assert.equal(h.calls.urls.length, 0, "no storage URL is issued");
    h.upload("late-upload");
    assert.equal((await h.call("saveFrame", { runId: "r", workerToken: "t", frame: h.frame({ storageId: "late-upload" }) })).status, "approval_required");
    assert.equal(h.uploads.has("late-upload"), false, "a revoked worker's upload is deleted, not stored");
    assert.equal(h.tables.seoulGoci2Frames.length, 0);
  }
});

test("queue schedules one worker in daylight with cooldown, lease and hourly spacing", async () => {
  const h = createBackendHarness();
  h.setNow(Date.parse("2026-10-30T15:00:00Z"));
  assert.equal((await h.call("requestRefresh")).status, "outside_daylight");
  assert.equal(h.calls.reads, 0, "night refusal performs no database read");
  h.setNow(NOW);
  const owner = await h.claim();
  assert.equal(h.calls.scheduled[0].name, "seoulGoci2Node:collectLatest");
  assert.deepEqual(h.calls.scheduled[0].args, { runId: owner.runId });
  assert.equal((await h.call("queueScheduledRefresh")).status, "already_running");
  assert.equal(await h.call("claimWorker", { runId: owner.runId }), null, "one worker per run");
  assert.equal(await h.call("checkWorker", owner), true);
  assert.equal(await h.call("checkWorker", { ...owner, workerToken: "stale" }), false);
  assert.equal((await h.call("finishWorker", owner)).status, "idle");
  assert.equal((await h.call("requestRefresh")).status, "cooldown");
  h.setNow(NOW + 3 * MINUTE);
  const second = await h.claim();
  h.upload();
  assert.equal((await h.call("saveFrame", { ...second, frame: h.frame() })).stored, true);
  await h.call("finishWorker", second);
  h.setNow(NOW + 10 * MINUTE);
  assert.equal((await h.call("requestRefresh")).status, "waiting_for_next_observation", "an hourly slot cannot have a successor yet");
  h.setNow(Date.parse("2026-10-30T03:18:00Z"));
  assert.equal((await h.call("requestRefresh")).status, "queued");
  h.setNow(Date.parse("2026-10-30T03:24:00Z"));
  assert.equal(await h.call("checkWorker", { runId: h.status().activeRunId, workerToken: "x" }), false);
  assert.equal((await h.call("requestRefresh")).status, "queued", "an expired lease does not block forever");
});

test("frames save only with ownership, exact identity, plausible clocks and an owned 512 px PNG", async () => {
  const cases = {
    renderer: { rendererVersion: "rksi-goci2-truecolor-v0" }, slot: { slot: "S006" }, key: { sourceKey: fixtureKey().replace("_S007", "_S07") },
    nominal: { nominalTimeUtc: NOMINAL + HOUR }, future: { obsTimeUtc: NOW + MINUTE, observationEndUtc: NOW + 2 * MINUTE },
    expired: { obsTimeUtc: NOW - 25 * HOUR, observationStartUtc: NOW - 25 * HOUR, observationEndUtc: NOW - 25 * HOUR },
    longScan: { observationEndUtc: Date.parse("2026-10-30T02:40:00Z") }, missingHash: { imageSha256: "x" },
    sources: { sourceObjects: [] }, subset: { subset: { rowStart: 0, rowEnd: 2779, columnStart: 0, columnEnd: 2779, gridRows: 2780, gridColumns: 2780 } },
    okWithoutImage: { storageId: undefined }, width: { geometry: { width: 256, height: 256, spanKm: 100, centerLatitude: 37.4602, centerLongitude: 126.4407 } },
    span: { geometry: { width: 512, height: 512, spanKm: 50, centerLatitude: 37.4602, centerLongitude: 126.4407 } },
    center: { geometry: { width: 512, height: 512, spanKm: 100, centerLatitude: 37.5, centerLongitude: 126.4407 } },
    valid: { validFraction: 0.85 }, mime: {},
  };
  for (const [name, changes] of Object.entries(cases)) {
    const h = createBackendHarness(), owner = await h.claim();
    h.upload("candidate", name === "mime" ? { contentType: "image/png" } : {});
    const result = await h.call("saveFrame", { ...owner, frame: h.frame({ storageId: "candidate", ...changes }) });
    assert.equal(result.stored, false, name);
    assert.equal(h.tables.seoulGoci2Frames.length, 0, name);
    assert.equal(h.uploads.has("candidate"), ["mime", "okWithoutImage"].includes(name),
      `${name}: referenced owned uploads are cleaned; foreign or unreferenced ones are untouched`);
  }
  const h = createBackendHarness(), owner = await h.claim();
  h.upload("first");
  assert.deepEqual(await h.call("saveFrame", { ...owner, frame: h.frame({ storageId: "first" }) }), { stored: true, replaced: false, status: "ok" });
  assert.equal(h.status().lastSlot, "S007");
  h.upload("again");
  assert.equal((await h.call("saveFrame", { ...owner, frame: h.frame({ storageId: "again" }) })).status, "duplicate");
  assert.equal(h.uploads.has("again"), false);
  h.upload("superseded");
  assert.equal((await h.call("saveFrame", { ...owner, workerToken: "old", frame: h.frame({ storageId: "superseded" }) })).status, "superseded");
  assert.equal(h.uploads.has("superseded"), false);
});

test("public query shows approved frames with honest unavailable, failure, stale and daylight states", async () => {
  const h = createBackendHarness(), owner = await h.claim();
  assert.equal((await h.call("getLatest")).status, "collecting");
  h.upload();
  await h.call("saveFrame", { ...owner, frame: h.frame() });
  let view = await h.call("getLatest");
  assert.equal(view.approved, true); assert.equal(view.status, "ok");
  assert.equal(view.frames[0].url, "https://storage.test/image");
  assert.equal(view.frames[0].geometry.nativePixelSpacingKm.column, 0.259);
  assert.equal(view.latestObservedAt, Date.parse("2026-10-30T02:27:48Z"));
  await h.call("finishWorker", owner);
  h.setNow(Date.parse("2026-10-30T04:00:00Z"));
  assert.equal((await h.call("getLatest")).status, "stale", "92 minutes without a newer daylight image");
  const second = await h.claim();
  assert.equal((await h.call("recordSourceFailure", { ...second, directoryKey: "GOCI-II/2026/10/30/L1B_COMP/GK2_GC2_L1B_20261030_041530",
    error: "HTTP 503" })).status, "invalid_directory", "a failure for a future slot is rejected");
  await h.call("saveFrame", { ...second, frame: h.frame({ nominalTimeUtc: NOMINAL + HOUR, sourceKey: fixtureKey().replaceAll("021530", "031530"),
    obsTimeUtc: Date.parse("2026-10-30T03:27:48Z"), observationStartUtc: Date.parse("2026-10-30T03:27:16Z"),
    observationEndUtc: Date.parse("2026-10-30T03:28:20Z"), status: "unavailable", storageId: undefined, imageSha256: undefined,
    reason: "More than 10 percent of the airport view has missing, saturated or unlit GOCI-II pixels" }) });
  view = await h.call("getLatest");
  assert.equal(view.status, "unavailable");
  assert.equal(view.frames.length, 1, "the older good image remains; the rejected one is never shown");
  assert.match(view.unavailableReason, /10 percent/);
  const night = createBackendHarness();
  night.setNow(Date.parse("2026-10-30T15:00:00Z"));
  view = await night.call("getLatest");
  assert.deepEqual([view.status, view.daylightWindowOpen, view.frames.length], ["outside_daylight", false, 0]);
});

test("failures back off retries and are reported until a later frame succeeds", async () => {
  const h = createBackendHarness(), owner = await h.claim();
  assert.equal((await h.call("recordSourceFailure", { ...owner, directoryKey: DIRECTORY_KEY, error: "NOSC dods request returned HTTP 503." })).recorded, true);
  assert.equal((await h.call("recordSourceFailure", { ...owner, directoryKey: "GOCI-II/2026/10/30/L1B_COMP/../x", error: "x" })).status, "invalid_directory");
  assert.equal((await h.call("finishWorker", { ...owner, error: "NOSC dods request returned HTTP 503." })).status, "error");
  assert.match((await h.call("getLatest")).unavailableReason, /HTTP 503/);
  h.setNow(NOW + 5 * MINUTE);
  const retry = await h.claim();
  assert.deepEqual(retry.claim.backoffNominalTimes, [NOMINAL], "the failed directory is skipped for 30 minutes");
  h.setNow(NOW + 36 * MINUTE);
  await h.call("finishWorker", retry);
  const later = await h.claim();
  assert.deepEqual(later.claim.backoffNominalTimes, []);
  h.upload();
  await h.call("saveFrame", { ...later, frame: h.frame({ fetchedAt: h.now, capturedAt: h.now }) });
  assert.equal(h.status().sourceFailures.length, 0);
  assert.deepEqual((await h.call("claimWorker", { runId: later.runId })), null);
});

test("retention, orphan cleanup and an operator purge all work while access is not approved", async () => {
  const h = createBackendHarness();
  const owner = await h.claim();
  h.upload("kept");
  await h.call("saveFrame", { ...owner, frame: h.frame({ storageId: "kept" }) });
  h.tables.seoulGoci2Frames.push({ ...h.frame({ storageId: "expired", obsTimeUtc: NOW - 25 * HOUR }), _id: "old" });
  h.upload("expired"); h.upload("orphan", { _creationTime: NOW - 11 * MINUTE }); h.upload("fresh-orphan");
  h.upload("other-feature", { _creationTime: NOW - HOUR, contentType: "image/png; profile=rksi-himawari-loop-v2" });
  h.env[FLAG] = undefined;
  const pruned = await h.call("pruneExpiredFrames", { stationIcao: "RKSI" });
  assert.deepEqual([pruned.deleted, pruned.orphanUploadsDeleted], [1, 1]);
  assert.deepEqual([...h.uploads.keys()].sort(), ["fresh-orphan", "kept", "other-feature"]);
  assert.equal((await h.call("getLatest")).frames.length, 0, "stored images are hidden as soon as approval is absent");
  assert.deepEqual(await h.call("purgeStoredImages"), { deleted: 1, remaining: false });
  assert.equal(h.uploads.has("kept"), false);
  await h.call("deleteUploadIfUnreferenced", { storageId: "fresh-orphan" });
  assert.equal(h.uploads.has("fresh-orphan"), false);
});
