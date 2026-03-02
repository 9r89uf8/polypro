"use client";

import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

const DAY_OPTIONS = [
  { dayIndex: 0, label: "1 day", subtitle: "Today" },
  { dayIndex: 1, label: "2 days", subtitle: "Tomorrow" },
  { dayIndex: 2, label: "3 days", subtitle: "Day 3" },
];
const HOUR_MS = 60 * 60 * 1000;

function formatTempF(value) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}°F`;
}

function formatDeltaF(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}°F`;
}

function deltaToneClass(value) {
  if (!Number.isFinite(value)) {
    return "text-black/55";
  }
  if (value > 0) {
    return "text-red-700";
  }
  if (value < 0) {
    return "text-sky-700";
  }
  return "text-black/75";
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

function toLocalHourLabel(epochMs, timeZone) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Chicago",
    hour: "numeric",
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

function toLocalDateTimeLabel(epochMs, timeZone) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));
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

function buildSparklinePath(points, width, height, domainStartEpochMs, domainEndEpochMs) {
  if (!Array.isArray(points) || points.length < 2) {
    return "";
  }
  const min = Math.min(...points.map((point) => point.tempF));
  const max = Math.max(...points.map((point) => point.tempF));
  const spread = Math.max(0.1, max - min);
  const startEpochMs = Number.isFinite(domainStartEpochMs)
    ? domainStartEpochMs
    : points[0].epochMs;
  const endEpochMs = Number.isFinite(domainEndEpochMs)
    ? domainEndEpochMs
    : points[points.length - 1].epochMs;
  const spanMs = Math.max(HOUR_MS, endEpochMs - startEpochMs);
  return points
    .map((point, index) => {
      const x = ((point.epochMs - startEpochMs) / spanMs) * width;
      const y = height - ((point.tempF - min) / spread) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function normalizeHourlyPoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }
  return points
    .filter((point) => Number.isFinite(point?.epochMs) && Number.isFinite(point?.tempF))
    .map((point) => ({
      epochMs: point.epochMs,
      tempF: point.tempF,
    }))
    .sort((a, b) => a.epochMs - b.epochMs);
}

function buildHourlyTicks(hourlyPoints) {
  if (!Array.isArray(hourlyPoints) || !hourlyPoints.length) {
    return [];
  }
  const startHourMs = Math.floor(hourlyPoints[0].epochMs / HOUR_MS) * HOUR_MS;
  const endHourMs =
    Math.floor(hourlyPoints[hourlyPoints.length - 1].epochMs / HOUR_MS) * HOUR_MS;
  const ticks = [];
  for (let epochMs = startHourMs; epochMs <= endHourMs; epochMs += HOUR_MS) {
    ticks.push(epochMs);
  }
  return ticks;
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
  const [showLlmJson, setShowLlmJson] = useState(false);
  const [llmJsonMessage, setLlmJsonMessage] = useState("");

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
  const selectedHourlyPoints = useMemo(
    () => normalizeHourlyPoints(selectedLocationSummary?.hourlyPoints),
    [selectedLocationSummary?.hourlyPoints],
  );
  const selectedHourlyTicks = useMemo(
    () => buildHourlyTicks(selectedHourlyPoints),
    [selectedHourlyPoints],
  );
  const hourlyStripWidth = useMemo(() => {
    const hourSpans = Math.max(1, selectedHourlyTicks.length - 1);
    return Math.max(320, hourSpans * 42);
  }, [selectedHourlyTicks]);
  const selectedForecastHighChanges = useMemo(() => {
    const rows = Array.isArray(selectedLocation?.forecastHighChanges)
      ? selectedLocation.forecastHighChanges
      : [];
    return [...rows].sort((a, b) =>
      String(a?.localDateISO ?? "").localeCompare(String(b?.localDateISO ?? "")),
    );
  }, [selectedLocation]);

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

  const llmPayload = useMemo(() => {
    if (!locations.length || !dates.length) {
      return null;
    }

    const limitedDates = dates.slice(0, 3);
    const mainKey = dashboard?.mainLocationKey ?? null;
    const orderedLocations = [...locations].sort((a, b) => {
      if (a.locationKey === mainKey) {
        return -1;
      }
      if (b.locationKey === mainKey) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
    const supportLocationKeys = orderedLocations
      .filter((location) => location.locationKey !== mainKey)
      .map((location) => location.locationKey);

    return {
      generatedAtMs: Date.now(),
      source: "accuweather",
      includeMetar: false,
      horizonDays: 3,
      primaryLocation: {
        locationKey: mainKey,
        name: "Chicago O'Hare Airport",
      },
      supportLocationKeys,
      days: limitedDates.map((dateKey, dayIndex) => ({
        dayIndex,
        localDateISO: dateKey,
        localDateLabel: toLocalDateLabel(dateKey, "America/Chicago"),
        locations: orderedLocations.map((location) => {
          const summary = getSummaryForDay(location, dayIndex, dateKey);
          const hourlyPoints = Array.isArray(summary?.hourlyPoints)
            ? summary.hourlyPoints.map((point) => ({
                epochMs: point.epochMs,
                localDateTime: toLocalDateTimeLabel(point.epochMs, location.timeZone),
                tempF: point.tempF,
              }))
            : [];
          return {
            role: location.locationKey === mainKey ? "primary" : "support",
            locationKey: location.locationKey,
            name:
              location.locationKey === mainKey ? "Chicago O'Hare Airport" : location.name,
            timeZone: location.timeZone,
            lat: location.lat,
            lon: location.lon,
            dayForecast: {
              forecastHighF: summary?.forecastHighF ?? null,
              forecastLowF: summary?.forecastLowF ?? null,
              peakWindowLocal: formatPeakWindow(summary, location.timeZone),
              peakDurationMinutes: summary?.peakDurationMinutes ?? null,
            },
            hourlyForecast: hourlyPoints,
          };
        }),
      })),
    };
  }, [locations, dates, dashboard?.mainLocationKey]);

  const llmJson = useMemo(() => {
    if (!llmPayload) {
      return "";
    }
    return JSON.stringify(llmPayload, null, 2);
  }, [llmPayload]);

  async function handleCopyLlmJson() {
    if (!llmJson) {
      setLlmJsonMessage("No forecast JSON available yet.");
      return;
    }
    if (!navigator?.clipboard?.writeText) {
      setLlmJsonMessage("Clipboard API not available in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(llmJson);
      setLlmJsonMessage("JSON copied to clipboard.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLlmJsonMessage(`Copy failed: ${message}`);
    }
  }

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
            <button
              type="button"
              onClick={() => {
                setShowLlmJson((value) => !value);
                setLlmJsonMessage("");
              }}
              disabled={!llmPayload}
              className="rounded-full border border-black/25 bg-white/90 px-4 py-2 text-sm font-semibold text-black transition hover:border-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {showLlmJson ? "Hide 3-Day JSON" : "Generate 3-Day JSON"}
            </button>
            {showLlmJson ? (
              <button
                type="button"
                onClick={handleCopyLlmJson}
                disabled={!llmJson}
                className="rounded-full border border-black/25 bg-white/90 px-4 py-2 text-sm font-semibold text-black transition hover:border-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                Copy JSON
              </button>
            ) : null}
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
          {showLlmJson ? (
            <div className="mt-4 rounded-2xl border border-black/15 bg-white/90 p-3">
              <p className="text-xs uppercase tracking-wide text-black/55">
                3-Day Forecast JSON (No METAR)
              </p>
              <p className="mt-2 text-xs text-black/65">
                Includes Chicago O&apos;Hare Airport as `primary` plus 4 suburb support
                locations. Each day includes day forecast and hourly forecast.
              </p>
              <pre className="mt-3 max-h-[360px] overflow-auto rounded-xl border border-black/10 bg-black/95 p-3 text-[11px] leading-5 text-emerald-100">
                {llmJson || "No forecast data available yet. Click Refresh Forecasts Now."}
              </pre>
              {llmJsonMessage ? (
                <p className="mt-2 text-xs text-black/65">{llmJsonMessage}</p>
              ) : null}
            </div>
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
                  <p className="text-xs uppercase tracking-wide text-black/55">
                    Forecast Change Tracker
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    Tracks latest daily high against the first snapshot today and the first-ever
                    snapshot captured for that forecast date.
                  </p>
                  {selectedForecastHighChanges.length > 0 ? (
                    <div className="mt-3 overflow-auto rounded-xl border border-black/10 bg-white/70">
                      <table className="min-w-full text-xs">
                        <thead className="bg-black/5 text-left uppercase tracking-wide text-black/65">
                          <tr>
                            <th className="px-2.5 py-2">Date</th>
                            <th className="px-2.5 py-2">Latest</th>
                            <th className="px-2.5 py-2">First Today</th>
                            <th className="px-2.5 py-2">Delta Today</th>
                            <th className="px-2.5 py-2">First Ever</th>
                            <th className="px-2.5 py-2">Latest Fetch</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedForecastHighChanges.map((row) => {
                            const deltaToday = row?.deltaFromFirstTodayF;
                            const isSelectedDate =
                              selectedDate && row?.localDateISO === selectedDate;
                            return (
                              <tr
                                key={row.localDateISO}
                                className={`border-t border-black/10 ${
                                  isSelectedDate ? "bg-black/5" : ""
                                }`}
                              >
                                <td className="px-2.5 py-2 font-semibold text-black/80">
                                  {row?.localDateISO
                                    ? toLocalDateLabel(row.localDateISO, selectedLocation.timeZone)
                                    : "—"}
                                </td>
                                <td className="px-2.5 py-2 text-black/80">
                                  {formatTempF(row?.latestHighF)}
                                </td>
                                <td className="px-2.5 py-2 text-black/70">
                                  {formatTempF(row?.firstTodayHighF)}
                                </td>
                                <td
                                  className={`px-2.5 py-2 font-semibold ${deltaToneClass(deltaToday)}`}
                                >
                                  {formatDeltaF(deltaToday)}
                                </td>
                                <td className="px-2.5 py-2 text-black/70">
                                  {formatTempF(row?.firstRecordedHighF)}
                                </td>
                                <td className="px-2.5 py-2 text-black/70">
                                  {formatAgeMinutes(row?.latestSnapshotAtMs)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-black/60">
                      No daily snapshot history yet. Run refresh a few times to start tracking
                      forecast deltas.
                    </p>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-black/10 bg-white/80 p-3">
                  <p className="text-xs uppercase tracking-wide text-black/55">Hourly Strip</p>
                  {selectedHourlyPoints.length > 1 ? (
                    <div className="mt-3 overflow-x-auto pb-1">
                      <div style={{ width: `${hourlyStripWidth}px` }}>
                        <svg viewBox={`0 0 ${hourlyStripWidth} 90`} className="h-[90px] w-full">
                          {selectedHourlyTicks.map((tickEpochMs, tickIndex) => {
                            const percent =
                              selectedHourlyTicks.length > 1
                                ? tickIndex / (selectedHourlyTicks.length - 1)
                                : 0;
                            const x = percent * hourlyStripWidth;
                            return (
                              <line
                                key={tickEpochMs}
                                x1={x}
                                y1="2"
                                x2={x}
                                y2="82"
                                stroke="#0f766e"
                                strokeOpacity="0.12"
                                strokeWidth="1"
                              />
                            );
                          })}
                          <path
                            d={buildSparklinePath(
                              selectedHourlyPoints,
                              hourlyStripWidth,
                              80,
                              selectedHourlyTicks[0],
                              selectedHourlyTicks[selectedHourlyTicks.length - 1],
                            )}
                            fill="none"
                            stroke="#0f766e"
                            strokeWidth="2.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <div className="relative mt-1 h-4 text-[11px] text-black/60">
                          {selectedHourlyTicks.map((tickEpochMs, tickIndex) => {
                            const percent =
                              selectedHourlyTicks.length > 1
                                ? tickIndex / (selectedHourlyTicks.length - 1)
                                : 0;
                            const anchorClass =
                              tickIndex === 0
                                ? "translate-x-0 text-left"
                                : tickIndex === selectedHourlyTicks.length - 1
                                  ? "-translate-x-full text-right"
                                  : "-translate-x-1/2 text-center";
                            return (
                              <span
                                key={tickEpochMs}
                                className={`absolute top-0 whitespace-nowrap ${anchorClass}`}
                                style={{ left: `${percent * 100}%` }}
                              >
                                {toLocalHourLabel(tickEpochMs, selectedLocation.timeZone)}
                              </span>
                            );
                          })}
                        </div>
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
                <p className="text-xs uppercase tracking-wide text-black/55">
                  Observed METAR High (Official)
                </p>
                <p className="mt-1 text-xl font-semibold text-black">
                  {formatTempF(ohareComparison?.metarOfficialMaxF)}
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
              <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-wide text-black/55">
                  AccuWeather Observed High
                </p>
                <p className="mt-1 text-sm font-semibold text-black">
                  {formatTempF(ohareComparison?.accuObservedMaxF)}
                </p>
              </div>
              <div className="rounded-xl border border-black/10 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-wide text-black/55">
                  Observed High Error (AW - NOAA)
                </p>
                <p className="mt-1 text-sm font-semibold text-black">
                  {Number.isFinite(ohareComparison?.errObservedRawF)
                    ? `${ohareComparison.errObservedRawF > 0 ? "+" : ""}${ohareComparison.errObservedRawF.toFixed(1)}°F`
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

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-5 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">
            O&apos;Hare Daily High Comparison (AccuWeather Current vs NOAA METAR)
          </h2>
          <p className="mt-2 text-sm text-black/65">
            Uses AccuWeather current-conditions snapshots to track each day&apos;s highest observed
            AccuWeather temperature and compares it to NOAA&apos;s daily observed high.
          </p>
          <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/80">
            <table className="min-w-full text-sm">
              <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">NOAA High</th>
                  <th className="px-3 py-2">AW Observed High</th>
                  <th className="px-3 py-2">Delta (AW-NOAA)</th>
                  <th className="px-3 py-2">NOAA Time</th>
                  <th className="px-3 py-2">AW Time</th>
                  <th className="px-3 py-2">AW Samples</th>
                </tr>
              </thead>
              <tbody>
                {(dashboard?.observedComparisonRows ?? []).map((row) => (
                  <tr key={row.date} className="border-t border-black/10">
                    <td className="px-3 py-2 font-semibold text-black/80">
                      {toLocalDateLabel(row.date, "America/Chicago")}
                    </td>
                    <td className="px-3 py-2 text-black/80">{formatTempF(row.noaaHighF)}</td>
                    <td className="px-3 py-2 text-black/80">{formatTempF(row.accuHighF)}</td>
                    <td className="px-3 py-2 text-black/80">
                      {Number.isFinite(row.deltaF)
                        ? `${row.deltaF > 0 ? "+" : ""}${row.deltaF.toFixed(1)}°F`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-black/70">
                      {toLocalTimeLabel(row.noaaHighAtUtc, "America/Chicago")}
                    </td>
                    <td className="px-3 py-2 text-black/70">
                      {toLocalTimeLabel(row.accuHighAtUtc, "America/Chicago")}
                    </td>
                    <td className="px-3 py-2 text-black/70">{row.accuObsCount ?? "—"}</td>
                  </tr>
                ))}
                {(dashboard?.observedComparisonRows ?? []).length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-sm text-black/60" colSpan={7}>
                      No completed comparison rows yet. Leave forecast refresh running through the day.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
