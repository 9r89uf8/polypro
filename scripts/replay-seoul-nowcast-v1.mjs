import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNowcast, NOWCAST_HORIZONS_MINUTES, NOWCAST_MODEL_VERSION } from '../convex/lib/seoulNowcastModel.js';

// Offline replay of the deployed nowcast rule over stored day exports. No
// requests, production writes, or fitting: the rule's parameters were fixed
// before these days were replayed. Each issue sees only rows first seen by then.
const [inputDir, output] = process.argv.slice(2);
if (!inputDir || !output) throw new Error('Usage: node scripts/replay-seoul-nowcast-v1.mjs <dir of day-YYYY-MM-DD.json exports> <new-output.json>');
const minute = 60_000;
const targetWaitMs = 30 * minute; // Same receipt window as first-valid-captured-15l-v1 scoring.
const issueDelayMs = 50; // Assumed scheduling delay between capture and issuance.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validTemperature = value => finite(value) && value >= -80 && value <= 60;
const local = time => new Date(time + 9 * 60 * minute).toISOString().replace('T', ' ').slice(0, 19);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const rounded = value => Math.floor(value + 0.5 + 1e-9);
const sourceFields = ['stationIcao', 'rwyNo', 'rwyDir', 'collectionCadence', 'obsTimeUtc', 'obsTimeLocal', 'source', 'rwyUse',
  'rwyMain', 'tempC', 'dewpointC', 'qnhHpa', 'windDirAvg', 'windDirMin', 'windDirMax', 'windSpeedAvg', 'windSpeedMin',
  'windSpeedMax', 'crosswind', 'headtail', 'morMeters', 'rvrMeters', 'precipMm'];

const files = (await fs.readdir(inputDir)).filter(name => /^day-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
if (!files.length) throw new Error('No day-YYYY-MM-DD.json exports (stored seoul:getDayStationRows responses) found.');
const inputs = [];
const amos = new Map();
const reportCounts = new Map();
const reportTemps = new Map();
let rowsWithoutFirstSeenAt = 0;
for (const file of files) {
  const bytes = await fs.readFile(path.join(inputDir, file));
  inputs.push({ file, sha256: sha256(bytes) });
  const day = JSON.parse(bytes.toString('utf8'));
  for (const row of day.amosRows ?? []) {
    if (row.stationIcao !== 'RKSI' || row.rwyNo !== '2' || row.rwyDir !== '15L' || row.collectionCadence !== 'one_minute'
      || !Number.isSafeInteger(row.obsTimeUtc) || row.obsTimeUtc % minute) continue;
    // Availability cannot be established without the first database receipt.
    if (!finite(row.firstSeenAt) || row.firstSeenAt < row.obsTimeUtc) { rowsWithoutFirstSeenAt += 1; continue; }
    if (amos.has(row.obsTimeUtc)) throw new Error(`Duplicate one-minute 15L row at ${local(row.obsTimeUtc)} KST.`);
    amos.set(row.obsTimeUtc, row);
  }
  for (const row of day.rows ?? []) {
    if (row.stationIcao !== 'RKSI' || row.reportType !== 'METAR' || !finite(row.tempC) || !finite(row.obsTimeUtc)
      || row.obsTimeUtc % (30 * minute)) continue;
    reportCounts.set(row.obsTimeUtc, (reportCounts.get(row.obsTimeUtc) ?? 0) + 1);
    reportTemps.set(row.obsTimeUtc, row.tempC);
  }
}
// Ambiguous duplicate report times are excluded rather than resolved.
const routineReports = new Map([...reportTemps].filter(([time]) => reportCounts.get(time) === 1));
const minutes = [...amos.keys()].sort((a, b) => a - b);
const version = row => ({
  ...Object.fromEntries(sourceFields.filter(field => row[field] !== undefined).map(field => [field, row[field]])),
  _id: `replay-${row.obsTimeUtc}`, _creationTime: row.firstSeenAt, receivedAt: row.firstSeenAt,
});

const buckets = [['00-06', 0, 6], ['06-10', 6, 10], ['10-14', 10, 14], ['14-18', 14, 18], ['18-24', 18, 24]];
const bucket = time => buckets.find(([, low, high]) => {
  const hour = new Date(time + 9 * 60 * minute).getUTCHours();
  return hour >= low && hour < high;
})[0];
const accumulators = Object.fromEntries(NOWCAST_HORIZONS_MINUTES.map(horizon => [horizon, {}]));
const metar = Object.fromEntries(NOWCAST_HORIZONS_MINUTES.map(horizon => [horizon, { pairedSlots: 0, persistenceExact: 0, dampedTrendExact: 0 }]));
const statusCounts = {};
const missingTargets = Object.fromEntries(NOWCAST_HORIZONS_MINUTES.map(horizon => [horizon, 0]));
function add(horizon, group, key, persistenceError, dampedError) {
  const target = (accumulators[horizon][group] ??= {});
  const stats = (target[key] ??= { scored: 0, persistenceAbs: 0, paired: 0, pairedPersistenceAbs: 0, dampedAbs: 0, dampedSigned: 0, dampedBetter: 0, dampedWorse: 0 });
  stats.scored += 1;
  stats.persistenceAbs += Math.abs(persistenceError);
  if (dampedError === null) return;
  stats.paired += 1;
  stats.pairedPersistenceAbs += Math.abs(persistenceError);
  stats.dampedAbs += Math.abs(dampedError);
  stats.dampedSigned += dampedError;
  if (Math.abs(dampedError) < Math.abs(persistenceError) - 1e-9) stats.dampedBetter += 1;
  if (Math.abs(dampedError) > Math.abs(persistenceError) + 1e-9) stats.dampedWorse += 1;
}

let start = 0;
for (const trigger of minutes) {
  const issuedAt = amos.get(trigger).firstSeenAt + issueDelayMs;
  while (minutes[start] < issuedAt - 61 * minute) start += 1;
  const versions = [];
  for (let index = start; index < minutes.length && minutes[index] <= issuedAt; index += 1) {
    const row = amos.get(minutes[index]);
    if (row.firstSeenAt <= issuedAt) versions.push(version(row));
  }
  const result = buildNowcast({ versions, issuedAt, triggerObsTimeUtc: trigger });
  statusCounts[result.qualityStatus] = (statusCounts[result.qualityStatus] ?? 0) + 1;
  for (const prediction of result.predictions) {
    const target = amos.get(prediction.targetTimeUtc);
    if (!target || !validTemperature(target.tempC) || target.firstSeenAt < issuedAt
      || target.firstSeenAt > prediction.targetTimeUtc + targetWaitMs) {
      missingTargets[prediction.horizonMinutes] += 1;
      continue;
    }
    const persistenceError = prediction.persistenceC - target.tempC;
    const dampedError = finite(prediction.dampedTrendC) ? prediction.dampedTrendC - target.tempC : null;
    const groups = [['all', 'all'], ['byIssueTimeKst', bucket(issuedAt)], ['byIssueDateKst', local(issuedAt).slice(0, 10)]];
    if (Math.abs(persistenceError) >= 0.5 - 1e-9) groups.push(['actualMoveAtLeast0.5C', 'all']);
    for (const [group, key] of groups) add(prediction.horizonMinutes, group, key, persistenceError, dampedError);
    if (routineReports.has(prediction.targetTimeUtc) && dampedError !== null) {
      const slot = metar[prediction.horizonMinutes];
      slot.pairedSlots += 1;
      if (rounded(prediction.persistenceC) === routineReports.get(prediction.targetTimeUtc)) slot.persistenceExact += 1;
      if (rounded(prediction.dampedTrendC) === routineReports.get(prediction.targetTimeUtc)) slot.dampedTrendExact += 1;
    }
  }
}

const fixed = value => Number(value.toFixed(4));
const summarize = stats => ({
  scored: stats.scored,
  persistenceMaeC: fixed(stats.persistenceAbs / stats.scored),
  paired: stats.paired,
  pairedPersistenceMaeC: stats.paired ? fixed(stats.pairedPersistenceAbs / stats.paired) : null,
  dampedTrendMaeC: stats.paired ? fixed(stats.dampedAbs / stats.paired) : null,
  dampedTrendBiasC: stats.paired ? fixed(stats.dampedSigned / stats.paired) : null,
  dampedTrendRelativeChange: stats.paired ? fixed(stats.dampedAbs / stats.pairedPersistenceAbs - 1) : null,
  dampedTrendBetterCases: stats.dampedBetter,
  dampedTrendWorseCases: stats.dampedWorse,
});
const horizons = Object.fromEntries(NOWCAST_HORIZONS_MINUTES.map(horizon => {
  const groups = accumulators[horizon];
  return [horizon, {
    all: summarize(groups.all.all),
    byIssueTimeKst: Object.fromEntries(buckets.map(([key]) => [key, groups.byIssueTimeKst?.[key] ? summarize(groups.byIssueTimeKst[key]) : null])),
    byIssueDateKst: Object.fromEntries(Object.entries(groups.byIssueDateKst).sort().map(([key, stats]) => [key, summarize(stats)])),
    actualMoveAtLeast05C: groups['actualMoveAtLeast0.5C'] ? summarize(groups['actualMoveAtLeast0.5C'].all) : null,
    missingTargets: missingTargets[horizon],
    nextRoutineMetarWholeDegree: metar[horizon],
  }];
}));

const scriptBytes = await fs.readFile(fileURLToPath(import.meta.url));
const modelBytes = await fs.readFile(fileURLToPath(new URL('../convex/lib/seoulNowcastModel.js', import.meta.url)));
const trendBytes = await fs.readFile(fileURLToPath(new URL('../convex/seoulHighPredictionModel.js', import.meta.url)));
const result = {
  generatedAt: new Date().toISOString(),
  purpose: 'Offline replay of the fixed nowcast rule; persistence and damped trend compared on identical scored targets.',
  modelVersion: NOWCAST_MODEL_VERSION,
  sources: { scriptSha256: sha256(scriptBytes), modelSha256: sha256(modelBytes), trendHelperSha256: sha256(trendBytes) },
  inputs,
  replayWindowKst: { firstTrigger: local(minutes[0]), lastTrigger: local(minutes.at(-1)) },
  assumptions: [
    'Each one-minute 15L row is available from its stored firstSeenAt; later revisions of a minute are not in the exports.',
    `Issuance is ${issueDelayMs} ms after the triggering capture; targets follow the deployed issue-minute rule.`,
    'Targets must be first seen after issuance and within 30 minutes of the target minute; others count as missing.',
    'Five-minute rows are excluded, matching the deployed input ledger. Adjacent minutes and days are dependent samples.',
  ],
  rowsWithoutFirstSeenAt,
  issuesByQualityStatus: statusCounts,
  horizons,
};
await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

for (const horizon of NOWCAST_HORIZONS_MINUTES) {
  const { all, byIssueTimeKst, nextRoutineMetarWholeDegree: m } = horizons[horizon];
  const times = Object.entries(byIssueTimeKst).map(([key, s]) => `${key} ${(100 * s.dampedTrendRelativeChange).toFixed(0)}%`).join(', ');
  console.log(`${horizon} min: paired ${all.paired}, persistence MAE ${all.pairedPersistenceMaeC}, damped MAE ${all.dampedTrendMaeC} (${(100 * all.dampedTrendRelativeChange).toFixed(1)}%); by KST issue time ${times}; METAR whole degree ${m.persistenceExact} vs ${m.dampedTrendExact} of ${m.pairedSlots}`);
}
