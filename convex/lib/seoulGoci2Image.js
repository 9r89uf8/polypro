"use node";

import { PNG } from "pngjs";
import { solarGeometry } from "./seoulGk2aCloudMath.js";
import { GOCI2_IMAGE_SIZE, GOCI2_IMAGE_SPAN_KM, GOCI2_RENDERER_VERSION } from "./seoulGoci2Schema.js";
import { dasGlobal, dasNumber, dasString, dasVariable, GOCI2_BANDS, GOCI2_MAX_WINDOW_ELEMENTS, GOCI2_VARIABLES,
  parseGoci2Clock, RKSI } from "./seoulGoci2Source.js";

// Offline Node-only renderer. The image shows approximate true colour for
// visual inspection; it is not a cloud mask, surface reflectance product or
// sunlight measurement.
const KM_PER_DEGREE = 111.32;
const KM_PER_LONGITUDE_DEGREE = KM_PER_DEGREE * Math.cos(RKSI.latitude * Math.PI / 180);
const MIN_RKSI_ELEVATION = 10;
const MIN_PIXEL_ELEVATION = 5;
const MAX_OBSERVATION_SPAN_MS = 5 * 60_000;
const DISPLAY_MAX_REFLECTANCE = 1.1;
const DISPLAY_GAMMA = 2.2;
const MAX_NAVIGATION_RESIDUAL_PX = 0.35;
const LATTICE = 33;
const INVALID_RGB = Object.freeze([36, 25, 50]);
const GEOSTATIONARY_RADIUS_M = 6378137 + 35785863;
const SATELLITE_LONGITUDE = 128.2;
// Approximate 10-nm band-centre extraterrestrial solar irradiance at 1 AU,
// W m-2 µm-1. Rounded to agree within about 2% with Thuillier-based F0 of
// neighbouring ocean-colour bands; display use only, not official GOCI-II F0.
export const GOCI2_REFERENCE_F0 = Object.freeze({ 443: 1885, 555: 1840, 660: 1545 });
const F0_ATTRIBUTES = ["F0", "solar_irradiance", "mean_solar_irradiance"];
const radians = value => value * Math.PI / 180;
const degrees = value => value * 180 / Math.PI;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = value => typeof value === "number" && Number.isFinite(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(`GOCI-II: ${message}`); };

export function goci2LocalKm(latitude, longitude) {
  return [(longitude - RKSI.longitude) * KM_PER_LONGITUDE_DEGREE, (latitude - RKSI.latitude) * KM_PER_DEGREE];
}
function geographic(xKm, yKm) {
  return [RKSI.latitude + yKm / KM_PER_DEGREE, RKSI.longitude + xKm / KM_PER_LONGITUDE_DEGREE];
}

export function parseGoci2Time(value) {
  const text = String(value ?? "").trim();
  let match = /^(\d{8})_(\d{6})$/.exec(text);
  if (match) return parseGoci2Clock(match[1], match[2]);
  match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(text);
  return match ? parseGoci2Clock(match.slice(1, 4).join(""), match.slice(4, 7).join("")) : null;
}

function radianceUnits(value) {
  const units = String(value ?? "").toLowerCase().replace(/[µμ]/g, "u").replace(/\s|\^|\*/g, "");
  return /^w/.test(units) && /(m-2|\/m2)/.test(units) && /(um-1|\/um|micron)/.test(units)
    && /(sr-1|\/sr)/.test(units) && !/(cm|nm)/.test(units);
}

function resolveF0(attributes, band) {
  const reference = GOCI2_REFERENCE_F0[band];
  for (const name of F0_ATTRIBUTES) {
    const value = dasNumber(attributes, name);
    if (value === null) continue;
    // Accept W m-2 µm-1 or the common ocean-colour mW cm-2 µm-1 convention.
    for (const scale of [1, 10]) if (Math.abs(value * scale / reference - 1) <= 0.15) return { value: value * scale, source: `file:${name}` };
    throw new Error(`GOCI-II: ${band} nm ${name} metadata is outside the plausible solar-irradiance range`);
  }
  return { value: reference, source: "reference" };
}

/** Times, grid and per-band calibration from the slot file's DAS and DDS. */
export function goci2Metadata(das, dds, nominalTimeUtc) {
  const global = dasGlobal(das);
  requireValue(global, "missing global attributes");
  const start = parseGoci2Time(dasString(global, "observation_start_time"));
  const end = parseGoci2Time(dasString(global, "observation_end_time"));
  requireValue(start !== null && end !== null && end >= start && end - start <= MAX_OBSERVATION_SPAN_MS,
    "missing or invalid observation clock");
  requireValue(start >= nominalTimeUtc - 10 * 60_000 && start <= nominalTimeUtc + 40 * 60_000,
    "observation clock does not match its slot directory");
  const latitude = dds.variables.get(GOCI2_VARIABLES.latitude), longitude = dds.variables.get(GOCI2_VARIABLES.longitude);
  requireValue(latitude?.type === "Float32" && longitude?.type === "Float32" && latitude.shape.length === 2
    && latitude.shape.every((size, index) => size === longitude.shape[index] && size >= 100 && size <= 4000),
  "unexpected navigation arrays");
  const [gridRows, gridColumns] = latitude.shape, bands = {};
  for (const band of GOCI2_BANDS) {
    const variable = GOCI2_VARIABLES[band], declared = dds.variables.get(variable), attributes = dasVariable(das, variable);
    requireValue(declared?.type === "UInt32" && declared.shape.length === 2 && declared.shape[0] === gridRows
      && declared.shape[1] === gridColumns, `unexpected ${band} nm radiance array`);
    requireValue(attributes, `missing ${band} nm attributes`);
    const scaleFactor = dasNumber(attributes, "scale_factor"), addOffset = dasNumber(attributes, "add_offset") ?? 0;
    requireValue(scaleFactor > 0 && scaleFactor <= 1e-3 && Math.abs(addOffset) <= 1000, `invalid ${band} nm scaling`);
    requireValue(radianceUnits(dasString(attributes, "units")), `${band} nm units are not W m-2 µm-1 sr-1`);
    const f0 = resolveF0(attributes, band);
    bands[band] = { variable, scaleFactor, addOffset, fillValue: dasNumber(attributes, "_FillValue"),
      validMin: dasNumber(attributes, "valid_min"), validMax: dasNumber(attributes, "valid_max"), f0: f0.value, f0Source: f0.source };
  }
  return { observationStartUtc: start, observationEndUtc: end, observedAt: Math.round((start + end) / 2), gridRows, gridColumns,
    navigationFill: dasNumber(dasVariable(das, GOCI2_VARIABLES.latitude), "_FillValue"), bands };
}

function validNavigation(latitude, longitude, fill) {
  return finite(latitude) && finite(longitude) && latitude !== fill && longitude !== fill
    && Math.abs(latitude - RKSI.latitude) < 8 && Math.abs(longitude - RKSI.longitude) < 10;
}

function solveLinear(matrix, vector) {
  const size = vector.length, a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    requireValue(Math.abs(a[pivot][column]) > 1e-12, "navigation fit is singular");
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= size; k++) a[row][k] -= factor * a[column][k];
    }
  }
  return a.map((row, index) => row[size] / row[index]);
}

function affine(points) {
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], xs = [0, 0, 0], ys = [0, 0, 0];
  for (const { row, column, x, y } of points) {
    const terms = [1, row, column];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) normal[i][j] += terms[i] * terms[j];
      xs[i] += terms[i] * x; ys[i] += terms[i] * y;
    }
  }
  const [a0, a1, a2] = solveLinear(normal, xs), [b0, b1, b2] = solveLinear(normal, ys);
  const determinant = a1 * b2 - a2 * b1;
  requireValue(Math.abs(determinant) > 1e-9, "degenerate grid navigation");
  return { rowSpacingKm: Math.hypot(a1, b1), columnSpacingKm: Math.hypot(a2, b2),
    toGrid: (x, y) => [((x - a0) * b2 - a2 * (y - b0)) / determinant, (a1 * (y - b0) - (x - a0) * b1) / determinant] };
}

/** RKSI's fractional grid position from a strided lat/lon sample. */
export function locateGoci2(latitude, longitude, rowIndices, columnIndices, fill) {
  const columns = columnIndices.length, at = (i, j) => i * columns + j;
  requireValue(latitude.length === rowIndices.length * columns && longitude.length === latitude.length, "sample shape mismatch");
  let nearest = null;
  for (let i = 0; i < rowIndices.length; i++) for (let j = 0; j < columns; j++) {
    if (!validNavigation(latitude[at(i, j)], longitude[at(i, j)], fill)) continue;
    const distance = Math.hypot(...goci2LocalKm(latitude[at(i, j)], longitude[at(i, j)]));
    if (!nearest || distance < nearest.distance) nearest = { i, j, distance };
  }
  requireValue(nearest, "no valid navigation in sample");
  const points = [];
  for (let i = Math.max(0, nearest.i - 2); i <= Math.min(rowIndices.length - 1, nearest.i + 2); i++) {
    for (let j = Math.max(0, nearest.j - 2); j <= Math.min(columns - 1, nearest.j + 2); j++) {
      if (!validNavigation(latitude[at(i, j)], longitude[at(i, j)], fill)) continue;
      const [x, y] = goci2LocalKm(latitude[at(i, j)], longitude[at(i, j)]);
      points.push({ row: rowIndices[i], column: columnIndices[j], x, y });
    }
  }
  requireValue(points.length >= 6, "too little valid navigation near RKSI");
  const fit = affine(points), [row, column] = fit.toGrid(0, 0);
  const strideKm = Math.max((rowIndices[1] - rowIndices[0] || 1) * fit.rowSpacingKm, (columnIndices[1] - columnIndices[0] || 1) * fit.columnSpacingKm);
  requireValue(fit.rowSpacingKm > 0.1 && fit.rowSpacingKm < 2 && fit.columnSpacingKm > 0.1 && fit.columnSpacingKm < 2,
    "implausible native pixel spacing");
  return { row, column, rowSpacingKm: fit.rowSpacingKm, columnSpacingKm: fit.columnSpacingKm, toGrid: fit.toGrid,
    inside: nearest.distance <= 1.5 * strideKm && row >= rowIndices[0] && row <= rowIndices.at(-1)
      && column >= columnIndices[0] && column <= columnIndices.at(-1) };
}

/** Native window that contains the whole north-up airport square, or null. */
export function goci2Window(location, gridRows, gridColumns, spanKm = GOCI2_IMAGE_SPAN_KM) {
  if (!location.inside) return null;
  const half = spanKm / 2 + 3, corners = [[-half, -half], [half, -half], [-half, half], [half, half]].map(([x, y]) => location.toGrid(x, y));
  const window = { rowStart: Math.floor(Math.min(...corners.map(c => c[0]))) - 6, rowEnd: Math.ceil(Math.max(...corners.map(c => c[0]))) + 6,
    columnStart: Math.floor(Math.min(...corners.map(c => c[1]))) - 6, columnEnd: Math.ceil(Math.max(...corners.map(c => c[1]))) + 6 };
  if (window.rowStart < 0 || window.columnStart < 0 || window.rowEnd >= gridRows || window.columnEnd >= gridColumns) return null;
  requireValue((window.rowEnd - window.rowStart + 1) * (window.columnEnd - window.columnStart + 1) <= GOCI2_MAX_WINDOW_ELEMENTS,
    "airport window exceeds the request bound");
  return window;
}

const cubicTerms = (x, y) => {
  const u = x / 50, w = y / 50;
  return [1, u, w, u * u, u * w, w * w, u * u * u, u * u * w, u * w * w, w * w * w];
};
/** Least-squares cubic map from local airport km to window row/column, checked
 * against every valid native latitude/longitude pair. */
export function fitGoci2Navigation(latitude, longitude, rows, columns, fill) {
  requireValue(latitude.length === rows * columns && longitude.length === latitude.length, "navigation window shape mismatch");
  const normal = Array.from({ length: 10 }, () => new Array(10).fill(0)), rowTarget = new Array(10).fill(0), columnTarget = new Array(10).fill(0);
  let samples = 0, valid = 0;
  for (let row = 0; row < rows; row += 2) for (let column = 0; column < columns; column += 2) {
    const index = row * columns + column;
    if (!validNavigation(latitude[index], longitude[index], fill)) continue;
    const terms = cubicTerms(...goci2LocalKm(latitude[index], longitude[index]));
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) normal[i][j] += terms[i] * terms[j];
      rowTarget[i] += terms[i] * row; columnTarget[i] += terms[i] * column;
    }
    samples++;
  }
  requireValue(samples >= 200, "too little valid navigation in the airport window");
  const rowCoefficients = solveLinear(normal, rowTarget), columnCoefficients = solveLinear(normal, columnTarget);
  const toGrid = (x, y) => {
    const terms = cubicTerms(x, y);
    let row = 0, column = 0;
    for (let i = 0; i < 10; i++) { row += terms[i] * rowCoefficients[i]; column += terms[i] * columnCoefficients[i]; }
    return [row, column];
  };
  let maxResidualPx = 0;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const index = row * columns + column;
    if (!validNavigation(latitude[index], longitude[index], fill)) continue;
    const [fitRow, fitColumn] = toGrid(...goci2LocalKm(latitude[index], longitude[index]));
    maxResidualPx = Math.max(maxResidualPx, Math.abs(fitRow - row), Math.abs(fitColumn - column));
    valid++;
  }
  requireValue(maxResidualPx <= MAX_NAVIGATION_RESIDUAL_PX, "latitude/longitude arrays are not a smooth native grid");
  return { toGrid, maxResidualPx, validFraction: valid / (rows * columns) };
}

function cosineToGeostationary(latitude, longitude) {
  const lat = radians(latitude), lon = radians(longitude), equatorial = 6378137, polar = 6356752.314245;
  const e2 = 1 - (polar / equatorial) ** 2, radius = equatorial / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const observer = [radius * Math.cos(lat) * Math.cos(lon), radius * Math.cos(lat) * Math.sin(lon), radius * (1 - e2) * Math.sin(lat)];
  const satellite = [GEOSTATIONARY_RADIUS_M * Math.cos(radians(SATELLITE_LONGITUDE)), GEOSTATIONARY_RADIUS_M * Math.sin(radians(SATELLITE_LONGITUDE)), 0];
  const path = satellite.map((value, index) => value - observer[index]), up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  return path.reduce((sum, value, index) => sum + value * up[index], 0) / Math.hypot(...path);
}

/** Sun and GK-2B (128.2° E) viewing geometry. Scattering angle follows from the
 * glint angle: cos Θ = cos(glint) − 2 μs μv for unit sun/view vectors. */
export function goci2Geometry(time, latitude, longitude) {
  const sun = solarGeometry(time, latitude, longitude), cosView = cosineToGeostationary(latitude, longitude);
  requireValue(finite(sun.cosZenith) && finite(sun.glintAngleDeg) && cosView > 0, "invalid viewing geometry");
  return { cosZenith: sun.cosZenith, solarElevationDeg: sun.solarElevationDeg, cosView,
    cosScattering: Math.cos(radians(sun.glintAngleDeg)) - 2 * sun.cosZenith * cosView, glintAngleDeg: sun.glintAngleDeg };
}

export function earthSunDistanceAu(time) {
  const date = new Date(time), day = (time - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000 + 1;
  return 1 - 0.01672 * Math.cos(radians(0.9856 * (day - 4)));
}
/** Hansen & Travis (1974) Rayleigh optical depth at standard surface pressure. */
export function rayleighOpticalDepth(nanometers) {
  const micrometers = nanometers / 1000;
  return 0.008569 * micrometers ** -4 * (1 + 0.0113 * micrometers ** -2 + 0.00013 * micrometers ** -4);
}
/** Single-scattering Rayleigh spherical albedo, ∫₀¹ μ(1 − e^(−τ/μ)) dμ. */
export function rayleighSphericalAlbedo(tau) {
  let total = 0;
  for (let i = 0; i < 64; i++) { const mu = (i + 0.5) / 64; total += mu * (1 - Math.exp(-tau / mu)); }
  return total / 64;
}
/** Approximate single-scattering Rayleigh removal for display colour balance.
 * Multiple scattering is ignored, so some residual blue haze remains. */
export function rayleighCorrectedReflectance(reflectance, tau, sphericalAlbedo, geometry) {
  const { cosZenith: mus, cosView: muv, cosScattering } = geometry;
  const path = 0.75 * (1 + cosScattering ** 2) / (4 * (mus + muv)) * (1 - Math.exp(-tau * (1 / mus + 1 / muv)));
  const surface = (reflectance - path) / (Math.exp(-tau / (2 * mus)) * Math.exp(-tau / (2 * muv)));
  return surface / (1 + sphericalAlbedo * surface);
}
export function goci2DisplayValue(reflectance) {
  requireValue(finite(reflectance), "display reflectance must be finite");
  return (clamp(reflectance, 0, DISPLAY_MAX_REFLECTANCE) / DISPLAY_MAX_REFLECTANCE) ** (1 / DISPLAY_GAMMA);
}

function radianceArray(counts, calibration) {
  const values = new Float32Array(counts.length);
  for (let index = 0; index < counts.length; index++) {
    const count = counts[index];
    const invalid = count === calibration.fillValue || (calibration.validMin !== null && count < calibration.validMin)
      || (calibration.validMax !== null && count > calibration.validMax);
    const radiance = count * calibration.scaleFactor + calibration.addOffset;
    values[index] = invalid || !(radiance >= 0) ? Number.NaN : radiance;
  }
  return values;
}
function sample(values, rows, columns, row, column) {
  const r0 = Math.floor(row), c0 = Math.floor(column);
  if (r0 >= 0 && c0 >= 0 && r0 + 1 < rows && c0 + 1 < columns) {
    const fr = row - r0, fc = column - c0, index = r0 * columns + c0;
    const v00 = values[index], v01 = values[index + 1], v10 = values[index + columns], v11 = values[index + columns + 1];
    if (v00 === v00 && v01 === v01 && v10 === v10 && v11 === v11) {
      return (v00 * (1 - fc) + v01 * fc) * (1 - fr) + (v10 * (1 - fc) + v11 * fc) * fr;
    }
  }
  const nearestRow = Math.round(row), nearestColumn = Math.round(column);
  if (nearestRow < 0 || nearestColumn < 0 || nearestRow >= rows || nearestColumn >= columns) return Number.NaN;
  return values[nearestRow * columns + nearestColumn];
}

/** North-up 100 km true-colour raster (660/555/443 nm) at 512 cells, i.e. 5.12
 * cells per km, finer than GOCI-II's ~0.27 × 0.36 km native spacing at RKSI. */
export function renderGoci2TrueColor({ window, latitude, longitude, counts, metadata }) {
  const rows = window.rowEnd - window.rowStart + 1, columns = window.columnEnd - window.columnStart + 1;
  requireValue(rows > 2 && columns > 2 && GOCI2_BANDS.every(band => counts[band]?.length === rows * columns), "window arrays are incomplete");
  const navigation = fitGoci2Navigation(latitude, longitude, rows, columns, metadata.navigationFill);
  const [rksiRow, rksiColumn] = navigation.toGrid(0, 0);
  requireValue(rksiRow >= 1 && rksiColumn >= 1 && rksiRow <= rows - 2 && rksiColumn <= columns - 2, "RKSI is outside the downloaded window");
  const step = 0.5, [rowEast, columnEast] = navigation.toGrid(step, 0), [rowNorth, columnNorth] = navigation.toGrid(0, step);
  const jacobian = [[(rowEast - rksiRow) / step, (rowNorth - rksiRow) / step], [(columnEast - rksiColumn) / step, (columnNorth - rksiColumn) / step]];
  const determinant = jacobian[0][0] * jacobian[1][1] - jacobian[0][1] * jacobian[1][0];
  const nativePixelSpacingKm = { column: Math.hypot(-jacobian[0][1], jacobian[0][0]) / Math.abs(determinant),
    row: Math.hypot(jacobian[1][1], -jacobian[1][0]) / Math.abs(determinant) };
  const size = GOCI2_IMAGE_SIZE, spanKm = GOCI2_IMAGE_SPAN_KM, observedAt = metadata.observedAt;
  const center = goci2Geometry(observedAt, RKSI.latitude, RKSI.longitude);
  const geometry = { width: size, height: size, spanKm, centerLatitude: RKSI.latitude, centerLongitude: RKSI.longitude,
    west: RKSI.longitude - spanKm / 2 / KM_PER_LONGITUDE_DEGREE, east: RKSI.longitude + spanKm / 2 / KM_PER_LONGITUDE_DEGREE,
    south: RKSI.latitude - spanKm / 2 / KM_PER_DEGREE, north: RKSI.latitude + spanKm / 2 / KM_PER_DEGREE,
    orientation: "north-up", mapProjection: "local equirectangular at RKSI", centerMarkerFraction: { x: 0.5, y: 0.5 },
    sourceWidth: metadata.gridColumns, sourceHeight: metadata.gridRows, nativePixelSpacingKm,
    rksiSourcePosition: { row: window.rowStart + rksiRow, column: window.columnStart + rksiColumn },
    navigationMaxResidualPx: navigation.maxResidualPx,
    sampling: "bilinear between native GOCI-II pixels; display cells are finer than the source resolution",
    cloudHeightCorrection: false };
  const distanceAu = earthSunDistanceAu(observedAt);
  const bands = Object.fromEntries(GOCI2_BANDS.map(band => {
    const calibration = metadata.bands[band], tau = rayleighOpticalDepth(band);
    return [band, { radiance: radianceArray(counts[band], calibration), tau, sphericalAlbedo: rayleighSphericalAlbedo(tau),
      factor: Math.PI * distanceAu ** 2 / calibration.f0 }];
  }));
  const display = { recipe: "goci2-truecolor-v1", red: 660, green: 555, blue: 443,
    quantity: "top-of-atmosphere reflectance with approximate Rayleigh removal", units: "fraction",
    rayleigh: "single scattering, Hansen-Travis optical depth at standard pressure; multiple scattering ignored",
    f0: Object.fromEntries(GOCI2_BANDS.map(band => [band, { value: metadata.bands[band].f0, source: metadata.bands[band].f0Source }])),
    earthSunDistanceAu: distanceAu, toneCurve: "fixed gamma", maximumReflectance: DISPLAY_MAX_REFLECTANCE, gamma: DISPLAY_GAMMA,
    minimumSolarElevationDeg: MIN_RKSI_ELEVATION, lowSun: center.solarElevationDeg < 20, invalidColor: "#241932" };
  const common = { version: GOCI2_RENDERER_VERSION, observedAt, observationStartUtc: metadata.observationStartUtc,
    observationEndUtc: metadata.observationEndUtc, solarElevationDeg: center.solarElevationDeg, geometry, display };
  if (center.solarElevationDeg < MIN_RKSI_ELEVATION) {
    return { ...common, status: "unavailable", validFraction: 0,
      reason: `GOCI-II true colour requires solar elevation of at least ${MIN_RKSI_ELEVATION} degrees at RKSI` };
  }
  // Geometry varies smoothly over 100 km: evaluate it on a 33 × 33 lattice of
  // image-edge coordinates and interpolate to each pixel centre.
  const lattice = [], latticeStep = size / (LATTICE - 1);
  for (let i = 0; i < LATTICE; i++) for (let j = 0; j < LATTICE; j++) {
    lattice.push(goci2Geometry(observedAt, ...geographic(j * latticeStep / size * spanKm - spanKm / 2, spanKm / 2 - i * latticeStep / size * spanKm)));
  }
  const interpolate = (x, y, key) => {
    const gx = Math.min(LATTICE - 1.000001, x / latticeStep), gy = Math.min(LATTICE - 1.000001, y / latticeStep);
    const j = Math.floor(gx), i = Math.floor(gy), fx = gx - j, fy = gy - i, at = (a, b) => lattice[a * LATTICE + b][key];
    return (at(i, j) * (1 - fx) + at(i, j + 1) * fx) * (1 - fy) + (at(i + 1, j) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
  };
  const rgba = Buffer.alloc(size * size * 4), minimumCosine = Math.sin(radians(MIN_PIXEL_ELEVATION));
  let validCount = 0, minimumGlintAngleDeg = 180;
  for (const point of lattice) if (point.solarElevationDeg >= MIN_PIXEL_ELEVATION) minimumGlintAngleDeg = Math.min(minimumGlintAngleDeg, point.glintAngleDeg);
  for (let y = 0; y < size; y++) {
    const yKm = spanKm / 2 - (y + 0.5) / size * spanKm;
    for (let x = 0; x < size; x++) {
      const xKm = (x + 0.5) / size * spanKm - spanKm / 2, offset = 4 * (y * size + x);
      const [row, column] = navigation.toGrid(xKm, yKm);
      const pixelGeometry = { cosZenith: interpolate(x + 0.5, y + 0.5, "cosZenith"), cosView: interpolate(x + 0.5, y + 0.5, "cosView"),
        cosScattering: interpolate(x + 0.5, y + 0.5, "cosScattering") };
      let shades = pixelGeometry.cosZenith >= minimumCosine ? [] : null;
      for (const band of GOCI2_BANDS) {
        if (!shades) break;
        const radiance = sample(bands[band].radiance, rows, columns, row, column);
        if (!(radiance === radiance)) { shades = null; break; }
        const reflectance = radiance * bands[band].factor / pixelGeometry.cosZenith;
        shades.push(Math.round(255 * goci2DisplayValue(rayleighCorrectedReflectance(reflectance, bands[band].tau, bands[band].sphericalAlbedo, pixelGeometry))));
      }
      if (shades) { [rgba[offset], rgba[offset + 1], rgba[offset + 2]] = shades; validCount++; }
      else [rgba[offset], rgba[offset + 1], rgba[offset + 2]] = INVALID_RGB;
      rgba[offset + 3] = 255;
    }
  }
  const validFraction = validCount / (size * size);
  display.minimumGlintAngleDeg = minimumGlintAngleDeg;
  if (validFraction < 0.9) {
    return { ...common, validFraction, status: "unavailable",
      reason: "More than 10 percent of the airport view has missing, saturated or unlit GOCI-II pixels" };
  }
  return { ...common, validFraction, status: "ok", rgba };
}

export function encodeGoci2Png(rgba) {
  requireValue(rgba instanceof Uint8Array && rgba.byteLength === GOCI2_IMAGE_SIZE ** 2 * 4, "invalid image raster size");
  return PNG.sync.write({ data: rgba, width: GOCI2_IMAGE_SIZE, height: GOCI2_IMAGE_SIZE },
    { colorType: 2, inputColorType: 6, inputHasAlpha: true, bitDepth: 8, deflateLevel: 6, deflateStrategy: 0 });
}
