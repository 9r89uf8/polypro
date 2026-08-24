import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfficialDailyMaximumEvidence,
  buildSmnDateCoverage,
  buildTdzDailyMaximumEvidence,
  buildSourceEvents,
  capmaEdgePublicationGates,
  compactTdz05ReactionRows,
  deriveSmnHighSnapshots,
  deriveTafHighSnapshots,
  mergeForecastHighSnapshots,
  selectLatestSmnCaptureRows,
  sanitizeCapmaPublicPayload,
  temperatureTimeline,
  weatherCompanyResolutionStatus,
} from "../convex/mexicoEdge.js";
import {
  buildForecastRevision,
  buildSpeciClock,
  estimateCircularHourPhase,
  estimateRoutineMetarWindow,
} from "../convex/mexicoEdgeTiming.js";
import {
  FORECAST_SOURCE_SMN,
  FORECAST_SOURCE_TAF,
  nextAutomaticForecastCheck,
  nextDayTafAvailabilityWindow,
  smnVenustianoDailyForecastUrl,
  smnVenustianoHourlyForecastUrl,
} from "../app/mexico/edge/forecast-timing.mjs";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

test("source events dedupe the observation row and relay sighting without losing temperature", () => {
  const firstSeenAt = Date.parse("2026-08-21T21:40:28.454Z");
  const obsTimeUtc = Date.parse("2026-08-21T21:40:00Z");
  const metarRows = [
    {
      reportKey: "MMMX:2140:METAR:raw",
      typelessHash: "same-report",
      reportType: "METAR",
      firstSource: "capma_aftn_metar",
      firstSeenAt,
      fetchStartedAt: firstSeenAt - 200,
      fetchCompletedAt: firstSeenAt,
      obsTimeUtc,
      tempC: 24,
      tempF: 75.2,
    },
  ];
  const relaySightings = [
    {
      source: "capma_aftn_metar",
      typelessHash: "same-report",
      reportTypeHint: "METAR",
      obsTimeUtc,
      firstSeenAt,
      fetchStartedAt: firstSeenAt - 200,
      fetchCompletedAt: firstSeenAt,
    },
  ];

  const events = buildSourceEvents(metarRows, relaySightings, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].tempC, 24);
  assert.equal(events[0].measurementAt, obsTimeUtc);
  assert.equal(events[0].sourceFirstSeenAt, firstSeenAt);
  assert.equal(events[0].typelessHash, "same-report");
});

test("TDZ daily maxima require complete day-to-now retained coverage", () => {
  const start = Date.parse("2026-08-21T06:00:00Z");
  const row = (tdz, minute, currentTempC) => ({
    tdz,
    rawHash: `${tdz}-${minute}`,
    screenTimeUtc: start + minute * MINUTE_MS,
    firstSeenAt: start + minute * MINUTE_MS + 1_000,
    currentTempC,
    currentTempF: (currentTempC * 9) / 5 + 32,
  });
  const complete = buildTdzDailyMaximumEvidence({
    rows: [
      row("05", 1, 20),
      row("23", 1, 21),
      row("05", 3, 20),
      row("23", 3, 22),
      row("05", 4, 23),
      row("23", 4, 22),
    ],
    date: "2026-08-21",
    nowMs: start + 5 * MINUTE_MS,
  });
  assert.equal(complete.status, "complete");
  assert.deepEqual(
    complete.events.map((event) => [event.tdz, event.tempC]),
    [
      ["05", 20],
      ["23", 21],
      ["23", 22],
      ["05", 23],
    ],
  );

  const partial = buildTdzDailyMaximumEvidence({
    rows: [row("05", 10, 25), row("23", 10, 25)],
    date: "2026-08-21",
    nowMs: start + 12 * MINUTE_MS,
  });
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.events, []);

  const internalGap = buildTdzDailyMaximumEvidence({
    rows: [
      row("05", 1, 20),
      row("23", 1, 20),
      row("05", 8, 24),
      row("23", 8, 24),
    ],
    date: "2026-08-21",
    nowMs: start + 9 * MINUTE_MS,
  });
  assert.equal(internalGap.status, "partial");
  assert.deepEqual(internalGap.events, []);

  const oneCompleteSeries = buildTdzDailyMaximumEvidence({
    rows: [
      row("05", 1, 20),
      row("05", 4, 23),
      row("05", 8, 23),
      row("23", 8, 24),
    ],
    date: "2026-08-21",
    nowMs: start + 9 * MINUTE_MS,
  });
  assert.equal(oneCompleteSeries.status, "partial");
  assert.deepEqual(
    oneCompleteSeries.events.map((event) => [event.tdz, event.tempC]),
    [
      ["05", 20],
      ["05", 23],
    ],
  );

  const truncated = buildTdzDailyMaximumEvidence({
    rows: complete.series.flatMap((series) =>
      series.events.map((event) => ({
        tdz: event.tdz,
        rawHash: event.rawHash,
        screenTimeUtc: event.measurementAt,
        firstSeenAt: event.at,
        currentTempC: event.tempC,
        currentTempF: event.tempF,
      })),
    ),
    date: "2026-08-21",
    nowMs: start + 5 * MINUTE_MS,
    truncated: true,
  });
  assert.equal(truncated.status, "partial");
  assert.deepEqual(truncated.events, []);

  const unapproved = buildTdzDailyMaximumEvidence({
    rows: [],
    date: "2026-08-21",
    nowMs: start + 5 * MINUTE_MS,
    approved: false,
  });
  assert.equal(unapproved.status, "approval_required");
  assert.deepEqual(unapproved.events, []);
});

test("official daily-max evidence fails closed on either bounded query", () => {
  const complete = buildOfficialDailyMaximumEvidence({
    metarRows: [{ reportKey: "a" }],
    relayRows: [{ typelessHash: "a" }],
  });
  assert.equal(complete.status, "complete");
  assert.equal(complete.truncated, false);

  const partial = buildOfficialDailyMaximumEvidence({
    metarRows: [{ reportKey: "a" }],
    relayRows: [],
    relayTruncated: true,
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.truncated, true);
  assert.equal(partial.relayTruncated, true);
});

test("dense TDZ chart rows cannot evict early official temperature evidence", () => {
  const metars = Array.from({ length: 160 }, (_, index) => ({
    reportKey: `report-${index}`,
    rawHash: `raw-${index}`,
    reportType: "METAR",
    isCorrection: false,
    obsTimeUtc: index,
    firstSeenAt: index + 1,
    tempC: index === 0 ? 25 : 20,
    tempF: index === 0 ? 77 : 68,
  }));
  const capmaRows = Array.from({ length: 900 }, (_, index) => ({
    tdz: index % 2 ? "05" : "23",
    rawHash: `tdz-${index}`,
    screenTimeUtc: 1_000 + index,
    firstSeenAt: 1_001 + index,
    currentTempC: 20,
    currentTempF: 68,
    twoMinuteTempC: 20,
    twoMinuteTempF: 68,
    ocrConfidence: 1,
  }));
  const timeline = temperatureTimeline(metars, capmaRows);
  assert.equal(timeline.length, 900);
  assert.equal(
    timeline.filter((point) => point.kind === "official_report").length,
    160,
  );
  assert.equal(
    timeline.some((point) => point.reportKey === "report-0"),
    true,
  );
});

test("reaction TDZ rail keeps only TDZ 05 with periodic and transition anchors", () => {
  const start = Date.parse("2026-08-22T06:00:00Z");
  const rows = [
    { tdz: "23", minute: 0, temp: 19 },
    { tdz: "05", minute: 0, temp: 20 },
    { tdz: "05", minute: 1, temp: 20 },
    { tdz: "05", minute: 5, temp: 20 },
    { tdz: "05", minute: 7, temp: 21 },
    { tdz: "05", minute: 8, temp: 21 },
    { tdz: "05", minute: 13, temp: 21 },
  ].map((row) => ({
    tdz: row.tdz,
    rawHash: `${row.tdz}-${row.minute}`,
    screenTimeUtc: start + row.minute * MINUTE_MS,
    firstSeenAt: start + row.minute * MINUTE_MS + 1_000,
    currentTempC: row.temp,
  }));

  const compact = compactTdz05ReactionRows(rows);
  assert.deepEqual(
    compact.map((row) => [row.tdz, row.currentTempC, row.screenTimeUtc]),
    [
      ["05", 20, start],
      ["05", 20, start + 5 * MINUTE_MS],
      ["05", 21, start + 7 * MINUTE_MS],
      ["05", 21, start + 13 * MINUTE_MS],
    ],
  );
});

function routineRows(count = 12) {
  const firstHour = Date.parse("2026-08-20T00:00:00Z");
  return Array.from({ length: count }, (_, index) => {
    const obsTimeUtc = firstHour + index * HOUR_MS + 48 * MINUTE_MS;
    return {
      reportKey: `routine-${index}`,
      reportType: "METAR",
      isCorrection: false,
      obsTimeUtc,
      firstSeenAt: obsTimeUtc + 8 * MINUTE_MS,
    };
  });
}

test("routine estimator returns a learned window, not an exact due time", () => {
  const rows = routineRows();
  const result = estimateRoutineMetarWindow({
    rows,
    nowMs: Date.parse("2026-08-20T12:50:00Z"),
  });
  assert.equal(result.available, true);
  assert.equal(result.exactDueTime, false);
  assert.equal(result.observationPhaseMinute, 48);
  assert.equal(
    result.expectedObservationUtc,
    Date.parse("2026-08-20T12:48:00Z"),
  );
  assert.equal(result.windowCenterUtc, Date.parse("2026-08-20T12:56:00Z"));
  assert.equal(result.windowStartUtc, Date.parse("2026-08-20T12:54:00Z"));
  assert.equal(result.windowEndUtc, Date.parse("2026-08-20T12:58:00Z"));
  assert.equal(result.state, "waiting");
  assert.equal(result.confidence, "medium");
  assert.match(result.caveat, /estimate, not .* deadline/i);

  const watching = estimateRoutineMetarWindow({
    rows,
    nowMs: Date.parse("2026-08-20T12:56:30Z"),
  });
  assert.equal(watching.state, "watching");
  assert.equal(watching.countdownTargetUtc, watching.windowEndUtc);

  const overdue = estimateRoutineMetarWindow({
    rows,
    nowMs: Date.parse("2026-08-20T13:01:00Z"),
  });
  assert.equal(overdue.state, "past_expected_window");
});

test("routine estimator is robust to corrections, SPECI, outliers, and hour wrap", () => {
  const rows = routineRows(24);
  rows.push({
    reportType: "SPECI",
    obsTimeUtc: Date.parse("2026-08-20T23:15:00Z"),
    firstSeenAt: Date.parse("2026-08-20T23:16:00Z"),
  });
  rows.push({
    reportType: "METAR",
    isCorrection: true,
    obsTimeUtc: Date.parse("2026-08-20T23:03:00Z"),
    firstSeenAt: Date.parse("2026-08-20T23:04:00Z"),
  });
  const result = estimateRoutineMetarWindow({
    rows,
    nowMs: Date.parse("2026-08-21T00:20:00Z"),
  });
  assert.equal(result.sampleCount, 24);
  assert.equal(result.observationPhaseMinute, 48);
  assert.equal(result.confidence, "high");

  const circular = estimateCircularHourPhase([
    59 * MINUTE_MS,
    59 * MINUTE_MS + 30_000,
    10_000,
    30_000,
  ]);
  assert.ok(circular.medianAbsoluteDeviationMs < MINUTE_MS);
});

test("routine estimator declines to invent a window without enough history", () => {
  const result = estimateRoutineMetarWindow({ rows: routineRows(5) });
  assert.equal(result.available, false);
  assert.equal(result.confidence, "insufficient");
  assert.equal(result.reason, "insufficient_history");
  assert.equal(result.windowCenterUtc, null);
});

test("a newly received routine report has an explicit received state", () => {
  const rows = routineRows(12);
  const latest = rows.at(-1);
  const result = estimateRoutineMetarWindow({
    rows,
    nowMs: latest.firstSeenAt + MINUTE_MS,
  });
  assert.equal(result.state, "received");
  assert.equal(result.latestRoutineReport.reportKey, latest.reportKey);
});

test("SPECI has no due clock and keeps the latest special report", () => {
  const rows = [
    {
      reportKey: "routine",
      reportType: "METAR",
      obsTimeUtc: 300,
    },
    {
      reportKey: "older-speci",
      reportType: "SPECI",
      obsTimeUtc: 100,
    },
    {
      reportKey: "latest-speci",
      reportType: "SPECI",
      obsTimeUtc: 200,
    },
  ];
  const clock = buildSpeciClock(rows);
  assert.equal(clock.status, "no_clock");
  assert.equal(clock.scheduled, false);
  assert.equal(clock.dueAtUtc, null);
  assert.equal(clock.latest.reportKey, "latest-speci");
  assert.match(clock.explanation, /do not have a scheduled due time/i);
});

test("CAPMA image history fails closed unless every approval is exact true", () => {
  const payload = {
    rows: [{ rawHash: "protected" }],
    latestImages: { "05": { rawHash: "protected" }, 23: null },
  };
  const almost = capmaEdgePublicationGates({
    SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED: "true",
    SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED: "TRUE",
    SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED: "true",
  });
  assert.equal(almost.visible, false);
  assert.deepEqual(sanitizeCapmaPublicPayload(payload, almost), {
    rows: [],
    latestImages: { "05": null, 23: null },
  });

  const approved = capmaEdgePublicationGates({
    SENEAM_MMMX_TDZ_ACCESS_APPROVED: "true",
    SENEAM_MMMX_TDZ_RETENTION_APPROVED: "true",
    SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED: "true",
  });
  assert.equal(approved.visible, true);
  assert.equal(sanitizeCapmaPublicPayload(payload, approved), payload);
});

test("TAF snapshots retain immutable source issue and peak evidence", () => {
  const snapshots = deriveTafHighSnapshots([
    {
      stationIcao: "MMMX",
      tafKey: "taf-a",
      issueTimeUtc: 1_000,
      firstSeenAt: 1_100,
      temperatureGroups: [
        {
          kind: "maximum",
          date: "2026-08-20",
          tempC: 24,
          forecastTimeUtc: 2_000,
          forecastTimeLocal: "2026-08-20 14:00:00",
        },
        {
          kind: "maximum",
          date: "2026-08-20",
          tempC: 25,
          forecastTimeUtc: 3_000,
          forecastTimeLocal: "2026-08-20 15:00:00",
        },
      ],
    },
  ]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].snapshotKey, "taf_tx:taf-a:2026-08-20");
  assert.equal(snapshots[0].forecastHighC, 25);
  assert.equal(snapshots[0].forecastHighF, 77);
  assert.equal(snapshots[0].forecastPeakTimeUtc, 3_000);
  assert.equal(snapshots[0].sourceIssuedAt, 1_000);
  assert.equal(snapshots[0].sourceCapturedAt, 1_100);
});

test("SMN snapshots derive each retained raw capture without coercing missing temperatures", () => {
  const capture = (rawHash, capturedAt, values) => ({
    stationIcao: "MMMX",
    rawHash,
    capturedAt,
    sourceLastModifiedAt: capturedAt - 100,
    rawMunicipalityRows: JSON.stringify(
      values.map(([hour, temp]) => ({
        ides: "9",
        idmun: "17",
        nmun: "Venustiano Carranza",
        hloc: `20260820T${hour}`,
        dh: "6",
        temp,
      })),
    ),
  });
  const snapshots = deriveSmnHighSnapshots([
    capture("smn-a", 1_000, [
      ["13", "22"],
      ["14", null],
      ["15", "24"],
    ]),
    capture("smn-b", 2_000, [
      ["13", "23"],
      ["14", "25"],
    ]),
  ]);
  assert.deepEqual(
    snapshots.map((row) => row.forecastHighC),
    [24, 25],
  );
  assert.equal(
    snapshots[1].forecastPeakTimeUtc,
    Date.parse("2026-08-20T20:00:00Z"),
  );
});

test("SMN date coverage distinguishes a partial daily maximum from 24 retained hours", () => {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    date: "2026-08-24",
    forecastTimeUtc: Date.parse(
      `2026-08-24T${String(hour).padStart(2, "0")}:00:00Z`,
    ),
  }));
  assert.deepEqual(buildSmnDateCoverage(rows.slice(0, 3), "2026-08-24"), {
    status: "partial",
    hourCount: 3,
    expectedHourCount: 24,
    coverageStartAt: rows[0].forecastTimeUtc,
    coverageEndAt: rows[2].forecastTimeUtc,
  });
  assert.equal(buildSmnDateCoverage(rows, "2026-08-24").status, "complete");
});

test("SMN daily high and coverage use one coherent latest capture", () => {
  const oldRows = Array.from({ length: 24 }, (_, hour) => ({
    date: "2026-08-24",
    forecastTimeUtc: hour,
    forecastCaptureId: "old",
    capturedAt: 1_000,
    tempC: hour === 15 ? 30 : 15,
  }));
  const latestRows = Array.from({ length: 3 }, (_, hour) => ({
    date: "2026-08-24",
    forecastTimeUtc: hour,
    forecastCaptureId: "latest",
    capturedAt: 2_000,
    tempC: 18 + hour,
  }));
  const mixedRows = [...oldRows, ...latestRows];
  const selected = selectLatestSmnCaptureRows(mixedRows, "2026-08-24");
  assert.equal(selected.length, 3);
  assert.equal(Math.max(...selected.map((row) => row.tempC)), 20);
  assert.deepEqual(buildSmnDateCoverage(mixedRows, "2026-08-24"), {
    status: "partial",
    hourCount: 3,
    expectedHourCount: 24,
    coverageStartAt: 0,
    coverageEndAt: 2,
  });
});

test("forecast revision reports the previous distinct maximum and true change time", () => {
  const snapshots = [
    { snapshotKey: "a", forecastHighC: 23, sourceCapturedAt: 1_000 },
    { snapshotKey: "b", forecastHighC: 25, sourceCapturedAt: 2_000 },
    { snapshotKey: "c", forecastHighC: 25, sourceCapturedAt: 3_000 },
  ];
  const revision = buildForecastRevision(snapshots);
  assert.equal(revision.current.snapshotKey, "c");
  assert.equal(revision.previous.snapshotKey, "a");
  assert.equal(revision.deltaC, 2);
  assert.equal(revision.changedAt, 2_000);
  assert.equal(revision.snapshotCount, 3);
  assert.deepEqual(
    revision.history.map((row) => [row.forecastHighC, row.sourceCapturedAt]),
    [
      [23, 1_000],
      [25, 2_000],
    ],
  );
});

test("forecast revision trail records the first sighting of 20 to 19 change", () => {
  const revision = buildForecastRevision([
    { snapshotKey: "20-a", forecastHighC: 20, sourceCapturedAt: 1_000 },
    { snapshotKey: "20-b", forecastHighC: 20, sourceCapturedAt: 2_000 },
    { snapshotKey: "19-a", forecastHighC: 19, sourceCapturedAt: 3_000 },
    { snapshotKey: "19-b", forecastHighC: 19, sourceCapturedAt: 4_000 },
  ]);

  assert.equal(revision.previous.forecastHighC, 20);
  assert.equal(revision.current.forecastHighC, 19);
  assert.equal(revision.deltaC, -1);
  assert.equal(revision.changedAt, 3_000);
  assert.deepEqual(
    revision.history.map((row) => row.snapshotKey),
    ["20-a", "19-a"],
  );
});

test("forecast clocks expose the next scheduled cron attempt without promising a provider issue", () => {
  assert.equal(
    nextAutomaticForecastCheck(
      FORECAST_SOURCE_TAF,
      Date.parse("2026-08-23T12:00:59Z"),
    ),
    Date.parse("2026-08-23T12:01:00Z"),
  );
  assert.equal(
    nextAutomaticForecastCheck(
      FORECAST_SOURCE_TAF,
      Date.parse("2026-08-23T12:01:00Z"),
    ),
    Date.parse("2026-08-23T12:06:00Z"),
  );
  assert.equal(
    nextAutomaticForecastCheck(
      FORECAST_SOURCE_TAF,
      Date.parse("2026-08-23T12:56:00Z"),
    ),
    Date.parse("2026-08-23T13:01:00Z"),
  );
  assert.equal(
    nextAutomaticForecastCheck(
      FORECAST_SOURCE_SMN,
      Date.parse("2026-08-23T12:20:00Z"),
    ),
    Date.parse("2026-08-23T13:20:00Z"),
  );
});

test("next-day TAF estimate is a one-hour window before Mexico midnight", () => {
  const tomorrowStartsAt = Date.parse("2026-08-24T06:00:00Z");
  assert.deepEqual(nextDayTafAvailabilityWindow(tomorrowStartsAt), {
    startAt: Date.parse("2026-08-23T23:00:00Z"),
    endAt: Date.parse("2026-08-24T00:00:00Z"),
  });
});

test("SMN source links target Venustiano Carranza instead of the portal default", () => {
  const cacheAt = Date.parse("2026-08-23T23:45:00Z");
  assert.equal(
    smnVenustianoHourlyForecastUrl("2026-08-24", cacheAt),
    "https://smn.conagua.gob.mx/tools/PHP/pronostico_municipios_grafico/controlador/leeJsonHorario.php?edo=9&mun=17&fechayhora=20260824&kche=29792145",
  );
  assert.equal(smnVenustianoHourlyForecastUrl("20260824", cacheAt), null);

  const dailyUrl = smnVenustianoDailyForecastUrl(cacheAt);
  assert.equal(
    dailyUrl,
    "https://smn.conagua.gob.mx/tools/PHP/pronostico_municipios_grafico/controlador/getDataJson2String.php?edo=9&mun=17&kche=29792145",
  );
  assert.doesNotMatch(dailyUrl, /mun=16/);
});

test("fresh forecast rows bridge the snapshot cron without losing history", () => {
  const persisted = [
    {
      snapshotKey: "taf:old",
      source: "taf_tx",
      sourceCapturedAt: 1_000,
      forecastHighC: 23,
      persisted: true,
    },
    {
      snapshotKey: "taf:duplicate",
      source: "taf_tx",
      sourceCapturedAt: 2_000,
      forecastHighC: 24,
      persisted: true,
    },
  ];
  const fresh = [
    {
      snapshotKey: "taf:duplicate",
      source: "taf_tx",
      sourceCapturedAt: 2_000,
      forecastHighC: 24,
      persisted: false,
    },
    {
      snapshotKey: "taf:new",
      source: "taf_tx",
      sourceCapturedAt: 3_000,
      forecastHighC: 26,
      persisted: false,
    },
  ];

  const merged = mergeForecastHighSnapshots(persisted, fresh);
  assert.deepEqual(
    merged.map((row) => row.snapshotKey),
    ["taf:old", "taf:duplicate", "taf:new"],
  );
  assert.equal(merged[1].persisted, true);
  assert.equal(merged[2].forecastHighC, 26);
});

test("Weather Company resolution integration distinguishes approval from setup", () => {
  const absent = weatherCompanyResolutionStatus({});
  assert.equal(absent.status, "approval_required");
  assert.equal(absent.lastObservation, null);

  const approved = weatherCompanyResolutionStatus({
    TWC_MMMX_RES_ACCESS_APPROVED: "true",
    TWC_MMMX_RES_RETENTION_APPROVED: "true",
    TWC_MMMX_RES_PUBLIC_APPROVED: "true",
  });
  assert.equal(approved.status, "setup_required");
  assert.equal(approved.interfaceConfigured, false);
});
