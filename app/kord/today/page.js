"use client";

import Link from "next/link";
import {
    Chart as ChartJS,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    Title,
    Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Title);

const STATION_ICAO = "KORD";
const CHICAGO_TIMEZONE = "America/Chicago";

function getDateParts(formatter, date) {
    const parts = formatter.formatToParts(date);
    const values = {};
    for (const part of parts) {
        if (part.type !== "literal") values[part.type] = part.value;
    }
    return values;
}

function chicagoTodayKey() {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: CHICAGO_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = getDateParts(formatter, new Date());
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseMinute(tsLocal) {
    const match = /(\d{2}):(\d{2})$/.exec(tsLocal || "");
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
}

function minuteLabel(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) return "";
    const normalized = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function formatTemp(value, unit) {
    if (value === undefined || value === null) return "—";
    return `${value.toFixed(1)}°${unit}`;
}

export default function KordTodayPhoneTempsPage() {
    const [displayUnit, setDisplayUnit] = useState("F");
    const [isCallingNow, setIsCallingNow] = useState(false);
    const [callMessage, setCallMessage] = useState("");
    const date = chicagoTodayKey();
    const enqueueManualCall = useMutation("kordPhone:enqueueManualCall");

    const result = useQuery("kordPhone:getDayPhoneReadings", {
        stationIcao: STATION_ICAO,
        date,
    });

    const rows = result?.rows ?? [];

    const chartData = useMemo(() => {
        const points = rows
            .map((row) => {
                // Prefer tsLocal if available (recording start), else fall back to slotLocal
                const when = row.tsLocal ?? row.slotLocal;
                const x = parseMinute(when);
                if (x === null) return null;

                const y = displayUnit === "C" ? row.tempC : row.tempF;
                if (!Number.isFinite(y)) return null;

                return { x, y };
            })
            .filter(Boolean);

        return {
            datasets: [
                {
                    label: "KORD phone temperature",
                    data: points,
                    borderColor: "#0f766e",
                    backgroundColor: "#0f766e",
                    pointRadius: 4.5,
                    pointHoverRadius: 7,
                    pointHitRadius: 20,
                    pointBorderWidth: 1.75,
                    borderWidth: 2,
                    tension: 0.25,
                    showLine: true,
                },
            ],
        };
    }, [rows, displayUnit]);

    const chartOptions = useMemo(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            interaction: {
                mode: "nearest",
                axis: "x",
                intersect: false,
            },
            plugins: {
                legend: { position: "top" },
                tooltip: {
                    padding: 10,
                    titleFont: { size: 13 },
                    bodyFont: { size: 12 },
                    callbacks: {
                        title(items) {
                            if (!items.length) return "";
                            return `Local ${minuteLabel(items[0].parsed.x)}`;
                        },
                        label(item) {
                            return `${item.dataset.label}: ${item.parsed.y.toFixed(1)}°${displayUnit}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    type: "linear",
                    min: 0,
                    max: 1439,
                    title: { display: true, text: "Local Time (America/Chicago)" },
                    ticks: {
                        stepSize: 60,
                        callback(value) {
                            return minuteLabel(Number(value));
                        },
                    },
                },
                y: {
                    title: { display: true, text: `Temperature (°${displayUnit})` },
                },
            },
        }),
        [displayUnit],
    );

    async function handleCallNow() {
        if (isCallingNow) return;

        setIsCallingNow(true);
        try {
            const result = await enqueueManualCall({ stationIcao: STATION_ICAO });
            if (result?.ok) {
                setCallMessage(`Manual call queued for ${result.slotLocal} (Chicago).`);
            } else if (result?.reason === "already_enqueued") {
                setCallMessage(`Call already queued for ${result.slotLocal}.`);
            } else {
                setCallMessage(
                    `Manual call was not queued (${result?.reason ?? "unknown"}).`,
                );
            }
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : String(error);
            setCallMessage(`Manual call failed: ${message}`);
        } finally {
            setIsCallingNow(false);
        }
    }

    return (
        <main className="min-h-screen px-4 py-8 md:px-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <header className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
                    <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
                        STATION {STATION_ICAO}
                    </p>
                    <h1 className="mt-3 text-2xl font-semibold text-foreground">
                        KORD Phone Temperature (Today) — {date}
                    </h1>
                    <p className="mt-2 text-sm text-black/65">
                        Scheduled calls at 12:45, 1:45, 2:45, 3:45, 4:45 (America/Chicago). Each call records 45 seconds, then is transcribed via Whisper and parsed for temperature.
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Link
                            href="/"
                            className="inline-flex rounded-full border border-black/20 px-4 py-2 text-sm font-semibold text-black hover:border-black"
                        >
                            Home
                        </Link>
                        <Link
                            href={`/kord/day/${date}`}
                            className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:border-emerald-400"
                        >
                            Open METAR Live Day Chart
                        </Link>
                        <button
                            type="button"
                            onClick={handleCallNow}
                            disabled={isCallingNow}
                            className="rounded-full border border-black bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isCallingNow ? "Queuing call..." : "Call now"}
                        </button>

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
                    <p className="mt-3 text-xs text-black/65">
                        {callMessage || "Use “Call now” to trigger an immediate outbound call outside cron time windows."}
                    </p>
                </header>

                <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
                    <h2 className="text-lg font-semibold text-foreground">
                        Phone Temperature Plot
                    </h2>
                    <p className="mt-2 text-xs text-black/55 md:hidden">
                        Tip: swipe horizontally to inspect call points and times.
                    </p>
                    <div className="mt-4 overflow-x-auto pb-2">
                        <div className="h-[400px] min-w-[1200px] rounded-2xl border border-black/10 bg-white/75 p-2 sm:h-[360px] sm:p-3 md:min-w-0">
                            <Line data={chartData} options={chartOptions} />
                        </div>
                    </div>
                </section>

                <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
                    <h2 className="text-lg font-semibold text-foreground">Calls</h2>
                    <div className="mt-4 overflow-auto rounded-2xl border border-black/10 bg-white/75">
                        <table className="min-w-full text-sm">
                            <thead className="bg-black/5 text-left text-xs uppercase tracking-wide text-black/70">
                            <tr>
                                <th className="px-3 py-2">Slot (local)</th>
                                <th className="px-3 py-2">Recorded at</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Temp</th>
                                <th className="px-3 py-2">Transcript</th>
                            </tr>
                            </thead>
                            <tbody>
                            {rows.map((row) => (
                                <tr key={row._id} className="border-t border-black/10">
                                    <td className="px-3 py-2 text-black/80">{row.slotLocal}</td>
                                    <td className="px-3 py-2 text-black/65">{row.tsLocal ?? "—"}</td>
                                    <td className="px-3 py-2 text-black/80">{row.status}</td>
                                    <td className="px-3 py-2 text-black/80">
                                        {formatTemp(displayUnit === "C" ? row.tempC : row.tempF, displayUnit)}
                                    </td>
                                    <td
                                        className="max-w-[520px] px-3 py-2 text-xs text-black/70"
                                        title={row.transcript ?? ""}
                                    >
                                        {(row.transcript ?? "—").slice(0, 140)}
                                        {(row.transcript ?? "").length > 140 ? "…" : ""}
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 ? (
                                <tr>
                                    <td className="px-3 py-4 text-sm text-black/60" colSpan={5}>
                                        No calls recorded yet for today.
                                    </td>
                                </tr>
                            ) : null}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </main>
    );
}
