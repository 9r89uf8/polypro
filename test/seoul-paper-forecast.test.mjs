import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  expectedSeoulRoutineSlots, inspectAwcPaperOutcome, inspectRoutineMetar,
  paperCaptureDates, prepareSeoulPaperDecision, roundTemperatureC,
  scoreSeoulPaperOutcome, seoulDateAt,
} from '../scripts/lib/seoul-paper-forecast.mjs';

const minute = 60_000;
const start = Date.parse('2026-10-28T15:00:00Z');
const target = start + 60 * minute;
const prepared = target - minute;
const code = time => {
  const date = new Date(time);
  return [date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()].map(value => String(value).padStart(2, '0')).join('');
};
const raw = (time, tempC, suffix = '') => `METAR RKSI ${code(time)}Z 00000KT CAVOK ${tempC < 0 ? 'M' : ''}${String(Math.abs(tempC)).padStart(2, '0')}/M04 Q1025${suffix}`;
const report = (time, tempC, override = {}) => ({ stationIcao: 'RKSI', date: seoulDateAt(time), obsTimeUtc: time,
  reportType: 'METAR', tempC, rawMetar: raw(time, tempC), _creationTime: time + 4 * minute,
  updatedAt: time + 4 * minute, source: 'noaa_tgftp:metar_integer', ...override });
const amos = (time, tempC, override = {}) => ({ stationIcao: 'RKSI', date: seoulDateAt(time), obsTimeUtc: time,
  rwyNo: '2', rwyDir: '15L', rwyMain: '15L', collectionCadence: 'one_minute', tempC,
  firstSeenAt: time + 15_000, updatedAt: time + 15_000, ...override });
function decision({ rows = [report(start, 10), report(start + 30 * minute, 11)],
  amosRows = [amos(target - 2 * minute, 11.2)], targetAt = target, preparedAt = prepared } = {}) {
  return prepareSeoulPaperDecision({ targetAt, preparedAt,
    snapshots: paperCaptureDates(targetAt).map(date => ({ date, queryStartedAt: preparedAt - 1_000,
      queryReceivedAt: preparedAt - 500,
      data: { rows: rows.filter(row => row.date === date), amosRows: amosRows.filter(row => row.date === date) } })) });
}
const awc = (time, tempC, override = {}) => ({ icaoId: 'RKSI', obsTime: time / 1000,
  metarType: 'METAR', temp: tempC, rawOb: raw(time, tempC),
  receiptTime: new Date(time + 4 * minute).toISOString(), ...override });

test('KST expected schedule has 48 slots and validates leap dates and UTC day boundaries', () => {
  const slots = expectedSeoulRoutineSlots('2026-10-29');
  assert.equal(slots.length, 48);
  assert.equal(slots[0], start);
  assert.equal(slots.at(-1), start + 47 * 30 * minute);
  assert.equal(expectedSeoulRoutineSlots('2028-02-29').length, 48);
  assert.throws(() => expectedSeoulRoutineSlots('2026-02-29'), /Invalid calendar date/);
  assert.deepEqual(paperCaptureDates(start), ['2026-10-28', '2026-10-29']);
});

test('midnight uses previous-day fresh AMOS and persistence without carrying yesterday maximum', () => {
  const d = decision({ targetAt: start, preparedAt: start - minute,
    rows: [report(start - 30 * minute, 11)], amosRows: [amos(start - 2 * minute, 11.2)] });
  assert.equal(d.status, 'ready_to_seal');
  assert.equal(d.predictionC, 11);
  assert.equal(d.persistenceBaselineC, 11);
  assert.equal(d.knownLocalMaximumC, null);
  assert.equal(d.predictsNewKnownHigh, null);
  assert.equal(d.maximumStatus, 'daily_maximum_not_initialized');
});

test('ambiguous latest AMOS versions abstain and a five-minute row is not a silent substitute', () => {
  const d = decision({ amosRows: [amos(target - 2 * minute, 11.2), amos(target - 2 * minute, 11.8)] });
  assert.equal(d.status, 'abstained');
  assert.ok(d.reasons.includes('ambiguous_latest_amos_versions'));
  const five = decision({ amosRows: [amos(target - 2 * minute, 11.2, { collectionCadence: 'five_minute' })] });
  assert.ok(five.reasons.includes('no_fresh_fixed_sensor_amos'));
});

test('a changed main-sensor label is explicit and the evaluator does not switch to 16L', () => {
  const changed = decision({ amosRows: [amos(target - 2 * minute, 11.2, { rwyMain: '16L' })] });
  assert.ok(changed.reasons.includes('main_sensor_label_changed'));
  const other = decision({ amosRows: [amos(target - 2 * minute, 11.2, { rwyNo: '3', rwyDir: '16L' })] });
  assert.ok(other.reasons.includes('no_fresh_fixed_sensor_amos'));
});

test('tenths remarks and rounded maximum use the same bucket, including negative halves', () => {
  const d = decision({ rows: [report(start, 26), report(start + 30 * minute, 27, {
    rawMetar: raw(start + 30 * minute, 27, ' RMK T00261000').replace('T00261000', 'T02651000'),
  })], amosRows: [amos(target - 2 * minute, 26.6)] });
  assert.equal(d.knownLocalMaximumC, 26.5);
  assert.equal(d.knownLocalMaximumRoundedC, 27);
  assert.equal(d.predictsNewKnownHigh, false);
  const negative = decision({ rows: [report(start, -3), report(start + 30 * minute, -2, {
    rawMetar: raw(start + 30 * minute, -2, ' RMK T10251040'),
  })], amosRows: [amos(target - 2 * minute, -2.5)] });
  assert.equal(negative.knownLocalMaximumC, -2.5);
  assert.equal(negative.persistenceBaselineC, -2);
  assert.equal(negative.predictsNewKnownHigh, false);
  assert.equal(roundTemperatureC(-2.5), -2);
});

test('raw station, UTC time, and report type must agree with source metadata', () => {
  const base = report(start + 30 * minute, 11);
  for (const [rawMetar, reason] of [
    [base.rawMetar.replace('RKSI', 'RKSS'), 'raw_station_disagrees_with_metadata'],
    [base.rawMetar.replace(code(base.obsTimeUtc), code(base.obsTimeUtc + minute)), 'raw_time_disagrees_with_metadata'],
    [base.rawMetar.replace('METAR', 'SPECI'), 'raw_type_disagrees_with_metadata'],
  ]) assert.equal(inspectRoutineMetar({ ...base, rawMetar }).reason, reason);
  assert.equal(inspectRoutineMetar({ ...base, rawMetar: `${base.rawMetar} NIL` }).reason, 'nil_or_cancelled_report');
  assert.equal(inspectRoutineMetar({ ...base, tempC: 99 }).reason, 'decoded_temperature_disagrees_with_raw');
});

test('malformed or multiple temperature remarks are not silently replaced by a convenient value', () => {
  const base = report(start + 30 * minute, 11);
  assert.equal(inspectRoutineMetar({ ...base, rawMetar: `${base.rawMetar} RMK T001` }).reason, 'unsupported_temperature_remark');
  assert.equal(inspectRoutineMetar({ ...base, rawMetar: `${base.rawMetar} RMK T01101020 T01201020` }).reason, 'ambiguous_temperature_remarks');
  assert.equal(inspectRoutineMetar({ ...base, rawMetar: `${base.rawMetar} RMK T01261040` }).reason, 'body_and_t_remark_disagree');
});

test('ambiguous prior corrections suppress baseline and maximum without deleting the AMOS forecast', () => {
  const time = start + 30 * minute;
  const d = decision({ rows: [report(start, 10), report(time, 11), report(time, 12, { rawMetar: raw(time, 12).replace('METAR ', 'METAR COR ') })] });
  assert.equal(d.status, 'ready_to_seal');
  assert.equal(d.persistenceStatus, 'ambiguous_latest_report');
  assert.equal(d.maximumStatus, 'ambiguous_prior_versions');
  assert.equal(d.persistenceBaselineC, null);
  assert.equal(d.knownLocalMaximumC, null);
});

test('a rejected latest report is not replaced by an older baseline or an understated maximum', () => {
  const time = start + 30 * minute;
  const d = decision({ rows: [report(start, 10), report(time, 11, { rawMetar: raw(time, 11).replace('METAR', 'SPECI') })] });
  assert.equal(d.persistenceStatus, 'unsupported_latest_report');
  assert.equal(d.maximumStatus, 'unsupported_prior_report_rows');
  assert.equal(d.knownLocalMaximumC, null);
});

test('multiple AWC target versions remain ambiguous, while a correction flag stays attached', () => {
  const common = { targetAt: target, responseReceivedAt: target + 5 * minute };
  assert.equal(inspectAwcPaperOutcome({ ...common, rows: [awc(target, 11), awc(target, 12)] }).status, 'ambiguous_target_versions');
  const corrected = inspectAwcPaperOutcome({ ...common, rows: [awc(target, 11, { rawOb: raw(target, 11).replace('METAR ', 'METAR COR ') })] });
  assert.equal(corrected.status, 'observed_single_routine_version');
  assert.equal(corrected.correctionMarked, true);
  assert.match(corrected.versionMeaning, /not proof of first issuance or final/);
  assert.equal(inspectAwcPaperOutcome({ ...common, rows: [awc(target, 11, { metarType: 'SPECI' })] }).status, 'routine_target_not_seen');
});

test('a saved forecast must finish sealing before the target and before the observed outcome', () => {
  const d = decision();
  const outcome = inspectAwcPaperOutcome({ targetAt: target, rows: [awc(target, 11)], responseReceivedAt: target + 5 * minute });
  assert.equal(scoreSeoulPaperOutcome({ decision: d, outcome }).status, 'prediction_not_sealed_before_target');
  assert.equal(scoreSeoulPaperOutcome({ decision: d, outcome, predictionSealCompletedAt: target + 1 }).status, 'prediction_not_sealed_before_target');
  const scored = scoreSeoulPaperOutcome({ decision: d, outcome, predictionSealCompletedAt: prepared + 500 });
  assert.equal(scored.status, 'scored_observed_version');
  assert.equal(scored.matches, true);
  assert.equal(scored.baselineMatches, true);
  assert.equal(scored.isNewKnownHigh, false);
  for (const badReceipt of [target - 500, NaN, undefined]) {
    assert.equal(scoreSeoulPaperOutcome({ decision: d, outcome: { ...outcome, responseReceivedAt: badReceipt },
      predictionSealCompletedAt: prepared + 500 }).status, 'outcome_clock_or_target_invalid');
  }
  assert.equal(inspectAwcPaperOutcome({ targetAt: target, rows: [awc(target, 11)], responseReceivedAt: target - 500 }).reason, 'response_received_before_target');
});

test('query receipts and observation dates cannot cross the decision clock unnoticed', () => {
  const d = prepareSeoulPaperDecision({ targetAt: target, preparedAt: prepared,
    snapshots: [{ date: '2026-10-29', queryStartedAt: prepared - 500, queryReceivedAt: prepared + 500,
      data: { rows: [], amosRows: [amos(target - 2 * minute, 11)] } }] });
  assert.ok(d.reasons.includes('invalid_or_future_snapshot_receipt'));
  assert.equal(decision({ preparedAt: target }).status, 'abstained');
});

test('missing or unexpected date queries differ from a successfully queried empty day', () => {
  const valid = { date: '2026-10-29', queryStartedAt: prepared - 1_000, queryReceivedAt: prepared - 500,
    data: { rows: [report(start + 30 * minute, 11)], amosRows: [amos(target - 2 * minute, 11.2)] } };
  const missing = prepareSeoulPaperDecision({ targetAt: target, preparedAt: prepared, snapshots: [valid] });
  assert.equal(missing.status, 'abstained');
  assert.deepEqual(missing.missingRequiredSnapshotDates, ['2026-10-28']);
  const emptyPrevious = { ...valid, date: '2026-10-28', data: { rows: [], amosRows: [] } };
  const complete = prepareSeoulPaperDecision({ targetAt: target, preparedAt: prepared, snapshots: [emptyPrevious, valid] });
  assert.equal(complete.status, 'ready_to_seal');
  const extra = prepareSeoulPaperDecision({ targetAt: target, preparedAt: prepared,
    snapshots: [emptyPrevious, valid, { ...emptyPrevious, date: '2026-10-27' }] });
  assert.equal(extra.status, 'abstained');
  assert.deepEqual(extra.unexpectedSnapshotDates, ['2026-10-27']);
});

test('client snapshot receipt establishes forward availability without inventing a legacy database first-seen clock', () => {
  const d = decision({ amosRows: [amos(target - 2 * minute, 11.2, { firstSeenAt: undefined, updatedAt: target + minute })] });
  assert.equal(d.status, 'ready_to_seal');
  assert.equal(d.selectedAmos.databaseFirstSeenAt, null);
  assert.ok(d.warnings.includes('database_amos_first_seen_not_recorded'));
  assert.ok(d.warnings.includes('database_amos_clock_ahead_of_observer'));
  assert.ok(d.selectedAmos.clientReceiptAt < d.preparedAt);
});

test('expected missing routine slots remain explicit in maximum coverage', () => {
  const d = decision({ rows: [report(start + 30 * minute, 11)] });
  assert.equal(d.maximumStatus, 'known_maximum_with_missing_expected_reports');
  assert.deepEqual(d.maximumCoverage.missingExpectedSlots, [start]);
});

test('the preserved 12:00 public outcome still parses as 11 C without rewriting its evidence', () => {
  const file = new URL('../docs/assets/seoul-prospective-metar-202610290300.json', import.meta.url);
  const capture = JSON.parse(fs.readFileSync(file, 'utf8'));
  const outcome = inspectAwcPaperOutcome({ targetAt: Date.parse(capture.targetNominalUtc), rows: capture.outcomeRecords,
    responseReceivedAt: Date.parse(capture.outcomeFirstSeenAtUtc) });
  assert.equal(outcome.status, 'observed_single_routine_version');
  assert.equal(outcome.roundedC, capture.actualC);
  assert.equal(outcome.roundedC, 11);
});
