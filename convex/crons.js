import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Runs every hour at minute 45 UTC.
// The function itself checks America/Chicago time and only runs 12:45–16:45 local.
crons.cron(
    "kord_phone_calls_hourly_45",
    "45 * * * *",
    internal.kordPhone.enqueueScheduledCall,
    { stationIcao: "KORD" },
);

export default crons;