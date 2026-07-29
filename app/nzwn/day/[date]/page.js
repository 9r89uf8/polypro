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

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);

const STATION_ICAO = "NZWN";
const STATION_ID = "93439";
const AUCKLAND_TIMEZONE = "Pacific/Auckland";
const APPROVAL_FLAG = "METSERVICE_PUBLICDATA_ACCESS_APPROVED";
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const aucklandClockFormatter = new Intl.DateTimeFormat("en-NZ", {
  timeZone: AUCKLAND_TIMEZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

const aucklandTimeFormatter = new Intl.DateTimeFormat("en-NZ", {
  timeZone: AUCKLAND_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const aucklandDateTimeFormatter = new Intl.DateTimeFormat("en-NZ", {
  timeZone: AUCKLAND_TIMEZONE,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function getDateParts(formatter, date) {
  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function aucklandTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: AUCKLAND_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = getDateParts(formatter, new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function shiftDateKey(dateKey, deltaDays) {
  if (!isValidDate(dateKey)) {
    return null;
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + deltaDays * DAY_MS);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function formatDateTitle(dateKey) {
  if (!isValidDate(dateKey)) {
    return dateKey;
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-NZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function celsiusToFahrenheit(value) {
  return (value * 9) / 5 + 32;
}

function temperatureValue(reading, unit) {
  if (!reading || !Number.isFinite(reading.tempC)) {
    return null;
  }
  if (unit === "F") {
    return Number.isFinite(reading.tempF)
      ? reading.tempF
      : celsiusToFahrenheit(reading.tempC);
  }
  return reading.tempC;
}

function formatTemperature(reading, unit, digits = 1) {
  const value = temperatureValue(reading, unit);
  return Number.isFinite(value) ? `${value.toFixed(digits)}°` : "—";
}

function formatTemperatureValue(valueC, unit, digits = 1) {
  if (!Number.isFinite(valueC)) {
    return "—";
  }
  const value = unit === "F" ? celsiusToFahrenheit(valueC) : valueC;
  return `${value.toFixed(digits)}°`;
}

function formatDelta(deltaC, unit) {
  if (!Number.isFinite(deltaC)) {
    return "—";
  }
  const value = unit === "F" ? (deltaC * 9) / 5 : deltaC;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}°`;
}

function formatAucklandClock(epochMs) {
  return Number.isFinite(epochMs)
    ? aucklandClockFormatter.format(new Date(epochMs))
    : "—";
}

function formatAucklandTime(epochMs, withDate = false) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return (withDate ? aucklandDateTimeFormatter : aucklandTimeFormatter).format(
    new Date(epochMs),
  );
}

function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "unknown age";
  }
  if (ageMs < MINUTE_MS) {
    return `${Math.max(1, Math.round(ageMs / 1000))} sec ago`;
  }
  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m ago` : `${hours}h ago`;
}

function formatCollectorTime(epochMs) {
  return Number.isFinite(epochMs)
    ? aucklandDateTimeFormatter.format(new Date(epochMs))
    : "Never";
}

function findDeltaReading(rows, latest, targetMinutes) {
  if (!latest || rows.length < 2) {
    return null;
  }
  const target = latest.obsTimeUtc - targetMinutes * MINUTE_MS;
  let best = null;
  let bestDistance = Infinity;
  for (const row of rows) {
    if (row.obsTimeUtc >= latest.obsTimeUtc) {
      continue;
    }
    const distance = Math.abs(row.obsTimeUtc - target);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return bestDistance <= 15 * MINUTE_MS ? best : null;
}

function freshnessState({
  queryLoading,
  approved,
  isToday,
  latest,
  ageMs,
  collectorStatus,
}) {
  if (queryLoading) {
    return {
      key: "loading",
      label: "Connecting",
      detail: "Reading the Wellington collector",
      className: "border-white/15 bg-white/5 text-white/70",
      dotClassName: "bg-white/50",
    };
  }
  if (!approved) {
    return {
      key: "approval_required",
      label: "Approval required",
      detail: `${APPROVAL_FLAG} is not enabled`,
      className: "border-amber-300/30 bg-amber-300/10 text-amber-100",
      dotClassName: "bg-amber-300",
    };
  }
  if (!isToday) {
    return {
      key: "archive",
      label: "Archive",
      detail: "Stored observations for the selected Wellington date",
      className: "border-sky-300/25 bg-sky-300/10 text-sky-100",
      dotClassName: "bg-sky-300",
    };
  }
  if (collectorStatus === "outside_collection_window") {
    return {
      key: "outside_window",
      label: "Collector resting",
      detail: "Outside the configured Wellington collection window",
      className: "border-violet-300/25 bg-violet-300/10 text-violet-100",
      dotClassName: "bg-violet-300",
    };
  }
  if (!latest) {
    const isError = collectorStatus === "error";
    return {
      key: isError ? "error" : "no_data",
      label: isError ? "Collector error" : "Waiting for data",
      detail: "No stored 93439 observation is available yet",
      className: "border-rose-300/25 bg-rose-300/10 text-rose-100",
      dotClassName: "bg-rose-300",
    };
  }
  if (ageMs <= 5 * MINUTE_MS) {
    return {
      key: "current",
      label: "Near-live",
      detail: "Minute-fed MetService browser signal",
      className: "border-emerald-300/30 bg-emerald-300/10 text-emerald-50",
      dotClassName: "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.9)]",
    };
  }
  if (ageMs <= 12 * MINUTE_MS) {
    return {
      key: "delayed",
      label: "Delayed",
      detail: "Public delivery is behind the station clock",
      className: "border-amber-300/30 bg-amber-300/10 text-amber-100",
      dotClassName: "bg-amber-300",
    };
  }
  return {
    key: "stale",
    label: "Stale",
    detail: "The last accepted observation is no longer current",
    className: "border-rose-300/30 bg-rose-300/10 text-rose-100",
    dotClassName: "bg-rose-300",
  };
}

function emptyHeroCopy(statusKey) {
  if (statusKey === "approval_required") {
    return {
      display: "LOCKED",
      title: "Near-live temperature is ready, but not activated.",
      detail:
        "The collector fails closed until the Convex production approval flag is exactly true. No substitute temperature is shown in its place.",
    };
  }
  if (statusKey === "outside_window") {
    return {
      display: "RESTING",
      title: "The daytime collector is outside its operating window.",
      detail:
        "Collection resumes automatically at 09:00 Wellington time. The latest accepted reading will appear here when the window opens.",
    };
  }
  if (statusKey === "archive") {
    return {
      display: "NO DATA",
      title: "No stored station readings exist for this date.",
      detail:
        "Historical pages only contain observations captured while the collector was active.",
    };
  }
  if (statusKey === "error") {
    return {
      display: "OFFLINE",
      title: "The latest collection attempt did not complete.",
      detail:
        "The collector retained the last safe state. Review the source-control panel for the recorded error.",
    };
  }
  return {
    display: "WAITING",
    title: "Waiting for the first accepted 93439 observation.",
    detail:
      "The page will update automatically when Convex stores a timestamped station reading.",
  };
}

function StatusPill({ state }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${state.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${state.dotClassName}`} />
      {state.label}
    </span>
  );
}

function MetricCard({ eyebrow, value, detail, accent = "text-white" }) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-4 backdrop-blur">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">
        {eyebrow}
      </p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${accent}`}>
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-white/55">{detail}</p>
    </div>
  );
}

function ArrowIcon({ direction = "right" }) {
  const rotation =
    direction === "left" ? "rotate-180" : direction === "up" ? "-rotate-90" : "";
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 ${rotation}`}
    >
      <path
        d="M4 10h12m-4.5-4.5L16 10l-4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon({ spinning = false }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`}
    >
      <path
        d="M16.4 7A6.75 6.75 0 1 0 16 13.8M16.4 7V3.8M16.4 7h-3.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyChartState({ status }) {
  return (
    <div className="flex h-[300px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 px-6 text-center">
      <div>
        <div className="mx-auto h-10 w-10 rounded-full border border-white/10 bg-white/5" />
        <p className="mt-4 text-sm font-medium text-white/65">
          {status === "approval_required"
            ? "Live collection is locked until provider approval is recorded."
            : "Temperature observations will appear here as they are collected."}
        </p>
      </div>
    </div>
  );
}

export default function NzwnDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [unit, setUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [clockNowMs, setClockNowMs] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const bootstrapDateRef = useRef("");

  const validDate = isValidDate(date);
  const today = aucklandTodayKey();
  const isToday = validDate && date === today;
  const previousDate = shiftDateKey(date, -1);
  const nextDate = shiftDateKey(date, 1);

  const liveData = useQuery(
    "nzwnWeather:getLiveTemperature",
    validDate ? { date } : "skip",
  );
  const officialData = useQuery(
    "preflight:getDayStationRows",
    validDate ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const pollLiveTemperature = useAction(
    "nzwnWeather:pollMetServiceCurrentConditions",
  );
  const backfillOfficialDay = useAction("preflight:backfillDayStationMessages");
  const pollOfficialLatest = useAction("preflight:pollLatestStationMetar");

  const approval = liveData?.approval ?? null;
  const approved = approval?.approved === true;
  const collector = liveData?.collector ?? null;
  const collectionWindow = liveData?.collectionWindow ?? null;

  const liveRows = useMemo(
    () =>
      [...(liveData?.observations ?? [])].sort(
        (left, right) => left.obsTimeUtc - right.obsTimeUtc,
      ),
    [liveData?.observations],
  );
  const officialRows = useMemo(
    () =>
      [...(officialData?.rows ?? [])].sort(
        (left, right) => left.obsTimeUtc - right.obsTimeUtc,
      ),
    [officialData?.rows],
  );

  const newestStoredReading =
    liveRows.at(-1) ?? liveData?.latestForDate ?? null;
  const latest =
    liveData?.latestForDate &&
    (!newestStoredReading ||
      liveData.latestForDate.obsTimeUtc > newestStoredReading.obsTimeUtc)
      ? liveData.latestForDate
      : newestStoredReading;
  const canExposeStationReadings = !isToday || approved;
  const displayRows = canExposeStationReadings ? liveRows : [];
  const displayReading = canExposeStationReadings ? latest : null;
  const latestOfficial = officialRows.at(-1) ?? null;
  const ageMs =
    isToday && latest && Number.isFinite(clockNowMs)
      ? Math.max(0, clockNowMs - latest.obsTimeUtc)
      : null;
  const status = freshnessState({
    queryLoading: liveData === undefined,
    approved,
    isToday,
    latest,
    ageMs,
    collectorStatus: collector?.status,
  });

  const dayHighC = canExposeStationReadings
    ? liveData?.summary?.maxTempC
    : null;
  const dayLowC = canExposeStationReadings
    ? liveData?.summary?.minTempC
    : null;
  const deltaReference = findDeltaReading(displayRows, displayReading, 30);
  const delta30C =
    displayReading && deltaReference
      ? Number((displayReading.tempC - deltaReference.tempC).toFixed(1))
      : null;
  const metarDeltaC =
    displayReading && latestOfficial
      ? Number((displayReading.tempC - latestOfficial.tempC).toFixed(1))
      : null;

  useEffect(() => {
    setInputDate(date);
  }, [date]);

  useEffect(() => {
    setClockNowMs(Date.now());
    const intervalId = window.setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!validDate || bootstrapDateRef.current === date) {
      return;
    }
    bootstrapDateRef.current = date;
    let cancelled = false;

    async function syncOfficialReference() {
      const results = await Promise.allSettled([
        backfillOfficialDay({ stationIcao: STATION_ICAO, date }),
        isToday ? pollOfficialLatest({ stationIcao: STATION_ICAO }) : null,
      ]);
      if (cancelled) {
        return;
      }
      const failures = results.filter((result) => result.status === "rejected");
      setSyncMessage(
        failures.length
          ? "Official METAR reference could not be refreshed."
          : "Official METAR reference is synchronized.",
      );
    }

    syncOfficialReference();
    return () => {
      cancelled = true;
    };
  }, [
    backfillOfficialDay,
    date,
    isToday,
    pollOfficialLatest,
    validDate,
  ]);

  async function handleRefresh() {
    if (!isToday || isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    setSyncMessage("");
    const results = await Promise.allSettled([
      pollLiveTemperature({ stationIcao: STATION_ICAO }),
      pollOfficialLatest({ stationIcao: STATION_ICAO }),
    ]);
    const liveResult = results[0];
    const officialResult = results[1];
    const messages = [];

    if (liveResult.status === "fulfilled") {
      if (liveResult.value?.status === "ok") {
        if (liveResult.value?.ingestResult === "inserted") {
          messages.push("New 93439 observation accepted.");
        } else if (liveResult.value?.ingestResult === "stale_rejected") {
          messages.push("Older cached observation rejected; current value retained.");
        } else {
          messages.push("Checked 93439; no newer observation yet.");
        }
      } else if (liveResult.value?.status === "approval_required") {
        messages.push(`Live collection requires ${APPROVAL_FLAG}.`);
      } else if (liveResult.value?.status === "outside_collection_window") {
        messages.push("Live collector is outside its Wellington time window.");
      } else {
        messages.push(liveResult.value?.message || "Live temperature was not updated.");
      }
    } else {
      messages.push("Live temperature refresh failed.");
    }

    messages.push(
      officialResult.status === "fulfilled"
        ? "METAR reference refreshed."
        : "METAR reference refresh failed.",
    );
    setSyncMessage(messages.join(" "));
    setIsRefreshing(false);
  }

  function handleDateSubmit(event) {
    event.preventDefault();
    if (isValidDate(inputDate)) {
      router.push(`/nzwn/day/${inputDate}`);
    }
  }

  const chartData = useMemo(() => {
    const livePoints = displayRows.map((row) => ({
      x: row.obsTimeUtc,
      y: temperatureValue(row, unit),
      row,
    }));
    const officialPoints = officialRows.map((row) => ({
      x: row.obsTimeUtc,
      y: unit === "F" ? row.tempF : row.tempC,
      row,
    }));
    return {
      datasets: [
        {
          label: "MetService 93439",
          data: livePoints,
          borderColor: "#5eead4",
          backgroundColor: "#5eead4",
          borderWidth: 2.5,
          pointRadius: livePoints.length > 80 ? 0 : 2,
          pointHoverRadius: 5,
          tension: 0.22,
        },
        {
          label: "Official METAR",
          data: officialPoints,
          borderColor: "#fbbf24",
          backgroundColor: "#fbbf24",
          borderWidth: 0,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointStyle: "rectRot",
          showLine: false,
        },
      ],
    };
  }, [displayRows, officialRows, unit]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: { duration: 250 },
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            color: "rgba(255,255,255,0.62)",
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            font: { family: "IBM Plex Mono", size: 10 },
          },
        },
        tooltip: {
          backgroundColor: "#0b1f1c",
          borderColor: "rgba(94,234,212,0.28)",
          borderWidth: 1,
          titleColor: "#ccfbf1",
          bodyColor: "#f0fdfa",
          callbacks: {
            title(items) {
              return items.length
                ? formatAucklandTime(Number(items[0].parsed.x), true)
                : "";
            },
            label(context) {
              return `${context.dataset.label}: ${Number(context.parsed.y).toFixed(
                1,
              )}°${unit}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          grid: { color: "rgba(255,255,255,0.055)" },
          border: { display: false },
          ticks: {
            color: "rgba(255,255,255,0.42)",
            maxTicksLimit: 7,
            callback(value) {
              return formatAucklandTime(Number(value));
            },
            font: { family: "IBM Plex Mono", size: 10 },
          },
        },
        y: {
          grid: { color: "rgba(255,255,255,0.07)" },
          border: { display: false },
          ticks: {
            color: "rgba(255,255,255,0.42)",
            callback(value) {
              return `${Number(value).toFixed(0)}°`;
            },
            font: { family: "IBM Plex Mono", size: 10 },
          },
        },
      },
    }),
    [unit],
  );

  const recentRows = useMemo(
    () => displayRows.slice(-8).reverse(),
    [displayRows],
  );
  const refreshDisabled =
    !isToday ||
    isRefreshing ||
    !approved ||
    collectionWindow?.activeNow === false;
  const refreshLabel = !isToday
    ? "Viewing archive"
    : !approved
      ? "Approval required"
      : collectionWindow?.activeNow === false
        ? "Outside collection window"
        : isRefreshing
          ? "Refreshing"
          : "Refresh now";
  const emptyHero = emptyHeroCopy(status.key);

  if (!validDate) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#06100f] px-5 text-white">
        <section className="w-full max-w-lg rounded-[2rem] border border-rose-300/20 bg-white/5 p-7">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-rose-200">
            Invalid route
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Use a Wellington date</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">
            NZWN day routes require a date formatted as YYYY-MM-DD.
          </p>
          <Link
            href="/nzwn/today"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-teal-300 px-5 py-2.5 text-sm font-semibold text-[#05201c]"
          >
            Open today <ArrowIcon />
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#06100f] px-4 py-4 text-[#e9fbf5] sm:px-6 sm:py-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgba(20,184,166,0.16),transparent_32%),radial-gradient(circle_at_90%_12%,rgba(56,189,248,0.10),transparent_30%),linear-gradient(180deg,#06100f_0%,#071715_48%,#06100f_100%)]" />
      <div className="pointer-events-none absolute left-[-12rem] top-[26rem] h-96 w-96 rounded-full bg-teal-400/5 blur-3xl" />

      <div className="relative mx-auto max-w-[1440px]">
        <nav className="flex flex-wrap items-center justify-between gap-4 rounded-[1.6rem] border border-white/10 bg-black/15 px-4 py-3 backdrop-blur-xl sm:px-5">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/65 transition hover:border-teal-300/40 hover:text-teal-100"
              aria-label="Home"
            >
              <ArrowIcon direction="left" />
            </Link>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-teal-200/55">
                Wellington · New Zealand
              </p>
              <h1 className="text-sm font-semibold text-white/90">
                NZWN Surface Monitor
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] text-white/55 md:inline-flex">
              {formatAucklandClock(clockNowMs)}
            </span>
            <div
              className="inline-flex rounded-full border border-white/10 bg-white/5 p-1"
              role="group"
              aria-label="Temperature unit"
            >
              {["C", "F"].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setUnit(option)}
                  aria-pressed={unit === option}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    unit === option
                      ? "bg-teal-300 text-[#06231f]"
                      : "text-white/50 hover:text-white"
                  }`}
                >
                  °{option}
                </button>
              ))}
            </div>
          </div>
        </nav>

        <section className="mt-4 overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a1b18]/90 shadow-[0_30px_100px_rgba(0,0,0,0.32)]">
          <div className="grid xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.65fr)]">
            <div className="relative min-h-[480px] overflow-hidden border-b border-white/10 p-6 sm:p-8 xl:border-b-0 xl:border-r">
              <div className="pointer-events-none absolute -right-24 -top-28 h-[30rem] w-[30rem] rounded-full border border-teal-300/10" />
              <div className="pointer-events-none absolute -right-12 -top-16 h-[22rem] w-[22rem] rounded-full border border-teal-300/10" />
              <div className="pointer-events-none absolute bottom-0 left-0 h-40 w-full bg-[linear-gradient(180deg,transparent,rgba(94,234,212,0.035))]" />

              <div className="relative flex h-full flex-col justify-between">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <StatusPill state={status} />
                    <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-white/55">
                      Wellington Aero AWS · Station {STATION_ID}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                      Selected day
                    </p>
                    <p className="mt-1 text-sm font-medium text-white/70">
                      {formatDateTitle(date)}
                    </p>
                  </div>
                </div>

                <div className="relative py-10 sm:py-12">
                  {displayReading ? (
                    <>
                      <div className="flex items-start">
                        <span className="text-[clamp(5.4rem,15vw,11.5rem)] font-semibold leading-[0.78] tracking-[-0.09em] text-white">
                          {formatTemperature(displayReading, unit)}
                        </span>
                        <span className="ml-3 mt-1 font-mono text-sm font-medium text-teal-200/70 sm:mt-4">
                          {unit}
                        </span>
                      </div>
                      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                        <span className="font-mono text-white/58">
                          OBS {formatAucklandTime(displayReading.obsTimeUtc, true)}
                        </span>
                        {isToday ? (
                          <span className="text-white/55">{formatAge(ageMs)}</span>
                        ) : null}
                        <span
                          className={`font-semibold ${
                            Number.isFinite(delta30C)
                              ? delta30C > 0
                                ? "text-amber-200"
                                : delta30C < 0
                                  ? "text-sky-200"
                                  : "text-white/60"
                              : "text-white/55"
                          }`}
                        >
                          {Number.isFinite(delta30C)
                            ? `${formatDelta(delta30C, unit)} / 30 min`
                            : "30 min trend pending"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="max-w-2xl py-6">
                      <p className="font-mono text-[clamp(3.8rem,11vw,8.5rem)] font-semibold leading-none tracking-[-0.06em] text-white/18">
                        {emptyHero.display}
                      </p>
                      <h2 className="mt-7 text-2xl font-semibold text-white sm:text-3xl">
                        {emptyHero.title}
                      </h2>
                      <p className="mt-3 max-w-xl text-sm leading-6 text-white/50">
                        {emptyHero.detail}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="max-w-2xl text-xs leading-5 text-white/55">
                    Minute-resolution source signal delivered through MetService&apos;s
                    public station page. Public caching can delay or regress a
                    response; the collector only accepts newer timestamps.
                  </p>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshDisabled}
                    className="inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/10 px-4 py-2.5 text-xs font-semibold text-teal-50 transition hover:border-teal-200/45 hover:bg-teal-200/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30"
                  >
                    <RefreshIcon spinning={isRefreshing} />
                    {refreshLabel}
                  </button>
                </div>
              </div>
            </div>

            <aside className="flex flex-col justify-between bg-black/10 p-6 sm:p-8">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-teal-100/45">
                  Signal summary
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <MetricCard
                    eyebrow="High so far"
                    value={formatTemperatureValue(dayHighC, unit)}
                    detail={
                      canExposeStationReadings
                        ? liveData?.summary?.maxTempAtLocal || "No accepted high"
                        : "Approval required"
                    }
                    accent="text-amber-100"
                  />
                  <MetricCard
                    eyebrow="Low so far"
                    value={formatTemperatureValue(dayLowC, unit)}
                    detail={
                      canExposeStationReadings
                        ? liveData?.summary?.minTempAtLocal || "No accepted low"
                        : "Approval required"
                    }
                    accent="text-sky-100"
                  />
                  <MetricCard
                    eyebrow="Humidity"
                    value={
                      Number.isFinite(displayReading?.relativeHumidity)
                        ? `${displayReading.relativeHumidity}%`
                        : "—"
                    }
                    detail="Station relative humidity"
                  />
                  <MetricCard
                    eyebrow="Pressure"
                    value={
                      Number.isFinite(displayReading?.pressureHpa)
                        ? `${displayReading.pressureHpa.toFixed(0)}`
                        : "—"
                    }
                    detail="hPa at sea level"
                  />
                </div>
              </div>

              <div className="mt-7 border-t border-white/10 pt-6">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                      Official METAR check
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-amber-100">
                      {latestOfficial
                        ? `${unit === "F" ? latestOfficial.tempF.toFixed(1) : latestOfficial.tempC.toFixed(1)}°`
                        : "—"}
                      <span className="ml-1 text-sm text-amber-100/45">{unit}</span>
                    </p>
                  </div>
                  <p className="pb-1 text-right font-mono text-[10px] leading-5 text-white/50">
                    {latestOfficial
                      ? formatAucklandTime(latestOfficial.obsTimeUtc, true)
                      : "No report"}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-amber-200/10 bg-amber-200/[0.045] px-4 py-3">
                  <span className="text-xs text-white/55">Fast feed vs METAR</span>
                  <span className="font-mono text-xs font-semibold text-amber-100/80">
                    {formatDelta(metarDeltaC, unit)}
                  </span>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.45fr)]">
          <article className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-5 backdrop-blur sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-teal-100/45">
                  Temperature trajectory
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Fast station signal vs routine METAR
                </h2>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
                      {displayRows.length} accepted readings · {officialRows.length} METAR
              </p>
            </div>
            <div
              className="mt-6 h-[320px] sm:h-[370px]"
              role="img"
              aria-label={`Temperature trajectory for NZWN on ${date}: ${displayRows.length} station readings and ${officialRows.length} official METAR observations.`}
            >
              {displayRows.length || officialRows.length ? (
                <Line data={chartData} options={chartOptions} />
              ) : (
                <EmptyChartState status={status.key} />
              )}
            </div>
          </article>

          <aside className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-5 backdrop-blur sm:p-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-teal-100/45">
              Wind at station
            </p>
            <div className="mt-7 flex items-center gap-5">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-teal-200/20 bg-teal-200/[0.06]">
                <span className="text-2xl font-semibold text-teal-100">
                  {displayReading?.windDirection || "—"}
                </span>
              </div>
              <div>
                <p className="text-4xl font-semibold tracking-tight text-white">
                  {Number.isFinite(displayReading?.windSpeedKph)
                    ? displayReading.windSpeedKph.toFixed(0)
                    : "—"}
                  <span className="ml-2 text-sm font-medium text-white/50">km/h</span>
                </p>
                <p className="mt-2 text-sm text-white/55">
                  Gust{" "}
                  {Number.isFinite(displayReading?.windGustKph)
                    ? `${displayReading.windGustKph.toFixed(0)} km/h`
                    : "not reported"}
                </p>
              </div>
            </div>

            <div className="mt-8 space-y-4 border-t border-white/10 pt-6 text-xs">
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/55">Collection window</span>
                <span className="font-mono text-white/65">
                  {collectionWindow
                    ? `${collectionWindow.startLocal}–${collectionWindow.endLocal}`
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/55">Last accepted</span>
                <span className="text-right font-mono text-white/65">
                  {formatCollectorTime(
                    isToday
                      ? collector?.latestObsTimeUtc ?? displayReading?.obsTimeUtc
                      : displayReading?.obsTimeUtc,
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-white/55">Collector state</span>
                <span className="font-mono text-white/65">
                  {collector?.status?.replaceAll("_", " ") || "loading"}
                </span>
              </div>
            </div>
          </aside>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.42fr)]">
          <article className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-5 backdrop-blur sm:p-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-teal-100/45">
                  Accepted observations
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Most recent station readings
                </h2>
              </div>
              <span className="hidden text-xs text-white/50 sm:block">
                Newest first
              </span>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
              {recentRows.length ? (
                <div className="divide-y divide-white/8">
                  {recentRows.map((row, index) => {
                    const nextOlder = recentRows[index + 1];
                    const rowDeltaC = nextOlder
                      ? Number((row.tempC - nextOlder.tempC).toFixed(1))
                      : null;
                    return (
                      <div
                        key={`${row.obsTimeUtc}-${row.source}`}
                        className="grid grid-cols-[1fr_auto] items-center gap-4 bg-black/10 px-4 py-3.5 sm:grid-cols-[1fr_0.55fr_0.6fr_0.65fr]"
                      >
                        <div>
                          <p className="font-mono text-xs font-medium text-white/75">
                            {formatAucklandTime(row.obsTimeUtc, true)}
                          </p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/55">
                            {row.source}
                          </p>
                        </div>
                        <p className="text-right text-lg font-semibold text-teal-100">
                          {formatTemperature(row, unit)}
                          <span className="ml-1 text-xs text-teal-100/40">{unit}</span>
                        </p>
                        <p className="hidden text-right font-mono text-xs text-white/55 sm:block">
                          {formatDelta(rowDeltaC, unit)}
                        </p>
                        <p className="hidden text-right text-xs text-white/55 sm:block">
                          {Number.isFinite(row.windSpeedKph)
                            ? `${row.windSpeedKph.toFixed(0)} km/h ${row.windDirection || ""}`
                            : "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 py-12 text-center text-sm text-white/55">
                  No accepted station readings for {date}.
                </div>
              )}
            </div>
          </article>

          <aside className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-5 backdrop-blur sm:p-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-teal-100/45">
              Source control
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Transparent by default
            </h2>

            <div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs text-white/55">Production approval</span>
                <span
                  className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] ${
                    approved
                      ? "bg-emerald-300/12 text-emerald-100"
                      : "bg-amber-300/12 text-amber-100"
                  }`}
                >
                  {approved ? "enabled" : "required"}
                </span>
              </div>
              <code className="mt-4 block break-all rounded-xl bg-black/20 px-3 py-2.5 font-mono text-[11px] text-white/60">
                {approval?.flagName || APPROVAL_FLAG}
              </code>
            </div>

            <dl className="mt-6 space-y-4 text-xs">
              <div>
                <dt className="text-white/55">Station</dt>
                <dd className="mt-1 font-mono text-white/65">
                  NZWN · Wellington Aero AWS · {STATION_ID}
                </dd>
              </div>
              <div>
                <dt className="text-white/55">Delivery</dt>
                <dd className="mt-1 leading-5 text-white/60">
                  Timestamped MetService public station-page JSON, filtered so an
                  older cache response cannot replace a newer observation.
                </dd>
              </div>
              <div>
                <dt className="text-white/55">Last attempt</dt>
                <dd className="mt-1 font-mono text-white/60">
                  {formatCollectorTime(collector?.lastAttemptAt)}
                </dd>
              </div>
              {collector?.status === "error" && collector?.lastError ? (
                <div>
                  <dt className="text-rose-200/55">Last collector error</dt>
                  <dd className="mt-1 break-words text-rose-100/70">
                    {collector.lastError}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="mt-7 flex flex-wrap gap-2">
              <a
                href="https://www.metservice.com/weather-station-location/93439/wellington-international-airport-weather-station"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:border-teal-200/30 hover:text-teal-100"
              >
                Open source page <ArrowIcon />
              </a>
              <Link
                href="/nzwn/forecast-accuracy"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-xs font-semibold text-white/60 transition hover:border-teal-200/30 hover:text-teal-100"
              >
                Forecast archive <ArrowIcon />
              </Link>
            </div>
          </aside>
        </section>

        <footer className="mt-4 flex flex-col gap-4 rounded-[1.6rem] border border-white/10 bg-black/10 px-5 py-4 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <form onSubmit={handleDateSubmit} className="flex flex-wrap items-center gap-2">
            <Link
              href={`/nzwn/day/${previousDate}`}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-2 font-semibold text-white/55 transition hover:text-white"
            >
              <ArrowIcon direction="left" /> Previous
            </Link>
            <input
              type="date"
              value={inputDate}
              max={today}
              onChange={(event) => setInputDate(event.target.value)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] text-white/65 outline-none [color-scheme:dark] focus:border-teal-200/35"
              aria-label="Select Wellington date"
            />
            <button
              type="submit"
              className="rounded-full border border-white/10 px-3 py-2 font-semibold text-white/55 transition hover:text-white"
            >
              Go
            </button>
            {date < today && nextDate ? (
              <Link
                href={`/nzwn/day/${nextDate}`}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-2 font-semibold text-white/55 transition hover:text-white"
              >
                Next <ArrowIcon />
              </Link>
            ) : (
              <Link
                href="/nzwn/today"
                className="inline-flex items-center gap-1 rounded-full border border-teal-200/20 bg-teal-200/[0.07] px-3 py-2 font-semibold text-teal-100/75"
              >
                Today <ArrowIcon />
              </Link>
            )}
          </form>
          <p aria-live="polite">{syncMessage || status.detail}</p>
        </footer>
      </div>
    </main>
  );
}
