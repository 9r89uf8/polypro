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

const STATION_ICAO = "NZWN";
const STATION_NAME = "Wellington International";
const AUCKLAND_TIMEZONE = "Pacific/Auckland";
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

function formatAucklandDateTimeSeconds(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: AUCKLAND_TIMEZONE,
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
  if (winner === "preflight") {
    return "PreFlight";
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

function formatBackfillMessage(result) {
  if (!result?.ok) {
    return "Rolling sync skipped.";
  }
  return `Rolling sync: saved ${result.insertedCount} new rows from ${result.rowCount} NZWN messages for this date. PreFlight currently exposed ${result.exposedMessageCount} recent messages.`;
}

function formatLivePollMessage(result) {
  if (!result?.ok) {
    return "Latest official poll skipped.";
  }

  const firstSeenText = Number.isFinite(result.row?.preflightFirstSeenAt)
    ? formatAucklandDateTimeSeconds(result.row.preflightFirstSeenAt)
    : null;
  const lagText = Number.isFinite(result.availabilityLagMs)
    ? `${Math.max(0, result.availabilityLagMs / 60000).toFixed(1)} min lag`
    : null;

  return `Latest official poll: ${result.insertedCount > 0 ? "saved" : "no new report"} ${result.row?.reportType ?? "message"} ${result.row?.obsTimeLocal ?? ""}.${firstSeenText ? ` First seen ${firstSeenText}${lagText ? ` (${lagText})` : ""}.` : ""}`;
}

function formatNearLiveCurrentMessage(result) {
  if (!result?.ok) {
    return "Near-live Weather.com airport current unavailable.";
  }
  const observedText = result.observedAtLocal
    ? formatStoredLocalDateTime(result.observedAtLocal)
    : "—";
  return `Near-live Weather.com airport current: ${result.tempC?.toFixed(1) ?? "—"}°C at ${observedText}.`;
}

function buildLineDataset(rows, unit) {
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
    label: "Official PreFlight",
    data: points,
    borderColor: "#0f4c81",
    backgroundColor: "#0f4c81",
    pointRadius: points.map((point) => (point.reportType === "SPECI" ? 4.5 : 2.5)),
    pointHoverRadius: points.map((point) => (point.reportType === "SPECI" ? 6 : 4)),
    pointHitRadius: 18,
    pointBackgroundColor: points.map((point) =>
      point.reportType === "SPECI" ? "#b91c1c" : "#0f4c81",
    ),
    pointBorderColor: points.map((point) =>
      point.reportType === "SPECI" ? "#7f1d1d" : "#0b365d",
    ),
    pointBorderWidth: 1.5,
    borderWidth: 2,
    tension: 0.22,
    showLine: true,
  };
}

export default function NzwnDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [displayUnit, setDisplayUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [liveMessage, setLiveMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nearLiveCurrent, setNearLiveCurrent] = useState(null);
  const [nearLiveError, setNearLiveError] = useState("");
  const inFlightRef = useRef(false);
  const backfilledDateRef = useRef("");

  const isDateValid = isValidDate(date);
  const aucklandTodayDate = aucklandTodayKey();
  const isToday = isDateValid && date === aucklandTodayDate;
  const quickPreviousDates = useMemo(() => buildPreviousDateKeys(date, 2), [date]);

  const backfillDay = useAction("preflight:backfillDayStationMessages");
  const pollLatest = useAction("preflight:pollLatestStationMetar");
  const fetchNearLiveCurrent = useAction(
    "preflight:fetchLatestWeatherComAirportCurrent",
  );

  const dayData = useQuery(
    "preflight:getDayStationRows",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const raceData = useQuery("preflight:getRecentPublishRaceReports", {
    stationIcao: STATION_ICAO,
    limit: 12,
  });

  const rows = dayData?.rows ?? [];
  const summary = dayData?.summary ?? null;
  const raceRows = raceData?.rows ?? [];
  const latestTemp = displayUnit === "C" ? summary?.latestTempC : summary?.latestTempF;
  const maxTemp = displayUnit === "C" ? summary?.maxTempC : summary?.maxTempF;
  const minTemp = displayUnit === "C" ? summary?.minTempC : summary?.minTempF;

  useEffect(() => {
    setInputDate(date);
  }, [date]);

  useEffect(() => {
    if (!isDateValid) {
      setLiveMessage("");
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        const messages = [];

        if (backfilledDateRef.current !== date) {
          const backfillResult = await backfillDay({
            stationIcao: STATION_ICAO,
            date,
          });
          messages.push(formatBackfillMessage(backfillResult));
          backfilledDateRef.current = date;
        }

        if (isToday) {
          const pollResult = await pollLatest({ stationIcao: STATION_ICAO });
          messages.push(formatLivePollMessage(pollResult));
        }

        try {
          const unofficialResult = await fetchNearLiveCurrent({
            stationIcao: STATION_ICAO,
          });
          messages.push(formatNearLiveCurrentMessage(unofficialResult));
          if (!cancelled) {
            setNearLiveCurrent(unofficialResult);
            setNearLiveError("");
          }
        } catch (error) {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : String(error);
            setNearLiveError(message);
          }
        }

        if (!cancelled) {
          setLiveMessage(messages.join(" "));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setLiveMessage(`NZWN sync failed: ${message}`);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [date, isDateValid, isToday, backfillDay, pollLatest, fetchNearLiveCurrent]);

  async function handleRefreshNow() {
    if (!isDateValid || inFlightRef.current) {
      return;
    }

    setIsRefreshing(true);
    inFlightRef.current = true;
    try {
      const messages = [];
      const backfillResult = await backfillDay({
        stationIcao: STATION_ICAO,
        date,
      });
      backfilledDateRef.current = date;
      messages.push(formatBackfillMessage(backfillResult));

      if (isToday) {
        const pollResult = await pollLatest({ stationIcao: STATION_ICAO });
        messages.push(formatLivePollMessage(pollResult));
      }

      try {
        const unofficialResult = await fetchNearLiveCurrent({
          stationIcao: STATION_ICAO,
        });
        messages.push(formatNearLiveCurrentMessage(unofficialResult));
        setNearLiveCurrent(unofficialResult);
        setNearLiveError("");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setNearLiveError(message);
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
    router.push(`/nzwn/day/${inputDate}`);
  }

  const chartData = useMemo(
    () => ({
      datasets: rows.length ? [buildLineDataset(rows, displayUnit)] : [],
    }),
    [rows, displayUnit],
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
          title: { display: true, text: "Local Time (Pacific/Auckland)" },
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

  if (!isDateValid) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-6">
          <h1 className="text-2xl font-semibold text-red-800">Invalid NZWN date</h1>
          <p className="mt-2 text-sm text-red-700">
            Use a `YYYY-MM-DD` date in the route.
          </p>
          <div className="mt-4">
            <Link
              href="/nzwn/today"
              className="inline-flex rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-800"
            >
              Open NZWN today
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
            Official NZWN METAR from MetService&apos;s PreFlight product. Today is
            kept live from the official rolling endpoint; selected dates can only
            be backfilled from the recent messages that endpoint still exposes, so
            older dates depend on rows we already captured live.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <Link
              href="/nzwn/today"
              className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:border-sky-400"
            >
              Current Date {aucklandTodayDate}
            </Link>
            {quickPreviousDates.map((previousDate) => (
              <Link
                key={previousDate}
                href={`/nzwn/day/${previousDate}`}
                className="inline-flex rounded-full border border-black/15 bg-white/70 px-4 py-2 text-sm font-semibold text-black hover:border-black"
              >
                {previousDate}
              </Link>
            ))}
          </div>

          <form onSubmit={handleGoToDate} className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-black/70" htmlFor="nzwn-day-picker">
              Pick Date
            </label>
            <input
              id="nzwn-day-picker"
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
              disabled={isRefreshing}
              className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing..." : "Refresh from PreFlight"}
            </button>
            {isToday ? (
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-emerald-800">
                Live official ingest enabled
              </span>
            ) : null}
          </div>

          <p className="mt-4 text-sm text-black/70">
            {liveMessage || "Waiting for PreFlight sync..."}
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
              Routine NZWN METAR is typically every 30 minutes. Full-day coverage
              depends on rows being captured live because PreFlight only exposes a
              rolling recent window.
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Near-Live Now
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {nearLiveCurrent
                ? formatTemp(
                    displayUnit === "C" ? nearLiveCurrent.tempC : nearLiveCurrent.tempF,
                    displayUnit,
                  )
                : "—"}
            </p>
            <p className="mt-2 text-sm text-black/65">
              {nearLiveCurrent?.observedAtLocal
                ? `Weather.com airport current at ${formatStoredLocalDateTime(
                    nearLiveCurrent.observedAtLocal,
                  )}`
                : "Unofficial airport-current feed not loaded yet."}
            </p>
            <p className="mt-2 text-xs text-black/55">
              Unofficial. Independent of the selected historical date.
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
                Blue markers are routine METAR. Red markers are SPECI.
              </p>
            </div>
          </div>

          <div className="mt-6 h-[420px]">
            {rows.length ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-sm text-black/55">
                No NZWN observations stored for this date yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <h2 className="text-xl font-semibold text-foreground">Latest Raw METAR</h2>
          <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 font-mono text-sm text-black/80">
            {summary?.latestRawMetar ?? "No latest raw METAR stored yet."}
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <h2 className="text-xl font-semibold text-foreground">
            Near-Live Airport Current
          </h2>
          <p className="mt-1 text-sm text-black/60">
            Unofficial Weather.com/Wunderground airport-current observation for
            NZWN. This can be newer than the latest official METAR.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                Current Reading
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {nearLiveCurrent
                  ? formatTemp(
                      displayUnit === "C" ? nearLiveCurrent.tempC : nearLiveCurrent.tempF,
                      displayUnit,
                    )
                  : "—"}
              </p>
              <p className="mt-2 text-sm text-black/65">
                {nearLiveCurrent?.observedAtLocal
                  ? `Observed ${formatStoredLocalDateTime(
                      nearLiveCurrent.observedAtLocal,
                    )}`
                  : "No near-live current reading loaded yet."}
              </p>
              <p className="mt-2 text-sm text-black/65">
                {nearLiveCurrent?.phrase ?? "—"}
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                Extra Fields
              </p>
              <div className="mt-3 space-y-2 text-sm text-black/70">
                <p>
                  Humidity:{" "}
                  {Number.isFinite(nearLiveCurrent?.relativeHumidity)
                    ? `${nearLiveCurrent.relativeHumidity}%`
                    : "—"}
                </p>
                <p>
                  Wind:{" "}
                  {Number.isFinite(nearLiveCurrent?.windSpeedKph)
                    ? `${nearLiveCurrent.windSpeedKph} km/h`
                    : "—"}
                </p>
                <p>
                  Gust:{" "}
                  {Number.isFinite(nearLiveCurrent?.windGustKph)
                    ? `${nearLiveCurrent.windGustKph} km/h`
                    : "—"}
                </p>
                <p>
                  Pressure:{" "}
                  {Number.isFinite(nearLiveCurrent?.pressureHpa)
                    ? `${nearLiveCurrent.pressureHpa} hPa`
                    : "—"}
                </p>
                <p>
                  Status:{" "}
                  {nearLiveError
                    ? `Unavailable (${nearLiveError})`
                    : nearLiveCurrent?.sourceLabel ?? "Loaded"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Publish Race</h2>
              <p className="mt-1 text-sm text-black/60">
                Recent NZWN first-seen timing between official PreFlight and NOAA
                `tgftp`. Times in this table are shown in America/Chicago. This
                logger runs a 1-second watch starting at `:04` and `:34` and
                also keeps minute fallback polls because NZWN publication can
                drift well past the nominal schedule.
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
                  <th className="px-3 py-2 font-semibold">PreFlight Seen</th>
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
                            row.winner === "preflight"
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
                        {formatChicagoDateTimeSeconds(row.preflightFirstSeenAt)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatChicagoDateTimeSeconds(row.tgftpFirstSeenAt)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatChicagoDateTimeSeconds(row.tgftpLastModifiedAt)}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-black/80">
                        {row.rawMetar ?? row.preflightRawMetar ?? row.tgftpRawMetar ?? "—"}
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
                        {row.preflightFirstSeenAt
                          ? formatAucklandDateTimeSeconds(row.preflightFirstSeenAt)
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
