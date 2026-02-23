# KORD Pages

This document describes what the two KORD routes display and how they are intended to be used.

## `/kord/month`

Purpose: month-level workflow for manual-vs-METAR comparison.

What this page displays:

- Month selector (`year`, `month`) and `Load` button.
- Manual input area:
  - Unit toggle (`C` or `F`).
  - Textarea where each line maps to day 1..N for the selected month.
  - Parse preview table showing `day`, raw value, parsed value, and parse status.
  - `Save Manual Max` action.
- Compute area:
  - `Compute METAR Daily Max` button that computes **both** modes (`official` and `all`) in one run.
  - `Force Recompute` button that re-runs both modes even if already computed.
  - Per-mode status chips (`official`, `all`), per-mode last-computed timestamps, and per-mode errors.
- Comparison table (one row per day):
  - `Date` (clickable; opens day detail route).
  - `Manual Max`.
  - `Official Max`, `Official Time`, `Official Obs`, `Official Raw`, `Official Delta`.
  - `All Max`, `All Time`, `All Obs`, `All Raw`, `All Delta`.
  - Unit display toggle (`C` / `F`) for table temperatures and deltas.

Behavior details:

- Regular compute skips a mode if that month+mode is already fully computed.
- Force recompute refreshes existing records.
- Observation data is refreshed per month+mode (old rows cleared, then replaced), so duplicates are avoided.

## `/kord/day/[date]`

Example route: `/kord/day/2026-02-20`

Purpose: day-level diagnostics for observation-by-observation review.

What this page displays:

- Header with date and `Back to Month`.
- Unit toggle (`C` / `F`) for day-level display.
- Summary cards:
  - `Manual / WU Max`
  - `Official Max` (+ obs count)
  - `All Max` (+ obs count)
- Line chart:
  - Official observation temperature line.
  - All observation temperature line.
  - Horizontal annotation line for manual/WU max.
  - X-axis is local time (`America/Chicago`).
- Raw observations table:
  - `Local Time`, `Mode`, `Temp`, `Source`, `Raw METAR`.

Behavior details:

- If no observations are stored for that date, the table shows a no-data message.
- Day page expects a `YYYY-MM-DD` date segment.

## Data sources used by these pages

- `dailyComparisons` table for daily aggregates (manual, official, and all fields).
- `monthRuns` table for compute statuses and timestamps.
- `metarObservations` table for per-observation day charting and raw review.
