For **LEMD / Adolfo Suárez Madrid-Barajas**, the official METAR publisher in Spain is **AEMET (Agencia Estatal de Meteorología)**, Spain’s **aeronautical meteorological authority**. AEMET’s AMA service is the official aeronautical weather portal, and it explicitly says it provides METAR/SPECI/TAF data in AEMET’s database for aerodromes, including Spanish aerodromes. ([ama.aemet.es][1])

For the **fastest source other than NOAA tgftp**, the best public choice is usually the **AviationWeather Data API** rather than the old tgftp file tree. Their current API is the supported machine-to-machine interface, and their current-METAR cache updates **once a minute**. Example station query pattern: `https://aviationweather.gov/api/data/metar?ids=LEMD&format=json`. They also publish full current-METAR cache files updated once a minute. ([Aviation Weather Center][2])

A few practical options, fastest to most “official operational”:

1. **AEMET / AMA** — most authoritative for Spain, but access is oriented to registered aeronautical users rather than a simple open public JSON endpoint. ([ama.aemet.es][1])
2. **AviationWeather API** — easiest modern HTTPS endpoint for programmatic pulls; better choice than tgftp for freshness and supportability. ([Aviation Weather Center][2])
3. **WIFS / OPMET feeds** — good for operational bulk distribution, but it requires an account and is organized as 5-minute windows/collections, so it is usually not the simplest “latest single-station METAR” endpoint. ([Aviation Weather Center][3])

So, in one line:

* **Official publisher for Madrid-Barajas METAR:** **AEMET**
* **Faster public endpoint than NOAA tgftp:** **AviationWeather Data API** (`/api/data/metar?...`)
* **If you need earliest operational distribution rather than easiest HTTP API:** **WIFS/OPMET or AEMET operational channels**, not tgftp. ([ama.aemet.es][1])

A good default for polling LEMD is:

```text
https://aviationweather.gov/api/data/metar?ids=LEMD&format=json
```

And if you want bulk current METARs:

```text
https://aviationweather.gov/data/cache/metars.cache.xml.gz
https://aviationweather.gov/data/cache/metars.cache.csv.gz
```

Both are documented as updating once a minute. ([Aviation Weather Center][2])

## Verified AMA Findings

On **March 18, 2026**, the AMA side was verified beyond the public brochure
pages:

- AMA has a working account flow:
  - home: `https://ama.aemet.es/`
  - login: `https://ama.aemet.es/acceso`
  - create account: `https://ama.aemet.es/acceso?_com_liferay_login_web_portlet_LoginPortlet_mvcRenderCommandName=%2Flogin%2Fcreate_account&p_p_id=com_liferay_login_web_portlet_LoginPortlet&p_p_lifecycle=0&p_p_mode=view&p_p_state=maximized&saveLastPath=false`
- After login, the official Madrid-side page is:
  - `https://ama.aemet.es/metar-taf`
- That page is not just a static map. It is an authenticated `busquedasbasicas`
  search app with:
  - an autocomplete JSON lookup:
    - `POST /metar-taf?p_p_id=busquedasbasicas&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_cacheability=cacheLevelPage`
    - payload example: `_busquedasbasicas_q=LEM`
  - a search-submit action:
    - `..._busquedasbasicas_javax.portlet.action=realizarBusqueda...`
    - returns the lower result panel with raw `METAR`, `TAF`, and aerodrome
      warning content

Verified `LEMD` behavior:

- The autocomplete returned:
  - `LEMD, Aeropuerto Adolfo Suárez Madrid-Barajas`
- The authenticated result page rendered:
  - latest `METAR`
  - latest active `TAF`
  - aerodrome-warning section when present
- Example `LEMD` result captured during the check:
  - `LEMD 182130Z VRB02KT CAVOK 09/02 Q1009 NOSIG`

## Practical Conclusion

**Spain is better than Japan or China for an official-source race.**

- AMA is not an open public JSON API.
- But it is an authenticated, working, web-facing source for `LEMD` latest
  `METAR/TAF`.
- That makes **AEMET AMA vs NOAA** a realistic publish-race setup for Madrid,
  using an authenticated session on the AMA side.

## Notes

- AMA access is intended for registered **aeronautical users**. The public FAQ
  and account flow indicate that registration is controlled rather than fully
  open anonymous access. ([ama.aemet.es][4])
- For a simple unauthenticated fallback, the **AviationWeather Data API**
  remains the easiest public endpoint.

---

## Automated AMA Scraping — Verified Working (2026-03-18)

An authenticated curl session successfully logged in and fetched the latest
`LEMD` `METAR` and active `TAF` from AMA.

### Login flow (curl)

```bash
LOGIN_PAGE='https://ama.aemet.es/acceso?p_p_id=com_liferay_login_web_portlet_LoginPortlet&p_p_lifecycle=0&p_p_state=maximized&p_p_mode=view&saveLastPath=false&_com_liferay_login_web_portlet_LoginPortlet_mvcRenderCommandName=%2Flogin%2Flogin'

# 1. Get the actual AMA login form
curl -s -c cookies.txt "$LOGIN_PAGE" > login_page.html

# 2. Extract the real form action and hidden formDate
ACTION_URL=$(sed -n 's#.*<form action="\([^"]*\)".*id="_com_liferay_login_web_portlet_LoginPortlet_loginForm".*#\1#p' login_page.html | sed 's/&amp;/\&/g')
FORM_DATE=$(sed -n 's#.*id="_com_liferay_login_web_portlet_LoginPortlet_formDate"[^>]*value="\([^"]*\)".*#\1#p' login_page.html)

# 3. POST credentials to the extracted action URL
curl -s -L -b cookies.txt -c cookies.txt \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_login=$AEMET_USERNAME" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_password=$AEMET_PASSWORD" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_formDate=$FORM_DATE" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_saveLastPath=false" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_redirect=" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_doActionAfterLogin=false" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_checkboxNames=rememberMe" \
  "$ACTION_URL" > after_login.html
```

### `LEMD` METAR fetch (authenticated)

```bash
# 4. Load the authenticated METAR/TAF page
curl -s -b cookies.txt "https://ama.aemet.es/metar-taf" > metar_page.html

# 5. Extract the search action and page-specific formDate
SEARCH_URL=$(sed -n 's#.*<form action="\([^"]*\)".*id="_busquedasbasicas_fm".*#\1#p' metar_page.html | sed 's/&amp;/\&/g')
FORM_DATE=$(sed -n 's#.*id="_busquedasbasicas_formDate"[^>]*value="\([^"]*\)".*#\1#p' metar_page.html)

# 6. Submit an authenticated search for LEMD
curl -s -L -b cookies.txt -c cookies.txt \
  --data-urlencode "_busquedasbasicas_formDate=$FORM_DATE" \
  --data-urlencode "_busquedasbasicas_coaci_aeropuertos=LEMD" \
  --data-urlencode "_busquedasbasicas_nombre_consulta=Metar / Speci" \
  --data-urlencode "_busquedasbasicas_desc_consulta=Busqueda Metar / Speci" \
  --data-urlencode "_busquedasbasicas_checkboxNames=check-peninsula,check-canarias" \
  "$SEARCH_URL" > metar_result.html

# 7. Parse the raw METAR from the result block
grep -oE 'data-report="LEMD [^"]*"' metar_result.html | sed 's/data-report="//;s/"$//'
```

### Verified `LEMD` result

The authenticated result block rendered:

- `METAR`: `LEMD 182130Z VRB02KT CAVOK 09/02 Q1009 NOSIG`
- `TAF`: the latest active `LEMD` TAF in the same lower panel

### Autocomplete endpoint (verified)

```bash
curl -s -b cookies.txt \
  "https://ama.aemet.es/metar-taf?p_p_id=busquedasbasicas&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_cacheability=cacheLevelPage" \
  -d "_busquedasbasicas_q=LEM"
```

This returned JSON suggestions including:

- `LEMD, Aeropuerto Adolfo Suárez Madrid-Barajas`

### Key technical details

- **Platform:** AMA uses a Liferay-based authenticated web app.
- **Main page:** `https://ama.aemet.es/metar-taf`
- **Search app:** authenticated `busquedasbasicas` form flow
- **Autocomplete:** JSON over `p_p_lifecycle=2`
- **Result rendering:** the `realizarBusqueda` submit returns HTML containing
  the lower result panel, including raw `METAR` and `TAF`
- **METAR location in HTML:** `data-report="LEMD ..."` on the result block
- **Token handling:** the `p_auth` token differed between the login page and
  the authenticated `metar-taf` page, so the safest approach is to extract the
  current form action from the page you are about to submit
- **Session nuance:** AMA sets important auth cookies on the redirect chain
  after the login POST, so non-browser clients need to capture `Set-Cookie`
  headers on intermediate `302` responses, not just the final followed page
- **Client-side behavior:** the page also embeds an AJAX refresh URL for the
  current `LEMD` search, so there is both a form-submit path and a client-side
  re-query path inside the rendered page

### Conclusion

Spain/AMA is a **realistic publish-race candidate** because:

1. AMA is accessible with an authenticated account
2. the `LEMD` METAR/TAF page is fetchable with a deterministic session flow
3. the latest `METAR` is present in a parseable HTML attribute on the results
   page

## Repo Note

The repo now has a Madrid implementation built around this flow:

- `/madrid/today`
- `/madrid/day/[date]`
- `convex/madrid.js`

What was **not** verified here:

- that AMA consistently beats AWC/NOAA in live publication time
- any separate AMA JSON API beyond the authenticated autocomplete lookup
- the AEMET OpenData station-observation API as part of this AMA session

## LEMD D-ATIS via Airframes (approval-gated)

The Madrid day page has a separate path for the whole-degree operational
temperature embedded in LEMD arrival and departure D-ATIS messages. ENAIRE
describes D-ATIS as carrying the same operational content and timing as voice
ATIS, normally refreshed every ten minutes and whenever a significant change
requires a new designator.

The configured source is Airframes' community ACARS relay. It is **not** a
direct ENAIRE sensor/feed, a guaranteed ten-minute feed, or a replacement for
controller/voice information. A usable relay message depends on an aircraft
requesting and a community receiver capturing it, so receipt can be delayed or
missing. The chart therefore labels the series **D-ATIS operational temp**,
plots the embedded `HHMMZ` report time, and keeps it separate from official
METAR/SPECI actuals. Its countdown is the next nominal ten-minute report
boundary, not a promise that Airframes will capture the message.

When data is enabled and displayed, the required attribution is:

> Data provided by [Airframes.io](https://airframes.io) and its community of
> feeders.

### Approval authority and scope

The server-side Convex approval flag is:

```text
AIRFRAMES_LEMD_DATIS_ACCESS_APPROVED
```

Only the exact string `true` approves the integration. The flag may be enabled
only after written authorization covers both:

1. the appropriate Airframes production API tier and the intended maximum
   one-request-per-minute cadence, automated retrieval, Convex caching and
   retention, and public display/redistribution of derived LEMD D-ATIS
   temperature data; and
2. ENAIRE/D-ATIS content-owner permission for that use, or an authoritative
   written determination that no separate content permission is required.

Contacts and current source terms:

- Airframes API access/licensing: `api@airframes.io`
  ([authentication](https://docs.airframes.io/api/authentication/),
  [contact](https://docs.airframes.io/api/contact/),
  [licensing and attribution](https://docs.airframes.io/api/licensing/))
- ENAIRE D-ATIS/D-VOLMET:
  `solicitudes_datis_dvolmet@enaire.es`
  ([AIC INT 09/25](https://aip.enaire.es/aip/contenido_AIC/I/LE_Circ_2025_I_09_en.html))

Airframes says the API and licensing terms are still under development.
Endpoint reachability, anonymous responses, an account, or a working key is
not proof of production authorization.

`AIRFRAMES_API_KEY` is an optional, separate Convex secret. Its presence never
grants approval. When present, the collector sends it as a bearer credential;
when absent, an approved collector uses the provider's anonymous public
endpoint behavior. The fail-closed state order is:

- approval flag missing, empty, `false`, `TRUE`, `1`, or any value other than
  exact `true`: `approval_required`
- approval exact `true`: collector can run anonymously or with the optional
  key

Neither the flag nor an optional key belongs in `NEXT_PUBLIC_*` or in a
Vercel-only environment variable; Convex is the security boundary.

### Protected implementation paths

Every production entry point enforces the same approval:

- public/manual action `madridDatis:pollAirframesDatis`
- scheduled action `internal.madridDatis.pollScheduledAirframesDatis`, invoked
  by `madrid_airframes_datis_every_minute`
- shared poll reservation/cooldown mutation before work starts
- immediately before every Airframes HTTP attempt
- after the response and again immediately before the storage call
- `madridDatis:storeAirframesDatisBatch` inside the storage transaction
- `madridDatis:getDatisObservations` before any stored protected row leaves
  Convex

If approval is absent or revoked, manual and scheduled actions return
`approval_required` before making an Airframes request, protected rows are not
written, and the public query returns `rows: []` and `latest: null` even if
older rows remain physically stored. Existing AEMET forecast/station data and
official METAR continue normally, but no fallback is called or relabelled as
D-ATIS. A 60-second rolling backend cooldown prevents the cron and page refresh
from exceeding one provider attempt per minute. The collector does not perform
an immediate provider retry. If scheduler jitter reaches the rolling cooldown
a few seconds early, the scheduled action waits only for the remaining
cooldown, rechecks approval, reevaluates optional authentication, and reserves
again instead of dropping that cycle. A `429 Retry-After` value is persisted
and blocks both manual and scheduled attempts until the provider's requested
time.

The collector uses a fixed server-built `LEMD ATIS` query for the latest 100
messages. It accepts ARR and DEP designators,
handles UTC-day rollover, rejects implausible future reports and relay copies
delivered more than one hour after their embedded report time, and deduplicates
repeated captures. Storage is deliberately minimized to the derived report
type/designator, report and relay timestamps, temperature/dew point, delivery
lag, and provenance. It does not retain raw ACARS text, aircraft/tail/flight
identity, or feeder metadata.

Before approval, development and verification use only synthetic parser
fixtures, mocked handlers, and the disabled Convex path. They must not call the
live Airframes endpoint. The committed gate test covers unset, empty,
non-exact, approved-anonymous, and approved-bearer states.

### Deployment, activation, and revocation

Deploy code, schema, and the disabled cron with the approval flag absent, then
verify production reports `approval_required` and makes no Airframes request.
Only after the written scope above is confirmed should production approval be
configured. A provider key may be added separately when one is issued, but is
not required by this integration:

```text
npx convex env set AIRFRAMES_LEMD_DATIS_ACCESS_APPROVED true --prod
# Optional:
npx convex env set AIRFRAMES_API_KEY <issued-key> --prod
```

Production approval was user-confirmed and the exact Convex flag was active on
July 29, 2026. Removing it remains the immediate kill switch regardless of
whether an optional key exists.

Revoking the flag immediately disables new protected work and hides stored
D-ATIS rows:

```text
npx convex env remove AIRFRAMES_LEMD_DATIS_ACCESS_APPROVED --prod
```

Do not commit the API key or approval evidence.

## Airframes WebSocket D-ATIS stream (separately approval-gated)

The built-but-operationally-paused Airframes WebSocket stream is a separate
production integration from the one-minute REST collector documented above. A
persistent stream may reduce relay-discovery latency compared with REST
polling, but it does not turn Airframes into a direct airport sensor or a
complete D-ATIS feed. It only exposes the ACARS messages sampled by Airframes'
community receivers and delivered by the provider's stream.

LEMD messages remain aircraft-demand driven. Receiver coverage, aircraft
routing, provider sampling or filtering, disconnects, and reconnect gaps can
all delay or omit a report. The stream therefore must not be described as
guaranteed, exhaustive, or a guaranteed ten-minute service. Any derived chart
point must use the D-ATIS message's embedded report time; stream receipt time
is provenance and latency information, not the airport observation time.

### Separate approval authority and scope

The dedicated server-side Convex permission flag is:

```text
AIRFRAMES_LEMD_STREAM_APPROVED
```

Only the exact string `true` approves WebSocket use. Missing, empty, `false`,
`TRUE`, `1`, and every other value fail closed. Written authorization must
specifically cover:

1. Airframes production WebSocket access, including the provider-approved
   endpoint and tier, authentication and subscription method, continuous
   automated consumption, filtering, connection count, reconnect behavior,
   and expected message volume; and
2. parsing, Convex persistence and retention, and public
   display/redistribution of derived LEMD D-ATIS temperature data, together
   with ENAIRE/D-ATIS content-owner permission for that streaming use or an
   authoritative written determination that no separate content permission is
   required.

Connection attempts have a second, independent server-side Convex operational
kill switch:

```text
AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED
```

Only the exact string `true` enables the supervisor and listener to open or
replace a Socket.IO connection. Missing, empty, `false`, `TRUE`, `1`, and every
other value keep the provider connection paused. This switch is not approval:
both flags must be exact `true` before any handshake, subscription, automatic
rotation, or recovery attempt. Setting
`AIRFRAMES_LEMD_STREAM_APPROVED=true` alone permits the already-approved
storage/read scope but does not contact Airframes. Conversely, enabling the
connection switch cannot bypass missing approval.

The existing REST flag,
`AIRFRAMES_LEMD_DATIS_ACCESS_APPROVED`, is independent. It cannot authorize
the WebSocket connection, and the WebSocket flag cannot authorize REST
polling. Existing REST or ENAIRE approval counts toward the streaming scope
only if its written terms expressly cover that scope; technical access,
credentials, a reachable socket, or approval for a different transport is not
approval.

The selected global listener is deliberately anonymous. It does not read or
transmit the existing REST `AIRFRAMES_API_KEY`, because WebSocket API-key
authentication would also deliver the account's own-station feed outside this
integration's minimized scope. If Airframes later requires authenticated
global access, that is a code and approval-scope change with a separate
stream-specific credential. Neither approval flag nor any credential belongs
in `NEXT_PUBLIC_*` or Vercel-only configuration.

### Protected endpoints and entry points

The built integration uses Airframes' documented Socket.IO service at
`wss://ws.airframes.io` with WebSocket transport only. It sends the
`messages:sniff` subscription and accepts only the resulting sampled global
`message` events. It does not use a raw WebSocket, the per-station monitor, or
the account's unsampled `feed:message` stream. No credential is attached to
the Socket.IO handshake.

Protected entry points are:

- cron watchdog:
  `madrid_airframes_datis_stream_supervisor_every_minute` in
  `convex/crons.js`
- fail-closed supervisor and generation lease:
  `internal.madridDatisStream.superviseScheduledStream`
- bounded Node listener:
  `internal.madridDatisStreamNode.listenAirframesDatisStream`
- approval heartbeat and listener-state mutations:
  `getStreamApprovalState`, `beginStreamListener`,
  `recordStreamConnected`, `recordStreamListening`, and
  `recordStreamHeartbeat` in `convex/madridDatisStream.js`
- parser and minimized storage handoff:
  `convex/madridDatisStreamParser.js` and
  `internal.madridDatisStream.storeStreamDatisRows`
- protected public read:
  `madridDatisStream:getStreamObservations`
- failure retry and normal rotation:
  `internal.madridDatisStream.finishStreamListener`, with the minute cron as
  crash recovery
- revocation/early-stop fence cleanup:
  `internal.madridDatisStream.clearStoppedStreamListener`

There is no public/manual stream-start action, HTTP route, or browser socket.
The page cannot start or reconnect the upstream connection. The backend uses
an 8.5-minute bounded listener under a 9.5-minute generation lease, disables
Socket.IO automatic reconnection, and queues each rotated generation through
the same gated lease path before Convex's ten-minute Node-action limit. A fresh
Convex approval and operational-switch read is made before connection and
subscription and is repeated by the five-second heartbeat. Turning either
gate off closes and fences an active connection; it cannot be rotated or
recovered while the operational switch is off. Approval is also checked before
each candidate LEMD derivation, persistence, and public read. The operational
switch does not hide previously stored, still-approved rows; the page labels
the stream as paused and does not imply that a new capture is pending.

Unrelated global ACARS envelopes are discarded in memory. Only allowlisted
LEMD D-ATIS temperature, report-time, designator, report-kind, receipt-time,
and delivery-lag fields may enter `madridDatisStreamObservations`; raw message
text, aircraft/tail, flight, feeder, and station metadata are not stored or
logged. Stream state is isolated in `madridDatisStreamStatus`. When approval
is revoked, the public query returns no stream rows, while independently
approved REST rows remain available.

The streaming path must not fall back through the approved REST collector to
bypass its own disabled state, nor may the REST collector use the stream flag
as a fallback authorization.

The global stream is sampled and intended for live displays, so it can miss a
LEMD reply. The API-key `feed:message` stream is unsampled only for receivers
owned by that Airframes account; it is not a completeness upgrade for Madrid
unless an approved Madrid receiver is actually operated. When both gates are
enabled, continuous Convex Node listening consumes roughly 365 Node GB-hours
per 730-hour month at the current 512 MiB Node allocation. The five-second gate
heartbeat and
45-second status heartbeat add roughly 576,000 function calls per month.
At the currently documented included allowances and overage rates, that is
approximately $114/month in Node-action overage on Starter or $35/month on
Professional, before any regional multiplier and other calls. Current pricing,
an explicit spend limit, and usage alarms must be reviewed before activation.

### Paused production state, testing, and revocation

The safe state before written approval keeps both gates false:

```text
AIRFRAMES_LEMD_STREAM_APPROVED=false
AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED=false
```

After the complete written scope is confirmed, approval can be recorded while
the connection remains paused:

```text
AIRFRAMES_LEMD_STREAM_APPROVED=true
AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED=false
```

This second state intentionally opens no WebSocket handshake, authentication,
subscription, automatic rotation, or recovery connection. It also makes the UI
distinguish `approval required` from
`Live stream paused — Airframes unavailable`, with an explicit notice that
automatic reconnect is disabled by the Convex kill switch. Approved stored
rows may remain visible, but no new stream-derived rows can arrive.

Set explicit false values on existing deployments and false project defaults
for newly created deployments:

```text
npx convex env set AIRFRAMES_LEMD_STREAM_APPROVED false
npx convex env set AIRFRAMES_LEMD_STREAM_APPROVED false --prod
npx convex env set AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED false
npx convex env set AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED false --prod
npx convex@latest env default set AIRFRAMES_LEMD_STREAM_APPROVED false --type dev
npx convex@latest env default set AIRFRAMES_LEMD_STREAM_APPROVED false --type preview
npx convex@latest env default set AIRFRAMES_LEMD_STREAM_APPROVED false --type prod
npx convex@latest env default set AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED false --type dev
npx convex@latest env default set AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED false --type preview
npx convex@latest env default set AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED false --type prod
```

Project defaults do not replace explicit values on existing deployments.
Before written approval, development and verification must use only synthetic
fixtures, mocked sockets, or provider-sanctioned samples. Do not set the
approval flag merely to perform a live test.

Only after the complete written scope above is confirmed may approval be
recorded:

```text
npx convex env set AIRFRAMES_LEMD_STREAM_APPROVED true --prod
```

That command alone does not connect. Keep the operational switch false until
the provider endpoint and expected subscription protocol have been
revalidated.

#### Provider incident and later controlled retry

On July 31, 2026 Madrid time, repeated isolated tests and Airframes' own
`/messages/live` browser client reached the Airframes frontend but received
Cloudflare `502`/`503` responses from `ws.airframes.io` before Socket.IO
authentication. No LEMD stream rows were captured. A Cloudflare Ray ID by
itself did not establish that the client was security-blocked, and adding an
API key was not shown to resolve the pre-authentication failure.

There is also protocol drift to recheck: the published realtime documentation
described emitting `messages:sniff` and awaiting
`messages:sniff:started`, while the inspected Airframes application bundle
connected with an empty access token and listened directly for `message`
without emitting that subscription. The current backend implements the
documented subscription path. A restored socket that never acknowledges that
event will still enter backoff, so endpoint recovery alone is not enough to
declare the integration healthy.

After written approval, retry in a deliberately short operational window:

1. Confirm that Airframes' own live page completes its WebSocket upgrade and
   ask Airframes which global-feed authentication and subscription flow is
   currently supported.
2. Verify `AIRFRAMES_LEMD_STREAM_APPROVED=true` and leave the one-minute REST
   integration independent.
3. Enable connection attempts:

   ```text
   npx convex env set AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED true --prod
   ```

4. Observe the protected query/status for an acknowledged `listening` state
   and an actual minimized LEMD row. Do not treat a TCP/WebSocket connection
   alone as a successful D-ATIS subscription.
5. If the endpoint still returns `502`/`503`, the subscription is not
   acknowledged, or the approved test window ends, immediately pause all new
   connections and reconnects:

   ```text
   npx convex env set AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED false --prod
   ```

Removing the operational flag has the same fail-closed connection behavior:

```text
npx convex env remove AIRFRAMES_LEMD_STREAM_CONNECT_ENABLED --prod
```

Full permission revocation is separate. It closes and fences active work,
prevents new persistence, and hides stored stream-protected rows from public
queries:

```text
npx convex env set AIRFRAMES_LEMD_STREAM_APPROVED false --prod
# Or:
npx convex env remove AIRFRAMES_LEMD_STREAM_APPROVED --prod
```

Revoking or pausing the WebSocket path does not revoke the independent REST
approval, and changing the REST flag does not activate or revoke the WebSocket
path.


[1]: https://ama.aemet.es/en/que-es-el-ama "What is A. M. A. - AMA"
[2]: https://aviationweather.gov/data/api/ "Data API"
[3]: https://aviationweather.gov/help/?utm_source=chatgpt.com "AWC Help"
[4]: https://ama.aemet.es/faqs "AMA FAQs"
