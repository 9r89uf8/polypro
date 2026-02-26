import { query } from "./_generated/server";
import { v } from "convex/values";
import { addDaysISO, getLocalParts } from "./time";


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




// Helper to compute daily metrics from an array of predictions for one target date
function summarizeDay(predsForDay, toleranceF) {
    // Map by hour (0-23)
    const byHour = Array(24).fill(null);
    let predMin = null;
    let predMax = null;

    let actualHighF = null;
    let actualHighTimeEpochMs = null;

    for (const p of predsForDay) {
        const h = p.fetchedLocalHour;
        if (h >= 0 && h <= 23) byHour[h] = p;

        if (typeof p.predictedHighF === "number") {
            predMin = predMin === null ? p.predictedHighF : Math.min(predMin, p.predictedHighF);
            predMax = predMax === null ? p.predictedHighF : Math.max(predMax, p.predictedHighF);
        }

        // After finalizeDay, these are filled on each row:
        if (typeof p.actualHighF === "number") actualHighF = p.actualHighF;
        if (typeof p.actualHighTimeEpochMs === "number") actualHighTimeEpochMs = p.actualHighTimeEpochMs;
    }

    const coverage = predsForDay.length;
    const missing = 24 - coverage;

    const p10 = byHour[22];
    const p11 = byHour[23];
    const p00 = byHour[0];

    const row = {
        dateISO: predsForDay[0]?.targetDateISO,
        coverage,
        missing,
        actualHighF,
        actualHighTimeEpochMs,

        predMinF: predMin,
        predMaxF: predMax,
        predRangeF: predMin === null || predMax === null ? null : predMax - predMin,

        predAtMidnightF: p00?.predictedHighF ?? null,
        predAt10pmF: p10?.predictedHighF ?? null,
        absErrorAt10pmF: typeof p10?.absErrorF === "number" ? p10.absErrorF : null,
        predAt11pmF: p11?.predictedHighF ?? null,
        absErrorAt11pmF: typeof p11?.absErrorF === "number" ? p11.absErrorF : null,
    };

    // If not finalized yet, accuracy/lock-in is unknown
    if (typeof actualHighF !== "number") {
        return {
            ...row,
            firstAccurateHour: null,
            firstAccurateLeadHours: null,
            lockInHourLenient: null,
            lockInLeadHoursLenient: null,
            lockInHourStrict: null,
            lockInLeadHoursStrict: null,
        };
    }

    // First accurate hour (earliest hour with absError <= tolerance)
    let firstAccurateHour = null;
    let firstAccurateLeadHours = null;
    for (let h = 0; h < 24; h++) {
        const p = byHour[h];
        if (!p || typeof p.absErrorF !== "number") continue;
        if (p.absErrorF <= toleranceF) {
            firstAccurateHour = h;
            firstAccurateLeadHours =
                typeof p.leadHoursToActualHigh === "number" ? p.leadHoursToActualHigh : null;
            break;
        }
    }

    // Lock-in hour (lenient): earliest hour after which ALL later *recorded* snapshots stayed accurate
    let lockInHourLenient = null;
    let lockInLeadHoursLenient = null;
    let allLaterAccurate = true;
    for (let h = 23; h >= 0; h--) {
        const p = byHour[h];
        if (!p || typeof p.absErrorF !== "number") continue;
        if (p.absErrorF <= toleranceF && allLaterAccurate) {
            lockInHourLenient = h;
            lockInLeadHoursLenient =
                typeof p.leadHoursToActualHigh === "number" ? p.leadHoursToActualHigh : null;
        } else {
            allLaterAccurate = false;
        }
    }

    // Lock-in hour (strict): requires a complete uninterrupted run of hours h..23 and all accurate
    let lockInHourStrict = null;
    let lockInLeadHoursStrict = null;
    for (let h = 0; h < 24; h++) {
        let ok = true;
        for (let k = h; k < 24; k++) {
            const p = byHour[k];
            if (!p || typeof p.absErrorF !== "number" || p.absErrorF > toleranceF) {
                ok = false;
                break;
            }
        }
        if (ok) {
            lockInHourStrict = h;
            const p = byHour[h];
            lockInLeadHoursStrict =
                typeof p?.leadHoursToActualHigh === "number" ? p.leadHoursToActualHigh : null;
            break;
        }
    }

    return {
        ...row,
        firstAccurateHour,
        firstAccurateLeadHours,
        lockInHourLenient,
        lockInLeadHoursLenient,
        lockInHourStrict,
        lockInLeadHoursStrict,
    };
}

export const dailySummaryTable = query({
    args: {
        locationId: v.id("locations"),
        daysBack: v.number(),        // e.g. 60
        toleranceF: v.number(),      // e.g. 2
        leadDays: v.optional(v.number()), // default 1 (tomorrow predictions)
        includeToday: v.optional(v.boolean()), // default false
    },
    handler: async (ctx, args) => {
        const leadDays = args.leadDays ?? 1;
        const includeToday = args.includeToday ?? false;

        const loc = await ctx.db.get(args.locationId);
        if (!loc) throw new Error("Location not found");

        // Date.now() is safe in Convex queries; time is frozen for the function execution. :contentReference[oaicite:3]{index=3}
        const nowMs = Date.now();
        const { dateISO: todayISO } = getLocalParts(nowMs, loc.timeZone);
        const endISO = includeToday ? todayISO : addDaysISO(todayISO, -1);
        const startISO = addDaysISO(endISO, -(args.daysBack - 1));

        // Pull all leadDays predictions in the date range in one indexed query
        const preds = await ctx.db
            .query("highPredictions")
            .withIndex("by_location_lead_target_bucket", (q) =>
                q
                    .eq("locationId", args.locationId)
                    .eq("leadDays", leadDays)
                    .gte("targetDateISO", startISO)
                    .lte("targetDateISO", endISO)
            )
            .collect();

        // Group by targetDateISO
        const byDay = new Map();
        for (const p of preds) {
            const key = p.targetDateISO;
            const arr = byDay.get(key) || [];
            arr.push(p);
            byDay.set(key, arr);
        }

        // Summarize
        const days = [...byDay.entries()]
            .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest first
            .map(([dateISO, dayPreds]) => summarizeDay(dayPreds, args.toleranceF));

        return { timeZone: loc.timeZone, startISO, endISO, days };
    },
});



export const dayOverview = query({
    args: {
        locationId: v.id("locations"),
        historyLimit: v.optional(v.number()), // e.g. 24
    },
    handler: async (ctx, args) => {
        const loc = await ctx.db.get(args.locationId);
        if (!loc) throw new Error("Location not found");

        const limit = Math.max(1, Math.min(args.historyLimit ?? 24, 48));
        const nowMs = Date.now();
        const { dateISO: todayISO } = getLocalParts(nowMs, loc.timeZone);
        const tomorrowISO = addDaysISO(todayISO, 1);

        // Observations for today
        const obs = await ctx.db
            .query("observations")
            .withIndex("by_location_date", (q) =>
                q.eq("locationId", args.locationId).eq("localDateISO", todayISO)
            )
            .collect();

        let highSoFar = null;
        let highSoFarTimeEpochMs = null;
        for (const o of obs) {
            if (highSoFar === null || o.tempF > highSoFar) {
                highSoFar = o.tempF;
                highSoFarTimeEpochMs = o.epochMs;
            }
        }

        const lastObs = await ctx.db
            .query("observations")
            .withIndex("by_location_epochHour", (q) => q.eq("locationId", args.locationId))
            .order("desc")
            .first();

        // Forecast histories (today leadDays=0, tomorrow leadDays=1)
        const todayHistDesc = await ctx.db
            .query("highPredictions")
            .withIndex("by_location_lead_target_bucket", (q) =>
                q
                    .eq("locationId", args.locationId)
                    .eq("leadDays", 0)
                    .eq("targetDateISO", todayISO)
            )
            .order("desc")
            .take(limit);

        const tomorrowHistDesc = await ctx.db
            .query("highPredictions")
            .withIndex("by_location_lead_target_bucket", (q) =>
                q
                    .eq("locationId", args.locationId)
                    .eq("leadDays", 1)
                    .eq("targetDateISO", tomorrowISO)
            )
            .order("desc")
            .take(limit);

        const todayHist = [...todayHistDesc].reverse();
        const tomorrowHist = [...tomorrowHistDesc].reverse();

        const latestToday = todayHist[todayHist.length - 1] ?? null;
        const latestTomorrow = tomorrowHist[tomorrowHist.length - 1] ?? null;

        function drift(hist) {
            let min = null, max = null;
            for (const p of hist) {
                min = min === null ? p.predictedHighF : Math.min(min, p.predictedHighF);
                max = max === null ? p.predictedHighF : Math.max(max, p.predictedHighF);
            }
            return {
                minF: min,
                maxF: max,
                rangeF: min === null || max === null ? null : max - min,
                firstF: hist[0]?.predictedHighF ?? null,
                latestF: hist[hist.length - 1]?.predictedHighF ?? null,
            };
        }

        return {
            timeZone: loc.timeZone,
            nowMs,
            todayISO,
            tomorrowISO,
            observations: {
                count: obs.length,
                lastTempF: lastObs?.tempF ?? null,
                lastEpochMs: lastObs?.epochMs ?? null,
                highSoFarF: highSoFar,
                highSoFarTimeEpochMs,
            },
            todayForecast: {
                latest: latestToday
                    ? {
                        predictedHighF: latestToday.predictedHighF,
                        predictedHighTimeEpochMs: latestToday.predictedHighTimeEpochMs,
                        fetchedLocalHour: latestToday.fetchedLocalHour,
                        fetchedAtMs: latestToday.fetchedAtMs,
                    }
                    : null,
                history: todayHist.map((p) => ({
                    fetchedLocalHour: p.fetchedLocalHour,
                    fetchedAtMs: p.fetchedAtMs,
                    predictedHighF: p.predictedHighF,
                    predictedHighTimeEpochMs: p.predictedHighTimeEpochMs,
                })),
                drift: drift(todayHist),
            },
            tomorrowForecast: {
                latest: latestTomorrow
                    ? {
                        predictedHighF: latestTomorrow.predictedHighF,
                        predictedHighTimeEpochMs: latestTomorrow.predictedHighTimeEpochMs,
                        fetchedLocalHour: latestTomorrow.fetchedLocalHour,
                        fetchedAtMs: latestTomorrow.fetchedAtMs,
                    }
                    : null,
                history: tomorrowHist.map((p) => ({
                    fetchedLocalHour: p.fetchedLocalHour,
                    fetchedAtMs: p.fetchedAtMs,
                    predictedHighF: p.predictedHighF,
                    predictedHighTimeEpochMs: p.predictedHighTimeEpochMs,
                })),
                drift: drift(tomorrowHist),
            },
        };
    },
});