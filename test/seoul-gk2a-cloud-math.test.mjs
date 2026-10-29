import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_METHOD_VERSION, CLOUD_POINTS, cloudCollectionWindowOpen, solarGeometry, summarizeCloudTrend } from "../convex/lib/seoulGk2aCloudMath.js";

const MINUTE = 60_000;
const latestTime = Date.parse("2026-10-29T12:00:00+09:00");
const nowMs = latestTime + 2 * MINUTE;
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
function series({ visibleChange = 0.06, infraredChangeK = -3, offsets = [-6, -4, -2, 0], ids = CLOUD_POINTS.map(({ id }) => id), cellChange } = {}) {
  const span = offsets.at(-1) - offsets[0];
  return offsets.map((offset) => {
    const fraction = span ? (offset - offsets[0]) / span : 0;
    const obsTimeUtc = latestTime + offset * MINUTE;
    const acquisitionTimeUtc = obsTimeUtc + 15_000;
    const cells = ids.map((id) => {
      const changes = cellChange?.(id) ?? { visibleChange, infraredChangeK };
      return { id, reflectance: 0.4 + id * 0.0001 + fraction * changes.visibleChange,
        brightnessTempK: 280 + id * 0.01 + fraction * changes.infraredChangeK };
    });
    return { stationIcao: "RKSI", source: "noaa_gk2a_l1b", methodVersion: CLOUD_METHOD_VERSION,
      obsTimeUtc, acquisitionTimeUtc, solarElevationDeg: solarGeometry(acquisitionTimeUtc, 37.4602, 126.4407).solarElevationDeg,
      reflectance: 0.4 + fraction * visibleChange, brightnessTempK: 280 + fraction * infraredChangeK,
      validCellCount: cells.length, cells };
  });
}

test("fixed cells retain matched 2km ground locations, north-to-south and west-to-east", () => {
  assert.equal(CLOUD_POINTS.length, 25);
  assert.deepEqual(CLOUD_POINTS.map(({ id }) => id), Array.from({ length: 25 }, (_, id) => id));
  near(CLOUD_POINTS[12].latitude, 37.4602);
  near(CLOUD_POINTS[12].longitude, 126.4407);
  near((CLOUD_POINTS[0].latitude - CLOUD_POINTS[5].latitude) * 111.32, 2);
  near((CLOUD_POINTS[1].longitude - CLOUD_POINTS[0].longitude) * 111.32 * Math.cos(37.4602 * Math.PI / 180), 2);
  assert.ok(CLOUD_POINTS[0].latitude > CLOUD_POINTS[24].latitude);
  assert.ok(CLOUD_POINTS[0].longitude < CLOUD_POINTS[24].longitude);
});

test("solar geometry agrees with equinox sunrise, equator noon and Seoul solar noon", () => {
  const sunrise = solarGeometry(Date.parse("2026-03-20T06:08:00Z"), 0, 0);
  near(sunrise.solarElevationDeg, 0, 0.6);
  near(sunrise.azimuthDeg, 90, 0.7);
  const noon = solarGeometry(Date.parse("2026-03-20T12:08:00Z"), 0, 0);
  assert.ok(noon.solarElevationDeg > 89);
  const seoulNoon = solarGeometry(Date.parse("2026-10-29T12:20:00+09:00"), 37.4602, 126.4407);
  near(seoulNoon.solarElevationDeg, 39.5, 0.5);
  near(seoulNoon.azimuthDeg, 180, 1);
  near(seoulNoon.cosZenith, Math.sin(seoulNoon.solarElevationDeg * Math.PI / 180));
});

test("glint uses the reflected ray and geometric GK2A view, with invalid geometry unavailable", () => {
  const glint = solarGeometry(Date.parse("2026-03-20T03:35:00Z"), 0, 128.2);
  assert.ok(glint.solarElevationDeg > 89);
  assert.ok(glint.glintAngleDeg < 1);
  const seoul = solarGeometry(latestTime, 37.4602, 126.4407);
  assert.ok(seoul.glintAngleDeg > 90);
  assert.equal(solarGeometry(latestTime, 0, 0).glintAngleDeg, null); // GK2A below the local horizon.
  for (const [time, lat, lon] of [[NaN, 37, 126], [1e30, 37, 126], [latestTime, 91, 126], [latestTime, 37, 181]]) {
    assert.deepEqual(solarGeometry(time, lat, lon), { solarElevationDeg: null, cosZenith: null, azimuthDeg: null, glintAngleDeg: null });
  }
});

test("collection window rejects night, low sun and invalid clocks", () => {
  assert.equal(cloudCollectionWindowOpen(nowMs), true);
  assert.equal(cloudCollectionWindowOpen(Date.parse("2026-10-29T07:00:00+09:00")), false);
  assert.equal(cloudCollectionWindowOpen(Date.parse("2026-10-29T23:00:00+09:00")), false);
  assert.equal(cloudCollectionWindowOpen(NaN), false);
  assert.equal(summarizeCloudTrend(series(), { nowMs: Date.parse("2026-10-29T23:00:00+09:00") }).state, "unavailable");
});

test("matched visible and infrared changes produce increasing, clearing and steady states", () => {
  for (const [visibleChange, infraredChangeK, state] of [[0.06, -3, "increasing"], [-0.06, 3, "clearing"], [0, 0, "steady"]]) {
    const result = summarizeCloudTrend(series({ visibleChange, infraredChangeK }), { nowMs });
    assert.equal(result.state, state);
    assert.equal(result.sampleCount, 4);
    assert.equal(result.coverageMinutes, 6);
    assert.equal(result.commonCellCount, 25);
    assert.equal(result.agreementFraction, 1);
    near(result.visibleChange, visibleChange);
    near(result.infraredChangeK, infraredChangeK);
  }
});

test("visible-only changes, conflicting bands and subthreshold changes remain uncertain", () => {
  for (const [visibleChange, infraredChangeK] of [[0.06, 0], [0.06, 3], [-0.06, -3], [0.039, -3], [0.06, -1.99], [0.03, -1.5]]) {
    assert.equal(summarizeCloudTrend(series({ visibleChange, infraredChangeK }), { nowMs }).state, "uncertain");
  }
});

test("inclusive trend thresholds tolerate arithmetic roundoff only", () => {
  for (const [visibleChange, infraredChangeK, state] of [[0.04, -2, "increasing"], [-0.04, 2, "clearing"], [0.02, 1, "steady"]]) {
    assert.equal(summarizeCloudTrend(series({ visibleChange, infraredChangeK }), { nowMs }).state, state);
  }
  assert.equal(summarizeCloudTrend(series({ visibleChange: 0.04 - 1e-7, infraredChangeK: -2 }), { nowMs }).state, "uncertain");
  assert.equal(summarizeCloudTrend(series({ visibleChange: 0.02, infraredChangeK: 1 + 1e-7 }), { nowMs }).state, "uncertain");
});

test("direction and steady states require paired agreement from at least 65% of common cells", () => {
  for (const agreeing of [16, 17]) {
    const rows = series({ cellChange: (id) => id < agreeing
      ? { visibleChange: 0.06, infraredChangeK: -3 }
      : { visibleChange: -0.06, infraredChangeK: 3 } });
    assert.equal(summarizeCloudTrend(rows, { nowMs }).state, agreeing === 17 ? "increasing" : "uncertain");
    const flat = series({ visibleChange: 0, infraredChangeK: 0, cellChange: (id) => id < agreeing
      ? { visibleChange: 0, infraredChangeK: 0 }
      : { visibleChange: 0.06, infraredChangeK: -3 } });
    assert.equal(summarizeCloudTrend(flat, { nowMs }).state, agreeing === 17 ? "steady" : "uncertain");
  }
});

test("trend expires at the nominal observation clock and never falls back behind invalid newest data", () => {
  assert.equal(summarizeCloudTrend(series(), { nowMs: latestTime + 12 * MINUTE }).state, "increasing");
  const stale = summarizeCloudTrend(series(), { nowMs: latestTime + 12 * MINUTE + 1 });
  assert.equal(stale.state, "unavailable");
  assert.equal(stale.reason, "stale");
  for (const change of [{ reflectance: 2 }, { brightnessTempK: 331 }, { solarElevationDeg: 19 },
    { acquisitionTimeUtc: latestTime - MINUTE - 1 }, { acquisitionTimeUtc: latestTime + 2 * MINUTE + 1 },
    { acquisitionTimeUtc: nowMs + 1 }, { obsTimeUtc: nowMs + 1 },
    { source: "image_proxy" }, { methodVersion: "rksi-vis-ir-v0" }]) {
    const rows = series({ offsets: [-8, -6, -4, -2, 0] });
    Object.assign(rows.at(-1), change);
    const result = summarizeCloudTrend(rows, { nowMs });
    assert.equal(result.state, "unavailable", JSON.stringify(change));
    assert.equal(result.reason, "invalid_latest");
    assert.equal(result.visibleChange, null);
  }
});

test("trailing segment allows one missed frame, but stops at long gaps, invalid rows and method switches", () => {
  assert.equal(summarizeCloudTrend(series({ offsets: [-8, -6, -2, 0] }), { nowMs }).state, "increasing");
  const gap = summarizeCloudTrend(series({ offsets: [-12, -10, -4, -2, 0] }), { nowMs });
  assert.equal(gap.state, "unavailable");
  assert.equal(gap.sampleCount, 3);
  for (const change of [{ methodVersion: "old" }, { source: "other" }, { validCellCount: 19 }]) {
    const rows = series({ offsets: [-10, -8, -6, -4, -2, 0] });
    Object.assign(rows[2], change);
    const result = summarizeCloudTrend(rows, { nowMs });
    assert.equal(result.state, "unavailable");
    assert.equal(result.sampleCount, 3);
  }
  const olderDifferentMethod = series({ offsets: [-8, -6, -4, -2, 0] });
  olderDifferentMethod[0].methodVersion = "old";
  assert.equal(summarizeCloudTrend(olderDifferentMethod, { nowMs }).sampleCount, 4);
});

test("history is bounded to twelve minutes from latest and requires four samples over six minutes", () => {
  const result = summarizeCloudTrend(series({ offsets: [-16, -14, -12, -10, -8, -6, -4, -2, 0] }), { nowMs });
  assert.equal(result.sampleCount, 7);
  assert.equal(result.coverageMinutes, 12);
  assert.equal(summarizeCloudTrend(series({ offsets: [-4, -2, 0] }), { nowMs }).state, "unavailable");
  assert.equal(summarizeCloudTrend(series({ offsets: [-3, -2, -1, 0] }), { nowMs }).state, "unavailable");
});

test("duplicate IDs or timestamps cannot inflate sample coverage", () => {
  const duplicate = series();
  duplicate.at(-1).cells[24].id = 0;
  assert.equal(summarizeCloudTrend(duplicate, { nowMs }).reason, "invalid_latest");
  const duplicateTime = series();
  duplicateTime.push(structuredClone(duplicateTime.at(-1)));
  assert.equal(summarizeCloudTrend(duplicateTime, { nowMs }).reason, "invalid_latest");
});

test("only valid common cell IDs can contribute, without treating missing or bad data as zero", () => {
  const sparse = series({ ids: Array.from({ length: 20 }, (_, id) => id) });
  assert.equal(summarizeCloudTrend(sparse, { nowMs }).state, "increasing");
  const shifting = series();
  for (let i = 0; i < shifting.length; i += 1) {
    shifting[i].cells = shifting[i].cells.filter(({ id }) => id !== i * 2 && id !== i * 2 + 1);
    shifting[i].validCellCount = 23;
  }
  const missing = summarizeCloudTrend(shifting, { nowMs });
  assert.equal(missing.state, "unavailable");
  assert.equal(missing.reason, "insufficient_common_cells");
  assert.equal(missing.commonCellCount, 17);
  assert.equal(missing.visibleChange, null);
  const badCell = series();
  badCell.at(-1).cells[0].reflectance = NaN;
  badCell.at(-1).validCellCount = 24;
  assert.equal(summarizeCloudTrend(badCell, { nowMs }).commonCellCount, 24);
  const outOfRange = series();
  outOfRange.at(-1).cells[0].id = 25;
  assert.equal(summarizeCloudTrend(outOfRange, { nowMs }).state, "unavailable");
  assert.equal(summarizeCloudTrend([], { nowMs }).state, "unavailable");
});

test("per-cell robust slopes resist a single temporal outlier and ignore input row/cell ordering", () => {
  const rows = series({ offsets: [-12, -10, -8, -6, -4, -2, 0] });
  for (const cell of rows[3].cells) { cell.reflectance = 1.4; cell.brightnessTempK = 160; }
  const result = summarizeCloudTrend(rows.reverse().map((row) => ({ ...row, cells: [...row.cells].reverse() })), { nowMs });
  assert.equal(result.state, "increasing");
  near(result.visibleChange, 0.06);
  near(result.infraredChangeK, -3);
});
