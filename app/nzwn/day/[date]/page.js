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
import { useAction, useMutation, useQuery } from "convex/react";
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

function formatDelta(value, unit) {
  if (value === undefined || value === null) {
    return "—";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}°${unit}`;
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

function formatStoredLocalTime(tsLocal) {
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
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
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

function formatAucklandAxisDateTime(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: AUCKLAND_TIMEZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: true,
  });
  const parts = getDateParts(formatter, new Date(epochMs));
  return `${parts.month}/${parts.day} ${parts.hour} ${parts.dayPeriod?.toUpperCase() ?? ""}`.trim();
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

function formatAucklandClock(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: AUCKLAND_TIMEZONE,
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

function formatNoteCreatedAt(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Date(epochMs).toLocaleString();
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

function getTrendPointColor(changeDirection) {
  if (changeDirection === "up") {
    return "#15803d";
  }
  if (changeDirection === "down") {
    return "#dc2626";
  }
  if (changeDirection === "same") {
    return "#6b7280";
  }
  return "#0f4c81";
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

function computeDisplayedRaceState(row) {
  const preflightSeenAt = Number.isFinite(row?.preflightFirstSeenAt)
    ? row.preflightFirstSeenAt
    : null;
  const tgftpSeenAt = Number.isFinite(row?.tgftpFirstSeenAt)
    ? row.tgftpFirstSeenAt
    : null;

  if (preflightSeenAt === null || tgftpSeenAt === null) {
    return { winner: null, leadMs: null };
  }
  if (preflightSeenAt === tgftpSeenAt) {
    return { winner: "tie", leadMs: 0 };
  }
  if (preflightSeenAt < tgftpSeenAt) {
    return { winner: "preflight", leadMs: tgftpSeenAt - preflightSeenAt };
  }
  return { winner: "tgftp", leadMs: preflightSeenAt - tgftpSeenAt };
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

function buildMetServiceDataset(metServiceRows, currentReading, unit, selectedDate) {
  const points = metServiceRows
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

  // Append the live current reading if it's for the selected date and
  // newer than the latest stored row (avoids duplicate).
  if (
    currentReading?.status === "ok" &&
    currentReading.observedAtLocal?.slice(0, 10) === selectedDate
  ) {
    const liveX = parseMinute(currentReading.observedAtLocal);
    const liveY = unit === "C" ? currentReading.tempC : currentReading.tempF;
    if (liveX !== null && Number.isFinite(liveY)) {
      const lastX = points.length ? points[points.length - 1].x : -1;
      if (liveX > lastX) {
        points.push({ x: liveX, y: liveY });
      }
    }
  }

  if (!points.length) {
    return null;
  }

  return {
    label: "MetService AWS",
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

function buildMetServiceForecastDataset(forecastRows, unit) {
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
    label: "MetService Hourly Forecast",
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

function buildForecastPeakByDate(rows) {
  const rowsByDate = new Map();
  for (const row of rows) {
    if (!row?.date || !Number.isFinite(row?.tempC) || !Number.isFinite(row?.validTimeUtc)) {
      continue;
    }
    if (!rowsByDate.has(row.date)) {
      rowsByDate.set(row.date, []);
    }
    rowsByDate.get(row.date).push(row);
  }

  const peaks = new Map();
  for (const [dayDate, dayRows] of rowsByDate.entries()) {
    const sortedRows = [...dayRows].sort((a, b) => a.validTimeUtc - b.validTimeUtc);
    let maxTempC = Number.NEGATIVE_INFINITY;
    for (const row of sortedRows) {
      if (row.tempC > maxTempC) {
        maxTempC = row.tempC;
      }
    }
    if (!Number.isFinite(maxTempC)) {
      continue;
    }

    let peakWindow = null;
    for (const row of sortedRows) {
      if (row.tempC !== maxTempC) {
        if (peakWindow) {
          break;
        }
        continue;
      }

      if (!peakWindow) {
        peakWindow = {
          date: dayDate,
          startValidTimeUtc: row.validTimeUtc,
          endValidTimeUtc: row.validTimeUtc,
          startValidTimeLocal: row.validTimeLocal,
          endValidTimeLocal: row.validTimeLocal,
          tempC: row.tempC,
          tempF: row.tempF,
          phrase: row.phrase ?? null,
        };
        continue;
      }

      if (row.validTimeUtc - peakWindow.endValidTimeUtc <= 90 * 60 * 1000) {
        peakWindow.endValidTimeUtc = row.validTimeUtc;
        peakWindow.endValidTimeLocal = row.validTimeLocal;
        continue;
      }

      break;
    }

    if (peakWindow) {
      peaks.set(dayDate, peakWindow);
    }
  }

  return peaks;
}

function formatPeakWindow(peak) {
  if (!peak?.startValidTimeLocal) {
    return "—";
  }
  const startLabel = formatStoredLocalTime(peak.startValidTimeLocal);
  const endLabel =
    peak.endValidTimeLocal && peak.endValidTimeLocal !== peak.startValidTimeLocal
      ? formatStoredLocalTime(peak.endValidTimeLocal)
      : null;
  return endLabel ? `${startLabel} to ${endLabel}` : startLabel;
}

export default function NzwnDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [displayUnit, setDisplayUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [liveMessage, setLiveMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState(null);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const [weatherPanel, setWeatherPanel] = useState(null);
  const [weatherPanelError, setWeatherPanelError] = useState("");
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const inFlightRef = useRef(false);
  const backfilledDateRef = useRef("");
  const weatherRequestRef = useRef(0);

  const isDateValid = isValidDate(date);
  const aucklandTodayDate = aucklandTodayKey();
  const isToday = isDateValid && date === aucklandTodayDate;
  const quickPreviousDates = useMemo(() => buildPreviousDateKeys(date, 2), [date]);

  const backfillDay = useAction("preflight:backfillDayStationMessages");
  const pollLatest = useAction("preflight:pollLatestStationMetar");
  const loadNzwnWeather = useAction("nzwnWeather:getDayPageWeather");
  const deleteNote = useMutation("notes:deleteNote");

  const dayData = useQuery(
    "preflight:getDayStationRows",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const metServiceData = useQuery(
    "nzwnWeather:getMetServiceObservations",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const metServiceForecastData = useQuery(
    "nzwnWeather:getMetServiceHourlyForecasts",
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
  const forecastTrendData = useQuery(
    "nzwnWeather:getForecastTrend",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          targetDate: date,
        }
      : "skip",
  );
  const stationNotes = useQuery(
    "notes:listNotes",
    isNotesOpen
      ? {
          stationIcao: STATION_ICAO,
        }
      : "skip",
  );

  const forecastTrendRows = forecastTrendData?.rows ?? [];
  const rows = dayData?.rows ?? [];
  const summary = dayData?.summary ?? null;
  const metServiceRows = metServiceData?.rows ?? [];
  const metServiceForecastRows = metServiceForecastData?.rows ?? [];
  const raceRows = raceData?.rows ?? [];
  const displayedRaceRows = useMemo(
    () =>
      raceRows.map((row) => ({
        ...row,
        displayRace: computeDisplayedRaceState(row),
      })),
    [raceRows],
  );
  const latestTemp = displayUnit === "C" ? summary?.latestTempC : summary?.latestTempF;
  const maxTemp = displayUnit === "C" ? summary?.maxTempC : summary?.maxTempF;
  const minTemp = displayUnit === "C" ? summary?.minTempC : summary?.minTempF;
  const currentReading = weatherPanel?.currentReading ?? null;
  const weatherForecast = weatherPanel?.forecast ?? null;
  const weatherForecastDays = weatherForecast?.days ?? [];
  const weatherHourly = weatherPanel?.hourly ?? null;
  const weatherHourlyRows = weatherHourly?.rows ?? [];
  const selectedDateForecast = weatherPanel?.selectedDateForecast ?? null;

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
      setWeatherPanel(null);
      setWeatherPanelError("");
      setIsWeatherLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = weatherRequestRef.current + 1;
    weatherRequestRef.current = requestId;
    setIsWeatherLoading(true);

    async function loadWeatherPanel() {
      try {
        const result = await loadNzwnWeather({ date });
        if (!cancelled && weatherRequestRef.current === requestId) {
          setWeatherPanel(result);
          setWeatherPanelError("");
        }
      } catch (error) {
        console.error(error);
        if (!cancelled && weatherRequestRef.current === requestId) {
          const message = error instanceof Error ? error.message : String(error);
          setWeatherPanel(null);
          setWeatherPanelError(message);
        }
      } finally {
        if (!cancelled && weatherRequestRef.current === requestId) {
          setIsWeatherLoading(false);
        }
      }
    }

    loadWeatherPanel();

    return () => {
      cancelled = true;
    };
  }, [date, isDateValid, loadNzwnWeather]);

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
  }, [date, isDateValid, isToday, backfillDay, pollLatest]);

  async function handleRefreshNow() {
    if (!isDateValid || inFlightRef.current) {
      return;
    }

    setIsRefreshing(true);
    inFlightRef.current = true;
    const weatherRequestId = weatherRequestRef.current + 1;
    weatherRequestRef.current = weatherRequestId;
    setIsWeatherLoading(true);
    try {
      const [officialResult, weatherResult] = await Promise.allSettled([
        (async () => {
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

          return messages.join(" ");
        })(),
        loadNzwnWeather({ date }),
      ]);

      if (officialResult.status === "fulfilled") {
        setLiveMessage(officialResult.value);
      } else {
        console.error(officialResult.reason);
        const message =
          officialResult.reason instanceof Error
            ? officialResult.reason.message
            : String(officialResult.reason);
        setLiveMessage(`Manual refresh failed: ${message}`);
      }

      if (weatherResult.status === "fulfilled") {
        if (weatherRequestRef.current === weatherRequestId) {
          setWeatherPanel(weatherResult.value);
          setWeatherPanelError("");
        }
      } else {
        console.error(weatherResult.reason);
        if (weatherRequestRef.current === weatherRequestId) {
          const message =
            weatherResult.reason instanceof Error
              ? weatherResult.reason.message
              : String(weatherResult.reason);
          setWeatherPanelError(message);
        }
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setLiveMessage(`Manual refresh failed: ${message}`);
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
      if (weatherRequestRef.current === weatherRequestId) {
        setIsWeatherLoading(false);
      }
    }
  }

  async function handleDeleteNote(note) {
    const label = note.title || note.body?.slice(0, 60) || "this note";
    const confirmed = window.confirm(`Delete ${label}?`);
    if (!confirmed) {
      return;
    }

    setDeletingNoteId(note._id);
    try {
      await deleteNote({ noteId: note._id });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`Delete failed: ${message}`);
    } finally {
      setDeletingNoteId(null);
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
    () => {
      const datasets = [];
      if (rows.length) {
        datasets.push(buildLineDataset(rows, displayUnit));
      }
      const metDs = buildMetServiceDataset(metServiceRows, currentReading, displayUnit, date);
      if (metDs) {
        datasets.push(metDs);
      }
      const metFcDs = buildMetServiceForecastDataset(metServiceForecastRows, displayUnit);
      if (metFcDs) {
        datasets.push(metFcDs);
      }
      return { datasets };
    },
    [rows, displayUnit, metServiceRows, metServiceForecastRows, currentReading, date],
  );
  const chartWidthPx = useMemo(() => {
    const hasLiveMetServicePoint =
      currentReading?.status === "ok" &&
      currentReading.observedAtLocal?.slice(0, 10) === date;
    const pointCount = Math.max(
      rows.length,
      metServiceRows.length + (hasLiveMetServicePoint ? 1 : 0),
      24,
    );
    return Math.min(2200, Math.max(840, pointCount * 34));
  }, [
    rows.length,
    metServiceRows.length,
    currentReading?.status,
    currentReading?.observedAtLocal,
    date,
  ]);

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
          ticks: {
            stepSize: 0.5,
          },
        },
      },
    }),
    [displayUnit],
  );

  const forecastPeakByDate = useMemo(
    () => buildForecastPeakByDate(weatherHourlyRows),
    [weatherHourlyRows],
  );
  const selectedForecastPeak = forecastPeakByDate.get(date) ?? null;
  const todayForecastPeak =
    forecastPeakByDate.get(weatherPanel?.todayDate ?? aucklandTodayDate) ?? null;
  const forecastPeak = selectedForecastPeak ?? todayForecastPeak;
  const forecastTrendChartPoints = useMemo(
    () =>
      forecastTrendRows
        .filter((row) => Number.isFinite(row.maxTempC) && Number.isFinite(row.capturedAt))
        .map((row) => {
          const deltaC = row.deltaC ?? null;
          let changeDirection = null;
          if (deltaC !== null) {
            if (deltaC > 0) {
              changeDirection = "up";
            } else if (deltaC < 0) {
              changeDirection = "down";
            } else {
              changeDirection = "same";
            }
          }

          return {
            x: row.capturedAt,
            y: displayUnit === "C" ? row.maxTempC : (row.maxTempC * 9) / 5 + 32,
            capturedAtLocal: row.capturedAtLocal,
            delta:
              deltaC === null
                ? null
                : displayUnit === "C"
                  ? deltaC
                  : (deltaC * 9) / 5,
            changeDirection,
          };
        })
        .filter((row) => Number.isFinite(row.y)),
    [displayUnit, forecastTrendRows],
  );
  const forecastTrendSummary = useMemo(() => {
    if (!forecastTrendChartPoints.length) {
      return null;
    }

    let minPoint = forecastTrendChartPoints[0];
    let maxPoint = forecastTrendChartPoints[0];
    let changeCount = 0;
    for (const point of forecastTrendChartPoints) {
      if (point.y < minPoint.y) {
        minPoint = point;
      }
      if (point.y > maxPoint.y) {
        maxPoint = point;
      }
      if (point.delta !== null && Math.abs(point.delta) > 0.0001) {
        changeCount += 1;
      }
    }

    const firstPoint = forecastTrendChartPoints[0];
    const latestPoint = forecastTrendChartPoints[forecastTrendChartPoints.length - 1];
    return {
      firstPoint,
      latestPoint,
      minPoint,
      maxPoint,
      pointCount: forecastTrendChartPoints.length,
      changeCount,
      netDelta: latestPoint.y - firstPoint.y,
    };
  }, [forecastTrendChartPoints]);
  const officialTrendMaxC = forecastTrendData?.actualMaxC ?? summary?.maxTempC ?? null;
  const officialTrendMax =
    officialTrendMaxC === null
      ? null
      : displayUnit === "C"
        ? officialTrendMaxC
        : (officialTrendMaxC * 9) / 5 + 32;
  const officialTrendMaxAtLocal = summary?.maxTempAtLocal ?? null;
  const forecastTrendChartData = useMemo(
    () => ({
      datasets: [
        {
          label: "Predicted High",
          data: forecastTrendChartPoints,
          borderColor: "#0f4c81",
          backgroundColor: "#0f4c81",
          pointRadius: 4,
          pointHoverRadius: 6,
          pointHitRadius: 18,
          pointBackgroundColor: forecastTrendChartPoints.map((point) =>
            getTrendPointColor(point.changeDirection),
          ),
          pointBorderColor: forecastTrendChartPoints.map((point) =>
            getTrendPointColor(point.changeDirection),
          ),
          pointBorderWidth: 1.5,
          borderWidth: 2,
          stepped: true,
          tension: 0,
          showLine: true,
        },
      ],
    }),
    [forecastTrendChartPoints],
  );
  const forecastTrendChartOptions = useMemo(
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
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              if (!items.length) {
                return "";
              }
              return formatStoredLocalDateTime(items[0].raw?.capturedAtLocal);
            },
            label(item) {
              return `Predicted high ${item.parsed.y.toFixed(1)}°${displayUnit}`;
            },
            afterLabel(item) {
              const delta = item.raw?.delta;
              return delta === null || delta === undefined
                ? ""
                : `Change ${formatDelta(delta, displayUnit)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          ticks: {
            callback(value) {
              return formatAucklandAxisDateTime(Number(value));
            },
          },
        },
        y: {
          title: { display: true, text: `Predicted High (°${displayUnit})` },
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
            <Link
              href="/nzwn/forecast-accuracy"
              className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:border-sky-400"
            >
              Forecast Accuracy
            </Link>
            <button
              type="button"
              onClick={handleRefreshNow}
              disabled={isRefreshing}
              className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing..." : "Refresh Current Data"}
            </button>
            {isToday ? (
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-emerald-800">
                Live official ingest enabled
              </span>
            ) : null}
          </div>

          <div className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
            <span className="font-semibold uppercase tracking-[0.16em] text-sky-800">
              Wellington Time
            </span>
            <span className="font-medium">{formatAucklandClock(clockNowMs)}</span>
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
              {currentReading?.status === "ok"
                ? formatTemp(
                    displayUnit === "C" ? currentReading.tempC : currentReading.tempF,
                    displayUnit,
                  )
                : "—"}
            </p>
            <p className="mt-2 text-sm text-black/65">
              {currentReading?.observedAtLocal
                ? `MetService airport current at ${formatStoredLocalDateTime(
                    currentReading.observedAtLocal,
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
              <h2 className="text-xl font-semibold text-foreground">NZWN Notes</h2>
              <p className="mt-1 text-sm text-black/60">
                Station-scoped notes tagged `{STATION_ICAO}` from the shared notes
                workspace.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsNotesOpen((current) => !current)}
                className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent"
              >
                {isNotesOpen ? "Hide NZWN Notes" : "Show NZWN Notes"}
              </button>
              <Link
                href={`/notes?stationIcao=${STATION_ICAO}`}
                className="rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black transition hover:border-black"
              >
                Open Notes Workspace
              </Link>
            </div>
          </div>

          {isNotesOpen ? (
            <div className="mt-4">
              {stationNotes === undefined ? (
                <p className="text-sm text-black/65">Loading NZWN notes...</p>
              ) : stationNotes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-black/15 bg-black/[0.02] px-4 py-5 text-sm text-black/55">
                  No notes tagged `{STATION_ICAO}` yet. Save one from the notes
                  workspace with station `{STATION_ICAO}`.
                </div>
              ) : (
                <div className="grid gap-4">
                  {stationNotes.map((note) => (
                    <article
                      key={note._id}
                      className="rounded-2xl border border-black/10 bg-white/75 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-black/55">
                        <span>{formatNoteCreatedAt(note.createdAt)}</span>
                        <span className="inline-flex rounded-full bg-sky-50 px-2 py-1 text-[11px] text-sky-800">
                          {STATION_ICAO}
                        </span>
                      </div>
                      {note.title ? (
                        <h3 className="mt-2 text-lg font-semibold text-black">
                          {note.title}
                        </h3>
                      ) : null}
                      {note.body ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-black/80">
                          {note.body}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDeleteNote(note)}
                          disabled={deletingNoteId === note._id}
                          className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingNoteId === note._id ? "Deleting..." : "Delete Note"}
                        </button>
                      </div>
                      {note.images.length > 0 ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {note.images.map((image, imageIndex) =>
                            image.url ? (
                              <a
                                key={`${note._id}-${image.storageId}`}
                                href={image.url}
                                target="_blank"
                                rel="noreferrer"
                                className="overflow-hidden rounded-xl border border-black/10 bg-white"
                              >
                                <img
                                  src={image.url}
                                  alt={`NZWN note image ${imageIndex + 1}`}
                                  className="h-40 w-full object-cover transition hover:scale-[1.02]"
                                />
                              </a>
                            ) : null,
                          )}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Temperature Line
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Blue = METAR (red = SPECI). Green = MetService AWS.
                Orange dashed = MetService hourly forecast.
              </p>
            </div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-black/45">
              Swipe left/right on mobile
            </p>
          </div>

          <div className="mt-6 overflow-x-auto overscroll-x-contain pb-2 touch-pan-x [-webkit-overflow-scrolling:touch]">
            <div
              className="h-[620px]"
              style={{ width: `max(100%, ${chartWidthPx}px)` }}
            >
              {rows.length ? (
                <Line data={chartData} options={chartOptions} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-sm text-black/55">
                  No NZWN observations stored for this date yet.
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
                MetService + Google
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-black/60">
                MetService airport current for NZWN (Lyall Bay / station 93439),
                MetService 10-day forecast, and Google hourly timing for forecast
                peak windows. Peak-window cells only fill when the hourly window
                covers that date.
              </p>
            </div>
            {isWeatherLoading ? (
              <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-sky-800">
                Loading live forecast data
              </span>
            ) : null}
          </div>

          {weatherPanelError ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Weather panel load failed: {weatherPanelError}
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                MetService Current Temperature
              </p>
              <p className="mt-2 text-3xl font-semibold text-black">
                {currentReading?.status === "ok"
                  ? formatTemp(
                      displayUnit === "C" ? currentReading.tempC : currentReading.tempF,
                      displayUnit,
                    )
                  : "—"}
              </p>
              <p className="mt-2 text-sm text-black/60">
                Observed{" "}
                {currentReading?.observedAtLocal
                  ? formatStoredLocalDateTime(currentReading.observedAtLocal)
                  : "—"}
              </p>
              <p className="mt-1 text-xs text-black/55">
                {currentReading?.status === "error"
                  ? currentReading.error || "MetService current conditions unavailable."
                  : currentReading?.phrase ||
                    "Wellington airport current conditions from MetService."}
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                Forecast Peak Time
              </p>
              <p className="mt-2 text-3xl font-semibold text-black">
                {formatPeakWindow(forecastPeak)}
              </p>
              <p className="mt-2 text-sm text-black/60">
                {forecastPeak?.date
                  ? `Google hourly peak for ${forecastPeak.date}`
                  : "Hourly peak time is only available inside the current Google forecast window."}
              </p>
              <p className="mt-1 text-xs text-black/55">
                {weatherHourly?.status === "error"
                  ? weatherHourly.error || "Hourly forecast unavailable."
                  : forecastPeak
                    ? `${formatTemp(
                        displayUnit === "C" ? forecastPeak.tempC : forecastPeak.tempF,
                        displayUnit,
                      )}${forecastPeak.phrase ? ` | ${forecastPeak.phrase}` : ""}`
                    : "Selected date peak timing is not available from the current hourly forecast window."}
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                MetService Forecast
              </p>
              <p className="mt-2 text-3xl font-semibold text-black">
                {selectedDateForecast
                  ? formatTemp(
                      displayUnit === "C"
                        ? selectedDateForecast.maxTempC
                        : selectedDateForecast.maxTempF,
                      displayUnit,
                    )
                  : "—"}
              </p>
              <p className="mt-2 text-sm text-black/60">Selected Date {date}</p>
              <p className="mt-1 text-xs text-black/55">
                {weatherForecast?.status === "error"
                  ? weatherForecast.error || "Forecast unavailable."
                  : selectedDateForecast
                    ? `Min ${formatTemp(
                        displayUnit === "C"
                          ? selectedDateForecast.minTempC
                          : selectedDateForecast.minTempF,
                        displayUnit,
                      )}${selectedDateForecast.dayPhrase ? ` | ${selectedDateForecast.dayPhrase}` : ""}`
                    : "Selected date is outside the current MetService forecast window."}
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                Current Details
              </p>
              <div className="mt-3 space-y-2 text-sm text-black/70">
                <p>
                  Humidity:{" "}
                  {Number.isFinite(currentReading?.relativeHumidity)
                    ? `${currentReading.relativeHumidity}%`
                    : "—"}
                </p>
                <p>
                  Wind:{" "}
                  {Number.isFinite(currentReading?.windSpeedKph)
                    ? `${currentReading.windSpeedKph} km/h`
                    : "—"}
                </p>
                <p>
                  Gust:{" "}
                  {Number.isFinite(currentReading?.windGustKph)
                    ? `${currentReading.windGustKph} km/h`
                    : "—"}
                </p>
                <p>
                  Pressure:{" "}
                  {Number.isFinite(currentReading?.pressureHpa)
                    ? `${currentReading.pressureHpa} hPa`
                    : "—"}
                </p>
                <p>
                  Status:{" "}
                  {currentReading?.status === "error"
                    ? `Unavailable (${currentReading.error || "request failed"})`
                    : currentReading?.sourceLabel ?? "Loaded"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                MetService 10-Day Forecast
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Daily rows come from MetService&apos;s Lyall Bay forecast.
                Peak Window comes from Google&apos;s hourly forecast API, so only
                days inside that hourly window will show a hit time.
              </p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/55">
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Min</th>
                  <th className="px-3 py-2 font-semibold">Max</th>
                  <th className="px-3 py-2 font-semibold">Peak Window</th>
                  <th className="px-3 py-2 font-semibold">Day</th>
                  <th className="px-3 py-2 font-semibold">Night</th>
                </tr>
              </thead>
              <tbody>
                {weatherForecastDays.length ? (
                  weatherForecastDays.map((day) => {
                    const peak = forecastPeakByDate.get(day.date) ?? null;
                    const isSelectedForecastDay = day.date === date;

                    return (
                      <tr
                        key={day.date}
                        className={`border-b border-black/5 align-top last:border-b-0 ${
                          isSelectedForecastDay ? "bg-amber-50/60" : ""
                        }`}
                      >
                        <td className="px-3 py-3 whitespace-nowrap font-semibold text-black">
                          {day.date}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-black/80">
                          {formatTemp(
                            displayUnit === "C" ? day.minTempC : day.minTempF,
                            displayUnit,
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-black/80">
                          {formatTemp(
                            displayUnit === "C" ? day.maxTempC : day.maxTempF,
                            displayUnit,
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-black/80">
                          {formatPeakWindow(peak)}
                        </td>
                        <td className="px-3 py-3 text-black/70">{day.dayPhrase || "—"}</td>
                        <td className="px-3 py-3 text-black/70">{day.nightPhrase || "—"}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-black/55">
                      {weatherForecast?.status === "error"
                        ? weatherForecast.error || "MetService forecast unavailable."
                        : isWeatherLoading
                          ? "Loading MetService forecast..."
                          : "No MetService forecast rows available."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Publish Race</h2>
              <p className="mt-1 text-sm text-black/60">
                Recent NZWN first-seen timing across official PreFlight and
                NOAA `tgftp`. Times in this table are shown in
                America/Chicago. This logger runs a 1-second watch starting at
                `:04` and `:34` and also keeps minute fallback polls because
                NZWN publication can drift well past the nominal schedule.
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
                {displayedRaceRows.length ? (
                  displayedRaceRows.map((row) => (
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
                            row.displayRace.winner === "preflight"
                              ? "bg-emerald-50 text-emerald-800"
                              : row.displayRace.winner === "tgftp"
                                ? "bg-amber-50 text-amber-900"
                                : row.displayRace.winner === "tie"
                                  ? "bg-slate-100 text-slate-800"
                                  : "bg-black/[0.05] text-black/65"
                          }`}
                        >
                          {formatRaceWinner(row.displayRace.winner)}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/80">
                        {formatLeadMs(row.displayRace.leadMs)}
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
                        {row.preflightRawMetar ??
                          row.tgftpRawMetar ??
                          row.rawMetar ??
                          "—"}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Forecast History</h2>
              <p className="mt-1 text-sm text-black/60">
                Track how MetService changed its predicted high for {date} over
                successive stored forecast captures, scored against the official
                NZWN max.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-black/45">
                Stored every 6 hours
              </p>
              <Link
                href="/nzwn/forecast-accuracy"
                className="text-sm text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-600"
              >
                Full accuracy report
              </Link>
            </div>
          </div>

          {forecastTrendData === undefined ? (
            <p className="mt-4 text-sm text-black/60">
              Loading MetService forecast history for {date}...
            </p>
          ) : !forecastTrendRows.length ? (
            <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-white/70 p-4 text-sm text-black/65">
              No stored MetService forecast history for {date} yet. This history
              only starts from saved 6-hour forecast snapshots, so older dates may
              be empty until new polls accumulate.
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                    First Prediction
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-black">
                    {formatTemp(forecastTrendSummary?.firstPoint?.y, displayUnit)}
                  </p>
                  <p className="mt-2 text-xs text-black/55">
                    {formatStoredLocalDateTime(
                      forecastTrendSummary?.firstPoint?.capturedAtLocal,
                    )}
                  </p>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                    Latest Prediction
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-black">
                    {formatTemp(forecastTrendSummary?.latestPoint?.y, displayUnit)}
                  </p>
                  <p className="mt-2 text-xs text-black/55">
                    {formatStoredLocalDateTime(
                      forecastTrendSummary?.latestPoint?.capturedAtLocal,
                    )}
                  </p>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                    Net Change
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-black">
                    {formatDelta(forecastTrendSummary?.netDelta, displayUnit)}
                  </p>
                  <p className="mt-2 text-xs text-black/55">
                    {forecastTrendSummary?.changeCount ?? 0} changes
                  </p>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                    Lowest Seen
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-black">
                    {formatTemp(forecastTrendSummary?.minPoint?.y, displayUnit)}
                  </p>
                  <p className="mt-2 text-xs text-black/55">
                    {formatStoredLocalDateTime(
                      forecastTrendSummary?.minPoint?.capturedAtLocal,
                    )}
                  </p>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                    Highest Seen
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-black">
                    {formatTemp(forecastTrendSummary?.maxPoint?.y, displayUnit)}
                  </p>
                  <p className="mt-2 text-xs text-black/55">
                    {formatStoredLocalDateTime(
                      forecastTrendSummary?.maxPoint?.capturedAtLocal,
                    )}
                  </p>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                    Official Max
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-black">
                    {formatTemp(officialTrendMax, displayUnit)}
                  </p>
                  <p className="mt-2 text-xs text-black/55">
                    {officialTrendMaxAtLocal
                      ? formatStoredLocalDateTime(officialTrendMaxAtLocal)
                      : "Available after METAR ingest"}
                  </p>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-2xl border border-black/10 bg-white/75">
                <div className="min-w-[760px] p-4">
                  <div className="h-[320px]">
                    <Line
                      data={forecastTrendChartData}
                      options={forecastTrendChartOptions}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-black/55">
                      <th className="px-3 py-2 font-semibold">Captured</th>
                      <th className="px-3 py-2 font-semibold">Lead</th>
                      <th className="px-3 py-2 font-semibold">Predicted High</th>
                      <th className="px-3 py-2 font-semibold">Delta</th>
                      <th className="px-3 py-2 font-semibold">Err vs official</th>
                      <th className="px-3 py-2 font-semibold">Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastTrendRows.map((row, index) => (
                      <tr
                        key={`${row.capturedAt}-${index}`}
                        className="border-b border-black/5 align-top last:border-b-0"
                      >
                        <td className="px-3 py-3 whitespace-nowrap text-black/80">
                          {formatStoredLocalDateTime(row.capturedAtLocal)}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-black/80">
                          {Number.isFinite(row.leadDays) ? `${row.leadDays}d` : "—"}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-black/80">
                          {formatTemp(
                            row.maxTempC === null
                              ? null
                              : displayUnit === "C"
                                ? row.maxTempC
                                : (row.maxTempC * 9) / 5 + 32,
                            displayUnit,
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-black/80">
                          {formatDelta(
                            row.deltaC === null
                              ? null
                              : displayUnit === "C"
                                ? row.deltaC
                                : (row.deltaC * 9) / 5,
                            displayUnit,
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-black/80">
                          {formatDelta(
                            row.errorC === null
                              ? null
                              : displayUnit === "C"
                                ? row.errorC
                                : (row.errorC * 9) / 5,
                            displayUnit,
                          )}
                        </td>
                        <td className="px-3 py-3 text-black/70">
                          {row.dayPhrase || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {officialTrendMaxC !== null && (
                <p className="mt-3 text-sm text-black/55">
                  {forecastTrendData?.actualLabel ?? "Official NZWN max"}:{" "}
                  <span className="font-semibold text-foreground">
                    {formatTemp(officialTrendMax, displayUnit)}
                  </span>{" "}
                  ({forecastTrendData?.obsCount ?? summary?.obsCount ?? 0} official reports)
                </p>
              )}
            </>
          )}
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
