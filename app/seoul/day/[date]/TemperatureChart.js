"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatDayMinute } from "./displayTime";

const DAY_MINUTES = 1440;
const AMOS_COLOR = "#49d8ec";
const METAR_COLOR = "#ffe2b5";
const FORECAST_COLOR = "#a0aeca";

function cleanSeries(rows) {
  const byMinute = new Map();
  for (const row of rows ?? []) {
    if (
      Number.isFinite(row?.time) &&
      Number.isFinite(row?.minute) &&
      Number.isFinite(row?.tempC) &&
      row.minute >= 0 &&
      row.minute <= DAY_MINUTES
    ) {
      byMinute.set(row.minute, row);
    }
  }
  return [...byMinute.values()].sort((a, b) => a.minute - b.minute);
}

function clock(minute) {
  return formatDayMinute(minute);
}

function temperatureDomain(series) {
  const values = series.flatMap((rows) => rows.map((row) => row.tempC));
  if (!values.length) return { low: 0, high: 30, ticks: [0, 10, 20, 30] };
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const padding = Math.max(1, (highest - lowest) * 0.12);
  const roughStep = (highest - lowest + 2 * padding) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step =
    [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= roughStep) *
    magnitude;
  const low = Math.floor((lowest - padding) / step) * step;
  const high = Math.ceil((highest + padding) / step) * step;
  const ticks = [];
  for (let tick = low; tick <= high + step / 10; tick += step) {
    ticks.push(Number(tick.toFixed(4)));
  }
  return { low, high, ticks };
}

function splitAtGaps(rows, maximumGapMinutes) {
  const groups = [];
  for (const row of rows) {
    const previous = groups.at(-1)?.at(-1);
    if (!previous || row.minute - previous.minute > maximumGapMinutes) {
      groups.push([row]);
    } else {
      groups.at(-1).push(row);
    }
  }
  return groups;
}

function nearestReading(rows, minute, maximumDistance) {
  let nearest = null;
  let distance = Infinity;
  for (const row of rows) {
    const candidateDistance = Math.abs(row.minute - minute);
    if (candidateDistance < distance) {
      nearest = row;
      distance = candidateDistance;
    }
  }
  return distance <= maximumDistance ? nearest : null;
}

function LegendItem({ color, children, dotted = false, point = false }) {
  return (
    <span className="legend-item">
      <span
        aria-hidden="true"
        style={
          point
            ? { width: 7, height: 7, borderRadius: "50%", background: color }
            : { width: 20, borderTop: `2px ${dotted ? "dashed" : "solid"} ${color}` }
        }
      />
      {children}
      <style jsx>{`
        .legend-item { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
      `}</style>
    </span>
  );
}

export default function TemperatureChart({
  amos = [],
  metar = [],
  forecast = [],
  date,
  isToday = false,
  nowMinute,
}) {
  const hostRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [selectedMinute, setSelectedMinute] = useState(null);
  const id = useId().replaceAll(":", "");
  const observed = useMemo(() => cleanSeries(amos), [amos]);
  const official = useMemo(() => cleanSeries(metar), [metar]);
  const predicted = useMemo(() => cleanSeries(forecast), [forecast]);
  const domain = useMemo(
    () => temperatureDomain([observed, official, predicted]),
    [observed, official, predicted],
  );
  const amosSegments = useMemo(() => splitAtGaps(observed, 5), [observed]);
  const forecastSegments = useMemo(() => splitAtGaps(predicted, 90), [predicted]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(240, element.clientWidth));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setSelectedMinute(null), [date]);

  const narrow = width < 560;
  const height = narrow ? 280 : 330;
  const plot = { left: 42, right: width - 17, top: 28, bottom: height - 35 };
  const x = (minute) => plot.left + (minute / DAY_MINUTES) * (plot.right - plot.left);
  const y = (tempC) =>
    plot.bottom - ((tempC - domain.low) / (domain.high - domain.low)) * (plot.bottom - plot.top);
  const line = (rows) => rows.map((row, index) => `${index ? "L" : "M"}${x(row.minute)},${y(row.tempC)}`).join(" ");
  const timeTicks = narrow ? [0, 360, 720, 1080, 1440] : [0, 180, 360, 540, 720, 900, 1080, 1260, 1440];
  const defaultMinute = Math.max(
    0,
    Math.min(DAY_MINUTES, isToday && Number.isFinite(nowMinute) ? nowMinute : observed.at(-1)?.minute ?? official.at(-1)?.minute ?? predicted[0]?.minute ?? 720),
  );
  const cursorMinute = selectedMinute ?? defaultMinute;
  const selected = [
    { name: "AMOS 15L", color: AMOS_COLOR, row: nearestReading(observed, cursorMinute, 2), digits: 1 },
    { name: "Official METAR", color: METAR_COLOR, row: nearestReading(official, cursorMinute, 30), digits: 0 },
    ...(predicted.length ? [{ name: "KMA forecast", color: FORECAST_COLOR, row: nearestReading(predicted, cursorMinute, 30), digits: 1 }] : []),
  ];
  const hasData = observed.length + official.length + predicted.length > 0;
  const accessibleValue = `${clock(cursorMinute)} KST. ${selected.map(({ name, row, digits }) => `${name}: ${row ? `${row.tempC.toFixed(digits)} degrees Celsius at ${clock(row.minute)}` : "no nearby reading"}`).join(". ")}`;

  function inspectPointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const localX = ((event.clientX - bounds.left) / bounds.width) * width;
    const minute = ((localX - plot.left) / (plot.right - plot.left)) * DAY_MINUTES;
    setSelectedMinute(Math.max(0, Math.min(DAY_MINUTES, Math.round(minute))));
  }

  return (
    <div className="temperature-chart" ref={hostRef}>
      <div className="legend" aria-label="Chart series">
        <LegendItem color={AMOS_COLOR}>AMOS 15L · 0.1°C</LegendItem>
        <LegendItem color={METAR_COLOR} point>Official METAR · whole °C</LegendItem>
        {predicted.length > 0 && <LegendItem color={FORECAST_COLOR} dotted>KMA hourly forecast</LegendItem>}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
        onPointerDown={inspectPointer}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" || event.buttons) inspectPointer(event);
        }}
        style={{ display: "block", touchAction: "pan-y" }}
      >
        <title id={`${id}-title`}>{`RKSI temperatures for ${date}, midnight to midnight KST`}</title>
        <desc id={`${id}-description`}>
          AMOS 15L minute observations are a cyan line. Official METAR reports are warm white points.
          {predicted.length > 0 ? " Dashed lines show the KMA hourly forecast." : ""}
          {" "}Missing observations are not filled. Use the time slider below to inspect readings.
        </desc>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMOS_COLOR} stopOpacity="0.11" />
            <stop offset="100%" stopColor={AMOS_COLOR} stopOpacity="0.005" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <rect x={plot.left - 4} y={plot.top - 4} width={plot.right - plot.left + 8} height={plot.bottom - plot.top + 8} />
          </clipPath>
        </defs>
        <text x={plot.left - 9} y={14} fill="#a4b4ca" fontSize="11" textAnchor="end">°C</text>
        <text x={plot.right} y={14} fill="#7e91ab" fontSize="10" textAnchor="end">KST · UTC+9</text>
        {domain.ticks.map((tick) => (
          <g key={tick}>
            <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} stroke="#26364d" strokeOpacity="0.65" />
            <text x={plot.left - 10} y={y(tick) + 4} fill="#a4b4ca" fontSize="11" textAnchor="end">{tick}</text>
          </g>
        ))}
        {timeTicks.map((minute) => (
          <g key={minute}>
            <line x1={x(minute)} x2={x(minute)} y1={plot.top} y2={plot.bottom} stroke="#24344b" strokeOpacity="0.35" />
            <text x={x(minute)} y={height - 12} fill="#91a3bd" fontSize="11" textAnchor={minute === 0 ? "start" : minute === DAY_MINUTES ? "end" : "middle"}>{formatDayMinute(minute, { compact: true })}</text>
          </g>
        ))}
        <g clipPath={`url(#${id}-clip)`}>
          {forecastSegments.map((rows, index) => rows.length > 1 ? (
            <path key={`forecast-${index}`} d={line(rows)} fill="none" stroke={FORECAST_COLOR} strokeWidth="1.6" strokeDasharray="5 6" strokeOpacity="0.7" />
          ) : <circle key={`forecast-${index}`} cx={x(rows[0].minute)} cy={y(rows[0].tempC)} r="2" fill={FORECAST_COLOR} />)}
          {amosSegments.map((rows, index) => (
            <g key={`amos-${index}`}>
              {rows.length > 1 && <path d={`${line(rows)} L${x(rows.at(-1).minute)},${plot.bottom} L${x(rows[0].minute)},${plot.bottom} Z`} fill={`url(#${id}-fill)`} />}
              <path d={line(rows)} fill="none" stroke={AMOS_COLOR} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
              {rows.length === 1 && <circle cx={x(rows[0].minute)} cy={y(rows[0].tempC)} r="2.5" fill={AMOS_COLOR} />}
            </g>
          ))}
          {official.map((row) => (
            <circle key={`${row.time}-${row.minute}`} cx={x(row.minute)} cy={y(row.tempC)} r={narrow ? 3 : 3.5} fill={METAR_COLOR} stroke="#102034" strokeWidth="1.3" />
          ))}
          {isToday && Number.isFinite(nowMinute) && nowMinute >= 0 && nowMinute <= DAY_MINUTES && (
            <line x1={x(nowMinute)} x2={x(nowMinute)} y1={plot.top} y2={plot.bottom} stroke="#8195b2" strokeOpacity="0.45" strokeDasharray="2 5" />
          )}
          {selectedMinute !== null && (
            <g>
              <line x1={x(cursorMinute)} x2={x(cursorMinute)} y1={plot.top} y2={plot.bottom} stroke="#e3ebf7" strokeOpacity="0.4" strokeDasharray="3 4" />
              {selected.filter((item) => item.row).map(({ name, row, color }) => (
                <circle key={name} cx={x(row.minute)} cy={y(row.tempC)} r="5" fill="#0c192b" stroke={color} strokeWidth="2" />
              ))}
            </g>
          )}
        </g>
        {!hasData && <text x={(plot.left + plot.right) / 2} y={(plot.top + plot.bottom) / 2} fill="#a4b4ca" fontSize="13" textAnchor="middle">No temperature points available</text>}
      </svg>
      <div className="inspection" aria-live="polite" aria-atomic="true">
        <span className="inspection-time">{clock(cursorMinute)} <small>KST</small></span>
        <div className="readings">
          {selected.map(({ name, row, color, digits }) => (
            <span className="reading" key={name}>
              <span className="reading-name" style={{ color }}>{name}</span>
              {row ? <><strong>{row.tempC.toFixed(digits)}°</strong><span className="reading-time">at {clock(row.minute)}</span></> : <span className="reading-time">No nearby reading</span>}
            </span>
          ))}
        </div>
      </div>
      <label className="slider-label" htmlFor={`${id}-time`}>Inspect time <span>Hover, tap, or use arrow keys</span></label>
      <input
        id={`${id}-time`}
        className="time-slider"
        type="range"
        min="0"
        max={DAY_MINUTES}
        step="1"
        value={Math.round(cursorMinute)}
        aria-valuetext={accessibleValue}
        onChange={(event) => setSelectedMinute(Number(event.target.value))}
      />
      <style jsx>{`
        .temperature-chart { min-width: 0; width: 100%; color: #dce7f5; font-variant-numeric: tabular-nums; }
        .legend { display: flex; flex-wrap: wrap; gap: 12px 22px; margin-bottom: 10px; color: #b6c6d9; font-size: 11px; line-height: 1.5; }
        .inspection { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; min-height: 62px; padding: 12px 14px; border: 1px solid #23364d; border-radius: 10px; background: #0b1728; }
        .inspection-time { font-size: 16px; font-weight: 650; }
        .inspection-time small { color: #8195af; font-size: 10px; font-weight: 500; }
        .readings { display: flex; flex: 1; flex-wrap: wrap; gap: 10px 24px; }
        .reading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px 7px; font-size: 12px; }
        .reading-name { font-size: 10px; }
        .reading strong { color: #eaf3fe; font-size: 15px; font-weight: 600; }
        .reading-time { color: #8b9eb8; font-size: 10px; }
        .slider-label { display: flex; justify-content: space-between; gap: 10px; margin-top: 13px; color: #a4b4ca; font-size: 10px; }
        .slider-label span { color: #7f92ad; text-align: right; }
        .time-slider { display: block; width: 100%; min-width: 0; height: 28px; margin: 2px 0 0; accent-color: #49d8ec; cursor: pointer; }
        .time-slider:focus-visible { outline: 2px solid #49d8ec; outline-offset: 3px; border-radius: 4px; }
        @media (max-width: 560px) {
          .legend { gap: 8px 14px; font-size: 10px; }
          .inspection { align-items: flex-start; gap: 9px; padding: 11px; }
          .inspection-time { flex-basis: 100%; font-size: 14px; }
          .readings { gap: 10px 16px; }
          .reading { flex-basis: calc(50% - 8px); gap: 3px 6px; }
          .reading-name { flex-basis: 100%; }
        }
      `}</style>
    </div>
  );
}
