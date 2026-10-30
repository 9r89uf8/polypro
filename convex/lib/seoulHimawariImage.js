"use node";

import Bunzip from "seek-bzip";
import { PNG } from "pngjs";

// Offline Node-only renderer. These images show calibrated satellite texture;
// they are not cloud classifications, surface sunlight or temperature forecasts.
export const HIMAWARI_IMAGE_VERSION = "rksi-himawari-image-v2";
export const HIMAWARI_IMAGE_SIZE = 256;
export const HIMAWARI_IMAGE_SPAN_KM = 100;
export const MAX_HIMAWARI_COMPRESSED_BYTES = 24 * 1024 * 1024;
export const MAX_HIMAWARI_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_DECODE_MS = 30_000;
const RKSI = Object.freeze({ latitude: 37.4602, longitude: 126.4407 });
const MJD_EPOCH_MS = Date.UTC(1858, 10, 17);
const DAY_MS = 86_400_000;
const MIN_VISIBLE_ELEVATION = 5;
const MIN_VISIBLE_COSINE = Math.sin(MIN_VISIBLE_ELEVATION * Math.PI / 180);
const INVALID_RGB = Object.freeze([36, 25, 50]);
const VISIBLE_CONTRAST_PIVOT = 0.22;
const radians = value => value * Math.PI / 180;
const degrees = value => value * 180 / Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = value => typeof value === "number" && Number.isFinite(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(`Himawari: ${message}`); };
const mjdToMs = value => MJD_EPOCH_MS + value * DAY_MS;

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new Error("Himawari: expected binary bytes");
}

// seek-bzip checks CRCs but can stop on EOF immediately after an output block.
// Require the final stream's complete 48-bit end marker, 32-bit CRC and 0–7
// zero padding bits as well, so a block-boundary truncation cannot pass.
function hasBzipEndMarker(bytes) {
  let tail = 0n;
  for (const byte of bytes.subarray(Math.max(0, bytes.length - 11))) tail = (tail << 8n) | BigInt(byte);
  const mask48 = (1n << 48n) - 1n;
  for (let padding = 0n; padding <= 7n; padding++) {
    if (((tail >> (padding + 32n)) & mask48) === 0x177245385090n &&
        (tail & ((1n << padding) - 1n)) === 0n) return true;
  }
  return false;
}

export function decompressHimawariBzip(bytes, maxExpandedBytes = MAX_HIMAWARI_EXPANDED_BYTES) {
  bytes = asBuffer(bytes);
  requireValue(bytes.length >= 14 && bytes.length <= MAX_HIMAWARI_COMPRESSED_BYTES, "compressed size is outside bounds");
  requireValue(bytes.toString("ascii", 0, 3) === "BZh" && bytes[3] >= 49 && bytes[3] <= 57, "invalid bzip signature");
  requireValue(Number.isInteger(maxExpandedBytes) && maxExpandedBytes > 0 &&
    maxExpandedBytes <= MAX_HIMAWARI_EXPANDED_BYTES, "invalid expansion bound");
  requireValue(hasBzipEndMarker(bytes), "missing complete bzip end marker");
  const output = Buffer.allocUnsafe(maxExpandedBytes);
  let inputOffset = 0, outputOffset = 0, streams = 0;
  const deadline = Date.now() + MAX_DECODE_MS;
  const checkDeadline = () => requireValue(Date.now() <= deadline, "decompression time limit exceeded");
  const input = {
    readByte() {
      if ((inputOffset & 0xffff) === 0) checkDeadline();
      requireValue(inputOffset < bytes.length, "truncated bzip input");
      return bytes[inputOffset++];
    },
    read(destination, offset, length) {
      requireValue(++streams <= 2048, "too many bzip streams");
      const count = Math.min(length, bytes.length - inputOffset);
      bytes.copy(destination, offset, inputOffset, inputOffset + count);
      inputOffset += count;
      return count;
    },
    eof() { return inputOffset >= bytes.length; },
  };
  const sink = { writeByte(byte) {
    requireValue(outputOffset < maxExpandedBytes, "expanded size exceeds bound");
    if ((outputOffset & 0xffff) === 0) checkDeadline();
    output[outputOffset++] = byte;
  } };
  // HSD objects can contain concatenated bzip streams. One shared sink enforces
  // the aggregate limit while the decoder validates every block/stream CRC.
  Bunzip.decode(input, sink, true);
  requireValue(inputOffset === bytes.length && outputOffset > 0, "incomplete bzip stream");
  return output.subarray(0, outputOffset);
}

function identity({ key, nominalTimeUtc, channel } = {}) {
  const canonical = channel === "B03" ? "visible" : channel === "B13" ? "infrared" : channel;
  requireValue(canonical === "visible" || canonical === "infrared", "unsupported channel");
  requireValue(typeof key === "string" && key.length <= 250, "missing object key");
  const match = /^AHI-L1b-Japan\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})(\d{2})\/HS_H09_(\d{8})_(\d{4})_(B03|B13)_JP(0[1-4])_R(05|20)_S0101\.DAT\.bz2$/.exec(key);
  requireValue(match, "unsupported object key");
  const [, year, month, day, hour, minute, fileDay, fileTime, bandName, part, resolution] = match;
  const timeline = Date.UTC(+year, +month - 1, +day, +hour, +minute);
  const date = new Date(timeline);
  requireValue(year + month + day === fileDay && hour + minute === fileTime &&
    date.getUTCFullYear() === +year && date.getUTCMonth() + 1 === +month && date.getUTCDate() === +day &&
    date.getUTCHours() === +hour && date.getUTCMinutes() === +minute && +minute % 10 === 0, "invalid object calendar/timeline");
  requireValue(Number.isInteger(nominalTimeUtc) && nominalTimeUtc === timeline + (+part - 1) * 150_000,
    "object key does not match nominal slot");
  requireValue(bandName === (canonical === "visible" ? "B03" : "B13") &&
    resolution === (canonical === "visible" ? "05" : "20"), "object channel/resolution mismatch");
  return { key, nominalTimeUtc, channel: canonical, band: canonical === "visible" ? 3 : 13, area: `JP${part}` };
}

export function parseHimawariHsd(bytes, options) {
  const expected = identity(options);
  bytes = asBuffer(bytes);
  requireValue(bytes.length >= 114 && bytes.length <= MAX_HIMAWARI_EXPANDED_BYTES, "expanded HSD size is outside bounds");
  requireValue(bytes[5] === 0 || bytes[5] === 1, "invalid HSD byte order");
  const little = bytes[5] === 0;
  const bounds = (position, length) => requireValue(position >= 0 && position + length <= bytes.length, "truncated HSD header");
  const u16 = position => { bounds(position, 2); return little ? bytes.readUInt16LE(position) : bytes.readUInt16BE(position); };
  const u32 = position => { bounds(position, 4); return little ? bytes.readUInt32LE(position) : bytes.readUInt32BE(position); };
  const f32 = position => { bounds(position, 4); return little ? bytes.readFloatLE(position) : bytes.readFloatBE(position); };
  const f64 = position => { bounds(position, 8); return little ? bytes.readDoubleLE(position) : bytes.readDoubleBE(position); };
  requireValue(u16(3) === 11, "unsupported HSD block count");
  const headerLength = u32(70), dataLength = u32(74), blocks = new Map();
  requireValue(headerLength >= 114 && headerLength <= 65536 && headerLength + dataLength === bytes.length,
    "HSD header/data lengths do not match bytes");
  let position = 0;
  for (let number = 1; number <= 11; number++) {
    bounds(position, number === 10 ? 5 : 3);
    requireValue(bytes[position] === number, "missing, repeated or unordered HSD block");
    const length = number === 10 ? u32(position + 1) : u16(position + 1);
    requireValue(length >= (number === 10 ? 5 : 3) && position + length <= headerLength, "invalid HSD block length");
    blocks.set(number, { position, length });
    position += length;
  }
  requireValue(position === headerLength, "HSD header total mismatch");
  const at = (block, offset, size) => {
    const entry = blocks.get(block);
    requireValue(offset >= 0 && offset + size <= entry.length, `truncated HSD block ${block}`);
    return entry.position + offset;
  };
  const word = (block, offset) => u16(at(block, offset, 2));
  const double = (block, offset) => f64(at(block, offset, 8));
  const text = (block, offset, length) => bytes.toString("ascii", at(block, offset, length), at(block, offset, length) + length).replace(/[\0 ]+$/g, "");
  requireValue(text(1, 6, 16) === "Himawari-9" && text(1, 82, 32) === "1.3" &&
    text(1, 38, 4) === expected.area, "satellite, format or area mismatch");
  requireValue(bytes[at(1, 78, 4)] === 0, "operation/degradation flags are nonzero");
  const startMjd = double(1, 46), endMjd = double(1, 54), creationMjd = double(1, 62);
  requireValue([startMjd, endMjd, creationMjd].every(finite) && endMjd >= startMjd &&
    (endMjd - startMjd) * DAY_MS < 150_000, "invalid observation interval");
  const startTime = mjdToMs(startMjd), endTime = mjdToMs(endMjd), creationTime = mjdToMs(creationMjd);
  requireValue([startTime, endTime, creationTime].every(value => finite(value) && Math.abs(value) <= 8.64e15),
    "invalid observation or creation clock");
  requireValue(startTime >= expected.nominalTimeUtc && startTime < expected.nominalTimeUtc + 150_000,
    "embedded observation does not match nominal slot");
  const columns = word(2, 5), lines = word(2, 7);
  requireValue(word(2, 3) === 16 && bytes[at(2, 9, 1)] === 0, "unsupported HSD pixel encoding");
  requireValue(columns === (expected.band === 3 ? 6000 : 1500) && lines === (expected.band === 3 ? 4800 : 1200) &&
    dataLength === columns * lines * 2, "unsupported HSD shape or data length");
  requireValue(bytes[at(7, 3, 1)] === 1 && bytes[at(7, 4, 1)] === 1 && word(7, 5) === 1,
    "only complete S0101 segments are supported");
  const projection = { subLon: double(3, 3), cfac: u32(at(3, 11, 4)), lfac: u32(at(3, 15, 4)),
    coff: f32(at(3, 19, 4)), loff: f32(at(3, 23, 4)), rsKm: double(3, 27), aKm: double(3, 35), bKm: double(3, 43) };
  requireValue(Object.values(projection).every(finite) && projection.cfac > 0 && projection.lfac > 0 &&
    projection.rsKm > projection.aKm && projection.aKm >= projection.bKm && projection.bKm > 0 &&
    projection.subLon >= 120 && projection.subLon <= 160, "invalid projection");
  requireValue(double(8, 11) === 0, "nonzero navigation rotation is unsupported");
  const navCount = word(8, 19);
  requireValue(navCount <= lines, "invalid navigation record count");
  at(8, 21, navCount * 10);
  for (let i = 0; i < navCount; i++) {
    const line = word(8, 21 + i * 10);
    requireValue(line >= 1 && line <= lines && f32(at(8, 23 + i * 10, 4)) === 0 &&
      f32(at(8, 27 + i * 10, 4)) === 0, "nonzero or invalid navigation correction");
  }
  requireValue(word(10, 5) === 0, "error-line entries are unsupported");
  const timingCount = word(9, 3), lineTimes = [];
  requireValue(timingCount >= 2 && timingCount <= lines, "invalid line-time record count");
  at(9, 5, timingCount * 10);
  for (let i = 0; i < timingCount; i++) {
    const line = word(9, 5 + i * 10), mjd = double(9, 7 + i * 10), previous = lineTimes.at(-1);
    requireValue(line >= 1 && line <= lines && finite(mjd) && mjd >= startMjd && mjd <= endMjd &&
      (!previous || (line > previous.line && mjd >= previous.mjd)), "unordered or out-of-scan line times");
    lineTimes.push({ line, mjd });
  }
  requireValue(lineTimes[0].line === 1 && lineTimes.at(-1).line === lines, "incomplete line-time coverage");
  requireValue(word(5, 3) === expected.band, "embedded band mismatch");
  const calibration = { wavelengthMicrometers: double(5, 5), validBits: word(5, 13), errorCount: word(5, 15),
    outsideScanCount: word(5, 17), gain: double(5, 19), offset: double(5, 27) };
  requireValue(Object.values(calibration).every(finite) && calibration.validBits === (expected.band === 3 ? 11 : 12) &&
    calibration.errorCount !== calibration.outsideScanCount, "invalid calibration/count metadata");
  if (expected.band === 3) {
    Object.assign(calibration, { albedoCoefficient: double(5, 35), updatedAtMjd: double(5, 43),
      updatedGain: double(5, 51), updatedOffset: double(5, 59) });
    requireValue(Object.values(calibration).every(finite) && calibration.wavelengthMicrometers >= 0.5 &&
      calibration.wavelengthMicrometers <= 0.8 && calibration.updatedGain > 0 && calibration.albedoCoefficient > 0 &&
      calibration.updatedAtMjd <= startMjd, "invalid updated B03 calibration");
  } else {
    for (const [i, name] of ["c0", "c1", "c2", "C0", "C1", "C2", "speedOfLight", "planckConstant", "boltzmannConstant"].entries()) {
      calibration[name] = double(5, 35 + i * 8);
    }
    requireValue(Object.values(calibration).every(finite) && calibration.wavelengthMicrometers >= 10 &&
      calibration.wavelengthMicrometers <= 11 && calibration.gain < 0 && calibration.c1 > 0 &&
      calibration.speedOfLight > 2.9e8 && calibration.speedOfLight < 3.1e8 &&
      calibration.planckConstant > 6e-34 && calibration.planckConstant < 7e-34 &&
      calibration.boltzmannConstant > 1e-23 && calibration.boltzmannConstant < 2e-23, "invalid B13 calibration");
  }
  return { ...expected, bytes, little, headerLength, columns, lines, projection, calibration, lineTimes,
    observationStartUtc: Math.round(startTime), observationEndUtc: Math.round(endTime), fileCreationUtc: Math.round(creationTime) };
}

export function himawariNativePosition(projection, latitude, longitude) {
  const p = projection, lat = radians(latitude), delta = radians(longitude - p.subLon);
  const e2 = 1 - (p.bKm / p.aKm) ** 2, n = p.aKm / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const ex = n * Math.cos(lat) * Math.cos(delta), ey = n * Math.cos(lat) * Math.sin(delta), ez = n * (1 - e2) * Math.sin(lat);
  const x = Math.atan2(ey, p.rsKm - ex), y = -Math.atan2(ez, Math.hypot(p.rsKm - ex, ey));
  const columnOneBased = p.coff + degrees(x) * p.cfac / 65536;
  const lineOneBased = p.loff + degrees(y) * p.lfac / 65536;
  return { row: Math.floor(lineOneBased + 0.5) - 1, column: Math.floor(columnOneBased + 0.5) - 1,
    lineOneBased, columnOneBased };
}

export function himawariNativeCenter(projection, row, column) {
  const p = projection;
  const x = radians((column + 1 - p.coff) * 65536 / p.cfac), y = radians((row + 1 - p.loff) * 65536 / p.lfac);
  const coefficient = Math.cos(y) ** 2 + (p.aKm / p.bKm) ** 2 * Math.sin(y) ** 2;
  const discriminant = (p.rsKm * Math.cos(x) * Math.cos(y)) ** 2 - coefficient * (p.rsKm ** 2 - p.aKm ** 2);
  if (!(discriminant >= 0)) return null;
  const sn = (p.rsKm * Math.cos(x) * Math.cos(y) - Math.sqrt(discriminant)) / coefficient;
  const sx = p.rsKm - sn * Math.cos(x) * Math.cos(y), sy = sn * Math.sin(x) * Math.cos(y), sz = -sn * Math.sin(y);
  return { latitude: degrees(Math.atan2((p.aKm / p.bKm) ** 2 * sz, Math.hypot(sx, sy))),
    longitude: p.subLon + degrees(Math.atan2(sy, sx)) };
}

export function himawariLineTime(hsd, row) {
  const line = row + 1;
  let lower, upper;
  for (const record of hsd.lineTimes) {
    if (record.line <= line) lower = record;
    if (record.line >= line) { upper = record; break; }
  }
  requireValue(lower && upper, "missing native-row line-time bracket");
  const fraction = lower.line === upper.line ? 0 : (line - lower.line) / (upper.line - lower.line);
  const mjd = lower.mjd + fraction * (upper.mjd - lower.mjd);
  return { time: mjdToMs(mjd), bracket: [mjdToMs(lower.mjd), mjdToMs(upper.mjd)] };
}

export function himawariSolarGeometry(time, latitude, longitude, projection) {
  const date = new Date(time), year = date.getUTCFullYear(), yearStart = Date.UTC(year, 0, 1);
  const n = Math.floor((time - yearStart) / DAY_MS) + 1;
  const minutes = (time - Date.UTC(year, date.getUTCMonth(), date.getUTCDate())) / 60_000;
  const gamma = 2 * Math.PI / ((Date.UTC(year + 1, 0, 1) - yearStart) / DAY_MS) * (n - 1 + (minutes / 60 - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const hour = radians((((minutes + eq + 4 * longitude) % 1440 + 1440) % 1440) / 4 - 180);
  const lat = radians(latitude), lon = radians(longitude);
  const sun = [-Math.cos(decl) * Math.sin(hour), Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(hour),
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hour)];
  const e2 = 1 - (projection.bKm / projection.aKm) ** 2, radius = projection.aKm / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const sx = projection.rsKm * Math.cos(radians(projection.subLon)) - radius * Math.cos(lat) * Math.cos(lon);
  const sy = projection.rsKm * Math.sin(radians(projection.subLon)) - radius * Math.cos(lat) * Math.sin(lon);
  const sz = -radius * (1 - e2) * Math.sin(lat), norm = Math.hypot(sx, sy, sz);
  const view = [(-sx * Math.sin(lon) + sy * Math.cos(lon)) / norm,
    (-sx * Math.sin(lat) * Math.cos(lon) - sy * Math.sin(lat) * Math.sin(lon) + sz * Math.cos(lat)) / norm,
    (sx * Math.cos(lat) * Math.cos(lon) + sy * Math.cos(lat) * Math.sin(lon) + sz * Math.sin(lat)) / norm];
  const dot = -sun[0] * view[0] - sun[1] * view[1] + sun[2] * view[2];
  return { cosZenith: sun[2], solarElevationDeg: degrees(Math.asin(clamp(sun[2], -1, 1))),
    glintAngleDeg: degrees(Math.acos(clamp(dot, -1, 1))) };
}

export function himawariInfraredTemperature(count, calibration) {
  const c = calibration, radiance = count * c.gain + c.offset;
  if (!finite(radiance) || radiance <= 0) return null;
  const wave = c.wavelengthMicrometers * 1e-6;
  const effective = c.planckConstant * c.speedOfLight / (c.boltzmannConstant * wave) /
    Math.log1p(2 * c.planckConstant * c.speedOfLight ** 2 / (wave ** 5 * radiance * 1e6));
  const temperature = c.c0 + c.c1 * effective + c.c2 * effective ** 2;
  return finite(temperature) && temperature > 0 ? temperature : null;
}

function sampleNative(hsd, row, column) {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= hsd.lines || column >= hsd.columns) return null;
  const offset = hsd.headerLength + 2 * (row * hsd.columns + column);
  const count = hsd.little ? hsd.bytes.readUInt16LE(offset) : hsd.bytes.readUInt16BE(offset), c = hsd.calibration;
  if (count === c.errorCount || count === c.outsideScanCount || count >= 2 ** c.validBits) return null;
  const timing = himawariLineTime(hsd, row);
  if (hsd.channel === "infrared") return { count, value: himawariInfraredTemperature(count, c), time: timing.time };
  const location = himawariNativeCenter(hsd.projection, row, column);
  if (!location) return null;
  const solar = himawariSolarGeometry(timing.time, location.latitude, location.longitude, hsd.projection);
  // This is a visual display threshold, deliberately separate from the 20°
  // conservative scientific cloud-change screen. Glint remains visibly masked.
  if (solar.solarElevationDeg < MIN_VISIBLE_ELEVATION || solar.glintAngleDeg < 25) return null;
  const value = (count * c.updatedGain + c.updatedOffset) * c.albedoCoefficient / Math.max(MIN_VISIBLE_COSINE, solar.cosZenith);
  return finite(value) ? { count, value, time: timing.time, ...solar } : null;
}

export function sampleHimawariPoint(hsd, latitude, longitude) {
  const position = himawariNativePosition(hsd.projection, latitude, longitude);
  const sample = sampleNative(hsd, position.row, position.column);
  return sample && sample.value !== null ? { ...position, ...sample } : null;
}

function distanceKm(a, b) {
  const dlat = radians(b.latitude - a.latitude), dlon = radians(b.longitude - a.longitude);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dlon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

// A fixed, smooth, monotonic display curve separates dark/midtone texture
// without clipping the bright-cloud range. No frame histogram, neighborhood,
// or previous image affects it, so a fixed reflectance keeps the same shade
// throughout a loop. This is display enhancement, not a cloud classification.
export function himawariVisibleDisplayValue(reflectance) {
  requireValue(finite(reflectance), "visible display value must be finite");
  // Solar normalization can legitimately produce values above one. Retain
  // their ordering through the bright shoulder rather than clipping at one.
  if (reflectance <= 0) return 0;
  return 1 / (1 + (VISIBLE_CONTRAST_PIVOT / reflectance) ** 2);
}

export function encodeHimawariPng(rgba) {
  requireValue(rgba instanceof Uint8Array && rgba.byteLength === HIMAWARI_IMAGE_SIZE ** 2 * 4,
    "invalid image raster size");
  return PNG.sync.write({ data: rgba, width: HIMAWARI_IMAGE_SIZE, height: HIMAWARI_IMAGE_SIZE },
    { colorType: 2, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, deflateLevel: 6, deflateStrategy: 0 });
}

export function renderHimawariRaster(hsd) {
  const width = HIMAWARI_IMAGE_SIZE, spanKm = HIMAWARI_IMAGE_SPAN_KM;
  const kmPerLongitudeDegree = 111.32 * Math.cos(radians(RKSI.latitude));
  const centerPosition = himawariNativePosition(hsd.projection, RKSI.latitude, RKSI.longitude);
  const centerTime = himawariLineTime(hsd, centerPosition.row);
  const solar = himawariSolarGeometry(centerTime.time, RKSI.latitude, RKSI.longitude, hsd.projection);
  const nativeCenter = himawariNativeCenter(hsd.projection, centerPosition.row, centerPosition.column);
  const eastCenter = himawariNativeCenter(hsd.projection, centerPosition.row, centerPosition.column + 1);
  const southCenter = himawariNativeCenter(hsd.projection, centerPosition.row + 1, centerPosition.column);
  requireValue(nativeCenter && eastCenter && southCenter, "airport is outside supported navigation");
  const geometry = { width, height: width, spanKm, centerLatitude: RKSI.latitude, centerLongitude: RKSI.longitude,
    west: RKSI.longitude - spanKm / 2 / kmPerLongitudeDegree, east: RKSI.longitude + spanKm / 2 / kmPerLongitudeDegree,
    south: RKSI.latitude - spanKm / 2 / 111.32, north: RKSI.latitude + spanKm / 2 / 111.32,
    orientation: "north-up", mapProjection: "local equirectangular at RKSI",
    centerMarkerFraction: { x: 0.5, y: 0.5 }, sourceWidth: hsd.columns, sourceHeight: hsd.lines,
    nativePixelSpacingKm: { column: distanceKm(nativeCenter, eastCenter), row: distanceKm(nativeCenter, southCenter) },
    sampling: "nearest native source pixel; display grid spacing is not source resolution",
    cloudHeightCorrection: false };
  const display = hsd.channel === "visible"
    ? { quantity: "solar-normalized B03 reflectance", units: "fraction", minimum: 0, maximum: null,
      toneCurve: "fixed rational contrast", contrastPivot: VISIBLE_CONTRAST_PIVOT, contrastExponent: 2,
      whiteMeans: "brighter visible reflection", minimumSolarElevationDeg: MIN_VISIBLE_ELEVATION,
      lowSun: solar.solarElevationDeg < 20, invalidColor: "#241932" }
    : { quantity: "B13 brightness temperature", units: "K", minimum: 190, maximum: 300,
      gamma: 1, whiteMeans: "colder infrared brightness temperature", invalidColor: "#241932" };
  const common = { version: HIMAWARI_IMAGE_VERSION, channel: hsd.channel, observedAt: Math.round(centerTime.time),
    observedAtBracket: centerTime.bracket.map(Math.round), solarElevationDeg: solar.solarElevationDeg, geometry, display,
    source: { key: hsd.key, band: hsd.band, area: hsd.area, nominalTimeUtc: hsd.nominalTimeUtc,
      observationStartUtc: hsd.observationStartUtc, observationEndUtc: hsd.observationEndUtc,
      fileCreationUtc: hsd.fileCreationUtc, calibration: hsd.calibration } };
  if (hsd.channel === "visible" && solar.solarElevationDeg < MIN_VISIBLE_ELEVATION) {
    return { ...common, status: "unavailable", reason: "Visible image requires solar elevation of at least 5 degrees", validFraction: 0 };
  }
  const rgba = Buffer.alloc(width * width * 4), nativeSamples = new Map();
  let validCount = 0;
  for (let y = 0; y < width; y++) {
    const latitude = RKSI.latitude + (spanKm / 2 - (y + 0.5) / width * spanKm) / 111.32;
    for (let x = 0; x < width; x++) {
      const longitude = RKSI.longitude + ((x + 0.5) / width * spanKm - spanKm / 2) / kmPerLongitudeDegree;
      const position = himawariNativePosition(hsd.projection, latitude, longitude);
      const key = `${position.row}:${position.column}`;
      if (!nativeSamples.has(key)) nativeSamples.set(key, sampleNative(hsd, position.row, position.column));
      const sample = nativeSamples.get(key), offset = 4 * (y * width + x);
      if (sample && finite(sample.value)) {
        const unit = hsd.channel === "visible" ? himawariVisibleDisplayValue(sample.value) : clamp((300 - sample.value) / 110, 0, 1);
        const shade = Math.round(unit * 255);
        rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = shade;
        validCount++;
      } else {
        [rgba[offset], rgba[offset + 1], rgba[offset + 2]] = INVALID_RGB;
      }
      rgba[offset + 3] = 255;
    }
  }
  const validFraction = validCount / (width * width);
  const counts = { validFraction, nativePixelsSampled: nativeSamples.size,
    validNativePixels: [...nativeSamples.values()].filter(sample => sample && finite(sample.value)).length };
  if (validFraction < 0.9) return { ...common, ...counts, status: "unavailable", reason: "More than 10 percent of the image has invalid or unilluminated source pixels" };
  return { ...common, ...counts, status: "ok", rgba };
}

export function decodeHimawariImage(compressedBytes, options) {
  identity(options); // Reject mismatched keys before any expansion/allocation.
  const hsd = parseHimawariHsd(decompressHimawariBzip(compressedBytes), options);
  const { rgba, ...result } = renderHimawariRaster(hsd);
  if (result.status !== "ok") return result;
  return { ...result, pngBytes: encodeHimawariPng(rgba) };
}
