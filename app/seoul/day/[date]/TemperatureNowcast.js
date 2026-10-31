"use client";

import { useMemo } from "react";
import { buildNowcastState, formatNowcastAge, formatNowcastError, formatNowcastTemperature, formatNowcastTime } from "./nowcastState";
import styles from "./nowcast.module.css";

function Timestamp({ value, date, seconds = false }) {
  return value ? <time dateTime={new Date(value).toISOString()}>{formatNowcastTime(value, date, { seconds })}</time> : <>—</>;
}

function Outcome({ prediction }) {
  if (prediction.status === "scored") return <>{formatNowcastTemperature(prediction.actualC)}</>;
  return <span className={styles.pending}>{prediction.status === "missing" ? "Reading missing" : "Awaiting reading"}</span>;
}

function AccuracyDetails({ state, date }) {
  const hasChecks = state.metrics.some(row => row.scoredCount > 0);
  const hasPairs = state.metrics.some(row => row.pairedCount > 0);
  return <details className={styles.details}>
    <summary>Methods, accuracy & saved results</summary>
    <p>The large number holds the latest 15L reading constant (no change). The trend test projects recent warming or cooling, then gradually reduces that rate. It is shown smaller because it has not beaten no change in saved results. This is an experimental statistical estimate, not a trained weather model.</p>
    <h3>Recorded performance{state.metricsWindowDays > 1 ? ` · past ${state.metricsWindowDays} days` : ""}</h3>
    <p>Issued {state.metricsStartDate === date ? `on ${date}` : `${state.metricsStartDate} to ${date}`}, scored against the actual 15L reading at each target minute. Lower mean absolute error (MAE) is better.</p>
    {!hasChecks ? <p className={styles.emptyResults}>No target readings have been scored yet.</p> : <div className={styles.tableScroll} role="region" aria-label="Nowcast accuracy comparison" tabIndex={0}>
      <table>
        <caption className={styles.srOnly}>Errors in degrees Celsius. Trend and paired no-change errors use the same forecast cases.</caption>
        <thead><tr><th scope="col">Ahead</th><th scope="col">Scored</th><th scope="col">No-change MAE</th><th scope="col">Paired cases</th><th scope="col">Paired days</th><th scope="col">Paired no-change MAE</th><th scope="col">Trend MAE</th></tr></thead>
        <tbody>{state.metrics.map(row => <tr key={row.horizonMinutes}>
          <th scope="row">{row.horizonMinutes} min</th><td>{row.scoredCount}</td>
          <td>{formatNowcastError(row.persistenceMaeC)}</td><td>{row.pairedCount}</td><td>{row.dayCount}</td>
          <td>{formatNowcastError(row.pairedPersistenceMaeC)}</td><td>{formatNowcastError(row.dampedMaeC)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <p className={styles.caveat}>{hasPairs ? "Paired cases compare both methods on the same targets. " : "A trend comparison needs scored forecasts from both methods. "}Recorded days may cover only part of this window. Overlapping forecasts do not establish performance across different weather or seasons.</p>
    {state.recent.length ? <>
      <h3>{state.recentResolved ? "Recent scored forecasts" : "Recent saved forecasts"}</h3>
      <div className={styles.tableScroll} role="region" aria-label="Recent nowcast outcomes" tabIndex={0}>
        <table>
          <caption className={styles.srOnly}>Up to four recent forecast issues. All times in KST; a different target date is shown explicitly.</caption>
          <thead><tr><th scope="col">Issued</th><th scope="col">Target</th><th scope="col">No change</th><th scope="col">Trend test</th><th scope="col">Actual 15L</th></tr></thead>
          <tbody>{state.recent.flatMap(issue => issue.predictions.filter(row => row.targetTimeUtc).map(row => <tr key={`${issue.issuedAt}-${row.horizonMinutes}`}>
            <td><Timestamp value={issue.issuedAt} date={date} seconds /></td>
            <th scope="row"><Timestamp value={row.targetTimeUtc} date={date} /><span className={styles.tableNote}>{row.horizonMinutes} min target</span></th>
            <td>{formatNowcastTemperature(row.estimateC)}</td>
            <td>{formatNowcastTemperature(row.dampedTrendC)}</td>
            <td><Outcome prediction={row} /></td>
          </tr>))}</tbody>
        </table>
      </div>
    </> : null}
    {state.latest?.modelVersion ? <p className={styles.version}>Saved model: {state.latest.modelVersion}</p> : null}
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
        {row.dampedTrendC !== null ? <span className={styles.trendTest}>Trend test {formatNowcastTemperature(row.dampedTrendC)}</span> : null}
        {row.status !== "pending" ? <p className={styles.outcome}>Actual: <Outcome prediction={row} /></p> : null}
      </article>)}
    </div> : null}
    {state.latest ? <div className={styles.timestamps}>
      <p><span>Issued</span> <Timestamp value={state.latest.issuedAt} date={date} seconds />{!state.isArchived ? <small>{formatNowcastAge(state.latest.issuedAt, now)}</small> : null}</p>
      <p><span>15L observed</span> <Timestamp value={state.latest.latestObservationTimeUtc} date={date} seconds />{!state.isArchived ? <small>{formatNowcastAge(state.latest.latestObservationTimeUtc, now)}</small> : null}</p>
    </div> : null}
    <p className={styles.uncertainty}>No calibrated prediction range yet; these estimates are still being evaluated.</p>
    {state.latest || state.metrics.length ? <AccuracyDetails state={state} date={date} /> : null}
    <div className={styles.footer}><span>{state.isArchived ? "Saved forecasts · selected issue date" : "Forecasts and results update automatically"}</span><span>10 · 15 · 20 minute targets</span></div>
  </section>;
}
