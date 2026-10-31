import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { earthSunDistanceAu, encodeGoci2Png, fitGoci2Navigation, goci2DisplayValue, goci2Geometry, goci2Metadata, goci2Window,
  GOCI2_REFERENCE_F0, locateGoci2, parseGoci2Time, rayleighCorrectedReflectance, rayleighOpticalDepth, rayleighSphericalAlbedo,
  renderGoci2TrueColor } from "../convex/lib/seoulGoci2Image.js";
import { decodeDapArray, goci2Hyperslab, parseDapDas, parseDapDds } from "../convex/lib/seoulGoci2Source.js";
import { FIXTURE_NOMINAL, fixtureDas, fixtureDds, fixtureDods } from "./fixtures/goci2Synthetic.mjs";

// All arrays below come from the SYNTHETIC fixture grid and scene.
function download(variable, type, rows, columns, options) {
  const hyperslab = goci2Hyperslab(variable, rows, columns);
  return decodeDapArray(new Uint8Array(fixtureDods(hyperslab, options)), { variable, type, shape: hyperslab.shape });
}
function metadata(das = fixtureDas(), dds = fixtureDds()) { return goci2Metadata(parseDapDas(das), parseDapDds(dds), FIXTURE_NOMINAL); }
function coarseLocation(slot = "S007") {
  const range = { start: 0, stride: 39, stop: 2779 }, axis = Array.from({ length: 72 }, (_, i) => i * 39);
  return locateGoci2(download("/navigation_data/latitude", "Float32", range, range, { slot }),
    download("/navigation_data/longitude", "Float32", range, range, { slot }), axis, axis, null);
}
let cached;
function scene({ fill, meta = metadata() } = {}) {
  cached ??= (() => {
    const window = goci2Window(coarseLocation(), 2780, 2780);
    const rows = { start: window.rowStart, stride: 1, stop: window.rowEnd }, columns = { start: window.columnStart, stride: 1, stop: window.columnEnd };
    return { window, rows, columns, latitude: download("/navigation_data/latitude", "Float32", rows, columns),
      longitude: download("/navigation_data/longitude", "Float32", rows, columns),
      counts: Object.fromEntries([443, 555, 660].map(band => [band, download(`/geophysical_data/L_TOA_${band}`, "UInt32", rows, columns)])) };
  })();
  const counts = fill ? Object.fromEntries([443, 555, 660].map(band => [band,
    download(`/geophysical_data/L_TOA_${band}`, "UInt32", cached.rows, cached.columns, { fill })])) : cached.counts;
  return { window: cached.window, latitude: cached.latitude, longitude: cached.longitude, counts, metadata: meta };
}
const pixel = (rgba, x, y) => [...rgba.subarray(4 * (y * 512 + x), 4 * (y * 512 + x) + 3)];

test("metadata supplies observation clocks, grid, scaling, units and F0 source; contradictions fail closed", () => {
  const meta = metadata();
  assert.equal(meta.observationStartUtc, Date.parse("2026-10-30T02:27:16Z"));
  assert.equal(meta.observedAt, Date.parse("2026-10-30T02:27:48Z"));
  assert.deepEqual([meta.gridRows, meta.gridColumns], [2780, 2780]);
  assert.deepEqual(meta.bands[660], { variable: "/geophysical_data/L_TOA_660", scaleFactor: 9.999999975e-7, addOffset: 0, fillValue: 4294967295,
    validMin: 0, validMax: 1e9, f0: GOCI2_REFERENCE_F0[660], f0Source: "reference" });
  assert.equal(metadata(fixtureDas({ nested: true })).observedAt, meta.observedAt, "NC_GLOBAL and H5_GLOBAL both supply the clocks");
  assert.equal(metadata(fixtureDas({ f0Attribute: { name: "F0" } })).bands[443].f0Source, "file:F0");
  assert.equal(metadata(fixtureDas({ f0Attribute: { name: "solar_irradiance", scale: 0.1 } })).bands[555].f0, 1840, "mW cm-2 µm-1 accepted");
  assert.throws(() => metadata(fixtureDas({ f0Attribute: { name: "F0", scale: 1.5 } })), /solar-irradiance/);
  assert.equal(parseGoci2Time("2026-10-30T02:27:16.5Z"), Date.parse("2026-10-30T02:27:16Z"));
  for (const [das, dds, pattern] of [
    [fixtureDas({ units: "mW cm-2 um-1 sr-1" }), fixtureDds(), /units/], [fixtureDas({ units: "W m-2 nm-1 sr-1" }), fixtureDds(), /units/],
    [fixtureDas({ start: "20261030_032716", end: "20261030_032820" }), fixtureDds(), /slot directory/],
    [fixtureDas({ end: "20261030_023500" }), fixtureDds(), /observation clock/], [fixtureDas({ start: "bad" }), fixtureDds(), /observation clock/],
    [fixtureDas(), fixtureDds("S007", { omit: 555 }), /555 nm/], [fixtureDas().replaceAll("9.999999975e-07", "0.0"), fixtureDds(), /scaling/],
    [fixtureDas().replace("Float32 scale_factor 1.;", "Float32 scale_factor 0.01;"), fixtureDds(), /scaled navigation/],
  ]) assert.throws(() => metadata(das, dds), pattern);
});

test("strided navigation locates RKSI at the measured S007 position and bounds a complete window", () => {
  const location = coarseLocation();
  assert.ok(Math.abs(location.row - 541) < 0.25 && Math.abs(location.column - 1449) < 0.25);
  assert.ok(Math.abs(location.columnSpacingKm - 0.26) < 0.01 && Math.abs(location.rowSpacingKm - 0.36) < 0.01);
  const window = goci2Window(location, 2780, 2780);
  assert.ok(window.rowStart > 350 && window.rowEnd < 730 && window.columnStart > 1200 && window.columnEnd < 1700);
  assert.ok((window.rowEnd - window.rowStart + 1) * (window.columnEnd - window.columnStart + 1) < 420 * 520);
  const elsewhere = coarseLocation("S006");
  assert.equal(elsewhere.inside, false, "a slot that does not contain RKSI is never extrapolated");
  assert.equal(goci2Window(elsewhere, 2780, 2780), null);
  // Regression (2026-10-31): NOSC's S000 lies about 24–31° N, 136–144° E, and
  // the first live search threw "no valid navigation in sample" on it instead
  // of moving on to S007.
  for (const slot of ["S000", "S005"]) {
    const range = { start: 0, stride: 1389, stop: 2779 }, axis = [0, 1389, 2778];
    const probe = locateGoci2(download("/navigation_data/latitude", "Float32", range, range, { slot }),
      download("/navigation_data/longitude", "Float32", range, range, { slot }), axis, axis, -999);
    assert.equal(probe.inside, false, slot);
    assert.match(probe.reason, /outside this slot|navigation/, slot);
  }
  const nothing = locateGoci2(new Float32Array(9).fill(-999), new Float32Array(9).fill(-999), [0, 1389, 2778], [0, 1389, 2778], -999);
  assert.deepEqual(nothing, { inside: false, reason: "no valid navigation in sample" });
  assert.equal(goci2Window({ ...location, toGrid: (x, y) => location.toGrid(x, y).map((value, axis) => axis ? value + 1300 : value) }, 2780, 2780), null,
    "a square clipped by the slot edge is rejected rather than partly rendered");
});

test("cubic navigation reproduces every native lat/lon pair and rejects non-grid coordinates", () => {
  const { window, latitude, longitude } = scene(), rows = window.rowEnd - window.rowStart + 1, columns = window.columnEnd - window.columnStart + 1;
  const fit = fitGoci2Navigation(latitude, longitude, rows, columns, -999);
  assert.ok(fit.maxResidualPx < 0.01, `residual ${fit.maxResidualPx}`);
  const [row, column] = fit.toGrid(0, 0);
  assert.ok(Math.abs(window.rowStart + row - 541) < 0.01 && Math.abs(window.columnStart + column - 1449) < 0.01);
  const shuffled = Float32Array.from(latitude); shuffled[Math.floor(shuffled.length / 2)] += 0.05;
  assert.throws(() => fitGoci2Navigation(shuffled, longitude, rows, columns, -999), /smooth native grid/);
});

test("radiance → reflectance uses F0, Earth–Sun distance, solar zenith and an approximate Rayleigh inversion", () => {
  assert.ok(Math.abs(rayleighOpticalDepth(443) - 0.2361) < 0.0005 && Math.abs(rayleighOpticalDepth(660) - 0.0464) < 0.0005);
  assert.ok(Math.abs(earthSunDistanceAu(Date.parse("2026-01-04T00:00:00Z")) - 0.9833) < 0.0005);
  assert.ok(Math.abs(earthSunDistanceAu(Date.parse("2026-07-04T00:00:00Z")) - 1.0167) < 0.0005);
  const albedo = rayleighSphericalAlbedo(rayleighOpticalDepth(443));
  assert.ok(albedo > 0.15 && albedo < 0.2, "single-scattering spherical albedo is a fraction of τ");
  const geometry = goci2Geometry(Date.parse("2026-10-30T02:27:48Z"), 37.4602, 126.4407);
  assert.ok(geometry.solarElevationDeg > 37 && geometry.solarElevationDeg < 39);
  assert.ok(Math.abs(Math.acos(geometry.cosView) * 180 / Math.PI - 43.5) < 0.3, "GK-2B view zenith at RKSI (measured 43.5° for 128.2° E)");
  assert.ok(geometry.cosScattering < 0, "backscatter geometry");
  const tau = rayleighOpticalDepth(443);
  assert.ok(rayleighCorrectedReflectance(0.2, tau, albedo, geometry) < 0.1, "blue haze over dark sea is mostly removed");
  assert.equal(goci2DisplayValue(-0.1), 0);
  assert.equal(goci2DisplayValue(1.1), 1);
  assert.equal(goci2DisplayValue(5), 1);
  for (let i = 1; i <= 110; i++) assert.ok(goci2DisplayValue(i / 100) > goci2DisplayValue((i - 1) / 100));
});

test("true-colour raster is north-up, east-right, 512 cells per 100 km and recovers the synthetic scene", () => {
  const image = renderGoci2TrueColor(scene());
  assert.equal(image.status, "ok");
  assert.equal(image.validFraction, 1);
  assert.equal(image.geometry.width, 512);
  assert.ok(image.geometry.width / image.geometry.spanKm >= 4, "at least 400 cells per 100 km");
  assert.ok(Math.abs(image.geometry.nativePixelSpacingKm.column - 0.259) < 0.005 && Math.abs(image.geometry.nativePixelSpacingKm.row - 0.36) < 0.005);
  assert.ok(Math.abs(image.geometry.rksiSourcePosition.row - 541) < 0.01 && Math.abs(image.geometry.rksiSourcePosition.column - 1449) < 0.01);
  assert.equal(image.observedAt, Date.parse("2026-10-30T02:27:48Z"));
  const cloud = pixel(image.rgba, 256, 256 - 102), land = pixel(image.rgba, 256 + 154, 256), sea = pixel(image.rgba, 128, 400);
  assert.ok(cloud.every(value => Math.abs(value - 221) <= 2), `neutral white cloud ${cloud}`);
  assert.ok(land[0] > land[1] && land[1] > land[2], `land is warm-toned ${land}`);
  assert.ok(sea[2] > sea[0] && sea.every(value => value < 60), `sea is dark and bluish ${sea}`);
  assert.deepEqual(image.display.f0[660], { value: 1545, source: "reference" });
  assert.equal(image.display.red, 660);
  JSON.stringify({ ...image, rgba: undefined });
});

test("fill or saturated pixels are a distinct colour and more than ten percent makes the frame unavailable", () => {
  const sparse = renderGoci2TrueColor(scene({ fill: (row, column) => row === 541 && column >= 1440 && column <= 1460 }));
  assert.equal(sparse.status, "ok");
  assert.ok(sparse.validFraction < 1 && sparse.validFraction > 0.99);
  const purple = [...Array(512 * 512).keys()].filter(index => sparse.rgba[4 * index] === 36 && sparse.rgba[4 * index + 1] === 25 && sparse.rgba[4 * index + 2] === 50);
  assert.ok(purple.length > 0);
  const many = renderGoci2TrueColor(scene({ fill: (row, column, band) => band === 555 && column < 1449 }));
  assert.equal(many.status, "unavailable");
  assert.match(many.reason, /10 percent/);
  assert.equal(many.rgba, undefined);
});

test("low sun is an explicit unavailable state, never a dim or fabricated image", () => {
  const late = { ...metadata(), observedAt: Date.parse("2026-10-30T09:27:48Z"), observationStartUtc: Date.parse("2026-10-30T09:27:16Z"),
    observationEndUtc: Date.parse("2026-10-30T09:28:20Z") };
  const result = renderGoci2TrueColor(scene({ meta: late }));
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /solar elevation of at least 10 degrees/);
  assert.equal(result.rgba, undefined);
});

test("PNG output is lossless 512 × 512 RGB and size-checked", () => {
  const image = renderGoci2TrueColor(scene()), encoded = encodeGoci2Png(image.rgba), decoded = PNG.sync.read(encoded);
  assert.equal(decoded.width, 512); assert.equal(decoded.height, 512);
  assert.deepEqual(decoded.data, image.rgba);
  assert.ok(encoded.length < 3 * 1024 * 1024);
  assert.throws(() => encodeGoci2Png(Buffer.alloc(16)), /raster size/);
});
