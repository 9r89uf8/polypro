"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createLoopImagePool, formatLoopDate, formatLoopTime, isLiveLoopDate,
  LOOP_WINDOW_MS, missingLoopSlots, nextLoopFrame, recentLoopFrames, resolveLoopDisplay, STALE_AFTER_MS } from "./satelliteLoopState";
import styles from "./satelliteLoop.module.css";

const STATION = { stationIcao: "RKSI" };
const SOURCE_URL = "https://registry.opendata.aws/noaa-himawari/";

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

function ConnectedLoop(props) {
  const data = useQuery("seoulSatellite:getLoop", props.isLive ? STATION : "skip");
  const requestRefresh = useMutation("seoulSatellite:requestRefresh");
  const refresh = useCallback(() => requestRefresh(STATION), [requestRefresh]);
  return <SatellitePlayer {...props} data={data} onRefresh={refresh} />;
}

/** A supplied data prop renders the real player without requiring a Convex
 * provider. `now` can be fixed in browser fixtures to exercise expiry safely. */
export default function SatelliteLoop(props) {
  const now = useLocalClock(props.now);
  const isLive = isLiveLoopDate(props.date, now, props.isToday ?? true);
  const shared = { ...props, now, isLive };
  return Object.prototype.hasOwnProperty.call(props, "data")
    ? <SatellitePlayer {...shared} /> : <ConnectedLoop {...shared} />;
}

function SatellitePlayer({ data, date, now, isLive, onRefresh }) {
  const id = useId();
  const [channel, setChannel] = useState("visible");
  const [zoom, setZoom] = useState(50);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const [heldKey, setHeldKey] = useState(null);
  const [imageStatus, setImageStatus] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const pool = useRef(null);
  const mounted = useRef(false);
  const automaticRefresh = useRef(false);
  const modeChosen = useRef(false);
  const refreshPending = useRef(false);
  const refreshToken = useRef(0);
  const refreshTimer = useRef(null);
  const playbackState = useRef({ loaded: [], displayedKey: null });
  const visibleFrames = useMemo(() => recentLoopFrames(data, "visible", now, { date, isToday: isLive }), [data, now, date, isLive]);
  const infraredFrames = useMemo(() => recentLoopFrames(data, "infrared", now, { date, isToday: isLive }), [data, now, date, isLive]);
  const frames = channel === "visible" ? visibleFrames : infraredFrames;
  const selection = useMemo(() => resolveLoopDisplay(frames, imageStatus, selectedKey, heldKey), [frames, imageStatus, selectedKey, heldKey]);
  const { desired, displayed, loaded } = selection;
  const channelState = data?.channels?.[channel];
  const latest = frames.at(-1);
  const staleAfter = Number.isFinite(data?.staleAfterMs) ? data.staleAfterMs : STALE_AFTER_MS;
  const stale = Boolean(latest && now - latest.time > staleAfter);
  const failedCount = frames.filter((frame) => imageStatus[frame.key] === "failed").length;
  const sourceFailureCount = isLive && data?.enabled === true ? new Set((data.collector?.sourceFailures ?? [])
    .filter((failure) => failure.channel === channel && Number.isFinite(failure.nominalTimeUtc)
      && failure.nominalTimeUtc >= now - LOOP_WINDOW_MS && failure.nominalTimeUtc <= now)
    .map((failure) => failure.key ?? failure.nominalTimeUtc)).size : 0;
  const missingCount = missingLoopSlots(frames);
  const desiredIndex = desired ? frames.findIndex((frame) => frame.key === desired.key) : 0;
  const displayedIndex = displayed ? loaded.findIndex((frame) => frame.key === displayed.key) : -1;
  const night = channel === "visible" && /night|dark|low.sun|sunlight|sun.below|solar.elevation/i.test(`${channelState?.status ?? ""} ${channelState?.unavailableReason ?? ""}`);

  useEffect(() => {
    mounted.current = true;
    pool.current = createLoopImagePool({ createImage: () => new window.Image(), onChange: setImageStatus });
    return () => {
      mounted.current = false;
      refreshToken.current += 1;
      refreshPending.current = false;
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      pool.current?.destroy();
      pool.current = null;
    };
  }, []);
  useEffect(() => { pool.current?.setFrames(frames); }, [frames]);
  useEffect(() => { if (desired) pool.current?.prioritize(desired.key); }, [desired?.key]);
  useEffect(() => { setHeldKey(displayed?.key ?? null); }, [displayed?.key]);
  useEffect(() => {
    if (selectedKey && !frames.some((frame) => frame.key === selectedKey)) {
      setSelectedKey(null);
      setPlaying(false);
    }
  }, [frames, selectedKey]);
  useEffect(() => {
    if (!isLive || data?.enabled !== true) setPlaying(false);
  }, [isLive, data?.enabled]);
  useEffect(() => {
    if (modeChosen.current || data?.enabled !== true) return;
    const visibleState = data.channels?.visible;
    const visibleLatest = visibleFrames.at(-1);
    const freshVisible = visibleLatest && now - visibleLatest.time <= staleAfter
      && !visibleState?.unavailableReason && !["unavailable", "night", "stale"].includes(visibleState?.status);
    const preferred = freshVisible ? "visible" : infraredFrames.length ? "infrared" : visibleFrames.length ? "visible" : null;
    if (preferred && preferred !== channel) {
      setChannel(preferred);
      setSelectedKey(null);
      setHeldKey(null);
      setPlaying(false);
    }
  }, [data, visibleFrames, infraredFrames.length, now, staleAfter, channel]);

  const refresh = useCallback(async (quiet = false) => {
    if (!isLive || data?.enabled !== true || !onRefresh || refreshPending.current) return;
    refreshPending.current = true;
    const token = ++refreshToken.current;
    if (!quiet) {
      setRefreshing(true);
      setRefreshMessage("");
      pool.current?.retryFailed();
    }
    refreshTimer.current = window.setTimeout(() => {
      if (!mounted.current || token !== refreshToken.current) return;
      refreshToken.current += 1;
      refreshPending.current = false;
      setRefreshing(false);
      setRefreshMessage("The refresh request is taking longer than expected. Available images remain visible.");
    }, 15000);
    try {
      const result = await onRefresh();
      if (mounted.current && token === refreshToken.current && !quiet) {
        setRefreshMessage(result?.status === "disabled" ? "Satellite collection is disabled."
          : "Refresh checked. New images appear automatically when available.");
      }
    } catch {
      if (mounted.current && token === refreshToken.current) setRefreshMessage("Refresh could not be requested. Showing available images from the last hour.");
    } finally {
      if (token === refreshToken.current) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
        refreshPending.current = false;
        if (mounted.current) setRefreshing(false);
      }
    }
  }, [isLive, data?.enabled, onRefresh]);
  useEffect(() => {
    if (isLive && data?.enabled === true && !automaticRefresh.current && onRefresh) {
      automaticRefresh.current = true;
      refresh(true);
    }
  }, [isLive, data?.enabled, onRefresh, refresh]);

  useEffect(() => { playbackState.current = { loaded, displayedKey: displayed?.key }; }, [loaded, displayed?.key]);
  const canPlay = loaded.length >= 2;
  useEffect(() => {
    if (!playing) return;
    const next = nextLoopFrame(playbackState.current.loaded, playbackState.current.displayedKey, speed);
    if (!next) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setSelectedKey(next.frame.key), next.delayMs);
    return () => window.clearTimeout(timer);
  }, [playing, selectedKey, speed, canPlay]);

  const changeChannel = (value) => {
    modeChosen.current = true;
    setChannel(value);
    setSelectedKey(null);
    setHeldKey(null);
    setPlaying(false);
  };
  const selectFrame = (frame) => { setPlaying(false); setSelectedKey(frame?.key ?? null); };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (loaded.length < 2) return;
    if (!displayed || displayed.key === loaded.at(-1).key) setSelectedKey(loaded[0].key);
    setPlaying(true);
  };

  let emptyTitle = "Loading the last hour…";
  let emptyDetail = "Images appear as they become available.";
  if (Number.isFinite(now) && !isLive) {
    emptyTitle = "Available on today’s dashboard";
    emptyDetail = "This player shows only the latest hour at RKSI.";
  } else if (data && data.enabled !== true) {
    emptyTitle = "Satellite loop is disabled";
    emptyDetail = "No satellite collection is running for this view.";
  } else if (night && !frames.length) {
    emptyTitle = "Visible imagery needs daylight";
    emptyDetail = "Choose infrared to view the airport at night.";
  } else if (frames.length && failedCount === frames.length) {
    emptyTitle = "Images could not load";
    emptyDetail = "Refresh to retry. Failed images remain marked as gaps.";
  } else if (data && !frames.length && !data.collector?.inFlight) {
    emptyTitle = "No images from the last hour";
    emptyDetail = data.collector?.status === "error" ? "The latest collection could not finish. Try refresh."
      : "Refresh to check for newly available images.";
  }
  const statusLabel = !Number.isFinite(now) ? "Loading"
    : !isLive ? "Today only" : data === undefined ? "Loading" : data?.enabled !== true ? "Disabled" : stale ? "Image feed delayed"
      : data?.collector?.inFlight ? "Collecting images" : "Last 60 minutes";

  return <section className={styles.card} aria-labelledby={`${id}-heading`}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>Himawari-9 · RKSI</span><h2 id={`${id}-heading`}>Satellite over the airport</h2></div>
      <button type="button" className={styles.refresh} onClick={() => refresh()} disabled={!isLive || data?.enabled !== true || !onRefresh || refreshing} aria-label="Refresh satellite images"><span aria-hidden="true">↻</span><span>{refreshing ? "Checking…" : "Refresh"}</span></button>
    </header>
    <div className={styles.tools}>
      <div className={styles.segmented} role="group" aria-label="Satellite channel">
        <button type="button" aria-pressed={channel === "visible"} onClick={() => changeChannel("visible")}>Visible</button>
        <button type="button" aria-pressed={channel === "infrared"} onClick={() => changeChannel("infrared")}>Infrared <span>24h</span></button>
      </div>
      <div className={styles.zoom} role="group" aria-label="Satellite view width">
        <span>Across</span>{[20, 50, 100].map((value) => <button type="button" key={value} aria-pressed={zoom === value} aria-label={`View ${value} kilometers across`} onClick={() => setZoom(value)}>{value} km</button>)}
      </div>
    </div>
    <div className={styles.body}>
      <div className={styles.viewport} aria-busy={!displayed && frames.length > failedCount}>
        {loaded.map((frame) => <img key={frame.key} className={styles.image} src={frame.url}
          alt={frame.key === displayed?.key ? `Himawari-9 ${channel} image centered on RKSI, observed ${formatLoopTime(frame.time)} KST on ${formatLoopDate(frame.time)}` : ""}
          aria-hidden={frame.key !== displayed?.key} draggable="false"
          style={{ width: `${10000 / zoom}%`, height: `${10000 / zoom}%`, opacity: frame.key === displayed?.key ? 1 : 0 }}
          onError={() => pool.current?.markFailed(frame.key)} />)}
        {displayed ? <>
          <div className={styles.north} aria-label="North is up"><span aria-hidden="true">↑</span>N</div>
          <div className={styles.marker} aria-label="RKSI at 37.4602 degrees north, 126.4407 degrees east"><span>RKSI</span></div>
          <div className={styles.scale}><span>{zoom / 5} km</span><i /></div>
          <span className={styles.viewLabel}>{zoom} × {zoom} km</span>
        </> : <div className={styles.empty} role="status"><span className={styles.emptyIcon} aria-hidden="true">◎</span><strong>{emptyTitle}</strong><p>{emptyDetail}</p></div>}
      </div>
      <div className={styles.controls}>
        <span className={`${styles.status} ${stale ? styles.delayed : ""}`}><i />{statusLabel}</span>
        <div className={styles.observation}>
          <span>Image observation time</span>
          <time dateTime={displayed ? new Date(displayed.time).toISOString() : undefined}>{displayed ? formatLoopTime(displayed.time) : "—"}<small> KST</small></time>
          <span>{displayed ? formatLoopDate(displayed.time) : "Seoul local time"}</span>
        </div>
        <div className={styles.playback}>
          <button type="button" className={styles.step} aria-label="Previous available satellite image" disabled={displayedIndex <= 0} onClick={() => selectFrame(loaded[displayedIndex - 1])}>‹</button>
          <button type="button" className={styles.play} aria-label={playing ? "Pause satellite loop" : "Play satellite loop"} disabled={loaded.length < 2} onClick={togglePlay}><span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>{playing ? "Pause" : "Play"}</button>
          <button type="button" className={styles.step} aria-label="Next available satellite image" disabled={displayedIndex < 0 || displayedIndex >= loaded.length - 1} onClick={() => selectFrame(loaded[displayedIndex + 1])}>›</button>
          <label className={styles.speed}><span className={styles.srOnly}>Playback speed</span><select aria-label="Playback speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
        </div>
        <label className={styles.scrubber} htmlFor={`${id}-scrub`}><span>Browse the last hour</span>
          <input id={`${id}-scrub`} aria-label="Satellite observation time" type="range" min="0" max={Math.max(0, frames.length - 1)} step="1" value={desiredIndex} disabled={frames.length < 2}
            aria-valuetext={desired ? `${formatLoopDate(desired.time)}, ${formatLoopTime(desired.time)} KST${imageStatus[desired.key] === "failed" ? ", image failed to load" : ""}` : "No images"}
            onChange={(event) => selectFrame(frames[Number(event.target.value)])} />
        </label>
        <div className={styles.rangeLabels}><span>{frames.length ? formatLoopTime(frames[0].time) : "—"}</span><span>{latest ? formatLoopTime(latest.time) : "—"}</span></div>
        <button type="button" className={styles.latest} disabled={!latest || (!selectedKey && displayed?.key === latest.key)} onClick={() => selectFrame(null)}>Most recent image <span aria-hidden="true">↗</span></button>
        <p className={styles.frameCount}>{loaded.length}/{frames.length} images loaded{frames.length > 1 ? ` · ${Math.round((latest.time - frames[0].time) / 60000)} min available` : ""}</p>
        {selection.pending && displayed ? <p className={styles.notice} role="status">Loading the selected image. The displayed observation time stays with the image.</p> : null}
        {selection.failed ? <p className={styles.notice} role="status">Selected image failed to load.{displayed ? " Showing another available image." : " Try refresh."}</p> : null}
        {missingCount || failedCount ? <p className={styles.notice}>{missingCount ? `${missingCount} missing 2½-minute ${missingCount === 1 ? "slot" : "slots"} between stored images.` : ""}{failedCount ? ` ${failedCount} ${failedCount === 1 ? "image" : "images"} failed to load; playback skips these gaps.` : ""}</p> : null}
        {sourceFailureCount ? <p className={styles.notice}>{sourceFailureCount} satellite {sourceFailureCount === 1 ? "file could" : "files could"} not be collected.{loaded.length >= 2 ? " Available images remain playable." : " Other available images can still be viewed."}</p> : null}
        {stale ? <p className={styles.notice}>Newest observation is {Math.floor((now - latest.time) / 60000)} minutes old. Images older than one hour disappear automatically.</p> : null}
        {frames.length && channelState?.unavailableReason ? <p className={styles.notice}>{channelState.unavailableReason}</p>
          : night && frames.length ? <p className={styles.notice}>Visible images require daylight. Infrared also works at night.</p> : null}
        {channel === "visible" && displayed && Number.isFinite(displayed.solarElevationDeg) && displayed.solarElevationDeg < 20
          ? <p className={styles.notice}>Low sun affects visible brightness ({Math.round(displayed.solarElevationDeg)}° elevation).</p> : null}
        <p className={styles.timingNote}>Frames play in time order with a pause at the end. Equal display steps do not represent elapsed time.</p>
        {refreshMessage ? <p className={styles.notice} role="status">{refreshMessage}</p> : null}
      </div>
    </div>
    <footer className={styles.footer}>
      <span>{channel === "visible" ? "Visible brightness" : "Infrared brightness temperature"} · not a cloud mask · no cloud-height correction</span>
      <a href={SOURCE_URL} target="_blank" rel="noreferrer">JMA / NOAA source ↗</a>
    </footer>
  </section>;
}
