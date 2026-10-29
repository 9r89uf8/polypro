import { createHash } from 'node:crypto';

// Pure local research helpers. No network, filesystem, scheduling, orders,
// production mutation, or claim to reproduce a market's settlement procedure.
const MINUTE = 60_000;
const SLOT = 30 * MINUTE;
const KST = 9 * 60 * MINUTE;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (reason, details = {}) => ({ ok: false, reason, ...details });

export function roundTemperatureC(value) {
  if (!finite(value)) throw new TypeError('Temperature must be finite.');
  return Math.floor(value + 0.5);
}

export function seoulDateAt(epochMs) {
  if (!finite(epochMs)) throw new TypeError('Clock must be finite.');
  return new Date(epochMs + KST).toISOString().slice(0, 10);
}

function dayStart(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new TypeError('Date must be YYYY-MM-DD.');
  const utc = Date.parse(`${date}T00:00:00Z`);
  if (!finite(utc) || new Date(utc).toISOString().slice(0, 10) !== date) throw new TypeError('Invalid calendar date.');
  return utc - KST;
}

function assertSlot(targetAt) {
  if (!finite(targetAt) || targetAt % SLOT !== 0) throw new TypeError('Target must be an exact UTC/KST half-hour boundary.');
}

export function expectedSeoulRoutineSlots(date) {
  const start = dayStart(date);
  // This is an expected research schedule, not a promise that reports will be
  // issued. Missing slots and off-schedule routine reports need separate logs.
  return Array.from({ length: 48 }, (_, index) => start + index * SLOT);
}

export function paperCaptureDates(targetAt) {
  assertSlot(targetAt);
  const date = seoulDateAt(targetAt);
  return [seoulDateAt(dayStart(date) - 1), date];
}

export function inspectRoutineMetar({ rawMetar, stationIcao = 'RKSI', obsTimeUtc, reportType, tempC }) {
  if (stationIcao !== 'RKSI' || !finite(obsTimeUtc)) return fail('invalid_station_or_observation_clock');
  if (reportType !== 'METAR') return fail('not_routine_metar');
  const raw = String(rawMetar ?? '').trim().replace(/=$/, '').replace(/\s+/g, ' ').toUpperCase();
  const header = /^(?:(METAR|SPECI) )?(?:COR )?([A-Z0-9]{4}) (\d{2})(\d{2})(\d{2})Z\b/.exec(raw);
  if (!header) return fail('unsupported_report_header');
  if (header[1] === 'SPECI') return fail('raw_type_disagrees_with_metadata');
  if (header[2] !== stationIcao) return fail('raw_station_disagrees_with_metadata');
  const stamp = new Date(obsTimeUtc);
  if (Number(header[3]) !== stamp.getUTCDate() || Number(header[4]) !== stamp.getUTCHours()
      || Number(header[5]) !== stamp.getUTCMinutes() || stamp.getUTCSeconds() || stamp.getUTCMilliseconds()) {
    return fail('raw_time_disagrees_with_metadata');
  }
  if (/\b(?:NIL|CNL)\b/.test(raw)) return fail('nil_or_cancelled_report');
  const [body, ...remarkParts] = raw.split(/\bRMK\b/);
  const bodyGroups = [...body.matchAll(/(?:^| )(M?\d{2})\/(?:M?\d{2}|\/{1,2})(?= |$)/g)];
  if (bodyGroups.length !== 1) return fail('missing_or_ambiguous_body_temperature');
  const token = bodyGroups[0][1];
  const bodyC = Number(token.replace('M', '')) * (token.startsWith('M') ? -1 : 1);
  const remarks = remarkParts.join(' RMK ');
  const tTokens = remarks.split(' ').filter(word => /^T\d/.test(word));
  if (tTokens.length > 1) return fail('ambiguous_temperature_remarks');
  let temperatureC = bodyC;
  let precision = 'body_integer';
  if (tTokens.length) {
    const match = /^T([01])(\d{3})([01])(\d{3})$/.exec(tTokens[0]);
    if (!match) return fail('unsupported_temperature_remark');
    temperatureC = Number(match[2]) / 10 * (match[1] === '1' ? -1 : 1);
    precision = 'T_remark';
    if (roundTemperatureC(temperatureC) !== bodyC) return fail('body_and_t_remark_disagree');
  }
  if (!finite(tempC) || (Math.abs(tempC - bodyC) > 1e-9 && Math.abs(tempC - temperatureC) > 1e-9)) {
    return fail('decoded_temperature_disagrees_with_raw');
  }
  return { ok: true, stationIcao, obsTimeUtc, normalizedRaw: raw, rawSha256: hash(raw),
    bodyTemperatureC: bodyC, temperatureC, roundedC: roundTemperatureC(temperatureC), precision,
    correctionMarked: /\bCOR\b/.test(raw), unlabeledRoutine: !header[1] };
}

export function prepareSeoulPaperDecision({ targetAt, snapshots, preparedAt, maxAmosAgeMs = 3 * MINUTE }) {
  assertSlot(targetAt);
  if (!finite(preparedAt) || !finite(maxAmosAgeMs) || maxAmosAgeMs <= 0 || !Array.isArray(snapshots)) {
    throw new TypeError('Explicit preparation clock, bounded freshness, and snapshots are required.');
  }
  const targetDate = seoulDateAt(targetAt);
  const decision = { method: 'rksi-local-paper-forecast-v1', targetAt, targetDate, preparedAt,
    status: 'abstained', reasons: [], warnings: [], rejectedAmos: [], rejectedReports: [],
    snapshotReferences: [],
    predictionC: null, persistenceBaselineC: null, knownLocalMaximumC: null,
    knownLocalMaximumRoundedC: null, predictsNewKnownHigh: null };
  const requiredDates = paperCaptureDates(targetAt);
  const validSnapshotDates = [];
  decision.requiredSnapshotDates = requiredDates;
  if (preparedAt >= targetAt) decision.reasons.push('prepared_at_or_after_target');
  if (!snapshots.length) decision.reasons.push('no_source_snapshots');
  const amos = [], reports = [];
  for (const [snapshotIndex, snapshot] of snapshots.entries()) {
    try { dayStart(snapshot.date); } catch { decision.reasons.push('invalid_snapshot_date'); continue; }
    const start = snapshot.queryStartedAt, received = snapshot.queryReceivedAt;
    if (!finite(start) || !finite(received) || start > received || received > preparedAt
        || !Array.isArray(snapshot.data?.amosRows) || !Array.isArray(snapshot.data?.rows)) {
      decision.reasons.push('invalid_or_future_snapshot_receipt');
      continue;
    }
    decision.snapshotReferences.push({ snapshotIndex, date: snapshot.date, queryStartedAt: start,
      queryReceivedAt: received, structuredPayloadSha256: hash(snapshot.data) });
    validSnapshotDates.push(snapshot.date);
    for (const row of snapshot.data.amosRows) {
      if (row.stationIcao !== 'RKSI' || row.rwyNo !== '2' || row.rwyDir !== '15L' || row.collectionCadence !== 'one_minute') continue;
      let reason = null;
      if (!finite(row.obsTimeUtc) || row.obsTimeUtc % MINUTE !== 0 || row.obsTimeUtc > received) reason = 'invalid_amos_observation_clock';
      else if (row.date !== snapshot.date || seoulDateAt(row.obsTimeUtc) !== row.date) reason = 'amos_date_disagrees_with_clock';
      else if (!finite(row.tempC)) reason = 'nonfinite_amos_temperature';
      else if (preparedAt - row.obsTimeUtc > maxAmosAgeMs) continue;
      if (reason) { decision.rejectedAmos.push({ obsTimeUtc: row.obsTimeUtc ?? null, reason }); continue; }
      const record = { stationIcao: row.stationIcao, obsTimeUtc: row.obsTimeUtc, temperatureC: row.tempC,
        rwyNo: row.rwyNo, rwyDir: row.rwyDir, rwyMain: row.rwyMain ?? null, rwyUse: row.rwyUse ?? null,
        collectionCadence: row.collectionCadence, rawJson: row.rawJson ?? null, updatedAt: row.updatedAt ?? null };
      amos.push({ ...record, recordSha256: hash(record), snapshotIndex, clientReceiptAt: received,
        databaseFirstSeenAt: finite(row.firstSeenAt) ? row.firstSeenAt : null });
    }
    for (const row of snapshot.data.rows) {
      if (row.stationIcao !== 'RKSI' || row.reportType === 'SPECI') continue;
      if (!finite(row.obsTimeUtc) || row.obsTimeUtc >= targetAt || row.obsTimeUtc > received
          || row.date !== snapshot.date || seoulDateAt(row.obsTimeUtc) !== row.date) {
        decision.rejectedReports.push({ obsTimeUtc: row.obsTimeUtc ?? null, date: row.date ?? null, reason: 'report_date_or_clock_invalid' });
        continue;
      }
      const parsed = inspectRoutineMetar(row);
      if (!parsed.ok) { decision.rejectedReports.push({ obsTimeUtc: row.obsTimeUtc, date: row.date, reason: parsed.reason }); continue; }
      reports.push({ ...parsed, date: row.date, snapshotIndex, clientReceiptAt: received,
        databaseCreationAt: finite(row._creationTime) ? row._creationTime : null,
        databaseUpdatedAt: finite(row.updatedAt) ? row.updatedAt : null, source: row.source ?? null });
    }
  }
  decision.missingRequiredSnapshotDates = requiredDates.filter(date => !validSnapshotDates.includes(date));
  decision.unexpectedSnapshotDates = [...new Set(validSnapshotDates.filter(date => !requiredDates.includes(date)))];
  decision.duplicateSnapshotDates = [...new Set(validSnapshotDates.filter((date, index) => validSnapshotDates.indexOf(date) !== index))];
  if (decision.missingRequiredSnapshotDates.length) decision.reasons.push('required_snapshot_date_missing');
  if (decision.unexpectedSnapshotDates.length) decision.reasons.push('unexpected_snapshot_date');
  if (decision.duplicateSnapshotDates.length) decision.reasons.push('duplicate_snapshot_date');
  if (amos.length) {
    const latestTime = Math.max(...amos.map(row => row.obsTimeUtc));
    const latest = amos.filter(row => row.obsTimeUtc === latestTime);
    if (new Set(latest.map(row => row.recordSha256)).size > 1) decision.reasons.push('ambiguous_latest_amos_versions');
    else {
      decision.selectedAmos = latest.sort((a, b) => a.clientReceiptAt - b.clientReceiptAt)[0];
      if (decision.selectedAmos.rwyMain && decision.selectedAmos.rwyMain !== '15L') decision.reasons.push('main_sensor_label_changed');
      if (!decision.selectedAmos.rwyMain) decision.warnings.push('main_sensor_label_not_recorded');
      if (decision.selectedAmos.databaseFirstSeenAt === null) decision.warnings.push('database_amos_first_seen_not_recorded');
      if (decision.selectedAmos.updatedAt > decision.selectedAmos.clientReceiptAt
          || decision.selectedAmos.databaseFirstSeenAt > decision.selectedAmos.clientReceiptAt) decision.warnings.push('database_amos_clock_ahead_of_observer');
      decision.predictionC = roundTemperatureC(decision.selectedAmos.temperatureC);
    }
  } else decision.reasons.push('no_fresh_fixed_sensor_amos');
  const byTime = new Map();
  for (const row of reports) {
    if (!byTime.has(row.obsTimeUtc)) byTime.set(row.obsTimeUtc, []);
    byTime.get(row.obsTimeUtc).push(row);
  }
  const uniqueReports = [], ambiguousTimes = [];
  for (const [time, versions] of byTime) {
    if (new Set(versions.map(row => row.rawSha256)).size > 1) ambiguousTimes.push(time);
    else uniqueReports.push(versions.sort((a, b) => a.clientReceiptAt - b.clientReceiptAt)[0]);
  }
  uniqueReports.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
  decision.ambiguousReportTimes = ambiguousTimes.sort((a, b) => a - b);
  const latestReport = uniqueReports.at(-1);
  const invalidLatest = decision.rejectedReports.some(row => finite(row.obsTimeUtc) && row.obsTimeUtc < targetAt
    && (!latestReport || row.obsTimeUtc >= latestReport.obsTimeUtc));
  if (ambiguousTimes.some(time => !latestReport || time >= latestReport.obsTimeUtc)) {
    decision.persistenceStatus = 'ambiguous_latest_report';
  } else if (invalidLatest) {
    decision.persistenceStatus = 'unsupported_latest_report';
  } else if (latestReport) {
    decision.persistenceStatus = 'available';
    decision.selectedPriorReport = latestReport;
    decision.persistenceBaselineC = latestReport.roundedC;
  } else decision.persistenceStatus = 'no_prior_report';
  const currentDay = uniqueReports.filter(row => row.date === targetDate);
  const expectedEarlier = expectedSeoulRoutineSlots(targetDate).filter(time => time < targetAt);
  decision.maximumCoverage = { expectedEarlierSlots: expectedEarlier.length,
    missingExpectedSlots: expectedEarlier.filter(time => !currentDay.some(row => row.obsTimeUtc === time)),
    knownRoutineReports: currentDay.length,
    offScheduleRoutineTimes: currentDay.filter(row => row.obsTimeUtc % SLOT !== 0).map(row => row.obsTimeUtc) };
  if (ambiguousTimes.some(time => seoulDateAt(time) === targetDate)) decision.maximumStatus = 'ambiguous_prior_versions';
  else if (decision.rejectedReports.some(row => row.date === targetDate)) decision.maximumStatus = 'unsupported_prior_report_rows';
  else if (currentDay.length) {
    decision.knownLocalMaximumC = Math.max(...currentDay.map(row => row.temperatureC));
    decision.knownLocalMaximumRoundedC = roundTemperatureC(decision.knownLocalMaximumC);
    decision.maximumStatus = decision.maximumCoverage.missingExpectedSlots.length ? 'known_maximum_with_missing_expected_reports' : 'known_maximum_expected_slots_present';
    if (decision.predictionC !== null) decision.predictsNewKnownHigh = decision.predictionC > decision.knownLocalMaximumRoundedC;
  } else decision.maximumStatus = expectedEarlier.length ? 'no_same_day_reports' : 'daily_maximum_not_initialized';
  if (!decision.reasons.length) decision.status = 'ready_to_seal';
  return decision;
}

export function inspectAwcPaperOutcome({ targetAt, rows, responseReceivedAt }) {
  assertSlot(targetAt);
  if (!finite(responseReceivedAt) || !Array.isArray(rows)) return { status: 'invalid_response', reason: 'invalid_response_clock_or_shape' };
  if (responseReceivedAt < targetAt) return { status: 'invalid_response', reason: 'response_received_before_target' };
  const matches = rows.filter(row => row?.icaoId === 'RKSI' && row.obsTime * 1000 === targetAt && row.metarType === 'METAR');
  if (!matches.length) return { status: 'routine_target_not_seen', matchingRecords: 0, responseReceivedAt };
  if (matches.length !== 1) return { status: 'ambiguous_target_versions', matchingRecords: matches.length, responseReceivedAt };
  const row = matches[0];
  if (!finite(row.obsTime)) return { status: 'invalid_target_record', reason: 'nonnumeric_observation_clock', responseReceivedAt };
  const parsed = inspectRoutineMetar({ rawMetar: row.rawOb, stationIcao: row.icaoId, obsTimeUtc: row.obsTime * 1000, reportType: row.metarType, tempC: row.temp });
  if (!parsed.ok) return { status: 'invalid_target_record', reason: parsed.reason, responseReceivedAt };
  const providerReceiptAt = Date.parse(row.receiptTime ?? '');
  return { status: 'observed_single_routine_version', ...parsed, responseReceivedAt,
    providerReceiptAt: finite(providerReceiptAt) ? providerReceiptAt : null,
    timingWarning: !finite(providerReceiptAt) || providerReceiptAt < targetAt || providerReceiptAt > responseReceivedAt ? 'provider_receipt_clock_missing_or_inconsistent' : null,
    versionMeaning: 'First matching version in this captured response; not proof of first issuance or final corrected content.' };
}

export function scoreSeoulPaperOutcome({ decision, outcome, predictionSealCompletedAt }) {
  if (decision.status !== 'ready_to_seal') return { status: 'decision_abstained', reasons: decision.reasons };
  if (!finite(predictionSealCompletedAt) || predictionSealCompletedAt < decision.preparedAt
      || predictionSealCompletedAt >= decision.targetAt) return { status: 'prediction_not_sealed_before_target' };
  if (outcome.status !== 'observed_single_routine_version') return { status: outcome.status };
  if (outcome.obsTimeUtc !== decision.targetAt || !finite(outcome.responseReceivedAt)
      || outcome.responseReceivedAt < decision.targetAt || outcome.responseReceivedAt <= predictionSealCompletedAt) return { status: 'outcome_clock_or_target_invalid' };
  return { status: 'scored_observed_version', actualC: outcome.roundedC,
    matches: decision.predictionC === outcome.roundedC,
    baselineMatches: decision.persistenceBaselineC === null ? null : decision.persistenceBaselineC === outcome.roundedC,
    isNewKnownHigh: decision.knownLocalMaximumRoundedC === null ? null : outcome.roundedC > decision.knownLocalMaximumRoundedC,
    predictsNewKnownHigh: decision.predictsNewKnownHigh,
    maximumStatus: decision.maximumStatus, correctionMarked: outcome.correctionMarked,
    versionMeaning: outcome.versionMeaning };
}
