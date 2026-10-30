"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TemperatureChart from "./TemperatureChart";
import MarketChart from "./MarketChart";
import SatelliteLoop from "./SatelliteLoop";
import { buildForecastHistory, buildMarketHistory } from "./historyData";
import { formatDayMinute, formatSeoulTime } from "./displayTime";
import { buildTemperatureSeries, summarizeClouds, summarizeForecast, summarizeSatelliteCloudTrend, summarizeSeoulMarket, summarizeSunlight } from "./dashboardData";
import styles from "./dashboard.module.css";

const STATION = { stationIcao: "RKSI" };
const EMPTY_ROWS = [];
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
const longDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", weekday: "long", day: "numeric", month: "long" });
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function shiftedDate(date, offset) {
  if (!validDate(date)) return "";
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}
function timeLabel(time) { return formatSeoulTime(time); }
function temperature(value, decimal = false) { return Number.isFinite(value) ? `${decimal ? value.toFixed(1) : value.toLocaleString("en-US", { maximumFractionDigits: 1 })}°` : "—"; }
function hourLabel(hour) { return formatDayMinute(hour * 60); }
function peakLabel(windows) {
  if (!windows?.length) return "Peak time unavailable";
  return windows.map(({ startHour, endHour }) => startHour === endHour ? hourLabel(startHour) : `${hourLabel(startHour)}–${hourLabel(endHour)}`).join(" · ");
}
function SeoulClock() {
  const [now, setNow] = useState(null);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  return <div className={styles.clock}>
    <span className={styles.eyebrow}>Time in Seoul <span className={styles.timezone}>KST · UTC+9</span></span>
    <time dateTime={now ? new Date(now).toISOString() : undefined}>{now ? formatSeoulTime(now, { seconds: true }) : "—"}</time>
    <span className={styles.clockDate}>{now ? longDateFormatter.format(now) : "Seoul local time"}</span>
  </div>;
}
function CloudVisual({ minimum, maximum, label }) {
  const known = Number.isFinite(minimum) && Number.isFinite(maximum);
  return <div className={styles.cloudVisual} role="img" aria-label={known ? `${label}: ${minimum === maximum ? minimum : `${minimum} to ${maximum}`} eighths of the sky covered` : `${label}. Total sky coverage is not reported.`}>
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="52" fill="#111f33" />
      {Array.from({ length: 8 }, (_, i) => <circle key={i} cx="60" cy="60" r="48" fill="none" strokeWidth="5" stroke={!known ? "#40516b" : i < minimum ? "#b6d9ef" : i < maximum ? "#66869e" : "#26394d"} strokeDasharray="31 271" strokeDashoffset={-i * 37.7} transform="rotate(-88 60 60)" />)}
      {known && maximum <= 4 ? <circle cx="51" cy="48" r="13" fill="#edbf74" /> : null}
      <path d="M37 76a12 12 0 0 1-1-24 18 18 0 0 1 34-7 15 15 0 0 1 18 16 8 8 0 0 1-3 15Z" fill={known && maximum > 0 ? "#b8cce0" : "none"} fillOpacity={known ? Math.max(0.16, maximum / 8) : 0} stroke={known ? "#b8cce0" : "#72849b"} strokeWidth="2" strokeDasharray={known ? undefined : "4 4"} />
      {!known ? <text x="61" y="67" textAnchor="middle" fill="#c1cddd" fontSize="23" fontFamily="sans-serif">?</text> : null}
    </svg><span>{known ? `${minimum === maximum ? minimum : `${minimum}–${maximum}`} / 8 sky cover` : "Coverage unknown"}</span>
  </div>;
}

function ForecastHistory({ history, currentHighC }) {
  if (!history.first) return <p className={styles.forecastHistoryEmpty} role="status">{history.message}</p>;
  const { first, latest, changes, deltaC, truncated } = history;
  const count = changes.length - 1;
  const amount = (value) => `${value > 0 ? "+" : ""}${Number(value.toFixed(2))}°C`;
  const matches = Number.isFinite(currentHighC) && Math.abs(currentHighC - latest.highC) < 0.001;
  const headline = truncated ? "Partial forecast history"
    : count === 0 ? history.captureCount > 1 ? "No change in captured highs" : "First forecast capture"
      : deltaC === 0 ? `Back to ${temperature(first.highC)}C`
        : `${deltaC > 0 ? "Raised" : "Lowered"} ${amount(Math.abs(deltaC)).replace("+", "")}`;
  return <div className={styles.forecastHistory}>
    <strong className={styles.forecastChange}>{headline}</strong>
    <p>{count > 0 ? <>{temperature(first.highC)}C → {temperature(latest.highC)}C <span>since {timeLabel(first.capturedAt)}</span></>
      : <>Captured {timeLabel(first.capturedAt)} <span>KST</span></>}
      {!matches ? <span> · recorded history</span> : null}</p>
    <details className={styles.forecastDetails}>
      <summary>Captured highs{count ? ` · ${count} ${count === 1 ? "change" : "changes"}` : ""}</summary>
      <ol>{changes.map((point, index) => <li key={point.capturedAt}>
        <time dateTime={new Date(point.capturedAt).toISOString()}>{timeLabel(point.capturedAt)}</time>
        <strong>{temperature(point.highC)}C</strong><span>{index === 0 ? truncated ? "First retained" : "First captured" : amount(point.deltaC)}</span>
      </li>)}</ol>
      <p>Collection times in KST; the change may have occurred between checks.</p>
      {history.hasGaps ? <p>Some checks had no usable high.</p> : null}
      {truncated ? <p>Earlier captures are missing; a full-day change cannot be calculated.</p> : null}
    </details>
    <span className={styles.forecastLastCheck}>Last usable capture {timeLabel(latest.capturedAt)} KST</span>
  </div>;
}

function SeoulMarket({ market, history, date, isToday }) {
  const eventUrl = history.eventUrl ?? market.eventUrl;
  const quoteTitle = (side, row) => row[`${side}Label`] === "—" ? "No fresh quote available." : row[`${side}Size`] !== null
    ? `${row[`${side}Size`]} shares available when checked at ${timeLabel(row.bookReceivedAt)} KST.`
    : row.bookReceivedAt ? `Checked at ${timeLabel(row.bookReceivedAt)} KST; available size unknown.` : "No fresh quote available.";
  return <section className={styles.marketCard} aria-labelledby="market-heading">
    <div className={styles.marketHeader}><div><span className={styles.eyebrow}>POLYMARKET</span><h2 id="market-heading">Seoul temperature market</h2></div>
      {eventUrl ? <a href={eventUrl} target="_blank" rel="noreferrer" className={styles.marketLink}>Event & rules ↗</a> : null}
    </div>
    {history.series.length ? <MarketChart history={history} date={date} /> : <div className={styles.marketEmpty} role="status"><strong>{history.label}</strong><p>{history.message}</p></div>}
    {isToday && market.markets.length ? <details className={styles.quoteDetails}>
      <summary>Current quotes & last trades</summary>
      <div className={styles.marketTableScroll} role="region" aria-label="Seoul market YES prices" tabIndex={0}>
        <table className={styles.marketTable}>
          <caption className={styles.srOnly}>Today’s Seoul temperature outcomes. YES bid, ask, and last-trade prices are in cents.</caption>
          <thead><tr><th scope="col">Temperature</th><th scope="col">YES bid</th><th scope="col">YES ask</th><th scope="col">Last trade</th></tr></thead>
          <tbody>{market.markets.map((row) => <tr key={row.marketId}>
            <th scope="row">{row.label}</th>
            <td title={quoteTitle("bid", row)}>{row.bidLabel}</td>
            <td title={quoteTitle("ask", row)}>{row.askLabel}</td>
            <td title={row.lastTradeReceivedAt ? `Price retrieved at ${timeLabel(row.lastTradeReceivedAt)} KST. The endpoint does not supply the execution time.` : "No fresh last-trade price available."}>{row.lastLabel}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className={styles.marketNote}>Resolution: AWC routine reports for RKSI · SPECI excluded. Last trade is separate from current quotes.</p>
    </details> : null}
    <div className={styles.marketFooter}><span>{history.label}</span><span>{history.latestAt ? `Last usable sample ${timeLabel(history.latestAt)} KST` : "Awaiting recorded prices"}</span></div>
  </section>;
}

export default function SeoulDayPage() {
  const params = useParams();
  const router = useRouter();
  const date = String(params?.date ?? "");
  const dateValid = validDate(date);
  const [now, setNow] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const enteredDate = useRef(null);
  const refreshInFlight = useRef(false);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  const today = now ? dateFormatter.format(now) : "";
  const isToday = dateValid && date === today;
  const isPast = Boolean(today && date < today);
  const nowMinute = isToday && now ? ((now + 9 * 3600000) % 86400000) / 60000 : null;
  const day = useQuery("seoul:getDayStationRows", dateValid ? { ...STATION, date } : "skip");
  const forecastDashboard = useQuery("seoulWeather:getHighPredictionDashboard", dateValid ? { ...STATION, date } : "skip");
  const solarDashboard = useQuery("seoulGk2a:getSolarHeatingDashboard", isToday ? { ...STATION, date } : "skip");
  const satelliteCloudDashboard = useQuery("seoulGk2aClouds:getCloudTrendDashboard", isToday ? { ...STATION, date } : "skip");
  const marketDashboard = useQuery("seoulPolymarket:getDashboard", isToday ? { ...STATION, date } : "skip");
  const marketHistoryDashboard = useQuery("seoulPolymarket:getPriceHistory", dateValid ? { ...STATION, date } : "skip");
  const forecastHistoryDashboard = useQuery("seoulDashboardHistory:getForecastHighHistory", dateValid ? { ...STATION, date } : "skip");
  const pollMetar = useAction("seoul:pollLatestNoaaStationMetar");
  const pollAmos = useAction("seoul:pollLatestAmosTemperatureSites");
  const refreshForecast = useMutation("seoulKmaForecast:requestAirportForecastRefresh");
  const series = useMemo(() => buildTemperatureSeries(day, date), [day, date]);
  const forecast = useMemo(() => summarizeForecast(forecastDashboard, date, now), [forecastDashboard, date, now]);
  const cloudRows = day?.rows ?? EMPTY_ROWS;
  const clouds = useMemo(() => summarizeClouds(cloudRows, date, now, isToday), [cloudRows, date, now, isToday]);
  const sunlight = useMemo(() => summarizeSunlight(solarDashboard, date, now, isToday), [solarDashboard, date, now, isToday]);
  const satelliteClouds = useMemo(() => summarizeSatelliteCloudTrend(satelliteCloudDashboard, date, now, isToday), [satelliteCloudDashboard, date, now, isToday]);
  const market = useMemo(() => summarizeSeoulMarket(marketDashboard, date, now, isToday), [marketDashboard, date, now, isToday]);
  const marketHistory = useMemo(() => buildMarketHistory(marketHistoryDashboard, date, now), [marketHistoryDashboard, date, now]);
  const forecastHistory = useMemo(() => buildForecastHistory(forecastHistoryDashboard, date, now), [forecastHistoryDashboard, date, now]);
  const refresh = useCallback(async (quiet = false) => {
    if (!isToday || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!quiet) setRefreshing(true);
    try {
      const results = await Promise.allSettled([pollMetar(STATION), pollAmos(STATION), refreshForecast(STATION)]);
      const failed = results.some((r) => r.status === "rejected");
      if (!quiet || failed) setRefreshMessage(failed ? "Some sources could not refresh. Showing the latest stored readings." : "Refresh requested. New readings appear automatically.");
    } finally { refreshInFlight.current = false; setRefreshing(false); }
  }, [isToday, pollMetar, pollAmos, refreshForecast]);
  useEffect(() => { if (isToday && enteredDate.current !== date) { enteredDate.current = date; refresh(true); } }, [date, isToday, refresh]);
  const amosAge = Number.isFinite(series.latestAmos?.time) && now ? (now - series.latestAmos.time) / 60000 : null;
  const amosStale = isToday && Number.isFinite(amosAge) && amosAge > 3;
  const forecastAvailable = Number.isFinite(forecast.highC);
  const peakMatchesHigh = forecastAvailable && Number.isFinite(forecast.hourlyPeakC) && Math.abs(forecast.highC - forecast.hourlyPeakC) < 0.05;
  const forecastStatus = forecast.status === "approval_required" ? "Forecast access is unavailable" : forecast.status === "error" ? "Forecast refresh unavailable" : "Waiting for a KMA forecast";
  const trend = clouds.stale ? "unknown" : clouds.trend;
  const trendLabel = { clearing: "METAR clearing", increasing: "METAR increasing", steady: "METAR steady", unknown: "Trend unknown" }[trend] ?? "Trend unknown";
  const trendSymbol = { clearing: "↘", increasing: "↗", steady: "→", unknown: "—" }[trend] ?? "—";
  if (!dateValid) return <main className={styles.page}><div className={styles.emptyPage}><h1>Choose a valid date</h1><p>Use a date in YYYY-MM-DD format.</p><Link href="/seoul/today" className={styles.todayLink}>Open today’s dashboard →</Link></div></main>;

  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.header}><div><div className={styles.location}><span className={styles.locationDot} /> INCHEON AIRPORT <span>RKSI</span></div><h1>Seoul weather</h1><p className={styles.subtitle}>The temperature, the peak, and the sky.</p></div><SeoulClock /></header>
    <nav className={styles.toolbar} aria-label="Dashboard date"><div className={styles.dateControls}>
      <Link href={`/seoul/day/${shiftedDate(date, -1)}`} className={styles.arrowButton} aria-label="Previous day">←</Link>
      <label className={styles.dateLabel}><span className={styles.srOnly}>Observation date in Seoul</span><input aria-label="Observation date in Seoul" type="date" value={date} onChange={(e) => { if (validDate(e.target.value)) router.push(`/seoul/day/${e.target.value}`); }} /></label>
      <Link href={`/seoul/day/${shiftedDate(date, 1)}`} className={styles.arrowButton} aria-label="Next day">→</Link>
      {isToday ? <span className={styles.liveBadge}><span /> LIVE</span> : <Link href="/seoul/today" className={styles.todayLink}>Today</Link>}
    </div>{isToday ? <button type="button" aria-label={refreshing ? "Refreshing weather" : "Refresh weather"} className={styles.refreshButton} disabled={refreshing} onClick={() => refresh()}><span aria-hidden="true">↻</span> {refreshing ? "Refreshing…" : "Refresh"}</button> : <span className={styles.archiveLabel}>{isPast ? "Stored observations" : "Forecast day"}</span>}</nav>
    <p className={styles.refreshMessage} role="status">{refreshMessage}</p>
    <section className={styles.summaryGrid} aria-label="Daily weather summary">
      <article className={`${styles.card} ${styles.forecastCard}`}>
        <div className={styles.cardHeading}><h2>Forecast high</h2><span className={styles.sourceTag}>KMA</span></div>
        <div className={styles.bigNumber}>{forecastDashboard === undefined ? "…" : temperature(forecast.highC)}{forecastAvailable ? <span>C</span> : null}</div>
        <p className={styles.peakTime}>{forecastAvailable ? peakLabel(forecast.peakWindows) : forecastStatus}</p>
        <p className={styles.cardNote}>{forecastAvailable && forecast.peakWindows?.length ? `${peakMatchesHigh ? "Peak hours" : `Hourly forecast peaks at ${temperature(forecast.hourlyPeakC)}C`} · KST` : "Official airport forecast"}</p>
        <ForecastHistory history={forecastHistory} currentHighC={forecast.highC} />
        <div className={styles.cardFooter}>{forecast.status === "error" && forecastAvailable ? <span className={styles.stale}>Stored forecast · refresh failed</span> : forecast.status === "stale" ? <span className={styles.stale}>Older forecast</span> : isPast ? "Stored KMA forecast" : "Published daily maximum"}{forecast.capturedAt ? <span>Captured {timeLabel(forecast.capturedAt)}</span> : null}</div>
      </article>
      <article className={styles.card}>
        <div className={styles.cardHeading}><h2>Official METAR high</h2><span className={styles.sourceTag}>OBSERVED</span></div>
        <div className={`${styles.bigNumber} ${styles.officialNumber}`}>{day === undefined ? "…" : temperature(series.officialHigh?.tempC)}{series.officialHigh ? <span>C</span> : null}</div>
        <p className={styles.peakTime}>{series.officialHigh ? `First recorded at ${timeLabel(series.officialHigh.time)}` : "No METAR reports stored yet"}</p>
        <p className={styles.cardNote}>{isToday ? "Highest so far today" : "Highest in stored reports"} · KST</p>
        <div className={styles.cardFooter}><span>Routine METAR · whole degrees</span><span>{series.metar.length} reports</span></div>
      </article>
      <article className={`${styles.card} ${styles.cloudCard}`}>
        <div className={styles.cardHeading}><h2>{isPast ? "Last observed cloud cover" : isToday ? "Current cloud cover" : "Observed cloud cover"}</h2><span className={styles.sourceTag}>SKY</span></div>
        <div className={styles.cloudContent}><CloudVisual minimum={clouds.coverageMin} maximum={clouds.coverageMax} label={clouds.label} /><div className={styles.cloudCopy}>
          <p className={styles.cloudLabel}>{day === undefined ? "Loading sky…" : clouds.label}</p>{trend !== "unknown" ? <span className={`${styles.trendBadge} ${trend === "clearing" ? styles.clearing : trend === "increasing" ? styles.increasing : ""}`}><span aria-hidden="true">{trendSymbol}</span> {trendLabel}</span> : null}<p className={styles.cloudExplanation}>{clouds.detail}</p>
        </div></div>
        {isToday ? <div className={styles.sunlightRow}>
          <div className={styles.sunlightHeading}><span className={styles.sunlightSource}>GK2A CLOUDS</span><span className={`${styles.trendBadge} ${satelliteClouds.state === "clearing" ? styles.clearing : satelliteClouds.state === "increasing" ? styles.increasing : ""}`}><span aria-hidden="true">{{ clearing: "↘", increasing: "↗", steady: "→", unavailable: "—" }[satelliteClouds.state]}</span> {satelliteClouds.label}</span></div>
          <p title="Estimated change from visible and infrared satellite readings near RKSI. Total cloud amount is not measured.">{satelliteClouds.observedAt ? `Satellite estimate · ${timeLabel(satelliteClouds.observedAt)} KST` : satelliteClouds.detail}</p>
        </div> : null}
        {isToday ? <div className={styles.sunlightRow}>
          <div className={styles.sunlightHeading}><span className={styles.sunlightSource}>GK2A SUNLIGHT</span><span className={`${styles.trendBadge} ${sunlight.state === "increasing" ? styles.clearing : sunlight.state === "decreasing" ? styles.increasing : ""}`}><span aria-hidden="true">{{ increasing: "↗", decreasing: "↘", steady: "→", unavailable: "—" }[sunlight.state]}</span> {sunlight.label}</span></div>
          <p>{sunlight.detail}{sunlight.observedAt ? ` · ${timeLabel(sunlight.observedAt)} KST` : ""}</p>
        </div> : null}
        <div className={styles.cardFooter}><span>{clouds.stale ? <span className={styles.stale}>Observation delayed</span> : "Observed METAR sky"}</span><span>{clouds.observedAt ? `${timeLabel(clouds.observedAt)} KST` : "No observation"}</span></div>
      </article>
    </section>
    <section className={styles.chartCard} aria-labelledby="temperature-heading">
      <div className={styles.chartHeader}><div><span className={styles.eyebrow}>THE DAY AT A GLANCE</span><h2 id="temperature-heading">Temperature through the day</h2><p>One-minute readings, official reports, and the KMA forecast.</p></div><div className={styles.currentReading}><span>{isToday ? "Current temperature" : "Latest stored reading"}</span><strong>{temperature(series.latestAmos?.tempC, true)}{series.latestAmos ? <small>C</small> : null}</strong><span className={amosStale ? styles.stale : ""}>{series.latestAmos ? `${timeLabel(series.latestAmos.time)} KST${amosStale ? " · delayed" : " · AMOS 15L"}` : "Awaiting AMOS"}</span></div></div>
      {day === undefined ? <div className={styles.chartLoading} role="status">Loading the day’s temperatures…</div> : <TemperatureChart amos={series.amos} metar={series.metar} forecast={forecast.hourly} date={date} isToday={isToday} nowMinute={nowMinute} />}
      <div className={styles.chartFooter}><span>All times are Seoul time (KST). AMOS reads to 0.1°C; METAR reports whole degrees.{["stale", "error"].includes(forecast.status) && forecast.hourly.length ? " Dashed forecast is retained from an older capture." : ""}</span><span>{isToday ? "Updates automatically every minute" : "Available stored history"}</span></div>
    </section>
    <SatelliteLoop date={date} isToday={isToday} />
    <SeoulMarket market={market} history={marketHistory} date={date} isToday={isToday} />
    <footer className={styles.footer}><span>RKSI · Incheon International Airport</span><span>KMA / AMO observations & forecast · NOAA METAR</span></footer>
  </div></main>;
}
