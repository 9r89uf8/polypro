import { medianFinite, robustTemperatureTrend } from "../seoulHighPredictionModel.js";

export const NOWCAST_MODEL_VERSION = "rksi15l-minute-nowcast-v1";
export const NOWCAST_HORIZONS_MINUTES = Object.freeze([10, 15, 20]);
export const NOWCAST_DAMPING_MINUTES = 20;
export const NOWCAST_MAX_OBSERVATION_AGE_MS = 2 * 60 * 1000;
export const NOWCAST_WINDOW_MINUTES = 60;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;
const TREND_WINDOW_MINUTES = 15;

// Broad sanity limits reject common missing-value sentinels. They are not a
// claim of instrument quality control, accuracy, or forecast skill.
function validTemperature(value) {
  return Number.isFinite(value) && value >= -80 && value <= 60;
}

function finiteInRange(value, low, high) {
  return Number.isFinite(value) && value >= low && value <= high ? value : null;
}

function canonicalSite(row) {
  if (row?.stationIcao !== "RKSI" || row.collectionCadence !== "one_minute") return null;
  if (row.rwyNo === "2" && row.rwyDir === "15L") return "15L";
  if (row.rwyNo === "3" && row.rwyDir === "16L") return "16L";
  return null;
}

function snapshot(row, issuedAt) {
  if (!row) return null;
  return {
    versionId: row._id,
    obsTimeUtc: row.obsTimeUtc,
    receivedAt: row.receivedAt,
    observationAgeMinutes: (issuedAt - row.obsTimeUtc) / MINUTE_MS,
    tempC: validTemperature(row.tempC) ? row.tempC : null,
    dewpointC: validTemperature(row.dewpointC) ? row.dewpointC : null,
    qnhHpa: finiteInRange(row.qnhHpa, 700, 1100),
    windDirAvg: finiteInRange(row.windDirAvg, 0, 360),
    windDirMin: finiteInRange(row.windDirMin, 0, 360),
    windDirMax: finiteInRange(row.windDirMax, 0, 360),
    windSpeedAvg: finiteInRange(row.windSpeedAvg, 0, 250),
    windSpeedMin: finiteInRange(row.windSpeedMin, 0, 250),
    windSpeedMax: finiteInRange(row.windSpeedMax, 0, 250),
    morMeters: finiteInRange(row.morMeters, 0, 100000),
    rvrMeters: typeof row.rvrMeters === "string" ? row.rvrMeters : null,
    precipMm: finiteInRange(row.precipMm, 0, 10000),
    rwyMain: typeof row.rwyMain === "string" ? row.rwyMain : null,
  };
}

// receivedAt is this immutable version's database availability clock, never
// the mutable source row's firstSeenAt. Choose versions before checking their
// temperature: an invalid correction must not revive an older valid value.
function selectVersions(versions, issuedAt) {
  const bySite = { "15L": new Map(), "16L": new Map() };
  for (const row of Array.isArray(versions) ? versions : []) {
    const site = canonicalSite(row);
    if (!site || typeof row._id !== "string" || !row._id
      || !Number.isSafeInteger(row.obsTimeUtc) || row.obsTimeUtc % MINUTE_MS !== 0
      || !Number.isFinite(row.receivedAt) || row.receivedAt < row.obsTimeUtc
      || row.receivedAt > issuedAt || row.obsTimeUtc > issuedAt
      || row.obsTimeUtc < issuedAt - NOWCAST_WINDOW_MINUTES * MINUTE_MS) continue;
    const current = bySite[site].get(row.obsTimeUtc);
    const order = row.receivedAt - (current?.row.receivedAt ?? -Infinity);
    const creationOrder = (Number.isFinite(row._creationTime) ? row._creationTime : 0)
      - (Number.isFinite(current?.row._creationTime) ? current.row._creationTime : 0);
    if (!current || order > 0 || (order === 0 && creationOrder > 0)) {
      bySite[site].set(row.obsTimeUtc, { row, ambiguous: false, versionIds: [row._id] });
    } else if (order === 0 && creationOrder === 0 && row._id !== current.row._id) {
      // With tied receipt/creation clocks, the payload order is unknowable.
      // Do not resolve conflicting versions using input order or ID spelling.
      current.ambiguous = true;
      current.versionIds = [...new Set([...current.versionIds, row._id])].sort();
    }
  }
  return Object.fromEntries(Object.entries(bySite).map(([site, rows]) => [site,
    [...rows.values()].sort((a, b) => a.row.obsTimeUtc - b.row.obsTimeUtc),
  ]));
}

function timeFeatures(issuedAt) {
  if (!Number.isFinite(issuedAt)) return { minuteOfDayKst: null, dayOfYearKst: null };
  const local = new Date(issuedAt + KST_OFFSET_MS);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return {
    minuteOfDayKst: local.getUTCHours() * 60 + local.getUTCMinutes(),
    dayOfYearKst: 1 + Math.floor((dayStart - Date.UTC(local.getUTCFullYear(), 0, 1)) / DAY_MS),
  };
}

function historySnapshot(entries) {
  return entries.map(({ row, ambiguous, versionIds }) => ({
    versionId: row._id,
    versionIds,
    obsTimeUtc: row.obsTimeUtc,
    receivedAt: row.receivedAt,
    tempC: !ambiguous && validTemperature(row.tempC) ? row.tempC : null,
    ambiguous,
  }));
}

/**
 * Pure, unfitted first-version forecast. Call with immutable observation
 * versions, including the preceding KST date when the window crosses midnight.
 * No current database rows or future outcomes belong in the input snapshot.
 */
export function buildNowcast({ versions = [], issuedAt, triggerObsTimeUtc } = {}) {
  const validIssueTime = Number.isSafeInteger(issuedAt) && issuedAt >= 0
    && Number.isFinite(new Date(issuedAt + KST_OFFSET_MS).getTime());
  const result = {
    modelVersion: NOWCAST_MODEL_VERSION,
    issuedAt: validIssueTime ? issuedAt : null,
    qualityStatus: "unavailable",
    reasonCode: null,
    reason: null,
    intervalStatus: "insufficient_calibration",
    latestObservationTimeUtc: null,
    latestObservationReceivedAt: null,
    observationAgeMinutes: null,
    inputVersionIds: [],
    features: {
      windowMinutes: NOWCAST_WINDOW_MINUTES,
      trendWindowMinutes: TREND_WINDOW_MINUTES,
      dampingMinutes: NOWCAST_DAMPING_MINUTES,
      parametersStatus: "fixed_unvalidated",
      ...timeFeatures(validIssueTime ? issuedAt : null),
    },
    predictions: [],
  };
  function unavailable(reasonCode, reason) {
    return { ...result, qualityStatus: "unavailable", reasonCode, reason };
  }
  if (!validIssueTime) return unavailable("invalid_issue_time", "A valid forecast issue time is required.");
  if (triggerObsTimeUtc !== undefined
    && (!Number.isSafeInteger(triggerObsTimeUtc) || triggerObsTimeUtc % MINUTE_MS !== 0)) {
    return unavailable("invalid_trigger_time", "The triggering observation must identify an exact minute.");
  }

  const selected = selectVersions(versions, issuedAt);
  const primary = selected["15L"];
  const secondary = selected["16L"];
  const latestEntry = primary.at(-1);
  const latest = latestEntry?.row ?? null;
  const secondaryEntry = secondary.at(-1);
  const primaryRows = primary.filter(entry => !entry.ambiguous && validTemperature(entry.row.tempC)).map(entry => entry.row);
  const secondaryRows = secondary.filter(entry => !entry.ambiguous && validTemperature(entry.row.tempC)).map(entry => entry.row);
  const trend15 = robustTemperatureTrend(primaryRows, TREND_WINDOW_MINUTES);
  const trend30 = robustTemperatureTrend(primaryRows, 30);
  const trend60 = robustTemperatureTrend(primaryRows, 60);
  const latest15L = snapshot(latest, issuedAt);
  const latest16L = snapshot(secondaryEntry?.row, issuedAt);
  if (latest15L && latestEntry.ambiguous) latest15L.tempC = null;
  if (latest16L && secondaryEntry.ambiguous) latest16L.tempC = null;
  result.inputVersionIds = [...new Set([...primary, ...secondary].flatMap(entry => entry.versionIds))];
  result.latestObservationTimeUtc = latest?.obsTimeUtc ?? null;
  result.latestObservationReceivedAt = latest?.receivedAt ?? null;
  result.observationAgeMinutes = latest ? (issuedAt - latest.obsTimeUtc) / MINUTE_MS : null;
  result.features = {
    ...result.features,
    latest15L,
    latest16L,
    primaryHistory: historySnapshot(primary),
    secondaryHistory: historySnapshot(secondary),
    currentSmoothedC: medianFinite(primaryRows.slice(-3).map(row => row.tempC)),
    slope15mCPerHour: trend15.slopeCPerHour,
    slope15mCPerMinute: Number.isFinite(trend15.slopeCPerHour) ? trend15.slopeCPerHour / 60 : null,
    slope30mCPerHour: trend30.slopeCPerHour,
    slope60mCPerHour: trend60.slopeCPerHour,
    secondarySlope15mCPerHour: robustTemperatureTrend(secondaryRows, TREND_WINDOW_MINUTES).slopeCPerHour,
    secondaryDifferenceC: Number.isFinite(latest15L?.tempC) && Number.isFinite(latest16L?.tempC)
      && latest15L.obsTimeUtc === latest16L.obsTimeUtc
      ? latest16L.tempC - latest15L.tempC : null,
    dewpointSpreadC: Number.isFinite(latest15L?.tempC) && Number.isFinite(latest15L?.dewpointC)
      ? latest15L.tempC - latest15L.dewpointC : null,
    trend15,
  };
  if (!latest) return unavailable("amos_missing", "No available one-minute 15L observation is stored in the last hour.");
  if (triggerObsTimeUtc !== undefined && latest.obsTimeUtc !== triggerObsTimeUtc) {
    return unavailable("trigger_observation_mismatch", "The triggering minute is no longer the latest available 15L observation.");
  }
  if (latestEntry.ambiguous) return unavailable("ambiguous_latest_version", "The latest 15L minute has versions with indistinguishable availability clocks.");
  if (!validTemperature(latest.tempC)) return unavailable("invalid_latest_temperature", "The latest 15L temperature is missing or outside the sanity limits.");
  if (issuedAt - latest.obsTimeUtc > NOWCAST_MAX_OBSERVATION_AGE_MS) {
    return unavailable("amos_stale", "The latest 15L observation is older than two minutes.");
  }

  const slope = result.features.slope15mCPerMinute;
  const trendUsable = Number.isFinite(slope);
  result.qualityStatus = trendUsable ? "ready" : "persistence_only";
  result.reasonCode = trendUsable ? null : "insufficient_trend_coverage";
  result.reason = trendUsable ? null : "Recent 15L coverage is insufficient for a robust trend; only persistence is available.";
  result.predictions = NOWCAST_HORIZONS_MINUTES.map(horizonMinutes => {
    const targetTimeUtc = Math.floor(issuedAt / MINUTE_MS) * MINUTE_MS + horizonMinutes * MINUTE_MS;
    const observationLeadMinutes = (targetTimeUtc - latest.obsTimeUtc) / MINUTE_MS;
    return {
      horizonMinutes,
      targetTimeUtc,
      observationLeadMinutes,
      actualLeadMinutes: (targetTimeUtc - issuedAt) / MINUTE_MS,
      persistenceC: latest.tempC,
      dampedTrendC: trendUsable
        ? latest.tempC + slope * NOWCAST_DAMPING_MINUTES * -Math.expm1(-observationLeadMinutes / NOWCAST_DAMPING_MINUTES)
        : null,
    };
  });
  return result;
}
