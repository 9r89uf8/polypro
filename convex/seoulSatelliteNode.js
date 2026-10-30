"use node";

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { createHash } from "node:crypto";
import { internal } from "./_generated/api.js";
import { decodeHimawariImage } from "./lib/seoulHimawariImage.js";

const ORIGIN = "https://noaa-himawari9.s3.amazonaws.com";
const HOUR = 60 * 60_000;
const MAX_COMPRESSED = 24 * 1024 * 1024;
const MAX_LISTING = 2 * 1024 * 1024;
const MAX_PNG = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_BATCH_MS = 140_000;
const RENDERER_VERSION = "rksi-himawari-image-v2";
const IMAGE_CONTENT_TYPE = "image/png; profile=rksi-himawari-loop-v2";
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
  const match = /^AHI-L1b-Japan\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{4})\/HS_H09_(\d{8})_(\d{4})_(B03|B13)_JP(0[1-4])_(R05|R20)_S0101\.DAT\.bz2$/.exec(key ?? "");
  if (!match) return null;
  const [, year, month, day, timeline, date, nameTime, band, jp, resolution] = match;
  const channel = band === "B03" ? "visible" : "infrared";
  if (date !== `${year}${month}${day}` || timeline !== nameTime || Number(timeline.slice(0, 2)) > 23
      || Number(timeline.slice(2)) > 59 || Number(timeline.slice(2)) % 10 !== 0
      || resolution !== (channel === "visible" ? "R05" : "R20")) return null;
  const base = Date.parse(`${year}-${month}-${day}T${timeline.slice(0, 2)}:${timeline.slice(2)}:00Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return null;
  const nominalTimeUtc = base + (Number(jp) - 1) * 150_000;
  const sourceLastModifiedAt = Date.parse(modified ?? "");
  if (!/^\d+$/.test(size ?? "") || !Number.isSafeInteger(Number(size)) || Number(size) <= 0 || Number(size) > MAX_COMPRESSED
      || !Number.isFinite(sourceLastModifiedAt) || sourceLastModifiedAt < nominalTimeUtc) return null;
  return { key, channel, nominalTimeUtc, sourceLastModifiedAt, sourceSize: Number(size) };
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
  const binary = !endpoint.search && /^\/AHI-L1b-Japan\/\d{4}\/\d{2}\/\d{2}\/\d{4}\/HS_H09_\d{8}_\d{4}_B(?:03|13)_JP0[1-4]_R(?:05|20)_S0101\.DAT\.bz2$/.test(endpoint.pathname);
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
  // No more than25 regional slots/channel can contribute to the last hour.
  const ordered = [...found.values()].sort((a, b) => b.nominalTimeUtc - a.nominalTimeUtc || a.channel.localeCompare(b.channel));
  const counts = { visible: 0, infrared: 0 };
  return ordered.filter(candidate => ++counts[candidate.channel] <= 25);
}

export const collectFrames = internalActionGeneric({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    if (!enabled()) return { status: "disabled" };
    const claim = await ctx.runMutation(internal.seoulSatellite.claimWorker, { runId: args.runId });
    if (!claim || claim.rendererVersion !== RENDERER_VERSION) return { status: "superseded_or_busy" };
    const workerToken = claim.workerToken;
    const attemptedKeys = [];
    const objectErrors = [];
    const batchStarted = Date.now();
    try {
      let candidates = claim.pendingCandidates;
      if (!claim.planReady) {
        const discovered = await discover(ctx, args.runId, workerToken);
        candidates = await ctx.runMutation(internal.seoulSatellite.savePlan, { runId: args.runId, workerToken, candidates: discovered });
        if (candidates === null) return { status: "superseded" };
      }
      for (const candidate of candidates.slice(0, 4)) {
        if (Date.now() - batchStarted >= MAX_BATCH_MS) break;
        if (candidate.nominalTimeUtc + 150_000 < Date.now() - HOUR) { attemptedKeys.push(candidate.key); continue; }
        await assertWorker(ctx, args.runId, workerToken);
        attemptedKeys.push(candidate.key);
        try {
        const response = await boundedFetch(ctx, args.runId, workerToken, `${ORIGIN}/${candidate.key}`, MAX_COMPRESSED);
        if (response.contentLength !== candidate.sourceSize || Date.parse(response.lastModified ?? "") !== candidate.sourceLastModifiedAt) {
          throw new Error("NOAA object changed between listing and download; it will be rediscovered on the next refresh.");
        }
        let decoded;
        try {
          decoded = decodeHimawariImage(response.bytes, { key: candidate.key, nominalTimeUtc: candidate.nominalTimeUtc, channel: candidate.channel });
        } catch (error) {
          decoded = { status: "unavailable", version: RENDERER_VERSION, reason: `Image decode rejected: ${concise(error)}`, observedAt: candidate.nominalTimeUtc };
        }
        await assertWorker(ctx, args.runId, workerToken);
        if (decoded.version !== RENDERER_VERSION) throw new Error("Decoder renderer version does not match the active image renderer.");
        const observedAt = decoded.observedAt;
        if (!Number.isFinite(observedAt) || observedAt < candidate.nominalTimeUtc || observedAt > candidate.nominalTimeUtc + 150_000) throw new Error("Decoder returned an invalid acquisition time.");
        let storageId;
        try {
          if (decoded.status === "ok") {
            const png = decoded.pngBytes;
            if (!(png instanceof Uint8Array) || png.byteLength < 45 || png.byteLength > MAX_PNG
                || !PNG_SIGNATURE.every((value, index) => png[index] === value)
                || !PNG_IEND.every((value, index) => png[png.byteLength - 12 + index] === value)) throw new Error("Decoder returned an invalid or oversized PNG.");
            const header = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
            if (header.toString("ascii", 12, 16) !== "IHDR" || header.readUInt32BE(16) !== 256 || header.readUInt32BE(20) !== 256) {
              throw new Error("Decoder PNG dimensions differ from the fixed256-pixel grid.");
            }
            await assertWorker(ctx, args.runId, workerToken);
            storageId = await ctx.storage.store(new Blob([png], { type: IMAGE_CONTENT_TYPE }));
            // Safe even if a later mutation response is lost: only unreferenced uploads are removed.
            await ctx.scheduler.runAfter(5 * 60_000, internal.seoulSatellite.deleteUploadIfUnreferenced, { storageId });
          } else if (decoded.status !== "unavailable") throw new Error("Decoder returned an unsupported status.");
          const frame = { stationIcao: "RKSI", channel: candidate.channel, source: "noaa_himawari9", sourceKey: candidate.key,
            nominalTimeUtc: candidate.nominalTimeUtc, obsTimeUtc: observedAt, status: decoded.status, rendererVersion: RENDERER_VERSION,
            sourceLastModifiedAt: candidate.sourceLastModifiedAt, sourceSize: candidate.sourceSize,
            fetchedAt: response.receivedAt, capturedAt: Date.now(), sourceSha256: digest(response.bytes),
            ...(storageId ? { storageId, imageSha256: digest(decoded.pngBytes) } : { reason: concise(decoded.reason ?? "Image unavailable.") }),
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
