"use client";

import { useMemo } from "react";
import { buildNowcastState, formatNowcastAge, formatNowcastChange, formatNowcastError, formatNowcastTemperature, formatNowcastTime } from "./nowcastState";
import styles from "./nowcast.module.css";

// Each test is compared with no change only on the cases where it was available.
const TESTS = [
  { label: "Drift test", pairs: "driftPairedCount", days: "driftDayCount", baseline: "driftPairedPersistenceMaeC", test: "driftMaeC" },
  { label: "Trend test", pairs: "pairedCount", days: "dayCount", baseline: "pairedPersistenceMaeC", test: "dampedMaeC" },
];

function Timestamp({ value, date, seconds = false }) {
  return value ? <time dateTime={new Date(value).toISOString()}>{formatNowcastTime(value, date, { seconds })}</time> : <>—</>;
}

function Outcome({ prediction }) {
  if (prediction.status === "scored") return <>{formatNowcastTemperature(prediction.actualC)}</>;
  return <span className={styles.pending}>{prediction.status === "missing" ? "Reading missing" : "Awaiting reading"}</span>;
}

function Change({ row, test }) {
  return <>{formatNowcastChange(row[test.test], row[test.baseline])}
    {row[test.pairs] ? <span className={styles.tableNote}>{formatNowcastError(row[test.test])} vs {formatNowcastError(row[test.baseline])}</span> : null}</>;
}

function TimeOfDayAccuracy({ state }) {
  const excluded = state.timeOfDayExcludedDays;
  return <>
    <h3>By time of day</h3>
    <p>Grouped by each forecast’s issue time in KST. Each test is compared with no change on the cases where it was available, and a negative change means lower error. The windows are fixed clock hours, so sunrise moves within them across the seasons.</p>
    {!state.timeOfDay.some(row => TESTS.some(test => row[test.pairs] > 0)) ? <p className={styles.emptyResults}>No test forecasts have been scored by time of day yet.</p>
      : <div className={styles.tableScroll} role="region" aria-label="Nowcast accuracy by time of day" tabIndex={0}>
        <table>
          <caption className={styles.srOnly}>Change in mean absolute error against no change, by KST issue-time window and lead, with each test's error and the no-change error on the same cases.</caption>
          <thead><tr><th scope="col">Issued (KST)</th>{TESTS.flatMap(test => [
            <th key={`${test.label}-cases`} scope="col">{test.label} cases</th>,
            <th key={`${test.label}-change`} scope="col">{test.label} vs no change</th>])}</tr></thead>
          <tbody>{state.timeOfDay.map(row => <tr key={`${row.key}-${row.horizonMinutes}`}>
            <th scope="row">{row.label}<span className={styles.tableNote}>{row.horizonMinutes} min ahead</span></th>
            {TESTS.flatMap(test => [<td key={`${test.label}-cases`}>{row[test.pairs]}</td>, <td key={`${test.label}-change`}><Change row={row} test={test} /></td>])}
          </tr>)}</tbody>
        </table>
      </div>}
    {excluded ? <p className={styles.caveat}>Excludes {excluded} {excluded === 1 ? "day" : "days"} recorded before time-of-day results were kept.</p> : null}
  </>;
}

function AccuracyDetails({ state, date }) {
  const hasChecks = state.metrics.some(row => row.scoredCount > 0);
  const versions = [state.latest?.modelVersion, state.latest?.driftModelVersion].filter(Boolean);
  return <details className={styles.details}>
    <summary>Methods, accuracy & saved results</summary>
    <p>The large number holds the latest 15L reading constant (no change). Two smaller test values are scored against it on the same cases. The drift test adds the average change for this time of day and time of year, learned from 2016–2026 RKSI reports in the Iowa Environmental Mesonet archive. The trend test projects recent warming or cooling, then gradually reduces that rate. Neither replaces the large number until saved results show it beating no change. These are experimental statistical estimates, not a weather model.</p>
    <h3>Recorded performance{state.metricsWindowDays > 1 ? ` · past ${state.metricsWindowDays} days` : ""}</h3>
    <p>Issued {state.metricsStartDate === date ? `on ${date}` : `${state.metricsStartDate} to ${date}`}, scored against the actual 15L reading at each target minute. Lower mean absolute error (MAE) is better.</p>
    {!hasChecks ? <p className={styles.emptyResults}>No target readings have been scored yet.</p> : <div className={styles.tableScroll} role="region" aria-label="Nowcast accuracy comparison" tabIndex={0}>
      <table>
        <caption className={styles.srOnly}>Errors in degrees Celsius. Each test's error is compared with the no-change error on the same forecast cases.</caption>
        <thead><tr><th scope="col">Ahead</th><th scope="col" className={styles.textCell}>Method</th><th scope="col">Cases</th><th scope="col">Days</th><th scope="col">MAE</th><th scope="col">No-change MAE, same cases</th></tr></thead>
        <tbody>{state.metrics.flatMap(row => [
          <tr key={`${row.horizonMinutes}-none`}>
            <th scope="row">{row.horizonMinutes} min</th><td className={styles.textCell}>No change</td><td>{row.scoredCount}</td>
            <td>{row.scoredDayCount}</td><td>{formatNowcastError(row.persistenceMaeC)}</td><td>—</td>
          </tr>,
          ...TESTS.map(test => <tr key={`${row.horizonMinutes}-${test.label}`}>
            <th scope="row">{row.horizonMinutes} min</th><td className={styles.textCell}>{test.label}</td><td>{row[test.pairs]}</td>
            <td>{row[test.days]}</td><td>{formatNowcastError(row[test.test])}</td><td>{formatNowcastError(row[test.baseline])}</td>
          </tr>),
        ])}</tbody>
      </table>
    </div>}
    <p className={styles.caveat}>Each test is compared with no change only on the cases where that test was available. Recorded days may cover only part of this window. Overlapping forecasts do not establish performance across different weather or seasons.</p>
    <TimeOfDayAccuracy state={state} />
    {state.recent.length ? <>
      <h3>{state.recentResolved ? "Recent scored forecasts" : "Recent saved forecasts"}</h3>
      <div className={styles.tableScroll} role="region" aria-label="Recent nowcast outcomes" tabIndex={0}>
        <table>
          <caption className={styles.srOnly}>Up to four recent forecast issues. All times in KST; a different target date is shown explicitly.</caption>
          <thead><tr><th scope="col">Issued</th><th scope="col">Target</th><th scope="col">No change</th><th scope="col">Drift test</th><th scope="col">Trend test</th><th scope="col">Actual 15L</th></tr></thead>
          <tbody>{state.recent.flatMap(issue => issue.predictions.filter(row => row.targetTimeUtc).map(row => <tr key={`${issue.issuedAt}-${row.horizonMinutes}`}>
            <td><Timestamp value={issue.issuedAt} date={date} seconds /></td>
            <th scope="row"><Timestamp value={row.targetTimeUtc} date={date} /><span className={styles.tableNote}>{row.horizonMinutes} min target</span></th>
            <td>{formatNowcastTemperature(row.estimateC)}</td>
            <td>{formatNowcastTemperature(row.driftC)}</td>
            <td>{formatNowcastTemperature(row.dampedTrendC)}</td>
            <td><Outcome prediction={row} /></td>
          </tr>))}</tbody>
        </table>
      </div>
    </> : null}
    {versions.length ? <p className={styles.version}>Saved model: {versions.join(" · ")}</p> : null}
  </details>;
}

export default function TemperatureNowcast({ dashboard, date, now }) {
  const state = useMemo(() => buildNowcastState(dashboard, date, now), [dashboard, date, now]);
  const delayed = state.kind === "stale" || state.kind === "unavailable";
  const saved = state.isArchived || state.kind === "stale";
  const title = state.isArchived ? "Saved temperature nowcasts" : state.kind === "stale" ? "Last issued temperature nowcast"
    : state.kind === "future" ? "15L temperature nowcast" : "Temperature in the next 20 minutes";
  return <section className={styles.card} aria-labelledby="nowcast-heading">
    <div className={styles.header}>
      <div><span className={styles.eyebrow}>15L AMOS · EXPERIMENTAL</span><h2 id="nowcast-heading">{title}</h2></div>
      <span className={`${styles.badge} ${state.isLive ? styles.fresh : delayed ? styles.delayed : ""}`}>{state.label}</span>
    </div>
    <p className={styles.scope}>Estimates of the 15L sensor reading. Separate from official METAR temperatures and the daily high.</p>
    {state.detail ? <p className={`${styles.status} ${delayed ? styles.statusWarning : ""}`} role="status">{state.detail}</p> : null}
    {state.predictions.length ? <div className={`${styles.predictions} ${saved ? styles.saved : ""}`}>
      {state.predictions.map(row => <article key={row.horizonMinutes} className={styles.prediction} aria-label={`${row.horizonMinutes} minute ${saved ? "saved " : ""}forecast`}>
        <h3>{row.horizonMinutes} min <span>{saved ? "at issue" : "ahead"}</span></h3>
        <div className={styles.value}>{formatNowcastTemperature(row.estimateC)}</div>
        <p className={styles.target}><Timestamp value={row.targetTimeUtc} date={date} /></p>
        {row.actualLeadMinutes !== null ? <span className={styles.lead}>{Number(row.actualLeadMinutes.toFixed(1))} min from issue</span> : null}
        <span className={styles.method}>{row.method === "persistence" ? "No change · persistence" : "Estimate unavailable"}</span>
        {row.driftC !== null ? <span className={styles.testValue}>Drift test {formatNowcastTemperature(row.driftC)}</span> : null}
        {row.dampedTrendC !== null ? <span className={styles.testValue}>Trend test {formatNowcastTemperature(row.dampedTrendC)}</span> : null}
        {row.status !== "pending" ? <p className={styles.outcome}>Actual: <Outcome prediction={row} /></p> : null}
      </article>)}
    </div> : null}
    {state.latest ? <div className={styles.timestamps}>
      <p><span>Issued</span> <Timestamp value={state.latest.issuedAt} date={date} seconds />{!state.isArchived ? <small>{formatNowcastAge(state.latest.issuedAt, state.clock)}</small> : null}</p>
      <p><span>15L observed</span> <Timestamp value={state.latest.latestObservationTimeUtc} date={date} seconds />{!state.isArchived ? <small>{formatNowcastAge(state.latest.latestObservationTimeUtc, state.clock)}</small> : null}</p>
    </div> : null}
    <p className={styles.uncertainty}>No calibrated prediction range yet; these estimates are still being evaluated.</p>
    {state.latest || state.metrics.length ? <AccuracyDetails state={state} date={date} /> : null}
    <div className={styles.footer}><span>{state.isArchived ? "Saved forecasts · selected issue date" : "Forecasts and results update automatically"}</span><span>10 · 15 · 20 minute targets</span></div>
  </section>;
}
