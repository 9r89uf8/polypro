// Pure helpers for the 9:00 AM KST provider forecast lock: the five providers,
// row normalizers for each source, the forecast high and peak hours, the
// observed hourly record and the scores. No Convex imports, so tests and
// scripts can load it directly.
import { metarSky } from "./seoulMetarSky.js";

export const PROVIDER_FORECAST_VERSION = "rksi-provider-lock-v1";
export const LOCK_HOUR = 9;
export const SCORED_HOURS = Array.from({ length: 24 - LOCK_HOUR }, (_, index) => LOCK_HOUR + index);
export const DAY_HOURS = Array.from({ length: 24 }, (_, index) => index);
export const KMA_APPROVAL_FLAG = "KMA_AMO_AIRPORT_FORECAST_ACCESS_APPROVED";
export const OPEN_METEO_APPROVAL_FLAG = "OPEN_METEO_FORECAST_ACCESS_APPROVED";
export const RKSI_POINT = { latitude: 37.4602, longitude: 126.4407 };
// A day's high is scored only when most routine reports after the lock exist.
export const MIN_AFTER_LOCK_REPORTS = 26;

const HOUR = 3_600_000, DAY = 24 * HOUR, KST_OFFSET = 9 * HOUR;
export const MAX_CAPTURE_AGE_MS = 6 * HOUR;

// Fixed order: colours, legend and tables follow it. archiveRunHourUtc is the
// previous-day run normally available at 00 UTC (09:00 KST), from Open-Meteo's
// model metadata; it is used only to rebuild past days from the run archive.
export const PROVIDERS = [
  { id: "kma", label: "KMA airport forecast", shortLabel: "KMA", kind: "capture", approvalFlag: KMA_APPROVAL_FLAG },
  { id: "weathercom", label: "Weather.com", shortLabel: "W.com", kind: "capture", approvalFlag: null },
  { id: "ecmwf", label: "ECMWF IFS", shortLabel: "ECMWF", kind: "open_meteo", model: "ecmwf_ifs", metaDomain: "ecmwf_ifs", archiveRunHourUtc: 12, approvalFlag: OPEN_METEO_APPROVAL_FLAG },
  { id: "gfs", label: "NOAA GFS", shortLabel: "GFS", kind: "open_meteo", model: "ncep_gfs_global", metaDomain: "ncep_gfs013", archiveRunHourUtc: 18, approvalFlag: OPEN_METEO_APPROVAL_FLAG },
  { id: "icon", label: "DWD ICON", shortLabel: "ICON", kind: "open_meteo", model: "dwd_icon_global", metaDomain: "dwd_icon", archiveRunHourUtc: 18, approvalFlag: OPEN_METEO_APPROVAL_FLAG },
];
export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);
export const OPEN_METEO_PROVIDERS = PROVIDERS.filter((provider) => provider.kind === "open_meteo");
export const providerById = (id) => PROVIDERS.find((provider) => provider.id === id) ?? null;
/** Only the exact string "true" approves; a provider without a flag is always available. */
export const isProviderApproved = (provider, env) => !provider.approvalFlag || env?.[provider.approvalFlag] === "true";

export const hourTime = (date, hour) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`);
export const lockTime = (date) => hourTime(date, LOCK_HOUR);
export const kstDate = (time) => new Date(time + KST_OFFSET).toISOString().slice(0, 10);
export const kstMinute = (time) => (((time + KST_OFFSET) % DAY) + DAY) % DAY / 60_000;
export const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export function isValidDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}
export function dateRange(startDate, endDate) {
  const dates = [];
  for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) dates.push(date);
  return dates;
}

export const tenth = (value) => Math.round(value * 10) / 10;
const hundredth = (value) => Math.round(value * 100) / 100;
/** Whole degrees, half up, the way a reading in tenths becomes a METAR value. */
export const roundHalfUp = (value) => Math.floor(tenth(value) + 0.5);
const percent = (value) => (Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : undefined);
const finite = (value) => (Number.isFinite(value) ? value : undefined);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : undefined);
const compact = (row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));

// The KST hour of `time` when it falls exactly on an hour of `date`.
function hourOf(date, time) {
  if (!Number.isFinite(time) || kstDate(time) !== date) return null;
  const offset = time - hourTime(date, 0);
  return offset % HOUR === 0 ? offset / HOUR : null;
}

function finishRows(rows) {
  const byHour = new Map();
  for (const row of rows) if (!byHour.has(row.hour)) byHour.set(row.hour, row);
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

/** KMA rows for the date from one capture. KMA gives sky categories only, never a cloud percentage. */
export function kmaLockRows(capture, date) {
  return finishRows((capture?.hourlyRows ?? []).flatMap((row) => {
    const hour = row?.date === date ? hourOf(date, row.forecastTimeUtc) : null;
    if (hour === null || !Number.isFinite(row.tempC)) return [];
    return [compact({ hour, time: row.forecastTimeUtc, tempC: row.tempC, sky: text(row.phrase), skyCode: text(row.conditionCode) })];
  }));
}

export function weathercomLockRows(capture, date) {
  return finishRows((capture?.weathercomHourlyRows ?? []).flatMap((row) => {
    const hour = row?.date === date ? hourOf(date, row.forecastTimeUtc) : null;
    if (hour === null || !Number.isFinite(row.tempC)) return [];
    return [compact({ hour, time: row.forecastTimeUtc, tempC: row.tempC, cloudCoverPct: percent(row.cloudCoverPct), sky: text(row.phrase) })];
  }));
}

const OPEN_METEO_FIELDS = {
  tempC: "temperature_2m", cloudCoverPct: "cloud_cover", cloudLowPct: "cloud_cover_low",
  cloudMidPct: "cloud_cover_mid", cloudHighPct: "cloud_cover_high",
};
export const OPEN_METEO_HOURLY = Object.values(OPEN_METEO_FIELDS).join(",");

/**
 * Rows for the date from a single-model Open-Meteo response requested with
 * timezone=Asia/Seoul and timeformat=unixtime. Values are instants at the hour.
 * A variable the model does not provide (unit "undefined") is left out, never zeroed.
 */
export function openMeteoLockRows(payload, date) {
  if (payload?.utc_offset_seconds !== 32_400) throw new Error("Open-Meteo response is not in Seoul time.");
  if (payload?.hourly_units?.time !== "unixtime") throw new Error("Open-Meteo response times are not Unix seconds.");
  const times = Array.isArray(payload.hourly?.time) ? payload.hourly.time : [];
  const issues = [];
  const series = Object.fromEntries(Object.entries(OPEN_METEO_FIELDS).map(([key, name]) => {
    const values = payload.hourly?.[name];
    const usable = Array.isArray(values) && values.length === times.length && payload.hourly_units?.[name] !== "undefined";
    if (!usable && key !== "tempC") issues.push(`${name} unavailable`);
    return [key, usable ? values : null];
  }));
  if (!series.tempC) throw new Error("Open-Meteo response has no temperature series.");
  const rows = finishRows(times.flatMap((seconds, index) => {
    const time = seconds * 1000, hour = hourOf(date, time), tempC = series.tempC[index];
    if (hour === null || !Number.isFinite(tempC)) return [];
    return [compact({
      hour, time, tempC: tenth(tempC), cloudCoverPct: percent(series.cloudCoverPct?.[index]), cloudLowPct: percent(series.cloudLowPct?.[index]),
      cloudMidPct: percent(series.cloudMidPct?.[index]), cloudHighPct: percent(series.cloudHighPct?.[index]),
    })];
  }));
  const grid = compact({ gridLatitude: finite(payload.latitude), gridLongitude: finite(payload.longitude), gridElevationM: finite(payload.elevation) });
  return { rows, issues, grid };
}

// Every hour after the lock. The lock hour itself is optional: KMA's table has
// already dropped 9 AM by its last capture before 9:00, which starts at 10 AM.
export const REQUIRED_HOURS = SCORED_HOURS.filter((hour) => hour > LOCK_HOUR);

/** ok when every hour from 10 AM to 11 PM is present; partial with some hour from 9 AM on; error with none. */
export function lockStatus(rows) {
  const hours = new Set(rows.map((row) => row.hour));
  if (REQUIRED_HOURS.every((hour) => hours.has(hour))) return "ok";
  return SCORED_HOURS.some((hour) => hours.has(hour)) ? "partial" : "error";
}

/** The highest hourly value from the lock hour on, and every hour that reaches it. */
export function forecastPeak(rows) {
  const window = (rows ?? []).filter((row) => row.hour >= LOCK_HOUR && Number.isFinite(row.tempC));
  if (!window.length) return null;
  const highC = Math.max(...window.map((row) => row.tempC));
  const hours = window.filter((row) => row.tempC === highC).map((row) => row.hour);
  return { highC, hours, firstHour: hours[0] };
}

/** Adjacent tied hours grouped into windows, e.g. [13, 14, 16] -> 13-14 and 16. */
export function peakWindows(hours) {
  const windows = [];
  for (const hour of [...(hours ?? [])].sort((a, b) => a - b)) {
    const previous = windows.at(-1);
    if (previous && hour === previous.endHour + 1) previous.endHour = hour;
    else windows.push({ startHour: hour, endHour: hour });
  }
  return windows;
}

/** The canonical 15L reading at one exact minute: one-minute rows first, then five-minute, then legacy. */
export function pickAmosRow(rows) {
  const rank = (row) => (row.collectionCadence === "one_minute" ? 2 : row.collectionCadence === "five_minute" ? 1 : 0);
  return (rows ?? []).filter((row) => row.rwyNo === "2" && row.rwyDir === "15L" && Number.isFinite(row.tempC))
    .sort((a, b) => rank(b) - rank(a) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
}

// Routine reports only, selected by their :00/:30 slot because the station file
// does not mark SPECIs reliably (the analog peak card uses the same rule).
function routineReports(rows, date) {
  const byTime = new Map();
  for (const row of rows ?? []) {
    if (row?.date !== date || row.reportType !== "METAR" || !Number.isFinite(row.tempC) || !Number.isFinite(row.obsTimeUtc)) continue;
    const minute = kstMinute(row.obsTimeUtc);
    if (minute % 30 || kstDate(row.obsTimeUtc) !== date) continue;
    byTime.set(row.obsTimeUtc, row);
  }
  return [...byTime.values()].sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
}

function highest(reports) {
  if (!reports.length) return null;
  const tempC = Math.max(...reports.map((row) => row.tempC));
  return { tempC, time: reports.find((row) => row.tempC === tempC).obsTimeUtc, reportCount: reports.length };
}

/**
 * The observed record for a KST date: the 15L reading and routine METAR at the
 * top of each hour, the METAR sky at that report, and the routine-METAR high
 * for the whole day and for the reports from the lock on.
 */
export function buildActuals({ date, amosByHour, metarRows }) {
  const routine = routineReports(metarRows, date);
  const lockAt = lockTime(date);
  const hourly = DAY_HOURS.map((hour) => {
    const time = hourTime(date, hour), amos = amosByHour?.[hour] ?? null;
    const report = routine.find((row) => row.obsTimeUtc === time) ?? null;
    return compact({
      hour, time, amosC: amos ? amos.tempC : undefined, amosCadence: amos?.collectionCadence ?? undefined,
      metarC: report ? report.tempC : undefined, sky: report ? metarSky(report.rawMetar) : undefined,
    });
  });
  const afterLock = routine.filter((row) => row.obsTimeUtc >= lockAt);
  return { date, hourly, officialHigh: highest(routine), highAfterLock: highest(afterLock), routineCount: routine.length, afterLockReportCount: afterLock.length };
}

/**
 * Hourly misses from the lock hour on against the 15L reading at the top of
 * each hour, plus the forecast high against the routine-METAR high from the
 * lock on. The high is compared in whole degrees, rounded half up; it counts
 * only for a lock with every hour from 10 AM to 11 PM, since missing hours may
 * hold the provider's peak, and is only final once the day is over.
 */
export function scoreLock(lock, actuals) {
  const observed = new Map((actuals?.hourly ?? []).map((row) => [row.hour, row]));
  const pairs = [];
  for (const row of lock?.hourly ?? []) {
    const actualC = observed.get(row.hour)?.amosC;
    if (row.hour < LOCK_HOUR || !Number.isFinite(actualC) || !Number.isFinite(row.tempC)) continue;
    pairs.push({ hour: row.hour, forecastC: row.tempC, actualC, errorC: tenth(row.tempC - actualC) });
  }
  const sumAbs = pairs.reduce((total, pair) => total + Math.abs(pair.forecastC - pair.actualC), 0);
  const sum = pairs.reduce((total, pair) => total + (pair.forecastC - pair.actualC), 0);
  const peak = forecastPeak(lock?.hourly);
  const roundedC = peak ? roundHalfUp(peak.highC) : null;
  const high = actuals?.highAfterLock ?? null;
  const highComplete = lockStatus(lock?.hourly ?? []) === "ok" && Boolean(high) && (actuals.afterLockReportCount ?? 0) >= MIN_AFTER_LOCK_REPORTS;
  return {
    hoursScored: pairs.length, sumAbsErrorC: hundredth(sumAbs), sumErrorC: hundredth(sum),
    maeC: pairs.length ? hundredth(sumAbs / pairs.length) : null, biasC: pairs.length ? hundredth(sum / pairs.length) : null,
    latest: pairs.at(-1) ?? null, pairs,
    forecastHighC: peak?.highC ?? null, forecastHighRoundedC: roundedC, forecastPeakHours: peak?.hours ?? [],
    actualHighC: high?.tempC ?? null, actualHighTime: high?.time ?? null, highComplete,
    highErrorC: roundedC !== null && high ? roundedC - high.tempC : null,
    peakErrorMinutes: peak && high ? peak.firstHour * 60 - kstMinute(high.time) : null,
  };
}

/** Per-provider totals over stored day scores; days without a complete high still count their hours. */
export function summarizeScores(scores) {
  return PROVIDER_IDS.map((provider) => {
    const rows = (scores ?? []).filter((row) => row.provider === provider && row.status === "scored");
    const highs = rows.filter((row) => row.highComplete && Number.isFinite(row.highErrorC));
    const peaks = highs.filter((row) => Number.isFinite(row.peakErrorMinutes));
    const hours = rows.reduce((total, row) => total + (row.hoursScored ?? 0), 0);
    const mean = (list, pick) => (list.length ? hundredth(list.reduce((total, row) => total + pick(row), 0) / list.length) : null);
    return {
      provider, days: rows.length, rebuiltDays: rows.filter((row) => row.method === "single_run_archive").length,
      highDays: highs.length, exactHighDays: highs.filter((row) => row.highErrorC === 0).length,
      withinOneDays: highs.filter((row) => Math.abs(row.highErrorC) <= 1).length,
      meanAbsHighErrorC: mean(highs, (row) => Math.abs(row.highErrorC)), meanHighErrorC: mean(highs, (row) => row.highErrorC),
      meanAbsPeakErrorMinutes: mean(peaks, (row) => Math.abs(row.peakErrorMinutes)),
      hours, hourlyMaeC: hours ? hundredth(rows.reduce((total, row) => total + (row.sumAbsErrorC ?? 0), 0) / hours) : null,
      hourlyBiasC: hours ? hundredth(rows.reduce((total, row) => total + (row.sumErrorC ?? 0), 0) / hours) : null,
    };
  });
}
