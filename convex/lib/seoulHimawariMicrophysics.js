"use node";

import {
  decompressHimawariBzip, parseHimawariHsd, himawariNativePosition,
  himawariNativeCenter, himawariLineTime, himawariSolarGeometry,
  himawariInfraredTemperature, encodeHimawariPng,
  HIMAWARI_IMAGE_SIZE, HIMAWARI_IMAGE_SPAN_KM,
} from "./seoulHimawariImage.js";

export const HIMAWARI_MICROPHYSICS_VERSION = "rksi-himawari-microphysics-v1";
export const HIMAWARI_MICROPHYSICS_RECIPE = "jma-day-microphysics-warm-v1";
export const MICROPHYSICS_MIN_SOLAR_ELEVATION = 10;
export const MICROPHYSICS_MAX_TIME_SPREAD_MS = 60_000;
const RKSI = Object.freeze({ latitude: 37.4602, longitude: 126.4407 });
const BANDS = Object.freeze(["B04", "B07", "B13"]);
const DAY_MS = 86_400_000;
const MIN_COSINE = Math.sin(MICROPHYSICS_MIN_SOLAR_ELEVATION * Math.PI / 180);
const MIN_GLINT_ANGLE = 25;
const finite = value => typeof value === "number" && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const requireValue = (condition, message) => { if (!condition) throw new Error(`Himawari microphysics: ${message}`); };
const radians = value => value * Math.PI / 180;

// Instrument-specific, band-mean solar irradiance, NOT a monochromatic solar
// constant or a coefficient borrowed from Himawari-8/SEVIRI. Derived by linear
// interpolation of the ASTM E-490 spectrum to all 3557 JMA H09 B07 wavelength
// samples, then trapezoidal integration: integral(F_lambda * SRF)/integral(SRF).
// The HSD inverse Planck coefficients below return the same band-mean radiance
// convention. An independent full-SRF integration agrees to <0.002% at 200–330 K.
export const HIMAWARI9_B07_SOLAR = Object.freeze({
  irradianceAtOneAu: 10.291785461024347, // W m^-2 micrometre^-1
  equivalentWidthMicrometers: 0.18614405289538785,
  srfUrl: "https://www.data.jma.go.jp/mscweb/en/himawari89/space_segment/srf_201310/AHI-09_SpectralResponsivity.zip",
  srfSha256: "b05b5c561d9ac77f71aae54e68aeb8c52e82329557e79d24b84e9cc776d225ee",
  spectrumUrl: "https://raw.githubusercontent.com/pytroll/pyspectral/main/pyspectral/data/e490_00a.dat",
  spectrumSha256: "5af00a781b4bbd7b7ce57efa8487cecf4d09831629770128e2692cf82d9884ef",
});
// Pyspectral's 0.005 W m^-2 sr^-1 band-integrated denominator floor, expressed
// here in the band-mean spectral radiance units used by HSD.
const MIN_RADIANCE_DENOMINATOR = 0.005 / HIMAWARI9_B07_SOLAR.equivalentWidthMicrometers;

// The published recipe uses display gamma as an inverse exponent. Its word
// "inverse" for B13 means warmer -> more blue (opposite the grayscale IR view).
// Keep one named warm-season mapping throughout the loop; no histogram stretch
// and no automatic seasonal change. JMA Quick Guide, version 1.0:
// https://www.jma.go.jp/jma/jma-eng/satellite/VLab/QG/RGB_QG_DayMicrophysics_en.pdf
export const HIMAWARI_MICROPHYSICS_LEGEND = Object.freeze([
  { color: "#e61400", label: "Red: cold, thick ice cloud with larger particles" },
  { color: "#cd9523", label: "Orange: cold, thick ice cloud with smaller particles" },
  { color: "#4f1428", label: "Dark purple: thin ice cloud; background affects color" },
  { color: "#e6f964", label: "Yellow: supercooled, thick water cloud with smaller droplets" },
  { color: "#b364b3", label: "Pink-purple: warm, thick water cloud with larger droplets" },
  { color: "#dbf9b3", label: "Pale green: warm, thick water cloud with smaller droplets" },
  { color: "#7764b3", label: "Muted purple: thin water cloud with larger droplets" },
  { color: "#0000c8", label: "Deep blue: often ocean; a surface color, not a cloud type" },
  { color: "#5a5a5a", label: "Gray checkerboard: unavailable or rejected source pixels" },
].map(item => Object.freeze(item)));

export function himawariMicrophysicsRgb(reflectanceB04, reflectanceB07, temperatureB13) {
  if (![reflectanceB04, reflectanceB07, temperatureB13].every(finite)) return null;
  return [
    clamp(reflectanceB04 / 1.02, 0, 1) ** (1 / 0.95),
    clamp((reflectanceB07 - 0.02) / 0.80, 0, 1) ** (1 / 2.6),
    clamp((temperatureB13 - 203.5) / (303.2 - 203.5), 0, 1),
  ].map(value => Math.round(255 * value));
}

// Approximate orbital distance from CAPSAT appendix A6 (day of year, AU):
// https://acp.copernicus.org/articles/8/6739/2008/acp-8-6739-2008.html
// Both reflective components use this factor; it is not applied to temperatures.
export function himawariEarthSunDistanceAu(time) {
  if (!finite(time)) return null;
  const year = new Date(time).getUTCFullYear();
  if (!Number.isFinite(year)) return null;
  const dayOfYear = 1 + (time - Date.UTC(year, 0, 1)) / DAY_MS;
  return 1 - 0.0167 * Math.cos(2 * Math.PI * (dayOfYear - 3) / 365);
}

export function himawariBandRadianceAtTemperature(temperature, calibration) {
  const c = calibration;
  if (!finite(temperature) || temperature < 150 || temperature > 360 || !c ||
      ![c.C0, c.C1, c.C2, c.wavelengthMicrometers, c.speedOfLight,
        c.planckConstant, c.boltzmannConstant].every(finite)) return null;
  const effective = c.C0 + c.C1 * temperature + c.C2 * temperature ** 2;
  const wave = c.wavelengthMicrometers * 1e-6;
  if (!(effective > 0 && wave > 0 && c.speedOfLight > 0 && c.planckConstant > 0 && c.boltzmannConstant > 0)) return null;
  const radiance = 2 * c.planckConstant * c.speedOfLight ** 2 /
    (wave ** 5 * Math.expm1(c.planckConstant * c.speedOfLight / (c.boltzmannConstant * wave * effective))) * 1e-6;
  return finite(radiance) && radiance >= 0 ? radiance : null;
}

// Solve L7 = rho7 * S7 + (1-rho7) * B7(T13), with S7=F7*mu0/(pi*d^2).
// The thermal term in the denominator is essential: simple subtraction alone
// does not recover reflectance. This follows Pyspectral's no-CO2-correction path:
// https://github.com/pytroll/pyspectral/blob/main/pyspectral/near_infrared_reflectance.py
// No SEVIRI-specific Rosenfeld CO2 correction is transplanted to AHI. T13 is a
// thermal-window proxy, so thin/multiple cloud layers and different emissivities
// can affect colors; this is visual interpretation, not a cloud-property retrieval.
export function himawariReflectedB07(radianceB07, temperatureB13, calibrationB07, cosineSolarZenith, time) {
  if (!finite(radianceB07) || radianceB07 < 0 || !finite(cosineSolarZenith) ||
      cosineSolarZenith < MIN_COSINE || cosineSolarZenith > 1 ||
      !finite(calibrationB07?.wavelengthMicrometers) || calibrationB07.wavelengthMicrometers < 3.7 ||
      calibrationB07.wavelengthMicrometers > 4) return null;
  const thermal = himawariBandRadianceAtTemperature(temperatureB13, calibrationB07);
  const distance = himawariEarthSunDistanceAu(time);
  if (thermal === null || distance === null) return null;
  const solar = HIMAWARI9_B07_SOLAR.irradianceAtOneAu * cosineSolarZenith / (Math.PI * distance ** 2);
  const denominator = solar - thermal;
  if (!finite(denominator) || denominator < MIN_RADIANCE_DENOMINATOR) return null;
  const reflectance = (radianceB07 - thermal) / denominator;
  // Retain finite out-of-range values until the published display stretch:
  // surface emissivity, thin cloud and anisotropic reflection can move this
  // approximate reflected component outside 0..1. No cloud class is assigned.
  return finite(reflectance) ? reflectance : null;
}

function countAt(hsd, row, column) {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 ||
      row >= hsd.lines || column >= hsd.columns) return null;
  const offset = hsd.headerLength + 2 * (row * hsd.columns + column), c = hsd.calibration;
  const count = hsd.little ? hsd.bytes.readUInt16LE(offset) : hsd.bytes.readUInt16BE(offset);
  return count === c.errorCount || count === c.outsideScanCount || count >= 2 ** c.validBits ? null : count;
}

function validateBundle(hsds, nominalTimeUtc) {
  requireValue(Array.isArray(hsds) && hsds.length === 3 && Number.isInteger(nominalTimeUtc), "a complete three-band nominal slot is required");
  const map = new Map();
  for (const hsd of hsds) {
    const band = `B${String(hsd?.band).padStart(2, "0")}`;
    requireValue(BANDS.includes(band) && !map.has(band) && hsd.nominalTimeUtc === nominalTimeUtc,
      "duplicate, unsupported or mismatched band slot");
    map.set(band, hsd);
  }
  requireValue(new Set(hsds.map(hsd => hsd.area)).size === 1, "regional scan areas do not match");
  return map;
}

function sampleAtB07Cell(map, row, column) {
  const b07 = map.get("B07"), location = himawariNativeCenter(b07.projection, row, column);
  if (!location) return { reason: "navigation" };
  const samples = new Map();
  for (const band of BANDS) {
    const hsd = map.get(band);
    const position = band === "B07" ? { row, column } : himawariNativePosition(hsd.projection, location.latitude, location.longitude);
    const count = countAt(hsd, position.row, position.column);
    if (count === null) return { reason: "source_pixel" };
    const time = himawariLineTime(hsd, position.row).time;
    if (!finite(time) || time < hsd.nominalTimeUtc || time > hsd.nominalTimeUtc + 150_000) return { reason: "source_time" };
    samples.set(band, { count, time, row: position.row, column: position.column });
  }
  const times = [...samples.values()].map(sample => sample.time);
  if (Math.max(...times) - Math.min(...times) > MICROPHYSICS_MAX_TIME_SPREAD_MS) return { reason: "band_time_spread" };
  const sample07 = samples.get("B07"), sample04 = samples.get("B04"), sample13 = samples.get("B13");
  const solar = himawariSolarGeometry(sample07.time, location.latitude, location.longitude, b07.projection);
  if (solar.solarElevationDeg < MICROPHYSICS_MIN_SOLAR_ELEVATION) return { reason: "low_sun" };
  if (solar.glintAngleDeg < MIN_GLINT_ANGLE) return { reason: "sun_glint" };
  const b04 = map.get("B04"), c04 = b04.calibration, c07 = b07.calibration;
  const solar04 = himawariSolarGeometry(sample04.time, location.latitude, location.longitude, b04.projection);
  if (solar04.solarElevationDeg < MICROPHYSICS_MIN_SOLAR_ELEVATION) return { reason: "low_sun" };
  const distance = himawariEarthSunDistanceAu(sample04.time);
  const reflectanceB04 = (sample04.count * c04.updatedGain + c04.updatedOffset) * c04.albedoCoefficient *
    distance ** 2 / solar04.cosZenith;
  const temperatureB13 = himawariInfraredTemperature(sample13.count, map.get("B13").calibration);
  const temperatureB07 = himawariInfraredTemperature(sample07.count, c07);
  if (![temperatureB13, temperatureB07].every(value => finite(value) && value >= 150 && value <= 360)) return { reason: "temperature_range" };
  const radianceB07 = sample07.count * c07.gain + c07.offset;
  const reflectanceB07 = himawariReflectedB07(radianceB07, temperatureB13, c07, solar.cosZenith, sample07.time);
  if (reflectanceB07 === null) return { reason: "thermal_separation" };
  const rgb = himawariMicrophysicsRgb(reflectanceB04, reflectanceB07, temperatureB13);
  if (!rgb) return { reason: "calibration" };
  return { rgb, reflectanceB04, reflectanceB07, temperatureB13, temperatureB07, radianceB07,
    solarElevationDeg: solar.solarElevationDeg, samples: Object.fromEntries(samples) };
}

export function sampleHimawariMicrophysicsPoint(hsds, latitude, longitude, nominalTimeUtc) {
  const map = validateBundle(hsds, nominalTimeUtc), b07 = map.get("B07");
  const position = himawariNativePosition(b07.projection, latitude, longitude);
  return { ...position, ...sampleAtB07Cell(map, position.row, position.column) };
}

function distanceKm(a, b) {
  const dlat = radians(b.latitude - a.latitude), dlon = radians(b.longitude - a.longitude);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dlon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

export function renderHimawariMicrophysics(hsds, { nominalTimeUtc, channel = "cloudAnalysis" } = {}) {
  requireValue(channel === "cloudAnalysis", "unsupported output channel");
  const map = validateBundle(hsds, nominalTimeUtc), b07 = map.get("B07");
  const center = himawariNativePosition(b07.projection, RKSI.latitude, RKSI.longitude);
  const nativeCenter = himawariNativeCenter(b07.projection, center.row, center.column);
  const nativeEast = himawariNativeCenter(b07.projection, center.row, center.column + 1);
  const nativeSouth = himawariNativeCenter(b07.projection, center.row + 1, center.column);
  requireValue(nativeCenter && nativeEast && nativeSouth, "airport is outside supported navigation");
  const sourceObservations = BANDS.map(band => {
    const hsd = map.get(band), position = himawariNativePosition(hsd.projection, RKSI.latitude, RKSI.longitude);
    const observedAt = Math.round(himawariLineTime(hsd, position.row).time);
    requireValue(observedAt >= nominalTimeUtc && observedAt <= nominalTimeUtc + 150_000, "airport acquisition is outside the nominal slot");
    return { key: hsd.key, band, observedAt };
  });
  const times = sourceObservations.map(source => source.observedAt);
  requireValue(Math.max(...times) - Math.min(...times) <= MICROPHYSICS_MAX_TIME_SPREAD_MS, "airport band acquisition times differ by more than 60 seconds");
  const observedAt = Math.max(...times), solar = himawariSolarGeometry(observedAt, RKSI.latitude, RKSI.longitude, b07.projection);
  const width = HIMAWARI_IMAGE_SIZE, spanKm = HIMAWARI_IMAGE_SPAN_KM;
  const kmPerLongitudeDegree = 111.32 * Math.cos(radians(RKSI.latitude));
  const geometry = { width, height: width, spanKm, centerLatitude: RKSI.latitude, centerLongitude: RKSI.longitude,
    west: RKSI.longitude - spanKm / 2 / kmPerLongitudeDegree, east: RKSI.longitude + spanKm / 2 / kmPerLongitudeDegree,
    south: RKSI.latitude - spanKm / 2 / 111.32, north: RKSI.latitude + spanKm / 2 / 111.32,
    orientation: "north-up", mapProjection: "local equirectangular at RKSI", centerMarkerFraction: { x: 0.5, y: 0.5 },
    sourceWidth: b07.columns, sourceHeight: b07.lines, nominalResolutionKm: 2,
    nativePixelSpacingKm: { column: distanceKm(nativeCenter, nativeEast), row: distanceKm(nativeCenter, nativeSouth) },
    sampling: "nearest B07 native cell; B04 and B13 matched geographically to that cell; no sharpening",
    cloudHeightCorrection: false };
  const display = { recipe: HIMAWARI_MICROPHYSICS_RECIPE, recipeLabel: "JMA Day Microphysics RGB · warm-season settings",
    description: "Colors help interpret cloud phase, relative opacity and temperature; they are not automatic cloud labels. Upper cloud can hide lower layers.",
    legend: HIMAWARI_MICROPHYSICS_LEGEND.map(item => ({ ...item })),
    red: { band: "B04", quantity: "solar-angle and Earth–Sun distance corrected reflectance", minimum: 0, maximum: 1.02, units: "fraction", gamma: 0.95 },
    green: { band: "B07", quantity: "solar-reflected component after thermal separation", minimum: 0.02, maximum: 0.82, units: "fraction", gamma: 2.6 },
    blue: { band: "B13", quantity: "brightness temperature; warmer means more blue", minimum: 203.5, maximum: 303.2, units: "K", gamma: 1 },
    gammaConvention: "output = clipped normalized input raised to 1/gamma",
    minimumSolarElevationDeg: MICROPHYSICS_MIN_SOLAR_ELEVATION, lowSun: solar.solarElevationDeg < 20,
    thermalMethod: "H09 B07 HSD inverse Planck calibration at B13 temperature; no SEVIRI CO2 correction",
    solarIrradianceAtOneAu: HIMAWARI9_B07_SOLAR.irradianceAtOneAu,
    invalidColor: "#242424", invalidPattern: "gray checkerboard", interpretationOnly: true };
  const common = { version: HIMAWARI_MICROPHYSICS_VERSION, channel, observedAt, sourceObservations,
    solarElevationDeg: solar.solarElevationDeg, geometry, display };
  if (solar.solarElevationDeg < MICROPHYSICS_MIN_SOLAR_ELEVATION) return { ...common, status: "unavailable", validFraction: 0,
    reason: "Day Microphysics requires solar elevation of at least 10 degrees." };
  const rgba = Buffer.alloc(width * width * 4), cache = new Map(), rejected = {};
  let validCount = 0;
  for (let y = 0; y < width; y++) {
    const latitude = RKSI.latitude + (spanKm / 2 - (y + 0.5) / width * spanKm) / 111.32;
    for (let x = 0; x < width; x++) {
      const longitude = RKSI.longitude + ((x + 0.5) / width * spanKm - spanKm / 2) / kmPerLongitudeDegree;
      const position = himawariNativePosition(b07.projection, latitude, longitude), key = `${position.row}:${position.column}`;
      if (!cache.has(key)) cache.set(key, sampleAtB07Cell(map, position.row, position.column));
      const sample = cache.get(key), offset = 4 * (y * width + x);
      if (sample.rgb) { rgba.set(sample.rgb, offset); validCount++; }
      else {
        const gray = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? 90 : 36;
        rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = gray;
        rejected[sample.reason] = (rejected[sample.reason] ?? 0) + 1;
      }
      rgba[offset + 3] = 255;
    }
  }
  const validFraction = validCount / (width * width), diagnostics = { rejected, nativePixelsSampled: cache.size };
  if (validFraction < 0.9) return { ...common, status: "unavailable", validFraction, diagnostics,
    reason: "More than 10 percent of the image lacks reliable daylight, synchronized bands or valid thermal separation." };
  return { ...common, status: "ok", validFraction, diagnostics, rgba };
}

export function decodeHimawariMicrophysics(inputs, { nominalTimeUtc, channel = "cloudAnalysis" } = {}) {
  requireValue(channel === "cloudAnalysis" && Array.isArray(inputs) && inputs.length === 3 && Number.isInteger(nominalTimeUtc),
    "a complete three-band nominal slot is required");
  const seen = new Set();
  const identified = inputs.map(input => {
    const match = typeof input?.key === "string" && /_(B04|B07|B13)_JP0[1-4]_R(?:10|20)_S0101\.DAT\.bz2$/.exec(input.key);
    requireValue(match && !seen.has(match[1]) && input.nominalTimeUtc === nominalTimeUtc, "duplicate, missing or mismatched input band");
    seen.add(match[1]);
    return { input, band: match[1] };
  });
  const hsds = identified.map(({ input, band }) => parseHimawariHsd(decompressHimawariBzip(input.bytes),
    { key: input.key, channel: band, nominalTimeUtc }));
  const { rgba, ...result } = renderHimawariMicrophysics(hsds, { nominalTimeUtc, channel });
  return result.status === "ok" ? { ...result, imageBytes: encodeHimawariPng(rgba), contentType: "image/png" } : result;
}
