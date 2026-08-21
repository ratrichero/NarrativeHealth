# P6-01C — Source Registry & Freshness Configuration Contract

**Date:** 2026-08-21
**Task Type:** CONTRACT DESIGN DOCUMENT ONLY — NO IMPLEMENTATION
**Baseline:** P6-01B Observation Contract (frozen, commit ad5d7df)
**Frozen Boundaries:** P6-01B semantic authority, P4-P5 Handoff

---

## 1. Purpose

This document defines a declarative Source Registry and Freshness Configuration layer that supplies metadata to the P6 canonical observation pipeline.

The contract specifies:
- source identity and classification
- source capabilities (metrics, entities, timeframes)
- source status lifecycle
- freshness configuration model
- freshness evaluation semantics
- configuration versioning
- provenance boundary

**This is a contract design document.** It does not implement, migrate, or modify any production code.

---

## 2. Scope

### 2.1 In Scope

- Source registry model (SourceDefinition)
- Source identity, type, status
- Capability contract (metrics, entities, timeframes)
- Freshness configuration model (FreshnessPolicy)
- Freshness evaluation contract
- Configuration versioning

### 2.2 Out of Scope

- Source priority (PLANNER DECISION REQUIRED)
- Source fallback policy (PLANNER DECISION REQUIRED)
- Implementation (tables, migrations, evaluators)
- Operational health monitoring (DEGRADED, UNHEALTHY states)
- P4/P5 semantics

---

## 3. Definitions

| Term | Definition |
|---|---|
| **Source** | An external data provider that supplies observations to the canonical pipeline |
| **SourceDefinition** | Declarative metadata describing a source's identity, capabilities, and status |
| **SourceCapability** | The set of canonical metrics, entity types, and timeframes a source can provide |
| **FreshnessPolicy** | Declarative configuration defining expected data cadence and staleness thresholds |
| **FreshnessStatus** | Runtime classification of an observation's staleness (FRESH, STALE, UNKNOWN) |
| **Canonical Metric** | A metric defined in the P6-01B frozen metric vocabulary |
| **Entity** | A coin or asset that observations are collected for |
| **Configuration Version** | A versioned snapshot of the source registry and freshness policies |

---

## 4. Source Registry Model

### 4.1 SourceDefinition (Conceptual)

```
SourceDefinition
├── source_id              (canonical identifier)
├── provider               (underlying provider name)
├── source_type            (classification)
├── status                 (operational state)
├── capabilities
│   ├── metrics            (set of canonical metrics)
│   ├── entity_requirement (what entity metadata is needed)
│   └── timeframes         (set of supported temporal resolutions)
└── provenance
    ├── api_base           (provider API base URL)
    └── notes              (human-readable notes)
```

### 4.2 Design Principles

- **Declarative:** The registry describes what sources CAN provide, not what they currently provide at runtime
- **Stable identity:** `source_id` is stable and does not change with endpoint URLs
- **Evidence-based:** Capabilities are derived from actual code inspection, not assumptions
- **External configuration:** The registry is a configuration artifact, not embedded in collectors or services

---

## 5. Source Identity

### 5.1 Canonical Source IDs

| source_id | provider | Description |
|---|---|---|
| `BINANCE_SPOT` | Binance | Binance Spot market API |
| `BINANCE_FUTURES` | Binance | Binance Futures (USDT-M) market API |
| `COINGECKO` | CoinGecko | CoinGecko market data API |

### 5.2 Identity Rules

- `source_id` is a stable, canonical identifier
- `source_id` is NOT an endpoint URL
- `source_id` does NOT change if the provider changes its API base
- `source_id` is the primary key for all registry lookups

### 5.3 Current Implementation Mapping

**Evidence:** `src/lib/collectors/binance.ts`, `src/app/api/refresh/route.ts`, `src/db/schema.ts`

| Current String | Registry Mapping | Evidence |
|---|---|---|
| `"binance"` (market_price_daily.source) | `BINANCE_SPOT` or `BINANCE_FUTURES` (depending on which provided the kline) | `refresh/route.ts` sets `priceSource` to `"binance_spot"` or `"binance_futures"` |
| `"binance_futures"` (coin_metrics.source) | `BINANCE_FUTURES` | `refresh/route.ts` inserts with `source: "binance_futures"` |
| `"binance_spot"` (coin_metrics.source) | `BINANCE_SPOT` | `refresh/route.ts` fallback path inserts with `source: "binance_spot"` |
| `"coingecko"` (implied by confidence weights) | `COINGECKO` | `refresh/route.ts` confidence weights include `"coingecko": 0.2` |

**Target Contract:** The registry uses canonical `source_id` values. The existing string-based source identifiers are implementation artifacts that will be mapped during normalization (P6-01F).

---

## 6. Source Type

### 6.1 Source Type Classification

| source_type | Definition |
|---|---|
| `MARKET_SPOT` | Spot market data (price, volume, OHLCV) |
| `MARKET_DERIVATIVES` | Derivative market data (OI, funding rate, long/short ratio) |
| `MARKET_AGGREGATOR` | Aggregated market data (market cap, FDV, supply) |

### 6.2 Source Type Assignment

| source_id | source_type | Evidence |
|---|---|---|
| `BINANCE_SPOT` | `MARKET_SPOT` | Provides klines, ticker — spot market data |
| `BINANCE_FUTURES` | `MARKET_DERIVATIVES` | Provides klines, OI, funding rate, long/short ratio — derivative market data |
| `COINGECKO` | `MARKET_AGGREGATOR` | Provides market cap, FDV, circulating supply — aggregated data |

### 6.3 Source Type Constraints

Source type is classification ONLY. It MUST NOT be used for:
- Scoring
- Health calculation
- Recommendation logic
- P4/P5 semantics
- Any business rule differentiation beyond "what kind of data does this source provide"

---

## 7. Source Status

### 7.1 Source Status Values

| status | Definition |
|---|---|
| `ACTIVE` | Source is available and expected to provide data |
| `INACTIVE` | Source is disabled or not expected to provide data |

### 7.2 Source Status Constraints

Source status is limited to `ACTIVE` and `INACTIVE`. Operational health monitoring (DEGRADED, UNHEALTHY, WARNING) belongs OUTSIDE this contract — in operational monitoring infrastructure, not in the source registry.

### 7.3 Current Implementation Mapping

**Evidence:** `src/db/schema.ts` — `source_status` table

| Current Status | Registry Mapping | Notes |
|---|---|---|
| `"OK"` | `ACTIVE` (implicit) | Source successfully provided data |
| `"PARTIAL"` | `ACTIVE` (with runtime quality flag) | Source partially provided data |
| `"FAILED"` | `ACTIVE` (with runtime quality flag) | Source attempt failed |

**Important distinction:** The existing `source_status` table tracks per-attempt runtime outcomes (OK/PARTIAL/FAILED). The Source Registry status (ACTIVE/INACTIVE) tracks whether the source is configured and expected to participate. These are different concerns. The registry status is a configuration property; the runtime status is an operational property.

---

## 8. Capability Contract

### 8.1 Capability Model

Each SourceDefinition declares which canonical metrics it can provide:

```
SourceCapability
├── metrics         (set of canonical metric IDs from P6-01B §6.1)
├── entity_requirement (what entity metadata enables this source)
└── timeframes      (set of supported timeframe IDs from P6-01B §5.3)
```

### 8.2 BINANCE_SPOT Capabilities

**Evidence:** `src/lib/collectors/binance.ts` — `fetchBinanceSpotKlines`, `fetchBinanceSpotTicker`

| Metric | Supported | Evidence |
|---|---|---|
| `OPEN` | YES | Kline `open` field |
| `HIGH` | YES | Kline `high` field |
| `LOW` | YES | Kline `low` field |
| `CLOSE` | YES | Kline `close` field |
| `VOLUME` | YES | Kline `volume` field |
| `QUOTE_VOLUME` | YES | Kline `quoteVolume` field |
| `MARKET_CAP` | NO | Not provided by Binance Spot API |
| `FDV` | NO | Not provided by Binance Spot API |
| `OPEN_INTEREST` | NO | Not provided by Binance Spot API |
| `FUNDING_RATE` | NO | Not provided by Binance Spot API |

| Timeframe | Supported | Evidence |
|---|---|---|
| `DAILY` | YES | Default interval `"1d"` in `fetchBinanceSpotKlines` |
| `4H` | YES | Supported via `BinanceInterval` type, used in refresh route |
| `SOURCE_SNAPSHOT` | NO | Klines are time-interval data, not snapshots |

| Entity Requirement | Description |
|---|---|
| `binanceSpotSymbol` | Coin must have a Binance Spot symbol (e.g., `"BTCUSDT"`) |

### 8.3 BINANCE_FUTURES Capabilities

**Evidence:** `src/lib/collectors/binance.ts` — `fetchBinanceFuturesKlines`, `fetchBinanceFuturesOI`, `fetchBinanceFundingRate`, `fetchBinanceFuturesTicker`

| Metric | Supported | Evidence |
|---|---|---|
| `OPEN` | YES | Kline `open` field |
| `HIGH` | YES | Kline `high` field |
| `LOW` | YES | Kline `low` field |
| `CLOSE` | YES | Kline `close` field |
| `VOLUME` | YES | Kline `volume` field |
| `QUOTE_VOLUME` | YES | Kline `quoteVolume` field |
| `MARKET_CAP` | NO | Not provided by Binance Futures API |
| `FDV` | NO | Not provided by Binance Futures API |
| `OPEN_INTEREST` | YES | `fetchBinanceFuturesOI` — `GET /fapi/v1/openInterest` |
| `FUNDING_RATE` | YES | `fetchBinanceFundingRate` — `GET /fapi/v1/premiumIndex` |

| Timeframe | Supported | Evidence |
|---|---|---|
| `DAILY` | YES | Default interval `"1d"` in `fetchBinanceFuturesKlines` |
| `4H` | YES | Supported via `BinanceInterval` type, used in refresh route |
| `SOURCE_SNAPSHOT` | YES | OI and funding rate are point-in-time snapshots |

| Entity Requirement | Description |
|---|---|
| `binanceFuturesSymbol` | Coin must have a Binance Futures symbol (e.g., `"BTCUSDT"`) and `hasFutures: true` |

### 8.4 COINGECKO Capabilities

**Evidence:** `src/lib/collectors/coingecko.ts` — `fetchCoinGeckoMarkets`

| Metric | Supported | Evidence |
|---|---|---|
| `OPEN` | NO | Not a primary metric from CoinGecko markets endpoint |
| `HIGH` | NO | Not a primary metric from CoinGecko markets endpoint |
| `LOW` | NO | Not a primary metric from CoinGecko markets endpoint |
| `CLOSE` | NO | `currentPrice` available but not used as primary price source |
| `VOLUME` | NO | `total_volume` available but Binance is primary volume source |
| `QUOTE_VOLUME` | NO | Not provided in quote_asset format |
| `MARKET_CAP` | YES | `coin.market_cap` from markets endpoint |
| `FDV` | YES | `coin.fully_diluted_valuation` from markets endpoint |
| `OPEN_INTEREST` | NO | Not provided by CoinGecko |
| `FUNDING_RATE` | NO | Not provided by CoinGecko |

| Timeframe | Supported | Evidence |
|---|---|---|
| `DAILY` | NO | CoinGecko provides snapshot data, not OHLCV time series |
| `4H` | NO | CoinGecko does not provide intraday intervals |
| `SOURCE_SNAPSHOT` | YES | Markets endpoint returns current snapshot |

| Entity Requirement | Description |
|---|---|
| `coingeckoId` | Coin must have a CoinGecko ID (e.g., `"bitcoin"`) |

### 8.5 Multi-Source Metric Support

A canonical metric may be supported by multiple sources. The registry must support this:

| Metric | Sources |
|---|---|
| `OPEN` | `BINANCE_SPOT`, `BINANCE_FUTURES` |
| `HIGH` | `BINANCE_SPOT`, `BINANCE_FUTURES` |
| `LOW` | `BINANCE_SPOT`, `BINANCE_FUTURES` |
| `CLOSE` | `BINANCE_SPOT`, `BINANCE_FUTURES` |
| `VOLUME` | `BINANCE_SPOT`, `BINANCE_FUTURES` |
| `QUOTE_VOLUME` | `BINANCE_SPOT`, `BINANCE_FUTURES` |
| `OPEN_INTEREST` | `BINANCE_FUTURES` |
| `FUNDING_RATE` | `BINANCE_FUTURES` |
| `MARKET_CAP` | `COINGECKO` |
| `FDV` | `COINGECKO` |

**Source priority is NOT defined by this contract.** See Section 19, Open Decisions.

### 8.6 Unsupported / Uncertain Capabilities

The following capabilities are NOT supported by any current source:

| Metric | Status | Notes |
|---|---|---|
| `TRADE_COUNT` | NOT AVAILABLE | Binance provides this in ticker but it is not currently collected |

---

## 9. Entity Coverage

### 9.1 Entity Coverage Model

Entity coverage describes the *capability* to observe entities, not the runtime inventory of entities.

```
EntityCoverage
├── entity_type       (COIN)
├── requirement       (what metadata enables source coverage)
└── coverage_rule     (how to determine if an entity is covered)
```

### 9.2 Coverage Rules

| source_id | entity_type | requirement | coverage_rule |
|---|---|---|---|
| `BINANCE_SPOT` | COIN | `binanceSpotSymbol` IS NOT NULL | Entity has a Binance Spot trading pair |
| `BINANCE_FUTURES` | COIN | `binanceFuturesSymbol` IS NOT NULL AND `hasFutures = true` | Entity has a Binance Futures trading pair |
| `COINGECKO` | COIN | `coingeckoId` IS NOT NULL | Entity has a CoinGecko identifier |

### 9.3 Runtime Entity Inventory

The registry does NOT contain the actual coin/symbol inventory. That is runtime data in the `coins` table. The registry describes *coverage capability* — which coins CAN be covered based on their metadata.

### 9.4 Current Implementation Mapping

**Evidence:** `src/db/schema.ts` — `coins` table

```typescript
coins: {
  binanceSpotSymbol: varchar("binance_spot_symbol", { length: 30 }),
  binanceFuturesSymbol: varchar("binance_futures_symbol", { length: 30 }),
  coingeckoId: varchar("coingecko_id", { length: 100 }),
  hasFutures: boolean("has_futures").default(false).notNull(),
}
```

The existing `coins` table metadata directly maps to entity coverage requirements.

---

## 10. Timeframe Coverage

### 10.1 Timeframe Vocabulary

Uses the P6-01B frozen timeframe vocabulary:

| timeframe | Description |
|---|---|
| `DAILY` | One observation per business day |
| `4H` | Four-hour intervals |
| `SOURCE_SNAPSHOT` | Provider-determined snapshot |

### 10.2 Timeframe Support Matrix

| source_id | DAILY | 4H | SOURCE_SNAPSHOT |
|---|---|---|---|
| `BINANCE_SPOT` | YES | YES | NO |
| `BINANCE_FUTURES` | YES | YES | YES |
| `COINGECKO` | NO | NO | YES |

### 10.3 Evidence

| source_id | timeframe | evidence |
|---|---|---|
| `BINANCE_SPOT` | DAILY | `fetchBinanceSpotKlines(symbol, 200, "1d")` |
| `BINANCE_SPOT` | 4H | `fetchBinanceSpotKlines(symbol, 100, "4h")` in refresh route |
| `BINANCE_FUTURES` | DAILY | `fetchBinanceFuturesKlines(symbol, 200, "1d")` |
| `BINANCE_FUTURES` | 4H | `fetchBinanceFuturesKlines(symbol, 100, "4h")` in refresh route |
| `BINANCE_FUTURES` | SOURCE_SNAPSHOT | `fetchBinanceFuturesOI(symbol)` and `fetchBinanceFundingRate(symbol)` — point-in-time |
| `COINGECKO` | SOURCE_SNAPSHOT | `fetchCoinGeckoMarkets(coinIds)` — current snapshot |

### 10.4 Explicitly Not Supported

The following timeframes are NOT introduced by this contract:

- tick
- 1m
- 5m
- 15m
- 30m
- 1h
- synthetic aggregation

These may be added in the future if evidence supports them and the P6-01B contract is updated.

---

## 11. Freshness Configuration

### 11.1 FreshnessPolicy (Conceptual)

```
FreshnessPolicy
├── source_id           (which source this policy applies to)
├── metric              (which canonical metric)
├── timeframe           (which temporal resolution)
├── expected_interval   (expected time between observations)
└── stale_after         (threshold for STALE classification)
```

### 11.2 Configuration Principles

- **Declarative:** Freshness policies are configuration, not code
- **External:** Policies are NOT hard-coded inside collectors, services, feature calculations, or API routes
- **Versioned:** Policy configurations are versioned (see Section 13)
- **Per-source-metric-timeframe:** A policy applies to a specific (source, metric, timeframe) combination

### 11.3 Distinct Concepts

`expected_interval` and `stale_after` are DISTINCT concepts:

- **expected_interval:** The cadence at which the source is expected to provide new data (e.g., "every 24h for DAILY klines")
- **stale_after:** The threshold after which data is classified as STALE (e.g., "if no new data for 48h, classify as STALE")

`stale_after` is NOT necessarily equal to `expected_interval`. The relationship between them is a PLANNER DECISION.

### 11.4 Policy Structure (No Values)

The following table defines the FreshnessPolicy structure. **Actual threshold values are NOT included** — they are PLANNER DECISION REQUIRED.

| source_id | metric | timeframe | expected_interval | stale_after |
|---|---|---|---|---|
| `BINANCE_SPOT` | `OPEN` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `HIGH` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `LOW` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `CLOSE` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `VOLUME` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `QUOTE_VOLUME` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `OPEN` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `HIGH` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `LOW` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `CLOSE` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `VOLUME` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_SPOT` | `QUOTE_VOLUME` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `OPEN` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `HIGH` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `LOW` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `CLOSE` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `VOLUME` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `QUOTE_VOLUME` | `DAILY` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `OPEN` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `HIGH` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `LOW` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `CLOSE` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `VOLUME` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `QUOTE_VOLUME` | `4H` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `OPEN_INTEREST` | `SOURCE_SNAPSHOT` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `BINANCE_FUTURES` | `FUNDING_RATE` | `SOURCE_SNAPSHOT` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `COINGECKO` | `MARKET_CAP` | `SOURCE_SNAPSHOT` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |
| `COINGECKO` | `FDV` | `SOURCE_SNAPSHOT` | PLANNER DECISION REQUIRED | PLANNER DECISION REQUIRED |

---

## 12. Freshness Evaluation Contract

### 12.1 Evaluation Semantics

Freshness is evaluated at observation time using:

```
age = evaluation_time - observed_at
```

Freshness MUST use `observed_at`. It MUST NOT use `collected_at`.

### 12.2 Evaluation Rules

| Condition | freshness_status |
|---|---|
| `observed_at` is known AND `age ≤ stale_after` for the applicable policy | `FRESH` |
| `observed_at` is known AND `age > stale_after` for the applicable policy | `STALE` |
| `observed_at = UNKNOWN` | `UNKNOWN` |
| No FreshnessPolicy exists for this (source, metric, timeframe) | `UNKNOWN` |

### 12.3 Frozen Status Vocabulary

Freshness status is limited to exactly three values (P6-01B frozen):

| Status | Definition |
|---|---|
| `FRESH` | Data is current and within expected operational cadence |
| `STALE` | Data is older than expected and may not reflect current state |
| `UNKNOWN` | Freshness cannot be determined |

### 12.4 Critical Constraints

- `observed_at = UNKNOWN` ALWAYS produces `freshness_status = UNKNOWN`
- `collected_at` is NEVER used as a substitute for `observed_at` in freshness evaluation
- Freshness thresholds are configuration, not hidden code
- No freshness threshold may be invented by the Agent

### 12.5 Evaluation Scope

Freshness evaluation applies to CANONICAL observations only. Raw observations do not have freshness semantics. Derived metrics inherit freshness from their input observations.

---

## 13. Configuration Versioning

### 13.1 Version Mechanism

The source registry and freshness policies are versioned together as a configuration snapshot:

```
SourceRegistryVersion
├── version_id          (monotonic integer)
├── effective_at        (when this version became active)
├── source_definitions  (set of SourceDefinition snapshots)
├── freshness_policies  (set of FreshnessPolicy snapshots)
└── description         (human-readable change description)
```

### 13.2 Version Rules

- Each configuration change creates a new version
- Historical observations retain the version marker of the configuration that was active when they were collected
- The system can identify which freshness configuration was applied to any observation
- Version changes are documented in migration notes

### 13.3 Separation from Algorithm Version

Configuration version is NOT `algorithm_version`. Algorithm version applies to derived metric calculations (P6-01B §13). Configuration version applies to source registry and freshness policies. These are independent version tracks.

---

## 14. Provenance Boundary

### 14.1 Source Registry Provenance Scope

The Source Registry provides source-level metadata:
- What sources exist
- What each source can provide
- What freshness policies apply

### 14.2 Canonical Observation Provenance

Observation-level provenance (source, source_ref, observed_at, collected_at) is defined by the P6-01B Observation Contract. The Source Registry does NOT duplicate the observation model.

### 14.3 Boundary

```
Source Registry                    Canonical Observation (P6-01B)
├── source_id                      ├── source (from registry)
├── capabilities                   ├── source_ref (provider-specific)
├── freshness_policies             ├── observed_at
└── version                        ├── collected_at
                                   └── quality_status, freshness_status
```

The Source Registry supplies metadata; the Canonical Observation stores observation-level provenance. They are complementary, not overlapping.

---

## 15. Existing Implementation Mapping

### 15.1 CURRENT IMPLEMENTATION

| Aspect | Current State | Evidence |
|---|---|---|
| Source identification | String literals: `"binance"`, `"binance_futures"`, `"binance_spot"`, `"coingecko"` | `refresh/route.ts`, `schema.ts` |
| Source status | `OK`, `PARTIAL`, `FAILED` in `source_status` table | `schema.ts` |
| Collector architecture | `src/lib/collectors/binance.ts`, `src/lib/collectors/coingecko.ts` | Direct API calls, no abstraction layer |
| Scheduling | External 4h trigger via `/api/refresh` POST | `refresh/route.ts` — lock timeout 15min |
| Entity mapping | `coins.binanceSpotSymbol`, `coins.binanceFuturesSymbol`, `coins.coingeckoId` | `schema.ts` |
| Timeframe handling | Hard-coded in collector calls: `"1d"`, `"4h"` | `refresh/route.ts` |
| Freshness | No freshness model — only `source_status.lastAttempt`/`lastSuccess` | `schema.ts` |
| Source priority | Implicit: Futures preferred over Spot for price | `refresh/route.ts` — tries futures first, falls back to spot |
| Configuration | `score_configs` table for health weights, not for source registry | `schema.ts` |

### 15.2 TARGET CONTRACT

| Aspect | Target State | P6 Task |
|---|---|---|
| Source identification | Canonical `source_id` (BINANCE_SPOT, BINANCE_FUTURES, COINGECKO) | P6-01C (this contract) |
| Source status | ACTIVE / INACTIVE | P6-01C (this contract) |
| Source capabilities | Declarative metric/entity/timeframe capabilities | P6-01C (this contract) |
| Freshness | Declarative FreshnessPolicy with observed_at-based evaluation | P6-01C (this contract) |
| Source priority | NOT defined by this contract | PLANNER DECISION REQUIRED |
| Fallback policy | NOT defined by this contract | PLANNER DECISION REQUIRED |
| Implementation | Source registry tables, freshness evaluator | P6-01C-B (later task) |

### 15.3 Gap Summary

| Gap | Impact | Resolution |
|---|---|---|
| No source registry abstraction | Source IDs are scattered as string literals | P6-01C-B implements registry |
| No freshness model | Cannot determine staleness of observations | P6-01C-B implements freshness evaluator |
| No configuration versioning | Cannot track which config was active historically | P6-01C-B implements versioning |
| Implicit source priority | Futures-over-Spot logic is hard-coded in refresh route | PLANNER DECISION REQUIRED |
| No fallback policy | Spot fallback for Futures failures is hard-coded | PLANNER DECISION REQUIRED |

---

## 16. P3/P4/P5 Compatibility

### 16.1 Boundaries

- P6-01C does NOT modify P3 intelligence semantics
- P6-01C does NOT reinterpret P4 decision support
- P6-01C does NOT modify P5 policy/safety/approval/permission
- P6-01C does NOT introduce BUY/SELL/LONG/SHORT/ORDER semantics
- P6-01C does NOT introduce action policy or recommendation logic

### 16.2 Interaction with Existing Systems

| System | Interaction |
|---|---|
| P3 Intelligence | P6-01C provides source metadata that P3 collectors may consume |
| P4 Decision Support | No direct interaction — P4 uses derived metrics, not raw sources |
| P5 Action Decisions | No direct interaction — P5 uses P4 outputs |
| Feature Engine | P6-01C freshness may inform feature engine data quality awareness |
| Square Pipeline | No direct interaction — Square uses opportunity/publishing pipeline |

---

## 17. Persistence Boundary

### 17.1 Contract Only

P6-01C is contract design only. The following are NOT implemented in this task:

- Source registry database tables
- Freshness policy tables
- Configuration version tables
- Freshness evaluator logic
- Source registry API endpoints
- Any code changes

### 17.2 Implementation Scope (P6-01C-B)

Future implementation will include:

- `source_registry` table (SourceDefinition persistence)
- `freshness_policies` table (FreshnessPolicy persistence)
- `source_registry_versions` table (configuration versioning)
- Freshness evaluator function (observed_at → freshness_status)
- Source registry query API

---

## 18. Invariants

### SRC-01: Canonical Source Identity
Every source has a canonical `source_id` defined in this contract. No source may exist without a registry entry.

### SRC-02: Stable Source Identity
`source_id` is stable and NOT an endpoint URL. It does not change if the provider changes its API base.

### SRC-03: Canonical Metric Vocabulary
Source capabilities use the canonical P6-01B metric vocabulary (OPEN, HIGH, LOW, CLOSE, VOLUME, QUOTE_VOLUME, MARKET_CAP, FDV, OPEN_INTEREST, FUNDING_RATE). No non-canonical metrics.

### SRC-04: Evidence-Based Capabilities
Unsupported capabilities must not be silently assumed. If a source does not provide a metric, it is not listed in its capabilities.

### SRC-05: Multiple Source Support
A canonical metric may be supported by multiple sources (e.g., CLOSE from both BINANCE_SPOT and BINANCE_FUTURES).

### SRC-06: No Source Priority
Source priority is NOT defined by this contract. Priority is a PLANNER DECISION REQUIRED.

### SRC-07: No Fallback Policy
Fallback policy is NOT defined by this contract. Fallback is a PLANNER DECISION REQUIRED.

### SRC-08: Freshness Uses observed_at
Freshness evaluation uses `observed_at`, never `collected_at`.

### SRC-09: No collected_at Substitution
`collected_at` must not substitute for `observed_at` in freshness evaluation under any circumstance.

### SRC-10: UNKNOWN observed_at Produces UNKNOWN Freshness
If `observed_at = UNKNOWN`, then `freshness_status = UNKNOWN`. Always.

### SRC-11: Freshness Status Vocabulary
Freshness status is limited to exactly: `FRESH`, `STALE`, `UNKNOWN`. No other values.

### SRC-12: Configuration, Not Code
Freshness thresholds are configuration, not hidden code. They are external, declarative, and versioned.

### SRC-13: Distinct Interval Concepts
`expected_interval` and `stale_after` are distinct concepts. `stale_after = expected_interval` is NOT assumed.

### SRC-14: No Invented Thresholds
No freshness threshold value may be invented by the Agent. All threshold values are PLANNER DECISION REQUIRED.

### SRC-15: No P4/P5 Action Semantics
Source Registry does not contain P4/P5 action semantics, recommendation logic, or BUY/SELL vocabulary.

---

## 19. Open Decisions

| # | Question | Status | Impact |
|---|---|---|---|
| 1 | What is the source priority when multiple sources provide the same metric? (e.g., CLOSE from BINANCE_SPOT vs BINANCE_FUTURES) | **PLANNER DECISION REQUIRED** | Affects which source is preferred during normalization |
| 2 | What is the fallback policy when a preferred source fails? (e.g., Futures fails → Spot fallback) | **PLANNER DECISION REQUIRED** | Affects data availability and quality |
| 3 | What are the `expected_interval` values for each (source, metric, timeframe) policy? | **PLANNER DECISION REQUIRED** | Determines freshness evaluation cadence |
| 4 | What are the `stale_after` values for each (source, metric, timeframe) policy? | **PLANNER DECISION REQUIRED** | Determines FRESH/STALE threshold |
| 5 | How should configuration version history be retained? | **PLANNER DECISION REQUIRED** | Affects storage and audit capability |
| 6 | Should entity coverage be represented as a separate table or derived from `coins` metadata? | **PLANNER DECISION REQUIRED** | Affects registry implementation design |
| 7 | Should the source API base URL be part of the registry or external configuration? | **PLANNER DECISION REQUIRED** | Affects registry completeness |
| 8 | Which future temporal resolutions should be pre-approved for the registry? | **PLANNER DECISION REQUIRED** | Affects V1 scope |
| 9 | Should the existing `source_status` table be extended or replaced by the registry? | **PLANNER DECISION REQUIRED** | Affects migration strategy |
| 10 | Should runtime source health (OK/PARTIAL/FAILED) be part of the registry or a separate operational concern? | **PLANNER DECISION REQUIRED** | Affects registry scope |

---

## 20. P6 Dependencies

### 20.1 Upstream Dependencies

| Dependency | Document | Status |
|---|---|---|
| Observation identity | P6-01B (frozen) | RESOLVED |
| Metric vocabulary | P6-01B (frozen) | RESOLVED |
| Temporal vocabulary | P6-01B (frozen) | RESOLVED |
| Freshness states | P6-01B (frozen) | RESOLVED |
| Quality states | P6-01B (frozen) | RESOLVED |

### 20.2 Downstream Consumers

| Consumer | Task | How It Uses This Contract |
|---|---|---|
| P6-01D | Freshness + Data Quality Contract | Uses FreshnessPolicy structure and evaluation semantics |
| P6-01E | Observation Persistence | Uses source_id for observation storage |
| P6-01F | Normalization Boundary | Uses source capabilities and entity requirements |
| P6-02 | Narrative Health Engine | May reference freshness for data quality awareness |
| P6-03 | Coin Health | May reference freshness for data quality awareness |

---

## 21. Acceptance Criteria

- [x] Source registry model is precise (SourceDefinition conceptual structure)
- [x] Initial source IDs are correct (BINANCE_SPOT, BINANCE_FUTURES, COINGECKO)
- [x] Source type is defined (MARKET_SPOT, MARKET_DERIVATIVES, MARKET_AGGREGATOR)
- [x] Source status is defined (ACTIVE, INACTIVE)
- [x] Capability model is defined (metrics, entity_requirement, timeframes)
- [x] Entity coverage is defined (requirement-based, not inventory)
- [x] Timeframe coverage is defined (evidence-based)
- [x] Existing capabilities are evidence-based (code inspection)
- [x] Multiple source support is defined
- [x] Source priority is explicitly out of scope
- [x] Fallback is explicitly out of scope
- [x] Freshness configuration model is defined (FreshnessPolicy)
- [x] Freshness uses observed_at
- [x] UNKNOWN observed_at produces UNKNOWN freshness
- [x] No hidden thresholds (all values are PLANNER DECISION REQUIRED)
- [x] No invented threshold values
- [x] expected_interval != stale_after semantics
- [x] Configuration versioning is defined
- [x] P6-01B boundary is preserved
- [x] P3/P4/P5 boundary is preserved
- [x] Open decisions are explicit
- [x] No production changes
- [x] No schema changes
- [x] No API changes

---

## 22. Freeze Checklist

| # | Item | Status |
|---|---|---|
| 1 | Source identity contract complete | ✓ |
| 2 | Source type classification complete | ✓ |
| 3 | Source status vocabulary complete | ✓ |
| 4 | Capability model complete | ✓ |
| 5 | Entity coverage model complete | ✓ |
| 6 | Timeframe coverage complete | ✓ |
| 7 | Freshness policy model complete | ✓ |
| 8 | Freshness evaluation semantics complete | ✓ |
| 9 | Configuration versioning defined | ✓ |
| 10 | Provenance boundary defined | ✓ |
| 11 | All 15 invariants stated | ✓ |
| 12 | All open decisions marked PLANNER DECISION REQUIRED | ✓ |
| 13 | P6-01B boundary preserved | ✓ |
| 14 | P4/P5 boundary preserved | ✓ |
| 15 | No production code modified | ✓ |
| 16 | No schema modified | ✓ |
| 17 | No API modified | ✓ |

---

**P6-01C SOURCE REGISTRY & FRESHNESS CONFIGURATION CONTRACT — COMPLETE**
**NO PRODUCTION CODE CHANGES**
**NO SCHEMA CHANGES**
**NO API CHANGES**
**NO P4/P5 CONTRACT CHANGES**
