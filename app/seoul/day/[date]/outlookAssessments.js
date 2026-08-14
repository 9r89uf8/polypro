const TEMPERATURE_EPSILON = 1e-9;
export const OUTLOOK_TREND_BAND_C_PER_HOUR = 0.2;
export const OUTLOOK_DECISION_MAX_AGE_MS = 10 * 60 * 1000;

export function temperatureTenth(value) {
  return Number.isFinite(value) ? Math.round(value * 10) : null;
}

export function sameTemperatureTenth(left, right) {
  const leftTenth = temperatureTenth(left);
  const rightTenth = temperatureTenth(right);
  return leftTenth !== null && leftTenth === rightTenth;
}

export function classifyKmaDifferenceMagnitude(differenceC) {
  const differenceTenth = temperatureTenth(Math.abs(differenceC));
  if (differenceTenth === null) return "unknown";
  return differenceTenth >= 5 ? "material" : "within_resolution";
}

function isRecent(ageMs) {
  return Number.isFinite(ageMs) && ageMs <= OUTLOOK_DECISION_MAX_AGE_MS;
}

export function classifyHighLock({
  isArchive = false,
  observedHighC,
  nextHighTargetC,
  dashboardTargetC,
  decisionStatus,
  amosFresh = false,
  decisionAgeMs,
}) {
  if (!Number.isFinite(observedHighC)) return "no_observed_high";
  if (isArchive) return "final";
  if (!Number.isFinite(nextHighTargetC)) return "no_next_target";
  if (
    !sameTemperatureTenth(dashboardTargetC, nextHighTargetC) ||
    !decisionStatus
  ) {
    return "pending";
  }
  if (!amosFresh) return "stale_amos";
  if (!isRecent(decisionAgeMs)) return "stale_decision";

  const states = {
    unlikely_to_reach: "locked",
    peak_candidate: "candidate",
    already_reached: "target_reached",
    insufficient_data: "insufficient_data",
    still_possible: "possible",
    final: "final",
  };
  return states[decisionStatus] ?? "unknown";
}

export function classifyForecastHigh({
  isArchive = false,
  forecastHighC,
  observedHighC,
  dashboardTargetC,
  decisionStatus,
  amosFresh = false,
  forecastStale = false,
  decisionAgeMs,
  predictionAgeMs,
  predictionStatus,
}) {
  const forecastTenth = temperatureTenth(forecastHighC);
  const observedTenth = temperatureTenth(observedHighC);
  if (forecastTenth === null) return "no_forecast";
  if (observedTenth === null) return "no_observed_high";

  if (isArchive) {
    if (observedTenth > forecastTenth) return "archive_above";
    if (observedTenth === forecastTenth) return "archive_matched";
    return "archive_below";
  }

  if (forecastStale) {
    if (observedTenth > forecastTenth) return "stale_exceeded";
    if (observedTenth === forecastTenth) return "stale_met";
    return "data_limited";
  }
  if (observedTenth >= forecastTenth + 1) return "exceeded";
  if (observedTenth === forecastTenth) return "met";

  if (
    !sameTemperatureTenth(dashboardTargetC, forecastHighC) ||
    !decisionStatus
  ) {
    return "starting";
  }
  if (!amosFresh || decisionStatus === "insufficient_data") {
    return "data_limited";
  }
  if (!isRecent(decisionAgeMs)) return "stale";

  if (decisionStatus === "unlikely_to_reach") return "likely_too_high";
  if (decisionStatus === "peak_candidate") return "fall_short_candidate";
  if (decisionStatus === "already_reached") return "reached_in_backend";
  if (decisionStatus === "final") return "final_below";
  if (decisionStatus !== "still_possible") return "unresolved";

  if (isRecent(predictionAgeMs)) {
    if (predictionStatus === "running_warm") return "running_warm";
    if (predictionStatus === "running_cool") return "running_cool";
    if (predictionStatus === "on_track") return "hourly_on_track";
  }
  return "possible_unresolved";
}

function atLeast(value, threshold) {
  return value >= threshold - TEMPERATURE_EPSILON;
}

function atMost(value, threshold) {
  return value <= threshold + TEMPERATURE_EPSILON;
}

export function classifyWarmingMomentum({
  amosFresh = false,
  slope15mCPerHour,
  slope30mCPerHour,
  slope60mCPerHour,
}) {
  if (!amosFresh) return "stale";
  if (
    !Number.isFinite(slope15mCPerHour) ||
    !Number.isFinite(slope30mCPerHour) ||
    !Number.isFinite(slope60mCPerHour)
  ) {
    return "insufficient_coverage";
  }

  const band = OUTLOOK_TREND_BAND_C_PER_HOUR;
  const slowing =
    atLeast(slope30mCPerHour, band) &&
    atLeast(slope60mCPerHour, band) &&
    atMost(slope15mCPerHour, slope30mCPerHour - band) &&
    atMost(slope30mCPerHour, slope60mCPerHour - band);
  const accelerating =
    atLeast(slope15mCPerHour, band) &&
    atLeast(slope30mCPerHour, band) &&
    atLeast(slope60mCPerHour, band) &&
    atLeast(slope30mCPerHour, slope60mCPerHour + band) &&
    atLeast(slope15mCPerHour, slope30mCPerHour + band);

  if (atMost(slope15mCPerHour, -band)) return "cooling";
  if (slope15mCPerHour < band - TEMPERATURE_EPSILON) {
    return slowing ? "leveled_off" : "nearly_steady_mixed";
  }
  if (slowing) return "slowing";
  if (accelerating) return "accelerating";
  if (slope30mCPerHour < band - TEMPERATURE_EPSILON) return "resumed";
  return "warming_mixed";
}
