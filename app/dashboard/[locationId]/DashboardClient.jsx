"use client";
//app/dashboard/[locationId]/DashboardClient.jsx
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

function fmtHours(hours) {
    if (hours === null || hours === undefined) return "—";
    return `${hours}h`;
}

function fmtDurationSummary(pred, timeZone) {
    if (!pred) return "—";

    const streak = pred.predictedHighStreakHours;
    const total = pred.predictedHighCountHours;
    const start = pred.predictedHighStreakStartEpochMs;
    const end = pred.predictedHighStreakEndEpochMs;

    if (
        typeof streak !== "number" &&
        typeof total !== "number" &&
        typeof start !== "number" &&
        typeof end !== "number"
    ) {
        return "—";
    }

    const parts = [];
    if (typeof streak === "number") parts.push(`streak ${streak}h`);
    if (typeof total === "number") parts.push(`total ${total}h`);
    if (typeof start === "number" && typeof end === "number") {
        parts.push(`${fmtTime(start, timeZone)} → ${fmtTime(end, timeZone)}`);
    } else if (typeof start === "number") {
        parts.push(fmtTime(start, timeZone));
    }
    return parts.join(" · ");
}

function ForecastEvolutionTable({ title, dateISO, timeZone, segments }) {
    return (
        <div className="mt-4">
            <div className="font-medium">
                {title} forecast evolution ({dateISO})
            </div>
            <div className="text-sm text-gray-600">
                Shows how predicted max temp and predicted max time change across today&apos;s snapshots.
            </div>

            <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm border">
                    <thead className="bg-gray-50">
                    <tr>
                        <th className="text-left p-2 border">Snapshot hour</th>
                        <th className="text-left p-2 border">Predicted high</th>
                        <th className="text-left p-2 border">Predicted high time</th>
                        <th className="text-left p-2 border">High streak</th>
                        <th className="text-left p-2 border">High count</th>
                        <th className="text-left p-2 border">Streak window</th>
                    </tr>
                    </thead>
                    <tbody>
                    {segments.length === 0 ? (
                        <tr>
                            <td className="p-2 border text-gray-500" colSpan={6}>
                                No snapshots yet.
                            </td>
                        </tr>
                    ) : (
                        segments.slice(-12).map((s, idx) => (
                            <tr key={idx} className="border-t">
                                <td className="p-2 border">
                                    {fmtTime(s.startAtMs, timeZone)} → {fmtTime(s.endAtMs, timeZone)}
                                </td>
                                <td className="p-2 border">{fmtTemp(s.predictedHighF)}</td>
                                <td className="p-2 border">{fmtTime(s.predictedHighTimeEpochMs, timeZone)}</td>
                                <td className="p-2 border">{fmtHours(s.predictedHighStreakHours)}</td>
                                <td className="p-2 border">{fmtHours(s.predictedHighCountHours)}</td>
                                <td className="p-2 border">
                                    {typeof s.predictedHighStreakStartEpochMs === "number" &&
                                    typeof s.predictedHighStreakEndEpochMs === "number"
                                        ? `${fmtTime(s.predictedHighStreakStartEpochMs, timeZone)} → ${fmtTime(
                                            s.predictedHighStreakEndEpochMs,
                                            timeZone
                                        )}`
                                        : "—"}
                                </td>
                            </tr>
                        ))
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
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
    const leadTable =
        useQuery(api.stats.leadHourAccuracyTable, {
            locationId,
            daysBack: 90,
            toleranceF,
            leadHours: [12, 16, 24, 32],
            minHoursCovered: 24,
        }) || [];
    const leadToActualHigh =
        useQuery(api.stats.accuracyByLeadHour, {
            locationId,
            daysBack: 90,
            toleranceF: 1,
            maxLeadHours: 36,
            leadDays: 0,
        }) || [];

    if (!overview || !daily) return <div className="p-6">Loading…</div>;

    const tz = overview.timeZone;
    const todayLatest = overview.todayForecast.latest;
    const observedHighSoFar = overview.observations.highSoFarF ?? null;
    const forecastRemainingMax = todayLatest?.predictedHighF ?? null;
    const estimatedDailyHigh =
        forecastRemainingMax == null && observedHighSoFar == null
            ? null
            : Math.max(forecastRemainingMax ?? -Infinity, observedHighSoFar ?? -Infinity);
    const highLikelyPassed =
        observedHighSoFar != null &&
        forecastRemainingMax != null &&
        observedHighSoFar > forecastRemainingMax + 0.5;
    const at12hSameDay = leadToActualHigh.find((r) => r.leadHour === 12) ?? null;


    function roundToHour(ms) {
        if (!ms) return null;
        return Math.floor(ms / 3600000) * 3600000;
    }

    function sameForecast(a, b, { includeTimeChange = true } = {}) {
        if (!a || !b) return false;
        const sameHigh = Math.round(a.predictedHighF) === Math.round(b.predictedHighF);
        const sameCount = (a.predictedHighCountHours ?? null) === (b.predictedHighCountHours ?? null);
        const sameStreak = (a.predictedHighStreakHours ?? null) === (b.predictedHighStreakHours ?? null);

        if (!includeTimeChange) return sameHigh && sameCount && sameStreak;

        // Round predicted-high-time to the hour to avoid minute jitter
        const ta = roundToHour(a.predictedHighTimeEpochMs);
        const tb = roundToHour(b.predictedHighTimeEpochMs);
        const sa = roundToHour(a.predictedHighStreakStartEpochMs);
        const sb = roundToHour(b.predictedHighStreakStartEpochMs);
        const ea = roundToHour(a.predictedHighStreakEndEpochMs);
        const eb = roundToHour(b.predictedHighStreakEndEpochMs);

        return sameHigh && sameCount && sameStreak && ta === tb && sa === sb && ea === eb;
    }

    function toForecastSegments(history, opts) {
        // history must be chronological ascending
        if (!history || history.length === 0) return [];

        const segments = [];
        let start = history[0];
        let prev = history[0];

        for (let i = 1; i < history.length; i++) {
            const cur = history[i];
            if (sameForecast(prev, cur, opts)) {
                prev = cur;
                continue;
            }

            // close segment [start..prev]
            segments.push({
                startAtMs: start.fetchedAtMs,
                endAtMs: prev.fetchedAtMs,
                predictedHighF: start.predictedHighF,
                predictedHighTimeEpochMs: start.predictedHighTimeEpochMs,
                predictedHighCountHours: start.predictedHighCountHours,
                predictedHighStreakHours: start.predictedHighStreakHours,
                predictedHighStreakStartEpochMs: start.predictedHighStreakStartEpochMs,
                predictedHighStreakEndEpochMs: start.predictedHighStreakEndEpochMs,
            });

            start = cur;
            prev = cur;
        }

        // close final segment
        segments.push({
            startAtMs: start.fetchedAtMs,
            endAtMs: prev.fetchedAtMs,
            predictedHighF: start.predictedHighF,
            predictedHighTimeEpochMs: start.predictedHighTimeEpochMs,
            predictedHighCountHours: start.predictedHighCountHours,
            predictedHighStreakHours: start.predictedHighStreakHours,
            predictedHighStreakStartEpochMs: start.predictedHighStreakStartEpochMs,
            predictedHighStreakEndEpochMs: start.predictedHighStreakEndEpochMs,
        });

        return segments;
    }
    const evolutionTables = [
        {
            key: "today",
            title: "Today",
            dateISO: overview.todayISO,
            segments: toForecastSegments(overview.todayForecast.historyTodayOnly, {
                includeTimeChange: true,
            }),
        },
        {
            key: "tomorrow",
            title: "Tomorrow",
            dateISO: overview.tomorrowISO,
            segments: toForecastSegments(overview.tomorrowForecast.historyTodayOnly, {
                includeTimeChange: true,
            }),
        },
        {
            key: "day2",
            title: "Day +2",
            dateISO: overview.day2ISO,
            segments: toForecastSegments(overview.day2Forecast?.historyTodayOnly ?? [], {
                includeTimeChange: true,
            }),
        },
    ];

    return (
        <main className="p-6 max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">Forecast Accuracy Dashboard</h1>
                <div className="text-sm text-gray-600">
                    Timezone: {tz} · Today: {overview.todayISO} · Tomorrow: {overview.tomorrowISO} · Day +2:{" "}
                    {overview.day2ISO}
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
                            Estimated daily high so far: <b>{fmtTemp(estimatedDailyHigh)}</b>
                            {highLikelyPassed ? (
                                <span className="text-gray-500"> (already reached)</span>
                            ) : null}
                        </div>
                        <div className="text-sm text-gray-600">
                            Forecast remaining max: <b>{fmtTemp(forecastRemainingMax)}</b>{" "}
                            {todayLatest ? (
                                <span className="text-gray-500">
                                    (snapshot {fmtHour(todayLatest.fetchedLocalHour)}
                                    {typeof todayLatest.hoursCoveredForTarget === "number"
                                        ? ` · covers ${todayLatest.hoursCoveredForTarget}h`
                                        : ""}
                                    )
                                </span>
                            ) : null}
                        </div>
                        <div className="text-sm text-gray-600">
                            Forecast max time: {fmtTime(todayLatest?.predictedHighTimeEpochMs, tz)}
                        </div>
                        <div className="text-sm text-gray-600">
                            Forecast high duration: {fmtDurationSummary(todayLatest, tz)}
                        </div>
                    </div>

                    <div className="border rounded p-3">
                        <div className="font-medium">Tomorrow ({overview.tomorrowISO})</div>

                        <div className="mt-2 text-sm">
                            Latest predicted high:{" "}
                            <b>{fmtTemp(overview.tomorrowForecast.latest?.predictedHighF)}</b>{" "}
                            {overview.tomorrowForecast.latest ? (
                                <span className="text-gray-500">
                                    (snapshot {fmtHour(overview.tomorrowForecast.latest.fetchedLocalHour)})
                                </span>
                            ) : null}
                        </div>
                        <div className="text-sm text-gray-600">
                            Predicted high time:{" "}
                            {fmtTime(overview.tomorrowForecast.latest?.predictedHighTimeEpochMs, tz)}
                        </div>
                        <div className="text-sm text-gray-600">
                            Predicted high duration: {fmtDurationSummary(overview.tomorrowForecast.latest, tz)}
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

                {evolutionTables.map((table) => (
                    <ForecastEvolutionTable
                        key={table.key}
                        title={table.title}
                        dateISO={table.dateISO}
                        timeZone={tz}
                        segments={table.segments}
                    />
                ))}
                <div className="mt-2 text-xs text-gray-500">
                    (Showing last 12 snapshots per target day; increase the slice if you want all 24.)
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
                            <th className="text-left p-2 border">High duration @ 10pm</th>
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
                                    {d.predictedHighStreakHoursAt10pm == null &&
                                    d.predictedHighCountHoursAt10pm == null ? (
                                        "—"
                                    ) : (
                                        <>
                                            {fmtHours(d.predictedHighStreakHoursAt10pm)} streak /{" "}
                                            {fmtHours(d.predictedHighCountHoursAt10pm)} total
                                            {typeof d.predictedHighStreakStartAt10pmEpochMs === "number" &&
                                            typeof d.predictedHighStreakEndAt10pmEpochMs === "number" ? (
                                                <span className="text-gray-500">
                                                    {" "}
                                                    (
                                                    {fmtTime(d.predictedHighStreakStartAt10pmEpochMs, tz)} →{" "}
                                                    {fmtTime(d.predictedHighStreakEndAt10pmEpochMs, tz)})
                                                </span>
                                            ) : null}
                                        </>
                                    )}
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

            <section className="border rounded p-4">
                <h2 className="text-lg font-medium">Accuracy vs Lead Time (before target day starts)</h2>
                <div className="text-sm text-gray-600">Tolerance ±{toleranceF}°F · Full-day coverage only</div>

                <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm border">
                        <thead className="bg-gray-50">
                        <tr>
                            <th className="text-left p-2 border">Lead</th>
                            <th className="text-left p-2 border">Accuracy</th>
                            <th className="text-left p-2 border">MAE</th>
                            <th className="text-left p-2 border">Bias</th>
                            <th className="text-left p-2 border">Samples</th>
                        </tr>
                        </thead>
                        <tbody>
                        {leadTable.map((r) => (
                            <tr key={r.leadHour} className="border-t">
                                <td className="p-2 border">{r.leadHour}h</td>
                                <td className="p-2 border">
                                    {r.accuracy == null ? "—" : `${Math.round(r.accuracy * 100)}%`}
                                </td>
                                <td className="p-2 border">{r.mae == null ? "—" : `${r.mae.toFixed(1)}°F`}</td>
                                <td className="p-2 border">{r.bias == null ? "—" : `${r.bias.toFixed(1)}°F`}</td>
                                <td className="p-2 border">{r.samples}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="border rounded p-4">
                <h2 className="text-lg font-medium">Same-Day Accuracy vs Lead to Actual High</h2>
                <div className="text-sm text-gray-600">
                    leadDays=0 · tolerance ±1°F · grouped by hours before actual high time
                </div>
                <div className="mt-1 text-sm">
                    12h lead within ±1°F:{" "}
                    <b>
                        {at12hSameDay
                            ? `${fmtPct(at12hSameDay.accuracy)} (${at12hSameDay.ok}/${at12hSameDay.total})`
                            : "—"}
                    </b>
                </div>

                <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-sm border">
                        <thead className="bg-gray-50">
                        <tr>
                            <th className="text-left p-2 border">Lead to high</th>
                            <th className="text-left p-2 border">Accuracy</th>
                            <th className="text-left p-2 border">OK</th>
                            <th className="text-left p-2 border">Total</th>
                        </tr>
                        </thead>
                        <tbody>
                        {leadToActualHigh.length === 0 ? (
                            <tr>
                                <td className="p-2 border text-gray-500" colSpan={4}>
                                    No finalized same-day samples yet.
                                </td>
                            </tr>
                        ) : (
                            leadToActualHigh.map((r) => (
                                <tr key={r.leadHour} className="border-t">
                                    <td className="p-2 border">{r.leadHour}h</td>
                                    <td className="p-2 border">{fmtPct(r.accuracy)}</td>
                                    <td className="p-2 border">{r.ok}</td>
                                    <td className="p-2 border">{r.total}</td>
                                </tr>
                            ))
                        )}
                        </tbody>
                    </table>
                </div>
            </section>
        </main>
    );
}
