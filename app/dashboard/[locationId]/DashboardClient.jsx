"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

function fmtHour(h) {
    const ampm = h >= 12 ? "pm" : "am";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}${ampm}`;
}

function fmtTemp(x) {
    if (x === null || x === undefined) return "—";
    return `${Math.round(x)}°F`;
}

function fmtPct(x) {
    if (x === null || x === undefined) return "—";
    return `${Math.round(x * 100)}%`;
}

function fmtTime(ms, timeZone) {
    if (!ms) return "—";
    return new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(ms));
}

export default function DashboardClient({ locationId }) {
    const toleranceF = 2;
    const daysBack = 60;

    const overview = useQuery(api.stats.dayOverview, {
        locationId,
        historyLimit: 24,
    });

    const daily = useQuery(api.stats.dailySummaryTable, {
        locationId,
        daysBack,
        toleranceF,
        leadDays: 1,
        includeToday: false, // daily summary needs actual high; today usually not finalized
    });

    if (!overview || !daily) return <div className="p-6">Loading…</div>;

    const tz = overview.timeZone;

    return (
        <main className="p-6 max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Forecast Accuracy Dashboard</h1>
                <div className="text-sm text-gray-600">
                    Timezone: {tz} · Today: {overview.todayISO} · Tomorrow: {overview.tomorrowISO}
                </div>
            </div>

            {/* LIVE VIEW */}
            <section className="border rounded p-4">
                <h2 className="text-lg font-medium">Live: Today & Tomorrow</h2>

                <div className="mt-3 grid md:grid-cols-2 gap-4">
                    <div className="border rounded p-3">
                        <div className="font-medium">Today ({overview.todayISO})</div>
                        <div className="mt-1 text-sm">
                            Observed now: <b>{fmtTemp(overview.observations.lastTempF)}</b>{" "}
                            <span className="text-gray-500">
                ({fmtTime(overview.observations.lastEpochMs, tz)})
              </span>
                        </div>
                        <div className="text-sm">
                            Observed high so far: <b>{fmtTemp(overview.observations.highSoFarF)}</b>{" "}
                            <span className="text-gray-500">
                ({fmtTime(overview.observations.highSoFarTimeEpochMs, tz)})
              </span>
                        </div>

                        <div className="mt-2 text-sm">
                            Latest predicted high:{" "}
                            <b>{fmtTemp(overview.todayForecast.latest?.predictedHighF)}</b>{" "}
                            <span className="text-gray-500">
                (snapshot {fmtHour(overview.todayForecast.latest?.fetchedLocalHour ?? 0)})
              </span>
                        </div>
                        <div className="text-sm text-gray-600">
                            Predicted high time:{" "}
                            {fmtTime(overview.todayForecast.latest?.predictedHighTimeEpochMs, tz)}
                        </div>
                    </div>

                    <div className="border rounded p-3">
                        <div className="font-medium">Tomorrow ({overview.tomorrowISO})</div>

                        <div className="mt-2 text-sm">
                            Latest predicted high:{" "}
                            <b>{fmtTemp(overview.tomorrowForecast.latest?.predictedHighF)}</b>{" "}
                            <span className="text-gray-500">
                (snapshot {fmtHour(overview.tomorrowForecast.latest?.fetchedLocalHour ?? 0)})
              </span>
                        </div>
                        <div className="text-sm text-gray-600">
                            Predicted high time:{" "}
                            {fmtTime(overview.tomorrowForecast.latest?.predictedHighTimeEpochMs, tz)}
                        </div>

                        <div className="mt-2 text-sm">
                            Drift so far today (tomorrow-high):{" "}
                            <b>{fmtTemp(overview.tomorrowForecast.drift.rangeF)}</b>{" "}
                            <span className="text-gray-500">
                (min {fmtTemp(overview.tomorrowForecast.drift.minF)} / max{" "}
                                {fmtTemp(overview.tomorrowForecast.drift.maxF)})
              </span>
                        </div>

                        <div className="text-sm text-gray-600">
                            Change since first snapshot:{" "}
                            {overview.tomorrowForecast.drift.firstF != null &&
                            overview.tomorrowForecast.drift.latestF != null
                                ? `${Math.round(
                                    overview.tomorrowForecast.drift.latestF - overview.tomorrowForecast.drift.firstF
                                )}°F`
                                : "—"}
                        </div>
                    </div>
                </div>

                {/* Tomorrow evolution */}
                <div className="mt-4">
                    <div className="font-medium">Tomorrow forecast evolution (today’s hourly snapshots)</div>
                    <div className="text-sm text-gray-600">
                        Shows how predicted max temp and predicted max time change as we get closer.
                    </div>

                    <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-sm border">
                            <thead className="bg-gray-50">
                            <tr>
                                <th className="text-left p-2 border">Snapshot hour</th>
                                <th className="text-left p-2 border">Predicted high</th>
                                <th className="text-left p-2 border">Predicted high time</th>
                            </tr>
                            </thead>
                            <tbody>
                            {overview.tomorrowForecast.history.slice(-12).map((r, idx) => (
                                <tr key={idx} className="border-t">
                                    <td className="p-2 border">{fmtHour(r.fetchedLocalHour)}</td>
                                    <td className="p-2 border">{fmtTemp(r.predictedHighF)}</td>
                                    <td className="p-2 border">{fmtTime(r.predictedHighTimeEpochMs, tz)}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-2 text-xs text-gray-500">
                        (Showing last 12 snapshots; increase the slice if you want all 24.)
                    </div>
                </div>
            </section>

            {/* DAILY SUMMARY TABLE */}
            <section className="border rounded p-4">
                <h2 className="text-lg font-medium">Daily Summary (completed days)</h2>
                <div className="text-sm text-gray-600">
                    leadDays=1 (previous-day “tomorrow high” snapshots) · tolerance ±{toleranceF}°F · range{" "}
                    {daily.startISO} → {daily.endISO}
                </div>

                <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm border">
                        <thead className="bg-gray-50">
                        <tr>
                            <th className="text-left p-2 border">Date</th>
                            <th className="text-left p-2 border">Actual high</th>
                            <th className="text-left p-2 border">Pred @ 10pm</th>
                            <th className="text-left p-2 border">Err @ 10pm</th>
                            <th className="text-left p-2 border">First accurate</th>
                            <th className="text-left p-2 border">Lock-in (lenient)</th>
                            <th className="text-left p-2 border">Drift</th>
                            <th className="text-left p-2 border">Coverage</th>
                        </tr>
                        </thead>
                        <tbody>
                        {daily.days.map((d) => (
                            <tr key={d.dateISO} className="border-t">
                                <td className="p-2 border font-medium">{d.dateISO}</td>
                                <td className="p-2 border">{fmtTemp(d.actualHighF)}</td>
                                <td className="p-2 border">{fmtTemp(d.predAt10pmF)}</td>
                                <td className="p-2 border">
                                    {d.absErrorAt10pmF == null ? "—" : `${Math.round(d.absErrorAt10pmF)}°F`}
                                </td>
                                <td className="p-2 border">
                                    {d.firstAccurateHour == null ? "—" : fmtHour(d.firstAccurateHour)}
                                </td>
                                <td className="p-2 border">
                                    {d.lockInHourLenient == null ? "—" : fmtHour(d.lockInHourLenient)}
                                </td>
                                <td className="p-2 border">
                                    {d.predRangeF == null ? "—" : `${Math.round(d.predRangeF)}°F`}
                                </td>
                                <td className="p-2 border">
                                    {d.coverage}/24
                                    {d.missing > 0 ? <span className="text-gray-500"> (missing {d.missing})</span> : null}
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>

                <div className="mt-2 text-xs text-gray-500">
                    Lock-in (lenient) ignores missing snapshots; strict lock-in is available in the query if you
                    want it in the table.
                </div>
            </section>
        </main>
    );
}