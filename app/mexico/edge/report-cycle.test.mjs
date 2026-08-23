import test from "node:test";
import assert from "node:assert/strict";

import {
  ROUTINE_TRANSMISSION_DEADLINE_MINUTE,
  ROUTINE_WINDOW_OPEN_MINUTE,
  TDZ_FOCUS_LEAD_MS,
  TEMPERATURE_SPECIAL_THRESHOLD_C,
  buildOfficialReportCycles,
  buildOperationalRoutineClock,
  buildRelayLagModel,
  buildRoutineReportCycles,
  classifyTdzPoint,
  deriveReportCycleState,
  isTdzPointInFocus,
} from "./report-cycle.mjs";

const minute = 60_000;
const hour = Date.parse("2026-08-22T20:00:00Z");

function reportEvents({ capmaAt, noaaAt, obsTimeUtc = capmaAt - minute }) {
  return [
    {
      source: "capma_aftn_metar",
      reportType: "METAR",
      typelessHash: `report-${obsTimeUtc}`,
      obsTimeUtc,
      firstObservedAt: capmaAt,
      tempC: 17,
    },
    ...(Number.isFinite(noaaAt)
      ? [
          {
            source: "noaa_text_metar",
            reportType: "METAR",
            typelessHash: `report-${obsTimeUtc}`,
            obsTimeUtc,
            firstObservedAt: noaaAt,
            tempC: 17,
          },
        ]
      : []),
  ];
}

test("CAPMA and NOAA receipts are one routine report cycle", () => {
  const cycles = buildRoutineReportCycles(
    reportEvents({
      capmaAt: hour + 46 * minute,
      noaaAt: hour + 60 * minute,
      obsTimeUtc: hour + 45 * minute,
    }),
  );
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].tempC, 17);
  assert.equal(cycles[0].noaaRelayLagMs, 14 * minute);
  assert.equal(cycles[0].routineWindowStartAt, hour + 40 * minute);
  assert.equal(cycles[0].transmissionDeadlineAt, hour + 56 * minute);
});

test("report cycles recover temperature from the canonical official timeline", () => {
  const events = reportEvents({
    capmaAt: hour + 46 * minute,
    noaaAt: hour + 60 * minute,
    obsTimeUtc: hour + 45 * minute,
  }).map(({ tempC: _tempC, ...event }) => event);
  const cycles = buildOfficialReportCycles(events, [
    {
      series: "metar_speci",
      typelessHash: `report-${hour + 45 * minute}`,
      reportType: "METAR",
      eventTimeUtc: hour + 45 * minute,
      tempC: 17,
    },
  ]);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].tempC, 17);
});

test("a CAPMA report locks the temperature while NOAA is only a later relay", () => {
  const capmaAt = hour + 46 * minute;
  const cycles = buildRoutineReportCycles(
    reportEvents({ capmaAt, obsTimeUtc: hour + 45 * minute }),
  );
  const state = deriveReportCycleState({
    nowMs: capmaAt + 3 * minute,
    cycles,
    clock: {
      centerAt: capmaAt + 60 * minute,
    },
    relayLagModel: { medianLagMs: 14 * minute },
  });
  assert.equal(state.phase, "waiting_noaa");
  assert.equal(state.tdzMode, "special_watch");
  assert.equal(state.tdzActionable, true);
  assert.equal(state.relayEtaAt, capmaAt + 14 * minute);
  assert.equal(state.latestOfficialReport.tempC, 17);
});

test("the documented routine clock opens at :40 and closes at :56", () => {
  assert.equal(ROUTINE_WINDOW_OPEN_MINUTE, 40);
  assert.equal(ROUTINE_TRANSMISSION_DEADLINE_MINUTE, 56);

  const waiting = buildOperationalRoutineClock(hour + 35 * minute);
  assert.equal(waiting.active, false);
  assert.equal(waiting.displayWindow.startAt, hour + 40 * minute);
  assert.equal(waiting.displayWindow.deadlineAt, hour + 56 * minute);

  const open = deriveReportCycleState({
    nowMs: hour + 45 * minute,
    cycles: [],
    clock: { centerAt: hour + 46 * minute },
    relayLagModel: { medianLagMs: 14 * minute },
  });
  assert.equal(open.phase, "routine_window");
  assert.equal(open.routineWindowActive, true);
  assert.equal(open.targetAt, hour + 56 * minute);

  const overdue = deriveReportCycleState({
    nowMs: hour + 57 * minute,
    cycles: [],
    clock: { centerAt: hour + 46 * minute },
    relayLagModel: { medianLagMs: 14 * minute },
  });
  assert.equal(overdue.phase, "capma_overdue");
  assert.equal(overdue.targetAt, hour + 56 * minute);
});

test("only pre-CAPMA TDZ points in the focus window are emphasized", () => {
  const capmaAt = hour + 46 * minute;
  const cycles = buildRoutineReportCycles(
    reportEvents({
      capmaAt,
      noaaAt: capmaAt + 14 * minute,
      obsTimeUtc: hour + 45 * minute,
    }),
  );
  assert.equal(
    isTdzPointInFocus({
      at: capmaAt - 5 * minute,
      cycles,
      nowMs: capmaAt,
    }),
    true,
  );
  assert.equal(
    isTdzPointInFocus({
      at: capmaAt + 5 * minute,
      cycles,
      nowMs: capmaAt + 5 * minute,
    }),
    false,
  );
});

test("post-report TDZ05 stays active and marks the +2C criterion", () => {
  const capmaAt = hour + 46 * minute;
  const events = reportEvents({
    capmaAt,
    obsTimeUtc: hour + 45 * minute,
  });
  const officialReports = buildOfficialReportCycles(events);
  const routineCycles = buildRoutineReportCycles(events);
  const latestTdz = {
    at: hour + 48 * minute,
    measurementAt: hour + 47 * minute,
    tempC: 19,
  };
  const assessment = classifyTdzPoint({
    point: latestTdz,
    officialReports,
    routineCycles,
    nowMs: latestTdz.at,
  });
  assert.equal(TEMPERATURE_SPECIAL_THRESHOLD_C, 2);
  assert.equal(assessment.role, "special_criterion");
  assert.equal(assessment.temperatureRiseC, 2);
  assert.equal(assessment.specialTemperatureCriterionReached, true);

  const state = deriveReportCycleState({
    nowMs: latestTdz.at,
    cycles: routineCycles,
    officialReports,
    latestTdz,
    clock: { centerAt: hour + 106 * minute },
    relayLagModel: { medianLagMs: 14 * minute },
  });
  assert.equal(state.phase, "waiting_noaa");
  assert.equal(state.specialTemperatureCriterionReached, true);
  assert.equal(state.tdzActionable, true);
});

test("the latest SPECI becomes the temperature-watch baseline", () => {
  const events = [
    ...reportEvents({
      capmaAt: hour + 46 * minute,
      noaaAt: hour + 60 * minute,
      obsTimeUtc: hour + 45 * minute,
    }),
    {
      source: "capma_aftn_metar",
      reportType: "SPECI",
      typelessHash: "speci-2110",
      obsTimeUtc: hour + 70 * minute,
      firstObservedAt: hour + 71 * minute,
      tempC: 18,
    },
  ];
  const officialReports = buildOfficialReportCycles(events);
  const assessment = classifyTdzPoint({
    point: {
      at: hour + 73 * minute,
      measurementAt: hour + 72 * minute,
      tempC: 20,
    },
    officialReports,
    routineCycles: buildRoutineReportCycles(events),
    nowMs: hour + 73 * minute,
  });
  assert.equal(assessment.baselineReport.reportType, "SPECI");
  assert.equal(assessment.baselineReport.tempC, 18);
  assert.equal(assessment.specialTemperatureCriterionReached, true);
});

test("relay ETA uses the valid paired race median when available", () => {
  const model = buildRelayLagModel(
    {
      race: {
        measurementResolutionSeconds: 60,
        metar: {
          decisiveReportCount: 4,
          medianCapmaLeadSeconds: 869.5,
        },
      },
    },
    [],
  );
  assert.equal(model.available, true);
  assert.equal(model.medianLagMs, 869_500);
  assert.equal(model.sampleCount, 4);
  assert.equal(model.basis, "valid paired CAPMA/NOAA report races");
});
