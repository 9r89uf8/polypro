const AEROWEB_FETCH_TIMEOUT_MS = 25000;

function toNonEmptyString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
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

  const reportTsUtc = parseReportTimestampFromRaw(rawMetar);
  if (!Number.isFinite(reportTsUtc)) {
    throw new Error("AEROWEB current page did not include a parseable METAR timestamp.");
  }

  return {
    reportType,
    rawMetar,
    reportTsUtc,
  };
}

export async function fetchLatestAerowebMessage(stationIcao, sessionRef = {}) {
  const normalizedStation = String(stationIcao ?? "").trim().toUpperCase();
  if (!normalizedStation) {
    throw new Error("stationIcao is required.");
  }

  if (!sessionRef.cookieHeader) {
    sessionRef.cookieHeader = await createAerowebSessionCookieHeader();
  }

  async function fetchOnce() {
    const html = await fetchAerowebShowmessageHtml(normalizedStation, sessionRef.cookieHeader);
    return parseAerowebCurrentHtml(html, normalizedStation);
  }

  try {
    const hit = await fetchOnce();
    return {
      seenAt: Date.now(),
      ...hit,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/session expired|login/i.test(message)) {
      throw error;
    }
    sessionRef.cookieHeader = await createAerowebSessionCookieHeader();
    const hit = await fetchOnce();
    return {
      seenAt: Date.now(),
      ...hit,
    };
  }
}
