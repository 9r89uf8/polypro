// Pure analog peak-time model for RKSI, shared by the library builder, the
// Convex issuer and offline evaluation. It reads only routine METARs at :00
// and :30 KST, the whole-degree reports the daily-high contract settles on.
export const ANALOG_PEAK_MODEL_VERSION = "rksi-analog-peak-v1";
export const ANALOG_PEAK_CHECKPOINTS = Object.freeze({ "09:00": 18, "12:00": 24 }); // KST half-hour slot
export const ANALOG_COUNT = 30;
export const ANALOG_WINDOW_DAYS = 15;
export const MIN_DAY_REPORTS = 44;
export const ANALOG_FEATURES = Object.freeze(["tempC", "change3hC", "dewpointDepressionC", "cloudAmount", "windU", "windV", "precip3h"]);

const KNOTS_PER_MPS = 1.943844;
const CLOUD_AMOUNT = { FEW: 1, SCT: 2, BKN: 3, OVC: 4 };
const PRECIP = /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)*(DZ|RA|SN|SG|IC|PL|GR|GS|UP)+$/;

function signedTemp(token) {
  if (!/^M?\d{2}$/.test(token ?? "")) return null;
  return token.startsWith("M") ? -Number(token.slice(1)) : Number(token);
}

/** Temperature, dew point, wind vector (knots), most-covered cloud amount and precipitation from a raw METAR. */
export function parseRoutineMetar(raw) {
  // Trend groups and remarks describe forecasts or extras, not the observation.
  const body = String(raw ?? "").split(/\s(?:NOSIG|BECMG|TEMPO|RMK)\b/)[0];
  const tokens = body.trim().split(/\s+/);
  const timeIndex = tokens.findIndex(token => /^\d{6}Z$/.test(token));
  if (timeIndex < 0) return null;
  const groups = tokens.slice(timeIndex + 1);
  let windU = null, windV = null, cloudAmount = 0, precip = false, tempC = null, dewpointC = null;
  for (const token of groups) {
    const wind = /^(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?(KT|MPS)$/.exec(token);
    if (wind) {
      const speed = Number(wind[2]) * (wind[3] === "MPS" ? KNOTS_PER_MPS : 1);
      // Variable wind has no direction, so it contributes no vector.
      const direction = wind[1] === "VRB" ? null : Number(wind[1]);
      windU = direction === null || speed === 0 ? 0 : -speed * Math.sin(direction * Math.PI / 180);
      windV = direction === null || speed === 0 ? 0 : -speed * Math.cos(direction * Math.PI / 180);
      continue;
    }
    const cloud = /^(FEW|SCT|BKN|OVC)\d{3}/.exec(token);
    if (cloud) cloudAmount = Math.max(cloudAmount, CLOUD_AMOUNT[cloud[1]]);
    else if (/^VV(\d{3}|\/\/\/)/.test(token)) cloudAmount = 4;
    if (PRECIP.test(token) || /^(\+|-)?TS/.test(token)) precip = true;
    const temperature = /^(M?\d{2})\/(M?\d{2})?$/.exec(token);
    if (temperature) {
      tempC = signedTemp(temperature[1]);
      dewpointC = signedTemp(temperature[2]);
    }
  }
  return tempC === null ? null : { tempC, dewpointC, windU, windV, cloudAmount, precip };
}

/** Features available at a checkpoint slot from that day's parsed reports (Map slot -> report), or null. */
export function checkpointFeatures(reportsBySlot, slot) {
  const now = reportsBySlot.get(slot), before = reportsBySlot.get(slot - 6);
  if (!now || !before || now.dewpointC === null || now.windU === null) return null;
  let precip3h = false, maxSoFarC = -Infinity;
  for (const [reportSlot, report] of reportsBySlot) {
    if (reportSlot <= slot) maxSoFarC = Math.max(maxSoFarC, report.tempC);
    if (reportSlot >= slot - 6 && reportSlot <= slot && report.precip) precip3h = true;
  }
  return {
    tempC: now.tempC,
    maxSoFarC,
    vector: [now.tempC, now.tempC - before.tempC, now.tempC - now.dewpointC, now.cloudAmount, now.windU, now.windV, precip3h ? 1 : 0],
  };
}

/** The day's whole-degree maximum and the first and last slots reaching it, given enough routine reports. */
export function daySummary(reportsBySlot) {
  if (reportsBySlot.size < MIN_DAY_REPORTS) return null;
  let maxC = -Infinity;
  for (const report of reportsBySlot.values()) maxC = Math.max(maxC, report.tempC);
  const peakSlots = [...reportsBySlot].filter(([, report]) => report.tempC === maxC).map(([slot]) => slot);
  return { maxC, peakFirstSlot: Math.min(...peakSlots), peakLastSlot: Math.max(...peakSlots), reportCount: reportsBySlot.size };
}

// Day of year in a non-leap reference year, so every date compares by calendar.
function calendarDay(date) {
  const [, month, day] = date.split("-").map(Number);
  const safeDay = month === 2 && day === 29 ? 28 : day;
  return Math.round((Date.UTC(2001, month - 1, safeDay) - Date.UTC(2001, 0, 1)) / 86_400_000) + 1;
}

function calendarDistance(a, b) {
  const difference = Math.abs(calendarDay(a) - calendarDay(b));
  return Math.min(difference, 365 - difference);
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q, low = Math.floor(position);
  return low + 1 < sorted.length ? sorted[low] + (position - low) * (sorted[low + 1] - sorted[low]) : sorted[low];
}

const median = values => quantile(values, 0.5);
const halfUp = value => Math.floor(value + 0.5 + 1e-9);

const absoluteDays = date => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * Library days within the seasonal window of a date. Evaluation passes
 * excludeWithinDays so the target's own season, including the days just
 * before and after it, cannot serve as its analogs.
 */
export function seasonalPool(library, date, { excludeWithinDays = null, checkpoint = null } = {}) {
  const pool = [];
  for (let index = 0; index < library.dates.length; index += 1) {
    const day = library.dates[index];
    if (excludeWithinDays !== null && Math.abs(absoluteDays(day) - absoluteDays(date)) < excludeWithinDays) continue;
    if (calendarDistance(day, date) > ANALOG_WINDOW_DAYS) continue;
    if (checkpoint && library.checkpoints[checkpoint].vectors[index] === null) continue;
    pool.push(index);
  }
  return pool;
}

function peakSummary(library, indexes, checkpointSlot = null) {
  const first = indexes.map(index => library.peakFirstSlot[index]);
  const last = indexes.map(index => library.peakLastSlot[index]);
  return {
    count: indexes.length,
    peakFirstMinutes: [0.1, 0.5, 0.9].map(q => quantile(first, q) * 30),
    peakLastMinutes: [0.1, 0.5, 0.9].map(q => quantile(last, q) * 30),
    ...(checkpointSlot === null ? {} : { peakAheadProbability: first.filter(slot => slot > checkpointSlot).length / first.length }),
  };
}

/** Seasonal peak timing for a date before any checkpoint is available. */
export function seasonalPeak(library, date) {
  const pool = seasonalPool(library, date);
  return pool.length ? { ...peakSummary(library, pool), medianMaxC: median(pool.map(index => library.maxC[index])) } : null;
}

/**
 * Analog forecast at a checkpoint: the nearest same-season library days by
 * standardized features, compared with the unconditioned seasonal pool.
 */
export function buildAnalogPeak({ library, date, checkpoint, features, excludeWithinDays = null }) {
  const slot = ANALOG_PEAK_CHECKPOINTS[checkpoint];
  if (slot === undefined) throw new Error("Unsupported analog checkpoint.");
  const pool = seasonalPool(library, date, { excludeWithinDays, checkpoint });
  if (pool.length < 100) return null;
  const vectors = pool.map(index => library.checkpoints[checkpoint].vectors[index]);
  const width = features.vector.length;
  const mean = Array.from({ length: width }, (_, k) => vectors.reduce((sum, vector) => sum + vector[k], 0) / vectors.length);
  const scale = mean.map((mu, k) => Math.sqrt(vectors.reduce((sum, vector) => sum + (vector[k] - mu) ** 2, 0) / vectors.length) || 1);
  const ranked = pool.map((index, position) => ({
    index,
    distance: Math.sqrt(vectors[position].reduce((sum, value, k) => sum + ((value - features.vector[k]) / scale[k]) ** 2, 0)),
  })).sort((a, b) => a.distance - b.distance || a.index - b.index);
  const analogs = ranked.slice(0, ANALOG_COUNT);
  // Predicted maximum: today's checkpoint temperature plus each day's remaining
  // rise, never below the maximum already reported today.
  const impliedMax = indexes => indexes.map(index => Math.max(features.tempC + library.maxC[index] - library.checkpoints[checkpoint].tempC[index], features.maxSoFarC));
  const analogIndexes = analogs.map(item => item.index);
  return {
    checkpoint,
    poolCount: pool.length,
    analog: { ...peakSummary(library, analogIndexes, slot), predictedMaxC: halfUp(median(impliedMax(analogIndexes))),
      predictedMaxRangeC: [0.1, 0.9].map(q => halfUp(quantile(impliedMax(analogIndexes), q))) },
    season: { ...peakSummary(library, pool, slot), predictedMaxC: halfUp(median(impliedMax(pool))) },
    analogs: analogs.slice(0, 5).map(({ index, distance }) => ({ date: library.dates[index], distance: Number(distance.toFixed(3)),
      maxC: library.maxC[index], peakFirstMinutes: library.peakFirstSlot[index] * 30, peakLastMinutes: library.peakLastSlot[index] * 30 })),
  };
}

/** Scores a forecast against the completed day; peak times in minutes after KST midnight. */
export function scoreAnalogPeak(forecast, outcome) {
  const slotMinutes = ANALOG_PEAK_CHECKPOINTS[forecast.checkpoint] * 30;
  const ahead = outcome.peakFirstSlot * 30 > slotMinutes;
  const score = summary => ({
    peakErrorMinutes: Math.abs(summary.peakFirstMinutes[1] - outcome.peakFirstSlot * 30),
    covered: summary.peakFirstMinutes[0] <= outcome.peakFirstSlot * 30 && outcome.peakFirstSlot * 30 <= summary.peakFirstMinutes[2],
    brierPeakAhead: (summary.peakAheadProbability - (ahead ? 1 : 0)) ** 2,
    maxErrorC: Math.abs(summary.predictedMaxC - outcome.maxC),
  });
  return { peakAhead: ahead, analog: score(forecast.analog), season: score(forecast.season) };
}
