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

const STATION_ICAO = "RKSI";
const STATION_NAME = "Incheon International";
const SEOUL_TIMEZONE = "Asia/Seoul";
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

function seoulTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIMEZONE,
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
    return "—";
  }
  return `${value.toFixed(1)}°${unit}`;
}

function formatStoredLocalDateTime(tsLocal) {
  const match =
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(tsLocal || "");
  if (!match) {
    return tsLocal || "—";
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

function formatSeoulDateTimeSeconds(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIMEZONE,
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
    return "—";
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

function formatRaceWinner(winner) {
  if (winner === "amo") {
    return "AMO/KMA";
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
    return "—";
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
    return "Latest official poll skipped.";
  }

  const firstSeenText = Number.isFinite(result.row?.amoFirstSeenAt)
    ? formatSeoulDateTimeSeconds(result.row.amoFirstSeenAt)
    : null;
  const lagText = Number.isFinite(result.availabilityLagMs)
    ? `${Math.max(0, result.availabilityLagMs / 60000).toFixed(1)} min lag`
    : null;

  return `Latest official poll: ${result.insertedCount > 0 ? "saved" : "no new report"} ${result.row?.reportType ?? "message"} ${result.row?.obsTimeLocal ?? ""}.${firstSeenText ? ` First seen ${firstSeenText}${lagText ? ` (${lagText})` : ""}.` : ""}`;
}

function formatAmosPollMessage(result) {
  if (!result?.ok) {
    return "AMOS runway sync skipped.";
  }
  const fifteenL = result.latest15L ?? null;
  return `AMOS runway sync: ${result.insertedCount > 0 || result.patchedCount > 0 ? "saved" : "no new rows"} ${result.rowCount ?? 0} runway rows for ${result.sampleTimeLocal ?? "the latest sample"}.${Number.isFinite(fifteenL?.tempC) ? ` 15L ${fifteenL.tempC.toFixed(1)}°C.` : ""}`;
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
    label: "Official AMO/KMA",
    data: points,
    borderColor: "#0f4c81",
    backgroundColor: "#0f4c81",
    pointRadius: points.map((point) => (point.reportType === "SPECI" ? 4.5 : 2.5)),
    pointHoverRadius: points.map((point) => (point.reportType === "SPECI" ? 6 : 4)),
    tension: 0.2,
  };
}

function buildAmosRunwayDataset(rows, unit, runwayDir) {
  const points = rows
    .map((row) => {
      if (row.rwyDir !== runwayDir) {
        return null;
      }
      const x = parseMinute(row.obsTimeLocal);
      const y = unit === "C" ? row.tempC : row.tempF;
      if (x === null || !Number.isFinite(y)) {
        return null;
      }
      return {
        x,
        y,
        rwyDir: row.rwyDir,
        qnhHpa: row.qnhHpa,
      };
    })
    .filter(Boolean);

  return {
    label: `AMOS ${runwayDir} (5 min)`,
    data: points,
    borderColor: "#d97706",
    backgroundColor: "#d97706",
    borderDash: [8, 4],
    pointRadius: 2,
    pointHoverRadius: 4,
    tension: 0.15,
  };
}

function formatSignedGap(gapMs) {
  if (!Number.isFinite(gapMs)) {
    return "—";
  }
  if (Math.abs(gapMs) < 30000) {
    return "same time";
  }
  const minutes = Math.abs(gapMs) / 60000;
  const minutesText =
    minutes < 10 ? `${minutes.toFixed(1)} min` : `${minutes.toFixed(0)} min`;
  return gapMs < 0 ? `${minutesText} earlier` : `${minutesText} later`;
}

function buildNearestAmosComparisons(officialRows, amosRows, runwayDir) {
  const runwayRows = amosRows.filter(
    (row) => row.rwyDir === runwayDir && Number.isFinite(row.tempC),
  );

  return officialRows
    .map((officialRow) => {
      let bestRow = null;
      let bestGapMs = Number.POSITIVE_INFINITY;

      for (const amosRow of runwayRows) {
        const gapMs = amosRow.obsTimeUtc - officialRow.obsTimeUtc;
        const absGapMs = Math.abs(gapMs);
        if (absGapMs > 10 * 60 * 1000) {
          continue;
        }
        if (
          absGapMs < bestGapMs ||
          (absGapMs === bestGapMs && gapMs < 0)
        ) {
          bestGapMs = absGapMs;
          bestRow = amosRow;
        }
      }

      if (!bestRow) {
        return {
          officialRow,
          amosRow: null,
          gapMs: null,
          deltaC: null,
          deltaF: null,
        };
      }

      const gapMs = bestRow.obsTimeUtc - officialRow.obsTimeUtc;
      const deltaC = bestRow.tempC - officialRow.tempC;
      const deltaF = bestRow.tempF - officialRow.tempF;

      return {
        officialRow,
        amosRow: bestRow,
        gapMs,
        deltaC,
        deltaF,
      };
    })
    .filter((row) => row.amosRow);
}

export default function SeoulDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [displayUnit, setDisplayUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [liveMessage, setLiveMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlightRef = useRef(false);

  const isDateValid = isValidDate(date);
  const seoulTodayDate = seoulTodayKey();
  const isToday = isDateValid && date === seoulTodayDate;
  const quickPreviousDates = useMemo(() => buildPreviousDateKeys(date, 2), [date]);

  const pollLatest = useAction("seoul:pollLatestStationMetar");
  const pollLatestAmosRunways = useAction("seoul:pollLatestAmosRunways");

  const dayData = useQuery(
    "seoul:getDayStationRows",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const raceData = useQuery("seoul:getRecentPublishRaceReports", {
    stationIcao: STATION_ICAO,
    limit: 12,
    routineOnly: true,
  });

  const rows = dayData?.rows ?? [];
  const summary = dayData?.summary ?? null;
  const amosRows = dayData?.amosRows ?? [];
  const raceRows = raceData?.rows ?? [];
  const latestTemp = displayUnit === "C" ? summary?.latestTempC : summary?.latestTempF;
  const maxTemp = displayUnit === "C" ? summary?.maxTempC : summary?.maxTempF;
  const minTemp = displayUnit === "C" ? summary?.minTempC : summary?.minTempF;
  const amos15LRows = useMemo(
    () =>
      amosRows.filter((row) => row.rwyDir === "15L" && Number.isFinite(row.tempC)),
    [amosRows],
  );
  const latest15LRow = amos15LRows.length ? amos15LRows[amos15LRows.length - 1] : null;

  useEffect(() => {
    setInputDate(date);
  }, [date]);

  useEffect(() => {
    if (!isDateValid) {
      setLiveMessage("");
      return;
    }
    if (!isToday) {
      setLiveMessage(
        "Historical RKSI dates depend on previously captured live official METAR rows and stored 5-minute AMOS runway rows. No date-bounded official history backfill is wired yet.",
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
        const [officialResult, amosResult] = await Promise.allSettled([
          pollLatest({ stationIcao: STATION_ICAO }),
          pollLatestAmosRunways({ stationIcao: STATION_ICAO }),
        ]);

        if (!cancelled) {
          const messages = [];
          if (officialResult.status === "fulfilled") {
            messages.push(formatLivePollMessage(officialResult.value));
          } else {
            console.error(officialResult.reason);
            const message =
              officialResult.reason instanceof Error
                ? officialResult.reason.message
                : String(officialResult.reason);
            messages.push(`Official sync failed: ${message}`);
          }

          if (amosResult.status === "fulfilled") {
            messages.push(formatAmosPollMessage(amosResult.value));
          } else {
            console.error(amosResult.reason);
            const message =
              amosResult.reason instanceof Error
                ? amosResult.reason.message
                : String(amosResult.reason);
            messages.push(`AMOS sync failed: ${message}`);
          }

          setLiveMessage(messages.join(" "));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setLiveMessage(`RKSI sync failed: ${message}`);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [date, isDateValid, isToday, pollLatest, pollLatestAmosRunways]);

  async function handleRefreshNow() {
    if (!isDateValid || !isToday || inFlightRef.current) {
      return;
    }

    setIsRefreshing(true);
    inFlightRef.current = true;
    try {
      const [officialResult, amosResult] = await Promise.allSettled([
        pollLatest({ stationIcao: STATION_ICAO }),
        pollLatestAmosRunways({ stationIcao: STATION_ICAO }),
      ]);
      const messages = [];

      if (officialResult.status === "fulfilled") {
        messages.push(formatLivePollMessage(officialResult.value));
      } else {
        console.error(officialResult.reason);
        const message =
          officialResult.reason instanceof Error
            ? officialResult.reason.message
            : String(officialResult.reason);
        messages.push(`Official sync failed: ${message}`);
      }

      if (amosResult.status === "fulfilled") {
        messages.push(formatAmosPollMessage(amosResult.value));
      } else {
        console.error(amosResult.reason);
        const message =
          amosResult.reason instanceof Error
            ? amosResult.reason.message
            : String(amosResult.reason);
        messages.push(`AMOS sync failed: ${message}`);
      }

      setLiveMessage(messages.join(" "));
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
    router.push(`/seoul/day/${inputDate}`);
  }

  const chartData = useMemo(
    () => {
      const datasets = [];
      if (rows.length) {
        datasets.push(buildOfficialLineDataset(rows, displayUnit));
      }
      if (amos15LRows.length) {
        datasets.push(buildAmosRunwayDataset(amos15LRows, displayUnit, "15L"));
      }
      return { datasets };
    },
    [rows, amos15LRows, displayUnit],
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
              if (item.dataset?.label?.startsWith("AMOS")) {
                const runwayLabel = item.raw?.rwyDir ? `${item.raw.rwyDir} ` : "";
                return `${runwayLabel}${item.parsed.y.toFixed(1)}°${displayUnit}`;
              }
              const reportType = item.raw?.reportType ? `${item.raw.reportType} ` : "";
              return `${reportType}${item.parsed.y.toFixed(1)}°${displayUnit}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 1439,
          title: { display: true, text: "Local Time (Asia/Seoul)" },
          ticks: {
            stepSize: 60,
            callback(value) {
              return minuteLabel(Number(value));
            },
          },
        },
        y: {
          title: { display: true, text: `Temperature (°${displayUnit})` },
        },
      },
    }),
    [displayUnit],
  );

  const amosComparisons = useMemo(
    () => buildNearestAmosComparisons(rows, amos15LRows, "15L"),
    [rows, amos15LRows],
  );

  if (!isDateValid) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-6">
          <h1 className="text-2xl font-semibold text-red-800">Invalid Seoul date</h1>
          <p className="mt-2 text-sm text-red-700">
            Use a `YYYY-MM-DD` date in the route.
          </p>
          <div className="mt-4">
            <Link
              href="/seoul/today"
              className="inline-flex rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-800"
            >
              Open Seoul today
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
            Official RKSI METAR from Korea&apos;s Aviation Meteorological Office
            (AMO/KMA) latest-METAR API, with a separate 5-minute AMOS runway
            sensor capture stored alongside it. The chart overlays runway 15L so
            we can see how closely it tracks the official reported temperature.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <Link
              href="/seoul/today"
              className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:border-sky-400"
            >
              Current Date {seoulTodayDate}
            </Link>
            {quickPreviousDates.map((previousDate) => (
              <Link
                key={previousDate}
                href={`/seoul/day/${previousDate}`}
                className="inline-flex rounded-full border border-black/15 bg-white/70 px-4 py-2 text-sm font-semibold text-black hover:border-black"
              >
                {previousDate}
              </Link>
            ))}
          </div>

          <form onSubmit={handleGoToDate} className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-black/70" htmlFor="seoul-day-picker">
              Pick Date
            </label>
            <input
              id="seoul-day-picker"
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
              {isRefreshing ? "Refreshing..." : "Refresh Current Data"}
            </button>
            {isToday ? (
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-emerald-800">
                Live official ingest enabled
              </span>
            ) : (
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-amber-900">
                Historical capture only
              </span>
            )}
          </div>

          <p className="mt-4 text-sm text-black/70">
            {liveMessage ||
              (isToday
                ? "Waiting for AMO sync..."
                : "Historical RKSI dates depend on previously captured live official and AMOS rows.")}
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Latest
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {summary ? formatTemp(latestTemp, displayUnit) : "—"}
            </p>
            <p className="mt-2 text-sm text-black/65">
              {summary?.latestReportType ?? "—"} at{" "}
              {summary?.latestObsTimeLocal
                ? formatStoredLocalDateTime(summary.latestObsTimeLocal)
                : "—"}
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Day Range
            </p>
            <p className="mt-2 text-xl font-semibold text-foreground">
              Max {summary ? formatTemp(maxTemp, displayUnit) : "—"}
            </p>
            <p className="mt-1 text-sm text-black/65">
              {summary?.maxTempAtLocal
                ? `at ${formatStoredLocalDateTime(summary.maxTempAtLocal)}`
                : "—"}
            </p>
            <p className="mt-3 text-xl font-semibold text-foreground">
              Min {summary ? formatTemp(minTemp, displayUnit) : "—"}
            </p>
            <p className="mt-1 text-sm text-black/65">
              {summary?.minTempAtLocal
                ? `at ${formatStoredLocalDateTime(summary.minTempAtLocal)}`
                : "—"}
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Messages
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {summary?.obsCount ?? 0}
            </p>
            <p className="mt-2 text-sm text-black/65">
              Routine RKSI METAR is normally half-hourly. Full-day coverage
              depends on rows being captured live because this page stores the
              latest official AMO feed rather than a confirmed history endpoint.
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Latest AMOS 15L
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {latest15LRow
                ? formatTemp(
                    displayUnit === "C" ? latest15LRow.tempC : latest15LRow.tempF,
                    displayUnit,
                  )
                : "—"}
            </p>
            <p className="mt-2 text-sm text-black/65">
              {latest15LRow?.obsTimeLocal
                ? `15L at ${formatStoredLocalDateTime(latest15LRow.obsTimeLocal)}`
                : "No stored 15L runway sample yet for this date."}
            </p>
            <p className="mt-2 text-xs text-black/55">
              Stored every 5 minutes from `amos_info.do`. All runway rows are
              kept, but the chart overlays 15L by default.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Temperature Line
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Solid blue is official METAR/SPECI. Dashed orange is the stored
                15L AMOS runway-temperature feed sampled every 5 minutes.
              </p>
            </div>
          </div>

          <div className="mt-6 h-[420px]">
            {chartData.datasets.length ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-sm text-black/55">
                No RKSI METAR or 15L AMOS observations stored for this date yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                15L Correlation Check
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Nearest stored 15L AMOS sample against each official RKSI METAR
                or SPECI point. Small deltas support the representative-runway
                hypothesis, but they do not prove the official AMO processing
                path.
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/55">
                  <th className="px-3 py-2 font-semibold">Official Time</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Official Temp</th>
                  <th className="px-3 py-2 font-semibold">15L Sample</th>
                  <th className="px-3 py-2 font-semibold">15L Temp</th>
                  <th className="px-3 py-2 font-semibold">Gap</th>
                  <th className="px-3 py-2 font-semibold">Delta</th>
                </tr>
              </thead>
              <tbody>
                {amosComparisons.length ? (
                  amosComparisons.map((comparison) => (
                    <tr
                      key={`${comparison.officialRow._id}-${comparison.amosRow._id}`}
                      className="border-b border-black/5 align-top last:border-b-0"
                    >
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {formatStoredLocalDateTime(comparison.officialRow.obsTimeLocal)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {comparison.officialRow.reportType}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {displayUnit === "C"
                          ? formatTemp(comparison.officialRow.tempC, "C")
                          : formatTemp(comparison.officialRow.tempF, "F")}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {formatStoredLocalDateTime(comparison.amosRow.obsTimeLocal)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {displayUnit === "C"
                          ? formatTemp(comparison.amosRow.tempC, "C")
                          : formatTemp(comparison.amosRow.tempF, "F")}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatSignedGap(comparison.gapMs)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {displayUnit === "C"
                          ? formatTemp(comparison.deltaC, "C")
                          : formatTemp(comparison.deltaF, "F")}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-black/55">
                      No 15L AMOS samples were found within 10 minutes of the
                      stored official rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
              <h2 className="text-xl font-semibold text-foreground">Publish Race</h2>
              <p className="mt-1 text-sm text-black/60">
                Recent routine half-hour RKSI METAR first-seen timing across the
                official AMO/KMA latest-METAR API and NOAA `tgftp`. Times in this
                table are shown in America/Chicago. Official RKSI polling is only
                scheduled at the `:29` to `:31` and `:58` to `:01` routine
                windows so the race stays useful without excessive AMO calls.
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
                  <th className="px-3 py-2 font-semibold">AMO Seen</th>
                  <th className="px-3 py-2 font-semibold">tgftp Seen</th>
                  <th className="px-3 py-2 font-semibold">tgftp Last-Modified</th>
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
                            row.winner === "amo"
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
                        {formatChicagoDateTimeSeconds(row.amoFirstSeenAt)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatChicagoDateTimeSeconds(row.tgftpFirstSeenAt)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatChicagoDateTimeSeconds(row.tgftpLastModifiedAt)}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-black/80">
                        {row.rawMetar ?? row.amoRawMetar ?? row.tgftpRawMetar ?? "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-black/55">
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
                        {row.amoFirstSeenAt
                          ? formatSeoulDateTimeSeconds(row.amoFirstSeenAt)
                          : "—"}
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
