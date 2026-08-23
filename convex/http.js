import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { capmaTdzApprovalState } from "./mexicoCapmaApprovals.js";

const http = httpRouter();

function capmaPublicImageApproved() {
    return capmaTdzApprovalState().publicationApproved;
}

http.route({
    path: "/mexico/capma/latest-image",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
        if (!capmaPublicImageApproved()) {
            return new Response("CAPMA image publication approval is required.", {
                status: 403,
                headers: { "Cache-Control": "no-store" },
            });
        }

        const url = new URL(request.url);
        const stationIcao = (url.searchParams.get("stationIcao") || "").toUpperCase();
        const tdz = url.searchParams.get("tdz") || "";
        const rawHash = url.searchParams.get("rawHash") || "";
        if (
            stationIcao !== "MMMX" ||
            (tdz !== "05" && tdz !== "23") ||
            !/^[a-f0-9]{64}$/.test(rawHash)
        ) {
            return new Response("Not found", {
                status: 404,
                headers: { "Cache-Control": "no-store" },
            });
        }

        const image = await ctx.runQuery(internal.mexicoCapma.getLatestImageForHttp, {
            stationIcao,
            tdz,
            rawHash,
        });
        if (!image || !capmaPublicImageApproved()) {
            return new Response("Not found", {
                status: 404,
                headers: { "Cache-Control": "no-store" },
            });
        }

        const blob = await ctx.storage.get(image.storageId);
        if (!blob || !capmaPublicImageApproved()) {
            return new Response("Not found", {
                status: 404,
                headers: { "Cache-Control": "no-store" },
            });
        }

        return new Response(blob, {
            status: 200,
            headers: {
                "Cache-Control": "private, no-store, max-age=0",
                "Content-Disposition": `inline; filename="MMMX-TDZ-${tdz}-latest.jpg"`,
                "Content-Length": String(image.responseBytes),
                "Content-Type": image.contentType,
                "ETag": `"${image.rawHash}"`,
                "Pragma": "no-cache",
                "X-Content-Type-Options": "nosniff",
            },
        });
    }),
});

http.route({
    path: "/twilio/recording",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        // Optional simple shared-secret check (recommended)
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        const expected = process.env.TWILIO_WEBHOOK_TOKEN;
        if (expected && token !== expected) {
            return new Response("Unauthorized", { status: 401 });
        }

        // Twilio sends application/x-www-form-urlencoded
        const bodyText = await request.text();
        const params = new URLSearchParams(bodyText);

        const callSid = params.get("CallSid") || "";
        const recordingUrl = params.get("RecordingUrl") || "";
        const recordingSid = params.get("RecordingSid") || undefined;
        const recordingDuration = params.get("RecordingDuration") || undefined;
        const recordingStartTime = params.get("RecordingStartTime") || undefined;
        const recordingStatus = params.get("RecordingStatus") || "";

        if (!callSid || !recordingUrl) {
            return new Response("Missing CallSid/RecordingUrl", { status: 400 });
        }

        // Only act when completed (defensive)
        if (recordingStatus && recordingStatus !== "completed") {
            return new Response("Ignored", { status: 200 });
        }

        // Schedule the heavy work (download + Whisper + parsing) and return quickly
        await ctx.scheduler.runAfter(0, internal.kordPhoneNode.processRecording, {
            callSid,
            recordingUrl,
            recordingSid,
            recordingDuration,
            recordingStartTime,
        });

        return new Response("ok", { status: 200 });
    }),
});

export default http;
