# Project Structure and Sitemap

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
│       ├── today/
│       │   └── page.js
│       └── day/
│           └── [date]/
│               └── page.js
├── convex/
│   ├── schema.js
│   ├── weather.js
│   ├── notes.js
│   └── _generated/
│       ├── api.js
│       ├── api.d.ts
│       ├── server.js
│       ├── server.d.ts
│       └── dataModel.d.ts
├── docs/
│   ├── kord-pages.md
│   └── kord-live-today.md
└── public/
    ├── file.svg
    ├── globe.svg
    ├── next.svg
    ├── vercel.svg
    └── window.svg
```

## Sitemap and User Flow (ASCII)

```text
[User]
  |
  v
[/] Home  (app/page.js)
  |-----------------------------> [/notes]
  |
  |-----------------------------> [/kord/month]
  |                                |
  |                                | Save Manual Max
  |                                v
  |                           [dailyComparisons]
  |                                ^
  |                                | Compute METAR (official + all)
  |                                |
  |                           [weather:computeMetarMonthBoth]
  |                                |
  |                                v
  |                        [metarObservations + dailyComparisons]
  |                                |
  |                                | Click date row
  |                                v
  |--------------------------> [/kord/day/YYYY-MM-DD]
  |
  |-----------------------------> [/kord/today]
                                   |
                                   | server redirect (Chicago date)
                                   v
                             [/kord/day/{today}]
                                   |
                                   | if date == Chicago today:
                                   |   1) backfill once
                                   |      weather:backfillTodayOfficialFromIem
                                   |   2) poll now + every 3 min
                                   |      weather:pollLatestNoaaMetar
                                   v
                             [weather:upsertOfficialObservation]
                                   |
                                   v
                        [metarObservations + dailyComparisons]
                                   |
                                   v
                        Day chart/table auto-update (Convex query subscription)
```
