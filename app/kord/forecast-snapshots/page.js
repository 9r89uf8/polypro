"use client";

import {
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import Link from "next/link";
import { Line } from "react-chartjs-2";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const CHICAGO_TIMEZONE = "America/Chicago";
const STATION_ICAO = "KORD";
const FORECAST_UNIT = "imperial";
const FORECAST_LANGUAGE = "en-US";
const FORECAST_TREND_BACKFILL_LIMIT = 720;

const TREND_PROVIDER_OPTIONS = [
  {
    value: "weathercom",
    label: "Weather.com",
    forecastField: "weathercomForecastDays",
    color: "#1d4ed8",
  },
  {
    value: "microsoft",
    label: "Microsoft",
    forecastField: "microsoftForecastDays",
    color: "#0f766e",
  },
  {
    value: "accuweather",
    label: "AccuWeather",
    forecastField: "accuweatherForecastDays",
    color: "#c2410c",
  },
  {
    value: "google",
    label: "Google",
    forecastField: "googleForecastDays",
    color: "#4338ca",
  },
];

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

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
}

function getTrendProviderConfig(provider) {
  return (
    TREND_PROVIDER_OPTIONS.find((option) => option.value === provider) ??
    TREND_PROVIDER_OPTIONS[0]
  );
}

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

function formatChicagoAxisDateTime(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIMEZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: true,
  });
  const parts = getDateParts(formatter, new Date(epochMs));
  const period = parts.dayPeriod ? parts.dayPeriod.toUpperCase() : "";
  return `${parts.month}/${parts.day} ${parts.hour} ${period}`.trim();
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

function formatDelta(value, unit) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}°${unit}`;
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

function getLatestSnapshotMajorSourceStats(snapshot) {
  const statuses = [
    snapshot?.microsoftStatus,
    snapshot?.accuweatherStatus,
    snapshot?.googleStatus,
    snapshot?.weathercomStatus,
    getReadingBySource(snapshot, "noaa_latest_metar")?.status,
  ];
  const total = statuses.length;
  const okCount = statuses.filter((status) => status === "ok").length;
  let status = "error";
  if (okCount === total && total > 0) {
    status = "ok";
  } else if (okCount > 0) {
    status = "partial";
  }
  return {
    total,
    okCount,
    status,
    isAllOk: okCount === total && total > 0,
  };
}

function getForecastDaysForProvider(snapshot, provider) {
  const config = getTrendProviderConfig(provider);
  return snapshot?.[config.forecastField] ?? [];
}

function getTrendPointColor(changeDirection, providerColor) {
  if (changeDirection === "up") {
    return "#15803d";
  }
  if (changeDirection === "down") {
    return "#dc2626";
  }
  if (changeDirection === "same") {
    return "#6b7280";
  }
  return providerColor;
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
  const [isBackfillingPredictions, setIsBackfillingPredictions] = useState(false);
  const [isTrendTableOpen, setIsTrendTableOpen] = useState(false);
  const [isRecentHistoryOpen, setIsRecentHistoryOpen] = useState(false);
  const [collectMessage, setCollectMessage] = useState("");
  const [backfillMessage, setBackfillMessage] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("weathercom");
  const [selectedTargetDate, setSelectedTargetDate] = useState("");
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
  const backfillPredictions = useAction(
    "forecastCollector:backfillKordForecastPredictions",
  );

  const snapshots = snapshotsResult?.rows ?? [];
  const latestSnapshot = snapshots[0] ?? null;
  const todayComparison = todayDayData?.comparison ?? null;
  const selectedProviderConfig = useMemo(
    () => getTrendProviderConfig(selectedProvider),
    [selectedProvider],
  );
  const latestTargetDateOptions = useMemo(() => {
    const rows = getForecastDaysForProvider(latestSnapshot, selectedProvider);
    return Array.from(
      new Set(rows.map((row) => row?.date).filter((row) => isValidDate(row))),
    );
  }, [latestSnapshot, selectedProvider]);

  useEffect(() => {
    if (!selectedTargetDate && latestTargetDateOptions.length) {
      setSelectedTargetDate(
        latestTargetDateOptions[latestTargetDateOptions.length - 1],
      );
    }
  }, [selectedTargetDate, latestTargetDateOptions]);

  const trendResult = useQuery(
    "forecastCollector:getForecastTrend",
    isValidDate(selectedTargetDate)
      ? {
          stationIcao: STATION_ICAO,
          provider: selectedProvider,
          targetDate: selectedTargetDate,
        }
      : "skip",
  );
  const selectedDayData = useQuery(
    "weather:getDayObservations",
    isValidDate(selectedTargetDate)
      ? {
          stationIcao: STATION_ICAO,
          date: selectedTargetDate,
        }
      : "skip",
  );
  const trendRows = trendResult?.rows ?? [];
  const selectedComparison = selectedDayData?.comparison ?? null;
  const trendChartPoints = useMemo(
    () =>
      trendRows
        .filter((row) => Number.isFinite(row.maxTempF) && Number.isFinite(row.capturedAt))
        .map((row) => ({
          x: row.capturedAt,
          y: row.maxTempF,
          deltaMaxF: row.deltaMaxF,
          changeDirection: row.changeDirection,
          capturedAtLocal: row.capturedAtLocal,
        })),
    [trendRows],
  );
  const trendSummary = useMemo(() => {
    if (!trendChartPoints.length) {
      return null;
    }

    let minPoint = trendChartPoints[0];
    let maxPoint = trendChartPoints[0];
    for (const point of trendChartPoints) {
      if (point.y < minPoint.y) {
        minPoint = point;
      }
      if (point.y > maxPoint.y) {
        maxPoint = point;
      }
    }

    const firstPoint = trendChartPoints[0];
    const latestPoint = trendChartPoints[trendChartPoints.length - 1];
    const netDelta = latestPoint.y - firstPoint.y;

    return {
      firstPoint,
      latestPoint,
      minPoint,
      maxPoint,
      pointCount: trendChartPoints.length,
      changeCount: trendResult?.changeCount ?? 0,
      netDelta,
    };
  }, [trendChartPoints, trendResult]);
  const trendChartData = useMemo(
    () => ({
      datasets: [
        {
          label: `${selectedProviderConfig.label} predicted high`,
          data: trendChartPoints,
          parsing: false,
          stepped: true,
          borderWidth: 2,
          borderColor: selectedProviderConfig.color,
          backgroundColor: `${selectedProviderConfig.color}22`,
          pointRadius: trendChartPoints.map((point) =>
            point.changeDirection === "same" ? 3 : 4,
          ),
          pointHoverRadius: 5,
          pointBackgroundColor: trendChartPoints.map((point) =>
            getTrendPointColor(point.changeDirection, selectedProviderConfig.color),
          ),
          pointBorderColor: trendChartPoints.map((point) =>
            getTrendPointColor(point.changeDirection, selectedProviderConfig.color),
          ),
        },
      ],
    }),
    [selectedProviderConfig, trendChartPoints],
  );
  const trendChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            title(items) {
              if (!items.length) {
                return "";
              }
              return formatChicagoDateTime(items[0].parsed.x);
            },
            label(item) {
              const deltaValue = item.raw?.deltaMaxF;
              const deltaText = Number.isFinite(deltaValue)
                ? ` (${formatDelta(deltaValue, "F")})`
                : "";
              return `${selectedProviderConfig.label}: ${item.parsed.y.toFixed(1)}°F${deltaText}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: "Snapshot Capture Time (America/Chicago)",
          },
          ticks: {
            maxTicksLimit: 8,
            callback(value) {
              return formatChicagoAxisDateTime(Number(value));
            },
          },
        },
        y: {
          title: {
            display: true,
            text: "Predicted Daily High (°F)",
          },
          ticks: {
            callback(value) {
              return `${Number(value).toFixed(0)}°F`;
            },
          },
        },
      },
    }),
    [selectedProviderConfig],
  );

  const latestSourceStats = useMemo(() => {
    const readings = latestSnapshot?.actualReadings ?? [];
    const okCount = readings.filter((reading) => reading.status === "ok").length;
    return {
      total: readings.length,
      okCount,
      errorCount: readings.length - okCount,
    };
  }, [latestSnapshot]);
  const latestMajorSourceStats = useMemo(
    () => getLatestSnapshotMajorSourceStats(latestSnapshot),
    [latestSnapshot],
  );

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

  async function handleBackfillPredictions() {
    if (isBackfillingPredictions) {
      return;
    }
    setIsBackfillingPredictions(true);
    setBackfillMessage("");
    try {
      const result = await backfillPredictions({
        stationIcao: STATION_ICAO,
        limit: FORECAST_TREND_BACKFILL_LIMIT,
      });
      setBackfillMessage(
        `Indexed ${result?.insertedPredictionCount ?? 0} prediction rows from ${result?.insertedSnapshotCount ?? 0} snapshots; skipped ${result?.skippedSnapshotCount ?? 0}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBackfillMessage(`Backfill failed: ${message}`);
    } finally {
      setIsBackfillingPredictions(false);
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
            <button
              type="button"
              onClick={handleBackfillPredictions}
              disabled={isBackfillingPredictions}
              className="rounded-full border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:border-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBackfillingPredictions ? "Backfilling..." : "Backfill Trends"}
            </button>
          </div>
          <p className="mt-3 text-xs text-black/65">
            {collectMessage || "Cron runs hourly at minute 00; use Collect Now for manual snapshot capture."}
          </p>
          <p className="mt-1 text-xs text-black/65">
            {backfillMessage ||
              `Trend backfill indexes the latest ${FORECAST_TREND_BACKFILL_LIMIT} snapshots so existing history appears in the progression chart.`}
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
            <>
              <div className="mt-4 md:hidden">
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-black/60">
                        Captured
                      </p>
                      <p className="mt-1 text-sm font-semibold text-black">
                        {formatSnapshotTime(latestSnapshot)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusClass(latestSnapshot.status)}`}
                    >
                      {latestSnapshot.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusClass(latestMajorSourceStats.status)}`}
                    >
                      <span
                        className={`mr-2 h-2 w-2 rounded-full ${
                          latestMajorSourceStats.isAllOk
                            ? "bg-emerald-600"
                            : latestMajorSourceStats.okCount > 0
                              ? "bg-amber-600"
                              : "bg-red-600"
                        }`}
                      />
                      {latestMajorSourceStats.okCount}/{latestMajorSourceStats.total} major sources ok
                    </span>
                    <span className="inline-flex rounded-full bg-black/5 px-3 py-1 text-xs font-semibold text-black/70">
                      {latestSourceStats.okCount}/{latestSourceStats.total} actual ok
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-black/60">
                    Major sources: Microsoft, AccuWeather, Google, Weather.com,
                    and NOAA.
                  </p>
                </div>
              </div>

              <div className="mt-4 hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-7">
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
            </>
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Forecast Progression
              </h2>
              <p className="mt-2 text-sm text-black/65">
                Track how each provider moved its predicted daily high for a single
                Chicago date over time.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-medium text-black">
                Provider
                <select
                  value={selectedProvider}
                  onChange={(event) => setSelectedProvider(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm text-black"
                >
                  {TREND_PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-black">
                Target Date
                <input
                  type="date"
                  value={selectedTargetDate}
                  onChange={(event) => setSelectedTargetDate(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm text-black"
                />
              </label>
            </div>
          </div>

          {latestTargetDateOptions.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {latestTargetDateOptions.map((dateKey) => (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => setSelectedTargetDate(dateKey)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    selectedTargetDate === dateKey
                      ? "border-black bg-black text-white"
                      : "border-black/15 bg-white text-black hover:border-black"
                  }`}
                >
                  {dateKey}
                </button>
              ))}
            </div>
          ) : null}

          {!isValidDate(selectedTargetDate) ? (
            <p className="mt-4 text-sm text-black/65">
              Choose a valid target date to load the progression chart.
            </p>
          ) : trendResult === undefined ? (
            <p className="mt-4 text-sm text-black/65">
              Loading progression for {selectedProviderConfig.label} on{" "}
              {selectedTargetDate}...
            </p>
          ) : !trendRows.length ? (
            <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-white/60 p-4 text-sm text-black/65">
              No indexed forecast history for {selectedProviderConfig.label} on{" "}
              {selectedTargetDate}.
              {snapshots.length
                ? " If this is your first run after adding forecast trends, use Backfill Trends to index existing snapshots."
                : ""}
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-black/60">
                    First Prediction
                  </p>
                  <p className="mt-1 text-sm font-semibold text-black">
                    {formatTemp(trendSummary?.firstPoint?.y, "F")}
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    {formatStoredLocalDateTime(
                      trendSummary?.firstPoint?.capturedAtLocal,
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-black/60">
                    Latest Prediction
                  </p>
                  <p className="mt-1 text-sm font-semibold text-black">
                    {formatTemp(trendSummary?.latestPoint?.y, "F")}
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    {formatStoredLocalDateTime(
                      trendSummary?.latestPoint?.capturedAtLocal,
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-black/60">
                    Net Change
                  </p>
                  <p className="mt-1 text-sm font-semibold text-black">
                    {formatDelta(trendSummary?.netDelta, "F")}
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    {trendSummary?.changeCount ?? 0} changes
                  </p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-black/60">
                    Lowest Seen
                  </p>
                  <p className="mt-1 text-sm font-semibold text-black">
                    {formatTemp(trendSummary?.minPoint?.y, "F")}
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    {formatStoredLocalDateTime(
                      trendSummary?.minPoint?.capturedAtLocal,
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-black/60">
                    Highest Seen
                  </p>
                  <p className="mt-1 text-sm font-semibold text-black">
                    {formatTemp(trendSummary?.maxPoint?.y, "F")}
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    {formatStoredLocalDateTime(
                      trendSummary?.maxPoint?.capturedAtLocal,
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-black/60">
                    Official Max
                  </p>
                  <p className="mt-1 text-sm font-semibold text-black">
                    {formatTemp(selectedComparison?.metarMaxF, "F")}
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    {selectedComparison?.metarMaxAtLocal
                      ? formatStoredLocalDateTime(selectedComparison.metarMaxAtLocal)
                      : "Available after METAR ingest"}
                  </p>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-2xl border border-black/10 bg-white/75">
                <div className="min-w-[760px] p-4 md:min-w-0">
                  <div className="h-[340px] md:h-[320px]">
                    <Line data={trendChartData} options={trendChartOptions} />
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setIsTrendTableOpen((current) => !current)}
                  className="inline-flex items-center rounded-full border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:border-black"
                >
                  {isTrendTableOpen ? "Hide" : "Show"} capture detail table
                  <span className="ml-2 text-xs font-medium text-black/60">
                    {trendRows.length} rows
                  </span>
                </button>
              </div>

              {isTrendTableOpen ? (
                <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
                  <table className="min-w-full text-sm">
                    <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                      <tr>
                        <th className="px-3 py-2">Captured (Chicago)</th>
                        <th className="px-3 py-2">Lead Days</th>
                        <th className="px-3 py-2">Predicted High F</th>
                        <th className="px-3 py-2">Delta</th>
                        <th className="px-3 py-2">Day Phrase</th>
                        <th className="px-3 py-2">Night Phrase</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendRows.map((row) => (
                        <tr key={row._id} className="border-t border-black/10">
                          <td className="px-3 py-2 font-semibold text-black">
                            {formatStoredLocalDateTime(row.capturedAtLocal)}
                          </td>
                          <td className="px-3 py-2 text-black/75">
                            {Number.isFinite(row.leadDays) ? row.leadDays : "—"}
                          </td>
                          <td className="px-3 py-2 text-black/75">
                            {formatTemp(row.maxTempF, "F")}
                          </td>
                          <td className="px-3 py-2 text-black/75">
                            {formatDelta(row.deltaMaxF, "F")}
                          </td>
                          <td className="px-3 py-2 text-black/75">
                            {row.dayPhrase || "—"}
                          </td>
                          <td className="px-3 py-2 text-black/75">
                            {row.nightPhrase || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
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
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setIsRecentHistoryOpen((current) => !current)}
              className="inline-flex items-center rounded-full border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:border-black"
            >
              {isRecentHistoryOpen ? "Hide" : "Show"} recent hourly history
              <span className="ml-2 text-xs font-medium text-black/60">
                {snapshots.length} rows
              </span>
            </button>
          </div>
          {isRecentHistoryOpen ? (
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
          ) : null}
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
