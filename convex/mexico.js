import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  buildCapmaMetarSimilarity,
  CAPMA_METAR_WINDOW_MS,
  resolveCapmaComparisonAnchor,
} from "./mexicoCapmaSimilarity.js";

const STATION_ICAO = "MMMX";
const MEXICO_TIMEZONE = "America/Mexico_City";
const AWC_METAR_URL =
  "https://aviationweather.gov/api/data/metar?ids=MMMX&format=json&hours=2";
const AWC_TAF_URL =
  "https://aviationweather.gov/api/data/taf?ids=MMMX&format=json";
const USER_AGENT =
  "polypro-mmmx-weather/1.0 (MMMX weather dashboard; server-side collector)";
const AWC_COOLDOWN_MS = 60_000;

const mexicoDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MEXICO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const mexicoDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MEXICO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getDateParts(formatter, epochMs) {
  const values = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatMexicoDate(epochMs) {
  const parts = getDateParts(mexicoDateFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export { formatMexicoDate };

function formatMexicoDateTime(epochMs) {
  const parts = getDateParts(mexicoDateTimeFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export { formatMexicoDateTime };

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function parseEpoch(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function optionalFiniteNumber(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function sha256Text(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export { sha256Text };

const NOAA_TEXT_METAR_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations/MMMX.TXT";
export const NOAA_TEXT_SOURCE = "noaa_text_metar";
export const CAPMA_AFTN_SOURCE = "capma_aftn_metar";

function capmaAftnAccessApproved() {
  return process.env.SENEAM_CAPMA_MMMX_AFTN_REPORTS_ACCESS_APPROVED === "true";
}

// Collapse whitespace and make the leading report-type token explicit so the
// same official report hashes to the same identity whether it arrives from
// AWC JSON ("METAR MMMX ..."), the CAPMA AFTN relay (routine lines omit the
// METAR token and pad fields with extra spaces), or the NOAA single-station
// text file (no type token at all). AWC rawOb already carries single spaces
// and a type token, so its normalized form is byte-identical to the stored
// value and existing reportKeys remain stable.
export function normalizeMetarRaw(raw) {
  const collapsed = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!collapsed) {
    return null;
  }
  const hasToken = /^(METAR|SPECI|COR) /.test(collapsed);
  const normalized = hasToken ? collapsed : `METAR ${collapsed}`;
  const typeless = collapsed.replace(/^(METAR|SPECI|COR) /, "");
  return { collapsed, normalized, typeless };
}

// First whole-degree temperature/dew point group after the time group, e.g.
// "20/11" or "M02/M10". Three-digit RMK slashes such as "8/963" never match.
export function parseMetarTempGroup(raw) {
  const match = /\s(M?\d{2})\/(M?\d{2})(?=\s|$)/.exec(String(raw ?? ""));
  if (!match) {
    return {};
  }
  const decode = (token) =>
    token.startsWith("M") ? -Number(token.slice(1)) : Number(token);
  return { tempC: decode(match[1]), dewpointC: decode(match[2]) };
}

// Resolve YYGGggZ against an anchor instant. The day-of-month is taken from
// the anchor's UTC month; if that would land in the future the previous month
// is used (midnight rollover). Results more than 26 hours old are rejected.
export function resolveReportObsTimeUtc({
  day,
  hour,
  minute,
  anchorUtc,
  maxFutureMs = 15 * 60 * 1000,
}) {
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isFinite(anchorUtc)
  ) {
    return null;
  }
  const anchor = new Date(anchorUtc);
  let candidate = Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    day,
    hour,
    minute,
    0,
  );
  if (candidate > anchorUtc + maxFutureMs) {
    candidate = Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() - 1,
      day,
      hour,
      minute,
      0,
    );
  }
  if (
    candidate > anchorUtc + maxFutureMs ||
    anchorUtc - candidate > 26 * 60 * 60 * 1000
  ) {
    return null;
  }
  return candidate;
}

// Build a canonical official-report row from a relay line (CAPMA AFTN). The
// reportKey formula matches normalizeAwcMetarItem so an early relay insert and
// the later AWC upsert address the same row instead of double-counting.
export async function buildRelayMetarRow(rawLine, envelope) {
  const { stationIcao, fetchStartedAt, fetchCompletedAt } = envelope;
  const norm = normalizeMetarRaw(rawLine);
  if (!norm) {
    return null;
  }
  const timeMatch = /^MMMX (\d{2})(\d{2})(\d{2})Z/.exec(norm.typeless);
  if (!timeMatch) {
    return null;
  }
  const obsTimeUtc = resolveReportObsTimeUtc({
    day: Number(timeMatch[1]),
    hour: Number(timeMatch[2]),
    minute: Number(timeMatch[3]),
    anchorUtc: fetchCompletedAt,
  });
  if (obsTimeUtc === null) {
    return null;
  }
  const rawHash = await sha256Text(norm.normalized);
  const typelessHash = await sha256Text(norm.typeless);
  const reportType = norm.collapsed.startsWith("SPECI") ? "SPECI" : "METAR";
  const temps = parseMetarTempGroup(norm.typeless);
  return {
    stationIcao,
    reportKey: `${stationIcao}:${obsTimeUtc}:${reportType}:${rawHash}`,
    rawHash,
    typelessHash,
    firstSource: envelope.source,
    date: formatMexicoDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatMexicoDateTime(obsTimeUtc),
    reportType,
    isCorrection: /\bCOR\b/i.test(norm.collapsed),
    ...(temps.tempC !== undefined
      ? { tempC: temps.tempC, tempF: toFahrenheit(temps.tempC) }
      : {}),
    ...(temps.dewpointC !== undefined
      ? { dewpointC: temps.dewpointC, dewpointF: toFahrenheit(temps.dewpointC) }
      : {}),
    rawMetar: norm.normalized,
    rawProviderJson: JSON.stringify({
      source: envelope.source,
      line: String(rawLine ?? "").trim(),
    }),
    firstSeenAt: fetchCompletedAt,
    fetchStartedAt,
    fetchCompletedAt,
  };
}

function assertStation(stationIcao) {
  if ((stationIcao ?? STATION_ICAO).trim().toUpperCase() !== STATION_ICAO) {
    throw new Error("The Mexico collector supports MMMX only.");
  }
  return STATION_ICAO;
}

export function publicMetarRowsForCapmaApproval(rows, accessApproved) {
  if (accessApproved) {
    return rows;
  }
  return rows.flatMap((row) => {
    if (row.firstSource !== CAPMA_AFTN_SOURCE) {
      return [row];
    }
    if (!Number.isFinite(row.firstAwcSeenAt)) {
      return [];
    }
    const { relayFirstSeenAt, relaySource, ...awcConfirmed } = row;
    const firstAwcSeenAt = row.firstAwcSeenAt;
    return [
      {
        ...awcConfirmed,
        firstSource: "awc",
        firstSeenAt: firstAwcSeenAt,
        fetchStartedAt: row.firstAwcFetchStartedAt ?? firstAwcSeenAt,
        fetchCompletedAt: firstAwcSeenAt,
        lastSeenAt: firstAwcSeenAt,
        updatedAt: firstAwcSeenAt,
      },
    ];
  });
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
}

function shiftDateKey(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseReportType(value, rawMetar) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "SPECI") {
    return "SPECI";
  }
  if (normalized === "METAR") {
    return "METAR";
  }
  return /^SPECI\b/i.test(String(rawMetar ?? "")) ? "SPECI" : "METAR";
}

function cloudSummary(clouds) {
  if (!Array.isArray(clouds)) {
    return undefined;
  }
  const values = clouds
    .map((cloud) => {
      const cover = String(cloud?.cover ?? "").trim();
      const base = optionalFiniteNumber(cloud?.base);
      const type = String(cloud?.type ?? "").trim();
      if (!cover) {
        return null;
      }
      return `${cover}${Number.isFinite(base) ? ` ${base} ft` : ""}${type ? ` ${type}` : ""}`;
    })
    .filter(Boolean);
  return values.length ? values.join(" · ") : undefined;
}

function parseSignedTafTemperature(token) {
  const match = /^(M?)(\d{2})$/.exec(token);
  if (!match) {
    return null;
  }
  const magnitude = Number(match[2]);
  return match[1] ? -magnitude : magnitude;
}

function monthCandidate(year, monthIndex, day, hour) {
  return Date.UTC(year, monthIndex, day, hour, 0, 0);
}

export function resolveTafGroupTime({ day, hour, validFrom, validTo }) {
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isFinite(validFrom) ||
    !Number.isFinite(validTo)
  ) {
    return null;
  }
  const anchor = new Date(validFrom);
  const candidates = [];
  for (let offset = -1; offset <= 1; offset += 1) {
    const monthAnchor = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, 1),
    );
    const candidate = monthCandidate(
      monthAnchor.getUTCFullYear(),
      monthAnchor.getUTCMonth(),
      day,
      hour,
    );
    const check = new Date(candidate);
    if (
      check.getUTCDate() === day &&
      check.getUTCHours() === hour &&
      candidate >= validFrom &&
      candidate <= validTo
    ) {
      candidates.push(candidate);
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export function parseTafTemperatureGroups(rawTaf, validFrom, validTo) {
  const groups = [];
  const pattern = /\b(TX|TN)(M?\d{2})\/(\d{2})(\d{2})Z\b/g;
  let match;
  while ((match = pattern.exec(String(rawTaf ?? "")))) {
    const tempC = parseSignedTafTemperature(match[2]);
    const forecastTimeUtc = resolveTafGroupTime({
      day: Number(match[3]),
      hour: Number(match[4]),
      validFrom,
      validTo,
    });
    if (!Number.isFinite(tempC) || !Number.isFinite(forecastTimeUtc)) {
      continue;
    }
    groups.push({
      kind: match[1] === "TX" ? "maximum" : "minimum",
      tempC,
      tempF: toFahrenheit(tempC),
      forecastTimeUtc,
      forecastTimeLocal: formatMexicoDateTime(forecastTimeUtc),
      date: formatMexicoDate(forecastTimeUtc),
      rawGroup: match[0],
    });
  }
  return groups;
}

export function normalizeTafPeriod(period) {
  const timeFromUtc = parseEpoch(period?.timeFrom);
  const timeToUtc = parseEpoch(period?.timeTo);
  if (!Number.isFinite(timeFromUtc) || !Number.isFinite(timeToUtc)) {
    return null;
  }
  const probability = optionalFiniteNumber(period?.probability);
  const visibilitySm = optionalFiniteNumber(period?.visib);
  const windDirectionDeg = optionalFiniteNumber(period?.wdir);
  const windSpeedKt = optionalFiniteNumber(period?.wspd);
  const clouds = cloudSummary(period?.clouds);
  return {
    timeFromUtc,
    timeToUtc,
    timeFromLocal: formatMexicoDateTime(timeFromUtc),
    timeToLocal: formatMexicoDateTime(timeToUtc),
    ...(period?.fcstChange ? { changeType: String(period.fcstChange) } : {}),
    ...(Number.isFinite(probability) ? { probability } : {}),
    ...(period?.wxString ? { weather: String(period.wxString) } : {}),
    ...(clouds ? { cloudSummary: clouds } : {}),
    ...(Number.isFinite(visibilitySm) ? { visibilitySm } : {}),
    ...(Number.isFinite(windDirectionDeg) ? { windDirectionDeg } : {}),
    ...(Number.isFinite(windSpeedKt) ? { windSpeedKt } : {}),
  };
}

export async function normalizeAwcMetarItem(
  item,
  { stationIcao, fetchStartedAt, fetchCompletedAt },
) {
  const normalizedStation = assertStation(stationIcao);
  if (
    String(item?.icaoId ?? "").toUpperCase() !== normalizedStation ||
    !Number.isFinite(fetchStartedAt) ||
    !Number.isFinite(fetchCompletedAt)
  ) {
    return null;
  }
  const rawMetar = String(item?.rawOb ?? "").trim();
  const obsTimeUtc = parseEpoch(item?.obsTime);
  if (!rawMetar || !Number.isFinite(obsTimeUtc)) {
    return null;
  }
  const norm = normalizeMetarRaw(rawMetar);
  if (!norm) {
    return null;
  }
  const rawHash = await sha256Text(norm.normalized);
  const typelessHash = await sha256Text(norm.typeless);
  const reportType = parseReportType(item?.metarType, rawMetar);
  const reportTimeUtc = parseEpoch(item?.reportTime);
  const receiptTimeUtc = parseEpoch(item?.receiptTime);
  const tempC = optionalFiniteNumber(item?.temp);
  const dewpointC = optionalFiniteNumber(item?.dewp);
  const windDirectionDeg = optionalFiniteNumber(item?.wdir);
  const windSpeedKt = optionalFiniteNumber(item?.wspd);
  const visibilitySm = optionalFiniteNumber(item?.visib);
  const clouds = cloudSummary(item?.clouds);
  return {
    stationIcao: normalizedStation,
    reportKey: `${normalizedStation}:${obsTimeUtc}:${reportType}:${rawHash}`,
    rawHash,
    date: formatMexicoDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatMexicoDateTime(obsTimeUtc),
    ...(Number.isFinite(reportTimeUtc) ? { reportTimeUtc } : {}),
    reportType,
    isCorrection: /\bCOR\b/i.test(rawMetar),
    ...(Number.isFinite(tempC) ? { tempC, tempF: toFahrenheit(tempC) } : {}),
    ...(Number.isFinite(dewpointC)
      ? { dewpointC, dewpointF: toFahrenheit(dewpointC) }
      : {}),
    ...(item?.wxString ? { weather: String(item.wxString) } : {}),
    ...(item?.cover ? { cloudCover: String(item.cover) } : {}),
    ...(clouds ? { cloudSummary: clouds } : {}),
    ...(item?.fltCat ? { flightCategory: String(item.fltCat) } : {}),
    ...(Number.isFinite(windDirectionDeg) ? { windDirectionDeg } : {}),
    ...(Number.isFinite(windSpeedKt) ? { windSpeedKt } : {}),
    ...(Number.isFinite(visibilitySm) ? { visibilitySm } : {}),
    rawMetar,
    rawProviderJson: JSON.stringify(item),
    typelessHash,
    firstSource: "awc",
    ...(Number.isFinite(receiptTimeUtc)
      ? {
          initialAwcReceiptTimeUtc: receiptTimeUtc,
          latestAwcReceiptTimeUtc: receiptTimeUtc,
        }
      : {}),
    firstAwcFetchStartedAt: fetchStartedAt,
    firstAwcSeenAt: fetchCompletedAt,
    firstSeenAt: fetchCompletedAt,
    fetchStartedAt,
    fetchCompletedAt,
  };
}

export const getCollectorStatus = queryGeneric({
  args: {
    stationIcao: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mexicoCollectorStatus")
      .withIndex("by_station_source", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("source", args.source),
      )
      .first();
  },
});

export const claimCollectorAttempt = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    source: v.string(),
    cooldownMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("mexicoCollectorStatus")
      .withIndex("by_station_source", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("source", args.source),
      )
      .first();
    if (
      existing &&
      Number.isFinite(existing.lastAttemptAt) &&
      now - existing.lastAttemptAt < args.cooldownMs
    ) {
      return {
        claimed: false,
        retryAfterAt: existing.lastAttemptAt + args.cooldownMs,
      };
    }
    const value = {
      stationIcao: args.stationIcao,
      source: args.source,
      status: "fetching",
      lastAttemptAt: now,
      lastError: "",
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
    } else {
      await ctx.db.insert("mexicoCollectorStatus", value);
    }
    return { claimed: true, attemptAt: now };
  },
});

export const finishCollectorAttempt = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    source: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("fetching"),
      v.literal("ok"),
      v.literal("not_modified"),
      v.literal("approval_required"),
      v.literal("error"),
    ),
    lastSuccessAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    httpStatus: v.optional(v.number()),
    responseBytes: v.optional(v.number()),
    etag: v.optional(v.string()),
    lastModified: v.optional(v.string()),
    cacheControl: v.optional(v.string()),
    rowCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mexicoCollectorStatus")
      .withIndex("by_station_source", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("source", args.source),
      )
      .first();
    const now = Date.now();
    const patch = {
      stationIcao: args.stationIcao,
      source: args.source,
      status: args.status,
      updatedAt: now,
      ...(args.lastSuccessAt !== undefined
        ? { lastSuccessAt: args.lastSuccessAt }
        : {}),
      ...(args.lastError !== undefined ? { lastError: args.lastError } : {}),
      ...(args.httpStatus !== undefined ? { httpStatus: args.httpStatus } : {}),
      ...(args.responseBytes !== undefined
        ? { responseBytes: args.responseBytes }
        : {}),
      ...(args.etag !== undefined ? { etag: args.etag } : {}),
      ...(args.lastModified !== undefined
        ? { lastModified: args.lastModified }
        : {}),
      ...(args.cacheControl !== undefined
        ? { cacheControl: args.cacheControl }
        : {}),
      ...(args.rowCount !== undefined ? { rowCount: args.rowCount } : {}),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("mexicoCollectorStatus", {
        ...patch,
        lastAttemptAt: now,
      });
    }
    return { ok: true };
  },
});

const metarRowValidator = v.object({
  stationIcao: v.string(),
  reportKey: v.string(),
  rawHash: v.string(),
  typelessHash: v.optional(v.string()),
  firstSource: v.optional(v.string()),
  date: v.string(),
  obsTimeUtc: v.number(),
  obsTimeLocal: v.string(),
  reportTimeUtc: v.optional(v.number()),
  reportType: v.union(v.literal("METAR"), v.literal("SPECI")),
  isCorrection: v.boolean(),
  tempC: v.optional(v.number()),
  tempF: v.optional(v.number()),
  dewpointC: v.optional(v.number()),
  dewpointF: v.optional(v.number()),
  weather: v.optional(v.string()),
  cloudCover: v.optional(v.string()),
  cloudSummary: v.optional(v.string()),
  flightCategory: v.optional(v.string()),
  windDirectionDeg: v.optional(v.number()),
  windSpeedKt: v.optional(v.number()),
  visibilitySm: v.optional(v.number()),
  rawMetar: v.string(),
  rawProviderJson: v.string(),
  initialAwcReceiptTimeUtc: v.optional(v.number()),
  latestAwcReceiptTimeUtc: v.optional(v.number()),
  firstAwcFetchStartedAt: v.optional(v.number()),
  firstAwcSeenAt: v.optional(v.number()),
  firstSeenAt: v.number(),
  fetchStartedAt: v.number(),
  fetchCompletedAt: v.number(),
});

const relaySightingValidator = v.object({
  stationIcao: v.string(),
  source: v.string(),
  date: v.string(),
  obsTimeUtc: v.number(),
  typelessHash: v.string(),
  rawReport: v.string(),
  reportTypeHint: v.optional(v.union(v.literal("METAR"), v.literal("SPECI"))),
  isCorrectionHint: v.optional(v.boolean()),
  fileStampUtc: v.optional(v.number()),
  raceSlotUtc: v.optional(v.number()),
  firstSeenAt: v.number(),
  fetchStartedAt: v.number(),
  fetchCompletedAt: v.number(),
});

function earlierRelaySighting(sightings) {
  return sightings.reduce(
    (earliest, sighting) =>
      !earliest || sighting.firstSeenAt < earliest.firstSeenAt
        ? sighting
        : earliest,
    null,
  );
}

export function buildMetarUpdatePatch(existing, row, earliestSighting) {
  const isAwc = row.firstSource === "awc";
  const patch = {
    typelessHash: row.typelessHash ?? existing.typelessHash,
    firstSource: existing.firstSource ?? row.firstSource ?? "awc",
    lastSeenAt: row.fetchCompletedAt,
    updatedAt: row.fetchCompletedAt,
  };
  if (
    Number.isFinite(earliestSighting?.firstSeenAt) &&
    earliestSighting.firstSeenAt < existing.firstSeenAt
  ) {
    patch.firstSeenAt = earliestSighting.firstSeenAt;
    patch.firstSource = earliestSighting.source;
    patch.relayFirstSeenAt = earliestSighting.firstSeenAt;
    patch.relaySource = earliestSighting.source;
  }
  if (isAwc) {
    for (const field of [
      "reportTimeUtc",
      "tempC",
      "tempF",
      "dewpointC",
      "dewpointF",
      "weather",
      "cloudCover",
      "cloudSummary",
      "flightCategory",
      "windDirectionDeg",
      "windSpeedKt",
      "visibilitySm",
    ]) {
      if (row[field] !== undefined) {
        patch[field] = row[field];
      }
    }
    patch.rawProviderJson = row.rawProviderJson;
    const initialAwcReceiptTimeUtc =
      existing.initialAwcReceiptTimeUtc ?? row.initialAwcReceiptTimeUtc;
    const latestAwcReceiptTimeUtc =
      row.latestAwcReceiptTimeUtc ?? existing.latestAwcReceiptTimeUtc;
    if (initialAwcReceiptTimeUtc !== undefined) {
      patch.initialAwcReceiptTimeUtc = initialAwcReceiptTimeUtc;
    }
    if (latestAwcReceiptTimeUtc !== undefined) {
      patch.latestAwcReceiptTimeUtc = latestAwcReceiptTimeUtc;
    }
    patch.firstAwcFetchStartedAt =
      existing.firstAwcFetchStartedAt ?? row.firstAwcFetchStartedAt;
    patch.firstAwcSeenAt = existing.firstAwcSeenAt ?? row.firstAwcSeenAt;
  } else if (existing.tempC === undefined && row.tempC !== undefined) {
    patch.tempC = row.tempC;
    patch.tempF = row.tempF;
    if (row.dewpointC !== undefined) {
      patch.dewpointC = row.dewpointC;
      patch.dewpointF = row.dewpointF;
    }
  }
  return patch;
}

export const upsertMetarBatch = internalMutationGeneric({
  args: { rows: v.array(metarRowValidator) },
  handler: async (ctx, args) => {
    if (
      args.rows.some((row) => row.firstSource === CAPMA_AFTN_SOURCE) &&
      !capmaAftnAccessApproved()
    ) {
      throw new Error(
        "CAPMA AFTN approval was removed before official-report storage.",
      );
    }
    let insertedCount = 0;
    let updatedCount = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("mexicoMetarObservations")
        .withIndex("by_station_report_key", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("reportKey", row.reportKey),
        )
        .first();
      const relaySightings = row.typelessHash
        ? await ctx.db
            .query("mexicoRelaySightings")
            .withIndex("by_station_obs_hash", (query) =>
              query
                .eq("stationIcao", row.stationIcao)
                .eq("obsTimeUtc", row.obsTimeUtc)
                .eq("typelessHash", row.typelessHash),
            )
            .collect()
        : [];
      const earliestSighting = earlierRelaySighting(relaySightings);
      if (existing) {
        await ctx.db.patch(
          existing._id,
          buildMetarUpdatePatch(existing, row, earliestSighting),
        );
        for (const sighting of relaySightings) {
          if (!sighting.adopted) {
            await ctx.db.patch(sighting._id, {
              adopted: true,
              updatedAt: row.fetchCompletedAt,
            });
          }
        }
        updatedCount += 1;
      } else {
        const relayFirstSeenAt = earliestSighting?.firstSeenAt;
        const relaySource = earliestSighting?.source;
        const firstSeenAt = Math.min(
          row.firstSeenAt,
          relayFirstSeenAt ?? Number.POSITIVE_INFINITY,
        );
        await ctx.db.insert("mexicoMetarObservations", {
          ...row,
          firstSeenAt,
          firstSource:
            firstSeenAt === relayFirstSeenAt
              ? relaySource
              : (row.firstSource ?? "awc"),
          ...(relayFirstSeenAt !== undefined
            ? { relayFirstSeenAt, relaySource }
            : {}),
          lastSeenAt: row.fetchCompletedAt,
          updatedAt: row.fetchCompletedAt,
        });
        for (const sighting of relaySightings) {
          if (!sighting.adopted) {
            await ctx.db.patch(sighting._id, {
              adopted: true,
              updatedAt: row.fetchCompletedAt,
            });
          }
        }
        insertedCount += 1;
      }
    }
    return { insertedCount, updatedCount };
  },
});

export const pollAwcMetars = actionGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    const claim = await ctx.runMutation(internal.mexico.claimCollectorAttempt, {
      stationIcao,
      source: "awc_metar",
      cooldownMs: AWC_COOLDOWN_MS,
    });
    if (!claim.claimed) {
      return { status: "cooldown", retryAfterAt: claim.retryAfterAt };
    }
    const fetchStartedAt = Date.now();
    try {
      const response = await fetch(AWC_METAR_URL, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      });
      const text = await response.text();
      const fetchCompletedAt = Date.now();
      if (!response.ok) {
        throw new Error(
          `AWC METAR request failed (${response.status}): ${text.slice(0, 200)}`,
        );
      }
      const payload = JSON.parse(text);
      if (!Array.isArray(payload)) {
        throw new Error("AWC METAR response was not an array.");
      }
      const rows = [];
      for (const item of payload) {
        const row = await normalizeAwcMetarItem(item, {
          stationIcao,
          fetchStartedAt,
          fetchCompletedAt,
        });
        if (row) {
          rows.push(row);
        }
      }
      const result = await ctx.runMutation(internal.mexico.upsertMetarBatch, {
        rows,
      });
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: "awc_metar",
        status: "ok",
        lastSuccessAt: fetchCompletedAt,
        lastError: "",
        httpStatus: response.status,
        responseBytes: text.length,
        cacheControl: response.headers.get("cache-control") ?? undefined,
        rowCount: rows.length,
      });
      return { status: "ok", ...result, rowCount: rows.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: "awc_metar",
        status: "error",
        lastError: message,
      });
      throw new Error(message);
    }
  },
});

export const recordRelaySightings = internalMutationGeneric({
  args: { rows: v.array(relaySightingValidator) },
  handler: async (ctx, args) => {
    if (
      args.rows.some((row) => row.source === CAPMA_AFTN_SOURCE) &&
      !capmaAftnAccessApproved()
    ) {
      throw new Error(
        "CAPMA AFTN approval was removed before sighting storage.",
      );
    }
    let recordedCount = 0;
    let updatedCount = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("mexicoRelaySightings")
        .withIndex("by_station_source_obs_hash", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("source", row.source)
            .eq("obsTimeUtc", row.obsTimeUtc)
            .eq("typelessHash", row.typelessHash),
        )
        .first();
      let sightingId;
      let effectiveFirstSeenAt;
      if (existing) {
        sightingId = existing._id;
        effectiveFirstSeenAt = Math.min(existing.firstSeenAt, row.firstSeenAt);
        const earlier = row.firstSeenAt < existing.firstSeenAt;
        await ctx.db.patch(existing._id, {
          ...(earlier
            ? {
                firstSeenAt: row.firstSeenAt,
                fetchStartedAt: row.fetchStartedAt,
                fetchCompletedAt: row.fetchCompletedAt,
                ...(row.fileStampUtc !== undefined
                  ? { fileStampUtc: row.fileStampUtc }
                  : {}),
                ...(row.raceSlotUtc !== undefined
                  ? { raceSlotUtc: row.raceSlotUtc }
                  : {}),
              }
            : {}),
          lastSeenAt: row.fetchCompletedAt,
          updatedAt: row.fetchCompletedAt,
        });
        updatedCount += 1;
      } else {
        sightingId = await ctx.db.insert("mexicoRelaySightings", {
          ...row,
          lastSeenAt: row.fetchCompletedAt,
          adopted: false,
          updatedAt: row.fetchCompletedAt,
        });
        effectiveFirstSeenAt = row.firstSeenAt;
        recordedCount += 1;
      }

      const officialRows = await ctx.db
        .query("mexicoMetarObservations")
        .withIndex("by_station_obs_typeless_hash", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("obsTimeUtc", row.obsTimeUtc)
            .eq("typelessHash", row.typelessHash),
        )
        .collect();
      for (const official of officialRows) {
        if (effectiveFirstSeenAt < official.firstSeenAt) {
          await ctx.db.patch(official._id, {
            firstSeenAt: effectiveFirstSeenAt,
            firstSource: row.source,
            relayFirstSeenAt: effectiveFirstSeenAt,
            relaySource: row.source,
            updatedAt: row.fetchCompletedAt,
          });
        }
      }
      if (officialRows.length > 0 && !existing?.adopted) {
        await ctx.db.patch(sightingId, {
          adopted: true,
          updatedAt: row.fetchCompletedAt,
        });
      }
    }
    return { recordedCount, updatedCount };
  },
});

// NOAA's single-station text relay has repeatedly surfaced the latest MMMX
// report tens of seconds before AWC's receiptTime. The file carries no report
// type, so it records an earliest-sighting only; the canonical AWC row adopts
// the earlier firstSeenAt when it arrives. Same once-per-minute discipline as
// the AWC collector.
export const pollNoaaTextMetar = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    raceSlotUtc: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    const claim = await ctx.runMutation(internal.mexico.claimCollectorAttempt, {
      stationIcao,
      source: NOAA_TEXT_SOURCE,
      cooldownMs: AWC_COOLDOWN_MS,
    });
    if (!claim.claimed) {
      return { status: "cooldown", retryAfterAt: claim.retryAfterAt };
    }
    const fetchStartedAt = Date.now();
    try {
      const response = await fetch(NOAA_TEXT_METAR_URL, {
        cache: "no-store",
        headers: {
          "User-Agent": USER_AGENT,
        },
      });
      const text = await response.text();
      const fetchCompletedAt = Date.now();
      if (!response.ok) {
        throw new Error(
          `NOAA text METAR request failed (${response.status}): ${text.slice(0, 200)}`,
        );
      }
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const stampMatch = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(
        lines[0] ?? "",
      );
      const fileStampUtc = stampMatch
        ? Date.UTC(
            Number(stampMatch[1]),
            Number(stampMatch[2]) - 1,
            Number(stampMatch[3]),
            Number(stampMatch[4]),
            Number(stampMatch[5]),
            0,
          )
        : undefined;
      const rawLine = lines[1] ?? "";
      const norm = normalizeMetarRaw(rawLine);
      const timeMatch = norm
        ? /^MMMX (\d{2})(\d{2})(\d{2})Z/.exec(norm.typeless)
        : null;
      const obsTimeUtc = timeMatch
        ? resolveReportObsTimeUtc({
            day: Number(timeMatch[1]),
            hour: Number(timeMatch[2]),
            minute: Number(timeMatch[3]),
            anchorUtc: fetchCompletedAt,
          })
        : null;
      if (!norm || !timeMatch || obsTimeUtc === null) {
        throw new Error(
          "NOAA text METAR body did not contain a usable MMMX report.",
        );
      }
      const typelessHash = await sha256Text(norm.typeless);
      const result = await ctx.runMutation(
        internal.mexico.recordRelaySightings,
        {
          rows: [
            {
              stationIcao,
              source: NOAA_TEXT_SOURCE,
              date: formatMexicoDate(obsTimeUtc),
              obsTimeUtc,
              typelessHash,
              rawReport: norm.collapsed,
              ...(fileStampUtc !== undefined ? { fileStampUtc } : {}),
              ...(args.raceSlotUtc !== undefined
                ? { raceSlotUtc: args.raceSlotUtc }
                : {}),
              firstSeenAt: fetchCompletedAt,
              fetchStartedAt,
              fetchCompletedAt,
            },
          ],
        },
      );
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: NOAA_TEXT_SOURCE,
        status: "ok",
        lastSuccessAt: fetchCompletedAt,
        lastError: "",
        httpStatus: response.status,
        responseBytes: text.length,
        lastModified: response.headers.get("last-modified") ?? undefined,
        rowCount: result.recordedCount,
      });
      return {
        status: "ok",
        ...result,
        obsTimeUtc,
        fetchStartedAt,
        fetchCompletedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: NOAA_TEXT_SOURCE,
        status: "error",
        lastError: message,
      });
      throw new Error(message);
    }
  },
});

const tafTemperatureGroupValidator = v.object({
  kind: v.union(v.literal("maximum"), v.literal("minimum")),
  tempC: v.number(),
  tempF: v.number(),
  forecastTimeUtc: v.number(),
  forecastTimeLocal: v.string(),
  date: v.string(),
  rawGroup: v.string(),
});

const tafPeriodValidator = v.object({
  timeFromUtc: v.number(),
  timeToUtc: v.number(),
  timeFromLocal: v.string(),
  timeToLocal: v.string(),
  changeType: v.optional(v.string()),
  probability: v.optional(v.number()),
  weather: v.optional(v.string()),
  cloudSummary: v.optional(v.string()),
  visibilitySm: v.optional(v.number()),
  windDirectionDeg: v.optional(v.number()),
  windSpeedKt: v.optional(v.number()),
});

const tafCaptureValidator = v.object({
  stationIcao: v.string(),
  tafKey: v.string(),
  rawHash: v.string(),
  rawTaf: v.string(),
  rawProviderJson: v.string(),
  issueTimeUtc: v.number(),
  bulletinTimeUtc: v.optional(v.number()),
  awcDatabaseTimeUtc: v.optional(v.number()),
  validFromUtc: v.number(),
  validToUtc: v.number(),
  isCorrection: v.boolean(),
  isAmendment: v.boolean(),
  temperatureGroups: v.array(tafTemperatureGroupValidator),
  periods: v.array(tafPeriodValidator),
  firstSeenAt: v.number(),
});

export const upsertTafCapture = internalMutationGeneric({
  args: { capture: tafCaptureValidator },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mexicoTafForecasts")
      .withIndex("by_station_taf_key", (query) =>
        query
          .eq("stationIcao", args.capture.stationIcao)
          .eq("tafKey", args.capture.tafKey),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        rawProviderJson: args.capture.rawProviderJson,
        lastSeenAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { inserted: false, id: existing._id };
    }
    const now = Date.now();
    const id = await ctx.db.insert("mexicoTafForecasts", {
      ...args.capture,
      lastSeenAt: args.capture.firstSeenAt,
      createdAt: now,
      updatedAt: now,
    });
    return { inserted: true, id };
  },
});

export const pollAwcTaf = actionGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    const claim = await ctx.runMutation(internal.mexico.claimCollectorAttempt, {
      stationIcao,
      source: "awc_taf",
      cooldownMs: AWC_COOLDOWN_MS,
    });
    if (!claim.claimed) {
      return { status: "cooldown", retryAfterAt: claim.retryAfterAt };
    }
    try {
      const response = await fetch(AWC_TAF_URL, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
      });
      const text = await response.text();
      const receivedAt = Date.now();
      if (!response.ok) {
        throw new Error(
          `AWC TAF request failed (${response.status}): ${text.slice(0, 200)}`,
        );
      }
      const payload = JSON.parse(text);
      const item = Array.isArray(payload)
        ? payload.find(
            (candidate) =>
              String(candidate?.icaoId ?? "").toUpperCase() === stationIcao,
          )
        : null;
      const rawTaf = String(item?.rawTAF ?? "").trim();
      const issueTimeUtc = parseEpoch(item?.issueTime);
      const validFromUtc = parseEpoch(item?.validTimeFrom);
      const validToUtc = parseEpoch(item?.validTimeTo);
      if (
        !rawTaf ||
        !Number.isFinite(issueTimeUtc) ||
        !Number.isFinite(validFromUtc) ||
        !Number.isFinite(validToUtc)
      ) {
        throw new Error("AWC TAF response did not include a usable MMMX TAF.");
      }
      const rawHash = await sha256Text(rawTaf);
      const temperatureGroups = parseTafTemperatureGroups(
        rawTaf,
        validFromUtc,
        validToUtc,
      );
      const periods = (Array.isArray(item?.fcsts) ? item.fcsts : [])
        .map(normalizeTafPeriod)
        .filter(Boolean);
      const bulletinTimeUtc = parseEpoch(item?.bulletinTime);
      const awcDatabaseTimeUtc = parseEpoch(item?.dbPopTime);
      const result = await ctx.runMutation(internal.mexico.upsertTafCapture, {
        capture: {
          stationIcao,
          tafKey: `${stationIcao}:${issueTimeUtc}:${rawHash}`,
          rawHash,
          rawTaf,
          rawProviderJson: JSON.stringify(item),
          issueTimeUtc,
          ...(Number.isFinite(bulletinTimeUtc) ? { bulletinTimeUtc } : {}),
          ...(Number.isFinite(awcDatabaseTimeUtc)
            ? { awcDatabaseTimeUtc }
            : {}),
          validFromUtc,
          validToUtc,
          isCorrection: /\bCOR\b/i.test(rawTaf),
          isAmendment: /\bAMD\b/i.test(rawTaf),
          temperatureGroups,
          periods,
          firstSeenAt: receivedAt,
        },
      });
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: "awc_taf",
        status: "ok",
        lastSuccessAt: receivedAt,
        lastError: "",
        httpStatus: response.status,
        responseBytes: text.length,
        cacheControl: response.headers.get("cache-control") ?? undefined,
        rowCount: periods.length,
      });
      return {
        status: "ok",
        inserted: result.inserted,
        temperatureGroupCount: temperatureGroups.length,
        periodCount: periods.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.mexico.finishCollectorAttempt, {
        stationIcao,
        source: "awc_taf",
        status: "error",
        lastError: message,
      });
      throw new Error(message);
    }
  },
});

const smnHourlyRowValidator = v.object({
  date: v.string(),
  forecastTimeUtc: v.number(),
  forecastTimeLocal: v.string(),
  tempC: v.number(),
  tempF: v.number(),
  conditionText: v.string(),
  conditionKey: v.string(),
  precipitationProbabilityPct: v.optional(v.number()),
  precipitationMm: v.optional(v.number()),
  humidityPct: v.optional(v.number()),
  dewpointC: v.optional(v.number()),
  dewpointF: v.optional(v.number()),
  windSpeedKph: v.optional(v.number()),
  windDirectionText: v.optional(v.string()),
  windDirectionDeg: v.optional(v.number()),
  windGustKph: v.optional(v.number()),
  utcOffsetHours: v.number(),
  sourceRowJson: v.string(),
});

export const storeSmnForecastBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    sourceUrl: v.string(),
    capturedAt: v.number(),
    sourceLastModifiedAt: v.optional(v.number()),
    rawHash: v.string(),
    compressedBytes: v.number(),
    decompressedBytes: v.number(),
    totalObjectCount: v.number(),
    rawMunicipalityRows: v.string(),
    rows: v.array(smnHourlyRowValidator),
  },
  handler: async (ctx, args) => {
    assertStation(args.stationIcao);
    if (!args.rows.length || args.rows.length > 240) {
      throw new Error("SMN forecast batch has an unexpected target row count.");
    }
    const captureId = await ctx.db.insert("mexicoSmnForecastCaptures", {
      stationIcao: args.stationIcao,
      source: "smn_municipal_hourly",
      sourceUrl: args.sourceUrl,
      municipalityStateId: "9",
      municipalityId: "17",
      municipalityName: "Venustiano Carranza",
      stateName: "Ciudad de México",
      sourceLatitude: 19.4193,
      sourceLongitude: -99.1137,
      distanceFromAirportKm: 4.8,
      capturedAt: args.capturedAt,
      capturedAtLocal: formatMexicoDateTime(args.capturedAt),
      captureDate: formatMexicoDate(args.capturedAt),
      ...(args.sourceLastModifiedAt !== undefined
        ? { sourceLastModifiedAt: args.sourceLastModifiedAt }
        : {}),
      rawHash: args.rawHash,
      compressedBytes: args.compressedBytes,
      decompressedBytes: args.decompressedBytes,
      totalObjectCount: args.totalObjectCount,
      targetRowCount: args.rows.length,
      rawMunicipalityRows: args.rawMunicipalityRows,
      createdAt: Date.now(),
    });

    let insertedCount = 0;
    let updatedCount = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("mexicoSmnHourlyForecasts")
        .withIndex("by_station_time", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("forecastTimeUtc", row.forecastTimeUtc),
        )
        .first();
      const value = {
        stationIcao: args.stationIcao,
        ...row,
        source: "smn_municipal_hourly",
        sourceSiteLabel: "Venustiano Carranza · 4.8 km from MMMX",
        capturedAt: args.capturedAt,
        ...(args.sourceLastModifiedAt !== undefined
          ? { sourceLastModifiedAt: args.sourceLastModifiedAt }
          : {}),
        forecastCaptureId: captureId,
        updatedAt: Date.now(),
      };
      if (existing) {
        await ctx.db.patch(existing._id, value);
        updatedCount += 1;
      } else {
        await ctx.db.insert("mexicoSmnHourlyForecasts", {
          ...value,
          createdAt: Date.now(),
        });
        insertedCount += 1;
      }
    }
    return { captureId, insertedCount, updatedCount };
  },
});

export const getDayDashboard = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    if (!isDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const [storedMetarRows, smnRows, recentTafs, statuses] = await Promise.all([
      ctx.db
        .query("mexicoMetarObservations")
        .withIndex("by_station_date_obs", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", args.date),
        )
        .collect(),
      ctx.db
        .query("mexicoSmnHourlyForecasts")
        .withIndex("by_station_date_time", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", args.date),
        )
        .collect(),
      ctx.db
        .query("mexicoTafForecasts")
        .withIndex("by_station_issue_time", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .order("desc")
        .take(40),
      ctx.db
        .query("mexicoCollectorStatus")
        .withIndex("by_station_source", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .collect(),
    ]);

    const capmaAftnApproved = capmaAftnAccessApproved();
    const metarRows = publicMetarRowsForCapmaApproval(
      storedMetarRows,
      capmaAftnApproved,
    );
    metarRows.sort((left, right) =>
      left.obsTimeUtc !== right.obsTimeUtc
        ? left.obsTimeUtc - right.obsTimeUtc
        : left.firstSeenAt - right.firstSeenAt,
    );
    smnRows.sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc);
    const taf =
      recentTafs.find((capture) =>
        capture.temperatureGroups.some((group) => group.date === args.date),
      ) ??
      recentTafs.find((capture) => {
        const localDates = [
          formatMexicoDate(capture.validFromUtc),
          formatMexicoDate(
            Math.max(capture.validFromUtc, capture.validToUtc - 1),
          ),
        ];
        return localDates.includes(args.date);
      }) ??
      null;

    const capmaAccessApproved =
      process.env.SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED === "true";
    const capmaRetentionApproved =
      process.env.SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED === "true";
    const capmaRepublicationApproved =
      process.env.SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED === "true";
    const capmaVisible =
      capmaAccessApproved &&
      capmaRetentionApproved &&
      capmaRepublicationApproved;
    const capmaRows = capmaVisible
      ? await ctx.db
          .query("mexicoCapmaTdzObservations")
          .withIndex("by_station_date_screen_time", (query) =>
            query.eq("stationIcao", stationIcao).eq("date", args.date),
          )
          .collect()
      : [];
    capmaRows.sort((left, right) => left.screenTimeUtc - right.screenTimeUtc);

    const nowMs = Date.now();
    const isToday = args.date === formatMexicoDate(nowMs);
    let capmaMetarSimilarity = null;
    if (capmaVisible) {
      const previousDayMetars = isToday
        ? publicMetarRowsForCapmaApproval(
            await ctx.db
              .query("mexicoMetarObservations")
              .withIndex("by_station_date_obs", (query) =>
                query
                  .eq("stationIcao", stationIcao)
                  .eq("date", shiftDateKey(args.date, -1)),
              )
              .collect(),
            capmaAftnApproved,
          )
        : [];
      const rollingStartUtc = nowMs - 24 * 60 * 60 * 1000;
      const rollingReleaseMetars = [...previousDayMetars, ...metarRows].filter(
        (row) => {
          const anchor = resolveCapmaComparisonAnchor(row, "release");
          return (
            anchor &&
            anchor.timeUtc >= rollingStartUtc &&
            anchor.timeUtc <= nowMs
          );
        },
      );
      const rollingObservationMetars = [
        ...previousDayMetars,
        ...metarRows,
      ].filter(
        (row) =>
          Number.isFinite(row.obsTimeUtc) &&
          row.obsTimeUtc >= rollingStartUtc &&
          row.obsTimeUtc <= nowMs,
      );
      const comparisonMetars = new Map();
      for (const row of [
        ...metarRows,
        ...rollingReleaseMetars,
        ...rollingObservationMetars,
      ]) {
        comparisonMetars.set(row.reportKey, row);
      }
      const comparisonCenters = [];
      for (const row of comparisonMetars.values()) {
        if (!Number.isFinite(row.tempC)) {
          continue;
        }
        const releaseAnchor = resolveCapmaComparisonAnchor(row, "release");
        if (releaseAnchor) {
          comparisonCenters.push(releaseAnchor.timeUtc);
        }
        if (Number.isFinite(row.obsTimeUtc)) {
          comparisonCenters.push(row.obsTimeUtc);
        }
      }
      const comparisonCapmaRows = comparisonCenters.length
        ? await ctx.db
            .query("mexicoCapmaTdzObservations")
            .withIndex("by_station_screen_time", (query) =>
              query
                .eq("stationIcao", stationIcao)
                .gte(
                  "screenTimeUtc",
                  Math.min(...comparisonCenters) - CAPMA_METAR_WINDOW_MS,
                )
                .lte(
                  "screenTimeUtc",
                  Math.max(...comparisonCenters) + CAPMA_METAR_WINDOW_MS,
                ),
            )
            .collect()
        : [];
      const selectedDay = {
        releaseTime: buildCapmaMetarSimilarity({
          metarRows,
          capmaRows: comparisonCapmaRows,
          anchorMode: "release",
          nowMs,
        }),
        observationTime: buildCapmaMetarSimilarity({
          metarRows,
          capmaRows: comparisonCapmaRows,
          anchorMode: "observation",
          nowMs,
        }),
      };
      capmaMetarSimilarity = {
        selectedDay,
        rolling24h: isToday
          ? {
              hours: 24,
              releaseTime: buildCapmaMetarSimilarity({
                metarRows: rollingReleaseMetars,
                capmaRows: comparisonCapmaRows,
                anchorMode: "release",
                nowMs,
              }),
              observationTime: buildCapmaMetarSimilarity({
                metarRows: rollingObservationMetars,
                capmaRows: comparisonCapmaRows,
                anchorMode: "observation",
                nowMs,
              }),
            }
          : null,
      };
    }

    const emptyCapmaLatestImages = { "05": null, 23: null };
    let capmaLatestImages = emptyCapmaLatestImages;
    if (capmaVisible) {
      const [tdz05, tdz23] = await Promise.all(
        ["05", "23"].map((tdz) =>
          ctx.db
            .query("mexicoCapmaLatestImages")
            .withIndex("by_station_tdz", (query) =>
              query.eq("stationIcao", stationIcao).eq("tdz", tdz),
            )
            .first(),
        ),
      );
      const publicLatestImages = await Promise.all(
        [tdz05, tdz23].map(async (row) => {
          if (!row) {
            return null;
          }
          const storageMetadata = await ctx.db.system.get(
            "_storage",
            row.storageId,
          );
          if (
            !storageMetadata ||
            storageMetadata.sha256 !== row.storageSha256 ||
            storageMetadata.size !== row.responseBytes ||
            storageMetadata.contentType !== row.contentType
          ) {
            return null;
          }
          const path =
            "/mexico/capma/latest-image" +
            `?stationIcao=${encodeURIComponent(stationIcao)}` +
            `&tdz=${encodeURIComponent(row.tdz)}` +
            `&rawHash=${encodeURIComponent(row.rawHash)}`;
          return {
            tdz: row.tdz,
            path,
            rawHash: row.rawHash,
            contentType: row.contentType,
            screenTimeUtc: row.screenTimeUtc,
            screenTimeLocal: row.screenTimeLocal,
            screenTimestampRaw: row.screenTimestampRaw,
            currentTempC: row.currentTempC,
            twoMinuteTempC: row.twoMinuteTempC,
            fetchCompletedAt: row.fetchCompletedAt,
            responseBytes: row.responseBytes,
            imageWidth: row.imageWidth,
            imageHeight: row.imageHeight,
            ocrConfidence: row.ocrConfidence,
            sourceSiteLabel: row.sourceSiteLabel,
          };
        }),
      );
      capmaLatestImages = {
        "05": publicLatestImages[0],
        23: publicLatestImages[1],
      };
    }

    return {
      stationIcao,
      date: args.date,
      timezone: MEXICO_TIMEZONE,
      metarRows,
      smnRows,
      taf,
      collectorStatuses: Object.fromEntries(
        statuses.map((status) => [status.source, status]),
      ),
      capma: {
        accessApproved: capmaAccessApproved,
        retentionApproved: capmaRetentionApproved,
        republicationApproved: capmaRepublicationApproved,
        visible: capmaVisible,
        rows: capmaRows,
        latestImages: capmaLatestImages,
        metarSimilarity: capmaMetarSimilarity,
      },
    };
  },
});
