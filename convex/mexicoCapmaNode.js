"use node";

import { createHash } from "node:crypto";
import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import jpeg from "jpeg-js";
import { api, internal } from "./_generated/api.js";
import { capmaTdzApprovalState } from "./mexicoCapmaApprovals.js";
import { extractCapmaDisplayFromPixels } from "./mexicoCapmaOcr.js";
import { fetchCapmaFreshWithRetries } from "../server/mexicoCapmaTransport.js";

const STATION_ICAO = "MMMX";
const SOURCE_BY_TDZ = {
  "05": {
    source: "capma_tdz05",
    url: "http://capma.mx/banco/pista05.jpg",
  },
  23: {
    source: "capma_tdz23",
    url: "http://capma.mx/banco/pista23.JPG",
  },
};
// The scheduled cooldown is deliberately below the one-minute cron spacing.
// A 60s cooldown raced the 60s cron on scheduling jitter: whenever a cycle's
// claim landed a few hundred milliseconds earlier than the previous one, the
// whole cycle was skipped as "cooldown", which silently halved the stored
// frame cadence to ~2 minutes for months. Actual request rate is still
// governed by the cron (one cycle per minute); the cooldown only suppresses
// duplicate concurrent runs. Manual refreshes keep the stricter spacing.
const SCHEDULED_COOLDOWN_MS = 45_000;
const MANUAL_COOLDOWN_MS = 60_000;
// A fetching row holds a longer lease than either launch cooldown. This keeps
// a delayed worker from overlapping the next minute, while successful workers
// release the lease as soon as they finish by changing the row out of
// `fetching`. Attempt-aware finishes prevent an expired worker from replacing
// the health state of a newer claim.
const ATTEMPT_LEASE_MS = 75_000;
// Retained successful-fetch history for these JPEGs is bimodal: median 0.27s
// at ~600 KB/s, but with a slow mode down to a few KB/s where a ~160 KB body
// legitimately takes tens of seconds (p95 9.5s, p99 27.5s, max 84s before an
// application timeout existed). Production also showed Convex-path connect
// failures while Vercel egress remained reachable. Prefer the configured
// alternate egress, then spend any remaining cycle budget on one patient
// direct connection. The shared 55s wall-clock budget includes both paths and
// leaves time for JPEG validation/OCR/storage before the next minute claim.
const ATTEMPT_TIMEOUTS_MS = [50_000];
const RELAY_TIMEOUT_MS = 43_000;
const TOTAL_FETCH_BUDGET_MS = 55_000;

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function extendedFieldEntries(extended) {
  if (!extended) {
    return {};
  }
  const entries = {};
  const roundConfidence = (value) => roundToTenth(value * 100) / 100;
  for (const [valueKey, confidenceKey] of [
    ["dewpointC", "dewpointConfidence"],
    ["humidityPercent", "humidityConfidence"],
    ["stationPressureHpa", "stationPressureConfidence"],
    ["qnhInHg", "qnhConfidence"],
    ["twoMinuteDewpointC", "twoMinuteDewpointConfidence"],
  ]) {
    if (
      Number.isFinite(extended[valueKey]) &&
      Number.isFinite(extended[confidenceKey])
    ) {
      entries[valueKey] = extended[valueKey];
      entries[confidenceKey] = roundConfidence(extended[confidenceKey]);
    }
  }
  return entries;
}

function accessApproved() {
  return capmaTdzApprovalState().accessApproved;
}

function retentionApproved() {
  return capmaTdzApprovalState().retentionApproved;
}

function assertGates(stage) {
  if (!accessApproved()) {
    throw new Error(`CAPMA image access approval is required before ${stage}.`);
  }
  if (!retentionApproved()) {
    throw new Error(
      `CAPMA image retention approval is required before ${stage}.`,
    );
  }
}

export const collectCapmaImage = internalActionGeneric({
  args: {
    stationIcao: v.string(),
    tdz: v.union(v.literal("05"), v.literal("23")),
    trigger: v.union(v.literal("manual"), v.literal("scheduled")),
  },
  handler: async (ctx, args) => {
    if (args.stationIcao.trim().toUpperCase() !== STATION_ICAO) {
      throw new Error("The CAPMA image worker supports MMMX only.");
    }
    const config = SOURCE_BY_TDZ[args.tdz];
    assertGates("queue execution");
    const previousStatus = await ctx.runQuery(api.mexico.getCollectorStatus, {
      stationIcao: STATION_ICAO,
      source: config.source,
    });
    const claim = await ctx.runMutation(internal.mexico.claimCollectorAttempt, {
      stationIcao: STATION_ICAO,
      source: config.source,
      cooldownMs:
        args.trigger === "manual" ? MANUAL_COOLDOWN_MS : SCHEDULED_COOLDOWN_MS,
      leaseMs: ATTEMPT_LEASE_MS,
    });
    if (!claim.claimed) {
      return { status: "cooldown", retryAfterAt: claim.retryAfterAt };
    }
    const latestImageState = await ctx.runQuery(
      internal.mexicoCapma.getLatestImageStateForCollector,
      { stationIcao: STATION_ICAO, tdz: args.tdz },
    );

    const fetchStartedAt = Date.now();
    let uploadedStorageId = null;
    let imageMetadataCommitted = false;
    try {
      assertGates("the external request");
      const headers = {
        Accept: "image/jpeg",
        "User-Agent":
          "polypro-mmmx-weather/1.0 (approved CAPMA TDZ conditional collector)",
      };
      // Collector status existed before raw-image retention was introduced.
      // Do not allow that old cache metadata to produce a 304 until a latest
      // image object is actually present for this TDZ.
      if (latestImageState && previousStatus?.etag) {
        headers["If-None-Match"] = previousStatus.etag;
      }
      if (latestImageState && previousStatus?.lastModified) {
        headers["If-Modified-Since"] = previousStatus.lastModified;
      }
      const { response, transport } = await fetchCapmaFreshWithRetries(
        config.url,
        {
          headers,
          timeoutsMs: ATTEMPT_TIMEOUTS_MS,
          label: `CAPMA TDZ ${args.tdz}`,
          allowRelayFallback: true,
          preferRelay: true,
          relayTimeoutMs: RELAY_TIMEOUT_MS,
          totalTimeoutMs: TOTAL_FETCH_BUDGET_MS,
        },
      );
      const fetchCompletedAt = Date.now();
      assertGates("response handling");
      if (response.status === 304) {
        await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
          stationIcao: STATION_ICAO,
          source: config.source,
          status: "not_modified",
          lastSuccessAt: previousStatus?.lastSuccessAt ?? fetchCompletedAt,
          lastError: "",
          httpStatus: response.status,
          etag:
            response.headers.get("etag") ?? previousStatus?.etag ?? undefined,
          lastModified:
            response.headers.get("last-modified") ??
            previousStatus?.lastModified ??
            undefined,
          rowCount: previousStatus?.rowCount,
          attemptAt: claim.attemptAt,
        });
        return { status: "not_modified", tdz: args.tdz };
      }
      if (response.status >= 300 && response.status < 400) {
        throw new Error(
          `CAPMA TDZ ${args.tdz} rejected redirect status ${response.status}; only the exact approved source URL is allowed.`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `CAPMA TDZ ${args.tdz} request failed (${response.status}): ${response.text().slice(0, 160)}`,
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!/image\/jpe?g/i.test(contentType)) {
        throw new Error(
          `CAPMA TDZ ${args.tdz} returned unexpected content type ${contentType}.`,
        );
      }
      const body = response.bodyBuffer;
      assertGates("JPEG validation");
      if (body.length < 50_000 || body.length > 1_000_000) {
        throw new Error(
          `CAPMA TDZ ${args.tdz} JPEG size ${body.length} is outside the validation window.`,
        );
      }
      assertGates("JPEG decoding and OCR");
      const decoded = jpeg.decode(body, {
        useTArray: true,
        formatAsRGBA: true,
        maxResolutionInMP: 2,
        maxMemoryUsageInMB: 32,
      });
      const extracted = extractCapmaDisplayFromPixels(decoded, {
        expectedTdz: args.tdz,
        fetchedAt: fetchCompletedAt,
      });
      if (extracted.ocrConfidence < 0.6) {
        throw new Error(
          `CAPMA TDZ ${args.tdz} OCR confidence ${extracted.ocrConfidence.toFixed(3)} is below the storage threshold.`,
        );
      }
      const digest = createHash("sha256").update(body).digest();
      const rawHash = digest.toString("hex");
      const expectedStorageSha256 = digest.toString("base64");
      const relayLastModified = response.headers.get("last-modified");
      const relayLastModifiedAt = relayLastModified
        ? Date.parse(relayLastModified)
        : null;

      assertGates("protected raw JPEG storage");
      uploadedStorageId = await ctx.storage.store(
        new Blob([body], { type: "image/jpeg" }),
        { sha256: expectedStorageSha256 },
      );

      // Approval may be revoked while the upload is in flight. The database
      // mutation repeats these checks and atomically swaps the singleton
      // latest-image row while deleting the prior storage object.
      assertGates("protected row and image metadata storage");
      const result = await ctx.runMutation(
        internal.mexicoCapma.storeCapmaObservation,
        {
          latestImage: {
            storageId: uploadedStorageId,
            contentType: "image/jpeg",
            expectedStorageSha256,
          },
          row: {
            stationIcao: STATION_ICAO,
            tdz: args.tdz,
            screenTimeUtc: extracted.screenTimeUtc,
            screenTimestampRaw: extracted.screenTimestampRaw,
            currentTempC: extracted.currentTempC,
            currentTempF: toFahrenheit(extracted.currentTempC),
            twoMinuteTempC: extracted.twoMinuteTempC,
            twoMinuteTempF: toFahrenheit(extracted.twoMinuteTempC),
            ...extendedFieldEntries(extracted.extended),
            fetchTransport: transport,
            sourceUrl: config.url,
            rawHash,
            ...(response.headers.get("etag")
              ? { etag: response.headers.get("etag") }
              : {}),
            ...(Number.isFinite(relayLastModifiedAt)
              ? { relayLastModifiedAt }
              : {}),
            firstSeenAt: fetchCompletedAt,
            fetchStartedAt,
            fetchCompletedAt,
            responseBytes: body.length,
            imageWidth: decoded.width,
            imageHeight: decoded.height,
            ocrConfidence: roundToTenth(extracted.ocrConfidence * 100) / 100,
            ocrEngine: extracted.ocrEngine,
            trigger: args.trigger,
          },
        },
      );
      imageMetadataCommitted = true;
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao: STATION_ICAO,
        source: config.source,
        status: "ok",
        lastSuccessAt: fetchCompletedAt,
        lastError: "",
        httpStatus: response.status,
        responseBytes: body.length,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: relayLastModified ?? undefined,
        cacheControl: response.headers.get("cache-control") ?? undefined,
        rowCount: 1,
        attemptAt: claim.attemptAt,
      });
      return {
        status: "ok",
        tdz: args.tdz,
        inserted: result.inserted,
        imageReplaced: result.imageReplaced,
        imageDecision: result.imageDecision,
        screenTimeUtc: extracted.screenTimeUtc,
        currentTempC: extracted.currentTempC,
        twoMinuteTempC: extracted.twoMinuteTempC,
        dewpointC: extracted.extended?.dewpointC ?? null,
        humidityPercent: extracted.extended?.humidityPercent ?? null,
        stationPressureHpa: extracted.extended?.stationPressureHpa ?? null,
        ocrConfidence: extracted.ocrConfidence,
      };
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (uploadedStorageId && !imageMetadataCommitted) {
        try {
          // A thrown runMutation response can be ambiguous. The cleanup
          // mutation proves this object was not adopted as the current image
          // before deleting it, and is allowed to run after revocation.
          await ctx.runMutation(
            internal.mexicoCapma.deleteUploadIfUnreferenced,
            { storageId: uploadedStorageId },
          );
        } catch (cleanupError) {
          const cleanupMessage =
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError);
          message = `${message} (unattached JPEG cleanup failed: ${cleanupMessage})`;
        }
      }
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao: STATION_ICAO,
        source: config.source,
        status:
          accessApproved() && retentionApproved()
            ? "error"
            : "approval_required",
        lastError: message,
        attemptAt: claim.attemptAt,
      });
      throw new Error(message);
    }
  },
});
