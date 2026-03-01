"use client";

import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

const DAY_OPTIONS = [
  { dayIndex: 0, label: "1 day", subtitle: "Today" },
  { dayIndex: 1, label: "2 days", subtitle: "Tomorrow" },
  { dayIndex: 2, label: "3 days", subtitle: "Day 3" },
];

function formatTempF(value) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}°F`;
}

function toLocalDateLabel(dateISO, timeZone) {
  if (!dateISO) {
    return "—";
  }
  const epochMs = Date.parse(`${dateISO}T12:00:00`);
  if (!Number.isFinite(epochMs)) {
    return dateISO;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(epochMs));
}

function toLocalTimeLabel(epochMs, timeZone) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochMs));
}

function formatPeakWindow(summary, timeZone) {
  if (!summary || !Number.isFinite(summary.peakStartEpochMs)) {
    return "—";
  }
  const start = toLocalTimeLabel(summary.peakStartEpochMs, timeZone);
  const end = Number.isFinite(summary.peakEndEpochMs)
    ? toLocalTimeLabel(summary.peakEndEpochMs, timeZone)
    : start;
  return start === end ? start : `${start} - ${end}`;
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) {
    return "—";
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  if (remainder === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainder}m`;
}

function formatAgeMinutes(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const deltaMs = Date.now() - epochMs;
  if (!Number.isFinite(deltaMs)) {
    return "—";
  }
  const minutes = Math.max(0, Math.round(deltaMs / 60000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h ago` : `${hours}h ${remainder}m ago`;
}

function isCurrentStale(sourceFetchedAtMs) {
  if (!Number.isFinite(sourceFetchedAtMs)) {
    return true;
  }
  return Date.now() - sourceFetchedAtMs > 75 * 60 * 1000;
}

function computeMapBounds(locations) {
  if (!locations.length) {
    return null;
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const location of locations) {
    minLat = Math.min(minLat, location.lat);
    maxLat = Math.max(maxLat, location.lat);
    minLon = Math.min(minLon, location.lon);
    maxLon = Math.max(maxLon, location.lon);
  }
  const latPad = Math.max(0.01, (maxLat - minLat) * 0.3);
  const lonPad = Math.max(0.01, (maxLon - minLon) * 0.3);
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLon: minLon - lonPad,
    maxLon: maxLon + lonPad,
  };
}

function projectMarker(location, bounds) {
  if (!bounds) {
    return { left: 50, top: 50 };
  }
  const lonSpan = Math.max(0.0001, bounds.maxLon - bounds.minLon);
  const latSpan = Math.max(0.0001, bounds.maxLat - bounds.minLat);
  const x = ((location.lon - bounds.minLon) / lonSpan) * 100;
  const y = ((bounds.maxLat - location.lat) / latSpan) * 100;
  return {
    left: Math.min(95, Math.max(5, x)),
    top: Math.min(94, Math.max(6, y)),
  };
}

function buildSparklinePath(points, width, height) {
  if (!Array.isArray(points) || points.length < 2) {
    return "";
  }
  const min = Math.min(...points.map((point) => point.tempF));
  const max = Math.max(...points.map((point) => point.tempF));
  const spread = Math.max(0.1, max - min);
  const xStep = width / (points.length - 1);
  return points
    .map((point, index) => {
      const x = index * xStep;
      const y = height - ((point.tempF - min) / spread) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function getSummaryForDay(location, selectedDayIndex, selectedDate) {
  if (!location) {
    return null;
  }
  const byIndex = (location.summaries ?? []).find(
    (summary) => summary.dayIndex === selectedDayIndex,
  );
  if (byIndex) {
    return byIndex;
  }
  if (!selectedDate) {
    return null;
  }
  return (location.summaries ?? []).find(
    (summary) => summary.localDateISO === selectedDate,
  );
}

export default function KordForecastPage() {
  const dashboard = useQuery("forecast:getForecastDashboard", {});
  const refreshNow = useAction("forecast:refreshForecastNow");
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedLocationKey, setSelectedLocationKey] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");

  const locations = dashboard?.locations ?? [];
  const mainLocation =
    locations.find((location) => location.locationKey === dashboard?.mainLocationKey) ??
    locations[0] ??
    null;
  const dates = dashboard?.dates ?? [];
  const selectedDate = dates[selectedDayIndex] ?? null;

  useEffect(() => {
    if (!locations.length) {
      setSelectedLocationKey(null);
      return;
    }
    const stillExists = locations.some(
      (location) => location.locationKey === selectedLocationKey,
    );
    if (stillExists) {
      return;
    }
    setSelectedLocationKey(mainLocation?.locationKey ?? locations[0].locationKey);
  }, [locations, selectedLocationKey, mainLocation]);

  const selectedLocation =
    locations.find((location) => location.locationKey === selectedLocationKey) ??
    mainLocation;
  const selectedLocationSummary = getSummaryForDay(
    selectedLocation,
    selectedDayIndex,
    selectedDate,
  );
  const selectedCurrent = selectedLocation?.currentConditions ?? null;

  const rowsForSelectedDay = useMemo(() => {
    return locations.map((location) => ({
      location,
      summary: getSummaryForDay(location, selectedDayIndex, selectedDate),
    }));
  }, [locations, selectedDayIndex, selectedDate]);

  const mapBounds = useMemo(() => computeMapBounds(locations), [locations]);

  const spreadMetrics = useMemo(() => {
    const highs = rowsForSelectedDay
      .map((row) => row.summary?.forecastHighF)
      .filter((value) => Number.isFinite(value));
    if (!highs.length) {
      return null;
    }
    const spreadHighF = Math.max(...highs) - Math.min(...highs);

    const ohareRow = rowsForSelectedDay.find(
      (row) => row.location.locationKey === dashboard?.mainLocationKey,
    );
    const suburbHighs = rowsForSelectedDay
      .filter((row) => row.location.locationKey !== dashboard?.mainLocationKey)
      .map((row) => row.summary?.forecastHighF)
      .filter((value) => Number.isFinite(value));

    let ohareDeltaFromMean = null;
    let ohareOutlier = null;
    if (Number.isFinite(ohareRow?.summary?.forecastHighF) && suburbHighs.length) {
      const suburbMean = suburbHighs.reduce((sum, value) => sum + value, 0) / suburbHighs.length;
      const suburbMin = Math.min(...suburbHighs);
      const suburbMax = Math.max(...suburbHighs);
      const ohareHigh = ohareRow.summary.forecastHighF;
      ohareDeltaFromMean = ohareHigh - suburbMean;
      ohareOutlier = ohareHigh < suburbMin || ohareHigh > suburbMax;
    }

    return {
      spreadHighF,
      ohareDeltaFromMean,
      disagreementHigh: spreadHighF >= 4,
      ohareOutlier,
    };
  }, [rowsForSelectedDay, dashboard?.mainLocationKey]);

  const ohareComparison = selectedDate
    ? dashboard?.ohareComparisons?.[selectedDate] ?? null
    : null;

  async function handleManualRefresh() {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    setRefreshMessage("");
    try {
      const result = await refreshNow({ force: true, withJitter: false });
      if (result?.ok) {
        const modeLabel = result.partial ? "Partial refresh" : "Refresh complete";
        const fallbackCount = Array.isArray(result.results)
          ? result.results.filter((row) => row.hourlyFallbackUsed).length
          : 0;
        const currentWarnings = Array.isArray(result.results)
          ? result.results.filter((row) => row.currentConditionsError).length
          : 0;
        setRefreshMessage(
          `${modeLabel}: ${result.locationsProcessed} location(s) updated, ${result.endpointsFetched} endpoint fetches, ${result.endpointsSkipped} cache hits${fallbackCount > 0 ? `, ${fallbackCount} used 72h fallback` : ""}${currentWarnings > 0 ? `, ${currentWarnings} current-conditions warning(s)` : ""}.`,
        );
      } else {
        const failures = Array.isArray(result?.results)
          ? result.results
              .filter((row) => !row.ok)
              .slice(0, 3)
              .map((row) => `${row.locationKey}: ${row.error}`)
              .join(" | ")
          : "";
        setRefreshMessage(
          `${result?.message || result?.error || "Refresh failed."}${
            failures ? ` ${failures}` : ""
          }`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefreshMessage(`Refresh failed: ${message}`);
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.12)]">
          <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
            KORD FORECAST
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-foreground md:text-4xl">
            3-Day Regional Forecast + O&apos;Hare Truth Check
          </h1>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-black/70 md:text-base">
            Forecast highs come from AccuWeather daily forecasts. Peak windows and duration
            are derived from hourly forecasts. O&apos;Hare is verified against NOAA METAR
            daily highs stored in Convex.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing..." : "Refresh Forecasts Now"}
            </button>
          </div>
          <p className="mt-3 text-xs text-black/65">
            {refreshMessage ||
              (dashboard?.run?.lastStatus
                ? `Last run: ${dashboard.run.lastStatus} at ${dashboard.run.lastFinishedAt ? new Date(dashboard.run.lastFinishedAt).toLocaleString() : "—"}`
                : "Forecast cron runs every 20 minutes. Manual refresh bypasses cache checks.")}
          </p>
          {dashboard?.run?.lastError ? (
            <p className="mt-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              {dashboard.run.lastError}
            </p>
          ) : null}
        </header>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <div className="flex flex-wrap items-center gap-2">
            {DAY_OPTIONS.map((option) => {
              const isSelected = selectedDayIndex === option.dayIndex;
              const optionDate = dates[option.dayIndex] ?? null;
              return (
                <button
                  key={option.dayIndex}
                  type="button"
                  onClick={() => setSelectedDayIndex(option.dayIndex)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    isSelected
                      ? "bg-black text-white"
                      : "border border-black/20 bg-white/80 text-black hover:border-black"
                  }`}
                >
                  {option.label}
                  <span className="ml-2 text-xs opacity-80">
                    {optionDate ? toLocalDateLabel(optionDate, mainLocation?.timeZone) : option.subtitle}
                  </span>
                </button>
              );
            })}
          </div>

          {spreadMetrics ? (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span
                className={`rounded-full px-3 py-1 font-semibold ${
                  spreadMetrics.disagreementHigh
                    ? "bg-amber-100 text-amber-900"
                    : "bg-emerald-100 text-emerald-800"
                }`}
              >
                Spread: {spreadMetrics.spreadHighF.toFixed(1)}°F
              </span>
              <span className="rounded-full bg-black/5 px-3 py-1 font-semibold text-black/70">
                O&apos;Hare vs suburb mean:{" "}
                {spreadMetrics.ohareDeltaFromMean === null
                  ? "—"
                  : `${spreadMetrics.ohareDeltaFromMean > 0 ? "+" : ""}${spreadMetrics.ohareDeltaFromMean.toFixed(1)}°F`}
              </span>
              <span
                className={`rounded-full px-3 py-1 font-semibold ${
                  spreadMetrics.ohareOutlier ? "bg-red-100 text-red-800" : "bg-black/5 text-black/70"
                }`}
              >
                {spreadMetrics.ohareOutlier ? "O'Hare outlier" : "O'Hare inside suburb band"}
              </span>
            </div>
          ) : null}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
          <article className="rounded-3xl border border-line/80 bg-panel/90 p-5 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
            <h2 className="text-lg font-semibold text-foreground">Regional Map</h2>
            <p className="mt-2 text-sm text-black/65">
              Click a marker to inspect the selected day&apos;s forecast high, peak window, and hourly shape.
            </p>

            <div className="mt-4 relative h-[430px] overflow-hidden rounded-2xl border border-black/15 bg-[radial-gradient(circle_at_12%_10%,rgba(254,226,172,0.75)_0%,transparent_35%),radial-gradient(circle_at_85%_85%,rgba(184,232,220,0.9)_0%,transparent_40%),linear-gradient(145deg,#f9f6ef_0%,#efe9dc_55%,#e2ddcf_100%)]">
              <div className="pointer-events-none absolute inset-0 opacity-55 [background-image:linear-gradient(rgba(0,0,0,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.06)_1px,transparent_1px)] [background-size:36px_36px]" />
              {rowsForSelectedDay.map(({ location, summary }) => {
                const point = projectMarker(location, mapBounds);
                const isSelected = selectedLocation?.locationKey === location.locationKey;
                const isMain = location.locationKey === dashboard?.mainLocationKey;
                return (
                  <button
                    key={location.locationKey}
                    type="button"
                    onClick={() => setSelectedLocationKey(location.locationKey)}
                    style={{ left: `${point.left}%`, top: `${point.top}%` }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-left shadow transition ${
                      isSelected
                        ? "z-20 border-black bg-black text-white"
                        : isMain
                          ? "z-10 border-emerald-700 bg-emerald-100 text-emerald-950 hover:border-black"
                          : "z-10 border-black/30 bg-white/90 text-black hover:border-black"
                    }`}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                      {isMain ? "O'Hare" : "Suburb"}
                    </p>
                    <p className="text-sm font-semibold leading-tight">{location.name}</p>
                    <p className="text-[11px] opacity-80">
                      Now {formatTempF(location.currentConditions?.tempF)}
                    </p>
                    <p className="text-xs opacity-80">{formatTempF(summary?.forecastHighF)}</p>
                  </button>
                );
              })}
            </div>
          </article>

          <article className="rounded-3xl border border-line/80 bg-panel/90 p-5 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
            <h2 className="text-lg font-semibold text-foreground">
              Selected Day Snapshot
            </h2>
            <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/80">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                  <tr>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">Now</th>
                    <th className="px-3 py-2">High</th>
                    <th className="px-3 py-2">Peak Window</th>
                    <th className="px-3 py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsForSelectedDay.map(({ location, summary }) => (
                    <tr
                      key={location.locationKey}
                      className={`border-t border-black/10 ${
                        selectedLocation?.locationKey === location.locationKey ? "bg-black/5" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-semibold text-black/80">{location.name}</td>
                      <td className="px-3 py-2 text-black/80">
                        {formatTempF(location.currentConditions?.tempF)}
                      </td>
                      <td className="px-3 py-2 text-black/80">{formatTempF(summary?.forecastHighF)}</td>
                      <td className="px-3 py-2 text-black/70">
                        {formatPeakWindow(summary, location.timeZone)}
                      </td>
                      <td className="px-3 py-2 text-black/70">
                        {formatDuration(summary?.peakDurationMinutes)}
                      </td>
                    </tr>
                  ))}
                  {rowsForSelectedDay.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-sm text-black/60" colSpan={5}>
                        No forecast rows yet. Set `ACCUWEATHER_API_KEY`, then run refresh.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-3xl border border-line/80 bg-panel/90 p-5 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
            <h2 className="text-lg font-semibold text-foreground">
              Location Detail
            </h2>
            {selectedLocation ? (
              <>
                <p className="mt-2 text-sm text-black/65">
                  {selectedLocation.name} ({selectedLocation.timeZone})
                </p>
                <div className="mt-4 rounded-2xl border border-black/10 bg-white/80 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-black/55">
                      Current Conditions
                    </p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        isCurrentStale(selectedCurrent?.sourceFetchedAtMs)
                          ? "bg-amber-100 text-amber-900"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {isCurrentStale(selectedCurrent?.sourceFetchedAtMs)
                        ? "Stale"
                        : "Fresh"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <p className="text-sm text-black/75">
                      Temp:{" "}
                      <span className="font-semibold text-black">
                        {formatTempF(selectedCurrent?.tempF)}
                      </span>
                    </p>
                    <p className="text-sm text-black/75">
                      RealFeel:{" "}
                      <span className="font-semibold text-black">
                        {formatTempF(selectedCurrent?.realFeelF)}
                      </span>
                    </p>
                    <p className="text-sm text-black/75">
                      Conditions:{" "}
                      <span className="font-semibold text-black">
                        {selectedCurrent?.weatherText || "—"}
                      </span>
                    </p>
                    <p className="text-sm text-black/75">
                      Observed:{" "}
                      <span className="font-semibold text-black">
                        {selectedCurrent?.observedAtEpochMs
                          ? toLocalTimeLabel(
                              selectedCurrent.observedAtEpochMs,
                              selectedLocation.timeZone,
                            )
                          : "—"}
                      </span>
                    </p>
                    <p className="text-sm text-black/75">
                      Fetched:{" "}
                      <span className="font-semibold text-black">
                        {formatAgeMinutes(selectedCurrent?.sourceFetchedAtMs)}
                      </span>
                    </p>
                    <p className="text-sm text-black/75">
                      Precip:{" "}
                      <span className="font-semibold text-black">
                        {selectedCurrent?.hasPrecipitation
                          ? selectedCurrent?.precipitationType || "Yes"
                          : selectedCurrent?.hasPrecipitation === false
                            ? "No"
                            : "—"}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                    <p className="text-xs uppercase tracking-wide text-black/55">Forecast High</p>
                    <p className="mt-1 text-xl font-semibold text-black">
                      {formatTempF(selectedLocationSummary?.forecastHighF)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                    <p className="text-xs uppercase tracking-wide text-black/55">Forecast Low</p>
                    <p className="mt-1 text-xl font-semibold text-black">
                      {formatTempF(selectedLocationSummary?.forecastLowF)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                    <p className="text-xs uppercase tracking-wide text-black/55">Peak Window</p>
                    <p className="mt-1 text-sm font-semibold text-black">
                      {formatPeakWindow(selectedLocationSummary, selectedLocation.timeZone)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                    <p className="text-xs uppercase tracking-wide text-black/55">Peak Duration</p>
                    <p className="mt-1 text-sm font-semibold text-black">
                      {formatDuration(selectedLocationSummary?.peakDurationMinutes)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-black/10 bg-white/80 p-3">
                  <p className="text-xs uppercase tracking-wide text-black/55">Hourly Strip</p>
                  {selectedLocationSummary?.hourlyPoints?.length > 1 ? (
                    <div className="mt-3">
                      <svg viewBox="0 0 320 90" className="h-[90px] w-full">
                        <path
                          d={buildSparklinePath(selectedLocationSummary.hourlyPoints, 320, 80)}
                          fill="none"
                          stroke="#0f766e"
                          strokeWidth="2.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-black/60">
                        <span>
                          {toLocalTimeLabel(
                            selectedLocationSummary.hourlyPoints[0]?.epochMs,
                            selectedLocation.timeZone,
                          )}
                        </span>
                        <span>
                          {toLocalTimeLabel(
                            selectedLocationSummary.hourlyPoints[
                              selectedLocationSummary.hourlyPoints.length - 1
                            ]?.epochMs,
                            selectedLocation.timeZone,
                          )}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-black/60">Hourly data unavailable for this day.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-black/60">Pick a marker to inspect details.</p>
            )}
          </article>

          <article className="rounded-3xl border border-line/80 bg-panel/90 p-5 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
            <h2 className="text-lg font-semibold text-foreground">
              O&apos;Hare Verification
            </h2>
            <p className="mt-2 text-sm text-black/65">
              {selectedDate
                ? `Date ${selectedDate} (${toLocalDateLabel(selectedDate, "America/Chicago")})`
                : "No day selected"}
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-wide text-black/55">Forecast High</p>
                <p className="mt-1 text-xl font-semibold text-black">
                  {formatTempF(
                    selectedLocation?.locationKey === dashboard?.mainLocationKey
                      ? selectedLocationSummary?.forecastHighF
                      : ohareComparison?.accuHighF_latest,
                  )}
                </p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-wide text-black/55">Observed METAR High</p>
                <p className="mt-1 text-xl font-semibold text-black">
                  {formatTempF(ohareComparison?.metarAllMaxF)}
                </p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-wide text-black/55">Raw Error</p>
                <p className="mt-1 text-sm font-semibold text-black">
                  {Number.isFinite(ohareComparison?.errRawF)
                    ? `${ohareComparison.errRawF > 0 ? "+" : ""}${ohareComparison.errRawF.toFixed(1)}°F`
                    : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-wide text-black/55">Rounded Error</p>
                <p className="mt-1 text-sm font-semibold text-black">
                  {Number.isFinite(ohareComparison?.errRoundedF)
                    ? `${ohareComparison.errRoundedF > 0 ? "+" : ""}${ohareComparison.errRoundedF.toFixed(1)}°F`
                    : "—"}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-black/10 bg-white/80 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-black/55">Peak Timing Validation</p>
              <p className="mt-2 text-black/75">
                Peak window:{" "}
                <span className="font-semibold text-black">
                  {Number.isFinite(ohareComparison?.accuPeakStartUtc_latest)
                    ? `${toLocalTimeLabel(ohareComparison.accuPeakStartUtc_latest, "America/Chicago")} - ${toLocalTimeLabel(ohareComparison.accuPeakEndUtc_latest, "America/Chicago")}`
                    : "—"}
                </span>
              </p>
              <p className="mt-1 text-black/75">
                Peak hit:{" "}
                <span
                  className={`font-semibold ${
                    ohareComparison?.peakHit === true
                      ? "text-emerald-700"
                      : ohareComparison?.peakHit === false
                        ? "text-red-700"
                        : "text-black"
                  }`}
                >
                  {ohareComparison?.peakHit === true
                    ? "Yes"
                    : ohareComparison?.peakHit === false
                      ? "No"
                      : "—"}
                </span>
              </p>
              <p className="mt-1 text-black/75">
                Timing delta:{" "}
                <span className="font-semibold text-black">
                  {Number.isFinite(ohareComparison?.peakTimingDeltaMinutes)
                    ? `${ohareComparison.peakTimingDeltaMinutes} min`
                    : "—"}
                </span>
              </p>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
