import { formatDayMinute, formatSeoulTime } from "./displayTime.js";

const MINUTE = 60_000, HOUR = 60 * MINUTE;
export const LOCK_HOUR = 9;
// Scheduled lock attempts run from 9:00 to 9:15 AM KST.
const LOCK_WINDOW = 20 * MINUTE;
export const PROVIDER_ORDER = ["kma", "weathercom", "ecmwf", "gfs", "icon"];
// Fixed categorical slots (validated for neighbouring legend entries on the
// dark card); dash patterns are the second channel where lines cross.
export const PROVIDER_STYLE = {
  kma: { color: "#3987e5", dash: "", label: "KMA airport forecast", shortLabel: "KMA" },
  weathercom: { color: "#d95926", dash: "5 6", label: "Weather.com", shortLabel: "W.com" },
  ecmwf: { color: "#199e70", dash: "0.1 5", label: "ECMWF IFS", shortLabel: "ECMWF" },
  gfs: { color: "#c98500", dash: "9 5 0.1 5", label: "NOAA GFS", shortLabel: "GFS" },
  icon: { color: "#d55181", dash: "16 6", label: "DWD ICON", shortLabel: "ICON" },
};
// Cloud cover, 0 to 100 %, one hue from just above the surface to light.
export const CLOUD_RAMP = ["#34506e", "#47698b", "#5e84a8", "#82a9c9", "#b6d9ef"];

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const percent = (value) => (number(value) !== null && value >= 0 && value <= 100 ? value : null);
const words = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const seoulDate = (time) => new Date(time + 9 * HOUR).toISOString().slice(0, 10);
const hourTime = (date, hour) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`);

export function formatTemperature(value, digits = 1) {
  return number(value) === null ? "—" : `${value.toFixed(digits)}°`;
}
/** Signed with a true minus, e.g. +0.4° or −1.2°. */
export function formatSigned(value, digits = 1) {
  if (number(value) === null) return "—";
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toFixed(digits)}°`;
}
export function formatHour(hour, compact = false) {
  return Number.isInteger(hour) ? formatDayMinute(hour * 60, { compact }) : "—";
}
/** Peak hours as windows of adjacent hours: [13, 14, 16] -> "1–2 PM · 4 PM". */
export function formatPeakHours(hours) {
  const windows = [];
  for (const hour of [...(hours ?? [])].filter(Number.isInteger).sort((a, b) => a - b)) {
    const previous = windows.at(-1);
    if (previous && hour === previous[1] + 1) previous[1] = hour; else windows.push([hour, hour]);
  }
  if (!windows.length) return "—";
  return windows.map(([start, end]) => {
    if (start === end) return formatHour(start, true);
    const [first, last] = [formatHour(start, true), formatHour(end, true)];
    return first.slice(-2) === last.slice(-2) ? `${first.slice(0, -3)}–${last}` : `${first}–${last}`;
  }).join(" · ");
}
export function formatRun(time) {
  if (number(time) === null) return "—";
  const date = new Date(time);
  return `${String(date.getUTCHours()).padStart(2, "0")}Z ${date.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}
export function cloudColor(value) {
  if (percent(value) === null) return null;
  const position = (value / 100) * (CLOUD_RAMP.length - 1), index = Math.min(CLOUD_RAMP.length - 2, Math.floor(position));
  const mix = (from, to, share) => Math.round(from + (to - from) * share);
  const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const [a, b] = [rgb(CLOUD_RAMP[index]), rgb(CLOUD_RAMP[index + 1])];
  return `#${a.map((channel, i) => mix(channel, b[i], position - index).toString(16).padStart(2, "0")).join("")}`;
}
/** METAR eighths as a percent range, e.g. 5–8/8 -> 63–100 %. */
export function skyPercentRange(sky) {
  if (number(sky?.minOktas) === null || number(sky?.maxOktas) === null) return null;
  return [Math.round(sky.minOktas * 12.5), Math.round(sky.maxOktas * 12.5)];
}

function hourly(raw, date) {
  const byHour = new Map();
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!Number.isInteger(row?.hour) || row.hour < 0 || row.hour > 23 || number(row.tempC) === null || row.time !== hourTime(date, row.hour) || byHour.has(row.hour)) continue;
    byHour.set(row.hour, {
      hour: row.hour, minute: row.hour * 60, time: row.time, tempC: row.tempC, cloudCoverPct: percent(row.cloudCoverPct),
      cloudLowPct: percent(row.cloudLowPct), cloudMidPct: percent(row.cloudMidPct), cloudHighPct: percent(row.cloudHighPct), sky: words(row.sky),
    });
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

function sourceLabel(lock) {
  if (lock.method === "stored_capture") return number(lock.capturedAt) !== null ? `${formatSeoulTime(lock.capturedAt)} capture` : "Stored capture";
  if (lock.method === "single_run_archive") return number(lock.runInitAt) !== null ? `Rebuilt · ${formatRun(lock.runInitAt)} run` : "Rebuilt from archive";
  return number(lock.runInitAt) !== null ? `${formatRun(lock.runInitAt)} run` : "Run time unknown";
}

function score(raw, isArchived) {
  if (!raw || !Number.isInteger(raw.hoursScored)) return null;
  const final = isArchived && raw.highComplete === true;
  return {
    hoursScored: raw.hoursScored, maeC: number(raw.maeC), biasC: number(raw.biasC),
    latestHour: Number.isInteger(raw.latest?.hour) ? raw.latest.hour : null, latestErrorC: number(raw.latest?.errorC),
    final, highErrorC: final ? number(raw.highErrorC) : null, peakErrorMinutes: final ? number(raw.peakErrorMinutes) : null,
  };
}

function provider(raw, id, date, isArchived) {
  const style = PROVIDER_STYLE[id];
  const base = { id, label: words(raw?.label) ?? style.label, shortLabel: words(raw?.shortLabel) ?? style.shortLabel, color: style.color, dash: style.dash,
    hourly: [], peak: null, score: null, method: null, sourceLabel: "", issues: [] };
  if (!raw) return { ...base, status: "missing", statusLabel: "No data", shortStatus: "no data" };
  if (raw.access === "approval_required") return { ...base, status: "approval_required", statusLabel: "Approval required", shortStatus: "approval required" };
  const lock = raw.lock;
  if (!lock || lock.date !== date || lock.provider !== id) return { ...base, status: "missing", statusLabel: "No 9 AM forecast stored", shortStatus: "no 9 AM lock" };
  // KMA and Weather.com locks make no request: their only failure is a missing capture.
  const fromCapture = lock.method === "stored_capture";
  if (lock.status === "error") {
    return { ...base, status: "error", method: lock.method, statusLabel: words(lock.error) ?? (fromCapture ? "No capture finished by 9:00 AM" : "The 9 AM request failed"),
      shortStatus: fromCapture ? "no capture by 9 AM" : "not locked" };
  }
  const rows = hourly(lock.hourly, date);
  if (!rows.length) return { ...base, status: "error", method: lock.method, statusLabel: "The stored forecast has no usable hours", shortStatus: "no usable hours" };
  const window = rows.filter((row) => row.hour >= LOCK_HOUR);
  const highC = window.length ? Math.max(...window.map((row) => row.tempC)) : null;
  const peakHours = highC === null ? [] : window.filter((row) => row.tempC === highC).map((row) => row.hour);
  return {
    ...base, status: lock.status === "partial" ? "partial" : "locked", statusLabel: lock.status === "partial" ? "Some hours missing" : "Locked",
    method: lock.method, sourceLabel: sourceLabel(lock), hourly: rows, runCheck: lock.runCheck ?? null,
    peak: highC === null ? null : { highC, roundedC: Math.floor(Math.round(highC * 10) / 10 + 0.5), hours: peakHours, label: formatPeakHours(peakHours) },
    score: score(raw.score, isArchived), issues: Array.isArray(lock.issues) ? lock.issues.filter((item) => typeof item === "string") : [],
  };
}

function actuals(raw, date) {
  const rows = new Map((Array.isArray(raw?.hourly) ? raw.hourly : []).filter((row) => Number.isInteger(row?.hour) && row.time === hourTime(date, row.hour))
    .map((row) => [row.hour, row]));
  const high = (value) => (number(value?.tempC) !== null && number(value?.time) !== null && seoulDate(value.time) === date
    ? { tempC: value.tempC, time: value.time, minute: ((value.time + 9 * HOUR) % (24 * HOUR)) / MINUTE } : null);
  return {
    hourly: Array.from({ length: 24 }, (_, hour) => {
      const row = rows.get(hour);
      const sky = row?.sky && typeof row.sky === "object" ? { code: words(row.sky.code) ?? "", label: words(row.sky.label) ?? "Cloud cover not reported",
        minOktas: number(row.sky.minOktas), maxOktas: number(row.sky.maxOktas) } : null;
      return { hour, minute: hour * 60, amosC: number(row?.amosC), metarC: number(row?.metarC), sky };
    }),
    officialHigh: high(raw?.officialHigh), highAfterLock: high(raw?.highAfterLock),
  };
}

function summary(raw) {
  return PROVIDER_ORDER.map((id) => {
    const row = (Array.isArray(raw) ? raw : []).find((item) => item?.provider === id) ?? {};
    const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
    return {
      id, ...PROVIDER_STYLE[id], days: count(row.days), rebuiltDays: count(row.rebuiltDays), highDays: count(row.highDays), exactHighDays: count(row.exactHighDays),
      withinOneDays: count(row.withinOneDays), meanAbsHighErrorC: number(row.meanAbsHighErrorC), meanHighErrorC: number(row.meanHighErrorC),
      meanAbsPeakErrorMinutes: number(row.meanAbsPeakErrorMinutes), hours: count(row.hours), hourlyMaeC: number(row.hourlyMaeC), hourlyBiasC: number(row.hourlyBiasC),
    };
  });
}

/**
 * Display state for the 9 AM provider lock. Never shows a forecast for another
 * station or date, or one not yet locked. `tone` picks the badge colour.
 */
export function buildProviderForecastState(data, date, now) {
  const base = { kind: "loading", label: "Loading", tone: "", detail: "Loading the 9 AM forecasts…", providers: [], actuals: actuals(null, date), leaders: [], highHits: [],
    noLock: false, summary: summary(null), summaryDayCount: 0, isToday: false, isArchived: false, lockMinute: LOCK_HOUR * 60, date };
  if (!(number(now) > 0)) return base;
  const today = seoulDate(now), isToday = date === today, isArchived = date < today;
  if (date > today) return { ...base, kind: "future", label: "Future date", detail: "Forecasts for this date are locked at 9:00 AM KST on the day." };
  if (data === undefined) return { ...base, isToday, isArchived };
  if (data?.stationIcao !== "RKSI" || data?.date !== date) {
    return { ...base, isToday, isArchived, kind: "unavailable", label: "Unavailable", tone: "delayed", detail: "No RKSI forecast lock is available for this date." };
  }
  const providers = PROVIDER_ORDER.map((id) => provider((Array.isArray(data.providers) ? data.providers : []).find((row) => row?.id === id), id, date, isArchived));
  const result = { ...base, isToday, isArchived, providers, actuals: actuals(data.actuals, date), summary: summary(data.summary),
    summaryDayCount: Number.isInteger(data.summaryDayCount) ? data.summaryDayCount : 0,
    summaryStartDate: typeof data.summaryStartDate === "string" ? data.summaryStartDate : null, version: typeof data.version === "string" ? data.version : null };
  const locked = providers.filter((row) => row.status === "locked" || row.status === "partial");
  if (isToday && now < hourTime(date, LOCK_HOUR) && !locked.length) {
    return { ...result, providers: providers.map((row) => (row.status === "approval_required" ? row : { ...row, status: "waiting", statusLabel: "Locks at 9:00 AM", shortStatus: "locks at 9 AM" })),
      kind: "waiting", label: "Waiting for 9:00 AM", detail: "Each provider’s forecast is locked at 9:00 AM KST, then checked against the 15L sensor every hour." };
  }
  const scored = locked.filter((row) => row.score?.hoursScored >= 2 && row.score.maeC !== null);
  const best = scored.length ? Math.min(...scored.map((row) => row.score.maeC)) : null;
  const leaders = best === null ? [] : scored.filter((row) => row.score.maeC - best < 0.005).map((row) => row.id);
  const highHits = locked.filter((row) => row.score?.final && row.score.highErrorC === 0).map((row) => row.id);
  if (!locked.length && isArchived) return { ...result, kind: "archived", label: "Archived", leaders, highHits, noLock: true, detail: "No 9 AM forecast was stored for this date." };
  if (!locked.length) {
    // Still locking while an attempt can succeed: a provider without a record, or a model whose request can be retried.
    const retryable = providers.some((row) => row.status === "missing" || (row.status === "error" && row.method && row.method !== "stored_capture"));
    const attempting = retryable && now - hourTime(date, LOCK_HOUR) < LOCK_WINDOW;
    return { ...result, kind: "locked", label: attempting ? "Locking" : "No lock", tone: attempting ? "" : "delayed", leaders, highHits, noLock: true,
      detail: attempting ? "No forecast is locked yet; scheduled attempts run from 9:00 to 9:15 AM KST." : "No forecast was locked at 9:00 AM today." };
  }
  return { ...result, kind: isArchived ? "archived" : "locked", label: isArchived ? "Archived" : "Locked 9:00 AM", tone: isArchived ? "" : "fresh", leaders, highHits, detail: "" };
}
