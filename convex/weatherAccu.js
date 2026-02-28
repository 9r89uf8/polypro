import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { awFetchJson } from "./aw";
import {
    addDaysISO,
    getLocalParts,
    hourBucketMs,
    localMidnightEpochMs,
} from "./time";
//convex/weatherAccu.js
function daysBetweenISO(aISO, bISO) {
    const [ay, am, ad] = aISO.split("-").map(Number);
    const [by, bm, bd] = bISO.split("-").map(Number);
    const a = Date.UTC(ay, am - 1, ad);
    const b = Date.UTC(by, bm - 1, bd);
    return Math.round((b - a) / 86400000);
}

function computeDailyHighMap(hourlyArray, timeZone) {
    const byDate = new Map();

    for (const h of hourlyArray) {
        const epochMs = (h.EpochDateTime ?? 0) * 1000;
        const tempF = h?.Temperature?.Value;
        if (!epochMs || typeof tempF !== "number") continue;

        const { dateISO } = getLocalParts(epochMs, timeZone);
        const rows = byDate.get(dateISO) || [];
        rows.push({ epochMs, tempF });
        byDate.set(dateISO, rows);
    }

    const out = new Map();

    for (const [dateISO, rows] of byDate.entries()) {
        rows.sort((a, b) => a.epochMs - b.epochMs);

        const count = rows.length;
        let maxTempF = -Infinity;

        for (const row of rows) {
            if (row.tempF > maxTempF) maxTempF = row.tempF;
        }
        if (!Number.isFinite(maxTempF)) continue;

        const maxRows = rows.filter((row) => row.tempF === maxTempF);
        const predictedHighCountHours = maxRows.length;

        let bestLen = 0;
        let bestStart = null;
        let bestEnd = null;

        let curLen = 0;
        let curStart = null;
        let curEnd = null;

        for (const row of rows) {
            if (row.tempF !== maxTempF) {
                if (curLen > bestLen) {
                    bestLen = curLen;
                    bestStart = curStart;
                    bestEnd = curEnd;
                }
                curLen = 0;
                curStart = null;
                curEnd = null;
                continue;
            }

            if (curLen === 0) {
                curLen = 1;
                curStart = row.epochMs;
                curEnd = row.epochMs;
                continue;
            }

            if (row.epochMs - curEnd === 3600000) {
                curLen += 1;
                curEnd = row.epochMs;
            } else {
                if (curLen > bestLen) {
                    bestLen = curLen;
                    bestStart = curStart;
                    bestEnd = curEnd;
                }
                curLen = 1;
                curStart = row.epochMs;
                curEnd = row.epochMs;
            }
        }

        if (curLen > bestLen) {
            bestLen = curLen;
            bestStart = curStart;
            bestEnd = curEnd;
        }

        const maxTimeEpochMs =
            typeof bestStart === "number" ? bestStart : (maxRows[0]?.epochMs ?? null);

        if (typeof maxTimeEpochMs !== "number") continue;

        out.set(dateISO, {
            dateISO,
            count,
            maxTempF,
            maxTimeEpochMs,
            predictedHighCountHours,
            predictedHighStreakHours: bestLen,
            predictedHighStreakStartEpochMs: bestStart,
            predictedHighStreakEndEpochMs: bestEnd,
        });
    }

    return out;
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
        hoursCoveredForTarget: v.number(),
        predictedHighCountHours: v.optional(v.number()),
        predictedHighStreakHours: v.optional(v.number()),
        predictedHighStreakStartEpochMs: v.optional(v.number()),
        predictedHighStreakEndEpochMs: v.optional(v.number()),
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

        if (existing) {
            const missingDurationFields =
                existing.predictedHighCountHours === undefined ||
                existing.predictedHighStreakHours === undefined ||
                existing.predictedHighStreakStartEpochMs === undefined ||
                existing.predictedHighStreakEndEpochMs === undefined;

            if (missingDurationFields) {
                await ctx.db.patch(existing._id, {
                    predictedHighCountHours: args.predictedHighCountHours,
                    predictedHighStreakHours: args.predictedHighStreakHours,
                    predictedHighStreakStartEpochMs: args.predictedHighStreakStartEpochMs,
                    predictedHighStreakEndEpochMs: args.predictedHighStreakEndEpochMs,
                });
            }

            return existing._id;
        }

        return await ctx.db.insert("highPredictions", {
            ...args,
            finalizedAtMs: 0,
        });
    },
});

export const finalizeDay = internalMutation({
    args: { locationId: v.id("locations"), dateISO: v.string() },
    handler: async (ctx, args) => {
        const loc = await ctx.db.get(args.locationId);
        if (!loc) return { finalized: false, reason: "location not found" };

        let actualHighF = null;
        let actualHighTimeEpochMs = null;
        let actualHighSource = "accuweather_observations";

        const stationIcao =
            typeof loc.stationIcao === "string" ? loc.stationIcao.trim().toUpperCase() : "";

        // Prefer independent official METAR observations when the location
        // has a linked station ICAO.
        if (stationIcao) {
            const official = await ctx.db
                .query("metarObservations")
                .withIndex("by_station_mode_date_ts", (q) =>
                    q
                        .eq("stationIcao", stationIcao)
                        .eq("mode", "official")
                        .eq("date", args.dateISO)
                )
                .collect();

            if (official.length > 0) {
                let actualHigh = official[0];
                for (const o of official) {
                    if (
                        o.tempF > actualHigh.tempF ||
                        (o.tempF === actualHigh.tempF && o.tsUtc < actualHigh.tsUtc)
                    ) {
                        actualHigh = o;
                    }
                }
                actualHighF = actualHigh.tempF;
                actualHighTimeEpochMs = actualHigh.tsUtc;
                actualHighSource = "metar_official";
            }
        }

        // Fallback to AccuWeather current-conditions snapshots when no
        // independent METAR truth is available.
        if (actualHighF === null || actualHighTimeEpochMs === null) {
            const obs = await ctx.db
                .query("observations")
                .withIndex("by_location_date", (q) =>
                    q.eq("locationId", args.locationId).eq("localDateISO", args.dateISO)
                )
                .collect();

            if (obs.length === 0) {
                return {
                    finalized: false,
                    reason: stationIcao ? "no metar or observations" : "no observations",
                };
            }

            let actualHigh = obs[0];
            for (const o of obs) {
                if (o.tempF > actualHigh.tempF) actualHigh = o;
            }
            actualHighF = actualHigh.tempF;
            actualHighTimeEpochMs = actualHigh.epochMs;
            actualHighSource = "accuweather_observations";
        }

        const targetStartMs = localMidnightEpochMs(args.dateISO, loc.timeZone);

        const preds = await ctx.db
            .query("highPredictions")
            .withIndex("by_location_target", (q) =>
                q.eq("locationId", args.locationId).eq("targetDateISO", args.dateISO)
            )
            .collect();

        const now = Date.now();

        for (const p of preds) {
            const absErrorF = Math.abs(p.predictedHighF - actualHighF);
            const leadHoursToActualHigh = Math.floor(
                (actualHighTimeEpochMs - p.fetchedHourBucketMs) / 3600000
            );
            const leadHoursToTargetStart = Math.floor(
                (targetStartMs - p.fetchedHourBucketMs) / 3600000
            );

            await ctx.db.patch(p._id, {
                actualHighF,
                actualHighTimeEpochMs,
                absErrorF,
                leadHoursToActualHigh,
                leadHoursToTargetStart,
                finalizedAtMs: now,
            });
        }

        return {
            finalized: true,
            actualHighF,
            actualHighTimeEpochMs,
            actualHighSource,
            predictions: preds.length,
        };
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

            const dailyMap = computeDailyHighMap(hourly, loc.timeZone);
            for (const d of dailyMap.values()) {
                const leadDays = daysBetweenISO(fetchedLocalDateISO, d.dateISO);
                if (leadDays < 0 || leadDays > 3) continue;
                if (typeof d.maxTimeEpochMs !== "number") continue;

                await ctx.runMutation(internal.weatherAccu.saveHighPrediction, {
                    locationId: loc._id,
                    fetchedAtMs: now,
                    fetchedHourBucketMs,
                    fetchedLocalDateISO,
                    fetchedLocalHour,
                    targetDateISO: d.dateISO,
                    leadDays,
                    predictedHighF: d.maxTempF,
                    predictedHighTimeEpochMs: d.maxTimeEpochMs,
                    hoursCoveredForTarget: d.count,
                    predictedHighCountHours: d.predictedHighCountHours,
                    predictedHighStreakHours: d.predictedHighStreakHours,
                    predictedHighStreakStartEpochMs: d.predictedHighStreakStartEpochMs,
                    predictedHighStreakEndEpochMs: d.predictedHighStreakEndEpochMs,
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
