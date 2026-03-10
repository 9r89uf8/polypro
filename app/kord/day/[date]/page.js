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
import { useParams, useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";

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
const MOBILE_MEDIA_QUERY = "(max-width: 768px)";
const DAY_MS = 24 * 60 * 60 * 1000;
const ENABLE_DAY_PAGE_NOAA_POLL = false;
const PWS_SERIES_COLORS = ["#65a30d", "#7c2d12", "#7e22ce", "#0f766e"];

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function formatLagMinutes(noaaFirstSeenAt, tsUtc) {
  if (!Number.isFinite(noaaFirstSeenAt) || !Number.isFinite(tsUtc)) {
    return "—";
  }
  const lagMinutes = Math.max(0, (noaaFirstSeenAt - tsUtc) / 60000);
  return `${lagMinutes.toFixed(1)} min`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(0)}%`;
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
  const seconds = match[4];
  const secondSuffix = seconds ? `:${seconds}` : "";
  return `${match[1]} ${hour12}:${String(minute).padStart(2, "0")}${secondSuffix} ${period}`;
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

function formatLivePollMessage(result, label) {
  if (!result?.ok) {
    return `${label} skipped (${result?.reason ?? "unknown"}).`;
  }

  const seenAtText = Number.isFinite(result.noaaFirstSeenAt)
    ? formatChicagoDateTimeSeconds(result.noaaFirstSeenAt)
    : null;
  const lagText = Number.isFinite(result.availabilityLagMs)
    ? `${Math.max(0, result.availabilityLagMs / 60000).toFixed(1)} min lag`
    : null;
  const timingSuffix = seenAtText
    ? ` First seen ${seenAtText}${lagText ? ` (${lagText})` : ""}.`
    : "";

  if (result.inserted) {
    return `${label}: saved ${result.tsLocal}.${timingSuffix}`;
  }
  return `${label}: no new report (${result.tsLocal}).${timingSuffix}`;
}

function formatBackfillMessage(result, label) {
  if (!result?.ok) {
    return `${label} skipped.`;
  }
  return `${label}: inserted ${result.insertedCount} of ${result.consideredCount} today observations.`;
}

function buildLineDataset(rows, unit, label, color, pointConfig = {}) {
  const {
    pointRadius = 1.5,
    pointHoverRadius = 3,
    pointHitRadius = 10,
    pointBorderWidth = 1.25,
  } = pointConfig;
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
    pointRadius,
    pointHoverRadius,
    pointHitRadius,
    pointBorderWidth,
    borderWidth: 2,
    tension: 0.25,
    showLine: true,
  };
}

function buildPhoneLineDataset(rows, unit, label, color, pointConfig = {}) {
  const {
    pointRadius = 3,
    pointHoverRadius = 5,
    pointHitRadius = 12,
    pointBorderWidth = 1.5,
  } = pointConfig;
  const data = rows
    .map((row) => {
      const when = row.tsLocal ?? row.slotLocal;
      const x = parseMinute(when);
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

  if (!data.length) {
    return null;
  }

  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    pointRadius,
    pointHoverRadius,
    pointHitRadius,
    pointBorderWidth,
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
      noaaFirstSeenAt: row.noaaFirstSeenAt ?? null,
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
      noaaFirstSeenAt: null,
    });
  }

  merged.sort((a, b) => a.tsUtc - b.tsUtc || a.mode.localeCompare(b.mode));
  return merged;
}

function buildPwsSeries(pwsRows, pwsSummaries) {
  const summaryByStationId = new Map(
    pwsSummaries.map((summary) => [summary.pwsStationId, summary]),
  );
  const rowsByStationId = new Map();

  for (const row of pwsRows) {
    const stationId = row.pwsStationId;
    if (!rowsByStationId.has(stationId)) {
      rowsByStationId.set(stationId, []);
    }
    rowsByStationId.get(stationId).push({
      tsLocal: row.obsTimeLocal,
      tempC: row.tempC,
      tempF: row.tempF,
    });
  }

  return Array.from(rowsByStationId.entries())
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([pwsStationId, rows]) => ({
      pwsStationId,
      rows,
      summary: summaryByStationId.get(pwsStationId) ?? null,
    }));
}

export default function KordDayPage() {
  const router = useRouter();
  const params = useParams();
  const rawDate = Array.isArray(params?.date) ? params.date[0] : params?.date;
  const date = rawDate || "";
  const [displayUnit, setDisplayUnit] = useState("F");
  const [showRawObservations, setShowRawObservations] = useState(false);
  const [showOfficialSeries, setShowOfficialSeries] = useState(true);
  const [showUnofficialSeries, setShowUnofficialSeries] = useState(true);
  const [showMadisSeries, setShowMadisSeries] = useState(true);
  const [showPwsSeries, setShowPwsSeries] = useState(true);
  const [showPhoneSeries, setShowPhoneSeries] = useState(true);
  const [showUnofficialRawRows, setShowUnofficialRawRows] = useState(false);
  const [showMadisRawRows, setShowMadisRawRows] = useState(false);
  const [showPwsRawRows, setShowPwsRawRows] = useState(false);
  const [manualEntryValue, setManualEntryValue] = useState("");
  const [manualEntryUnit, setManualEntryUnit] = useState("F");
  const [manualSaveMessage, setManualSaveMessage] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const inFlightRef = useRef(false);
  const backfilledDateRef = useRef("");
  const isDateValid = isValidDate(date);
  const chicagoTodayDate = chicagoTodayKey();
  const isToday = isDateValid && date === chicagoTodayDate;
  const quickPreviousDates = useMemo(() => buildPreviousDateKeys(date, 2), [date]);

  const pollLatest = useAction("weather:pollLatestNoaaMetar");
  const backfillToday = useAction("weather:backfillTodayOfficialFromIem");
  const backfillTodayAll = useAction("weather:backfillTodayAllFromIem");
  const saveManualDay = useMutation("weather:upsertManualMonth");

  const dayData = useQuery(
    "weather:getDayObservations",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const phoneDayData = useQuery(
    "kordPhone:getDayPhoneReadings",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const madisDayData = useQuery(
    "madis:getDayPublicAsosHfm",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const pwsDayData = useQuery(
    "pws:getDayWeatherComPws",
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
  const phoneRows = phoneDayData?.rows ?? [];
  const madisRows = madisDayData?.rows ?? [];
  const madisSummary = madisDayData?.summary ?? null;
  const pwsRows = pwsDayData?.rows ?? [];
  const pwsSummaries = pwsDayData?.summaries ?? [];
  const manualMax =
    displayUnit === "C" ? comparison?.manualMaxC : comparison?.manualMaxF;
  const officialMax =
    displayUnit === "C" ? comparison?.metarMaxC : comparison?.metarMaxF;
  const allMax =
    displayUnit === "C" ? comparison?.metarAllMaxC : comparison?.metarAllMaxF;
  const madisMax =
    displayUnit === "C" ? madisSummary?.maxTempC : madisSummary?.maxTempF;
  const madisChartRows = useMemo(
    () =>
      madisRows.map((row) => ({
        tsLocal: row.obsTimeLocal,
        tempC: row.tempC,
        tempF: row.tempF,
      })),
    [madisRows],
  );
  const pwsSeries = useMemo(
    () => buildPwsSeries(pwsRows, pwsSummaries),
    [pwsRows, pwsSummaries],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }

    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    if (!isToday) {
      setLiveMessage("");
      return;
    }

    let cancelled = false;

    async function safeCall(fn, onSuccess) {
      if (cancelled || inFlightRef.current) {
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
        const officialBackfillSucceeded = await safeCall(
          () => backfillToday({ stationIem: STATION_IEM, stationIcao: STATION_ICAO }),
          (result) => formatBackfillMessage(result, "Official backfill"),
        );

        const allBackfillSucceeded = await safeCall(
          () =>
            backfillTodayAll({
              stationIem: STATION_IEM,
              stationIcao: STATION_ICAO,
            }),
          (result) => formatBackfillMessage(result, "All backfill"),
        );

        if (officialBackfillSucceeded && allBackfillSucceeded) {
          backfilledDateRef.current = date;
        }
      }

      if (ENABLE_DAY_PAGE_NOAA_POLL) {
        await safeCall(
          () => pollLatest({ stationIcao: STATION_ICAO }),
          (result) => formatLivePollMessage(result, "Live poll"),
        );
      }

      if (cancelled) {
        return;
      }
    }

    bootstrapLive();

    return () => {
      cancelled = true;
    };
  }, [date, isToday, backfillToday, backfillTodayAll, pollLatest]);

  useEffect(() => {
    setManualSaveMessage("");
    setManualEntryValue("");
  }, [date]);

  async function handleRefreshNow() {
    if (!isToday || inFlightRef.current) {
      return;
    }

    setIsRefreshing(true);
    inFlightRef.current = true;
    try {
      const allResult = await backfillTodayAll({
        stationIem: STATION_IEM,
        stationIcao: STATION_ICAO,
      });
      if (ENABLE_DAY_PAGE_NOAA_POLL) {
        const pollResult = await pollLatest({ stationIcao: STATION_ICAO });
        setLiveMessage(
          `${formatBackfillMessage(allResult, "Manual all backfill")} ${formatLivePollMessage(
            pollResult,
            "Manual refresh",
          )}`,
        );
      } else {
        setLiveMessage(
          `${formatBackfillMessage(allResult, "Manual all backfill")} Manual NOAA poll is disabled on day page.`,
        );
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setLiveMessage(`Manual refresh failed: ${message}`);
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }

  async function handleSaveManualMax() {
    if (!isDateValid) {
      return;
    }

    const parts = parseDateKeyParts(date);
    if (!parts) {
      setManualSaveMessage("Date is invalid.");
      return;
    }

    const trimmed = manualEntryValue.trim();
    if (!trimmed) {
      setManualSaveMessage("Enter a manual max before saving.");
      return;
    }

    const parsedValue = Number(trimmed);
    if (!Number.isFinite(parsedValue)) {
      setManualSaveMessage("Manual max must be numeric.");
      return;
    }

    setIsSavingManual(true);
    setManualSaveMessage("");
    try {
      await saveManualDay({
        stationIcao: STATION_ICAO,
        year: parts.year,
        month: parts.month,
        unit: manualEntryUnit,
        values: [{ date, value: parsedValue }],
      });
      setManualSaveMessage(`Saved ${parsedValue.toFixed(1)}°${manualEntryUnit} for ${date}.`);
      setManualEntryValue("");
    } catch (error) {
      setManualSaveMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsSavingManual(false);
    }
  }

  function navigateToDate(targetDate) {
    if (!isValidDate(targetDate)) {
      return;
    }
    router.push(`/kord/day/${targetDate}`);
  }

  const chartData = useMemo(() => {
    const basePointConfig = isMobileViewport
      ? {
          pointRadius: 3,
          pointHoverRadius: 6,
          pointHitRadius: 20,
          pointBorderWidth: 1.75,
        }
      : {
          pointRadius: 1.5,
          pointHoverRadius: 4,
          pointHitRadius: 10,
          pointBorderWidth: 1.25,
        };

    const datasets = [];

    if (showOfficialSeries) {
      datasets.push(
        buildLineDataset(
          officialRows,
          displayUnit,
          "Official",
          "#0f766e",
          basePointConfig,
        ),
      );
    }

    if (showUnofficialSeries) {
      datasets.push(
        buildLineDataset(allRows, displayUnit, "All", "#111827", basePointConfig),
      );
    }

    if (showMadisSeries) {
      datasets.push(
        buildLineDataset(
          madisChartRows,
          displayUnit,
          "MADIS HFM",
          "#d97706",
          basePointConfig,
        ),
      );
    }

    if (showPwsSeries) {
      for (const [index, pwsStation] of pwsSeries.entries()) {
        datasets.push(
          buildLineDataset(
            pwsStation.rows,
            displayUnit,
            `PWS ${pwsStation.pwsStationId}`,
            PWS_SERIES_COLORS[index % PWS_SERIES_COLORS.length],
            basePointConfig,
          ),
        );
      }
    }

    const phonePointConfig = isMobileViewport
      ? {
          pointRadius: 4.5,
          pointHoverRadius: 7,
          pointHitRadius: 24,
          pointBorderWidth: 2,
        }
      : {
          pointRadius: 3,
          pointHoverRadius: 5,
          pointHitRadius: 12,
          pointBorderWidth: 1.5,
        };

    if (showPhoneSeries) {
      const phoneDataset = buildPhoneLineDataset(
        phoneRows,
        displayUnit,
        "Phone calls",
        "#2563eb",
        phonePointConfig,
      );
      if (phoneDataset) {
        datasets.push(phoneDataset);
      }
    }

    return { datasets };
  }, [
    officialRows,
    allRows,
    madisChartRows,
    pwsSeries,
    phoneRows,
    displayUnit,
    isMobileViewport,
    showOfficialSeries,
    showUnofficialSeries,
    showMadisSeries,
    showPwsSeries,
    showPhoneSeries,
  ]);

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
        axis: isMobileViewport ? "x" : "xy",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "top",
        },
        tooltip: {
          padding: isMobileViewport ? 12 : 8,
          titleFont: {
            size: isMobileViewport ? 13 : 12,
          },
          bodyFont: {
            size: isMobileViewport ? 12 : 11,
          },
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
            stepSize: 60,
            autoSkip: false,
            maxTicksLimit: isMobileViewport ? 25 : 25,
            maxRotation: 0,
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
  }, [manualMax, displayUnit, isMobileViewport]);

  const mergedRows = useMemo(
    () => mergeObservationRows(officialRows, allRows, displayUnit),
    [officialRows, allRows, displayUnit],
  );
  const filteredRawRows = useMemo(() => {
    if (showUnofficialRawRows) {
      return mergedRows;
    }
    return mergedRows.filter((row) => row.mode === "official");
  }, [mergedRows, showUnofficialRawRows]);

  if (!isDateValid) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-line/80 bg-panel/90 p-6">
          <h1 className="text-xl font-semibold text-foreground">Invalid Date</h1>
          <p className="mt-2 text-sm text-black/70">
            The route must use <code>YYYY-MM-DD</code>.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <Link
              href={`/kord/day/${chicagoTodayDate}`}
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Current Date {chicagoTodayDate}
            </Link>
          </div>
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
              Live ingest enabled
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <Link
              href={`/kord/day/${chicagoTodayDate}`}
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Current Date {chicagoTodayDate}
            </Link>
            {quickPreviousDates.map((quickDate) => (
              <Link
                key={quickDate}
                href={`/kord/day/${quickDate}`}
                className="inline-flex rounded-full border border-black/20 bg-white/80 px-4 py-2 text-sm font-semibold text-black hover:border-black"
              >
                {quickDate}
              </Link>
            ))}
            <label className="relative inline-flex cursor-pointer items-center overflow-hidden rounded-full border border-black/20 bg-white/80 px-4 py-2 text-sm font-semibold text-black hover:border-black">
              Pick Date
              <input
                type="date"
                value={date}
                onChange={(event) => navigateToDate(event.target.value)}
                aria-label="Pick KORD day date"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
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
                "Live mode backfills official + all once from this page. MADIS HFM and nearby PWS are collected separately by Convex cron. NOAA latest polling is disabled on this page; ongoing official ingest runs via Convex cron."}
            </p>
          ) : null}
        </header>

        {dayData === undefined ? (
          <section className="rounded-3xl border border-line/80 bg-panel/90 p-6">
            <p className="text-sm text-black/70">Loading day data...</p>
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                  Manual / WU Max
                </p>
                <p className="mt-2 text-xl font-semibold text-black">
                  {formatTemp(manualMax, displayUnit)}
                </p>
                <p className="mt-2 text-xs text-black/60">
                  Enter Wunderground's reported daily max manually.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {["C", "F"].map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => setManualEntryUnit(unit)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                        manualEntryUnit === unit
                          ? "bg-black text-white"
                          : "border border-black/20 bg-white/80 text-black/70 hover:border-black"
                      }`}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualEntryValue}
                    onChange={(event) => setManualEntryValue(event.target.value)}
                    placeholder={`Manual max (${manualEntryUnit})`}
                    className="min-w-0 flex-1 rounded-lg border border-black/20 bg-white px-2.5 py-1.5 text-sm text-black outline-none focus:border-black"
                  />
                  <button
                    type="button"
                    onClick={handleSaveManualMax}
                    disabled={isSavingManual}
                    className="rounded-lg border border-black bg-black px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingManual ? "Saving..." : "Save"}
                  </button>
                </div>
                {manualSaveMessage ? (
                  <p className="mt-2 text-xs text-black/70">{manualSaveMessage}</p>
                ) : null}
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
              <article className="rounded-2xl border border-black/10 bg-white/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                  MADIS HFM Max
                </p>
                <p className="mt-2 text-xl font-semibold text-black">
                  {formatTemp(madisMax, displayUnit)}
                </p>
                <p className="mt-1 text-xs text-black/60">
                  Obs: {madisSummary?.obsCount ?? "—"}
                </p>
                <p className="mt-1 text-xs text-black/60">
                  Latest:{" "}
                  {madisSummary?.latestObsTimeLocal
                    ? formatStoredLocalDateTime(madisSummary.latestObsTimeLocal)
                    : "—"}
                </p>
              </article>
              {pwsSummaries.map((summary) => {
                const pwsMax =
                  displayUnit === "C" ? summary.maxTempC : summary.maxTempF;
                const latestTemp =
                  displayUnit === "C" ? summary.latestTempC : summary.latestTempF;
                return (
                  <article
                    key={summary.pwsStationId}
                    className="rounded-2xl border border-black/10 bg-white/70 p-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-black/55">
                      PWS {summary.pwsStationId}
                    </p>
                    <p className="mt-1 text-xs text-black/60">
                      {summary.latestNeighborhood ?? "Weather.com/WU nearby station"}
                    </p>
                    <p className="mt-2 text-xl font-semibold text-black">
                      {formatTemp(pwsMax, displayUnit)}
                    </p>
                    <p className="mt-1 text-xs text-black/60">
                      Obs: {summary.obsCount ?? "—"}
                    </p>
                    <p className="mt-1 text-xs text-black/60">
                      Latest:{" "}
                      {summary.latestObsTimeLocal
                        ? formatStoredLocalDateTime(summary.latestObsTimeLocal)
                        : "—"}
                    </p>
                    <p className="mt-1 text-xs text-black/60">
                      Current: {formatTemp(latestTemp, displayUnit)} | QC{" "}
                      {summary.latestQcStatus ?? "—"}
                    </p>
                  </article>
                );
              })}
            </section>

            <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-foreground">
                  Temperature Lines
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowOfficialSeries((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showOfficialSeries ? "Hide Official" : "Show Official"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUnofficialSeries((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showUnofficialSeries
                      ? "Hide Unofficial (All)"
                      : "Show Unofficial (All)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMadisSeries((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showMadisSeries ? "Hide MADIS HFM" : "Show MADIS HFM"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPwsSeries((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showPwsSeries ? "Hide Nearby PWS" : "Show Nearby PWS"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPhoneSeries((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showPhoneSeries ? "Hide Phone Calls" : "Show Phone Calls"}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-black/65">
                Official, All, MADIS HFM, and collected nearby PWS temperatures through the day, with saved phone-call temperatures overlaid when available. Red dashed line is the manual/Wunderground max.
              </p>
              <p className="mt-2 text-xs text-black/55 md:hidden">
                Tip: swipe horizontally to inspect points across the full day.
              </p>
              <p className="mt-2 hidden text-xs text-black/55 md:block">
                Tip: scroll horizontally to inspect points across the full day.
              </p>
              <div className="mt-4 overflow-x-auto pb-2">
                <div className="h-[400px] min-w-[2000px] rounded-2xl border border-black/10 bg-white/75 p-2 sm:h-[360px] sm:min-w-[2300px] sm:p-3 md:min-w-[2600px]">
                  <Line data={chartData} options={chartOptions} />
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-foreground">
                  Raw Observations
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowUnofficialRawRows((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showUnofficialRawRows
                      ? "Hide Unofficial (All)"
                      : "Show Unofficial (All)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMadisRawRows((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showMadisRawRows ? "Hide MADIS HFM" : "Show MADIS HFM"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPwsRawRows((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showPwsRawRows ? "Hide Nearby PWS" : "Show Nearby PWS"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRawObservations((current) => !current)}
                    className="rounded-full border border-black/20 bg-white/80 px-3 py-1.5 text-xs font-semibold text-black/80 transition hover:border-black"
                  >
                    {showRawObservations
                      ? "Hide Raw Observations"
                      : "Show Raw Observations"}
                  </button>
                </div>
              </div>
              {showRawObservations ? (
                <div className="mt-4 space-y-5">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/55">
                      Official / All METAR Rows
                    </p>
                    <div className="overflow-auto rounded-2xl border border-black/10 bg-white/75">
                      <table className="min-w-full text-sm">
                        <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                          <tr>
                            <th className="px-3 py-2">Local Time</th>
                            <th className="px-3 py-2">Mode</th>
                            <th className="px-3 py-2">Temp</th>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2">NOAA First Seen</th>
                            <th className="px-3 py-2">Lag vs Obs</th>
                            <th className="px-3 py-2">Raw METAR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRawRows.map((row, index) => (
                            <tr key={`${row.mode}-${row.tsUtc}-${index}`} className="border-t border-black/10">
                              <td className="px-3 py-2 text-black/80">
                                {formatStoredLocalDateTime(row.tsLocal)}
                              </td>
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
                              <td className="px-3 py-2 text-black/65">
                                {row.mode === "official"
                                  ? formatChicagoDateTimeSeconds(row.noaaFirstSeenAt)
                                  : "—"}
                              </td>
                              <td className="px-3 py-2 text-black/65">
                                {row.mode === "official"
                                  ? formatLagMinutes(row.noaaFirstSeenAt, row.tsUtc)
                                  : "—"}
                              </td>
                              <td
                                className="max-w-[700px] px-3 py-2 font-mono text-xs text-black/70"
                                title={row.rawMetar}
                              >
                                {row.rawMetar}
                              </td>
                            </tr>
                          ))}
                          {filteredRawRows.length === 0 ? (
                            <tr>
                              <td className="px-3 py-4 text-sm text-black/60" colSpan={7}>
                                {mergedRows.length > 0 && !showUnofficialRawRows
                                  ? "Only unofficial (All) observations are available right now. Use \"Show Unofficial (All)\" to include them."
                                  : isToday
                                    ? "No official/all observations saved for today yet. Leave this page open to continue live polling."
                                    : "No observations saved for this day yet. Run compute first."}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {showMadisRawRows ? (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/55">
                        MADIS HFM Rows
                      </p>
                      <div className="overflow-auto rounded-2xl border border-black/10 bg-white/75">
                        <table className="min-w-full text-sm">
                          <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                            <tr>
                              <th className="px-3 py-2">Local Time</th>
                              <th className="px-3 py-2">Temp</th>
                              <th className="px-3 py-2">Dew Point</th>
                              <th className="px-3 py-2">RH</th>
                              <th className="px-3 py-2">First Seen</th>
                              <th className="px-3 py-2">Lag vs Obs</th>
                              <th className="px-3 py-2">Temp QC</th>
                            </tr>
                          </thead>
                          <tbody>
                            {madisRows.map((row) => (
                              <tr key={row._id} className="border-t border-black/10">
                                <td className="px-3 py-2 text-black/80">
                                  {formatStoredLocalDateTime(row.obsTimeLocal)}
                                </td>
                                <td className="px-3 py-2 text-black/80">
                                  {formatTemp(
                                    displayUnit === "C" ? row.tempC : row.tempF,
                                    displayUnit,
                                  )}
                                </td>
                                <td className="px-3 py-2 text-black/80">
                                  {formatTemp(
                                    displayUnit === "C"
                                      ? row.dewpointC
                                      : row.dewpointF,
                                    displayUnit,
                                  )}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {formatPercent(row.relativeHumidity)}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {formatChicagoDateTimeSeconds(row.firstSeenAt)}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {formatLagMinutes(row.firstSeenAt, row.obsTimeUtc)}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {row.tempQcd || "—"}
                                </td>
                              </tr>
                            ))}
                            {madisRows.length === 0 ? (
                              <tr>
                                <td className="px-3 py-4 text-sm text-black/60" colSpan={7}>
                                  No public MADIS HFM rows saved for this day yet. This feed usually lags observation time by several minutes.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-black/60">
                      MADIS HFM rows are hidden. Use "Show MADIS HFM" to expand the 5-minute feed table.
                    </p>
                  )}

                  {showPwsRawRows ? (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/55">
                        Nearby PWS Rows
                      </p>
                      <div className="overflow-auto rounded-2xl border border-black/10 bg-white/75">
                        <table className="min-w-full text-sm">
                          <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                            <tr>
                              <th className="px-3 py-2">Station</th>
                              <th className="px-3 py-2">Local Time</th>
                              <th className="px-3 py-2">Temp</th>
                              <th className="px-3 py-2">Dew Point</th>
                              <th className="px-3 py-2">RH</th>
                              <th className="px-3 py-2">First Seen</th>
                              <th className="px-3 py-2">Lag vs Obs</th>
                              <th className="px-3 py-2">QC</th>
                              <th className="px-3 py-2">Neighborhood</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pwsRows.map((row) => (
                              <tr key={row._id} className="border-t border-black/10">
                                <td className="px-3 py-2 text-black/80">
                                  <div className="font-semibold">{row.pwsStationId}</div>
                                  <div className="text-xs text-black/55">
                                    {row.source}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-black/80">
                                  {formatStoredLocalDateTime(row.obsTimeLocal)}
                                </td>
                                <td className="px-3 py-2 text-black/80">
                                  {formatTemp(
                                    displayUnit === "C" ? row.tempC : row.tempF,
                                    displayUnit,
                                  )}
                                </td>
                                <td className="px-3 py-2 text-black/80">
                                  {formatTemp(
                                    displayUnit === "C"
                                      ? row.dewpointC
                                      : row.dewpointF,
                                    displayUnit,
                                  )}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {formatPercent(row.relativeHumidity)}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {formatChicagoDateTimeSeconds(row.firstSeenAt)}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {formatLagMinutes(row.firstSeenAt, row.obsTimeUtc)}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {row.qcStatus ?? "—"}
                                </td>
                                <td className="px-3 py-2 text-black/65">
                                  {row.neighborhood || "—"}
                                </td>
                              </tr>
                            ))}
                            {pwsRows.length === 0 ? (
                              <tr>
                                <td className="px-3 py-4 text-sm text-black/60" colSpan={9}>
                                  No nearby PWS rows saved for this day yet.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-black/60">
                      Nearby PWS rows are hidden. Use "Show Nearby PWS" to expand the Weather.com/WU helper feed table.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-black/60">
                  Hidden by default. Use "Show Raw Observations" to expand.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
