import {
    query,
    mutation,
    internalQuery,
    internalMutation,
} from "./_generated/server";
import { v } from "convex/values";

export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("locations").collect();
    },
});

export const get = query({
    args: { id: v.id("locations") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});

export const setActive = mutation({
    args: { id: v.id("locations"), active: v.boolean() },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.id, { active: args.active });
    },
});

export const listActive = internalQuery({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("locations")
            .withIndex("by_active", (q) => q.eq("active", true))
            .collect();
    },
});

export const upsert = internalMutation({
    args: {
        name: v.string(),
        timeZone: v.string(),
        lat: v.number(),
        lon: v.number(),
        accuweatherLocationKey: v.string(),
        accuweatherType: v.optional(v.string()),
        accuweatherEnglishName: v.optional(v.string()),
        active: v.boolean(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("locations")
            .withIndex("by_accuweatherKey", (q) =>
                q.eq("accuweatherLocationKey", args.accuweatherLocationKey)
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                name: args.name,
                timeZone: args.timeZone,
                lat: args.lat,
                lon: args.lon,
                accuweatherType: args.accuweatherType,
                accuweatherEnglishName: args.accuweatherEnglishName,
                active: args.active,
            });
            return existing._id;
        }

        return await ctx.db.insert("locations", args);
    },
});