# Chainlink BTC/USD Data Stream — Source Investigation

Verified against public sources on March 25, 2026.

## Stream identity

- Product: `BTC/USD-RefPrice-DS-Premium-Global-003`
- Type: crypto mid-price reference stream
- Calculation: DON consensus median of LWBA (liquidity-weighted bid-ask) mid-prices
- The displayed chart on data.chain.link is delayed / informational only

## Three-layer aggregation architecture

Chainlink's own blog describes the system:

- **Layer 1 — Data Source Aggregation**: professional data aggregation firms
  (CoinGecko, CryptoCompare, Kaiko, etc.) fetch raw market data from hundreds of
  exchanges, apply VWAP, outlier removal, volume weighting
- **Layer 2 — Node Operator Aggregation**: each oracle node queries multiple
  independent data aggregators via external adapters, takes the **median**
- **Layer 3 — Oracle Network Aggregation**: responses from all nodes are
  aggregated by taking the median; a quorum must sign the report

For Data Streams specifically, the product description says it uses **"3+ crypto
price aggregators and/or market-data vendors using CEX order-book data"** to
produce bid/ask and mid values.

## Oracle operators on this stream

The 16 operators listed for `BTC/USD-RefPrice-DS-Premium-Global-003`:

| Operator | Type | Notes |
| --- | --- | --- |
| **Chainlink Labs** | Core team + operator | Develops the adapter framework |
| **Tiingo** | Data provider AND operator | 40+ exchanges, VWAP/LWBA endpoints |
| **Galaxy** | Data provider AND operator | Galaxy Digital; acquired CryptoManufaktur (node operator since 2020) in Jul 2024 |
| **Kaiko** | Data provider AND operator | Tick-level data from 100+ exchanges; node operator since 2019 |
| **DexTrac** | Infrastructure operator | US-based, supports 18 Data Streams across 15 chains |
| **Chainlayer** | Infrastructure operator | |
| **Fiews** | Infrastructure operator | |
| **Inotel** | Infrastructure operator | |
| **LinkForest** | Infrastructure operator | |
| **LinkPool** | Infrastructure operator | Now part of Chainlink Labs |
| **LinkRiver** | Infrastructure operator | |
| **NewRoad** | Infrastructure operator | |
| **Pier Two** | Infrastructure operator | |
| **SimplyVC** | Infrastructure operator | |
| **SnzPool** | Infrastructure operator | |
| **Syncnode** | Infrastructure operator | |
| **ValidationCloud** | Infrastructure operator | |

Key distinction: most operators are pure infrastructure providers running
Chainlink node software configured with external adapter connections. Tiingo,
Galaxy, and Kaiko are unique in being both data providers AND operators.

## Confirmed upstream data aggregators / vendors

From the [external-adapters-js](https://github.com/smartcontractkit/external-adapters-js)
repository (153 source adapters, actively maintained, v1.303.0 as of March 2026)
and Chainlink's ecosystem page, these providers have confirmed Chainlink adapters
and provide BTC/USD data:

### Tier 1: Premium aggregators (confirmed Chainlink partners)

| Provider | Adapter | Transport | What it does |
| --- | --- | --- | --- |
| **CryptoCompare / CCData** | `cryptocompare` | HTTP + WebSocket | CCCAGG index, volume/spread/depth weighted, 10s updates |
| **CoinGecko** | `coingecko` | HTTP | VWAP from 9 BPI exchanges, 197+ broader; 11,000+ coin IDs |
| **Kaiko** | `kaiko` | HTTP | Spot exchange rate VWAP across exchanges, tick-level from 100+ exchanges |
| **Tiingo** | `tiingo` | HTTP + WebSocket | OHLCV, VWAP, crypto-LWBA from 40+ exchanges |
| **CF Benchmarks** | `cfbenchmarks` | HTTP + WebSocket | CME CF Bitcoin Reference Rate (BRR/BRTI) from regulated constituent exchanges |
| **Amberdata** | `amberdata` | HTTP | Order books, VWAP, OHLCV from CEXes |
| **BraveNewCoin** | `bravenewcoin` | HTTP | Weighted reference prices; explicitly named in Chainlink FAQ |
| **NCFX (NewChangeFX)** | `ncfx` | WebSocket | FCA-regulated; crypto + FX mid/bid/offer |
| **CoinMarketCap** | `coinmarketcap` | HTTP | Price, marketcap, volume |
| **Coin Metrics** | `coinmetrics` | HTTP + WebSocket | ReferenceRate at 1s frequency via streaming |
| **CoinAPI** | `coinapi` | HTTP + WebSocket | Normalized exchange data |

### Tier 2: Direct exchange adapters

| Exchange | Adapter | Transport |
| --- | --- | --- |
| **Binance** | `binance` | HTTP + WebSocket (`wss://stream.binance.com:9443/ws`) |
| **Coinbase** | `coinbase` | HTTP + WebSocket (`wss://ws-feed.pro.coinbase.com`) |
| **Deribit** | `deribit` | HTTP | Derivatives data |

### Tier 3: Institutional / market-maker providers

| Provider | Adapter | Transport | Notes |
| --- | --- | --- | --- |
| **Elwood** | `elwood` | WebSocket | Institutional crypto pricing with LWBA |
| **GSR** | `gsr` | HTTP + WebSocket | Market maker pricing with LWBA |
| **Blocksize Capital** | `blocksize-capital` | WebSocket | VWAP and LWBA |
| **Finalto** | `finalto` | WebSocket | Liquidity-weighted mid-price |
| **Wintermute** | `wintermute` | WebSocket | Market maker index pricing |
| **Galaxy Digital** | `galaxy` | HTTP | Proprietary crypto pricing |

### Tier 4: Multi-asset providers (also support crypto)

| Provider | Adapter |
| --- | --- |
| **Finage** | `finage` |
| **TwelveData** | `twelvedata` |
| **TraderMade** | `tradermade` |
| **dxFeed** | `dxfeed` |
| **Coinpaprika** | `coinpaprika` |
| **Coinranking** | `coinranking` |

The Chainlink FAQ and blog explicitly name **BraveNewCoin, CoinGecko, Kaiko,
CryptoCompare, and Amberdata** as the known set used for VWAP crypto price data.

## The physical exchanges at the bottom of the chain

### CF Benchmarks — CME CF Bitcoin Reference Rate constituent exchanges

From the CME CF Constituent Exchanges List v13.4 (February 23, 2026):

| Exchange | Added | Status |
| --- | --- | --- |
| **Bitstamp** | Nov 14, 2016 | Active |
| **Coinbase** (incl. Pro/Prime) | Nov 14, 2016 | Active |
| **itBit** (Paxos) | Nov 14, 2016 | Active |
| **Kraken** | Nov 14, 2016 | Active |
| **Gemini** | Aug 30, 2019 | Active |
| **LMAX Digital** | May 3, 2022 | Active |
| **Bullish Exchange** | Dec 30, 2024 | Active |
| **Crypto.com** | Mar 31, 2025 | Active |
| Bitfinex | Nov 14, 2016 | Suspended Apr 2017 |
| OKCoin.com (HK) | Nov 14, 2016 | Suspended Apr 2017 |

CF Benchmarks is owned by Payward Inc. (Kraken's parent company).

### CoinGecko — Bitcoin Price Index constituent exchanges

From the CoinGecko Price Aggregation Methodology v3.0 (January 26, 2026),
Appendix A:

| Exchange | BPI Tickers |
| --- | --- |
| **Binance** | BTC/USDT, BTC/USDC, BTC/EUR |
| **OKX** | BTC/USDT, BTC/USDC |
| **Coinbase** | BTC/USD, BTC/USDT, BTC/EUR |
| **Kraken** | BTC/USD, BTC/USDT, BTC/USDC, BTC/EUR |
| **Crypto.com** | BTC/USD, BTC/USDT, BTC/EUR |
| **Bitfinex** | BTC/USD, BTC/USDT, BTC/EUR |
| **Bitstamp** | BTC/USD, BTC/USDT, BTC/EUR |
| **Gemini** | BTC/USD, BTC/USDT, BTC/EUR |
| **Huobi** | BTC/USDT, BTC/USDC |

CoinGecko computes BTC price as VWAP across these tickers with MMAD outlier
detection. For the broader BTC market page, CoinGecko aggregates across 197
exchanges and 2,501 markets.

### CryptoCompare (CCData) CCCAGG

- Updates every 10 seconds
- Weights exchanges based on volume, spread, and order book depth
- Only accepts trades from exchanges trading BTC-USD directly (no cross-pair
  conversion)
- Monthly exchange review

### Kaiko

- 100+ exchanges including: Binance, Binance.US, Coinbase, Bitstamp, Bitfinex,
  Kraken, Gemini, OKX, KuCoin, Huobi
- Tick-by-tick trade data and full order book snapshots

### Tiingo

- 40+ crypto exchanges (12 with full tick-level historical data)
- Confirmed exchanges in documentation examples: Poloniex, GDAX (Coinbase Pro)
- VWAP methodology
- `includeRawExchangeData` option returns per-exchange data
- Full exchange list gated behind API key (free tier available at app.tiingo.com)

## High-confidence exchange list

Based on the union of confirmed sources across all known upstream aggregators:

**Tier 1 — Almost certainly included** (appear in multiple aggregators' BTC/USD
constituent lists):

- Binance
- Coinbase (including Coinbase Pro / Prime)
- Kraken
- Bitstamp
- Gemini

**Tier 2 — Very likely included** (appear in major aggregators):

- OKX
- Bitfinex
- Crypto.com
- LMAX Digital

**Tier 3 — Likely included** (appear in some aggregators):

- Huobi / HTX
- itBit (Paxos)
- Bullish Exchange
- KuCoin

**Tier 4 — Possibly included** (via broader aggregator coverage):

- Bybit, Gate.io, and other high-volume exchanges covered by CoinGecko (197
  exchanges) and Kaiko (100+ exchanges)

## The medianizer: how nodes combine sources

The `medianizer` composite adapter
(`packages/composites/medianizer/`) in the external-adapters-js repo:

- accepts a `sources` parameter (array of adapter names)
- queries each configured source adapter
- computes the **median** of all returned prices
- configuration is done via env vars: `[SOURCE]_ADAPTER_URL`

Each node operator independently decides which adapters to configure. The exact
per-node configuration is private.

## Data Streams vs legacy Price Feeds

The legacy BTC/USD Price Feed on Ethereum mainnet uses **31 node operators**
(different set from the 16 on Data Streams) with:

- Deviation threshold: 0.5%
- Heartbeat: 3600 seconds
- Minimum responses: 10 of 31

Data Streams is newer, higher-frequency, and may use a subset of adapters
optimized for low latency (WebSocket-based: Tiingo crypto-LWBA, NCFX WebSocket,
Coin Metrics streaming at 1s, CryptoCompare WebSocket, CF Benchmarks WebSocket).

## Coinbase DataLink integration (2025)

Coinbase announced a DataLink integration pushing order book, perps, and futures
data on-chain through Chainlink. This is a direct exchange-to-oracle path,
bypassing third-party aggregators entirely.

## What is NOT publicly disclosed

1. **Exact adapter configuration per node**: which specific adapters each of the
   16 operators has configured for this specific stream
2. **Whether Data Streams uses the same adapters as Price Feeds**: Data Streams
   may use a WebSocket-optimized subset
3. **The exact "3+ crypto price aggregators"**: most likely candidates based on
   all evidence:
   - Kaiko (institutional-grade, tick-level, confirmed partner + operator)
   - CCData/CryptoCompare (CCCAGG, confirmed adapter, WebSocket)
   - Tiingo (40+ exchanges, operator on this stream, LWBA endpoint)
   - Amberdata (order book data, confirmed partnership)
   - CoinGecko (confirmed partner, VWAP from 9 key exchanges for BPI)
4. **Galaxy Digital's specific upstream exchanges**

## Reconstructed full data flow

```
PHYSICAL EXCHANGE ORDER BOOKS (Layer 0)
================================================
Binance, Coinbase, Kraken, Bitstamp, Gemini,
OKX, Bitfinex, LMAX Digital, Crypto.com,
Bullish, itBit/Paxos, Huobi, KuCoin, etc.
         |
         | (raw order book / trade data via exchange APIs)
         v
DATA AGGREGATORS / VENDORS (Layer 1)
================================================
Each applies its own methodology:
- CoinGecko: VWAP from 9 BPI exchanges, 197+ broader
- CryptoCompare/CCData: CCCAGG, volume/spread/depth weighting, 10s
- Kaiko: tick-level from 100+ exchanges, VWAP
- Amberdata: order book + VWAP from CEXes
- BraveNewCoin: weighted reference price
- CF Benchmarks: BRR from 8 regulated exchanges
- Tiingo: VWAP/LWBA from 40+ exchanges
- NCFX: crypto feed via WebSocket
- Coinbase DataLink: direct order book data
- Galaxy Digital: proprietary crypto pricing
         |
         | (API calls via external adapters)
         v
ORACLE NODE OPERATORS (Layer 2)
================================================
16 operators, each running Chainlink node software
with 3+ adapters configured. Each node:
1. Calls multiple data aggregator APIs
2. Takes MEDIAN of returned prices
3. Submits to DON

Operators: Chainlayer, Chainlink Labs, Galaxy,
DexTrac, Fiews, Inotel, LinkForest, LinkPool,
LinkRiver, NewRoad, Pier Two, SimplyVC, SnzPool,
Syncnode, ValidationCloud, Tiingo
         |
         | (OCR protocol — Off-Chain Reporting)
         v
CHAINLINK DON CONSENSUS (Layer 3)
================================================
- Reports signed by quorum of oracle nodes
- Consensus MEDIAN price computed
- Report includes: mid price, bid, ask (LWBA)
- Sub-second delivery to Data Streams Aggregation Network
         |
         v
ON-CHAIN / OFF-CHAIN DELIVERY
================================================
BTC/USD-RefPrice-DS-Premium-Global-003
Available via Data Streams pull model
Verified on-chain when needed by dApps
```

## Next steps to get deeper

1. **Get a free Tiingo API key** at app.tiingo.com, then call
   `GET https://api.tiingo.com/tiingo/crypto?tickers=btcusd` to get the exact
   exchange list Tiingo aggregates for BTC/USD
2. **Contact Chainlink** directly to ask for the vendor/venue roster tied to
   `BTC/USD-RefPrice-DS-Premium-Global-003` (their Data Sources page says to
   contact them for detailed sourcing info)
3. **Monitor the external-adapters-js repo** for any changes to the adapter set
   or configuration patterns
4. **Check CF Benchmarks constituent list** quarterly — they update the exchange
   roster regularly (v13.4 is the latest as of Feb 2026)

## Sources

- Chainlink 3-Level Aggregation Blog:
  - `https://blog.chain.link/levels-of-data-aggregation-in-chainlink-price-feeds/`
- Chainlink External Adapters Repo:
  - `https://github.com/smartcontractkit/external-adapters-js`
- Chainlink Data Providers Ecosystem:
  - `https://chain.link/ecosystem/data-providers`
- Chainlink Data Streams Data Sources:
  - `https://docs.chain.link/data-streams/data-sources`
- Chainlink Data Streams Architecture:
  - `https://docs.chain.link/data-streams/architecture`
- Chainlink LWBA Documentation:
  - `https://docs.chain.link/data-streams/concepts/liquidity-weighted-prices`
- Chainlink Report Schema:
  - `https://docs.chain.link/data-streams/reference/report-schema-overview`
- CME CF Constituent Exchanges v13.4:
  - `https://docs.cfbenchmarks.com/CME%20CF%20Constituent%20Exchanges.pdf`
- CoinGecko Price Aggregation Methodology v3.0:
  - `https://assets.coingecko.com/methodology/CoinGecko-Price-Aggregation-Methodology.pdf`
- CryptoCompare CCCAGG Methodology:
  - `https://data.cryptocompare.com/indices/cccagg`
- Kaiko-Chainlink Partnership:
  - `https://www.kaiko.com/blogs/latest-news/kaiko-partners-with-chainlink-to-bring-cryptocurrency-market-data-to-smart-contracts`
- Amberdata-Chainlink Partnership:
  - `https://blog.amberdata.io/announcing-chainlink-amberdata-partnership-the-most-advanced-data-sets-accessible-on-ethereum-and-more`
- Galaxy-Chainlink Partnership:
  - `https://www.coindesk.com/business/2022/09/27/galaxy-digital-partners-with-chainlink-to-offer-crypto-price-data-on-chain`
- Coinbase DataLink Integration:
  - `https://www.theblock.co/post/395085/coinbase-pushes-order-book-perps-and-futures-data-onchain-with-chainlinks-datalink-bridge`
- Tiingo Chainlink Oracle Node:
  - `https://blog.tiingo.com/tiingo-launches-a-chainlink-oracle-node/`
- Tiingo Crypto API:
  - `https://www.tiingo.com/documentation/crypto`
- BTC/USD Data Stream:
  - `https://data.chain.link/streams/btc-usd`
- BTC/USD Price Feed (Ethereum):
  - `https://data.chain.link/feeds/ethereum/mainnet/btc-usd`
- Chainlink FAQs:
  - `https://chain.link/faqs`
