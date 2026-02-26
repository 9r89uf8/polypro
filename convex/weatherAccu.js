import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { awFetchJson } from "./aw";
import { addDaysISO, getLocalParts, hourBucketMs } from "./time";

function computePredictedHighForDate(hourlyArray, targetDateISO, timeZone) {
    let best = null;

    for (const h of hourlyArray) {
        const epochMs = h.EpochDateTime * 1000;
        const { dateISO } = getLocalParts(epochMs, timeZone);
        if (dateISO !== targetDateISO) continue;

        const temp = h?.Temperature?.Value;
        if (typeof temp !== "number") continue;

        if (!best || temp > best.tempF) {
            best = { tempF: temp, timeEpochMs: epochMs };
        }
    }

    return best; // or null
}

export const saveObservation = internalMutation({
    args: {
        locationId: v.id("locations"),
        epochMs: v.number(),
        epochHourBucketMs: v.number(),
        localDateISO: v.string(),
        localHour: v.number(),
        tempF: v.number(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("observations")
            .withIndex("by_location_epochHour", (q) =>
                q.eq("locationId", args.locationId).eq("epochHourBucketMs", args.epochHourBucketMs)
            )
            .first();

        if (existing) return existing._id;
        return await ctx.db.insert("observations", args);
    },
});

export const saveHighPrediction = internalMutation({
    args: {
        locationId: v.id("locations"),
        fetchedAtMs: v.number(),
        fetchedHourBucketMs: v.number(),
        fetchedLocalDateISO: v.string(),
        fetchedLocalHour: v.number(),
        targetDateISO: v.string(),
        leadDays: v.number(),
        predictedHighF: v.number(),
        predictedHighTimeEpochMs: v.number(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("highPredictions")
            .withIndex("by_location_target_lead_bucket", (q) =>
                q
                    .eq("locationId", args.locationId)
                    .eq("targetDateISO", args.targetDateISO)
                    .eq("leadDays", args.leadDays)
                    .eq("fetchedHourBucketMs", args.fetchedHourBucketMs)
            )
            .first();

        if (existing) return existing._id;

        return await ctx.db.insert("highPredictions", {
            ...args,
            finalizedAtMs: 0,
        });
    },
});

export const finalizeDay = internalMutation({
    args: { locationId: v.id("locations"), dateISO: v.string() },
    handler: async (ctx, args) => {
        const obs = await ctx.db
            .query("observations")
            .withIndex("by_location_date", (q) =>
                q.eq("locationId", args.locationId).eq("localDateISO", args.dateISO)
            )
            .collect();

        if (obs.length === 0) return { finalized: false, reason: "no observations" };

        // Actual high = max observed tempF
        let actualHigh = obs[0];
        for (const o of obs) {
            if (o.tempF > actualHigh.tempF) actualHigh = o;
        }

        const actualHighF = actualHigh.tempF;
        const actualHighTimeEpochMs = actualHigh.epochMs;

        const preds = await ctx.db
            .query("highPredictions")
            .withIndex("by_location_target", (q) =>
                q.eq("locationId", args.locationId).eq("targetDateISO", args.dateISO)
            )
            .collect();

        const now = Date.now();

        for (const p of preds) {
            const absErrorF = Math.abs(p.predictedHighF - actualHighF);
            const leadHours = Math.floor((actualHighTimeEpochMs - p.fetchedAtMs) / 3600000);

            await ctx.db.patch(p._id, {
                actualHighF,
                actualHighTimeEpochMs,
                absErrorF,
                leadHoursToActualHigh: leadHours,
                finalizedAtMs: now,
            });
        }

        return { finalized: true, actualHighF, actualHighTimeEpochMs, predictions: preds.length };
    },
});

export const collectHourly = internalAction({
    args: {},
    handler: async (ctx) => {
        const locations = await ctx.runQuery(internal.locations.listActive);
        if (!locations.length) return { ok: true, ran: 0 };

        const now = Date.now();
        const fetchedHourBucketMs = hourBucketMs(now);

        for (const loc of locations) {
            // 1) Hourly forecast (72h)
            // /forecasts/v1/hourly/72hour/{locationKey}
            const hourly = await awFetchJson(
                `/forecasts/v1/hourly/72hour/${loc.accuweatherLocationKey}`,
                { language: "en-us", details: false, metric: false }
            );

            const { dateISO: fetchedLocalDateISO, hour: fetchedLocalHour } = getLocalParts(
                fetchedHourBucketMs,
                loc.timeZone
            );

            // Save "today high" + "tomorrow high" predictions each hour
            for (const leadDays of [0, 1]) {
                const targetDateISO = addDaysISO(fetchedLocalDateISO, leadDays);
                const predicted = computePredictedHighForDate(hourly, targetDateISO, loc.timeZone);
                if (!predicted) continue;

                await ctx.runMutation(internal.weatherAccu.saveHighPrediction, {
                    locationId: loc._id,
                    fetchedAtMs: now,
                    fetchedHourBucketMs,
                    fetchedLocalDateISO,
                    fetchedLocalHour,
                    targetDateISO,
                    leadDays,
                    predictedHighF: predicted.tempF,
                    predictedHighTimeEpochMs: predicted.timeEpochMs,
                });
            }

            // 2) Current conditions (observation)
            // /currentconditions/v1/{locationKey}
            const ccArr = await awFetchJson(
                `/currentconditions/v1/${loc.accuweatherLocationKey}`,
                { language: "en-us", details: false }
            );
            const cc = Array.isArray(ccArr) ? ccArr[0] : null;

            const epochMs = (cc?.EpochTime ?? 0) * 1000;
            const tempF = cc?.Temperature?.Imperial?.Value;

            if (epochMs && typeof tempF === "number") {
                const bucket = hourBucketMs(epochMs);
                const parts = getLocalParts(bucket, loc.timeZone);

                await ctx.runMutation(internal.weatherAccu.saveObservation, {
                    locationId: loc._id,
                    epochMs,
                    epochHourBucketMs: bucket,
                    localDateISO: parts.dateISO,
                    localHour: parts.hour,
                    tempF,
                });
            }

            // 3) At local midnight: finalize yesterday’s actual high & error metrics
            if (fetchedLocalHour === 0) {
                const yesterdayISO = addDaysISO(fetchedLocalDateISO, -1);
                await ctx.runMutation(internal.weatherAccu.finalizeDay, {
                    locationId: loc._id,
                    dateISO: yesterdayISO,
                });
            }
        }

        return { ok: true, ran: locations.length };
    },
});