"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatDayMinute } from "./displayTime";
import { cloudColor } from "./providerForecastState";

const DAY_MINUTES = 1440;
const AMOS_COLOR = "#49d8ec";
const METAR_COLOR = "#ffe2b5";
const FORECAST_COLOR = "#a0aeca";
const SUN_COLOR = "#edbf74";
const MOON_COLOR = "#c8d6e8";
const CLOUD_COLOR = "#b8cce0";
const BACK_CLOUD_COLOR = "#6f859e";
const RAIN_COLOR = "#6b9cf7";
// Hour columns print their own values from this width; narrower charts label every third hour,
// or every fourth below THIRD_HOUR_COLUMN_WIDTH, where "CAVOK" would touch its neighbour.
const HOURLY_COLUMN_WIDTH = 34;
const THIRD_HOUR_COLUMN_WIDTH = 10;
// Capitals at 9 px with their letter spacing, and the room a section label leaves before the next one.
const SECTION_LABEL_CHARACTER_WIDTH = 6.2;
const SECTION_LABEL_MARGIN = 3;
const STRIP = { sources: 10, rule: 15, time: 28, icon: 32, cloudText: 63, band: 68, rain: 79, sun: 106, plotTop: 122 };
const BAND_HEIGHT = 6;
const RAIN_HEIGHT = 16;
const CLOUD_PATH = "M7 19a4 4 0 0 1-.6-7.95 5.5 5.5 0 0 1 10.6-1.3A4.5 4.5 0 0 1 17.5 19Z";
const DROP_PATH = "M4 0C4 0 8 4.7 8 7.1A4 4 0 0 1 0 7.1C0 4.7 4 0 4 0Z";

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

// Sun by day, moon by night: this is the part of the icon a cloud can cover.
function SkyLight({ isDay, cx, cy, r }) {
  if (!isDay) {
    return <path d={`M${cx + r * 0.35} ${cy - r}A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.35}A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.35} ${cy - r}Z`} fill={MOON_COLOR} />;
  }
  const rays = Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4);
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={SUN_COLOR} />
      {rays.map((angle) => (
        <line key={angle} x1={cx + Math.cos(angle) * (r + 1.5)} y1={cy + Math.sin(angle) * (r + 1.5)} x2={cx + Math.cos(angle) * (r + 3)} y2={cy + Math.sin(angle) * (r + 3)} stroke={SUN_COLOR} strokeWidth="1.3" strokeLinecap="round" />
      ))}
    </g>
  );
}

const cloud = (transform, fill = CLOUD_COLOR) => <path d={CLOUD_PATH} fill={fill} transform={transform} />;
const SKY_SHAPES = {
  clear: (isDay) => <SkyLight isDay={isDay} cx={12} cy={12} r={5} />,
  few: (isDay) => <><SkyLight isDay={isDay} cx={10} cy={10} r={4.5} />{cloud("translate(9.5 10.5) scale(.56)")}</>,
  partly: (isDay) => <><SkyLight isDay={isDay} cx={8.5} cy={8.5} r={3.8} />{cloud("translate(4 5.5) scale(.82)")}</>,
  mostly: (isDay) => <><SkyLight isDay={isDay} cx={6.5} cy={6.5} r={2.8} />{cloud("translate(1 2) scale(.96)")}</>,
  overcast: () => <>{cloud("translate(6 -2) scale(.78)", BACK_CLOUD_COLOR)}{cloud("translate(-1 3) scale(.95)")}</>,
  rain: () => <>{cloud("translate(0 -4.5)")}{[8, 12.5, 17].map((dropX) => <line key={dropX} x1={dropX} y1={17} x2={dropX - 1.2} y2={21.5} stroke={RAIN_COLOR} strokeWidth="1.9" strokeLinecap="round" />)}</>,
  snow: () => <>{cloud("translate(0 -4.5)")}{[[7.5, 18], [12, 20.5], [16.5, 18]].map(([dotX, dotY]) => <circle key={dotX} cx={dotX} cy={dotY} r="1.5" fill={MOON_COLOR} />)}</>,
  thunder: () => <>{cloud("translate(0 -4.5)")}<path d="M13 13.5 8.8 19h3l-1.3 4.5 5.2-6.5h-3.1l1.5-3.5Z" fill={SUN_COLOR} /></>,
  fog: () => <g stroke={CLOUD_COLOR} strokeWidth="2" strokeLinecap="round"><line x1="4" x2="20" y1="7" y2="7" /><line x1="6.5" x2="20" y1="11.5" y2="11.5" /><line x1="4" x2="17.5" y1="16" y2="16" /><line x1="7" x2="20" y1="20.5" y2="20.5" /></g>,
  // CAVOK and friends rule out low cloud only, so the outline leaves the rest of the sky open.
  nosig: (isDay) => <><SkyLight isDay={isDay} cx={9.5} cy={9.5} r={4.2} /><path d={CLOUD_PATH} fill="none" stroke={CLOUD_COLOR} strokeWidth="2.2" strokeDasharray="3 3" transform="translate(9 10.5) scale(.6)" /></>,
  unknown: () => <path d={CLOUD_PATH} fill="none" stroke={BACK_CLOUD_COLOR} strokeWidth="1.5" strokeDasharray="2.5 2.5" />,
};

function SkyIcon({ icon, isDay, x, y, size }) {
  return <g transform={`translate(${x} ${y}) scale(${size / 24})`} aria-hidden="true">{(SKY_SHAPES[icon] ?? SKY_SHAPES.unknown)(isDay)}</g>;
}

function SkyStrip({ sky, x, plot, narrow, selectedHour }) {
  const hourWidth = (plot.right - plot.left) / 24;
  const roomy = hourWidth >= HOURLY_COLUMN_WIDTH;
  const stride = roomy ? 1 : hourWidth >= THIRD_HOUR_COLUMN_WIDTH ? 3 : 4;
  const fontSize = narrow ? 9 : 10;
  const iconSize = narrow ? 17 : 20;
  const gap = narrow ? 1 : 2;
  const cell = (hour) => ({ x: x(hour * 60) + gap / 2, width: hourWidth - gap });
  const rainMiddle = STRIP.rain + RAIN_HEIGHT / 2;
  const sectionLabel = (word, short, sources, width) =>
    [sources ? `${word} · ${sources}` : "", word, short].find((text) => text && text.length * SECTION_LABEL_CHARACTER_WIDTH + SECTION_LABEL_MARGIN <= width) ?? "";
  const hasData = sky.hours.some((row) => row.kind !== "none");
  const observedEnd = x((sky.observedEndHour ?? 0) * 60);
  const forecastStart = sky.forecastStartHour === null ? null : x(sky.forecastStartHour * 60);
  const observedLabel = sky.observedEndHour === null ? "" : sectionLabel("OBSERVED", "OBS", "METAR SKY, AMOS RAIN GAUGE", observedEnd - plot.left);
  const forecastLabel = forecastStart === null ? "" : sectionLabel("FORECAST", "FCST", sky.forecastSources.toUpperCase(), plot.right - forecastStart);
  // The stored forecasts carry no rain chance: say so once, in the longest dry stretch of forecast hours.
  let dryRun = null;
  let run = null;
  for (const row of sky.hours) {
    run = row.kind === "forecast" && row.rain.state === "dry" ? { start: run?.start ?? row.hour, end: row.hour } : null;
    if (run && (!dryRun || run.end - run.start > dryRun.end - dryRun.start)) dryRun = run;
  }
  const dryRunX = dryRun ? x(dryRun.start * 60) : 0;
  const dryRunWidth = dryRun ? (dryRun.end - dryRun.start + 1) * hourWidth : 0;
  const sunLabel = (minute, name) => `${narrow ? (name === "Sunrise" ? "↑" : "↓") : name} ${formatDayMinute(minute)}`;
  const dropScale = hourWidth < 12 ? 0.8 : 1;

  return (
    <g>
      {sky.sunriseMinute !== null && sky.sunsetMinute !== null && (
        <g>
          <rect x={plot.left} y={STRIP.rule} width={x(sky.sunriseMinute) - plot.left} height={plot.bottom - STRIP.rule} fill="#0a1321" opacity="0.5" />
          <rect x={x(sky.sunsetMinute)} y={STRIP.rule} width={plot.right - x(sky.sunsetMinute)} height={plot.bottom - STRIP.rule} fill="#0a1321" opacity="0.5" />
          <line x1={x(sky.sunriseMinute)} x2={x(sky.sunsetMinute)} y1={STRIP.sun + 4} y2={STRIP.sun + 4} stroke={SUN_COLOR} strokeOpacity="0.55" strokeWidth="1.5" strokeLinecap="round" />
          <text x={x(sky.sunriseMinute) - 5} y={STRIP.sun + 7} fill="#b6a98f" fontSize={fontSize} textAnchor="end">{sunLabel(sky.sunriseMinute, "Sunrise")}</text>
          <text x={x(sky.sunsetMinute) + 5} y={STRIP.sun + 7} fill="#b6a98f" fontSize={fontSize}>{sunLabel(sky.sunsetMinute, "Sunset")}</text>
        </g>
      )}
      {observedLabel && <text x={plot.left + 1} y={STRIP.sources} fill="#a4b4ca" fontSize="9" letterSpacing=".05em">{observedLabel}</text>}
      {forecastLabel && <text x={forecastStart + 1} y={STRIP.sources} fill="#a4b4ca" fontSize="9" letterSpacing=".05em">{forecastLabel}</text>}
      {sky.observedEndHour !== null && <line x1={plot.left} x2={observedEnd - 1} y1={STRIP.rule} y2={STRIP.rule} stroke={AMOS_COLOR} strokeOpacity="0.7" />}
      {forecastStart !== null && <line x1={forecastStart + 1} x2={plot.right} y1={STRIP.rule} y2={STRIP.rule} stroke={FORECAST_COLOR} strokeOpacity="0.7" strokeDasharray="5 6" />}
      <text x={plot.left - 9} y={STRIP.icon + iconSize / 2 + 3} fill="#a4b4ca" fontSize="10" textAnchor="end">Sky</text>
      <text x={plot.left - 9} y={rainMiddle + 3.5} fill="#a4b4ca" fontSize="10" textAnchor="end">Rain</text>
      {selectedHour !== null && <rect {...cell(selectedHour)} y={STRIP.rule + 2} height={STRIP.rain + RAIN_HEIGHT - STRIP.rule - 1} rx="3" fill="#e3ebf7" opacity="0.08" />}
      {sky.hours.map((row) => {
        const bounds = cell(row.hour);
        const showAmount = hourWidth >= 20 && row.rain.mm > 0;
        const showDrop = roomy || !showAmount;
        const dropWidth = showDrop ? 8 * dropScale : 0;
        // Whole millimetres fit a column from 10 mm up; the readout keeps the decimal.
        const amount = row.rain.mm >= 10 ? Math.round(row.rain.mm) : row.rain.mm;
        const amountWidth = showAmount ? String(amount).length * 5.6 : 0;
        const rainLeft = bounds.x + (bounds.width - dropWidth - amountWidth - (showDrop && showAmount ? 4 : 0)) / 2;
        return (
          <g key={row.hour}>
            <title>{`${formatDayMinute(row.hour * 60, { compact: true })} · ${row.kind === "observed" ? "Observed" : row.kind === "forecast" ? "Forecast" : "No data"}\nSky: ${row.skyLabel}${row.skyDetail ? ` · ${row.skyDetail}` : ""}\nRain: ${row.rain.label}${row.rain.detail ? ` · ${row.rain.detail}` : ""}`}</title>
            <rect x={x(row.hour * 60)} y={STRIP.rule} width={hourWidth} height={STRIP.rain + RAIN_HEIGHT - STRIP.rule} fill="transparent" />
            {row.coverPct !== null ? <rect {...bounds} y={STRIP.band} height={BAND_HEIGHT} rx="2" fill={cloudColor(row.coverPct)} />
              : row.kind !== "none" ? <rect {...bounds} y={STRIP.band + 0.5} height={BAND_HEIGHT - 1} rx="2" fill="none" stroke="#4a5d74" strokeDasharray="2 2" /> : null}
            {row.rain.state === "wet" ? (
              <g>
                <rect {...bounds} y={STRIP.rain} height={RAIN_HEIGHT} rx="4" fill={row.kind === "observed" ? "#22416f" : "none"} stroke={row.kind === "observed" ? "none" : RAIN_COLOR} strokeOpacity="0.75" strokeDasharray={row.kind === "observed" ? undefined : "3 3"} />
                {showDrop && <path d={DROP_PATH} fill={RAIN_COLOR} transform={`translate(${rainLeft} ${rainMiddle - 5.5 * dropScale}) scale(${dropScale})`} />}
                {showAmount && <text x={rainLeft + dropWidth + (showDrop ? 4 : 0)} y={rainMiddle + 3.5} fill="#e4eefc" fontSize={fontSize}>{amount}</text>}
              </g>
            ) : row.rain.state === "dry" && row.kind === "observed" && row.rain.mm !== null ? <line x1={bounds.x} x2={bounds.x + bounds.width} y1={rainMiddle} y2={rainMiddle} stroke="#3a4c64" /> : null}
          </g>
        );
      })}
      {sky.hours.filter((row) => row.hour % stride === 0).map((row) => {
        const left = x(row.hour * 60) + 1;
        return (
          <g key={row.hour} pointerEvents="none">
            <text x={left} y={STRIP.time} fill="#91a3bd" fontSize={fontSize}>{formatDayMinute(row.hour * 60, { compact: true })}</text>
            {row.icon ? <SkyIcon icon={row.icon} isDay={row.isDay} x={left} y={STRIP.icon} size={iconSize} /> : <text x={left + 2} y={STRIP.icon + iconSize / 2 + 3} fill="#7f92ad" fontSize={fontSize}>—</text>}
            {row.cloudText && <text x={left} y={STRIP.cloudText} fill="#c4d2e3" fontSize={fontSize}>{row.cloudText}</text>}
          </g>
        );
      })}
      {dryRunWidth >= 95 && <text x={dryRunX + dryRunWidth / 2} y={rainMiddle + 3} fill="#8b9eb8" fontSize="9" textAnchor="middle" pointerEvents="none">no rain chance data</text>}
      {!hasData && <text x={(plot.left + plot.right) / 2} y={STRIP.cloudText} fill="#a4b4ca" fontSize="12" textAnchor="middle" pointerEvents="none">{sky.loading ? "Loading sky and rain…" : "No sky or rain data for this date"}</text>}
    </g>
  );
}

export default function TemperatureChart({
  amos = [],
  metar = [],
  forecast = [],
  sky = null,
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
  const plotTop = sky ? STRIP.plotTop : 28;
  const height = plotTop + (narrow ? 252 : 302);
  const plot = { left: 42, right: width - 17, top: plotTop, bottom: height - 35 };
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
  const cursorHour = Math.min(23, Math.floor(cursorMinute / 60));
  const skyNote = [
    Number.isFinite(sky?.observedEndHour) ? "Past hours are observed: routine METAR sky, AMOS rain gauge in mm." : "",
    Number.isFinite(sky?.forecastStartHour) ? `${sky.observedEndHour === null ? "Hours" : "Later hours"} are forecast: ${sky.forecastSources}. The stored forecasts have no rain chance, so none is shown.` : "",
    Number.isFinite(sky?.sunriseMinute) ? `${narrow ? "↑ Sunrise and ↓ sunset" : "Sunrise and sunset"} are calculated.` : "",
  ].filter(Boolean).join(" ");
  const skyAtCursor = sky?.hours[cursorHour] ?? null;
  const skyHourName = skyAtCursor ? `${formatDayMinute(cursorHour * 60, { compact: true })}${{ observed: " observed", forecast: " forecast" }[skyAtCursor.kind] ?? ""}` : "";
  const skyReadings = skyAtCursor ? [
    { name: "Sky", label: skyAtCursor.skyLabel, detail: skyAtCursor.skyDetail },
    { name: "Rain", label: skyAtCursor.rain.label, detail: skyAtCursor.rain.detail },
  ] : [];
  const accessibleValue = `${clock(cursorMinute)} KST. ${selected.map(({ name, row, digits }) => `${name}: ${row ? `${row.tempC.toFixed(digits)} degrees Celsius at ${clock(row.minute)}` : "no nearby reading"}`).join(". ")}${skyReadings.map(({ name, label, detail }) => `. ${name}, ${skyHourName}: ${label}${detail ? `, ${detail}` : ""}`).join("")}`;

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
        <span className="legend-zone">KST · UTC+9</span>
      </div>
      {skyNote && <p className="sky-note">{skyNote}</p>}
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
          {sky ? " Above the plot, a strip shows each hour's sky and rain: observed for past hours, forecast for later ones. Night hours are shaded, with calculated sunrise and sunset times." : ""}
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
        {sky && <SkyStrip sky={sky} x={x} plot={plot} narrow={narrow} selectedHour={selectedMinute === null ? null : cursorHour} />}
        <text x={plot.left - 9} y={plot.top - 14} fill="#a4b4ca" fontSize="11" textAnchor="end">°C</text>
        {domain.ticks.map((tick) => (
          <g key={tick}>
            <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} stroke="#26364d" strokeOpacity="0.65" />
            <text x={plot.left - 10} y={y(tick) + 4} fill="#a4b4ca" fontSize="11" textAnchor="end">{tick}</text>
          </g>
        ))}
        {timeTicks.map((minute) => (
          <g key={minute}>
            <line x1={x(minute)} x2={x(minute)} y1={sky ? STRIP.rule : plot.top} y2={plot.bottom} stroke="#24344b" strokeOpacity="0.35" pointerEvents="none" />
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
        {sky && selectedMinute !== null && <line x1={x(cursorMinute)} x2={x(cursorMinute)} y1={STRIP.rule + 2} y2={plot.top} stroke="#e3ebf7" strokeOpacity="0.4" strokeDasharray="3 4" pointerEvents="none" />}
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
          {skyReadings.map(({ name, label, detail }) => (
            <span className="reading reading-wide" key={name}>
              <span className="reading-name reading-sky">{name} · {skyHourName}</span>
              <strong>{label}</strong>{detail && <span className="reading-time">{detail}</span>}
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
        .legend-zone { margin-left: auto; color: #7e91ab; font-size: 10px; white-space: nowrap; }
        .sky-note { margin: -4px 0 12px; color: #8b9eb8; font-size: 10px; line-height: 1.5; }
        .inspection { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; min-height: 62px; padding: 12px 14px; border: 1px solid #23364d; border-radius: 10px; background: #0b1728; }
        .inspection-time { font-size: 16px; font-weight: 650; }
        .inspection-time small { color: #8195af; font-size: 10px; font-weight: 500; }
        .readings { display: flex; flex: 1; flex-wrap: wrap; gap: 10px 24px; }
        .reading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px 7px; font-size: 12px; }
        .reading-name { font-size: 10px; }
        .reading-sky { color: #a4b4ca; }
        .reading-wide { flex-basis: 100%; }
        .reading strong { color: #eaf3fe; font-size: 15px; font-weight: 600; }
        .reading-time { color: #8b9eb8; font-size: 10px; }
        .slider-label { display: flex; justify-content: space-between; gap: 10px; margin-top: 13px; color: #a4b4ca; font-size: 10px; }
        .slider-label span { color: #7f92ad; text-align: right; }
        .time-slider { display: block; width: 100%; min-width: 0; height: 28px; margin: 2px 0 0; accent-color: #49d8ec; cursor: pointer; }
        .time-slider:focus-visible { outline: 2px solid #49d8ec; outline-offset: 3px; border-radius: 4px; }
        /* Where the longest text would wrap, give every hour the same rows, so the slider below barely moves. */
        @media (max-width: 900px) {
          .reading { flex: 1 1 0; }
          .reading:not(.reading-wide) .reading-name { flex-basis: 100%; }
          .reading-wide { flex-basis: 100%; }
          .reading-wide .reading-time { flex-basis: 100%; }
        }
        @media (max-width: 720px) {
          .inspection-time { flex-basis: 100%; }
        }
        @media (max-width: 560px) {
          .legend { gap: 8px 14px; font-size: 10px; }
          .inspection { align-items: flex-start; gap: 9px; padding: 11px; }
          .inspection-time { flex-basis: 100%; font-size: 14px; }
          .readings { gap: 10px 16px; }
          .reading { flex-basis: calc(50% - 8px); gap: 3px 6px; }
          .reading-name { flex-basis: 100%; }
          .reading-wide { flex-basis: 100%; }
        }
      `}</style>
    </div>
  );
}
