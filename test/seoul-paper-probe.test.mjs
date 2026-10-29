import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createBoundedSeoulDayQuery, runSeoulPaperProbe } from '../scripts/lib/seoul-paper-probe-runner.mjs';
import { paperCaptureDates, seoulDateAt } from '../scripts/lib/seoul-paper-forecast.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = Date.parse('2026-10-29T03:30:00Z');
const minute = 60_000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const targetRow = { icaoId: 'RKSI', metarType: 'METAR', obsTime: target / 1000, temp: 11,
  rawOb: 'METAR RKSI 290330Z 15009KT CAVOK 11/02 Q1020 NOSIG', receiptTime: '2026-10-29T03:34:20Z' };
const sourceDay = { rows: [{ _id: 'retained-local-source-id', stationIcao: 'RKSI', date: '2026-10-29',
  obsTimeUtc: target - 30 * minute, reportType: 'METAR', tempC: 11,
  rawMetar: 'RKSI 290300Z 14010KT CAVOK 11/03 Q1021 NOSIG', source: 'noaa_tgftp:metar_integer',
  _creationTime: target - 26 * minute, updatedAt: target - 26 * minute }],
amosRows: [{ stationIcao: 'RKSI', date: '2026-10-29', obsTimeUtc: target - 2 * minute,
  rwyNo: '2', rwyDir: '15L', rwyMain: '15L', collectionCadence: 'one_minute', tempC: 11.2,
  firstSeenAt: target - 2 * minute + 15_000, updatedAt: target - 2 * minute + 15_000 }] };

async function workspace(check) {
  const parent = path.resolve(root, 'tmp');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'seoul-paper-probe-test-'));
  try { await check({ directory, output: path.join(directory, 'capture.json'), evidence: path.join(directory, 'capture.evidence') }); }
  finally {
    assert.ok(path.resolve(directory).startsWith(parent + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function world(paths) {
  const state = { wall: target - 90_000, monotonic: 0, dates: [], requests: [] };
  const advance = ms => { state.wall += ms; state.monotonic += ms; };
  const options = { output: paths.output, targetAt: target, now: () => state.wall,
    monotonicNow: () => state.monotonic, sleep: async ms => advance(ms), log: () => {},
    queryDay: async date => { state.dates.push(date); advance(20); return date === seoulDateAt(target) ? sourceDay : { rows: [], amosRows: [] }; },
    fetchAwc: async url => {
      assert.equal(url, 'https://aviationweather.gov/api/data/metar?ids=RKSI&format=json&hours=2');
      state.requests.push({ wall: state.wall, monotonic: state.monotonic });
      advance(200);
      return new Response(JSON.stringify([targetRow]), { status: 200, headers: { 'content-type': 'application/json' } });
    } };
  return { state, advance, options };
}

function read(paths, file) { return JSON.parse(fs.readFileSync(path.join(paths.evidence, file), 'utf8')); }
function verifyArtifact(paths, artifact) {
  const bytes = fs.readFileSync(path.join(paths.evidence, artifact.file));
  assert.equal(sha(bytes), artifact.sha256);
  assert.equal(bytes.length, artifact.bytes);
}

test('offline capture saves both date snapshots, a synced prediction/seal, and raw poll evidence before its score', async () => {
  await workspace(async paths => {
    const { state, options } = world(paths);
    const summary = await runSeoulPaperProbe(options);
    assert.deepEqual(state.dates.sort(), paperCaptureDates(target));
    assert.equal(summary.recordType, 'mutable_convenience_summary');
    assert.equal(summary.status, 'scored_observed_version');
    assert.equal(summary.score.matches, true);
    assert.equal(summary.score.baselineMatches, true);
    for (const artifact of [summary.run, ...summary.snapshots, summary.prediction, summary.seal, summary.result]) verifyArtifact(paths, artifact);
    const stored = read(paths, `snapshot-${seoulDateAt(target)}.json`);
    assert.deepEqual(stored.data, sourceDay);
    const prediction = read(paths, 'prediction.json');
    const seal = read(paths, 'prediction-seal.json');
    assert.equal(prediction.recordType, 'immutable_prepared_prediction');
    assert.equal(prediction.actualC, undefined);
    assert.ok(seal.predictionSealCompletedAt >= prediction.decision.preparedAt);
    assert.ok(seal.predictionSealCompletedAt < target);
    const poll = read(paths, 'poll-001.json');
    verifyArtifact(paths, poll.body);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.evidence, poll.body.file), 'utf8')), [targetRow]);
    assert.equal(read(paths, 'poll-001.inspection.json').outcome.roundedC, 11);
    assert.equal(read(paths, 'run.json').maximumSourceQueryResponseBytes, 4 * 1024 * 1024);
    assert.equal(read(paths, 'run.json').maximumResponseBytes, 500_000);
  });
});

test('strict target inspection preserves but does not score contradictory raw station data', async () => {
  await workspace(async paths => {
    const { options } = world(paths);
    options.fetchAwc = async () => new Response(JSON.stringify([{ ...targetRow, rawOb: targetRow.rawOb.replace('RKSI', 'RKSS') }]));
    const summary = await runSeoulPaperProbe(options);
    assert.equal(summary.status, 'invalid_target_record');
    assert.equal(summary.score.matches, undefined);
    assert.equal(read(paths, 'poll-001.inspection.json').outcome.reason, 'raw_station_disagrees_with_metadata');
    assert.ok(fs.existsSync(path.join(paths.evidence, 'poll-001.body')));
  });
});

test('a failed required query is recorded and abstains before any AWC request', async () => {
  await workspace(async paths => {
    const { state, options } = world(paths);
    const successful = options.queryDay;
    options.queryDay = async date => { if (date === paperCaptureDates(target)[0]) throw new Error('fixture source failure'); return successful(date); };
    const summary = await runSeoulPaperProbe(options);
    assert.equal(summary.status, 'abstained');
    assert.ok(summary.reasons.includes('required_snapshot_date_missing'));
    assert.equal(state.requests.length, 0);
    assert.match(read(paths, `snapshot-${paperCaptureDates(target)[0]}.json`).error, /fixture source failure/);
    assert.equal(fs.existsSync(path.join(paths.evidence, 'prediction.json')), false);
  });
});

test('a seal completed after the target cannot start outcome collection', async () => {
  await workspace(async paths => {
    const { state, options } = world(paths);
    options.now = () => fs.existsSync(path.join(paths.evidence, 'prediction.json')) ? target + 1 : target - 90_000;
    const summary = await runSeoulPaperProbe(options);
    assert.equal(summary.status, 'prediction_not_sealed_before_target');
    assert.equal(read(paths, 'prediction-seal.json').sealedBeforeTarget, false);
    assert.equal(state.requests.length, 0);
  });
});

test('existing summary and evidence paths are not adopted or overwritten', async () => {
  await workspace(async paths => {
    const { state, options } = world(paths);
    fs.writeFileSync(paths.output, 'previous result');
    await assert.rejects(runSeoulPaperProbe(options), /EEXIST/);
    assert.equal(fs.readFileSync(paths.output, 'utf8'), 'previous result');
    assert.equal(state.dates.length, 0);
    const other = { ...paths, output: path.join(paths.directory, 'other.json'), evidence: path.join(paths.directory, 'other.evidence') };
    fs.mkdirSync(other.evidence);
    fs.writeFileSync(path.join(other.evidence, 'sentinel'), 'preserve');
    await assert.rejects(runSeoulPaperProbe({ ...options, output: other.output }), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(other.evidence, 'sentinel'), 'utf8'), 'preserve');
    assert.equal(state.dates.length, 0);
  });
});

test('a prediction-file collision cannot overwrite evidence or proceed to outcome requests', async () => {
  await workspace(async paths => {
    const { state, options } = world(paths);
    const source = options.queryDay;
    options.queryDay = async date => {
      const collision = path.join(paths.evidence, 'prediction.json');
      if (!fs.existsSync(collision)) fs.writeFileSync(collision, 'reserved prior evidence', { flag: 'wx' });
      return source(date);
    };
    await assert.rejects(runSeoulPaperProbe(options), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(paths.evidence, 'prediction.json'), 'utf8'), 'reserved prior evidence');
    assert.equal(state.requests.length, 0);
  });
});

test('oversized and invalid JSON AWC responses remain failures with retained evidence, not false missing reports', async () => {
  await workspace(async paths => {
    const { state, advance, options } = world(paths);
    let cancelled = false;
    options.fetchAwc = async () => {
      state.requests.push({ wall: state.wall, monotonic: state.monotonic }); advance(200);
      if (state.requests.length === 1) return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(500_001)); }, cancel() { cancelled = true; },
      }));
      if (state.requests.length === 2) return new Response('not-json');
      return new Response(JSON.stringify([targetRow]));
    };
    const summary = await runSeoulPaperProbe(options);
    assert.equal(cancelled, true);
    assert.deepEqual(summary.polls.map(poll => poll.status), ['request_failed', 'invalid_response', 'observed_single_routine_version']);
    assert.match(read(paths, 'poll-001.json').error, /500000/);
    assert.equal(fs.readFileSync(path.join(paths.evidence, 'poll-002.body'), 'utf8'), 'not-json');
    assert.equal(summary.status, 'scored_observed_version');
  });
});

test('a wall-clock jump cannot shorten the monotonic minimum request interval', async () => {
  await workspace(async paths => {
    const { state, advance, options } = world(paths);
    options.fetchAwc = async () => {
      state.requests.push({ wall: state.wall, monotonic: state.monotonic }); advance(200);
      if (state.requests.length === 1) { state.wall += 120_000; return new Response('[]'); }
      return new Response(JSON.stringify([targetRow]));
    };
    const summary = await runSeoulPaperProbe(options);
    assert.equal(summary.status, 'scored_observed_version');
    assert.ok(state.requests[1].monotonic - state.requests[0].monotonic >= 60_000);
    assert.ok(read(paths, 'poll-002.json').requestStartedMonotonicMs - read(paths, 'poll-001.json').requestStartedMonotonicMs >= 60_000);
  });
});

test('responses completed at the wall or monotonic deadline are retained but never scored', async () => {
  for (const lateClock of ['wall', 'monotonic']) await workspace(async paths => {
    const { state, options } = world(paths);
    options.fetchAwc = async () => {
      if (lateClock === 'wall') state.wall = target + 10 * minute;
      else state.monotonic = 90_000 + 10 * minute;
      return new Response(JSON.stringify([targetRow]));
    };
    const summary = await runSeoulPaperProbe(options);
    assert.equal(summary.status, 'outside_capture_window');
    assert.equal(summary.score.matches, undefined);
    assert.ok(fs.existsSync(path.join(paths.evidence, 'poll-001.body')));
    assert.equal(read(paths, 'poll-001.inspection.json').outcome.status, 'outside_capture_window');
  });
});

test('a missing target stops after the bounded nine possible minute polls', async () => {
  await workspace(async paths => {
    const { state, advance, options } = world(paths);
    options.fetchAwc = async () => { state.requests.push(state.wall); advance(200); return new Response('[]'); };
    const summary = await runSeoulPaperProbe(options);
    assert.equal(summary.status, 'outcome_not_seen_within_window');
    assert.equal(state.requests.length, 9);
    assert.equal(summary.polls.length, 9);
    assert.ok(state.requests.every(time => time < target + 10 * minute));
  });
});

test('default Convex transport enforces its separate byte cap before SDK JSON parsing', async () => {
  let cancelled = false;
  const oversized = createBoundedSeoulDayQuery(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  })));
  await assert.rejects(oversized('2026-10-29'), /4194304/);
  assert.equal(cancelled, true);
  const valid = createBoundedSeoulDayQuery(async () => new Response(JSON.stringify({ status: 'success', value: { rows: [], amosRows: [] }, logLines: [] })));
  assert.deepEqual(await valid('2026-10-29'), { rows: [], amosRows: [] });
});
