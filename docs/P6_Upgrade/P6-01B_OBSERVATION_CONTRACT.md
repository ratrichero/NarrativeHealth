# P6-01B — Observation Contract

**Date:** 2026-08-21
**Revision:** 2 (semantic corrections applied)
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
- source provenance (RAW → CANONICAL scope)
- unit representation
- freshness and data quality semantics
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

**Storage rule:** Raw payload retention is OPTIONAL provenance/reproducibility storage. Raw payloads MAY be stored in a dedicated raw observation table or retained as JSON blobs. The choice is an implementation detail.

**Critical boundary:** RAW ≠ CANONICAL. Raw JSON is NOT part of canonical observation identity. Raw payload retention does not define or constrain the canonical observation contract. The canonical observation remains the stable semantic record regardless of whether raw payloads are retained.

#### CANONICAL

**Definition:** A validated, normalized observation with stable, cross-source semantics. Canonical observations are the primary input for all derived metrics and intelligence calculations.

**Characteristics:**
- Normalized field names (e.g., `observed_at` not `openTime`)
- Normalized units preserving source semantics (e.g., `quote_asset` for prices, not hardcoded USD)
- Consistent null/missing semantics
- Cross-source comparable
- Source provenance preserved
- Quality metadata attached
- Deterministic identity

**Normalization boundary:** The transition from Raw to Canonical is the normalization boundary. This is where:
- Provider-specific timestamps are mapped to `observed_at` (or UNKNOWN if source does not provide one)
- Provider-specific field names are mapped to canonical names
- Units preserve source semantics (quote_asset for OHLC, base_asset for volume)
- Missing values are explicitly represented (not silently dropped)
- Source provenance is recorded

**Storage rule:** Canonical observations are persisted in dedicated observation tables. They are the durable, queryable representation of market data.

#### DERIVED

**Definition:** A calculated metric, feature, or score computed from one or more Canonical observations using a specific algorithm and parameters.

**Characteristics:**
- Always references its input observations (provenance)
- Always references its algorithm and version
- Always references its input window/timeframe
- Never conflated with raw or canonical observations
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
- `metric` — what is being measured (e.g., CLOSE, VOLUME, OPEN_INTEREST)
- `source` — the data provider (e.g., BINANCE_SPOT, BINANCE_FUTURES, COINGECKO)
- `observed_at` — when the source generated this observation (UTC timestamp, or UNKNOWN)
- `timeframe` — the temporal resolution (DAILY, 4H, SOURCE_SNAPSHOT)

### 4.2 Why observed_at, Not collected_at

`observed_at` is used as the identity component because:
1. It represents when the data was true at the source, not when we happened to fetch it
2. Two collections of the same source data at different times should produce the same observation_id
3. `collected_at` varies per ingestion attempt and would create duplicate observations for the same source data
4. Idempotency requires that re-fetching the same source data does not create new observations

### 4.3 Identity Uniqueness

The tuple `(entity_id, metric, source, observed_at, timeframe)` must be unique. Re-ingestion of the same data must update the existing observation, not create a duplicate.

### 4.4 Observation ID Representation

The semantic identity is the tuple `(entity_id, metric, source, observed_at, timeframe)`. The hash/encoding/storage representation of `observation_id` (e.g., SHA-256, UUID, sequential) is an **implementation decision** and is NOT frozen by this contract.

---

## 5. Temporal Contract

### 5.1 Temporal Fields

| Field | Definition | Timezone | Semantics |
|---|---|---|---|
| `observed_at` | When the source generated this data point | UTC | Source observation time. For klines, this is `openTime`. For snapshots, this is the timestamp of the measurement. If the source does not provide an observation timestamp, `observed_at` = `UNKNOWN`. |
| `collected_at` | When the system ingested this data point | UTC | Ingestion time. Always set at write time. Never used as identity component. |
| `business_date` | The business day this observation belongs to | Asia/Ho_Chi_Minh | Derived from `observed_at` when available. If `observed_at` is UNKNOWN, `business_date` is derived from `collected_at` with explicit provenance标记. |
| `timeframe` | The temporal resolution of this observation | N/A | Enum: DAILY, 4H, SOURCE_SNAPSHOT |

### 5.2 Do Not Substitute

- `observed_at` and `collected_at` are NEVER silently substituted for each other
- If a source does not provide `observed_at`, the system MUST set it to `UNKNOWN`
- The system MUST NOT substitute `collected_at` for `observed_at` under any circumstance
- `collected_at` is always the actual ingestion timestamp, recorded at write time
- `business_date` is derived from `observed_at` when available; if `observed_at` is UNKNOWN, `business_date` is derived from `collected_at` with explicit provenance

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

**PLANNER DECISION REQUIRED:** Which future temporal resolutions, if any, should be pre-approved for V1 scope?

### 5.5 business_date Semantics

`business_date` is the date bucket this observation belongs to for daily aggregation purposes.

- For DAILY timeframe: `business_date` = date of the kline's `openTime` in Asia/Ho_Chi_Minh timezone
- For 4H timeframe: `business_date` = date of the kline's `openTime` in Asia/Ho_Chi_Minh timezone
- For SOURCE_SNAPSHOT: `business_date` = date of `observed_at` in Asia/Ho_Chi_Minh timezone (or `collected_at` if `observed_at` is UNKNOWN)

The business timezone is `Asia/Ho_Chi_Minh` (consistent with existing `getBusinessDate()` in `src/lib/utils.ts`).

---

## 6. Initial Metric Vocabulary

### 6.1 Canonical Metric Definitions (V1)

The following metrics are part of the V1 canonical observation vocabulary:

| # | Metric | Semantic Definition | Unit | Source Fields | Notes |
|---|---|---|---|---|---|
| 1 | `OPEN` | The opening price of the observation period | quote_asset | kline `open` | |
| 2 | `HIGH` | The highest price during the observation period | quote_asset | kline `high` | |
| 3 | `LOW` | The lowest price during the observation period | quote_asset | kline `low` | |
| 4 | `CLOSE` | The closing price of the observation period | quote_asset | kline `close` | |
| 5 | `VOLUME` | The base asset volume traded during the observation period | base_asset | kline `volume` | |
| 6 | `QUOTE_VOLUME` | The quote asset volume traded during the observation period | quote_asset | kline `quoteVolume` | |
| 7 | `MARKET_CAP` | Fully diluted market capitalization of the asset | USD | CoinGecko `marketCap` | CoinGecko returns USD |
| 8 | `FDV` | Fully diluted valuation of the asset | USD | CoinGecko `fullyDilutedValuation` | CoinGecko returns USD |
| 9 | `OPEN_INTEREST` | Outstanding derivative contracts for the asset | base_asset | Binance Futures `openInterest` | |
| 10 | `FUNDING_RATE` | Perpetual futures funding rate | decimal (rate) | Binance Futures `fundingRate` | 0.0001 = 0.01% |

### 6.2 PRICE — API/Presentation Alias Only

`PRICE` is **NOT a separate canonical observation**. It is an API/presentation alias for `CLOSE`.

- `CLOSE` is the canonical observation metric
- `PRICE` may appear in API responses and UI presentation as a convenience label
- No separate observation identity is created for `PRICE`
- No separate observation record is created for `PRICE`
- Where the system currently uses `PRICE` (e.g., `market_price_daily.close`), the canonical metric is `CLOSE`

### 6.3 Explicitly Excluded from Observation Vocabulary

The following are NOT observations. They are derived metrics and must never be classified as canonical observations:

- TREND / trend_score
- MOMENTUM / momentum_score
- HEALTH / health_score
- BREADTH
- PARTICIPATION
- DERIVATIVE_SCORE
- VOLUME_SCORE
- CONFIDENCE
- DATA_COMPLETENESS
- Any other computed/derived output

### 6.4 Metric Naming Convention

- All canonical metric names are UPPER_SNAKE_CASE
- Metric names are stable identifiers; they do not change across sources
- A metric name implies a specific semantic meaning, not a specific API field

### 6.5 Unit Convention

- OHLC prices (OPEN, HIGH, LOW, CLOSE) use `quote_asset` as the unit (e.g., USDT for BTC/USDT). The canonical observation metadata preserves the quote asset identifier. USD-normalized values, if required later, are a separate derived/normalization concern.
- QUOTE_VOLUME uses `quote_asset` as the unit
- VOLUME and OPEN_INTEREST use `base_asset` as the unit
- FUNDING_RATE is expressed as a decimal (e.g., 0.0001 = 0.01%)
- MARKET_CAP and FDV use `USD` as the unit (CoinGecko returns USD natively)
- Scores (health, trend, etc.) are NOT metrics; they are derived values with their own scale

---

## 7. Source Provenance

### 7.1 Scope

P6-01B defines provenance for the **RAW → CANONICAL** boundary only:

```
Raw observation (API response)
    ↓ [normalization boundary]
Canonical observation (normalized, with source + source_ref)
```

**Future scope (defined in later P6 tasks):**

```
Canonical observation
    ↓ [algorithm + version]
Derived metric          ← P6-02 onward
    ↓ [intelligence calculation]
Intelligence result     ← P6-05 onward
    ↓ [presentation transformation]
UI display              ← P6-07 onward
```

The downstream provenance contracts (CANONICAL → DERIVED, DERIVED → INTELLIGENCE, INTELLIGENCE → UI) will be formally defined in their respective P6 tasks. This contract does not define or freeze those downstream provenance semantics.

### 7.2 Source Identity

Every canonical observation records its source:

| Source ID | Provider | API Base | Notes |
|---|---|---|---|
| `BINANCE_SPOT` | Binance | `api.binance.com` | Spot market klines |
| `BINANCE_FUTURES` | Binance | `fapi.binance.com` | Futures market klines, OI, funding |
| `COINGECKO` | CoinGecko | `api.coingecko.com` | Market cap, FDV |

### 7.3 Source Reference

`source_ref` captures provider-specific identifiers that allow tracing back to the original data:

| Source | source_ref Format | Example |
|---|---|---|
| BINANCE_SPOT | `kline:{symbol}:{interval}:{openTime}` | `kline:BTCUSDT:1d:1692595200000` |
| BINANCE_FUTURES | `kline:{symbol}:{interval}:{openTime}` | `kline:BTCUSDT:1d:1692595200000` |
| BINANCE_FUTURES (OI) | `oi:{symbol}:{timestamp}` | `oi:BTCUSDT:1692595200000` |
| BINANCE_FUTURES (FR) | `fr:{symbol}:{fundingTime}` | `fr:BTCUSDT:1692624000000` |
| COINGECKO | `market:{coingeckoId}:{date}` | `market:bitcoin:2026-08-21` |

### 7.4 Provenance Chain (Conceptual Architecture)

The full P6 provenance chain for reference:

```
Raw observation (API response)
    ↓ [normalization boundary — P6-01B scope]
Canonical observation (normalized, with source + source_ref)
    ↓ [algorithm + version — future P6 tasks]
Derived metric (with input observation references)
    ↓ [intelligence calculation — future P6 tasks]
Intelligence result (with derived metric references)
    ↓ [presentation transformation — future P6 tasks]
UI display (with headline, evidence, confidence)
```

This contract defines provenance semantics for the Raw → Canonical transition only. Each downstream layer must be traceable to the layer below, but those contracts are defined in later P6 tasks.

### 7.5 Compatibility with Existing Provenance

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

| Metric | Canonical Unit | Notes |
|---|---|---|
| OPEN / HIGH / LOW / CLOSE | quote_asset | Preserves the quote asset from the source (e.g., USDT). Metadata must record the quote asset identifier. |
| VOLUME | base_asset | Base asset volume from the source |
| QUOTE_VOLUME | quote_asset | Quote asset volume from the source |
| OPEN_INTEREST | base_asset | Binance OI in base units |
| FUNDING_RATE | decimal (rate) | 0.0001 = 0.01% |
| MARKET_CAP | USD | CoinGecko returns USD natively |
| FDV | USD | CoinGecko returns USD natively |

### 8.2 Unit Standardization Rule

When normalizing from Raw to Canonical:
- OHLC prices preserve the source's quote asset (e.g., USDT). The canonical metadata records `quote_asset: "USDT"`.
- QUOTE_VOLUME preserves the source's quote asset.
- If USD-normalized values are required later, that is a separate derived/normalization concern (not part of this contract).
- If conversion is required and not possible, mark the observation as `quality_status: INVALID` with reason `UNIT_CONVERSION_IMPOSSIBLE`

### 8.3 Score Units (Not Observation Units)

Health scores, feature scores, trend scores, etc. use their own internal scales (e.g., 0-100). These are NOT observations and do NOT use the observation unit system. They are derived metrics with their own contracts.

---

## 9. Freshness Model

### 9.1 Freshness Status Classification

| Status | Definition |
|---|---|
| `FRESH` | Data is current and within expected operational cadence |
| `STALE` | Data is older than expected and may not reflect current state |
| `UNKNOWN` | Freshness cannot be determined (e.g., missing collected_at, no expected cadence defined) |

### 9.2 Freshness Independence

Freshness is INDEPENDENT from market health:
- A coin can be HEALTHY with STALE data (data is old but was healthy when last observed)
- A coin can be WEAK with FRESH data (data is current and shows weakness)
- Freshness metadata MUST be surfaced alongside health intelligence in the UI
- Data quality and freshness are never silently hidden

### 9.3 Compatibility with Existing Mechanisms

The existing `source_status` table tracks `lastAttempt` and `lastSuccess` per source per coin. P6 freshness extends this by:
- Providing a machine-readable freshness_status per observation
- Enabling downstream consumers to filter or flag stale data independently

**PLANNER DECISION REQUIRED:** What are the per-metric freshness thresholds that define the boundary between FRESH and STALE? These thresholds are NOT part of this contract; they belong in the freshness implementation specification (P6-01D).

### 9.4 Additional Freshness Open Questions

**PLANNER DECISION REQUIRED:**
- Should freshness be computed at write time or query time?
- Should freshness have a versioned threshold configuration?
- What is the expected cadence per metric for FRESH classification?

---

## 10. Data Quality Model

### 10.1 Quality Status Classification

| Status | Definition |
|---|---|
| `VALID` | Observation passes all validation checks |
| `INVALID` | Observation fails validation (e.g., negative price, impossible values, unit conversion failure) |
| `MISSING` | Observation was expected but could not be obtained from the source |
| `UNKNOWN` | Quality cannot be determined (e.g., no validation rules defined for this metric) |

### 10.2 Quality vs Health Independence

This is a critical boundary:

- **Data quality** = Is the data reliable and complete?
- **Market health** = Is the coin/narrative performing well?

A coin with INVALID data quality and HIGH health score from the last valid data point should be presented as:
> "Health: HIGH (based on data from 2 days ago — data quality: INVALID)"

NOT as:
> "Health: HIGH" (which silently hides the stale/invalid data)

### 10.3 Quality Metadata

Every canonical observation should carry:

| Field | Type | Description |
|---|---|---|
| `quality_status` | enum | VALID, INVALID, MISSING, UNKNOWN |
| `quality_reason` | string? | Human-readable explanation if not VALID |

### 10.4 Compatibility with Existing Mechanisms

The existing system provides:
- `features.confidenceScore` (0-100) — source availability weighted score
- `features.dataCompleteness` (0-1) — fraction of available sources
- `features.missingSources` (string[]) — list of unavailable sources

P6 quality extends this by:
- Moving quality assessment to the observation level (per observation, not per feature calculation)
- Providing explicit status classifications instead of numeric scores
- Separating quality assessment from health calculation

### 10.5 Additional Quality States

Additional quality states beyond VALID, INVALID, MISSING, UNKNOWN may only appear under Open Decisions, not as active contract semantics. See Section 17.

---

## 11. Missing / Null Semantics

### 11.1 Explicit Null Policy

P6 adopts an **explicit null** policy for observations:

- A missing observation is NOT the same as a zero observation
- A missing observation is NOT the same as a null-valued observation
- Missing data must be represented as absence, not as a placeholder value

### 11.2 Missing Data Representation

| Scenario | Representation |
|---|---|
| Source returned no data | `quality_status: MISSING` — observation record may exist with MISSING status |
| Source returned partial data | `quality_status: INVALID` with reason — observation exists but flagged |
| Source returned invalid data | `quality_status: INVALID` — observation exists but flagged |
| Source is unavailable | `quality_status: MISSING` depending on whether metric applies |
| Metric not applicable for entity | No observation record created; downstream uses `MISSING` or excludes |
| Source does not provide observation timestamp | `observed_at: UNKNOWN` — observation record created with UNKNOWN observed_at |

### 11.3 Downstream Consumer Rules

When consuming observations, downstream systems (feature engine, health scoring) must:

1. Check `quality_status` before reading `value`
2. Check `freshness_status` before using `value` as current state
3. NEVER substitute a default value for missing data without explicit configuration
4. NEVER silently carry forward a stale value as if it were current

### 11.4 Graceful Degradation

The feature engine currently returns 50 (neutral) when <20 price rows are available. P6 preserves this behavior but requires:
- The "insufficient data" condition is recorded as `quality_status: MISSING` on the derived metric
- The downstream UI can distinguish "calculated from insufficient data" from "calculated from full data"
- The confidence score reflects data sufficiency

---

## 12. Persistence Boundary

### 12.1 What Gets Persisted

| Layer | Persisted? | Table | Notes |
|---|---|---|---|
| Raw observation | OPTIONALLY | TBD (raw_observation table or JSON in canonical) | For provenance/reproducibility only; not part of canonical identity |
| Canonical observation | YES | New `observations` table | Primary durable storage |
| Derived metric | YES | Existing `features`, `health_scores` tables | Already persisted |
| Intelligence result | YES | Existing tables + future P6 tables | Already partially persisted |
| Quality metadata | YES | Within observation record | Inline with canonical observation |
| Freshness metadata | YES | Within observation record | Computed at write time, updated on refresh |

### 12.2 Persistence Principles

1. **Canonical observations are the durable source of truth.** Derived metrics can be recalculated from canonical observations.
2. **Raw payload retention is optional.** It supports reproducibility but is not required for day-to-day operation. Raw JSON is NOT part of canonical observation identity.
3. **Quality and freshness are inline, not separate tables.** They are properties of the observation, not independent records.
4. **Observations are append-only in semantic effect.** Re-ingestion of the same data updates the existing record (upsert on identity tuple), not appends a new record.

### 12.3 Storage Alignment with Existing Schema

| Existing Table | P6 Relationship | Action |
|---|---|---|
| `market_price_daily` | Partial overlap with canonical OPEN/HIGH/LOW/CLOSE/VOLUME/QUOTE_VOLUME | P6 may extend or replace with canonical observations table |
| `coin_metrics` | Partial overlap with OPEN_INTEREST, FUNDING_RATE, MARKET_CAP, FDV | P6 may extend or replace with canonical observations table |
| `features` | Derived metrics — fully reusable | No change to schema; P6 adds new derived metrics |
| `health_scores` | Derived intelligence — fully reusable | No change; P6 extends with new dimensions |
| `source_status` | Source availability — reusable as input | P6 freshness extends this concept |
| `indicators` | Derived indicators — reusable | P6 may reference for provenance |

### 12.4 Migration Boundary

P6-01E will define the exact persistence implementation. This contract does NOT specify:
- Exact table schema
- Column types
- Index strategy
- Migration approach

Those are implementation details for the persistence task.

---

## 13. Versioning Contract

### 13.1 Versioned Artifacts

| Artifact | Version Field | Semantics |
|---|---|---|
| Observation schema | `dataSchemaVersion` | Version of the observation record structure |
| Canonical normalization rules | `normalizationVersion` | Version of the Raw→Canonical mapping |
| Derived metric algorithm | `algorithmVersion` | Version of the calculation algorithm |
| Threshold configuration | `thresholdVersion` | Version of the threshold/parameter set |

### 13.2 Version Immutability

- Changing a version number is a semantic change, not a patch
- Historical observations retain their original version marker
- Re-processing historical data with a new version does NOT silently overwrite the old version's results
- Version changes are documented in migration notes

### 13.3 Compatibility with Existing Versioning

The existing system has:
- `featureVersions` table — tracks feature calculation versions
- `ruleVersions` table — tracks recommendation rule versions

P6 extends this with:
- `dataSchemaVersion` for observation records
- `normalizationVersion` for Raw→Canonical mapping

---

## 14. P3/P4/P5 Compatibility

### 14.1 What P6 Reuses Without Change

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

### 14.2 What P6 Must NOT Modify

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

### 14.3 P6 Extension Points

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

## 15. Mapping: Current Data → Canonical Contract

### 15.1 market_price_daily → Canonical Observations

| Current Field | Canonical Field | Mapping |
|---|---|---|
| `coinId` | `entity_id` | Direct mapping |
| `date` | `business_date` | Direct mapping (already in Asia/Ho_Chi_Minh) |
| `open` | `value` (metric=OPEN) | Direct mapping |
| `high` | `value` (metric=HIGH) | Direct mapping |
| `low` | `value` (metric=LOW) | Direct mapping |
| `close` | `value` (metric=CLOSE) | Direct mapping. PRICE is an alias, not a separate metric. |
| `volume` | `value` (metric=VOLUME) | Direct mapping |
| `quoteVolume` | `value` (metric=QUOTE_VOLUME) | Direct mapping |
| `source` | `source` | Maps to canonical source ID |
| (openTime from API) | `observed_at` | Must be extracted and stored. If source does not provide, set UNKNOWN. |
| (collection time) | `collected_at` | Must be added. Actual ingestion timestamp. |

### 15.2 coin_metrics → Canonical Observations

| Current Field | Canonical Field | Mapping |
|---|---|---|
| `coinId` | `entity_id` | Direct mapping |
| `date` | `business_date` | Direct mapping |
| `openInterest` | `value` (metric=OPEN_INTEREST) | Direct mapping |
| `fundingRate` | `value` (metric=FUNDING_RATE) | Direct mapping |
| `marketCap` | `value` (metric=MARKET_CAP) | Direct mapping |
| `fullyDilutedValuation` | `value` (metric=FDV) | Direct mapping |
| `source` | `source` | Maps to canonical source ID |
| (missing) | `observed_at` | MUST be added. UNKNOWN if source does not provide. |
| (missing) | `collected_at` | MUST be added — currently not tracked |
| (missing) | `timeframe` | MUST be added — currently SOURCE_SNAPSHOT |
| (missing) | `quality_status` | MUST be added |
| (missing) | `freshness_status` | MUST be added |

### 15.3 Gap Summary

| Gap | Impact | Resolution |
|---|---|---|
| `observed_at` not stored in current tables | Cannot determine when source generated data | P6-01E adds this field. UNKNOWN if source does not provide. |
| `collected_at` not stored in current tables | Cannot compute freshness | P6-01E adds this field |
| `timeframe` not explicit in current tables | Cannot distinguish DAILY from 4H observations | P6-01E adds this field |
| `quality_status` not stored | Cannot assess data quality per observation | P6-01E adds this field |
| `freshness_status` not computed | Cannot determine staleness | P6-01E adds computation |
| No raw observation storage | Cannot reproduce historical calculations exactly | P6-01E optionally adds raw storage |

---

## 16. Semantic Invariants

These 15 invariants must hold for all P6 observation operations:

### O-01: Identity Determinism
Same `(entity_id, metric, source, observed_at, timeframe)` → same `observation_id`. Always. No exceptions.

### O-02: observed_at Non-Substitution
`observed_at` represents source observation time. If the source does not provide an observation timestamp, `observed_at` = `UNKNOWN`. The system MUST NOT substitute `collected_at` for `observed_at` under any circumstance.

### O-03: collected_at Independence
`collected_at` is the actual ingestion timestamp, recorded at write time. It is never used as an observation identity component. Two collections of the same source data produce the same observation.

### O-04: Explicit Null
A missing observation is absence, not zero, not null, not a default value, not a carry-forward.

### O-05: Quality Independence
Data quality (`quality_status`) is independent from market health. Never hidden, conflated, or used to suppress health intelligence.

### O-06: Freshness Independence
Data freshness (`freshness_status`) is independent from data quality and market health. Always surfaced alongside intelligence.

### O-07: Provenance Traceability (RAW → CANONICAL)
Every canonical observation is traceable to its raw source via `source` and `source_ref`. This contract defines provenance for the RAW → CANONICAL boundary. Downstream provenance (CANONICAL → DERIVED → INTELLIGENCE → UI) is defined in later P6 tasks.

### O-08: No Silent Substitution
Missing, stale, or invalid data is never silently replaced with current data, default values, or last-known values without explicit configuration.

### O-09: Deterministic Normalization
Same raw input + same normalization version → same canonical output. Always. No side effects, no randomness, no wall-clock dependency.

### O-10: Version Immutability
Historical observations retain their original version marker. Re-processing with a new version does not overwrite old results.

### O-11: Metric Vocabulary Fidelity
Only metrics defined in Section 6.1 are canonical observations. Derived metrics (trend, momentum, health, breadth, participation, etc.) are NEVER observations, regardless of storage format. `PRICE` is an API/presentation alias for `CLOSE`, not a separate canonical observation.

### O-12: P4/P5 Boundary Preservation
P6 observation semantics do not alter, reinterpret, or replace P4/P5 frozen contracts. P4/P5 meanings are invariant.

### O-13: Graceful Degradation
Insufficient or degraded evidence never silently becomes normal/healthy intelligence. Quality and freshness degradation must be explicit.

### O-14: Temporal Substitution Prohibition
`observed_at`, `collected_at`, and `business_date` are never silently substituted for each other. Each has a distinct semantic role. If `observed_at` is UNKNOWN, `business_date` may be derived from `collected_at` with explicit provenance.

### O-15: Unit Consistency
All observations of the same metric use the same canonical unit. OHLC prices preserve `quote_asset` from the source. Unit conversion failures result in `quality_status: INVALID`, not silent unit mismatch.

---

## 17. Open Items / Decisions Required

| # | Question | Status | Impact |
|---|---|---|---|
| 1 | Should raw observations be stored in a separate table or as JSON within canonical records? | **PLANNER DECISION REQUIRED** | Affects storage design and reproducibility |
| 2 | Should existing `market_price_daily` be extended or replaced with a new canonical observations table? | **PLANNER DECISION REQUIRED** | Affects migration strategy and backward compatibility |
| 3 | Should existing `coin_metrics` be extended or replaced? | **PLANNER DECISION REQUIRED** | Same as above |
| 4 | What is the initial `dataSchemaVersion` number? | **PLANNER DECISION REQUIRED** | Versioning convention |
| 5 | Should the normalization boundary produce one observation per OHLCV field (4 records per kline) or one observation per kline (1 record with 4 fields)? | **PLANNER DECISION REQUIRED** | Affects observation granularity and query patterns |
| 6 | What are the per-metric freshness thresholds (FRESH vs STALE boundary)? | **PLANNER DECISION REQUIRED** | Determines when data is classified as stale |
| 7 | What is the data retention policy for canonical observations? | **PLANNER DECISION REQUIRED** | Affects storage growth and historical query capability |
| 8 | How should historical membership (coin_narratives effective dates) be handled? | **PLANNER DECISION REQUIRED** | Affects breadth/participation temporal accuracy |
| 9 | What source fallback strategy should be used when primary source is unavailable? | **PLANNER DECISION REQUIRED** | Affects quality_status and freshness semantics |
| 10 | Which future temporal resolutions (1H, 15M, etc.) should be pre-approved? | **PLANNER DECISION REQUIRED** | Affects V1 scope and future collection infrastructure |
| 11 | Should raw API payloads be retained for reproducibility? If so, for how long? | **PLANNER DECISION REQUIRED** | Affects storage design and audit capability |

---

## 18. Acceptance Criteria

This contract document is complete when:

- [x] Core semantic model defined (Raw/Canonical/Derived)
- [x] RAW ≠ CANONICAL boundary clarified; raw retention is optional provenance
- [x] Observation identity contract defined
- [x] Temporal contract defined (observed_at, collected_at, business_date, timeframe)
- [x] observed_at = UNKNOWN when source does not provide; no substitution with collected_at
- [x] Initial metric vocabulary defined (10 V1 metrics + PRICE as alias only)
- [x] OHLC as canonical vocabulary; PRICE is API/presentation alias for CLOSE
- [x] Unit semantics use quote_asset/base_asset, not hardcoded USD
- [x] Source provenance contract defined (RAW → CANONICAL scope)
- [x] Freshness model defined (FRESH/STALE/UNKNOWN)
- [x] Data quality model defined (VALID/INVALID/MISSING/UNKNOWN)
- [x] Missing/null semantics defined
- [x] Persistence boundary defined
- [x] Versioning contract defined
- [x] P3/P4/P5 compatibility verified
- [x] 15 semantic invariants stated (O-01 through O-15)
- [x] Open items documented with PLANNER DECISION REQUIRED
- [x] No production code modified
- [x] No P4/P5 contracts modified

---

## 19. Next Steps

After this contract is accepted:

1. **P6-01C** — Source Registry: Define source identity, reliability metadata, supported metrics, expected cadence
2. **P6-01D** — Freshness + Data Quality Contract: Implement the freshness classification rules and quality assessment logic (including threshold decisions from Section 17)
3. **P6-01E** — Observation Persistence: Implement the canonical observation tables and Raw→Canonical normalization
4. **P6-01F** — Normalization Boundary: Implement the normalization functions that transform raw API responses into canonical observations

---

**P6-01B OBSERVATION CONTRACT — REVISION 2 COMPLETE**
**NO PRODUCTION CODE CHANGES**
**NO SCHEMA CHANGES**
**NO API CHANGES**
**NO P4/P5 CONTRACT CHANGES**
