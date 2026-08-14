"use node";

import { createHash } from "node:crypto";
import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import jpeg from "jpeg-js";
import { api, internal } from "./_generated/api.js";
import { extractCapmaDisplayFromPixels } from "./mexicoCapmaOcr.js";

const STATION_ICAO = "MMMX";
const SOURCE_BY_TDZ = {
  "05": {
    source: "capma_tdz05",
    url: "http://capma.mx/banco/pista05.jpg",
  },
  "23": {
    source: "capma_tdz23",
    url: "http://capma.mx/banco/pista23.JPG",
  },
};
const COOLDOWN_MS = 60_000;

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function accessApproved() {
  return (
    process.env.SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED === "true"
  );
}

function retentionApproved() {
  return (
    process.env.SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED === "true"
  );
}

function assertGates(stage) {
  if (!accessApproved()) {
    throw new Error(`CAPMA image access approval is required before ${stage}.`);
  }
  if (!retentionApproved()) {
    throw new Error(`CAPMA image retention approval is required before ${stage}.`);
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
      cooldownMs: COOLDOWN_MS,
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
      const response = await fetch(config.url, {
        cache: "no-store",
        headers,
        redirect: "manual",
      });
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
          etag: response.headers.get("etag") ?? previousStatus?.etag ?? undefined,
          lastModified:
            response.headers.get("last-modified") ??
            previousStatus?.lastModified ??
            undefined,
          rowCount: previousStatus?.rowCount,
        });
        return { status: "not_modified", tdz: args.tdz };
      }
      if (response.status >= 300 && response.status < 400) {
        throw new Error(
          `CAPMA TDZ ${args.tdz} rejected redirect status ${response.status}; only the exact approved source URL is allowed.`,
        );
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `CAPMA TDZ ${args.tdz} request failed (${response.status}): ${text.slice(0, 160)}`,
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!/image\/jpe?g/i.test(contentType)) {
        throw new Error(
          `CAPMA TDZ ${args.tdz} returned unexpected content type ${contentType}.`,
        );
      }
      const body = Buffer.from(await response.arrayBuffer());
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
      });
      throw new Error(message);
    }
  },
});
