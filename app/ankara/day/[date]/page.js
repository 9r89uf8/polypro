"use client";

import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import { useAction, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Title);

const STATION_ICAO = "LTAC";
const STATION_NAME = "Ankara Esenbo\u011fa";
const ANKARA_TIMEZONE = "Europe/Istanbul";
const CHICAGO_TIMEZONE = "America/Chicago";
const DAY_MS = 24 * 60 * 60 * 1000;

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function ankaraTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ANKARA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = getDateParts(formatter, new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateKeyParts(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || "");
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateKeyFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate(),
  )}`;
}

function shiftDateKey(dateKey, deltaDays) {
  const parts = parseDateKeyParts(dateKey);
  if (!parts) {
    return null;
  }
  const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day);
  return formatDateKeyFromUtcDate(new Date(utcMs + deltaDays * DAY_MS));
}

function buildPreviousDateKeys(dateKey, count) {
  const keys = [];
  for (let offset = 1; offset <= count; offset += 1) {
    const previousDate = shiftDateKey(dateKey, -offset);
    if (previousDate) {
      keys.push(previousDate);
    }
  }
  return keys;
}

function parseMinute(tsLocal) {
  const match = /(\d{2}):(\d{2})(?::\d{2})?$/.exec(tsLocal || "");
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return hour * 60 + minute;
}

function minuteLabel(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "";
  }
  const normalized = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatTemp(value, unit) {
  if (value === undefined || value === null) {
    return "\u2014";
  }
  return `${value.toFixed(1)}\u00b0${unit}`;
}

function formatStoredLocalDateTime(tsLocal) {
  const match =
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(tsLocal || "");
  if (!match) {
    return tsLocal || "\u2014";
  }
  const hour24 = Number(match[2]);
  const minute = Number(match[3]);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) {
    return tsLocal;
  }
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${match[1]} ${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatAnkaraDateTimeSeconds(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "\u2014";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ANKARA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const parts = getDateParts(formatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod?.toUpperCase() ?? ""}`.trim();
}

function formatChicagoDateTimeSeconds(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "\u2014";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const parts = getDateParts(formatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod?.toUpperCase() ?? ""}`.trim();
}

function formatAnkaraClock(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "\u2014";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ANKARA_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
  const parts = getDateParts(formatter, new Date(epochMs));
  return `${parts.weekday} ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod?.toUpperCase() ?? ""} ${parts.timeZoneName ?? ""}`.trim();
}

function formatRaceWinner(winner) {
  if (winner === "mgm") {
    return "MGM";
  }
  if (winner === "tgftp") {
    return "NOAA tgftp";
  }
  if (winner === "tie") {
    return "Tie";
  }
  return "Pending";
}

function formatLeadMs(leadMs) {
  if (!Number.isFinite(leadMs)) {
    return "\u2014";
  }
  if (leadMs > 0 && leadMs < 1000) {
    return "<1s";
  }
  if (leadMs < 120000) {
    return `${(leadMs / 1000).toFixed(1)}s`;
  }
  return `${(leadMs / 60000).toFixed(1)} min`;
}

function formatLivePollMessage(result) {
  if (!result?.ok) {
    return "Latest MGM poll skipped.";
  }

  const firstSeenText = Number.isFinite(result.row?.mgmFirstSeenAt)
    ? formatAnkaraDateTimeSeconds(result.row.mgmFirstSeenAt)
    : null;
  const lagText = Number.isFinite(result.availabilityLagMs)
    ? `${Math.max(0, result.availabilityLagMs / 60000).toFixed(1)} min lag`
    : null;

  return `Latest MGM poll: ${result.insertedCount > 0 ? "saved" : "no new report"} ${result.row?.reportType ?? "message"} ${result.row?.obsTimeLocal ?? ""}.${firstSeenText ? ` First seen ${firstSeenText}${lagText ? ` (${lagText})` : ""}.` : ""}`;
}

function buildOfficialLineDataset(rows, unit) {
  const points = rows
    .map((row) => {
      const x = parseMinute(row.obsTimeLocal);
      if (x === null) {
        return null;
      }
      const y = unit === "C" ? row.tempC : row.tempF;
      if (!Number.isFinite(y)) {
        return null;
      }
      return {
        x,
        y,
        reportType: row.reportType,
      };
    })
    .filter(Boolean);

  return {
    label: "Official MGM",
    data: points,
    borderColor: "#2563eb",
    backgroundColor: "#2563eb",
    pointRadius: points.map((point) => (point.reportType === "SPECI" ? 4.5 : 2.5)),
    pointHoverRadius: points.map((point) => (point.reportType === "SPECI" ? 6 : 4)),
    pointHitRadius: 18,
    pointBackgroundColor: points.map((point) =>
      point.reportType === "SPECI" ? "#b91c1c" : "#2563eb",
    ),
    pointBorderColor: points.map((point) =>
      point.reportType === "SPECI" ? "#7f1d1d" : "#1d4ed8",
    ),
    pointBorderWidth: 1.5,
    borderWidth: 2,
    tension: 0.22,
    showLine: true,
  };
}

function buildMgmAwsDataset(mgmObsRows, unit) {
  const points = mgmObsRows
    .map((row) => {
      const x = parseMinute(row.obsTimeLocal);
      if (x === null) {
        return null;
      }
      const y = unit === "C" ? row.tempC : row.tempF;
      if (!Number.isFinite(y)) {
        return null;
      }
      return { x, y };
    })
    .filter(Boolean);

  if (!points.length) {
    return null;
  }

  return {
    label: "MGM AWS",
    data: points,
    borderColor: "#16a34a",
    backgroundColor: "#16a34a",
    pointRadius: 3,
    pointHoverRadius: 5,
    pointHitRadius: 18,
    pointStyle: "rectRot",
    pointBorderColor: "#166534",
    pointBorderWidth: 1.5,
    borderWidth: 2,
    tension: 0.22,
    showLine: true,
  };
}

function buildMgmForecastDataset(forecastRows, unit) {
  const points = forecastRows
    .map((row) => {
      const x = parseMinute(row.forecastTimeLocal);
      if (x === null) {
        return null;
      }
      const y = unit === "C" ? row.tempC : row.tempF;
      if (!Number.isFinite(y)) {
        return null;
      }
      return { x, y };
    })
    .filter(Boolean);

  if (!points.length) {
    return null;
  }

  return {
    label: "MGM 3-Hourly Forecast",
    data: points,
    borderColor: "#f59e0b",
    backgroundColor: "#f59e0b",
    pointRadius: 3,
    pointHoverRadius: 5,
    pointHitRadius: 18,
    pointStyle: "triangle",
    pointBorderColor: "#b45309",
    pointBorderWidth: 1.5,
    borderWidth: 2,
    borderDash: [6, 3],
    tension: 0.22,
    showLine: true,
  };
}

export default function AnkaraDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [displayUnit, setDisplayUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [liveMessage, setLiveMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const inFlightRef = useRef(false);

  const isDateValid = isValidDate(date);
  const ankaraTodayDate = ankaraTodayKey();
  const isToday = isDateValid && date === ankaraTodayDate;
  const quickPreviousDates = useMemo(() => buildPreviousDateKeys(date, 2), [date]);

  const pollLatest = useAction("ankara:pollLatestMgmMetar");
  const pollMgmAws = useAction("ankara:pollMgmCurrentConditions");

  const dayData = useQuery(
    "ankara:getDayStationRows",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const mgmObservationData = useQuery(
    "ankara:getMgmObservations",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const mgmForecastData = useQuery(
    "ankara:getMgmHourlyForecasts",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const raceData = useQuery("ankara:getRecentPublishRaceReports", {
    stationIcao: STATION_ICAO,
    limit: 12,
    routineOnly: true,
  });

  const rows = dayData?.rows ?? [];
  const summary = dayData?.summary ?? null;
  const mgmObservations = mgmObservationData?.rows ?? [];
  const mgmForecastRows = mgmForecastData?.rows ?? [];
  const raceRows = raceData?.rows ?? [];
  const latestRow = rows.length ? rows[rows.length - 1] : null;
  const latestMgmObs = mgmObservations.length ? mgmObservations[mgmObservations.length - 1] : null;
  const maxTemp = displayUnit === "C" ? summary?.maxTempC : summary?.maxTempF;

  useEffect(() => {
    setInputDate(date);
  }, [date]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!isDateValid) {
      setLiveMessage("");
      return;
    }
    if (!isToday) {
      setLiveMessage(
        "Historical LTAC dates depend on previously captured live MGM rows. No date-bounded official history backfill is wired yet.",
      );
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        const result = await pollLatest({ stationIcao: STATION_ICAO });
        if (!cancelled) {
          setLiveMessage(formatLivePollMessage(result));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setLiveMessage(`LTAC sync failed: ${message}`);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [date, isDateValid, isToday, pollLatest]);

  async function handleRefreshNow() {
    if (!isDateValid || !isToday || inFlightRef.current) {
      return;
    }

    setIsRefreshing(true);
    inFlightRef.current = true;
    try {
      const [result] = await Promise.allSettled([
        pollLatest({ stationIcao: STATION_ICAO }),
        pollMgmAws({ stationIcao: STATION_ICAO }),
      ]);
      if (result.status === "fulfilled") {
        setLiveMessage(formatLivePollMessage(result.value));
      } else {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        setLiveMessage(`Manual refresh failed: ${message}`);
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setLiveMessage(`Manual refresh failed: ${message}`);
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }

  function handleGoToDate(event) {
    event.preventDefault();
    if (!isValidDate(inputDate)) {
      return;
    }
    router.push(`/ankara/day/${inputDate}`);
  }

  const chartData = useMemo(
    () => {
      const datasets = [];
      if (rows.length) {
        datasets.push(buildOfficialLineDataset(rows, displayUnit));
      }
      const awsDs = buildMgmAwsDataset(mgmObservations, displayUnit);
      if (awsDs) {
        datasets.push(awsDs);
      }
      const fcDs = buildMgmForecastDataset(mgmForecastRows, displayUnit);
      if (fcDs) {
        datasets.push(fcDs);
      }
      return { datasets };
    },
    [rows, displayUnit, mgmObservations, mgmForecastRows],
  );

  const chartOptions = useMemo(
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
        legend: { position: "top" },
        tooltip: {
          padding: 10,
          titleFont: { size: 13 },
          bodyFont: { size: 12 },
          callbacks: {
            title(items) {
              if (!items.length) {
                return "";
              }
              return `Local ${minuteLabel(items[0].parsed.x)}`;
            },
            label(item) {
              const reportType = item.raw?.reportType ? `${item.raw.reportType} ` : "";
              return `${reportType}${item.parsed.y.toFixed(1)}\u00b0${displayUnit}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 1439,
          title: { display: true, text: "Local Time (Europe/Istanbul)" },
          ticks: {
            stepSize: 60,
            callback(value) {
              return minuteLabel(Number(value));
            },
          },
        },
        y: {
          title: { display: true, text: `Temperature (\u00b0${displayUnit})` },
        },
      },
    }),
    [displayUnit],
  );

  if (!isDateValid) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-6">
          <h1 className="text-2xl font-semibold text-red-800">Invalid Ankara date</h1>
          <p className="mt-2 text-sm text-red-700">
            Use a `YYYY-MM-DD` date in the route.
          </p>
          <div className="mt-4">
            <Link
              href="/ankara/today"
              className="inline-flex rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-800"
            >
              Open Ankara today
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
            STATION {STATION_ICAO}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-foreground">
            {STATION_NAME} Official METAR Day Chart
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-black/65">
            Official LTAC METAR and SPECI from MGM, stored live and compared
            against NOAA `tgftp` in a publish-race table. MGM AWS
            observations and 3-hourly forecasts are overlaid on the chart.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <Link
              href="/ankara/today"
              className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:border-blue-400"
            >
              Current Date {ankaraTodayDate}
            </Link>
            {quickPreviousDates.map((previousDate) => (
              <Link
                key={previousDate}
                href={`/ankara/day/${previousDate}`}
                className="inline-flex rounded-full border border-black/15 bg-white/70 px-4 py-2 text-sm font-semibold text-black hover:border-black"
              >
                {previousDate}
              </Link>
            ))}
          </div>

          <form
            onSubmit={handleGoToDate}
            className="mt-4 flex flex-wrap items-center gap-3"
          >
            <label className="text-sm font-medium text-black/70" htmlFor="ankara-day-picker">
              Pick Date
            </label>
            <input
              id="ankara-day-picker"
              type="date"
              value={inputDate}
              onChange={(event) => setInputDate(event.target.value)}
              className="rounded-2xl border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-black"
            />
            <button
              type="submit"
              className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent"
            >
              Go
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border border-black/10 bg-white/70 p-1">
              {["C", "F"].map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setDisplayUnit(unit)}
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    displayUnit === unit
                      ? "bg-black text-white"
                      : "text-black/70 hover:text-black"
                  }`}
                >
                  °{unit}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleRefreshNow}
              disabled={isRefreshing || !isToday}
              className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing..." : "Refresh Now"}
            </button>
            {isToday ? (
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-emerald-800">
                Live MGM ingest enabled
              </span>
            ) : (
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-amber-900">
                Historical capture only
              </span>
            )}
          </div>

          <div className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
            <span className="font-semibold uppercase tracking-[0.16em] text-sky-800">
              Ankara Time
            </span>
            <span className="font-medium">{formatAnkaraClock(clockNowMs)}</span>
          </div>

          <p className="mt-4 text-sm text-black/70">
            {liveMessage ||
              (isToday
                ? "Waiting for MGM sync..."
                : "Historical LTAC dates depend on previously captured live MGM rows.")}
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Latest Official Temp
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {latestRow
                ? formatTemp(
                    displayUnit === "C" ? latestRow.tempC : latestRow.tempF,
                    displayUnit,
                  )
                : "\u2014"}
            </p>
            <p className="mt-2 text-sm text-black/65">
              {latestRow?.obsTimeLocal
                ? `${latestRow.reportType} at ${formatStoredLocalDateTime(latestRow.obsTimeLocal)}`
                : "No official LTAC observation yet"}
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Latest METAR Max
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {summary ? formatTemp(maxTemp, displayUnit) : "\u2014"}
            </p>
            <p className="mt-2 text-sm text-black/65">
              {summary?.maxTempAtLocal
                ? `at ${formatStoredLocalDateTime(summary.maxTempAtLocal)}`
                : "No METAR max recorded yet"}
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              MGM Forecast
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {"\u2014"}
            </p>
            <p className="mt-2 text-sm text-black/65">
              MGM 5-day forecast placeholder
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Latest MGM AWS Details
            </p>
            {latestMgmObs ? (
              <div className="mt-2 space-y-1 text-sm text-foreground">
                <p className="text-black/65">
                  AWS at {formatStoredLocalDateTime(latestMgmObs.obsTimeLocal)}
                </p>
                <p>
                  Humidity:{" "}
                  <span className="font-semibold">
                    {latestMgmObs.humidity != null ? `${latestMgmObs.humidity}%` : "\u2014"}
                  </span>
                </p>
                <p>
                  Wind:{" "}
                  <span className="font-semibold">
                    {latestMgmObs.windSpeedMps != null
                      ? `${latestMgmObs.windSpeedMps.toFixed(1)} km/h`
                      : "\u2014"}
                    {latestMgmObs.windDirection != null
                      ? ` @ ${latestMgmObs.windDirection}\u00b0`
                      : ""}
                  </span>
                </p>
                <p>
                  Visibility:{" "}
                  <span className="font-semibold">
                    {latestMgmObs.visibility != null ? `${latestMgmObs.visibility} m` : "\u2014"}
                  </span>
                </p>
                <p>
                  Pressure:{" "}
                  <span className="font-semibold">
                    {latestMgmObs.pressureHpa != null
                      ? `${latestMgmObs.pressureHpa} hPa`
                      : "\u2014"}
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-black/65">No MGM observation yet</p>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Temperature Line
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Official LTAC METAR (blue), MGM AWS observations (green),
                and MGM 3-hourly forecast (orange dashed).
              </p>
            </div>
            <p className="text-xs text-black/40 md:hidden">
              Swipe left/right on mobile
            </p>
          </div>

          <div className="mt-6 overflow-x-auto">
            <div className="h-[620px] min-w-[800px]">
              {chartData.datasets.length ? (
                <Line data={chartData} options={chartOptions} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-sm text-black/55">
                  No LTAC observations stored for this date yet.
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <h2 className="text-xl font-semibold text-foreground">Latest Raw METAR</h2>
          <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 font-mono text-sm text-black/80">
            {summary?.latestRawMetar ?? "No latest raw METAR stored yet."}
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                MGM + NOAA Publish Race
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Recent routine LTAC METAR first-seen timing: MGM vs NOAA
                `tgftp`. Times shown in America/Chicago.
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/55">
                  <th className="px-3 py-2 font-semibold">Report Time</th>
                  <th className="px-3 py-2 font-semibold">Winner</th>
                  <th className="px-3 py-2 font-semibold">Lead</th>
                  <th className="px-3 py-2 font-semibold">MGM First Seen</th>
                  <th className="px-3 py-2 font-semibold">tgftp First Seen</th>
                  <th className="px-3 py-2 font-semibold">Raw METAR</th>
                </tr>
              </thead>
              <tbody>
                {raceRows.length ? (
                  raceRows.map((row) => (
                    <tr
                      key={row._id}
                      className="border-b border-black/5 align-top last:border-b-0"
                    >
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {formatChicagoDateTimeSeconds(row.reportTsUtc)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            row.winner === "mgm"
                              ? "bg-emerald-50 text-emerald-800"
                              : row.winner === "tgftp"
                                ? "bg-amber-50 text-amber-900"
                                : row.winner === "tie"
                                  ? "bg-slate-100 text-slate-800"
                                  : "bg-black/[0.05] text-black/65"
                          }`}
                        >
                          {formatRaceWinner(row.winner)}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {formatLeadMs(row.leadMs)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatChicagoDateTimeSeconds(row.mgmFirstSeenAt)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatChicagoDateTimeSeconds(row.tgftpFirstSeenAt)}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-black/80">
                        {row.rawMetar ?? row.mgmRawMetar ?? row.tgftpRawMetar ?? "\u2014"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-black/55">
                      No publish-race rows stored yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <h2 className="text-xl font-semibold text-foreground">Raw Observations</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/55">
                  <th className="px-3 py-2 font-semibold">Local Time</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Temp</th>
                  <th className="px-3 py-2 font-semibold">First Seen</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Raw METAR</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => (
                    <tr
                      key={row._id}
                      className="border-b border-black/5 align-top last:border-b-0"
                    >
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {formatStoredLocalDateTime(row.obsTimeLocal)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            row.reportType === "SPECI"
                              ? "bg-red-50 text-red-800"
                              : "bg-sky-50 text-sky-800"
                          }`}
                        >
                          {row.reportType}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {displayUnit === "C"
                          ? formatTemp(row.tempC, "C")
                          : formatTemp(row.tempF, "F")}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {row.mgmFirstSeenAt
                          ? formatAnkaraDateTimeSeconds(row.mgmFirstSeenAt)
                          : "\u2014"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {row.source}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-black/80">
                        {row.rawMetar}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-black/55">
                      No stored rows for this date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
