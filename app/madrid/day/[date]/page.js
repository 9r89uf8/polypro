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
const ROUTINE_METAR_INTERVAL_MS = 30 * 60 * 1000;
const ROUTINE_METAR_FALLBACK_LAG_MS = 4 * 60 * 1000 + 20 * 1000;
const DATIS_INTERVAL_MS = 10 * 60 * 1000;
const STATION_OBSERVATION_INTERVAL_MS = 60 * 60 * 1000;
const STATION_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MADRID_DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MADRID_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const MADRID_SCHEDULE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
});
const MADRID_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZoneName: "short",
});
const MADRID_STORED_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const MADRID_MINUTE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

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

function madridDateKeyForEpoch(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const parts = getDateParts(MADRID_DATE_KEY_FORMATTER, new Date(epochMs));
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
  return MADRID_TIME_FORMATTER.format(new Date(epochMs));
}

function formatMadridScheduleTime(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return MADRID_SCHEDULE_TIME_FORMATTER.format(new Date(epochMs));
}

function formatMadridClock(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return {
      time: "—",
      date: "Madrid local time",
    };
  }
  const parts = getDateParts(MADRID_CLOCK_FORMATTER, new Date(epochMs));
  return {
    time: `${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod}`,
    date: `${parts.weekday}, ${parts.month} ${parts.day} · ${parts.timeZoneName}`,
  };
}

function formatMadridStoredDateTime(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const parts = getDateParts(MADRID_STORED_TIME_FORMATTER, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function madridMinuteNow(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const parts = getDateParts(MADRID_MINUTE_FORMATTER, new Date(epochMs));
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

function isRoutineMetarRow(row) {
  const minute = parseLocalMinute(row?.obsTimeLocal);
  const rawMetar = String(row?.rawMetar ?? "").trim();
  return (
    row?.reportType !== "SPECI" &&
    !/^SPECI\b/i.test(rawMetar) &&
    minute !== null &&
    minute % 30 === 0 &&
    Number.isFinite(row?.obsTimeUtc)
  );
}

function buildExpectedUpdateTiming({
  latestObservedAt,
  intervalMs,
  expectedLagMs,
  nowMs,
}) {
  if (!Number.isFinite(nowMs)) {
    return null;
  }

  if (!Number.isFinite(latestObservedAt)) {
    return null;
  }

  const observationAt = latestObservedAt + intervalMs;
  const expectedAt = observationAt + expectedLagMs;
  return {
    observationAt,
    expectedAt,
    isDue: nowMs >= expectedAt,
  };
}

function nextIntervalBoundary(nowMs, intervalMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(intervalMs)) {
    return null;
  }
  return (Math.floor(nowMs / intervalMs) + 1) * intervalMs;
}

function formatCountdown(expectedAt, nowMs) {
  if (!Number.isFinite(expectedAt) || !Number.isFinite(nowMs)) {
    return "—";
  }
  const remainingMs = expectedAt - nowMs;
  if (remainingMs <= 0) {
    return "Due now";
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function isDatisStreamConnectionPaused(streamData) {
  return (
    streamData?.connection?.enabled === false ||
    streamData?.connection?.status === "connection_disabled" ||
    streamData?.listener?.status === "connection_disabled" ||
    streamData?.status === "connection_disabled"
  );
}

function buildDatisStreamDisplay(streamData, nowMs) {
  if (streamData === undefined) {
    return {
      state: "Loading live stream status…",
      detail: null,
    };
  }
  if (streamData?.approval?.status === "approval_required") {
    return {
      state: "Live stream off — approval required",
      detail: null,
    };
  }
  if (isDatisStreamConnectionPaused(streamData)) {
    return {
      state: "Live stream paused — Airframes unavailable",
      detail: "Automatic reconnect disabled by Convex kill switch.",
    };
  }

  const listener = streamData?.listener;
  if (listener?.status === "queued") {
    return {
      state: "Live stream queued",
      detail: "Waiting for the supervised listener to start",
    };
  }
  if (listener?.status === "listening") {
    const lastMatchAge = formatObservationAge(listener.lastMatchAt, nowMs);
    return {
      state: "Live stream listening",
      detail: lastMatchAge
        ? `Last LEMD reply captured ${lastMatchAge}`
        : "No LEMD reply captured yet",
    };
  }
  if (listener?.status === "backoff") {
    return {
      state: "Live stream unavailable",
      detail: Number.isFinite(listener.retryAfterAt)
        ? `Retry in ${formatCountdown(listener.retryAfterAt, nowMs)}`
        : "Automatic recovery pending",
    };
  }
  if (listener?.status === "stale") {
    return {
      state: "Live stream disconnected",
      detail: "Automatic recovery pending",
    };
  }
  return {
    state: "Live stream connecting…",
    detail: "Waiting for the Airframes subscription acknowledgement",
  };
}

function buildDatisLookupDisplay(datisData) {
  if (datisData === undefined) {
    return "1-min lookup loading…";
  }
  if (datisData?.approval?.status === "approval_required") {
    return "1-min lookup off";
  }
  if (datisData?.collector?.status === "fetching") {
    return "1-min lookup checking";
  }
  if (datisData?.collector?.status === "rate_limited") {
    return "1-min lookup paused";
  }
  if (datisData?.collector?.status === "error") {
    return "1-min lookup unavailable";
  }
  return "1-min lookup active";
}

function formatElapsedDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "less than a minute";
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
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

function latestDatisByReportTime(rows) {
  let latest = null;
  for (const row of rows) {
    if (!Number.isFinite(row?.reportTsUtc)) {
      continue;
    }
    if (
      !latest ||
      row.reportTsUtc > latest.reportTsUtc ||
      (row.reportTsUtc === latest.reportTsUtc &&
        row.receivedAtUtc < latest.receivedAtUtc)
    ) {
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

function isRoutineRaceRow(row) {
  if (!Number.isFinite(row?.reportTsUtc)) {
    return false;
  }
  const reportMinute = Math.floor(row.reportTsUtc / 60000) % 60;
  return (
    row.reportType !== "SPECI" &&
    !/^SPECI\b/i.test(String(getRaceRawMetar(row) ?? "").trim()) &&
    reportMinute % 30 === 0
  );
}

function getRecentRoutineMetarLagMs(raceRows) {
  const lags = raceRows
    .filter((row) => isRoutineRaceRow(row))
    .map((row) => {
      const firstSeenAt = getRaceFirstSeen(row);
      return Number.isFinite(firstSeenAt) ? firstSeenAt - row.reportTsUtc : null;
    })
    .filter(
      (lagMs) =>
        Number.isFinite(lagMs) &&
        lagMs >= 0 &&
        lagMs <= 15 * 60 * 1000,
    )
    .slice(0, 24)
    .sort((a, b) => a - b);

  if (!lags.length) {
    return ROUTINE_METAR_FALLBACK_LAG_MS;
  }
  const midpoint = Math.floor(lags.length / 2);
  return lags.length % 2
    ? lags[midpoint]
    : (lags[midpoint - 1] + lags[midpoint]) / 2;
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

function mergeDatisRows(lookupRows, streamRows) {
  const canonical = new Map();
  for (const [deliveryPath, rows] of [
    ["lookup", lookupRows],
    ["stream", streamRows],
  ]) {
    for (const row of rows) {
      if (!Number.isFinite(row?.reportTsUtc)) {
        continue;
      }
      const reportIdentity = `${row.reportKind}:${row.designator}:${row.reportTsUtc}`;
      const candidate = {
        ...row,
        deliveryPath: row.deliveryPath ?? deliveryPath,
      };
      const existing = canonical.get(reportIdentity);
      if (!existing) {
        canonical.set(reportIdentity, {
          ...candidate,
          deliveryPaths: [candidate.deliveryPath],
          firstSeenVia: candidate.deliveryPath,
          transportConflict: false,
        });
        continue;
      }

      const deliveryPaths = [
        ...new Set([
          ...(existing.deliveryPaths ?? [existing.deliveryPath]),
          candidate.deliveryPath,
        ]),
      ];
      const candidateWins =
        candidate.receivedAtUtc < existing.receivedAtUtc ||
        (candidate.receivedAtUtc === existing.receivedAtUtc &&
          candidate.reportKind === "ARR" &&
          existing.reportKind !== "ARR") ||
        (candidate.receivedAtUtc === existing.receivedAtUtc &&
          candidate.reportKind === existing.reportKind &&
          candidate.designator.localeCompare(existing.designator) < 0);
      const winner = candidateWins ? candidate : existing;
      canonical.set(reportIdentity, {
        ...winner,
        deliveryPaths,
        firstSeenVia: candidateWins
          ? candidate.deliveryPath
          : existing.firstSeenVia,
        transportConflict:
          existing.transportConflict ||
          candidate.tempC !== existing.tempC ||
          candidate.dewPointC !== existing.dewPointC,
      });
    }
  }
  return [...canonical.values()].sort(
    (a, b) =>
      a.reportTsUtc - b.reportTsUtc ||
      a.receivedAtUtc - b.receivedAtUtc,
  );
}

function buildFreshestAirportReading(metarRows, stationRows, latestDatis) {
  const latestMetar = latestByTimestamp(metarRows, "obsTimeUtc");
  const latestStation = latestByTimestamp(stationRows, "obsTimeUtc");
  const candidates = [
    latestDatis
      ? {
          kind: "datis",
          source:
            latestDatis.firstSeenVia === "stream"
              ? "D-ATIS via Airframes live stream"
              : "D-ATIS via Airframes lookup",
          cadence: "Nominal 10-minute cycle; relay capture is not guaranteed",
          precision: "Whole-degree operational report",
          priority: 3,
          observedAt: latestDatis.reportTsUtc,
          observedAtLocal: latestDatis.reportTimeLocal,
          receivedAt: latestDatis.receivedAtUtc,
          deliveryLagMs: latestDatis.deliveryLagMs,
          reportKind: latestDatis.reportKind,
          designator: latestDatis.designator,
          firstSeenVia: latestDatis.firstSeenVia,
          tempC: latestDatis.tempC,
          tempF: latestDatis.tempF,
        }
      : null,
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
    latestDatis,
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

function buildDatisDataset(rows, unit) {
  const points = rows
    .map((row) => {
      const x = madridMinuteNow(row.reportTsUtc);
      const y = temperatureForUnit(row, unit);
      return x === null || !Number.isFinite(y)
        ? null
        : {
            x,
            y,
            kind: "datis",
            source:
              row.firstSeenVia === "stream"
                ? "D-ATIS first seen via live stream"
                : "D-ATIS first seen via one-minute lookup",
            reportKind: row.reportKind,
            designator: row.designator,
            receivedAtUtc: row.receivedAtUtc,
            deliveryLagMs: row.deliveryLagMs,
            firstSeenVia: row.firstSeenVia,
            deliveryPaths: row.deliveryPaths,
            transportConflict: row.transportConflict,
          };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);

  return points.length
    ? {
        label: "D-ATIS operational temp",
        data: points,
        borderColor: "#7c3aed",
        backgroundColor: "#7c3aed",
        pointBorderColor: "#5b21b6",
        pointBorderWidth: 1.5,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointHitRadius: 20,
        pointStyle: "star",
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
  return (
    <span
      aria-hidden="true"
      className={`h-2.5 w-2.5 rounded-full ${toneClass}`}
    />
  );
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
  const today = madridDateKeyForEpoch(nowMs);
  const isToday = isDateValid && today !== null && date === today;

  const pollLatestNoaaMetar = useAction("madrid:pollLatestNoaaPublishRace");
  const pollAirframesDatis = useAction("madridDatis:pollAirframesDatis");

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
  const previousStationData = useQuery(
    "madrid:getAemetStationObservations",
    isToday
      ? {
          stationIcao: STATION_ICAO,
          date: shiftDateKey(date, -1),
        }
      : "skip",
  );
  const raceData = useQuery(
    "madrid:getRecentPublishRaceReports",
    isDateValid
      ? { stationIcao: STATION_ICAO, limit: 48, routineOnly: false }
      : "skip",
  );
  const datisData = useQuery(
    "madridDatis:getDatisObservations",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const datisStreamData = useQuery(
    "madridDatisStream:getStreamObservations",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );

  const storedMetarRows = dayData?.rows ?? [];
  const forecastRows = forecastData?.rows ?? [];
  const stationRows = stationData?.rows ?? [];
  const previousStationRows = previousStationData?.rows ?? [];
  const raceRows = raceData?.rows ?? [];
  const datisLookupRows = datisData?.rows ?? [];
  const datisStreamRows = datisStreamData?.rows ?? [];
  const datisAccessStatus = datisData?.approval?.status;
  const datisReady = datisAccessStatus === "approved";
  const datisStreamAccessStatus = datisStreamData?.approval?.status;
  const datisStreamReady = datisStreamAccessStatus === "approved";
  const datisStreamConnectionPaused =
    isDatisStreamConnectionPaused(datisStreamData);
  const datisStreamCollecting =
    datisStreamReady && !datisStreamConnectionPaused;
  const datisAccessLoading =
    datisData === undefined || datisStreamData === undefined;
  const datisAvailable = datisReady || datisStreamReady;
  const datisCaptureAvailable = datisReady || datisStreamCollecting;
  const datisRows = useMemo(
    () => mergeDatisRows(datisLookupRows, datisStreamRows),
    [datisLookupRows, datisStreamRows],
  );
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
    raceData === undefined ||
    datisData === undefined ||
    datisStreamData === undefined;
  const isTimingLoading =
    isLoading || (isToday && previousStationData === undefined);

  const forecastPeak = useMemo(
    () => buildForecastPeak(forecastRows),
    [forecastRows],
  );
  const latestDatis = useMemo(
    () =>
      isToday
        ? latestDatisByReportTime(
            mergeDatisRows(
              datisData?.latest ? [datisData.latest] : [],
              datisStreamData?.latest ? [datisStreamData.latest] : [],
            ),
          )
        : latestDatisByReportTime(datisRows),
    [
      datisData?.latest,
      datisRows,
      datisStreamData?.latest,
      isToday,
    ],
  );
  const airportReading = useMemo(
    () => buildFreshestAirportReading(metarRows, stationRows, latestDatis),
    [latestDatis, metarRows, stationRows],
  );
  const latestRoutineMetar = useMemo(
    () =>
      latestByTimestamp(
        metarRows.filter((row) => isRoutineMetarRow(row)),
        "obsTimeUtc",
      ),
    [metarRows],
  );
  const latestRoutineRaceReport = useMemo(
    () =>
      latestByTimestamp(
        raceRows.filter((row) => isRoutineRaceRow(row)),
        "reportTsUtc",
      ),
    [raceRows],
  );
  const latestScheduleStation = useMemo(
    () =>
      latestByTimestamp(
        [...previousStationRows, ...stationRows],
        "obsTimeUtc",
      ),
    [previousStationRows, stationRows],
  );
  const routineMetarExpectedLagMs = useMemo(
    () => getRecentRoutineMetarLagMs(raceRows),
    [raceRows],
  );

  const freshest = airportReading.freshest;
  const freshestTemperature = temperatureForUnit(freshest, unit);
  const latestMetarTemperature = temperatureForUnit(
    airportReading.latestMetar,
    unit,
  );
  const latestDatisTemperature = temperatureForUnit(
    airportReading.latestDatis,
    unit,
  );
  const forecastMax = celsiusForUnit(forecastPeak?.maxTempC, unit);
  const observationAge = formatObservationAge(freshest?.observedAt, nowMs);
  const latestDatisReportAge = formatObservationAge(
    airportReading.latestDatis?.reportTsUtc,
    nowMs,
  );
  const latestDatisReceiptAge = formatObservationAge(
    airportReading.latestDatis?.receivedAtUtc,
    nowMs,
  );
  const isFresh =
    isToday &&
    Number.isFinite(nowMs) &&
    Number.isFinite(freshest?.observedAt) &&
    nowMs - freshest.observedAt <= 75 * 60 * 1000;
  const readingTone = isFresh ? "live" : freshest ? "stale" : "empty";
  const madridClock = formatMadridClock(nowMs);
  const currentMadridMinute = isToday ? madridMinuteNow(nowMs) : null;
  const latestRoutineMetarObservedAt = Math.max(
    ...[
      latestRoutineMetar?.obsTimeUtc,
      latestRoutineRaceReport?.reportTsUtc,
    ].filter(Number.isFinite),
  );
  const nextMetarTiming = isToday
    ? buildExpectedUpdateTiming({
        latestObservedAt: Number.isFinite(latestRoutineMetarObservedAt)
          ? latestRoutineMetarObservedAt
          : null,
        intervalMs: ROUTINE_METAR_INTERVAL_MS,
        expectedLagMs: routineMetarExpectedLagMs,
        nowMs,
      })
    : null;
  const nextStationTiming = isToday
    ? buildExpectedUpdateTiming({
        latestObservedAt: latestScheduleStation?.obsTimeUtc,
        intervalMs: STATION_OBSERVATION_INTERVAL_MS,
        expectedLagMs: 0,
        nowMs,
      })
    : null;
  const nextStationCheckAt = isToday
    ? nextIntervalBoundary(nowMs, STATION_CHECK_INTERVAL_MS)
    : null;
  const nextDatisCycleAt = isToday
    ? nextIntervalBoundary(nowMs, DATIS_INTERVAL_MS)
    : null;
  const datisCountdownLabel =
    datisData === undefined || datisStreamData === undefined
      ? "Loading…"
      : !datisAvailable
        ? "Approval required"
        : !datisCaptureAvailable
          ? "Connection paused"
        : formatCountdown(nextDatisCycleAt, nowMs);
  const datisStreamDisplay = buildDatisStreamDisplay(
    datisStreamData,
    nowMs,
  );
  const datisLookupDisplay = buildDatisLookupDisplay(datisData);
  const metarFeedDelayed =
    isToday &&
    Number.isFinite(nowMs) &&
    Number.isFinite(latestRoutineMetarObservedAt) &&
    nowMs - latestRoutineMetarObservedAt > 90 * 60 * 1000;
  const stationFeedDelayed =
    isToday &&
    Number.isFinite(nowMs) &&
    Number.isFinite(latestScheduleStation?.obsTimeUtc) &&
    nowMs - latestScheduleStation.obsTimeUtc > 2 * 60 * 60 * 1000;
  const metarCountdownLabel = metarFeedDelayed
    ? "Feed delayed"
    : nextMetarTiming?.isDue
      ? "Awaiting"
      : formatCountdown(nextMetarTiming?.expectedAt, nowMs);
  const stationCountdownLabel = stationFeedDelayed
    ? "Feed delayed"
    : nextStationTiming?.isDue
      ? "Awaiting"
      : formatCountdown(nextStationTiming?.observationAt, nowMs);

  useEffect(() => {
    setDateInput(date);
  }, [date]);

  useEffect(() => {
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (
      !isToday ||
      datisData === undefined ||
      autoRefreshDateRef.current === date
    ) {
      return;
    }
    autoRefreshDateRef.current = date;
    let cancelled = false;

    async function refreshOnOpen() {
      setSyncMessage(
        datisReady
          ? "Checking the latest airport METAR and D-ATIS lookup…"
          : "Checking the latest airport METAR…",
      );
      const [metarResult, datisResult] = await Promise.allSettled([
        pollLatestNoaaMetar({ stationIcao: STATION_ICAO }),
        ...(datisReady
          ? [pollAirframesDatis({ stationIcao: STATION_ICAO })]
          : []),
      ]);
      if (!cancelled) {
        const datisFailed =
          datisReady &&
          (datisResult?.status === "rejected" ||
            !["ok", "no_data", "cooldown", "rate_limited"].includes(
              datisResult?.value?.status,
            ));
        if (metarResult.status === "fulfilled" && !datisFailed) {
          setSyncMessage(
            datisReady
              ? `Live METAR and D-ATIS lookup checked at ${formatMadridTime(Date.now())} Madrid time.`
              : `Live METAR checked at ${formatMadridTime(Date.now())} Madrid time; the one-minute D-ATIS lookup remains approval-gated.`,
          );
        } else if (metarResult.status === "fulfilled") {
          setSyncMessage(
            "Live METAR checked; the D-ATIS lookup failed and stored readings remain on screen.",
          );
        } else {
          setSyncMessage(
            "Live source check failed; showing the latest stored readings.",
          );
        }
      }
    }

    refreshOnOpen();
    return () => {
      cancelled = true;
    };
  }, [
    date,
    datisAccessStatus,
    datisData,
    datisReady,
    isToday,
    pollAirframesDatis,
    pollLatestNoaaMetar,
  ]);

  async function handleRefresh() {
    if (!isToday || isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    setSyncMessage(
      datisReady
        ? "Refreshing the latest airport METAR and D-ATIS lookup…"
        : "Refreshing the latest airport METAR…",
    );
    try {
      const [metarResult, datisResult] = await Promise.allSettled([
        pollLatestNoaaMetar({ stationIcao: STATION_ICAO }),
        ...(datisReady
          ? [pollAirframesDatis({ stationIcao: STATION_ICAO })]
          : []),
      ]);
      const datisFailed =
        datisReady &&
        (datisResult?.status === "rejected" ||
          !["ok", "no_data", "cooldown", "rate_limited"].includes(
            datisResult?.value?.status,
          ));
      const datisSucceeded =
        datisReady &&
        datisResult?.status === "fulfilled" &&
        ["ok", "no_data", "cooldown", "rate_limited"].includes(
          datisResult.value?.status,
        );
      if (metarResult.status === "rejected" && !datisSucceeded) {
        throw new Error("Live refresh failed.");
      }
      setSyncMessage(
        metarResult.status === "fulfilled" && !datisFailed
          ? datisReady
            ? `Live METAR and D-ATIS lookup checked at ${formatMadridTime(Date.now())} Madrid time.`
            : `Live METAR checked at ${formatMadridTime(Date.now())} Madrid time; the one-minute D-ATIS lookup remains approval-gated.`
          : metarResult.status === "fulfilled"
            ? "METAR refreshed; the D-ATIS lookup failed."
            : datisSucceeded
              ? "D-ATIS lookup refreshed; the METAR check failed."
              : "Live refresh failed; stored readings remain on screen.",
      );
    } catch {
      setSyncMessage(
        "Live refresh failed; the latest stored readings remain on screen.",
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
      buildDatisDataset(datisRows, unit),
      buildMetarDataset(metarRows, unit),
      buildPeakDataset(forecastPeak, unit),
    ].filter(Boolean);
    return { datasets };
  }, [datisRows, forecastPeak, forecastRows, metarRows, stationRows, unit]);

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

    if (Number.isFinite(currentMadridMinute)) {
      annotations.now = {
        type: "line",
        xMin: currentMadridMinute,
        xMax: currentMadridMinute,
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
      normalized: false,
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
              const temperature = formatTemperature(item.parsed.y, unit);
              if (item.raw?.kind === "datis") {
                return `${source}: ${temperature} · ${item.raw.reportKind} ${item.raw.designator} · relayed in ${formatElapsedDuration(item.raw.deliveryLagMs)}${item.raw.transportConflict ? " · transport values differed" : ""}`;
              }
              return `${source}: ${temperature}`;
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
  }, [currentMadridMinute, forecastPeak, unit]);

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
                station 3129 observations, official METAR actuals, and a
                separately labelled D-ATIS operational temperature relay on
                one Madrid-time timeline.
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

        <section
          aria-label="Madrid live time and expected airport updates"
          className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#162f36] text-white shadow-[0_18px_55px_rgba(15,23,42,0.13)]"
        >
          <div
            className={`grid ${
              isToday ? "md:grid-cols-2 xl:grid-cols-4" : "lg:grid-cols-1"
            }`}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-7 lg:block lg:py-5">
              <div>
                <div className="flex items-center gap-2">
                  <StatusDot tone="live" />
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100/70">
                    Madrid now
                  </p>
                </div>
                <p className="mt-1 text-xs font-semibold text-white/60 lg:hidden">
                  {madridClock.date}
                </p>
              </div>
              <time
                data-testid="madrid-clock"
                dateTime={
                  Number.isFinite(nowMs)
                    ? new Date(nowMs).toISOString()
                    : undefined
                }
                className="block shrink-0 font-mono text-2xl font-semibold tabular-nums tracking-[-0.04em] text-white sm:text-3xl lg:mt-3 lg:text-4xl"
                aria-label={`Current time in Madrid: ${madridClock.time}`}
              >
                {madridClock.time}
              </time>
              <p className="mt-1 hidden text-sm font-semibold text-white/60 lg:block">
                {madridClock.date}
              </p>
            </div>

            {isToday && isTimingLoading ? (
              <div className="border-t border-white/10 px-5 py-5 text-sm font-semibold text-white/60 sm:px-7 md:col-span-1 md:border-l md:border-t-0 xl:col-span-3">
                Loading D-ATIS, METAR, and station schedules…
              </div>
            ) : isToday ? (
              <>
                <div
                  data-testid="datis-access-status"
                  className="border-t border-white/10 px-5 py-4 sm:px-7 md:border-l md:border-t-0 lg:py-5"
                >
                  <div className="flex items-start justify-between gap-4 lg:block">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-200/80">
                        Next nominal D-ATIS bulletin
                      </p>
                      <span className="hidden rounded-full border border-violet-200/20 bg-violet-200/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-100/75 sm:inline-flex">
                        Airframes D-ATIS
                      </span>
                    </div>
                    <p
                      data-testid="datis-countdown"
                      className={`shrink-0 font-mono font-semibold tabular-nums tracking-[-0.04em] lg:mt-3 ${
                        datisCaptureAvailable
                          ? "text-2xl text-white sm:text-3xl lg:text-4xl"
                          : "max-w-[15rem] text-right text-lg text-violet-200 sm:text-xl lg:text-left"
                      }`}
                      aria-label={`D-ATIS access and nominal-bulletin status: ${datisCountdownLabel}`}
                    >
                      {datisCountdownLabel}
                    </p>
                  </div>
                  <p className="mt-2 break-words text-xs leading-5 text-white/65 lg:text-sm">
                    {!datisAvailable ? (
                      <>
                        Both Airframes delivery paths require approval.
                      </>
                    ) : !datisCaptureAvailable ? (
                      <>
                        Streaming is approved, but the Airframes provider
                        connection is paused. No automatic reconnect is
                        scheduled.
                      </>
                    ) : (
                      <>
                        Next nominal bulletin boundary{" "}
                        {formatMadridScheduleTime(nextDatisCycleAt)} · community
                        capture can arrive later or not at all.
                      </>
                    )}
                  </p>
                  <p
                    data-testid="datis-stream-status"
                    className="mt-1 text-xs leading-5 text-white/60"
                  >
                    <span>{datisLookupDisplay}</span>
                    <span aria-hidden="true"> · </span>
                    <span aria-live="polite" aria-atomic="true">
                      {datisStreamDisplay.state}
                    </span>
                    {datisStreamDisplay.detail ? (
                      <span>
                        {" "}
                        · {datisStreamDisplay.detail}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 hidden text-xs text-white/60 lg:block">
                    D-ATIS normally cycles every ten minutes or on significant
                    change; aircraft-demand replies and the sampled stream are
                    not guaranteed.
                  </p>
                </div>

                <div className="border-t border-white/10 px-5 py-4 sm:px-7 xl:border-l xl:border-t-0 xl:py-5">
                  <div className="flex items-start justify-between gap-4 lg:block">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-200/75">
                        Next routine METAR expected
                      </p>
                      <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60 sm:inline-flex">
                        Estimated
                      </span>
                    </div>
                    <p
                      data-testid="metar-countdown"
                      className={`shrink-0 font-mono text-2xl font-semibold tabular-nums tracking-[-0.04em] sm:text-3xl lg:mt-3 lg:text-4xl ${
                        nextMetarTiming?.isDue
                          ? "text-amber-300"
                          : "text-white"
                      }`}
                      aria-label={`Time remaining before the next expected METAR: ${metarCountdownLabel}`}
                    >
                      {metarCountdownLabel}
                    </p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/65 lg:text-sm">
                    {nextMetarTiming ? (
                      nextMetarTiming.isDue ? (
                        <>
                          Awaiting the{" "}
                          {formatMadridScheduleTime(
                            nextMetarTiming.observationAt,
                          )}{" "}
                          report ·{" "}
                          {formatElapsedDuration(
                            nowMs - nextMetarTiming.expectedAt,
                          )}{" "}
                          later than usual
                        </>
                      ) : (
                        <>
                          {formatMadridScheduleTime(
                            nextMetarTiming.observationAt,
                          )}{" "}
                          report · expected around{" "}
                          {formatMadridScheduleTime(nextMetarTiming.expectedAt)}
                        </>
                      )
                    ) : (
                      "Routine METAR schedule unavailable."
                    )}
                  </p>
                  <p className="mt-1 hidden text-xs text-white/60 lg:block">
                    Recent first-seen lag is about{" "}
                    {formatElapsedDuration(routineMetarExpectedLagMs)}. SPECI can
                    arrive at any time.
                  </p>
                </div>

                <div className="border-t border-white/10 px-5 py-4 sm:px-7 md:border-l xl:border-t-0 xl:py-5">
                  <div className="flex items-start justify-between gap-4 lg:block">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-200/75">
                        Next 0.1°C observation
                      </p>
                      <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60 sm:inline-flex">
                        Station 3129
                      </span>
                    </div>
                    <p
                      data-testid="station-countdown"
                      className={`shrink-0 font-mono text-2xl font-semibold tabular-nums tracking-[-0.04em] sm:text-3xl lg:mt-3 lg:text-4xl ${
                        nextStationTiming?.isDue
                          ? "text-sky-300"
                          : "text-white"
                      }`}
                      aria-label={`Time remaining before the next expected station temperature observation: ${stationCountdownLabel}`}
                    >
                      {stationCountdownLabel}
                    </p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/65 lg:text-sm">
                    {nextStationTiming ? (
                      nextStationTiming.isDue ? (
                        <>
                          Awaiting the{" "}
                          {formatMadridScheduleTime(
                            nextStationTiming.observationAt,
                          )}{" "}
                          station reading · next source check in{" "}
                          {formatCountdown(nextStationCheckAt, nowMs)}
                        </>
                      ) : (
                        <>
                          Nominal{" "}
                          {formatMadridScheduleTime(
                            nextStationTiming.observationAt,
                          )}{" "}
                          observation · next source check in{" "}
                          {formatCountdown(nextStationCheckAt, nowMs)}
                        </>
                      )
                    ) : (
                      "Station observation schedule unavailable."
                    )}
                  </p>
                  <p className="mt-1 hidden text-xs text-white/60 lg:block">
                    Station 3129 is hourly. A ten-minute source check does not
                    guarantee a new temperature.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </section>

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
                  {isToday
                    ? ` · ${formatObservationAge(freshest.receivedAt, nowMs)}`
                    : ""}
                  {freshest.kind === "datis" &&
                  Number.isFinite(freshest.deliveryLagMs)
                    ? ` · ${freshest.reportKind} ${freshest.designator} relayed ${formatElapsedDuration(freshest.deliveryLagMs)} after report time`
                    : ""}
                  {freshest.kind === "datis" && freshest.firstSeenVia
                    ? ` · first seen via ${freshest.firstSeenVia === "stream" ? "live stream" : "one-minute lookup"}`
                    : ""}
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
                    aria-pressed={unit === nextUnit}
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
            <p id="madrid-chart-summary" className="sr-only">
              Temperature chart for {formatDateHeading(date)} with{" "}
              {forecastRows.length} hourly forecast points, {stationRows.length}{" "}
              station 3129 observations, {datisRows.length} D-ATIS operational
              temperature points, and {metarRows.length} METAR or SPECI actuals.
              The forecast maximum is{" "}
              {formatTemperature(forecastMax, unit)} at{" "}
              {forecastPeak?.peakTimeLabel ?? "an unavailable time"}.
            </p>
            <div
              className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
              role="region"
              aria-label="Scrollable 24-hour Madrid temperature chart"
              aria-describedby="madrid-chart-summary"
              tabIndex={0}
            >
              <div className="h-[430px] min-w-[820px] sm:h-[500px]">
                {chartData.datasets.length ? (
                  <Line
                    data={chartData}
                    options={chartOptions}
                    role="img"
                    aria-label="Madrid forecast, D-ATIS operational temperatures, and airport actuals"
                  />
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

          <div className="grid border-t border-slate-900/8 sm:grid-cols-2 xl:grid-cols-4">
            <div className="border-b border-slate-900/8 px-5 py-4 sm:border-r sm:px-7 xl:border-b-0">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-amber-700">
                Forecast
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                AEMET hourly municipal forecast, with every tied maximum marked.
              </p>
            </div>
            <div className="border-b border-slate-900/8 px-5 py-4 sm:border-r sm:px-7 xl:border-b-0">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">
                Airport station
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                AEMET 3129 is airport-based and precise to 0.1°C, but reported
                hourly.
              </p>
            </div>
            <div className="border-b border-slate-900/8 px-5 py-4 sm:border-b-0 sm:border-r sm:px-7 xl:border-r">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-violet-700">
                D-ATIS operational temp
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                {datisAccessLoading
                  ? "Loading D-ATIS access and transport status…"
                  : !datisAvailable
                  ? "Neither separately gated Airframes delivery path is approved. No protected D-ATIS rows are exposed."
                  : datisStreamReady && datisStreamConnectionPaused
                    ? datisReady
                      ? `Whole-degree LEMD ARR/DEP values remain available through the one-minute lookup. Streaming is approved, but the Airframes connection and automatic reconnects are paused by ${datisStreamData?.connection?.flagName ?? "the Convex connection kill switch"}.`
                      : `Previously stored, approved stream values may remain visible, but new streaming capture and automatic reconnects are paused by ${datisStreamData?.connection?.flagName ?? "the Convex connection kill switch"}. The one-minute lookup remains off pending ${datisData?.approval?.flagName ?? "Convex approval"}.`
                    : datisReady && !datisStreamReady
                    ? `Whole-degree LEMD ARR/DEP values from the one-minute lookup. The sampled live stream remains off pending ${datisStreamData?.approval?.flagName ?? "Convex approval"}.`
                    : !datisReady && datisStreamReady
                      ? `Whole-degree LEMD ARR/DEP values from the sampled live stream. The one-minute lookup remains off pending ${datisData?.approval?.flagName ?? "Convex approval"}.`
                      : "One-minute lookup and sampled live-stream receipts are deduplicated into this single D-ATIS series. Report time is plotted; capture is not guaranteed."}
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
          <div className="border-t border-slate-900/8 px-5 py-3 text-xs leading-5 text-slate-500 sm:px-7">
            This Airframes D-ATIS mirror is non-operational, not a direct
            sensor or guaranteed feed. Its one-minute lookup and optional
            sampled stream are delivery paths for the same chart series. Data
            provided by{" "}
            <a
              href="https://airframes.io"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2"
            >
              Airframes.io
            </a>{" "}
            and its community of feeders. Official voice/controller information
            prevails.
          </div>
        </section>

        <footer className="flex flex-col gap-2 px-2 pb-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite">
            {syncMessage ||
              (isToday
                ? "Chart updates automatically when Convex stores a new observation."
                : "Showing stored forecast and observations for the selected date.")}
          </p>
          <p className="flex flex-wrap gap-x-3">
            <span data-testid="latest-datis">
              Latest D-ATIS:{" "}
              <span className="font-bold text-violet-700">
                {datisAccessLoading
                  ? "Loading…"
                  : datisAvailable
                  ? formatTemperature(latestDatisTemperature, unit)
                  : "Approval required"}
              </span>
              {datisAvailable && airportReading.latestDatis
                ? ` at ${formatLocalTime(airportReading.latestDatis.reportTimeLocal)}`
                : ""}
              {datisAvailable &&
              isToday &&
              airportReading.latestDatis &&
              latestDatisReportAge &&
              latestDatisReceiptAge
                ? ` · report ${latestDatisReportAge} · relay received ${latestDatisReceiptAge} · first seen via ${airportReading.latestDatis.firstSeenVia === "stream" ? "live stream" : "one-minute lookup"}`
                : ""}
            </span>
            <span>
              Latest METAR:{" "}
              <span className="font-bold text-slate-700">
                {formatTemperature(latestMetarTemperature, unit)}
              </span>
              {airportReading.latestMetar
                ? ` at ${formatLocalTime(airportReading.latestMetar.obsTimeLocal)}`
                : ""}
            </span>
          </p>
        </footer>
      </div>
    </main>
  );
}
