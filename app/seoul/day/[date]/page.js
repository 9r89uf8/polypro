"use client";

import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import { useEffect, useMemo, useRef, useState } from "react";

const nowLinePlugin = {
  id: "seoulNowLine",
  afterDatasetsDraw(chart, _args, options) {
    if (!options?.display || !Number.isFinite(options.minute)) {
      return;
    }

    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(options.minute);
    if (x < chartArea.left || x > chartArea.right) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(103, 232, 249, 0.42)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();

    ctx.fillStyle = "#67e8f9";
    ctx.font = "500 10px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("NOW", x, chartArea.top + 12);
    ctx.restore();
  },
};

ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  nowLinePlugin,
);

const STATION_ICAO = "RKSI";
const SEOUL_TIMEZONE = "Asia/Seoul";
const DAY_MS = 24 * 60 * 60 * 1000;

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getDateParts(formatter, date) {
  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function seoulTodayKey() {
  const parts = getDateParts(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SEOUL_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    new Date(),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey ?? "");
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function shiftDateKey(dateKey, deltaDays) {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    return null;
  }
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) + deltaDays * DAY_MS,
  );
  return `${shifted.getUTCFullYear()}-${String(
    shifted.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function parseMinute(localTimestamp) {
  const match = /(\d{2}):(\d{2})(?::\d{2})?$/.exec(localTimestamp ?? "");
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteLabel(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "";
  }
  const normalized = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${
    hour24 >= 12 ? "PM" : "AM"
  }`;
}

function formatClock(epochMs, includeSeconds = false) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  }).format(new Date(epochMs));
}

function formatTemperature(row, unit) {
  const value = unit === "C" ? row?.tempC : row?.tempF;
  return Number.isFinite(value) ? `${value.toFixed(1)}°` : "—";
}

function captureOffset(row) {
  if (!Number.isFinite(row?.updatedAt)) {
    return "waiting for tagged capture";
  }
  return `captured at :${String(
    Math.floor((row.updatedAt % 60000) / 1000),
  ).padStart(2, "0")}`;
}

function isRepresentativeAmosRow(row) {
  return (
    row?.rwyNo === "2" && row?.rwyDir === "15L" && Number.isFinite(row?.tempC)
  );
}

function dedupeRowsByObservationTime(rows) {
  const byTime = new Map();
  for (const row of rows) {
    byTime.set(row.obsTimeUtc, row);
  }
  return [...byTime.values()].sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
}

function buildCadenceRows(amosRows, cadence) {
  const representativeRows = amosRows.filter(isRepresentativeAmosRow);
  const taggedRows = representativeRows.filter(
    (row) => row.collectionCadence === cadence,
  );
  if (cadence === "one_minute") {
    return dedupeRowsByObservationTime(taggedRows);
  }

  const firstTaggedTime = taggedRows.length
    ? Math.min(...taggedRows.map((row) => row.obsTimeUtc))
    : Number.POSITIVE_INFINITY;

  const legacyRows = representativeRows.filter(
    (row) => !row.collectionCadence && row.obsTimeUtc < firstTaggedTime,
  );

  return dedupeRowsByObservationTime([...legacyRows, ...taggedRows]);
}

function toChartPoints(rows, unit, extra = {}) {
  return rows
    .map((row) => {
      const x = parseMinute(row.obsTimeLocal);
      const y = unit === "C" ? row.tempC : row.tempF;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return {
        x,
        y,
        obsTimeUtc: row.obsTimeUtc,
        obsTimeLocal: row.obsTimeLocal,
        ...extra(row),
      };
    })
    .filter(Boolean);
}

function buildChartData(metarRows, fiveMinuteRows, oneMinuteRows, unit) {
  const oneMinutePoints = toChartPoints(oneMinuteRows, unit);
  const fiveMinutePoints = toChartPoints(fiveMinuteRows, unit);
  const metarPoints = toChartPoints(metarRows, unit, (row) => ({
    reportType: row.reportType,
    rawMetar: row.rawMetar,
  }));

  return {
    datasets: [
      {
        label: "AMOS · 1 minute",
        data: oneMinutePoints,
        borderColor: "#22d3ee",
        backgroundColor: "#22d3ee",
        borderWidth: 2.25,
        pointRadius: 0,
        pointHitRadius: 8,
        pointHoverRadius: 4,
        tension: 0.18,
        spanGaps: false,
        order: 3,
      },
      {
        label: "AMOS · 5 minute",
        data: fiveMinutePoints,
        borderColor: "#fbbf24",
        backgroundColor: "#fbbf24",
        borderWidth: 1.5,
        borderDash: [3, 5],
        pointStyle: "rectRot",
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.15,
        spanGaps: false,
        order: 2,
      },
      {
        label: "Actual METAR",
        data: metarPoints,
        borderColor: "#f8fafc",
        backgroundColor: "#07111f",
        borderWidth: 2.5,
        pointBorderColor: "#f8fafc",
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.08,
        spanGaps: false,
        order: 1,
      },
    ],
  };
}

function SourceCard({ accent, label, value, unit, detail, count }) {
  return (
    <div className="min-w-0 border-l border-white/10 px-4 first:border-l-0 first:pl-0 md:px-6">
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full shadow-[0_0_14px_currentColor]"
          style={{ color: accent, backgroundColor: accent }}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-1">
        <span className="text-2xl font-medium tracking-tight text-white md:text-3xl">
          {value}
        </span>
        <span className="pb-1 text-xs text-slate-500">{unit}</span>
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
        {detail} · {count} pts
      </p>
    </div>
  );
}

export default function SeoulDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [unit, setUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [refreshState, setRefreshState] = useState({
    active: false,
    message: "",
  });
  const refreshInFlight = useRef(false);

  const isDateValid = isValidDate(date);
  const today = seoulTodayKey();
  const isToday = isDateValid && date === today;
  const previousDate = shiftDateKey(date, -1);
  const nextDate = shiftDateKey(date, 1);

  const dayData = useQuery(
    "seoul:getDayStationRows",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const pollMetar = useAction("seoul:pollLatestNoaaStationMetar");
  const pollOneMinuteAmos = useAction("seoul:pollLatestAmosTemperatureSites");

  const metarRows = dayData?.rows ?? [];
  const amosRows = dayData?.amosRows ?? [];
  const oneMinuteRows = useMemo(
    () => buildCadenceRows(amosRows, "one_minute"),
    [amosRows],
  );
  const fiveMinuteRows = useMemo(
    () => buildCadenceRows(amosRows, "five_minute"),
    [amosRows],
  );

  const latestMetar = metarRows.at(-1) ?? null;
  const latestOneMinute = oneMinuteRows.at(-1) ?? null;
  const latestFiveMinute = fiveMinuteRows.at(-1) ?? null;
  const currentSeoulMinute = useMemo(() => {
    if (!isToday) {
      return null;
    }
    const parts = getDateParts(
      new Intl.DateTimeFormat("en-US", {
        timeZone: SEOUL_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
      new Date(clockNowMs),
    );
    return Number(parts.hour) * 60 + Number(parts.minute);
  }, [clockNowMs, isToday]);

  const chartData = useMemo(
    () => buildChartData(metarRows, fiveMinuteRows, oneMinuteRows, unit),
    [fiveMinuteRows, metarRows, oneMinuteRows, unit],
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      parsing: false,
      normalized: true,
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      layout: {
        padding: { top: 12, right: 8, bottom: 2, left: 2 },
      },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            color: "#cbd5e1",
            boxWidth: 24,
            boxHeight: 2,
            padding: 22,
            font: {
              family: "IBM Plex Mono, monospace",
              size: 11,
            },
          },
        },
        tooltip: {
          backgroundColor: "rgba(3, 10, 20, 0.96)",
          borderColor: "rgba(148, 163, 184, 0.25)",
          borderWidth: 1,
          padding: 12,
          titleColor: "#94a3b8",
          bodyColor: "#f8fafc",
          displayColors: true,
          callbacks: {
            title(items) {
              return items.length
                ? `${date} · ${minuteLabel(items[0].parsed.x)} KST`
                : "";
            },
            label(item) {
              const reportType = item.raw?.reportType
                ? ` · ${item.raw.reportType}`
                : "";
              return `${item.dataset.label}: ${item.parsed.y.toFixed(
                1,
              )}°${unit}${reportType}`;
            },
          },
        },
        seoulNowLine: {
          display: isToday,
          minute: currentSeoulMinute,
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 1439,
          border: { color: "rgba(148, 163, 184, 0.18)" },
          grid: {
            color: (context) =>
              Number(context.tick?.value) % 360 === 0
                ? "rgba(148, 163, 184, 0.16)"
                : "rgba(148, 163, 184, 0.06)",
          },
          ticks: {
            color: "#64748b",
            stepSize: 180,
            padding: 8,
            font: {
              family: "IBM Plex Mono, monospace",
              size: 10,
            },
            callback(value) {
              return minuteLabel(Number(value));
            },
          },
        },
        y: {
          grace: "12%",
          border: { color: "rgba(148, 163, 184, 0.18)" },
          grid: { color: "rgba(148, 163, 184, 0.09)" },
          ticks: {
            color: "#64748b",
            padding: 8,
            font: {
              family: "IBM Plex Mono, monospace",
              size: 10,
            },
            callback(value) {
              return `${Number(value).toFixed(0)}°`;
            },
          },
          title: {
            display: true,
            text: `TEMPERATURE · °${unit}`,
            color: "#64748b",
            font: {
              family: "IBM Plex Mono, monospace",
              size: 10,
              weight: "normal",
            },
          },
        },
      },
    }),
    [currentSeoulMinute, date, isToday, unit],
  );

  useEffect(() => {
    setInputDate(date);
  }, [date]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function refreshLiveSources({ quiet = false } = {}) {
    if (!isToday || refreshInFlight.current) {
      return;
    }

    refreshInFlight.current = true;
    if (!quiet) {
      setRefreshState({ active: true, message: "Syncing live sources…" });
    }

    const results = await Promise.allSettled([
      pollMetar({ stationIcao: STATION_ICAO }),
      pollOneMinuteAmos({ stationIcao: STATION_ICAO }),
    ]);
    const failures = results.filter((result) => result.status === "rejected");
    const message = failures.length
      ? `${2 - failures.length}/2 live sources refreshed`
      : "Live sources synchronized";

    if (failures.length) {
      for (const failure of failures) {
        console.error(failure.reason);
      }
    }
    setRefreshState({ active: false, message });
    refreshInFlight.current = false;
  }

  useEffect(() => {
    if (!isToday) {
      setRefreshState({
        active: false,
        message: isDateValid ? "Historical capture" : "",
      });
      return;
    }
    refreshLiveSources({ quiet: true });
    // Run once when the selected Seoul day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isDateValid, isToday]);

  function handleDateSubmit(event) {
    event.preventDefault();
    if (isValidDate(inputDate)) {
      router.push(`/seoul/day/${inputDate}`);
    }
  }

  if (!isDateValid) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#050b14] px-5 text-slate-100">
        <div className="max-w-md border border-rose-400/30 bg-rose-400/5 p-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-rose-300">
            Invalid date
          </p>
          <h1 className="mt-3 text-3xl font-medium">
            Seoul telemetry unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Use a YYYY-MM-DD date or return to the current RKSI observation day.
          </p>
          <Link
            href="/seoul/today"
            className="mt-6 inline-flex bg-cyan-300 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-slate-950"
          >
            Open today
          </Link>
        </div>
      </main>
    );
  }

  const hasChartData =
    metarRows.length + fiveMinuteRows.length + oneMinuteRows.length > 0;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050b14] text-slate-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.025) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      />
      <div className="pointer-events-none absolute left-1/2 top-[-28rem] h-[52rem] w-[72rem] -translate-x-1/2 rounded-full bg-cyan-400/8 blur-[140px]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1680px] flex-col px-4 py-5 md:px-8 md:py-7">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                RKSI · Incheon
              </span>
              <span className="h-3 w-px bg-white/15" />
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isToday
                      ? "animate-pulse bg-emerald-400 shadow-[0_0_12px_#34d399]"
                      : "bg-slate-600"
                  }`}
                />
                {isToday ? "Live telemetry" : "Archive"}
              </span>
            </div>
            <h1 className="mt-3 text-4xl font-medium tracking-[-0.045em] text-white md:text-6xl">
              Seoul temperature pulse
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Actual RKSI METAR against distinct five-minute and fastest
              one-minute AMOS captures, aligned on Seoul local time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/seoul/day/${previousDate}`}
              className="grid h-10 w-10 place-items-center border border-white/10 text-slate-400 transition hover:border-white/30 hover:text-white"
              aria-label="Previous day"
            >
              ←
            </Link>
            <form
              onSubmit={handleDateSubmit}
              className="flex h-10 border border-white/10 bg-white/[0.03]"
            >
              <input
                aria-label="Seoul observation date"
                type="date"
                value={inputDate}
                onChange={(event) => setInputDate(event.target.value)}
                className="min-w-0 bg-transparent px-3 font-mono text-xs text-slate-200 outline-none [color-scheme:dark]"
              />
              <button
                type="submit"
                className="border-l border-white/10 px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300 hover:bg-cyan-300/10"
              >
                Go
              </button>
            </form>
            <Link
              href={`/seoul/day/${nextDate}`}
              className="grid h-10 w-10 place-items-center border border-white/10 text-slate-400 transition hover:border-white/30 hover:text-white"
              aria-label="Next day"
            >
              →
            </Link>
            {!isToday && (
              <Link
                href="/seoul/today"
                className="h-10 border border-cyan-300/30 px-4 font-mono text-[10px] uppercase leading-10 tracking-[0.16em] text-cyan-300 hover:bg-cyan-300/10"
              >
                Today
              </Link>
            )}
            <div className="ml-1 flex h-10 border border-white/10">
              {["C", "F"].map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setUnit(candidate)}
                  className={`w-10 font-mono text-xs transition ${
                    unit === candidate
                      ? "bg-white text-slate-950"
                      : "text-slate-500 hover:text-white"
                  }`}
                >
                  °{candidate}
                </button>
              ))}
            </div>
            {isToday && (
              <button
                type="button"
                onClick={() => refreshLiveSources()}
                disabled={refreshState.active}
                className="h-10 bg-cyan-300 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
              >
                {refreshState.active ? "Syncing" : "Sync now"}
              </button>
            )}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-y-5 border-b border-white/10 py-5 md:grid-cols-4">
          <SourceCard
            accent="#f8fafc"
            label="Actual METAR"
            value={formatTemperature(latestMetar, unit)}
            unit={unit}
            detail={
              latestMetar
                ? `${latestMetar.reportType} · ${formatClock(
                    latestMetar.obsTimeUtc,
                  )}`
                : "awaiting report"
            }
            count={metarRows.length}
          />
          <SourceCard
            accent="#fbbf24"
            label="AMOS 5 minute"
            value={formatTemperature(latestFiveMinute, unit)}
            unit={unit}
            detail={
              latestFiveMinute
                ? `15L · ${formatClock(latestFiveMinute.obsTimeUtc)}`
                : "awaiting capture"
            }
            count={fiveMinuteRows.length}
          />
          <SourceCard
            accent="#22d3ee"
            label="AMOS 1 minute"
            value={formatTemperature(latestOneMinute, unit)}
            unit={unit}
            detail={
              latestOneMinute
                ? `15L · ${formatClock(latestOneMinute.obsTimeUtc)}`
                : "awaiting capture"
            }
            count={oneMinuteRows.length}
          />
          <div className="border-l border-white/10 px-4 md:px-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
              Seoul clock
            </p>
            <p className="mt-2 text-2xl font-medium tracking-tight text-white md:text-3xl">
              {formatClock(clockNowMs, true)}
            </p>
            <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
              {latestOneMinute
                ? captureOffset(latestOneMinute)
                : refreshState.message || "Asia/Seoul"}
            </p>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col pt-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
                00:00—23:59 KST
              </p>
              <h2 className="mt-1 text-lg font-medium text-slate-200">
                {date}
              </h2>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
              {dayData === undefined
                ? "Loading telemetry…"
                : refreshState.message ||
                  `${metarRows.length + fiveMinuteRows.length + oneMinuteRows.length} plotted observations`}
            </p>
          </div>

          <div className="relative min-h-[560px] flex-1 overflow-x-auto border border-white/10 bg-[#07111f]/85 shadow-[0_30px_100px_rgba(0,0,0,0.38)]">
            <div className="h-[68vh] min-h-[560px] min-w-[900px] p-3 md:h-[72vh] md:max-h-[900px] md:p-5">
              <Line data={chartData} options={chartOptions} />
            </div>
            {dayData !== undefined && !hasChartData && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-slate-400">
                    No captured telemetry
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    This Seoul local date has no stored RKSI observations.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <footer className="flex flex-col gap-2 py-4 font-mono text-[10px] leading-5 text-slate-600 md:flex-row md:items-center md:justify-between">
          <p>
            AMOS uses the feed row designated 15L. Cadence tags preserve the
            one-minute and five-minute capture paths separately.
          </p>
          <p>NOAA TGFTP METAR · KMA AMOS MOBILE FEED</p>
        </footer>
      </div>
    </main>
  );
}
