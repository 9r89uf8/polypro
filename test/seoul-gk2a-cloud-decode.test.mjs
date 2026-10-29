import assert from "node:assert/strict";
import test from "node:test";
import {
  goodDigitalCount, infraredBrightnessTemperature, normalizedVisibleReflectance,
  parseGk2aTime, createGrid,
} from "../convex/lib/seoulGk2aCloudDecode.js";

const IR_GAIN = -0.0198196955025196, IR_OFFSET = 161.580139160156;

test("IR105 agrees with independent NMSC v3.0 workbook values", () => {
  // Calibration Table_WN AH3003/AH6003, official v3.0 workbook:
  // https://nmsc.kma.go.kr/homepage/json/base/bbs/selectAtchFile.do?attachFileUsq=40092&refTbUsq=200057
  assert.ok(Math.abs(infraredBrightnessTemperature(3000, IR_GAIN, IR_OFFSET) - 297.968566) < 0.001);
  assert.ok(Math.abs(infraredBrightnessTemperature(6000, IR_GAIN, IR_OFFSET) - 251.239109) < 0.001);
  assert.equal(infraredBrightnessTemperature(9000, IR_GAIN, IR_OFFSET), null);
  assert.equal(infraredBrightnessTemperature(NaN, IR_GAIN, IR_OFFSET), null);
});

test("VI006 stays fractional and corrects solar illumination without becoming sunlight", () => {
  // Same workbook F1569/G1569: DN1566 -> 236.310712636 radiance -> 0.454776185 reflectivity.
  const gain = 0.154856294393539, offset = -6.19424438476562, coefficient = 0.001924484;
  assert.ok(Math.abs(normalizedVisibleReflectance(1566, gain, offset, coefficient, 1) - 0.454776185) < 1e-8);
  assert.ok(Math.abs(normalizedVisibleReflectance(1566, gain, offset, coefficient, 0.5) - 0.90955237) < 1e-8);
  assert.equal(normalizedVisibleReflectance(1566, gain, offset, coefficient, 0.2), null);
  assert.equal(normalizedVisibleReflectance(0, gain, offset, coefficient, 0.8), null);
  assert.equal(normalizedVisibleReflectance(4095, gain, offset, coefficient, 0.4), null);
});

test("conditionally usable, out-of-scan, error and malformed counts are rejected", () => {
  assert.equal(goodDigitalCount(1566, 12), 1566);
  assert.equal(goodDigitalCount(0x1000 | 1566, 12), 1566);
  assert.equal(goodDigitalCount(6000, 13), 6000);
  for (const flag of [1, 2, 3]) assert.equal(goodDigitalCount((flag << 14) | 1566, 12), null);
  for (const value of [-1, 65536, 1566.5, NaN]) assert.equal(goodDigitalCount(value, 12), null);
});

test("satellite clocks reject calendar rollovers and invalid compact timestamps", () => {
  assert.equal(parseGk2aTime("20261029_012655"), Date.parse("2026-10-29T01:26:55Z"));
  assert.equal(parseGk2aTime("202610290126"), Date.parse("2026-10-29T01:26:00Z"));
  assert.equal(parseGk2aTime("202602300126"), null);
  assert.equal(parseGk2aTime("202610292426"), null);
  assert.equal(parseGk2aTime("20261029012699"), null);
});

function attribute(value) { return { value: typeof value === "number" ? [value] : value }; }
function fixture() {
  // Actual NOAA VI006 LA navigation metadata from the 2026-10-29 01:26 frame.
  const attrs = Object.fromEntries(Object.entries({
    satellite_name: "GK-2A", instrument_name: "AMI", observation_mode: "LA", projection_type: "GEOS",
    calibration_table_version: "v.3.0_20190415", earth_equatorial_radius: 6378137,
    earth_polar_radius: 6356752.3, nominal_satellite_height: 42164000, sub_longitude: 2.2375121010567303,
    image_upperleft_x: -0.017565999965399502, image_upperleft_y: 0.11698099723386765,
    DN_to_Radiance_Gain: 0.154856294393539, DN_to_Radiance_Offset: -6.19424438476562,
    Radiance_to_Albedo_c: 0.001924484,
  }).map(([key, value]) => [key, attribute(value)]));
  const values = new Uint16Array(2000 * 2000);
  for (let r = 953; r <= 955; r++) for (let c = 954; c <= 956; c++) values[r * 2000 + c] = 1566;
  const dataset = { shape: [2000, 2000], value: values, attrs: Object.fromEntries(Object.entries({
    channel_name: "VI006", number_of_valid_bits_per_pixel: 12, number_of_data_quality_flag_bits_per_pixel: 2,
    ground_sample_distance_ew: 0.000014, ground_sample_distance_ns: 0.000014,
  }).map(([key, value]) => [key, attribute(value)])) };
  return { attrs, get: (name) => name === "image_pixel_values" ? dataset : null, dataset };
}

test("per-file local-area geometry reaches the known RKSI pixel and rejects other regions", () => {
  const file = fixture(), grid = createGrid(file, "VI006");
  assert.equal(grid.cell(37.4602, 126.4407), 1566);
  assert.equal(grid.cell(0, 0), null);
  assert.equal(grid.cell(25.98, 124.8), null);
  file.attrs.calibration_table_version = attribute("unknown-version");
  assert.throws(() => createGrid(file, "VI006"), /Unsupported/);
});

test("insufficient good visible neighbors and incomplete arrays cannot produce a sample", () => {
  const file = fixture();
  for (const [row, col] of [[953, 954], [953, 955], [953, 956]]) file.dataset.value[row * 2000 + col] = 65535;
  assert.equal(createGrid(file, "VI006").cell(37.4602, 126.4407), null);
  file.dataset.value = new Uint16Array(20);
  assert.throws(() => createGrid(file, "VI006"), /Incomplete/);
});
