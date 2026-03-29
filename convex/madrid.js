import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const MADRID_TIMEZONE = "Europe/Madrid";
const AEMET_FETCH_TIMEOUT_MS = 25000;
const DEFAULT_AEMET_BASE_URL = "https://ama.aemet.es";
const AEMET_OPENDATA_BASE_URL = "https://opendata.aemet.es/opendata";
// Paracuellos de Jarama — closest municipality to Barajas airport (~4.9 km).
// Madrid city (28079) runs 2-3°C warmer overnight due to urban heat island.
const MADRID_MUNICIPIO = "28104";
const MADRID_AEMET_STATION_ID = "3129";
const MADRID_WMO_BLOCK = "08221";
const OGIMET_SYNOP_BASE_URL = "https://www.ogimet.com/cgi-bin/getsynop";
const NOAA_LATEST_METAR_BASE_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations";
const RACE_SOURCE = {
  AEMET: "aemet",
  TGFTP: "tgftp",
};
const PUBLISH_RACE_WINNER = {
  AEMET: "aemet",
  TGFTP: "tgftp",
  TIE: "tie",
};
const DEFAULT_RACE_QUERY_LIMIT = 12;
const MAX_RACE_QUERY_LIMIT = 48;
const DEFAULT_RACE_WATCH_INTERVAL_MS = 1000;
const DEFAULT_RACE_WATCH_DURATION_MS = 6 * 60 * 1000;
const DEFAULT_BROWSER_USER_AGENT = "Mozilla/5.0";
const aemetSessionRef = {};

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

function formatMadridDate(epochMs) {
  const parts = getDateParts(madridDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatMadridDateTime(epochMs) {
  const parts = getDateParts(madridDateTimeFormatter, new Date(epochMs));
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
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeAemetHtmlText(value) {
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

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function getAemetBaseUrl() {
  return (
    toNonEmptyString(process.env.AEMET_BASE_URL)?.replace(/\/+$/, "") ??
    DEFAULT_AEMET_BASE_URL
  );
}

function getAemetUsername() {
  const username = toNonEmptyString(process.env.AEMET_USERNAME);
  if (!username) {
    throw new Error("Missing AEMET_USERNAME.");
  }
  return username;
}

function getAemetPassword() {
  const password = toNonEmptyString(process.env.AEMET_PASSWORD);
  if (!password) {
    throw new Error("Missing AEMET_PASSWORD.");
  }
  return password;
}

function buildAemetLoginPageUrl() {
  const url = new URL(`${getAemetBaseUrl()}/acceso`);
  url.searchParams.set("p_p_id", "com_liferay_login_web_portlet_LoginPortlet");
  url.searchParams.set("p_p_lifecycle", "0");
  url.searchParams.set("p_p_state", "maximized");
  url.searchParams.set("p_p_mode", "view");
  url.searchParams.set("saveLastPath", "false");
  url.searchParams.set(
    "_com_liferay_login_web_portlet_LoginPortlet_mvcRenderCommandName",
    "/login/login",
  );
  return url.toString();
}

function buildAemetMetarPageUrl() {
  return `${getAemetBaseUrl()}/metar-taf`;
}

function looksLikeAemetLoginHtml(htmlText) {
  const html = String(htmlText ?? "");
  return (
    /_com_liferay_login_web_portlet_LoginPortlet_loginForm/i.test(html) ||
    /Nombre de usuario/i.test(html)
  );
}

function extractFormOpenTag(html, formId) {
  const pattern = new RegExp(
    `<form\\b[^>]*\\bid=["']${escapeRegex(formId)}["'][^>]*>`,
    "i",
  );
  const match = pattern.exec(String(html ?? ""));
  return match ? match[0] : null;
}

function extractFormActionFromTag(formTag, baseUrl) {
  const actionMatch = /\baction=["']([^"']+)["']/i.exec(formTag ?? "");
  if (!actionMatch) {
    return null;
  }
  const decoded = decodeHtmlEntities(actionMatch[1]);
  return new URL(decoded, baseUrl).toString();
}

function extractInputValueById(html, inputId) {
  const pattern = new RegExp(
    `<input\\b[^>]*\\bid=["']${escapeRegex(inputId)}["'][^>]*>`,
    "i",
  );
  const match = pattern.exec(String(html ?? ""));
  if (!match) {
    return null;
  }
  const valueMatch = /\bvalue=["']([^"']*)["']/i.exec(match[0]);
  return valueMatch ? decodeHtmlEntities(valueMatch[1]) : null;
}

function parseAemetLoginPage(htmlText) {
  const formTag = extractFormOpenTag(
    htmlText,
    "_com_liferay_login_web_portlet_LoginPortlet_loginForm",
  );
  if (!formTag) {
    throw new Error("AEMET login page did not include the login form.");
  }

  const actionUrl = extractFormActionFromTag(formTag, buildAemetLoginPageUrl());
  if (!actionUrl) {
    throw new Error("AEMET login page did not include a login action.");
  }

  const formDate =
    extractInputValueById(
      htmlText,
      "_com_liferay_login_web_portlet_LoginPortlet_formDate",
    ) ?? "";

  return { actionUrl, formDate };
}

function parseAemetSearchPage(htmlText) {
  const formTag = extractFormOpenTag(htmlText, "_busquedasbasicas_fm");
  if (!formTag) {
    throw new Error("AEMET METAR page did not include the search form.");
  }

  const actionUrl = extractFormActionFromTag(formTag, buildAemetMetarPageUrl());
  if (!actionUrl) {
    throw new Error("AEMET METAR page did not include a search action.");
  }

  const formDate =
    extractInputValueById(htmlText, "_busquedasbasicas_formDate") ?? "";

  return { actionUrl, formDate };
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AEMET_FETCH_TIMEOUT_MS);
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

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function mergeCookieHeader(headers, cookieJar) {
  const headerMap = new Headers(headers ?? {});
  const cookieHeader = serializeCookieJar(cookieJar);
  if (cookieHeader) {
    headerMap.set("Cookie", cookieHeader);
  } else {
    headerMap.delete("Cookie");
  }
  return headerMap;
}

async function fetchWithCookieJar(url, init = {}, cookieJar, maxRedirects = 8) {
  let currentUrl = String(url);
  let method = String(init.method ?? "GET").toUpperCase();
  let body = init.body;
  let redirectCount = 0;

  while (true) {
    const response = await fetchWithTimeout(currentUrl, {
      ...init,
      method,
      body,
      headers: mergeCookieHeader(init.headers, cookieJar),
      redirect: "manual",
    });
    applySetCookies(cookieJar, response.headers);

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = toNonEmptyString(response.headers.get("location"));
    if (!location) {
      return response;
    }

    if (redirectCount >= maxRedirects) {
      throw new Error(`AEMET redirect chain exceeded ${maxRedirects} hops.`);
    }
    redirectCount += 1;

    currentUrl = new URL(location, currentUrl).toString();

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method !== "GET" &&
        method !== "HEAD")
    ) {
      method = "GET";
      body = undefined;
    }
  }
}

async function createAemetSessionCookieHeader() {
  const cookieJar = new Map();

  const loginPageResponse = await fetchWithTimeout(buildAemetLoginPageUrl(), {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": DEFAULT_BROWSER_USER_AGENT,
    },
  });
  const loginPageHtml = await loginPageResponse.text();
  if (!loginPageResponse.ok) {
    throw new Error(
      `AEMET login page fetch failed (${loginPageResponse.status}): ${loginPageHtml.slice(0, 200)}`,
    );
  }
  applySetCookies(cookieJar, loginPageResponse.headers);

  const loginPage = parseAemetLoginPage(loginPageHtml);
  const loginBody = new URLSearchParams({
    _com_liferay_login_web_portlet_LoginPortlet_login: getAemetUsername(),
    _com_liferay_login_web_portlet_LoginPortlet_password: getAemetPassword(),
    _com_liferay_login_web_portlet_LoginPortlet_formDate: loginPage.formDate,
    _com_liferay_login_web_portlet_LoginPortlet_saveLastPath: "false",
    _com_liferay_login_web_portlet_LoginPortlet_redirect: "",
    _com_liferay_login_web_portlet_LoginPortlet_doActionAfterLogin: "false",
    _com_liferay_login_web_portlet_LoginPortlet_checkboxNames: "rememberMe",
  });

  const loginResponse = await fetchWithCookieJar(
    loginPage.actionUrl,
    {
      method: "POST",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: buildAemetLoginPageUrl(),
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
      },
      body: loginBody.toString(),
    },
    cookieJar,
  );
  const loginResponseHtml = await loginResponse.text();
  if (!loginResponse.ok) {
    throw new Error(
      `AEMET login POST failed (${loginResponse.status}): ${loginResponseHtml.slice(0, 200)}`,
    );
  }

  const cookieHeader = serializeCookieJar(cookieJar);
  if (!cookieHeader) {
    throw new Error("AEMET login did not return any session cookies.");
  }

  const metarPageResponse = await fetchWithCookieJar(
    buildAemetMetarPageUrl(),
    {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: buildAemetLoginPageUrl(),
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
      },
    },
    cookieJar,
  );
  const metarPageHtml = await metarPageResponse.text();
  if (!metarPageResponse.ok) {
    throw new Error(
      `AEMET METAR page fetch failed after login (${metarPageResponse.status}): ${metarPageHtml.slice(0, 200)}`,
    );
  }
  if (looksLikeAemetLoginHtml(metarPageHtml)) {
    throw new Error("AEMET login failed or did not create an authenticated session.");
  }

  return cookieHeader;
}

async function fetchAemetMetarPageHtml(cookieHeader) {
  const response = await fetchWithTimeout(buildAemetMetarPageUrl(), {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      Cookie: cookieHeader,
      Referer: buildAemetMetarPageUrl(),
      "User-Agent": DEFAULT_BROWSER_USER_AGENT,
    },
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `AEMET METAR page failed (${response.status}): ${html.slice(0, 200)}`,
    );
  }
  if (looksLikeAemetLoginHtml(html)) {
    throw new Error("AEMET session expired.");
  }
  return html;
}

async function fetchAemetSearchResultHtml(stationIcao, cookieHeader) {
  const metarPageHtml = await fetchAemetMetarPageHtml(cookieHeader);
  const searchPage = parseAemetSearchPage(metarPageHtml);

  const searchBody = new URLSearchParams({
    _busquedasbasicas_formDate: searchPage.formDate,
    _busquedasbasicas_coaci_aeropuertos: stationIcao,
    _busquedasbasicas_nombre_consulta: "Metar / Speci",
    _busquedasbasicas_desc_consulta: "Busqueda Metar / Speci",
    _busquedasbasicas_checkboxNames: "check-peninsula,check-canarias",
  });

  const response = await fetchWithTimeout(searchPage.actionUrl, {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookieHeader,
      Referer: buildAemetMetarPageUrl(),
      "User-Agent": DEFAULT_BROWSER_USER_AGENT,
    },
    body: searchBody.toString(),
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `AEMET search failed (${response.status}): ${html.slice(0, 200)}`,
    );
  }
  if (looksLikeAemetLoginHtml(html)) {
    throw new Error("AEMET session expired.");
  }
  return html;
}

function inferAemetReportTypeFromHtml(htmlText, rawIndex) {
  const start = Math.max(0, rawIndex - 1600);
  const end = Math.min(String(htmlText ?? "").length, rawIndex + 400);
  const context = String(htmlText ?? "").slice(start, end);
  const matches = Array.from(context.matchAll(/>\s*(METAR|SPECI)\s*</gi));
  if (matches.length) {
    return String(matches[matches.length - 1][1]).toUpperCase();
  }

  const normalizedText = normalizeAemetHtmlText(context);
  if (/\bSPECI\b/i.test(normalizedText)) {
    return "SPECI";
  }
  if (/\bMETAR\b/i.test(normalizedText)) {
    return "METAR";
  }
  return null;
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
    date: formatMadridDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatMadridDateTime(obsTimeUtc),
    reportType,
    tempC,
    tempF,
    rawMetar: normalizedMetar,
    source: `${sourcePrefix}:${tempInfo.source}`,
  };
}

function parseAemetLatestResultHtml(htmlText, stationIcao) {
  const html = String(htmlText ?? "");
  const stationPattern = escapeRegex(stationIcao);
  const reportRegex = new RegExp(
    `\\bdata-report=(["'])([^"'<>]*\\b${stationPattern}\\b[^"'<>]*)\\1`,
    "i",
  );
  const match = reportRegex.exec(html);
  if (!match) {
    throw new Error("AEMET result page did not include a data-report METAR block.");
  }

  const rawReportValue = decodeHtmlEntities(match[2]);
  const inferredType =
    extractReportType(rawReportValue) ??
    inferAemetReportTypeFromHtml(html, match.index ?? 0);
  if (!inferredType) {
    throw new Error("AEMET result page did not include a parseable METAR/SPECI label.");
  }

  const rawMetar = canonicalizeLabeledRawMetar(inferredType, rawReportValue);
  if (!rawMetar) {
    throw new Error("AEMET result page returned an empty METAR block.");
  }

  const obsTimeUtc = parseReportTimestampFromRaw(rawMetar);
  if (!Number.isFinite(obsTimeUtc)) {
    throw new Error("AEMET result page did not include a parseable observation timestamp.");
  }

  const row = buildObservationRow({
    stationIcao,
    rawMetar,
    obsTimeUtc,
    sourcePrefix: "aemet_ama",
    fallbackReportType: inferredType,
  });
  if (!row) {
    throw new Error("AEMET result page did not include a parseable temperature row.");
  }

  return row;
}

async function fetchLatestAemetRaceHit(stationIcao, sessionRef = aemetSessionRef) {
  const normalizedStation = String(stationIcao ?? "").trim().toUpperCase();
  if (!normalizedStation) {
    throw new Error("stationIcao is required.");
  }

  if (!sessionRef.cookieHeader) {
    sessionRef.cookieHeader = await createAemetSessionCookieHeader();
  }

  async function fetchOnce() {
    const html = await fetchAemetSearchResultHtml(normalizedStation, sessionRef.cookieHeader);
    const row = parseAemetLatestResultHtml(html, normalizedStation);
    return {
      seenAt: Date.now(),
      row,
    };
  }

  try {
    return await fetchOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/session expired|login/i.test(message)) {
      throw error;
    }
    sessionRef.cookieHeader = await createAemetSessionCookieHeader();
    return await fetchOnce();
  }
}

async function fetchLatestTgftpRaceHit(stationIcao) {
  const response = await fetchWithTimeout(
    `${NOAA_LATEST_METAR_BASE_URL}/${stationIcao}.TXT`,
    {
      headers: {
        "Cache-Control": "no-cache",
      },
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `NOAA tgftp latest fetch failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const body = await response.text();
  const parsed = parseNoaaLatestTxt(body);
  return {
    seenAt: Date.now(),
    reportTsUtc: parsed.tsUtc,
    rawMetar: parsed.rawMetar,
    lastModifiedAt: parseHttpTimestamp(response.headers.get("last-modified")),
  };
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

function computePublishRaceWinner(aemetFirstSeenAt, tgftpFirstSeenAt) {
  if (!Number.isFinite(aemetFirstSeenAt) || !Number.isFinite(tgftpFirstSeenAt)) {
    return { winner: null, leadMs: null };
  }
  if (aemetFirstSeenAt < tgftpFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.AEMET,
      leadMs: tgftpFirstSeenAt - aemetFirstSeenAt,
    };
  }
  if (tgftpFirstSeenAt < aemetFirstSeenAt) {
    return {
      winner: PUBLISH_RACE_WINNER.TGFTP,
      leadMs: aemetFirstSeenAt - tgftpFirstSeenAt,
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

function inferPublishRaceReportType(row) {
  return (
    row?.reportType ??
    extractReportType(
      row?.rawMetar ?? row?.aemetRawMetar ?? row?.tgftpRawMetar ?? "",
    )
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function recomputeDailySummary(ctx, stationIcao, date) {
  const rows = await ctx.db
    .query("madridMetarObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("madridDailySummaries")
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

  await ctx.db.insert("madridDailySummaries", patch);
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
        .query("madridMetarObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("madridMetarObservations", {
          ...row,
          ...(seenAt !== null ? { aemetFirstSeenAt: seenAt } : {}),
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      const patch = {};
      if (existing.aemetFirstSeenAt === undefined && seenAt !== null) {
        patch.aemetFirstSeenAt = seenAt;
      }
      if (observationChanged(existing, row)) {
        patch.obsTimeLocal = row.obsTimeLocal;
        patch.reportType = row.reportType;
        patch.tempC = row.tempC;
        patch.tempF = row.tempF;
        patch.rawMetar = row.rawMetar;
        patch.source = row.source;
      }
      if (!Object.keys(patch).length) {
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
    source: v.union(v.literal(RACE_SOURCE.AEMET), v.literal(RACE_SOURCE.TGFTP)),
    rawMetar: v.string(),
    seenAt: v.number(),
    sourceLastModifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("madridPublishRaceReports")
      .withIndex("by_station_reportTs", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("reportTsUtc", args.reportTsUtc),
      )
      .first();

    const now = Date.now();
    const reportDateLocal = formatMadridDate(args.reportTsUtc);

    if (!existing) {
      const patch = {
        stationIcao: args.stationIcao,
        reportDateLocal,
        reportTsUtc: args.reportTsUtc,
        rawMetar: args.rawMetar,
        ...(args.reportType ? { reportType: args.reportType } : {}),
        ...(args.source === RACE_SOURCE.AEMET
          ? {
              aemetRawMetar: args.rawMetar,
              aemetFirstSeenAt: args.seenAt,
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
      const insertedId = await ctx.db.insert("madridPublishRaceReports", patch);
      return await ctx.db.get(insertedId);
    }

    const patch = {};
    if (existing.reportDateLocal !== reportDateLocal) {
      patch.reportDateLocal = reportDateLocal;
    }
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

    if (args.source === RACE_SOURCE.AEMET) {
      if (!existing.aemetRawMetar) {
        patch.aemetRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.aemetFirstSeenAt)) {
        patch.aemetFirstSeenAt = args.seenAt;
      }
    } else {
      if (!existing.tgftpRawMetar) {
        patch.tgftpRawMetar = args.rawMetar;
      }
      if (!Number.isFinite(existing.tgftpFirstSeenAt)) {
        patch.tgftpFirstSeenAt = args.seenAt;
      }
      if (
        Number.isFinite(args.sourceLastModifiedAt) &&
        !Number.isFinite(existing.tgftpLastModifiedAt)
      ) {
        patch.tgftpLastModifiedAt = args.sourceLastModifiedAt;
      }
    }

    const winnerState = computePublishRaceWinner(
      patch.aemetFirstSeenAt ?? existing.aemetFirstSeenAt,
      patch.tgftpFirstSeenAt ?? existing.tgftpFirstSeenAt,
    );
    if (winnerState.winner && existing.winner !== winnerState.winner) {
      patch.winner = winnerState.winner;
    }
    if (winnerState.winner && existing.leadMs !== winnerState.leadMs) {
      patch.leadMs = winnerState.leadMs;
    }

    if (!Object.keys(patch).length) {
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

    const { seenAt, row } = await fetchLatestAemetRaceHit(stationIcao);
    const result = await ctx.runMutation("madrid:upsertStationRowsBatch", {
      stationIcao,
      seenAt,
      rows: [row],
    });
    const raceRow = await ctx.runMutation("madrid:recordPublishRaceHit", {
      stationIcao,
      reportTsUtc: row.obsTimeUtc,
      reportType: row.reportType,
      source: RACE_SOURCE.AEMET,
      rawMetar: row.rawMetar,
      seenAt,
    });

    return {
      ok: true,
      stationIcao,
      row: {
        ...row,
        aemetFirstSeenAt: raceRow?.aemetFirstSeenAt ?? seenAt,
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
    const raceRow = await ctx.runMutation("madrid:recordPublishRaceHit", {
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
    let lastAemet = null;
    let lastTgftp = null;
    const touchedReportTimestamps = new Set();
    const sessionRef = { cookieHeader: null };

    while (Date.now() <= deadline) {
      try {
        const [aemetResult, tgftpResult] = await Promise.allSettled([
          fetchLatestAemetRaceHit(stationIcao, sessionRef),
          fetchLatestTgftpRaceHit(stationIcao),
        ]);

        const mutationCalls = [];

        if (aemetResult.status === "fulfilled") {
          lastAemet = aemetResult.value;
          mutationCalls.push(
            ctx.runMutation("madrid:upsertStationRowsBatch", {
              stationIcao,
              seenAt: aemetResult.value.seenAt,
              rows: [aemetResult.value.row],
            }),
          );
          mutationCalls.push(
            ctx.runMutation("madrid:recordPublishRaceHit", {
              stationIcao,
              reportTsUtc: aemetResult.value.row.obsTimeUtc,
              reportType: aemetResult.value.row.reportType,
              source: RACE_SOURCE.AEMET,
              rawMetar: aemetResult.value.row.rawMetar,
              seenAt: aemetResult.value.seenAt,
            }),
          );
        } else {
          errorCount += 1;
          lastError =
            aemetResult.reason instanceof Error
              ? aemetResult.reason.message
              : String(aemetResult.reason);
        }

        if (tgftpResult.status === "fulfilled") {
          lastTgftp = tgftpResult.value;
          mutationCalls.push(
            ctx.runMutation("madrid:recordPublishRaceHit", {
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

        const mutationResults = await Promise.all(mutationCalls);
        for (const result of mutationResults) {
          if (result?.reportTsUtc) {
            touchedReportTimestamps.add(result.reportTsUtc);
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
      latestAemetReportTsUtc: lastAemet?.row?.obsTimeUtc ?? null,
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
      .query("madridMetarObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("madridDailySummaries")
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
    const stationIcao = String(args.stationIcao ?? "LEMD").trim().toUpperCase();
    const requestedLimit = Number.isInteger(args.limit)
      ? Number(args.limit)
      : DEFAULT_RACE_QUERY_LIMIT;
    const limit = Math.max(1, Math.min(MAX_RACE_QUERY_LIMIT, requestedLimit));
    const routineOnly = args.routineOnly !== false;

    const rows = await ctx.db
      .query("madridPublishRaceReports")
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

// ---------------------------------------------------------------------------
// AEMET OpenData hourly forecast for Madrid
// ---------------------------------------------------------------------------

function getAemetOpenDataKey() {
  return toNonEmptyString(process.env.OPENDATA_AEMET_KEY);
}

async function fetchAemetHourlyForecast({ municipio, apiKey }) {
  // Step 1: get the redirect URL containing the actual data.
  const metaUrl = `${AEMET_OPENDATA_BASE_URL}/api/prediccion/especifica/municipio/horaria/${municipio}?api_key=${apiKey}`;
  const metaResponse = await fetch(metaUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!metaResponse.ok) {
    const text = await metaResponse.text();
    throw new Error(
      `AEMET hourly forecast meta failed (${metaResponse.status}): ${text.slice(0, 220)}`,
    );
  }
  const meta = await metaResponse.json();
  const datosUrl = toNonEmptyString(meta?.datos);
  if (!datosUrl) {
    throw new Error("AEMET hourly forecast meta missing datos URL.");
  }

  // Step 2: fetch the actual forecast data.
  const dataResponse = await fetch(datosUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!dataResponse.ok) {
    const text = await dataResponse.text();
    throw new Error(
      `AEMET hourly forecast data failed (${dataResponse.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await dataResponse.json();
  const prediction = Array.isArray(payload) && payload.length > 0
    ? payload[0]?.prediccion
    : null;
  const days = Array.isArray(prediction?.dia) ? prediction.dia : [];

  const rows = [];
  for (const day of days) {
    const dateBase = day.fecha ? day.fecha.slice(0, 10) : null;
    if (!dateBase) {
      continue;
    }
    const temps = Array.isArray(day.temperatura) ? day.temperatura : [];
    const humidities = Array.isArray(day.humedadRelativa) ? day.humedadRelativa : [];
    const skies = Array.isArray(day.estadoCielo) ? day.estadoCielo : [];
    const precips = Array.isArray(day.precipitacion) ? day.precipitacion : [];

    // Wind entries alternate: odd entries are wind objects with direccion/velocidad,
    // even entries are gust values. We only want the wind objects.
    const windEntries = Array.isArray(day.vientoAndRachaMax)
      ? day.vientoAndRachaMax
      : [];
    const windByHour = new Map();
    for (const w of windEntries) {
      if (Array.isArray(w.direccion) && Array.isArray(w.velocidad) && w.periodo) {
        windByHour.set(w.periodo, {
          direction: w.direccion[0],
          speed: Number(w.velocidad[0]) || 0,
        });
      }
    }

    const humidityByHour = new Map();
    for (const h of humidities) {
      if (h.periodo && h.value) {
        humidityByHour.set(h.periodo, Number(h.value));
      }
    }
    const skyByHour = new Map();
    for (const s of skies) {
      if (s.periodo && s.descripcion) {
        skyByHour.set(s.periodo, s.descripcion);
      }
    }
    const precipByHour = new Map();
    for (const p of precips) {
      if (p.periodo && p.value !== undefined) {
        precipByHour.set(p.periodo, Number(p.value) || 0);
      }
    }

    for (const t of temps) {
      const hour = t.periodo;
      const tempC = Number(t.value);
      if (!hour || !Number.isFinite(tempC)) {
        continue;
      }
      const hourNum = Number(hour);
      const isoString = `${dateBase}T${String(hourNum).padStart(2, "0")}:00:00`;
      // Parse as Madrid local time.
      const forecastTimeUtc = new Date(`${isoString}+01:00`).getTime();
      // Adjust for Madrid timezone properly.
      const localStr = `${dateBase} ${String(hourNum).padStart(2, "0")}:00`;
      const wind = windByHour.get(hour);

      rows.push({
        date: dateBase,
        forecastTimeUtc,
        forecastTimeLocal: localStr,
        tempC: roundToTenth(tempC),
        tempF: toFahrenheit(tempC),
        humidity: humidityByHour.get(hour) ?? undefined,
        windSpeedKph: wind?.speed ?? undefined,
        windDirection: wind?.direction ?? undefined,
        skyDescription: skyByHour.get(hour) ?? undefined,
        precipitation: precipByHour.get(hour) ?? undefined,
      });
    }
  }

  return rows;
}

const storeAemetHourlyForecastBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(
      v.object({
        date: v.string(),
        forecastTimeUtc: v.number(),
        forecastTimeLocal: v.string(),
        tempC: v.number(),
        tempF: v.number(),
        humidity: v.optional(v.number()),
        windSpeedKph: v.optional(v.number()),
        windDirection: v.optional(v.string()),
        skyDescription: v.optional(v.string()),
        precipitation: v.optional(v.number()),
      }),
    ),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    let upserted = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("madridAemetHourlyForecasts")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("date", row.date)
            .eq("forecastTimeUtc", row.forecastTimeUtc),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          tempC: row.tempC,
          tempF: row.tempF,
          humidity: row.humidity,
          windSpeedKph: row.windSpeedKph,
          windDirection: row.windDirection,
          skyDescription: row.skyDescription,
          precipitation: row.precipitation,
          capturedAt: args.capturedAt,
        });
      } else {
        await ctx.db.insert("madridAemetHourlyForecasts", {
          stationIcao: args.stationIcao,
          ...row,
          capturedAt: args.capturedAt,
        });
      }
      upserted += 1;
    }
    return { upserted };
  },
});

export { storeAemetHourlyForecastBatch };

export const pollAemetHourlyForecast = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao ?? "LEMD";
    const apiKey = getAemetOpenDataKey();
    if (!apiKey) {
      return { status: "error", error: "Missing OPENDATA_AEMET_KEY." };
    }

    const rows = await fetchAemetHourlyForecast({
      municipio: MADRID_MUNICIPIO,
      apiKey,
    });

    if (rows.length > 0) {
      await ctx.runMutation("madrid:storeAemetHourlyForecastBatch", {
        stationIcao,
        rows,
        capturedAt: Date.now(),
      });
    }

    return {
      status: "ok",
      forecastRows: rows.length,
    };
  },
});

export const getAemetHourlyForecasts = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const rows = await ctx.db
      .query("madridAemetHourlyForecasts")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.forecastTimeUtc - b.forecastTimeUtc);
    return { rows };
  },
});

// ---------------------------------------------------------------------------
// AEMET Station 3129 hourly observations (0.1°C precision)
// ---------------------------------------------------------------------------

async function fetchAemetStationObservations({ stationId, apiKey }) {
  const metaUrl = `${AEMET_OPENDATA_BASE_URL}/api/observacion/convencional/datos/estacion/${stationId}?api_key=${apiKey}`;
  const metaResponse = await fetch(metaUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!metaResponse.ok) {
    const text = await metaResponse.text();
    throw new Error(
      `AEMET station obs meta failed (${metaResponse.status}): ${text.slice(0, 220)}`,
    );
  }
  const meta = await metaResponse.json();
  const datosUrl = toNonEmptyString(meta?.datos);
  if (!datosUrl) {
    throw new Error("AEMET station obs meta missing datos URL.");
  }

  const dataResponse = await fetch(datosUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!dataResponse.ok) {
    const text = await dataResponse.text();
    throw new Error(
      `AEMET station obs data failed (${dataResponse.status}): ${text.slice(0, 220)}`,
    );
  }

  const payload = await dataResponse.json();
  if (!Array.isArray(payload)) {
    return [];
  }

  const rows = [];
  for (const entry of payload) {
    const fint = entry.fint;
    const ta = entry.ta;
    if (!fint || !Number.isFinite(ta)) {
      continue;
    }
    // fint is UTC ISO string like "2026-03-29T14:00:00UTC"
    const cleanFint = fint.replace(/UTC$/, "Z");
    const epochMs = new Date(cleanFint).getTime();
    if (!Number.isFinite(epochMs)) {
      continue;
    }
    const dateStr = formatMadridDate(epochMs);
    const localStr = formatMadridDateTime(epochMs);

    rows.push({
      date: dateStr,
      obsTimeUtc: epochMs,
      obsTimeLocal: localStr,
      tempC: roundToTenth(ta),
      tempF: toFahrenheit(ta),
      humidity: Number.isFinite(entry.hr) ? roundToTenth(entry.hr) : undefined,
      dewPointC: Number.isFinite(entry.tpr) ? roundToTenth(entry.tpr) : undefined,
      windSpeedKmh: Number.isFinite(entry.vv) ? roundToTenth(entry.vv * 3.6) : undefined,
      windDirection: Number.isFinite(entry.dv) ? entry.dv : undefined,
      pressureHpa: Number.isFinite(entry.pres) ? roundToTenth(entry.pres) : undefined,
      precipMm: Number.isFinite(entry.prec) ? roundToTenth(entry.prec) : undefined,
    });
  }

  return rows;
}

const storeAemetStationObservationBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(
      v.object({
        date: v.string(),
        obsTimeUtc: v.number(),
        obsTimeLocal: v.string(),
        tempC: v.number(),
        tempF: v.number(),
        humidity: v.optional(v.number()),
        dewPointC: v.optional(v.number()),
        windSpeedKmh: v.optional(v.number()),
        windDirection: v.optional(v.number()),
        pressureHpa: v.optional(v.number()),
        precipMm: v.optional(v.number()),
      }),
    ),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    let upserted = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("madridAemetStationObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          tempC: row.tempC,
          tempF: row.tempF,
          humidity: row.humidity,
          dewPointC: row.dewPointC,
          windSpeedKmh: row.windSpeedKmh,
          windDirection: row.windDirection,
          pressureHpa: row.pressureHpa,
          precipMm: row.precipMm,
          capturedAt: args.capturedAt,
        });
      } else {
        await ctx.db.insert("madridAemetStationObservations", {
          stationIcao: args.stationIcao,
          ...row,
          source: "aemet-opendata-3129",
          capturedAt: args.capturedAt,
        });
      }
      upserted += 1;
    }
    return { upserted };
  },
});

export { storeAemetStationObservationBatch };

export const pollAemetStationObservations = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao ?? "LEMD";
    const apiKey = getAemetOpenDataKey();
    if (!apiKey) {
      return { status: "error", error: "Missing OPENDATA_AEMET_KEY." };
    }

    const rows = await fetchAemetStationObservations({
      stationId: MADRID_AEMET_STATION_ID,
      apiKey,
    });

    if (rows.length > 0) {
      await ctx.runMutation("madrid:storeAemetStationObservationBatch", {
        stationIcao,
        rows,
        capturedAt: Date.now(),
      });
    }

    return {
      status: "ok",
      observationRows: rows.length,
    };
  },
});

export const getAemetStationObservations = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const rows = await ctx.db
      .query("madridAemetStationObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
    return { rows };
  },
});

// ---------------------------------------------------------------------------
// SYNOP observations via OGIMET (0.1°C precision, hourly at :00Z)
// ---------------------------------------------------------------------------

function parseSynopTemp(group) {
  if (!group || group.length < 4) {
    return null;
  }
  const sign = group[0] === "1" ? -1 : 1;
  const tenths = parseInt(group.slice(1), 10);
  if (!Number.isFinite(tenths)) {
    return null;
  }
  return sign * tenths / 10;
}

function parseSynopRow(csvLine) {
  // Format: WMOIND,YEAR,MONTH,DAY,HOUR,MIN,REPORT
  const match = /^(\d{5}),(\d{4}),(\d{2}),(\d{2}),(\d{2}),(\d{2}),(.+)$/.exec(
    csvLine.trim(),
  );
  if (!match) {
    return null;
  }
  const [, , year, month, day, hour, min, report] = match;
  const isoUtc = `${year}-${month}-${day}T${hour}:${min}:00Z`;
  const epochMs = new Date(isoUtc).getTime();
  if (!Number.isFinite(epochMs)) {
    return null;
  }

  // Extract temperature (1sTTT) and dewpoint (2sTTT) groups from section 1.
  // Stop at section 3 marker "333" — after that, 1sTTT means max temp, not current.
  const tokens = report.split(/\s+/);
  let tempC = null;
  let dewPointC = null;
  for (const token of tokens) {
    if (token === "333" || token === "444" || token === "555") {
      break;
    }
    if (/^1[01]\d{3}$/.test(token)) {
      tempC = parseSynopTemp(token.slice(1));
    } else if (/^2[01]\d{3}$/.test(token)) {
      dewPointC = parseSynopTemp(token.slice(1));
    }
  }

  return { epochMs, rawSynop: report, tempC, dewPointC };
}

async function fetchOgimetSynop({ wmoBlock, beginUtc, endUtc }) {
  const fmt = (d) => {
    const s = new Date(d).toISOString();
    return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10) + s.slice(11, 13) + "00";
  };
  const url = `${OGIMET_SYNOP_BASE_URL}?block=${wmoBlock}&begin=${fmt(beginUtc)}&end=${fmt(endUtc)}`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": DEFAULT_BROWSER_USER_AGENT },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OGIMET SYNOP fetch failed (${response.status}): ${text.slice(0, 220)}`,
    );
  }
  const text = await response.text();
  const lines = text.split("\n").filter((l) => /^\d{5},/.test(l.trim()));
  const rows = [];
  for (const line of lines) {
    const parsed = parseSynopRow(line);
    if (parsed && parsed.tempC !== null) {
      const dateStr = formatMadridDate(parsed.epochMs);
      const localStr = formatMadridDateTime(parsed.epochMs);
      rows.push({
        date: dateStr,
        obsTimeUtc: parsed.epochMs,
        obsTimeLocal: localStr,
        tempC: roundToTenth(parsed.tempC),
        tempF: toFahrenheit(parsed.tempC),
        dewPointC: parsed.dewPointC !== null
          ? roundToTenth(parsed.dewPointC)
          : undefined,
        rawSynop: parsed.rawSynop,
      });
    }
  }
  return rows;
}

const storeSynopObservationBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(
      v.object({
        date: v.string(),
        obsTimeUtc: v.number(),
        obsTimeLocal: v.string(),
        tempC: v.number(),
        tempF: v.number(),
        dewPointC: v.optional(v.number()),
        rawSynop: v.string(),
      }),
    ),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    let upserted = 0;
    for (const row of args.rows) {
      const existing = await ctx.db
        .query("madridSynopObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", args.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          tempC: row.tempC,
          tempF: row.tempF,
          dewPointC: row.dewPointC,
          rawSynop: row.rawSynop,
          capturedAt: args.capturedAt,
        });
      } else {
        await ctx.db.insert("madridSynopObservations", {
          stationIcao: args.stationIcao,
          ...row,
          source: "ogimet-synop-08221",
          capturedAt: args.capturedAt,
        });
      }
      upserted += 1;
    }
    return { upserted };
  },
});

export { storeSynopObservationBatch };

export const pollSynopObservations = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = args.stationIcao ?? "LEMD";
    // Fetch the last 13 hours to ensure overlap and no missed reports.
    const now = Date.now();
    const beginUtc = now - 13 * 60 * 60 * 1000;
    const endUtc = now;

    const rows = await fetchOgimetSynop({
      wmoBlock: MADRID_WMO_BLOCK,
      beginUtc,
      endUtc,
    });

    if (rows.length > 0) {
      await ctx.runMutation("madrid:storeSynopObservationBatch", {
        stationIcao,
        rows,
        capturedAt: now,
      });
    }

    return {
      status: "ok",
      synopRows: rows.length,
    };
  },
});

export const getSynopObservations = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }
    const rows = await ctx.db
      .query("madridSynopObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
    return { rows };
  },
});
