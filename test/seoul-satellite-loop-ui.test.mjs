import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_ANALYSIS_RECIPE, cloudAnalysisGuide, createLoopImagePool, formatLoopDate, formatLoopTime, isLiveLoopDate, isLoopNight, LOOP_WINDOW_MS,
  MAX_CHANNEL_FRAMES, missingLoopSlots, nextLoopFrame, recentLoopFrames, resolveLoopDisplay,
} from "../app/seoul/day/[date]/satelliteLoopState.js";

const NOW = Date.parse("2026-10-30T12:00:00+09:00");
const DATE = "2026-10-30";
const frame = (id, age = 0, fields = {}) => ({ id, channel: "visible", obsTimeUtc: NOW - age,
  nominalTimeUtc: NOW - age, capturedAt: NOW, url: `https://storage.example/${id}.jpg`, ...fields });
const data = (frames, fields = {}) => ({ stationIcao: "RKSI", enabled: true, frames, ...fields });
const recent = (frames, now = NOW, fields = {}) => recentLoopFrames(data(frames, fields), "visible", now, { date: DATE });

test("last-hour frames expire against the local clock without a subscription update", () => {
  const saved = data([frame("edge", LOOP_WINDOW_MS), frame("new", 1000), frame("future", -1)]);
  assert.deepEqual(recentLoopFrames(saved, "visible", NOW, { date: DATE }).map((r) => r.id), ["edge", "new"]);
  assert.deepEqual(recentLoopFrames(saved, "visible", NOW + 15000, { date: DATE }).map((r) => r.id), ["new", "future"]);
  assert.deepEqual(recentLoopFrames(saved, "visible", NOW + LOOP_WINDOW_MS + 15000, { date: DATE }), []);
});

test("historical, future, unknown station, disabled and unknown modes fail closed", () => {
  const saved = data([frame("a")]);
  for (const date of ["2026-10-29", "2026-10-31", "bad-date"]) {
    assert.equal(isLiveLoopDate(date, NOW), false);
    assert.deepEqual(recentLoopFrames(saved, "visible", NOW, { date }), []);
  }
  assert.deepEqual(recentLoopFrames(saved, "visible", NOW, { date: DATE, isToday: false }), []);
  assert.deepEqual(recentLoopFrames(saved, "visible", null, { date: DATE }), []);
  for (const enabled of [false, undefined, "true", 1]) assert.deepEqual(recent([frame("a")], NOW, { enabled }), []);
  assert.deepEqual(recent([frame("a")], NOW, { stationIcao: "KORD" }), []);
  assert.deepEqual(recentLoopFrames(saved, "radar", NOW, { date: DATE }), []);
});

test("midnight KST keeps the prior day's in-window image only on the current-day view", () => {
  const midnight = Date.parse("2026-10-30T00:00:00+09:00");
  const saved = data([frame("prior-day", 0, { obsTimeUtc: midnight - 60000, nominalTimeUtc: midnight - 60000 })]);
  assert.equal(recentLoopFrames(saved, "visible", midnight, { date: "2026-10-30" }).length, 1);
  assert.equal(recentLoopFrames(saved, "visible", midnight, { date: "2026-10-29" }).length, 0);
  assert.equal(formatLoopTime(midnight), "12:00:00 AM");
  assert.equal(formatLoopTime(NOW), "12:00:00 PM");
  assert.equal(formatLoopDate(midnight - 60000), "Oct 29, 2026");
});

test("frames are chronological, distinct by nominal slot, and keep channels separate", () => {
  const rows = recent([frame("new", 0), frame("old", 300000), frame("bad", 1000, { url: "javascript:alert(1)" }),
    frame("infrared", 150000, { channel: "infrared" }), frame("duplicate-old", 300000, { capturedAt: NOW - 1 })]);
  assert.deepEqual(rows.map((r) => r.id), ["old", "new"]);
  assert.equal(missingLoopSlots(rows), 1);
  assert.equal(recentLoopFrames(data([frame("ir", 1000, { channel: "infrared" })]), "infrared", NOW, { date: DATE }).length, 1);
});

test("cloud analysis is a distinct exact channel with the same live-hour and future boundaries", () => {
  const saved = data([frame("visible", 300000), frame("ir", 150000, { channel: "infrared" }),
    frame("rgb-old", LOOP_WINDOW_MS, { channel: "cloudAnalysis" }),
    frame("rgb-new", 1000, { channel: "cloudAnalysis" }),
    frame("rgb-future", -1, { channel: "cloudAnalysis" }),
    frame("wrong-case", 1000, { channel: "cloudanalysis" })]);
  const rows = recentLoopFrames(saved, "cloudAnalysis", NOW, { date: DATE });
  assert.deepEqual(rows.map((row) => row.id), ["rgb-old", "rgb-new"]);
  assert.ok(rows.every((row) => row.key.startsWith("cloudAnalysis:")));
  assert.deepEqual(recentLoopFrames(saved, "cloudanalysis", NOW, { date: DATE }), []);
  assert.deepEqual(recentLoopFrames(saved, "cloudAnalysis", NOW + LOOP_WINDOW_MS + 15000, { date: DATE }), []);
  assert.deepEqual(recentLoopFrames(saved, "cloudAnalysis", NOW, { date: "2026-10-29" }), []);
  assert.deepEqual(recentLoopFrames({ ...saved, enabled: false }, "cloudAnalysis", NOW, { date: DATE }), []);
});

test("an unavailable cloud-analysis bundle never substitutes visible or infrared images", () => {
  const saved = data([frame("visible", 1000), frame("ir", 1000, { channel: "infrared" })], {
    channels: { cloudAnalysis: { status: "unavailable", unavailableReason: "Matching source bands are missing." } },
  });
  assert.deepEqual(recentLoopFrames(saved, "cloudAnalysis", NOW, { date: DATE }), []);
  const daylight = frame("rgb", 300000, { channel: "cloudAnalysis", solarElevationDeg: 22 });
  saved.frames.push(daylight);
  saved.channels.cloudAnalysis.unavailableReason = "Daytime RGB requires sunlight.";
  assert.deepEqual(recentLoopFrames(saved, "cloudAnalysis", NOW, { date: DATE }).map((row) => row.id), ["rgb"]);
});

test("cloud guide uses only the displayed analysis frame's supported recipe and validated legend", () => {
  const display = { recipe: CLOUD_ANALYSIS_RECIPE, recipeLabel: "Named synthetic recipe fixture",
    legend: [{ color: "#ff9933", label: "Synthetic example A" }, { color: "#aabbcc", label: "Synthetic example B" }] };
  const rgb = frame("rgb", 1000, { channel: "cloudAnalysis", display });
  assert.deepEqual(cloudAnalysisGuide(rgb).legend, display.legend);
  assert.equal(cloudAnalysisGuide(rgb).recipeLabel, display.recipeLabel);
  assert.equal(cloudAnalysisGuide({ ...rgb, channel: "visible" }), null);
  assert.equal(cloudAnalysisGuide({ ...rgb, display: { ...display, recipe: "unknown-recipe" } }), null);
  assert.equal(cloudAnalysisGuide({ ...rgb, display: { ...display, legend: [] } }), null);
  assert.equal(cloudAnalysisGuide({ ...rgb, display: { ...display, legend: [{ color: "url(https://bad.test/)", label: "Bad" }] } }), null);
  assert.equal(cloudAnalysisGuide({ ...rgb, display: { ...display, legend: [{ color: "#ffffff", label: "" }] } }), null);
  assert.equal(cloudAnalysisGuide(null), null);
});

test("night messages require an explicit illumination rejection, not a general daytime quality failure", () => {
  const state = (unavailableReason) => ({ status: "unavailable", unavailableReason });
  assert.equal(isLoopNight("cloudAnalysis", state("Day Microphysics requires solar elevation of at least 10 degrees.")), true);
  assert.equal(isLoopNight("visible", state("Visible image requires solar elevation of at least 5 degrees")), true);
  assert.equal(isLoopNight("visible", state("Low solar elevation.")), true);
  assert.equal(isLoopNight("cloudAnalysis", { status: "night" }), true);
  assert.equal(isLoopNight("cloudAnalysis", state("More than 10 percent of the image lacks reliable daylight, synchronized bands or valid thermal separation.")), false);
  assert.equal(isLoopNight("cloudAnalysis", state("Missing B07 for the daylight band bundle.")), false);
  assert.equal(isLoopNight("infrared", state("Low solar elevation.")), false);
  assert.equal(isLoopNight("cloudAnalysis", undefined), false);
});

test("loading a selection holds a valid image with its own timestamp; expiry removes it", () => {
  const rows = recent([frame("old", 150000), frame("new", 1000)]);
  const [old, newest] = rows;
  const loading = resolveLoopDisplay(rows, { [old.key]: "loaded", [newest.key]: "loading" }, newest.key, old.key);
  assert.equal(loading.pending, true);
  assert.equal(loading.desired.time, newest.time);
  assert.equal(loading.displayed.time, old.time);
  const failed = resolveLoopDisplay(rows, { [old.key]: "loaded", [newest.key]: "failed" }, newest.key, old.key);
  assert.equal(failed.failed, true);
  assert.equal(failed.displayed.key, old.key);
  assert.deepEqual(resolveLoopDisplay([], { [old.key]: "loaded" }, newest.key, old.key).displayed, null);
});

test("playback advances only loaded images chronologically with an explicit end pause", () => {
  const rows = recent([frame("a", 900000), frame("b", 300000), frame("c", 1000)]);
  const loaded = resolveLoopDisplay(rows, { [rows[0].key]: "loaded", [rows[1].key]: "failed", [rows[2].key]: "loaded" }, null, null).loaded;
  assert.equal(nextLoopFrame(loaded, rows[0].key).frame.id, "c");
  assert.equal(nextLoopFrame(loaded, rows[0].key).delayMs, 700);
  assert.equal(nextLoopFrame(loaded, rows[2].key).frame.id, "a");
  assert.equal(nextLoopFrame(loaded, rows[2].key).delayMs, 1800);
  assert.equal(nextLoopFrame(loaded, rows[2].key, 2).delayMs, 900);
  assert.equal(nextLoopFrame(loaded, rows[0].key, 0.5).delayMs, 1400);
  assert.equal(nextLoopFrame([rows[0]], rows[0].key), null);
});

function loaderFixture(options = {}) {
  const images = [], snapshots = [], timers = new Map();
  let timerId = 0;
  const pool = createLoopImagePool({ createImage: () => {
    const image = { src: "", onload: null, onerror: null };
    images.push(image);
    return image;
  }, onChange: (value) => snapshots.push(value),
  setTimer: (fn) => { timers.set(++timerId, fn); return timerId; },
  clearTimer: (id) => timers.delete(id), ...options });
  return { pool, images, snapshots, timers, latest: () => snapshots.at(-1) };
}

test("preloader starts with the latest frames and never has more than two active loads", () => {
  const fixture = loaderFixture({ concurrency: 99 });
  const rows = recent([frame("a", 450000), frame("b", 300000), frame("c", 150000), frame("d", 1000)]);
  fixture.pool.setFrames(rows);
  assert.equal(fixture.images.length, 2);
  assert.equal(fixture.images[0].src, rows[3].url);
  assert.equal(fixture.images[1].src, rows[2].url);
  fixture.images[0].onload();
  assert.equal(fixture.images.length, 3);
  assert.equal(Object.values(fixture.latest()).filter((value) => value === "loading").length, 2);
  fixture.images[1].onerror();
  assert.equal(fixture.images.length, 4);
  assert.equal(fixture.latest()[rows[2].key], "failed");
  assert.equal(Object.values(fixture.latest()).filter((value) => value === "loading").length, 2);
  fixture.pool.destroy();
});

test("a hung image times out, remains a labelled failure, and retries only on request", () => {
  const fixture = loaderFixture();
  const rows = recent([frame("only", 1000)]);
  fixture.pool.setFrames(rows);
  const lateLoad = fixture.images[0].onload;
  [...fixture.timers.values()][0]();
  assert.equal(fixture.latest()[rows[0].key], "failed");
  assert.equal(fixture.images[0].src, "");
  fixture.pool.setFrames(rows);
  lateLoad();
  assert.equal(fixture.images.length, 1);
  assert.equal(fixture.latest()[rows[0].key], "failed");
  fixture.pool.retryFailed();
  assert.equal(fixture.images.length, 2);
  fixture.images[1].onload();
  assert.equal(fixture.latest()[rows[0].key], "loaded");
  fixture.pool.destroy();
});

test("expiry, channel changes and unmount cancel requests and every image timer", () => {
  const fixture = loaderFixture();
  const rows = recent([frame("old", 150000), frame("new", 1000)]);
  fixture.pool.setFrames(rows);
  const late = fixture.images.map((image) => image.onload);
  fixture.pool.setFrames([]);
  assert.deepEqual(fixture.latest(), {});
  assert.equal(fixture.timers.size, 0);
  assert.ok(fixture.images.every((image) => image.src === "" && image.onload === null && image.onerror === null));
  late.forEach((callback) => callback());
  assert.deepEqual(fixture.latest(), {});
  fixture.pool.setFrames(rows);
  const afterUnmount = fixture.images.at(-1).onerror;
  fixture.pool.destroy();
  const count = fixture.snapshots.length;
  afterUnmount();
  fixture.pool.retryFailed();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.snapshots.length, count);
});

test("image cache size remains bounded even if a malformed response contains excess frames", () => {
  const fixture = loaderFixture();
  const rows = Array.from({ length: 100 }, (_, index) => ({ key: String(index), url: `https://example.test/${index}.jpg` }));
  fixture.pool.setFrames(rows);
  assert.equal(Object.keys(fixture.latest()).length, MAX_CHANNEL_FRAMES);
  assert.equal(fixture.images.length, 2);
  assert.equal(fixture.images[0].src, rows.at(-1).url);
  fixture.pool.destroy();
});
