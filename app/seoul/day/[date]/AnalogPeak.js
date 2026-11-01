"use client";

import { useMemo } from "react";
import { buildAnalogPeakState, formatCheckpoint, formatPeakRange, formatPeakTime, formatPercent } from "./analogPeakState";
import styles from "./experimentCard.module.css";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const formatDay = date => DATE_FORMAT.format(new Date(`${date}T00:00:00Z`));
const degrees = value => (typeof value === "number" ? `${value}°C` : "—");
const minutes = value => (typeof value === "number" ? `${Math.round(value)} min` : "—");
const share = value => (typeof value === "number" ? `${Math.round(value * 100)}%` : "—");
const score = value => (typeof value === "number" ? value.toFixed(3) : "—");

function Card({ title, value, line, note }) {
  return <article className={styles.prediction}>
    <h3>{title}</h3>
    <div className={styles.value}>{value}</div>
    <p className={styles.target}>{line}</p>
    {note ? <span className={styles.method}>{note}</span> : null}
  </article>;
}

function ForecastCards({ forecast }) {
  const { analog, season, checkpoint } = forecast;
  return <div className={styles.predictions}>
    <Card title="Peak first reached" value={formatPeakTime(analog.peakFirstMinutes[1])}
      line={`Most similar days ${formatPeakRange(analog.peakFirstMinutes)}`}
      note={`Season ${formatPeakTime(season.peakFirstMinutes[1])} (${formatPeakRange(season.peakFirstMinutes)})`} />
    <Card title="High still ahead" value={formatPercent(analog.peakAheadProbability)}
      line={`Chance the peak comes after ${formatCheckpoint(checkpoint)}`} note={`Season ${formatPercent(season.peakAheadProbability)}`} />
    <Card title="Likely high" value={degrees(analog.predictedMaxC)}
      line={analog.predictedMaxRangeC ? `Most similar days ${analog.predictedMaxRangeC[0]}–${analog.predictedMaxRangeC[1]}°C` : ""}
      note={`Season ${degrees(season.predictedMaxC)}`} />
  </div>;
}

// Past days near the date only: every label says "usually" or "typical" so the
// view cannot be read as today's forecast.
function SeasonCards({ season }) {
  return <div className={styles.predictions}>
    <Card title="Usually first at the high" value={formatPeakTime(season.peakFirstMinutes[1])} line={`Most past days ${formatPeakRange(season.peakFirstMinutes)}`}
      note={`${season.count} past days within 15 days of this date`} />
    <Card title="Usually last at the high" value={formatPeakTime(season.peakLastMinutes?.[1])} line={`Most past days ${formatPeakRange(season.peakLastMinutes)}`} />
    <Card title="Typical high for this date" value={degrees(season.medianMaxC)} line="Middle of past daily highs, not today’s forecast" />
  </div>;
}

function Outcome({ outcome }) {
  if (!outcome) return null;
  if (outcome.status === "missing") return <p className={styles.outcome}>Actual: not enough routine reports to score this day.</p>;
  return <p className={styles.outcome}>Actual: high {degrees(outcome.actualMaxC)}, first reported {formatPeakTime(outcome.actualPeakFirstMinutes)}
    {typeof outcome.actualPeakLastMinutes === "number" ? `, last at ${formatPeakTime(outcome.actualPeakLastMinutes)}` : ""}. Peak-time error {minutes(outcome.analog?.peakErrorMinutes)} (season {minutes(outcome.season?.peakErrorMinutes)}).</p>;
}

function Details({ state }) {
  const hasResults = state.performance.some(row => row.scoredDays > 0 || row.missingDays > 0);
  return <details className={styles.details}>
    <summary>Method & recorded results</summary>
    <p>At 9:00 AM and 12:00 PM, the card compares this morning’s routine METAR with every day within 15 days of this date in 2016–2026: temperature, change over 3 hours, dew-point spread, cloud, wind and recent precipitation. The 30 most similar days give the peak window, the chance the high is still ahead and the likely high, never below the highest report so far. “Season” uses all of those days without matching.</p>
    <p>Times are when the day’s highest whole-degree report first appeared; the high is often held for hours. In a test on 3,923 past days, similar days beat the season on whether the high was still ahead and on the exact high, but single peak times were still about two hours off either way.</p>
    <h3>Recorded results · past 30 days</h3>
    {!hasResults ? <p className={styles.emptyResults}>No completed days have been scored yet. Days are scored after KST midnight.</p>
      : <div className={styles.tableScroll} role="region" aria-label="Analog peak results" tabIndex={0}>
        <table>
          <caption className={styles.srOnly}>Scored checkpoints from the past 30 days. Peak error is in minutes; the still-ahead score is a Brier score, lower is better.</caption>
          <thead><tr><th scope="col">Checkpoint</th><th scope="col" className={styles.textCell}>Method</th><th scope="col">Days</th><th scope="col">Peak error</th><th scope="col">Range held peak</th><th scope="col">Still-ahead score</th><th scope="col">High exact</th></tr></thead>
          <tbody>{state.performance.flatMap(row => [["Similar days", row.analog], ["Season", row.season]].map(([label, side]) => <tr key={`${row.checkpoint}-${label}`}>
            <th scope="row">{formatCheckpoint(row.checkpoint)}</th><td className={styles.textCell}>{label}</td><td>{row.scoredDays}</td>
            <td>{minutes(side.peakMaeMinutes)}</td><td>{share(side.intervalCoverage)}</td><td>{score(side.brierPeakAhead)}</td><td>{share(side.maxExactShare)}</td>
          </tr>))}</tbody>
        </table>
      </div>}
    {state.performance.some(row => row.missingDays) ? <p className={styles.caveat}>Days without enough routine reports are counted as missing, not scored.</p> : null}
    {state.versions?.length ? <p className={styles.version}>Saved model: {state.versions.join(" · ")}</p> : null}
  </details>;
}

export default function AnalogPeak({ dashboard, date, now }) {
  const state = useMemo(() => buildAnalogPeakState(dashboard, date, now), [dashboard, date, now]);
  const latest = state.latest;
  const title = !latest ? "When the high usually comes" : state.isArchived ? "When the day’s high came" : "When today’s high is likely";
  return <section className={styles.card} aria-labelledby="analog-peak-heading">
    <div className={styles.header}>
      <div><span className={styles.eyebrow}>ROUTINE METAR · EXPERIMENTAL</span><h2 id="analog-peak-heading">{title}</h2></div>
      <span className={`${styles.badge} ${state.kind === "forecast" ? styles.fresh : state.kind === "unavailable" ? styles.delayed : ""}`}>{state.label}</span>
    </div>
    <p className={styles.scope}>Timing of the day’s highest whole-degree routine METAR, the reading the daily-high market settles on.</p>
    {state.detail ? <p className={`${styles.status} ${state.kind === "unavailable" ? styles.statusWarning : ""}`} role="status">{state.detail}</p> : null}
    {latest ? <ForecastCards forecast={latest} /> : state.season ? <SeasonCards season={state.season} /> : null}
    {latest ? <div className={styles.timestamps}>
      <p><span>Matched</span> {latest.conditions || "—"}</p>
      {latest.analogs.length ? <p><span>Closest days</span> {latest.analogs.map(day => `${formatDay(day.date)} (high ${day.maxC}°C at ${formatPeakTime(day.peakFirstMinutes)})`).join(" · ")}</p> : null}
      <p><span>Held</span> Similar days were last at their high around {formatPeakTime(latest.analog.peakLastMinutes?.[1])}.</p>
    </div> : null}
    {latest ? <Outcome outcome={latest.outcome} /> : null}
    {state.kind !== "loading" && state.kind !== "future" ? <Details state={state} /> : null}
    <div className={styles.footer}><span>Similar days 2016–2026 · Iowa Environmental Mesonet</span><span>9:00 AM · 12:00 PM checkpoints</span></div>
  </section>;
}
