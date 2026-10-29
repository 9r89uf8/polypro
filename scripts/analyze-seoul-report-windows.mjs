import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Offline exploratory comparison only. No requests, production writes, or
// fitted rules. Every recipe below was fixed before this script was run.
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/analyze-seoul-report-windows.mjs <day.json> <new-output.json>');
const inputBytes = await fs.readFile(input);
const data = JSON.parse(inputBytes.toString('utf8'));
const minute = 60_000;
const date = data.summary?.date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Explicit summary date required.');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const local = time => new Date(time + 9 * 60 * minute).toISOString().replace('T', ' ').slice(0, 19);
const onDate = row => row.date === date && finite(row.obsTimeUtc) && local(row.obsTimeUtc).slice(0, 10) === date;
const receipt = row => finite(row.firstSeenAt) ? row.firstSeenAt : row._creationTime;
const available = row => Math.max(receipt(row) ?? Infinity, row.updatedAt ?? -Infinity);
const rounded = value => Math.floor(value + 0.5);
const actualTemperature = row => {
  const match = /\bT([01])(\d{3})([01])(\d{3})\b/.exec(row.rawMetar ?? '');
  return match ? Number(match[2]) / 10 * (match[1] === '1' ? -1 : 1) : row.tempC;
};
const amosCandidates = (data.amosRows ?? []).filter(row => row.stationIcao === 'RKSI' && row.rwyNo === '2' && row.rwyDir === '15L' && finite(row.tempC) && onDate(row));
const byMinute = new Map();
for (const row of amosCandidates) {
  if (!byMinute.has(row.obsTimeUtc)) byMinute.set(row.obsTimeUtc, []);
  byMinute.get(row.obsTimeUtc).push(row);
}
const ambiguousAmosMinutes = [];
const chosenAmos = new Map();
for (const [time, rows] of byMinute) {
  const preferred = rows.filter(row => row.collectionCadence === 'one_minute');
  const selected = preferred.length ? preferred : rows;
  if (selected.length !== 1 || rows.some(row => row.tempC !== selected[0].tempC)) {
    ambiguousAmosMinutes.push(local(time));
    continue;
  }
  chosenAmos.set(time, selected[0]);
}
// Retained AMOS temperature resolution is 0.1 C. Integer tenth arithmetic
// avoids moving an exact half-degree mean across a threshold through floating
// point summation. Do not silently apply this assumption to finer inputs.
if ([...chosenAmos.values()].some(row => Math.abs(row.tempC * 10 - Math.round(row.tempC * 10)) > 1e-8)) {
  throw new Error('This review requires AMOS values on the documented tenth-degree grid.');
}
const reportCandidates = (data.rows ?? []).filter(row => row.stationIcao === 'RKSI' && row.reportType === 'METAR' && finite(row.tempC) && onDate(row) && /^(?:METAR\s+)?(?:COR\s+)?RKSI\s+\d{6}Z\b/.test(String(row.rawMetar ?? '').trim()));
const counts = new Map();
for (const report of reportCandidates) counts.set(report.obsTimeUtc, (counts.get(report.obsTimeUtc) ?? 0) + 1);
const reports = reportCandidates.filter(row => counts.get(row.obsTimeUtc) === 1).sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

const recipes = [
  ...Array.from({ length: 6 }, (_, lag) => ({ id: `lag_${lag}m`, kind: 'single_exact_minute', offsetsBeforeTargetMinutes: [lag] })),
  ...[1, 2, 5].map(length => ({ id: `preceding_${length}m_mean`, kind: 'equal_weight_mean_of_strictly_preceding_minutes', offsetsBeforeTargetMinutes: Array.from({ length }, (_, index) => length - index) })),
];
const recipeResults = recipes.map(recipe => {
  const rows = reports.map(report => {
    const referenceAt = report.obsTimeUtc;
    const needed = recipe.offsetsBeforeTargetMinutes.map(offset => referenceAt - offset * minute);
    const samples = needed.map(time => chosenAmos.get(time));
    const missingMinutes = needed.filter((_, index) => !samples[index]).map(local);
    const prior = reports.filter(row => row.obsTimeUtc < referenceAt && finite(available(row)) && available(row) <= referenceAt);
    const overwrittenPrior = reports.filter(row => row.obsTimeUtc < referenceAt && finite(receipt(row)) && receipt(row) <= referenceAt && finite(row.updatedAt) && row.updatedAt > referenceAt);
    const knownMaximum = prior.length && !overwrittenPrior.length ? Math.max(...prior.map(actualTemperature)) : null;
    const actualC = actualTemperature(report);
    const actualRoundedC = rounded(actualC);
    if (missingMinutes.length) return { time: report.obsTimeLocal, targetObsTimeUtc: referenceAt, actualC, actualRoundedC, status: 'missing_required_minutes', missingMinutes, baselineMaximumAtTargetC: knownMaximum };
    const sumTenths = samples.reduce((sum, row) => sum + Math.round(row.tempC * 10), 0);
    const predictionC = sumTenths / (10 * samples.length);
    const predictionRoundedC = Math.floor((sumTenths + 5 * samples.length) / (10 * samples.length));
    const inputAvailableAt = Math.max(...samples.map(available));
    const baselineRoundedC = knownMaximum === null ? null : rounded(knownMaximum);
    const predictedNewHigh = baselineRoundedC === null ? null : predictionRoundedC > baselineRoundedC;
    const actualNewHigh = baselineRoundedC === null ? null : actualRoundedC > baselineRoundedC;
    const thresholdOutcome = baselineRoundedC === null ? 'no_reconstructable_same_day_baseline' : predictedNewHigh ? (actualNewHigh ? 'true_alert' : 'false_alert') : actualNewHigh ? 'missed_new_high' : 'correct_no_new_high';
    return { time: report.obsTimeLocal, targetObsTimeUtc: referenceAt, actualC, actualRoundedC, status: 'compared',
      predictionC, predictionRoundedC, exactMatch: predictionRoundedC === actualRoundedC, roundedErrorC: predictionRoundedC - actualRoundedC,
      inputAvailableAt, inputAvailableLocal: finite(inputAvailableAt) ? local(inputAvailableAt) : null,
      inputAvailableOffsetFromTargetSec: finite(inputAvailableAt) ? (inputAvailableAt - referenceAt) / 1000 : null,
      knownByCodedReportMinute: finite(inputAvailableAt) && inputAvailableAt <= referenceAt,
      knownBeforeTargetLocalReceipt: finite(inputAvailableAt) && finite(available(report)) && inputAvailableAt < available(report),
      baselineReferenceAt: referenceAt, baselineMaximumAtTargetC: knownMaximum, baselineMaximumRoundedC: baselineRoundedC,
      baselineReportCount: prior.length, predictedNewHigh, actualNewHigh, thresholdOutcome,
      samples: samples.map(row => ({ time: row.obsTimeLocal, obsTimeUtc: row.obsTimeUtc, temperatureC: row.tempC, cadence: row.collectionCadence, receiptAt: receipt(row), availableAt: available(row) })) };
  });
  return { ...recipe, rows };
});
const commonTimes = reports.map(row => row.obsTimeUtc).filter(time => recipeResults.every(result => result.rows.some(row => row.targetObsTimeUtc === time && row.status === 'compared')));
const summarize = rows => {
  const compared = rows.filter(row => row.status === 'compared');
  const threshold = compared.filter(row => row.thresholdOutcome !== 'no_reconstructable_same_day_baseline');
  return { opportunities: rows.length, compared: compared.length, missing: rows.length - compared.length,
    exactMatches: compared.filter(row => row.exactMatch).length,
    meanAbsoluteRoundedErrorC: compared.length ? compared.reduce((sum, row) => sum + Math.abs(row.roundedErrorC), 0) / compared.length : null,
    knownByCodedReportMinute: compared.filter(row => row.knownByCodedReportMinute).length,
    knownBeforeTargetLocalReceipt: compared.filter(row => row.knownBeforeTargetLocalReceipt).length,
    thresholdCompared: threshold.length, thresholdNoBaseline: compared.length - threshold.length,
    trueAlerts: threshold.filter(row => row.thresholdOutcome === 'true_alert').length,
    falseAlerts: threshold.filter(row => row.thresholdOutcome === 'false_alert').length,
    missedNewHighs: threshold.filter(row => row.thresholdOutcome === 'missed_new_high').length,
    correctNoNewHigh: threshold.filter(row => row.thresholdOutcome === 'correct_no_new_high').length };
};
for (const result of recipeResults) {
  result.allAvailableSummary = summarize(result.rows);
  result.commonTargetSummary = summarize(result.rows.filter(row => commonTimes.includes(row.targetObsTimeUtc)));
  result.mismatches = result.rows.filter(row => row.status === 'compared' && !row.exactMatch).map(row => ({ time: row.time, actualC: row.actualRoundedC, predictionC: row.predictionC, predictionRoundedC: row.predictionRoundedC }));
}
const result = {
  analysisVersion: 'rksi-report-windows-v1',
  recipeFamily: 'Nine fixed recipes specified in the exploratory 2026-10-29 follow-up; not tuned by this script.',
  scriptSha256: crypto.createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex'),
  generatedAtUtc: new Date().toISOString(), input, inputSha256: crypto.createHash('sha256').update(inputBytes).digest('hex'), date,
  method: 'Exploratory fixed-rule comparison on the retained morning sample. Exact minute lags 0..5; strictly preceding 1/2/5-minute equal means. All required minutes must exist. No fitting, imputation, or time shifts chosen to repair one report.',
  target: 'Rounded qualifying routine report temperature; not a final-day maximum forecast or reconstruction of the actual METAR processing workflow.',
  thresholdMethod: 'Compare prediction and target to the rounded maximum of locally retained routine reports available by the target coded minute. Lag0 is only known later and these are descriptive threshold outcomes, not pre-minute decisions or trades.',
  sourceCounts: { rawAmos: (data.amosRows ?? []).length, eligibleAmos: amosCandidates.length, selectedAmosMinutes: chosenAmos.size, ambiguousAmosMinutes, rawReports: (data.rows ?? []).length, reportsCompared: reports.length, excludedReportRows: (data.rows ?? []).length - reports.length },
  reportEvidence: reports.map(row => ({ time: row.obsTimeLocal, obsTimeUtc: row.obsTimeUtc,
    bodyTemperatureC: row.tempC, temperatureC: actualTemperature(row), rawMetar: row.rawMetar,
    source: row.source ?? null, receiptAt: receipt(row), availableAt: available(row), updatedAt: row.updatedAt ?? null })),
  commonTargetCount: commonTimes.length, commonTargetTimes: commonTimes.map(local), recipeResults,
  limitations: [
    'This family was specified during an exploratory 2026-10-29 follow-up after that morning had already been inspected; that day is not preregistered validation.',
    'One supplied date cannot estimate between-day variation. Serially correlated temperatures and repeated recipes are not independent validation.',
    'Lag0 AMOS rows arrived after the coded report minute. Correspondence cannot be called an advance prediction made at that minute.',
    'Each public AMOS value is already a one-minute average; another short arithmetic mean does not establish the official instrument averaging/cutoff rule.',
    'Final retained source rows are not a complete immutable as-of event log. Missing expected reports and overwritten versions can be unobserved.',
    'Rounding agreement is quantized and sensitive near half-degree thresholds; sensor resolution is not measurement accuracy.',
    'No market quotes, fills, cost-adjusted results, or causal cloud/temperature relationship are evaluated.',
  ],
};
// A research rerun must not silently overwrite its frozen input or earlier
// result. Reproduce into a new path and compare analytical fields explicitly.
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ inputSha256: result.inputSha256, sourceCounts: result.sourceCounts, commonTargetCount: result.commonTargetCount, recipes: recipeResults.map(({ id, allAvailableSummary, commonTargetSummary, mismatches }) => ({ id, allAvailableSummary, commonTargetSummary, mismatches })) }, null, 2));
