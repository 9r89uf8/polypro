import { query } from "./_generated/server";
import { v } from "convex/values";

function pct(num, den) {
    if (!den) return 0;
    return num / den;
}

// Accuracy grouped by lead-hours before the actual high occurs
export const accuracyByLeadHour = query({
    args: {
        locationId: v.id("locations"),
        daysBack: v.number(),      // e.g. 60
        toleranceF: v.number(),    // e.g. 2
        maxLeadHours: v.number(),  // e.g. 36
        leadDays: v.optional(v.number()), // e.g. 1 to only evaluate "tomorrow"
    },
    handler: async (ctx, args) => {
        const minFinalizedAt = Date.now() - args.daysBack * 86400000;

        const preds = await ctx.db
            .query("highPredictions")
            .withIndex("by_location_finalizedAt", (q) =>
                q.eq("locationId", args.locationId).gt("finalizedAtMs", minFinalizedAt)
            )
            .collect();

        const buckets = new Map(); // leadHour -> { total, ok }

        for (const p of preds) {
            if (args.leadDays !== undefined && p.leadDays !== args.leadDays) continue;
            if (typeof p.absErrorF !== "number") continue;
            if (typeof p.leadHoursToActualHigh !== "number") continue;

            const lh = p.leadHoursToActualHigh;
            if (lh < 0 || lh > args.maxLeadHours) continue;

            const b = buckets.get(lh) || { leadHour: lh, total: 0, ok: 0 };
            b.total += 1;
            if (p.absErrorF <= args.toleranceF) b.ok += 1;
            buckets.set(lh, b);
        }

        return [...buckets.values()]
            .sort((a, b) => a.leadHour - b.leadHour)
            .map((b) => ({
                leadHour: b.leadHour,
                total: b.total,
                ok: b.ok,
                accuracy: pct(b.ok, b.total),
            }));
    },
});

// Accuracy by clock-hour on the PREVIOUS day ("starting from 10pm...")
// This uses fetchedLocalHour and returns both exact hour + cumulative from hour->23.
export const accuracyByFetchedHour = query({
    args: {
        locationId: v.id("locations"),
        daysBack: v.number(),
        toleranceF: v.number(),
        leadDays: v.number(),       // use 1 for "tomorrow's high"
        minSamples: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const minFinalizedAt = Date.now() - args.daysBack * 86400000;

        const preds = await ctx.db
            .query("highPredictions")
            .withIndex("by_location_finalizedAt", (q) =>
                q.eq("locationId", args.locationId).gt("finalizedAtMs", minFinalizedAt)
            )
            .collect();

        const exact = Array.from({ length: 24 }, (_, h) => ({
            hour: h,
            total: 0,
            ok: 0,
        }));

        for (const p of preds) {
            if (p.leadDays !== args.leadDays) continue;
            if (typeof p.absErrorF !== "number") continue;
            if (typeof p.fetchedLocalHour !== "number") continue;

            const h = p.fetchedLocalHour;
            if (h < 0 || h > 23) continue;

            exact[h].total += 1;
            if (p.absErrorF <= args.toleranceF) exact[h].ok += 1;
        }

        const exactWithPct = exact.map((r) => ({
            ...r,
            accuracy: r.total ? r.ok / r.total : 0,
        }));

        // cumulativeFromHour[h] = all predictions from hour h..23
        const cumulative = [];
        for (let h = 0; h < 24; h++) {
            let total = 0;
            let ok = 0;
            for (let k = h; k < 24; k++) {
                total += exact[k].total;
                ok += exact[k].ok;
            }
            cumulative.push({
                hour: h,
                total,
                ok,
                accuracy: total ? ok / total : 0,
            });
        }

        const minSamples = args.minSamples ?? 30;
        const firstHourMeeting80 = cumulative.find(
            (r) => r.total >= minSamples && r.accuracy >= 0.8
        );

        return {
            exact: exactWithPct,
            cumulativeFromHour: cumulative,
            suggestion: firstHourMeeting80
                ? {
                    hour: firstHourMeeting80.hour,
                    accuracy: firstHourMeeting80.accuracy,
                    total: firstHourMeeting80.total,
                }
                : null,
        };
    },
});