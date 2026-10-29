import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ConvexHttpClient } from 'convex/browser';
import {
  inspectAwcPaperOutcome, paperCaptureDates, prepareSeoulPaperDecision,
  scoreSeoulPaperOutcome, seoulDateAt,
} from './seoul-paper-forecast.mjs';

const SLOT_MS = 30 * 60_000;
const OUTCOME_WINDOW_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 60_000;
const BODY_LIMIT = 500_000;
const SOURCE_BODY_LIMIT = 4 * 1024 * 1024;
const BACKEND = 'https://striped-chipmunk-763.convex.cloud';
const AWC_URL = 'https://aviationweather.gov/api/data/metar?ids=RKSI&format=json&hours=2';
const iso = value => new Date(value).toISOString();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function writeImmutable(file, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const handle = await fs.open(file, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  return { file: path.basename(file), sha256: digest(bytes), bytes: bytes.length };
}

async function boundedBody(response, limit = BODY_LIMIT) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) {
        await reader.cancel('Response exceeds bounded research limit.');
        throw new Error(`Response exceeds ${limit} bytes`);
      }
      chunks.push(Buffer.from(item.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function createBoundedSeoulDayQuery(fetchImpl = fetch) {
  const client = new ConvexHttpClient(BACKEND, {
    fetch: async (input, init) => {
      const response = await fetchImpl(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      // The installed SDK otherwise calls response.json()/text() without a
      // byte bound. Read and cancel first, then give it only the bounded body.
      const bytes = await boundedBody(response, SOURCE_BODY_LIMIT);
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  });
  return date => client.query('seoul:getDayStationRows', { stationIcao: 'RKSI', date });
}

// Injectable I/O permits offline integration fixtures. Importing this module
// performs no request. The CLI supplies no alternative source or longer bound.
export async function runSeoulPaperProbe({ output, targetAt, now = Date.now,
  monotonicNow = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  queryDay, fetchAwc = fetch, log = value => console.log(JSON.stringify(value)) } = {}) {
  if (typeof output !== 'string' || !output.endsWith('.json')) throw new TypeError('A new .json summary path is required.');
  const startedAt = now();
  const monotonicStartedAt = monotonicNow();
  const target = targetAt ?? Math.ceil((startedAt + 1_000) / SLOT_MS) * SLOT_MS;
  const captureDates = paperCaptureDates(target);
  const deadlineAt = target + OUTCOME_WINDOW_MS;
  const monotonicDeadline = monotonicStartedAt + Math.max(0, deadlineAt - startedAt);
  const remaining = () => Math.min(deadlineAt - now(), monotonicDeadline - monotonicNow());
  const directory = output.slice(0, -5) + '.evidence';
  const summary = { recordType: 'mutable_convenience_summary', methodVersion: 'seoul-next-metar-probe-v2',
    status: 'capturing', startedAtUtc: iso(startedAt), targetNominalUtc: iso(target), date: seoulDateAt(target),
    immutableEvidenceDirectory: directory, source: BACKEND, snapshots: [], polls: [],
    scope: 'One local paper source comparison. No market requests, quotes, orders, production mutation, or recurring collector.',
    opportunityLimitation: 'The target is fixed at invocation; this script does not predeclare or account for all expected daily slots.' };
  // Only this convenience file may change during this run. An existing output
  // or evidence directory is never adopted, repaired, or overwritten.
  await fs.writeFile(output, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  const persistSummary = () => fs.writeFile(output, JSON.stringify(summary, null, 2) + '\n');
  try {
    await fs.mkdir(directory);
    const sourceCodeHashes = {};
    for (const name of ['seoul-paper-probe-runner.mjs', 'seoul-paper-forecast.mjs']) {
      sourceCodeHashes[name] = digest(await fs.readFile(new URL(name, import.meta.url)));
    }
    summary.run = await writeImmutable(path.join(directory, 'run.json'), {
      methodVersion: summary.methodVersion, startedAt, targetAt: target, targetDate: summary.date,
      captureDates, sourceCodeHashes, query: 'seoul:getDayStationRows', backend: BACKEND,
      rule: 'Latest fresh one-minute RKSI runway 2 / 15L value at preparation, at most three minutes old; nearest integer with ties warmer. Preserve ambiguous/missing inputs; no automatic sensor or cadence substitution.',
      outcome: 'First single valid routine RKSI target version observed by this bounded AWC capture; corrections/final settlement remain separate.',
      outcomeDeadlineAt: deadlineAt, firstOutcomePollNotBefore: target + POLL_INTERVAL_MS,
      monotonicStartedAtMs: monotonicStartedAt, monotonicOutcomeDeadlineMs: monotonicDeadline,
      minimumPollStartIntervalMs: POLL_INTERVAL_MS, minimumMonotonicPollStartIntervalMs: POLL_INTERVAL_MS,
      maximumResponseBytes: BODY_LIMIT, maximumSourceQueryResponseBytes: SOURCE_BODY_LIMIT,
      clocks: 'SDK query receipt, preparation, prediction file-sync completion, AWC request/headers/body completion, and provider receipt remain distinct.',
    });
    const readDay = queryDay ?? createBoundedSeoulDayQuery();
    const captureResults = await Promise.allSettled(captureDates.map(async date => {
      const queryStartedAt = now();
      let data, error;
      try { data = await readDay(date); } catch (cause) { error = String(cause.message ?? cause); }
      const queryReceivedAt = now();
      const capture = { date, queryStartedAt, queryReceivedAt, ...(error ? { error } : { data }) };
      const artifact = await writeImmutable(path.join(directory, `snapshot-${date}.json`), capture);
      return { capture, artifact };
    }));
    const captures = captureResults.filter(result => result.status === 'fulfilled').map(result => result.value);
    summary.snapshots = captures.map(({ capture, artifact }) => ({ date: capture.date,
      queryStartedAtUtc: iso(capture.queryStartedAt), queryReceivedAtUtc: iso(capture.queryReceivedAt),
      error: capture.error ?? null, ...artifact }));
    const failedWrite = captureResults.find(result => result.status === 'rejected');
    if (failedWrite) throw failedWrite.reason;
    const preparedAt = now();
    const decision = prepareSeoulPaperDecision({ targetAt: target, preparedAt,
      snapshots: captures.map(({ capture }) => capture) });
    summary.decisionPreparedAtUtc = iso(preparedAt);
    summary.actualPreparationLeadSec = (target - preparedAt) / 1000;
    if (decision.status !== 'ready_to_seal') {
      summary.status = 'abstained';
      summary.reasons = decision.reasons;
      summary.result = await writeImmutable(path.join(directory, 'result.json'), { status: summary.status, decision });
      await persistSummary();
      log({ status: summary.status, reasons: summary.reasons, target: iso(target) });
      return summary;
    }
    const prediction = { recordType: 'immutable_prepared_prediction', decision,
      snapshotArtifacts: summary.snapshots, runArtifact: summary.run,
      note: 'Preparation is not sealing. The separate seal record is written only after this file is written and fsynced.' };
    summary.prediction = await writeImmutable(path.join(directory, 'prediction.json'), prediction);
    const sealedAt = now();
    summary.predictionSealCompletedAtUtc = iso(sealedAt);
    summary.actualSealedLeadSec = (target - sealedAt) / 1000;
    summary.seal = await writeImmutable(path.join(directory, 'prediction-seal.json'), {
      recordType: 'immutable_prediction_seal', prediction: summary.prediction,
      predictionSealCompletedAt: sealedAt, preparedAt, targetAt: target,
      sealedBeforeTarget: sealedAt < target,
      clockMeaning: 'Observer wall clock sampled after prediction file write, fsync, and close; not the earlier source-query receipt.' });
    if (sealedAt < preparedAt || sealedAt >= target) {
      summary.status = 'prediction_not_sealed_before_target';
      summary.result = await writeImmutable(path.join(directory, 'result.json'), { status: summary.status,
        prediction: summary.prediction, seal: summary.seal });
      await persistSummary();
      log({ status: summary.status, target: iso(target) });
      return summary;
    }
    summary.status = 'sealed_awaiting_awc';
    summary.predictionC = decision.predictionC;
    summary.persistenceBaselineC = decision.persistenceBaselineC;
    summary.predictsNewKnownHigh = decision.predictsNewKnownHigh;
    await persistSummary();
    log({ status: summary.status, target: iso(target), sealedLeadSeconds: summary.actualSealedLeadSec,
      predictionC: decision.predictionC, baselineC: decision.persistenceBaselineC,
      predictsNewKnownHigh: decision.predictsNewKnownHigh });
    let nextRequestAt = target + POLL_INTERVAL_MS;
    let nextRequestMonotonic = monotonicStartedAt + Math.max(0, nextRequestAt - startedAt);
    while (remaining() > 0) {
      while (remaining() > 0) {
        const delay = Math.max(nextRequestAt - now(), nextRequestMonotonic - monotonicNow());
        if (delay <= 0) break;
        await sleep(Math.max(1, Math.min(30_000, delay, remaining())));
      }
      if (remaining() <= 0) break;
      const requestStartedAt = now();
      const requestStartedMonotonicMs = monotonicNow();
      const index = summary.polls.length + 1;
      const prefix = `poll-${String(index).padStart(3, '0')}`;
      const poll = { index, url: AWC_URL, requestStartedAt, requestStartedMonotonicMs };
      let bytes = null;
      try {
        const response = await fetchAwc(AWC_URL, { redirect: 'error',
          signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, Math.floor(remaining())))),
          headers: { 'User-Agent': 'PolyPro-source-research/2.0', Accept: 'application/json' } });
        poll.headersReceivedAt = now();
        poll.headersReceivedMonotonicMs = monotonicNow();
        poll.httpStatus = response.status;
        poll.httpDate = response.headers.get('date');
        poll.contentType = response.headers.get('content-type');
        bytes = await boundedBody(response);
        poll.responseCompletedAt = now();
        poll.responseCompletedMonotonicMs = monotonicNow();
      } catch (cause) {
        poll.responseCompletedAt = now();
        poll.responseCompletedMonotonicMs = monotonicNow();
        poll.error = String(cause.message ?? cause);
      }
      // The complete response bytes and their capture clocks are immutable
      // before JSON parsing, report selection, or any scoring occurs.
      if (bytes !== null) poll.body = await writeImmutable(path.join(directory, `${prefix}.body`), bytes);
      const pollArtifact = await writeImmutable(path.join(directory, `${prefix}.json`), poll);
      let outcome;
      if (poll.responseCompletedAt >= deadlineAt || poll.responseCompletedMonotonicMs >= monotonicDeadline) {
        outcome = { status: 'outside_capture_window', responseReceivedAt: poll.responseCompletedAt,
          responseCompletedMonotonicMs: poll.responseCompletedMonotonicMs, deadlineAt, monotonicDeadline };
      } else if (poll.error) outcome = { status: 'request_failed', reason: poll.error };
      else if (poll.httpStatus !== 200) outcome = { status: 'http_error', httpStatus: poll.httpStatus };
      else {
        try { outcome = inspectAwcPaperOutcome({ targetAt: target, rows: JSON.parse(bytes.toString('utf8')),
          responseReceivedAt: poll.responseCompletedAt }); }
        catch (cause) { outcome = { status: 'invalid_response', reason: String(cause.message ?? cause) }; }
      }
      const interpretation = { pollArtifact, inspectedAt: now(), outcome };
      const interpretationArtifact = await writeImmutable(path.join(directory, `${prefix}.inspection.json`), interpretation);
      summary.polls.push({ index, requestStartedAtUtc: iso(requestStartedAt),
        requestStartedMonotonicMs,
        responseCompletedAtUtc: iso(poll.responseCompletedAt), status: outcome.status,
        pollArtifact, interpretationArtifact });
      if (['observed_single_routine_version', 'ambiguous_target_versions', 'invalid_target_record', 'outside_capture_window'].includes(outcome.status)) {
        const score = scoreSeoulPaperOutcome({ decision, outcome, predictionSealCompletedAt: sealedAt });
        summary.status = score.status;
        summary.score = score;
        summary.result = await writeImmutable(path.join(directory, 'result.json'), {
          status: summary.status, prediction: summary.prediction, seal: summary.seal,
          pollArtifact, interpretationArtifact, score, completedAt: now() });
        await persistSummary();
        log({ status: summary.status, actualC: score.actualC, matches: score.matches, baselineMatches: score.baselineMatches });
        return summary;
      }
      await persistSummary();
      nextRequestAt = requestStartedAt + POLL_INTERVAL_MS;
      nextRequestMonotonic = requestStartedMonotonicMs + POLL_INTERVAL_MS;
    }
    summary.status = 'outcome_not_seen_within_window';
    summary.result = await writeImmutable(path.join(directory, 'result.json'), { status: summary.status,
      prediction: summary.prediction, seal: summary.seal, polls: summary.polls, completedAt: now() });
    await persistSummary();
    log({ status: summary.status, target: iso(target) });
    return summary;
  } catch (cause) {
    summary.status = 'error';
    summary.error = String(cause.message ?? cause);
    await persistSummary();
    throw cause;
  }
}
