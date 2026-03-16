import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const PARIS_TIMEZONE = "Europe/Paris";
const AEROWEB_FETCH_TIMEOUT_MS = 25000;
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const RACE_SOURCE = {
  AEROWEB: "aeroweb",
  TGFTP: "tgftp",
};
const PUBLISH_RACE_WINNER = {
  AEROWEB: "aeroweb",
  TGFTP: "tgftp",
  TIE: "tie",
};
const DEFAULT_RACE_QUERY_LIMIT = 12;
const MAX_RACE_QUERY_LIMIT = 48;
const DEFAULT_RACE_WATCH_INTERVAL_MS = 1000;
const DEFAULT_RACE_WATCH_DURATION_MS = 10 * 60 * 1000;

const parisDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PARIS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const parisDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PARIS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

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

function formatParisDate(epochMs) {
  const parts = getDateParts(parisDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatParisDateTime(epochMs) {
  const parts = getDateParts(parisDateTimeFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
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

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function toNonEmptyString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function parseNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSignedMetarTemp(tempToken) {
  if (!tempToken || tempToken === "//") {
    return null;
  }
  const cleaned = tempToken.trim();
  if (!/^(M?\d{2})$/.test(cleaned)) {
    return null;
  }
  const isNegative = cleaned.startsWith("M");
  const magnitude = Number(isNegative ? cleaned.slice(1) : cleaned);
  if (!Number.isFinite(magnitude)) {
    return null;
  }
  return isNegative ? -magnitude : magnitude;
}

function parseReportedTempC(value) {
  const match = /(-?\d+(?:\.\d+)?)/.exec(String(value ?? ""));
  if (!match) {
    return null;
  }
  return parseNumber(match[1]);
}

function extractTempInfo(rawMetar, reportedTempText) {
  const reportedTempC = parseReportedTempC(reportedTempText);
  if (reportedTempC !== null) {
    return {
      tempC: roundToTenth(reportedTempC),
      source: "reported_temp",
    };
  }

  const mainTempMatch = String(rawMetar ?? "").match(/\b(M?\d{2})\/(M?\d{2}|\/\/)\b/);
  if (mainTempMatch) {
    const parsedTemp = parseSignedMetarTemp(mainTempMatch[1]);
    if (parsedTemp !== null) {
      return {
        tempC: roundToTenth(parsedTemp),
        source: "metar_integer",
      };
    }
  }

  return null;
}

function extractReportType(rawMetar) {
  const match = /^(METAR|SPECI)\b/.exec(String(rawMetar ?? "").trim().toUpperCase());
  return match ? match[1] : null;
}

function parseReportTimestampFromRaw(rawMetar, nowEpochMs = Date.now()) {
  const match = /^(METAR|SPECI)\s+[A-Z0-9]{4}\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(
    String(rawMetar ?? "").trim(),
  );
  if (!match) {
    return null;
  }

  const now = new Date(nowEpochMs);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const reportDay = Number(match[2]);
  const reportHour = Number(match[3]);
  const reportMinute = Number(match[4]);

  const candidates = [
    Date.UTC(currentYear, currentMonth - 1, reportDay, reportHour, reportMinute, 0, 0),
    Date.UTC(currentYear, currentMonth, reportDay, reportHour, reportMinute, 0, 0),
    Date.UTC(currentYear, currentMonth + 1, reportDay, reportHour, reportMinute, 0, 0),
  ].filter(Number.isFinite);

  let bestCandidate = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - nowEpochMs);
    if (distance < bestDistance) {
      bestCandidate = candidate;
      bestDistance = distance;
    }
  }
  return bestCandidate;
}

function parseNoaaLatestTxt(rawText) {
  const cleaned = String(rawText ?? "")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned) {
    throw new Error("NOAA latest response was empty.");
  }

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let timestampLine = "";
  let metarLine = "";

  if (lines.length >= 2) {
    timestampLine = lines[0];
    metarLine = lines.slice(1).join(" ").trim();
  } else {
    const oneLineMatch = cleaned.match(
      /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\s+(.+)$/,
    );
    if (!oneLineMatch) {
      throw new Error(`Unexpected NOAA format: ${cleaned.slice(0, 120)}`);
    }
    timestampLine = oneLineMatch[1];
    metarLine = oneLineMatch[2].trim();
  }

  const stampMatch = timestampLine.match(
    /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/,
  );
  if (!stampMatch) {
    throw new Error(`Unexpected NOAA timestamp format: ${timestampLine}`);
  }
  if (!metarLine) {
    throw new Error("NOAA latest response did not include a METAR line.");
  }

  return {
    tsUtc: Date.UTC(
      Number(stampMatch[1]),
      Number(stampMatch[2]) - 1,
      Number(stampMatch[3]),
      Number(stampMatch[4]),
      Number(stampMatch[5]),
      0,
      0,
    ),
    rawMetar: metarLine,
  };
}

function parseHttpTimestamp(value) {
  const epochMs = Date.parse(String(value ?? "").trim());
  return Number.isFinite(epochMs) ? epochMs : null;
}

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, entity) => {
      const named = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: " ",
        quot: '"',
      };
      if (named[entity]) {
        return named[entity];
      }
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const parsed = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
      }
      if (entity.startsWith("#")) {
        const parsed = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
      }
      return match;
    },
  );
}

function normalizeAerowebHtmlText(value) {
  return decodeHtmlEntities(String(value ?? ""))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeLabeledRawMetar(reportType, rawMetar) {
  const normalizedType = String(reportType ?? "").trim().toUpperCase();
  const normalizedRaw = toNonEmptyString(rawMetar);
  if (!normalizedRaw) {
    return null;
  }
  if (!normalizedType) {
    return normalizedRaw;
  }
  if (normalizedRaw.toUpperCase().startsWith(`${normalizedType} `)) {
    return normalizedRaw;
  }
  return `${normalizedType} ${normalizedRaw}`;
}

function buildObservationRow({
  stationIcao,
  rawMetar,
  obsTimeUtc,
  reportedTempText,
  sourcePrefix,
  fallbackReportType,
}) {
  const normalizedMetar = toNonEmptyString(rawMetar);
  if (!normalizedMetar) {
    return null;
  }

  const reportType = extractReportType(normalizedMetar) ?? fallbackReportType;
  if (!reportType) {
    return null;
  }

  const tempInfo = extractTempInfo(normalizedMetar, reportedTempText);
  if (!tempInfo) {
    return null;
  }

  const tempC = roundToTenth(tempInfo.tempC);
  const tempF = toFahrenheit(tempC);

  return {
    stationIcao,
    date: formatParisDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatParisDateTime(obsTimeUtc),
    reportType,
    tempC,
    tempF,
    rawMetar: normalizedMetar,
    source: `${sourcePrefix}:${tempInfo.source}`,
  };
}

function parseAerowebCurrentHtml(htmlText, stationIcao) {
  const html = String(htmlText ?? "");
  const match =
    /<span class=["']texte2["']>\s*(METAR|SPECI)\s*:\s*<\/span>\s*<span class=["']texte1["'][^>]*>([\s\S]*?)<\/span>/i.exec(
      html,
    );
  if (!match) {
    throw new Error("AEROWEB current page did not include a METAR or SPECI block.");
  }

  const reportType = String(match[1]).trim().toUpperCase();
  const rawMetar = canonicalizeLabeledRawMetar(
    reportType,
    normalizeAerowebHtmlText(match[2]),
  );
  if (!rawMetar) {
    throw new Error("AEROWEB current page returned an empty METAR block.");
  }
  if (!new RegExp(`\\b${stationIcao}\\b`, "i").test(rawMetar)) {
    throw new Error(`AEROWEB current page did not return ${stationIcao}.`);
  }

  const obsTimeUtc = parseReportTimestampFromRaw(rawMetar);
  if (!Number.isFinite(obsTimeUtc)) {
    throw new Error("AEROWEB current page did not include a parseable METAR timestamp.");
  }

  const row = buildObservationRow({
    stationIcao,
    rawMetar,
    obsTimeUtc,
    sourcePrefix: "aeroweb_showmessage",
    fallbackReportType: reportType,
  });
  if (!row) {
    throw new Error("AEROWEB current page did not include a parseable observation row.");
  }
  return row;
}

function observationChanged(existing, candidate) {
  const fields = [
    "obsTimeLocal",
    "reportType",
    "tempC",
    "tempF",
    "rawMetar",
    "source",
  ];
  return fields.some((field) => existing[field] !== candidate[field]);
}

function computePublishRaceWinner(aerowebFirstSeenAt, tgftpFirstSeenAt) {
  if (!Number.isFinite(aerowebFirstSeenAt) || !Number.isFinite(tgftpFirstSeenAt)) {
    return { winner: null, leadMs: null };
  }
  if (aerowebFirstSeenAt < tgftpFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.AEROWEB,
      leadMs: tgftpFirstSeenAt - aerowebFirstSeenAt,
    };
  }
  if (tgftpFirstSeenAt < aerowebFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.TGFTP,
      leadMs: aerowebFirstSeenAt - tgftpFirstSeenAt,
    };
  }
  return {
    winner: PUBLISH_RACE_WINNER.TIE,
    leadMs: 0,
  };
}

function chooseCanonicalRaceRawMetar(existingRawMetar, candidateRawMetar) {
  const existing = toNonEmptyString(existingRawMetar);
  const candidate = toNonEmptyString(candidateRawMetar);
  if (!existing) {
    return candidate;
  }
  if (!candidate) {
    return existing;
  }

  const existingHasType = /^(METAR|SPECI)\b/.test(existing);
  const candidateHasType = /^(METAR|SPECI)\b/.test(candidate);
  if (!existingHasType && candidateHasType) {
    return candidate;
  }
  if (existingHasType && !candidateHasType) {
    return existing;
  }
  return candidate.length > existing.length ? candidate : existing;
}

async function recomputeDailySummary(ctx, stationIcao, date) {
  const rows = await ctx.db
    .query("aerowebMetarObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("aerowebDailySummaries")
    .withIndex("by_station_date", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .first();

  if (!rows.length) {
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return;
  }

  rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
  const latestRow = rows[rows.length - 1];
  let maxRow = rows[0];
  let minRow = rows[0];

  for (const row of rows) {
    if (
      row.tempC > maxRow.tempC ||
      (row.tempC === maxRow.tempC && row.obsTimeUtc > maxRow.obsTimeUtc)
    ) {
      maxRow = row;
    }
    if (
      row.tempC < minRow.tempC ||
      (row.tempC === minRow.tempC && row.obsTimeUtc > minRow.obsTimeUtc)
    ) {
      minRow = row;
    }
  }

  const now = Date.now();
  const patch = {
    stationIcao,
    date,
    obsCount: rows.length,
    latestObsTimeUtc: latestRow.obsTimeUtc,
    latestObsTimeLocal: latestRow.obsTimeLocal,
    latestReportType: latestRow.reportType,
    latestTempC: latestRow.tempC,
    latestTempF: latestRow.tempF,
    latestRawMetar: latestRow.rawMetar,
    maxTempC: maxRow.tempC,
    maxTempF: maxRow.tempF,
    maxTempAtUtc: maxRow.obsTimeUtc,
    maxTempAtLocal: maxRow.obsTimeLocal,
    minTempC: minRow.tempC,
    minTempF: minRow.tempF,
    minTempAtUtc: minRow.obsTimeUtc,
    minTempAtLocal: minRow.obsTimeLocal,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return;
  }

  await ctx.db.insert("aerowebDailySummaries", patch);
}

function getAerowebBaseUrl() {
  const baseUrl = toNonEmptyString(process.env.AEROWEB_BASE_URL);
  return (baseUrl ?? "https://aviation.meteo.fr").replace(/\/+$/, "");
}

function getAerowebLogin() {
  const login = toNonEmptyString(process.env.AEROWEB_LOGIN);
  if (!login) {
    throw new Error("Missing AEROWEB_LOGIN.");
  }
  return login;
}

function getAerowebPassword() {
  const password = toNonEmptyString(process.env.AEROWEB_PASSWORD);
  if (!password) {
    throw new Error("Missing AEROWEB_PASSWORD.");
  }
  return password;
}

function buildLoginPageUrl() {
  return `${getAerowebBaseUrl()}/login.php`;
}

function buildLoginAjaxUrl() {
  return `${getAerowebBaseUrl()}/ajax/login_valid.php`;
}

function buildShowmessageUrl(stationIcao) {
  const url = new URL(`${getAerowebBaseUrl()}/showmessage.php`);
  url.searchParams.set("code", stationIcao);
  return url.toString();
}

function safeAdd32(x, y) {
  const low = (x & 0xffff) + (y & 0xffff);
  const high = (x >>> 16) + (y >>> 16) + (low >>> 16);
  return ((high & 0xffff) << 16) | (low & 0xffff);
}

function rotateLeft32(value, amount) {
  return (value << amount) | (value >>> (32 - amount));
}

function md5Common(q, a, b, x, s, t) {
  return safeAdd32(rotateLeft32(safeAdd32(safeAdd32(a, q), safeAdd32(x, t)), s), b);
}

function md5Ff(a, b, c, d, x, s, t) {
  return md5Common((b & c) | (~b & d), a, b, x, s, t);
}

function md5Gg(a, b, c, d, x, s, t) {
  return md5Common((b & d) | (c & ~d), a, b, x, s, t);
}

function md5Hh(a, b, c, d, x, s, t) {
  return md5Common(b ^ c ^ d, a, b, x, s, t);
}

function md5Ii(a, b, c, d, x, s, t) {
  return md5Common(c ^ (b | ~d), a, b, x, s, t);
}

function toUtf8BinaryString(value) {
  return unescape(encodeURIComponent(String(value ?? "")));
}

function md5InputToWords(value) {
  const input = toUtf8BinaryString(value);
  const wordCount = (((input.length + 8) >> 6) + 1) * 16;
  const words = Array(wordCount).fill(0);
  for (let index = 0; index < input.length; index += 1) {
    words[index >> 2] |= input.charCodeAt(index) << ((index % 4) * 8);
  }
  words[input.length >> 2] |= 0x80 << ((input.length % 4) * 8);
  words[wordCount - 2] = input.length * 8;
  return words;
}

function md5WordToHex(word) {
  let output = "";
  for (let offset = 0; offset < 4; offset += 1) {
    const byte = (word >>> (offset * 8)) & 0xff;
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
}

function md5Hex(value) {
  const words = md5InputToWords(value);
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let index = 0; index < words.length; index += 16) {
    const oldA = a;
    const oldB = b;
    const oldC = c;
    const oldD = d;

    a = md5Ff(a, b, c, d, words[index], 7, -680876936);
    d = md5Ff(d, a, b, c, words[index + 1], 12, -389564586);
    c = md5Ff(c, d, a, b, words[index + 2], 17, 606105819);
    b = md5Ff(b, c, d, a, words[index + 3], 22, -1044525330);
    a = md5Ff(a, b, c, d, words[index + 4], 7, -176418897);
    d = md5Ff(d, a, b, c, words[index + 5], 12, 1200080426);
    c = md5Ff(c, d, a, b, words[index + 6], 17, -1473231341);
    b = md5Ff(b, c, d, a, words[index + 7], 22, -45705983);
    a = md5Ff(a, b, c, d, words[index + 8], 7, 1770035416);
    d = md5Ff(d, a, b, c, words[index + 9], 12, -1958414417);
    c = md5Ff(c, d, a, b, words[index + 10], 17, -42063);
    b = md5Ff(b, c, d, a, words[index + 11], 22, -1990404162);
    a = md5Ff(a, b, c, d, words[index + 12], 7, 1804603682);
    d = md5Ff(d, a, b, c, words[index + 13], 12, -40341101);
    c = md5Ff(c, d, a, b, words[index + 14], 17, -1502002290);
    b = md5Ff(b, c, d, a, words[index + 15], 22, 1236535329);

    a = md5Gg(a, b, c, d, words[index + 1], 5, -165796510);
    d = md5Gg(d, a, b, c, words[index + 6], 9, -1069501632);
    c = md5Gg(c, d, a, b, words[index + 11], 14, 643717713);
    b = md5Gg(b, c, d, a, words[index], 20, -373897302);
    a = md5Gg(a, b, c, d, words[index + 5], 5, -701558691);
    d = md5Gg(d, a, b, c, words[index + 10], 9, 38016083);
    c = md5Gg(c, d, a, b, words[index + 15], 14, -660478335);
    b = md5Gg(b, c, d, a, words[index + 4], 20, -405537848);
    a = md5Gg(a, b, c, d, words[index + 9], 5, 568446438);
    d = md5Gg(d, a, b, c, words[index + 14], 9, -1019803690);
    c = md5Gg(c, d, a, b, words[index + 3], 14, -187363961);
    b = md5Gg(b, c, d, a, words[index + 8], 20, 1163531501);
    a = md5Gg(a, b, c, d, words[index + 13], 5, -1444681467);
    d = md5Gg(d, a, b, c, words[index + 2], 9, -51403784);
    c = md5Gg(c, d, a, b, words[index + 7], 14, 1735328473);
    b = md5Gg(b, c, d, a, words[index + 12], 20, -1926607734);

    a = md5Hh(a, b, c, d, words[index + 5], 4, -378558);
    d = md5Hh(d, a, b, c, words[index + 8], 11, -2022574463);
    c = md5Hh(c, d, a, b, words[index + 11], 16, 1839030562);
    b = md5Hh(b, c, d, a, words[index + 14], 23, -35309556);
    a = md5Hh(a, b, c, d, words[index + 1], 4, -1530992060);
    d = md5Hh(d, a, b, c, words[index + 4], 11, 1272893353);
    c = md5Hh(c, d, a, b, words[index + 7], 16, -155497632);
    b = md5Hh(b, c, d, a, words[index + 10], 23, -1094730640);
    a = md5Hh(a, b, c, d, words[index + 13], 4, 681279174);
    d = md5Hh(d, a, b, c, words[index], 11, -358537222);
    c = md5Hh(c, d, a, b, words[index + 3], 16, -722521979);
    b = md5Hh(b, c, d, a, words[index + 6], 23, 76029189);
    a = md5Hh(a, b, c, d, words[index + 9], 4, -640364487);
    d = md5Hh(d, a, b, c, words[index + 12], 11, -421815835);
    c = md5Hh(c, d, a, b, words[index + 15], 16, 530742520);
    b = md5Hh(b, c, d, a, words[index + 2], 23, -995338651);

    a = md5Ii(a, b, c, d, words[index], 6, -198630844);
    d = md5Ii(d, a, b, c, words[index + 7], 10, 1126891415);
    c = md5Ii(c, d, a, b, words[index + 14], 15, -1416354905);
    b = md5Ii(b, c, d, a, words[index + 5], 21, -57434055);
    a = md5Ii(a, b, c, d, words[index + 12], 6, 1700485571);
    d = md5Ii(d, a, b, c, words[index + 3], 10, -1894986606);
    c = md5Ii(c, d, a, b, words[index + 10], 15, -1051523);
    b = md5Ii(b, c, d, a, words[index + 1], 21, -2054922799);
    a = md5Ii(a, b, c, d, words[index + 8], 6, 1873313359);
    d = md5Ii(d, a, b, c, words[index + 15], 10, -30611744);
    c = md5Ii(c, d, a, b, words[index + 6], 15, -1560198380);
    b = md5Ii(b, c, d, a, words[index + 13], 21, 1309151649);
    a = md5Ii(a, b, c, d, words[index + 4], 6, -145523070);
    d = md5Ii(d, a, b, c, words[index + 11], 10, -1120210379);
    c = md5Ii(c, d, a, b, words[index + 2], 15, 718787259);
    b = md5Ii(b, c, d, a, words[index + 9], 21, -343485551);

    a = safeAdd32(a, oldA);
    b = safeAdd32(b, oldB);
    c = safeAdd32(c, oldC);
    d = safeAdd32(d, oldD);
  }

  return [a, b, c, d].map(md5WordToHex).join("");
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AEROWEB_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getSetCookieValues(headers) {
  if (headers && typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  if (!headers || typeof headers.get !== "function") {
    return [];
  }
  const combined = headers.get("set-cookie");
  if (!combined) {
    return [];
  }
  return combined.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g);
}

function applySetCookies(cookieJar, headers) {
  for (const headerValue of getSetCookieValues(headers)) {
    const firstSegment = String(headerValue ?? "").split(";")[0]?.trim();
    if (!firstSegment) {
      continue;
    }
    const separatorIndex = firstSegment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = firstSegment.slice(0, separatorIndex).trim();
    const value = firstSegment.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    cookieJar.set(name, value);
  }
}

function serializeCookieJar(cookieJar) {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function looksLikeAerowebLoginHtml(htmlText) {
  const html = String(htmlText ?? "");
  return /ajax\/login_valid\.php/i.test(html) && /id=["']login["']/i.test(html);
}

async function createAerowebSessionCookieHeader() {
  const cookieJar = new Map();

  const loginPageResponse = await fetchWithTimeout(buildLoginPageUrl(), {
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });
  applySetCookies(cookieJar, loginPageResponse.headers);

  const loginBody = new URLSearchParams({
    login: getAerowebLogin(),
    password: md5Hex(getAerowebPassword()),
  });

  const loginResponse = await fetchWithTimeout(buildLoginAjaxUrl(), {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: serializeCookieJar(cookieJar),
      Referer: buildLoginPageUrl(),
      "X-Requested-With": "XMLHttpRequest",
    },
    body: loginBody.toString(),
  });
  applySetCookies(cookieJar, loginResponse.headers);

  const loginResult = (await loginResponse.text()).trim().toLowerCase();
  if (loginResult !== "ok") {
    throw new Error(`AEROWEB login failed: ${loginResult.slice(0, 120)}`);
  }

  const cookieHeader = serializeCookieJar(cookieJar);
  if (!cookieHeader) {
    throw new Error("AEROWEB login did not return any session cookies.");
  }
  return cookieHeader;
}

async function fetchAerowebShowmessageHtml(stationIcao, cookieHeader) {
  const response = await fetchWithTimeout(buildShowmessageUrl(stationIcao), {
    headers: {
      Accept: "text/html,*/*",
      Cookie: cookieHeader,
      Referer: `${getAerowebBaseUrl()}/accueil.php`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `AEROWEB showmessage failed (${response.status}): ${html.slice(0, 200)}`,
    );
  }
  if (looksLikeAerowebLoginHtml(html)) {
    throw new Error("AEROWEB session expired.");
  }
  return html;
}

async function fetchLatestAerowebRaceHit(stationIcao, cookieHeader) {
  const html = await fetchAerowebShowmessageHtml(stationIcao, cookieHeader);
  const row = parseAerowebCurrentHtml(html, stationIcao);
  return {
    seenAt: Date.now(),
    row,
  };
}

async function fetchLatestAerowebRaceHitWithSession(stationIcao, sessionRef) {
  if (!sessionRef.cookieHeader) {
    sessionRef.cookieHeader = await createAerowebSessionCookieHeader();
  }

  try {
    return await fetchLatestAerowebRaceHit(stationIcao, sessionRef.cookieHeader);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/session expired|login/i.test(message)) {
      throw error;
    }
    sessionRef.cookieHeader = await createAerowebSessionCookieHeader();
    return await fetchLatestAerowebRaceHit(stationIcao, sessionRef.cookieHeader);
  }
}

async function fetchLatestTgftpRaceHit(stationIcao) {
  const response = await fetchWithTimeout(
    `${NOAA_LATEST_METAR_BASE_URL}/${stationIcao}.TXT`,
    {
      headers: {
        Accept: "text/plain,*/*",
      },
    },
  );
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`NOAA latest fetch failed (${response.status}): ${rawText.slice(0, 200)}`);
  }
  const parsed = parseNoaaLatestTxt(rawText);
  return {
    seenAt: Date.now(),
    reportTsUtc: parsed.tsUtc,
    rawMetar: parsed.rawMetar,
    lastModifiedAt: parseHttpTimestamp(response.headers.get("last-modified")),
  };
}

function inferPublishRaceReportType(row) {
  if (row?.reportType === "METAR" || row?.reportType === "SPECI") {
    return row.reportType;
  }
  const candidates = [row?.rawMetar, row?.aerowebRawMetar, row?.tgftpRawMetar];
  for (const candidate of candidates) {
    const type = extractReportType(candidate);
    if (type) {
      return type;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const upsertStationRowsBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    seenAt: v.optional(v.number()),
    rows: v.array(
      v.object({
        stationIcao: v.string(),
        date: v.string(),
        obsTimeUtc: v.number(),
        obsTimeLocal: v.string(),
        reportType: v.union(v.literal("METAR"), v.literal("SPECI")),
        tempC: v.number(),
        tempF: v.number(),
        rawMetar: v.string(),
        source: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const seenAt =
      typeof args.seenAt === "number" ? Math.round(args.seenAt) : null;
    const now = Date.now();
    let insertedCount = 0;
    let patchedCount = 0;
    let unchangedCount = 0;
    const affectedDates = new Set();

    for (const row of args.rows) {
      if (!parseDateKey(row.date)) {
        throw new Error(`Invalid date key: ${row.date}`);
      }

      const existing = await ctx.db
        .query("aerowebMetarObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("aerowebMetarObservations", {
          ...row,
          ...(seenAt !== null ? { aerowebFirstSeenAt: seenAt } : {}),
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      const patch = {};
      if (
        seenAt !== null &&
        (!Number.isFinite(existing.aerowebFirstSeenAt) ||
          seenAt < existing.aerowebFirstSeenAt)
      ) {
        patch.aerowebFirstSeenAt = seenAt;
      }
      if (observationChanged(existing, row)) {
        patch.obsTimeLocal = row.obsTimeLocal;
        patch.reportType = row.reportType;
        patch.tempC = row.tempC;
        patch.tempF = row.tempF;
        patch.rawMetar = row.rawMetar;
        patch.source = row.source;
      }
      if (Object.keys(patch).length === 0) {
        unchangedCount += 1;
        continue;
      }
      patch.updatedAt = now;
      await ctx.db.patch(existing._id, patch);
      patchedCount += 1;
    }

    for (const date of affectedDates) {
      await recomputeDailySummary(ctx, args.stationIcao, date);
    }

    return {
      insertedCount,
      patchedCount,
      unchangedCount,
      affectedDateCount: affectedDates.size,
    };
  },
});

export const recordPublishRaceHit = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    reportTsUtc: v.number(),
    reportType: v.optional(v.union(v.literal("METAR"), v.literal("SPECI"))),
    source: v.union(v.literal(RACE_SOURCE.AEROWEB), v.literal(RACE_SOURCE.TGFTP)),
    rawMetar: v.string(),
    seenAt: v.number(),
    sourceLastModifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aerowebPublishRaceReports")
      .withIndex("by_station_reportTs", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("reportTsUtc", args.reportTsUtc),
      )
      .first();

    const now = Date.now();
    const reportDateLocal = formatParisDate(args.reportTsUtc);

    if (!existing) {
      const patch = {
        stationIcao: args.stationIcao,
        reportDateLocal,
        reportTsUtc: args.reportTsUtc,
        rawMetar: args.rawMetar,
        ...(args.reportType ? { reportType: args.reportType } : {}),
        ...(args.source === RACE_SOURCE.AEROWEB
          ? {
              aerowebRawMetar: args.rawMetar,
              aerowebFirstSeenAt: args.seenAt,
            }
          : {
              tgftpRawMetar: args.rawMetar,
              tgftpFirstSeenAt: args.seenAt,
            }),
        ...(args.source === RACE_SOURCE.TGFTP &&
        Number.isFinite(args.sourceLastModifiedAt)
          ? { tgftpLastModifiedAt: args.sourceLastModifiedAt }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      const insertedId = await ctx.db.insert("aerowebPublishRaceReports", patch);
      return await ctx.db.get(insertedId);
    }

    const patch = {
      reportDateLocal,
    };
    if (!existing.reportType && args.reportType) {
      patch.reportType = args.reportType;
    }

    const canonicalRawMetar = chooseCanonicalRaceRawMetar(
      existing.rawMetar,
      args.rawMetar,
    );
    if (existing.rawMetar !== canonicalRawMetar) {
      patch.rawMetar = canonicalRawMetar;
    }

    if (args.source === RACE_SOURCE.AEROWEB) {
      if (!existing.aerowebRawMetar) {
        patch.aerowebRawMetar = args.rawMetar;
      }
      if (
        !Number.isFinite(existing.aerowebFirstSeenAt) ||
        args.seenAt < existing.aerowebFirstSeenAt
      ) {
        patch.aerowebFirstSeenAt = args.seenAt;
      }
    } else {
      if (!existing.tgftpRawMetar) {
        patch.tgftpRawMetar = args.rawMetar;
      }
      if (
        !Number.isFinite(existing.tgftpFirstSeenAt) ||
        args.seenAt < existing.tgftpFirstSeenAt
      ) {
        patch.tgftpFirstSeenAt = args.seenAt;
      }
      if (
        Number.isFinite(args.sourceLastModifiedAt) &&
        (!Number.isFinite(existing.tgftpLastModifiedAt) ||
          args.sourceLastModifiedAt < existing.tgftpLastModifiedAt)
      ) {
        patch.tgftpLastModifiedAt = args.sourceLastModifiedAt;
      }
    }

    const winnerState = computePublishRaceWinner(
      patch.aerowebFirstSeenAt ?? existing.aerowebFirstSeenAt,
      patch.tgftpFirstSeenAt ?? existing.tgftpFirstSeenAt,
    );
    if (winnerState.winner) {
      patch.winner = winnerState.winner;
      patch.leadMs = winnerState.leadMs;
    }

    if (Object.keys(patch).length === 1) {
      return existing;
    }

    patch.updatedAt = now;
    await ctx.db.patch(existing._id, patch);
    return await ctx.db.get(existing._id);
  },
});

export const pollLatestStationMetar = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const sessionRef = { cookieHeader: null };
    const { seenAt, row } = await fetchLatestAerowebRaceHitWithSession(
      stationIcao,
      sessionRef,
    );
    const result = await ctx.runMutation("aeroweb:upsertStationRowsBatch", {
      stationIcao,
      seenAt,
      rows: [row],
    });
    const raceRow = await ctx.runMutation("aeroweb:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: row.obsTimeUtc,
      reportType: row.reportType,
      source: RACE_SOURCE.AEROWEB,
      rawMetar: row.rawMetar,
      seenAt,
    });

    return {
      ok: true,
      stationIcao,
      row: {
        ...row,
        aerowebFirstSeenAt: raceRow?.aerowebFirstSeenAt ?? seenAt,
      },
      availabilityLagMs: Math.max(0, seenAt - row.obsTimeUtc),
      ...result,
    };
  },
});

export const pollLatestNoaaPublishRace = actionGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const hit = await fetchLatestTgftpRaceHit(stationIcao);
    const raceRow = await ctx.runMutation("aeroweb:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: hit.reportTsUtc,
      source: RACE_SOURCE.TGFTP,
      rawMetar: hit.rawMetar,
      seenAt: hit.seenAt,
      ...(Number.isFinite(hit.lastModifiedAt)
        ? { sourceLastModifiedAt: hit.lastModifiedAt }
        : {}),
    });

    return {
      ok: true,
      stationIcao,
      reportTsUtc: hit.reportTsUtc,
      reportType: raceRow?.reportType ?? null,
      rawMetar: hit.rawMetar,
      tgftpFirstSeenAt: raceRow?.tgftpFirstSeenAt ?? hit.seenAt,
      tgftpLastModifiedAt: hit.lastModifiedAt,
      winner: raceRow?.winner ?? null,
      leadMs: raceRow?.leadMs ?? null,
    };
  },
});

export const watchStationPublishRaceWindow = actionGeneric({
  args: {
    stationIcao: v.string(),
    intervalMs: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const intervalMs = Math.max(
      1000,
      Math.min(30000, Math.round(args.intervalMs ?? DEFAULT_RACE_WATCH_INTERVAL_MS)),
    );
    const durationMs = Math.max(
      intervalMs,
      Math.min(20 * 60 * 1000, Math.round(args.durationMs ?? DEFAULT_RACE_WATCH_DURATION_MS)),
    );

    const startedAt = Date.now();
    const deadline = startedAt + durationMs;
    let iterations = 0;
    let errorCount = 0;
    let lastError = null;
    let lastAeroweb = null;
    let lastTgftp = null;
    const touchedReportTimestamps = new Set();
    const sessionRef = { cookieHeader: null };

    while (Date.now() <= deadline) {
      try {
        const [aerowebResult, tgftpResult] = await Promise.allSettled([
          fetchLatestAerowebRaceHitWithSession(stationIcao, sessionRef),
          fetchLatestTgftpRaceHit(stationIcao),
        ]);

        const mutationCalls = [];

        if (aerowebResult.status === "fulfilled") {
          lastAeroweb = aerowebResult.value;
          mutationCalls.push(
            ctx.runMutation("aeroweb:recordPublishRaceHit", {
              stationIcao,
              reportTsUtc: aerowebResult.value.row.obsTimeUtc,
              reportType: aerowebResult.value.row.reportType,
              source: RACE_SOURCE.AEROWEB,
              rawMetar: aerowebResult.value.row.rawMetar,
              seenAt: aerowebResult.value.seenAt,
            }),
          );
        } else {
          errorCount += 1;
          lastError =
            aerowebResult.reason instanceof Error
              ? aerowebResult.reason.message
              : String(aerowebResult.reason);
        }

        if (tgftpResult.status === "fulfilled") {
          lastTgftp = tgftpResult.value;
          mutationCalls.push(
            ctx.runMutation("aeroweb:recordPublishRaceHit", {
              stationIcao,
              reportTsUtc: tgftpResult.value.reportTsUtc,
              source: RACE_SOURCE.TGFTP,
              rawMetar: tgftpResult.value.rawMetar,
              seenAt: tgftpResult.value.seenAt,
              ...(Number.isFinite(tgftpResult.value.lastModifiedAt)
                ? { sourceLastModifiedAt: tgftpResult.value.lastModifiedAt }
                : {}),
            }),
          );
        } else {
          errorCount += 1;
          lastError =
            tgftpResult.reason instanceof Error
              ? tgftpResult.reason.message
              : String(tgftpResult.reason);
        }

        const raceRows = await Promise.all(mutationCalls);
        for (const raceRow of raceRows) {
          if (raceRow?.reportTsUtc) {
            touchedReportTimestamps.add(raceRow.reportTsUtc);
          }
        }
      } catch (error) {
        errorCount += 1;
        lastError = error instanceof Error ? error.message : String(error);
      }

      iterations += 1;
      if (Date.now() + intervalMs > deadline) {
        break;
      }
      await sleep(intervalMs);
    }

    return {
      ok: errorCount === 0,
      stationIcao,
      startedAt,
      finishedAt: Date.now(),
      durationMs,
      intervalMs,
      iterations,
      errorCount,
      lastError,
      touchedReportCount: touchedReportTimestamps.size,
      latestAerowebReportTsUtc: lastAeroweb?.row?.obsTimeUtc ?? null,
      latestTgftpReportTsUtc: lastTgftp?.reportTsUtc ?? null,
    };
  },
});

export const getDayStationRows = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!parseDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const rows = await ctx.db
      .query("aerowebMetarObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("aerowebDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .first();

    return { rows, summary };
  },
});

export const getRecentPublishRaceReports = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    limit: v.optional(v.number()),
    routineOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "LFPG").trim().toUpperCase();
    const requestedLimit = Number.isInteger(args.limit)
      ? Number(args.limit)
      : DEFAULT_RACE_QUERY_LIMIT;
    const limit = Math.max(1, Math.min(MAX_RACE_QUERY_LIMIT, requestedLimit));
    const routineOnly = args.routineOnly !== false;

    const rows = await ctx.db
      .query("aerowebPublishRaceReports")
      .withIndex("by_station_reportTs", (query) => query.eq("stationIcao", stationIcao))
      .order("desc")
      .take(MAX_RACE_QUERY_LIMIT);

    const filteredRows = routineOnly
      ? rows.filter((row) => inferPublishRaceReportType(row) !== "SPECI")
      : rows;

    return {
      stationIcao,
      count: Math.min(filteredRows.length, limit),
      rows: filteredRows.slice(0, limit),
    };
  },
});
