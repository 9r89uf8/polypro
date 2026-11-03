import { formatSeoulDateTime, formatSeoulTime } from "./displayTime.js";

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
const FORECAST_STALE_MS = 360 * MINUTE;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const dateAt = (time) => new Date(time + 9 * 60 * MINUTE).toISOString().slice(0, 10);
const minuteAt = (time) => ((time + 9 * 60 * MINUTE) % DAY) / MINUTE;
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const gateLabels = {
  access_approval_required: "Market access approval required",
  retention_approval_required: "Market storage approval required",
  public_approval_required: "Market display approval required",
};

export function buildMarketHistory(dashboard, date, now) {
  const empty = (status, label, message) => ({
    status, label, message, series: [], eventUrl: null, latestAt: null, sampleCount: 0,
    samplingIntervalMinutes: 5, truncated: false,
  });
  if (dashboard === undefined || !finite(now)) return empty("loading", "Loading price history…", "Waiting for recorded market prices.");
  if (gateLabels[dashboard?.status]) return empty(dashboard.status, gateLabels[dashboard.status], "The chart will appear once market data is enabled.");
  if (dashboard?.configured !== true) return empty("disabled", "Market data unavailable", "Market collection is not enabled.");
  if (dashboard.stationIcao !== "RKSI" || dashboard.date !== date || dashboard.today !== dateAt(now) ||
      dashboard.source !== "polymarket_gamma_clob_rest" || dashboard.metric !== "yes_bid_ask_midpoint") {
    return empty("unavailable", "Price history unavailable", "Waiting for verified Seoul market history.");
  }
  if (date > dashboard.today) return empty("future", "Price history not available yet", "Recorded prices will appear as this day progresses.");
  if (dashboard.status === "unsupported_rules") return empty("unsupported_rules", "Market rules need review", "The contract could not be verified.");
  const event = dashboard.event;
  const [year, month, day] = date.split("-");
  const slug = "highest-temperature-in-seoul-on-" + months[Number(month) - 1] + "-" + Number(day) + "-" + year;
  if (!event || event.eventSlug !== slug || event.rulesVerified !== true) {
    return empty("no_data", "No price history recorded", "The chart starts with the first retained market snapshot. Earlier prices are not filled in.");
  }
  let eventUrl = null;
  try {
    const url = new URL(event.url);
    if (url.protocol === "https:" && url.hostname === "polymarket.com" && !url.username && !url.password &&
        url.pathname === "/event/" + slug) eventUrl = url.href;
  } catch { /* No unverified event links. */ }
  const seen = new Set();
  const series = [];
  for (const raw of Array.isArray(dashboard.series) ? dashboard.series : []) {
    if (typeof raw?.marketId !== "string" || !raw.marketId || seen.has(raw.marketId) ||
        typeof raw.label !== "string" || !raw.label.trim() || !finite(raw.temperatureC) ||
        !["below", "exact", "above"].includes(raw.bucketKind)) {
      return empty("unavailable", "Price history unavailable", "Recorded market outcomes could not be verified.");
    }
    seen.add(raw.marketId);
    const byTime = new Map();
    for (const row of Array.isArray(raw.points) ? raw.points : []) {
      if (!finite(row?.at) || row.at > now || dateAt(row.at) !== date) continue;
      const cents = row.quoteStatus === "ok" && finite(row.midpoint) && row.midpoint >= 0 && row.midpoint <= 1 ? row.midpoint * 100 : null;
      const previous = byTime.get(row.at);
      const value = previous && previous.cents !== cents ? null : cents;
      byTime.set(row.at, { time: row.at, minute: minuteAt(row.at), cents: value });
    }
    const points = [...byTime.values()].sort((a, b) => a.time - b.time);
    const available = points.filter((point) => point.cents !== null);
    series.push({
      marketId: raw.marketId, label: raw.label, temperatureC: raw.temperatureC,
      sortOrder: finite(raw.sortOrder) ? raw.sortOrder : raw.temperatureC,
      points, latest: available.at(-1) ?? null,
    });
  }
  series.sort((a, b) => a.sortOrder - b.sortOrder || a.marketId.localeCompare(b.marketId));
  const latestTimes = series.flatMap((item) => item.latest ? [item.latest.time] : []);
  if (!latestTimes.length) return { ...empty("no_data", "No usable price history yet", "Two-sided quotes are needed for midpoint prices. Missing quotes remain gaps."), eventUrl };
  const historical = date < dashboard.today;
  const latestAt = Math.max(...latestTimes);
  const delayed = !historical && (now - latestAt > 3 * MINUTE || ["error", "no_data"].includes(dashboard.collectorStatus));
  return {
    status: historical ? "historical" : delayed ? "delayed" : "ok",
    label: historical ? "Recorded market prices" : delayed ? "Latest quotes delayed · recorded history shown" : "Market prices through the day",
    message: "YES bid/ask midpoint in cents. Gaps mean no usable recorded quote.",
    series, eventUrl, latestAt, historical, truncated: dashboard.truncated === true,
    sampleCount: finite(dashboard.sampleCount) ? dashboard.sampleCount : 0,
    samplingIntervalMinutes: finite(dashboard.samplingIntervalMinutes) && dashboard.samplingIntervalMinutes > 0 ? dashboard.samplingIntervalMinutes : 5,
  };
}

const signedDegrees = (value) => `${value > 0 ? "+" : ""}${Number(value.toFixed(2))}°C`;

function airportNote(location) {
  if (!location) return "Airport location not confirmed yet.";
  const distance = finite(location.distanceKm) ? `${location.distanceKm} km from the RKSI reference point` : null;
  return `Airport confirmed: ${[location.name, location.icaoCode, distance].filter(Boolean).join(" · ")}.`;
}

function forecastProvider(raw, date, live, now) {
  const when = (time) => (dateAt(time) === date ? formatSeoulTime(time) : formatSeoulDateTime(time));
  const changes = [];
  for (const row of Array.isArray(raw?.changes) ? raw.changes : []) {
    if (!finite(row?.highC) || !finite(row.firstSeenAt) || !finite(row.lastSeenAt) || row.firstSeenAt > now) continue;
    const previous = changes.at(-1);
    if (previous?.highC === row.highC) { previous.lastSeenAt = Math.max(previous.lastSeenAt, row.lastSeenAt); continue; }
    const deltaC = previous ? Math.round((row.highC - previous.highC) * 1e6) / 1e6 : null;
    changes.push({
      highC: row.highC, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, deltaC, seenLabel: when(row.firstSeenAt),
      deltaLabel: previous ? signedDegrees(deltaC) : null, afterLabel: previous ? when(previous.lastSeenAt) : null,
    });
  }
  const latest = changes.at(-1) ?? null;
  const failed = raw?.status === "error", unverified = raw?.status === "location_unverified";
  const stale = Boolean(live && latest && now - latest.lastSeenAt > FORECAST_STALE_MS);
  const warning = !latest || !live ? null : unverified ? "airport not confirmed" : failed ? "last check failed" : stale ? "older forecast" : null;
  const empty = raw?.access === "approval_required" ? "Approval required" : raw?.access === "setup_required" ? "API key needed"
    : unverified ? "Airport location not confirmed" : failed ? "Check failed" : "No forecast captured for this date";
  const summary = !latest ? empty : changes.length > 1 ? `${latest.deltaLabel} at ${latest.seenLabel}` : `No change since ${latest.seenLabel}`;
  return {
    id: raw?.id, label: raw?.label, sourceUrl: raw?.sourceUrl, access: raw?.access, highC: latest?.highC ?? null, changes,
    attribution: latest ? raw?.attribution ?? null : null,
    note: warning ? `${summary} · ${warning}` : summary, warning: Boolean(warning), truncated: raw?.truncated === true,
    checkedLabel: finite(raw?.lastCheckAt) ? formatSeoulDateTime(raw.lastCheckAt) : null,
    airportNote: raw?.access === "approval_required" ? null : airportNote(raw?.location),
  };
}

/** The card's per-provider highs for one date, with each value's first and last sighting and when it changed. */
export function buildForecastProviders(dashboard, date, now) {
  const empty = (status, message) => ({ status, message, providers: [] });
  if (dashboard === undefined || !finite(now)) return empty("loading", "Checking forecast providers…");
  if (dashboard?.stationIcao !== "RKSI" || dashboard.date !== date || !Array.isArray(dashboard.providers)) return empty("unavailable", "Provider forecasts unavailable.");
  const live = date >= dateAt(now);
  return { status: "ok", message: "", providers: dashboard.providers.map((row) => forecastProvider(row, date, live, now)) };
}

export function priceSegments(points, maximumGapMinutes = 11) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (point.cents === null) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    if (current.length && (point.time - current.at(-1).time) / MINUTE > maximumGapMinutes) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}
