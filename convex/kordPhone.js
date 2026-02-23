import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const CHICAGO_TIMEZONE = "America/Chicago";
const SCHEDULED_LOCAL_HOURS = new Set([12, 13, 14, 15, 16]);
const SCHEDULED_MINUTE = 45;

const chicagoDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

const chicagoDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
});

function getDateParts(formatter, date) {
    const parts = formatter.formatToParts(date);
    const values = {};
    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }
    return values;
}

function formatChicagoDate(epochMs) {
    const parts = getDateParts(chicagoDateFormatter, new Date(epochMs));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatChicagoDateTime(epochMs) {
    const parts = getDateParts(chicagoDateTimeFormatter, new Date(epochMs));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function roundToTenth(value) {
    return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
    return roundToTenth((celsius * 9) / 5 + 32);
}

async function enqueueCallForSlot(ctx, { stationIcao, dateKey, slotLocal }) {
    const existing = await ctx.db
        .query("kordPhoneCalls")
        .withIndex("by_station_slot", (q) =>
            q.eq("stationIcao", stationIcao).eq("slotLocal", slotLocal),
        )
        .first();

    if (existing) {
        return { ok: false, reason: "already_enqueued", slotLocal };
    }

    const now = Date.now();
    const callId = await ctx.db.insert("kordPhoneCalls", {
        stationIcao,
        date: dateKey,
        slotLocal,
        status: "queued",
        createdAt: now,
        updatedAt: now,
    });

    // Schedule the Node action that actually hits Twilio.
    await ctx.scheduler.runAfter(0, internal.kordPhoneNode.startCall, {
        callId,
    });

    return { ok: true, slotLocal, callId };
}

/**
 * Public query: get all phone call observations for a day (Chicago dateKey).
 */
export const getDayPhoneReadings = query({
    args: {
        stationIcao: v.string(),
        date: v.string(), // YYYY-MM-DD
    },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query("kordPhoneCalls")
            .withIndex("by_station_date", (q) =>
                q.eq("stationIcao", args.stationIcao).eq("date", args.date),
            )
            .collect();

        rows.sort((a, b) => a.slotLocal.localeCompare(b.slotLocal));
        return { stationIcao: args.stationIcao, date: args.date, rows };
    },
});

/**
 * Internal mutation invoked by cron every hour at :45 UTC.
 * It checks Chicago local time and enqueues only 12:45–16:45 local.
 */
export const enqueueScheduledCall = internalMutation({
    args: {
        stationIcao: v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const parts = getDateParts(chicagoDateTimeFormatter, new Date(now));
        const hour = Number(parts.hour);
        const minute = Number(parts.minute);
        const dateKey = `${parts.year}-${parts.month}-${parts.day}`;

        if (minute !== SCHEDULED_MINUTE || !SCHEDULED_LOCAL_HOURS.has(hour)) {
            return { ok: false, reason: "outside_window", dateKey, hour, minute };
        }

        const slotLocal = `${dateKey} ${pad2(hour)}:${pad2(SCHEDULED_MINUTE)}`;
        return enqueueCallForSlot(ctx, {
            stationIcao: args.stationIcao,
            dateKey,
            slotLocal,
        });
    },
});

export const enqueueManualCall = mutation({
    args: {
        stationIcao: v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const dateKey = formatChicagoDate(now);
        const slotLocal = formatChicagoDateTime(now);

        return enqueueCallForSlot(ctx, {
            stationIcao: args.stationIcao,
            dateKey,
            slotLocal,
        });
    },
});

export const markCallStarted = internalMutation({
    args: {
        callId: v.id("kordPhoneCalls"),
        callSid: v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        await ctx.db.patch(args.callId, {
            callSid: args.callSid,
            status: "calling",
            updatedAt: now,
        });
    },
});

export const markCallError = internalMutation({
    args: {
        callId: v.id("kordPhoneCalls"),
        error: v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        await ctx.db.patch(args.callId, {
            status: "error",
            error: args.error,
            updatedAt: now,
        });
    },
});

export const upsertRecordingFromWebhook = internalMutation({
    args: {
        callSid: v.string(),
        recordingSid: v.optional(v.string()),
        recordingUrl: v.string(),
        recordingDuration: v.optional(v.number()),
        recordingStartTime: v.optional(v.string()), // RFC 2822-ish from Twilio
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("kordPhoneCalls")
            .withIndex("by_callSid", (q) => q.eq("callSid", args.callSid))
            .first();

        if (!existing) {
            return { ok: false, reason: "call_not_found" };
        }

        let tsUtc = existing.tsUtc ?? null;
        if (args.recordingStartTime) {
            const parsed = Date.parse(args.recordingStartTime);
            if (!Number.isNaN(parsed)) {
                tsUtc = parsed;
            }
        }

        const patch = {
            recordingSid: args.recordingSid ?? existing.recordingSid,
            recordingUrl: args.recordingUrl,
            recordingDuration: args.recordingDuration ?? existing.recordingDuration,
            status: "recorded",
            updatedAt: now,
        };

        if (tsUtc !== null) {
            patch.tsUtc = tsUtc;
            patch.tsLocal = formatChicagoDateTime(tsUtc);
        }

        await ctx.db.patch(existing._id, patch);
        return { ok: true };
    },
});

export const upsertTranscriptAndTemperature = internalMutation({
    args: {
        callSid: v.string(),
        transcript: v.string(),
        tempC: v.optional(v.number()),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("kordPhoneCalls")
            .withIndex("by_callSid", (q) => q.eq("callSid", args.callSid))
            .first();

        if (!existing) {
            return { ok: false, reason: "call_not_found" };
        }

        const patch = {
            transcript: args.transcript,
            updatedAt: now,
        };

        if (args.error) {
            patch.status = "error";
            patch.error = args.error;
        } else if (args.tempC !== undefined && args.tempC !== null) {
            const tempC = roundToTenth(args.tempC);
            patch.tempC = tempC;
            patch.tempF = toFahrenheit(tempC);
            patch.status = "parsed";
            patch.error = "";
        } else {
            patch.status = "transcribed";
            patch.error = "temp_parse_failed";
        }

        await ctx.db.patch(existing._id, patch);
        return { ok: true };
    },
});
