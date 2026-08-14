const MADRID_TIMEZONE = "Europe/Madrid";
const DEFAULT_MAX_MESSAGE_AGE_MS = 36 * 60 * 60 * 1000;
const DEFAULT_MAX_DELIVERY_LAG_MS = 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MIN_TEMPERATURE_C = -80;
const MAX_TEMPERATURE_C = 60;
const MIN_DEW_POINT_C = -100;
const MAX_DEW_POINT_C = 60;

const madridDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const madridDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getDateParts(formatter, date) {
  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatMadridDate(epochMs) {
  const parts = getDateParts(madridDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatMadridDateTime(epochMs) {
  const parts = getDateParts(madridDateTimeFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

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
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMessageText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function parseSignedTemperature(sign, magnitude) {
  const parsed = Number(magnitude);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return sign ? -parsed : parsed;
}

function reconstructReportTimestamp(receivedAtUtc, reportHour, reportMinute) {
  const receivedAt = new Date(receivedAtUtc);
  let reportTsUtc = Date.UTC(
    receivedAt.getUTCFullYear(),
    receivedAt.getUTCMonth(),
    receivedAt.getUTCDate(),
    reportHour,
    reportMinute,
  );

  if (reportTsUtc > receivedAtUtc + MAX_FUTURE_SKEW_MS) {
    reportTsUtc -= 24 * 60 * 60 * 1000;
  }
  return reportTsUtc;
}

function getSourceReceivedAt(message) {
  const candidates = [
    parseEpoch(message?.timestamp),
    parseEpoch(message?.createdAt),
    parseEpoch(message?.receivedAt),
  ].filter(Number.isFinite);
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * Parse only the minimum D-ATIS fields needed by the Madrid temperature chart.
 * Aircraft, feeder, tail, flight and raw-message fields are deliberately not
 * copied into the returned row.
 */
export function parseAirframesDatisMessage(
  message,
  {
    nowMs = Date.now(),
    maxMessageAgeMs = DEFAULT_MAX_MESSAGE_AGE_MS,
    maxDeliveryLagMs = DEFAULT_MAX_DELIVERY_LAG_MS,
  } = {},
) {
  const text = normalizeMessageText(message?.text);
  const headerMatch =
    /\bLEMD\s+ATIS\s+(ARR|DEP)\s+([A-Z])\s+(\d{2})(\d{2})Z\b/.exec(text);
  if (!headerMatch) {
    return null;
  }

  const temperatureMatch =
    /\bT\s*(MS|M|-)?\s*(\d{1,2})\s+DP\s*(MS|M|-)?\s*(\d{1,2})\b/.exec(
      text,
    );
  if (!temperatureMatch) {
    return null;
  }

  const reportHour = Number(headerMatch[3]);
  const reportMinute = Number(headerMatch[4]);
  if (
    !Number.isInteger(reportHour) ||
    reportHour < 0 ||
    reportHour > 23 ||
    !Number.isInteger(reportMinute) ||
    reportMinute < 0 ||
    reportMinute > 59
  ) {
    return null;
  }

  const tempC = parseSignedTemperature(
    temperatureMatch[1],
    temperatureMatch[2],
  );
  const dewPointC = parseSignedTemperature(
    temperatureMatch[3],
    temperatureMatch[4],
  );
  if (
    !Number.isFinite(tempC) ||
    tempC < MIN_TEMPERATURE_C ||
    tempC > MAX_TEMPERATURE_C ||
    !Number.isFinite(dewPointC) ||
    dewPointC < MIN_DEW_POINT_C ||
    dewPointC > MAX_DEW_POINT_C
  ) {
    return null;
  }

  const receivedAtUtc = getSourceReceivedAt(message);
  if (
    !Number.isFinite(receivedAtUtc) ||
    receivedAtUtc > nowMs + MAX_FUTURE_SKEW_MS ||
    nowMs - receivedAtUtc > maxMessageAgeMs
  ) {
    return null;
  }

  const reportTsUtc = reconstructReportTimestamp(
    receivedAtUtc,
    reportHour,
    reportMinute,
  );
  const deliveryLagMs = receivedAtUtc - reportTsUtc;
  if (
    deliveryLagMs < -MAX_FUTURE_SKEW_MS ||
    deliveryLagMs > maxDeliveryLagMs
  ) {
    return null;
  }

  const reportKind = headerMatch[1];
  const designator = headerMatch[2];
  const dedupeKey = `${reportKind}:${designator}:${reportTsUtc}`;

  return {
    stationIcao: "LEMD",
    date: formatMadridDate(reportTsUtc),
    reportTsUtc,
    reportTimeLocal: formatMadridDateTime(reportTsUtc),
    reportKind,
    designator,
    tempC,
    tempF: toFahrenheit(tempC),
    dewPointC,
    dewPointF: toFahrenheit(dewPointC),
    receivedAtUtc,
    receivedAtLocal: formatMadridDateTime(receivedAtUtc),
    deliveryLagMs: Math.max(0, Math.round(deliveryLagMs)),
    source: "airframes_acars_datis",
    dedupeKey,
  };
}

export function dedupeAirframesDatisRows(rows) {
  const byReport = new Map();
  for (const row of rows) {
    const existing = byReport.get(row.dedupeKey);
    if (
      !existing ||
      row.receivedAtUtc < existing.receivedAtUtc
    ) {
      byReport.set(row.dedupeKey, row);
    }
  }
  return [...byReport.values()].sort(
    (a, b) =>
      a.reportTsUtc - b.reportTsUtc ||
      a.reportKind.localeCompare(b.reportKind) ||
      a.designator.localeCompare(b.designator),
  );
}

export function parseAirframesDatisPayload(payload, options = {}) {
  const messages = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.messages)
      ? payload.messages
      : Array.isArray(payload?.data)
        ? payload.data
        : null;
  if (!messages) {
    throw new Error("Airframes response did not contain a message array.");
  }

  const parsedRows = messages
    .map((message) => parseAirframesDatisMessage(message, options))
    .filter(Boolean);
  const rows = dedupeAirframesDatisRows(parsedRows);

  return {
    messageCount: messages.length,
    parsedCount: parsedRows.length,
    rejectedCount: messages.length - parsedRows.length,
    duplicateCount: parsedRows.length - rows.length,
    rows,
  };
}
