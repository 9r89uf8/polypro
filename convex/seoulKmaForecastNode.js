"use node";

import { request as httpsRequest } from "node:https";
import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { parseKmaAirportForecastHtml } from "./seoulKmaForecastParser.js";
import { buildKmaTlsCertificateAuthorities } from "./seoulKmaTls.js";

const SEOUL_TIMEZONE = "Asia/Seoul";
const KMA_AMO_APPROVAL_FLAG =
  "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED";
const KMA_AMO_HOSTNAME = "amo.kma.go.kr";
const KMA_AMO_PATH = "/eng/airport.do?icaoCode=RKSI";
const KMA_AMO_AIRPORT_URL = `https://${KMA_AMO_HOSTNAME}${KMA_AMO_PATH}`;
const APPROVAL_REQUIRED_MESSAGE =
  "KMA/AMO airport forecast access approval is required before RKSI collection can run.";
const KMA_SOURCE = "kma_amo_airport";
const KMA_REQUEST_TIMEOUT_MS = 15_000;
const KMA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const SEOUL_STATION = {
  stationIcao: "RKSI",
  stationName: "Incheon International",
};

const collectionTriggerValidator = v.union(
  v.literal("manual"),
  v.literal("scheduled"),
);

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
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

function formatDateInSeoul(epochMs) {
  const parts = getDateParts(dateFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDateTimeInSeoul(epochMs) {
  const parts = getDateParts(dateTimeFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatErrorMessage(error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  return message.slice(0, 500);
}

function hasApprovedKmaAmoAccess() {
  return process.env.KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED === "true";
}

function assertApprovedKmaAmoAccess() {
  if (!hasApprovedKmaAmoAccess()) {
    throw new Error(APPROVAL_REQUIRED_MESSAGE);
  }
}

function normalizeStationIcao(value) {
  const stationIcao = String(value ?? SEOUL_STATION.stationIcao)
    .trim()
    .toUpperCase();
  if (stationIcao !== SEOUL_STATION.stationIcao) {
    throw new Error("The KMA/AMO airport forecast collector supports RKSI only.");
  }
  return stationIcao;
}

function normalizeHeader(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return typeof value === "string" ? value : undefined;
}

function requestAirportForecastHtml() {
  const certificateAuthorities = buildKmaTlsCertificateAuthorities();
  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      callback(value);
    };

    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: KMA_AMO_HOSTNAME,
        port: 443,
        path: KMA_AMO_PATH,
        method: "GET",
        servername: KMA_AMO_HOSTNAME,
        ca: certificateAuthorities,
        rejectUnauthorized: true,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "User-Agent": "polypro-rksi-kma-forecast/1.0",
        },
      },
      (response) => {
        const httpStatus = response.statusCode ?? 0;
        const responseMetadata = {
          httpStatus,
          statusMessage: response.statusMessage ?? "",
          contentType: normalizeHeader(response.headers["content-type"]),
          etag: normalizeHeader(response.headers.etag),
          lastModified: normalizeHeader(response.headers["last-modified"]),
        };

        if (!response.socket.authorized) {
          response.destroy();
          finish(
            reject,
            new Error(
              `KMA/AMO TLS authorization failed: ${response.socket.authorizationError ?? "unknown error"}.`,
            ),
          );
          return;
        }

        // node:https never follows redirects. Resolve status metadata without
        // reading a redirect/error body so the caller can record the attempt.
        if (httpStatus < 200 || httpStatus >= 300) {
          response.destroy();
          finish(resolve, {
            ...responseMetadata,
            html: "",
            responseBytes: 0,
          });
          return;
        }

        const chunks = [];
        let responseBytes = 0;
        response.on("data", (chunk) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += bytes.length;
          if (responseBytes > KMA_MAX_RESPONSE_BYTES) {
            response.destroy(
              new Error("KMA/AMO airport forecast response exceeded 2 MiB."),
            );
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () => {
          finish(resolve, {
            ...responseMetadata,
            html: Buffer.concat(chunks).toString("utf8"),
            responseBytes,
          });
        });
        response.on("error", (error) => finish(reject, error));
      },
    );

    timeoutId = setTimeout(() => {
      request.destroy(new Error("KMA/AMO airport forecast request timed out."));
    }, KMA_REQUEST_TIMEOUT_MS);
    request.on("error", (error) => finish(reject, error));
    request.end();
  });
}

async function storeAttempt(ctx, {
  stationIcao,
  collectionTrigger,
  capturedAt,
  status,
  error,
  response,
  parsed,
}) {
  return await ctx.runMutation(
    internal.seoulKmaForecast.storeForecastCapture,
    {
      stationIcao,
      stationName: parsed?.stationName ?? SEOUL_STATION.stationName,
      source: KMA_SOURCE,
      sourceUrl: KMA_AMO_AIRPORT_URL,
      collectionTrigger,
      capturedAt,
      capturedAtLocal: formatDateTimeInSeoul(capturedAt),
      captureDate: formatDateInSeoul(capturedAt),
      status,
      approvalFlagName: KMA_AMO_APPROVAL_FLAG,
      ...(error ? { error } : {}),
      ...(response
        ? {
            httpStatus: response.httpStatus,
            ...(response.contentType
              ? { contentType: response.contentType }
              : {}),
            ...(Number.isFinite(response.responseBytes)
              ? { responseBytes: response.responseBytes }
              : {}),
            ...(response.etag ? { etag: response.etag } : {}),
            ...(response.lastModified
              ? { lastModified: response.lastModified }
              : {}),
          }
        : {}),
      ...(Number.isFinite(parsed?.pageReportedAt)
        ? {
            pageReportedAt: parsed.pageReportedAt,
            pageReportedAtLocal: parsed.pageReportedAtLocal,
          }
        : {}),
      dailyRows: parsed?.dailyRows ?? [],
      hourlyRows: parsed?.hourlyRows ?? [],
    },
  );
}

async function runAirportForecastCollection(ctx, args, collectionTrigger) {
  const stationIcao = normalizeStationIcao(args.stationIcao);
  const capturedAt = Date.now();

  if (!hasApprovedKmaAmoAccess()) {
    const capture = await storeAttempt(ctx, {
      stationIcao,
      collectionTrigger,
      capturedAt,
      status: "approval_required",
      error: APPROVAL_REQUIRED_MESSAGE,
    });
    return {
      status: "approval_required",
      stationIcao,
      collectionTrigger,
      approval: {
        approved: false,
        status: "approval_required",
        flagName: KMA_AMO_APPROVAL_FLAG,
      },
      message: APPROVAL_REQUIRED_MESSAGE,
      capture,
    };
  }

  let response = null;
  try {
    // Recheck immediately before the only protected external request.
    assertApprovedKmaAmoAccess();
    response = await requestAirportForecastHtml();
    if (response.httpStatus < 200 || response.httpStatus >= 300) {
      throw new Error(
        `KMA/AMO airport forecast request failed (${response.httpStatus} ${response.statusMessage}).`,
      );
    }
    const responseContentType = String(response.contentType ?? "").toLowerCase();
    if (
      !responseContentType.includes("text/html") &&
      !responseContentType.includes("application/xhtml+xml")
    ) {
      throw new Error(
        `KMA/AMO airport forecast returned unexpected content type ${responseContentType || "missing"}.`,
      );
    }

    // Revocation after the request discards the body rather than parsing or
    // persisting protected data.
    assertApprovedKmaAmoAccess();
    const parsed = parseKmaAirportForecastHtml(response.html, {
      expectedStationIcao: stationIcao,
    });

    // The storage mutation repeats this approval check transactionally.
    assertApprovedKmaAmoAccess();
    const capture = await storeAttempt(ctx, {
      stationIcao,
      collectionTrigger,
      capturedAt,
      status: "ok",
      response,
      parsed,
    });
    return {
      status: "ok",
      stationIcao,
      collectionTrigger,
      approval: {
        approved: true,
        status: "approved",
        flagName: KMA_AMO_APPROVAL_FLAG,
      },
      capture,
      dailyRowCount: parsed.dailyRows.length,
      hourlyRowCount: parsed.hourlyRows.length,
    };
  } catch (error) {
    const approvalRevoked = !hasApprovedKmaAmoAccess();
    const message = approvalRevoked
      ? APPROVAL_REQUIRED_MESSAGE
      : formatErrorMessage(error);
    const capture = await storeAttempt(ctx, {
      stationIcao,
      collectionTrigger,
      capturedAt,
      status: approvalRevoked ? "approval_required" : "error",
      error: message,
      response,
    });
    return {
      status: approvalRevoked ? "approval_required" : "error",
      stationIcao,
      collectionTrigger,
      approval: {
        approved: !approvalRevoked,
        status: approvalRevoked ? "approval_required" : "approved",
        flagName: KMA_AMO_APPROVAL_FLAG,
      },
      message,
      capture,
    };
  }
}

export const collectQueuedAirportForecast = internalActionGeneric({
  args: {
    stationIcao: v.string(),
    requestedAt: v.number(),
    collectionTrigger: collectionTriggerValidator,
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const claim = await ctx.runMutation(
      internal.seoulKmaForecast.claimQueuedAirportForecast,
      {
        stationIcao,
        runId: args.runId,
      },
    );
    if (!claim.claimed) {
      if (claim.status === "approval_required") {
        await ctx.runMutation(
          internal.seoulKmaForecast.writeCollectorStatus,
          {
            stationIcao,
            runId: args.runId,
            status: "approval_required",
            completedAt: Date.now(),
            lastError: APPROVAL_REQUIRED_MESSAGE,
          },
        );
        return {
          status: "approval_required",
          stationIcao,
          collectionTrigger: args.collectionTrigger,
          requestedAt: args.requestedAt,
          message: APPROVAL_REQUIRED_MESSAGE,
        };
      }
      return {
        status: "superseded",
        stationIcao,
        collectionTrigger: args.collectionTrigger,
        requestedAt: args.requestedAt,
      };
    }

    try {
      const result = await runAirportForecastCollection(
        ctx,
        { stationIcao },
        args.collectionTrigger,
      );
      await ctx.runMutation(
        internal.seoulKmaForecast.writeCollectorStatus,
        {
          stationIcao,
          runId: args.runId,
          status: result.status,
          completedAt: Date.now(),
          ...(result.message ? { lastError: result.message } : {}),
          ...(Number.isFinite(result.dailyRowCount)
            ? { dailyRowCount: result.dailyRowCount }
            : {}),
          ...(Number.isFinite(result.hourlyRowCount)
            ? { hourlyRowCount: result.hourlyRowCount }
            : {}),
        },
      );
      return {
        ...result,
        requestedAt: args.requestedAt,
      };
    } catch (error) {
      const approvalRevoked = !hasApprovedKmaAmoAccess();
      await ctx.runMutation(
        internal.seoulKmaForecast.writeCollectorStatus,
        {
          stationIcao,
          runId: args.runId,
          status: approvalRevoked ? "approval_required" : "error",
          completedAt: Date.now(),
          lastError: approvalRevoked
            ? APPROVAL_REQUIRED_MESSAGE
            : formatErrorMessage(error),
        },
      );
      throw error;
    }
  },
});
