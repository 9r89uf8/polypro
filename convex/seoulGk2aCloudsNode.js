"use node";

import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeCloudFrame, parseGk2aTime } from "./lib/seoulGk2aCloudDecode.js";
import { cloudCollectionWindowOpen } from "./lib/seoulGk2aCloudMath.js";

const ORIGIN = "https://noaa-gk2a-pds.s3.amazonaws.com";
const MINUTE = 60_000;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_LIST_BYTES = 2 * 1024 * 1024;
const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const OBJECT_PATTERN = /^AMI\/L1B\/LA\/(\d{6})\/(\d{2})\/(\d{2})\/gk2a_ami_le1b_(vi006|ir105)_la(005|020)ge_(\d{12})\.nc$/;
let h5Promise;
function enabled() { return process.env.NOAA_GK2A_CLOUD_ENABLED === "true"; }
function requireEnabled() { if (!enabled()) { const error = new Error("GK2A cloud collection disabled."); error.code = "DISABLED"; throw error; } }
async function h5Module() {
  h5Promise ??= import("h5wasm/node").then(async module => { await module.ready; return module; });
  return h5Promise;
}
function prefixAt(time) {
  const compact = new Date(time).toISOString().replace(/[-:T]/g, "").slice(0, 10);
  return `AMI/L1B/LA/${compact.slice(0, 6)}/${compact.slice(6, 8)}/${compact.slice(8, 10)}/`;
}

async function fetchBounded(url, limit, timeoutMs) {
  requireEnabled();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store", redirect: "error",
      headers: { "User-Agent": "polypro-rksi-cloud-trend/1.0", Accept: "application/xml, application/octet-stream, */*" } });
    if (!response.ok) throw new Error(`NOAA GK2A request returned HTTP ${response.status}.`);
    if (Number(response.headers.get("content-length")) > limit) throw new Error("NOAA GK2A response exceeds size limit.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty NOAA GK2A response.");
    const chunks = []; let length = 0;
    try {
      while (true) {
        requireEnabled();
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) throw new Error("NOAA GK2A response exceeds size limit.");
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    requireEnabled();
    return Buffer.concat(chunks, length);
  } finally { clearTimeout(timer); }
}

async function listObjects(prefix, requestedAt) {
  const url = new URL(ORIGIN);
  url.searchParams.set("list-type", "2"); url.searchParams.set("prefix", prefix); url.searchParams.set("max-keys", "1000");
  const xml = (await fetchBounded(url, MAX_LIST_BYTES, 15_000)).toString("utf8");
  if (!xml.includes("<ListBucketResult") || /<IsTruncated>true<\/IsTruncated>/.test(xml)) throw new Error("Unexpected or truncated NOAA GK2A listing.");
  const objects = [];
  for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([^<]+)<\/Key>/.exec(block[1])?.[1];
    const match = OBJECT_PATTERN.exec(key ?? "");
    if (!match || !key.startsWith(prefix)) continue;
    const [, month, day, hour, channel, resolution, compact] = match;
    if ((channel === "vi006" ? "005" : "020") !== resolution || compact.slice(0, 6) !== month ||
        compact.slice(6, 8) !== day || compact.slice(8, 10) !== hour) continue;
    const obsTimeUtc = parseGk2aTime(compact);
    const lastModifiedUtc = Date.parse(/<LastModified>([^<]+)<\/LastModified>/.exec(block[1])?.[1] ?? "");
    const size = Number(/<Size>(\d+)<\/Size>/.exec(block[1])?.[1]);
    if (![obsTimeUtc, lastModifiedUtc, size].every(Number.isFinite) || obsTimeUtc > requestedAt ||
        obsTimeUtc < requestedAt - 30 * MINUTE || lastModifiedUtc > requestedAt + MINUTE || size <= 8 || size > MAX_FILE_BYTES) continue;
    objects.push({ key, channel, obsTimeUtc, lastModifiedUtc, size });
  }
  return objects;
}

async function discoverFrames(requestedAt, latestProcessedTime) {
  const prefixes = [...new Set([prefixAt(requestedAt), prefixAt(requestedAt - 30 * MINUTE)])];
  const listings = await Promise.all(prefixes.map(prefix => listObjects(prefix, requestedAt)));
  const byTime = new Map();
  for (const item of listings.flat()) {
    if (Number.isFinite(latestProcessedTime) && item.obsTimeUtc <= latestProcessedTime) continue;
    const frame = byTime.get(item.obsTimeUtc) ?? { obsTimeUtc: item.obsTimeUtc };
    frame[item.channel === "vi006" ? "visible" : "infrared"] = item;
    byTime.set(item.obsTimeUtc, frame);
  }
  // The current hour contains at most 480 AMI objects. Pair both channels at
  // the same nominal observation, then warm up with at most four recent frames.
  return [...byTime.values()].filter(frame => frame.visible && frame.infrared)
    .sort((a, b) => b.obsTimeUtc - a.obsTimeUtc).slice(0, 4).reverse();
}

export const fetchLatestCloudSample = internalActionGeneric({
  args: { requestedAt: v.number(), latestProcessedTime: v.optional(v.number()) },
  handler: async (_ctx, { requestedAt, latestProcessedTime }) => {
    if (!enabled()) return { status: "disabled" };
    const now = Date.now();
    if (!Number.isFinite(requestedAt) || Math.abs(now - requestedAt) > 5 * MINUTE) throw new Error("Invalid GK2A cloud request time.");
    if (!cloudCollectionWindowOpen(now)) return { status: "unavailable", message: "Low sunlight or sun-glint geometry." };
    let directory;
    try {
      const frames = await discoverFrames(now, latestProcessedTime);
      if (!frames.length) return { status: "not_modified" };
      directory = await mkdtemp(join(tmpdir(), "polypro-noaa-cloud-"));
      const h5 = await h5Module(), observations = [];
      let lastProcessedTimeUtc = latestProcessedTime;
      let lastError, latestRejectedTimeUtc;
      let completedFrameCount = 0;
      for (const frame of frames) {
        requireEnabled();
        // Each discovered frame is attempted once; rejected frames advance the
        // checkpoint as well. Transient network failures do not advance it.
        let buffers;
        try {
          buffers = await Promise.all([frame.visible, frame.infrared].map(async object => {
            const bytes = await fetchBounded(`${ORIGIN}/${object.key}`, MAX_FILE_BYTES, 25_000);
            if (bytes.length !== object.size) throw new Error("Changed NOAA GK2A NetCDF object size.");
            return bytes;
          }));
        } catch (error) {
          if (error?.code === "DISABLED" || !completedFrameCount) throw error;
          // Preserve completed QA rejections across a later transport failure.
          // The failed frame is not checkpointed and remains eligible to retry.
          lastError = error instanceof Error ? error.message : "NOAA GK2A download interrupted.";
          break;
        }
        const visiblePath = join(directory, "visible.nc"), infraredPath = join(directory, "infrared.nc");
        await Promise.all([writeFile(visiblePath, buffers[0]), writeFile(infraredPath, buffers[1])]);
        requireEnabled();
        let visible, infrared;
        try {
          if (buffers.some(bytes => HDF5_SIGNATURE.some((byte, i) => bytes[i] !== byte))) throw new Error("Invalid NOAA GK2A NetCDF signature.");
          visible = new h5.File(visiblePath, "r"); infrared = new h5.File(infraredPath, "r");
          const observation = decodeCloudFrame(visible, infrared, frame, Date.now());
          requireEnabled();
          observations.push(observation);
        } catch (error) {
          if (error?.code === "DISABLED") throw error;
          lastError = error instanceof Error ? error.message : "Unusable GK2A cloud frame.";
          latestRejectedTimeUtc = frame.obsTimeUtc;
        } finally { infrared?.close(); visible?.close(); }
        lastProcessedTimeUtc = frame.obsTimeUtc;
        completedFrameCount += 1;
      }
      requireEnabled();
      // If the latest frame failed QA, expose an unavailable result instead of
      // presenting a direction based only on the older successful warmup rows.
      const latestUsable = observations.at(-1)?.obsTimeUtc === frames.at(-1)?.obsTimeUtc;
      return { status: latestUsable ? "ok" : "unavailable", observations, lastProcessedTimeUtc,
        ...(Number.isFinite(latestRejectedTimeUtc) ? { latestRejectedTimeUtc } : {}),
        ...(lastError && !latestUsable ? { message: lastError.slice(0, 200) } : {}) };
    } catch (error) {
      if (error?.code === "DISABLED") return { status: "disabled" };
      throw error;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  },
});
