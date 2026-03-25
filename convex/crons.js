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

// Starts four minutes after both routine NZWN boundaries and keeps watching
// through the usual late-publication window so PreFlight and NOAA tgftp
// first-seen times are measured more precisely than the minute fallback polls.
crons.cron(
    "nzwn_publish_race_watch_minute_04_34",
    "4,34 * * * *",
    api.preflight.watchStationPublishRaceWindow,
    { stationIcao: "NZWN", durationMs: 15 * 60 * 1000, includeAeroweb: false },
);

// Polls MetService Wellington Aero (93439) current conditions every 10 minutes
// and stores each reading so the NZWN day page can plot a continuous AWS line.
crons.cron(
    "nzwn_metservice_aws_every_10_min",
    "*/10 * * * *",
    api.nzwnWeather.pollMetServiceCurrentConditions,
    { stationIcao: "NZWN" },
);

// Captures the MetService 10-day daily forecast every 6 hours so we can
// track how predictions change with lead time and measure accuracy.
crons.cron(
    "nzwn_metservice_forecast_snapshot_6h",
    "0 0,6,12,18 * * *",
    api.nzwnWeather.collectForecastSnapshot,
    { stationIcao: "NZWN" },
);

// Polls Météo-France DPObs observations for CDG (station 95527001).
// DPObs updates every 6 minutes but has ~10 min publication delay,
// so polling every 10 minutes captures all readings.
crons.cron(
    "paris_meteofrance_obs_every_10_min",
    "*/10 * * * *",
    api.parisWeather.pollMeteoFranceObservation,
    { stationIcao: "LFPG" },
);

// Polls Météo-France mobile API hourly forecast for CDG every hour.
crons.cron(
    "paris_meteofrance_forecast_every_hour",
    "0 * * * *",
    api.parisWeather.pollMeteoFranceForecast,
    { stationIcao: "LFPG" },
);

// Runs every minute so the default LFPG background source is NOAA tgftp.
// AEROWEB is now reserved for manual on-demand official fetches on the page
// instead of continuous background race tracking.
crons.cron(
    "paris_noaa_latest_every_minute",
    "* * * * *",
    api.aeroweb.pollLatestNoaaStationMetar,
    { stationIcao: "LFPG" },
);

// Starts one minute before the expected LEMD release and then polls both AEMET
// AMA and NOAA every second for six minutes. Madrid METAR usually shows up
// around :04 and :34, so this gives the publish-race table finer resolution
// than the older 1-minute sampling.
crons.cron(
    "madrid_publish_race_watch_minute_03_33",
    "3,33 * * * *",
    api.madrid.watchStationPublishRaceWindow,
    { stationIcao: "LEMD", intervalMs: 1000, durationMs: 6 * 60 * 1000 },
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

// Polls AEMET OpenData hourly forecast for Madrid (municipio 28079) every hour.
// The forecast covers ~48 hours and updates a few times per day.
crons.cron(
    "madrid_aemet_hourly_forecast_every_hour",
    "0 * * * *",
    api.madrid.pollAemetHourlyForecast,
    { stationIcao: "LEMD" },
);

// Polls MGM sondurumlar for LTAC every minute to catch the latest METAR
// as fast as possible (MGM publishes ~2 min after observation).
crons.cron(
    "ankara_mgm_metar_every_minute",
    "* * * * *",
    api.ankara.pollLatestMgmMetar,
    { stationIcao: "LTAC" },
);

// Polls NOAA tgftp for LTAC every minute for the publish race comparison.
crons.cron(
    "ankara_tgftp_publish_race_every_minute",
    "* * * * *",
    api.ankara.pollLatestNoaaPublishRace,
    { stationIcao: "LTAC" },
);

// Polls MGM sondurumlar AWS data every 10 minutes for the live temperature line.
crons.cron(
    "ankara_mgm_aws_every_10_min",
    "*/10 * * * *",
    api.ankara.pollMgmCurrentConditions,
    { stationIcao: "LTAC" },
);

// Polls MGM 3-hourly and 5-day forecasts every hour.
crons.cron(
    "ankara_mgm_forecast_every_hour",
    "0 * * * *",
    api.ankara.pollMgmForecast,
    { stationIcao: "LTAC" },
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
