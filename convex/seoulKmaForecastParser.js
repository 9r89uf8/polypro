const SEOUL_UTC_OFFSET_HOURS = 9;

const HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function decodeHtmlEntities(value) {
  return String(value ?? "").replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, entity) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) {
        const codePoint = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }
      if (lower.startsWith("#")) {
        const codePoint = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return HTML_ENTITIES.get(lower) ?? match;
    },
  );
}

function toPlainText(value) {
  return decodeHtmlEntities(
    String(value ?? "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(attributes, name) {
  const match = new RegExp(
    String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(attributes ?? "");
  return match ? decodeHtmlEntities(match[1] ?? match[2] ?? "") : null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseKstForecastTime(date, hour) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    return null;
  }
  const parsedHour = Number(hour);
  if (!Number.isInteger(parsedHour) || parsedHour < 0 || parsedHour > 23) {
    return null;
  }
  const epochMs = Date.parse(
    `${date}T${String(parsedHour).padStart(2, "0")}:00:00+09:00`,
  );
  return Number.isFinite(epochMs) ? epochMs : null;
}

function parsePageTimestamp(html) {
  const timestampNode =
    /<div\b[^>]*class=(?:"[^"]*\btm_issue_date\b[^"]*"|'[^']*\btm_issue_date\b[^']*')[^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    );
  const text = timestampNode ? toPlainText(timestampNode[1]) : "";
  const match =
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*(\d{1,2}):(\d{2})\s*\(KST\)/i.exec(
      text,
    );
  if (!match) {
    return null;
  }
  const month = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  }[match[2].toLowerCase()];
  if (!Number.isInteger(month)) {
    return null;
  }
  const day = Number(match[1]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const epochMs = Date.UTC(
    year,
    month,
    day,
    hour - SEOUL_UTC_OFFSET_HOURS,
    minute,
  );
  if (
    !Number.isFinite(epochMs) ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return {
    pageReportedAt: epochMs,
    pageReportedAtLocal: `${String(year).padStart(4, "0")}-${String(
      month + 1,
    ).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(
      hour,
    ).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function extractLabeledValue(block, label) {
  const expression = new RegExp(
    String.raw`<span\b[^>]*class=(?:"[^"]*\bts-hidden\b[^"]*"|'[^']*\bts-hidden\b[^']*')[^>]*>\s*${label}\s*<\/span>\s*<span\b[^>]*>([\s\S]*?)(?:<\/span>|<\/li>)`,
    "i",
  );
  const match = expression.exec(block);
  return match ? toPlainText(match[1]) : null;
}

function parseDistance(value, defaultUnit) {
  const text = String(value ?? "").replaceAll(",", "").trim();
  const match = /(-?\d+(?:\.\d+)?)\s*(ft|km|m)?/i.exec(text);
  if (!match) {
    return null;
  }
  const amount = toFiniteNumber(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const unit = (match[2] ?? defaultUnit).toLowerCase();
  if (defaultUnit === "ft") {
    return unit === "ft" ? Math.round(amount) : null;
  }
  if (unit === "km") {
    return Math.round(amount * 1000);
  }
  return unit === "m" ? Math.round(amount) : null;
}

function parseWindSpeed(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  const match = /(\d+(?:\.\d+)?)(?:G(\d+(?:\.\d+)?)?)?kt/i.exec(text);
  if (!match) {
    return {};
  }
  const windSpeedKt = toFiniteNumber(match[1]);
  const windGustKt = toFiniteNumber(match[2]);
  return {
    ...(Number.isFinite(windSpeedKt) ? { windSpeedKt } : {}),
    ...(Number.isFinite(windGustKt) ? { windGustKt } : {}),
  };
}

function parseDailyRows(html) {
  const starts = Array.from(
    html.matchAll(
      /<div\b([^>]*class=(?:"[^"]*\bts-daily-item\b[^"]*"|'[^']*\bts-daily-item\b[^']*')[^>]*)>/gi,
    ),
  );
  const byDate = new Map();

  for (let index = 0; index < starts.length; index += 1) {
    const opening = starts[index];
    const chunk = html.slice(
      opening.index,
      starts[index + 1]?.index ?? html.length,
    );
    const forecastType =
      (getAttribute(opening[1], "data-type") ?? "").toUpperCase() === "DAILY"
        ? "short_term"
        : "midterm";
    const dateMatch = /\bdata-date\s*=\s*(?:"(\d{4}-\d{2}-\d{2})"|'(\d{4}-\d{2}-\d{2})')/i.exec(
      chunk,
    );
    const date = dateMatch?.[1] ?? dateMatch?.[2] ?? null;
    if (!date) {
      continue;
    }
    const minimumNode =
      /class=(?:"[^"]*\bmin-color\b[^"]*"|'[^']*\bmin-color\b[^']*')[^>]*>\s*(-?\d+(?:\.\d+)?)/i.exec(
        chunk,
      );
    const maximumNode =
      /class=(?:"[^"]*\bmax-color\b[^"]*"|'[^']*\bmax-color\b[^']*')[^>]*>\s*(-?\d+(?:\.\d+)?)/i.exec(
        chunk,
      );
    const dataMinimum =
      /\bdata-min-temp\s*=\s*(?:"(-?\d+(?:\.\d+)?)"|'(-?\d+(?:\.\d+)?)')/i.exec(
        chunk,
      );
    const dataMaximum =
      /\bdata-max-temp\s*=\s*(?:"(-?\d+(?:\.\d+)?)"|'(-?\d+(?:\.\d+)?)')/i.exec(
        chunk,
      );
    const minTempC = toFiniteNumber(
      minimumNode?.[1] ?? dataMinimum?.[1] ?? dataMinimum?.[2],
    );
    const maxTempC = toFiniteNumber(
      maximumNode?.[1] ?? dataMaximum?.[1] ?? dataMaximum?.[2],
    );
    if (!Number.isFinite(minTempC) && !Number.isFinite(maxTempC)) {
      continue;
    }
    const conditionNode =
      /<span\b([^>]*class=(?:"[^"]*\bts-wicon\b[^"]*"|'[^']*\bts-wicon\b[^']*')[^>]*)>([\s\S]*?)<\/span>/i.exec(
        chunk,
      );
    const phrase = conditionNode ? toPlainText(conditionNode[2]) : null;
    const row = {
      date,
      forecastType,
      ...(Number.isFinite(minTempC)
        ? { minTempC, minTempF: toFahrenheit(minTempC) }
        : {}),
      ...(Number.isFinite(maxTempC)
        ? { maxTempC, maxTempF: toFahrenheit(maxTempC) }
        : {}),
      ...(phrase ? { phrase } : {}),
    };
    const existing = byDate.get(date);
    if (!existing || forecastType === "short_term") {
      byDate.set(date, { ...existing, ...row });
    } else {
      byDate.set(date, { ...row, ...existing });
    }
  }

  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function parseHourlyRows(html) {
  const rows = [];
  const blocks = html.matchAll(
    /<div\b[^>]*class=(?:"[^"]*\bts-hourly-item\b[^"]*"|'[^']*\bts-hourly-item\b[^']*')[^>]*>([\s\S]*?)<\/div>/gi,
  );

  for (const match of blocks) {
    const block = match[1];
    const timeNode =
      /<li\b([^>]*\bdata-date\s*=\s*(?:"[^"]*"|'[^']*')[^>]*\bdata-hour\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>/i.exec(
        block,
      );
    const date = timeNode ? getAttribute(timeNode[1], "data-date") : null;
    const hour = timeNode ? getAttribute(timeNode[1], "data-hour") : null;
    const temperatureNode =
      /\bdata-atemp\s*=\s*(?:"(-?\d+(?:\.\d+)?)"|'(-?\d+(?:\.\d+)?)')/i.exec(
        block,
      );
    const tempC = toFiniteNumber(
      temperatureNode?.[1] ?? temperatureNode?.[2],
    );
    const forecastTimeUtc = parseKstForecastTime(date, hour);
    if (
      !date ||
      !Number.isFinite(forecastTimeUtc) ||
      !Number.isFinite(tempC)
    ) {
      continue;
    }

    const conditionNode =
      /<span\b([^>]*class=(?:"[^"]*\bts-wicon\b[^"]*"|'[^']*\bts-wicon\b[^']*')[^>]*)>([\s\S]*?)<\/span>/i.exec(
        block,
      );
    const conditionClasses = conditionNode
      ? getAttribute(conditionNode[1], "class")
      : null;
    const conditionCode =
      conditionClasses?.match(/\b(mtph[0-9a-z_-]+)\b/i)?.[1] ?? null;
    const phrase = conditionNode ? toPlainText(conditionNode[2]) : null;
    const directionNode =
      /<i\b[^>]*class=(?:"[^"]*\bdir-arrow\b[^"]*"|'[^']*\bdir-arrow\b[^']*')[^>]*>([\s\S]*?)<\/i>/i.exec(
        block,
      );
    const windDirectionDeg = toFiniteNumber(
      directionNode ? toPlainText(directionNode[1]).replace("°", "") : null,
    );
    const windSpeedText = extractLabeledValue(block, "Wind\\s+Speed");
    const ceilingText = extractLabeledValue(block, "Ceiling");
    const visibilityText = extractLabeledValue(block, "Visibility");
    const crosswindNode =
      /<span\b[^>]*class=(?:"[^"]*\bts-cwicon\b[^"]*"|'[^']*\bts-cwicon\b[^']*')[^>]*>([\s\S]*?)<\/span>/i.exec(
        block,
      );
    const crosswindText = crosswindNode
      ? toPlainText(crosswindNode[1])
      : null;
    const ceilingFt = parseDistance(ceilingText, "ft");
    const visibilityM = parseDistance(visibilityText, "m");

    rows.push({
      date,
      forecastTimeUtc,
      forecastTimeLocal: `${date} ${String(Number(hour)).padStart(2, "0")}:00`,
      tempC,
      tempF: toFahrenheit(tempC),
      ...(phrase ? { phrase } : {}),
      ...(conditionCode ? { conditionCode } : {}),
      ...(Number.isFinite(windDirectionDeg) ? { windDirectionDeg } : {}),
      ...(windSpeedText
        ? {
            windSpeedText,
            ...parseWindSpeed(windSpeedText),
          }
        : {}),
      ...(ceilingText ? { ceilingText } : {}),
      ...(Number.isFinite(ceilingFt) ? { ceilingFt } : {}),
      ...(visibilityText ? { visibilityText } : {}),
      ...(Number.isFinite(visibilityM) ? { visibilityM } : {}),
      ...(crosswindText ? { crosswindText } : {}),
    });
  }

  return rows.sort(
    (left, right) => left.forecastTimeUtc - right.forecastTimeUtc,
  );
}

function parseStationName(html) {
  const node =
    /<p\b[^>]*class=(?:"[^"]*\bairport_small_name\b[^"]*"|'[^']*\bairport_small_name\b[^']*')[^>]*>([\s\S]*?)<\/p>/i.exec(
      html,
    );
  return node ? toPlainText(node[1]) : null;
}

function parseStationIcao(html) {
  const node =
    /<span\b[^>]*class=(?:"[^"]*\bairport_spl\b[^"]*"|'[^']*\bairport_spl\b[^']*')[^>]*>([\s\S]*?)<\/span>/i.exec(
      html,
    );
  const stationIcao = node ? toPlainText(node[1]).toUpperCase() : null;
  return /^[A-Z0-9]{4}$/.test(stationIcao ?? "") ? stationIcao : null;
}

export function parseKmaAirportForecastHtml(
  html,
  { expectedStationIcao } = {},
) {
  if (typeof html !== "string" || html.trim().length === 0) {
    throw new Error("KMA/AMO airport forecast response was empty.");
  }
  const stationIcao = parseStationIcao(html);
  const normalizedExpectedStationIcao = String(expectedStationIcao ?? "")
    .trim()
    .toUpperCase();
  if (
    normalizedExpectedStationIcao &&
    stationIcao !== normalizedExpectedStationIcao
  ) {
    throw new Error(
      `KMA/AMO airport forecast provenance mismatch: requested ${normalizedExpectedStationIcao}, page displayed ${stationIcao ?? "no ICAO"}.`,
    );
  }
  const dailyRows = parseDailyRows(html);
  const hourlyRows = parseHourlyRows(html);
  if (!dailyRows.length) {
    throw new Error(
      "KMA/AMO airport forecast HTML contained no daily min/max rows.",
    );
  }
  if (!hourlyRows.length) {
    throw new Error(
      "KMA/AMO airport forecast HTML contained no hourly forecast rows.",
    );
  }
  return {
    stationIcao,
    stationName: parseStationName(html),
    ...parsePageTimestamp(html),
    dailyRows,
    hourlyRows,
  };
}
