"use client";

import { useMemo } from "react";
import { formatSeoulTime } from "./displayTime";
import ProviderForecastChart, { LineKey } from "./ProviderForecastChart";
import { buildProviderForecastState, formatHour, formatSigned, formatTemperature, skyPercentRange } from "./providerForecastState";
import card from "./nowcast.module.css";
import styles from "./providerForecasts.module.css";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const formatDay = (date) => DATE_FORMAT.format(new Date(`${date}T00:00:00Z`));
const degrees = (value) => (typeof value === "number" ? formatTemperature(value, Number.isInteger(value) ? 0 : 1) : "—");
const bias = (value) => (typeof value === "number" ? `${formatSigned(value)}${value >= 0.05 ? " warm" : value <= -0.05 ? " cool" : ""}` : "—");
const names = (ids, providers) => {
  const labels = ids.map((id) => providers.find((row) => row.id === id)?.shortLabel ?? id);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0] ?? "";
};
function minutes(value) {
  if (typeof value !== "number") return "—";
  const size = Math.abs(Math.round(value)), hours = Math.floor(size / 60), rest = size % 60;
  if (size < 30) return "On time";
  return `${hours ? `${hours} h` : ""}${hours && rest ? " " : ""}${rest ? `${rest} min` : ""} ${value < 0 ? "early" : "late"}`;
}
// Scores use the high from 9 AM; the market uses the whole day. Say so when they differ.
function earlierHigh({ officialHigh, highAfterLock }, archived) {
  if (!officialHigh || !highAfterLock || officialHigh.tempC <= highAfterLock.tempC) return "";
  return ` ${archived ? "The day’s high" : "Today’s highest report"}, ${degrees(officialHigh.tempC)}C at ${formatSeoulTime(officialHigh.time)}, came before the lock.`;
}
function headlineFor(state) {
  const high = state.actuals.highAfterLock, before = earlierHigh(state.actuals, state.kind === "archived");
  if (state.kind === "archived") {
    const closest = state.leaders.length ? `Closest through the day: ${names(state.leaders, state.providers)}, ${state.providers.find((row) => row.id === state.leaders[0]).score.maeC.toFixed(1)}° average miss.` : "";
    const hits = !high ? "" : state.highHits.length ? ` Right on the high from 9 AM (${degrees(high.tempC)}C): ${names(state.highHits, state.providers)}.`
      : state.providers.some((row) => row.score?.final) ? ` No forecast had the high from 9 AM (${degrees(high.tempC)}C) exactly.` : "";
    return `${closest}${hits}${before}`.trim();
  }
  if (!state.leaders.length) return `Scores start with the 9:00 AM reading and update every hour from the 15L sensor.${before}`;
  const leader = state.providers.find((row) => row.id === state.leaders[0]).score;
  return `Closest so far: ${names(state.leaders, state.providers)}, ${leader.maeC.toFixed(1)}° average miss over ${leader.hoursScored} hours since 9 AM.${before}`;
}

function Scoreboard({ state }) {
  const final = state.kind === "archived";
  const columns = final ? 8 : 7;
  return <div className={`${card.tableScroll} ${styles.scoreboard}`} role="region" aria-label="Forecasts locked at 9 AM and how close they are" tabIndex={0}>
    <table>
      <caption className={card.srOnly}>Each provider’s forecast as locked at 9:00 AM KST. Average miss compares each hour from 9 AM with the 15L sensor; lower is better.</caption>
      <thead><tr>
        <th scope="col">Forecast</th><th scope="col">High from 9 AM</th>{final ? <th scope="col">High result</th> : null}<th scope="col">Avg miss</th>
        <th scope="col">Bias</th><th scope="col" className={card.textCell}>Peak</th><th scope="col">Hours</th><th scope="col" className={card.textCell}>Locked from</th>
      </tr></thead>
      <tbody>{state.providers.map((provider) => {
        const label = <th scope="row"><span className={styles.providerName}><LineKey color={provider.color} dash={provider.dash} />
          <span className={styles.longName}>{provider.label}</span><span className={styles.shortName}>{provider.shortLabel}</span>
          {state.leaders.includes(provider.id) ? <span className={styles.tag}>{final ? "Closest" : "Closest so far"}</span> : null}</span></th>;
        if (!provider.hourly.length) return <tr key={provider.id}>{label}<td colSpan={columns - 1} className={`${card.textCell} ${styles.statusCell}`}>{provider.statusLabel}</td></tr>;
        const { peak, score } = provider;
        return <tr key={provider.id}>{label}
          <td>{peak ? <>{degrees(peak.highC)}{!Number.isInteger(peak.highC) ? <span className={card.tableNote}>METAR-rounded {peak.roundedC}°</span> : null}</> : "—"}</td>
          {final ? <td>{score?.final && typeof score.highErrorC === "number" ? <>{score.highErrorC === 0 ? "Exact" : formatSigned(score.highErrorC, 0)}
            <span className={card.tableNote}>Peak {minutes(score.peakErrorMinutes).toLowerCase()}</span></>
            : provider.status === "partial" ? <>—<span className={card.tableNote}>Not scored: hours missing</span></> : "—"}</td> : null}
          <td>{score?.maeC !== null && score?.maeC !== undefined ? formatTemperature(score.maeC) : "—"}</td>
          <td>{bias(score?.biasC)}</td>
          <td className={card.textCell}>{peak?.label ?? "—"}</td>
          <td>{score?.hoursScored ?? 0}</td>
          <td className={card.textCell}>{provider.sourceLabel}{provider.status === "partial" ? <span className={card.tableNote}>Some hours missing</span> : null}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

function HourTable({ state }) {
  const providers = state.providers.filter((row) => row.hourly.length);
  const hours = Array.from({ length: 24 - 9 }, (_, index) => 9 + index);
  const value = (provider, hour) => provider.hourly.find((row) => row.hour === hour) ?? null;
  return <>
    <h3>Temperature by hour</h3>
    <div className={card.tableScroll} role="region" aria-label="Forecast and observed temperature by hour" tabIndex={0}>
      <table>
        <caption className={card.srOnly}>Hourly temperatures from 9 AM. Forecast cells show the miss against the 15L sensor; positive is warmer than observed.</caption>
        <thead><tr><th scope="col">Hour</th><th scope="col">15L</th><th scope="col">METAR</th>{providers.map((provider) => <th scope="col" key={provider.id}>{provider.shortLabel}</th>)}</tr></thead>
        <tbody>{hours.map((hour) => {
          const observed = state.actuals.hourly[hour];
          return <tr key={hour}><th scope="row">{formatHour(hour)}</th><td>{formatTemperature(observed.amosC)}</td><td>{formatTemperature(observed.metarC, 0)}</td>
            {providers.map((provider) => {
              const row = value(provider, hour);
              return <td key={provider.id}>{row ? degrees(row.tempC) : "—"}{row && observed.amosC !== null ? <span className={card.tableNote}>{formatSigned(row.tempC - observed.amosC)}</span> : null}</td>;
            })}</tr>;
        })}</tbody>
      </table>
    </div>
    <h3>Cloud cover by hour</h3>
    <div className={card.tableScroll} role="region" aria-label="Forecast and observed cloud cover by hour" tabIndex={0}>
      <table>
        <caption className={card.srOnly}>Forecast cloud cover in percent of sky; KMA gives sky words only. METAR gives eighths of the sky.</caption>
        <thead><tr><th scope="col">Hour</th><th scope="col" className={card.textCell}>METAR</th>{providers.map((provider) => <th scope="col" key={provider.id} className={provider.id === "kma" ? card.textCell : undefined}>{provider.shortLabel}</th>)}</tr></thead>
        <tbody>{hours.map((hour) => {
          const sky = state.actuals.hourly[hour].sky, range = skyPercentRange(sky);
          return <tr key={hour}><th scope="row">{formatHour(hour)}</th>
            <td className={card.textCell}>{sky ? `${sky.code || sky.label}${range ? ` (${range[0]}–${range[1]}%)` : ""}` : "—"}</td>
            {providers.map((provider) => {
              const row = value(provider, hour);
              return <td key={provider.id} className={provider.id === "kma" ? card.textCell : undefined}>{row?.cloudCoverPct !== null && row?.cloudCoverPct !== undefined ? `${row.cloudCoverPct}%` : row?.sky ?? "—"}</td>;
            })}</tr>;
        })}</tbody>
      </table>
    </div>
  </>;
}

function Record({ state }) {
  const rows = state.summary;
  if (!rows.some((row) => row.days > 0)) return <p className={card.emptyResults}>No completed days have been scored yet. Each day is scored after midnight KST.</p>;
  const rebuilt = rows.reduce((total, row) => total + row.rebuiltDays, 0);
  return <>
    <div className={card.tableScroll} role="region" aria-label="Recorded forecast results" tabIndex={0}>
      <table>
        <caption className={card.srOnly}>Results of the 9 AM forecasts over the past 30 days. Highs are the highest routine METAR from 9 AM on. Lower misses are better.</caption>
        <thead><tr><th scope="col">Forecast</th><th scope="col">Days</th><th scope="col">High exact</th><th scope="col">Within 1°</th><th scope="col">Avg high miss</th>
          <th scope="col">Avg hourly miss</th><th scope="col">Bias</th><th scope="col">Avg peak-time miss</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <th scope="row"><span className={styles.providerName}><LineKey color={row.color} dash={row.dash} /><span className={styles.longName}>{row.label}</span><span className={styles.shortName}>{row.shortLabel}</span></span></th>
          <td>{row.days}</td><td>{row.highDays ? `${row.exactHighDays} of ${row.highDays}` : "—"}</td><td>{row.highDays ? `${row.withinOneDays} of ${row.highDays}` : "—"}</td>
          <td>{row.meanAbsHighErrorC !== null ? formatTemperature(row.meanAbsHighErrorC) : "—"}</td><td>{row.hourlyMaeC !== null ? formatTemperature(row.hourlyMaeC) : "—"}</td>
          <td>{bias(row.hourlyBiasC)}</td><td>{row.meanAbsPeakErrorMinutes !== null ? `${Math.round(row.meanAbsPeakErrorMinutes)} min` : "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className={card.caveat}>High columns compare each forecast with the highest routine METAR from 9 AM on, and only for forecasts with every hour from 10 AM stored. Providers can have different numbers of days. Compare them on the days they share before trusting a ranking; a few days say little.{rebuilt ? ` ${rebuilt} model days were rebuilt from Open-Meteo’s archive of the run normally current at 9:00 AM.` : ""}</p>
  </>;
}

export default function ProviderForecasts({ dashboard, date, now, amos, metar }) {
  const state = useMemo(() => buildProviderForecastState(dashboard, date, now), [dashboard, date, now]);
  const nowMinute = state.isToday && now ? ((now + 9 * 3_600_000) % 86_400_000) / 60_000 : null;
  const showModels = state.providers.some((row) => ["ecmwf", "gfs", "icon"].includes(row.id) && row.hourly.length);
  const modelsGated = state.providers.some((row) => ["ecmwf", "gfs", "icon"].includes(row.id) && row.status === "approval_required");
  const ready = state.kind === "locked" || state.kind === "archived";
  const title = !ready || state.noLock ? "Forecasts locked at 9 AM" : state.kind === "archived" ? "How the 9 AM forecasts did" : "Which forecast is closest today";
  const headline = ready && !state.noLock ? headlineFor(state) : "";
  return <section className={card.card} aria-labelledby="provider-forecasts-heading">
    <div className={card.header}>
      <div><span className={card.eyebrow}>9:00 AM FORECAST LOCK · EXPERIMENTAL</span><h2 id="provider-forecasts-heading">{title}</h2></div>
      <span className={`${card.badge} ${state.tone ? card[state.tone] : ""}`}>{state.label}</span>
    </div>
    <p className={card.scope}>Five forecasts for RKSI as they stood at 9:00 AM KST, checked against the 15L sensor at the top of every hour since. Each forecast’s high is compared in whole degrees with the highest routine METAR from 9 AM on.</p>
    {state.detail ? <p className={`${card.status} ${state.kind === "unavailable" ? card.statusWarning : ""}`} role="status">{state.detail}</p> : null}
    {headline ? <p className={styles.headline} role="status">{headline}</p> : null}
    {ready && state.providers.length ? <Scoreboard state={state} /> : null}
    {ready ? <ProviderForecastChart date={date} providers={state.providers} actuals={state.actuals} amos={amos} metar={metar} isToday={state.isToday} nowMinute={nowMinute} final={state.kind === "archived"} /> : null}
    {ready && state.providers.some((row) => row.hourly.length) ? <details className={card.details}>
      <summary>Hour by hour</summary>
      <HourTable state={state} />
    </details> : null}
    {state.kind !== "loading" && state.kind !== "future" ? <details className={card.details}>
      <summary>Method & recorded results</summary>
      <p>At 9:00 AM KST each forecast is frozen. KMA and Weather.com come from the last capture that had finished by then (KMA is checked at :05 and :35, and its 8:35 table already starts at 10 AM; Weather.com every 15 minutes). ECMWF, GFS and ICON come from Open-Meteo at 9:00 AM; at that time ECMWF’s newest run is usually the previous day’s 12Z run, six hours older than the 18Z GFS and ICON runs.</p>
      <p>Every hour from 9 AM to 11 PM is compared with the 15L sensor at the top of the hour. KMA and Weather.com publish whole degrees; rounding adds at most 0.25° to the average miss of an otherwise perfect forecast, and only a few hundredths at typical misses near 1°. The forecast high is the highest hour from 9 AM on, rounded half up; it is compared with the highest routine METAR from 9 AM on, only for forecasts with every hour from 10 AM stored, and the result is final after midnight. The market settles on routine METAR for the whole day, so on a day whose high came before 9 AM the card says so.</p>
      <p>Cloud cover: Weather.com and the models give percent of sky at the hour; KMA gives sky words only; METAR gives eighths of the sky as a range. CAVOK and NSC mean no significant low cloud, not a clear sky.</p>
      <h3>Recorded results · past 30 days</h3>
      <Record state={state} />
      {showModels ? <p className={styles.attribution}>Model data: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>; values are shown at the hour for the model grid cell nearest RKSI, otherwise unchanged. ECMWF IFS: © {date.slice(0, 4)} European Centre for Medium-Range Weather Forecasts (ECMWF), source www.ecmwf.int, CC BY 4.0; ECMWF does not accept any liability for errors or omissions. ICON: Deutscher Wetterdienst (DWD). GFS: NOAA, public domain; no endorsement implied.</p> : null}
      {state.version ? <p className={card.version}>Saved lock: {state.version}</p> : null}
    </details> : null}
    <div className={card.footer}>
      <span>{modelsGated ? "ECMWF, GFS and ICON wait for Open-Meteo approval" : "KMA · Weather.com · Open-Meteo"}</span>
      <span>Locked 9:00 AM KST · scored after midnight{state.summaryDayCount ? ` · ${state.summaryDayCount} ${state.summaryDayCount === 1 ? "day" : "days"} recorded in the 30 days to ${formatDay(date)}` : ""}</span>
    </div>
  </section>;
}
