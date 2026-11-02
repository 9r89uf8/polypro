"use client";

import Link from "next/link";
import { useMemo } from "react";
import { MAP_SPAN_KM, buildNearbyState, mapOffset } from "./nearbyStationsState";
import card from "./experimentCard.module.css";
import styles from "./nearbyStations.module.css";

const RINGS_KM = [5, 10, 15];
// Bearings where each ring's label stays clear of the middle card and the stations.
const RING_LABEL_BEARING = { 5: 172, 10: 150, 15: 150 };
// Where each label sits so it stays clear of the middle card and the map edge.
const PLACEMENT = { 508: "placeLeft", 665: "placeBelow", 543: "placeAbove", 577: "placeAbove" };
const SPAN = 100;

function WindArrow({ wind, stale, className }) {
  return <svg viewBox="0 0 24 24" className={`${styles.arrow} ${stale ? styles.arrowStale : ""} ${className ?? ""}`} aria-hidden="true">
    {wind.arrowDeg === null
      ? wind.kind === "calm" ? <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" /> : <path d="M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      : <path transform={`rotate(${wind.arrowDeg} 12 12)`} d="M12 21V5M6 11l6-7 6 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>;
}

function RingMap({ state }) {
  return <div className={styles.map} role="group" aria-label="Map with north up and the airport in the middle. Stations sit at their true direction and distance. The table repeats every reading.">
    <svg className={styles.rings} viewBox={`${-SPAN} ${-SPAN} ${2 * SPAN} ${2 * SPAN}`} aria-hidden="true">
      {RINGS_KM.map((km) => <circle key={km} r={(km / MAP_SPAN_KM) * SPAN} />)}
      <path d={`M0 ${-SPAN}V${SPAN}M${-SPAN} 0H${SPAN}`} />
    </svg>
    <span className={styles.north} aria-hidden="true">N ↑</span>
    {RINGS_KM.map((km) => {
      const { x, y } = mapOffset({ distanceKm: km, bearingDeg: RING_LABEL_BEARING[km] });
      return <span key={km} className={`${styles.ringLabel} ${km === RINGS_KM[0] ? styles.innerRing : ""}`} style={{ "--x": x, "--y": y }} aria-hidden="true">{km} km</span>;
    })}
    {state.stations.map((station) => <div key={station.id} className={`${styles.node} ${styles[PLACEMENT[station.id] ?? "placeBelow"]} ${station.state === "stale" ? styles.nodeStale : ""} ${station.state === "missing" ? styles.nodeMissing : ""}`} style={{ "--x": station.offset.x, "--y": station.offset.y }}
      title={`${station.name} (${station.nameKo}), KMA station ${station.id} · ${station.distanceKm} km ${station.directionLabel} of RKSI (${station.bearingDeg}°) · ${station.elevationM} m high${station.observedAt ? ` · ${station.wind.detail} · observed ${station.timeLabel} KST` : ""}`}>
      <span className={styles.marker}><WindArrow wind={station.wind} stale={station.state === "stale"} /></span>
      <div className={styles.label}>
        <strong className={styles.name}>{station.name}</strong>
        {station.heightNote ? <span className={styles.heightTag}><span className={styles.wideOnly}>{station.heightNote}</span><span className={styles.narrowOnly}>+{station.aboveAirportM} m</span></span> : null}
        {station.state === "missing" ? <span className={styles.none}>{state.withheld ? "Not collected" : "No reading"}</span> : <>
          {station.tempC === null ? <span className={styles.none}>No temperature</span> : <span className={styles.temperature}>{station.temperature}</span>}
          <span className={styles.windText}>{station.wind.short}</span>
          <span className={station.state === "stale" ? styles.staleText : styles.age}>{station.mapAgeLabel}</span>
        </>}
      </div>
    </div>)}
    <div className={`${styles.airport} ${state.airport.reference.state !== "fresh" ? styles.airportStale : ""}`} title="RKSI AMOS: 15L is the reference reading, 16L the onsite comparison.">
      <strong className={styles.airportName}>RKSI</strong>
      <span className={styles.airportTemperature}><small>15L</small> {state.airport.reference.temperature}</span>
      <span className={styles.airportWind}><WindArrow wind={state.airport.reference.wind} stale={state.airport.reference.state !== "fresh"} className={styles.inlineArrow} />{state.airport.reference.wind.short}</span>
      <span className={state.airport.reference.state === "stale" ? styles.staleText : styles.age}>{state.airport.reference.mapAgeLabel}</span>
      <span className={styles.airportComparison}>16L {state.airport.comparison.state === "missing" ? "no reading" : state.airport.comparison.temperature}{state.airport.comparison.state === "stale" ? " · stale" : ""}</span>
    </div>
  </div>;
}

function TemperatureText({ row }) {
  return row.tempC === null ? <span className={card.tableNote} title="This reading has no temperature.">Not reported</span> : row.temperature;
}

function ObservedCell({ row }) {
  return <td className={card.textCell}>{row.observedAt ? <>{row.timeLabel}<span className={`${card.tableNote} ${row.state === "stale" ? styles.staleText : ""}`}>{row.ageLabel}</span></> : "No reading"}</td>;
}

function WindCell({ row }) {
  if (!row.observedAt) return <td className={card.textCell}>—</td>;
  return <td className={card.textCell}><span className={styles.windCell}><WindArrow wind={row.wind} stale={row.state === "stale"} className={styles.inlineArrow} /><span>{row.wind.detail}</span></span></td>;
}

function Readings({ state }) {
  const { airport } = state;
  return <div className={`${card.tableScroll} ${styles.readings}`} role="region" aria-label="Readings around the airport" tabIndex={0}>
    <table>
      <caption className={card.srOnly}>The airport and each nearby station, with temperature in degrees Celsius, wind and observation time in KST. Readings are raw and unadjusted.</caption>
      <thead><tr>
        <th scope="col">Site</th><th scope="col" className={`${card.textCell} ${styles.wideOnly}`}>From RKSI</th><th scope="col" className={styles.wideOnly}>Height</th>
        <th scope="col">°C</th><th scope="col" className={card.textCell}>Wind</th><th scope="col" className={card.textCell}>Observed<span className={styles.wideOnly}> (KST)</span></th>
      </tr></thead>
      <tbody>
        {[["15L", "Reference", airport.reference], ["16L", "Onsite comparison", airport.comparison]].map(([name, role, row]) => <tr key={name}>
          <th scope="row">RKSI {name}<span className={card.tableNote}>{role}</span></th>
          <td className={`${card.textCell} ${styles.wideOnly}`}>—</td><td className={styles.wideOnly}>{Number.isFinite(airport.elevationM) ? `${airport.elevationM} m` : "—"}</td>
          <td><TemperatureText row={row} /></td><WindCell row={row} /><ObservedCell row={row} />
        </tr>)}
        {state.stations.map((station) => <tr key={station.id}>
          <th scope="row">{station.name}<span className={card.tableNote}>{station.nameKo} · KMA {station.id}</span></th>
          <td className={`${card.textCell} ${styles.wideOnly}`}>{station.distanceKm} km {station.directionLabel}<span className={card.tableNote}>{station.bearingDeg}°</span></td>
          <td className={styles.wideOnly}>{station.elevationM} m</td>
          <td><TemperatureText row={station} /></td>
          {state.withheld ? <td className={`${card.textCell} ${styles.statusCell}`} colSpan={2}>Not collected: approval required</td> : <><WindCell row={station} /><ObservedCell row={station} /></>}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

export default function NearbyStations({ dashboard, now, isToday, isPast }) {
  const state = useMemo(() => buildNearbyState(dashboard, now, { isToday, isPast }), [dashboard, now, isToday, isPast]);
  const badge = state.tone === "fresh" ? card.fresh : state.tone === "delayed" ? card.delayed : "";
  return <section className={card.card} aria-labelledby="nearby-heading">
    <div className={card.header}>
      <div><span className={card.eyebrow}>AROUND THE AIRPORT</span><h2 id="nearby-heading">Nearby live readings</h2></div>
      <span className={`${card.badge} ${badge}`}>{state.badge}</span>
    </div>
    {state.kind === "loading" || state.kind === "not_live" || state.kind === "unavailable" ? <>
      <p className={card.status} role="status">{state.message}{state.kind === "not_live" ? <> <Link href="/seoul/today" className={styles.todayLink}>Open today →</Link></> : null}</p>
    </> : <>
      <p className={card.scope}>RKSI in the middle, with KMA’s nearest stations at their true direction and distance. Raw readings: nothing is blended or adjusted for height.</p>
      {state.message ? <p className={`${card.status} ${state.tone === "delayed" ? card.statusWarning : ""}`} role="status">{state.message}</p> : null}
      <div className={styles.layout}>
        <div className={styles.mapColumn}>
          <RingMap state={state} />
          <p className={styles.arrowNote}><strong>Arrows show where the air is going.</strong> The text names where the wind comes from, so “from NW” points toward the SE.</p>
          {state.tallStations.map((station) => <p key={station.id} className={styles.heightNote}><strong>{station.name}</strong> sits {station.elevationM} m up, about {station.elevationM - state.airport.elevationM} m above the airport, so it is not a like-for-like reading. No height adjustment is applied.</p>)}
        </div>
        <Readings state={state} />
      </div>
      <details className={card.details}>
        <summary>About these readings</summary>
        <p>Temperature at the KMA stations is a one-minute average and wind a ten-minute average. Airport readings are AMOS 15L, the reference, and 16L, the onsite comparison; AMOS does not publish its wind averaging period here, so wind is not strictly like for like. KMA reports speed in m/s, shown here in knots with the original in the table. Station readings are marked stale after 10 minutes, airport readings after 3.</p>
        <p>Source: Korea Meteorological Administration (KMA), AWS one-minute data through KMA API Hub, under Korea Open Government License Type 1 (attribution). <a className={styles.todayLink} href="https://www.kma.go.kr/kmadev/guide/copyright.jsp" target="_blank" rel="noreferrer">KMA copyright policy ↗</a></p>
      </details>
      <div className={card.footer}><span>All times are Seoul time (KST). Temperatures in °C, wind in knots.</span><span>{state.withheld || state.kind === "setup_required" ? "Station collection is off" : "Stations checked every minute"}</span></div>
    </>}
  </section>;
}
