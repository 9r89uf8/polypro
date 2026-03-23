"use client";

import {
  BarElement,
  CategoryScale,
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
import { Bar, Line } from "react-chartjs-2";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
  annotationPlugin,
);

const STATION_ICAO = "NZWN";
const AUCKLAND_TIMEZONE = "Pacific/Auckland";
const TRAILING_OPTIONS = [7, 14, 30, 60, 90];

function aucklandTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: AUCKLAND_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = {};
  for (const p of formatter.formatToParts(new Date())) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, n) {
  const epoch = Date.parse(dateKey + "T00:00:00Z") + n * 86400000;
  const d = new Date(epoch);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTemp(value) {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}`;
}

function errorColorClass(errorC) {
  if (errorC === null || errorC === undefined) return "";
  const abs = Math.abs(errorC);
  if (abs <= 1) return "text-green-700 bg-green-50";
  if (abs <= 2) return "text-yellow-700 bg-yellow-50";
  return "text-red-700 bg-red-50";
}

function formatStoredLocalDateTime(localStr) {
  if (!localStr) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(localStr);
  if (!match) return localStr;
  const [, , mo, da, hh, mm] = match;
  return `${da}/${mo} ${hh}:${mm}`;
}

// ── Section 1: Accuracy by Lead Time ────────────────────────────────────────

function AccuracyByLeadTime({ data, trailingDays }) {
  const metrics = data?.leadDayMetrics ?? [];
  const hasData = metrics.some((m) => m.sampleSize > 0);

  const bestLead = useMemo(() => {
    let best = null;
    for (const m of metrics) {
      if (m.mae !== null && (best === null || m.mae < best.mae)) best = m;
    }
    return best;
  }, [metrics]);

  const worstLead = useMemo(() => {
    let worst = null;
    for (const m of metrics) {
      if (m.mae !== null && (worst === null || m.mae > worst.mae)) worst = m;
    }
    return worst;
  }, [metrics]);

  const overallMae = useMemo(() => {
    let totalError = 0;
    let totalCount = 0;
    for (const m of metrics) {
      if (m.mae !== null) {
        totalError += m.mae * m.sampleSize;
        totalCount += m.sampleSize;
      }
    }
    return totalCount > 0 ? Math.round((totalError / totalCount) * 10) / 10 : null;
  }, [metrics]);

  const totalSamples = metrics.reduce((s, m) => s + m.sampleSize, 0);

  const chartData = {
    labels: metrics.map((m) => `${m.leadDays}d`),
    datasets: [
      {
        label: "MAE (°C)",
        data: metrics.map((m) => m.mae),
        backgroundColor: metrics.map((m) =>
          m.mae === null
            ? "rgba(0,0,0,0.1)"
            : m.mae <= 1
              ? "rgba(34,197,94,0.7)"
              : m.mae <= 2
                ? "rgba(234,179,8,0.7)"
                : "rgba(239,68,68,0.7)",
        ),
        borderRadius: 6,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false },
      tooltip: {
        callbacks: {
          afterLabel: (ctx) => {
            const m = metrics[ctx.dataIndex];
            if (!m) return "";
            return [
              `Bias: ${m.meanBias !== null ? (m.meanBias > 0 ? "+" : "") + m.meanBias + "°C" : "—"}`,
              `Within 1°C: ${m.within1Pct ?? "—"}%`,
              `Within 2°C: ${m.within2Pct ?? "—"}%`,
              `Samples: ${m.sampleSize}`,
            ].join("\n");
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: "MAE (°C)" },
      },
    },
  };

  return (
    <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
      <h2 className="text-xl font-semibold text-foreground">
        Accuracy by Lead Time
      </h2>
      <p className="mt-1 text-sm text-black/55">
        MetService max temperature forecast accuracy over the last {trailingDays} days
      </p>

      {!hasData ? (
        <p className="mt-6 text-center text-black/55">
          No forecast accuracy data available yet. Data will appear after forecast
          snapshots and observations accumulate.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-black/10 bg-stone-50 p-3">
              <div className="text-xs text-black/55">Overall MAE</div>
              <div className="mt-1 text-lg font-bold text-foreground">
                {overallMae !== null ? `${overallMae}°C` : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-black/10 bg-stone-50 p-3">
              <div className="text-xs text-black/55">Best Lead</div>
              <div className="mt-1 text-lg font-bold text-green-700">
                {bestLead ? `${bestLead.leadDays}d (${bestLead.mae}°C)` : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-black/10 bg-stone-50 p-3">
              <div className="text-xs text-black/55">Worst Lead</div>
              <div className="mt-1 text-lg font-bold text-red-700">
                {worstLead ? `${worstLead.leadDays}d (${worstLead.mae}°C)` : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-black/10 bg-stone-50 p-3">
              <div className="text-xs text-black/55">Samples</div>
              <div className="mt-1 text-lg font-bold text-foreground">
                {totalSamples}
              </div>
            </div>
          </div>

          <div className="mt-5 h-64">
            <Bar data={chartData} options={chartOptions} />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/55">
                  <th className="px-3 py-2 font-semibold">Lead</th>
                  <th className="px-3 py-2 font-semibold">MAE</th>
                  <th className="px-3 py-2 font-semibold">Bias</th>
                  <th className="px-3 py-2 font-semibold">{"<"}1°C</th>
                  <th className="px-3 py-2 font-semibold">{"<"}2°C</th>
                  <th className="px-3 py-2 font-semibold">n</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr
                    key={m.leadDays}
                    className="border-b border-black/5 last:border-b-0"
                  >
                    <td className="px-3 py-2 font-medium">{m.leadDays}d</td>
                    <td className="px-3 py-2">
                      {m.mae !== null ? `${m.mae}°C` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {m.meanBias !== null
                        ? `${m.meanBias > 0 ? "+" : ""}${m.meanBias}°C`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {m.within1Pct !== null ? `${m.within1Pct}%` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {m.within2Pct !== null ? `${m.within2Pct}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-black/55">{m.sampleSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

// ── Section 2: Forecast Progression for a Date ──────────────────────────────

function ForecastProgression({ stationIcao }) {
  const today = aucklandTodayKey();
  const yesterday = addDays(today, -1);
  const [selectedDate, setSelectedDate] = useState(yesterday);

  const trendData = useQuery(
    "nzwnWeather:getForecastTrend",
    selectedDate
      ? { stationIcao, targetDate: selectedDate }
      : "skip",
  );

  const rows = trendData?.rows ?? [];
  const actualMaxC = trendData?.actualMaxC ?? null;

  const chartData = useMemo(() => {
    if (rows.length === 0) return null;
    return {
      labels: rows.map((r) => formatStoredLocalDateTime(r.capturedAtLocal)),
      datasets: [
        {
          label: "Predicted Max (°C)",
          data: rows.map((r) => r.maxTempC),
          borderColor: "rgb(59,130,246)",
          backgroundColor: "rgba(59,130,246,0.1)",
          tension: 0.3,
          pointRadius: 4,
        },
      ],
    };
  }, [rows]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      annotation: actualMaxC !== null
        ? {
            annotations: {
              actualLine: {
                type: "line",
                yMin: actualMaxC,
                yMax: actualMaxC,
                borderColor: "rgba(239,68,68,0.7)",
                borderWidth: 2,
                borderDash: [6, 4],
                label: {
                  display: true,
                  content: `Actual: ${actualMaxC}°C`,
                  position: "start",
                  backgroundColor: "rgba(239,68,68,0.8)",
                  color: "white",
                  font: { size: 11 },
                },
              },
            },
          }
        : {},
    },
    scales: {
      x: {
        ticks: { maxRotation: 45, font: { size: 10 } },
      },
      y: {
        title: { display: true, text: "°C" },
      },
    },
  }), [actualMaxC]);

  return (
    <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
      <h2 className="text-xl font-semibold text-foreground">
        Forecast Progression
      </h2>
      <p className="mt-1 text-sm text-black/55">
        How MetService&apos;s predicted max changed over successive captures for a
        single date
      </p>

      <div className="mt-4 flex items-center gap-3">
        <label className="text-sm font-medium text-black/70">Date:</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm"
        />
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-center text-black/55">
          No forecast predictions stored for {selectedDate}.
        </p>
      ) : (
        <>
          {chartData && (
            <div className="mt-5 h-64">
              <Line data={chartData} options={chartOptions} />
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/55">
                  <th className="px-3 py-2 font-semibold">Captured</th>
                  <th className="px-3 py-2 font-semibold">Lead</th>
                  <th className="px-3 py-2 font-semibold">Max °C</th>
                  <th className="px-3 py-2 font-semibold">Change</th>
                  <th className="px-3 py-2 font-semibold">Error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-black/5 last:border-b-0"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-black/80">
                      {formatStoredLocalDateTime(r.capturedAtLocal)}
                    </td>
                    <td className="px-3 py-2">{r.leadDays}d</td>
                    <td className="px-3 py-2 font-medium">
                      {formatTemp(r.maxTempC)}
                    </td>
                    <td className="px-3 py-2">
                      {r.deltaC !== null
                        ? `${r.deltaC > 0 ? "+" : ""}${r.deltaC}°C`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.errorC !== null ? (
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${errorColorClass(r.errorC)}`}
                        >
                          {r.errorC > 0 ? "+" : ""}
                          {r.errorC}°C
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {actualMaxC !== null && (
            <p className="mt-3 text-sm text-black/55">
              Actual observed max: <span className="font-semibold text-red-700">{actualMaxC}°C</span>
              {" "}({trendData?.obsCount ?? 0} observations)
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ── Section 3: Recent Predictions Table ─────────────────────────────────────

function RecentPredictionsTable({ data }) {
  const details = data?.dateDetails ?? [];
  const LEAD_DAYS_COLS = [0, 1, 3, 5, 7, 9];

  return (
    <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
      <h2 className="text-xl font-semibold text-foreground">
        Recent Predictions
      </h2>
      <p className="mt-1 text-sm text-black/55">
        Predicted vs actual max temperature by date and lead time
      </p>

      {details.length === 0 ? (
        <p className="mt-6 text-center text-black/55">No data yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-black/10 text-black/55">
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Actual</th>
                {LEAD_DAYS_COLS.map((ld) => (
                  <th key={ld} className="px-2 py-2 font-semibold text-center">
                    {ld}d
                  </th>
                ))}
                <th className="px-2 py-2 font-semibold">1d Err</th>
              </tr>
            </thead>
            <tbody>
              {details.map((row) => {
                const predByLead = {};
                for (const p of row.predictions) {
                  predByLead[p.leadDays] = p;
                }
                const err1d = predByLead[1]?.errorC ?? null;

                return (
                  <tr
                    key={row.date}
                    className="border-b border-black/5 last:border-b-0"
                  >
                    <td className="px-2 py-2 whitespace-nowrap">
                      <Link
                        href={`/nzwn/day/${row.date}`}
                        className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-600"
                      >
                        {row.date}
                      </Link>
                    </td>
                    <td className="px-2 py-2 font-medium">
                      {formatTemp(row.actualMaxC)}
                    </td>
                    {LEAD_DAYS_COLS.map((ld) => {
                      const pred = predByLead[ld];
                      return (
                        <td key={ld} className="px-2 py-2 text-center">
                          {pred?.maxTempC !== null && pred?.maxTempC !== undefined
                            ? formatTemp(pred.maxTempC)
                            : "—"}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2">
                      {err1d !== null ? (
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${errorColorClass(err1d)}`}
                        >
                          {err1d > 0 ? "+" : ""}
                          {err1d}°C
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function NzwnForecastAccuracyPage() {
  const [trailingDays, setTrailingDays] = useState(30);

  const accuracyData = useQuery("nzwnWeather:getForecastAccuracy", {
    stationIcao: STATION_ICAO,
    trailingDays,
  });

  const isLoading = accuracyData === undefined;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            NZWN Forecast Accuracy
          </h1>
          <p className="mt-1 text-sm text-black/55">
            MetService Wellington max temperature forecast accuracy
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-black/55">Window:</span>
          {TRAILING_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setTrailingDays(d)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                trailingDays === d
                  ? "bg-foreground text-white"
                  : "bg-stone-100 text-black/70 hover:bg-stone-200"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-3 text-sm">
        <Link
          href={`/nzwn/day/${aucklandTodayKey()}`}
          className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-600"
        >
          Today&apos;s day page
        </Link>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-black/55">
          Loading forecast accuracy data...
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <AccuracyByLeadTime data={accuracyData} trailingDays={trailingDays} />
          <ForecastProgression stationIcao={STATION_ICAO} />
          <RecentPredictionsTable data={accuracyData} />
        </div>
      )}
    </main>
  );
}
