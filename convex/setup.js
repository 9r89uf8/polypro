import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { awFetchJson } from "./aw";
//convex/setup.js
export const bootstrapOhare = action({
    args: {},
    handler: async (ctx) => {
        const lat = 41.98;
        const lon = -87.91;
        const timeZone = "America/Chicago";

        // POI geoposition search endpoint: /locations/v1/poi/geoposition/search
        const poi = await awFetchJson("/locations/v1/poi/geoposition/search", {
            q: `${lat},${lon}`,
            language: "en-us",
            details: false,
        });

        const locationId = await ctx.runMutation(internal.locations.upsert, {
            name: "Chicago O'Hare Intl Airport",
            timeZone,
            lat,
            lon,
            stationIcao: "KORD",
            accuweatherLocationKey: poi.Key,
            accuweatherType: poi.Type,
            accuweatherEnglishName: poi.EnglishName,
            active: true,
        });

        // Optional: run one collection immediately so your dashboard populates right away.
        await ctx.runAction(internal.weatherAccu.collectHourly);

        return {
            locationId,
            accuweatherLocationKey: poi.Key,
            accuweatherEnglishName: poi.EnglishName,
            type: poi.Type,
        };
    },
});
