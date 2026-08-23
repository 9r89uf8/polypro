export const REACTION_SIGNAL_OPTIONS = [
  {
    key: "trade",
    label: "Last-trade price",
    shortLabel: "REST-detected last-trade price",
    description: "REST-detected last-trade-price state changes",
  },
  {
    key: "bbo",
    label: "Executable BBO",
    shortLabel: "Best bid / ask",
    description: "Executable Yes bid and ask changes",
  },
  {
    key: "midpoint",
    label: "Midpoint",
    shortLabel: "Book midpoint",
    description: "Arithmetic midpoint of the best bid and ask",
  },
  {
    key: "display",
    label: "Platform display",
    shortLabel: "Platform display",
    description: "Polymarket display rule, with source switches marked",
  },
];

const PRICE_ALIASES = {
  trade: ["lastTradePrice", "lastTradePriceExact", "lastExact", "last"],
  bid: ["bestBidPrice", "bestBidExact", "bestBid", "bidExact", "bid"],
  ask: ["bestAskPrice", "bestAskExact", "bestAsk", "askExact", "ask"],
  midpoint: [
    "midpointPrice",
    "midpointPriceExact",
    "midpointExact",
    "midpoint",
    "midPrice",
  ],
  display: [
    "platformDisplayPrice",
    "displayProbabilityExact",
    "displayProbability",
    "probabilityExact",
    "probability",
    "markPrice",
    "price",
    "gammaOutcomePrice",
  ],
};

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function firstPresent(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function exactString(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return Number.isFinite(value) ? String(value) : null;
}

export function normalizeReactionPrice(value) {
  const raw = exactString(value);
  if (!raw || !/^\d+(?:\.\d+)?%?$/.test(raw)) {
    return null;
  }
  const percent = raw.endsWith("%");
  const unsigned = percent ? raw.slice(0, -1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const cleanWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const cleanFraction = fraction.replace(/0+$/, "");
  const normalized = cleanFraction
    ? `${cleanWhole}.${cleanFraction}`
    : cleanWhole;
  return percent ? `${normalized}%` : normalized;
}

function exactPrice(row, kind) {
  for (const key of PRICE_ALIASES[kind] || []) {
    const value = normalizeReactionPrice(row?.[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function percentFromExact(value) {
  const normalized = normalizeReactionPrice(value);
  if (!normalized) {
    return null;
  }
  const percent = normalized.endsWith("%");
  if (percent) {
    const parsedPercent = Number(normalized.slice(0, -1));
    return Number.isFinite(parsedPercent) ? parsedPercent : null;
  }
  const [whole, fraction = ""] = normalized.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const decimalPlaces = fraction.length - 2;
  const shifted =
    decimalPlaces <= 0
      ? `${digits}${"0".repeat(-decimalPlaces)}`
      : `${digits.padStart(decimalPlaces + 1, "0").slice(0, -decimalPlaces)}.${digits.padStart(decimalPlaces + 1, "0").slice(-decimalPlaces)}`;
  const parsed = Number(shifted);
  return Number.isFinite(parsed) ? parsed : null;
}

export function reactionSignalSnapshot(row, signalKey = "trade") {
  if (
    signalKey === "trade" &&
    row?.lastTradeStatus === "no_trades" &&
    !exactPrice(row, "trade")
  ) {
    return {
      signalKey,
      identity: "no_trades",
      valueExact: null,
      valuePct: null,
      noTrades: true,
    };
  }
  if (signalKey === "bbo") {
    const bidExact = exactPrice(row, "bid");
    const askExact = exactPrice(row, "ask");
    if (!bidExact && !askExact) {
      return null;
    }
    return {
      signalKey,
      identity: `${bidExact || "missing"}|${askExact || "missing"}`,
      bidExact,
      askExact,
      bidPct: percentFromExact(bidExact),
      askPct: percentFromExact(askExact),
    };
  }

  const kind =
    signalKey === "midpoint"
      ? "midpoint"
      : signalKey === "display"
        ? "display"
        : "trade";
  const valueExact = exactPrice(row, kind);
  const valuePct = percentFromExact(valueExact);
  if (!valueExact || !Number.isFinite(valuePct)) {
    return null;
  }
  return {
    signalKey,
    identity: valueExact,
    valueExact,
    valuePct,
    ...(signalKey === "display"
      ? {
          displaySource: String(
            firstPresent(
              row?.platformDisplaySource,
              row?.displaySource,
              "unavailable",
            ),
          ),
        }
      : {}),
  };
}

function signalObservationAt(row, signalKey) {
  if (isSessionOnly(row)) {
    return firstFinite(row?.at);
  }
  if (signalKey === "trade") {
    return firstFinite(row?.lastTradeReceivedAt, row?.at);
  }
  if (signalKey === "bbo" || signalKey === "midpoint") {
    return firstFinite(row?.bookReceivedAt, row?.at);
  }
  return firstFinite(row?.at);
}

function sameMarketContract(left, right) {
  for (const field of ["eventId", "marketId", "yesTokenId"]) {
    const leftValue = firstPresent(left?.[field]);
    const rightValue = firstPresent(right?.[field]);
    if (
      leftValue !== undefined &&
      leftValue !== null &&
      rightValue !== undefined &&
      rightValue !== null &&
      String(leftValue) !== String(rightValue)
    ) {
      return false;
    }
  }
  return true;
}

export function reactionRowMatchesContract(row, selectedContract) {
  const selectedEventId = firstPresent(selectedContract?.eventId);
  const selectedYesTokenId = firstPresent(
    selectedContract?.yesTokenId,
    selectedContract?.outcomeTokenId,
    selectedContract?.tokenId,
  );
  const selectedMarketId = firstPresent(selectedContract?.marketId);
  const selectedConditionId = firstPresent(selectedContract?.conditionId);
  const exact = (actual, expected) =>
    expected === undefined ||
    expected === null ||
    expected === "" ||
    (actual !== undefined &&
      actual !== null &&
      actual !== "" &&
      String(actual) === String(expected));

  if (selectedEventId && selectedYesTokenId) {
    return (
      exact(row?.eventId, selectedEventId) &&
      exact(
        firstPresent(row?.yesTokenId, row?.outcomeTokenId, row?.tokenId),
        selectedYesTokenId,
      )
    );
  }
  if (selectedYesTokenId) {
    return exact(
      firstPresent(row?.yesTokenId, row?.outcomeTokenId, row?.tokenId),
      selectedYesTokenId,
    );
  }
  if (selectedEventId) {
    return (
      exact(row?.eventId, selectedEventId) &&
      exact(row?.marketId, selectedMarketId)
    );
  }
  if (selectedMarketId) {
    return exact(row?.marketId, selectedMarketId);
  }
  if (selectedConditionId) {
    return exact(row?.conditionId, selectedConditionId);
  }
  return true;
}

export function selectReactionSignal(rows, signalKey = "trade") {
  const selected = (rows || [])
    .map((row) => {
      const snapshot = reactionSignalSnapshot(row, signalKey);
      const at = signalObservationAt(row, signalKey);
      return snapshot && Number.isFinite(at)
        ? { ...row, pollAt: row?.at, at, signalKey, snapshot }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.at - right.at);
  if (signalKey !== "trade") {
    return selected;
  }
  let reportedSeen = false;
  let priorPoint = null;
  return selected.filter((point) => {
    if (priorPoint && !sameMarketContract(priorPoint, point)) {
      reportedSeen = false;
    }
    priorPoint = point;
    if (point.snapshot.noTrades) {
      return !reportedSeen;
    }
    reportedSeen = true;
    return true;
  });
}

export function dedupeReactionSignalChanges(points) {
  const changes = [];
  let previousIdentity = null;
  for (const point of [...(points || [])].sort(
    (left, right) => left.at - right.at,
  )) {
    const identity = point?.snapshot?.identity;
    if (!identity || identity === previousIdentity) {
      continue;
    }
    changes.push(point);
    previousIdentity = identity;
  }
  return changes;
}

export function reactionChartSeries(points, signalKey = "trade") {
  const selected = selectReactionSignal(points, signalKey);
  if (signalKey === "bbo") {
    const buildSide = (side, label, color) => {
      const valueKey = `${side}Pct`;
      const exactKey = `${side}Exact`;
      const sidePoints = selected
        .filter((point) => Number.isFinite(point.snapshot?.[valueKey]))
        .map((point) => ({
          ...point,
          probabilityPct: point.snapshot[valueKey],
          probabilityExact: point.snapshot[exactKey],
          snapshot: {
            ...point.snapshot,
            identity: point.snapshot[exactKey],
          },
        }));
      return {
        key: `bbo_${side}`,
        label,
        color,
        points: dedupeReactionSignalChanges(sidePoints),
      };
    };
    return [
      buildSide("bid", "Executable bid", "#b8ff56"),
      buildSide("ask", "Executable ask", "#ff5c7a"),
    ].filter((series) => series.points.length);
  }

  const labels = {
    trade: "REST-detected last-trade price",
    midpoint: "Book midpoint",
    display: "Platform display",
  };
  const colors = {
    trade: "#ffb547",
    midpoint: "#a78bfa",
    display: "#50e3ff",
  };
  return [
    {
      key: signalKey,
      label: labels[signalKey] || labels.trade,
      color: colors[signalKey] || colors.trade,
      points: dedupeReactionSignalChanges(
        selected.map((point) => ({
          ...point,
          probabilityPct: point.snapshot.valuePct,
          probabilityExact: point.snapshot.valueExact,
        })),
      ).filter((point) => Number.isFinite(point.probabilityPct)),
    },
  ];
}

export function platformDisplayTransitions(rows) {
  const selected = selectReactionSignal(rows, "display");
  const transitions = [];
  let prior = null;
  for (const point of selected) {
    const source = point.snapshot.displaySource;
    if (prior && source !== prior.snapshot.displaySource) {
      transitions.push({
        ...point,
        from: prior.snapshot.displaySource,
        to: source,
        probabilityPct: point.snapshot.valuePct,
      });
    }
    prior = point;
  }
  return transitions;
}

function isSessionOnly(row) {
  return (
    row?.sessionOnly === true ||
    row?.browserSessionLive === true ||
    row?.trigger === "browser_websocket" ||
    String(row?.eventType || "").startsWith("browser_")
  );
}

function isHeartbeat(row) {
  return (
    row?.isHeartbeat === true ||
    row?.heartbeat === true ||
    /heartbeat|poll_snapshot/i.test(String(row?.eventType || ""))
  );
}

function reactionDelta(before, after, signalKey) {
  if (!before || !after) {
    return null;
  }
  if (signalKey === "bbo") {
    return {
      bid:
        Number.isFinite(before.bidPct) && Number.isFinite(after.bidPct)
          ? after.bidPct - before.bidPct
          : null,
      ask:
        Number.isFinite(before.askPct) && Number.isFinite(after.askPct)
          ? after.askPct - before.askPct
          : null,
    };
  }
  return Number.isFinite(before.valuePct) && Number.isFinite(after.valuePct)
    ? after.valuePct - before.valuePct
    : null;
}

function signalDetectionBounds(row, signalKey) {
  const heartbeat = isHeartbeat(row);
  const startAt = firstFinite(
    signalKey === "trade" ? row?.lastTradeDetectionStartAt : null,
    signalKey === "bbo" || signalKey === "midpoint"
      ? row?.bookDetectionStartAt
      : null,
    heartbeat && ["trade", "bbo", "midpoint"].includes(signalKey)
      ? null
      : row?.detectionStartAt,
  );
  const endAt = firstFinite(
    signalKey === "trade" ? row?.lastTradeDetectionEndAt : null,
    signalKey === "bbo" || signalKey === "midpoint"
      ? row?.bookDetectionEndAt
      : null,
    row?.detectionEndAt,
    row?.at,
  );
  return {
    startAt,
    endAt,
    kind: Number.isFinite(startAt) ? "bounded" : "left_unbounded",
  };
}

export function buildReactionIntervals(
  sourceEvents,
  quoteRows,
  signalKey = "trade",
) {
  const selectedDurable = selectReactionSignal(
    (quoteRows || []).filter((row) => !isSessionOnly(row)),
    signalKey,
  );
  let currentContractStart = 0;
  for (let index = 1; index < selectedDurable.length; index += 1) {
    if (
      !sameMarketContract(selectedDurable[index - 1], selectedDurable[index])
    ) {
      currentContractStart = index;
    }
  }
  const durable = selectedDurable.slice(currentContractStart);

  const transitions = [];
  for (let index = 1; index < durable.length; index += 1) {
    const priorConfirmation = durable[index - 1];
    const after = durable[index];
    if (!sameMarketContract(priorConfirmation, after)) {
      continue;
    }
    if (after.snapshot.identity === priorConfirmation.snapshot.identity) {
      continue;
    }
    const metricBounds = signalDetectionBounds(after, signalKey);
    const hasPersistedBoundary = [
      after?.detectionIntervalKind,
      after?.detectionStartAt,
      after?.detectionEndAt,
      after?.lastTradeDetectionStartAt,
      after?.lastTradeDetectionEndAt,
      after?.bookDetectionStartAt,
      after?.bookDetectionEndAt,
    ].some((value) => value !== undefined && value !== null);
    const forceLeftCensored =
      after?.legacyLeftCensored === true ||
      (!hasPersistedBoundary && !isHeartbeat(priorConfirmation));
    const persistedKind = hasPersistedBoundary
      ? Number.isFinite(metricBounds.startAt)
        ? "bounded"
        : "left_unbounded"
      : "";
    const persistedStart = metricBounds.startAt;
    const persistedEnd = metricBounds.endAt;
    const leftUnbounded =
      forceLeftCensored ||
      (hasPersistedBoundary && !Number.isFinite(persistedStart));
    const detectionStartAt = leftUnbounded
      ? null
      : firstFinite(persistedStart, priorConfirmation?.at);
    const boundaryEvidence = forceLeftCensored
      ? "legacy_left_censored"
      : persistedKind
        ? `persisted_${persistedKind}`
        : isHeartbeat(priorConfirmation)
          ? "heartbeat_bounded"
          : "legacy_left_censored";
    transitions.push({
      before: priorConfirmation.snapshot,
      after: after.snapshot,
      delta: reactionDelta(
        priorConfirmation.snapshot,
        after.snapshot,
        signalKey,
      ),
      detectionStartAt,
      detectionEndAt: persistedEnd,
      boundaryEvidence,
      firstChangedPoll: after,
      priorConfirmation,
      leftUnbounded,
    });
  }

  return (sourceEvents || [])
    .map((sourceEvent) => {
      const containing = transitions.find(
        (transition) =>
          !transition.leftUnbounded &&
          Number.isFinite(transition.detectionEndAt) &&
          sourceEvent.at <= transition.detectionEndAt &&
          Number.isFinite(transition.detectionStartAt) &&
          transition.detectionStartAt < sourceEvent.at,
      );
      const compatibleAfter = transitions.find(
        (transition) =>
          Number.isFinite(transition.detectionStartAt) &&
          sourceEvent.at <= transition.detectionStartAt,
      );
      const priorTransition = [...transitions]
        .reverse()
        .find(
          (transition) =>
            Number.isFinite(transition.detectionEndAt) &&
            transition.detectionEndAt < sourceEvent.at,
        );
      const leftCensored = transitions.find(
        (transition) =>
          transition.leftUnbounded &&
          Number.isFinite(transition.detectionEndAt) &&
          sourceEvent.at <= transition.detectionEndAt,
      );
      const primary = containing || leftCensored || compatibleAfter || null;

      if (!primary) {
        const baseline = [...durable]
          .reverse()
          .find((observation) => observation.at <= sourceEvent.at);
        return {
          ...sourceEvent,
          intervalStatus: baseline ? "waiting" : "baseline_unavailable",
          ordering: "no_compatible_update_observed",
          before: baseline?.snapshot || null,
          after: null,
          delta: null,
          priorTransition,
        };
      }

      const detectionStartAt = primary.detectionStartAt;
      const detectionEndAt = primary.detectionEndAt;

      return {
        ...sourceEvent,
        intervalStatus: Number.isFinite(detectionEndAt)
          ? primary.leftUnbounded
            ? "left_unbounded"
            : "bounded"
          : "unavailable",
        ordering: containing
          ? "ordering_indeterminate"
          : primary === leftCensored
            ? "left_censored"
            : "compatible_after",
        before: primary.before,
        after: primary.after,
        delta: primary.delta,
        detectionStartAt,
        detectionEndAt,
        detectionStartDelayMs: Number.isFinite(detectionStartAt)
          ? detectionStartAt - sourceEvent.at
          : null,
        detectionEndDelayMs: Number.isFinite(detectionEndAt)
          ? detectionEndAt - sourceEvent.at
          : null,
        boundaryEvidence: primary.boundaryEvidence,
        firstChangedPoll: primary.firstChangedPoll,
        priorConfirmation: primary.priorConfirmation,
        priorTransition,
      };
    })
    .reverse();
}

function normalizedSource(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

export function dedupeWeatherSourceEvents(sourceEvents) {
  const deduped = [];
  for (const event of [...(sourceEvents || [])].sort(
    (left, right) => left.at - right.at,
  )) {
    const source = normalizedSource(event?.source);
    const observationAt = firstFinite(event?.obsTimeUtc, event?.measurementAt);
    const correction =
      event?.isCorrection === true || event?.isCorrectionHint === true
        ? "correction"
        : "original";
    const reportKey = firstPresent(event?.reportKey, event?.reportHash);
    const typelessHash = firstPresent(event?.typelessHash);
    const existingIndex = deduped.findIndex((candidate) => {
      const candidateSource = normalizedSource(candidate?.source);
      const candidateObservationAt = firstFinite(
        candidate?.obsTimeUtc,
        candidate?.measurementAt,
      );
      const candidateCorrection =
        candidate?.isCorrection === true || candidate?.isCorrectionHint === true
          ? "correction"
          : "original";
      if (
        source !== candidateSource ||
        event?.at !== candidate?.at ||
        correction !== candidateCorrection ||
        observationAt !== candidateObservationAt
      ) {
        return false;
      }
      const candidateReportKey = firstPresent(
        candidate?.reportKey,
        candidate?.reportHash,
      );
      const candidateTypelessHash = firstPresent(candidate?.typelessHash);
      // An official row and its relay sighting can expose only one of these
      // identifiers, so missing identifiers remain bridgeable. Two explicit,
      // conflicting identifiers represent distinct reports/corrections.
      if (
        reportKey &&
        candidateReportKey &&
        String(reportKey) !== String(candidateReportKey)
      ) {
        return false;
      }
      return !(
        typelessHash &&
        candidateTypelessHash &&
        String(typelessHash) !== String(candidateTypelessHash)
      );
    });
    if (existingIndex >= 0) {
      // Retain the first-observed rail's fields while filling any identity
      // metadata that is present only on its duplicate.
      deduped[existingIndex] = { ...event, ...deduped[existingIndex] };
    } else {
      deduped.push(event);
    }
  }
  return deduped.sort((left, right) => left.at - right.at);
}

function tdzSeriesIdentity(row) {
  const supplied = firstPresent(row?.series, row?.sourceKey);
  if (supplied) {
    return normalizedSource(supplied);
  }
  const suffix = firstPresent(
    row?.tdz,
    String(row?.source || "").match(/tdz\s*0*(\d+)/i)?.[1],
  );
  return suffix === undefined || suffix === null || suffix === ""
    ? ""
    : `capma_tdz_${String(suffix).padStart(2, "0")}`;
}

export function tdzDailySeriesStates(tdzDailyMaximumEvidence, nowMs) {
  const status = String(tdzDailyMaximumEvidence?.status || "unavailable")
    .trim()
    .toLowerCase();
  const approvalRequired = status.endsWith("approval_required");
  const truncated = tdzDailyMaximumEvidence?.truncated === true;
  const liveDate = tdzDailyMaximumEvidence?.liveDate === true;
  const toleranceMs = Number(tdzDailyMaximumEvidence?.coverageToleranceMs);
  return (
    Array.isArray(tdzDailyMaximumEvidence?.series)
      ? tdzDailyMaximumEvidence.series
      : []
  ).map((series) => {
    const key = tdzSeriesIdentity(series);
    const tdz = String(
      firstPresent(series?.tdz, key.match(/(\d+)$/)?.[1], ""),
    ).padStart(2, "0");
    const serverComplete =
      series?.complete === true && series?.status === "complete";
    const coverageEndAt = firstFinite(series?.coverageEndAt);
    const liveCoverageFresh =
      !liveDate ||
      (Number.isFinite(nowMs) &&
        Number.isFinite(coverageEndAt) &&
        Number.isFinite(toleranceMs) &&
        toleranceMs >= 0 &&
        Math.abs(nowMs - coverageEndAt) <= toleranceMs);
    const eligible =
      !approvalRequired && !truncated && serverComplete && liveCoverageFresh;
    const reason = approvalRequired
      ? "approval_required"
      : truncated
        ? "truncated"
        : !serverComplete
          ? "partial"
          : !liveCoverageFresh
            ? "stale"
            : "complete";
    return {
      ...series,
      key,
      label: tdz ? `TDZ ${tdz}` : "TDZ rail",
      serverComplete,
      liveCoverageFresh,
      eligible,
      reason,
    };
  });
}

export function officialDailyMaximumEvidenceComplete(evidence) {
  return (
    evidence?.status === "complete" &&
    evidence?.truncated !== true &&
    evidence?.metarTruncated !== true &&
    evidence?.relayTruncated !== true
  );
}

function matchingTemperature(sourceEvent, temperatures) {
  const reportKeys = new Set(
    [
      sourceEvent?.typelessHash,
      sourceEvent?.reportKey,
      sourceEvent?.reportHash,
      sourceEvent?.rawHash,
    ]
      .filter(Boolean)
      .map(String),
  );
  const observationAt = firstFinite(
    sourceEvent?.obsTimeUtc,
    sourceEvent?.measurementAt,
  );
  const official = (temperatures || []).filter(
    (point) =>
      point?.kind === "official_report" ||
      point?.series === "metar_speci" ||
      /metar|speci/i.test(String(point?.reportType || point?.source || "")),
  );
  const exact = reportKeys.size
    ? official.find((point) =>
        [
          point?.typelessHash,
          point?.reportKey,
          point?.reportHash,
          point?.rawHash,
        ]
          .filter(Boolean)
          .map(String)
          .some((key) => reportKeys.has(key)),
      )
    : null;
  if (exact) {
    return exact;
  }
  return Number.isFinite(observationAt)
    ? official.find(
        (point) =>
          firstFinite(
            point?.obsTimeUtc,
            point?.eventTimeUtc,
            point?.measurementAt,
          ) === observationAt &&
          (!sourceEvent?.reportType ||
            !point?.reportType ||
            sourceEvent.reportType === point.reportType) &&
          (sourceEvent?.isCorrection === undefined ||
            point?.isCorrection === undefined ||
            sourceEvent.isCorrection === point.isCorrection),
      ) || null
    : null;
}

export function firstNewDailyMaximumEvents(
  sourceEvents,
  temperatures,
  { officialDailyMaximumEvidence, tdzDailyMaximumEvidence, nowMs } = {},
) {
  const maxima = new Map();
  const result = [];
  if (officialDailyMaximumEvidenceComplete(officialDailyMaximumEvidence)) {
    for (const event of dedupeWeatherSourceEvents(sourceEvents)) {
      const temperature = matchingTemperature(event, temperatures);
      const tempC = Number.isFinite(event?.tempC)
        ? event.tempC
        : temperature?.tempC;
      if (!Number.isFinite(tempC)) {
        continue;
      }
      const source = normalizedSource(event.source);
      const previousMaxC = maxima.get(source);
      if (!Number.isFinite(previousMaxC) || tempC > previousMaxC) {
        maxima.set(source, tempC);
        result.push({
          ...event,
          tempC,
          previousMaxC: Number.isFinite(previousMaxC) ? previousMaxC : null,
          maximumEvent: true,
        });
      }
    }
  }

  const certifiedSeries = new Set(
    tdzDailySeriesStates(tdzDailyMaximumEvidence, nowMs)
      .filter((series) => series.eligible)
      .map((series) => series.key),
  );
  const certifiedTdzEvents =
    tdzDailyMaximumEvidence?.truncated !== true &&
    Array.isArray(tdzDailyMaximumEvidence?.events)
      ? tdzDailyMaximumEvidence.events
          .filter((event) => certifiedSeries.has(tdzSeriesIdentity(event)))
          .sort((left, right) => left.at - right.at)
      : [];
  for (const point of certifiedTdzEvents) {
    if (!Number.isFinite(point?.tempC) || !Number.isFinite(point?.at)) {
      continue;
    }
    const tdz = String(
      firstPresent(
        point?.tdz,
        String(point?.series || point?.sourceKey || "").match(/(\d+)$/)?.[1],
        "",
      ),
    ).padStart(2, "0");
    const source = `capma_tdz_${tdz}`;
    const previousMaxC = maxima.get(source);
    if (!Number.isFinite(previousMaxC) || point.tempC > previousMaxC) {
      maxima.set(source, point.tempC);
      result.push({
        ...point,
        id: point.id || `maximum-${source}-${point.at}`,
        source: point.source || `CAPMA TDZ ${tdz}`,
        artifact: point.artifact || "whole-degree display",
        tempC: point.tempC,
        previousMaxC: Number.isFinite(previousMaxC) ? previousMaxC : null,
        maximumEvent: true,
      });
    }
  }
  return result.sort((left, right) => left.at - right.at);
}
