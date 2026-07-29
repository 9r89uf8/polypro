"use client";

import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import { useEffect, useMemo, useRef, useState } from "react";

ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  annotationPlugin,
);

const STATION_ICAO = "LEMD";
const STATION_NAME = "Adolfo Suárez Madrid–Barajas";
const MADRID_TIMEZONE = "Europe/Madrid";
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

function madridTodayKey() {
  const parts = getDateParts(
    new Intl.DateTimeFormat("en-US", {
      timeZone: MADRID_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    new Date(),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateKey(dateKey) {
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

function formatDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateKey(dateKey, dayDelta) {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    return dateKey;
  }
  return formatDateKey(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + dayDelta * DAY_MS),
  );
}

function formatDateHeading(dateKey) {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    return dateKey;
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}

function parseLocalMinute(localDateTime) {
  const match = /(?:^|\s)(\d{2}):(\d{2})(?::\d{2})?$/.exec(
    String(localDateTime ?? ""),
  );
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
}

function minuteLabel(totalMinutes, includeMinutes = true) {
  if (!Number.isFinite(totalMinutes)) {
    return "—";
  }
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  if (!includeMinutes && minute === 0) {
    return `${hour12} ${period}`;
  }
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatLocalTime(localDateTime) {
  const minute = parseLocalMinute(localDateTime);
  return minute === null ? "—" : minuteLabel(minute);
}

function formatMadridTime(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochMs));
}

function formatMadridStoredDateTime(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const parts = getDateParts(
    new Intl.DateTimeFormat("en-US", {
      timeZone: MADRID_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    new Date(epochMs),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function madridMinuteNow(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const parts = getDateParts(
    new Intl.DateTimeFormat("en-US", {
      timeZone: MADRID_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    new Date(epochMs),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : null;
}

function temperatureForUnit(row, unit) {
  if (unit === "F") {
    if (Number.isFinite(row?.tempF)) {
      return row.tempF;
    }
    return Number.isFinite(row?.tempC) ? (row.tempC * 9) / 5 + 32 : null;
  }
  return Number.isFinite(row?.tempC) ? row.tempC : null;
}

function celsiusForUnit(tempC, unit) {
  if (!Number.isFinite(tempC)) {
    return null;
  }
  return unit === "F" ? (tempC * 9) / 5 + 32 : tempC;
}

function formatTemperature(value, unit) {
  return Number.isFinite(value) ? `${value.toFixed(1)}°${unit}` : "—";
}

function formatObservationAge(observedAt, nowMs) {
  if (!Number.isFinite(observedAt) || !Number.isFinite(nowMs)) {
    return null;
  }
  const minutes = Math.max(0, Math.floor((nowMs - observedAt) / 60000));
  if (minutes < 1) {
    return "less than a minute ago";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m ago` : `${hours}h ago`;
}

function latestByTimestamp(rows, timestampKey) {
  let latest = null;
  for (const row of rows) {
    if (!Number.isFinite(row?.[timestampKey])) {
      continue;
    }
    if (!latest || row[timestampKey] > latest[timestampKey]) {
      latest = row;
    }
  }
  return latest;
}

function parseMetarTemperature(rawMetar) {
  if (typeof rawMetar !== "string") {
    return null;
  }
  const match = /\b(M?\d{2})\/(?:M?\d{2}|\/\/)\b/.exec(
    rawMetar.toUpperCase(),
  );
  if (!match) {
    return null;
  }
  const negative = match[1].startsWith("M");
  const magnitude = Number(negative ? match[1].slice(1) : match[1]);
  return Number.isFinite(magnitude) ? (negative ? -magnitude : magnitude) : null;
}

function getRaceFirstSeen(row) {
  const seenTimes = [row?.aemetFirstSeenAt, row?.tgftpFirstSeenAt].filter(
    Number.isFinite,
  );
  return seenTimes.length ? Math.min(...seenTimes) : null;
}

function getRaceSource(row) {
  if (
    Number.isFinite(row?.tgftpFirstSeenAt) &&
    (!Number.isFinite(row?.aemetFirstSeenAt) ||
      row.tgftpFirstSeenAt < row.aemetFirstSeenAt)
  ) {
    return "NOAA tgftp METAR";
  }
  if (Number.isFinite(row?.aemetFirstSeenAt)) {
    return "AEMET AMA METAR";
  }
  return "Official METAR";
}

function getRaceRawMetar(row) {
  if (getRaceSource(row).startsWith("NOAA")) {
    return row?.tgftpRawMetar ?? row?.rawMetar ?? row?.aemetRawMetar ?? null;
  }
  return row?.aemetRawMetar ?? row?.rawMetar ?? row?.tgftpRawMetar ?? null;
}

function buildRaceMetarRows(raceRows, date) {
  return raceRows
    .filter(
      (row) =>
        row?.reportDateLocal === date && Number.isFinite(row?.reportTsUtc),
    )
    .map((row) => {
      const rawMetar = getRaceRawMetar(row);
      const tempC = parseMetarTemperature(rawMetar);
      if (!Number.isFinite(tempC)) {
        return null;
      }
      return {
        obsTimeUtc: row.reportTsUtc,
        obsTimeLocal: formatMadridStoredDateTime(row.reportTsUtc),
        reportType: row.reportType ?? "METAR",
        tempC,
        tempF: (tempC * 9) / 5 + 32,
        rawMetar,
        firstSeenAt: getRaceFirstSeen(row),
        liveSource: getRaceSource(row),
        distributionRace: true,
      };
    })
    .filter(Boolean);
}

function mergeMetarRows(storedRows, raceRows) {
  const merged = new Map();
  for (const row of storedRows) {
    merged.set(row.obsTimeUtc, row);
  }
  for (const row of raceRows) {
    const stored = merged.get(row.obsTimeUtc);
    merged.set(row.obsTimeUtc, stored ? { ...row, ...stored } : row);
  }
  return [...merged.values()].sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
}

function buildFreshestAirportReading(metarRows, stationRows) {
  const latestMetar = latestByTimestamp(metarRows, "obsTimeUtc");
  const latestStation = latestByTimestamp(stationRows, "obsTimeUtc");
  const candidates = [
    latestMetar
      ? {
          kind: "metar",
          source:
            latestMetar.liveSource ??
            `Official ${latestMetar.reportType ?? "METAR"}`,
          cadence: latestMetar.distributionRace
            ? "First available AEMET/NOAA report"
            : "Normally every 30 minutes",
          precision: "Whole-degree report",
          priority: 2,
          observedAt: latestMetar.obsTimeUtc,
          observedAtLocal: latestMetar.obsTimeLocal,
          receivedAt:
            latestMetar.firstSeenAt ??
            latestMetar.aemetFirstSeenAt ??
            latestMetar.updatedAt,
          tempC: latestMetar.tempC,
          tempF: latestMetar.tempF,
        }
      : null,
    latestStation
      ? {
          kind: "station",
          source: "AEMET station 3129",
          cadence: "Hourly airport observation",
          precision: "0.1°C precision",
          priority: 1,
          observedAt: latestStation.obsTimeUtc,
          observedAtLocal: latestStation.obsTimeLocal,
          receivedAt: null,
          tempC: latestStation.tempC,
          tempF: latestStation.tempF,
        }
      : null,
  ].filter(Boolean);

  candidates.sort(
    (a, b) =>
      b.observedAt - a.observedAt ||
      b.priority - a.priority,
  );

  return {
    freshest: candidates[0] ?? null,
    latestMetar,
    latestStation,
  };
}

function buildForecastPeak(rows) {
  const usable = rows
    .map((row) => ({
      row,
      minute: parseLocalMinute(row.forecastTimeLocal),
      tempC: row.tempC,
    }))
    .filter(
      (point) => point.minute !== null && Number.isFinite(point.tempC),
    )
    .sort((a, b) => a.minute - b.minute);

  if (!usable.length) {
    return null;
  }

  const maxTempC = Math.max(...usable.map((point) => point.tempC));
  const peakPoints = usable.filter((point) => point.tempC === maxTempC);
  const groups = [];

  for (const point of peakPoints) {
    const current = groups[groups.length - 1];
    if (!current || point.minute - current.endMinute > 90) {
      groups.push({
        startMinute: point.minute,
        endMinute: point.minute,
        points: [point],
      });
    } else {
      current.endMinute = point.minute;
      current.points.push(point);
    }
  }

  const peakTimeLabel = groups
    .map((group) =>
      group.startMinute === group.endMinute
        ? minuteLabel(group.startMinute)
        : `${minuteLabel(group.startMinute)}–${minuteLabel(group.endMinute)}`,
    )
    .join(" / ");

  return {
    maxTempC,
    peakPoints,
    groups,
    peakTimeLabel,
    capturedAt: Math.max(
      ...usable
        .map((point) => point.row.capturedAt)
        .filter(Number.isFinite),
      0,
    ),
  };
}

function buildForecastDataset(rows, unit) {
  const points = rows
    .map((row) => {
      const x = parseLocalMinute(row.forecastTimeLocal);
      const y = temperatureForUnit(row, unit);
      return x === null || !Number.isFinite(y)
        ? null
        : {
            x,
            y,
            kind: "forecast",
            source: "AEMET hourly forecast",
          };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  return points.length
    ? {
        label: "AEMET forecast",
        data: points,
        borderColor: "#f59e0b",
        backgroundColor: "#f59e0b",
        borderWidth: 3,
        borderDash: [9, 6],
        pointRadius: 2.5,
        pointHoverRadius: 6,
        pointHitRadius: 18,
        pointStyle: "triangle",
        tension: 0.32,
        showLine: true,
        order: 3,
      }
    : null;
}

function buildStationDataset(rows, unit) {
  const points = rows
    .map((row) => {
      const x = parseLocalMinute(row.obsTimeLocal);
      const y = temperatureForUnit(row, unit);
      return x === null || !Number.isFinite(y)
        ? null
        : {
            x,
            y,
            kind: "station",
            source: "AEMET station 3129",
          };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  return points.length
    ? {
        label: "Airport station 3129",
        data: points,
        borderColor: "#0f766e",
        backgroundColor: "#0f766e",
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointHitRadius: 18,
        pointStyle: "rectRounded",
        tension: 0.28,
        showLine: true,
        order: 2,
      }
    : null;
}

function buildMetarDataset(rows, unit) {
  const points = rows
    .map((row) => {
      const x = parseLocalMinute(row.obsTimeLocal);
      const y = temperatureForUnit(row, unit);
      return x === null || !Number.isFinite(y)
        ? null
        : {
            x,
            y,
            kind: "metar",
            source:
              row.liveSource ?? `Official ${row.reportType ?? "METAR"}`,
            reportType: row.reportType,
          };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  return points.length
    ? {
        label: "Actual METAR",
        data: points,
        borderColor: "#be123c",
        backgroundColor: "#be123c",
        borderWidth: 2,
        pointRadius: points.map((point) =>
          point.reportType === "SPECI" ? 6 : 4.5,
        ),
        pointHoverRadius: points.map((point) =>
          point.reportType === "SPECI" ? 8 : 7,
        ),
        pointHitRadius: 18,
        pointStyle: "circle",
        tension: 0.18,
        showLine: false,
        order: 1,
      }
    : null;
}

function buildPeakDataset(peak, unit) {
  if (!peak) {
    return null;
  }
  const y = celsiusForUnit(peak.maxTempC, unit);
  return {
    label: "Forecast peak",
    data: peak.peakPoints.map((point) => ({
      x: point.minute,
      y,
      kind: "peak",
      source: "Forecast maximum",
    })),
    borderColor: "#7c2d12",
    backgroundColor: "#fff7ed",
    pointBorderColor: "#7c2d12",
    pointBorderWidth: 3,
    pointRadius: 8,
    pointHoverRadius: 10,
    pointHitRadius: 20,
    pointStyle: "rectRot",
    showLine: false,
    order: 0,
  };
}

function StatusDot({ tone }) {
  const toneClass =
    tone === "live"
      ? "bg-emerald-400 shadow-[0_0_0_5px_rgba(52,211,153,0.16)]"
      : tone === "stale"
        ? "bg-amber-400 shadow-[0_0_0_5px_rgba(251,191,36,0.16)]"
        : "bg-slate-400";
  return <span className={`h-2.5 w-2.5 rounded-full ${toneClass}`} />;
}

export default function MadridDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [unit, setUnit] = useState("C");
  const [dateInput, setDateInput] = useState(date);
  const [nowMs, setNowMs] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const autoRefreshDateRef = useRef(null);

  const isDateValid = isValidDate(date);
  const today = madridTodayKey();
  const isToday = isDateValid && date === today;

  const pollLatestNoaaMetar = useAction("madrid:pollLatestNoaaPublishRace");

  const dayData = useQuery(
    "madrid:getDayStationRows",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const forecastData = useQuery(
    "madrid:getAemetHourlyForecasts",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const stationData = useQuery(
    "madrid:getAemetStationObservations",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const raceData = useQuery(
    "madrid:getRecentPublishRaceReports",
    isDateValid
      ? { stationIcao: STATION_ICAO, limit: 48, routineOnly: false }
      : "skip",
  );

  const storedMetarRows = dayData?.rows ?? [];
  const forecastRows = forecastData?.rows ?? [];
  const stationRows = stationData?.rows ?? [];
  const raceRows = raceData?.rows ?? [];
  const raceMetarRows = useMemo(
    () => buildRaceMetarRows(raceRows, date),
    [date, raceRows],
  );
  const metarRows = useMemo(
    () => mergeMetarRows(storedMetarRows, raceMetarRows),
    [raceMetarRows, storedMetarRows],
  );
  const isLoading =
    dayData === undefined ||
    forecastData === undefined ||
    stationData === undefined ||
    raceData === undefined;

  const forecastPeak = useMemo(
    () => buildForecastPeak(forecastRows),
    [forecastRows],
  );
  const airportReading = useMemo(
    () => buildFreshestAirportReading(metarRows, stationRows),
    [metarRows, stationRows],
  );

  const freshest = airportReading.freshest;
  const freshestTemperature = temperatureForUnit(freshest, unit);
  const latestMetarTemperature = temperatureForUnit(
    airportReading.latestMetar,
    unit,
  );
  const forecastMax = celsiusForUnit(forecastPeak?.maxTempC, unit);
  const observationAge = formatObservationAge(freshest?.observedAt, nowMs);
  const isFresh =
    isToday &&
    Number.isFinite(nowMs) &&
    Number.isFinite(freshest?.observedAt) &&
    nowMs - freshest.observedAt <= 75 * 60 * 1000;
  const readingTone = isFresh ? "live" : freshest ? "stale" : "empty";

  useEffect(() => {
    setDateInput(date);
  }, [date]);

  useEffect(() => {
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!isToday || autoRefreshDateRef.current === date) {
      return;
    }
    autoRefreshDateRef.current = date;
    let cancelled = false;

    async function refreshOnOpen() {
      setSyncMessage("Checking the latest airport METAR…");
      try {
        await pollLatestNoaaMetar({ stationIcao: STATION_ICAO });
        if (!cancelled) {
          setSyncMessage(
            `Live METAR checked at ${formatMadridTime(Date.now())} Madrid time.`,
          );
        }
      } catch {
        if (!cancelled) {
          setSyncMessage(
            "Live METAR check failed; showing the latest stored readings.",
          );
        }
      }
    }

    refreshOnOpen();
    return () => {
      cancelled = true;
    };
  }, [date, isToday, pollLatestNoaaMetar]);

  async function handleRefresh() {
    if (!isToday || isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    setSyncMessage("Refreshing the latest airport METAR…");
    try {
      await pollLatestNoaaMetar({ stationIcao: STATION_ICAO });
      setSyncMessage(
        `Live METAR updated at ${formatMadridTime(Date.now())} Madrid time.`,
      );
    } catch {
      setSyncMessage(
        "Live METAR refresh failed; the latest stored reading remains on screen.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleDateSubmit(event) {
    event.preventDefault();
    if (isValidDate(dateInput)) {
      router.push(`/madrid/day/${dateInput}`);
    }
  }

  const chartData = useMemo(() => {
    const datasets = [
      buildForecastDataset(forecastRows, unit),
      buildStationDataset(stationRows, unit),
      buildMetarDataset(metarRows, unit),
      buildPeakDataset(forecastPeak, unit),
    ].filter(Boolean);
    return { datasets };
  }, [forecastPeak, forecastRows, metarRows, stationRows, unit]);

  const chartOptions = useMemo(() => {
    const annotations = {};
    const maxValue = celsiusForUnit(forecastPeak?.maxTempC, unit);

    if (Number.isFinite(maxValue)) {
      annotations.forecastMaximum = {
        type: "line",
        yMin: maxValue,
        yMax: maxValue,
        borderColor: "rgba(180, 83, 9, 0.7)",
        borderDash: [5, 5],
        borderWidth: 1.5,
        label: {
          display: true,
          content: `Forecast max ${formatTemperature(maxValue, unit)}`,
          position: "end",
          backgroundColor: "#7c2d12",
          color: "#fff7ed",
          font: { size: 11, weight: "600" },
          padding: { x: 8, y: 5 },
          borderRadius: 8,
        },
      };

      forecastPeak.groups.forEach((group, index) => {
        annotations[`peakWindow${index}`] = {
          type: "box",
          xMin: Math.max(0, group.startMinute - 24),
          xMax: Math.min(1440, group.endMinute + 24),
          backgroundColor: "rgba(245, 158, 11, 0.08)",
          borderColor: "rgba(245, 158, 11, 0.22)",
          borderWidth: 1,
        };
      });
    }

    const nowMinute = isToday ? madridMinuteNow(nowMs) : null;
    if (Number.isFinite(nowMinute)) {
      annotations.now = {
        type: "line",
        xMin: nowMinute,
        xMax: nowMinute,
        borderColor: "rgba(15, 23, 42, 0.5)",
        borderWidth: 1.5,
        label: {
          display: true,
          content: "NOW",
          position: "start",
          backgroundColor: "#0f172a",
          color: "#ffffff",
          font: { size: 10, weight: "700" },
          padding: { x: 6, y: 4 },
          borderRadius: 999,
        },
      };
    }

    return {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      layout: {
        padding: { top: 18, right: 8 },
      },
      plugins: {
        annotation: { annotations },
        legend: {
          position: "top",
          align: "start",
          labels: {
            color: "#334155",
            usePointStyle: true,
            pointStyleWidth: 12,
            boxWidth: 10,
            boxHeight: 10,
            padding: 20,
            font: { size: 12, weight: "600" },
            filter(item) {
              return item.text !== "Forecast peak";
            },
          },
        },
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#f8fafc",
          bodyColor: "#e2e8f0",
          padding: 12,
          cornerRadius: 12,
          displayColors: true,
          callbacks: {
            title(items) {
              return items.length
                ? `${minuteLabel(items[0].parsed.x)} Madrid`
                : "";
            },
            label(item) {
              const source = item.raw?.source ?? item.dataset.label;
              return `${source}: ${formatTemperature(item.parsed.y, unit)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 1440,
          border: { display: false },
          grid: {
            color: "rgba(100, 116, 139, 0.12)",
            drawTicks: false,
          },
          ticks: {
            stepSize: 180,
            color: "#64748b",
            padding: 10,
            maxRotation: 0,
            callback(value) {
              return minuteLabel(Number(value), false);
            },
          },
          title: {
            display: true,
            text: "Madrid local time",
            color: "#64748b",
            padding: { top: 12 },
            font: { size: 12, weight: "600" },
          },
        },
        y: {
          border: { display: false },
          grace: "12%",
          grid: {
            color: "rgba(100, 116, 139, 0.12)",
            drawTicks: false,
          },
          ticks: {
            color: "#64748b",
            padding: 10,
            callback(value) {
              return `${Number(value).toFixed(0)}°`;
            },
          },
          title: {
            display: true,
            text: `Temperature (°${unit})`,
            color: "#64748b",
            padding: { bottom: 10 },
            font: { size: 12, weight: "600" },
          },
        },
      },
    };
  }, [forecastPeak, isToday, nowMs, unit]);

  if (!isDateValid) {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-xl rounded-[2rem] border border-rose-200 bg-white p-8 shadow-xl shadow-rose-950/5">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-700">
            Madrid · LEMD
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950">
            Invalid date
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Use a YYYY-MM-DD date in the route.
          </p>
          <Link
            href="/madrid/today"
            className="mt-6 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white"
          >
            Open Madrid today
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-3 py-4 sm:px-6 sm:py-7 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#102c33] px-5 py-6 text-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-amber-300/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-emerald-300/10 blur-3xl" />

          <div className="relative flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/"
                  className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-white/75 transition hover:bg-white/10 hover:text-white"
                >
                  Home
                </Link>
                <span className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                  {STATION_ICAO}
                </span>
                {isToday ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
                    <StatusDot tone="live" />
                    Today
                  </span>
                ) : null}
              </div>

              <p className="mt-6 text-sm font-semibold text-emerald-100/70">
                {STATION_NAME}
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
                {formatDateHeading(date)}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65 sm:text-base">
                Airport temperature outlook with the hourly AEMET forecast,
                the precise station 3129 observations, and official METAR
                actuals on one Madrid-time timeline.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/madrid/day/${shiftDateKey(date, -1)}`}
                  aria-label="Previous day"
                  className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/5 text-lg text-white transition hover:bg-white/15"
                >
                  ←
                </Link>
                <Link
                  href="/madrid/today"
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/15"
                >
                  Today
                </Link>
                <Link
                  href={`/madrid/day/${shiftDateKey(date, 1)}`}
                  aria-label="Next day"
                  className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/5 text-lg text-white transition hover:bg-white/15"
                >
                  →
                </Link>
              </div>

              <form
                onSubmit={handleDateSubmit}
                className="flex flex-wrap items-center gap-2"
              >
                <label htmlFor="madrid-date" className="sr-only">
                  Choose Madrid date
                </label>
                <input
                  id="madrid-date"
                  type="date"
                  value={dateInput}
                  onChange={(event) => setDateInput(event.target.value)}
                  className="h-10 rounded-full border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white outline-none [color-scheme:dark] focus:border-emerald-200/60"
                />
                <button
                  type="submit"
                  className="h-10 rounded-full bg-white px-4 text-sm font-bold text-[#102c33] transition hover:bg-emerald-50"
                >
                  Go
                </button>
              </form>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.9fr_0.9fr]">
          <article className="relative overflow-hidden rounded-[2rem] border border-emerald-900/10 bg-[#f5fffb] p-6 shadow-[0_16px_45px_rgba(15,118,110,0.08)] sm:p-7">
            <div className="absolute right-0 top-0 h-28 w-28 rounded-bl-full bg-emerald-200/25" />
            <div className="relative">
              <div className="flex items-center gap-3">
                <StatusDot tone={readingTone} />
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-900/60">
                  {isToday
                    ? "Freshest airport temperature"
                    : "Latest stored airport temperature"}
                </p>
              </div>
              <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
                <p className="text-5xl font-semibold tracking-[-0.06em] text-emerald-950 sm:text-6xl">
                  {formatTemperature(freshestTemperature, unit)}
                </p>
                <p className="pb-1 text-sm font-semibold text-emerald-900/65">
                  {freshest?.source ?? "Waiting for an airport observation"}
                </p>
              </div>
              <p className="mt-4 text-sm leading-6 text-emerald-950/65">
                {freshest ? (
                  <>
                    Observed at{" "}
                    <span className="font-bold text-emerald-950">
                      {formatLocalTime(freshest.observedAtLocal)} Madrid
                    </span>
                    {isToday && observationAge ? ` · ${observationAge}` : ""}
                    . {freshest.cadence}; {freshest.precision.toLowerCase()}.
                  </>
                ) : (
                  "No airport temperature has been stored for this date."
                )}
              </p>
              {freshest?.receivedAt ? (
                <p className="mt-2 text-xs font-semibold text-emerald-900/45">
                  Feed received {formatMadridTime(freshest.receivedAt)} Madrid
                  time
                </p>
              ) : null}
            </div>
          </article>

          <article className="rounded-[2rem] border border-amber-900/10 bg-[#fffaf0] p-6 shadow-[0_16px_45px_rgba(180,83,9,0.07)] sm:p-7">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-900/55">
              Forecast maximum
            </p>
            <p className="mt-5 text-5xl font-semibold tracking-[-0.055em] text-amber-950">
              {formatTemperature(forecastMax, unit)}
            </p>
            <p className="mt-4 text-sm leading-6 text-amber-950/60">
              Highest point in AEMET&apos;s hourly forecast for this date.
            </p>
            {forecastPeak?.capturedAt ? (
              <p className="mt-2 text-xs font-semibold text-amber-900/45">
                Forecast checked{" "}
                {formatMadridTime(forecastPeak.capturedAt)} Madrid time
              </p>
            ) : null}
          </article>

          <article className="rounded-[2rem] border border-sky-900/10 bg-[#f4faff] p-6 shadow-[0_16px_45px_rgba(3,105,161,0.07)] sm:p-7">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-900/55">
              Forecast peak time
            </p>
            <p className="mt-5 text-3xl font-semibold tracking-[-0.045em] text-sky-950 sm:text-4xl">
              {forecastPeak?.peakTimeLabel ?? "—"}
            </p>
            <p className="mt-4 text-sm leading-6 text-sky-950/60">
              All tied hourly maximum points are highlighted in the chart.
            </p>
          </article>
        </section>

        <section className="overflow-hidden rounded-[2rem] border border-slate-900/10 bg-white/95 shadow-[0_22px_65px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-4 border-b border-slate-900/8 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                24-hour temperature
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                Forecast versus airport actuals
              </h2>
              <p className="mt-1 text-xs font-semibold text-slate-400 sm:hidden">
                Swipe the timeline horizontally →
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                {["C", "F"].map((nextUnit) => (
                  <button
                    key={nextUnit}
                    type="button"
                    onClick={() => setUnit(nextUnit)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition ${
                      unit === nextUnit
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-slate-500 hover:text-slate-950"
                    }`}
                  >
                    °{nextUnit}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={!isToday || isRefreshing}
                className="rounded-full bg-[#102c33] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#17434c] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isRefreshing ? "Refreshing…" : "Refresh live"}
              </button>
            </div>
          </div>

          <div className="px-3 py-4 sm:px-6 sm:py-6">
            <div className="overflow-x-auto">
              <div className="h-[430px] min-w-[820px] sm:h-[500px]">
                {chartData.datasets.length ? (
                  <Line data={chartData} options={chartOptions} />
                ) : (
                  <div className="grid h-full place-items-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center text-sm text-slate-500">
                    {isLoading
                      ? "Loading Madrid forecast and airport observations…"
                      : "No forecast or airport observations are stored for this date."}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid border-t border-slate-900/8 sm:grid-cols-3">
            <div className="border-b border-slate-900/8 px-5 py-4 sm:border-b-0 sm:border-r sm:px-7">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-amber-700">
                Forecast
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                AEMET hourly municipal forecast, with every tied maximum marked.
              </p>
            </div>
            <div className="border-b border-slate-900/8 px-5 py-4 sm:border-b-0 sm:border-r sm:px-7">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">
                Airport station
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                AEMET 3129 is airport-based and precise to 0.1°C, but reported
                hourly.
              </p>
            </div>
            <div className="px-5 py-4 sm:px-7">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-rose-700">
                Actual METAR
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                Official LEMD METAR/SPECI points from the first AEMET or NOAA
                copy seen; normally half-hourly and whole-degree.
              </p>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-2 px-2 pb-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite">
            {syncMessage ||
              (isToday
                ? "Live Convex subscriptions will update this chart as new rows arrive."
                : "Showing stored forecast and observations for the selected date.")}
          </p>
          <p>
            Latest METAR on chart:{" "}
            <span className="font-bold text-slate-700">
              {formatTemperature(latestMetarTemperature, unit)}
            </span>
            {airportReading.latestMetar
              ? ` at ${formatLocalTime(airportReading.latestMetar.obsTimeLocal)}`
              : ""}
          </p>
        </footer>
      </div>
    </main>
  );
}
