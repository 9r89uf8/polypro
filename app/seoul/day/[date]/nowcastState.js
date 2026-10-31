import { formatSeoulTime } from "./displayTime.js";

export const NOWCAST_FRESHNESS_MS = 2 * 60_000;
export const NOWCAST_HORIZONS = [10, 15, 20];
// Fixed KST issue-time windows, matching the backend's score breakdown.
export const NOWCAST_TIME_OF_DAY = [
  { key: "overnight", label: "Overnight · 12–6 AM" },
  { key: "morning", label: "Morning · 6–10 AM" },
  { key: "midday", label: "Midday · 10 AM–2 PM" },
  { key: "afternoon", label: "Afternoon · 2–6 PM" },
  { key: "evening", label: "Evening · 6 PM–12 AM" },
];
const MINUTE = 60_000;
const DAY = 86_400_000;
const QUALITY_STATUSES = new Set(["ready", "persistence_only", "unavailable"]);

function validTime(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime());
}

function seoulDate(time) {
  return validTime(time) ? new Date(time + 9 * 60 * MINUTE).toISOString().slice(0, 10) : "";
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function nonnegative(value) {
  return number(value) !== null && value >= 0 ? value : null;
}

export function formatNowcastTemperature(value) {
  return number(value) === null ? "—" : `${Number(value.toFixed(1)).toFixed(1)}°C`;
}

export function formatNowcastError(value) {
  return number(value) === null ? "—" : `${Number(value.toFixed(2)).toFixed(2)}°C`;
}

// Relative error of a test against no change on the same cases; negative is better.
export function formatNowcastChange(testMaeC, baselineMaeC) {
  if (number(testMaeC) === null || number(baselineMaeC) === null || baselineMaeC <= 0) return "—";
  const percent = Math.round(100 * (testMaeC / baselineMaeC - 1));
  return `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${Math.abs(percent)}%`;
}

export function formatNowcastTime(time, date, { seconds = false } = {}) {
  if (!validTime(time)) return "—";
  const day = seoulDate(time);
  return `${formatSeoulTime(time, { seconds })} KST${day !== date ? ` · ${day}` : ""}`;
}

export function formatNowcastAge(time, now) {
  if (!validTime(time) || !validTime(now) || time > now) return "Age unavailable";
  const seconds = Math.floor((now - time) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""} ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function prediction(raw, horizonMinutes, issue, qualityStatus, now) {
  const targetTimeUtc = validTime(raw?.targetTimeUtc) && raw.targetTimeUtc > issue.issuedAt
    && raw.targetTimeUtc - issue.issuedAt < DAY ? raw.targetTimeUtc : null;
  const persistenceC = targetTimeUtc ? number(raw?.persistenceC) : null;
  const dampedTrendC = targetTimeUtc && qualityStatus === "ready" ? number(raw?.dampedTrendC) : null;
  // The drift test needs only the latest reading, so it survives a missing trend.
  const driftC = targetTimeUtc ? number(raw?.climatologyDriftC) : null;
  // No change is the headline. The damped trend lost to it in a replay of
  // stored minutes, so it remains a separately labeled test value.
  const estimateC = persistenceC;
  const method = persistenceC !== null ? "persistence" : null;
  const hasActual = raw?.status === "scored" && targetTimeUtc && targetTimeUtc <= now
    && number(raw.actualC) !== null && validTime(raw.scoredAt) && raw.scoredAt <= now && raw.scoredAt >= targetTimeUtc;
  return {
    horizonMinutes,
    targetTimeUtc,
    actualLeadMinutes: targetTimeUtc ? (targetTimeUtc - issue.issuedAt) / MINUTE : null,
    observationLeadMinutes: targetTimeUtc ? (targetTimeUtc - issue.latestObservationTimeUtc) / MINUTE : null,
    persistenceC,
    dampedTrendC,
    driftC,
    estimateC,
    method,
    status: hasActual ? "scored" : raw?.status === "missing" && targetTimeUtc !== null && targetTimeUtc <= now ? "missing" : "pending",
    actualC: hasActual ? raw.actualC : null,
    scoredAt: hasActual ? raw.scoredAt : null,
  };
}

function normalizeIssue(row, date, now) {
  if (!row || !validTime(row.issuedAt) || row.issuedAt > now || seoulDate(row.issuedAt) !== date) return null;
  const latestObservationTimeUtc = validTime(row.latestObservationTimeUtc) && row.latestObservationTimeUtc <= row.issuedAt
    ? row.latestObservationTimeUtc : null;
  const qualityStatus = latestObservationTimeUtc && QUALITY_STATUSES.has(row.qualityStatus) ? row.qualityStatus : "unavailable";
  const rawPredictions = Array.isArray(row.predictions) ? row.predictions : [];
  const predictions = qualityStatus === "unavailable" ? [] : NOWCAST_HORIZONS.map(horizon => {
    const matching = rawPredictions.filter(item => item?.horizonMinutes === horizon);
    // Conflicting duplicate horizons cannot safely become a single estimate.
    return prediction(matching.length === 1 ? matching[0] : null, horizon, row, qualityStatus, now);
  });
  return {
    issuedAt: row.issuedAt,
    latestObservationTimeUtc,
    modelVersion: typeof row.modelVersion === "string" ? row.modelVersion : "",
    driftModelVersion: typeof row.driftModelVersion === "string" ? row.driftModelVersion : "",
    qualityStatus,
    qualityReason: typeof row.qualityReason === "string" ? row.qualityReason : "",
    predictions,
  };
}

const TREND_FIELDS = { pairs: "pairedCount", days: "dayCount", baseline: "pairedPersistenceMaeC", test: "dampedMaeC" };
const DRIFT_FIELDS = { pairs: "driftPairedCount", days: "driftDayCount", baseline: "driftPairedPersistenceMaeC", test: "driftMaeC" };

// A test is compared with no change only when its case and day counts and both
// errors are valid; anything else becomes an explicit empty comparison.
function comparison(raw, scoredCount, fields) {
  const pairs = count(raw?.[fields.pairs]) ?? 0;
  const days = count(raw?.[fields.days]) ?? 0;
  const valid = pairs > 0 && pairs <= scoredCount && days > 0;
  const baseline = valid ? nonnegative(raw?.[fields.baseline]) : null;
  const test = valid ? nonnegative(raw?.[fields.test]) : null;
  const ok = baseline !== null && test !== null;
  return { [fields.pairs]: ok ? pairs : 0, [fields.days]: ok ? days : 0,
    [fields.baseline]: ok ? baseline : null, [fields.test]: ok ? test : null };
}

function normalizeMetrics(rows) {
  return NOWCAST_HORIZONS.map(horizonMinutes => {
    const raw = Array.isArray(rows) ? rows.find(item => item?.horizonMinutes === horizonMinutes) : null;
    const scoredCount = count(raw?.scoredCount) ?? 0;
    return {
      horizonMinutes,
      scoredCount,
      scoredDayCount: scoredCount > 0 ? count(raw?.scoredDayCount) ?? 0 : 0,
      persistenceMaeC: scoredCount > 0 ? nonnegative(raw?.persistenceMaeC) : null,
      ...comparison(raw, scoredCount, TREND_FIELDS),
      ...comparison(raw, scoredCount, DRIFT_FIELDS),
      pendingCount: count(raw?.pendingCount),
      missingCount: count(raw?.missingCount),
    };
  });
}

function normalizeTimeOfDay(rows) {
  return NOWCAST_TIME_OF_DAY.flatMap(({ key, label }) => NOWCAST_HORIZONS.map(horizonMinutes => {
    const matching = Array.isArray(rows) ? rows.filter(item => item?.window === key && item?.horizonMinutes === horizonMinutes) : [];
    // Conflicting duplicate rows cannot safely become a single comparison.
    const raw = matching.length === 1 ? matching[0] : null;
    const scoredCount = count(raw?.scoredCount) ?? 0;
    return { key, label, horizonMinutes, ...comparison(raw, scoredCount, TREND_FIELDS), ...comparison(raw, scoredCount, DRIFT_FIELDS) };
  }));
}

// The page clock ticks every 15 seconds, so a forecast issued since the last
// tick, or stamped by a slightly fast server clock, would otherwise read as
// future and blank the card until the next tick. Larger gaps stay rejected.
const CLOCK_TOLERANCE_MS = 30_000;

/** Display saved forecasts without recomputing or refreshing their issuance time. */
export function buildNowcastState(data, date, pageNow) {
  const base = { kind: "loading", label: "Loading", detail: "Loading saved nowcasts…", isLive: false,
    isArchived: false, latest: null, predictions: [], recent: [], recentResolved: false, metrics: [],
    timeOfDay: [], timeOfDayExcludedDays: 0, clock: pageNow, date };
  if (!validTime(pageNow)) return base;
  const latestIssuedAt = data?.latest?.issuedAt;
  const now = validTime(latestIssuedAt) && latestIssuedAt > pageNow && latestIssuedAt - pageNow <= CLOCK_TOLERANCE_MS
    ? latestIssuedAt : pageNow;
  const today = seoulDate(now);
  if (date > today) return { ...base, kind: "future", label: "Future date", detail: "Nowcasts appear as observations arrive on this date." };
  if (data === undefined) return base;
  if (data?.stationIcao !== "RKSI" || data?.date !== date) {
    return { ...base, kind: "unavailable", label: "Unavailable", detail: "No RKSI nowcast is available for this date." };
  }
  const isArchived = date < today;
  const metrics = normalizeMetrics(data.metrics);
  const latest = normalizeIssue(data.latest, date, now);
  const resolved = (Array.isArray(data.recentResolved) ? data.recentResolved : [])
    .map(row => normalizeIssue(row, date, now)).filter(row => row?.predictions.some(item => item.status === "scored"));
  const recentInput = resolved.length ? resolved : (Array.isArray(data.recent) ? data.recent : []).map(row => normalizeIssue(row, date, now));
  const seen = new Set();
  const recent = recentInput
    .filter(Boolean).sort((a, b) => b.issuedAt - a.issuedAt)
    .filter(row => {
      if (seen.has(row.issuedAt) || !row.predictions.some(item => item.estimateC !== null)) return false;
      seen.add(row.issuedAt);
      return true;
    }).slice(0, 4);
  const metricsStartDate = /^\d{4}-\d{2}-\d{2}$/.test(data.metricsStartDate) && data.metricsStartDate <= date ? data.metricsStartDate : date;
  const metricsWindowDays = Number.isInteger(data.metricsWindowDays) && data.metricsWindowDays > 0 ? data.metricsWindowDays : 1;
  const result = { ...base, isArchived, latest, metrics, recent, recentResolved: recent.some(row => row.predictions.some(item => item.status === "scored")),
    predictions: latest?.predictions ?? [], metricsStartDate, metricsWindowDays, clock: now,
    timeOfDay: normalizeTimeOfDay(data.timeOfDayMetrics), timeOfDayExcludedDays: count(data.timeOfDayExcludedDayCount) ?? 0 };
  if (!latest) return { ...result, kind: "empty", label: isArchived ? "Archived" : "Waiting for readings",
    detail: isArchived ? "No saved nowcasts were issued on this date." : "Waiting for a saved forecast from a recent 15L reading." };
  const hasEstimate = latest.predictions.some(item => item.estimateC !== null);
  if (isArchived) return { ...result, kind: "archived", label: "Archived",
    detail: hasEstimate ? "Last forecast issued on this date. These are saved estimates, not current conditions."
      : latest.qualityReason || "No usable forecast was available at the last check on this date." };
  if (latest.qualityStatus === "unavailable" || !hasEstimate) return { ...result, kind: "unavailable", label: "Unavailable",
    detail: latest.qualityReason || "The latest check could not produce a usable forecast." };
  if (now - latest.issuedAt > NOWCAST_FRESHNESS_MS || now - latest.latestObservationTimeUtc > NOWCAST_FRESHNESS_MS) {
    return { ...result, kind: "stale", label: "Updates delayed",
      detail: "The reading or forecast is more than 2 minutes old. Showing saved estimates until a fresh forecast arrives." };
  }
  if (latest.qualityStatus === "persistence_only" || latest.predictions.every(item => item.dampedTrendC === null)) {
    return { ...result, kind: "persistence_only", label: "Fresh", isLive: true,
      detail: `Trend test unavailable. ${latest.qualityReason || "There is not enough usable recent history for a trend."}` };
  }
  return { ...result, kind: "ready", label: "Fresh", detail: "", isLive: true };
}
