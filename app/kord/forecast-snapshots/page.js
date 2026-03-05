"use client";

import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { useMemo, useState } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const CHICAGO_TIMEZONE = "America/Chicago";
const STATION_ICAO = "KORD";
const FORECAST_UNIT = "imperial";
const FORECAST_LANGUAGE = "en-US";

const SOURCE_ORDER = [
  "microsoft_current",
  "accuweather_current",
  "google_weather_current",
  "weathercom_current",
];

const SOURCE_LABELS = {
  microsoft_current: "Microsoft Current",
  accuweather_current: "AccuWeather Current",
  google_weather_current: "Google Weather Current",
  weathercom_current: "Weather.com Current",
  noaa_latest_metar: "NOAA METAR",
  iem_asos_latest: "IEM ASOS",
  open_meteo_current: "Open-Meteo",
};

function getDateParts(formatter, date) {
  const parts = formatter.formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatChicagoDateTime(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = getDateParts(formatter, new Date(epochMs));
  const period = parts.dayPeriod ? parts.dayPeriod.toUpperCase() : "";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${period}`.trim();
}

function formatStoredLocalDateTime(localDateTime) {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})$/.exec(
    localDateTime ?? "",
  );
  if (!match) {
    return localDateTime || "—";
  }

  const hour24 = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) {
    return localDateTime || "—";
  }
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${match[1]} ${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function chicagoTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = getDateParts(formatter, new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatSnapshotTime(snapshot) {
  if (!snapshot) {
    return "—";
  }
  if (Number.isFinite(snapshot.capturedAt)) {
    return formatChicagoDateTime(snapshot.capturedAt);
  }
  if (snapshot.capturedAtLocal) {
    return formatStoredLocalDateTime(snapshot.capturedAtLocal);
  }
  return "—";
}

function formatObservedTime(reading) {
  if (!reading) {
    return "—";
  }
  if (Number.isFinite(reading.observedAtUtc)) {
    return formatChicagoDateTime(reading.observedAtUtc);
  }
  if (reading.observedAtLocal) {
    return formatStoredLocalDateTime(reading.observedAtLocal);
  }
  return "—";
}

function formatTemp(value, unit) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}°${unit}`;
}

function getStatusClass(status) {
  if (status === "ok") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "partial") {
    return "bg-amber-100 text-amber-900";
  }
  if (status === "error") {
    return "bg-red-100 text-red-800";
  }
  return "bg-black/5 text-black/60";
}

function getReadingBySource(snapshot, source) {
  return (snapshot?.actualReadings ?? []).find((reading) => reading.source === source);
}

function getSourceLabel(source) {
  return SOURCE_LABELS[source] ?? source;
}

function MissingConvexSetup() {
  return (
    <main className="min-h-screen px-5 py-10 md:px-8">
      <section className="mx-auto max-w-3xl rounded-3xl border border-line/80 bg-panel/90 p-8 shadow-[0_18px_50px_rgba(37,35,27,0.12)]">
        <h1 className="text-2xl font-semibold text-foreground">
          Convex URL Needed
        </h1>
        <p className="mt-3 text-black/70">
          Set <code className="rounded bg-black/5 px-1">NEXT_PUBLIC_CONVEX_URL</code>{" "}
          and run <code className="rounded bg-black/5 px-1">npx convex dev</code>{" "}
          to use this page.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-black transition hover:border-black hover:text-black"
        >
          Back Home
        </Link>
      </section>
    </main>
  );
}

function ForecastSnapshotWorkspace() {
  const [isCollectingNow, setIsCollectingNow] = useState(false);
  const [collectMessage, setCollectMessage] = useState("");
  const snapshotsResult = useQuery("forecastCollector:getRecentSnapshots", {
    stationIcao: STATION_ICAO,
    limit: 72,
  });
  const chicagoTodayDate = useMemo(() => chicagoTodayKey(), []);
  const todayDayData = useQuery("weather:getDayObservations", {
    stationIcao: STATION_ICAO,
    date: chicagoTodayDate,
  });
  const collectNow = useAction("forecastCollector:collectKordHourlySnapshot");

  const snapshots = snapshotsResult?.rows ?? [];
  const latestSnapshot = snapshots[0] ?? null;
  const todayComparison = todayDayData?.comparison ?? null;

  const latestSourceStats = useMemo(() => {
    const readings = latestSnapshot?.actualReadings ?? [];
    const okCount = readings.filter((reading) => reading.status === "ok").length;
    return {
      total: readings.length,
      okCount,
      errorCount: readings.length - okCount,
    };
  }, [latestSnapshot]);

  async function handleCollectNow() {
    if (isCollectingNow) {
      return;
    }
    setIsCollectingNow(true);
    setCollectMessage("");
    try {
      const result = await collectNow({
        stationIcao: STATION_ICAO,
        durationDays: 5,
        unit: FORECAST_UNIT,
        language: FORECAST_LANGUAGE,
      });
      const capturedLabel = Number.isFinite(result?.capturedAt)
        ? formatChicagoDateTime(result.capturedAt)
        : formatStoredLocalDateTime(result?.capturedAtLocal);
      setCollectMessage(
        `Collected snapshot at ${capturedLabel} (${result?.status ?? "unknown"}).`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCollectMessage(`Collect now failed: ${message}`);
    } finally {
      setIsCollectingNow(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
            STATION {STATION_ICAO}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-foreground">
            KORD Forecast Snapshots
          </h1>
          <p className="mt-2 text-sm text-black/65">
            Hourly stored snapshots with Microsoft, AccuWeather, Google, and
            Weather.com 5-day forecasts plus current temperatures from seven sources.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <Link
              href="/kord/metar-today"
              className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:border-sky-400"
            >
              Open METAR Live Day
            </Link>
            <button
              type="button"
              onClick={handleCollectNow}
              disabled={isCollectingNow}
              className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCollectingNow ? "Collecting..." : "Collect Now"}
            </button>
          </div>
          <p className="mt-3 text-xs text-black/65">
            {collectMessage || "Cron runs hourly at minute 00; use Collect Now for manual snapshot capture."}
          </p>
        </header>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">Latest Snapshot</h2>
          {!snapshotsResult ? (
            <p className="mt-3 text-sm text-black/65">Loading snapshots...</p>
          ) : !latestSnapshot ? (
            <p className="mt-3 text-sm text-black/65">
              No snapshots stored yet. Use <strong>Collect Now</strong> or wait for
              the top-of-hour cron run.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-black/60">Captured</p>
                <p className="mt-1 text-sm font-semibold text-black">
                  {formatSnapshotTime(latestSnapshot)}
                </p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-black/60">Status</p>
                <p className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(latestSnapshot.status)}`}
                  >
                    {latestSnapshot.status}
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-black/60">Microsoft</p>
                <p className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(latestSnapshot.microsoftStatus === "ok" ? "ok" : "error")}`}
                  >
                    {latestSnapshot.microsoftStatus}
                  </span>
                </p>
                <p className="mt-1 text-xs text-black/60">
                  {latestSnapshot.microsoftForecastDays?.length ?? 0} forecast day rows
                </p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-black/60">
                  AccuWeather
                </p>
                <p className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(
                      latestSnapshot.accuweatherStatus === "ok"
                        ? "ok"
                        : latestSnapshot.accuweatherStatus === "error"
                          ? "error"
                          : "",
                    )}`}
                  >
                    {latestSnapshot.accuweatherStatus ?? "missing"}
                  </span>
                </p>
                <p className="mt-1 text-xs text-black/60">
                  {latestSnapshot.accuweatherForecastDays?.length ?? 0} forecast day rows
                </p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-black/60">Google</p>
                <p className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(
                      latestSnapshot.googleStatus === "ok"
                        ? "ok"
                        : latestSnapshot.googleStatus === "error"
                          ? "error"
                          : "",
                    )}`}
                  >
                    {latestSnapshot.googleStatus ?? "missing"}
                  </span>
                </p>
                <p className="mt-1 text-xs text-black/60">
                  {latestSnapshot.googleForecastDays?.length ?? 0} forecast day rows
                </p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-black/60">Weather.com</p>
                <p className="mt-1">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(
                      latestSnapshot.weathercomStatus === "ok"
                        ? "ok"
                        : latestSnapshot.weathercomStatus === "error"
                          ? "error"
                          : "",
                    )}`}
                  >
                    {latestSnapshot.weathercomStatus ?? "missing"}
                  </span>
                </p>
                <p className="mt-1 text-xs text-black/60">
                  {latestSnapshot.weathercomForecastDays?.length ?? 0} forecast day rows
                </p>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs uppercase tracking-wide text-black/60">Actual Sources</p>
                <p className="mt-1 text-sm font-semibold text-black">
                  {latestSourceStats.okCount}/{latestSourceStats.total} ok
                </p>
                <p className="mt-1 text-xs text-black/60">
                  {latestSourceStats.errorCount} errors
                </p>
              </div>
            </div>
          )}
          {latestSnapshot?.microsoftError ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Microsoft error: {latestSnapshot.microsoftError}
            </p>
          ) : null}
          {latestSnapshot?.accuweatherError ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              AccuWeather error: {latestSnapshot.accuweatherError}
            </p>
          ) : null}
          {latestSnapshot?.googleError ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Google error: {latestSnapshot.googleError}
            </p>
          ) : null}
          {latestSnapshot?.weathercomError ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              Weather.com error: {latestSnapshot.weathercomError}
            </p>
          ) : null}
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">Current Temperature Sources</h2>
          <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                <tr>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Observed (Chicago)</th>
                  <th className="px-3 py-2">Temp F</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {!latestSnapshot ? (
                  <tr>
                    <td className="px-3 py-3 text-black/60" colSpan={5}>
                      No snapshot loaded.
                    </td>
                  </tr>
                ) : (
                  SOURCE_ORDER.map((source) => {
                    const reading = getReadingBySource(latestSnapshot, source);
                    const status = reading?.status ?? "missing";
                    return (
                      <tr key={source} className="border-t border-black/10">
                        <td className="px-3 py-2 font-semibold text-black">
                          {getSourceLabel(source)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(status)}`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatObservedTime(reading)}
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatTemp(reading?.tempF, "F")}
                        </td>
                        <td
                          className="max-w-[420px] truncate px-3 py-2 text-xs text-black/60"
                          title={reading?.error || reading?.raw || ""}
                        >
                          {reading?.error || reading?.raw || "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">
            Latest NOAA METAR Max (Official Max Today)
          </h2>
          <p className="mt-2 text-xs text-black/60">
            Mirrors today&apos;s official max fields used by
            <code className="ml-1 rounded bg-black/5 px-1">/kord/day/[date]</code>.
          </p>
          <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Official Max F</th>
                  <th className="px-3 py-2">Recorded (Chicago)</th>
                  <th className="px-3 py-2">Obs Count</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Raw METAR</th>
                </tr>
              </thead>
              <tbody>
                {!todayDayData ? (
                  <tr>
                    <td className="px-3 py-3 text-black/60" colSpan={6}>
                      Loading today&apos;s official max...
                    </td>
                  </tr>
                ) : !todayComparison ? (
                  <tr>
                    <td className="px-3 py-3 text-black/60" colSpan={6}>
                      No official max row for {chicagoTodayDate} yet.
                    </td>
                  </tr>
                ) : (
                  <tr className="border-t border-black/10">
                    <td className="px-3 py-2 font-semibold text-black">{chicagoTodayDate}</td>
                    <td className="px-3 py-2 text-black/75">
                      {formatTemp(todayComparison.metarMaxF, "F")}
                    </td>
                    <td className="px-3 py-2 text-black/75">
                      {formatStoredLocalDateTime(todayComparison.metarMaxAtLocal)}
                    </td>
                    <td className="px-3 py-2 text-black/75">
                      {Number.isFinite(todayComparison.metarObsCount)
                        ? todayComparison.metarObsCount
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-black/75">
                      {todayComparison.metarMaxSource || "—"}
                    </td>
                    <td
                      className="max-w-[420px] truncate px-3 py-2 text-xs text-black/60"
                      title={todayComparison.metarMaxRaw || ""}
                    >
                      {todayComparison.metarMaxRaw || "—"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">Microsoft 5-Day Forecast</h2>
          <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Max F</th>
                  <th className="px-3 py-2">Day Phrase</th>
                  <th className="px-3 py-2">Night Phrase</th>
                </tr>
              </thead>
              <tbody>
                {!latestSnapshot?.microsoftForecastDays?.length ? (
                  <tr>
                    <td className="px-3 py-3 text-black/60" colSpan={4}>
                      No forecast rows in latest snapshot.
                    </td>
                  </tr>
                ) : (
                  latestSnapshot.microsoftForecastDays.map((day) => (
                    <tr key={day.date} className="border-t border-black/10">
                      <td className="px-3 py-2 font-semibold text-black">{day.date}</td>
                      <td className="px-3 py-2 text-black/75">{formatTemp(day.maxTempF, "F")}</td>
                      <td className="px-3 py-2 text-black/75">{day.dayPhrase || "—"}</td>
                      <td className="px-3 py-2 text-black/75">{day.nightPhrase || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">AccuWeather 5-Day Forecast</h2>
          <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Max F</th>
                  <th className="px-3 py-2">Day Phrase</th>
                  <th className="px-3 py-2">Night Phrase</th>
                </tr>
              </thead>
              <tbody>
                {!latestSnapshot?.accuweatherForecastDays?.length ? (
                  <tr>
                    <td className="px-3 py-3 text-black/60" colSpan={4}>
                      No forecast rows in latest snapshot.
                    </td>
                  </tr>
                ) : (
                  latestSnapshot.accuweatherForecastDays.map((day) => (
                    <tr key={day.date} className="border-t border-black/10">
                      <td className="px-3 py-2 font-semibold text-black">{day.date}</td>
                      <td className="px-3 py-2 text-black/75">{formatTemp(day.maxTempF, "F")}</td>
                      <td className="px-3 py-2 text-black/75">{day.dayPhrase || "—"}</td>
                      <td className="px-3 py-2 text-black/75">{day.nightPhrase || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">Google 5-Day Forecast</h2>
          <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Max F</th>
                  <th className="px-3 py-2">Day Phrase</th>
                  <th className="px-3 py-2">Night Phrase</th>
                </tr>
              </thead>
              <tbody>
                {!latestSnapshot?.googleForecastDays?.length ? (
                  <tr>
                    <td className="px-3 py-3 text-black/60" colSpan={4}>
                      No forecast rows in latest snapshot.
                    </td>
                  </tr>
                ) : (
                  latestSnapshot.googleForecastDays.map((day) => (
                    <tr key={day.date} className="border-t border-black/10">
                      <td className="px-3 py-2 font-semibold text-black">{day.date}</td>
                      <td className="px-3 py-2 text-black/75">{formatTemp(day.maxTempF, "F")}</td>
                      <td className="px-3 py-2 text-black/75">{day.dayPhrase || "—"}</td>
                      <td className="px-3 py-2 text-black/75">{day.nightPhrase || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">Weather.com 5-Day Forecast</h2>
          <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Max F</th>
                  <th className="px-3 py-2">Day Phrase</th>
                  <th className="px-3 py-2">Night Phrase</th>
                </tr>
              </thead>
              <tbody>
                {!latestSnapshot?.weathercomForecastDays?.length ? (
                  <tr>
                    <td className="px-3 py-3 text-black/60" colSpan={4}>
                      No forecast rows in latest snapshot.
                    </td>
                  </tr>
                ) : (
                  latestSnapshot.weathercomForecastDays.map((day) => (
                    <tr key={day.date} className="border-t border-black/10">
                      <td className="px-3 py-2 font-semibold text-black">{day.date}</td>
                      <td className="px-3 py-2 text-black/75">{formatTemp(day.maxTempF, "F")}</td>
                      <td className="px-3 py-2 text-black/75">{day.dayPhrase || "—"}</td>
                      <td className="px-3 py-2 text-black/75">{day.nightPhrase || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">Recent Hourly History</h2>
          <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                <tr>
                  <th className="px-3 py-2">Captured (Chicago)</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Microsoft</th>
                  <th className="px-3 py-2">AccuWeather</th>
                  <th className="px-3 py-2">Google</th>
                  <th className="px-3 py-2">Weather.com</th>
                  <th className="px-3 py-2">MS Current F</th>
                  <th className="px-3 py-2">Accu Current F</th>
                  <th className="px-3 py-2">Google Current F</th>
                  <th className="px-3 py-2">Weather.com Current F</th>
                  <th className="px-3 py-2">NOAA F</th>
                  <th className="px-3 py-2">IEM F</th>
                  <th className="px-3 py-2">Open-Meteo F</th>
                </tr>
              </thead>
              <tbody>
                {!snapshots.length ? (
                  <tr>
                    <td className="px-3 py-3 text-black/60" colSpan={13}>
                      No snapshot history yet.
                    </td>
                  </tr>
                ) : (
                  snapshots.map((snapshot) => {
                    const microsoftCurrent = getReadingBySource(
                      snapshot,
                      "microsoft_current",
                    );
                    const accuweatherCurrent = getReadingBySource(
                      snapshot,
                      "accuweather_current",
                    );
                    const googleCurrent = getReadingBySource(
                      snapshot,
                      "google_weather_current",
                    );
                    const weatherComCurrent = getReadingBySource(
                      snapshot,
                      "weathercom_current",
                    );
                    const noaa = getReadingBySource(snapshot, "noaa_latest_metar");
                    const iem = getReadingBySource(snapshot, "iem_asos_latest");
                    const openMeteo = getReadingBySource(snapshot, "open_meteo_current");
                    return (
                      <tr key={snapshot._id} className="border-t border-black/10">
                        <td className="px-3 py-2 text-black">{formatSnapshotTime(snapshot)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(snapshot.status)}`}
                          >
                            {snapshot.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(snapshot.microsoftStatus === "ok" ? "ok" : "error")}`}
                          >
                            {snapshot.microsoftStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(
                              snapshot.accuweatherStatus === "ok"
                                ? "ok"
                                : snapshot.accuweatherStatus === "error"
                                  ? "error"
                                  : "",
                            )}`}
                          >
                            {snapshot.accuweatherStatus ?? "missing"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(
                              snapshot.googleStatus === "ok"
                                ? "ok"
                                : snapshot.googleStatus === "error"
                                  ? "error"
                                  : "",
                            )}`}
                          >
                            {snapshot.googleStatus ?? "missing"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(
                              snapshot.weathercomStatus === "ok"
                                ? "ok"
                                : snapshot.weathercomStatus === "error"
                                  ? "error"
                                  : "",
                            )}`}
                          >
                            {snapshot.weathercomStatus ?? "missing"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatTemp(microsoftCurrent?.tempF, "F")}
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatTemp(accuweatherCurrent?.tempF, "F")}
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatTemp(googleCurrent?.tempF, "F")}
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatTemp(weatherComCurrent?.tempF, "F")}
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatTemp(noaa?.tempF, "F")}
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatTemp(iem?.tempF, "F")}
                        </td>
                        <td className="px-3 py-2 text-black/75">
                          {formatTemp(openMeteo?.tempF, "F")}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function KordForecastSnapshotsPage() {
  if (!convexUrl) {
    return <MissingConvexSetup />;
  }
  return <ForecastSnapshotWorkspace />;
}
