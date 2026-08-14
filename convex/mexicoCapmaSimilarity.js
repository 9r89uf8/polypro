export const CAPMA_METAR_WINDOW_MS = 2 * 60 * 1000;
export const CAPMA_METAR_TOLERANCE_C = 1;
export const CAPMA_METAR_MINIMUM_REPORTS = 10;
export const CAPMA_LIVE_MAX_AGE_MS = 3 * 60 * 1000;
export const CAPMA_LIVE_MAX_FUTURE_MS = 30 * 1000;

const CAPMA_TDZS = ["05", "23"];

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function candidateWinsTie(candidate, current) {
  const candidateFirstSeen = isFiniteNumber(candidate?.firstSeenAt)
    ? candidate.firstSeenAt
    : Number.POSITIVE_INFINITY;
  const currentFirstSeen = isFiniteNumber(current?.firstSeenAt)
    ? current.firstSeenAt
    : Number.POSITIVE_INFINITY;
  if (candidateFirstSeen !== currentFirstSeen) {
    return candidateFirstSeen < currentFirstSeen;
  }
  return (
    String(candidate?.rawHash ?? "").localeCompare(
      String(current?.rawHash ?? ""),
    ) < 0
  );
}

function liveCapmaRow(row) {
  if (
    !isFiniteNumber(row?.screenTimeUtc) ||
    !isFiniteNumber(row?.fetchCompletedAt) ||
    !isFiniteNumber(row?.currentTempC) ||
    !isFiniteNumber(row?.twoMinuteTempC)
  ) {
    return false;
  }
  const deliveryAgeMs = row.fetchCompletedAt - row.screenTimeUtc;
  return (
    deliveryAgeMs <= CAPMA_LIVE_MAX_AGE_MS &&
    deliveryAgeMs >= -CAPMA_LIVE_MAX_FUTURE_MS
  );
}

export function resolveCapmaComparisonAnchor(metarRow, anchorMode) {
  if (anchorMode === "observation") {
    return isFiniteNumber(metarRow?.obsTimeUtc)
      ? { timeUtc: metarRow.obsTimeUtc, kind: "observation_time" }
      : null;
  }
  if (isFiniteNumber(metarRow?.initialAwcReceiptTimeUtc)) {
    return {
      timeUtc: metarRow.initialAwcReceiptTimeUtc,
      kind: "awc_receipt",
    };
  }
  return isFiniteNumber(metarRow?.firstSeenAt)
    ? { timeUtc: metarRow.firstSeenAt, kind: "first_seen" }
    : null;
}

function summarizeCapmaSample(row, side, anchorTimeUtc, officialTempC) {
  return {
    tdz: row.tdz,
    side,
    screenTimeUtc: row.screenTimeUtc,
    screenTimeLocal: row.screenTimeLocal ?? null,
    offsetSeconds: round((row.screenTimeUtc - anchorTimeUtc) / 1000, 1),
    currentTempC: row.currentTempC,
    twoMinuteTempC: row.twoMinuteTempC,
    currentDeltaC: round(row.currentTempC - officialTempC),
    twoMinuteDeltaC: round(row.twoMinuteTempC - officialTempC),
    rawHash: String(row.rawHash ?? ""),
    ocrConfidence: isFiniteNumber(row.ocrConfidence) ? row.ocrConfidence : null,
  };
}

export function selectCapmaBracket(
  capmaRows,
  tdz,
  anchorTimeUtc,
  officialTempC,
) {
  let before = null;
  let after = null;
  for (const row of capmaRows ?? []) {
    if (row?.tdz !== tdz || !liveCapmaRow(row)) {
      continue;
    }
    const offsetMs = row.screenTimeUtc - anchorTimeUtc;
    if (offsetMs >= -CAPMA_METAR_WINDOW_MS && offsetMs <= 0) {
      if (
        !before ||
        row.screenTimeUtc > before.screenTimeUtc ||
        (row.screenTimeUtc === before.screenTimeUtc &&
          candidateWinsTie(row, before))
      ) {
        before = row;
      }
    }
    if (offsetMs > 0 && offsetMs <= CAPMA_METAR_WINDOW_MS) {
      if (
        !after ||
        row.screenTimeUtc < after.screenTimeUtc ||
        (row.screenTimeUtc === after.screenTimeUtc &&
          candidateWinsTie(row, after))
      ) {
        after = row;
      }
    }
  }
  if (!before || !after) {
    return null;
  }
  return {
    tdz,
    before: summarizeCapmaSample(
      before,
      "before",
      anchorTimeUtc,
      officialTempC,
    ),
    after: summarizeCapmaSample(after, "after", anchorTimeUtc, officialTempC),
  };
}

function latestOfficialReports(metarRows) {
  const latestByObservation = new Map();
  for (const row of metarRows ?? []) {
    if (!isFiniteNumber(row?.obsTimeUtc)) {
      continue;
    }
    const key = `${row.stationIcao ?? ""}:${row.obsTimeUtc}:${row.reportType ?? "METAR"}`;
    const current = latestByObservation.get(key);
    if (
      !current ||
      (row.firstSeenAt ?? 0) > (current.firstSeenAt ?? 0) ||
      ((row.firstSeenAt ?? 0) === (current.firstSeenAt ?? 0) &&
        Boolean(row.isCorrection) &&
        !current.isCorrection) ||
      ((row.firstSeenAt ?? 0) === (current.firstSeenAt ?? 0) &&
        Boolean(row.isCorrection) === Boolean(current.isCorrection) &&
        String(row.rawHash ?? "").localeCompare(String(current.rawHash ?? "")) >
          0)
    ) {
      latestByObservation.set(key, row);
    }
  }
  return [...latestByObservation.values()].sort(
    (left, right) => left.obsTimeUtc - right.obsTimeUtc,
  );
}

export function compareCapmaToMetarReport({
  metarRow,
  capmaRows,
  anchorMode,
  nowMs,
}) {
  if (!isFiniteNumber(metarRow?.tempC)) {
    return { status: "missing_official_temperature" };
  }
  const anchor = resolveCapmaComparisonAnchor(metarRow, anchorMode);
  if (!anchor) {
    return { status: "missing_anchor" };
  }
  const base = {
    reportKey: String(metarRow.reportKey ?? ""),
    reportType: metarRow.reportType ?? "METAR",
    obsTimeUtc: metarRow.obsTimeUtc,
    obsTimeLocal: metarRow.obsTimeLocal ?? null,
    officialTempC: metarRow.tempC,
    anchorTimeUtc: anchor.timeUtc,
    anchorKind: anchor.kind,
  };
  if (isFiniteNumber(nowMs) && nowMs < anchor.timeUtc + CAPMA_METAR_WINDOW_MS) {
    return { ...base, status: "pending_window" };
  }
  const brackets = CAPMA_TDZS.map((tdz) =>
    selectCapmaBracket(capmaRows, tdz, anchor.timeUtc, metarRow.tempC),
  ).filter(Boolean);
  if (!brackets.length) {
    return { ...base, status: "insufficient_bracket" };
  }
  const samples = brackets.flatMap((bracket) => [
    bracket.before,
    bracket.after,
  ]);
  const currentErrors = samples.map((sample) => Math.abs(sample.currentDeltaC));
  const twoMinuteErrors = samples.map((sample) =>
    Math.abs(sample.twoMinuteDeltaC),
  );
  return {
    ...base,
    status: "comparable",
    brackets,
    tdzCount: brackets.length,
    readingCount: samples.length,
    matchesWithinTolerance: currentErrors.every(
      (error) => error <= CAPMA_METAR_TOLERANCE_C,
    ),
    exactMatch: currentErrors.every((error) => error === 0),
    meanAbsoluteErrorC: round(average(currentErrors)),
    maxAbsoluteErrorC: round(Math.max(...currentErrors)),
    twoMinuteMatchesWithinTolerance: twoMinuteErrors.every(
      (error) => error <= CAPMA_METAR_TOLERANCE_C,
    ),
    twoMinuteMeanAbsoluteErrorC: round(average(twoMinuteErrors)),
  };
}

export function buildCapmaMetarSimilarity({
  metarRows,
  capmaRows,
  anchorMode,
  nowMs,
}) {
  const officialReports = latestOfficialReports(metarRows);
  const comparisons = officialReports.map((metarRow) =>
    compareCapmaToMetarReport({
      metarRow,
      capmaRows,
      anchorMode,
      nowMs,
    }),
  );
  const comparable = comparisons.filter(
    (comparison) => comparison.status === "comparable",
  );
  const matching = comparable.filter(
    (comparison) => comparison.matchesWithinTolerance,
  );
  const exact = comparable.filter((comparison) => comparison.exactMatch);
  const twoMinuteMatching = comparable.filter(
    (comparison) => comparison.twoMinuteMatchesWithinTolerance,
  );
  const currentErrors = comparable.flatMap((comparison) =>
    comparison.brackets.flatMap((bracket) => [
      Math.abs(bracket.before.currentDeltaC),
      Math.abs(bracket.after.currentDeltaC),
    ]),
  );
  const eligibleReportCount = comparable.length;
  const similarityPct = eligibleReportCount
    ? round((matching.length / eligibleReportCount) * 100, 1)
    : null;
  const exactMatchPct = eligibleReportCount
    ? round((exact.length / eligibleReportCount) * 100, 1)
    : null;
  const twoMinuteSimilarityPct = eligibleReportCount
    ? round((twoMinuteMatching.length / eligibleReportCount) * 100, 1)
    : null;
  const maturity =
    eligibleReportCount < CAPMA_METAR_MINIMUM_REPORTS
      ? "collecting"
      : eligibleReportCount < 20
        ? "provisional"
        : "established";
  return {
    anchorMode,
    windowMs: CAPMA_METAR_WINDOW_MS,
    windowMinutes: CAPMA_METAR_WINDOW_MS / 60_000,
    toleranceC: CAPMA_METAR_TOLERANCE_C,
    minimumReports: CAPMA_METAR_MINIMUM_REPORTS,
    maturity,
    distinctOfficialReportCount: officialReports.length,
    officialReportsWithTemperature: comparisons.filter(
      (comparison) => comparison.status !== "missing_official_temperature",
    ).length,
    eligibleReportCount,
    matchingReportCount: matching.length,
    pendingReportCount: comparisons.filter(
      (comparison) => comparison.status === "pending_window",
    ).length,
    insufficientBracketCount: comparisons.filter(
      (comparison) => comparison.status === "insufficient_bracket",
    ).length,
    similarityPct,
    displaySimilarityPct:
      eligibleReportCount >= CAPMA_METAR_MINIMUM_REPORTS ? similarityPct : null,
    exactMatchPct,
    twoMinuteSimilarityPct,
    meanAbsoluteErrorC: round(average(currentErrors)),
    maxAbsoluteErrorC: currentErrors.length
      ? round(Math.max(...currentErrors))
      : null,
    awcReceiptAnchorCount: comparable.filter(
      (comparison) => comparison.anchorKind === "awc_receipt",
    ).length,
    firstSeenAnchorCount: comparable.filter(
      (comparison) => comparison.anchorKind === "first_seen",
    ).length,
    recentComparisons: [...comparable]
      .sort((left, right) => right.anchorTimeUtc - left.anchorTimeUtc)
      .slice(0, 6),
  };
}
