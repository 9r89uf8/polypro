const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const ROUTINE_MINIMUM_SAMPLE_COUNT = 6;

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function signedCircularDelta(value, center, period) {
  return positiveModulo(value - center + period / 2, period) - period / 2;
}

// MMMX routine observations normally cluster tightly within an hour, but a
// circular estimator avoids treating :59 and :00 as 59 minutes apart.
export function estimateCircularHourPhase(phasesMs) {
  const phases = phasesMs
    .filter(Number.isFinite)
    .map((value) => positiveModulo(value, HOUR_MS));
  if (!phases.length) {
    return null;
  }
  let anchor = phases[0];
  let bestLoss = Number.POSITIVE_INFINITY;
  for (const candidate of phases) {
    const loss = phases.reduce(
      (total, value) =>
        total + Math.abs(signedCircularDelta(value, candidate, HOUR_MS)),
      0,
    );
    if (loss < bestLoss) {
      anchor = candidate;
      bestLoss = loss;
    }
  }
  const offsets = phases.map((value) =>
    signedCircularDelta(value, anchor, HOUR_MS),
  );
  const phaseMs = positiveModulo(anchor + median(offsets), HOUR_MS);
  const deviations = phases.map((value) =>
    Math.abs(signedCircularDelta(value, phaseMs, HOUR_MS)),
  );
  return {
    phaseMs,
    medianAbsoluteDeviationMs: median(deviations),
  };
}

function uniqueRoutineRows(rows) {
  const byObservation = new Map();
  for (const row of rows ?? []) {
    if (
      row?.reportType !== "METAR" ||
      row?.isCorrection ||
      !Number.isFinite(row?.obsTimeUtc) ||
      !Number.isFinite(row?.firstSeenAt)
    ) {
      continue;
    }
    const existing = byObservation.get(row.obsTimeUtc);
    if (!existing || row.firstSeenAt < existing.firstSeenAt) {
      byObservation.set(row.obsTimeUtc, row);
    }
  }
  return [...byObservation.values()].sort(
    (left, right) => left.obsTimeUtc - right.obsTimeUtc,
  );
}

export function estimateRoutineMetarWindow({
  rows,
  nowMs = Date.now(),
  minimumSampleCount = ROUTINE_MINIMUM_SAMPLE_COUNT,
  pollResolutionMs = MINUTE_MS,
}) {
  const routineRows = uniqueRoutineRows(rows).slice(-72);
  const base = {
    kind: "estimated_routine_observation_window",
    exactDueTime: false,
    method:
      "robust circular median observation phase plus median first-observed lag",
    sampleCount: routineRows.length,
    minimumSampleCount,
    pollResolutionSeconds: pollResolutionMs / 1000,
  };
  if (routineRows.length < minimumSampleCount) {
    return {
      ...base,
      available: false,
      confidence: "insufficient",
      state: "waiting",
      reason: "insufficient_history",
      windowStartUtc: null,
      windowCenterUtc: null,
      windowEndUtc: null,
      countdownTargetUtc: null,
    };
  }

  const phase = estimateCircularHourPhase(
    routineRows.map((row) => positiveModulo(row.obsTimeUtc, HOUR_MS)),
  );
  const usableLags = routineRows
    .map((row) => row.firstSeenAt - row.obsTimeUtc)
    .filter((lag) => Number.isFinite(lag) && lag >= 0 && lag <= HOUR_MS);
  if (!phase || usableLags.length < minimumSampleCount) {
    return {
      ...base,
      available: false,
      confidence: "insufficient",
      state: "waiting",
      reason: "insufficient_release_history",
      releaseSampleCount: usableLags.length,
      windowStartUtc: null,
      windowCenterUtc: null,
      windowEndUtc: null,
      countdownTargetUtc: null,
    };
  }

  const releaseLagMs = median(usableLags);
  const releaseLagMadMs = median(
    usableLags.map((value) => Math.abs(value - releaseLagMs)),
  );
  const observationMadMs = phase.medianAbsoluteDeviationMs;
  const variabilityMs = observationMadMs + releaseLagMadMs;
  const windowHalfWidthMs = Math.min(
    15 * MINUTE_MS,
    Math.max(2 * MINUTE_MS, 2 * variabilityMs + pollResolutionMs),
  );

  const latest = routineRows.at(-1);
  const latestHourUtc = Math.floor(latest.obsTimeUtc / HOUR_MS) * HOUR_MS;
  let nextObservationCenterUtc = latestHourUtc + HOUR_MS + phase.phaseMs;
  // A circular phase near :59 can mathematically resolve into the same instant
  // as the latest report's hour. Always forecast a genuinely later routine
  // observation without silently skipping an overdue report.
  while (nextObservationCenterUtc <= latest.obsTimeUtc) {
    nextObservationCenterUtc += HOUR_MS;
  }
  const windowCenterUtc = nextObservationCenterUtc + releaseLagMs;
  const windowStartUtc = windowCenterUtc - windowHalfWidthMs;
  const windowEndUtc = windowCenterUtc + windowHalfWidthMs;
  const justReceived =
    latest.firstSeenAt <= nowMs && nowMs - latest.firstSeenAt <= 2 * MINUTE_MS;
  const state = justReceived
    ? "received"
    : nowMs < windowStartUtc
      ? "waiting"
      : nowMs <= windowEndUtc
        ? "watching"
        : "past_expected_window";
  const confidence =
    routineRows.length >= 24 && variabilityMs <= MINUTE_MS
      ? "high"
      : routineRows.length >= 12 && variabilityMs <= 3 * MINUTE_MS
        ? "medium"
        : "low";

  return {
    ...base,
    available: true,
    confidence,
    state,
    releaseSampleCount: usableLags.length,
    observationPhaseMinute: Math.floor(phase.phaseMs / MINUTE_MS),
    observationPhaseSecond: Math.round((phase.phaseMs % MINUTE_MS) / 1000),
    observationMedianAbsoluteDeviationSeconds: observationMadMs / 1000,
    medianFirstObservedLagSeconds: releaseLagMs / 1000,
    releaseLagMedianAbsoluteDeviationSeconds: releaseLagMadMs / 1000,
    windowHalfWidthSeconds: windowHalfWidthMs / 1000,
    expectedObservationUtc: nextObservationCenterUtc,
    windowStartUtc,
    windowCenterUtc,
    windowEndUtc,
    countdownTargetUtc: state === "watching" ? windowEndUtc : windowStartUtc,
    latestRoutineReport: {
      reportKey: latest.reportKey ?? null,
      obsTimeUtc: latest.obsTimeUtc,
      firstSeenAt: latest.firstSeenAt,
    },
    caveat:
      "Historical collector timing is an estimate, not an airport publication deadline.",
  };
}

export function buildSpeciClock(rows) {
  const latest = [...(rows ?? [])]
    .filter(
      (row) => row?.reportType === "SPECI" && Number.isFinite(row?.obsTimeUtc),
    )
    .sort((left, right) => right.obsTimeUtc - left.obsTimeUtc)[0];
  return {
    status: "no_clock",
    scheduled: false,
    dueAtUtc: null,
    latest: latest ?? null,
    explanation:
      "SPECI reports are triggered by qualifying condition changes; they do not have a scheduled due time.",
    unobservedInputs:
      "This app cannot continuously observe every operational criterion used by the aerodrome meteorological office.",
  };
}

export function buildForecastRevision(snapshots) {
  const ordered = [...(snapshots ?? [])]
    .filter(
      (row) =>
        Number.isFinite(row?.forecastHighC) &&
        Number.isFinite(row?.sourceCapturedAt),
    )
    .sort((left, right) =>
      left.sourceCapturedAt !== right.sourceCapturedAt
        ? left.sourceCapturedAt - right.sourceCapturedAt
        : String(left.snapshotKey ?? "").localeCompare(
            String(right.snapshotKey ?? ""),
          ),
    );
  const current = ordered.at(-1) ?? null;
  if (!current) {
    return {
      status: "unavailable",
      current: null,
      previous: null,
      deltaC: null,
      changedAt: null,
      snapshotCount: 0,
    };
  }
  let previous = null;
  let changedAt = current.sourceCapturedAt;
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    if (ordered[index].forecastHighC !== current.forecastHighC) {
      previous = ordered[index];
      changedAt = ordered[index + 1].sourceCapturedAt;
      break;
    }
    changedAt = ordered[index].sourceCapturedAt;
  }
  return {
    status: "ok",
    current,
    previous,
    deltaC: previous
      ? Math.round((current.forecastHighC - previous.forecastHighC) * 10) / 10
      : null,
    changedAt,
    changed: Boolean(previous),
    snapshotCount: ordered.length,
  };
}
