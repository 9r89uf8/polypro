"use client";

import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const CHICAGO_TIMEZONE = "America/Chicago";
const STATION_ICAO = "KORD";
const METAR_MODE = {
  OFFICIAL: "official",
  ALL: "all",
};
const METAR_MODE_META = {
  official: {
    label: "Official (Routine + SPECI)",
    shortLabel: "official",
  },
  all: {
    label: "All (HF + Routine + SPECI)",
    shortLabel: "all",
  },
};
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getChicagoYearMonth() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, month };
}

function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function makeDateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseManualText(text, year, month) {
  const dayCount = getDaysInMonth(year, month);
  const lines = text.split(/\r?\n/);
  const previewRows = [];
  const values = [];
  const notes = [];
  let invalidCount = 0;

  for (let day = 1; day <= dayCount; day += 1) {
    const raw = lines[day - 1] ?? "";
    const trimmed = raw.trim();

    if (!trimmed) {
      previewRows.push({ day, raw, status: "blank", parsed: null });
      continue;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      invalidCount += 1;
      previewRows.push({
        day,
        raw,
        status: "error",
        parsed: null,
        message: "Not a number",
      });
      continue;
    }

    previewRows.push({
      day,
      raw,
      status: "ok",
      parsed,
    });
    values.push({ day, value: parsed });
  }

  for (let lineNumber = dayCount + 1; lineNumber <= lines.length; lineNumber += 1) {
    const extraLine = lines[lineNumber - 1];
    if (extraLine && extraLine.trim()) {
      notes.push(`Line ${lineNumber} is outside this month and will be ignored.`);
    }
  }

  return {
    previewRows,
    values,
    notes,
    invalidCount,
  };
}

function getStatusChipClass(status) {
  if (status === "ok") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "computing") {
    return "bg-amber-100 text-amber-900";
  }
  if (status === "error") {
    return "bg-red-100 text-red-800";
  }
  return "bg-black/5 text-black/60";
}

function getDeltaChipClass(deltaValue) {
  if (deltaValue === undefined || deltaValue === null) {
    return "bg-black/5 text-black/50";
  }

  const magnitude = Math.abs(deltaValue);
  if (magnitude === 0) {
    return "bg-emerald-100 text-emerald-800";
  }
  if (magnitude <= 1) {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-red-100 text-red-800";
}

function formatTemp(value, unit) {
  if (value === undefined || value === null) {
    return "—";
  }
  return `${value.toFixed(1)}°${unit}`;
}

function formatDelta(value, unit) {
  if (value === undefined || value === null) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}°${unit}`;
}

function buildYearOptions(currentYear) {
  const options = [];
  for (let year = currentYear - 5; year <= currentYear + 1; year += 1) {
    options.push(year);
  }
  return options.reverse();
}

function readMetarFieldsByMode(row, mode, displayUnit) {
  const isAllMode = mode === METAR_MODE.ALL;

  return {
    metarValue:
      displayUnit === "C"
        ? isAllMode
          ? row.metarAllMaxC
          : row.metarMaxC
        : isAllMode
          ? row.metarAllMaxF
          : row.metarMaxF,
    deltaValue:
      displayUnit === "C"
        ? isAllMode
          ? row.deltaAllC
          : row.deltaC
        : isAllMode
          ? row.deltaAllF
          : row.deltaF,
    metarTime: isAllMode ? row.metarAllMaxAtLocal : row.metarMaxAtLocal,
    metarObsCount: isAllMode ? row.metarAllObsCount : row.metarObsCount,
    metarRaw: isAllMode ? row.metarAllMaxRaw : row.metarMaxRaw,
  };
}

function MissingConvexSetup() {
  return (
    <main className="min-h-screen px-5 py-10 md:px-8">
      <section className="mx-auto max-w-3xl rounded-3xl border border-line/80 bg-panel/90 p-8 shadow-[0_18px_50px_rgba(37,35,27,0.12)]">
        <h1 className="text-2xl font-semibold text-foreground">
          Convex URL Needed
        </h1>
        <p className="mt-3 text-black/70">
          Set <code className="rounded bg-black/5 px-1">NEXT_PUBLIC_CONVEX_URL</code>{" "}
          and run <code className="rounded bg-black/5 px-1">npx convex dev</code>{" "}
          to use this page.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-black transition hover:border-black hover:text-black"
        >
          Back Home
        </Link>
      </section>
    </main>
  );
}

function KordMonthWorkspace() {
  const initial = useMemo(() => getChicagoYearMonth(), []);
  const [yearInput, setYearInput] = useState(initial.year);
  const [monthInput, setMonthInput] = useState(initial.month);
  const [activeYear, setActiveYear] = useState(initial.year);
  const [activeMonth, setActiveMonth] = useState(initial.month);

  const [manualUnit, setManualUnit] = useState("F");
  const [displayUnit, setDisplayUnit] = useState("F");
  const [metarMode, setMetarMode] = useState(METAR_MODE.OFFICIAL);
  const [manualText, setManualText] = useState("");

  const [saveMessage, setSaveMessage] = useState("");
  const [computeMessage, setComputeMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isComputing, setIsComputing] = useState(false);

  const monthData = useQuery("weather:getMonthComparison", {
    stationIcao: STATION_ICAO,
    year: activeYear,
    month: activeMonth,
  });

  const saveManualMonth = useMutation("weather:upsertManualMonth");
  const computeMetarMonth = useAction("weather:computeMetarMonth");

  const preview = useMemo(
    () => parseManualText(manualText, activeYear, activeMonth),
    [manualText, activeYear, activeMonth],
  );

  const yearOptions = useMemo(() => buildYearOptions(initial.year), [initial.year]);

  const rowsByDate = useMemo(() => {
    const map = new Map();
    for (const row of monthData?.rows ?? []) {
      map.set(row.date, row);
    }
    return map;
  }, [monthData?.rows]);

  const tableRows = useMemo(() => {
    const dayCount = getDaysInMonth(activeYear, activeMonth);
    const rows = [];
    for (let day = 1; day <= dayCount; day += 1) {
      const date = makeDateKey(activeYear, activeMonth, day);
      rows.push({
        date,
        ...(rowsByDate.get(date) ?? {}),
      });
    }
    return rows;
  }, [activeYear, activeMonth, rowsByDate]);

  const monthRun = monthData?.monthRun ?? null;
  const metarStatus =
    metarMode === METAR_MODE.ALL
      ? monthRun?.metarAllLastStatus ?? "idle"
      : monthRun?.metarLastStatus ?? "idle";
  const metarError =
    metarMode === METAR_MODE.ALL
      ? monthRun?.metarAllLastError
      : monthRun?.metarLastError;
  const metarComputedAtRaw =
    metarMode === METAR_MODE.ALL
      ? monthRun?.metarAllLastComputedAt
      : monthRun?.metarLastComputedAt;
  const metarComputedAt = metarComputedAtRaw
    ? new Date(metarComputedAtRaw).toLocaleString()
    : null;

  async function handleSaveManual() {
    if (preview.invalidCount > 0) {
      setSaveMessage("Fix invalid lines before saving.");
      return;
    }
    if (preview.values.length === 0) {
      setSaveMessage("No numeric values found for this month.");
      return;
    }

    setSaveMessage("");
    setIsSaving(true);
    try {
      const result = await saveManualMonth({
        stationIcao: STATION_ICAO,
        year: activeYear,
        month: activeMonth,
        unit: manualUnit,
        values: preview.values,
      });
      setSaveMessage(`Saved manual values for ${result.updatedDays} day(s).`);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleComputeMetar() {
    setComputeMessage("");
    setIsComputing(true);
    const requestedMode = metarMode;
    try {
      const result = await computeMetarMonth({
        stationIcao: STATION_ICAO,
        year: activeYear,
        month: activeMonth,
        mode: requestedMode,
      });
      setComputeMessage(
        `METAR ${METAR_MODE_META[requestedMode].shortLabel} updated for ${result.daysUpdated} day(s) from ${result.parsedObservationCount} parsed observation(s).`,
      );
    } catch (error) {
      setComputeMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsComputing(false);
    }
  }

  function handleLoadMonth() {
    setActiveYear(yearInput);
    setActiveMonth(monthInput);
    setSaveMessage("");
    setComputeMessage("");
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.12)] md:p-8">
          <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
            STATION {STATION_ICAO}
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight text-foreground md:text-4xl">
            Daily Max Comparison
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-black/70 md:text-base">
            Paste one manual daily max per line, save, then compute archived
            METAR/SPECI maxima for the same month.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-black transition hover:border-black hover:text-black"
          >
            Back Home
          </Link>
        </header>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
            <h2 className="text-lg font-semibold text-foreground">1. Month Selector</h2>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex min-w-[120px] flex-col gap-1 text-sm">
                <span className="font-medium text-black/70">Year</span>
                <select
                  value={yearInput}
                  onChange={(event) => setYearInput(Number(event.target.value))}
                  className="rounded-xl border border-black/20 bg-white/80 px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[180px] flex-col gap-1 text-sm">
                <span className="font-medium text-black/70">Month</span>
                <select
                  value={monthInput}
                  onChange={(event) => setMonthInput(Number(event.target.value))}
                  className="rounded-xl border border-black/20 bg-white/80 px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
                >
                  {MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={handleLoadMonth}
                className="rounded-full border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
              >
                Load
              </button>
            </div>
            <p className="mt-3 text-sm text-black/70">
              Active month:{" "}
              <span className="font-semibold text-black">
                {MONTH_NAMES[activeMonth - 1]} {activeYear}
              </span>
            </p>
          </article>

          <article className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
            <h2 className="text-lg font-semibold text-foreground">2. Compute METAR Daily Max</h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-black/70">Mode:</span>
              {Object.entries(METAR_MODE_META).map(([modeValue, modeMeta]) => (
                <button
                  key={modeValue}
                  type="button"
                  onClick={() => setMetarMode(modeValue)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    metarMode === modeValue
                      ? "bg-black text-white"
                      : "border border-black/20 bg-white/70 text-black/70 hover:border-black"
                  }`}
                >
                  {modeMeta.shortLabel}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-black/60">
              {METAR_MODE_META[metarMode].label}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleComputeMetar}
                disabled={isComputing}
                className="rounded-full border border-black bg-black px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isComputing ? "Computing..." : "Compute METAR Daily Max"}
              </button>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusChipClass(metarStatus)}`}
              >
                {metarStatus}
              </span>
            </div>

            {metarMode === METAR_MODE.ALL ? (
              <p className="mt-2 text-xs text-amber-900">
                All mode may include high-frequency observations that Wunderground
                does not display.
              </p>
            ) : null}

            {metarComputedAt ? (
              <p className="mt-3 text-sm text-black/70">
                Last computed: <span className="font-medium text-black">{metarComputedAt}</span>
              </p>
            ) : null}

            {metarError ? (
              <p className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {metarError}
              </p>
            ) : null}

            {computeMessage ? (
              <p className="mt-3 rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-sm text-black/80">
                {computeMessage}
              </p>
            ) : null}
          </article>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">3. Paste Manual Daily Max</h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-black/70">Input unit:</span>
            {["C", "F"].map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => setManualUnit(unit)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  manualUnit === unit
                    ? "bg-accent text-white"
                    : "border border-black/20 bg-white/70 text-black/70 hover:border-black"
                }`}
              >
                {unit}
              </button>
            ))}
          </div>

          <textarea
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder="One value per line. Line 1 = day 1."
            className="mt-4 h-44 w-full rounded-2xl border border-black/20 bg-white/80 px-4 py-3 font-mono text-sm outline-none ring-accent focus:ring-2"
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveManual}
              disabled={isSaving}
              className="rounded-full border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Manual Max"}
            </button>
            <p className="text-sm text-black/70">
              Parsed:{" "}
              <span className="font-semibold text-black">{preview.values.length}</span>{" "}
              day(s), invalid:{" "}
              <span className="font-semibold text-black">{preview.invalidCount}</span>
            </p>
          </div>

          {saveMessage ? (
            <p className="mt-3 rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-sm text-black/80">
              {saveMessage}
            </p>
          ) : null}

          {preview.notes.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {preview.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}

          <div className="mt-5 overflow-hidden rounded-2xl border border-black/10 bg-white/70">
            <div className="max-h-64 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                  <tr>
                    <th className="px-3 py-2">Day</th>
                    <th className="px-3 py-2">Raw</th>
                    <th className="px-3 py-2">Parsed</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.map((row) => (
                    <tr key={row.day} className="border-t border-black/10">
                      <td className="px-3 py-2 font-semibold text-black/70">{row.day}</td>
                      <td className="px-3 py-2 font-mono text-xs text-black/80">
                        {row.raw || " "}
                      </td>
                      <td className="px-3 py-2 text-black/80">
                        {row.parsed === null ? "—" : `${row.parsed}`}
                      </td>
                      <td className="px-3 py-2">
                        {row.status === "ok" ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                            ok
                          </span>
                        ) : row.status === "error" ? (
                          <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
                            {row.message}
                          </span>
                        ) : (
                          <span className="rounded-full bg-black/5 px-2 py-1 text-xs font-semibold text-black/50">
                            blank
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">4. Comparison Table</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-black/70">Display:</span>
              {["C", "F"].map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setDisplayUnit(unit)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    displayUnit === unit
                      ? "bg-black text-white"
                      : "border border-black/20 bg-white/70 text-black/70 hover:border-black"
                  }`}
                >
                  {unit}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-black/60">
            Showing mode: {METAR_MODE_META[metarMode].label}
          </p>

          {monthData === undefined ? (
            <p className="mt-4 text-sm text-black/70">Loading month data...</p>
          ) : (
            <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
              <table className="min-w-full text-sm">
                <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Manual Max</th>
                    <th className="px-3 py-2">
                      METAR Max ({METAR_MODE_META[metarMode].shortLabel})
                    </th>
                    <th className="px-3 py-2">METAR Time (Local)</th>
                    <th className="px-3 py-2">Obs Count</th>
                    <th className="px-3 py-2">
                      METAR Raw ({METAR_MODE_META[metarMode].shortLabel})
                    </th>
                    <th className="px-3 py-2">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row) => {
                    const manualValue =
                      displayUnit === "C" ? row.manualMaxC : row.manualMaxF;
                    const modeFields = readMetarFieldsByMode(
                      row,
                      metarMode,
                      displayUnit,
                    );
                    const metarValue = modeFields.metarValue;
                    const deltaValue = modeFields.deltaValue;

                    return (
                      <tr key={row.date} className="border-t border-black/10">
                        <td className="px-3 py-2 font-semibold text-black/80">{row.date}</td>
                        <td className="px-3 py-2 text-black/80">
                          {formatTemp(manualValue, displayUnit)}
                        </td>
                        <td className="px-3 py-2 text-black/80">
                          {formatTemp(metarValue, displayUnit)}
                        </td>
                        <td className="px-3 py-2 text-black/70">
                          {modeFields.metarTime || "—"}
                        </td>
                        <td className="px-3 py-2 text-black/70">
                          {modeFields.metarObsCount ?? "—"}
                        </td>
                        <td
                          className="max-w-[460px] px-3 py-2 font-mono text-xs text-black/70"
                          title={modeFields.metarRaw || ""}
                        >
                          {modeFields.metarRaw || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getDeltaChipClass(deltaValue)}`}
                          >
                            {formatDelta(deltaValue, displayUnit)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function KordMonthPage() {
  if (!convexUrl) {
    return <MissingConvexSetup />;
  }

  return <KordMonthWorkspace />;
}
