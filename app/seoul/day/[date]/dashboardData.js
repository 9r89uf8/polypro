const MINUTE_MS = 60_000;
const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;
const CLOUD_FRESHNESS_MS = 45 * MINUTE_MS;
const FORECAST_FRESHNESS_MS = 6 * 60 * MINUTE_MS;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function seoulDate(time) {
  if (finite(time) === null) return null;
  const local = new Date(time + KST_OFFSET_MS);
  return Number.isFinite(local.getTime()) ? local.toISOString().slice(0, 10) : null;
}

function seoulMinute(time) {
  const local = new Date(time + KST_OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
}

function localTime(time) {
  return new Date(time + KST_OFFSET_MS).toISOString().slice(11, 16);
}

function fromLocalTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? ""));
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 9, Number(minute), Number(second));
  return seoulDate(time) === `${year}-${month}-${day}` ? time : null;
}

function observationTime(row) {
  return finite(row?.obsTimeUtc) ?? fromLocalTimestamp(row?.obsTimeLocal);
}

function onDate(row, time, date) {
  return time !== null && seoulDate(time) === date && (!row?.stationIcao || row.stationIcao === "RKSI");
}

function officialType(row) {
  const raw = String(row?.rawMetar ?? "").trim().toUpperCase();
  const type = String(row?.reportType ?? "").toUpperCase();
  if (type === "SPECI" || /^(?:COR\s+)?SPECI\b/.test(raw)) return "SPECI";
  if (type && type !== "METAR") return null;
  if (/^(?:TAF|MET\s+REPORT)\b/.test(raw)) return null;
  return type === "METAR" || /^(?:(?:METAR|COR)\s+)*RKSI\b/.test(raw) ? "METAR" : null;
}

function revisionRank(row) {
  return finite(row?.updatedAt) ?? finite(row?._creationTime) ?? finite(row?.firstSeenAt) ?? 0;
}

function isCorrection(row) {
  return row?.isCorrection === true || /(?:^|\s)COR(?:\s|$)/i.test(String(row?.rawMetar ?? ""));
}

function newerRevision(candidate, current) {
  return !current || revisionRank(candidate) > revisionRank(current) ||
    (revisionRank(candidate) === revisionRank(current) && (isCorrection(candidate) || !isCorrection(current)));
}

function officialRows(rows, date, includeSpeci) {
  const byTime = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const time = observationTime(row);
    const type = officialType(row);
    if (!onDate(row, time, date) || !type || (!includeSpeci && type === "SPECI")) continue;
    if (newerRevision(row, byTime.get(time))) byTime.set(time, row);
  }
  return [...byTime].sort(([left], [right]) => left - right).map(([time, row]) => ({ row, time }));
}

/** Points use UTC epoch milliseconds for time and a KST minute-of-day for minute. */
export function buildTemperatureSeries(day, date) {
  const byTime = new Map();
  const cadencePriority = (row) => row?.collectionCadence === "one_minute" ? 2 : row?.collectionCadence === "five_minute" ? 1 : 0;
  for (const row of Array.isArray(day?.amosRows) ? day.amosRows : []) {
    const time = observationTime(row);
    if (!onDate(row, time, date) || finite(row?.tempC) === null || String(row?.rwyNo) !== "2" || row?.rwyDir !== "15L") continue;
    const current = byTime.get(time);
    if (!current || cadencePriority(row) > cadencePriority(current) ||
      (cadencePriority(row) === cadencePriority(current) && newerRevision(row, current))) {
      byTime.set(time, row);
    }
  }
  const amos = [...byTime].sort(([left], [right]) => left - right).map(([time, row]) => ({
    time,
    minute: seoulMinute(time),
    tempC: row.tempC,
    firstSeenAt: finite(row.firstSeenAt),
  }));
  // This simplified card and chart explicitly show routine METAR only.
  const metar = officialRows(day?.rows, date, false)
    .filter(({ row }) => finite(row.tempC) !== null)
    .map(({ time, row }) => ({ time, minute: seoulMinute(time), tempC: row.tempC, rawMetar: String(row.rawMetar ?? "") }));
  const highest = metar.reduce((best, point) => !best || point.tempC > best.tempC ? point : best, null);
  return {
    amos,
    metar,
    latestAmos: amos.at(-1) ?? null,
    officialHigh: highest ? { tempC: highest.tempC, time: highest.time } : null,
  };
}

function emptyForecast(status) {
  return { highC: null, hourlyPeakC: null, peakWindows: [], capturedAt: null, status, hourly: [] };
}

export function summarizeForecast(dashboard, date, nowMs) {
  if (dashboard === undefined) return emptyForecast("loading");
  if (dashboard?.kmaAccess?.approved !== true) return emptyForecast("approval_required");
  const forecast = dashboard?.kmaForecast ?? {};
  const diagnostics = dashboard?.kmaHourlyDiagnostics ?? {};
  const capture = forecast.latestCapture ?? dashboard?.latestKmaForecastCapture ?? null;
  // Do not use the old generic latestForecastCapture alias: older responses used Weather.com there.
  if (capture && ((capture.source && capture.source !== "kma_amo_airport") || (capture.status && capture.status !== "ok"))) {
    return emptyForecast(capture.status === "approval_required" ? "approval_required" : "no_data");
  }
  if (["approval_required", "access_not_approved", "disabled"].includes(forecast.status)) return emptyForecast("approval_required");
  const dailyRows = Array.isArray(capture?.dailyRows) ? capture.dailyRows : [];
  const daily = forecast.selectedDateForecast?.date === date
    ? forecast.selectedDateForecast
    : dailyRows.find((row) => row?.date === date) ?? null;
  const highC = finite(daily?.maxTempC);
  const capturedAt = finite(capture?.capturedAt) ?? finite(forecast.latestCapturedAt) ?? finite(diagnostics.latestCapturedAt);
  const rawHourly = Array.isArray(capture?.hourlyRows) ? capture.hourlyRows
    : Array.isArray(forecast.hourlyRows) ? forecast.hourlyRows
      : Array.isArray(diagnostics.points) ? diagnostics.points : [];
  const byTime = new Map();
  for (const row of rawHourly) {
    const time = finite(row?.forecastTimeUtc) ?? fromLocalTimestamp(row?.forecastTimeLocal);
    if (!onDate(row, time, date) || (row?.date && row.date !== date) || finite(row?.tempC) === null) continue;
    byTime.set(time, { time, minute: seoulMinute(time), tempC: row.tempC });
  }
  const hourly = [...byTime.values()].sort((left, right) => left.time - right.time);
  const hourlyPeakC = hourly.length ? Math.max(...hourly.map((row) => row.tempC)) : null;
  const peakWindows = [];
  for (const row of hourly.filter((point) => point.tempC === hourlyPeakC)) {
    const hour = row.minute / 60;
    const previous = peakWindows.at(-1);
    if (previous && hour === previous.endHour + 1) previous.endHour = hour;
    else peakWindows.push({ startHour: hour, endHour: hour });
  }
  const hasData = highC !== null || hourly.length > 0;
  const historical = finite(nowMs) !== null && date < seoulDate(nowMs);
  const freshnessMs = finite(forecast.staleAfterMinutes) !== null && forecast.staleAfterMinutes > 0
    ? forecast.staleAfterMinutes * MINUTE_MS : FORECAST_FRESHNESS_MS;
  const stale = !historical && (forecast.isStale === true || capturedAt === null ||
    (finite(nowMs) !== null && (nowMs - capturedAt > freshnessMs || capturedAt > nowMs + MINUTE_MS)));
  const error = forecast.status === "error" || forecast.latestAttemptStatus === "error";
  const status = !hasData ? error ? "error" : "no_data"
    : historical ? "historical" : error ? "error" : stale ? "stale" : "ok";
  return { highC, hourlyPeakC, peakWindows, capturedAt, status, hourly };
}

const CLOUD_AMOUNTS = {
  FEW: { min: 1, max: 2, label: "Few clouds" },
  SCT: { min: 3, max: 4, label: "Scattered clouds" },
  BKN: { min: 5, max: 7, label: "Broken clouds" },
  OVC: { min: 8, max: 8, label: "Overcast" },
};

function observedTokens(rawMetar) {
  const tokens = String(rawMetar ?? "").trim().toUpperCase().replace(/=\s*$/, "").split(/\s+/).filter(Boolean);
  const stop = tokens.findIndex((token) => /^(?:M?\d{2}|\/\/)\/(?:M?\d{2}|\/\/)$/.test(token) ||
    /^(?:Q|A)\d{4}$/.test(token) || /^(?:NOSIG|BECMG|TEMPO|INTER|RMK)$/.test(token) || /^FM\d{6}$/.test(token) || /^PROB\d{2}$/.test(token));
  return stop < 0 ? tokens : tokens.slice(0, stop);
}

function skyCondition(rawMetar) {
  const tokens = observedTokens(rawMetar);
  const unknown = (label, detail) => ({ label, detail, min: null, max: null, signature: null });
  const verticalVisibility = tokens.find((token) => /^VV(?:\d{3}|\/\/\/)$/.test(token));
  if (verticalVisibility) return unknown("Sky obscured", "Vertical visibility reported; cloud cover cannot be quantified.");
  // These describe operational significance or detection, not total sky cover.
  if (tokens.includes("CAVOK")) return unknown("No significant cloud", "CAVOK: good visibility and no significant low cloud. Total cloud cover is not specified.");
  if (tokens.includes("NSC")) return unknown("No significant cloud", "NSC does not specify total cloud cover.");
  if (tokens.includes("NCD")) return unknown("No cloud detected", "NCD does not specify total cloud cover.");
  if (tokens.includes("CLR")) return unknown("No cloud detected", "CLR describes the automated sensor's detection range, not total cloud cover.");
  const layers = tokens.map((token) => /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(?:CB|TCU)?$/.exec(token))
    .filter(Boolean).map((match) => ({ ...CLOUD_AMOUNTS[match[1]], amount: match[1], token: match[0] }));
  if (layers.length) {
    const primary = layers.reduce((best, layer) => layer.min > best.min ? layer : best);
    // Layer overlap is unknown. Bound the union instead of summing clouds or calling the largest layer total coverage.
    const min = Math.max(...layers.map((layer) => layer.min));
    const max = Math.min(8, layers.reduce((total, layer) => total + layer.max, 0));
    const amount = min === max ? `${min}/8` : `${min}–${max}/8`;
    return {
      label: primary.label,
      detail: `${layers.map((layer) => layer.token).join(" · ")}. ${layers.length > 1 ? "Combined reported layers" : "Reported cloud amount"}: ${amount} of the sky.`,
      min,
      max,
      signature: layers.length === 1 ? layers[0].amount : null,
    };
  }
  if (tokens.includes("SKC")) return { label: "Clear sky", detail: "SKC: no cloud reported.", min: 0, max: 0, signature: "SKC" };
  return unknown("Cloud cover unavailable", "The latest report has no usable cloud-cover observation.");
}

export function summarizeClouds(metarRows, date, nowMs, isToday) {
  const rows = officialRows(metarRows, date, true).filter(({ time }) => finite(nowMs) === null || time <= nowMs);
  const latest = rows.at(-1);
  if (!latest) return {
    label: "Cloud cover unavailable", detail: "No official cloud observation is available for this date.",
    coverageMin: null, coverageMax: null, trend: "unknown", trendDetail: "Waiting for official observations.", observedAt: null, stale: Boolean(isToday),
  };
  const sky = skyCondition(latest.row.rawMetar);
  const stale = Boolean(isToday) && (finite(nowMs) === null || nowMs - latest.time > CLOUD_FRESHNESS_MS);
  let trend = "unknown";
  let trendDetail = !isToday ? "Historical observation; no live clearing trend."
    : stale ? "Latest observation is more than 45 minutes old; current trend is unavailable."
      : "Two recent, comparable cloud observations are needed.";
  const previous = rows.at(-2);
  if (isToday && !stale && previous && finite(nowMs) !== null && nowMs - previous.time <= CLOUD_FRESHNESS_MS && latest.time - previous.time <= CLOUD_FRESHNESS_MS) {
    const before = skyCondition(previous.row.rawMetar);
    if (sky.min !== null && before.min !== null) {
      const comparison = `${localTime(previous.time)}–${localTime(latest.time)} KST`;
      if (sky.max < before.min) {
        trend = "clearing";
        trendDetail = `Less reported cloud cover between ${comparison}.`;
      } else if (sky.min > before.max) {
        trend = "increasing";
        trendDetail = `More reported cloud cover between ${comparison}.`;
      } else if ((sky.signature && sky.signature === before.signature) || (sky.min === sky.max && sky.min === before.min && sky.max === before.max)) {
        trend = "steady";
        trendDetail = `Reported cloud category unchanged between ${comparison}; finer changes may not be resolved.`;
      } else {
        trendDetail = "Reported cloud ranges overlap; clearing or increasing cover cannot be established.";
      }
    } else {
      trendDetail = "The recent reports do not quantify comparable total cloud cover.";
    }
  }
  return {
    label: sky.label,
    detail: `${!isToday ? "Last report for this date. " : stale ? "Last reported conditions. " : ""}${sky.detail}`,
    coverageMin: sky.min,
    coverageMax: sky.max,
    trend,
    trendDetail,
    observedAt: latest.time,
    stale,
  };
}

/** A rapid satellite estimate of change, independent of METAR sky coverage and DSR sunlight. */
export function summarizeSatelliteCloudTrend(dashboard, date, nowMs, isToday) {
  const unavailable = (label, detail) => ({ state: "unavailable", label, detail, observedAt: null });
  if (!isToday) return unavailable("Cloud trend unavailable", "Live trend is available for today.");
  if (dashboard === undefined || finite(nowMs) === null) return unavailable("Loading cloud trend…", "Waiting for satellite readings.");
  if (dashboard?.configured !== true || dashboard.status === "disabled") {
    return unavailable("Cloud trend unavailable", "Satellite access is not enabled.");
  }
  if (dashboard.stationIcao !== "RKSI" || dashboard.date !== date || dashboard.today !== date || seoulDate(nowMs) !== date) {
    return unavailable("Cloud trend unavailable", "Waiting for today’s airport satellite data.");
  }
  if (dashboard.status === "night" || dashboard.collectionWindowOpen === false) {
    return unavailable("Cloud trend paused", "Night or very low sun.");
  }
  if (dashboard.collectionWindowOpen !== true) return unavailable("Cloud trend unavailable", "Waiting for usable satellite data.");
  const latest = dashboard.latest;
  if (dashboard.status === "building" && latest == null) {
    return unavailable("Cloud trend building", "Waiting for the first satellite readings.");
  }
  const time = finite(latest?.obsTimeUtc);
  if (dashboard.status === "stale" || (time !== null && nowMs - time > 12 * MINUTE_MS)) {
    return unavailable("Cloud data delayed", "Waiting for a fresh satellite observation.");
  }
  if (!["ok", "building"].includes(dashboard.status) || time === null || time > nowMs || seoulDate(time) !== date ||
      finite(latest?.reflectance) === null || finite(latest?.brightnessTempK) === null ||
      finite(latest?.validCellCount) === null || latest.validCellCount < 20) {
    return unavailable("Cloud trend unavailable", "Waiting for usable satellite data.");
  }
  const trend = dashboard.trend;
  const hasHistory = finite(trend?.sampleCount) !== null && trend.sampleCount >= 4 &&
    finite(trend?.coverageMinutes) !== null && trend.coverageMinutes >= 6 &&
    finite(trend?.commonCellCount) !== null && trend.commonCellCount >= 20;
  if (!hasHistory || !["clearing", "increasing", "steady", "uncertain"].includes(trend?.state)) {
    return unavailable("Cloud trend building", "Needs at least six minutes of usable readings.");
  }
  if (trend.state === "uncertain") {
    return { state: "unavailable", label: "Cloud trend uncertain", detail: "Satellite readings do not establish a direction.", observedAt: time };
  }
  if (dashboard.status !== "ok") return unavailable("Cloud trend building", "Waiting for a consistent satellite trend.");
  return {
    state: trend.state,
    label: { clearing: "Clouds clearing", increasing: "Clouds increasing", steady: "Clouds steady" }[trend.state],
    detail: "Satellite estimate",
    observedAt: time,
  };
}

/** Display the existing clear-sky-normalized sunlight trend, never cloud cover. */
export function summarizeSunlight(dashboard, date, nowMs, isToday) {
  const unavailable = (label, detail) => ({ state: "unavailable", label, detail, observedAt: null });
  if (!isToday) return unavailable("Sunlight trend unavailable", "Live trend is available for today.");
  if (dashboard === undefined || finite(nowMs) === null) return unavailable("Loading sunlight…", "GK2A satellite");
  if (dashboard?.configured !== true) return unavailable("Sunlight unavailable", "Satellite access is not enabled.");
  if (dashboard.date !== date || dashboard.today !== date) return unavailable("Sunlight unavailable", "Waiting for today’s satellite data.");
  if (["night", "window_closed"].includes(dashboard.status) || dashboard.collectionWindowOpen !== true) {
    return unavailable("Sunlight trend paused", "Night or very low sun.");
  }
  const latest = dashboard.latest;
  const time = finite(latest?.obsTimeUtc);
  if (dashboard.status === "stale" || (time !== null && nowMs - time > 35 * MINUTE_MS)) {
    return unavailable("Sunlight data delayed", "Waiting for a fresh satellite observation.");
  }
  if (!["ok", "partial"].includes(dashboard.status) || time === null || time > nowMs || seoulDate(time) !== date ||
      finite(latest?.dsrWm2) === null || finite(latest?.transmissionPct) === null) {
    return unavailable("Sunlight unavailable", "Waiting for usable satellite data.");
  }
  const trend = dashboard.trend;
  if (!trend || finite(trend.sampleCount) === null || trend.sampleCount < 3 || finite(trend.coverageMinutes) === null || trend.coverageMinutes < 30 || finite(trend.slopePctPointsPerHour) === null ||
      !["increasing", "decreasing", "steady"].includes(trend.state)) {
    return unavailable("Sunlight trend building", "Needs at least 30 minutes of usable readings.");
  }
  return {
    state: trend.state,
    label: { increasing: "Sunlight increasing", decreasing: "Sunlight decreasing", steady: "Sunlight steady" }[trend.state],
    detail: `Relative to clear sky · past ${Math.round(trend.coverageMinutes)} min`,
    observedAt: time,
  };
}

function marketDecimal(value, price = false) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) || value.length > 80) return null;
  const [whole, fraction = ""] = value.split(".");
  if (price && (whole !== "0" && (whole !== "1" || /[1-9]/.test(fraction)))) return null;
  return fraction.replace(/0+$/, "") ? `${whole}.${fraction.replace(/0+$/, "")}` : whole;
}

function marketCents(value) {
  if (value === null) return "—";
  const [whole, fraction = ""] = value.split(".");
  const shifted = `${whole}${fraction.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  const remainder = fraction.slice(2).replace(/0+$/, "");
  return `${shifted}${remainder ? `.${remainder}` : ""}¢`;
}

function crossedMarketBook(bid, ask) {
  if (bid === null || ask === null) return false;
  const scaled = (value) => { const [whole, fraction = ""] = value.split("."); return `${whole}${fraction.padEnd(18, "0")}`; };
  return scaled(bid) > scaled(ask);
}

/** Retained public YES-market quotes, never a weather probability or settlement calculation. */
export function summarizeSeoulMarket(dashboard, date, nowMs, isToday) {
  const empty = (status, label, message) => ({ status, label, message, polledAt: null, eventUrl: null, eventTitle: null, markets: [] });
  if (!isToday) return empty("unavailable", "Market unavailable", "Live market data is shown for today.");
  if (dashboard === undefined || finite(nowMs) === null) return empty("loading", "Loading market…", "Waiting for today’s market data.");
  const approvalLabels = {
    access_approval_required: "Market access approval required",
    retention_approval_required: "Market storage approval required",
    public_approval_required: "Market display approval required",
  };
  if (approvalLabels[dashboard?.status]) return empty(dashboard.status, approvalLabels[dashboard.status], "Market data is not enabled for this use.");
  if (dashboard?.configured !== true || dashboard.status === "disabled") return empty("disabled", "Market data unavailable", "Market collection is not enabled.");
  if (dashboard.stationIcao !== "RKSI" || dashboard.date !== date || dashboard.today !== date || seoulDate(nowMs) !== date ||
      dashboard.source !== "polymarket_gamma_clob_rest") {
    return empty("unavailable", "Market unavailable", "Waiting for today’s Seoul market.");
  }
  const event = dashboard.event;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const [year, month, day] = date.split("-");
  const expectedSlug = `highest-temperature-in-seoul-on-${months[Number(month) - 1]}-${Number(day)}-${year}`;
  if (!event || event.eventSlug !== expectedSlug) return empty("no_data", "Market unavailable", "Today’s Seoul market has not been captured.");
  let eventUrl = null;
  try {
    const url = new URL(event.url);
    if (url.protocol === "https:" && url.hostname === "polymarket.com" && !url.username && !url.password &&
        url.pathname === `/event/${expectedSlug}`) eventUrl = url.href;
  } catch { /* Invalid external links remain unavailable. */ }
  const metadata = { eventUrl, eventTitle: typeof event.title === "string" ? event.title : "Seoul temperature market" };
  const withoutQuotes = (status, label, message) => ({ ...empty(status, label, message), ...metadata });
  if (event.rulesVerified !== true || dashboard.status === "unsupported_rules") {
    return withoutQuotes("unsupported_rules", "Market rules need review", "The current contract has not been verified.");
  }
  if (event.closed === true) return withoutQuotes("closed", "Market closed", "See the event for its final status.");
  if (["no_data", "error"].includes(dashboard.status)) return withoutQuotes(dashboard.status, "Market unavailable", "Waiting for usable market quotes.");
  const polledAt = finite(dashboard.polledAt);
  const fresh = (time) => finite(time) !== null && time <= nowMs && nowMs - time <= 3 * MINUTE_MS;
  if (dashboard.status === "stale" || (polledAt !== null && nowMs - polledAt > 3 * MINUTE_MS)) {
    return { ...withoutQuotes("stale", "Market data delayed", "Waiting for fresh quotes."), polledAt };
  }
  if (!["ok", "partial"].includes(dashboard.status) || !fresh(polledAt)) {
    return withoutQuotes("unavailable", "Market unavailable", "Waiting for usable market quotes.");
  }
  const rawMarkets = Array.isArray(dashboard.markets) ? dashboard.markets : [];
  const seen = new Set();
  const markets = [];
  for (const row of rawMarkets) {
    if (typeof row?.marketId !== "string" || !row.marketId || seen.has(row.marketId) ||
        !["below", "exact", "above"].includes(row.bucketKind) || finite(row.temperatureC) === null ||
        typeof row.label !== "string" || !row.label.trim()) {
      return withoutQuotes("unavailable", "Market unavailable", "Market outcomes could not be verified.");
    }
    seen.add(row.marketId);
    const bookFresh = row.quoteStatus === "ok" && fresh(row.bookReceivedAt) && fresh(row.bookTimestamp);
    let bid = bookFresh ? marketDecimal(row.bestBidPrice, true) : null;
    let ask = bookFresh ? marketDecimal(row.bestAskPrice, true) : null;
    const crossed = crossedMarketBook(bid, ask);
    if (crossed) { bid = null; ask = null; }
    const last = fresh(row.lastTradeReceivedAt) ? marketDecimal(row.lastTradePrice, true) : null;
    markets.push({
      marketId: row.marketId, label: row.label, sortOrder: finite(row.sortOrder) ?? row.temperatureC,
      bidLabel: marketCents(bid), askLabel: marketCents(ask), lastLabel: marketCents(last),
      bidSize: bid === null ? null : marketDecimal(row.bestBidSize),
      askSize: ask === null ? null : marketDecimal(row.bestAskSize),
      bookReceivedAt: bid !== null || ask !== null ? row.bookReceivedAt : null,
      lastTradeReceivedAt: last === null ? null : row.lastTradeReceivedAt,
      quoteNote: crossed ? "Book unavailable" : bookFresh ? null : "Quote unavailable",
      hasPrice: bid !== null || ask !== null || last !== null,
    });
  }
  if (!markets.length || !markets.some((row) => row.hasPrice)) {
    return { ...withoutQuotes("no_data", "Market quotes unavailable", "No fresh prices are available."), polledAt };
  }
  markets.sort((a, b) => a.sortOrder - b.sortOrder || a.marketId.localeCompare(b.marketId));
  const partial = dashboard.status === "partial" || markets.some((row) => row.bidLabel === "—" || row.askLabel === "—" || row.lastLabel === "—");
  return { status: partial ? "partial" : "ok", label: partial ? "Some prices unavailable" : "Latest market prices",
    message: "YES prices in cents. Last trade is a retrieved price, not an execution timestamp.",
    polledAt, ...metadata, markets };
}
