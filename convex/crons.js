import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";
//convex/crons.js
const crons = cronJobs();

// Runs every 2 minutes so official METAR ingest continues even without open browser tabs.
crons.cron(
    "kord_official_metar_every_2_min",
    "*/2 * * * *",
    api.weather.pollLatestNoaaMetar,
    { stationIcao: "KORD" },
);

// Also runs at minute 51 each hour so there is always an exact :51 poll.
crons.cron(
    "kord_official_metar_minute_51",
    "51 * * * *",
    api.weather.pollLatestNoaaMetar,
    { stationIcao: "KORD" },
);

// Runs every 5 minutes so all-mode METAR ingest continues even without open browser tabs.
crons.cron(
    "kord_all_metar_every_5_min",
    "*/5 * * * *",
    api.weather.backfillTodayAllFromIem,
    { stationIem: "ORD", stationIcao: "KORD" },
);

// Runs every hour and stores a new KORD snapshot:
// - Microsoft + AccuWeather + Google + Weather.com 5-day forecasts
// - Current temperature from Microsoft, AccuWeather, Google, Weather.com, NOAA, IEM, and Open-Meteo
crons.cron(
    "kord_microsoft_5day_hourly",
    "0 * * * *",
    api.forecastCollector.collectKordHourlySnapshot,
    { stationIcao: "KORD", durationDays: 5, unit: "imperial", language: "en-US" },
);

// Runs at minute 30 so current-temperature-only sampling lands halfway between
// the hourly forecast snapshots without doubling forecast API traffic.
crons.cron(
    "kord_current_temps_minute_30",
    "30 * * * *",
    api.forecastCollector.collectKordCurrentSnapshot,
    { stationIcao: "KORD", unit: "imperial", language: "en-US" },
);

// Runs every hour at minutes 49 and 52 UTC.
// The function itself checks America/Chicago time and enqueues only during the
// midday scheduled hour window.
crons.cron(
    "kord_phone_calls_hourly_49_52",
    "49,52 * * * *",
    internal.kordPhone.enqueueScheduledCall,
    { stationIcao: "KORD" },
);



export default crons;
