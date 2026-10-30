import assert from "node:assert/strict";
import test from "node:test";
import { describeGoci2, goci2DayFrames, goci2FrameNotes, goci2RefreshMessage, GOCI2_MAX_FRAMES } from "../app/seoul/day/[date]/goci2SnapshotState.js";

const NOW = Date.parse("2026-10-30T12:00:00+09:00"), DATE = "2026-10-30", HOUR = 3_600_000;
const frame = (id, age, fields = {}) => ({ id, obsTimeUtc: NOW - age, nominalTimeUtc: NOW - age - 12 * 60_000, capturedAt: NOW - age + 15 * 60_000,
  url: `https://storage.example/${id}.png`, ...fields });
const data = (frames, fields = {}) => ({ stationIcao: "RKSI", approved: true, frames, daylightWindowOpen: true, collector: null, ...fields });
const live = { isLive: true };

test("approval-required payloads never yield frames, even if a payload carries some", () => {
  for (const approved of [false, undefined, "true", 1]) {
    const payload = data([frame("a", HOUR)], { approved });
    assert.deepEqual(goci2DayFrames(payload, NOW, { date: DATE }), []);
    const state = describeGoci2(payload, [], NOW, live);
    assert.equal(state.kind, "approval_required");
    assert.match(state.detail, /KHOA permission/);
    assert.match(state.detail, /Nothing is collected or shown/);
  }
});

test("only today's KST frames with safe URLs are listed, oldest first, one per hourly slot", () => {
  const midnight = Date.parse("2026-10-30T00:00:00+09:00");
  const rows = goci2DayFrames(data([frame("noon", 0), frame("ten", 2 * HOUR), frame("yesterday", NOW - midnight + 60_000),
    frame("future", -60_000), frame("bad-url", HOUR, { url: "javascript:alert(1)" }),
    frame("ten-older-capture", 2 * HOUR, { capturedAt: NOW - 3 * HOUR })]), NOW, { date: DATE });
  assert.deepEqual(rows.map(row => row.id), ["ten", "noon"]);
  assert.equal(rows[1].time, NOW);
  assert.deepEqual(goci2DayFrames(data([frame("noon", 0)]), NOW, { date: "2026-10-29" }), []);
  assert.deepEqual(goci2DayFrames(data([frame("noon", 0)]), NOW, { date: DATE, isToday: false }), []);
  assert.deepEqual(goci2DayFrames(data([frame("noon", 0)], { stationIcao: "KORD" }), NOW, { date: DATE }), []);
  const many = goci2DayFrames(data(Array.from({ length: 20 }, (_, i) => frame(`f${i}`, i * 10 * 60_000))), NOW, { date: DATE });
  assert.equal(many.length, GOCI2_MAX_FRAMES);
});

test("card states distinguish loading, history, daylight, collecting, stale, unavailable and errors honestly", () => {
  assert.equal(describeGoci2(undefined, [], null, live).kind, "loading");
  assert.equal(describeGoci2(data([]), [], NOW, { isLive: false }).kind, "not_live");
  assert.equal(describeGoci2(undefined, [], NOW, live).kind, "loading");
  assert.equal(describeGoci2(data([], { daylightWindowOpen: false }), [], NOW, live).kind, "outside_daylight");
  assert.equal(describeGoci2(data([], { collector: { inFlight: true } }), [], NOW, live).kind, "collecting");
  assert.equal(describeGoci2(data([], { collector: { status: "error" } }), [], NOW, live).kind, "error");
  assert.equal(describeGoci2(data([]), [], NOW, live).kind, "no_data");
  const reason = "More than 10 percent of the airport view has missing, saturated or unlit GOCI-II pixels";
  const unavailable = describeGoci2(data([], { unavailableReason: reason }), [], NOW, live);
  assert.deepEqual([unavailable.kind, unavailable.detail], ["unavailable", reason]);
  const fresh = goci2DayFrames(data([frame("a", 30 * 60_000)]), NOW, { date: DATE });
  assert.equal(describeGoci2(data(fresh), fresh, NOW, live).kind, "ready");
  const old = goci2DayFrames(data([frame("a", 90 * 60_000)]), NOW, { date: DATE });
  assert.equal(describeGoci2(data(old), old, NOW, live).kind, "stale");
  assert.equal(describeGoci2(data(old, { daylightWindowOpen: false }), old, NOW, live).kind, "ready", "no delay is claimed after daylight");
  const withReason = describeGoci2(data(fresh, { unavailableReason: reason }), fresh, NOW, live);
  assert.deepEqual([withReason.kind, withReason.detail], ["unavailable", reason], "a newer rejection is shown next to the older image");
});

test("frame notes state native resolution, low sun, glint and age without overstating detail", () => {
  const [row] = goci2DayFrames(data([frame("a", 2 * HOUR, { solarElevationDeg: 14.6,
    geometry: { nativePixelSpacingKm: { column: 0.2591, row: 0.3598 } }, display: { lowSun: true, minimumGlintAngleDeg: 18 } })]), NOW, { date: DATE });
  const notes = goci2FrameNotes(row, NOW);
  assert.match(notes[0], /0\.26 × 0\.36 km/);
  assert.match(notes[0], /does not add detail/);
  assert.match(notes[1], /15° elevation/);
  assert.match(notes[2], /glint/);
  assert.match(notes[3], /120 minutes ago/);
  assert.deepEqual(goci2FrameNotes(null, NOW), []);
  assert.equal(goci2RefreshMessage("approval_required"), "GOCI-II access is not approved.");
  assert.match(goci2RefreshMessage("unexpected"), /New images appear automatically/);
});
