import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

const crons = cronJobs();

// Runs every 2 minutes so official METAR ingest continues even without open browser tabs.
crons.cron(
    "kord_official_metar_every_2_min",
    "*/2 * * * *",
    api.weather.pollLatestNoaaMetar,
    { stationIcao: "KORD" },
);

// Runs every hour at minutes 49 and 52 UTC.
// The function itself checks America/Chicago time and only runs 12:49/12:52 through 16:49/16:52 local.
crons.cron(
    "kord_phone_calls_hourly_49_52",
    "49,52 * * * *",
    internal.kordPhone.enqueueScheduledCall,
    { stationIcao: "KORD" },
);

export default crons;
