"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

function hourLabel(h) {
    const ampm = h >= 12 ? "pm" : "am";
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}${ampm}`;
}

export default function DashboardClient({ locationId }) {
    const shouldSkip = !locationId;
    const location = useQuery(api.locations.get, shouldSkip ? "skip" : { id: locationId });

    const toleranceF = 2;
    const daysBack = 60;

    const byLeadHour =
        useQuery(
            api.stats.accuracyByLeadHour,
            shouldSkip
                ? "skip"
                : {
                    locationId,
                    daysBack,
                    toleranceF,
                    maxLeadHours: 36,
                    leadDays: 1, // tomorrow-high predictions
                },
        ) || [];

    const byFetchedHour =
        useQuery(
            api.stats.accuracyByFetchedHour,
            shouldSkip
                ? "skip"
                : {
                    locationId,
                    daysBack,
                    toleranceF,
                    leadDays: 1,
                    minSamples: 30,
                },
        ) || null;

    const tenPm = byFetchedHour?.cumulativeFromHour?.find((r) => r.hour === 22);

    return (
        <main className="p-6 max-w-3xl mx-auto">
            <h1 className="text-2xl font-semibold">Dashboard</h1>

            <div className="mt-2 text-sm text-gray-600">
                Location: {location?.name || "…"}
            </div>

            <div className="mt-6 p-4 border rounded">
                <div className="font-medium">Statement generator</div>
                <div className="text-sm text-gray-600">
                    Using ±{toleranceF}°F tolerance, last {daysBack} days, leadDays=1.
                </div>

                {tenPm ? (
                    <div className="mt-2">
                        <div className="text-lg">
                            Starting from <b>10pm</b>, accuracy is about{" "}
                            <b>{Math.round(tenPm.accuracy * 100)}%</b>
                            {" "}({tenPm.ok}/{tenPm.total} samples).
                        </div>
                    </div>
                ) : (
                    <div className="mt-2 text-gray-500">Not enough data yet.</div>
                )}

                {byFetchedHour?.suggestion ? (
                    <div className="mt-2 text-sm">
                        Earliest hour reaching ≥80% (min samples met):{" "}
                        <b>{hourLabel(byFetchedHour.suggestion.hour)}</b>{" "}
                        ({Math.round(byFetchedHour.suggestion.accuracy * 100)}%, n={byFetchedHour.suggestion.total})
                    </div>
                ) : null}
            </div>

            <div className="mt-6 p-4 border rounded">
                <div className="font-medium">Accuracy by lead-hours before the actual high</div>
                <div className="text-sm text-gray-600">
                    This answers: “12 hours prior or 7 hours prior…”
                </div>

                <div className="mt-3 space-y-1 text-sm">
                    {byLeadHour.map((r) => (
                        <div key={r.leadHour} className="flex justify-between">
                            <span>{r.leadHour}h before high</span>
                            <span>
                {Math.round(r.accuracy * 100)}% ({r.ok}/{r.total})
              </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="mt-6 p-4 border rounded">
                <div className="font-medium">Accuracy by “previous-day clock hour”</div>
                <div className="text-sm text-gray-600">
                    Exact hour snapshot accuracy.
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    {byFetchedHour?.exact?.map((r) => (
                        <div key={r.hour} className="flex justify-between border rounded p-2">
                            <span>{hourLabel(r.hour)}</span>
                            <span>
                {Math.round(r.accuracy * 100)}% (n={r.total})
              </span>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
