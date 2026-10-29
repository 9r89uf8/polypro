import proj4 from "proj4";
import { CLOUD_METHOD_VERSION, CLOUD_POINTS, solarGeometry } from "./seoulGk2aCloudMath.js";

// NMSC SenPlanck_GK2A, IR105, calibration v3.0/20190415.
// IR radiance is mW/(m² sr cm⁻¹); these are not wavelength Planck constants.
const IR105 = { fk1: 10741.515953477339, fk2: 1390.0773470643644,
  c0: -0.14286644847517788, c1: 1.0006406957204939, c2: -5.504432949604984e-7 };
const CALIBRATION_VERSION = "v.3.0_20190415";

export function scalarAttribute(entity, name) {
  const value = entity?.attrs?.[name]?.value;
  return ArrayBuffer.isView(value) || Array.isArray(value) ? value[0] : value;
}

function numberAttribute(entity, name) {
  const value = scalarAttribute(entity, name);
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Missing or invalid GK2A ${name}.`);
  return value;
}

export function parseGk2aTime(value) {
  const match = /^(\d{4})(\d{2})(\d{2})_?(\d{2})(\d{2})(\d{2})?$/.exec(String(value ?? ""));
  if (!match) return null;
  const parts = match.slice(1).map((v, i) => v === undefined && i === 5 ? 0 : Number(v));
  const time = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const date = new Date(time);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .every((value, i) => value === parts[i]) ? time : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function goodDigitalCount(raw, bits) {
  // Two MSBs carry quality; keep only fully good pixels. Unused bits do not
  // become part of the digital count (VI006 uses 12 bits; IR105 uses 13).
  if (!Number.isInteger(raw) || raw < 0 || raw > 65535 || (raw >>> 14) !== 0) return null;
  return raw & ((1 << bits) - 1);
}

export function infraredBrightnessTemperature(dn, gain, offset) {
  const radiance = dn * gain + offset;
  if (![dn, gain, offset, radiance].every(Number.isFinite) || radiance <= 0) return null;
  const effective = IR105.fk2 / Math.log1p(IR105.fk1 / radiance);
  const kelvin = IR105.c0 + IR105.c1 * effective + IR105.c2 * effective ** 2;
  return Number.isFinite(kelvin) && kelvin >= 150 && kelvin <= 330.1 ? kelvin : null;
}

export function normalizedVisibleReflectance(dn, gain, offset, albedoCoefficient, cosZenith) {
  if (![dn, gain, offset, albedoCoefficient, cosZenith].every(Number.isFinite) ||
      gain <= 0 || albedoCoefficient <= 0 || cosZenith < Math.sin(20 * Math.PI / 180)) return null;
  // Embedded radiance→albedo coefficient produces a fraction, not percent.
  // Solar-angle correction reduces the changing illumination over this short
  // comparison window. This is a reflectance proxy, never surface irradiance.
  const reflectance = (dn * gain + offset) * albedoCoefficient / cosZenith;
  return Number.isFinite(reflectance) && reflectance >= 0 && reflectance <= 1.6 ? reflectance : null;
}

export function createGrid(file, channel) {
  if (scalarAttribute(file, "satellite_name") !== "GK-2A" || scalarAttribute(file, "instrument_name") !== "AMI" ||
      scalarAttribute(file, "observation_mode") !== "LA" || scalarAttribute(file, "projection_type") !== "GEOS" ||
      scalarAttribute(file, "calibration_table_version") !== CALIBRATION_VERSION) {
    throw new Error("Unsupported GK2A satellite, footprint, projection, or calibration.");
  }
  const dataset = file.get("image_pixel_values");
  const bits = channel === "VI006" ? 12 : channel === "IR105" ? 13 : null;
  if (!dataset || !bits || scalarAttribute(dataset, "channel_name") !== channel ||
      numberAttribute(dataset, "number_of_valid_bits_per_pixel") !== bits ||
      numberAttribute(dataset, "number_of_data_quality_flag_bits_per_pixel") !== 2 ||
      dataset.shape?.length !== 2 || dataset.shape.some((n) => !Number.isInteger(n) || n < 1 || n > 2200)) {
    throw new Error("Unexpected GK2A channel or grid dimensions.");
  }
  const [rows, columns] = dataset.shape;
  const a = numberAttribute(file, "earth_equatorial_radius"), b = numberAttribute(file, "earth_polar_radius");
  const h = numberAttribute(file, "nominal_satellite_height") - a;
  const lon0 = numberAttribute(file, "sub_longitude") * 180 / Math.PI;
  if (a < 6.3e6 || a > 6.4e6 || b < 6.3e6 || b > a || h < 35e6 || h > 36e6 || Math.abs(lon0 - 128.2) > 0.1) {
    throw new Error("Invalid GK2A navigation metadata.");
  }
  const dx = numberAttribute(dataset, "ground_sample_distance_ew"), dy = numberAttribute(dataset, "ground_sample_distance_ns");
  const x0 = numberAttribute(file, "image_upperleft_x"), y0 = numberAttribute(file, "image_upperleft_y");
  if (dx <= 0 || dy <= 0 || dx > 0.0001 || dy > 0.0001 || Math.abs(x0) > 0.16 || Math.abs(y0) > 0.16) {
    throw new Error("Invalid GK2A pixel navigation.");
  }
  const projection = `+proj=geos +h=${h} +lon_0=${lon0} +a=${a} +b=${b} +sweep=y +units=m +no_defs`;
  const pixels = dataset.value;
  if (!pixels || pixels.length !== rows * columns) throw new Error("Incomplete GK2A pixel array.");
  const gain = numberAttribute(file, "DN_to_Radiance_Gain"), offset = numberAttribute(file, "DN_to_Radiance_Offset");
  if (gain === 0 || (channel === "VI006" && gain < 0)) throw new Error("Invalid GK2A calibration gain.");
  const albedoCoefficient = channel === "VI006" ? numberAttribute(file, "Radiance_to_Albedo_c") : null;
  return { rows, columns, gain, offset, albedoCoefficient,
    cell(latitude, longitude) {
      const [x, y] = proj4("EPSG:4326", projection, [longitude, latitude]);
      const column = Math.round((x / h - x0) / dx), row = Math.round((y0 - y / h) / dy);
      if (!Number.isFinite(column) || !Number.isFinite(row) || row < 0 || column < 0 || row >= rows || column >= columns) return null;
      // Verify each LA footprint instead of assuming its movable target covers Korea.
      const [cellLon, cellLat] = proj4(projection, "EPSG:4326", [(x0 + column * dx) * h, (y0 - row * dy) * h]);
      const distanceKm = Math.hypot((cellLat - latitude) * 111.32, (cellLon - longitude) * 111.32 * Math.cos(latitude * Math.PI / 180));
      if (!Number.isFinite(distanceKm) || distanceKm > (channel === "VI006" ? 1 : 3)) return null;
      if (channel === "IR105") return goodDigitalCount(pixels[row * columns + column], bits);
      const counts = [];
      // A small visible neighborhood reduces registration noise; every sample
      // remains anchored to the same geographic grid in subsequent frames.
      for (let r = row - 1; r <= row + 1; r += 1) for (let c = column - 1; c <= column + 1; c += 1) {
        if (r < 0 || c < 0 || r >= rows || c >= columns) continue;
        const value = goodDigitalCount(pixels[r * columns + c], bits);
        if (value !== null) counts.push(value);
      }
      return counts.length >= 7 ? median(counts) : null;
    },
  };
}

export function decodeCloudFrame(visibleFile, infraredFile, frame, nowMs) {
  const time = frame.obsTimeUtc;
  const visibleTime = parseGk2aTime(scalarAttribute(visibleFile, "scene_acquisition_time"));
  const infraredTime = parseGk2aTime(scalarAttribute(infraredFile, "scene_acquisition_time"));
  if (![time, visibleTime, infraredTime, nowMs].every(Number.isFinite) ||
      Math.abs(visibleTime - infraredTime) > 90_000 || visibleTime < time - 60_000 || visibleTime > time + 120_000 ||
      infraredTime < time - 60_000 || infraredTime > time + 120_000 || Math.max(visibleTime, infraredTime) > nowMs) {
    throw new Error("GK2A channel observation clocks do not match.");
  }
  if (scalarAttribute(visibleFile, "file_name") !== frame.visible.key.split("/").at(-1) ||
      scalarAttribute(infraredFile, "file_name") !== frame.infrared.key.split("/").at(-1)) {
    throw new Error("GK2A file metadata does not match the discovered frame.");
  }
  const visible = createGrid(visibleFile, "VI006"), infrared = createGrid(infraredFile, "IR105");
  const cells = [];
  for (const point of CLOUD_POINTS) {
    const solar = solarGeometry(visibleTime, point.latitude, point.longitude);
    if (solar.solarElevationDeg < 20 || solar.glintAngleDeg < 25) continue;
    const visCount = visible.cell(point.latitude, point.longitude), irCount = infrared.cell(point.latitude, point.longitude);
    if (visCount === null || irCount === null) continue;
    const reflectance = normalizedVisibleReflectance(visCount, visible.gain, visible.offset, visible.albedoCoefficient, solar.cosZenith);
    const brightnessTempK = infraredBrightnessTemperature(irCount, infrared.gain, infrared.offset);
    if (reflectance === null || brightnessTempK === null) continue;
    cells.push({ id: point.id, reflectance, brightnessTempK });
  }
  if (cells.length < 20) throw new Error("Insufficient good, illuminated GK2A cells around RKSI.");
  return {
    obsTimeUtc: time, acquisitionTimeUtc: visibleTime,
    visibleObjectKey: frame.visible.key, infraredObjectKey: frame.infrared.key,
    visibleLastModifiedUtc: frame.visible.lastModifiedUtc, infraredLastModifiedUtc: frame.infrared.lastModifiedUtc,
    solarElevationDeg: solarGeometry(visibleTime, 37.4602, 126.4407).solarElevationDeg,
    reflectance: median(cells.map(c => c.reflectance)), brightnessTempK: median(cells.map(c => c.brightnessTempK)),
    validCellCount: cells.length, cells, methodVersion: CLOUD_METHOD_VERSION, source: "noaa_gk2a_l1b",
  };
}
