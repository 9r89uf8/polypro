# Project Structure and Sitemap

This document reflects the current code in this repo as of the latest update.

## Current Stack

- Next.js App Router (`app/`)
- React 19
- Convex (queries, mutations, actions, internal actions/mutations, HTTP routes, cron)
- Tailwind CSS v4
- Chart.js + `react-chartjs-2` + `chartjs-plugin-annotation`

## Directory Structure

```text
polypro2/
├── AGENTS.md
├── README.md
├── plan.md
├── package.json
├── package-lock.json
├── jsconfig.json
├── next.config.mjs
├── postcss.config.mjs
├── app/
│   ├── layout.js
│   ├── page.js
│   ├── globals.css
│   ├── convex-provider.js
│   ├── favicon.ico
│   ├── notes/
│   │   └── page.js
│   └── kord/
│       ├── month/
│       │   └── page.js
│       ├── metar-today/
│       │   └── page.js
│       ├── forecast-snapshots/
│       │   └── page.js
│       ├── today/
│       │   └── page.js
│       └── day/
│           └── [date]/
│               └── page.js
├── convex/
│   ├── schema.js
│   ├── weather.js
│   ├── forecastCollector.js
│   ├── notes.js
│   ├── kordPhone.js
│   ├── kordPhoneNode.js
│   ├── http.js
│   ├── crons.js
│   └── _generated/
│       ├── api.js
│       ├── api.d.ts
│       ├── server.js
│       ├── server.d.ts
│       └── dataModel.d.ts
├── docs/
│   ├── project-structure.md
│   ├── kord-pages.md
│   ├── kord-live-today.md
│   ├── kord-phone-calls.md
│   └── kord-forecast-snapshots.md
└── public/
    ├── file.svg
    ├── globe.svg
    ├── next.svg
    ├── vercel.svg
    └── window.svg
```

## Route Map

- `/` -> `app/page.js`
  - Home landing page with navigation links.
- `/notes` -> `app/notes/page.js`
  - Notes + image uploads + date filtering.
- `/kord/month` -> `app/kord/month/page.js`
  - Monthly manual-vs-METAR comparison workflow.
- `/kord/day/[date]` -> `app/kord/day/[date]/page.js`
  - Day-level chart, raw observations, live mode when date is Chicago today.
- `/kord/metar-today` -> `app/kord/metar-today/page.js`
  - Server redirect to `/kord/day/{chicagoToday}`.
- `/kord/today` -> `app/kord/today/page.js`
  - Phone-call temperature workflow for Chicago today.
- `/kord/forecast-snapshots` -> `app/kord/forecast-snapshots/page.js`
  - Hourly KORD forecast snapshot dashboard (Microsoft 5-day + current sources + NOAA official max).

## Convex Backend Map

- `convex/weather.js`
  - METAR ingestion, month compute, day/month queries, manual value upsert.
- `convex/forecastCollector.js`
  - Hourly KORD snapshot collector for Microsoft forecast/current and supplemental current sources.
- `convex/notes.js`
  - Notes CRUD-style operations (create/list) + upload URL generation.
- `convex/kordPhone.js`
  - Phone-call enqueue/query/mutation lifecycle.
- `convex/kordPhoneNode.js`
  - Twilio call orchestration, recording download, Whisper transcription, temperature parsing.
- `convex/http.js`
  - `POST /twilio/recording` webhook receiver.
- `convex/crons.js`
  - Scheduled NOAA poll and scheduled phone-call enqueue jobs.

## Data Model Summary

- `notes`
  - Note text metadata + `imageIds` in Convex file storage.
- `monthRuns`
  - Per station/month compute status for official and all modes.
- `dailyComparisons`
  - Daily manual max + official max + all max + deltas.
- `metarObservations`
  - Per observation rows for chart/raw table (`official` and `all` modes).
- `kordPhoneCalls`
  - Call lifecycle, transcript, parsed temperature, and Twilio metadata.
- `kordForecastSnapshots`
  - Hourly snapshot rows for forecast/current source collection.

## User Flow (ASCII)

```text
[User]
  |
  v
[/] Home
  |--> [/kord/month]
  |      |--> save manual month/day max values
  |      |--> compute archived METAR daily max (official + all)
  |      |--> open [/kord/day/YYYY-MM-DD]
  |
  |--> [/kord/metar-today]
  |      |--> server redirect to [/kord/day/{ChicagoToday}]
  |
  |--> [/kord/day/YYYY-MM-DD]
  |      |--> if date == Chicago today:
  |      |      - backfill today official (IEM)
  |      |      - backfill today all (IEM)
  |      |      - poll NOAA latest once
  |      |      - allow manual refresh (all backfill + NOAA poll)
  |      |--> view official/all/phone chart + raw table
  |
  |--> [/kord/today]
  |      |--> queue manual outbound call now
  |      |--> view phone temperature chart + calls table
  |      |--> link to [/kord/day/{ChicagoToday}]
  |
  |--> [/notes]
         |--> create note with optional title/body/images
         |--> filter notes by date range
         |--> browse stored note images
```

## Feature Inventory (Current Website Capabilities)

1. Home page loads a central KORD Weather Toolkit landing card.
2. Home page links directly to the month comparison tool.
3. Home page links directly to the METAR live day route entrypoint.
4. Home page links directly to the phone-call workflow page.
5. Home page links directly to the notes workspace.
6. App-wide Convex provider auto-initializes when `NEXT_PUBLIC_CONVEX_URL` exists.
7. Notes page shows a missing-Convex setup fallback when env is missing.
8. Month page shows a missing-Convex setup fallback when env is missing.
9. Notes form supports an optional note title.
10. Notes form supports optional multiline note body text.
11. Notes form supports selecting multiple image files.
12. Notes form supports pasting images from clipboard.
13. Notes image intake ignores non-image files/items.
14. Pasted images get generated filenames when needed.
15. Selected images are deduped by file identity.
16. Selected images render local previews before upload.
17. Users can remove individual selected images before save.
18. Notes UI shows feedback when images are added.
19. Notes save flow requests a Convex storage upload URL per image.
20. Notes save flow uploads raw file bytes to generated upload URLs.
21. Notes save flow validates upload response for `storageId`.
22. Notes save flow writes title/body/imageIds to Convex.
23. Notes save is blocked when title/body/images are all empty.
24. Notes save button shows a saving state.
25. Notes save success message includes uploaded image count.
26. Notes save error messages surface thrown exception text.
27. Notes form clears title/body/images after successful save.
28. Notes page includes date filter `From` input.
29. Notes page includes date filter `To` input.
30. Date filtering converts local dates to epoch range boundaries.
31. Invalid note date ranges are detected client-side.
32. Notes query is skipped while date range is invalid.
33. Notes filter has a clear button to reset both dates.
34. Notes UI shows loading state while query resolves.
35. Notes UI shows total count of notes currently displayed.
36. Notes list renders newest-first ordering from backend query.
37. Notes cards show localized created timestamp.
38. Notes cards conditionally render title only when present.
39. Notes cards conditionally render body only when present.
40. Notes cards preserve line breaks in note text.
41. Note images are loaded via Convex storage URLs.
42. Note images open in a new tab when clicked.
43. Empty-notes state is shown when filter returns no rows.
44. Notes page has direct navigation back to home.
45. Month page defaults selected month/year to Chicago current month/year.
46. Month page allows selecting year from a bounded recent/future list.
47. Month page allows selecting month by month name.
48. Month page requires explicit Load action to switch active month context.
49. Month page shows active month label after load.
50. Manual month input supports C/F input unit toggle.
51. Manual parser maps line number to calendar day.
52. Manual parser marks blank lines as blank status.
53. Manual parser marks non-numeric lines as error status.
54. Manual parser produces parsed preview rows for every day.
55. Manual parser warns about non-empty extra lines past month length.
56. Manual parse summary shows parsed day count.
57. Manual parse summary shows invalid line count.
58. Save Manual Max is blocked if invalid lines exist.
59. Save Manual Max is blocked if no numeric entries were provided.
60. Save Manual Max persists month/day values through Convex mutation.
61. Save Manual Max response reports updated day count.
62. Compute button triggers archived METAR compute for both modes.
63. Force Recompute bypasses skip logic and recomputes both modes.
64. Compute operation disables compute controls while running.
65. Compute status message summarizes official mode result.
66. Compute status message summarizes all mode result.
67. Month page displays official mode status chip.
68. Month page displays all mode status chip.
69. Month page displays official last-computed timestamp.
70. Month page displays all last-computed timestamp.
71. Month page displays official compute error text when present.
72. Month page displays all compute error text when present.
73. Comparison table supports display unit toggle C/F.
74. Comparison table renders one row for each day in month.
75. Comparison row date links to day detail route.
76. Comparison table shows manual max value by selected unit.
77. Comparison table shows official max value/time/obs/raw/delta.
78. Comparison table shows all max value/time/obs/raw/delta.
79. Delta chips are color-coded by difference magnitude.
80. Missing comparison values render as em dash placeholders.
81. Day route validates strict `YYYY-MM-DD` URL segment format.
82. Invalid day route renders clear error state with navigation links.
83. Day page queries official observations for selected date.
84. Day page queries all-mode observations for selected date.
85. Day page queries phone-call readings for selected date.
86. Day page summary card shows Manual/WU max.
87. Day page summary card shows Official max and observation count.
88. Day page summary card shows All max and observation count.
89. Day page allows manual per-day max entry from the day screen.
90. Manual day entry supports C/F input unit toggle.
91. Manual day entry validates required numeric input.
92. Manual day save writes a single day value via month mutation API.
93. Day page supports display unit toggle C/F.
94. Day chart supports toggling official series visibility.
95. Day chart supports toggling unofficial(all) series visibility.
96. Day chart supports toggling phone-call series visibility.
97. Day chart overlays phone points from `tsLocal` or `slotLocal`.
98. Day chart draws manual max as red dashed annotation line.
99. Day chart uses minute-of-day x-axis in Chicago local time.
100. Day chart labels x-axis in 12-hour AM/PM format.
101. Day chart tooltips show local time and temperature values.
102. Day chart is horizontally scrollable for dense full-day plotting.
103. Day chart uses larger touch targets in mobile view.
104. Day chart adjusts interaction axis behavior for mobile precision.
105. Day page shows live badge when selected date equals Chicago today.
106. Live bootstrap runs official-today IEM backfill once per open date.
107. Live bootstrap runs all-mode-today IEM backfill once per open date.
108. Live bootstrap runs immediate NOAA latest poll for official ingest.
109. Day page avoids recurring client polling intervals.
110. Live message text summarizes backfill and poll outcomes.
111. Live mode offers manual Refresh now action.
112. Refresh now runs all-mode today backfill and NOAA latest poll.
113. Refresh button disables while refresh is in flight.
114. Raw observation table is collapsed by default.
115. Raw section can include or hide unofficial(all) rows.
116. Raw rows show mode badges for official vs all.
117. Raw rows show source tag for each observation.
118. Raw rows show raw METAR text payload.
119. Official raw rows show NOAA first-seen timestamp when available.
120. Official raw rows show lag minutes versus observation timestamp.
121. `/kord/metar-today` redirects server-side to Chicago today day route.
122. `/kord/today` resolves the date key in America/Chicago timezone.
123. `/kord/today` loads phone-call rows for current Chicago date.
124. `/kord/today` offers a manual `Call now` trigger.
125. Manual `Call now` invokes `kordPhone:enqueueManualCall`.
126. Manual trigger surfaces queued/already-enqueued/failure status messages.
127. `/kord/today` charts parsed phone temperatures over local time.
128. `/kord/today` supports C/F display unit toggles.
129. `/kord/today` chart supports horizontal swipe/scroll inspection.
130. `/kord/today` table shows slot, recorded time, status, temp, transcript.
131. `/kord/today` transcript cells are truncated for table readability.
132. `/kord/today` links directly to Home.
133. `/kord/today` links directly to the same-day METAR day chart.
134. Backend cron polls NOAA official latest METAR every 2 minutes.
135. NOAA poll upserts official rows with dedupe on station/mode/date/tsUtc.
136. Official upsert records `noaaFirstSeenAt` on first NOAA sighting.
137. Backend can backfill official today observations from IEM CSV.
138. Backend can backfill all-mode today observations from IEM CSV.
139. Month compute supports official mode execution path.
140. Month compute supports all-mode execution path.
141. Month compute skip logic avoids recomputing already-computed mode data.
142. Month compute force option bypasses skip logic.
143. Month compute clears old month observations before reinserting fresh rows.
144. Month compute inserts observation rows in chunks for large datasets.
145. Month compute updates per-day aggregate maxima in `dailyComparisons`.
146. Month compute stores per-mode status/last-run/error in `monthRuns`.
147. Manual max writes recompute delta fields for official and all maxima.
148. Temperature source ranking prefers `remark_T` over `metar_integer` over `tmpf`.
149. Twilio recording webhook endpoint accepts form payload and schedules processing.
150. Recording processor transcribes audio with Whisper and parses temperature from transcript.

## Local Environment Note

- In this environment, `next build` is expected to fail because the Linux SWC binary is missing (documented in `AGENTS.md`).
