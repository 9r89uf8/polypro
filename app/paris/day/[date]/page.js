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

const STATION_ICAO = "LFPG";
const STATION_NAME = "Paris Charles de Gaulle";
const PARIS_TIMEZONE = "Europe/Paris";
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

function parisTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TIMEZONE,
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

function formatParisDateTimeSeconds(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TIMEZONE,
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
  if (winner === "aeroweb") {
    return "AEROWEB";
  }
  if (winner === "tgftp") {
    return "NOAA tgftp";
  }
  if (winner === "tie") {
    return "Tie";
  }
  return "Pending";
}

function formatOfficialPollMessage(result) {
  if (!result?.ok) {
    return "Latest official poll skipped.";
  }

  const firstSeenText = Number.isFinite(result.row?.aerowebFirstSeenAt)
    ? formatParisDateTimeSeconds(result.row.aerowebFirstSeenAt)
    : null;
  const lagText = Number.isFinite(result.availabilityLagMs)
    ? `${Math.max(0, result.availabilityLagMs / 60000).toFixed(1)} min lag`
    : null;

  const didSave = (result.insertedCount ?? 0) > 0 || (result.patchedCount ?? 0) > 0;
  return `Latest official poll: ${didSave ? "saved" : "no new report"} ${result.row?.reportType ?? "message"} ${result.row?.obsTimeLocal ?? ""}.${firstSeenText ? ` First seen ${firstSeenText}${lagText ? ` (${lagText})` : ""}.` : ""}`;
}

function formatNoaaPollMessage(result) {
  if (!result?.ok) {
    return "Default NOAA sync skipped.";
  }

  const lastModifiedText = Number.isFinite(result.tgftpLastModifiedAt)
    ? formatChicagoDateTimeSeconds(result.tgftpLastModifiedAt)
    : null;

  const didSave = (result.insertedCount ?? 0) > 0 || (result.patchedCount ?? 0) > 0;
  return `Default NOAA sync: ${didSave ? "saved" : "no new report"} ${result.row?.reportType ?? "message"} ${result.row?.obsTimeLocal ?? ""}.${lastModifiedText ? ` tgftp Last-Modified ${lastModifiedText}.` : ""}`;
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
    label: "Stored LFPG METAR",
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

function buildMeteoFranceDataset(meteoFranceRows, unit) {
  const points = meteoFranceRows
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

  if (!points.length) {
    return null;
  }

  return {
    label: "Météo-France AWS",
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

function buildMeteoFranceForecastDataset(forecastRows, unit) {
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
    label: "Météo-France Forecast",
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
  for (const [date, dayRows] of rowsByDate.entries()) {
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
          date,
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
      peaks.set(date, peakWindow);
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

export default function ParisDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [displayUnit, setDisplayUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [liveMessage, setLiveMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOfficialRefreshing, setIsOfficialRefreshing] = useState(false);
  const [weatherPanel, setWeatherPanel] = useState(null);
  const [weatherPanelError, setWeatherPanelError] = useState("");
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const inFlightRef = useRef(false);
  const weatherRequestRef = useRef(0);

  const isDateValid = isValidDate(date);
  const parisTodayDate = parisTodayKey();
  const isToday = isDateValid && date === parisTodayDate;
  const quickPreviousDates = useMemo(() => buildPreviousDateKeys(date, 2), [date]);

  const pollLatestOfficial = useAction("aeroweb:pollLatestStationMetar");
  const pollLatestNoaa = useAction("aeroweb:pollLatestNoaaStationMetar");
  const pollMeteoFranceObs = useAction("parisWeather:pollMeteoFranceObservation");
  const loadParisWeather = useAction("parisWeather:getDayPageWeather");

  const dayData = useQuery(
    "aeroweb:getDayStationRows",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const meteoFranceData = useQuery(
    "parisWeather:getMeteoFranceObservations",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const meteoFranceForecastData = useQuery(
    "parisWeather:getMeteoFranceHourlyForecasts",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const rows = dayData?.rows ?? [];
  const meteoFranceRows = meteoFranceData?.rows ?? [];
  const meteoFranceForecastRows = meteoFranceForecastData?.rows ?? [];
  const summary = dayData?.summary ?? null;
  const latestTemp = displayUnit === "C" ? summary?.latestTempC : summary?.latestTempF;
  const maxTemp = displayUnit === "C" ? summary?.maxTempC : summary?.maxTempF;
  const minTemp = displayUnit === "C" ? summary?.minTempC : summary?.minTempF;
  const currentReading = weatherPanel?.currentReading ?? null;
  const weatherForecast = weatherPanel?.forecast ?? null;
  const weatherForecastDays = weatherForecast?.days ?? [];
  const weatherHourly = weatherPanel?.hourly ?? null;
  const weatherHourlyRows = weatherHourly?.rows ?? [];
  const selectedDateForecast = weatherPanel?.selectedDateForecast ?? null;
  const noaaOfficialMax = weatherPanel?.noaaOfficialMax ?? null;

  // Météo-France live current temp (latest 6-min observation).
  const mfLatestObs = meteoFranceRows.length
    ? meteoFranceRows[meteoFranceRows.length - 1]
    : null;
  // Météo-France daily forecast from the mobile API (stored via getDayPageWeather).
  const mfDailyForecast = weatherPanel?.meteoFranceDailyForecast ?? [];
  const mfSelectedDateForecast = mfDailyForecast.find((d) => d.date === date) ?? null;
  // Météo-France hourly forecast peak detection.
  const mfForecastPeakByDate = useMemo(
    () => {
      const peaks = new Map();
      const byDate = new Map();
      for (const row of meteoFranceForecastRows) {
        if (!row.date || !Number.isFinite(row.tempC) || !Number.isFinite(row.forecastTimeUtc)) continue;
        if (!byDate.has(row.date)) byDate.set(row.date, []);
        byDate.get(row.date).push(row);
      }
      for (const [dayDate, dayRows] of byDate.entries()) {
        dayRows.sort((a, b) => a.forecastTimeUtc - b.forecastTimeUtc);
        let maxTempC = Number.NEGATIVE_INFINITY;
        for (const r of dayRows) {
          if (r.tempC > maxTempC) maxTempC = r.tempC;
        }
        if (!Number.isFinite(maxTempC)) continue;
        let peakWindow = null;
        for (const r of dayRows) {
          if (r.tempC !== maxTempC) {
            if (peakWindow) break;
            continue;
          }
          if (!peakWindow) {
            peakWindow = {
              date: dayDate,
              startValidTimeUtc: r.forecastTimeUtc,
              endValidTimeUtc: r.forecastTimeUtc,
              startValidTimeLocal: r.forecastTimeLocal,
              endValidTimeLocal: r.forecastTimeLocal,
              tempC: r.tempC,
              tempF: r.tempF,
              phrase: r.weatherDescription ?? null,
            };
            continue;
          }
          if (r.forecastTimeUtc - peakWindow.endValidTimeUtc <= 90 * 60 * 1000) {
            peakWindow.endValidTimeUtc = r.forecastTimeUtc;
            peakWindow.endValidTimeLocal = r.forecastTimeLocal;
            continue;
          }
          break;
        }
        if (peakWindow) peaks.set(dayDate, peakWindow);
      }
      return peaks;
    },
    [meteoFranceForecastRows],
  );
  const mfSelectedForecastPeak = mfForecastPeakByDate.get(date) ?? null;
  const mfTodayForecastPeak = mfForecastPeakByDate.get(parisTodayDate) ?? null;
  const mfForecastPeak = mfSelectedForecastPeak ?? mfTodayForecastPeak;

  useEffect(() => {
    setInputDate(date);
  }, [date]);

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
        const result = await loadParisWeather({ date });
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
  }, [date, isDateValid, loadParisWeather]);

  useEffect(() => {
    if (!isDateValid) {
      setLiveMessage("");
      return;
    }
    if (!isToday) {
      setLiveMessage(
        "Historical LFPG dates depend on rows captured from default NOAA polling plus any manual AEROWEB official fetches. No authenticated day-history backfill endpoint is wired yet.",
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
        const pollResult = await pollLatestNoaa({ stationIcao: STATION_ICAO });
        if (!cancelled) {
          setLiveMessage(formatNoaaPollMessage(pollResult));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setLiveMessage(`LFPG sync failed: ${message}`);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [date, isDateValid, isToday, pollLatestNoaa]);

  async function handleRefreshNow() {
    if (!isDateValid || !isToday || inFlightRef.current) {
      return;
    }

    setIsRefreshing(true);
    inFlightRef.current = true;
    const weatherRequestId = weatherRequestRef.current + 1;
    weatherRequestRef.current = weatherRequestId;
    setIsWeatherLoading(true);
    try {
      const [pollResult, weatherResult] = await Promise.allSettled([
        pollLatestNoaa({ stationIcao: STATION_ICAO }),
        loadParisWeather({ date }),
        pollMeteoFranceObs({ stationIcao: STATION_ICAO }),
      ]);

      if (pollResult.status === "fulfilled") {
        setLiveMessage(formatNoaaPollMessage(pollResult.value));
      } else {
        console.error(pollResult.reason);
        const message =
          pollResult.reason instanceof Error
            ? pollResult.reason.message
            : String(pollResult.reason);
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

  async function handleFetchOfficialNow() {
    if (!isDateValid || !isToday || inFlightRef.current) {
      return;
    }

    setIsOfficialRefreshing(true);
    inFlightRef.current = true;
    try {
      const pollResult = await pollLatestOfficial({
        stationIcao: STATION_ICAO,
        recordPublishRace: false,
      });
      setLiveMessage(formatOfficialPollMessage(pollResult));
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setLiveMessage(`Official fetch failed: ${message}`);
    } finally {
      inFlightRef.current = false;
      setIsOfficialRefreshing(false);
    }
  }

  function handleGoToDate(event) {
    event.preventDefault();
    if (!isValidDate(inputDate)) {
      return;
    }
    router.push(`/paris/day/${inputDate}`);
  }

  const chartData = useMemo(
    () => {
      const datasets = [];
      if (rows.length) {
        datasets.push(buildLineDataset(rows, displayUnit));
      }
      const mfDs = buildMeteoFranceDataset(meteoFranceRows, displayUnit);
      if (mfDs) {
        datasets.push(mfDs);
      }
      const mfFcDs = buildMeteoFranceForecastDataset(meteoFranceForecastRows, displayUnit);
      if (mfFcDs) {
        datasets.push(mfFcDs);
      }
      return { datasets };
    },
    [rows, displayUnit, meteoFranceRows, meteoFranceForecastRows],
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
          title: { display: true, text: "Local Time (Europe/Paris)" },
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

  const forecastPeakByDate = useMemo(
    () => buildForecastPeakByDate(weatherHourlyRows),
    [weatherHourlyRows],
  );
  const selectedForecastPeak = forecastPeakByDate.get(date) ?? null;
  const todayForecastPeak =
    forecastPeakByDate.get(weatherPanel?.todayDate ?? parisTodayDate) ?? null;
  const forecastPeak = selectedForecastPeak ?? todayForecastPeak;

  if (!isDateValid) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-white p-6">
          <h1 className="text-2xl font-semibold text-red-800">Invalid Paris date</h1>
          <p className="mt-2 text-sm text-red-700">
            Use a `YYYY-MM-DD` date in the route.
          </p>
          <div className="mt-4">
            <Link
              href="/paris/today"
              className="inline-flex rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-800"
            >
              Open Paris today
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
            LFPG now uses NOAA `tgftp` as the default background source and keeps
            AEROWEB as an on-demand official fetch when you want the new METAR a
            few minutes earlier. Older dates can only show rows we already
            captured live because a day-history endpoint is not confirmed yet.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <Link
              href="/paris/today"
              className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:border-sky-400"
            >
              Current Date {parisTodayDate}
            </Link>
            {quickPreviousDates.map((previousDate) => (
              <Link
                key={previousDate}
                href={`/paris/day/${previousDate}`}
                className="inline-flex rounded-full border border-black/15 bg-white/70 px-4 py-2 text-sm font-semibold text-black hover:border-black"
              >
                {previousDate}
              </Link>
            ))}
          </div>

          <form onSubmit={handleGoToDate} className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-black/70" htmlFor="paris-day-picker">
              Pick Date
            </label>
            <input
              id="paris-day-picker"
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
              {isRefreshing ? "Refreshing..." : "Refresh Default Data"}
            </button>
            <button
              type="button"
              onClick={handleFetchOfficialNow}
              disabled={isOfficialRefreshing || !isToday}
              className="rounded-full border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 transition hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isOfficialRefreshing ? "Fetching Official..." : "Fetch Official Now"}
            </button>
            {isToday ? (
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-emerald-800">
                Default NOAA ingest enabled
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
                ? "Waiting for default NOAA sync..."
                : "Historical LFPG dates depend on previously captured NOAA and manual AEROWEB rows.")}
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
              Stored LFPG METAR with any captured off-cycle SPECI in the same
              series. Default rows come from NOAA; manual official fetches can
              upgrade the same observation with AEROWEB timing.
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Typical Availability
            </p>
            <p className="mt-2 text-xl font-semibold text-foreground">
              AEROWEB ~:58 / :29
            </p>
            <p className="mt-1 text-sm text-black/65">
              NOAA `tgftp` ~:03 / :33
            </p>
            <p className="mt-2 text-xs text-black/55">
              Recent LFPG publish-race results show AEROWEB leading NOAA by
              roughly 4 to 5 minutes, so use `Fetch Official Now` near those
              routine windows when you need the earliest official copy.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Météo-France + NOAA
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-black/60">
                Météo-France DPObs 6-minute live temperature for CDG,
                today&apos;s NOAA METAR max, Météo-France hourly forecast peak
                timing, and Météo-France 15-day daily forecast.
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
                Météo-France Current Temperature
              </p>
              <p className="mt-2 text-3xl font-semibold text-black">
                {mfLatestObs
                  ? formatTemp(
                      displayUnit === "C" ? mfLatestObs.tempC : mfLatestObs.tempF,
                      displayUnit,
                    )
                  : "—"}
              </p>
              <p className="mt-2 text-sm text-black/60">
                Observed{" "}
                {mfLatestObs?.obsTimeLocal
                  ? formatStoredLocalDateTime(mfLatestObs.obsTimeLocal)
                  : "—"}
              </p>
              <p className="mt-1 text-xs text-black/55">
                {mfLatestObs
                  ? "CDG 6-minute AWS observation from Météo-France DPObs."
                  : "No Météo-France observations stored for this date yet."}
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                Latest NOAA METAR Max
              </p>
              <p className="mt-2 text-3xl font-semibold text-black">
                {noaaOfficialMax?.status === "ok"
                  ? formatTemp(
                      displayUnit === "C"
                        ? noaaOfficialMax.maxTempC
                        : noaaOfficialMax.maxTempF,
                      displayUnit,
                    )
                  : "—"}
              </p>
              <p className="mt-2 text-sm text-black/60">
                Official Max Today {weatherPanel?.todayDate ?? parisTodayDate}
              </p>
              <p className="mt-1 text-xs text-black/55">
                {noaaOfficialMax?.status === "error"
                  ? noaaOfficialMax.error || "NOAA METAR max unavailable."
                  : noaaOfficialMax?.maxAtLocal
                    ? `At ${formatStoredLocalDateTime(noaaOfficialMax.maxAtLocal)} | Obs ${noaaOfficialMax.obsCount ?? 0}`
                    : `No NOAA METAR temperatures found yet for ${weatherPanel?.todayDate ?? parisTodayDate}.`}
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                Forecast Peak Time
              </p>
              <p className="mt-2 text-3xl font-semibold text-black">
                {formatPeakWindow(mfForecastPeak)}
              </p>
              <p className="mt-2 text-sm text-black/60">
                {mfForecastPeak?.date
                  ? `Météo-France hourly peak for ${mfForecastPeak.date}`
                  : "Peak time available when hourly forecast data covers the selected date."}
              </p>
              <p className="mt-1 text-xs text-black/55">
                {mfForecastPeak
                  ? `${formatTemp(
                      displayUnit === "C" ? mfForecastPeak.tempC : mfForecastPeak.tempF,
                      displayUnit,
                    )}${mfForecastPeak.phrase ? ` | ${mfForecastPeak.phrase}` : ""}`
                  : "No Météo-France hourly forecast data for this date yet."}
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                Météo-France Forecast
              </p>
              <p className="mt-2 text-3xl font-semibold text-black">
                {mfSelectedDateForecast
                  ? formatTemp(
                      displayUnit === "C"
                        ? mfSelectedDateForecast.maxTempC
                        : mfSelectedDateForecast.maxTempF,
                      displayUnit,
                    )
                  : "—"}
              </p>
              <p className="mt-2 text-sm text-black/60">Selected Date {date}</p>
              <p className="mt-1 text-xs text-black/55">
                {mfSelectedDateForecast
                  ? `Min ${formatTemp(
                      displayUnit === "C"
                        ? mfSelectedDateForecast.minTempC
                        : mfSelectedDateForecast.minTempF,
                      displayUnit,
                    )}${mfSelectedDateForecast.dayPhrase ? ` | ${mfSelectedDateForecast.dayPhrase}` : ""}`
                  : "Selected date is outside the current Météo-France forecast window."}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Météo-France 15-Day Forecast
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Daily forecast from Météo-France for Paris CDG.
                Peak Window comes from the stored Météo-France hourly forecast.
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
                </tr>
              </thead>
              <tbody>
                {mfDailyForecast.length ? (
                  mfDailyForecast.map((day) => {
                    const peak = mfForecastPeakByDate.get(day.date) ?? null;
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
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-black/55">
                      {isWeatherLoading
                        ? "Loading Météo-France forecast..."
                        : "No Météo-France daily forecast rows available."}
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
              <h2 className="text-xl font-semibold text-foreground">
                Temperature Line
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Stored LFPG METAR rows. Blue markers are routine METAR. Red
                markers are SPECI.
              </p>
            </div>
          </div>

          <div className="mt-6 h-[420px]">
            {rows.length ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-sm text-black/55">
                No LFPG observations stored for this date yet.
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
          <h2 className="text-xl font-semibold text-foreground">Raw Observations</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-black/55">
                  <th className="px-3 py-2 font-semibold">Local Time</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Temp</th>
                  <th className="px-3 py-2 font-semibold">Official First Seen</th>
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
                        {row.aerowebFirstSeenAt
                          ? formatParisDateTimeSeconds(row.aerowebFirstSeenAt)
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
