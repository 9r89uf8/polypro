# Seoul Polymarket market data

Researched and implemented October 29, 2026. This module reads the current
Seoul/Incheon daily-temperature event and its YES order books. It contains no
order placement, wallet access, signing, private API credentials, or account
actions. Deployment and approval activation are separate from this change.

The code, schema, and schedules were deployed to the hosted application's
`striped-chipmunk-763` backend with all four Seoul flags absent. Production
checks returned `configured: false`, `access_approval_required`, no event or
quotes, and `queued: false`; the snapshot table was empty. No approval was
activated. Frontend deployment `dpl_2mHFCWpuBBiXiSTu1GsTBCdUuqx8` reached
`READY` on October 29, 2026. At 11:48 KST, the live page displayed
`Market access approval required`; desktop and 390-pixel mobile views had
no horizontal overflow or browser console errors. The existing temperature,
cloud, and sunlight sections remained usable.

## Current contract and settlement source

The [October 29 event](https://polymarket.com/event/highest-temperature-in-seoul-on-october-29-2026)
is event `1264074` in series `10742`, `seoul-daily-weather`, with eleven buckets
from 9°C-or-below through 19°C-or-higher. The
[October 30 event](https://polymarket.com/event/highest-temperature-in-seoul-on-october-30-2026)
is event `1270157`, with eleven buckets from 12°C-or-below through 22°C-or-higher.
These are observed contracts, not permanently fixed bucket boundaries.

The current rules use **RKSI routine observations from Aviation Weather
Center**. SPECI reports are excluded. A routine report's eight-digit `T` remark
supplies tenths when present; otherwise its body temperature supplies whole
degrees. The maximum qualifying value is rounded to the nearest integer,
with ties toward positive infinity, before selecting a bucket. Observation
dates use station local time, KST for RKSI. AMOS minute temperatures do not
directly settle this contract.

The first following-day routine report or the following-day 23:59 ET deadline
normally determines the resolution read. Weather Underground is a fallback
only when AWC has no qualifying routine temperature by that deadline. The
rules also specify correction treatment, a lowest-bucket no-data fallback,
and an exceptional correction/clarification process.

Primary records:

- [October 29 Gamma metadata and complete rules](https://gamma-api.polymarket.com/events/slug/highest-temperature-in-seoul-on-october-29-2026)
- [October 30 Gamma metadata and complete rules](https://gamma-api.polymarket.com/events/slug/highest-temperature-in-seoul-on-october-30-2026)
- [AWC source named by the October 29 contract](https://aviationweather.gov/api/data/metar?ids=RKSI&format=raw&date=2026-10-29T18:00:00Z&hours=30)

The original Gamma responses and the small CLOB research sample are saved
privately under the repository's ignored `tmp/seoul-polymarket-research-2026-10-29/`
directory. They are not committed fixtures. No credentials or approval evidence
are included in this document.

## Rule-change protection

Both researched dates have the same SHA-256 after replacing their explicit
observation-date phrase and AWC query date with placeholders and normalizing
whitespace:

```text
07dfa801b7849b13e801b1c9c07f4fab5addb104b8fb5014603104fb63c992f6
```

The collector requires this reviewed template, the requested KST date, the
exact Seoul event slug, series ID and slug, the matching date-specific AWC
RKSI URL, and matching rules on every constituent market. It validates a
contiguous partition with one lower tail, integer buckets, and one upper
tail, plus unique binary YES/NO assets and condition IDs. Current CTF/v1
identities are supported; V2 position-ID mappings require a separate review.

Unreviewed wording, source changes, or market versions cannot silently inherit
the old settlement interpretation. An unrecognized template produces
`unsupported_rules`, retains approved metadata only, and makes no CLOB calls.
Invalid date/series/asset identity is an error. A future legitimate wording
change needs a fresh complete-rule review before updating the fingerprint.

## Collection and clocks

The official [event-by-slug endpoint](https://docs.polymarket.com/api-reference/events/get-event-by-slug)
provides discovery. The official
[bulk order-book read](https://docs.polymarket.com/api-reference/market-data/get-order-books-request-body)
and [bulk last-price read](https://docs.polymarket.com/api-reference/market-data/get-last-trade-prices-request-body)
use POST request bodies containing only reviewed public YES asset IDs. These
POSTs retrieve data; they do not submit orders. Public market-data interfaces
need no trading authentication. The broader
[pricing guide](https://docs.polymarket.com/market-data/prices-order-books)
distinguishes order books, last trades, and V2 position identifiers.

After the relevant gates are enabled, the deployed schedule is one poll per
minute. A poll makes one exact-date Gamma request, followed by at most two
parallel CLOB reads. It never searches all markets or visits a returned URL.
The hosts and paths are fixed; redirects are rejected. Each response is
limited to 2 MiB and 20 seconds. At most 32 temperature markets are accepted.
A 90-second run-owned lease and one queue attempt per UTC minute prevent
overlapping or duplicate snapshots. A stale worker cannot finish a newer run.

Each accepted snapshot preserves:

- The complete approved event rules and fingerprint, event/market/asset IDs,
  bucket boundaries, source URL, and exact normalized decimal prices/sizes.
- Separate Gamma, book, and last-price request-start and response-receipt clocks.
- Each book's provider snapshot timestamp, independently of receipt time.
- `polledAt`, the latest completed endpoint receipt, and `firstSeenAt`, the
  database insertion clock. Neither is a trade-execution or price-change time.

The public query is today-only. Both a book's provider timestamp and its
receipt must be no more than three minutes old and not in the future before
bid/ask values are shown. Fresh HTTP receipt cannot refresh an old cached
book. Per-row age checks are repeated on reads, and the browser also ages
data between writes. Crossed books, wrong-token books, duplicate identities,
and malformed levels fail closed. Zero-sized levels are not executable depth.

Last-trade prices have no execution timestamp in this endpoint. A recent
receipt only confirms the state returned by that request. Missing entries are
unavailable; they do not prove that no trade occurred. The documented
half-price/empty-side sentinel also does not become a fabricated trade.
Gamma prices remain separately named metadata and never replace a missing
bid, ask, or last trade.

In the bounded October 29 probe at 02:34:42 UTC, two book timestamps preceded
receipt by approximately 11.8 and 4.35 seconds. The last-price batch requested
two assets but returned only the traded 13°C asset. The 9°C-or-below asset was
omitted. The implementation therefore accepts an independently valid book
while leaving an omitted last trade null. This is one observed response,
not a guarantee of all provider omission behavior.

Snapshots are immutable and retained for fourteen days. An hourly
database-only cleanup removes at most 256 expired rows per invocation, enough
to exceed normal one-minute insertion volume. The cleanup remains available
after revocation. No public history endpoint, same-price trade reconstruction,
or sub-minute reaction-time claim is provided by this module.

## Approval and operational boundaries

The [current Polymarket terms](https://polymarket.com/tos), particularly the
data clauses in section 2, distinguish ordinary public access from use by
capital-market clients and market-data distributors, and restrict specified
redistribution without written agreement. Public technical access does not
establish the project's entity classification or redistribution rights.
The existing Mexico implementation separately gates access, retention, and
publication; those MMMX flags are not treated as proof of RKSI scope.

This isolated Seoul module preserves those boundaries until the applicable
RKSI scope is confirmed. The approving authority is Polymarket/the relevant
Polymarket or ICE data-licensing authority for the user's entity and use.
The project contact recorded in the existing investigation is
`data-licensing@polymarket.com`; confirm the current channel through the
provider. Scope must cover one-minute Gamma/CLOB reads, the retained fields
and fourteen-day period, derived display, and the intended public audience.
This does not assert that every retail reader requires an institutional data
license.

All four server-side Convex values must be the exact string `true` for public
display. Credentials, a client-side variable, an operational switch, and a
successful request do not substitute for scope confirmation:

| Flag | Boundary |
| --- | --- |
| `POLYMARKET_RKSI_COLLECTION_ENABLED` | Reversible operational switch for collection and display |
| `POLYMARKET_RKSI_DATA_ACCESS_APPROVED` | Approved RKSI API consumption |
| `POLYMARKET_RKSI_DATA_RETENTION_APPROVED` | Approved retained snapshots and derived data |
| `POLYMARKET_RKSI_DATA_PUBLIC_APPROVED` | Approved public display |

Access, retention, and the operational switch gate queueing, state reads,
every network request/response stream, post-fetch processing, and the final
storage mutation. Public reads additionally require publication approval and
return before reading retained rows when any required gate is closed. A
revocation during a queued or active job discards the protected payload; the
lease expires naturally. Deletion-only retention work remains permitted.

Protected entry points are `seoulPolymarket:queueScheduledRefresh`,
`seoulPolymarket:collectMarket`, `seoulPolymarket:getPollState`,
`seoulPolymarket:finishPoll`, the internal `fetchPublicJson` request boundary,
and `seoulPolymarket:getDashboard`. The only public function is the read query.
`seoulPolymarket:pruneExpiredSnapshots` only deletes expired records.

Deploy code/schema/schedules with the flags absent and verify the disabled
query before activation. This implementation has not set or removed any
flag. After the user confirms the required authority and scope, the active
replacement deployment is selected explicitly:

```text
npx convex env set POLYMARKET_RKSI_DATA_ACCESS_APPROVED true --deployment-name striped-chipmunk-763
npx convex env set POLYMARKET_RKSI_DATA_RETENTION_APPROVED true --deployment-name striped-chipmunk-763
npx convex env set POLYMARKET_RKSI_DATA_PUBLIC_APPROVED true --deployment-name striped-chipmunk-763
npx convex env set POLYMARKET_RKSI_COLLECTION_ENABLED true --deployment-name striped-chipmunk-763
```

Stop collection and display, or revoke the relevant capabilities:

```text
npx convex env remove POLYMARKET_RKSI_COLLECTION_ENABLED --deployment-name striped-chipmunk-763
npx convex env remove POLYMARKET_RKSI_DATA_PUBLIC_APPROVED --deployment-name striped-chipmunk-763
npx convex env remove POLYMARKET_RKSI_DATA_RETENTION_APPROVED --deployment-name striped-chipmunk-763
npx convex env remove POLYMARKET_RKSI_DATA_ACCESS_APPROVED --deployment-name striped-chipmunk-763
```

The deployment is classified as development by the local CLI while backing
the current hosted application. Do not substitute `--prod` without confirming
the intended target. No broader Polymarket approval was established by this
research, and none was inferred from the user's request to add the feature.

## Implementation and verification

- `convex/seoulPolymarket.js`: bounded collection, leases, immutable storage,
  public query, and deletion-only retention.
- `convex/lib/seoulPolymarket.js`: KST date selection, event/rule/asset
  validation, and Seoul quote construction. It reuses the existing tested
  decimal, order-book, and last-trade normalizers from
  `convex/mexicoPolymarketLive.js` without calling Mexico collectors or gates.
- `convex/lib/seoulPolymarketSchema.js`: shared validators and the
  `seoulPolymarketTables` schema entries.
- `test/seoulPolymarket.test.mjs`: fixture-only parser, transport, permission,
  revocation, timing, lease, stale-quote, and cleanup checks.

Schema integration imports and spreads `seoulPolymarketTables`. The registered
`seoul_polymarket_every_minute` job targets
`internal.seoulPolymarket.queueScheduledRefresh` every minute. The
`seoul_polymarket_retention_hourly` job invokes
`internal.seoulPolymarket.pruneExpiredSnapshots` at minute `:17` each hour.
Code deployment has been verified; production data access remains disabled.

Eighteen tests passed during implementation, followed by a read-only parse of
the private October 29/30 Gamma captures and the two-asset CLOB capture. Both
events matched the reviewed fingerprint and eleven-bucket identity checks.
No automated test contacts Polymarket or performs a trade.

The combined market/backend and dashboard-helper run passed 49 tests, and
two existing Seoul schema checks passed after integration. The Convex schema
deployment and Vercel production build also passed. No live production quote
collection was claimed or attempted while its approval gates were absent.

An additional local browser fixture exercised the actual `SeoulMarket`
component, quote formatter and CSS module with eleven clearly labeled
synthetic outcomes. Desktop (1440 px) and mobile (390 px) checks covered
missing values, zero and 100 cents, fractional and long exact decimal prices,
one-sided books and last-trade-only rows. Horizontal overflow stayed inside
the scrollable table; all outcomes remained reachable. Stale, unverified-rule,
source-error and approval states removed every quote row. The fixture used
local assets only and blocked external connections. This validates rendering
behind the gate; it is not a live Polymarket collection or permission test.
