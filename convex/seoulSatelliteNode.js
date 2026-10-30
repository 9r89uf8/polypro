"use node";

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { createHash } from "node:crypto";
import { internal } from "./_generated/api.js";
import { decodeHimawariImage } from "./lib/seoulHimawariImage.js";
import { decodeHimawariMicrophysics } from "./lib/seoulHimawariMicrophysics.js";

const ORIGIN = "https://noaa-himawari9.s3.amazonaws.com";
const HOUR = 60 * 60_000;
const MAX_COMPRESSED = 24 * 1024 * 1024;
const MAX_LISTING = 2 * 1024 * 1024;
const MAX_PNG = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_BATCH_MS = 140_000;
const RENDERER_VERSION = "rksi-himawari-image-v2";
const CLOUD_RENDERER_VERSION = "rksi-himawari-microphysics-v1";
const COLLECTION_VERSION = "rksi-himawari-collection-v3";
const IMAGE_CONTENT_TYPE = "image/png; profile=rksi-himawari-loop-v2";
const CLOUD_CONTENT_TYPE = "image/png; profile=rksi-himawari-microphysics-v1";
const CLOUD_BANDS = ["B04", "B07", "B13"];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_IEND = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

function enabled() { return process.env.NOAA_HIMAWARI_IMAGES_ENABLED === "true"; }
function concise(error) { return String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").trim().slice(0, 300); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function assertEnabled() { if (!enabled()) throw new Error("Satellite image collection is disabled."); }
async function assertWorker(ctx, runId, workerToken) {
  assertEnabled();
  if (!await ctx.runQuery(internal.seoulSatellite.checkWorker, { runId, workerToken })) throw new Error("Satellite image run was disabled, expired, or superseded.");
}

function hourlyPrefixes(now) {
  const hours = [...new Set([Math.floor((now - HOUR) / HOUR) * HOUR, Math.floor(now / HOUR) * HOUR])];
  return hours.reverse().map(time => `AHI-L1b-Japan/${new Date(time).toISOString().slice(0, 13).replace(/-/g, "/").replace("T", "/")}`);
}
function xmlTag(text, name) {
  const matches = [...text.matchAll(new RegExp(`<${name}>([^<]*)<\\/${name}>`, "g"))];
  return matches.length === 1 ? matches[0][1] : null;
}
function parseListedCandidate(key, size, modified) {
  const match = /^AHI-L1b-Japan\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{4})\/HS_H09_(\d{8})_(\d{4})_(B03|B04|B07|B13)_JP(0[1-4])_(R05|R10|R20)_S0101\.DAT\.bz2$/.exec(key ?? "");
  if (!match) return null;
  const [, year, month, day, timeline, date, nameTime, band, jp, resolution] = match;
  if (date !== `${year}${month}${day}` || timeline !== nameTime || Number(timeline.slice(0, 2)) > 23
      || Number(timeline.slice(2)) > 59 || Number(timeline.slice(2)) % 10 !== 0
      || resolution !== ({ B03: "R05", B04: "R10", B07: "R20", B13: "R20" })[band]) return null;
  const base = Date.parse(`${year}-${month}-${day}T${timeline.slice(0, 2)}:${timeline.slice(2)}:00Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null;
  const nominalTimeUtc = base + (Number(jp) - 1) * 150_000;
  const sourceLastModifiedAt = Date.parse(modified ?? "");
  if (!/^\d+$/.test(size ?? "") || !Number.isSafeInteger(Number(size)) || Number(size) <= 0 || Number(size) > MAX_COMPRESSED
      || !Number.isFinite(sourceLastModifiedAt) || sourceLastModifiedAt < nominalTimeUtc) return null;
  return { key, band, resolution, nominalTimeUtc, sourceLastModifiedAt, sourceSize: Number(size) };
}
function parseListing(text, prefix, now) {
  if (!text.includes("<ListBucketResult") || !text.includes("</ListBucketResult>") || /<!DOCTYPE|<!ENTITY/i.test(text)
      || xmlTag(text, "IsTruncated") !== "false") throw new Error("Satellite listing is malformed or truncated; no partial listing is accepted.");
  const rows = [];
  const contents = [...text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)];
  if (contents.length > 1000) throw new Error("Satellite listing exceeds the object bound.");
  for (const [, body] of contents) {
    const key = xmlTag(body, "Key");
    if (!key?.startsWith(prefix)) continue;
    const candidate = parseListedCandidate(key, xmlTag(body, "Size"), xmlTag(body, "LastModified"));
    if (candidate && candidate.nominalTimeUtc >= now - HOUR - 150_000 && candidate.nominalTimeUtc <= now
        && candidate.sourceLastModifiedAt <= now) rows.push(candidate);
  }
  return rows;
}

async function boundedFetch(ctx, runId, workerToken, url, limit) {
  const endpoint = new URL(url);
  const listing = endpoint.pathname === "/" && endpoint.searchParams.get("list-type") === "2"
    && /^AHI-L1b-Japan\/\d{4}\/\d{2}\/\d{2}\/\d{2}$/.test(endpoint.searchParams.get("prefix") ?? "")
    && endpoint.searchParams.get("max-keys") === "1000" && [...endpoint.searchParams.keys()].length === 3;
  const binary = !endpoint.search && /^\/AHI-L1b-Japan\/\d{4}\/\d{2}\/\d{2}\/\d{4}\/HS_H09_\d{8}_\d{4}_B(?:03|04|07|13)_JP0[1-4]_R(?:05|10|20)_S0101\.DAT\.bz2$/.test(endpoint.pathname);
  if (endpoint.origin !== ORIGIN || endpoint.username || endpoint.password || endpoint.hash || (!listing && !binary)) throw new Error("Unexpected NOAA satellite endpoint.");
  await assertWorker(ctx, runId, workerToken); // Same server-side switch immediately before each request.
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.href, { redirect: "error", cache: "no-store", signal: controller.signal,
      headers: { "User-Agent": "polypro-rksi-himawari-images/1.0", "Accept-Encoding": "identity" } });
    if (!response.ok || response.status !== 200) throw new Error(`NOAA satellite request returned HTTP ${response.status}.`);
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding.toLowerCase() !== "identity") throw new Error("Unexpected HTTP encoding for NOAA satellite bytes.");
    const declared = response.headers.get("content-length");
    if ((declared !== null && (!/^\d+$/.test(declared) || Number(declared) <= 0 || Number(declared) > limit))
        || (binary && declared === null)) throw new Error("NOAA satellite response has an invalid size.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("NOAA satellite response has no body.");
    const chunks = []; let total = 0;
    try {
      while (true) {
        assertEnabled();
        const { done, value } = await reader.read();
        if (Date.now() - startedAt > FETCH_TIMEOUT_MS) throw new Error("NOAA satellite response exceeded its deadline.");
        if (done) break;
        total += value.byteLength;
        if (total > limit) throw new Error("NOAA satellite response exceeded its byte limit.");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    if (declared !== null && total !== Number(declared)) throw new Error("NOAA satellite response length changed.");
    assertEnabled();
    return { bytes: Buffer.concat(chunks, total), receivedAt: Date.now(),
      lastModified: response.headers.get("last-modified"), contentLength: total };
  } finally { clearTimeout(timeout); }
}

async function discover(ctx, runId, workerToken) {
  const now = Date.now(), found = new Map();
  for (const prefix of hourlyPrefixes(now)) {
    const url = new URL(ORIGIN);
    url.searchParams.set("list-type", "2"); url.searchParams.set("prefix", prefix); url.searchParams.set("max-keys", "1000");
    const response = await boundedFetch(ctx, runId, workerToken, url.href, MAX_LISTING);
    for (const candidate of parseListing(response.bytes.toString("utf8"), prefix, now)) {
      if (found.has(candidate.key)) throw new Error("Duplicate NOAA satellite object identity.");
      found.set(candidate.key, candidate);
    }
  }
  const candidates = [], slots = new Map(), missingBundles = [];
  for (const source of found.values()) {
    if (!slots.has(source.nominalTimeUtc)) slots.set(source.nominalTimeUtc, new Map());
    slots.get(source.nominalTimeUtc).set(source.band, source);
    if (source.band === "B03" || source.band === "B13") {
      candidates.push({ key: source.key, channel: source.band === "B03" ? "visible" : "infrared",
        nominalTimeUtc: source.nominalTimeUtc, sourceLastModifiedAt: source.sourceLastModifiedAt, sourceSize: source.sourceSize });
    }
  }
  for (const [nominalTimeUtc, bands] of slots) {
    const missingBands = CLOUD_BANDS.filter(band => !bands.has(band));
    if (missingBands.length) { missingBundles.push({ nominalTimeUtc, missingBands }); continue; }
    const sources = CLOUD_BANDS.map(band => bands.get(band));
    candidates.push({ key: sources[0].key, channel: "cloudAnalysis", nominalTimeUtc, sources,
      sourceSize: sources.reduce((sum, source) => sum + source.sourceSize, 0),
      sourceLastModifiedAt: Math.max(...sources.map(source => source.sourceLastModifiedAt)) });
  }
  // Rebuild newest-first work at least once/minute between batches. Existing
  // current-renderer frames are removed transactionally by savePlan.
  const ordered = candidates.sort((a, b) => b.nominalTimeUtc - a.nominalTimeUtc || a.channel.localeCompare(b.channel));
  const counts = { visible: 0, infrared: 0, cloudAnalysis: 0 };
  return { candidates: ordered.filter(candidate => ++counts[candidate.channel] <= 25),
    missingBundles: missingBundles.sort((a, b) => b.nominalTimeUtc - a.nominalTimeUtc).slice(0, 25) };
}

function sourcesFor(candidate) {
  if (!["visible", "infrared", "cloudAnalysis"].includes(candidate.channel)) throw new Error("Unsupported satellite image channel.");
  const sources = candidate.channel === "cloudAnalysis" ? candidate.sources : [parseListedCandidate(candidate.key,
    String(candidate.sourceSize), new Date(candidate.sourceLastModifiedAt).toISOString())];
  if (!Array.isArray(sources) || sources.length !== (candidate.channel === "cloudAnalysis" ? 3 : 1)) throw new Error("Incomplete satellite source bundle.");
  for (const source of sources) {
    if (!source) throw new Error("Invalid satellite source identity.");
    const parsed = parseListedCandidate(source.key, String(source.sourceSize), new Date(source.sourceLastModifiedAt).toISOString());
    if (!parsed || !["key", "band", "resolution", "nominalTimeUtc", "sourceLastModifiedAt", "sourceSize"].every(key => parsed[key] === source[key])
        || source.nominalTimeUtc !== candidate.nominalTimeUtc) throw new Error("Source bands do not share one valid satellite slot.");
  }
  if (candidate.channel === "cloudAnalysis" && (!CLOUD_BANDS.every(band => sources.filter(source => source.band === band).length === 1)
      || candidate.key !== sources.find(source => source.band === "B04")?.key
      || candidate.sourceSize !== sources.reduce((sum, source) => sum + source.sourceSize, 0)
      || candidate.sourceLastModifiedAt !== Math.max(...sources.map(source => source.sourceLastModifiedAt)))) throw new Error("Invalid cloud-analysis bundle identity.");
  if (candidate.channel !== "cloudAnalysis" && sources[0].band !== (candidate.channel === "visible" ? "B03" : "B13")) throw new Error("Satellite band does not match its channel.");
  return [...sources].sort((a, b) => a.band.localeCompare(b.band));
}

function sourceObservations(decoded, downloaded, cloud) {
  if (!cloud) return downloaded.map(source => ({ ...source, observedAt: decoded.observedAt }));
  const observations = decoded.sourceObservations ?? [];
  if (!Array.isArray(observations) || observations.length > 3 || (decoded.status === "ok" && observations.length !== 3)
      || new Set(observations.map(source => source.key)).size !== observations.length) throw new Error("Invalid decoded source-observation coverage.");
  for (const observation of observations) {
    const source = downloaded.find(item => item.key === observation.key && item.band === observation.band);
    if (!source || !Number.isFinite(observation.observedAt) || observation.observedAt < source.nominalTimeUtc
        || observation.observedAt > source.nominalTimeUtc + 150_000 || observation.observedAt > Date.now()) throw new Error("Invalid per-band acquisition time.");
  }
  if (decoded.status === "ok") {
    const times = observations.map(source => source.observedAt);
    if (Math.max(...times) - Math.min(...times) > 60_000 || decoded.observedAt !== Math.max(...times)) throw new Error("Cloud-analysis bands are not synchronized within60seconds.");
  }
  return downloaded.map(source => {
    const observation = observations.find(item => item.key === source.key);
    return { ...source, ...(observation ? { observedAt: observation.observedAt } : {}) };
  });
}

export const collectFrames = internalActionGeneric({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    if (!enabled()) return { status: "disabled" };
    const claim = await ctx.runMutation(internal.seoulSatellite.claimWorker, { runId: args.runId });
    if (!claim || claim.collectionVersion !== COLLECTION_VERSION) return { status: "superseded_or_busy" };
    const workerToken = claim.workerToken;
    const attemptedKeys = [];
    const objectErrors = [];
    let reusableInfrared = null;
    const batchStarted = Date.now();
    try {
      let candidates = claim.pendingCandidates;
      if (!claim.planReady) {
        const discovered = await discover(ctx, args.runId, workerToken);
        candidates = await ctx.runMutation(internal.seoulSatellite.savePlan, { runId: args.runId, workerToken, ...discovered });
        if (candidates === null) return { status: "superseded" };
      }
      for (const candidate of candidates.slice(0, 4)) {
        if (Date.now() - batchStarted >= MAX_BATCH_MS) break;
        if (candidate.nominalTimeUtc + 150_000 < Date.now() - HOUR) { attemptedKeys.push(candidate.key); continue; }
        await assertWorker(ctx, args.runId, workerToken);
        attemptedKeys.push(candidate.key);
        try {
        const plannedSources = sourcesFor(candidate);
        const downloaded = [];
        for (const source of plannedSources) {
          await assertWorker(ctx, args.runId, workerToken);
          let captured = reusableInfrared?.key === source.key && reusableInfrared.sourceLastModifiedAt === source.sourceLastModifiedAt
            && reusableInfrared.sourceSize === source.sourceSize ? reusableInfrared : null;
          if (!captured) {
            let response;
            try { response = await boundedFetch(ctx, args.runId, workerToken, `${ORIGIN}/${source.key}`, MAX_COMPRESSED); }
            catch (error) { throw new Error(`${source.band} source request failed: ${concise(error)}`); }
            if (response.contentLength !== source.sourceSize || Date.parse(response.lastModified ?? "") !== source.sourceLastModifiedAt) {
              throw new Error(`${source.band} NOAA object changed between listing and download; it will be rediscovered on the next refresh.`);
            }
            captured = { ...source, bytes: response.bytes, fetchedAt: response.receivedAt, sourceSha256: digest(response.bytes) };
            if (source.band === "B13") reusableInfrared = captured; // At most one reusable binary retained.
          }
          downloaded.push(captured);
        }
        const cloud = candidate.channel === "cloudAnalysis";
        const rendererVersion = cloud ? CLOUD_RENDERER_VERSION : RENDERER_VERSION;
        let decoded;
        try {
          decoded = cloud
            ? decodeHimawariMicrophysics(downloaded, { nominalTimeUtc: candidate.nominalTimeUtc, channel: "cloudAnalysis" })
            : decodeHimawariImage(downloaded[0].bytes, { key: candidate.key, nominalTimeUtc: candidate.nominalTimeUtc, channel: candidate.channel });
        } catch (error) {
          decoded = { status: "unavailable", version: rendererVersion, reason: `Image decode rejected: ${concise(error)}`, observedAt: candidate.nominalTimeUtc };
        }
        await assertWorker(ctx, args.runId, workerToken);
        if (decoded.version !== rendererVersion) throw new Error("Decoder renderer version does not match the active image renderer.");
        const observedAt = decoded.observedAt;
        if (!Number.isFinite(observedAt) || observedAt < candidate.nominalTimeUtc || observedAt > candidate.nominalTimeUtc + 150_000 || observedAt > Date.now()) throw new Error("Decoder returned an invalid acquisition time.");
        const sources = sourceObservations(decoded, downloaded, cloud).map(({ bytes: _bytes, ...source }) => source);
        const imageBytes = cloud ? decoded.imageBytes : decoded.pngBytes;
        let storageId;
        try {
          if (decoded.status === "ok") {
            if (cloud && decoded.contentType !== "image/png") throw new Error("Cloud-analysis decoder returned an unexpected content type.");
            const png = imageBytes;
            if (!(png instanceof Uint8Array) || png.byteLength < 45 || png.byteLength > MAX_PNG
                || !PNG_SIGNATURE.every((value, index) => png[index] === value)
                || !PNG_IEND.every((value, index) => png[png.byteLength - 12 + index] === value)) throw new Error("Decoder returned an invalid or oversized PNG.");
            const header = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
            if (header.toString("ascii", 12, 16) !== "IHDR" || header.readUInt32BE(16) !== 256 || header.readUInt32BE(20) !== 256) {
              throw new Error("Decoder PNG dimensions differ from the fixed256-pixel grid.");
            }
            await assertWorker(ctx, args.runId, workerToken);
            storageId = await ctx.storage.store(new Blob([png], { type: cloud ? CLOUD_CONTENT_TYPE : IMAGE_CONTENT_TYPE }));
            // Safe even if a later mutation response is lost: only unreferenced uploads are removed.
            await ctx.scheduler.runAfter(5 * 60_000, internal.seoulSatellite.deleteUploadIfUnreferenced, { storageId });
          } else if (decoded.status !== "unavailable") throw new Error("Decoder returned an unsupported status.");
          const frame = { stationIcao: "RKSI", channel: candidate.channel, source: "noaa_himawari9", sourceKey: candidate.key,
            nominalTimeUtc: candidate.nominalTimeUtc, obsTimeUtc: observedAt, status: decoded.status, rendererVersion,
            sourceLastModifiedAt: candidate.sourceLastModifiedAt, sourceSize: candidate.sourceSize,
            fetchedAt: Math.max(...sources.map(source => source.fetchedAt)), capturedAt: Date.now(), sourceObjects: sources,
            sourceSha256: cloud ? digest(JSON.stringify(sources.map(source => ({ key: source.key, sourceSha256: source.sourceSha256 })))) : sources[0].sourceSha256,
            ...(storageId ? { storageId, imageSha256: digest(imageBytes) } : { reason: concise(decoded.reason ?? "Image unavailable.") }),
            ...(Number.isFinite(decoded.solarElevationDeg) ? { solarElevationDeg: decoded.solarElevationDeg } : {}),
            ...(Number.isFinite(decoded.validFraction) ? { validFraction: decoded.validFraction } : {}),
            ...(decoded.geometry ? { geometry: decoded.geometry } : {}), ...(decoded.display ? { display: decoded.display } : {}) };
          const result = await ctx.runMutation(internal.seoulSatellite.saveFrame, { runId: args.runId, workerToken, frame });
          if (["disabled", "superseded"].includes(result.status)) return result;
          if (["invalid_frame", "invalid_image", "upgrade_unavailable", "source_changed"].includes(result.status)) throw new Error(`Satellite frame save rejected: ${result.status}.`);
        } catch (error) {
          if (storageId) await ctx.runMutation(internal.seoulSatellite.deleteUploadIfUnreferenced, { storageId }).catch(() => {});
          throw error;
        }
        } catch (error) {
          const message = concise(error);
          const failure = await ctx.runMutation(internal.seoulSatellite.recordSourceFailure,
            { runId: args.runId, workerToken, key: candidate.key, error: message });
          if (!failure.recorded) return failure;
          objectErrors.push(message);
        }
      }
      return await ctx.runMutation(internal.seoulSatellite.finishWorker, { runId: args.runId, workerToken, attemptedKeys,
        ...(objectErrors.length ? { error: objectErrors.join("; ").slice(0, 300), continueAfterErrors: true } : {}) });
    } catch (error) {
      return await ctx.runMutation(internal.seoulSatellite.finishWorker, { runId: args.runId, workerToken, attemptedKeys, error: concise(error) });
    }
  },
});
