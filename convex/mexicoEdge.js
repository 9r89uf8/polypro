import { internalMutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import {
  CAPMA_AFTN_SOURCE,
  formatMexicoDate,
  NOAA_TEXT_SOURCE,
  publicMetarRowsForCapmaApproval,
} from "./mexico.js";
import {
  capmaAftnAccessApproved,
  capmaTdzApprovalState,
} from "./mexicoCapmaApprovals.js";
import { mexicoEdgeFastWatchGateState } from "./mexicoCapmaApprovals.js";
import {
  buildForecastRevision,
  buildSpeciClock,
  estimateRoutineMetarWindow,
} from "./mexicoEdgeTiming.js";

const STATION_ICAO = "MMMX";
const MEXICO_TIMEZONE = "America/Mexico_City";
const MAX_DAY_METARS = 160;
const MAX_HISTORY_METARS_PER_DAY = 96;
const MAX_CAPMA_ROWS = 900;
const MAX_CAPMA_DAY_ROWS = 6_000;
const MAX_REACTION_CAPMA_ROWS = 1_800;
const MAX_RELAY_SIGHTINGS = 300;
const MAX_SOURCE_EVENTS = 700;
const CAPMA_COVERAGE_GAP_MS = 5 * 60 * 1000;

const mexicoDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MEXICO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getDateParts(formatter, epochMs) {
  const values = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatMexicoDateTime(epochMs) {
  const parts = getDateParts(mexicoDateTimeFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function toFahrenheit(celsius) {
  return Math.round(((celsius * 9) / 5 + 32) * 10) / 10;
}

function assertStation(value) {
  const stationIcao = String(value ?? STATION_ICAO)
    .trim()
    .toUpperCase();
  if (stationIcao !== STATION_ICAO) {
    throw new Error("The Mexico edge dashboard supports MMMX only.");
  }
  return stationIcao;
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error("Date must be a real calendar date.");
  }
  return value;
}

function shiftDateKey(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12))
    .toISOString()
    .slice(0, 10);
}

function mexicoMidnightUtc(date) {
  const [year, month, day] = date.split("-").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let candidate = Date.UTC(year, month - 1, day, 6);
  // Convert a wall-clock midnight in America/Mexico_City without assuming a
  // fixed historical UTC offset. Two iterations are sufficient around an
  // offset transition; the third is a defensive convergence pass.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = getDateParts(mexicoDateTimeFormatter, candidate);
    const representedLocalAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate += targetAsUtc - representedLocalAsUtc;
  }
  return candidate;
}

function exactTrue(value) {
  return value === "true";
}

export function capmaEdgePublicationGates(env = process.env) {
  const { accessApproved, retentionApproved, republicationApproved } =
    capmaTdzApprovalState(env);
  return {
    accessApproved,
    retentionApproved,
    republicationApproved,
    visible: accessApproved && retentionApproved && republicationApproved,
  };
}

export function sanitizeCapmaPublicPayload(payload, gates) {
  if (gates?.visible === true) {
    return payload;
  }
  return {
    rows: [],
    latestImages: { "05": null, 23: null },
  };
}

export function weatherCompanyResolutionStatus(env = process.env) {
  const accessApproved = exactTrue(env.TWC_MMMX_RES_ACCESS_APPROVED);
  const retentionApproved = exactTrue(env.TWC_MMMX_RES_RETENTION_APPROVED);
  const republicationApproved = exactTrue(env.TWC_MMMX_RES_PUBLIC_APPROVED);
  const approvalsComplete =
    accessApproved && retentionApproved && republicationApproved;
  return {
    source: "weather_underground_mmmx_daily_observations",
    status: approvalsComplete ? "setup_required" : "approval_required",
    accessApproved,
    retentionApproved,
    republicationApproved,
    interfaceConfigured: false,
    lastObservation: null,
    explanation: approvalsComplete
      ? "Approvals are present, but no owner-supported Weather Company acquisition interface is configured."
      : "Exact-true Weather Company access, retention, and republication approvals are required.",
  };
}

function highestByTemperature(rows) {
  return rows.reduce((highest, row) => {
    if (!Number.isFinite(row?.tempC)) {
      return highest;
    }
    if (
      !highest ||
      row.tempC > highest.tempC ||
      (row.tempC === highest.tempC && row.obsTimeUtc > highest.obsTimeUtc)
    ) {
      return row;
    }
    return highest;
  }, null);
}

function buildSnapshot({
  stationIcao,
  date,
  source,
  sourceInputKey,
  sourceLabel,
  sourceIssuedAt,
  sourceCapturedAt,
  forecastHighC,
  forecastPeakTimeUtc,
  forecastPeakTimeLocal,
}) {
  return {
    stationIcao,
    date,
    source,
    snapshotKey: `${source}:${sourceInputKey}:${date}`,
    sourceInputKey,
    sourceLabel,
    ...(Number.isFinite(sourceIssuedAt) ? { sourceIssuedAt } : {}),
    sourceCapturedAt,
    forecastHighC,
    forecastHighF: toFahrenheit(forecastHighC),
    ...(Number.isFinite(forecastPeakTimeUtc) ? { forecastPeakTimeUtc } : {}),
    ...(forecastPeakTimeLocal ? { forecastPeakTimeLocal } : {}),
  };
}

export function deriveTafHighSnapshots(captures, requestedDate) {
  const snapshots = [];
  for (const capture of captures ?? []) {
    if (
      !capture?.tafKey ||
      !Number.isFinite(capture?.issueTimeUtc) ||
      !Number.isFinite(capture?.firstSeenAt)
    ) {
      continue;
    }
    const byDate = new Map();
    for (const group of capture.temperatureGroups ?? []) {
      if (
        group?.kind !== "maximum" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(group?.date ?? "") ||
        !Number.isFinite(group?.tempC) ||
        (requestedDate && group.date !== requestedDate)
      ) {
        continue;
      }
      const current = byDate.get(group.date);
      if (
        !current ||
        group.tempC > current.tempC ||
        (group.tempC === current.tempC &&
          group.forecastTimeUtc < current.forecastTimeUtc)
      ) {
        byDate.set(group.date, group);
      }
    }
    for (const [date, group] of byDate) {
      snapshots.push(
        buildSnapshot({
          stationIcao: capture.stationIcao ?? STATION_ICAO,
          date,
          source: "taf_tx",
          sourceInputKey: capture.tafKey,
          sourceLabel: "MMMX TAF TX · Aviation Weather Center",
          sourceIssuedAt: capture.issueTimeUtc,
          sourceCapturedAt: capture.firstSeenAt,
          forecastHighC: group.tempC,
          forecastPeakTimeUtc: group.forecastTimeUtc,
          forecastPeakTimeLocal: group.forecastTimeLocal,
        }),
      );
    }
  }
  return snapshots;
}

function normalizeSmnSnapshotRow(rawRow) {
  if (
    String(rawRow?.ides ?? "") !== "9" ||
    String(rawRow?.idmun ?? "") !== "17" ||
    String(rawRow?.nmun ?? "") !== "Venustiano Carranza"
  ) {
    return null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})$/.exec(
    String(rawRow?.hloc ?? ""),
  );
  if (
    rawRow?.dh === null ||
    rawRow?.dh === undefined ||
    String(rawRow.dh).trim() === "" ||
    rawRow?.temp === null ||
    rawRow?.temp === undefined ||
    String(rawRow.temp).trim() === ""
  ) {
    return null;
  }
  const offsetHours = Number(rawRow?.dh);
  const tempC = Number(rawRow?.temp);
  if (
    !match ||
    !Number.isInteger(offsetHours) ||
    offsetHours < -14 ||
    offsetHours > 14 ||
    !Number.isFinite(tempC)
  ) {
    return null;
  }
  const localClockUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
  );
  const check = new Date(localClockUtc);
  if (
    check.getUTCFullYear() !== Number(match[1]) ||
    check.getUTCMonth() !== Number(match[2]) - 1 ||
    check.getUTCDate() !== Number(match[3]) ||
    check.getUTCHours() !== Number(match[4])
  ) {
    return null;
  }
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    tempC: Math.round(tempC * 10) / 10,
    forecastTimeUtc: localClockUtc + offsetHours * 60 * 60 * 1000,
    forecastTimeLocal: `${match[1]}-${match[2]}-${match[3]} ${match[4]}:00:00`,
  };
}

export function deriveSmnHighSnapshots(captures, requestedDate) {
  const snapshots = [];
  for (const capture of captures ?? []) {
    if (
      !capture?.rawHash ||
      !Number.isFinite(capture?.capturedAt) ||
      typeof capture?.rawMunicipalityRows !== "string"
    ) {
      continue;
    }
    let rawRows;
    try {
      rawRows = JSON.parse(capture.rawMunicipalityRows);
    } catch {
      continue;
    }
    if (!Array.isArray(rawRows) || rawRows.length > 1_000) {
      continue;
    }
    const byDate = new Map();
    for (const rawRow of rawRows) {
      const row = normalizeSmnSnapshotRow(rawRow);
      if (!row || (requestedDate && row.date !== requestedDate)) {
        continue;
      }
      const current = byDate.get(row.date);
      if (
        !current ||
        row.tempC > current.tempC ||
        (row.tempC === current.tempC &&
          row.forecastTimeUtc < current.forecastTimeUtc)
      ) {
        byDate.set(row.date, row);
      }
    }
    for (const [date, row] of byDate) {
      snapshots.push(
        buildSnapshot({
          stationIcao: capture.stationIcao ?? STATION_ICAO,
          date,
          source: "smn_municipal_hourly",
          sourceInputKey: capture.rawHash,
          sourceLabel:
            "SMN/CONAGUA Venustiano Carranza municipal guidance · 4.8 km from MMMX",
          sourceIssuedAt: capture.sourceLastModifiedAt,
          sourceCapturedAt: capture.capturedAt,
          forecastHighC: row.tempC,
          forecastPeakTimeUtc: row.forecastTimeUtc,
          forecastPeakTimeLocal: row.forecastTimeLocal,
        }),
      );
    }
  }
  return snapshots;
}

async function captureForecastHighSnapshotsHandler(ctx, args) {
  const stationIcao = assertStation(args.stationIcao);
  const date = args.date === undefined ? undefined : assertDate(args.date);
  const [tafCaptures, smnCaptures] = await Promise.all([
    ctx.db
      .query("mexicoTafForecasts")
      .withIndex("by_station_issue_time", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .order("desc")
      .take(date ? 80 : 12),
    ctx.db
      .query("mexicoSmnForecastCaptures")
      .withIndex("by_station_captured_at", (query) =>
        query.eq("stationIcao", stationIcao),
      )
      .order("desc")
      .take(date ? 40 : 4),
  ]);
  const candidates = [
    ...deriveTafHighSnapshots(tafCaptures, date),
    ...deriveSmnHighSnapshots(smnCaptures, date),
  ];
  const uniqueCandidates = [
    ...new Map(candidates.map((row) => [row.snapshotKey, row])).values(),
  ].slice(0, 300);
  const existingKeys = new Set();
  for (const candidateDate of new Set(
    uniqueCandidates.map((row) => row.date),
  )) {
    const rows = await ctx.db
      .query("mexicoEdgeForecastHighSnapshots")
      .withIndex("by_station_date_source_capture", (query) =>
        query.eq("stationIcao", stationIcao).eq("date", candidateDate),
      )
      .take(600);
    for (const row of rows) {
      existingKeys.add(row.snapshotKey);
    }
  }
  let insertedCount = 0;
  let existingCount = 0;
  for (const candidate of uniqueCandidates) {
    if (existingKeys.has(candidate.snapshotKey)) {
      existingCount += 1;
      continue;
    }
    await ctx.db.insert("mexicoEdgeForecastHighSnapshots", {
      ...candidate,
      createdAt: Date.now(),
    });
    insertedCount += 1;
  }
  return {
    status: "ok",
    stationIcao,
    date: date ?? null,
    candidateCount: uniqueCandidates.length,
    insertedCount,
    existingCount,
  };
}

const forecastCaptureArgs = {
  stationIcao: v.optional(v.string()),
  date: v.optional(v.string()),
};

export const captureForecastHighSnapshotsInternal = internalMutationGeneric({
  args: forecastCaptureArgs,
  handler: captureForecastHighSnapshotsHandler,
});

export function buildSourceEvents(metarRows, relaySightings, capmaApproved) {
  const events = [];
  const identities = new Set();
  const reportsByTypelessHash = new Map(
    metarRows
      .filter((row) => row.typelessHash)
      .map((row) => [row.typelessHash, row]),
  );
  const reportsByObservation = new Map(
    metarRows.map((row) => [`${row.obsTimeUtc}:${row.reportType ?? ""}`, row]),
  );
  const push = (event) => {
    const identity = [
      event.source,
      event.obsTimeUtc,
      event.typelessHash ?? event.reportKey ?? "",
      event.firstObservedAt,
    ].join(":");
    if (!identities.has(identity)) {
      identities.add(identity);
      events.push(event);
    }
  };
  for (const row of metarRows) {
    if (Number.isFinite(row.firstAwcSeenAt)) {
      push({
        source: "awc",
        reportKey: row.reportKey,
        ...(row.rawHash ? { rawHash: row.rawHash } : {}),
        ...(row.typelessHash ? { typelessHash: row.typelessHash } : {}),
        obsTimeUtc: row.obsTimeUtc,
        measurementAt: row.obsTimeUtc,
        reportType: row.reportType,
        isCorrection: row.isCorrection === true,
        ...(Number.isFinite(row.tempC) ? { tempC: row.tempC } : {}),
        ...(Number.isFinite(row.tempF) ? { tempF: row.tempF } : {}),
        firstObservedAt: row.firstAwcSeenAt,
        sourceFirstSeenAt: row.firstAwcSeenAt,
        fetchStartedAt: row.firstAwcFetchStartedAt ?? null,
        fetchCompletedAt: row.firstAwcSeenAt,
        providerReceiptTimeUtc: row.initialAwcReceiptTimeUtc ?? null,
        pollingResolutionSeconds: 60,
      });
    }
    if (
      row.firstSource &&
      row.firstSource !== "awc" &&
      (capmaApproved || row.firstSource !== CAPMA_AFTN_SOURCE)
    ) {
      push({
        source: row.firstSource,
        reportKey: row.reportKey,
        ...(row.rawHash ? { rawHash: row.rawHash } : {}),
        ...(row.typelessHash ? { typelessHash: row.typelessHash } : {}),
        obsTimeUtc: row.obsTimeUtc,
        measurementAt: row.obsTimeUtc,
        reportType: row.reportType,
        isCorrection: row.isCorrection === true,
        ...(Number.isFinite(row.tempC) ? { tempC: row.tempC } : {}),
        ...(Number.isFinite(row.tempF) ? { tempF: row.tempF } : {}),
        firstObservedAt: row.firstSeenAt,
        sourceFirstSeenAt: row.firstSeenAt,
        fetchStartedAt: row.fetchStartedAt,
        fetchCompletedAt: row.fetchCompletedAt,
        pollingResolutionSeconds: null,
      });
    }
  }
  for (const sighting of relaySightings) {
    if (!capmaApproved && sighting.source === CAPMA_AFTN_SOURCE) {
      continue;
    }
    const matchedReport =
      reportsByTypelessHash.get(sighting.typelessHash) ??
      reportsByObservation.get(
        `${sighting.obsTimeUtc}:${sighting.reportTypeHint ?? ""}`,
      );
    push({
      source: sighting.source,
      ...(matchedReport?.reportKey
        ? { reportKey: matchedReport.reportKey }
        : {}),
      obsTimeUtc: sighting.obsTimeUtc,
      measurementAt: sighting.obsTimeUtc,
      reportType: sighting.reportTypeHint ?? null,
      isCorrection: sighting.isCorrectionHint ?? false,
      typelessHash: sighting.typelessHash,
      ...(Number.isFinite(matchedReport?.tempC)
        ? { tempC: matchedReport.tempC }
        : {}),
      ...(Number.isFinite(matchedReport?.tempF)
        ? { tempF: matchedReport.tempF }
        : {}),
      firstObservedAt: sighting.firstSeenAt,
      sourceFirstSeenAt: sighting.firstSeenAt,
      fetchStartedAt: sighting.fetchStartedAt,
      fetchCompletedAt: sighting.fetchCompletedAt,
      providerFileTimeUtc: sighting.fileStampUtc ?? null,
      pollingSlotUtc: sighting.raceSlotUtc ?? null,
      pollingResolutionSeconds: Number.isFinite(sighting.raceSlotUtc)
        ? 60
        : null,
      timingMeaning: Number.isFinite(sighting.raceSlotUtc)
        ? "first observed in this one-minute paired polling slot"
        : "first observed by this collector",
    });
  }
  return events
    .sort((left, right) => left.firstObservedAt - right.firstObservedAt)
    .slice(-MAX_SOURCE_EVENTS);
}

function snapshotFallbackFromSmnRows(rows, stationIcao, date) {
  const usable = rows.filter(
    (row) => row.date === date && Number.isFinite(row.tempC),
  );
  if (!usable.length) {
    return [];
  }
  const max = usable.reduce((current, row) =>
    !current || row.tempC > current.tempC ? row : current,
  );
  return [
    {
      ...buildSnapshot({
        stationIcao,
        date,
        source: "smn_municipal_hourly",
        sourceInputKey: String(max.forecastCaptureId),
        sourceLabel: max.sourceSiteLabel,
        sourceIssuedAt: max.sourceLastModifiedAt,
        sourceCapturedAt: max.capturedAt,
        forecastHighC: max.tempC,
        forecastPeakTimeUtc: max.forecastTimeUtc,
        forecastPeakTimeLocal: max.forecastTimeLocal,
      }),
      persisted: false,
    },
  ];
}

export function mergeForecastHighSnapshots(
  persistedSnapshots,
  fallbackSnapshots,
) {
  const snapshotsByKey = new Map();
  for (const snapshot of fallbackSnapshots) {
    snapshotsByKey.set(snapshot.snapshotKey, snapshot);
  }
  // Prefer the immutable stored row when both paths describe the same source
  // input; otherwise retain the fresher source-derived row until the next cron.
  for (const snapshot of persistedSnapshots) {
    snapshotsByKey.set(snapshot.snapshotKey, snapshot);
  }
  return [...snapshotsByKey.values()].sort(
    (left, right) => left.sourceCapturedAt - right.sourceCapturedAt,
  );
}

export function compactTdz05ReactionRows(capmaRows, sampleGapMs = 5 * 60_000) {
  const rows = (capmaRows || [])
    .filter(
      (row) =>
        String(row?.tdz).padStart(2, "0") === "05" &&
        Number.isFinite(row?.screenTimeUtc) &&
        Number.isFinite(row?.currentTempC),
    )
    .sort((left, right) => left.screenTimeUtc - right.screenTimeUtc);
  if (rows.length < 2) {
    return rows;
  }
  const selectedIndexes = new Set([0, rows.length - 1]);
  let lastSelectedIndex = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (current.currentTempC !== previous.currentTempC) {
      selectedIndexes.add(index - 1);
      selectedIndexes.add(index);
      lastSelectedIndex = index;
      continue;
    }
    if (
      current.screenTimeUtc - rows[lastSelectedIndex].screenTimeUtc >=
      sampleGapMs
    ) {
      selectedIndexes.add(index);
      lastSelectedIndex = index;
    }
  }
  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => rows[index]);
}

export function temperatureTimeline(
  metarRows,
  capmaRows,
  maxCapmaRows = MAX_CAPMA_ROWS,
) {
  const officialPoints = metarRows.flatMap((row) =>
    Number.isFinite(row.tempC)
      ? [
          {
            kind: "official_report",
            series: "metar_speci",
            reportKey: row.reportKey,
            rawHash: row.rawHash,
            ...(row.typelessHash ? { typelessHash: row.typelessHash } : {}),
            reportType: row.reportType,
            isCorrection: row.isCorrection === true,
            eventTimeUtc: row.obsTimeUtc,
            firstObservedAt: row.firstSeenAt,
            at: row.obsTimeUtc,
            observedAt: row.firstSeenAt,
            tempC: row.tempC,
            tempF: row.tempF,
            source: row.firstSource ?? "unknown",
          },
        ]
      : [],
  );
  const capmaPointLimit = Math.max(0, maxCapmaRows - officialPoints.length);
  const capmaPoints = (
    capmaPointLimit > 0 ? capmaRows.slice(-capmaPointLimit) : []
  ).map((row) => ({
    kind: "whole_degree_display",
    series: `capma_tdz_${row.tdz}`,
    tdz: row.tdz,
    rawHash: row.rawHash,
    eventTimeUtc: row.screenTimeUtc,
    firstObservedAt: row.firstSeenAt,
    at: row.screenTimeUtc,
    observedAt: row.firstSeenAt,
    tempC: row.currentTempC,
    tempF: row.currentTempF,
    twoMinuteTempC: row.twoMinuteTempC,
    twoMinuteTempF: row.twoMinuteTempF,
    ocrConfidence: row.ocrConfidence,
    source: "capma_tdz_image",
  }));
  // Keep every bounded official row available for report-identity joins. Trim
  // only the dense TDZ chart rail so it cannot evict an early official maximum.
  return [...officialPoints, ...capmaPoints].sort(
    (left, right) => left.eventTimeUtc - right.eventTimeUtc,
  );
}

export function buildTdzDailyMaximumEvidence({
  rows,
  date,
  nowMs,
  truncated = false,
  rowLimit = MAX_CAPMA_DAY_ROWS,
  approved = true,
}) {
  if (!approved) {
    return {
      status: "approval_required",
      date,
      truncated: false,
      rowLimit,
      events: [],
      series: [],
    };
  }
  const dayStartAt = mexicoMidnightUtc(date);
  const nextDayStartAt = mexicoMidnightUtc(shiftDateKey(date, 1));
  const liveDate = formatMexicoDate(nowMs) === date;
  const targetEndAt = liveDate
    ? Math.min(nowMs, nextDayStartAt)
    : nextDayStartAt;
  const series = ["05", "23"].map((tdz) => {
    const tdzRows = (rows ?? [])
      .filter(
        (row) =>
          row?.tdz === tdz &&
          Number.isFinite(row?.screenTimeUtc) &&
          Number.isFinite(row?.firstSeenAt) &&
          Number.isFinite(row?.currentTempC),
      )
      .sort(
        (left, right) =>
          left.screenTimeUtc - right.screenTimeUtc ||
          left.firstSeenAt - right.firstSeenAt,
      );
    const coverageStartAt = tdzRows[0]?.screenTimeUtc;
    const coverageEndAt = tdzRows.at(-1)?.screenTimeUtc;
    const startGapMs = Number.isFinite(coverageStartAt)
      ? Math.max(0, coverageStartAt - dayStartAt)
      : null;
    const endGapMs = Number.isFinite(coverageEndAt)
      ? Math.max(0, targetEndAt - coverageEndAt)
      : null;
    let maxGapMs = null;
    for (let index = 1; index < tdzRows.length; index += 1) {
      const gap =
        tdzRows[index].screenTimeUtc - tdzRows[index - 1].screenTimeUtc;
      maxGapMs = maxGapMs === null ? gap : Math.max(maxGapMs, gap);
    }
    const complete =
      !truncated &&
      tdzRows.length > 0 &&
      Number.isFinite(startGapMs) &&
      startGapMs <= CAPMA_COVERAGE_GAP_MS &&
      Number.isFinite(endGapMs) &&
      endGapMs <= CAPMA_COVERAGE_GAP_MS &&
      (maxGapMs === null || maxGapMs <= CAPMA_COVERAGE_GAP_MS);
    const events = [];
    if (complete) {
      let maximumC = null;
      for (const row of [...tdzRows].sort(
        (left, right) =>
          left.firstSeenAt - right.firstSeenAt ||
          left.screenTimeUtc - right.screenTimeUtc,
      )) {
        if (!Number.isFinite(maximumC) || row.currentTempC > maximumC) {
          const previousMaxC = maximumC;
          maximumC = row.currentTempC;
          events.push({
            id: `tdz-${tdz}-${row.rawHash}`,
            source: `CAPMA TDZ ${tdz}`,
            sourceKey: `capma_tdz_${tdz}`,
            series: `capma_tdz_${tdz}`,
            tdz,
            artifact: "whole-degree display",
            at: row.firstSeenAt,
            firstObservedAt: row.firstSeenAt,
            sourceFirstSeenAt: row.firstSeenAt,
            measurementAt: row.screenTimeUtc,
            tempC: row.currentTempC,
            tempF: row.currentTempF,
            previousMaxC,
            rawHash: row.rawHash,
            maximumEvent: true,
          });
        }
      }
    }
    return {
      tdz,
      series: `capma_tdz_${tdz}`,
      status: complete ? "complete" : "partial",
      complete,
      rowCount: tdzRows.length,
      ...(Number.isFinite(coverageStartAt) ? { coverageStartAt } : {}),
      ...(Number.isFinite(coverageEndAt) ? { coverageEndAt } : {}),
      ...(Number.isFinite(startGapMs) ? { startGapMs } : {}),
      ...(Number.isFinite(endGapMs) ? { endGapMs } : {}),
      ...(Number.isFinite(maxGapMs) ? { maxGapMs } : {}),
      events,
    };
  });
  const events = series
    .flatMap((item) => item.events)
    .sort((left, right) => left.at - right.at);
  return {
    status: series.every((item) => item.complete) ? "complete" : "partial",
    date,
    liveDate,
    dayStartAt,
    targetEndAt,
    truncated,
    rowLimit,
    coverageToleranceMs: CAPMA_COVERAGE_GAP_MS,
    events,
    series,
  };
}

export function buildOfficialDailyMaximumEvidence({
  metarRows,
  relayRows,
  metarTruncated = false,
  relayTruncated = false,
  metarRowLimit = MAX_DAY_METARS,
  relayRowLimit = MAX_RELAY_SIGHTINGS,
}) {
  const truncated = metarTruncated || relayTruncated;
  return {
    status: truncated ? "partial" : "complete",
    truncated,
    metarTruncated,
    relayTruncated,
    metarRowLimit,
    relayRowLimit,
    retainedMetarCount: metarRows?.length ?? 0,
    retainedRelayCount: relayRows?.length ?? 0,
  };
}

export const getDashboard = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = assertStation(args.stationIcao);
    const date = assertDate(args.date);
    const nowMs = Date.now();
    const capmaAftnApproved = capmaAftnAccessApproved();
    const capmaGates = capmaEdgePublicationGates();
    const historyDates = Array.from({ length: 5 }, (_, index) =>
      shiftDateKey(date, index - 4),
    );

    const [
      storedDayMetarPage,
      storedHistoryByDate,
      smnRows,
      tafCaptures,
      collectorStatusRows,
      persistedForecastSnapshots,
      relaySightingPage,
    ] = await Promise.all([
      ctx.db
        .query("mexicoMetarObservations")
        .withIndex("by_station_date_obs", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .order("desc")
        .take(MAX_DAY_METARS + 1),
      Promise.all(
        historyDates.map((historyDate) =>
          ctx.db
            .query("mexicoMetarObservations")
            .withIndex("by_station_date_obs", (query) =>
              query.eq("stationIcao", stationIcao).eq("date", historyDate),
            )
            .order("desc")
            .take(MAX_HISTORY_METARS_PER_DAY),
        ),
      ),
      ctx.db
        .query("mexicoSmnHourlyForecasts")
        .withIndex("by_station_date_time", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .take(240),
      ctx.db
        .query("mexicoTafForecasts")
        .withIndex("by_station_issue_time", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .order("desc")
        .take(80),
      ctx.db
        .query("mexicoCollectorStatus")
        .withIndex("by_station_source", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .take(100),
      ctx.db
        .query("mexicoEdgeForecastHighSnapshots")
        .withIndex("by_station_date_source_capture", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .order("desc")
        .take(240),
      ctx.db
        .query("mexicoRelaySightings")
        .withIndex("by_station_date", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .order("desc")
        .take(MAX_RELAY_SIGHTINGS + 1),
    ]);

    const dayMetarsTruncated = storedDayMetarPage.length > MAX_DAY_METARS;
    const relaySightingsTruncated =
      relaySightingPage.length > MAX_RELAY_SIGHTINGS;
    const storedDayMetars = storedDayMetarPage.slice(0, MAX_DAY_METARS);
    const relaySightings = relaySightingPage.slice(0, MAX_RELAY_SIGHTINGS);

    const dayMetars = publicMetarRowsForCapmaApproval(
      storedDayMetars,
      capmaAftnApproved,
    ).sort((left, right) =>
      left.obsTimeUtc !== right.obsTimeUtc
        ? left.obsTimeUtc - right.obsTimeUtc
        : left.firstSeenAt - right.firstSeenAt,
    );
    const historyMetars = publicMetarRowsForCapmaApproval(
      storedHistoryByDate.flat(),
      capmaAftnApproved,
    ).sort((left, right) => left.obsTimeUtc - right.obsTimeUtc);

    let capmaRows = [];
    let capmaDayRows = [];
    let capmaDayRowsTruncated = false;
    let latestImages = { "05": null, 23: null };
    if (capmaGates.visible) {
      const capmaDayPage = await ctx.db
        .query("mexicoCapmaTdzObservations")
        .withIndex("by_station_date_screen_time", (query) =>
          query.eq("stationIcao", stationIcao).eq("date", date),
        )
        .order("desc")
        .take(MAX_CAPMA_DAY_ROWS + 1);
      capmaDayRowsTruncated = capmaDayPage.length > MAX_CAPMA_DAY_ROWS;
      capmaDayRows = capmaDayPage.slice(0, MAX_CAPMA_DAY_ROWS).reverse();
      capmaRows = capmaDayRows.slice(-MAX_CAPMA_ROWS);
      const observationByImage = new Map(
        capmaDayRows.map((row) => [`${row.tdz}:${row.rawHash}`, row]),
      );
      const imageRows = await Promise.all(
        ["05", "23"].map((tdz) =>
          ctx.db
            .query("mexicoCapmaLatestImages")
            .withIndex("by_station_tdz", (query) =>
              query.eq("stationIcao", stationIcao).eq("tdz", tdz),
            )
            .first(),
        ),
      );
      const publicImages = await Promise.all(
        imageRows.map(async (row) => {
          if (!row) {
            return null;
          }
          const metadata = await ctx.db.system.get("_storage", row.storageId);
          if (
            !metadata ||
            metadata.sha256 !== row.storageSha256 ||
            metadata.size !== row.responseBytes ||
            metadata.contentType !== row.contentType
          ) {
            return null;
          }
          const matchingObservation = observationByImage.get(
            `${row.tdz}:${row.rawHash}`,
          );
          return {
            tdz: row.tdz,
            path:
              "/mexico/capma/latest-image" +
              `?stationIcao=${encodeURIComponent(stationIcao)}` +
              `&tdz=${encodeURIComponent(row.tdz)}` +
              `&rawHash=${encodeURIComponent(row.rawHash)}`,
            rawHash: row.rawHash,
            contentType: row.contentType,
            screenTimeUtc: row.screenTimeUtc,
            screenTimeLocal: row.screenTimeLocal,
            screenTimestampRaw: row.screenTimestampRaw,
            currentTempC: row.currentTempC,
            currentTempF: toFahrenheit(row.currentTempC),
            twoMinuteTempC: row.twoMinuteTempC,
            twoMinuteTempF: toFahrenheit(row.twoMinuteTempC),
            // Extended display fields live on the matching observation row;
            // frames stored before the v3 OCR engine simply return null.
            dewpointC: matchingObservation?.dewpointC ?? null,
            humidityPercent: matchingObservation?.humidityPercent ?? null,
            stationPressureHpa: matchingObservation?.stationPressureHpa ?? null,
            qnhInHg: matchingObservation?.qnhInHg ?? null,
            twoMinuteDewpointC: matchingObservation?.twoMinuteDewpointC ?? null,
            firstSeenAt: matchingObservation?.firstSeenAt ?? null,
            fetchStartedAt: row.fetchStartedAt,
            fetchCompletedAt: row.fetchCompletedAt,
            responseBytes: row.responseBytes,
            imageWidth: row.imageWidth,
            imageHeight: row.imageHeight,
            ocrConfidence: row.ocrConfidence,
            sourceSiteLabel: row.sourceSiteLabel,
          };
        }),
      );
      latestImages = { "05": publicImages[0], 23: publicImages[1] };
    }
    const publicCapma = sanitizeCapmaPublicPayload(
      { rows: capmaRows, latestImages },
      capmaGates,
    );
    const tdzDailyMaximumEvidence = buildTdzDailyMaximumEvidence({
      rows: capmaDayRows,
      date,
      nowMs,
      truncated: capmaDayRowsTruncated,
      rowLimit: MAX_CAPMA_DAY_ROWS,
      approved: capmaGates.visible,
    });

    const publicRelaySightings = relaySightings.filter(
      (row) => capmaAftnApproved || row.source !== CAPMA_AFTN_SOURCE,
    );
    const officialDailyMaximumEvidence = buildOfficialDailyMaximumEvidence({
      metarRows: dayMetars,
      relayRows: publicRelaySightings,
      metarTruncated: dayMetarsTruncated,
      relayTruncated: relaySightingsTruncated,
    });
    // The validated paired-race summary remains in its dedicated reactive
    // query. Keeping up to a full day of minute attempts out of this composite
    // query prevents its weather/image reads from crossing Convex limits.
    const relayRace = {
      status: capmaAftnApproved
        ? "available_via_dedicated_query"
        : "approval_required",
      measurementResolutionSeconds: 60,
      queryName: "mexicoRelayRace:getCapmaNoaaRelayRace",
      summary: null,
    };

    const fallbackSnapshots = [
      ...deriveTafHighSnapshots(tafCaptures, date).map((row) => ({
        ...row,
        persisted: false,
      })),
      ...snapshotFallbackFromSmnRows(smnRows, stationIcao, date),
    ];
    const persistedSnapshots = persistedForecastSnapshots.map((row) => ({
      ...row,
      persisted: true,
    }));
    // Persisted rows preserve revision history. Fresh source-derived rows keep
    // the dashboard current between the five-minute snapshot cron runs.
    const snapshots = mergeForecastHighSnapshots(
      persistedSnapshots,
      fallbackSnapshots,
    );
    const tafRevision = buildForecastRevision(
      snapshots.filter((row) => row.source === "taf_tx"),
    );
    const smnRevision = buildForecastRevision(
      snapshots.filter((row) => row.source === "smn_municipal_hourly"),
    );
    const collectorStatuses = Object.fromEntries(
      collectorStatusRows.map((row) => [row.source, row]),
    );
    const fastWatchGates = mexicoEdgeFastWatchGateState();
    const latestMetar = dayMetars.at(-1) ?? null;
    const maxMetar = highestByTemperature(dayMetars);
    const routineClock = estimateRoutineMetarWindow({
      rows: historyMetars,
      nowMs,
      // Historical training sightings are predominantly one-minute samples.
      // The fast-watch card reports current capability separately.
      pollResolutionMs: 60_000,
    });
    const speciClock = buildSpeciClock(dayMetars);
    const sourceEvents = buildSourceEvents(
      dayMetars,
      publicRelaySightings,
      capmaAftnApproved,
    ).map((event) => ({
      ...event,
      observedAt: event.firstObservedAt,
    }));
    const timeline = temperatureTimeline(dayMetars, publicCapma.rows);
    const reactionTimeline = temperatureTimeline(
      dayMetars,
      compactTdz05ReactionRows(capmaDayRows),
      MAX_REACTION_CAPMA_ROWS,
    );
    const publicLatestMetar = latestMetar
      ? { ...latestMetar, rawText: latestMetar.rawMetar }
      : null;
    const publicTafRevision = {
      ...tafRevision,
      currentMaxC: tafRevision.current?.forecastHighC ?? null,
      previousMaxC: tafRevision.previous?.forecastHighC ?? null,
      issuedAt:
        tafRevision.current?.sourceIssuedAt ??
        tafRevision.current?.sourceCapturedAt ??
        null,
      forecastPeakTimeUtc: tafRevision.current?.forecastPeakTimeUtc ?? null,
    };
    const publicSmnRevision = {
      ...smnRevision,
      currentMaxC: smnRevision.current?.forecastHighC ?? null,
      previousMaxC: smnRevision.previous?.forecastHighC ?? null,
      issuedAt:
        smnRevision.current?.sourceIssuedAt ??
        smnRevision.current?.sourceCapturedAt ??
        null,
      forecastPeakTimeUtc: smnRevision.current?.forecastPeakTimeUtc ?? null,
    };
    const latestRelevantTaf =
      tafCaptures.find((capture) =>
        capture.temperatureGroups?.some((group) => group.date === date),
      ) ?? null;

    return {
      stationIcao,
      date,
      timezone: MEXICO_TIMEZONE,
      generatedAt: nowMs,
      liveDate: date === formatMexicoDate(nowMs),
      latestMetar: publicLatestMetar,
      maxOfficialTempC: maxMetar?.tempC ?? null,
      maxOfficialMetar: maxMetar,
      temperatureTimeline: timeline,
      reactionTemperatureTimeline: reactionTimeline,
      tdzDailyMaximumEvidence,
      officialDailyMaximumEvidence,
      sourceEvents,
      speci: speciClock,
      taf: latestRelevantTaf,
      smnRows: smnRows.sort(
        (left, right) => left.forecastTimeUtc - right.forecastTimeUtc,
      ),
      temperature: {
        latestMetar: publicLatestMetar,
        maximumMetar: maxMetar,
        timeline,
      },
      metarRows: dayMetars,
      observationClock: {
        ...routineClock,
        windowStartAt: routineClock.windowStartUtc,
        windowEndAt: routineClock.windowEndUtc,
        status:
          routineClock.state === "past_expected_window"
            ? "overdue"
            : routineClock.state,
        routine: routineClock,
        speci: speciClock,
      },
      sourceEvidence: {
        events: sourceEvents,
        relayRace,
        samePollingSlotMeaning:
          "Publication order is indeterminate when sources first appear in the same polling slot.",
      },
      forecasts: {
        taf: publicTafRevision,
        smn: publicSmnRevision,
        snapshots: snapshots
          .sort((left, right) => left.sourceCapturedAt - right.sourceCapturedAt)
          .slice(-240),
        smnRows,
      },
      capma: {
        ...capmaGates,
        rows: publicCapma.rows,
        latestImages: publicCapma.latestImages,
      },
      highFrequencyWatch: {
        ...fastWatchGates,
        status: fastWatchGates.allowed
          ? (collectorStatuses.capma_aftn_high_frequency_watch?.status ??
            "idle")
          : fastWatchGates.baseAccessApproved &&
              fastWatchGates.highFrequencyAccessApproved
            ? "disabled"
            : "approval_required",
        collectorStatus:
          collectorStatuses.capma_aftn_high_frequency_watch ?? null,
        defaultIntervalSeconds: 5,
        boundedSessionMaximumMinutes: 9,
      },
      resolutionSource: weatherCompanyResolutionStatus(),
      collectorStatuses,
    };
  },
});
