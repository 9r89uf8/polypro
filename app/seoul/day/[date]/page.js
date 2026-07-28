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
    ctx.fillText("NOW", x, chartArea.top + 28);
    ctx.restore();
  },
};

const sunsetLinePlugin = {
  id: "seoulSunsetLine",
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
    ctx.strokeStyle = "rgba(251, 146, 60, 0.62)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();

    ctx.fillStyle = "#fb923c";
    ctx.font = "500 10px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`SUNSET · ${options.label}`, x, chartArea.top + 12);
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
  sunsetLinePlugin,
);

const STATION_ICAO = "RKSI";
const SEOUL_TIMEZONE = "Asia/Seoul";
const RKSI_LATITUDE = 37.4602;
const RKSI_LONGITUDE = 126.4407;
const SEOUL_UTC_OFFSET_HOURS = 9;
const OFFICIAL_SUNSET_ZENITH_DEGREES = 90.833;
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

function normalizeCycle(value, cycle) {
  return ((value % cycle) + cycle) % cycle;
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

function sunsetMinuteForDate(dateKey) {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    return null;
  }

  const dayOfYear =
    Math.floor(
      (Date.UTC(parts.year, parts.month - 1, parts.day) -
        Date.UTC(parts.year, 0, 1)) /
        DAY_MS,
    ) + 1;
  const longitudeHour = RKSI_LONGITUDE / 15;
  const approximateTime = dayOfYear + (18 - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeCycle(
    meanAnomaly +
      1.916 * Math.sin(degreesToRadians(meanAnomaly)) +
      0.02 * Math.sin(degreesToRadians(2 * meanAnomaly)) +
      282.634,
    360,
  );

  let rightAscension = normalizeCycle(
    radiansToDegrees(
      Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude))),
    ),
    360,
  );
  rightAscension +=
    Math.floor(trueLongitude / 90) * 90 - Math.floor(rightAscension / 90) * 90;
  rightAscension /= 15;

  const sinDeclination = 0.39782 * Math.sin(degreesToRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle =
    (Math.cos(degreesToRadians(OFFICIAL_SUNSET_ZENITH_DEGREES)) -
      sinDeclination * Math.sin(degreesToRadians(RKSI_LATITUDE))) /
    (cosDeclination * Math.cos(degreesToRadians(RKSI_LATITUDE)));
  if (cosHourAngle < -1 || cosHourAngle > 1) {
    return null;
  }

  const hourAngle = radiansToDegrees(Math.acos(cosHourAngle)) / 15;
  const localMeanTime =
    hourAngle + rightAscension - 0.06571 * approximateTime - 6.622;
  const utcHour = normalizeCycle(localMeanTime - longitudeHour, 24);
  return normalizeCycle(utcHour + SEOUL_UTC_OFFSET_HOURS, 24) * 60;
}

function parseMinute(localTimestamp) {
  const match = /(?:^|[ T])(\d{2}):(\d{2})(?::\d{2})?/.exec(
    localTimestamp ?? "",
  );
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

function formatPredictionTemperature(value, unit) {
  return Number.isFinite(value) ? `${value.toFixed(1)}°${unit}` : "—";
}

function formatTemperatureDelta(value, unit) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}°${unit}`;
}

function temperatureForUnit(source, cField, fField, unit) {
  const value = source?.[unit === "C" ? cField : fField];
  return Number.isFinite(value) ? value : null;
}

function firstFinite(...values) {
  return values.find(Number.isFinite) ?? null;
}

function celsiusToFahrenheit(value) {
  return Number.isFinite(value) ? (value * 9) / 5 + 32 : null;
}

function formatLocalTime(value, includeSeconds = false) {
  if (Number.isFinite(value)) {
    return formatClock(value, includeSeconds);
  }
  const minute = parseMinute(value);
  return Number.isFinite(minute) ? minuteLabel(minute) : value || "—";
}

function formatPeakWindow(start, end) {
  if (!start && !end) {
    return "Still calculating";
  }
  if (!start || !end) {
    return formatLocalTime(start || end);
  }
  return `${formatLocalTime(start)}–${formatLocalTime(end)}`;
}

function predictionStatusMeta(status) {
  const statuses = {
    on_track: {
      label: "On track",
      className: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
    },
    running_warm: {
      label: "Running warm",
      className: "border-amber-300/30 bg-amber-300/10 text-amber-200",
    },
    running_cool: {
      label: "Running cool",
      className: "border-sky-300/30 bg-sky-300/10 text-sky-200",
    },
    revised_up: {
      label: "Revised up",
      className: "border-orange-300/30 bg-orange-300/10 text-orange-200",
    },
    revised_down: {
      label: "Revised down",
      className: "border-indigo-300/30 bg-indigo-300/10 text-indigo-200",
    },
    peak_likely_passed: {
      label: "Peak likely passed",
      className: "border-violet-300/30 bg-violet-300/10 text-violet-200",
    },
    final: {
      label: "Final",
      className: "border-white/20 bg-white/10 text-slate-100",
    },
  };
  return (
    statuses[status] ?? {
      label: status
        ? String(status).replaceAll("_", " ")
        : "Awaiting assessment",
      className: "border-white/15 bg-white/5 text-slate-300",
    }
  );
}

function normalizePrediction(prediction) {
  if (!prediction) {
    return null;
  }
  const observedCurrent = prediction.observedCurrent ?? {};
  const expectedCurrent = prediction.expectedCurrent ?? {};
  const liveBias = prediction.liveBias ?? {};
  const expectedNowC =
    prediction.expectedNowC ??
    prediction.expectedCurrentC ??
    expectedCurrent.tempC;
  const deviationC =
    prediction.deviationC ?? prediction.liveBiasC ?? liveBias.tempC;
  return {
    ...prediction,
    revisionNumber: prediction.revisionNumber ?? prediction.revision,
    peakStartLocal:
      prediction.peakStartLocal ??
      prediction.peakWindowStartLocal ??
      prediction.peakWindowStart,
    peakEndLocal:
      prediction.peakEndLocal ??
      prediction.peakWindowEndLocal ??
      prediction.peakWindowEnd,
    currentTempC:
      prediction.currentTempC ??
      prediction.observedCurrentC ??
      observedCurrent.tempC,
    currentTempF:
      prediction.currentTempF ??
      prediction.observedCurrentF ??
      observedCurrent.tempF,
    currentObsTimeLocal:
      prediction.currentObsTimeLocal ??
      prediction.observedCurrentAtLocal ??
      prediction.observedCurrentTimeLocal ??
      observedCurrent.obsTimeLocal ??
      observedCurrent.timeLocal,
    expectedNowC,
    expectedNowF:
      prediction.expectedNowF ??
      prediction.expectedCurrentF ??
      expectedCurrent.tempF ??
      celsiusToFahrenheit(expectedNowC),
    deviationC,
    deviationF:
      prediction.deviationF ??
      prediction.liveBiasF ??
      liveBias.tempF ??
      (Number.isFinite(deviationC) ? deviationC * 1.8 : null),
    warmingRate30CPerHour:
      prediction.warmingRate30CPerHour ?? prediction.slope30mCPerHour,
    hourlyCurve: prediction.hourlyCurve ?? prediction.hourlyEnsembleCurve ?? [],
  };
}

function temperatureTickLabel(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue.toFixed(1)}°` : "";
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

function mergeAmosDisplayRows(oneMinuteRows, auditRows) {
  const byTime = new Map(
    auditRows.map((row) => [
      row.obsTimeUtc,
      { ...row, displayCadence: "audit_fallback" },
    ]),
  );
  for (const row of oneMinuteRows) {
    byTime.set(row.obsTimeUtc, { ...row, displayCadence: "one_minute" });
  }
  return [...byTime.values()].sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
}

function toChartPoints(rows, unit, extra = () => ({})) {
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

function toForecastPoints(rows, unit) {
  return (rows ?? [])
    .map((row) => {
      const x = parseMinute(
        row.forecastTimeLocal ?? row.timeLocal ?? row.validTimeLocal,
      );
      const y =
        unit === "C"
          ? firstFinite(row.tempC, row.ensembleTempC, row.predictedTempC)
          : firstFinite(row.tempF, row.ensembleTempF, row.predictedTempF);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return {
        x,
        y,
        forecastTimeUtc: row.forecastTimeUtc ?? row.timeUtc,
        forecastTimeLocal:
          row.forecastTimeLocal ?? row.timeLocal ?? row.validTimeLocal,
      };
    })
    .filter(Boolean);
}

function buildChartData(metarRows, amosDisplayRows, forecastRows, unit) {
  const amosPoints = toChartPoints(amosDisplayRows, unit, (row) => ({
    displayCadence: row.displayCadence,
  }));
  const metarPoints = toChartPoints(metarRows, unit, (row) => ({
    reportType: row.reportType,
    rawMetar: row.rawMetar,
  }));
  const forecastPoints = toForecastPoints(forecastRows, unit);

  const datasets = [
    {
      label: "AMOS · 1 minute",
      data: amosPoints,
      borderColor: "#22d3ee",
      backgroundColor: "#22d3ee",
      borderWidth: 2.25,
      pointRadius: 0,
      pointHitRadius: 8,
      pointHoverRadius: 4,
      tension: 0.18,
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
  ];

  if (forecastPoints.length) {
    datasets.unshift({
      label: "15L high forecast",
      data: forecastPoints,
      borderColor: "#fbbf24",
      backgroundColor: "#fbbf24",
      borderWidth: 2.5,
      borderDash: [9, 7],
      pointRadius: 2,
      pointHitRadius: 10,
      pointHoverRadius: 5,
      tension: 0.3,
      spanGaps: false,
      order: 3,
    });
  }

  return { datasets };
}

function PredictionMetric({ label, value, detail }) {
  return (
    <div className="border-l border-white/10 pl-4 first:border-l-0 first:pl-0">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-lg font-medium tracking-tight text-slate-100">
        {value}
      </p>
      {detail && (
        <p className="mt-1 font-mono text-[9px] leading-4 text-slate-600">
          {detail}
        </p>
      )}
    </div>
  );
}

function ProviderSignal({ signal, unit }) {
  const name =
    signal?.label ??
    signal?.providerName ??
    signal?.provider ??
    signal?.source ??
    "Forecast";
  const high = firstFinite(
    temperatureForUnit(signal, "adjustedHighC", "adjustedHighF", unit),
    temperatureForUnit(signal, "rawHighC", "rawHighF", unit),
    temperatureForUnit(signal, "predictedHighC", "predictedHighF", unit),
    temperatureForUnit(signal, "dailyHighC", "dailyHighF", unit),
    temperatureForUnit(signal, "maxTempC", "maxTempF", unit),
  );
  const hasError = Boolean(signal?.error);

  return (
    <div className="flex min-w-[150px] items-center justify-between gap-4 border border-white/10 bg-black/10 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-[9px] uppercase tracking-[0.15em] text-slate-400">
          {String(name)}
        </p>
        <p
          className={`mt-1 truncate font-mono text-[9px] ${
            hasError ? "text-rose-300" : "text-slate-600"
          }`}
        >
          {hasError ? "Unavailable" : signal?.status || "Captured"}
        </p>
      </div>
      <p className="shrink-0 text-sm font-medium text-slate-200">
        {formatPredictionTemperature(high, unit)}
      </p>
    </div>
  );
}

function RevisionCard({ prediction, unit, isLatest }) {
  const high = temperatureForUnit(
    prediction,
    "predictedHighC",
    "predictedHighF",
    unit,
  );
  const status = predictionStatusMeta(prediction?.status);

  return (
    <article
      className={`min-w-[210px] border px-3 py-3 ${
        isLatest
          ? "border-amber-300/30 bg-amber-300/[0.06]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
          Revision {prediction?.revisionNumber ?? "—"}
        </p>
        {isLatest && (
          <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-amber-300">
            Latest
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-xl font-medium text-slate-100">
          {formatPredictionTemperature(high, unit)}
        </p>
        <p className="pb-0.5 font-mono text-[9px] text-slate-500">
          {formatLocalTime(
            prediction?.generatedAtLocal ?? prediction?.generatedAt,
          )}
        </p>
      </div>
      <p className="mt-2 truncate font-mono text-[9px] text-slate-500">
        {status.label} ·{" "}
        {formatPeakWindow(prediction?.peakStartLocal, prediction?.peakEndLocal)}
      </p>
    </article>
  );
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
  const predictionDashboard = useQuery(
    "seoulWeather:getHighPredictionDashboard",
    isDateValid ? { date } : "skip",
  );
  const pollMetar = useAction("seoul:pollLatestNoaaStationMetar");
  const pollOneMinuteAmos = useAction("seoul:pollLatestAmosTemperatureSites");
  const recomputeHighPrediction = useAction(
    "seoulWeather:recomputeTodayHighPrediction",
  );

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
  const amosDisplayRows = useMemo(
    () => mergeAmosDisplayRows(oneMinuteRows, fiveMinuteRows),
    [fiveMinuteRows, oneMinuteRows],
  );

  const latestMetar = metarRows.at(-1) ?? null;
  const latestAmos = amosDisplayRows.at(-1) ?? null;
  const latestPrediction = normalizePrediction(
    predictionDashboard?.latestPrediction,
  );
  const predictionSummary = predictionDashboard?.summary ?? null;
  const predictionEvaluation = predictionDashboard?.evaluation ?? null;
  const predictionRevisions = Array.isArray(predictionDashboard?.revisions)
    ? predictionDashboard.revisions.map(normalizePrediction)
    : [];
  const providerSignals = Array.isArray(latestPrediction?.providerPredictions)
    ? latestPrediction.providerPredictions
    : Array.isArray(latestPrediction?.providerDetails)
      ? latestPrediction.providerDetails
      : Array.isArray(
            predictionDashboard?.latestForecastCapture?.providerPredictions,
          )
        ? predictionDashboard.latestForecastCapture.providerPredictions
        : Array.isArray(
              predictionDashboard?.latestForecastCapture?.providerDetails,
            )
          ? predictionDashboard.latestForecastCapture.providerDetails
          : Array.isArray(predictionDashboard?.providerCaptures)
            ? predictionDashboard.providerCaptures
            : [];
  const isFinalized = Boolean(predictionEvaluation);
  const predictedHigh = firstFinite(
    temperatureForUnit(
      predictionEvaluation,
      "finalPredictedHighC",
      "finalPredictedHighF",
      unit,
    ),
    temperatureForUnit(
      latestPrediction,
      "predictedHighC",
      "predictedHighF",
      unit,
    ),
  );
  const confidenceLow = temperatureForUnit(
    latestPrediction,
    "confidenceLowC",
    "confidenceLowF",
    unit,
  );
  const confidenceHigh = temperatureForUnit(
    latestPrediction,
    "confidenceHighC",
    "confidenceHighF",
    unit,
  );
  const actualHigh = temperatureForUnit(
    predictionEvaluation,
    "actualHighC",
    "actualHighF",
    unit,
  );
  const observedHigh = firstFinite(
    actualHigh,
    temperatureForUnit(
      latestPrediction,
      "observedHighC",
      "observedHighF",
      unit,
    ),
    temperatureForUnit(
      predictionSummary,
      "observedHighC",
      "observedHighF",
      unit,
    ),
    temperatureForUnit(predictionSummary, "maxTempC", "maxTempF", unit),
  );
  const liveAmosTemperature = temperatureForUnit(
    latestAmos,
    "tempC",
    "tempF",
    unit,
  );
  const predictionCurrentTemperature = temperatureForUnit(
    latestPrediction,
    "currentTempC",
    "currentTempF",
    unit,
  );
  const currentTemperature = isToday
    ? firstFinite(liveAmosTemperature, predictionCurrentTemperature)
    : firstFinite(predictionCurrentTemperature, liveAmosTemperature);
  const expectedNow = temperatureForUnit(
    latestPrediction,
    "expectedNowC",
    "expectedNowF",
    unit,
  );
  const deviation = temperatureForUnit(
    latestPrediction,
    "deviationC",
    "deviationF",
    unit,
  );
  const finalErrorC = predictionEvaluation?.finalErrorC;
  const finalError = Number.isFinite(finalErrorC)
    ? finalErrorC * (unit === "C" ? 1 : 1.8)
    : null;
  const predictionStatus = predictionStatusMeta(
    isFinalized ? "final" : latestPrediction?.status,
  );
  const warmingRate30 = Number.isFinite(latestPrediction?.warmingRate30CPerHour)
    ? latestPrediction.warmingRate30CPerHour * (unit === "C" ? 1 : 1.8)
    : null;
  const finalErrorDescription = Number.isFinite(finalError)
    ? finalError > 0
      ? `${formatPredictionTemperature(Math.abs(finalError), unit)} too warm`
      : finalError < 0
        ? `${formatPredictionTemperature(Math.abs(finalError), unit)} too cool`
        : "exactly on target"
    : "not scored";
  const predictionReason = isFinalized
    ? `The actual 15L high was ${formatPredictionTemperature(
        actualHigh,
        unit,
      )} at ${formatLocalTime(
        predictionEvaluation.actualHighAtLocal,
      )}. The closing tracker estimate was ${formatPredictionTemperature(
        predictedHigh,
        unit,
      )}, ${finalErrorDescription}. ${
        typeof predictionEvaluation.peakWindowHit === "boolean"
          ? `The closing peak window ${
              predictionEvaluation.peakWindowHit ? "contained" : "missed"
            } the actual peak.`
          : ""
      }`
    : (latestPrediction?.reason ??
      "The tracker is waiting for enough 15L observations and forecast inputs.");
  const predictionUpdatedAt = isFinalized
    ? (predictionEvaluation.finalizedAtLocal ??
      predictionEvaluation.finalizedAt)
    : (latestPrediction?.generatedAtLocal ?? latestPrediction?.generatedAt);
  const sunsetMinute = useMemo(() => sunsetMinuteForDate(date), [date]);
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
    () =>
      buildChartData(
        metarRows,
        amosDisplayRows,
        latestPrediction?.hourlyCurve,
        unit,
      ),
    [amosDisplayRows, latestPrediction?.hourlyCurve, metarRows, unit],
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
              const auditFallback =
                item.raw?.displayCadence === "audit_fallback"
                  ? " · five-minute audit fallback"
                  : "";
              return `${item.dataset.label}: ${item.parsed.y.toFixed(
                1,
              )}°${unit}${reportType}${auditFallback}`;
            },
          },
        },
        seoulNowLine: {
          display: isToday,
          minute: currentSeoulMinute,
        },
        seoulSunsetLine: {
          display: Number.isFinite(sunsetMinute),
          minute: sunsetMinute,
          label: minuteLabel(sunsetMinute),
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
            stepSize: 60,
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
            maxTicksLimit: 8,
            padding: 8,
            precision: 1,
            font: {
              family: "IBM Plex Mono, monospace",
              size: 10,
            },
            callback: temperatureTickLabel,
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
    [currentSeoulMinute, date, isToday, sunsetMinute, unit],
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

    try {
      const sourceResults = await Promise.allSettled([
        pollMetar({ stationIcao: STATION_ICAO }),
        pollOneMinuteAmos({ stationIcao: STATION_ICAO }),
      ]);
      const sourceFailures = sourceResults.filter(
        (result) => result.status === "rejected",
      );

      for (const failure of sourceFailures) {
        console.error(failure.reason);
      }

      let predictionFailure = null;
      try {
        await recomputeHighPrediction({ date });
      } catch (error) {
        predictionFailure = error;
        console.error(error);
      }

      let message = "Live sources and high prediction synchronized";
      if (predictionFailure && sourceFailures.length) {
        message = `${2 - sourceFailures.length}/2 sources refreshed · prediction unavailable`;
      } else if (predictionFailure) {
        message = "Live sources refreshed · prediction unavailable";
      } else if (sourceFailures.length) {
        message = `${2 - sourceFailures.length}/2 sources refreshed · prediction updated`;
      }
      setRefreshState({ active: false, message });
    } finally {
      refreshInFlight.current = false;
    }
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
    metarRows.length +
      amosDisplayRows.length +
      (latestPrediction?.hourlyCurve?.length ?? 0) >
    0;

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
              Seoul 15L high tracker
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              A continuously revised daily-high prediction, checked against the
              fastest one-minute 15L AMOS temperature and actual RKSI METAR.
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

        <section className="border-b border-white/10 py-6">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
                15L daily-high tracker
              </p>
              <h2 className="mt-1 text-xl font-medium tracking-tight text-slate-100">
                RKSI maximum-temperature prediction
              </h2>
            </div>
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-slate-500">
              {predictionDashboard === undefined
                ? "Loading prediction…"
                : latestPrediction
                  ? `${
                      isFinalized ? "Finalized" : "Updated"
                    } ${formatLocalTime(predictionUpdatedAt, true)} KST · ${
                      isFinalized
                        ? `${predictionEvaluation.revisionCount ?? predictionRevisions.length} revisions`
                        : latestPrediction.modelVersion
                          ? `model ${latestPrediction.modelVersion}`
                          : `revision ${latestPrediction.revisionNumber ?? "—"}`
                    }`
                  : "No prediction captured"}
            </p>
          </div>

          {predictionDashboard === undefined ? (
            <div className="h-52 animate-pulse border border-white/10 bg-white/[0.025]" />
          ) : latestPrediction ? (
            <>
              <div className="grid overflow-hidden border border-amber-300/20 bg-[#0a121d]/90 shadow-[0_24px_80px_rgba(0,0,0,0.25)] xl:grid-cols-[0.9fr_1.1fr]">
                <div className="relative border-b border-white/10 p-5 md:p-7 xl:border-b-0 xl:border-r">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(251,191,36,0.12),transparent_55%)]" />
                  <div className="relative">
                    <span
                      className={`inline-flex border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.17em] ${predictionStatus.className}`}
                    >
                      {predictionStatus.label}
                    </span>
                    <p className="mt-5 font-mono text-[9px] uppercase tracking-[0.2em] text-slate-500">
                      {isFinalized
                        ? "Closing tracker estimate"
                        : "Expected 15L high"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-end gap-x-5 gap-y-2">
                      <p className="text-6xl font-medium tracking-[-0.065em] text-white md:text-8xl">
                        {formatPredictionTemperature(predictedHigh, unit)}
                      </p>
                      <div className="pb-2">
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
                          {isFinalized ? "Closing peak window" : "Likely peak"}
                        </p>
                        <p className="mt-1 text-base font-medium text-amber-200">
                          {formatPeakWindow(
                            latestPrediction.peakStartLocal,
                            latestPrediction.peakEndLocal,
                          )}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 font-mono text-[10px] text-slate-500">
                      {isFinalized
                        ? "Closing confidence interval"
                        : "Confidence interval"}{" "}
                      <span className="text-slate-300">
                        {formatPredictionTemperature(confidenceLow, unit)}–
                        {formatPredictionTemperature(confidenceHigh, unit)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-col justify-between p-5 md:p-7">
                  {isFinalized ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4">
                      <PredictionMetric
                        label="Actual 15L high"
                        value={formatPredictionTemperature(actualHigh, unit)}
                        detail={`at ${formatLocalTime(
                          predictionEvaluation.actualHighAtLocal,
                        )}`}
                      />
                      <PredictionMetric
                        label="Closing error"
                        value={formatTemperatureDelta(finalError, unit)}
                        detail="tracker estimate vs actual"
                      />
                      <PredictionMetric
                        label="Peak window"
                        value={
                          typeof predictionEvaluation.peakWindowHit ===
                          "boolean"
                            ? predictionEvaluation.peakWindowHit
                              ? "Hit"
                              : "Missed"
                            : "—"
                        }
                        detail="closing tracker window"
                      />
                      <PredictionMetric
                        label="15L observations"
                        value={String(predictionEvaluation.obsCount ?? "—")}
                        detail={`${predictionEvaluation.revisionCount ?? predictionRevisions.length} immutable revisions`}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4">
                      <PredictionMetric
                        label="Observed high"
                        value={formatPredictionTemperature(observedHigh, unit)}
                        detail={
                          latestPrediction.observedHighAtLocal
                            ? `at ${formatLocalTime(
                                latestPrediction.observedHighAtLocal,
                              )}`
                            : "15L maximum so far"
                        }
                      />
                      <PredictionMetric
                        label="Current 15L"
                        value={formatPredictionTemperature(
                          currentTemperature,
                          unit,
                        )}
                        detail={formatLocalTime(
                          isToday
                            ? (latestAmos?.obsTimeLocal ??
                                latestPrediction.currentObsTimeLocal)
                            : (latestPrediction.currentObsTimeLocal ??
                                latestAmos?.obsTimeLocal),
                        )}
                      />
                      <PredictionMetric
                        label="Expected now"
                        value={formatPredictionTemperature(expectedNow, unit)}
                        detail={
                          Number.isFinite(deviation)
                            ? `${deviation >= 0 ? "+" : ""}${deviation.toFixed(
                                1,
                              )}°${unit} deviation`
                            : "curve comparison pending"
                        }
                      />
                      <PredictionMetric
                        label="30-minute trend"
                        value={
                          Number.isFinite(warmingRate30)
                            ? `${warmingRate30 >= 0 ? "+" : ""}${warmingRate30.toFixed(
                                1,
                              )}°${unit}/hr`
                            : "—"
                        }
                        detail="AMOS warming rate"
                      />
                    </div>
                  )}

                  <div className="mt-6 border-t border-white/10 pt-5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                      {isFinalized ? "Final score" : "Why this prediction"}
                    </p>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                      {predictionReason}
                    </p>
                  </div>
                </div>
              </div>

              {providerSignals.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {providerSignals.map((signal, index) => (
                    <ProviderSignal
                      key={
                        signal?._id ??
                        signal?.provider ??
                        signal?.source ??
                        index
                      }
                      signal={signal}
                      unit={unit}
                    />
                  ))}
                </div>
              )}

              {predictionRevisions.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
                      Prediction history
                    </p>
                    <p className="font-mono text-[9px] text-slate-600">
                      Forecasts are retained, not overwritten
                    </p>
                  </div>
                  <div
                    aria-label="Prediction revision history"
                    className="flex gap-2 overflow-x-auto pb-2"
                    role="region"
                    tabIndex={0}
                  >
                    {predictionRevisions.map((prediction, index) => (
                      <RevisionCard
                        key={
                          prediction?._id ??
                          `${prediction?.generatedAt ?? "revision"}-${index}`
                        }
                        prediction={prediction}
                        unit={unit}
                        isLatest={
                          prediction?._id === latestPrediction?._id ||
                          prediction?.revisionNumber ===
                            latestPrediction?.revisionNumber
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="border border-white/10 bg-white/[0.02] px-5 py-10 text-center">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">
                No daily-high prediction yet
              </p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                {predictionDashboard?.error ||
                  (isToday
                    ? "Sync live sources to build the first 15L prediction."
                    : "No immutable prediction was captured for this historical date.")}
              </p>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-y-5 border-b border-white/10 py-5 md:grid-cols-3">
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
            accent="#22d3ee"
            label="AMOS · 1 minute"
            value={formatTemperature(latestAmos, unit)}
            unit={unit}
            detail={
              latestAmos
                ? `15L · ${formatClock(latestAmos.obsTimeUtc)}${
                    latestAmos.displayCadence === "audit_fallback"
                      ? " · audit fallback"
                      : ""
                  }`
                : "awaiting capture"
            }
            count={amosDisplayRows.length}
          />
          <div className="border-l border-white/10 px-4 md:px-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
              Seoul clock
            </p>
            <p className="mt-2 text-2xl font-medium tracking-tight text-white md:text-3xl">
              {formatClock(clockNowMs, true)}
            </p>
            <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
              {latestAmos
                ? latestAmos.displayCadence === "audit_fallback"
                  ? "five-minute audit fallback"
                  : captureOffset(latestAmos)
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
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.16em]">
              <p className="text-orange-300">
                Sunset · {minuteLabel(sunsetMinute)} KST
              </p>
              <p className="mt-1 text-slate-500">
                {dayData === undefined
                  ? "Loading telemetry…"
                  : refreshState.message ||
                    `${
                      metarRows.length + amosDisplayRows.length
                    } observations · ${
                      latestPrediction?.hourlyCurve?.length ?? 0
                    } forecast points`}
              </p>
            </div>
          </div>

          <div
            aria-label="Scrollable 24-hour temperature chart"
            className="relative min-h-[560px] flex-1 overflow-x-auto overscroll-x-contain border border-white/10 bg-[#07111f]/85 shadow-[0_30px_100px_rgba(0,0,0,0.38)]"
            role="region"
            tabIndex={0}
          >
            <div className="h-[68vh] min-h-[560px] w-[2400px] min-w-[2400px] p-3 md:h-[72vh] md:max-h-[900px] md:p-5">
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
            AMOS uses the feed row designated 15L. Five-minute snapshots remain
            available only as an audit fallback for missed minute captures.
          </p>
          <p>
            NOAA TGFTP METAR · KMA AMOS MOBILE FEED · MULTI-PROVIDER FORECAST
          </p>
        </footer>
      </div>
    </main>
  );
}
