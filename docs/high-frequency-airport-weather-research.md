# High-frequency airport weather source research playbook

Last updated: **2026-08-04**.

## Purpose

This is the reusable blueprint for finding, validating airport weather observations.
The target is not merely “a number that changes every minute.” A production
source must answer all of these questions:

1. Which airport, runway position, station, sensor, or display does it
   represent?
2. Is the value an observation, an average, a forecast, a report relay, or a
   screen rendering?
3. What are its native sample, calculation, output, publication, and delivery
   intervals?
4. Which timestamp describes the physical observation, and which timestamps
   describe later processing or delivery?
5. What precision, accuracy, rounding, quality-control, and missing-data rules
   apply?

The method is suitable for a future airport in Brazil, Argentina, or another
country.

## Definition of success

A successful investigation produces a source dossier, not just an endpoint.
The dossier should contain:

- exact airport and station identity;
- source owner, system operator, data custodian, and approval contact;
- exact owner-published URL or provider-issued interface;
- field and sensor identity;
- documented and measured cadence;
- all relevant timestamps and measured latency;
- precision, accuracy, units, averaging, rounding, and quality flags;
- a reproducible raw sample with retrieval metadata and a cryptographic hash;


## Evidence language

Use these labels consistently:

| Label        | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `observed`   | Directly measured in a bounded test with time, request, and raw evidence |
| `documented` | Stated in a named provider, regulator, contract, manual, or standard     |
| `inferred`   | Reasonable synthesis that is not directly proved                         |
| `unknown`    | Material fact that remains unresolved                                    |
| `rejected`   | Evidence shows the source cannot satisfy the intended use                |


For source identity, this evidence ladder is useful:

| Level | Evidence                                                                 |
| ----- | ------------------------------------------------------------------------ |
| `I0`  | Search result, third-party claim, or name similarity                     |
| `I1`  | Live artifact visibly identifies the airport or ICAO                     |
| `I2`  | Runway/site/display identity and embedded observation time are verified  |
| `I3`  | Owner or well-attributed manual identifies the architecture/system class |
| `I4`  | Provider confirms exact station, channel, selection rule, and ICD        |
| `I5`  | As-built asset/model/serial, calibration history, and owner confirmation |

Do not describe a source at a higher identity level than its evidence.


###  Passive hostname and history research

The work checked:

- official link graphs, sitemaps, and `robots.txt`;
- exact indexed phrases and public code strings;
- Wayback URL inventories and urlscan history;
- passive DNS and certificate transparency;
- current and archived vendor/integrator sites; and
- hostnames printed in official slides or application configuration.



## Research order

Follow the phases in order. A later, more invasive technique should not replace
an earlier provider-owned or documented path.

## Phase 0: define the question precisely

Record the following before searching:

```text
airportName
icao
iata
country
airportReferenceCoordinate
localTimeZone
targetVariable
requiredCadence
requiredPrecision
requiredFreshness
historicalRetentionNeed
publicOrInternalUse
commercialOrNoncommercialUse
```

Resolve name collisions immediately. Search and store ICAO and IATA codes,
city, airport operator, and coordinates independently.

Define what “one-minute temperature” means for the project:

- a sensor sample every minute;
- a one-minute mean;
- the latest instantaneous value copied once a minute;
- a screen captured once a minute;
- a file republished once a minute;
- or an hourly official value fetched by a one-minute poller.

These are different products.

## Phase 1: build the authority and source map

Identify, without assuming that one organization owns everything:

- the national aeronautical information service and AIP publisher;
- the air navigation service provider;
- the aviation meteorological service provider;
- the national meteorological agency;
- the airport owner/operator or concessionaire;
- tower, approach, MET office, and airport operations roles;
- military, naval, university, or environmental networks near the airport;
- the system integrator and sensor/software vendors;
- procurement and transparency portals; and
- official open-data catalogues.

Start with first-party material:

1. AIP airport entry and meteorological-services section;
2. provider station catalogue and METAR/TAF documentation;
3. airport operational and technical pages;
4. national weather open-data/API documentation;
5. procurement notices, technical annexes, awards, contracts, amendments, and
   acceptance records;
6. provider manuals, training decks, conference presentations, and application
   downloads; and
7. formal data-request and freedom-of-information routes.

Use global aviation relays to establish an official baseline, not to infer the
existence of a minute sensor. METAR/SPECI, local MET REPORT, ATIS/D-ATIS, and
WMO/WIS products can be separate transformations or delivery paths from the
same underlying observer workflow.

## Phase 2: map the provider-owned public web surface

Navigate from an owner-published page. Preserve the complete link chain. Older
aviation sites often use framesets, iframes, server-rendered forms, mixed-case
filenames, or direct image links rather than a modern API.

Inspect:

- document, frame, iframe, image, stylesheet, and script URLs;
- form `action` and method;
- link targets and station parameters;
- HTML meta refresh and response refresh headers;
- JavaScript `fetch`, XHR, WebSocket, EventSource, worker, and timer calls;
- service-worker and web-app manifests actually linked by the page;
- loaded JSON, XML, CSV, text, image, tile, and binary resources;
- request and response headers, redirects, cookies, cache controls, ETags, and
  `Last-Modified`;
- Content Security Policy and connection targets;
- visible station selectors and opaque identifiers returned by the owner's
  client; and
- publicly linked `robots.txt`, `sitemap.xml`, API documentation, and download
  pages.

Browser developer tools should preserve the network log, disable cache during
discovery, and filter Fetch/XHR, documents, images, media, and sockets. Change
one UI selector at a time so the request-to-control mapping is reproducible.

Replay only the exact read-only request observed from the provider's client.
First remove cookies and browser state to determine which state is actually
required. A successful replay establishes technical behavior.

Do not infer cadence from UI code alone. Measure the payload's own observation
time and body changes.


## Phase 3: discover hostnames


Good sources include:

- links and redirects from official pages;
- AIP, manuals, procurement files, presentations, screenshots, and QR codes;
- application manifests and provider-hosted remote configuration;
- HTML, JavaScript, mobile resources, CSP, and public certificate names;
- official DNS records and passive certificate-transparency history;
- provider-published support, customer, and status pages;
- archived official pages and archived JavaScript; and
- tender BOMs, interface-control-document references, and vendor case studies.

For every hostname, record how it was discovered. Distinguish:

```text
owner_published
provider_documented
captured_from_owner_client
passive_archive
passive_dns_or_certificate
third_party_reference
hypothesis_only
```

Check for wildcard DNS before treating plausible subdomains as discoveries.

An archived hostname can establish product lineage while being unusable or
unsafe as a current endpoint. Archived code can expose mock/static data, old
secrets, private addresses, or retired schemas.

port-scan, DNS, enumerate cloud buckets, guess object keys,
probe likely vendor ports.

## Phase 4: mine manuals, PDFs, procurement, and commissioning records

This phase often identifies the real system and the questions to ask even when
it produces no endpoint.

### Document workflow

For each official artifact:

1. save the canonical source URL and retrieval time;
2. record HTTP metadata, byte length, MIME type, and SHA-256;
3. inspect PDF metadata, bookmarks, annotations, attachments, portfolios, and
   embedded files;
4. inspect DOCX/OOXML relationships and embedded OLE/package objects;
5. extract embedded PDFs or spreadsheets without altering them;
6. run OCR on scanned pages while preserving page numbers and crop coordinates;
7. manually verify decisive OCR, especially model numbers, runway identifiers,
   dates, decimal points, and zeros versus the letter `O`;
8. compare amendments and later reports rather than reading an award in
   isolation; and
9. record the exact missing artifact and its likely custodian.


### Procurement state machine

Treat system status as a state machine:

```text
planned
budgeted
tendered
awarded
contracted
equipment_delivered
civil_works_ready
installed
configured
site_acceptance_tested
commissioned
accepted
in_production
maintained
retired_or_replaced
```

Require evidence for the state being claimed. Useful records include:

- bidder technical proposal and final BOM;
- signed technical annex and interface requirements;
- FAT, IAT, PSAT, stability, and FSAT results;
- delivery/receipt and service-acceptance acts;
- civil-work schedules and progress certificates;
- suspensions, resumptions, amendments, payment and closeout records;
- as-built diagrams and station register;
- software/version/licence inventory;
- data dictionary and ICD;
- commissioning declaration; and
- maintenance, calibration, outage, and replacement records.


### Product documentation is vocabulary, not asset proof

Once a vendor/model is documented, use period-correct vendor manuals to learn
the possible interfaces, file formats, quality flags, viewer families, and
component names.


## Phase 5: analyze browser applications and data viewers

For a public interactive viewer:

1. find the provider's product-definition page first;
2. select the exact variable, domain, resolution, and representation;
3. capture the list/discovery request;
4. capture the resolver or metadata request;
5. capture the final file request;
6. preserve opaque identifiers exactly rather than constructing them from
   guessed segments;
7. verify whether numerical data actually exists behind a displayed image;
8. validate downloaded bytes by magic signature and internal metadata; and
9. compare the viewer label, filename definition, payload metadata, and
   algorithm/manual before assigning physical meaning.


Useful publicly advertised formats and interface families to recognize are:

- REST/JSON, XML, CSV, fixed-width text, and HTML tables;
- OpenAPI, WSDL/SOAP, OGC WMS/WFS/SOS, SensorThings, and ArcGIS REST;
- NetCDF/HDF5, GRIB, BUFR, GeoTIFF, and image products;
- WebSocket, Server-Sent Events, Socket.IO, SignalR, and gRPC-web;
- MQTT, AMQP, and STOMP;
- SFTP/FTP exports, object manifests, and generated daily files; and
- database or logger exports administered by the provider.


## Phase 6: inspect official mobile and desktop applications statically

A continuously connected app may reveal a low-latency interface, but it may
carry alerts, images, or administrative state rather than observations.

For each APK, IPA, desktop installer, manifest, and manual, record:

- source URL, retrieval time, headers, byte length, and SHA-256;
- package/bundle identifier, label, version, build, signature/team, and minimum
  OS;
- distribution manifest, provisioning profile, entitlements, and expiry;
- declared permissions and exported components;
- network-security or App Transport Security configuration;
- deep links, QR targets, remote configuration, feature flags, and update URL;
- embedded hostnames, paths, topics, station identifiers, and product keys;
- request builders, HTTP methods, serializers, and response models;
- WebView pages and JavaScript bridges;
- push-notification, Firebase, APNs, MQTT, and socket libraries; and
- local database schemas, caches, and field names.

Static techniques include package unzip/listing, manifest/plist inspection,
resource and string searches, decompilation, class/call-graph tracing, and
comparison of two official versions. Search field models as well as strings:
an app can hide hostnames or route fragments through resource concatenation
while still exposing the semantic payload types in its serializers.



## Phase 7: investigate images, screenshots, and generated charts

An image can be the fastest public observation even when no numeric API is
available. Treat it as a measurement surface only after validating identity,
time, layout, and permission.

### Delivery forensics

Record:

- exact URL and filename case;
- redirect behavior and final origin;
- content type, byte range, dimensions, encoding, and metadata;
- ETag, `Last-Modified`, cache headers, and conditional-request behavior;
- body SHA-256 and, optionally, a perceptual hash;
- timestamp rendered inside the image;
- station, runway/TDZ, units, and field labels rendered inside the image;
- request start/completion and first-seen time; and
- whether the body is complete while the server is replacing it.

Use conditional `If-None-Match` and `If-Modified-Since` requests during an
approved bounded experiment.

### OCR/extraction contract

For a fixed layout:

1. require exact expected dimensions or a positively identified version;
2. verify station/runway labels and units before extracting values;
3. crop documented field rectangles;
4. use deterministic glyph/template or constrained OCR where possible;
5. validate date and time independently;
6. validate plausible ranges and cross-field invariants;
7. compute field and combined confidence;
8. reject rather than guess on layout, timestamp, station, unit, or confidence
   failure;
9. store the OCR engine/template version and rectangles; and
10. test every manually transcribed approved fixture.

Useful invariants include dew point not exceeding temperature except for a
small documented tolerance, valid pressure and humidity ranges, known runway
identifiers, and non-future/non-stale embedded time. These detect extraction
errors; they do not turn an unknown display into a calibrated sensor.

Retain current and averaged fields separately. At CAPMA, the large current
temperature and the separate two-minute temperature sometimes differed. The
dashboard plots the current field and preserves the two-minute field as a
diagnostic.

### Layout-drift defenses

Recommended additions for future image sources:

- compare a structural/edge-map fingerprint before OCR;
- use SSIM or registered image differences outside the dynamic field regions;
- maintain explicit template versions rather than silently shifting crops;
- compare deterministic OCR with a second engine during validation;
- detect partial-upload images by decode completion and stable body hashes;
- alert on new fonts, colors, dimensions, station labels, or field count; and
- keep a small provider-approved fixture set spanning day/night themes,
  negative values, all digits, and rollover boundaries.

Do not infer hidden decimal precision from anti-aliased pixels, related fields,
or physical formulas. A whole-degree display remains whole-degree data.

## Phase 8: validate numerical and binary payloads

HTTP 200 and a plausible filename are insufficient. Validate:

- file magic/signature and compression container;
- declared versus actual MIME type;
- complete parse with no trailing or truncated payload;
- schema version and required fields;
- units, scale/offset, fill/missing values, and quality flags;
- coordinate reference system, projection, grid bounds, and row/column order;
- station identifier and coordinates;
- timestamp semantics and timezone;
- range, record-count, and size limits; and
- embedded licence/provenance metadata.



## Phase 9: measure cadence and latency with a bounded experiment

Run long enough to cover expected rollovers, quiet periods, routine reports,
special reports, UTC midnight, and local midnight. Twenty-four to 72 hours is a
good initial range; use a shorter sanctioned probe only when provider limits
require it.

For each request or delivered event, record:

```text
source
stationOrSensorId
requestStartedAt
responseCompletedAt
httpStatus
contentType
cacheControl
etag
lastModified
bodyBytes
rawHash
observationTime
aggregationWindowStart
aggregationWindowEnd
providerReceiptTime
providerPublicationTime
embeddedDisplayTime
firstSeenAt
temperatureC
qualityFlags
reportType
revisionOf
```

Keep these intervals separate:

- sensor sample interval;
- averaging/calculation window;
- source output interval;
- file/screen generation interval;
- provider publication interval;
- relay/cache delay;
- client discovery delay;
- network request duration; and
- poll/cron interval.

Poll conservatively, use cache validation, add small jitter when appropriate,
and share backend cooldowns between cron and manual refresh. A one-minute cron
is not evidence of a one-minute source.

Analyze:

- consecutive observation-time and body-change deltas;
- latency distributions, not a single fastest sample;
- missing expected slots and delayed batches;
- duplicate/stuck values and stale embedded clocks;
- corrections and same-time body revisions;
- clock skew between embedded and HTTP times;
- request failures, throttling, cache anomalies, and partial writes;
- day/night, weather-event, and runway differences; and
- changes across UTC/date/month boundaries.

Preserve the first time this application saw an immutable report. A provider
receipt field can itself change for the same raw report.

## Phase 10: prove sensor and field provenance

For every candidate series, try to obtain:

- station and field IDs;
- physical site name and role, such as TDZ, midpoint, runway end, MET garden,
  rooftop, or airport reference;
- verified latitude, longitude, elevation, sensor height, and exposure;
- sensor manufacturer, model, serial/asset family, logger, and software path;
- calibration, maintenance, and quality-control status;
- native sample and aggregation interval;
- measurement accuracy and numeric/display resolution;
- rounding and unit-conversion rules;
- raw versus validated values and validity flags;
- fallback/substitution behavior; and
- the mapping from sensor to logger, central system, display, report, and API.

Keep nearby stations separate. Distance does not make a personal, municipal,
university, or rooftop sensor the airport thermometer. Preserve each candidate
individually; do not average unrelated sources into a synthetic “airport”
series.

## Phase 11: compare a fast source with official reports honestly

An agreement study can reveal gross OCR, clock, or provenance problems. It
cannot by itself prove calibration or that both products use the same sensor.

Pre-register:

- the official source and report types;
- the comparison anchor;
- before/after window;
- same-sensor/runway rule;
- stale/future rejection thresholds;
- temperature field;
- precision-aware tolerance;
- correction/deduplication rule;
- minimum sample size; and
- headline and diagnostic metrics.

Publication time is often unavailable. Use the provider's initial receipt time
as an explicitly named proxy and keep observation-time analysis separate. Do
not substitute the METAR observation time when answering “what did the live
source show when the report became available?”



Separate capabilities when they create different risk:

```text
<PROVIDER>_<AIRPORT>_<SOURCE>_ACCESS_APPROVED
<PROVIDER>_<AIRPORT>_<SOURCE>_RETENTION_APPROVED
<PROVIDER>_<AIRPORT>_<SOURCE>_DERIVATION_APPROVED
<PROVIDER>_<AIRPORT>_<SOURCE>_REPUBLICATION_APPROVED
<PROVIDER>_<AIRPORT>_<SOURCE>_DECRYPTION_APPROVED
<PROVIDER>_<AIRPORT>_<SOURCE>_PERSISTENT_SESSION_APPROVED
```

Only define the gates actually needed. Credentials and cryptographic material
remain separate secrets.

Convex must be the server-side source of truth. Only exact `true` enables a
protected capability. Check before queueing, at worker start, immediately
before the external request or side effect, before storing, and before every
protected read/export. Crons, manual actions, retries, HTTP routes, and queued
work must enforce the same gate. Deploy disabled first and activate only after
the named authority approves the documented scope.

## Phase 13: design the smallest safe collector

A collector should include:

- an allowlist of exact origins, paths, station IDs, and redirects;
- descriptive user agent and provider contact when appropriate;
- server-side approval checks;
- shared cooldown, lock, retry budget, timeout, and size limits;
- conditional requests and bounded lookback;
- strict content, schema, station, time, unit, and range validation;
- content-addressed dedupe and immutable first-seen time;
- explicit correction/version handling;
- raw provenance separate from normalized query rows;
- status/error records that do not leak secrets;
- retention cleanup and revocation behavior;
- fixtures/mocks for approval-disabled development; and
- an honest unavailable/setup/approval-required UI state.

If only the latest raw image is needed, retain one validated storage object per
source identity and atomically replace/delete it. Historical extracted rows can
remain auditable without creating a raw-image archive. Never expose permanent
storage bearer URLs when a gated, no-store proxy is required.

The page must keep official reports, live local displays, nearby stations, and
forecasts visually and semantically separate. Do not let a fallback inherit a
label or approval from the primary source.

## Advanced techniques for future investigations

These are additional methods.

### Public-client code analysis

- Parse linked JavaScript with an AST to locate URL construction, field maps,
  polling intervals, worker messages, and opaque product IDs.
- Inspect publicly linked source maps.
- Inspect service-worker caches and precache manifests referenced by the
  application.
- Compare two official app/site versions to isolate newly added hosts, routes,
  fields, or station identifiers.
- Follow GraphQL/OpenAPI/WSDL links.

### Geospatial and numerical viewers

- Capture ArcGIS/GeoServer/OGC layer URLs from the viewer rather than scanning
  service directories.
- Validate `GetCapabilities` or metadata documents.
- Confirm coordinate order with a known control point.
- Inspect NetCDF/HDF5/GRIB/BUFR metadata, quality flags, projections, scale,
  fill, and algorithm documentation before extracting a value.
- Test whether a numerical file lags its preview image and resolve several
  recent candidates safely.

### Time and change forensics

- Estimate stable clock skew by regressing embedded timestamps against first
  seen and HTTP metadata across many changes.
- Use change-point histograms to separate fixed cadence, delayed batches, and
  event-driven updates.
- Use body hashes plus perceptual hashes to distinguish recompression from
  actual screen changes.
- Build a cross-source event timeline around routine METAR and SPECI arrivals
  without claiming causality from temporal order alone.
- Measure source behavior on quiet and severe-weather days; event paths often
  differ from routine paths.

### Document and archive forensics

- Extract embedded attachments and OLE/package objects.
- Compare tender, award, amendment, payment, and closeout versions as a
  document graph.
- Search scanned opening-act screenshots and attachment lists for the exact
  names and sizes of omitted proposals.
- Preserve a hash manifest and, where terms permit, a WARC/HAR evidence capture
  so future reviewers can reproduce a public web flow after it changes.
- Use archive history to establish lineage, then verify every current endpoint
  through the owner.

### Package and protocol analysis

- Compare official APK/IPA versions and signing identities.
- Trace serializers and model fields to distinguish observations from alerts,
  images, preferences, and administrative operations.
- Identify MQTT topics, WebSocket paths, Firebase projects, push extensions,
  and remote configuration statically.
- Treat all decoded network fields as untrusted; bound size, nesting, count,
  URL handling, and rendered content.

### Sensor-quality diagnostics

- Detect stuck sensors, impossible steps, repeated frames, and time reversal.
- Compare current versus rolling/averaged fields without merging them.
- Stratify agreement by sensor position, wind regime, precipitation, day/night,
  report type, and temperature range.
- Compute missingness and availability separately from accuracy.
- Investigate sustained signed bias.


## Brazil and Argentina kickoff worksheet

Do not begin with a guessed API. Fill this worksheet from current official
sources for the selected airport:

| Question                            | Answer/evidence |
| ----------------------------------- | --------------- |
| Airport, ICAO, IATA, coordinates    |                 |
| Current AIP/AIS publisher           |                 |
| Air navigation service provider     |                 |
| Aviation MET service provider       |                 |
| Airport operator/concessionaire     |                 |
| National weather/open-data provider |                 |
| Airport MET office/service hours    |                 |
| Runways and declared sensor sites   |                 |
| Official METAR/SPECI relay          |                 |
| AWOS/AMOS/ASOS vendor and contract  |                 |
| Commissioning/acceptance evidence   |                 |
| Public viewer/app/manual            |                 |
| Supported export/API contact        |                 |
| Access/retention/reuse terms        |                 |

Useful Portuguese search vocabulary for Brazil includes:

```text
meteorologia aeronáutica
estação meteorológica automática
sistema automático de observação meteorológica
AWOS AMOS ASOS EMS-A
dados meteorológicos aeroporto
edital licitação termo de referência adjudicação
aceite comissionamento entrada em operação
manual operação interface histórico exportação API
```

Useful Spanish search vocabulary for Argentina includes:

```text
meteorología aeronáutica
estación meteorológica automática
sistema automático de observación meteorológica
AWOS AMOS ASOS
datos meteorológicos aeropuerto
licitación pliego adjudicación contrato
acta de recepción aceptación puesta en servicio
manual interfaz histórico exportación API
```

Query templates should combine the exact ICAO, airport name, provider domain,
system type, and procurement/commissioning term. Examples:

```text
"<ICAO>" (AWOS OR AMOS OR "estação meteorológica automática")
"<airport name>" (edital OR licitação OR "termo de referência") AWOS
"<ICAO>" (AWOS OR "estación meteorológica automática")
"<airport name>" (licitación OR pliego OR "acta de recepción") AWOS
site:<official-domain> "<ICAO>" (manual OR API OR histórico OR datos)
```

Search in the local language and English, preserve accents and unaccented
variants, and try old and new runway designators. Verify current agency and
operator responsibilities at research time rather than hard-coding a country
assumption into the collector.

## Standard evidence tables

### Candidate matrix

| Candidate | Owner | Airport/sensor identity | Native cadence | Delivery cadence | Precision | Freshness | Permission | Decision |
| --------- | ----- | ----------------------- | -------------- | ---------------- | --------- | --------- | ---------- | -------- |
|           |       |                         |                |                  |           |           |            |          |

### Endpoint record

```text
sourceName:
discoveryMethod:
ownerPage:
exactUrlOrInterface:
stationParameters:
authentication:
method:
requestHeaders:
responseType:
redirectPolicy:
documentedRate:
measuredRate:
termsOrApproval:
researchDate:
decision:
```

### Artifact manifest

```text
canonicalUrl
retrievedAtUtc
httpStatus
contentType
contentLength
lastModified
etag
sha256
localPurpose
sourceAuthority
pageOrSectionUsed
```

Do not put credentials, approval evidence into the repository.

### Negative-result record

```text
candidate
whyItLookedPromising
exactChecksPerformed
boundedScope
evidenceFound
whyRejectedOrBlocked
whatNewEvidenceWouldReopenIt
researchDate
```

## Decision gates

Use this order:

1. **Identity:** Is it unquestionably the intended airport/site/field?
2. **Semantics:** Is it a real observation with known time, unit, and
   aggregation?
3. **Quality:** Are precision, validity, and failure behavior usable?
4. **Cadence:** Does the payload—not the poller—meet the need?
5. **Freshness:** Is delivery consistently useful?



### Durable-state rule

Temporary downloads, decompilation trees, rendered PDF pages, release copies,
screenshots, and bounded probe artifacts are disposable. Before deleting them,
move all durable conclusions into the airport source document or this
playbook:

- canonical URLs;
- retrieval dates;
- hashes and sizes for decisive artifacts;
- exact page/section references;
- measured timings and request method;
- station/sensor identity limits;
- negative results;
- approval state; and
- precise evidence that would reopen a blocked lead.

The operating-system Temp directory must never be the only copy of a research
conclusion. It should also never become an undeclared raw-data archive.

## Final handoff checklist

- [ ] Airport identity and timezone verified.
- [ ] Authority/source map completed.
- [ ] Official report baseline captured.
- [ ] Owner web/app flow inspected without guessing.
- [ ] Hostname provenance recorded.
- [ ] Manuals/procurement/commissioning chain checked.
- [ ] App packages, if relevant, inspected statically first.
- [ ] Image/binary payload validated by content and embedded metadata.
- [ ] Sensor provenance and coordinate limitations documented.
- [ ] Cadence and latency measured separately over a bounded window.
- [ ] Revisions, gaps, stale data, and update races tested.
- [ ] Agreement method pre-registered and sample size visible.
