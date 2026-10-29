"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatDayMinute, formatSeoulTime } from "./displayTime";
import { priceSegments } from "./historyData";

const COLORS = ["#a8b9d4", "#c5a2f4", "#a3c56d", "#f4bd68", "#ef8a87", "#5ed8dc", "#9cafff", "#ed95cf", "#83cbb0", "#d9c08d", "#82b4df", "#dda7a5"];
const minuteOf = (time) => ((time + 9 * 3600000) % 86400000) / 60000;
const price = (value) => Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) + "¢" : "—";

export default function MarketChart({ history, date }) {
  const hostRef = useRef(null);
  const [width, setWidth] = useState(900);
  const [hidden, setHidden] = useState([]);
  const [selectedMinute, setSelectedMinute] = useState(null);
  const id = useId().replaceAll(":", "");
  const colored = useMemo(() => history.series.map((series, index) => ({
    ...series, color: COLORS[index % COLORS.length],
    segments: priceSegments(series.points, history.samplingIntervalMinutes * 2 + 1),
  })), [history.series, history.samplingIntervalMinutes]);
  const times = useMemo(() => [...new Set(history.series.flatMap((series) =>
    series.points.filter((point) => point.cents !== null).map((point) => point.time)))].sort((a, b) => a - b), [history.series]);
  useEffect(() => { setHidden([]); setSelectedMinute(null); }, [date]);
  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(240, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const narrow = width < 600;
  const height = narrow ? 290 : 350;
  const plot = { left: 36, right: width - 16, top: 26, bottom: height - 36 };
  const x = (minute) => plot.left + minute / 1440 * (plot.right - plot.left);
  const y = (cents) => plot.bottom - cents / 100 * (plot.bottom - plot.top);
  const wantedMinute = selectedMinute ?? minuteOf(history.latestAt);
  const selectedAt = times.reduce((best, time) => best === null ||
    Math.abs(minuteOf(time) - wantedMinute) < Math.abs(minuteOf(best) - wantedMinute) ? time : best, null);
  const selected = colored.filter((series) => !hidden.includes(series.marketId)).map((series) => ({
    ...series, point: series.points.find((point) => point.time === selectedAt) ?? null,
  }));
  const tickMinutes = narrow ? [0, 360, 720, 1080, 1440] : [0, 180, 360, 540, 720, 900, 1080, 1260, 1440];
  const line = (points) => points.map((point, index) => (index ? "L" : "M") + x(point.minute) + "," + y(point.cents)).join(" ");
  function inspect(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const local = (event.clientX - bounds.left) / bounds.width * width;
    setSelectedMinute(Math.max(0, Math.min(1440, (local - plot.left) / (plot.right - plot.left) * 1440)));
  }
  function toggle(marketId) {
    setHidden((current) => current.includes(marketId) ? current.filter((value) => value !== marketId) : [...current, marketId]);
  }
  return <div ref={hostRef} className="market-chart">
    <div className="chart-context"><span>YES price · bid/ask midpoint</span><span>{history.samplingIntervalMinutes}-minute samples · KST</span></div>
    <div className="outcomes" aria-label="Show or hide temperature outcomes">
      {colored.map((series) => <button type="button" key={series.marketId}
        aria-pressed={!hidden.includes(series.marketId)} onClick={() => toggle(series.marketId)}
        style={{ "--series-color": series.color }}>
        <span className="color-dot" aria-hidden="true" /><span>{series.label}</span>
        <span className="outcome-price">{price(series.latest?.cents)}</span>
      </button>)}
      {hidden.length > 0 ? <button type="button" className="show-all" onClick={() => setHidden([])}>Show all</button> : null}
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}
      role="img" aria-labelledby={id + "-title " + id + "-desc"}
      onPointerDown={inspect} onPointerMove={(event) => { if (event.pointerType === "mouse" || event.buttons) inspect(event); }}
      style={{ display: "block", touchAction: "pan-y" }}>
      <title id={id + "-title"}>{`Seoul temperature market prices through ${date}`}</title>
      <desc id={id + "-desc"}>Each colored line is a temperature outcome’s YES bid/ask midpoint, from zero to one hundred cents. Missing quotes remain gaps. Use the outcome buttons and time slider to inspect recorded prices.</desc>
      <defs><clipPath id={id + "-clip"}><rect x={plot.left - 3} y={plot.top - 3} width={plot.right - plot.left + 6} height={plot.bottom - plot.top + 6} /></clipPath></defs>
      <text x={plot.left - 8} y={13} fill="#a4b4ca" textAnchor="end" fontSize="11">¢</text>
      {[0, 25, 50, 75, 100].map((value) => <g key={value}>
        <line x1={plot.left} x2={plot.right} y1={y(value)} y2={y(value)} stroke="#2b3d55" strokeOpacity=".65" />
        <text x={plot.left - 9} y={y(value) + 4} textAnchor="end" fill="#96abc3" fontSize="11">{value}</text>
      </g>)}
      {tickMinutes.map((minute) => <g key={minute}>
        <line x1={x(minute)} x2={x(minute)} y1={plot.top} y2={plot.bottom} stroke="#26364d" strokeOpacity=".4" />
        <text x={x(minute)} y={height - 12} fill="#91a3bd" fontSize="11"
          textAnchor={minute === 0 ? "start" : minute === 1440 ? "end" : "middle"}>{formatDayMinute(minute, { compact: true })}</text>
      </g>)}
      <g clipPath={`url(#${id}-clip)`}>
        {colored.filter((series) => !hidden.includes(series.marketId)).map((series) => <g key={series.marketId}>
          {series.segments.map((segment, index) => segment.length > 1
            ? <path key={index} d={line(segment)} fill="none" stroke={series.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            : <circle key={index} cx={x(segment[0].minute)} cy={y(segment[0].cents)} r="2.5" fill={series.color} />)}
        </g>)}
        {selectedAt !== null ? <line x1={x(minuteOf(selectedAt))} x2={x(minuteOf(selectedAt))} y1={plot.top} y2={plot.bottom} stroke="#d4e1ef" strokeOpacity=".5" strokeDasharray="3 4" /> : null}
        {selected.map((series) => series.point?.cents !== null && series.point ? <circle key={series.marketId}
          cx={x(series.point.minute)} cy={y(series.point.cents)} r="4" fill="#101a2a" stroke={series.color} strokeWidth="2" /> : null)}
      </g>
      {!selected.length ? <text x={(plot.left + plot.right) / 2} y={(plot.top + plot.bottom) / 2} textAnchor="middle" fill="#a4b4ca" fontSize="13">Choose an outcome above to show its prices</text> : null}
    </svg>
    <div className="price-inspection" aria-live="polite" aria-atomic="true">
      <div className="inspection-heading">Captured <strong>{formatSeoulTime(selectedAt)}</strong> <span>KST</span></div>
      <div className="inspection-values">{selected.map((series) => <span key={series.marketId}>
        <i style={{ background: series.color }} aria-hidden="true" />{series.label}<strong>{price(series.point?.cents)}</strong>
      </span>)}</div>
    </div>
    <label className="slider-label" htmlFor={id + "-time"}>Inspect price history <span>Hover, tap, or use arrow keys</span></label>
    <input id={id + "-time"} className="time-slider" type="range" min="0" max={Math.max(0, times.length - 1)} step="1"
      disabled={times.length < 2} value={Math.max(0, times.indexOf(selectedAt))}
      aria-valuetext={`Captured at ${formatSeoulTime(selectedAt)} KST. ${selected.map((series) => series.label + ": " + price(series.point?.cents)).join(". ")}`}
      onChange={(event) => setSelectedMinute(minuteOf(times[Number(event.target.value)]))} />
    <p className="chart-note">Latest capture in each five-minute window; only usable two-sided quotes are plotted. Lines stop at the last recorded point; gaps are not filled.
      {history.truncated ? " Only part of the retained day is available." : ""}</p>
    <style jsx>{`
      .market-chart{min-width:0;color:#dce7f5;font-variant-numeric:tabular-nums}
      .chart-context{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#94abc3;margin-bottom:14px}
      .outcomes{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}
      .outcomes button{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:6px 9px;border:1px solid #35465b;border-radius:7px;background:#142235;color:#c6d7e9;font-size:11px;cursor:pointer}
      .outcomes button[aria-pressed=false]{opacity:.42;border-style:dashed}
      .outcomes button:hover{background:#1c2e45}.outcomes button:focus-visible,.time-slider:focus-visible{outline:2px solid #8cdae6;outline-offset:3px}
      .color-dot{width:7px;height:7px;border-radius:50%;background:var(--series-color)}
      .outcome-price{font-size:10px;color:var(--series-color);margin-left:3px}.outcomes .show-all{color:#96dce5;background:transparent;border-color:transparent}
      .price-inspection{padding:13px 15px;border:1px solid #2b3c54;border-radius:9px;background:#0c1728}
      .inspection-heading{color:#97abc3;font-size:11px}.inspection-heading strong{color:#e4effa;font-size:14px;margin:0 3px}.inspection-heading>span{font-size:9px;color:#7890aa}
      .inspection-values{display:flex;flex-wrap:wrap;gap:9px 20px;margin-top:11px}
      .inspection-values>span{display:inline-flex;align-items:center;gap:6px;color:#a8bad0;font-size:10px}
      .inspection-values i{width:6px;height:6px;border-radius:50%}.inspection-values strong{font-size:12px;font-weight:500;color:#e1edf8;margin-left:2px}
      .slider-label{display:flex;justify-content:space-between;gap:8px;margin-top:13px;font-size:10px;color:#a4b4ca}.slider-label span{color:#7f92ad;text-align:right}
      .time-slider{display:block;width:100%;min-width:0;height:28px;margin:2px 0 0;accent-color:#49d8ec;cursor:pointer}
      .chart-note{font-size:10px;color:#849bb3;line-height:1.6;margin:7px 0 14px}
      @media(max-width:600px){.chart-context{font-size:9px;flex-wrap:wrap;gap:5px}.outcomes{gap:5px}.outcomes button{font-size:10px;padding:5px 7px}.outcome-price{display:none}.price-inspection{padding:11px}.inspection-values{gap:9px 14px}.slider-label{font-size:9px}}
    `}</style>
  </div>;
}
