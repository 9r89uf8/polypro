"use node";

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { createHash } from "node:crypto";
import { internal } from "./_generated/api.js";
import { encodeGoci2Png, goci2Metadata, goci2Window, locateGoci2, renderGoci2TrueColor } from "./lib/seoulGoci2Image.js";
import { GOCI2_IMAGE_CONTENT_TYPE, GOCI2_IMAGE_SIZE, GOCI2_RENDERER_VERSION } from "./lib/seoulGoci2Schema.js";
import { classifyGoci2Url, decodeDapArray, goci2DataUrl, goci2DayCatalogUrl, goci2DayPath, goci2DirectoriesFromCatalog,
  goci2DirectoryCatalogUrl, goci2FilesFromCatalog, goci2Hyperslab, goci2MetadataUrl, GOCI2_BANDS, GOCI2_VARIABLES,
  parseDapDas, parseDapDds, parseGoci2Catalog } from "./lib/seoulGoci2Source.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LOOKBACK_MS = 3 * HOUR;
const MAX_DIRECTORIES_PER_RUN = 2;
const FIRST_SEARCH_AFTER_MS = 30 * MINUTE;
const SLOT_SEARCH_AFTER_MS = 45 * MINUTE;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_RUN_MS = 200_000;
const MAX_PNG = 3 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_IEND = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

function approved() { return process.env.KHOA_GOCI2_ACCESS_APPROVED === "true"; }
function stop(code, message) { const error = new Error(message); error.code = code; return error; }
function assertApproved() { if (!approved()) throw stop("APPROVAL_REQUIRED", "GOCI-II access approval is not active."); }
function concise(error) { return String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").trim().slice(0, 300); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function assertWorker(ctx, runId, workerToken) {
  assertApproved();
  if (!await ctx.runQuery(internal.seoulGoci2.checkWorker, { runId, workerToken })) {
    assertApproved();
    throw stop("SUPERSEDED", "GOCI-II run expired or was superseded.");
  }
}

/** Every NOSC request: allowlisted URL class, approval and run ownership
 * re-checked immediately beforehand, no redirects, byte and time limits. */
async function boundedFetch(ctx, runId, workerToken, href, kind, { allowNotFound = false } = {}) {
  const request = classifyGoci2Url(href);
  if (!request || request.kind !== kind) throw new Error("Unexpected NOSC endpoint.");
  await assertWorker(ctx, runId, workerToken);
  const startedAt = Date.now(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(href, { redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { "User-Agent": "polypro-rksi-goci2/1.0", "Accept-Encoding": "identity" } });
    if (allowNotFound && response.status === 404) { await response.body?.cancel?.().catch(() => {}); return null; }
    if (!response.ok || response.status !== 200) throw new Error(`NOSC ${kind} request returned HTTP ${response.status}.`);
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") throw new Error(`Unexpected HTTP encoding for NOSC ${kind}.`);
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) <= 0 || Number(declared) > request.limit)) {
      throw new Error(`NOSC ${kind} response has an invalid size.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`NOSC ${kind} response has no body.`);
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        assertApproved();
        const { done, value } = await reader.read();
        if (Date.now() - startedAt > FETCH_TIMEOUT_MS) throw new Error(`NOSC ${kind} response exceeded its deadline.`);
        if (done) break;
        total += value.byteLength;
        if (total > request.limit) throw new Error(`NOSC ${kind} response exceeded its byte limit.`);
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    if (declared !== null && total !== Number(declared)) throw new Error(`NOSC ${kind} response length changed.`);
    assertApproved();
    return { bytes: Buffer.concat(chunks, total), receivedAt: Date.now() };
  } finally { clearTimeout(timer); }
}

async function discover(ctx, runId, workerToken, now, claim) {
  const found = new Map();
  for (const dayPath of [...new Set([goci2DayPath(now), goci2DayPath(now - LOOKBACK_MS)])]) {
    const response = await boundedFetch(ctx, runId, workerToken, goci2DayCatalogUrl(dayPath), "dayCatalog", { allowNotFound: true });
    if (!response) continue; // A new UTC day has no folder until its first slot.
    for (const directory of goci2DirectoriesFromCatalog(parseGoci2Catalog(response.bytes.toString("utf8")), dayPath)) {
      if (directory.nominalTimeUtc > now || directory.nominalTimeUtc < now - LOOKBACK_MS
          || claim.completedNominalTimes.includes(directory.nominalTimeUtc)
          || claim.backoffNominalTimes.includes(directory.nominalTimeUtc)) continue;
      found.set(directory.name, { ...directory, dayPath });
    }
  }
  return [...found.values()].sort((a, b) => b.nominalTimeUtc - a.nominalTimeUtc).slice(0, MAX_DIRECTORIES_PER_RUN);
}

async function downloadArray(ctx, runId, workerToken, sourceKey, variable, type, rows, columns) {
  const hyperslab = goci2Hyperslab(variable, rows, columns);
  const response = await boundedFetch(ctx, runId, workerToken, goci2DataUrl(sourceKey, hyperslab), "dods");
  const values = decodeDapArray(new Uint8Array(response.bytes.buffer, response.bytes.byteOffset, response.bytes.byteLength),
    { variable, type, shape: hyperslab.shape });
  return { values, receivedAt: response.receivedAt,
    source: { variable, constraint: hyperslab.text, bytes: response.bytes.length, sha256: digest(response.bytes) } };
}

const evenly = (size, stride) => ({ start: 0, stride, stop: size - 1 });
const indices = ({ start, stride, stop }) => Array.from({ length: Math.floor((stop - start) / stride) + 1 }, (_, i) => start + i * stride);
async function sampleNavigation(ctx, runId, workerToken, sourceKey, grid, stride) {
  const rows = evenly(grid[0], stride), columns = evenly(grid[1], stride);
  const latitude = await downloadArray(ctx, runId, workerToken, sourceKey, GOCI2_VARIABLES.latitude, "Float32", rows, columns);
  const longitude = await downloadArray(ctx, runId, workerToken, sourceKey, GOCI2_VARIABLES.longitude, "Float32", rows, columns);
  return { location: locateGoci2(latitude.values, longitude.values, indices(rows), indices(columns), null),
    sources: [latitude.source, longitude.source], receivedAt: Math.max(latitude.receivedAt, longitude.receivedAt) };
}

/** Finds the slot whose grid holds the full airport square. The last verified
 * slot is tried first; other published slots are checked only when needed. */
async function chooseSlot(ctx, runId, workerToken, directory, files, claim, now) {
  const preferred = files.find(file => file.slot === claim.lastSlot);
  const age = now - directory.nominalTimeUtc;
  if (!preferred && age < (claim.lastSlot ? SLOT_SEARCH_AFTER_MS : FIRST_SEARCH_AFTER_MS)) return null;
  for (const file of preferred ? [preferred, ...files.filter(item => item !== preferred)] : files) {
    const sourceKey = `${directory.dayPath}/${directory.name}/${file.name}`;
    const ddsResponse = await boundedFetch(ctx, runId, workerToken, goci2MetadataUrl(sourceKey, "dds"), "dds");
    const dds = parseDapDds(ddsResponse.bytes.toString("utf8")), navigation = dds.variables.get(GOCI2_VARIABLES.latitude);
    if (navigation?.shape.length !== 2) throw new Error(`${file.slot} has no two-dimensional latitude array.`);
    const sources = [{ variable: "dds", constraint: "", bytes: ddsResponse.bytes.length, sha256: digest(ddsResponse.bytes) }];
    if (file !== preferred) {
      const probe = await sampleNavigation(ctx, runId, workerToken, sourceKey, navigation.shape, Math.floor((Math.max(...navigation.shape) - 1) / 2));
      if (!probe.location.inside) continue;
      sources.push(...probe.sources);
    }
    const coarse = await sampleNavigation(ctx, runId, workerToken, sourceKey, navigation.shape, Math.max(8, Math.ceil(Math.max(...navigation.shape) / 72)));
    const window = goci2Window(coarse.location, navigation.shape[0], navigation.shape[1]);
    if (window) return { file, sourceKey, dds, window, sources: [...sources, ...coarse.sources], receivedAt: Math.max(ddsResponse.receivedAt, coarse.receivedAt) };
  }
  throw new Error("No published GOCI-II slot holds the complete 100 km RKSI view.");
}

async function captureDirectory(ctx, runId, workerToken, directory, claim) {
  const catalog = await boundedFetch(ctx, runId, workerToken, goci2DirectoryCatalogUrl(directory.dayPath, directory.name),
    "directoryCatalog", { allowNotFound: true });
  const files = catalog ? goci2FilesFromCatalog(parseGoci2Catalog(catalog.bytes.toString("utf8")), directory.name) : [];
  const chosen = await chooseSlot(ctx, runId, workerToken, directory, files, claim, Date.now());
  if (!chosen) return { status: "waiting" };
  const { file, sourceKey, dds, window } = chosen, sources = [...chosen.sources];
  const dasResponse = await boundedFetch(ctx, runId, workerToken, goci2MetadataUrl(sourceKey, "das"), "das");
  sources.push({ variable: "das", constraint: "", bytes: dasResponse.bytes.length, sha256: digest(dasResponse.bytes) });
  const metadata = goci2Metadata(parseDapDas(dasResponse.bytes.toString("utf8")), dds, directory.nominalTimeUtc);
  const rows = { start: window.rowStart, stride: 1, stop: window.rowEnd }, columns = { start: window.columnStart, stride: 1, stop: window.columnEnd };
  const latitude = await downloadArray(ctx, runId, workerToken, sourceKey, GOCI2_VARIABLES.latitude, "Float32", rows, columns);
  const longitude = await downloadArray(ctx, runId, workerToken, sourceKey, GOCI2_VARIABLES.longitude, "Float32", rows, columns);
  const counts = {}, received = [chosen.receivedAt, dasResponse.receivedAt, latitude.receivedAt, longitude.receivedAt];
  sources.push(latitude.source, longitude.source);
  for (const band of GOCI2_BANDS) {
    const result = await downloadArray(ctx, runId, workerToken, sourceKey, GOCI2_VARIABLES[band], "UInt32", rows, columns);
    counts[band] = result.values; sources.push(result.source); received.push(result.receivedAt);
  }
  let decoded;
  try {
    decoded = renderGoci2TrueColor({ window, latitude: latitude.values, longitude: longitude.values, counts, metadata });
  } catch (error) {
    // Deterministic rendering rejections are kept as an honest unavailable
    // record so the same slot is not downloaded again every five minutes.
    decoded = { status: "unavailable", version: GOCI2_RENDERER_VERSION, reason: `Image rejected: ${concise(error)}`,
      observedAt: metadata.observedAt, observationStartUtc: metadata.observationStartUtc, observationEndUtc: metadata.observationEndUtc };
  }
  if (decoded.version !== GOCI2_RENDERER_VERSION || !["ok", "unavailable"].includes(decoded.status)) throw new Error("Unexpected GOCI-II renderer result.");
  await assertWorker(ctx, runId, workerToken);
  let storageId, imageSha256;
  if (decoded.status === "ok") {
    const png = encodeGoci2Png(decoded.rgba), header = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
    if (png.byteLength < 45 || png.byteLength > MAX_PNG || !PNG_SIGNATURE.every((value, index) => png[index] === value)
        || !PNG_IEND.every((value, index) => png[png.byteLength - 12 + index] === value) || header.toString("ascii", 12, 16) !== "IHDR"
        || header.readUInt32BE(16) !== GOCI2_IMAGE_SIZE || header.readUInt32BE(20) !== GOCI2_IMAGE_SIZE) throw new Error("Renderer produced an invalid PNG.");
    await assertWorker(ctx, runId, workerToken);
    storageId = await ctx.storage.store(new Blob([png], { type: GOCI2_IMAGE_CONTENT_TYPE }));
    imageSha256 = digest(png);
    // Safe even if the save response is lost: only unreferenced uploads are removed.
    await ctx.scheduler.runAfter(5 * MINUTE, internal.seoulGoci2.deleteUploadIfUnreferenced, { storageId });
  }
  const frame = { stationIcao: "RKSI", source: "khoa_nosc_goci2", sourceKey, slot: file.slot, nominalTimeUtc: directory.nominalTimeUtc,
    obsTimeUtc: decoded.observedAt, observationStartUtc: decoded.observationStartUtc, observationEndUtc: decoded.observationEndUtc,
    status: decoded.status, rendererVersion: GOCI2_RENDERER_VERSION, fetchedAt: Math.max(...received), capturedAt: Date.now(),
    ...(file.size ? { sourceSize: file.size } : {}), ...(Number.isFinite(file.modifiedAt) ? { sourceLastModifiedAt: file.modifiedAt } : {}),
    sourceObjects: sources, subset: { ...window, gridRows: metadata.gridRows, gridColumns: metadata.gridColumns },
    ...(storageId ? { storageId, imageSha256 } : { reason: concise(decoded.reason ?? "Image unavailable.") }),
    ...(Number.isFinite(decoded.solarElevationDeg) ? { solarElevationDeg: decoded.solarElevationDeg } : {}),
    ...(Number.isFinite(decoded.validFraction) ? { validFraction: decoded.validFraction } : {}),
    ...(decoded.geometry ? { geometry: decoded.geometry } : {}), ...(decoded.display ? { display: decoded.display } : {}) };
  try {
    const result = await ctx.runMutation(internal.seoulGoci2.saveFrame, { runId, workerToken, frame });
    if (result.status === "approval_required") throw stop("APPROVAL_REQUIRED", "GOCI-II access approval is not active.");
    if (result.status === "superseded") throw stop("SUPERSEDED", "GOCI-II run expired or was superseded.");
    if (!result.stored && result.status !== "duplicate") throw new Error(`GOCI-II frame save rejected: ${result.status}.`);
    return { status: decoded.status };
  } catch (error) {
    if (storageId) await ctx.runMutation(internal.seoulGoci2.deleteUploadIfUnreferenced, { storageId }).catch(() => {});
    throw error;
  }
}

export const collectLatest = internalActionGeneric({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    if (!approved()) return { status: "approval_required" };
    const claim = await ctx.runMutation(internal.seoulGoci2.claimWorker, { runId: args.runId });
    if (!claim || claim.rendererVersion !== GOCI2_RENDERER_VERSION) return { status: "superseded_or_busy" };
    const { workerToken } = claim, startedAt = Date.now(), errors = [];
    let waiting = false;
    try {
      for (const directory of await discover(ctx, args.runId, workerToken, startedAt, claim)) {
        if (Date.now() - startedAt > MAX_RUN_MS) break;
        try {
          waiting = (await captureDirectory(ctx, args.runId, workerToken, directory, claim)).status === "waiting" || waiting;
        } catch (error) {
          if (error?.code) throw error;
          const failure = await ctx.runMutation(internal.seoulGoci2.recordSourceFailure, { runId: args.runId, workerToken,
            directoryKey: `${directory.dayPath}/${directory.name}`, error: concise(error) });
          if (!failure.recorded) return { status: failure.status };
          errors.push(concise(error));
        }
      }
      return await ctx.runMutation(internal.seoulGoci2.finishWorker, { runId: args.runId, workerToken,
        ...(errors.length ? { error: errors.join("; ").slice(0, 300) } : {}), ...(waiting ? { waiting } : {}) });
    } catch (error) {
      if (error?.code === "APPROVAL_REQUIRED") return { status: "approval_required" };
      if (error?.code === "SUPERSEDED") return { status: "superseded" };
      return await ctx.runMutation(internal.seoulGoci2.finishWorker, { runId: args.runId, workerToken, error: concise(error) });
    }
  },
});
