import { internalMutationGeneric, internalQueryGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { GOCI2_IMAGE_CONTENT_TYPE, GOCI2_IMAGE_SIZE, GOCI2_IMAGE_SPAN_KM, GOCI2_RENDERER_VERSION, GOCI2_RETENTION_MS,
  GOCI2_SOURCE_LABEL, goci2FrameValidator } from "./lib/seoulGoci2Schema.js";
import { goci2DaylightWindowOpen, GOCI2_MAX_WINDOW_ELEMENTS, parseGoci2Directory, parseGoci2SourceKey, RKSI } from "./lib/seoulGoci2Source.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LEASE_MS = 5 * MINUTE;
const COOLDOWN_MS = 2 * MINUTE;
const NEXT_OBSERVATION_MS = 50 * MINUTE;
const FAILURE_BACKOFF_MS = 30 * MINUTE;
const STALE_MS = 80 * MINUTE;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// KHOA/NOSC approval covers automated download, storage and public display
// together. Only the exact string "true" enables any of them.
function approved() { return process.env.KHOA_GOCI2_ACCESS_APPROVED === "true"; }
function station(value) {
  if (String(value ?? "RKSI").trim().toUpperCase() !== "RKSI") throw new Error("GOCI-II images support RKSI only.");
  return "RKSI";
}
function concise(value) { return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300); }
async function statusRow(ctx) {
  return await ctx.db.query("seoulGoci2CollectorStatus").withIndex("by_station", q => q.eq("stationIcao", "RKSI")).first();
}
function runIsCurrent(row, runId, now, workerToken) {
  return Boolean(row?.activeRunId) && row.activeRunId === runId && Number.isFinite(row.leaseUntil) && row.leaseUntil > now
    && (workerToken === undefined || (row.workerToken === workerToken && row.workerActiveUntil > now));
}
async function cleanupUpload(ctx, storageId) {
  if (!storageId) return;
  const referenced = await ctx.db.query("seoulGoci2Frames").withIndex("by_storage", q => q.eq("storageId", storageId)).first();
  const file = !referenced ? await ctx.db.system.get("_storage", storageId) : null;
  if (file?.contentType === GOCI2_IMAGE_CONTENT_TYPE) await ctx.storage.delete(storageId);
}
async function deleteFrames(ctx, rows) {
  for (const row of rows) {
    await ctx.db.delete(row._id);
    if (row.storageId) await cleanupUpload(ctx, row.storageId);
  }
  return rows.length;
}
const sha256 = value => /^[a-f0-9]{64}$/.test(value ?? "");
const integer = value => Number.isSafeInteger(value);

function validFrame(frame, current, now) {
  const identity = parseGoci2SourceKey(frame.sourceKey), subset = frame.subset;
  const times = [frame.nominalTimeUtc, frame.obsTimeUtc, frame.observationStartUtc, frame.observationEndUtc, frame.fetchedAt, frame.capturedAt];
  return frame.rendererVersion === GOCI2_RENDERER_VERSION && identity !== null && identity.slot === frame.slot
    && identity.nominalTimeUtc === frame.nominalTimeUtc && times.every(Number.isFinite)
    && frame.observationStartUtc <= frame.obsTimeUtc && frame.obsTimeUtc <= frame.observationEndUtc
    && frame.observationEndUtc - frame.observationStartUtc <= 5 * MINUTE
    && frame.observationStartUtc >= frame.nominalTimeUtc - 10 * MINUTE && frame.observationStartUtc <= frame.nominalTimeUtc + 40 * MINUTE
    && frame.obsTimeUtc <= now && frame.obsTimeUtc >= now - GOCI2_RETENTION_MS
    && frame.fetchedAt >= current.runStartedAt && frame.fetchedAt <= frame.capturedAt && frame.capturedAt <= now
    && (frame.status === "ok") === Boolean(frame.storageId) && (frame.status !== "ok" || sha256(frame.imageSha256))
    && (frame.sourceSize === undefined || (integer(frame.sourceSize) && frame.sourceSize > 0))
    && (frame.sourceLastModifiedAt === undefined || Number.isFinite(frame.sourceLastModifiedAt))
    && frame.sourceObjects.length >= 1 && frame.sourceObjects.length <= 16
    && frame.sourceObjects.every(source => sha256(source.sha256) && integer(source.bytes) && source.bytes > 0
      && source.variable.length <= 64 && source.constraint.length <= 200)
    && [subset.rowStart, subset.rowEnd, subset.columnStart, subset.columnEnd, subset.gridRows, subset.gridColumns].every(integer)
    && subset.rowStart >= 0 && subset.rowStart < subset.rowEnd && subset.rowEnd < subset.gridRows && subset.gridRows <= 10_000
    && subset.columnStart >= 0 && subset.columnStart < subset.columnEnd && subset.columnEnd < subset.gridColumns && subset.gridColumns <= 10_000
    && (subset.rowEnd - subset.rowStart + 1) * (subset.columnEnd - subset.columnStart + 1) <= GOCI2_MAX_WINDOW_ELEMENTS;
}

async function queue(ctx, args) {
  station(args.stationIcao);
  if (!approved()) return { queued: false, status: "approval_required" };
  const now = Date.now();
  if (!goci2DaylightWindowOpen(now)) return { queued: false, status: "outside_daylight" };
  const current = await statusRow(ctx);
  if (current?.activeRunId && current.leaseUntil > now) return { queued: false, status: "already_running" };
  if (Number.isFinite(current?.queuedAt) && now - current.queuedAt < COOLDOWN_MS) return { queued: false, status: "cooldown" };
  // Local-area slots are hourly; no newer observation can exist this soon.
  const newest = await ctx.db.query("seoulGoci2Frames")
    .withIndex("by_station_time", q => q.eq("stationIcao", "RKSI").lte("obsTimeUtc", now)).order("desc").first();
  if (newest?.rendererVersion === GOCI2_RENDERER_VERSION && now - newest.obsTimeUtc < NEXT_OBSERVATION_MS) {
    return { queued: false, status: "waiting_for_next_observation" };
  }
  const runId = `RKSI:goci2:${now}`;
  const fields = { stationIcao: "RKSI", status: "queued", queuedAt: now, lastAttemptAt: now, updatedAt: now,
    activeRunId: runId, runStartedAt: now, leaseUntil: now + LEASE_MS, workerSequence: 0,
    workerToken: undefined, workerActiveUntil: undefined };
  if (current) await ctx.db.patch(current._id, fields);
  else await ctx.db.insert("seoulGoci2CollectorStatus", Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)));
  await ctx.scheduler.runAfter(0, internal.seoulGoci2Node.collectLatest, { runId });
  return { queued: true, status: "queued" };
}

export const requestRefresh = mutationGeneric({ args: { stationIcao: v.optional(v.string()) }, handler: queue });
export const queueScheduledRefresh = internalMutationGeneric({ args: { stationIcao: v.optional(v.string()) }, handler: queue });

export const claimWorker = internalMutationGeneric({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    if (!approved()) return null;
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now) || current.workerActiveUntil > now) return null;
    const sequence = (current.workerSequence ?? 0) + 1, workerToken = `${args.runId}:${sequence}`;
    await ctx.db.patch(current._id, { status: "collecting", workerToken, workerSequence: sequence,
      workerActiveUntil: now + LEASE_MS, leaseUntil: now + LEASE_MS, updatedAt: now });
    const recent = await ctx.db.query("seoulGoci2Frames")
      .withIndex("by_station_time", q => q.eq("stationIcao", "RKSI").gte("obsTimeUtc", now - 4 * HOUR)).take(24);
    return { workerToken, rendererVersion: GOCI2_RENDERER_VERSION, lastSlot: current.lastSlot ?? null,
      completedNominalTimes: recent.filter(row => row.rendererVersion === GOCI2_RENDERER_VERSION).map(row => row.nominalTimeUtc),
      backoffNominalTimes: (current.sourceFailures ?? []).filter(failure => now - failure.failedAt < FAILURE_BACKOFF_MS)
        .map(failure => failure.nominalTimeUtc) };
  },
});

export const checkWorker = internalQueryGeneric({
  args: { runId: v.string(), workerToken: v.string() },
  handler: async (ctx, args) => {
    if (!approved()) return false;
    return runIsCurrent(await statusRow(ctx), args.runId, Date.now(), args.workerToken);
  },
});

export const saveFrame = internalMutationGeneric({
  args: { runId: v.string(), workerToken: v.string(), frame: goci2FrameValidator },
  handler: async (ctx, args) => {
    const frame = args.frame;
    if (!approved()) { await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "approval_required" }; }
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now, args.workerToken)) {
      await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "superseded" };
    }
    if (!validFrame(frame, current, now)) { await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "invalid_frame" }; }
    const existing = await ctx.db.query("seoulGoci2Frames")
      .withIndex("by_station_key", q => q.eq("stationIcao", "RKSI").eq("sourceKey", frame.sourceKey)).first();
    if (existing?.rendererVersion === GOCI2_RENDERER_VERSION) {
      await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "duplicate" };
    }
    if (frame.status === "ok") {
      const storage = await ctx.db.system.get("_storage", frame.storageId);
      const geometry = frame.geometry;
      if (!storage || storage.contentType !== GOCI2_IMAGE_CONTENT_TYPE || storage.size <= 0 || storage.size > MAX_IMAGE_BYTES
          || geometry?.spanKm !== GOCI2_IMAGE_SPAN_KM || geometry?.width !== GOCI2_IMAGE_SIZE || geometry?.height !== GOCI2_IMAGE_SIZE
          || !(Math.abs(geometry?.centerLatitude - RKSI.latitude) <= 0.001) || !(Math.abs(geometry?.centerLongitude - RKSI.longitude) <= 0.001)
          || !Number.isFinite(frame.validFraction) || frame.validFraction < 0.9 || frame.validFraction > 1
          || JSON.stringify({ geometry: frame.geometry, display: frame.display }).length > 20_000) {
        await cleanupUpload(ctx, frame.storageId); return { stored: false, status: "invalid_image" };
      }
    }
    const stored = { ...frame, ...(frame.reason ? { reason: concise(frame.reason) } : {}) };
    if (existing) {
      await ctx.db.replace(existing._id, stored);
      if (existing.storageId && existing.storageId !== frame.storageId) await cleanupUpload(ctx, existing.storageId);
    } else await ctx.db.insert("seoulGoci2Frames", stored);
    await ctx.db.patch(current._id, { lastSlot: frame.slot, ...(frame.status === "ok" ? { lastSuccessAt: now } : {}),
      workerActiveUntil: now + LEASE_MS, leaseUntil: now + LEASE_MS, updatedAt: now,
      sourceFailures: (current.sourceFailures ?? []).filter(failure => failure.nominalTimeUtc !== frame.nominalTimeUtc
        && failure.failedAt >= now - GOCI2_RETENTION_MS) });
    return { stored: true, replaced: Boolean(existing), status: frame.status };
  },
});

export const recordSourceFailure = internalMutationGeneric({
  args: { runId: v.string(), workerToken: v.string(), directoryKey: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    if (!approved()) return { recorded: false, status: "approval_required" };
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now, args.workerToken)) return { recorded: false, status: "superseded" };
    const parts = args.directoryKey.split("/"), directory = parts.length === 6 ? parseGoci2Directory(parts[5], parts.slice(0, 5).join("/")) : null;
    if (!directory || directory.nominalTimeUtc > now || directory.nominalTimeUtc < now - 4 * HOUR) return { recorded: false, status: "invalid_directory" };
    const failures = (current.sourceFailures ?? []).filter(failure => failure.sourceKey !== args.directoryKey
      && failure.failedAt >= now - GOCI2_RETENTION_MS);
    failures.push({ sourceKey: args.directoryKey, nominalTimeUtc: directory.nominalTimeUtc, failedAt: now, error: concise(args.error) });
    await ctx.db.patch(current._id, { sourceFailures: failures.slice(-20), lastError: concise(args.error),
      workerActiveUntil: now + LEASE_MS, leaseUntil: now + LEASE_MS, updatedAt: now });
    return { recorded: true, status: "source_failed" };
  },
});

export const finishWorker = internalMutationGeneric({
  args: { runId: v.string(), workerToken: v.string(), error: v.optional(v.string()), waiting: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (!approved()) return { status: "approval_required" };
    const now = Date.now(), current = await statusRow(ctx);
    if (!runIsCurrent(current, args.runId, now, args.workerToken)) return { status: "superseded" };
    const status = args.error ? (current.lastSuccessAt >= current.runStartedAt ? "partial" : "error") : args.waiting ? "waiting" : "idle";
    await ctx.db.patch(current._id, { status, lastAttemptAt: now, lastError: args.error ? concise(args.error) : undefined,
      updatedAt: now, workerToken: undefined, workerActiveUntil: undefined, activeRunId: undefined, leaseUntil: undefined });
    return { status };
  },
});

// Deletion-only maintenance stays available while access is not approved:
// revoking approval must never keep derived images longer.
export const deleteUploadIfUnreferenced = internalMutationGeneric({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => { await cleanupUpload(ctx, args.storageId); return null; },
});

export const pruneExpiredFrames = internalMutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    station(args.stationIcao);
    const now = Date.now(), current = await statusRow(ctx);
    const deleted = await deleteFrames(ctx, await ctx.db.query("seoulGoci2Frames")
      .withIndex("by_station_time", q => q.eq("stationIcao", "RKSI").lt("obsTimeUtc", now - GOCI2_RETENTION_MS)).take(100));
    // Recovers blobs whose worker stopped between storage.store() and saveFrame.
    const page = await ctx.db.system.query("_storage").order("asc").paginate({ cursor: current?.cleanupCursor ?? null, numItems: 200 });
    let orphanUploadsDeleted = 0;
    for (const file of page.page) {
      if (file.contentType !== GOCI2_IMAGE_CONTENT_TYPE || file._creationTime >= now - 10 * MINUTE) continue;
      const reference = await ctx.db.query("seoulGoci2Frames").withIndex("by_storage", q => q.eq("storageId", file._id)).first();
      if (!reference) { await ctx.storage.delete(file._id); orphanUploadsDeleted++; }
    }
    const fields = { cleanupCursor: page.isDone ? undefined : page.continueCursor, updatedAt: now,
      sourceFailures: (current?.sourceFailures ?? []).filter(failure => failure.failedAt >= now - GOCI2_RETENTION_MS) };
    if (current) await ctx.db.patch(current._id, fields);
    else await ctx.db.insert("seoulGoci2CollectorStatus", { stationIcao: "RKSI", status: approved() ? "idle" : "approval_required",
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) });
    return { deleted, orphanUploadsDeleted, storageObjectsScanned: page.page.length };
  },
});

/** Operator tool after revocation: deletes stored GOCI-II rows and images now. */
export const purgeStoredImages = internalMutationGeneric({
  args: {},
  handler: async ctx => {
    const rows = await ctx.db.query("seoulGoci2Frames").withIndex("by_station_time", q => q.eq("stationIcao", "RKSI")).take(100);
    const deleted = await deleteFrames(ctx, rows);
    return { deleted, remaining: Boolean(await ctx.db.query("seoulGoci2Frames").withIndex("by_station_time", q => q.eq("stationIcao", "RKSI")).first()) };
  },
});

export const getLatest = queryGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    station(args.stationIcao);
    const now = Date.now();
    const base = { stationIcao: "RKSI", source: "khoa_nosc_goci2", sourceLabel: GOCI2_SOURCE_LABEL, rendererVersion: GOCI2_RENDERER_VERSION,
      extentKm: GOCI2_IMAGE_SPAN_KM, center: { ...RKSI }, retentionHours: GOCI2_RETENTION_MS / HOUR, staleAfterMs: STALE_MS };
    // No database read, storage URL or collector detail before approval.
    if (!approved()) {
      return { ...base, approved: false, status: "approval_required", frames: [], latestObservedAt: null,
        unavailableReason: null, daylightWindowOpen: null, collector: null };
    }
    const collector = await statusRow(ctx);
    const rows = (await ctx.db.query("seoulGoci2Frames")
      .withIndex("by_station_time", q => q.eq("stationIcao", "RKSI").gte("obsTimeUtc", now - GOCI2_RETENTION_MS).lte("obsTimeUtc", now))
      .order("asc").take(40)).filter(row => row.rendererVersion === GOCI2_RENDERER_VERSION);
    const frames = [];
    for (const row of rows) {
      if (row.status !== "ok" || !row.storageId) continue;
      const url = await ctx.storage.getUrl(row.storageId);
      if (!url) continue;
      frames.push({ id: row._id, url, obsTimeUtc: row.obsTimeUtc, nominalTimeUtc: row.nominalTimeUtc,
        observationStartUtc: row.observationStartUtc, observationEndUtc: row.observationEndUtc, capturedAt: row.capturedAt,
        slot: row.slot, solarElevationDeg: row.solarElevationDeg ?? null, validFraction: row.validFraction ?? null,
        geometry: row.geometry ?? null, display: row.display ?? null });
    }
    const latest = frames.at(-1), lastRecord = rows.at(-1);
    let unavailableReason = lastRecord?.status === "unavailable" && (!latest || lastRecord.obsTimeUtc > latest.obsTimeUtc)
      ? lastRecord.reason ?? "The newest GOCI-II image did not pass quality checks." : null;
    const failure = [...(collector?.sourceFailures ?? [])].filter(item => item.failedAt >= now - 3 * HOUR)
      .sort((a, b) => b.nominalTimeUtc - a.nominalTimeUtc)[0];
    if (!unavailableReason && failure && (!lastRecord || failure.nominalTimeUtc > lastRecord.nominalTimeUtc)) {
      unavailableReason = `The latest hourly image could not be collected: ${failure.error}`;
    }
    const daylightWindowOpen = goci2DaylightWindowOpen(now);
    const inFlight = Boolean(collector?.activeRunId && collector.leaseUntil > now);
    const stale = !latest || now - latest.obsTimeUtc > STALE_MS;
    const status = unavailableReason ? "unavailable" : latest ? (stale ? (daylightWindowOpen ? "stale" : "outside_daylight") : "ok")
      : inFlight ? "collecting" : !daylightWindowOpen ? "outside_daylight" : collector?.status === "error" ? "error" : "no_data";
    return { ...base, approved: true, status, frames, latestObservedAt: latest?.obsTimeUtc ?? null, unavailableReason,
      daylightWindowOpen, collector: collector ? { status: collector.status, lastAttemptAt: collector.lastAttemptAt ?? null,
        lastSuccessAt: collector.lastSuccessAt ?? null, inFlight, lastError: collector.lastError ?? null } : null };
  },
});
