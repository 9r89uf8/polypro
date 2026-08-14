import {
  dedupeAirframesDatisRows,
  parseAirframesDatisMessage,
} from "./madridDatisParser.js";
import {
  AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
  AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
  evaluateAirframesDatisStreamAccess,
  evaluateAirframesDatisStreamRuntime,
} from "./madridDatisStreamAccess.js";

const SUPPORTED_STATION_ICAO = "LEMD";
const STREAM_SOURCE = "airframes_acars_datis_stream";
const DEFAULT_MAX_MESSAGES_PER_EVENT = 250;
const DEFAULT_MAX_TEXT_LENGTH = 16 * 1024;
const MAX_PROVIDER_ERROR_LENGTH = 280;

const SINGLE_MESSAGE_EVENTS = new Set(["message", "feed:message"]);
const CONTROL_EVENTS = new Set([
  "feed:authenticated",
  "messages:sniff:started",
  "station:monitor:started",
  "station:monitor:stopped",
]);
const ERROR_EVENTS = new Set(["error", "feed:error"]);

function emptyResult(eventName, status, extra = {}) {
  return {
    status,
    eventName,
    messageCount: 0,
    parsedCount: 0,
    rejectedCount: 0,
    duplicateCount: 0,
    truncatedCount: 0,
    rows: [],
    ...extra,
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeEventName(value) {
  return String(value ?? "").trim();
}

function sanitizeProviderError(payload) {
  let message = "";
  if (typeof payload === "string") {
    message = payload;
  } else if (isRecord(payload) && typeof payload.message === "string") {
    message = payload.message;
  }
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_PROVIDER_ERROR_LENGTH);
}

function extractEventMessages(eventName, payload, maxMessagesPerEvent) {
  let candidates;
  if (SINGLE_MESSAGE_EVENTS.has(eventName)) {
    candidates = Array.isArray(payload) ? payload : [payload];
  } else if (
    eventName === "station:monitor:data" &&
    isRecord(payload) &&
    Array.isArray(payload.newMessages)
  ) {
    candidates = payload.newMessages;
  } else {
    return {
      valid: false,
      messages: [],
      truncatedCount: 0,
    };
  }

  const truncatedCount = Math.max(
    0,
    candidates.length - maxMessagesPerEvent,
  );
  return {
    valid: candidates.length > 0,
    messages: candidates.slice(0, maxMessagesPerEvent),
    truncatedCount,
  };
}

/**
 * Repair line-wrap artifacts seen in ACARS D-ATIS text before delegating to
 * the existing strict Madrid parser. For example, "ATIS A / RR" is the split
 * form of "ATIS ARR"; the same applies to "D / EP".
 */
export function normalizeAirframesDatisStreamText(text) {
  return String(text ?? "")
    .replace(
      /\bLEMD\s+ATIS\s+A(?:[\s/\\|._-]*)RR(?=\s+[A-Z]\s+\d{4}Z\b)/gi,
      "LEMD ATIS ARR",
    )
    .replace(
      /\bLEMD\s+ATIS\s+D(?:[\s/\\|._-]*)EP(?=\s+[A-Z]\s+\d{4}Z\b)/gi,
      "LEMD ATIS DEP",
    )
    .replace(/\bLEMD\s+ATIS\s+ARRIVAL\b/gi, "LEMD ATIS ARR")
    .replace(/\bLEMD\s+ATIS\s+DEPARTURE\b/gi, "LEMD ATIS DEP");
}

/**
 * Copy only fields required by parseAirframesDatisMessage. Aircraft, flight,
 * tail, feeder, frequency, and raw envelope metadata are intentionally
 * dropped before parsing and never appear in the returned derived row.
 */
export function minimizeAirframesDatisStreamMessage(
  message,
  { maxTextLength = DEFAULT_MAX_TEXT_LENGTH } = {},
) {
  if (!isRecord(message) || typeof message.text !== "string") {
    return null;
  }
  if (
    !Number.isInteger(maxTextLength) ||
    maxTextLength <= 0 ||
    message.text.length > maxTextLength
  ) {
    return null;
  }

  return {
    text: normalizeAirframesDatisStreamText(message.text),
    ...(message.timestamp !== undefined
      ? { timestamp: message.timestamp }
      : {}),
    ...(message.createdAt !== undefined
      ? { createdAt: message.createdAt }
      : {}),
    ...(message.receivedAt !== undefined
      ? { receivedAt: message.receivedAt }
      : {}),
  };
}

export function parseAirframesDatisStreamMessage(message, options = {}) {
  const minimized = minimizeAirframesDatisStreamMessage(message, options);
  const parsed = minimized
    ? parseAirframesDatisMessage(minimized, options)
    : null;
  return parsed ? { ...parsed, source: STREAM_SOURCE } : null;
}

/**
 * Parse one documented Socket.IO server event. approvalValue is required and
 * defaults closed when omitted. The result contains only aggregate counters
 * and minimized D-ATIS rows, never the source ACARS envelope.
 */
export function parseAirframesDatisStreamEvent(
  eventNameValue,
  payload,
  {
    approvalValue,
    nowMs = Date.now(),
    maxMessagesPerEvent = DEFAULT_MAX_MESSAGES_PER_EVENT,
    maxTextLength = DEFAULT_MAX_TEXT_LENGTH,
    maxMessageAgeMs,
    maxDeliveryLagMs,
  } = {},
) {
  const eventName = normalizeEventName(eventNameValue);
  const access = evaluateAirframesDatisStreamAccess(approvalValue);
  if (!access.approved) {
    return emptyResult(eventName, access.status, {
      approvalFlagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
    });
  }

  if (ERROR_EVENTS.has(eventName)) {
    return emptyResult(eventName, "provider_error", {
      message: sanitizeProviderError(payload) || "Airframes stream error",
    });
  }
  if (CONTROL_EVENTS.has(eventName)) {
    return emptyResult(eventName, "control");
  }
  if (
    !Number.isInteger(maxMessagesPerEvent) ||
    maxMessagesPerEvent <= 0
  ) {
    return emptyResult(eventName, "invalid_configuration");
  }

  const extracted = extractEventMessages(
    eventName,
    payload,
    maxMessagesPerEvent,
  );
  if (!extracted.valid) {
    return emptyResult(
      eventName,
      SINGLE_MESSAGE_EVENTS.has(eventName) ||
        eventName === "station:monitor:data"
        ? "invalid_payload"
        : "ignored_event",
    );
  }

  const parserOptions = {
    nowMs,
    maxTextLength,
    ...(maxMessageAgeMs !== undefined ? { maxMessageAgeMs } : {}),
    ...(maxDeliveryLagMs !== undefined ? { maxDeliveryLagMs } : {}),
  };
  const parsedRows = extracted.messages
    .map((message) =>
      parseAirframesDatisStreamMessage(message, parserOptions),
    )
    .filter(Boolean);
  const rows = dedupeAirframesDatisRows(parsedRows);

  return {
    status: rows.length ? "ok" : "no_data",
    eventName,
    messageCount: extracted.messages.length,
    parsedCount: parsedRows.length,
    rejectedCount: extracted.messages.length - parsedRows.length,
    duplicateCount: parsedRows.length - rows.length,
    truncatedCount: extracted.truncatedCount,
    rows,
  };
}

function minimizeStoreRow(row) {
  if (
    !isRecord(row) ||
    row.stationIcao !== SUPPORTED_STATION_ICAO ||
    typeof row.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
    !isFiniteNumber(row.reportTsUtc) ||
    typeof row.reportTimeLocal !== "string" ||
    (row.reportKind !== "ARR" && row.reportKind !== "DEP") ||
    typeof row.designator !== "string" ||
    !/^[A-Z]$/.test(row.designator) ||
    !isFiniteNumber(row.tempC) ||
    !isFiniteNumber(row.tempF) ||
    !isFiniteNumber(row.dewPointC) ||
    !isFiniteNumber(row.dewPointF) ||
    !isFiniteNumber(row.receivedAtUtc) ||
    typeof row.receivedAtLocal !== "string" ||
    !isFiniteNumber(row.deliveryLagMs) ||
    row.deliveryLagMs < 0 ||
    row.source !== STREAM_SOURCE ||
    typeof row.dedupeKey !== "string" ||
    !row.dedupeKey
  ) {
    return null;
  }

  return {
    stationIcao: row.stationIcao,
    date: row.date,
    reportTsUtc: row.reportTsUtc,
    reportTimeLocal: row.reportTimeLocal,
    reportKind: row.reportKind,
    designator: row.designator,
    tempC: row.tempC,
    tempF: row.tempF,
    dewPointC: row.dewPointC,
    dewPointF: row.dewPointF,
    receivedAtUtc: row.receivedAtUtc,
    receivedAtLocal: row.receivedAtLocal,
    deliveryLagMs: row.deliveryLagMs,
    source: row.source,
    dedupeKey: row.dedupeKey,
  };
}

/**
 * Build arguments compatible with the existing Madrid D-ATIS batch storage
 * shape. The caller must re-read both Convex flags and call this immediately
 * before its storage mutation; either closed gate returns no storage
 * arguments.
 */
export function buildAirframesDatisStreamStoreArgs(
  parsedEvent,
  {
    approvalValue,
    connectionEnabledValue,
    attemptedAt = Date.now(),
  } = {},
) {
  const runtime = evaluateAirframesDatisStreamRuntime(
    approvalValue,
    connectionEnabledValue,
  );
  if (!runtime.ready) {
    return {
      status: runtime.status,
      approvalFlagName: AIRFRAMES_DATIS_STREAM_APPROVAL_FLAG,
      connectionFlagName: AIRFRAMES_DATIS_STREAM_CONNECTION_FLAG,
      storeArgs: null,
    };
  }

  if (
    !isRecord(parsedEvent) ||
    parsedEvent.status !== "ok" ||
    !Array.isArray(parsedEvent.rows) ||
    parsedEvent.rows.length === 0 ||
    !Number.isFinite(attemptedAt)
  ) {
    return {
      status: "no_data",
      storeArgs: null,
    };
  }

  const rows = parsedEvent.rows.map(minimizeStoreRow);
  if (rows.some((row) => row === null)) {
    return {
      status: "invalid_rows",
      storeArgs: null,
    };
  }

  return {
    status: "ready",
    storeArgs: {
      stationIcao: SUPPORTED_STATION_ICAO,
      attemptedAt,
      fetchedCount: Number.isFinite(parsedEvent.messageCount)
        ? parsedEvent.messageCount
        : 0,
      rejectedCount: Number.isFinite(parsedEvent.rejectedCount)
        ? parsedEvent.rejectedCount
        : 0,
      duplicateCount: Number.isFinite(parsedEvent.duplicateCount)
        ? parsedEvent.duplicateCount
        : 0,
      rows,
    },
  };
}
