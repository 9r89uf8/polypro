export const SEOUL_REMAINING_CEILING_MODEL_VERSION =
  "rksi15l-remaining-ceiling-v2";
export const SEOUL_RAW_TARGET_C = 27;
export const SEOUL_MIN_TARGET_C = -20;
export const SEOUL_MAX_TARGET_C = 45;
export const DECISION_INTERVAL_MS = 5 * 60 * 1000;

const MILLIS_PER_MINUTE = 60 * 1000;
const MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE;
const FLOAT_EPSILON = 1e-9;

export function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

export function normalizeDecisionTargetC(value) {
  const requested = value === undefined ? SEOUL_RAW_TARGET_C : value;
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    throw new Error("The Seoul decision target must be a finite number.");
  }
  const normalized = roundToTenth(requested);
  if (normalized < SEOUL_MIN_TARGET_C || normalized > SEOUL_MAX_TARGET_C) {
    throw new Error(
      `The Seoul decision target must be between ${SEOUL_MIN_TARGET_C.toFixed(1)}°C and ${SEOUL_MAX_TARGET_C.toFixed(1)}°C.`,
    );
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function planActiveDecisionTargetRegistration({
  activeTargets = [],
  requestedTargetCs = [],
  maxActiveTargets,
}) {
  if (!Number.isInteger(maxActiveTargets) || maxActiveTargets < 1) {
    throw new Error(
      "The active Seoul target limit must be a positive integer.",
    );
  }
  const normalizedRequestedTargetCs = Array.from(
    new Set(requestedTargetCs.map(normalizeDecisionTargetC)),
  ).filter((targetC) => targetC !== SEOUL_RAW_TARGET_C);
  if (normalizedRequestedTargetCs.length > maxActiveTargets) {
    throw new Error(
      "The requested Seoul targets cannot fit in the active-target registry.",
    );
  }

  const requestedTargetSet = new Set(normalizedRequestedTargetCs);
  const existingRequestedTargets = activeTargets.filter((row) =>
    requestedTargetSet.has(normalizeDecisionTargetC(row.targetC)),
  );
  const existingRequestedSet = new Set(
    existingRequestedTargets.map((row) =>
      normalizeDecisionTargetC(row.targetC),
    ),
  );
  const missingTargetCs = normalizedRequestedTargetCs.filter(
    (targetC) => !existingRequestedSet.has(targetC),
  );
  const retireCount = Math.max(
    0,
    activeTargets.length + missingTargetCs.length - maxActiveTargets,
  );
  const retirementTargets = activeTargets
    .filter(
      (row) => !requestedTargetSet.has(normalizeDecisionTargetC(row.targetC)),
    )
    .sort(
      (left, right) =>
        (left.updatedAt ?? left.createdAt) -
          (right.updatedAt ?? right.createdAt) ||
        left.createdAt - right.createdAt,
    )
    .slice(0, retireCount);
  if (retirementTargets.length < retireCount) {
    throw new Error(
      "The requested Seoul targets cannot fit in the active-target registry.",
    );
  }
  return {
    requestedTargetCs: normalizedRequestedTargetCs,
    existingRequestedTargets,
    missingTargetCs,
    retirementTargets,
  };
}

function ceilToTenth(value) {
  return Math.ceil((value - FLOAT_EPSILON) * 10) / 10;
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function medianFinite(values) {
  const ordered = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!ordered.length) {
    return null;
  }
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function finiteTemperatureRows(rows) {
  return (rows ?? [])
    .filter(
      (row) => Number.isFinite(row?.tempC) && Number.isFinite(row?.obsTimeUtc),
    )
    .sort((left, right) => left.obsTimeUtc - right.obsTimeUtc);
}

function representedMinuteCoverage(rows, maximumMinutes) {
  const minuteBuckets = new Set(
    rows.map((row) => Math.floor(row.obsTimeUtc / MILLIS_PER_MINUTE)),
  );
  return Math.min(maximumMinutes, minuteBuckets.size);
}

export function robustTemperatureTrend(rows, windowMinutes) {
  const ordered = finiteTemperatureRows(rows);
  if (ordered.length < 4) {
    return {
      slopeCPerHour: null,
      sampleCount: ordered.length,
      coverageMinutes: 0,
      latestGapMinutes: null,
    };
  }

  const latest = ordered.at(-1);
  const windowStart = latest.obsTimeUtc - windowMinutes * MILLIS_PER_MINUTE;
  const windowRows = ordered.filter((row) => row.obsTimeUtc >= windowStart);
  const coverageMinutes = representedMinuteCoverage(windowRows, windowMinutes);
  const latestGapMinutes =
    windowRows.length > 1
      ? (latest.obsTimeUtc - windowRows.at(-2).obsTimeUtc) / MILLIS_PER_MINUTE
      : null;
  if (
    windowRows.length < 4 ||
    coverageMinutes < windowMinutes * 0.75 ||
    !Number.isFinite(latestGapMinutes) ||
    latestGapMinutes > 5
  ) {
    return {
      slopeCPerHour: null,
      sampleCount: windowRows.length,
      coverageMinutes: roundToTenth(coverageMinutes),
      latestGapMinutes: Number.isFinite(latestGapMinutes)
        ? roundToTenth(latestGapMinutes)
        : null,
    };
  }

  const minimumPairGapMs = Math.min(10, windowMinutes / 4) * MILLIS_PER_MINUTE;
  const slopes = [];
  for (let leftIndex = 0; leftIndex < windowRows.length - 1; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < windowRows.length;
      rightIndex += 1
    ) {
      const elapsedMs =
        windowRows[rightIndex].obsTimeUtc - windowRows[leftIndex].obsTimeUtc;
      if (elapsedMs < minimumPairGapMs) {
        continue;
      }
      slopes.push(
        ((windowRows[rightIndex].tempC - windowRows[leftIndex].tempC) *
          MILLIS_PER_HOUR) /
          elapsedMs,
      );
    }
  }

  const slope = medianFinite(slopes);
  return {
    // Keep decision precision here. Presentation rounds independently; doing
    // it before blocker comparisons can erase a small positive trend or make
    // marginal cooling appear to meet a safety threshold.
    slopeCPerHour: Number.isFinite(slope) ? slope : null,
    sampleCount: windowRows.length,
    coverageMinutes: roundToTenth(coverageMinutes),
    latestGapMinutes: roundToTenth(latestGapMinutes),
  };
}

export function buildObservedTemperatureFeatures(rows, evaluatedAt) {
  const ordered = finiteTemperatureRows(rows);
  const latest = ordered.at(-1) ?? null;
  const recentForSmoothing = ordered.slice(-3);
  const currentSmoothedC = medianFinite(
    recentForSmoothing.map((row) => row.tempC),
  );
  let observedHighRow = null;
  for (const row of ordered) {
    if (
      !observedHighRow ||
      row.tempC > observedHighRow.tempC ||
      (row.tempC === observedHighRow.tempC &&
        row.obsTimeUtc < observedHighRow.obsTimeUtc)
    ) {
      observedHighRow = row;
    }
  }
  const lastNearHighRow = observedHighRow
    ? ([...ordered]
        .reverse()
        .find(
          (row) => row.tempC >= observedHighRow.tempC - 0.1 - FLOAT_EPSILON,
        ) ?? null)
    : null;
  const trailingHourRows = latest
    ? ordered.filter(
        (row) => row.obsTimeUtc >= latest.obsTimeUtc - 60 * MILLIS_PER_MINUTE,
      )
    : [];
  const trailingHourCoverageMinutes = representedMinuteCoverage(
    trailingHourRows,
    60,
  );
  const latestObservationGapMinutes =
    ordered.length > 1
      ? (latest.obsTimeUtc - ordered.at(-2).obsTimeUtc) / MILLIS_PER_MINUTE
      : null;
  const trend15 = robustTemperatureTrend(ordered, 15);
  const trend30 = robustTemperatureTrend(ordered, 30);
  const trend60 = robustTemperatureTrend(ordered, 60);

  return {
    rows: ordered,
    latestRow: latest,
    observedHighRow,
    lastNearHighRow,
    currentSmoothedC: Number.isFinite(currentSmoothedC)
      ? roundToTenth(currentSmoothedC)
      : null,
    minutesSinceNearHigh:
      lastNearHighRow && Number.isFinite(evaluatedAt)
        ? roundToTenth(
            Math.max(0, evaluatedAt - lastNearHighRow.obsTimeUtc) /
              MILLIS_PER_MINUTE,
          )
        : null,
    dropFromHighC:
      observedHighRow && Number.isFinite(currentSmoothedC)
        ? roundToTenth(observedHighRow.tempC - currentSmoothedC)
        : null,
    trailingHourCoverageMinutes: roundToTenth(trailingHourCoverageMinutes),
    latestObservationGapMinutes: Number.isFinite(latestObservationGapMinutes)
      ? roundToTenth(latestObservationGapMinutes)
      : null,
    slope15mCPerHour: trend15.slopeCPerHour,
    slope30mCPerHour: trend30.slopeCPerHour,
    slope60mCPerHour: trend60.slopeCPerHour,
    trend15,
    trend30,
    trend60,
  };
}

export function interpolateForecastTemperature(rows, epochMs) {
  const ordered = (rows ?? [])
    .filter(
      (row) =>
        Number.isFinite(row?.tempC) && Number.isFinite(row?.forecastTimeUtc),
    )
    .sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc);
  let before = null;
  let after = null;
  for (const row of ordered) {
    if (row.forecastTimeUtc <= epochMs) {
      before = row;
    }
    if (row.forecastTimeUtc >= epochMs) {
      after = row;
      break;
    }
  }
  if (!before || !after) {
    return null;
  }
  if (before.forecastTimeUtc === after.forecastTimeUtc) {
    return before.tempC;
  }
  if (after.forecastTimeUtc - before.forecastTimeUtc > 90 * MILLIS_PER_MINUTE) {
    return null;
  }
  const ratio =
    (epochMs - before.forecastTimeUtc) /
    (after.forecastTimeUtc - before.forecastTimeUtc);
  return before.tempC + (after.tempC - before.tempC) * ratio;
}

export function computeKmaLiveBias(observationRows, forecastRows, evaluatedAt) {
  const observations = finiteTemperatureRows(observationRows).filter(
    (row) =>
      row.obsTimeUtc >= evaluatedAt - 60 * MILLIS_PER_MINUTE &&
      row.obsTimeUtc <= evaluatedAt + MILLIS_PER_MINUTE,
  );
  const matches = observations
    .map((row) => {
      const forecastC = interpolateForecastTemperature(
        forecastRows,
        row.obsTimeUtc,
      );
      return Number.isFinite(forecastC)
        ? { obsTimeUtc: row.obsTimeUtc, residualC: row.tempC - forecastC }
        : null;
    })
    .filter(Boolean);
  const residuals = matches.map((match) => match.residualC);
  const coverageMinutes =
    matches.length > 1
      ? (matches.at(-1).obsTimeUtc - matches[0].obsTimeUtc) / MILLIS_PER_MINUTE
      : 0;
  const rawBiasC = medianFinite(residuals);
  const usable =
    residuals.length >= 3 && coverageMinutes >= 30 && Number.isFinite(rawBiasC);
  return {
    liveBiasC: usable ? roundToTenth(clamp(rawBiasC, -1.5, 1.5)) : null,
    rawBiasC: Number.isFinite(rawBiasC) ? roundToTenth(rawBiasC) : null,
    sampleCount: residuals.length,
    coverageMinutes: roundToTenth(coverageMinutes),
  };
}

export function assessKmaHourlyCurve({
  rows,
  evaluatedAt,
  endOfDayUtc,
  dailyHighC,
}) {
  const ordered = (rows ?? [])
    .filter(
      (row) =>
        Number.isFinite(row?.tempC) && Number.isFinite(row?.forecastTimeUtc),
    )
    .sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc);
  const futureRows = ordered.filter(
    (row) => row.forecastTimeUtc >= evaluatedAt - MILLIS_PER_MINUTE,
  );
  const coverageCheckpoints = [
    evaluatedAt,
    ...futureRows.map((row) => Math.max(evaluatedAt, row.forecastTimeUtc)),
    endOfDayUtc,
  ];
  const gapsMinutes = [];
  for (let index = 1; index < coverageCheckpoints.length; index += 1) {
    gapsMinutes.push(
      (coverageCheckpoints[index] - coverageCheckpoints[index - 1]) /
        MILLIS_PER_MINUTE,
    );
  }
  const hourlyHighC = ordered.length
    ? Math.max(...ordered.map((row) => row.tempC))
    : null;
  const lastForecastTimeUtc = ordered.at(-1)?.forecastTimeUtc ?? null;
  const maxGapMinutes = gapsMinutes.length ? Math.max(...gapsMinutes) : null;
  const reachesDayEnd =
    Number.isFinite(lastForecastTimeUtc) &&
    lastForecastTimeUtc >= endOfDayUtc - 90 * MILLIS_PER_MINUTE;
  const complete =
    ordered.length >= 2 &&
    futureRows.length > 0 &&
    reachesDayEnd &&
    Number.isFinite(maxGapMinutes) &&
    maxGapMinutes <= 90;
  const dailyHourlyHighGapC =
    Number.isFinite(dailyHighC) && Number.isFinite(hourlyHighC)
      ? roundToTenth(dailyHighC - hourlyHighC)
      : null;

  return {
    pointCount: ordered.length,
    futurePointCount: futureRows.length,
    hourlyHighC: Number.isFinite(hourlyHighC) ? hourlyHighC : null,
    lastForecastTimeUtc,
    maxGapMinutes: Number.isFinite(maxGapMinutes)
      ? roundToTenth(maxGapMinutes)
      : null,
    reachesDayEnd,
    complete,
    dailyHourlyHighGapC,
    dailyHourlyConsistent:
      Number.isFinite(dailyHourlyHighGapC) && dailyHourlyHighGapC <= 0.7,
  };
}

export function assessKmaUpwardRevision({
  previousCaptureKey,
  currentCaptureKey,
  previousDailyHighC,
  currentDailyHighC,
  previousRemainingUpperC,
  currentRemainingUpperC,
  previousHourlyRows,
  currentHourlyRows,
  evaluatedAt,
}) {
  const captureChanged = Boolean(
    previousCaptureKey &&
    currentCaptureKey &&
    String(previousCaptureKey) !== String(currentCaptureKey),
  );
  const rawDailyHighIncreaseC =
    captureChanged &&
    Number.isFinite(previousDailyHighC) &&
    Number.isFinite(currentDailyHighC)
      ? currentDailyHighC - previousDailyHighC
      : null;
  const rawRemainingUpperIncreaseC =
    captureChanged &&
    Number.isFinite(previousRemainingUpperC) &&
    Number.isFinite(currentRemainingUpperC)
      ? currentRemainingUpperC - previousRemainingUpperC
      : null;
  const previousHourlyByTime = new Map(
    (previousHourlyRows ?? [])
      .filter(
        (row) =>
          Number.isFinite(row?.forecastTimeUtc) && Number.isFinite(row?.tempC),
      )
      .map((row) => [row.forecastTimeUtc, row.tempC]),
  );
  const rawHourlyIncreases = captureChanged
    ? (currentHourlyRows ?? [])
        .filter(
          (row) =>
            Number.isFinite(row?.forecastTimeUtc) &&
            row.forecastTimeUtc >= evaluatedAt - MILLIS_PER_MINUTE &&
            Number.isFinite(row?.tempC) &&
            Number.isFinite(previousHourlyByTime.get(row.forecastTimeUtc)),
        )
        .map((row) => row.tempC - previousHourlyByTime.get(row.forecastTimeUtc))
        .filter((change) => change > FLOAT_EPSILON)
    : [];
  const rawHourlyIncreaseC = rawHourlyIncreases.length
    ? Math.max(...rawHourlyIncreases)
    : null;

  return {
    captureChanged,
    dailyHighIncreaseC: Number.isFinite(rawDailyHighIncreaseC)
      ? roundToTenth(rawDailyHighIncreaseC)
      : null,
    remainingUpperIncreaseC: Number.isFinite(rawRemainingUpperIncreaseC)
      ? roundToTenth(rawRemainingUpperIncreaseC)
      : null,
    hourlyIncreaseC: Number.isFinite(rawHourlyIncreaseC)
      ? roundToTenth(rawHourlyIncreaseC)
      : null,
    upwardDetected:
      (Number.isFinite(rawDailyHighIncreaseC) &&
        rawDailyHighIncreaseC > FLOAT_EPSILON) ||
      (Number.isFinite(rawHourlyIncreaseC) &&
        rawHourlyIncreaseC > FLOAT_EPSILON) ||
      (Number.isFinite(rawRemainingUpperIncreaseC) &&
        rawRemainingUpperIncreaseC > FLOAT_EPSILON),
  };
}

export function assessFutureObservationCoverage(
  observationRows,
  declarationAtUtc,
  endOfDayUtc,
) {
  const futureRows = finiteTemperatureRows(observationRows).filter(
    (row) => row.obsTimeUtc > declarationAtUtc,
  );
  const checkpoints = [
    declarationAtUtc,
    ...futureRows.map((row) => row.obsTimeUtc),
    endOfDayUtc,
  ];
  let maxGapMinutes = 0;
  for (let index = 1; index < checkpoints.length; index += 1) {
    maxGapMinutes = Math.max(
      maxGapMinutes,
      (checkpoints[index] - checkpoints[index - 1]) / MILLIS_PER_MINUTE,
    );
  }
  return {
    futureRows,
    coverageEndUtc: futureRows.at(-1)?.obsTimeUtc ?? null,
    maxGapMinutes: roundToTenth(maxGapMinutes),
    complete: futureRows.length > 0 && maxGapMinutes <= 3,
  };
}

export function computeKmaPeakWindow(rows) {
  const ordered = (rows ?? [])
    .filter(
      (row) =>
        Number.isFinite(row?.tempC) && Number.isFinite(row?.forecastTimeUtc),
    )
    .sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc);
  if (!ordered.length) {
    return null;
  }
  const peakTempC = Math.max(...ordered.map((row) => row.tempC));
  const tiedRows = ordered.filter(
    (row) => Math.abs(row.tempC - peakTempC) < FLOAT_EPSILON,
  );
  const intervals = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const interval =
      ordered[index].forecastTimeUtc - ordered[index - 1].forecastTimeUtc;
    if (interval >= 30 * MILLIS_PER_MINUTE && interval <= 3 * MILLIS_PER_HOUR) {
      intervals.push(interval);
    }
  }
  const forecastIntervalMs = medianFinite(intervals) ?? MILLIS_PER_HOUR;
  const first = tiedRows[0];
  const last = tiedRows.at(-1);
  return {
    peakTempC,
    tiedCount: tiedRows.length,
    firstPeakTimeUtc: first.forecastTimeUtc,
    firstPeakTimeLocal: first.forecastTimeLocal ?? null,
    lastPeakTimeUtc: last.forecastTimeUtc,
    lastPeakTimeLocal: last.forecastTimeLocal ?? null,
    forecastIntervalMinutes: roundToTenth(
      forecastIntervalMs / MILLIS_PER_MINUTE,
    ),
    peakWindowEndUtc: last.forecastTimeUtc + forecastIntervalMs,
  };
}

export function computeRemainingCeilings({
  forecastRows,
  evaluatedAt,
  endOfDayUtc,
  liveBiasC,
  currentSmoothedC,
  observedHighC,
  slope15mCPerHour,
  slope30mCPerHour,
  targetC = SEOUL_RAW_TARGET_C,
  policyMarginC = 0.7,
}) {
  const rows = (forecastRows ?? [])
    .filter(
      (row) =>
        Number.isFinite(row?.tempC) &&
        Number.isFinite(row?.forecastTimeUtc) &&
        row.forecastTimeUtc >= evaluatedAt - MILLIS_PER_MINUTE &&
        row.forecastTimeUtc < endOfDayUtc,
    )
    .sort((left, right) => left.forecastTimeUtc - right.forecastTimeUtc);
  const expectedCurrentC = interpolateForecastTemperature(
    forecastRows,
    evaluatedAt,
  );
  const futurePoints = [...rows];
  if (Number.isFinite(expectedCurrentC)) {
    futurePoints.push({
      forecastTimeUtc: evaluatedAt,
      tempC: expectedCurrentC,
    });
  }
  const bias = Number.isFinite(liveBiasC) ? liveBiasC : 0;
  let remainingBest = null;
  let remainingUpper = null;
  for (const point of futurePoints) {
    const hoursAhead = Math.max(
      0,
      (point.forecastTimeUtc - evaluatedAt) / MILLIS_PER_HOUR,
    );
    const decay = Math.max(0, 1 - hoursAhead / 3);
    const best = point.tempC + bias * decay;
    const upper = point.tempC + Math.max(0, bias) * decay + policyMarginC;
    remainingBest = Number.isFinite(remainingBest)
      ? Math.max(remainingBest, best)
      : best;
    remainingUpper = Number.isFinite(remainingUpper)
      ? Math.max(remainingUpper, upper)
      : upper;
  }

  const positiveShortSlope = Math.max(
    0,
    Number.isFinite(slope15mCPerHour) ? slope15mCPerHour : 0,
    Number.isFinite(slope30mCPerHour) ? slope30mCPerHour : 0,
  );
  const slopeContributionC = Math.min(1, 0.5 * positiveShortSlope);
  const nowcastUpper = Number.isFinite(currentSmoothedC)
    ? currentSmoothedC + slopeContributionC + 0.2
    : null;
  const ruleComponents = [observedHighC, remainingUpper, nowcastUpper].filter(
    Number.isFinite,
  );
  const remainingRuleCeilingC = ruleComponents.length
    ? ceilToTenth(Math.max(...ruleComponents))
    : null;

  return {
    expectedCurrentC: Number.isFinite(expectedCurrentC)
      ? roundToTenth(expectedCurrentC)
      : null,
    kmaRemainingBestHighC: Number.isFinite(remainingBest)
      ? roundToTenth(remainingBest)
      : null,
    kmaRemainingUpperC: Number.isFinite(remainingUpper)
      ? ceilToTenth(remainingUpper)
      : null,
    nowcastUpperC: Number.isFinite(nowcastUpper)
      ? ceilToTenth(nowcastUpper)
      : null,
    remainingRuleCeilingC,
    targetC,
    marginBelowTargetC: Number.isFinite(remainingRuleCeilingC)
      ? roundToTenth(targetC - remainingRuleCeilingC)
      : null,
    policyMarginC,
    nowcastSlopeContributionC: roundToTenth(slopeContributionC),
  };
}

export function circularDifferenceDegrees(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }
  const normalized = Math.abs((((left - right) % 360) + 360) % 360);
  return Math.min(normalized, 360 - normalized);
}

export function nearestRowAt(rows, targetTimeUtc, toleranceMinutes = 10) {
  let selected = null;
  let smallestDifference = Number.POSITIVE_INFINITY;
  for (const row of rows ?? []) {
    if (!Number.isFinite(row?.obsTimeUtc)) {
      continue;
    }
    const difference = Math.abs(row.obsTimeUtc - targetTimeUtc);
    if (
      difference <= toleranceMinutes * MILLIS_PER_MINUTE &&
      difference < smallestDifference
    ) {
      selected = row;
      smallestDifference = difference;
    }
  }
  return selected;
}

export function buildAmosChangeDiagnostics(rows, evaluatedAt) {
  const ordered = (rows ?? [])
    .filter((row) => Number.isFinite(row?.obsTimeUtc))
    .sort((left, right) => left.obsTimeUtc - right.obsTimeUtc);
  const latest = [...ordered]
    .reverse()
    .find(
      (row) =>
        Number.isFinite(row.windDirAvg) ||
        Number.isFinite(row.windSpeedAvg) ||
        Number.isFinite(row.dewpointC) ||
        Number.isFinite(row.precipMm),
    );
  const reference = latest
    ? nearestRowAt(ordered, latest.obsTimeUtc - 30 * MILLIS_PER_MINUTE, 15)
    : null;
  const recentRainRows = latest
    ? ordered.filter(
        (row) =>
          row.obsTimeUtc >= latest.obsTimeUtc - 60 * MILLIS_PER_MINUTE &&
          Number.isFinite(row.precipMm),
      )
    : [];
  const rainObservedRecently = recentRainRows.some((row) => row.precipMm > 0);
  const recentTail = recentRainRows.slice(-5);
  const rainNowStopped =
    rainObservedRecently &&
    recentTail.length > 0 &&
    recentTail.every((row) => row.precipMm <= 0);
  return {
    latest,
    reference30m: reference,
    windDirectionShift30mDeg:
      latest &&
      reference &&
      Number.isFinite(latest.windDirAvg) &&
      Number.isFinite(reference.windDirAvg)
        ? roundToTenth(
            circularDifferenceDegrees(latest.windDirAvg, reference.windDirAvg),
          )
        : null,
    windSpeedChange30mKt:
      latest &&
      reference &&
      Number.isFinite(latest.windSpeedAvg) &&
      Number.isFinite(reference.windSpeedAvg)
        ? roundToTenth(latest.windSpeedAvg - reference.windSpeedAvg)
        : null,
    dewpointChange30mC:
      latest &&
      reference &&
      Number.isFinite(latest.dewpointC) &&
      Number.isFinite(reference.dewpointC)
        ? roundToTenth(latest.dewpointC - reference.dewpointC)
        : null,
    rainEndedRecently: rainNowStopped,
    evaluatedAt,
  };
}

export function advanceDecisionState({
  previousState,
  evaluatedAt,
  evaluationSlotUtc,
  observedHighC,
  targetC,
  remainingRuleCeilingC,
  criticalBlockerCount,
  blockerCount,
}) {
  const normalizedTargetC = normalizeDecisionTargetC(targetC);
  let currentState;
  let candidateSinceUtc = null;
  let consecutivePasses = 0;
  const alreadyReached =
    Number.isFinite(observedHighC) && observedHighC >= normalizedTargetC;
  const passes =
    !alreadyReached &&
    criticalBlockerCount === 0 &&
    blockerCount === 0 &&
    Number.isFinite(remainingRuleCeilingC) &&
    remainingRuleCeilingC < normalizedTargetC;

  if (alreadyReached) {
    currentState = "already_reached";
  } else if (criticalBlockerCount > 0) {
    currentState = "insufficient_data";
  } else if (!passes) {
    currentState = "still_possible";
  } else {
    const previousWasPassing =
      Number.isFinite(previousState?.targetC) &&
      normalizeDecisionTargetC(previousState.targetC) === normalizedTargetC &&
      (previousState.currentState === "peak_candidate" ||
        previousState.currentState === "unlikely_to_reach");
    const sameSlot = previousState?.lastEvaluationSlotUtc === evaluationSlotUtc;
    const consecutiveSlot =
      Number.isFinite(previousState?.lastEvaluationSlotUtc) &&
      evaluationSlotUtc - previousState.lastEvaluationSlotUtc ===
        DECISION_INTERVAL_MS;
    if (sameSlot && previousWasPassing) {
      consecutivePasses = previousState.consecutivePasses;
      candidateSinceUtc = previousState.candidateSinceUtc ?? evaluatedAt;
    } else if (previousWasPassing && consecutiveSlot) {
      consecutivePasses = Math.min(3, previousState.consecutivePasses + 1);
      candidateSinceUtc = previousState.candidateSinceUtc ?? evaluatedAt;
    } else {
      // Entering candidate is the start of the 15-minute confirmation clock.
      // The following three consecutive five-minute slots are the confirming
      // checks, so a declaration cannot be issued after only ten minutes.
      consecutivePasses = 0;
      candidateSinceUtc = evaluatedAt;
    }
    const candidateElapsedMs = Number.isFinite(candidateSinceUtc)
      ? evaluatedAt - candidateSinceUtc
      : 0;
    currentState =
      consecutivePasses >= 3 && candidateElapsedMs >= 15 * MILLIS_PER_MINUTE
        ? "unlikely_to_reach"
        : "peak_candidate";
  }

  return {
    targetC: normalizedTargetC,
    currentState,
    candidateSinceUtc,
    consecutivePasses,
    passes,
  };
}
