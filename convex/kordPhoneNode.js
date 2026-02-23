"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const DESTINATION_NUMBER_DEFAULT = "+17738000035"; // 773-800-0035
const CALL_SECONDS = 45;

function normalizeToE164(value) {
    const raw = String(value ?? "").trim();
    if (raw.startsWith("+")) return raw;
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return raw; // best effort
}

function buildTwimlPauseHangup(seconds) {
    const safe = Math.max(1, Math.min(600, Math.floor(seconds)));
    return `<Response><Pause length="${safe}" /><Hangup /></Response>`;
}

function normalizeTemperatureSegmentText(value) {
    let text = String(value ?? "").toLowerCase();

    // Normalize dash variants and digit separators that Whisper often emits.
    text = text
        .replace(/[–—−]/g, "-")
        .replace(/(\d)\s*,\s*(?=\d)/g, "$1")
        .replace(/(\d)\s*-\s*(?=\d)/g, "$1");

    // Collapse split digit groups like "0 7" -> "07", "0 3 2 3" -> "0323".
    let prev = "";
    while (text !== prev) {
        prev = text;
        text = text.replace(/\b(\d)\s+(\d)\b/g, "$1$2");
    }

    return text;
}

function isPlausibleTemperatureC(value) {
    return Number.isFinite(value) && value >= -80 && value <= 60;
}

function parseTemperatureSegment(segment) {
    const text = normalizeTemperatureSegmentText(segment);
    if (!text.trim()) return null;

    // Handle signed numeric forms, including spoken sign words:
    // "temperature -7", "temperature minus 07", "temperature is 12"
    const numericMatch = text.match(
        /\b(?:is|at|about|around)?\s*(minus|negative|plus)?\s*(-?\d{1,3}(?:\.\d+)?)\b/i,
    );
    if (numericMatch) {
        const signWord = numericMatch[1]?.toLowerCase();
        const parsed = Number(numericMatch[2]);
        if (Number.isFinite(parsed)) {
            let value = parsed;
            if (signWord === "minus" || signWord === "negative") {
                value = parsed > 0 ? -parsed : parsed;
            }
            if (signWord === "plus") {
                value = Math.abs(parsed);
            }
            if (isPlausibleTemperatureC(value)) {
                return value;
            }
        }
    }

    const tokens = text
        .replace(/[^\w\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, 6);

    if (!tokens.length) return null;

    const ignored = new Set([
        "is",
        "at",
        "about",
        "around",
        "c",
        "celsius",
        "degree",
        "degrees",
    ]);
    const filtered = tokens.filter((token) => !ignored.has(token));
    if (!filtered.length) return null;

    const digit = {
        zero: 0,
        oh: 0,
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
    };
    const teen = {
        ten: 10,
        eleven: 11,
        twelve: 12,
        thirteen: 13,
        fourteen: 14,
        fifteen: 15,
        sixteen: 16,
        seventeen: 17,
        eighteen: 18,
        nineteen: 19,
    };
    const tens = {
        twenty: 20,
        thirty: 30,
        forty: 40,
        fifty: 50,
        sixty: 60,
        seventy: 70,
        eighty: 80,
        ninety: 90,
    };

    let sign = 1;
    let start = 0;
    if (filtered[0] === "minus" || filtered[0] === "negative") {
        sign = -1;
        start = 1;
    } else if (filtered[0] === "plus") {
        sign = 1;
        start = 1;
    }

    const t1 = filtered[start];
    const t2 = filtered[start + 1];
    if (!t1) return null;

    if (/^[+-]?\d{1,3}(?:\.\d+)?$/.test(t1)) {
        const parsed = Number(t1);
        if (!Number.isFinite(parsed)) return null;
        const value = sign < 0 ? -Math.abs(parsed) : parsed;
        return isPlausibleTemperatureC(value) ? value : null;
    }

    if (teen[t1] !== undefined) {
        const value = sign * teen[t1];
        return isPlausibleTemperatureC(value) ? value : null;
    }
    if (tens[t1] !== undefined && digit[t2] !== undefined) {
        const value = sign * (tens[t1] + digit[t2]);
        return isPlausibleTemperatureC(value) ? value : null;
    }
    if (tens[t1] !== undefined) {
        const value = sign * tens[t1];
        return isPlausibleTemperatureC(value) ? value : null;
    }
    if (digit[t1] !== undefined && digit[t2] !== undefined) {
        const value = sign * (digit[t1] * 10 + digit[t2]);
        return isPlausibleTemperatureC(value) ? value : null;
    }
    if (digit[t1] !== undefined) {
        const value = sign * digit[t1];
        return isPlausibleTemperatureC(value) ? value : null;
    }

    return null;
}

function extractTemperatureC(transcript) {
    const text = String(transcript ?? "").trim();
    if (!text) return null;

    const segments = [];
    const pattern =
        /\btemperature\b([\s\S]{0,80}?)(?=\bdew\s*point\b|\bdewpoint\b|[.;\n\r]|$)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        segments.push(match[1] ?? "");
    }

    // Prefer the last parsed temperature mention in the transcript so clipped
    // call starts are less likely to win over the latest complete phrase.
    for (let i = segments.length - 1; i >= 0; i -= 1) {
        const parsed = parseTemperatureSegment(segments[i]);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

async function twilioCreateCall({
                                    accountSid,
                                    authToken,
                                    to,
                                    from,
                                    recordingStatusCallback,
                                }) {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

    const body = new URLSearchParams();
    body.set("To", to);
    body.set("From", from);

    // Keep the call open for 45s then hang up.
    body.set("Twiml", buildTwimlPauseHangup(CALL_SECONDS));

    // Record the entire outbound call and notify our webhook when available.
    body.set("Record", "true");
    body.set("RecordingStatusCallback", recordingStatusCallback);
    body.set("RecordingStatusCallbackMethod", "POST");
    body.append("RecordingStatusCallbackEvent", "completed");

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: body.toString(),
    });

    const json = await resp.json().catch(() => ({}));

    if (!resp.ok) {
        const msg =
            json?.message ||
            `Twilio call create failed (${resp.status})`;
        throw new Error(msg);
    }

    return json;
}

async function downloadTwilioRecordingMp3({ accountSid, authToken, recordingUrl }) {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const mp3Url = `${recordingUrl}.mp3`;

    // Small retry loop in case media is briefly not ready
    const delays = [0, 1000, 2500, 5000];
    let lastErr = null;

    for (const d of delays) {
        if (d) await new Promise((r) => setTimeout(r, d));
        try {
            const resp = await fetch(mp3Url, {
                headers: { Authorization: `Basic ${auth}` },
            });
            if (!resp.ok) {
                throw new Error(`Recording fetch failed (${resp.status})`);
            }
            const ab = await resp.arrayBuffer();
            return new Blob([ab], { type: "audio/mpeg" });
        } catch (e) {
            lastErr = e;
        }
    }

    throw lastErr instanceof Error ? lastErr : new Error("Recording download failed");
}

async function openaiTranscribeWhisper({ apiKey, audioBlob }) {
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", audioBlob, "kord-call.mp3");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: form,
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const msg = json?.error?.message || `OpenAI transcription failed (${resp.status})`;
        throw new Error(msg);
    }

    // Default JSON response includes { text: "..." }
    return String(json?.text ?? "");
}

export const startCall = internalAction({
    args: {
        callId: v.id("kordPhoneCalls"),
    },
    handler: async (ctx, args) => {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_FROM_NUMBER;
        const convexSite = process.env.CONVEX_SITE_URL;

        if (!accountSid || !authToken || !from) {
            await ctx.runMutation(internal.kordPhone.markCallError, {
                callId: args.callId,
                error: "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER",
            });
            return { ok: false };
        }
        if (!convexSite) {
            await ctx.runMutation(internal.kordPhone.markCallError, {
                callId: args.callId,
                error: "Missing CONVEX_SITE_URL (needed for Twilio RecordingStatusCallback)",
            });
            return { ok: false };
        }

        const token = process.env.TWILIO_WEBHOOK_TOKEN;
        const recordingStatusCallback = token
            ? `${convexSite}/twilio/recording?token=${encodeURIComponent(token)}`
            : `${convexSite}/twilio/recording`;

        const to = normalizeToE164(process.env.KORD_ATIS_NUMBER || DESTINATION_NUMBER_DEFAULT);

        try {
            const call = await twilioCreateCall({
                accountSid,
                authToken,
                to,
                from: normalizeToE164(from),
                recordingStatusCallback,
            });

            const callSid = String(call?.sid ?? "");
            if (!callSid) {
                throw new Error("Twilio did not return a CallSid");
            }

            await ctx.runMutation(internal.kordPhone.markCallStarted, {
                callId: args.callId,
                callSid,
            });

            return { ok: true, callSid };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await ctx.runMutation(internal.kordPhone.markCallError, {
                callId: args.callId,
                error: msg,
            });
            return { ok: false, error: msg };
        }
    },
});

export const processRecording = internalAction({
    args: {
        callSid: v.string(),
        recordingSid: v.optional(v.string()),
        recordingUrl: v.string(),
        recordingDuration: v.optional(v.string()),
        recordingStartTime: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const openaiKey = process.env.OPENAI_API_KEY;

        if (!accountSid || !authToken) {
            await ctx.runMutation(internal.kordPhone.upsertTranscriptAndTemperature, {
                callSid: args.callSid,
                transcript: "",
                error: "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN",
            });
            return { ok: false };
        }
        if (!openaiKey) {
            await ctx.runMutation(internal.kordPhone.upsertTranscriptAndTemperature, {
                callSid: args.callSid,
                transcript: "",
                error: "Missing OPENAI_API_KEY",
            });
            return { ok: false };
        }

        const durationNum =
            args.recordingDuration && /^\d+(\.\d+)?$/.test(args.recordingDuration)
                ? Number(args.recordingDuration)
                : undefined;

        // Save recording metadata immediately
        await ctx.runMutation(internal.kordPhone.upsertRecordingFromWebhook, {
            callSid: args.callSid,
            recordingSid: args.recordingSid,
            recordingUrl: args.recordingUrl,
            recordingDuration: durationNum,
            recordingStartTime: args.recordingStartTime,
        });

        try {
            const audioBlob = await downloadTwilioRecordingMp3({
                accountSid,
                authToken,
                recordingUrl: args.recordingUrl,
            });

            const transcript = await openaiTranscribeWhisper({
                apiKey: openaiKey,
                audioBlob,
            });

            const tempC = extractTemperatureC(transcript);

            await ctx.runMutation(internal.kordPhone.upsertTranscriptAndTemperature, {
                callSid: args.callSid,
                transcript,
                tempC: tempC ?? undefined,
            });

            return { ok: true, tempC };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await ctx.runMutation(internal.kordPhone.upsertTranscriptAndTemperature, {
                callSid: args.callSid,
                transcript: "",
                error: msg,
            });
            return { ok: false, error: msg };
        }
    },
});
