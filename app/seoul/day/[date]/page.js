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

function observedMaxPosition(chart, options) {
  if (
    !options?.display ||
    !Number.isFinite(options.minute) ||
    !Number.isFinite(options.temperature)
  ) {
    return null;
  }

  const { chartArea, scales } = chart;
  const x = scales.x.getPixelForValue(options.minute);
  const y = scales.y.getPixelForValue(options.temperature);
  if (
    x < chartArea.left ||
    x > chartArea.right ||
    y < chartArea.top ||
    y > chartArea.bottom
  ) {
    return null;
  }
  return { x, y };
}

const observedMaxPlugin = {
  id: "seoulObservedMax",
  beforeDatasetsDraw(chart, _args, options) {
    const position = observedMaxPosition(chart, options);
    if (!position) {
      return;
    }

    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.strokeStyle = "rgba(52, 211, 153, 0.5)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, position.y);
    ctx.lineTo(chartArea.right, position.y);
    ctx.stroke();
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, options) {
    const position = observedMaxPosition(chart, options);
    if (!position || !options?.label) {
      return;
    }

    const { ctx, chartArea } = chart;
    const boxHeight = 21;
    const horizontalPadding = 8;

    ctx.save();
    ctx.font = "600 9px IBM Plex Mono, monospace";
    const boxWidth = Math.min(
      ctx.measureText(options.label).width + horizontalPadding * 2,
      chartArea.right - chartArea.left - 8,
    );
    const boxLeft = chartArea.left + 5;
    const preferredTop = position.y - boxHeight - 5;
    const boxTop =
      preferredTop >= chartArea.top + 4
        ? preferredTop
        : Math.min(position.y + 5, chartArea.bottom - boxHeight - 4);

    ctx.fillStyle = "rgba(3, 33, 29, 0.95)";
    ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight);
    ctx.strokeStyle = "rgba(52, 211, 153, 0.72)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight);
    ctx.fillStyle = "#a7f3d0";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      options.label,
      boxLeft + horizontalPadding,
      boxTop + boxHeight / 2,
      boxWidth - horizontalPadding * 2,
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
    const railHeight = 54;
    const railTop = chartArea.top - 64;
    const meterTop = railTop + 25;
    const meterHeight = railHeight - 27;

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
      const isKmaForecast = isForecast && hour.forecastProvider === "kma";
      const accent =
        isForecast && hour.isStale
          ? "rgba(251, 191, 36, 0.72)"
          : isKmaForecast
            ? "rgba(196, 181, 253, 0.78)"
            : isForecast
              ? "rgba(56, 189, 248, 0.72)"
              : isLive
                ? "rgba(251, 191, 36, 0.78)"
                : "rgba(203, 213, 225, 0.72)";

      if (isKmaForecast && hour.conditionLabel) {
        ctx.fillStyle = hour.isStale
          ? "rgba(251, 191, 36, 0.08)"
          : "rgba(167, 139, 250, 0.08)";
        ctx.fillRect(
          left + 1,
          meterTop,
          Math.max(0, cellWidth - 2),
          meterHeight,
        );
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left + 2, meterTop + meterHeight - 2);
        ctx.lineTo(right - 2, meterTop + meterHeight - 2);
        ctx.stroke();
      } else if (Number.isFinite(hour.coverPct)) {
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

      ctx.fillStyle =
        isKmaForecast && hour.conditionLabel
          ? hour.isStale
            ? "#fde68a"
            : "#ddd6fe"
          : Number.isFinite(hour.coverPct)
            ? "#f8fafc"
            : "#64748b";
      ctx.font = `${
        isKmaForecast ? "600 8px" : "600 10px"
      } IBM Plex Mono, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (cellWidth >= 30) {
        ctx.fillText(
          hour.displayLabel,
          left + cellWidth / 2,
          railTop + (isKmaForecast ? 8 : 12),
          Math.max(0, cellWidth - 5),
        );
        if (isKmaForecast && hour.ceilingLabel) {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "500 8px IBM Plex Mono, monospace";
          ctx.fillText(
            hour.ceilingLabel,
            left + cellWidth / 2,
            railTop + 18,
            Math.max(0, cellWidth - 5),
          );
        }
      }

      if (isForecast) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = hour.isStale
          ? "rgba(251, 191, 36, 0.72)"
          : isKmaForecast
            ? "rgba(196, 181, 253, 0.72)"
            : "rgba(125, 211, 252, 0.62)";
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

function weathercomRevisionBadgeBounds(position, width, height, chartArea) {
  const gap = 9;
  const preferredTop = position.y - height - gap;
  const top =
    preferredTop >= chartArea.top
      ? preferredTop
      : Math.min(chartArea.bottom - height, position.y + gap);
  const left = Math.min(
    chartArea.right - width,
    Math.max(chartArea.left, position.x - width / 2),
  );
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
  };
}

function chartBoundsOverlap(left, right, padding = 3) {
  return !(
    left.right + padding < right.left ||
    left.left - padding > right.right ||
    left.bottom + padding < right.top ||
    left.top - padding > right.bottom
  );
}

const WEATHERCOM_REVISION_THRESHOLD_C = 1;
const WEATHERCOM_REVISION_MAXIMUM_LABELS = 24;

const weathercomRevisionBadgePlugin = {
  id: "seoulWeathercomRevisionBadges",
  afterDatasetsDraw(chart, _args, options) {
    if (!options?.display) {
      return;
    }

    const datasetIndex = chart.data.datasets.findIndex(
      (dataset) => dataset.weathercomRole === "latest",
    );
    if (datasetIndex < 0) {
      return;
    }

    const dataset = chart.data.datasets[datasetIndex];
    const meta = chart.getDatasetMeta(datasetIndex);
    if (meta.hidden) {
      return;
    }

    const thresholdC = Number.isFinite(options.thresholdC)
      ? options.thresholdC
      : WEATHERCOM_REVISION_THRESHOLD_C;
    const fallbackThreshold =
      options.unit === "F" ? thresholdC * 1.8 : thresholdC;
    let candidates = dataset.data
      .map((point, index) => {
        const delta = point?.revisionDelta;
        const deltaC = point?.revisionDeltaC;
        const material = Number.isFinite(deltaC)
          ? Math.abs(deltaC) >= thresholdC
          : Number.isFinite(delta) && Math.abs(delta) >= fallbackThreshold;
        const element = meta.data[index];
        if (!material || !element || element.skip || !Number.isFinite(delta)) {
          return null;
        }
        const position = element.tooltipPosition();
        if (
          position.x < chart.chartArea.left ||
          position.x > chart.chartArea.right ||
          position.y < chart.chartArea.top ||
          position.y > chart.chartArea.bottom
        ) {
          return null;
        }
        return { delta, position };
      })
      .filter(Boolean);

    const maximumLabels = Number.isFinite(options.maximumLabels)
      ? Math.max(1, Math.floor(options.maximumLabels))
      : WEATHERCOM_REVISION_MAXIMUM_LABELS;
    if (candidates.length > maximumLabels) {
      const lastIndex = candidates.length - 1;
      candidates = Array.from({ length: maximumLabels }, (_value, index) => {
        const sourceIndex = Math.round(
          (index * lastIndex) / Math.max(1, maximumLabels - 1),
        );
        return candidates[sourceIndex];
      });
    }

    const { ctx, chartArea } = chart;
    const occupiedBounds = [];
    ctx.save();
    ctx.font = "600 9px IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const candidate of candidates) {
      const arrow = candidate.delta > 0 ? "↑" : "↓";
      const signedDelta = `${candidate.delta > 0 ? "+" : ""}${candidate.delta.toFixed(
        1,
      )}°${options.unit}`;
      const label = `${arrow} ${signedDelta}`;
      const width = Math.ceil(ctx.measureText(label).width) + 12;
      const height = 18;
      const bounds = weathercomRevisionBadgeBounds(
        candidate.position,
        width,
        height,
        chartArea,
      );
      if (
        occupiedBounds.some((existing) => chartBoundsOverlap(existing, bounds))
      ) {
        continue;
      }
      occupiedBounds.push(bounds);

      ctx.fillStyle =
        candidate.delta > 0
          ? "rgba(180, 83, 9, 0.96)"
          : "rgba(30, 64, 175, 0.96)";
      ctx.strokeStyle =
        candidate.delta > 0
          ? "rgba(253, 186, 116, 0.82)"
          : "rgba(147, 197, 253, 0.82)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bounds.left, bounds.top, width, height, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#f8fafc";
      ctx.fillText(
        label,
        bounds.left + width / 2,
        bounds.top + height / 2 + 0.5,
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
  nowLinePlugin,
  sunsetLinePlugin,
  peakTimingPlugin,
  observedMaxPlugin,
  hourlyCloudCoverPlugin,
  weathercomRevisionBadgePlugin,
);

const STATION_ICAO = "RKSI";
const SEOUL_TIMEZONE = "Asia/Seoul";
const RKSI_LATITUDE = 37.4602;
const RKSI_LONGITUDE = 126.4407;
const SEOUL_UTC_OFFSET_HOURS = 9;
const OFFICIAL_SUNSET_ZENITH_DEGREES = 90.833;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const KMA_STALE_AGE_MINUTES = 6 * 60;
const AMOS_DELAYED_AGE_MINUTES = 2;
const AMOS_STALE_AGE_MINUTES = 10;
const METAR_DELAYED_AGE_MINUTES = 45;
const METAR_STALE_AGE_MINUTES = 75;
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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const isLeapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
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
  if (!isValidDate(dateKey)) {
    return null;
  }
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

function usesSpringSummerPeakReference(dateKey) {
  const parts = parseDateKey(dateKey);
  return Boolean(parts && parts.month >= 3 && parts.month <= 7);
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

function toUnitTemperature(celsius, unit) {
  if (!Number.isFinite(celsius)) {
    return null;
  }
  return unit === "C" ? celsius : (celsius * 9) / 5 + 32;
}

function toUnitTemperatureDelta(celsiusDelta, unit) {
  if (!Number.isFinite(celsiusDelta)) {
    return null;
  }
  return unit === "C" ? celsiusDelta : (celsiusDelta * 9) / 5;
}

function formatElapsedDuration(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return totalMinutes < 10 && seconds
      ? `${totalMinutes}m ${seconds}s`
      : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function telemetryFreshness(row, nowMs, isToday, source) {
  if (!row) {
    return {
      status: "waiting",
      label: "Awaiting",
      timing: "No observation received",
    };
  }

  const receiveTimestamp = source === "amos" ? row.firstSeenAt : row.updatedAt;
  const receiveLagMs =
    Number.isFinite(receiveTimestamp) && Number.isFinite(row.obsTimeUtc)
      ? Math.max(0, receiveTimestamp - row.obsTimeUtc)
      : null;
  const receiveLag = formatElapsedDuration(receiveLagMs);
  const receiveDetail = receiveLag
    ? source === "amos"
      ? `received +${receiveLag}`
      : `last stored +${receiveLag}`
    : source === "amos"
      ? "receive latency unavailable"
      : null;
  if (!isToday || !Number.isFinite(nowMs) || !Number.isFinite(row.obsTimeUtc)) {
    return {
      status: "archive",
      label: "Archived",
      timing: receiveDetail ?? "stored observation",
    };
  }

  const ageMs = Math.max(0, nowMs - row.obsTimeUtc);
  const delayedMinutes =
    source === "amos" ? AMOS_DELAYED_AGE_MINUTES : METAR_DELAYED_AGE_MINUTES;
  const staleMinutes =
    source === "amos" ? AMOS_STALE_AGE_MINUTES : METAR_STALE_AGE_MINUTES;
  const status =
    ageMs > staleMinutes * MINUTE_MS
      ? "stale"
      : ageMs > delayedMinutes * MINUTE_MS
        ? "delayed"
        : "fresh";
  const labels = {
    fresh: "Fresh",
    delayed: "Delayed",
    stale: "Stale",
  };
  const observationAge = formatElapsedDuration(ageMs);
  return {
    status,
    label: labels[status],
    ageMs,
    receiveLagMs,
    timing: [
      observationAge ? `observed ${observationAge} ago` : null,
      receiveDetail,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function selectObservedMaximum(rows) {
  let maximum = null;
  for (const row of rows ?? []) {
    if (!Number.isFinite(row?.tempC) || !Number.isFinite(row?.obsTimeUtc)) {
      continue;
    }
    if (
      !maximum ||
      row.tempC > maximum.tempC ||
      (row.tempC === maximum.tempC && row.obsTimeUtc < maximum.obsTimeUtc)
    ) {
      maximum = row;
    }
  }
  return maximum;
}

function medianFinite(values) {
  const ordered = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!ordered.length) {
    return null;
  }
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function robustTemperatureTrendCPerHour(rows, windowMinutes = 60) {
  const ordered = (rows ?? [])
    .filter(
      (row) => Number.isFinite(row?.tempC) && Number.isFinite(row?.obsTimeUtc),
    )
    .sort((left, right) => left.obsTimeUtc - right.obsTimeUtc);
  if (ordered.length < 4) {
    return null;
  }

  const latest = ordered.at(-1);
  const windowStart = latest.obsTimeUtc - windowMinutes * MINUTE_MS;
  const windowRows = ordered.filter((row) => row.obsTimeUtc >= windowStart);
  if (
    windowRows.length < 4 ||
    latest.obsTimeUtc - windowRows[0].obsTimeUtc <
      windowMinutes * MINUTE_MS * 0.75
  ) {
    return null;
  }

  const minimumPairGapMs = Math.min(10, windowMinutes / 4) * MINUTE_MS;
  const slopes = [];
  for (let leftIndex = 0; leftIndex < windowRows.length - 1; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < windowRows.length;
      rightIndex += 1
    ) {
      const elapsedMs =
        windowRows[rightIndex].obsTimeUtc - windowRows[leftIndex].obsTimeUtc;
      if (elapsedMs < minimumPairGapMs) {
        continue;
      }
      slopes.push(
        ((windowRows[rightIndex].tempC - windowRows[leftIndex].tempC) *
          60 *
          MINUTE_MS) /
          elapsedMs,
      );
    }
  }

  const trend = medianFinite(slopes);
  return Number.isFinite(trend) ? Math.round(trend * 10) / 10 : null;
}

function trendDescription(trendCPerHour) {
  if (!Number.isFinite(trendCPerHour)) {
    return "Insufficient 60-minute coverage";
  }
  if (trendCPerHour >= 0.2) {
    return "Warming";
  }
  if (trendCPerHour <= -0.2) {
    return "Cooling";
  }
  return "Nearly steady";
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

function formatCloudCoverPercentage(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const bounded = Math.min(100, Math.max(0, value));
  return Number.isInteger(bounded) ? String(bounded) : bounded.toFixed(1);
}

function formatSignedCloudDeltaPct(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function cloudForecastDeltaMeaning(value) {
  if (!Number.isFinite(value)) {
    return "No comparison";
  }
  if (value > 0) {
    return "Forecast cloudier";
  }
  if (value < 0) {
    return "Forecast clearer";
  }
  return "Forecast matched observed estimate";
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

function addCloudForecastComparison(observedHour, forecastPoint) {
  const forecastCoverPct = forecastPoint?.preHourCloudCoverPct;
  if (
    !Number.isFinite(observedHour?.coverPct) ||
    !Number.isFinite(forecastCoverPct)
  ) {
    return observedHour;
  }

  const forecastDeltaPct = Math.round(forecastCoverPct - observedHour.coverPct);
  const forecastDeltaLabel = formatSignedCloudDeltaPct(forecastDeltaPct);
  const forecastCoverLabel = formatCloudCoverPercentage(forecastCoverPct);
  const forecastCapturedAt =
    forecastPoint.preHourCapturedAtLocal ?? forecastPoint.preHourCapturedAt;
  const forecastCapturedLabel = formatLocalTime(forecastCapturedAt);
  const forecastMeaning = cloudForecastDeltaMeaning(forecastDeltaPct);
  return {
    ...observedHour,
    forecastCoverPct,
    forecastDeltaPct,
    forecastDeltaLabel,
    forecastCapturedAt: forecastPoint.preHourCapturedAt,
    forecastCapturedAtLocal: forecastPoint.preHourCapturedAtLocal,
    displayLabel: `${observedHour.displayLabel} · secondary ${forecastDeltaLabel}`,
    summaryLabel: `${observedHour.summaryLabel} · secondary Weather.com − observed ${forecastDeltaLabel}`,
    detail: `${observedHour.detail} Secondary Weather.com pre-hour comparison: ${forecastCoverLabel}%${
      forecastCapturedLabel !== "—"
        ? `, captured ${forecastCapturedLabel} KST`
        : ""
    }; secondary Weather.com percentage minus observed METAR sample: ${forecastDeltaLabel} (${Math.abs(
      forecastDeltaPct,
    )} percentage points; ${forecastMeaning.toLowerCase()}). It is not used as KMA forecast guidance.`,
  };
}

function kmaCeilingLabel(forecast) {
  const ceilingText = String(forecast?.ceilingText ?? "").trim();
  if (ceilingText) {
    return /^ceiling\b/i.test(ceilingText)
      ? ceilingText
      : `Ceiling ${ceilingText}`;
  }
  const ceilingFeet = finiteNumber(
    forecast?.ceilingFt ?? forecast?.ceilingFeet,
  );
  return Number.isFinite(ceilingFeet)
    ? `Ceiling ${formatFeet(ceilingFeet)} ft`
    : null;
}

function kmaForecastCloudHour(hour, forecast) {
  const startMinute = hour * 60;
  const endMinute = (hour + 1) * 60;
  const conditionLabel = String(
    forecast?.phrase ?? forecast?.conditionLabel ?? "",
  ).trim();
  const ceilingLabel = kmaCeilingLabel(forecast);
  if (conditionLabel || ceilingLabel) {
    const captureTime = formatLocalTime(
      forecast.capturedAtLocal ?? forecast.capturedAt,
    );
    const vintageDetail =
      captureTime !== "—"
        ? ` Captured ${captureTime} KST${forecast.isStale ? " (stale)" : ""}.`
        : "";
    return {
      hour,
      startMinute,
      endMinute,
      phase: "forecast",
      forecastProvider: "kma",
      coverPct: null,
      lowerPct: null,
      upperPct: null,
      conditionLabel: conditionLabel || "Condition unavailable",
      ceilingFeet: forecast?.ceilingFt,
      ceilingLabel,
      displayLabel: conditionLabel || "Condition n/a",
      valueLabel: [conditionLabel || "Condition unavailable", ceilingLabel]
        .filter(Boolean)
        .join(" · "),
      summaryLabel: [conditionLabel || "Condition unavailable", ceilingLabel]
        .filter(Boolean)
        .join(" · "),
      detail: `KMA/AMO airport forecast condition: ${
        conditionLabel || "not published"
      }. ${
        ceilingLabel ? `${ceilingLabel}.` : "Ceiling not published."
      }${vintageDetail}`,
      capturedAt: forecast.capturedAt,
      capturedAtLocal: forecast.capturedAtLocal,
      captureAgeMinutes: forecast.captureAgeMinutes,
      isStale: Boolean(forecast.isStale),
    };
  }

  return {
    hour,
    startMinute,
    endMinute,
    phase: "forecast",
    forecastProvider: "kma",
    coverPct: null,
    lowerPct: null,
    upperPct: null,
    displayLabel: "—",
    valueLabel: "KMA condition unavailable",
    summaryLabel: "KMA condition unavailable",
    detail:
      "No KMA/AMO condition or ceiling is stored for this hour. Weather.com is not substituted.",
  };
}

function buildHourlyCloudCover({
  date,
  today,
  currentMinute,
  metarSkyRuns,
  forecastRows,
  comparisonRows,
}) {
  const forecastByHour = new Map();
  for (const row of forecastRows ?? []) {
    const minute = firstFinite(
      row.minute,
      parseMinute(row.forecastTimeLocal ?? row.timeLocal ?? row.validTimeLocal),
    );
    if (Number.isFinite(minute)) {
      forecastByHour.set(Math.floor(minute / 60), row);
    }
  }
  const comparisonByHour = new Map();
  for (const point of comparisonRows ?? []) {
    const minute = firstFinite(
      parseMinute(point.forecastTimeLocal),
      Number.isFinite(point.forecastTimeUtc)
        ? seoulMinuteForEpoch(point.forecastTimeUtc)
        : null,
    );
    if (
      Number.isFinite(minute) &&
      Number.isFinite(point.preHourCloudCoverPct)
    ) {
      comparisonByHour.set(Math.floor(minute / 60), point);
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
      return addCloudForecastComparison(
        observedCloudHour(hour, metarSkyRuns, endMinute, "observed"),
        comparisonByHour.get(hour),
      );
    }

    if (isLiveHour) {
      return observedCloudHour(hour, metarSkyRuns, currentMinute, "live");
    }
    return kmaForecastCloudHour(hour, forecastByHour.get(hour));
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

function buildKmaForecastCloudRows({ kma, date, nowMs }) {
  if (kma?.approvalRequired || kma?.setupRequired) {
    return [];
  }

  return (kma?.hourlyRows ?? [])
    .filter((row) => !row.date || row.date === date)
    .map((row) => {
      const sourceCapturedAt = firstFinite(row.capturedAt, kma?.capturedAt);
      const sourceCapturedAtLocal = row.capturedAtLocal ?? kma?.capturedAtLocal;
      const sourceCaptureAgeMinutes =
        Number.isFinite(nowMs) && Number.isFinite(sourceCapturedAt)
          ? Math.max(0, nowMs - sourceCapturedAt) / MINUTE_MS
          : kma?.captureAgeMinutes;
      if (
        Number.isFinite(sourceCapturedAt) &&
        Number.isFinite(nowMs) &&
        sourceCapturedAt > nowMs + MINUTE_MS
      ) {
        return null;
      }
      return {
        ...row,
        forecastTimeUtc: row.forecastTimeUtc,
        forecastTimeLocal: row.forecastTimeLocal,
        phrase: row.phrase,
        ceilingFt: row.ceilingFt,
        ceilingText: row.ceilingText,
        capturedAt: sourceCapturedAt,
        capturedAtLocal: sourceCapturedAtLocal,
        captureAgeMinutes: sourceCaptureAgeMinutes,
        isStale:
          Boolean(kma?.isStale) ||
          (Number.isFinite(sourceCaptureAgeMinutes) &&
            sourceCaptureAgeMinutes >
              (kma?.staleAfterMinutes ?? KMA_STALE_AGE_MINUTES)),
      };
    })
    .filter(Boolean);
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

function formatLocalTime(value, includeSeconds = false) {
  if (Number.isFinite(value)) {
    return formatClock(value, includeSeconds);
  }
  const minute = parseMinute(value);
  return Number.isFinite(minute) ? minuteLabel(minute) : value || "—";
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

function weathercomCaptureValue(diagnostics, captureName, local = false) {
  const flatField = `${captureName}CapturedAt${local ? "Local" : ""}`;
  const nestedCapture = diagnostics?.[`${captureName}Capture`];
  const nestedField = `capturedAt${local ? "Local" : ""}`;
  return (
    diagnostics?.[flatField] ??
    nestedCapture?.[nestedField] ??
    nestedCapture?.capturedAtUtc ??
    nestedCapture?.capturedAt ??
    null
  );
}

function formatWeathercomTime(value) {
  const formatted = formatLocalTime(value);
  return formatted === "—" ? null : `${formatted} KST`;
}

function weathercomBaselineDescriptor(source) {
  const capturedAt =
    weathercomCaptureValue(source, "baseline", true) ??
    weathercomCaptureValue(source, "baseline", false);
  const time = formatLocalTime(capturedAt);
  const hasTime = time !== "—";
  const isFallback = source?.baselineSelection === "latest_before_05:00";
  return {
    time: hasTime ? time : null,
    isFallback,
    label: isFallback
      ? `${hasTime ? time : "Pre-5:00"} fallback`
      : hasTime
        ? `${time} baseline`
        : "morning baseline",
  };
}

function formatWeathercomCadence(value) {
  const labels = {
    one_minute: "one-minute capture",
    five_minute: "five-minute capture",
    audit_fallback: "audit fallback",
  };
  return labels[value] ?? String(value ?? "").replaceAll("_", " ");
}

function weathercomTooltipDetails(point, unit) {
  if (point?.weathercomRole !== "latest") {
    return [];
  }

  const lines = [];
  const baseline = temperatureForUnit(
    point,
    "baselineTempC",
    "baselineTempF",
    unit,
  );
  const previousDistinct = temperatureForUnit(
    point,
    "previousDistinctTempC",
    "previousDistinctTempF",
    unit,
  );
  const preHour = temperatureForUnit(
    point,
    "preHourTempC",
    "preHourTempF",
    unit,
  );
  const actual = temperatureForUnit(point, "actualTempC", "actualTempF", unit);
  const revisionDelta = temperatureForUnit(
    point,
    "revisionDeltaC",
    "revisionDeltaF",
    unit,
  );
  const departureBaseline = temperatureForUnit(
    point,
    "departureBaselineC",
    "departureBaselineF",
    unit,
  );
  const departurePreHour = temperatureForUnit(
    point,
    "departurePreHourC",
    "departurePreHourF",
    unit,
  );
  const latestCapture = formatWeathercomTime(
    point.latestCapturedAtLocal ?? point.latestCapturedAt,
  );
  const baselineCapture = formatWeathercomTime(
    point.baselineCapturedAtLocal ?? point.baselineCapturedAt,
  );
  const preHourCapture = formatWeathercomTime(
    point.preHourCapturedAtLocal ?? point.preHourCapturedAt,
  );
  const actualAt = formatWeathercomTime(
    point.actualAtLocal ?? point.actualAtUtc,
  );
  const revisionDetectedAt = formatWeathercomTime(
    point.revisionDetectedAtLocal ?? point.revisionDetectedAt,
  );
  const baselineDescriptor = weathercomBaselineDescriptor(point);

  if (latestCapture) {
    lines.push(`Latest stored capture: ${latestCapture}`);
  }
  if (Number.isFinite(baseline)) {
    lines.push(
      `${baselineDescriptor.label}: ${formatPredictionTemperature(
        baseline,
        unit,
      )}${baselineCapture ? ` · captured ${baselineCapture}` : ""}`,
    );
  }
  if (Number.isFinite(previousDistinct)) {
    lines.push(
      `Previous distinct: ${formatPredictionTemperature(
        previousDistinct,
        unit,
      )}`,
    );
  }
  if (Number.isFinite(revisionDelta)) {
    lines.push(
      `Revision: ${formatTemperatureDelta(revisionDelta, unit)}${
        revisionDetectedAt ? ` · first detected ${revisionDetectedAt}` : ""
      }`,
    );
  }
  if (Number.isFinite(preHour)) {
    lines.push(
      `Latest before hour: ${formatPredictionTemperature(preHour, unit)}${
        preHourCapture ? ` · captured ${preHourCapture}` : ""
      }`,
    );
  }
  if (Number.isFinite(actual)) {
    const cadence = point.actualCollectionCadence
      ? formatWeathercomCadence(point.actualCollectionCadence)
      : null;
    lines.push(
      `Actual AMOS: ${formatPredictionTemperature(actual, unit)}${
        actualAt ? ` · ${actualAt}` : ""
      }${cadence ? ` · ${cadence}` : ""}`,
    );
  }
  if (Number.isFinite(departureBaseline)) {
    lines.push(
      `Departure vs ${baselineDescriptor.label}: ${formatTemperatureDelta(
        departureBaseline,
        unit,
      )}`,
    );
  }
  if (Number.isFinite(departurePreHour)) {
    lines.push(
      `Departure vs pre-hour: ${formatTemperatureDelta(
        departurePreHour,
        unit,
      )}`,
    );
  }
  return lines;
}

function finiteNumber(value) {
  const numeric = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : null;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) ?? [];
}

function kmaDateForRow(row) {
  const explicitDate = row?.date ?? row?.forecastDate ?? row?.validDate;
  if (isValidDate(explicitDate)) {
    return explicitDate;
  }
  const timestamp =
    row?.forecastTimeLocal ??
    row?.validTimeLocal ??
    row?.timeLocal ??
    row?.forecastAtLocal;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(timestamp ?? ""));
  return match?.[1] ?? null;
}

function normalizeKmaHourlyRows(rows, date, capture, diagnostics) {
  const capturedAt = finiteNumber(
    capture?.capturedAt ??
      diagnostics?.capturedAt ??
      diagnostics?.latestCapturedAt,
  );
  const capturedAtLocal =
    capture?.capturedAtLocal ??
    diagnostics?.capturedAtLocal ??
    diagnostics?.latestCapturedAtLocal;

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const forecastTimeUtc = finiteNumber(
        row?.forecastTimeUtc ??
          row?.validTimeUtc ??
          row?.timeUtc ??
          row?.forecastAtUtc,
      );
      const forecastTimeLocal =
        row?.forecastTimeLocal ??
        row?.validTimeLocal ??
        row?.timeLocal ??
        row?.forecastAtLocal;
      const minute = firstFinite(
        parseMinute(forecastTimeLocal),
        Number.isFinite(forecastTimeUtc)
          ? seoulMinuteForEpoch(forecastTimeUtc)
          : null,
      );
      const tempC = finiteNumber(
        row?.tempC ??
          row?.temperatureC ??
          row?.forecastTempC ??
          row?.latestTempC,
      );
      const tempF = firstFinite(
        finiteNumber(
          row?.tempF ??
            row?.temperatureF ??
            row?.forecastTempF ??
            row?.latestTempF,
        ),
        Number.isFinite(tempC) ? (tempC * 9) / 5 + 32 : null,
      );
      const phrase =
        row?.phrase ??
        row?.cloudPhrase ??
        row?.conditionPhrase ??
        row?.conditionLabel ??
        row?.weatherCondition ??
        row?.condition ??
        null;
      const ceilingFt = finiteNumber(
        row?.ceilingFt ?? row?.ceilingFeet ?? row?.ceiling,
      );
      const rowDate = kmaDateForRow(row);
      if (
        (!Number.isFinite(minute) && !Number.isFinite(forecastTimeUtc)) ||
        (rowDate && rowDate !== date)
      ) {
        return null;
      }
      return {
        ...row,
        date: rowDate ?? date,
        forecastTimeUtc,
        forecastTimeLocal,
        minute,
        tempC,
        tempF,
        phrase: phrase ? String(phrase).trim() : null,
        conditionCode: row?.conditionCode ?? row?.code ?? null,
        ceilingFt,
        ceilingText: row?.ceilingText ?? null,
        capturedAt: finiteNumber(row?.capturedAt) ?? capturedAt,
        capturedAtLocal: row?.capturedAtLocal ?? capturedAtLocal,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        (left.forecastTimeUtc ?? Number.POSITIVE_INFINITY) -
          (right.forecastTimeUtc ?? Number.POSITIVE_INFINITY) ||
        (left.minute ?? Number.POSITIVE_INFINITY) -
          (right.minute ?? Number.POSITIVE_INFINITY),
    );
}

function normalizeKmaDashboard(dashboard, date, nowMs) {
  const access = dashboard?.kmaAccess ?? dashboard?.kmaConfigStatus ?? null;
  const forecast = dashboard?.kmaForecast ?? null;
  const collector = forecast?.collector ?? dashboard?.kmaCollector ?? null;
  const diagnostics = dashboard?.kmaHourlyDiagnostics ?? null;
  const capture =
    forecast?.latestCapture ??
    dashboard?.latestKmaForecastCapture ??
    dashboard?.latestForecastCapture ??
    null;
  const selectedDateForecast =
    forecast?.selectedDateForecast ??
    diagnostics?.selectedDateForecast ??
    firstArray(
      capture?.dailyRows,
      capture?.forecastDays,
      capture?.kmaForecastDays,
    ).find((row) => row?.date === date) ??
    null;
  const rawHourlyRows = firstArray(
    forecast?.hourlyRows,
    diagnostics?.points,
    diagnostics?.rows,
    capture?.hourlyRows,
    capture?.kmaHourlyRows,
  );
  const hourlyRows = normalizeKmaHourlyRows(
    rawHourlyRows,
    date,
    capture,
    diagnostics,
  );
  const dailyHighC = firstFinite(
    finiteNumber(selectedDateForecast?.maxTempC),
    finiteNumber(selectedDateForecast?.dailyMaxTempC),
    finiteNumber(selectedDateForecast?.maxC),
  );
  const rawStatus = String(
    access?.status ??
      forecast?.status ??
      capture?.status ??
      diagnostics?.status ??
      "",
  ).toLowerCase();
  const approvalRequired =
    access?.approved === false ||
    [
      "approval_required",
      "access_not_approved",
      "not_approved",
      "disabled",
    ].includes(rawStatus) ||
    capture?.status === "approval_required";
  const setupRequired = [
    "setup_required",
    "not_configured",
    "configuration_required",
  ].includes(rawStatus);
  const capturedAt = finiteNumber(
    capture?.capturedAt ??
      forecast?.latestCapturedAt ??
      diagnostics?.latestCapturedAt,
  );
  const capturedAtLocal =
    capture?.capturedAtLocal ??
    forecast?.latestCapturedAtLocal ??
    diagnostics?.latestCapturedAtLocal;
  const captureAgeMinutes =
    Number.isFinite(nowMs) && Number.isFinite(capturedAt)
      ? Math.max(0, nowMs - capturedAt) / MINUTE_MS
      : firstFinite(
          finiteNumber(forecast?.latestSuccessAgeMinutes),
          finiteNumber(diagnostics?.latestSuccessAgeMinutes),
        );
  const staleAfterMinutes = firstFinite(
    finiteNumber(forecast?.staleAfterMinutes),
    finiteNumber(diagnostics?.staleAfterMinutes),
    KMA_STALE_AGE_MINUTES,
  );
  const isStale =
    Boolean(forecast?.isStale ?? diagnostics?.isStale) ||
    (Number.isFinite(captureAgeMinutes) &&
      captureAgeMinutes > staleAfterMinutes);
  const latestAttemptStatus =
    forecast?.latestAttemptStatus ??
    diagnostics?.latestAttemptStatus ??
    (diagnostics?.status === "error" ? "error" : null) ??
    (capture?.status === "error" ? "error" : null);
  const latestAttemptError =
    forecast?.latestAttemptError ??
    diagnostics?.latestAttemptError ??
    diagnostics?.error ??
    capture?.error ??
    null;
  const available =
    !approvalRequired &&
    !setupRequired &&
    (Number.isFinite(dailyHighC) || hourlyRows.length > 0);

  return {
    loading: dashboard === undefined,
    access,
    forecast,
    collector,
    diagnostics,
    capture,
    selectedDateForecast,
    hourlyRows,
    dailyHighC,
    capturedAt,
    capturedAtLocal,
    captureAgeMinutes,
    staleAfterMinutes,
    isStale,
    latestAttemptStatus,
    latestAttemptError,
    approvalRequired,
    setupRequired,
    available,
    collectionCooldownSeconds: firstFinite(
      finiteNumber(forecast?.collectionCooldownSeconds),
      10 * 60,
    ),
    collectionLockTimeoutSeconds: firstFinite(
      finiteNumber(forecast?.collectionLockTimeoutSeconds),
      15 * 60,
    ),
    sourceUrl:
      forecast?.sourceUrl ??
      access?.sourceUrl ??
      capture?.sourceUrl ??
      "https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI",
  };
}

function kmaHourlyPeak(rows) {
  const usable = (rows ?? []).filter(
    (row) => Number.isFinite(row?.tempC) && Number.isFinite(row?.minute),
  );
  if (!usable.length) {
    return null;
  }
  const peakTempC = Math.max(...usable.map((row) => row.tempC));
  const tied = usable.filter((row) => row.tempC === peakTempC);
  return {
    tempC: peakTempC,
    firstMinute: tied[0].minute,
    lastMinute: tied.at(-1).minute,
    firstRow: tied[0],
    lastRow: tied.at(-1),
    tiedCount: tied.length,
  };
}

function formatKmaPeakWindow(peak) {
  if (!peak) {
    return null;
  }
  if (peak.firstMinute === peak.lastMinute) {
    return `${minuteLabel(peak.firstMinute)} KST`;
  }
  return `${minuteLabel(peak.firstMinute)}–${minuteLabel(peak.lastMinute)} KST`;
}

function selectKmaProviderPeak(kma, unit) {
  if (!kma?.available) {
    return null;
  }
  const hourlyPeak = kmaHourlyPeak(kma?.hourlyRows);
  const temperatureC = kma?.dailyHighC;
  const minute = hourlyPeak?.firstMinute;
  if (!Number.isFinite(temperatureC) || !Number.isFinite(minute)) {
    return null;
  }
  return {
    provider: "kma_amo",
    providerLabel: "KMA/AMO · RKSI",
    minute,
    temperature: toUnitTemperature(temperatureC, unit),
    peakTimeUtc: hourlyPeak.firstRow?.forecastTimeUtc,
    peakTimeLocal: hourlyPeak.firstRow?.forecastTimeLocal,
    capturedAt: kma?.capturedAt,
    capturedAtLocal: kma?.capturedAtLocal,
    source: "kma_official_airport_forecast",
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

function toWeathercomHourlyPoints(diagnostics, unit, role) {
  const rows = Array.isArray(diagnostics?.points) ? diagnostics.points : [];
  const latestCapturedAt = weathercomCaptureValue(diagnostics, "latest", false);
  const latestCapturedAtLocal = weathercomCaptureValue(
    diagnostics,
    "latest",
    true,
  );
  const baselineCapturedAt = weathercomCaptureValue(
    diagnostics,
    "baseline",
    false,
  );
  const baselineCapturedAtLocal = weathercomCaptureValue(
    diagnostics,
    "baseline",
    true,
  );
  const cField = role === "baseline" ? "baselineTempC" : "latestTempC";
  const fField = role === "baseline" ? "baselineTempF" : "latestTempF";

  return rows
    .map((row) => {
      const x = firstFinite(
        parseMinute(row.forecastTimeLocal),
        Number.isFinite(row.forecastTimeUtc)
          ? seoulMinuteForEpoch(row.forecastTimeUtc)
          : null,
      );
      const y = temperatureForUnit(row, cField, fField, unit);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return {
        ...row,
        x,
        y,
        weathercomRole: role,
        latestCapturedAt: row.latestCapturedAt ?? latestCapturedAt,
        latestCapturedAtLocal:
          row.latestCapturedAtLocal ?? latestCapturedAtLocal,
        baselineCapturedAt: row.baselineCapturedAt ?? baselineCapturedAt,
        baselineCapturedAtLocal:
          row.baselineCapturedAtLocal ?? baselineCapturedAtLocal,
        baselineSelection:
          row.baselineSelection ?? diagnostics?.baselineSelection,
        cloudCoverPct:
          role === "latest" && Number.isFinite(row.cloudCoverPct)
            ? row.cloudCoverPct
            : null,
        revisionDelta: temperatureForUnit(
          row,
          "revisionDeltaC",
          "revisionDeltaF",
          unit,
        ),
        revisionDeltaC: Number.isFinite(row.revisionDeltaC)
          ? row.revisionDeltaC
          : null,
      };
    })
    .filter(Boolean);
}

function toKmaHourlyPoints(rows, unit) {
  return (rows ?? [])
    .map((row) => {
      const x = firstFinite(
        row?.minute,
        parseMinute(row?.forecastTimeLocal),
        Number.isFinite(row?.forecastTimeUtc)
          ? seoulMinuteForEpoch(row.forecastTimeUtc)
          : null,
      );
      const y = unit === "C" ? row?.tempC : row?.tempF;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return {
        ...row,
        x,
        y,
        kmaForecastRole: "primary",
        forecastCondition: row?.phrase ?? null,
        forecastCeilingLabel: kmaCeilingLabel(row),
      };
    })
    .filter(Boolean);
}

function buildChartData(
  metarRows,
  amosDisplayRows,
  observedMax,
  providerPeak,
  kmaHourlyRows,
  weathercomHourlyDiagnostics,
  unit,
) {
  const amosPoints = toChartPoints(amosDisplayRows, unit, (row) => ({
    displayCadence: row.displayCadence,
  }));
  const metarPoints = toChartPoints(metarRows, unit, (row) => ({
    reportType: row.reportType,
    rawMetar: row.rawMetar,
    skySummary: metarSkySummary(parseMetarSkyCondition(row.rawMetar)),
  }));
  const weathercomLatestPoints = toWeathercomHourlyPoints(
    weathercomHourlyDiagnostics,
    unit,
    "latest",
  );
  const weathercomBaselinePoints = toWeathercomHourlyPoints(
    weathercomHourlyDiagnostics,
    unit,
    "baseline",
  );
  const kmaHourlyPoints = toKmaHourlyPoints(kmaHourlyRows, unit);
  const datasets = [
    {
      label: "Representative AMOS · 15L designation",
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
      label: "Official coded METAR · audit",
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

  if (observedMax) {
    datasets.unshift({
      label: "Observed AMOS max",
      data: [
        {
          x: observedMax.minute,
          y: observedMax.temperature,
          obsTimeUtc: observedMax.obsTimeUtc,
          obsTimeLocal: observedMax.obsTimeLocal,
        },
      ],
      showLine: false,
      borderColor: "#34d399",
      backgroundColor: "#052e2b",
      pointBorderColor: "#6ee7b7",
      pointBackgroundColor: "#052e2b",
      pointBorderWidth: 2.5,
      pointRadius: 6,
      pointHitRadius: 12,
      pointHoverRadius: 8,
      pointStyle: "rectRot",
      order: -1,
    });
  }

  if (kmaHourlyPoints.length) {
    datasets.unshift({
      label: "KMA/AMO · official RKSI airport forecast",
      data: kmaHourlyPoints,
      kmaForecastRole: "primary",
      borderColor: "#c4b5fd",
      backgroundColor: "#c4b5fd",
      borderWidth: 2.75,
      borderDash: [8, 4],
      pointRadius: 3,
      pointHitRadius: 11,
      pointHoverRadius: 6,
      pointBorderColor: "#ede9fe",
      pointBackgroundColor: "#1e1b4b",
      pointBorderWidth: 1.25,
      tension: 0.22,
      spanGaps: false,
      order: 3,
    });
  }

  if (weathercomBaselinePoints.length) {
    const baselineDescriptor = weathercomBaselineDescriptor(
      weathercomHourlyDiagnostics,
    );
    datasets.unshift({
      label: `Secondary Weather.com · ${baselineDescriptor.label}`,
      data: weathercomBaselinePoints,
      weathercomRole: "baseline",
      borderColor: "rgba(147, 197, 253, 0.22)",
      backgroundColor: "rgba(147, 197, 253, 0.22)",
      borderWidth: 1.25,
      borderDash: [2, 9],
      pointRadius: 0,
      pointHitRadius: 9,
      pointHoverRadius: 4,
      pointBackgroundColor: "#93c5fd",
      tension: 0.28,
      spanGaps: false,
      order: 5,
    });
  }

  if (weathercomLatestPoints.length) {
    datasets.unshift({
      label: "Secondary Weather.com · latest stored",
      data: weathercomLatestPoints,
      weathercomRole: "latest",
      borderColor: "#60a5fa",
      backgroundColor: "#60a5fa",
      borderWidth: 1.5,
      borderDash: [3, 7],
      pointRadius: 1.75,
      pointHitRadius: 11,
      pointHoverRadius: 5,
      pointBorderColor: "#bfdbfe",
      pointBorderWidth: 1,
      tension: 0.28,
      spanGaps: false,
      order: 4,
    });
  }

  if (providerPeak) {
    datasets.unshift({
      label: `${providerPeak.providerLabel} published daily high · hourly time estimate`,
      hideFromLegend: true,
      data: [
        {
          x: providerPeak.minute,
          y: providerPeak.temperature,
          forecastTimeUtc: providerPeak.peakTimeUtc,
          forecastTimeLocal: providerPeak.peakTimeLocal,
        },
      ],
      showLine: false,
      borderColor: "#f472b6",
      backgroundColor: "#f472b6",
      pointBorderColor: "#f472b6",
      pointBackgroundColor: "#07111f",
      pointBorderWidth: 3,
      pointRadius: 6,
      pointHitRadius: 12,
      pointHoverRadius: 8,
      order: 0,
    });
  }

  return { datasets };
}

function statusBadgeClasses(status) {
  const classes = {
    fresh: "border-emerald-300/25 bg-emerald-300/10 text-emerald-300",
    delayed: "border-amber-300/25 bg-amber-300/10 text-amber-300",
    stale: "border-rose-300/25 bg-rose-300/10 text-rose-300",
    archive: "border-slate-400/20 bg-slate-400/10 text-slate-400",
    waiting: "border-slate-500/20 bg-slate-500/10 text-slate-500",
  };
  return classes[status] ?? classes.waiting;
}

function SourceCard({
  accent,
  label,
  value,
  unit,
  detail,
  timing,
  freshness,
  count,
}) {
  return (
    <div className="min-w-0 border-l border-white/10 px-4 first:border-l-0 first:pl-0 md:px-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_14px_currentColor]"
            style={{ color: accent, backgroundColor: accent }}
          />
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {label}
          </span>
        </div>
        {freshness && (
          <span
            className={`shrink-0 border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] ${statusBadgeClasses(
              freshness.status,
            )}`}
          >
            {freshness.label}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end gap-1">
        <span className="text-2xl font-medium tracking-tight text-white md:text-3xl">
          {value}
        </span>
        <span className="pb-1 text-xs text-slate-500">{unit}</span>
      </div>
      <p className="mt-1 font-mono text-[10px] leading-4 text-slate-500">
        {detail} · {count} pts
      </p>
      {timing && (
        <p className="font-mono text-[9px] leading-4 text-slate-600">
          {timing}
        </p>
      )}
    </div>
  );
}

function OutlookMetric({ label, value, detail, tone = "text-slate-100" }) {
  return (
    <div className="min-w-0 bg-[#081321] px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.17em] text-slate-500">
        {label}
      </p>
      <p className={`mt-1 truncate text-lg font-medium ${tone}`}>{value}</p>
      <p className="mt-1 min-h-4 font-mono text-[9px] leading-4 text-slate-500">
        {detail}
      </p>
    </div>
  );
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "—";
}

function formatPercentagePointChange(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)} pp`;
}

function solarTrendLabel(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "increasing") {
    return "Increasing";
  }
  if (normalized === "decreasing") {
    return "Decreasing";
  }
  if (normalized === "steady") {
    return "Holding steady";
  }
  return "Unavailable";
}

function compassDirection(degrees) {
  if (!Number.isFinite(degrees)) {
    return "—";
  }
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function Gk2aLoop({ windDirectionDeg, windSpeedKt, upstreamEtaMinutes }) {
  const [opened, setOpened] = useState(false);
  const [loop, setLoop] = useState({
    status: "idle",
    frames: [],
    message: "",
    durationMinutes: null,
    cadenceMinutes: null,
  });
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loadedFrameTimes, setLoadedFrameTimes] = useState(() => new Set());

  useEffect(() => {
    if (!opened || loop.status !== "idle") {
      return;
    }

    const controller = new AbortController();
    setLoop((current) => ({ ...current, status: "loading" }));
    fetch("/api/seoul/gk2a-loop", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body?.error ?? "GK2A imagery request failed");
        }
        return body;
      })
      .then((body) => {
        const frames = Array.isArray(body?.frames) ? body.frames : [];
        if (frames.length === 0) {
          throw new Error("KMA returned no recent imagery");
        }
        setLoop({
          status: "ready",
          frames,
          message: "",
          durationMinutes: body.durationMinutes,
          cadenceMinutes: body.cadenceMinutes,
        });
        setLoadedFrameTimes(new Set());
        setFrameIndex(frames.length - 1);
      })
      .catch((error) => {
        if (error?.name === "AbortError") {
          setLoop((current) =>
            current.status === "loading"
              ? { ...current, status: "idle" }
              : current,
          );
          return;
        }
        setLoop({
          status: "error",
          frames: [],
          message: error?.message ?? "GK2A imagery is unavailable",
          durationMinutes: null,
          cadenceMinutes: null,
        });
      });

    return () => controller.abort();
    // Loading state changes must not restart and abort this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  useEffect(() => {
    if (loop.status !== "ready" || loop.frames.length === 0) {
      return;
    }

    let cancelled = false;
    const preloaders = loop.frames.map((candidate) => {
      const image = new window.Image();
      image.onload = () => {
        if (!cancelled) {
          setLoadedFrameTimes((current) => {
            if (current.has(candidate.tm)) {
              return current;
            }
            const next = new Set(current);
            next.add(candidate.tm);
            return next;
          });
        }
      };
      image.src = candidate.src;
      return image;
    });
    return () => {
      cancelled = true;
      for (const image of preloaders) {
        image.onload = null;
      }
    };
  }, [loop.frames, loop.status]);

  const allFramesBuffered =
    loop.status === "ready" &&
    loop.frames.length > 0 &&
    loadedFrameTimes.size === loop.frames.length;

  useEffect(() => {
    if (!playing || !allFramesBuffered || loop.frames.length < 2) {
      return;
    }
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % loop.frames.length);
    }, 650);
    return () => window.clearInterval(timer);
  }, [allFramesBuffered, loop.frames.length, playing]);

  const frame = loop.frames[frameIndex] ?? null;
  const windLabel = Number.isFinite(windDirectionDeg)
    ? `${String(Math.round(windDirectionDeg)).padStart(3, "0")}° ${compassDirection(
        windDirectionDeg,
      )}`
    : "unavailable";
  const etaLabel = Number.isFinite(upstreamEtaMinutes)
    ? `~${Math.round(upstreamEtaMinutes)} min`
    : "unavailable";

  return (
    <details
      className="border-t border-white/10"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300 transition hover:bg-cyan-300/[0.04] md:px-5 [&::-webkit-details-marker]:hidden">
        <span>GK2A loop · previous 60–90 minutes</span>
        <span className="text-slate-500">Expand ↘</span>
      </summary>

      <div className="grid gap-4 border-t border-white/[0.06] bg-[#06101c] p-4 lg:grid-cols-[minmax(0,840px)_minmax(220px,1fr)] md:p-5">
        <div className="relative h-[440px] max-w-[840px] overflow-hidden border border-white/10 bg-black">
          {loop.status === "loading" && (
            <div className="grid h-full place-items-center font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
              Loading KMA frames…
            </div>
          )}
          {loop.status === "error" && (
            <div className="grid h-full place-items-center px-6 text-center font-mono text-[10px] leading-5 text-rose-300">
              {loop.message}
            </div>
          )}
          {frame && (
            <>
              {/* Fixed crop centers RKSI (37.4602, 126.4407) in KMA's 600 px
                  ko020lc cloud-enhanced image. */}
              <img
                key={frame.tm}
                src={frame.src}
                alt={`GK2A cloud-enhanced image around RKSI at ${frame.label}`}
                onLoad={() =>
                  setLoadedFrameTimes((current) => {
                    if (current.has(frame.tm)) {
                      return current;
                    }
                    const next = new Set(current);
                    next.add(frame.tm);
                    return next;
                  })
                }
                className="absolute h-[840px] w-[840px] max-w-none select-none object-fill"
                style={{
                  left: "calc(50% - 416px)",
                  top: "calc(50% - 392px)",
                }}
              />
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_48%,rgba(1,7,15,0.38)_100%)]" />
              {Number.isFinite(windDirectionDeg) && (
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 -ml-8 -mt-40 h-40 w-16 border-x border-cyan-200/35 bg-gradient-to-t from-cyan-300/20 to-transparent"
                  style={{
                    transformOrigin: "50% 100%",
                    transform: `rotate(${windDirectionDeg}deg)`,
                  }}
                  aria-hidden="true"
                >
                  <span className="absolute bottom-1 left-1/2 h-[calc(100%-0.25rem)] w-px -translate-x-1/2 bg-cyan-100/75" />
                  <span className="absolute bottom-0 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-cyan-100" />
                </div>
              )}
              <span className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-300 shadow-[0_0_18px_4px_rgba(34,211,238,0.7)]" />
              <span className="pointer-events-none absolute left-1/2 top-1/2 ml-3 mt-2 bg-[#03101b]/90 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.12em] text-white">
                RKSI
              </span>
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-3 pb-3 pt-8">
                <span className="font-mono text-[10px] text-white">
                  {frame.label}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setFrameIndex((current) =>
                        current === 0 ? loop.frames.length - 1 : current - 1,
                      )
                    }
                    className="grid h-7 w-7 place-items-center border border-white/20 bg-black/60 text-xs text-white hover:border-white/50"
                    aria-label="Previous GK2A frame"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlaying((current) => !current)}
                    disabled={!allFramesBuffered}
                    className="h-7 min-w-14 border border-white/20 bg-black/60 px-2 font-mono text-[9px] uppercase tracking-[0.12em] text-white hover:border-white/50 disabled:cursor-wait disabled:text-slate-400"
                  >
                    {!allFramesBuffered
                      ? `Buffer ${loadedFrameTimes.size}/${loop.frames.length}`
                      : playing
                        ? "Pause"
                        : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFrameIndex(
                        (current) => (current + 1) % loop.frames.length,
                      )
                    }
                    className="grid h-7 w-7 place-items-center border border-white/20 bg-black/60 text-xs text-white hover:border-white/50"
                    aria-label="Next GK2A frame"
                  >
                    →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
              Surface-wind overlay
            </p>
            <p className="mt-1 text-lg text-slate-100">From {windLabel}</p>
            <p className="mt-1 font-mono text-[9px] leading-4 text-slate-500">
              {Number.isFinite(windSpeedKt)
                ? `${windSpeedKt.toFixed(1)} kt representative AMOS wind`
                : "No current representative AMOS wind"}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
              Estimated arrival / clearing
            </p>
            <p className="mt-1 text-lg text-slate-100">{etaLabel}</p>
            <p className="mt-1 font-mono text-[9px] leading-4 text-slate-500">
              Distance divided by surface wind; cloud-layer motion can differ.
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">
              Loop coverage
            </p>
            <p className="mt-1 text-lg text-slate-100">
              {Number.isFinite(loop.durationMinutes)
                ? `${loop.durationMinutes} minutes`
                : "Awaiting frames"}
            </p>
            <p className="mt-1 font-mono text-[9px] leading-4 text-slate-500">
              {loop.frames.length
                ? `${loop.frames.length} frames · ${loop.cadenceMinutes}-minute display cadence`
                : "Loaded only while this panel is expanded"}
            </p>
          </div>
          <p className="border-t border-white/10 pt-3 font-mono text-[9px] leading-4 text-slate-600">
            Source: KMA/NMSC GK2A RGB cloud-enhanced imagery. The corridor is
            oriented by surface wind and is not a satellite-derived cloud-motion
            vector.
          </p>
        </div>
      </div>
    </details>
  );
}

function SolarHeatingPanel({
  solar,
  queryLoading,
  latestAmos,
  isToday,
  collectionWindowOpen,
  clockNowMs,
  onRefresh,
  refreshState,
}) {
  const latest = solar?.latest ?? null;
  const configured = solar?.configured !== false;
  const status = queryLoading
    ? "loading"
    : !configured
      ? "setup required"
      : (solar?.status ?? (latest ? "current" : "awaiting data"));
  const guidanceCurrent =
    isToday &&
    (status === "ok" || status === "partial" || status === "current") &&
    (!Number.isFinite(solar?.observationAgeMinutes) ||
      solar.observationAgeMinutes <= 35);
  const currentTransmission = formatPercent(latest?.transmissionPct);
  const currentDetail = Number.isFinite(latest?.dsrWm2)
    ? `${Math.round(latest.dsrWm2)} W/m² DSR at ${formatClock(
        latest.obsTimeUtc,
      )}${
        Number.isFinite(solar?.observationAgeMinutes)
          ? ` · ${Math.round(solar.observationAgeMinutes)} min old`
          : ""
      }`
    : configured
      ? "No valid daylight DSR sample"
      : "NMSC access approval required";
  const changeWindowLabel = Number.isFinite(solar?.change30mActualMinutes)
    ? `${guidanceCurrent ? "Change" : "Latest retained change"} over ${Math.round(
        solar.change30mActualMinutes,
      )} minutes`
    : guidanceCurrent
      ? "Change around 30 minutes"
      : "Latest retained change";
  const changeDetail = Number.isFinite(solar?.change30mActualMinutes)
    ? guidanceCurrent
      ? `Nearest valid sample ${Math.round(solar.change30mActualMinutes)} min earlier`
      : `Retained diagnostic ending at ${formatClock(latest?.obsTimeUtc)}`
    : "Requires two valid daylight samples";
  const expectedNextHour = guidanceCurrent
    ? solar?.expectedNextHour
    : "unavailable";
  const clearingValue =
    guidanceCurrent && solar?.upstreamClearing === true
      ? "Yes"
      : guidanceCurrent && solar?.upstreamClearing === false
        ? "No"
        : "Unknown";
  const windDirectionDeg = Number.isFinite(solar?.windDirectionDeg)
    ? solar.windDirectionDeg
    : latestAmos?.windDirAvg;
  const windSpeedKt = Number.isFinite(solar?.windSpeedKt)
    ? solar.windSpeedKt
    : latestAmos?.windSpeedAvg;
  const statusTone =
    status === "ok" || status === "current"
      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300"
      : status === "loading" || status === "night" || status === "window_closed"
        ? "border-slate-400/20 bg-slate-400/10 text-slate-400"
        : "border-amber-300/25 bg-amber-300/10 text-amber-300";
  const collectorRunning =
    Number.isFinite(solar?.collector?.collectionInFlightSince) &&
    Number.isFinite(clockNowMs) &&
    clockNowMs - solar.collector.collectionInFlightSince < 15 * 60_000;
  const refreshActive = refreshState?.active || collectorRunning;

  return (
    <section className="mt-5 border border-white/10 bg-[#081321]/85">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 md:px-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
            Solar heating
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Actual GK2A surface downward shortwave radiation relative to a
            modeled clear sky.
          </p>
          {solar?.statusMessage && !queryLoading ? (
            <p className="mt-2 max-w-2xl font-mono text-[9px] leading-4 text-slate-500">
              {solar.statusMessage}
            </p>
          ) : null}
          {refreshState?.message ? (
            <p className="mt-2 font-mono text-[9px] leading-4 text-cyan-300/80">
              {refreshState.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isToday ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshActive || !collectionWindowOpen || !configured}
              title={
                !configured
                  ? "NMSC access approval is required before collection"
                  : collectionWindowOpen
                    ? "Queue the newest GK2A SWRAD frame"
                    : "GK2A downloads are limited to 11:00–16:00 KST"
              }
              className="border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-cyan-200 transition hover:border-cyan-200/60 hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshActive
                ? "GK2A queued"
                : !configured
                  ? "Approval required"
                  : collectionWindowOpen
                    ? "Refresh GK2A"
                    : "11–16 KST only"}
            </button>
          ) : null}
          <span
            className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] ${statusTone}`}
          >
            {String(status).replaceAll("_", " ")}
          </span>
        </div>
      </div>

      <div className="grid gap-px border-y border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
        <OutlookMetric
          label={
            guidanceCurrent
              ? "Current solar transmission"
              : "Latest retained transmission"
          }
          value={queryLoading ? "Loading…" : currentTransmission}
          detail={currentDetail}
          tone="text-amber-200"
        />
        <OutlookMetric
          label={changeWindowLabel}
          value={formatPercentagePointChange(solar?.change30mPctPoints)}
          detail={changeDetail}
          tone={
            solar?.change30mPctPoints > 2
              ? "text-amber-200"
              : solar?.change30mPctPoints < -2
                ? "text-sky-200"
                : "text-slate-200"
          }
        />
        <OutlookMetric
          label="Expected next hour"
          value={solarTrendLabel(expectedNextHour)}
          detail={
            guidanceCurrent
              ? "Recent transmission trend plus upwind GK2A points"
              : "Available only for a fresh in-window sample"
          }
          tone={
            expectedNextHour === "increasing"
              ? "text-amber-200"
              : expectedNextHour === "decreasing"
                ? "text-sky-200"
                : "text-slate-200"
          }
        />
        <OutlookMetric
          label="Cloud clearing upstream"
          value={clearingValue}
          detail={
            guidanceCurrent && Number.isFinite(solar?.upstreamEtaMinutes)
              ? `Surface-wind proxy ~${Math.round(
                  solar.upstreamEtaMinutes,
                )} min`
              : "Requires upwind DSR and representative wind"
          }
          tone={
            guidanceCurrent && solar?.upstreamClearing === true
              ? "text-emerald-200"
              : "text-slate-200"
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 font-mono text-[9px] leading-4 text-slate-600 md:px-5">
        <span>
          {Number.isFinite(latest?.clearSkyDsrWm2)
            ? `Modeled clear sky ${Math.round(latest.clearSkyDsrWm2)} W/m²`
            : "Night and very-low-sun frames do not produce transmission"}
        </span>
        <span>
          Source: KMA/NMSC GK2A SWRAD NetCDF · 10-minute · approx. 2 km
        </span>
      </div>

      <Gk2aLoop
        windDirectionDeg={windDirectionDeg}
        windSpeedKt={windSpeedKt}
        upstreamEtaMinutes={solar?.upstreamEtaMinutes}
      />
    </section>
  );
}

function MaxOutlookPanel({
  date,
  today,
  clockNowMs,
  unit,
  latestAmos,
  amosFreshness,
  observedMax,
  kma,
  kmaPeak,
  expectedHighC,
  trendCPerHour,
  onCollect,
  collectionState,
}) {
  const isToday = date === today;
  const isArchive = date < today;
  const currentC = latestAmos?.tempC;
  const kmaDailyHighC = kma?.dailyHighC;
  const peakWindow = formatKmaPeakWindow(kmaPeak);
  const kmaCaptureTime = formatLocalTime(
    kma?.capturedAtLocal ?? kma?.capturedAt,
  );
  const kmaPublishedHigh = formatPredictionTemperature(
    toUnitTemperature(kmaDailyHighC, unit),
    unit,
  );
  const kmaHourlyPeak = formatPredictionTemperature(
    toUnitTemperature(kmaPeak?.tempC, unit),
    unit,
  );
  const hasKmaMaximum = Boolean(
    kma?.available && Number.isFinite(kmaDailyHighC),
  );
  const expectedLabel = kma?.loading
    ? "Expected max"
    : hasKmaMaximum
      ? isArchive
        ? "Stored KMA-based max"
        : "Expected max"
      : observedMax
        ? "Observed max only"
        : "Expected max";
  const observedExceedsKma =
    hasKmaMaximum &&
    Number.isFinite(observedMax?.tempC) &&
    observedMax.tempC > kmaDailyHighC;
  const expectedDetail = kma?.loading
    ? "Loading the official KMA/AMO airport forecast"
    : hasKmaMaximum
      ? observedExceedsKma
        ? "Observed AMOS has exceeded KMA; actual observation sets the floor"
        : "KMA/AMO published high; observed AMOS is the only floor"
      : observedMax
        ? "KMA forecast unavailable; no secondary forecast substituted"
        : "KMA forecast and representative observation unavailable";
  const trendInUnit = toUnitTemperatureDelta(trendCPerHour, unit);
  const trendIsCurrent = !isToday || amosFreshness.status === "fresh";
  const displayedTrend = trendIsCurrent ? trendInUnit : null;
  const trendValue = Number.isFinite(displayedTrend)
    ? `${displayedTrend > 0 ? "+" : ""}${displayedTrend.toFixed(1)}°${unit}/h`
    : "Unavailable";
  const forecastStatus = kma?.loading
    ? "Loading KMA forecast"
    : kma?.approvalRequired
      ? "KMA approval required"
      : kma?.setupRequired
        ? "KMA setup required"
        : kma?.available
          ? isArchive
            ? "Stored KMA forecast"
            : kma.isStale
              ? "Stored KMA forecast · stale"
              : isToday
                ? "Current KMA forecast"
                : "Stored KMA forecast"
          : "KMA forecast unavailable";
  const forecastStatusTone =
    kma?.approvalRequired || kma?.setupRequired
      ? "border-amber-300/25 bg-amber-300/10 text-amber-300"
      : kma?.available && (isArchive || !kma?.isStale)
        ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-300"
        : kma?.isStale
          ? "border-amber-300/25 bg-amber-300/10 text-amber-300"
          : "border-slate-500/20 bg-slate-500/10 text-slate-500";
  const collectorInFlightSince = finiteNumber(
    kma?.collector?.collectionInFlightSince,
  );
  const collectionLockTimeoutMs =
    (finiteNumber(kma?.collectionLockTimeoutSeconds) ?? 15 * 60) * 1_000;
  const collectorRunning =
    Number.isFinite(collectorInFlightSince) &&
    (!Number.isFinite(clockNowMs) ||
      clockNowMs - collectorInFlightSince < collectionLockTimeoutMs);
  const collectionActive = Boolean(collectionState?.active || collectorRunning);
  const backendRetryAt = Number.isFinite(kma?.collector?.collectionQueuedAt)
    ? kma.collector.collectionQueuedAt +
      (finiteNumber(kma?.collectionCooldownSeconds) ?? 10 * 60) * 1_000
    : null;
  const retryAt = Math.max(
    finiteNumber(collectionState?.retryAt) ?? 0,
    finiteNumber(backendRetryAt) ?? 0,
  );
  const retrySeconds =
    Number.isFinite(clockNowMs) && retryAt > clockNowMs
      ? Math.ceil((retryAt - clockNowMs) / 1_000)
      : 0;
  const collectDisabled =
    kma?.loading ||
    kma?.approvalRequired ||
    kma?.setupRequired ||
    collectionActive ||
    retrySeconds > 0;
  const collectLabel = kma?.loading
    ? "Loading KMA"
    : kma?.approvalRequired
      ? "Approval required"
      : kma?.setupRequired
        ? "Setup required"
        : collectionActive
          ? "Collecting KMA…"
          : retrySeconds > 0
            ? `Retry in ${Math.max(1, Math.ceil(retrySeconds / 60))}m`
            : "Collect KMA now";
  const collectTitle = kma?.approvalRequired
    ? `${kma?.access?.flagName ?? "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED"} must be approved before manual collection.`
    : kma?.setupRequired
      ? "KMA/AMO collection requires server-side setup."
      : retrySeconds > 0
        ? `KMA collection is rate-limited; retry in ${retrySeconds} seconds.`
        : "Fetch the latest official KMA/AMO RKSI airport forecast.";
  const accessMessage = kma?.approvalRequired
    ? `${kma?.access?.flagName ?? "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED"} is not approved. Official KMA forecast collection is disabled, and Weather.com is not used as a fallback.`
    : kma?.setupRequired
      ? "KMA/AMO collection needs server-side setup. Weather.com is not used as a primary substitute."
      : null;
  const attemptMessage =
    kma?.latestAttemptStatus === "error"
      ? kma?.latestAttemptError
        ? `Latest KMA collection attempt failed: ${kma.latestAttemptError}`
        : "Latest KMA collection attempt failed; stored KMA guidance may remain visible."
      : null;
  const vintage = [
    kmaCaptureTime !== "—" ? `KMA captured ${kmaCaptureTime} KST` : null,
    Number.isFinite(kma?.captureAgeMinutes)
      ? `${Math.round(kma.captureAgeMinutes)}m old`
      : null,
    kma?.isStale && !isArchive ? "stale stored guidance" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-labelledby="seoul-max-outlook-title"
      className="border-b border-white/10 py-4"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p
            id="seoul-max-outlook-title"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300"
          >
            {isToday
              ? "Live maximum outlook"
              : isArchive
                ? "Archived maximum summary"
                : "Maximum outlook"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            KMA/AMO&apos;s official RKSI airport forecast, with representative
            AMOS observations using the feed&apos;s 15L designation.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isArchive && (
            <button
              type="button"
              onClick={onCollect}
              disabled={collectDisabled}
              title={collectTitle}
              className="border border-violet-300/30 bg-violet-300/10 px-3 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-200 transition hover:border-violet-200/60 hover:bg-violet-300/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {collectLabel}
            </button>
          )}
          <span
            className={`border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] ${forecastStatusTone}`}
          >
            {forecastStatus}
          </span>
        </div>
      </div>

      {(collectionState?.message || collectorRunning) && (
        <p
          aria-live="polite"
          className="mb-3 font-mono text-[10px] leading-4 text-violet-200/80"
        >
          {collectionState?.message || "KMA collection is running…"}
        </p>
      )}

      {(accessMessage || attemptMessage) && (
        <div className="mb-3 border border-amber-300/20 bg-amber-300/[0.055] px-4 py-3">
          {accessMessage && (
            <p className="font-mono text-[10px] leading-4 text-amber-100/80">
              <span className="uppercase tracking-[0.15em] text-amber-300">
                Official KMA forecast unavailable
              </span>
              {" · "}
              {accessMessage}
            </p>
          )}
          {attemptMessage && (
            <p className="font-mono text-[10px] leading-4 text-amber-100/70">
              {attemptMessage}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <OutlookMetric
          label={isToday ? "Current AMOS" : "Last AMOS"}
          value={formatPredictionTemperature(
            toUnitTemperature(currentC, unit),
            unit,
          )}
          detail={
            latestAmos
              ? `${formatClock(latestAmos.obsTimeUtc)} · ${amosFreshness.label.toLowerCase()}`
              : "No representative observation"
          }
          tone="text-cyan-200"
        />
        <OutlookMetric
          label="Observed max"
          value={formatPredictionTemperature(
            toUnitTemperature(observedMax?.tempC, unit),
            unit,
          )}
          detail={
            observedMax
              ? `${formatClock(observedMax.obsTimeUtc)} · first occurrence`
              : "No representative observation"
          }
          tone="text-emerald-200"
        />
        <OutlookMetric
          label={expectedLabel}
          value={formatPredictionTemperature(
            toUnitTemperature(expectedHighC, unit),
            unit,
          )}
          detail={expectedDetail}
          tone="text-white"
        />
        <OutlookMetric
          label="KMA published high"
          value={kmaPublishedHigh}
          detail={
            hasKmaMaximum
              ? "Official RKSI daily maximum"
              : kma?.loading
                ? "Loading official KMA daily maximum"
                : kma?.approvalRequired
                  ? "Approval required; no secondary fallback"
                  : "No KMA daily maximum stored"
          }
          tone="text-violet-200"
        />
        <OutlookMetric
          label="KMA hourly peak"
          value={kmaHourlyPeak}
          detail={
            peakWindow
              ? `${peakWindow} · ${kmaPeak.tiedCount} tied hourly point${
                  kmaPeak.tiedCount === 1 ? "" : "s"
                }`
              : kma?.loading
                ? "Loading official KMA hourly curve"
                : "No KMA hourly temperature curve stored"
          }
          tone="text-rose-200"
        />
        <OutlookMetric
          label={isArchive ? "Last 60-minute trend" : "60-minute trend"}
          value={trendValue}
          detail={
            trendIsCurrent
              ? trendDescription(trendCPerHour)
              : `Unavailable while AMOS is ${amosFreshness.label.toLowerCase()}`
          }
          tone={
            Number.isFinite(displayedTrend) && displayedTrend >= 0.2
              ? "text-amber-200"
              : Number.isFinite(displayedTrend) && displayedTrend <= -0.2
                ? "text-sky-200"
                : "text-slate-200"
          }
        />
      </div>

      <p className="mt-2 font-mono text-[9px] leading-4 text-slate-600">
        {[
          amosFreshness.timing,
          vintage,
          hasKmaMaximum
            ? "expected max can never fall below the selected day’s observed AMOS maximum"
            : null,
          "Weather.com appears only as a labeled secondary comparison",
        ]
          .filter(Boolean)
          .join(" · ")}
        {" · "}
        <a
          className="text-violet-300/75 underline decoration-violet-300/30 underline-offset-2 transition hover:text-violet-200"
          href={kma?.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          Official KMA/AMO RKSI page
        </a>
      </p>
    </section>
  );
}

function weathercomRunningValue(running, unit) {
  const bias = temperatureForUnit(running, "biasC", "biasF", unit);
  if (!Number.isFinite(bias)) {
    return "awaiting matches";
  }
  const status = String(running?.status ?? "").toLowerCase();
  const state = status.includes("insufficient")
    ? "tentative"
    : status.includes("warm")
      ? "warm"
      : status.includes("cool")
        ? "cool"
        : status.includes("track")
          ? "on track"
          : "tentative";
  return `${formatTemperatureDelta(bias, unit)} · ${state}`;
}

function weathercomRunningDetail(running) {
  const sampleCount = Number.isFinite(running?.sampleCount)
    ? running.sampleCount
    : 0;
  const matchedCount = Number.isFinite(running?.matchedCount)
    ? Math.max(sampleCount, running.matchedCount)
    : sampleCount;
  const from = formatLocalTime(running?.fromAtLocal);
  const to = formatLocalTime(running?.toAtLocal);
  const window =
    from !== "—" && to !== "—"
      ? `${from}–${to} KST`
      : from !== "—" || to !== "—"
        ? `${from !== "—" ? from : to} KST`
        : null;
  const matches =
    matchedCount > sampleCount && sampleCount > 0
      ? `latest ${sampleCount} of ${matchedCount} matched hours`
      : `${sampleCount} matched hour${sampleCount === 1 ? "" : "s"}`;
  return window ? `${matches} · ${window}` : matches;
}

function weathercomDepartureStatusLabel(status) {
  const labels = {
    on_track: "On track",
    running_warm: "Running warm",
    running_cool: "Running cool",
  };
  return (
    labels[status] ??
    (status
      ? String(status).replaceAll("_", " ")
      : "Awaiting current comparison")
  );
}

function WeathercomHourlySummary({ diagnostics, unit, loading }) {
  if (loading) {
    return (
      <div className="mb-3 grid animate-pulse gap-px border border-blue-300/15 bg-white/10 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-[74px] bg-[#081321] px-4 py-3" />
        ))}
      </div>
    );
  }

  const points = Array.isArray(diagnostics?.points) ? diagnostics.points : [];
  const baselineDescriptor = weathercomBaselineDescriptor(diagnostics);
  const runningBaseline = diagnostics?.runningBaseline ?? null;
  const runningPreHour = diagnostics?.runningPreHour ?? null;
  const live =
    diagnostics?.live ?? diagnostics?.liveLatestCurveDeviation ?? null;
  const peak = diagnostics?.peak ?? null;
  const peakLatest = temperatureForUnit(
    peak,
    "latestTempC",
    "latestTempF",
    unit,
  );
  const peakDelta = temperatureForUnit(peak, "deltaC", "deltaF", unit);
  const peakCapture = formatWeathercomTime(
    peak?.latestCapturedAtLocal ?? peak?.latestCapturedAt,
  );
  const latestAttempt = formatWeathercomTime(
    diagnostics?.latestAttemptedAtLocal ?? diagnostics?.latestAttemptedAt,
  );
  const latestAttemptFailed = diagnostics?.latestAttemptStatus === "error";
  const isStale = Boolean(diagnostics?.isStale);
  const hasSummary =
    points.length > 0 ||
    Boolean(peak || live) ||
    (runningBaseline?.sampleCount ?? 0) > 0 ||
    (runningPreHour?.sampleCount ?? 0) > 0;

  if (!diagnostics || !hasSummary) {
    const status = String(diagnostics?.status ?? "")
      .replaceAll("_", " ")
      .trim();
    return (
      <div className="mb-3 border border-blue-300/15 bg-blue-300/[0.035] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-blue-300">
          Secondary Weather.com hourly history
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {diagnostics?.error
            ? diagnostics.error
            : status
              ? `Hourly comparison ${status}.`
              : "Awaiting stored hourly forecasts and matched AMOS observations."}
        </p>
      </div>
    );
  }

  const peakDetails = [
    Number.isFinite(peakDelta)
      ? `${formatTemperatureDelta(
          peakDelta,
          unit,
        )} vs ${baselineDescriptor.label}`
      : null,
    peakCapture ? `peak point captured ${peakCapture}` : null,
  ].filter(Boolean);
  const liveActual = temperatureForUnit(
    live,
    "actualTempC",
    "actualTempF",
    unit,
  );
  const liveForecast = temperatureForUnit(
    live,
    "forecastTempC",
    "forecastTempF",
    unit,
  );
  const liveDeparture = temperatureForUnit(
    live,
    "departureC",
    "departureF",
    unit,
  );
  const liveActualAt = formatWeathercomTime(
    live?.actualAtLocal ?? live?.actualAtUtc,
  );
  const liveForecastCapturedAt = formatWeathercomTime(
    live?.forecastCapturedAtLocal ?? live?.forecastCapturedAt,
  );

  return (
    <div
      aria-label="Secondary Weather.com hourly forecast comparison"
      className="mb-3 grid gap-px border border-blue-300/15 bg-white/10 md:grid-cols-3"
    >
      <div className="bg-blue-300/[0.035] px-4 py-2 md:col-span-3">
        <p className="font-mono text-[9px] uppercase leading-4 tracking-[0.15em] text-blue-200/70">
          Secondary comparison only · not used for the expected maximum, KMA
          curve, peak timing, or cloud guidance
        </p>
      </div>
      {(latestAttemptFailed || isStale) && (
        <div className="border-b border-amber-300/15 bg-amber-300/[0.055] px-4 py-2.5 md:col-span-3">
          <p className="font-mono text-[10px] leading-4 text-amber-100/80">
            <span className="uppercase tracking-[0.15em] text-amber-300">
              Secondary Weather.com hourly data is stale
            </span>
            {diagnostics?.latestAttemptError
              ? ` · ${diagnostics.latestAttemptError}`
              : Number.isFinite(diagnostics?.latestAttemptAgeMinutes)
                ? ` · latest collector attempt is ${diagnostics.latestAttemptAgeMinutes.toFixed(
                    0,
                  )} minutes old`
                : " · no recent successful curve"}
            {latestAttempt ? ` · latest attempt ${latestAttempt}` : ""}
            {" · showing the last successful stored values"}
          </p>
        </div>
      )}
      <div className="bg-[#081321] px-4 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.17em] text-blue-300">
          Secondary actuals vs {baselineDescriptor.label}
        </p>
        <p className="mt-1 text-sm font-medium text-slate-100">
          {weathercomRunningValue(runningBaseline, unit)}
        </p>
        <p className="mt-1 font-mono text-[10px] text-slate-400">
          {weathercomRunningDetail(runningBaseline)}
        </p>
      </div>
      <div className="bg-[#081321] px-4 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.17em] text-blue-300">
          Secondary actuals vs latest pre-hour
        </p>
        <p className="mt-1 text-sm font-medium text-slate-100">
          {weathercomRunningValue(runningPreHour, unit)}
        </p>
        <p className="mt-1 font-mono text-[10px] text-slate-400">
          {weathercomRunningDetail(runningPreHour)}
        </p>
      </div>
      <div className="bg-[#081321] px-4 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.17em] text-blue-300">
          Secondary Weather.com curve peak
        </p>
        <p className="mt-1 text-sm font-medium text-slate-100">
          {Number.isFinite(peakLatest)
            ? formatPredictionTemperature(peakLatest, unit)
            : "Awaiting curve"}
        </p>
        <p className="mt-1 font-mono text-[10px] text-slate-400">
          {peakDetails.length
            ? peakDetails.join(" · ")
            : `${points.length} stored forecast hour${
                points.length === 1 ? "" : "s"
              }`}
        </p>
      </div>
      {live && (
        <div className="bg-[#081321] px-4 py-2.5 md:col-span-3">
          <p className="font-mono text-[10px] leading-4 text-slate-400">
            <span className="uppercase tracking-[0.15em] text-cyan-300">
              Secondary live comparison
            </span>
            {" · "}
            <span className="text-slate-300">
              {weathercomDepartureStatusLabel(live.status)}
              {Number.isFinite(liveDeparture)
                ? ` ${formatTemperatureDelta(liveDeparture, unit)}`
                : ""}
            </span>
            {Number.isFinite(liveActual) && Number.isFinite(liveForecast)
              ? ` · actual ${formatPredictionTemperature(
                  liveActual,
                  unit,
                )} / forecast ${formatPredictionTemperature(
                  liveForecast,
                  unit,
                )}`
              : ""}
            {liveActualAt ? ` · ${liveActualAt}` : ""}
            {liveForecastCapturedAt
              ? ` · curve captured ${liveForecastCapturedAt}`
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function WeathercomHourlyDetails({ diagnostics, unit }) {
  const points = Array.isArray(diagnostics?.points) ? diagnostics.points : [];
  if (!points.length) {
    return null;
  }
  const baselineDescriptor = weathercomBaselineDescriptor(diagnostics);

  return (
    <details className="mt-3 border border-blue-300/15 bg-blue-300/[0.025]">
      <summary className="cursor-pointer px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-blue-200/75 transition hover:text-blue-100">
        View secondary Weather.com revisions and departures
      </summary>
      <div
        aria-label="Scrollable secondary Weather.com hourly revision details"
        className="overflow-x-auto border-t border-blue-300/10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-300/50"
        role="region"
        tabIndex={0}
      >
        <table className="w-full min-w-[1540px] border-collapse text-left">
          <caption className="sr-only">
            Secondary Weather.com hourly latest stored forecasts, morning
            baseline, revisions, pre-hour forecasts, matched AMOS readings, and
            departures
          </caption>
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
              <th className="px-3 py-2 font-normal">Valid hour</th>
              <th className="px-3 py-2 font-normal">
                {baselineDescriptor.label}
              </th>
              <th className="px-3 py-2 font-normal">Latest stored</th>
              <th className="px-3 py-2 font-normal">Previous distinct</th>
              <th className="px-3 py-2 font-normal">Last revision</th>
              <th className="px-3 py-2 font-normal">Latest pre-hour</th>
              <th className="px-3 py-2 font-normal">Actual AMOS</th>
              <th className="px-3 py-2 font-normal">Vs baseline</th>
              <th className="px-3 py-2 font-normal">Vs pre-hour</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => {
              const baseline = temperatureForUnit(
                point,
                "baselineTempC",
                "baselineTempF",
                unit,
              );
              const latest = temperatureForUnit(
                point,
                "latestTempC",
                "latestTempF",
                unit,
              );
              const previousDistinct = temperatureForUnit(
                point,
                "previousDistinctTempC",
                "previousDistinctTempF",
                unit,
              );
              const revision = temperatureForUnit(
                point,
                "revisionDeltaC",
                "revisionDeltaF",
                unit,
              );
              const preHour = temperatureForUnit(
                point,
                "preHourTempC",
                "preHourTempF",
                unit,
              );
              const actual = temperatureForUnit(
                point,
                "actualTempC",
                "actualTempF",
                unit,
              );
              const departureBaseline = temperatureForUnit(
                point,
                "departureBaselineC",
                "departureBaselineF",
                unit,
              );
              const departurePreHour = temperatureForUnit(
                point,
                "departurePreHourC",
                "departurePreHourF",
                unit,
              );
              const latestCapture = formatLocalTime(
                point.latestCapturedAtLocal ?? point.latestCapturedAt,
              );
              const revisionDetected = formatLocalTime(
                point.revisionDetectedAtLocal ?? point.revisionDetectedAt,
              );
              const preHourCapture = formatLocalTime(
                point.preHourCapturedAtLocal ?? point.preHourCapturedAt,
              );
              const actualAt = formatLocalTime(
                point.actualAtLocal ?? point.actualAtUtc,
              );

              return (
                <tr
                  key={`weathercom-hour-${point.forecastTimeUtc}`}
                  className="border-t border-white/[0.06] align-top text-xs text-slate-300"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-blue-200">
                    {formatLocalTime(point.forecastTimeLocal)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatPredictionTemperature(baseline, unit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="text-slate-100">
                      {formatPredictionTemperature(latest, unit)}
                    </span>
                    {latestCapture !== "—" && (
                      <span className="ml-1 font-mono text-[10px] text-slate-400">
                        at {latestCapture}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatPredictionTemperature(previousDistinct, unit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {Number.isFinite(revision) ? (
                      <>
                        <span
                          className={
                            revision > 0
                              ? "text-amber-300"
                              : revision < 0
                                ? "text-sky-300"
                                : "text-slate-400"
                          }
                        >
                          {formatTemperatureDelta(revision, unit)}
                        </span>
                        {revisionDetected !== "—" && (
                          <span className="ml-1 font-mono text-[10px] text-slate-400">
                            first detected {revisionDetected}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatPredictionTemperature(preHour, unit)}
                    {preHourCapture !== "—" && (
                      <span className="ml-1 font-mono text-[10px] text-slate-400">
                        at {preHourCapture}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatPredictionTemperature(actual, unit)}
                    {actualAt !== "—" && (
                      <span className="ml-1 font-mono text-[10px] text-slate-400">
                        at {actualAt}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatTemperatureDelta(departureBaseline, unit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatTemperatureDelta(departurePreHour, unit)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
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
  const [solarRefreshState, setSolarRefreshState] = useState({
    active: false,
    message: "",
    requestedAt: null,
  });
  const [kmaCollectionState, setKmaCollectionState] = useState({
    active: false,
    message: "",
    requestedAt: null,
    retryAt: null,
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
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const solarDashboard = useQuery(
    "seoulGk2a:getSolarHeatingDashboard",
    isDateValid ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const pollMetar = useAction("seoul:pollLatestNoaaStationMetar");
  const pollOneMinuteAmos = useAction("seoul:pollLatestAmosTemperatureSites");
  const requestSolarHeatingRefresh = useMutation(
    "seoulGk2aCollector:requestSolarHeatingRefresh",
  );
  const requestKmaForecastRefresh = useMutation(
    "seoulKmaForecast:requestAirportForecastRefresh",
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
  const metarFreshness = useMemo(
    () => telemetryFreshness(latestMetar, clockNowMs, isToday, "metar"),
    [clockNowMs, isToday, latestMetar],
  );
  const amosFreshness = useMemo(
    () => telemetryFreshness(latestAmos, clockNowMs, isToday, "amos"),
    [clockNowMs, isToday, latestAmos],
  );
  const observedMax = useMemo(
    () => selectObservedMaximum(amosDisplayRows),
    [amosDisplayRows],
  );
  const trend60mCPerHour = useMemo(
    () => robustTemperatureTrendCPerHour(amosDisplayRows, 60),
    [amosDisplayRows],
  );
  const metarSkyRuns = useMemo(
    () => buildMetarSkyRuns(metarRows, currentSeoulMinute),
    [currentSeoulMinute, metarRows],
  );
  const providerFreshnessNow = Number.isFinite(clockNowMs)
    ? Math.floor(clockNowMs / MINUTE_MS) * MINUTE_MS
    : null;
  const kma = useMemo(
    () =>
      normalizeKmaDashboard(
        predictionDashboard,
        date,
        date >= today ? providerFreshnessNow : null,
      ),
    [date, predictionDashboard, providerFreshnessNow, today],
  );
  const kmaPrimaryHourlyRows = useMemo(
    () => (kma.available ? kma.hourlyRows : []),
    [kma.available, kma.hourlyRows],
  );
  const kmaPeak = useMemo(
    () => (kma.available ? kmaHourlyPeak(kma.hourlyRows) : null),
    [kma.available, kma.hourlyRows],
  );
  const expectedHighC =
    kma.available && Number.isFinite(kma.dailyHighC)
      ? Math.max(kma.dailyHighC, observedMax?.tempC ?? Number.NEGATIVE_INFINITY)
      : (observedMax?.tempC ?? null);
  const observedMaxMarker = useMemo(() => {
    const minute = parseMinute(observedMax?.obsTimeLocal);
    const temperature = toUnitTemperature(observedMax?.tempC, unit);
    if (!Number.isFinite(minute) || !Number.isFinite(temperature)) {
      return null;
    }
    return {
      minute,
      temperature,
      obsTimeUtc: observedMax.obsTimeUtc,
      obsTimeLocal: observedMax.obsTimeLocal,
    };
  }, [observedMax, unit]);
  const weathercomHourlyDiagnostics =
    predictionDashboard?.weathercomHourlyDiagnostics ?? null;
  const weathercomHourlyPointCount = Array.isArray(
    weathercomHourlyDiagnostics?.points,
  )
    ? weathercomHourlyDiagnostics.points.length
    : 0;
  const preferredProviderPeak = useMemo(
    () => selectKmaProviderPeak(kma, unit),
    [kma, unit],
  );
  const forecastCloudRows = useMemo(
    () =>
      buildKmaForecastCloudRows({
        kma,
        date,
        nowMs: date >= today ? providerFreshnessNow : null,
      }),
    [date, kma, providerFreshnessNow, today],
  );
  const hourlyCloudCover = useMemo(
    () =>
      buildHourlyCloudCover({
        date,
        today,
        currentMinute: currentSeoulMinute,
        metarSkyRuns,
        forecastRows: forecastCloudRows,
        comparisonRows: weathercomHourlyDiagnostics?.points,
      }),
    [
      currentSeoulMinute,
      date,
      forecastCloudRows,
      metarSkyRuns,
      today,
      weathercomHourlyDiagnostics?.points,
    ],
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
  const latestComparedCloudHour = useMemo(
    () =>
      hourlyCloudCover
        .filter(
          (hour) =>
            hour.phase === "observed" && Number.isFinite(hour.forecastDeltaPct),
        )
        .at(-1) ?? null,
    [hourlyCloudCover],
  );
  const nextForecastCloudHour = useMemo(() => {
    return (
      hourlyCloudCover.find(
        (hour) =>
          hour.phase === "forecast" &&
          hour.forecastProvider === "kma" &&
          Boolean(hour.conditionLabel || hour.ceilingLabel),
      ) ?? null
    );
  }, [hourlyCloudCover]);
  const forecastCloudVintage = nextForecastCloudHour;
  const sunsetMinute = useMemo(() => sunsetMinuteForDate(date), [date]);
  const showHistoricalPeakReference = usesSpringSummerPeakReference(date);
  const hasTemperatureChartData =
    metarRows.length +
      amosDisplayRows.length +
      kmaPrimaryHourlyRows.length +
      (preferredProviderPeak ? 1 : 0) +
      weathercomHourlyPointCount >
    0;
  const hasCloudGuidance = hourlyCloudCover.some(
    (hour) =>
      Number.isFinite(hour.coverPct) ||
      Boolean(hour.conditionLabel || hour.ceilingLabel),
  );

  const chartData = useMemo(
    () =>
      buildChartData(
        metarRows,
        amosDisplayRows,
        observedMaxMarker,
        preferredProviderPeak,
        kmaPrimaryHourlyRows,
        weathercomHourlyDiagnostics,
        unit,
      ),
    [
      amosDisplayRows,
      metarRows,
      observedMaxMarker,
      preferredProviderPeak,
      kmaPrimaryHourlyRows,
      unit,
      weathercomHourlyDiagnostics,
    ],
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
        padding: { top: 82, right: 8, bottom: 2, left: 2 },
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
            filter(legendItem, chartData) {
              return !chartData.datasets[legendItem.datasetIndex]
                ?.hideFromLegend;
            },
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
                ? ` · ${formatCloudCoverPercentage(
                    item.raw.cloudCoverPct,
                  )}% secondary Weather.com cloud cover`
                : "";
              const kmaCondition = item.raw?.forecastCondition
                ? ` · ${item.raw.forecastCondition}`
                : "";
              const kmaCeiling = item.raw?.forecastCeilingLabel
                ? ` · ${item.raw.forecastCeilingLabel}`
                : "";
              return `${item.dataset.label}: ${item.parsed.y.toFixed(
                1,
              )}°${unit}${reportType}${auditFallback}${skyCondition}${kmaCondition}${kmaCeiling}${forecastCloudCover}`;
            },
            afterLabel(item) {
              return weathercomTooltipDetails(item.raw, unit);
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
            display: showHistoricalPeakReference,
            medianMinute: HISTORICAL_PEAK_REFERENCE.medianMinute,
            windowStartMinute: HISTORICAL_PEAK_REFERENCE.windowStartMinute,
            windowEndMinute: HISTORICAL_PEAK_REFERENCE.windowEndMinute,
            title: "MAR–JUL ARCHIVE",
            label: minuteLabel(HISTORICAL_PEAK_REFERENCE.medianMinute),
          },
        },
        seoulObservedMax: {
          display: Boolean(observedMaxMarker),
          minute: observedMaxMarker?.minute,
          temperature: observedMaxMarker?.temperature,
          label: observedMaxMarker
            ? `OBSERVED AMOS MAX · ${observedMaxMarker.temperature.toFixed(
                1,
              )}°${unit} · ${minuteLabel(observedMaxMarker.minute)} KST`
            : "",
        },
        seoulHourlyCloudCover: {
          display: hourlyCloudSegments.length > 0,
          hours: hourlyCloudSegments,
        },
        seoulWeathercomRevisionBadges: {
          display: weathercomHourlyPointCount > 0,
          thresholdC: WEATHERCOM_REVISION_THRESHOLD_C,
          maximumLabels: WEATHERCOM_REVISION_MAXIMUM_LABELS,
          unit,
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
      hasTemperatureChartData,
      hourlyCloudSegments,
      isToday,
      observedMaxMarker,
      preferredProviderPeak,
      showHistoricalPeakReference,
      sunsetMinute,
      unit,
      weathercomHourlyPointCount,
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

      const message = sourceFailures.length
        ? `${2 - sourceFailures.length}/2 live sources refreshed`
        : "Live sources refreshed";
      setRefreshState({ active: false, message });
    } finally {
      refreshInFlight.current = false;
    }
  }

  async function refreshSolarHeating() {
    if (!isToday || solarRefreshState.active) {
      return;
    }
    if (
      !Number.isFinite(currentSeoulMinute) ||
      currentSeoulMinute < 11 * 60 ||
      currentSeoulMinute >= 16 * 60
    ) {
      setSolarRefreshState({
        active: false,
        message: "GK2A downloads are limited to 11:00–16:00 KST.",
        requestedAt: null,
      });
      return;
    }
    setSolarRefreshState({
      active: true,
      message: "Queueing the latest GK2A SWRAD frame…",
      requestedAt: null,
    });
    try {
      const result = await requestSolarHeatingRefresh({
        stationIcao: STATION_ICAO,
      });
      const message =
        result?.status === "access_not_approved"
          ? "NMSC access approval is required before GK2A collection can be enabled."
          : result?.status === "already_running"
            ? "A GK2A download is already running."
            : result?.status === "cooldown"
              ? `GK2A refresh is cooling down; retry in about ${Math.max(
                  1,
                  Math.ceil((result.retryAfterSeconds ?? 60) / 60),
                )} minute(s).`
              : result?.status === "outside_collection_window"
                ? "GK2A downloads are limited to 11:00–16:00 KST."
                : "GK2A download queued; the panel will update when extraction finishes.";
      setSolarRefreshState({
        active: false,
        message,
        requestedAt:
          result?.status === "queued" && Number.isFinite(result?.requestedAt)
            ? result.requestedAt
            : null,
      });
    } catch (error) {
      console.error(error);
      setSolarRefreshState({
        active: false,
        message: "Could not queue the GK2A download. Try again shortly.",
        requestedAt: null,
      });
    }
  }

  async function collectKmaForecast() {
    if (
      !isDateValid ||
      date < today ||
      kmaCollectionState.active
    ) {
      return;
    }
    setKmaCollectionState({
      active: true,
      message: "Queueing the latest official KMA/AMO RKSI forecast…",
      requestedAt: null,
      retryAt: null,
    });
    try {
      const result = await requestKmaForecastRefresh({
        stationIcao: STATION_ICAO,
      });
      if (result?.status === "approval_required") {
        setKmaCollectionState({
          active: false,
          message:
            "KMA/AMO access approval is required before manual collection can run.",
          requestedAt: null,
          retryAt: null,
        });
        return;
      }
      if (result?.status === "already_running") {
        const queuedAt = finiteNumber(result?.collectionQueuedAt);
        setKmaCollectionState({
          active: Number.isFinite(queuedAt),
          message: Number.isFinite(queuedAt)
            ? "A KMA forecast collection is already running…"
            : "A KMA forecast collection is already running.",
          requestedAt: queuedAt,
          retryAt: null,
        });
        return;
      }
      if (result?.status === "cooldown") {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil(result?.retryAfterSeconds ?? 60),
        );
        setKmaCollectionState({
          active: false,
          message: `KMA collection is cooling down; retry in about ${Math.max(
            1,
            Math.ceil(retryAfterSeconds / 60),
          )} minute(s).`,
          requestedAt: null,
          retryAt: Date.now() + retryAfterSeconds * 1_000,
        });
        return;
      }
      if (
        result?.status === "queued" &&
        Number.isFinite(result?.requestedAt)
      ) {
        setKmaCollectionState({
          active: true,
          message:
            "KMA forecast collection queued; waiting for the official page…",
          requestedAt: result.requestedAt,
          retryAt:
            result.requestedAt +
            Math.max(1, result?.cooldownSeconds ?? 10 * 60) * 1_000,
        });
        return;
      }
      setKmaCollectionState({
        active: false,
        message: "KMA collection was not queued. Try again shortly.",
        requestedAt: null,
        retryAt: null,
      });
    } catch (error) {
      console.error(error);
      setKmaCollectionState({
        active: false,
        message: "Could not queue KMA collection. Try again shortly.",
        requestedAt: null,
        retryAt: null,
      });
    }
  }

  useEffect(() => {
    const requestedAt = solarRefreshState.requestedAt;
    const collector = solarDashboard?.collector;
    if (
      !Number.isFinite(requestedAt) ||
      !Number.isFinite(collector?.collectionQueuedAt) ||
      collector.collectionQueuedAt < requestedAt
    ) {
      return;
    }
    const lockAgeMs = Number.isFinite(collector.collectionInFlightSince)
      ? clockNowMs - collector.collectionInFlightSince
      : null;
    if (Number.isFinite(lockAgeMs) && lockAgeMs < 15 * 60_000) {
      return;
    }
    const message = Number.isFinite(lockAgeMs)
      ? "The GK2A download timed out; Refresh GK2A is available again."
      : collector.status === "error"
        ? `GK2A collection failed. ${solarDashboard?.statusMessage ?? ""}`.trim()
        : collector.status === "partial"
          ? "GK2A collection finished with partial grid data."
          : collector.status === "no_data"
            ? "GK2A collection finished without a usable daylight sample."
            : "GK2A collection finished; the panel is up to date.";
    setSolarRefreshState((current) =>
      current.requestedAt === requestedAt
        ? { active: false, message, requestedAt: null }
        : current,
    );
  }, [
    clockNowMs,
    solarDashboard?.collector?.collectionInFlightSince,
    solarDashboard?.collector?.collectionQueuedAt,
    solarDashboard?.collector?.status,
    solarDashboard?.statusMessage,
    solarRefreshState.requestedAt,
  ]);

  useEffect(() => {
    const requestedAt = kmaCollectionState.requestedAt;
    const collector = kma?.collector;
    if (Number.isFinite(requestedAt) && kma?.approvalRequired) {
      setKmaCollectionState({
        active: false,
        message:
          "KMA approval was removed before collection completed; no forecast is exposed.",
        requestedAt: null,
        retryAt: null,
      });
      return;
    }
    if (
      !Number.isFinite(requestedAt) ||
      !Number.isFinite(collector?.collectionQueuedAt) ||
      collector.collectionQueuedAt < requestedAt
    ) {
      return;
    }
    const inFlightSince = finiteNumber(collector?.collectionInFlightSince);
    const lockTimeoutMs =
      (finiteNumber(kma?.collectionLockTimeoutSeconds) ?? 15 * 60) * 1_000;
    if (Number.isFinite(inFlightSince)) {
      if (!Number.isFinite(clockNowMs)) {
        return;
      }
      if (clockNowMs - inFlightSince < lockTimeoutMs) {
        return;
      }
    }
    const message =
      Number.isFinite(inFlightSince) && Number.isFinite(clockNowMs)
        ? "KMA collection timed out; manual collection is available again."
        : collector?.status === "approval_required"
          ? "KMA approval was removed before collection completed; no forecast was stored."
          : collector?.status === "error"
            ? `KMA collection failed. ${collector?.lastError ?? ""}`.trim()
            : collector?.status === "ok"
              ? `KMA forecast collected · ${collector?.dailyRowCount ?? 0} daily / ${
                  collector?.hourlyRowCount ?? 0
                } hourly rows.`
              : "KMA collection finished; the dashboard will use the latest stored capture.";
    setKmaCollectionState((current) =>
      current.requestedAt === requestedAt
        ? {
            active: false,
            message,
            requestedAt: null,
            retryAt: current.retryAt,
          }
        : current,
    );
  }, [
    clockNowMs,
    kma?.collectionLockTimeoutSeconds,
    kma?.approvalRequired,
    kma?.collector?.collectionInFlightSince,
    kma?.collector?.collectionQueuedAt,
    kma?.collector?.dailyRowCount,
    kma?.collector?.hourlyRowCount,
    kma?.collector?.lastError,
    kma?.collector?.status,
    kmaCollectionState.requestedAt,
  ]);

  useEffect(() => {
    if (
      kmaCollectionState.active ||
      !Number.isFinite(kmaCollectionState.retryAt) ||
      !Number.isFinite(clockNowMs) ||
      clockNowMs < kmaCollectionState.retryAt ||
      !kmaCollectionState.message.startsWith(
        "KMA collection is cooling down",
      )
    ) {
      return;
    }
    setKmaCollectionState((current) =>
      current.message.startsWith("KMA collection is cooling down")
        ? {
            ...current,
            message: "",
            retryAt: null,
          }
        : current,
    );
  }, [
    clockNowMs,
    kmaCollectionState.active,
    kmaCollectionState.message,
    kmaCollectionState.retryAt,
  ]);

  useEffect(() => {
    if (!isToday) {
      setRefreshState({
        active: false,
        message: isDateValid ? "Historical capture" : "",
      });
      setSolarRefreshState({
        active: false,
        message: "",
        requestedAt: null,
      });
      setKmaCollectionState({
        active: false,
        message: "",
        requestedAt: null,
        retryAt: null,
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
              RKSI representative weather timeline
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              One-minute representative AMOS temperature using the feed&apos;s
              15L designation, official coded RKSI METAR, hourly cloud guidance,
              and GK2A shortwave radiation across the full Seoul day.
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

        <section className="grid grid-cols-1 gap-y-5 py-5 md:grid-cols-3">
          <SourceCard
            accent="#f8fafc"
            label="Official coded METAR · audit"
            value={formatTemperature(latestMetar, unit)}
            unit={unit}
            detail={
              latestMetar
                ? `${latestMetar.reportType} · ${formatClock(
                    latestMetar.obsTimeUtc,
                  )}`
                : "awaiting report"
            }
            timing={metarFreshness.timing}
            freshness={metarFreshness}
            count={metarRows.length}
          />
          <SourceCard
            accent="#22d3ee"
            label="Representative AMOS · 1 min"
            value={formatTemperature(latestAmos, unit)}
            unit={unit}
            detail={
              latestAmos
                ? `15L designation · ${formatClock(latestAmos.obsTimeUtc)}${
                    latestAmos.displayCadence === "audit_fallback"
                      ? " · audit fallback"
                      : ""
                  }`
                : "awaiting capture"
            }
            timing={amosFreshness.timing}
            freshness={amosFreshness}
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

        <MaxOutlookPanel
          date={date}
          today={today}
          clockNowMs={clockNowMs}
          unit={unit}
          latestAmos={latestAmos}
          amosFreshness={amosFreshness}
          observedMax={observedMax}
          kma={kma}
          kmaPeak={kmaPeak}
          expectedHighC={expectedHighC}
          trendCPerHour={trend60mCPerHour}
          onCollect={collectKmaForecast}
          collectionState={kmaCollectionState}
        />

        <SolarHeatingPanel
          solar={solarDashboard}
          queryLoading={solarDashboard === undefined}
          latestAmos={latestAmos}
          isToday={isToday}
          collectionWindowOpen={
            isToday &&
            Number.isFinite(currentSeoulMinute) &&
            currentSeoulMinute >= 11 * 60 &&
            currentSeoulMinute < 16 * 60
          }
          clockNowMs={clockNowMs}
          onRefresh={refreshSolarHeating}
          refreshState={solarRefreshState}
        />

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
                  Hourly airport conditions ·{" "}
                  {date < today ? (
                    <span className="text-slate-200">
                      ■ completed hours: observed
                    </span>
                  ) : date > today ? (
                    <span className="text-violet-300">
                      ▧ KMA condition + ceiling
                    </span>
                  ) : (
                    <>
                      <span className="text-slate-200">■ past: observed</span> ·{" "}
                      <span className="text-amber-300">▌ now: live</span> ·{" "}
                      <span className="text-violet-300">
                        ▧ coming: KMA condition + ceiling
                      </span>
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
                {latestComparedCloudHour && (
                  <p className="text-violet-300/80">
                    Secondary Weather.com cloud check ·{" "}
                    {cloudHourWindowLabel(latestComparedCloudHour.hour)} ·
                    secondary forecast − observed{" "}
                    {latestComparedCloudHour.forecastDeltaLabel} ·{" "}
                    {cloudForecastDeltaMeaning(
                      latestComparedCloudHour.forecastDeltaPct,
                    ).toLowerCase()}
                  </p>
                )}
                {latestComparedCloudHour && (
                  <p className="text-slate-500">
                    Secondary Δ = pre-hour Weather.com percentage − observed
                    METAR sample · + cloudier · − clearer
                  </p>
                )}
                <p className="text-violet-300/80">
                  {date < today
                    ? "Completed day · observed METAR hourly summary"
                    : `${
                        date > today ? "KMA forecast day" : "Coming KMA hours"
                      } · ${
                        nextForecastCloudHour
                          ? `${cloudHourWindowLabel(
                              nextForecastCloudHour.hour,
                            )} · ${nextForecastCloudHour.summaryLabel}`
                          : "no stored KMA condition remains on this date"
                      }`}
                </p>
                {(kma.approvalRequired || kma.setupRequired) &&
                  date >= today && (
                    <p className="text-amber-300/80">
                      KMA forecast unavailable ·{" "}
                      {kma.approvalRequired
                        ? "server-side approval required"
                        : "server-side setup required"}{" "}
                      · no Weather.com fallback
                    </p>
                  )}
                {forecastCloudVintage && date >= today && (
                  <p
                    className={
                      forecastCloudVintage.isStale
                        ? "text-amber-300/80"
                        : "text-slate-500"
                    }
                  >
                    KMA condition forecast captured ·{" "}
                    {formatLocalTime(
                      forecastCloudVintage.capturedAtLocal ??
                        forecastCloudVintage.capturedAt,
                    )}{" "}
                    KST
                    {Number.isFinite(forecastCloudVintage.captureAgeMinutes)
                      ? ` · ${Math.round(
                          forecastCloudVintage.captureAgeMinutes,
                        )}m old`
                      : ""}
                    {forecastCloudVintage.isStale
                      ? " · stale, retained as last successful guidance"
                      : ""}
                  </p>
                )}
              </div>
            </div>
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.16em]">
              {showHistoricalPeakReference && (
                <p
                  className="mt-1 text-violet-300"
                  title={`Median first occurrence of the daily representative AMOS maximum across ${HISTORICAL_PEAK_REFERENCE.sampleSize} complete March–July days (${HISTORICAL_PEAK_REFERENCE.firstDate}–${HISTORICAL_PEAK_REFERENCE.lastDate}).`}
                >
                  Mar–Jul archive median ·{" "}
                  {minuteLabel(HISTORICAL_PEAK_REFERENCE.medianMinute)} KST
                </p>
              )}
              <p className="mt-1 text-orange-300">
                Sunset · {minuteLabel(sunsetMinute)} KST
              </p>
              <p className="mt-1 text-slate-500">
                {dayData === undefined
                  ? "Loading telemetry…"
                  : refreshState.message ||
                    `${metarRows.length + amosDisplayRows.length} observations`}
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

          <WeathercomHourlySummary
            diagnostics={weathercomHourlyDiagnostics}
            unit={unit}
            loading={predictionDashboard === undefined}
          />

          <div id="seoul-hourly-cloud-description" className="sr-only">
            <p>
              The hourly conditions strip shows past coded METAR observations
              and upcoming KMA/AMO airport forecast phrases. Past percentages
              are approximate ranges derived only from explicit METAR
              cloud-amount reports. Upcoming KMA cells preserve the exact
              categorical condition phrase and published ceiling; the interface
              does not convert either into a cloud-cover percentage. Amber KMA
              cells are stale values retained from the last successful capture.
              Hatched cells mean the value is unavailable, not clear sky. The
              current hour ends at the NOW line; its remaining time stays
              hatched until observed. A completed-hour percentage delta, when
              present, is a labeled secondary Weather.com comparison captured
              before the hour minus the observed METAR-sample estimate. It never
              drives upcoming cloud guidance, and the live partial hour is not
              scored.
            </p>
            {preferredProviderPeak && (
              <p>
                A rose circle marks the official KMA/AMO RKSI published daily
                high from the latest stored airport forecast:{" "}
                {preferredProviderPeak.temperature.toFixed(1)} degrees{" "}
                {unit === "C" ? "Celsius" : "Fahrenheit"}. Its horizontal
                position is the first tied maximum among the KMA hourly values
                returned for that date, beginning at{" "}
                {minuteLabel(preferredProviderPeak.minute)} Korea Standard Time.
                It is separate from the expected maximum in the outlook, which
                is floored at the observed AMOS maximum.
              </p>
            )}
            {observedMaxMarker && (
              <p>
                A green diamond and horizontal dashed line mark the first
                occurrence of the observed representative AMOS maximum:{" "}
                {observedMaxMarker.temperature.toFixed(1)} degrees{" "}
                {unit === "C" ? "Celsius" : "Fahrenheit"} at{" "}
                {minuteLabel(observedMaxMarker.minute)} Korea Standard Time.
              </p>
            )}
          </div>

          <div id="seoul-weathercom-hourly-description" className="sr-only">
            Weather.com hourly history is secondary comparison data only. It is
            drawn as a thin blue latest-stored curve and a faint dotted
            morning-baseline curve. It is not used for the expected maximum,
            official forecast curve, peak timing, or upcoming condition and
            ceiling guidance. Revision badges mark every change of at least one
            degree Celsius from the previous distinct stored value. Their
            timestamps show when this system first detected a change, not when
            Weather.com published it.
          </div>

          <div
            ref={chartScrollRef}
            aria-label="Scrollable 24-hour temperature and KMA airport condition chart"
            aria-describedby="seoul-hourly-cloud-description seoul-weathercom-hourly-description"
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
                      ? "No temperature observations are available for this date; hourly cloud guidance is shown above."
                      : "This Seoul local date has no stored RKSI observations."}
                  </p>
                </div>
              </div>
            )}
          </div>

          <WeathercomHourlyDetails
            diagnostics={weathercomHourlyDiagnostics}
            unit={unit}
          />

          <details className="mt-3 border border-white/10 bg-white/[0.02]">
            <summary className="cursor-pointer px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400 transition hover:text-slate-200">
              View all 24 hourly condition details
            </summary>
            <div className="overflow-x-auto border-t border-white/10">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <caption className="sr-only">
                  Hour-by-hour observed RKSI sky conditions and primary KMA
                  forecast condition phrases and ceilings, with optional
                  secondary Weather.com percentage comparisons for completed
                  observed hours
                </caption>
                <thead>
                  <tr className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
                    <th className="px-4 py-2 font-normal">Hour</th>
                    <th className="px-4 py-2 font-normal">Source</th>
                    <th className="px-4 py-2 font-normal">
                      Condition / ceiling
                    </th>
                    <th className="px-4 py-2 font-normal">
                      Secondary Weather.com − observed
                    </th>
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
                          ? hour.isStale
                            ? "KMA forecast · stale"
                            : "KMA forecast"
                          : hour.phase === "live"
                            ? "Live observation"
                            : "Observed"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-100">
                        {hour.valueLabel}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {Number.isFinite(hour.forecastDeltaPct) ? (
                          <div>
                            <span
                              className={`font-mono text-xs font-semibold ${
                                hour.forecastDeltaPct > 0
                                  ? "text-violet-300"
                                  : hour.forecastDeltaPct < 0
                                    ? "text-cyan-300"
                                    : "text-slate-300"
                              }`}
                            >
                              {hour.forecastDeltaLabel}
                            </span>
                            <div className="mt-0.5 font-mono text-[9px] text-slate-500">
                              {formatCloudCoverPercentage(
                                hour.forecastCoverPct,
                              )}
                              % Weather.com secondary ·{" "}
                              {formatLocalTime(
                                hour.forecastCapturedAtLocal ??
                                  hour.forecastCapturedAt,
                              )}{" "}
                              KST
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              {cloudForecastDeltaMeaning(hour.forecastDeltaPct)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
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
            AMOS uses RKSI&apos;s representative feed row designated 15L; that
            designation does not claim a thermometer at the runway threshold.
            Five-minute snapshots remain available only as an audit fallback for
            missed minute captures. Past sky cover comes from coded METAR
            ranges; coming hours preserve KMA/AMO&apos;s categorical condition
            phrase and ceiling without inventing a percentage. Weather.com is a
            labeled secondary comparison only.
          </p>
          <p>
            NOAA TGFTP METAR · KMA AMOS MOBILE FEED · KMA/AMO RKSI AIRPORT
            FORECAST · SECONDARY WEATHER.COM COMPARISON
          </p>
        </footer>
      </div>
    </main>
  );
}
