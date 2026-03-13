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

// Runs every 5 minutes with a rolling lookback so the hidden NOAA/Synoptic
// KORD time-series rows are deduped by observation timestamp.
crons.cron(
    "kord_hidden_synoptic_every_5_min",
    "*/5 * * * *",
    api.synoptic.pollStationTimeseries,
    { stationIcao: "KORD", recentMinutes: 30 },
);

// Runs every 5 minutes so the two Wunderground-backed Weather.com PWS
// candidates are captured on the same cadence as the Synoptic helper feed.
crons.cron(
    "kord_weathercom_pws_every_5_min",
    "*/5 * * * *",
    api.pws.pollWeatherComPwsBatch,
    { stationIcao: "KORD" },
);

// Runs every minute so the official REDEMET latest SBGR METAR/SPECI feed is
// captured continuously even without an open browser tab.
crons.cron(
    "sbgr_redemet_latest_every_minute",
    "* * * * *",
    api.redemet.pollLatestStationMetar,
    { stationIcao: "SBGR" },
);

// Starts before the hour and keeps watching through shortly after it so
// REDEMET and NOAA tgftp first-seen times are measured with finer resolution
// than the minute cron.
crons.cron(
    "sbgr_publish_race_watch_minute_55",
    "55 * * * *",
    api.redemet.watchStationPublishRaceWindow,
    { stationIcao: "SBGR", durationMs: 10 * 60 * 1000 },
);

// Runs every minute so the official NZWN PreFlight latest METAR feed is
// captured continuously even without an open browser tab.
crons.cron(
    "nzwn_preflight_latest_every_minute",
    "* * * * *",
    api.preflight.pollLatestStationMetar,
    { stationIcao: "NZWN" },
);

// Runs every minute because NZWN routine METAR publication can drift well past
// the nominal half-hour boundary, so the NOAA side of the publish-race
// experiment needs continuous sampling rather than a narrow watch window.
crons.cron(
    "nzwn_tgftp_publish_race_every_minute",
    "* * * * *",
    api.preflight.pollLatestNoaaPublishRace,
    { stationIcao: "NZWN" },
);

// Starts before both routine NZWN boundaries and keeps watching through the
// usual late-publication window so PreFlight and NOAA tgftp first-seen times
// are measured more precisely than the minute fallback polls.
crons.cron(
    "nzwn_publish_race_watch_minute_25_55",
    "25,55 * * * *",
    api.preflight.watchStationPublishRaceWindow,
    { stationIcao: "NZWN", durationMs: 15 * 60 * 1000 },
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
