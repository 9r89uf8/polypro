"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatDayMinute } from "./displayTime";
import { CLOUD_RAMP, LOCK_HOUR, cloudColor, formatHour, formatSigned, formatTemperature, skyPercentRange } from "./providerForecastState";
import styles from "./providerForecasts.module.css";

const DAY_MINUTES = 1440;
const SENSOR_COLOR = "#49d8ec";
const METAR_COLOR = "#ffe2b5";
const SURFACE = "#101a2a";
// Highlight on keyboard focus only: a tap or click also focuses the button,
// and that highlight would stay until focus moves.
const keyboardFocus = (element) => { try { return element.matches(":focus-visible"); } catch { return true; } };

function cleanMinutes(rows) {
  const byMinute = new Map();
  for (const row of rows ?? []) {
    if (Number.isFinite(row?.minute) && Number.isFinite(row?.tempC) && row.minute >= 0 && row.minute <= DAY_MINUTES) byMinute.set(row.minute, row);
  }
  return [...byMinute.values()].sort((a, b) => a.minute - b.minute);
}

function temperatureDomain(values) {
  if (!values.length) return { low: 0, high: 30, ticks: [0, 10, 20, 30] };
  const lowest = Math.min(...values), highest = Math.max(...values);
  const padding = Math.max(1, (highest - lowest) * 0.12);
  const roughStep = (highest - lowest + 2 * padding) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= roughStep) * magnitude;
  const low = Math.floor((lowest - padding) / step) * step, high = Math.ceil((highest + padding) / step) * step;
  const ticks = [];
  for (let tick = low; tick <= high + step / 10; tick += step) ticks.push(Number(tick.toFixed(4)));
  return { low, high, ticks };
}

function splitAtGaps(rows, maximumGap) {
  const groups = [];
  for (const row of rows) {
    const previous = groups.at(-1)?.at(-1);
    if (!previous || row.minute - previous.minute > maximumGap) groups.push([row]); else groups.at(-1).push(row);
  }
  return groups;
}

// Consecutive hours with the same label merge into one span.
function spans(cells) {
  const merged = [];
  for (const cell of cells) {
    const previous = merged.at(-1);
    if (previous && previous.text === cell.text && previous.endHour === cell.hour - 1) previous.endHour = cell.hour;
    else merged.push({ text: cell.text, startHour: cell.hour, endHour: cell.hour });
  }
  return merged;
}

export function LineKey({ color, dash = "", point = false }) {
  return <svg className={styles.lineKey} width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
    {point ? <circle cx="11" cy="5" r="3.5" fill={color} />
      : <line x1="2" x2="20" y1="5" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dash || undefined} />}
  </svg>;
}

function skyText(sky) {
  if (!sky) return "no report";
  const range = skyPercentRange(sky);
  return range ? `${sky.code || sky.label} · ${sky.minOktas === sky.maxOktas ? sky.minOktas : `${sky.minOktas}–${sky.maxOktas}`}/8` : sky.code || sky.label;
}

export default function ProviderForecastChart({ date, providers = [], actuals, amos = [], metar = [], isToday = false, nowMinute = null, final = false }) {
  const hostRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [hidden, setHidden] = useState([]);
  const [focusId, setFocusId] = useState(null);
  const [selectedHour, setSelectedHour] = useState(null);
  const id = useId().replaceAll(":", "");
  const sensor = useMemo(() => cleanMinutes(amos), [amos]);
  const reports = useMemo(() => cleanMinutes(metar), [metar]);
  const available = providers.filter((provider) => provider.hourly.length);
  const visible = available.filter((provider) => !hidden.includes(provider.id));
  const domain = temperatureDomain([...sensor, ...reports, ...visible.flatMap((provider) => provider.hourly)].map((row) => row.tempC));

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(240, element.clientWidth));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setSelectedHour(null); setHidden([]); }, [date]);

  const narrow = width < 560;
  const plot = { left: 46, right: width - 14, top: 30, bottom: 30 + (narrow ? 210 : 270) };
  const rowHeight = narrow ? 11 : 13, rowGap = 3, cellGap = narrow ? 1 : 2;
  const stripRows = [{ id: "observed", label: "METAR" }, ...providers.map((provider) => ({ id: provider.id, label: provider.shortLabel, provider }))];
  const stripTop = plot.bottom + 28;
  const rowY = (index) => stripTop + index * (rowHeight + rowGap);
  const stripBottom = rowY(stripRows.length) - rowGap;
  const height = stripBottom + 30;
  const x = (minute) => plot.left + (minute / DAY_MINUTES) * (plot.right - plot.left);
  const y = (tempC) => plot.bottom - ((tempC - domain.low) / (domain.high - domain.low)) * (plot.bottom - plot.top);
  const path = (rows) => rows.map((row, index) => `${index ? "L" : "M"}${x(row.minute).toFixed(1)},${y(row.tempC).toFixed(1)}`).join(" ");
  const cellBounds = (startHour, endHour = startHour) => {
    const left = x(Math.max(0, startHour * 60 - 30)) + cellGap / 2, right = x(Math.min(DAY_MINUTES, endHour * 60 + 30)) - cellGap / 2;
    return { x: left, width: Math.max(0, right - left) };
  };
  const timeTicks = narrow ? [0, 360, 720, 1080, 1440] : [0, 180, 360, 540, 720, 900, 1080, 1260, 1440];
  const actualByHour = actuals?.hourly ?? [];
  const high = actuals?.highAfterLock ?? null;
  const highText = high ? `${final ? "High from 9 AM" : "Highest since 9 AM"} ${formatTemperature(high.tempC, 0)}` : "";
  // Kept inside the clipped plot: an estimated 6.6 px per character at the label's 11 px semibold.
  const highHalfWidth = highText.length * 3.3;
  const defaultHour = isToday && Number.isFinite(nowMinute) ? Math.min(23, Math.floor(nowMinute / 60))
    : high ? Math.min(23, Math.floor(high.minute / 60)) : 14;
  const hour = selectedHour ?? defaultHour;
  const observedAtHour = actualByHour[hour] ?? null;
  const readings = available.map((provider) => {
    const row = provider.hourly.find((item) => item.hour === hour) ?? null;
    const digits = provider.hourly.every((item) => Number.isInteger(item.tempC)) ? 0 : 1;
    const errorC = row && hour >= LOCK_HOUR && Number.isFinite(observedAtHour?.amosC) ? row.tempC - observedAtHour.amosC : null;
    const cloud = row?.cloudCoverPct !== null && row?.cloudCoverPct !== undefined ? `cloud ${row.cloudCoverPct}%` : row?.sky ?? "";
    return { provider, row, digits, errorC, cloud };
  });
  // A hidden provider is never the highlight, so hiding one never fades the rest.
  const highlighted = focusId && visible.some((provider) => provider.id === focusId) ? focusId : null;
  const dim = (providerId) => (highlighted && highlighted !== providerId ? 0.22 : 1);
  const accessibleValue = `${formatHour(hour)} KST. 15L sensor ${formatTemperature(observedAtHour?.amosC)}. ${readings.map(({ provider, row, digits, errorC }) =>
    `${provider.label} ${row ? `${formatTemperature(row.tempC, digits)}${errorC !== null ? `, ${formatSigned(errorC)} against the sensor` : ""}` : "no value"}`).join(". ")}`;

  function inspectPointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const minute = ((((event.clientX - bounds.left) / bounds.width) * width - plot.left) / (plot.right - plot.left)) * DAY_MINUTES;
    setSelectedHour(Math.max(0, Math.min(23, Math.round(minute / 60))));
  }
  const toggle = (providerId) => setHidden((current) => (current.includes(providerId) ? current.filter((item) => item !== providerId) : [...current, providerId]));

  function stripRow(row, index) {
    const top = rowY(index);
    if (row.id === "observed") {
      return actualByHour.flatMap(({ hour: cellHour, sky }) => {
        if (!sky) return [];
        const range = skyPercentRange(sky), bounds = cellBounds(cellHour);
        if (range) return [<rect key={cellHour} {...bounds} y={top} height={rowHeight} rx="2" fill={cloudColor((range[0] + range[1]) / 2)}><title>{`${formatHour(cellHour)} METAR ${skyText(sky)}`}</title></rect>];
        return [<rect key={cellHour} {...bounds} y={top + 0.5} height={rowHeight - 1} rx="2" fill="none" stroke="#4a5d74" strokeDasharray="2 2"><title>{`${formatHour(cellHour)} METAR ${sky.label}${sky.code ? ` (${sky.code})` : ""}: total cover not reported`}</title></rect>];
      });
    }
    const { provider } = row;
    if (!provider.hourly.length) {
      return [<text key="status" x={plot.left + 4} y={top + rowHeight - 2.5} className={styles.stripStatus}>{provider.shortStatus ?? provider.statusLabel}</text>];
    }
    const percents = provider.hourly.filter((item) => item.cloudCoverPct !== null);
    if (percents.length) {
      return percents.map((item) => <rect key={item.hour} {...cellBounds(item.hour)} y={top} height={rowHeight} rx="2" fill={cloudColor(item.cloudCoverPct)} opacity={item.hour < LOCK_HOUR ? 0.5 : 1}>
        <title>{`${formatHour(item.hour)} ${provider.label}: cloud ${item.cloudCoverPct}%`}</title></rect>);
    }
    // KMA publishes sky categories, never a percentage: outlined spans with the words when they fit.
    return spans(provider.hourly.filter((item) => item.sky).map((item) => ({ hour: item.hour, text: item.sky }))).map((span) => {
      const bounds = cellBounds(span.startHour, span.endHour), fits = bounds.width >= span.text.length * 5.2 + 8;
      return <g key={span.startHour}>
        <rect {...bounds} y={top + 0.5} height={rowHeight - 1} rx="2" fill="#16243a" stroke="#4d6280" />
        {fits ? <text x={bounds.x + 4} y={top + rowHeight - 3} className={styles.stripWords}>{span.text}</text> : null}
        <title>{`${formatHour(span.startHour)}${span.endHour > span.startHour ? `–${formatHour(span.endHour)}` : ""} ${provider.label}: ${span.text}`}</title>
      </g>;
    });
  }

  const providerLines = visible.map((provider) => {
    const before = provider.hourly.filter((row) => row.hour <= LOCK_HOUR), after = provider.hourly.filter((row) => row.hour >= LOCK_HOUR);
    return { provider, before: splitAtGaps(before, 60), after: splitAtGaps(after, 60) };
  });

  return (
    <div className={styles.chart} ref={hostRef}>
      <div className={styles.legend} role="group" aria-label="Forecast series">
        <span className={styles.legendItem}><LineKey color={SENSOR_COLOR} />15L sensor · 0.1°C</span>
        <span className={styles.legendItem}><LineKey color={METAR_COLOR} point />Routine METAR · whole °C</span>
        {providers.map((provider) => provider.hourly.length ? (
          <button key={provider.id} type="button" className={styles.legendButton} aria-pressed={!hidden.includes(provider.id)} onClick={() => toggle(provider.id)}
            onPointerEnter={(event) => { if (event.pointerType === "mouse") setFocusId(provider.id); }} onPointerLeave={(event) => { if (event.pointerType === "mouse") setFocusId(null); }}
            onFocus={(event) => { if (keyboardFocus(event.currentTarget)) setFocusId(provider.id); }} onBlur={() => setFocusId(null)}>
            <LineKey color={provider.color} dash={provider.dash} />{provider.label}
          </button>
        ) : <span key={provider.id} className={`${styles.legendItem} ${styles.legendOff}`}><LineKey color={provider.color} dash={provider.dash} />{provider.label} · {provider.shortStatus ?? provider.statusLabel}</span>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-labelledby={`${id}-title ${id}-description`}
        onPointerDown={inspectPointer} onPointerMove={(event) => { if (event.pointerType === "mouse" || event.buttons) inspectPointer(event); }}
        style={{ display: "block", touchAction: "pan-y" }}>
        <title id={`${id}-title`}>{`Forecasts locked at 9:00 AM KST for ${date}, with the observed temperature and cloud cover`}</title>
        <desc id={`${id}-description`}>
          The 15L sensor is a cyan line and routine METAR reports are warm white points. Each provider’s hourly forecast is a line with its own colour and dash
          pattern, with filled dots at its forecast high. Rows under the chart show forecast and observed cloud cover by hour. Use the time slider for values.
        </desc>
        <defs>
          <clipPath id={`${id}-clip`}><rect x={plot.left - 6} y={plot.top - 6} width={plot.right - plot.left + 12} height={plot.bottom - plot.top + 12} /></clipPath>
        </defs>
        <rect x={x(0)} y={plot.top} width={x(LOCK_HOUR * 60) - x(0)} height={stripBottom - plot.top} fill="#0a1321" opacity="0.6" />
        <text x={plot.left - 9} y={16} className={styles.axisUnit} textAnchor="end">°C</text>
        <text x={plot.right} y={16} className={styles.axisNote} textAnchor="end">KST · UTC+9</text>
        {domain.ticks.map((tick) => (
          <g key={tick}>
            <line x1={plot.left} x2={plot.right} y1={y(tick)} y2={y(tick)} stroke="#26364d" strokeOpacity="0.7" />
            <text x={plot.left - 10} y={y(tick) + 4} className={styles.axisLabel} textAnchor="end">{tick}</text>
          </g>
        ))}
        {timeTicks.map((minute) => (
          <g key={minute}>
            <line x1={x(minute)} x2={x(minute)} y1={plot.top} y2={stripBottom} stroke="#24344b" strokeOpacity="0.4" />
            <text x={x(minute)} y={height - 9} className={styles.axisLabel} textAnchor={minute === 0 ? "start" : minute === DAY_MINUTES ? "end" : "middle"}>{formatDayMinute(minute, { compact: true })}</text>
          </g>
        ))}
        <line x1={x(LOCK_HOUR * 60)} x2={x(LOCK_HOUR * 60)} y1={plot.top - 4} y2={stripBottom} stroke="#8aa0bc" strokeOpacity="0.75" />
        <text x={x(LOCK_HOUR * 60)} y={plot.top - 9} className={styles.lockLabel} textAnchor="middle">9 AM lock</text>
        <g clipPath={`url(#${id}-clip)`}>
          {providerLines.map(({ provider, before, after }) => (
            <g key={provider.id} opacity={dim(provider.id)}>
              {before.filter((rows) => rows.length > 1).map((rows) => <path key={`b${rows[0].hour}`} d={path(rows)} fill="none" stroke={provider.color} strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={provider.dash || undefined} />)}
              {after.map((rows) => rows.length > 1
                ? <path key={`a${rows[0].hour}`} d={path(rows)} fill="none" stroke={provider.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={provider.dash || undefined} />
                : <circle key={`a${rows[0].hour}`} cx={x(rows[0].minute)} cy={y(rows[0].tempC)} r="2.5" fill={provider.color} />)}
            </g>
          ))}
          {splitAtGaps(sensor, 5).map((rows) => rows.length > 1
            ? <path key={`s${rows[0].minute}`} d={path(rows)} fill="none" stroke={SENSOR_COLOR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity={highlighted ? 0.55 : 1} />
            : <circle key={`s${rows[0].minute}`} cx={x(rows[0].minute)} cy={y(rows[0].tempC)} r="2" fill={SENSOR_COLOR} />)}
          {reports.map((row) => <circle key={row.minute} cx={x(row.minute)} cy={y(row.tempC)} r={narrow ? 3 : 3.5} fill={METAR_COLOR} stroke={SURFACE} strokeWidth="1.5" />)}
          {providerLines.map(({ provider }) => provider.peak?.hours.map((peakHour) => (
            <circle key={`${provider.id}-${peakHour}`} cx={x(peakHour * 60)} cy={y(provider.peak.highC)} r="4.5" fill={provider.color} stroke={SURFACE} strokeWidth="2" opacity={dim(provider.id)}>
              <title>{`${provider.label} high ${formatTemperature(provider.peak.highC, Number.isInteger(provider.peak.highC) ? 0 : 1)} at ${formatHour(peakHour)}`}</title>
            </circle>
          )))}
          {high ? <g>
            <circle cx={x(high.minute)} cy={y(high.tempC)} r="7" fill="none" stroke={METAR_COLOR} strokeWidth="2" />
            <text x={Math.min(plot.right + 4 - highHalfWidth, Math.max(plot.left + highHalfWidth, x(high.minute)))} y={y(high.tempC) - 13} className={styles.highLabel} textAnchor="middle">
              {highText}
            </text>
          </g> : null}
          {isToday && Number.isFinite(nowMinute) ? <line x1={x(nowMinute)} x2={x(nowMinute)} y1={plot.top} y2={plot.bottom} stroke="#8195b2" strokeOpacity="0.5" strokeDasharray="2 5" /> : null}
          {selectedHour !== null ? <g>
            <line x1={x(hour * 60)} x2={x(hour * 60)} y1={plot.top} y2={plot.bottom} stroke="#e3ebf7" strokeOpacity="0.45" />
            {readings.filter(({ provider, row }) => row && !hidden.includes(provider.id)).map(({ provider, row }) => (
              <circle key={provider.id} cx={x(row.minute)} cy={y(row.tempC)} r="5" fill={SURFACE} stroke={provider.color} strokeWidth="2" />
            ))}
            {Number.isFinite(observedAtHour?.amosC) ? <circle cx={x(hour * 60)} cy={y(observedAtHour.amosC)} r="5" fill={SURFACE} stroke={SENSOR_COLOR} strokeWidth="2" /> : null}
          </g> : null}
        </g>
        <text x={plot.left} y={stripTop - 8} className={styles.stripHeading}>Cloud cover by hour</text>
        {stripRows.map((row, index) => (
          <g key={row.id}>
            <text x={plot.left - 6} y={rowY(index) + rowHeight - 2.5} className={styles.stripLabel} textAnchor="end">{row.label}</text>
            {stripRow(row, index)}
          </g>
        ))}
        {selectedHour !== null ? <line x1={x(hour * 60)} x2={x(hour * 60)} y1={stripTop - 2} y2={stripBottom + 2} stroke="#e3ebf7" strokeOpacity="0.45" /> : null}
        {!sensor.length && !reports.length && !available.length ? <text x={(plot.left + plot.right) / 2} y={(plot.top + plot.bottom) / 2} className={styles.axisLabel} textAnchor="middle">No forecast or observation points yet</text> : null}
      </svg>
      <div className={styles.cloudKey}>
        <span className={styles.ramp} style={{ background: `linear-gradient(90deg, ${CLOUD_RAMP.join(", ")})` }} aria-hidden="true" />
        <span>Cloud 0–100%</span>
        <span>KMA: sky words only, no percentage</span>
        <span>METAR: eighths of sky, shaded at the middle of the reported range; dashed when total cover is not reported</span>
      </div>
      <div className={styles.inspection} aria-live="polite" aria-atomic="true">
        <span className={styles.inspectionTime}>{formatHour(hour)} <small>KST</small></span>
        <div className={styles.readings}>
          <span className={styles.reading}><LineKey color={SENSOR_COLOR} /><strong>{formatTemperature(observedAtHour?.amosC)}</strong><span>15L sensor</span></span>
          <span className={styles.reading}><LineKey color={METAR_COLOR} point /><strong>{formatTemperature(observedAtHour?.metarC, 0)}</strong><span>METAR · {skyText(observedAtHour?.sky)}</span></span>
          {readings.map(({ provider, row, digits, errorC, cloud }) => (
            <span className={styles.reading} key={provider.id}>
              <LineKey color={provider.color} dash={provider.dash} />
              <strong>{row ? formatTemperature(row.tempC, digits) : "—"}</strong>
              <span>{provider.shortLabel}{errorC !== null ? ` · ${formatSigned(errorC)}` : ""}{cloud ? ` · ${cloud}` : ""}</span>
            </span>
          ))}
        </div>
      </div>
      <label className={styles.sliderLabel} htmlFor={`${id}-hour`}>Inspect hour <span>Hover, tap, or use arrow keys</span></label>
      <input id={`${id}-hour`} className={styles.slider} type="range" min="0" max="23" step="1" value={hour} aria-valuetext={accessibleValue}
        onChange={(event) => setSelectedHour(Number(event.target.value))} />
    </div>
  );
}
