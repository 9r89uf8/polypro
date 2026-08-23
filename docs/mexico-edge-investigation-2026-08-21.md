# MMMX edge investigation — 2026-08-21

Research window: **2026-08-21T20:50Z–22:02Z**. Production evidence is a
time-bounded snapshot from `/mexico/edge` and the production Convex read APIs;
it is not a provider service-level guarantee.

## Release and approval status

At the close of the research window, this investigation was read-only apart
from its documentation update.

- No plugin, client, source collector, credential, schema, cron, environment
  variable, or deployment was added or activated.
- One bounded research request was made to the public SEMAR BASANMEX file. It
  was not scheduled, retained, republished, or integrated.
- Every newly identified production source remains **unapproved and disabled**.
- The gate names found by the research started as reservations for future
  implementations. The follow-up below records which three now have code
  behind them. None may be set until the corresponding code is deployed
  disabled and the named data owner has granted the exact access, retention,
  republication, and prediction-market scope.
- A reachable page, public broker, API key, account, or paid subscription is not
  approval.

This is an engineering investigation, not legal advice. Provider counsel or
the data owner must resolve ambiguous licence scope.

### Implementation follow-up — 2026-08-21

The investigation itself remained read-only as recorded above. A later code
change implemented its first two recommendations, but did not activate them:

- `/mexico/edge` now separates REST-detected last-trade price, executable
  bid/ask, midpoint and platform-display series. The default is last-trade
  **price state**, not display price and not an execution claim.
- The collector can retain compact per-token successful-poll heartbeats,
  including no-change polls and endpoint-specific request/receive clocks, for
  14 days. It rejects missing token coverage and invalid no-trade sentinels.
- The query derives open/closed detection brackets, returns explicit coverage
  and truncation metadata plus one predecessor, and keeps pre-deployment
  changed-only history left-censored.
- TDZ and official new-maximum rows now fail closed on incomplete retained-day
  evidence: TDZ 05/23 have independent five-minute continuity checks and live
  freshness revalidation, while bounded official/relay queries detect an extra
  row instead of silently using a truncated suffix.
- This new storage and public evidence path is implemented behind the three
  exact-`true` Polymarket data approval flags documented below. It must be
  deployed with them absent. No value was set and no heartbeat history was
  backfilled.

Durable failed-attempt/gap rows, raw WebSocket trades, host clock telemetry,
monotonic sequence data and a persistent server stream remain unimplemented.

## Executive conclusion

The current CAPMA paths remain the best verified public paths:

1. CAPMA AFTN is the fastest verified relay of the official whole-degree
   `MMMX` report.
2. CAPMA TDZ 05/23 images can reveal a whole-degree runway display before the
   official report, but they are separate sensor proxies and can exceed the
   eventual METAR maximum. They are not settlement truth.
3. A sanctioned SENEAM/Vaisala AWOS numeric export is the only credible path to
   a true pre-report, sub-degree airport temperature edge. No supported public
   endpoint was found.
4. A formal SENEAM AFTN delivery is the strongest prospect for sanctioned push
   delivery of the official report. It would improve transport, not precision.
5. At investigation time, the reaction chart's default
   `platformDisplayPrice` series was not a clean trader-reaction measure. It
   could change mechanically between last trade and midpoint at Polymarket's
   10-cent spread boundary; the implementation follow-up corrected the
   default.
6. The workstation clock was unsynchronized during the audit. Cross-machine
   second-level comparisons cannot become proof until the measurement hosts
   have disciplined clocks and recorded uncertainty.
7. WebStorm already has the useful protocol tooling. Installing another plugin
   will not create an edge. Ideolog is the only plausible optional ergonomic
   addition, and it was not installed.

The strongest immediate work is therefore not another relay. It is making the
existing evidence statistically honest: archive trade, book, display-source,
weather-measurement, first-seen, no-change heartbeat, gap, and clock-quality
events separately.

## Live production evidence

### Contract captured

At capture time the production event was:

- event `878471`,
  `highest-temperature-in-mexico-city-on-august-21-2026`;
- active, not closed, negative-risk, with 11 buckets;
- resolved from the maximum whole-degree value in Weather Underground's MMMX
  **Daily Observations**, with revisions counting until the first next-day
  observation; and
- linked to
  `https://www.wunderground.com/history/daily/mx/mexico-city/MMMX`.

Gamma's event `endTime` was `2026-08-21T12:00:00Z` even though the event was
still active. It must not be treated as the trading or settlement close.

The production Weather Company gates were enabled, but the dashboard reported
`interfaceConfigured: false`, `setup_required`, and no observation. We
therefore had **no live copy of the contract's settlement source**. Source
attribution is structurally incomplete until an owner-supported interface is
configured; Weather Underground must not be scraped.

### Routine 21:40Z natural experiment

The official report was:

```text
METAR MMMX 212140Z 34006KT 6SM VCRA BKN020CB BKN080 OVC220 24/09 A3032
TEMPO 4SM TSRA RMK 8/363 HZY PCPN 3TH QUAD
```

| Event                                       | Production timestamp |
| ------------------------------------------- | -------------------: |
| Coded observation time                      |      `21:40:00.000Z` |
| First seen through CAPMA AFTN               |      `21:40:28.454Z` |
| 24°C REST book detected, display still 64%  |      `21:40:45.199Z` |
| First detected last-trade change, 64% → 74% |      `21:41:45.198Z` |
| Next detected last trade, 74% → 75%         |      `21:42:45.198Z` |
| AWC provider `receiptTime`                  |      `22:00:14.067Z` |
| Our first AWC observation                   |      `22:01:20.084Z` |

The first detected REST last-trade-price state change lies in
`(21:40:45.199Z, 21:41:45.198Z]`, or approximately **(16.7 s, 76.7 s] after our
CAPMA first sighting**, plus unknown CLOB endpoint materialization lag. This is
compatible with a post-CAPMA reaction; it does not prove the trader used CAPMA.

The book change detected at `21:40:45.199Z` cannot safely be called a reaction.
Its detection interval starts at the prior `21:39:45.359Z` snapshot and
therefore straddles CAPMA's `21:40:28.454Z` arrival.

The routine report reached CAPMA about 19 minutes 46 seconds before AWC's
recorded receipt. NOAA's latest-station file was then superseded by a later
SPECI before our collector captured the routine report there. AWC's history
query later enriched the routine row. This demonstrates both CAPMA's observed
transport lead and why a latest-only endpoint can miss an intervening report.

### Unscheduled 21:54Z SPECI natural experiment

The special report was:

```text
SPECI MMMX 212154Z 28006KT 6SM TS BKN020CB BKN080 OVC220 24/10 A3032
TEMPO 4SM TSRA RMK 8/963 HZY OCNL LTGICCG PCPN 3TH QUAD TSB54
```

| Event                                                 | Production timestamp |
| ----------------------------------------------------- | -------------------: |
| Coded observation / thunderstorm start                |      `21:54:00.000Z` |
| First NOAA collector sighting                         |      `21:54:35.044Z` |
| CAPMA collector sighting                              |      `21:54:35.438Z` |
| First detected 24°C trade/display change, 75% → 82%   |      `21:54:45.184Z` |
| AWC provider `receiptTime`                            |      `21:55:06.355Z` |
| Our first AWC observation                             |      `21:55:20.086Z` |
| Next detected state: bid 87%, ask 94%, midpoint 90.5% |      `21:55:45.169Z` |

NOAA and CAPMA arrived in the **same one-minute paired-race slot**. Their
394-millisecond collector-completion difference is therefore indeterminate,
not a NOAA publisher win.

The market appears to move 10.1 seconds after our first sighting, but the
current append-only table stores changed quotes, not a per-token no-change
heartbeat. The conservative stored interval is
`(21:52:45.186Z, 21:54:45.184Z]`, which straddles the SPECI arrival. Even with
the expected intervening poll, a one-minute REST interval would still straddle
the event. The page must not label this as a precise 10.1-second reaction.

This live event is also direct evidence that SPECI is criterion-triggered. A
clock could not have predicted the thunderstorm report. The correct product
copy remains `No SPECI clock — event triggered`.

### Earlier temperature and market ordering

Today's first official daily maxima were observed at roughly:

| New maximum |       First report sighting |
| ----------: | --------------------------: |
|        19°C |   NOAA SPECI at `15:39:35Z` |
|        20°C | CAPMA report at `15:45:12Z` |
|        21°C | CAPMA report at `16:46:22Z` |
|        22°C | CAPMA report at `17:45:42Z` |
|        23°C | CAPMA report at `18:47:18Z` |
|        24°C | CAPMA report at `19:46:06Z` |

The 24°C market display was detected moving from 20% to 22%, 35%, and 36% at
`19:41:45Z`, `19:42:45Z`, and `19:43:45Z`—before our official 24°C report
arrival. Traders did not wait for that report. The dataset cannot distinguish
TDZ, Weather Underground, another feed, direct observation, or private
forecasting as the input.

The TDZ paths were themselves leading but not authoritative:

- TDZ 23 first displayed 24°C at screen time `18:30:33Z` and was fetched at
  `18:33:25Z`;
- TDZ 05 first displayed 25°C at `19:18:33Z`, fetched at `19:19:25Z`;
- TDZ 23 displayed 26°C at `20:31:38Z`, fetched at `20:34:25Z`; and
- the official report maximum still remained 24°C during this investigation.

The display time, HTTP first-seen time, and official report time are different
facts. TDZ values must never be silently promoted to the METAR-selected sensor.

### CAPMA relay sample

For the 2026-08-21 dashboard scope at `22:02Z`, the dedicated paired race had
17 matched reports:

- 4 valid decisive comparisons, all CAPMA;
- 1 same-slot/indeterminate comparison, the 21:54Z SPECI; and
- 12 invalid pairs where the earlier slot did not contain successful paired
  attempts.

The valid median CAPMA lead was `869.6785 s`. Descriptive 12–19 minute leads on
invalid pairs are useful context but are not valid race wins. The collector's
minute resolution also prevents publisher-order claims inside a slot.

Across 20 CAPMA-first reports inspected separately, coded observation time to
our CAPMA first sighting had median `36.769 s`, minimum `12.117 s`, and maximum
`155.422 s`. These are collector observations, not a SENEAM SLA.

### Duplicate source rails

The production source timeline can render a report twice: once from the
official observation row and once from a source-sighting row. Reaction rows can
then duplicate the same event. Before statistical use, deduplicate on a stable
identity such as:

```text
typelessHash/reportKey + source + immutable sourceFirstSeenAt
```

Do not deduplicate different report types, sources, TDZ ends, measurements, or
provider revisions merely because their temperatures match.

## Measurement model required for a defensible edge

### Four clocks, never one timestamp

Every weather and market event needs separate fields for:

1. `measurementAt` or coded/screen time;
2. `providerAt` or provider receipt/snapshot time, when documented;
3. `collectorReceivedAt` / immutable `sourceFirstSeenAt`; and
4. database `acceptedAt` plus a same-process monotonic sequence.

Keep request start/end, poll cadence, host identifier, clock-offset estimate,
round-trip uncertainty, reconnect gaps, and health alongside them. Do not
substitute file `Last-Modified`, AWC `receiptTime`, or a browser `Date.now()`
for the wrong clock.

During this audit Windows reported leap indicator 3, stratum 0, source `Local
CMOS Clock`, and no successful synchronization. Same-process monotonic ordering
remains useful; cross-host subsecond comparisons do not. An authorized
administrator should restore NTP/UDP 123, then record `w32tm /stripchart`
offsets. Production stream hosts should use chrony/NTP and export offset and
uncertainty with every session.

### Replace one probability series with four

Polymarket's documented display rule is midpoint when spread is at most $0.10
and last trade when spread is wider. The current dashboard uses that display
value for reaction analysis. At capture time, for example:

- 24°C displayed 75% from last trade with bid 34%, ask 81%, midpoint 57.5%,
  and a 47-point spread; and
- 25°C displayed 18% from last trade with bid 16%, ask 52%, midpoint 34%, and
  a 36-point spread.

The 11 displayed values summed to 106.05%. These are individual platform
display values, not a normalized probability distribution.

The explorer exposes four independently selectable series:

1. REST-detected last-trade price state;
2. executable best bid/ask, sizes and spread;
3. midpoint; and
4. platform display, with explicit `midpoint ↔ last_trade` transition markers.

The current default uses the first detected last-trade-price update—not the
first display-number change. Because `/last-trades-prices` supplies no
execution time or size and cannot reveal another trade at the same price, this
must not be called an actual trade event. Platform-display transitions remain
useful product behavior, but not evidence of a trade.

### Detection intervals, not point delays

For minute REST collection, a changed value happened in:

```text
(previous successful same-value poll, first changed-value poll]
+ unknown provider materialization lag
```

The implementation now has a compact immutable per-token heartbeat table that
records successful polls and fingerprints even when no quote field changes.
For the selected market, public history is capped at 2,000 rows, returns one
predecessor plus explicit coverage/truncation metadata, and uses separate book
and last-trade receive times. Missing or partial token responses produce no
successful heartbeat. Failed attempts are not yet stored durably and therefore
cannot be counted inside a gap; the response discloses that limitation.

For a weather first-seen event `E` and a market detection bracket `(L,U]`, the
implemented classifications are: `E <= L` compatible-after; `L < E <= U`
ordering-indeterminate; and `E > U` detected-before-source. Without `L`, the
event is left-censored. Pre-deployment changed-only events do not fabricate a
lower boundary.

For a durable WebSocket event, show provider event time, worker receipt time,
clock offset/uncertainty, and any gap boundary. The public schema does not
promise replay, a global sequence, loss detection, ordering across tokens, or
the semantic meaning of every timestamp. A negative apparent delay is a clock
or interval warning, never proof that the market predicted the future.

### Event definition and study design

A weather event for the daily-high study is the first **new maximum for one
source**, not every repeated frame or report. Keep source-specific maxima
separate. For each event calculate trade count/volume, signed direction,
book/midpoint/display-source changes at 1, 5, 15, and 60 seconds, with censoring
for missing/two-sided books and wide spreads.

Use matched control windows with similar time of day, spread, depth, and recent
volatility. Analyze multiple days before calling an edge. Safe language is
`compatible with reaction after source X`; never `caused by source X`.

## Fast-source investigation

### Ranked paths

| Rank | Candidate                         | Incremental value                                              | Present decision                                                                       |
| ---: | --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
|    1 | Direct SENEAM/Vaisala AWOS export | Potential native, sub-degree, seconds-level temperature        | Request a supported read-only export; no public endpoint; approval required            |
|    2 | Formal SENEAM AFTN/AMHS delivery  | Potential push delivery upstream of public relays              | Request eligibility, current protocol, MMMX scope and rights; same whole-degree report |
|    3 | Current CAPMA TDZ displays        | Fast native-looking runway display                             | Keep sensor lineage separate; current gates remain mandatory                           |
|    4 | Current CAPMA AFTN page           | Fastest verified public official report                        | Keep; high-frequency scope requires its separate existing gate                         |
|    5 | DECEA REDEMET                     | Independent official receipt timestamp and possible AFTN route | Confirm MMMX coverage and rights before any credential or call                         |
|    6 | WMO WIS2 aviation gateway         | Possible GTS bulletin push                                     | No discoverable Mexico aviation topic yet; confirm exact topic and policy first        |
|    7 | Synoptic Push Streaming           | Commercial push and latency telemetry                          | MMMX/upstream path unknown; bespoke prediction-market/public-display rights required   |
|    8 | DTN Observations API              | Commercial near-real-time global METAR                         | MMMX lineage/receipt/lead unknown; contract required                                   |
|    9 | NOAA raw/station/AWC              | Canonical report and structured enrichment                     | Retain; not the fastest observed routine path                                          |
|   10 | IEM                               | Archive and independent ingestion comparison                   | Retain as archive; primarily NOAA/NOAAPort lineage                                     |
|   11 | SEMAR BASANMEX/AION               | Independent 0.1°C airport rooftop station                      | Public file is delayed and not MMMX truth; sanctioned AION access required             |
|   12 | SMN WIS2 SYNOP                    | Regional context                                               | Tacubaya is about 13 km away; never label it MMMX                                      |

### SENEAM formal routes

The current February 2026 federal simplification order still lists
`SENEAM-04-001`, the fixed AFTN telecommunications service. The application
requires identity/legal-personality and payment evidence. SENEAM's current
report describes AFTN as a company message-transmission service and also lists
the separate `SENEAM-02-002` meteorological-data service.

The customer protocol, eligibility, current price, MMMX content, delivery
latency, and permitted downstream use are not public. The old 2017 tariff is
useful only as historical evidence that its bundle once contained Mexico/US
METAR and SPECI. It is not current pricing.

Critical correction: Article 151 of the current _Ley Federal de Derechos_ is
repealed. Do not cite the old Article 151 text as current authority. Ask SENEAM
for the current quotation and legal/payment basis.

For native data, ask for a supported read-only AWOS/AviMet API, stream, SFTP,
or copied export; exact probe IDs; measurement/quality flags; sensor and system
timestamps; cadence; and mapping to the official METAR-selected values. Never
probe operational AMHS/AWOS infrastructure.

### Settlement source: Weather Company

The Weather Company has owner-supported observation APIs with station and
valid-time fields. Its ICAO current-conditions product can also be a blended
4-km product, so an ICAO parameter alone does not prove station lineage.

The required question is narrower: which supported product produces the rows
in Weather Underground MMMX Daily Observations, with what cache, revision,
rounding, sensor lineage, and public/prediction-market rights? Keep the existing
`TWC_MMMX_RES_*` gates closed until that exact interface and scope are
confirmed. Never substitute a nearby or blended product under the settlement
label.

### Commercial and international relays

DECEA's authenticated REDEMET API is unusually useful because it returns a
provider `recebimento` field. It could independently benchmark receipt if
MMMX is covered, but coverage and commercial/public rights were not confirmed.

Synoptic advertises push shortly after data becomes deliverable to its
platform, not shortly after the underlying airport measurement. International
coverage is contract-dependent and upstream delay remains uncontrolled.
Standard terms require written consent for external/commercial display and do
not establish prediction-market rights.

DTN advertises near-real-time global METAR observations, but no evidence was
found that its MMMX path is independent of, or faster than, the current relay.
Only a contracted, timestamped benchmark can answer that.

WIS2 remains a watch item. A bounded official catalog search found Mexico
SYNOP/TEMP/CAP/daily-climate products but no discoverable Mexico aviation METAR
collection. A generic GTS-to-WIS2 topic can be inferred from bulletin headers,
but inference is not a supported production subscription. Confirm the exact
topic, core/recommended policy branch, retention and redistribution with
WMO/SMN before subscribing.

### SEMAR BASANMEX

A single research fetch of the official BASANMEX text file returned a newest
15-minute row around 33 minutes old and 26.0°C while MMMX reporting was 24°C.
It is an independent rooftop automatic station, not the SENEAM official
sensor, and the public file appears to publish in delayed batches. It is not a
speed edge.

A sanctioned AION measurement route may be fresher, but authentication,
CAPTCHA, and an account must not be automated or reused without SEMAR/AION
approval for the precise service role, retention, public display and
prediction-market analysis.

### Rejected paths

- **FlightAware:** current ordinary terms expressly prohibit API/data/derived
  use connected with betting, prediction markets, or event contracts. Do not
  integrate under standard terms; only a bespoke signed override could change
  the decision.
- **WIFS:** intended for approved international-flight operators/support
  organizations. It is a five-minute OPMET relay, not native temperature.
- **SADIS:** civil-aviation licensing, authority approval, redistribution, and
  automated-decision restrictions make it unsuitable here.
- **CheckWX standard terms:** non-aviation/automation restrictions; reconsider
  only with bespoke written rights.
- **AVWX:** documents NOAA as its default Mexico source, so it adds no lineage
  edge.
- **Meteomatics:** no documented MMMX origin or provider-receipt timestamp, and
  no evidence of a lead.
- **MET Norway tafmetar:** a bounded MMMX check returned no report.
- **webcams, YouTube, LiveATC, D-ATIS/audio:** unsuitable rights and no
  calibrated numeric sensor lineage.
- **operational AMHS or AODB probing:** prohibited; request a sanctioned
  one-way delivery instead.

## Polymarket collection and licence boundary

The durable collector currently polls Gamma discovery plus exact CLOB
`/books` and `/last-trades-prices` once per minute. It preserves exact strings,
top-of-book, midpoint, spread, last trade, display rule, book hash/timestamp,
request and receive times. The browser WebSocket is explicitly session-only and
ephemeral.

The REST last-trade response has no execution timestamp. The Data API trade
history adds transaction hash, size, side and integer-second timestamp, but its
indexing lag is undocumented. Price history is minute fidelity and
midpoint-like; it cannot reconstruct the platform display series.

Polymarket Institutional says covered capital-markets entities consuming raw
or derived data must consult Polymarket/ICE, with distributors classifying
recipients. It is not established that this project is in that category, but a
public market-data/edge dashboard may be distribution or fintech activity.
Before adding durable second-level history or wider public output, obtain a
written classification and scope from `data-licensing@polymarket.com` and ICE.

### Approval-gated durable stream design

Do not implement or activate this until rights are confirmed. Convex actions
cannot guarantee an all-day WebSocket. Use an always-on worker with disciplined
time and an official Polymarket client:

1. recheck access approval;
2. discover the day's event and token map;
3. take exact REST book baselines;
4. create a durable session row with host clock quality;
5. subscribe to every YES token;
6. store normalized raw book, price-change and trade fields with payload hash,
   provider time, wall and monotonic worker receipt, Convex acceptance, session
   and sequence IDs;
7. write explicit disconnect/reconnect/gap rows; and
8. reconcile every reconnect against REST books and indexed trades.

Keep the minute REST collector as an independent audit path. Revocation must
close the socket, stop retry/queued work, prevent retention, and sanitize public
queries according to the capability removed.

Implemented heartbeat-evidence gates, all within Convex's 40-character name
limit:

```text
POLYMARKET_MMMX_DATA_ACCESS_APPROVED
POLYMARKET_MMMX_DATA_RETENTION_APPROVED
POLYMARKET_MMMX_DATA_PUBLIC_APPROVED
```

All three remain absent. Access plus retention are required for unchanged-poll
and interval-metadata writes; public output additionally requires the public
gate. Without them, legacy current quotes/change collection continues, but
heartbeat rows, predecessors and detection metadata are empty or sanitized and
the query exposes an exact `*_approval_required` status. Retention cleanup
remains available after revocation. The protected scope is consumption,
derived reaction analysis, 14-day Convex retention and public display; contact
`data-licensing@polymarket.com` and ICE for classification before activation.

Reserved only for a future durable stream:

```text
POLYMARKET_MMMX_WSS_ENABLED
```

The existing `POLYMARKET_MMMX_LIVE_COLLECTION_ENABLED` is an operational switch,
not evidence of provider approval.

## Approval matrix for newly found sources

These names are documentation reservations, not implemented flags. Every
capability accepts only exact `true`, remains absent by default, and keeps
credentials separate.

| Source           | Access gate                             | Retention gate                             | Public/republication gate                 | Approving authority                                     |
| ---------------- | --------------------------------------- | ------------------------------------------ | ----------------------------------------- | ------------------------------------------------------- |
| Direct AWOS      | `SENEAM_MMMX_AWOS_ACCESS_APPROVED`      | `SENEAM_MMMX_AWOS_RETENTION_APPROVED`      | `SENEAM_MMMX_AWOS_REPUBLICATION_APPROVED` | SENEAM/CAPMA and any required AICM authority            |
| Formal AFTN feed | `SENEAM_MMMX_AFTN_FEED_ACCESS_APPROVED` | `SENEAM_MMMX_AFTN_FEED_RETENTION_APPROVED` | `SENEAM_MMMX_AFTN_FEED_PUBLIC_APPROVED`   | SENEAM/CAPMA, with exact MMMX and market-analysis scope |
| REDEMET          | `DECEA_MMMX_REDEMET_ACCESS_APPROVED`    | `DECEA_MMMX_REDEMET_RETAIN_APPROVED`       | `DECEA_MMMX_REDEMET_REPUB_APPROVED`       | DECEA/REDEMET                                           |
| WIS2 aviation    | `WMO_WIS2_MMMX_FEED_APPROVED`           | `WMO_WIS2_MMMX_RETAIN_APPROVED`            | `WMO_WIS2_MMMX_REPUB_APPROVED`            | WMO/SMN or cataloguing data owner                       |
| Synoptic         | `SYNOPTIC_MMMX_STREAM_ACCESS_APPROVED`  | `SYNOPTIC_MMMX_STREAM_RETAIN_APPROVED`     | `SYNOPTIC_MMMX_STREAM_REPUB_APPROVED`     | Synoptic under bespoke contract                         |
| DTN              | `DTN_MMMX_METAR_ACCESS_APPROVED`        | `DTN_MMMX_METAR_RETAIN_APPROVED`           | `DTN_MMMX_METAR_REPUB_APPROVED`           | DTN under contract                                      |
| BASANMEX file    | `SEMAR_BASANMEX_FILE_ACCESS_APPROVED`   | `SEMAR_BASANMEX_FILE_RETAIN_APPROVED`      | `SEMAR_BASANMEX_FILE_REPUB_APPROVED`      | SEMAR                                                   |
| AION temperature | `SEMAR_AION_MMMX_ATMP_ACCESS_APPROVED`  | `SEMAR_AION_MMMX_ATMP_RETAIN_APPROVED`     | `SEMAR_AION_MMMX_ATMP_REPUB_APPROVED`     | SEMAR/AION administrator                                |

Protected entry points include manual actions, crons, retries, queue workers,
HTTP routes, connections/reconnections, external requests, storage mutations,
public queries, exports and derived displays. Approval must be checked before
queueing and again immediately before an external request or write. A future
implementation is deployed with all gates absent and its disabled state is
verified before any activation command is run.

## WebStorm and local-tool audit

The installed product is WebStorm **2026.2.1**, build `262.9437.145`, despite a
directory name that contains `2025.2.3`.

Already available:

- JetBrains HTTP Client with HTTP, WebSocket, GraphQL, gRPC, OAuth, response
  scripts, environments and CLI execution;
- JavaScript debugger and Chrome connection;
- Chrome DevTools Protocol, Playwright and browser automation;
- Convex CLI/dashboard access;
- MQTT.js plus Python `websockets` and `paho-mqtt`;
- the built-in CSV/TSV table editor; and
- Windows PktMon.

Database Tools cannot inspect Convex's document store because Convex does not
provide a JDBC/SQL data source. Use Convex's CLI/dashboard.

### Ranked install decision

| Rank | Tool                                                        | Decision                                                                                                                         |
| ---: | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
|    1 | Existing HTTP Client + CDP + Playwright + Convex/MQTT tools | Use these; they cover the measurement work without another extension                                                             |
|    2 | Ideolog `262.8665.173`                                      | Optional only for frequent append-only log inspection; JetBrains-maintained and compatible; exclude credentials/private payloads |
|    3 | Wireshark/Npcap                                             | External and approval-sensitive; try PktMon/CDP first; use only when packet arrival is necessary                                 |
|    4 | MQTTX                                                       | Optional one-off WIS2 topic exploration after topic/access approval; no timing advantage over current clients                    |
|    5 | CSV Editor                                                  | Low value and redundant with built-in DSV editor                                                                                 |

Do not install the incompatible MQTT Client plugin (`252.*` maximum), redundant
HTTP/WebSocket plugins, an AsyncAPI plugin without maintained contracts, extra
AI assistants, or low-adoption CSV/log plugins. No compatible Marketplace
plugin named Convex or WIS2 was found.

Wireshark/Npcap requires administrator/security/licensing review, and packet
captures or TLS key logs can expose credentials and personal data. Chrome
remote debugging should use an isolated profile. Keep JetBrains MCP loopback
only and grant bounded permissions.

The repository's `watch:eddm-wis2` package script points to a missing
`scripts/watch-eddm-wis2.mjs`; do not treat that watcher as available.

No plugin was installed because none resolves the actual bottleneck: upstream
source access and trustworthy timestamp semantics.

## Recommended delivery order

1. **Correct analytics first — implemented, gated where applicable.** Split
   last-trade-price/BBO/midpoint/display series, deduplicate weather rails,
   define source-specific first-new-max events, and replace point delay with
   detection intervals.
2. **Add durable evidence primitives — partially implemented and disabled.**
   Per-token successful-poll heartbeats and endpoint receipt clocks are ready
   behind approval. Failed-poll rows, host clock quality, monotonic sequence,
   reconnect/gap rows and selected raw hashes remain future work.
3. **Restore clock trust.** Have an authorized administrator repair workstation
   synchronization; require NTP/chrony plus offset telemetry on production
   workers.
4. **Resolve the settlement source.** Ask The Weather Company for the exact
   owner-supported product behind WU Daily Observations and its rights.
5. **Seek SENEAM paths in parallel.** Request the formal AFTN feed and a
   supported read-only AWOS numeric export, including prediction-market and
   public-display scope.
6. **Obtain Polymarket/ICE classification.** Only then build the gated durable
   second-level worker.
7. **Benchmark candidates disabled/private first.** Use fixtures until access
   is granted, then compare provider receipt and our first-seen intervals over
   multiple days before public output.
8. **Install no IDE plugin now.** Add Ideolog later only if log review becomes a
   recurring manual bottleneck.

## Primary references

### Aviation and weather

- [Current SENEAM AFTN trámite](https://www.gob.mx/tramites/ficha/red-fija-de-telecomunicaciones-aeronauticas/SENEAM5296)
- [February 2026 DOF simplification order](https://dof.gob.mx/nota_detalle_popup.php?codigo=5780615)
- [Current Ley Federal de Derechos](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFD.pdf)
- [Historical 2017 SENEAM tariff](https://www.seneam.gob.mx/gobmx/cuotas/cuotas2017.html)
- [SENEAM consolidated report](https://www.seneam.gob.mx/gobmx/archivos/Informe_Consolidado%20SENEAM_26082024.pdf)
- [SENEAM aviation meteorology](https://www.gob.mx/seneam/acciones-y-programas/meteorologia-aeronautica)
- [SENEAM site-use conditions](https://www.gob.mx/seneam/acciones-y-programas/condiciones-de-uso-53048)
- [Vaisala AviMet AWOS](https://www.vaisala.com/en/products/systems/avimet-awos)
- [AWC API policy](https://aviationweather.gov/data/api/)
- [NOAA retrieval guidance](https://www.weather.gov/tg/datahelp)
- [REDEMET METAR API](https://ajuda.decea.mil.br/base-de-conhecimento/api-redemet-mensagem-metar/)
- [WIS2 operational services](https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/wmo-information-system-wis/wis-20-global-services)
- [WIS2 transition and gateway topics](https://community.wmo.int/site/knowledge-hub/programmes-and-initiatives/wmo-information-system-wis/guidance-transition-from-gtswis1-wis2)
- [Synoptic push](https://docs.synopticdata.com/services/push-streaming)
- [Synoptic latency semantics](https://docs.synopticdata.com/services/latency-of-observation-data-on-the-synoptic-platfo)
- [Synoptic terms](https://synopticdata.com/tcs/)
- [SEMAR BASANMEX station](https://meteorologia.semar.gob.mx/dirmet/estaciones/basanmex.html)
- [WIFS information](https://aviationweather.gov/wifs/)
- [SADIS API licence](https://www.metoffice.gov.uk/policies/aviation/sadis/sadis-api-licence-agreement)
- [FlightAware terms](https://www.flightaware.com/about/terms-of-use)

### Market data

- [Polymarket display-price rule](https://help.polymarket.com/en/articles/13364488-how-are-prices-calculated)
- [Polymarket real-time market data](https://docs.polymarket.com/market-data/realtime-data)
- [Polymarket REST last-trade endpoint](https://docs.polymarket.com/api-reference/market-data/get-last-trade-prices-request-body)
- [Polymarket indexed trades](https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets)
- [Polymarket price history](https://docs.polymarket.com/api-reference/markets/get-prices-history)
- [Polymarket rate limits](https://docs.polymarket.com/api-reference/rate-limits)
- [Polymarket server time](https://docs.polymarket.com/api-reference/data/get-server-time)
- [Polymarket Institutional](https://institutional.polymarket.com/)

### Measurement and tooling

- [Microsoft high-accuracy time guidance](https://learn.microsoft.com/en-us/windows-server/networking/windows-time-service/configuring-systems-for-high-accuracy)
- [Microsoft W32Time tools](https://learn.microsoft.com/en-us/windows-server/networking/windows-time-service/windows-time-service-tools-and-settings)
- [JetBrains HTTP Client plugin](https://plugins.jetbrains.com/plugin/13121-http-client)
- [JetBrains data editor and viewer](https://www.jetbrains.com/help/webstorm/data-editor-and-viewer.html)
- [Ideolog](https://plugins.jetbrains.com/plugin/9746-ideolog)
- [Chrome DevTools Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/)
- [Chrome remote-debugging security change](https://developer.chrome.com/blog/remote-debugging-port)
- [Windows PktMon](https://learn.microsoft.com/en-us/windows-server/networking/technologies/pktmon/pktmon)
- [JetBrains MCP server](https://www.jetbrains.com/help/ai-assistant/mcp.html)
