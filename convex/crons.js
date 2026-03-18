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

// Runs every minute because AEROWEB also exposes NZWN, and we want the same
// continuous fallback sampling used for the PreFlight-vs-NOAA timing race.
crons.cron(
    "nzwn_aeroweb_publish_race_every_minute",
    "* * * * *",
    api.preflight.pollLatestAerowebPublishRace,
    { stationIcao: "NZWN" },
);

// Starts four minutes after both routine NZWN boundaries and keeps watching
// through the usual late-publication window so PreFlight, authenticated
// AEROWEB, and NOAA tgftp first-seen times are measured more precisely than the
// minute fallback polls.
crons.cron(
    "nzwn_publish_race_watch_minute_04_34",
    "4,34 * * * *",
    api.preflight.watchStationPublishRaceWindow,
    { stationIcao: "NZWN", durationMs: 15 * 60 * 1000 },
);

// Runs only around the expected LFPG routine publication windows so the
// authenticated AEROWEB latest METAR feed stays fresh without second-by-second
// background polling.
crons.cron(
    "paris_aeroweb_latest_window_minutes",
    "0-1,29-31,58-59 * * * *",
    api.aeroweb.pollLatestStationMetar,
    { stationIcao: "LFPG" },
);

// Runs every minute so the NOAA side of the Paris publish-race experiment is
// always sampled, even when routine publication drifts a little past the
// expected half-hour marks.
crons.cron(
    "paris_tgftp_publish_race_every_minute",
    "* * * * *",
    api.aeroweb.pollLatestNoaaPublishRace,
    { stationIcao: "LFPG" },
);

// Runs only around the expected LEMD routine publication windows so the
// authenticated AEMET AMA latest-METAR flow stays fresh without polling all
// day.
crons.cron(
    "madrid_aemet_latest_window_minutes",
    "0-1,29-31,58-59 * * * *",
    api.madrid.pollLatestStationMetar,
    { stationIcao: "LEMD" },
);

// Runs every minute so the NOAA side of the Madrid publish-race experiment is
// always sampled, even when mirrored publication drifts past the nominal
// half-hour boundaries.
crons.cron(
    "madrid_tgftp_publish_race_every_minute",
    "* * * * *",
    api.madrid.pollLatestNoaaPublishRace,
    { stationIcao: "LEMD" },
);

// Runs only around the expected RKSI routine publication windows so the
// official AMO latest METAR endpoint stays fresh without minute-by-minute
// background polling all day.
crons.cron(
    "seoul_amo_latest_window_minutes",
    "0-1,29-31,58-59 * * * *",
    api.seoul.pollLatestStationMetar,
    { stationIcao: "RKSI" },
);

// Runs every minute so the NOAA side of the RKSI publish-race experiment is
// always sampled, even when mirrored publication drifts past the nominal
// half-hour boundaries.
crons.cron(
    "seoul_tgftp_publish_race_every_minute",
    "* * * * *",
    api.seoul.pollLatestNoaaPublishRace,
    { stationIcao: "RKSI" },
);

// Runs every 5 minutes so all RKSI AMOS runway-complex sensor rows are stored.
// The Seoul page overlays 15L by default, but the full runway set is kept so
// we can compare which complex best tracks the official METAR temperature.
crons.cron(
    "seoul_amos_runways_every_5_min",
    "*/5 * * * *",
    api.seoul.pollLatestAmosRunways,
    { stationIcao: "RKSI" },
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
