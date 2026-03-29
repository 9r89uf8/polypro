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

const STATION_ICAO = "LEMD";
const STATION_NAME = "Adolfo Suarez Madrid-Barajas";
const MADRID_TIMEZONE = "Europe/Madrid";
const CHICAGO_TIMEZONE = "America/Chicago";
const DAY_MS = 24 * 60 * 60 * 1000;
const CLEAR_SKY_TOKENS = new Set(["SKC", "CLR", "NSC", "NCD", "CAVOK"]);
const CLOUD_COVER_PRIORITY = {
  FEW: 1,
  SCT: 2,
  BKN: 3,
  OVC: 4,
  VV: 5,
};

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

function madridTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TIMEZONE,
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

function formatMadridDateTimeSeconds(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TIMEZONE,
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

function formatMadridClock(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TIMEZONE,
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

function formatRaceWinner(winner) {
  if (winner === "aemet") {
    return "AEMET";
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

function compareCloudLayers(a, b) {
  const priorityDelta =
    (CLOUD_COVER_PRIORITY[b.coverage] ?? 0) - (CLOUD_COVER_PRIORITY[a.coverage] ?? 0);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const aBase = Number.isFinite(a.baseFt) ? a.baseFt : Number.POSITIVE_INFINITY;
  const bBase = Number.isFinite(b.baseFt) ? b.baseFt : Number.POSITIVE_INFINITY;
  return aBase - bBase;
}

function formatCloudBaseFeet(baseFt) {
  if (!Number.isFinite(baseFt)) {
    return null;
  }
  return `${baseFt.toLocaleString("en-US")} ft`;
}

function buildCloudVisualMeta({ fillClassName, coverLevel, coverLabel, baseFt }) {
  let baseVisual = null;
  if (Number.isFinite(baseFt)) {
    if (baseFt <= 1000) {
      baseVisual = {
        tierIndex: 0,
        label: "Low base",
        className: "border-rose-200 bg-rose-50 text-rose-800",
      };
    } else if (baseFt <= 3000) {
      baseVisual = {
        tierIndex: 1,
        label: "Mid base",
        className: "border-amber-200 bg-amber-50 text-amber-900",
      };
    } else {
      baseVisual = {
        tierIndex: 2,
        label: "Higher base",
        className: "border-emerald-200 bg-emerald-50 text-emerald-800",
      };
    }
  }

  return {
    showVisuals: true,
    fillClassName,
    coverLevel,
    coverLabel,
    baseVisual,
  };
}

function parseMetarCloudToken(token) {
  const normalized = String(token ?? "").toUpperCase().replace(/=+$/, "");
  if (!normalized) {
    return null;
  }
  if (CLEAR_SKY_TOKENS.has(normalized)) {
    return { kind: "clear" };
  }

  const match =
    /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)?(?:\/\/\/)?(?:[A-Z]{2,3})?$/.exec(
      normalized,
    );
  if (!match) {
    return null;
  }

  return {
    kind: "layer",
    coverage: match[1],
    baseFt: match[2] && match[2] !== "///" ? Number(match[2]) * 100 : null,
  };
}

function summarizeMetarClouds(rawMetar) {
  if (typeof rawMetar !== "string" || !rawMetar.trim()) {
    return null;
  }

  const tokens = rawMetar
    .toUpperCase()
    .replace(/=/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const layers = [];
  let sawClearToken = false;

  for (const token of tokens) {
    const parsed = parseMetarCloudToken(token);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === "clear") {
      sawClearToken = true;
      continue;
    }
    layers.push(parsed);
  }

  if (!layers.length && sawClearToken) {
    return {
      badgeLabel: "Clear",
      badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800",
      headline: "Open sky",
      detail: "No significant cloud was reported in the latest official METAR.",
      ...buildCloudVisualMeta({
        fillClassName: "bg-emerald-400",
        coverLevel: 0,
        coverLabel: "Clear",
        baseFt: null,
      }),
    };
  }

  if (!layers.length) {
    return {
      badgeLabel: "Unknown",
      badgeClassName: "border-black/10 bg-black/[0.04] text-black/65",
      headline: "Clouds not reported",
      detail: "The latest official METAR did not include a cloud layer I can summarize.",
      showVisuals: false,
    };
  }

  const sortedLayers = [...layers].sort(compareCloudLayers);
  const headlineLayer = sortedLayers[0];
  const ceilingLayer =
    sortedLayers.find((layer) => ["BKN", "OVC", "VV"].includes(layer.coverage)) ?? null;
  const layerBaseLabel = formatCloudBaseFeet(headlineLayer.baseFt);
  const ceilingBaseLabel = formatCloudBaseFeet(ceilingLayer?.baseFt);

  switch (headlineLayer.coverage) {
    case "FEW":
      return {
        badgeLabel: "Few Clouds",
        badgeClassName: "border-sky-200 bg-sky-50 text-sky-800",
        headline: "Mostly open sky",
        detail: layerBaseLabel
          ? `Only a small amount of cloud was reported, based around ${layerBaseLabel} above the airport.`
          : "Only a small amount of cloud was reported in the latest official METAR.",
        ...buildCloudVisualMeta({
          fillClassName: "bg-sky-400",
          coverLevel: 1,
          coverLabel: "A little cloud",
          baseFt: headlineLayer.baseFt,
        }),
      };
    case "SCT":
      return {
        badgeLabel: "Partly Cloudy",
        badgeClassName: "border-sky-200 bg-sky-50 text-sky-800",
        headline: "Patches of cloud around the airport",
        detail: layerBaseLabel
          ? `Part of the sky is covered by cloud, with bases around ${layerBaseLabel} above the airport.`
          : "Part of the sky is covered by cloud in the latest official METAR.",
        ...buildCloudVisualMeta({
          fillClassName: "bg-sky-500",
          coverLevel: 2,
          coverLabel: "Partial cover",
          baseFt: headlineLayer.baseFt,
        }),
      };
    case "BKN":
      return {
        badgeLabel: "Mostly Cloudy",
        badgeClassName: "border-amber-200 bg-amber-50 text-amber-900",
        headline: "Clouds covering most of the sky",
        detail: ceilingBaseLabel
          ? `Most of the sky is under cloud. The main cloud deck starts around ${ceilingBaseLabel} above the airport.`
          : "Most of the sky is under cloud. The METAR did not include a usable cloud-base height.",
        ...buildCloudVisualMeta({
          fillClassName: "bg-amber-400",
          coverLevel: 4,
          coverLabel: "Mostly covered",
          baseFt: ceilingLayer?.baseFt ?? headlineLayer.baseFt,
        }),
      };
    case "OVC":
      return {
        badgeLabel: "Overcast",
        badgeClassName: "border-slate-200 bg-slate-100 text-slate-800",
        headline: "Gray sky overhead",
        detail: ceilingBaseLabel
          ? `The sky is fully covered by cloud. The cloud deck starts around ${ceilingBaseLabel} above the airport.`
          : "The sky is fully covered by cloud. The METAR did not include a usable cloud-base height.",
        ...buildCloudVisualMeta({
          fillClassName: "bg-slate-500",
          coverLevel: 5,
          coverLabel: "Full cover",
          baseFt: ceilingLayer?.baseFt ?? headlineLayer.baseFt,
        }),
      };
    case "VV":
      return {
        badgeLabel: "Obscured",
        badgeClassName: "border-rose-200 bg-rose-50 text-rose-800",
        headline: "Sky hidden by low cloud or fog",
        detail: ceilingBaseLabel
          ? `The sky is obscured. Vertical visibility is around ${ceilingBaseLabel} above the airport.`
          : "The sky is obscured in the latest official METAR.",
        ...buildCloudVisualMeta({
          fillClassName: "bg-rose-400",
          coverLevel: 5,
          coverLabel: "Obscured",
          baseFt: ceilingLayer?.baseFt ?? headlineLayer.baseFt,
        }),
      };
    default:
      return {
        badgeLabel: "Unknown",
        badgeClassName: "border-black/10 bg-black/[0.04] text-black/65",
        headline: "Clouds not reported",
        detail: "The latest official METAR did not include a cloud layer I can summarize.",
        showVisuals: false,
      };
  }
}

function selectLatestLiveCloudMetar(raceRows, latestRow, summary, isToday) {
  if (isToday && typeof latestRow?.rawMetar === "string" && latestRow.rawMetar.trim()) {
    return {
      rawMetar: latestRow.rawMetar,
      observedAtUtc: Number.isFinite(latestRow?.obsTimeUtc) ? latestRow.obsTimeUtc : null,
      reportType: latestRow?.reportType ?? null,
    };
  }

  for (const row of raceRows) {
    const rawMetar =
      row?.rawMetar ?? row?.aemetRawMetar ?? row?.tgftpRawMetar ?? null;
    if (typeof rawMetar === "string" && rawMetar.trim()) {
      return {
        rawMetar,
        observedAtUtc: Number.isFinite(row?.reportTsUtc) ? row.reportTsUtc : null,
        reportType: row?.reportType ?? null,
      };
    }
  }

  if (isToday && typeof summary?.latestRawMetar === "string" && summary.latestRawMetar.trim()) {
    return {
      rawMetar: summary.latestRawMetar,
      observedAtUtc: Number.isFinite(summary?.latestObsTimeUtc)
        ? summary.latestObsTimeUtc
        : null,
      reportType: summary?.latestReportType ?? null,
    };
  }

  return null;
}

function formatLivePollMessage(result) {
  if (!result?.ok) {
    return "Latest official poll skipped.";
  }

  const firstSeenText = Number.isFinite(result.row?.aemetFirstSeenAt)
    ? formatMadridDateTimeSeconds(result.row.aemetFirstSeenAt)
    : null;
  const lagText = Number.isFinite(result.availabilityLagMs)
    ? `${Math.max(0, result.availabilityLagMs / 60000).toFixed(1)} min lag`
    : null;

  return `Latest official poll: ${result.insertedCount > 0 ? "saved" : "no new report"} ${result.row?.reportType ?? "message"} ${result.row?.obsTimeLocal ?? ""}.${firstSeenText ? ` First seen ${firstSeenText}${lagText ? ` (${lagText})` : ""}.` : ""}`;
}

function buildOfficialLineDataset(rows, unit) {
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
    label: "Official AEMET",
    data: points,
    borderColor: "#b91c1c",
    backgroundColor: "#b91c1c",
    pointRadius: points.map((point) => (point.reportType === "SPECI" ? 4.5 : 2.5)),
    pointHoverRadius: points.map((point) => (point.reportType === "SPECI" ? 6 : 4)),
    tension: 0.2,
  };
}

function buildAemetForecastDataset(forecastRows, unit) {
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
    label: "AEMET Hourly Forecast",
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

function buildAemetStationObsDataset(obsRows, unit) {
  const points = obsRows
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
    label: "AEMET Station (0.1°C)",
    data: points,
    borderColor: "#16a34a",
    backgroundColor: "#16a34a",
    pointRadius: 3,
    pointHoverRadius: 5,
    pointHitRadius: 18,
    pointStyle: "rect",
    pointBorderColor: "#15803d",
    pointBorderWidth: 1.5,
    borderWidth: 2,
    tension: 0.2,
    showLine: true,
  };
}

function buildSynopDataset(synopRows, unit) {
  const points = synopRows
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
    label: "SYNOP (0.1°C)",
    data: points,
    borderColor: "#7c3aed",
    backgroundColor: "#7c3aed",
    pointRadius: 4,
    pointHoverRadius: 6,
    pointHitRadius: 18,
    pointStyle: "crossRot",
    pointBorderColor: "#6d28d9",
    pointBorderWidth: 2,
    borderWidth: 2,
    tension: 0.2,
    showLine: true,
  };
}

export default function MadridDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const [displayUnit, setDisplayUnit] = useState("C");
  const [inputDate, setInputDate] = useState(date);
  const [liveMessage, setLiveMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [clockNowMs, setClockNowMs] = useState(null);
  const inFlightRef = useRef(false);

  const isDateValid = isValidDate(date);
  const madridTodayDate = madridTodayKey();
  const isToday = isDateValid && date === madridTodayDate;
  const quickPreviousDates = useMemo(() => buildPreviousDateKeys(date, 2), [date]);

  const pollLatest = useAction("madrid:pollLatestStationMetar");
  const pollStationObs = useAction("madrid:pollAemetStationObservations");
  const pollSynop = useAction("madrid:pollSynopObservations");

  const dayData = useQuery(
    "madrid:getDayStationRows",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const aemetForecastData = useQuery(
    "madrid:getAemetHourlyForecasts",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const aemetStationObsData = useQuery(
    "madrid:getAemetStationObservations",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const synopData = useQuery(
    "madrid:getSynopObservations",
    isDateValid
      ? {
          stationIcao: STATION_ICAO,
          date,
        }
      : "skip",
  );
  const raceData = useQuery("madrid:getRecentPublishRaceReports", {
    stationIcao: STATION_ICAO,
    limit: 12,
    routineOnly: true,
  });

  const rows = dayData?.rows ?? [];
  const summary = dayData?.summary ?? null;
  const aemetForecastRows = aemetForecastData?.rows ?? [];
  const aemetStationObsRows = aemetStationObsData?.rows ?? [];
  const synopRows = synopData?.rows ?? [];
  const raceRows = raceData?.rows ?? [];
  const latestRow = rows.length ? rows[rows.length - 1] : null;
  const latestTemp = displayUnit === "C" ? summary?.latestTempC : summary?.latestTempF;
  const maxTemp = displayUnit === "C" ? summary?.maxTempC : summary?.maxTempF;
  const minTemp = displayUnit === "C" ? summary?.minTempC : summary?.minTempF;
  const latestLiveCloudMetar = useMemo(
    () => selectLatestLiveCloudMetar(raceRows, latestRow, summary, isToday),
    [raceRows, latestRow, summary, isToday],
  );
  const liveCloudSummary = useMemo(
    () => summarizeMetarClouds(latestLiveCloudMetar?.rawMetar),
    [latestLiveCloudMetar],
  );

  useEffect(() => {
    setInputDate(date);
  }, [date]);

  useEffect(() => {
    setClockNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!isDateValid) {
      setLiveMessage("");
      return;
    }
    if (!isToday) {
      setLiveMessage(
        "Historical LEMD dates depend on previously captured live AEMET rows. No date-bounded official history backfill is wired yet.",
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
        const [result] = await Promise.all([
          pollLatest({ stationIcao: STATION_ICAO }),
          pollStationObs({ stationIcao: STATION_ICAO }).catch(() => {}),
          pollSynop({ stationIcao: STATION_ICAO }).catch(() => {}),
        ]);
        if (!cancelled) {
          setLiveMessage(formatLivePollMessage(result));
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setLiveMessage(`LEMD sync failed: ${message}`);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [date, isDateValid, isToday, pollLatest, pollStationObs, pollSynop]);

  async function handleRefreshNow() {
    if (!isDateValid || !isToday || inFlightRef.current) {
      return;
    }

    setIsRefreshing(true);
    inFlightRef.current = true;
    try {
      const [result] = await Promise.all([
        pollLatest({ stationIcao: STATION_ICAO }),
        pollStationObs({ stationIcao: STATION_ICAO }).catch(() => {}),
        pollSynop({ stationIcao: STATION_ICAO }).catch(() => {}),
      ]);
      setLiveMessage(formatLivePollMessage(result));
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
    router.push(`/madrid/day/${inputDate}`);
  }

  const chartData = useMemo(
    () => {
      const datasets = [];
      if (rows.length) {
        datasets.push(buildOfficialLineDataset(rows, displayUnit));
      }
      const stationDs = buildAemetStationObsDataset(aemetStationObsRows, displayUnit);
      if (stationDs) {
        datasets.push(stationDs);
      }
      const synopDs = buildSynopDataset(synopRows, displayUnit);
      if (synopDs) {
        datasets.push(synopDs);
      }
      const fcDs = buildAemetForecastDataset(aemetForecastRows, displayUnit);
      if (fcDs) {
        datasets.push(fcDs);
      }
      return { datasets };
    },
    [rows, displayUnit, aemetStationObsRows, synopRows, aemetForecastRows],
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
          title: { display: true, text: "Local Time (Europe/Madrid)" },
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
          <h1 className="text-2xl font-semibold text-red-800">Invalid Madrid date</h1>
          <p className="mt-2 text-sm text-red-700">
            Use a `YYYY-MM-DD` date in the route.
          </p>
          <div className="mt-4">
            <Link
              href="/madrid/today"
              className="inline-flex rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-800"
            >
              Open Madrid today
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
            Official LEMD METAR and SPECI from AEMET&apos;s authenticated AMA
            portal, stored live and compared against NOAA `tgftp` in a
            publish-race table.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
            >
              Home
            </Link>
            <Link
              href="/madrid/today"
              className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 hover:border-rose-400"
            >
              Current Date {madridTodayDate}
            </Link>
            {quickPreviousDates.map((previousDate) => (
              <Link
                key={previousDate}
                href={`/madrid/day/${previousDate}`}
                className="inline-flex rounded-full border border-black/15 bg-white/70 px-4 py-2 text-sm font-semibold text-black hover:border-black"
              >
                {previousDate}
              </Link>
            ))}
          </div>

          <form
            onSubmit={handleGoToDate}
            className="mt-4 flex flex-wrap items-center gap-3"
          >
            <label className="text-sm font-medium text-black/70" htmlFor="madrid-day-picker">
              Pick Date
            </label>
            <input
              id="madrid-day-picker"
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
              {isRefreshing ? "Refreshing..." : "Refresh Current Data"}
            </button>
            {isToday ? (
              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-emerald-800">
                Live official ingest enabled
              </span>
            ) : (
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-amber-900">
                Historical capture only
              </span>
            )}
          </div>

          <div className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
            <span className="font-semibold uppercase tracking-[0.16em] text-sky-800">
              Madrid Time
            </span>
            <span className="font-medium">{formatMadridClock(clockNowMs)}</span>
          </div>

          <p className="mt-4 text-sm text-black/70">
            {liveMessage ||
              (isToday
                ? "Waiting for AEMET sync..."
                : "Historical LEMD dates depend on previously captured live official rows.")}
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
              Routine LEMD METAR is normally half-hourly. Full-day coverage
              depends on rows being captured live because this page stores the
              latest authenticated AMA result rather than a confirmed history
              endpoint.
            </p>
          </div>

          <div className="rounded-3xl border border-line/70 bg-white/90 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
              Near-Live Sky
            </p>
            {liveCloudSummary ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${liveCloudSummary.badgeClassName}`}
                  >
                    {liveCloudSummary.badgeLabel}
                  </span>
                  <span className="text-sm font-semibold text-black/85">
                    {liveCloudSummary.headline}
                  </span>
                </div>
                {liveCloudSummary.showVisuals ? (
                  <div className="mt-3 rounded-2xl border border-black/10 bg-[linear-gradient(180deg,rgba(224,242,254,0.8),rgba(255,255,255,0.95))] p-3">
                    <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-black/50">
                      <span>Sky Cover</span>
                      <span>{liveCloudSummary.coverLabel}</span>
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <span
                          key={`madrid-cloud-cover-${index}`}
                          className={`h-2.5 flex-1 rounded-full ${
                            index < liveCloudSummary.coverLevel
                              ? liveCloudSummary.fillClassName
                              : "bg-white/80"
                          }`}
                        />
                      ))}
                    </div>
                    {liveCloudSummary.baseVisual ? (
                      <>
                        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-black/50">
                          <span>Cloud Base</span>
                          <span>{liveCloudSummary.baseVisual.label}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                          {["Low", "Mid", "High"].map((label, index) => {
                            const isActive = index === liveCloudSummary.baseVisual.tierIndex;
                            return (
                              <span
                                key={`madrid-cloud-base-${label}`}
                                className={`rounded-full border px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] ${
                                  isActive
                                    ? liveCloudSummary.baseVisual.className
                                    : "border-black/10 bg-white/80 text-black/45"
                                }`}
                              >
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <p className="mt-3 text-sm text-black/65">
                  {liveCloudSummary.detail}
                </p>
                <p className="mt-2 text-xs text-black/55">
                  From the latest official LEMD{" "}
                  {latestLiveCloudMetar?.reportType ?? "METAR"}
                  {Number.isFinite(latestLiveCloudMetar?.observedAtUtc)
                    ? ` at ${formatMadridDateTimeSeconds(latestLiveCloudMetar.observedAtUtc)}.`
                    : "."}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-xl font-semibold text-foreground">—</p>
                <p className="mt-2 text-sm text-black/65">
                  Cloud conditions not available yet from the latest official LEMD METAR.
                </p>
              </>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {(() => {
            const latestStn = aemetStationObsRows.length
              ? aemetStationObsRows[aemetStationObsRows.length - 1]
              : null;
            const stnTemp = latestStn
              ? displayUnit === "C" ? latestStn.tempC : latestStn.tempF
              : null;
            return (
              <div className="rounded-3xl border border-emerald-200/70 bg-emerald-50/40 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700/70">
                  AEMET Station 3129 (0.1°C)
                </p>
                <p className="mt-2 text-3xl font-semibold text-emerald-900">
                  {stnTemp !== null ? formatTemp(stnTemp, displayUnit) : "—"}
                </p>
                <p className="mt-2 text-sm text-emerald-900/65">
                  {latestStn
                    ? `at ${formatStoredLocalDateTime(latestStn.obsTimeLocal)}`
                    : "No station observations yet"}
                </p>
              </div>
            );
          })()}
          {(() => {
            const latestSyn = synopRows.length
              ? synopRows[synopRows.length - 1]
              : null;
            const synTemp = latestSyn
              ? displayUnit === "C" ? latestSyn.tempC : latestSyn.tempF
              : null;
            return (
              <div className="rounded-3xl border border-violet-200/70 bg-violet-50/40 p-5 shadow-[0_12px_28px_rgba(37,35,27,0.06)]">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700/70">
                  SYNOP 08221 (0.1°C)
                </p>
                <p className="mt-2 text-3xl font-semibold text-violet-900">
                  {synTemp !== null ? formatTemp(synTemp, displayUnit) : "—"}
                </p>
                <p className="mt-2 text-sm text-violet-900/65">
                  {latestSyn
                    ? `at ${formatStoredLocalDateTime(latestSyn.obsTimeLocal)}`
                    : "No SYNOP observations yet"}
                </p>
              </div>
            );
          })()}
        </section>

        <section className="rounded-3xl border border-line/80 bg-white/95 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Temperature Line
              </h2>
              <p className="mt-1 text-sm text-black/60">
                Stored official LEMD METAR and SPECI rows captured from AEMET
                AMA.
              </p>
            </div>
          </div>

          <div className="mt-6 h-[420px]">
            {chartData.datasets.length ? (
              <Line data={chartData} options={chartOptions} />
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-black/15 bg-black/[0.02] text-sm text-black/55">
                No LEMD official observations stored for this date yet.
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Publish Race</h2>
              <p className="mt-1 text-sm text-black/60">
                Recent routine half-hour LEMD METAR first-seen timing across the
                official AEMET AMA portal and NOAA `tgftp`. Times in this table
                are shown in America/Chicago. A 1-second watch starts at `:03`
                and `:33` each hour and runs for six minutes, because the new
                Madrid METAR typically appears around `:04` and `:34` rather
                than exactly on the hour or half-hour boundary.
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
                  <th className="px-3 py-2 font-semibold">AEMET Seen</th>
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
                            row.winner === "aemet"
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
                        {formatChicagoDateTimeSeconds(row.aemetFirstSeenAt)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatChicagoDateTimeSeconds(row.tgftpFirstSeenAt)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-black/60">
                        {formatChicagoDateTimeSeconds(row.tgftpLastModifiedAt)}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-black/80">
                        {row.rawMetar ?? row.aemetRawMetar ?? row.tgftpRawMetar ?? "—"}
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
                        {row.aemetFirstSeenAt
                          ? formatMadridDateTimeSeconds(row.aemetFirstSeenAt)
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
