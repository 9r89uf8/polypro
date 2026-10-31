const MINUTE = 60_000;
const CHECKPOINTS = ["09:00", "12:00"];
const CLOUD = ["clear", "few clouds", "scattered clouds", "broken clouds", "overcast"];
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function triple(values, low = 0, high = 1440) {
  return Array.isArray(values) && values.length === 3 && values.every(value => number(value) !== null && value >= low && value <= high)
    && values[0] <= values[1] && values[1] <= values[2] ? values : null;
}

function probability(value) {
  return number(value) !== null && value >= 0 && value <= 1 ? value : null;
}

function seoulDate(time) {
  return new Date(time + 9 * 60 * MINUTE).toISOString().slice(0, 10);
}

/** KST minutes after midnight, rounded to the half hour the routine reports use. */
export function formatPeakTime(minutes) {
  if (number(minutes) === null) return "—";
  const rounded = Math.round(minutes / 30) * 30 % 1440;
  const hour = Math.floor(rounded / 60), minute = rounded % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatPeakRange(values) {
  return values ? `${formatPeakTime(values[0])}–${formatPeakTime(values[2])}` : "—";
}

export function formatPercent(value) {
  return probability(value) === null ? "—" : `${Math.round(value * 100)}%`;
}

export function formatCheckpoint(checkpoint) {
  return checkpoint === "09:00" ? "9:00 AM" : checkpoint === "12:00" ? "12:00 PM" : checkpoint;
}

/** The checkpoint's matched conditions in words, from the stored feature vector. */
export function describeConditions(features, checkpoint) {
  const vector = features?.vector;
  if (!Array.isArray(vector) || vector.length !== 7 || !vector.every(value => number(value) !== null)) return "";
  const [tempC, change, spread, cloud, u, v, precip] = vector;
  const speed = Math.hypot(u, v);
  const from = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
  const wind = speed < 0.5 ? "calm or variable wind" : `wind from the ${COMPASS[Math.round(from / 45) % 8]} at ${Math.round(speed)} kt`;
  const signed = change > 0 ? `+${change}` : `${change}`;
  return `${formatCheckpoint(checkpoint)}: ${tempC}°C, ${signed}°C over 3 hours, dew-point spread ${spread}°C, ${CLOUD[cloud] ?? "unknown cloud"}, ${wind}, ${precip ? "precipitation in the past 3 hours" : "no precipitation"}`;
}

function peakSummary(raw) {
  if (!raw) return null;
  const peakFirstMinutes = triple(raw.peakFirstMinutes), peakLastMinutes = triple(raw.peakLastMinutes);
  if (!peakFirstMinutes || !Number.isInteger(raw.count) || raw.count <= 0) return null;
  const range = Array.isArray(raw.predictedMaxRangeC) && raw.predictedMaxRangeC.length === 2 && raw.predictedMaxRangeC.every(value => number(value) !== null)
    ? raw.predictedMaxRangeC : null;
  return { count: raw.count, peakFirstMinutes, peakLastMinutes, peakAheadProbability: probability(raw.peakAheadProbability),
    predictedMaxC: number(raw.predictedMaxC), predictedMaxRangeC: range, medianMaxC: number(raw.medianMaxC) };
}

function outcome(raw) {
  if (raw?.status === "missing") return { status: "missing" };
  if (raw?.status !== "scored" || number(raw.actualMaxC) === null || number(raw.actualPeakFirstMinutes) === null) return null;
  const score = value => (value && number(value.peakErrorMinutes) !== null ? { peakErrorMinutes: value.peakErrorMinutes,
    maxErrorC: number(value.maxErrorC), covered: value.covered === true } : null);
  return { status: "scored", actualMaxC: raw.actualMaxC, actualPeakFirstMinutes: raw.actualPeakFirstMinutes,
    actualPeakLastMinutes: number(raw.actualPeakLastMinutes), analog: score(raw.analog), season: score(raw.season) };
}

function forecast(raw, date) {
  if (!raw || raw.date !== date || !CHECKPOINTS.includes(raw.checkpoint) || number(raw.issuedAt) === null) return null;
  if (raw.status === "unavailable") return { checkpoint: raw.checkpoint, issuedAt: raw.issuedAt, status: "unavailable", reason: typeof raw.reason === "string" ? raw.reason : "" };
  const analog = peakSummary(raw.analog), season = peakSummary(raw.season);
  if (raw.status !== "ready" || !analog || !season) return null;
  return {
    checkpoint: raw.checkpoint, issuedAt: raw.issuedAt, status: "ready", analog, season,
    conditions: describeConditions(raw.features, raw.checkpoint),
    analogs: (Array.isArray(raw.analogs) ? raw.analogs : []).filter(item => typeof item?.date === "string" && number(item.maxC) !== null
      && number(item.peakFirstMinutes) !== null).slice(0, 5),
    outcome: outcome(raw.outcome),
  };
}

function performance(raw) {
  return CHECKPOINTS.map(checkpoint => {
    const row = raw?.[checkpoint];
    const days = Number.isInteger(row?.scoredDays) && row.scoredDays > 0 ? row.scoredDays : 0;
    const side = value => ({ peakMaeMinutes: days ? number(value?.peakMaeMinutes) : null, intervalCoverage: days ? probability(value?.intervalCoverage) : null,
      brierPeakAhead: days ? number(value?.brierPeakAhead) : null, maxExactShare: days ? probability(value?.maxExactShare) : null });
    return { checkpoint, scoredDays: days, missingDays: Number.isInteger(row?.missingDays) && row.missingDays > 0 ? row.missingDays : 0,
      analog: side(row?.analog), season: side(row?.season) };
  });
}

/** Display saved checkpoint forecasts and the seasonal window without recomputing either. */
export function buildAnalogPeakState(data, date, now) {
  const base = { kind: "loading", label: "Loading", detail: "Loading peak timing…", season: null, forecasts: [], latest: null,
    performance: [], isArchived: false, date };
  if (!(number(now) > 0)) return base;
  const today = seoulDate(now);
  if (date > today) return { ...base, kind: "future", label: "Future date", detail: "Peak timing appears on the day." };
  if (data === undefined) return base;
  if (data?.stationIcao !== "RKSI" || data?.date !== date) return { ...base, kind: "unavailable", label: "Unavailable", detail: "No RKSI peak timing is available for this date." };
  const forecasts = (Array.isArray(data.forecasts) ? data.forecasts : []).map(row => forecast(row, date)).filter(Boolean)
    .sort((a, b) => a.checkpoint.localeCompare(b.checkpoint));
  const ready = forecasts.filter(row => row.status === "ready");
  const latest = ready.at(-1) ?? null;
  const isArchived = date < today;
  const result = { ...base, season: peakSummary(data.season), forecasts, latest, performance: performance(data.performance), isArchived,
    performanceStartDate: typeof data.performanceStartDate === "string" ? data.performanceStartDate : date,
    versions: [data.modelVersion, data.libraryVersion].filter(value => typeof value === "string") };
  const unavailable = forecasts.filter(row => row.status === "unavailable").at(-1);
  if (latest) {
    const later = unavailable && unavailable.checkpoint > latest.checkpoint ? ` The ${formatCheckpoint(unavailable.checkpoint)} update was unavailable.` : "";
    return { ...result, kind: isArchived ? "archived" : "forecast", label: `From ${formatCheckpoint(latest.checkpoint)}`, detail: later.trim() };
  }
  if (unavailable) return { ...result, kind: "unavailable", label: "Unavailable", detail: unavailable.reason || "The checkpoint report was not available." };
  return { ...result, kind: "season", label: isArchived ? "Archived" : "Season only",
    detail: isArchived ? "No similar-day estimate was saved for this date." : "A similar-day estimate appears after the 9:00 AM report, usually by 9:05 AM." };
}
