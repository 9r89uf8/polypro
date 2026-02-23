//app/kord/day/[date]/page.js
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
import annotationPlugin from "chartjs-plugin-annotation";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Line } from "react-chartjs-2";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";

ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
  annotationPlugin,
);

const STATION_ICAO = "KORD";
const STATION_IEM = "ORD";
const CHICAGO_TIMEZONE = "America/Chicago";
const LIVE_POLL_INTERVAL_MS = 3 * 60 * 1000;

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseMinute(tsLocal) {
  const match = /(\d{2}):(\d{2})$/.exec(tsLocal || "");
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
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatTemp(value, unit) {
  if (value === undefined || value === null) {
    return "—";
  }
  return `${value.toFixed(1)}°${unit}`;
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

function formatLivePollMessage(result, label) {
  if (!result?.ok) {
    return `${label} skipped (${result?.reason ?? "unknown"}).`;
  }

  if (result.inserted) {
    return `${label}: saved ${result.tsLocal}.`;
  }
  return `${label}: no new report (${result.tsLocal}).`;
}

function formatBackfillMessage(result) {
  if (!result?.ok) {
    return "Live backfill skipped.";
  }
  return `Live backfill: inserted ${result.insertedCount} of ${result.consideredCount} today observations.`;
}

function buildLineDataset(rows, unit, label, color) {
  const data = rows
    .map((row) => {
      const x = parseMinute(row.tsLocal);
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

  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    pointRadius: 1.5,
    pointHoverRadius: 3,
    borderWidth: 2,
    tension: 0.25,
    showLine: true,
  };
}

function mergeObservationRows(officialRows, allRows, displayUnit) {
  const merged = [];

  for (const row of officialRows) {
    merged.push({
      mode: "official",
      tsUtc: row.tsUtc,
      tsLocal: row.tsLocal,
      temp: displayUnit === "C" ? row.tempC : row.tempF,
      source: row.source,
      rawMetar: row.rawMetar,
    });
  }

  for (const row of allRows) {
    merged.push({
      mode: "all",
      tsUtc: row.tsUtc,
      tsLocal: row.tsLocal,
      temp: displayUnit === "C" ? row.tempC : row.tempF,
      source: row.source,
      rawMetar: row.rawMetar,
    });
  }

  merged.sort((a, b) => a.tsUtc - b.tsUtc || a.mode.localeCompare(b.mode));
  return merged;
}

export default function KordDayPage() {
  const params = useParams();
  const rawDate = Array.isArray(params?.date) ? params.date[0] : params?.date;
  const date = rawDate || "";
  const [displayUnit, setDisplayUnit] = useState("F");
  const [liveMessage, setLiveMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlightRef = useRef(false);
  const backfilledDateRef = useRef("");
  const isDateValid = isValidDate(date);
  const isToday = isDateValid && date === chicagoTodayKey();

  const pollLatest = useAction("weather:pollLatestNoaaMetar");
  const backfillToday = useAction("weather:backfillTodayOfficialFromIem");

  const dayData = useQuery(
    "weather:getDayObservations",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );

  const comparison = dayData?.comparison ?? null;
  const officialRows = dayData?.officialRows ?? [];
  const allRows = dayData?.allRows ?? [];
  const manualMax =
    displayUnit === "C" ? comparison?.manualMaxC : comparison?.manualMaxF;
  const officialMax =
    displayUnit === "C" ? comparison?.metarMaxC : comparison?.metarMaxF;
  const allMax =
    displayUnit === "C" ? comparison?.metarAllMaxC : comparison?.metarAllMaxF;

  useEffect(() => {
    if (!isToday) {
      setLiveMessage("");
      return;
    }

    let cancelled = false;
    let intervalId;

    async function safeCall(fn, onSuccess, options = {}) {
      const skipWhenHidden = options.skipWhenHidden !== false;
      if (
        cancelled ||
        inFlightRef.current ||
        (skipWhenHidden && document.hidden)
      ) {
        return false;
      }

      inFlightRef.current = true;
      try {
        const result = await fn();
        if (!cancelled && onSuccess) {
          setLiveMessage(onSuccess(result));
        }
        return true;
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setLiveMessage(`Live sync failed: ${message}`);
        }
        return false;
      } finally {
        inFlightRef.current = false;
      }
    }

    async function bootstrapLive() {
      if (backfilledDateRef.current !== date) {
        const backfillSucceeded = await safeCall(
          () => backfillToday({ stationIem: STATION_IEM, stationIcao: STATION_ICAO }),
          (result) => formatBackfillMessage(result),
          { skipWhenHidden: false },
        );
        if (backfillSucceeded) {
          backfilledDateRef.current = date;
        }
      }

      await safeCall(
        () => pollLatest({ stationIcao: STATION_ICAO }),
        (result) => formatLivePollMessage(result, "Live poll"),
      );

      if (cancelled) {
        return;
      }

      intervalId = setInterval(() => {
        safeCall(
          () => pollLatest({ stationIcao: STATION_ICAO }),
          (result) => formatLivePollMessage(result, "Live poll"),
        );
      }, LIVE_POLL_INTERVAL_MS);
    }

    bootstrapLive();

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [date, isToday, backfillToday, pollLatest]);

  async function handleRefreshNow() {
    if (!isToday || inFlightRef.current) {
      return;
    }

    setIsRefreshing(true);
    inFlightRef.current = true;
    try {
      const result = await pollLatest({ stationIcao: STATION_ICAO });
      setLiveMessage(formatLivePollMessage(result, "Manual refresh"));
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setLiveMessage(`Manual refresh failed: ${message}`);
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }

  const chartData = useMemo(
    () => ({
      datasets: isToday
        ? [buildLineDataset(officialRows, displayUnit, "Official", "#0f766e")]
        : [
            buildLineDataset(officialRows, displayUnit, "Official", "#0f766e"),
            buildLineDataset(allRows, displayUnit, "All", "#111827"),
          ],
    }),
    [officialRows, allRows, displayUnit, isToday],
  );

  const chartOptions = useMemo(() => {
    const annotations = {};

    if (manualMax !== undefined && manualMax !== null) {
      annotations.manualLine = {
        type: "line",
        yMin: manualMax,
        yMax: manualMax,
        borderColor: "#dc2626",
        borderWidth: 2,
        borderDash: [6, 6],
        label: {
          display: true,
          content: `Manual/WU max ${manualMax.toFixed(1)}°${displayUnit}`,
          position: "end",
          backgroundColor: "rgba(220,38,38,0.92)",
          color: "white",
          padding: 4,
        },
      };
    }

    return {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "top",
        },
        tooltip: {
          callbacks: {
            title(items) {
              if (!items.length) {
                return "";
              }
              return `Local ${minuteLabel(items[0].parsed.x)}`;
            },
            label(item) {
              return `${item.dataset.label}: ${item.parsed.y.toFixed(1)}°${displayUnit}`;
            },
          },
        },
        annotation: {
          annotations,
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 1439,
          title: {
            display: true,
            text: "Local Time (America/Chicago)",
          },
          ticks: {
            stepSize: 120,
            callback(value) {
              return minuteLabel(Number(value));
            },
          },
        },
        y: {
          title: {
            display: true,
            text: `Temperature (°${displayUnit})`,
          },
        },
      },
    };
  }, [manualMax, displayUnit]);

  const mergedRows = useMemo(
    () =>
      mergeObservationRows(
        officialRows,
        isToday ? [] : allRows,
        displayUnit,
      ),
    [officialRows, allRows, displayUnit, isToday],
  );

  if (!isDateValid) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-line/80 bg-panel/90 p-6">
          <h1 className="text-xl font-semibold text-foreground">Invalid Date</h1>
          <p className="mt-2 text-sm text-black/70">
            The route must use <code>YYYY-MM-DD</code>.
          </p>
          <Link
            href="/kord/month"
            className="mt-4 inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
          >
            Back to Month
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
            STATION {STATION_ICAO}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-foreground">
            Day Detail {date}
          </h1>
          {isToday ? (
            <p className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
              Live polling every 3 minutes
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/kord/month"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Back to Month
            </Link>
            {!isToday ? (
              <Link
                href="/kord/today"
                className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:border-emerald-400"
              >
                Go to Live Today
              </Link>
            ) : null}
            {isToday ? (
              <button
                type="button"
                onClick={handleRefreshNow}
                disabled={isRefreshing}
                className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRefreshing ? "Refreshing..." : "Refresh now"}
              </button>
            ) : null}
            {["C", "F"].map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => setDisplayUnit(unit)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  displayUnit === unit
                    ? "bg-black text-white"
                    : "border border-black/20 bg-white/70 text-black/70 hover:border-black"
                }`}
              >
                {unit}
              </button>
            ))}
          </div>
          {isToday ? (
            <p className="mt-3 text-xs text-black/65">
              {liveMessage ||
                "Live mode will backfill today once, then poll NOAA while this tab is visible."}
            </p>
          ) : null}
        </header>

        {dayData === undefined ? (
          <section className="rounded-3xl border border-line/80 bg-panel/90 p-6">
            <p className="text-sm text-black/70">Loading day data...</p>
          </section>
        ) : (
          <>
            <section className={`grid gap-4 ${isToday ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
              <article className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                  Manual / WU Max
                </p>
                <p className="mt-2 text-xl font-semibold text-black">
                  {formatTemp(manualMax, displayUnit)}
                </p>
              </article>
              <article className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                  Official Max
                </p>
                <p className="mt-2 text-xl font-semibold text-black">
                  {formatTemp(officialMax, displayUnit)}
                </p>
                <p className="mt-1 text-xs text-black/60">
                  Obs: {comparison?.metarObsCount ?? "—"}
                </p>
              </article>
              {!isToday ? (
                <article className="rounded-2xl border border-black/10 bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                    All Max
                  </p>
                  <p className="mt-2 text-xl font-semibold text-black">
                    {formatTemp(allMax, displayUnit)}
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    Obs: {comparison?.metarAllObsCount ?? "—"}
                  </p>
                </article>
              ) : null}
            </section>

            <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
              <h2 className="text-lg font-semibold text-foreground">
                Temperature Lines
              </h2>
              <p className="mt-2 text-sm text-black/65">
                {isToday
                  ? "Official METAR/SPECI temperatures for today (live). Red dashed line is the manual/Wunderground max."
                  : "Official and All observation temperatures through the day. Red dashed line is the manual/Wunderground max."}
              </p>
              <div className="mt-4 h-[360px] rounded-2xl border border-black/10 bg-white/75 p-3">
                <Line data={chartData} options={chartOptions} />
              </div>
            </section>

            <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
              <h2 className="text-lg font-semibold text-foreground">
                Raw Observations
              </h2>
              <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
                <table className="min-w-full text-sm">
                  <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                    <tr>
                      <th className="px-3 py-2">Local Time</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Temp</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Raw METAR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedRows.map((row, index) => (
                      <tr key={`${row.mode}-${row.tsUtc}-${index}`} className="border-t border-black/10">
                        <td className="px-3 py-2 text-black/80">{row.tsLocal}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              row.mode === "official"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-black/10 text-black/75"
                            }`}
                          >
                            {row.mode}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-black/80">
                          {formatTemp(row.temp, displayUnit)}
                        </td>
                        <td className="px-3 py-2 text-black/65">{row.source}</td>
                        <td
                          className="max-w-[700px] px-3 py-2 font-mono text-xs text-black/70"
                          title={row.rawMetar}
                        >
                          {row.rawMetar}
                        </td>
                      </tr>
                    ))}
                    {mergedRows.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-sm text-black/60" colSpan={5}>
                          {isToday
                            ? "No official observations saved for today yet. Leave this page open to continue live polling."
                            : "No observations saved for this day yet. Run compute first."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
