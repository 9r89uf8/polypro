"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveConvexSiteOrigin } from "../convex-site";
import styles from "./edge.module.css";
import {
  ROUTINE_TRANSMISSION_DEADLINE_MINUTE,
  ROUTINE_WINDOW_OPEN_MINUTE,
  TEMPERATURE_SPECIAL_THRESHOLD_C,
  buildRelayLagModel,
  buildOfficialReportCycles,
  buildRoutineReportCycles,
  classifyTdzPoint,
  deriveReportCycleState,
} from "./report-cycle.mjs";
import {
  REACTION_SIGNAL_OPTIONS,
  buildReactionIntervals,
  dedupeWeatherSourceEvents,
  firstNewDailyMaximumEvents,
  officialDailyMaximumEvidenceComplete,
  platformDisplayTransitions,
  reactionChartSeries,
  reactionRowMatchesContract,
  selectReactionSignal,
  tdzDailySeriesStates,
} from "./reaction-metrics.mjs";
import {
  FORECAST_SOURCE_SMN,
  FORECAST_SOURCE_TAF,
  nextAutomaticForecastCheck,
  nextDayTafAvailabilityWindow,
} from "./forecast-timing.mjs";

const STATION_ICAO = "MMMX";
const MEXICO_TIMEZONE = "America/Mexico_City";
const MARKET_STALE_AFTER_MS = 90 * 1000;
const FORECAST_COLLECTOR_LEASE_MS = {
  awc_taf: 60 * 1000,
  smn_municipal_hourly: 30 * 60 * 1000,
};
const AWC_MMMX_TAF_URL =
  "https://aviationweather.gov/api/data/taf?ids=MMMX&format=raw";
const SMN_MUNICIPAL_FORECAST_URL =
  "https://smn.conagua.gob.mx/es/pronosticos/pronostico-del-tiempo-por-municipios";
const POLYMARKET_MARKET_WEBSOCKET_URL =
  "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const REACTION_WINDOWS = [
  { key: "1h", label: "1h", durationMs: 60 * 60 * 1000 },
  { key: "3h", label: "3h", durationMs: 3 * 60 * 60 * 1000 },
  { key: "6h", label: "6h", durationMs: 6 * 60 * 60 * 1000 },
  { key: "all", label: "Day", durationMs: null },
];
const TEMPERATURE_SERIES_STYLES = {
  metar_speci: { label: "METAR / SPECI", color: "#50e3ff" },
  capma_tdz_05: { label: "CAPMA TDZ 05", color: "#b8ff56" },
  capma_tdz_23: { label: "CAPMA TDZ 23", color: "#a78bfa" },
};
const REPORT_CYCLE_ZOOM_LEVELS = [
  { value: 1, label: "1×", detail: "six-hour overview" },
  { value: 2, label: "2×", detail: "three-hour viewport" },
  { value: 4, label: "4×", detail: "close inspection" },
];
const FALLBACK_TEMPERATURE_COLORS = ["#72a7ff", "#ff8ec7", "#72e6b1"];

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function firstPresent(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function latestFinite(...values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

function getDateParts(epochMs, timeZone = MEXICO_TIMEZONE) {
  if (!Number.isFinite(epochMs)) {
    return null;
  }
  const values = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function mexicoDateKey(epochMs) {
  const parts = getDateParts(epochMs);
  return parts ? [parts.year, parts.month, parts.day].join("-") : "";
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function shiftDateKey(date, days) {
  if (!validDateKey(date)) {
    return "";
  }
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12))
    .toISOString()
    .slice(0, 10);
}

function mexicoMidnightUtc(date) {
  if (!validDateKey(date)) {
    return null;
  }
  const [year, month, day] = date.split("-").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let candidate = Date.UTC(year, month - 1, day, 6);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = getDateParts(candidate);
    if (!parts) {
      return null;
    }
    const representedLocalAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate += targetAsUtc - representedLocalAsUtc;
  }
  return candidate;
}

function mexicoDayBounds(date) {
  const startAt = mexicoMidnightUtc(date);
  const nextDate = shiftDateKey(date, 1);
  const endAt = mexicoMidnightUtc(nextDate);
  return Number.isFinite(startAt) && Number.isFinite(endAt)
    ? { startAt, endAt }
    : null;
}

function normalizeObservationClock(clock, nowMs) {
  const routine = clock?.routine || clock;
  if (!routine || routine.available === false) {
    return {
      available: false,
      startAt: null,
      centerAt: null,
      endAt: null,
      state: routine?.state || "waiting",
      basis: routine?.kind || "learned history",
      sampleCount: routine?.sampleCount ?? 0,
      minimumSampleCount: routine?.minimumSampleCount ?? null,
      confidence: routine?.confidence || "insufficient",
      pollResolutionSeconds: routine?.pollResolutionSeconds ?? null,
      note: routine?.reason || "awaiting_collector_history",
    };
  }
  const startAt = firstFinite(
    routine?.windowStartAt,
    routine?.windowStartUtc,
    routine?.routineWindowStartAt,
    routine?.routineWindowStartUtc,
    routine?.nextWindowStartAt,
    routine?.nextWindowStartUtc,
  );
  const endAt = firstFinite(
    routine?.windowEndAt,
    routine?.windowEndUtc,
    routine?.routineWindowEndAt,
    routine?.routineWindowEndUtc,
    routine?.nextWindowEndAt,
    routine?.nextWindowEndUtc,
  );
  const centerAt = firstFinite(
    routine?.windowCenterAt,
    routine?.windowCenterUtc,
    routine?.routineWindowCenterAt,
    routine?.routineWindowCenterUtc,
    routine?.nextWindowCenterAt,
    routine?.nextWindowCenterUtc,
  );
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    return {
      available: false,
      startAt: null,
      centerAt: null,
      endAt: null,
      state: routine?.state || "waiting",
      basis: routine?.kind || "learned history",
      sampleCount: routine?.sampleCount ?? 0,
      minimumSampleCount: routine?.minimumSampleCount ?? null,
      confidence: routine?.confidence || "insufficient",
      pollResolutionSeconds: routine?.pollResolutionSeconds ?? null,
      note: routine?.reason || "window_unavailable",
    };
  }
  const explicitState = String(
    routine?.state || routine?.status || "",
  ).toLowerCase();
  let state =
    explicitState === "past_expected_window" ? "overdue" : explicitState;
  if (!state) {
    state =
      nowMs < startAt ? "waiting" : nowMs <= endAt ? "watching" : "overdue";
  }
  return {
    available: true,
    startAt,
    centerAt,
    endAt,
    state,
    basis: routine?.basis || routine?.kind || "estimated",
    sampleCount: routine?.sampleCount ?? null,
    minimumSampleCount: routine?.minimumSampleCount ?? null,
    confidence: routine?.confidence || null,
    pollResolutionSeconds: routine?.pollResolutionSeconds ?? null,
    lastReceivedAt: firstFinite(
      routine?.lastReceivedAt,
      routine?.lastRoutineReceivedAt,
      routine?.receivedAt,
    ),
    note: routine?.note || routine?.explanation || null,
  };
}

function formatClock(epochMs, timeZone, includeSeconds = true) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: true,
  }).format(new Date(epochMs));
}

function formatDateTime(epochMs, timeZone = MEXICO_TIMEZONE) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date(epochMs));
}

function formatCompactDateTime(epochMs, timeZone = MEXICO_TIMEZONE) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochMs));
}

function formatAge(epochMs, nowMs) {
  if (!Number.isFinite(epochMs) || !Number.isFinite(nowMs)) {
    return "age unavailable";
  }
  const seconds = Math.max(0, Math.floor((nowMs - epochMs) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function formatCountdown(targetMs, nowMs) {
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) {
    return "--:--";
  }
  const total = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSpan(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return "—";
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatTemperature(value, digits = 1) {
  return Number.isFinite(value) ? `${value.toFixed(digits)}°C` : "—";
}

function formatSignedTemperature(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}°`;
}

function exactString(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return Number.isFinite(value) ? String(value) : null;
}

function normalizePriceDecimal(value) {
  const raw = exactString(value);
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) {
    return null;
  }
  const [whole, fraction = ""] = raw.split(".");
  const cleanWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const cleanFraction = fraction.replace(/0+$/, "");
  return cleanFraction ? `${cleanWhole}.${cleanFraction}` : cleanWhole;
}

function scaledDecimal(value, scale) {
  const normalized = normalizePriceDecimal(value);
  if (!normalized) {
    return null;
  }
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
}

function decimalScale(value) {
  const normalized = normalizePriceDecimal(value);
  return normalized?.includes(".") ? normalized.split(".")[1].length : 0;
}

function decimalFromScaled(integer, scale) {
  const digits = integer.toString().padStart(scale + 1, "0");
  if (!scale) {
    return digits;
  }
  return normalizePriceDecimal(
    `${digits.slice(0, -scale)}.${digits.slice(-scale)}`,
  );
}

function comparePriceDecimals(left, right) {
  const scale = Math.max(decimalScale(left), decimalScale(right));
  const leftInteger = scaledDecimal(left, scale);
  const rightInteger = scaledDecimal(right, scale);
  if (leftInteger === null || rightInteger === null) {
    return 0;
  }
  return leftInteger < rightInteger ? -1 : leftInteger > rightInteger ? 1 : 0;
}

function subtractPriceDecimals(larger, smaller) {
  const scale = Math.max(decimalScale(larger), decimalScale(smaller));
  const largerInteger = scaledDecimal(larger, scale);
  const smallerInteger = scaledDecimal(smaller, scale);
  if (
    largerInteger === null ||
    smallerInteger === null ||
    largerInteger < smallerInteger
  ) {
    return null;
  }
  return decimalFromScaled(largerInteger - smallerInteger, scale);
}

function midpointPriceDecimals(left, right) {
  const scale = Math.max(decimalScale(left), decimalScale(right));
  const leftInteger = scaledDecimal(left, scale);
  const rightInteger = scaledDecimal(right, scale);
  if (leftInteger === null || rightInteger === null) {
    return null;
  }
  const sum = leftInteger + rightInteger;
  return sum % 2n === 0n
    ? decimalFromScaled(sum / 2n, scale)
    : decimalFromScaled(sum * 5n, scale + 1);
}

function deriveBrowserDisplay(quote) {
  const bid = normalizePriceDecimal(quote?.bestBidPrice);
  const ask = normalizePriceDecimal(quote?.bestAskPrice);
  const last = normalizePriceDecimal(quote?.lastTradePrice);
  if (bid && ask && comparePriceDecimals(ask, bid) >= 0) {
    const midpointPrice = midpointPriceDecimals(bid, ask);
    const spreadPrice = subtractPriceDecimals(ask, bid);
    const useLast =
      spreadPrice && comparePriceDecimals(spreadPrice, "0.1") > 0 && last;
    return {
      midpointPrice,
      spreadPrice,
      platformDisplayPrice: useLast ? last : midpointPrice,
      platformDisplaySource: useLast ? "last_trade" : "midpoint",
    };
  }
  if (last) {
    return {
      midpointPrice: undefined,
      spreadPrice: undefined,
      platformDisplayPrice: last,
      platformDisplaySource: "last_trade",
    };
  }
  const gamma = normalizePriceDecimal(quote?.gammaOutcomePrice);
  return gamma
    ? {
        midpointPrice: undefined,
        spreadPrice: undefined,
        platformDisplayPrice: gamma,
        platformDisplaySource: "gamma_outcome",
      }
    : {
        midpointPrice: undefined,
        spreadPrice: undefined,
        platformDisplayPrice: undefined,
        platformDisplaySource: "unavailable",
      };
}

function websocketEpoch(value, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? parsed < 10_000_000_000
        ? parsed * 1000
        : parsed
      : fallback;
  }
  return fallback;
}

function bestBookPrice(levels, side) {
  return (Array.isArray(levels) ? levels : [])
    .map((level) => normalizePriceDecimal(level?.price))
    .filter(Boolean)
    .sort((left, right) =>
      side === "bid"
        ? comparePriceDecimals(right, left)
        : comparePriceDecimals(left, right),
    )[0];
}

function decimalToPercent(decimal) {
  const raw = exactString(decimal);
  if (!raw) {
    return null;
  }
  if (raw.endsWith("%")) {
    return raw;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return raw;
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const decimalPlaces = fraction.length - 2;
  let result;
  if (decimalPlaces <= 0) {
    result = `${digits}${"0".repeat(-decimalPlaces)}`;
  } else {
    const padded = digits.padStart(decimalPlaces + 1, "0");
    result = `${padded.slice(0, -decimalPlaces)}.${padded.slice(-decimalPlaces)}`;
  }
  result = result.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return `${negative ? "-" : ""}${result}%`;
}

function quoteExact(row, kind) {
  const aliases = {
    probability: [
      "platformDisplayPrice",
      "displayProbabilityExact",
      "displayProbability",
      "probabilityExact",
      "probability",
      "markPrice",
      "price",
      "gammaOutcomePrice",
    ],
    bid: ["bestBidPrice", "bestBidExact", "bestBid", "bidExact", "bid"],
    ask: ["bestAskPrice", "bestAskExact", "bestAsk", "askExact", "ask"],
    last: ["lastTradePrice", "lastTradePriceExact", "lastExact", "last"],
    spread: ["spreadPrice", "spreadExact", "spread"],
  };
  for (const key of aliases[kind] || []) {
    const value = exactString(row?.[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function quotePercent(row, kind) {
  if (kind === "probability") {
    const exact = quoteExact(row, kind);
    if (exact) {
      return decimalToPercent(exact);
    }
  }
  const pctValue = firstPresent(
    kind === "probability" ? row?.platformDisplayProbabilityPct : null,
    kind === "probability" ? row?.gammaProbabilityPct : null,
    row?.[`${kind}PctExact`],
    row?.[`${kind}PercentExact`],
    row?.[`${kind}Pct`],
  );
  return exactString(pctValue)
    ? `${exactString(pctValue).replace(/%$/, "")}%`
    : decimalToPercent(quoteExact(row, kind));
}

function numericQuote(row) {
  const raw = quoteExact(row, "probability");
  if (!raw) {
    return null;
  }
  const parsed = Number(raw.replace("%", ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return raw.endsWith("%") || parsed > 1 ? parsed : parsed * 100;
}

function quoteId(row, index = 0) {
  return String(
    firstPresent(
      row?.marketId,
      row?.conditionId,
      row?.tokenId,
      row?.outcomeTokenId,
      row?.yesTokenId,
      row?.slug,
      row?.bucketKey,
      row?.bucket,
      row?.label,
      index,
    ),
  );
}

function restQuoteReceivedAt(quote) {
  return firstFinite(
    quote?.receivedAt,
    quote?.fetchedAt,
    quote?.lastChangedAt,
    quote?.bookTimestamp,
  );
}

function mergeBrowserOverride(quote, override) {
  if (!override || !Number.isFinite(override.receivedAt)) {
    return quote;
  }
  const restReceivedAt = restQuoteReceivedAt(quote);
  const baseRestReceivedAt = Number.isFinite(override.baseRestReceivedAt)
    ? override.baseRestReceivedAt
    : null;
  return baseRestReceivedAt ===
    (Number.isFinite(restReceivedAt) ? restReceivedAt : null)
    ? { ...quote, ...override }
    : quote;
}

function useBrowserMarketStream(quotes, enabled) {
  const [snapshot, setSnapshot] = useState({
    status: enabled ? "waiting" : "disabled",
    lastMessageAt: null,
    error: null,
  });
  const [overrides, setOverrides] = useState({});
  const [events, setEvents] = useState([]);
  const overridesRef = useRef({});
  const baseQuotesRef = useRef({});
  baseQuotesRef.current = Object.fromEntries(
    (quotes || [])
      .filter((quote) => quote?.yesTokenId)
      .map((quote) => [String(quote.yesTokenId), quote]),
  );
  const tokenKey = (quotes || [])
    .map((quote) => quote?.yesTokenId)
    .filter(Boolean)
    .map(String)
    .sort()
    .join("|");
  const restVersionKey = (quotes || [])
    .filter((quote) => quote?.yesTokenId)
    .map(
      (quote) =>
        `${String(quote.yesTokenId)}:${restQuoteReceivedAt(quote) ?? "none"}`,
    )
    .sort()
    .join("|");

  useEffect(() => {
    const current = overridesRef.current;
    const next = Object.fromEntries(
      Object.entries(current).filter(([tokenId, override]) => {
        const restQuote = baseQuotesRef.current[tokenId];
        const restReceivedAt = restQuoteReceivedAt(restQuote);
        return (
          Number.isFinite(override?.receivedAt) &&
          (Number.isFinite(override?.baseRestReceivedAt)
            ? override.baseRestReceivedAt
            : null) ===
            (Number.isFinite(restReceivedAt) ? restReceivedAt : null)
        );
      }),
    );
    if (Object.keys(next).length !== Object.keys(current).length) {
      overridesRef.current = next;
      setOverrides(next);
    }
  }, [restVersionKey]);

  useEffect(() => {
    overridesRef.current = {};
    setOverrides({});
    setEvents([]);
    if (!enabled) {
      setSnapshot({ status: "disabled", lastMessageAt: null, error: null });
      return undefined;
    }
    const tokenIds = tokenKey ? tokenKey.split("|") : [];
    if (!tokenIds.length) {
      setSnapshot({ status: "waiting", lastMessageAt: null, error: null });
      return undefined;
    }
    if (
      typeof window === "undefined" ||
      typeof window.WebSocket !== "function"
    ) {
      setSnapshot({
        status: "unavailable",
        lastMessageAt: null,
        error: "WebSocket is unavailable in this browser.",
      });
      return undefined;
    }

    let disposed = false;
    let socket = null;
    let reconnectTimer = null;
    let pingTimer = null;
    let attempt = 0;

    const clearOverrides = () => {
      overridesRef.current = {};
      setOverrides({});
    };

    const applyPatch = (tokenId, patch, eventType, providerAt) => {
      const base = baseQuotesRef.current[tokenId];
      if (!base) {
        return;
      }
      const hasValidTick = [
        "bestBidPrice",
        "bestAskPrice",
        "lastTradePrice",
        "tickSize",
      ].some((field) => normalizePriceDecimal(patch?.[field]));
      if (!hasValidTick) {
        return;
      }
      const receivedAt = Date.now();
      const restReceivedAt = restQuoteReceivedAt(base);
      const currentOverride = overridesRef.current[tokenId];
      const usableOverride =
        Number.isFinite(currentOverride?.receivedAt) &&
        (Number.isFinite(currentOverride?.baseRestReceivedAt)
          ? currentOverride.baseRestReceivedAt
          : null) === (Number.isFinite(restReceivedAt) ? restReceivedAt : null)
          ? currentOverride
          : {};
      const nextQuote = {
        ...base,
        ...usableOverride,
        ...patch,
        receivedAt,
        lastChangedAt: receivedAt,
        browserSessionLive: true,
        browserProviderAt: providerAt,
      };
      const displayPatch = deriveBrowserDisplay(nextQuote);
      Object.assign(nextQuote, displayPatch);
      const overridePatch = {
        ...usableOverride,
        ...patch,
        ...displayPatch,
        baseRestReceivedAt: Number.isFinite(restReceivedAt)
          ? restReceivedAt
          : null,
        receivedAt,
        lastChangedAt: receivedAt,
        browserSessionLive: true,
        browserProviderAt: providerAt,
      };
      overridesRef.current = {
        ...overridesRef.current,
        [tokenId]: overridePatch,
      };
      setOverrides(overridesRef.current);
      setEvents((current) =>
        [
          ...current,
          {
            ...nextQuote,
            id: `browser-${receivedAt}-${eventType}-${tokenId}`,
            eventType: `browser_${eventType}`,
            trigger: "browser_websocket",
            capturedAt: receivedAt,
            receivedAt,
          },
        ].slice(-1200),
      );
      setSnapshot({ status: "live", lastMessageAt: receivedAt, error: null });
    };

    const processMessage = (message) => {
      if (!message || typeof message !== "object") {
        return;
      }
      const eventType = String(
        message.event_type || message.type || "",
      ).toLowerCase();
      const providerAt = websocketEpoch(message.timestamp);
      if (
        eventType === "price_change" &&
        Array.isArray(message.price_changes)
      ) {
        for (const change of message.price_changes) {
          const tokenId = String(change?.asset_id || change?.assetId || "");
          if (!tokenId) continue;
          applyPatch(
            tokenId,
            {
              ...(normalizePriceDecimal(change.best_bid)
                ? {
                    bestBidPrice: normalizePriceDecimal(change.best_bid),
                    bookAvailable: true,
                  }
                : {}),
              ...(normalizePriceDecimal(change.best_ask)
                ? {
                    bestAskPrice: normalizePriceDecimal(change.best_ask),
                    bookAvailable: true,
                  }
                : {}),
              bookTimestamp: providerAt,
            },
            "price_change",
            providerAt,
          );
        }
        return;
      }

      const tokenId = String(message.asset_id || message.assetId || "");
      if (!tokenId) {
        return;
      }
      if (eventType === "book") {
        const bestBidPrice = bestBookPrice(message.bids, "bid");
        const bestAskPrice = bestBookPrice(message.asks, "ask");
        applyPatch(
          tokenId,
          {
            bestBidPrice,
            bestAskPrice,
            bookAvailable: true,
            bookTimestamp: providerAt,
            ...(normalizePriceDecimal(message.tick_size)
              ? { tickSize: normalizePriceDecimal(message.tick_size) }
              : {}),
            ...(normalizePriceDecimal(message.last_trade_price)
              ? {
                  lastTradePrice: normalizePriceDecimal(
                    message.last_trade_price,
                  ),
                }
              : {}),
          },
          "book",
          providerAt,
        );
      } else if (eventType === "last_trade_price") {
        const lastTradePrice = normalizePriceDecimal(message.price);
        if (lastTradePrice) {
          applyPatch(
            tokenId,
            {
              lastTradePrice,
              lastTradeSide: firstPresent(message.side, message.taker_side),
              bookTimestamp: providerAt,
            },
            "last_trade_price",
            providerAt,
          );
        }
      } else if (eventType === "tick_size_change") {
        const tickSize = normalizePriceDecimal(
          firstPresent(message.new_tick_size, message.tick_size),
        );
        if (tickSize) {
          applyPatch(
            tokenId,
            { tickSize, bookTimestamp: providerAt },
            "tick_size_change",
            providerAt,
          );
        }
      }
    };

    const connect = () => {
      if (disposed) return;
      if (attempt) {
        clearOverrides();
      }
      setSnapshot((current) => ({
        ...current,
        status: attempt ? "reconnecting" : "connecting",
        ...(attempt ? { lastMessageAt: null } : {}),
        error: null,
      }));
      try {
        socket = new window.WebSocket(POLYMARKET_MARKET_WEBSOCKET_URL);
      } catch (error) {
        setSnapshot((current) => ({
          ...current,
          status: "disconnected",
          error:
            error instanceof Error
              ? error.message
              : "WebSocket could not open.",
        }));
        return;
      }
      socket.addEventListener("open", () => {
        if (disposed) return;
        attempt = 0;
        socket.send(
          JSON.stringify({
            assets_ids: tokenIds,
            type: "market",
            custom_feature_enabled: true,
          }),
        );
        setSnapshot((current) => ({
          ...current,
          status: "connected_waiting",
          error: null,
        }));
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === window.WebSocket.OPEN) {
            socket.send("PING");
          }
        }, 10_000);
      });
      socket.addEventListener("message", (event) => {
        if (event.data === "PONG" || event.data === "PING") return;
        try {
          const payload = JSON.parse(event.data);
          const messages = Array.isArray(payload) ? payload : [payload];
          for (const message of messages) processMessage(message);
        } catch {
          // Ignore non-JSON keepalives and preserve the last valid quote state.
        }
      });
      socket.addEventListener("error", () => {
        if (!disposed) {
          setSnapshot((current) => ({
            ...current,
            status: "disconnected",
            error: "The browser market stream encountered a connection error.",
          }));
        }
      });
      socket.addEventListener("close", () => {
        if (pingTimer) window.clearInterval(pingTimer);
        if (disposed) return;
        attempt += 1;
        const delay = Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4));
        setSnapshot((current) => ({ ...current, status: "reconnecting" }));
        reconnectTimer = window.setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      if (socket) {
        socket.close();
      }
    };
  }, [enabled, tokenKey]);

  return { ...snapshot, overrides, events };
}

function quoteLabel(row, index = 0) {
  return String(
    firstPresent(
      row?.bucketLabel,
      row?.label,
      row?.groupItemTitle,
      row?.title,
      row?.outcomeLabel,
      row?.bucket,
      `Outcome ${index + 1}`,
    ),
  );
}

function eventEpoch(row) {
  return firstFinite(
    row?.observedAt,
    row?.firstSeenAt,
    row?.capturedAt,
    row?.receivedAt,
    row?.publishedAt,
    row?.updatedAt,
    row?.timestamp,
    row?.timestampMs,
    row?.obsTimeUtc,
    row?.screenTimeUtc,
  );
}

function sourceFirstSeenEpoch(row) {
  return firstFinite(
    row?.firstObservedAt,
    row?.observedAt,
    row?.firstSeenAt,
    row?.receivedAt,
    row?.at,
  );
}

function sourceMeasurementEpoch(row) {
  return firstFinite(
    row?.measurementAt,
    row?.eventTimeUtc,
    row?.obsTimeUtc,
    row?.screenTimeUtc,
    row?.captureAt,
  );
}

function normalizeTemperaturePoints(dashboard) {
  const provided = Array.isArray(dashboard?.reactionTemperatureTimeline)
    ? dashboard.reactionTemperatureTimeline
    : Array.isArray(dashboard?.temperatureTimeline)
      ? dashboard.temperatureTimeline
      : [];
  const metars = Array.isArray(dashboard?.metars)
    ? dashboard.metars
    : Array.isArray(dashboard?.metarRows)
      ? dashboard.metarRows
      : [];
  const capmaRows = Array.isArray(dashboard?.capma?.observations)
    ? dashboard.capma.observations
    : Array.isArray(dashboard?.capma?.rows)
      ? dashboard.capma.rows
      : [];
  return [...provided, ...(!provided.length ? [...metars, ...capmaRows] : [])]
    .map((row, index) => {
      const at = eventEpoch(row);
      const tempC = firstFinite(
        row?.tempC,
        row?.temperatureC,
        row?.currentTempC,
        row?.valueC,
      );
      if (!Number.isFinite(at) || !Number.isFinite(tempC)) {
        return null;
      }
      return {
        ...row,
        id: row?._id || row?.id || `temperature-${at}-${index}`,
        at,
        measurementAt: firstFinite(
          row?.measurementAt,
          row?.eventTimeUtc,
          row?.obsTimeUtc,
          row?.screenTimeUtc,
        ),
        tempC,
        source: String(
          firstPresent(
            row?.sourceLabel,
            row?.source,
            row?.tdz ? `CAPMA TDZ ${row.tdz}` : null,
            row?.rawText ? "METAR" : null,
            "Temperature",
          ),
        ),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.at - right.at);
}

function temperatureSeriesKey(point) {
  const explicit = String(point?.series || "")
    .trim()
    .toLowerCase();
  if (explicit) {
    return explicit;
  }
  if (point?.tdz !== undefined && point?.tdz !== null) {
    return `capma_tdz_${String(point.tdz).padStart(2, "0")}`;
  }
  if (
    point?.rawText ||
    point?.kind === "official_report" ||
    /metar|speci/i.test(String(point?.source || ""))
  ) {
    return "metar_speci";
  }
  return `temperature_${String(point?.source || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")}`;
}

function isCapmaTdz23Evidence(row) {
  const series = String(firstPresent(row?.series, row?.sourceKey, ""))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (series === "capma_tdz_23") {
    return true;
  }
  if (row?.tdz !== undefined && row?.tdz !== null) {
    return String(row.tdz).padStart(2, "0") === "23";
  }
  return /\btdz\s*23\b/i.test(
    `${row?.source || ""} ${row?.sourceLabel || ""} ${row?.artifact || ""}`,
  );
}

function groupTemperatureSeries(points) {
  const groups = new Map();
  for (const point of points) {
    const key = temperatureSeriesKey(point);
    if (!groups.has(key)) {
      const knownStyle = TEMPERATURE_SERIES_STYLES[key];
      const fallbackIndex = groups.size % FALLBACK_TEMPERATURE_COLORS.length;
      groups.set(key, {
        key,
        label: knownStyle?.label || point.source || "Temperature",
        color: knownStyle?.color || FALLBACK_TEMPERATURE_COLORS[fallbackIndex],
        points: [],
      });
    }
    groups.get(key).points.push(point);
  }
  return [...groups.values()];
}

function quoteReceiptEpoch(row) {
  return firstFinite(
    row?.receivedAt,
    row?.pollReceivedAt,
    row?.fetchedAt,
    row?.pollCompletedAt,
    row?.capturedAt,
    row?.createdAt,
  );
}

function quoteRows(market) {
  const collections = [
    market?.quoteEvents,
    market?.pollHeartbeats,
    market?.quoteHeartbeats,
    market?.heartbeats,
    market?.quoteObservations,
    market?.quotePolls,
    market?.events,
    market?.predecessorHeartbeat ? [market.predecessorHeartbeat] : null,
  ].filter(Array.isArray);
  const rowsByIdentity = new Map();
  for (const rowValue of collections.flat()) {
    const row = {
      ...(rowValue?.quote || {}),
      ...(rowValue?.snapshot || {}),
      ...rowValue,
    };
    const at = quoteReceiptEpoch(row);
    if (!Number.isFinite(at)) {
      continue;
    }
    const pollIdentity = firstPresent(
      row?.pollId,
      row?.pollGeneration,
      row?._id,
      row?.id,
    );
    const contractIdentity = [row?.eventId, row?.marketId, row?.yesTokenId]
      .filter((value) => value !== undefined && value !== null && value !== "")
      .map(String)
      .join(":");
    const identity = pollIdentity
      ? `${contractIdentity || "market"}:${pollIdentity}:${at}`
      : [
          contractIdentity || "market",
          at,
          row?.quoteFingerprint || "",
          row?.lastTradePrice || "",
          row?.bestBidPrice || "",
          row?.bestAskPrice || "",
        ].join(":");
    const existing = rowsByIdentity.get(identity);
    rowsByIdentity.set(
      identity,
      existing
        ? {
            ...existing,
            ...row,
            changedFields: [
              ...new Set([
                ...(existing.changedFields || []),
                ...(row.changedFields || []),
              ]),
            ],
            isHeartbeat:
              existing.isHeartbeat === true || row.isHeartbeat === true,
          }
        : row,
    );
  }
  return [...rowsByIdentity.values()];
}

function normalizeQuoteObservations(market, selectedQuote) {
  const events = quoteRows(market);
  const normalized = events
    .filter((event) => reactionRowMatchesContract(event, selectedQuote))
    .map((event, index) => {
      const at = quoteReceiptEpoch(event);
      return Number.isFinite(at)
        ? {
            ...event,
            id: event?._id || event?.id || `quote-${at}-${index}`,
            at,
            sessionOnly:
              event?.trigger === "browser_websocket" ||
              event?.browserSessionLive === true ||
              String(event?.eventType || "").startsWith("browser_"),
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.at - right.at);

  if (!normalized.length && selectedQuote) {
    const at = quoteReceiptEpoch(selectedQuote);
    if (Number.isFinite(at)) {
      normalized.push({
        ...selectedQuote,
        id: `current-${at}`,
        at,
        sessionOnly: selectedQuote?.browserSessionLive === true,
      });
    }
  }
  return normalized;
}

function normalizeSourceEvents(dashboard) {
  const provided = Array.isArray(dashboard?.sourceEvents)
    ? dashboard.sourceEvents
    : Array.isArray(dashboard?.sourceRace)
      ? dashboard.sourceRace
      : Array.isArray(dashboard?.raceEvents)
        ? dashboard.raceEvents
        : [];
  if (provided.length) {
    return dedupeWeatherSourceEvents(
      provided
        .map((row, index) => ({
          ...row,
          id: row?._id || row?.id || `source-${index}`,
          at: sourceFirstSeenEpoch(row),
          measurementAt: sourceMeasurementEpoch(row),
          source: String(
            firstPresent(
              row?.sourceLabel,
              row?.source,
              row?.provider,
              "Source",
            ),
          ),
          artifact: String(
            firstPresent(
              row?.artifact,
              row?.reportType,
              row?.kind,
              "Observation",
            ),
          ),
        }))
        .filter((row) => Number.isFinite(row.at))
        .sort((left, right) => left.at - right.at),
    );
  }

  const metar = dashboard?.latestMetar;
  if (!metar) {
    return [];
  }
  const candidates = [
    ["CAPMA AFTN", metar.capmaSeenAt || metar.capmaAftnSeenAt],
    ["NOAA text", metar.noaaSeenAt || metar.firstNoaaSeenAt],
    ["AWC API", metar.firstAwcSeenAt || metar.firstSeenAt],
  ];
  return candidates
    .filter(([, at]) => Number.isFinite(at))
    .map(([source, at]) => ({
      id: `${source}-${at}`,
      at,
      source,
      artifact: metar.reportType || "METAR",
      captureAt: metar.obsTimeUtc,
      measurementAt: metar.obsTimeUtc,
      status: "observed",
    }))
    .sort((left, right) => left.at - right.at);
}

function latestBy(rows, epochKey) {
  return (
    [...(rows || [])]
      .filter((row) => Number.isFinite(row?.[epochKey]))
      .sort((left, right) => right[epochKey] - left[epochKey])[0] || null
  );
}

function normalizeCapma(dashboard) {
  const capma = dashboard?.capma || {};
  const observations = Array.isArray(capma.observations)
    ? capma.observations
    : Array.isArray(capma.rows)
      ? capma.rows
      : [];
  const latestImages = Array.isArray(capma.latestImages)
    ? Object.fromEntries(
        capma.latestImages.map((image) => [String(image.tdz), image]),
      )
    : capma.latestImages || {};
  const approvalGranted =
    capma.approvalGranted === true ||
    capma.visible === true ||
    (capma.accessApproved === true &&
      capma.retentionApproved === true &&
      capma.republicationApproved === true);
  return {
    ...capma,
    observations,
    latestImages,
    approvalGranted,
    latest05: latestBy(
      observations.filter((row) => String(row.tdz) === "05"),
      "screenTimeUtc",
    ),
    latest23: latestBy(
      observations.filter((row) => String(row.tdz) === "23"),
      "screenTimeUtc",
    ),
  };
}

function normalizeForecast(source, fallback, kind) {
  const value = source || {};
  const currentSnapshot = value.current || null;
  let current = firstFinite(
    value.currentMaxC,
    value.maxTempC,
    value.maximumTempC,
    value.forecastMaxC,
    value.valueC,
  );
  if (!Number.isFinite(current) && kind === "taf") {
    const groups = fallback?.temperatureGroups || [];
    current = firstFinite(
      ...groups
        .filter((group) => group.kind === "maximum")
        .map((group) => group.tempC),
    );
  }
  if (!Number.isFinite(current) && kind === "smn") {
    const rows = Array.isArray(fallback) ? fallback : [];
    const values = rows
      .map((row) => firstFinite(row.tempC, row.temperatureC))
      .filter(Number.isFinite);
    current = values.length ? Math.max(...values) : null;
  }
  const previous = firstFinite(
    value.previousMaxC,
    value.previousMaximumTempC,
    value.previousForecastMaxC,
  );
  const history = (Array.isArray(value.history) ? value.history : [])
    .map((row, index) => ({
      key: String(row?.snapshotKey || `${kind}-revision-${index}`),
      tempC: firstFinite(row?.forecastHighC, row?.currentMaxC, row?.valueC),
      at: firstFinite(row?.sourceCapturedAt, row?.capturedAt),
    }))
    .filter((row) => Number.isFinite(row.tempC) && Number.isFinite(row.at))
    .sort((left, right) => left.at - right.at);
  return {
    ...value,
    current,
    previous,
    delta: firstFinite(
      value.deltaC,
      value.changeC,
      Number.isFinite(current) && Number.isFinite(previous)
        ? current - previous
        : null,
    ),
    changedAt: firstFinite(
      value.changedAt,
      value.lastChangedAt,
      value.revisedAt,
      value.capturedAt,
    ),
    issuedAt: firstFinite(value.issuedAt, value.fetchedAt, value.capturedAt),
    providerIssuedAt:
      kind === "smn"
        ? null
        : firstFinite(value.providerIssuedAt, currentSnapshot?.sourceIssuedAt),
    forecastCapturedAt: firstFinite(
      value.forecastCapturedAt,
      currentSnapshot?.sourceCapturedAt,
      value.capturedAt,
    ),
    history,
  };
}

function capmaImageUrl(path) {
  const siteOrigin = resolveConvexSiteOrigin(
    process.env.NEXT_PUBLIC_CONVEX_URL,
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
  );
  if (!siteOrigin || typeof path !== "string" || !path.startsWith("/")) {
    return null;
  }
  try {
    const base = new URL(siteOrigin);
    const image = new URL(path, base);
    return image.protocol === "https:" && image.origin === base.origin
      ? image.toString()
      : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function actionSummary(label, settled) {
  if (settled.status === "rejected") {
    return `${label}: error`;
  }
  if (
    settled.value?.status === "cooldown" &&
    Number.isFinite(settled.value?.retryAfterAt)
  ) {
    return `${label}: cooldown until ${formatDateTime(settled.value.retryAfterAt)}`;
  }
  const status = String(settled.value?.status || "synced").replaceAll("_", " ");
  return `${label}: ${status}`;
}

function StatusPill({ tone = "neutral", children }) {
  return (
    <span className={`${styles.statusPill} ${styles[tone] || ""}`}>
      {children}
    </span>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className={styles.emptyState}>
      <span aria-hidden="true">∅</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function ClockBlock({ nowMs }) {
  return (
    <div className={styles.clockBlock} aria-label="Live clocks">
      <div>
        <span>Mexico City</span>
        <time
          dateTime={
            Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : undefined
          }
        >
          {formatClock(nowMs, MEXICO_TIMEZONE)}
        </time>
      </div>
      <div>
        <span>UTC / Zulu</span>
        <time
          dateTime={
            Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : undefined
          }
        >
          {formatClock(nowMs, "UTC")}
        </time>
      </div>
    </div>
  );
}

function ReportCyclePanel({
  temperatures,
  cycles,
  officialReports,
  clock,
  relayLagModel,
  cycleState,
  nowMs,
}) {
  const [chartZoom, setChartZoom] = useState(2);
  const chartScrollRef = useRef(null);
  const hasLiveClock = Number.isFinite(nowMs);

  useEffect(() => {
    if (!hasLiveClock) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const scroller = chartScrollRef.current;
      if (scroller) {
        scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chartZoom, hasLiveClock]);

  if (!hasLiveClock) {
    return (
      <section
        className={styles.reportCyclePanel}
        aria-labelledby="report-cycle-title"
      >
        <p className={styles.eyebrow}>Primary signal · report-cycle clock</p>
        <h2 id="report-cycle-title">Connecting report-cycle history…</h2>
      </section>
    );
  }
  const width = 1100 * chartZoom;
  const height = 356;
  const left = 58;
  const right = 22;
  const top = 42;
  const bottom = 54;
  const chartEndAt = Math.max(
    nowMs,
    firstFinite(clock?.endAt, clock?.centerAt, nowMs),
  );
  const chartStartAt = chartEndAt - 6 * 60 * 60 * 1000;
  const latestCycle = cycleState?.latestCycle || cycles.at(-1) || null;
  const tdzPoints = temperatures
    .filter((point) => temperatureSeriesKey(point) === "capma_tdz_05")
    .map((point) => ({
      ...point,
      at: firstFinite(point?.firstObservedAt, point?.observedAt, point?.at),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.at) &&
        Number.isFinite(point.tempC) &&
        point.at >= chartStartAt &&
        point.at <= chartEndAt,
    )
    .map((point) => ({
      ...point,
      assessment: classifyTdzPoint({
        point,
        officialReports,
        routineCycles: cycles,
        expectedCapmaAt: cycleState?.expectedCapmaAt,
        windowStartAt: cycleState?.windowStartAt,
        windowEndAt: cycleState?.windowEndAt,
        nowMs,
      }),
    }))
    .map((point) => ({
      ...point,
      role: point.assessment.role,
      focused: point.assessment.role === "routine_lead",
    }));
  const capmaPoints = cycles
    .filter(
      (cycle) =>
        Number.isFinite(cycle.capmaAt) &&
        Number.isFinite(cycle.tempC) &&
        cycle.capmaAt >= chartStartAt &&
        cycle.capmaAt <= chartEndAt,
    )
    .map((cycle) => ({ ...cycle, at: cycle.capmaAt }));
  const temperatureValues = [
    ...tdzPoints.map((point) => point.tempC),
    ...capmaPoints.map((point) => point.tempC),
  ].filter(Number.isFinite);
  const minTemperature = temperatureValues.length
    ? Math.floor(Math.min(...temperatureValues) - 1)
    : 10;
  const maxTemperature = temperatureValues.length
    ? Math.ceil(Math.max(...temperatureValues) + 1)
    : 30;
  const temperatureRange = Math.max(2, maxTemperature - minTemperature);
  const xFor = (value) => {
    const at = typeof value === "object" ? value?.at : value;
    return (
      left +
      ((at - chartStartAt) / Math.max(1, chartEndAt - chartStartAt)) *
        (width - left - right)
    );
  };
  const yFor = (point) =>
    top +
    ((maxTemperature - point.tempC) / temperatureRange) *
      (height - top - bottom);
  const tdzSeries = groupTemperatureSeries(tdzPoints);
  const xTickSegments = 6 * chartZoom;
  const xTicks = Array.from(
    { length: xTickSegments + 1 },
    (_, index) =>
      chartStartAt + ((chartEndAt - chartStartAt) * index) / xTickSegments,
  );
  const yTicks = Array.from(
    { length: 5 },
    (_, index) => maxTemperature - (temperatureRange * index) / 4,
  );
  const historicalRoutineBands = cycles
    .filter(
      (cycle) =>
        Number.isFinite(cycle.routineWindowStartAt) &&
        Number.isFinite(cycle.transmissionDeadlineAt) &&
        cycle.transmissionDeadlineAt >= chartStartAt &&
        cycle.routineWindowStartAt <= chartEndAt,
    )
    .map((cycle) => ({
      id: `routine-${cycle.id}`,
      startAt: cycle.routineWindowStartAt,
      endAt: cycle.transmissionDeadlineAt,
      kind: "routine",
      label: "SENEAM routine observation / transmission window · :40–:56",
    }));
  const expectedRoutineBand =
    Number.isFinite(cycleState?.windowStartAt) &&
    Number.isFinite(cycleState?.windowEndAt) &&
    cycleState.windowEndAt >= chartStartAt &&
    cycleState.windowStartAt <= chartEndAt &&
    !cycles.some(
      (cycle) =>
        cycle.routineWindowStartAt === cycleState.windowStartAt &&
        cycle.transmissionDeadlineAt === cycleState.windowEndAt,
    )
      ? [
          {
            id: "routine-next",
            startAt: cycleState.windowStartAt,
            endAt: cycleState.windowEndAt,
            kind: "expected",
            label:
              "Current or next SENEAM routine observation / transmission window · :40–:56",
          },
        ]
      : [];
  const relayBands = cycles
    .filter(
      (cycle) =>
        Number.isFinite(cycle.capmaAt) &&
        cycle.capmaAt >= chartStartAt &&
        cycle.capmaAt <= chartEndAt,
    )
    .map((cycle) => ({
      id: `relay-${cycle.id}`,
      startAt: cycle.capmaAt,
      endAt: Number.isFinite(cycle.noaaAt)
        ? cycle.noaaAt
        : cycle === latestCycle && cycleState?.phase === "waiting_noaa"
          ? Math.min(nowMs, chartEndAt)
          : cycle.capmaAt,
      kind: "relay",
      label: "Official report locked; awaiting NOAA relay",
    }))
    .filter((band) => band.endAt > band.startAt);
  const phaseTargetPast =
    Number.isFinite(cycleState?.targetAt) && nowMs > cycleState.targetAt;
  const stageClass = (stage) =>
    `${styles.cycleStage} ${styles[`cycleStage${stage}`] || ""}`;
  const stageCycle =
    cycleState?.routineWindowActive || cycleState?.phase === "capma_overdue"
      ? cycleState?.cycleForOperationalWindow
      : latestCycle;
  const latestRelayLag =
    Number.isFinite(stageCycle?.capmaAt) && Number.isFinite(stageCycle?.noaaAt)
      ? stageCycle.noaaAt - stageCycle.capmaAt
      : null;

  return (
    <section
      className={styles.reportCyclePanel}
      aria-labelledby="report-cycle-title"
    >
      <header className={styles.reportCycleHeader}>
        <div>
          <p className={styles.eyebrow}>Primary signal · report-cycle clock</p>
          <h2 id="report-cycle-title">
            TDZ05 → :40–:56 routine window → CAPMA → NOAA
          </h2>
          <p>
            SENEAM&apos;s observer procedure starts the hourly observation at
            minute :40 and requires transmission by :56. CAPMA is this
            deployment&apos;s first sighting of the official report; NOAA later
            relays the same report. After CAPMA, TDZ05 stays active for the next
            report and the temperature special-condition watch.
          </p>
        </div>
        <StatusPill tone={cycleState?.tone || "muted"}>
          {String(cycleState?.phase || "unavailable").replaceAll("_", " ")}
        </StatusPill>
      </header>

      <div className={styles.cycleNowGrid}>
        <div className={styles.cycleCountdown}>
          <span>{cycleState?.targetLabel || "cycle target"}</span>
          <strong>
            {phaseTargetPast
              ? `${formatSpan(nowMs - cycleState.targetAt)} past`
              : formatCountdown(cycleState?.targetAt, nowMs)}
          </strong>
          <b>{cycleState?.title || "Learning report timing"}</b>
          <p>{cycleState?.detail}</p>
        </div>
        <ol className={styles.cycleStages}>
          <li
            className={stageClass(
              cycleState?.routineWindowActive ? "Active" : "Pending",
            )}
          >
            <span>01 · Routine window</span>
            <strong>
              {cycleState?.routineWindowActive
                ? `Open · due :${ROUTINE_TRANSMISSION_DEADLINE_MINUTE}`
                : `Opens :${ROUTINE_WINDOW_OPEN_MINUTE}`}
            </strong>
            <small>
              {Number.isFinite(cycleState?.windowStartAt) &&
              Number.isFinite(cycleState?.windowEndAt)
                ? `${formatClock(cycleState.windowStartAt, MEXICO_TIMEZONE)}–${formatClock(cycleState.windowEndAt, MEXICO_TIMEZONE)} · documented procedure`
                : "operational clock unavailable"}
            </small>
          </li>
          <li className={stageClass(stageCycle?.capmaAt ? "Done" : "Pending")}>
            <span>02 · CAPMA METAR</span>
            <strong>
              {stageCycle?.capmaAt
                ? `${formatTemperature(stageCycle.tempC, 0)} locked`
                : "Awaiting report"}
            </strong>
            <small>
              {stageCycle?.capmaAt
                ? `first seen ${formatClock(stageCycle.capmaAt, MEXICO_TIMEZONE)}`
                : Number.isFinite(clock?.centerAt)
                  ? `learned first-sighting center ${formatClock(clock.centerAt, MEXICO_TIMEZONE)}`
                  : `observation starts :${ROUTINE_WINDOW_OPEN_MINUTE}`}
            </small>
          </li>
          <li
            className={stageClass(
              cycleState?.phase === "waiting_noaa"
                ? "Active"
                : stageCycle?.noaaAt
                  ? "Done"
                  : "Pending",
            )}
          >
            <span>03 · NOAA relay</span>
            <strong>
              {stageCycle?.noaaAt
                ? `received +${formatSpan(latestRelayLag)}`
                : cycleState?.phase === "waiting_noaa"
                  ? "Same report pending"
                  : "After CAPMA"}
            </strong>
            <small>
              {relayLagModel?.available
                ? `median ${formatSpan(relayLagModel.medianLagMs)} · ${relayLagModel.sampleCount} paired`
                : "relay ETA unavailable"}
            </small>
          </li>
          <li
            className={stageClass(
              cycleState?.specialTemperatureCriterionReached
                ? "Danger"
                : cycleState?.latestTdzAssessment?.role === "special_watch"
                  ? "Watch"
                  : "Pending",
            )}
          >
            <span>04 · TDZ05 special watch</span>
            <strong>
              {cycleState?.specialTemperatureCriterionReached
                ? `+${TEMPERATURE_SPECIAL_THRESHOLD_C}°C criterion reached`
                : Number.isFinite(cycleState?.temperatureRiseC)
                  ? `${formatSignedTemperature(cycleState.temperatureRiseC)} vs report`
                  : cycleState?.latestOfficialReport
                    ? "Awaiting TDZ05"
                    : "Awaiting report baseline"}
            </strong>
            <small>
              Local-special criterion; a public SPECI is not guaranteed.
            </small>
          </li>
        </ol>
      </div>

      <div
        className={styles.cycleLegend}
        aria-label="Report cycle chart legend"
      >
        <span className={styles.legendTdz05}>TDZ 05 · first seen</span>
        <span className={styles.legendCapmaReport}>
          CAPMA METAR · first seen
        </span>
        <span className={styles.legendFocusBand}>Routine window · :40–:56</span>
        <span className={styles.legendRelayBand}>CAPMA → NOAA wait</span>
        <span className={styles.legendSpecialWatch}>
          TDZ post-report special watch
        </span>
      </div>
      <div className={styles.cycleChartToolbar}>
        <div>
          <strong>Timeline zoom</strong>
          <span>
            Scroll, swipe, or use Shift + wheel to inspect earlier times.
          </span>
        </div>
        <div
          className={styles.cycleZoomControls}
          role="group"
          aria-label="Report-cycle chart zoom"
        >
          {REPORT_CYCLE_ZOOM_LEVELS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={chartZoom === option.value ? styles.active : ""}
              aria-pressed={chartZoom === option.value}
              title={option.detail}
              onClick={() => setChartZoom(option.value)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const scroller = chartScrollRef.current;
              scroller?.scrollTo({
                left: scroller.scrollWidth,
                behavior: "smooth",
              });
            }}
          >
            Latest →
          </button>
        </div>
      </div>
      <div
        ref={chartScrollRef}
        className={styles.cycleChartWrap}
        tabIndex={0}
        aria-label="Scrollable six-hour TDZ05 and CAPMA report timeline"
      >
        <svg
          className={styles.cycleChart}
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: `${width}px` }}
          role="img"
          aria-labelledby="cycle-chart-title cycle-chart-description"
        >
          <title id="cycle-chart-title">
            CAPMA METAR and TDZ temperature report-cycle history
          </title>
          <desc id="cycle-chart-description">
            Recent TDZ 05 image temperatures are plotted at the time this
            deployment first observed them. TDZ 23 is intentionally hidden.
            CAPMA METAR temperatures are plotted when the report was first
            observed. Green bands mark SENEAM&apos;s documented :40–:56 routine
            observation and transmission window; orange bands mark the later
            NOAA relay wait for the same report. Post-report TDZ points remain
            active for special-condition monitoring.
          </desc>
          {[...historicalRoutineBands, ...expectedRoutineBand].map((band) => (
            <rect
              key={band.id}
              x={xFor(Math.max(chartStartAt, band.startAt))}
              y={top}
              width={Math.max(
                1,
                xFor(Math.min(chartEndAt, band.endAt)) -
                  xFor(Math.max(chartStartAt, band.startAt)),
              )}
              height={height - top - bottom}
              className={
                band.kind === "expected"
                  ? styles.cycleExpectedBand
                  : styles.cycleFocusBand
              }
            >
              <title>{band.label}</title>
            </rect>
          ))}
          {relayBands.map((band) => (
            <rect
              key={band.id}
              x={xFor(band.startAt)}
              y={top}
              width={Math.max(1, xFor(band.endAt) - xFor(band.startAt))}
              height={height - top - bottom}
              className={styles.cycleRelayBand}
            >
              <title>{band.label}</title>
            </rect>
          ))}
          {yTicks.map((tick) => (
            <g key={`cycle-y-${tick}`}>
              <line
                x1={left}
                x2={width - right}
                y1={yFor({ tempC: tick })}
                y2={yFor({ tempC: tick })}
                className={styles.chartGrid}
              />
              <text
                x={left - 10}
                y={yFor({ tempC: tick }) + 3}
                textAnchor="end"
                className={styles.chartTick}
              >
                {tick.toFixed(tick % 1 ? 1 : 0)}°
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={`cycle-x-${tick}`}>
              <line
                x1={xFor(tick)}
                x2={xFor(tick)}
                y1={top}
                y2={height - bottom}
                className={styles.chartGridVertical}
              />
              <text
                x={xFor(tick)}
                y={height - 24}
                textAnchor="middle"
                className={styles.chartTick}
              >
                {formatClock(tick, MEXICO_TIMEZONE, false)}
              </text>
            </g>
          ))}
          {Number.isFinite(nowMs) && nowMs <= chartEndAt && (
            <g>
              <line
                x1={xFor(nowMs)}
                x2={xFor(nowMs)}
                y1={top - 8}
                y2={height - bottom}
                className={styles.cycleNowLine}
              />
              <text
                x={xFor(nowMs)}
                y={top - 15}
                textAnchor="middle"
                className={styles.cycleNowLabel}
              >
                now
              </text>
            </g>
          )}
          {tdzSeries.map((series) => (
            <g key={series.key}>
              <path
                d={linePath(series.points, xFor, yFor)}
                className={styles.cycleTdzLine}
                style={{ stroke: series.color }}
              />
              {series.points.map((point) => (
                <circle
                  key={point.id}
                  cx={xFor(point.at)}
                  cy={yFor(point)}
                  r={
                    point.role === "special_criterion"
                      ? 4.5
                      : point.role === "routine_lead"
                        ? 3.8
                        : point.role === "special_watch"
                          ? 3
                          : 2.3
                  }
                  className={
                    point.role === "special_criterion"
                      ? styles.cycleTdzPointSpecial
                      : point.role === "routine_lead"
                        ? styles.cycleTdzPointFocused
                        : point.role === "special_watch"
                          ? styles.cycleTdzPointWatch
                          : styles.cycleTdzPointMuted
                  }
                  style={{
                    fill:
                      point.role === "special_criterion"
                        ? "#ff5c7a"
                        : point.role === "special_watch"
                          ? "#ffb547"
                          : series.color,
                  }}
                >
                  <title>{`${series.label} ${formatTemperature(point.tempC, 0)} · first seen ${formatDateTime(point.at)} · ${point.role === "special_criterion" ? `+${TEMPERATURE_SPECIAL_THRESHOLD_C}°C local-special criterion reached` : point.role === "routine_lead" ? "routine-report lead" : point.role === "special_watch" ? "post-report special-condition watch" : "context"}${Number.isFinite(point.assessment?.temperatureRiseC) ? ` · ${formatSignedTemperature(point.assessment.temperatureRiseC)} vs last report` : ""}${Number.isFinite(point.measurementAt) ? ` · screen ${formatDateTime(point.measurementAt)}` : ""}`}</title>
                </circle>
              ))}
            </g>
          ))}
          {capmaPoints.length > 1 && (
            <path
              d={linePath(capmaPoints, xFor, yFor)}
              className={styles.cycleCapmaLine}
            />
          )}
          {capmaPoints.map((point) => (
            <g key={point.id}>
              <circle
                cx={xFor(point.at)}
                cy={yFor(point)}
                r="5"
                className={styles.cycleCapmaPoint}
              >
                <title>{`CAPMA METAR ${formatTemperature(point.tempC, 0)} · first seen ${formatDateTime(point.capmaAt)} · observation ${formatDateTime(point.obsTimeUtc)}`}</title>
              </circle>
              <line
                x1={xFor(point.at)}
                x2={xFor(point.at)}
                y1={yFor(point) + 7}
                y2={height - bottom}
                className={styles.cycleCapmaMarker}
              />
            </g>
          ))}
          <text x={left} y="18" className={styles.chartAxisLabel}>
            INFORMATION AVAILABLE TO THIS DEPLOYMENT · °C
          </text>
        </svg>
      </div>
      <footer className={styles.cycleFooter}>
        <span>
          Bright green TDZ05 points lead the approaching routine report. After
          CAPMA locks that report, TDZ05 remains active in orange; rose points
          have reached at least +{TEMPERATURE_SPECIAL_THRESHOLD_C}°C versus the
          latest report. That is a local-special criterion, not a promise that a
          public SPECI will be issued. TDZ23 is hidden from this chart.
        </span>
        <span>
          CAPMA/NOAA order and ETA retain{" "}
          {relayLagModel?.resolutionSeconds || 60}s polling resolution. No exact
          provider publication second is claimed.
        </span>
      </footer>
    </section>
  );
}

function RoutineWindow({ clock, cycleState, nowMs, highFrequencyWatch }) {
  const watchStatus = String(
    highFrequencyWatch?.status || "unavailable",
  ).replaceAll("_", " ");
  const startAt = cycleState?.windowStartAt;
  const endAt = cycleState?.windowEndAt;
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    return (
      <section
        className={styles.timingCard}
        aria-labelledby="routine-window-title"
      >
        <div className={styles.cardEyebrowRow}>
          <p className={styles.eyebrow}>Routine METAR watch</p>
          <StatusPill tone="muted">clock unavailable</StatusPill>
        </div>
        <h2 id="routine-window-title">SENEAM :40–:56 window</h2>
        <div className={styles.speciValue}>
          <span>Countdown unavailable</span>
          <strong>Waiting for a live browser clock</strong>
        </div>
        <p className={styles.cardNote}>
          The operational procedure is fixed by minute of hour; an exact
          observation or publication second is not implied.
        </p>
        <div className={styles.watchMeta}>
          <span>Fast AFTN watch</span>
          <b>{watchStatus}</b>
        </div>
      </section>
    );
  }
  const inWindow = cycleState?.routineWindowActive === true;
  const target = inWindow ? endAt : startAt;
  const tone = inWindow ? "live" : "watch";
  const progress = inWindow
    ? Math.max(0, Math.min(100, ((nowMs - startAt) / (endAt - startAt)) * 100))
    : 0;
  return (
    <section
      className={styles.timingCard}
      aria-labelledby="routine-window-title"
    >
      <div className={styles.cardEyebrowRow}>
        <p className={styles.eyebrow}>Routine METAR watch</p>
        <StatusPill tone={tone}>
          {inWindow ? "window open" : "waiting for :40"}
        </StatusPill>
      </div>
      <h2 id="routine-window-title">SENEAM :40–:56 routine window</h2>
      <div className={styles.countdown} aria-live="off">
        <span>{inWindow ? "transmission deadline in" : "opens in"}</span>
        <strong>{formatCountdown(target, nowMs)}</strong>
      </div>
      <div className={styles.windowScale} aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className={styles.windowTimes}>
        <span>
          <b>Start</b>
          {formatClock(startAt, MEXICO_TIMEZONE)}
        </span>
        <span>
          <b>Deadline</b>
          {formatClock(endAt, MEXICO_TIMEZONE)}
        </span>
      </div>
      <p className={styles.cardNote}>
        Routine observation work begins at :40. Transmission is required by :56;
        the coded time remains when the final element was evaluated. A learned
        CAPMA first-sighting estimate is secondary, not the rule.
      </p>
      <div className={styles.watchMeta}>
        <span>Fast AFTN watch</span>
        <b>{watchStatus}</b>
        <span>Fast-watch target cadence</span>
        <b>
          {Number.isFinite(highFrequencyWatch?.defaultIntervalSeconds)
            ? `${highFrequencyWatch.defaultIntervalSeconds}s`
            : "unknown"}
        </b>
        <span>Historical first-seen resolution</span>
        <b>
          {Number.isFinite(clock.pollResolutionSeconds)
            ? `${clock.pollResolutionSeconds}s`
            : "unknown"}
        </b>
        <span>Learned first-sighting center</span>
        <b>
          {clock.available && Number.isFinite(clock.centerAt)
            ? formatClock(clock.centerAt, MEXICO_TIMEZONE)
            : "insufficient history"}
        </b>
      </div>
    </section>
  );
}

function SpeciCard({ speci, metars, cycleState, nowMs }) {
  const latest =
    speci?.latest ||
    [...(metars || [])]
      .filter((row) => String(row.reportType || "").toUpperCase() === "SPECI")
      .sort(
        (left, right) => (right.obsTimeUtc || 0) - (left.obsTimeUtc || 0),
      )[0];
  const lastAt = firstFinite(latest?.obsTimeUtc, latest?.capturedAt);
  const assessment = cycleState?.latestTdzAssessment;
  const baseline =
    assessment?.baselineReport || cycleState?.latestOfficialReport;
  const latestTdz = cycleState?.latestTdz;
  const riseC = assessment?.temperatureRiseC;
  const criterionReached =
    assessment?.specialTemperatureCriterionReached === true;
  return (
    <section className={styles.timingCard} aria-labelledby="speci-title">
      <div className={styles.cardEyebrowRow}>
        <p className={styles.eyebrow}>Special observation</p>
        <StatusPill tone={criterionReached ? "danger" : "watch"}>
          {criterionReached ? "+2°C criterion reached" : "monitoring TDZ05"}
        </StatusPill>
      </div>
      <h2 id="speci-title">No scheduled SPECI clock</h2>
      <div className={styles.speciValue}>
        <span>TDZ05 versus latest report</span>
        <strong>
          {Number.isFinite(riseC)
            ? `${formatSignedTemperature(riseC)} · ${criterionReached ? "criterion reached" : "below +2°C"}`
            : "Awaiting a post-report TDZ05 value"}
        </strong>
      </div>
      <p className={styles.cardNote}>
        A rise of {TEMPERATURE_SPECIAL_THRESHOLD_C}°C or more is a documented
        local special-report criterion. SENEAM&apos;s 2019 observer procedure
        placed it in its special-report/SPECI workflow, but the current circular
        does not guarantee that every temperature alert becomes a publicly
        distributed SPECI.
        {lastAt ? ` Last observed ${formatAge(lastAt, nowMs)}.` : ""}
      </p>
      <div className={styles.watchMeta}>
        <span>Last report</span>
        <b>
          {baseline
            ? `${baseline.reportType} · ${formatTemperature(baseline.tempC, 0)}`
            : "unavailable"}
        </b>
        <span>Latest TDZ05</span>
        <b>
          {latestTdz
            ? `${formatTemperature(latestTdz.tempC, 0)} · ${formatAge(latestTdz.at, nowMs)}`
            : "unavailable"}
        </b>
      </div>
    </section>
  );
}

function TemperatureCard({
  label,
  value,
  at,
  observedAt,
  detail,
  tone = "cyan",
  digits = 1,
}) {
  return (
    <article
      className={`${styles.temperatureCard} ${styles[`temperature${tone}`]}`}
    >
      <div className={styles.cardEyebrowRow}>
        <p className={styles.eyebrow}>{label}</p>
        <span className={styles.signalDot} aria-hidden="true" />
      </div>
      <strong className={styles.bigTemperature}>
        {formatTemperature(value, digits)}
      </strong>
      <p>{detail}</p>
      <dl className={styles.microTimes}>
        <div>
          <dt>Measurement</dt>
          <dd>{formatDateTime(at)}</dd>
        </div>
        <div>
          <dt>First observed by us</dt>
          <dd>{formatDateTime(observedAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

function ForecastCard({
  label,
  forecast,
  accent,
  nowMs,
  targetDate,
  collectorStatus,
  nextCheckAt,
  availability,
  sourceAttribution,
  sourceLink,
  onRefresh,
  refreshLabel,
  refreshing = false,
  refreshDisabled = false,
  refreshMessage = "",
  loading = false,
  digits = 0,
}) {
  const available = Number.isFinite(forecast.current);
  const changed = Number.isFinite(forecast.delta) && forecast.delta !== 0;
  const lastAttemptAt = firstFinite(
    collectorStatus?.lastAttemptAt,
    collectorStatus?.updatedAt,
  );
  const collectorLeaseMs =
    FORECAST_COLLECTOR_LEASE_MS[collectorStatus?.source] ?? null;
  const collectorFetchingReported = collectorStatus?.status === "fetching";
  const collectorFetching =
    collectorFetchingReported &&
    (!Number.isFinite(lastAttemptAt) ||
      !Number.isFinite(nowMs) ||
      !Number.isFinite(collectorLeaseMs) ||
      nowMs < lastAttemptAt + collectorLeaseMs);
  const collectorLeaseExpired = collectorFetchingReported && !collectorFetching;
  const collectorError = collectorStatus?.status === "error";
  const busy = loading || refreshing || collectorFetching;
  const lastSuccessfulFetchAt = firstFinite(
    collectorStatus?.lastSuccessAt,
    forecast.forecastCapturedAt,
  );
  const rawLastAttemptStatus = exactString(collectorStatus?.status)?.replaceAll(
    "_",
    " ",
  );
  const lastAttemptStatus = collectorLeaseExpired
    ? "fetching lease expired"
    : rawLastAttemptStatus;
  const history = (forecast.history || []).slice(-6);
  const statusLabel = loading
    ? "loading forecast"
    : refreshing || collectorFetching
      ? "fetching"
      : collectorLeaseExpired
        ? "fetch lease expired"
        : collectorError
          ? "fetch error"
          : !available
            ? "awaiting forecast"
            : changed
              ? "changed"
              : "no recorded change";
  const transitionLabel = changed
    ? `Forecast changed from ${formatTemperature(forecast.previous, digits)} to ${formatTemperature(forecast.current, digits)}; first seen at ${formatDateTime(forecast.changedAt)}.`
    : null;
  return (
    <article
      className={`${styles.forecastCard} ${changed ? styles.forecastCardChanged : ""}`}
      style={{ "--forecast-accent": accent }}
      aria-busy={busy}
    >
      <div className={styles.cardEyebrowRow}>
        <p className={styles.eyebrow}>{label}</p>
        <StatusPill
          tone={
            busy
              ? "live"
              : collectorError
                ? "danger"
                : collectorLeaseExpired || changed || !available
                  ? "watch"
                  : "muted"
          }
        >
          {statusLabel}
        </StatusPill>
      </div>
      {sourceAttribution ? (
        <p className={styles.forecastAttribution}>{sourceAttribution}</p>
      ) : null}
      <div className={styles.forecastValue}>
        <strong>{formatTemperature(forecast.current, digits)}</strong>
        <span className={changed ? styles.deltaChanged : styles.deltaQuiet}>
          {Number.isFinite(forecast.delta)
            ? formatSignedTemperature(forecast.delta)
            : "no baseline"}
        </span>
      </div>
      {availability ? (
        <div className={styles.forecastAvailability}>
          <span>{availability.label}</span>
          <strong>
            {Number.isFinite(availability.targetAt)
              ? formatCountdown(availability.targetAt, nowMs)
              : availability.value}
          </strong>
          {availability.detail ? <small>{availability.detail}</small> : null}
        </div>
      ) : null}
      {changed ? (
        <div className={styles.revisionTransition} aria-label={transitionLabel}>
          <div>
            <span>Previous</span>
            <strong>{formatTemperature(forecast.previous, digits)}</strong>
          </div>
          <span className={styles.revisionArrow} aria-hidden="true">
            →
          </span>
          <div>
            <span>Now</span>
            <strong>{formatTemperature(forecast.current, digits)}</strong>
          </div>
          <small>First seen changed {formatDateTime(forecast.changedAt)}</small>
        </div>
      ) : null}
      {history.length ? (
        <div className={styles.forecastHistory}>
          <span>Retained revision trail</span>
          <div
            className={styles.revisionRail}
            role="list"
            tabIndex={0}
            aria-label={`Retained revision history for ${label}`}
          >
            {history.map((revision, index) => (
              <div
                className={styles.revisionPoint}
                key={revision.key}
                role="listitem"
                title={formatDateTime(revision.at)}
              >
                <i aria-hidden="true" />
                <strong>{formatTemperature(revision.tempC, digits)}</strong>
                <time dateTime={new Date(revision.at).toISOString()}>
                  {index === 0 && history.length === 1 ? "First seen " : ""}
                  {formatCompactDateTime(revision.at)}
                </time>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <dl className={styles.forecastMeta}>
        <div>
          <dt>Provider issued / updated</dt>
          <dd>
            {Number.isFinite(forecast.providerIssuedAt)
              ? formatDateTime(forecast.providerIssuedAt)
              : "Not supplied"}
          </dd>
        </div>
        <div>
          <dt>Current snapshot captured</dt>
          <dd>{formatDateTime(forecast.forecastCapturedAt)}</dd>
        </div>
        <div>
          <dt>Last data-bearing fetch</dt>
          <dd>
            {formatDateTime(lastSuccessfulFetchAt)}
            {Number.isFinite(lastSuccessfulFetchAt) ? (
              <small>{formatAge(lastSuccessfulFetchAt, nowMs)}</small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Latest fetch attempt</dt>
          <dd>
            {lastAttemptStatus ? `${lastAttemptStatus} · ` : ""}
            {formatDateTime(lastAttemptAt)}
            {Number.isFinite(lastAttemptAt) ? (
              <small>{formatAge(lastAttemptAt, nowMs)}</small>
            ) : null}
          </dd>
        </div>
        {Number.isFinite(nextCheckAt) ? (
          <div>
            <dt>Next scheduled attempt</dt>
            <dd>{formatCountdown(nextCheckAt, nowMs)}</dd>
          </div>
        ) : null}
        {Number.isFinite(forecast.changedAt) ? (
          <div>
            <dt>Current value first seen</dt>
            <dd>{formatDateTime(forecast.changedAt)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Target date</dt>
          <dd>{targetDate || "today"}</dd>
        </div>
        <div>
          <dt>Forecast peak</dt>
          <dd>{formatDateTime(forecast.forecastPeakTimeUtc)}</dd>
        </div>
      </dl>
      {onRefresh || sourceLink ? (
        <div className={styles.forecastActions}>
          {onRefresh ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={onRefresh}
              disabled={refreshDisabled || busy}
              aria-label={`${refreshLabel || "Fetch latest forecast"}${targetDate ? ` for ${targetDate}` : ""}`}
            >
              {refreshing ? "Fetching…" : refreshLabel || "Fetch latest"}
            </button>
          ) : null}
          {sourceLink ? (
            <a
              className={styles.forecastSourceLink}
              href={sourceLink.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${sourceLink.label} (opens in new tab)`}
            >
              {sourceLink.label} <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>
      ) : null}
      {refreshMessage ? (
        <p className={styles.forecastRefreshMessage} aria-live="polite">
          {refreshMessage}
        </p>
      ) : null}
    </article>
  );
}

function nextDayTafAvailability(forecast, window, nowMs) {
  if (Number.isFinite(forecast?.current)) {
    return {
      label: "Next-day TAF TX",
      value: "available now",
      detail: "Official airport guidance is available for the target date.",
    };
  }
  if (!Number.isFinite(window?.startAt) || !Number.isFinite(nowMs)) {
    return {
      label: "Next-day TAF TX",
      value: "awaiting data",
      detail: "The app is waiting for an eligible MMMX TAF maximum group.",
    };
  }
  if (nowMs < window.startAt) {
    return {
      label: "Estimated issue window in",
      targetAt: window.startAt,
      detail:
        "Recent 00Z cycles have supplied tomorrow’s TX around 17:00–18:00 Mexico City time; this is an estimate, not a deadline.",
    };
  }
  if (nowMs <= window.endAt) {
    return {
      label: "Estimated issue window",
      value: "open now",
      detail:
        "The app checks AWC every five minutes for the next eligible MMMX TAF TX.",
    };
  }
  return {
    label: "Estimated issue window",
    value: "passed",
    detail:
      "No eligible next-day TX has been captured yet; automatic five-minute checks continue.",
  };
}

function nextDaySmnAvailability(forecast, coverage) {
  if (Number.isFinite(forecast?.current) && coverage?.status === "complete") {
    return {
      label: "Next-day municipal guidance",
      value: "available now",
      detail: `Derived from all ${coverage.hourCount} retained hourly temperatures for Venustiano Carranza.`,
    };
  }
  if (Number.isFinite(forecast?.current)) {
    return {
      label: "Next-day municipal guidance",
      value: "partial coverage",
      detail: `${coverage?.hourCount ?? "Some"} of ${coverage?.expectedHourCount ?? 24} expected hourly temperatures are retained; the displayed maximum is provisional.`,
    };
  }
  return {
    label: "Next-day municipal guidance",
    value: "awaiting data",
    detail: "The hourly SMN collector checks again at :20 each hour.",
  };
}

function ImageCard({ tdz, image, fallbackObservation, nowMs }) {
  const url = capmaImageUrl(image?.path || image?.imagePath || image?.urlPath);
  const capturedAt = firstFinite(
    image?.screenTimeUtc,
    image?.capturedAt,
    fallbackObservation?.screenTimeUtc,
  );
  const fetchedAt = firstFinite(
    image?.fetchCompletedAt,
    image?.fetchedAt,
    image?.firstSeenAt,
    image?.updatedAt,
  );
  const tempC = firstFinite(
    image?.currentTempC,
    image?.tempC,
    fallbackObservation?.currentTempC,
  );
  const twoMinuteTempC = firstFinite(
    image?.twoMinuteTempC,
    fallbackObservation?.twoMinuteTempC,
  );
  const dewpointC = firstFinite(
    image?.dewpointC,
    fallbackObservation?.dewpointC,
  );
  const humidityPercent = firstFinite(
    image?.humidityPercent,
    fallbackObservation?.humidityPercent,
  );
  const stationPressureHpa = firstFinite(
    image?.stationPressureHpa,
    fallbackObservation?.stationPressureHpa,
  );
  const qnhInHg = firstFinite(image?.qnhInHg, fallbackObservation?.qnhInHg);
  const twoMinuteDewpointC = firstFinite(
    image?.twoMinuteDewpointC,
    fallbackObservation?.twoMinuteDewpointC,
  );
  return (
    <figure className={styles.imageCard}>
      <figcaption>
        <div>
          <p className={styles.eyebrow}>CAPMA · TDZ {tdz}</p>
          <strong>{formatTemperature(tempC, 0)}</strong>
        </div>
        <StatusPill tone={url ? "live" : "muted"}>
          {url ? formatAge(capturedAt, nowMs) : "no image"}
        </StatusPill>
      </figcaption>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          referrerPolicy="no-referrer"
          className={styles.imageLink}
          aria-label={`Open latest CAPMA TDZ ${tdz} display image at full size`}
        >
          {/* Approved same-origin Convex image proxy; raw image preserves the source frame exactly. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Latest approved CAPMA TDZ ${tdz} runway weather display`}
            width={image?.imageWidth || 1366}
            height={image?.imageHeight || 768}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        </a>
      ) : (
        <div
          className={styles.imagePlaceholder}
          aria-label={`No TDZ ${tdz} image available`}
        >
          <span>TDZ {tdz}</span>
          <small>Image unavailable</small>
        </div>
      )}
      <dl className={styles.imageMeta}>
        <div>
          <dt>Whole-degree TDZ display</dt>
          <dd>{formatTemperature(tempC, 0)}</dd>
        </div>
        <div>
          <dt>2-minute display</dt>
          <dd>{formatTemperature(twoMinuteTempC, 0)}</dd>
        </div>
        <div>
          <dt>Dew point display</dt>
          <dd>
            {formatTemperature(dewpointC, 0)}
            {Number.isFinite(twoMinuteDewpointC)
              ? ` · 2-min ${formatTemperature(twoMinuteDewpointC, 0)}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Humidity display</dt>
          <dd>
            {Number.isFinite(humidityPercent) ? `${humidityPercent}%` : "—"}
          </dd>
        </div>
        <div>
          <dt>Pressure display</dt>
          <dd>
            {Number.isFinite(stationPressureHpa)
              ? `${stationPressureHpa.toFixed(1)} hPa`
              : "—"}
            {Number.isFinite(qnhInHg)
              ? ` · QNH ${qnhInHg.toFixed(2)} inHg`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Screen time</dt>
          <dd>{formatDateTime(capturedAt)}</dd>
        </div>
        <div>
          <dt>Fetched by us</dt>
          <dd>{formatDateTime(fetchedAt)}</dd>
        </div>
      </dl>
    </figure>
  );
}

function MarketLadder({
  market,
  quotes,
  selectedId,
  onSelect,
  nowMs,
  onRefresh,
  refreshing,
  browserStream,
}) {
  const event = market?.event || market?.market || {};
  const stream =
    market?.collectorStatus || market?.streamStatus || market?.status || {};
  const collection = market?.collection || {};
  const latestUpdate = latestFinite(
    browserStream?.lastMessageAt,
    stream?.lastMessageAt,
    stream?.lastSuccessAt,
    ...quotes.map((quote) => eventEpoch(quote)),
  );
  const stale =
    !Number.isFinite(latestUpdate) ||
    nowMs - latestUpdate > MARKET_STALE_AFTER_MS;
  const disabled =
    collection.enabled === false ||
    ["disabled", "approval_required", "setup_required"].includes(
      String(
        collection?.status || stream?.status || market?.freshness || "",
      ).toLowerCase(),
    );
  const browserLive = browserStream?.status === "live";
  const browserTransitioning = [
    "connecting",
    "connected_waiting",
    "reconnecting",
  ].includes(browserStream?.status);
  const title =
    event.eventTitle ||
    event.title ||
    event.question ||
    "Mexico City daily high";
  const eventUrl = safeHttpsUrl(event.eventUrl);
  return (
    <section className={styles.panel} aria-labelledby="market-ladder-title">
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Polymarket · live order books</p>
          <h2 id="market-ladder-title">Daily-high probability ladder</h2>
          <p>
            {eventUrl ? (
              <a
                className={styles.eventLink}
                href={eventUrl}
                target="_blank"
                rel="noreferrer"
              >
                {title} ↗
              </a>
            ) : (
              title
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          <StatusPill
            tone={
              disabled
                ? "muted"
                : browserLive
                  ? "live"
                  : browserTransitioning || stale
                    ? "watch"
                    : "neutral"
            }
          >
            {disabled
              ? "collection disabled"
              : browserLive
                ? "browser live · session-only"
                : browserStream?.status === "connected_waiting"
                  ? "browser connected · waiting for tick"
                  : browserTransitioning
                    ? `browser ${browserStream.status}`
                    : stale
                      ? "REST snapshot stale"
                      : "REST snapshot"}
          </StatusPill>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh market"}
          </button>
        </div>
      </header>
      <div className={styles.marketMeta}>
        <span>
          Newest quote <b>{formatDateTime(latestUpdate)}</b>
        </span>
        <span>
          Age <b>{formatAge(latestUpdate, nowMs)}</b>
        </span>
        <span>
          Durable transport{" "}
          <b>
            {String(market?.transport?.active || "REST polling").replaceAll(
              "_",
              " ",
            )}
          </b>
        </span>
        <span>
          Browser stream{" "}
          <b>
            {String(browserStream?.status || "unavailable").replaceAll(
              "_",
              " ",
            )}
          </b>
        </span>
        <span>
          Collection{" "}
          <b>
            {disabled
              ? `${String(collection.status || "disabled").replaceAll("_", " ")} · ${collection.flagName || "server flag"}`
              : String(collection.status || "enabled").replaceAll("_", " ")}
          </b>
        </span>
        <span>
          Bounds{" "}
          <b>
            {firstPresent(
              event.boundsLabel,
              event.rangeLabel,
              "from event metadata",
            )}
          </b>
        </span>
      </div>
      {quotes.length ? (
        <div className={styles.tableScroller}>
          <table className={styles.marketTable}>
            <thead>
              <tr>
                <th scope="col">High bucket</th>
                <th scope="col">Displayed</th>
                <th scope="col">Best bid</th>
                <th scope="col">Best ask</th>
                <th scope="col">Last</th>
                <th scope="col">Spread</th>
                <th scope="col">Tick</th>
                <th scope="col">Quote time</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote, index) => {
                const id = quoteId(quote, index);
                const selected = id === selectedId;
                return (
                  <tr
                    key={id}
                    className={selected ? styles.selectedMarketRow : undefined}
                  >
                    <th scope="row">
                      <button
                        type="button"
                        className={styles.bucketButton}
                        onClick={() => onSelect(id)}
                        aria-pressed={selected}
                      >
                        <span aria-hidden="true" />
                        {quoteLabel(quote, index)}
                      </button>
                    </th>
                    <td className={styles.probabilityCell}>
                      <strong>
                        {quotePercent(quote, "probability") || "—"}
                      </strong>
                      <small>
                        {quote.browserSessionLive
                          ? "browser live"
                          : String(
                              quote.platformDisplaySource || "fallback",
                            ).replaceAll("_", " ")}
                      </small>
                    </td>
                    <td>{quotePercent(quote, "bid") || "—"}</td>
                    <td>{quotePercent(quote, "ask") || "—"}</td>
                    <td>{quotePercent(quote, "last") || "—"}</td>
                    <td>{quotePercent(quote, "spread") || "—"}</td>
                    <td>{exactString(quote.tickSize) || "—"}</td>
                    <td>
                      <time
                        dateTime={
                          Number.isFinite(eventEpoch(quote))
                            ? new Date(eventEpoch(quote)).toISOString()
                            : undefined
                        }
                      >
                        {formatClock(eventEpoch(quote), MEXICO_TIMEZONE)}
                      </time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No live buckets yet"
          detail={
            disabled
              ? `Collection disabled — enable ${collection.flagName || "the server-side collection flag"}. No live values are fabricated.`
              : "Market discovery or the CLOB order-book poll has not produced quote state. The UI will render whatever bucket count the event returns."
          }
        />
      )}
      <footer className={styles.marketFooter}>
        Exact decimal strings are preserved from the live adapter. “Displayed”
        follows the documented market-price rule; bid, ask, and last remain
        separate. Browser WebSocket ticks are session-only; durable history is
        the REST snapshot collector.
      </footer>
    </section>
  );
}

function linePath(points, xFor, yFor) {
  return points
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${xFor(point).toFixed(2)} ${yFor(point).toFixed(2)}`,
    )
    .join(" ");
}

function stepAfterPath(points, xFor, yFor, coverageEndAt = null) {
  if (!points?.length) {
    return "";
  }
  const commands = [
    `M ${xFor(points[0]).toFixed(2)} ${yFor(points[0]).toFixed(2)}`,
  ];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    commands.push(
      `L ${xFor(current).toFixed(2)} ${yFor(previous).toFixed(2)}`,
      `L ${xFor(current).toFixed(2)} ${yFor(current).toFixed(2)}`,
    );
  }
  const finalPoint = points.at(-1);
  if (Number.isFinite(coverageEndAt) && coverageEndAt > finalPoint.at) {
    commands.push(
      `L ${xFor({ at: coverageEndAt }).toFixed(2)} ${yFor(finalPoint).toFixed(2)}`,
    );
  }
  return commands.join(" ");
}

function reactionTimelineTicks(minAt, maxAt) {
  const durationMs = Math.max(0, maxAt - minAt);
  const intervals = [
    15 * 60 * 1000,
    30 * 60 * 1000,
    60 * 60 * 1000,
    2 * 60 * 60 * 1000,
    3 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
  ];
  const intervalMs =
    intervals.find((candidate) => durationMs / candidate <= 12) ||
    intervals.at(-1);
  const ticks = [];
  for (
    let at = Math.ceil(minAt / intervalMs) * intervalMs;
    at <= maxAt;
    at += intervalMs
  ) {
    ticks.push(at);
  }
  return ticks.length ? ticks : [minAt, maxAt];
}

function ReactionChart({
  temperatures,
  quoteObservations,
  signalKey,
  sourceEvents,
  bucketLabel,
  date,
  domainStartAt,
  domainEndAt,
}) {
  const chartScrollRef = useRef(null);
  const temperatureSeries = groupTemperatureSeries(temperatures);
  const marketSeries = reactionChartSeries(quoteObservations, signalKey);
  const marketCoverageEndAt = latestFinite(
    ...selectReactionSignal(quoteObservations, signalKey).map(
      (point) => point.at,
    ),
  );
  const marketPoints = marketSeries.flatMap((series) => series.points);
  const displayTransitions =
    signalKey === "display"
      ? platformDisplayTransitions(quoteObservations)
      : [];
  const allEpochs = [
    ...temperatures.map((point) => point.at),
    ...marketPoints.map((point) => point.at),
    ...displayTransitions.map((point) => point.at),
    ...sourceEvents.map((point) => point.at),
  ].filter(Number.isFinite);
  if (!allEpochs.length) {
    return (
      <EmptyState
        title="Reaction history is accumulating"
        detail="Temperature, quote, and source-arrival events will share one time axis as soon as they are captured."
      />
    );
  }
  const rawMin = Math.min(...allEpochs);
  const rawMax = Math.max(...allEpochs);
  const pad = Math.max(60 * 1000, (rawMax - rawMin) * 0.03);
  const explicitDomain =
    Number.isFinite(domainStartAt) &&
    Number.isFinite(domainEndAt) &&
    domainEndAt > domainStartAt;
  const minAt = explicitDomain ? domainStartAt : rawMin - pad;
  const maxAt = explicitDomain ? domainEndAt : rawMax + pad;
  const left = 68;
  const pixelsPerHour = 120;
  const width = Math.max(
    1180,
    Math.ceil(((maxAt - minAt) / (60 * 60 * 1000)) * pixelsPerHour) + left + 48,
  );
  const right = width - 28;
  const tempTop = 35;
  const tempBottom = 132;
  const probTop = 178;
  const probBottom = 275;
  const tempValues = temperatures.map((point) => point.tempC);
  const tempMin = tempValues.length
    ? Math.floor(Math.min(...tempValues) - 1)
    : 0;
  const tempMax = tempValues.length
    ? Math.ceil(Math.max(...tempValues) + 1)
    : 1;
  const xFor = (point) =>
    left + ((point.at - minAt) / (maxAt - minAt || 1)) * (right - left);
  const tempY = (point) =>
    tempBottom -
    ((point.tempC - tempMin) / (tempMax - tempMin || 1)) *
      (tempBottom - tempTop);
  const probY = (point) =>
    probBottom - (point.probabilityPct / 100) * (probBottom - probTop);
  const ticks = reactionTimelineTicks(minAt, maxAt);
  const panChart = (direction) => {
    const element = chartScrollRef.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(320, element.clientWidth * 0.8),
      behavior: "smooth",
    });
  };
  const scrollChartTo = (position) => {
    const element = chartScrollRef.current;
    if (!element) return;
    const leftPosition =
      position === "start"
        ? 0
        : Math.min(
            element.scrollWidth - element.clientWidth,
            Math.max(0, xFor({ at: rawMax }) - element.clientWidth + 96),
          );
    element.scrollTo({ left: leftPosition, behavior: "smooth" });
  };
  return (
    <>
      <div className={styles.reactionChartToolbar}>
        <span>
          Scroll left to right to follow {bucketLabel} through {date}.
        </span>
        <div aria-label="Reaction chart navigation">
          <button type="button" onClick={() => scrollChartTo("start")}>
            Start
          </button>
          <button type="button" onClick={() => panChart(-1)}>
            ← Earlier
          </button>
          <button type="button" onClick={() => panChart(1)}>
            Later →
          </button>
          <button type="button" onClick={() => scrollChartTo("latest")}>
            Latest
          </button>
        </div>
      </div>
      <div
        ref={chartScrollRef}
        className={styles.chartWrap}
        tabIndex={0}
        aria-label={`Scrollable ${date || "selected-day"} probability and TDZ 05 timing chart`}
      >
        <svg
          className={styles.reactionChart}
          viewBox={`0 0 ${width} 320`}
          style={{ width: `${width}px` }}
          role="img"
          aria-labelledby="reaction-chart-title reaction-chart-description"
        >
          <title id="reaction-chart-title">
            Temperature and {bucketLabel} market evidence on {date}
          </title>
          <desc id="reaction-chart-description">
            Two aligned plots share a Mexico City time axis. METAR or SPECI and
            CAPMA TDZ 05 are separate temperature series. The selected
            Polymarket probability is shown as a step-after chart.
            Browser-session points remain visual only. Source arrival markers
            indicate when this system first observed each artifact and do not
            establish causation.
          </desc>
          <defs>
            <linearGradient
              id="edge-market-gradient"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0" stopColor="#ffb547" />
              <stop offset="1" stopColor="#ff5c7a" />
            </linearGradient>
          </defs>
          {[tempTop, tempBottom, probTop, probBottom].map((y) => (
            <line
              key={y}
              x1={left}
              y1={y}
              x2={right}
              y2={y}
              className={styles.chartGrid}
            />
          ))}
          {ticks.map((at) => (
            <g key={at}>
              <line
                x1={xFor({ at })}
                y1={tempTop}
                x2={xFor({ at })}
                y2={probBottom}
                className={styles.chartGridVertical}
              />
              <text
                x={xFor({ at })}
                y="306"
                textAnchor="middle"
                className={styles.chartTick}
              >
                {formatClock(at, MEXICO_TIMEZONE)}
              </text>
            </g>
          ))}
          <text x="12" y="51" className={styles.chartAxisLabel}>
            TEMP °C
          </text>
          <text x="12" y="194" className={styles.chartAxisLabel}>
            MARKET %
          </text>
          <text
            x="58"
            y={tempTop + 4}
            textAnchor="end"
            className={styles.chartTick}
          >
            {tempMax}°
          </text>
          <text
            x="58"
            y={tempBottom + 4}
            textAnchor="end"
            className={styles.chartTick}
          >
            {tempMin}°
          </text>
          <text
            x="58"
            y={probTop + 4}
            textAnchor="end"
            className={styles.chartTick}
          >
            100
          </text>
          <text
            x="58"
            y={probBottom + 4}
            textAnchor="end"
            className={styles.chartTick}
          >
            0
          </text>
          {sourceEvents.map((event) => (
            <g key={event.id}>
              <line
                x1={xFor(event)}
                y1={tempTop}
                x2={xFor(event)}
                y2={probBottom}
                className={styles.sourceMarker}
              />
              <circle
                cx={xFor(event)}
                cy="151"
                r="4"
                className={styles.sourceMarkerDot}
              >
                <title>{`${event.source || "Source"} · first observed ${formatDateTime(event.at)}${event.maximumEvent ? ` · new max ${formatTemperature(event.tempC)}` : ""}`}</title>
              </circle>
            </g>
          ))}
          {temperatureSeries.map((series) => {
            const connectedPoints = series.points.filter(
              (point) => point?.sparseAuditMarker !== true,
            );
            return (
              <g key={series.key}>
                {connectedPoints.length > 1 && (
                  <path
                    d={linePath(connectedPoints, xFor, tempY)}
                    className={styles.temperatureLine}
                    style={{ stroke: series.color }}
                  />
                )}
                {series.points.map((point) => (
                  <circle
                    key={`${series.key}-${point.id}`}
                    cx={xFor(point)}
                    cy={tempY(point)}
                    r={point.sparseAuditMarker ? "4.5" : "3.5"}
                    className={styles.temperaturePoint}
                    style={{ fill: series.color }}
                  >
                    <title>{`${series.label} · ${formatTemperature(point.tempC)} · ${formatDateTime(point.at)}${point.sparseAuditMarker ? " · coverage-qualified daily-maximum audit marker" : ""}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
          {marketSeries.map((series) => (
            <g key={series.key}>
              {series.points.length > 0 && (
                <path
                  d={stepAfterPath(
                    series.points,
                    xFor,
                    probY,
                    Math.min(marketCoverageEndAt, maxAt),
                  )}
                  className={styles.probabilityLine}
                  style={{ stroke: series.color }}
                />
              )}
              {series.points.map((point) => (
                <circle
                  key={`${series.key}-${point.id}`}
                  cx={xFor(point)}
                  cy={probY(point)}
                  r="3.5"
                  className={
                    point.sessionOnly
                      ? styles.browserProbabilityPoint
                      : styles.probabilityPoint
                  }
                  style={point.sessionOnly ? undefined : { fill: series.color }}
                >
                  <title>{`${series.label} · ${point.probabilityPct.toFixed(2)}% · first detected ${formatDateTime(point.at)} · ${point.sessionOnly ? "browser session only; excluded from durable timing" : "durable server poll"}`}</title>
                </circle>
              ))}
            </g>
          ))}
          {displayTransitions.map((point) => {
            const x = xFor(point);
            const y = probY(point);
            return (
              <polygon
                key={`display-transition-${point.id}-${point.from}-${point.to}`}
                points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`}
                className={styles.displayTransitionPoint}
              >
                <title>{`Platform display source switched from ${point.from} to ${point.to} · ${formatDateTime(point.at)}`}</title>
              </polygon>
            );
          })}
        </svg>
      </div>
    </>
  );
}

function formatProbabilityValue(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function formatReactionSnapshot(snapshot) {
  if (!snapshot) {
    return "—";
  }
  if (snapshot.noTrades) {
    return "no trades yet";
  }
  if (snapshot.signalKey === "bbo") {
    return `bid ${formatProbabilityValue(snapshot.bidPct)} · ask ${formatProbabilityValue(snapshot.askPct)}`;
  }
  return formatProbabilityValue(snapshot.valuePct);
}

function formatReactionDelta(delta) {
  const signed = (value) =>
    Number.isFinite(value)
      ? `${value > 0 ? "+" : ""}${value.toFixed(2)} pp`
      : "—";
  if (delta && typeof delta === "object") {
    return `bid ${signed(delta.bid)} · ask ${signed(delta.ask)}`;
  }
  return signed(delta);
}

function reactionHasDelta(delta) {
  return delta && typeof delta === "object"
    ? [delta.bid, delta.ask].some(
        (value) => Number.isFinite(value) && value !== 0,
      )
    : Number.isFinite(delta) && delta !== 0;
}

function formatOutwardSeconds(milliseconds, side) {
  if (!Number.isFinite(milliseconds)) {
    return null;
  }
  const seconds =
    side === "lower"
      ? Math.floor(milliseconds / 1000)
      : Math.ceil(milliseconds / 1000);
  return `${seconds > 0 ? "+" : ""}${seconds}s`;
}

function intervalText(startAt, endAt, sourceAt) {
  if (!Number.isFinite(endAt) || !Number.isFinite(sourceAt)) {
    return "interval unavailable";
  }
  const upper = formatOutwardSeconds(endAt - sourceAt, "upper");
  if (!Number.isFinite(startAt)) {
    return `(-∞, ${upper}]`;
  }
  const lower = formatOutwardSeconds(startAt - sourceAt, "lower");
  return `(${lower}, ${upper}]`;
}

function reactionIntervalHeadline(row) {
  if (Number.isFinite(row?.detectionEndAt)) {
    return intervalText(row.detectionStartAt, row.detectionEndAt, row.at);
  }
  if (row?.intervalStatus === "baseline_unavailable") {
    return "baseline unavailable · no pre-source state";
  }
  if (row?.intervalStatus === "waiting") {
    return "waiting for a changed state";
  }
  return "interval unavailable";
}

function orderingLabel(ordering) {
  const labels = {
    ordering_indeterminate: "ordering indeterminate · interval crosses source",
    compatible_after: "compatible with an update after source",
    left_censored: "left-censored · insufficient prior poll baseline",
    no_compatible_update_observed: "no compatible later update detected",
  };
  return labels[ordering] || "ordering unavailable";
}

function boundaryEvidenceLabel(evidence) {
  const labels = {
    heartbeat_bounded: "bounded by consecutive durable poll heartbeats",
    legacy_left_censored:
      "legacy changed-event evidence · no successful-poll lower bound",
    persisted_bounded: "persisted consecutive-poll bounds",
    persisted_left_unbounded: "left-censored · no lower poll boundary",
  };
  return labels[evidence] || "durable poll boundary";
}

function displaySourceLabel(value) {
  const labels = {
    last_trade: "last trade",
    midpoint: "midpoint",
    gamma_outcome: "Gamma metadata",
    unavailable: "unavailable",
  };
  return labels[value] || String(value || "unavailable").replaceAll("_", " ");
}

function shortList(values) {
  if (values.length < 2) {
    return values[0] || "";
  }
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function tdzCoverageReason(reason) {
  const labels = {
    approval_required: "approval required",
    truncated: "history truncated",
    partial: "partial daily coverage",
    stale: "live coverage is stale",
  };
  return labels[reason] || String(reason || "unavailable").replaceAll("_", " ");
}

function ReactionExplorer({
  temperatures,
  quoteObservations,
  durableQuoteObservations,
  sourceEvents,
  heartbeatHistory,
  heartbeatApprovals,
  predecessorHeartbeat,
  officialDailyMaximumEvidence,
  tdzDailyMaximumEvidence,
  bucketLabel,
  nowMs,
  date,
  maxDate,
  availableQuotes,
  selectedQuoteId,
  onDateChange,
  onBucketChange,
  historyLoading,
}) {
  const [requestedWindow, setRequestedWindow] = useState("all");
  const [signalKey, setSignalKey] = useState("display");
  const selectedSignal =
    REACTION_SIGNAL_OPTIONS.find((option) => option.key === signalKey) ||
    REACTION_SIGNAL_OPTIONS[0];
  const heartbeatStatus = String(
    heartbeatHistory?.status || heartbeatApprovals?.publicStatus || "",
  ).toLowerCase();
  const heartbeatApprovalRequired =
    heartbeatStatus.endsWith("_approval_required") ||
    heartbeatApprovals?.publicEnabled !== true;
  const heartbeatRequiredFlagNames = [
    ...(heartbeatHistory?.requiredFlagNames || []),
    heartbeatApprovals?.access?.flagName,
    heartbeatApprovals?.retention?.flagName,
    heartbeatApprovals?.public?.flagName,
  ].filter(
    (flagName, index, values) =>
      Boolean(flagName) && values.indexOf(flagName) === index,
  );
  const selectedSignalPoints = useMemo(
    () => selectReactionSignal(quoteObservations, signalKey),
    [quoteObservations, signalKey],
  );
  const evidenceEpochs = [
    ...temperatures.map((point) => point.at),
    ...selectedSignalPoints.map((point) => point.at),
    ...sourceEvents.map((point) => point.at),
  ].filter(Number.isFinite);
  const liveDate = Number.isFinite(nowMs) ? mexicoDateKey(nowMs) : "";
  const selectedDayIsLive = Boolean(date) && date === liveDate;
  const anchorAt = latestFinite(
    selectedDayIsLive ? nowMs : null,
    ...evidenceEpochs,
  );
  const selectedWindow = requestedWindow;
  const selectedDefinition =
    REACTION_WINDOWS.find((option) => option.key === selectedWindow) ||
    REACTION_WINDOWS.at(-1);
  const cutoffAt =
    Number.isFinite(anchorAt) && Number.isFinite(selectedDefinition?.durationMs)
      ? anchorAt - selectedDefinition.durationMs
      : null;
  const inSelectedWindow = useCallback(
    (point) => !Number.isFinite(cutoffAt) || point.at >= cutoffAt,
    [cutoffAt],
  );
  const dayBounds = useMemo(() => mexicoDayBounds(date), [date]);
  const chartDomainStartAt =
    selectedWindow === "all" ? dayBounds?.startAt : cutoffAt;
  const chartDomainEndAt =
    selectedWindow === "all"
      ? selectedDayIsLive
        ? Math.min(dayBounds?.endAt ?? nowMs, nowMs)
        : dayBounds?.endAt
      : anchorAt;
  const windowedTemperatures = useMemo(
    () => temperatures.filter(inSelectedWindow),
    [inSelectedWindow, temperatures],
  );
  const windowedQuoteObservations = useMemo(
    () => quoteObservations.filter(inSelectedWindow),
    [inSelectedWindow, quoteObservations],
  );
  const windowedSourceEvents = useMemo(
    () => sourceEvents.filter(inSelectedWindow),
    [inSelectedWindow, sourceEvents],
  );
  const visibleMarketSeries = useMemo(
    () => reactionChartSeries(windowedQuoteObservations, signalKey),
    [signalKey, windowedQuoteObservations],
  );
  const officialDailyCoverageComplete = officialDailyMaximumEvidenceComplete(
    officialDailyMaximumEvidence,
  );
  const tdzCoverageStates = useMemo(
    () => tdzDailySeriesStates(tdzDailyMaximumEvidence, nowMs),
    [nowMs, tdzDailyMaximumEvidence],
  );
  const includedTdzLabels = tdzCoverageStates
    .filter((series) => series.eligible)
    .map((series) => series.label);
  const excludedTdzStates = tdzCoverageStates.filter(
    (series) => !series.eligible,
  );
  const maximumSourceEvents = useMemo(
    () =>
      firstNewDailyMaximumEvents(sourceEvents, temperatures, {
        officialDailyMaximumEvidence,
        tdzDailyMaximumEvidence,
        nowMs,
      }),
    [
      nowMs,
      officialDailyMaximumEvidence,
      sourceEvents,
      tdzDailyMaximumEvidence,
      temperatures,
    ],
  );
  const certifiedTdzEventCount = maximumSourceEvents.filter((event) =>
    /^capma_tdz_/i.test(String(event?.series || event?.sourceKey || "")),
  ).length;
  const windowedMaximumEvents = useMemo(
    () => maximumSourceEvents.filter(inSelectedWindow),
    [inSelectedWindow, maximumSourceEvents],
  );
  const windowedTdzMaximumEvents = useMemo(
    () =>
      windowedMaximumEvents.filter((event) =>
        /^capma_tdz_/i.test(String(event?.series || event?.sourceKey || "")),
      ),
    [windowedMaximumEvents],
  );
  const chartTemperatures = useMemo(() => {
    const merged = windowedTemperatures.filter(
      (point) => !isCapmaTdz23Evidence(point),
    );
    const identities = new Set(
      merged.map(
        (point) => `${temperatureSeriesKey(point)}:${point.at}:${point.tempC}`,
      ),
    );
    for (const event of windowedTdzMaximumEvents) {
      if (isCapmaTdz23Evidence(event)) {
        continue;
      }
      const at = firstFinite(event?.measurementAt, event?.at);
      const series = String(event?.series || event?.sourceKey || "");
      const identity = `${series}:${at}:${event?.tempC}`;
      if (
        !Number.isFinite(at) ||
        !Number.isFinite(event?.tempC) ||
        identities.has(identity)
      ) {
        continue;
      }
      identities.add(identity);
      merged.push({
        ...event,
        id: `audit-temperature-${event.id}`,
        at,
        series,
        kind: "whole_degree_display",
        sparseAuditMarker: true,
      });
    }
    return merged.sort((left, right) => left.at - right.at);
  }, [windowedTdzMaximumEvents, windowedTemperatures]);
  const chartSourceEvents = useMemo(() => {
    const merged = windowedSourceEvents.filter(
      (event) => !isCapmaTdz23Evidence(event),
    );
    const identities = new Set(
      merged.map(
        (event) =>
          `${event?.series || event?.sourceKey || event?.source}:${event?.at}:${event?.rawHash || event?.id}`,
      ),
    );
    for (const event of windowedTdzMaximumEvents) {
      if (isCapmaTdz23Evidence(event)) {
        continue;
      }
      const identity = `${event?.series || event?.sourceKey || event?.source}:${event?.at}:${event?.rawHash || event?.id}`;
      if (!Number.isFinite(event?.at) || identities.has(identity)) {
        continue;
      }
      identities.add(identity);
      merged.push({ ...event, id: `audit-source-${event.id}` });
    }
    return merged.sort((left, right) => left.at - right.at);
  }, [windowedSourceEvents, windowedTdzMaximumEvents]);
  const visibleTemperatureSeries = useMemo(
    () => groupTemperatureSeries(chartTemperatures),
    [chartTemperatures],
  );
  const heartbeatSignalPoints = useMemo(
    () =>
      selectReactionSignal(
        durableQuoteObservations.filter(
          (row) =>
            row?.isHeartbeat === true ||
            /heartbeat/i.test(String(row?.eventType || "")),
        ),
        signalKey,
      ),
    [durableQuoteObservations, signalKey],
  );
  const heartbeatHistoryTruncated = heartbeatHistory?.truncated === true;
  const heartbeatHistoryAvailable = heartbeatSignalPoints.length > 0;
  const heartbeatCoverageStartAt = firstFinite(
    heartbeatHistory?.oldestReceivedAt,
  );
  const coverageEligibleMaximumEvents = useMemo(
    () =>
      heartbeatHistoryTruncated
        ? Number.isFinite(heartbeatCoverageStartAt)
          ? windowedMaximumEvents.filter(
              (event) => event.at >= heartbeatCoverageStartAt,
            )
          : []
        : windowedMaximumEvents,
    [
      heartbeatCoverageStartAt,
      heartbeatHistoryTruncated,
      windowedMaximumEvents,
    ],
  );
  const reactions = useMemo(
    () =>
      buildReactionIntervals(
        coverageEligibleMaximumEvents,
        durableQuoteObservations.map((row) =>
          !heartbeatHistoryAvailable && row?.isHeartbeat !== true
            ? { ...row, legacyLeftCensored: true }
            : row,
        ),
        signalKey,
      ),
    [
      coverageEligibleMaximumEvents,
      durableQuoteObservations,
      heartbeatHistoryAvailable,
      signalKey,
    ],
  );
  const visibleDisplayTransitions = useMemo(
    () =>
      signalKey === "display"
        ? platformDisplayTransitions(windowedQuoteObservations)
        : [],
    [signalKey, windowedQuoteObservations],
  );
  const omittedSourceEvents = Math.max(
    0,
    (officialDailyCoverageComplete ? sourceEvents.length : 0) +
      certifiedTdzEventCount -
      maximumSourceEvents.length,
  );
  const coverageExcludedEvents = Math.max(
    0,
    windowedMaximumEvents.length - coverageEligibleMaximumEvents.length,
  );
  const tdzCoverageNotice = includedTdzLabels.length
    ? excludedTdzStates.length
      ? `Coverage-qualified ${shortList(includedTdzLabels)} maximum events can produce source-specific reaction rows; ${shortList(
          excludedTdzStates.map(
            (series) => `${series.label} (${tdzCoverageReason(series.reason)})`,
          ),
        )} evidence is excluded from those rows.`
      : `Coverage-qualified ${shortList(includedTdzLabels)} maximum events can produce source-specific reaction rows.`
    : `${
        excludedTdzStates.length
          ? shortList(
              excludedTdzStates.map(
                (series) =>
                  `${series.label} (${tdzCoverageReason(series.reason)})`,
              ),
            )
          : `TDZ 05/23 (${String(
              tdzDailyMaximumEvidence?.status || "unavailable",
            ).replaceAll("_", " ")})`
      } evidence is excluded from reaction rows; no TDZ daily-maximum claim is made.`;
  const bucketOptions = (availableQuotes || []).map((quote, index) => ({
    id: quoteId(quote, index),
    label: quoteLabel(quote, index),
    probability: quotePercent(quote, "probability"),
  }));
  const selectedBucketValue = bucketOptions.some(
    (option) => option.id === selectedQuoteId,
  )
    ? selectedQuoteId
    : "";
  const historyReady = !historyLoading && bucketOptions.length > 0;
  return (
    <section className={styles.panel} aria-labelledby="reaction-title">
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Timing correlation · selected bucket</p>
          <h2 id="reaction-title">Temperature ↔ market reaction</h2>
          <p>{bucketLabel} · shared Mexico City time axis</p>
        </div>
        <div className={styles.reactionTools}>
          <div
            className={styles.reactionHistoryControls}
            aria-label="Reaction history selection"
          >
            <label>
              <span>Mexico City date</span>
              <input
                type="date"
                value={date || ""}
                max={maxDate || undefined}
                onChange={(event) => onDateChange(event.target.value)}
              />
            </label>
            <label>
              <span>Probability bucket</span>
              <select
                value={selectedBucketValue}
                disabled={!bucketOptions.length}
                onChange={(event) => onBucketChange(event.target.value)}
              >
                {!bucketOptions.length && (
                  <option value="">No probability data for this date</option>
                )}
                {bucketOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {option.probability
                      ? ` · latest ${option.probability}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.signalControl}>
            <span id="reaction-signal-label">Market signal</span>
            <div
              className={styles.signalButtons}
              role="group"
              aria-labelledby="reaction-signal-label"
              aria-describedby="reaction-signal-description"
            >
              {REACTION_SIGNAL_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={styles.signalButton}
                  aria-pressed={signalKey === option.key}
                  title={option.description}
                  onClick={() => setSignalKey(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <small id="reaction-signal-description">
              {selectedSignal.description}
            </small>
          </div>
          <div className={styles.windowControl}>
            <span id="reaction-window-label">Time window</span>
            <div
              className={styles.windowButtons}
              role="group"
              aria-labelledby="reaction-window-label"
            >
              {REACTION_WINDOWS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={styles.windowButton}
                  aria-pressed={selectedWindow === option.key}
                  onClick={() => setRequestedWindow(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {visibleTemperatureSeries.length ? (
              visibleTemperatureSeries.map((series) => (
                <span
                  key={series.key}
                  className={styles.legendTemperature}
                  style={{ "--legend-temperature": series.color }}
                >
                  {series.label}
                </span>
              ))
            ) : (
              <span className={styles.legendTemperature}>Temperature</span>
            )}
            {visibleMarketSeries.map((series) => (
              <span
                key={series.key}
                className={styles.legendMarket}
                style={{ "--legend-market": series.color }}
              >
                {series.label}
              </span>
            ))}
            {selectedDayIsLive && (
              <span className={styles.legendBrowser}>
                Browser tick · session-only
              </span>
            )}
            <span className={styles.legendSource}>Source first seen</span>
            {signalKey === "display" && (
              <span className={styles.legendDisplayTransition}>
                Display-rule source switch
              </span>
            )}
          </div>
        </div>
      </header>
      {historyLoading ? (
        <EmptyState
          title="Loading selected-day history"
          detail="The date-scoped weather and Polymarket evidence is being assembled."
        />
      ) : !bucketOptions.length ? (
        <EmptyState
          title="No probability data for this date"
          detail="Only buckets discovered for the selected Polymarket event are offered; unavailable temperatures are not synthesized."
        />
      ) : (
        <ReactionChart
          temperatures={chartTemperatures}
          quoteObservations={windowedQuoteObservations}
          signalKey={signalKey}
          sourceEvents={chartSourceEvents}
          bucketLabel={bucketLabel}
          date={date}
          domainStartAt={chartDomainStartAt}
          domainEndAt={chartDomainEndAt}
        />
      )}
      {visibleDisplayTransitions.length > 0 && (
        <div className={styles.displayTransitionList} aria-live="polite">
          <strong>Platform display-source switches</strong>
          <ul>
            {visibleDisplayTransitions.slice(-6).map((transition) => (
              <li key={`${transition.id}-${transition.at}-${transition.to}`}>
                {`${formatDateTime(transition.at)} · ${displaySourceLabel(transition.from)} → ${displaySourceLabel(transition.to)} · ${formatProbabilityValue(transition.probabilityPct)}`}
                {transition.sessionOnly ? " · browser session only" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {historyReady && (
        <div className={styles.reactionNotice}>
          <p>
            <strong>{selectedSignal.shortLabel}</strong> is analyzed
            independently. The default platform-display view follows
            Polymarket&apos;s recorded display rule and marks source switches.
            The Last-trade price option uses only durable last-trade-price
            state; the REST snapshot does not establish an execution timestamp,
            execution count, or trade size. Each (L, U] result is a detection
            interval bounded by server polls, not a point delay or proof of
            causation. Same-price executions are invisible to the last-trade
            metric. Browser WebSocket ticks remain visual only.
          </p>
          <p>
            Reaction rows use each coverage-qualified source&apos;s first
            observation of a strictly higher daily maximum. {tdzCoverageNotice}{" "}
            The synchronized timing chart itself plots TDZ 05 only; TDZ 23 stays
            out of its line, markers, and legend.{" "}
            {officialDailyCoverageComplete
              ? "Complete retained-history official report/relay maximum events are included."
              : `Official report/relay arrivals remain chart-only because daily coverage is ${String(officialDailyMaximumEvidence?.status || "unavailable").replaceAll("_", " ")}${officialDailyMaximumEvidence?.truncated === true ? " and truncated" : ""}; no official daily-maximum claim is made.`}{" "}
            Duplicate official/sighting rails are canonicalized before this
            count;
            {omittedSourceEvents} normalized weather arrival/frame
            {omittedSourceEvents === 1 ? " does" : "s do"} not produce a row
            because it is repeated/non-maximum or cannot be matched to
            temperature evidence.
          </p>
          {heartbeatApprovalRequired ? (
            <p>
              <strong>Heartbeat evidence approval required.</strong> The server
              gate is closed (
              {heartbeatStatus
                ? heartbeatStatus.replaceAll("_", " ")
                : "approval metadata unavailable"}
              ), so no protected poll-heartbeat history is used. Legacy
              changed-event evidence remains visibly left-censored; it is not
              relabeled as complete polling coverage. Required server flags:{" "}
              {heartbeatRequiredFlagNames.join(", ") || "metadata unavailable"}.
            </p>
          ) : heartbeatHistoryTruncated ? (
            <p>
              <strong>Heartbeat history is truncated.</strong> The query
              returned its {heartbeatHistory?.limit || 2000}-row limit
              {predecessorHeartbeat ? " plus one predecessor boundary" : ""}.
              {coverageExcludedEvents} older new-maximum event
              {coverageExcludedEvents === 1 ? " was" : "s were"} excluded from
              interval claims because the selected signal&apos;s usable coverage
              starts at {formatDateTime(heartbeatCoverageStartAt)}.
            </p>
          ) : Number(heartbeatHistory?.returnedCount || 0) > 0 &&
            !heartbeatHistoryAvailable ? (
            <p>
              <strong>No usable heartbeat state for this signal.</strong> Poll
              heartbeats exist, but this bucket has not supplied the selected
              signal value yet. No substitute probability is used.
            </p>
          ) : !heartbeatHistoryAvailable ? (
            <p>
              <strong>Heartbeat history is accumulating.</strong> Only legacy
              changed-event evidence is available, so the retained history is
              left-censored and gaps between changes are not one-minute
              heartbeat confirmations.
            </p>
          ) : (
            <p>
              {heartbeatHistory?.returnedCount || heartbeatSignalPoints.length}{" "}
              durable poll heartbeats are available for this bucket. Failed poll
              attempts are not observations and are not included in these
              bounds.
            </p>
          )}
        </div>
      )}
      {historyReady && reactions.length > 0 && (
        <div className={styles.tableScroller}>
          <table className={styles.auditTable}>
            <thead>
              <tr>
                <th scope="col">New-max source event</th>
                <th scope="col">First observed by us</th>
                <th scope="col">Before transition</th>
                <th scope="col">First detected update</th>
                <th scope="col">Δ</th>
                <th scope="col">Detection interval vs source</th>
                <th scope="col">Last transition before source</th>
              </tr>
            </thead>
            <tbody>
              {reactions.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <strong>{row.source}</strong>
                    <span>
                      {row.artifact} · new max {formatTemperature(row.tempC)}
                    </span>
                  </th>
                  <td>{formatDateTime(row.at)}</td>
                  <td>{formatReactionSnapshot(row.before)}</td>
                  <td>{formatReactionSnapshot(row.after)}</td>
                  <td
                    className={
                      reactionHasDelta(row.delta)
                        ? styles.auditDelta
                        : undefined
                    }
                  >
                    {formatReactionDelta(row.delta)}
                  </td>
                  <td className={styles.intervalCell}>
                    <strong>{reactionIntervalHeadline(row)}</strong>
                    <span>{orderingLabel(row.ordering)}</span>
                    {row.boundaryEvidence && (
                      <small>
                        {boundaryEvidenceLabel(row.boundaryEvidence)}
                      </small>
                    )}
                  </td>
                  <td className={styles.intervalCell}>
                    {row.priorTransition ? (
                      <>
                        <strong>
                          {intervalText(
                            row.priorTransition.detectionStartAt,
                            row.priorTransition.detectionEndAt,
                            row.at,
                          )}
                        </strong>
                        <span>
                          {formatReactionSnapshot(row.priorTransition.after)} ·
                          detected before source
                        </span>
                      </>
                    ) : (
                      "none retained"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {historyReady && !reactions.length && (
        <EmptyState
          title="No auditable new-maximum reaction rows"
          detail="Source arrivals stay visible in the chart, but rows require a temperature-matched, strictly higher daily official maximum and durable market poll evidence."
        />
      )}
    </section>
  );
}

function raceOutcomeLabel(outcome) {
  const labels = {
    capma: "CAPMA first observed",
    noaa: "NOAA first observed",
    same_poll: "same 60s slot · order unknown",
    invalid_pair: "comparison invalid",
  };
  return (
    labels[outcome] || String(outcome || "unclassified").replaceAll("_", " ")
  );
}

function SourceRace({ events, relayRace }) {
  const race = relayRace?.race || relayRace?.summary || null;
  const comparisons = Array.isArray(race?.recentComparisons)
    ? race.recentComparisons
    : [];
  const allStats = race?.all || {};
  const raceStatus = String(relayRace?.status || "waiting").replaceAll(
    "_",
    " ",
  );
  return (
    <section className={styles.panel} aria-labelledby="race-title">
      <header className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>
            Publication race · independent clocks
          </p>
          <h2 id="race-title">Who did we see first?</h2>
          <p>
            Receipt times are captured by this deployment; provider timestamps
            remain separate.
          </p>
        </div>
        <StatusPill tone={comparisons.length ? "neutral" : "muted"}>
          {comparisons.length
            ? `${comparisons.length} paired reports`
            : raceStatus}
        </StatusPill>
      </header>
      {race && (
        <div className={styles.raceSummary} aria-label="Paired relay summary">
          <span>
            <b>{allStats.capmaWins ?? 0}</b> CAPMA wins
          </span>
          <span>
            <b>{allStats.noaaWins ?? 0}</b> NOAA wins
          </span>
          <span>
            <b>{allStats.samePollCount ?? 0}</b> same-slot unknown
          </span>
          <span>
            <b>{allStats.invalidPairCount ?? 0}</b> invalid pairs
          </span>
        </div>
      )}
      {comparisons.length ? (
        <div className={styles.tableScroller}>
          <table className={styles.auditTable}>
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">CAPMA first observed</th>
                <th scope="col">NOAA first observed</th>
                <th scope="col">Observed lead</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.slice(0, 30).map((row, index) => (
                <tr
                  key={`${row.obsTimeUtc}-${row.capmaFirstSeenAt}-${row.noaaFirstSeenAt}-${index}`}
                >
                  <th scope="row">
                    <strong>{row.reportType || "Report"}</strong>
                    <span>{formatDateTime(row.obsTimeUtc)}</span>
                  </th>
                  <td>{formatDateTime(row.capmaFirstSeenAt)}</td>
                  <td>{formatDateTime(row.noaaFirstSeenAt)}</td>
                  <td>
                    {Number.isFinite(row.capmaLeadSeconds) &&
                    ["capma", "noaa"].includes(row.outcome)
                      ? `${Math.abs(row.capmaLeadSeconds).toFixed(1)}s`
                      : row.outcome === "same_poll"
                        ? "<60s unresolved"
                        : "—"}
                  </td>
                  <td>{raceOutcomeLabel(row.outcome)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title={
            relayRace?.status === "approval_required"
              ? "CAPMA relay comparison requires approval"
              : "No valid paired relay reports yet"
          }
          detail="The paired audit requires successful CAPMA and NOAA checks. Reports first seen in the same polling slot remain indeterminate—not ties or ordered results."
        />
      )}
      {events.length > 0 && (
        <details className={styles.auditDetails}>
          <summary>Inspect CAPMA, NOAA, and AWC receipt evidence</summary>
          <div className={styles.tableScroller}>
            <table className={styles.auditTable}>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Artifact</th>
                  <th scope="col">Observation/source time</th>
                  <th scope="col">First observed by us</th>
                  <th scope="col">Detection lag</th>
                </tr>
              </thead>
              <tbody>
                {events
                  .slice(-30)
                  .reverse()
                  .map((row) => {
                    const sourceAt = firstFinite(row.captureAt, row.obsTimeUtc);
                    const lag = Number.isFinite(sourceAt)
                      ? row.at - sourceAt
                      : null;
                    return (
                      <tr key={row.id}>
                        <th scope="row">{row.source}</th>
                        <td>{row.artifact}</td>
                        <td>{formatDateTime(sourceAt)}</td>
                        <td>{formatDateTime(row.at)}</td>
                        <td>
                          {Number.isFinite(lag)
                            ? `${(lag / 1000).toFixed(1)}s`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <footer className={styles.marketFooter}>
        “First” means first observed by this deployment. It is not a claim about
        the provider’s original publication infrastructure.
      </footer>
    </section>
  );
}

function CollectorStrip({ statuses, nowMs }) {
  const entries = Object.entries(statuses || {});
  if (!entries.length) {
    return null;
  }
  return (
    <section className={styles.collectorStrip} aria-label="Collector health">
      {entries.map(([key, status]) => {
        const state = String(
          status?.status || status?.state || "unknown",
        ).toLowerCase();
        const failureState = [
          "error",
          "approval_required",
          "disabled",
        ].includes(state);
        const at = failureState
          ? firstFinite(
              status?.updatedAt,
              status?.lastAttemptAt,
              status?.lastSuccessAt,
            )
          : state === "fetching"
            ? firstFinite(
                status?.lastAttemptAt,
                status?.updatedAt,
                status?.lastSuccessAt,
              )
            : firstFinite(
                status?.lastSuccessAt,
                status?.updatedAt,
                status?.lastAttemptAt,
              );
        const lastGoodAt = firstFinite(status?.lastSuccessAt);
        const timingLabel = failureState
          ? `${formatAge(at, nowMs)}${Number.isFinite(lastGoodAt) ? ` · last good ${formatAge(lastGoodAt, nowMs)}` : " · no successful sample"}`
          : formatAge(at, nowMs);
        return (
          <div key={key} title={failureState ? status?.lastError || "" : ""}>
            <span
              className={
                state === "ok" || state === "success" || state === "live"
                  ? styles.healthGood
                  : state === "error"
                    ? styles.healthBad
                    : styles.healthNeutral
              }
              aria-hidden="true"
            />
            <p>
              <strong>
                {String(status?.label || key).replaceAll("_", " ")}
              </strong>
              <small>
                {state} · {timingLabel}
              </small>
            </p>
          </div>
        );
      })}
    </section>
  );
}

export default function MexicoEdgePage() {
  const [nowMs, setNowMs] = useState(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [reactionDate, setReactionDate] = useState("");
  const [selectedReactionQuoteId, setSelectedReactionQuoteId] = useState("");
  const [preferredReactionBucketLabel, setPreferredReactionBucketLabel] =
    useState("");
  const [refreshState, setRefreshState] = useState({
    kind: null,
    source: null,
    message: "",
  });
  const date = Number.isFinite(nowMs) ? mexicoDateKey(nowMs) : "";
  const tomorrowDate = date ? shiftDateKey(date, 1) : "";

  const dashboard = useQuery(
    "mexicoEdge:getDashboard",
    date ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const nextDayForecastDashboard = useQuery(
    "mexicoEdge:getForecastDate",
    tomorrowDate ? { stationIcao: STATION_ICAO, date: tomorrowDate } : "skip",
  );
  const nextDayForecastLoading =
    Boolean(tomorrowDate) && nextDayForecastDashboard === undefined;
  const market = useQuery(
    "mexicoPolymarketLive:getLiveMarket",
    date ? { stationIcao: STATION_ICAO, date, limit: 1200 } : "skip",
  );
  const relayRace = useQuery(
    "mexicoRelayRace:getCapmaNoaaRelayRace",
    date ? { stationIcao: STATION_ICAO, date } : "skip",
  );
  const historicalReactionDashboard = useQuery(
    "mexicoEdge:getDashboard",
    validDateKey(reactionDate) && reactionDate !== date
      ? { stationIcao: STATION_ICAO, date: reactionDate }
      : "skip",
  );
  const historicalReactionMarket = useQuery(
    "mexicoPolymarketLive:getLiveMarket",
    validDateKey(reactionDate) && reactionDate !== date
      ? { stationIcao: STATION_ICAO, date: reactionDate, limit: 1200 }
      : "skip",
  );
  const pollAwcMetars = useAction("mexico:pollAwcMetars");
  const pollAwcTaf = useAction("mexico:pollAwcTaf");
  const pollSmnForecast = useAction("mexicoForecastNode:pollSmnHourlyForecast");
  const refreshLiveMarket = useAction("mexicoPolymarketLive:refreshLiveMarket");
  const requestCapmaRefresh = useMutation("mexicoCapma:requestCapmaRefresh");

  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (date && !reactionDate) {
      setReactionDate(date);
    }
  }, [date, reactionDate]);

  const metars = useMemo(
    () =>
      Array.isArray(dashboard?.metars)
        ? dashboard.metars
        : dashboard?.metarRows || [],
    [dashboard?.metars, dashboard?.metarRows],
  );
  const latestMetar =
    dashboard?.latestMetar ||
    [...metars].sort(
      (left, right) => (right.obsTimeUtc || 0) - (left.obsTimeUtc || 0),
    )[0] ||
    null;
  const capma = useMemo(() => normalizeCapma(dashboard), [dashboard]);
  const temperatures = useMemo(
    () => normalizeTemperaturePoints(dashboard),
    [dashboard],
  );
  const sourceEvents = useMemo(
    () => normalizeSourceEvents(dashboard),
    [dashboard],
  );
  const quotes = useMemo(
    () =>
      Array.isArray(market?.quotes)
        ? market.quotes
        : Array.isArray(market?.markets)
          ? market.markets
          : [],
    [market?.quotes, market?.markets],
  );
  const browserStream = useBrowserMarketStream(
    quotes,
    market?.collection?.enabled === true,
  );
  const effectiveQuotes = useMemo(
    () =>
      quotes.map((quote) =>
        mergeBrowserOverride(
          quote,
          browserStream.overrides?.[String(quote.yesTokenId)],
        ),
      ),
    [browserStream.overrides, quotes],
  );

  useEffect(() => {
    if (!effectiveQuotes.length) {
      setSelectedQuoteId("");
      return;
    }
    if (
      !effectiveQuotes.some(
        (quote, index) => quoteId(quote, index) === selectedQuoteId,
      )
    ) {
      const leader = [...effectiveQuotes]
        .map((quote, index) => ({
          quote,
          index,
          probability: numericQuote(quote) ?? -1,
        }))
        .sort((left, right) => right.probability - left.probability)[0];
      setSelectedQuoteId(quoteId(leader.quote, leader.index));
    }
  }, [effectiveQuotes, selectedQuoteId]);

  const selectedQuote =
    effectiveQuotes.find(
      (quote, index) => quoteId(quote, index) === selectedQuoteId,
    ) ||
    effectiveQuotes[0] ||
    null;
  const reactionDashboard =
    reactionDate === date ? dashboard : historicalReactionDashboard;
  const reactionMarket =
    reactionDate === date ? market : historicalReactionMarket;
  const reactionQuotes = useMemo(
    () =>
      Array.isArray(reactionMarket?.quotes)
        ? reactionMarket.quotes
        : Array.isArray(reactionMarket?.markets)
          ? reactionMarket.markets
          : [],
    [reactionMarket?.markets, reactionMarket?.quotes],
  );
  const effectiveReactionQuotes = useMemo(
    () =>
      reactionDate === date
        ? reactionQuotes.map((quote) =>
            mergeBrowserOverride(
              quote,
              browserStream.overrides?.[String(quote.yesTokenId)],
            ),
          )
        : reactionQuotes,
    [browserStream.overrides, date, reactionDate, reactionQuotes],
  );

  useEffect(() => {
    if (!effectiveReactionQuotes.length) {
      setSelectedReactionQuoteId("");
      return;
    }
    if (
      effectiveReactionQuotes.some(
        (quote, index) => quoteId(quote, index) === selectedReactionQuoteId,
      )
    ) {
      return;
    }
    const preferredQuote = effectiveReactionQuotes.find(
      (quote, index) =>
        quoteLabel(quote, index) === preferredReactionBucketLabel,
    );
    const liveSelectedQuote =
      reactionDate === date
        ? effectiveReactionQuotes.find(
            (quote, index) => quoteId(quote, index) === selectedQuoteId,
          )
        : null;
    const fallbackQuote = [...effectiveReactionQuotes]
      .map((quote, index) => ({
        quote,
        index,
        probability: numericQuote(quote) ?? -1,
      }))
      .sort((left, right) => right.probability - left.probability)[0];
    const nextQuote =
      preferredQuote || liveSelectedQuote || fallbackQuote.quote;
    const nextIndex = effectiveReactionQuotes.indexOf(nextQuote);
    setSelectedReactionQuoteId(quoteId(nextQuote, nextIndex));
  }, [
    date,
    effectiveReactionQuotes,
    preferredReactionBucketLabel,
    reactionDate,
    selectedQuoteId,
    selectedReactionQuoteId,
  ]);

  const selectedReactionQuote =
    effectiveReactionQuotes.find(
      (quote, index) => quoteId(quote, index) === selectedReactionQuoteId,
    ) || null;
  const selectedReactionRestQuote =
    reactionQuotes.find(
      (quote, index) => quoteId(quote, index) === selectedReactionQuoteId,
    ) || null;
  const quoteHistory = useQuery(
    "mexicoPolymarketLive:getQuoteHistory",
    validDateKey(reactionDate) && selectedReactionRestQuote?.marketId
      ? {
          stationIcao: STATION_ICAO,
          date: reactionDate,
          marketId: selectedReactionRestQuote.marketId,
          limit: 2000,
        }
      : "skip",
  );
  const durableMarketHistory = useMemo(
    () => ({
      ...(reactionMarket || {}),
      ...(quoteHistory || {}),
      quoteEvents: Array.isArray(quoteHistory?.quoteEvents)
        ? quoteHistory.quoteEvents
        : Array.isArray(reactionMarket?.quoteEvents)
          ? reactionMarket.quoteEvents
          : [],
    }),
    [quoteHistory, reactionMarket],
  );
  const marketWithSession = useMemo(
    () => ({
      ...durableMarketHistory,
      quoteEvents: [
        ...(durableMarketHistory.quoteEvents || []),
        ...(selectedReactionRestQuote &&
        Number.isFinite(quoteReceiptEpoch(selectedReactionRestQuote))
          ? [
              {
                ...selectedReactionRestQuote,
                eventType: "current_quote_snapshot",
              },
            ]
          : []),
        ...(reactionDate === date ? browserStream.events : []),
      ],
    }),
    [
      browserStream.events,
      date,
      durableMarketHistory,
      reactionDate,
      selectedReactionRestQuote,
    ],
  );
  const quoteObservations = useMemo(
    () => normalizeQuoteObservations(marketWithSession, selectedReactionQuote),
    [marketWithSession, selectedReactionQuote],
  );
  const durableQuoteObservations = useMemo(
    () =>
      normalizeQuoteObservations(
        durableMarketHistory,
        selectedReactionRestQuote,
      ),
    [durableMarketHistory, selectedReactionRestQuote],
  );
  const reactionTemperatures = useMemo(
    () => normalizeTemperaturePoints(reactionDashboard),
    [reactionDashboard],
  );
  const reactionSourceEvents = useMemo(
    () => normalizeSourceEvents(reactionDashboard),
    [reactionDashboard],
  );
  const reactionHistoryLoading = Boolean(
    validDateKey(reactionDate) &&
    (reactionDashboard === undefined ||
      reactionMarket === undefined ||
      (effectiveReactionQuotes.length > 0 && !selectedReactionRestQuote) ||
      (selectedReactionRestQuote?.marketId && quoteHistory === undefined)),
  );
  const selectLiveQuote = useCallback(
    (id) => {
      setSelectedQuoteId(id);
      const nextQuote = effectiveQuotes.find(
        (quote, index) => quoteId(quote, index) === id,
      );
      if (reactionDate === date) {
        if (nextQuote) {
          setPreferredReactionBucketLabel(quoteLabel(nextQuote));
        }
        setSelectedReactionQuoteId(id);
      }
    },
    [date, effectiveQuotes, reactionDate],
  );
  const selectReactionQuote = useCallback(
    (id) => {
      setSelectedReactionQuoteId(id);
      const nextQuote = effectiveReactionQuotes.find(
        (quote, index) => quoteId(quote, index) === id,
      );
      if (nextQuote) {
        setPreferredReactionBucketLabel(quoteLabel(nextQuote));
      }
    },
    [effectiveReactionQuotes],
  );
  const selectReactionDate = useCallback((nextDate) => {
    setReactionDate(nextDate);
    setSelectedReactionQuoteId("");
  }, []);
  const observationClock = normalizeObservationClock(
    dashboard?.observationClock,
    nowMs,
  );
  const officialReportCycles = useMemo(
    () => buildOfficialReportCycles(sourceEvents, temperatures),
    [sourceEvents, temperatures],
  );
  const reportCycles = useMemo(
    () => buildRoutineReportCycles(sourceEvents, temperatures),
    [sourceEvents, temperatures],
  );
  const latestTdz05 = useMemo(
    () =>
      [...temperatures]
        .filter(
          (point) =>
            temperatureSeriesKey(point) === "capma_tdz_05" &&
            Number.isFinite(point?.at) &&
            Number.isFinite(point?.tempC),
        )
        .sort((left, right) => left.at - right.at)
        .at(-1) ?? null,
    [temperatures],
  );
  const relayLagModel = useMemo(
    () => buildRelayLagModel(relayRace, reportCycles),
    [relayRace, reportCycles],
  );
  const reportCycleState = deriveReportCycleState({
    nowMs,
    cycles: reportCycles,
    officialReports: officialReportCycles,
    latestTdz: latestTdz05,
    clock: observationClock,
    relayLagModel,
  });
  const forecasts = {
    taf: normalizeForecast(dashboard?.forecasts?.taf, dashboard?.taf, "taf"),
    smn: normalizeForecast(
      dashboard?.forecasts?.smn,
      dashboard?.smnRows,
      "smn",
    ),
  };
  const nextDayForecasts = {
    taf: normalizeForecast(
      nextDayForecastDashboard?.forecasts?.taf,
      null,
      "taf",
    ),
    smn: normalizeForecast(
      nextDayForecastDashboard?.forecasts?.smn,
      null,
      "smn",
    ),
  };
  const forecastCollectorStatuses =
    nextDayForecastDashboard?.collectorStatuses ||
    dashboard?.collectorStatuses ||
    {};
  const tomorrowStartsAt = mexicoMidnightUtc(tomorrowDate);
  const tafAvailabilityWindow = nextDayTafAvailabilityWindow(tomorrowStartsAt);
  const nextTafCheckAt = nextAutomaticForecastCheck(FORECAST_SOURCE_TAF, nowMs);
  const nextSmnCheckAt = nextAutomaticForecastCheck(FORECAST_SOURCE_SMN, nowMs);
  const metarTemperatureValues = metars
    .map((row) => row?.tempC)
    .filter(Number.isFinite);
  const maxOfficialTempC = firstFinite(
    dashboard?.maxOfficialTempC?.tempC,
    dashboard?.maxOfficialTempC?.value,
    dashboard?.maxOfficialTempC,
    metarTemperatureValues.length ? Math.max(...metarTemperatureValues) : null,
  );
  const latestMetarSeenAt = firstFinite(
    latestMetar?.firstSeenAt,
    latestMetar?.firstAwcSeenAt,
  );

  const refreshAll = useCallback(async () => {
    if (refreshState.kind) return;
    setRefreshState({
      kind: "all",
      message: "Refreshing public weather and market sources…",
    });
    const results = await Promise.allSettled([
      pollAwcMetars({ stationIcao: STATION_ICAO }),
      pollAwcTaf({ stationIcao: STATION_ICAO }),
      pollSmnForecast({ stationIcao: STATION_ICAO }),
      refreshLiveMarket({ stationIcao: STATION_ICAO, date }),
    ]);
    const labels = ["METAR", "TAF", "SMN", "Market"];
    setRefreshState({
      kind: null,
      message: results
        .map((result, index) => actionSummary(labels[index], result))
        .join(" · "),
    });
  }, [
    date,
    pollAwcMetars,
    pollAwcTaf,
    pollSmnForecast,
    refreshLiveMarket,
    refreshState.kind,
  ]);

  const refreshForecastSource = useCallback(
    async (source) => {
      if (refreshState.kind) return;
      const isTaf = source === FORECAST_SOURCE_TAF;
      const kind = isTaf ? "forecast-taf" : "forecast-smn";
      const label = isTaf ? "TAF" : "SMN";
      const action = isTaf ? pollAwcTaf : pollSmnForecast;
      setRefreshState({
        kind,
        source,
        message: `Fetching the latest ${label} forecast from the provider…`,
      });
      try {
        const result = await action({ stationIcao: STATION_ICAO });
        setRefreshState({
          kind: null,
          source,
          message: actionSummary(label, {
            status: "fulfilled",
            value: result,
          }),
        });
      } catch {
        setRefreshState({
          kind: null,
          source,
          message: `${label}: live fetch failed`,
        });
      }
    },
    [pollAwcTaf, pollSmnForecast, refreshState.kind],
  );

  const refreshImages = useCallback(async () => {
    if (refreshState.kind) return;
    setRefreshState({
      kind: "images",
      message: "Requesting latest approved TDZ images…",
    });
    try {
      const result = await requestCapmaRefresh({ stationIcao: STATION_ICAO });
      setRefreshState({
        kind: null,
        message: actionSummary("CAPMA images", {
          status: "fulfilled",
          value: result,
        }),
      });
    } catch {
      setRefreshState({ kind: null, message: "CAPMA images: request failed" });
    }
  }, [refreshState.kind, requestCapmaRefresh]);

  const refreshMarketOnly = useCallback(async () => {
    if (refreshState.kind) return;
    setRefreshState({
      kind: "market",
      message: "Refreshing live market metadata and books…",
    });
    try {
      const result = await refreshLiveMarket({
        stationIcao: STATION_ICAO,
        date,
      });
      setRefreshState({
        kind: null,
        message: actionSummary("Market", {
          status: "fulfilled",
          value: result,
        }),
      });
    } catch {
      setRefreshState({ kind: null, message: "Market: request failed" });
    }
  }, [date, refreshLiveMarket, refreshState.kind]);

  const loading =
    dashboard === undefined ||
    market === undefined ||
    nextDayForecastLoading ||
    !Number.isFinite(nowMs);
  const eventResolutionSource = exactString(market?.event?.resolutionSource);
  const eventResolutionUrl = safeHttpsUrl(eventResolutionSource);
  const acquisition = dashboard?.resolutionSource || {};
  const acquisitionLabel =
    acquisition?.source === "weather_underground_mmmx_daily_observations"
      ? "Weather Underground · MMMX Daily Observations"
      : firstPresent(
          acquisition?.label,
          acquisition?.name,
          acquisition?.source,
          "Weather Company resolution acquisition",
        );
  const acquisitionStatus = String(
    acquisition?.status || "unavailable",
  ).replaceAll("_", " ");

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#edge-content">
        Skip to live dashboard
      </a>
      <div className={styles.gridBackdrop} aria-hidden="true" />
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <Link
            href={date ? `/mexico/day/${date}` : "/mexico/today"}
            className={styles.backLink}
          >
            <span aria-hidden="true">←</span> Existing Mexico day page
          </Link>
          <div className={styles.brandLine}>
            <span className={styles.stationBadge}>MMMX</span>
            <div>
              <strong>Mexico Edge</strong>
              <small>Temperature intelligence cockpit</small>
            </div>
          </div>
        </div>
        <ClockBlock nowMs={nowMs} />
        <div className={styles.primaryActions}>
          <div className={styles.connectionState}>
            <span
              className={loading ? styles.loadingDot : styles.liveDot}
              aria-hidden="true"
            />
            {loading ? "connecting" : "reactive feed"}
          </div>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={refreshAll}
            disabled={Boolean(refreshState.kind) || !date}
          >
            {refreshState.kind === "all" ? "Syncing…" : "Refresh all"}
          </button>
        </div>
      </header>

      <div id="edge-content" className={styles.content}>
        <ReportCyclePanel
          temperatures={temperatures}
          cycles={reportCycles}
          officialReports={officialReportCycles}
          clock={observationClock}
          relayLagModel={relayLagModel}
          cycleState={reportCycleState}
          nowMs={nowMs}
        />

        <div className={styles.heroIntro}>
          <div>
            <p className={styles.kicker}>
              Live operations · {date || "today"} · Benito Juárez International
            </p>
            <h1>
              Catch the temperature.
              <br />
              <span>Audit the reaction.</span>
            </h1>
          </div>
          <div className={styles.heroSummary}>
            <div>
              <span>Latest METAR</span>
              <strong>{formatTemperature(latestMetar?.tempC)}</strong>
              <small>{formatAge(latestMetar?.obsTimeUtc, nowMs)}</small>
            </div>
            <div>
              <span>Official max so far</span>
              <strong>{formatTemperature(maxOfficialTempC)}</strong>
              <small>METAR series</small>
            </div>
            <div>
              <span>Selected market</span>
              <strong>
                {quotePercent(selectedQuote, "probability") || "—"}
              </strong>
              <small>
                {selectedQuote ? quoteLabel(selectedQuote) : "awaiting bucket"}
              </small>
            </div>
          </div>
        </div>

        <div className={styles.timingGrid}>
          <RoutineWindow
            clock={observationClock}
            cycleState={reportCycleState}
            nowMs={nowMs}
            highFrequencyWatch={dashboard?.highFrequencyWatch}
          />
          <SpeciCard
            speci={dashboard?.speci}
            metars={metars}
            cycleState={reportCycleState}
            nowMs={nowMs}
          />
        </div>

        <div className={styles.refreshMessage} aria-live="polite">
          {refreshState.message ||
            "Collectors update independently. Times below preserve measurement, provider, and local receipt semantics."}
        </div>

        <section className={styles.section} aria-labelledby="temperature-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Live airfield temperatures</p>
              <h2 id="temperature-title">What is measurable now?</h2>
            </div>
            <p>
              CAPMA displays are runway TDZ whole-degree values. METAR is the
              aviation observation used for the official series here.
            </p>
          </div>
          <div className={styles.temperatureGrid}>
            <TemperatureCard
              label={`${latestMetar?.reportType || "METAR"} · aviation observation`}
              value={latestMetar?.tempC}
              at={latestMetar?.obsTimeUtc}
              observedAt={latestMetarSeenAt}
              detail={latestMetar?.rawText || "Awaiting current MMMX report"}
              tone="cyan"
            />
            <TemperatureCard
              label="CAPMA · TDZ 05"
              value={capma.latest05?.currentTempC}
              at={capma.latest05?.screenTimeUtc}
              observedAt={firstFinite(
                capma.latest05?.fetchedAt,
                capma.latest05?.firstSeenAt,
              )}
              detail="Whole-degree TDZ display · source rounding method not assumed"
              tone="lime"
              digits={0}
            />
            <TemperatureCard
              label="CAPMA · TDZ 23"
              value={capma.latest23?.currentTempC}
              at={capma.latest23?.screenTimeUtc}
              observedAt={firstFinite(
                capma.latest23?.fetchedAt,
                capma.latest23?.firstSeenAt,
              )}
              detail="Whole-degree TDZ display · source rounding method not assumed"
              tone="orange"
              digits={0}
            />
          </div>
        </section>

        <section
          className={styles.section}
          aria-labelledby="display-images-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Latest source frames</p>
              <h2 id="display-images-title">Runway display images</h2>
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={refreshImages}
              disabled={Boolean(refreshState.kind) || !capma.approvalGranted}
            >
              {refreshState.kind === "images"
                ? "Requesting…"
                : "Refresh latest images"}
            </button>
          </div>
          {!capma.approvalGranted ? (
            <div className={styles.approvalNotice}>
              <StatusPill tone="watch">approval required</StatusPill>
              <div>
                <strong>CAPMA image access is disabled server-side.</strong>
                <p>
                  No substitute image or proxy sensor is presented under this
                  source label. Access, retention, and republication approvals
                  must all be active.
                </p>
              </div>
            </div>
          ) : (
            <div className={styles.imageGrid}>
              <ImageCard
                tdz="05"
                image={capma.latestImages?.["05"]}
                fallbackObservation={capma.latest05}
                nowMs={nowMs}
              />
              <ImageCard
                tdz="23"
                image={capma.latestImages?.["23"]}
                fallbackObservation={capma.latest23}
                nowMs={nowMs}
              />
            </div>
          )}
        </section>

        <section className={styles.section} aria-labelledby="forecast-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Forecast revision watch</p>
              <h2 id="forecast-title">Daily maximum forecasts</h2>
            </div>
            <p>
              TAF aerodrome groups and SMN/CONAGUA municipal guidance stay
              distinct; neither is relabeled as the settlement source.
            </p>
          </div>
          <div className={styles.forecastDayBlock}>
            <div className={styles.forecastDayHeader}>
              <div>
                <p className={styles.eyebrow}>Today · {date || "—"}</p>
                <h3>Current-day guidance</h3>
              </div>
            </div>
            <div className={styles.forecastGrid}>
              <ForecastCard
                label="TAF · MMMX aerodrome"
                forecast={forecasts.taf}
                accent="#50e3ff"
                nowMs={nowMs}
                targetDate={date}
                collectorStatus={forecastCollectorStatuses.awc_taf}
                nextCheckAt={nextTafCheckAt}
                sourceAttribution="SENEAM/CAPMA authored · fetched through NOAA/AWC"
                sourceLink={{
                  href: AWC_MMMX_TAF_URL,
                  label: "View live MMMX TAF",
                }}
              />
              <ForecastCard
                label="SMN / CONAGUA · Venustiano Carranza"
                forecast={forecasts.smn}
                accent="#b8ff56"
                digits={1}
                nowMs={nowMs}
                targetDate={date}
                collectorStatus={forecastCollectorStatuses.smn_municipal_hourly}
                nextCheckAt={nextSmnCheckAt}
                sourceAttribution="Official municipal guidance · 4.8 km from MMMX"
                sourceLink={{
                  href: SMN_MUNICIPAL_FORECAST_URL,
                  label: "Open SMN municipal forecast portal",
                }}
              />
            </div>
          </div>
          <div className={styles.forecastDayBlock}>
            <div className={styles.forecastDayHeader}>
              <div>
                <p className={styles.eyebrow}>
                  Tomorrow · {tomorrowDate || "—"}
                </p>
                <h3>Next-day guidance</h3>
              </div>
              <div className={styles.forecastDayCountdown} aria-live="off">
                <span>Tomorrow begins in</span>
                <strong>{formatCountdown(tomorrowStartsAt, nowMs)}</strong>
                {Number.isFinite(tomorrowStartsAt) ? (
                  <time dateTime={new Date(tomorrowStartsAt).toISOString()}>
                    {formatDateTime(tomorrowStartsAt)}
                  </time>
                ) : null}
              </div>
            </div>
            <div className={styles.forecastGrid}>
              <ForecastCard
                label="TAF · MMMX aerodrome"
                forecast={nextDayForecasts.taf}
                accent="#50e3ff"
                nowMs={nowMs}
                targetDate={tomorrowDate}
                collectorStatus={forecastCollectorStatuses.awc_taf}
                nextCheckAt={nextTafCheckAt}
                availability={
                  nextDayForecastLoading
                    ? {
                        label: "Next-day forecast",
                        value: "loading…",
                        detail: "Reading retained provider snapshots.",
                      }
                    : nextDayTafAvailability(
                        nextDayForecasts.taf,
                        tafAvailabilityWindow,
                        nowMs,
                      )
                }
                sourceAttribution="SENEAM/CAPMA authored · fetched through NOAA/AWC"
                sourceLink={{
                  href: AWC_MMMX_TAF_URL,
                  label: "View live MMMX TAF",
                }}
                onRefresh={() => refreshForecastSource(FORECAST_SOURCE_TAF)}
                refreshLabel="Fetch latest TAF"
                refreshing={refreshState.kind === "forecast-taf"}
                refreshDisabled={
                  Boolean(refreshState.kind) || nextDayForecastLoading
                }
                refreshMessage={
                  refreshState.source === FORECAST_SOURCE_TAF
                    ? refreshState.message
                    : ""
                }
                loading={nextDayForecastLoading}
              />
              <ForecastCard
                label="SMN / CONAGUA · Venustiano Carranza"
                forecast={nextDayForecasts.smn}
                accent="#b8ff56"
                digits={1}
                nowMs={nowMs}
                targetDate={tomorrowDate}
                collectorStatus={forecastCollectorStatuses.smn_municipal_hourly}
                nextCheckAt={nextSmnCheckAt}
                availability={
                  nextDayForecastLoading
                    ? {
                        label: "Next-day forecast",
                        value: "loading…",
                        detail: "Reading retained provider snapshots.",
                      }
                    : nextDaySmnAvailability(
                        nextDayForecasts.smn,
                        nextDayForecastDashboard?.coverage?.smn,
                      )
                }
                sourceAttribution="Official municipal guidance · 4.8 km from MMMX"
                sourceLink={{
                  href: SMN_MUNICIPAL_FORECAST_URL,
                  label: "Open SMN municipal forecast portal",
                }}
                onRefresh={() => refreshForecastSource(FORECAST_SOURCE_SMN)}
                refreshLabel="Fetch latest SMN"
                refreshing={refreshState.kind === "forecast-smn"}
                refreshDisabled={
                  Boolean(refreshState.kind) || nextDayForecastLoading
                }
                refreshMessage={
                  refreshState.source === FORECAST_SOURCE_SMN
                    ? refreshState.message
                    : ""
                }
                loading={nextDayForecastLoading}
              />
            </div>
          </div>
        </section>

        <MarketLadder
          market={market}
          quotes={effectiveQuotes}
          selectedId={selectedQuoteId}
          onSelect={selectLiveQuote}
          nowMs={nowMs}
          onRefresh={refreshMarketOnly}
          refreshing={refreshState.kind === "market"}
          browserStream={browserStream}
        />

        <ReactionExplorer
          key={reactionDate || "reaction-history"}
          temperatures={reactionTemperatures}
          quoteObservations={quoteObservations}
          durableQuoteObservations={durableQuoteObservations}
          sourceEvents={reactionSourceEvents}
          heartbeatHistory={quoteHistory?.pollHeartbeatHistory}
          heartbeatApprovals={
            quoteHistory?.heartbeatApprovals ||
            reactionMarket?.heartbeatApprovals
          }
          predecessorHeartbeat={quoteHistory?.predecessorHeartbeat}
          officialDailyMaximumEvidence={
            reactionDashboard?.officialDailyMaximumEvidence
          }
          tdzDailyMaximumEvidence={reactionDashboard?.tdzDailyMaximumEvidence}
          nowMs={nowMs}
          bucketLabel={
            selectedReactionQuote
              ? quoteLabel(selectedReactionQuote)
              : "No bucket selected"
          }
          date={reactionDate}
          maxDate={date}
          availableQuotes={effectiveReactionQuotes}
          selectedQuoteId={selectedReactionQuoteId}
          onDateChange={selectReactionDate}
          onBucketChange={selectReactionQuote}
          historyLoading={reactionHistoryLoading}
        />

        <SourceRace events={sourceEvents} relayRace={relayRace} />

        <section
          className={styles.resolutionPanel}
          aria-labelledby="resolution-title"
        >
          <div>
            <p className={styles.eyebrow}>Contract definition</p>
            <h2 id="resolution-title">Market resolution source</h2>
          </div>
          <div className={styles.resolutionDetails}>
            <div className={styles.eventResolution}>
              <div className={styles.cardEyebrowRow}>
                <strong>Authoritative event metadata</strong>
                <StatusPill tone={eventResolutionSource ? "neutral" : "watch"}>
                  {eventResolutionSource
                    ? "source named"
                    : "source unavailable"}
                </StatusPill>
              </div>
              {eventResolutionSource ? (
                <code className={styles.resolutionExact}>
                  {eventResolutionSource}
                </code>
              ) : (
                <p className={styles.resolutionMissing}>
                  The loaded Polymarket event has not supplied a resolution
                  source. No weather source is substituted.
                </p>
              )}
              <p>
                {firstPresent(
                  market?.event?.description,
                  "Settlement follows the source named in Polymarket’s event metadata. NOAA/AWC and CAPMA are timing intelligence only.",
                )}
              </p>
              {eventResolutionUrl && (
                <a href={eventResolutionUrl} target="_blank" rel="noreferrer">
                  Open source named by the market{" "}
                  <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
            <div className={styles.acquisitionStatus}>
              <div className={styles.acquisitionHeader}>
                <div>
                  <p className={styles.eyebrow}>Our acquisition status</p>
                  <strong>{acquisitionLabel}</strong>
                </div>
                <StatusPill
                  tone={acquisition?.status === "available" ? "live" : "watch"}
                >
                  {acquisitionStatus}
                </StatusPill>
              </div>
              <p>
                {firstPresent(
                  acquisition?.explanation,
                  "This deployment has not reported an acquisition state for the market’s resolution source.",
                )}
              </p>
              <div className={styles.approvalGrid}>
                <span>
                  Access{" "}
                  <b>
                    {acquisition?.accessApproved === true
                      ? "approved"
                      : "not approved"}
                  </b>
                </span>
                <span>
                  Retention{" "}
                  <b>
                    {acquisition?.retentionApproved === true
                      ? "approved"
                      : "not approved"}
                  </b>
                </span>
                <span>
                  Republication{" "}
                  <b>
                    {acquisition?.republicationApproved === true
                      ? "approved"
                      : "not approved"}
                  </b>
                </span>
                <span>
                  Interface{" "}
                  <b>
                    {acquisition?.interfaceConfigured === true
                      ? "configured"
                      : "not configured"}
                  </b>
                </span>
              </div>
            </div>
          </div>
        </section>

        <CollectorStrip statuses={dashboard?.collectorStatuses} nowMs={nowMs} />

        <footer className={styles.footer}>
          <span>MMMX · Mexico City International Airport</span>
          <span>
            Measurement time ≠ publication time ≠ first observed by us
          </span>
          <Link href={date ? `/mexico/day/${date}` : "/mexico/today"}>
            Open the existing full day page
          </Link>
        </footer>
      </div>
    </main>
  );
}
