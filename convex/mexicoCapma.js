import { internal } from "./_generated/api.js";
import {
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { capmaTdzApprovalState } from "./mexicoCapmaApprovals.js";

const STATION_ICAO = "MMMX";
const MEXICO_TIMEZONE = "America/Mexico_City";
const TDZ23_STAGGER_MS = 30_000;
const REPLACED_IMAGE_DELETE_GRACE_MS = 120_000;

const mexicoDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MEXICO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const mexicoDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MEXICO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getDateParts(formatter, epochMs) {
  const values = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatMexicoDate(epochMs) {
  const parts = getDateParts(mexicoDateFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatMexicoDateTime(epochMs) {
  const parts = getDateParts(mexicoDateTimeFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function capmaGateState() {
  const { accessApproved, retentionApproved, republicationApproved } =
    capmaTdzApprovalState();
  return { accessApproved, retentionApproved, republicationApproved };
}

export function decideCapmaLatestImageUpdate({
  current,
  currentStorageValid,
  incoming,
}) {
  if (!current) {
    return "insert_first";
  }
  if (incoming.screenTimeUtc < current.screenTimeUtc) {
    return "keep_newer_current";
  }
  if (incoming.screenTimeUtc === current.screenTimeUtc) {
    if (currentStorageValid) {
      return current.rawHash === incoming.rawHash
        ? "keep_unchanged"
        : "keep_equal_timestamp_current";
    }
    return "repair_equal_timestamp";
  }
  return currentStorageValid ? "replace_with_newer" : "repair_with_newer";
}

export function capmaStorageDigestMatches({
  actualStorageSha256,
  expectedStorageSha256,
  rawHash,
}) {
  return (
    actualStorageSha256 === expectedStorageSha256 ||
    actualStorageSha256 === rawHash
  );
}

export function selectCapmaHttpImageRow(current, requestedRawHash) {
  if (!current) {
    return null;
  }
  return {
    row: current,
    versionMatched: current.rawHash === requestedRawHash,
  };
}

async function setApprovalRequiredStatus(ctx, source) {
  const now = Date.now();
  const existing = await ctx.db
    .query("mexicoCollectorStatus")
    .withIndex("by_station_source", (query) =>
      query.eq("stationIcao", STATION_ICAO).eq("source", source),
    )
    .first();
  const value = {
    stationIcao: STATION_ICAO,
    source,
    status: "approval_required",
    lastAttemptAt: now,
    lastError:
      "SENEAM/CAPMA image access and retention approval are required before this collector can be queued.",
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, value);
  } else {
    await ctx.db.insert("mexicoCollectorStatus", value);
  }
}

async function queueCapmaRefresh(ctx, trigger) {
  const gates = capmaGateState();
  if (!gates.accessApproved || !gates.retentionApproved) {
    await Promise.all([
      setApprovalRequiredStatus(ctx, "capma_tdz05"),
      setApprovalRequiredStatus(ctx, "capma_tdz23"),
    ]);
    return {
      status: "approval_required",
      queued: false,
      gates,
    };
  }
  await Promise.all([
    ctx.scheduler.runAfter(0, internal.mexicoCapmaNode.collectCapmaImage, {
      stationIcao: STATION_ICAO,
      tdz: "05",
      trigger,
    }),
    ctx.scheduler.runAfter(
      TDZ23_STAGGER_MS,
      internal.mexicoCapmaNode.collectCapmaImage,
      { stationIcao: STATION_ICAO, tdz: "23", trigger },
    ),
  ]);
  return {
    status: "queued",
    queued: true,
    gates,
    schedule: {
      tdz05DelayMs: 0,
      tdz23DelayMs: TDZ23_STAGGER_MS,
    },
  };
}

export const getAccessState = queryGeneric({
  args: {},
  handler: async () => capmaGateState(),
});

export const requestCapmaRefresh = mutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = (args.stationIcao ?? STATION_ICAO).trim().toUpperCase();
    if (stationIcao !== STATION_ICAO) {
      throw new Error("The CAPMA image collector supports MMMX only.");
    }
    return await queueCapmaRefresh(ctx, "manual");
  },
});

export const queueScheduledCapmaRefresh = internalMutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = (args.stationIcao ?? STATION_ICAO).trim().toUpperCase();
    if (stationIcao !== STATION_ICAO) {
      throw new Error("The CAPMA image collector supports MMMX only.");
    }
    return await queueCapmaRefresh(ctx, "scheduled");
  },
});

const capmaObservationValidator = v.object({
  stationIcao: v.string(),
  tdz: v.union(v.literal("05"), v.literal("23")),
  screenTimeUtc: v.number(),
  screenTimestampRaw: v.string(),
  currentTempC: v.number(),
  currentTempF: v.number(),
  twoMinuteTempC: v.number(),
  twoMinuteTempF: v.number(),
  dewpointC: v.optional(v.number()),
  dewpointConfidence: v.optional(v.number()),
  humidityPercent: v.optional(v.number()),
  humidityConfidence: v.optional(v.number()),
  stationPressureHpa: v.optional(v.number()),
  stationPressureConfidence: v.optional(v.number()),
  qnhInHg: v.optional(v.number()),
  qnhConfidence: v.optional(v.number()),
  twoMinuteDewpointC: v.optional(v.number()),
  twoMinuteDewpointConfidence: v.optional(v.number()),
  fetchTransport: v.optional(
    v.union(v.literal("direct"), v.literal("vercel_relay")),
  ),
  sourceUrl: v.string(),
  rawHash: v.string(),
  etag: v.optional(v.string()),
  relayLastModifiedAt: v.optional(v.number()),
  firstSeenAt: v.number(),
  fetchStartedAt: v.number(),
  fetchCompletedAt: v.number(),
  responseBytes: v.number(),
  imageWidth: v.number(),
  imageHeight: v.number(),
  ocrConfidence: v.number(),
  ocrEngine: v.string(),
  trigger: v.union(v.literal("manual"), v.literal("scheduled")),
});

const capmaLatestImageValidator = v.object({
  storageId: v.id("_storage"),
  contentType: v.literal("image/jpeg"),
  expectedStorageSha256: v.string(),
});

export const storeCapmaObservation = internalMutationGeneric({
  args: {
    row: capmaObservationValidator,
    latestImage: capmaLatestImageValidator,
  },
  handler: async (ctx, args) => {
    const gates = capmaGateState();
    if (!gates.accessApproved || !gates.retentionApproved) {
      throw new Error(
        "CAPMA access or retention approval was removed before storage; no row was retained.",
      );
    }
    if (args.row.stationIcao !== STATION_ICAO) {
      throw new Error("The CAPMA storage mutation supports MMMX only.");
    }

    // The action uploads first because only actions can call storage.store().
    // Validate that exact object inside this transaction before attaching it
    // to the singleton metadata row or deleting the prior object.
    const uploadedMetadata = await ctx.db.system.get(
      "_storage",
      args.latestImage.storageId,
    );
    if (!uploadedMetadata) {
      throw new Error(
        "The uploaded CAPMA JPEG is no longer present in storage.",
      );
    }
    const uploadedHashMatches = capmaStorageDigestMatches({
      actualStorageSha256: uploadedMetadata.sha256,
      expectedStorageSha256: args.latestImage.expectedStorageSha256,
      rawHash: args.row.rawHash,
    });
    const uploadedSizeMatches =
      uploadedMetadata.size === args.row.responseBytes;
    const uploadedTypeMatches =
      uploadedMetadata.contentType === args.latestImage.contentType;
    if (!uploadedHashMatches || !uploadedSizeMatches || !uploadedTypeMatches) {
      throw new Error(
        "The uploaded CAPMA JPEG metadata did not match the validated response " +
          `(sha256=${uploadedHashMatches ? "match" : `mismatch:${uploadedMetadata.sha256.length}`}, ` +
          `size=${uploadedMetadata.size}/${args.row.responseBytes}, ` +
          `contentType=${uploadedMetadata.contentType ?? "missing"}/${args.latestImage.contentType}).`,
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("mexicoCapmaTdzObservations")
      .withIndex("by_station_tdz_hash", (query) =>
        query
          .eq("stationIcao", STATION_ICAO)
          .eq("tdz", args.row.tdz)
          .eq("rawHash", args.row.rawHash),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: args.row.fetchCompletedAt,
        ...(args.row.etag !== undefined ? { etag: args.row.etag } : {}),
        ...(args.row.relayLastModifiedAt !== undefined
          ? { relayLastModifiedAt: args.row.relayLastModifiedAt }
          : {}),
        updatedAt: now,
      });
    }
    const observationId = existing
      ? existing._id
      : await ctx.db.insert("mexicoCapmaTdzObservations", {
          ...args.row,
          date: formatMexicoDate(args.row.screenTimeUtc),
          screenTimeLocal: formatMexicoDateTime(args.row.screenTimeUtc),
          sourceSiteLabel: `CAPMA legacy telemetric-AWOS TDZ ${args.row.tdz}`,
          temperaturePrecisionC: 1,
          lastSeenAt: args.row.fetchCompletedAt,
          createdAt: now,
          updatedAt: now,
        });

    const currentLatest = await ctx.db
      .query("mexicoCapmaLatestImages")
      .withIndex("by_station_tdz", (query) =>
        query.eq("stationIcao", STATION_ICAO).eq("tdz", args.row.tdz),
      )
      .first();
    const sourceSiteLabel = `CAPMA legacy telemetric-AWOS TDZ ${args.row.tdz}`;
    const latestMetadata = {
      stationIcao: STATION_ICAO,
      tdz: args.row.tdz,
      rawHash: args.row.rawHash,
      storageSha256: uploadedMetadata.sha256,
      contentType: args.latestImage.contentType,
      sourceUrl: args.row.sourceUrl,
      sourceSiteLabel,
      screenTimeUtc: args.row.screenTimeUtc,
      screenTimeLocal: formatMexicoDateTime(args.row.screenTimeUtc),
      screenTimestampRaw: args.row.screenTimestampRaw,
      currentTempC: args.row.currentTempC,
      twoMinuteTempC: args.row.twoMinuteTempC,
      fetchStartedAt: args.row.fetchStartedAt,
      fetchCompletedAt: args.row.fetchCompletedAt,
      responseBytes: args.row.responseBytes,
      imageWidth: args.row.imageWidth,
      imageHeight: args.row.imageHeight,
      ocrConfidence: args.row.ocrConfidence,
      ...(args.row.etag !== undefined ? { etag: args.row.etag } : {}),
      ...(args.row.relayLastModifiedAt !== undefined
        ? { relayLastModifiedAt: args.row.relayLastModifiedAt }
        : {}),
      updatedAt: now,
    };

    let imageReplaced = true;
    let latestImageId;
    const currentStorageMetadata = currentLatest
      ? await ctx.db.system.get("_storage", currentLatest.storageId)
      : null;
    const currentStorageMatchesMetadata = Boolean(
      currentLatest &&
      currentStorageMetadata &&
      currentStorageMetadata.sha256 === currentLatest.storageSha256 &&
      currentStorageMetadata.size === currentLatest.responseBytes &&
      currentStorageMetadata.contentType === currentLatest.contentType,
    );
    const imageDecision = decideCapmaLatestImageUpdate({
      current: currentLatest
        ? {
            rawHash: currentLatest.rawHash,
            screenTimeUtc: currentLatest.screenTimeUtc,
          }
        : null,
      currentStorageValid: currentStorageMatchesMetadata,
      incoming: {
        rawHash: args.row.rawHash,
        screenTimeUtc: args.row.screenTimeUtc,
      },
    });
    const keepCurrentImage =
      imageDecision === "keep_newer_current" ||
      imageDecision === "keep_unchanged" ||
      imageDecision === "keep_equal_timestamp_current";
    if (currentLatest && keepCurrentImage) {
      // Historical OCR storage happened above. The raw viewer is monotonic by
      // embedded screen time, so a stale body cannot roll it backward. For an
      // equal timestamp the first validated body wins deterministically.
      await ctx.storage.delete(args.latestImage.storageId);
      if (imageDecision === "keep_unchanged") {
        await ctx.db.patch(currentLatest._id, {
          ...(args.row.etag !== undefined ? { etag: args.row.etag } : {}),
          ...(args.row.relayLastModifiedAt !== undefined
            ? { relayLastModifiedAt: args.row.relayLastModifiedAt }
            : {}),
          fetchCompletedAt: args.row.fetchCompletedAt,
          updatedAt: now,
        });
      }
      latestImageId = currentLatest._id;
      imageReplaced = false;
    } else if (currentLatest) {
      await ctx.db.patch(currentLatest._id, {
        ...latestMetadata,
        storageId: args.latestImage.storageId,
      });
      if (currentStorageMetadata) {
        // An image HTTP action may already have resolved the previous singleton
        // storage ID. Keep that unreferenced object briefly so its subsequent
        // storage read can finish, then let the idempotent reference check
        // remove it. Rejected incoming uploads still delete immediately above.
        await ctx.scheduler.runAfter(
          REPLACED_IMAGE_DELETE_GRACE_MS,
          internal.mexicoCapma.deleteUploadIfUnreferenced,
          { storageId: currentLatest.storageId },
        );
      }
      latestImageId = currentLatest._id;
    } else {
      latestImageId = await ctx.db.insert("mexicoCapmaLatestImages", {
        ...latestMetadata,
        storageId: args.latestImage.storageId,
        createdAt: now,
      });
    }

    return {
      inserted: !existing,
      id: observationId,
      imageReplaced,
      imageDecision,
      latestImageId,
    };
  },
});

// An action cannot know whether a failed runMutation response committed. This
// cleanup mutation makes that ambiguous case safe: it deletes only objects
// which are not the live singleton referenced by any TDZ metadata row.
export const deleteUploadIfUnreferenced = internalMutationGeneric({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const reference = await ctx.db
      .query("mexicoCapmaLatestImages")
      .withIndex("by_storage_id", (query) =>
        query.eq("storageId", args.storageId),
      )
      .first();
    if (reference) {
      return { deleted: false, referenced: true };
    }
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) {
      return { deleted: false, referenced: false };
    }
    await ctx.storage.delete(args.storageId);
    return { deleted: true, referenced: false };
  },
});

export const getLatestImageStateForCollector = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
    tdz: v.union(v.literal("05"), v.literal("23")),
  },
  handler: async (ctx, args) => {
    const gates = capmaGateState();
    if (!gates.accessApproved || !gates.retentionApproved) {
      return null;
    }
    if (args.stationIcao !== STATION_ICAO) {
      return null;
    }
    const row = await ctx.db
      .query("mexicoCapmaLatestImages")
      .withIndex("by_station_tdz", (query) =>
        query.eq("stationIcao", STATION_ICAO).eq("tdz", args.tdz),
      )
      .first();
    if (!row) {
      return null;
    }
    const metadata = await ctx.db.system.get("_storage", row.storageId);
    if (
      !metadata ||
      metadata.sha256 !== row.storageSha256 ||
      metadata.size !== row.responseBytes ||
      metadata.contentType !== row.contentType
    ) {
      return null;
    }
    return { rawHash: row.rawHash };
  },
});

export const getLatestImageForHttp = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
    tdz: v.union(v.literal("05"), v.literal("23")),
    rawHash: v.string(),
  },
  handler: async (ctx, args) => {
    const gates = capmaGateState();
    if (
      !gates.accessApproved ||
      !gates.retentionApproved ||
      !gates.republicationApproved
    ) {
      return null;
    }
    if (args.stationIcao !== STATION_ICAO) {
      return null;
    }
    const row = await ctx.db
      .query("mexicoCapmaLatestImages")
      .withIndex("by_station_tdz", (query) =>
        query.eq("stationIcao", STATION_ICAO).eq("tdz", args.tdz),
      )
      .first();
    // rawHash versions the browser URL so each new singleton produces a fresh
    // request. It is not immutable object addressing: only the current approved
    // singleton is public, so a URL that raced replacement serves that current
    // row instead of returning a transient 404 for the prior version.
    const selection = selectCapmaHttpImageRow(row, args.rawHash);
    if (!selection) {
      return null;
    }
    const selectedRow = selection.row;
    const metadata = await ctx.db.system.get("_storage", selectedRow.storageId);
    if (
      !metadata ||
      metadata.sha256 !== selectedRow.storageSha256 ||
      metadata.size !== selectedRow.responseBytes ||
      metadata.contentType !== selectedRow.contentType
    ) {
      return null;
    }
    return {
      storageId: selectedRow.storageId,
      rawHash: selectedRow.rawHash,
      contentType: selectedRow.contentType,
      responseBytes: selectedRow.responseBytes,
    };
  },
});
