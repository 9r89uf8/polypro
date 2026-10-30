import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { PNG } from "pngjs";
import {
  decompressHimawariBzip, parseHimawariHsd, himawariNativePosition, himawariNativeCenter,
  himawariLineTime, himawariSolarGeometry, himawariInfraredTemperature, sampleHimawariPoint,
  renderHimawariRaster, decodeHimawariImage, encodeHimawariPng, himawariVisibleDisplayValue, MAX_HIMAWARI_EXPANDED_BYTES,
} from "../convex/lib/seoulHimawariImage.js";

const NOMINAL = Date.parse("2026-10-29T01:00:00Z");
const MJD_EPOCH = Date.UTC(1858, 10, 17);
const IR_CALIBRATION = { wavelengthMicrometers: 10.4074, validBits: 12,
  errorCount: 65535, outsideScanCount: 65534, gain: -0.0037525074318633814,
  offset: 15.197657722429469, c0: -0.118260812197365, c1: 1.00101143081895,
  c2: -1.80800453227613e-6, C0: 0.118211645089097, C1: 0.998989021775474,
  C2: 1.80702978762378e-6, speedOfLight: 299792458,
  planckConstant: 6.62606957e-34, boltzmannConstant: 1.3806488e-23 };
const PROJECTION = { subLon: 140.7, cfac: 81865099, lfac: 81865099, coff: 4300.5,
  loff: 9200.5, rsKm: 42164, aKm: 6378.137, bKm: 6356.7523 };
const bzip = value => Buffer.from(value, "base64");
const ABC = bzip("QlpoOTFBWSZTWWSMu3MAAAABADgAIAAhmBmEYXckU4UJBkjLtzA=");
const DEF = bzip("QlpoOTFBWSZTWUI8sPkAAAABAAcAIAAhmBmEYXckU4UJBCPLD5A=");

function key(channel = "infrared", nominal = NOMINAL) {
  const stamp = new Date(nominal).toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const band = channel === "visible" ? "B03" : "B13", resolution = channel === "visible" ? "05" : "20";
  return `AHI-L1b-Japan/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}/${stamp.slice(8)}/HS_H09_${stamp.slice(0, 8)}_${stamp.slice(8)}_${band}_JP01_R${resolution}_S0101.DAT.bz2`;
}

function fixture({ channel = "infrared", nominal = NOMINAL, bigEndian = false, pixel } = {}) {
  const lengths = [282, 50, 127, 139, 147, 3, 7, 41, 25, 7, 3];
  const header = lengths.reduce((a, b) => a + b, 0);
  const columns = channel === "visible" ? 6000 : 1500, lines = channel === "visible" ? 4800 : 1200;
  const bytes = Buffer.alloc(header + columns * lines * 2), blocks = {};
  const u16 = (position, value) => bigEndian ? bytes.writeUInt16BE(value, position) : bytes.writeUInt16LE(value, position);
  const u32 = (position, value) => bigEndian ? bytes.writeUInt32BE(value, position) : bytes.writeUInt32LE(value, position);
  const f32 = (position, value) => bigEndian ? bytes.writeFloatBE(value, position) : bytes.writeFloatLE(value, position);
  const f64 = (position, value) => bigEndian ? bytes.writeDoubleBE(value, position) : bytes.writeDoubleLE(value, position);
  let offset = 0;
  for (let i = 0; i < 11; i++) {
    blocks[i + 1] = offset; bytes[offset] = i + 1;
    (i === 9 ? u32 : u16)(offset + 1, lengths[i]); offset += lengths[i];
  }
  u16(3, 11); bytes[5] = bigEndian ? 1 : 0;
  bytes.write("Himawari-9", 6, "ascii"); bytes.write("JP01", 38, "ascii"); bytes.write("1.3", 82, "ascii");
  const start = (nominal + 15_000 - MJD_EPOCH) / 86400_000, end = start + 96_000 / 86400_000;
  f64(46, start); f64(54, end); f64(62, start + 240_000 / 86400_000);
  u32(70, header); u32(74, columns * lines * 2); bytes[80] = 77; bytes[81] = 1;
  let p = blocks[2]; u16(p + 3, 16); u16(p + 5, columns); u16(p + 7, lines); bytes[p + 9] = 0;
  p = blocks[3]; f64(p + 3, 140.7);
  u32(p + 11, channel === "visible" ? 81865099 : 20466275); u32(p + 15, channel === "visible" ? 81865099 : 20466275);
  f32(p + 19, channel === "visible" ? 4300.5 : 1075.5); f32(p + 23, channel === "visible" ? 9200.5 : 2300.5);
  f64(p + 27, 42164); f64(p + 35, 6378.137); f64(p + 43, 6356.7523);
  p = blocks[5]; u16(p + 3, channel === "visible" ? 3 : 13); f64(p + 5, channel === "visible" ? .63972 : IR_CALIBRATION.wavelengthMicrometers);
  u16(p + 13, channel === "visible" ? 11 : 12); u16(p + 15, 65535); u16(p + 17, 65534);
  f64(p + 19, channel === "visible" ? .3051037058823529 : IR_CALIBRATION.gain);
  f64(p + 27, channel === "visible" ? -6.102074117647058 : IR_CALIBRATION.offset);
  if (channel === "visible") {
    f64(p + 35, .00192798475658132); f64(p + 43, start - 1); f64(p + 51, .31089897); f64(p + 59, -6.21797943);
  } else {
    for (const [i, name] of ["c0", "c1", "c2", "C0", "C1", "C2", "speedOfLight", "planckConstant", "boltzmannConstant"].entries()) f64(p + 35 + i * 8, IR_CALIBRATION[name]);
  }
  p = blocks[7]; bytes[p + 3] = 1; bytes[p + 4] = 1; u16(p + 5, 1);
  p = blocks[8]; f64(p + 11, 0); u16(p + 19, 2); u16(p + 21, 1); u16(p + 31, lines);
  p = blocks[9]; u16(p + 3, 2); u16(p + 5, 1); f64(p + 7, start); u16(p + 15, lines); f64(p + 17, end);
  u16(blocks[10] + 5, 0);
  if (pixel) {
    for (let r = 0; r < lines; r++) for (let c = 0; c < columns; c++) u16(header + 2 * (r * columns + c), pixel(r, c));
  } else {
    const value = channel === "visible" ? 600 : 2806, pattern = Buffer.alloc(2);
    if (bigEndian) pattern.writeUInt16BE(value); else pattern.writeUInt16LE(value);
    bytes.fill(pattern, header);
  }
  return { bytes, blocks, header, u16, f32, f64, options: { key: key(channel, nominal), nominalTimeUtc: nominal, channel } };
}

test("bzip aggregate cap covers concatenated streams and rejects corruption/truncation", () => {
  assert.equal(decompressHimawariBzip(ABC, 3).toString(), "abc");
  assert.equal(decompressHimawariBzip(Buffer.concat([ABC, DEF]), 6).toString(), "abcdef");
  assert.throws(() => decompressHimawariBzip(Buffer.concat([ABC, DEF]), 5), /expanded size/);
  assert.throws(() => decompressHimawariBzip(ABC.subarray(0, -1)), /end marker/);
  assert.throws(() => decompressHimawariBzip(Buffer.concat([ABC, Buffer.from("bad")])), /end marker/);
  const corrupt = Buffer.from(ABC); corrupt[12] ^= 1;
  assert.throws(() => decompressHimawariBzip(corrupt, 10));
  assert.throws(() => decompressHimawariBzip(Buffer.alloc(40)), /signature/);
  assert.throws(() => decompressHimawariBzip(ABC, MAX_HIMAWARI_EXPANDED_BYTES + 1), /bound/);
});

test("object identity validates date, nominal JP timing, channel, resolution and exact scope", () => {
  const f = fixture();
  for (const options of [
    { ...f.options, nominalTimeUtc: NOMINAL + 1 }, { ...f.options, channel: "visible" },
    { ...f.options, key: f.options.key.replace("R20", "R05") },
    { ...f.options, key: f.options.key.replace("JP01", "JP02") },
    { ...f.options, key: f.options.key.replace("AHI-L1b-Japan", "AHI-L1b-FLDK") },
    { ...f.options, key: f.options.key.replaceAll("20261029", "20260230").replace("2026/10/29", "2026/02/30") },
  ]) assert.throws(() => parseHimawariHsd(f.bytes, options));
  assert.throws(() => decodeHimawariImage(Buffer.alloc(0), { ...f.options, channel: "unknown" }), /channel/);
});

test("strict header parser reads both endian orders with independent native IR calibration", () => {
  for (const bigEndian of [false, true]) {
    const f = fixture({ bigEndian }), h = parseHimawariHsd(f.bytes, f.options);
    assert.equal(h.lines, 1200); assert.equal(h.columns, 1500);
    const sample = sampleHimawariPoint(h, 37.4602, 126.4407);
    assert.equal(sample.row, 454); assert.equal(sample.column, 475); assert.equal(sample.count, 2806);
    assert.ok(Math.abs(sample.value - 258.573113661165) < 1e-9);
  }
  assert.equal(himawariInfraredTemperature(4095, IR_CALIBRATION), null);
});

test("identity, segmentation, flags, navigation, calibration and line timing fail closed", () => {
  const modifications = [
    f => { f.bytes[5] = 2; }, f => { f.bytes.write("Himawari-8", 6); },
    f => { f.bytes[78] = 1; }, f => { f.bytes[f.blocks[7] + 3] = 2; },
    f => f.f64(f.blocks[8] + 11, .01), f => f.f32(f.blocks[8] + 23, .01),
    f => f.u16(f.blocks[10] + 5, 1), f => f.u16(f.blocks[2] + 5, 1499),
    f => f.u16(f.blocks[5] + 3, 3), f => f.f64(f.blocks[5] + 19, NaN),
    f => f.f64(f.blocks[9] + 17, f.bytes.readDoubleLE(f.blocks[9] + 7) - 1),
    f => f.u16(f.blocks[9] + 15, 1), f => f.f64(46, 0), f => f.f64(62, 1e300),
    f => { f.bytes[f.blocks[4]] = 3; }, f => f.u16(f.blocks[5] + 1, 3),
  ];
  for (const modify of modifications) {
    const f = fixture(); modify(f);
    assert.throws(() => parseHimawariHsd(f.bytes, f.options));
  }
});

test("forward/inverse navigation and solar values agree with scalar Python reference", () => {
  const position = himawariNativePosition(PROJECTION, 37.4602, 126.4407);
  assert.equal(position.row, 1817); assert.equal(position.column, 1901);
  assert.ok(Math.abs(position.lineOneBased - 1818.3358904942588) < 1e-9);
  assert.ok(Math.abs(position.columnOneBased - 1902.4766909253262) < 1e-9);
  const center = himawariNativeCenter(PROJECTION, 1817, 1901);
  assert.ok(Math.abs(center.latitude - 37.46247973805283) < 1e-10);
  assert.ok(Math.abs(center.longitude - 126.43727358606006) < 1e-10);
  const solar = himawariSolarGeometry(1793318300260.083, 37.4602, 126.4407, PROJECTION);
  assert.ok(Math.abs(solar.solarElevationDeg - 20.90938347260393) < 1e-7);
});

test("row-time interpolation honors irregular brackets and never extrapolates", () => {
  const h = { lineTimes: [{ line: 1, mjd: 60000 }, { line: 10, mjd: 60000.01 }, { line: 30, mjd: 60000.05 }] };
  const atKnot = himawariLineTime(h, 9), middle = himawariLineTime(h, 19);
  assert.equal(atKnot.bracket[0], atKnot.bracket[1]);
  assert.ok(Math.abs(middle.time - (MJD_EPOCH + 60000.03 * 86400_000)) < .001);
  assert.throws(() => himawariLineTime(h, 30), /bracket/);
});

test("geographic raster is north-up/east-right and preserves exact centered overlay geometry", () => {
  for (const [axis, pixel, first, last] of [
    ["north", (r, c) => r < 454 ? 3000 : 2000, [128, 16], [128, 240]],
    ["west", (r, c) => c < 475 ? 3000 : 2000, [16, 128], [240, 128]],
  ]) {
    const f = fixture({ pixel }), image = renderHimawariRaster(parseHimawariHsd(f.bytes, f.options));
    assert.equal(image.status, "ok", axis);
    const shade = ([x, y]) => image.rgba[4 * (y * 256 + x)];
    assert.ok(shade(first) > shade(last), `${axis} must be on the expected side`);
    assert.deepEqual(image.geometry.centerMarkerFraction, { x: .5, y: .5 });
    assert.equal(image.geometry.spanKm, 100);
    assert.equal(image.geometry.orientation, "north-up");
    assert.equal(image.geometry.centerLatitude, 37.4602);
    assert.equal(image.geometry.centerLongitude, 126.4407);
    assert.ok(image.geometry.nativePixelSpacingKm.column > 2);
    assert.ok(image.geometry.nativePixelSpacingKm.row > 2.8);
    assert.ok(image.nativePixelsSampled < 256 * 256);
    assert.ok(Number.isInteger(image.observedAt));
    JSON.stringify({ ...image, rgba: undefined });
  }
});

test("invalid samples are distinct purple and more than ten percent makes a frame unavailable", () => {
  const small = fixture(), h = parseHimawariHsd(small.bytes, small.options);
  small.u16(small.header + 2 * (454 * 1500 + 475), 65535);
  const sparse = renderHimawariRaster(h);
  assert.equal(sparse.status, "ok"); assert.ok(sparse.validFraction < 1);
  let purple = 0;
  for (let p = 0; p < sparse.rgba.length; p += 4) {
    if (sparse.rgba[p] === 36 && sparse.rgba[p + 1] === 25 && sparse.rgba[p + 2] === 50) purple++;
  }
  assert.ok(purple > 0);
  const many = fixture({ pixel: (r, c) => c < 475 ? 65534 : 2806 });
  const unavailable = renderHimawariRaster(parseHimawariHsd(many.bytes, many.options));
  assert.equal(unavailable.status, "unavailable"); assert.ok(unavailable.validFraction < .9);
  assert.equal(unavailable.rgba, undefined);
});

test("visible updated calibration uses a fixed scale and refuses night without affecting IR", () => {
  const f = fixture({ channel: "visible" }), h = parseHimawariHsd(f.bytes, f.options);
  const sample = sampleHimawariPoint(h, 37.4602, 126.4407);
  const expected = (600 * .31089897 - 6.21797943) * .00192798475658132 / sample.cosZenith;
  assert.ok(Math.abs(sample.value - expected) < 1e-12);
  const day = renderHimawariRaster(h);
  assert.equal(day.status, "ok"); assert.equal(day.display.minimum, 0); assert.equal(day.display.maximum, null);
  assert.equal(day.display.toneCurve, "fixed rational contrast");
  assert.equal(day.display.contrastPivot, .22);
  h.lineTimes = h.lineTimes.map(row => ({ ...row, mjd: row.mjd + .5 }));
  const night = renderHimawariRaster(h);
  assert.equal(night.status, "unavailable"); assert.match(night.reason, /solar elevation/);
  assert.equal(night.rgba, undefined);
  const ir = fixture({ nominal: NOMINAL + 12 * 3600_000 });
  assert.equal(renderHimawariRaster(parseHimawariHsd(ir.bytes, ir.options)).status, "ok");
});

test("fixed visible enhancement separates midtones without frame-dependent contrast or clipping the bright range", () => {
  assert.equal(himawariVisibleDisplayValue(-.1), 0);
  assert.equal(himawariVisibleDisplayValue(0), 0);
  assert.ok(himawariVisibleDisplayValue(1) < himawariVisibleDisplayValue(1.1));
  assert.ok(himawariVisibleDisplayValue(1.1) < himawariVisibleDisplayValue(2));
  assert.ok(himawariVisibleDisplayValue(2) < 1);
  assert.equal(himawariVisibleDisplayValue(Number.MAX_VALUE), 1);
  assert.throws(() => himawariVisibleDisplayValue(NaN), /finite/);
  for (let i = 1; i <= 3000; i++) {
    assert.ok(himawariVisibleDisplayValue(i / 1000) > himawariVisibleDisplayValue((i - 1) / 1000));
  }
  const oldSeparation = Math.sqrt(.22) - Math.sqrt(.16);
  const newSeparation = himawariVisibleDisplayValue(.22) - himawariVisibleDisplayValue(.16);
  assert.ok(newSeparation > 2 * oldSeparation);
  assert.ok(himawariVisibleDisplayValue(.8) < himawariVisibleDisplayValue(.9));
});

test("PNG round trip preserves every display pixel including missing-data color", () => {
  const rgba = Buffer.alloc(256 * 256 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const shade = (i / 4) % 256;
    rgba.set([shade, shade, shade, 255], i);
  }
  rgba.set([36, 25, 50, 255], 4 * 300);
  const encoded = encodeHimawariPng(rgba), decoded = PNG.sync.read(encoded);
  assert.equal(decoded.width, 256); assert.equal(decoded.height, 256);
  assert.deepEqual(decoded.data, rgba);
  assert.throws(() => encodeHimawariPng(Buffer.alloc(100)), /size/);
});

// Optional local integration evidence: hashes and expected values come from
// independent Python Hsd navigation/calibration, not from this Node decoder.
// Raw public HSD files remain ignored; ordinary CI runs the synthetic tests.
const realCases = [
  { file: "../tmp/rksi-latest-view/HS_H09_20261029_2350_B03_JP04_R05_S0101.DAT.bz2",
    hash: "47bbf25fa6a603aa848a654d548a84cc9e2171b07424fd2a4f8c489bce243b8b", channel: "visible",
    key: "AHI-L1b-Japan/2026/10/29/2350/HS_H09_20261029_2350_B03_JP04_R05_S0101.DAT.bz2",
    nominal: Date.parse("2026-10-29T23:57:30Z"), observedAt: 1793318300260.083,
    count: 131, value: .18645782093093163, solar: 20.90938347260393 },
  { file: "../tmp/seoul-himawari-daylight-20261030/himawari9-b13-jp01-202610290100.DAT.bz2",
    hash: "882afb2fe60479f6686d68b849675221745c8ae8b16f6212c9a80e240c0ac391", channel: "infrared",
    key: key(), nominal: NOMINAL, observedAt: 1793235655340.482,
    count: 2806, value: 258.573113661165, solar: 30.12114922975276 },
];
for (const row of realCases) {
  const path = new URL(row.file, import.meta.url);
  test(`retained real ${row.channel} HSD agrees with Python and encodes losslessly`, { skip: !existsSync(path) }, () => {
    const compressed = readFileSync(path);
    assert.equal(createHash("sha256").update(compressed).digest("hex"), row.hash);
    const options = { key: row.key, nominalTimeUtc: row.nominal, channel: row.channel };
    const h = parseHimawariHsd(decompressHimawariBzip(compressed), options);
    const sample = sampleHimawariPoint(h, 37.4602, 126.4407);
    assert.equal(sample.count, row.count);
    assert.ok(Math.abs(sample.value - row.value) < 1e-8);
    const image = renderHimawariRaster(h);
    assert.equal(image.status, "ok");
    assert.ok(Math.abs(image.observedAt - row.observedAt) < 1);
    assert.ok(Math.abs(image.solarElevationDeg - row.solar) < 1e-7);
    const encoded = encodeHimawariPng(image.rgba);
    const decoded = PNG.sync.read(encoded);
    assert.equal(decoded.width, 256); assert.equal(decoded.height, 256);
    assert.deepEqual(decoded.data, image.rgba);
    assert.ok(encoded.length < 2 * 1024 * 1024);
  });
}
