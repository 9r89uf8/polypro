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

function drawMinuteBand(chart, startMinute, endMinute, fillStyle) {
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) {
    return;
  }

  const { ctx, chartArea, scales } = chart;
  const normalizedStart = normalizeCycle(startMinute, 1440);
  const normalizedEnd = normalizeCycle(endMinute, 1440);
  const segments =
    normalizedEnd > normalizedStart
      ? [[normalizedStart, normalizedEnd]]
      : [
          [normalizedStart, 1439],
          [0, normalizedEnd],
        ];

  ctx.save();
  ctx.fillStyle = fillStyle;
  for (const [start, end] of segments) {
    const left = Math.max(chartArea.left, scales.x.getPixelForValue(start));
    const right = Math.min(chartArea.right, scales.x.getPixelForValue(end));
    if (right > left) {
      ctx.fillRect(left, chartArea.top, right - left, chartArea.height);
    }
  }
  ctx.restore();
}

const peakTimingPlugin = {
  id: "seoulPeakTiming",
  beforeDatasetsDraw(chart, _args, options) {
    if (options?.typical?.display) {
      drawMinuteBand(
        chart,
        options.typical.windowStartMinute,
        options.typical.windowEndMinute,
        "rgba(167, 139, 250, 0.055)",
      );
    }
    if (options?.forecast?.display) {
      drawMinuteBand(
        chart,
        options.forecast.windowStartMinute,
        options.forecast.windowEndMinute,
        "rgba(251, 191, 36, 0.075)",
      );
    }
  },
  afterDatasetsDraw(chart, _args, options) {
    if (
      !options?.typical?.display ||
      !Number.isFinite(options.typical.medianMinute)
    ) {
      return;
    }

    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(options.typical.medianMinute);
    if (x < chartArea.left || x > chartArea.right) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = "rgba(167, 139, 250, 0.72)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();

    ctx.fillStyle = "#c4b5fd";
    ctx.font = "500 10px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      `${options.typical.title} · ${options.typical.label}`,
      x,
      chartArea.top + 12,
    );
    ctx.restore();
  },
};

const hourlyCloudCoverPlugin = {
  id: "seoulHourlyCloudCover",
  afterDraw(chart, _args, options) {
    const hours = Array.isArray(options?.hours) ? options.hours : [];
    if (!options?.display || !hours.length) {
      return;
    }

    const { ctx, chartArea, scales } = chart;
    const railHeight = 42;
    const railTop = chartArea.top - 51;
    const meterTop = railTop + 16;
    const meterHeight = railHeight - 18;

    ctx.save();
    ctx.fillStyle = "rgba(8, 18, 33, 0.96)";
    ctx.fillRect(
      chartArea.left,
      railTop,
      chartArea.right - chartArea.left,
      railHeight,
    );

    for (const hour of hours) {
      const left = Math.max(
        chartArea.left,
        scales.x.getPixelForValue(hour.startMinute),
      );
      const right = Math.min(
        chartArea.right,
        scales.x.getPixelForValue(hour.endMinute),
      );
      if (right <= left) {
        continue;
      }

      const cellWidth = right - left;
      const isForecast = hour.phase === "forecast";
      const isLive = hour.phase === "live";
      const accent = isForecast
        ? "rgba(56, 189, 248, 0.72)"
        : isLive
          ? "rgba(251, 191, 36, 0.78)"
          : "rgba(203, 213, 225, 0.72)";

      if (Number.isFinite(hour.coverPct)) {
        const fillHeight = Math.max(
          hour.coverPct > 0 ? 2 : 1,
          (meterHeight * hour.coverPct) / 100,
        );
        const fillTop = meterTop + meterHeight - fillHeight;
        ctx.fillStyle = accent;
        ctx.fillRect(left + 1, fillTop, Math.max(0, cellWidth - 2), fillHeight);

        if (isForecast) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(left + 1, fillTop, Math.max(0, cellWidth - 2), fillHeight);
          ctx.clip();
          ctx.strokeStyle = "rgba(224, 242, 254, 0.24)";
          ctx.lineWidth = 1;
          for (
            let hatchX = left - meterHeight;
            hatchX < right + meterHeight;
            hatchX += 7
          ) {
            ctx.beginPath();
            ctx.moveTo(hatchX, meterTop + meterHeight);
            ctx.lineTo(hatchX + meterHeight, meterTop);
            ctx.stroke();
          }
          ctx.restore();
        }
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left + 1, meterTop, Math.max(0, cellWidth - 2), meterHeight);
        ctx.clip();
        ctx.strokeStyle = "rgba(100, 116, 139, 0.22)";
        ctx.lineWidth = 1;
        for (
          let hatchX = left - meterHeight;
          hatchX < right + meterHeight;
          hatchX += 9
        ) {
          ctx.beginPath();
          ctx.moveTo(hatchX, meterTop + meterHeight);
          ctx.lineTo(hatchX + meterHeight, meterTop);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.fillStyle = Number.isFinite(hour.coverPct) ? "#f8fafc" : "#64748b";
      ctx.font = "600 10px IBM Plex Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (cellWidth >= 30) {
        ctx.fillText(
          hour.displayLabel,
          left + cellWidth / 2,
          railTop + 8,
          Math.max(0, cellWidth - 5),
        );
      }

      if (isForecast) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "rgba(125, 211, 252, 0.62)";
        ctx.beginPath();
        ctx.moveTo(left + 1, railTop + 1);
        ctx.lineTo(right - 1, railTop + 1);
        ctx.stroke();
        ctx.restore();
      } else if (isLive) {
        ctx.strokeStyle = "rgba(251, 191, 36, 0.72)";
        ctx.beginPath();
        ctx.moveTo(left + 1, railTop + 1);
        ctx.lineTo(right - 1, railTop + 1);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(148, 163, 184, 0.13)";
      ctx.beginPath();
      ctx.moveTo(right, railTop);
      ctx.lineTo(right, railTop + railHeight);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      chartArea.left,
      railTop,
      chartArea.right - chartArea.left,
      railHeight,
    );
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
  peakTimingPlugin,
  hourlyCloudCoverPlugin,
);

const STATION_ICAO = "RKSI";
const SEOUL_TIMEZONE = "Asia/Seoul";
const RKSI_LATITUDE = 37.4602;
const RKSI_LONGITUDE = 126.4407;
const SEOUL_UTC_OFFSET_HOURS = 9;
const OFFICIAL_SUNSET_ZENITH_DEGREES = 90.833;
const DAY_MS = 24 * 60 * 60 * 1000;
const METAR_SKY_DEFAULT_HOLD_MINUTES = 30;
const METAR_SKY_MAX_HOLD_MINUTES = 45;
const METAR_SKY_AMOUNT_RANK = Object.freeze({
  FEW: 1,
  SCT: 2,
  BKN: 3,
  OVC: 4,
});
const METAR_SKY_COVERAGE_BANDS = Object.freeze({
  few: { lowerPct: 1, upperPct: 25, nominalPct: 18.75 },
  scattered: { lowerPct: 37.5, upperPct: 50, nominalPct: 43.75 },
  broken: { lowerPct: 62.5, upperPct: 87.5, nominalPct: 75 },
  overcast: { lowerPct: 100, upperPct: 100, nominalPct: 100 },
});
const CLOUD_CHART_WIDTH_PX = 2400;
const HISTORICAL_PEAK_REFERENCE = Object.freeze({
  averageMinute: 13 * 60 + 39,
  medianMinute: 13 * 60 + 44,
  windowStartMinute: 12 * 60 + 20,
  windowEndMinute: 14 * 60 + 39,
  sampleSize: 130,
  firstDate: "2026-03-20",
  lastDate: "2026-07-27",
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

function seoulMinuteForEpoch(epochMs) {
  const parts = getDateParts(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SEOUL_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    new Date(epochMs),
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
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
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${
    hour24 >= 12 ? "PM" : "AM"
  }`;
}

function metarObservedTokens(rawMetar) {
  const tokens = String(rawMetar ?? "")
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  const stopIndex = tokens.findIndex(
    (token) =>
      /^(?:M?\d{2}|\/\/)\/(?:M?\d{2}|\/\/)$/.test(token) ||
      /^(?:Q|A)\d{4}$/.test(token) ||
      /^(?:NOSIG|BECMG|TEMPO|INTER|RMK)$/.test(token) ||
      /^FM\d{6}$/.test(token) ||
      /^PROB\d{2}$/.test(token),
  );
  return stopIndex >= 0 ? tokens.slice(0, stopIndex) : tokens;
}

function parseMetarSkyCondition(rawMetar) {
  const tokens = metarObservedTokens(rawMetar);
  if (!tokens.length) {
    return null;
  }

  const layers = tokens
    .map((token) => {
      const match = /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU)?$/.exec(token);
      return match
        ? {
            amount: match[1],
            code: match[0],
            heightFeet:
              match[2] === "///" ? null : Number.parseInt(match[2], 10) * 100,
            modifier: match[3] ?? null,
          }
        : null;
    })
    .filter(Boolean);
  const verticalVisibilityMatch = tokens
    .map((token) => /^VV(\d{3}|\/\/\/)$/.exec(token))
    .find(Boolean);
  const verticalVisibility = verticalVisibilityMatch
    ? {
        amount: "VV",
        code: verticalVisibilityMatch[0],
        heightFeet:
          verticalVisibilityMatch[1] === "///"
            ? null
            : Number.parseInt(verticalVisibilityMatch[1], 10) * 100,
        modifier: null,
      }
    : null;

  if (verticalVisibility) {
    return {
      conditionKey: "obscured",
      conditionLabel: "Sky obscured",
      primaryCode: verticalVisibility.code,
      primaryHeightFeet: verticalVisibility.heightFeet,
      ceilingFeet: verticalVisibility.heightFeet,
      layers: [verticalVisibility, ...layers],
    };
  }

  if (layers.length) {
    const primaryLayer = [...layers].sort((left, right) => {
      const rankDifference =
        METAR_SKY_AMOUNT_RANK[right.amount] -
        METAR_SKY_AMOUNT_RANK[left.amount];
      if (rankDifference) {
        return rankDifference;
      }
      return (
        (left.heightFeet ?? Number.POSITIVE_INFINITY) -
        (right.heightFeet ?? Number.POSITIVE_INFINITY)
      );
    })[0];
    const ceilingFeet =
      layers
        .filter((layer) => layer.amount === "BKN" || layer.amount === "OVC")
        .map((layer) => layer.heightFeet)
        .filter(Number.isFinite)
        .sort((left, right) => left - right)[0] ?? null;
    const conditionByAmount = {
      FEW: ["few", "Few clouds"],
      SCT: ["scattered", "Scattered clouds"],
      BKN: ["broken", "Broken clouds"],
      OVC: ["overcast", "Overcast"],
    };
    const [conditionKey, conditionLabel] =
      conditionByAmount[primaryLayer.amount];

    return {
      conditionKey,
      conditionLabel,
      primaryCode: primaryLayer.code,
      primaryHeightFeet: primaryLayer.heightFeet,
      ceilingFeet,
      layers,
    };
  }

  if (tokens.includes("CAVOK")) {
    return {
      conditionKey: "cavok",
      conditionLabel: "CAVOK",
      primaryCode: "CAVOK",
      primaryHeightFeet: null,
      ceilingFeet: null,
      layers: [],
    };
  }
  if (tokens.includes("NSC") || tokens.includes("NCD")) {
    const primaryCode = tokens.includes("NSC") ? "NSC" : "NCD";
    return {
      conditionKey: "no_significant_cloud",
      conditionLabel: "No significant cloud",
      primaryCode,
      primaryHeightFeet: null,
      ceilingFeet: null,
      layers: [],
    };
  }
  if (tokens.includes("SKC") || tokens.includes("CLR")) {
    const primaryCode = tokens.includes("SKC") ? "SKC" : "CLR";
    return {
      conditionKey: "clear",
      conditionLabel: "Clear",
      primaryCode,
      primaryHeightFeet: null,
      ceilingFeet: null,
      layers: [],
    };
  }
  return null;
}

function formatFeet(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)
    : null;
}

function metarSkySummary(sky) {
  if (!sky) {
    return "Sky condition unavailable";
  }
  const primaryHeight = formatFeet(sky.primaryHeightFeet);
  const ceilingHeight = formatFeet(sky.ceilingFeet);
  const primaryDetail = primaryHeight
    ? `${sky.primaryCode.replace(/(?:CB|TCU)$/, "")} ${primaryHeight} ft`
    : sky.primaryCode;
  const ceilingDetail =
    ceilingHeight &&
    sky.ceilingFeet !== sky.primaryHeightFeet &&
    (sky.conditionKey === "overcast" || sky.conditionKey === "broken")
      ? ` · ceiling ${ceilingHeight} ft`
      : "";
  return `${sky.conditionLabel} · ${primaryDetail}${ceilingDetail}`;
}

function buildMetarSkyRuns(metarRows, currentMinute = null) {
  const reports = [...metarRows]
    .sort((left, right) => left.obsTimeUtc - right.obsTimeUtc)
    .map((row) => ({
      row,
      minute: parseMinute(row.obsTimeLocal),
      sky: parseMetarSkyCondition(row.rawMetar),
    }));
  const intervals = [];

  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index];
    if (!Number.isFinite(report.minute) || !report.sky) {
      continue;
    }
    const nextReport = reports[index + 1] ?? null;
    const gapMinutes =
      nextReport && Number.isFinite(nextReport.row.obsTimeUtc)
        ? (nextReport.row.obsTimeUtc - report.row.obsTimeUtc) / 60000
        : null;
    const holdMinutes =
      Number.isFinite(gapMinutes) &&
      gapMinutes > 0 &&
      gapMinutes <= METAR_SKY_MAX_HOLD_MINUTES
        ? gapMinutes
        : METAR_SKY_DEFAULT_HOLD_MINUTES;
    const endMinute = Math.min(
      1440,
      report.minute + holdMinutes,
      Number.isFinite(currentMinute) ? currentMinute : 1440,
    );
    if (endMinute <= report.minute) {
      continue;
    }
    intervals.push({
      conditionKey: report.sky.conditionKey,
      conditionLabel: report.sky.conditionLabel,
      startMinute: report.minute,
      endMinute,
      reportCount: 1,
      reportMinutes: [report.minute],
      primaryCodes: [report.sky.primaryCode],
      baseFeetValues: Number.isFinite(report.sky.primaryHeightFeet)
        ? [report.sky.primaryHeightFeet]
        : [],
      ceilingFeetValues: Number.isFinite(report.sky.ceilingFeet)
        ? [report.sky.ceilingFeet]
        : [],
      firstReportTimeLocal: report.row.obsTimeLocal,
      lastReportTimeLocal: report.row.obsTimeLocal,
    });
  }

  const runs = [];
  for (const interval of intervals) {
    const previous = runs.at(-1);
    if (
      previous &&
      previous.conditionKey === interval.conditionKey &&
      interval.startMinute <= previous.endMinute + 1
    ) {
      previous.endMinute = Math.max(previous.endMinute, interval.endMinute);
      previous.reportCount += interval.reportCount;
      previous.reportMinutes.push(...interval.reportMinutes);
      previous.primaryCodes.push(...interval.primaryCodes);
      previous.baseFeetValues.push(...interval.baseFeetValues);
      previous.ceilingFeetValues.push(...interval.ceilingFeetValues);
      previous.lastReportTimeLocal = interval.lastReportTimeLocal;
      continue;
    }
    runs.push({ ...interval });
  }

  return runs;
}

function metarSkyCoverageBand(source) {
  if (!source) {
    return null;
  }
  if (source.conditionKey === "clear") {
    const codes = source.primaryCodes ?? [source.primaryCode];
    return codes.length > 0 && codes.every((code) => code === "SKC")
      ? { lowerPct: 0, upperPct: 0, nominalPct: 0 }
      : null;
  }
  return METAR_SKY_COVERAGE_BANDS[source.conditionKey] ?? null;
}

function cloudCoverDescription(coverPct) {
  if (!Number.isFinite(coverPct)) {
    return "Cloud cover unavailable";
  }
  if (coverPct <= 10) {
    return "Clear";
  }
  if (coverPct <= 30) {
    return "Mostly clear";
  }
  if (coverPct <= 60) {
    return "Partly cloudy";
  }
  if (coverPct < 90) {
    return "Mostly cloudy";
  }
  return "Near-total cloud cover";
}

function formatCloudCoverRange(lowerPct, upperPct) {
  if (!Number.isFinite(lowerPct) || !Number.isFinite(upperPct)) {
    return null;
  }
  const lower = Math.round(lowerPct);
  const upper = Math.round(upperPct);
  return lower === upper ? `${lower}%` : `${lower}–${upper}%`;
}

function cloudHourWindowLabel(hour) {
  const start = String(hour).padStart(2, "0");
  const end = String((hour + 1) % 24).padStart(2, "0");
  return `${start}:00–${end}:00 KST`;
}

function observedCloudHour(hour, metarSkyRuns, windowEnd, phase) {
  const startMinute = hour * 60;
  const endMinute = Math.min((hour + 1) * 60, windowEnd);
  const windowMinutes = Math.max(0, endMinute - startMinute);
  const segments = metarSkyRuns
    .map((run) => {
      const start = Math.max(startMinute, run.startMinute);
      const end = Math.min(endMinute, run.endMinute);
      return end > start
        ? {
            run,
            durationMinutes: end - start,
            band: metarSkyCoverageBand(run),
          }
        : null;
    })
    .filter(Boolean);
  const representedMinutes = segments.reduce(
    (total, segment) => total + segment.durationMinutes,
    0,
  );
  const numericMinutes = segments
    .filter((segment) => segment.band)
    .reduce((total, segment) => total + segment.durationMinutes, 0);
  const hasUnknownCoverage =
    representedMinutes > 0 && numericMinutes < representedMinutes - 0.5;
  const minimumMinutes = phase === "live" ? Math.min(45, windowMinutes) : 45;
  const canEstimate =
    windowMinutes >= (phase === "live" ? 15 : 45) &&
    representedMinutes >= minimumMinutes &&
    !hasUnknownCoverage &&
    numericMinutes > 0;
  const reportMinutes = new Set(
    segments.flatMap((segment) => segment.run.reportMinutes),
  );
  const conditionLabels = [
    ...new Set(segments.map((segment) => segment.run.conditionLabel)),
  ];
  const liveRemainderDetail =
    phase === "live"
      ? " Elapsed portion only; the rest of this hour is still pending and is not inferred from hourly guidance."
      : "";

  if (canEstimate) {
    const weighted = (field) =>
      segments.reduce(
        (total, segment) =>
          total + segment.durationMinutes * segment.band[field],
        0,
      ) / numericMinutes;
    const nominalPct = weighted("nominalPct");
    const lowerPct = weighted("lowerPct");
    const upperPct = weighted("upperPct");
    const coverPct = Math.round(nominalPct / 10) * 10;
    const rangeLabel = formatCloudCoverRange(lowerPct, upperPct);
    const hasFullWindowCoverage =
      representedMinutes >= Math.max(0, windowMinutes - 0.5);
    const exact =
      hasFullWindowCoverage && Math.round(lowerPct) === Math.round(upperPct);
    const estimatePrefix = exact ? "" : "≈";
    const conditionLabel =
      conditionLabels.length > 1
        ? `Variable ${conditionLabels.join(" → ")}`
        : conditionLabels[0] || cloudCoverDescription(coverPct);
    return {
      hour,
      startMinute,
      endMinute: (hour + 1) * 60,
      phase,
      coverPct,
      lowerPct,
      upperPct,
      displayLabel: `${estimatePrefix}${coverPct}%`,
      valueLabel: `${estimatePrefix}${coverPct}% (${rangeLabel} METAR-sample range)`,
      summaryLabel: `${conditionLabel} · ${estimatePrefix}${coverPct}% METAR sample · ${rangeLabel} range`,
      detail: `${conditionLabel}; ${rangeLabel} range across the represented METAR sample; ${Math.round(
        representedMinutes,
      )}/${Math.round(windowMinutes)} minutes represented; ${
        reportMinutes.size
      } ${reportMinutes.size === 1 ? "report" : "reports"}.${liveRemainderDetail}`,
    };
  }

  const isNoSignificantCloud = (segment) =>
    ["cavok", "no_significant_cloud"].includes(segment.run.conditionKey) ||
    (segment.run.conditionKey === "clear" &&
      segment.run.primaryCodes.length > 0 &&
      segment.run.primaryCodes.every((code) => code === "CLR"));
  const allNoSignificantCloud =
    segments.length > 0 && segments.every(isNoSignificantCloud);
  const allObscuredSky =
    segments.length > 0 &&
    segments.every((segment) => segment.run.conditionKey === "obscured");
  const hasMixedConditions = conditionLabels.length > 1;
  let displayLabel = "NO DATA";
  let valueLabel = "No observation";
  let summaryLabel = "No observed cloud amount";
  if (allObscuredSky) {
    displayLabel = "SKY HIDDEN";
    valueLabel = "Sky obscured";
    summaryLabel = "Sky obscured · total cover unavailable";
  } else if (allNoSignificantCloud) {
    displayLabel = "NO LOW CLOUD";
    valueLabel = "No significant low cloud";
    summaryLabel = "No significant low cloud · total cover unavailable";
  } else if (representedMinutes > 0) {
    displayLabel = hasMixedConditions ? "VARIABLE" : "PARTIAL";
    valueLabel = hasMixedConditions
      ? "Variable observation"
      : "Partial observation";
    summaryLabel = `${
      hasMixedConditions
        ? `Variable ${conditionLabels.join(" → ")}`
        : conditionLabels[0] || "Partial observation"
    } · total cover unavailable`;
  }
  return {
    hour,
    startMinute,
    endMinute: (hour + 1) * 60,
    phase,
    coverPct: null,
    lowerPct: null,
    upperPct: null,
    displayLabel,
    valueLabel,
    summaryLabel,
    detail: `${summaryLabel}; ${Math.round(
      representedMinutes,
    )}/${Math.round(windowMinutes)} minutes represented; ${
      reportMinutes.size
    } ${reportMinutes.size === 1 ? "report" : "reports"}.${liveRemainderDetail}`,
  };
}

function forecastCloudHour(hour, forecast) {
  const startMinute = hour * 60;
  const endMinute = (hour + 1) * 60;
  const rawCoverPct = forecast?.cloudCoverPct;
  if (Number.isFinite(rawCoverPct)) {
    const coverPct = Math.round(rawCoverPct / 5) * 5;
    const providerCount =
      forecast.cloudProviderCount ?? forecast.providerCount ?? 1;
    return {
      hour,
      startMinute,
      endMinute,
      phase: "forecast",
      coverPct,
      lowerPct: null,
      upperPct: null,
      displayLabel: `${coverPct}%`,
      valueLabel: `${coverPct}%`,
      summaryLabel: `${cloudCoverDescription(coverPct)} · ${coverPct}%`,
      detail: `${cloudCoverDescription(
        coverPct,
      )}; ${coverPct}% forecast total cloud cover; ${providerCount} ${
        providerCount === 1 ? "provider" : "providers"
      }.`,
    };
  }

  return {
    hour,
    startMinute,
    endMinute,
    phase: "forecast",
    coverPct: null,
    lowerPct: null,
    upperPct: null,
    displayLabel: "—",
    valueLabel: "Forecast unavailable",
    summaryLabel: "Forecast unavailable",
    detail: "No hourly cloud-cover forecast is stored for this hour.",
  };
}

function buildHourlyCloudCover({
  date,
  today,
  currentMinute,
  metarSkyRuns,
  forecastRows,
}) {
  const forecastByHour = new Map();
  for (const row of forecastRows ?? []) {
    const minute = parseMinute(
      row.forecastTimeLocal ?? row.timeLocal ?? row.validTimeLocal,
    );
    if (Number.isFinite(minute) && Number.isFinite(row.cloudCoverPct)) {
      forecastByHour.set(Math.floor(minute / 60), row);
    }
  }

  return Array.from({ length: 24 }, (_, hour) => {
    const startMinute = hour * 60;
    const endMinute = (hour + 1) * 60;
    const isPastDate = date < today;
    const isFutureDate = date > today;
    const isCompletedHour =
      isPastDate ||
      (!isFutureDate &&
        Number.isFinite(currentMinute) &&
        endMinute <= currentMinute);
    const isLiveHour =
      !isPastDate &&
      !isFutureDate &&
      Number.isFinite(currentMinute) &&
      startMinute <= currentMinute &&
      currentMinute < endMinute;

    if (isCompletedHour) {
      return observedCloudHour(hour, metarSkyRuns, endMinute, "observed");
    }

    if (isLiveHour) {
      return observedCloudHour(hour, metarSkyRuns, currentMinute, "live");
    }
    return forecastCloudHour(hour, forecastByHour.get(hour));
  });
}

function buildHourlyCloudSegments(hourlyCloudCover, currentMinute) {
  return hourlyCloudCover.flatMap((hour) => {
    if (
      hour.phase !== "live" ||
      !Number.isFinite(currentMinute) ||
      currentMinute >= hour.endMinute
    ) {
      return [hour];
    }
    const splitMinute = Math.max(hour.startMinute, currentMinute);
    return [
      ...(splitMinute > hour.startMinute
        ? [{ ...hour, endMinute: splitMinute }]
        : []),
      ...(splitMinute < hour.endMinute
        ? [
            {
              hour: hour.hour,
              startMinute: splitMinute,
              endMinute: hour.endMinute,
              phase: "pending",
              coverPct: null,
              lowerPct: null,
              upperPct: null,
              displayLabel: "",
              valueLabel: "Current hour still in progress",
              summaryLabel: "Current hour still in progress",
              detail:
                "No future portion is inferred from an hourly forecast value.",
            },
          ]
        : []),
    ];
  });
}

function buildForecastCloudRows({ predictionRows, forecastCapture, date }) {
  const storedPredictionRows = (predictionRows ?? []).filter((row) =>
    Number.isFinite(row.cloudCoverPct),
  );
  if (storedPredictionRows.length) {
    return storedPredictionRows;
  }

  const points = new Map();
  const providerRows = [
    {
      rows:
        forecastCapture?.googleStatus === "ok"
          ? forecastCapture.googleHourlyRows
          : [],
      weight: 0.35,
    },
    {
      rows:
        forecastCapture?.openMeteoStatus === "ok"
          ? forecastCapture.openMeteoHourlyRows
          : [],
      weight: 0.45,
    },
  ];
  for (const provider of providerRows) {
    const { rows, weight } = provider;
    for (const row of rows ?? []) {
      if (row.date !== date || !Number.isFinite(row.cloudCoverPct)) {
        continue;
      }
      const key = row.forecastTimeUtc ?? row.forecastTimeLocal;
      const point = points.get(key) ?? {
        forecastTimeUtc: row.forecastTimeUtc,
        forecastTimeLocal: row.forecastTimeLocal,
        values: [],
      };
      point.values.push({ value: row.cloudCoverPct, weight });
      points.set(key, point);
    }
  }

  return [...points.values()]
    .sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc)
    .map((point) => ({
      forecastTimeUtc: point.forecastTimeUtc,
      forecastTimeLocal: point.forecastTimeLocal,
      cloudCoverPct:
        point.values.reduce(
          (sum, value) => sum + value.value * value.weight,
          0,
        ) / point.values.reduce((sum, value) => sum + value.weight, 0),
      cloudProviderCount: point.values.length,
    }));
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
        cloudCoverPct: Number.isFinite(row.cloudCoverPct)
          ? row.cloudCoverPct
          : null,
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
    skySummary: metarSkySummary(parseMetarSkyCondition(row.rawMetar)),
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
  const [clockNowMs, setClockNowMs] = useState(null);
  const [refreshState, setRefreshState] = useState({
    active: false,
    message: "",
  });
  const refreshInFlight = useRef(false);
  const chartScrollRef = useRef(null);
  const hasAutoScrolledChart = useRef(false);

  const isDateValid = isValidDate(date);
  const today = seoulTodayKey();
  const isToday = isDateValid && date === today;
  const previousDate = shiftDateKey(date, -1);
  const nextDate = shiftDateKey(date, 1);
  const currentSeoulMinute =
    isToday && Number.isFinite(clockNowMs)
      ? seoulMinuteForEpoch(clockNowMs)
      : null;

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
  const metarSkyRuns = useMemo(
    () => buildMetarSkyRuns(metarRows, currentSeoulMinute),
    [currentSeoulMinute, metarRows],
  );
  const latestPrediction = normalizePrediction(
    predictionDashboard?.latestPrediction,
  );
  const forecastCloudRows = useMemo(
    () =>
      buildForecastCloudRows({
        predictionRows: latestPrediction?.hourlyCurve,
        forecastCapture: predictionDashboard?.latestForecastCapture,
        date,
      }),
    [
      date,
      latestPrediction?.hourlyCurve,
      predictionDashboard?.latestForecastCapture,
    ],
  );
  const hourlyCloudCover = useMemo(
    () =>
      buildHourlyCloudCover({
        date,
        today,
        currentMinute: currentSeoulMinute,
        metarSkyRuns,
        forecastRows: forecastCloudRows,
      }),
    [currentSeoulMinute, date, forecastCloudRows, metarSkyRuns, today],
  );
  const hourlyCloudSegments = useMemo(
    () => buildHourlyCloudSegments(hourlyCloudCover, currentSeoulMinute),
    [currentSeoulMinute, hourlyCloudCover],
  );
  const latestObservedCloudHour = useMemo(
    () =>
      hourlyCloudCover
        .filter(
          (hour) =>
            (hour.phase === "observed" || hour.phase === "live") &&
            hour.valueLabel !== "No observation",
        )
        .at(-1) ?? null,
    [hourlyCloudCover],
  );
  const nextForecastCloudHour = useMemo(() => {
    return (
      hourlyCloudCover.find(
        (hour) => hour.phase === "forecast" && Number.isFinite(hour.coverPct),
      ) ?? null
    );
  }, [hourlyCloudCover]);
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
  const forecastPeakStartMinute = parseMinute(latestPrediction?.peakStartLocal);
  const forecastPeakEndMinute = parseMinute(latestPrediction?.peakEndLocal);
  const hasTemperatureChartData =
    metarRows.length +
      amosDisplayRows.length +
      (latestPrediction?.hourlyCurve?.length ?? 0) >
    0;
  const hasCloudGuidance = hourlyCloudCover.some((hour) =>
    Number.isFinite(hour.coverPct),
  );

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
        padding: { top: 70, right: 8, bottom: 2, left: 2 },
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
              const skyCondition = item.raw?.skySummary
                ? ` · ${item.raw.skySummary}`
                : "";
              const forecastCloudCover = Number.isFinite(
                item.raw?.cloudCoverPct,
              )
                ? ` · ${Math.round(item.raw.cloudCoverPct)}% cloud cover`
                : "";
              return `${item.dataset.label}: ${item.parsed.y.toFixed(
                1,
              )}°${unit}${reportType}${auditFallback}${skyCondition}${forecastCloudCover}`;
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
        seoulPeakTiming: {
          typical: {
            display: true,
            medianMinute: HISTORICAL_PEAK_REFERENCE.medianMinute,
            windowStartMinute: HISTORICAL_PEAK_REFERENCE.windowStartMinute,
            windowEndMinute: HISTORICAL_PEAK_REFERENCE.windowEndMinute,
            title: "MAR–JUL TYPICAL",
            label: minuteLabel(HISTORICAL_PEAK_REFERENCE.medianMinute),
          },
          forecast: {
            display:
              Number.isFinite(forecastPeakStartMinute) &&
              Number.isFinite(forecastPeakEndMinute),
            windowStartMinute: forecastPeakStartMinute,
            windowEndMinute: forecastPeakEndMinute,
          },
        },
        seoulHourlyCloudCover: {
          display: hourlyCloudSegments.length > 0,
          hours: hourlyCloudSegments,
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
          display: hasTemperatureChartData,
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
    [
      currentSeoulMinute,
      date,
      forecastPeakEndMinute,
      forecastPeakStartMinute,
      hasTemperatureChartData,
      hourlyCloudSegments,
      isToday,
      sunsetMinute,
      unit,
    ],
  );

  function scrollChartToMinute(minute, behavior = "smooth") {
    const scroller = chartScrollRef.current;
    if (!scroller || !Number.isFinite(minute)) {
      return false;
    }
    const minuteX = (minute / 1439) * CLOUD_CHART_WIDTH_PX;
    const requestedLeft = minuteX - scroller.clientWidth * 0.4;
    const maximumLeft = Math.max(
      0,
      scroller.scrollWidth - scroller.clientWidth,
    );
    scroller.scrollTo({
      left: Math.min(maximumLeft, Math.max(0, requestedLeft)),
      behavior,
    });
    return true;
  }

  useEffect(() => {
    setInputDate(date);
    hasAutoScrolledChart.current = false;
  }, [date]);

  useEffect(() => {
    setClockNowMs(Date.now());
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      !isToday ||
      !Number.isFinite(currentSeoulMinute) ||
      hasAutoScrolledChart.current
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (scrollChartToMinute(currentSeoulMinute, "auto")) {
        hasAutoScrolledChart.current = true;
      }
    });
    return () => window.cancelAnimationFrame(frame);
    // Auto-position only once for each selected Seoul date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSeoulMinute, date, isToday]);

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
                        <p
                          className="mt-2 font-mono text-[9px] leading-4 text-violet-300/85"
                          title={`Historical 15L first-maximum times from ${HISTORICAL_PEAK_REFERENCE.firstDate} through ${HISTORICAL_PEAK_REFERENCE.lastDate}. This is a spring–summer reference, not a condition-matched forecast.`}
                        >
                          Spring–summer typical ·{" "}
                          {minuteLabel(HISTORICAL_PEAK_REFERENCE.medianMinute)}
                          <span className="text-slate-600">
                            {" "}
                            · middle 50%{" "}
                            {minuteLabel(
                              HISTORICAL_PEAK_REFERENCE.windowStartMinute,
                            )}
                            –
                            {minuteLabel(
                              HISTORICAL_PEAK_REFERENCE.windowEndMinute,
                            )}{" "}
                            · n={HISTORICAL_PEAK_REFERENCE.sampleSize}
                          </span>
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
              <div className="mt-2 max-w-3xl font-mono text-[9px] uppercase leading-4 tracking-[0.14em]">
                <p className="text-slate-300">
                  Hourly sky cover ·{" "}
                  {date < today ? (
                    <span className="text-slate-200">
                      ■ completed hours: observed
                    </span>
                  ) : date > today ? (
                    <span className="text-sky-300">▧ forecast percentages</span>
                  ) : (
                    <>
                      <span className="text-slate-200">■ past: observed</span> ·{" "}
                      <span className="text-amber-300">▌ now: live</span> ·{" "}
                      <span className="text-sky-300">▧ coming: forecast</span>
                    </>
                  )}
                </p>
                {latestObservedCloudHour && (
                  <p className="text-slate-500">
                    {latestObservedCloudHour.phase === "live"
                      ? "Live hour"
                      : "Latest completed hour"}{" "}
                    · {cloudHourWindowLabel(latestObservedCloudHour.hour)} ·{" "}
                    {latestObservedCloudHour.summaryLabel}
                  </p>
                )}
                <p className="text-sky-400/80">
                  {date < today
                    ? "Completed day · observed METAR hourly summary"
                    : `${date > today ? "Forecast day" : "Coming hours"} · ${
                        nextForecastCloudHour
                          ? `${cloudHourWindowLabel(
                              nextForecastCloudHour.hour,
                            )} · ${nextForecastCloudHour.summaryLabel}`
                          : "no stored forecast hour remains on this date"
                      }`}
                </p>
              </div>
            </div>
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.16em]">
              {latestPrediction && (
                <p className="text-amber-300">
                  Forecast peak ·{" "}
                  {formatPeakWindow(
                    latestPrediction.peakStartLocal,
                    latestPrediction.peakEndLocal,
                  )}{" "}
                  KST
                </p>
              )}
              <p
                className="mt-1 text-violet-300"
                title={`Median first occurrence of the daily 15L maximum across ${HISTORICAL_PEAK_REFERENCE.sampleSize} complete days (${HISTORICAL_PEAK_REFERENCE.firstDate}–${HISTORICAL_PEAK_REFERENCE.lastDate}).`}
              >
                Spring–summer typical ·{" "}
                {minuteLabel(HISTORICAL_PEAK_REFERENCE.medianMinute)} KST
              </p>
              <p className="mt-1 text-orange-300">
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
              {isToday && Number.isFinite(currentSeoulMinute) && (
                <button
                  type="button"
                  onClick={() => scrollChartToMinute(currentSeoulMinute)}
                  className="mt-2 border border-cyan-300/30 px-2.5 py-1 text-[9px] text-cyan-200 transition hover:border-cyan-200 hover:text-cyan-100"
                >
                  Jump to now
                </button>
              )}
            </div>
          </div>

          <div id="seoul-hourly-cloud-description" className="sr-only">
            <p>
              The hourly sky-cover strip uses meter height to show how much of
              the sky is covered. Solid cells are past METAR observations. Their
              percentages are approximate ranges derived only from explicit
              cloud-amount reports. Diagonally patterned cells are upcoming
              model forecasts. Hatched cells without a percentage mean total
              cloud cover is unavailable, not clear sky. The current hour ends
              at the NOW line; its remaining time stays hatched until observed.
            </p>
          </div>

          <div
            ref={chartScrollRef}
            aria-label="Scrollable 24-hour temperature and hourly sky-cover chart"
            aria-describedby="seoul-hourly-cloud-description"
            className="relative min-h-[560px] flex-1 overflow-x-auto overscroll-x-contain border border-white/10 bg-[#07111f]/85 shadow-[0_30px_100px_rgba(0,0,0,0.38)]"
            role="region"
            tabIndex={0}
          >
            <div className="h-[68vh] min-h-[560px] w-[2400px] min-w-[2400px] p-3 md:h-[72vh] md:max-h-[900px] md:p-5">
              <Line data={chartData} options={chartOptions} />
            </div>
            {dayData !== undefined && !hasTemperatureChartData && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.22em] text-slate-400">
                    {hasCloudGuidance
                      ? "Cloud guidance available"
                      : "No captured telemetry"}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {hasCloudGuidance
                      ? "No temperature tracker has been generated for this date; hourly cloud guidance is shown above."
                      : "This Seoul local date has no stored RKSI observations."}
                  </p>
                </div>
              </div>
            )}
          </div>

          <details className="mt-3 border border-white/10 bg-white/[0.02]">
            <summary className="cursor-pointer px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400 transition hover:text-slate-200">
              View all 24 hourly cloud details
            </summary>
            <div className="overflow-x-auto border-t border-white/10">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <caption className="sr-only">
                  Hour-by-hour observed and forecast Seoul sky cover
                </caption>
                <thead>
                  <tr className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
                    <th className="px-4 py-2 font-normal">Hour</th>
                    <th className="px-4 py-2 font-normal">Source</th>
                    <th className="px-4 py-2 font-normal">Sky cover</th>
                    <th className="px-4 py-2 font-normal">What it means</th>
                  </tr>
                </thead>
                <tbody>
                  {hourlyCloudCover.map((hour) => (
                    <tr
                      key={`cloud-table-${hour.hour}`}
                      className="border-t border-white/[0.06] text-xs text-slate-300"
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-slate-400">
                        {cloudHourWindowLabel(hour.hour)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em]">
                        {hour.phase === "forecast"
                          ? "Forecast"
                          : hour.phase === "live"
                            ? "Live observation"
                            : "Observed"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-100">
                        {hour.valueLabel}
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {hour.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <footer className="flex flex-col gap-2 py-4 font-mono text-[10px] leading-5 text-slate-600 md:flex-row md:items-center md:justify-between">
          <p>
            AMOS uses the feed row designated 15L. Five-minute snapshots remain
            available only as an audit fallback for missed minute captures. Past
            sky cover comes from METAR ranges; coming hours use model
            cloud-cover percentages.
          </p>
          <p>
            NOAA TGFTP METAR · KMA AMOS MOBILE FEED · MULTI-PROVIDER FORECAST
          </p>
        </footer>
      </div>
    </main>
  );
}
