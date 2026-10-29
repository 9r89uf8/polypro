import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = Date.parse('2026-10-28T15:00:00Z');
const minute = 60_000;
const local = time => new Date(time + 9 * 60 * minute).toISOString().replace('T', ' ').slice(0, 19);
const report = (offset, tempC, overrides = {}) => {
  const time = base + offset * minute;
  const utc = new Date(time);
  const code = [utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes()].map(x => String(x).padStart(2, '0')).join('');
  return { stationIcao: 'RKSI', date: '2026-10-29', obsTimeUtc: time, obsTimeLocal: local(time),
    reportType: 'METAR', rawMetar: `RKSI ${code}Z 00000KT CAVOK ${String(tempC).padStart(2, '0')}/02 Q1025`,
    tempC, _creationTime: time + 4 * minute, updatedAt: time + 4 * minute, ...overrides };
};
const amos = (offset, tempC, overrides = {}) => {
  const time = base + offset * minute;
  return { stationIcao: 'RKSI', date: '2026-10-29', obsTimeUtc: time, obsTimeLocal: local(time),
    rwyNo: '2', rwyDir: '15L', collectionCadence: 'one_minute', tempC,
    firstSeenAt: time + 15_000, _creationTime: time + 15_000, updatedAt: time + 15_000, ...overrides };
};
const analyze = (rows, amosRows) => {
  const parent = path.resolve(root, 'tmp');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'seoul-amos-test-'));
  try {
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'output.json');
    fs.writeFileSync(input, JSON.stringify({ summary: { date: '2026-10-29' }, rows, amosRows }));
    execFileSync(process.execPath, [path.join(root, 'scripts/analyze-seoul-amos-metar.mjs'), input, output], { stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(output, 'utf8'));
  } finally {
    assert.ok(path.resolve(directory).startsWith(parent + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
const target = result => result.newHighStudies.find(study => study.leadMinutes === 0).rows.find(row => row.targetObsTimeUtc === base + 60 * minute);

test('new-high baseline uses the known daily maximum rather than the latest report', () => {
  const result = analyze([report(0, 10), report(30, 8), report(60, 10)], [amos(59, 9.5)]);
  const row = target(result);
  assert.equal(row.confirmedAsOfMaximumC, 10);
  assert.equal(row.knownReportCount, 2);
  assert.equal(row.outcome, 'correct_no_new_high');
  assert.equal(row.sample.time, '2026-10-29 00:59:00');
});

test('new-high ledger records a false threshold alert and a missed increase', () => {
  const falseAlert = analyze([report(0, 9), report(30, 9), report(60, 9)], [amos(59, 9.5)]);
  assert.equal(target(falseAlert).outcome, 'false_alert');
  assert.equal(falseAlert.newHighStudies[0].falseAlerts, 1);
  const miss = analyze([report(0, 10), report(30, 10), report(60, 11)], [amos(59, 10.4)]);
  assert.equal(target(miss).outcome, 'missed_new_high');
  assert.equal(miss.newHighStudies[0].missedNewHighs, 1);
});

test('a report received after the decision cannot establish its maximum', () => {
  const late = base + 61 * minute;
  const row = target(analyze([report(0, 9), report(30, 12, { _creationTime: late, updatedAt: late }), report(60, 10)], [amos(59, 9.5)]));
  assert.equal(row.confirmedAsOfMaximumC, 9);
  assert.equal(row.outcome, 'true_alert');
});

test('an overwritten prior report causes abstention instead of a smaller historical maximum', () => {
  const row = target(analyze([report(0, 8), report(30, 10, { updatedAt: base + 61 * minute }), report(60, 9)], [amos(59, 9)]));
  assert.equal(row.outcome, 'abstained');
  assert.equal(row.confirmedAsOfMaximumC, null);
  assert.ok(row.abstentionReasons.includes('unrecoverable_prior_report_version'));
});

test('post-decision AMOS receipt or a later overwritten latest minute cannot produce an alert', () => {
  const reports = [report(0, 9), report(30, 9), report(60, 10)];
  const late = base + 61 * minute;
  const lateRow = target(analyze(reports, [amos(59, 10, { firstSeenAt: late, _creationTime: late, updatedAt: late })]));
  assert.equal(lateRow.outcome, 'abstained');
  assert.ok(lateRow.abstentionReasons.includes('no_recent_amos_available'));
  const revisedRow = target(analyze(reports, [amos(58, 9), amos(59, 10, { updatedAt: late })]));
  assert.equal(revisedRow.outcome, 'abstained');
  assert.ok(revisedRow.abstentionReasons.includes('unrecoverable_latest_amos_version'));
});

test('every retained target stays in the ledger when the signal abstains', () => {
  const result = analyze([report(0, 9), report(30, 9), report(60, 10)], [amos(59, 10)]);
  const study = result.newHighStudies[0];
  assert.equal(study.retainedReportOpportunities, 3);
  assert.equal(study.scored, 1);
  assert.equal(study.abstentions, 2);
  assert.equal(study.rows.length, 3);
  assert.equal(study.trueAlerts + study.falseAlerts + study.missedNewHighs + study.correctNoNewHigh + study.abstentions, 3);
});
