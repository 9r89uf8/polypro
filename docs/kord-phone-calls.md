# KORD Phone Calls

This document covers the KORD phone-call temperature workflow shown on `/kord/today`.

## Purpose

- Place automated outbound calls to KORD ATIS, record audio, transcribe it, and extract temperature.
- Store each call lifecycle and parsed temperature in Convex.
- Show today's call timeline and temperature chart on `/kord/today`.

## Route and UI

- `/kord/today` (`app/kord/today/page.js`)
  - Resolves current Chicago date (`America/Chicago`) client-side.
  - Queries `kordPhone:getDayPhoneReadings` for today's rows.
  - Renders:
    - line chart (x: local time in 12-hour format `h:mm AM/PM`, y: temperature)
    - calls table with slot, recorded time, status, temp, transcript excerpt
  - Supports:
    - `Home` button back to `/`
    - `Open METAR Live Day Chart` link to `/kord/day/YYYY-MM-DD`
    - `Call now` button -> `kordPhone:enqueueManualCall`
    - unit toggle (`C` / `F`)
    - status message for manual trigger result

## Scheduling and Enqueue

Defined in `convex/crons.js` and `convex/kordPhone.js`.

- Cron trigger:
  - Cron expression: `45 * * * *` (UTC)
  - Calls `internal.kordPhone.enqueueScheduledCall` with `stationIcao: "KORD"`
  - Internal mutation checks Chicago local time and only enqueues 12:45-16:45 local.
- Manual trigger:
  - Public mutation `kordPhone:enqueueManualCall`
  - Uses current Chicago local timestamp as `slotLocal`.
- Shared enqueue path:
  - `enqueueCallForSlot` inserts a `queued` row in `kordPhoneCalls`
  - Schedules `internal.kordPhoneNode.startCall`
  - Dedupe key is `(stationIcao, slotLocal)` using index `by_station_slot`

## Call Processing Pipeline

1. `internal.kordPhoneNode.startCall`
   - Validates Twilio env vars.
   - Creates outbound Twilio call.
   - Uses TwiML pause + hangup (45 seconds total call duration target).
   - Enables recording and configures `RecordingStatusCallback` to Convex HTTP route.
   - On success: `markCallStarted` (`status: "calling"` with `callSid`).
   - On failure: `markCallError` (`status: "error"`).
2. `/twilio/recording` webhook (`convex/http.js`)
   - Optional shared-secret check via `TWILIO_WEBHOOK_TOKEN`.
   - Accepts Twilio form payload.
   - Schedules `internal.kordPhoneNode.processRecording` and returns quickly.
3. `internal.kordPhoneNode.processRecording`
   - Validates Twilio + OpenAI env vars.
   - Saves recording metadata via `upsertRecordingFromWebhook` (`status: "recorded"`).
   - Downloads recording MP3 from Twilio (`RecordingUrl + ".mp3"`).
   - Transcribes audio via Whisper (`whisper-1`).
   - Extracts Celsius temperature from transcript.
   - Saves transcript and parsed temp via `upsertTranscriptAndTemperature`.

## Temperature Parsing Rules

Defined in `convex/kordPhoneNode.js` (`extractTemperatureC`).

- Parses only text tied to `temperature ...` phrases.
- Stops parsing segment at dew point markers (`dewpoint` / `dew point`) or punctuation.
- Handles:
  - signed numeric forms (`-7`, `minus 07`, `negative 7`, `plus 3`)
  - spoken forms (`one five`, `twenty one`)
  - Whisper separator artifacts (`0-7`, split digits, dash variants, digit commas)
- Uses plausible Celsius range guard (`-80` to `60`) to reject bad captures.
- Prefers the last valid temperature mention in the transcript to reduce clipped-audio bias.
- If no valid parse is found:
  - stores transcript
  - sets status `transcribed`
  - sets error `temp_parse_failed`

## Stored Data

- Table: `kordPhoneCalls` (`convex/schema.js`)
  - Key fields: `stationIcao`, `date`, `slotLocal`, `tsUtc`, `tsLocal`
  - Twilio fields: `callSid`, `recordingSid`, `recordingUrl`, `recordingDuration`
  - Parsing fields: `transcript`, `tempC`, `tempF`
  - Lifecycle fields: `status`, `error`, `createdAt`, `updatedAt`
  - Indexes:
    - `by_station_date` (`stationIcao`, `date`)
    - `by_station_slot` (`stationIcao`, `slotLocal`)
    - `by_callSid` (`callSid`)

## Required Environment Variables

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `CONVEX_SITE_URL`
- `OPENAI_API_KEY`

Optional:

- `TWILIO_WEBHOOK_TOKEN` (recommended shared secret for webhook)
- `KORD_ATIS_NUMBER` (defaults to `+17738000035` if unset)

## Known Limitations

- Dedupe is keyed to exact `slotLocal`; manual calls in different minutes are separate rows.
- Whisper transcripts can still be noisy; parser is resilient but not perfect.
- On external API/provider failures (Twilio/OpenAI), calls land in `error` status.

## Change Guidance

Update this document when changing any of:

- `/kord/today` phone-call UI/behavior.
- `convex/kordPhone.js` enqueue/query/mutation flow.
- `convex/kordPhoneNode.js` call orchestration, transcription, or parsing.
- `convex/http.js` Twilio recording webhook behavior.
- `convex/crons.js` phone-call scheduling behavior.
- `kordPhoneCalls` schema fields or indexes.
