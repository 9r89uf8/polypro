"use client";

import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveConvexSiteOrigin } from "../../convex-site";
import {
  buildMetarReleaseMarkers,
  buildPolymarketChartPoints,
} from "../../polymarket-chart";

const STATION_ICAO = "MMMX";
const MEXICO_TIMEZONE = "America/Mexico_City";
const CHART_WIDTH_PX = 2400;
const MINUTE_MS = 60 * 1000;
const CAPMA_MAX_CONTINUOUS_GAP_MS = 90 * 1000;
const POLYMARKET_COLORS = [
  "#38bdf8",
  "#2dd4bf",
  "#4ade80",
  "#a3e635",
  "#facc15",
  "#fb923c",
  "#fb7185",
  "#f472b6",
  "#c084fc",
  "#818cf8",
  "#94a3b8",
];
const POLYMARKET_DASHES = [
  [],
  [8, 4],
  [3, 3],
  [10, 3, 2, 3],
  [1, 3],
  [12, 5],
  [5, 2],
  [8, 3, 2, 3, 2, 3],
  [2, 5],
  [14, 4, 3, 4],
  [6, 6],
];

function conditionTone(conditionKey) {
  const tones = {
    clear: {
      fill: "rgba(251, 191, 36, 0.18)",
      line: "rgba(251, 191, 36, 0.7)",
      text: "#fde68a",
      short: "CLEAR",
    },
    mostly_clear: {
      fill: "rgba(125, 211, 252, 0.13)",
      line: "rgba(125, 211, 252, 0.6)",
      text: "#bae6fd",
      short: "MOSTLY CLR",
    },
    partly_cloudy: {
      fill: "rgba(167, 139, 250, 0.16)",
      line: "rgba(167, 139, 250, 0.68)",
      text: "#ddd6fe",
      short: "PARTLY CLD",
    },
    cloudy: {
      fill: "rgba(148, 163, 184, 0.17)",
      line: "rgba(148, 163, 184, 0.7)",
      text: "#cbd5e1",
      short: "CLOUDY",
    },
    overcast: {
      fill: "rgba(100, 116, 139, 0.28)",
      line: "rgba(148, 163, 184, 0.85)",
      text: "#e2e8f0",
      short: "OVERCAST",
    },
    rain: {
      fill: "rgba(56, 189, 248, 0.21)",
      line: "rgba(56, 189, 248, 0.82)",
      text: "#bae6fd",
      short: "RAIN",
    },
    storm: {
      fill: "rgba(244, 114, 182, 0.2)",
      line: "rgba(244, 114, 182, 0.84)",
      text: "#fbcfe8",
      short: "STORM",
    },
    unknown: {
      fill: "rgba(71, 85, 105, 0.12)",
      line: "rgba(100, 116, 139, 0.48)",
      text: "#94a3b8",
      short: "—",
    },
  };
  return tones[conditionKey] || tones.unknown;
}

function tafPeriodKind(period) {
  const weather = String(period?.weather || "").toUpperCase();
  const cloud = String(period?.cloudSummary || "").toUpperCase();
  if (weather.includes("TS")) {
    return "storm";
  }
  if (
    weather.includes("RA") ||
    weather.includes("DZ") ||
    weather.includes("SH")
  ) {
    return "rain";
  }
  if (cloud.includes("OVC")) {
    return "overcast";
  }
  if (cloud.includes("BKN")) {
    return "cloudy";
  }
  return "unknown";
}

const mexicoNowLinePlugin = {
  id: "mexicoNowLine",
  afterDatasetsDraw(chart, _args, options) {
    if (!options?.display || !Number.isFinite(options.minute)) {
      return;
    }
    const { chartArea, ctx, scales } = chart;
    const x = scales.x.getPixelForValue(options.minute);
    if (x < chartArea.left || x > chartArea.right) {
      return;
    }
    ctx.save();
    ctx.strokeStyle = "rgba(34, 211, 238, 0.6)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.fillStyle = "#67e8f9";
    ctx.font = "600 9px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("NOW", x, chartArea.top + 13);
    ctx.restore();
  },
};

const mexicoHourlyConditionsPlugin = {
  id: "mexicoHourlyConditions",
  afterDraw(chart, _args, options) {
    const hours = Array.isArray(options?.hours) ? options.hours : [];
    if (!options?.display || !hours.length) {
      return;
    }
    const { chartArea, ctx, scales } = chart;
    const railTop = chartArea.top - 73;
    const railHeight = 55;
    ctx.save();
    ctx.fillStyle = "rgba(5, 13, 24, 0.98)";
    ctx.fillRect(
      chartArea.left,
      railTop,
      chartArea.right - chartArea.left,
      railHeight,
    );
    for (const hour of hours) {
      const startMinute = Math.max(0, hour.minute - 30);
      const endMinute = Math.min(1440, hour.minute + 30);
      const left = Math.max(
        chartArea.left,
        scales.x.getPixelForValue(startMinute),
      );
      const right = Math.min(
        chartArea.right,
        scales.x.getPixelForValue(endMinute),
      );
      if (right <= left) {
        continue;
      }
      const tone = conditionTone(hour.conditionKey);
      ctx.fillStyle = tone.fill;
      ctx.fillRect(left + 1, railTop + 1, Math.max(0, right - left - 2), 53);
      ctx.strokeStyle = tone.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left + 1, railTop + 53);
      ctx.lineTo(right - 1, railTop + 53);
      ctx.stroke();
      if (right - left >= 48) {
        ctx.fillStyle = tone.text;
        ctx.font = "600 8px IBM Plex Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          tone.short,
          left + (right - left) / 2,
          railTop + 16,
          Math.max(0, right - left - 5),
        );
        const detail = Number.isFinite(hour.precipitationProbabilityPct)
          ? Math.round(hour.precipitationProbabilityPct) + "% rain"
          : minuteLabel(hour.minute);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "500 8px IBM Plex Mono, monospace";
        ctx.fillText(
          detail,
          left + (right - left) / 2,
          railTop + 35,
          Math.max(0, right - left - 5),
        );
      }
      ctx.strokeStyle = "rgba(148, 163, 184, 0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(right, railTop);
      ctx.lineTo(right, railTop + railHeight);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      chartArea.left,
      railTop,
      chartArea.right - chartArea.left,
      railHeight,
    );
    ctx.fillStyle = "#64748b";
    ctx.font = "500 8px IBM Plex Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      "SMN/CONAGUA MUNICIPAL · VENUSTIANO CARRANZA",
      chartArea.left + 5,
      railTop - 7,
    );
    ctx.restore();
  },
};

const mexicoTafBandsPlugin = {
  id: "mexicoTafBands",
  beforeDatasetsDraw(chart, _args, options) {
    const periods = Array.isArray(options?.periods) ? options.periods : [];
    if (!options?.display || !periods.length) {
      return;
    }
    const { chartArea, ctx, scales } = chart;
    ctx.save();
    for (const period of periods) {
      const left = Math.max(
        chartArea.left,
        scales.x.getPixelForValue(period.startMinute),
      );
      const right = Math.min(
        chartArea.right,
        scales.x.getPixelForValue(period.endMinute),
      );
      if (right <= left) {
        continue;
      }
      const tone = conditionTone(period.kind);
      ctx.fillStyle = tone.fill.replace(/0\.\d+\)/, "0.055)");
      ctx.fillRect(left, chartArea.top, right - left, chartArea.height);
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, options) {
    const periods = Array.isArray(options?.periods) ? options.periods : [];
    if (!options?.display || !periods.length) {
      return;
    }
    const { chartArea, ctx, scales } = chart;
    ctx.save();
    for (const period of periods) {
      const left = Math.max(
        chartArea.left,
        scales.x.getPixelForValue(period.startMinute),
      );
      const right = Math.min(
        chartArea.right,
        scales.x.getPixelForValue(period.endMinute),
      );
      if (right - left < 80 || period.kind === "unknown") {
        continue;
      }
      const tone = conditionTone(period.kind);
      ctx.fillStyle = tone.text;
      ctx.font = "600 8px IBM Plex Mono, monospace";
      ctx.textAlign = "center";
      const probability = Number.isFinite(period.probability)
        ? " " + Math.round(period.probability) + "%"
        : "";
      ctx.fillText(
        "TAF " + tone.short + probability,
        left + (right - left) / 2,
        chartArea.top + 29,
        Math.max(0, right - left - 8),
      );
    }
    ctx.restore();
  },
};

ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  mexicoNowLinePlugin,
  mexicoHourlyConditionsPlugin,
  mexicoTafBandsPlugin,
);

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
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

function mexicoDateKeyForEpoch(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MEXICO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = getDateParts(formatter, new Date(epochMs));
  return [parts.year, parts.month, parts.day].join("-");
}

function mexicoTodayKey() {
  return mexicoDateKeyForEpoch(Date.now());
}

function shiftDateKey(dateKey, deltaDays) {
  if (!isValidDate(dateKey)) {
    return dateKey;
  }
  const parts = dateKey.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays),
  );
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseMinute(localValue) {
  const match = /(?:^|\s)(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(localValue || ""),
  );
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  return hour * 60 + minute + second / 60;
}

function localDateFromString(localValue) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(localValue || ""));
  return match ? match[1] : null;
}

function minuteLabel(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "—";
  }
  const floored = Math.floor(totalMinutes);
  const normalized = ((floored % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return displayHour + ":" + String(minute).padStart(2, "0") + " " + suffix;
}

function mexicoMinuteForEpoch(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MEXICO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = getDateParts(formatter, new Date(epochMs));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : null;
}

function formatMexicoClock(
  epochMs,
  includeSeconds = false,
  fractionalSeconds = false,
) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MEXICO_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds
      ? {
          second: "2-digit",
          ...(fractionalSeconds ? { fractionalSecondDigits: 3 } : {}),
        }
      : {}),
    hour12: true,
  }).format(new Date(epochMs));
}

function formatMexicoDateTime(epochMs, includeSeconds = true) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MEXICO_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  }).format(new Date(epochMs));
}

function formatStoredLocalTime(localValue, includeSeconds = false) {
  const match = /(?:^|\s)(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    String(localValue || ""),
  );
  if (!match) {
    return "—";
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return (
    displayHour +
    ":" +
    String(minute).padStart(2, "0") +
    (includeSeconds ? ":" + String(second).padStart(2, "0") : "") +
    " " +
    suffix
  );
}

function toUnit(valueC, valueF, unit) {
  if (unit === "F" && Number.isFinite(valueF)) {
    return valueF;
  }
  if (unit === "C" && Number.isFinite(valueC)) {
    return valueC;
  }
  if (Number.isFinite(valueC)) {
    return unit === "F"
      ? Math.round(((valueC * 9) / 5) * 10 + 320) / 10
      : valueC;
  }
  return null;
}

function formatTemperature(value, unit, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) + "°" + unit : "—";
}

function formatTemperatureDifference(valueC, unit) {
  if (!Number.isFinite(valueC)) {
    return "—";
  }
  const value = unit === "F" ? (valueC * 9) / 5 : valueC;
  return value.toFixed(1) + "°" + unit;
}

function wholeDegreeSourceDigits(unit) {
  return unit === "C" ? 0 : 1;
}

function formatLag(later, earlier) {
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) {
    return "—";
  }
  const totalSeconds = Math.round((later - earlier) / 1000);
  const sign = totalSeconds < 0 ? "−" : "+";
  const absolute = Math.abs(totalSeconds);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return sign + hours + "h " + String(minutes % 60).padStart(2, "0") + "m";
  }
  return sign + minutes + "m " + String(seconds).padStart(2, "0") + "s";
}

function formatAge(nowMs, epochMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(epochMs)) {
    return "age unavailable";
  }
  const minutes = Math.max(0, Math.round((nowMs - epochMs) / MINUTE_MS));
  if (minutes < 1) {
    return "under 1 minute old";
  }
  if (minutes < 60) {
    return minutes + "m old";
  }
  const hours = Math.floor(minutes / 60);
  return hours + "h " + (minutes % 60) + "m old";
}

function sourceFreshness(
  epochMs,
  nowMs,
  isToday,
  delayedMinutes,
  staleMinutes,
) {
  if (!Number.isFinite(epochMs)) {
    return { status: "waiting", label: "Awaiting data" };
  }
  if (!isToday || !Number.isFinite(nowMs)) {
    return { status: "archive", label: "Stored" };
  }
  const ageMinutes = Math.max(0, (nowMs - epochMs) / MINUTE_MS);
  if (ageMinutes >= staleMinutes) {
    return { status: "stale", label: "Stale" };
  }
  if (ageMinutes >= delayedMinutes) {
    return { status: "delayed", label: "Delayed" };
  }
  return { status: "fresh", label: "Live" };
}

function freshnessClasses(status) {
  const classes = {
    fresh: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
    delayed: "border-amber-300/30 bg-amber-300/10 text-amber-200",
    stale: "border-rose-300/30 bg-rose-300/10 text-rose-200",
    archive: "border-slate-400/20 bg-slate-400/10 text-slate-300",
    waiting: "border-slate-500/20 bg-slate-500/10 text-slate-500",
  };
  return classes[status] || classes.waiting;
}

function collectorPresentation(status) {
  if (!status) {
    return {
      label: "Not run",
      classes: "border-slate-500/20 bg-slate-500/10 text-slate-500",
    };
  }
  const values = {
    ok: {
      label: "Collector OK",
      classes: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
    },
    not_modified: {
      label: "No change",
      classes: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
    },
    fetching: {
      label: "Fetching",
      classes: "border-cyan-300/25 bg-cyan-300/10 text-cyan-200",
    },
    approval_required: {
      label: "Approval required",
      classes: "border-amber-300/25 bg-amber-300/10 text-amber-200",
    },
    error: {
      label: "Collector error",
      classes: "border-rose-300/25 bg-rose-300/10 text-rose-200",
    },
    idle: {
      label: "Idle",
      classes: "border-slate-400/20 bg-slate-400/10 text-slate-300",
    },
  };
  return values[status.status] || values.idle;
}

function latestRow(rows, timeKey) {
  return (
    [...(rows || [])]
      .filter((row) => Number.isFinite(row?.[timeKey]))
      .sort((left, right) => left[timeKey] - right[timeKey])
      .at(-1) || null
  );
}

function maximumRow(rows, valueKey, timeKey) {
  let selected = null;
  for (const row of rows || []) {
    if (!Number.isFinite(row?.[valueKey])) {
      continue;
    }
    if (
      !selected ||
      row[valueKey] > selected[valueKey] ||
      (row[valueKey] === selected[valueKey] && row[timeKey] < selected[timeKey])
    ) {
      selected = row;
    }
  }
  return selected;
}

function forecastPeak(rows) {
  const sorted = [...(rows || [])]
    .filter(
      (row) =>
        Number.isFinite(row?.tempC) && Number.isFinite(row?.forecastTimeUtc),
    )
    .sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc);
  if (!sorted.length) {
    return null;
  }
  const highC = Math.max(...sorted.map((row) => row.tempC));
  const tied = sorted.filter((row) => row.tempC === highC);
  const first = tied[0];
  let last = first;
  for (const row of tied.slice(1)) {
    if (row.forecastTimeUtc - last.forecastTimeUtc <= 90 * MINUTE_MS) {
      last = row;
    } else {
      break;
    }
  }
  return {
    ...first,
    highC,
    highF: toUnit(highC, first.tempF, "F"),
    startTimeLocal: first.forecastTimeLocal,
    endTimeLocal: last.forecastTimeLocal,
    tiedCount: tied.length,
  };
}

function peakWindowLabel(peak) {
  if (!peak) {
    return "—";
  }
  const start = formatStoredLocalTime(peak.startTimeLocal);
  const end = formatStoredLocalTime(peak.endTimeLocal);
  return start === end ? start : start + "–" + end;
}

function buildTafSegments(periods, date) {
  return (periods || [])
    .map((period) => {
      const startDate = localDateFromString(period.timeFromLocal);
      const endDate = localDateFromString(period.timeToLocal);
      if (!startDate || !endDate || date < startDate || date > endDate) {
        return null;
      }
      const startMinute =
        startDate < date ? 0 : parseMinute(period.timeFromLocal);
      const rawEnd = endDate > date ? 1440 : parseMinute(period.timeToLocal);
      const endMinute = rawEnd === 0 && endDate > startDate ? 1440 : rawEnd;
      if (
        !Number.isFinite(startMinute) ||
        !Number.isFinite(endMinute) ||
        endMinute <= startMinute
      ) {
        return null;
      }
      return {
        ...period,
        startMinute,
        endMinute,
        kind: tafPeriodKind(period),
      };
    })
    .filter(Boolean);
}

function buildCapmaChartPoints(rows, unit, sourceRole) {
  const sorted = [...(rows || [])]
    .filter(
      (row) =>
        Number.isFinite(row?.screenTimeUtc) &&
        Number.isFinite(parseMinute(row?.screenTimeLocal)),
    )
    .sort((left, right) => left.screenTimeUtc - right.screenTimeUtc);
  const points = [];
  let previous = null;
  for (const row of sorted) {
    const x = parseMinute(row.screenTimeLocal);
    if (
      previous &&
      row.screenTimeUtc - previous.screenTimeUtc > CAPMA_MAX_CONTINUOUS_GAP_MS
    ) {
      const previousX = parseMinute(previous.screenTimeLocal);
      points.push({
        x: previousX + (x - previousX) / 2,
        y: null,
        sourceRole: "capmaGap",
        gapMs: row.screenTimeUtc - previous.screenTimeUtc,
      });
    }
    const y = Number.isFinite(row.currentTempC)
      ? toUnit(row.currentTempC, row.currentTempF, unit)
      : null;
    points.push({ ...row, x, y, sourceRole });
    previous = row;
  }
  return points;
}

function statusResultLabel(label, settled) {
  if (settled.status === "rejected") {
    return label + " error";
  }
  const status = settled.value?.status || "ok";
  if (status === "cooldown") {
    return label + " current";
  }
  if (status === "not_modified") {
    return label + " unchanged";
  }
  if (status === "approval_required") {
    return label + " approval required";
  }
  if (status === "queued") {
    return label + " queued";
  }
  if (status === "outside_window") {
    return label + " outside window";
  }
  return label + " synced";
}

function SourceCard({
  accent,
  label,
  value,
  detail,
  timing,
  freshness,
  status,
}) {
  const collector = collectorPresentation(status);
  return (
    <article className="min-w-0 bg-[#081321] px-4 py-4 md:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_14px_currentColor]"
            style={{ color: accent, backgroundColor: accent }}
          />
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.19em] text-slate-400">
            {label}
          </p>
        </div>
        <span
          className={
            "shrink-0 border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] " +
            (freshness ? freshnessClasses(freshness.status) : collector.classes)
          }
        >
          {freshness ? freshness.label : collector.label}
        </span>
      </div>
      <p className="mt-3 text-3xl font-medium tracking-[-0.04em] text-white">
        {value}
      </p>
      <p className="mt-2 font-mono text-[10px] leading-4 text-slate-400">
        {detail}
      </p>
      <p className="mt-1 min-h-4 font-mono text-[9px] leading-4 text-slate-600">
        {timing}
      </p>
    </article>
  );
}

function MetricCard({ label, value, detail, tone = "text-white" }) {
  return (
    <article className="min-w-0 bg-[#081321] px-4 py-3.5 md:px-5">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className={"mt-1.5 text-xl font-medium tracking-tight " + tone}>
        {value}
      </p>
      <p className="mt-1 min-h-4 font-mono text-[9px] leading-4 text-slate-500">
        {detail}
      </p>
    </article>
  );
}

const PolymarketProbabilityChart = memo(function PolymarketProbabilityChart({
  series,
  metarRows,
  date,
  isToday,
  currentMinute,
}) {
  const [auditOpen, setAuditOpen] = useState(false);
  const snapshots = series?.snapshots || [];
  const marketDefinitions = useMemo(() => {
    const byId = new Map();
    for (const snapshot of snapshots) {
      for (const probability of snapshot.probabilities || []) {
        if (!byId.has(probability.marketId)) {
          byId.set(probability.marketId, probability);
        }
      }
    }
    return [...byId.values()].sort(
      (left, right) =>
        left.displayOrder - right.displayOrder ||
        left.label.localeCompare(right.label),
    );
  }, [snapshots]);
  const latestSnapshot = snapshots.at(-1) || null;
  const latestProbabilities = [...(latestSnapshot?.probabilities || [])].sort(
    (left, right) =>
      left.displayOrder - right.displayOrder ||
      left.label.localeCompare(right.label),
  );
  const collectionStartMinute = series?.collectionStartMinute ?? 660;
  const collectionEndMinute = series?.collectionEndMinute ?? 1080;
  const chartEndMinute = collectionEndMinute + 2;
  const metarReleaseMarkers = useMemo(
    () =>
      buildMetarReleaseMarkers(
        metarRows,
        date,
        collectionStartMinute,
        chartEndMinute,
      ),
    [chartEndMinute, collectionStartMinute, date, metarRows],
  );
  const chartData = useMemo(
    () => ({
      datasets: marketDefinitions.map((market, index) => ({
        label: market.label,
        data: buildPolymarketChartPoints(snapshots, market.marketId),
        borderColor: POLYMARKET_COLORS[index % POLYMARKET_COLORS.length],
        backgroundColor: POLYMARKET_COLORS[index % POLYMARKET_COLORS.length],
        borderDash: POLYMARKET_DASHES[index % POLYMARKET_DASHES.length],
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        stepped: "after",
        spanGaps: false,
      })),
    }),
    [marketDefinitions, snapshots],
  );
  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      animation: { duration: 180 },
      interaction: {
        mode: "nearest",
        axis: "xy",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: "#cbd5e1",
            boxWidth: 18,
            boxHeight: 2,
            padding: 15,
            font: { family: "IBM Plex Mono, monospace", size: 9 },
          },
        },
        tooltip: {
          mode: "nearest",
          axis: "xy",
          intersect: false,
          backgroundColor: "rgba(3, 10, 20, 0.97)",
          borderColor: "rgba(148, 163, 184, 0.28)",
          borderWidth: 1,
          padding: 12,
          titleColor: "#94a3b8",
          bodyColor: "#f8fafc",
          filter(_item, index) {
            return index === 0;
          },
          callbacks: {
            title(items) {
              if (!items.length) {
                return "";
              }
              const capturedAt = items[0].raw?.capturedAt;
              const time = Number.isFinite(capturedAt)
                ? formatMexicoClock(capturedAt, true)
                : minuteLabel(items[0].parsed.x);
              return date + " · " + time + " Mexico City";
            },
            label(item) {
              return (
                item.dataset.label +
                " probability: " +
                Number(item.parsed.y).toFixed(2).replace(/\.00$/, "") +
                "%"
              );
            },
            afterLabel(item) {
              const raw = item.raw || {};
              const quote = [];
              if (Number.isFinite(raw.yesBestBidPct)) {
                quote.push("Yes bid " + raw.yesBestBidPct.toFixed(2) + "%");
              }
              if (Number.isFinite(raw.yesBestAskPct)) {
                quote.push("Yes ask " + raw.yesBestAskPct.toFixed(2) + "%");
              }
              if (Number.isFinite(raw.yesLastTradePricePct)) {
                quote.push(
                  "Last trade " + raw.yesLastTradePricePct.toFixed(2) + "%",
                );
              }
              return quote.join(" · ");
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: collectionStartMinute,
          max: chartEndMinute,
          border: { color: "rgba(148, 163, 184, 0.2)" },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
          ticks: {
            color: "#64748b",
            stepSize: 60,
            padding: 8,
            font: { family: "IBM Plex Mono, monospace", size: 10 },
            callback(value) {
              return minuteLabel(Number(value));
            },
          },
          title: {
            display: true,
            text: "AMERICA/MEXICO_CITY",
            color: "#64748b",
            font: {
              family: "IBM Plex Mono, monospace",
              size: 10,
              weight: "normal",
            },
          },
        },
        metarDrops: {
          axis: "x",
          type: "linear",
          position: "top",
          display: metarReleaseMarkers.length > 0,
          min: collectionStartMinute,
          max: chartEndMinute,
          afterBuildTicks(scale) {
            scale.ticks = metarReleaseMarkers.map((marker) => ({
              value: marker.x,
            }));
          },
          border: { color: "rgba(248, 250, 252, 0.32)" },
          grid: {
            drawOnChartArea: true,
            tickLength: 8,
            lineWidth: 1,
            color: "rgba(248, 250, 252, 0.12)",
          },
          ticks: {
            autoSkip: false,
            color(context) {
              const marker = metarReleaseMarkers[context.index];
              return marker?.reportType === "SPECI" ? "#fda4af" : "#e2e8f0";
            },
            padding: 5,
            font: { family: "IBM Plex Mono, monospace", size: 8 },
            callback(_value, index) {
              const marker = metarReleaseMarkers[index];
              if (!marker) {
                return "";
              }
              const type =
                marker.reportType +
                (marker.isCorrection ? " COR" : "") +
                (marker.releaseSource === "firstSeen" ? "*" : "");
              return [type, formatMexicoClock(marker.releaseAt, true, true)];
            },
          },
          title: {
            display: true,
            text: "OFFICIAL MMMX METAR / SPECI ARRIVALS",
            color: "#94a3b8",
            padding: { top: 0, bottom: 3 },
            font: {
              family: "IBM Plex Mono, monospace",
              size: 9,
              weight: "normal",
            },
          },
        },
        y: {
          min: 0,
          max: 100,
          border: { color: "rgba(148, 163, 184, 0.2)" },
          grid: { color: "rgba(148, 163, 184, 0.08)" },
          ticks: {
            color: "#64748b",
            stepSize: 10,
            padding: 8,
            callback(value) {
              return Number(value) + "%";
            },
            font: { family: "IBM Plex Mono, monospace", size: 10 },
          },
          title: {
            display: true,
            text: "POLYMARKET YES PROBABILITY",
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
    [
      chartEndMinute,
      collectionStartMinute,
      date,
      metarReleaseMarkers,
    ],
  );
  const collectorAttemptDate = mexicoDateKeyForEpoch(
    series?.collectorStatus?.lastAttemptAt,
  );
  const collectorAttemptMinute = mexicoMinuteForEpoch(
    series?.collectorStatus?.lastAttemptAt,
  );
  const collectorAgeMinutes =
    collectorAttemptDate === date &&
    Number.isFinite(currentMinute) &&
    Number.isFinite(collectorAttemptMinute)
      ? currentMinute - collectorAttemptMinute
      : null;
  const status = (() => {
    if (series === undefined) {
      return {
        label: "Loading",
        classes: "border-slate-400/20 bg-slate-400/10 text-slate-400",
      };
    }
    if (!isToday) {
      return snapshots.length
        ? {
            label: "Stored",
            classes: "border-slate-400/20 bg-slate-400/10 text-slate-300",
          }
        : {
            label: "No samples",
            classes: "border-slate-500/20 bg-slate-500/10 text-slate-500",
          };
    }
    if (
      Number.isFinite(currentMinute) &&
      currentMinute < collectionStartMinute
    ) {
      return {
        label: "Starts 11:00 AM",
        classes: "border-slate-400/20 bg-slate-400/10 text-slate-300",
      };
    }
    if (
      Number.isFinite(currentMinute) &&
      currentMinute > collectionEndMinute
    ) {
      return {
        label: "Window closed",
        classes: "border-slate-400/20 bg-slate-400/10 text-slate-300",
      };
    }
    if (collectorAttemptDate !== date) {
      return {
        label: "Waiting for sample",
        classes: "border-slate-400/20 bg-slate-400/10 text-slate-300",
      };
    }
    if (
      Number.isFinite(collectorAgeMinutes) &&
      collectorAgeMinutes > 2 &&
      series?.collectorStatus?.status !== "error"
    ) {
      return {
        label: "Collector stale",
        classes: "border-amber-300/25 bg-amber-300/10 text-amber-200",
      };
    }
    return collectorPresentation(series?.collectorStatus);
  })();

  return (
    <section
      aria-labelledby="mexico-polymarket-title"
      aria-describedby="mexico-polymarket-description"
      className="border-b border-white/10 py-5"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            id="mexico-polymarket-title"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300"
          >
            Polymarket daily-high probabilities
          </p>
          <h2 className="mt-1 text-xl font-medium text-slate-100">
            Temperature-bucket probability · {date}
          </h2>
          <p
            id="mexico-polymarket-description"
            className="mt-1 max-w-4xl text-xs leading-5 text-slate-500"
          >
            Up to one server-side snapshot per minute from 11:00 AM through 6:00 PM
            Mexico City time. Lines use each market&apos;s published Yes outcome
            price as its implied probability; values are preserved as published
            and are not normalized to total 100%. Hovering follows the nearest
            individual line. The top timeline marks each official report&apos;s exact
            AWC receipt time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              "border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.13em] " +
              status.classes
            }
          >
            {status.label}
          </span>
          {series === undefined ? (
            <span className="border border-slate-500/20 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500">
              Loading market
            </span>
          ) : series.eventUrl ? (
            <a
              href={series.eventUrl}
              target="_blank"
              rel="noreferrer"
              className={
                "border border-sky-300/25 px-2 py-1 font-mono text-[9px] uppercase " +
                "tracking-[0.13em] text-sky-200 transition hover:border-sky-200"
              }
            >
              Open market ↗
            </a>
          ) : (
            <span className="border border-slate-500/20 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-slate-600">
              Market not discovered
            </span>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500">
        <span>{snapshots.length} snapshots</span>
        <span>{marketDefinitions.length} temperature buckets</span>
        <span>{metarReleaseMarkers.length} official report arrivals</span>
        <span>Source · Gamma outcomePrices[Yes]</span>
        {latestSnapshot && (
          <span>
            Latest · {formatMexicoClock(latestSnapshot.capturedAt, true)}
          </span>
        )}
      </div>

      {metarReleaseMarkers.some(
        (marker) => marker.releaseSource === "firstSeen",
      ) && (
        <p className="mb-3 font-mono text-[9px] leading-4 text-slate-500">
          * AWC receipt metadata was unavailable; this marker uses the exact
          application first-seen time.
        </p>
      )}

      <div
        className="relative overflow-x-auto border border-white/10 bg-[#07111f]/90"
        role="region"
        tabIndex={0}
        aria-label="Scrollable Polymarket Mexico City daily-high probability chart"
        aria-describedby="mexico-polymarket-description"
      >
        <div className="h-[480px] min-w-[1050px] p-3 md:p-5">
          {snapshots.length ? <Line data={chartData} options={chartOptions} /> : null}
        </div>
        {series !== undefined && !snapshots.length && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">
                No stored probability snapshots
              </p>
              <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600">
                {isToday
                  ? "Collection is active only during the 11:00 AM–6:00 PM Mexico City window."
                  : "No Polymarket probability samples were stored for this date."}
              </p>
            </div>
          </div>
        )}
        {series === undefined && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
            Loading probability history…
          </div>
        )}
      </div>

      {latestProbabilities.length > 0 && (
        <div className="mt-2 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-3 lg:grid-cols-6">
          {latestProbabilities.map((probability) => (
            <div
              key={probability.marketId}
              className="flex items-baseline justify-between gap-3 bg-[#07111f] px-3 py-2"
            >
              <span className="font-mono text-[9px] text-slate-500">
                {probability.label}
              </span>
              <span className="font-mono text-xs text-slate-100">
                {probability.yesProbabilityPct.toFixed(2).replace(/\.00$/, "")}%
              </span>
            </div>
          ))}
        </div>
      )}
      {snapshots.length > 0 && (
        <details
          className="mt-3 border border-white/10 bg-[#07111f]"
          onToggle={(event) => setAuditOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400 hover:text-slate-200">
            Probability capture audit · {snapshots.length} rows
          </summary>
          {auditOpen && (
            <div
              className="max-h-[520px] overflow-auto border-t border-white/10"
              role="region"
              tabIndex={0}
              aria-label="Polymarket probability capture table"
            >
              <table className="min-w-max border-collapse text-left font-mono text-[9px] text-slate-400">
              <caption className="sr-only">
                Stored Polymarket Yes probabilities by Mexico City capture time
                and temperature bucket.
              </caption>
              <thead className="sticky top-0 z-10 bg-[#0b1727] text-slate-300">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-3 py-2">
                    Mexico City time
                  </th>
                  {marketDefinitions.map((market) => (
                    <th
                      key={market.marketId}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2 text-right"
                    >
                      {market.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => {
                  const probabilitiesByMarket = new Map(
                    (snapshot.probabilities || []).map((probability) => [
                      probability.marketId,
                      probability,
                    ]),
                  );
                  return (
                    <tr
                      key={snapshot.snapshotKey || snapshot.capturedAt}
                      className="border-t border-white/[0.06]"
                    >
                      <th
                        scope="row"
                        className="whitespace-nowrap px-3 py-2 font-normal text-slate-300"
                      >
                        {formatMexicoClock(snapshot.capturedAt, true)}
                      </th>
                      {marketDefinitions.map((market) => {
                        const probability = probabilitiesByMarket.get(
                          market.marketId,
                        );
                        return (
                          <td
                            key={market.marketId}
                            className="whitespace-nowrap px-3 py-2 text-right tabular-nums"
                          >
                            {Number.isFinite(probability?.yesProbabilityPct)
                              ? probability.yesProbabilityPct
                                  .toFixed(2)
                                  .replace(/\.00$/, "") + "%"
                              : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          )}
        </details>
      )}
      {isToday &&
        collectorAttemptDate === date &&
        series?.collectorStatus?.status === "error" &&
        series.collectorStatus.lastError && (
          <p className="mt-2 font-mono text-[9px] text-rose-300/80">
            Collector error · {series.collectorStatus.lastError}
          </p>
        )}
    </section>
  );
});

function ApprovalNotice({ capma }) {
  if (capma?.visible) {
    return null;
  }
  const missing = [
    !capma?.accessApproved ? "image access" : null,
    !capma?.retentionApproved ? "retention" : null,
    !capma?.republicationApproved ? "republication" : null,
  ].filter(Boolean);
  return (
    <section className="mt-4 border border-amber-300/25 bg-amber-300/[0.055] px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-4xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
            CAPMA one-minute displays · approval required
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-100/75">
            TDZ 05 and TDZ 23 remain hidden until access, retention, and public
            republication are all approved server-side. No substitute sensor is
            shown under their labels.
          </p>
        </div>
        <span className="border border-amber-300/25 bg-amber-300/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-amber-200">
          Missing {missing.join(" + ") || "approval"}
        </span>
      </div>
    </section>
  );
}

function resolveCapmaImageUrl(path) {
  const siteUrl = resolveConvexSiteOrigin(
    process.env.NEXT_PUBLIC_CONVEX_URL,
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
  );
  if (typeof path !== "string" || !path.startsWith("/") || !siteUrl) {
    return null;
  }
  try {
    const baseUrl = new URL(siteUrl);
    const imageUrl = new URL(path, baseUrl);
    if (
      baseUrl.protocol !== "https:" ||
      imageUrl.protocol !== "https:" ||
      imageUrl.origin !== baseUrl.origin
    ) {
      return null;
    }
    return imageUrl.toString();
  } catch {
    return null;
  }
}

function LatestCapmaImageViewer({ capma, unit }) {
  if (!capma?.visible) {
    return null;
  }

  const images = ["05", "23"]
    .map((tdz) => {
      const image = capma.latestImages?.[tdz];
      const imageUrl = resolveCapmaImageUrl(image?.path);
      return image && imageUrl && image.contentType === "image/jpeg"
        ? { ...image, imageUrl, tdz }
        : null;
    })
    .filter(Boolean);

  if (!images.length) {
    return null;
  }

  return (
    <section
      aria-labelledby="latest-capma-images-title"
      className="mt-4 border border-white/10 bg-[#07111f]/85"
    >
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-4 py-3.5 md:px-5 [&::-webkit-details-marker]:hidden">
          <span>
            <span
              id="latest-capma-images-title"
              className="block font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300"
            >
              Latest CAPMA display images
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
              Only the current approved JPEG for each TDZ is retained. Expand to
              inspect it.
            </span>
          </span>
          <span className="shrink-0 border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-slate-400">
            {images.map((image) => "TDZ " + image.tdz).join(" + ")}
            <span
              aria-hidden="true"
              className="ml-2 inline-block transition group-open:rotate-180"
            >
              ↓
            </span>
          </span>
        </summary>
        <div className="grid gap-px border-t border-white/10 bg-white/10 lg:grid-cols-2">
          {images.map((image) => {
            const imageWidth = Number.isFinite(image.imageWidth)
              ? image.imageWidth
              : 1366;
            const imageHeight = Number.isFinite(image.imageHeight)
              ? image.imageHeight
              : 768;
            const displayTime = Number.isFinite(image.screenTimeUtc)
              ? formatMexicoDateTime(image.screenTimeUtc, true)
              : formatStoredLocalTime(image.screenTimeLocal, true);
            const capturedIso = Number.isFinite(image.screenTimeUtc)
              ? new Date(image.screenTimeUtc).toISOString()
              : undefined;
            return (
              <figure
                key={image.tdz}
                className="min-w-0 bg-[#07111f] p-4 md:p-5"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <figcaption>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.17em] text-slate-100">
                      CAPMA · TDZ {image.tdz}
                    </p>
                    <p className="mt-1 font-mono text-[9px] text-slate-500">
                      Embedded screen ·{" "}
                      <time dateTime={capturedIso}>{displayTime}</time>
                    </p>
                  </figcaption>
                  <div className="text-right">
                    <p className="text-lg font-medium text-white">
                      {formatTemperature(
                        toUnit(image.currentTempC, undefined, unit),
                        unit,
                        wholeDegreeSourceDigits(unit),
                      )}
                    </p>
                    <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-slate-600">
                      Current display
                    </p>
                  </div>
                </div>
                <a
                  href={image.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  referrerPolicy="no-referrer"
                  aria-label={
                    "Open the latest CAPMA TDZ " +
                    image.tdz +
                    " display image at full size in a new tab"
                  }
                  className="group block overflow-hidden border border-white/10 bg-black/30 outline-none transition hover:border-cyan-300/40 focus-visible:border-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                >
                  {/* Approved Convex image-proxy URLs are intentionally rendered without image optimization. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.imageUrl}
                    alt={
                      "Latest approved CAPMA TDZ " +
                      image.tdz +
                      " runway weather display, captured " +
                      displayTime +
                      " Mexico City time"
                    }
                    width={imageWidth}
                    height={imageHeight}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-auto w-full transition duration-200 group-hover:scale-[1.01]"
                  />
                </a>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] leading-4 text-slate-500">
                  <span>
                    2-minute ·{" "}
                    {formatTemperature(
                      toUnit(image.twoMinuteTempC, undefined, unit),
                      unit,
                      wholeDegreeSourceDigits(unit),
                    )}
                  </span>
                  <span>
                    OCR ·{" "}
                    {Number.isFinite(image.ocrConfidence)
                      ? Math.round(image.ocrConfidence * 100) + "%"
                      : "—"}
                  </span>
                  <span>
                    {imageWidth}×{imageHeight} ·{" "}
                    {Number.isFinite(image.responseBytes)
                      ? Math.round(image.responseBytes / 1024) + " KB"
                      : "size unavailable"}
                  </span>
                  <span className="text-slate-600">
                    Open image for full resolution
                  </span>
                </div>
              </figure>
            );
          })}
        </div>
      </details>
    </section>
  );
}

function CapmaMetarSimilarityCard({ capma, isToday, unit }) {
  if (!capma?.visible || !capma?.metarSimilarity) {
    return null;
  }
  const scope =
    (isToday && capma.metarSimilarity.rolling24h) ||
    capma.metarSimilarity.selectedDay;
  const release = scope?.releaseTime;
  const observation = scope?.observationTime;
  if (!release) {
    return null;
  }
  const hasEarlyResult = Number.isFinite(release.similarityPct);
  const hasBaseline = Number.isFinite(release.displaySimilarityPct);
  const scopeLabel = isToday ? "Rolling 24 hours" : "Selected day";
  const maturityLabel =
    release.maturity === "established"
      ? "Established sample"
      : release.maturity === "provisional"
        ? "Provisional"
        : "Collecting baseline";
  const observationPct = Number.isFinite(observation?.displaySimilarityPct)
    ? observation.displaySimilarityPct
    : observation?.similarityPct;

  return (
    <section
      aria-labelledby="capma-metar-similarity-title"
      className="mt-4 border border-cyan-300/20 bg-cyan-300/[0.045] px-4 py-4 md:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-4xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300/80">
            CAPMA ↔ official METAR / SPECI trust check
          </p>
          <h2
            id="capma-metar-similarity-title"
            className="mt-2 text-lg font-medium text-slate-100 md:text-xl"
          >
            {hasBaseline
              ? "CAPMA is " +
                release.displaySimilarityPct.toFixed(0) +
                "% similar around METAR / SPECI reports"
              : "Collecting CAPMA trust baseline · " +
                release.eligibleReportCount +
                "/" +
                release.minimumReports +
                " reports"}
          </h2>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {hasEarlyResult
              ? release.matchingReportCount +
                " of " +
                release.eligibleReportCount +
                " comparable reports had every accepted before/after CAPMA reading within ±" +
                release.toleranceC +
                " °C."
              : "No official report has a complete live CAPMA bracket yet."}{" "}
            The score waits for one same-TDZ reading on each side, no more than{" "}
            {release.windowMinutes} minutes from the release anchor.
          </p>
        </div>
        <span className="border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-200">
          {scopeLabel} · {maturityLabel}
        </span>
      </div>

      <div className="mt-4 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-5">
        <div className="bg-[#07111f] px-3 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
            Release-window agreement
          </p>
          <p className="mt-1 font-mono text-lg text-cyan-200">
            {hasEarlyResult ? release.similarityPct.toFixed(0) + "%" : "—"}
          </p>
          {!hasBaseline && hasEarlyResult && (
            <p className="mt-1 text-[10px] text-amber-300/75">
              Early result; not yet a trust baseline
            </p>
          )}
        </div>
        <div className="bg-[#07111f] px-3 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
            Reports within ±1 °C
          </p>
          <p className="mt-1 font-mono text-lg text-slate-100">
            {release.matchingReportCount}/{release.eligibleReportCount}
          </p>
        </div>
        <div className="bg-[#07111f] px-3 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
            Mean absolute error
          </p>
          <p className="mt-1 font-mono text-lg text-slate-100">
            {formatTemperatureDifference(release.meanAbsoluteErrorC, unit)}
          </p>
        </div>
        <div className="bg-[#07111f] px-3 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
            Exact report matches
          </p>
          <p className="mt-1 font-mono text-lg text-slate-100">
            {Number.isFinite(release.exactMatchPct)
              ? release.exactMatchPct.toFixed(0) + "%"
              : "—"}
          </p>
        </div>
        <div className="bg-[#07111f] px-3 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
            At observation time
          </p>
          <p className="mt-1 font-mono text-lg text-slate-100">
            {Number.isFinite(observationPct)
              ? observationPct.toFixed(0) + "%"
              : "—"}
          </p>
          <p className="mt-1 text-[10px] text-slate-600">
            {observation?.eligibleReportCount || 0} comparable
          </p>
        </div>
      </div>

      <details className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-5 text-slate-500">
        <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400 hover:text-slate-200">
          How the trust score is calculated
        </summary>
        <p className="mt-2 max-w-5xl">
          The release-window score is centered on AWC&apos;s first receipt time,
          falling back to when this collector first saw the report. That is the
          closest available release proxy, not SENEAM&apos;s unexposed
          originating transmission time. CAPMA uses the embedded display-screen
          timestamp and the large current-temperature field. A reading is
          excluded when its delivery is more than three minutes stale.
          Corrections replace the earlier version of the same observation in the
          percentage, while both raw reports remain in the audit table. The
          separate observation-time percentage tests CAPMA around the
          METAR&apos;s effective observation timestamp.
        </p>
        <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-600">
          Release anchors used · AWC receipt {release.awcReceiptAnchorCount} ·
          app first-seen fallback {release.firstSeenAnchorCount} · pending{" "}
          {release.pendingReportCount} · missing bracket{" "}
          {release.insufficientBracketCount}
        </p>
      </details>
    </section>
  );
}

function TimeCell({
  epoch,
  stored,
  seconds = true,
  fractionalSeconds = false,
  semantics = "Timestamp",
  title,
}) {
  const label = Number.isFinite(epoch)
    ? formatMexicoClock(epoch, seconds, fractionalSeconds)
    : formatStoredLocalTime(stored, seconds);
  const iso = Number.isFinite(epoch)
    ? new Date(epoch).toISOString()
    : undefined;
  const resolvedTitle =
    title ||
    (iso ? semantics + " · stored instant " + iso : semantics || undefined);
  return (
    <time
      className="whitespace-nowrap font-mono text-[10px] text-slate-300"
      dateTime={iso}
      title={resolvedTitle}
    >
      {label}
    </time>
  );
}

export default function MexicoDayPage() {
  const params = useParams();
  const router = useRouter();
  const rawDate = Array.isArray(params?.date) ? params.date[0] : params?.date;
  const date = String(rawDate || "");
  const isDateValid = isValidDate(date);
  const today = mexicoTodayKey();
  const isToday = isDateValid && date === today;
  const previousDate = shiftDateKey(date, -1);
  const nextDate = shiftDateKey(date, 1);

  const [unit, setUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [clockNowMs, setClockNowMs] = useState(null);
  const [refreshState, setRefreshState] = useState({
    active: false,
    message: "",
  });
  const chartScrollRef = useRef(null);
  const autoScrolledDateRef = useRef("");
  const autoRefreshedDateRef = useRef("");

  const dashboard = useQuery(
    "mexico:getDayDashboard",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const polymarketSeries = useQuery(
    "mexicoPolymarket:getDayProbabilities",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const pollAwcMetars = useAction("mexico:pollAwcMetars");
  const pollAwcTaf = useAction("mexico:pollAwcTaf");
  const pollSmnForecast = useAction("mexicoForecastNode:pollSmnHourlyForecast");
  const pollPolymarketProbabilities = useAction(
    "mexicoPolymarket:pollDailyHighProbabilities",
  );
  const requestCapmaRefresh = useMutation("mexicoCapma:requestCapmaRefresh");

  const metarRows = dashboard?.metarRows || [];
  const smnRows = dashboard?.smnRows || [];
  const capmaRows = dashboard?.capma?.rows || [];
  const capma05Rows = useMemo(
    () => capmaRows.filter((row) => row.tdz === "05"),
    [capmaRows],
  );
  const capma23Rows = useMemo(
    () => capmaRows.filter((row) => row.tdz === "23"),
    [capmaRows],
  );
  const capmaLiveTdz = capma05Rows.length
    ? "05"
    : capma23Rows.length
      ? "23"
      : null;
  const capmaLiveRows = capmaLiveTdz === "05" ? capma05Rows : capma23Rows;
  const latestMetar = latestRow(metarRows, "obsTimeUtc");
  const latestCapma05 = latestRow(capma05Rows, "screenTimeUtc");
  const latestCapma23 = latestRow(capma23Rows, "screenTimeUtc");
  const metarMaximum = maximumRow(metarRows, "tempC", "obsTimeUtc");
  const capma05Maximum = maximumRow(
    capma05Rows,
    "currentTempC",
    "screenTimeUtc",
  );
  const capma23Maximum = maximumRow(
    capma23Rows,
    "currentTempC",
    "screenTimeUtc",
  );
  const smnPeak = useMemo(() => forecastPeak(smnRows), [smnRows]);
  const tafGroups = useMemo(
    () =>
      (dashboard?.taf?.temperatureGroups || []).filter(
        (group) => group.date === date,
      ),
    [dashboard?.taf?.temperatureGroups, date],
  );
  const tafMaximum =
    tafGroups.find((group) => group.kind === "maximum") || null;
  const tafSegments = useMemo(
    () => buildTafSegments(dashboard?.taf?.periods, date),
    [dashboard?.taf?.periods, date],
  );
  const hourlyConditions = useMemo(
    () =>
      smnRows
        .map((row) => ({
          ...row,
          minute: parseMinute(row.forecastTimeLocal),
        }))
        .filter((row) => Number.isFinite(row.minute)),
    [smnRows],
  );

  const currentMinute =
    isToday && Number.isFinite(clockNowMs)
      ? mexicoMinuteForEpoch(clockNowMs)
      : null;
  const statuses = dashboard?.collectorStatuses || {};
  const metarFreshness = sourceFreshness(
    latestMetar?.obsTimeUtc,
    clockNowMs,
    isToday,
    65,
    100,
  );
  const capma05Freshness = sourceFreshness(
    latestCapma05?.screenTimeUtc,
    clockNowMs,
    isToday,
    3,
    8,
  );
  const capma23Freshness = sourceFreshness(
    latestCapma23?.screenTimeUtc,
    clockNowMs,
    isToday,
    3,
    8,
  );

  const refreshSources = useCallback(
    async (quiet = false) => {
      if (!isToday || refreshState.active) {
        return;
      }
      setRefreshState({
        active: true,
        message: quiet ? "Syncing live sources…" : "Refreshing live sources…",
      });
      const results = await Promise.allSettled([
        pollAwcMetars({ stationIcao: STATION_ICAO }),
        pollAwcTaf({ stationIcao: STATION_ICAO }),
        pollSmnForecast({ stationIcao: STATION_ICAO }),
        pollPolymarketProbabilities({ stationIcao: STATION_ICAO }),
        requestCapmaRefresh({ stationIcao: STATION_ICAO }),
      ]);
      const labels = [
        "METAR",
        "TAF",
        "SMN/CONAGUA",
        "Polymarket",
        "CAPMA",
      ];
      setRefreshState({
        active: false,
        message: results
          .map((result, index) => statusResultLabel(labels[index], result))
          .join(" · "),
      });
    },
    [
      isToday,
      pollAwcMetars,
      pollAwcTaf,
      pollPolymarketProbabilities,
      pollSmnForecast,
      refreshState.active,
      requestCapmaRefresh,
    ],
  );

  useEffect(() => {
    setInputDate(date);
  }, [date]);

  useEffect(() => {
    setClockNowMs(Date.now());
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isToday) {
      autoRefreshedDateRef.current = "";
      return;
    }
    if (autoRefreshedDateRef.current === date) {
      return;
    }
    autoRefreshedDateRef.current = date;
    void refreshSources(true);
  }, [date, isToday, refreshSources]);

  const chartData = useMemo(() => {
    const datasets = [];
    if (smnRows.length) {
      datasets.push({
        label:
          "SMN/CONAGUA municipal forecast · Venustiano Carranza · 4.8 km from MMMX",
        data: smnRows
          .map((row) => {
            const x = parseMinute(row.forecastTimeLocal);
            const y = toUnit(row.tempC, row.tempF, unit);
            return Number.isFinite(x) && Number.isFinite(y)
              ? { ...row, x, y, sourceRole: "smn" }
              : null;
          })
          .filter(Boolean),
        borderColor: "#c4b5fd",
        backgroundColor: "#c4b5fd",
        pointBackgroundColor: "#1e1b4b",
        pointBorderColor: "#ddd6fe",
        pointBorderWidth: 1.25,
        pointRadius: 3.5,
        pointHoverRadius: 6,
        pointHitRadius: 13,
        pointStyle: "triangle",
        borderWidth: 2.5,
        borderDash: [8, 5],
        tension: 0.24,
        spanGaps: false,
        order: 4,
      });
    }
    if (capmaLiveRows.length) {
      datasets.push({
        label: "CAPMA live temperature · TDZ " + capmaLiveTdz,
        data: buildCapmaChartPoints(capmaLiveRows, unit, "capma"),
        borderColor: "#22d3ee",
        backgroundColor: "#22d3ee",
        borderWidth: 2.1,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 9,
        tension: 0.16,
        spanGaps: false,
        order: 2,
      });
    }
    if (metarRows.length) {
      const metarPoints = metarRows
        .map((row) => {
          const x = parseMinute(row.obsTimeLocal);
          const y = Number.isFinite(row.tempC)
            ? toUnit(row.tempC, row.tempF, unit)
            : null;
          return Number.isFinite(x) && Number.isFinite(y)
            ? { ...row, x, y, sourceRole: "metar" }
            : null;
        })
        .filter(Boolean);
      datasets.push({
        label: "Official MMMX METAR / SPECI · AWC",
        data: metarPoints,
        borderColor: "#f8fafc",
        backgroundColor: "#f8fafc",
        pointBackgroundColor: metarPoints.map((point) =>
          point.reportType === "SPECI" ? "#fb7185" : "#07111f",
        ),
        pointBorderColor: metarPoints.map((point) =>
          point.reportType === "SPECI" ? "#fecdd3" : "#f8fafc",
        ),
        pointBorderWidth: 2,
        pointRadius: metarPoints.map((point) =>
          point.reportType === "SPECI" ? 6 : 5,
        ),
        pointHoverRadius: 8,
        pointHitRadius: 14,
        borderWidth: 2.25,
        tension: 0.06,
        spanGaps: false,
        order: 1,
      });
    }
    if (tafGroups.length) {
      datasets.push({
        label: "Official MMMX TAF temperature groups",
        data: tafGroups
          .map((group) => {
            const x = parseMinute(group.forecastTimeLocal);
            const y = toUnit(group.tempC, group.tempF, unit);
            return Number.isFinite(x) && Number.isFinite(y)
              ? { ...group, x, y, sourceRole: "taf" }
              : null;
          })
          .filter(Boolean),
        showLine: false,
        pointStyle: "rectRot",
        pointRadius: 7,
        pointHoverRadius: 9,
        pointHitRadius: 15,
        pointBorderWidth: 2.5,
        pointBorderColor: "#f9a8d4",
        pointBackgroundColor: "#4a1638",
        borderColor: "#f472b6",
        backgroundColor: "#f472b6",
        order: 0,
      });
    }
    return { datasets };
  }, [capmaLiveRows, capmaLiveTdz, metarRows, smnRows, tafGroups, unit]);

  const chartHasData = chartData.datasets.some(
    (dataset) => dataset.data.length > 0,
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      animation: { duration: 240 },
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      layout: {
        padding: { top: 88, right: 10, bottom: 4, left: 4 },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: "rgba(3, 10, 20, 0.97)",
          borderColor: "rgba(148, 163, 184, 0.28)",
          borderWidth: 1,
          padding: 12,
          titleColor: "#94a3b8",
          bodyColor: "#f8fafc",
          callbacks: {
            title(items) {
              return items.length
                ? date + " · " + minuteLabel(items[0].parsed.x) + " Mexico City"
                : "";
            },
            label(item) {
              const raw = item.raw || {};
              const reportType = raw.reportType ? " · " + raw.reportType : "";
              const condition = raw.conditionText
                ? " · " + raw.conditionText
                : "";
              const tafKind = raw.kind ? " · " + raw.kind.toUpperCase() : "";
              const isWholeDegreeSource =
                raw.sourceRole === "metar" ||
                raw.sourceRole === "capma" ||
                raw.sourceRole === "taf";
              return (
                item.dataset.label +
                ": " +
                formatTemperature(
                  item.parsed.y,
                  unit,
                  isWholeDegreeSource ? wholeDegreeSourceDigits(unit) : 1,
                ) +
                reportType +
                tafKind +
                condition
              );
            },
            afterLabel(item) {
              const raw = item.raw || {};
              if (raw.sourceRole === "metar") {
                return [
                  "AWC receipt: " +
                    formatMexicoClock(raw.initialAwcReceiptTimeUtc, true),
                  "First seen here: " +
                    formatMexicoClock(raw.firstSeenAt, true),
                  "Discovery lag: " +
                    formatLag(raw.firstSeenAt, raw.obsTimeUtc),
                ];
              }
              if (raw.sourceRole === "capma") {
                return [
                  "Embedded screen: " +
                    formatStoredLocalTime(raw.screenTimeLocal, true),
                  "Two-minute display: " +
                    formatTemperature(
                      toUnit(raw.twoMinuteTempC, raw.twoMinuteTempF, unit),
                      unit,
                      wholeDegreeSourceDigits(unit),
                    ),
                  "OCR confidence: " +
                    (Number.isFinite(raw.ocrConfidence)
                      ? Math.round(raw.ocrConfidence * 100) + "%"
                      : "—"),
                ];
              }
              if (raw.sourceRole === "smn") {
                return [
                  Number.isFinite(raw.precipitationProbabilityPct)
                    ? "Rain probability: " +
                      Math.round(raw.precipitationProbabilityPct) +
                      "%"
                    : "Rain probability unavailable",
                  "Municipal forecast · Venustiano Carranza · 4.8 km from MMMX",
                ];
              }
              return raw.rawGroup || "";
            },
          },
        },
        mexicoNowLine: {
          display: isToday,
          minute: currentMinute,
        },
        mexicoHourlyConditions: {
          display: hourlyConditions.length > 0,
          hours: hourlyConditions,
        },
        mexicoTafBands: {
          display: tafSegments.length > 0,
          periods: tafSegments,
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 1440,
          border: { color: "rgba(148, 163, 184, 0.2)" },
          grid: {
            color(context) {
              return Number(context.tick?.value) % 360 === 0
                ? "rgba(148, 163, 184, 0.17)"
                : "rgba(148, 163, 184, 0.06)";
            },
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
          border: { color: "rgba(148, 163, 184, 0.2)" },
          grid: { color: "rgba(148, 163, 184, 0.09)" },
          ticks: {
            color: "#64748b",
            maxTicksLimit: 9,
            padding: 8,
            precision: 1,
            font: {
              family: "IBM Plex Mono, monospace",
              size: 10,
            },
            callback(value) {
              return Number(value).toFixed(1) + "°";
            },
          },
          title: {
            display: true,
            text: "TEMPERATURE · °" + unit,
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
    [currentMinute, date, hourlyConditions, isToday, tafSegments, unit],
  );

  const scrollChartToMinute = useCallback((minute, behavior = "smooth") => {
    const element = chartScrollRef.current;
    if (!element || !Number.isFinite(minute)) {
      return;
    }
    const targetX = (minute / 1440) * CHART_WIDTH_PX;
    const targetLeft = Math.max(
      0,
      Math.min(
        element.scrollWidth - element.clientWidth,
        targetX - element.clientWidth * 0.42,
      ),
    );
    element.scrollTo({ left: targetLeft, behavior });
  }, []);

  useEffect(() => {
    if (
      !isToday ||
      !Number.isFinite(currentMinute) ||
      autoScrolledDateRef.current === date
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollChartToMinute(currentMinute, "auto");
      autoScrolledDateRef.current = date;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentMinute, date, isToday, scrollChartToMinute]);

  function handleDateSubmit(event) {
    event.preventDefault();
    if (isValidDate(inputDate)) {
      router.push("/mexico/day/" + inputDate);
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
            Mexico telemetry unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Use a YYYY-MM-DD date or return to the current MMMX observation day.
          </p>
          <Link
            href="/mexico/today"
            className="mt-6 inline-flex bg-cyan-300 px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-slate-950"
          >
            Open today
          </Link>
        </div>
      </main>
    );
  }

  const smnCapturedAt = latestRow(smnRows, "capturedAt")?.capturedAt;
  const latestMetarValue = Number.isFinite(latestMetar?.tempC)
    ? toUnit(latestMetar.tempC, latestMetar.tempF, unit)
    : null;
  const latestCapma05Value = toUnit(
    latestCapma05?.currentTempC,
    latestCapma05?.currentTempF,
    unit,
  );
  const latestCapma23Value = toUnit(
    latestCapma23?.currentTempC,
    latestCapma23?.currentTempF,
    unit,
  );
  const smnPeakValue = smnPeak
    ? toUnit(smnPeak.highC, smnPeak.highF, unit)
    : null;
  const metarMaxValue = toUnit(metarMaximum?.tempC, metarMaximum?.tempF, unit);
  const tafMaxValue = toUnit(tafMaximum?.tempC, tafMaximum?.tempF, unit);
  const releaseRows = [...metarRows].reverse();
  const capmaAuditRows = [...capmaRows]
    .sort((left, right) => right.screenTimeUtc - left.screenTimeUtc)
    .slice(0, 80);
  const sourceCount =
    metarRows.length + capmaLiveRows.length + smnRows.length + tafGroups.length;

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
      <div className="pointer-events-none absolute left-1/2 top-[-30rem] h-[56rem] w-[76rem] -translate-x-1/2 rounded-full bg-cyan-400/8 blur-[150px]" />
      <div className="pointer-events-none absolute right-[-12rem] top-[22rem] h-[32rem] w-[32rem] rounded-full bg-violet-400/5 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1720px] flex-col px-4 py-5 md:px-8 md:py-7">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="font-mono text-[11px] uppercase tracking-[0.24em] text-cyan-300 transition hover:text-cyan-100"
              >
                MMMX · Benito Juárez
              </Link>
              <span className="h-3 w-px bg-white/15" />
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                <span
                  className={
                    "h-1.5 w-1.5 rounded-full " +
                    (isToday
                      ? "animate-pulse bg-emerald-400 shadow-[0_0_12px_#34d399]"
                      : "bg-slate-600")
                  }
                />
                {isToday ? "Live telemetry" : "Archive"}
              </span>
            </div>
            <h1 className="mt-3 max-w-5xl text-4xl font-medium tracking-[-0.045em] text-white md:text-6xl">
              Mexico City airport weather
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              Official MMMX METAR and TAF, gated one-minute CAPMA runway-display
              readings, and SMN/CONAGUA municipal conditions on one Mexico City
              timeline. Every source keeps its own identity and timestamp.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={"/mexico/day/" + previousDate}
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
                aria-label="Mexico City observation date"
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
              href={"/mexico/day/" + nextDate}
              className="grid h-10 w-10 place-items-center border border-white/10 text-slate-400 transition hover:border-white/30 hover:text-white"
              aria-label="Next day"
            >
              →
            </Link>
            {!isToday && (
              <Link
                href="/mexico/today"
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
                  className={
                    "w-10 font-mono text-xs transition " +
                    (unit === candidate
                      ? "bg-white text-slate-950"
                      : "text-slate-500 hover:text-white")
                  }
                >
                  °{candidate}
                </button>
              ))}
            </div>
            {isToday && (
              <button
                type="button"
                onClick={() => void refreshSources(false)}
                disabled={refreshState.active}
                className="h-10 bg-cyan-300 px-4 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
              >
                {refreshState.active ? "Syncing" : "Sync now"}
              </button>
            )}
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-3 font-mono text-[9px] uppercase tracking-[0.15em] text-slate-500">
          <p>
            Mexico City clock ·{" "}
            <span className="text-slate-200">
              {formatMexicoClock(clockNowMs, true)}
            </span>
          </p>
          <p aria-live="polite">
            {dashboard === undefined
              ? "Loading dashboard…"
              : refreshState.message ||
                sourceCount + " plotted observations and forecast points"}
          </p>
        </div>

        <section
          aria-label="Live source summary"
          className="mt-5 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4"
        >
          <SourceCard
            accent="#f8fafc"
            label="Official METAR / SPECI"
            value={formatTemperature(
              latestMetarValue,
              unit,
              wholeDegreeSourceDigits(unit),
            )}
            detail={
              latestMetar
                ? latestMetar.reportType +
                  " observed " +
                  formatStoredLocalTime(latestMetar.obsTimeLocal, true)
                : "Awaiting an official AWC report"
            }
            timing={
              latestMetar
                ? "AWC receipt " +
                  formatMexicoClock(
                    latestMetar.initialAwcReceiptTimeUtc,
                    true,
                  ) +
                  " · first seen " +
                  formatMexicoClock(latestMetar.firstSeenAt, true)
                : collectorPresentation(statuses.awc_metar).label
            }
            freshness={metarFreshness}
            status={statuses.awc_metar}
          />
          <SourceCard
            accent="#22d3ee"
            label="CAPMA legacy display · TDZ 05"
            value={
              dashboard?.capma?.visible
                ? formatTemperature(
                    latestCapma05Value,
                    unit,
                    wholeDegreeSourceDigits(unit),
                  )
                : "Locked"
            }
            detail={
              latestCapma05
                ? "Embedded screen " +
                  formatStoredLocalTime(latestCapma05.screenTimeLocal, true)
                : dashboard?.capma?.visible
                  ? "Awaiting approved OCR capture"
                  : "Approval-gated whole-degree display"
            }
            timing={
              latestCapma05
                ? formatAge(clockNowMs, latestCapma05.screenTimeUtc) +
                  " · OCR " +
                  Math.round(latestCapma05.ocrConfidence * 100) +
                  "%"
                : collectorPresentation(statuses.capma_tdz05).label
            }
            freshness={dashboard?.capma?.visible ? capma05Freshness : undefined}
            status={statuses.capma_tdz05}
          />
          <SourceCard
            accent="#34d399"
            label="CAPMA legacy display · TDZ 23"
            value={
              dashboard?.capma?.visible
                ? formatTemperature(
                    latestCapma23Value,
                    unit,
                    wholeDegreeSourceDigits(unit),
                  )
                : "Locked"
            }
            detail={
              latestCapma23
                ? "Embedded screen " +
                  formatStoredLocalTime(latestCapma23.screenTimeLocal, true)
                : dashboard?.capma?.visible
                  ? "Awaiting approved OCR capture"
                  : "Approval-gated whole-degree display"
            }
            timing={
              latestCapma23
                ? formatAge(clockNowMs, latestCapma23.screenTimeUtc) +
                  " · OCR " +
                  Math.round(latestCapma23.ocrConfidence * 100) +
                  "%"
                : collectorPresentation(statuses.capma_tdz23).label
            }
            freshness={dashboard?.capma?.visible ? capma23Freshness : undefined}
            status={statuses.capma_tdz23}
          />
          <SourceCard
            accent="#c4b5fd"
            label="SMN/CONAGUA · Venustiano Carranza · 4.8 km"
            value={formatTemperature(smnPeakValue, unit)}
            detail={
              smnPeak
                ? "Municipal high · peak " + peakWindowLabel(smnPeak)
                : "Awaiting Venustiano Carranza guidance"
            }
            timing={
              Number.isFinite(smnCapturedAt)
                ? "SMN/CONAGUA · captured " +
                  formatMexicoDateTime(smnCapturedAt, false) +
                  " · 4.8 km from MMMX"
                : collectorPresentation(statuses.smn_municipal_hourly).label
            }
            status={statuses.smn_municipal_hourly}
          />
        </section>

        <ApprovalNotice capma={dashboard?.capma} />
        <CapmaMetarSimilarityCard
          capma={dashboard?.capma}
          isToday={isToday}
          unit={unit}
        />
        {isToday && (
          <LatestCapmaImageViewer capma={dashboard?.capma} unit={unit} />
        )}

        <section
          aria-labelledby="mexico-outlook-title"
          className="border-b border-white/10 py-5"
        >
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p
                id="mexico-outlook-title"
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-violet-300"
              >
                Daily temperature outlook
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                SMN/CONAGUA municipal hourly guidance is separate from the
                official airport TAF and observed MMMX reports.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  "border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.13em] " +
                  collectorPresentation(statuses.smn_municipal_hourly).classes
                }
              >
                {collectorPresentation(statuses.smn_municipal_hourly).label}
              </span>
              <span
                className={
                  "border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.13em] " +
                  collectorPresentation(statuses.awc_taf).classes
                }
              >
                TAF · {collectorPresentation(statuses.awc_taf).label}
              </span>
            </div>
          </div>
          <div className="grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Official airport TAF high"
              value={formatTemperature(
                tafMaxValue,
                unit,
                wholeDegreeSourceDigits(unit),
              )}
              detail={
                tafMaximum
                  ? formatStoredLocalTime(tafMaximum.forecastTimeLocal, false) +
                    " · " +
                    tafMaximum.rawGroup
                  : "No TX group in the selected MMMX TAF"
              }
              tone="text-pink-200"
            />
            <MetricCard
              label="SMN/CONAGUA municipal high"
              value={formatTemperature(smnPeakValue, unit)}
              detail={
                smnPeak
                  ? "Venustiano Carranza · 4.8 km from MMMX"
                  : "No municipal hourly forecast stored for this date"
              }
              tone="text-violet-200"
            />
            <MetricCard
              label="Municipal peak window"
              value={peakWindowLabel(smnPeak)}
              detail={
                smnPeak
                  ? smnPeak.conditionText +
                    (Number.isFinite(smnPeak.precipitationProbabilityPct)
                      ? " · " +
                        Math.round(smnPeak.precipitationProbabilityPct) +
                        "% rain"
                      : "")
                  : "Peak appears when the hourly curve is available"
              }
              tone="text-rose-200"
            />
            <MetricCard
              label="Observed METAR maximum"
              value={formatTemperature(
                metarMaxValue,
                unit,
                wholeDegreeSourceDigits(unit),
              )}
              detail={
                metarMaximum
                  ? formatStoredLocalTime(metarMaximum.obsTimeLocal, true) +
                    " · " +
                    metarMaximum.reportType +
                    " · " +
                    metarRows.length +
                    " reports"
                  : "No official report temperatures stored"
              }
              tone="text-emerald-200"
            />
          </div>
          {dashboard?.capma?.visible && (
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[9px] leading-4 text-slate-600">
              <span>
                TDZ 05 observed high ·{" "}
                {formatTemperature(
                  toUnit(
                    capma05Maximum?.currentTempC,
                    capma05Maximum?.currentTempF,
                    unit,
                  ),
                  unit,
                  wholeDegreeSourceDigits(unit),
                )}
                {" · "}
                {formatStoredLocalTime(capma05Maximum?.screenTimeLocal, true)}
              </span>
              <span>
                TDZ 23 observed high ·{" "}
                {formatTemperature(
                  toUnit(
                    capma23Maximum?.currentTempC,
                    capma23Maximum?.currentTempF,
                    unit,
                  ),
                  unit,
                  wholeDegreeSourceDigits(unit),
                )}
                {" · "}
                {formatStoredLocalTime(capma23Maximum?.screenTimeLocal, true)}
              </span>
            </div>
          )}
        </section>

        <PolymarketProbabilityChart
          series={polymarketSeries}
          metarRows={metarRows}
          date={date}
          isToday={isToday}
          currentMinute={currentMinute}
        />

        <section className="flex min-h-0 flex-1 flex-col pt-5">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
                00:00—23:59 · America/Mexico_City
              </p>
              <h2 className="mt-1 text-xl font-medium text-slate-100">
                Temperature and weather timeline · {date}
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500">
                <span className="text-white">● METAR / SPECI</span>
                <span className="text-cyan-300">
                  ━ CAPMA live temperature
                  {capmaLiveTdz ? " · TDZ " + capmaLiveTdz : ""}
                </span>
                <span className="text-violet-300">
                  ┄ SMN/CONAGUA municipal · 4.8 km
                </span>
                <span className="text-pink-300">◆ TAF TX / TN</span>
              </div>
              <p className="mt-1 max-w-4xl font-mono text-[9px] leading-4 text-slate-600">
                The top rail preserves SMN/CONAGUA municipal condition phrases
                as hourly categories. Subtle chart bands mark rain, storm,
                broken, or overcast periods explicitly present in the official
                TAF. The plot has one official METAR/SPECI observation series
                and one CAPMA live series. TDZ 05 is the chart source when
                available, with TDZ 23 used only as a whole-day fallback; both
                displays remain in the trust analysis and audit. CAPMA lines
                break when embedded screen times are more than 90 seconds apart.
              </p>
            </div>
            <div className="text-right font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
              <p>{sourceCount} source points</p>
              {isToday && Number.isFinite(currentMinute) && (
                <button
                  type="button"
                  onClick={() => scrollChartToMinute(currentMinute)}
                  className="mt-2 border border-cyan-300/30 px-2.5 py-1 text-cyan-200 transition hover:border-cyan-200 hover:text-cyan-100"
                >
                  Jump to now
                </button>
              )}
            </div>
          </div>

          <div
            ref={chartScrollRef}
            aria-label="Scrollable 24-hour MMMX temperature, TAF, and weather-condition chart"
            className="relative min-h-[570px] flex-1 overflow-x-auto overscroll-x-contain border border-white/10 bg-[#07111f]/90 shadow-[0_30px_100px_rgba(0,0,0,0.38)]"
            role="region"
            tabIndex={0}
          >
            <div className="h-[68vh] min-h-[570px] w-[2400px] min-w-[2400px] p-3 md:h-[72vh] md:max-h-[900px] md:p-5">
              <Line data={chartData} options={chartOptions} />
            </div>
            {dashboard !== undefined && !chartHasData && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="border border-white/10 bg-[#050b14]/95 px-6 py-5 text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">
                    No captured timeline data
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
                    Refresh today to collect AWC and SMN/CONAGUA data. CAPMA
                    remains absent unless every approval gate is active.
                  </p>
                </div>
              </div>
            )}
          </div>
          <p className="mt-2 font-mono text-[9px] text-slate-600 md:hidden">
            Swipe horizontally to inspect the complete local day.
          </p>
        </section>

        <section
          aria-labelledby="metar-release-audit-title"
          className="mt-5 border border-white/10 bg-[#07111f]/85"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 md:px-5">
            <div>
              <p
                id="metar-release-audit-title"
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300"
              >
                Official METAR publication audit
              </p>
              <h2 className="mt-1 text-lg font-medium text-slate-100">
                Observation, AWC receipt, and first-seen time
              </h2>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">
                All clocks are Mexico City local time. Observation and nominal
                report times are shown to the second; AWC receipt and app
                first-seen times preserve their stored milliseconds. AWC receipt
                is provider metadata; first seen is the immutable time this
                collector first received the raw report.
              </p>
            </div>
            {latestMetar && (
              <div className="border border-cyan-300/20 bg-cyan-300/[0.04] px-3 py-2 text-right">
                <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-slate-500">
                  Latest discovery lag
                </p>
                <p className="mt-1 font-mono text-sm text-cyan-100">
                  {formatLag(latestMetar.firstSeenAt, latestMetar.obsTimeUtc)}
                </p>
              </div>
            )}
          </div>
          <div
            className="overflow-x-auto border-t border-white/10"
            role="region"
            tabIndex={0}
            aria-label="Scrollable official MMMX publication audit table"
          >
            <table className="w-full min-w-[1500px] border-collapse text-left">
              <caption className="sr-only">
                Official MMMX METAR and SPECI observation, provider receipt, and
                collector first-seen timestamps
              </caption>
              <thead>
                <tr className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                  <th className="px-4 py-2 font-normal">Observed</th>
                  <th className="px-4 py-2 font-normal">Type</th>
                  <th className="px-4 py-2 font-normal">Temp</th>
                  <th
                    className="px-4 py-2 font-normal"
                    title="AWC often normalizes this field to the next hour. It is not the sensor time."
                  >
                    Nominal report time
                  </th>
                  <th className="px-4 py-2 font-normal">Initial AWC receipt</th>
                  <th className="px-4 py-2 font-normal">AWC receipt lag</th>
                  <th className="px-4 py-2 font-normal">First seen here</th>
                  <th className="px-4 py-2 font-normal">Discovery lag</th>
                  <th className="px-4 py-2 font-normal">Raw report</th>
                </tr>
              </thead>
              <tbody>
                {releaseRows.map((row) => (
                  <tr
                    key={row._id}
                    className="border-t border-white/[0.06] align-top text-xs text-slate-300"
                  >
                    <td className="px-4 py-3">
                      <TimeCell
                        epoch={row.obsTimeUtc}
                        semantics="Official METAR observation time"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-flex border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] " +
                          (row.reportType === "SPECI"
                            ? "border-rose-300/30 bg-rose-300/10 text-rose-200"
                            : "border-white/15 bg-white/[0.04] text-slate-200")
                        }
                      >
                        {row.reportType}
                        {row.isCorrection ? " · COR" : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-white">
                      {Number.isFinite(row.tempC)
                        ? formatTemperature(
                            toUnit(row.tempC, row.tempF, unit),
                            unit,
                            wholeDegreeSourceDigits(unit),
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <TimeCell
                        epoch={row.reportTimeUtc}
                        semantics="AWC nominal report-time metadata; not the observation or publication time"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <TimeCell
                        epoch={row.initialAwcReceiptTimeUtc}
                        fractionalSeconds
                        semantics="Initial AWC provider receipt metadata"
                      />
                      {Number.isFinite(row.latestAwcReceiptTimeUtc) &&
                        row.latestAwcReceiptTimeUtc !==
                          row.initialAwcReceiptTimeUtc && (
                          <p className="mt-1 font-mono text-[8px] text-amber-300/75">
                            latest metadata{" "}
                            {formatMexicoClock(
                              row.latestAwcReceiptTimeUtc,
                              true,
                              true,
                            )}
                          </p>
                        )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[10px] text-slate-400">
                      {formatLag(row.initialAwcReceiptTimeUtc, row.obsTimeUtc)}
                    </td>
                    <td className="px-4 py-3">
                      <TimeCell
                        epoch={row.firstSeenAt}
                        fractionalSeconds
                        semantics="Application first-seen time; this collector received the report"
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[10px] text-cyan-200">
                      {formatLag(row.firstSeenAt, row.obsTimeUtc)}
                    </td>
                    <td
                      className="max-w-[640px] px-4 py-3 font-mono text-[10px] leading-5 text-slate-400"
                      title={row.rawMetar}
                    >
                      {row.rawMetar}
                    </td>
                  </tr>
                ))}
                {!releaseRows.length && (
                  <tr>
                    <td
                      className="px-4 py-8 text-center text-sm text-slate-600"
                      colSpan={9}
                    >
                      No official MMMX reports are stored for this local date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-white/10 px-4 py-3 font-mono text-[9px] leading-4 text-slate-600 md:px-5">
            The nominal AWC report-time field can differ from the raw
            observation time and must not be read as publication time. First
            seen is exact for this collector, not proof of the instant the
            upstream observer transmitted the report.
          </p>
        </section>

        <section className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.45fr)_minmax(420px,0.75fr)]">
          <div className="border border-white/10 bg-[#07111f]/85">
            <div className="px-4 py-4 md:px-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-violet-300">
                Hourly weather conditions
              </p>
              <h2 className="mt-1 text-lg font-medium text-slate-100">
                Temperature, overcast, and rain guidance
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                SMN/CONAGUA municipal forecast for Venustiano Carranza,
                approximately 4.8 km from MMMX. It is context, not an airport
                observation.
              </p>
            </div>
            <div className="overflow-x-auto border-t border-white/10">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-4 py-2 font-normal">Hour</th>
                    <th className="px-4 py-2 font-normal">Temp</th>
                    <th className="px-4 py-2 font-normal">Condition</th>
                    <th className="px-4 py-2 font-normal">Rain chance</th>
                    <th className="px-4 py-2 font-normal">Precip</th>
                    <th className="px-4 py-2 font-normal">Humidity</th>
                    <th className="px-4 py-2 font-normal">Wind</th>
                  </tr>
                </thead>
                <tbody>
                  {smnRows.map((row) => {
                    const tone = conditionTone(row.conditionKey);
                    return (
                      <tr
                        key={row._id}
                        className="border-t border-white/[0.06] text-xs text-slate-300"
                      >
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <TimeCell
                            stored={row.forecastTimeLocal}
                            seconds={false}
                            semantics="SMN/CONAGUA municipal forecast valid time"
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium text-white">
                          {formatTemperature(
                            toUnit(row.tempC, row.tempF, unit),
                            unit,
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="mr-2 inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: tone.line }}
                          />
                          {row.conditionText}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {Number.isFinite(row.precipitationProbabilityPct)
                            ? Math.round(row.precipitationProbabilityPct) + "%"
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {Number.isFinite(row.precipitationMm)
                            ? row.precipitationMm.toFixed(1) + " mm"
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {Number.isFinite(row.humidityPct)
                            ? Math.round(row.humidityPct) + "%"
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {Number.isFinite(row.windSpeedKph)
                            ? Math.round(row.windSpeedKph) +
                              " km/h " +
                              (row.windDirectionText || "")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {!smnRows.length && (
                    <tr>
                      <td
                        className="px-4 py-8 text-center text-sm text-slate-600"
                        colSpan={7}
                      >
                        No SMN/CONAGUA municipal hourly forecast is stored for
                        this date.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-white/10 bg-[#07111f]/85">
            <div className="px-4 py-4 md:px-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-pink-300">
                Official airport TAF
              </p>
              <h2 className="mt-1 text-lg font-medium text-slate-100">
                Forecast periods and temperature groups
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {dashboard?.taf
                  ? "Issued " +
                    formatMexicoDateTime(dashboard.taf.issueTimeUtc, true) +
                    " · first seen " +
                    formatMexicoDateTime(dashboard.taf.firstSeenAt, true)
                  : "No MMMX TAF capture covers this date."}
              </p>
            </div>
            {dashboard?.taf ? (
              <>
                <div className="grid gap-px border-y border-white/10 bg-white/10 sm:grid-cols-2">
                  <MetricCard
                    label="TAF valid from"
                    value={formatMexicoClock(dashboard.taf.validFromUtc, false)}
                    detail={formatMexicoDateTime(
                      dashboard.taf.validFromUtc,
                      false,
                    )}
                  />
                  <MetricCard
                    label="TAF valid through"
                    value={formatMexicoClock(dashboard.taf.validToUtc, false)}
                    detail={formatMexicoDateTime(
                      dashboard.taf.validToUtc,
                      false,
                    )}
                  />
                </div>
                <div className="space-y-2 px-4 py-4 md:px-5">
                  {tafSegments.map((period, index) => {
                    const tone = conditionTone(period.kind);
                    return (
                      <div
                        key={
                          String(period.timeFromUtc) +
                          ":" +
                          String(period.timeToUtc) +
                          ":" +
                          index
                        }
                        className="border border-white/[0.07] bg-white/[0.02] px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-mono text-[10px] text-slate-300">
                            {formatStoredLocalTime(period.timeFromLocal, false)}
                            {"–"}
                            {formatStoredLocalTime(period.timeToLocal, false)}
                          </p>
                          <span
                            className="border px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em]"
                            style={{
                              color: tone.text,
                              borderColor: tone.line,
                              backgroundColor: tone.fill,
                            }}
                          >
                            {period.changeType || "BASE"}
                            {Number.isFinite(period.probability)
                              ? " · " + Math.round(period.probability) + "%"
                              : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          {[period.weather, period.cloudSummary]
                            .filter(Boolean)
                            .join(" · ") ||
                            "No explicit weather or cloud group"}
                        </p>
                      </div>
                    );
                  })}
                  {!tafSegments.length && (
                    <p className="text-xs leading-5 text-slate-600">
                      No TAF change period intersects this local date.
                    </p>
                  )}
                </div>
                <details className="border-t border-white/10">
                  <summary className="cursor-pointer px-4 py-3 font-mono text-[9px] uppercase tracking-[0.15em] text-slate-400 hover:text-slate-200 md:px-5">
                    View raw MMMX TAF
                  </summary>
                  <p className="border-t border-white/[0.06] px-4 py-3 font-mono text-[10px] leading-5 text-slate-400 md:px-5">
                    {dashboard.taf.rawTaf}
                  </p>
                </details>
              </>
            ) : (
              <p className="border-t border-white/10 px-4 py-8 text-center text-sm text-slate-600">
                Refresh today to collect the latest official TAF.
              </p>
            )}
          </div>
        </section>

        <section className="mt-5 border border-white/10 bg-[#07111f]/85">
          <details open={dashboard?.capma?.visible}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300 md:px-5 [&::-webkit-details-marker]:hidden">
              <span>CAPMA OCR audit · latest 80 captures</span>
              <span className="text-slate-500">
                {dashboard?.capma?.visible
                  ? capmaRows.length + " visible rows"
                  : "Approval required"}
              </span>
            </summary>
            {dashboard?.capma?.visible ? (
              <div className="overflow-x-auto border-t border-white/10">
                <table className="w-full min-w-[1180px] border-collapse text-left">
                  <thead>
                    <tr className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
                      <th className="px-4 py-2 font-normal">Display</th>
                      <th className="px-4 py-2 font-normal">Embedded screen</th>
                      <th className="px-4 py-2 font-normal">Current</th>
                      <th className="px-4 py-2 font-normal">2-minute</th>
                      <th className="px-4 py-2 font-normal">First seen</th>
                      <th className="px-4 py-2 font-normal">Relay modified</th>
                      <th className="px-4 py-2 font-normal">Discovery lag</th>
                      <th className="px-4 py-2 font-normal">OCR</th>
                      <th className="px-4 py-2 font-normal">Body hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capmaAuditRows.map((row) => (
                      <tr
                        key={row._id}
                        className="border-t border-white/[0.06] text-xs text-slate-300"
                      >
                        <td className="px-4 py-2.5 font-mono text-[10px] font-semibold text-slate-100">
                          TDZ {row.tdz}
                        </td>
                        <td className="px-4 py-2.5">
                          <TimeCell
                            epoch={row.screenTimeUtc}
                            stored={row.screenTimeLocal}
                            semantics="CAPMA embedded display-screen time"
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium text-white">
                          {formatTemperature(
                            toUnit(row.currentTempC, row.currentTempF, unit),
                            unit,
                            wholeDegreeSourceDigits(unit),
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-300">
                          {formatTemperature(
                            toUnit(
                              row.twoMinuteTempC,
                              row.twoMinuteTempF,
                              unit,
                            ),
                            unit,
                            wholeDegreeSourceDigits(unit),
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <TimeCell
                            epoch={row.firstSeenAt}
                            fractionalSeconds
                            semantics="Application first-seen time for this CAPMA image body"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <TimeCell
                            epoch={row.relayLastModifiedAt}
                            semantics="CAPMA HTTP relay Last-Modified metadata"
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[10px] text-slate-400">
                          {formatLag(row.firstSeenAt, row.screenTimeUtc)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[10px]">
                          {Number.isFinite(row.ocrConfidence)
                            ? Math.round(row.ocrConfidence * 100) + "%"
                            : "—"}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-[9px] text-slate-600">
                          {row.rawHash}
                        </td>
                      </tr>
                    ))}
                    {!capmaAuditRows.length && (
                      <tr>
                        <td
                          className="px-4 py-8 text-center text-sm text-slate-600"
                          colSpan={9}
                        >
                          CAPMA is visible, but no approved captures are stored
                          for this date.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border-t border-white/10 px-4 py-5 md:px-5">
                <p className="max-w-4xl text-sm leading-6 text-slate-500">
                  The server returned no protected CAPMA rows. Access,
                  retention, and republication are independent requirements; the
                  page fails closed when any one is absent.
                </p>
              </div>
            )}
          </details>
        </section>

        <footer className="flex flex-col gap-2 py-5 font-mono text-[9px] leading-5 text-slate-600 md:flex-row md:items-start md:justify-between">
          <p className="max-w-5xl">
            AWC METAR/SPECI is the canonical official airport observation and
            uses whole-degree temperature. CAPMA values, when approved, are
            separate whole-degree legacy telemetric-AWOS TDZ display readings;
            they are not relabeled as the 2022 AWOS/PIIMET system. SMN/CONAGUA
            guidance is municipal forecast context from Venustiano Carranza, 4.8
            km from MMMX. No series is interpolated into another sensor.
          </p>
          <p className="shrink-0 md:text-right">
            <a
              href="https://aviationweather.gov/data/api/"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300/80 underline decoration-cyan-300/30 underline-offset-2 transition hover:text-cyan-200"
            >
              AWC API
            </a>
            {" · "}
            <a
              href="https://smn.conagua.gob.mx/es/web-service-api"
              target="_blank"
              rel="noreferrer"
              className="text-violet-300/80 underline decoration-violet-300/30 underline-offset-2 transition hover:text-violet-200"
            >
              SMN/CONAGUA service
            </a>
            {" · "}
            <a
              href="https://www.gob.mx/seneam/acciones-y-programas/centro-de-analisis-y-pronosticos-capma"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-300/80 underline decoration-emerald-300/30 underline-offset-2 transition hover:text-emerald-200"
            >
              SENEAM/CAPMA portal
            </a>
            <br />
            America/Mexico_City
          </p>
        </footer>
      </div>
    </main>
  );
}
