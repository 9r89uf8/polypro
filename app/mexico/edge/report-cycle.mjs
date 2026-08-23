export const TDZ_FOCUS_LEAD_MS = 10 * 60 * 1000;
export const ROUTINE_WINDOW_OPEN_MINUTE = 40;
export const ROUTINE_TRANSMISSION_DEADLINE_MINUTE = 56;
export const TEMPERATURE_SPECIAL_THRESHOLD_C = 2;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_RELAY_LAG_MS = 60 * 60 * 1000;

function firstFinite(...values) {
  return values.find(Number.isFinite) ?? null;
}

function earliestFinite(...values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}

function median(values) {
  const sorted = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizedSource(event) {
  return String(event?.source || event?.sourceKey || event?.provider || "")
    .trim()
    .toLowerCase();
}

function sourceRole(event) {
  const source = normalizedSource(event);
  if (source.includes("capma") && source.includes("aftn")) {
    return "capma";
  }
  if (source.includes("noaa")) {
    return "noaa";
  }
  if (source === "awc" || source.includes("aviation_weather")) {
    return "awc";
  }
  return null;
}

function reportIdentity(event) {
  const reportType = String(event?.reportType || event?.artifact || "METAR")
    .trim()
    .toUpperCase();
  const correction = event?.isCorrection === true ? "cor" : "original";
  const strongIdentity =
    event?.typelessHash || event?.reportKey || event?.rawHash || null;
  if (strongIdentity) {
    return `${String(strongIdentity)}:${correction}`;
  }
  const observationAt = firstFinite(
    event?.obsTimeUtc,
    event?.measurementAt,
    event?.captureAt,
  );
  return Number.isFinite(observationAt)
    ? `${reportType}:${observationAt}:${correction}`
    : null;
}

function eventFirstSeenAt(event) {
  return firstFinite(
    event?.firstObservedAt,
    event?.sourceFirstSeenAt,
    event?.observedAt,
    event?.firstSeenAt,
    event?.at,
  );
}

function matchingOfficialTemperature(event, temperaturePoints) {
  if (Number.isFinite(event?.tempC)) {
    return event.tempC;
  }
  const identities = new Set(
    [event?.typelessHash, event?.reportKey, event?.rawHash]
      .filter(Boolean)
      .map(String),
  );
  const officialPoints = (temperaturePoints ?? []).filter(
    (point) =>
      point?.series === "metar_speci" ||
      point?.kind === "official_report" ||
      /metar|speci/i.test(String(point?.reportType || point?.source || "")),
  );
  const identityMatch = identities.size
    ? officialPoints.find((point) =>
        [point?.typelessHash, point?.reportKey, point?.rawHash]
          .filter(Boolean)
          .map(String)
          .some((identity) => identities.has(identity)),
      )
    : null;
  if (Number.isFinite(identityMatch?.tempC)) {
    return identityMatch.tempC;
  }
  const observationAt = firstFinite(
    event?.obsTimeUtc,
    event?.measurementAt,
    event?.captureAt,
  );
  const reportType = String(event?.reportType || event?.artifact || "")
    .trim()
    .toUpperCase();
  const fallback = officialPoints.find(
    (point) =>
      firstFinite(
        point?.obsTimeUtc,
        point?.eventTimeUtc,
        point?.measurementAt,
        point?.at,
      ) === observationAt &&
      (!reportType ||
        !point?.reportType ||
        String(point.reportType).toUpperCase() === reportType) &&
      (event?.isCorrection === undefined ||
        point?.isCorrection === undefined ||
        event.isCorrection === point.isCorrection),
  );
  return Number.isFinite(fallback?.tempC) ? fallback.tempC : null;
}

function routineWindowForObservation(observationAt) {
  if (!Number.isFinite(observationAt)) {
    return { startAt: null, deadlineAt: null };
  }
  let hourStartAt = Math.floor(observationAt / HOUR_MS) * HOUR_MS;
  if (observationAt - hourStartAt < ROUTINE_WINDOW_OPEN_MINUTE * MINUTE_MS) {
    hourStartAt -= HOUR_MS;
  }
  return {
    startAt: hourStartAt + ROUTINE_WINDOW_OPEN_MINUTE * MINUTE_MS,
    deadlineAt: hourStartAt + ROUTINE_TRANSMISSION_DEADLINE_MINUTE * MINUTE_MS,
  };
}

export function buildOfficialReportCycles(events, temperaturePoints = []) {
  const grouped = new Map();
  for (const event of events ?? []) {
    const reportType = String(event?.reportType || event?.artifact || "")
      .trim()
      .toUpperCase();
    const role = sourceRole(event);
    const identity = reportIdentity(event);
    const firstSeenAt = eventFirstSeenAt(event);
    if (
      !["METAR", "SPECI"].includes(reportType) ||
      !role ||
      !identity ||
      !Number.isFinite(firstSeenAt)
    ) {
      continue;
    }
    const current = grouped.get(identity) ?? {
      id: identity,
      reportType,
      isCorrection: event?.isCorrection === true,
      obsTimeUtc: firstFinite(event?.obsTimeUtc, event?.measurementAt),
      tempC: matchingOfficialTemperature(event, temperaturePoints),
      capmaAt: null,
      noaaAt: null,
      awcAt: null,
    };
    current.obsTimeUtc = firstFinite(
      current.obsTimeUtc,
      event?.obsTimeUtc,
      event?.measurementAt,
    );
    current.tempC = firstFinite(
      current.tempC,
      matchingOfficialTemperature(event, temperaturePoints),
    );
    const key = `${role}At`;
    current[key] = Number.isFinite(current[key])
      ? Math.min(current[key], firstSeenAt)
      : firstSeenAt;
    grouped.set(identity, current);
  }
  return [...grouped.values()]
    .map((cycle) => {
      const routineWindow = routineWindowForObservation(cycle.obsTimeUtc);
      return {
        ...cycle,
        firstReportAt: earliestFinite(cycle.capmaAt, cycle.noaaAt, cycle.awcAt),
        routineWindowStartAt: routineWindow.startAt,
        transmissionDeadlineAt: routineWindow.deadlineAt,
        noaaRelayLagMs:
          Number.isFinite(cycle.capmaAt) &&
          Number.isFinite(cycle.noaaAt) &&
          cycle.noaaAt >= cycle.capmaAt
            ? cycle.noaaAt - cycle.capmaAt
            : null,
      };
    })
    .sort(
      (left, right) =>
        firstFinite(left.obsTimeUtc, left.firstReportAt, 0) -
          firstFinite(right.obsTimeUtc, right.firstReportAt, 0) ||
        firstFinite(left.firstReportAt, 0) -
          firstFinite(right.firstReportAt, 0),
    );
}

export function buildRoutineReportCycles(events, temperaturePoints = []) {
  return buildOfficialReportCycles(events, temperaturePoints).filter(
    (cycle) => cycle.reportType === "METAR" && cycle.isCorrection !== true,
  );
}

export function buildOperationalRoutineClock(nowMs) {
  if (!Number.isFinite(nowMs)) {
    return null;
  }
  const hourStartAt = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const thisWindow = {
    startAt: hourStartAt + ROUTINE_WINDOW_OPEN_MINUTE * MINUTE_MS,
    deadlineAt: hourStartAt + ROUTINE_TRANSMISSION_DEADLINE_MINUTE * MINUTE_MS,
  };
  const previousWindow = {
    startAt: thisWindow.startAt - HOUR_MS,
    deadlineAt: thisWindow.deadlineAt - HOUR_MS,
  };
  const followingWindow = {
    startAt: thisWindow.startAt + HOUR_MS,
    deadlineAt: thisWindow.deadlineAt + HOUR_MS,
  };
  const beforeWindow = nowMs < thisWindow.startAt;
  const active = nowMs >= thisWindow.startAt && nowMs <= thisWindow.deadlineAt;
  const cycleWindow = beforeWindow ? previousWindow : thisWindow;
  const displayWindow = active
    ? thisWindow
    : beforeWindow
      ? thisWindow
      : followingWindow;
  return {
    active,
    beforeWindow,
    afterDeadline: nowMs > thisWindow.deadlineAt,
    cycleWindow,
    displayWindow,
    nextWindow: beforeWindow ? thisWindow : followingWindow,
  };
}

function reportAvailableAt(report) {
  return firstFinite(
    report?.firstReportAt,
    report?.capmaAt,
    report?.noaaAt,
    report?.awcAt,
  );
}

export function classifyTdzPoint({
  point,
  officialReports,
  routineCycles,
  expectedCapmaAt,
  windowStartAt,
  windowEndAt,
  nowMs,
  focusLeadMs = TDZ_FOCUS_LEAD_MS,
}) {
  const at = firstFinite(point?.at, point?.firstObservedAt, point?.observedAt);
  const measurementAt = firstFinite(
    point?.measurementAt,
    point?.screenTimeUtc,
    at,
  );
  if (!Number.isFinite(at) || !Number.isFinite(point?.tempC)) {
    return {
      role: "context",
      baselineReport: null,
      temperatureRiseC: null,
      specialTemperatureCriterionReached: false,
    };
  }
  if (
    isTdzPointInFocus({
      at,
      cycles: routineCycles,
      expectedCapmaAt,
      windowStartAt,
      windowEndAt,
      nowMs,
      focusLeadMs,
    })
  ) {
    return {
      role: "routine_lead",
      baselineReport: null,
      temperatureRiseC: null,
      specialTemperatureCriterionReached: false,
    };
  }
  const baselineReport = [...(officialReports ?? [])]
    .filter(
      (report) =>
        Number.isFinite(report?.tempC) &&
        Number.isFinite(report?.obsTimeUtc) &&
        report.obsTimeUtc < measurementAt &&
        Number.isFinite(reportAvailableAt(report)) &&
        reportAvailableAt(report) <= at,
    )
    .sort(
      (left, right) =>
        right.obsTimeUtc - left.obsTimeUtc ||
        reportAvailableAt(right) - reportAvailableAt(left),
    )[0];
  if (!baselineReport) {
    return {
      role: "context",
      baselineReport: null,
      temperatureRiseC: null,
      specialTemperatureCriterionReached: false,
    };
  }
  const temperatureRiseC = point.tempC - baselineReport.tempC;
  const specialTemperatureCriterionReached =
    temperatureRiseC >= TEMPERATURE_SPECIAL_THRESHOLD_C;
  return {
    role: specialTemperatureCriterionReached
      ? "special_criterion"
      : "special_watch",
    baselineReport,
    temperatureRiseC,
    specialTemperatureCriterionReached,
  };
}

export function buildRelayLagModel(relayRace, cycles) {
  const summary = relayRace?.race?.metar;
  if (
    Number.isFinite(summary?.medianCapmaLeadSeconds) &&
    summary.medianCapmaLeadSeconds >= 0 &&
    Number(summary?.decisiveReportCount) > 0
  ) {
    return {
      available: true,
      medianLagMs: summary.medianCapmaLeadSeconds * 1000,
      sampleCount: summary.decisiveReportCount,
      resolutionSeconds: relayRace?.race?.measurementResolutionSeconds ?? 60,
      basis: "valid paired CAPMA/NOAA report races",
    };
  }
  const lags = (cycles ?? [])
    .map((cycle) => cycle.noaaRelayLagMs)
    .filter(
      (lag) => Number.isFinite(lag) && lag >= 0 && lag <= MAX_RELAY_LAG_MS,
    );
  const medianLagMs = median(lags);
  return Number.isFinite(medianLagMs)
    ? {
        available: true,
        medianLagMs,
        sampleCount: lags.length,
        resolutionSeconds: relayRace?.race?.measurementResolutionSeconds ?? 60,
        basis: "descriptive matched CAPMA/NOAA receipts",
      }
    : {
        available: false,
        medianLagMs: null,
        sampleCount: 0,
        resolutionSeconds:
          relayRace?.race?.measurementResolutionSeconds ?? null,
        basis: "insufficient matched relay history",
      };
}

export function deriveReportCycleState({
  nowMs,
  cycles,
  officialReports = cycles,
  latestTdz = null,
  clock,
  relayLagModel,
}) {
  const operationalClock = buildOperationalRoutineClock(nowMs);
  const expectedCapmaAt = firstFinite(clock?.centerAt, clock?.windowCenterAt);
  const windowStartAt = operationalClock?.displayWindow?.startAt ?? null;
  const windowEndAt = operationalClock?.displayWindow?.deadlineAt ?? null;
  const focusStartAt = windowStartAt;
  const latestCycle = [...(cycles ?? [])]
    .filter(
      (cycle) => Number.isFinite(cycle?.capmaAt) && cycle.capmaAt <= nowMs,
    )
    .sort((left, right) => right.capmaAt - left.capmaAt)[0];
  const latestOfficialReport = [...(officialReports ?? [])]
    .filter(
      (report) =>
        Number.isFinite(report?.tempC) &&
        Number.isFinite(report?.obsTimeUtc) &&
        Number.isFinite(reportAvailableAt(report)) &&
        reportAvailableAt(report) <= nowMs,
    )
    .sort(
      (left, right) =>
        right.obsTimeUtc - left.obsTimeUtc ||
        reportAvailableAt(right) - reportAvailableAt(left),
    )[0];
  const cycleForOperationalWindow = [...(cycles ?? [])]
    .filter(
      (cycle) =>
        Number.isFinite(cycle?.routineWindowStartAt) &&
        cycle.routineWindowStartAt === operationalClock?.cycleWindow?.startAt,
    )
    .sort(
      (left, right) =>
        firstFinite(right.capmaAt, right.firstReportAt, 0) -
        firstFinite(left.capmaAt, left.firstReportAt, 0),
    )[0];
  const relayEtaAt =
    latestCycle &&
    !Number.isFinite(latestCycle.noaaAt) &&
    Number.isFinite(relayLagModel?.medianLagMs)
      ? latestCycle.capmaAt + relayLagModel.medianLagMs
      : null;
  const relayPending =
    latestCycle &&
    latestCycle.routineWindowStartAt ===
      operationalClock?.cycleWindow?.startAt &&
    !Number.isFinite(latestCycle.noaaAt) &&
    nowMs - latestCycle.capmaAt <= MAX_RELAY_LAG_MS;
  const latestTdzAssessment = classifyTdzPoint({
    point: latestTdz,
    officialReports,
    routineCycles: cycles,
    expectedCapmaAt,
    windowStartAt,
    windowEndAt,
    nowMs,
  });
  const base = {
    expectedCapmaAt,
    focusStartAt,
    windowStartAt,
    windowEndAt,
    routineWindowActive: operationalClock?.active === true,
    transmissionDeadlineAt: operationalClock?.displayWindow?.deadlineAt ?? null,
    nextWindowStartAt: operationalClock?.nextWindow?.startAt ?? null,
    nextWindowDeadlineAt: operationalClock?.nextWindow?.deadlineAt ?? null,
    latestCycle,
    latestOfficialReport: latestOfficialReport ?? null,
    cycleForOperationalWindow: cycleForOperationalWindow ?? null,
    relayEtaAt,
    latestTdz,
    latestTdzAssessment,
    specialTemperatureCriterionReached:
      latestTdzAssessment.specialTemperatureCriterionReached,
    temperatureRiseC: latestTdzAssessment.temperatureRiseC,
  };

  if (relayPending) {
    return {
      ...base,
      phase: "waiting_noaa",
      tone: latestTdzAssessment.specialTemperatureCriterionReached
        ? "danger"
        : "watch",
      title: "CAPMA report received · awaiting NOAA relay",
      detail:
        "The official report is already known; NOAA is a downstream relay. TDZ05 now monitors the next report and special-condition changes.",
      targetLabel: Number.isFinite(relayEtaAt)
        ? "estimated NOAA relay"
        : "NOAA relay",
      targetAt: relayEtaAt,
      tdzMode: "special_watch",
      tdzActionable: true,
    };
  }

  if (operationalClock?.active && !cycleForOperationalWindow?.capmaAt) {
    return {
      ...base,
      phase: "routine_window",
      tone: "live",
      title: "Routine observation window is open",
      detail:
        "SENEAM procedure starts the hourly observation at :40 and requires transmission by :56. TDZ05 is an unconfirmed lead until the report is transmitted.",
      targetLabel: "transmission deadline · :56",
      targetAt: operationalClock.displayWindow.deadlineAt,
      tdzMode: "routine_lead",
      tdzActionable: true,
    };
  }

  if (operationalClock?.afterDeadline && !cycleForOperationalWindow?.capmaAt) {
    return {
      ...base,
      phase: "capma_overdue",
      tone: "danger",
      title: "The :56 transmission deadline has passed",
      detail:
        "No CAPMA routine report from this operational window has been observed by this deployment. It may be delayed, missed by the collector, or unavailable.",
      targetLabel: "deadline overdue",
      targetAt: operationalClock.cycleWindow.deadlineAt,
      tdzMode: "routine_lead",
      tdzActionable: true,
    };
  }

  return {
    ...base,
    phase: latestCycle?.noaaAt ? "post_report_watch" : "waiting_window",
    tone: latestTdzAssessment.specialTemperatureCriterionReached
      ? "danger"
      : "neutral",
    title: latestTdzAssessment.specialTemperatureCriterionReached
      ? "TDZ05 reached the +2°C special criterion"
      : "Waiting for the next :40 observation window",
    detail:
      "TDZ05 remains active for the next routine report and for the temperature special-condition watch. Reaching +2°C does not guarantee a publicly distributed SPECI.",
    targetLabel: "routine window opens · :40",
    targetAt: operationalClock?.nextWindow?.startAt ?? null,
    tdzMode: "special_watch",
    tdzActionable: true,
  };
}

export function isTdzPointInFocus({
  at,
  cycles,
  expectedCapmaAt,
  windowStartAt,
  windowEndAt,
  nowMs,
  focusLeadMs = TDZ_FOCUS_LEAD_MS,
}) {
  if (!Number.isFinite(at)) {
    return false;
  }
  for (const cycle of cycles ?? []) {
    if (
      Number.isFinite(cycle?.capmaAt) &&
      at >= cycle.capmaAt - focusLeadMs &&
      at < cycle.capmaAt
    ) {
      return true;
    }
  }
  if (
    Number.isFinite(windowStartAt) &&
    Number.isFinite(windowEndAt) &&
    Number.isFinite(nowMs) &&
    nowMs >= windowStartAt &&
    nowMs <= windowEndAt
  ) {
    const reportAt = [...(cycles ?? [])]
      .filter(
        (cycle) =>
          cycle?.routineWindowStartAt === windowStartAt &&
          Number.isFinite(cycle?.capmaAt),
      )
      .map((cycle) => cycle.capmaAt)
      .sort((left, right) => left - right)[0];
    return (
      at >= windowStartAt &&
      (Number.isFinite(reportAt) ? at < reportAt : at <= nowMs)
    );
  }
  return (
    Number.isFinite(expectedCapmaAt) &&
    Number.isFinite(nowMs) &&
    at >= expectedCapmaAt - focusLeadMs &&
    at <= nowMs &&
    nowMs < expectedCapmaAt + focusLeadMs
  );
}
