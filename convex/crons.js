import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Runs every hour at minute 51 UTC.
// The function itself checks America/Chicago time and only runs 12:51–16:51 local.
crons.cron(
    "kord_phone_calls_hourly_51",
    "51 * * * *",
    internal.kordPhone.enqueueScheduledCall,
    { stationIcao: "KORD" },
);

export default crons;
