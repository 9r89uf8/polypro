# Polymarket Chainlink v6 Oracle Notes

## Purpose

Capture the current findings about Polymarket's Chainlink-based short crypto markets, the newer Polygon oracle path, and what is and is not visible onchain.

## Main Market Example

Primary market used for tracing:

- `btc-updown-15m-1763139600`
- Gamma API:
  - `https://gamma-api.polymarket.com/markets?slug=btc-updown-15m-1763139600`

Observed market fields:

- `id=680768`
- `conditionId=0x8db249916688b7f8f353fae4f3a2a805c037c2e890f7c38614d3be10205e631c`
- `questionID=0x9211ce99e0a22ad39ce4bb3224e3c67eea8ecc41855c037d86505dd855439015`
- `resolutionSource=https://data.chain.link/streams/btc-usd`
- `automaticallyResolved=true`
- `endDate=2025-11-14T17:15:00Z`
- `umaEndDate=2025-11-14T17:15:38Z`

Chainlink page named in the market rules:

- `https://data.chain.link/streams/btc-usd`

Important Chainlink page finding:

- the public page is delayed and informational
- it identifies a concrete product/feed:
  - `BTC/USD-RefPrice-DS-Premium-Global-003`
  - feed id `0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8`

## Old Adapter vs New Oracle

Published Polymarket UMA adapter repo:

- `https://github.com/Polymarket/uma-ctf-adapter`

Old published Polygon adapter addresses from releases:

- `0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49`
- `0x71392E133063CC0D16F40E1F9B60227404Bc03f7`
- `0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74`
- `0xB97455fcF78eb37375e8be6f26df895341CA073d`
- `0xCB1822859cEF82Cd2Eb4E6276C7916e692995130`

Key finding:

- the Chainlink BTC 15m market's public Gamma `questionID` did not resolve through the old adapter `getQuestion(...)` path
- the actual resolution path for these markets is a newer oracle:
  - `0x58e1745bedda7312c4cddb72618923da1b90efde`

Oracle page:

- `https://polygonscan.com/address/0x58e1745bedda7312c4cddb72618923da1b90efde`

Important access note:

- the v6 oracle contract page showed as `Contract: Unverified`
- the behavior below was derived from:
  - live Polygon RPC calls
  - transaction inputs
  - emitted logs
  - bytecode selector inspection

## Conditional Tokens Path

Conditional Tokens contract:

- `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
- `https://polygonscan.com/address/0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`

Resolution tx for the main BTC market:

- `https://polygonscan.com/tx/0x57d567a9063b13702e6796e011b4659ded7228e8d5581dfc8f0678a6c291ceae`

Observed facts from that tx:

- caller to oracle:
  - `0xe01e9668062a225cb1ea7d6e52f890cacf5e3d7d`
- oracle method:
  - `reportPayouts(bytes32,uint256[])`
- internal id in tx input:
  - `0x96c512e3351bbaaf483bcd26582efae832dfc97eff40ae663d1cc73c562abb50`
- CTF `ConditionResolution` event in the same tx used:
  - `conditionId=0x8db249916688b7f8f353fae4f3a2a805c037c2e890f7c38614d3be10205e631c`
  - `questionId=0x9211ce99e0a22ad39ce4bb3224e3c67eea8ecc41855c037d86505dd855439015`
  - `payoutNumerators=[0,1]`

Conclusion:

- the tx input bytes32 is not the public Gamma `questionID`
- the oracle maps an internal id into the public CTF/Gamma question id

## Mapping Rule

The v6 oracle exposes a public helper with selector:

- `0x11b2bdca`

Observed behavior from live `eth_call` against Polygon RPC:

- helper input:
  - reporter address
  - internal bytes32 id
- helper output:
  - public CTF/Gamma `questionID`

Main BTC proof:

- reporter:
  - `0xe01e9668062a225cb1ea7d6e52f890cacf5e3d7d`
- internal id:
  - `0x96c512e3351bbaaf483bcd26582efae832dfc97eff40ae663d1cc73c562abb50`
- helper result:
  - `0x9211ce99e0a22ad39ce4bb3224e3c67eea8ecc41855c037d86505dd855439015`

Additional cross-checks:

- ETH example:
  - reporter `0x12a410014270f03488e6a43cab6243f01ff222c0`
  - internal id `0xb544fbb395cde04d3e1bb30d5ea47d1f330fd0ec37cd231e70fbfcad42a9dc28`
  - helper result `0x058b9e5e38baa4f8c2438f314adfcf518a45e32b2a8ca92e02bddf0df1cc59f6`
- adjacent BTC example:
  - reporter `0xe01e9668062a225cb1ea7d6e52f890cacf5e3d7d`
  - internal id `0xb04952329efa15e5b7f52d5898d464d8978c796a69799e7c1386ff748366f40c`
  - helper result `0x5e734d16eeb25c046b43042cf1fca43222bb5d460b92c6f086dba5b63ac1bb0f`

Best interpretation:

- `public questionId = helper(reporter address, internal id)`
- the internal id is reporter-scoped

## Onchain Creation Path

The same market was prepared onchain one day earlier with the public question id already in place.

Prepare tx:

- `https://polygonscan.com/tx/0x2a88f55837a0e45f51bd068dfe18e296233c47c1257b3e1a54ec7c84adf4bd53`

Observed facts:

- block timestamp:
  - `2025-11-13 17:03:42Z`
- caller:
  - `0xe01e9668062a225cb1ea7d6e52f890cacf5e3d7d`
- target:
  - Conditional Tokens `0x4D97...`
- selector:
  - `0xd96ee754`
- 4byte label:
  - `prepareCondition(address,bytes32,uint256)`
- tx args:
  - oracle `0x58e1745bedda7312c4cddb72618923da1b90efde`
  - public question id `0x9211ce99e0a22ad39ce4bb3224e3c67eea8ecc41855c037d86505dd855439015`
  - outcome slot count `2`

Key consequence:

- the internal id did not appear onchain at condition preparation time
- only the public question id appeared onchain

Best interpretation:

- the internal id is likely an offchain resolver key
- it is not the CTF condition id
- it is not the public question id

## Adjacent BTC And ETH 15m Batch

Batch window checked around `2025-11-14 16:45Z` through `17:45Z`.

BTC markets:

- `btc-updown-15m-1763137800`
  - market id `680641`
  - public qid `0x8844ece3...`
  - reporter `0xe01e9668...`
  - internal id `0xb61ac13d...`
  - resolved `2025-11-14 16:45:38Z`
- `btc-updown-15m-1763138700`
  - market id `680658`
  - public qid `0x5e734d16...`
  - reporter `0xe01e9668...`
  - internal id `0xb0495232...`
  - resolved `2025-11-14 17:00:36Z`
- `btc-updown-15m-1763139600`
  - market id `680768`
  - public qid `0x9211ce99...`
  - reporter `0xe01e9668...`
  - internal id `0x96c512e3...`
  - resolved `2025-11-14 17:15:38Z`
- `btc-updown-15m-1763140500`
  - market id `680778`
  - public qid `0xaa7c9f2e...`
  - reporter `0xe01e9668...`
  - internal id `0xe9afb012...`
  - resolved `2025-11-14 17:30:42Z`
- `btc-updown-15m-1763141400`
  - market id `680792`
  - public qid `0x002c3ec4...`
  - reporter `0xe01e9668...`
  - internal id `0x0dd1d5d6...`
  - resolved `2025-11-14 17:45:38Z`

ETH markets:

- `eth-updown-15m-1763137800`
  - market id `680638`
  - public qid `0xe5a6b0fa...`
  - reporter `0x12a41001...`
  - internal id `0x1910910c...`
  - resolved `2025-11-14 16:45:38Z`
- `eth-updown-15m-1763138700`
  - market id `680657`
  - public qid `0xde38c98f...`
  - reporter `0x12a41001...`
  - internal id `0x42c44be7...`
  - resolved `2025-11-14 17:00:38Z`
- `eth-updown-15m-1763139600`
  - market id `680766`
  - public qid `0x058b9e5e...`
  - reporter `0x12a41001...`
  - internal id `0xb544fbb3...`
  - resolved `2025-11-14 17:15:36Z`
- `eth-updown-15m-1763140500`
  - market id `680779`
  - public qid `0x60af956e...`
  - reporter `0x12a41001...`
  - internal id `0x70ad65bf...`
  - resolved `2025-11-14 17:30:40Z`
- `eth-updown-15m-1763141400`
  - market id `680793`
  - public qid `0xae1fdf51...`
  - reporter `0x12a41001...`
  - internal id `0xb18f3963...`
  - resolved `2025-11-14 17:45:36Z`

Observations from the batch:

- BTC and ETH used different reporter addresses on the same oracle
- within one asset, adjacent internal ids did not look monotonic or timestamp-like
- adjacent internal ids also did not look close to adjacent market ids
- resolution timing was tightly clustered around market end plus about `36-40 seconds`

Best interpretation:

- there are likely separate offchain resolver jobs or worker lanes per asset
- the internal id likely belongs to the offchain resolver system, not to the public market metadata

## Selector Notes

4byte matches that aligned with observed bytecode behavior:

- `0x24d7806c` -> `isAdmin(address)`
- `0x70480275` -> `addAdmin(address)`
- `0x8bad0c0a` -> `renounceAdmin()`
- `0xc49298ac` -> `reportPayouts(bytes32,uint256[])`
- `0xd96ee754` -> `prepareCondition(address,bytes32,uint256)`

Observed but unlabeled selectors in the v6 oracle:

- `0x11b2bdca`
  - public helper used to derive public question ids from `(reporter, internal id)`

## Current Best Read

What is now strongly supported:

- Chainlink short crypto markets are not resolved through the old public UMA adapter path alone
- they use a newer Polygon oracle contract at `0x58e174...`
- the market's public `questionID` is prepared on CTF before the market window
- the internal bytes32 id only appears later at oracle resolution time
- the public question id is derived from `(reporter, internal id)`
- reporter addresses appear to split by asset family in the sampled BTC vs ETH batch

What is still unknown:

- whether the internal id is derived from:
  - Chainlink report bytes
  - a market slug
  - a Polymarket market id
  - an internal automation job id
- the verified source code of the v6 oracle, since the Polygonscan page showed as unverified

## Best Next Dig

If this investigation resumes later, the best next steps are:

- trace the reporter addresses `0xe01e9668...` and `0x12a41001...` across more assets and time ranges
- see whether reporter segregation is asset-specific, template-specific, or environment-specific
- compare more markets to test whether internal ids correlate with any visible offchain field
- look for another public artifact that names the v6 oracle contract or its resolver service

## Sources

- Gamma market JSON:
  - `https://gamma-api.polymarket.com/markets?slug=btc-updown-15m-1763139600`
- Chainlink stream page:
  - `https://data.chain.link/streams/btc-usd`
- Old adapter repo:
  - `https://github.com/Polymarket/uma-ctf-adapter`
- v6 oracle:
  - `https://polygonscan.com/address/0x58e1745bedda7312c4cddb72618923da1b90efde`
- Conditional Tokens:
  - `https://polygonscan.com/address/0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
- Main prepare tx:
  - `https://polygonscan.com/tx/0x2a88f55837a0e45f51bd068dfe18e296233c47c1257b3e1a54ec7c84adf4bd53`
- Main resolution tx:
  - `https://polygonscan.com/tx/0x57d567a9063b13702e6796e011b4659ded7228e8d5581dfc8f0678a6c291ceae`
- 4byte selector references:
  - `https://www.4byte.directory/api/v1/signatures/?hex_signature=0xc49298ac`
  - `https://www.4byte.directory/api/v1/signatures/?hex_signature=0xd96ee754`
  - `https://www.4byte.directory/api/v1/signatures/?hex_signature=0x24d7806c`
  - `https://www.4byte.directory/api/v1/signatures/?hex_signature=0x70480275`
  - `https://www.4byte.directory/api/v1/signatures/?hex_signature=0x8bad0c0a`
- Polygon RPC used for live verification:
  - `https://1rpc.io/matic`
