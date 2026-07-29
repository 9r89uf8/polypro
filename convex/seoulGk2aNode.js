"use node";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import proj4 from "proj4";

const NMSC_ORIGIN = "https://nmsc.kma.go.kr";
const NMSC_DSR_PNG_KEY = "GK2A:AMI:LE2:DSR:PNG:KO:020:LC";
const NMSC_DSR_NC_KEY = "GK2A:AMI:LE2:DSR:NC:KO:020:LC";
const DISCOVERY_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 8 * 60_000;
const MAX_NETCDF_BYTES = 8 * 1024 * 1024;
const GRID_SIZE = 900;
const GRID_PIXEL_SIZE_METERS = 2_000;
const GRID_UPPER_LEFT_EASTING = -899_000;
const GRID_UPPER_LEFT_NORTHING = 899_000;
const KOREA_LCC =
  "+proj=lcc +lat_1=30 +lat_2=60 +lat_0=38 +lon_0=126 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const REQUEST_HEADERS = {
  Accept: "application/json, application/x-netcdf, application/octet-stream, */*",
  "User-Agent": "polypro-gk2a-solar/1.0",
};

let h5wasmPromise;

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function utcDateKey(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function parseObservationTime(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(
    String(value ?? ""),
  );
  if (!match) {
    return null;
  }
  const epochMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const parsed = new Date(epochMs);
  return parsed.getUTCFullYear() === Number(match[1]) &&
    parsed.getUTCMonth() === Number(match[2]) - 1 &&
    parsed.getUTCDate() === Number(match[3]) &&
    parsed.getUTCHours() === Number(match[4]) &&
    parsed.getUTCMinutes() === Number(match[5])
    ? epochMs
    : null;
}

function buildDiscoveryUrl(requestedAt) {
  const url = new URL(
    "/enhome/json/satellite/viewer/selectSatViewer.do",
    NMSC_ORIGIN,
  );
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("searchDate", utcDateKey(requestedAt));
  url.searchParams.set("fileKey", NMSC_DSR_PNG_KEY);
  return url;
}

function buildResolveUrl(observationTime) {
  const url = new URL(
    "/enhome/json/satellite/viewer/selectNewSatFileList.do",
    NMSC_ORIGIN,
  );
  url.searchParams.set("timeZone", "UTC");
  url.searchParams.set("fileKey", NMSC_DSR_PNG_KEY);
  url.searchParams.set("startDate", observationTime);
  url.searchParams.set("endDate", observationTime);
  url.searchParams.set("etc", "NC");
  return url;
}

function buildDownloadUrl(observationTime) {
  const url = new URL(
    "/enhome/html/satellite/viewer/selectImgDown.do",
    NMSC_ORIGIN,
  );
  url.searchParams.set("fileKey", NMSC_DSR_NC_KEY);
  url.searchParams.set("observationTime", observationTime);
  url.searchParams.set("type", "NC");
  return url;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`NMSC metadata request returned ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      throw new Error("NMSC metadata request returned a non-JSON response.");
    }
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("NMSC metadata request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverCandidateFrames(requestedAt, latestStoredObsTimeUtc) {
  const payload = await fetchJson(
    buildDiscoveryUrl(requestedAt),
    DISCOVERY_TIMEOUT_MS,
  );
  const fileList = Array.isArray(payload?.data?.fileList)
    ? payload.data.fileList
    : [];
  return fileList
    .map((item) => {
      const observationTime = String(item?.observationTime ?? "");
      return {
        observationTime,
        observationTimeUtc: parseObservationTime(observationTime),
      };
    })
    .filter(
      (item) =>
        Number.isFinite(item.observationTimeUtc) &&
        item.observationTimeUtc <= requestedAt + 10 * 60_000 &&
        (!Number.isFinite(latestStoredObsTimeUtc) ||
          item.observationTimeUtc > latestStoredObsTimeUtc),
    )
    .sort((left, right) => right.observationTimeUtc - left.observationTimeUtc)
    .slice(0, 3);
}

async function resolveNetcdfFrame(candidate) {
  const payload = await fetchJson(
    buildResolveUrl(candidate.observationTime),
    DISCOVERY_TIMEOUT_MS,
  );
  const netcdf = payload?.data?.fileList?.[0]?.NC;
  const size = Number(netcdf?.size);
  const name = String(netcdf?.name ?? "");
  if (
    !name.endsWith(".nc") ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > MAX_NETCDF_BYTES
  ) {
    return null;
  }
  return {
    ...candidate,
    fileName: name,
    advertisedSizeBytes: size,
  };
}

async function selectNetcdfFrame(requestedAt, latestStoredObsTimeUtc) {
  const candidates = await discoverCandidateFrames(
    requestedAt,
    latestStoredObsTimeUtc,
  );
  if (!candidates.length) {
    return null;
  }
  const resolved = await Promise.all(
    candidates.map((candidate) => resolveNetcdfFrame(candidate)),
  );
  return resolved.filter(Boolean).sort(
    (left, right) => right.observationTimeUtc - left.observationTimeUtc,
  )[0] ?? null;
}

async function downloadNetcdf(frame) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(buildDownloadUrl(frame.observationTime), {
      cache: "no-store",
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`NMSC NetCDF download returned ${response.status}.`);
    }
    const advertisedLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(advertisedLength) &&
      advertisedLength > MAX_NETCDF_BYTES
    ) {
      throw new Error("NMSC NetCDF download exceeded the size limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_NETCDF_BYTES) {
      throw new Error("NMSC NetCDF download had an invalid size.");
    }
    if (
      HDF5_SIGNATURE.some((expected, index) => bytes[index] !== expected)
    ) {
      throw new Error("NMSC NetCDF download was not a valid HDF5 file.");
    }
    return bytes;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("NMSC NetCDF download timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getH5wasm() {
  h5wasmPromise ??= import("h5wasm/node").then(async (module) => {
    await module.ready;
    return module;
  });
  return await h5wasmPromise;
}

function attributeNumber(dataset, name, fallback) {
  const value = dataset?.attrs?.[name]?.value;
  const candidate =
    ArrayBuffer.isView(value) || Array.isArray(value) ? value[0] : value;
  return Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
}

function scaledDatasetValue(dataset, rawValue) {
  const fill = attributeNumber(dataset, "_FillValue", 65_535);
  if (!Number.isFinite(rawValue) || rawValue === fill) {
    return null;
  }
  const scale = attributeNumber(dataset, "scale_factor", 1);
  const offset = attributeNumber(dataset, "add_offset", 0);
  const value = rawValue * scale + offset;
  return Number.isFinite(value) ? round(value, 1) : null;
}

function gridCell(latitude, longitude) {
  const [easting, northing] = proj4("EPSG:4326", KOREA_LCC, [
    longitude,
    latitude,
  ]);
  const column = Math.round(
    (easting - GRID_UPPER_LEFT_EASTING) / GRID_PIXEL_SIZE_METERS,
  );
  const row = Math.round(
    (GRID_UPPER_LEFT_NORTHING - northing) / GRID_PIXEL_SIZE_METERS,
  );
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    row >= GRID_SIZE ||
    column < 0 ||
    column >= GRID_SIZE
  ) {
    return null;
  }
  const cellEasting =
    GRID_UPPER_LEFT_EASTING + column * GRID_PIXEL_SIZE_METERS;
  const cellNorthing =
    GRID_UPPER_LEFT_NORTHING - row * GRID_PIXEL_SIZE_METERS;
  const [sourceLongitude, sourceLatitude] = proj4(
    KOREA_LCC,
    "EPSG:4326",
    [cellEasting, cellNorthing],
  );
  return {
    row,
    column,
    index: row * GRID_SIZE + column,
    sourceLatitude: round(sourceLatitude, 6),
    sourceLongitude: round(sourceLongitude, 6),
  };
}

async function extractSamples(filePath, points) {
  const h5wasm = await getH5wasm();
  let file;
  try {
    file = new h5wasm.File(filePath, "r");
    const dsrDataset = file.get("DSR");
    const asrDataset = file.get("ASR");
    const dsrQualityDataset = file.get("DSR_DQF1");
    const asrQualityDataset = file.get("ASR_DQF1");
    const angleQualityDataset = file.get("SW_DQF");
    const expectedDatasets = [
      dsrDataset,
      asrDataset,
      dsrQualityDataset,
      asrQualityDataset,
      angleQualityDataset,
    ];
    if (
      expectedDatasets.some(
        (dataset) =>
          !dataset ||
          dataset.metadata?.shape?.[0] !== GRID_SIZE ||
          dataset.metadata?.shape?.[1] !== GRID_SIZE,
      )
    ) {
      throw new Error("NMSC NetCDF did not contain the expected SWRAD grid.");
    }

    const dsrValues = dsrDataset.value;
    const asrValues = asrDataset.value;
    const dsrQualityValues = dsrQualityDataset.value;
    const asrQualityValues = asrQualityDataset.value;
    const angleQualityValues = angleQualityDataset.value;

    return points.map((point) => {
      const cell = gridCell(point.latitude, point.longitude);
      if (!cell) {
        return {
          ...point,
          error: "Point fell outside the GK2A Korea grid.",
        };
      }
      const rawDsr = Number(dsrValues[cell.index]);
      const rawAsr = Number(asrValues[cell.index]);
      const dsrQualityFlag = Number(dsrQualityValues[cell.index]);
      const asrQualityFlag = Number(asrQualityValues[cell.index]);
      const angleQualityFlag = Number(angleQualityValues[cell.index]);
      const dsrWm2 =
        dsrQualityFlag === 1 && angleQualityFlag === 1
          ? scaledDatasetValue(dsrDataset, rawDsr)
          : null;
      const asrWm2 =
        asrQualityFlag === 1 && angleQualityFlag === 1
          ? scaledDatasetValue(asrDataset, rawAsr)
          : null;
      return {
        ...point,
        row: cell.row,
        column: cell.column,
        sourceLatitude: cell.sourceLatitude,
        sourceLongitude: cell.sourceLongitude,
        rawDsr,
        rawAsr,
        dsrQualityFlag,
        asrQualityFlag,
        angleQualityFlag,
        ...(Number.isFinite(dsrWm2) ? { dsrWm2 } : {}),
        ...(Number.isFinite(asrWm2) ? { asrWm2 } : {}),
      };
    });
  } finally {
    file?.close();
  }
}

const samplingPointValidator = v.object({
  pointKind: v.string(),
  sampleKey: v.string(),
  latitude: v.number(),
  longitude: v.number(),
  upwindMinutes: v.optional(v.number()),
  distanceUpwindKm: v.optional(v.number()),
});

export const fetchLatestSolarGrid = internalActionGeneric({
  args: {
    requestedAt: v.number(),
    latestStoredObsTimeUtc: v.optional(v.number()),
    points: v.array(samplingPointValidator),
  },
  handler: async (_ctx, args) => {
    const frame = await selectNetcdfFrame(
      args.requestedAt,
      args.latestStoredObsTimeUtc,
    );
    if (!frame) {
      return {
        status: "not_modified",
        samples: [],
      };
    }

    const bytes = await downloadNetcdf(frame);
    const tempDirectory = await mkdtemp(join(tmpdir(), "polypro-gk2a-"));
    const tempFile = join(tempDirectory, "swrad.nc");
    try {
      await writeFile(tempFile, bytes);
      const samples = await extractSamples(tempFile, args.points);
      return {
        status: "ok",
        observationTime: frame.observationTime,
        observationTimeUtc: frame.observationTimeUtc,
        fileName: frame.fileName,
        advertisedSizeBytes: frame.advertisedSizeBytes,
        downloadedSizeBytes: bytes.byteLength,
        samples,
      };
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  },
});
