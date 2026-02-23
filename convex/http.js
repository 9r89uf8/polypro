import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

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