"use client";

import { useMutation, useQuery } from "convex/react";
import { Component, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { formatLoopDate, formatLoopTime, isLiveLoopDate } from "./satelliteLoopState";
import { describeGoci2, goci2DayFrames, goci2FrameNotes, goci2RefreshMessage } from "./goci2SnapshotState";
import styles from "./goci2Snapshot.module.css";

const STATION = { stationIcao: "RKSI" };
const SOURCE_URL = "https://www.nosc.go.kr/";

function useLocalClock(fixedNow) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    if (Number.isFinite(fixedNow)) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [fixedNow]);
  return Number.isFinite(fixedNow) ? fixedNow : now;
}

function ConnectedSnapshot(props) {
  const data = useQuery("seoulGoci2:getLatest", props.isLive ? STATION : "skip");
  const requestRefresh = useMutation("seoulGoci2:requestRefresh");
  const refresh = useCallback(() => requestRefresh(STATION), [requestRefresh]);
  return <SnapshotCard {...props} data={data} onRefresh={refresh} />;
}

/** A failed or missing query (for example, a frontend deployed before its
 * Convex functions) affects this card only, never the rest of the page. */
class SnapshotBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <SnapshotCard {...this.props} data={null} queryFailed /> : this.props.children; }
}

/** Hourly GOCI-II true-colour view of RKSI. A supplied data prop renders the
 * real card without a Convex provider, as SatelliteLoop does for fixtures. */
export default function Goci2Snapshot(props) {
  const now = useLocalClock(props.now);
  const isLive = isLiveLoopDate(props.date, now, props.isToday ?? true);
  const shared = { ...props, now, isLive };
  return Object.prototype.hasOwnProperty.call(props, "data")
    ? <SnapshotCard {...shared} /> : <SnapshotBoundary {...shared}><ConnectedSnapshot {...shared} /></SnapshotBoundary>;
}

const QUERY_FAILED = { kind: "error", badge: "Unavailable", title: "GOCI-II status could not load",
  detail: "The rest of the dashboard is unaffected. Reload the page to try again." };

function SnapshotCard({ data, date, now, isLive, onRefresh, queryFailed = false }) {
  const id = useId();
  const [zoom, setZoom] = useState(50);
  const [selectedKey, setSelectedKey] = useState(null);
  const [failed, setFailed] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const frames = useMemo(() => goci2DayFrames(data, now, { date, isToday: isLive }), [data, now, date, isLive]);
  const selected = frames.find((frame) => frame.key === selectedKey) ?? frames.at(-1) ?? null;
  const shown = selected && failed[selected.key] !== true ? selected : null;
  const state = queryFailed ? QUERY_FAILED : describeGoci2(data, frames, now, { isLive });
  const notes = goci2FrameNotes(selected, now);
  const approved = isLive && data?.approved === true;

  const refresh = useCallback(async () => {
    if (!approved || !onRefresh || refreshing) return;
    setRefreshing(true);
    setRefreshMessage("");
    setFailed({});
    try {
      const result = await onRefresh();
      if (mounted.current) setRefreshMessage(goci2RefreshMessage(result?.status));
    } catch {
      if (mounted.current) setRefreshMessage("Refresh could not be requested. Stored images remain available.");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [approved, onRefresh, refreshing]);

  return <section className={styles.card} aria-labelledby={`${id}-heading`}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>GOCI-II · GK-2B · RKSI</span><h2 id={`${id}-heading`}>Hourly high-resolution view</h2></div>
      <button type="button" className={styles.refresh} onClick={refresh} disabled={!approved || !onRefresh || refreshing} aria-label="Check for a new GOCI-II image"><span aria-hidden="true">↻</span><span>{refreshing ? "Checking…" : "Refresh"}</span></button>
    </header>
    <div className={styles.body}>
      <div className={styles.imagePanel}>
        <div className={styles.viewport} aria-busy={state.kind === "loading" || state.kind === "collecting"}>
          {shown ? <>
            <img key={shown.key} className={styles.image} src={shown.url} draggable="false"
              alt={`GOCI-II approximate true-colour image centered on RKSI, observed ${formatLoopTime(shown.time)} KST on ${formatLoopDate(shown.time)}`}
              style={{ width: `${10000 / zoom}%`, height: `${10000 / zoom}%` }}
              onError={() => setFailed((value) => ({ ...value, [shown.key]: true }))} />
            <div className={styles.north} aria-label="North is up"><span aria-hidden="true">↑</span>N</div>
            <div className={styles.marker} aria-label="RKSI at 37.4602 degrees north, 126.4407 degrees east"><span>RKSI</span></div>
            <div className={styles.scale}><span>{zoom / 5} km</span><i /></div>
            <span className={styles.viewLabel}>{zoom} × {zoom} km</span>
          </> : <div className={styles.empty} role="status">
            <span className={styles.emptyIcon} aria-hidden="true">{state.kind === "approval_required" ? "⊘" : "◎"}</span>
            <strong>{selected ? "Image could not load" : state.title}</strong>
            <p>{selected ? "Refresh to retry. The observation time below belongs to the missing image." : state.detail}</p>
          </div>}
        </div>
        <div className={styles.zoom} role="group" aria-label="GOCI-II view width">
          <span>Across</span>{[20, 50, 100].map((value) => <button type="button" key={value} aria-pressed={zoom === value} disabled={!shown} aria-label={`View ${value} kilometers across`} onClick={() => setZoom(value)}>{value} km</button>)}
        </div>
      </div>
      <div className={styles.details}>
        <span className={`${styles.status} ${["stale", "error", "unavailable"].includes(state.kind) ? styles.delayed : ""}`}><i />{state.badge}</span>
        <div className={styles.observation}>
          <span>Image observation time</span>
          <time dateTime={selected ? new Date(selected.time).toISOString() : undefined}>{selected ? formatLoopTime(selected.time) : "—"}<small> KST</small></time>
          <span>{selected ? formatLoopDate(selected.time) : "Seoul local time"}</span>
        </div>
        {frames.length > 1 ? <div className={styles.hours} role="group" aria-label="Today's hourly GOCI-II images">
          {frames.map((frame) => <button type="button" key={frame.key} aria-pressed={frame.key === selected?.key}
            onClick={() => setSelectedKey(frame.key === frames.at(-1).key ? null : frame.key)}>{formatLoopTime(frame.time).replace(/:\d{2}(?= [AP]M)/, "")}</button>)}
        </div> : null}
        {state.detail && shown ? <p className={styles.notice}>{state.detail}</p> : null}
        {notes.map((note) => <p key={note} className={styles.note}>{note}</p>)}
        {refreshMessage ? <p className={styles.notice} role="status">{refreshMessage}</p> : null}
      </div>
    </div>
    <footer className={styles.footer}>
      <span>{isLive && data && data.approved !== true ? "GOCI-II imagery is not collected without KHOA approval"
        : "Approximate true colour (660/555/443 nm) · not a cloud mask · no cloud-height correction"}</span>
      <a href={SOURCE_URL} target="_blank" rel="noreferrer">KHOA / NOSC source ↗</a>
    </footer>
  </section>;
}
