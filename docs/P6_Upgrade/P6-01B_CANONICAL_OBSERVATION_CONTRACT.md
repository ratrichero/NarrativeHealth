# P6-01B — Canonical Observation Contract

**Date:** 2026-08-21
**Task Type:** CONTRACT DESIGN DOCUMENT ONLY — NO IMPLEMENTATION
**Baseline:** P6-01A Data Landscape Recon (accepted)
**Frozen Boundaries:** P4-P5 Handoff, P6-01A findings

---

## 1. Purpose

This document defines the canonical P6 Observation Contract — the foundational semantic model for all observation data in the NarrativeHealth intelligence layer.

The contract specifies:
- what an Observation is
- what Raw, Canonical, and Derived mean
- observation identity semantics
- entity and metric identity
- temporal contracts (observed_at, collected_at, business_date, timeframe)
- source provenance
- unit representation
- freshness, availability, and data quality semantics
- missing/null handling
- persistence boundaries
- versioning requirements
- P3/P4/P5 compatibility

**This is a contract design document.** It does not implement, migrate, or modify any production code.

---

## 2. Accepted Design Inputs (from P6-01A)

The following findings from P6-01A are accepted as design constraints:

| # | Finding | Impact on Contract |
|---|---|---|
| 1 | Raw/canonical observation persistence is missing | Contract must define Raw and Canonical layers that do not currently exist |
| 2 | No explicit canonical normalization boundary exists | Contract must define where normalization occurs |
| 3 | No semantic freshness model exists | Contract must define freshness classification |
| 4 | Tick/minute data is NOT a mandatory P6 requirement | Initial temporal resolutions are DAILY, 4H, SOURCE_SNAPSHOT only |
| 5 | Existing source_status, dataCompleteness, sourceProvenance are reusable inputs | Contract must reference and extend, not duplicate |
| 6 | Historical backfill is OUT OF SCOPE | Contract defines forward-looking semantics only |

---

## 3. Core Semantic Model

### 3.1 Observation — Conceptual Structure

An Observation is a recorded measurement of a specific metric for a specific entity at a specific point in time, captured from a specific source.

```
Observation
├── identity
│   ├── observation_id      (deterministic, content-addressed)
│   ├── entity_id           (what was observed)
│   └── metric              (what was measured)
│
├── value
│   ├── value               (the measurement)
│   └── unit                (dimension of measurement)
│
├── temporal
│   ├── observed_at         (when the source generated this data)
│   ├── collected_at        (when the system ingested this data)
│   ├── business_date       (the business day this observation belongs to)
│   └── timeframe           (temporal resolution)
│
├── provenance
│   ├── source              (which data provider)
│   └── source_ref          (provider-specific reference, e.g. kline openTime)
│
└── quality
    ├── availability        (was the data obtainable)
    ├── quality_status      (data quality classification)
    └── freshness_status    (how fresh is the data)
```

### 3.2 Observation Layers

P6 defines three observation layers:

#### RAW

**Definition:** The source-near representation of data as received from an external provider, before any normalization or validation.

**Characteristics:**
- Provider-specific field names and formats
- Provider-specific timestamp formats
- Provider-specific null/missing semantics
- No cross-source consistency guarantees
- Retained for provenance and reproducibility

**Example:** A Binance kline response object with `openTime`, `open`, `high`, `low`, `close`, `volume`, `quoteVolume`, `closeTime`.

**Storage rule:** Raw observations MAY be stored in a dedicated raw observation table or retained as JSON blobs within canonical records. The choice is an implementation detail; the contract requires that raw provenance is recoverable.

#### CANONICAL

**Definition:** A validated, normalized observation with stable, cross-source semantics. Canonical observations are the primary input for all derived metrics and intelligence calculations.

**Characteristics:**
- Normalized field names (e.g., `observed_at` not `openTime`)
- Normalized units (e.g., USD for price, not provider-specific quote assets)
- Consistent null/missing semantics
- Cross-source comparable
- Source provenance preserved
- Quality metadata attached
- Deterministic identity

**Normalization boundary:** The transition from Raw to Canonical is the normalization boundary. This is where:
- Provider-specific timestamps are converted to UTC `observed_at`
- Provider-specific field names are mapped to canonical names
- Units are standardized
- Missing values are explicitly represented (not silently dropped)
- Source provenance is recorded

**Storage rule:** Canonical observations are persisted in dedicated observation tables. They are the durable, queryable representation of market data.

#### DERIVED

**Definition:** A calculated metric, feature, or score computed from one or more Canonical observations using a specific algorithm and parameters.

**Characteristics:**
- Always references its input observations (provenance)
- Always references its algorithm and version
- Always references its input window/timeframe
- Never混淆'd with raw or canonical observations
- Subject to recalculation if inputs or algorithms change

**Examples:** trend_score, derivative_score, volume_score, momentum_score, health_score, breadth, participation, relative_strength, persistence.

**Storage rule:** Derived metrics are stored in existing `features`, `health_scores`, and future derived-metric tables. They are NOT observations; they are computations over observations.

### 3.3 Classification Rules

| Entity | Layer | Rationale |
|---|---|---|
| Binance kline API response | RAW | Source-specific format, not normalized |
| Normalized OHLCV record | CANONICAL | Cross-source comparable, stable semantics |
| EMA(9) value | DERIVED | Computed from canonical price observations |
| trend_score | DERIVED | Computed from canonical observations via algorithm |
| health_score | DERIVED | Computed from derived feature scores |
| OI snapshot from Binance | RAW until normalized → CANONICAL | Must be normalized before use |
| fundingRate from Binance | RAW until normalized → CANONICAL | Must be normalized before use |
| marketCap from CoinGecko | RAW until normalized → CANONICAL | Must be normalized before use |
| data_completeness | DERIVED | Computed from source availability flags |
| confidence_score | DERIVED | Computed from source availability and weights |

**Critical rule:** trend_score, momentum_score, breadth, participation, health_score, and all other computed outputs are NEVER classified as observations, regardless of how they are stored.

---

## 4. Observation Identity

### 4.1 Deterministic Identity

Every canonical observation has a deterministic `observation_id` derived from its identity tuple:

```
observation_id = f(entity_id, metric, source, observed_at, timeframe)
```

Where:
- `entity_id` — the coin or entity being observed (e.g., coin ID)
- `metric` — what is being measured (e.g., PRICE, VOLUME, OPEN_INTEREST)
- `source` — the data provider (e.g., BINANCE_SPOT, BINANCE_FUTURES, COINGECKO)
- `observed_at` — when the source generated this observation (UTC timestamp)
- `timeframe` — the temporal resolution (DAILY, 4H, SOURCE_SNAPSHOT)

### 4.2 Why observed_at, Not collected_at

`observed_at` is used as the identity component because:
1. It represents when the data was true at the source, not when we happened to fetch it
2. Two collections of the same source data at different times should produce the same observation_id
3. `collected_at` varies per ingestion attempt and would create duplicate observations for the same source data
4. Idempotency requires that re-fetching the same source data does not create new observations

### 4.3 Identity Uniqueness

The tuple `(entity_id, metric, source, observed_at, timeframe)` must be unique. Re-ingestion of the same data must update the existing observation, not create a duplicate.

### 4.4 Observation ID Format

The `observation_id` should be a deterministic hash (e.g., SHA-256) of the identity tuple, truncated or encoded as needed for storage efficiency. The exact encoding is an implementation detail.

---

## 5. Temporal Contract

### 5.1 Temporal Fields

| Field | Definition | Timezone | Semantics |
|---|---|---|---|
| `observed_at` | When the source generated this data point | UTC | Source observation time. For klines, this is `openTime`. For snapshots, this is the timestamp of the measurement. |
| `collected_at` | When the system ingested this data point | UTC | Ingestion time. Always set at write time. Never used as identity component. |
| `business_date` | The business day this observation belongs to | Asia/Ho_Chi_Minh | Derived from `observed_at` using the configured business timezone. Used for daily aggregation and snapshot alignment. |
| `timeframe` | The temporal resolution of this observation | N/A | Enum: DAILY, 4H, SOURCE_SNAPSHOT |

### 5.2 Do Not Substitute

- `observed_at` and `collected_at` are NEVER silently substituted for each other
- If a source does not provide `observed_at`, the system must explicitly set it to `collected_at` and record `observed_at_source: false` in provenance
- `business_date` is always derived from `observed_at`, never from `collected_at`

### 5.3 Initial Temporal Resolutions

| Timeframe | Description | Use Case | Granularity |
|---|---|---|---|
| `DAILY` | One observation per business day | Primary P6 resolution. All current collectors support this. | 1 observation per coin per metric per source per day |
| `4H` | Four-hour intervals | Intraday trend detection where supported. Binance klines support this. | Up to 6 observations per coin per metric per source per day |
| `SOURCE_SNAPSHOT` | Provider-determined snapshot | For metrics that are point-in-time snapshots (OI, fundingRate, marketCap). | One observation per collection cycle |

### 5.4 Future Resolutions

Additional temporal resolutions (e.g., 1H, 15M, 1M) may be added in the future if a specific P6 metric requires them. Each new resolution must be:
- Explicitly added to the timeframe enum
- Documented in this contract
- Accompanied by collection infrastructure for that resolution

### 5.5 business_date Semantics

`business_date` is the date bucket this observation belongs to for daily aggregation purposes.

- For DAILY timeframe: `business_date` = date of the kline's `openTime` in Asia/Ho_Chi_Minh timezone
- For 4H timeframe: `business_date` = date of the kline's `openTime` in Asia/Ho_Chi_Minh timezone
- For SOURCE_SNAPSHOT: `business_date` = date of `observed_at` in Asia/Ho_Chi_Minh timezone

The business timezone is `Asia/Ho_Chi_Minh` (consistent with existing `getBusinessDate()` in `src/lib/utils.ts`).

---

## 6. Initial Metric Vocabulary

### 6.1 Canonical Metric Definitions

| Metric | Semantic Definition | Unit | Source Fields | Notes |
|---|---|---|---|---|
| `PRICE` | The closing price of the observation period | USD (quote currency) | kline `close` | Primary price reference |
| `OPEN` | The opening price of the observation period | USD | kline `open` | |
| `HIGH` | The highest price during the observation period | USD | kline `high` | |
| `LOW` | The lowest price during the observation period | USD | kline `low` | |
| `CLOSE` | The closing price of the observation period | USD | kline `close` | Alias for PRICE when disambiguation needed |
| `VOLUME` | The base asset volume traded during the observation period | Base asset units | kline `volume` | |

### 6.2 Future Metric Candidates (Not V1)

The following metrics are NOT part of V1 but are anticipated for future expansion:

| Metric | Semantic Definition | Source | Status |
|---|---|---|---|
| `OPEN_INTEREST` | Outstanding derivative contracts | Binance Futures | EXISTS in coin_metrics, needs canonical normalization |
| `FUNDING_RATE` | Perpetual funding rate | Binance Futures | EXISTS in coin_metrics, needs canonical normalization |
| `MARKET_CAP` | Fully diluted market capitalization | CoinGecko | EXISTS in coin_metrics, needs canonical normalization |
| `FDV` | Fully diluted valuation | CoinGecko | EXISTS in coin_metrics, needs canonical normalization |
| `QUOTE_VOLUME` | Quote asset volume (USD volume) | Binance | EXISTS in market_price_daily, not yet canonical |
| `TRADE_COUNT` | Number of trades | Binance | NOT CURRENTLY COLLECTED |

### 6.3 Metric Naming Convention

- All canonical metric names are UPPER_SNAKE_CASE
- Metric names are stable identifiers; they do not change across sources
- A metric name implies a specific semantic meaning, not a specific API field

### 6.4 Unit Convention

- Prices are always in USD (quote currency)
- Volumes are in base asset units unless explicitly noted as `QUOTE_VOLUME`
- Rates are expressed as decimals (e.g., 0.0001 = 0.01%)
- Scores (health, trend, etc.) are NOT metrics; they are derived values with their own scale

---

## 7. Source Provenance

### 7.1 Source Identity

Every canonical observation records its source:

| Source ID | Provider | API Base | Notes |
|---|---|---|---|
| `BINANCE_SPOT` | Binance | `api.binance.com` | Spot market klines |
| `BINANCE_FUTURES` | Binance | `fapi.binance.com` | Futures market klines, OI, funding |
| `COINGECKO` | CoinGecko | `api.coingecko.com` | Market cap, FDV |

### 7.2 Source Reference

`source_ref` captures provider-specific identifiers that allow tracing back to the original data:

| Source | source_ref Format | Example |
|---|---|---|
| BINANCE_SPOT | `kline:{symbol}:{interval}:{openTime}` | `kline:BTCUSDT:1d:1692595200000` |
| BINANCE_FUTURES | `kline:{symbol}:{interval}:{openTime}` | `kline:BTCUSDT:1d:1692595200000` |
| BINANCE_FUTURES (OI) | `oi:{symbol}:{timestamp}` | `oi:BTCUSDT:1692595200000` |
| BINANCE_FUTURES (FR) | `fr:{symbol}:{fundingTime}` | `fr:BTCUSDT:1692624000000` |
| COINGECKO | `market:{coingeckoId}:{date}` | `market:bitcoin:2026-08-21` |

### 7.3 Provenance Chain

The complete provenance chain for P6:

```
Raw observation (API response)
    ↓ [normalization boundary]
Canonical observation (normalized, with source + source_ref)
    ↓ [algorithm + version]
Derived metric (with input observation references)
    ↓ [intelligence calculation]
Intelligence result (with derived metric references)
    ↓ [presentation transformation]
UI display (with headline, evidence, confidence)
```

Each layer must be traceable to the layer below. The contract requires that:
- Canonical observations reference their raw source
- Derived metrics reference their input canonical observations
- Intelligence results reference their input derived metrics
- The chain is recoverable at any point

### 7.4 Compatibility with Existing Provenance

The existing `features.sourceProvenance` JSON structure captures:
```json
{
  "trend": {
    "sources": ["binance_spot", "binance_futures"],
    "indicators": ["EMA_9", "EMA_21", "EMA_50", "EMA_200", "ADX_14"],
    "calculated_at": "2026-08-21T...",
    "confidence": 85
  }
}
```

P6 extends this by:
- Adding explicit observation references (which canonical observations were used)
- Adding algorithm version references
- Adding data quality and freshness metadata
- Making the chain machine-traceable, not just human-readable

---

## 8. Unit Semantics

### 8.1 Canonical Units

| Metric | Canonical Unit | Conversion Notes |
|---|---|---|
| PRICE / OPEN / HIGH / LOW / CLOSE | USD | Binance returns in quote currency (USDT ≈ USD) |
| VOLUME | Base asset units | Raw kline volume |
| QUOTE_VOLUME | USD | `quoteVolume` from kline |
| OPEN_INTEREST | Base asset units | Binance OI in base units |
| FUNDING_RATE | Decimal (rate) | 0.0001 = 0.01% |
| MARKET_CAP | USD | CoinGecko market cap |
| FDV | USD | CoinGecko fully diluted valuation |

### 8.2 Unit Standardization Rule

When normalizing from Raw to Canonical:
- If the source provides data in the canonical unit, no conversion needed
- If the source provides data in a different unit, convert and record the conversion in provenance
- If conversion is not possible, mark the observation as `quality_status: UNAVAILABLE` with reason `UNIT_CONVERSION_IMPOSSIBLE`

### 8.3 Score Units (Not Observation Units)

Health scores, feature scores, trend scores, etc. use their own internal scales (e.g., 0-100). These are NOT observations and do NOT use the observation unit system. They are derived metrics with their own contracts.

---

## 9. Freshness Model

### 9.1 Freshness Status Classification

| Status | Definition | Classification Rule |
|---|---|---|
| `FRESH` | Data is within expected staleness threshold | `collected_at` is within 1× expected cadence of now |
| `AGING` | Data is approaching staleness | `collected_at` is between 1× and 2× expected cadence |
| `STALE` | Data is beyond acceptable staleness | `collected_at` is beyond 2× expected cadence |
| `INSUFFICIENT` | No data available for this entity/metric | No observations exist in the expected window |
| `DEGRADED` | Data exists but from reduced quality source | Data available from fallback source or with reduced fields |

### 9.2 Expected Cadence

| Metric | Expected Cadence | FRESH Threshold | AGING Threshold | STALE Threshold |
|---|---|---|---|---|
| PRICE (DAILY) | 24h | ≤24h | 24-48h | >48h |
| VOLUME (DAILY) | 24h | ≤24h | 24-48h | >48h |
| OPEN_INTEREST (SOURCE_SNAPSHOT) | 4h (refresh cycle) | ≤4h | 4-8h | >8h |
| FUNDING_RATE (SOURCE_SNAPSHOT) | 8h (Binance funding interval) | ≤8h | 8-16h | >16h |
| MARKET_CAP (SOURCE_SNAPSHOT) | 24h | ≤24h | 24-48h | >48h |

### 9.3 Freshness Independence

Freshness is INDEPENDENT from market health:
- A coin can be HEALTHY with STALE data (data is old but was healthy when last observed)
- A coin can be WEAK with FRESH data (data is current and shows weakness)
- Freshness metadata MUST be surfaced alongside health intelligence in the UI
- Data quality and freshness are never silently hidden

### 9.4 Compatibility with Existing Mechanisms

The existing `source_status` table tracks `lastAttempt` and `lastSuccess` per source per coin. P6 freshness extends this by:
- Computing staleness relative to expected cadence per metric
- Providing a machine-readable freshness_status per observation
- Enabling downstream consumers to filter or flag stale data independently

---

## 10. Availability Model

### 10.1 Availability States

| State | Definition |
|---|---|
| `AVAILABLE` | Observation exists and passes quality checks |
| `MISSING` | Observation expected but not present |
| `NOT_APPLICABLE` | Metric is not applicable for this entity (e.g., no futures OI for a spot-only coin) |
| `SUPPRESSED` | Observation was suppressed due to deduplication or quota |

### 10.2 Availability Tracking

Availability is tracked at two levels:
1. **Source-level:** Does this source have data for this entity? (existing `source_status` mechanism)
2. **Observation-level:** Does a specific canonical observation exist for this entity/metric/timeframe?

P6 requires observation-level availability for intelligence calculations. Source-level availability is a prerequisite but not sufficient.

### 10.3 Compatibility with Existing dataCompleteness

The existing `features.dataCompleteness` field (0-1 scale) captures source-level availability. P6 extends this with:
- Per-metric availability (not just per-source)
- Explicit MISSING vs NOT_APPLICABLE distinction
- Temporal availability (was data available at this specific time, not just "now")

---

## 11. Data Quality Model

### 11.1 Quality Status Classification

| Status | Definition | When to Apply |
|---|---|---|
| `VALID` | Observation passes all validation checks | Normal, expected data |
| `SUSPECT` | Observation passes basic checks but has anomalies | Value outside reasonable bounds, unusual gap pattern |
| `DEGRADED` | Observation exists but with reduced confidence | Partial fields, fallback source, degraded freshness |
| `INVALID` | Observation fails validation | Negative price, zero volume where nonzero expected, impossible values |
| `UNAVAILABLE` | Observation cannot be obtained | Source error, network failure, rate limit |

### 11.2 Quality vs Health Independence

This is a critical boundary:

- **Data quality** = Is the data reliable and complete?
- **Market health** = Is the coin/narrative performing well?

A coin with INVALID data quality and HIGH health score from the last valid data point should be presented as:
> "Health: HIGH (based on data from 2 days ago — data quality: DEGRADED)"

NOT as:
> "Health: HIGH" (which silently hides the stale/degraded data)

### 11.3 Quality Metadata

Every canonical observation should carry:

| Field | Type | Description |
|---|---|---|
| `quality_status` | enum | VALID, SUSPECT, DEGRADED, INVALID, UNAVAILABLE |
| `quality_reason` | string? | Human-readable explanation if not VALID |
| `quality_checks` | JSON? | Which validation checks were run and their results |

### 11.4 Compatibility with Existing Mechanisms

The existing system provides:
- `features.confidenceScore` (0-100) — source availability weighted score
- `features.dataCompleteness` (0-1) — fraction of available sources
- `features.missingSources` (string[]) — list of unavailable sources

P6 quality extends this by:
- Moving quality assessment to the observation level (per observation, not per feature calculation)
- Providing explicit status classifications instead of numeric scores
- Separating quality assessment from health calculation

---

## 12. Missing / Null Semantics

### 12.1 Explicit Null Policy

P6 adopts an **explicit null** policy for observations:

- A missing observation is NOT the same as a zero observation
- A missing observation is NOT the same as a null-valued observation
- Missing data must be represented as absence, not as a placeholder value

### 12.2 Missing Data Representation

| Scenario | Representation |
|---|---|
| Source returned no data | `availability: MISSING` — no observation record created |
| Source returned partial data | `quality_status: DEGRADED` — observation exists with explicit missing fields marked |
| Source returned invalid data | `quality_status: INVALID` — observation exists but flagged |
| Source is unavailable | `availability: NOT_APPLICABLE` or `availability: MISSING` depending on whether metric applies |
| Metric not applicable for entity | `availability: NOT_APPLICABLE` |

### 12.3 Downstream Consumer Rules

When consuming observations, downstream systems (feature engine, health scoring) must:

1. Check `availability` before reading `value`
2. Check `quality_status` before trusting `value`
3. Check `freshness_status` before using `value` as current state
4. NEVER substitute a default value for missing data without explicit configuration
5. NEVER silently carry forward a stale value as if it were current

### 12.4 Graceful Degradation

The feature engine currently returns 50 (neutral) when <20 price rows are available. P6 preserves this behavior but requires:
- The "insufficient data" condition is recorded as `quality_status: DEGRADED` on the derived metric
- The downstream UI can distinguish "calculated from insufficient data" from "calculated from full data"
- The confidence score reflects data sufficiency

---

## 13. Persistence Boundary

### 13.1 What Gets Persisted

| Layer | Persisted? | Table | Notes |
|---|---|---|---|
| Raw observation | OPTIONALLY | TBD (raw_observation table or JSON in canonical) | For provenance/reproducibility |
| Canonical observation | YES | New `observations` table | Primary durable storage |
| Derived metric | YES | Existing `features`, `health_scores` tables | Already persisted |
| Intelligence result | YES | Existing tables + future P6 tables | Already partially persisted |
| Quality metadata | YES | Within observation record | Inline with canonical observation |
| Freshness metadata | YES | Within observation record | Computed at write time, updated on refresh |

### 13.2 Persistence Principles

1. **Canonical observations are the durable source of truth.** Derived metrics can be recalculated from canonical observations.
2. **Raw observations are optional but recommended.** They support reproducibility but are not required for day-to-day operation.
3. **Quality and freshness are inline, not separate tables.** They are properties of the observation, not independent records.
4. **Observations are append-only in semantic effect.** Re-ingestion of the same data updates the existing record (upsert on identity tuple), not appends a new record.

### 13.3 Storage Alignment with Existing Schema

| Existing Table | P6 Relationship | Action |
|---|---|---|
| `market_price_daily` | Partial overlap with canonical PRICE/OPEN/HIGH/LOW/CLOSE/VOLUME | P6 may extend or replace with canonical observations table |
| `coin_metrics` | Partial overlap with OPEN_INTEREST, FUNDING_RATE, MARKET_CAP | P6 may extend or replace with canonical observations table |
| `features` | Derived metrics — fully reusable | No change to schema; P6 adds new derived metrics |
| `health_scores` | Derived intelligence — fully reusable | No change; P6 extends with new dimensions |
| `source_status` | Source availability — reusable as input | P6 freshness extends this concept |
| `indicators` | Derived indicators — reusable | P6 may reference for provenance |

### 13.4 Migration Boundary

P6-01E will define the exact persistence implementation. This contract does NOT specify:
- Exact table schema
- Column types
- Index strategy
- Migration approach

Those are implementation details for the persistence task.

---

## 14. Versioning Contract

### 14.1 Versioned Artifacts

| Artifact | Version Field | Semantics |
|---|---|---|
| Observation schema | `dataSchemaVersion` | Version of the observation record structure |
| Canonical normalization rules | `normalizationVersion` | Version of the Raw→Canonical mapping |
| Derived metric algorithm | `algorithmVersion` | Version of the calculation algorithm |
| Threshold configuration | `thresholdVersion` | Version of the threshold/parameter set |
| Quality classification rules | `qualityVersion` | Version of the quality assessment rules |

### 14.2 Version Immutability

- Changing a version number is a semantic change, not a patch
- Historical observations retain their original version标记
- Re-processing historical data with a new version does NOT silently overwrite the old version's results
- Version changes are documented in migration notes

### 14.3 Compatibility with Existing Versioning

The existing system has:
- `featureVersions` table — tracks feature calculation versions
- `ruleVersions` table — tracks recommendation rule versions

P6 extends this with:
- `dataSchemaVersion` for observation records
- `normalizationVersion` for Raw→Canonical mapping
- `qualityVersion` for quality assessment rules

---

## 15. P3/P4/P5 Compatibility

### 15.1 What P6 Reuses Without Change

| Existing Asset | P6 Usage | Compatibility |
|---|---|---|
| `market_price_daily` | Canonical price observations (DAILY) | Directly consumable; P6 may add canonical wrapper |
| `coin_metrics` | Canonical OI, FR, MC observations | Directly consumable; P6 may add canonical wrapper |
| `features` table | Derived metrics storage | No change; P6 adds new derived metrics |
| `health_scores` | Coin health intelligence | No change; P6 extends with dimensions |
| `narrative_health` | Narrative health intelligence | No change; P6 extends with dimensions |
| `coin_narratives` | Entity membership | No change; P6 uses for breadth/participation |
| `source_status` | Source availability | Reused as input to P6 freshness model |
| Binance collectors | Raw data collection | No change; P6 adds normalization layer |
| CoinGecko collector | Market cap collection | No change; P6 adds normalization layer |
| Feature engine | Derived metric calculation | Extended with new metrics, not replaced |

### 15.2 What P6 Must NOT Modify

Per the P4-P5 Handoff frozen boundaries:
- P4 decision support semantics
- P5 policy evaluation
- P5 safety/approval/permission vocabulary
- P5 explanation/audit generation
- P5 decision assembly
- P5 historical artifact persistence
- P5 presentation transformation
- P5 runtime integration adapter
- decisionId derivation
- Square pipeline (opportunity → content → publish)

### 15.3 P6 Extension Points

P6 may:
- Add new observation tables alongside existing market data tables
- Add new derived metrics in existing `features` table
- Add new intelligence tables for P6-specific artifacts
- Add new API routes for P6 intelligence queries
- Add new UI components and pages
- Extend the refresh pipeline with additional collection/normalization phases

P6 must NOT:
- Change the semantics of existing `market_price_daily` records
- Change the semantics of existing `features` records
- Change the semantics of existing `health_scores` records
- Change the refresh pipeline's existing behavior (may extend it)
- Change the Square pipeline behavior

---

## 16. Mapping: Current Data → Canonical Contract

### 16.1 market_price_daily → Canonical Observations

| Current Field | Canonical Field | Mapping |
|---|---|---|
| `coinId` | `entity_id` | Direct mapping |
| `date` | `business_date` | Direct mapping (already in Asia/Ho_Chi_Minh) |
| `open` | `value` (metric=OPEN) | Direct mapping |
| `high` | `value` (metric=HIGH) | Direct mapping |
| `low` | `value` (metric=LOW) | Direct mapping |
| `close` | `value` (metric=PRICE or CLOSE) | Direct mapping |
| `volume` | `value` (metric=VOLUME) | Direct mapping |
| `quoteVolume` | `value` (metric=QUOTE_VOLUME) | Direct mapping |
| `source` | `source` | Maps to canonical source ID |
| (openTime from API) | `observed_at` | Must be extracted and stored |
| (collection time) | `collected_at` | Must be added |

### 16.2 coin_metrics → Canonical Observations

| Current Field | Canonical Field | Mapping |
|---|---|---|
| `coinId` | `entity_id` | Direct mapping |
| `date` | `business_date` | Direct mapping |
| `openInterest` | `value` (metric=OPEN_INTEREST) | Direct mapping |
| `fundingRate` | `value` (metric=FUNDING_RATE) | Direct mapping |
| `marketCap` | `value` (metric=MARKET_CAP) | Direct mapping |
| `fullyDilutedValuation` | `value` (metric=FDV) | Direct mapping |
| `source` | `source` | Maps to canonical source ID |
| (missing) | `observed_at` | MUST be added — currently not tracked |
| (missing) | `collected_at` | MUST be added — currently not tracked |
| (missing) | `timeframe` | MUST be added — currently SOURCE_SNAPSHOT |
| (missing) | `quality_status` | MUST be added |
| (missing) | `freshness_status` | MUST be added |

### 16.3 Gap Summary

| Gap | Impact | Resolution |
|---|---|---|
| `observed_at` not stored in current tables | Cannot determine when source generated data | P6-01E adds this field |
| `collected_at` not stored in current tables | Cannot compute freshness | P6-01E adds this field |
| `timeframe` not explicit in current tables | Cannot distinguish DAILY from 4H observations | P6-01E adds this field |
| `quality_status` not stored | Cannot assess data quality per observation | P6-01E adds this field |
| `freshness_status` not computed | Cannot determine staleness | P6-01E adds computation |
| No raw observation storage | Cannot reproduce historical calculations exactly | P6-01E optionally adds raw storage |

---

## 17. Semantic Invariants

These invariants must hold for all P6 observation operations:

### INV-OBS-01: Identity Determinism
Same (entity_id, metric, source, observed_at, timeframe) → same observation_id. Always.

### INV-OBS-02: observed_at Integrity
`observed_at` represents source time, not ingestion time. Never silently substituted.

### INV-OBS-03: Explicit Null
A missing observation is absence, not zero, not null, not a default value.

### INV-OBS-04: Quality Independence
Data quality is independent from market health. Never hidden or conflated.

### INV-OBS-05: Freshness Independence
Data freshness is independent from data quality and market health. Always surfaced.

### INV-OBS-06: Provenance Traceability
Every canonical observation is traceable to its raw source. Every derived metric is traceable to its input observations.

### INV-OBS-07: No Silent Substitution
Missing or stale data is never silently replaced with current data, default values, or last-known values without explicit configuration.

### INV-OBS-08: Version Immutability
Historical observations retain their version标记. Re-processing with a new version does not overwrite old results.

### INV-OBS-09: P4/P5 Boundary Preservation
P6 observation semantics do not alter, reinterpret, or replace P4/P5 frozen contracts.

### INV-OBS-10: Deterministic Normalization
Same raw input + same normalization version → same canonical output. Always.

---

## 18. Open Items / Decisions Required

| # | Question | Decision Needed From | Impact |
|---|---|---|---|
| 1 | Should raw observations be stored in a separate table or as JSON within canonical records? | Planner/Owner | Affects storage design and reproducibility |
| 2 | Should existing `market_price_daily` be extended or replaced with a new canonical observations table? | Planner/Owner | Affects migration strategy and backward compatibility |
| 3 | Should existing `coin_metrics` be extended or replaced? | Planner/Owner | Same as above |
| 4 | What is the initial `dataSchemaVersion` number? | Planner | Versioning convention |
| 5 | Should `QUOTE_VOLUME` be a first-class V1 metric or deferred? | Planner | Affects initial metric vocabulary scope |
| 6 | Should the normalization boundary produce one observation per OHLCV field (5 records) or one observation per kline (1 record with 5 fields)? | Planner/Owner | Affects observation granularity and query patterns |

---

## 19. Acceptance Criteria

This contract document is complete when:

- [x] Core semantic model defined (Raw/Canonical/Derived)
- [x] Observation identity contract defined
- [x] Temporal contract defined (observed_at, collected_at, business_date, timeframe)
- [x] Initial metric vocabulary defined (PRICE, OPEN, HIGH, LOW, CLOSE, VOLUME)
- [x] Source provenance contract defined
- [x] Unit semantics defined
- [x] Freshness model defined
- [x] Availability model defined
- [x] Data quality model defined
- [x] Missing/null semantics defined
- [x] Persistence boundary defined
- [x] Versioning contract defined
- [x] P3/P4/P5 compatibility verified
- [x] Semantic invariants stated
- [x] Open items documented
- [x] No production code modified
- [x] No P4/P5 contracts modified

---

## 20. Next Steps

After this contract is accepted:

1. **P6-01C** — Source Registry: Define source identity, reliability metadata, supported metrics, expected cadence
2. **P6-01D** — Freshness + Data Quality Contract: Implement the freshness classification rules and quality assessment logic
3. **P6-01E** — Observation Persistence: Implement the canonical observation tables and Raw→Canonical normalization
4. **P6-01F** — Normalization Boundary: Implement the normalization functions that transform raw API responses into canonical observations

---

**P6-01B CANONICAL OBSERVATION CONTRACT — COMPLETE**
**NO PRODUCTION CODE CHANGES**
**NO SCHEMA CHANGES**
**NO API CHANGES**
**NO P4/P5 CONTRACT CHANGES**
