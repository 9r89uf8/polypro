import { internalMutationGeneric, internalQueryGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { satelliteCandidate, satelliteFrameValidator } from "./lib/seoulSatelliteSchema.js";

const HOUR = 60 * 60_000;
const STALE_MS = 12 * 60_000;
const LEASE_MS = 3 * 60_000;
const COOLDOWN_MS = 60_000;
const MAX_PENDING = 50;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ACQUISITION_MARGIN_MS = 150_000;
const RENDERER_VERSION = "rksi-himawari-image-v2";
const LEGACY_RENDERER_VERSION = "rksi-himawari-image-v1";
const IMAGE_CONTENT_TYPE = "image/png; profile=rksi-himawari-loop-v2";
const OWNED_CONTENT_TYPES = new Set([IMAGE_CONTENT_TYPE, "image/jpeg; profile=rksi-himawari-loop-v1"]);

function enabled() { return process.env.NOAA_HIMAWARI_IMAGES_ENABLED === "true"; }
function station(value) {
  if (String(value ?? "RKSI").trim().toUpperCase() !== "RKSI") throw new Error("Satellite images support RKSI only.");
  return "RKSI";
}
function concise(value) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300); }
async function statusRow(ctx) {
  return await ctx.db.query("seoulSatelliteCollectorStatus").withIndex("by_station", q => q.eq("stationIcao", "RKSI")).first();
}
function runIsCurrent(row, runId, now, workerToken) {
  return row?.runRendererVersion === RENDERER_VERSION && row.activeRunId === runId && Number.isFinite(row.leaseUntil) && row.leaseUntil > now
    && (workerToken === undefined || (row.workerToken === workerToken && row.workerActiveUntil > now));
}
function candidateIdentity(candidate) {
  const match = /^AHI-L1b-Japan\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{4})\/HS_H09_(\d{8})_(\d{4})_(B03|B13)_JP(0[1-4])_(R05|R20)_S0101\.DAT\.bz2$/.exec(candidate.key);
  if (!match) return false;
  const [, year, month, day, timeline, date, nameTime, band, jp, resolution] = match;
  if (date !== `${year}${month}${day}` || timeline !== nameTime || Number(timeline.slice(2)) % 10 !== 0
      || Number(timeline.slice(0, 2)) > 23 || Number(timeline.slice(2)) > 59) return false;
  const base = Date.parse(`${year}-${month}-${day}T${timeline.slice(0, 2)}:${timeline.slice(2)}:00Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 10) !== `${year}-${month}-${day}`) return false;
  const channel = band === "B03" ? "visible" : "infrared";
  return candidate.channel === channel && resolution === (channel === "visible" ? "R05" : "R20")
    && candidate.nominalTimeUtc === base + (Number(jp) - 1) * 150_000
    && Number.isFinite(candidate.sourceLastModifiedAt) && candidate.sourceLastModifiedAt >= candidate.nominalTimeUtc
    && Number.isInteger(candidate.sourceSize) && candidate.sourceSize > 0 && candidate.sourceSize <= 24 * 1024 * 1024;
}
async function existingFrame(ctx, key) {
  return await ctx.db.query("seoulSatelliteFrames").withIndex("by_station_key", q => q.eq("stationIcao", "RKSI").eq("sourceKey", key)).first();
}
async function cleanupUpload(ctx, storageId) {
  if (!storageId) return;
  const referenced = await ctx.db.query("seoulSatelliteFrames").withIndex("by_storage", q => q.eq("storageId", storageId)).first();
  const file = !referenced ? await ctx.db.system.get("_storage", storageId) : null;
  if (file && OWNED_CONTENT_TYPES.has(file.contentType)) await ctx.storage.delete(storageId);
}
async function prune(ctx, now) {
  const expired = await ctx.db.query("seoulSatelliteFrames")
    .withIndex("by_station_time", q => q.eq("stationIcao", "RKSI").lt("obsTimeUtc", now - HOUR)).take(150);
  for (const row of expired) {
    await ctx.db.delete(row._id);
    if (row.storageId) await cleanupUpload(ctx, row.storageId);
  }
  return expired.length;
}

// Cleanup is intentionally available while collection is disabled: switching
// off retrieval must not keep expired derived files indefinitely.
export const pruneExpiredFrames = internalMutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    station(args.stationIcao);
    const now = Date.now(), deleted = await prune(ctx, now), current = await statusRow(ctx);
    // The ownership marker is written atomically with each blob. It survives an
    // action terminating between storage.store() and scheduling its cleanup.
    const page = await ctx.db.system.query("_storage").order("asc").paginate({ cursor: current?.cleanupCursor ?? null, numItems: 200 });
    let orphanUploadsDeleted = 0;
    for (const file of page.page) {
      if (!OWNED_CONTENT_TYPES.has(file.contentType) || file._creationTime >= now - 5 * 60_000) continue;
      const reference = await ctx.db.query("seoulSatelliteFrames").withIndex("by_storage", q => q.eq("storageId", file._id)).first();
      if (!reference) { await ctx.storage.delete(file._id); orphanUploadsDeleted++; }
    }
    const fields = { cleanupCursor: page.isDone ? undefined : page.continueCursor, updatedAt: now,
      sourceFailures: (current?.sourceFailures ?? []).filter(f => f.nominalTimeUtc >= now - HOUR - ACQUISITION_MARGIN_MS) };
    if (current) await ctx.db.patch(current._id, fields);
    else await ctx.db.insert("seoulSatelliteCollectorStatus", { stationIcao: "RKSI", status: enabled() ? "idle" : "disabled",
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) });
    return { deleted, orphanUploadsDeleted, storageObjectsScanned: page.page.length };
  },
});

async function queue(ctx, args) {
  station(args.stationIcao);
  if (!enabled()) return { queued: false, status: "disabled" };
  const now = Date.now();
  const current = await statusRow(ctx);
  const currentRendererRun = current?.runRendererVersion === RENDERER_VERSION;
  if (currentRendererRun && current.activeRunId && current.leaseUntil > now) return { queued: false, status: "already_running" };
  if (currentRendererRun && Number.isFinite(current.queuedAt) && now - current.queuedAt < COOLDOWN_MS) return { queued: false, status: "cooldown" };
  const runId = `RKSI:${RENDERER_VERSION}:${now}`;
  const fields = { stationIcao: "RKSI", status: "queued", queuedAt: now, lastAttemptAt: now, updatedAt: now,
    activeRunId: runId, runStartedAt: now, runRendererVersion: RENDERER_VERSION, leaseUntil: now + LEASE_MS, workerSequence: 0,
    workerToken: undefined, workerActiveUntil: undefined, continuationCount: 0,
    planReady: false, pendingCandidates: [] };
  if (current) await ctx.db.patch(current._id, fields);
  else await ctx.db.insert("seoulSatelliteCollectorStatus", Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)));
  await ctx.scheduler.runAfter(0, internal.seoulSatelliteNode.collectFrames, { runId });
  return { queued: true, status: "queued" };
}

export const requestRefresh = mutationGeneric({ args: { stationIcao: v.optional(v.string()) }, handler: queue });
export const queueScheduledRefresh = internalMutationGeneric({ args: { stationIcao: v.optional(v.string()) }, handler: queue });

export const claimWorker = internalMutationGeneric({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now) || current.workerActiveUntil > now) return null;
    const sequence = (current.workerSequence ?? 0) + 1;
    const workerToken = `${args.runId}:${sequence}`;
    const pendingCandidates = (current.pendingCandidates ?? []).filter(c => c.nominalTimeUtc >= now - HOUR - ACQUISITION_MARGIN_MS && c.nominalTimeUtc <= now);
    await ctx.db.patch(current._id, { status: "collecting", workerToken, workerSequence: sequence,
      workerActiveUntil: now + LEASE_MS, leaseUntil: now + LEASE_MS, pendingCandidates, updatedAt: now });
    return { workerToken, rendererVersion: RENDERER_VERSION, planReady: current.planReady === true, pendingCandidates: pendingCandidates.slice(0, 4) };
  },
});

export const checkWorker = internalQueryGeneric({
  args: { runId: v.string(), workerToken: v.string() },
  handler: async (ctx, args) => {
    if (!enabled()) return false;
    return runIsCurrent(await statusRow(ctx), args.runId, Date.now(), args.workerToken);
  },
});

export const savePlan = internalMutationGeneric({
  args: { runId: v.string(), workerToken: v.string(), candidates: v.array(satelliteCandidate) },
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now, args.workerToken)) return null;
    if (args.candidates.length > MAX_PENDING || new Set(args.candidates.map(c => c.key)).size !== args.candidates.length
        || args.candidates.some(c => !candidateIdentity(c) || c.sourceLastModifiedAt > now)) throw new Error("Invalid satellite candidate plan.");
    const pendingCandidates = [];
    for (const candidate of [...args.candidates].sort((a, b) => b.nominalTimeUtc - a.nominalTimeUtc || a.channel.localeCompare(b.channel))) {
      if (candidate.nominalTimeUtc < now - HOUR - ACQUISITION_MARGIN_MS || candidate.nominalTimeUtc > now) continue;
      const existing = await existingFrame(ctx, candidate.key);
      if (existing?.rendererVersion !== RENDERER_VERSION) pendingCandidates.push(candidate);
    }
    await ctx.db.patch(current._id, { planReady: true, pendingCandidates,
      workerActiveUntil: now + LEASE_MS, leaseUntil: now + LEASE_MS, updatedAt: now });
    return pendingCandidates.slice(0, 4);
  },
});

export const saveFrame = internalMutationGeneric({
  args: { runId: v.string(), workerToken: v.string(), frame: satelliteFrameValidator },
  handler: async (ctx, args) => {
    const frame = args.frame;
    if (!enabled()) { await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "disabled" }; }
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now, args.workerToken)) {
      await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "superseded" };
    }
    const candidate = (current.pendingCandidates ?? []).find(c => c.key === frame.sourceKey);
    if (frame.rendererVersion !== RENDERER_VERSION || !candidate || !candidateIdentity(candidate) || candidate.channel !== frame.channel || candidate.nominalTimeUtc !== frame.nominalTimeUtc
        || candidate.sourceSize !== frame.sourceSize || candidate.sourceLastModifiedAt !== frame.sourceLastModifiedAt
        || ![frame.obsTimeUtc, frame.fetchedAt, frame.capturedAt].every(Number.isFinite)
        || frame.obsTimeUtc < frame.nominalTimeUtc || frame.obsTimeUtc > frame.nominalTimeUtc + 150_000
        || frame.fetchedAt < current.runStartedAt || frame.fetchedAt > frame.capturedAt || frame.capturedAt > now
        || (frame.status === "ok" && !frame.storageId) || (frame.status !== "ok" && frame.storageId)) {
      await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "invalid_frame" };
    }
    if (frame.obsTimeUtc < now - HOUR || frame.obsTimeUtc > now || frame.nominalTimeUtc > now) {
      await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "expired_or_future" };
    }
    const existing = await existingFrame(ctx, frame.sourceKey);
    if (existing?.rendererVersion === RENDERER_VERSION) {
      await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "duplicate" };
    }
    // A failed rerender must not turn a previously usable image into a gap or
    // discard its blob. A source replacement is not merely a renderer upgrade.
    if (existing?.status === "ok" && frame.status !== "ok") {
      await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "upgrade_unavailable" };
    }
    if (existing && (existing.sourceSize !== frame.sourceSize || existing.sourceLastModifiedAt !== frame.sourceLastModifiedAt
        || (existing.sourceSha256 && existing.sourceSha256 !== frame.sourceSha256))) {
      await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "source_changed" };
    }
    if (frame.status === "ok") {
      const storage = await ctx.db.system.get("_storage", frame.storageId);
      if (!storage || storage.contentType !== IMAGE_CONTENT_TYPE || storage.size <= 0 || storage.size > MAX_IMAGE_BYTES
          || frame.geometry?.spanKm !== 100 || Math.abs(frame.geometry?.centerLatitude - 37.4602) > 0.001
          || Math.abs(frame.geometry?.centerLongitude - 126.4407) > 0.001
          || !Number.isFinite(frame.geometry?.centerLatitude) || !Number.isFinite(frame.geometry?.centerLongitude)
          || !Number.isFinite(frame.validFraction) || frame.validFraction < 0.9 || frame.validFraction > 1
          || JSON.stringify({ geometry: frame.geometry, display: frame.display }).length > 20_000) {
        await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "invalid_image" };
      }
    }
    const storedFrame = { ...frame, ...(frame.reason ? { reason: concise(frame.reason) } : {}) };
    if (existing) {
      await ctx.db.replace(existing._id, storedFrame);
      if (existing.storageId && existing.storageId !== frame.storageId) await cleanupUpload(ctx, existing.storageId);
    } else await ctx.db.insert("seoulSatelliteFrames", storedFrame);
    await ctx.db.patch(current._id, { ...(frame.status === "ok" ? { lastSuccessAt: now } : {}),
      workerActiveUntil: now + LEASE_MS, leaseUntil: now + LEASE_MS, updatedAt: now,
      sourceFailures: (current.sourceFailures ?? []).filter(f => f.key !== frame.sourceKey && f.nominalTimeUtc >= now - HOUR - ACQUISITION_MARGIN_MS) });
    return { stored: true, replaced: Boolean(existing), status: frame.status };
  },
});

export const recordSourceFailure = internalMutationGeneric({
  args: { runId: v.string(), workerToken: v.string(), key: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    if (!enabled()) return { recorded: false, status: "disabled" };
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now, args.workerToken)) return { recorded: false, status: "superseded" };
    const candidate = (current.pendingCandidates ?? []).find(c => c.key === args.key);
    if (!candidate) return { recorded: false, status: "unknown_candidate" };
    const failures = (current.sourceFailures ?? []).filter(f => f.key !== args.key && f.nominalTimeUtc >= now - HOUR - ACQUISITION_MARGIN_MS);
    failures.push({ key: candidate.key, channel: candidate.channel, nominalTimeUtc: candidate.nominalTimeUtc,
      failedAt: now, error: concise(args.error) });
    await ctx.db.patch(current._id, { sourceFailures: failures.slice(-50), lastError: concise(args.error),
      workerActiveUntil: now + LEASE_MS, leaseUntil: now + LEASE_MS, updatedAt: now });
    return { recorded: true, status: "source_failed" };
  },
});

export const finishWorker = internalMutationGeneric({
  args: { runId: v.string(), workerToken: v.string(), attemptedKeys: v.array(v.string()), error: v.optional(v.string()), continueAfterErrors: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (!enabled()) return { status: "disabled", continued: false };
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now, args.workerToken)) return { status: "superseded", continued: false };
    if (args.attemptedKeys.length > 4) throw new Error("Satellite worker exceeds its four-frame batch.");
    const attempted = new Set(args.attemptedKeys);
    const pending = (current.pendingCandidates ?? []).filter(c => !attempted.has(c.key) && c.nominalTimeUtc >= now - HOUR - ACQUISITION_MARGIN_MS && c.nominalTimeUtc <= now);
    const count = (current.continuationCount ?? 0) + 1;
    const continued = (!args.error || args.continueAfterErrors === true) && current.planReady === true && pending.length > 0 && count < 13;
    const error = args.error ?? (current.sourceFailures ?? []).find(f => f.failedAt >= current.runStartedAt)?.error;
    const status = error ? (current.lastSuccessAt >= current.runStartedAt ? "partial" : "error") : continued ? "collecting" : "idle";
    await ctx.db.patch(current._id, { status,
      lastAttemptAt: now, lastError: error ? concise(error) : undefined, updatedAt: now,
      workerToken: undefined, workerActiveUntil: undefined, continuationCount: count,
      pendingCandidates: continued ? pending : [], activeRunId: continued ? args.runId : undefined,
      leaseUntil: continued ? now + LEASE_MS : undefined });
    if (continued) await ctx.scheduler.runAfter(1_000, internal.seoulSatelliteNode.collectFrames, { runId: args.runId });
    return { status, continued };
  },
});

export const deleteUploadIfUnreferenced = internalMutationGeneric({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => { await cleanupUpload(ctx, args.storageId); return null; },
});

export const getLoop = queryGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    station(args.stationIcao);
    const now = Date.now();
    const base = { stationIcao: "RKSI", source: "noaa_himawari9", sourceLabel: "JMA Himawari-9 via NOAA AWS Open Data", rendererVersion: RENDERER_VERSION,
      extentKm: 100, center: { latitude: 37.4602, longitude: 126.4407 },
      windowStartUtc: now - HOUR, windowEndUtc: now, staleAfterMs: STALE_MS, retentionMinutes: 60 };
    const blank = { status: "disabled", frames: [], latestObservedAt: null, latestCapturedAt: null, stale: true, unavailableReason: "Satellite image collection is disabled." };
    if (!enabled()) return { ...base, enabled: false, status: "disabled", frames: [], channels: { visible: blank, infrared: blank }, collector: null };
    const collector = await statusRow(ctx);
    const channels = {};
    for (const channel of ["visible", "infrared"]) {
      const rows = await ctx.db.query("seoulSatelliteFrames")
        .withIndex("by_station_channel_time", q => q.eq("stationIcao", "RKSI").eq("channel", channel).gte("obsTimeUtc", now - HOUR).lte("obsTimeUtc", now))
        .order("asc").take(30);
      // Switch each channel as a whole after its first current-renderer image;
      // issuing only one version's URLs prevents contrast flicker during refill.
      const hasCurrentImage = rows.some(row => row.status === "ok" && row.storageId && row.rendererVersion === RENDERER_VERSION && row.nominalTimeUtc <= now);
      const hasLegacyImage = rows.some(row => row.status === "ok" && row.storageId && (row.rendererVersion ?? LEGACY_RENDERER_VERSION) === LEGACY_RENDERER_VERSION && row.nominalTimeUtc <= now);
      const rendererVersion = hasCurrentImage || (!hasLegacyImage && rows.some(row => row.rendererVersion === RENDERER_VERSION))
        ? RENDERER_VERSION : LEGACY_RENDERER_VERSION;
      const selectedRows = rows.filter(row => (row.rendererVersion ?? LEGACY_RENDERER_VERSION) === rendererVersion);
      const frames = [];
      for (const row of selectedRows) {
        if (row.status !== "ok" || !row.storageId || row.nominalTimeUtc > now) continue;
        const url = await ctx.storage.getUrl(row.storageId);
        if (!url) continue;
        frames.push({ id: row._id, url, channel, rendererVersion, obsTimeUtc: row.obsTimeUtc, observedAt: row.obsTimeUtc,
          nominalTimeUtc: row.nominalTimeUtc, capturedAt: row.capturedAt, sourceLastModifiedAt: row.sourceLastModifiedAt,
          solarElevationDeg: row.solarElevationDeg ?? null, validFraction: row.validFraction ?? null,
          geometry: row.geometry ?? null, display: row.display ?? null });
      }
      const latest = frames.at(-1), lastRecord = rows.at(-1);
      const unavailableReason = lastRecord?.status === "unavailable" && (!latest || lastRecord.nominalTimeUtc >= latest.nominalTimeUtc)
        ? lastRecord.reason ?? "The newest image did not pass source or display quality checks." : null;
      const stale = !latest || now - latest.obsTimeUtc > STALE_MS;
      channels[channel] = { status: unavailableReason ? "unavailable" : frames.length ? (stale ? "stale" : "ok") : "no_data",
        rendererVersion, frames, latestObservedAt: latest?.obsTimeUtc ?? null, latestCapturedAt: latest?.capturedAt ?? null, stale, unavailableReason };
    }
    const frames = [...channels.visible.frames, ...channels.infrared.frames].sort((a, b) => a.obsTimeUtc - b.obsTimeUtc || a.channel.localeCompare(b.channel));
    const inFlight = Boolean(collector?.activeRunId && collector.leaseUntil > now);
    const status = !frames.length ? (inFlight ? "initializing" : collector?.status === "error" ? "error" : "no_data")
      : channels.visible.stale && channels.infrared.stale ? "stale" : "ok";
    return { ...base, enabled: true, status, frames, channels,
      collector: collector ? { status: collector.status, lastAttemptAt: collector.lastAttemptAt ?? null,
        lastSuccessAt: collector.lastSuccessAt ?? null, updatedAt: collector.updatedAt, inFlight,
        queuedAt: collector.queuedAt ?? null, lastError: collector.lastError ?? null,
        sourceFailures: (collector.sourceFailures ?? []).filter(f => f.nominalTimeUtc >= now - HOUR - ACQUISITION_MARGIN_MS) } : null };
  },
});
