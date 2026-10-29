import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'scripts/analyze-seoul-report-windows.mjs');
const base = Date.parse('2026-10-28T15:00:00Z');
const minute = 60_000;
const local = time => new Date(time + 9 * 60 * minute).toISOString().replace('T', ' ').slice(0, 19);
const report = (offset, tempC) => {
  const time = base + offset * minute;
  const encoded = `${tempC < 0 ? 'M' : ''}${String(Math.abs(tempC)).padStart(2, '0')}`;
  return { _id: 'private-report-id', stationIcao: 'RKSI', date: '2026-10-29', obsTimeUtc: time,
    obsTimeLocal: local(time), reportType: 'METAR', tempC,
    rawMetar: `RKSI 2815${String(offset).padStart(2, '0')}Z 00000KT CAVOK ${encoded}/M04 Q1025`,
    _creationTime: time + 4 * minute, updatedAt: time + 4 * minute };
};
const amos = (offset, tempC, collectionCadence = 'one_minute') => {
  const time = base + offset * minute;
  return { _id: 'private-amos-id', stationIcao: 'RKSI', date: '2026-10-29', obsTimeUtc: time,
    obsTimeLocal: local(time), rwyNo: '2', rwyDir: '15L', collectionCadence, tempC,
    firstSeenAt: time + 15_000, updatedAt: time + 15_000, _creationTime: time + 15_000 };
};
function withAnalysis(samples, temperatures, check) {
  const parent = path.resolve(root, 'tmp');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'seoul-window-test-'));
  try {
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'output.json');
    fs.writeFileSync(input, JSON.stringify({ summary: { date: '2026-10-29' },
      rows: [report(0, temperatures[0]), report(30, temperatures[1])], amosRows: samples }));
    execFileSync(process.execPath, [script, input, output], { stdio: 'pipe' });
    const rawOutput = fs.readFileSync(output, 'utf8');
    check(JSON.parse(rawOutput), { input, output, rawOutput });
  } finally {
    assert.ok(path.resolve(directory).startsWith(parent + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
const rowAtThirty = (result, id) => result.recipeResults.find(recipe => recipe.id === id).rows.find(row => row.targetObsTimeUtc === base + 30 * minute);

test('the complete fixed family preserves the common denominator and midnight omissions', () => {
  withAnalysis([amos(0, 9), ...Array.from({ length: 6 }, (_, i) => amos(25 + i, 10))], [9, 10], result => {
    assert.equal(result.recipeResults.length, 9);
    assert.equal(result.commonTargetCount, 1);
    for (const recipe of result.recipeResults) {
      assert.equal(recipe.allAvailableSummary.opportunities, 2);
      assert.equal(recipe.allAvailableSummary.compared, recipe.id === 'lag_0m' ? 2 : 1);
      assert.equal(recipe.commonTargetSummary.compared, 1);
      assert.equal(rowAtThirty(result, recipe.id).knownByCodedReportMinute, recipe.id !== 'lag_0m');
    }
  });
});

test('an exact positive half-degree five-minute mean rounds toward the warmer integer', () => {
  const values = [9.4, 9.5, 9.5, 9.5, 9.6];
  withAnalysis(values.map((value, i) => amos(25 + i, value)), [9, 10], result => {
    const row = rowAtThirty(result, 'preceding_5m_mean');
    assert.equal(row.predictionC, 9.5);
    assert.equal(row.predictionRoundedC, 10);
    assert.equal(row.exactMatch, true);
  });
});

test('an exact negative half-degree mean also rounds toward the warmer integer', () => {
  const values = [-2.4, -2.5, -2.5, -2.5, -2.6];
  withAnalysis(values.map((value, i) => amos(25 + i, value)), [-3, -2], result => {
    const row = rowAtThirty(result, 'preceding_5m_mean');
    assert.equal(row.predictionC, -2.5);
    assert.equal(row.predictionRoundedC, -2);
    assert.equal(row.exactMatch, true);
  });
});

test('a missing interior minute prevents a short mean rather than changing its window', () => {
  withAnalysis([amos(25, 9), amos(26, 9), amos(27, 9), amos(29, 10)], [9, 10], result => {
    assert.equal(rowAtThirty(result, 'lag_1m').status, 'compared');
    for (const id of ['preceding_2m_mean', 'preceding_5m_mean']) {
      const row = rowAtThirty(result, id);
      assert.equal(row.status, 'missing_required_minutes');
      assert.deepEqual(row.missingMinutes, ['2026-10-29 00:28:00']);
    }
  });
});

test('conflicting cadence values remain ambiguous instead of selecting the favorable temperature', () => {
  withAnalysis([amos(29, 9.5), amos(29, 9.4, 'five_minute')], [9, 10], result => {
    assert.deepEqual(result.sourceCounts.ambiguousAmosMinutes, ['2026-10-29 00:29:00']);
    assert.equal(rowAtThirty(result, 'lag_1m').status, 'missing_required_minutes');
  });
});

test('evidence omits database IDs and reruns refuse to overwrite a frozen output', () => {
  withAnalysis([amos(29, 10)], [9, 10], (result, { input, output, rawOutput }) => {
    assert.match(result.inputSha256, /^[a-f0-9]{64}$/);
    assert.match(result.scriptSha256, /^[a-f0-9]{64}$/);
    assert.ok(!rawOutput.includes('private-report-id'));
    assert.ok(!rawOutput.includes('private-amos-id'));
    assert.ok(!rawOutput.includes('"_id"'));
    assert.throws(() => execFileSync(process.execPath, [script, input, output], { stdio: 'pipe' }), /EEXIST/);
    assert.equal(fs.readFileSync(output, 'utf8'), rawOutput);
  });
});
